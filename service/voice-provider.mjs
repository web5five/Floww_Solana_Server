import { ServiceError, fail } from './config.mjs';
import { validateVoiceAudio, voiceText } from './voice-audio.mjs';

const endpoint = 'https://api.openai.com/v1/audio/transcriptions';
const maximum = 65_536;
export function createVoiceTranscriber({ apiKey, fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 4096 || /\s/.test(apiKey) ||
      typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000) {
    fail('INVALID_CONFIGURATION', 500);
  }
  return Object.freeze({ async transcribe({ audio, language } = {}, { signal } = {}) {
    validateVoiceAudio(audio);
    if (!['ko', 'en'].includes(language) || !(signal instanceof AbortSignal)) fail('INVALID_VOICE_REQUEST');
    const controller = new AbortController(); let timedOut = false, reader, response, complete = false;
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      if (controller.signal.aborted) fail('VOICE_CANCELLED', 409);
      const form = new FormData();
      form.set('model', 'gpt-transcribe'); form.set('file', new Blob([audio], { type: 'audio/wav' }), 'capture.wav');
      form.set('response_format', 'json'); form.set('stream', 'false'); form.append('languages[]', language);
      response = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + apiKey },
        body: form, signal: controller.signal, redirect: 'error' });
      if (controller.signal.aborted) fail(timedOut ? 'VOICE_TIMEOUT' : 'VOICE_CANCELLED', timedOut ? 504 : 409);
      if (!response.ok) fail('VOICE_UNAVAILABLE', 503);
      if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' ||
          Number(response.headers.get('content-length')) > maximum || !response.body?.getReader) fail('VOICE_INVALID_RESULT', 502);
      reader = response.body.getReader(); const chunks = []; let size = 0;
      while (true) {
        const item = await reader.read(); if (item.done) { complete = true; break; }
        size += item.value.byteLength;
        if (size > maximum) fail('VOICE_INVALID_RESULT', 502);
        chunks.push(item.value);
      }
      if (controller.signal.aborted) fail(timedOut ? 'VOICE_TIMEOUT' : 'VOICE_CANCELLED', timedOut ? 504 : 409);
      let result;
      try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { fail('VOICE_INVALID_RESULT', 502); }
      if (!result || Array.isArray(result)) fail('VOICE_INVALID_RESULT', 502);
      return voiceText(result.text);
    } catch (error) {
      if (timedOut) throw new ServiceError('VOICE_TIMEOUT', 504);
      if (signal.aborted) throw new ServiceError('VOICE_CANCELLED', 409);
      if (error instanceof ServiceError) throw error;
      throw new ServiceError('VOICE_UNAVAILABLE', 503);
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (reader) { if (!complete) { try { await reader.cancel(); } catch {} } try { reader.releaseLock(); } catch {} }
      else if (response?.body) { try { await response.body.cancel(); } catch {} }
    }
  } });
}
