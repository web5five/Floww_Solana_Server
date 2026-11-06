import test from 'node:test';
import assert from 'node:assert/strict';
import { A, B, TASK_A, TASK_B, task, CONVERSATION_A, CONVERSATION_B, deferred, response, settle, until } from './ui-harness.mjs';
import { voiceBoot, caps, startVoice, captureTurn } from './voice-ui-harness.mjs';
const posts = h => h.calls.filter(c => c.method === 'POST');
const financial = h => h.calls.filter(c => /\/(quote|approve|execute|reconcile|recover|confirm)$/.test(c.url));

test('silent full Voice entry binds no record, requests no microphone and speaks nothing', async () => {
  const { h, m, control } = await voiceBoot();
  assert.equal(h.window.location.hash, '#/voice'); assert.equal(control.creates, 0); assert.equal(m.microphoneCalls, 0); assert.equal(m.contexts.length, 0); assert.equal(m.spoken.length, 0);
  assert.equal(h.get('voice-panel').hidden, false); assert.equal(h.get('voice-status').hidden, true); assert.equal(h.get('voice-start').disabled, true); assert.equal(posts(h).length, 0);
});
for (const locale of ['ko', 'en']) test(locale + ' first-empty-conversation real-worklet turn preserves pinned language/ID, exact draft and explicit Send boundary', async () => {
  const b = await voiceBoot({ locale }), { h, m, control } = b;
  h.get('message-text').value = 'ORIGINAL_TYPED_PURPOSE'; h.get('intent-wallet').value = B;
  const focus = h.get('voice-start'); focus.focus(); await startVoice(h);
  assert.equal(h.window.location.hash, '#/voice/conversations/' + CONVERSATION_A); assert.equal(control.creates, 1); assert.notEqual(h.document.activeElement, h.get('message-text'));
  m.feed(16000); await settle(); assert.ok(h.get('voice-level').value > 0); await h.get('voice-stop').trigger('click'); await settle();
  assert.equal(control.transcriptions, 1); assert.equal(control.messageCalls, 0); const upload = control.uploads[0];
  assert.equal(upload.headers['X-Floww-Language'], locale); assert.match(upload.headers['X-Floww-Capture-Id'], /^[a-f0-9-]{36}$/); assert.equal(upload.headers['X-Floww-Conversation-Id'], CONVERSATION_A); assert.equal(upload.headers['X-Floww-Voice-Consent'], 'true');
  assert.equal(new DataView(upload.body.buffer).getUint32(24, true), 16000); assert.equal(upload.body.length, 32044); assert.equal(h.get('message-text').value, 'ORIGINAL_TYPED_PURPOSE'); assert.equal(h.get('intent-wallet').value, B);
  assert.match(h.get('voice-preview').textContent, /ORIGINAL_TYPED_PURPOSE\n/); assert.ok(m.tracks.every(t => t.stopped)); assert.ok(m.contexts.every(c => c.closed));
  await h.get('voice-send').trigger('click'); await settle(); assert.equal(control.messageCalls, 1);
  assert.equal(posts(h).find(c => c.url.endsWith('/messages')).body.text, 'ORIGINAL_TYPED_PURPOSE\n' + control.text); assert.equal(control.creates, 1); assert.equal(financial(h).length, 0); assert.equal(m.spoken.length, 0); assert.deepEqual(h.backgroundErrors, []);
});
for (const rate of [44100, 48000]) test('native' + rate + ' real-worklet capture invokes resampling and uploads actual canonical16k length', async () => {
  const b = await voiceBoot({ rate }); await captureTurn(b, rate); const { control, m } = b;
  assert.equal(m.offline.length, 1); assert.equal(m.offline[0].sourceRate, rate); assert.equal(m.offline[0].sampleRate, 16000);
  assert.equal(control.uploads[0].body.length, 32044); assert.equal(new DataView(control.uploads[0].body.buffer).getUint32(24, true), 16000);
});
test('actual worklet60s seal transcribes once without waiting for an impossible second seal', async () => {
  const b = await voiceBoot(); await startVoice(b.h); b.m.feed(16000 * 61); await until(() => b.control.transcriptions === 1); await settle();
  assert.equal(b.control.uploads[0].body.length, 1920044); assert.equal(b.control.uploads.length, 1); assert.ok(b.m.tracks.every(t => t.stopped)); assert.equal(financial(b.h).length, 0);
});
test('Cancel with unresolved permission preserves original draft and stops every late-granted track', async () => {
  const pending = deferred(), b = await voiceBoot({ permission: () => pending.promise }); b.h.get('message-text').value = 'ORIGINAL_DRAFT';
  const starting = startVoice(b.h); await until(() => b.m.microphoneCalls === 1); await b.h.get('voice-cancel').trigger('click');
  assert.equal(b.h.document.activeElement, b.h.get('voice-heading'));
  const stream = b.m.stream(); pending.resolve(stream); await starting; await settle();
  assert.equal(b.h.get('message-text').value, 'ORIGINAL_DRAFT'); assert.ok(b.m.tracks.every(t => t.stopped)); assert.ok(b.m.contexts.every(c => c.closed)); assert.equal(b.control.transcriptions, 0); assert.equal(b.control.messageCalls, 0);
});
test('scope/locale/background changes stop capture without uploading or overwriting typed text', async () => {
  for (const kind of ['scope', 'locale', 'background']) {
    const b = await voiceBoot(); b.h.get('message-text').value = 'UNCHANGED_TYPED_DRAFT'; await startVoice(b.h); b.m.feed(800); await settle();
    if (kind === 'scope') { b.h.get('intent-wallet').value = B; await b.h.get('intent-wallet').trigger('input'); }
    if (kind === 'locale') b.h.window.FlowwLocale.setLanguage('en');
    if (kind === 'background') { b.h.document.hidden = true; b.h.emitDocument('visibilitychange'); }
    await settle(); assert.ok(b.m.tracks.every(t => t.stopped), kind); assert.ok(b.m.contexts.every(c => c.closed), kind); assert.equal(b.control.transcriptions, 0); assert.equal(b.h.get('message-text').value, 'UNCHANGED_TYPED_DRAFT');
  }
});
test('editable transcript remains separate, append-only Use is explicit and Cancel preserves the original', async () => {
  const b = await voiceBoot(); b.h.get('message-text').value = 'BASE'; await captureTurn(b); b.h.get('voice-transcript').value = 'EDITED_SPEECH'; await b.h.get('voice-transcript').trigger('input');
  assert.equal(b.h.get('message-text').value, 'BASE'); await b.h.get('voice-cancel').trigger('click'); assert.equal(b.h.get('message-text').value, 'BASE');
  await b.h.get('voice-use').trigger('click'); await settle(); assert.equal(b.h.get('message-text').value, 'BASE\nEDITED_SPEECH'); assert.equal(b.h.window.location.hash, '#/assistant/conversations/' + CONVERSATION_A); assert.equal(b.control.messageCalls, 0);
});
test('draft edited while STT is pending survives and recognized text requires explicit rebase', async () => {
  const pending = deferred(), b = await voiceBoot({ transport(call, c) { if (call.url === '/api/voice/transcriptions') { c.uploads.push(call); return pending.promise; } } });
  b.h.get('message-text').value = 'ORIGINAL'; await startVoice(b.h); b.m.feed(); await settle(); const stopping = b.h.get('voice-stop').trigger('click'); await until(() => b.control.uploads.length === 1);
  b.h.get('message-text').value = 'NEW_USER_EDIT'; await b.h.get('message-text').trigger('input'); const req = b.control.uploads[0];
  pending.resolve(response({ version: 'voice-transcript/v1', captureId: req.headers['X-Floww-Capture-Id'], conversationId: CONVERSATION_A, revision: 1, languageHint: 'ko', durationMs: 1000, text: 'RECOGNIZED_TEXT' }));
  await stopping; await settle(); assert.equal(b.h.get('message-text').value, 'NEW_USER_EDIT'); assert.equal(b.h.get('voice-transcript').value, 'RECOGNIZED_TEXT'); assert.equal(b.h.get('voice-send').disabled, true);
  await b.h.get('voice-rebase').trigger('click'); assert.equal(b.h.get('voice-send').disabled, false); assert.equal(b.h.get('voice-preview').textContent, 'NEW_USER_EDIT\nRECOGNIZED_TEXT'); assert.equal(b.control.messageCalls, 0);
});
test('over2000 combined text is preserved without truncation or model dispatch', async () => {
  const b = await voiceBoot(); b.h.get('message-text').value = 'X'.repeat(1995); await captureTurn(b); assert.equal(b.h.get('voice-send').disabled, true); assert.ok(b.h.get('voice-preview').textContent.length > 2000); assert.equal(b.h.get('message-text').value.length, 1995); assert.equal(b.control.messageCalls, 0);
});
for (const bad of [{ ...caps(), configured: false }, { ...caps(), enabled: false }, { ...caps(), sampleRate: 48000 }, {}]) test('unknown/disabled/malformed configuration never requests mic or provider', async () => {
  const b = await voiceBoot({ capabilities: bad }); b.h.get('voice-consent').checked = true; await b.h.get('voice-consent').trigger('change'); assert.equal(b.h.get('voice-start').disabled, true); await b.h.get('voice-start').trigger('click'); assert.equal(b.m.microphoneCalls, 0); assert.equal(b.control.transcriptions, 0); assert.equal(b.control.creates, 0);
});
test('guest opening microphone is silent and login does not implicitly start capture', async () => {
  const b = await voiceBoot({ owner: null }); assert.equal(b.h.get('voice-login').hidden, false); assert.equal(b.m.microphoneCalls, 0); assert.equal(b.control.creates, 0); assert.equal(posts(b.h).length, 0);
});
test('real playback only uses explicitly selected matching local voice; locale does not retag old Korean answer', async () => {
  const b = await voiceBoot({ hash: '#/voice/conversations/' + CONVERSATION_A }); b.control.c.messages = [{ id: 'ko-answer', role: 'assistant', text: '기존 한국어 답변', at: '2026-11-07T03:00:00.000Z' }];
  b.h.emit('floww:session', { wallet: A, generation: 2, initializing: false, health: { workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true } }); await settle();
  assert.equal(b.h.get('voice-speak').disabled, true); b.h.get('voice-read-language').value = 'ko'; await b.h.get('voice-read-language').trigger('change');
  await b.h.get('voice-speak').trigger('click'); await settle(); assert.equal(b.m.spoken.at(-1).voice.voiceURI, 'local-yuna'); assert.equal(b.m.spoken.at(-1).text, '기존 한국어 답변');
  b.h.window.FlowwLocale.setLanguage('en'); assert.ok(b.m.cancellations >= 1); assert.equal(b.h.get('voice-read-language').value, 'ko');
  await b.h.get('voice-speak').trigger('click'); await settle(); assert.equal(b.m.spoken.at(-1).voice.voiceURI, 'local-yuna');
  b.m.voices = b.m.voices.filter(v => v.voiceURI !== 'local-yuna'); b.m.listeners.get('voiceschanged')(); assert.equal(b.h.get('voice-speak').disabled, true); assert.equal(b.h.get('voice-read-voice').value, '');
});
test('memory edit immediately stops owned playback even without core control re-render', async () => {
  const b = await voiceBoot({ hash: '#/voice/conversations/' + CONVERSATION_A }); b.control.c.messages = [{ id: 'answer', role: 'assistant', text: 'Actual reply', at: '2026-11-07T03:00:00.000Z' }];
  b.h.emit('floww:session', { wallet: A, generation: 2, initializing: false, health: { workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true } }); await settle();
  b.h.get('voice-read-language').value = 'en'; await b.h.get('voice-read-language').trigger('change'); await b.h.get('voice-speak').trigger('click'); await settle();
  assert.equal(b.m.spoken.at(-1).voice.voiceURI, 'local-samantha'); const before = b.m.cancellations; b.h.get('conversation-memory').checked = true; await b.h.get('conversation-memory').trigger('change'); assert.ok(b.m.cancellations > before); assert.equal(b.h.get('voice-stop-speaking').hidden, true);
});
test('throwing optional voice subscribers cannot interrupt ordinary workspace controls or navigation', async () => {
  const b = await voiceBoot(); const unsubscribe = b.h.window.FlowwWorkspaceVoice.subscribe(() => { throw Error('isolated'); });
  b.h.get('message-text').value = 'DRAFT'; await b.h.nav('assistant'); await settle(); assert.equal(b.h.get('message-text').disabled, false); assert.equal(b.h.get('message-text').value, 'DRAFT'); unsubscribe(); assert.deepEqual(b.h.backgroundErrors, []);
});

