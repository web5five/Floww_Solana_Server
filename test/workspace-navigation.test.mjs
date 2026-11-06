import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, client, taskClient, A, B, TASK_A, TASK_B, CONVERSATION_A, CONVERSATION_B,
  conversation, task, overview, response, deferred, settle, until } from './ui-harness.mjs';

const source = taskClient + '\n' + client;
const cURL = (id, step = '') => '#/assistant/conversations/' + id + (step ? '/' + step : '');
const tURL = id => '#/tasks/' + id;
const normalized = value => JSON.parse(JSON.stringify(value));
const posts = h => h.calls.filter(call => call.method !== 'GET');
const reads = (h, url) => h.calls.filter(call => call.method === 'GET' && call.url === url).length;
function quoted(value) {
  return { ...value, quote: { hash: 'a'.repeat(64), amountAtomic: '1234567891', assetDecimals: 9,
    asset: A, network: 'solana:devnet', recipient: B, payer: A, resourceUrl: 'https://resource.example/transfers',
    expiresAt: new Date(Date.now() + 20 * 60_000).toISOString() } };
}
async function boot({ hash = '', linked = true, result = false, owner = A, transport } = {}) {
  const ca = conversation(CONVERSATION_A, A), cb = conversation(CONVERSATION_B, B);
  if (linked) { ca.linkedTaskId = TASK_A; ca.planLocked = true; ca.status = 'TASK_CREATED'; }
  const ta = quoted(task(TASK_A, 'AUTHORIZED_TASK_A')), tb = task(TASK_B, 'AUTHORIZED_TASK_B');
  if (result) { ta.payment = 'CONFIRMED'; ta.delivery = 'COMPLETED'; ta.resultAvailable = true;
    ta.result = { answer: { answer_text: 'EXACT_AUTHORIZED_ANSWER', complete: false, is_synthetic: true }, markdown: 'Exact original report' }; }
  const control = { ca, cb, ta, tb, owner, transport, model: null, plan: null, confirm: null };
  const h = harness(source, call => {
    const custom = control.transport?.(call, control); if (custom !== undefined) return custom;
    if (call.url === '/api/health') return response({ workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true, ready: true, merchantConfigured: true });
    if (call.url === '/api/session') return control.owner ? response({ wallet: control.owner }) : response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401);
    if (call.url === '/api/auth/logout') { control.owner = null; return response(null, 204); }
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [control.tb, control.ta].map(({ result: _, ...summary }) => summary), nextCursor: null });
    if (call.url === '/api/tasks/' + TASK_A) return response(control.ta);
    if (call.url === '/api/tasks/' + TASK_B) return response(control.tb);
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    if (call.url.startsWith('/api/memories?')) return response({ items: [], nextCursor: null });
    if (call.url.startsWith('/api/activity?')) return response({ events: [] });
    if (call.url.startsWith('/api/conversations?')) return response({ items: [control.ca, control.cb].map(c => ({ id: c.id,
      data: { title: c.title, status: c.status }, updatedAt: '2026-11-05T12:00:00Z' })), nextCursor: null });
    if (call.url === '/api/conversations/' + CONVERSATION_A) return response(control.ca);
    if (call.url === '/api/conversations/' + CONVERSATION_B) return response(control.cb);
    if (call.url.endsWith('/messages')) return control.model?.(call) ?? assert.fail('No model may run from route restoration');
    if (call.url.endsWith('/plan')) return control.plan?.(call) ?? assert.fail('No plan may run from route restoration');
    if (call.url.endsWith('/confirm')) return control.confirm?.(call) ?? assert.fail('No confirmation may run from route restoration');
    assert.fail('No automatic operation is permitted: ' + call.method + ' ' + call.url);
  }, { hash });
  await until(() => control.owner ? h.get('logout').disabled === false : h.get('send-message').disabled === false);
  await settle(); return { h, control };
}
async function openConversation(h, id) {
  const item = h.get('conversation-list').children.find(node => node.textContent.includes(id === CONVERSATION_A ? 'A private plan' : 'B private plan'));
  assert.ok(item); await item.trigger('click'); await settle();
}
async function stepLink(h, step) {
  const node = h.get('journey-steps').children[['request', 'plan', 'payment', 'result'].indexOf(step)].children[0];
  assert.equal(node.tagName, 'A'); await node.trigger('click'); await settle(); return node;
}

