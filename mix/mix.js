"use strict";
/* ============================================================
   mix.js — the stega-mix format, and the engine that plays it.

   A mix stegassette is one seamlessly looping bar of music that knows
   what it is: a plain STGC PNG carrying two entries.

     [0] the audio      raw PCM, audio/L16; rate=…; channels=…
     [1] loop.json      tempo, key, and where the downbeat sits

   The audio comes FIRST, so a player that has never heard of stega-mix
   opens the stegassette on it — drop one into the plain stega-now player
   and it plays the loop while the picture develops out of its own
   pixels. This is the stegassette format with one entry added.

   loop.json:

     { "format": "stega-mix/1",
       "title": "hazy rhodes", "artist": "",
       "beats": 8, "meter": 4,          musical length
       "bpm": 92.0031…,                 DERIVED — see below
       "root": "F", "mode": "minor",    the key it is in
       "sampleRate": 44100,
       "frames": 220500,                the perfect loop, exactly
       "origin": 3241,                  where beat 1 is
       "gain": 1 }

   Two fields do the work.

   `frames` is the loop, to the sample. `bpm` is not measured and not
   typed in: it is DERIVED as beats × 60 × sampleRate ÷ frames, so a
   loop can never disagree with its own metadata. Round-tripping a
   number that was measured would let a 4-bar loop drift a millisecond
   per cycle against a mix; deriving it means the tempo IS the file
   length, and stacking N loops for an hour cannot pull them apart.

   `origin` is the sample index of beat 1 *inside* the loop, and exists
   because a perfect loop and a loop that begins at zero are different
   things. A phrase with a pickup, a reversed swell that leads into the
   downbeat, a snare that rings past the bar line and wraps around to
   the top — all of them loop perfectly while their first beat sits
   somewhere after sample 0. Playback starts at `origin` and wraps at
   the end, which for a perfect loop is the same audio as rotating the
   buffer, so the downbeat lands where the mix wants it and the seam
   stays where the author put it.

   Section 3.8 of the description calls this configuration a
   synchronized loop library. This is that.
   ============================================================ */

