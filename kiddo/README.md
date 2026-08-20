# kiddo

Five moments of home video — 1992, 1994, 1995, 1997, 2002 — one picture each.

Each stegassette holds the whole moment: the audio, a run of `frame-001…`
JPEG stills at 6fps and 128px wide, and three text entries (`Metadata`,
`Quote`, `Message`). There are no video or audio files on this page.

The page is built on `geese/`: a promenade of rooms, one work to a room, each
picture hung at its own native size against a veiled enlargement of itself.
Tapping a picture loads and plays it. What geese does not have is the rest of
what these pictures carry, which shares the room with the work: the clip, and
the card — the scene, the year, the quote, and the note I wrote back to the
kid in the picture.

A room arranges itself around the shape of its cover, which `data-shape` in
the markup states, since it is known before anything decodes. A wide cover
runs across the top with the clip and the card beneath it; a tall one stands
beside them. Narrower than 800px every room stacks and centres.

The clip dissolves rather than cuts. Six frames a second is slow enough that
a cut reads as a stutter, so each frame holds for the first part of its turn
and crossfades into the next over the rest. `FADE` in `index.js` sets how
much of the turn goes to the dissolve: 0 cuts, 1 never holds a frame still.

`index.js` drives `Stegassette.createRevealPlayer` from `../lib/stegassette.js`.
The player exposes `entries`, so the stills and the text come straight off it.
It gives no per-frame callback, so the clip runs off the player's own clock —
`audioContext.currentTime - player.t0`, wrapped by `player.duration` — the
same clock the reveal sweeps on.

The pictures come from the `stegassette-jobs` pipeline
(`jobs/kiddo.jobs.json`), which also generates `media/thumbs`. Each job pins
its `seed` to its year, so a re-encode reproduces the file that ships here.
