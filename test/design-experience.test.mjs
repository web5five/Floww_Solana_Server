import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, client, taskClient, A, B, TASK_A, CONVERSATION_A, conversation, task,
  overview, response, deferred, settle, until } from './ui-harness.mjs';

// State and interaction acceptance for the shipped clients with scripted local
// transport. Viewport, contrast and visual hierarchy require browser readback.
const fullClient = taskClient + '\n' + client;
const starterIds = ['suggest-wallet', 'suggest-incoming', 'suggest-outgoing'];
const selectLanguage = async (h, language) => { h.get('interface-language').value = language; await h.get('interface-language').trigger('change'); };
// The small DOM harness does not bubble native clicks. Walking the ancestors
// also exercises accidental parent navigation listeners in this contract test.
async function bubbledClick(node) { for (let current = node; current; current = current.parentNode) await current.trigger('click'); }
const postCount = (h, suffix) => h.calls.filter(call => call.method === 'POST' && call.url.endsWith(suffix)).length;
function visiblyPresent(node) {
  for (let current = node; current; current = current.parentNode) {
    if (current.hidden) return false;
    const parent = current.parentNode;
    if (parent?.tagName === 'DETAILS' && !parent.open && current.tagName !== 'SUMMARY') return false;
  }
  return true;
}
async function guest(language = 'ko') {
  const h = harness(fullClient, call => {
    if (call.url === '/api/health') return response({ workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true, ready: false });
    if (call.url === '/api/session') return response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401);
    assert.fail('A local guest draft must not call a protected route: ' + call.url);
  }, { savedLocale: language });
  await until(() => h.get('send-message').disabled === false); await settle();
  return h;
}
async function workspace({ planned = false, linked = false } = {}) {
  let current = conversation(CONVERSATION_A, A, planned);
  current.status = planned ? 'APPROVAL_REQUIRED' : 'CLARIFICATION_REQUIRED';
  if (linked) { current.linkedTaskId = TASK_A; current.planLocked = true; current.status = 'TASK_CREATED'; }
  const value = task(TASK_A, '확인한 계획으로 생성한 요청');
  const control = { current, message: null, create: null };
  const h = harness(fullClient, call => {
    if (call.url === '/api/health') return response({ workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true, ready: false, merchantConfigured: true });
    if (call.url === '/api/session') return response({ wallet: A });
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: linked ? [value] : [], nextCursor: null });
    if (call.url === '/api/tasks/' + TASK_A) return response(value);
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    if (call.url.startsWith('/api/memories?')) return response({ items: [], nextCursor: null });
    if (call.url.startsWith('/api/activity?')) return response({ events: [] });
    if (call.url === '/api/auth/logout') return response(null, 204);
    if (call.url.startsWith('/api/conversations?')) return response({ items: [{ id: control.current.id,
      data: { title: control.current.title, status: control.current.status }, updatedAt: '2026-11-05T12:00:00Z' }], nextCursor: null });
    if (call.url === '/api/conversations' && call.method === 'POST') return control.create ? control.create(call) : assert.fail('Conversation creation must be explicitly scripted');
    if (call.url === '/api/conversations/' + control.current.id) return response(control.current);
    if (call.url.endsWith('/messages')) return control.message ? control.message(call) : assert.fail('A model turn must be explicitly scripted');
    assert.fail('No automatic model, task, quote or payment call is permitted: ' + call.url);
  });
  await until(() => h.get('logout').disabled === false); await settle();
  await h.get('conversation-list').children[0].trigger('click'); await settle();
  return { h, control, value };
}

