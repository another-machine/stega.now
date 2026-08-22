/* ============================================================
   The mixer's engine: a transport, decks, and two channels.

   Loops arrive as mix stegassettes — read by pairLoops from
   ../loop/format.js, one audio entry and the loop.json directly
   after it, repeated for a pack. Each pair becomes an item
   `{ loop, channels, sampleRate, file, pack, blob }`, and each
   item on a deck is its own voice.

   Nothing here is a beat-match control, because there is nothing
   to match: the transport is one clock, every deck runs at a rate
   locked to it, and a deck launched into a running mix waits for
   the grid.

   Expects the vendored globals `Stegassette` and
   `SoundTransformationLib` to be loaded as classic scripts before
   this module.
   ============================================================ */

import { matchSemitones, normalizeLoop, pairLoops } from "../loop/format.js";

// Overlap-add costs the vocoder a fixed 2048 samples. A tape deck
// skips the vocoder, so it carries the same 2048 as plain delay —
// otherwise it would sit 46 ms ahead of every pitched deck and
// smear the mix. Same latency everywhere keeps the decks locked.
const VOCODER_FRAMES = 2048;

// Below this, auto picks tape. The vocoder's loss is a step at unity,
// not a slope: a 0.2 st correction pays the same ~9.5 dB on percussive
// material and the same transient smear as a full-tone shift. Tape's
// cost is exactly the pitch error it leaves, which at half a semitone
// is a slight mistuning and at zero is nothing. Syncing near-tempo
// loops is the common case, and it should cost nothing.
const AUTO_TAPE_ST = 0.5;

// ---- images ------------------------------------------------
// A Blob in, an Img for the codec. createImageBitmap without color
// space conversion, because the STGC header lives in exact pixel
// values.

async function imgFromBlob(blob) {
  let bmp;
  try {
    bmp = await createImageBitmap(blob, { colorSpaceConversion: "none" });
  } catch (_) {
    bmp = await createImageBitmap(blob);
  }
  const W = bmp.width;
  const H = bmp.height;
  const cnv = Object.assign(document.createElement("canvas"), {
    width: W,
    height: H,
  });
  const ctx = cnv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return new Stegassette.Img(
    W,
    H,
    new Uint8Array(ctx.getImageData(0, 0, W, H).data)
  );
}

// ---- read --------------------------------------------------

/**
 * Pull loops out of a pile of PNGs. A pack expands into one item per
 * pair, all sharing the file and its artwork. Anything that is a
 * stegassette but not a loop is reported rather than dropped silently —
 * usually it is an ordinary stegassette someone hoped would play along,
 * and saying so is more use than ignoring it.
 */
async function read(fileList, onProgress = () => {}) {
  const files = [...fileList].filter((f) => /\.png$/i.test(f.name));
  const loops = [];
  const skipped = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress("reading " + f.name, i / files.length);
    try {
      const img = await imgFromBlob(f);
      const { entries } = Stegassette.decodeContainer(img, img);
      const pairs = pairLoops(entries);
      if (!pairs.length) {
        skipped.push(f.name + ": no loops — not a mix stegassette");
        continue;
      }
      for (const { audio, loop } of pairs) {
        const parsed = Stegassette.parseAudioEntry(audio);
        loops.push({
          loop: normalizeLoop(loop, {
            frames: parsed.channels[0].length,
            sampleRate: parsed.sampleRate,
          }),
          channels: parsed.channels,
          sampleRate: parsed.sampleRate,
          file: f.name,
          pack: pairs.length > 1 ? f.name.replace(/\.png$/i, "") : null,
          blob: f,
        });
      }
    } catch (err) {
      skipped.push(f.name + ": " + err.message);
    }
  }
  onProgress("done", 1);
  return { loops, skipped };
}

// ---- the transport -----------------------------------------

/**
 * A beat clock over an AudioContext.
 *
 * Kept as an anchor rather than a start time so that changing tempo
 * mid-play does not rewrite history: at the moment of the change the
 * current beat is read off the old tempo and becomes the new anchor,
 * so beats already played stay where they were and everything after
 * follows the new rate.
 */
class Transport {
  constructor(audioContext, bpm, anchorTime) {
    this.ctx = audioContext;
    this.bpm = bpm;
    // Beat 0 is where the caller says it is. Anchoring at `currentTime` and
    // then asking for the next grid boundary meant the first thing pressing
    // play did was wait a whole cycle — eight seconds at a grid of 16.
    this.anchorTime = anchorTime ?? audioContext.currentTime;
    this.anchorBeat = 0;
  }
  beatAt(time) {
    return this.anchorBeat + ((time - this.anchorTime) * this.bpm) / 60;
  }
  timeOf(beat) {
    return this.anchorTime + ((beat - this.anchorBeat) * 60) / this.bpm;
  }
  setBpm(bpm, atTime) {
    this.anchorBeat = this.beatAt(atTime);
    this.anchorTime = atTime;
    this.bpm = bpm;
  }
  /**
   * The next boundary at or after `time`, as a beat number.
   *
   * Counted in beats rather than bars: a loop can be any number of beats
   * long, and nothing here needs a time signature to decide when the next
   * one may start.
   */
  nextBoundary(time, beats) {
    const b = this.beatAt(time);
    const n = Math.max(1, beats);
    return Math.ceil(b / n - 1e-9) * n;
  }
}

// ---- a deck ------------------------------------------------

