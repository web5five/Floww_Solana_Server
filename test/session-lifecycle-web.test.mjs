import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness, client, taskClient, adminClient, voiceAudio, voiceClient, A, B, TASK_A, CONVERSATION_A,
  task, conversation, overview, response, deferred, settle, until } from './ui-harness.mjs';
import { media, caps, startVoice } from './voice-ui-harness.mjs';

// These are actual-client lifecycle/port regressions, not evidence that a native
// browser entered BFCache. The controller separately observes persisted=true.
const source = taskClient + '\n' + client + '\n' + adminClient + '\n' + voiceAudio + '\n' + voiceClient;
const expiry = () => new Date(Date.now() + 3_600_000).toISOString();
const session = owner => owner ? response({ wallet: owner, expiresAt: expiry() }) : response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401);
const writes = h => h.calls.filter(c => c.method !== 'GET');
const convoURL = '#/assistant/conversations/' + CONVERSATION_A;
const adminFixture = JSON.parse(await readFile(new URL('./fixtures/admin-read-v1.json', import.meta.url), 'utf8'));
const normalize = value => JSON.parse(JSON.stringify(value));
async function boot({ hash = '#/assistant', owner = A, transport, browser = {}, restoredForms = {}, admin = false, withMedia = false } = {}) {
  const c = conversation(CONVERSATION_A, A, false); c.status = 'CLARIFICATION_REQUIRED'; c.messages = [{ id: 'prior-reply', role: 'assistant', text: 'OWNER_A_PRIVATE_REPLY' }];
  const t = task(TASK_A, 'OWNER_A_PRIVATE_TASK'); t.quote = { hash: 'a'.repeat(64), amountAtomic: '1234567891', assetDecimals: 9,
    asset: A, network: 'solana:devnet', recipient: B, payer: A, resourceUrl: 'https://resource.example/transfers', expiresAt: expiry() };
  const m = media(), control = { owner, c, t, transport, admin, reads: 0 };
  const h = harness(source, call => {
    const custom = control.transport?.(call, control); if (custom !== undefined) return custom;
    if (call.url === '/api/health') return response({ workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true, ready: true, merchantConfigured: true });
    if (call.url === '/api/session') { control.reads++; return session(control.owner); }
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: control.owner === A ? [control.t] : [], nextCursor: null });
    if (call.url === '/api/tasks/' + TASK_A) return control.owner === A ? response(control.t) : response({ error: { code: 'NOT_FOUND' } }, 404);
    if (call.url === '/api/conversations/' + CONVERSATION_A) return control.owner === A ? response(control.c) : response({ error: { code: 'WORKSPACE_NOT_FOUND' } }, 404);
    if (call.url.startsWith('/api/conversations?')) return response({ items: control.owner === A ? [{ id: c.id, data: { title: c.title, status: c.status } }] : [], nextCursor: null });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    if (call.url === '/api/dashboard') return response(overview());
    if (call.url === '/api/catalog') return response({ resources: [] });
    if (call.url.startsWith('/api/activity?')) return response({ events: [] });
    if (call.url.startsWith('/api/memories?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/voice/capabilities') return response(caps());
    if (call.url === '/api/admin/access') return control.admin ? response({ role: 'ADMIN_READ', expiresAt: expiry() }) : response({ error: { code: 'ADMIN_ACCESS_DENIED' } }, 403);
    if (call.url === '/api/admin/overview') return response(adminFixture.overview);
    if (call.url.startsWith('/api/admin/requests?')) return response(adminFixture.requests);
    if (call.url.startsWith('/api/admin/events?')) return response(adminFixture.events);
    assert.fail('No implicit mutation or unscripted read is allowed: ' + call.method + ' ' + call.url);
  }, { hash, restoredForms, browser: { ...(withMedia ? m.browser : {}), ...browser } });
  await until(() => h.get('session-restore').hidden && (owner ? !h.get('logout').disabled : !h.get('connect-wallet').disabled)); await settle();
  return { h, control, m };
}
function suspend(h) { h.emitPage('pagehide', true); }
async function resume(h) { h.emitPage('pageshow', true); await until(() => h.get('session-restore').hidden); await settle(); }

