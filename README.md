# stega-now

Playback for STGC stegassette PNGs. The site is static, with no build step.
Every page serves as-is from this repo.

`/` is an index of everything here. The player used to be at `/` and moved
to `/home`. Encoded stegassettes and shared `?src=<url>` links still point
at the root. So `index.html` forwards anything with a query or a hash to
`/home`, with the query intact, instead of swallowing it.

Add a stegassette and stega-now decodes it in the browser. It plays back
whatever the stegassette holds:

| entry mimetype | playback                                   |
| -------------- | ------------------------------------------ |
| `text/html`    | full-viewport app (sandboxed iframe)       |
| `text/*`       | text                                       |
| `image/*`      | image (click toggles fit / 100%)           |
| `audio/L*`     | raw STGC PCM via Web Audio (loopable)      |
| `audio/*`      | `<audio>` element (loopable)               |
| anything else  | download link                              |

A stegassette with an HTML entry boots that entry. During playback, a slim
bar shows the stegassette name and an eject button. Entry buttons join the
bar when the stegassette holds more than one entry.

## Reveal

Encoding hid the payload in the cover's pixels. So a read of the payload
develops the cover again: the encoded image sits over the reconstruction,
and the player clears each pixel it has read. The picture resolves in the
stegassette's own traversal order.

Audio drives the reveal directly. The image develops as its own sound
plays, and each loop develops it again. A stegassette with no audio has no
playhead. Its reveal runs fast on a timer, with a `replay` button.
Data-only stegassettes open on the reveal. Any stegassette's reveal is one
click away, via `reveal` in the bar.

## Groups

A stegassette split spreads one audio track across many images. `select`
switches the library into selection mode. Tick two or more stegassettes and
press `group` to put them in a group. The numbering in the names sets the
order (`(3/12)`, or a trailing number). A group previews its members on the
main page. `edit` renames, reorders, or removes parts.

Click a group to play the whole thing. When every part carries raw PCM at
one common format, the player copies the parts into one buffer, end to end.
The track then plays with no seam at the image boundaries. The filmstrip
highlights the current part, and its image develops as it goes. In other
cases, the group lists its parts to play one at a time.

## Library

The library keeps added stegassettes as blobs in IndexedDB. When nothing
plays, you see the library: the stegassette images themselves. Click one to
play it. **Hold one down to delete it.** Press `add` to load PNGs. One PNG
plays immediately. Several stay in the library in name order, ready to
group. The active stegassette stays active across reloads until you eject.

`?src=<url>` fetches a stegassette PNG (same-origin or CORS), stores it in
the library, and plays it — a direct link to an app.

## Sandbox

HTML stegassettes run in a sandboxed iframe with an opaque origin. A
stegassette cannot touch this site's storage, cookies, or DOM. It cannot
touch another stegassette's data. The sandbox also blocks the stegassette's
own `localStorage`, so the player injects a shim. Stegassette apps that use
plain `localStorage` keep working. The player saves their data per
stegassette and deletes it with the stegassette.

## Sub-projects

- [album](album/) — builds and plays albums. A track's song splits across
  one or more images. A cover stegassette holds metadata, ownership,
  timestamped lyrics, and the key that decrypts the tracks.
- [home](home/) — the player and the stegassette library. It was `/`.
- [inspect](inspect/) — a read-only report on stegassettes: the pattern,
  the entries, and the cover recovered from the key pixels.
- [make](make/) — the editor. Drop in an image and some audio, and get a
  stegassette back. It was make.stega.now's own repo.
- [live](live/) — an homage to performances that have made me feel alive.
  Screenshots of videos, with the sound in their pixels. It was
  amplib.app/live.
- [geese](geese/) — it was amplib.app/geese-basement.
- [me](me/) — a stegassette of you. Record yourself, lay frames out in a
  template, and hide the recording's own audio in the picture. Or record a
  message into images you already have.
- [mix](mix/) — loops that know what they are. It makes stegassettes that
  carry a seamless loop plus its tempo, key, and downbeat position. It
  plays any number of them together, matched in beat and key.

---

Everything in `lib/` except `reveal.js` is vendored build output. **Never
hand-edit those files** — re-vendoring overwrites them. The package.json
scripts are the inventory of what comes from where. Each script is one `cp`
plus a strip of the sourcemap line. The copies are committed, so the pages
stay no-build and depend on nothing at runtime.

Two patterns:

- **From npm** (`codec`, `css`, `detect`, `photo`): the package is a
  devDependency. The version lives in `package.json` and the lockfile, so
  there is no drift to detect. To move to a new release:

      npm i @amplib/steganography@latest
      npm run codec

  Commit the resulting `lib/` diff. `css`, `detect` and `photo` do the same
  for `@amplib/ui`, `@amplib/music-detection` and `@amplib/photography`.

- **From a sibling checkout** (`vocoder`): the package has not shipped the
  needed build to npm yet. The script copies out of
  `../public-library/packages/`, and nothing records a version. The output
  is committed, so the site never depends on that checkout — only
  re-vendoring does. It becomes the npm pattern the day its package ships.

The codec bundles expose `window.Stegassette` and `window.StegassetteJobs`,
built as self-contained IIFEs. The API is not the same as the old vendored
`steg-core.js` they replaced. `encodeContainer` takes
`(entries, srcImg, opts, keyImg)`, not `(entries, srcImg, keyImg, opts)`.
The keymap option is spelled `keymap`, not `keyMap` — the package throws on
the old spelling instead of a silent encode with `adjacent`.
