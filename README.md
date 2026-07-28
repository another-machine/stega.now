# stega-now

Playback for [stegassette](../_labs/stegassette) STGC cartridge PNGs. Static —
`index.html` + `lib/steg-core.js`, serve anywhere.

Add a cartridge and stega-now decodes it in the browser and plays back
whatever it holds:

| entry mimetype | playback                                   |
| -------------- | ------------------------------------------ |
| `text/html`    | full-viewport app (sandboxed iframe)       |
| `text/*`       | text                                       |
| `image/*`      | image                                      |
| `audio/L*`     | raw STGC PCM via Web Audio                 |
| `audio/*`      | `<audio>` element (mp3/wav/ogg payloads)   |
| anything else  | download link                              |

A cartridge with an HTML entry boots that entry; a bar with the entry list
appears only when there is more than one.

## Library

Added cartridges are kept as blobs in IndexedDB (disk-scale quota, so big
images are fine; `navigator.storage.persist()` is requested against
eviction). The active pointer and per-cartridge app data stay in
`localStorage`. When nothing is playing you see the library: the cartridge
images themselves. Click one to play it, **hold it down to delete it**, `add`
to load a new PNG. The playing cartridge stays active across reloads until
you eject. A pre-IndexedDB `stega-now:lib` localStorage library is migrated
automatically on boot.

Audio entries (raw PCM and file payloads alike) have a loop toggle; image
entries click between fit and 100% pixel size.

`?src=<url>` fetches a cartridge PNG (same-origin or CORS), stores it in the
library, and plays it — a direct link to an app.

## Sandbox

HTML cartridges run in a sandboxed iframe (`allow-scripts allow-forms
allow-modals allow-downloads`) — an opaque origin, so a cartridge can't touch
this site's storage, cookies, or DOM, or another cartridge's data. Because the
sandbox also blocks the cartridge's own `localStorage`, the player injects a
synchronous shim seeded from the cartridge's saved data; writes post back to
the parent and persist under `stega-now:app:<id>`, deleted with the cartridge.
Cartridge apps that use plain `localStorage` keep working, isolated per
cartridge.

## Encoding

Lives in the stegassette lab repo. App sources sit in
`jobs/source/apps/`, the job file is `jobs/apps.jobs.json`, output lands in
`jobs/apps/`:

```bash
cd ../_labs/stegassette && npm run jobs:apps:png
```

`lib/steg-core.js` is vendored from `stegassette/lib/steg-core.js` — re-copy it
when the format changes.
