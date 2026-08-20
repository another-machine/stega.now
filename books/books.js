"use strict";
/* ==========================================================
   stegassette/books — a reader for stega-book stegassettes.

   One PNG is one whole book. Inside it: book.json (the record and
   the table of contents), one text/markdown entry per chapter, one
   image entry per plate, and the cover artwork. Nothing is fetched,
   nothing is unpacked to disk — the pixels are the book.

   The reader adds three things the format deliberately leaves out,
   because they belong to a reader and not to a file: where you
   stopped, how you like the page set, and a voice.

   Position and settings live in localStorage. The book does not
   change, so nothing here writes back into the picture.
   ========================================================== */

const $ = (id) => document.getElementById(id);
const dec = new TextDecoder();

const BOOK_ENTRY = "book.json";
const CHAPTER_PREFIX = "ch/";

const POS_KEY = (id) => `stega-book:pos:${id}`;
const SETTINGS_KEY = "stega-book:settings";

// ---- state ---------------------------------------------------

const state = {
  book: null, // book.json
  byName: new Map(), // entry name -> decoded entry
  urls: [], // object URLs to revoke on eject
  chapter: -1, // index into book.chapters
  spans: [], // the current chapter's sentence spans, in reading order
};

const settings = {
  font: "mono", // mono | serif | sans — the stacks live in the stylesheet
  size: 1.0625,
  leading: 1.7,
  theme: "auto",
  voiceURI: "",
  rate: 1,
};

// ---- storage -------------------------------------------------

function loadSettings() {
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
  } catch (_) {
    /* a corrupt blob is not worth a broken page */
  }
  applySettings();
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (_) {}
}
function applySettings() {
  document.body.style.setProperty("--reader-size", `${settings.size}rem`);
  document.body.style.setProperty("--reader-leading", String(settings.leading));
  document.body.dataset.theme = settings.theme;
  document.body.dataset.font = settings.font;
  $("prefFont").value = settings.font;
  $("prefSize").value = settings.size;
  $("prefLeading").value = settings.leading;
  $("prefTheme").value = settings.theme;
  $("prefRate").value = settings.rate;
}

function loadPosition() {
  if (!state.book) return null;
  try {
    return JSON.parse(localStorage.getItem(POS_KEY(state.book.id)) || "null");
  } catch (_) {
    return null;
  }
}
// Written on every chapter change and every spoken sentence, so closing
// the tab mid-paragraph loses nothing.
function savePosition(sentence) {
  if (!state.book || state.chapter < 0) return;
  const chapter = state.book.chapters[state.chapter];
  if (!chapter) return;
  try {
    localStorage.setItem(
      POS_KEY(state.book.id),
      JSON.stringify({ chapter: chapter.id, sentence: sentence | 0 }),
    );
  } catch (_) {}
}

// ---- decode --------------------------------------------------

async function toImg(bytes) {
  const blob = new Blob([bytes], { type: "image/png" });
  let bmp;
  try {
    bmp = await createImageBitmap(blob, { colorSpaceConversion: "none" });
  } catch (_) {
    bmp = await createImageBitmap(blob);
  }
  const W = bmp.width,
    H = bmp.height;
  const cnv = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = cnv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const px = ctx.getImageData(0, 0, W, H).data;
  return new Stegassette.Img(W, H, new Uint8Array(px));
}

function objectUrl(bytes, mimetype) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimetype || "application/octet-stream" }));
  state.urls.push(url);
  return url;
}

async function openBook(bytes) {
  setStatus("reading the cover…");
  const img = await toImg(bytes);
  const { entries } = Stegassette.decodeContainer(img, img);

  const byName = new Map(entries.map((e) => [e.name, e]));
  const record = byName.get(BOOK_ENTRY);
  if (!record)
    throw new Error("no book.json in this stegassette — it is not a book");

  const book = JSON.parse(dec.decode(record.data));
  eject(false);
  state.book = book;
  state.byName = byName;

  // The carrier itself is the jacket. The embedded copy is the clean one,
  // so prefer it and fall back to the PNG we were handed.
  const art = book.cover?.entry ? byName.get(book.cover.entry) : null;
  state.coverUrl = art
    ? objectUrl(art.data, art.mimetype)
    : objectUrl(bytes, "image/png");

  setStatus("");
  showBook();
}

