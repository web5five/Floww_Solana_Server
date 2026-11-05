import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { getBase58Decoder } from '@solana/kit';
import { createApp } from '../service/app.mjs';
import { Store } from '../service/store.mjs';
import { loadConfig } from '../service/config.mjs';

function keypair() {
  const kp = generateKeyPairSync('ed25519'); return { ...kp,
    address: getBase58Decoder().decode(kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)) };
}
const signature = getBase58Decoder().decode(Uint8Array.from({ length: 64 }, (_, i) => i + 1));
async function setup({ asyncStore = false, sessionTtlMs = 8 * 3600_000 } = {}) {
  let time = Date.UTC(2026, 10, 5, 12), signs = 0, redemptions = 0, gets = 0, consumes = 0;
  const rawStore = new Store(':memory:', { clock: () => time });
  const store = asyncStore ? new Proxy(rawStore, { get(obj, prop) {
    const value = obj[prop]; if (typeof value !== 'function') return value;
    return ['clock', 'event'].includes(prop) ? value.bind(obj) : async (...args) => value.apply(obj, args);
  } }) : rawStore;
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, payer = keypair().address;
  const config = { ...loadConfig({ MERCHANT_PAY_TO: keypair().address }), origin, publicOrigin: origin,
    merchantOrigin: origin, merchantBaseUrl: origin + '/merchant/reports', paymentEnabled: true, sessionTtlMs };
  const control = { ready: true, changed: false, outcome: null, signHook: null, redeemHook: null, reconcileHook: null, aiHook: null, pause: null };
  const gateway = {
    async readiness() { return { ready: control.ready, payer, missing: control.ready ? [] : ['payment_enabled'] }; },
    async quote(url) { gets++;
      const requirements = { scheme: 'exact', network: config.network, asset: config.asset, amount: control.changed ? '2000' : config.amountAtomic,
        payTo: config.merchantPayTo, maxTimeoutSeconds: 120, extra: { feePayer: payer } };
      return { resourceUrl: url, requirements, paymentRequired: { x402Version: 2, resource: { url, mimeType: 'application/json' }, accepts: [requirements] } };
    },
    async sign(quote, { beforeSign }) {
      await control.signHook?.(); await beforeSign(); signs++;
      if (control.pause) await control.pause;
      return { paymentHeader: 'scripted-private-proof', payer, signature: null, messageHash: 'scripted-message', requirements: quote.requirements, resourceUrl: quote.resourceUrl };
    },
    async redeem(url, signed) { redemptions++; await control.redeemHook?.();
      assert.equal(signed.paymentHeader, 'scripted-private-proof');
      return control.outcome ?? { payment: 'CONFIRMED', delivery: 'COMPLETED', transaction: signature, body: '{}', reasonCode: 'RESOURCE_DELIVERED' };
    },
    async reconcile() { await control.reconcileHook?.(); return { payment: 'CONFIRMED', transaction: signature }; },
  };
  const ai = {
    async propose() { return { status: 'PROPOSED', code: 'BACKEND_REVIEW_REQUIRED', proposal_ref: 'proposal-scripted', explanation: 'Explicit resource', execution_kind: 'scripted_test' }; },
    async consume(input) { consumes++; await control.aiHook?.(); assert.equal(input.payment, 'CONFIRMED'); assert.equal(input.fulfillment, 'COMPLETED');
      return { status: 'EVIDENCE_READY', code: 'ANALYTICS_SUMMARY', answer: { is_synthetic: true, transfer_count: 0 }, html: '<p>Scripted test</p>', markdown: 'Scripted test' };
    },
  };
  server.on('request', createApp({ config, store, gateway, ai }));
  async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
    const response = await fetch(origin + path, { method, headers: { ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
  }
  async function login(kp = keypair()) {
    const c = await request('/api/auth/challenge', { method: 'POST', body: { wallet: kp.address } });
    assert.equal(c.status, 200);
    const body = { wallet: kp.address, challengeId: c.body.challengeId, signature: sign(null, Buffer.from(c.body.message), kp.privateKey).toString('base64') };
    const r = await request('/api/auth/verify', { method: 'POST', body }); assert.equal(r.status, 200);
    return { cookie: r.headers.get('set-cookie').split(';')[0], kp, verifyBody: body };
  }
  async function task(cookie) {
    const r = await request('/api/tasks', { method: 'POST', cookie, body: { purpose: 'Wallet transfers', wallet: keypair().address,
      windowStart: '2026-11-04T00:00:00.000Z', windowEnd: '2026-11-05T00:00:00.000Z' } });
    assert.equal(r.status, 201); return r.body;
  }
  async function quoted(cookie) { const t = await task(cookie); const r = await request(`/api/tasks/${t.id}/quote`, { method: 'POST', cookie, body: {} }); assert.equal(r.status, 200); return r.body; }
  async function approved(cookie) { const t = await quoted(cookie); const r = await request(`/api/tasks/${t.id}/approve`, { method: 'POST', cookie,
    body: { quoteHash: t.quote.hash, budgetAtomic: t.quote.amountAtomic, expiresAt: new Date(time + 60_000).toISOString(), acknowledge: true } });
    assert.equal(r.status, 200); return r.body; }
  return { request, login, task, quoted, approved, control, config, rawStore, now: () => time, advance: delta => { time += delta; },
    counts: () => ({ signs, redemptions, gets, consumes }), close: async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); rawStore.close(); } };
}
const execute = (f, cookie, t) => f.request(`/api/tasks/${t.id}/execute`, { method: 'POST', cookie, body: { approvalId: t.approval.id } });

