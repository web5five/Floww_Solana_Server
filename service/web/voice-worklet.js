/* Audio render thread only. No network, storage, transcript or authority. */
class FlowwVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.maximum = Math.min(96000 * 60, Math.floor(sampleRate * 60));
    this.size = Math.max(256, Math.min(8192, Math.round(sampleRate / 20)));
    this.buffer = new Float32Array(this.size); this.used = 0; this.frames = 0; this.energy = 0; this.closed = false;
    this.port.onmessage = event => { if (event.data?.type === 'stop') this.seal(); };
  }
  flush() {
    if (!this.used) return;
    const samples = this.buffer.slice(0, this.used), rms = Math.sqrt(this.energy / this.used);
    this.port.postMessage({ type: 'samples', samples, frames: this.frames, rms }, [samples.buffer]); this.used = 0; this.energy = 0;
  }
  seal() {
    if (this.closed) return;
    this.closed = true; this.flush(); this.port.postMessage({ type: 'sealed', frames: this.frames });
  }
  process(inputs, outputs) {
    // The graph is pulled by a destination, but microphone samples are NEVER
    // monitored through its output. Quantum size is read, never assumed128.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.closed) return false;
    const channels = inputs[0] ?? [], length = channels[0]?.length ?? 0;
    for (let i = 0; i < length && this.frames < this.maximum; i++) {
      let value = 0;
      for (const channel of channels) value += Number.isFinite(channel[i]) ? channel[i] : 0;
      value = Math.max(-1, Math.min(1, value / Math.max(1, channels.length)));
      this.buffer[this.used++] = value; this.energy += value * value; this.frames++;
      if (this.used === this.size) this.flush();
    }
    if (this.frames >= this.maximum) this.seal();
    return !this.closed;
  }
}
registerProcessor('floww-voice-capture', FlowwVoiceCapture);