// ---- markdown ------------------------------------------------
// The chapters are plain prose: a heading, paragraphs, the occasional
// blockquote or rule. This renders that and nothing else, on purpose —
// a reader that runs arbitrary markup out of a decoded file is a hole.

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, "$1<em>$2</em>")
    .replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, "$1<em>$2</em>");
}

// Abbreviations that end in a period and do not end a sentence. Enough for
// a mid-century book of reportage: titles, initials, and the short forms
// that show up in citations.
const ABBR =
  /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Rev|Hon|Sen|Rep|Gov|Gen|Col|Capt|Lt|Sgt|St|Jr|Sr|vs|etc|Inc|Ltd|Co|No|Vol|pp|Fig|Ave|Blvd)|\b[A-Z])\.$/;

function splitSentences(text) {
  const parts = text.split(/(?<=[.!?][)"'’”]?)\s+/);
  const out = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev && ABBR.test(prev)) out[out.length - 1] = `${prev} ${p}`;
    else out.push(p);
  }
  return out.filter((s) => s.trim());
}

/**
 * markdown -> { html, count }
 *
 * Every sentence is wrapped in its own span, numbered in reading order.
 * That numbering is the whole contract between the page and the voice:
 * the speech reads span N and highlights span N, so they cannot drift,
 * and a saved position is just a number.
 */