/**
 * One loop in the mix: buffer → pitch engine → gain → drive → filter →
 * pan → master, then the channel's own gain and filter.
 *
 * The pitch engine is one of two. `pitched` is the phase vocoder:
 * tempo is the source's playbackRate, the vocoder is handed the
 * reciprocal so pitch does not follow it, then moved by however many
 * semitones the key match asks for. `tape` is plain resampling: the
 * same playbackRate, and the pitch lands where the rate puts it.
 *
 * Tape is the default for a loop with no mode. Drums have no key to
 * protect, and the vocoder charges percussive material about 9.5 dB
 * and a smear on every transient — the two measured costs this
 * sidesteps. Either engine can be chosen per deck.
 *
 * Both run at the same fixed latency — the vocoder's overlap-add on
 * one side, a plain delay of the same length on the other — so decks
 * on different engines stay locked together.
 */
class Deck {
  constructor(engine, item, output) {
    this.engine = engine;
    this.item = item;
    this.loop = item.loop;
    // Semitones, and any fraction of one. The discrete interval list this
    // replaced could only reach twelve places; a slider reaches all of them
    // and the snaps put you back on the useful ones.
    this.pitchOffset = 0;
    this.tempoFactor = 1;
    // "free" loops at the deck's own length, polyrhythmic against the grid.
    // "grid" retriggers on every grid boundary and plays min(grid, its own
    // span), so a loop shorter than the grid leaves silence after it rather
    // than repeating inside the cycle.
    this.mode = "free";
    this.shots = [];
    this.nextShotBeat = null;
    // Sources handed off by realign(), still sounding until their stop time.
    this.retiring = [];
    this.alignAt = null;
    // Off-unity the vocoder discards the spectrum between peaks, which costs
    // percussive material about 9.5 dB and tonal material about 0.4. Probed
    // per deck, since the number is a property of the audio.
    this.makeupOffRoot = 1;
    this.calibrated = false;
    this.matchKey = true;
    this.gain = 1;
    this.pan = 0;
    this.muted = false;
    this.reversed = false;
    this.source = null;
    this.transformation = null;
    this.tapeDelay = null;
    this.grainNode = null;
    // What sources connect to — the vocoder node or the tape delay.
    // Set by ensureChain() for whichever engine the deck is on.
    this.input = null;
    // What the user asked for ("auto" by default), and what is actually
    // running. Auto decides at every (re)launch, so a mid-play tempo
    // change keeps the current chain until the next restart.
    this.engineChoice = "auto";
    this.pitchMode = this.decideEngine();

    const ctx = engine.ctx;
    this.gainNode = ctx.createGain();
    // Drive sits after the gain, so the fader pushes into it the way a
    // hot channel pushes into an analog stage — and after the makeup,
    // so both engines drive alike at the same knob.
    this.driveNode = ctx.createWaveShaper();
    this.driveNode.oversample = "2x";
    this.drive = 0;
    this.filterNode = ctx.createBiquadFilter();
    this.panNode = ctx.createStereoPanner();
    this.gainNode.connect(this.driveNode);
    this.driveNode.connect(this.filterNode);
    this.filterNode.connect(this.panNode);
    this.panNode.connect(output || engine.master);
    this.filterAt = 0;
    this.resonance = 1;
    this.setFilter(0);
    this.applyGain();

    // The buffer is built at the loop's own sample rate. Where that
    // differs from the context, the source node resamples it — which
    // interpolates across the loop seam, so a mix of loops cut at one
    // rate is fractionally cleaner than a mix of several. The engine
    // adopts the first loop's rate for exactly that reason.
    //
    // It is also rotated so sample 0 is the downbeat, which is what lets a
    // beat range be counted from 0 instead of from `origin`. A range that
    // still runs past the last beat is rotated again, per range, by
    // ensureRange().
    const n = item.channels[0].length;
    const origin = ((this.loop.origin % n) + n) % n;
    this.buffer = ctx.createBuffer(item.channels.length, n, item.sampleRate);
    for (let c = 0; c < item.channels.length; c++) {
      const src = item.channels[c];
      const dst = new Float32Array(n);
      for (let i = 0; i < n; i++) dst[i] = src[(origin + i) % n];
      this.buffer.copyToChannel(dst, c);
    }

    // Which run of the loop's beats plays. The whole thing, by default.
    this.fromBeat = 0;
    this.playBeats = this.loop.beats;
    // Filled by ensureRange(), keyed on the pair above.
    this.rangeKey = null;
    this.rangeBuffer = null;
    this.rangeStart = 0;
    this.rangeEnd = 0;
  }

  /** Key match plus whatever interval the deck was told to take. */
  get semitones() {
    if (this.pitchMode === "tape") return 0;
    const match = this.matchKey
      ? matchSemitones(this.loop, this.engine.key, this.engine.keyMatch)
      : 0;
    return match + this.pitchOffset;
  }

  /** Where the key match alone would put this deck. */
  get matchSemitones() {
    if (this.pitchMode === "tape") return 0;
    return this.matchKey
      ? matchSemitones(this.loop, this.engine.key, this.engine.keyMatch)
      : 0;
  }

  setPitchOffset(v) {
    this.pitchOffset = Math.max(-24, Math.min(24, v));
    this.refresh();
    return this.pitchOffset;
  }

  /** Nearest whole semitone — still a musical interval, just not in tune. */
  snapPitchToSemitone() {
    return this.setPitchOffset(Math.round(this.pitchOffset));
  }

  /**
   * Nearest octave, which is the nearest offset that leaves the deck in tune
   * with the mix: the key match already put it there, and octaves are the
   * only moves that keep it. Snapping to 0 would drag a deck you had pushed
   * an octave up back down; this keeps the octave you are near.
   */
  snapPitchToTune() {
    return this.setPitchOffset(Math.round(this.pitchOffset / 12) * 12);
  }

  get inTune() {
    return (
      Math.abs(this.pitchOffset / 12 - Math.round(this.pitchOffset / 12)) < 1e-6
    );
  }

  /** On tape, the pitch the rate implies — the only pitch the deck has. */
  get tapeSemitones() {
    return 12 * Math.log2(this.rate);
  }

