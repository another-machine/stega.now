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

## Two halves

They are chosen separately, so all four combinations work:

| the picture | the sound |
| ----------- | --------- |
| frames grabbed out of a video you record | the audio recorded alongside that video |
| images you already have | a message you record into it |

**Record yourself**, then scrub the take and grab the moments you want.
`spread across every frame` takes one frame from each equal share of the
recording, which fills a layout in a click; grabbing by hand puts a chosen
moment in a chosen frame, and the aim moves on to the next empty one. Frames
are grabbed at the camera's own resolution, so the layout is drawn from the
full picture no matter how small a frame it lands in. `mirror` is how you are
used to seeing yourself — it applies to everything the camera has given, not
to each grab.

The camera and the microphone are one take: the video keeps the pictures and
the sound gets its own audio file, recorded from the same live stream. Reading
samples back out of a *video* container is not something every browser will
do, and the samples are the part this can't do without.

You can also **use a video file** instead of the camera, and its own audio
comes back out of it with the browser's decoder. If the browser refuses that
container, the build says so rather than making a silent stegassette.

**Images and a message** is the other way round: hand it pictures, record a
voice message into them. Fewer images than frames repeat around the layout.

## The layout

A template is a set of frame rects given as fractions of the picture, so it
holds its shape at any aspect ratio and any size — `one frame`, two across or
down, strips of three and four, 2×2, 3×2, 3×3, `one big, three under`, `one
big, two beside`. Each frame is filled centre-cropped rather than squashed.

`aspect` is the shape of the whole picture, `gap` opens the frames apart by a
share of the short side, `matte` is what shows through the gaps.

## Size

The stegassette is rendered at the size the sound needs, rather than scaling a
small composite up: the frames are drawn straight at the final resolution, so
every data pixel carries a real sample and the picture is as sharp as the
camera allowed.

`least size` is a floor on the long edge, because a ten-second message would
otherwise come out as a thumbnail. It is only ever a floor — more sound asks
for more pixels. The estimate line says what the picture will be and **how
much of it the sound reaches**: pixels past the payload are never written, so
they are already developed before playback starts, and a picture sized well
past its sound only animates a strip of itself. A smaller least size, a higher
sample rate or 16-bit instead of 8 all close that gap.

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