async function turnMode(h, language = 'ko') {
  h.get('voice-mode').value = 'turn'; await h.get('voice-mode').trigger('change');
  h.get('voice-turn-language').value = language; await h.get('voice-turn-language').trigger('change');
}
for (const language of ['ko', 'en']) test(language + ' explicit one-turn Start authorizes one capture/STT/ordinary Send/new reply/local playback and never starts another mic', async () => {
  const b = await voiceBoot({ locale: language }); await turnMode(b.h, language); await captureTurn(b); await settle();
  assert.equal(b.control.creates, 1); assert.equal(b.control.transcriptions, 1); assert.equal(b.control.messageCalls, 1); assert.equal(b.m.microphoneCalls, 1); assert.equal(b.m.spoken.length, 1);
  assert.equal(b.m.spoken[0].text, 'CURRENT_ACTUAL_ASSISTANT_REPLY'); assert.equal(b.m.spoken[0].voice.voiceURI, language === 'ko' ? 'local-yuna' : 'local-samantha');
  assert.equal(b.m.spoken[0].voice.localService, true); assert.equal(b.control.uploads[0].headers['X-Floww-Language'], language); assert.equal(financial(b.h).length, 0); assert.ok(b.m.tracks.every(t => t.stopped));
  b.m.spoken[0].onend(); await settle(); assert.equal(b.m.microphoneCalls, 1); assert.equal(b.h.get('voice-stop-speaking').hidden, true); assert.doesNotMatch(b.h.get('voice-status').textContent, /읽고 있습니다|Reading with/);
});
test('one-turn worklet limit consumes its one authorized utterance without a second seal or mic', async () => {
  const b = await voiceBoot(); await turnMode(b.h); await startVoice(b.h); b.m.feed(16000 * 61); await until(() => b.m.spoken.length === 1); await settle();
  assert.equal(b.control.uploads.length, 1); assert.equal(b.control.uploads[0].body.length, 1920044); assert.equal(b.control.messageCalls, 1); assert.equal(b.m.microphoneCalls, 1);
});
for (const authored of ['typed', 'voice']) test('one-turn blocks an existing ' + authored + ' draft without replacing or sending it', async () => {
  const b = await voiceBoot(); if (authored === 'typed') b.h.get('message-text').value = 'EXISTING_AUTHOR_TEXT'; else { await captureTurn(b); b.h.get('voice-transcript').value = 'EXISTING_REVIEW_TEXT'; await b.h.get('voice-transcript').trigger('input'); }
  const before = b.m.microphoneCalls; await turnMode(b.h); await startVoice(b.h);
  assert.equal(b.h.get('voice-start').disabled, true); assert.equal(b.m.microphoneCalls, before); assert.equal(b.control.messageCalls, 0);
  assert.equal(b.h.get(authored === 'typed' ? 'message-text' : 'voice-transcript').value, authored === 'typed' ? 'EXISTING_AUTHOR_TEXT' : 'EXISTING_REVIEW_TEXT');
});
test('one-turn refuses known unavailable assistant before spending transcription; review-first existing conversation remains independent', async () => {
  const b = await voiceBoot({ hash: '#/voice/conversations/' + CONVERSATION_A });
  b.h.emit('floww:session', { wallet: A, generation: 2, initializing: false, health: { workspaceAdapterReady: false, reportAdapterReady: true, modelConfigured: true } }); await settle();
  await turnMode(b.h); await startVoice(b.h); assert.equal(b.m.microphoneCalls, 0); assert.equal(b.control.transcriptions, 0); assert.equal(b.h.get('voice-start').disabled, true);
  b.h.get('voice-mode').value = 'review'; await b.h.get('voice-mode').trigger('change'); await captureTurn(b); assert.equal(b.control.transcriptions, 1); assert.equal(b.control.messageCalls, 0);
});
test('one-turn model failure cannot announce or read an older reply as the new answer', async () => {
  const b = await voiceBoot({ hash: '#/voice/conversations/' + CONVERSATION_A }); b.control.c.messages = [{ id: 'old', role: 'assistant', text: 'OLDER_REPLY_MUST_NOT_AUTOPLAY', at: '2026-11-07T03:00:00.000Z' }];
  b.h.emit('floww:session', { wallet: A, generation: 2, initializing: false, health: { workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true } }); await settle(); b.control.failMessage = true;
  await turnMode(b.h); await captureTurn(b); assert.equal(b.control.messageCalls, 1); assert.equal(b.m.spoken.length, 0); assert.match(b.h.get('voice-status').textContent, /새 응답|new answer/i); assert.equal(b.h.get('message-text').value, b.control.text);
});
test('one-turn Cancel after issued Send stops follow-up but preserves the ordinary admitted message', async () => {
  const pending = deferred(); let message;
  const b = await voiceBoot({ transport(call) { if (call.url.endsWith('/messages')) { message = call; return pending.promise; } } }); await turnMode(b.h); await startVoice(b.h); b.m.feed(); await settle();
  const stopping = b.h.get('voice-stop').trigger('click'); await until(() => Boolean(message)); await b.h.get('voice-cancel').trigger('click');
  b.control.c.revision++; b.control.c.messages.push({ id: 'accepted', role: 'assistant', text: 'NEW_REPLY_AFTER_CANCEL', at: '2026-11-07T03:00:00.000Z' }); pending.resolve(response(b.control.c)); await stopping; await settle();
  assert.equal(b.m.spoken.length, 0); assert.match(b.h.get('voice-status').textContent, /현재 대화|current conversation/i); assert.doesNotMatch(b.h.get('voice-status').textContent, /철회|retract/i); assert.equal(posts(b.h).filter(c => c.url.endsWith('/messages')).length, 1);
});
test('Cancel before actual TTS onstart fences the delayed callback and never claims speaking', async () => {
  const b = await voiceBoot(); b.h.window.speechSynthesis.speak = utterance => b.m.spoken.push(utterance);
  await turnMode(b.h); await captureTurn(b); assert.equal(b.m.spoken.length, 1); assert.equal(b.h.get('voice-stop-speaking').hidden, false); assert.match(b.h.get('voice-status').textContent, /준비하고 있습니다/);
  await b.h.get('voice-cancel').trigger('click'); const beforeLate = b.m.cancellations, currentText = b.h.get('voice-answer-text').textContent;
  assert.equal(b.m.spoken[0].text, ''); assert.equal(b.m.spoken[0].volume, 0);
  Object.defineProperty(b.m.spoken[0], 'text', { configurable: true, get: () => '', set() { throw Error('Native host rejected late text mutation'); } });
  b.m.spoken[0].onstart(); await settle(); assert.ok(b.m.cancellations > beforeLate); assert.equal(b.h.get('voice-answer-text').textContent, currentText); assert.equal(b.h.get('voice-stop-speaking').hidden, true); assert.doesNotMatch(b.h.get('voice-status').textContent, /읽고 있습니다|Reading with/);
});
test('selected local voice disappearing during model wait never falls back to another or remote voice', async () => {
  const pending = deferred(); let reached = false;
  const b = await voiceBoot({ transport(call) { if (call.url.endsWith('/messages')) { reached = true; return pending.promise; } } }); await turnMode(b.h); await startVoice(b.h); b.m.feed(); await settle(); const stopping = b.h.get('voice-stop').trigger('click'); await until(() => reached);
  b.m.voices = b.m.voices.filter(v => v.voiceURI !== 'local-yuna'); b.control.c.revision++; b.control.c.messages.push({ id: 'new', role: 'assistant', text: 'NEW_REPLY', at: '2026-11-07T03:00:00.000Z' }); pending.resolve(response(b.control.c)); await stopping; await settle();
  assert.equal(b.m.spoken.length, 0); assert.match(b.h.get('voice-status').textContent, /기기 음성|on-device voice/i);
});
for (const locale of ['ko', 'en']) test(locale + ' manual Stop playback clears visible speaking state', async () => {
  const b = await voiceBoot({ locale }); await turnMode(b.h, locale); await captureTurn(b); assert.equal(b.m.spoken.length, 1);
  await b.h.get('voice-stop-speaking').trigger('click'); assert.equal(b.h.get('voice-stop-speaking').hidden, true); assert.doesNotMatch(b.h.get('voice-status').textContent, /읽고 있습니다|Reading with/); assert.match(b.h.get('voice-status').textContent, locale === 'ko' ? /중지/ : /stopped/i);
});
test('review text and ordinary Send stay ahead of optional new recording controls without duplicating nodes', async () => {
  const b = await voiceBoot(); await captureTurn(b); assert.equal(b.h.get('voice-review').parentNode, b.h.get('voice-current-slot')); assert.equal(b.h.get('voice-new-capture').open, false);
  assert.equal(b.h.get('voice-preview').hidden, true); assert.equal(b.h.document.querySelectorAll('#voice-transcript').length, 1); assert.equal(b.h.get('voice-send').disabled, false);
});