  /**
   * What tape would cost this deck right now: the gap between the pitch
   * the rate imposes and the pitch the mix wants, in semitones.
   */
  get tapeErrorSemitones() {
    const match = this.matchKey
      ? matchSemitones(this.loop, this.engine.key, this.engine.keyMatch)
      : 0;
    return Math.abs(this.tapeSemitones - (match + this.pitchOffset));
  }

  /**
   * The engine auto runs: tape when the correction it skips is under
   * AUTO_TAPE_ST — nothing beats no processing. Past that, the material
   * decides: percussive loops take grain, whose grains pass transients
   * whole, and tonal loops take the vocoder, which holds a chord
   * together. An explicit choice is just itself.
   */
  decideEngine() {
    if (this.engineChoice !== "auto") return this.engineChoice;
    if (this.tapeErrorSemitones <= AUTO_TAPE_ST) return "tape";
    return String(this.loop.mode).toLowerCase() === "none"
      ? "grain"
      : "pitched";
  }

  /**
   * The tempo this deck is read at, which is its own unless told otherwise.
   *
   * Tempo is octave-ambiguous, and a loop can arrive labelled at twice or
   * half what the mix wants — either because whoever made it tapped it that
   * way, or because detection picked the other reading. Matching it then
   * costs a rate of 0.5 or 2.0, which is a lot of vocoder for a loop that
   * would sit at 1.0 read the other way.
   */
  get sourceBpm() {
    return this.loop.bpm * this.tempoFactor;
  }

  /**
   * How long this deck's cycle is in the mix's beats. A deck read at double
   * time covers twice the ground per beat of its own, so its eight beats
   * span sixteen of the mix's.
   */
  get spanInMixBeats() {
    return this.playBeats * this.tempoFactor;
  }

  /**
   * Where this deck sits in its cycle, counted in the MIX's beats.
   *
   * Counted that way on purpose: a deck's own beats run at its own rate, so
   * two decks measured in their own beats advance at different speeds and a
   * display of them cannot be read against each other. In mix beats every
   * deck steps together and a shared left edge means what it looks like.
   *
   * Null before the deck starts. Computed from the schedule rather than
   * tracked, so it costs nothing to ask every frame.
   */
  positionAt(time) {
    if ((!this.source && !this.shots.length) || this.startedAt == null)
      return null;
    if (time < this.startedAt) return null;
    const span = this.spanInMixBeats;
    if (span <= 0) return null;
    // Once a realign lands, the boundary it landed on is the phase.
    const anchor =
      this.alignAt != null && time >= this.alignAt
        ? this.alignAt
        : this.startedAt;
    const elapsed = ((time - anchor) * this.engine.bpm) / 60;
    const into = ((elapsed % span) + span) % span;
    return { beat: Math.floor(into), fraction: into % 1, beats: span };
  }

  /** Frames per beat in the rotated buffer. */
  get framesPerBeat() {
    return this.buffer.length / Math.max(1, this.loop.beats);
  }

  /**
   * Play a run of the loop's beats instead of all of them.
   *
   * The count is a whole number of beats, so a shortened deck still
   * repeats on the mix's grid. Changing it while running restarts the
   * deck on the next bar: moving the loop points under a playing source
   * wraps it wherever the playhead happens to be, which lands mid-beat
   * and costs the phase everything else is holding.
   */
  setRange(fromBeat, playBeats) {
    const total = this.loop.beats;
    const count = Math.max(1, Math.min(total, Math.round(playBeats)));
    // The first beat is free to be any of them. A run that reaches past the
    // last beat wraps to the first, which is the whole point of a loop that
    // closes: beats 12 to 4 of a 16-beat loop is a real thing to ask for.
    const from = ((Math.round(fromBeat) % total) + total) % total;
    const changed = from !== this.fromBeat || count !== this.playBeats;
    this.fromBeat = from;
    this.playBeats = count;
    if (changed && this.source) this.engine.restartDeck(this);
    return { fromBeat: from, playBeats: count };
  }

  /** How fast the source runs to sit at the mix tempo. */
  get rate() {
    return this.engine.bpm / this.sourceBpm;
  }

  /** The octave of this deck's own tempo that runs closest to ×1. */
  bestTempoFactor() {
    let best = 1;
    let bestErr = Infinity;
    for (const f of [0.25, 0.5, 1, 2, 4]) {
      const err = Math.abs(Math.log2(this.engine.bpm / (this.loop.bpm * f)));
      if (err < bestErr) {
        bestErr = err;
        best = f;
      }
    }
    return best;
  }

  /**
   * Halve or double how this deck is read. The audio is untouched; only the
   * tempo it claims changes, so a 16-beat loop at half time spans 8 of the
   * mix's beats and at double time spans 32.
   */
  setTempoFactor(factor) {
    const next = Math.min(8, Math.max(0.125, factor));
    if (next === this.tempoFactor) return this.tempoFactor;
    this.tempoFactor = next;
    // A rate change mid-cycle moves where this deck's loop boundary lands
    // and never puts it back: its span in mix beats has changed, so the
    // fraction it is through the buffer now means a different number of
    // beats than it did a moment ago. Everything else stays on the grid and
    // this deck does not. Restarting on the next bar is the only way back.
    if (this.source) this.engine.restartDeck(this);
    else this.refresh();
    return this.tempoFactor;
  }

  applyGain() {
    // The makeup pays back what the vocoder discards off-unity. The
    // vocoder is transparent only when its factor is exactly 1 — when the
    // semitones it applies equal the pitch the rate already imposed. So
    // the makeup follows the factor, not the key shift alone: a deck
    // synced a few bpm with no key change is off-unity too, and it was
    // exactly the deck the old gate left quiet. Tape discards nothing and
    // pays nothing back.
    const engaged =
      this.pitchMode === "pitched" &&
      Math.abs(this.semitones - this.tapeSemitones) > 1e-3;
    const makeup = engaged ? this.makeupOffRoot : 1;
    const g = this.muted ? 0 : this.gain * (this.loop.gain ?? 1) * makeup;
    this.gainNode.gain.value = g;
    this.panNode.pan.value = this.pan;
  }