test('authenticated deep Task bootstrap wins over the default first summary, including a different analysis wallet', async () => {
  const { h } = await boot({ hash: tURL(TASK_A) });
  assert.equal(h.window.location.hash, tURL(TASK_A)); assert.equal(h.document.body.dataset.currentView, 'tasks');
  assert.match(h.get('execution-title').textContent, /AUTHORIZED_TASK_A/);
  assert.equal(reads(h, '/api/tasks/' + TASK_A), 1); assert.equal(reads(h, '/api/tasks/' + TASK_B), 0);
  assert.equal(h.window.history.length, 1); assert.equal(posts(h).length, 0);
  const { h: differentAnalysisWallet } = await boot({ hash: tURL(TASK_B) });
  assert.equal(differentAnalysisWallet.get('connect-wallet').title, A);
  assert.match(differentAnalysisWallet.get('execution-title').textContent, /AUTHORIZED_TASK_B/);
  assert.equal(posts(differentAnalysisWallet).length, 0);
});

test('a directly linked Task outside the current summary page retains its identity through a fresh list read', async () => {
  const { h } = await boot({ hash: tURL(TASK_A), transport(call) {
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [task(TASK_B, 'OTHER_PAGE_SUMMARY')], nextCursor: 'opaque-next-page' });
  } });
  await h.get('refresh-tasks').trigger('click'); await settle();
  assert.equal(h.window.location.hash, tURL(TASK_A)); assert.match(h.get('execution-title').textContent, /AUTHORIZED_TASK_A/);
  assert.equal(reads(h, '/api/tasks/' + TASK_A), 2); assert.equal(reads(h, '/api/tasks/' + TASK_B), 0); assert.equal(posts(h).length, 0);
});

test('fresh reload of a conversation restores its same authorized Task and actual answer with GETs only', async () => {
  const { h } = await boot({ hash: cURL(CONVERSATION_A, 'result'), result: true });
  assert.equal(h.window.location.hash, cURL(CONVERSATION_A, 'result'));
  assert.match(h.get('conversation-title').textContent, /A private plan/);
  assert.equal(h.get('task-execution-column').parentNode, h.get('assistant-task-slot'));
  assert.match(h.get('result-content').textContent, /EXACT_AUTHORIZED_ANSWER/);
  assert.equal(h.document.activeElement, h.get('result-content')); assert.equal(h.get('journey-current-step').textContent, '04');
  assert.equal(reads(h, '/api/tasks/' + TASK_B), 0); assert.equal(posts(h).length, 0);
  const { h: reload } = await boot({ hash: h.window.location.hash, result: true });
  assert.equal(reload.get('conversation-title').textContent, h.get('conversation-title').textContent);
  assert.equal(reload.get('result-content').textContent, h.get('result-content').textContent);
  assert.equal(reload.window.history.length, 1); assert.equal(posts(reload).length, 0);
});

test('all six views have reloadable routes and Back/Forward processes a paired traversal once', async () => {
  const { h } = await boot({ hash: cURL(CONVERSATION_A) });
  for (const name of ['overview', 'tasks', 'memory', 'budgets', 'activity', 'assistant']) {
    await h.nav(name); await settle();
    assert.equal(h.document.body.dataset.currentView, name);
    assert.match(h.window.location.hash, new RegExp('^#/' + name + '(?:/|$)'));
    const { h: reloaded } = await boot({ hash: h.window.location.hash });
    assert.equal(reloaded.document.body.dataset.currentView, name); assert.equal(posts(reloaded).length, 0);
  }
  await h.nav('memory'); await settle(); await h.nav('budgets'); await settle();
  const memoryURL = '/api/memories?limit=20', before = reads(h, memoryURL), count = h.window.history.length;
  h.window.history.back(); await settle();
  assert.equal(h.window.location.hash, '#/memory'); assert.equal(reads(h, memoryURL), before + 1);
  h.window.history.forward(); await settle();
  assert.equal(h.window.location.hash, '#/budgets'); assert.equal(h.window.history.length, count);
  assert.equal(posts(h).length, 0);
  for (const entry of h.historyEntries) { assert.equal(entry.state, null); assert.doesNotMatch(entry.url, /private|wallet=|planHash|quote|proof|AUTHORIZED/); }
});

