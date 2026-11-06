(() => {
  'use strict';
  const $ = id => document.getElementById(id), bridge = window.FlowwWorkspaceVoice, locale = window.FlowwLocale, copy = locale.copy, pcm = window.FlowwVoiceAudio;
  const state = { context: null, owner: null, generation: null, privateEpoch: 0, op: 0, capOp: 0, caps: null, capsPending: false, capController: null, ensurePending: false,
    compact: false, phase: 'idle', status: 'voice.ready', capture: null, upload: null, base: '', lease: null, language: null,
    captureId: null, originalEditor: '', replyId: null, layout: null, speech: null, speechToken: 0, readLanguage: '', turnPin: null, turnActive: false, turnSendStarted: false, speechStartTimer: null, speechEndTimer: null, drafts: new Map(), replyLanguages: new Map(), documentSuspended: false, restoring: false };
  const put = (node, value) => locale.text(node, value, () => state.privateEpoch);
  const active = () => state.context?.view === 'voice' || (state.context?.view === 'assistant' && state.compact);
  const capturing = () => ['ensuring', 'permission', 'listening', 'sealing', 'transcribing'].includes(state.phase);
  const busy = () => capturing() || state.phase === 'sending';
  const replyKey = reply => reply ? reply.conversationId + ':' + reply.id : null;
  const key = context => context?.conversationId ?? context?.requestedId ?? 'new';
  const errorKeys = { NotAllowedError: 'voice.denied', PermissionDeniedError: 'voice.denied', NotFoundError: 'voice.noDevice', NotReadableError: 'voice.noDevice',
    VOICE_NO_SPEECH: 'voice.empty', VOICE_DAILY_LIMIT: 'voice.limit', VOICE_CAPTURE_REPLAY: 'voice.failed', VOICE_CONTEXT_CHANGED: 'voice.contextChanged',
    WORKSPACE_CHANGED: 'voice.contextChanged', CONVERSATION_ALREADY_LINKED: 'voice.linked', VOICE_DRAFT_CHANGED: 'voice.draftChanged',
    VOICE_CONSENT_REQUIRED: 'voice.consentNeeded', INVALID_WORKSPACE_TEXT: 'voice.tooLong', VOICE_UNSUPPORTED: 'voice.unsupported',
    VOICE_DISABLED: 'voice.unavailable', VOICE_NOT_CONFIGURED: 'voice.unavailable', AUTHENTICATION_REQUIRED: 'voice.guest' };
  const current = token => !state.documentSuspended && token === state.op && active();
  function phase(name, message) { state.phase = name; if (message) state.status = message; render(); }
  function stopTracks(stream) { for (const track of stream?.getTracks?.() ?? []) { try { track.stop(); } catch { /* release all owned tracks */ } } }
  function stopSpeech() {
    clearTimeout(state.speechStartTimer); clearTimeout(state.speechEndTimer); state.speechToken++; const utterance = state.speech; state.speech = null;
    if (utterance) {
      // A host may deliver a queued onstart after cancel. Redact the owned
      // object as well as cancelling the native queue; never reuse it.
      try { utterance.volume = 0; utterance.text = ''; } catch { /* native object already ended */ }
      try { window.speechSynthesis?.cancel(); } catch { /* no replay */ }
    }
    if (state.phase === 'speaking' || state.phase === 'startingSpeech') { state.phase = 'idle'; state.status = 'voice.readStopped'; }
  }
  function releaseCapture({ erase = true } = {}) {
    const capture = state.capture; state.capture = null; if (!capture) return;
    clearTimeout(capture.wallTimer); clearTimeout(capture.sealTimer); stopTracks(capture.stream);
    try { capture.node?.port.postMessage({ type: 'stop' }); } catch { /* disconnected */ }
    try { if (capture.node) { capture.node.port.onmessage = null; capture.node.port.close?.(); capture.node.disconnect(); } } catch { /* disconnected */ }
    try { capture.source?.disconnect(); } catch { /* disconnected */ }
    try { Promise.resolve(capture.context?.close()).catch(() => {}); } catch { /* already closed */ }
    capture.rejectSeal?.({ stale: true });
    if (erase) for (const chunk of capture.chunks ?? []) chunk.fill(0);
  }
  function interrupt(message = 'voice.interrupted', { cancel = false } = {}) {
    const wasActive = capturing() || Boolean(state.speech) || state.phase === 'sending';
    const issuedTurn = state.turnSendStarted;
    state.turnActive = false; state.turnPin = null; $('voice-mode').value = 'review'; $('voice-turn-language').value = ''; $('voice-turn-voice').replaceChildren();
    state.ensurePending = false; state.op++; state.upload?.abort(); state.upload = null; releaseCapture(); stopSpeech();
    if (cancel && capturing()) $('voice-transcript').value = state.originalEditor;
    state.phase = 'idle'; if (wasActive || cancel) state.status = issuedTurn ? 'voice.turnStopped' : message; $('voice-consent').checked = false;
    $('voice-level').value = 0; render();
  }
  function remember(context = state.context) {
    if (!context) return;
    state.drafts.set(key(context), { text: $('voice-transcript').value, base: state.base, lease: state.lease, language: state.language });
  }
  function restore(context) {
    const value = state.drafts.get(key(context)); $('voice-transcript').value = value?.text ?? '';
    state.base = value?.base ?? context.draft; state.lease = value?.requiresReview && value.text ? Object.freeze({}) : value?.lease ?? context.lease; state.language = value?.language ?? null;
  }
  function clearPrivateVoice() {
    state.privateEpoch++; state.base = ''; state.originalEditor = ''; state.lease = null; state.language = null; state.captureId = null; state.replyId = null;
    $('voice-transcript').value = ''; setReadLanguage('');
    $('voice-continue').href = '#/assistant';
    for (const id of ['voice-original-text', 'voice-preview', 'voice-answer-text', 'voice-context']) put($(id), '');
  }
  function suspendVoice() {
    if (state.documentSuspended) return;
    remember();
    // Retain editable text only, never reusable capture/permission/operation leases.
    for (const [id, value] of state.drafts) state.drafts.set(id, { text: value.text, base: value.base, language: value.language, requiresReview: true });
    state.documentSuspended = true; interrupt('voice.interrupted'); state.capOp++; state.capController?.abort(); state.capController = null; state.capsPending = false; state.caps = null;
    state.replyLanguages.clear(); clearPrivateVoice(); render();
  }
  function capabilityShape(value) {
    return value && typeof value.enabled === 'boolean' && typeof value.configured === 'boolean' && value.provider === 'openai' && value.model === 'gpt-transcribe' && value.processing === 'remote' &&
      Array.isArray(value.languages) && value.languages.length === 2 && value.languages[0] === 'ko' && value.languages[1] === 'en' && value.contentType === 'audio/wav' &&
      value.sampleRate === 16000 && value.channels === 1 && value.bitsPerSample === 16 && value.maxDurationMs === 60000 && value.maxBytes === pcm.MAX_BYTES;
  }
  async function capabilities() {
    if (state.documentSuspended || !active() || !state.context?.authenticated || !state.context.authReady || state.capsPending) return;
    const token = ++state.capOp, owner = state.context.owner, generation = state.context.generation, route = state.context.routeVersion;
    state.capsPending = true; render(); const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    state.capController = controller;
    const valid = () => token === state.capOp && active() && state.context?.owner === owner && state.context?.generation === generation && state.context?.routeVersion === route;
    try {
      const response = await fetch('/api/voice/capabilities', { method: 'GET', credentials: 'same-origin', redirect: 'error', headers: { Accept: 'application/json' }, signal: controller.signal });
      const text = await response.text(); if (!valid()) return;
      if (response.status === 401) { window.dispatchEvent(new CustomEvent('floww:session-expired', { detail: { wallet: owner } })); return; }
      if (!response.ok || text.length > 4000) throw Error('UNAVAILABLE');
      const value = JSON.parse(text); if (!capabilityShape(value)) throw Error('UNAVAILABLE');
      state.caps = Object.freeze({ enabled: value.enabled, configured: value.configured });
    } catch { if (valid()) state.caps = { enabled: false, configured: false }; }
    finally { clearTimeout(timer); if (state.capController === controller) state.capController = null; if (valid()) { state.capsPending = false; render(); } }
  }
  function supported() { return window.isSecureContext === true && typeof window.navigator?.mediaDevices?.getUserMedia === 'function' && typeof window.AudioContext === 'function' && typeof window.AudioWorkletNode === 'function'; }
  function available() { return state.caps?.enabled === true && state.caps?.configured === true; }
  function responseError(error) { const key = error?.code ?? error?.name; return Object.hasOwn(errorKeys, key) ? errorKeys[key] : 'voice.failed'; }
  async function start() {
    const context = bridge.snapshot(); state.context = context; if (!active() || busy() || !context.writable || !available()) return;
    if (!$('voice-consent').checked) { state.status = 'voice.consentNeeded'; render(); return; }
    if (!supported()) { state.status = 'voice.unsupported'; render(); return; }
    const turnMode = state.context.view === 'voice' && $('voice-mode').value === 'turn';
    const requestedLanguage = $('voice-turn-language').value, requestedVoice = voices(requestedLanguage).find(v => v.voiceURI === $('voice-turn-voice').value);
    if (turnMode && context.modelBlock) { state.status = 'voice.turnAssistantUnavailable'; render(); return; }
    if (turnMode && (context.draft || $('voice-transcript').value.trim())) { state.status = 'voice.turnDraftBlocked'; render(); return; }
    if (turnMode && (!['ko', 'en'].includes(requestedLanguage) || !requestedVoice)) { state.status = 'voice.turnVoiceRequired'; render(); return; }
    stopSpeech(); const token = ++state.op, captureLanguage = turnMode ? requestedLanguage : locale.language, captureId = crypto.randomUUID();
    const pin = Object.freeze({ mode: turnMode ? 'turn' : 'review', language: captureLanguage, voiceURI: requestedVoice?.voiceURI ?? null, voiceName: requestedVoice?.name ?? null });
    state.turnPin = pin; state.turnActive = turnMode; state.turnSendStarted = false; state.originalEditor = $('voice-transcript').value; state.language = captureLanguage; state.captureId = captureId;
    state.lease = context.lease; state.base = context.draft; state.ensurePending = true; state.phase = 'ensuring'; state.status = 'voice.ensuring'; render();
    let streamPromise;
    try {
      // Both device APIs originate in this explicit gesture. No track is
      // connected to a processor until the owned conversation is bound.
      const audioContext = new window.AudioContext({ sampleRate: 16000 });
      const capture = { context: audioContext, chunks: [], frames: 0, sampleRate: audioContext.sampleRate, language: captureLanguage, captureId, pin }; state.capture = capture;
      if (!Number.isSafeInteger(capture.sampleRate) || capture.sampleRate < 8000 || capture.sampleRate > 96000) throw { code: 'VOICE_UNSUPPORTED' };
      const resumed = Promise.resolve(audioContext.resume());
      streamPromise = window.navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true }, video: false })
        .then(stream => { if (!current(token)) { stopTracks(stream); throw { stale: true }; } capture.stream = stream; return stream; });
      // A prompt may outlive every other step. Its late grant always has a
      // stop handler, even when ensure/resume fails first.
      streamPromise.catch(() => {}); resumed.catch(() => {});
      phase('permission', 'voice.permission');
      const ensured = await bridge.ensureConversation(context.lease, () => current(token));
      if (!current(token)) throw { stale: true };
      state.ensurePending = false; state.context = ensured; state.lease = ensured.lease; state.base = ensured.draft;
      await Promise.all([streamPromise, resumed]); if (!current(token) || !bridge.valid(state.lease)) throw { stale: true };
      if (!audioContext.audioWorklet?.addModule) throw { code: 'VOICE_UNSUPPORTED' };
      await audioContext.audioWorklet.addModule('/voice-worklet.js'); if (!current(token) || !bridge.valid(state.lease)) throw { stale: true };
      capture.node = new window.AudioWorkletNode(audioContext, 'floww-voice-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
      capture.node.port.onmessage = event => {
        const message = event.data;
        if (!current(token) || state.capture !== capture) return;
        if (message?.type === 'samples') {
          if (!(message.samples instanceof Float32Array) || !message.samples.length || !Number.isSafeInteger(message.frames) || message.frames !== capture.frames + message.samples.length || message.frames > capture.sampleRate * 60 || !Number.isFinite(message.rms) || message.rms < 0 || message.rms > 1) {
            interrupt('voice.failed'); return;
          }
          capture.chunks.push(message.samples); capture.frames = message.frames;
          $('voice-level').value = message.rms; $('voice-duration').textContent = (capture.frames / capture.sampleRate).toFixed(1) + ' s / 60 s';
        } else if (message?.type === 'sealed') {
          if (message.frames !== capture.frames) { interrupt('voice.failed'); return; }
          capture.sealed = true;
          if (capture.resolveSeal) capture.resolveSeal(); else if (state.phase === 'listening') stop();
        }
      };
      for (const track of capture.stream.getAudioTracks?.() ?? capture.stream.getTracks()) track.addEventListener?.('ended', () => { if (current(token) && state.phase === 'listening') interrupt('voice.noDevice'); }, { once: true });
      capture.source = audioContext.createMediaStreamSource(capture.stream); capture.source.connect(capture.node); capture.node.connect(audioContext.destination);
      capture.wallTimer = setTimeout(() => { if (current(token) && state.phase === 'listening') stop(); }, 60_000);
      $('voice-consent').checked = false; phase('listening', 'voice.listening'); $('voice-stop').focus();
    } catch (error) {
      if (current(token)) { state.ensurePending = false; state.turnActive = false; state.op++; releaseCapture(); state.phase = 'idle'; state.status = error.stale ? 'voice.interrupted' : responseError(error); $('voice-consent').checked = false; render(); }
    }
  }
  async function canonical(capture) {
    const samples = pcm.merge(capture.chunks, capture.sampleRate);
    if (capture.sampleRate === 16000) return pcm.encodeWav({ samples, sampleRate: capture.sampleRate });
    const Offline = window.OfflineAudioContext; if (typeof Offline !== 'function') throw { code: 'VOICE_UNSUPPORTED' };
    const length = Math.min(pcm.MAX_FRAMES, Math.floor(samples.length * 16000 / capture.sampleRate)); if (!length) throw { code: 'VOICE_NO_SPEECH' };
    const offline = new Offline(1, length, 16000), buffer = offline.createBuffer(1, samples.length, capture.sampleRate);
    buffer.copyToChannel(samples, 0); const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start(0);
    const rendered = await offline.startRendering();
    if (rendered.sampleRate !== 16000 || rendered.numberOfChannels !== 1 || rendered.length !== length) throw { code: 'INVALID_VOICE_AUDIO' };
    return pcm.encodeWav({ samples: rendered.getChannelData(0), sampleRate: rendered.sampleRate });
  }
  async function stop() {
    if (state.phase !== 'listening' || !state.capture) return;
    const token = state.op, capture = state.capture;
    const focusWasRecordingControl = ['voice-stop', 'voice-start', 'voice-cancel'].includes(document.activeElement?.id);
    phase('sealing', 'voice.transcribing'); if (focusWasRecordingControl) $('voice-cancel').focus(); stopTracks(capture.stream);
    try {
      if (!capture.sealed) await new Promise((resolve, reject) => { capture.resolveSeal = resolve; capture.rejectSeal = reject;
        capture.sealTimer = setTimeout(() => reject({ code: 'VOICE_UNSUPPORTED' }), 2000); capture.node.port.postMessage({ type: 'stop' }); });
      if (!current(token) || !bridge.valid(state.lease)) throw { stale: true };
      const encoded = await canonical(capture); if (!current(token) || !bridge.valid(state.lease)) { encoded.bytes.fill(0); throw { stale: true }; }
      releaseCapture(); if (!current(token)) { encoded.bytes.fill(0); return; }
      phase('transcribing', 'voice.transcribing');
      const context = state.context, controller = new AbortController(); state.upload = controller;
      const timer = setTimeout(() => controller.abort(), 45_000);
      try {
        const response = await fetch('/api/voice/transcriptions', { method: 'POST', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'audio/wav', Accept: 'application/json', 'X-Floww-Conversation-Id': context.conversationId,
            'X-Floww-Expected-Revision': String(context.revision), 'X-Floww-Language': capture.language, 'X-Floww-Capture-Id': capture.captureId, 'X-Floww-Voice-Consent': 'true' }, body: encoded.bytes });
        const text = await response.text(); if (!current(token) || !bridge.valid(state.lease)) throw { stale: true };
        if (response.status === 401) { window.dispatchEvent(new CustomEvent('floww:session-expired', { detail: { wallet: state.context.owner } })); throw { stale: true }; }
        let value; try { value = text.length <= 20_000 ? JSON.parse(text) : null; } catch { throw { code: 'VOICE_INVALID_RESULT' }; }
        if (!response.ok) throw { code: value?.error?.code };
        if (value?.version !== 'voice-transcript/v1' || value.captureId !== capture.captureId || value.conversationId !== context.conversationId || value.revision !== context.revision || value.languageHint !== capture.language ||
            !Number.isFinite(value.durationMs) || value.durationMs <= 0 || value.durationMs > 60_000 || Math.abs(value.durationMs - encoded.durationMs) > 1 || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 2000) throw { code: 'VOICE_INVALID_RESULT' };
        state.language = capture.language; $('voice-transcript').value = value.text; state.status = 'voice.review'; state.phase = 'idle'; remember(); render();
        encoded.bytes.fill(0);
        if (capture.pin.mode === 'turn') { await finishTurn(token, capture.pin, value.text); return; }
        if (['voice-stop', 'voice-cancel', 'voice-start'].includes(document.activeElement?.id)) $('voice-transcript').focus();
      } finally { clearTimeout(timer); encoded.bytes.fill(0); if (state.upload === controller) state.upload = null; }
    } catch (error) { if (current(token)) { releaseCapture(); state.turnActive = false; state.phase = 'idle'; state.status = error.stale ? 'voice.contextChanged' : responseError(error); render(); } }
  }
  async function finishTurn(token, pin, text) {
    if (!current(token) || !bridge.valid(state.lease, true)) { state.turnActive = false; state.status = 'voice.draftChanged'; render(); return; }
    state.turnSendStarted = true; phase('sending', 'voice.turnSending');
    const result = await bridge.send(state.lease, text, () => current(token));
    if (!current(token)) return;
    state.phase = 'idle';
    if (!result?.ok) { state.turnActive = false; state.status = result?.stale ? 'voice.contextChanged' : responseError(result); render(); return; }
    state.context = result.snapshot; state.lease = result.snapshot.lease; state.base = ''; $('voice-transcript').value = ''; remember();
    if (!result.accepted || !result.reply || result.reply.id !== bridge.readActualAssistant()?.id) { state.turnActive = false; state.status = 'voice.noNewReply'; render(); return; }
    state.replyLanguages.set(replyKey(result.reply), pin.language); setReadLanguage(pin.language); $('voice-read-voice').value = pin.voiceURI;
    if (!playReply(result.reply, pin.language, pin.voiceURI, token)) { state.turnActive = false; state.status = 'voice.noLocalVoice'; render(); }
  }
  function draftConflict() { return state.lease && !bridge.valid(state.lease, true); }
  function rebase() { if (busy()) return; const context = bridge.snapshot(); if (!context.writable) return; state.context = context; state.lease = context.lease; state.base = context.draft; state.status = 'voice.review'; render(); }
  async function use(send) {
    const text = $('voice-transcript').value; if (!text.trim() || busy()) return;
    const token = ++state.op, language = state.language; state.phase = send ? 'sending' : 'idle'; state.status = send ? 'voice.sending' : 'voice.review'; render();
    const result = send ? await bridge.send(state.lease, text) : bridge.applyTranscript(state.lease, text);
    if (!current(token)) return;
    state.phase = 'idle';
    if (!result?.ok) { state.status = result?.stale ? 'voice.contextChanged' : responseError(result); render(); return; }
    $('voice-transcript').value = ''; state.originalEditor = ''; state.base = ''; state.lease = result.snapshot.lease; state.context = result.snapshot; remember();
    if (send) { state.status = !result.accepted ? 'voice.notSent' : result.reply ? 'voice.sent' : 'voice.noNewReply'; if (result.reply && language) { state.replyLanguages.set(replyKey(result.reply), language); setReadLanguage(language, true); } }
    else { state.compact = false; state.status = 'voice.review'; await bridge.continueChat(); bridge.focusComposer(); }
    render();
  }
  function voices(language) { try { return (window.speechSynthesis?.getVoices() ?? []).filter(v => v.localService === true && typeof v.lang === 'string' && v.lang.toLowerCase().split('-')[0] === language && typeof v.voiceURI === 'string'); } catch { return []; } }
  function fillVoices({ choose = false } = {}) {
    const selector = $('voice-read-voice'), previous = selector.value, availableVoices = voices(state.readLanguage);
    selector.replaceChildren(); const blank = new Option('', ''); put(blank, copy('voice.noLocalVoice')); selector.append(blank);
    for (const v of availableVoices) selector.append(new Option(v.name + ' · ' + v.lang, v.voiceURI));
    if (availableVoices.some(v => v.voiceURI === previous)) selector.value = previous;
    else if (choose) { const preferred = availableVoices.find(v => /유나|Yuna|Samantha|Daniel/i.test(v.name)); selector.value = (preferred ?? availableVoices[0])?.voiceURI ?? ''; }
    else selector.value = '';
    put($('voice-read-hint'), copy(availableVoices.length && selector.value ? 'voice.localVoice' : 'voice.noLocalVoice'));
  }
  function setReadLanguage(language, choose = false) { state.readLanguage = ['ko', 'en'].includes(language) ? language : ''; $('voice-read-language').value = state.readLanguage; fillVoices({ choose }); }
  function speak() { return playReply(bridge.readActualAssistant(), state.readLanguage, $('voice-read-voice').value); }
  function playReply(reply, language, selected, turnToken = null) {
    const voice = voices(language).find(v => v.voiceURI === selected);
    if (state.documentSuspended || !active() || busy() || (turnToken !== null && !current(turnToken)) || !reply || reply.id !== state.context?.reply?.id || !voice || !['ko', 'en'].includes(language) || typeof window.SpeechSynthesisUtterance !== 'function') return;
    stopSpeech(); const token = ++state.speechToken, identity = state.context.identity;
    const spoken = reply.kind === 'report' ? [
      reply.synthetic ? locale.copyInLanguage(language, '이 결과는 실제 네트워크에서 조회한 자료가 아닙니다.') : '',
      locale.copyInLanguage(language, reply.complete ? '명시된 자료 범위 안에서 집계했습니다.' : '조회 자료의 일부만 확인됐습니다. 반환된 이체를 기준으로 집계합니다.'),
      reply.text, locale.copyInLanguage(language, 'voice.transferCaution')
    ].filter(Boolean).join('\n') : reply.text;
    const utterance = new window.SpeechSynthesisUtterance(spoken); utterance.voice = voice; utterance.lang = voice.lang;
    state.speech = utterance; state.phase = 'startingSpeech'; state.status = 'voice.readStarting'; render();
    const valid = () => token === state.speechToken && active() && state.context?.identity === identity && bridge.readActualAssistant()?.id === reply.id && state.readLanguage === language && (turnToken === null || current(turnToken)) && voices(language).some(v => v.voiceURI === selected);
    utterance.onstart = () => { if (valid()) { clearTimeout(state.speechStartTimer); phase('speaking', 'voice.speaking'); } else {
      try { utterance.volume = 0; utterance.text = ''; } catch { /* native host may reject late mutation */ }
      try { window.speechSynthesis?.cancel(); } catch { /* stale media, no state publication */ }
    } };
    utterance.onend = () => { if (valid()) { state.speech = null; state.turnActive = false; clearTimeout(state.speechEndTimer); phase('idle', 'voice.readFinished'); } };
    utterance.onerror = () => { if (valid()) { state.speech = null; state.turnActive = false; clearTimeout(state.speechStartTimer); clearTimeout(state.speechEndTimer); phase('idle', 'voice.speechFailed'); } };
    state.speechStartTimer = setTimeout(() => { if (valid() && state.phase === 'startingSpeech') { stopSpeech(); state.turnActive = false; phase('idle', 'voice.speechFailed'); } }, 15000);
    state.speechEndTimer = setTimeout(() => { if (valid()) { stopSpeech(); state.turnActive = false; phase('idle', 'voice.speechFailed'); } }, 240000);
    try { window.speechSynthesis.speak(utterance); } catch { if (valid()) { state.speech = null; state.turnActive = false; clearTimeout(state.speechStartTimer); clearTimeout(state.speechEndTimer); phase('idle', 'voice.speechFailed'); } }
    return true;
  }
  function render() {
    if (state.documentSuspended) { $('voice-panel').hidden = true; return; }
    const context = state.context, open = active(), full = context?.view === 'voice', panel = $('voice-panel');
    const target = full ? $('voice-surface') : $('voice-chat-slot'); if (panel.parentNode !== target) target.append(panel);
    panel.hidden = !open; $('voice-close').hidden = full; $('voice-continue').href = context?.conversationId ? '#/assistant/conversations/' + context.conversationId : '#/assistant';
    put($('voice-context'), context?.title || copy('voice.newContext'));
    put($('voice-heading'), copy(state.phase === 'listening' ? 'voice.listeningTitle' : ['sealing', 'transcribing'].includes(state.phase) ? 'voice.transcribingTitle' : $('voice-transcript').value ? 'voice.reviewTitle' : context?.reply ? 'voice.answer' : 'voice.readyTitle')); put($('voice-status'), copy(state.status));
    const configured = available(), hardware = supported();
    $('voice-status').hidden = state.status === 'voice.ready';
    $('voice-availability').hidden = Boolean(context?.authenticated && configured && hardware && !state.capsPending);
    put($('voice-availability'), copy(!context?.authenticated ? 'voice.guest' : state.capsPending ? 'voice.checking' : !configured ? 'voice.unavailable' : !hardware ? 'voice.unsupported' : 'voice.configured'));
    const mode = full && $('voice-mode').value === 'turn', turnLanguage = $('voice-turn-language').value, turnVoice = voices(turnLanguage).find(v => v.voiceURI === $('voice-turn-voice').value);
    $('voice-mode-options').hidden = !full || busy() || Boolean(context?.linkedTaskId); $('voice-mode').disabled = busy();
    $('voice-mode').querySelector('option[value=turn]').disabled = Boolean(context?.draft || $('voice-transcript').value.trim());
    $('voice-turn-settings').hidden = !mode; $('voice-turn-block').hidden = !context?.draft && !$('voice-transcript').value.trim() && !(mode && context?.modelBlock);
    put($('voice-turn-block'), copy(mode && context?.modelBlock ? 'voice.turnAssistantUnavailable' : 'voice.turnDraftBlocked'));
    put($('voice-mode-summary'), copy(mode && turnVoice ? 'voice.turnModeSummary' : mode ? 'voice.turnMode' : 'voice.reviewMode', { voice: turnVoice?.name ?? '', language: copy(turnLanguage === 'ko' ? 'voice.korean' : 'voice.english') }));
    $('voice-turn-summary').hidden = !mode;
    put($('voice-turn-summary'), copy(turnVoice ? 'voice.turnDisclosure' : 'voice.turnVoiceRequired', { voice: turnVoice?.name ?? '', language: copy(turnLanguage === 'ko' ? 'voice.korean' : 'voice.english') }));
    put($('voice-consent-text'), copy(mode ? 'voice.turnConsent' : 'voice.consent'));
    put($('voice-start'), copy(mode ? 'voice.turnStart' : 'voice.start'));
    $('voice-start-scope').hidden = busy() || Boolean(context?.linkedTaskId);
    $('voice-start').hidden = busy() || Boolean(context?.linkedTaskId); $('voice-start').disabled = !context?.writable || !configured || !hardware || !$('voice-consent').checked || (mode && (Boolean(context?.draft || $('voice-transcript').value.trim()) || !turnVoice || Boolean(context?.modelBlock)));
    $('voice-stop').hidden = state.phase !== 'listening'; $('voice-stop').disabled = state.phase !== 'listening';
    $('voice-cancel').hidden = (state.phase === 'sending' && !state.turnActive) || (!busy() && !$('voice-transcript').value && !state.turnActive && !state.speech);
    $('voice-login').hidden = Boolean(context?.authenticated); $('voice-login').disabled = !context?.authReady;
    $('voice-recording').hidden = state.phase !== 'listening'; $('voice-consent').disabled = busy() || !context?.writable;
    const transcript = $('voice-transcript').value, combined = state.base ? state.base + '\n' + transcript : transcript;
    const conflict = Boolean(transcript && draftConflict());
    $('voice-review').hidden = !transcript || busy(); $('voice-transcript').disabled = busy(); $('voice-original').hidden = !state.base;
    $('voice-preview-label').hidden = !state.base; $('voice-preview').hidden = !state.base;
    put($('voice-original-text'), state.base); put($('voice-preview'), combined); put($('voice-length'), copy('voice.length', { count: combined.length }));
    $('voice-conflict').hidden = !conflict && combined.length <= 2000; put($('voice-conflict'), copy(conflict ? 'voice.draftChanged' : 'voice.tooLong'));
    $('voice-rebase').hidden = !conflict; $('voice-rebase').disabled = busy() || !context?.writable;
    $('voice-use').disabled = busy() || conflict || combined.length > 2000 || !transcript.trim() || !context?.writable;
    $('voice-send').disabled = $('voice-use').disabled || Boolean(context?.modelBlock);
    put($('voice-send'), copy(state.base ? 'voice.appendSend' : 'voice.send')); put($('voice-use'), copy(state.base ? 'voice.appendUse' : 'voice.use'));
    const reply = context?.reply; $('voice-answer').hidden = !reply || busy();
    put($('voice-answer-text'), reply?.text ?? '');
    $('voice-report-notices').hidden = reply?.kind !== 'report'; $('voice-report-synthetic').hidden = reply?.synthetic !== true;
    put($('voice-report-coverage'), copy(reply?.complete ? '명시된 자료 범위 안에서 집계했습니다.' : '조회 자료의 일부만 확인됐습니다. 반환된 이체를 기준으로 집계합니다.'));
    put($('voice-linked'), copy(context?.linkedTaskId && !reply ? 'voice.reportPending' : 'voice.linked'));
    if (replyKey(reply) !== state.replyId) { state.replyId = replyKey(reply); setReadLanguage(state.replyLanguages.get(state.replyId) ?? ''); }
    const validReadVoice = voices(state.readLanguage).some(v => v.voiceURI === $('voice-read-voice').value);
    put($('voice-read-hint'), copy(validReadVoice ? 'voice.localVoice' : 'voice.noLocalVoice'));
    $('voice-speak').disabled = busy() || !reply || !validReadVoice;
    $('voice-stop-speaking').hidden = !state.speech; $('voice-read-language').disabled = busy(); $('voice-read-voice').disabled = busy();
    const layout = busy() ? 'capture' : transcript ? 'review' : reply ? 'answer' : 'capture';
    panel.dataset.mode = layout;
    if (state.layout !== layout) {
      const focused = panel.contains(document.activeElement) ? document.activeElement : null;
      const primary = layout === 'review' ? $('voice-review') : layout === 'answer' ? $('voice-answer') : null;
      for (const node of [$('voice-review'), $('voice-answer')]) { if (node === primary) $('voice-current-slot').append(node); else panel.insertBefore(node, $('voice-linked')); }
      const recording = $('voice-new-capture'); recording.open = layout === 'capture'; recording.querySelector('summary').hidden = layout === 'capture';
      const cancelTarget = layout === 'review' ? $('voice-review-actions') : layout === 'answer' ? $('voice-answer-actions') : $('voice-capture-actions'); cancelTarget.append($('voice-cancel'));
      state.layout = layout; focused?.focus({ preventScroll: true });
    }
    const inlineNext = full && layout === 'answer' && state.turnPin?.mode === 'turn' && $('voice-mode').value === 'turn' && !context?.linkedTaskId;
    $('voice-next-turn').hidden = !inlineNext;
    for (const node of [$('voice-start-scope'), $('voice-capture-actions')]) {
      const home = inlineNext ? $('voice-next-turn') : $('voice-new-capture');
      if (node.parentNode !== home) { const focused = node.contains(document.activeElement) ? document.activeElement : null;
        if (inlineNext) home.append(node); else home.insertBefore(node, document.querySelector('.voice-privacy')); focused?.focus({ preventScroll: true }); }
    }
    $('voice-linked').hidden = !context?.linkedTaskId;
  }
  bridge.subscribe(context => {
    if (context.documentSuspended) { suspendVoice(); state.context = context; return; }
    if (state.documentSuspended) return;
    const old = state.context, ownerChanged = state.owner !== context.owner, renewed = state.generation !== context.generation;
    if (ownerChanged || renewed) {
      if (!state.restoring) remember(old); interrupt('voice.interrupted'); state.capOp++; state.capController?.abort(); state.capController = null; state.capsPending = false; state.caps = null;
      if (ownerChanged && state.owner) { state.privateEpoch++; state.drafts.clear(); state.replyLanguages.clear(); state.replyId = null; setReadLanguage(''); $('voice-transcript').value = ''; state.base = ''; state.lease = null; }
      state.owner = context.owner; state.generation = context.generation;
    }
    const routeChanged = old && (old.routeVersion !== context.routeVersion || old.view !== context.view);
    const identityChanged = old && old.identity !== context.identity;
    if (routeChanged) { state.capOp++; state.capController?.abort(); state.capController = null; state.capsPending = false; }
    if (routeChanged || (identityChanged && capturing() && !state.ensurePending)) interrupt('voice.interrupted');
    if ((identityChanged || old?.reply?.id !== context.reply?.id || old?.reply?.text !== context.reply?.text) && state.speech) stopSpeech();
    if (!state.restoring && old && key(old) !== key(context)) {
      const ownBinding = state.ensurePending && !old.conversationId && Boolean(context.conversationId) && old.owner === context.owner && old.generation === context.generation && old.routeVersion === context.routeVersion;
      if (!ownBinding) { remember(old); state.context = context; restore(context); stopSpeech(); state.status = $('voice-transcript').value ? 'voice.review' : 'voice.ready'; }
    }
    state.context = context;
    if (state.restoring && context.authReady && (!context.requestedId || context.conversationId === context.requestedId) && !context.busy) {
      restore(context);
      // A restored transcript is reviewable but must be explicitly rebound to
      // the newly read scope before it can enter the authoritative composer.
      if ($('voice-transcript').value) state.lease = Object.freeze({});
      state.restoring = false; state.status = $('voice-transcript').value ? 'voice.review' : 'voice.ready';
    }
    if (!state.lease && !busy()) { state.lease = context.lease; state.base = context.draft; }
    if (!active()) { state.capOp++; state.capController?.abort(); state.capController = null; state.capsPending = false; stopSpeech(); }
    render(); if (active() && context.authenticated && context.authReady && state.caps === null && !state.capsPending) capabilities();
  });
  function focusVoiceHeading() { $('voice-heading').setAttribute('tabindex', '-1'); $('voice-heading').focus(); }
  $('voice-launch').addEventListener('click', () => { state.compact = true; state.context = bridge.snapshot(); if (!$('voice-transcript').value) { state.lease = state.context.lease; state.base = state.context.draft; } render(); capabilities(); $('voice-heading').setAttribute('tabindex', '-1'); $('voice-heading').focus(); });
  $('voice-close').addEventListener('click', () => { interrupt('voice.cancelled', { cancel: true }); remember(); state.compact = false; render(); $('voice-launch').focus(); });
  $('voice-start').addEventListener('click', start); $('voice-stop').addEventListener('click', stop);
  $('voice-cancel').addEventListener('click', () => { interrupt('voice.cancelled', { cancel: true }); focusVoiceHeading(); });
  $('voice-consent').addEventListener('change', render); $('voice-transcript').addEventListener('input', () => { remember(); render(); });
  $('voice-rebase').addEventListener('click', rebase); $('voice-use').addEventListener('click', () => use(false)); $('voice-send').addEventListener('click', () => use(true));
  $('voice-login').addEventListener('click', () => $('connect-wallet').click());
  function fillTurnVoices() {
    const language = $('voice-turn-language').value, list = voices(language), select = $('voice-turn-voice'); select.replaceChildren(new Option('', ''));
    for (const voice of list) select.append(new Option(voice.name + ' · ' + voice.lang, voice.voiceURI));
    select.value = (list.find(v => /유나|Yuna|Samantha|Daniel/i.test(v.name)) ?? list[0])?.voiceURI ?? '';
  }
  $('voice-mode').value = 'review';
  $('voice-mode').addEventListener('change', () => { $('voice-consent').checked = false; if ($('voice-mode').value === 'turn') { $('voice-turn-language').value = locale.language; fillTurnVoices(); } render(); });
  $('voice-turn-language').addEventListener('change', () => { $('voice-consent').checked = false; fillTurnVoices(); render(); });
  $('voice-turn-voice').addEventListener('change', () => { $('voice-consent').checked = false; render(); });
  $('voice-read-language').addEventListener('change', () => { stopSpeech(); setReadLanguage($('voice-read-language').value, true); render(); });
  $('voice-read-voice').addEventListener('change', () => { stopSpeech(); render(); });
  $('voice-speak').addEventListener('click', speak); $('voice-stop-speaking').addEventListener('click', () => { state.turnActive = false; stopSpeech(); render(); });
  window.speechSynthesis?.addEventListener?.('voiceschanged', () => { stopSpeech(); fillVoices(); render(); });
  window.addEventListener('floww:locale', () => { interrupt('voice.interrupted'); render(); });
  window.addEventListener('floww:document-suspend', suspendVoice);
  window.addEventListener('floww:document-resume', event => {
    state.documentSuspended = false; state.restoring = event.detail?.sameOwner === true;
    if (!state.restoring) state.drafts.clear();
    state.compact = false; clearPrivateVoice();
  });
  window.addEventListener('floww:document-reset', () => { state.drafts.clear(); clearPrivateVoice(); $('voice-consent').checked = false; $('voice-mode').value = 'review'; });
  window.addEventListener('pagehide', () => { interrupt('voice.interrupted'); state.capOp++; state.capController?.abort(); state.capController = null; state.capsPending = false; });
  document.addEventListener?.('visibilitychange', () => { if (document.hidden) interrupt('voice.interrupted'); });
  document.addEventListener?.('keydown', event => { if (event.key === 'Escape' && active()) { event.preventDefault(); interrupt('voice.cancelled', { cancel: true }); if (state.compact) { state.compact = false; render(); $('voice-launch').focus(); } else focusVoiceHeading(); } });
  for (const id of ['intent-wallet', 'intent-start', 'intent-end', 'conversation-memory', 'plan-mandate', 'message-text']) for (const event of ['input', 'change']) $(id).addEventListener(event, () => {
    const context = bridge.snapshot(); $('voice-consent').checked = false; if (state.context?.identity !== context.identity) interrupt('voice.contextChanged'); state.context = context; render();
  });
  window.dispatchEvent(new CustomEvent('floww:session-refresh'));
})();
