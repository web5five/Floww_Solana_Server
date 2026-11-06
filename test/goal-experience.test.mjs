import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, html, client, taskClient, A, B, TASK_A, TASK_B, CONVERSATION_A, deferred, response,
  settle, until, task, overview, conversation } from './ui-harness.mjs';

// Scripted transport/identity/model responses exercise the actual UI clients.
// No wallet cryptography, model provider or external payment is invoked here.
const fullClient = taskClient + '\n' + client;
const normalized = value => JSON.parse(JSON.stringify(value));
const count = (h, suffix) => h.calls.filter(call => call.url.endsWith(suffix) && call.method === 'POST').length;
function initialConversation() {
  const c = conversation(CONVERSATION_A, A, false);
  c.status = 'CLARIFICATION_REQUIRED'; c.messages = []; c.intentRevision = 0;
  c.intent = { purpose: null, wallet: null, windowStart: null, windowEnd: null,
    resourceId: 'wallet-transfers', missingFields: ['purpose', 'wallet', 'windowStart', 'windowEnd'] };
  return c;
}
function readyConversation(status = 'READY_TO_PLAN') {
  const c = conversation(CONVERSATION_A, A, false); c.status = status; c.revision = 2;
  if (status === 'CLARIFICATION_REQUIRED') { c.intent.wallet = null; c.intent.missingFields = ['wallet']; }
  return c;
}
function standardRead(call, current = initialConversation()) {
  if (call.url === '/api/dashboard') return response(overview());
  if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
  if (call.url === '/api/catalog') return response({ resources: [] });
  if (call.url === '/api/mandates') return response({ mandates: [] });
  if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
  if (call.url === '/api/conversations/' + CONVERSATION_A) return response(current);
  throw new Error('Unexpected request: ' + call.url);
}
function phantom(h, wallet = A, declineFirst = false) {
  let connects = 0;
  h.window.phantom = { solana: { isPhantom: true,
    connect: async () => { if (++connects === 1 && declineFirst) throw new Error('Scripted user cancellation'); return { publicKey: { toString: () => wallet } }; },
    signMessage: async () => ({ signature: new Uint8Array(64) }), on() {} } };
  return () => connects;
}

test('goal-first document has balanced structural tags and one movable execution column', () => {
  const stack = [], voids = new Set(['meta', 'link', 'input', 'br', 'hr', 'img']);
  for (const [, closing, tag, attrs] of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    if (closing) assert.equal(stack.pop(), tag.toLowerCase(), 'unbalanced closing tag ' + tag);
    else if (!voids.has(tag.toLowerCase()) && !attrs.trim().endsWith('/')) stack.push(tag.toLowerCase());
  }
  assert.deepEqual(stack, []);
  const h = harness(client, () => { throw new Error('No private API is expected for a guest'); });
  assert.equal(h.document.querySelector('[data-page=assistant]').hidden, false);
  assert.equal(h.document.querySelector('[data-page=overview]').hidden, true);
  assert.equal(h.document.querySelectorAll('#task-execution-column').length, 1);
  assert.ok(h.get('task-execution-home').contains(h.get('task-execution-column')));
  const dialogue = h.document.querySelector('.dialogue-panel');
  assert.ok(dialogue.children.indexOf(h.get('message-form')) < dialogue.children.indexOf(h.get('dialogue-empty')),
    'the goal input must precede the optional welcome content in native reading order');
});

