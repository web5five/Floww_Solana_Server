import assert from 'node:assert/strict';
import vm from 'node:vm';
import { harness, client, taskClient, voiceClient, voiceAudio, voiceWorklet, A, B, CONVERSATION_A, CONVERSATION_B, conversation, response, settle, until } from './ui-harness.mjs';
export function makeProcessor(sampleRate = 16000, deliver = () => {}) {
  let Constructor; const messages = [];
  class Base { constructor() { this.port = { postMessage(value) { messages.push(value); deliver(value); } }; } }
  vm.runInNewContext(voiceWorklet, { AudioWorkletProcessor: Base, sampleRate, Float32Array, registerProcessor(_, value) { Constructor = value; } });
  return { value: new Constructor(), messages };
}
export function media({ rate = 16000, permission, moduleLoad } = {}) {
  const m = { contexts: [], nodes: [], tracks: [], offline: [], microphoneCalls: 0, spoken: [], cancellations: 0, listeners: new Map(),
    voices: [{ name: 'Remote', voiceURI: 'remote-en', lang: 'en-US', localService: false }, { name: 'Albert', voiceURI: 'local-albert', lang: 'en-US', localService: true },
      { name: 'Samantha', voiceURI: 'local-samantha', lang: 'en-US', localService: true }, { name: '유나', voiceURI: 'local-yuna', lang: 'ko-KR', localService: true }] };
  m.stream = () => { const track = { stopped: false, stop() { this.stopped = true; }, addEventListener(type, fn) { this[type] = fn; } }; m.tracks.push(track); return { getTracks: () => [track], getAudioTracks: () => [track] }; };
  class AudioContext {
    constructor() { this.sampleRate = rate; this.destination = {}; this.closed = false; this.audioWorklet = { addModule: async path => { assert.equal(path, '/voice-worklet.js'); await moduleLoad?.(); } }; m.contexts.push(this); }
    resume() { return Promise.resolve(); } close() { this.closed = true; return Promise.resolve(); }
    createMediaStreamSource() { const source = { connect(node) { source.node = node; }, disconnect() { source.disconnected = true; } }; return source; }
  }
  class AudioWorkletNode {
    constructor() {
      this.port = { onmessage: null, postMessage: message => this.processor.port.onmessage({ data: message }), close() {} };
      const real = makeProcessor(rate, message => queueMicrotask(() => this.port.onmessage?.({ data: message }))); this.processor = real.value; this.messages = real.messages; m.nodes.push(this);
    }
    connect() {} disconnect() { this.disconnected = true; }
  }
  class OfflineAudioContext {
    constructor(channels, length, outputRate) { this.numberOfChannels = channels; this.length = length; this.sampleRate = outputRate; this.destination = {}; m.offline.push(this); }
    createBuffer(channels, length, sourceRate) { this.sourceRate = sourceRate; this.input = new Float32Array(length); return { copyToChannel: samples => this.input.set(samples) }; }
    createBufferSource() { return { connect() {}, start() {} }; }
    async startRendering() { const output = new Float32Array(this.length); for (let i = 0; i < output.length; i++) {
      const position = i * this.sourceRate / this.sampleRate, left = Math.floor(position), fraction = position - left;
      output[i] = this.input[Math.min(left, this.input.length - 1)] * (1 - fraction) + this.input[Math.min(left + 1, this.input.length - 1)] * fraction;
    } return { sampleRate: this.sampleRate, numberOfChannels: this.numberOfChannels, length: this.length, getChannelData: () => output }; }
  }
  m.browser = { isSecureContext: true, AudioContext, AudioWorkletNode, OfflineAudioContext, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    navigator: { mediaDevices: { getUserMedia() { m.microphoneCalls++; return permission ? permission(m) : Promise.resolve(m.stream()); } } },
    speechSynthesis: { getVoices: () => m.voices, speak(utterance) { m.spoken.push(utterance); queueMicrotask(() => utterance.onstart?.()); }, cancel() { m.cancellations++; }, addEventListener(type, fn) { m.listeners.set(type, fn); } } };
  m.feed = (frames = rate, value = .125) => { const output = new Float32Array(frames).fill(.7); const node = m.nodes.at(-1); assert.ok(node, 'capture node exists');
    node.processor.process([[new Float32Array(frames).fill(value)]], [[output]]); assert.ok(output.every(v => v === 0), 'the real worklet never monitors microphone audio'); };
  return m;
}
export const caps = () => ({ enabled: true, configured: true, provider: 'openai', model: 'gpt-transcribe', processing: 'remote', languages: ['ko', 'en'], contentType: 'audio/wav', sampleRate: 16000, channels: 1, bitsPerSample: 16, maxDurationMs: 60000, maxBytes: 1920044 });
export async function voiceBoot({ hash = '#/voice', owner = A, locale = 'ko', transport, rate = 16000, permission, moduleLoad, browser, capabilities = caps() } = {}) {
  const m = media({ rate, permission, moduleLoad }), c = conversation(CONVERSATION_A, A, false), cb = conversation(CONVERSATION_B, B, false);
  for (const value of [c, cb]) { value.messages = []; value.revision = 1; value.status = 'CLARIFICATION_REQUIRED'; }
  const control = { owner, c, cb, capabilities, transport, transcriptions: 0, creates: 0, messageCalls: 0, text: '인식한 실제 입력', failMessage: false, uploads: [] };
  const h = harness(taskClient + '\n' + client + '\n' + voiceAudio + '\n' + voiceClient, call => {
    const custom = control.transport?.(call, control); if (custom !== undefined) return custom;
    if (call.url === '/api/health') return response({ ready: false, voiceConfigured: true, workspaceAdapterReady: true, reportAdapterReady: true, modelConfigured: true });
    if (call.url === '/api/session') return control.owner ? response({ wallet: control.owner }) : response({ error: { code: 'AUTHENTICATION_REQUIRED' } }, 401);
    if (call.url === '/api/auth/logout') { control.owner = null; return response(null, 204); }
    if (call.url.startsWith('/api/tasks?')) return response({ tasks: [], nextCursor: null });
    if (call.url === '/api/voice/capabilities') return response(control.capabilities);
    if (call.url === '/api/conversations' && call.method === 'POST') { control.creates++; return response(control.owner === B ? control.cb : control.c); }
    if (call.url.startsWith('/api/conversations?')) return response({ items: [], nextCursor: null });
    if (call.url === '/api/mandates') return response({ mandates: [] });
    if (call.url === '/api/conversations/' + CONVERSATION_A) return response(control.c);
    if (call.url === '/api/conversations/' + CONVERSATION_B) return response(control.cb);
    if (call.url.endsWith('/messages') && call.method === 'POST') {
      control.messageCalls++; if (control.failMessage) return response({ error: { code: 'WORKSPACE_MODEL_UNAVAILABLE' } }, 503);
      const value = control.owner === B ? control.cb : control.c; value.revision++; value.messages.push({ id: 'user-' + value.revision, role: 'user', text: call.body.text, at: '2026-11-07T03:00:00.000Z' },
        { id: 'assistant-' + value.revision, role: 'assistant', text: 'CURRENT_ACTUAL_ASSISTANT_REPLY', at: '2026-11-07T03:00:01.000Z' }); return response(value);
    }
    if (call.url === '/api/voice/transcriptions') {
      control.transcriptions++; control.uploads.push({ ...call, body: new Uint8Array(call.body) });
      return response({ version: 'voice-transcript/v1', captureId: call.headers['X-Floww-Capture-Id'], conversationId: call.headers['X-Floww-Conversation-Id'], revision: Number(call.headers['X-Floww-Expected-Revision']),
        languageHint: call.headers['X-Floww-Language'], durationMs: Math.ceil((call.body.length - 44) / 32), text: control.text });
    }
    assert.fail('No unscripted or financial work is allowed: ' + call.method + ' ' + call.url);
  }, { hash, savedLocale: locale, browser: { ...m.browser, ...browser } });
  try { await until(() => owner ? !h.get('logout').disabled : !h.get('connect-wallet').disabled); } catch (error) { throw new Error('Voice bootstrap: ' + JSON.stringify({ calls: h.calls.map(c => c.url), errors: h.backgroundErrors.map(e => e.stack ?? String(e)), notice: h.get('notice-text').textContent }), { cause: error }); } await settle(); return { h, m, control };
}
export async function startVoice(h) { h.get('voice-consent').checked = true; await h.get('voice-consent').trigger('change'); return h.get('voice-start').trigger('click'); }
export async function captureTurn(bundle, frames = bundle.m.contexts.at(-1)?.sampleRate ?? 16000) { const { h, m } = bundle; await startVoice(h); m.feed(frames); await settle(); await h.get('voice-stop').trigger('click'); await settle(); }
