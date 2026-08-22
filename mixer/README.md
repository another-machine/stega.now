# mixer

Plays any number of loop stegassettes together, matched in beat and key.
Each image carries a seamless loop with its own tempo, key, and downbeat —
the format lives in [`../loop/format.js`](../loop/format.js), and the
[loop editor](../loop/) is where the images are made. A pack — several
loops in one picture — expands into one crate group with shared artwork,
and each of its loops loads like any other.

Two channels and a crossfader, each with a **stack** of loops. Drop loop
stegassettes: the first two fill A and B, and the rest wait in the
crate, one click from either. The same loop can sit on both channels, or
twice on one. Every deck is its own source, with its own tempo, pitch and
beat range — so two of them are two voices, not one played twice. The
first loop loaded sets the mix's tempo and key; for a pack, that is the
first loop its author put in it.

**There is nothing to beat-match.** The transport is one clock. Every deck
runs at a rate locked to it, and a deck launched into a running mix waits
for the grid. Loops are in time because none was ever given the chance not
to be. What a deck can lose is phase against the grid, when it loops at a
length that does not divide the grid — **sync to clock** is the one
control for that.

**grid** is the global cycle, in beats. Everything starts and relaunches
on a multiple of it: 1 is immediate, 16 is phrase-aligned. Bars are not
involved anywhere. A loop can be any number of beats long, and a set of
16, 10 and 6 beat loops has no bar line in common to wait for.

The beat display is that clock, drawn: a row for the grid, and a row per
deck, divided into the mix beats its cycle spans. It counts in the
**mix's** beats, not the deck's own, so every row steps together and a
shared left edge means what it looks like.

Per channel:

- **filter** is one knob, bypassed at the centre: a low-pass closes down to
  the left, and a high-pass opens up to the right. Both directions are the
  same biquad with its type switched, and the frequency moves
  exponentially because pitch does. **res** adds resonance, only where the
  filter does something.
- **crossfader** is equal power, so the pair sums to a constant through
  the sweep. **cut** throws it to the far side in one press.

A channel shows its decks as their pictures, in a row. Tap one and its
card opens, whole. Tap the open picture again and the channel folds to
thumbnails. A muted deck's picture dims. One card per channel is ever
open, which is what lets a channel hold five decks without taking the
screen.

The card is four groups with one space between them, and no group moves
when a setting changes — whatever comes and goes sits at the tail of its
group. First what the deck is: title, then every readout on one line —
its own tempo and key, the rate it runs at, the total pitch shift.
Beside that, where it sits and how loud: **pan**, the vertical level
fader, **mute** — a console strip, apart from the knobs that shape tone.
In the corner under the channel's **clear**, the deck's own
housekeeping: **✕** ejects it, **→ A / → B** copies it to the other
side with all of its settings. Then how it plays, then the knobs, then
**sync all to this**. Nothing is labelled; the options say what a select
is, and the tooltip says the rest.

The **crate** below works the same way: every loaded stegassette as its
artwork, in a grid. Tap a picture and the loops it carries open as rows,
each one a click from either deck; a picture with a loop on a deck keeps
an ink edge.

The rate reads `×1.000` beside the key. It inverts when a deck runs more
than half an octave from unity — the deck to look at first when something
sounds wrong.

**sync**, beside play, puts every free deck's beat 1 back on the next
grid boundary — one control for the whole mix, not one per deck. Each
running source is told to stop on the boundary and a fresh one to start
on it, so nothing drops out in between. Grid decks already start on
boundaries and are left alone.

On the card:

- **engine** — **auto**, **pitched** or **tape**, see below.
- **mode** — **free** loops at the deck's own length, and may be
  polyrhythmic against the grid. **grid** retriggers on every grid
  boundary and sounds `min(grid, its own span)`, scheduled as one-shots,
  300 ms ahead on a 25 ms timer.
