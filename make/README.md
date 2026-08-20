# make

The stegassette editor. Drop in an image and some audio, choose how to hide
one in the other, and get a stegassette PNG back.

One HTML file, with no build step. It loads the same `../lib/stegassette.js`
that the player and the galleries load, plus `../lib/stegassette-jobs.js`
for the job schema. So you can paste a `jobs/*.jobs.json` file from
[stegassette-jobs](https://github.com/ja-k-e/stegassette-jobs) straight in,
and the editor can emit one back.

Encoding runs in a Blob worker that `importScripts` the same bundle the
page uses. Big audio means large RGBA buffers, and the UI thread should not
hold them. When workers or OffscreenCanvas are unavailable, encoding falls
back to the main thread.

This moved here from `ja-k-e/labs-stegassette`. That repo served one page
while it also carried a batch pipeline and gigabytes of media.

## How it works

Audio PCM bytes are written into the RGB channels of a checkerboard pattern
of "data pixels." Each data pixel is paired with a "key pixel" from the
original image. A combine operation (XOR, midpoint, additive, etc.) maps
the audio byte value into the pixel delta between the pair. So the image
stays visually similar to the source. A fixed binary header (`STGC`) is
stored in the alpha channel of the bottom border row.

A single PNG can carry multiple payloads — audio plus optional `text/plain`
entries. A compact entry table at the start of the interior stream
describes them. Audio is optional: a stegassette of only text or files
encodes fine. A long recording can also **split across a series of
images**. Each image carries one chunk of the audio plus its own text (see
[`split`](#one-audio-across-many-images--split)).

Four independent, header-persisted dimensions control the look and layout:

- **traversal** — the order the data pixels are visited
- **keymap** — which key pixel each data pixel pairs with (`adjacent` /
  `poles` / `mirror-x` / `mirror-y`)
- **combine** — how an audio byte blends with the key byte
- **channel plan** — how the byte stream is painted across R/G/B (see
  below)

### Channel plan

The channel plan decouples the byte stream from the pixel channels. It is
an ordered list of slots. Each slot paints one stream byte onto one channel
(`r`/`g`/`b`) with its own combine op. Channels that no slot names pass
through from the source image untouched. So you can modify only red and
leave green and blue visible, bias a channel by slot order, or mix combine
ops per channel (e.g. red `additive`, green `xor`). `bytesPerPixel` equals
the number of active slots.

Three packing modes derive a plan from one primitive:

- **`packed`** (default) — the active channels are an ordered subset of
  `[r, g, b]` (default all three, `r→g→b`), and the stream flows
  continuously. This is the densest mode, and the default reproduces the
  original behaviour byte-for-byte.
- **`aligned`** — the active channel count is auto-set to
  `min(bytesPerSample, 3)` (8-bit → 1 ch, 16-bit → 2 ch, 24-bit → all 3).
  So one audio sample lands in one pixel, and a chosen channel always
  carries the same byte-within-sample (e.g. the loud MSB → red). The
  payload is padded to a pixel boundary to guarantee this.
- **`mono`** — one stream byte drives R, G, and B identically
  (1 byte/pixel). Each channel decodes independently to the same value.
  The result is a pure-luminance ghost with no chroma fringing. Best paired
  with `signed`.

## Browser UI

Serve `index.html` from any static file server (e.g.
`python3 -m http.server`) and open it in a browser. No build step is
required.

**player** — drop an encoded PNG to decode it and play back the audio. A
waveform overlay shows the playback position. Use "↓ reconstruct" to export
the raw PCM.

**capture modes** — a mode bar picks what a stegassette is made from. The
settings sidebar, the entries list, the jobs queue and the player are
shared by all four modes; only the capture area changes. A mode is never
stored in the JSON — it is **derived** from the job
(`StegConfig.jobMode`). So a jobs file and the editor cannot disagree:

| mode     | source                                                     | job shape                        |
| -------- | ---------------------------------------------------------- | -------------------------------- |
| `data`   | an image + entries, no audio                               | no audio entry (data-only)       |
| `clip`   | one image, one trimmed audio clip                          | one audio entry                  |
| `series` | one audio divided across several images                    | a `split` block                  |
| `video`  | stills grabbed off a video, tiled into the cover           | a `frames` block                 |

**chunk editor (series)** — the trim region is the *source window*, and the
chunks subdivide it. Divide into N `equal` chunks, `fit MP` to a per-image
pixel budget, or click the waveform and `÷ at caret`. Each chunk gets its
own cover. Drop a set of images and press `↧ images`: it assigns them in
filename order. With no chunks made yet, it divides the window into one
chunk per image — usually what you want, because the covers are the count.
Each chunk also gets its own `out` path and its own text entries. The
shared entries below the waveform go on every chunk. Chunk boundaries are
drawn over both waveforms. Click a chunk's number to load it into the trim
and image slots: `▶` previews it, and `encode` renders that one
stegassette. `encode all ↓` renders and downloads every chunk. `copy json`
emits either the compact `split` job or the expanded jobs array.

**jobs queue** — drop a jobs array (the same `jobs/*.json` schema) to load
every item as a clickable list. Select an item to load its settings and
texts (and, for a `split` job, its chunk rows). If you also drop the
referenced images and audio, they auto-attach, matched by filename. "copy
as json" exports the current item.

## Batch encoder (Node.js)

`encode-batch.js` processes a JSON array of jobs. It requires `ffmpeg` and
`ffprobe` on `PATH`, and `pngjs` installed.

```
npm install
node encode-batch.js runs/my-project/jobs.json
```

### Job fields

Top-level fields control image sourcing and steg/visual settings:

| field       | default    | description                                                                                   |
| ----------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `image`     | —          | source image path (jpg/png/mp4/etc. — any format ffmpeg can decode)                           |
| `out`       | —          | output base path, **no extension** — `encode-batch` writes `<out>.png`, `video-batch` writes `<out>.mp4` (a trailing `.png` is tolerated for older files) |
| `combine`   | `xor`      | pixel combine op — see below                                                                  |
| `traversal` | `raster`   | pixel traversal order — see below                                                             |
| `keymap`    | `adjacent` | key pixel pairing strategy — see below                                                        |
| `border`    | `0`        | extra border width added to the minimum of 1                                                  |
| `aspect`    | `original` | aspect ratio override: `original`, `16:9`, `4:3`, `1:1`, `9:16`, `3:4`, or `[W, H]`           |
| `seed`      | random     | integer seed for `fisher-yates` traversal                                                     |
| `angle-a`   | `1`        | `a` param for `angle` traversal                                                               |
| `angle-b`   | `1`        | `b` param for `angle` traversal                                                               |
| `pack`      | `packed`   | channel-plan packing mode: `packed`, `aligned`, or `mono` (broadcasts one byte to R=G=B)      |
| `channels`  | all RGB    | channel plan — `"rgb"`/`"bgr"`, `"r.additive+g.xor"`, or `[{ ch, combine }, …]`               |
| `kx`        | `0`        | x offset for `offset` keymap (torus-wrapped)                                                  |
| `ky`        | `0`        | y offset for `offset` keymap (torus-wrapped)                                                  |

`entries` is an ordered array. Audio is optional — a job with only file or
text entries encodes a data-only stegassette. Each item is one of:

**Audio entry** — encoded through the ffmpeg pipeline:

| field       | default    | description                                                                                   |
| ----------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `path`      | —          | audio file path (mp3/wav/etc.)                                                                |
| `name`      | `""`       | label stored in the entry table                                                               |
| `start`     | `0`        | trim start in milliseconds                                                                    |
| `end`       | file end   | trim end in milliseconds                                                                      |
| `sr`        | `22050`    | sample rate label written to header                                                           |
| `ch`        | `1`        | channels (1 = mono, 2 = stereo)                                                               |
| `bits`      | `16`       | bit depth (8 / 16 / 24)                                                                       |
| `dir`       | `fwd`      | `fwd` or `rev` (reverse audio before encoding)                                                |
| `mode`      | `relabel`  | `relabel` (keep source sample rate, change header label) or `resample` (re-encode via ffmpeg) |
| `normalize` | `off`      | peak normalization: `off`/`null`, `true` (= -1 dBFS), or a dBFS target `<= 0` (e.g. `-1`, `-3`). One shared gain across channels (preserves stereo balance) |
| `layout`    | `planar`   | stereo channel layout: `planar`, `interleaved`, or `block`                                    |
| `blockSize` | `64`       | block size in samples for `block` layout                                                      |

**Binary file entry** — embedded as-is, with the mimetype inferred from the
extension:

```json
{ "path": "cover.jpg", "name": "cover" }
{ "path": "notes.pdf", "mimetype": "application/pdf", "name": "notes" }
```

**Text entry:**

```json
{ "text": "liner notes go here", "name": "description" }
```

### Cover from video stills — `frames`

`image` points at a video, and `frames.at` lists the timestamps (ms) to
grab. One timestamp is just that still. Several stills are tiled by
`layout` (`cols` · `rows` · `2x2` · `3x3` · `4x4`, default `cols`). A video
`image` with no `frames` uses its first frame.

```json
{ "image": "clip.mp4", "frames": { "at": [1200, 45000, 90200], "layout": "2x2" } }
```

An audio entry may point at the same video to use its soundtrack. A
`video/*` path that carries audio params (`sr`/`ch`/`bits`/…) is decoded as
audio, not embedded whole.

### One audio across many images — `split`

`split` replaces `entries`. It expands into one ordinary job per chunk,
each with its own cover, `out` path and text. `encode-batch` and
`video-batch` expand it the same way, so the PNGs and MP4s line up.

```json
{
  "out": "kiddo/tape",
  "combine": "midpoint",
  "split": {
    "path": "tape.mp3", "sr": 11025, "ch": 1, "bits": 8, "mode": "resample",
    "images": ["01.jpg", "02.jpg", "03.jpg"],
    "entries": [{ "name": "Series", "text": "home videos, 1992–2002" }],
    "parts": [
      { "name": "bicycle", "entries": [{ "text": "Getting a bicycle for my 5th birthday." }] },
      { "name": "interview", "entries": [{ "text": "Being interviewed about my birthday." }] },
      { "name": "bass", "entries": [{ "text": "Whistling awkwardly then playing my bass." }] }
    ]
  }
}
```

| field                                | default    | description                                                          |
| ------------------------------------ | ---------- | -------------------------------------------------------------------- |
| `path`                               | —          | source audio every chunk slices                                      |
| `sr` `ch` `bits` `dir` `mode` `normalize` `layout` `blockSize` | audio defaults | audio settings shared by every chunk |
| `start` / `end`                      | `0` / file end | the source window to divide, in ms                               |
| `count`                              | —          | divide the window into N equal chunks                                |
| `chunk`                              | —          | ms per chunk (the count is derived, then evened out)                 |
| `maxPixels` / `maxBytes`             | —          | chunk so each image fits an output-pixel / payload-byte budget       |
| `gap`                                | `0`        | ms of source dropped between chunks                                  |
| `pad`                                | `2`        | digits in the generated `out` suffix (`<out>-01`, `<out>-02`, …)     |
| `image` / `images`                   | job `image` | fallback cover / per-chunk covers, positional                       |
| `entries`                            | `[]`       | entries appended to **every** chunk                                  |
| `parts`                              | —          | per-chunk detail; its length also sets the count                     |

A part may carry `start`/`end`/`image`/`out`/`name`/`entries`. It may also
carry any audio key (`sr`, `bits`, …) or steg key (`combine`, `traversal`,
`border`, …) to override that one chunk. The auto modes always divide into
**equal** chunks — no runt tail.

Batch files and the browser editor share the same JSON shape. The editor's
**config JSON** panel imports a job (it populates every control) and copies
the current settings back out. Both go through one resolver
(`lib/config.js` → `resolveConfig`), and trim units are milliseconds on
both sides.

## Video renderer (Node.js)

Renders the player tab's decode animation to a video file: the encoded PNG
dissolves into the reconstructed cover image in traversal order,
sample-locked to the embedded audio. It requires `ffmpeg` on `PATH`. There
are two entry points, single and batch.

**One file** — `render-video.js`:

```
node render-video.js input.png [out.mp4] [--fps 30] [--loops 1] [--hold 0] [--scale 1] [--crf 18] [--ext mp4]
```

Output defaults to the input name with an `.mp4` extension, or an explicit
`[out.mp4]`.

**A whole jobs file** — `video-batch.js` (same jobs schema as
`encode-batch.js`):

```
node video-batch.js jobs/live.jobs.json [--fps 30] [--loops 1] [--hold 0] [--scale 1] [--crf 18] [--ext mp4]
```

Each job's `out` is an extensionless base path: `encode-batch` writes
`<out>.png`, and `video-batch` reads that PNG and writes `<out>.mp4` beside
it (`live/01-nina-simone.stegassette` → `.png` / `.mp4`). Paths resolve
relative to the jobs file. The encoded PNGs must already exist — run the
encoder first. Per-job failures are reported and skipped. Jobs without an
`out` (e.g. text-only stubs) are skipped quietly.

The two stages are wired as npm scripts per project. So images and videos
can run separately or together:

```
npm run jobs:live:png   # encode PNGs only
npm run jobs:live:mp4   # render videos only (needs the PNGs)
npm run jobs:live       # both, in order
```

`jobs:all:png` / `jobs:all:mp4` / `jobs:all` do the same across every
project.

Options (applied to every job in batch mode):

- `--loops N` renders N full decode cycles in one file. Each cycle resets
  to the encoded image, matching the player's loop behaviour.
- `--hold S` holds the fully revealed frame for S seconds at the end of
  each cycle, with silent audio — a beat of rest that makes loops read
  cleanly.
- `--scale S` scales the output: `>1` is nearest-neighbor (crisp pixels),
  `<1` is area-averaged. Output dimensions are rounded to even for
  `yuv420p`.
- `--maxdim N` caps the largest output dimension to N px, and downscales
  proportionally if needed (default **2600**; `0` disables). iOS Photos
  refuses to play very large videos, so this keeps output safely playable.
  It applies after `--scale` and only ever shrinks. The encoded PNG itself
  is never affected — this is video-only.
- `--ext mp4|webm` sets the output container. `webm` switches to VP9/Opus,
  `mp4` (default) to H.264/AAC. In single mode, an explicit `[out.mp4]`
  path with a `.webm` extension does the same.

Multiple audio tracks are mixed, and they loop independently over the
primary track's cycle, exactly as in the player. The reveal itself comes
from the same shared code the player uses (`StegCore.computeRecon` +
`computeRevealOrder`). So the video matches what you see in the browser.
`video-batch.js` imports `renderVideo()` from `render-video.js`, so the
single and batch paths are the same renderer.

### Combine, traversal and keymap names

The editor builds its option lists from `StegassetteJobs.ENUMS` at load. So
the selects offer exactly what the codec ships, and this README does not
keep a copy. One thing a name alone does not say: `radial` is the
aspect-normalized version of `center-out`. Its expanding front is the
ellipse inscribed in the image, not a circle in pixels, and it takes a
`direction`, `out` or `in`. A `spiral` takes a `rotation`. Every traversal
takes a `fit`: `compact` packs the data rectangle, and `shape` sizes the
canvas to the traversal's own boundary.

## STGC format

```
pixel (0,0) alpha          border width B (1–255)
bottom row alpha (centered) STGC header:
  bytes 0–3   magic "STGC"
  byte  4     version = 1
  bytes 5–8   interior byte length (UInt32LE)
  byte  9     entry count
  byte  10    descriptor length
  byte  11    reserved = 0
  bytes 12+   key=value descriptor pairs, \x01-separated
  last byte   XOR checksum of all preceding header bytes
interior pixels (RGB)
  entry table: [mimetypeLen(2), mimetype, nameLen(2), name, payloadLen(4)] × N
  [pad bytes]  zero-filled gap aligning payloads to a pixel boundary (aligned plans)
  payloads concatenated in entry order
interior alpha  always 255
```

Descriptor keys include `combine`, `keymap`, `traversal` (plus
`seed`/`a`/`b` for parametric traversals, and `kx`/`ky` for the `offset`
keymap). Non-default channel plans add `ch` (the slot token, e.g.
`r.additive+g.xor+b.subtractive`), `pad` (alignment gap byte count), and
`pack` (`aligned` or `mono`). The default plan omits the channel-plan keys.
That keeps the header compact and byte-identical to pre-channel-plan
output.

Zero bytes in the header are clamped to 1. The XOR checksum allows
recovery.