test('closed one-turn settings retain named voice/language and Stop-or-limit send/read disclosure at Start', async () => {
  const b = await voiceBoot(); await turnMode(b.h); b.h.get('voice-mode-options').open = false;
  assert.match(b.h.get('voice-mode-summary').textContent, /한국어.*유나/); assert.equal(b.h.get('voice-turn-summary').hidden, false);
  assert.match(b.h.get('voice-turn-summary').textContent, /60초/); assert.match(b.h.get('voice-turn-summary').textContent, /새 답변.*유나/);
});
for (const lateStatus of [200, 401]) test('old capability' + lateStatus + ' cannot strand a replacement Voice route or expire its owner', async () => {
  const pending = deferred(); let calls = 0;
  const b = await voiceBoot({ transport(call) { if (call.url === '/api/voice/capabilities' && ++calls === 1) return pending.promise; } });
  b.control.cb = { ...b.control.c, id: CONVERSATION_B, title: 'SECOND_OWNED_CONTEXT' };
  b.h.window.location.hash = '#/voice/conversations/' + CONVERSATION_B; await until(() => calls >= 2); await settle();
  pending.resolve(response(lateStatus === 200 ? caps() : { error: { code: 'AUTHENTICATION_REQUIRED' } }, lateStatus)); await settle();
  assert.match(b.h.get('voice-context').textContent, /SECOND_OWNED_CONTEXT/); b.h.get('voice-consent').checked = true; await b.h.get('voice-consent').trigger('change');
  assert.equal(b.h.get('voice-start').disabled, false); assert.equal(b.h.events.filter(e => e.type === 'floww:session-expired').length, 0); assert.equal(b.m.microphoneCalls, 0);
});
for (const lateStatus of [200, 401]) test('logout fences an old STT' + lateStatus + ' and erases private voice editor and playback state', async () => {
  const pending = deferred(); let upload;
  const b = await voiceBoot({ transport(call) { if (call.url === '/api/voice/transcriptions') { upload = call; return pending.promise; } } }); await startVoice(b.h); b.m.feed(); await settle();
  const stopping = b.h.get('voice-stop').trigger('click'); await until(() => Boolean(upload)); await b.h.get('logout').trigger('click'); await settle();
  pending.resolve(response(lateStatus === 200 ? { version: 'voice-transcript/v1', captureId: upload.headers['X-Floww-Capture-Id'], conversationId: CONVERSATION_A, revision: 1, languageHint: 'ko', durationMs: 1000, text: 'OLD_OWNER_PRIVATE_TRANSCRIPT' } : { error: { code: 'AUTHENTICATION_REQUIRED' } }, lateStatus));
  await stopping; await settle(); b.h.window.FlowwLocale.setLanguage('en'); assert.equal(b.h.get('voice-transcript').value, ''); assert.doesNotMatch(b.h.get('voice-panel').textContent, /OLD_OWNER_PRIVATE_TRANSCRIPT/);
  assert.equal(b.m.spoken.length, 0); assert.equal(b.control.messageCalls, 0); assert.ok(b.m.tracks.every(t => t.stopped)); assert.equal(b.h.events.filter(e => e.type === 'floww:session-expired').length, 0);
});
for (const lateStatus of [200, 401]) test('actual same-wallet renewal fences prior STT' + lateStatus + ' before interpreting its body/status', async () => {
  const pending = deferred(); let upload;
  const b = await voiceBoot({ transport(call) {
    if (call.url === '/api/voice/transcriptions') { upload = call; return pending.promise; }
    if (call.url === '/api/auth/challenge') return response({ challengeId: CONVERSATION_A, message: 'Scripted local authentication challenge' });
    if (call.url === '/api/auth/verify') return response({ wallet: A });
  } }); await startVoice(b.h); b.m.feed(); await settle(); const stopping = b.h.get('voice-stop').trigger('click'); await until(() => Boolean(upload));
  b.h.window.phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: { toString: () => A } }), signMessage: async () => ({ signature: new Uint8Array(64) }) } };
  await b.h.get('connect-wallet').trigger('click'); await settle();
  pending.resolve(response(lateStatus === 200 ? { version: 'voice-transcript/v1', captureId: upload.headers['X-Floww-Capture-Id'], conversationId: CONVERSATION_A, revision: 1, languageHint: 'ko', durationMs: 1000, text: 'PRIOR_SESSION_TRANSCRIPT' } : { error: { code: 'AUTHENTICATION_REQUIRED' } }, lateStatus));
  await stopping; await settle(); assert.equal(b.h.get('connect-wallet').title, A); assert.equal(b.h.get('logout').hidden, false); assert.equal(b.h.get('voice-transcript').value, ''); assert.equal(b.h.events.filter(e => e.type === 'floww:session-expired').length, 0);
});
test('a pending old-owner ensure cannot block or clear a replacement owner flight', async () => {
  const pending = deferred(); let creates = 0;
  const b = await voiceBoot({ transport(call, c) {
    if (call.url === '/api/conversations' && ++creates === 1) return pending.promise;
    if (call.url === '/api/auth/challenge') return response({ challengeId: CONVERSATION_B, message: 'Scripted owner replacement' });
    if (call.url === '/api/auth/verify') { c.owner = B; return response({ wallet: B }); }
  } });
  b.h.get('message-text').value = 'OWNER_A_DRAFT'; const bridge = b.h.window.FlowwWorkspaceVoice, old = bridge.ensureConversation(bridge.snapshot().lease).catch(e => e); await until(() => creates === 1);
  b.h.window.phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: { toString: () => B } }), signMessage: async () => ({ signature: new Uint8Array(64) }) } };
  await b.h.get('connect-wallet').trigger('click'); await settle(); b.h.get('message-text').value = 'OWNER_B_DRAFT';
  const fresh = await bridge.ensureConversation(bridge.snapshot().lease); assert.equal(fresh.conversationId, CONVERSATION_B); pending.resolve(response(b.control.c)); await old; await settle();
  assert.equal(bridge.snapshot().conversationId, CONVERSATION_B); assert.equal(b.h.get('message-text').value, 'OWNER_B_DRAFT'); assert.doesNotMatch(b.h.get('voice-panel').textContent, /OWNER_A_DRAFT/); assert.equal(creates, 2);
});
for (const code of ['VOICE_NO_SPEECH', 'VOICE_DAILY_LIMIT', 'VOICE_INVALID_RESULT']) test(code + ' never retries upload or proceeds to the assistant automatically', async () => {
  const b = await voiceBoot({ transport(call) { if (call.url === '/api/voice/transcriptions') return response({ error: { code } }, code === 'VOICE_DAILY_LIMIT' ? 429 : 422); } }); await turnMode(b.h); await captureTurn(b);
  assert.equal(posts(b.h).filter(c => c.url === '/api/voice/transcriptions').length, 1); assert.equal(b.control.messageCalls, 0); assert.equal(b.m.spoken.length, 0); assert.ok(b.m.tracks.every(t => t.stopped));
});
test('missing actual TTS onstart is bounded and cannot leave a false speaking state', async () => {
  const b = await voiceBoot(); b.h.window.speechSynthesis.speak = utterance => b.m.spoken.push(utterance); await turnMode(b.h); await captureTurn(b);
  assert.equal(b.m.spoken.length, 1); b.h.runTimeout(15000); assert.ok(b.m.cancellations >= 1); assert.equal(b.h.get('voice-stop-speaking').hidden, true); assert.doesNotMatch(b.h.get('voice-status').textContent, /읽고 있습니다|Reading with/);
});
test('valid current local voice drives the live hint without rebuilding or refocusing voice selectors', async () => {
  const b = await voiceBoot(); await turnMode(b.h); await captureTurn(b); const select = b.h.get('voice-read-voice'); select.focus();
  assert.match(b.h.get('voice-read-hint').textContent, /기기에서 제공/); const calls = b.h.calls.length; b.h.window.FlowwLocale.setLanguage('en');
  assert.equal(b.h.get('voice-read-voice'), select); assert.equal(b.h.document.activeElement, select); assert.match(b.h.get('voice-read-hint').textContent, /on-device voice/); assert.equal(b.h.calls.length, calls);
});