- **tempo** — **½** and **2×** halve or double how the loop is read, for
  one labelled an octave from what the mix wants. **reverse** plays the
  loop backwards — the buffer reversed exactly, so twice is forward
  again.
- **pitch** — **scale** matches the underlying seven notes, so a loop in F
  minor dropped into an A♭ major mix does not move. **tonic** matches the
  declared roots instead. The shift takes the shorter way round the
  twelve. **key ✓** turns matching off for one deck, and the pitch knob
  stacks a move of your own on top — double-click zeroes it,
  **−12 / +12** jump whole octaves. Pitch lives on the vocoder
  and grain alike; tape's pitch is its rate.
- **beats** — two selects, the beat it starts on and how many it plays:
  a run of the loop instead of
  all of it, both in whole beats. The run wraps past the last beat, since
  the loop closes; a wrapping range plays from a rotated copy of the
  buffer, and a range that does not wrap costs no copy.
- **pitch**, **filter**, **res** and **drive**, one row of knobs — drag
  up or down to turn, double-click to reset, and the tooltip says the
  value. Faders are only for level and crossfade; everything that shapes
  tone turns. The deck filter is the channel filter's shape, bypassed at
  centre, so a deck can be carved inside a channel that is itself
  sweeping. Drive is a tanh soft clip after the fader, oversampled, with
  its peak held at 1 so it thickens rather than just louder; at zero it
  is not in the signal at all. On a tape deck the pitch knob stays in
  its place as a meter, dimmed, its needle at the pitch the rate
  imposes — the knob row is the same row in every engine.
- **sync all to this**, which makes the deck the reference the whole mix
  conforms to.

## Capture

**capture ↓**, beside sync, bounces the mix into a new loop stegassette:
one full cycle of what the master is sending the speakers, recorded
sample-accurately from the next grid boundary by a recorder worklet that
is handed frame numbers, not times. The cycle is the least length on
which every sounding deck and the grid land together (capped at 64
beats), so the bounce loops as seamlessly as its parts. The recording is
peak-normalized to −1 dBFS, stamped with the mix's tempo and key, and
encoded into a carrier tiled from the sounding decks' artwork — a mix's
cover is the covers it is made of. What comes out is an ordinary mix
stegassette: drop it back in and mix with it.

## Three engines: pitched, tape and grain

The deck chain is buffer → pitch engine → gain → drive → pan → master,
and the pitch engine is one of three.

**pitched** is the phase vocoder. Tempo is the source's playbackRate; the
vocoder is handed the reciprocal so pitch does not follow it, then moved
by however many semitones the key match asks for. Tempo and pitch are two
knobs.

**tape** is plain resampling: the same playbackRate, and the pitch lands
where the rate puts it. One knob, perfect fidelity — no vocoder loss, no
transient smear, no makeup gain. The cost is that a tonal loop pulled 6%
fast is 6% sharp.

**grain** is a time-domain granular shifter (`grain-processor.js`):
2048-sample Hann grains at half overlap, each resampled for pitch with
its end anchored to the clock. A transient lives inside one grain, plays
once at full speed, and lands on time — the opposite trade from the
vocoder, which smears attacks but holds a chord together. Sustained
tones pick up a grain-rate texture instead. It is the Beats to the
vocoder's Complex, in Ableton's terms. At a factor of exactly 1 it
reassembles the input bit-for-bit.

**Auto is the default, and it picks per deck at every launch.** It asks
what tape would cost — the gap between the pitch the rate imposes and
the pitch the mix wants — and below half a semitone it takes tape,
because a slight mistuning costs less than any processing. Past that the
material decides: `mode: "none"` takes grain, whose grains pass
transients whole, and everything tonal takes the vocoder, which holds a
chord together. Syncing near-tempo loops is the common case, and under
auto it costs nothing.

The decision is re-made whenever a deck launches or relaunches, so a
mid-play tempo change keeps the current chain until the next restart.
Forcing **pitched** or **tape** overrides it per deck; a playing deck
restarts on the next bar, because the engines run different node chains.

