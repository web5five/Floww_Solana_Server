import { randomUUID } from 'node:crypto';
import { canonical } from './policy.mjs';
import { digest } from './store.mjs';
import { exact, fail, ServiceError, isAddress, iso } from './config.mjs';

const RESOURCE = 'wallet-transfers';
const leaseMs = 90_000;
const cleanText = (value, max = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b-\x1f\x7f]/.test(value)) fail('INVALID_WORKSPACE_TEXT');
  if (/sk-[A-Za-z0-9_-]{12,}|\b(?:ghp_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{25,}|Bearer\s+\S+)|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value)) fail('SECRET_CONTENT_REJECTED');
  if (/(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b(?:javascript|data|mailto):\S|(?<!:)\/\/[A-Za-z0-9])/i.test(value)) fail('UNREGISTERED_RESOURCE_URL');
  return value.trim().normalize('NFC');
};
const initialIntent = () => ({ purpose: null, wallet: null, windowStart: null, windowEnd: null,
  resourceId: RESOURCE, missingFields: ['purpose', 'wallet', 'windowStart', 'windowEnd'] });
const requestId = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,96}$/.test(value)) fail('INVALID_CLIENT_REQUEST_ID');
  return value;
};
const code = error => error instanceof ServiceError ? error.code : 'PLANNING_UNAVAILABLE';
const recordView = (record, { before, at = Date.now() } = {}) => {
  const d = record.data, all = d.messages ?? [];
  if (before !== undefined && (typeof before !== 'string' || !/^[a-f0-9-]{36}$/.test(before))) fail('INVALID_MESSAGE_CURSOR');
  const end = before ? all.findIndex(m => m.id === before) : all.length;
  if (end < 0) fail('INVALID_MESSAGE_CURSOR');
  const messages = all.slice(Math.max(0, end - 20), end);
  return { id: record.id, revision: record.revision, title: d.title,
    createdAt: record.createdAt, updatedAt: record.updatedAt, status: d.status,
    intent: d.intent, intentRevision: d.intentRevision, useMemory: d.useMemory,
    messages, previousMessages: end > 20 ? messages[0].id : null,
    messageCount: all.length, plan: d.plan, linkedTaskId: d.linkedTaskId ?? null,
    planLocked: Boolean(d.confirmation), confirmedMandateId: d.confirmation?.mandateId ?? null,
    errorCode: d.errorCode ?? null,
    working: Boolean(d.operation && d.operation.expiresAt > at) };
};