test('stage anchors reveal original content, preserve factual current step, and traverse without a request', async () => {
  const { h } = await boot({ hash: cURL(CONVERSATION_A, 'result'), result: true });
  const column = h.get('task-execution-column'), result = h.get('result-content'), calls = h.calls.length;
  await stepLink(h, 'request'); assert.equal(h.get('conversation-transcript').open, true); assert.equal(h.document.activeElement, h.get('dialogue-messages'));
  await stepLink(h, 'plan'); assert.equal(h.get('assistant-inspector').open, true); assert.equal(h.document.activeElement, h.get('plan-content'));
  await stepLink(h, 'payment'); assert.equal(h.document.activeElement, h.get('quote-summary'));
  await stepLink(h, 'result'); assert.equal(h.document.activeElement, result);
  assert.equal(h.get('journey-current-step').textContent, '04');
  assert.equal(h.get('journey-steps').children[3].children[0].getAttribute('aria-current'), 'step');
  assert.equal(h.get('journey-steps').children[0].children[0].getAttribute('aria-current'), null);
  h.window.history.back(); await settle(); assert.equal(h.window.location.hash, cURL(CONVERSATION_A, 'payment'));
  assert.equal(h.document.activeElement, h.get('quote-summary')); assert.equal(h.get('task-execution-column'), column); assert.equal(h.get('result-content'), result);
  assert.equal(h.calls.length, calls); assert.equal(posts(h).length, 0);
});

test('an unchanged real Task poll and locale switch retain focused stage-anchor identity and keyboard access', async () => {
  const { h, control } = await boot({ hash: cURL(CONVERSATION_A, 'payment') });
  control.ta.payment = 'UNKNOWN';
  await h.get('refresh-task').trigger('click'); await settle();
  const detail = h.get('journey-steps').parentNode; detail.open = true;
  const anchor = h.get('journey-steps').children[1].children[0]; anchor.focus();
  const count = reads(h, '/api/tasks/' + TASK_A);
  await [...h.intervals.values()][0](); await settle();
  assert.equal(reads(h, '/api/tasks/' + TASK_A), count + 1);
  assert.equal(h.get('journey-steps').children[1].children[0], anchor); assert.equal(h.document.activeElement, anchor); assert.equal(h.document.body.contains(anchor), true);
  assert.equal(detail.open, true);
  const calls = h.calls.length; h.get('interface-language').value = 'en'; await h.get('interface-language').trigger('change');
  assert.equal(h.get('journey-steps').children[1].children[0], anchor); assert.equal(h.document.activeElement, anchor);
  assert.equal(anchor.textContent, 'Review plan'); assert.equal(h.calls.length, calls); assert.equal(posts(h).length, 0);
  await anchor.trigger('click'); await settle(); assert.equal(h.document.activeElement, h.get('plan-content'));
  await stepLink(h, 'request'); assert.equal(h.get('dialogue-messages').getAttribute('tabindex'), '0');
});

test('stage changes retain exact 9-decimal financial input, acknowledgement and original Task identity', async () => {
  const { h } = await boot({ hash: cURL(CONVERSATION_A, 'payment') });
  h.get('budget').value = '1.234567899'; h.get('approval-expiry').value = '2026-11-07T23:59:10'; h.get('approval-ack').checked = true;
  const calls = h.calls.length, form = h.get('approval-form');
  await stepLink(h, 'plan'); await stepLink(h, 'request'); h.window.history.back(); await settle(); h.window.history.back(); await settle();
  assert.equal(h.window.location.hash, cURL(CONVERSATION_A, 'payment'));
  assert.equal(h.get('budget').value, '1.234567899'); assert.equal(h.get('approval-expiry').value, '2026-11-07T23:59:10'); assert.equal(h.get('approval-ack').checked, true);
  assert.equal(h.get('approval-form'), form); assert.match(h.get('quote-price').textContent, /1\.234567891/);
  assert.equal(h.calls.length, calls); assert.equal(posts(h).length, 0);
});

test('a future result route is truthful pending content and never advances actual progress or payment', async () => {
  const { h } = await boot({ hash: cURL(CONVERSATION_A, 'result') });
  assert.equal(h.window.location.hash, cURL(CONVERSATION_A, 'result'));
  assert.equal(h.get('journey-current-step').textContent, '03'); assert.equal(h.get('result-content').hidden, true);
  const future = h.get('journey-steps').children[3].children[0];
  assert.equal(future.tagName, 'SPAN'); assert.equal(future.getAttribute('aria-disabled'), 'true');
  assert.match(h.get('shell-status').textContent, /まだ|아직/); assert.equal(posts(h).length, 0);
});