test('guest draft remains editable during session bootstrap but cannot start login before readiness', async () => {
  const restoring = deferred(); let requested = false;
  const h = harness(fullClient, call => {
    if (call.url === '/api/health') return response({ workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true, ready: false });
    if (call.url === '/api/session') { requested = true; return restoring.promise; }
    throw new Error('Unexpected request before authentication: ' + call.url);
  });
  const connects = phantom(h, A, true);
  await until(() => requested);
  assert.equal(h.get('message-text').disabled, false); assert.equal(h.get('send-message').disabled, true);
  h.get('message-text').value = 'A goal typed before session restoration finishes';
  await h.get('message-text').trigger('input');
  await h.get('message-form').trigger('submit'); await settle();
  assert.equal(connects(), 0); assert.ok(h.calls.every(call => ['/api/health', '/api/session'].includes(call.url)));
  restoring.resolve(response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401));
  await until(() => h.get('send-message').disabled === false);
  assert.equal(connects(), 0);
  assert.equal(h.get('message-text').value, 'A goal typed before session restoration finishes');
  await h.get('message-form').trigger('submit'); await settle();
  assert.equal(connects(), 1); assert.ok(h.calls.every(call => ['/api/health', '/api/session'].includes(call.url)));
  h.emit('floww:session-refresh'); await settle();
  assert.equal(connects(), 1); assert.equal(h.get('message-text').value, 'A goal typed before session restoration finishes');
});

test('guest draft sends no protected requests and resumes exactly once after explicit successful login', async () => {
  const verifying = deferred(); let owner = null, verifyStarted = false, message, current = initialConversation();
  const h = harness(fullClient, call => {
    if (call.url === '/api/health') return response({ workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true, ready: false, merchantConfigured: true });
    if (call.url === '/api/session') return response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401);
    if (call.url === '/api/auth/challenge') return response({ challengeId: 'scripted', message: 'Scripted local login' });
    if (call.url === '/api/auth/verify') { verifyStarted = true; return verifying.promise; }
    if (call.url === '/api/conversations' && call.method === 'POST') { assert.equal(owner, A); return response(current, 201); }
    if (call.url.endsWith('/messages')) { assert.equal(owner, A); message = call.body; current = readyConversation(); return response(current); }
    if (call.url.endsWith('/plan')) { current = { ...conversation(CONVERSATION_A, A), revision: 3 }; return response(current); }
    assert.equal(owner, A, 'protected request before authenticated session');
    return standardRead(call, current);
  });
  await until(() => h.get('connect-wallet').disabled === false);
  const connects = phantom(h);
  h.get('message-text').value = 'Keep this exact guest goal'; h.get('intent-wallet').value = A;
  h.get('intent-start').value = '2026-11-04T09:00:00'; h.get('intent-end').value = '2026-11-05T09:00:00';
  const expected = { wallet: A, windowStart: new Date(h.get('intent-start').value).toISOString(), windowEnd: new Date(h.get('intent-end').value).toISOString() };
  await h.get('message-text').trigger('input'); await settle();
  assert.ok(h.calls.every(call => ['/api/health', '/api/session'].includes(call.url)));
  await h.get('message-form').trigger('submit'); await until(() => verifyStarted);
  assert.equal(connects(), 1); assert.equal(count(h, '/messages'), 0); assert.equal(count(h, '/plan'), 0);
  owner = A; verifying.resolve(response({ wallet: A })); await until(() => count(h, '/plan') === 1); await settle();
  assert.equal(message.text, 'Keep this exact guest goal'); assert.deepEqual(normalized(message.scope), expected);
  h.emit('floww:session-refresh'); h.session(A, { ready: false, merchantConfigured: true }); await settle();
  assert.equal(count(h, '/messages'), 1); assert.equal(count(h, '/plan'), 1);
  assert.equal(h.calls.filter(call => call.url === '/api/conversations' && call.method === 'POST').length, 1);
  assert.equal(count(h, '/confirm'), 0); assert.equal(count(h, '/approve'), 0); assert.equal(count(h, '/execute'), 0);
  assert.equal(h.get('confirm-plan').disabled, false); assert.deepEqual(h.backgroundErrors, []);
});

