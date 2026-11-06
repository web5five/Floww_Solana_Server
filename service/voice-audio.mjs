import { fail } from './config.mjs';

export const VOICE_MAX_BYTES = 1_920_044;
export const VOICE_CAPABILITIES = Object.freeze({ provider: 'openai', model: 'gpt-transcribe', processing: 'remote',
  languages: Object.freeze(['ko', 'en']), contentType: 'audio/wav', sampleRate: 16000, channels: 1,
  bitsPerSample: 16, maxDurationMs: 60000, maxBytes: VOICE_MAX_BYTES });

/** One canonical PCM chunk; byte-derived duration cannot be hidden by a codec. */
export function validateVoiceAudio(value) {
  if (!Buffer.isBuffer(value) || value.length < 46 || value.length > VOICE_MAX_BYTES ||
      value.toString('latin1', 0, 4) !== 'RIFF' || value.readUInt32LE(4) !== value.length - 8 ||
      value.toString('latin1', 8, 12) !== 'WAVE' || value.toString('latin1', 12, 16) !== 'fmt ' ||
      value.readUInt32LE(16) !== 16 || value.readUInt16LE(20) !== 1 || value.readUInt16LE(22) !== 1 ||
      value.readUInt32LE(24) !== 16000 || value.readUInt32LE(28) !== 32000 ||
      value.readUInt16LE(32) !== 2 || value.readUInt16LE(34) !== 16 ||
      value.toString('latin1', 36, 40) !== 'data' || value.readUInt32LE(40) !== value.length - 44 ||
      (value.length - 44) % 2 !== 0) fail('INVALID_VOICE_AUDIO', 422);
  // Exact digital silence is not sent to a remote provider as pretend speech.
  if (!value.subarray(44).some(byte => byte !== 0)) fail('VOICE_NO_SPEECH', 422);
  return { durationMs: Math.ceil((value.length - 44) / 32), seconds: Math.ceil((value.length - 44) / 32000) };
}
export function voiceText(value) {
  if (typeof value !== 'string' || !value.isWellFormed()) fail('VOICE_INVALID_RESULT', 502);
  const text = value.replace(/\r\n?/g, '\n').trim().normalize('NFC');
  if (!text) fail('VOICE_NO_SPEECH', 422);
  if (text.length > 2000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(text)) fail('VOICE_INVALID_RESULT', 502);
  return text;
}
