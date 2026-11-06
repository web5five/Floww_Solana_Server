/** Real loopback HTTP and SQLite; every financial transport is explicitly scripted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { getBase58Decoder } from '@solana/kit';
import { createApp } from '../service/app.mjs';
import { createLifecycle, createShutdown } from '../service/lifecycle.mjs';
import { loadConfig } from '../service/config.mjs';
import { Store } from '../service/store.mjs';
import { start } from '../service/main.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) {
  const end = Date.now() + 2000;
  while (!check() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 1));
  assert.ok(check(), 'controlled lifecycle boundary was not reached');
}
function pair() {
  const keys = generateKeyPairSync('ed25519');
  return { ...keys, wallet: getBase58Decoder().decode(keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)) };
}
function request(server, config, path, { method = 'GET', body, cookie, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path, method, headers: {
      host: new URL(config.origin).host, ...(cookie ? { Cookie: cookie } : {}),
      ...(method !== 'GET' ? { Origin: config.origin, 'Content-Type': 'application/json' } : {}), ...headers,
    } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null }); }
        catch (error) { reject(error); }
      });
    });
    req.once('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function healthFixture({ lifecycle, observeRequest, mountMerchant } = {}) {
  const config = loadConfig({}), control = { database: true, ledger: true, reasonCode: 'LEDGER_READY', probes: 0, gatewayReads: 0, challenges: 0 };
  const store = { clock: Date.now, list: async () => { control.probes++; if (!control.database) throw new Error('private-database-value'); return []; },
    session: async () => null, challenge: async () => { control.challenges++; return {}; } };
  const app = createApp({ config, store, lifecycle, observeRequest, mountMerchant,
    gateway: { readiness: async () => { control.gatewayReads++; return { ready: false, missing: ['payment_enabled'], payer: null }; } },
    runtimeReadiness: async () => ({ ready: control.ledger, reasonCode: control.reasonCode }) });
  const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { app, server, config, control, lifecycle: app.locals.lifecycle,
    request: (path, options) => request(server, config, path, options),
    close: () => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }) };
}

test('live and ready probes distinguish process availability from disabled payment capability', async () => {
  const f = await healthFixture();
  try {
    assert.deepEqual((await f.request('/livez')).body, { live: true }); assert.equal(f.control.probes, 0);
    const ready = await f.request('/readyz'); assert.equal(ready.status, 200); assert.equal(ready.body.ready, true);
    assert.equal(ready.body.databaseReady, true); assert.equal(ready.body.ledgerReady, true); assert.equal(f.control.gatewayReads, 0);
    const legacy = await f.request('/api/health'); assert.equal(legacy.status, 200); assert.equal(legacy.body.ready, false);
    assert.equal(legacy.body.paymentEnabled, false); assert.equal(legacy.body.databaseReady, true);
    assert.ok(legacy.body.missing.includes('FLOWW_ENABLE_DEVNET_PAYMENTS'));
    assert.equal((await f.request('/api/tasks')).status, 401);
  } finally { await f.close(); }
});

test('database and ledger failures return readiness 503 without changing live or legacy health contracts', async () => {
  const f = await healthFixture();
  try {
    assert.equal((await f.request('/readyz')).status, 200);
    f.control.database = false;
    const legacy = await f.request('/api/health'); assert.equal(legacy.status, 200); assert.equal(legacy.body.databaseReady, false);
    let ready = await f.request('/readyz'); assert.equal(ready.status, 503); assert.equal(ready.body.reasonCode, 'DATABASE_CONNECTION');
    assert.equal((await f.request('/livez')).status, 200);
    f.control.database = true; f.control.ledger = false; f.control.reasonCode = 'LEDGER_IMPORT_REQUIRED';
    await f.request('/api/health'); ready = await f.request('/readyz');
    assert.equal(ready.status, 503); assert.equal(ready.body.databaseReady, true); assert.equal(ready.body.reasonCode, 'LEDGER_IMPORT_REQUIRED');
    f.control.reasonCode = 'private-unexpected-provider-value'; await f.request('/api/health');
    ready = await f.request('/readyz'); assert.equal(ready.body.reasonCode, 'BUDGET_STATE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(ready.body), /private/);
    f.control.ledger = true; await f.request('/api/health'); assert.equal((await f.request('/readyz')).status, 200);
  } finally { await f.close(); }
});

test('concurrent HTTP probes time out together and do not queue replacement database work', async () => {
  const gate = deferred(); let calls = 0;
  const lifecycle = createLifecycle({ probeTimeoutMs: 20, probeCacheMs: 5, probe: async () => {
    calls++; await gate.promise; return { databaseReady: true, ledgerReady: true };
  } });
  const f = await healthFixture({ lifecycle });
  try {
    const replies = await Promise.all(Array.from({ length: 12 }, () => f.request('/readyz')));
    assert.ok(replies.every(reply => reply.status === 503 && reply.body.reasonCode === 'READINESS_TIMEOUT'));
    for (let i = 0; i < 5; i++) assert.equal((await f.request('/readyz')).status, 503);
    assert.equal(calls, 1); assert.equal((await f.request('/livez')).status, 200);
    gate.resolve(); await tick();
    assert.equal((await f.request('/readyz')).status, 200); assert.equal(calls, 2);
  } finally { gate.resolve(); await f.close(); }
});

test('readiness caching is short and drain overrides an in-flight successful probe', async () => {
  let now = 0, calls = 0;
  const lifecycle = createLifecycle({ clock: () => now, probeCacheMs: 10, probeTimeoutMs: 100, probe: async () => {
    calls++; return { databaseReady: true, ledgerReady: true };
  } });
  await lifecycle.readiness(); await lifecycle.readiness(); assert.equal(calls, 1);
  now = 11; await lifecycle.readiness(); assert.equal(calls, 2);
  const gate = deferred(), draining = createLifecycle({ probe: () => gate.promise });
  const pending = draining.readiness(); draining.beginDrain(); gate.resolve({ databaseReady: true, ledgerReady: true });
  assert.equal((await pending).reasonCode, 'DRAINING'); assert.equal((await draining.readiness()).ready, false);
});

test('a timed-out readiness probe retains SQLite until its actual database work completes', async () => {
  const gate = deferred(), store = new Store(':memory:'); let probeRead = false, closes = 0;
  const lifecycle = createLifecycle({ probeTimeoutMs: 5, probeCacheMs: 5, probe: async () => {
    await gate.promise; store.list('__floww_health__'); probeRead = true;
    return { databaseReady: true, ledgerReady: true };
  } });
  const f = await healthFixture({ lifecycle });
  const close = createShutdown({ server: f.server, lifecycle, graceMs: 15,
    store: { close() { closes++; store.close(); } } });
  try {
    const reply = await f.request('/readyz');
    assert.equal(reply.status, 503); assert.equal(reply.body.reasonCode, 'READINESS_TIMEOUT');
    assert.deepEqual(lifecycle.counts(), { requests: 0, work: 1 });
    assert.deepEqual(await close(), { drained: false, storeClosed: false, forcedHttpClose: true });
    assert.equal(closes, 0); assert.equal(probeRead, false);
    gate.resolve(); await until(() => closes === 1);
    assert.equal(probeRead, true); assert.deepEqual(lifecycle.counts(), { requests: 0, work: 0 });
  } finally { gate.resolve(); await close(); }
});

test('drain refuses new mutation before storage and retains Host and Origin enforcement', async () => {
  const f = await healthFixture();
  try {
    f.lifecycle.beginDrain();
    const denied = await f.request('/api/auth/challenge', { method: 'POST', body: { wallet: pair().wallet } });
    assert.equal(denied.status, 503); assert.equal(denied.body.error.code, 'SERVICE_DRAINING');
    assert.equal(denied.headers['retry-after'], '1'); assert.equal(f.control.challenges, 0);
    assert.equal((await f.request('/readyz')).body.reasonCode, 'DRAINING'); assert.equal((await f.request('/livez')).status, 200);
    assert.equal((await f.request('/api/auth/challenge', { method: 'POST', headers: { Origin: 'https://elsewhere.invalid' }, body: {} })).status, 403);
    assert.equal((await f.request('/livez', { headers: { Host: 'elsewhere.invalid' } })).status, 421);
  } finally { await f.close(); }
});

test('optional request telemetry sees the server request ID once and cannot break HTTP', async () => {
  let calls = 0, requestId;
  const f = await healthFixture({ observeRequest: req => { calls++; requestId = req.requestId; throw new Error('private-telemetry-value'); } });
  try {
    const reply = await f.request('/livez', { headers: { 'X-Request-ID': 'attacker-chosen' } });
    assert.equal(reply.status, 200); assert.equal(calls, 1); assert.equal(requestId, reply.headers['x-request-id']);
    assert.notEqual(requestId, 'attacker-chosen'); assert.doesNotMatch(JSON.stringify(reply), /private-telemetry/);
  } finally { await f.close(); }
});

test('asynchronous request telemetry rejection remains contained', async () => {
  const f = await healthFixture({ observeRequest: async () => { throw new Error('private-telemetry-value'); } });
  try {
    const reply = await f.request('/livez'); await tick();
    assert.equal(reply.status, 200); assert.doesNotMatch(JSON.stringify(reply), /private-telemetry/);
  } finally { await f.close(); }
});

test('drain also refuses the GET-based merchant payment route before report or settlement admission', async () => {
  let calls = 0;
  const f = await healthFixture({ mountMerchant: app => {
    app.get('/merchant/reports/:resourceId', (req, res) => { calls++; res.json({ report: true }); });
  } });
  try {
    f.lifecycle.beginDrain();
    const denied = await f.request('/MeRcHaNt/reports/resource');
    assert.equal(denied.status, 503); assert.equal(denied.body.error.code, 'SERVICE_DRAINING');
    assert.equal(calls, 0); assert.equal((await f.request('/livez')).status, 200);
  } finally { await f.close(); }
});

test('merchant work remains tracked after disconnect until its receipt bookkeeping completes', async () => {
  const gate = deferred(); let entered = false, observed = false, closes = 0;
  const f = await healthFixture({ mountMerchant: (app, { trackWork }) => {
    app.get('/merchant/reports/:resourceId', (req, res) => trackWork(async () => {
      entered = true; await gate.promise; observed = true;
      if (!res.destroyed) res.json({ report: true });
    }));
  } });
  const close = createShutdown({ server: f.server, lifecycle: f.lifecycle, graceMs: 15,
    store: { close: () => { assert.equal(observed, true); closes++; } } });
  let pending;
  try {
    pending = f.request('/merchant/reports/resource').catch(error => ({ error })); await until(() => entered);
    assert.equal((await close()).drained, false); assert.equal(closes, 0); assert.ok((await pending).error);
    gate.resolve(); await until(() => closes === 1); assert.equal(f.lifecycle.counts().work, 0);
  } finally { gate.resolve(); if (pending) await pending; await close(); }
});

async function financialFixture({ graceMs = 200, storeCloseMs = 100 } = {}) {
  const now = Date.UTC(2026, 10, 6, 12), payer = pair().wallet;
  const config = { ...loadConfig({ MERCHANT_PAY_TO: pair().wallet, FLOWW_ENABLE_DEVNET_PAYMENTS: 'true' }), port: 0 };
  const store = new Store(':memory:', { clock: () => now });
  const control = { beforeSign: null, redeem: null, signs: 0, redemptions: 0, closes: 0, saved: null, held: null };
  const originalClose = store.close.bind(store);
  store.close = () => {
    control.closes++; control.saved = store.db.prepare('SELECT data FROM tasks').all().map(row => JSON.parse(row.data));
    control.held = store.db.prepare('SELECT data FROM workspace_reservations').all().map(row => JSON.parse(row.data)); originalClose();
  };
  const forbidden = async () => { assert.fail('External financial/model transport is not permitted'); };
  const gateway = {
    readiness: async () => ({ ready: true, payer, missing: [] }),
    quote: async resourceUrl => {
      const requirements = { scheme: 'exact', network: config.network, asset: config.asset, amount: config.amountAtomic,
        payTo: config.merchantPayTo, maxTimeoutSeconds: 120, extra: { feePayer: payer } };
      return { resourceUrl, requirements, paymentRequired: { x402Version: 2, resource: { url: resourceUrl }, accepts: [requirements] } };
    },
    sign: async (quote, { beforeSign }) => {
      await control.beforeSign?.(); await beforeSign(); control.signs++;
      return { payer, paymentHeader: 'scripted-original-private-proof', messageHash: 'a'.repeat(64), signature: null,
        requirements: quote.requirements, resourceUrl: quote.resourceUrl };
    },
    redeem: async () => { control.redemptions++; await control.redeem?.(); return { payment: 'UNKNOWN', delivery: 'PENDING', reasonCode: 'SCRIPTED_UNCERTAIN' }; },
    reconcile: forbidden,
  };
  const runtime = await start({ config, store, gateway, rpc: forbidden, reportProvider: forbidden,
    planner: {}, ai: { propose: async () => ({ status: 'PROPOSED', proposal_ref: 'fixture-proposal' }), consume: forbidden },
    mountMerchant: () => ({}), writeLog: () => true, shutdownGraceMs: graceMs, storeCloseMs });
  const http = (path, options) => request(runtime.server, config, path, options);
  const actor = pair(), challenge = await http('/api/auth/challenge', { method: 'POST', body: { wallet: actor.wallet } });
  const verified = await http('/api/auth/verify', { method: 'POST', body: { wallet: actor.wallet, challengeId: challenge.body.challengeId,
    signature: sign(null, Buffer.from(challenge.body.message), actor.privateKey).toString('base64') } });
  assert.equal(verified.status, 200); const cookie = verified.headers['set-cookie'][0].split(';')[0];
  const created = await http('/api/tasks', { method: 'POST', cookie, body: { purpose: 'Explicit lifecycle test observation', wallet: actor.wallet,
    windowStart: '2026-11-04T00:00:00.000Z', windowEnd: '2026-11-05T00:00:00.000Z' } });
  assert.equal(created.status, 201);
  const quoted = await http('/api/tasks/' + created.body.id + '/quote', { method: 'POST', cookie, body: {} });
  assert.equal(quoted.status, 200);
  const approved = await http('/api/tasks/' + created.body.id + '/approve', { method: 'POST', cookie, body: {
    quoteHash: quoted.body.quote.hash, budgetAtomic: quoted.body.quote.amountAtomic, expiresAt: new Date(now + 60_000).toISOString(), acknowledge: true } });
  assert.equal(approved.status, 200);
  return { runtime, store, control, actor, cookie, task: approved.body, request: http,
    execute: () => http('/api/tasks/' + approved.body.id + '/execute', { method: 'POST', cookie, body: { approvalId: approved.body.approval.id } }) };
}

for (const path of ['/api/session', '/api/catalog']) {
  test(`disconnected ${path} retains SQLite until its asynchronous handler completes`, async () => {
    const f = await financialFixture({ graceMs: 15 }), gate = deferred(); let entered = false, read = false, pending;
    const originalSession = f.store.session.bind(f.store);
    f.store.session = async (...args) => {
      entered = true; await gate.promise;
      const result = originalSession(...args); read = true; return result;
    };
    try {
      pending = f.request(path, { cookie: f.cookie }).catch(error => ({ error })); await until(() => entered);
      assert.deepEqual(await f.runtime.close(), { drained: false, storeClosed: false, forcedHttpClose: true });
      assert.ok((await pending).error); assert.equal(f.control.closes, 0); assert.equal(read, false);
      gate.resolve(); await until(() => f.control.closes === 1);
      assert.equal(read, true); assert.deepEqual(f.runtime.lifecycle.counts(), { requests: 0, work: 0 });
    } finally { gate.resolve(); if (pending) await pending; await f.runtime.close(); }
  });
}

test('real runtime close is idempotent and waits for original financial bookkeeping before closing SQLite', async () => {
  const f = await financialFixture({ graceMs: 1000 }), gate = deferred(); let executing;
  try {
    f.control.redeem = () => gate.promise; executing = f.execute(); await until(() => f.control.redemptions === 1);
    const first = f.runtime.close(), second = f.runtime.close(); assert.equal(first, second); assert.equal(f.control.closes, 0);
    gate.resolve(); assert.equal((await executing).body.payment, 'UNKNOWN');
    assert.deepEqual(f.runtime.lifecycle.counts(), { requests: 0, work: 0 });
    assert.deepEqual(await first, { drained: true, storeClosed: true, forcedHttpClose: false });
    assert.equal(f.control.closes, 1); assert.equal(f.control.saved[0].payment, 'UNKNOWN');
    assert.equal(f.control.saved[0].signedData.paymentHeader, 'scripted-original-private-proof');
    assert.equal(f.control.held[0].state, 'HELD'); assert.equal(f.control.signs, 1);
  } finally { gate.resolve(); if (executing) await executing.catch(() => {}); await f.runtime.close(); }
});

test('HTTP drain deadline never closes the financial database or releases HELD before an uncertain outcome is saved', async () => {
  const f = await financialFixture({ graceMs: 25 }), gate = deferred(); let executing;
  try {
    f.control.redeem = () => gate.promise; executing = f.execute().catch(error => ({ error }));
    await until(() => f.control.redemptions === 1);
    const stopped = await f.runtime.close();
    assert.deepEqual(stopped, { drained: false, storeClosed: false, forcedHttpClose: true });
    assert.equal(f.control.closes, 0); assert.equal(f.store.get(f.task.id, f.actor.wallet).payment, 'PENDING');
    assert.equal((await f.runtime.mandates.dashboard(f.actor.wallet)).heldAtomic, f.task.quote.amountAtomic);
    assert.ok((await executing).error, 'the HTTP connection should close at its deadline');
    gate.resolve(); await until(() => f.control.closes === 1);
    assert.equal(f.control.saved[0].payment, 'UNKNOWN'); assert.equal(f.control.held[0].state, 'HELD'); assert.equal(f.control.signs, 1);
  } finally { gate.resolve(); if (executing) await executing; await f.runtime.close(); }
});

test('drain reaching the final signing callback prevents any new signature while preserving conservative state', async () => {
  const f = await financialFixture(), gate = deferred(); let entered = false, executing;
  try {
    f.control.beforeSign = async () => { entered = true; await gate.promise; };
    executing = f.execute(); await until(() => entered); f.runtime.lifecycle.beginDrain();
    assert.equal((await f.request('/readyz')).status, 503);
    const denied = await f.request('/api/auth/challenge', { method: 'POST', body: { wallet: pair().wallet } });
    assert.equal(denied.status, 503); gate.resolve();
    const stopped = await executing; assert.equal(stopped.status, 503); assert.equal(stopped.body.error.code, 'SERVICE_DRAINING');
    assert.equal(f.control.signs, 0); assert.equal(f.control.redemptions, 0);
    assert.equal(f.store.get(f.task.id, f.actor.wallet).payment, 'UNKNOWN');
    assert.equal((await f.runtime.mandates.dashboard(f.actor.wallet)).heldAtomic, f.task.quote.amountAtomic);
  } finally { gate.resolve(); if (executing) await executing.catch(() => {}); await f.runtime.close(); }
});

test('a slow store close has a bounded honest result and is never invoked twice', async () => {
  const f = await healthFixture(), gate = deferred(); let closes = 0;
  const close = createShutdown({ server: f.server, lifecycle: f.lifecycle, graceMs: 100, storeCloseMs: 10,
    store: { close: async () => { closes++; await gate.promise; } } });
  try {
    const result = await close(); assert.deepEqual(result, { drained: true, storeClosed: false, forcedHttpClose: false });
    assert.equal(closes, 1); assert.equal(close(), close()); gate.resolve(); await tick(); assert.equal(closes, 1);
  } finally { gate.resolve(); await close(); }
});
