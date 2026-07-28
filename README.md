# stega-now

Playback for [stegassette](../_labs/stegassette) STGC cartridge PNGs. Static —
`index.html` + `lib/steg-core.js`, serve anywhere.

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

A cartridge with an HTML entry boots that entry; a bar with the entry list
appears only when there is more than one.

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
