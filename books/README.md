# books

Reads **books** made of one STGC stegassette. Runs entirely in the browser —
open `books/` from the served repo, with no build step.

An album is many images because a song outlasts a picture. A book is the
opposite: its prose is small next to the pixels of its own jacket, so the
whole thing fits in the cover and the cover is the book.

```
<title>.png    book.json — the record, the table of contents, the plate list
               ch/<id>.md — one entry per chapter, plain markdown
               img/<id>.jpg — one entry per plate, with its caption
               cover — the jacket artwork itself
```

Every entry keeps a real mimetype. Drop the same PNG into the plain
stega-now player, which has never heard of a book, and the chapters come out
as text and the plates come out as pictures. `book.json` supplies an order,
not a key. Nothing here is encrypted, because a book you are holding is a
book you may read.

Books are built by `encode-book.js` in the stegassette-jobs pipeline. This
page only reads them.

## Open

The page lists the books that ship with it, from `manifest.js`. Press one
and it loads. The size is on the label, because a book is a whole book and a
tap should say what it costs before it spends it.

`?src=<url>` opens any other one — same convention as `/home`, so a link
points at a book.

There is no file picker and nothing to drag. A book arrives by URL or not at
all; the library that takes stegassettes off your own disk is
[home](../home/).

The shelf is the jacket, what is known about the printing, and the contents.
The contents run straight through in reading order, and each chapter carries
its length in words and about how long it runs aloud. Where you stopped is
marked, and what you have passed is dimmed.

## Read

One chapter to a page, set to a measure. Text size, line height and theme are
yours to set and are remembered.

`←` and `→` move between chapters, `esc` returns to the contents, and the
rule under the bar fills by **words**, not by chapter — the chapters here run
from four hundred words to eleven thousand, and counting them would lie about
where you are.

## Aloud

The reader speaks with the voices your own system already has. Pick one and
set the rate; both are remembered.

It speaks **one sentence per utterance**. That costs a hair of silence at
each full stop and buys three things worth more:

- the highlight cannot drift from the voice, because they are the same span
- a pause resumes exactly where it stopped, not at the top of a paragraph
- Chrome's habit of cutting off long utterances never gets the chance

Inside the sentence being spoken, the word is underlined as it arrives, where
the browser reports word boundaries. Those word spans are made only for the
sentence actually being read — wrapping a whole chapter up front would be
tens of thousands of spans for a highlight that only ever touches one.

Click any sentence to move there. `space` starts and pauses. At the end of a
chapter it reads on into the next one.

## What it remembers

In `localStorage`, and nowhere else:

| key | holds |
| --- | ----- |
| `stega-book:pos:<book id>` | the chapter and the sentence you were on |
| `stega-book:settings` | text size, line height, theme, voice, rate |

The position is keyed by the book's own id, so two books do not collide. It
is written on every chapter change and every spoken sentence, so closing the
tab mid-paragraph loses nothing.

The book itself is not stored. This page reads a file you hand it and keeps
your place in it; the library that keeps stegassettes is `/home`.

## Plates

The plates are shown as the book groups them, each with its caption and its
credit. They are entries like any other, so a plate is a real image file, at
whatever size it was encoded — not a thumbnail of one.

## Markdown

Only what a book of prose actually uses: headings, paragraphs, blockquotes,
rules, and emphasis. Everything else is escaped. A reader that renders
arbitrary markup out of a decoded file is a hole, and a book does not need
one.
