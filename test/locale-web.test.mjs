import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, client, taskClient, A, B, TASK_A, TASK_B, CONVERSATION_A,
  deferred, response, settle, until, task, overview, conversation } from './ui-harness.mjs';

// Actual browser clients and locale code, with inert scripted DOM/transport.
// These checks establish state/contract behavior, not visual layout, wallet
// cryptography, model quality or an external payment/delivery result.
const fullClient = taskClient + '\n' + client;
const pathA = '/api/tasks/' + TASK_A;
const count = (h, path, method = 'POST') => h.calls.filter(call => call.url === path && call.method === method).length;
const switchTo = async (h, language) => { h.get('interface-language').value = language; await h.get('interface-language').trigger('change'); };

function quotedTask(policy = 'PENDING') {
  const t = task(TASK_A, '사용자가 한국어로 적은 목적');
  t.quote = { hash: 'a'.repeat(64), amountAtomic: '9007199254740993', assetDecimals: 9,
    asset: 'scripted-mint', recipient: B, payer: A, network: 'solana:devnet',
    resourceUrl: 'https://scripted.invalid/reports/' + TASK_A, expiresAt: new Date(Date.now() + 240_000).toISOString() };
  t.proposal = { explanation: '모델이 반환한 설명 원문' }; t.policy = policy;
  if (policy !== 'PENDING') t.approval = { id: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee',
    quoteHash: t.quote.hash, payer: A, budgetAtomic: t.quote.amountAtomic,
    expiresAt: new Date(Date.now() + 120_000).toISOString(), revoked: false };
  return t;
}

async function fixture({ value = quotedTask(), shell = true, language = 'ko' } = {}) {
  const c = conversation(CONVERSATION_A, A);
  c.title = value.purpose; c.messages[0].text = '사용자가 남긴 대화 원문';
  c.plan.summary = '모델의 계획 원문'; c.plan.steps[0].reason = '모델의 선택 근거 원문';
  c.plan.limitations = ['자료가 명시한 제한 원문']; c.linkedTaskId = TASK_A; c.planLocked = true; c.status = 'TASK_CREATED';
  const control = { owner: A, value, read: null, approve: null };
  const h = harness(shell ? fullClient : taskClient, call => {
    if (call.url === '/api/health') return response({ workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true, ready: true, merchantConfigured: true, payer: A });
    if (call.url === '/api/session') return control.owner ? response({ wallet: control.owner }) : response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401);
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [control.owner === B ? task(TASK_B, 'OWNER_B_CURRENT_PURPOSE') : control.value], nextCursor: null });
    if (call.url === pathA && call.method === 'GET') return control.read ? control.read(call) : response(control.value);
    if (call.url === '/api/tasks/' + TASK_B) return response(task(TASK_B, 'OWNER_B_CURRENT_PURPOSE'));
    if (call.url === pathA + '/approve') return control.approve ? control.approve(call) : assert.fail('Approval must be explicitly scripted');
    if (/\/execute$|\/recover$|\/reconcile$/.test(call.url)) assert.fail('No financial work is permitted in locale acceptance');
    if (call.url === '/api/auth/logout') { control.owner = null; return response(null, 204); }
    if (call.url === '/api/auth/challenge') return response({ challengeId: 'inert-ui-case', message: 'Scripted local authentication fixture' });
    if (call.url === '/api/auth/verify') { control.owner = B; return response({ wallet: B }); }
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    if (call.url.startsWith('/api/conversations?')) return response({ items: control.owner === A ? [{ id: c.id,
      data: { title: c.title, status: c.status }, updatedAt: c.messages[0].at }] : [], nextCursor: null });
    if (call.url === '/api/conversations/' + c.id) return response(c);
    throw new Error('Unexpected scripted request: ' + call.url);
  }, { savedLocale: language });
  await until(() => h.get('logout').disabled === false); await settle();
  if (shell) {
    await h.get('conversation-list').children[0].trigger('click');
    await until(() => h.get('task-execution-column').parentNode === h.get('assistant-task-slot'));
    await settle();
  }
  return { h, control, c };
}

