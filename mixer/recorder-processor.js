/* The capture recorder: copies the master's samples between two exact
   frame numbers, told to it before the window opens. currentFrame is the
   audio thread's own counter, so the window lands sample-accurately on
   the grid boundary the main thread scheduled — no event timing anywhere
   in the path. Posts the channels back (transferred, not copied) and
   goes silent. */

class MixRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cfg = null;
    this.buffers = null;
    this.written = 0;
    this.sent = false;
    this.port.onmessage = (e) => {
      this.cfg = e.data;
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!this.cfg || this.sent) return true;
    if (!input || !input.length) return true;
    const { startFrame, frames } = this.cfg;
    if (!this.buffers)
      this.buffers = input.map(() => new Float32Array(frames));

    const blockStart = currentFrame;
    const n = input[0].length;
    const from = Math.max(blockStart, startFrame);
    const to = Math.min(blockStart + n, startFrame + frames);
    for (let i = from; i < to; i++)
      for (let c = 0; c < this.buffers.length; c++)
        this.buffers[c][i - startFrame] = (input[c] || input[0])[i - blockStart];
    if (to > from) this.written += to - from;

    if (blockStart + n >= startFrame + frames && !this.sent) {
      this.sent = true;
      this.port.postMessage(
        { channels: this.buffers.map((b) => b.buffer) },
        this.buffers.map((b) => b.buffer)
      );
      return false;
    }
    return true;
  }
}

registerProcessor("mix-recorder", MixRecorder);