async function linkedReport(b, changes = {}) {
  b.control.c.linkedTaskId = TASK_A; b.control.c.planLocked = true; b.control.c.messages = [{ id: 'planning-message', role: 'assistant', text: 'OLD_PLANNING_REPLY', at: '2026-11-07T03:00:00.000Z' }];
  const value = { ...task(TASK_A, 'CURRENT_LINKED_REPORT_TASK'), revision: 7, payment: 'CONFIRMED', delivery: 'COMPLETED', result: { answer: { answer_text: 'EXACT_STRUCTURED_REPORT', is_synthetic: true, complete: false } }, ...changes };
  const prior = b.control.transport;
  b.control.transport = (call, control) => call.url === '/api/tasks/' + TASK_A ? response(value) : prior?.(call, control);
  // Restore through the shipped owner-authorized router/GET path, not by
  // assuming the transport's server object is the client's parsed record.
  b.h.window.location.hash = '#/assistant/conversations/' + CONVERSATION_A; await settle();
  b.h.window.location.hash = '#/voice/conversations/' + CONVERSATION_A; await settle(); return value;
}
test('read-only linked report uses exact structured current Task and keeps consumer evidence notices without an extra request', async () => {
  const b = await voiceBoot({ hash: '#/voice/conversations/' + CONVERSATION_A }); await linkedReport(b); const calls = b.h.calls.length;
  assert.equal(b.h.get('voice-answer-text').textContent, 'EXACT_STRUCTURED_REPORT'); assert.doesNotMatch(b.h.get('voice-panel').textContent, /OLD_PLANNING_REPLY/);
  assert.equal(b.h.get('voice-report-notices').hidden, false); assert.equal(b.h.get('voice-report-synthetic').hidden, false); assert.match(b.h.get('voice-report-coverage').textContent, /일부/); assert.match(b.h.get('voice-report-notices').textContent, /잔액이나 수익/);
  assert.equal(b.h.get('voice-start').hidden, true); assert.equal(b.h.calls.length, calls); assert.equal(b.m.spoken.length, 0); assert.equal(financial(b.h).length, 0);
});
for (const change of [{ id: TASK_B }, { payment: 'UNKNOWN' }, { delivery: 'PENDING' }, { revision: undefined }, { result: { answer: 'unstructured' } }, { result: { answer: { answer_text: '   ' } } }]) test('a linked report with unsafe identity/state/shape is pending, never an older planning reply', async () => {
  const b = await voiceBoot({ hash: '#/voice/conversations/' + CONVERSATION_A }); await linkedReport(b, change);
  assert.equal(b.h.get('voice-answer').hidden, true); assert.equal(b.h.get('voice-answer-text').textContent, ''); assert.equal(b.h.get('voice-start').hidden, true); assert.match(b.h.get('voice-linked').textContent, /아직 읽을 수/); assert.equal(b.m.spoken.length, 0);
});
test('linked Task result revision or selected Task change stops stale local report playback; new availability never auto-speaks', async () => {
  const b = await voiceBoot({ hash: '#/voice/conversations/' + CONVERSATION_A }); const value = await linkedReport(b);
  b.h.get('voice-read-language').value = 'ko'; await b.h.get('voice-read-language').trigger('change'); await b.h.get('voice-speak').trigger('click'); await settle(); assert.equal(b.m.spoken.length, 1);
  b.h.emit('floww:selection', { wallet: A, task: { ...value, revision: 8, result: { answer: { answer_text: 'NEW_REPORT_REVISION', complete: true } } }, busy: false });
  assert.ok(b.m.cancellations >= 1); assert.equal(b.h.get('voice-answer-text').textContent, 'NEW_REPORT_REVISION'); assert.equal(b.m.spoken.length, 1); assert.equal(b.h.get('voice-stop-speaking').hidden, true);
  b.h.emit('floww:selection', { wallet: A, task: { ...value, id: TASK_B }, busy: false }); assert.equal(b.h.get('voice-answer-text').textContent, '');
});
test('logout removes linked report private text and locale cannot restore it', async () => {
  const b = await voiceBoot({ hash: '#/voice/conversations/' + CONVERSATION_A }); await linkedReport(b); await b.h.get('logout').trigger('click'); await settle(); b.h.window.FlowwLocale.setLanguage('en');
  assert.equal(b.h.get('voice-answer-text').textContent, ''); assert.doesNotMatch(b.h.get('voice-panel').textContent, /EXACT_STRUCTURED_REPORT/); assert.equal(b.m.spoken.length, 0);
});
test('opted-in full reply keeps the next explicit Start and fresh consent ahead of playback settings without auto capture', async () => {
  const b = await voiceBoot(); await turnMode(b.h); await captureTurn(b); const next = b.h.get('voice-next-turn');
  assert.equal(next.hidden, false); assert.equal(b.h.get('voice-capture-actions').parentNode, next); assert.equal(b.h.get('voice-start-scope').parentNode, next);
  assert.ok(next.parentNode.children.indexOf(next) < next.parentNode.children.indexOf(b.h.document.querySelector('.voice-read-controls')));
  assert.equal(b.h.get('voice-consent').checked, false); assert.equal(b.h.get('voice-start').disabled, true); assert.equal(b.m.microphoneCalls, 1);
  await startVoice(b.h); assert.equal(b.m.microphoneCalls, 2); await b.h.get('voice-cancel').trigger('click'); assert.equal(b.m.microphoneCalls, 2);
});
test('changing scoped context clears an unused next-turn acknowledgement and pinned mode', async () => {
  const b = await voiceBoot(); await turnMode(b.h); b.h.get('voice-consent').checked = true; await b.h.get('voice-consent').trigger('change'); b.h.get('conversation-memory').checked = true; await b.h.get('conversation-memory').trigger('change');
  assert.equal(b.h.get('voice-consent').checked, false); assert.equal(b.h.get('voice-mode').value, 'review'); assert.equal(b.m.microphoneCalls, 0);
});