for (const [languages, savedLocale, storageDenied, expected] of [
  [['ko-KR'], undefined, false, 'ko'], [['en-GB'], undefined, false, 'en'],
  [['fr-FR'], undefined, false, 'en'], [['fr-FR', 'ko-KR'], undefined, false, 'ko'],
  [['ko-KR'], 'en', false, 'en'], [['en-US'], 'ko', false, 'ko'],
  [['en-US'], '__proto__', false, 'en'], [['en-US'], 'ko', true, 'en'],
]) test('interface preference ' + JSON.stringify({ languages, savedLocale, storageDenied, expected }), async () => {
  const h = harness('', () => assert.fail('Locale bootstrap must not request a service'), { languages, savedLocale, storageDenied });
  assert.equal(h.document.documentElement.lang, expected); assert.equal(h.get('interface-language').value, expected);
  assert.equal(h.get('message-text').getAttribute('placeholder').includes('알고 싶은'), expected === 'ko');
  assert.equal(h.window.FlowwLocale.setLanguage('constructor'), false);
  assert.equal(h.document.documentElement.lang, expected); assert.equal(h.storageWrites.length, 0);
  const changed = expected === 'ko' ? 'en' : 'ko'; await switchTo(h, changed);
  assert.equal(h.document.documentElement.lang, changed);
  assert.deepEqual(h.storageWrites, storageDenied ? [] : [['floww.ui.locale', changed]]);
  assert.equal(h.calls.length, 0);
});

test('all explicitly authored static labels and attributes have English copy without changing their nodes', async () => {
  const h = harness('', () => assert.fail('No service request expected'));
  const copyLeaves = h.document.querySelectorAll('[data-copy]'), original = [...copyLeaves];
  await switchTo(h, 'en');
  for (const node of copyLeaves) assert.doesNotMatch(node.textContent, /[가-힣]/, node.getAttribute('data-copy'));
  for (const name of ['aria-label', 'placeholder', 'title', 'content']) {
    for (const node of h.document.querySelectorAll('[data-copy-' + name + ']')) assert.doesNotMatch(node.getAttribute(name), /[가-힣]/);
  }
  assert.deepEqual(h.document.querySelectorAll('[data-copy]'), original);
  assert.equal(h.get('purpose').value, '', 'translated examples are placeholders, not replacement user input');
});

test('guest locale toggle preserves exact draft, focus, selections, checkbox state and DOM identity with no new service call', async () => {
  const h = harness(fullClient, call => {
    if (call.url === '/api/health') return response({ workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true, ready: false });
    if (call.url === '/api/session') return response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401);
    assert.fail('A guest must not call a private service');
  });
  await until(() => h.get('send-message').disabled === false); await settle();
  const values = { 'message-text': '사용자의 목적 그대로', 'intent-wallet': B, 'intent-start': '2026-11-04T13:14:15',
    'intent-end': '2026-11-05T13:14:15', purpose: '별도의 목적 그대로', budget: '123.000000001', 'approval-expiry': '2026-11-06T20:00:00' };
  for (const [id, value] of Object.entries(values)) h.get(id).value = value;
  const input = h.get('message-text'); input.focus(); input.selectionStart = 2; input.selectionEnd = 6;
  h.get('approval-ack').checked = true; h.get('conversation-memory').checked = true;
  const column = h.get('task-execution-column'), parent = column.parentNode, calls = h.calls.length, events = h.events.filter(e => e.type !== 'floww:locale').length;
  await switchTo(h, 'en'); await switchTo(h, 'ko');
  for (const [id, value] of Object.entries(values)) assert.equal(h.get(id).value, value, id);
  assert.equal(h.document.activeElement, input); assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 6);
  assert.equal(h.get('approval-ack').checked, true); assert.equal(h.get('conversation-memory').checked, true);
  assert.equal(h.get('task-execution-column'), column); assert.equal(column.parentNode, parent);
  assert.equal(h.calls.length, calls); assert.equal(h.events.filter(e => e.type !== 'floww:locale').length, events);
  assert.deepEqual(h.events.filter(e => e.type === 'floww:locale').map(e => JSON.parse(JSON.stringify(e.detail))), [{ language: 'en' }, { language: 'ko' }]);
  assert.equal(h.backgroundErrors.length, 0);
});