test('strict route parsing rejects malformed, encoded, prototype and external paths without executing anything', async () => {
  for (const hash of ['#/__proto__', '#/constructor', '#//evil.example/tasks/' + TASK_A,
    '#/tasks/' + TASK_A + '?execute=true', '#/tasks/%61aaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    '#/assistant/conversations/' + CONVERSATION_A + '%2fresult', '#/assistant/conversations/' + CONVERSATION_A + '/execute',
    '#/assistant/conversations/' + CONVERSATION_A + '/result/extra', '#/assistant/conversations/../result', '#/%61ssistant']) {
    const { h } = await boot({ hash });
    assert.equal(h.window.location.hash, '#/assistant', hash); assert.equal(h.window.location.origin, 'https://floww.example');
    assert.equal(posts(h).length, 0); assert.equal(reads(h, '/api/conversations/' + CONVERSATION_A), 0);
    assert.equal(h.window.history.length, 1); assert.equal(h.backgroundErrors.length, 0);
  }
  const { h } = await boot({ hash: tURL(TASK_A.toUpperCase()) + '/' });
  assert.equal(h.window.location.hash, tURL(TASK_A)); assert.equal(h.window.history.length, 1); assert.equal(posts(h).length, 0);
});

test('keyboard skip link focuses main while retaining the copied private route and history position', async () => {
  const { h } = await boot({ hash: cURL(CONVERSATION_A, 'plan') });
  const hash = h.window.location.hash, count = h.window.history.length, calls = h.calls.length; let prevented = false;
  await h.document.querySelector('.skip-link').trigger('click', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(h.document.activeElement, h.get('workspace-top'));
  assert.equal(h.window.location.hash, hash); assert.equal(h.window.history.length, count); assert.equal(h.calls.length, calls);
});

test('new unsent request and explicit scope survive opening a conversation then Back to their own base route', async () => {
  const { h } = await boot({ hash: '#/assistant', linked: false });
  h.get('message-text').value = 'NEW UNSENT LOCAL DRAFT'; h.get('intent-wallet').value = B;
  h.get('intent-start').value = '2026-11-04T08:09:10.123'; h.get('conversation-memory').checked = true;
  await openConversation(h, CONVERSATION_A); h.window.history.back(); await settle();
  assert.equal(h.window.location.hash, '#/assistant'); assert.equal(h.get('dialogue-header').hidden, true);
  assert.equal(h.get('message-text').value, 'NEW UNSENT LOCAL DRAFT'); assert.equal(h.get('intent-wallet').value, B);
  assert.equal(h.get('intent-start').value, '2026-11-04T08:09:10.123'); assert.equal(h.get('conversation-memory').checked, true);
  assert.equal(h.get('assistant-inspector').hidden, true); assert.equal(posts(h).length, 0);
});

for (const denied of [false, true]) test('new draft survives a ' + (denied ? 'denied' : 'still-loading') + ' conversation target through a management-page detour', async () => {
  const pending = deferred(); let started = false;
  const { h } = await boot({ hash: '#/assistant', linked: false, transport(call) {
    if (call.url === '/api/conversations/' + CONVERSATION_A) {
      started = true; return denied ? response({ error: { code: 'NOT_FOUND' } }, 404) : pending.promise;
    }
  } });
  h.get('message-text').value = 'NEW_DRAFT_SURVIVES_UNBOUND_TARGET'; h.get('intent-wallet').value = B;
  const opening = openConversation(h, CONVERSATION_A); await until(() => started); if (denied) await opening;
  await h.nav('memory'); await settle(); h.window.history.go(-2); await settle();
  if (!denied) { pending.resolve(response(conversation(CONVERSATION_A, A))); await opening; await settle(); }
  assert.equal(h.window.location.hash, '#/assistant'); assert.equal(h.get('message-text').value, 'NEW_DRAFT_SURVIVES_UNBOUND_TARGET');
  assert.equal(h.get('intent-wallet').value, B); assert.equal(h.get('dialogue-header').hidden, true); assert.equal(posts(h).length, 0);
});

test('A to B to A restores unsent edits while unchanged server milliseconds remain unchanged scope', async () => {
  const { h, control } = await boot({ hash: cURL(CONVERSATION_A), linked: false });
  control.ca.intent.windowStart = control.ca.plan.scope.windowStart = '2026-11-04T00:00:00.123Z';
  control.ca.intent.windowEnd = control.ca.plan.scope.windowEnd = '2026-11-05T00:00:00.987Z';
  await openConversation(h, CONVERSATION_A);
  h.get('message-text').value = 'Keep my authored style-only draft'; h.get('conversation-memory').checked = true;
  const rawStart = h.get('intent-start').value;
  await openConversation(h, CONVERSATION_B); h.get('message-text').value = 'Independent B draft';
  h.window.history.back(); await settle();
  assert.equal(h.window.location.hash, cURL(CONVERSATION_A)); assert.equal(h.get('message-text').value, 'Keep my authored style-only draft');
  assert.equal(h.get('intent-start').value, rawStart); assert.equal(h.get('conversation-memory').checked, true);
  assert.equal(h.get('confirm-plan').disabled, false);
  let posted;
  control.model = call => { posted = call.body; return response({ ...control.ca, status: 'CLARIFICATION_REQUIRED', plan: null }); };
  await h.get('message-form').trigger('submit'); await settle();
  assert.equal(posted.text, 'Keep my authored style-only draft'); assert.deepEqual(normalized(posted.scope), {});
  assert.equal(posts(h).length, 1);
});

test('ordinary management view navigation retains the same conversation and explicit edited draft', async () => {
  const { h } = await boot({ hash: cURL(CONVERSATION_A), linked: false });
  h.get('message-text').value = 'OWNER_ONLY_DRAFT'; h.get('intent-wallet').value = B;
  await h.nav('overview'); await settle(); await h.nav('assistant'); await settle();
  assert.equal(h.window.location.hash, cURL(CONVERSATION_A)); assert.equal(h.get('message-text').value, 'OWNER_ONLY_DRAFT');
  assert.equal(h.get('intent-wallet').value, B); assert.equal(h.get('confirm-plan').disabled, true); assert.equal(posts(h).length, 0);
});

for (const oldStatus of [200, 401]) test('slow conversation A ' + oldStatus + ' cannot replace B or expire its current session', async () => {
  const old = deferred(); let started = false;
  const { h } = await boot({ hash: '#/assistant', linked: false, transport(call) {
    if (call.url === '/api/conversations/' + CONVERSATION_A) { started = true; return old.promise; }
  } });
  const opening = openConversation(h, CONVERSATION_A); await until(() => started);
  await openConversation(h, CONVERSATION_B);
  old.resolve(oldStatus === 200 ? response(conversation(CONVERSATION_A, A)) : response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401));
  await opening; await settle();
  assert.equal(h.window.location.hash, cURL(CONVERSATION_B)); assert.match(h.get('conversation-title').textContent, /B private plan/);
  assert.doesNotMatch(h.get('dialogue-messages').textContent, /A private plan/); assert.equal(h.get('logout').hidden, false);
  assert.equal(h.get('send-message').disabled, false); assert.equal(posts(h).length, 0);
});

