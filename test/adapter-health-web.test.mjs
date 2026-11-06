import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, client, taskClient, A, B, TASK_A, TASK_B, CONVERSATION_A, CONVERSATION_B,
  conversation, task, overview, response, deferred, settle, until } from './ui-harness.mjs';

// Scripted browser contracts only: no model/provider, wallet cryptography or
// financial network is contacted. Runtime preflight and layout have other gates.
const source = taskClient + '\n' + client;
const healthy = () => ({ ready: true, merchantConfigured: true, modelConfigured: true,
  workspaceAdapterReady: true, reportAdapterReady: true });
const cURL = id => '#/assistant/conversations/' + id;
const tURL = id => '#/tasks/' + id;
const changes = h => h.calls.filter(call => call.method !== 'GET');
const count = (h, suffix) => h.calls.filter(call => call.method === 'POST' && call.url.endsWith(suffix)).length;
const language = async (h, value) => { h.get('interface-language').value = value; await h.get('interface-language').trigger('change'); };
function quoted(id = TASK_A) {
  return { ...task(id, id === TASK_A ? 'CURRENT_PRIVATE_TASK_A' : 'CURRENT_PRIVATE_TASK_B'), quote: {
    hash: (id === TASK_A ? 'a' : 'b').repeat(64), amountAtomic: '1234567891', assetDecimals: 9,
    asset: A, network: 'solana:devnet', recipient: B, payer: A, resourceUrl: 'https://resource.example/transfers',
    expiresAt: new Date(Date.now() + 20 * 60_000).toISOString() } };
}
async function fixture({ health = healthy(), owner = A, hash = '#/assistant', planned = true, linked = false,
  value = quoted(), transport, locale = 'ko' } = {}) {
  const ca = conversation(CONVERSATION_A, A, planned), cb = conversation(CONVERSATION_B, B, false);
  if (!planned) ca.status = 'READY_TO_PLAN';
  if (linked) { ca.linkedTaskId = TASK_A; ca.planLocked = true; ca.status = 'TASK_CREATED'; }
  const control = { owner, health, ca, cb, value, transport, connect: 0 };
  const h = harness(source, call => {
    const special = control.transport?.(call, control); if (special !== undefined) return special;
    if (call.url === '/api/health') return response(control.health);
    if (call.url === '/api/session') return control.owner ? response({ wallet: control.owner }) : response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401);
    if (call.url === '/api/auth/logout') { control.owner = null; return response(null, 204); }
    if (call.url === '/api/auth/challenge') return response({ challengeId: TASK_B, message: 'Scripted local authentication' });
    if (call.url === '/api/auth/verify') { control.owner = B; return response({ wallet: B }); }
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [control.owner === B ? quoted(TASK_B) : control.value], nextCursor: null });
    if (call.url === '/api/tasks/' + TASK_A) return response(control.value);
    if (call.url === '/api/tasks/' + TASK_B) return response(quoted(TASK_B));
    if (call.url.startsWith('/api/conversations?')) { const values = control.owner === B ? [control.cb] : [control.ca, control.cb];
      return response({ items: values.map(c => ({ id: c.id, data: { title: c.title, status: c.status }, updatedAt: c.messages[0].at })), nextCursor: null }); }
    if (call.url === '/api/conversations/' + CONVERSATION_A) return response(control.ca);
    if (call.url === '/api/conversations/' + CONVERSATION_B) return response(control.cb);
    if (call.url === '/api/mandates') return response({ mandates: [] });
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url.startsWith('/api/memories?')) return response({ items: [], nextCursor: null });
    if (call.url.startsWith('/api/activity?')) return response({ events: [] });
    assert.fail('No automatic or unscripted work is permitted: ' + call.method + ' ' + call.url);
  }, { hash, savedLocale: locale });
  h.window.phantom = { solana: { isPhantom: true,
    connect: async () => { control.connect++; return { publicKey: { toString: () => B } }; },
    signMessage: async () => ({ signature: new Uint8Array(64) }), on() {} } };
  await until(() => owner ? h.get('logout').disabled === false : h.get('send-message').disabled === false);
  await settle(); return { h, control };
}

