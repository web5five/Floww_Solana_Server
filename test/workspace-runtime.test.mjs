/** Real buildRuntime/auth/SQLite wiring; every financial/model transport is scripted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { getBase58Decoder } from '@solana/kit';
import { buildRuntime } from '../service/main.mjs';
import { Store } from '../service/store.mjs';
import { loadConfig } from '../service/config.mjs';

const scope = wallet => ({ purpose: 'Observe transfer activity', wallet,
  windowStart: '2026-11-04T00:00:00.000Z', windowEnd: '2026-11-05T00:00:00.000Z' });
const transaction = getBase58Decoder().decode(new Uint8Array(64).fill(7));
function pair() {
  const value = generateKeyPairSync('ed25519');
  return { ...value, wallet: getBase58Decoder().decode(value.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)) };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }
async function fixture(env = {}) {
  let now = Date.UTC(2026, 10, 6, 12), signs = 0, redemptions = 0, reconciles = 0, refines = 0, plans = 0;
  const control = { preSign: null, refineHook: null, unknown: false };
  const store = new Store(':memory:', { clock: () => now }), payer = pair().wallet;
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const config = { ...loadConfig({ FLOWW_PUBLIC_ORIGIN: origin, MERCHANT_PAY_TO: pair().wallet,
    FLOWW_ENABLE_DEVNET_PAYMENTS: 'true', FLOWW_MAX_PAYMENT_ATOMIC: '3000', FLOWW_DAILY_PAYMENT_ATOMIC: '1000',
    ...env }), model: 'runtime-fixture-model', apiKey: 'dummy-runtime-key-never-used-for-network' };
  let runtime;
  const forbidden = async () => { assert.fail('No external transport is authorized in runtime tests'); };
  const gateway = {
    readiness: async () => ({ ready: config.paymentEnabled, payer, missing: config.paymentEnabled ? [] : ['payment_enabled'] }),
    quote: async url => {
      const requirements = { scheme: 'exact', network: config.network, asset: config.asset, amount: config.amountAtomic,
        payTo: config.merchantPayTo, maxTimeoutSeconds: 120, extra: { feePayer: payer } };
      return { resourceUrl: url, requirements, paymentRequired: { x402Version: 2, resource: { url }, accepts: [requirements] } };
    },
    sign: async (quote, { beforeSign }) => {
      const taskId = new URL(quote.resourceUrl).pathname.split('/').at(-1);
      const reservations = store.db.prepare('SELECT data FROM workspace_reservations WHERE task_id=?').all(taskId);
      assert.equal(reservations.length, 1); assert.equal(JSON.parse(reservations[0].data).state, 'HELD');
      await control.preSign?.(); await beforeSign(); signs++;
      return { paymentHeader: 'scripted-runtime-private-proof', payer, signature: null, messageHash: 'b'.repeat(64),
        requirements: quote.requirements, resourceUrl: quote.resourceUrl };
    },
    redeem: async (_url, signed) => {
      redemptions++; assert.equal(signed.paymentHeader, 'scripted-runtime-private-proof');
      return control.unknown ? { payment: 'UNKNOWN', delivery: 'PENDING', reasonCode: 'SCRIPTED_UNKNOWN' }
        : { payment: 'CONFIRMED', delivery: 'COMPLETED', transaction, body: '{}', reasonCode: 'SCRIPTED_CONFIRMED' };
    },
    reconcile: async () => { reconciles++; return { payment: 'CONFIRMED', transaction }; },
  };
  const ai = {
    propose: async () => ({ status: 'PROPOSED', code: 'BACKEND_REVIEW_REQUIRED', proposal_ref: 'runtime-proposal' }),
    consume: async () => ({ status: 'EVIDENCE_READY', code: 'ANALYTICS_SUMMARY', answer: { is_synthetic: true, summary: 'Runtime fixture only' } }),
  };
  const planner = {
    refine: async input => {
      refines++; await control.refineHook?.();
      const intent = { ...input.intent, purpose: input.intent.purpose ?? 'Observe transfer activity' };
      intent.missingFields = ['purpose', 'wallet', 'windowStart', 'windowEnd'].filter(key => !intent[key]);
      return { status: intent.missingFields.length ? 'CLARIFICATION_REQUIRED' : 'READY_TO_PLAN', assistantText: 'Runtime fixture only', intent,
        executionKind: 'live_model_intent_refinement', modelVersion: config.model, promptVersion: 'workspace/v3' };
    },
    plan: async () => {
      plans++; return { status: 'PROPOSED', summary: 'Runtime fixture only', limitations: ['Scripted test'],
        steps: [{ role: 'planner', capability: 'wallet-transfers', resourceId: 'wallet-transfers', reason: 'Explicit wallet/window' }],
        executionKind: 'live_model_planner_critic', modelVersion: config.model, promptVersion: 'workspace/v3' };
    },
  };
  try {
    runtime = await buildRuntime({ config, store, gateway, ai, planner, rpc: forbidden, reportProvider: forbidden,
      adapterStatus: { workspaceAdapterReady: true, reportAdapterReady: true },
      mountMerchant: () => ({ initialize: forbidden }) });
  } catch (error) { await new Promise(resolve => server.close(resolve)); store.close(); throw error; }
  server.on('request', runtime.app);
  async function request(path, { cookie, method = 'GET', body } = {}) {
    const response = await fetch(origin + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}),
      ...(method !== 'GET' ? { Origin: origin, 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
  }
  async function login() {
    const actor = pair(), challenge = await request('/api/auth/challenge', { method: 'POST', body: { wallet: actor.wallet } });
    const verified = await request('/api/auth/verify', { method: 'POST', body: { wallet: actor.wallet, challengeId: challenge.body.challengeId,
      signature: sign(null, Buffer.from(challenge.body.message), actor.privateKey).toString('base64') } });
    assert.equal(verified.status, 200); return { wallet: actor.wallet, cookie: verified.headers.get('set-cookie').split(';')[0] };
  }
  async function create(actor) {
    const response = await request('/api/tasks', { cookie: actor.cookie, method: 'POST', body: scope(actor.wallet) });
    assert.equal(response.status, 201); return response.body;
  }
  async function approve(actor, task) {
    const quote = await request(`/api/tasks/${task.id}/quote`, { cookie: actor.cookie, method: 'POST', body: {} });
    assert.equal(quote.status, 200);
    const response = await request(`/api/tasks/${task.id}/approve`, { cookie: actor.cookie, method: 'POST', body: {
      quoteHash: quote.body.quote.hash, budgetAtomic: quote.body.quote.amountAtomic, acknowledge: true,
      expiresAt: new Date(now + 60000).toISOString() } });
    assert.equal(response.status, 200); return response.body;
  }
  const execute = (actor, task) => request(`/api/tasks/${task.id}/execute`, { cookie: actor.cookie, method: 'POST', body: { approvalId: task.approval.id } });
  async function conversation(actor) {
    const response = await request('/api/conversations', { cookie: actor.cookie, method: 'POST', body: {} });
    assert.equal(response.status, 201); return response.body;
  }
  const message = (actor, record, id = randomUUID()) => request(`/api/conversations/${record.id}/messages`, { cookie: actor.cookie,
    method: 'POST', body: { clientRequestId: id, expectedRevision: record.revision, text: 'Observe transfer activity',
      scope: { wallet: actor.wallet, windowStart: scope(actor.wallet).windowStart, windowEnd: scope(actor.wallet).windowEnd } } });
  return { runtime, store, control, request, login, create, approve, execute, conversation, message,
    counts: () => ({ signs, redemptions, reconciles, refines, plans }), now: () => now,
    close: async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); store.close(); } };
}

test('buildRuntime wires durable reservation before signing and spends once after core facts', async () => {
  const f = await fixture(); try {
    const actor = await f.login(); assert.equal((await f.request('/api/health')).body.ready, true);
    const task = await f.approve(actor, await f.create(actor)), result = await f.execute(actor, task);
    assert.equal(result.status, 200); assert.equal(result.body.payment, 'CONFIRMED'); assert.equal(result.body.delivery, 'COMPLETED');
    const dashboard = await f.request('/api/dashboard', { cookie: actor.cookie });
    assert.equal(dashboard.body.tasks.resultAvailable, 1);
    assert.equal(dashboard.body.budget.spentAtomic, '1000'); assert.equal(dashboard.body.budget.heldAtomic, '0');
    assert.equal(dashboard.body.budget.reservations[0].state, 'SPENT');
    const next = await f.approve(actor, await f.create(actor)), denied = await f.execute(actor, next);
    assert.equal(denied.status, 403); assert.equal(denied.body.error.code, 'DAILY_BUDGET_EXCEEDED');
    assert.equal(f.store.get(next.id, actor.wallet).payment, 'NOT_STARTED');
    assert.equal(f.store.get(next.id, actor.wallet).attemptRef, undefined); assert.equal(f.counts().signs, 1);
    assert.doesNotMatch(JSON.stringify(dashboard.body), /scripted-runtime-private-proof|messageHash|paymentHeader/);
  } finally { await f.close(); }
});
test('runtime final signer hook rereads mandate revocation after SDK preparation', async () => {
  const f = await fixture(); try {
    const actor = await f.login(), record = await f.conversation(actor), refined = await f.message(actor, record);
    assert.equal(refined.status, 200);
    const planned = await f.request(`/api/conversations/${record.id}/plan`, { cookie: actor.cookie, method: 'POST',
      body: { clientRequestId: randomUUID(), expectedRevision: refined.body.revision } });
    assert.equal(planned.status, 200);
    const mandate = await f.request('/api/mandates', { cookie: actor.cookie, method: 'POST', body: {
      ...scope(actor.wallet), budgetAtomic: '1000', perPurchaseAtomic: '1000', maxExecutions: 1,
      expiresAt: new Date(f.now() + 3600000).toISOString(), acknowledge: true } });
    assert.equal(mandate.status, 201);
    const linked = await f.request(`/api/conversations/${record.id}/confirm`, { cookie: actor.cookie, method: 'POST', body: {
      expectedRevision: planned.body.revision, planHash: planned.body.plan.hash, wallet: actor.wallet,
      windowStart: scope(actor.wallet).windowStart, windowEnd: scope(actor.wallet).windowEnd,
      mandateId: mandate.body.id, acknowledge: true } });
    assert.equal(linked.status, 201);
    const task = await f.approve(actor, linked.body);
    f.control.preSign = async () => {
      const result = await f.request(`/api/mandates/${mandate.body.id}/revoke`, { cookie: actor.cookie, method: 'POST', body: { expectedVersion: 1 } });
      assert.equal(result.status, 200);
    };
    const denied = await f.execute(actor, task);
    assert.equal(denied.status, 403); assert.equal(denied.body.error.code, 'MANDATE_NOT_ACTIVE');
    assert.equal(f.counts().signs, 0); assert.equal(f.counts().redemptions, 0);
    assert.equal(f.store.get(task.id, actor.wallet).payment, 'UNKNOWN');
    const budget = await f.runtime.mandates.dashboard(actor.wallet);
    assert.equal(budget.heldAtomic, '1000'); assert.equal(budget.spentAtomic, '0');
  } finally { await f.close(); }
});
test('runtime health fails closed on unreserved legacy attempts while original reconciliation remains usable', async () => {
  const f = await fixture(); try {
    const actor = await f.login(), task = await f.approve(actor, await f.create(actor)), next = await f.approve(actor, await f.create(actor));
    f.control.unknown = true; assert.equal((await f.execute(actor, task)).body.payment, 'UNKNOWN');
    f.store.add({ id: randomUUID(), owner: pair().wallet, events: [], payment: 'UNKNOWN', delivery: 'PENDING',
      attemptRef: randomUUID(), signedData: { paymentHeader: 'private-unreserved-legacy-proof' } });
    const health = await f.request('/api/health');
    assert.equal(health.status, 200); assert.equal(health.body.ready, false);
    assert.ok(health.body.missing.includes('LEDGER_IMPORT_REQUIRED'));
    assert.doesNotMatch(JSON.stringify(health.body), /private-unreserved|attemptRef|paymentHeader/);
    assert.equal((await f.execute(actor, next)).status, 503); assert.equal(f.counts().signs, 1);
    const observed = await f.request(`/api/tasks/${task.id}/reconcile`, { cookie: actor.cookie, method: 'POST', body: {} });
    assert.equal(observed.status, 200); assert.equal(observed.body.payment, 'CONFIRMED');
    const budget = await f.runtime.mandates.dashboard(actor.wallet);
    assert.equal(budget.spentAtomic, '1000'); assert.equal(budget.heldAtomic, '0'); assert.equal(f.counts().reconciles, 1);
  } finally { await f.close(); }
});
test('configured model quotas apply across owners through real runtime workspace routes', async () => {
  const f = await fixture({ FLOWW_MODEL_DAILY_CALLS: '3', FLOWW_MODEL_OWNER_DAILY_CALLS: '2' }); try {
    const a = await f.login(), b = await f.login();
    assert.equal((await f.message(a, await f.conversation(a))).status, 200);
    assert.equal((await f.message(a, await f.conversation(a))).status, 200);
    const ownerLimit = await f.message(a, await f.conversation(a));
    assert.equal(ownerLimit.status, 429); assert.equal(ownerLimit.body.error.code, 'MODEL_DAILY_LIMIT');
    assert.equal((await f.message(b, await f.conversation(b))).status, 200);
    const globalLimit = await f.message(b, await f.conversation(b));
    assert.equal(globalLimit.status, 429); assert.equal(globalLimit.body.error.code, 'MODEL_DAILY_LIMIT');
    assert.equal(f.counts().refines, 3); assert.equal(f.counts().plans, 0); assert.equal(f.counts().signs, 0);
  } finally { await f.close(); }
});
test('runtime operation limits bound workspace work and return Retry-After without blocking session checks', async () => {
  const f = await fixture({ FLOWW_MAX_OPERATIONS: '1', FLOWW_MAX_OWNER_OPERATIONS: '1' }), entered = deferred(), release = deferred(); let first;
  try {
    const a = await f.login(), b = await f.login(), one = await f.conversation(a), two = await f.conversation(b);
    f.control.refineHook = async () => { entered.resolve(); await release.promise; };
    first = f.message(a, one); await entered.promise;
    const denied = await f.message(b, two); assert.equal(denied.status, 429); assert.equal(denied.headers.get('retry-after'), '1');
    assert.equal(denied.body.error.code, 'OPERATION_LIMIT_REACHED');
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).status, 200);
    release.resolve(); assert.equal((await first).status, 200);
    f.control.refineHook = null; assert.equal((await f.message(b, two)).status, 200);
    assert.equal(f.counts().refines, 2);
  } finally { release.resolve(); if (first) await first.catch(() => {}); await f.close(); }
});
test('disabled runtime never reads a configured payer file and retains explicit unready state', async () => {
  const f = await fixture({ FLOWW_ENABLE_DEVNET_PAYMENTS: 'false', FLOWW_PAYER_KEY_FILE: '/runtime-fixture-not-a-real-key-file' });
  try {
    assert.equal(f.runtime.config.payerPrivateKey, null);
    const health = await f.request('/api/health'); assert.equal(health.body.ready, false);
    assert.ok(health.body.missing.includes('FLOWW_ENABLE_DEVNET_PAYMENTS'));
  } finally { await f.close(); }
});
test('quota and concurrency environment settings reject invalid bounds before runtime initialization', () => {
  const base = { FLOWW_MAX_PAYMENT_ATOMIC: '1000' };
  for (const [key, values] of Object.entries({ FLOWW_MAX_OPERATIONS: ['0', '-1', '33', '1.5', 'NaN', 'Infinity', ''],
    FLOWW_MAX_OWNER_OPERATIONS: ['0', '5', '1.5'], FLOWW_MODEL_DAILY_CALLS: ['0', '1001', '1.5', 'NaN'],
    FLOWW_MODEL_OWNER_DAILY_CALLS: ['0', '61', '1.5'], FLOWW_DAILY_PAYMENT_ATOMIC: ['0', '1001', '1e3', '-1'] })) {
    for (const value of values) assert.throws(() => loadConfig({ ...base, [key]: value }),
      error => ['INVALID_CONFIGURATION', 'INVALID_AMOUNT'].includes(error.code));
  }
  const config = loadConfig({ ...base, FLOWW_MAX_OPERATIONS: '2', FLOWW_MAX_OWNER_OPERATIONS: '1',
    FLOWW_MODEL_DAILY_CALLS: '3', FLOWW_MODEL_OWNER_DAILY_CALLS: '2', FLOWW_DAILY_PAYMENT_ATOMIC: '500' });
  assert.equal(config.maxConcurrentOperations, 2); assert.equal(config.maxOwnerConcurrentOperations, 1);
  assert.equal(config.globalModelDailyLimit, 3); assert.equal(config.ownerModelDailyLimit, 2); assert.equal(config.dailyPaymentAtomic, '500');
});

test('confirmation rejects an unrelated active mandate before locking the plan and accepts a corrected selection', async () => {
  const f = await fixture(); try {
    const actor = await f.login(), record = await f.conversation(actor), refined = await f.message(actor, record);
    const planned = await f.request(`/api/conversations/${record.id}/plan`, { cookie: actor.cookie, method: 'POST',
      body: { clientRequestId: randomUUID(), expectedRevision: refined.body.revision } });
    assert.equal(planned.status, 200);
    const mandate = wallet => f.request('/api/mandates', { cookie: actor.cookie, method: 'POST', body: {
      ...scope(wallet), budgetAtomic: '1000', perPurchaseAtomic: '1000', maxExecutions: 1,
      expiresAt: new Date(f.now() + 3600000).toISOString(), acknowledge: true } });
    const unrelated = await mandate(pair().wallet); assert.equal(unrelated.status, 201); assert.equal(unrelated.body.status, 'ACTIVE');
    const body = { expectedRevision: planned.body.revision, planHash: planned.body.plan.hash,
      wallet: actor.wallet, windowStart: scope(actor.wallet).windowStart, windowEnd: scope(actor.wallet).windowEnd, acknowledge: true };
    const denied = await f.request(`/api/conversations/${record.id}/confirm`, { cookie: actor.cookie, method: 'POST',
      body: { ...body, mandateId: unrelated.body.id } });
    assert.equal(denied.status, 409); assert.equal(denied.body.error.code, 'MANDATE_SCOPE_DENIED');
    const current = await f.request(`/api/conversations/${record.id}`, { cookie: actor.cookie });
    assert.equal(current.body.planLocked, false); assert.equal(current.body.linkedTaskId, null);
    assert.equal((await f.runtime.store.dashboard(actor.wallet)).total, 0);
    const correct = await mandate(actor.wallet);
    const linked = await f.request(`/api/conversations/${record.id}/confirm`, { cookie: actor.cookie, method: 'POST',
      body: { ...body, expectedRevision: current.body.revision, mandateId: correct.body.id } });
    assert.equal(linked.status, 201); assert.equal(linked.body.workspaceContext.mandateId, correct.body.id);
    assert.equal(f.counts().signs, 0); assert.equal(f.counts().redemptions, 0);
  } finally { await f.close(); }
});
