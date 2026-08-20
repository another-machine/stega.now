# inspect

A read-only report on one or more stegassettes. Drop PNG files. Each file
gets a panel with:

- the image, next to the cover that its key pixels hold
- the header that the border ring carries: border, combine plan, packing,
  keymap, traversal, and payload size against interior capacity
- every entry, with a preview and a download

The page runs fully in the browser. It uploads nothing. It stores nothing.

Entries preview by kind:

| entry        | preview                                          |
| ------------ | ------------------------------------------------ |
| raw PCM      | format and duration — playback lives in `home/`  |
| text         | the text                                         |
| JSON         | pretty-printed, capped with a note               |
| `image/*`    | the image                                        |
| other binary | a short hex view                                 |

A file with no STGC header still gets a report: dimensions, a preview, and
a note. Either the file is not a stegassette, or something changed the
pixels after encoding. A resize or a lossy re-save is the usual way a
stegassette dies in transit.

## Keys

Encryption in the format is application-level. An album part's `part.json`
says `encrypted: true` and carries the iv. The album cover's `album.json`
carries the AES-GCM key. Inspect uses exactly that shape, in a general way:
when a JSON entry holds a 32-byte base64 value under a key-named field, the
value joins a key ring. So a cover unlocks the parts you drop with it.
Order inside the batch does not matter — the page gathers keys before it
renders the reports. A locked entry retries when a later key arrives.

The `key` fold is secondary on purpose. Most stegassettes need no key. It
takes a pasted base64 key, or a file that holds one: bare text, JSON, or a
key-carrying stegassette. AES-GCM refuses a wrong key by itself. So the
page tries the whole ring blindly, and only an authenticated decrypt
reports as open. Ciphertext downloads as-is either way. The point is to
convey what is in the image, locked or not.
