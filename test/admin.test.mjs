import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { getBase58Decoder } from '@solana/kit';
import { createApp } from '../service/app.mjs';
import { Store } from '../service/store.mjs';
import { WorkspaceStore } from '../service/workspace-store.mjs';
import { createMandateService } from '../service/mandates.mjs';
import { createRequestTelemetry } from '../service/observability.mjs';
import { loadConfig } from '../service/config.mjs';

function identity() {
  const keys = generateKeyPairSync('ed25519');
  return { ...keys, wallet: getBase58Decoder().decode(keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)) };
}
async function setup({ adminReader, grant = true, sessionTtlMs = 60_000 } = {}) {
  let now = Date.UTC(2026, 10, 7, 3, 1, 20), gatewayCalls = 0;
  const directory = await mkdtemp('/tmp/floww-admin-http-'), store = new Store(path.join(directory, 'state.sqlite'), { clock: () => now });
  const administrator = identity(), consumer = identity(), server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const config = { ...loadConfig({ FLOWW_PUBLIC_ORIGIN: origin, FLOWW_ADMIN_WALLETS: grant ? administrator.wallet : '' }), sessionTtlMs };
  await WorkspaceStore.open(store); await createMandateService({ store, config });
  const telemetry = createRequestTelemetry({ write: () => {}, wallClock: () => now });
  const forbidden = () => { gatewayCalls++; throw new Error('No funded transport in administrator read tests'); };
  const app = createApp({ config, store, gateway: { readiness: forbidden, quote: forbidden, sign: forbidden, redeem: forbidden, reconcile: forbidden },
    adminReader, telemetry, observeRequest: telemetry.observeRequest, adapterStatus: { workspaceAdapterReady: true, reportAdapterReady: true } });
  server.on('request', app);
  async function request(url, { cookie, method = 'GET', body } = {}) {
    const result = await fetch(origin + url, { method, headers: { ...(cookie ? { Cookie: cookie } : {}),
      ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: result.status, headers: result.headers, body: result.status === 204 ? null : await result.json() };
  }
  async function login(keys) {
    const challenge = await request('/api/auth/challenge', { method: 'POST', body: { wallet: keys.wallet } });
    const session = await request('/api/auth/verify', { method: 'POST', body: { wallet: keys.wallet, challengeId: challenge.body.challengeId,
      signature: sign(null, Buffer.from(challenge.body.message), keys.privateKey).toString('base64') } });
    assert.equal(session.status, 200); return session.headers.get('set-cookie').split(';')[0];
  }
  return { request, login, administrator, consumer, store, config, app, telemetry, advance(ms) { now += ms; }, counts: () => gatewayCalls,
    async close() { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); await app.locals.lifecycle.whenIdle(); store.close(); await rm(directory, { recursive: true, force: true }); } };
}
test('admin read access requires explicit membership and current normal wallet sign-in', async () => {
  let snapshots = 0;
  const f = await setup({ adminReader: { snapshot() { snapshots++; throw new Error('Unauthorized source read'); } } });
  try {
    for (const endpoint of ['access', 'overview', 'events', 'requests']) assert.equal((await f.request('/api/admin/' + endpoint)).status, 401);
    const user = await f.login(f.consumer);
    for (const endpoint of ['access', 'overview', 'events', 'requests']) {
      const result = await f.request('/api/admin/' + endpoint, { cookie: user });
      assert.equal(result.status, 403); assert.equal(result.body.error.code, 'ADMIN_ACCESS_DENIED');
      assert.doesNotMatch(JSON.stringify(result.body), new RegExp(f.administrator.wallet));
    }
    assert.equal(snapshots, 0);
    const admin = await f.login(f.administrator), access = await f.request('/api/admin/access', { cookie: admin });
    assert.equal(access.status, 200); assert.equal(access.body.role, 'ADMIN_READ');
    assert.equal(access.headers.get('cache-control'), 'no-store'); assert.equal(snapshots, 0);
    assert.equal((await f.request('/api/session', { cookie: admin })).body.wallet, f.administrator.wallet);
    assert.equal(f.counts(), 0);
  } finally { await f.close(); }
});
test('the first signed-in wallet never becomes administrator under empty configuration', async () => {
  const f = await setup({ grant: false });
  try {
    const cookie = await f.login(f.administrator);
    assert.equal((await f.request('/api/admin/access', { cookie })).status, 403);
    assert.equal((await f.request('/api/tasks', { cookie })).status, 200);
    assert.equal(f.counts(), 0);
  } finally { await f.close(); }
});
test('real authenticated HTTP overview/events expose cross-owner safe states without owner override', async () => {
  const f = await setup();
  try {
    const id = randomUUID(); f.store.add({ id, owner: f.consumer.wallet, createdAt: '2026-11-07T00:00:00.000Z',
      policy: 'ALLOW', payment: 'CONFIRMED', delivery: 'FAILED', purpose: 'private customer text', wallet: f.consumer.wallet,
      signedData: { private: 'private proof' }, events: [{ at: '2026-11-07T00:00:00.000Z', type: 'TASK_CREATED', code: 'QUOTE_REQUIRED' }] });
    const cookie = await f.login(f.administrator);
    const overview = await f.request('/api/admin/overview', { cookie });
    assert.equal(overview.status, 200); assert.equal(overview.body.version, 'admin-read/v1');
    assert.equal(overview.body.sources.tasks.status, 'ready'); assert.equal(overview.body.sources.tasks.data.total, 1);
    assert.equal(overview.body.sources.tasks.data.attention.confirmedUndelivered, 1);
    assert.equal(overview.body.sources.runtime.data.capabilities.modelConfigured, false);
    assert.equal(overview.body.sources.runtime.data.minuteBuckets.length, 1);
    assert.equal(overview.body.sources.runtime.data.startedAt, '2026-11-07T03:01:20.000Z');
    const events = await f.request('/api/admin/events?limit=1', { cookie });
    assert.equal(events.status, 200); assert.equal(events.body.data.stateScope, 'current-task-state');
    assert.equal(events.body.data.events[0].event, 'TASK_CREATED'); assert.equal(events.body.data.events[0].payment, 'CONFIRMED');
    assert.equal(events.body.data.taskCapturedAt, events.body.capturedAt);
    assert.doesNotMatch(JSON.stringify({ overview: overview.body, events: events.body }), new RegExp([id, f.consumer.wallet, 'private customer text', 'private proof'].join('|')));
    assert.equal((await f.request('/api/tasks/' + id, { cookie })).status, 404);
    assert.equal((await f.request('/api/tasks', { cookie })).body.tasks.length, 0);
    assert.equal((await f.request('/api/admin/access', { cookie, method: 'POST', body: {} })).status, 404);
    assert.equal(f.counts(), 0);
  } finally { await f.close(); }
});
test('every admin endpoint validates a bounded exact query after authorization', async () => {
  const f = await setup();
  try {
    const cookie = await f.login(f.administrator);
    for (const url of ['/api/admin/access?wallet=private', '/api/admin/overview?limit=1', '/api/admin/events?limit=51',
      '/api/admin/events?limit=0', '/api/admin/events?limit=1&limit=2', '/api/admin/requests?limit=101', '/api/admin/requests?owner=private']) {
      const result = await f.request(url, { cookie }); assert.equal(result.status, 400); assert.equal(result.body.error.code, 'INVALID_ADMIN_QUERY');
    }
    assert.equal((await f.request('/api/admin/events?limit=1')).status, 401);
    assert.equal(f.counts(), 0);
  } finally { await f.close(); }
});
test('delayed admin data is withheld after logout or expiry and sources are not re-read anonymously', async () => {
  for (const action of ['logout', 'expiry']) {
    let resolve, signal; const started = new Promise(done => { signal = done; }); let calls = 0;
    const f = await setup({ adminReader: { snapshot() { calls++; signal(); return new Promise(done => { resolve = done; }); } } });
    try {
      const cookie = await f.login(f.administrator), pending = f.request('/api/admin/overview', { cookie }); await started;
      if (action === 'logout') await f.request('/api/auth/logout', { cookie, method: 'POST', body: {} }); else f.advance(60_001);
      resolve({ tasks: { sensitive: 'should never leave delayed read' }, usage: {}, executions: {} });
      const result = await pending; assert.equal(result.status, 401); assert.doesNotMatch(JSON.stringify(result.body), /sensitive|delayed read/);
      assert.equal((await f.request('/api/admin/overview', { cookie })).status, 401); assert.equal(calls, 1);
    } finally { resolve?.({}); await f.close(); }
  }
});
test('draining fences new admin sources and delayed response release', async () => {
  let resolve, signal; const started = new Promise(done => { signal = done; }); let calls = 0;
  const f = await setup({ adminReader: { snapshot() { calls++; signal(); return new Promise(done => { resolve = done; }); } } });
  try {
    const cookie = await f.login(f.administrator), pending = f.request('/api/admin/events', { cookie }); await started;
    f.app.locals.lifecycle.beginDrain(); resolve({ events: { status: 'unavailable', code: 'ADMIN_SOURCE_UNAVAILABLE' } });
    const delayed = await pending; assert.equal(delayed.status, 503); assert.equal(delayed.body.error.code, 'SERVICE_DRAINING');
    assert.equal((await f.request('/api/admin/overview', { cookie })).status, 503); assert.equal(calls, 1);
    assert.equal((await f.request('/api/session', { cookie })).status, 200);
  } finally { resolve?.({}); await f.close(); }
});
test('HTTP requests are a bounded redacted ring with explicit retained versus evicted history', async () => {
  const f = await setup();
  try {
    const cookie = await f.login(f.administrator);
    for (let i = 0; i < 205; i++) await f.request('/livez?private=customer-' + i);
    const result = await f.request('/api/admin/requests?limit=2', { cookie });
    assert.equal(result.status, 200); assert.equal(result.body.status, 'ready');
    assert.equal(result.body.data.requests.length, 2); assert.equal(result.body.data.retained, 200);
    assert.equal(result.body.data.hasMore, true); assert.equal(result.body.data.truncated, true); assert.equal(result.body.data.dropped, 7);
    assert.ok(result.body.data.requests.every(row => row.route === 'liveness' && row.status === 200));
    assert.doesNotMatch(JSON.stringify(result.body), /customer-|private=|Cookie|wallet/);
    assert.equal(f.counts(), 0);
  } finally { await f.close(); }
});
