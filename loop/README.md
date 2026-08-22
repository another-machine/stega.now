# loop

A **mix stegassette** carries seamless loops and the three numbers that
place each one: tempo, key, and where its first beat falls. Any number of
them — made by anyone, at any tempo, in any key — drop together into the
[mixer](../mixer/) and play in time and in tune. This is the editor that
makes them. It runs in the browser, with no build step.

## The format

An ordinary STGC stegassette, with one rule: **a `loop.json` entry
describes the audio entry directly before it.** A single loop is
`audio, loop.json`. A pack is that pair repeated — one picture, many
loops, in the order the author put them. Pairing is adjacency, so nothing
indexes anything and nothing can drift.

The audio comes **first** in every pair. So a player that has never heard
of stega-mix opens the stegassette on its sound: drop one into the plain
stega-now player, and it plays while the picture develops out of its own
pixels.

```json
{
  "format": "stega-mix/1",
  "title": "hazy rhodes",
  "artist": "",
  "beats": 8,
  "meter": 4,
  "bpm": 240,
  "root": "F",
  "mode": "minor",
  "sampleRate": 44100,
  "frames": 88200,
  "origin": 11025,
  "gain": 1,
  "source": {
    "audio": "session.mp3",
    "image": "cover.png",
    "start": 441000,
    "normalize": -1
  }
}
```

**`frames` is the loop to the sample, and `bpm` is derived from it** —
`beats × 60 × sampleRate ÷ frames`. The tempo is the file length stated a
second way. So the two can never disagree, and stacked loops cannot drift
apart. In the editor this means you set `beats`, not a tempo. Change it
until the bpm reads like the music.

**`origin` is where beat 1 sits inside the loop.** A phrase with a pickup,
a reversed swell that leads into the downbeat, a snare that rings past the
bar line and wraps around to the top: each loops perfectly with its first
beat somewhere after sample 0. Playback starts at `origin` with loop
points spanning the whole buffer, which for a perfect loop is the same
stream as a read of the buffer in a circle.

**`source` is the loop's recipe**: the audio file, the picture, the start
frame, and the normalize target, all in the loop's own units. Everything
else a rebuild needs is already in the container — channels and bits in
the audio mime, the steg options in the STGC header. So the image carries
its own provenance, and `stegassette-jobs` derives its bulk-regeneration
manifests from the images (`scripts/loops-from-pngs.js`) rather than
maintaining them beside the images.

Filenames: a single is `<slug>-<bpm>bpm-<key>.png` — readable in a folder,
with `loop.json` as the authority. A pack is just `<slug>.png`; its
per-loop facts live inside, one `loop.json` each.

### format.js is the format's one home

[`format.js`](format.js) is the spec, executable: constants, pitch-class
math, key matching, the derived tempo, `buildLoop`, the pair walk, and
`normalizeLoop`. It is pure — no DOM, no Web Audio, no codec — so the same
file runs in the browser and in node. The mixer imports it in place;
`stegassette-jobs` carries a committed copy refreshed by
`npm run format:loop` over there. Change the format here, and re-copy.

## Make

Drop audio and a picture. Every audio file arrives as one proposed loop,
and every loop encodes into the one picture you pick, in list order. One
loop leaves as a single, more leave as a pack — and the first is the loop
a mixer's "first loop sets the mix" rule lands on, so lead with the one
that should govern.

**A loop is a region**: a movable start and end, a beat count that says
how many beats the region holds, and a downbeat. The tempo is the
region's length divided by its beats — set the two ends, say the count,
done. All three are handles on the waveform, dragged rather than placed,
and there are no modes.

- **start and end** — drag the edges. The grid is a magnet, not a cage:
  the edge goes where the pointer goes, and within a few pixels of a beat
  line it clicks to it, with `beats` following — so a 4-beat loop dragged
  out a beat is a 5-beat loop at the same bpm, and a huge period on a
  long take never pins a handle. Off the lines the edge is free and the
  tempo follows it. Shift-drag ignores the grid. Scroll to zoom first,
  and a drag lands on a transient rather than near one.
- **beats** — how many beats the region holds. The bpm derives from it,
  and the grid is drawn from the same claim, so a wrong count shows as
  lines off the music. Tempo detection is octave-ambiguous, and the
  readout names the half and double alongside its pick — the fix is this
  one number.
- **downbeat** — the kite at the top. Drag it into the loop for a phrase
  with a pickup; nearby beat lines attract it, and shift-drag frees it.
  Drop it back on the start to clear it. `origin` is its distance from
  the start.
- **add loop** — a new region on the same take, placed after the selected
  one at the same length and key. One file carries as many loops as it
  has sections, and each is its own row in the list, its own pair in the
  pack.
