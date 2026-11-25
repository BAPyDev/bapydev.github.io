async function loadCaptureProcessor(context) {
  // Keep the worklet self-contained for local file previews.
  const source = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.used = 0;
    this.port.onmessage = () => {
      this.port.postMessage({ samples: this.buffer.slice(0, this.used), done: true });
      this.used = 0;
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;
    for (const sample of channel) {
      this.buffer[this.used++] = sample;
      if (this.used === this.buffer.length) {
        this.port.postMessage({ samples: this.buffer }, [this.buffer.buffer]);
        this.buffer = new Float32Array(4096);
        this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor('capture-pcm', CaptureProcessor);
`;
  await context.audioWorklet.addModule("data:text/javascript;charset=utf-8," + encodeURIComponent(source));
}
