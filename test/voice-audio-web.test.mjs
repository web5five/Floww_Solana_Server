import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { voiceAudio } from './ui-harness.mjs';
import { makeProcessor as processor } from './voice-ui-harness.mjs';
function audio() { const window = {}; vm.runInNewContext(voiceAudio, { window, Float32Array, Uint8Array, DataView }); return window.FlowwVoiceAudio; }
test('canonical WAV contains exact mono16k PCM16 framing, measured duration and signed samples', () => {
  const pcm = audio(), samples = new Float32Array([-2, -1, -.5, 0, .5, 1, 2]), wav = pcm.encodeWav({ samples, sampleRate: 16000 });
  const bytes = wav.bytes, d = new DataView(bytes.buffer), text = (from, length) => new TextDecoder().decode(bytes.subarray(from, from + length));
  assert.equal(text(0, 4), 'RIFF'); assert.equal(text(8, 4), 'WAVE'); assert.equal(text(12, 4), 'fmt '); assert.equal(text(36, 4), 'data');
  assert.equal(d.getUint32(4, true), bytes.length - 8); assert.equal(d.getUint32(16, true), 16); assert.equal(d.getUint16(20, true), 1); assert.equal(d.getUint16(22, true), 1);
  assert.equal(d.getUint32(24, true), 16000); assert.equal(d.getUint32(28, true), 32000); assert.equal(d.getUint16(32, true), 2); assert.equal(d.getUint16(34, true), 16);
  assert.equal(d.getUint32(40, true), samples.length * 2); assert.equal(wav.durationMs, samples.length / 16);
  assert.deepEqual(Array.from({ length: samples.length }, (_, i) => d.getInt16(44 + i * 2, true)), [-32768, -32768, -16384, 0, 16384, 32767, 32767]);
});
for (const rate of [44100, 48000]) test('native' + rate + ' samples cannot be silently relabelled as16k', () => {
  const pcm = audio(), samples = pcm.merge([new Float32Array(100)], rate);
  assert.throws(() => pcm.encodeWav({ samples, sampleRate: rate }), /INVALID/); assert.throws(() => pcm.encodeWav(samples), /INVALID/);
});
test('WAV accepts exactly60s and rejects oversize, empty and nonfinite samples', () => {
  const pcm = audio(); assert.equal(pcm.encodeWav({ samples: new Float32Array(960000), sampleRate: 16000 }).bytes.length, 1920044);
  for (const samples of [new Float32Array(960001), new Float32Array(), new Float32Array([NaN]), new Float32Array([Infinity])]) assert.throws(() => pcm.encodeWav({ samples, sampleRate: 16000 }), /INVALID/);
  assert.throws(() => pcm.merge([new Float32Array(16001)], 16000 / 100), /INVALID/);
});
test('real worklet handles variable quanta, downmixes channels, meters real samples and outputs silence', () => {
  const { value, messages } = processor(); let frames = 0;
  for (const length of [17, 257, 64, 511]) {
    const out = new Float32Array(length).fill(.9); value.process([[new Float32Array(length).fill(.8), new Float32Array(length).fill(-.2)]], [[out]]); frames += length;
    assert.ok(out.every(n => n === 0));
  }
  value.port.onmessage({ data: { type: 'stop' } }); const samples = messages.filter(m => m.type === 'samples');
  assert.equal(samples.reduce((n, m) => n + m.samples.length, 0), frames); assert.ok(samples.every(m => Math.abs(m.rms - .3) < .00001)); assert.ok(samples.every(m => m.samples.every(n => Math.abs(n - .3) < .00001)));
  assert.equal(messages.at(-1).type, 'sealed'); assert.equal(messages.at(-1).frames, frames); const count = messages.length;
  value.port.onmessage({ data: { type: 'stop' } }); assert.equal(messages.length, count); assert.equal(value.process([], [[]]), false);
});
for (const rate of [16000, 44100, 48000]) test('real worklet bounds' + rate + ' capture independently of a stalled main thread', () => {
  const { value, messages } = processor(rate), input = new Float32Array(rate * 61).fill(.125), output = new Float32Array(input.length).fill(1);
  assert.equal(value.process([[input]], [[output]]), false); assert.ok(output.every(n => n === 0));
  const chunks = messages.filter(m => m.type === 'samples'); assert.equal(chunks.reduce((n, m) => n + m.samples.length, 0), rate * 60);
  assert.ok(chunks.length <= 1201); assert.ok(chunks.every(m => m.samples.length <= 8192)); assert.equal(messages.at(-1).frames, rate * 60);
});
