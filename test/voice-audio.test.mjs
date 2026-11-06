import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { wav } from './voice-helpers.mjs';
import { validateVoiceAudio, voiceText, VOICE_MAX_BYTES } from '../service/voice-audio.mjs';
import { createVoiceCaptures } from '../service/voice.mjs';
import { loadConfig } from '../service/config.mjs';
import { createLifecycle } from '../service/lifecycle.mjs';

test('canonical WAV derives exact bounded duration and rejects compressed/ambiguous headers', () => {
  assert.deepEqual(validateVoiceAudio(wav(1)), { durationMs: 1, seconds: 1 });
  assert.deepEqual(validateVoiceAudio(wav(16001)), { durationMs: 1001, seconds: 2 });
  assert.equal(wav(960000).length, VOICE_MAX_BYTES); assert.equal(validateVoiceAudio(wav(960000)).durationMs, 60000);
  for (const [offset, value, method = 'writeUInt32LE'] of [[4, 1], [16, 18], [20, 3, 'writeUInt16LE'],
    [22, 2, 'writeUInt16LE'], [24, 48000], [28, 96000], [32, 4, 'writeUInt16LE'], [34, 32, 'writeUInt16LE'], [40, 1]]) {
    const audio = wav(); audio[method](value, offset); assert.throws(() => validateVoiceAudio(audio), { code: 'INVALID_VOICE_AUDIO' });
  }
  for (const audio of [Buffer.from('not WAV'), Buffer.concat([wav(), Buffer.from([1])]), wav(960001), wav(0)]) assert.throws(() => validateVoiceAudio(audio));
  for (const offset of [0, 8, 12, 36]) { const audio = wav(); audio[offset] |= 0x80; assert.throws(() => validateVoiceAudio(audio), { code: 'INVALID_VOICE_AUDIO' }); }
  assert.throws(() => validateVoiceAudio(wav(16000, true)), { code: 'VOICE_NO_SPEECH' });
  assert.equal(voiceText('  안녕\r\nworld  '), '안녕\nworld');
  for (const value of ['x'.repeat(2001), '\u0000text', '\ud800', null]) assert.throws(() => voiceText(value), { code: 'VOICE_INVALID_RESULT' });
});
test('capture registry is owner scoped, case canonical, bounded and keeps active IDs beyond TTL', () => {
  let now = 0;
  const registry = createVoiceCaptures({ clock: () => now, globalLimit: 2, ownerLimit: 1, retentionMs: 10 });
  const id = randomUUID(), first = registry.claim('OwnerA', id);
  assert.throws(() => registry.claim('OwnerA', id.toUpperCase()), { code: 'VOICE_CAPTURE_REPLAY' });
  assert.throws(() => registry.claim('OwnerA', randomUUID()), { code: 'VOICE_BUSY' });
  const second = registry.claim('ownera', id); now = 100;
  assert.throws(() => registry.claim('Other', randomUUID()), { code: 'VOICE_BUSY' });
  first.settle(); second.settle(); now = 111;
  assert.doesNotThrow(() => registry.claim('OwnerA', id));
});
test('voice is default off with a dedicated key and bounded independent quota settings', () => {
  const disabled = loadConfig({ OPENAI_API_KEY: 'scripted-responses-only', FLOWW_MODEL: 'scripted-text' });
  assert.equal(disabled.voiceEnabled, false); assert.equal(disabled.voiceApiKey, null);
  assert.equal(disabled.voiceDailyCalls, 30); assert.equal(disabled.voiceDailySeconds, 600);
  assert.equal(disabled.voiceOwnerDailyCalls, 10); assert.equal(disabled.voiceOwnerDailySeconds, 180);
  for (const env of [{ FLOWW_ENABLE_VOICE: 'yes' }, { FLOWW_VOICE_API_KEY: 'unsafe\nheader' }, { FLOWW_VOICE_DAILY_CALLS: '0' },
    { FLOWW_VOICE_DAILY_SECONDS: '3601' }, { FLOWW_VOICE_DAILY_CALLS: '2', FLOWW_VOICE_OWNER_DAILY_CALLS: '3' }]) assert.throws(() => loadConfig(env), { code: 'INVALID_CONFIGURATION' });
});
test('drain listeners notify once, isolate sync/async failures, unsubscribe and notify late registration', async () => {
  const lifecycle = createLifecycle({ probe: async () => ({ databaseReady: true, ledgerReady: true }) });
  const calls = [];
  const off = lifecycle.onDrain(() => calls.push('removed')); off(); off();
  lifecycle.onDrain(() => { calls.push('throw'); throw new Error('private'); });
  lifecycle.onDrain(async () => { calls.push('reject'); throw new Error('private async'); });
  lifecycle.onDrain(() => { assert.equal(lifecycle.draining, true); calls.push('last'); });
  lifecycle.beginDrain(); lifecycle.beginDrain();
  lifecycle.onDrain(async () => { calls.push('late'); throw new Error('private late'); });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['throw', 'reject', 'last', 'late']); assert.throws(() => lifecycle.assertAccepting(), { code: 'SERVICE_DRAINING' });
});
