import { createHash } from 'node:crypto';
import { fail, ServiceError } from './config.mjs';
import { VOICE_CAPABILITIES, VOICE_MAX_BYTES, validateVoiceAudio, voiceText } from './voice-audio.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const ownerHash = owner => createHash('sha256').update(owner).digest('hex');
const cancelled = signal => signal.reason instanceof ServiceError ? signal.reason : new ServiceError('VOICE_CANCELLED', 409);
const guard = signal => { if (signal.aborted) throw cancelled(signal); };
const disconnected = (req, res) => req.aborted === true || req.readableAborted === true || res.destroyed === true || res.socket?.destroyed === true;
const busy = () => { const error = new ServiceError('VOICE_BUSY', 429); error.retryAfter = 1; throw error; };

/** Refuse repeats within this process/window; do not claim durable exactly-once. */
export function createVoiceCaptures({ clock = () => performance.now(), globalLimit = 1024, ownerLimit = 128, retentionMs = 600_000 } = {}) {
  if (typeof clock !== 'function' || !Number.isSafeInteger(globalLimit) || globalLimit < 1 || globalLimit > 1024 ||
      !Number.isSafeInteger(ownerLimit) || ownerLimit < 1 || ownerLimit > 128 || ownerLimit > globalLimit ||
      !Number.isSafeInteger(retentionMs) || retentionMs < 1 || retentionMs > 600_000) fail('INVALID_CONFIGURATION', 500);
  const entries = new Map();
  const fresh = (owner, id) => {
    const now = clock(), hash = ownerHash(owner);
    if (!Number.isFinite(now) || now < 0 || !uuid(id)) fail('INVALID_VOICE_REQUEST');
    const key = hash + ':' + id.toLowerCase();
    for (const [key, entry] of entries) if (!entry.active && entry.expires <= now) entries.delete(key);
    if (entries.has(key)) fail('VOICE_CAPTURE_REPLAY', 409);
    return { hash, key };
  };
  return Object.freeze({ assertFresh(owner, id) { fresh(owner, id); }, claim(owner, id) {
    const { hash, key } = fresh(owner, id);
    if (entries.size >= globalLimit || [...entries.values()].filter(entry => entry.owner === hash).length >= ownerLimit) busy();
    const entry = { owner: hash, active: true, expires: null }; entries.set(key, entry);
    return Object.freeze({ settle() {
      if (!entry.active) return;
      entry.active = false; entry.expires = clock() + retentionMs;
    } });
  } });
}
function metadata(req) {
  if (Object.keys(req.query).length) fail('INVALID_VOICE_REQUEST');
  if (req.get('x-floww-voice-consent') !== 'true') fail('VOICE_CONSENT_REQUIRED');
  const conversationId = req.get('x-floww-conversation-id'), captureId = req.get('x-floww-capture-id');
  const revision = req.get('x-floww-expected-revision'), language = req.get('x-floww-language');
  if (!uuid(conversationId) || !uuid(captureId) || !['ko', 'en'].includes(language) ||
      typeof revision !== 'string' || !/^[1-9][0-9]{0,15}$/.test(revision) || !Number.isSafeInteger(Number(revision))) fail('INVALID_VOICE_REQUEST');
  if (req.get('content-type')?.trim().toLowerCase() !== 'audio/wav' ||
      (req.get('content-encoding') !== undefined && req.get('content-encoding').toLowerCase() !== 'identity')) fail('VOICE_AUDIO_REQUIRED', 415);
  const length = req.get('content-length');
  if (length !== undefined && (!/^(0|[1-9][0-9]{0,15})$/.test(length) || !Number.isSafeInteger(Number(length)))) fail('INVALID_VOICE_REQUEST');
  if (length !== undefined && Number(length) > VOICE_MAX_BYTES) fail('VOICE_AUDIO_TOO_LARGE', 413);
  if (length !== undefined && Number(length) < 46) fail('INVALID_VOICE_AUDIO', 422);
  return { conversationId: conversationId.toLowerCase(), captureId: captureId.toLowerCase(), revision: Number(revision), language };
}
function readAudio(req, signal, stop, milliseconds) {
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0, done = false;
    const finish = (reason, value) => {
      if (done) return; done = true; clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('error', error); signal.removeEventListener('abort', abort);
      if (reason) { req.pause(); reject(reason); } else resolve(value);
    };
    const abort = () => finish(cancelled(signal));
    const data = chunk => {
      bytes += chunk.length;
      if (bytes > VOICE_MAX_BYTES) { stop(new ServiceError('VOICE_AUDIO_TOO_LARGE', 413)); return; }
      chunks.push(chunk);
    };
    const end = () => finish(null, Buffer.concat(chunks, bytes));
    const error = () => stop(new ServiceError('VOICE_CANCELLED', 409));
    const timer = setTimeout(() => stop(new ServiceError('VOICE_UPLOAD_TIMEOUT', 408)), milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    req.on('data', data); req.once('end', end); req.once('error', error);
    if (signal.aborted) abort();
  });
}
function observe(promise, signal) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => { if (done) return; done = true; signal.removeEventListener('abort', abort); fn(value); };
    const abort = () => finish(reject, cancelled(signal));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => finish(resolve, value), error => finish(reject, error));
    if (signal.aborted) abort();
  });
}

