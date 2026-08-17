"use strict";
var MusicDetection = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/global.ts
  var global_exports = {};
  __export(global_exports, {
    chromagram: () => chromagram,
    detectKey: () => detectKey,
    detectLoopBeats: () => detectLoopBeats,
    detectTempo: () => detectTempo,
    onsetEnvelope: () => onsetEnvelope,
    toMono: () => toMono
  });

  // node_modules/@amplib/music-theory/dist/index.js
  var Note = class _Note {
    /**
     * Frequency hz for this note
     */
    frequency;
    /**
     * A unique identifier for this note
     */
    id;
    /**
     * Global index of the note on a keyboard (
     * 0 through 107
     */
    index;
    /**
     * Primary notation for the note
     */
    notation;
    /**
     * Optional secondary notation for the note
     */
    notationAlternate;
    /**
     * Global octave number for the note
     * 0 through 8
     */
    octave;
    /**
     * Index of the note within the octave
     * 0 through 11
     */
    octaveIndex;
    constructor({ octave, step }) {
      const notation = _Note.notations[step];
      const alternate = _Note.notationsAlternate[step];
      this.frequency = _Note.octaveStepFrequencies[octave][step];
      this.id = _Note.noteIdFromNotationAndOctave(notation, octave);
      this.index = step + octave * 12;
      this.notation = notation;
      this.notationAlternate = alternate === this.notation ? void 0 : alternate;
      this.octave = octave;
      this.octaveIndex = step;
    }
    static notationIndex(notation) {
      const notationsIndex = _Note.notations.indexOf(notation);
      if (notationsIndex !== -1) {
        return notationsIndex;
      }
      const notationsAlternateIndex = _Note.notationsAlternate.indexOf(
        notation
      );
      if (notationsAlternateIndex !== -1) {
        return notationsAlternateIndex;
      }
      return -1;
    }
    static noteIdFromNotationAndOctave(notation, octave) {
      return `${notation}${octave}`;
    }
    static get notations() {
      return ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    }
    static get notationsAlternate() {
      return ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
    }
    static get notationsUnique() {
      return Array.from(/* @__PURE__ */ new Set([..._Note.notations, ..._Note.notationsAlternate]));
    }
    // prettier-ignore
    static get octaveStepFrequencies() {
      return {
        0: { 0: 16.352, 1: 17.324, 2: 18.354, 3: 19.445, 4: 20.602, 5: 21.827, 6: 23.125, 7: 24.5, 8: 25.957, 9: 27.5, 10: 29.135, 11: 30.868 },
        1: { 0: 32.703, 1: 34.648, 2: 36.708, 3: 38.891, 4: 41.203, 5: 43.654, 6: 46.249, 7: 48.999, 8: 51.913, 9: 55, 10: 58.27, 11: 61.735 },
        2: { 0: 65.406, 1: 69.296, 2: 73.416, 3: 77.782, 4: 82.407, 5: 87.307, 6: 92.499, 7: 97.999, 8: 103.826, 9: 110, 10: 116.541, 11: 123.471 },
        3: { 0: 130.813, 1: 138.591, 2: 146.832, 3: 155.563, 4: 164.814, 5: 174.614, 6: 184.997, 7: 195.998, 8: 207.652, 9: 220, 10: 233.082, 11: 246.942 },
        4: { 0: 261.626, 1: 277.183, 2: 293.665, 3: 311.127, 4: 329.628, 5: 349.228, 6: 369.994, 7: 391.995, 8: 415.305, 9: 440, 10: 466.164, 11: 493.883 },
        5: { 0: 523.251, 1: 554.365, 2: 587.33, 3: 622.254, 4: 659.255, 5: 698.456, 6: 739.989, 7: 783.991, 8: 830.609, 9: 880, 10: 932.328, 11: 987.767 },
        6: { 0: 1046.502, 1: 1108.731, 2: 1174.659, 3: 1244.508, 4: 1318.51, 5: 1396.913, 6: 1479.978, 7: 1567.982, 8: 1661.219, 9: 1760, 10: 1864.655, 11: 1975.533 },
        7: { 0: 2093.005, 1: 2217.461, 2: 2349.318, 3: 2489.016, 4: 2637.02, 5: 2793.826, 6: 2959.955, 7: 3135.963, 8: 3322.438, 9: 3520, 10: 3729.31, 11: 3951.066 },
        8: { 0: 4186.01, 1: 4434.92, 2: 4698.63, 3: 4978.03, 4: 5274.04, 5: 5587.65, 6: 5919.91, 7: 6271.93, 8: 6644.88, 9: 7040, 10: 7458.62, 11: 7902.13 }
      };
    }
    static stringIsNotation(string) {
      return _Note.notations.includes(string) || _Note.notationsAlternate.includes(string);
    }
  };

  // src/analyze.ts
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wr = Math.cos(ang);
      const wi = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1;
        let ci = 0;
        for (let k = 0; k < half; k++) {
          const ar = re[i + k];
          const ai = im[i + k];
          const br = re[i + k + half] * cr - im[i + k + half] * ci;
          const bi = re[i + k + half] * ci + im[i + k + half] * cr;
          re[i + k] = ar + br;
          im[i + k] = ai + bi;
          re[i + k + half] = ar - br;
          im[i + k + half] = ai - bi;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }
  function toMono(channels) {
    if (channels.length === 1) return channels[0];
    const n = channels[0].length;
    const out = new Float32Array(n);
    for (const ch of channels)
      for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
    return out;
  }
  function onsetEnvelope(samples, sampleRate, { fftSize = 1024, hop = 256 } = {}) {
    const frames = Math.max(0, Math.floor((samples.length - fftSize) / hop) + 1);
    const values = new Float32Array(Math.max(0, frames - 1));
    if (frames < 2) return { values, rate: sampleRate / hop };
    const win = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++)
      win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / fftSize));
    const bins = fftSize >> 1;
    let prev = new Float32Array(bins);
    let curr = new Float32Array(bins);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    for (let f = 0; f < frames; f++) {
      const off = f * hop;
      for (let i = 0; i < fftSize; i++) {
        re[i] = samples[off + i] * win[i];
        im[i] = 0;
      }
      fft(re, im);
      for (let b = 0; b < bins; b++)
        curr[b] = Math.log1p(1e3 * Math.hypot(re[b], im[b]));
      if (f > 0) {
        let flux = 0;
        for (let b = 0; b < bins; b++) {
          const d = curr[b] - prev[b];
          if (d > 0) flux += d;
        }
        values[f - 1] = flux;
      }
      const swap = prev;
      prev = curr;
      curr = swap;
    }
    const w = Math.max(1, Math.round(0.1 * (sampleRate / hop)));
    const out = new Float32Array(values.length);
    let peak = 0;
    for (let i = 0; i < values.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - w); j <= Math.min(values.length - 1, i + w); j++) {
        sum += values[j];
        count++;
      }
      const v = values[i] - sum / count;
      out[i] = v > 0 ? v : 0;
      if (out[i] > peak) peak = out[i];
    }
    if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak;
    return { values: out, rate: sampleRate / hop };
  }
  function tempoPrior(bpm, center = 120, width = 0.9) {
    const x = Math.log2(bpm / center) / width;
    return Math.exp(-0.5 * x * x);
  }
  function lengthPrior(beats) {
    if ((beats & beats - 1) === 0) return 1.12;
    if (beats % 4 === 0) return 1.06;
    return 1;
  }
  function detectTempo(samples, sampleRate, { minBPM = 60, maxBPM = 200 } = {}) {
    const env = onsetEnvelope(samples, sampleRate);
    const n = env.values.length;
    const empty = { bpm: 0, confidence: 0, phase: 0, alternatives: [] };
    if (n < 8) return empty;
    const minLag = Math.max(1, Math.floor(60 / maxBPM * env.rate));
    const maxLag = Math.min(n - 1, Math.ceil(60 / minBPM * env.rate));
    if (maxLag <= minLag) return empty;
    const scored = [];
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i + lag < n; i++) sum += env.values[i] * env.values[i + lag];
      const norm = sum / (n - lag);
      const bpm = 60 * env.rate / lag;
      scored.push({ bpm, score: norm * tempoPrior(bpm) });
    }
    if (!scored.length) return empty;
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const median = scored[Math.floor(scored.length / 2)].score || 1e-9;
    const alts = [];
    for (const c of scored) {
      if (alts.length >= 3) break;
      if (Math.abs(Math.log2(c.bpm / best.bpm)) < 0.15) continue;
      if (alts.some((a) => Math.abs(Math.log2(c.bpm / a.bpm)) < 0.15)) continue;
      alts.push(c);
    }
    const periodFrames = 60 * env.rate / best.bpm;
    const steps = Math.max(8, Math.min(256, Math.round(periodFrames)));
    const count = Math.max(1, Math.floor(n / periodFrames));
    let bestPhase = 0;
    let bestMean = -1;
    for (let sIdx = 0; sIdx < steps; sIdx++) {
      const p = sIdx / steps * periodFrames;
      let sum = 0;
      for (let k = 0; k < count; k++) {
        const i = Math.round(p + k * periodFrames);
        if (i < n) sum += env.values[i];
      }
      const mean = sum / count;
      if (mean > bestMean) {
        bestMean = mean;
        bestPhase = p;
      }
    }
    return {
      bpm: best.bpm,
      confidence: Math.max(0, Math.min(1, 1 - median / (best.score || 1e-9))),
      phase: Math.round(bestPhase / env.rate * sampleRate),
      alternatives: alts
    };
  }
  function detectLoopBeats(samples, sampleRate, {
    minBPM = 60,
    maxBPM = 200,
    maxBeats = 64
  } = {}) {
    const env = onsetEnvelope(samples, sampleRate);
    const n = env.values.length;
    const seconds = samples.length / sampleRate;
    const empty = { beats: 0, bpm: 0, confidence: 0, phase: 0, alternatives: [] };
    if (n < 8 || seconds <= 0) return empty;
    const at = (x) => {
      const i = (x % n + n) % n;
      const a = Math.floor(i);
      const b = (a + 1) % n;
      const t = i - a;
      return env.values[a] * (1 - t) + env.values[b] * t;
    };
    const scored = [];
    for (let beats = 1; beats <= maxBeats; beats++) {
      const bpm = beats * 60 / seconds;
      if (bpm < minBPM || bpm > maxBPM) continue;
      const period = n / beats;
      const steps = Math.max(8, Math.min(256, Math.round(period)));
      let bestPhase = 0;
      let bestMean = -1;
      for (let s = 0; s < steps; s++) {
        const p = s / steps * period;
        let sum = 0;
        for (let k = 0; k < beats; k++) sum += at(p + k * period);
        const mean = sum / beats;
        if (mean > bestMean) {
          bestMean = mean;
          bestPhase = p;
        }
      }
      scored.push({
        beats,
        bpm,
        score: bestMean * tempoPrior(bpm) * lengthPrior(beats),
        phase: bestPhase / n * samples.length
      });
    }
    if (!scored.length) return empty;
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const median = scored[Math.floor(scored.length / 2)].score || 1e-9;
    return {
      beats: best.beats,
      bpm: best.bpm,
      confidence: Math.max(0, Math.min(1, 1 - median / (best.score || 1e-9))),
      phase: Math.round(best.phase),
      alternatives: scored.slice(1, 4).map(({ beats, bpm, score }) => ({
        beats,
        bpm,
        score
      }))
    };
  }
  var KEY_RATE = 16e3;
  function decimate(samples, from, to) {
    if (from <= to) return samples;
    const step = from / to;
    const n = Math.floor(samples.length / step);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * step);
      const b = Math.min(samples.length, Math.floor((i + 1) * step));
      let sum = 0;
      for (let j = a; j < b; j++) sum += samples[j];
      out[i] = b > a ? sum / (b - a) : 0;
    }
    return out;
  }
  var PROFILE_MAJOR = [
    0.748,
    0.06,
    0.488,
    0.082,
    0.67,
    0.46,
    0.096,
    0.715,
    0.104,
    0.366,
    0.057,
    0.4
  ];
  var PROFILE_MINOR = [
    0.712,
    0.084,
    0.474,
    0.618,
    0.049,
    0.46,
    0.105,
    0.747,
    0.404,
    0.067,
    0.133,
    0.33
  ];
  function correlate(a, b) {
    const n = a.length;
    const ma = a.reduce((s, v) => s + v, 0) / n;
    const mb = b.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] - ma;
      const y = b[i] - mb;
      num += x * y;
      da += x * x;
      db += y * y;
    }
    const den = Math.sqrt(da * db);
    return den === 0 ? 0 : num / den;
  }
  function chromagram(samples, sampleRate, { fftSize = 8192, hop = 4096, minHz = 55, maxHz = 2200 } = {}) {
    const chroma = new Array(12).fill(0);
    const frames = Math.floor((samples.length - fftSize) / hop) + 1;
    if (frames < 1) return chroma;
    const win = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++)
      win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / fftSize));
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    const binHz = sampleRate / fftSize;
    const loBin = Math.max(1, Math.floor(minHz / binHz));
    const hiBin = Math.min(fftSize >> 1, Math.ceil(maxHz / binHz));
    const frame = new Array(12);
    for (let f = 0; f < frames; f++) {
      const off = f * hop;
      for (let i = 0; i < fftSize; i++) {
        re[i] = samples[off + i] * win[i];
        im[i] = 0;
      }
      fft(re, im);
      const mag = new Float32Array(hiBin + 2);
      for (let b = loBin - 1; b <= hiBin + 1 && b < fftSize >> 1; b++)
        if (b >= 0) mag[b] = Math.hypot(re[b], im[b]);
      frame.fill(0);
      for (let b = loBin; b <= hiBin; b++) {
        if (!(mag[b] > mag[b - 1] && mag[b] >= mag[b + 1])) continue;
        const d = mag[b - 1] - 2 * mag[b] + mag[b + 1];
        const off2 = d === 0 ? 0 : 0.5 * (mag[b - 1] - mag[b + 1]) / d;
        const hz = (b + (Math.abs(off2) < 0.5 ? off2 : 0)) * binHz;
        if (hz < minHz || hz > maxHz) continue;
        const semi = Math.round(12 * Math.log2(hz / 440));
        const pc = ((semi + 9) % 12 + 12) % 12;
        frame[pc] += mag[b];
      }
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += frame[i];
      if (sum > 0) for (let i = 0; i < 12; i++) chroma[i] += frame[i] / sum;
    }
    const peak = Math.max(...chroma);
    return peak > 0 ? chroma.map((v) => v / peak) : chroma;
  }
  function detectKey(original, originalRate) {
    const sampleRate = Math.min(originalRate, KEY_RATE);
    const samples = decimate(original, originalRate, sampleRate);
    const chroma = chromagram(samples, sampleRate);
    const total = chroma.reduce((s, v) => s + v, 0);
    const notations = Note.notations;
    if (total <= 0) {
      return {
        root: notations[0],
        mode: "major",
        confidence: 0,
        chroma,
        atonal: true,
        runnerUp: null
      };
    }
    const results = [];
    for (let r = 0; r < 12; r++) {
      const rotated = chroma.map((_, i) => chroma[(i + r) % 12]);
      results.push({ root: notations[r], mode: "major", score: correlate(rotated, PROFILE_MAJOR) });
      results.push({ root: notations[r], mode: "minor", score: correlate(rotated, PROFILE_MINOR) });
    }
    results.sort((a, b) => b.score - a.score);
    const rootIndex = (k) => notations.indexOf(k.root);
    const sameScale = (a, b) => {
      if (a.mode === b.mode) return rootIndex(a) === rootIndex(b);
      const major = a.mode === "major" ? a : b;
      const minor = a.mode === "major" ? b : a;
      return (rootIndex(minor) + 3) % 12 === rootIndex(major) % 12;
    };
    let best = results[0];
    if (best.score < 0.5) {
      return {
        root: notations[0],
        mode: "major",
        confidence: 0,
        chroma,
        atonal: true,
        runnerUp: null
      };
    }
    const relative = results.find((r) => r !== best && sameScale(best, r));
    if (relative) {
      const head = samples.subarray(
        0,
        Math.min(
          samples.length,
          Math.max(samples.length >> 2, Math.floor(sampleRate * 0.5))
        )
      );
      const bass = chromagram(head, sampleRate, { minHz: 40, maxHz: 250 });
      const cue = bass.some((v) => v > 0) ? bass : chromagram(head, sampleRate);
      if (cue.some((v) => v > 0) && cue[rootIndex(relative)] > cue[rootIndex(best)])
        best = relative;
    }
    const outside = results.find((r) => !sameScale(best, r));
    const next = outside ?? results[1];
    return {
      root: best.root,
      mode: best.mode,
      confidence: Math.max(0, Math.min(1, (best.score - next.score) * 3)),
      chroma,
      atonal: false,
      runnerUp: { root: next.root, mode: next.mode }
    };
  }
  return __toCommonJS(global_exports);
})();