test('same-task chat and report wrappers translate while exact amounts, evidence, model text and download bytes remain unchanged', async () => {
  const value = quotedTask();
  value.result = { answer: { answer_text: '자료에서 확인된 한국어 답변 원문', complete: false, is_synthetic: true,
    totals: [{ direction: 'out', transfer_count: 2, amount_display: '9007199.254740993', amount_base_units: '9007199254740993', asset_ref: 'SOURCE_TOKEN_IDENTIFIER' }],
    source_refs: ['SOURCE_REFERENCE'], evidence_refs: ['EVIDENCE_REFERENCE'], limitations: ['검증된 제한 원문'], data_as_of: '2026-11-05T12:00:00Z' },
    markdown: '# 한국어 보고서\n\n9007199254740993\nSOURCE_REFERENCE\nEVIDENCE_REFERENCE\n' };
  const { h } = await fixture({ value });
  const column = h.get('task-execution-column'), messages = [...h.get('dialogue-messages').children], pieces = [...h.get('result-content').children];
  h.get('budget').value = '9999999.000000001'; h.get('approval-ack').checked = true;
  const expiresAt = h.get('approval-expiry').value, calls = h.calls.length;
  await h.get('download-report').trigger('click'); assert.equal(h.downloads.length, 1);
  const before = await h.downloads[0].blob.text();
  await switchTo(h, 'en');
  assert.equal(h.calls.length, calls); assert.equal(h.downloads.length, 1);
  assert.equal(h.get('task-execution-column'), column); assert.equal(column.parentNode, h.get('assistant-task-slot'));
  for (const [id, children] of [['dialogue-messages', messages], ['result-content', pieces]]) {
    assert.equal(h.get(id).children.length, children.length, id);
    children.forEach((child, index) => assert.ok(h.get(id).children[index] === child, id + ' node ' + index));
  }
  assert.equal(h.get('budget').value, '9999999.000000001'); assert.equal(h.get('approval-expiry').value, expiresAt);
  assert.equal(h.get('approval-ack').checked, true);
  assert.match(h.get('quote-price').textContent, /9007199\.254740993/);
  assert.match(h.get('quote-atomic').textContent, /9007199254740993/);
  assert.equal(h.get('quote-budget-label').textContent, 'Entered spending limit');
  assert.match(h.get('quote-budget').textContent, /^9999999\.000000001\b/);
  assert.equal(h.get('purchase-task-ref').textContent, 'Task ID · ' + TASK_A);
  assert.match(h.get('execution-title').textContent, /사용자가 한국어로 적은 목적/);
  assert.match(h.get('dialogue-messages').textContent, /사용자가 남긴 대화 원문/);
  assert.match(h.get('plan-content').textContent, /모델의 계획 원문/);
  assert.match(h.get('result-content').textContent, /자료에서 확인된 한국어 답변 원문/);
  assert.match(h.get('result-content').textContent, /SOURCE_REFERENCE/); assert.match(h.get('result-content').textContent, /EVIDENCE_REFERENCE/);
  assert.match(h.get('result-content').textContent, /Coverage is partial/);
  assert.match(h.document.querySelector('label[for=approval-ack]').textContent, /Devnet service wallet/);
  await h.get('download-report').trigger('click'); assert.equal(h.downloads.length, 2);
  assert.equal(await h.downloads[1].blob.text(), before); assert.equal(before, value.result.markdown);
});

