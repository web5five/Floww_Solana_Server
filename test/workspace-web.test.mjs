import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, client, taskClient, A, B, TASK_A, TASK_B, CONVERSATION_A, CONVERSATION_B, deferred, response, settle, until, task, overview, conversation } from './ui-harness.mjs';

for (const oldStatus of [200, 401]) test(`delayed owner-A task poll (${oldStatus}) neither leaks into nor logs out owner B`, async () => {
  const old = deferred(); let owner = A, aReads = 0;
  const a = task(TASK_A, 'OWNER_A_PRIVATE_PURPOSE', 'UNKNOWN'), b = task(TASK_B, 'OWNER_B_CURRENT_PURPOSE');
  const h = harness(taskClient, call => {
    if (call.url === '/api/health') return response({ ready: false, network: 'devnet' });
    if (call.url === '/api/session') return response({ wallet: owner });
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [owner === A ? a : b], nextCursor: null });
    if (call.url === '/api/tasks/' + TASK_A) return ++aReads === 1 ? response(a) : old.promise;
    if (call.url === '/api/tasks/' + TASK_B) return response(b);
    if (call.url === '/api/auth/logout') { owner = null; return response(null, 204); }
    if (call.url === '/api/auth/challenge') return response({ challengeId: 'scripted-auth', message: 'Scripted local authentication fixture' });
    if (call.url === '/api/auth/verify') { owner = B; return response({ wallet: B }); }
    if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    throw new Error('Unexpected request: ' + call.url);
  });
  await until(() => h.get('connect-wallet').title === A && h.get('logout').disabled === false);
  await settle();
  const polling = [...h.intervals.values()][0](); await until(() => aReads === 2);
  await h.get('logout').trigger('click');
  h.window.phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: { toString: () => B } }),
    signMessage: async () => ({ signature: new Uint8Array(64) }), on() {} } };
  await h.get('connect-wallet').trigger('click'); await settle();
  assert.equal(h.get('connect-wallet').title, B);
  old.resolve(oldStatus === 200 ? response(a) : response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401));
  await polling; await settle();
  assert.equal(h.get('connect-wallet').title, B);
  assert.match(h.get('task-list').textContent, /OWNER_B_CURRENT_PURPOSE/);
  assert.doesNotMatch(h.get('task-list').textContent, /OWNER_A_PRIVATE_PURPOSE/);
  assert.ok(h.calls.every(call => call.credentials === 'same-origin' && call.redirect === 'error'));
  assert.ok(h.calls.every(call => !/\/execute$|\/approve$/.test(call.url)));
});

test('logout removes private task draft, approval and rendered report contents before another login', async () => {
  const a = task(TASK_A, 'OWNER_A_PRIVATE_PURPOSE');
  a.result = { answer: { answer_text: 'OWNER_A_PRIVATE_REPORT', limitations: [] }, markdown: 'OWNER_A_PRIVATE_DOWNLOAD' };
  const h = harness(taskClient, call => {
    if (call.url === '/api/health') return response({ ready: false });
    if (call.url === '/api/session') return response({ wallet: A });
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [a], nextCursor: null });
    if (call.url === '/api/tasks/' + TASK_A) return response(a);
    if (call.url === '/api/auth/logout') return response(null, 204);
    if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    throw new Error('Unexpected request: ' + call.url);
  });
  await until(() => h.get('logout').disabled === false);
  assert.match(h.get('result-content').textContent, /OWNER_A_PRIVATE_REPORT/);
  h.get('purpose').value = 'OWNER_A_PRIVATE_DRAFT'; h.get('report-wallet').value = A;
  h.get('budget').value = '789012'; h.get('approval-ack').checked = true;
  await h.get('logout').trigger('click');
  assert.equal(h.get('purpose').value, ''); assert.equal(h.get('report-wallet').value, '');
  assert.equal(h.get('budget').value, ''); assert.equal(h.get('approval-ack').checked, false);
  assert.doesNotMatch(h.get('result-content').textContent, /OWNER_A_PRIVATE_REPORT/);
  assert.doesNotMatch(h.get('task-list').textContent, /OWNER_A_PRIVATE_PURPOSE/);
  assert.equal(h.get('transaction-link').textContent, '');
});