test('idle entry has one visible purpose heading and composer, with no empty plan or guest history panel', async () => {
  const h = await guest();
  assert.equal(h.document.querySelectorAll('h1').filter(visiblyPresent).length, 1);
  assert.equal(visiblyPresent(h.get('message-form')), true);
  assert.equal(h.get('dialogue-header').hidden, true);
  assert.equal(h.get('assistant-inspector').hidden, true); assert.equal(h.get('conversation-tools').hidden, true);
  assert.equal(h.document.querySelector('.scope-details').open, undefined);
  assert.equal(h.get('assistant-surface').dataset.state, 'idle');
  assert.equal(h.get('assistant-task-slot').hidden, true);
  for (const id of starterIds) { assert.equal(visiblyPresent(h.get(id)), true); assert.equal(h.get(id).disabled, false); }
  assert.equal(h.document.querySelectorAll('#task-execution-column').length, 1);
  assert.equal(h.document.querySelectorAll('[data-page]:not([data-page=admin])').length, 6);
  assert.equal(h.get('admin-surface').hidden, true); assert.equal(h.get('admin-open').hidden, true);
});

for (const language of ['ko', 'en']) test(language + ' guest starters only fill the local draft, preserving scope and focusing the same composer', async () => {
  const h = await guest(language), input = h.get('message-text');
  const scope = { 'intent-wallet': B, 'intent-start': '2026-11-04T10:20:30', 'intent-end': '2026-11-05T10:20:30' };
  for (const [id, value] of Object.entries(scope)) h.get(id).value = value;
  const calls = h.calls.length;
  for (const [id, word] of [['suggest-wallet', language === 'ko' ? '자산별' : 'by asset'],
    ['suggest-incoming', language === 'ko' ? '들어온' : 'incoming'], ['suggest-outgoing', language === 'ko' ? '나간' : 'outgoing']]) {
    await bubbledClick(h.get(id));
    assert.ok(input.value.includes(word)); assert.equal(h.document.activeElement, input);
    for (const [key, value] of Object.entries(scope)) assert.equal(h.get(key).value, value, key);
    assert.equal(h.calls.length, calls); assert.equal(h.get('message-text'), input);
  }
  assert.equal(postCount(h, '/messages'), 0); assert.equal(postCount(h, '/api/tasks'), 0); assert.equal(postCount(h, '/approve'), 0);
});

test('an explicitly created empty conversation retains its ID and memory choice while draft starters remain available', async () => {
  const { h, control } = await workspace();
  const emptyId = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
  const empty = conversation(emptyId, A, false); empty.messages = []; empty.status = 'CLARIFICATION_REQUIRED';
  empty.intent = { purpose: null, wallet: null, windowStart: null, windowEnd: null, resourceId: 'wallet-transfers', missingFields: ['wallet'] };
  control.create = call => { assert.equal(call.body.useMemory, true); control.current = empty; return response(empty, 201); };
  h.get('conversation-memory').checked = true;
  await h.get('new-conversation').trigger('click'); await settle();
  assert.equal(h.get('assistant-surface').dataset.state, 'idle'); assert.equal(h.get('conversation-memory').checked, true);
  assert.equal(h.get('assistant-inspector').hidden, true);
  for (const id of starterIds) assert.equal(h.get(id).disabled, false);
  const calls = h.calls.length;
  await bubbledClick(h.get('suggest-incoming')); assert.equal(h.calls.length, calls);
  control.message = call => {
    assert.equal(call.url, '/api/conversations/' + emptyId + '/messages');
    control.current = { ...empty, revision: 2, messages: [{ id: 'local-first-turn', role: 'user', text: call.body.text, at: '2026-11-06T12:00:00Z' }] };
    return response(control.current);
  };
  await h.get('message-form').trigger('submit'); await until(() => postCount(h, '/messages') === 1); await settle();
  assert.equal(postCount(h, '/api/conversations'), 1); assert.equal(h.get('conversation-memory').checked, true);
});

