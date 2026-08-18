"use strict";
/* ============================================================
   album.js — the stega-album format.

   An album is a folder of STGC stegassette PNGs:

     00-cover-<slug>.png    the record itself. Carries album.json:
                            metadata, ownership, per-track lyrics with
                            timestamps, the audio format, and the album
                            key. Also carries the cover artwork.
     <t>-<p>-<slug>.png     one part of one track. Carries part.json
                            (album id, track, part, of, iv) and the
                            encrypted PCM for that part.

   A track's PCM is one byte stream cut into parts, so a track can span
   as many images as you like; concatenating the parts in order gives the
   stream back exactly.

   "Encryption" here is possession-based, and worth being precise about:
   the AES-GCM key lives in the cover stegassette, so the tracks are noise
   without it — you need the original album to play the songs. It is NOT
   protection against someone who has the cover: holding the record means
   holding the key. That is the intent (a record you own), not a DRM claim.
   ============================================================ */

const Album = (() => {
  const FORMAT = "stega-album/1";
  const COVER_ENTRY = "album.json";
  const PART_ENTRY = "part.json";

  // Encrypted payloads are high-entropy, so a low-strength combine keeps
  // the artwork readable underneath. All combines are lossless. This is the
  // codec's collection default; albums have never wanted anything else.
  const STEG = Stegassette.COLLECTION_STEG;
  // the methods a build can choose from, straight out of the format.
  // TRAVERSAL_NAMES keeps legacy traversals too, since decode still has to
  // recognize them — TRAVERSAL_LEGACY is what marks them not-for-encoding.
  const METHODS = {
    combine: Stegassette.COMBINE_NAMES,
    traversal: Stegassette.TRAVERSAL_NAMES.filter(
      (n) => !Stegassette.TRAVERSAL_LEGACY[n],
    ),
    keymap: Stegassette.KEYMAP_NAMES,
  };

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ---- small helpers -----------------------------------------
  // base64, slug, hexId and the AES-GCM pair come from the codec's collection
  // layer (2026.08.01). They used to live here and be hand-ported into the
  // Node jobs repo, which meant two implementations of the same format kept in
  // step by discipline. One copy now serves both.
  const {
    toBase64: b64,
    fromBase64: unb64,
    hexId: hex,
    slug,
    newKey,
    importKey,
    encryptBytes,
    decryptBytes,
    splitStream,
    joinParts,
  } = Stegassette;

  // Display-only, so it stays local: too generic a name to belong in the
  // codec's public surface.
  const pad = (n, w) => String(n).padStart(w, "0");
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return ((sec / 60) | 0) + ":" + pad(sec % 60, 2);
  }

  // ---- images ------------------------------------------------
  async function imgFromBlob(blob) {
    let bmp;
    try {
      bmp = await createImageBitmap(blob, { colorSpaceConversion: "none" });
    } catch (_) {
      bmp = await createImageBitmap(blob);
    }
    const W = bmp.width,
      H = bmp.height;
    const cnv = Object.assign(document.createElement("canvas"), {
      width: W,
      height: H,
    });
    const ctx = cnv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return new Stegassette.Img(
      W,
      H,
      new Uint8Array(ctx.getImageData(0, 0, W, H).data),
    );
  }
  function imgToPngBlob(img) {
    const cnv = Object.assign(document.createElement("canvas"), {
      width: img.width,
      height: img.height,
    });
    // putImageData writes the bytes verbatim (no premultiplication), which
    // matters because the STGC header lives in the border alpha
    cnv
      .getContext("2d")
      .putImageData(
        new ImageData(
          new Uint8ClampedArray(img.data),
          img.width,
          img.height,
        ),
        0,
        0,
      );
    return new Promise((res, rej) =>
      cnv.toBlob((b) => (b ? res(b) : rej(new Error("PNG encode failed"))), "image/png"),
    );
  }
  // entries → a stegassette PNG carried by srcImg.
  //
  // The sizing lives in the codec's collection layer now — the artwork keeps
  // its own resolution whenever it already has room for the payload, and is
  // only resized when it is genuinely too small. This wrapper is just the
  // browser tail: the layer returns pixels, the page wants a Blob.
  async function encodeStegassette(entries, srcImg, steg = STEG) {
    const out = Stegassette.encodeStegassette(entries, srcImg, steg);
    return { blob: await imgToPngBlob(out), width: out.width, height: out.height };
  }

  // ---- audio -------------------------------------------------
  // One context per sample rate: decodeAudioData resamples to the
  // context's rate, which is how the target rate is applied.
  const ctxCache = new Map();
  function audioCtxAt(rate) {
    if (!ctxCache.has(rate))
      ctxCache.set(rate, new OfflineAudioContext(2, 1, rate));
    return ctxCache.get(rate);
  }
  async function decodeAudioFile(file, rate, wantChannels) {
    const buf = await audioCtxAt(rate).decodeAudioData(await file.arrayBuffer());
    const chans = [];
    if (wantChannels === 1 && buf.numberOfChannels > 1) {
      // downmix
      const n = buf.length;
      const mix = new Float32Array(n);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < n; i++) mix[i] += d[i] / buf.numberOfChannels;
      }
      chans.push(mix);
    } else {
      for (let c = 0; c < wantChannels; c++)
        chans.push(
          new Float32Array(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1))),
        );
    }
    return { channels: chans, rate: buf.sampleRate, frames: buf.length };
  }

  // ---- lyrics ------------------------------------------------
  // LRC: [mm:ss.xx] line — several stamps may share one line. Enhanced LRC
  // also times individual words inline, <mm:ss.xx> before each one:
  //   [00:12.00]<00:12.00>Hello <00:12.60>world
  // Word times are kept when a line carries a single stamp; with repeats
  // there is no telling which occurrence they belong to.
  function stampMs(mm, ss, frac) {
    // the fraction is centiseconds at two digits, milliseconds at three
    const f = frac || "";
    const ms = f
      ? f.length >= 3
        ? parseInt(f.slice(0, 3), 10)
        : parseInt(f, 10) * 10
      : 0;
    return (+mm * 60 + +ss) * 1000 + ms;
  }
  function parseLrc(text) {
    const out = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const stamps = [...raw.matchAll(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g)];
      if (!stamps.length) continue;
      const body = raw.replace(/\[[^\]]*\]/g, "");
      const words = [];
      for (const w of body.matchAll(/<(\d+):(\d+)(?:[.:](\d+))?>([^<]*)/g)) {
        const text = w[4].trim();
        if (text) words.push({ t: stampMs(w[1], w[2], w[3]), text });
      }
      const line = body
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!line) continue;
      const timed = stamps.length === 1 && words.length ? words : null;
      for (const m of stamps)
        out.push({
          t: stampMs(m[1], m[2], m[3]),
          line,
          ...(timed ? { words: timed } : {}),
        });
    }
    return out.sort((a, b) => a.t - b.t);
  }
  // index of the line (or word) that should be lit at `ms`, -1 before the
  // first; anything with a `t` works
  function lyricAt(lyrics, ms) {
    if (!lyrics || !lyrics.length) return -1;
    let lo = 0,
      hi = lyrics.length - 1,
      found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lyrics[mid].t <= ms) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }

  // peak of the loudest sample across a track's channels
  function peakOf(channels) {
    let peak = 0;
    for (const c of channels)
      for (let i = 0; i < c.length; i++) {
        const a = Math.abs(c[i]);
        if (a > peak) peak = a;
      }
    return peak;
  }

  // ---- build -------------------------------------------------
  // tracks: [{ file, title, lyrics }]  carriers: [Blob] (cycled)
  // audio:  { rate, bits, channels }   partsPerTrack: n
  // steg:   { combine, traversal, keymap, border }
  // normalize: { mode: "album" | "track" | "off", db }
  //   album — one shared gain, so the loudest moment on the record hits the
  //           target and the tracks keep their relative loudness
  //   track — every track peaks at the target
  async function build({
    tracks,
    coverBlob,
    carriers,
    meta = {},
    ownership = {},
    audio = { rate: 22050, bits: 16, channels: 2 },
    partsPerTrack = 1,
    steg = {},
    normalize = { mode: "album", db: -1 },
    encrypt = true,
    onProgress = () => {},
  }) {
    if (!tracks || !tracks.length) throw new Error("no audio tracks");
    if (!coverBlob) throw new Error("no cover image");
    const carrierBlobs = carriers && carriers.length ? carriers : [coverBlob];
    const method = { ...STEG, ...steg };
    // A non-numeric target would make the gain NaN, and every sample with
    // it — which reads as full scale but is constant DC, i.e. silence.
    const norm = {
      mode: normalize.mode || "album",
      db: Number.isFinite(normalize.db) ? Math.min(0, normalize.db) : -1,
    };

    // Without encryption the parts carry plain PCM under a real audio
    // mimetype, so each image plays anywhere — including in the plain
    // stega-now player — and the cover is only metadata and lyrics.
    const keyB64 = encrypt ? newKey() : null;
    const key = encrypt ? await importKey(keyB64) : null;
    const albumId = hex(8);
    // Each part carries whole frames in this layout, so either choice leaves
    // a part playable on its own; planar keeps a channel contiguous within
    // an image, interleaved keeps the two channels side by side.
    const layout = audio.layout || "planar";

    const files = [];
    const trackMeta = [];
    let carrierIdx = 0;
    const carrierImgs = new Map(); // decoded lazily, reused across parts

    // album gain needs every peak up front, so measure in a first pass and
    // decode again while encoding (cheaper than holding every track's audio)
    let albumGain = 1;
    if (norm.mode === "album") {
      let peak = 0;
      for (let t = 0; t < tracks.length; t++) {
        onProgress(`measuring ${tracks[t].title}`, (t / tracks.length) * 0.25);
        const { channels } = await decodeAudioFile(
          tracks[t].file,
          audio.rate,
          audio.channels,
        );
        peak = Math.max(peak, peakOf(channels));
      }
      const g = Math.pow(10, norm.db / 20) / peak;
      if (peak > 0 && Number.isFinite(g)) albumGain = g;
    }

    for (let t = 0; t < tracks.length; t++) {
      const tr = tracks[t];
      const no = t + 1;
      onProgress(`decoding ${tr.title}`, t / tracks.length);
      const { channels, frames } = await decodeAudioFile(
        tr.file,
        audio.rate,
        audio.channels,
      );
      if (norm.mode === "track")
        Stegassette.peakNormalize(channels, { targetDb: norm.db });
      else if (norm.mode === "album" && albumGain !== 1)
        for (const c of channels)
          for (let i = 0; i < c.length; i++) c[i] *= albumGain;
      // Cut by FRAMES, not bytes, and lay out each part on its own: every
      // image then holds a whole, self-contained segment of the song — all
      // channels, no half samples — so one image is playable by itself
      // rather than holding, say, only the left channel's first half.
      const P = Math.max(1, parseInt(partsPerTrack) || 1);
      const perPart = Math.ceil(frames / P);
      let pcmBytes = 0;
      for (let p = 0; p < P; p++) {
        const f0 = p * perPart,
          f1 = Math.min(frames, f0 + perPart);
        if (f1 <= f0) continue;
        const slice = channels.map((c) => c.subarray(f0, f1));
        const chunk = Stegassette.float32ToPcm(
          Stegassette.layoutChannels({ mixed: slice, layout }),
          audio.bits,
        );
        pcmBytes += chunk.length;
        onProgress(
          `${encrypt ? "encrypting" : "packing"} ${tr.title} part ${p + 1}/${P}`,
          (t + (p + 1) / P / 2) / tracks.length,
        );
        const { iv, data } = encrypt
          ? await encryptBytes(key, chunk)
          : { iv: null, data: chunk };
        // self-describing, so a single image can be played on its own
        const partJson = {
          format: FORMAT,
          id: albumId,
          track: no,
          part: p + 1,
          of: P,
          iv,
          encrypted: !!encrypt,
          bytes: chunk.length,
          startFrame: f0,
          frames: f1 - f0,
          rate: audio.rate,
          bits: audio.bits,
          channels: audio.channels,
          layout,
        };
        const entries = [
          {
            mimetype: "application/json",
            name: PART_ENTRY,
            data: enc.encode(JSON.stringify(partJson)),
          },
          {
            // Always raw PCM, encrypted or not. A track image is an audio
            // stegassette wherever it turns up: with the cover it is the
            // music, without it the ciphertext plays as the noise it is.
            mimetype: Stegassette.buildAudioMime({
              bits: audio.bits,
              rate: audio.rate,
              channels: audio.channels,
              layout,
            }),
            name: `t${pad(no, 2)}p${pad(p + 1, 2)}`,
            data,
          },
        ];
        const cb = carrierBlobs[carrierIdx++ % carrierBlobs.length];
        if (!carrierImgs.has(cb)) carrierImgs.set(cb, await imgFromBlob(cb));
        onProgress(
          `hiding ${tr.title} part ${p + 1}/${P}`,
          (t + (p + 1) / P) / tracks.length,
        );
        const { blob, width, height } = await encodeStegassette(
          entries,
          carrierImgs.get(cb),
          method,
        );
        files.push({
          name: `${pad(no, 2)}-${pad(p + 1, 2)}-${slug(tr.title)}.png`,
          blob,
          width,
          height,
        });
      }

      trackMeta.push({
        n: no,
        title: tr.title,
        parts: Math.max(1, parseInt(partsPerTrack) || 1),
        bytes: pcmBytes,
        frames,
        durationMs: Math.round((frames / audio.rate) * 1000),
        lyrics: tr.lyrics || [],
      });
    }

    // the cover: metadata, lyrics, ownership, the key, and the artwork
    const albumJson = {
      format: FORMAT,
      id: albumId,
      created: new Date().toISOString(),
      album: {
        title: meta.title || "Untitled",
        artist: meta.artist || "",
        year: meta.year || "",
        notes: meta.notes || "",
      },
      ownership: {
        owner: ownership.owner || "",
        purchased: ownership.purchased || "",
        copy: ownership.copy || "",
        note: ownership.note || "",
      },
      audio: { ...audio, layout },
      steg: method,
      normalize: norm,
      encrypted: !!encrypt,
      key: keyB64,
      tracks: trackMeta,
    };
    onProgress("hiding the cover", 0.98);
    const coverEntries = [
      {
        mimetype: "application/json",
        name: COVER_ENTRY,
        data: enc.encode(JSON.stringify(albumJson)),
      },
      {
        mimetype: coverBlob.type || "image/jpeg",
        name: "cover",
        data: new Uint8Array(await coverBlob.arrayBuffer()),
      },
    ];
    const cover = await encodeStegassette(
      coverEntries,
      carrierImgs.get(coverBlob) || (await imgFromBlob(coverBlob)),
      method,
    );
    files.unshift({
      name: `00-cover-${slug(albumJson.album.title)}.png`,
      blob: cover.blob,
      width: cover.width,
      height: cover.height,
    });
    onProgress("done", 1);
    return { files, album: albumJson };
  }

  // ---- read --------------------------------------------------
  // Pull the cover and the parts out of a pile of files. Anything that
  // isn't a stegassette of this album is reported rather than dropped.
  async function read(fileList, onProgress = () => {}) {
    const files = [...fileList].filter((f) => /\.png$/i.test(f.name));
    let cover = null,
      art = null,
      coverBlob = null;
    const parts = [];
    const skipped = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      onProgress(`reading ${f.name}`, i / files.length);
      try {
        const img = await imgFromBlob(f);
        const { entries, opts } = Stegassette.decodeContainer(img, img);
        const cj = entries.find((e) => e.name === COVER_ENTRY);
        if (cj) {
          cover = JSON.parse(dec.decode(cj.data));
          const a = entries.find((e) => e.name === "cover");
          if (a) art = new Blob([a.data], { type: a.mimetype });
          coverBlob = f;
          continue;
        }
        const pj = entries.find((e) => e.name === PART_ENTRY);
        if (pj) {
          const info = JSON.parse(dec.decode(pj.data));
          const payload = entries.find((e) => e.name !== PART_ENTRY);
          // The file is kept so the reveal can re-read the image later
          // without holding every stegassette's pixels in memory at once.
          // The decode opts and the payload's position are kept too, so
          // building that reveal doesn't have to decode the container again.
          parts.push({
            ...info,
            data: payload ? payload.data : null,
            file: f.name,
            blob: f,
            opts,
            payloadAt: payload
              ? {
                  dataOffset: payload.dataOffset,
                  byteLength: payload.data.length,
                  mimetype: payload.mimetype,
                }
              : null,
          });
          continue;
        }
        skipped.push(f.name + ": not part of an album");
      } catch (err) {
        skipped.push(f.name + ": " + err.message);
      }
    }
    onProgress("done", 1);
    return { cover, art, coverBlob, parts, skipped };
  }

  // Where each part sits in the song. A part holds whole frames, so it maps
  // to a span of seconds — which is what lets playback follow the song from
  // image to image, whatever the channel layout.
  function partSpans(album, parts) {
    const rate = album.audio.rate;
    const bpf = album.audio.channels * (album.audio.bits / 8);
    let at = 0;
    return [...parts]
      .sort((a, b) => a.part - b.part)
      .map((p) => {
        const n = p.frames != null ? p.frames : p.bytes / bpf;
        const start = (p.startFrame != null ? p.startFrame : at) / rate;
        at += n;
        return { ref: p, part: p.part, start, end: start + n / rate };
      });
  }
  // which span contains `sec`
  function spanAt(spans, sec) {
    for (let i = spans.length - 1; i >= 0; i--)
      if (sec >= spans[i].start) return i;
    return 0;
  }

  // Which parts are present / missing for a track.
  function trackParts(album, parts, n) {
    const t = album.tracks.find((x) => x.n === n);
    const mine = parts
      .filter((p) => p.track === n && p.id === album.id)
      .sort((a, b) => a.part - b.part);
    const have = new Set(mine.map((p) => p.part));
    const missing = [];
    for (let i = 1; i <= (t ? t.parts : 0); i++) if (!have.has(i)) missing.push(i);
    return { track: t, parts: mine, missing };
  }

  // The audio format of one part. Each part states its own, so this works
  // with no cover present.
  function partFormat(album, part) {
    const a = (album && album.audio) || {};
    return {
      rate: part.rate || a.rate || 22050,
      bits: part.bits || a.bits || 16,
      channels: part.channels || a.channels || 2,
      layout: part.layout || a.layout || "planar",
    };
  }
  // Read bytes as PCM in the part's own format. Used for plain parts, and
  // for the locked case where the bytes are ciphertext — then this is what
  // the encrypted audio sounds like, which is noise.
  function bytesToChannels(bytes, fmt) {
    const planar = Stegassette.unlayoutChannels({
      f32: Stegassette.toFloat32(bytes, fmt.bits),
      layout: fmt.layout,
      channels: fmt.channels,
      blockSize: 0,
    });
    const n = (planar.length / fmt.channels) | 0;
    const out = [];
    for (let c = 0; c < fmt.channels; c++)
      out.push(planar.subarray(c * n, (c + 1) * n));
    return { channels: out, frames: n, rate: fmt.rate };
  }

  // One part into its own channel data. Each part is a whole segment, so
  // this stands alone — one image plays without the rest of the track.
  // With no key, or none needed, the bytes are read as they are: plain
  // parts play, encrypted ones come out as noise.
  async function decodePart(album, key, part) {
    const fmt = partFormat(album, part);
    const locked = part.encrypted !== false && part.iv && !key;
    const bytes =
      part.encrypted === false || !part.iv || locked
        ? part.data
        : await decryptBytes(key, part.iv, part.data);
    return { ...bytesToChannels(bytes, fmt), locked };
  }

  // A stand-in album for images loaded without their cover: the parts
  // describe their own format and where they sit, so they can still be
  // grouped into tracks and played (or heard as noise, if encrypted).
  function standaloneAlbum(parts) {
    if (!parts.length) return null;
    const id = parts[0].id;
    const mine = parts.filter((p) => p.id === id);
    const fmt = partFormat(null, mine[0]);
    const byTrack = new Map();
    for (const p of mine) {
      if (!byTrack.has(p.track)) byTrack.set(p.track, []);
      byTrack.get(p.track).push(p);
    }
    const tracks = [...byTrack.keys()]
      .sort((a, b) => a - b)
      .map((n) => {
        const ps = byTrack.get(n).sort((a, b) => a.part - b.part);
        const frames = ps.reduce((s, p) => s + (p.frames || 0), 0);
        return {
          n,
          title: "track " + n,
          parts: ps[0].of || ps.length,
          frames,
          bytes: ps.reduce((s, p) => s + p.bytes, 0),
          durationMs: Math.round((frames / fmt.rate) * 1000),
          lyrics: [],
        };
      });
    return {
      format: FORMAT,
      id,
      album: { title: "album without its cover", artist: "", year: "", notes: "" },
      ownership: {},
      audio: fmt,
      steg: null,
      encrypted: mine.some((p) => p.encrypted !== false && p.iv),
      key: null,
      tracks,
      synthetic: true,
    };
  }

  // Decrypt every part and lay them end to end. Parts are consecutive
  // segments of the same song, so the joins fall on frame boundaries.
  async function assemble(album, key, parts) {
    const ordered = [...parts].sort((a, b) => a.part - b.part);
    const chunks = [];
    let total = 0;
    for (const p of ordered) {
      const c = await decodePart(album, key, p);
      chunks.push(c);
      total += c.frames;
    }
    const channels = album.audio.channels;
    const out = Array.from({ length: channels }, () => new Float32Array(total));
    let at = 0;
    for (const c of chunks) {
      for (let ch = 0; ch < channels; ch++) out[ch].set(c.channels[ch], at);
      at += c.frames;
    }
    return { channels: out, frames: total, rate: album.audio.rate };
  }

  // ---- re-encode without the encryption ----------------------
  // With the cover in hand the plaintext is recoverable, so the images can
  // be made again from the audio itself instead of from ciphertext. The
  // carrier is the reconstruction pulled back out of the stegassette, so the
  // artwork survives; the difference is that every data pixel now derives
  // from a real sample. Combines that track amplitude (signed, veil,
  // midpoint) then show the waveform in the picture rather than noise.
  async function reencode(album, key, parts, { onProgress = () => {} } = {}) {
    const method = album.steg || STEG;
    const files = [];
    const ordered = [...parts].sort(
      (a, b) => a.track - b.track || a.part - b.part,
    );
    for (let i = 0; i < ordered.length; i++) {
      const p = ordered[i];
      onProgress(`re-encoding ${p.track}/${p.part}`, i / ordered.length);
      const img = await imgFromBlob(p.blob);
      const { entries, opts } = Stegassette.decodeContainer(img, img);
      const pathIdx = Stegassette.getPathIndices(
        img.width - 2 * (opts.borderWidth || 1),
        img.height - 2 * (opts.borderWidth || 1),
        opts.traversal,
        opts.params || {},
      );
      // the cover art as recovered from this stegassette, at full size
      const rec = Stegassette.computeRecon(img, pathIdx, opts);
      const small = Object.assign(document.createElement("canvas"), {
        width: rec.width,
        height: rec.height,
      });
      small
        .getContext("2d")
        .putImageData(new ImageData(rec.data, rec.width, rec.height), 0, 0);
      const full = Object.assign(document.createElement("canvas"), {
        width: img.width,
        height: img.height,
      });
      const fc = full.getContext("2d", { willReadFrequently: true });
      fc.drawImage(small, 0, 0, img.width, img.height);
      const carrier = new Stegassette.Img(
        img.width,
        img.height,
        new Uint8Array(fc.getImageData(0, 0, img.width, img.height).data),
      );

      const clear = p.iv
        ? await decryptBytes(key, p.iv, p.data)
        : p.data;
      const info = { ...p, iv: null, encrypted: false, bytes: clear.length };
      for (const k of ["data", "blob", "opts", "payloadAt", "file"])
        delete info[k];
      const audioEntry = entries.find((e) => /^audio\//i.test(e.mimetype));
      const out = await encodeStegassette(
        [
          {
            mimetype: "application/json",
            name: PART_ENTRY,
            data: enc.encode(JSON.stringify(info)),
          },
          {
            mimetype: audioEntry
              ? audioEntry.mimetype
              : Stegassette.buildAudioMime(partFormat(album, p)),
            name: `t${pad(p.track, 2)}p${pad(p.part, 2)}`,
            data: clear,
          },
        ],
        carrier,
        method,
      );
      files.push({
        name: `${pad(p.track, 2)}-${pad(p.part, 2)}-plain.png`,
        blob: out.blob,
        width: out.width,
        height: out.height,
      });
    }
    onProgress("done", 1);
    return files;
  }

  // ---- zip (store-only; PNGs are already compressed) ---------
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function zip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const put = (arr) => {
      chunks.push(arr);
      offset += arr.length;
    };
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const sum = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true); // version
      local.setUint16(6, 0, true); // flags
      local.setUint16(8, 0, true); // stored
      local.setUint32(10, 0, true); // time/date
      local.setUint32(14, sum, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      const localOff = offset;
      put(new Uint8Array(local.buffer));
      put(name);
      put(data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0, true);
      cd.setUint16(10, 0, true);
      cd.setUint32(12, 0, true);
      cd.setUint32(16, sum, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint16(30, 0, true);
      cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true);
      cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true);
      cd.setUint32(42, localOff, true);
      central.push(new Uint8Array(cd.buffer), name);
    }
    const cdStart = offset;
    let cdLen = 0;
    for (const c of central) {
      chunks.push(c);
      cdLen += c.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdLen, true);
    end.setUint32(16, cdStart, true);
    chunks.push(new Uint8Array(end.buffer));
    return new Blob(chunks, { type: "application/zip" });
  }

  return {
    FORMAT,
    COVER_ENTRY,
    PART_ENTRY,
    STEG,
    METHODS,
    partSpans,
    spanAt,
    slug,
    pad,
    fmtTime,
    newKey,
    importKey,
    encryptBytes,
    decryptBytes,
    imgFromBlob,
    imgToPngBlob,
    encodeStegassette,
    decodeAudioFile,
    parseLrc,
    lyricAt,
    build,
    read,
    trackParts,
    assemble,
    decodePart,
    partFormat,
    standaloneAlbum,
    reencode,
    zip,
  };
})();