for (const oldStatus of [200, 401]) test('slow Task A ' + oldStatus + ' cannot replace Task B or expire its owner', async () => {
  const old = deferred(); let started = false;
  const { h } = await boot({ hash: '#/assistant', transport(call) {
    if (call.url === '/api/tasks/' + TASK_A) { started = true; return old.promise; }
  } });
  h.window.location.hash = tURL(TASK_A); await until(() => started);
  h.window.location.hash = tURL(TASK_B); await settle();
  old.resolve(oldStatus === 200 ? response(task(TASK_A, 'STALE_PRIVATE_TASK')) : response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401));
  await settle(); assert.equal(h.window.location.hash, tURL(TASK_B)); assert.match(h.get('execution-title').textContent, /AUTHORIZED_TASK_B/);
  assert.doesNotMatch(h.get('execution-title').textContent, /STALE_PRIVATE/); assert.equal(h.get('logout').hidden, false); assert.equal(posts(h).length, 0);
});

test('navigation during a pending model turn retains its draft without replaying it or accepting the late answer', async () => {
  const { h, control } = await boot({ hash: cURL(CONVERSATION_A), linked: false });
  const pending = deferred(); control.model = () => pending.promise;
  h.get('message-text').value = 'UNFINISHED_EXACT_REQUEST'; h.get('intent-wallet').value = B;
  const sending = h.get('message-form').trigger('submit'); await until(() => posts(h).some(call => call.url.endsWith('/messages')));
  await h.nav('memory'); await settle(); await h.nav('assistant'); await settle();
  pending.resolve(response({ ...control.ca, title: 'STALE_MODEL_TITLE', status: 'READY_TO_PLAN', revision: 2 }));
  await sending; await settle();
  assert.equal(h.get('message-text').value, 'UNFINISHED_EXACT_REQUEST'); assert.equal(h.get('intent-wallet').value, B);
  assert.doesNotMatch(h.get('conversation-title').textContent, /STALE_MODEL/); assert.equal(h.get('send-message').disabled, false);
  assert.equal(posts(h).length, 1); assert.equal(h.calls.filter(call => call.url.endsWith('/plan')).length, 0);
});