for (const stale of [false, true]) test(`${stale ? 'old-owner' : 'current-owner'} shell 401 ${stale ? 'preserves B session' : 'invalidates core session and private memory view'}`, async () => {
  const late = deferred(); let owner = A, wait = false, started = false;
  const h = harness(taskClient + '\n' + client, call => {
    if (call.url === '/api/health') return response({ ready: false });
    if (call.url === '/api/session') return response({ wallet: owner });
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url.startsWith('/api/memories?')) {
      if (wait) { started = true; return late.promise; }
      return response({ items: [{ id: 'memory-' + owner, revision: 1,
        data: { key: 'report preference', value: owner === A ? 'OWNER_A_PRIVATE_MEMORY' : 'OWNER_B_CURRENT_MEMORY', expiresAt: '2026-12-01T00:00:00Z' } }], nextCursor: null });
    }
    if (call.url === '/api/auth/logout') { owner = null; return response(null, 204); }
    if (call.url === '/api/auth/challenge') return response({ challengeId: 'scripted', message: 'Local scripted authentication' });
    if (call.url === '/api/auth/verify') { owner = B; return response({ wallet: B }); }
    if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    throw new Error('Unexpected request: ' + call.url);
  });
  await until(() => h.get('logout').disabled === false);
  await h.nav('memory'); await settle();
  assert.match(h.get('memory-list').textContent, /OWNER_A_PRIVATE_MEMORY/);
  wait = true;
  const refreshing = h.get('refresh-memory').trigger('click'); await until(() => started);
  if (stale) {
    await h.get('logout').trigger('click'); wait = false;
    h.window.phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: { toString: () => B } }),
      signMessage: async () => ({ signature: new Uint8Array(64) }), on() {} } };
    await h.get('connect-wallet').trigger('click'); await settle();
    assert.equal(h.get('connect-wallet').title, B);
    assert.match(h.get('memory-list').textContent, /OWNER_B_CURRENT_MEMORY/);
  }
  late.resolve(response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401)); await refreshing; await settle();
  assert.doesNotMatch(h.get('memory-list').textContent, /OWNER_A_PRIVATE_MEMORY/);
  if (stale) {
    assert.equal(h.get('connect-wallet').title, B); assert.match(h.get('memory-list').textContent, /OWNER_B_CURRENT_MEMORY/);
  } else {
    assert.equal(h.get('logout').hidden, true); assert.equal(h.get('connect-wallet').disabled, false);
    assert.equal(h.get('refresh-memory').disabled, true);
  }
});

test('changing wallet clears private mandate drafts, memory contents and consent controls', async () => {
  const h = harness(client, call => {
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    throw new Error('Unexpected request: ' + call.url);
  });
  h.session(A); await settle();
  h.get('mandate-purpose').value = 'OWNER_A_PRIVATE_MANDATE'; h.get('mandate-wallet').value = A;
  h.get('mandate-total').value = '934567'; h.get('mandate-per').value = '123456'; h.get('mandate-count').value = '89';
  h.get('memory-key').value = 'OWNER_A_PRIVATE_KEY_LABEL'; h.get('memory-value').value = 'OWNER_A_PRIVATE_PREFERENCE';
  h.get('conversation-memory').checked = true; h.get('memory-ack').checked = true; h.get('mandate-ack').checked = true;
  h.session(B); await settle();
  for (const id of ['mandate-purpose', 'mandate-wallet', 'mandate-total', 'mandate-per', 'memory-key', 'memory-value']) assert.equal(h.get(id).value, '', id);
  assert.equal(h.get('mandate-count').value, '5');
  for (const id of ['conversation-memory', 'memory-ack', 'mandate-ack']) assert.equal(h.get(id).checked, false, id);
});

