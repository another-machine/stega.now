"use strict";
/* ============================================================
   album.js — the stega-album format.

   An album is a folder of STGC cartridge PNGs:

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
   the AES-GCM key lives in the cover cartridge, so the tracks are noise
   without it — you need the original album to play the songs. It is NOT
   protection against someone who has the cover: holding the record means
   holding the key. That is the intent (a record you own), not a DRM claim.
   ============================================================ */

const Album = (() => {
  const FORMAT = "stega-album/1";
  const COVER_ENTRY = "album.json";
  const PART_ENTRY = "part.json";

  // Encrypted payloads are high-entropy, so a low-strength combine keeps
  // the artwork readable underneath. All combines are lossless.
  const STEG = {
    combine: "veil",
    traversal: "hilbert",
    keyMap: "adjacent",
    border: 0.02,
  };
  // the methods a build can choose from, straight out of the format
  const METHODS = {
    combine: StegCore.COMBINE_NAMES,
    traversal: StegCore.TRAVERSAL_NAMES,
    keymap: StegCore.KEYMAP_NAMES,
  };

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ---- small helpers -----------------------------------------
  const b64 = (u8) => {
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000)
      s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (s) => {
    const raw = atob(s);
    const u8 = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
    return u8;
  };
  const hex = (n) =>
    Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  function slug(s) {
    return (
      String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48) || "untitled"
    );
  }
  const pad = (n, w) => String(n).padStart(w, "0");
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return ((sec / 60) | 0) + ":" + pad(sec % 60, 2);
  }

  // ---- keys --------------------------------------------------
  const newKey = () => b64(crypto.getRandomValues(new Uint8Array(32)));
  const importKey = (keyB64) =>
    crypto.subtle.importKey("raw", unb64(keyB64), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  async function encryptBytes(key, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const out = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
    return { iv: b64(iv), data: new Uint8Array(out) };
  }
  async function decryptBytes(key, ivB64, bytes) {
    const out = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(ivB64) },
      key,
      bytes,
    );
    return new Uint8Array(out);
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
    return new StegCore.Img(
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
  // entries → a cartridge PNG carried by srcImg.
  // The artwork keeps its own resolution whenever it already has room for
  // the payload — scaling it down to the exact fit would turn an album
  // cover into a thumbnail. It is only resized when it is too small.
  async function encodeCartridge(entries, srcImg, steg = STEG) {
    const total = StegCore.containerInteriorBytes(entries);
    const aspect = srcImg.width / srcImg.height;
    const dataPx = Math.ceil(total / 3);
    const B = StegCore.resolveBorderWidth(steg.border, dataPx, aspect);
    const nativeB = StegCore.resolveBorderWidth(
      steg.border,
      Math.ceil((srcImg.width * srcImg.height) / 2),
      aspect,
    );
    const capacity =
      StegCore.dataPixelCount(
        srcImg.width - 2 * nativeB,
        srcImg.height - 2 * nativeB,
      ) * 3;
    const fits = capacity >= total && srcImg.width > 96;
    const useB = fits ? nativeB : B;
    const scaled = fits ? srcImg : StegCore.autoScaleImg(srcImg, total, B, null, 3);
    const out = StegCore.encodeContainer(entries, scaled, scaled, {
      combine: steg.combine,
      traversal: steg.traversal,
      keyMap: steg.keyMap,
      borderWidth: useB,
      params: {},
    });
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
  // LRC: [mm:ss.xx] line — several stamps may share one line.
  function parseLrc(text) {
    const out = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const stamps = [...raw.matchAll(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g)];
      if (!stamps.length) continue;
      const line = raw.replace(/\[[^\]]*\]/g, "").trim();
      if (!line) continue;
      for (const m of stamps) {
        // the fraction is centiseconds at two digits, milliseconds at three
        const f = m[3] || "";
        const frac = f
          ? f.length >= 3
            ? parseInt(f.slice(0, 3), 10)
            : parseInt(f, 10) * 10
          : 0;
        out.push({ t: (+m[1] * 60 + +m[2]) * 1000 + frac, line });
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }
  // index of the line that should be lit at `ms`, or -1 before the first
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
  // steg:   { combine, traversal, keyMap, border }
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
    onProgress = () => {},
  }) {
    if (!tracks || !tracks.length) throw new Error("no audio tracks");
    if (!coverBlob) throw new Error("no cover image");
    const carrierBlobs = carriers && carriers.length ? carriers : [coverBlob];
    const method = { ...STEG, ...steg };

    const keyB64 = newKey();
    const key = await importKey(keyB64);
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
    if (normalize.mode === "album") {
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
      if (peak > 0)
        albumGain = Math.pow(10, (normalize.db ?? -1) / 20) / peak;
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
      if (normalize.mode === "track")
        StegCore.peakNormalize(channels, { targetDb: normalize.db ?? -1 });
      else if (normalize.mode === "album" && albumGain !== 1)
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
        const chunk = StegCore.float32ToPcm(
          StegCore.layoutChannels({ mixed: slice, layout }),
          audio.bits,
        );
        pcmBytes += chunk.length;
        onProgress(
          `encrypting ${tr.title} part ${p + 1}/${P}`,
          (t + (p + 1) / P / 2) / tracks.length,
        );
        const { iv, data } = await encryptBytes(key, chunk);
        // self-describing, so a single image can be played on its own
        const partJson = {
          format: FORMAT,
          id: albumId,
          track: no,
          part: p + 1,
          of: P,
          iv,
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
            // encrypted, so not a playable audio mimetype on purpose
            mimetype: "application/octet-stream",
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
        const { blob, width, height } = await encodeCartridge(
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
      normalize,
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
    const cover = await encodeCartridge(
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
  // isn't a cartridge of this album is reported rather than dropped.
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
        const { entries, opts } = StegCore.decodeContainer(img, img);
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
          // without holding every cartridge's pixels in memory at once.
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

  // Decrypt one part into its own channel data. Each part is a whole
  // segment in the album's layout, so this stands alone — one image is
  // playable without the rest of the track.
  async function decodePart(album, key, part) {
    const { bits, channels, layout } = album.audio;
    const clear = await decryptBytes(key, part.iv, part.data);
    const planar = StegCore.unlayoutChannels({
      f32: StegCore.toFloat32(clear, bits),
      layout,
      channels,
      blockSize: 0,
    });
    const n = (planar.length / channels) | 0;
    const out = [];
    for (let c = 0; c < channels; c++)
      out.push(planar.subarray(c * n, (c + 1) * n));
    return { channels: out, frames: n, rate: album.audio.rate };
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
    encodeCartridge,
    decodeAudioFile,
    parseLrc,
    lyricAt,
    build,
    read,
    trackParts,
    assemble,
    decodePart,
    zip,
  };
})();