/** No signing capability is provided to the conversational/remembered context. */
export function mountWorkspace(app, { repo, planner, mandates }, context) {
  const { config, store, auth, assertSession, now, respondTask, makeTask, adapterStatus } = context;
  const view = (record, options) => recordView(record, { at: now(), ...options });
  const ownerOf = async req => (await auth(req)).wallet;
  const send = async (req, res, owner, value, status = 200) => {
    await assertSession(req, owner); res.status(status).json(value);
  };
  const run = (req, owner, fn) => context.withOperation ? context.withOperation(req, owner, fn) : fn();
  const readyModel = () => { if (!config.model || !config.apiKey || !planner) fail('MODEL_NOT_CONFIGURED', 503); };
  const modelLimits = { globalLimit: config.globalModelDailyLimit ?? 60, ownerLimit: config.ownerModelDailyLimit ?? 20 };
  const modelInput = record => record.data.messages.slice(-12).map(({ id, role, text }) => ({ id, role, text }));
  async function callPlanner(req, res, operation, input) {
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', abort); res.once('close', abort);
    try { return await planner[operation](input, { signal: controller.signal }); }
    finally { req.off('aborted', abort); res.off('close', abort); }
  }
  async function memories(record, owner) {
    if (!record.data.useMemory) return [];
    return (await repo.page(owner, 'memory', { limit: 5 })).items;
  }
  async function memoryStillCurrent(owner, refs) {
    for (const ref of refs) {
      try { if ((await repo.get(owner, 'memory', ref.id)).revision !== ref.revision) fail('MEMORY_CHANGED', 409); }
      catch { fail('MEMORY_CHANGED', 409); }
    }
  }
  async function ensureNotLinked(owner, record) {
    if (record.data.linkedTaskId || record.data.confirmation) fail('CONVERSATION_ALREADY_LINKED', 409);
    try {
      const existing = await store.get(record.id, owner);
      if (existing.workspaceContext?.conversationId === record.id) fail('CONVERSATION_ALREADY_LINKED', 409);
    } catch (error) { if (!(error instanceof ServiceError) || error.code !== 'TASK_NOT_FOUND') throw error; }
  }
  async function begin(owner, id, body, kind, hash, change) {
    const original = await repo.get(owner, 'conversation', id);
    const previous = original.data.requests?.find(item => item.id === body.clientRequestId);
    if (previous) {
      if (previous.hash !== hash) fail('IDEMPOTENCY_CONFLICT', 409);
      return { replay: original };
    }
    if (adapterStatus?.workspaceAdapterReady !== true) fail('WORKSPACE_ADAPTER_UNAVAILABLE', 503);
    if (body.expectedRevision !== original.revision) fail('WORKSPACE_CHANGED', 409);
    await ensureNotLinked(owner, original);
    if (original.data.operation?.expiresAt > now()) fail('CONVERSATION_BUSY', 409);
    if (original.data.messages.length >= 98) fail('CONVERSATION_MESSAGE_LIMIT', 429);
    if (original.data.requests.length >= 100) fail('CONVERSATION_REQUEST_LIMIT', 429);
    const operation = { id: randomUUID(), kind, expiresAt: now() + leaseMs, clientRequestId: body.clientRequestId };
    const record = await repo.update(owner, 'conversation', id, original.revision, d => {
      if (d.confirmation || d.linkedTaskId) fail('CONVERSATION_ALREADY_LINKED', 409);
      if (d.operation?.expiresAt > now()) fail('CONVERSATION_BUSY', 409);
      change?.(d); d.operation = operation; d.errorCode = null;
      d.requests = [...(d.requests ?? []), { id: body.clientRequestId, hash }];
    });
    return { record, operation };
  }
  async function finish(owner, id, operation, change) {
    const current = await repo.get(owner, 'conversation', id);
    if (current.data.operation?.id !== operation.id || current.data.operation.expiresAt <= now()) fail('WORKSPACE_CHANGED', 409);
    return repo.update(owner, 'conversation', id, current.revision, d => { change(d); d.operation = null; });
  }
  async function stopped(owner, id, operation, error) {
    if (!operation) return;
    try {
      const current = await repo.get(owner, 'conversation', id);
      if (current.data.operation?.id === operation.id) await repo.update(owner, 'conversation', id, current.revision, d => {
        d.operation = null; d.errorCode = code(error); d.status = d.plan ? 'APPROVAL_REQUIRED' : 'ATTENTION_REQUIRED';
      });
    } catch { /* Keep the durable operation; an expired non-financial lease is retryable. */ }
  }
  function plannerFailure(result) {
    if (result?.status === 'STOPPED') {
      const value = typeof result.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(result.code) ? result.code : 'PLANNING_UNAVAILABLE';
      fail(value, ['INVALID_PLANNER_INPUT', 'UNSUPPORTED_INTENT', 'INVALID_PLAN'].includes(value) ? 422 : 503);
    }
  }
  function scope(body) {
    if (body === undefined) return {};
    exact(body, ['wallet', 'windowStart', 'windowEnd']);
    const value = {};
    if (body.wallet) { if (!isAddress(body.wallet)) fail('INVALID_WALLET'); value.wallet = body.wallet; }
    for (const key of ['windowStart', 'windowEnd']) if (body[key]) value[key] = iso(body[key]);
    return value;
  }
  function validateIntent(value, status) {
    const fields = ['purpose', 'wallet', 'windowStart', 'windowEnd', 'resourceId', 'missingFields'];
    exact(value, fields);
    if (Object.keys(value).length !== fields.length || !Array.isArray(value.missingFields) ||
        value.missingFields.length !== new Set(value.missingFields).size ||
        fields.slice(0, -1).some(key => (value[key] === null) !== value.missingFields.includes(key)) ||
        value.missingFields.some(key => !fields.slice(0, -1).includes(key)) ||
        (value.resourceId !== null && value.resourceId !== RESOURCE)) fail('INVALID_PLANNER_OUTPUT', 502);
    if (value.purpose !== null) cleanText(value.purpose);
    if (value.wallet !== null && !isAddress(value.wallet)) fail('INVALID_PLANNER_OUTPUT', 502);
    for (const key of ['windowStart', 'windowEnd']) if (value[key] !== null && iso(value[key]) !== value[key]) fail('INVALID_PLANNER_OUTPUT', 502);
    if (status === 'READY_TO_PLAN') {
      if (value.missingFields.length) fail('INVALID_PLANNER_OUTPUT', 502);
      makeTask({ purpose: value.purpose, wallet: value.wallet, windowStart: value.windowStart, windowEnd: value.windowEnd }, '__intent_validation__', now());
    }
  }
  function validateModelOutput(result, operation) {
    const metadata = ['executionKind', 'modelVersion', 'promptVersion'];
    exact(result, operation === 'refine' ? ['status', 'assistantText', 'intent', ...metadata] : ['status', 'summary', 'steps', 'limitations', ...metadata]);
    if (result.modelVersion !== config.model || result.promptVersion !== 'workspace/v3' ||
        result.executionKind !== (operation === 'refine' ? 'live_model_intent_refinement' : 'live_model_planner_critic')) fail('INVALID_PLANNER_OUTPUT', 502);
    if (operation === 'refine') {
      if (!['READY_TO_PLAN', 'CLARIFICATION_REQUIRED', 'UNSUPPORTED'].includes(result.status)) fail('INVALID_PLANNER_OUTPUT', 502);
      cleanText(result.assistantText, 800); validateIntent(result.intent, result.status);
    } else {
      if (result.status !== 'PROPOSED' || !Array.isArray(result.steps) || result.steps.length !== 1 || !Array.isArray(result.limitations) ||
          !result.limitations.length || result.limitations.length > 6) fail('INVALID_PLANNER_OUTPUT', 502);
      cleanText(result.summary, 800); result.limitations.forEach(value => cleanText(value, 512));
      for (const step of result.steps) {
        exact(step, ['role', 'capability', 'resourceId', 'reason']);
        if (step.role !== 'planner' || step.resourceId !== RESOURCE || step.capability !== RESOURCE) fail('INVALID_PLANNER_OUTPUT', 502);
        cleanText(step.reason, 512);
      }
    }
  }
  function validateModel(result, operation) {
    try { validateModelOutput(result, operation); }
    catch { fail('INVALID_PLANNER_OUTPUT', 502); }
  }
  // Heal only the deterministic plan-to-task linkage. Never run a model or
  // financial operation while reading a conversation after a process restart.
  async function readConversation(owner, id) {
    let record = await repo.get(owner, 'conversation', id);
    const operation = record.data.operation;
    if (record.data.linkedTaskId || operation?.expiresAt > now()) return record;
    let existing;
    if (record.data.confirmation || operation?.kind === 'confirm') {
      try { existing = await store.get(id, owner); }
      catch (error) { if (!(error instanceof ServiceError) || error.code !== 'TASK_NOT_FOUND') throw error; }
    }
    if (!operation && !existing) return record;
    if (operation?.kind === 'confirm' && !existing && record.data.errorCode === 'TASK_LINK_CONFIRMATION_REQUIRED') return record;
    try {
      record = await repo.update(owner, 'conversation', id, record.revision, d => {
        if (existing?.workspaceContext?.conversationId === id && existing.workspaceContext.planHash === d.plan?.hash) {
          d.linkedTaskId = existing.id; d.status = 'TASK_CREATED'; d.errorCode = null;
        } else if (operation?.kind === 'confirm' || d.confirmation) {
          d.status = 'LINKING'; d.errorCode = 'TASK_LINK_CONFIRMATION_REQUIRED';
        } else { d.status = d.plan ? 'APPROVAL_REQUIRED' : 'ATTENTION_REQUIRED'; d.errorCode = 'WORKSPACE_OPERATION_EXPIRED'; }
        if (operation?.kind !== 'confirm' || d.linkedTaskId) d.operation = null;
      });
    } catch (error) { if (error.code !== 'WORKSPACE_CHANGED') throw error; record = await repo.get(owner, 'conversation', id); }
    return record;
  }

  app.get('/api/catalog', async (req, res) => { const owner = await ownerOf(req); await send(req, res, owner, { resources: mandates.catalog() }); });
  app.get('/api/dashboard', async (req, res) => {
    const owner = await ownerOf(req);
    const [tasks, workspace, budget, activity] = await Promise.all([store.dashboard(owner), repo.counts(owner), mandates.dashboard(owner), repo.activity(owner, 8)]);
    await send(req, res, owner, { tasks, workspace, budget, activity });
  });
  app.get('/api/activity', async (req, res) => {
    const owner = await ownerOf(req), limit = Number(req.query.limit ?? 30);
    await send(req, res, owner, { events: await repo.activity(owner, limit) });
  });
  app.get('/api/conversations', async (req, res) => {
    const owner = await ownerOf(req);
    await send(req, res, owner, await repo.page(owner, 'conversation', { limit: Number(req.query.limit ?? 20), cursor: req.query.cursor }));
  });
  app.post('/api/conversations', async (req, res) => {
    const owner = await ownerOf(req); exact(req.body, ['title', 'useMemory']);
    if (req.body.useMemory !== undefined && typeof req.body.useMemory !== 'boolean') fail('INVALID_WORKSPACE_REQUEST');
    const record = await repo.create(owner, 'conversation', { title: req.body.title ? cleanText(req.body.title, 120) : '새 작업 대화',
      status: 'CLARIFICATION_REQUIRED', intent: initialIntent(), intentRevision: 0, useMemory: req.body.useMemory === true,
      messages: [], requests: [], plan: null, linkedTaskId: null, confirmation: null, operation: null });
    await send(req, res, owner, view(record), 201);
  });
  app.get('/api/conversations/:id', async (req, res) => {
    exact(req.query, ['before']);
    const owner = await ownerOf(req), record = await readConversation(owner, req.params.id);
    await send(req, res, owner, view(record, { before: req.query.before }));
  });
  app.post('/api/conversations/:id/messages', async (req, res) => {
    const owner = await ownerOf(req); exact(req.body, ['clientRequestId', 'expectedRevision', 'text', 'scope', 'interfaceLanguage']);
    const text = cleanText(req.body.text), explicitScope = scope(req.body.scope);
    const interfaceLanguage = req.body.interfaceLanguage;
    if (interfaceLanguage !== undefined && !['ko', 'en'].includes(interfaceLanguage)) fail('INVALID_INTERFACE_LANGUAGE');
    requestId(req.body.clientRequestId); readyModel();
    await run(req, owner, async () => {
      const hash = digest(canonical({ kind: 'message', text, explicitScope,
        ...(interfaceLanguage === undefined ? {} : { interfaceLanguage }) }));
      const claimed = await begin(owner, req.params.id, req.body, 'message', hash, d => {
        d.messages.push({ id: randomUUID(), role: 'user', text, at: new Date(now()).toISOString() });
        d.intent = { ...d.intent, ...explicitScope }; d.plan = null; d.status = 'REFINING';
        if (interfaceLanguage !== undefined) d.interfaceLanguage = interfaceLanguage;
        // The user's first request is a draft purpose, never inferred wallet,
        // time, authority or a successful model interpretation.
        if (d.messages.length === 1 && d.intent.purpose === null) d.intent.purpose = text;
        d.intent.missingFields = ['purpose', 'wallet', 'windowStart', 'windowEnd', 'resourceId'].filter(key => d.intent[key] === null);
        if (d.messages.length === 1) d.title = text.slice(0, 80);
      });
      if (claimed.replay) return send(req, res, owner, view(claimed.replay));
      const { record, operation } = claimed;
      try {
        const preferences = await memories(record, owner);
        await repo.reserveModel(owner, 1, modelLimits); await assertSession(req, owner);
        const result = await callPlanner(req, res, 'refine', { messages: modelInput(record), intent: record.data.intent,
          memories: preferences.map(m => ({ key: m.data.key, value: m.data.value })), catalog: mandates.catalog(), nowIso: new Date(now()).toISOString(),
          ...(record.data.interfaceLanguage === undefined ? {} : { interfaceLanguage: record.data.interfaceLanguage }) });
        await assertSession(req, owner); await memoryStillCurrent(owner, preferences); plannerFailure(result);
        validateModel(result, 'refine');
        for (const [key, value] of Object.entries(explicitScope)) if (result.intent[key] !== value) fail('MODEL_SCOPE_CHANGED', 422);
        const updated = await finish(owner, record.id, operation, d => {
          d.intent = result.intent; d.intentRevision++; d.status = result.status;
          d.messages.push({ id: randomUUID(), role: 'assistant', text: cleanText(result.assistantText), at: new Date(now()).toISOString(),
            executionKind: result.executionKind, modelVersion: result.modelVersion, promptVersion: result.promptVersion });
        });
        await send(req, res, owner, view(updated));
      } catch (error) { await stopped(owner, record.id, operation, error); throw error; }
    });
  });
  app.post('/api/conversations/:id/plan', async (req, res) => {
    const owner = await ownerOf(req); exact(req.body, ['clientRequestId', 'expectedRevision']); requestId(req.body.clientRequestId); readyModel();
    await run(req, owner, async () => {
      const current = await repo.get(owner, 'conversation', req.params.id);
      if (!['READY_TO_PLAN', 'APPROVAL_REQUIRED', 'ATTENTION_REQUIRED', 'PLANNING'].includes(current.data.status)) fail('INTENT_INCOMPLETE', 409);
      makeTask({ purpose: current.data.intent.purpose, wallet: current.data.intent.wallet,
        windowStart: current.data.intent.windowStart, windowEnd: current.data.intent.windowEnd }, owner, now());
      const claimed = await begin(owner, req.params.id, req.body, 'plan', digest(canonical({ kind: 'plan', intentRevision: current.data.intentRevision })), d => { d.status = 'PLANNING'; });
      if (claimed.replay) return send(req, res, owner, view(claimed.replay));
      const { record, operation } = claimed;
      try {
        const preferences = await memories(record, owner);
        await repo.reserveModel(owner, 2, modelLimits); await assertSession(req, owner);
        const result = await callPlanner(req, res, 'plan', { messages: modelInput(record), intent: record.data.intent,
          memories: preferences.map(m => ({ key: m.data.key, value: m.data.value })), catalog: mandates.catalog(), nowIso: new Date(now()).toISOString(),
          ...(record.data.interfaceLanguage === undefined ? {} : { interfaceLanguage: record.data.interfaceLanguage }) });
        await assertSession(req, owner); await memoryStillCurrent(owner, preferences); plannerFailure(result);
        validateModel(result, 'plan');
        const plan = { ...result, id: randomUUID(), intentRevision: record.data.intentRevision,
          scope: record.data.intent, createdAt: new Date(now()).toISOString() };
        plan.hash = digest(canonical(plan));
        const updated = await finish(owner, record.id, operation, d => { d.plan = plan; d.status = 'APPROVAL_REQUIRED'; });
        await send(req, res, owner, view(updated));
      } catch (error) { await stopped(owner, record.id, operation, error); throw error; }
    });
  });
  app.post('/api/conversations/:id/confirm', async (req, res) => {
    const owner = await ownerOf(req);
    exact(req.body, ['expectedRevision', 'planHash', 'wallet', 'windowStart', 'windowEnd', 'mandateId', 'acknowledge']);
    if (req.body.acknowledge !== true) fail('EXPLICIT_APPROVAL_REQUIRED');
    let record = await readConversation(owner, req.params.id);
    const plan = record.data.plan;
    if (!plan || plan.hash !== req.body.planHash || plan.intentRevision !== record.data.intentRevision) fail('PLAN_CHANGED', 409);
    for (const key of ['wallet', 'windowStart', 'windowEnd']) if (req.body[key] !== plan.scope[key]) fail('PLAN_SCOPE_CHANGED', 409);
    if (record.data.linkedTaskId) {
      const saved = await store.get(record.data.linkedTaskId, owner);
      if ((req.body.mandateId ?? null) !== saved.workspaceContext?.mandateId) fail('PLAN_SCOPE_CHANGED', 409);
      return respondTask(req, res, saved, owner);
    }
    if (req.body.expectedRevision !== record.revision) fail('WORKSPACE_CHANGED', 409);
    const confirmation = record.data.confirmation;
    if (confirmation && (confirmation.planHash !== plan.hash || confirmation.mandateId !== (req.body.mandateId ?? null))) fail('PLAN_SCOPE_CHANGED', 409);
    const mandate = req.body.mandateId ? await mandates.get(owner, req.body.mandateId) : null;
    if (mandate && (mandate.status !== 'ACTIVE' || (confirmation && mandate.version !== confirmation.mandateVersion))) fail('MANDATE_NOT_ACTIVE', 409);
    if (mandate && (mandate.purpose !== plan.scope.purpose.trim().normalize('NFC') || mandate.wallet !== req.body.wallet ||
        Date.parse(req.body.windowStart) < Date.parse(mandate.windowStart) || Date.parse(req.body.windowEnd) > Date.parse(mandate.windowEnd) ||
        mandate.resourceId !== RESOURCE || mandate.network !== config.network || mandate.asset !== config.asset || mandate.recipient !== config.merchantPayTo)) fail('MANDATE_SCOPE_DENIED', 409);
    const task = makeTask({ purpose: plan.scope.purpose, wallet: req.body.wallet, windowStart: req.body.windowStart, windowEnd: req.body.windowEnd }, owner, now(), {
      conversationId: record.id, planHash: plan.hash, intentRevision: plan.intentRevision,
      resourceId: RESOURCE, mandateId: mandate?.id ?? null, mandateVersion: mandate?.version ?? null,
    });
    task.id = record.id;
    const bodyHash = digest(canonical({ purpose: task.purpose, wallet: task.wallet, windowStart: task.windowStart, windowEnd: task.windowEnd, workspaceContext: task.workspaceContext }));
    if (confirmation && confirmation.bodyHash !== bodyHash) fail('PLAN_SCOPE_CHANGED', 409);
    const operation = { id: randomUUID(), kind: 'confirm', expiresAt: now() + leaseMs };
    record = await repo.update(owner, 'conversation', record.id, record.revision, d => {
      if (d.linkedTaskId || d.plan?.hash !== plan.hash || d.intentRevision !== plan.intentRevision) fail('PLAN_CHANGED', 409);
      if (d.operation?.expiresAt > now()) fail('CONVERSATION_BUSY', 409);
      if (d.confirmation && d.confirmation.bodyHash !== bodyHash) fail('PLAN_SCOPE_CHANGED', 409);
      d.confirmation ??= { planHash: plan.hash, mandateId: mandate?.id ?? null, mandateVersion: mandate?.version ?? null, bodyHash };
      d.operation = operation; d.status = 'LINKING';
    });
    try {
      await assertSession(req, owner);
      store.event(task, 'TASK_CREATED', 'QUOTE_REQUIRED');
      const saved = await store.add(task, { idempotencyKey: 'conversation:' + record.id,
        bodyHash });
      await finish(owner, record.id, operation, d => { d.linkedTaskId = saved.id; d.status = 'TASK_CREATED'; });
      await respondTask(req, res, saved, owner, 201);
    } catch (error) { await stopped(owner, record.id, operation, error); throw error; }
  });
  app.get('/api/memories', async (req, res) => {
    const owner = await ownerOf(req);
    await send(req, res, owner, await repo.page(owner, 'memory', { limit: Number(req.query.limit ?? 20), cursor: req.query.cursor }));
  });
  app.post('/api/memories', async (req, res) => {
    const owner = await ownerOf(req); exact(req.body, ['key', 'value', 'expiresAt', 'acknowledge']);
    if (req.body.acknowledge !== true) fail('EXPLICIT_MEMORY_CONSENT_REQUIRED');
    const key = cleanText(req.body.key, 64), value = cleanText(req.body.value, 512), expiresAt = iso(req.body.expiresAt);
    if (/budget|recipient|payee|mint|network|payer|sign|secret|api.?key|private.?key|password|passphrase|credential|seed.?phrase|mnemonic|access.?token|refresh.?token|authority|mandate|approval|permission|payment|execute|spend|wallet|예산|승인|결제|서명|수취|자금|토큰|지갑|기한|비밀번호|비밀키|시드|인증정보/i.test(key)) fail('MEMORY_IS_NOT_AUTHORITY');
    if (Date.parse(expiresAt) <= now() || Date.parse(expiresAt) > now() + 90 * 86_400_000) fail('INVALID_MEMORY_EXPIRY');
    const saved = await repo.create(owner, 'memory', { kind: 'PREFERENCE', key, value, expiresAt, acknowledge: true, origin: 'USER_CONFIRMED' });
    await send(req, res, owner, saved, 201);
  });
  app.delete('/api/memories/:id', async (req, res) => {
    const owner = await ownerOf(req); exact(req.body, ['expectedRevision']);
    await repo.remove(owner, 'memory', req.params.id, req.body.expectedRevision);
    await assertSession(req, owner); res.sendStatus(204);
  });
  app.get('/api/mandates', async (req, res) => { const owner = await ownerOf(req); await send(req, res, owner, { mandates: await mandates.list(owner) }); });
  app.post('/api/mandates', async (req, res) => { const owner = await ownerOf(req); await send(req, res, owner, await mandates.create(owner, req.body), 201); });
  app.post('/api/mandates/:id/revoke', async (req, res) => {
    const owner = await ownerOf(req); exact(req.body, ['expectedVersion']);
    await send(req, res, owner, await mandates.revoke(owner, req.params.id, req.body.expectedVersion));
  });
}