export function mountVoice(routes, { config, auth, lifecycle, withOperation, repo, provider }) {
  const captures = createVoiceCaptures(), owners = new Map(); let running = 0;
  const uploadMs = config.voiceUploadTimeoutMs ?? 10_000, providerMs = config.voiceProviderTimeoutMs ?? 20_000;
  if (!Number.isSafeInteger(uploadMs) || uploadMs < 1 || uploadMs > 10_000 ||
      !Number.isSafeInteger(providerMs) || providerMs < 1 || providerMs > 20_000) fail('INVALID_CONFIGURATION', 500);
  const limits = { globalCalls: config.voiceDailyCalls ?? 30, ownerCalls: config.voiceOwnerDailyCalls ?? 10,
    globalSeconds: config.voiceDailySeconds ?? 600, ownerSeconds: config.voiceOwnerDailySeconds ?? 180 };
  async function current(req, owner, meta, signal) {
    guard(signal); lifecycle.assertAccepting();
    guard(signal); await repo.voiceContext(owner, meta.conversationId, meta.revision); guard(signal);
    // The context reads may outlive a logout or expiry. Authorization is the
    // final awaited decision before dispatch/release, never the earlier one.
    if ((await auth(req)).wallet !== owner) fail('AUTHENTICATION_REQUIRED', 401);
    guard(signal);
    lifecycle.assertAccepting();
  }
  routes.get('/api/voice/capabilities', async (req, res) => {
    const session = await auth(req);
    if (Object.keys(req.query).length) fail('INVALID_VOICE_REQUEST');
    lifecycle.assertAccepting();
    const value = { enabled: config.voiceEnabled === true, configured: Boolean(config.voiceApiKey), ...VOICE_CAPABILITIES };
    if ((await auth(req)).wallet !== session.wallet) fail('AUTHENTICATION_REQUIRED', 401);
    lifecycle.assertAccepting(); res.json(value);
  });
  routes.post('/api/voice/transcriptions', async (req, res) => {
    try {
      const owner = (await auth(req)).wallet;
      if (disconnected(req, res)) fail('VOICE_CANCELLED', 409);
      if (config.voiceEnabled !== true) fail('VOICE_DISABLED', 503);
      if (!config.voiceApiKey) fail('VOICE_NOT_CONFIGURED', 503);
      const meta = metadata(req);
      if (!repo?.voiceContext || !repo?.reserveVoice || typeof provider?.transcribe !== 'function' || typeof lifecycle.onDrain !== 'function') fail('VOICE_UNAVAILABLE', 503);
      const controller = new AbortController(); let providerTimer, cleaned = false;
      const stop = error => { if (!controller.signal.aborted) controller.abort(error); };
      const aborted = () => stop(new ServiceError('VOICE_CANCELLED', 409));
      const closed = () => { if (!res.writableEnded) aborted(); };
      req.once('aborted', aborted); res.once('close', closed);
      let offDrain = () => {};
      const cleanup = () => {
        if (cleaned) return; cleaned = true; clearTimeout(providerTimer); offDrain();
        req.off('aborted', aborted); res.off('close', closed);
      };
      try { offDrain = lifecycle.onDrain(() => stop(new ServiceError('SERVICE_DRAINING', 503))); }
      catch (error) { cleanup(); throw error; }
      const flight = withOperation(req, owner, async () => {
        await current(req, owner, meta, controller.signal);
        captures.assertFresh(owner, meta.captureId);
        if (running >= 2 || owners.has(owner)) busy();
        running++; owners.set(owner, true); let capture;
        try {
          capture = captures.claim(owner, meta.captureId);
          const audio = await readAudio(req, controller.signal, stop, uploadMs), duration = validateVoiceAudio(audio);
          await current(req, owner, meta, controller.signal);
          // These are persistent admissions, never a claim of provider billing.
          // Once reserved, even a final context/cancel guard may consume them.
          await repo.reserveVoice(owner, duration.seconds, limits);
          await current(req, owner, meta, controller.signal);
          providerTimer = setTimeout(() => stop(new ServiceError('VOICE_TIMEOUT', 504)), providerMs);
          let transcript;
          try { transcript = await provider.transcribe({ audio, language: meta.language }, { signal: controller.signal }); }
          catch (error) {
            if (error instanceof ServiceError && ['VOICE_TIMEOUT', 'VOICE_CANCELLED', 'VOICE_UNAVAILABLE', 'VOICE_NO_SPEECH', 'VOICE_INVALID_RESULT'].includes(error.code)) throw error;
            fail('VOICE_UNAVAILABLE', 503);
          } finally { clearTimeout(providerTimer); providerTimer = undefined; }
          const text = voiceText(transcript);
          await current(req, owner, meta, controller.signal);
          return { version: 'voice-transcript/v1', captureId: meta.captureId, conversationId: meta.conversationId,
            revision: meta.revision, languageHint: meta.language, durationMs: duration.durationMs, text };
        } finally { capture?.settle(); running--; owners.delete(owner); }
      });
      // An aborted HTTP observation must not free aggregate/voice slots or
      // permit a replacement while the actual provider promise is still alive.
      void flight.then(cleanup, cleanup);
      const result = await observe(flight, controller.signal);
      guard(controller.signal); lifecycle.assertAccepting(); res.json(result);
    } catch (error) {
      if (!req.readableEnded && !res.headersSent && !res.destroyed) {
        res.set('Connection', 'close'); res.once('finish', () => req.destroy());
      }
      throw error;
    }
  });
}