test('wallet sign-in is one-use, origin/Host bound and owner-scoped', async () => {
  const f = await setup(); try {
    assert.equal((await f.request('/api/tasks')).status, 401);
    const a = await f.login(), b = await f.login();
    assert.equal((await f.request('/api/auth/verify', { method: 'POST', body: a.verifyBody })).status, 401);
    const t = await f.task(a.cookie);
    assert.equal((await f.request(`/api/tasks/${t.id}`, { cookie: b.cookie })).status, 404);
    assert.equal((await f.request('/api/tasks', { cookie: b.cookie })).body.tasks.length, 0);
    assert.equal((await f.request(`/api/tasks/${t.id}/quote`, { method: 'POST', cookie: a.cookie, body: {}, headers: { Origin: 'https://other.example' } })).status, 403);
    const rejectedHost = await new Promise((resolve, reject) => {
      const req = httpRequest(f.config.origin + '/api/health', { headers: { Host: 'attacker.example' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.end();
    });
    assert.equal(rejectedHost, 421);
    const s = await f.request('/api/session', { cookie: a.cookie }); assert.equal(s.body.wallet, a.kp.address);
    const logout = await f.request('/api/auth/logout', { method: 'POST', cookie: a.cookie, body: {} }); assert.equal(logout.status, 204);
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).status, 401);
  } finally { await f.close(); }
});
test('real HTTP flow works with asynchronous database interface and redacts private state', async () => {
  const f = await setup({ asyncStore: true }); try {
    const a = await f.login(), t = await f.approved(a.cookie);
    const r = await execute(f, a.cookie, t); assert.equal(r.status, 200);
    assert.equal(r.body.payment, 'CONFIRMED'); assert.equal(r.body.delivery, 'COMPLETED'); assert.equal(r.body.reasonCode, 'REPORT_READY');
    assert.equal(f.counts().signs, 1); assert.equal(f.counts().redemptions, 1);
    const text = JSON.stringify(r.body); for (const value of ['scripted-private-proof', 'signedData', 'quoteData', 'deliveredBody', 'aiSnapshot']) assert.ok(!text.includes(value));
    assert.equal((await execute(f, a.cookie, t)).status, 409); assert.equal(f.counts().signs, 1);
    const list = await f.request('/api/tasks', { cookie: a.cookie }); assert.equal(list.body.tasks[0].id, t.id);
  } finally { await f.close(); }
});
test('over-budget and unauthorized recipient produce DENY without signing', async () => {
  const f = await setup(); try {
    const a = await f.login();
    for (const change of [{ budgetAtomic: '999' }, { allowedRecipient: keypair().address }]) {
      const t = await f.quoted(a.cookie); const r = await f.request(`/api/tasks/${t.id}/approve`, { method: 'POST', cookie: a.cookie,
        body: { quoteHash: t.quote.hash, budgetAtomic: '1000', expiresAt: new Date(f.now() + 60_000).toISOString(), acknowledge: true, ...change } });
      assert.equal(r.status, 403); const current = await f.request(`/api/tasks/${t.id}`, { cookie: a.cookie }); assert.equal(current.body.policy, 'DENY');
    }
    assert.equal(f.counts().signs, 0); assert.equal(f.counts().redemptions, 0);
  } finally { await f.close(); }
});
test('changed or expired approval cannot reach signing', async () => {
  const f = await setup(); try {
    const a = await f.login(), t = await f.approved(a.cookie); f.control.changed = true;
    assert.equal((await execute(f, a.cookie, t)).status, 409); assert.equal(f.counts().signs, 0);
    f.control.changed = false; f.advance(60_000);
    assert.equal((await execute(f, a.cookie, t)).status, 403); assert.equal(f.counts().signs, 0);
  } finally { await f.close(); }
});
test('concurrent execute atomically claims once and UNKNOWN cannot sign replacement', async () => {
  const f = await setup(); let unblock;
  try {
    const a = await f.login(), t = await f.approved(a.cookie);
    f.control.pause = new Promise(resolve => { unblock = resolve; });
    const first = execute(f, a.cookie, t);
    while (!f.counts().signs) await new Promise(resolve => setImmediate(resolve));
    const second = await execute(f, a.cookie, t); assert.equal(second.status, 409);
    f.control.outcome = { payment: 'UNKNOWN', delivery: 'PENDING', reasonCode: 'SETTLEMENT_UNKNOWN' }; unblock();
    const result = await first; assert.equal(result.body.payment, 'UNKNOWN');
    assert.equal((await execute(f, a.cookie, t)).status, 409); assert.equal(f.counts().signs, 1);
    const observe = await f.request(`/api/tasks/${t.id}/reconcile`, { method: 'POST', cookie: a.cookie, body: {} });
    assert.equal(observe.body.payment, 'CONFIRMED'); assert.equal(f.counts().signs, 1);
  } finally { unblock?.(); await f.close(); }
});
test('paid but undelivered recovery preserves payment and reuses original proof without signing', async () => {
  const f = await setup(); try {
    const a = await f.login(), t = await f.approved(a.cookie);
    f.control.outcome = { payment: 'CONFIRMED', delivery: 'FAILED', transaction: signature, reasonCode: 'RESOURCE_UNAVAILABLE' };
    const first = await execute(f, a.cookie, t); assert.equal(first.body.payment, 'CONFIRMED'); assert.equal(first.body.delivery, 'FAILED'); assert.equal(first.body.result, null);
    f.control.outcome = null;
    const recovered = await f.request(`/api/tasks/${t.id}/recover`, { method: 'POST', cookie: a.cookie, body: {} });
    assert.equal(recovered.body.delivery, 'COMPLETED'); assert.equal(recovered.body.reasonCode, 'REPORT_READY');
    assert.equal(f.counts().signs, 1); assert.equal(f.counts().redemptions, 2);
  } finally { await f.close(); }
});
test('revocation during signer preparation stops final signing and retains uncertain claim', async () => {
  const f = await setup(); try {
    const a = await f.login(), t = await f.approved(a.cookie);
    f.control.signHook = async () => { const r = await f.request(`/api/tasks/${t.id}/revoke`, { method: 'POST', cookie: a.cookie, body: {} }); assert.equal(r.status, 200); };
    assert.equal((await execute(f, a.cookie, t)).status, 403); assert.equal(f.counts().signs, 0); assert.equal(f.counts().redemptions, 0);
    const current = await f.request(`/api/tasks/${t.id}`, { cookie: a.cookie }); assert.equal(current.body.payment, 'UNKNOWN');
    assert.equal((await execute(f, a.cookie, t)).status, 409);
  } finally { await f.close(); }
});
test('revocation after signing blocks broadcast and keeps the original proof for observation', async () => {
  const f = await setup(); let unblock;
  try {
    const a = await f.login(), t = await f.approved(a.cookie);
    f.control.pause = new Promise(resolve => { unblock = resolve; });
    const executing = execute(f, a.cookie, t);
    while (!f.counts().signs) await new Promise(resolve => setImmediate(resolve));
    assert.equal((await f.request(`/api/tasks/${t.id}/revoke`, { method: 'POST', cookie: a.cookie, body: {} })).status, 200);
    unblock(); assert.equal((await executing).status, 403); assert.equal(f.counts().redemptions, 0);
    const current = f.rawStore.get(t.id, a.kp.address);
    assert.equal(current.payment, 'UNKNOWN'); assert.equal(current.signedData.paymentHeader, 'scripted-private-proof');
  } finally { unblock?.(); await f.close(); }
});
test('confirmation is monotonic when saved-proof recovery fails', async () => {
  const f = await setup(); try {
    const a = await f.login(), t = await f.approved(a.cookie);
    f.control.outcome = { payment: 'CONFIRMED', delivery: 'FAILED', transaction: signature, reasonCode: 'RESOURCE_UNAVAILABLE' };
    await execute(f, a.cookie, t);
    f.control.outcome = { payment: 'UNKNOWN', delivery: 'FAILED', reasonCode: 'RECONCILIATION_UNAVAILABLE' };
    const recovery = await f.request(`/api/tasks/${t.id}/recover`, { method: 'POST', cookie: a.cookie, body: {} });
    assert.equal(recovery.body.payment, 'CONFIRMED'); assert.equal(recovery.body.transaction, signature);
    assert.equal(recovery.body.delivery, 'FAILED'); assert.equal(f.counts().signs, 1);
  } finally { await f.close(); }
});
test('changed authority during analysis cannot publish a stale result', async () => {
  const f = await setup(); try {
    const a = await f.login(), t = await f.approved(a.cookie);
    f.control.aiHook = async () => { await f.request(`/api/tasks/${t.id}/revoke`, { method: 'POST', cookie: a.cookie, body: {} }); };
    assert.equal((await execute(f, a.cookie, t)).status, 409);
    const current = await f.request(`/api/tasks/${t.id}`, { cookie: a.cookie });
    assert.equal(current.body.payment, 'CONFIRMED'); assert.equal(current.body.delivery, 'COMPLETED'); assert.equal(current.body.result, null);
  } finally { await f.close(); }
});
test('logout while AI is awaited prevents result persistence and protected response', async () => {
  const f = await setup({ asyncStore: true }); try {
    const a = await f.login(), t = await f.approved(a.cookie);
    f.control.aiHook = async () => { await f.request('/api/auth/logout', { method: 'POST', cookie: a.cookie, body: {} }); };
    const response = await execute(f, a.cookie, t);
    assert.equal(response.status, 401); assert.deepEqual(response.body, { error: { code: 'AUTHENTICATION_REQUIRED' } });
    const persisted = f.rawStore.get(t.id, a.kp.address);
    assert.equal(persisted.result, null); assert.equal(persisted.payment, 'CONFIRMED'); assert.equal(persisted.delivery, 'COMPLETED');
    assert.equal(f.counts().signs, 1);
  } finally { await f.close(); }
});
test('session expiry during AI await prevents result persistence and response', async () => {
  const f = await setup({ sessionTtlMs: 1000 }); try {
    const a = await f.login(), t = await f.approved(a.cookie);
    f.control.aiHook = async () => { f.advance(1000); };
    const response = await execute(f, a.cookie, t);
    assert.equal(response.status, 401);
    const persisted = f.rawStore.get(t.id, a.kp.address);
    assert.equal(persisted.result, null); assert.equal(persisted.payment, 'CONFIRMED'); assert.equal(persisted.delivery, 'COMPLETED');
  } finally { await f.close(); }
});
test('logout during gateway redemption preserves payment facts and stops model access', async () => {
  const f = await setup(); try {
    const a = await f.login(), t = await f.approved(a.cookie);
    f.control.redeemHook = async () => { await f.request('/api/auth/logout', { method: 'POST', cookie: a.cookie, body: {} }); };
    assert.equal((await execute(f, a.cookie, t)).status, 401);
    const persisted = f.rawStore.get(t.id, a.kp.address);
    assert.equal(persisted.payment, 'CONFIRMED'); assert.equal(persisted.delivery, 'COMPLETED'); assert.equal(persisted.result, null);
    assert.equal(f.counts().consumes, 0);
  } finally { await f.close(); }
});
test('logout during reconciliation records the chain outcome without exposing snapshot', async () => {
  const f = await setup(); try {
    const a = await f.login(), t = await f.approved(a.cookie);
    f.control.outcome = { payment: 'UNKNOWN', delivery: 'PENDING', reasonCode: 'SETTLEMENT_UNKNOWN' };
    await execute(f, a.cookie, t);
    f.control.reconcileHook = async () => { await f.request('/api/auth/logout', { method: 'POST', cookie: a.cookie, body: {} }); };
    const response = await f.request(`/api/tasks/${t.id}/reconcile`, { method: 'POST', cookie: a.cookie, body: {} });
    assert.equal(response.status, 401); assert.equal(response.body.transaction, undefined);
    assert.equal(f.rawStore.get(t.id, a.kp.address).payment, 'CONFIRMED'); assert.equal(f.counts().signs, 1);
  } finally { await f.close(); }
});
test('logout during saved-proof recovery records delivery but releases no result', async () => {
  const f = await setup(); try {
    const a = await f.login(), t = await f.approved(a.cookie);
    f.control.outcome = { payment: 'CONFIRMED', delivery: 'FAILED', transaction: signature, reasonCode: 'RESOURCE_UNAVAILABLE' };
    await execute(f, a.cookie, t); f.control.outcome = null;
    f.control.redeemHook = async () => { await f.request('/api/auth/logout', { method: 'POST', cookie: a.cookie, body: {} }); };
    const response = await f.request(`/api/tasks/${t.id}/recover`, { method: 'POST', cookie: a.cookie, body: {} });
    assert.equal(response.status, 401);
    const persisted = f.rawStore.get(t.id, a.kp.address);
    assert.equal(persisted.payment, 'CONFIRMED'); assert.equal(persisted.delivery, 'COMPLETED'); assert.equal(persisted.result, null);
    assert.equal(f.counts().signs, 1); assert.equal(f.counts().consumes, 0);
  } finally { await f.close(); }
});
test('logout while a protected task lookup is awaited prevents its release', async () => {
  const f = await setup(); try {
    const a = await f.login(), t = await f.task(a.cookie), get = f.rawStore.get.bind(f.rawStore);
    f.rawStore.get = async (...args) => {
      const value = get(...args); await f.request('/api/auth/logout', { method: 'POST', cookie: a.cookie, body: {} }); return value;
    };
    assert.equal((await f.request(`/api/tasks/${t.id}`, { cookie: a.cookie })).status, 401);
    f.rawStore.get = get;
  } finally { await f.close(); }
});
test('health does not assert readiness when the state database is unavailable', async () => {
  const f = await setup(); try {
    assert.equal((await f.request('/api/health')).body.ready, true);
    f.rawStore.list = () => { throw new Error('private-database-diagnostic'); };
    const health = await f.request('/api/health');
    assert.equal(health.status, 200); assert.equal(health.body.ready, false); assert.equal(health.body.databaseReady, false);
    assert.ok(health.body.missing.includes('DATABASE_CONNECTION'));
    assert.doesNotMatch(JSON.stringify(health.body), /private-database-diagnostic/);
  } finally { await f.close(); }
});
test('expiry during the session database await is checked against the current clock', async () => {
  const f = await setup({ sessionTtlMs: 1000 }); try {
    const a = await f.login(), session = f.rawStore.session.bind(f.rawStore);
    f.rawStore.session = async value => { const result = session(value); f.advance(1000); return result; };
    const response = await f.request('/api/session', { cookie: a.cookie });
    assert.equal(response.status, 401); assert.equal(response.body.wallet, undefined);
  } finally { await f.close(); }
});