for (const reason of ['BUDGET_DENIED', 'UNAUTHORIZED_PAYMENT_TERMS', 'DAILY_BUDGET_EXCEEDED']) test('persisted ' + reason + ' stays visibly denied with old approval and language changes', async () => {
  const value = quotedTask('DENY'); value.reasonCode = reason;
  const { h } = await fixture({ value }); const calls = h.calls.length;
  assert.equal(h.get('approval-status').hidden, true); assert.equal(h.get('execute-task').hidden, true);
  assert.match(h.get('task-state').textContent, /거부됨/); assert.match(h.get('journey-title').textContent, /거부됨/);
  await switchTo(h, 'en');
  assert.match(h.get('task-state').textContent, /denied/i); assert.match(h.get('journey-title').textContent, /denied/i);
  assert.equal(h.get('purchase-approval-state').textContent, 'Awaiting approval');
  assert.equal(h.get('quote-budget-label').textContent, 'Entered spending limit');
  if (reason === 'BUDGET_DENIED') assert.match(h.get('task-guidance').textContent, /below the price or exceeds the service limit/);
  if (reason === 'UNAUTHORIZED_PAYMENT_TERMS') assert.match(h.get('task-guidance').textContent, /recipient/i);
  if (reason === 'DAILY_BUDGET_EXCEEDED') assert.match(h.get('task-guidance').textContent, /daily/i);
  assert.equal(h.get('approval-status').hidden, true); assert.equal(h.get('execute-task').hidden, true);
  assert.equal(h.calls.length, calls); assert.equal(count(h, pathA + '/execute'), 0);
});

test('server high-cap refusal is read once on the same task and remains denied during locale changes without executing', async () => {
  const { h, control } = await fixture({ shell: false }); const approval = deferred(), read = deferred();
  let readStarted = false;
  control.approve = () => approval.promise;
  control.read = () => { readStarted = true; return read.promise; };
  h.get('budget').value = '999999999.000000001'; h.get('approval-ack').checked = true;
  await h.get('approval-ack').trigger('change');
  const reads = count(h, pathA, 'GET'), submission = h.get('approval-form').trigger('submit');
  await until(() => count(h, pathA + '/approve') === 1);
  const calls = h.calls.length; await switchTo(h, 'en'); assert.equal(h.calls.length, calls);
  assert.equal(h.get('approval-ack').checked, true); assert.equal(h.get('budget').value, '999999999.000000001');
  assert.equal(h.calls.find(call => call.url === pathA + '/approve').body.budgetAtomic, '999999999000000001');
  approval.resolve(response({ error: { code: 'BUDGET_DENIED' } }, 403)); await until(() => readStarted);
  const duringRead = h.calls.length; await switchTo(h, 'ko'); await switchTo(h, 'en'); assert.equal(h.calls.length, duringRead);
  read.resolve(response({ ...control.value, revision: 2, policy: 'DENY', reasonCode: 'BUDGET_DENIED' }));
  await submission; await settle();
  assert.equal(count(h, pathA, 'GET'), reads + 1); assert.match(h.get('task-state').textContent, /denied/i);
  assert.match(h.get('task-guidance').textContent, /below the price or exceeds the service limit/);
  assert.match(h.get('notice-text').textContent, /below the price or exceeds the service limit/);
  assert.equal(count(h, pathA + '/execute'), 0);
});

test('local low-budget refusal does not create approval or refresh requests', async () => {
  const { h } = await fixture({ shell: false });
  h.get('budget').value = '0.000000001'; h.get('approval-ack').checked = true;
  await h.get('approval-ack').trigger('change'); const calls = h.calls.length;
  await h.get('approval-form').trigger('submit'); await settle();
  assert.equal(h.calls.length, calls); assert.equal(count(h, pathA + '/approve'), 0);
  assert.match(h.get('notice-text').textContent, /지출 한도/);
});

for (const outcome of ['unavailable', 'wrong-task', 'unauthenticated']) test('refusal refresh ' + outcome + ' cannot accept unexpected state or start payment', async () => {
  const { h, control } = await fixture({ shell: false, language: 'en' });
  control.approve = () => response({ error: { code: 'UNAUTHORIZED_PAYMENT_TERMS' } }, 403);
  control.read = () => {
    if (outcome === 'unavailable') throw new Error('Scripted response unavailable');
    if (outcome === 'wrong-task') return response(task(TASK_B, 'UNEXPECTED_PRIVATE_TASK'));
    return response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401);
  };
  const reads = count(h, pathA, 'GET');
  h.get('approval-ack').checked = true; await h.get('approval-ack').trigger('change');
  await h.get('approval-form').trigger('submit'); await settle();
  assert.equal(count(h, pathA, 'GET'), reads + 1);
  assert.equal(count(h, pathA + '/execute'), 0);
  assert.doesNotMatch(h.get('execution-title').textContent, /UNEXPECTED_PRIVATE_TASK/);
  if (outcome === 'unauthenticated') {
    assert.equal(h.get('logout').hidden, true); assert.equal(h.get('connect-wallet').disabled, false);
    assert.match(h.get('notice-text').textContent, /Sign in again/);
  } else {
    assert.equal(h.get('connect-wallet').title, A);
    assert.match(h.get('notice-text').textContent, /recipient/i);
  }
});

