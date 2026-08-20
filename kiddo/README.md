# kiddo

Five moments of home video — 1992, 1994, 1995, 1997, 2002 — one picture each.

Each stegassette holds the whole moment: the audio, a run of `frame-001…`
JPEG stills at 6fps and 128px wide, and three text entries (`Metadata`,
`Quote`, `Message`). There are no video or audio files on this page.

The page follows `live/`: one work hangs at a time above a rail of the rest.
It adds two things, both read out of the payload the reveal is already
eating. The reveal takes a line to itself, and under it the clip plays beside
the card — the scene, the year, the quote, and the note I wrote back to the
kid in the picture. Narrower than 800px the card drops under the clip.

The clip's height is `.pane.film`'s `clamp()` in `index.html`, and the frames'
own ratio finds its width. Raising it takes height from the reveal, since the
two share the room.

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
