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

Then set album metadata, ownership (who bought the record), audio format, and
**images per track**. Building writes the cartridges and offers them
individually or as a zip.

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

Without the cover you get **locked** — the parts are present but they are
AES-GCM ciphertext and there is no key. Missing track parts are named, and a
track only offers to play when all of its parts are there.

## On "encryption"

Possession-based, and worth stating plainly: the AES-GCM key lives in the
cover cartridge, so tracks are noise without it — you need the original album
to play the songs. It is **not** protection against someone who has the
cover; holding the record means holding the key. That is the intent, not a
DRM claim.
