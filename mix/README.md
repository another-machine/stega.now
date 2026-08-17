# mix

A **mix stegassette** carries one seamless loop and the three numbers that
place it: tempo, key, and where its first beat falls. Any number of them, made
by anyone at any tempo in any key, drop together and play in time and in tune.
Runs in the browser, no build step.

An ordinary STGC stegassette with two entries:

```
<slug>-<bpm>bpm-<key>.png   the audio  raw PCM, audio/L16; rate=…; channels=…
                            loop.json  tempo, key, and where the downbeat sits
```

The audio comes **first**, so a player that has never heard of stega-mix opens
the stegassette on it: drop one into the plain stega-now player and it plays the
loop while the picture develops out of its own pixels. This is the stegassette
format with one entry added.

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
  "gain": 1
}
```

## Two fields

**`frames` is the loop to the sample, and `bpm` is derived from it** —
`beats × 60 × sampleRate ÷ frames`. The tempo is the file length stated a
second way, so the two can never disagree and stacked loops cannot drift apart.

In the editor this means you set `beats`, not a tempo. Change it until the bpm
reads like the music.

**`origin` is where beat 1 sits inside the loop.** A phrase with a pickup, a
reversed swell leading into the downbeat, a snare ringing past the bar line and
wrapping around to the top: each loops perfectly with its first beat somewhere
after sample 0.

Playback starts at `origin` with loop points spanning the whole buffer, so the
loop plays `origin → end`, wraps, and runs `0 → end` from there. For a perfect
loop that is the same stream as reading the buffer in a circle, verified
sample-for-sample over three cycles. The downbeat lands where the mix wants it
and the seam stays where the author put it.

## Make

Drop audio and a picture. Audio becomes takes, images become carriers,
assigned to takes in filename order and cycled if there are fewer.

Each take keeps its own edit, so switching between them in the list changes
nothing, and `encode all ↓` renders what you set on each one.

**Mark two beats, say how far apart they are, and the tempo follows.** Scroll
to zoom — a click lands on a transient rather than near one — and drag the
strip under the waveform to move through a long take. Click a mark again to
remove it.

- **mark beats** — click beats you can see. Two is enough.
- **beats apart** — how many beats lie between the first mark and the last.
  Defaults to one per gap, which is right when you mark every beat. Marking two
  beats a bar apart and saying `4` divides your click error by four: the same
  sloppiness measured 1.03 bpm out across consecutive marks and 0.31 bpm out
  across sixteen.
- **loop start** — click where the loop begins. The first mark sets it, so most
  takes never need this.
- **beats** — how long the loop is. The end follows from it and the tempo, and
  the readout says so when that runs past the end of the file.
- **half time / double time** — the same grid read at half or twice the tempo,
  by moving the second mark. Tempo detection is octave-ambiguous and this is
  the correction it needs most often.
- **loop it** — plays the loop exactly as it will be encoded, with an optional
  click on the beat. If the seam ticks or the click drifts off the music, the
  metadata is wrong and this is where you hear it. A playhead runs on both the
  waveform and the overview strip, read off the audio clock rather than counted
  so it cannot drift from what is sounding; zoomed in past the loop, the view
  follows it.

The downbeat is the first mark: `origin` is its distance from the loop start.
The grid is drawn across everything on screen rather than only inside the
loop — on a whole song the loop is a few seconds of a few minutes, and a grid
that stopped at its end could not be checked against the music anywhere else.
Zoom in a minute deep and see whether the lines still sit on the beats.

With no marks at all a take reads as its whole file at `beats` long, which is
what an already-exported loop wants.

`mode` accepts the seven church modes plus `major`/`minor`, and **`none`** for
drums, noise, or anything with no tonic — a loop in no key is never transposed
to match one.

## Mix

Two channels and a crossfader, each holding a **stack** of loops. Drop loop
stegassettes and the first two fill A and B; the rest wait in the library, one
click from either. The same loop can sit on both channels, or twice on one:
every deck is its own source with its own tempo, pitch and beat range, so two
of them are two voices rather than one played twice. The first loop loaded sets
the mix's tempo and key; everything after is matched to the mix.

**There is nothing to beat-match.** The transport is one clock, every deck
runs at a rate locked to it, and a deck launched into a running mix waits for
the grid. Loops are in time because none was ever given the chance not to be.
What a deck can lose is phase against the grid, by looping at a length that
does not divide it — **sync to clock** is the one control for that.

**grid** is the global cycle, in beats. Everything starts and relaunches on a
multiple of it: 1 is immediate, 16 is phrase-aligned. Bars are not involved
anywhere — a loop can be any number of beats long, and a set of 16, 10 and 6
beat loops has no bar line in common to wait for.

The beat display is that clock drawn: a row for the grid, and a row per deck
divided into the mix beats its cycle spans. Counted in the **mix's** beats
rather than its own — a deck read at double time covers two mix beats per beat
of its own, so measuring in its own would have rows advancing at different
speeds and the display would say nothing.

Per channel:

- **filter** is one knob, bypassed at the centre: low-pass closing down to the
  left, high-pass opening up to the right. Both directions are the same biquad
  with its type switched, so there is no crossfade between two filters to click
  on, and the frequency moves exponentially because pitch does. **res** adds
  resonance, and applies only where the filter is doing something, so the
  centre stays flat however it is set.
- **crossfader** is equal power, so the pair sums to a constant through the
  sweep; a linear fader dips about 3 dB in the middle, exactly where both loops
  should be sitting together. **cut** throws it to the far side in one press.

Per deck, as a strip: artwork, title, what the loop is and the rate it is
running at, its own beat rectangles, and a vertical level fader — then the two
buttons you press while it runs, **mute** and **sync to clock**.

Everything else is set once when a loop lands and rarely touched again, so it
lives behind **≡** on the card. Both groups were laid out at the same weight
before, which is what made two loops take 43% of the screen and a third per
deck not fit at all. Collapsed, a card is 90px against 324px open; the
controls are the same controls.

The rate reads `×1.000` beside the key and inverts when a deck runs more than
half an octave from unity — the deck to look at first when something sounds
wrong.

- **sync to clock** puts a free deck's beat 1 back on the next grid boundary.
  A free deck whose length does not divide the grid walks away from it, which
  is the point of free mode until it is not; this is how you get it back. The
  running source is told to stop on the boundary and a fresh one to start on
  it, so nothing drops out in between. Disabled in grid mode, where every shot
  already starts on a boundary.

Behind **≡**:

- **mode** — **free** loops at the deck's own length and may be polyrhythmic
  against the grid; more or fewer beats than the grid is fine and nothing is
  truncated. **grid** retriggers on every grid boundary and sounds
  `min(grid, its own span)`, so a loop shorter than the grid plays once and
  leaves silence rather than repeating inside the cycle, and a loop longer than
  the grid is cut to it. Grid mode is scheduled as one-shots 300 ms ahead on a
  25 ms timer, so the timer can be an order of magnitude late and still never
  miss a boundary.
- **tempo** — **½** and **2×** halve or double how the loop is read, for one
  labelled an octave from what the mix wants. The audio is untouched; only the
  tempo it claims changes.
- **pitch** — **scale** matches the underlying seven notes, so a loop in F
  minor dropped into an A♭ major mix does not move. **tonic** matches the
  declared roots instead, for a bassline that should follow the root. The shift
  takes the shorter way round the twelve, never more than six semitones.
  **key ✓** turns matching off for one deck, and **interval** stacks a move of
  your own on top.
- **beats** — **from** _n_ **for** _n_ plays a run of the loop instead of all
  of it, both in whole beats, so a trimmed deck still repeats on the grid.
  **from** offsets the deck against everything else: the same loop twice, one
  of them four beats in, is two parts rather than one played twice. It can be
  any beat, and the run wraps past the last one — beats 12 to 4 of a
  sixteen-beat loop is a run like any other, since the loop closes. The row
  says `wraps` when it does. A wrapping range plays from a rotated copy of the
  buffer, because `loopStart` and `loopEnd` cannot wrap; one that does not
  costs no copy.
- **filter** and **res**, per deck as well as per channel — same shape,
  bypassed at centre.
- **pan**, **→ A / → B**, which copies the deck to the other side with all of
  its settings, and **sync all to this**, which makes the deck the reference
  the whole mix conforms to.

## Pitch costs level, and how much depends on the material

At a pitch factor of exactly 1 the vocoder reconstructs perfectly. At anything
else it shifts spectral peaks and their regions of influence, and whatever
falls between peaks is discarded. Measured against the same source at unity:

| material | RMS off unity | crest factor |
| --- | --- | --- |
| sustained, harmonic | −0.3 to −0.8 dB | unchanged |
| percussive | **−9.4 to −10.1 dB** | 6.1 → 7.5–10.9 |

Drum content is mostly between peaks, so most of it is thrown away — and the
loss is a step at unity rather than a slope, which is why a deck seems to drop
out the moment it stops being the root.

Each deck therefore **measures its own** makeup: on load it renders a second
and a half of its loop through the vocoder at a shifted pitch, compares RMS
against dry, and applies the difference as a gain whenever its shift is
non-zero. A tonal loop gets a few tenths of a dB and a drum loop gets most of
9 back.

The rising crest factor is a smear, not a level, and no makeup gain addresses
it: transients spread across the overlap-add window. That is inherent to this
vocoder, and the reason a heavily shifted drum loop still sounds softer than an
unshifted one however the level is matched.

## Staying in time

Three things move a deck off the grid, and each is handled where it happens.

**A rate change mid-cycle.** Changing one deck's speed changes how many mix
beats its loop spans, so the fraction it is through the buffer now means a
different number of beats than it did a moment ago. Everything else stays on
the grid and that deck does not — permanently. Both **½/2× speed** and a
**beats** change therefore relaunch that deck on the next grid boundary, which
is the only way back.

**A global tempo change.** This one is safe by itself: every deck's rate scales
together and each loop's span in mix beats is unchanged, so relative phase
holds. What did not hold was the clock. Writing an audio parameter "now" lands
on the next render quantum, up to 2.9 ms later than the transport thinks it
happened, and the gap is charged again on every change. Tempo changes are now
scheduled at an explicit time and the transport is re-anchored at that same
instant, so the two cannot disagree.

**Moving loop points under a playing source.** It wraps wherever the playhead
happens to be, which lands mid-beat and costs the phase everything else is
holding. Hence the relaunch rather than an edit in place.

Verified by driving twelve tempo, speed and range changes back to back across
four stacked decks and checking every deck's position against the transport
afterwards.

## If a browser goes silent

Safari has served a stale `lib/phase-vocoder-processor.js` across reloads,
`no-store` and all, and the symptom is the mixer playing with no sound and no
error — `engine.playing` true, context running, decks loaded. Quitting and
reopening Safari cleared it. Check that before reading any code.

`await mixTrace()` in the console while playing measures RMS at each stage of
a deck's chain; the first stage reading zero is the one at fault.

## Detection

`detect` proposes; marking decides. Detection cannot set the tempo here — `bpm`
comes from the loop length — so what it writes is two marks on the beat grid, a
beat count and a key. An estimate of 119.7 against a true 120 still lands on 16
beats, so the error is quantized away rather than stored.

It runs on `@amplib/music-detection`, vendored as `../lib/music-detection.js`.
The analysis is pure PCM, no Web Audio and no deprecated `ScriptProcessor`, so
the same code runs in Node. Key is decimated to 16 kHz inside the package,
which is both faster and finer-grained: bin width is rate over transform size,
so the same FFT that gave 5.4 Hz bins at 44.1 kHz gives 2.0 Hz at 16 kHz.

**A loop and a song are different questions.** A loop spans a whole number of
beats, so its length answers for the tempo and only the integer has to be
found. A song does not, and `detectLoopBeats` tests 1 to 64 beats — across a
195-second track even 64 of them is 19.7 bpm, under any floor, so every
candidate is rejected and it returns nothing. That is a song arriving, and the
tempo comes from autocorrelation instead. Measured on a real 195-second track:
**93.12 bpm against a true 93.42**, and F# minor named correctly.

Synthesized loops with known ground truth, 2026-08-01:

| | result |
| --- | --- |
| `detectLoopBeats` on percussive loops | 4/4 exact |
| `detectLoopBeats` on chord and pad loops | 4/6 |
| `detectKey` on tonal material | 5/6 |

A 10-second loop takes about 125 ms for both.

Sparse material is where the beat misses are, and they are honest ones. A
four-chord pad gives three onset peaks in eight seconds, which fits a 12-beat
grid as well as a 16-beat one; the difference is not in the signal. The readout
names the runners-up, so `also fits 24 / 12` is a hint rather than a surprise.

**Nothing here can tell a drum loop from a dense full mix.** Both play all
twelve pitch classes. Three statistics of the histogram were tried as a
"does this have a key" gate and none of them separates the two:

| | real track | drums | white noise |
| --- | --- | --- | --- |
| peak over median | 1.38 | 1.45 | 1.41 |
| mean per-frame concentration | 0.165 | 0.140 | 0.111 |
| best profile correlation | 0.71 | 0.65 | 0.42 |

So the key is always named, and the **confidence** carries the doubt: 0.78 for
chords under drums, 0.36 for a real full mix, 0.15 for a drum loop alone, 0.00
for noise. Below 0.25 the readout says what it thinks and leaves the field
alone, because a wrong key filled in silently is worse than an empty one. Set
`mode` to `none` yourself for percussion — a loop in no key is never
transposed.

Key profiles are **Temperley's**, fitted to the Kostka-Payne corpus, not the
Krumhansl-Schmuckler ones fitted to 1982 probe-tone experiments. On that
195-second F# minor track, Krumhansl ranked F# *major* first and the truth
second; Temperley put F# minor first by 0.166 where Krumhansl had it losing by
0.072. Parallel major against minor is where the older profiles are weakest and
is the call this has to make.

The chroma is normalized **per frame** rather than summed raw, so every frame
counts equally. Summed raw, the loud bars of a track write the histogram and
the quiet ones write nothing: the same track that names its key correctly this
way was flat enough unnormalized to read as having no key at all.

The remaining key misses are relative-major confusion — F minor read as A♭
major. For **scale** matching that costs nothing, since relative keys hold the
same seven notes and both readings transpose a deck identically. It shows only
under **tonic** matching.

**Tempo is octave-ambiguous, and no tuning fixes it.** On a real 336-second
track whose stated tempo is 74, the onset pattern correlated better at 147.66
than at 73.83 — 0.00106 against 0.00088, before any weighting — because the
eighths carry as much onset energy as the beats. Both readings are defensible
and people tap that song both ways. The readout names the half and double
alongside its pick, and **half time** / **double time** apply either in one
click. The period itself was right to 0.23%.

Relative keys are the other one-click correction. That same track reads as
A# minor where its sleeve says C# major — the same seven notes, and its bass
sits on G# and A# rather than C#, so the evidence genuinely leans that way. The
readout names the runner-up. Under **scale** matching the two are
interchangeable and a deck transposes identically either way; only **tonic**
matching sees a difference.

`origin` is musical rather than detectable. Detection returns a `phase` that
finds the beat grid within 8–17 ms, but at a half-second rotation of a 120 bpm
loop it names a different beat as the first. It can put the grid on the audio;
only you can say which line of it is beat 1.

## The demo set

`media/` holds loop stegassettes the mix tab offers as **try the demo set** —
one click and the mixer is playing, no setup. `media/index.json` is a plain
list of the filenames beside it, in load order; the first one sets the mix's
tempo and key, so put the loop that should govern the mix first.

An empty list hides the button entirely, so an empty `media/` never shows a
button that does nothing. The files load through the same code path a drag
from the desktop takes, so the demo cannot drift into a special case that
works where a real drop would not. See [media/README.md](media/README.md) for
what makes a good set.

## The vocoder

Every deck goes through the phase vocoder, including decks running at unity.
Overlap-add costs a fixed 2048 samples of delay, so a deck that skipped it to
stay pristine would sit 46 ms ahead of the others and smear the mix. The same
latency everywhere keeps the decks locked together. It costs a uniform ~9 dB,
uniform across decks, so the balance holds.

Pitch shifts land within 0.6 cents across ±12 semitones and 110–1760 Hz, and a
12-partial sawtooth shifts with every harmonic inside 0.8 cents. Getting there
took two fixes in `@amplib/sound-transformation`, both worth knowing about
before touching that file: it rounded each shifted spectral peak to a whole FFT
bin and advanced phase by the same rounded amount, and it measured the shift
from the bin containing a partial rather than from the partial. Together those
detuned shifts by up to 38.6 cents, a third of a semitone.

## Vendored code

`../lib/sound-transformation.js` and `../lib/phase-vocoder-processor.js` are
vendored build output from
[`@amplib/sound-transformation`](https://github.com/another-machine/public-library/tree/main/packages/amplib-sound-transformation),
the same way `lib/stegassette.js` is vendored from `@amplib/steganography`.

`../lib/music-detection.js` comes from `@amplib/music-detection` the same way.

**Never hand-edit them.** To re-vendor after changing a package:

```bash
npm run vocoder
npm run detect
```

That package is not on npm yet, so this copies from a sibling
`../public-library` checkout where `npm run codec` copies from `node_modules`.
The output is committed, so the site never needs that checkout; only
re-vendoring does. Once the package ships this becomes `npm i
@amplib/sound-transformation` plus the same two `cp`s.

## Where this comes from

Section 3.8 of the provisional description lists **synchronized loop
libraries** among the exemplary applications: seamlessly looping audio segments
encoded with their tempo and musical key recorded alongside, which a player
repitches and time-aligns to a common tempo and key and plays in combination,
"so that an arbitrary set of such images, dropped together in any number,
combines into a continuous arrangement." This is that, plus `origin`: loops
whose first beat is not their first sample are common enough to need a field.