- **loop it** — plays the region exactly as it will be encoded. If the
  seam ticks, the numbers are wrong — and this is where you hear it. A
  playhead runs on both the waveform and the overview strip, read off the
  audio clock so it cannot drift from what sounds.

Detection runs on its own when a file arrives, proposing the region, the
beat count and the key — every one of them a handle or a field you then
move. A whole song arrives at its full length with a tempo estimate, for
you to cut regions out of.

`mode` accepts the seven church modes plus `major`/`minor`, and **`none`**
for drums, noise, or anything with no tonic. A loop in no key is never
transposed to match one, and the mixer plays it on tape.

**The audio choices are made once, in [`encode.js`](encode.js)**: 44100
Hz, 16 bits, planar, peak-normalized to −1 dBFS, stereo for stereo
sources and mono for mono. The old editor offered all five as fields, and
every real loop used the defaults. The picture grows to fit the payload —
the codec scales it up — so there is no capacity to manage, only a
readout of what the encode will weigh.

## Detection

`detect` proposes; the handles decide. Detection cannot set the tempo
here — `bpm` comes from the region's length — so what it writes is the
region, its beat count and a key. An estimate of 119.7 against a true 120
still lands on 16 beats. The error is quantized away, not stored.

It runs on `@amplib/music-detection`, vendored as
`../lib/music-detection.js`. The analysis is pure PCM — no Web Audio — so
the same code runs in Node. Key is decimated to 16 kHz inside the package,
which is both faster and finer-grained.

**A loop and a song are different questions.** A loop spans a whole number
of beats. So its length answers for the tempo, and only the integer has to
be found. A song does not, and `detectLoopBeats` tests 1 to 64 beats.
Across a 195-second track every candidate lands under any tempo floor, so
it returns nothing — that is a song arriving, and the tempo comes from
autocorrelation instead. Measured on a real 195-second track: **93.12 bpm
against a true 93.42**, and F# minor named correctly.

Synthesized loops with known ground truth, 2026-08-01:

|                                          | result   |
| ---------------------------------------- | -------- |
| `detectLoopBeats` on percussive loops    | 4/4 exact |
| `detectLoopBeats` on chord and pad loops | 4/6      |
| `detectKey` on tonal material            | 5/6      |

Sparse material is where the beat misses are, and they are honest ones: a
four-chord pad gives three onset peaks in eight seconds, which fits a
12-beat grid as well as a 16-beat one. The readout names the runners-up,
so `also fits 24 / 12` is a hint, not a surprise.

**Nothing here can tell a drum loop from a dense full mix.** Both play all
twelve pitch classes. So the key is always named, and the **confidence**
carries the doubt: 0.78 for chords under drums, 0.36 for a real full mix,
0.15 for a drum loop alone, 0.00 for noise. Below 0.25, the readout says
what it thinks and leaves the field alone. A wrong key filled in silently
is worse than an empty one. Set `mode` to `none` yourself for percussion.

Key profiles are **Temperley's**, fitted to the Kostka-Payne corpus, not
the Krumhansl-Schmuckler ones — parallel major against minor is where the
older profiles are weakest, and it is the call this has to make. The
chroma is normalized per frame, so every frame counts equally. The
remaining key misses are relative-major confusion — F minor read as A♭
major. Under `scale` matching that costs nothing: relative keys hold the
same seven notes, and both readings transpose a deck identically.

**Tempo is octave-ambiguous, and no tuning fixes it.** On a real track the
onset pattern can correlate better at double the stated tempo than at the
tempo itself, because the eighths carry as much onset energy as the beats.
The readout names the half and double alongside its pick — halve or
double `beats` to take either.

`origin` is musical, not detectable. Detection finds the beat grid within
8–17 ms, but it cannot say which line of the grid is beat 1. It can put
the grid on the audio; only you can say where the loop begins.

## Vendored code

`../lib/stegassette.js` and `../lib/music-detection.js` are vendored build
output from npm packages — see the repo README. **Never hand-edit them.**
To re-vendor after a package release:

```bash
npm run codec
npm run detect
```

## Where this comes from

Section 3.8 of the provisional description lists **synchronized loop
libraries** among the exemplary applications: seamlessly looping audio
segments encoded with their tempo and musical key recorded alongside,
which a player repitches and time-aligns to a common tempo and key and
plays in combination, "so that an arbitrary set of such images, dropped
together in any number, combines into a continuous arrangement." This is
that, plus `origin` — loops whose first beat is not their first sample are
common enough to need a field — and packs, several such loops sharing one
picture.