test('cold entry discards unowned browser form history after pageshow before binding current B', async () => {
  const { h } = await boot({ owner: B, restoredForms: { 'message-text': 'OWNER_A_BROWSER_RESTORED', purpose: 'OWNER_A_MANUAL', 'voice-transcript': 'OWNER_A_VOICE', 'memory-value': 'OWNER_A_MEMORY' } });
  assert.equal(h.get('connect-wallet').title, B);
  for (const id of ['message-text', 'purpose', 'voice-transcript', 'memory-value']) assert.equal(h.get(id).value, '', id);
  assert.doesNotMatch(h.document.body.textContent, /OWNER_A_BROWSER_RESTORED|OWNER_A_MANUAL|OWNER_A_VOICE|OWNER_A_MEMORY/);
  assert.equal(writes(h).length, 0);
});

test('same A restoration quarantines drafts, refetches its exact route and never restores acknowledgment', async () => {
  const { h } = await boot({ hash: convoURL });
  h.get('message-text').value = 'OWNER_A_UNSENT'; h.get('intent-wallet').value = B; h.get('conversation-memory').checked = true;
  h.get('memory-value').value = 'OWNER_A_MEMORY_DRAFT'; h.get('memory-ack').checked = true; h.get('mandate-ack').checked = true; h.get('approval-ack').checked = true;
  const before = h.calls.length;
  suspend(h);
  assert.equal(h.get('message-text').value, ''); assert.equal(h.get('memory-value').value, '');
  assert.equal(h.document.querySelector('.app-layout').hidden, true); assert.equal(h.get('session-restore').hidden, false);
  assert.doesNotMatch(h.document.body.textContent, /OWNER_A_PRIVATE_REPLY|OWNER_A_UNSENT|OWNER_A_MEMORY_DRAFT/);
  h.window.FlowwLocale.setLanguage('en'); assert.doesNotMatch(h.document.body.textContent, /OWNER_A_PRIVATE_REPLY|OWNER_A_UNSENT/);
  await resume(h);
  assert.equal(h.window.location.hash, convoURL); assert.equal(h.get('message-text').value, 'OWNER_A_UNSENT'); assert.equal(h.get('intent-wallet').value, B);
  assert.equal(h.get('memory-value').value, 'OWNER_A_MEMORY_DRAFT');
  for (const id of ['memory-ack', 'mandate-ack', 'approval-ack', 'voice-consent']) assert.equal(h.get(id).checked, false, id);
  assert.equal(h.calls.slice(before).filter(c => c.method !== 'GET').length, 0); assert.ok(h.calls.slice(before).some(c => c.url === '/api/conversations/' + CONVERSATION_A));
  assert.equal(h.storageWrites.some(([key]) => key !== 'floww.ui.locale'), false); assert.ok(h.historyEntries.every(e => e.state === null));
  assert.deepEqual(h.backgroundErrors, []);
});

for (const owner of [B, null]) test('authoritative ' + (owner ? 'B' : 'guest') + ' discards A heap drafts, opaque target and hidden private leaves', async () => {
  const { h, control } = await boot({ hash: convoURL }); h.get('message-text').value = 'OWNER_A_UNSENT'; h.get('purpose').value = 'OWNER_A_MANUAL';
  suspend(h); control.owner = owner; await resume(h);
  assert.equal(h.window.location.hash, '#/assistant'); assert.equal(h.get('message-text').value, ''); assert.equal(h.get('purpose').value, '');
  assert.equal(h.get('connect-wallet').title, owner ?? 'Phantom 지갑으로 로그인');
  h.window.FlowwLocale.setLanguage('en'); assert.doesNotMatch(h.document.body.textContent, /OWNER_A_PRIVATE|OWNER_A_UNSENT|OWNER_A_MANUAL/);
  assert.equal(writes(h).length, 0);
});