for (const edited of [false, true]) test('uncertain message return ' + (edited ? 'uses a new request only after an intentional edit' : 'replays its exact original body and idempotency ID'), async () => {
  const { h, control } = await boot({ hash: cURL(CONVERSATION_A), linked: false });
  const pending = deferred(), submitted = [];
  control.model = call => {
    submitted.push(normalized(call.body));
    if (submitted.length === 1) {
      control.ca = { ...control.ca, revision: 3, plan: null, status: 'CLARIFICATION_REQUIRED', intent: { ...control.ca.intent, wallet: B } };
      return pending.promise;
    }
    return response(control.ca);
  };
  h.get('message-text').value = 'Keep the original request body'; h.get('intent-wallet').value = B;
  await h.get('message-form').trigger('submit'); await until(() => submitted.length === 1);
  await h.nav('activity'); await settle(); h.window.history.back(); await settle();
  assert.equal(h.get('intent-wallet').value, B); assert.equal(h.get('message-text').value, 'Keep the original request body');
  pending.resolve(response(control.ca)); await settle();
  assert.equal(submitted.length, 1);
  if (edited) h.get('message-text').value = 'A deliberately different request';
  await h.get('message-form').trigger('submit'); await until(() => submitted.length === 2); await settle();
  if (edited) {
    assert.notEqual(submitted[1].clientRequestId, submitted[0].clientRequestId);
    assert.equal(submitted[1].expectedRevision, 3); assert.equal(submitted[1].text, 'A deliberately different request');
  } else {
    assert.deepEqual(submitted[1], submitted[0]); assert.deepEqual(submitted[1].scope, { wallet: B }); assert.equal(submitted[1].expectedRevision, 1);
  }
  assert.equal(posts(h).length, 2); assert.equal(h.calls.filter(call => call.url.endsWith('/plan')).length, 0);
});

test('a pending direct Task creation cannot redirect a newer management route', async () => {
  const pending = deferred(), id = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee'; let creating = false;
  const { h } = await boot({ hash: '#/tasks', transport(call) {
    if (call.url === '/api/tasks' && call.method === 'POST') { creating = true; return pending.promise; }
  } });
  h.get('purpose').value = 'Explicitly created request'; h.get('report-wallet').value = A;
  const create = h.get('request-form').trigger('submit'); await until(() => creating);
  await h.nav('memory'); await settle();
  pending.resolve(response(task(id, 'Completed creation in its original context'))); await create; await settle();
  assert.equal(h.window.location.hash, '#/memory'); assert.equal(h.document.body.dataset.currentView, 'memory');
  assert.equal(h.calls.filter(call => call.url.endsWith('/quote')).length, 0); assert.equal(posts(h).length, 1);
  assert.match(h.get('task-list').textContent, /Completed creation in its original context/);
});

test('an explicit direct Task creation binds the URL to its actual returned ID without quoting or paying', async () => {
  const id = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
  const { h } = await boot({ hash: '#/tasks', transport(call) {
    if (call.url === '/api/tasks' && call.method === 'POST') return response(task(id, 'Explicit new Task'));
  } });
  h.get('purpose').value = 'Explicit new Task'; h.get('report-wallet').value = A;
  await h.get('request-form').trigger('submit'); await settle();
  assert.equal(h.window.location.hash, tURL(id)); assert.match(h.get('execution-title').textContent, /Explicit new Task/);
  assert.equal(posts(h).length, 1); assert.equal(h.calls.filter(call => call.url.endsWith('/quote')).length, 0);
});

test('a different target synchronously invalidates pending approval before its response can trigger execution', async () => {
  const pending = deferred(); let approval;
  const { h, control } = await boot({ hash: cURL(CONVERSATION_A, 'payment'), transport(call) {
    if (call.url.endsWith('/approve')) { approval = call.body; return pending.promise; }
  } });
  h.get('budget').value = '1.234567891'; h.get('approval-ack').checked = true;
  const approving = h.get('approval-form').trigger('submit'); await until(() => approval);
  h.window.location.hash = cURL(CONVERSATION_B);
  await until(() => h.get('conversation-title').textContent.includes('B private plan'));
  pending.resolve(response({ ...control.ta, policy: 'ALLOW', approval: { id: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee', quoteHash: control.ta.quote.hash,
    payer: control.ta.quote.payer, budgetAtomic: approval.budgetAtomic, expiresAt: approval.expiresAt } }));
  await approving; await settle();
  assert.equal(h.window.location.hash, cURL(CONVERSATION_B)); assert.equal(h.calls.filter(call => call.url.endsWith('/execute')).length, 0);
  assert.equal(posts(h).length, 1); assert.doesNotMatch(h.get('conversation-title').textContent, /A private/);
});

