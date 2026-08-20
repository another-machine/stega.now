# releases

Encoded releases, played straight from the images. Each page fetches
stegassette PNGs from the CDN, decodes them in the browser, and plays the
audio with a live pixel develop. `manifest.js` is the inventory: one entry per
release, with the CDN prefix, the file names, and the exact byte sizes.

## The CDN

The files live in a Cloudflare R2 bucket behind the custom domain
`cdn.stegassette.amplib.tech`. The `amplib.tech` zone exists only for this
domain. The bucket prefixes mirror the `jobs/<out>` directories in the
stegassette-jobs repo.

CORS comes from a zone Transform Rule named `cdn-cors`. It sets a static
response header `access-control-allow-origin: *` for the hostname. Do not
rely on the R2 bucket CORS policy. The edge caches one copy per URL and
encoding, stamped with the headers of the first request. A request without an
Origin header (curl, a bot, a hotlink) poisons that copy for browsers for the
cache TTL. A post-cache header rule is immune to this. If the CDN moves,
replicate this: set the CORS header after the cache, not at the origin.

Objects serve with the default `cache-control: max-age=14400`. Purge the
Cloudflare cache after every upload.

## After a re-encode

Each album encode mints a new AES key. The key lives in the cover. A cover
from one encode cannot decrypt a track from another.

1. Upload the cover and all tracks together, plus fresh thumbs
   (`node scripts/generate-thumbs.js jobs/<name>` in stegassette-jobs).
2. Update the byte sizes in `manifest.js` from the live bucket.
3. Purge the Cloudflare cache.

The sizes are also the cache invalidation: the player refetches any stored
blob whose size disagrees with the manifest, so stale IndexedDB copies heal
on their own once the manifest is current.

## Storage

Downloads persist in IndexedDB, keyed by URL. The footer on every page shows
the total and offers a clear control.