for (const language of ['ko', 'en']) test(language + ' linked-report playback reads mandatory qualifications in the selected read language around exact answer text', async () => {
  const b = await voiceBoot({ hash: '#/voice/conversations/' + CONVERSATION_A, locale: language === 'ko' ? 'en' : 'ko' }); await linkedReport(b);
  const calls = b.h.calls.length; b.h.get('voice-read-language').value = language; await b.h.get('voice-read-language').trigger('change'); await b.h.get('voice-speak').trigger('click'); await settle();
  const utterance = b.m.spoken.at(-1); assert.ok(utterance); assert.ok(utterance.text.includes('EXACT_STRUCTURED_REPORT'));
  if (language === 'ko') { assert.match(utterance.text, /실제 네트워크/); assert.match(utterance.text, /일부만 확인/); assert.match(utterance.text, /잔액이나 수익/); }
  else { assert.match(utterance.text, /network/i); assert.match(utterance.text, /partial/i); assert.match(utterance.text, /balances or profit/i); }
  assert.equal(b.h.get('voice-answer-text').textContent, 'EXACT_STRUCTURED_REPORT'); assert.equal(b.h.calls.length, calls); assert.equal(utterance.voice.localService, true);
});


test('one-turn cancellation after message admission prevents an unstarted planner follow-up while preserving the accepted message', async () => {
  const pending = deferred(); let message; const b = await voiceBoot({ transport(call) { if (call.url.endsWith('/messages')) { message = call; return pending.promise; } } });
  await turnMode(b.h); await startVoice(b.h); b.m.feed(); await settle(); const stopping = b.h.get('voice-stop').trigger('click'); await until(() => Boolean(message));
  await b.h.get('voice-cancel').trigger('click'); b.control.c.revision++; b.control.c.status = 'READY_TO_PLAN'; b.control.c.plan = null; b.control.c.messages.push({ id: 'accepted-follow-up', role: 'assistant', text: 'Accepted reply without a new planner call', at: '2026-11-07T03:00:00.000Z' });
  pending.resolve(response(b.control.c)); await stopping; await settle(); assert.equal(b.h.calls.filter(c => c.url.endsWith('/plan')).length, 0); assert.equal(b.m.spoken.length, 0); assert.ok(b.control.c.messages.some(m => m.id === 'accepted-follow-up'));
});


