# stegassette console

A static, public-facing player for [stegassette](../\_labs/stegassette) STGC
cartridges. Load a cartridge PNG and the console decodes it in the browser and
plays back whatever it holds:

| entry mimetype | playback                                     |
| -------------- | -------------------------------------------- |
| `text/html`    | boots full-screen (srcdoc iframe)            |
| `text/*`       | text pane                                    |
| `image/*`      | image pane                                   |
| `audio/L*`     | raw STGC PCM via Web Audio (play/progress)   |
| `audio/*`      | `<audio>` element (mp3/wav/ogg payloads)     |
| anything else  | download link                                |

If a cartridge has an HTML entry, that entry boots by default. The ▤ pill
(bottom-left, or Esc) opens the console drawer: entry list, cartridge params
(combine / keymap / traversal), load-new, eject.

## Slots (localStorage persistence)

A loaded cartridge is cached in `localStorage` so the page boots straight back
into it on the next visit — the image file itself is the cache (its bytes are
stored base64, decoded fresh each boot).

- `?local=<slot>` — pick the storage slot (default `default`). Different slots
  hold different cartridges side by side: `/?local=trip`, `/?local=music`.
- `?reset` — hard-reset the slot: clears the cache and shows the loader.
  The param strips itself from the URL after it runs.
- `?src=<url>` — fetch a cartridge PNG by URL (same-origin or CORS) instead of
  a file pick; it then caches into the slot like any other load. Handy for
  linking straight to a cartridge: `/?src=out/sydney-protocol.png`.
- Loading a new cartridge (file pick, drop, or `?src`) always overwrites the
  current slot. Eject clears it.

Cartridges too large for the localStorage quota still play — they just don't
survive a reload (the drawer says so).

## Deploying

It's all static — serve the repo root anywhere (GitHub Pages, Netlify, an S3
bucket). `index.html` + `lib/steg-core.js` are the only files the player needs;
`out/` holds encoded cartridges you want to link with `?src=`.

Note: an HTML cartridge executes with this origin's privileges (that is the
point — cartridges are apps, and their own localStorage keys live on this
origin too). Only host cartridges you trust.

## Encoding a cartridge

Encoding lives in the main stegassette repo (`encode-batch.js`, which now
supports data-only jobs — no audio entry required). This repo keeps the app
sources, job files, and outputs together:

```
apps/    HTML apps to embed (sydney-protocol.html)
jobs/    encode job files (paths are relative to the job file)
assets/  cover images
out/     encoded cartridge PNGs
```

Re-encode the Sydney Protocol cartridge:

```bash
node ../_labs/stegassette/encode-batch.js jobs/sydney.jobs.json
```

`lib/steg-core.js` is vendored from `stegassette/lib/steg-core.js` — re-copy it
when the format changes.