test('delayed conversation from the previous wallet cannot restore its dialogue after owner switch', async () => {
  const old = deferred(); let owner = A, waiting = false;
  const a = conversation(CONVERSATION_A, A), b = conversation(CONVERSATION_B, B);
  const h = harness(client, call => {
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    if (call.url.startsWith('/api/conversations?')) { const c = owner === A ? a : b; return response({ items: [{ id: c.id, data: { title: c.title, status: c.status }, updatedAt: '2026-11-05T12:00:00Z' }], nextCursor: null }); }
    if (call.url === '/api/conversations/' + CONVERSATION_A) { waiting = true; return old.promise; }
    if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    throw new Error('Unexpected request: ' + call.url);
  });
  h.session(A); await settle(); await h.nav('assistant'); await settle();
  const opening = h.get('conversation-list').children[0].trigger('click'); await until(() => waiting);
  owner = B; h.session(B); await settle(); old.resolve(response(a)); await opening; await settle();
  assert.doesNotMatch(h.get('dialogue-messages').textContent, /A private plan/);
  assert.match(h.get('conversation-list').textContent, /B private plan/);
  assert.equal(h.get('send-message').disabled, false);
});

test('first-message automatic conversation creation preserves the user-entered exact scope', async () => {
  let posted; const empty = conversation(CONVERSATION_A, A, false); empty.intent = { purpose: null, wallet: null,
    windowStart: null, windowEnd: null, resourceId: 'wallet-transfers', missingFields: ['purpose', 'wallet', 'windowStart', 'windowEnd'] };
  const h = harness(client, call => {
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/conversations' && call.method === 'POST') return response(empty, 201);
    if (call.url === '/api/conversations/' + CONVERSATION_A + '/messages') { posted = call.body; return response({ ...empty, revision: 2 }); }
    if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    throw new Error('Unexpected request: ' + call.url);
  });
  h.session(A); await settle();
  h.get('message-text').value = 'Inspect my exact selected scope'; h.get('intent-wallet').value = A;
  h.get('intent-start').value = '2026-11-04T09:00:00'; h.get('intent-end').value = '2026-11-05T09:00:00';
  const expected = { wallet: A, windowStart: new Date(h.get('intent-start').value).toISOString(), windowEnd: new Date(h.get('intent-end').value).toISOString() };
  await h.get('message-form').trigger('submit'); await until(() => posted);
  assert.deepEqual(JSON.parse(JSON.stringify(posted.scope)), expected);
  assert.equal(posted.text, 'Inspect my exact selected scope');
});

test('one explicit plan confirmation always uses the currently displayed exact plan', async () => {
  const a = conversation(CONVERSATION_A, A), b = conversation(CONVERSATION_B, B); let submitted, linked = false;
  const h = harness(client, call => {
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    if (call.url.startsWith('/api/conversations?')) return response({ items: [a, b].map(c => ({ id: c.id,
      data: { title: c.title, status: c.status }, updatedAt: '2026-11-05T12:00:00Z' })), nextCursor: null });
    if (call.url === '/api/conversations/' + CONVERSATION_A) return response(a);
    if (call.url === '/api/conversations/' + CONVERSATION_B) return response(linked ? { ...b, linkedTaskId: TASK_B } : b);
    if (call.url === '/api/conversations/' + CONVERSATION_B + '/confirm') { submitted = call.body; linked = true; return response(task(TASK_B, b.title)); }
    if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    throw new Error('Unexpected request: ' + call.url);
  });
  h.session(A); await settle(); await h.nav('assistant'); await settle();
  await h.get('conversation-list').children[0].trigger('click'); await settle();
  assert.equal(h.get('confirm-plan').disabled, false);
  await h.get('conversation-list').children[1].trigger('click'); await settle();
  assert.equal(h.get('confirm-plan').disabled, false);
  assert.equal(h.document.getElementById('plan-ack'), null);
  assert.equal(h.calls.filter(call => call.url.endsWith('/confirm')).length, 0);
  await h.get('confirm-plan-form').trigger('submit'); await until(() => submitted);
  assert.equal(submitted.planHash, b.plan.hash); assert.equal(submitted.wallet, B);
  assert.equal(submitted.windowStart, b.plan.scope.windowStart); assert.equal(submitted.windowEnd, b.plan.scope.windowEnd);
  assert.equal(submitted.acknowledge, true);
});