test('cancelled explicit login keeps the guest draft and never retries login or a model by itself', async () => {
  let owner = null, current = initialConversation();
  const h = harness(fullClient, call => {
    if (call.url === '/api/health') return response({ workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true, ready: false });
    if (call.url === '/api/session') return response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401);
    if (call.url === '/api/auth/challenge') return response({ challengeId: 'scripted', message: 'Scripted local login' });
    if (call.url === '/api/auth/verify') { owner = A; return response({ wallet: A }); }
    if (call.url === '/api/conversations' && call.method === 'POST') return response(current, 201);
    if (call.url.endsWith('/messages')) { current = readyConversation('CLARIFICATION_REQUIRED'); return response(current); }
    assert.equal(owner, A); return standardRead(call, current);
  });
  await until(() => h.get('connect-wallet').disabled === false);
  const connects = phantom(h, A, true); h.get('message-text').value = 'A goal I do not want to lose';
  await h.get('message-form').trigger('submit'); await until(() => connects() === 1); await settle();
  assert.equal(h.get('message-text').value, 'A goal I do not want to lose'); assert.equal(h.get('send-message').disabled, false);
  h.emit('floww:session-refresh'); await settle();
  assert.equal(connects(), 1); assert.equal(count(h, '/messages'), 0); assert.equal(count(h, '/plan'), 0);
  await h.get('message-form').trigger('submit'); await until(() => count(h, '/messages') === 1); await settle();
  assert.equal(connects(), 2); assert.equal(count(h, '/messages'), 1); assert.equal(count(h, '/plan'), 0);
});

for (const status of ['READY_TO_PLAN', 'CLARIFICATION_REQUIRED', 'UNSUPPORTED']) test(`${status} only prepares a plan when the refined intent is ready`, async () => {
  let current = initialConversation();
  const h = harness(client, call => {
    if (call.url === '/api/conversations' && call.method === 'POST') return response(current, 201);
    if (call.url.endsWith('/messages')) { current = readyConversation(status); return response(current); }
    if (call.url.endsWith('/plan')) { current = { ...conversation(CONVERSATION_A, A), revision: 3 }; return response(current); }
    return standardRead(call, current);
  });
  h.session(A); await settle(); h.get('message-text').value = 'Analyze the selected wallet transfers';
  await h.get('message-form').trigger('submit'); await until(() => count(h, '/messages') === 1); await settle();
  assert.equal(count(h, '/plan'), status === 'READY_TO_PLAN' ? 1 : 0);
  h.session(A); await h.nav('overview'); await h.nav('assistant'); await settle();
  assert.equal(count(h, '/plan'), status === 'READY_TO_PLAN' ? 1 : 0);
  assert.equal(count(h, '/confirm'), 0); assert.equal(count(h, '/approve'), 0); assert.equal(count(h, '/execute'), 0);
});

test('an automatic plan failure stops at one attempt and leaves an explicit retry choice', async () => {
  let current = initialConversation();
  const h = harness(client, call => {
    if (call.url === '/api/conversations' && call.method === 'POST') return response(current, 201);
    if (call.url.endsWith('/messages')) { current = readyConversation(); return response(current); }
    if (call.url.endsWith('/plan')) return response({ error: { code: 'WORKSPACE_MODEL_UNAVAILABLE' } }, 503);
    return standardRead(call, current);
  });
  h.session(A); await settle(); h.get('message-text').value = 'A bounded analysis goal';
  await h.get('message-form').trigger('submit'); await until(() => count(h, '/plan') === 1); await settle();
  await h.nav('overview'); await h.nav('assistant'); h.session(A); await settle();
  assert.equal(count(h, '/plan'), 1); assert.equal(h.get('build-plan').hidden, false); assert.equal(h.get('build-plan').disabled, false);
  assert.match(h.get('shell-status').textContent, /응답|요청|확인/); assert.equal(count(h, '/confirm'), 0);
});

test('editing the visible scope blocks confirming the old plan until that edit is incorporated', async () => {
  const current = conversation(CONVERSATION_A, A);
  const h = harness(client, call => {
    if (call.url.startsWith('/api/conversations?')) return response({ items: [{ id: current.id,
      data: { title: current.title, status: current.status }, updatedAt: current.messages[0].at }], nextCursor: null });
    return standardRead(call, current);
  });
  h.session(A); await settle(); await h.get('conversation-list').children[0].trigger('click'); await settle();
  assert.equal(h.get('confirm-plan').disabled, false);
  h.get('intent-wallet').value = '   '; await h.get('intent-wallet').trigger('input');
  assert.equal(h.get('confirm-plan').disabled, true, 'a whitespace-only wallet is a visible scope clear');
  h.get('intent-wallet').value = A; await h.get('intent-wallet').trigger('input');
  assert.equal(h.get('confirm-plan').disabled, false);
  h.get('intent-wallet').value = B; await h.get('intent-wallet').trigger('input');
  assert.equal(h.get('confirm-plan').disabled, true);
  await h.get('confirm-plan-form').trigger('submit'); await settle();
  assert.equal(count(h, '/confirm'), 0); assert.equal(count(h, '/approve'), 0);
  assert.match(h.get('shell-status').textContent, /範囲|범위|계획|조건/);
});