Both engines run at the same fixed latency. The vocoder's overlap-add
costs 2048 samples; a tape deck carries the same 2048 as plain delay,
so decks on different engines stay locked together.

## Pitch costs level, and how much depends on the material

At a pitch factor of exactly 1, the vocoder reconstructs perfectly. At
anything else, it shifts spectral peaks and their regions of influence,
and whatever falls between peaks is discarded. Measured against the same
source at unity:

| material            | RMS off unity        | crest factor    |
| ------------------- | -------------------- | --------------- |
| sustained, harmonic | −0.3 to −0.8 dB      | unchanged       |
| percussive          | **−9.4 to −10.1 dB** | 6.1 → 7.5–10.9  |

Each pitched deck therefore **measures its own** makeup: it renders a
second and a half of its loop through the vocoder at a shifted pitch,
compares RMS against dry, and applies the difference as a gain whenever
the vocoder's factor is off unity. The factor is what the makeup follows,
not the key shift alone — a deck synced a few bpm with no key change is
off-unity too. A tape deck skips the probe until the vocoder is ever its
engine — tape needs no makeup.

The rising crest factor is a smear, not a level, and no makeup gain
addresses it. That is inherent to this vocoder, and it is the reason
drums default to tape.

## Staying in time

Three things move a deck off the grid, and each is handled where it
happens.

**A rate change mid-cycle.** A change to one deck's speed changes how many
mix beats its loop spans, so the fraction it is through the buffer now
means a different number of beats than it did a moment ago. Both **½/2×**
and a **beats** change relaunch that deck on the next grid boundary. That
is the only way back.

**A global tempo change.** Every deck's rate scales together, so relative
phase holds — but a write to an audio parameter "now" lands on the next
render quantum, up to 2.9 ms later than the transport thinks. So tempo
changes are scheduled at an explicit time, and the transport is
re-anchored at that same instant. The two cannot disagree.

**Moving loop points under a playing source.** It wraps wherever the
playhead happens to be, mid-beat. Hence the relaunch, not an edit in
place.

Verified by twelve tempo, speed and range changes driven back to back
across four stacked decks, with every deck's position checked against the
transport afterwards.

## If a browser goes silent

Safari has served a stale `lib/phase-vocoder-processor.js` across reloads,
`no-store` and all. The symptom is the mixer playing with no sound and no
error — `engine.playing` true, context running, decks loaded. To quit and
reopen Safari cleared it. Check that before you read any code.

`await mixTrace()` in the console, while playing, measures RMS at each
stage of a deck's chain — `mixTrace(900, 2)` traces the third deck. The
first stage that reads zero is the one at fault. Drums are sparse, so one
near-zero snapshot can land between hits; run it a few times before
believing it.

## The vocoder

Pitch shifts land within 0.6 cents across ±12 semitones and 110–1760 Hz,
and a 12-partial sawtooth shifts with every harmonic inside 0.8 cents.
That took two fixes in `@amplib/sound-transformation`, both worth knowing
about before you touch that file: it rounded each shifted spectral peak to
a whole FFT bin and advanced phase by the same rounded amount, and it
measured the shift from the bin that contains a partial, not from the
partial. Together those detuned shifts by up to 38.6 cents.

## The demo set

`media/` holds loop stegassettes the mixer offers as **try the demo set**
— one click and the mixer plays, with no setup. See
[media/README.md](media/README.md) for how the manifest works and what
makes a good set.

## Vendored code

`../lib/sound-transformation.js` and `../lib/phase-vocoder-processor.js`
are vendored build output from `@amplib/sound-transformation`, the same
way `../lib/stegassette.js` is vendored from `@amplib/steganography`.
**Never hand-edit them** — the repo README owns the re-vendoring story.
The format itself is not vendored at all: [`engine.js`](engine.js) imports
`../loop/format.js` in place, one repo, one home.
