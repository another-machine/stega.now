# me

A stegassette of you: a picture with your own voice hidden in its pixels. Runs
entirely in the browser — open `me/` from the served repo, no build step.

One PNG comes out, and it is a plain STGC stegassette:

```
me-<who>-<date>.png    a raw PCM entry (the sound) and me.json — who it is
                       from, the layout the picture was built with, the
                       audio format, and the pattern used to hide it
```

The sound is deliberately the **first** entry, so a player that has never
heard of stega-me opens the stegassette on it: drop one into the plain
stega-now player and it plays the voice while the picture develops out of
its own pixels. Nothing here is a private format — it is the stegassette
format, used for one person.

## Three ways

The picture and the sound are picked as one choice, because only some of the
pairings mean anything — an image has no audio of its own to take:

| | the picture | the sound |
| - | ----------- | --------- |
| **record myself** | frames grabbed out of the take | the voice recorded alongside it |
| **images I have** | images you supply | a message you record into them |
| **a video file** | frames grabbed out of the file | the file's own sound |

They were two separate radio groups once, defaulting independently, which
meant picking `images I have` left the sound still asking for a video that was
never going to arrive: every frame filled, and the make button silently
disabled with nothing on screen saying why. Now there is one choice, and when
something is still missing the page says which half it is.

**Record yourself**, then scrub the take and grab the moments you want.
`spread across every frame` takes one frame from each equal share of the
recording, which fills a layout in a click; grabbing by hand puts a chosen
moment in a chosen frame, and the aim moves on to the next empty one. At the
default `one frame` there is nothing to spread across, so that button is not
there and `grab` reads `grab this moment`.

A grab waits for the frame it seeked to actually be presented before it copies
the picture. `seeked` only says the seek landed, and drawing on that alone can
copy the frame that was already there — which is how a spread comes out as
several copies of one moment. The wait is bounded rather than open-ended,
because a backgrounded tab presents no frames at all and would otherwise hang
every grab.

Every wait in the grab path is bounded, in fact, because a camera take is a
MediaRecorder blob and those get to refuse things a file never refuses: the
duration can stay `Infinity` no matter how it is provoked, and a seek past the
media's real end — where a duration taken from the recording clock will
happily send the last frame of a spread — can simply never fire `seeked`.
Await either without a bound and the page stops filling frames silently, with
nothing in the console to say why. Seeks are clamped to the seekable range and
time out; the duration probe times out and falls back to the recording clock. Frames
are grabbed at the camera's own resolution, so the layout is drawn from the
full picture no matter how small a frame it lands in. `mirror` is how you are
used to seeing yourself — it applies to everything the camera has given, not
to each grab.

The camera and the microphone are one take: the video keeps the pictures and
the sound gets its own audio file, recorded from the same live stream. Reading
samples back out of a *video* container is not something every browser will
do, and the samples are the part this can't do without.

**A video file** is the same thing without the camera: its own audio comes
back out of it with the browser's decoder. If the browser refuses that
container, the build says so rather than making a silent stegassette. A
supplied video is already the right way round, so `mirror` leaves it alone
even if you switch back to `record myself` with it still loaded.

**Images and a message** is the other way round: hand it pictures, record a
voice message into them. Fewer images than frames repeat around the layout.

## Under `sound format, pattern, layout`

The next three sections are all folded behind one disclosure at the bottom of
the page. Nothing is gone — the pattern is the interesting part of the format
and every option the codec has is still there — but none of it is something
you have to have an opinion about before you can make a stegassette. The
defaults make one; open the fold when you want a different one.

## The layout

A template is a set of frame rects given as fractions of the picture, so it
holds its shape at any aspect ratio and any size — `one frame` (the default),
two across or down, vertical strips of three and four, 2×2, 3×2, 3×3, `one
big, three under`, `one big, two beside`. Each frame is filled centre-cropped
rather than squashed.

`aspect` is the shape of the whole picture, `gap` opens the frames apart by a
share of the short side, `matte` is what shows through the gaps.

`gap` is capped at 0.2 in code, not just on the input — a number input's `max`
stops the spinner but not the keyboard, and a typed gap past 1 is an inset
wider than every frame: nothing draws, the picture is silently all matte, and
grabbing into a frame looks like it does nothing. Type past the cap and the
field snaps back to 0.2 when it commits.

The **vertical strips** are the photobooth ones, and they are the exception to
a template holding its shape anywhere: stacked into a square, four frames are
four letterbox slices, not a strip. So those two carry a suggested aspect —
1:3 and 1:4, which is what makes the frames come out square — and picking one
moves `aspect` with it. It is borrowed rather than taken: leaving the strip
puts the aspect back to square, but only if the strip is what set it. Choose a
shape yourself and it is yours, both against later templates and across
leaving the strip you chose it on.

## Size

The stegassette is rendered at the size the sound needs, rather than scaling a
small composite up: the frames are drawn straight at the final resolution, so
every data pixel carries a real sample and the picture is as sharp as the
camera allowed.

There is no size setting, because the size is not a free choice: the picture
is exactly the pixels the sound needs. Ask for more picture than the sound can
reach and the extra pixels are never written — they are already developed
before playback starts, so the waveform ends partway down and the reveal stops
early on a picture that is mostly just sitting there. That is the whole reason
a `least size` floor used to exist and the whole reason it no longer does.

So **the sound is the size control.** More seconds, a higher sample rate or
16-bit instead of 8 all buy pixels that carry samples, which is the only kind
of bigger that still develops end to end:

| ten seconds of mono | picture |
| ------------------- | ------- |
| 8-bit 8000 Hz       | 242×242 |
| 8-bit 22050 Hz      | 400×400 |
| 16-bit 22050 Hz     | 565×565 |
| 16-bit 44100 Hz     | 799×800 |

The estimate line says what the picture will be and that it develops end to
end. One floor is real and cannot be argued with: the STGC header needs a
certain width to live in, about 144 px, so a sound too small to fill even that
leaves the rest of the picture undisturbed — a second of 8-bit 8000 Hz reaches
30% of it. The estimate says so, and the only fix is more sound.

## The sound

8-bit or 16-bit raw PCM, at 8000–44100 Hz, mono or stereo, `planar` or
`interleaved`. 8-bit is grainier and half the pixels — the same take, a very
different picture. Normalization brings the peak to −1 dBFS by default, so a
voice recorded quietly plays back as a voice rather than as a broken player.

## The pattern

Any combine, traversal, keymap and packing the format supports, plus the
border, and `surprise me` if you would rather not choose:

- **combine** decides how much the voice disturbs the picture. The payload
  here is real audio — never ciphertext — so combines that track amplitude
  show it: under the default `signed`, silence leaves a pixel exactly where
  it was and only loudness displaces it, so the picture wears the waveform.
- **traversal** is the order the sound fills the picture, and therefore the
  order it develops in as it plays back. `boustrophedon` wipes in scanlines,
  `bayer` develops the whole frame evenly, `spiral` winds in.
- **packing** is how many of a pixel's channels carry sound. `packed` uses
  all three; `aligned` lands one sample per pixel (two channels at 16-bit,
  one at 8-bit, so untouched channels keep the picture); `mono` broadcasts
  each byte to all three for a grey ghost, at one byte per pixel — three
  times the pixels for the same sound.

The choice is written into me.json and carried in the stegassette's own header,
so playing it back needs no configuring.

## Play

`play one` reads a stegassette back: who it is from, the format, the pattern,
and the sound with the picture developing as it plays. Drag the playhead and
the picture re-develops from there. Any STGC stegassette with a PCM entry plays
here, stega-me or not.