function renderChapter(md) {
  const blocks = String(md).replace(/\r\n/g, "\n").split(/\n{2,}/);
  const html = [];
  let n = 0;

  const sentenced = (text) =>
    splitSentences(text)
      .map((s) => `<span class="s" data-i="${n++}">${inline(s)}</span>`)
      .join(" ");

  for (const raw of blocks) {
    const b = raw.trim();
    if (!b) continue;

    const heading = b.match(/^(#{1,6})\s+(.*)$/s);
    if (heading) {
      // The chapter's own h1 becomes the page's h2 — the book title is
      // already the h1 up in the bar.
      const level = Math.min(6, heading[1].length + 1);
      html.push(`<h${level}>${sentenced(heading[2].replace(/\n/g, " "))}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(b)) {
      html.push("<hr />");
      continue;
    }
    if (/^>/.test(b)) {
      const quote = b
        .split("\n")
        .map((l) => l.replace(/^>\s?/, ""))
        .join(" ");
      html.push(`<blockquote><p>${sentenced(quote)}</p></blockquote>`);
      continue;
    }
    html.push(`<p>${sentenced(b.replace(/\n/g, " "))}</p>`);
  }

  return { html: html.join("\n"), count: n };
}

// ---- views ---------------------------------------------------

function setStatus(msg, kind) {
  const s = $("status");
  s.textContent = msg || "";
  if (kind) s.dataset.state = kind;
  else delete s.dataset.state;
}

function setView(view) {
  document.body.dataset.view = view;
  $("viewShelf").hidden = view !== "shelf";
  $("viewBook").hidden = view !== "book";
  $("viewRead").hidden = view !== "read";
  $("pager").hidden = view !== "read";
  $("viewPlates").hidden = view !== "plates";
  $("bar").hidden = view !== "read";
  if (view !== "read") speech.stop();
  $("speech").hidden = view !== "read" || !("speechSynthesis" in window);
  window.scrollTo(0, 0);
}

function fact(dl, term, value) {
  if (!value) return;
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = value;
  dl.append(dt, dd);
}

const KIND_LABEL = { front: "Front matter", body: "Text", back: "Back matter" };

function showBook() {
  const b = state.book;
  const meta = b.book || {};
  $("bookTitle").textContent = meta.title || "Untitled";
  $("bookCover").src = state.coverUrl;
  $("bookCover").alt = `${meta.title || "the book"}, cover`;
  $("bookBlurb").textContent = meta.blurb || meta.notes || "";

  const dl = $("bookFacts");
  dl.textContent = "";
  fact(dl, "author", meta.author);
  fact(dl, "published", [meta.publisher, meta.place, meta.year].filter(Boolean).join(", "));
  fact(dl, "pages", meta.pages);
  fact(dl, "words", (b.totals?.words || 0).toLocaleString());
  fact(dl, "plates", String(b.plates?.length || 0));
  for (const p of meta.printings || []) fact(dl, "printing", p);
  fact(dl, "source", meta.source);
  const own = b.ownership || {};
  fact(dl, "owner", own.owner);
  fact(dl, "copy", own.copy);

  $("btnPlates").hidden = !(b.plates || []).length;

  // contents, grouped, with where you stopped marked
  const pos = loadPosition();
  const toc = $("toc");
  toc.textContent = "";
  let lastKind = null;
  let seenHere = false;
  b.chapters.forEach((c, i) => {
    if (c.kind !== lastKind) {
      lastKind = c.kind;
      const label = document.createElement("p");
      label.className = "ht-type-eyebrow toc-group u-faint";
      label.textContent = KIND_LABEL[c.kind] || c.kind;
      toc.append(label);
    }
    const item = document.createElement("button");
    item.type = "button";
    item.className = "toc-item";
    const title = document.createElement("span");
    title.className = "toc-title";
    title.textContent = c.title || c.id;
    const m = document.createElement("span");
    m.className = "toc-meta";
    m.textContent = `${(c.words || 0).toLocaleString()} words · ${Math.max(1, Math.round((c.speakingMs || 0) / 60000))} min`;
    item.append(title, m);
    if (pos && pos.chapter === c.id) {
      item.dataset.here = "1";
      seenHere = true;
    } else if (!seenHere && pos) {
      item.dataset.read = "1";
    }
    item.addEventListener("click", () => openChapter(i));
    toc.append(item);
  });

  $("btnRead").textContent = pos ? "resume" : "read";
  setView("book");
}

function openChapter(index, sentence) {
  const b = state.book;
  if (!b || index < 0 || index >= b.chapters.length) return;
  speech.stop();

  const c = b.chapters[index];
  const entry = state.byName.get(c.entry);
  if (!entry) {
    setStatus(`chapter "${c.id}" is missing from this book`, "error");
    setView("book");
    return;
  }

  state.chapter = index;
  const { html } = renderChapter(dec.decode(entry.data));
  const view = $("viewRead");
  view.innerHTML = html;
  state.spans = Array.from(view.querySelectorAll(".s"));

  $("barBook").textContent = b.book?.title || "";
  $("barChapter").textContent = c.title || c.id;
  $("btnPrev").disabled = index === 0;
  $("btnNext").disabled = index === b.chapters.length - 1;

  // progress across the whole book, by words — chapters are wildly uneven,
  // so counting chapters would lie about where you are
  const total = b.chapters.reduce((n, x) => n + (x.words || 0), 0) || 1;
  const before = b.chapters.slice(0, index).reduce((n, x) => n + (x.words || 0), 0);
  $("barProgress").style.width = `${Math.round((before / total) * 100)}%`;

  setView("read");
  speech.seek(sentence || 0);
  if (sentence) state.spans[sentence]?.scrollIntoView({ block: "center" });
}

function showPlates() {
  const b = state.book;
  const wrap = $("plates");
  wrap.textContent = "";
  $("platesTitle").textContent = "Plates";

  let lastSection = null;
  for (const p of b.plates || []) {
    const entry = state.byName.get(p.entry);
    if (!entry) continue;

    if ((p.section || "") !== lastSection) {
      lastSection = p.section || "";
      if (lastSection) {
        const label = document.createElement("p");
        label.className = "ht-type-eyebrow u-faint plates-group-label";
        label.textContent = lastSection;
        wrap.append(label);
      }
    }

    const fig = document.createElement("figure");
    fig.className = "plate";
    const img = document.createElement("img");
    img.src = objectUrl(entry.data, entry.mimetype);
    img.alt = p.caption || p.id;
    img.loading = "lazy";
    if (p.width && p.height) {
      img.width = p.width;
      img.height = p.height;
    }
    const cap = document.createElement("figcaption");
    cap.textContent = p.caption || "";
    fig.append(img, cap);
    if (p.credit) {
      const credit = document.createElement("figcaption");
      credit.className = "credit ht-type-small";
      credit.textContent = p.credit;
      fig.append(credit);
    }
    wrap.append(fig);
  }
  setView("plates");
}

// `toShelf` is false when one book replaces another: openBook ejects the
// old one first, and showing the shelf in between would only flicker.
function eject(toShelf = true) {
  speech.stop();
  for (const u of state.urls) URL.revokeObjectURL(u);
  state.urls = [];
  state.book = null;
  state.byName = new Map();
  state.chapter = -1;
  state.spans = [];
  $("viewRead").textContent = "";
  if (toShelf) setView("shelf");
}

// ---- read aloud ----------------------------------------------
// One utterance per sentence. It costs a hair of silence at each full
// stop, and buys three things worth more: the highlight can never drift
// from the voice, a pause resumes exactly where it stopped, and Chrome's
// habit of cutting off long utterances never gets the chance.

const speech = {
  gen: 0, // invalidates callbacks from cancelled utterances
  i: 0,
  playing: false,
  voices: [],
  heartbeat: 0,

  get available() {
    return "speechSynthesis" in window;
  },

  voice() {
    if (!settings.voiceURI) return null;
    return this.voices.find((v) => v.voiceURI === settings.voiceURI) || null;
  },

  mark(i) {
    for (const s of state.spans) delete s.dataset.speaking;
    const span = state.spans[i];
    if (!span) return null;
    span.dataset.speaking = "1";
    const box = span.getBoundingClientRect();
    if (box.top < 80 || box.bottom > window.innerHeight - 120)
      span.scrollIntoView({ block: "center", behavior: "smooth" });
    return span;
  },

  // Words are wrapped only in the sentence being spoken, and only once.
  // Wrapping the whole chapter up front would be tens of thousands of
  // spans for a highlight that only ever touches one.
  wordify(span) {
    if (span.dataset.wordified) return;
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    const texts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
    let at = 0;
    for (const node of texts) {
      const frag = document.createDocumentFragment();
      for (const piece of node.data.split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) frag.append(document.createTextNode(piece));
        else {
          const w = document.createElement("span");
          w.className = "w";
          w.dataset.at = String(at);
          w.textContent = piece;
          frag.append(w);
        }
        at += piece.length;
      }
      node.replaceWith(frag);
    }
    span.dataset.wordified = "1";
  },

  say(i) {
    if (!this.available) return;
    const span = this.mark(i);
    if (!span) return this.stop();

    this.i = i;
    savePosition(i);
    $("speechCount").textContent = `${i + 1} / ${state.spans.length}`;

    this.wordify(span);
    const words = Array.from(span.querySelectorAll(".w"));

    const u = new SpeechSynthesisUtterance(span.textContent);
    const v = this.voice();
    if (v) u.voice = v;
    u.rate = settings.rate;
    const gen = ++this.gen;

    u.onboundary = (e) => {
      if (gen !== this.gen || e.name === "sentence") return;
      let hit = null;
      for (const w of words) {
        if (Number(w.dataset.at) <= e.charIndex) hit = w;
        else break;
      }
      for (const w of words) delete w.dataset.speaking;
      if (hit) hit.dataset.speaking = "1";
    };
    u.onend = () => {
      if (gen !== this.gen) return; // a cancel, not a finish
      if (i + 1 < state.spans.length) this.say(i + 1);
      else this.atChapterEnd();
    };
    u.onerror = () => {
      if (gen !== this.gen) return;
      this.stop();
    };

    speechSynthesis.speak(u);
  },

  // Chrome stops speaking after about fifteen seconds unless something
  // pokes it. A no-op resume on a timer is the long-standing workaround.
  beat() {
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (this.playing && !speechSynthesis.speaking) return;
      if (this.playing) speechSynthesis.resume();
    }, 8000);
  },

  play(from) {
    if (!this.available || !state.spans.length) return;
    speechSynthesis.cancel();
    this.gen++;
    this.playing = true;
    $("btnPlay").textContent = "pause";
    $("btnAloud").dataset.emphasis = "strong";
    this.beat();
    // give the cancel a tick to land before speaking again
    setTimeout(() => this.say(from ?? this.i), 0);
  },

  pause() {
    if (!this.available) return;
    this.playing = false;
    speechSynthesis.pause();
    $("btnPlay").textContent = "play";
  },

  toggle() {
    if (!this.playing) this.play();
    else if (speechSynthesis.paused) {
      this.playing = true;
      speechSynthesis.resume();
      $("btnPlay").textContent = "pause";
    } else this.pause();
  },

  // Move the place without speaking it: resuming a book, clicking a
  // sentence, stepping while paused. The mark is the point — a reader
  // coming back should see where they were, not just land near it.
  seek(i) {
    const next = Math.min(state.spans.length - 1, Math.max(0, i | 0));
    this.i = next;
    this.mark(next);
    savePosition(next);
    $("speechCount").textContent = state.spans.length
      ? `${next + 1} / ${state.spans.length}`
      : "";
  },

  step(by) {
    const next = Math.min(state.spans.length - 1, Math.max(0, this.i + by));
    if (this.playing) this.play(next);
    else this.seek(next);
  },

  atChapterEnd() {
    const next = state.chapter + 1;
    if (state.book && next < state.book.chapters.length) {
      openChapter(next);
      this.play(0);
    } else this.stop();
  },

  stop() {
    if (this.available) speechSynthesis.cancel();
    this.gen++;
    this.playing = false;
    this.i = 0;
    clearInterval(this.heartbeat);
    for (const s of state.spans) delete s.dataset.speaking;
    const play = $("btnPlay");
    if (play) play.textContent = "play";
    const aloud = $("btnAloud");
    if (aloud) delete aloud.dataset.emphasis;
    const count = $("speechCount");
    if (count) count.textContent = "";
  },

  loadVoices() {
    if (!this.available) return;
    this.voices = speechSynthesis.getVoices();
    const sel = $("prefVoice");
    sel.textContent = "";
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "system default";
    sel.append(auto);
    for (const v of this.voices) {
      const o = document.createElement("option");
      o.value = v.voiceURI;
      o.textContent = `${v.name} (${v.lang})`;
      sel.append(o);
    }
    sel.value = settings.voiceURI;
  },
};

// ---- input ---------------------------------------------------
// A book arrives one way: by URL. Either the shelf below names it, or
// ?src= does. There is no file picker and nothing to drag — the library
// that takes stegassettes off your disk is /home, and this page reads what
// it is pointed at.

async function fromUrl(url) {
  try {
    setStatus("fetching…");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    await openBook(new Uint8Array(await res.arrayBuffer()));
  } catch (err) {
    setStatus(`could not load ${url} — ${err.message}`, "error");
  }
}

// The books that ship beside this page. The size is on the label because a
// book is a whole book — clicking one pulls megabytes, and a reader on a
// phone deserves to know that before the tap, not after it.
function renderShelf() {
  // The shelf is the only way in now, so an empty one has to say so rather
  // than leave a bare heading and no explanation.
  if (typeof Books === "undefined" || !Books.order?.length) {
    setStatus("no books on this page yet");
    return;
  }
  const list = $("shelfList");
  list.textContent = "";
  for (const id of Books.order) {
    const b = Books.byId[id];
    if (!b) continue;

    const item = document.createElement("button");
    item.type = "button";
    item.className = "shelf-item";

    // the box is the shelf the book stands on; the picture sits at its floor
    const shelf = document.createElement("span");
    shelf.className = "shelf-cover";
    const cover = document.createElement("img");
    cover.src = Books.thumb(b);
    cover.alt = `${b.name}, the encoded cover`;
    cover.loading = "lazy";
    shelf.append(cover);

    const name = document.createElement("span");
    name.className = "shelf-name";
    name.textContent = b.name;

    const line = document.createElement("span");
    line.className = "shelf-line";
    line.textContent = `${b.line} · ${(b.bytes / 1048576).toFixed(1)} MB`;

    item.append(shelf, name, line);
    item.addEventListener("click", () => fromUrl(b.file));
    list.append(item);
  }
  $("shelf").hidden = false;
}

function wire() {
  $("btnRead").addEventListener("click", () => {
    const pos = loadPosition();
    const at = pos ? state.book.chapters.findIndex((c) => c.id === pos.chapter) : -1;
    openChapter(at >= 0 ? at : 0, pos?.sentence || 0);
  });
  $("btnPlates").addEventListener("click", showPlates);
  $("btnBackFromPlates").addEventListener("click", showBook);
  $("btnEject").addEventListener("click", () => eject());
  $("btnShelf").addEventListener("click", showBook);
  $("btnPrev").addEventListener("click", () => openChapter(state.chapter - 1));
  $("btnNext").addEventListener("click", () => openChapter(state.chapter + 1));

  $("btnAloud").addEventListener("click", () => speech.toggle());
  $("btnPlay").addEventListener("click", () => speech.toggle());
  $("btnStop").addEventListener("click", () => speech.stop());
  $("btnBack").addEventListener("click", () => speech.step(-1));
  $("btnFwd").addEventListener("click", () => speech.step(1));

  // click a sentence to start reading there
  $("viewRead").addEventListener("click", (e) => {
    const span = e.target.closest?.(".s");
    if (!span) return;
    const i = Number(span.dataset.i);
    if (speech.playing) speech.play(i);
    else speech.seek(i);
  });

  $("btnPrefs").addEventListener("click", () => $("prefs").showModal());
  $("prefFont").addEventListener("change", (e) => {
    settings.font = e.target.value;
    applySettings();
    saveSettings();
  });
  $("prefSize").addEventListener("input", (e) => {
    settings.size = Number(e.target.value);
    applySettings();
    saveSettings();
  });
  $("prefLeading").addEventListener("input", (e) => {
    settings.leading = Number(e.target.value);
    applySettings();
    saveSettings();
  });
  $("prefTheme").addEventListener("change", (e) => {
    settings.theme = e.target.value;
    applySettings();
    saveSettings();
  });
  $("prefVoice").addEventListener("change", (e) => {
    settings.voiceURI = e.target.value;
    saveSettings();
    if (speech.playing) speech.play(speech.i);
  });
  $("prefRate").addEventListener("input", (e) => {
    settings.rate = Number(e.target.value);
    saveSettings();
  });

  document.addEventListener("keydown", (e) => {
    if (document.body.dataset.view !== "read") return;
    if (e.target.closest("input, select, textarea, dialog")) return;
    if (e.key === "ArrowRight") openChapter(state.chapter + 1);
    else if (e.key === "ArrowLeft") openChapter(state.chapter - 1);
    else if (e.key === " ") {
      e.preventDefault();
      speech.toggle();
    } else if (e.key === "Escape") showBook();
  });

  if (speech.available) {
    speech.loadVoices();
    speechSynthesis.addEventListener("voiceschanged", () => speech.loadVoices());
  }
  // a half-read book left speaking is worse than one left silent
  window.addEventListener("pagehide", () => speech.stop());
}

loadSettings();
wire();
renderShelf();

// A shared link points at one book: ?src=<url>, same convention as /home.
const src = new URLSearchParams(location.search).get("src");
if (src) fromUrl(src);