test('task history fetches full results only for the selected summary', async () => {
  const first = task(TASK_A, 'First report'), second = task(TASK_B, 'Second report');
  const full = value => ({ ...value, result: { answer: { answer_text: value.id === TASK_A ? 'FIRST_LAZY_REPORT' : 'SECOND_LAZY_REPORT' }, markdown: 'scripted report' } });
  const h = harness(taskClient, call => {
    if (call.url === '/api/health') return response({ ready: false });
    if (call.url === '/api/session') return response({ wallet: A });
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [first, second].map(value => ({ ...value, resultAvailable: true, result: undefined })), nextCursor: null });
    if (call.url === '/api/tasks/' + TASK_A) return response(full(first));
    if (call.url === '/api/tasks/' + TASK_B) return response(full(second));
    if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    throw new Error('Unexpected request: ' + call.url);
  });
  await until(() => h.get('logout').disabled === false);
  assert.match(h.get('result-content').textContent, /FIRST_LAZY_REPORT/);
  assert.equal(h.calls.filter(call => call.url === '/api/tasks/' + TASK_A).length, 1);
  assert.equal(h.calls.filter(call => call.url === '/api/tasks/' + TASK_B).length, 0);
  await h.get('task-list').children[1].trigger('click');
  assert.match(h.get('result-content').textContent, /SECOND_LAZY_REPORT/);
  assert.doesNotMatch(h.get('result-content').textContent, /FIRST_LAZY_REPORT/);
  assert.equal(h.calls.filter(call => call.url === '/api/tasks/' + TASK_B).length, 1);
});

test('retrying an unchanged task after an uncertain HTTP result reuses the same idempotency key', async () => {
  let created = 0;
  const h = harness(taskClient, call => {
    if (call.url === '/api/health') return response({ ready: false });
    if (call.url === '/api/session') return response({ wallet: A });
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/tasks' && call.method === 'POST') {
      if (++created === 1) throw new TypeError('scripted transport interruption');
      return response(task(TASK_A, call.body.purpose), 201);
    }
    if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    throw new Error('Unexpected request: ' + call.url);
  });
  await until(() => h.get('logout').disabled === false);
  const localDate = value => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19); };
  h.get('purpose').value = 'One exact request'; h.get('report-wallet').value = A;
  h.get('window-start').value = localDate(Date.now() - 7200_000); h.get('window-end').value = localDate(Date.now() - 3600_000);
  await h.get('request-form').trigger('submit'); await until(() => created === 1 && h.get('create-task').disabled === false);
  await h.get('request-form').trigger('submit'); await until(() => created === 2 && h.get('create-task').disabled === false);
  const requests = h.calls.filter(call => call.url === '/api/tasks' && call.method === 'POST');
  assert.match(requests[0].headers['Idempotency-Key'], /^[a-f0-9-]{36}$/);
  assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].body)), JSON.parse(JSON.stringify(requests[1].body)));
  assert.equal(h.get('task-list').children.length, 1);
});

test('budget cards render actual remainingExecutions and retain older holds in the ledger history', async () => {
  const dashboard = overview(); dashboard.budget.reservations = [{ id: 'reservation', taskId: TASK_A, amountAtomic: '1000', state: 'HELD', day: '2026-11-04' }];
  const mandate = { id: 'mandate', purpose: 'Bounded transfers', wallet: A, status: 'ACTIVE',
    windowStart: '2026-11-04T00:00:00Z', windowEnd: '2026-11-05T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z',
    version: 1, remainingAtomic: '5000', spentAtomic: '1000', remainingExecutions: 3 };
  const h = harness(client, call => {
    if (call.url === '/api/dashboard') return response(dashboard);
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url === '/api/mandates') return response({ mandates: [mandate] });
    if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    throw new Error('Unexpected request: ' + call.url);
  });
  h.session(A); await settle(); await h.nav('budgets'); await settle();
  assert.match(h.get('mandate-list').textContent, /남은 실행3/);
  assert.doesNotMatch(h.get('mandate-list').textContent, /undefined|NaN/);
  assert.match(h.get('budget-metrics').textContent, /오늘.*예약/);
  assert.match(h.get('reservation-list').textContent, /예약 유지/);
  assert.match(h.get('reservation-list').textContent, /2026-11-04/);
  assert.match(h.get('reservation-list').textContent, /0\.001/);
  assert.doesNotMatch(h.get('reservation-list').textContent, /\b1000\b/);
});
