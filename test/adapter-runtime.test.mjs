/** Actual HTTP/auth/SQLite/ledger; model and financial ports are explicitly scripted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { getBase58Decoder } from '@solana/kit';
import { buildRuntime } from '../service/main.mjs';
import { createApp } from '../service/app.mjs';
import { loadConfig } from '../service/config.mjs';
import { Store } from '../service/store.mjs';

const HEALTHY = { workspaceAdapterReady: true, reportAdapterReady: true };
const WORKSPACE_DOWN = { workspaceAdapterReady: false, reportAdapterReady: true };
const REPORT_DOWN = { workspaceAdapterReady: true, reportAdapterReady: false };
const pair = () => {
  const keys = generateKeyPairSync('ed25519');
  return { ...keys, wallet: getBase58Decoder().decode(keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)) };
};
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const window = { windowStart: '2026-11-04T00:00:00.000Z', windowEnd: '2026-11-05T00:00:00.000Z' };

async function fixture(t, status = HEALTHY, { configured = true } = {}) {
  const now = Date.UTC(2026, 10, 7, 0), store = new Store(':memory:', { clock: () => now });
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port, payer = pair().wallet;
  const config = { ...loadConfig({ FLOWW_PUBLIC_ORIGIN: origin, MERCHANT_PAY_TO: pair().wallet,
    FLOWW_ENABLE_DEVNET_PAYMENTS: 'true', FLOWW_DAILY_PAYMENT_ATOMIC: '3000' }),
    model: configured ? 'scripted-adapter-runtime' : null, apiKey: configured ? 'inert-key-never-sent' : null };
  const calls = { quote: 0, sign: 0, redeem: 0, reconcile: 0, propose: 0, consume: 0, refine: 0, plan: 0, quota: 0 };
  const control = { confirmed: false, redeemGate: null };
  const transaction = getBase58Decoder().decode(new Uint8Array(64).fill(9));
  const forbidden = async () => assert.fail('External transport is not permitted in adapter acceptance');
  const gateway = {
    readiness: async () => ({ ready: true, payer, missing: [] }),
    quote: async resourceUrl => {
      calls.quote++; const requirements = { scheme: 'exact', network: config.network, asset: config.asset,
        amount: config.amountAtomic, payTo: config.merchantPayTo, maxTimeoutSeconds: 120, extra: { feePayer: payer } };
      return { resourceUrl, requirements, paymentRequired: { x402Version: 2, resource: { url: resourceUrl }, accepts: [requirements] } };
    },
    sign: async (quote, { beforeSign }) => {
      await beforeSign(); calls.sign++;
      return { paymentHeader: 'scripted-original-proof-not-a-real-payment', payer, signature: null,
        messageHash: 'c'.repeat(64), requirements: quote.requirements, resourceUrl: quote.resourceUrl };
    },
    redeem: async (_url, signed) => {
      calls.redeem++; assert.equal(signed.paymentHeader, 'scripted-original-proof-not-a-real-payment');
      await control.redeemGate?.promise;
      return control.confirmed ? { payment: 'CONFIRMED', delivery: 'COMPLETED', transaction,
        body: '{"is_synthetic":true}', reasonCode: 'SCRIPTED_DELIVERED' }
        : { payment: 'UNKNOWN', delivery: 'PENDING', reasonCode: 'SCRIPTED_UNKNOWN' };
    },
    reconcile: async (_transaction, signed) => {
      calls.reconcile++; assert.equal(signed.paymentHeader, 'scripted-original-proof-not-a-real-payment');
      return { payment: 'CONFIRMED', transaction };
    },
  };
  const ai = {
    propose: async () => { calls.propose++; return { status: 'PROPOSED', proposal_ref: 'scripted-proposal' }; },
    consume: async () => { calls.consume++; return { status: 'EVIDENCE_READY', code: 'SCRIPTED_ANALYSIS', answer: { is_synthetic: true } }; },
  };
  const metadata = { modelVersion: config.model, promptVersion: 'workspace/v2' };
  const planner = {
    refine: async input => { calls.refine++; return { status: 'READY_TO_PLAN', assistantText: 'Scripted contract response',
      intent: { ...input.intent, resourceId: 'wallet-transfers', missingFields: [] }, ...metadata,
      executionKind: 'live_model_intent_refinement' }; },
    plan: async () => { calls.plan++; return { status: 'PROPOSED', summary: 'Scripted bounded observation',
      steps: [{ role: 'planner', capability: 'wallet-transfers', resourceId: 'wallet-transfers', reason: 'Exact selected scope' }],
      limitations: ['Scripted contract only'], ...metadata, executionKind: 'live_model_planner_critic' }; },
  };
  let runtime;
  async function install(adapterStatus) {
    if (runtime) {
      runtime.lifecycle.beginDrain(); await runtime.lifecycle.whenIdle(); server.removeListener('request', runtime.app);
    }
    runtime = await buildRuntime({ config, store, adapterStatus, gateway, planner, ai, rpc: forbidden,
      reportProvider: forbidden, mountMerchant: () => ({}), writeLog: () => true });
    const reserve = runtime.workspace.reserveModel.bind(runtime.workspace);
    runtime.workspace.reserveModel = (...args) => { calls.quota++; return reserve(...args); };
    server.on('request', runtime.app);
  }
  t.after(async () => {
    control.redeemGate?.resolve(); runtime?.lifecycle.beginDrain(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); await runtime?.lifecycle.whenIdle(); store.close();
  });
  await install(status);
  async function request(path, cookie, body) {
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(5000),
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
  }
  async function login() {
    const actor = pair(), challenge = await request('/api/auth/challenge', null, { wallet: actor.wallet });
    const authenticated = await request('/api/auth/verify', null, { wallet: actor.wallet, challengeId: challenge.body.challengeId,
      signature: sign(null, Buffer.from(challenge.body.message), actor.privateKey).toString('base64') });
    assert.equal(authenticated.status, 200);
    return { wallet: actor.wallet, cookie: authenticated.headers.get('set-cookie').split(';')[0] };
  }
  const create = async actor => {
    const value = await request('/api/tasks', actor.cookie, { purpose: 'Bounded transfer observation', wallet: actor.wallet, ...window });
    assert.equal(value.status, 201); return value.body;
  };
  async function approved(actor, task) {
    const quoted = await request('/api/tasks/' + task.id + '/quote', actor.cookie, {}); assert.equal(quoted.status, 200);
    const result = await request('/api/tasks/' + task.id + '/approve', actor.cookie, { quoteHash: quoted.body.quote.hash,
      budgetAtomic: config.amountAtomic, expiresAt: new Date(now + 60_000).toISOString(), acknowledge: true });
    assert.equal(result.status, 200); return result.body;
  }
  return { request, login, create, approved, install, calls, control, store, transaction,
    get runtime() { return runtime; } };
}

test('known workspace packaging failure stops new turns/plans before persistence or quota, preserving replay and manual work', async t => {
  const f = await fixture(t), actor = await f.login();
  const created = await f.request('/api/conversations', actor.cookie, {}), id = created.body.id, url = '/api/conversations/' + id;
  const message = { clientRequestId: randomUUID(), expectedRevision: created.body.revision, text: 'Observe transfers',
    scope: { wallet: actor.wallet, ...window } };
  const refined = await f.request(url + '/messages', actor.cookie, message); assert.equal(refined.status, 200);
  const plan = { clientRequestId: randomUUID(), expectedRevision: refined.body.revision };
  const planned = await f.request(url + '/plan', actor.cookie, plan); assert.equal(planned.status, 200);
  await f.install(WORKSPACE_DOWN);
  const health = await f.request('/api/health');
  assert.equal(health.body.workspaceAdapterReady, false); assert.equal(health.body.reportAdapterReady, true);
  assert.equal(health.body.modelConfigured, true); assert.equal(health.body.ready, true);
  const before = await f.request(url, actor.cookie), counts = { ...f.calls };
  for (const [suffix, body] of [['/messages', { ...message, clientRequestId: randomUUID(), expectedRevision: before.body.revision }],
    ['/plan', { ...plan, clientRequestId: randomUUID(), expectedRevision: before.body.revision }]]) {
    const blocked = await f.request(url + suffix, actor.cookie, body);
    assert.equal(blocked.status, 503); assert.equal(blocked.body.error.code, 'WORKSPACE_ADAPTER_UNAVAILABLE');
  }
  assert.deepEqual((await f.request(url, actor.cookie)).body, before.body);
  assert.equal(f.calls.quota, counts.quota); assert.equal(f.calls.refine, counts.refine); assert.equal(f.calls.plan, counts.plan);
  for (const [suffix, body] of [['/messages', message], ['/plan', plan]]) {
    const replay = await f.request(url + suffix, actor.cookie, body);
    assert.equal(replay.status, 200); assert.equal(replay.body.id, id);
  }
  assert.equal(f.calls.quota, counts.quota); assert.equal(f.calls.refine, counts.refine); assert.equal(f.calls.plan, counts.plan);
  const manual = await f.create(actor); await f.approved(actor, manual);
  assert.equal(f.calls.sign, 0); assert.equal(f.calls.redeem, 0);
});

test('no configured model retains its fixed no-key failure before any adapter gate or turn write', async t => {
  const f = await fixture(t, { workspaceAdapterReady: false, reportAdapterReady: false }, { configured: false });
  const actor = await f.login(), created = await f.request('/api/conversations', actor.cookie, {}), url = '/api/conversations/' + created.body.id;
  const before = await f.request(url, actor.cookie);
  const result = await f.request(url + '/messages', actor.cookie, { clientRequestId: randomUUID(),
    expectedRevision: created.body.revision, text: 'Observe transfers', scope: { wallet: actor.wallet, ...window } });
  assert.equal(result.status, 503); assert.equal(result.body.error.code, 'MODEL_NOT_CONFIGURED');
  assert.deepEqual((await f.request(url, actor.cookie)).body, before.body);
  assert.equal(f.calls.quota, 0); assert.equal(f.calls.refine, 0);
});

test('report failure blocks fresh quote/sign without mutation while old proof reconciliation and delivery remain durable', async t => {
  const f = await fixture(t), actor = await f.login();
  const original = await f.approved(actor, await f.create(actor));
  const fresh = await f.approved(actor, await f.create(actor));
  const unquoted = await f.create(actor);
  const started = await f.request('/api/tasks/' + original.id + '/execute', actor.cookie, { approvalId: original.approval.id });
  assert.equal(started.body.payment, 'UNKNOWN'); assert.equal(f.calls.sign, 1);
  await f.install(REPORT_DOWN);
  const health = await f.request('/api/health');
  assert.equal(health.body.reportAdapterReady, false); assert.equal(health.body.workspaceAdapterReady, true);
  assert.equal(health.body.ready, false); assert.ok(health.body.missing.includes('REPORT_ADAPTER'));
  assert.equal((await f.request('/readyz')).status, 200); assert.equal((await f.request('/livez')).status, 200);
  assert.equal((await f.request('/api/tasks')).status, 401);
  const before = structuredClone(f.store.get(fresh.id, actor.wallet)), counts = { ...f.calls };
  for (const [id, suffix, body] of [[unquoted.id, 'quote', {}], [fresh.id, 'execute', { approvalId: fresh.approval.id }]]) {
    const blocked = await f.request('/api/tasks/' + id + '/' + suffix, actor.cookie, body);
    assert.equal(blocked.status, 503); assert.equal(blocked.body.error.code, 'REPORT_ADAPTER_UNAVAILABLE');
  }
  const rejectedApproval = await f.request('/api/tasks/' + fresh.id + '/approve', actor.cookie, {
    quoteHash: fresh.quote.hash, budgetAtomic: fresh.quote.amountAtomic,
    expiresAt: fresh.approval.expiresAt, acknowledge: true });
  assert.equal(rejectedApproval.status, 503); assert.equal(rejectedApproval.body.error.code, 'REPORT_ADAPTER_UNAVAILABLE');
  assert.deepEqual(f.store.get(fresh.id, actor.wallet), before);
  assert.equal(f.store.get(unquoted.id, actor.wallet).operation, null);
  assert.equal(f.calls.quote, counts.quote); assert.equal(f.calls.sign, counts.sign);
  assert.equal(f.calls.redeem, counts.redeem); assert.equal(f.calls.propose, counts.propose);
  for (const [suffix, body] of [['quote', {}], ['execute', { approvalId: original.approval.id }]]) {
    const existing = await f.request('/api/tasks/' + original.id + '/' + suffix, actor.cookie, body);
    assert.equal(existing.status, 409); assert.equal(existing.body.error.code, 'EXECUTION_ALREADY_CLAIMED');
  }
  assert.equal((await f.runtime.mandates.dashboard(actor.wallet)).heldAtomic, '1000');
  const observed = await f.request('/api/tasks/' + original.id + '/reconcile', actor.cookie, {});
  assert.equal(observed.status, 200); assert.equal(observed.body.payment, 'CONFIRMED');
  assert.equal(observed.body.transaction, f.transaction);
  f.control.confirmed = true;
  const recovered = await f.request('/api/tasks/' + original.id + '/recover', actor.cookie, {});
  assert.equal(recovered.status, 200); assert.equal(recovered.body.payment, 'CONFIRMED');
  assert.equal(recovered.body.delivery, 'COMPLETED'); assert.equal(recovered.body.result, null);
  assert.equal(recovered.body.reasonCode, 'REPORT_ADAPTER_UNAVAILABLE'); assert.equal(recovered.body.nextAction, 'RECOVER');
  assert.equal(f.store.get(original.id, actor.wallet).signedData.paymentHeader, 'scripted-original-proof-not-a-real-payment');
  const budget = await f.runtime.mandates.dashboard(actor.wallet);
  assert.equal(budget.spentAtomic, '1000'); assert.equal(budget.heldAtomic, '0');
  assert.equal(f.calls.sign, 1); assert.equal(f.calls.redeem, 2); assert.equal(f.calls.consume, 0);
});

test('logout during original-proof recovery preserves observations but cannot publish skipped-analysis state to an expired owner', async t => {
  const f = await fixture(t), actor = await f.login(), original = await f.approved(actor, await f.create(actor));
  await f.request('/api/tasks/' + original.id + '/execute', actor.cookie, { approvalId: original.approval.id });
  await f.install(REPORT_DOWN);
  await f.request('/api/tasks/' + original.id + '/reconcile', actor.cookie, {});
  f.control.confirmed = true; f.control.redeemGate = defer();
  const recovering = f.request('/api/tasks/' + original.id + '/recover', actor.cookie, {});
  for (let i = 0; i < 100 && f.calls.redeem < 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.redeem, 2);
  assert.equal((await f.request('/api/auth/logout', actor.cookie, {})).status, 204);
  f.control.redeemGate.resolve();
  const result = await recovering; assert.equal(result.status, 401);
  const saved = f.store.get(original.id, actor.wallet);
  assert.equal(saved.payment, 'CONFIRMED'); assert.equal(saved.delivery, 'COMPLETED'); assert.equal(saved.result, null);
  assert.equal(saved.deliveredBody, '{"is_synthetic":true}');
  assert.equal(saved.events.some(event => event.type === 'REPORT_REJECTED'), false);
  assert.equal(f.calls.consume, 0); assert.equal(f.calls.sign, 1);
  assert.equal((await f.runtime.mandates.dashboard(actor.wallet)).spentAtomic, '1000');
});

test('direct createApp leaves unspecified adapter capabilities unknown and fail-closed', async t => {
  const server = createServer(), store = new Store(':memory:');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const config = loadConfig({ FLOWW_PUBLIC_ORIGIN: origin, MERCHANT_PAY_TO: pair().wallet });
  const app = createApp({ config, store, gateway: { readiness: async () => ({ ready: true, payer: pair().wallet }) } });
  server.on('request', app);
  const response = await fetch(origin + '/api/health'), health = await response.json();
  assert.equal(response.status, 200); assert.equal(health.workspaceAdapterReady, false);
  assert.equal(health.reportAdapterReady, false); assert.equal(health.ready, false);
  assert.ok(health.missing.includes('REPORT_ADAPTER'));
  assert.equal((await fetch(origin + '/readyz')).status, 200);
});
