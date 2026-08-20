// Page logic for the releases pages. The index page only renders the storage
// line; release pages fetch encoded PNGs from the CDN (with byte progress),
// decode them with the Stegassette global, and play the audio back with a
// live pixel reveal. Playback is a chain of parts: a single track is a chain
// of one, "play all" on a parts release chains every image in sequence.
"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const td = new TextDecoder();

  const fmtBytes = (b) =>
    b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  const fmtTime = (sec) => {
    const s = Math.max(0, Math.floor(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  // Let the status text paint before a long synchronous decode. rAF never
  // fires in a hidden tab, so a plain timeout races it to avoid hanging.
  const nextFrame = () =>
    new Promise((r) => {
      requestAnimationFrame(() => setTimeout(r, 0));
      setTimeout(r, 80);
    });

  // ── storage line (every page) ─────────────────────────────────────────────
  // Declared before the index page's early return: the clear handler below
  // closes over these, and TDZ bindings would make it throw there.
  const storageEl = $("storage");
  let storedKeys = new Set();
  const gridBtns = [];
  async function renderStorage() {
    if (!storageEl) return;
    const u = await ReleaseStore.usage();
    storageEl.textContent = "";
    if (!u) {
      storageEl.append("storage unavailable — downloads will not persist");
      return;
    }
    storageEl.append(
      u.count
        ? `stored ${u.count} ${u.count === 1 ? "image" : "images"} · ${fmtBytes(u.bytes)} `
        : "nothing stored ",
    );
    if (u.count) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "clear storage";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const ok = await ReleaseStore.clear();
        if (ok) {
          storedKeys = new Set();
          markStored();
        }
        renderStorage();
      });
      storageEl.append(btn);
    }
  }
  renderStorage();

  const releaseId = document.body.dataset.release;
  if (!releaseId) return; // index page: storage line only
  const rel = Releases.byId[releaseId];
  if (!rel) return;

  // ── fetch with progress + store ───────────────────────────────────────────
  ReleaseStore.keys().then((k) => {
    storedKeys = k;
    markStored();
  });

  async function fetchBlob(url, expectedBytes, onProgress, signal) {
    const hit = await ReleaseStore.get(url);
    if (hit) {
      onProgress(1, hit.size, hit.size, true);
      return hit;
    }
    const res = await fetch(url, { mode: "cors", signal });
    if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
    const total = Number(res.headers.get("content-length")) || expectedBytes || 0;
    let blob;
    if (res.body) {
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onProgress(total ? Math.min(1, got / total) : 0, got, total, false);
      }
      blob = new Blob(chunks, { type: "image/png" });
    } else {
      blob = await res.blob();
      onProgress(1, blob.size, blob.size, false);
    }
    ReleaseStore.put(url, blob).then((ok) => {
      if (ok) {
        storedKeys.add(url);
        markStored();
        renderStorage();
      }
    });
    return blob;
  }

  // ── decode helpers ────────────────────────────────────────────────────────
  async function imgFromBlob(blob) {
    let bmp;
    try {
      bmp = await createImageBitmap(blob, { colorSpaceConversion: "none" });
    } catch (e) {
      bmp = await createImageBitmap(blob);
    }
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width = canvas.height = 0;
    // Share the ImageData buffer instead of copying it — the copy would be
    // another ~300 MB on the largest tracks, and ImageData is dropped here.
    return new Stegassette.Img(d.width, d.height, new Uint8Array(d.data.buffer));
  }

  function textOf(entry) {
    return td.decode(entry.data);
  }

  // ── album state ───────────────────────────────────────────────────────────
  let album = null; // parsed album.json (album releases only)
  let albumKey = null; // CryptoKey when the release is encrypted

  function itemLabel(i) {
    if (rel.kind === "parts") return `part ${i + 1} of ${rel.items.length}`;
    if (album && album.tracks[i]) return `${album.tracks[i].n} ${album.tracks[i].title}`;
    return rel.items[i].file.replace(/^\d+-\d+-/, "").replace(/\.png$/, "").replace(/-/g, " ");
  }

  // ── grid ──────────────────────────────────────────────────────────────────
  // Each cell is a tile: a button face (load + play) with the meta line
  // outside it, so the line can carry a real link — a link inside a button
  // is invalid, and a click on it would fire the load alongside it.
  const grid = $("grid");
  rel.items.forEach((item, i) => {
    const cell = document.createElement("div");
    cell.className = "thumb";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "thumb__face";
    btn.setAttribute("aria-pressed", "false");
    const img = document.createElement("img");
    img.src = Releases.thumb(rel, item.file);
    img.alt = "";
    const name = document.createElement("span");
    name.className = "thumb__name";
    name.textContent = itemLabel(i);
    btn.append(img, name);
    btn.addEventListener("click", () => loadSequence([i]));
    const meta = document.createElement("span");
    meta.className = "thumb__meta u-faint ht-type-small";
    meta.textContent = fmtBytes(item.bytes);
    cell.append(btn, meta);
    grid.append(cell);
    gridBtns.push({ btn, name, meta, item });
  });

  // One object URL per stored image, minted once. A blob out of IndexedDB is
  // a disk-backed handle, so this reads no pixel data — the bytes stream only
  // when a view tab actually opens the URL.
  const viewUrls = new Map();
  function viewLink(url) {
    const a = document.createElement("a");
    a.className = "linklike";
    a.textContent = "view";
    a.target = "_blank";
    a.rel = "noopener";
    a.href = viewUrls.get(url) || url;
    return a;
  }
  async function markStored() {
    for (const { meta, item } of gridBtns) {
      const url = Releases.url(rel, item.file);
      const has = storedKeys.has(url);
      if (has && !viewUrls.has(url)) {
        const blob = await ReleaseStore.get(url);
        if (blob) viewUrls.set(url, URL.createObjectURL(blob));
      }
      meta.textContent = fmtBytes(item.bytes);
      if (has) meta.append(" · stored · ", viewLink(url));
    }
  }

  function pressThumb(i) {
    gridBtns.forEach(({ btn }, j) => btn.setAttribute("aria-pressed", String(i === j)));
  }

  function refreshLabels() {
    gridBtns.forEach(({ name }, i) => {
      name.textContent = itemLabel(i);
    });
  }

  // ── cover metadata (album releases) ───────────────────────────────────────
  const coverStatus = $("coverStatus");
  const coverProg = $("coverProg");
  const metaBody = $("metaBody");

  async function loadCover() {
    const url = Releases.url(rel, rel.cover.file);
    try {
      const blob = await fetchBlob(url, rel.cover.bytes, (frac, got, total, fromStore) => {
        coverProg.value = frac;
        coverStatus.textContent = fromStore
          ? "cover from storage"
          : `cover ${fmtBytes(got)} / ${total ? fmtBytes(total) : "?"}`;
      });
      coverStatus.textContent = "decoding cover";
      await nextFrame();
      const img = await imgFromBlob(blob);
      const { entries } = Stegassette.decodeContainer(img, img);
      const entry = entries.find((e) => e.name === "album.json");
      if (!entry) throw new Error("no album.json in cover");
      album = JSON.parse(textOf(entry));
      if (album.encrypted && album.key) albumKey = await Stegassette.importKey(album.key);
      renderAlbumMeta(entries);
      refreshLabels();
      coverStatus.hidden = true;
      coverProg.hidden = true;
      metaBody.hidden = false;
    } catch (e) {
      coverProg.hidden = true;
      coverStatus.dataset.state = "error";
      coverStatus.textContent = `cover: ${e.message}`;
    }
  }

  function line(parent, text, className) {
    if (!text) return;
    const p = document.createElement("p");
    if (className) p.className = className;
    p.textContent = text;
    parent.append(p);
  }

  function renderAlbumMeta(entries) {
    metaBody.textContent = "";
    const a = album.album || {};
    const own = album.ownership || {};
    const au = album.audio || {};
    const st = album.steg || {};
    // The encoded cover straight off the CDN — a real, copyable URL — with a
    // toggle to the artwork hidden inside it (which exists only as a decode).
    const art = entries.find((e) => e.name === "cover" && /^image\//.test(e.mimetype));
    const encodedUrl = rel.cover ? Releases.url(rel, rel.cover.file) : null;
    const artUrl = art ? URL.createObjectURL(new Blob([art.data], { type: art.mimetype })) : null;
    if (encodedUrl || artUrl) {
      const img = document.createElement("img");
      img.className = "cover-art";
      img.alt = "";
      img.src = encodedUrl || artUrl;
      metaBody.append(img);
      const p = document.createElement("p");
      // view opens whichever version is showing, full size in its own tab
      const view = document.createElement("a");
      view.className = "linklike";
      view.textContent = "view";
      view.target = "_blank";
      view.rel = "noopener";
      view.href = img.src;
      if (encodedUrl && artUrl) {
        let encodedShown = true;
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "linklike";
        toggle.textContent = "show unencoded";
        toggle.addEventListener("click", () => {
          encodedShown = !encodedShown;
          img.src = encodedShown ? encodedUrl : artUrl;
          toggle.textContent = encodedShown ? "show unencoded" : "show encoded";
          view.href = img.src;
        });
        p.append(toggle, " · ");
      }
      p.append(view);
      metaBody.append(p);
    }
    const h2 = document.createElement("h2");
    h2.textContent = a.title || rel.name;
    metaBody.append(h2);
    line(metaBody, [a.artist, a.year].filter(Boolean).join(" · "));
    line(metaBody, a.notes, "ht-type-prose u-dim");
    line(
      metaBody,
      [own.owner, own.purchased, own.copy, own.note].filter(Boolean).join(" · "),
      "u-faint ht-type-small",
    );
    const ch = au.channels === 2 ? "stereo" : au.channels === 1 ? "mono" : `${au.channels}ch`;
    line(
      metaBody,
      `${au.rate} Hz · ${au.bits}-bit · ${ch} · ${album.tracks.length} tracks · ` +
        `${st.combine} / ${st.traversal} / ${st.keymap}` +
        (album.encrypted ? " · encrypted" : ""),
      "u-faint ht-type-small",
    );
    // Text entries riding in the cover, minus the per-track lyric dumps.
    entries
      .filter((e) => /^text\//.test(e.mimetype) && !/^Lyrics\b/.test(e.name))
      .forEach((e) => line(metaBody, `${e.name.toLowerCase()} — ${textOf(e)}`, "u-faint ht-type-small"));
  }

  // ── player ────────────────────────────────────────────────────────────────
  const npSection = $("np");
  const npTitle = $("npTitle");
  const npView = $("npView");
  const npStatus = $("npStatus");
  const npProg = $("npProg");
  const npCtrls = $("npCtrls");
  const npToggle = $("npToggle");
  const npSeek = $("npSeek");
  const npTime = $("npTime");
  const npReveal = $("npReveal");
  const npLyrics = $("npLyrics");
  const npTexts = $("npTexts");
  const playAllBtn = $("playAll");

  let actx = null;
  let np = null; // the active chain, see mkChain()
  let loadGen = 0;
  let loadAbort = null; // aborts superseded downloads
  let tickTimer = null;
  let dragging = false;

  function ensureCtx() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    return actx;
  }

  function mkChain(gen, expected) {
    return {
      gen,
      expected, // how many parts the chain will eventually hold
      parts: [], // {buffer, dur, start, img, opts, revealEntry, frames, gridIdx}
      // Looping is per-source, so it is only sound for a chain of one; a
      // multi-part loop would stack overlapping sources.
      loop: rel.kind === "video" && expected === 1,
      loadedDur: 0,
      base: 0,
      startedAt: 0,
      playing: false,
      stalled: false, // playback caught up with the downloads
      sources: [],
      partIdx: -1, // part currently shown in the reveal
      revealObj: null,
      frameCtx: null, // canvas 2d context when the part carries video frames
      frameIdx: -1,
      lastPos: 0, // previous tick position, for loop-wrap detection
      lyrics: null,
      lyricEls: null,
      lineIdx: -1,
    };
  }

  const allLoaded = () => np && np.parts.length === np.expected;
  const totalShown = () =>
    !np || !np.parts.length
      ? 0
      : allLoaded()
        ? np.loadedDur
        : (np.loadedDur / np.parts.length) * np.expected;

  function position() {
    if (!np) return 0;
    if (!np.playing) return np.base;
    const t = np.base + actx.currentTime - np.startedAt;
    if (np.loop && np.loadedDur > 0) return t % np.loadedDur;
    return Math.min(np.loadedDur, t);
  }

  function stopAll() {
    if (!np) return;
    const list = np.sources;
    np.sources = [];
    for (const s of list) {
      try {
        s.stop();
      } catch (e) {}
    }
  }

  function schedulePart(j, when, offset) {
    const part = np.parts[j];
    const s = actx.createBufferSource();
    s.buffer = part.buffer;
    if (np.loop) s.loop = true;
    s.connect(actx.destination);
    s._idx = j;
    const chain = np;
    s.onended = () => {
      if (np !== chain || !chain.playing || !chain.sources.includes(s)) return;
      chain.sources = chain.sources.filter((x) => x !== s);
      if (s._idx !== chain.parts.length - 1) return; // the next part is already scheduled
      chain.playing = false;
      chain.base = chain.loadedDur;
      if (!allLoaded()) chain.stalled = true; // resume when the next part decodes
      npToggle.textContent = "play";
      tick();
    };
    np.sources.push(s);
    s.start(when, offset);
  }

  function playFrom(t) {
    if (!np || !np.parts.length) return;
    ensureCtx();
    stopAll();
    np.base = Math.min(Math.max(0, t), Math.max(0, np.loadedDur - 0.02));
    np.startedAt = actx.currentTime + 0.03;
    np.playing = true;
    np.stalled = false;
    for (let j = 0; j < np.parts.length; j++) {
      const p = np.parts[j];
      if (p.start + p.dur <= np.base + 0.001) continue;
      const offset = Math.max(0, np.base - p.start);
      const when = np.startedAt + Math.max(0, p.start - np.base);
      schedulePart(j, when, offset);
    }
    npToggle.textContent = "pause";
  }

  function pause() {
    if (!np || !np.playing) return;
    np.base = position();
    np.playing = false;
    stopAll();
    npToggle.textContent = "play";
  }

  function addPart(chain, part) {
    part.start = chain.loadedDur;
    chain.parts.push(part);
    chain.loadedDur += part.dur;
    if (np !== chain) return;
    if (chain.playing) {
      const when = chain.startedAt + (part.start - chain.base);
      const now = actx.currentTime;
      schedulePart(chain.parts.length - 1, Math.max(when, now), when < now ? now - when : 0);
    } else if (chain.stalled) {
      playFrom(chain.base);
    }
  }

  npToggle.addEventListener("click", () => {
    if (!np || !np.parts.length) return;
    if (np.playing) pause();
    else if (np.stalled) return; // waiting on the next download; addPart resumes
    else if (np.base >= np.loadedDur - 0.02 && allLoaded()) playFrom(0);
    else playFrom(np.base);
  });

  npSeek.addEventListener("pointerdown", () => (dragging = true));
  npSeek.addEventListener("pointerup", () => (dragging = false));
  npSeek.addEventListener("pointercancel", () => (dragging = false));
  npSeek.addEventListener("input", () => {
    if (!np) return;
    const t = (npSeek.value / 1000) * totalShown();
    npTime.textContent = `${fmtTime(t)} / ${fmtTime(totalShown())}`;
  });
  npSeek.addEventListener("change", () => {
    if (!np || !np.parts.length) return;
    dragging = false;
    // Land just short of the loaded end so the chain ends or stalls naturally;
    // playFrom's clamp would otherwise wrap an explicit seek-to-end oddly.
    const t = Math.min((npSeek.value / 1000) * totalShown(), Math.max(0, np.loadedDur - 0.05));
    if (t < position() && np.revealObj && partAt(t) === np.partIdx) np.revealObj.reset();
    if (np.playing) playFrom(t);
    else np.base = t;
    tick();
  });

  function partAt(t) {
    if (!np) return -1;
    for (let j = np.parts.length - 1; j >= 0; j--) if (t >= np.parts[j].start - 0.001) return j;
    return np.parts.length ? 0 : -1;
  }

  // ── reveal ────────────────────────────────────────────────────────────────
  function switchReveal(j) {
    np.partIdx = j;
    np.revealObj = null;
    np.frameCtx = null;
    np.frameIdx = -1;
    npReveal.textContent = "";
    const part = np.parts[j];
    if (part && part.frames && part.frames.length) {
      // Video cartridge: frames canvas plus the live develop, side by side.
      const c = document.createElement("canvas");
      c.width = part.frames[0].width;
      c.height = part.frames[0].height;
      c.className = "np-frames";
      npReveal.append(c);
      npReveal.hidden = false;
      np.frameCtx = c.getContext("2d");
      np.frameCtx.drawImage(part.frames[0], 0, 0);
      np.frameIdx = 0;
    }
    if (!part || !part.img) {
      npReveal.hidden = np.frameCtx === null;
      return;
    }
    try {
      const r = new Stegassette.SeekableReveal(part.img, part.opts, part.revealEntry, {
        className: "np-reveal",
      });
      npReveal.append(r.element);
      npReveal.hidden = false;
      np.revealObj = r;
    } catch (e) {
      npReveal.hidden = np.frameCtx === null;
    }
    // Single-part chains never revisit the image; free the pixels. Multi-part
    // chains keep them so seeking back to an earlier part can rebuild.
    if (np.expected === 1) part.img = null;
  }

  // ── lyrics ────────────────────────────────────────────────────────────────
  function lyricAt(arr, ms) {
    let lo = 0,
      hi = arr.length - 1,
      ans = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (arr[m].t <= ms) {
        ans = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    return ans;
  }

  function renderLyricsTimed(lyrics) {
    npLyrics.textContent = "";
    npLyrics.classList.add("lyrics--timed");
    const els = lyrics.map((l) => {
      const div = document.createElement("div");
      const words = [];
      if (l.words && l.words.length) {
        l.words.forEach((w, i) => {
          const span = document.createElement("span");
          span.textContent = (i ? " " : "") + w.text;
          div.append(span);
          words.push({ t: w.t, el: span });
        });
      } else {
        div.textContent = l.line || " ";
      }
      npLyrics.append(div);
      return { el: div, words };
    });
    npLyrics.hidden = false;
    return els;
  }

  function renderLyricsPlain(text) {
    npLyrics.textContent = text;
    npLyrics.classList.remove("lyrics--timed");
    npLyrics.hidden = false;
  }

  function renderTexts(entries) {
    npTexts.textContent = "";
    const skip = new Set(["Lyrics", "Title"]);
    entries
      .filter((e) => /^text\//.test(e.mimetype) && !skip.has(e.name) && e.name !== "part.json")
      .forEach((e) => line(npTexts, `${e.name.toLowerCase()} — ${textOf(e)}`, "u-faint ht-type-small"));
    npTexts.hidden = !npTexts.childElementCount;
  }

  // ── the 100 ms tick ───────────────────────────────────────────────────────
  function tick() {
    if (!np) return;
    const pos = position();
    const total = totalShown();
    if (!dragging) {
      npSeek.value = total ? Math.round((pos / total) * 1000) : 0;
      npTime.textContent = `${fmtTime(pos)} / ${allLoaded() ? "" : "≈"}${fmtTime(total)}`;
    }
    const j = partAt(pos);
    if (j >= 0 && j !== np.partIdx) {
      switchReveal(j);
      if (np.expected > 1) {
        pressThumb(np.parts[j].gridIdx);
        npTitle.textContent = itemLabel(np.parts[j].gridIdx);
        npView.href = Releases.url(rel, rel.items[np.parts[j].gridIdx].file);
      }
    }
    // A loop wrap jumps the playhead backward; start the develop over.
    if (np.loop && np.revealObj && pos < np.lastPos) np.revealObj.reset();
    np.lastPos = pos;
    if (np.revealObj && j >= 0) {
      const p = np.parts[j];
      np.revealObj.seek((pos - p.start) / p.dur);
    }
    if (np.frameCtx && j >= 0) {
      const p = np.parts[j];
      const n = p.frames.length;
      const idx = Math.min(n - 1, Math.max(0, Math.floor(((pos - p.start) / p.dur) * n)));
      if (idx !== np.frameIdx) {
        np.frameIdx = idx;
        np.frameCtx.drawImage(p.frames[idx], 0, 0);
      }
    }
    if (np.lyrics && np.lyricEls) {
      const ms = pos * 1000;
      const idx = lyricAt(np.lyrics, ms);
      if (idx !== np.lineIdx) {
        if (np.lineIdx >= 0) {
          const prev = np.lyricEls[np.lineIdx];
          prev.el.classList.remove("on");
          prev.words.forEach((w) => w.el.classList.remove("on"));
        }
        np.lineIdx = idx;
        if (idx >= 0) {
          np.lyricEls[idx].el.classList.add("on");
          np.lyricEls[idx].el.scrollIntoView({ block: "nearest" });
        }
      }
      if (idx >= 0) {
        np.lyricEls[idx].words.forEach((w) => w.el.classList.toggle("on", w.t <= ms));
      }
    }
  }

  // ── decode one item into a chain part ─────────────────────────────────────
  async function extractAudio(entries) {
    const partEntry = entries.find((e) => e.name === "part.json");
    const part = partEntry ? JSON.parse(textOf(partEntry)) : null;
    const audioEntry = part
      ? entries.find((e) => e.name !== "part.json") // encoder puts the payload right after part.json
      : entries.find((e) => Stegassette.isAudioEntry(e));
    if (!audioEntry) throw new Error("no audio in this image");
    let data = audioEntry.data;
    if (part && part.encrypted) {
      if (!albumKey) throw new Error("locked — the cover holds the key and it has not decoded");
      data = await Stegassette.decryptBytes(albumKey, part.iv, data);
    }
    const parsed = Stegassette.parseAudioEntry({
      mimetype: audioEntry.mimetype,
      name: audioEntry.name,
      data,
    });
    return { parsed, audioEntry };
  }

  async function decodeItem(blob, gridIdx) {
    const img = await imgFromBlob(blob);
    const { entries, opts } = Stegassette.decodeContainer(img, img);
    const { parsed, audioEntry } = await extractAudio(entries);
    const buffer = actx.createBuffer(parsed.channels.length, parsed.channels[0].length, parsed.sampleRate);
    for (let c = 0; c < parsed.channels.length; c++) buffer.getChannelData(c).set(parsed.channels[c]);
    // Past this size, the byte-order sweep (revealSpanForEntry) re-decodes the
    // whole payload and sorts a pixel-count index array on the main thread —
    // seconds of jank on the biggest tracks. Fall back to the traversal-order
    // sweep (null entry), which also lets the payload bytes be freed.
    const REVEAL_ENTRY_MAX = 32e6;
    let frames = null;
    if (rel.kind === "video") {
      const frameEntries = entries
        .filter((e) => /^frame-\d+$/.test(e.name) && /^image\//.test(e.mimetype))
        .sort((a, b) => parseInt(a.name.slice(6), 10) - parseInt(b.name.slice(6), 10));
      if (frameEntries.length) {
        frames = await Promise.all(
          frameEntries.map((e) => createImageBitmap(new Blob([e.data], { type: e.mimetype }))),
        );
      }
    }
    return {
      buffer,
      dur: buffer.duration,
      img,
      opts,
      revealEntry: audioEntry.data.length <= REVEAL_ENTRY_MAX ? audioEntry : null,
      frames,
      entries,
      gridIdx,
    };
  }

  // ── loading: one item, or every item in sequence ──────────────────────────
  async function loadSequence(indices) {
    const gen = ++loadGen;
    if (loadAbort) loadAbort.abort();
    const ctrl = new AbortController();
    loadAbort = ctrl;
    ensureCtx(); // inside the tap gesture
    pause();
    if (np) {
      // Release the superseded chain's frame bitmaps (GPU-backed).
      for (const p of np.parts) {
        if (p.frames) {
          for (const b of p.frames) {
            try {
              b.close();
            } catch (e) {}
          }
          p.frames = null;
        }
      }
    }
    np = mkChain(gen, indices.length);
    npReveal.hidden = true;
    npReveal.textContent = "";
    npLyrics.hidden = true;
    npTexts.hidden = true;
    npCtrls.hidden = true;
    pressThumb(indices.length === 1 ? indices[0] : -1);
    npSection.hidden = false;
    npTitle.textContent = itemLabel(indices[0]);
    npView.href = Releases.url(rel, rel.items[indices[0]].file);
    npView.hidden = false;
    npStatus.hidden = false;
    npStatus.dataset.state = "busy";
    npProg.hidden = false;
    npProg.value = 0;
    npSection.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const chain = np;
    try {
      for (let k = 0; k < indices.length; k++) {
        const i = indices[k];
        const item = rel.items[i];
        const tag = indices.length > 1 ? `${itemLabel(i)} · ` : "";
        const blob = await fetchBlob(
          Releases.url(rel, item.file),
          item.bytes,
          (frac, got, total, fromStore) => {
            if (gen !== loadGen) return;
            npProg.value = frac;
            npStatus.textContent = fromStore
              ? `${tag}from storage`
              : `${tag}${fmtBytes(got)} / ${total ? fmtBytes(total) : "?"}`;
          },
          ctrl.signal,
        );
        if (gen !== loadGen) return;
        npStatus.textContent = `${tag}decoding`;
        npProg.removeAttribute("value"); // indeterminate while pixels churn
        await nextFrame();
        if (gen !== loadGen) return; // skip a stale multi-second decode
        const part = await decodeItem(blob, i);
        if (gen !== loadGen) return;
        addPart(chain, part);
        npProg.value = 0;
        if (k === 0) {
          const timed =
            indices.length === 1 &&
            album &&
            album.tracks[i] &&
            album.tracks[i].lyrics &&
            album.tracks[i].lyrics.length;
          if (timed) {
            chain.lyrics = album.tracks[i].lyrics;
            chain.lyricEls = renderLyricsTimed(chain.lyrics);
            chain.lineIdx = -1;
          } else if (indices.length === 1) {
            const lyricEntry = part.entries.find(
              (e) => e.name === "Lyrics" && /^text\//.test(e.mimetype),
            );
            if (lyricEntry) renderLyricsPlain(textOf(lyricEntry));
          }
          renderTexts(part.entries);
          npCtrls.hidden = false;
          if (!tickTimer) tickTimer = setInterval(tick, 100);
          playFrom(0);
          tick();
        }
        part.entries = null; // payload bytes are copied out; drop the references
      }
      if (gen !== loadGen) return;
      npStatus.hidden = true;
      npProg.hidden = true;
    } catch (e) {
      if (gen !== loadGen) return;
      // The chain ends at whatever loaded; the toggle can then replay it
      // instead of stalling forever on a part that will never arrive.
      chain.expected = chain.parts.length;
      chain.stalled = false;
      npProg.hidden = true;
      npStatus.hidden = false;
      npStatus.dataset.state = "error";
      npStatus.textContent = e.message || String(e);
    }
  }

  if (playAllBtn) {
    playAllBtn.addEventListener("click", () => {
      loadSequence(rel.items.map((_, i) => i));
    });
  }

  if (rel.kind === "album") loadCover();
})();
