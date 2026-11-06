(() => {
  'use strict';
  const SAMPLE_RATE = 16000, MAX_SECONDS = 60, MAX_FRAMES = SAMPLE_RATE * MAX_SECONDS, MAX_BYTES = 44 + MAX_FRAMES * 2;
  function encodeWav({ samples, sampleRate }) {
    if (sampleRate !== SAMPLE_RATE) throw Error('INVALID_VOICE_AUDIO');
    if (!(samples instanceof Float32Array) || !samples.length || samples.length > MAX_FRAMES) throw Error('INVALID_VOICE_AUDIO');
    const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
    const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      if (!Number.isFinite(samples[i])) throw Error('INVALID_VOICE_AUDIO');
      const value = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    return Object.freeze({ bytes, durationMs: samples.length * 1000 / SAMPLE_RATE, frames: samples.length });
  }
  function merge(chunks, sampleRate) {
    if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000 || !Array.isArray(chunks)) throw Error('INVALID_VOICE_AUDIO');
    let frames = 0;
    for (const chunk of chunks) { if (!(chunk instanceof Float32Array) || !chunk.length) throw Error('INVALID_VOICE_AUDIO'); frames += chunk.length; if (frames > sampleRate * MAX_SECONDS) throw Error('VOICE_AUDIO_TOO_LARGE'); }
    if (!frames) throw Error('VOICE_NO_SPEECH');
    const samples = new Float32Array(frames); let offset = 0;
    for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
    return samples;
  }
  window.FlowwVoiceAudio = Object.freeze({ SAMPLE_RATE, MAX_SECONDS, MAX_FRAMES, MAX_BYTES, encodeWav, merge });
})();