test('a real unlinked plan becomes the expanded review surface with one active request heading and no starter reset', async () => {
  const { h, control } = await workspace({ planned: true });
  control.current = { ...control.current, messages: Array.from({ length: 20 }, (_, i) => ({
    id: 'planned-turn-' + i, role: i % 2 ? 'assistant' : 'user', text: '계획 전 대화 원문 ' + i, at: '2026-11-06T12:00:00Z' })) };
  await h.get('conversation-list').children[0].trigger('click'); await settle();
  assert.equal(h.document.querySelector('.page-heading').hidden, true);
  assert.equal(h.document.querySelectorAll('h1').filter(visiblyPresent).length, 1);
  assert.equal(h.get('dialogue-header').hidden, false);
  assert.equal(h.get('assistant-inspector').hidden, false); assert.equal(h.get('assistant-inspector').open, true);
  const surface = h.get('assistant-surface'), inspector = h.get('assistant-inspector');
  assert.equal(inspector.parentNode, surface);
  assert.equal(surface.children.indexOf(inspector), surface.children.indexOf(h.get('journey-card')) + 1);
  assert.ok(surface.children.indexOf(inspector) < surface.children.indexOf(h.get('assistant-task-slot')));
  assert.ok(surface.children.indexOf(inspector) < surface.children.indexOf(h.document.querySelector('.assistant-layout')));
  assert.equal(h.get('confirm-plan-form').hidden, false); assert.equal(h.get('dialogue-empty').hidden, true);
  h.get('message-text').value = '사용자가 바꾸는 요청'; const calls = h.calls.length;
  for (const id of starterIds) { assert.equal(h.get(id).disabled, true); await h.get(id).trigger('click'); }
  assert.equal(h.get('message-text').value, '사용자가 바꾸는 요청'); assert.equal(h.calls.length, calls);
  assert.equal(postCount(h, '/confirm'), 0); assert.equal(postCount(h, '/approve'), 0);
});

test('the confirmed plan is optional while the original single task panel stays in the conversation', async () => {
  const { h } = await workspace({ planned: true, linked: true });
  const column = h.get('task-execution-column'), inspector = h.get('assistant-inspector');
  assert.equal(column.parentNode, h.get('assistant-task-slot'));
  assert.equal(inspector.hidden, false); assert.equal(inspector.open, false); assert.equal(inspector.dataset.mode, 'linked');
  assert.equal(h.get('message-form').hidden, true); assert.equal(h.get('confirm-plan-form').hidden, true);
  assert.equal(h.get('journey-current-step').textContent, '03');
  inspector.open = true; const calls = h.calls.length;
  await selectLanguage(h, 'en');
  assert.equal(inspector.open, true); assert.equal(column.parentNode, h.get('assistant-task-slot'));
  assert.equal(h.calls.length, calls); assert.equal(h.document.querySelectorAll('#task-execution-column').length, 1);
});

test('a long linked conversation keeps its exact messages but puts the same task ahead of optional transcript and plan', async () => {
  const { h, control } = await workspace({ planned: true, linked: true });
  control.current = { ...control.current, messages: Array.from({ length: 20 }, (_, i) => ({
    id: 'retained-turn-' + i, role: i % 2 ? 'assistant' : 'user', text: '보존할 대화 원문 ' + i, at: '2026-11-06T12:00:00Z' })) };
  await h.get('conversation-list').children[0].trigger('click'); await settle();
  const surface = h.get('assistant-surface'), slot = h.get('assistant-task-slot');
  const layout = h.document.querySelector('.assistant-layout'), transcript = h.get('conversation-transcript');
  const messages = [...h.get('dialogue-messages').children];
  assert.ok(surface.children.indexOf(slot) < surface.children.indexOf(layout));
  assert.equal(h.get('task-execution-column').parentNode, slot); assert.equal(messages.length, 20);
  assert.equal(transcript.open, false); assert.equal(h.get('assistant-inspector').open, false);
  assert.equal(visiblyPresent(messages[0]), false);
  transcript.open = true; const calls = h.calls.length;
  await selectLanguage(h, 'en');
  assert.equal(transcript.open, true); assert.equal(visiblyPresent(messages[0]), true);
  messages.forEach((message, index) => assert.ok(h.get('dialogue-messages').children[index] === message));
  assert.match(h.get('dialogue-messages').textContent, /보존할 대화 원문 19/);
  assert.equal(h.calls.length, calls); assert.equal(h.document.querySelectorAll('#task-execution-column').length, 1);
});