  setPan(p) {
    this.pan = Math.max(-1, Math.min(1, p));
    this.applyGain();
    return this.pan;
  }

  /** Same shape as the channel filter: bypassed at centre, sweeping both ways. */
  setFilter(x) {
    const v = Math.max(-1, Math.min(1, x));
    this.filterAt = v;
    if (v < 0) {
      this.filterNode.type = "lowpass";
      this.filterNode.frequency.value = 20000 * Math.pow(120 / 20000, -v);
    } else if (v > 0) {
      this.filterNode.type = "highpass";
      this.filterNode.frequency.value = 20 * Math.pow(6000 / 20, v);
    } else {
      this.filterNode.type = "lowpass";
      this.filterNode.frequency.value = 20000;
    }
    this.filterNode.Q.value = v === 0 ? 0.0001 : this.resonance;
    return v;
  }

  setResonance(q) {
    this.resonance = Math.max(0.0001, Math.min(18, q));
    return this.setFilter(this.filterAt);
  }

  filterLabel() {
    if (this.filterAt === 0) return "off";
    const hz = this.filterNode.frequency.value;
    return (
      (this.filterAt < 0 ? "LP " : "HP ") +
      (hz >= 1000 ? (hz / 1000).toFixed(1) + "k" : Math.round(hz))
    );
  }

  /**
   * Soft-clip drive, 0 to 1. A tanh curve normalized to keep its peak at
   * 1, so turning it up thickens rather than just louder. At 0 the
   * shaper has no curve at all and passes samples through untouched.
   */
  setDrive(v) {
    this.drive = Math.max(0, Math.min(1, v));
    if (!this.drive) {
      this.driveNode.curve = null;
      return this.drive;
    }
    const k = 1 + this.drive * 24;
    const n = 1025;
    const curve = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    this.driveNode.curve = curve;
    return this.drive;
  }

  /**
   * Play the loop backwards. The buffer is reversed in place — exact for
   * floats, so two toggles give back the original samples — and the beat
   * range cache dropped, since it points into the old order. A playing
   * deck restarts on the next bar.
   */
  setReversed(v) {
    const next = !!v;
    if (next === this.reversed) return this.reversed;
    this.reversed = next;
    for (let c = 0; c < this.buffer.numberOfChannels; c++)
      this.buffer.getChannelData(c).reverse();
    this.rangeKey = null;
    this.rangeBuffer = null;
    if (this.source || this.shots.length) this.engine.restartDeck(this);
    return next;
  }

  /**
   * Choose the engine: auto, pitched or tape. A playing deck restarts on
   * the next bar, because the engines run different node chains and a
   * swap mid-cycle would drop or double the fixed latency for part of a
   * beat.
   */
  setEngineChoice(mode) {
    const next = ["pitched", "tape", "grain"].includes(mode) ? mode : "auto";
    if (next === this.engineChoice) return next;
    this.engineChoice = next;
    // Nothing schedules into a stale chain while the restart is in flight.
    this.input = null;
    this.pitchMode = this.decideEngine();
    this.applyGain();
    if (this.source || this.shots.length) this.engine.restartDeck(this);
    return next;
  }

  /**
   * The node chain for the deck's engine, built once each and kept.
   *
   * Pitched: the vocoder. Both modes feed the same node — grid mode
   * connects a fresh source per shot and free mode one looping source,
   * and neither wants a new worklet each time it restarts.
   *
   * Tape: a delay of exactly the vocoder's overlap-add, so the two
   * engines land every sample at the same time.
   */
  async ensureChain() {
    const ctx = this.engine.ctx;
    this.pitchMode = this.decideEngine();
    if (this.pitchMode === "tape") {
      if (!this.tapeDelay) {
        this.tapeDelay = ctx.createDelay(0.5);
        this.tapeDelay.delayTime.value = VOCODER_FRAMES / ctx.sampleRate;
        this.tapeDelay.connect(this.gainNode);
      }
      this.input = this.tapeDelay;
      return;
    }
    if (this.pitchMode === "grain") {
      if (!this.engine.grainReady) {
        await ctx.audioWorklet.addModule(
          new URL("./grain-processor.js", import.meta.url)
        );
        this.engine.grainReady = true;
      }
      if (!this.grainNode) {
        this.grainNode = new AudioWorkletNode(ctx, "grain-shifter", {
          outputChannelCount: [this.buffer.numberOfChannels],
        });
        this.grainNode.connect(this.gainNode);
      }
      this.input = this.grainNode;
      this.refresh();
      return;
    }
    // The makeup probe is a vocoder cost, measured the first time the
    // vocoder is actually the engine. Not awaited: the deck plays while
    // it renders.
    if (!this.calibrated) this.calibrateMakeup();
    if (!this.transformation) {
      // The placeholder gets a real, correctly-shaped buffer rather than
      // nothing. A source with no buffer has no channel count, and a worklet
      // node sizes its output from whatever is connected when it is built —
      // so a bufferless placeholder can fix that at zero and stay there after
      // the real source arrives.
      const placeholder = ctx.createBufferSource();
      placeholder.buffer = ctx.createBuffer(
        this.buffer.numberOfChannels,
        128,
        ctx.sampleRate
      );
      // Looping and started, not merely connected. A source that never starts
      // produces nothing, and WebKit represents an input with nothing on it as
      // having no channels — which the overlap-add then allocates for. Silent
      // audio is still audio: it holds the input at the right channel count
      // for as long as the deck exists.
      placeholder.loop = true;
      placeholder.start();
      const transformation = new SoundTransformationLib.SoundTransformation({
        audioContext: ctx,
      });
      await transformation.initialize({
        audioBuffer: placeholder,
        processorJSPath: this.engine.workletURL,
        bpm: this.sourceBpm,
        destination: this.gainNode,
      });
      this.transformation = transformation;
    }
    this.input = this.transformation.phaseVocoderNode;
    this.refresh();
  }