function millisecondConversation() {
  const current = conversation(CONVERSATION_A, A);
  const scope = { ...current.intent, windowStart: '2026-11-04T00:00:00.123Z', windowEnd: '2026-11-05T00:00:00.456Z' };
  current.intent = scope; current.plan = { ...current.plan, scope };
  return current;
}

test('untouched second-resolution fields confirm the exact original server millisecond window', async () => {
  const current = millisecondConversation(); let submitted, linked = false;
  const h = harness(client, call => {
    if (call.url.startsWith('/api/conversations?')) return response({ items: [{ id: current.id,
      data: { title: current.title, status: current.status }, updatedAt: current.messages[0].at }], nextCursor: null });
    if (call.url === '/api/conversations/' + CONVERSATION_A) return response(linked ? { ...current, linkedTaskId: TASK_A } : current);
    if (call.url.endsWith('/confirm')) { submitted = call.body; linked = true; return response(task(TASK_A, current.title), 201); }
    return standardRead(call, current);
  });
  h.session(A); await settle(); await h.get('conversation-list').children[0].trigger('click'); await settle();
  assert.match(h.get('intent-start').value, /T\d\d:\d\d:\d\d$/);
  assert.match(h.get('intent-end').value, /T\d\d:\d\d:\d\d$/);
  assert.equal(h.get('intent-start').value.includes('.123'), false);
  assert.equal(h.get('intent-end').value.includes('.456'), false);
  assert.equal(h.get('confirm-plan').disabled, false);
  await h.get('confirm-plan-form').trigger('submit'); await until(() => submitted);
  assert.equal(submitted.planHash, current.plan.hash);
  assert.equal(submitted.windowStart, '2026-11-04T00:00:00.123Z');
  assert.equal(submitted.windowEnd, '2026-11-05T00:00:00.456Z');
  assert.equal(submitted.acknowledge, true); assert.equal(count(h, '/approve'), 0); assert.equal(count(h, '/execute'), 0);
});

test('a style-only message omits unchanged scope instead of replacing server milliseconds with displayed seconds', async () => {
  let current = millisecondConversation(), submitted;
  const originalScope = normalized(current.intent);
  const h = harness(client, call => {
    if (call.url.startsWith('/api/conversations?')) return response({ items: [{ id: current.id,
      data: { title: current.title, status: current.status }, updatedAt: current.messages[0].at }], nextCursor: null });
    if (call.url.endsWith('/messages')) {
      submitted = call.body;
      current = { ...current, revision: 2, intentRevision: 2, status: 'READY_TO_PLAN', plan: null };
      return response(current);
    }
    if (call.url.endsWith('/plan')) {
      const planned = millisecondConversation();
      current = { ...current, revision: 3, status: 'APPROVAL_REQUIRED', plan: { ...planned.plan, intentRevision: 2 } };
      return response(current);
    }
    return standardRead(call, current);
  });
  h.session(A); await settle(); await h.get('conversation-list').children[0].trigger('click'); await settle();
  h.get('message-text').value = '같은 지갑과 기간을 유지하고 한국어로 더 간결하게 정리해 주세요.';
  await h.get('message-form').trigger('submit'); await until(() => submitted); await settle();
  assert.deepEqual(normalized(submitted.scope), {});
  assert.equal(submitted.text, '같은 지갑과 기간을 유지하고 한국어로 더 간결하게 정리해 주세요.');
  assert.deepEqual(normalized(current.intent), originalScope);
  assert.equal(current.plan.scope.windowStart, '2026-11-04T00:00:00.123Z');
  assert.equal(current.plan.scope.windowEnd, '2026-11-05T00:00:00.456Z');
  assert.equal(h.get('confirm-plan').disabled, false);
  assert.equal(count(h, '/confirm'), 0); assert.equal(count(h, '/approve'), 0); assert.equal(count(h, '/execute'), 0);
});