for (const locale of ['ko', 'en']) test(locale + ' known workspace failure keeps a guest draft editable and explicit login available without a model resume', async () => {
  const { h, control } = await fixture({ health: { ...healthy(), workspaceAdapterReady: false }, owner: null, locale });
  const input = h.get('message-text'); input.value = 'EXACT_UNSENT_GUEST_DRAFT'; h.get('intent-wallet').value = A;
  h.get('intent-start').value = '2026-11-04T10:20:30.123'; input.focus();
  assert.equal(input.disabled, false); assert.equal(h.get('send-message').disabled, false); assert.equal(h.get('connect-wallet').disabled, false);
  assert.match(h.get('composer-hint').textContent, locale === 'ko' ? /잠시 사용할 수 없/ : /temporarily unavailable/);
  assert.doesNotMatch(h.get('health-detail').textContent, /Python|Traceback|\/Users|API_KEY|import/);
  await h.get('message-form').trigger('submit'); await until(() => control.owner === B); await settle();
  assert.equal(control.connect, 1); assert.equal(input.value, 'EXACT_UNSENT_GUEST_DRAFT'); assert.equal(input.disabled, false);
  assert.equal(h.get('intent-wallet').value, A); assert.equal(h.get('intent-start').value, '2026-11-04T10:20:30.123');
  assert.equal(h.get('send-message').disabled, true); assert.equal(count(h, '/messages'), 0); assert.equal(count(h, '/plan'), 0);
  assert.equal(h.calls.filter(call => call.url === '/api/conversations' && call.method === 'POST').length, 0);
  assert.equal(changes(h).length, 2); // Explicit authentication only.
  const last = h.events.filter(event => event.type === 'floww:session').at(-1).detail;
  h.emit('floww:session', { ...last, health: healthy() }); await settle();
  assert.equal(h.get('send-message').disabled, false); assert.equal(input.value, 'EXACT_UNSENT_GUEST_DRAFT');
  assert.equal(count(h, '/messages'), 0); assert.equal(count(h, '/plan'), 0); assert.equal(changes(h).length, 2);
});

test('known workspace failure blocks authenticated start/refine/plan but leaves owned history, scope edits and manual request creation available', async () => {
  const { h, control } = await fixture({ health: { ...healthy(), workspaceAdapterReady: false }, hash: cURL(CONVERSATION_A), planned: false });
  const text = h.get('message-text'); text.value = 'RETAIN_THIS_SCOPE_AND_DRAFT'; h.get('intent-wallet').value = B;
  assert.match(h.get('dialogue-messages').textContent, /A private plan/); assert.equal(text.disabled, false); assert.equal(h.get('intent-wallet').disabled, false);
  assert.equal(h.get('send-message').disabled, true); assert.equal(h.get('build-plan').disabled, true); assert.equal(h.get('new-conversation').disabled, true);
  await h.get('message-form').trigger('submit'); await h.get('build-plan').trigger('click'); await h.get('new-conversation').trigger('click'); await settle();
  assert.equal(text.value, 'RETAIN_THIS_SCOPE_AND_DRAFT'); assert.equal(changes(h).length, 0);
  await h.nav('memory'); await settle(); await h.nav('assistant'); await settle();
  assert.equal(text.value, 'RETAIN_THIS_SCOPE_AND_DRAFT'); assert.equal(h.get('intent-wallet').value, B);
  await h.nav('tasks'); await settle(); assert.equal(h.get('create-task').disabled, false);
  const id = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
  control.transport = call => call.url === '/api/tasks' && call.method === 'POST' ? response(task(id, 'Manual explicit request')) : undefined;
  h.get('purpose').value = 'Manual explicit request'; h.get('report-wallet').value = A;
  await h.get('request-form').trigger('submit'); await settle();
  assert.equal(h.window.location.hash, tURL(id)); assert.equal(changes(h).length, 1);
  assert.equal(count(h, '/quote'), 0); assert.equal(count(h, '/approve'), 0); assert.equal(count(h, '/execute'), 0);
});