const Mix = (() => {
  const FORMAT = "stega-mix/1";
  const LOOP_ENTRY = "loop.json";

  // The codec's collection default: `veil` is a gentle combine, so the
  // artwork stays legible under a full bar of audio. A build can pick
  // anything the format offers.
  const STEG = Stegassette.COLLECTION_STEG;
  const METHODS = {
    combine: Stegassette.COMBINE_NAMES,
    traversal: Stegassette.TRAVERSAL_NAMES,
    keymap: Stegassette.KEYMAP_NAMES,
  };

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const { slug, toBase64: b64 } = Stegassette;

  // ---- pitch classes -----------------------------------------
  // Twelve names and modular arithmetic. @amplib/music-theory does this
  // properly — Scale, Mode, Note, the lot — but it has no IIFE build and
  // this page has no bundler, so vendoring a whole theory library to
  // subtract two numbers mod 12 would cost more than it explains.

  const NOTES = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
  ];
  // Flats spell the same twelve pitches. Accepted on the way in, never
  // written on the way out, so two loops in the same key always compare
  // equal whichever way they were typed.
  const ENHARMONIC = {
    DB: "C#", EB: "D#", FB: "E", GB: "F#", AB: "G#", BB: "A#", CB: "B",
    "E#": "F", "B#": "C",
  };

  /**
   * Each mode, as the number of semitones its tonic sits above the tonic
   * of the major scale containing the same seven notes. A minor: 9 above
   * C. Key matching runs on this number: two loops match when their
   * underlying scales match, whatever each one calls its own root.
   */
  const MODES = {
    major: 0,
    ionian: 0,
    dorian: 2,
    phrygian: 4,
    lydian: 5,
    mixolydian: 7,
    minor: 9,
    aeolian: 9,
    locrian: 11,
    // Percussion, noise, anything with no tonic. Key matching never
    // transposes a loop declaring this; an explicit interval still does.
    none: null,
  };
  const MODE_NAMES = Object.keys(MODES);

  /** Relative shifts a deck can be told to take on top of key matching. */
  const INTERVALS = [
    { semitones: -12, label: "−8ve" },
    { semitones: -5, label: "−4th" },
    { semitones: -7, label: "−5th" },
    { semitones: 0, label: "unison" },
    { semitones: 3, label: "min 3rd" },
    { semitones: 4, label: "maj 3rd" },
    { semitones: 5, label: "4th" },
    { semitones: 7, label: "5th" },
    { semitones: 8, label: "min 6th" },
    { semitones: 9, label: "maj 6th" },
    { semitones: 10, label: "min 7th" },
    { semitones: 12, label: "+8ve" },
  ];

  /** Note name (sharp, flat, any case) → 0–11. Null if it is not one. */
  function noteIndex(name) {
    const s = String(name || "").trim();
    if (!s) return null;
    const norm =
      s[0].toUpperCase() + s.slice(1).replace(/♭/g, "b").replace(/♯/g, "#");
    const key = norm.toUpperCase();
    const resolved = ENHARMONIC[key] || norm;
    const i = NOTES.indexOf(resolved);
    return i < 0 ? null : i;
  }

  /**
   * The pitch class of the major scale a key is drawn from. F minor and
   * Ab major both land on 8: the same seven notes, so loops in them stack
   * with no transposition.
   */
  function relativeMajor({ root, mode }) {
    const i = noteIndex(root);
    const off = MODES[String(mode || "major").toLowerCase()];
    if (i === null || off === null || off === undefined) return null;
    return (i - off + 12) % 12;
  }

  /** Fold a semitone distance onto [-6, +5] — always the shorter way round. */
  function fold(semitones) {
    return (((semitones + 6) % 12) + 12) % 12 - 6;
  }

  /**
   * How far to transpose `loop` to sit in `target`.
   *
   * `scale` (the default) matches the underlying seven notes, so a loop
   * in F minor dropped into an Ab major mix does not move. `tonic` matches
   * the declared roots, for a bassline that should follow the root through
   * a mode change.
   *
   * A loop with no mode — drums, noise, a texture — never moves.
   */
  function matchSemitones(loop, target, how = "scale") {
    if (!loop || String(loop.mode).toLowerCase() === "none") return 0;
    if (!target || String(target.mode).toLowerCase() === "none") return 0;
    if (how === "tonic") {
      const a = noteIndex(loop.root);
      const b = noteIndex(target.root);
      if (a === null || b === null) return 0;
      return fold(b - a);
    }
    const a = relativeMajor(loop);
    const b = relativeMajor(target);
    if (a === null || b === null) return 0;
    return fold(b - a);
  }

  /** "F minor", or "F" when the mode carries no information. */
  function keyLabel({ root, mode }) {
    const i = noteIndex(root);
    if (i === null) return "—";
    const m = String(mode || "major").toLowerCase();
    return m === "none" ? NOTES[i] : NOTES[i] + " " + m;
  }

  // ---- the derived tempo -------------------------------------

  /**
   * The only tempo a loop has. Derived from the file length rather than
   * stored as a measurement, so the beat grid and the loop boundary are
   * one fact stated twice and a mix cannot drift.
   */
  function deriveBpm({ beats, frames, sampleRate }) {
    if (!beats || !frames || !sampleRate) return 0;
    return (beats * 60 * sampleRate) / frames;
  }

  /** The exact frame count `beats` beats occupy at `bpm`. */
  function framesForBeats({ beats, bpm, sampleRate }) {
    return Math.round((beats * 60 * sampleRate) / bpm);
  }

  const fmtBpm = (n) => (Math.round(n * 100) / 100).toString();

  function fmtTime(sec) {
    const s = Math.max(0, sec);
    return (
      Math.floor(s / 60) +
      ":" +
      String(Math.floor(s % 60)).padStart(2, "0") +
      "." +
      String(Math.floor((s % 1) * 100)).padStart(2, "0")
    );
  }

  // ---- images ------------------------------------------------
  // Same pair as album/me: a Blob in, an Img for the codec, a PNG Blob
  // back out. putImageData writes bytes verbatim rather than
  // premultiplying, which matters because the STGC header lives in the
  // border alpha.

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

  function imgToPngBlob(img) {
    const cnv = Object.assign(document.createElement("canvas"), {
      width: img.width,
      height: img.height,
    });
    cnv
      .getContext("2d")
      .putImageData(
        new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
        0,
        0
      );
    return new Promise((res, rej) =>
      cnv.toBlob(
        (b) => (b ? res(b) : rej(new Error("PNG encode failed"))),
        "image/png"
      )
    );
  }

  // ---- audio -------------------------------------------------
  // One context per sample rate: decodeAudioData resamples to the
  // context's rate, which is how a target rate gets applied.

  const ctxCache = new Map();
  function audioCtxAt(rate) {
    if (!ctxCache.has(rate))
      ctxCache.set(rate, new OfflineAudioContext(2, 1, rate));
    return ctxCache.get(rate);
  }

  async function decodeAudioFile(file, rate) {
    const buf = await audioCtxAt(rate).decodeAudioData(await file.arrayBuffer());
    const channels = [];
    for (let c = 0; c < buf.numberOfChannels; c++)
      channels.push(new Float32Array(buf.getChannelData(c)));
    return { channels, sampleRate: buf.sampleRate, frames: buf.length };
  }

  /** Take `wantChannels` out of a planar set, downmixing when asked for one. */
  function fitChannels(channels, wantChannels) {
    if (wantChannels === 1 && channels.length > 1) {
      const n = channels[0].length;
      const mix = new Float32Array(n);
      for (const d of channels)
        for (let i = 0; i < n; i++) mix[i] += d[i] / channels.length;
      return [mix];
    }
    const out = [];
    for (let c = 0; c < wantChannels; c++)
      out.push(channels[Math.min(c, channels.length - 1)]);
    return out;
  }

  function sliceChannels(channels, start, end) {
    return channels.map((d) => d.slice(start, end));
  }

  function peakOf(channels) {
    let p = 0;
    for (const d of channels)
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]);
        if (v > p) p = v;
      }
    return p;
  }

  /** Scale in place so the loudest sample lands on `target`. */
  function normalizeTo(channels, target) {
    const p = peakOf(channels);
    if (!p) return channels;
    const g = target / p;
    for (const d of channels) for (let i = 0; i < d.length; i++) d[i] *= g;
    return channels;
  }

  // ---- build -------------------------------------------------

  /**
   * One loop stegassette.
   *
   * `start`/`end` are frame indices into `channels`; everything outside
   * is thrown away, and what is left IS the loop — its length is the
   * tempo. `origin` is a frame index into the same source, so a caller
   * points at the downbeat where it sits and this rebases it.
   */
  async function buildLoop({
    channels,
    sampleRate,
    start,
    end,
    beats,
    meter = 4,
    origin = null,
    title = "",
    artist = "",
    root = "C",
    mode = "major",
    bits = 16,
    audioChannels = 2,
    layout = "planar",
    normalize = null,
    carrier,
    steg = STEG,
  }) {
    const frames = end - start;
    if (frames < 2) throw new Error("loop is empty");
    if (!beats || beats < 1) throw new Error("a loop needs at least one beat");

    let cut = sliceChannels(fitChannels(channels, audioChannels), start, end);
    if (normalize != null) normalizeTo(cut, normalize);

    const rel =
      origin == null ? 0 : ((Math.round(origin - start) % frames) + frames) % frames;

    const loop = {
      format: FORMAT,
      title: title || "",
      artist: artist || "",
      beats,
      meter,
      bpm: deriveBpm({ beats, frames, sampleRate }),
      root: NOTES[noteIndex(root) ?? 0],
      mode: String(mode).toLowerCase(),
      sampleRate,
      frames,
      origin: rel,
      gain: 1,
    };

    const audioEntry = Stegassette.buildAudioEntry({
      channels: cut,
      sampleRate,
      bitsPerSample: bits,
      layout,
      name: (slug(title) || "loop") + ".pcm",
    });

    // Audio first — see the header comment. A player that knows nothing
    // about stega-mix still opens this on the sound.
    const entries = [
      audioEntry,
      {
        mimetype: "application/json",
        name: LOOP_ENTRY,
        data: enc.encode(JSON.stringify(loop)),
      },
    ];

    const out = Stegassette.encodeStegassette(entries, carrier, steg);
    return {
      loop,
      name: loopFileName(loop),
      blob: await imgToPngBlob(out),
      width: out.width,
      height: out.height,
    };
  }

  /**
   * `hazy-rhodes-92bpm-f-minor.png` — readable in a folder, sortable enough.
   *
   * The sharp becomes an `s` before slugging: slug drops it, and
   * `a-dorian` on disk beside a loop in A dorian is a lie. Only the
   * filename is at stake; loop.json is the authority.
   */
  function loopFileName(loop) {
    const root = loop.root.replace(/#/g, "s");
    const key =
      String(loop.mode).toLowerCase() === "none"
        ? slug(root)
        : slug(root + "-" + loop.mode);
    return (
      [slug(loop.title || "loop"), Math.round(loop.bpm) + "bpm", key].join("-") +
      ".png"
    );
  }

  // ---- read --------------------------------------------------

  /**
   * Pull loops out of a pile of PNGs. Anything that is a stegassette but
   * not a loop is reported rather than dropped silently — usually it is
   * an ordinary stegassette someone hoped would play along, and saying so
   * is more use than ignoring it.
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
        const meta = entries.find((e) => e.name === LOOP_ENTRY);
        if (!meta) {
          skipped.push(f.name + ": no " + LOOP_ENTRY + " — not a loop");
          continue;
        }
        const loop = JSON.parse(dec.decode(meta.data));
        const audio = entries.find((e) => Stegassette.isAudioEntry(e));
        if (!audio) {
          skipped.push(f.name + ": " + LOOP_ENTRY + " but no audio");
          continue;
        }
        const parsed = Stegassette.parseAudioEntry(audio);
        loops.push({
          loop: normalizeLoop(loop, parsed),
          channels: parsed.channels,
          sampleRate: parsed.sampleRate,
          file: f.name,
          blob: f,
        });
      } catch (err) {
        skipped.push(f.name + ": " + err.message);
      }
    }
    onProgress("done", 1);
    return { loops, skipped };
  }

  /**
   * Fill in what an older or hand-made loop.json left out, and re-derive
   * the tempo from what arrived. The PCM is the authority on length: when
   * metadata and samples disagree the samples win, since they are what
   * plays.
   */
  function normalizeLoop(loop, audio) {
    const frames = audio.channels[0] ? audio.channels[0].length : loop.frames;
    const sampleRate = audio.sampleRate || loop.sampleRate;
    const beats = loop.beats || 4;
    const out = {
      format: loop.format || FORMAT,
      title: loop.title || "",
      artist: loop.artist || "",
      beats,
      meter: loop.meter || 4,
      root: NOTES[noteIndex(loop.root) ?? 0],
      mode: String(loop.mode || "major").toLowerCase(),
      sampleRate,
      frames,
      origin: ((Math.round(loop.origin || 0) % frames) + frames) % frames,
      gain: typeof loop.gain === "number" ? loop.gain : 1,
    };
    out.bpm = deriveBpm(out);
    return out;
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
   * One loop in the mix: buffer → phase vocoder → gain → pan → master.
   *
   * Tempo is the source's playbackRate; the vocoder is handed the
   * reciprocal so pitch does not follow it, then moved by however many
   * semitones the key match asks for.
   *
   * Every deck goes through a vocoder, including decks at unity.
   * Overlap-add costs a fixed 2048 samples of delay, so a deck skipping
   * it to stay pristine would sit 46ms ahead of the others and smear the
   * mix. Same latency everywhere keeps the decks locked together.
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
      this.matchKey = true;
      this.gain = 1;
      this.pan = 0;
      this.muted = false;
      this.source = null;
      this.transformation = null;

      const ctx = engine.ctx;
      this.gainNode = ctx.createGain();
      this.filterNode = ctx.createBiquadFilter();
      this.panNode = ctx.createStereoPanner();
      this.gainNode.connect(this.filterNode);
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
      this.buffer = ctx.createBuffer(
        item.channels.length,
        n,
        item.sampleRate
      );
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
      const match = this.matchKey
        ? matchSemitones(this.loop, this.engine.key, this.engine.keyMatch)
        : 0;
      return match + this.pitchOffset;
    }

    /** Where the key match alone would put this deck. */
    get matchSemitones() {
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
      return Math.abs(this.pitchOffset / 12 - Math.round(this.pitchOffset / 12)) < 1e-6;
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
      if ((!this.source && !this.shots.length) || this.startedAt == null) return null;
      if (time < this.startedAt) return null;
      const span = this.spanInMixBeats;
      if (span <= 0) return null;
      // Once a realign lands, the boundary it landed on is the phase.
      const anchor =
        this.alignAt != null && time >= this.alignAt ? this.alignAt : this.startedAt;
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

    /**
     * Halve or double how this deck is read. The audio is untouched; only the
     * tempo it claims changes, so a 16-beat loop at half time spans 8 of the
     * mix's beats and at double time spans 32.
     */
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
      const makeup = Math.abs(this.semitones) < 1e-6 ? 1 : this.makeupOffRoot;
      const g = this.muted ? 0 : this.gain * (this.loop.gain ?? 1) * makeup;
      this.gainNode.gain.value = g;
      this.panNode.pan.value = this.pan;
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

    setPan(p) {
      this.pan = Math.max(-1, Math.min(1, p));
      this.applyGain();
      return this.pan;
    }

    /**
     * The vocoder, built once and kept. Both modes feed the same node: grid
     * mode connects a fresh source per shot and free mode one looping source,
     * and neither wants a new worklet each time it restarts.
     */
    async ensureTransformation() {
      if (this.transformation) return this.transformation;
      const ctx = this.engine.ctx;
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
      this.refresh();
      return transformation;
    }

    /** min(grid, this deck's span), in mix beats — what grid mode sounds. */
    get soundingBeats() {
      return Math.min(this.engine.grid, this.spanInMixBeats);
    }

    /**
     * Queue grid-mode shots out to `until`. Each is its own source feeding the
     * same vocoder, started on a grid boundary and stopped after
     * min(grid, span) beats, so a loop shorter than the grid leaves silence
     * instead of repeating inside the cycle.
     */
    scheduleUntil(until) {
      const ctx = this.engine.ctx;
      this.retiring = this.retiring.filter((r) => r.until > ctx.currentTime);
      if (this.mode !== "grid" || !this.transformation) return;
      const T = this.engine.transport;
      if (this.nextShotBeat == null)
        this.nextShotBeat = T.nextBoundary(ctx.currentTime + 0.05, this.engine.grid);
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
      src.connect(this.transformation.phaseVocoderNode);
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
     * a half of its own loop.
     */
    async calibrateMakeup() {
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
      if (!this.engine.playing || !this.transformation) return null;
      if (this.mode === "grid" || !this.source) return null;
      const ctx = this.engine.ctx;
      const T = this.engine.transport;
      const when = T.timeOf(T.nextBoundary(ctx.currentTime + 0.15, this.engine.grid));

      const source = this.makeSource();
      source.connect(this.transformation.phaseVocoderNode);

      try {
        this.source.stop(when);
      } catch (_) {}
      this.retiring.push({ src: this.source, until: when });

      // Hand the transformation the new source before refresh(), so the rate
      // it writes lands on the one about to play.
      this.source = source;
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
      await this.ensureTransformation();
      this.alignAt = null;
      if (this.mode === "grid") {
        this.startedAt = null;
        this.nextShotBeat = Math.max(
          beat,
          this.engine.transport.nextBoundary(ctx.currentTime + 0.05, this.engine.grid)
        );
        this.startedAt = this.engine.transport.timeOf(this.nextShotBeat);
        this.scheduleUntil(ctx.currentTime + 0.3);
        return;
      }
      const source = this.makeSource();
      this.transformation.audioBuffer = source;
      source.connect(this.transformation.phaseVocoderNode);
      this.refresh();

      // Awaiting addModule above can cross a bar line on a cold start.
      // Take the next one rather than a time already gone.
      let when = this.engine.transport.timeOf(beat);
      if (when < ctx.currentTime + 0.02) {
        when = this.engine.transport.timeOf(
          this.engine.transport.nextBoundary(ctx.currentTime + 0.05, this.engine.grid)
        );
      }
      source.start(when, source.loopStart);

      this.source = source;
      this.startedAt = when;
    }

    /**
     * Re-read tempo and key off the engine. Cheap; call it on any change.
     * `when` schedules both writes at a context time so a whole mix changes
     * tempo at one instant rather than at whatever quantum each call lands on.
     */
    refresh(when) {
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
      // adjustSpeedToBPM writes the rate onto the transformation's own source;
      // grid mode's shots are separate nodes and need it as well.
      for (const shot of this.shots)
        if (when == null) shot.src.playbackRate.value = this.rate;
        else shot.src.playbackRate.setValueAtTime(this.rate, when);
      // the makeup follows the shift, which refresh is the thing that changes
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
      this.gainNode.disconnect();
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
        this.channels[id] = { id, gain, filter, decks: [], filterAt: 0, resonance: 1 };
        this.setFilter(id, 0);
      }
      this.crossfade = 0.5;
      this.setCrossfade(0.5);
    }

    /**
     * Stack a loop onto a channel. The same loop can sit on both channels, or
     * twice on one: each deck is its own source with its own tempo, pitch and
     * beat range, so two of them are two voices rather than one played twice.
     *
     * Nothing here is a beat-match control, because there is nothing to
     * match: the transport is one clock, every deck runs at a rate locked to
     * it, and a deck launched into a running mix waits for the next boundary.
     * Two loops are in time with each other because neither was ever given
     * the chance not to be. What a deck can lose is phase against the grid,
     * by looping at a length that does not divide it — that is what
     * `Deck.realign` is for.
     */
    async add(channelId, item) {
      const ch = this.channels[channelId];
      if (!ch || !item) return null;
      const deck = new Deck(this, item, ch.gain);
      deck.channelId = channelId;
      ch.decks.push(deck);
      if (this.playing) await this.startDeck(deck);
      // Not awaited: it is a probe for a gain, and the deck plays meanwhile.
      deck.calibrateMakeup();
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
      // Load every worklet before the clock is set, so the unpredictable part
      // is behind us and the lead can be short. Doing this inside start() is
      // what forced a long lead, and a long lead is what a grid boundary
      // rounded up into a whole cycle of waiting.
      await Promise.all(this.decks.map((d) => d.ensureTransformation()));
      this.playing = true;
      const at = this.ctx.currentTime + 0.12;
      this.transport = new Transport(this.ctx, this.bpm, at);
      // Beat 0 is now, so play starts on press. Decks joining a running mix
      // still wait for the next boundary — that is a different question.
      await Promise.all(this.decks.map((d) => d.start(0)));
      clearInterval(this.pumpTimer);
      this.pumpTimer = setInterval(() => this.pump(), 25);
    }

    /** Start one deck into a mix already running, on the next bar. */
    async startDeck(deck) {
      if (!this.playing) return;
      const beat = this.transport.nextBoundary(this.ctx.currentTime + 0.15, this.grid);
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
      return this.setFilter(channelId, ch.filterAt) === ch.filterAt
        ? ch.resonance
        : ch.resonance;
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
      for (const d of this.decks) if (d.source || d.shots.length) this.restartDeck(d);
      return this.bpm;
    }

    setGrid(beats) {
      this.grid = Math.max(1, Math.min(64, Math.round(beats)));
      return this.grid;
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

  // ---- zip (store-only; PNGs are already compressed) ---------
  // The same writer album/ carries. Two copies of forty lines of ZIP
  // header beats either subproject importing the other's format module.

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function zip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const put = (arr) => {
      chunks.push(arr);
      offset += arr.length;
    };
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const sum = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0, true);
      local.setUint16(8, 0, true); // stored
      local.setUint32(10, 0, true);
      local.setUint32(14, sum, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      const localOff = offset;
      put(new Uint8Array(local.buffer));
      put(name);
      put(data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0, true);
      cd.setUint16(10, 0, true);
      cd.setUint32(12, 0, true);
      cd.setUint32(16, sum, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint16(30, 0, true);
      cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true);
      cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true);
      cd.setUint32(42, localOff, true);
      central.push(new Uint8Array(cd.buffer), name);
    }
    const cdStart = offset;
    let cdLen = 0;
    for (const c of central) {
      chunks.push(c);
      cdLen += c.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdLen, true);
    end.setUint32(16, cdStart, true);
    chunks.push(new Uint8Array(end.buffer));
    return new Blob(chunks, { type: "application/zip" });
  }

  return {
    FORMAT,
    LOOP_ENTRY,
    STEG,
    METHODS,
    NOTES,
    MODES,
    MODE_NAMES,
    INTERVALS,
    noteIndex,
    relativeMajor,
    matchSemitones,
    keyLabel,
    fold,
    deriveBpm,
    framesForBeats,
    fmtBpm,
    fmtTime,
    slug,
    b64,
    imgFromBlob,
    imgToPngBlob,
    decodeAudioFile,
    fitChannels,
    sliceChannels,
    peakOf,
    normalizeTo,
    buildLoop,
    loopFileName,
    read,
    normalizeLoop,
    Transport,
    Deck,
    Engine,
    zip,
  };
})();
