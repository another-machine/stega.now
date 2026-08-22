/* The grain engine: a time-domain granular pitch shifter.
--
   Grains of GRAIN samples, Hann-windowed at half overlap, fire on a
   fixed schedule locked to the input clock. Each grain is the last
   GRAIN×pitchFactor input samples, resampled to GRAIN and laid onto the
   output at its fire position — so a transient lives inside one grain,
   plays once at full speed, and lands where the clock says. That is the
   whole trade against the phase vocoder: attacks survive untouched, and
   sustained tones pick up a grain-rate texture instead.

   Latency is exactly GRAIN samples for every sample — the same 2048 the
   vocoder's overlap-add costs and the tape delay copies — so decks on
   different engines stay locked. At a factor of exactly 1 the grains
   reassemble the input bit-for-bit, delayed by GRAIN: Hann at half
   overlap sums to one, and both grains covering a sample agree on it. */

const GRAIN = 2048;
const HOP = GRAIN / 2;
const HISTORY = 16384; // covers GRAIN × the max factor, with room
const OUTSZ = 8192;

class GrainShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "pitchFactor", defaultValue: 1, minValue: 0.25, maxValue: 4 },
    ];
  }

  constructor() {
    super();
    this.ring = [];
    this.outRing = [];
    this.written = 0;
    this.nextGrain = 0;
    this.win = new Float32Array(GRAIN);
    for (let i = 0; i < GRAIN; i++)
      this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / GRAIN);
  }

  read(ring, pos) {
    if (pos < 0) return 0;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = ring[i0 % HISTORY];
    const b = ring[(i0 + 1) % HISTORY];
    return a + (b - a) * frac;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;
    while (this.ring.length < input.length) {
      this.ring.push(new Float32Array(HISTORY));
      this.outRing.push(new Float32Array(OUTSZ));
    }
    const p = Math.max(0.25, Math.min(4, parameters.pitchFactor[0]));
    const n = input[0].length;

    for (let c = 0; c < input.length; c++)
      for (let i = 0; i < n; i++)
        this.ring[c][(this.written + i) % HISTORY] = input[c][i];

    // Fire every grain whose anchor this block reaches. A grain reads
    // only input behind its anchor, so it is always causal, whatever
    // the factor.
    while (this.nextGrain <= this.written + n) {
      const A = this.nextGrain;
      for (let c = 0; c < this.ring.length; c++) {
        const ring = this.ring[c];
        const out = this.outRing[c];
        for (let j = 0; j < GRAIN; j++)
          out[(A + j) % OUTSZ] +=
            this.read(ring, A - (GRAIN - j) * p) * this.win[j];
      }
      this.nextGrain += HOP;
    }

    for (let c = 0; c < output.length; c++) {
      const out = this.outRing[Math.min(c, this.outRing.length - 1)];
      for (let i = 0; i < n; i++) {
        const idx = (this.written + i) % OUTSZ;
        output[c][i] = out[idx];
      }
    }
    // Zero what was emitted, after every output channel has read it.
    for (let c = 0; c < this.outRing.length; c++)
      for (let i = 0; i < n; i++)
        this.outRing[c][(this.written + i) % OUTSZ] = 0;

    this.written += n;
    return true;
  }
}

registerProcessor("grain-shifter", GrainShifter);