test('workspace-only failure preserves a valid stored plan and independent manual payment-terms path', async () => {
  const { h, control } = await fixture({ health: { ...healthy(), workspaceAdapterReady: false }, hash: cURL(CONVERSATION_A) });
  assert.equal(h.get('confirm-plan').disabled, false); assert.equal(h.get('send-message').disabled, true);
  control.transport = call => {
    if (call.url.endsWith('/confirm')) { control.ca = { ...control.ca, linkedTaskId: TASK_A, planLocked: true }; control.value = task(TASK_A, 'Same confirmed request'); return response(control.value); }
    if (call.url.endsWith('/quote')) { control.value = quoted(); return response(control.value); }
  };
  await h.get('confirm-plan-form').trigger('submit'); await settle();
  assert.equal(count(h, '/confirm'), 1); assert.equal(count(h, '/messages'), 0); assert.equal(count(h, '/plan'), 0);
  assert.equal(count(h, '/quote'), 1);
  assert.equal(count(h, '/approve'), 0); assert.equal(count(h, '/execute'), 0);
  assert.equal(h.get('task-execution-column').parentNode, h.get('assistant-task-slot'));
});

test('model configuration missing, local failure and unconfirmed capability have distinct honest copy', async () => {
  for (const [change, expression] of [[{ modelConfigured: false }, /연결 설정/], [{ workspaceAdapterReady: false }, /AI 처리 기능/], [{ workspaceAdapterReady: undefined }, /상태 확인/]]) {
    const { h } = await fixture({ health: { ...healthy(), ...change } });
    assert.match(h.get('health-status').textContent, expression); assert.equal(h.get('send-message').disabled, true);
    assert.equal(h.get('message-text').disabled, false); assert.equal(changes(h).length, 0);
  }
  const { h: localChecks } = await fixture();
  assert.match(localChecks.get('health-detail').textContent, /실제 AI 응답.*각 요청에서 별도로/);
  assert.doesNotMatch(localChecks.get('health-detail').textContent, /모델 사용 가능|AI 제공자 연결됨|provider available/i);
});

for (const value of [undefined, null, 'true', 1, {}]) test('unknown or malformed adapter field ' + JSON.stringify(value) + ' fails closed without rewriting an editable draft', async () => {
  const { h } = await fixture({ health: { ...healthy(), workspaceAdapterReady: value, reportAdapterReady: value }, hash: cURL(CONVERSATION_A) });
  h.get('message-text').value = 'LOCAL_DRAFT_WITH_UNCONFIRMED_READINESS'; h.get('intent-wallet').value = B;
  assert.equal(h.get('send-message').disabled, true); assert.equal(h.get('confirm-plan').disabled, true); assert.equal(h.get('message-text').disabled, false);
  await h.get('message-form').trigger('submit'); await h.get('confirm-plan-form').trigger('submit');
  h.window.location.hash = tURL(TASK_A); await settle();
  h.get('approval-ack').checked = true;
  assert.equal(h.get('quote-task').disabled, true); assert.equal(h.get('execute-task').disabled, true);
  await h.get('quote-task').trigger('click'); await h.get('approval-form').trigger('submit'); await h.get('execute-task').trigger('click'); await settle();
  assert.equal(changes(h).length, 0); assert.match(h.get('health-status').textContent, /状態|상태 확인/);
  await h.nav('assistant'); await settle(); assert.equal(h.get('message-text').value, 'LOCAL_DRAFT_WITH_UNCONFIRMED_READINESS'); assert.equal(h.get('intent-wallet').value, B);
});