test('a different owner cannot inject a linked task into the inline result or journey', async () => {
  const current = { ...conversation(CONVERSATION_A, A), linkedTaskId: TASK_A, planLocked: true };
  const h = harness(client, call => {
    if (call.url.startsWith('/api/conversations?')) return response({ items: [{ id: current.id,
      data: { title: current.title, status: current.status }, updatedAt: current.messages[0].at }], nextCursor: null });
    return standardRead(call, current);
  });
  h.session(A); await settle(); await h.get('conversation-list').children[0].trigger('click'); await settle();
  h.emit('floww:selection', { wallet: B, task: { ...task(TASK_A, 'FOREIGN_PRIVATE_TASK'), result: { answer: { answer_text: 'FOREIGN_PRIVATE_RESULT' } } }, busy: false });
  assert.ok(h.get('task-execution-home').contains(h.get('task-execution-column')));
  assert.doesNotMatch(h.get('journey-title').textContent + h.get('journey-copy').textContent, /FOREIGN_PRIVATE/);
  assert.equal(count(h, '/approve'), 0); assert.equal(count(h, '/execute'), 0);
});

function quotedTask({ expired = false, policy = 'PENDING' } = {}) {
  const value = task(TASK_A, 'Selected exact analysis'); value.policy = policy;
  value.quote = { hash: 'a'.repeat(64), amountAtomic: '1250000', asset: 'scripted-devnet-mint', assetDecimals: 6,
    network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', recipient: '11111111111111111111111111111113', payer: B,
    resourceUrl: 'https://scripted.invalid/merchant/reports/' + TASK_A,
    expiresAt: new Date(Date.now() + (expired ? -120_000 : 240_000)).toISOString() };
  if (policy === 'ALLOW') value.approval = { id: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee', quoteHash: value.quote.hash,
    payer: B, budgetAtomic: '1250000', expiresAt: new Date(Date.now() + 120_000).toISOString(), revoked: false };
  return value;
}
async function financialFixture({ ready = true, expired = false, policy = 'PENDING', onApprove } = {}) {
  let value = quotedTask({ expired, policy });
  const linked = { ...conversation(CONVERSATION_A, A), linkedTaskId: TASK_A, planLocked: true };
  const h = harness(fullClient, async call => {
    if (call.url === '/api/health') return response({ workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true, ready, merchantConfigured: true, payer: B });
    if (call.url === '/api/session') return response({ wallet: A });
    if (call.url === '/api/tasks/' + TASK_A) return response(value);
    if (call.url === '/api/tasks/' + TASK_B) return response(task(TASK_B, 'Other requested analysis'));
    if (call.url === '/api/tasks/' + TASK_A + '/approve') {
      const approved = { ...value, revision: 2, policy: 'ALLOW', approval: {
        id: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee', quoteHash: call.body.quoteHash,
        payer: B, budgetAtomic: call.body.budgetAtomic, expiresAt: call.body.expiresAt, revoked: false } };
      return onApprove ? onApprove(approved, call, h) : response(value = approved);
    }
    if (call.url === '/api/tasks/' + TASK_A + '/execute') return response(value = { ...value, revision: 3, payment: 'UNKNOWN', delivery: 'PENDING' });
    if (call.url.startsWith('/api/conversations?')) return response({ items: [{ id: linked.id,
      data: { title: linked.title, status: linked.status }, updatedAt: linked.messages[0].at }], nextCursor: null });
    if (call.url === '/api/conversations/' + CONVERSATION_A) return response(linked);
    return standardRead(call, linked);
  });
  await until(() => h.get('logout').disabled === false); await settle();
  await h.get('conversation-list').children[0].trigger('click');
  await until(() => h.get('task-execution-column').parentNode === h.get('assistant-task-slot'));
  return h;
}