  /** min(grid, this deck's span), in mix beats — what grid mode sounds. */
  get soundingBeats() {
    return Math.min(this.engine.grid, this.spanInMixBeats);
  }

  /**
   * Queue grid-mode shots out to `until`. Each is its own source feeding the
   * same chain, started on a grid boundary and stopped after
   * min(grid, span) beats, so a loop shorter than the grid leaves silence
   * instead of repeating inside the cycle.
   */
  scheduleUntil(until) {
    const ctx = this.engine.ctx;
    this.retiring = this.retiring.filter((r) => r.until > ctx.currentTime);
    if (this.mode !== "grid" || !this.input) return;
    const T = this.engine.transport;
    if (this.nextShotBeat == null)
      this.nextShotBeat = T.nextBoundary(
        ctx.currentTime + 0.05,
        this.engine.grid
      );
    let guard = 0;
    while (T.timeOf(this.nextShotBeat) < until && guard++ < 32) {
      this.fireShot(T.timeOf(this.nextShotBeat));
      this.nextShotBeat += this.engine.grid;
    }
    this.shots = this.shots.filter((s) => s.until > ctx.currentTime - 0.5);
  }

  fireShot(when) {
    this.ensureRange();
    const ctx = this.engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.rangeBuffer;
    src.playbackRate.value = this.rate;
    src.connect(this.input);
    const seconds = (this.soundingBeats * 60) / this.engine.bpm;
    src.start(when, this.rangeStart);
    src.stop(when + seconds);
    this.shots.push({ src, at: when, until: when + seconds });
    if (this.startedAt == null) this.startedAt = when;
  }

  setMode(mode) {
    const next = mode === "grid" ? "grid" : "free";
    if (next === this.mode) return this.mode;
    this.mode = next;
    if (this.source || this.shots.length) this.engine.restartDeck(this);
    return this.mode;
  }

