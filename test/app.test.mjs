import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { getBase58Decoder } from '@solana/kit';
import { createApp } from '../service/app.mjs';
import { Store } from '../service/store.mjs';
import { loadConfig, ServiceError } from '../service/config.mjs';

function keypair() {
  const kp = generateKeyPairSync('ed25519'); return { ...kp,
    address: getBase58Decoder().decode(kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)) };
}
const signature = getBase58Decoder().decode(Uint8Array.from({ length: 64 }, (_, i) => i + 1));
async function setup({ asyncStore = false, sessionTtlMs = 8 * 3600_000, taskHooks, mountWorkspace,
  maxConcurrentOperations = 4, maxOwnerConcurrentOperations = 2 } = {}) {
  let time = Date.UTC(2026, 10, 5, 12), signs = 0, redemptions = 0, gets = 0, consumes = 0;
  const rawStore = new Store(':memory:', { clock: () => time });
  const store = asyncStore ? new Proxy(rawStore, { get(obj, prop) {
    const value = obj[prop]; if (typeof value !== 'function') return value;
    return ['clock', 'event'].includes(prop) ? value.bind(obj) : async (...args) => value.apply(obj, args);
  } }) : rawStore;
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, payer = keypair().address;
  const config = { ...loadConfig({ MERCHANT_PAY_TO: keypair().address }), origin, publicOrigin: origin,
    merchantOrigin: origin, merchantBaseUrl: origin + '/merchant/reports', paymentEnabled: true, sessionTtlMs,
    maxConcurrentOperations, maxOwnerConcurrentOperations };
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
  server.on('request', createApp({ config, store, gateway, ai, taskHooks, mountWorkspace,
    adapterStatus: { workspaceAdapterReady: true, reportAdapterReady: true } }));
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
    assert.equal(response.status, 401); assert.equal(response.body.error.code, 'AUTHENTICATION_REQUIRED');
    assert.equal(response.body.error.requestId, response.headers.get('x-request-id'));
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

test('task creation retry is owner-scoped, body-bound and atomic without duplicate events', async () => {
  const f = await setup({ asyncStore: true }); try {
    const a = await f.login(), b = await f.login();
    const body = { purpose: 'Retry-safe transfer report', wallet: a.kp.address,
      windowStart: '2026-11-04T00:00:00.000Z', windowEnd: '2026-11-05T00:00:00.000Z' };
    const request = (cookie, value = body) => f.request('/api/tasks', { method: 'POST', cookie, body: value,
      headers: { 'Idempotency-Key': 'request-123' } });
    const replies = await Promise.all(Array.from({ length: 8 }, () => request(a.cookie)));
    assert.ok(replies.every(reply => reply.status === 201));
    assert.equal(new Set(replies.map(reply => reply.body.id)).size, 1);
    assert.equal(f.rawStore.list(a.kp.address).length, 1);
    assert.equal(replies[0].body.events.filter(event => event.type === 'TASK_CREATED').length, 1);
    const changed = await request(a.cookie, { ...body, purpose: 'different purpose' });
    assert.equal(changed.status, 409); assert.equal(changed.body.error.code, 'IDEMPOTENCY_CONFLICT');
    const other = await request(b.cookie); assert.equal(other.status, 201); assert.notEqual(other.body.id, replies[0].body.id);
    const malformed = await f.request('/api/tasks', { method: 'POST', cookie: a.cookie, body,
      headers: { 'Idempotency-Key': 'bad key' } });
    assert.equal(malformed.status, 400); assert.equal(f.counts().signs, 0);
  } finally { await f.close(); }
});
test('history uses bounded summaries and lazy details even when saved reports exceed the browser limit', async () => {
  const f = await setup(); try {
    const a = await f.login(), b = await f.login();
    for (let i = 0; i < 35; i++) f.rawStore.add({ id: 'history-' + String(i).padStart(3, '0'), owner: a.kp.address,
      purpose: 'Report ' + i, payment: 'CONFIRMED', delivery: 'COMPLETED', events: [],
      result: { answer: { summary: 'fixture only' }, html: 'large-report'.repeat(5000), markdown: 'private-report'.repeat(5000) },
      signedData: { paymentHeader: 'private-proof' }, deliveredBody: 'private-merchant-body' });
    const first = await f.request('/api/tasks', { cookie: a.cookie });
    assert.equal(first.status, 200); assert.equal(first.body.tasks.length, 20); assert.ok(first.body.nextCursor);
    assert.ok(first.body.tasks.every(task => task.resultAvailable));
    assert.ok(JSON.stringify(first.body).length < 30000);
    assert.doesNotMatch(JSON.stringify(first.body), /private-proof|private-merchant|large-report|private-report|"result"|"html"/);
    const next = await f.request('/api/tasks?cursor=' + first.body.nextCursor, { cookie: a.cookie });
    assert.equal(next.body.tasks.length, 15); assert.equal(next.body.nextCursor, null);
    assert.equal(new Set([...first.body.tasks, ...next.body.tasks].map(task => task.id)).size, 35);
    const detail = await f.request('/api/tasks/' + first.body.tasks[0].id, { cookie: a.cookie });
    assert.equal(detail.body.result.answer.summary, 'fixture only'); assert.match(detail.body.result.html, /large-report/);
    assert.equal((await f.request('/api/tasks?cursor=' + first.body.nextCursor, { cookie: b.cookie })).status, 400);
    assert.equal((await f.request('/api/tasks?limit=51', { cookie: a.cookie })).status, 400);
    assert.equal((await f.request('/api/tasks?limit=0', { cookie: a.cookie })).status, 400);
    assert.equal((await f.request('/api/tasks?includeArchived=yes', { cookie: a.cookie })).status, 400);
    assert.equal((await f.request('/api/tasks?limit=20&limit=30', { cookie: a.cookie })).status, 400);
  } finally { await f.close(); }
});
test('archive preserves private evidence, refuses uncertainty and separates active capacity from history', async () => {
  const f = await setup(); try {
    const a = await f.login(), b = await f.login(), t = await f.approved(a.cookie);
    const path = '/api/tasks/' + t.id;
    assert.equal((await f.request(path + '/archive', { method: 'POST', cookie: b.cookie, body: { acknowledge: true } })).status, 404);
    f.control.outcome = { payment: 'UNKNOWN', delivery: 'PENDING', reasonCode: 'SETTLEMENT_UNKNOWN' };
    await execute(f, a.cookie, t);
    const unresolved = await f.request(path + '/archive', { method: 'POST', cookie: a.cookie, body: { acknowledge: true } });
    assert.equal(unresolved.status, 409); assert.equal(unresolved.body.error.code, 'TASK_UNRESOLVED');
    await f.request(path + '/reconcile', { method: 'POST', cookie: a.cookie, body: {} });
    assert.equal((await f.request(path + '/archive', { method: 'POST', cookie: a.cookie, body: { acknowledge: true } })).status, 409);
    f.control.outcome = null; await f.request(path + '/recover', { method: 'POST', cookie: a.cookie, body: {} });
    const archived = await f.request(path + '/archive', { method: 'POST', cookie: a.cookie, body: { acknowledge: true } });
    assert.equal(archived.status, 200); assert.ok(archived.body.archivedAt);
    assert.equal((await f.request('/api/tasks', { cookie: a.cookie })).body.tasks.length, 0);
    assert.equal((await f.request('/api/tasks?includeArchived=true', { cookie: a.cookie })).body.tasks.length, 1);
    assert.equal(f.rawStore.get(t.id, a.kp.address).signedData.paymentHeader, 'scripted-private-proof');
    const restored = await f.request(path + '/restore', { method: 'POST', cookie: a.cookie, body: {} });
    assert.equal(restored.status, 200); assert.equal(restored.body.archivedAt, null); assert.equal(f.counts().signs, 1);
    const untouched = await f.approved(a.cookie);
    await f.request('/api/tasks/' + untouched.id + '/archive', { method: 'POST', cookie: a.cookie, body: { acknowledge: true } });
    assert.equal((await execute(f, a.cookie, untouched)).body.error.code, 'TASK_ARCHIVED');
    assert.equal(f.counts().signs, 1);
  } finally { await f.close(); }
});
test('server request IDs are returned on errors and never trust an incoming identifier', async () => {
  const f = await setup(); try {
    const a = await f.request('/api/tasks', { headers: { 'X-Request-ID': 'attacker-chosen-value' } });
    const b = await f.request('/missing');
    for (const r of [a, b]) {
      assert.match(r.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
      assert.equal(r.body.error.requestId, r.headers.get('x-request-id'));
    }
    assert.notEqual(a.body.error.requestId, b.body.error.requestId);
    assert.notEqual(a.body.error.requestId, 'attacker-chosen-value');
  } finally { await f.close(); }
});
test('operation admission bounds each owner and the process and releases slots after completion', async () => {
  const f = await setup({ maxConcurrentOperations: 2, maxOwnerConcurrentOperations: 1 }); let unblock;
  try {
    const a = await f.login(), b = await f.login(), c = await f.login();
    const one = await f.approved(a.cookie), two = await f.approved(a.cookie), three = await f.approved(b.cookie), queued = await f.task(c.cookie);
    const gate = new Promise(resolve => { unblock = resolve; }); let entered = 0;
    f.control.signHook = async () => { entered++; await gate; };
    const first = execute(f, a.cookie, one);
    while (entered < 1) await new Promise(resolve => setImmediate(resolve));
    const ownerLimit = await execute(f, a.cookie, two);
    assert.equal(ownerLimit.status, 429); assert.equal(ownerLimit.headers.get('retry-after'), '1');
    const second = execute(f, b.cookie, three);
    while (entered < 2) await new Promise(resolve => setImmediate(resolve));
    const globalLimit = await f.request('/api/tasks/' + queued.id + '/quote', { method: 'POST', cookie: c.cookie, body: {} });
    assert.equal(globalLimit.status, 429); assert.equal(globalLimit.body.error.code, 'OPERATION_LIMIT_REACHED');
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).status, 200);
    unblock(); assert.ok((await Promise.all([first, second])).every(reply => reply.status === 200));
    f.control.signHook = null; assert.equal((await execute(f, a.cookie, two)).status, 200);
    assert.equal(f.counts().signs, 3);
  } finally { unblock?.(); await f.close(); }
});
test('claim and signer hooks fail closed and observed facts run before session-protected result release', async () => {
  let denied = true, revoke = false; const observations = []; let f, actor;
  const hooks = {
    beforeClaim: async ({ task, owner }) => {
      assert.equal(owner, actor.kp.address); assert.equal(task.payment, 'NOT_STARTED');
      if (denied) throw new ServiceError('GLOBAL_BUDGET_DENIED', 403);
    },
    beforeSign: async ({ task, owner }) => {
      assert.equal(task.payment, 'SIGNING');
      if (revoke) f.rawStore.mutate(task.id, owner, current => { current.approval.revoked = true; });
    },
    observed: async ({ task, owner }) => { observations.push({ payment: task.payment, owner }); },
  };
  f = await setup({ taskHooks: hooks }); try {
    actor = await f.login(); const t = await f.approved(actor.cookie);
    assert.equal((await execute(f, actor.cookie, t)).body.error.code, 'GLOBAL_BUDGET_DENIED');
    assert.equal(f.counts().signs, 0); assert.equal(f.rawStore.get(t.id, actor.kp.address).attemptRef, undefined);
    denied = false; revoke = true;
    assert.equal((await execute(f, actor.cookie, t)).status, 403); assert.equal(f.counts().signs, 0);
    assert.equal(f.rawStore.get(t.id, actor.kp.address).payment, 'UNKNOWN');
    revoke = false; const next = await f.approved(actor.cookie);
    f.control.redeemHook = () => f.request('/api/auth/logout', { method: 'POST', cookie: actor.cookie, body: {} });
    assert.equal((await execute(f, actor.cookie, next)).status, 401);
    assert.deepEqual(observations, [{ payment: 'CONFIRMED', owner: actor.kp.address }]);
    assert.equal(f.rawStore.get(next.id, actor.kp.address).payment, 'CONFIRMED'); assert.equal(f.counts().consumes, 0);
  } finally { await f.close(); }
});
test('workspace extension inherits guards, immutable server metadata and bounded execution port', async () => {
  let context;
  const f = await setup({ mountWorkspace: (app, value) => {
    context = value;
    app.get('/api/workspace-contract', async (req, res) => {
      const owner = (await value.auth(req)).wallet;
      await value.assertSession(req, owner); res.json(await value.store.dashboard(owner));
    });
  } }); try {
    const a = await f.login(); assert.equal((await f.request('/api/workspace-contract')).status, 401);
    assert.equal((await f.request('/api/workspace-contract', { cookie: a.cookie })).body.total, 0);
    const input = { purpose: 'Confirmed plan', wallet: a.kp.address,
      windowStart: '2026-11-04T00:00:00.000Z', windowEnd: '2026-11-05T00:00:00.000Z' };
    const metadata = { conversationId: 'conversation-1', planHash: 'a'.repeat(64), intentRevision: 1,
      resourceId: 'wallet-transfers', mandateId: null, mandateVersion: null };
    const task = context.makeTask(input, a.kp.address, context.now(), metadata);
    context.store.add(task); assert.equal(typeof context.withOperation, 'function');
    const detail = await f.request('/api/tasks/' + task.id, { cookie: a.cookie });
    assert.deepEqual(detail.body.workspaceContext, metadata);
    assert.throws(() => context.store.mutate(task.id, a.kp.address, current => { current.workspaceContext.intentRevision++; }), /TASK_IDENTITY_CHANGED/);
    assert.equal((await f.request('/api/tasks', { method: 'POST', cookie: a.cookie, body: { ...input, workspaceContext: metadata } })).status, 400);
  } finally { await f.close(); }
});