test('verification failure keeps drafts inaccessible and explicit retry is GET-only with visible restored focus', async () => {
  const pending = deferred(); let fail = false, delayed = false;
  const { h, control } = await boot({ transport(call, c) { if (call.url === '/api/session' && fail) return response({ error: { code: 'SERVICE_UNAVAILABLE' } }, 503); if (call.url === '/api/session' && delayed) return pending.promise; } });
  h.get('message-text').value = 'PRIVATE_RETRY_DRAFT'; suspend(h); fail = true; h.emitPage('pageshow'); await settle();
  assert.equal(h.get('session-restore').hidden, false); assert.equal(h.get('session-restore-retry').hidden, false); assert.equal(h.get('message-text').value, '');
  assert.match(h.get('session-restore-text').textContent, /로그인을 확인하지 못/);
  fail = false; delayed = true; const retry = h.get('session-restore-retry').trigger('click'); await settle();
  assert.equal(h.get('message-text').value, ''); pending.resolve(session(A)); await retry; await settle();
  assert.equal(h.get('message-text').value, 'PRIVATE_RETRY_DRAFT'); assert.equal(writes(h).length, 0);
  assert.equal(h.document.activeElement, h.get('workspace-top'));
});

test('a second departure fences a pending authority check without overwriting the original quarantine', async () => {
  const pending = deferred(); let delayed = false;
  const { h, control } = await boot({ transport(call) { if (call.url === '/api/session' && delayed) return pending.promise; } });
  h.get('message-text').value = 'ORIGINAL_HEAP_DRAFT'; suspend(h); delayed = true; h.emitPage('pageshow'); h.emitPage('pageshow'); await settle();
  assert.equal(h.calls.filter(c => c.url === '/api/session').length, 2, 'one initial plus one deduplicated restore read');
  suspend(h); pending.resolve(session(A)); await settle(); assert.equal(h.get('session-restore').hidden, false); assert.equal(h.get('message-text').value, '');
  delayed = false; await resume(h); assert.equal(h.get('message-text').value, 'ORIGINAL_HEAP_DRAFT'); assert.equal(writes(h).length, 0);
});

for (const status of [200, 401]) test('old conversation ' + status + ' cannot publish after suspend or expire the revalidated owner', async () => {
  const pending = deferred(); let delay = false;
  const { h, control } = await boot({ transport(call) { if (delay && call.url === '/api/conversations/' + CONVERSATION_A) return pending.promise; } });
  delay = true; h.window.location.hash = convoURL; await settle(); suspend(h); delay = false; control.owner = B; await resume(h);
  pending.resolve(status === 200 ? response(conversation(CONVERSATION_A, A)) : response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401)); await settle();
  assert.equal(h.get('connect-wallet').title, B); assert.doesNotMatch(h.document.body.textContent, /A private plan/); assert.equal(writes(h).length, 0);
});