test('explicit Stop transfers keyboard focus through the live Cancel control to the editable transcript', async () => {
  const b = await voiceBoot(); await captureTurn(b); assert.equal(b.h.document.activeElement, b.h.get('voice-transcript')); assert.equal(b.h.get('voice-transcript').disabled, false);
});


test('a cancelled old utterance late onstart is cancelled again without restoring text or changing the replacement owner', async () => {
  const b = await voiceBoot(); b.h.window.speechSynthesis.speak = utterance => b.m.spoken.push(utterance); await turnMode(b.h); await captureTurn(b);
  const old = b.m.spoken[0]; await b.h.get('voice-cancel').trigger('click');
  b.control.transport = (call, c) => { if (call.url === '/api/auth/challenge') return response({ challengeId: CONVERSATION_B, message: 'Scripted replacement owner' }); if (call.url === '/api/auth/verify') { c.owner = B; return response({ wallet: B }); } };
  b.h.window.phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: { toString: () => B } }), signMessage: async () => ({ signature: new Uint8Array(64) }) } };
  await b.h.get('connect-wallet').trigger('click'); await settle(); b.h.get('message-text').value = 'REPLACEMENT_OWNER_DRAFT'; const before = b.m.cancellations;
  old.onstart(); await settle(); assert.ok(b.m.cancellations > before); assert.equal(old.text, ''); assert.equal(old.volume, 0); assert.equal(b.h.get('connect-wallet').title, B); assert.equal(b.h.get('message-text').value, 'REPLACEMENT_OWNER_DRAFT'); assert.equal(b.h.get('voice-answer-text').textContent, ''); assert.doesNotMatch(b.h.get('voice-status').textContent, /읽고 있습니다|Reading with/);
});


