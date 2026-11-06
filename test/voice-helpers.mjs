import { createServer } from 'node:http';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { getBase58Decoder } from '@solana/kit';
import { loadConfig } from '../service/config.mjs';
import { Store } from '../service/store.mjs';
import { buildRuntime } from '../service/main.mjs';

export function wav(samples = 16000, silent = false) {
  const value = Buffer.alloc(44 + samples * 2);
  value.write('RIFF'); value.writeUInt32LE(value.length - 8, 4); value.write('WAVE', 8); value.write('fmt ', 12);
  value.writeUInt32LE(16, 16); value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22); value.writeUInt32LE(16000, 24);
  value.writeUInt32LE(32000, 28); value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34); value.write('data', 36); value.writeUInt32LE(samples * 2, 40);
  if (!silent) for (let i = 44; i < value.length; i += 2) value.writeInt16LE(1000, i);
  return value;
}
export function identity() {
  const keys = generateKeyPairSync('ed25519');
  return { ...keys, wallet: getBase58Decoder().decode(keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)) };
}
export async function setupVoice({ enabled = true, configured = true, provider, configChanges = {} } = {}) {
  let now = Date.UTC(2026, 10, 7, 3), providerCalls = 0, forbiddenCalls = 0;
  const store = new Store(':memory:', { clock: () => now }), server = createServer(), records = [];
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const config = { ...loadConfig({ FLOWW_PUBLIC_ORIGIN: origin, FLOWW_ENABLE_VOICE: String(enabled),
    ...(configured ? { FLOWW_VOICE_API_KEY: 'scripted-voice-test-only' } : {}) }), ...configChanges };
  const control = { call: null };
  const voiceProvider = provider ?? { async transcribe(input, options) {
    providerCalls++; records.push({ input, options });
    return control.call ? control.call(input, options) : '  테스트 음성 입력  ';
  } };
  const forbidden = () => { forbiddenCalls++; throw new Error('Forbidden financial or model test transport'); };
  const runtime = await buildRuntime({ config, store, voiceProvider,
    adapterStatus: { workspaceAdapterReady: true, reportAdapterReady: true }, writeLog: () => {},
    gateway: { readiness: async () => ({ ready: false, missing: [] }), quote: forbidden, sign: forbidden, redeem: forbidden, reconcile: forbidden },
    ai: { propose: forbidden, consume: forbidden }, planner: { refine: forbidden, plan: forbidden }, mountMerchant: () => null });
  server.on('request', runtime.app);
  async function parse(result) { return { status: result.status, headers: result.headers, body: result.status === 204 ? null : await result.json() }; }
  async function request(url, { cookie, method = 'GET', body, headers = {}, signal } = {}) {
    return parse(await fetch(origin + url, { method, headers: { ...(cookie ? { Cookie: cookie } : {}),
      ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal }));
  }
  async function login(keys = identity()) {
    const c = await request('/api/auth/challenge', { method: 'POST', body: { wallet: keys.wallet } });
    const result = await request('/api/auth/verify', { method: 'POST', body: { wallet: keys.wallet, challengeId: c.body.challengeId,
      signature: sign(null, Buffer.from(c.body.message), keys.privateKey).toString('base64') } });
    return { keys, cookie: result.headers.get('set-cookie').split(';')[0] };
  }
  async function conversation(cookie) { return (await request('/api/conversations', { cookie, method: 'POST', body: {} })).body; }
  function headers(cookie, conversation, captureId = randomUUID()) {
    return { Cookie: cookie, Origin: origin, 'Content-Type': 'audio/wav', 'X-Floww-Voice-Consent': 'true',
      'X-Floww-Conversation-Id': conversation.id, 'X-Floww-Expected-Revision': String(conversation.revision),
      'X-Floww-Language': 'ko', 'X-Floww-Capture-Id': captureId };
  }
  async function raw(cookie, conversation, { audio = wav(), captureId = randomUUID(), headers: changed = {}, signal } = {}) {
    return parse(await fetch(origin + '/api/voice/transcriptions', { method: 'POST', headers: { ...headers(cookie, conversation, captureId), ...changed }, body: audio, signal }));
  }
  return { ...runtime, server, origin, control, records, request, login, conversation, raw, headers,
    advance(ms) { now += ms; }, calls: () => ({ provider: providerCalls, forbidden: forbiddenCalls }),
    quota: () => store.db.prepare("SELECT bucket,used FROM workspace_model_usage WHERE bucket LIKE 'voice:v1:%' ORDER BY bucket").all(),
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await runtime.lifecycle.whenIdle(); store.close(); } };
}
