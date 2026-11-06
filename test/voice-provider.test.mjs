import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createVoiceTranscriber } from '../service/voice-provider.mjs';
import { setupVoice, wav } from './voice-helpers.mjs';

test('actual default transcriber and mounted HTTP route share the object/audio contract without vendor calls', async () => {
  let calls = 0;
  const provider = createVoiceTranscriber({ apiKey: 'scripted-voice-key', fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions'); assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST'); assert.equal(options.headers.Authorization, 'Bearer scripted-voice-key');
    assert.equal(options.body.get('model'), 'gpt-transcribe'); assert.equal(options.body.get('stream'), 'false');
    assert.equal(options.body.get('response_format'), 'json'); assert.deepEqual(options.body.getAll('languages[]'), ['ko']);
    assert.equal(options.body.has('language'), false); assert.equal(options.body.has('prompt'), false);
    assert.equal(options.body.get('file').name, 'capture.wav');
    assert.ok(Buffer.from(await options.body.get('file').arrayBuffer()).equals(wav()));
    return new Response(JSON.stringify({ text: '  실제 연결 계약  ', languages: [{ code: 'ko' }], private: 'discarded provider metadata' }), { headers: { 'Content-Type': 'application/json' } });
  } });
  const f = await setupVoice({ provider });
  try {
    const user = await f.login(), conversation = await f.conversation(user.cookie), result = await f.raw(user.cookie, conversation);
    assert.equal(result.status, 200); assert.equal(result.body.text, '실제 연결 계약'); assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(result.body), /provider metadata|languages|Bearer|scripted-voice-key/);
    assert.equal(f.calls().forbidden, 0);
  } finally { await f.close(); }
});
test('real loopback HTTP exercises multipart WAV, deadline and abort without an external endpoint', async () => {
  let mode = 'success', calls = 0, aborted = 0;
  const server = createServer((req, res) => {
    calls++; const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/);
      const body = Buffer.concat(chunks).toString('latin1'); assert.match(body, /name="model"\r\n\r\ngpt-transcribe/);
      assert.match(body, /name="languages\[\]"\r\n\r\nen/); assert.match(body, /filename="capture.wav"/);
      if (mode === 'hang') { res.once('close', () => { aborted++; }); return; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: 'Loopback recording' }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const provider = createVoiceTranscriber({ apiKey: 'owned-scripted-key', timeoutMs: 40,
    fetchImpl: (expected, options) => { assert.equal(expected, 'https://api.openai.com/v1/audio/transcriptions'); return fetch(url, options); } });
  try {
    assert.equal(await provider.transcribe({ audio: wav(), language: 'en' }, { signal: new AbortController().signal }), 'Loopback recording');
    mode = 'hang'; await assert.rejects(provider.transcribe({ audio: wav(), language: 'en' }, { signal: new AbortController().signal }), { code: 'VOICE_TIMEOUT' });
    const controller = new AbortController(), pending = provider.transcribe({ audio: wav(), language: 'en' }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 15); await assert.rejects(pending, { code: 'VOICE_CANCELLED' });
    await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(calls, 3); assert.equal(aborted, 2);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('provider protocol enforces both declared and streamed bytes and cancels invalid/error bodies', async () => {
  const signal = new AbortController().signal;
  for (const [response, expected] of [
    [() => new Response('private vendor diagnostics', { status: 503 }), 'VOICE_UNAVAILABLE'],
    [() => new Response('{}', { headers: { 'content-type': 'text/html' } }), 'VOICE_INVALID_RESULT'],
    [() => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '65537' } }), 'VOICE_INVALID_RESULT'],
    [() => new Response('not JSON', { headers: { 'content-type': 'application/json' } }), 'VOICE_INVALID_RESULT'],
    [() => new Response(JSON.stringify({ text: '' }), { headers: { 'content-type': 'application/json' } }), 'VOICE_NO_SPEECH'],
    [() => new Response(JSON.stringify({ text: 'x'.repeat(2001) }), { headers: { 'content-type': 'application/json' } }), 'VOICE_INVALID_RESULT'],
    [() => new Response(Uint8Array.from([0xc3, 0x28]), { headers: { 'content-type': 'application/json' } }), 'VOICE_INVALID_RESULT'],
  ]) {
    let calls = 0; const provider = createVoiceTranscriber({ apiKey: 'scripted-only', fetchImpl: async () => { calls++; return response(); } });
    await assert.rejects(provider.transcribe({ audio: wav(), language: 'ko' }, { signal }), error => error.code === expected && !String(error).includes('private vendor'));
    assert.equal(calls, 1);
  }
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel() { cancelled = true; } });
  const provider = createVoiceTranscriber({ apiKey: 'scripted-only', fetchImpl: async () => new Response(stream, { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(provider.transcribe({ audio: wav(), language: 'en' }, { signal }), { code: 'VOICE_INVALID_RESULT' }); assert.equal(cancelled, true);
});