test('confirmed guests sanitize private targets and a later login does not auto-hydrate or submit them', async () => {
  const { h, control } = await boot({ hash: cURL(CONVERSATION_A, 'payment'), owner: null });
  assert.equal(h.window.location.hash, '#/assistant'); assert.equal(reads(h, '/api/conversations/' + CONVERSATION_A), 0);
  h.get('message-text').value = 'Guest retained but not submitted';
  control.owner = B; h.session(B); await settle();
  assert.equal(h.window.location.hash, '#/assistant'); assert.equal(reads(h, '/api/conversations/' + CONVERSATION_A), 0);
  assert.equal(h.get('message-text').value, 'Guest retained but not submitted'); assert.equal(posts(h).length, 0);
});

test('a confirmed guest private-link attempt retains the local unsent draft and scope while sanitizing the ID', async () => {
  const { h } = await boot({ hash: '#/assistant', owner: null });
  h.get('message-text').value = 'LOCAL_GUEST_DRAFT'; h.get('intent-wallet').value = B;
  h.window.location.hash = cURL(CONVERSATION_A, 'payment'); await settle();
  assert.equal(h.window.location.hash, '#/assistant'); assert.equal(h.get('message-text').value, 'LOCAL_GUEST_DRAFT');
  assert.equal(h.get('intent-wallet').value, B); assert.equal(reads(h, '/api/conversations/' + CONVERSATION_A), 0); assert.equal(posts(h).length, 0);
});

for (const oldStatus of [200, 401]) test('same-wallet session renewal fences an old workspace ' + oldStatus + ' response', async () => {
  const old = deferred(); let count = 0;
  const h = harness(client, call => {
    if (call.url.startsWith('/api/memories?')) return ++count === 1 ? old.promise : response({ items: [{ id: TASK_B, revision: 1,
      data: { key: 'RENEWED_MEMORY', value: 'CURRENT_SESSION_VALUE', expiresAt: '2026-12-01' } }], nextCursor: null });
    if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    assert.fail('Unexpected request ' + call.url);
  }, { hash: '#/memory' });
  h.emit('floww:session', { wallet: A, generation: 1, initializing: false }); await until(() => count === 1);
  h.emit('floww:session', { wallet: A, generation: 2, initializing: false }); await until(() => count === 2); await settle();
  old.resolve(oldStatus === 200 ? response({ items: [{ id: TASK_A, revision: 1,
    data: { key: 'OLD_SESSION_MEMORY', value: 'STALE_SECRET_CONTEXT', expiresAt: '2026-12-01' } }], nextCursor: null }) : response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401));
  await settle(); assert.match(h.get('memory-list').textContent, /CURRENT_SESSION_VALUE/); assert.doesNotMatch(h.get('memory-list').textContent, /STALE_SECRET_CONTEXT/);
  assert.equal(h.events.filter(event => event.type === 'floww:session-expired').length, 0); assert.equal(h.get('refresh-memory').disabled, false);
});

for (const oldStatus of [200, 401]) test('actual core same-wallet login announces its generation before an old workspace ' + oldStatus + ' can return', async () => {
  const pending = deferred(); let count = 0;
  const { h, control } = await boot({ hash: '#/assistant', linked: false });
  control.transport = call => {
    if (call.url === '/api/conversations/' + CONVERSATION_A) {
      count++; return count === 1 ? pending.promise : response({ ...control.ca, title: 'CURRENT_RENEWED_CONVERSATION' });
    }
    if (call.url === '/api/auth/challenge') return response({ challengeId: TASK_A, message: 'Scripted local authentication challenge' });
    if (call.url === '/api/auth/verify') return response({ wallet: A });
  };
  h.window.phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: { toString: () => A } }),
    signMessage: async () => ({ signature: new Uint8Array(64) }) } };
  const opening = openConversation(h, CONVERSATION_A); await until(() => count === 1);
  await h.get('connect-wallet').trigger('click'); await until(() => count === 2); await settle();
  const generations = h.events.filter(event => event.type === 'floww:session').map(event => event.detail.generation);
  assert.ok(generations.includes(2));
  pending.resolve(oldStatus === 200 ? response({ ...control.ca, title: 'STALE_PRIOR_SESSION' }) : response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401));
  await opening; await settle();
  assert.match(h.get('conversation-title').textContent, /CURRENT_RENEWED_CONVERSATION/);
  assert.doesNotMatch(h.get('conversation-title').textContent, /STALE_PRIOR_SESSION/);
  assert.equal(h.get('logout').hidden, false); assert.equal(h.get('connect-wallet').title, A);
  assert.equal(h.events.filter(event => event.type === 'floww:session-expired').length, 0);
  assert.equal(posts(h).length, 2); // Explicit scripted challenge and verification only.
});