  /**
   * How loud this deck's audio comes back off-unity, measured rather than
   * assumed: the loss is a property of the material, roughly 0.4 dB on
   * sustained tones and 9.5 dB on drums. Rendered once against a second and
   * a half of its own loop. Only the vocoder needs it, so a tape deck
   * defers the probe until its first switch to pitched.
   */
  async calibrateMakeup() {
    this.calibrated = true;
    try {
      const rate = this.buffer.sampleRate;
      const n = Math.min(this.buffer.length, Math.round(rate * 1.5));
      const dry = this.buffer.getChannelData(0).subarray(0, n);
      let dryRms = 0;
      for (let i = 0; i < n; i++) dryRms += dry[i] * dry[i];
      dryRms = Math.sqrt(dryRms / n);
      if (!dryRms) return 1;

      const ctx = new OfflineAudioContext(1, n * 2, rate);
      await ctx.audioWorklet.addModule(this.engine.workletURL);
      const buf = ctx.createBuffer(1, this.buffer.length, rate);
      buf.copyToChannel(this.buffer.getChannelData(0), 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const node = new AudioWorkletNode(ctx, "phase-vocoder-processor");
      // a third of a tone is enough to leave unity, where it is transparent
      node.parameters.get("pitchFactor").value = Math.pow(2, 3 / 12);
      src.connect(node);
      node.connect(ctx.destination);
      src.start(0);
      const out = (await ctx.startRendering())
        .getChannelData(0)
        .subarray(n, n * 2);
      let wetRms = 0;
      for (let i = 0; i < out.length; i++) wetRms += out[i] * out[i];
      wetRms = Math.sqrt(wetRms / out.length);
      if (!wetRms) return 1;
      this.makeupOffRoot = Math.max(0.5, Math.min(8, dryRms / wetRms));
      this.applyGain();
    } catch (_) {
      this.makeupOffRoot = 1;
    }
    return this.makeupOffRoot;
  }

  /**
   * The buffer a source reads for the current beat range, and where the
   * range starts and ends inside it. Cached: recomputed only when the
   * range changes.
   *
   * A run that stays inside the loop is just loop points on the deck's own
   * buffer. One that runs past the last beat cannot be — loopStart and
   * loopEnd do not wrap — so it gets a rotated copy instead. That is the
   * only reason the copy exists, and the common case never pays for it.
   */
  ensureRange() {
    const key = `${this.fromBeat}:${this.playBeats}`;
    if (this.rangeKey === key) return;
    this.rangeKey = key;
    const fpb = this.framesPerBeat;
    const rate = this.buffer.sampleRate;
    const n = this.buffer.length;
    if (this.fromBeat + this.playBeats <= this.loop.beats) {
      this.rangeBuffer = this.buffer;
      this.rangeStart = Math.round(this.fromBeat * fpb) / rate;
      this.rangeEnd = Math.round((this.fromBeat + this.playBeats) * fpb) / rate;
      return;
    }
    const shift = Math.round(this.fromBeat * fpb) % n;
    const rotated = this.engine.ctx.createBuffer(
      this.buffer.numberOfChannels,
      n,
      rate
    );
    const src = new Float32Array(n);
    const dst = new Float32Array(n);
    for (let c = 0; c < this.buffer.numberOfChannels; c++) {
      this.buffer.copyFromChannel(src, c);
      for (let i = 0; i < n; i++) dst[i] = src[(shift + i) % n];
      rotated.copyToChannel(dst, c);
    }
    this.rangeBuffer = rotated;
    this.rangeStart = 0;
    this.rangeEnd = Math.round(this.playBeats * fpb) / rate;
  }

  /** A looping source over the deck's beat range, not yet started. */
  makeSource() {
    this.ensureRange();
    const src = this.engine.ctx.createBufferSource();
    src.buffer = this.rangeBuffer;
    src.loop = true;
    src.loopStart = this.rangeStart;
    src.loopEnd = this.rangeEnd;
    return src;
  }

  /**
   * Put beat 1 back on the next grid boundary, without a gap.
   *
   * A free deck loops at its own length, so unless that length divides the
   * grid its downbeat walks away from the mix's — by design, and the reason
   * to reach for this is that you want it back. Restarting would drop the
   * deck out for up to a whole cycle, so instead the running source is told
   * to stop at the boundary and a fresh one to start on it. Both edges are
   * one scheduled sample, and nothing is silent in between.
   *
   * Grid decks retrigger on the boundary already; there is nothing to do.
   *
   * Returns the context time it lands on, or null if there is nothing
   * playing to move.
   */
  realign() {
    if (!this.engine.playing || !this.input) return null;
    if (this.mode === "grid" || !this.source) return null;
    const ctx = this.engine.ctx;
    const T = this.engine.transport;
    const when = T.timeOf(
      T.nextBoundary(ctx.currentTime + 0.15, this.engine.grid)
    );

    const source = this.makeSource();
    source.connect(this.input);

    try {
      this.source.stop(when);
    } catch (_) {}
    this.retiring.push({ src: this.source, until: when });

    // Hand the chain the new source before refresh(), so the rate it
    // writes lands on the one about to play.
    this.source = source;
    if (this.transformation && this.pitchMode === "pitched")
      this.transformation.audioBuffer = source;
    this.refresh();
    source.start(when, source.loopStart);
    this.alignAt = when;
    return when;
  }

  /**
   * Start on the downbeat of beat `beat`.
   *
   * `origin` is where beat 1 lives inside the loop, so starting the
   * source at that offset with loop points spanning the whole buffer
   * rotates the loop: it plays origin→end, then end wraps to 0 and it
   * runs 0→end from there. For a perfect loop that is sample-for-sample
   * the same stream as a circular read, and the downbeat lands exactly
   * on `beat`.
   */
  async start(beat) {
    const ctx = this.engine.ctx;
    await this.ensureChain();
    this.alignAt = null;
    if (this.mode === "grid") {
      this.startedAt = null;
      this.nextShotBeat = Math.max(
        beat,
        this.engine.transport.nextBoundary(
          ctx.currentTime + 0.05,
          this.engine.grid
        )
      );
      this.startedAt = this.engine.transport.timeOf(this.nextShotBeat);
      this.scheduleUntil(ctx.currentTime + 0.3);
      return;
    }
    const source = this.makeSource();
    if (this.pitchMode === "pitched") this.transformation.audioBuffer = source;
    source.connect(this.input);
    this.source = source;
    this.refresh();

    // Awaiting the chain above can cross a bar line on a cold start.
    // Take the next one rather than a time already gone.
    let when = this.engine.transport.timeOf(beat);
    if (when < ctx.currentTime + 0.02) {
      when = this.engine.transport.timeOf(
        this.engine.transport.nextBoundary(
          ctx.currentTime + 0.05,
          this.engine.grid
        )
      );
    }
    source.start(when, source.loopStart);
    this.startedAt = when;
  }

  /**
   * Re-read tempo and key off the engine. Cheap; call it on any change.
   * `when` schedules the writes at a context time so a whole mix changes
   * tempo at one instant rather than at whatever quantum each call lands on.
   */
  refresh(when) {
    if (this.pitchMode === "tape" || this.pitchMode === "grain") {
      // No transformation to talk to: the sources carry the rate, and
      // grain takes its factor as a parameter — the reciprocal of the
      // rate so pitch does not follow it, moved by the key match.
      const targets = [this.source, ...this.shots.map((s) => s.src)].filter(
        Boolean
      );
      for (const src of targets)
        if (when == null) src.playbackRate.value = this.rate;
        else src.playbackRate.setValueAtTime(this.rate, when);
      if (this.pitchMode === "grain" && this.grainNode) {
        const f = Math.pow(2, this.semitones / 12) / this.rate;
        const param = this.grainNode.parameters.get("pitchFactor");
        if (when == null) param.value = f;
        else param.setValueAtTime(f, when);
      }
      this.applyGain();
      return;
    }
    if (!this.transformation) return;
    // adjustSpeedToBPM is a ratio against the tempo the transformation was
    // initialized with, so a changed factor has to be written there too.
    this.transformation.bpm = this.sourceBpm;
    this.transformation.adjustSpeedToBPM(this.engine.bpm, when);
    this.transformation.adjustPitchBySemitones(this.semitones, when);
    // adjustSpeedToBPM writes the rate onto the transformation's own source;
    // grid mode's shots are separate nodes and need it as well.
    for (const shot of this.shots)
      if (when == null) shot.src.playbackRate.value = this.rate;
      else shot.src.playbackRate.setValueAtTime(this.rate, when);
    // the makeup follows the shift, and refresh is what changes the shift
    this.applyGain();
  }

  stop() {
    for (const s of this.shots)
      try {
        s.src.stop();
      } catch (_) {}
    this.shots = [];
    for (const r of this.retiring)
      try {
        r.src.stop();
      } catch (_) {}
    this.retiring = [];
    this.nextShotBeat = null;
    this.alignAt = null;
    try {
      this.source?.stop();
    } catch (_) {}
    this.source = null;
  }

  dispose() {
    this.stop();
    this.transformation?.dispose();
    this.transformation = null;
    this.tapeDelay?.disconnect();
    this.tapeDelay = null;
    this.grainNode?.disconnect();
    this.grainNode = null;
    this.input = null;
    this.gainNode.disconnect();
    this.driveNode.disconnect();
    this.filterNode.disconnect();
    this.panNode.disconnect();
  }
}

// ---- the engine --------------------------------------------

/**
 * The mix: a target tempo, a target key, and any number of decks
 * locked to both.
 *
 * Adding a loop while it is running is the normal case, so a deck
 * always starts on a bar line rather than immediately. Loops of
 * different lengths — one bar against four — come back into phase on
 * their own, because each one's cycle is a whole number of beats by
 * construction.
 */
class Engine {
  /** Every deck on every channel, in channel order. */
  get decks() {
    return ["a", "b"].flatMap((id) => this.channels[id].decks);
  }