test('confirming the visible plan prepares one quote inline without any financial approval', async () => {
  const plan = conversation(CONVERSATION_A, A); let linked = false, value = task(TASK_A, plan.title);
  const h = harness(fullClient, call => {
    if (call.url === '/api/health') return response({ workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true, ready: false, merchantConfigured: true });
    if (call.url === '/api/session') return response({ wallet: A });
    if (call.url.startsWith('/api/conversations?')) return response({ items: [{ id: plan.id,
      data: { title: plan.title, status: plan.status }, updatedAt: plan.messages[0].at }], nextCursor: null });
    if (call.url === '/api/conversations/' + CONVERSATION_A) return response(linked ? { ...plan, linkedTaskId: TASK_A, planLocked: true } : plan);
    if (call.url.endsWith('/confirm')) { linked = true; return response(value, 201); }
    if (call.url === '/api/tasks/' + TASK_A) return response(value);
    if (call.url === '/api/tasks/' + TASK_A + '/quote') return response(value = { ...quotedTask(), purpose: plan.title, revision: 2 });
    return standardRead(call, plan);
  });
  const originalColumn = h.get('task-execution-column');
  await until(() => h.get('logout').disabled === false); await settle();
  await h.get('conversation-list').children[0].trigger('click'); await settle();
  assert.equal(count(h, '/quote'), 0);
  await h.get('confirm-plan-form').trigger('submit'); await until(() => count(h, '/quote') === 1); await settle();
  assert.equal(h.document.querySelector('[data-page=assistant]').hidden, false);
  assert.equal(h.document.querySelector('[data-page=tasks]').hidden, true);
  assert.equal(h.get('task-execution-column'), originalColumn);
  assert.equal(originalColumn.parentNode, h.get('assistant-task-slot'));
  assert.equal(h.get('approval-ack').checked, false);
  assert.equal(count(h, '/approve'), 0); assert.equal(count(h, '/execute'), 0);
  h.emit('floww:select-task', { id: TASK_A, prepareQuote: true }); await settle();
  assert.equal(count(h, '/quote'), 1);
});

for (const [ready, expired, policy] of [[false, false, 'PENDING'], [false, false, 'ALLOW'],
  [true, true, 'PENDING'], [true, true, 'ALLOW']]) test(`inline ${policy} controls stay disabled when ${expired ? 'quote expired' : 'payment runtime unready'}`, async () => {
  const h = await financialFixture({ ready, expired, policy });
  h.get('approval-ack').checked = true; await h.get('approval-ack').trigger('change');
  await h.nav('budgets'); await h.nav('assistant'); await settle();
  assert.equal(h.get('approve-task').disabled, true);
  assert.equal(h.get('execute-task').disabled, true);
  assert.equal(count(h, '/approve'), 0); assert.equal(count(h, '/execute'), 0);
});

