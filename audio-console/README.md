# audio console

Builds and plays **albums** made of stegassette STGC cartridges. Runs entirely
in the browser — open `audio-console/` from the served repo, no build step.

An album is a folder of PNGs:

```
00-cover-<slug>.png    the record. Carries album.json — metadata, ownership,
                       per-track lyrics with timestamps, the audio format,
                       and the album key — plus the cover artwork.
<track>-<part>-<slug>.png   one part of one track: part.json (album id,
                            track, part, of, iv) and that part's encrypted PCM.
```

A track's PCM is a single byte stream cut into as many parts as you ask for,
so one song can span one image or twelve. Concatenating the parts in order
restores the stream exactly — verified bit-exact against the source PCM.

## Build

Drop a folder (or pick files). The console sorts them out by type:

| input | becomes |
| ----- | ------- |
| audio (`mp3 wav m4a flac ogg …`) | tracks, in name order; titles strip leading numbers |
| images | carriers. One named `cover*` (else the first) is the record; the rest carry track parts, used in turn |
| `.lrc` / `.txt` matching a track's name | that track's lyrics |
| `album.json` | prefills the metadata and ownership fields |

Then set album metadata, ownership (who bought the record), audio format,
**images per track**, the **encoding method**, and **normalization**. Building
writes the cartridges and offers them individually or as a zip.

**Encoding method** — any combine, traversal, and keymap the format supports,
plus the border. The combine decides how much the payload disturbs the
artwork; the traversal is the order the payload fills the image, and therefore
the order it develops in on playback. The choice is recorded in `album.json`
and carried in each cartridge's own header, so playback needs no configuring.

**Normalization** — `album` applies one shared gain so the loudest moment on
the record hits the target and the tracks keep their relative loudness;
`track` brings every track to the same peak; `off` leaves levels alone.
Default is album at −1 dBFS.

Audio is decoded by the browser, so anything it can play is valid input. The
artwork keeps its own resolution whenever it has room for the payload; it is
only enlarged when the payload needs more pixels. More images per track means
smaller images — the estimate line shows the tradeoff before you build.

Lyrics are LRC-style, `[mm:ss.xx]` or `[mm:ss.xxx]`, several stamps per line
allowed:

```
[00:12.50]the first line
[00:16.00]the second
```

## Play

Drop the album folder. The player reads every cartridge, finds the cover,
takes the key from it, and shows the album: artwork, metadata, ownership, and
a track list with the parts it found. Click a track to decrypt and play it;
the album then plays through. Lyrics scroll inline, the current line lit from
the playhead.

Every image in the album is on the shelf at the bottom, and the one being read
right now is lit. Above it, that image **develops as it decodes** — the
encoded picture is cleared away in the cartridge's own traversal order,
exposing the artwork underneath, in step with the audio coming out of it.
Because tracks are stored interleaved, each image holds a contiguous stretch
of time, so image 2 of 3 develops during its own third of the song.

Drag the seek bar to move through a track. The playhead lands wherever you
put it, the images re-develop from that point, and the lyrics follow. Stopping
keeps your place.

Without the cover you get **locked** — the parts are present but they are
AES-GCM ciphertext and there is no key. Missing track parts are named, and a
track only offers to play when all of its parts are there.

## On "encryption"

Possession-based, and worth stating plainly: the AES-GCM key lives in the
cover cartridge, so tracks are noise without it — you need the original album
to play the songs. It is **not** protection against someone who has the
cover; holding the record means holding the key. That is the intent, not a
DRM claim.