test('actual different-wallet login clears the prior owner cache, quote, report and form DOM without an accountChanged event', async () => {
  const { h, control } = await boot({ hash: tURL(TASK_A), result: true });
  const loading = deferred(); let newOwnerRead = false;
  assert.match(h.get('result-content').textContent, /EXACT_AUTHORIZED_ANSWER/);
  h.get('purpose').value = 'OWNER_A_PRIVATE_REQUEST'; h.get('budget').value = '9.876543219'; h.get('approval-ack').checked = true;
  control.transport = call => {
    if (call.url === '/api/auth/challenge') return response({ challengeId: TASK_B, message: 'Scripted owner replacement' });
    if (call.url === '/api/auth/verify') { control.owner = B; return response({ wallet: B }); }
    if (call.url.startsWith('/api/tasks?')) { newOwnerRead = true; return loading.promise; }
  };
  h.window.phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: { toString: () => B } }),
    signMessage: async () => ({ signature: new Uint8Array(64) }) } };
  const signIn = h.get('connect-wallet').trigger('click'); await until(() => newOwnerRead); await settle();
  assert.equal(h.get('connect-wallet').title, B); assert.equal(h.window.location.hash, '#/tasks');
  assert.equal(h.get('logout').disabled, true); assert.equal(h.get('create-task').disabled, true);
  assert.equal(h.get('result-content').textContent, ''); assert.equal(h.get('quote-details').textContent, ''); assert.equal(h.get('quote-price').textContent, '');
  assert.equal(h.get('purpose').value, ''); assert.equal(h.get('budget').value, ''); assert.equal(h.get('approval-ack').checked, false);
  assert.doesNotMatch(h.get('task-list').textContent, /AUTHORIZED_TASK_A/);
  loading.resolve(response({ tasks: [control.tb], nextCursor: null })); await signIn; await settle();
  assert.equal(h.get('logout').disabled, false); assert.equal(h.get('create-task').disabled, false);
  h.get('interface-language').value = 'en'; await h.get('interface-language').trigger('change');
  assert.equal(h.get('result-content').textContent, ''); assert.equal(h.get('quote-price').textContent, '');
  assert.equal(posts(h).length, 2);
});

test('logout and owner switch sanitize current deep IDs and old history requires a fresh authorized read', async () => {
  let owner = A;
  const h = harness(client, call => {
    if (call.url.startsWith('/api/conversations?')) { const c = conversation(owner === A ? CONVERSATION_A : CONVERSATION_B, owner); return response({ items: [{ id: c.id, data: { title: c.title, status: c.status } }], nextCursor: null }); }
    if (call.url === '/api/mandates') return response({ mandates: [] });
    if (call.url.startsWith('/api/memories?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/conversations/' + CONVERSATION_A) return owner === A ? response(conversation(CONVERSATION_A, A)) : response({ error: { code: 'NOT_FOUND' } }, 404);
    assert.fail('Unexpected request ' + call.url);
  }, { hash: cURL(CONVERSATION_A) });
  h.session(A); await settle(); h.get('message-text').value = 'OWNER_A_PRIVATE_DRAFT'; await h.nav('memory'); await settle();
  h.session(null); await settle(); owner = B; h.session(B); await settle();
  assert.equal(h.window.location.hash, '#/memory'); assert.doesNotMatch(h.get('conversation-title').textContent, /A private/);
  h.window.history.back(); await settle();
  assert.equal(reads(h, '/api/conversations/' + CONVERSATION_A), 2);
  assert.equal(h.get('dialogue-header').hidden, true); assert.equal(h.get('message-text').value, '');
  assert.doesNotMatch(h.get('dialogue-messages').textContent, /A private/); assert.match(h.get('shell-status').textContent, /접근할 수 없/); assert.equal(posts(h).length, 0);
});