test('locale changes while a model turn is pending preserve scope and busy state without another model or plan request', async () => {
  let current = conversation(CONVERSATION_A, A, false), waiting = false;
  current.status = 'CLARIFICATION_REQUIRED'; current.intent.wallet = null; current.intent.missingFields = ['wallet'];
  const turn = deferred();
  const h = harness(fullClient, call => {
    if (call.url === '/api/health') return response({ workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true, ready: false });
    if (call.url === '/api/session') return response({ wallet: A });
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    if (call.url.startsWith('/api/conversations?')) return response({ items: [{ id: current.id,
      data: { title: current.title, status: current.status }, updatedAt: current.messages[0].at }], nextCursor: null });
    if (call.url === '/api/conversations/' + current.id) return response(current);
    if (call.url.endsWith('/messages')) { waiting = true; return turn.promise; }
    assert.fail('Unexpected request while a single scripted turn is pending: ' + call.url);
  });
  await until(() => h.get('logout').disabled === false); await settle();
  await h.get('conversation-list').children[0].trigger('click'); await settle();
  h.get('message-text').value = '사용자가 작성한 다음 요청';
  const wallet = h.get('intent-wallet').value, start = h.get('intent-start').value, end = h.get('intent-end').value;
  await h.get('message-form').trigger('submit'); await until(() => waiting);
  const calls = h.calls.length, stage = h.get('journey-title').textContent;
  await switchTo(h, 'en');
  assert.equal(h.calls.length, calls); assert.notEqual(h.get('journey-title').textContent, stage);
  assert.doesNotMatch(h.get('journey-title').textContent, /[가-힣]/);
  assert.equal(h.get('message-text').value, '사용자가 작성한 다음 요청');
  assert.equal(h.get('intent-wallet').value, wallet); assert.equal(h.get('intent-start').value, start); assert.equal(h.get('intent-end').value, end);
  assert.equal(h.get('send-message').disabled, true); assert.equal(h.get('message-text').disabled, true);
  current = { ...current, revision: 2, messages: [...current.messages, { id: 'scripted-new-turn', role: 'user', text: '사용자가 작성한 다음 요청', at: current.messages[0].at }] };
  turn.resolve(response(current)); await until(() => h.get('send-message').disabled === false); await settle();
  assert.equal(h.calls.filter(call => call.url.endsWith('/messages')).length, 1);
  assert.equal(h.calls.filter(call => call.url.endsWith('/plan')).length, 0);
  assert.match(h.get('dialogue-messages').textContent, /사용자가 작성한 다음 요청/);
});

test('UNKNOWN payment keeps the original-payment action and no new consent when language changes', async () => {
  const value = quotedTask('ALLOW'); value.payment = 'UNKNOWN'; value.delivery = 'PENDING';
  const { h } = await fixture({ value }); const calls = h.calls.length;
  assert.equal(h.get('reconcile-task').hidden, false); assert.equal(h.get('approval-form').hidden, true);
  await switchTo(h, 'en');
  assert.match(h.get('reconcile-task').textContent, /original payment/i);
  assert.match(h.get('task-guidance').textContent, /unresolved/i);
  assert.equal(h.get('reconcile-task').hidden, false); assert.equal(h.get('approval-form').hidden, true);
  assert.equal(h.calls.length, calls); assert.equal(count(h, pathA + '/execute'), 0); assert.equal(count(h, pathA + '/reconcile'), 0);
});