  constructor({ workletURL, sampleRate }) {
    // Asking for the loop's own rate keeps the seam off a resampler, but not
    // every browser will grant an arbitrary one. Falling back costs a
    // resample; throwing costs the whole mixer.
    try {
      this.ctx = new AudioContext(sampleRate ? { sampleRate } : undefined);
    } catch (_) {
      this.ctx = new AudioContext();
    }
    this.workletURL = workletURL;
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.bpm = 120;
    this.key = { root: "C", mode: "major" };
    this.keyMatch = "scale";
    // The global cycle, in beats. Everything launches and relaunches on a
    // multiple of it, so a set is phrase-aligned at 16 and immediate at 1.
    // Bars are not involved: a loop can be any number of beats long.
    this.grid = 4;
    // Only an accent in the beat display; nothing schedules against it.
    this.meter = 4;
    this.playing = false;
    this.transport = new Transport(this.ctx, this.bpm);
    this.channels = {};
    for (const id of ["a", "b"]) {
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      gain.connect(filter);
      filter.connect(this.master);
      this.channels[id] = {
        id,
        gain,
        filter,
        decks: [],
        filterAt: 0,
        resonance: 1,
      };
      this.setFilter(id, 0);
    }
    this.crossfade = 0.5;
    this.setCrossfade(0.5);
  }

  /**
   * Stack a loop onto a channel. The same loop can sit on both channels, or
   * twice on one: each deck is its own source with its own tempo, pitch and
   * beat range, so two of them are two voices rather than one played twice.
   */
  async add(channelId, item) {
    const ch = this.channels[channelId];
    if (!ch || !item) return null;
    const deck = new Deck(this, item, ch.gain);
    deck.channelId = channelId;
    ch.decks.push(deck);
    if (this.playing) await this.startDeck(deck);
    return deck;
  }

  remove(deck) {
    const ch = this.channels[deck.channelId];
    if (!ch) return;
    deck.dispose();
    ch.decks = ch.decks.filter((d) => d !== deck);
  }

  clearChannel(channelId) {
    const ch = this.channels[channelId];
    if (!ch) return;
    for (const d of ch.decks) d.dispose();
    ch.decks = [];
  }

  /**
   * Equal power, so the pair sums to a constant through the sweep. A linear
   * fader dips ~3 dB in the middle, which reads as the mix losing energy
   * exactly where both loops should be sitting together.
   */
  setCrossfade(x) {
    this.crossfade = Math.max(0, Math.min(1, x));
    this.channels.a.gain.gain.value = Math.cos((this.crossfade * Math.PI) / 2);
    this.channels.b.gain.gain.value = Math.sin((this.crossfade * Math.PI) / 2);
  }

  /**
   * Queue grid-mode shots a little ahead of the audio thread. 25 ms of
   * timer against 300 ms of lookahead: the timer can be late by an order of
   * magnitude and still never miss a boundary.
   */
  pump() {
    const until = this.ctx.currentTime + 0.3;
    for (const d of this.decks) d.scheduleUntil(until);
  }

  async start() {
    if (this.playing) return;
    await this.ctx.resume();
    // Load every chain before the clock is set, so the unpredictable part
    // is behind us and the lead can be short. Doing this inside start() is
    // what forced a long lead, and a long lead is what a grid boundary
    // rounded up into a whole cycle of waiting.
    await Promise.all(this.decks.map((d) => d.ensureChain()));
    this.playing = true;
    const at = this.ctx.currentTime + 0.12;
    this.transport = new Transport(this.ctx, this.bpm, at);
    // Beat 0 is now, so play starts on press. Decks joining a running mix
    // still wait for the next boundary — that is a different question.
    await Promise.all(this.decks.map((d) => d.start(0)));
    clearInterval(this.pumpTimer);
    this.pumpTimer = setInterval(() => this.pump(), 25);
  }

  /**
   * Put every free deck's beat 1 back on the next grid boundary — the
   * one sync control, instead of one per deck. Grid decks already start
   * on boundaries and are left alone. Returns the context time the move
   * lands on, or null if nothing needed moving.
   */
  realignAll() {
    let when = null;
    for (const d of this.decks) {
      const w = d.realign();
      if (w != null) when = w;
    }
    return when;
  }

  /** Start one deck into a mix already running, on the next bar. */
  async startDeck(deck) {
    if (!this.playing) return;
    const beat = this.transport.nextBoundary(
      this.ctx.currentTime + 0.15,
      this.grid
    );
    await deck.start(beat);
  }

  /** Stop and re-launch a deck on the next bar, keeping it on the grid. */
  async restartDeck(deck) {
    if (!this.playing) return;
    deck.stop();
    await this.startDeck(deck);
  }

  stop() {
    clearInterval(this.pumpTimer);
    this.pumpTimer = null;
    for (const d of this.decks) d.stop();
    this.playing = false;
  }