test('pending approval accepted after pagehide cannot execute before or after same-owner revalidation', async () => {
  const pending = deferred();
  const { h, control } = await boot({ hash: '#/tasks/' + TASK_A, transport(call) { if (call.url.endsWith('/approve')) return pending.promise; } });
  h.get('budget').value = '2.123456789'; h.get('approval-expiry').value = new Date(Date.now() + 60_000).toISOString().slice(0, 19); h.get('approval-ack').checked = true;
  const action = h.get('approval-form').trigger('submit'); await until(() => h.calls.some(c => c.url.endsWith('/approve'))); suspend(h);
  const approved = { ...control.t, policy: 'ALLOW', approval: { id: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee', quoteHash: control.t.quote.hash, payer: A, budgetAtomic: '2123456789', expiresAt: new Date(h.calls.find(c => c.url.endsWith('/approve')).body.expiresAt).toISOString() } };
  pending.resolve(response(approved)); await action; await settle(); assert.equal(h.calls.some(c => c.url.endsWith('/execute')), false);
  await resume(h); assert.equal(h.calls.some(c => c.url.endsWith('/execute')), false); assert.equal(h.get('approval-ack').checked, false);
  assert.equal(h.get('budget').value, '2.123456789'); assert.equal(h.get('quote-price').textContent, '1.234567891 토큰');
});

test('admitted uncertain message cannot auto-plan after suspension; unchanged manual retry keeps its exact body and ID', async () => {
  const pending = deferred(); let first = true;
  const { h, control } = await boot({ hash: convoURL, transport(call, c) {
    if (call.url.endsWith('/messages')) { if (first) { first = false; return pending.promise; } return response({ ...c.c, status: 'CLARIFICATION_REQUIRED' }); }
  } });
  h.get('message-text').value = 'EXACT_RETRY'; h.get('intent-wallet').value = B; const action = h.get('message-form').trigger('submit');
  await until(() => writes(h).length === 1); const original = normalize(writes(h)[0].body); suspend(h);
  control.c = { ...control.c, revision: 3, intent: { ...control.c.intent, wallet: B } };
  pending.resolve(response({ ...control.c, status: 'READY_TO_PLAN' })); await action; await settle();
  assert.equal(h.calls.some(c => c.url.endsWith('/plan')), false); await resume(h); assert.equal(h.calls.some(c => c.url.endsWith('/plan')), false);
  assert.equal(h.get('message-text').value, 'EXACT_RETRY'); assert.match(h.get('shell-status').textContent, /서버에서 처리 중/);
  await h.get('message-form').trigger('submit'); await settle(); assert.deepEqual(normalize(writes(h)[1].body), original);
});

test('a pending direct Task admission preserves its exact manual retry key/body without creating again on restore', async () => {
  const pending = deferred(); let created = 0;
  const { h, control } = await boot({ hash: '#/tasks', transport(call, c) {
    if (call.url === '/api/tasks' && call.method === 'POST') { if (++created === 1) return pending.promise; c.t = { ...c.t, purpose: call.body.purpose }; return response(c.t, 201); }
  } });
  h.get('purpose').value = 'ONE_UNCERTAIN_TASK'; h.get('report-wallet').value = A;
  h.get('window-start').value = new Date(Date.now() - 7_200_000).toISOString().slice(0, 19); h.get('window-end').value = new Date(Date.now() - 3_600_000).toISOString().slice(0, 19);
  const creating = h.get('request-form').trigger('submit'); await until(() => created === 1); const first = writes(h)[0];
  suspend(h); pending.resolve(response(control.t, 201)); await creating; await resume(h); assert.equal(created, 1); assert.equal(h.get('purpose').value, 'ONE_UNCERTAIN_TASK');
  await h.get('request-form').trigger('submit'); await settle(); assert.equal(created, 2);
  const second = writes(h)[1]; assert.equal(second.headers['Idempotency-Key'], first.headers['Idempotency-Key']); assert.deepEqual(normalize(second.body), normalize(first.body));
});

for (const boundary of ['connect', 'sign']) test('Phantom ' + boundary + ' resolving after suspension cannot advance auth', async () => {
  const pending = deferred(); let signStarted = false; const provider = { isPhantom: true, connect: () => boundary === 'connect' ? pending.promise : Promise.resolve({ publicKey: { toString: () => A } }), signMessage: () => { signStarted = true; return pending.promise; } };
  const { h } = await boot({ owner: null, browser: { phantom: { solana: provider } }, transport(call) { if (call.url === '/api/auth/challenge') return response({ challengeId: 'test', message: 'scripted' }); } });
  const signing = h.get('connect-wallet').trigger('click'); await until(() => boundary === 'connect' ? h.get('connect-wallet').disabled : signStarted);
  suspend(h); pending.resolve(boundary === 'connect' ? { publicKey: { toString: () => A } } : { signature: new Uint8Array(64) }); await signing; await settle();
  assert.equal(h.calls.some(c => c.url === '/api/auth/verify'), false); assert.equal(h.calls.filter(c => c.url === '/api/auth/challenge').length, boundary === 'connect' ? 0 : 1);
});

test('actual provider account change during a delayed authority read exposes retry and cannot restore the old cookie owner', async () => {
  const listeners = new Map(), pending = deferred(); let delayed = false;
  const provider = { isPhantom: true, connect: async () => ({ publicKey: { toString: () => A } }), signMessage: async () => ({ signature: new Uint8Array(64) }), on: (name, listener) => listeners.set(name, listener) };
  const { h, control } = await boot({ owner: null, browser: { phantom: { solana: provider } }, transport(call, c) {
    if (call.url === '/api/auth/challenge') return response({ challengeId: 'test', message: 'scripted' });
    if (call.url === '/api/auth/verify') { c.owner = A; return session(A); }
    if (call.url === '/api/session' && delayed) return pending.promise;
    if (call.url === '/api/auth/logout') return response(null, 204);
  } });
  await h.get('connect-wallet').trigger('click'); await settle(); assert.ok(listeners.has('accountChanged'));
  h.get('message-text').value = 'MUST_NOT_RESTORE'; suspend(h); delayed = true; h.emitPage('pageshow'); await settle();
  listeners.get('accountChanged')(); await settle(); assert.equal(h.get('session-restore-retry').hidden, false);
  pending.resolve(session(A)); await settle(); assert.equal(h.get('message-text').value, '');
  delayed = false; await h.get('session-restore-retry').trigger('click'); await settle();
  assert.equal(h.get('logout').hidden, true); assert.equal(h.get('connect-wallet').disabled, false); assert.equal(h.get('message-text').value, '');
  const logout = h.calls.find(c => c.url === '/api/auth/logout'); assert.deepEqual(normalize(logout.body), { expectedWallet: A }); assert.equal(logout.keepalive, true);
  assert.equal(h.calls.filter(c => c.url === '/api/auth/logout').length, 1);
  assert.equal(h.calls.filter(c => c.url === '/api/auth/verify').length, 1);
});

test('an already-issued conditional account revocation survives the next pagehide without publishing its late response', async () => {
  const pending = deferred(), listeners = new Map();
  const provider = { isPhantom: true, connect: async () => ({ publicKey: { toString: () => A } }), signMessage: async () => ({ signature: new Uint8Array(64) }), on: (name, fn) => listeners.set(name, fn) };
  const { h, control } = await boot({ owner: null, browser: { phantom: { solana: provider } }, transport(call, c) {
    if (call.url === '/api/auth/challenge') return response({ challengeId: 'test', message: 'scripted' });
    if (call.url === '/api/auth/verify') { c.owner = call.body.wallet; return session(c.owner); }
    if (call.url === '/api/auth/logout') return pending.promise;
  } });
  await h.get('connect-wallet').trigger('click'); await settle(); listeners.get('accountChanged')(); await settle();
  const logout = h.calls.find(c => c.url === '/api/auth/logout'); assert.equal(logout.keepalive, true); assert.deepEqual(normalize(logout.body), { expectedWallet: A });
  suspend(h); assert.equal(logout.signal.aborted, false); control.owner = B; await resume(h);
  provider.connect = async () => ({ publicKey: { toString: () => B } }); await h.get('connect-wallet').trigger('click'); await settle();
  pending.resolve(response(null, 204)); await settle(); assert.equal(h.get('connect-wallet').title, B);
  assert.equal(h.calls.filter(c => c.url === '/api/auth/logout').length, 1);
});

test('two suspension cycles scrub again and restore exactly one read-only poll timer', async () => {
  const { h } = await boot();
  for (let i = 0; i < 2; i++) { h.get('message-text').value = 'DRAFT_' + i; suspend(h); assert.equal(h.intervals.size, 0); assert.equal(h.get('message-text').value, ''); await resume(h); assert.equal(h.get('message-text').value, 'DRAFT_' + i); assert.equal(h.intervals.size, 1); }
  assert.equal(h.calls.filter(c => c.url === '/api/session').length, 3); assert.equal(writes(h).length, 0);
});

test('admin role/source data are erased at suspension and freshly authorized after verified session', async () => {
  const { h, control } = await boot({ hash: '#/admin', admin: true }); assert.equal(h.get('admin-data').hidden, false);
  suspend(h); assert.equal(h.get('admin-open').hidden, true); assert.equal(h.get('admin-metrics').textContent, ''); assert.equal(h.get('admin-request-rows').textContent, '');
  control.admin = false; await resume(h); assert.equal(h.get('admin-open').hidden, true); assert.equal(h.get('admin-data').hidden, true); assert.equal(writes(h).length, 0);
});

test('voice draft remains private while suspended and requires fresh review; capture/speech/consent never resume', async () => {
  const { h, m } = await boot({ hash: '#/voice/conversations/' + CONVERSATION_A, withMedia: true });
  h.get('voice-transcript').value = 'OWNER_A_UNSENT_VOICE'; await h.get('voice-transcript').trigger('input'); h.get('voice-consent').checked = true;
  suspend(h); assert.equal(h.get('voice-transcript').value, ''); assert.equal(h.get('voice-answer-text').textContent, ''); assert.equal(h.get('voice-preview').textContent, '');
  await resume(h); assert.equal(h.get('voice-transcript').value, 'OWNER_A_UNSENT_VOICE'); assert.equal(h.get('voice-send').disabled, true); assert.equal(h.get('voice-rebase').hidden, false);
  assert.equal(h.get('voice-consent').checked, false); assert.equal(m.microphoneCalls, 0); assert.equal(m.spoken.length, 0); assert.equal(writes(h).length, 0);
});

for (const status of [200, 401]) test('suspension aborts actual worklet/STT and late ' + status + ' cannot revive text or expire B', async () => {
  const pending = deferred(); let upload;
  const { h, control, m } = await boot({ hash: '#/voice/conversations/' + CONVERSATION_A, withMedia: true, transport(call) {
    if (call.url === '/api/voice/transcriptions') { upload = call; return pending.promise; }
  } });
  await startVoice(h); m.feed(); await settle(); const stopping = h.get('voice-stop').trigger('click'); await until(() => upload);
  suspend(h); assert.ok(m.tracks.every(t => t.stopped)); assert.ok(m.contexts.every(c => c.closed)); assert.equal(upload.signal.aborted, true);
  control.owner = B; await resume(h);
  pending.resolve(status === 200 ? response({ version: 'voice-transcript/v1', captureId: upload.headers['X-Floww-Capture-Id'], conversationId: CONVERSATION_A, revision: 1, languageHint: 'ko', durationMs: 1000, text: 'STALE_OWNER_A_TRANSCRIPT' }) : response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401));
  await stopping; await settle(); assert.equal(h.get('connect-wallet').title, B); assert.equal(h.get('voice-transcript').value, ''); assert.doesNotMatch(h.document.body.textContent, /STALE_OWNER_A_TRANSCRIPT|OWNER_A_PRIVATE_REPLY/);
  assert.equal(h.calls.filter(c => c.url.endsWith('/messages')).length, 0); assert.equal(m.spoken.length, 0);
});

test('suspension stops an owned local utterance and fences its late native start after B revalidation', async () => {
  const { h, m, control } = await boot({ hash: '#/voice/conversations/' + CONVERSATION_A, withMedia: true });
  h.get('voice-read-language').value = 'en'; await h.get('voice-read-language').trigger('change'); h.get('voice-read-voice').value = 'local-samantha'; await h.get('voice-read-voice').trigger('change');
  await h.get('voice-speak').trigger('click'); await settle(); const utterance = m.spoken[0]; assert.ok(utterance);
  suspend(h); const cancellations = m.cancellations; assert.ok(cancellations > 0); assert.equal(utterance.text, '');
  control.owner = B; await resume(h); utterance.onstart(); await settle(); assert.ok(m.cancellations > cancellations);
  assert.equal(h.get('connect-wallet').title, B); assert.equal(h.get('voice-answer-text').textContent, ''); assert.equal(writes(h).length, 0);
});