for (const status of [200, 401]) test('late old-owner refusal read ' + status + ' cannot restore private data or finish a new-owner sign-in', async () => {
  const { h, control } = await fixture({ shell: false }); const read = deferred(), signing = deferred();
  let readStarted = false, signStarted = false;
  control.approve = () => response({ error: { code: 'UNAUTHORIZED_PAYMENT_TERMS' } }, 403);
  control.read = () => { readStarted = true; return read.promise; };
  h.get('approval-ack').checked = true; await h.get('approval-ack').trigger('change');
  const submission = h.get('approval-form').trigger('submit'); await until(() => readStarted);
  h.emit('floww:session-expired', { wallet: A }); await settle();
  assert.equal(h.get('connect-wallet').disabled, false);
  h.window.phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: { toString: () => B } }),
    signMessage: async () => { signStarted = true; return signing.promise; }, on() {} } };
  const login = h.get('connect-wallet').trigger('click'); await until(() => signStarted);
  await switchTo(h, 'en');
  read.resolve(status === 401 ? response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401)
    : response({ ...control.value, purpose: 'OWNER_A_PRIVATE_REFUSAL', policy: 'DENY', reasonCode: 'UNAUTHORIZED_PAYMENT_TERMS' }));
  await submission; await settle();
  assert.equal(h.get('connect-wallet').disabled, true, 'old completion must not unlock the new sign-in');
  assert.match(h.get('connect-wallet').textContent, /Signing in/);
  assert.doesNotMatch(h.get('execution-title').textContent, /OWNER_A_PRIVATE_REFUSAL/);
  signing.resolve({ signature: new Uint8Array(64) }); await login; await settle();
  assert.equal(h.get('connect-wallet').title, B);
  await switchTo(h, 'ko'); await switchTo(h, 'en');
  assert.match(h.get('task-list').textContent, /OWNER_B_CURRENT_PURPOSE/);
  assert.doesNotMatch(h.get('task-list').textContent, /사용자가 한국어로 적은 목적|OWNER_A_PRIVATE_REFUSAL/);
  assert.equal(h.get('logout').hidden, false); assert.equal(count(h, pathA + '/execute'), 0);
});

test('changing task selection during a refusal read keeps the replacement task and never executes either request', async () => {
  const { h, control } = await fixture({ shell: false }); const read = deferred(); let readStarted = false;
  control.approve = () => response({ error: { code: 'UNAUTHORIZED_PAYMENT_TERMS' } }, 403);
  control.read = () => { readStarted = true; return read.promise; };
  h.get('approval-ack').checked = true; await h.get('approval-ack').trigger('change');
  const submission = h.get('approval-form').trigger('submit'); await until(() => readStarted);
  h.emit('floww:select-task', { id: TASK_B }); await switchTo(h, 'en');
  read.resolve(response({ ...control.value, purpose: 'STALE_REFUSAL_PURPOSE', policy: 'DENY', reasonCode: 'UNAUTHORIZED_PAYMENT_TERMS' }));
  await submission; await until(() => h.get('execution-title').textContent === 'OWNER_B_CURRENT_PURPOSE');
  assert.doesNotMatch(h.get('execution-title').textContent, /STALE_REFUSAL_PURPOSE/);
  assert.equal(count(h, pathA + '/execute'), 0); assert.equal(count(h, '/api/tasks/' + TASK_B + '/execute'), 0);
});

test('logout and locale refresh cannot revive an old owner report, quote or authored wrapper binding', async () => {
  const value = quotedTask(); value.result = { answer: { answer_text: 'OWNER_A_PRIVATE_REPORT', complete: false }, markdown: 'OWNER_A_PRIVATE_DOWNLOAD' };
  const { h } = await fixture({ value });
  assert.match(h.get('result-content').textContent, /OWNER_A_PRIVATE_REPORT/);
  await h.get('logout').trigger('click'); await switchTo(h, 'en'); await switchTo(h, 'ko');
  for (const id of ['result-content', 'quote-parties', 'quote-details', 'proposal-note', 'task-meta', 'task-list', 'dialogue-messages', 'conversation-title']) {
    assert.doesNotMatch(h.get(id).textContent, /OWNER_A_PRIVATE|사용자가 한국어로 적은 목적|모델이 반환한 설명 원문/, id);
  }
  assert.equal(h.get('budget').value, ''); assert.equal(h.get('approval-ack').checked, false);
  assert.equal(h.get('task-execution-column').parentNode, h.get('task-execution-home'));
  assert.equal(h.backgroundErrors.length, 0);
});