  /**
   * Move the whole mix to a new tempo.
   *
   * Every deck's playbackRate is written in this one synchronous pass,
   * so they all take effect on the same render quantum and the decks
   * stay in phase with each other. The transport is re-anchored at the
   * same instant.
   */
  setBpm(bpm) {
    // Far enough ahead that the audio thread has not passed it, so the
    // scheduled writes and the clock's new anchor are the same instant.
    // Writing "now" lands on the next render quantum instead — up to 2.9 ms
    // later than the transport thinks, charged again on every change.
    const at = this.ctx.currentTime + 0.06;
    this.bpm = bpm;
    this.transport.setBpm(bpm, at);
    for (const d of this.decks) d.refresh(at);
  }

  setKey(key) {
    this.key = key;
    for (const d of this.decks) d.refresh();
  }

  setKeyMatch(how) {
    this.keyMatch = how;
    for (const d of this.decks) d.refresh();
  }

  /**
   * One knob per channel, bypassed at the centre and sweeping either way:
   * low-pass closing down to the left, high-pass opening up to the right.
   *
   * Both directions are the same biquad with its type switched, so there is
   * no crossfade between two filters to click on. At 0 it is a low-pass at
   * 20 kHz, which is above anything in the signal and therefore audibly
   * nothing.
   *
   * Frequency moves exponentially because pitch does: a linear sweep spends
   * most of its travel in the top octave, where nothing much is happening.
   */
  setFilter(channelId, x) {
    const ch = this.channels[channelId];
    if (!ch) return 0;
    const v = Math.max(-1, Math.min(1, x));
    ch.filterAt = v;
    if (v < 0) {
      ch.filter.type = "lowpass";
      ch.filter.frequency.value = 20000 * Math.pow(120 / 20000, -v);
    } else if (v > 0) {
      ch.filter.type = "highpass";
      ch.filter.frequency.value = 20 * Math.pow(6000 / 20, v);
    } else {
      ch.filter.type = "lowpass";
      ch.filter.frequency.value = 20000;
    }
    // Resonance only where the filter is doing something, so the centre is
    // flat however the knob beside it is set.
    ch.filter.Q.value = v === 0 ? 0.0001 : ch.resonance;
    return v;
  }

  setResonance(channelId, q) {
    const ch = this.channels[channelId];
    if (!ch) return 1;
    ch.resonance = Math.max(0.0001, Math.min(18, q));
    this.setFilter(channelId, ch.filterAt);
    return ch.resonance;
  }

  /** What the filter is doing, for a readout. */
  filterLabel(channelId) {
    const ch = this.channels[channelId];
    if (!ch || ch.filterAt === 0) return "off";
    const hz = ch.filter.frequency.value;
    return (
      (ch.filterAt < 0 ? "low-pass " : "high-pass ") +
      (hz >= 1000 ? (hz / 1000).toFixed(1) + " kHz" : Math.round(hz) + " Hz")
    );
  }

  /**
   * Conform the mix to one deck: its tempo becomes the mix tempo and its key
   * the mix key, so it lands at ×1.000 and no transposition. Every other
   * deck then takes the octave of its own tempo that sits closest to ×1 and
   * turns key matching on.
   *
   * Approximate on purpose. A loop at 93 bpm against one at 120 has no
   * octave that makes it ×1, and the nearest is still the reading that
   * stretches it least.
   */
  syncAllTo(deck) {
    if (!deck) return;
    this.setKey({ root: deck.loop.root, mode: deck.loop.mode });
    this.setBpm(Math.round(deck.sourceBpm * 100) / 100);
    for (const d of this.decks) {
      if (d !== deck) d.tempoFactor = d.bestTempoFactor();
      d.matchKey = true;
      d.pitchOffset = 0;
    }
    // Rates changed, so everything has to come back on the grid together.
    for (const d of this.decks)
      if (d.source || d.shots.length) this.restartDeck(d);
    return this.bpm;
  }

  setGrid(beats) {
    this.grid = Math.max(1, Math.min(64, Math.round(beats)));
    return this.grid;
  }

  /**
   * Record the mix for `beats` beats, starting sample-accurately on the
   * next grid boundary: exactly what the master sends the speakers,
   * taken as PCM. The recorder worklet is handed frame numbers, not
   * times, so the window cannot miss by a scheduling wobble.
   */
  async capture(beats) {
    if (!this.playing) throw new Error("play first — a capture records the mix");
    const ctx = this.ctx;
    if (!this.recorderReady) {
      await ctx.audioWorklet.addModule(
        new URL("./recorder-processor.js", import.meta.url)
      );
      this.recorderReady = true;
    }
    const node = new AudioWorkletNode(ctx, "mix-recorder");
    const startBeat = this.transport.nextBoundary(
      ctx.currentTime + 0.1,
      this.grid
    );
    const startFrame = Math.round(
      this.transport.timeOf(startBeat) * ctx.sampleRate
    );
    const frames = Math.round((beats * 60 * ctx.sampleRate) / this.bpm);
    const done = new Promise((res) => (node.port.onmessage = (e) => res(e.data)));
    node.port.postMessage({ startFrame, frames });
    this.master.connect(node);
    // A worklet is only pulled when something downstream needs it; its
    // output is silence, so the destination hears nothing extra.
    node.connect(ctx.destination);
    const data = await done;
    this.master.disconnect(node);
    node.disconnect();
    return {
      channels: data.channels.map((b) => new Float32Array(b)),
      sampleRate: ctx.sampleRate,
      frames,
    };
  }

  setMasterGain(g) {
    this.master.gain.value = g;
  }

  dispose() {
    clearInterval(this.pumpTimer);
    for (const d of this.decks) d.dispose();
    for (const id of ["a", "b"]) this.channels[id].decks = [];
    this.ctx.close();
  }
}

export { imgFromBlob, read, Transport, Deck, Engine, VOCODER_FRAMES };
