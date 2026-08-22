/* ============================================================
   stega-mix — the format, executable.

   A mix stegassette is an ordinary STGC container that carries
   seamless loops. The rule that makes it one: a `loop.json`
   entry describes the audio entry directly before it. A single
   loop is `audio, loop.json`. A pack is that pair repeated.
   Pairing is adjacency, so nothing indexes anything and nothing
   can drift.

   The audio comes first in every pair, so a player that has
   never heard of stega-mix still opens the file on its sound.

   This module is the format's one home. It is pure — no DOM, no
   Web Audio, no codec — so the same file runs in the browser
   and in node. The loop editor and the mixer import it in
   place; stegassette-jobs carries a committed copy, refreshed
   by a `cp`. Everything that touches pixels or PCM lives with
   its caller.
   ============================================================ */

const FORMAT = "stega-mix/1";
const LOOP_ENTRY = "loop.json";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Mirrors `Stegassette.slug`, copied so this module stays pure. */
function slug(s) {
  return (
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "untitled"
  );
}

// ---- pitch classes -----------------------------------------
// Twelve names and modular arithmetic. @amplib/music-theory does this
// properly — Scale, Mode, Note, the lot — but vendoring a whole theory
// library to subtract two numbers mod 12 would cost more than it
// explains.

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

// ---- build -------------------------------------------------

/**
 * `source` records how to remake a loop from its source media, so the
 * image carries its own recipe and a jobs manifest can be derived from
 * images rather than maintained beside them. `start` is in frames at
 * the loop's `sampleRate` — the same unit as `frames` and `origin`.
 * Everything else a rebuild needs is already in the loop or the
 * container: channels and bits in the audio mime, the steg options in
 * the STGC header.
 */
function sourceBlock(source) {
  if (!source) return null;
  const out = {};
  if (source.audio) out.audio = String(source.audio);
  if (source.image) out.image = String(source.image);
  if (source.start != null) out.start = Math.round(source.start);
  if (source.normalize != null) out.normalize = source.normalize;
  return Object.keys(out).length ? out : null;
}

/**
 * The metadata for one loop, validated and derived. Pure: the caller
 * cuts and encodes the PCM itself.
 *
 * `frames` is the loop length, and the tempo is derived from it — the
 * file length stated a second way, so the two can never disagree.
 * `origin` is where beat 1 sits, as a frame index relative to the loop
 * start, wrapped; a caller holding an absolute source position
 * subtracts its own start first.
 */
function buildLoop({
  frames,
  sampleRate,
  beats,
  meter = 4,
  origin = 0,
  title = "",
  artist = "",
  root = "C",
  mode = "major",
  gain = 1,
  source = null,
}) {
  if (!frames || frames < 2) throw new Error("loop is empty");
  if (!beats || beats < 1) throw new Error("a loop needs at least one beat");

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
    origin: ((Math.round(origin) % frames) + frames) % frames,
    gain,
  };
  const src = sourceBlock(source);
  if (src) loop.source = src;
  return loop;
}

/** The serialized metadata entry, ready to sit after its audio. */
function loopEntry(loop) {
  return {
    mimetype: "application/json",
    name: LOOP_ENTRY,
    data: enc.encode(JSON.stringify(loop)),
  };
}

/**
 * `hazy-rhodes-92bpm-f-minor.png` — readable in a folder, sortable
 * enough.
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

/**
 * A pack's per-loop facts live inside it, one loop.json each, so its
 * filename carries only the slug. Singles keep the readable
 * `-92bpm-f-minor` tail.
 */
function packFileName(title) {
  return slug(title || "pack") + ".png";
}

// ---- read --------------------------------------------------

const AUDIO_MIME = /^audio\//i;

/**
 * Walk a decoded container's entries and collect its loops. Each
 * `loop.json` pairs with the audio entry directly before it; anything
 * else is passed over. No pairs means the file is not a loop.
 *
 * The metadata arrives parsed but not normalized — normalizing needs
 * the decoded PCM length, which is codec work the caller does. A
 * `loop.json` that does not parse throws: corrupt PCM is an aesthetic,
 * corrupt metadata is a fault.
 */
function pairLoops(entries) {
  const pairs = [];
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    if (e.name !== LOOP_ENTRY) continue;
    const audio = entries[i - 1];
    if (!AUDIO_MIME.test(audio.mimetype || "")) continue;
    let loop;
    try {
      loop = JSON.parse(dec.decode(e.data));
    } catch (_) {
      throw new Error(LOOP_ENTRY + " at entry " + i + " is not JSON");
    }
    pairs.push({ audio, loop });
  }
  return pairs;
}

/**
 * Fill in what an older or hand-made loop.json left out, and re-derive
 * the tempo from what arrived. The PCM is the authority on length: when
 * metadata and samples disagree the samples win, since they are what
 * plays. `source` passes through untouched — it describes the loop's
 * past, not its playback.
 */
function normalizeLoop(loop, { frames: pcmFrames, sampleRate: pcmRate } = {}) {
  const frames = pcmFrames || loop.frames;
  const sampleRate = pcmRate || loop.sampleRate;
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
  if (loop.source && typeof loop.source === "object")
    out.source = { ...loop.source };
  out.bpm = deriveBpm(out);
  return out;
}

export {
  FORMAT,
  LOOP_ENTRY,
  NOTES,
  MODES,
  MODE_NAMES,
  INTERVALS,
  noteIndex,
  relativeMajor,
  fold,
  matchSemitones,
  keyLabel,
  deriveBpm,
  framesForBeats,
  fmtBpm,
  fmtTime,
  slug,
  buildLoop,
  loopEntry,
  loopFileName,
  packFileName,
  pairLoops,
  normalizeLoop,
};