test('known report failure blocks quote/approval/execute and plan confirmation while preserving exact consent and stored result bytes', async () => {
  const value = quoted(); value.result = { answer: { answer_text: 'EXISTING_REPORT_EVIDENCE', complete: false, is_synthetic: true }, markdown: 'unchanged original report' };
  const { h } = await fixture({ health: { ...healthy(), ready: false, reportAdapterReady: false }, value, linked: true, hash: cURL(CONVERSATION_A) });
  const result = h.get('result-content'); assert.match(result.textContent, /EXISTING_REPORT_EVIDENCE/);
  h.get('budget').value = '9.876543219'; h.get('approval-ack').checked = true; h.get('approval-expiry').value = '2026-11-07T23:59:10';
  await h.get('quote-task').trigger('click'); await h.get('approval-form').trigger('submit'); await h.get('execute-task').trigger('click'); await settle();
  assert.equal(changes(h).length, 0); assert.equal(h.get('budget').value, '9.876543219'); assert.equal(h.get('approval-ack').checked, true);
  assert.equal(h.get('approval-expiry').value, '2026-11-07T23:59:10'); assert.match(h.get('quote-price').textContent, /1\.234567891/);
  const calls = h.calls.length; await language(h, 'en');
  assert.equal(h.get('result-content'), result); assert.match(result.textContent, /EXISTING_REPORT_EVIDENCE/);
  assert.equal(h.get('budget').value, '9.876543219'); assert.equal(h.get('approval-ack').checked, true); assert.equal(h.calls.length, calls);
  await h.get('download-report').trigger('click'); assert.equal(await h.downloads[0].blob.text(), 'unchanged original report');
  const { h: plan } = await fixture({ health: { ...healthy(), reportAdapterReady: false }, hash: cURL(CONVERSATION_A) });
  assert.equal(plan.get('confirm-plan').disabled, true); await plan.get('confirm-plan-form').trigger('submit'); await settle(); assert.equal(changes(plan).length, 0);
});

for (const capability of [false, undefined]) test('confirmed delivery with no answer exposes ' + (capability === false ? 'known' : 'unconfirmed') + ' result processing without contradicting existing facts', async () => {
  const value = quoted(); value.payment = 'CONFIRMED'; value.delivery = 'COMPLETED';
  const { h } = await fixture({ health: { ...healthy(), ready: false, reportAdapterReady: capability }, value, linked: true, hash: cURL(CONVERSATION_A) });
  assert.equal(h.get('live-status').textContent, '요청의 현재 상태를 불러왔습니다.');
  assert.doesNotMatch(h.get('live-status').textContent + h.get('shell-status').textContent, /작업을 완료했습니다/);
  assert.equal(h.get('payment-state').textContent, '결제 확인됨'); assert.equal(h.get('delivery-state').textContent, '전달 완료');
  assert.match(h.get('result-empty').textContent, /자료 전달은 확인됐/); assert.doesNotMatch(h.get('result-empty').textContent, /자료 전달이 확인되면/);
  const expectation = capability === false ? /결과 처리 기능을 잠시 사용할 수 없/ : /결과 처리의 준비 상태를 확인하지 못/;
  assert.match(h.get('result-empty').textContent, expectation); assert.match(h.get('task-guidance').textContent, expectation); assert.match(h.get('journey-copy').textContent, expectation);
  assert.equal(h.get('recover-task').disabled, false); assert.equal(h.get('recover-task').hidden, false); assert.equal(changes(h).length, 0);
  await language(h, 'en'); assert.match(h.get('result-empty').textContent, /Delivery is confirmed/); assert.doesNotMatch(h.get('result-empty').textContent, /Once delivery is confirmed/);
  assert.equal(h.get('live-status').textContent, "Loaded the request's current state.");
  await h.get('logout').trigger('click'); await settle(); await language(h, 'ko'); await language(h, 'en');
  assert.doesNotMatch(h.get('result-empty').textContent, /Delivery is confirmed\./); assert.equal(h.get('result-content').textContent, '');
});