test('an actual answer takes native reading priority over receipts without suppressing partial or synthetic notices', async () => {
  const { h, value } = await workspace({ planned: true, linked: true });
  const slot = h.get('assistant-task-slot'), heading = slot.querySelector('.guided-heading');
  assert.equal(heading.hidden, false);
  value.result = { answer: { answer_text: '실제 전달 결과로 받은 답변 원문', complete: false, is_synthetic: true }, markdown: '보존할 보고서' };
  h.emit('floww:select-task', { id: TASK_A });
  await until(() => h.get('result-content').textContent.includes('실제 전달 결과로 받은 답변 원문')); await settle();
  assert.equal(heading.hidden, true);
  assert.equal(h.get('journey-card').dataset.answerReady, 'true');
  const grid = h.document.querySelector('.results-grid'), result = h.document.querySelector('.result-panel');
  assert.equal(grid.children[0], result);
  assert.match(h.get('result-content').textContent, /실제 네트워크에서 조회한 자료가 아닙니다/);
  assert.match(h.get('result-content').textContent, /일부만 확인/);
  h.emit('floww:selection', { wallet: A, task: { ...value, id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' }, busy: false });
  assert.equal(heading.hidden, false, 'another task answer cannot suppress this linked task heading');
  assert.equal(h.get('journey-card').dataset.answerReady, 'false');
  assert.equal(postCount(h, '/approve'), 0); assert.equal(postCount(h, '/execute'), 0);
});

test('a stopped plan has one reachable explicit retry outside collapsed-plan content, with no automatic model call', async () => {
  const { h, control } = await workspace();
  control.current = { ...control.current, status: 'ATTENTION_REQUIRED', errorCode: 'WORKSPACE_MODEL_UNAVAILABLE',
    plan: null, intent: { ...control.current.intent, missingFields: [] } };
  await h.get('conversation-list').children[0].trigger('click'); await settle();
  const inspector = h.get('assistant-inspector');
  assert.equal(inspector.dataset.mode, 'retry'); assert.equal(inspector.hidden, false); assert.equal(inspector.open, true);
  const surface = h.get('assistant-surface'), retry = h.get('build-plan');
  assert.equal(inspector.parentNode, surface);
  assert.equal(surface.children.indexOf(inspector), surface.children.indexOf(h.get('journey-card')) + 1);
  assert.ok(surface.children.indexOf(inspector) < surface.children.indexOf(h.get('assistant-task-slot')));
  assert.equal(inspector.querySelector('summary').hidden, true); assert.equal(h.get('plan-content').hidden, true);
  assert.equal(visiblyPresent(retry), true); assert.equal(retry.disabled, false); assert.equal(retry.textContent, '계획 다시 시도');
  assert.equal(h.get('journey-card').hidden, false); assert.equal(h.get('journey-card').dataset.tone, 'attention');
  retry.focus(); const calls = h.calls.length;
  await selectLanguage(h, 'en');
  assert.equal(retry.textContent, 'Retry plan'); assert.equal(h.document.activeElement, retry);
  assert.equal(inspector.parentNode, surface); assert.equal(h.calls.length, calls);
  control.current = { ...control.current, status: 'PLANNING', errorCode: null, working: true };
  await h.get('conversation-list').children[0].trigger('click'); await settle();
  assert.equal(inspector.parentNode, surface); assert.equal(inspector.dataset.mode, 'review');
  assert.equal(inspector.open, true); assert.equal(retry.hidden, true);
  control.current = { ...control.current, status: 'APPROVAL_REQUIRED', errorCode: null,
    working: false, plan: conversation(CONVERSATION_A, A).plan };
  await h.get('conversation-list').children[0].trigger('click'); await settle();
  assert.equal(h.get('assistant-inspector'), inspector); assert.equal(h.get('build-plan'), retry);
  assert.equal(inspector.parentNode, surface);
  assert.equal(inspector.dataset.mode, 'review'); assert.equal(inspector.open, true);
  assert.equal(inspector.querySelector('summary').hidden, false); assert.equal(h.get('plan-content').hidden, false);
  assert.equal(retry.textContent, 'Prepare and review plan');
  control.current = { ...control.current, status: 'TASK_CREATED', linkedTaskId: TASK_A, planLocked: true };
  await h.get('conversation-list').children[0].trigger('click'); await settle();
  assert.equal(h.get('assistant-inspector'), inspector);
  assert.equal(inspector.parentNode, h.document.querySelector('.assistant-layout'));
  assert.equal(inspector.dataset.mode, 'linked'); assert.equal(inspector.open, false);
  assert.equal(postCount(h, '/plan'), 0); assert.equal(postCount(h, '/messages'), 0);
});

test('a pending turn cannot be overwritten by hidden starters or duplicate a model call', async () => {
  const { h, control } = await workspace(); const pending = deferred(); let started = false;
  control.message = () => { started = true; return pending.promise; };
  h.get('message-text').value = '확인 중인 사용자 요청';
  await h.get('message-form').trigger('submit'); await until(() => started);
  const calls = h.calls.length;
  for (const id of starterIds) { assert.equal(h.get(id).disabled, true); await h.get(id).trigger('click'); }
  assert.equal(h.get('message-text').value, '확인 중인 사용자 요청'); assert.equal(h.calls.length, calls);
  pending.resolve(response(control.current)); await settle();
  assert.equal(postCount(h, '/messages'), 1); assert.equal(postCount(h, '/plan'), 0);
});

test('all six existing views remain reachable and return to the same in-conversation task', async () => {
  const { h } = await workspace({ planned: true, linked: true }); const column = h.get('task-execution-column');
  for (const view of ['overview', 'tasks', 'memory', 'budgets', 'activity', 'assistant']) {
    await h.nav(view); await settle();
    assert.equal(h.document.body.dataset.currentView, view);
    const visible = h.document.querySelectorAll('[data-page]').filter(node => !node.hidden);
    assert.equal(visible.length, 1); assert.equal(visible[0].dataset.page, view);
    assert.equal(h.get('task-execution-column'), column);
    if (view !== 'assistant') assert.equal(h.document.querySelector('.page-heading').hidden, false);
  }
  assert.equal(column.parentNode, h.get('assistant-task-slot'));
  assert.equal(postCount(h, '/approve'), 0); assert.equal(postCount(h, '/execute'), 0);
});

test('logout restores the idle design without retaining a former owner heading, plan or task', async () => {
  const { h } = await workspace({ planned: true, linked: true });
  await h.get('logout').trigger('click'); await selectLanguage(h, 'en'); await settle();
  assert.equal(h.get('assistant-surface').dataset.state, 'idle');
  assert.equal(h.get('dialogue-header').hidden, true); assert.equal(h.get('assistant-inspector').hidden, true);
  assert.equal(h.get('conversation-tools').hidden, true); assert.equal(h.get('assistant-task-slot').hidden, true);
  assert.equal(h.get('task-execution-column').parentNode, h.get('task-execution-home'));
  assert.equal(h.document.querySelector('.page-heading').hidden, false);
  assert.equal(h.document.querySelectorAll('h1').filter(visiblyPresent).length, 1);
  assert.equal(h.get('message-form').hidden, false);
  for (const id of starterIds) { assert.equal(visiblyPresent(h.get(id)), true); assert.equal(h.get(id).disabled, false); }
  assert.doesNotMatch(h.get('conversation-title').textContent, /A private plan/);
});
