# live

An homage to performances that have made me feel alive. The images are
screenshots of videos, with the sound encoded into their pixels. There are
no audio files here.

This page was `amplib.app/live`. Parcel built it from
`public-library/machines/live`. Now it is a static page. The only
TypeScript in it was type annotations, and Parcel only compiled those,
rewrote asset URLs, and hashed filenames. This page needs none of that.

`index.js` drives `Stegassette.createRevealPlayer` from `../lib/stegassette.js`.
The jobs pipeline generates the thumbnails in `media/thumbs`.
