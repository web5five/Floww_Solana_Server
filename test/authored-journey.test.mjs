/** Real HTTP/auth/SQLite/policy and keyless Python proposals; scripted roles, no payment transport. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getBase58Decoder } from '@solana/kit';
import { buildRuntime } from '../service/main.mjs';
import { createAiBridge } from '../service/ai.mjs';
import { loadConfig } from '../service/config.mjs';
import { Store } from '../service/store.mjs';

const suite = JSON.parse(readFileSync(new URL('../reference/evaluations/workspace-journey-v1.json', import.meta.url), 'utf8'));
const scope = value => Object.fromEntries(['wallet', 'windowStart', 'windowEnd'].map(key => [key, value[key]]));

async function fixture(t, scenario) {
  // Only quote expiry uses startup time: the real Python proposal checks its own current clock.
  const now = Date.now(), store = new Store(':memory:', { clock: () => now });
  const server = createServer(); let runtime;
  t.after(async () => {
    runtime?.lifecycle.beginDrain();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await runtime?.lifecycle.whenIdle();
    store.close();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const config = { ...loadConfig({ FLOWW_PUBLIC_ORIGIN: origin, MERCHANT_PAY_TO: suite.corrected_scope.wallet,
    FLOWW_ENABLE_DEVNET_PAYMENTS: 'true' }), model: 'scripted-journey-contract', apiKey: 'inert-contract-placeholder' };
  const calls = { refine: 0, plan: 0, proposal: 0, sign: 0, redeem: 0, reconcile: 0, forbidden: 0 };
  const forbidden = async () => { calls.forbidden++; assert.fail('External or financial transport is not permitted'); };
  const gateway = {
    readiness: async () => ({ ready: true, payer: suite.initial_scope.wallet, missing: [] }),
    quote: async resourceUrl => {
      const requirements = { scheme: 'exact', network: config.network, asset: config.asset,
        amount: config.amountAtomic, payTo: config.merchantPayTo, maxTimeoutSeconds: 120,
        extra: { feePayer: suite.initial_scope.wallet } };
      return { resourceUrl, requirements, paymentRequired: { x402Version: 2, resource: { url: resourceUrl }, accepts: [requirements] } };
    },
    sign: async () => { calls.sign++; return forbidden(); },
    redeem: async () => { calls.redeem++; return forbidden(); },
    reconcile: async () => { calls.reconcile++; return forbidden(); },
  };
  // These legacy metadata labels are required by the interface, not evidence of a live model.
  const metadata = { modelVersion: config.model, promptVersion: 'workspace/v4' };
  const planner = {
    refine: async input => {
      calls.refine++;
      if (calls.refine === 1) return { status: 'STOPPED', code: 'WORKSPACE_MODEL_UNAVAILABLE' };
      return { status: 'READY_TO_PLAN', assistantText: scenario.purpose,
        intent: { ...input.intent, resourceId: 'wallet-transfers', missingFields: [] },
        executionKind: 'live_model_intent_refinement', ...metadata };
    },
    plan: async () => {
      calls.plan++;
      return { status: 'PROPOSED', summary: scenario.purpose,
        steps: [{ role: 'planner', capability: 'wallet-transfers', resourceId: 'wallet-transfers',
          reason: 'Scripted review of the exact selected observation scope.' }],
        limitations: ['Only returned transfer observations are covered.'],
        executionKind: 'live_model_planner_critic', ...metadata };
    },
  };
  const bridge = createAiBridge({ python: config.python, timeoutMs: 3000 });
  runtime = await buildRuntime({ config, store, gateway, planner, ai: {
    propose: async payload => { calls.proposal++; return bridge.propose(payload); }, consume: forbidden,
  }, rpc: forbidden, reportProvider: forbidden, mountMerchant: () => ({}), writeLog: () => true });
  server.on('request', runtime.app);
  const actor = generateKeyPairSync('ed25519');
  const wallet = getBase58Decoder().decode(actor.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  let cookie;
  async function request(path, body) {
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
      signal: AbortSignal.timeout(5000), headers: { ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  const challenge = await request('/api/auth/challenge', { wallet });
  const verified = await request('/api/auth/verify', { wallet, challengeId: challenge.body.challengeId,
    signature: sign(null, Buffer.from(challenge.body.message), actor.privateKey).toString('base64') });
  assert.equal(verified.status, 200); cookie = verified.headers.get('set-cookie').split(';')[0];
  return { request, store, wallet, calls, now };
}

for (const scenario of suite.cases.filter(item => item.family === 'correction_grounding')) {
  test(scenario.id + ': failed provider retry, corrected same Task and three actual consent outcomes',
    { timeout: 15_000 }, async t => {
      assert.equal(suite.synthetic, true); assert.equal(suite.model_execution, 'scripted_roles');
      assert.equal(suite.split, 'contract_acceptance');
      assert.equal(suite.financial_transport, 'inert_not_executed');
      const f = await fixture(t, scenario);
      const created = await f.request('/api/conversations', { title: scenario.purpose });
      assert.equal(created.status, 201); const id = created.body.id, path = '/api/conversations/' + id;
      const input = { clientRequestId: scenario.id + '-first', expectedRevision: created.body.revision,
        text: scenario.turns[0].text, scope: scope(suite.initial_scope) };
      const failed = await f.request(path + '/messages', input);
      assert.equal(failed.status, 503); assert.equal(failed.body.error.code, 'WORKSPACE_MODEL_UNAVAILABLE');
      const stopped = await f.request(path);
      assert.equal(stopped.body.status, 'ATTENTION_REQUIRED');
      assert.equal(stopped.body.errorCode, 'WORKSPACE_MODEL_UNAVAILABLE');
      assert.deepEqual(stopped.body.messages.map(item => [item.role, item.text]), [['user', input.text]]);
      const replay = await f.request(path + '/messages', input);
      assert.equal(replay.status, 200); assert.equal(replay.body.status, 'ATTENTION_REQUIRED');
      assert.equal(f.calls.refine, 1); assert.equal(replay.body.messages.length, 1);
      const retried = await f.request(path + '/messages', { ...input,
        clientRequestId: scenario.id + '-explicit-retry', expectedRevision: stopped.body.revision });
      assert.equal(retried.status, 200); assert.equal(retried.body.status, 'READY_TO_PLAN');
      assert.equal(retried.body.id, id); assert.equal(f.calls.refine, 2);
      const planned = await f.request(path + '/plan', { clientRequestId: scenario.id + '-old-plan',
        expectedRevision: retried.body.revision });
      assert.equal(planned.status, 200); assert.equal(planned.body.status, 'APPROVAL_REQUIRED');
      const corrected = await f.request(path + '/messages', { clientRequestId: scenario.id + '-correction',
        expectedRevision: planned.body.revision, text: scenario.turns[1].text, scope: scope(suite.corrected_scope) });
      assert.equal(corrected.status, 200); assert.equal(corrected.body.plan, null);
      const stale = await f.request(path + '/confirm', { expectedRevision: corrected.body.revision,
        planHash: planned.body.plan.hash, ...scope(suite.initial_scope), acknowledge: true });
      assert.equal(stale.status, 409); assert.equal((await f.request('/api/tasks')).body.tasks.length, 0);
      const reviewed = await f.request(path + '/plan', { clientRequestId: scenario.id + '-reviewed-plan',
        expectedRevision: corrected.body.revision });
      assert.equal(reviewed.status, 200); assert.deepEqual(scope(reviewed.body.plan.scope), scope(suite.corrected_scope));
      const consent = { expectedRevision: reviewed.body.revision, planHash: reviewed.body.plan.hash,
        ...scope(suite.corrected_scope), acknowledge: true };
      const linked = await f.request(path + '/confirm', consent);
      assert.equal(linked.status, 201); const taskId = linked.body.id, taskPath = '/api/tasks/' + taskId;
      const repeated = await f.request(path + '/confirm', consent);
      assert.equal(repeated.status, 200); assert.equal(repeated.body.id, taskId);
      const reopened = await f.request(path);
      assert.equal(reopened.body.linkedTaskId, taskId); assert.equal(reopened.body.id, id);
      assert.equal(linked.body.workspaceContext.conversationId, id);
      assert.equal(linked.body.workspaceContext.planHash, reviewed.body.plan.hash);
      assert.deepEqual(scope(linked.body), scope(suite.corrected_scope));
      assert.equal((await f.request('/api/tasks')).body.tasks.length, 1);
      const afterLink = await f.request(path + '/messages', { clientRequestId: scenario.id + '-post-link',
        expectedRevision: reopened.body.revision, text: scenario.turns[2].text });
      assert.equal(afterLink.status, 409); assert.equal(afterLink.body.error.code, 'CONVERSATION_ALREADY_LINKED');
      assert.equal(f.calls.refine, 3); assert.equal(f.calls.plan, 2);
      const quoted = await f.request(taskPath + '/quote', {});
      assert.equal(quoted.status, 200); assert.equal(quoted.body.id, taskId);
      assert.equal(quoted.body.proposal.executionKind, 'explicit_resource_selection');
      assert.equal(f.calls.proposal, 1);
      const exact = { quoteHash: quoted.body.quote.hash, budgetAtomic: '1000',
        allowedRecipient: quoted.body.quote.recipient, expiresAt: new Date(f.now + 60_000).toISOString(), acknowledge: true };
      const unacknowledged = await f.request(taskPath + '/approve', { ...exact, acknowledge: false });
      assert.equal(unacknowledged.status, 400); assert.equal(unacknowledged.body.error.code, 'EXPLICIT_APPROVAL_REQUIRED');
      for (const [change, status, policy, code] of [
        [{ budgetAtomic: '999' }, 403, 'DENY', 'BUDGET_DENIED'],
        [{ allowedRecipient: f.wallet }, 403, 'DENY', 'UNAUTHORIZED_PAYMENT_TERMS'],
        [{}, 200, 'ALLOW', null],
      ]) {
        const response = await f.request(taskPath + '/approve', { ...exact, ...change });
        assert.equal(response.status, status);
        if (code) assert.equal(response.body.error.code, code);
        const saved = await f.request(taskPath), privateTask = f.store.get(taskId, f.wallet);
        assert.equal(saved.body.id, taskId); assert.equal(saved.body.policy, policy);
        assert.equal(saved.body.payment, 'NOT_STARTED'); assert.equal(saved.body.transaction, null);
        assert.equal(saved.body.delivery, 'NOT_STARTED');
        assert.equal(saved.body.result, null); assert.deepEqual(scope(saved.body), scope(suite.corrected_scope));
        if (code) {
          assert.equal(saved.body.reasonCode, code); assert.equal(saved.body.nextAction, 'APPROVE');
          assert.equal(saved.body.events.at(-1).type, 'POLICY_DENIED');
          assert.equal(saved.body.events.at(-1).code, code);
          assert.equal(saved.body.approval, null);
        }
        if (policy === 'ALLOW') {
          assert.equal(saved.body.reasonCode, 'APPROVED'); assert.equal(saved.body.nextAction, 'EXECUTE');
          assert.equal(saved.body.events.at(-1).type, 'APPROVED');
          assert.equal(saved.body.approval.quoteHash, exact.quoteHash);
          assert.equal(saved.body.approval.budgetAtomic, '1000');
        }
        assert.equal(privateTask.attemptRef, undefined); assert.equal(privateTask.signedData, undefined);
        assert.equal(f.calls.sign, 0); assert.equal(f.calls.redeem, 0); assert.equal(f.calls.reconcile, 0);
      }
      assert.equal((await f.request('/api/tasks')).body.tasks.length, 1);
      assert.equal(f.calls.forbidden, 0);
    });
}