test('fresh Voice ensure carries and saves the pre-busy draft without a false pending banner, including Back to base', async () => {
  const b = await voiceBoot(); b.h.get('message-text').value = 'ORIGINAL_UNSENT_LOCAL_DRAFT'; b.h.get('intent-wallet').value = B; b.h.get('conversation-memory').checked = true;
  await startVoice(b.h); assert.equal(b.control.creates, 1); assert.equal(b.h.get('shell-status').textContent, ''); assert.equal(b.h.get('message-text').value, 'ORIGINAL_UNSENT_LOCAL_DRAFT');
  b.h.window.history.back(); await settle(); assert.equal(b.h.window.location.hash, '#/voice'); assert.equal(b.h.get('shell-status').textContent, ''); assert.equal(b.h.get('message-text').value, 'ORIGINAL_UNSENT_LOCAL_DRAFT'); assert.equal(b.h.get('intent-wallet').value, B); assert.equal(b.h.get('conversation-memory').checked, true); assert.ok(b.m.tracks.every(t => t.stopped));
});
test('genuine uncertain ordinary message keeps its pending banner and exact retry identity across Voice navigation', async () => {
  const pending = deferred(), messages = []; const b = await voiceBoot({ hash: '#/voice/conversations/' + CONVERSATION_A, transport(call) { if (call.url.endsWith('/messages')) { messages.push(call); if (messages.length === 1) return pending.promise; } } });
  b.h.get('message-text').value = 'EXACT_PENDING_ORDINARY_REQUEST'; await b.h.get('message-form').trigger('submit'); await until(() => messages.length === 1);
  await b.h.nav('assistant'); b.h.window.history.back(); await settle(); assert.match(b.h.get('shell-status').textContent, /이전 요청|previous request/i); assert.equal(b.h.window.FlowwWorkspaceVoice.snapshot().pending, true);
  await assert.rejects(b.h.window.FlowwWorkspaceVoice.ensureConversation(b.h.window.FlowwWorkspaceVoice.snapshot().lease), error => error.code === 'CONVERSATION_BUSY');
  pending.resolve(response({ error: { code: 'WORKSPACE_MODEL_UNAVAILABLE' } }, 503)); await settle(); await b.h.get('message-form').trigger('submit'); await until(() => messages.length === 2); await settle();
  assert.deepEqual(messages[1].body, messages[0].body); assert.equal(b.control.creates, 0); assert.equal(b.control.transcriptions, 0); assert.equal(financial(b.h).length, 0);
});