for (const operation of ['reconcile', 'recover']) test('report failure preserves the original ' + operation + ' action and factual transaction state', async () => {
  const value = quoted(); value.payment = operation === 'reconcile' ? 'UNKNOWN' : 'CONFIRMED'; value.delivery = 'PENDING';
  const { h } = await fixture({ health: { ...healthy(), ready: false, reportAdapterReady: false }, value, hash: tURL(TASK_A), transport(call) {
    if (call.url === '/api/tasks/' + TASK_A + '/' + operation) return response(value);
  } });
  assert.equal(h.get(operation + '-task').disabled, false); assert.equal(h.get(operation + '-task').hidden, false);
  assert.match(h.get('task-guidance').textContent, operation === 'reconcile' ? /원래 거래/ : /결제는 확인됐/);
  await h.get(operation + '-task').trigger('click'); await settle();
  assert.equal(changes(h).length, 1); assert.equal(count(h, '/' + operation), 1); assert.equal(count(h, '/execute'), 0);
  assert.equal(h.window.location.hash, tURL(TASK_A)); assert.equal(h.get('payment-state').textContent, operation === 'reconcile' ? '확인 필요' : '결제 확인됨');
});

test('fixed workspace failure after an explicit plan attempt stops later model work and retains the exact local draft', async () => {
  const { h } = await fixture({ hash: cURL(CONVERSATION_A), planned: false, transport(call) {
    if (call.url.endsWith('/plan')) return response({ error: { code: 'WORKSPACE_ADAPTER_UNAVAILABLE' } }, 503);
  } });
  h.get('message-text').value = 'KEEP_THIS_AFTER_RUNTIME_FAILURE'; h.get('intent-wallet').value = B;
  await h.get('build-plan').trigger('click'); await settle();
  assert.equal(count(h, '/plan'), 1); assert.equal(h.get('send-message').disabled, true); assert.equal(h.get('build-plan').disabled, true);
  assert.equal(h.get('message-text').value, 'KEEP_THIS_AFTER_RUNTIME_FAILURE'); assert.equal(h.get('intent-wallet').value, B);
  assert.match(h.get('health-status').textContent, /AI 처리 기능/);
  await h.get('message-form').trigger('submit'); await h.get('build-plan').trigger('click'); await settle(); assert.equal(changes(h).length, 1);
});

test('a known readiness stop arriving during a model response prevents the next automatic plan without losing the accepted message', async () => {
  const pending = deferred();
  const { h, control } = await fixture({ hash: cURL(CONVERSATION_A), planned: false, transport(call) {
    if (call.url.endsWith('/messages')) {
      control.ca = { ...control.ca, revision: 2, messages: [...control.ca.messages, { id: 'accepted-user-turn', role: 'user', text: call.body.text, at: '2026-11-07T10:00:00Z' }] };
      return pending.promise;
    }
  } });
  h.get('message-text').value = 'ACCEPTED_MESSAGE_WITH_NO_NEXT_PLAN'; await h.get('message-form').trigger('submit'); await until(() => count(h, '/messages') === 1);
  const last = h.events.filter(event => event.type === 'floww:session').at(-1).detail;
  h.emit('floww:session', { ...last, health: { ...healthy(), workspaceAdapterReady: false } });
  pending.resolve(response(control.ca)); await settle();
  assert.equal(count(h, '/plan'), 0); assert.match(h.get('dialogue-messages').textContent, /ACCEPTED_MESSAGE_WITH_NO_NEXT_PLAN/);
  assert.equal(h.get('send-message').disabled, true); assert.equal(h.get('build-plan').disabled, true); assert.equal(changes(h).length, 1);
  h.emit('floww:session', { ...last, health: healthy() }); await settle(); assert.equal(count(h, '/plan'), 0);
});

