# mixer/media

The demo set: loop stegassettes that the mixer offers as **try the demo
set**.

`index.json` is a plain list of the filenames beside it, in load order. The
first loop sets the mix's tempo and key. Put the loop that should govern
the mix first — for a pack, that is the first loop inside it.

```json
["01-rhodes-92bpm-f-minor.png", "02-bass-120bpm-c-major.png"]
```

GitHub Pages serves no directory listing, so this manifest is the only
record of what is here. **To add a loop, drop the PNG in and add its name
to the list.** An empty list hides the button.

The files load through the same code path as a drag from the desktop. So
the demo cannot drift into a special case.

These are ordinary loop stegassettes. The [loop editor](../../loop/) makes
them, and the plain stega-now player plays each one on its own.

## What makes a good set

The point is to show that matching does something, so let the loops
disagree:

- **different tempos**, so decks visibly run at rates other than ×1.000
- **different keys**, with one whose scale already matches the mix — it
  sits at 0 semitones while the loop beside it moves
- **one with `mode: none`** — drums, or anything with no tonic — to show a
  loop that the mix never transposes, playing on tape
- **one with a non-zero `origin`** — a pickup, or a swell that leads into
  the downbeat
- **different lengths** — a one-bar loop against a four-bar loop; they come
  back into phase on their own
- **a pack** — several loops in one picture, expanding into their own decks

The set here now is synthesized placeholder material — tones and clicks
with correct metadata, made to prove the mixer works. Replace it with real
loops, or empty `index.json` to hide the button.
