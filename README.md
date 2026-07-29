# stega-now

Playback for stegassette STGC cartridge PNGs. Static — `index.html` +
`lib/steg-core.js`, serve anywhere.

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
**hold it down to delete it**, `add` to load a new PNG. The playing cartridge
stays active across reloads until you eject.

`?src=<url>` fetches a cartridge PNG (same-origin or CORS), stores it in the
library, and plays it — a direct link to an app.

## Sandbox

HTML cartridges run in a sandboxed iframe — an opaque origin, so a cartridge
can't touch this site's storage, cookies, or DOM, or another cartridge's
data. The sandbox also blocks the cartridge's own `localStorage`, so the
player injects a shim: cartridge apps that use plain `localStorage` keep
working, their data saved per cartridge and deleted with it.

---

`lib/steg-core.js` is vendored from `stegassette/lib/steg-core.js` — re-copy
it when the format changes.
