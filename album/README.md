# album

Builds and plays **albums** made of STGC stegassettes. Runs entirely in the
browser — open `album/` from the served repo, with no build step.

An album is a folder of PNGs:

```
00-cover-<slug>.png    the record. Carries album.json — metadata, ownership,
                       per-track lyrics with timestamps, the audio format,
                       and the album key — plus the cover artwork.
<track>-<part>-<slug>.png   one part of one track: part.json (album id,
                            track, part, of, iv) and that part's PCM.
```

A track part's audio is **always a raw PCM entry** — `audio/L16; rate=…;
channels=…` — encrypted or not. Encryption changes the bytes, never the
type. So any STGC player treats a track image as audio, with nothing to
deduce. With the cover it is the music. Without it, the ciphertext plays as
the noise it is.

A track is cut into as many parts as you ask for. One song can span one
image or twelve. The cut is by **frames**, and each part is laid out on its
own. So every image holds a whole self-contained segment — all channels, no
half samples. One image is playable by itself. It never holds, say, only
the left channel's first half, under either channel layout. The parts laid
end to end restore the track exactly. Both properties are verified
bit-exact against the source PCM.

## Build

Drop a folder, or pick files. The console sorts them out by type:

| input | becomes |
| ----- | ------- |
| audio (`mp3 wav m4a flac ogg …`) | tracks, in name order; titles strip leading numbers |
| images | carriers. One named `cover*` (else the first) is the record; the rest carry track parts, used in turn |
| `.lrc` / `.txt` matching a track's name | that track's lyrics |
| `album.json` | prefills the metadata and ownership fields |

Then set the album metadata, the ownership (who bought the record), the
audio format, **images per track**, the **encoding method**, and
**normalization**. The build writes the stegassettes and offers them one by
one or as a zip.

**Encoding method** — any combine, traversal, and keymap the format
supports, plus the border. The combine decides how much the payload
disturbs the artwork. The traversal is the order the payload fills the
image, and so the order it develops in on playback. The choice is recorded
in `album.json` and carried in each stegassette's own header. Playback
needs no configuration.

**Normalization** — `album` applies one shared gain: the loudest moment on
the record hits the target, and the tracks keep their relative loudness.
`track` brings every track to the same peak. `off` leaves the levels
alone. The default is album at −1 dBFS.

**Layout** — `planar` keeps a channel contiguous inside each image.
`interleaved` sits the channels side by side. Either way a part carries
whole frames, so either is playable on its own.

**Encrypt to the cover** — on by default: the album key encrypts the PCM
with AES-GCM, so the images are noise until the cover supplies the key.
Turn it off and the same entries carry the audio in the clear. Then every
image plays as music on its own anywhere, and the cover is only metadata,
lyrics and artwork.

The browser decodes the audio, so anything it can play is valid input. The
artwork keeps its own resolution when it has room for the payload. It is
enlarged only when the payload needs more pixels. More images per track
means smaller images — the estimate line shows the tradeoff before you
build.

Lyrics are LRC-style, `[mm:ss.xx]` or `[mm:ss.xxx]`. A line can carry
several stamps:

```
[00:12.50]the first line
[00:16.00]the second
```

Enhanced LRC times individual words too — `<mm:ss.xx>` before each — and
the player lights them one at a time as they arrive:

```
[00:12.50]<00:12.50>the <00:12.90>first <00:13.40>line
```

Word times are kept when a line carries a single stamp. With repeated
stamps there is no way to tell which occurrence they belong to.

## Play

Drop the album folder. The player reads every stegassette, finds the cover,
and takes the key from it. It shows the album: artwork, metadata,
ownership, and a track list with the parts it found. Click a track to
decrypt and play it. The album then plays through.

Lyrics run as a **stream** — the sung line with its neighbours on either
side. Lines swap in place, so nothing scrolls out from under you. Where a
line has word timings, its words light up one by one. `raw lyrics` opens
the whole text with timestamps. It follows the playhead, but moves only
when the line changes.

Images play **in sequence as they load**. The first one starts as soon as
it is decrypted. The player queues the rest onto the audio clock during
playback. So a track that spans twelve images begins as quickly as one —
time to first sound does not grow with the length of the song. Each start
time comes from the part's own position, so the joins are sample-accurate.
When an image misses its slot, the player skips into it by however late it
is. The audio never drifts behind the playhead.

Every image in the album sits on the shelf at the bottom, and the one now
being read is lit. One image per track packs into a single row. Several
images per track get a row each, with the title beside it. Above the shelf,
the current image **develops as it decodes**: the player clears the encoded
picture away in the stegassette's own traversal order, in step with the
audio that comes out of it. Each part holds a contiguous stretch of time,
so image 2 of 3 develops during its own third of the song.

Drag the seek bar to move through a track. The playhead lands where you put
it, the images re-develop from that point, and the lyrics follow. A stop
keeps your place.

## Without the cover

The parts describe their own format and position. So images loaded alone
are still grouped into tracks and played. You get whatever they can give on
their own:

- **not encrypted** → the real audio, exactly as it plays with the cover.
  Only the titles, lyrics, ownership and artwork are missing.
- **encrypted** → there is no key. What plays is the encrypted bytes as the
  PCM they are declared to be: white noise, at the right length, with the
  images developing as it goes. It plays at a fifth of full scale, because
  ciphertext is full-scale noise. The music itself stays unreachable.

The same holds outside this console. Drop a track image into the plain
stega-now player and it plays it as PCM — music or noise, as the case may
be.

## Re-encoding from the audio

An encrypted image's pixels come from ciphertext, which is random. So they
carry no trace of the music. With the cover loaded, the plaintext is in
hand. **Re-encode from the audio** makes the images again from the samples
themselves. The carrier is the artwork reconstructed out of the
stegassette, and every data pixel now derives from a real sample. Combines
that track amplitude show it. Under `signed`, pixels moved away from the
artwork by an average of 40.8/255 with ciphertext, and 2.2/255 re-encoded.
Quiet audio leaves a pixel where it was; only amplitude displaces it.

The result is an unencrypted set that plays anywhere, with the same audio.
It is verified identical to the decrypted original.

## Volume

The player has its own volume, and shows the peak level of the image being
played. So quiet material reads as quiet, not as a broken player.

Missing track parts are named. A track offers to play only when all of its
parts are there.

## On "encryption"

Possession-based, and worth stating plainly: the AES-GCM key lives in the
cover stegassette, so the tracks are noise without it. You need the
original album to play the songs. It is **not** protection against someone
who has the cover — to hold the record is to hold the key. That is the
intent, not a DRM claim.