test('fixed report failure after a quote request blocks future purchases without changing exact terms or consent', async () => {
  const { h } = await fixture({ hash: tURL(TASK_A), transport(call) {
    if (call.url.endsWith('/quote')) return response({ error: { code: 'REPORT_ADAPTER_UNAVAILABLE' } }, 503);
  } });
  h.get('budget').value = '9.876543219'; h.get('approval-ack').checked = true;
  await h.get('quote-task').trigger('click'); await settle();
  assert.equal(count(h, '/quote'), 1); assert.equal(h.get('quote-task').disabled, true); assert.equal(h.get('approve-task').disabled, true);
  assert.equal(h.get('budget').value, '9.876543219'); assert.equal(h.get('approval-ack').checked, true); assert.match(h.get('quote-price').textContent, /1\.234567891/);
  assert.match(h.get('notice-text').textContent, /結果|결과 처리 기능/); await h.get('approval-form').trigger('submit'); await settle(); assert.equal(changes(h).length, 1);
});

test('a route change ignores the old model failure instead of disabling the replacement conversation or retrying', async () => {
  const pending = deferred();
  const { h } = await fixture({ hash: cURL(CONVERSATION_A), planned: false, transport(call) {
    if (call.url.endsWith('/messages')) return pending.promise;
  } });
  h.get('message-text').value = 'OLD_ROUTE_PRIVATE_REQUEST'; await h.get('message-form').trigger('submit'); await until(() => count(h, '/messages') === 1);
  h.window.location.hash = cURL(CONVERSATION_B); await settle();
  pending.resolve(response({ error: { code: 'WORKSPACE_ADAPTER_UNAVAILABLE' } }, 503)); await settle();
  assert.match(h.get('conversation-title').textContent, /B private plan/); assert.equal(h.get('send-message').disabled, false);
  assert.doesNotMatch(h.get('shell-status').textContent, /처리 기능을 잠시/); assert.equal(changes(h).length, 1); assert.equal(count(h, '/plan'), 0);
});

test('an old owner model failure cannot disable a new owner session or revive its private draft', async () => {
  const pending = deferred();
  const { h, control } = await fixture({ hash: cURL(CONVERSATION_A), planned: false, transport(call) {
    if (call.url.endsWith('/messages')) return pending.promise;
  } });
  h.get('message-text').value = 'OWNER_A_PRIVATE_PENDING'; await h.get('message-form').trigger('submit'); await until(() => count(h, '/messages') === 1);
  await h.get('logout').trigger('click'); await settle(); await h.get('connect-wallet').trigger('click'); await settle(); assert.equal(control.owner, B);
  pending.resolve(response({ error: { code: 'WORKSPACE_ADAPTER_UNAVAILABLE' } }, 503)); await settle();
  assert.equal(h.get('connect-wallet').title, B); assert.equal(h.get('send-message').disabled, false); assert.equal(h.get('message-text').value, '');
  assert.doesNotMatch(h.get('dialogue-messages').textContent, /OWNER_A_PRIVATE_PENDING/); assert.doesNotMatch(h.get('health-status').textContent, /AI 처리 기능/);
  assert.equal(count(h, '/messages'), 1); assert.equal(count(h, '/plan'), 0); assert.equal(changes(h).length, 4);
});

test('a late old-selection report failure does not disable the replacement Task or trigger a financial retry', async () => {
  const pending = deferred();
  const { h } = await fixture({ hash: tURL(TASK_A), transport(call) { if (call.url.endsWith('/quote')) return pending.promise; } });
  const quoting = h.get('quote-task').trigger('click'); await until(() => count(h, '/quote') === 1);
  h.window.location.hash = tURL(TASK_B); await settle();
  pending.resolve(response({ error: { code: 'REPORT_ADAPTER_UNAVAILABLE' } }, 503)); await quoting; await settle();
  assert.equal(h.window.location.hash, tURL(TASK_B)); assert.match(h.get('execution-title').textContent, /CURRENT_PRIVATE_TASK_B/);
  assert.equal(h.get('quote-task').disabled, false); assert.equal(h.get('logout').hidden, false); assert.equal(changes(h).length, 1);
});
