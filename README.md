# stega-now

Playback for STGC stegassette PNGs. Static, no build — every page serves
as-is from this repo.

`/` is an index of everything here. The player used to be at `/` and moved to
`/home` — but encoded stegassettes and shared `?src=<url>` links still point at
the root, so `index.html` forwards anything carrying a query or a hash to
`/home` with it intact rather than swallowing it.

Add a stegassette and stega-now decodes it in the browser and plays back
whatever it holds:

| entry mimetype | playback                                   |
| -------------- | ------------------------------------------ |
| `text/html`    | full-viewport app (sandboxed iframe)       |
| `text/*`       | text                                       |
| `image/*`      | image (click toggles fit / 100%)           |
| `audio/L*`     | raw STGC PCM via Web Audio (loopable)      |
| `audio/*`      | `<audio>` element (loopable)               |
| anything else  | download link                              |

A stegassette with an HTML entry boots that entry. While playing, a slim bar
shows the stegassette name and an eject button; entry buttons join it when the
stegassette holds more than one entry.

## Reveal

Encoding hid the payload in the cover's pixels, so reading it back develops
the cover again: the encoded image sits over the reconstruction and every
pixel that has been read is cleared away, resolving the picture in the
stegassette's own traversal order.

Audio drives it directly — the image develops as its own sound plays, and
loops redevelop it. Stegassettes with no audio have no playhead, so their
reveal runs fast on a timer with a `replay` button; data-only stegassettes open
on it, and any stegassette's reveal is a click away via `reveal` in the bar.

## Groups

A stegassette split spreads one audio track across many images. `select`
switches the library into selection mode; tick two or more stegassettes and
`group` puts them in a group, ordered automatically by the numbering in
their names (`(3/12)`, or a trailing number). A group previews its members on
the main page; `edit` renames, reorders, or removes parts.

Click a group to play the whole thing. If every part carries raw PCM at a
common format, the parts are copied into one buffer end to end and play with
no seam at the image boundaries — the filmstrip marks the part currently
sounding, and its image develops as it goes. Otherwise the group just lists
its parts to play one at a time.

## Library

Added stegassettes are kept as blobs in IndexedDB. When nothing is playing you
see the library: the stegassette images themselves. Click one to play it,
**hold it down to delete it**, `add` to load PNGs — one plays straight away,
several stay in the library in name order, ready to group. The playing
stegassette stays active across reloads until you eject.

`?src=<url>` fetches a stegassette PNG (same-origin or CORS), stores it in the
library, and plays it — a direct link to an app.

## Sandbox

HTML stegassettes run in a sandboxed iframe — an opaque origin, so a stegassette
can't touch this site's storage, cookies, or DOM, or another stegassette's
data. The sandbox also blocks the stegassette's own `localStorage`, so the
player injects a shim: stegassette apps that use plain `localStorage` keep
working, their data saved per stegassette and deleted with it.

## Sub-projects

- [album](album/) — builds and plays albums: songs split
  across one or more images per track, with a cover stegassette holding
  metadata, ownership, timestamped lyrics, and the key that decrypts the
  tracks.
- [home](home/) — the player and the stegassette library. Was `/`.
- [make](make/) — the editor. Drop in an image and some audio and get a
  stegassette back. Was make.stega.now's own repo.
- [live](live/) — an homage to performances that have made me feel alive.
  Screenshots of videos with the sound in their pixels. Was amplib.app/live.
- [geese](geese/) — was amplib.app/geese-basement.
- [me](me/) — a stegassette of you: record yourself, lay frames out in a
  template, and hide the recording's own audio in the picture — or record a
  message into images you already have.
- [mix](mix/) — loops that know what they are. Makes stegassettes carrying a
  seamless loop plus its tempo, key, and downbeat position, and plays any
  number of them together, beat- and key-matched.

---

Everything in `lib/` except `reveal.js` is vendored build output. **Never
hand-edit those files** — re-vendoring overwrites them. The package.json
scripts are the inventory of what comes from where; each is a `cp` plus a
sourcemap-line strip, and the copies are committed, so the pages stay
no-build and depend on nothing at runtime.

Two patterns:

- **From npm** (`codec`, `css`): the package is a devDependency, so the
  version lives in `package.json` and the lockfile and there is no drift to
  detect. Moving to a new release:

      npm i @amplib/steganography@latest
      npm run codec

  Commit the resulting `lib/` diff. `css` does the same for `@amplib/ui`.

- **From a sibling checkout** (`vocoder`, `detect`): the package hasn't
  shipped the needed build to npm yet, so the script copies out of
  `../public-library/packages/` and nothing records a version. The committed
  output means the site never depends on that checkout existing — only
  re-vendoring does. Each of these becomes the npm pattern the day its
  package ships.

The codec bundles expose `window.Stegassette` and `window.StegassetteJobs`,
built as self-contained IIFEs. The API is not the same as the old vendored
`steg-core.js` they replaced: `encodeContainer` takes
`(entries, srcImg, opts, keyImg)` rather than `(entries, srcImg, keyImg,
opts)`, and the keymap option is spelled `keymap`, not `keyMap` — the package
throws on the old spelling rather than silently encoding with `adjacent`.