test('one explicit financial acknowledgement converts the human amount and approves then executes only that quote', async () => {
  const h = await financialFixture();
  const parties = h.get('quote-parties'), recipient = '11111111111111111111111111111113';
  assert.match(parties.textContent, /결제 지갑/); assert.match(parties.textContent, /수신자/); assert.match(parties.textContent, /토큰 mint/);
  assert.ok(parties.textContent.includes(B.slice(-6))); assert.ok(parties.textContent.includes(recipient.slice(-6)));
  assert.ok(parties.textContent.includes('scripted-devnet-mint'.slice(-6)));
  for (let node = parties; node; node = node.parentNode) {
    assert.notEqual(node.tagName, 'DETAILS', 'quote parties must remain visible outside optional technical details');
    assert.equal(node.hidden, false);
  }
  assert.ok(h.get('quote-details').textContent.includes(B));
  assert.ok(h.get('quote-details').textContent.includes(recipient));
  assert.ok(h.get('quote-details').textContent.includes('scripted-devnet-mint'));
  assert.equal(h.get('budget').value, '1.25'); assert.equal(count(h, '/approve'), 0); assert.equal(count(h, '/execute'), 0);
  h.get('budget').value = '1.5'; await h.get('budget').trigger('input');
  await h.get('approval-form').trigger('submit'); await settle();
  assert.equal(count(h, '/approve'), 0); assert.equal(count(h, '/execute'), 0);
  h.get('approval-ack').checked = true; await h.get('approval-ack').trigger('change');
  assert.equal(h.get('approve-task').disabled, false);
  await h.get('approval-form').trigger('submit'); await until(() => count(h, '/execute') === 1); await settle();
  const approved = h.calls.find(call => call.url.endsWith('/approve')), executed = h.calls.find(call => call.url.endsWith('/execute'));
  assert.equal(approved.body.budgetAtomic, '1500000'); assert.equal(approved.body.acknowledge, true);
  assert.equal(approved.body.quoteHash, 'a'.repeat(64));
  assert.equal(executed.url, '/api/tasks/' + TASK_A + '/execute');
  assert.equal(executed.body.approvalId, 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee');
  assert.equal(count(h, '/approve'), 1); assert.equal(count(h, '/execute'), 1);
  h.emit('floww:session-expired', { wallet: A }); await settle();
  assert.equal(h.get('quote-parties').textContent, '');
});

for (const change of ['task-id', 'quote-hash', 'approval-quote-hash', 'missing-approval', 'budget', 'scope']) test(`mismatched approved ${change} never reaches execute`, async () => {
  const h = await financialFixture({ onApprove: approved => {
    if (change === 'task-id') approved.id = TASK_B;
    if (change === 'quote-hash') approved.quote = { ...approved.quote, hash: 'b'.repeat(64) };
    if (change === 'approval-quote-hash') approved.approval.quoteHash = 'b'.repeat(64);
    if (change === 'missing-approval') delete approved.approval;
    if (change === 'budget') approved.approval.budgetAtomic = '999999999';
    if (change === 'scope') approved.wallet = B;
    return response(approved);
  } });
  h.get('approval-ack').checked = true; await h.get('approval-ack').trigger('change');
  await h.get('approval-form').trigger('submit'); await settle();
  assert.equal(count(h, '/approve'), 1); assert.equal(count(h, '/execute'), 0);
});

for (const invalidation of ['selection', 'session']) test(`changing ${invalidation} while approval is pending prevents automatic execution`, async () => {
  const pending = deferred(); let approved;
  const h = await financialFixture({ onApprove: value => { approved = value; return pending.promise; } });
  h.get('approval-ack').checked = true; await h.get('approval-ack').trigger('change');
  await h.get('approval-form').trigger('submit'); await until(() => approved);
  if (invalidation === 'selection') h.emit('floww:select-task', { id: TASK_B });
  else h.emit('floww:session-expired', { wallet: A });
  pending.resolve(response(approved)); await settle();
  assert.equal(count(h, '/execute'), 0);
  if (invalidation === 'session') assert.equal(h.get('logout').hidden, true);
});

test('mandate human amounts are canonical atomic strings and excess precision cannot create a mandate', async () => {
  let saved;
  const h = harness(client, call => {
    if (call.url === '/api/mandates' && call.method === 'POST') { saved = call.body; return response({ id: 'scripted-mandate' }, 201); }
    return standardRead(call);
  });
  h.session(A, { ready: false, merchantConfigured: true }); await settle();
  h.get('mandate-purpose').value = 'Bounded wallet transfers'; h.get('mandate-wallet').value = A;
  h.get('mandate-total').value = '0.002'; h.get('mandate-per').value = '0.001'; h.get('mandate-count').value = '2'; h.get('mandate-ack').checked = true;
  await h.get('mandate-form').trigger('submit'); await until(() => saved); await settle();
  assert.equal(saved.budgetAtomic, '2000'); assert.equal(saved.perPurchaseAtomic, '1000');
  assert.equal(saved.maxExecutions, 2); assert.equal(saved.acknowledge, true);
  h.get('mandate-per').value = '0.0000001'; h.get('mandate-ack').checked = true;
  await h.get('mandate-form').trigger('submit'); await settle();
  assert.equal(h.calls.filter(call => call.url === '/api/mandates' && call.method === 'POST').length, 1);
});
