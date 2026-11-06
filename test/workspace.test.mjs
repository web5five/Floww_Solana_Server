/** Actual HTTP/auth/SQLite boundaries with scripted authority-free model ports. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { getBase58Decoder } from '@solana/kit';
import { createApp } from '../service/app.mjs';
import { loadConfig } from '../service/config.mjs';
import { Store } from '../service/store.mjs';
import { WorkspaceStore } from '../service/workspace-store.mjs';
import { mountWorkspace } from '../service/workspace.mjs';
import { createMandateService } from '../service/mandates.mjs';

const RESOURCE = 'wallet-transfers', MODEL = 'explicit-workspace-test-model';
const scope = wallet => ({ wallet, windowStart: '2026-11-04T00:00:00.000Z', windowEnd: '2026-11-05T00:00:00.000Z' });
function keypair() {
  const pair = generateKeyPairSync('ed25519');
  return { ...pair, address: getBase58Decoder().decode(pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)) };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function eventually(fn) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Expected bounded asynchronous state transition');
}
async function setup({ sessionTtlMs = 8 * 3600_000, ownerModelDailyLimit = 100, configured = true } = {}) {
  let time = Date.UTC(2026, 10, 6, 12), refines = 0, plans = 0, addCalls = 0, financialCalls = 0;
  const rawStore = new Store(':memory:', { clock: () => time });
  const control = { refineHook: null, planHook: null, refineOutput: null, planOutput: null, addHook: null };
  const inputs = [];
  const store = new Proxy(rawStore, { get(target, field) {
    if (field === 'add') return async (...args) => { addCalls++; await control.addHook?.(...args); return target.add(...args); };
    const value = target[field]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const repo = await WorkspaceStore.open(rawStore);
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const config = { ...loadConfig({ MERCHANT_PAY_TO: keypair().address }), origin, publicOrigin: origin,
    merchantOrigin: origin, merchantBaseUrl: origin + '/merchant/reports', paymentEnabled: false,
    sessionTtlMs, model: configured ? MODEL : null, apiKey: configured ? 'dummy-key-never-used-for-network' : null,
    globalModelDailyLimit: 1_000, ownerModelDailyLimit };
  const mandates = await createMandateService({ store: rawStore, config });
  const financial = async () => { financialCalls++; throw new Error('Financial port must be unreachable from workspace planning'); };
  const gateway = { readiness: async () => ({ ready: false, payer: null, missing: ['payment_disabled'] }),
    quote: financial, sign: financial, redeem: financial, reconcile: financial };
  const planner = {
    async refine(input, options) {
      refines++; inputs.push(structuredClone(input)); await control.refineHook?.(input, options);
      if (options?.signal.aborted) return { status: 'STOPPED', code: 'WORKSPACE_CANCELLED' };
      if (control.refineOutput) return structuredClone(control.refineOutput);
      const intent = { ...input.intent, purpose: input.intent.purpose ?? 'Observe transfer activity' };
      intent.missingFields = ['purpose', 'wallet', 'windowStart', 'windowEnd', 'resourceId'].filter(field => intent[field] === null);
      return { status: intent.missingFields.length ? 'CLARIFICATION_REQUIRED' : 'READY_TO_PLAN',
        assistantText: 'MODEL_PRIVATE_MARKER: scope reviewed.', intent, executionKind: 'live_model_intent_refinement',
        modelVersion: MODEL, promptVersion: 'workspace/v5' };
    },
    async plan(input, options) {
      plans++; inputs.push(structuredClone(input)); await control.planHook?.(input, options);
      if (control.planOutput) return structuredClone(control.planOutput);
      return { status: 'PROPOSED', summary: 'Inspect bounded observed transfer activity.',
        steps: [{ role: 'planner', capability: RESOURCE, resourceId: RESOURCE, reason: 'Fits the explicitly selected observation scope.' }],
        limitations: ['Only observed transfers are covered.'], executionKind: 'live_model_planner_critic',
        modelVersion: MODEL, promptVersion: 'workspace/v5' };
    },
  };
  server.on('request', createApp({ config, store, gateway, ai: { propose: financial, consume: financial },
    adapterStatus: { workspaceAdapterReady: true, reportAdapterReady: true },
    mountWorkspace: (app, context) => mountWorkspace(app, { repo, planner, mandates }, context) }));
  async function request(url, { method = 'GET', body, cookie, headers = {}, signal } = {}) {
    const response = await fetch(origin + url, { method, signal,
      headers: { ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
  }
  async function login(pair = keypair()) {
    const challenge = await request('/api/auth/challenge', { method: 'POST', body: { wallet: pair.address } });
    assert.equal(challenge.status, 200);
    const verified = await request('/api/auth/verify', { method: 'POST', body: { wallet: pair.address,
      challengeId: challenge.body.challengeId, signature: sign(null, Buffer.from(challenge.body.message), pair.privateKey).toString('base64') } });
    assert.equal(verified.status, 200); return { cookie: verified.headers.get('set-cookie').split(';')[0], pair };
  }
  async function conversation(cookie, useMemory = false) {
    const response = await request('/api/conversations', { method: 'POST', cookie, body: { title: 'Private workspace goal', useMemory } });
    assert.equal(response.status, 201); return response.body;
  }
  async function message(cookie, record, { id = 'message-request-001', text = 'Review the selected observed transfer scope.', ...changes } = {}) {
    return request(`/api/conversations/${record.id}/messages`, { method: 'POST', cookie,
      body: { clientRequestId: id, expectedRevision: record.revision, text, ...changes } });
  }
  async function ready(cookie, wallet, useMemory = false) {
    const record = await conversation(cookie, useMemory);
    const response = await message(cookie, record, { scope: scope(wallet) });
    assert.equal(response.status, 200); assert.equal(response.body.status, 'READY_TO_PLAN'); return response.body;
  }
  async function plan(cookie, record, id = 'plan-request-001') {
    return request(`/api/conversations/${record.id}/plan`, { method: 'POST', cookie,
      body: { clientRequestId: id, expectedRevision: record.revision } });
  }
  async function memory(cookie, { expiresAt = new Date(time + 60_000).toISOString(), ...changes } = {}) {
    return request('/api/memories', { method: 'POST', cookie,
      body: { key: 'language', value: 'Korean private preference', acknowledge: true, expiresAt, ...changes } });
  }
  return { config, control, inputs, rawStore, store, repo, request, login, conversation, message, ready, plan, memory,
    now: () => time, advance: ms => { time += ms; }, counts: () => ({ refines, plans, addCalls, financialCalls }),
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rawStore.close(); } };
}

test('workspace HTTP APIs inherit real wallet auth, Host/Origin guards and owner isolation', async () => {
  const f = await setup();
  try {
    for (const url of ['/api/conversations', '/api/memories', '/api/catalog', '/api/dashboard', '/api/activity']) {
      assert.equal((await f.request(url)).status, 401);
    }
    const a = await f.login(), b = await f.login(), record = await f.conversation(a.cookie);
    assert.equal((await f.request(`/api/conversations/${record.id}`, { cookie: b.cookie })).status, 404);
    assert.equal((await f.request('/api/conversations', { cookie: b.cookie })).body.items.length, 0);
    assert.equal((await f.message(b.cookie, record)).status, 404);
    assert.equal((await f.message(a.cookie, record)).status, 200);
    const foreignOrigin = await f.request('/api/conversations', { method: 'POST', cookie: a.cookie, body: {}, headers: { Origin: 'https://foreign.invalid' } });
    assert.equal(foreignOrigin.status, 403);
    const host = await new Promise((resolve, reject) => {
      const req = httpRequest(f.config.origin + '/api/conversations', { headers: { Host: 'foreign.invalid', Cookie: a.cookie } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      }); req.on('error', reject); req.end();
    });
    assert.equal(host, 421); assert.equal(f.counts().financialCalls, 0);
  } finally { await f.close(); }
});

test('memory requires explicit consent, safe bounded keys and unexpired retention', async () => {
  const f = await setup();
  try {
    const a = await f.login(), b = await f.login();
    for (const changes of [{ acknowledge: false }, { key: 'budget' }, { key: 'mint' }, { key: 'network' },
      { key: 'privateKey' }, { key: 'password' }, { key: 'seedPhrase' }, { key: 'accessToken' },
      { key: 'x'.repeat(65) }, { value: 'x'.repeat(513) }, { expiresAt: new Date(f.now()).toISOString() },
      { expiresAt: new Date(f.now() + 91 * 86_400_000).toISOString() }]) {
      const denied = await f.memory(a.cookie, changes); assert.ok(denied.status >= 400 && denied.status < 500);
    }
    const saved = await f.memory(a.cookie); assert.equal(saved.status, 201);
    assert.equal((await f.request('/api/memories', { cookie: b.cookie })).body.items.length, 0);
    assert.equal((await f.request(`/api/memories/${saved.body.id}`, { method: 'DELETE', cookie: b.cookie, body: { expectedRevision: 1 } })).status, 404);
    assert.equal((await f.request(`/api/memories/${saved.body.id}`, { method: 'DELETE', cookie: a.cookie, body: { expectedRevision: 2 } })).status, 409);
    assert.equal((await f.request(`/api/memories/${saved.body.id}`, { method: 'DELETE', cookie: a.cookie, body: { expectedRevision: 1 } })).status, 204);
    assert.equal((await f.request('/api/memories', { cookie: a.cookie })).body.items.length, 0);
    assert.equal(f.counts().financialCalls, 0);
  } finally { await f.close(); }
});

test('unregistered URL memory is rejected before persistence or model invocation', async () => {
  const f = await setup();
  try {
    const a = await f.login();
    for (const value of ['https://outside.invalid/resource', 'javascript:alert(1)', '//outside.invalid/resource']) {
      const response = await f.memory(a.cookie, { value });
      assert.equal(response.status, 400); assert.equal(response.body.error.code, 'UNREGISTERED_RESOURCE_URL');
      assert.ok(!JSON.stringify(response.body).includes('outside.invalid'));
    }
    assert.equal((await f.repo.counts(a.pair.address)).memory, 0);
    assert.equal((await f.repo.activity(a.pair.address)).filter(event => event.type === 'MEMORY_CREATED').length, 0);
    assert.equal(f.counts().refines, 0); assert.equal(f.counts().plans, 0); assert.equal(f.counts().financialCalls, 0);
  } finally { await f.close(); }
});

test('short key-like user text is rejected before storing turns or calling the model', async () => {
  const f = await setup();
  try {
    const a = await f.login(), record = await f.conversation(a.cookie);
    for (const [index, text] of ['sk-ABCDEFGHIJKL', 'prefixsk-ABCDEFGHIJKL', 'Bearer dummy-session'].entries()) {
      const response = await f.message(a.cookie, record, { id: 'unsafe-text-request-' + index, text });
      assert.equal(response.status, 400); assert.equal(response.body.error.code, 'SECRET_CONTENT_REJECTED');
      assert.ok(!JSON.stringify(response.body).includes(text));
    }
    const current = await f.repo.get(a.pair.address, 'conversation', record.id);
    assert.equal(current.revision, record.revision); assert.equal(current.data.messages.length, 0);
    assert.equal(f.rawStore.db.prepare('SELECT count(*) AS n FROM workspace_model_usage').get().n, 0);
    assert.equal(f.counts().refines, 0); assert.equal(f.counts().financialCalls, 0);
  } finally { await f.close(); }
});

test('model receives latest bounded messages and opted-in owner preferences without metadata', async () => {
  const f = await setup();
  try {
    const a = await f.login(), b = await f.login();
    await f.memory(a.cookie); await f.memory(b.cookie, { value: 'OTHER_OWNER_PRIVATE' });
    const noMemory = await f.conversation(a.cookie, false);
    await f.message(a.cookie, noMemory); assert.deepEqual(f.inputs.at(-1).memories, []);
    const record = await f.conversation(a.cookie, true);
    const seeded = await f.repo.update(a.pair.address, 'conversation', record.id, record.revision, data => {
      data.messages = Array.from({ length: 25 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        role: index % 2 ? 'assistant' : 'user', text: 'Earlier context ' + index, at: new Date(f.now()).toISOString(),
        executionKind: 'must-not-forward' }));
    });
    const response = await f.message(a.cookie, seeded, { scope: scope(a.pair.address) }); assert.equal(response.status, 200);
    const input = f.inputs.at(-1); assert.equal(input.messages.length, 12);
    for (const message of input.messages) assert.deepEqual(Object.keys(message).sort(), ['id', 'role', 'text']);
    assert.deepEqual(input.memories, [{ key: 'language', value: 'Korean private preference' }]);
    assert.ok(!JSON.stringify(input).includes('OTHER_OWNER_PRIVATE'));
    assert.equal((await f.request(`/api/conversations/${record.id}`, { cookie: a.cookie })).body.messages.length, 20);
    const firstPage = await f.request('/api/conversations?limit=1', { cookie: a.cookie });
    assert.equal(firstPage.body.items.length, 1); assert.ok(firstPage.body.nextCursor);
    assert.ok(!JSON.stringify(firstPage.body).includes('MODEL_PRIVATE_MARKER'));
  } finally { await f.close(); }
});

test('message request identity replays pending and completed work without extra calls or duplicate turns', async () => {
  const f = await setup(), entered = deferred(), release = deferred();
  try {
    const a = await f.login(), record = await f.conversation(a.cookie);
    f.control.refineHook = async () => { entered.resolve(); await release.promise; };
    const first = f.message(a.cookie, record, { scope: scope(a.pair.address) }); await entered.promise;
    const pending = await f.message(a.cookie, record, { scope: scope(a.pair.address) });
    assert.equal(pending.status, 200); assert.equal(pending.body.working, true); assert.equal(f.counts().refines, 1);
    const conflict = await f.message(a.cookie, record, { text: 'Changed same-key payload', scope: scope(a.pair.address) });
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
    release.resolve(); const finished = await first; assert.equal(finished.status, 200);
    const replay = await f.message(a.cookie, record, { scope: scope(a.pair.address) });
    assert.equal(replay.status, 200); assert.equal(f.counts().refines, 1); assert.equal(replay.body.messages.length, 2);
    assert.equal(f.counts().financialCalls, 0);
  } finally { release.resolve(); await f.close(); }
});

for (const interfaceLanguage of ['ko', 'en']) test(`interface ${interfaceLanguage} is an owner-bound planning fallback and an immutable retry input`, async () => {
  const f = await setup();
  try {
    const a = await f.login(), record = await f.conversation(a.cookie);
    const body = { scope: scope(a.pair.address), interfaceLanguage };
    const first = await f.message(a.cookie, record, body);
    assert.equal(first.status, 200); assert.equal(f.inputs.at(-1).interfaceLanguage, interfaceLanguage);
    assert.equal((await f.repo.get(a.pair.address, 'conversation', record.id)).data.interfaceLanguage, interfaceLanguage);
    const replay = await f.message(a.cookie, record, body);
    assert.equal(replay.status, 200); assert.equal(f.counts().refines, 1);
    const changed = await f.message(a.cookie, record, { ...body, interfaceLanguage: interfaceLanguage === 'ko' ? 'en' : 'ko' });
    assert.equal(changed.status, 409); assert.equal(changed.body.error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(f.counts().refines, 1);
    const plan = await f.plan(a.cookie, first.body);
    assert.equal(plan.status, 200); assert.equal(f.inputs.at(-1).interfaceLanguage, interfaceLanguage);
    assert.equal(f.counts().financialCalls, 0);
  } finally { await f.close(); }
});

test('invalid interface language is rejected before turn persistence, quota or inference; omitted legacy input stays valid', async () => {
  const f = await setup();
  try {
    const a = await f.login(), record = await f.conversation(a.cookie);
    for (const [index, interfaceLanguage] of [null, 'KO', 'fr', '', {}, ['ko'], 1].entries()) {
      const denied = await f.message(a.cookie, record, { id: 'invalid-language-' + index, interfaceLanguage });
      assert.equal(denied.status, 400); assert.equal(denied.body.error.code, 'INVALID_INTERFACE_LANGUAGE');
    }
    assert.equal(f.counts().refines, 0);
    assert.equal((await f.repo.get(a.pair.address, 'conversation', record.id)).revision, record.revision);
    assert.equal(f.rawStore.db.prepare('SELECT count(*) AS n FROM workspace_model_usage').get().n, 0);
    const legacy = await f.message(a.cookie, record, { scope: scope(a.pair.address) });
    assert.equal(legacy.status, 200); assert.equal(f.inputs.at(-1).interfaceLanguage, undefined);
    assert.equal(f.counts().financialCalls, 0);
  } finally { await f.close(); }
});

test('deleted or expired memory during inference blocks stale assistant persistence', async () => {
  for (const mode of ['deleted', 'expired']) {
    const f = await setup();
    try {
      const a = await f.login(), saved = await f.memory(a.cookie, { expiresAt: new Date(f.now() + 1_000).toISOString() });
      const record = await f.conversation(a.cookie, true);
      f.control.refineHook = async () => {
        if (mode === 'deleted') assert.equal((await f.request(`/api/memories/${saved.body.id}`, { method: 'DELETE', cookie: a.cookie, body: { expectedRevision: 1 } })).status, 204);
        else f.advance(1_001);
      };
      const response = await f.message(a.cookie, record, { scope: scope(a.pair.address) });
      assert.equal(response.status, 409); assert.equal(response.body.error.code, 'MEMORY_CHANGED');
      const current = await f.repo.get(a.pair.address, 'conversation', record.id);
      assert.equal(current.data.messages.filter(message => message.role === 'assistant').length, 0);
      assert.equal(current.data.intentRevision, 0); assert.equal(f.counts().financialCalls, 0);
    } finally { await f.close(); }
  }
});

test('logout or session expiry during model inference releases no private assistant result', async () => {
  for (const mode of ['logout', 'expiry']) {
    const f = await setup({ sessionTtlMs: mode === 'expiry' ? 1_000 : 60_000 });
    try {
      const a = await f.login(), record = await f.conversation(a.cookie);
      f.control.refineHook = async () => {
        if (mode === 'logout') await f.request('/api/auth/logout', { method: 'POST', cookie: a.cookie, body: {} });
        else f.advance(1_001);
      };
      const response = await f.message(a.cookie, record, { scope: scope(a.pair.address) });
      assert.equal(response.status, 401); assert.ok(!JSON.stringify(response.body).includes('MODEL_PRIVATE_MARKER'));
      const current = await f.repo.get(a.pair.address, 'conversation', record.id);
      assert.equal(current.data.messages.filter(message => message.role === 'assistant').length, 0);
      assert.equal(f.counts().financialCalls, 0);
    } finally { await f.close(); }
  }
});

test('client disconnect aborts the model port and leaves no successful plan or payment', async () => {
  const f = await setup(), entered = deferred(), aborted = deferred();
  try {
    const a = await f.login(), record = await f.conversation(a.cookie);
    f.control.refineHook = async (input, { signal }) => {
      entered.resolve(); await new Promise(resolve => signal.addEventListener('abort', () => { aborted.resolve(); resolve(); }, { once: true }));
    };
    const controller = new AbortController();
    const pending = f.request(`/api/conversations/${record.id}/messages`, { method: 'POST', cookie: a.cookie, signal: controller.signal,
      body: { clientRequestId: 'abort-message-001', expectedRevision: record.revision, text: 'Review transfers.', scope: scope(a.pair.address) } });
    await entered.promise; controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); await aborted.promise;
    await eventually(async () => !(await f.repo.get(a.pair.address, 'conversation', record.id)).data.operation);
    assert.equal((await f.repo.get(a.pair.address, 'conversation', record.id)).data.intentRevision, 0);
    assert.equal(f.counts().financialCalls, 0);
  } finally { await f.close(); }
});

test('expired operation cannot overwrite a newer refinement', async () => {
  const f = await setup(), entered = deferred(), release = deferred();
  try {
    const a = await f.login(), record = await f.conversation(a.cookie);
    f.control.refineHook = async () => { if (f.counts().refines === 1) { entered.resolve(); await release.promise; } };
    const first = f.message(a.cookie, record, { scope: scope(a.pair.address) }); await entered.promise; f.advance(90_001);
    const healed = await f.request(`/api/conversations/${record.id}`, { cookie: a.cookie }); assert.equal(healed.status, 200);
    const next = await f.message(a.cookie, healed.body, { id: 'new-message-request-002', scope: scope(keypair().address) });
    assert.equal(next.status, 200); release.resolve(); assert.equal((await first).status, 409);
    const current = await f.repo.get(a.pair.address, 'conversation', record.id);
    assert.equal(current.data.intent.wallet, next.body.intent.wallet); assert.equal(current.data.intentRevision, 1);
  } finally { release.resolve(); await f.close(); }
});

test('plan retries are idempotent, scope changes invalidate approval, and confirm never executes funds', async () => {
  const f = await setup();
  try {
    const a = await f.login(), record = await f.ready(a.cookie, a.pair.address);
    const proposed = await f.plan(a.cookie, record); assert.equal(proposed.status, 200);
    const replay = await f.plan(a.cookie, record); assert.equal(replay.status, 200); assert.equal(f.counts().plans, 1);
    const oldPlan = proposed.body.plan;
    const changed = await f.message(a.cookie, proposed.body, { id: 'changed-purpose-002', text: 'Use the revised scope.', scope: scope(keypair().address) });
    assert.equal(changed.status, 200);
    const stale = await f.request(`/api/conversations/${record.id}/confirm`, { method: 'POST', cookie: a.cookie,
      body: { expectedRevision: changed.body.revision, planHash: oldPlan.hash, ...scope(a.pair.address), acknowledge: true } });
    assert.equal(stale.status, 409); assert.equal((await f.request('/api/tasks', { cookie: a.cookie })).body.tasks.length, 0);
    const current = await f.plan(a.cookie, changed.body, 'plan-request-current'); assert.equal(current.status, 200);
    const body = { expectedRevision: current.body.revision, planHash: current.body.plan.hash,
      wallet: current.body.intent.wallet, windowStart: current.body.intent.windowStart, windowEnd: current.body.intent.windowEnd, acknowledge: true };
    const created = await f.request(`/api/conversations/${record.id}/confirm`, { method: 'POST', cookie: a.cookie, body });
    assert.equal(created.status, 201); assert.equal(created.body.payment, 'NOT_STARTED'); assert.equal(created.body.approval, null); assert.equal(created.body.quote, null);
    const again = await f.request(`/api/conversations/${record.id}/confirm`, { method: 'POST', cookie: a.cookie, body });
    assert.equal(again.status, 200); assert.equal(again.body.id, created.body.id);
    assert.equal((await f.request('/api/tasks', { cookie: a.cookie })).body.tasks.length, 1);
    assert.equal(f.counts().financialCalls, 0);
  } finally { await f.close(); }
});

test('confirm lease expiry preserves the frozen plan and same-intent retry links exactly one task', async () => {
  const f = await setup(), entered = deferred(), release = deferred(); let first;
  try {
    const a = await f.login(), record = await f.ready(a.cookie, a.pair.address);
    const proposed = await f.plan(a.cookie, record); assert.equal(proposed.status, 200);
    const body = { expectedRevision: proposed.body.revision, planHash: proposed.body.plan.hash,
      wallet: proposed.body.intent.wallet, windowStart: proposed.body.intent.windowStart,
      windowEnd: proposed.body.intent.windowEnd, acknowledge: true };
    f.control.addHook = async () => { if (f.counts().addCalls === 1) { entered.resolve(); await release.promise; } };
    first = f.request(`/api/conversations/${record.id}/confirm`, { method: 'POST', cookie: a.cookie, body });
    await entered.promise; f.advance(90_001);
    const healed = await f.request(`/api/conversations/${record.id}`, { cookie: a.cookie });
    assert.equal(healed.status, 200); assert.equal(healed.body.planLocked, true);
    assert.equal((await f.message(a.cookie, healed.body, { id: 'cannot-change-confirmed-plan' })).status, 409);
    assert.equal((await f.plan(a.cookie, healed.body, 'cannot-replan-confirmed')).status, 409);
    const retried = await f.request(`/api/conversations/${record.id}/confirm`, { method: 'POST', cookie: a.cookie,
      body: { ...body, expectedRevision: healed.body.revision } });
    assert.equal(retried.status, 201); release.resolve(); assert.equal((await first).status, 409);
    const final = await f.request(`/api/conversations/${record.id}`, { cookie: a.cookie });
    assert.equal(final.body.status, 'TASK_CREATED'); assert.equal(final.body.linkedTaskId, retried.body.id);
    const tasks = await f.request('/api/tasks', { cookie: a.cookie });
    assert.equal(tasks.body.tasks.length, 1); assert.equal(tasks.body.tasks[0].workspaceContext.planHash, body.planHash);
    assert.equal(f.counts().refines, 1); assert.equal(f.counts().plans, 1); assert.equal(f.counts().financialCalls, 0);
  } finally { release.resolve(); if (first) await first.catch(() => {}); await f.close(); }
});

test('confirm cannot validate an old plan against a newer guessed CAS revision', async () => {
  const f = await setup(); let originalGet;
  try {
    const a = await f.login(), record = await f.ready(a.cookie, a.pair.address);
    const proposed = await f.plan(a.cookie, record); assert.equal(proposed.status, 200);
    originalGet = f.repo.get.bind(f.repo); let armed = true;
    f.repo.get = async (owner, kind, id) => {
      const snapshot = await originalGet(owner, kind, id);
      if (armed && owner === a.pair.address && kind === 'conversation' && id === record.id) {
        armed = false;
        await f.repo.update(owner, kind, id, snapshot.revision, data => {
          data.intentRevision++;
          data.intent = { ...data.intent, purpose: 'Revised purpose after the old snapshot' };
          data.plan = { ...data.plan, hash: 'b'.repeat(64), intentRevision: data.intentRevision, scope: data.intent };
        });
      }
      return snapshot;
    };
    const response = await f.request(`/api/conversations/${record.id}/confirm`, { method: 'POST', cookie: a.cookie,
      body: { expectedRevision: proposed.body.revision + 1, planHash: proposed.body.plan.hash,
        wallet: proposed.body.intent.wallet, windowStart: proposed.body.intent.windowStart,
        windowEnd: proposed.body.intent.windowEnd, acknowledge: true } });
    assert.equal(response.status, 409);
    assert.equal((await f.request('/api/tasks', { cookie: a.cookie })).body.tasks.length, 0);
    const current = await originalGet(a.pair.address, 'conversation', record.id);
    assert.equal(current.data.plan.hash, 'b'.repeat(64)); assert.equal(current.data.linkedTaskId, null);
    assert.equal(f.counts().financialCalls, 0);
  } finally { if (originalGet) f.repo.get = originalGet; await f.close(); }
});

test('new message cannot use a guessed future revision after validating an old snapshot', async () => {
  const f = await setup(); let originalGet;
  try {
    const a = await f.login(), record = await f.conversation(a.cookie);
    originalGet = f.repo.get.bind(f.repo); let armed = true;
    f.repo.get = async (owner, kind, id) => {
      const snapshot = await originalGet(owner, kind, id);
      if (armed && owner === a.pair.address && kind === 'conversation' && id === record.id) {
        armed = false;
        await f.repo.update(owner, kind, id, snapshot.revision, data => { data.title = 'Newer concurrent state'; });
      }
      return snapshot;
    };
    const response = await f.message(a.cookie, { ...record, revision: record.revision + 1 }, { scope: scope(a.pair.address) });
    assert.equal(response.status, 409); assert.equal(f.counts().refines, 0);
    const current = await originalGet(a.pair.address, 'conversation', record.id);
    assert.equal(current.data.title, 'Newer concurrent state'); assert.equal(current.data.messages.length, 0);
    assert.equal(current.data.operation, null); assert.equal(f.counts().financialCalls, 0);
  } finally { if (originalGet) f.repo.get = originalGet; await f.close(); }
});

test('mandate scope mismatch refuses confirmation before freezing the conversation', async () => {
  const f = await setup();
  try {
    const a = await f.login(), record = await f.ready(a.cookie, a.pair.address);
    const proposed = await f.plan(a.cookie, record); assert.equal(proposed.status, 200);
    const mandate = await f.request('/api/mandates', { method: 'POST', cookie: a.cookie,
      body: { purpose: proposed.body.intent.purpose, ...scope(keypair().address), budgetAtomic: '1000',
        perPurchaseAtomic: '1000', maxExecutions: 1, expiresAt: new Date(f.now() + 60_000).toISOString(), acknowledge: true } });
    assert.equal(mandate.status, 201);
    const response = await f.request(`/api/conversations/${record.id}/confirm`, { method: 'POST', cookie: a.cookie,
      body: { expectedRevision: proposed.body.revision, planHash: proposed.body.plan.hash,
        wallet: proposed.body.intent.wallet, windowStart: proposed.body.intent.windowStart,
        windowEnd: proposed.body.intent.windowEnd, mandateId: mandate.body.id, acknowledge: true } });
    assert.equal(response.status, 409); assert.equal(response.body.error.code, 'MANDATE_SCOPE_DENIED');
    const current = await f.request(`/api/conversations/${record.id}`, { cookie: a.cookie });
    assert.equal(current.body.planLocked, false); assert.equal(current.body.linkedTaskId, null);
    assert.equal((await f.request('/api/tasks', { cookie: a.cookie })).body.tasks.length, 0);
    assert.equal(f.counts().financialCalls, 0);
  } finally { await f.close(); }
});

test('daily model quota and malformed model output fail before financial capabilities', async () => {
  const f = await setup({ ownerModelDailyLimit: 1 });
  try {
    const a = await f.login(), record = await f.ready(a.cookie, a.pair.address);
    const limited = await f.plan(a.cookie, record); assert.equal(limited.status, 429); assert.equal(limited.body.error.code, 'MODEL_DAILY_LIMIT');
    assert.equal(f.counts().plans, 0); assert.equal(f.counts().financialCalls, 0);
  } finally { await f.close(); }
  const invalid = await setup();
  try {
    const a = await invalid.login(), record = await invalid.conversation(a.cookie);
    invalid.control.refineOutput = { status: 'READY_TO_PLAN', execute_payment: true };
    const denied = await invalid.message(a.cookie, record); assert.equal(denied.status, 502);
    assert.equal((await invalid.repo.get(a.pair.address, 'conversation', record.id)).data.intentRevision, 0);
    assert.equal(invalid.counts().financialCalls, 0);
  } finally { await invalid.close(); }
});

test('unconfigured model returns an explicit failure without persisting a fake assistant turn', async () => {
  const f = await setup({ configured: false });
  try {
    const a = await f.login(), record = await f.conversation(a.cookie);
    const response = await f.message(a.cookie, record); assert.equal(response.status, 503); assert.equal(response.body.error.code, 'MODEL_NOT_CONFIGURED');
    assert.equal((await f.repo.get(a.pair.address, 'conversation', record.id)).data.messages.length, 0);
    assert.equal(f.counts().refines, 0); assert.equal(f.counts().financialCalls, 0);
  } finally { await f.close(); }
});
