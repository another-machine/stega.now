# stega-now

Playback for stegassette STGC cartridge PNGs. Static — `index.html` +
`lib/stegassette.js`, serve anywhere.

Add a cartridge and stega-now decodes it in the browser and plays back
whatever it holds:

| entry mimetype | playback                                   |
| -------------- | ------------------------------------------ |
| `text/html`    | full-viewport app (sandboxed iframe)       |
| `text/*`       | text                                       |
| `image/*`      | image (click toggles fit / 100%)           |
| `audio/L*`     | raw STGC PCM via Web Audio (loopable)      |
| `audio/*`      | `<audio>` element (loopable)               |
| anything else  | download link                              |

A cartridge with an HTML entry boots that entry. While playing, a slim bar
shows the cartridge name and an eject button; entry buttons join it when the
cartridge holds more than one entry.

## Reveal

Encoding hid the payload in the cover's pixels, so reading it back develops
the cover again: the encoded image sits over the reconstruction and every
pixel that has been read is cleared away, resolving the picture in the
cartridge's own traversal order.

Audio drives it directly — the image develops as its own sound plays, and
loops redevelop it. Cartridges with no audio have no playhead, so their
reveal runs fast on a timer with a `replay` button; data-only cartridges open
on it, and any cartridge's reveal is a click away via `reveal` in the bar.

## Groups

A stegassette split spreads one audio track across many images. `select`
switches the library into selection mode; tick two or more cartridges and
`group` puts them in a group, ordered automatically by the numbering in
their names (`(3/12)`, or a trailing number). A group previews its members on
the main page; `edit` renames, reorders, or removes parts.

Click a group to play the whole thing. If every part carries raw PCM at a
common format, the parts are copied into one buffer end to end and play with
no seam at the image boundaries — the filmstrip marks the part currently
sounding, and its image develops as it goes. Otherwise the group just lists
its parts to play one at a time.

## Library

Added cartridges are kept as blobs in IndexedDB. When nothing is playing you
see the library: the cartridge images themselves. Click one to play it,
**hold it down to delete it**, `add` to load PNGs — one plays straight away,
several stay in the library in name order, ready to group. The playing
cartridge stays active across reloads until you eject.

`?src=<url>` fetches a cartridge PNG (same-origin or CORS), stores it in the
library, and plays it — a direct link to an app.

## Sandbox

HTML cartridges run in a sandboxed iframe — an opaque origin, so a cartridge
can't touch this site's storage, cookies, or DOM, or another cartridge's
data. The sandbox also blocks the cartridge's own `localStorage`, so the
player injects a shim: cartridge apps that use plain `localStorage` keep
working, their data saved per cartridge and deleted with it.

## Sub-projects

- [audio-console](audio-console/) — builds and plays albums: songs split
  across one or more images per track, with a cover cartridge holding
  metadata, ownership, timestamped lyrics, and the key that decrypts the
  tracks.
- [me](me/) — a cartridge of you: record yourself, lay frames out in a
  template, and hide the recording's own audio in the picture — or record a
  message into images you already have.
- [workout](workout/) — a band workout routine as a cartridge-ready page:
  opens on today's session, tap exercises to mark them done, stopwatch in
  the masthead. The program lives in [workout/ROUTINE.md](workout/ROUTINE.md).

---

`lib/stegassette.js` is the codec, vendored from the library that publishes
it:

    curl -o lib/stegassette.js https://amplib.app/lib/stegassette.js

It exposes `window.Stegassette` and comes from
[@amplib/steganography](https://github.com/another-machine/public-library/tree/main/packages/amplib-steganography),
built as a self-contained IIFE so these pages stay no-build. `npm run
codec:check:remote` in the stegassette lab compares this copy against the
published one and fails on drift.

The API is not the same as the old vendored `steg-core.js` it replaced:
`encodeContainer` takes `(entries, srcImg, opts, keyImg)` rather than
`(entries, srcImg, keyImg, opts)`, and the keymap option is spelled
`keymap`, not `keyMap` — the package throws on the old spelling rather
than silently encoding with `adjacent`.
