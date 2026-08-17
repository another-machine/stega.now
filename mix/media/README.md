# mix/media

The demo set: loop stegassettes the mix tab offers as **try the demo set**.

`index.json` is a plain list of the filenames beside it, in the order they
should load — the first one sets the mix's tempo and key, so put the one that
should govern the mix first.

```json
["01-rhodes-92bpm-f-minor.png", "02-bass-120bpm-c-major.png"]
```

GitHub Pages serves no directory listing, so this manifest is the only record
of what is here. **Adding a loop means dropping the PNG in and adding its name
to the list.** An empty list hides the button.

The files load through the same code path a drag from the desktop takes, so the
demo cannot drift into a special case.

These are ordinary loop stegassettes: made in the `make` tab, and playable on
their own in the plain stega-now player.

## What makes a good set

The point is to show matching doing something, so let them disagree:

- **different tempos**, so decks visibly run at rates other than ×1.000
- **different keys**, and one whose scale already matches the mix so it sits at
  0 semitones while the loop beside it moves
- **one with `mode: none`** — drums, or anything with no tonic — to show a loop
  that is never transposed
- **one with a non-zero `origin`** — a pickup, or a swell leading into the
  downbeat
- **different lengths** — a one-bar loop against a four-bar one, which come
  back into phase on their own
