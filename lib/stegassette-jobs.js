"use strict";
var StegassetteJobs = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/jobSchema.js
  var jobSchema_exports = {};
  __export(jobSchema_exports, {
    DEFAULTS: () => DEFAULTS,
    ENUMS: () => ENUMS,
    NORMALIZE_DEFAULT_DB: () => NORMALIZE_DEFAULT_DB2,
    SCHEMA_VERSION: () => SCHEMA_VERSION,
    SPLIT_AUDIO_KEYS: () => SPLIT_AUDIO_KEYS,
    expandJob: () => expandJob,
    expandJobs: () => expandJobs,
    framesSpec: () => framesSpec,
    isAudioEntry: () => isAudioEntry2,
    jobMode: () => jobMode,
    mimeFromPath: () => mimeFromPath,
    mosaicGrid: () => mosaicGrid,
    outBase: () => outBase,
    planChunks: () => planChunks,
    resolveAspect: () => resolveAspect,
    resolveConfig: () => resolveConfig,
    resolveJobs: () => resolveJobs,
    resolveNormalize: () => resolveNormalize2,
    splitAudioPath: () => splitAudioPath,
    splitBytesPerSecond: () => splitBytesPerSecond,
    splitSpec: () => splitSpec,
    validateConfig: () => validateConfig
  });

  // src/Stegassette/combine.ts
  var COMBINE_NAMES = [
    "xor",
    "additive",
    "subtractive",
    "midpoint",
    "difference",
    "bitshift",
    "noise",
    "echo",
    "signed",
    "veil",
    "whisper"
  ];

  // src/Stegassette/keymap.ts
  var KEYMAP_NAMES = [
    "adjacent",
    "poles",
    "mirror-x",
    "mirror-y",
    "offset",
    "rotate",
    // Keyless: there is no key pixel at all.
    "none"
  ];

  // src/Stegassette/traversal.ts
  var TRAVERSAL_NAMES = [
    "raster",
    "boustrophedon",
    "spiral",
    "angle",
    "fisher-yates",
    "center-out",
    "hilbert",
    "polar",
    "bayer"
  ];

  // src/Stegassette/channelPlan.ts
  var CHANNEL_NAMES = ["r", "g", "b"];
  var PACK_NAMES = ["packed", "aligned", "mono"];
  var CH = { r: 0, g: 1, b: 2 };
  function parseChannelPlan(token) {
    return String(token).split("+").map((t) => t.trim()).filter(Boolean).map((t) => {
      const [c, comb] = t.split(".");
      return { ch: CH[c], combine: comb || "xor" };
    }).filter((s) => s.ch === 0 || s.ch === 1 || s.ch === 2);
  }
  function slotsFromChannels(channels, fallbackCombine) {
    if (typeof channels === "string") {
      if (channels.includes(".") || channels.includes("+"))
        return parseChannelPlan(channels);
      return channels.toLowerCase().split("").filter((c) => c in CH).map((c) => ({ ch: CH[c], combine: fallbackCombine }));
    }
    return (channels || []).map((s) => {
      if (typeof s === "string")
        return { ch: CH[s.toLowerCase()], combine: fallbackCombine };
      const key = s.ch ?? s.channel;
      const ch = typeof key === "number" ? key : CH[String(key).toLowerCase()];
      return { ch, combine: s.combine || fallbackCombine };
    }).filter((s) => s.ch === 0 || s.ch === 1 || s.ch === 2);
  }
  function normalizeChannelPlan(opts = {}, bytesPerSample = 3, tableSize = 0) {
    const combine = opts.combine || "xor";
    if (opts.pack === "mono") {
      const slots2 = CHANNEL_NAMES.map((c) => ({
        ch: CH[c],
        combine
      }));
      return { slots: slots2, pad: 0, pack: "mono", bytesPerPixel: 1, broadcast: true };
    }
    const pack = opts.pack === "aligned" ? "aligned" : "packed";
    let slots;
    if (opts.channels) {
      slots = slotsFromChannels(opts.channels, combine);
    } else if (pack === "aligned") {
      const n = Math.min(Math.max(1, bytesPerSample | 0), 3);
      slots = CHANNEL_NAMES.slice(0, n).map((c) => ({
        ch: CH[c],
        combine
      }));
    } else {
      slots = CHANNEL_NAMES.map((c) => ({ ch: CH[c], combine }));
    }
    if (!slots.length) slots = [{ ch: 0, combine }];
    const bpp = slots.length;
    const pad = pack === "aligned" ? (bpp - tableSize % bpp) % bpp : 0;
    return { slots, pad, pack, bytesPerPixel: bpp };
  }

  // src/jobSchema.js
  var SCHEMA_VERSION = "2026.07.31";
  var DEFAULTS = {
    // file refs — batch-only; the editor ignores these on import (it uses
    // dropped files) and may stub/omit them on export.
    image: null,
    audio: null,
    out: null,
    // trim (milliseconds)
    start: 0,
    end: null,
    // audio
    sr: 22050,
    ch: 1,
    bits: 16,
    dir: "fwd",
    // fwd | rev
    mode: "relabel",
    // relabel | resample
    // peak normalization: null/false/"off" = off (default). true = on at the
    // default target (-1 dBFS). a number = on, that dBFS target (<= 0).
    normalize: null,
    layout: "planar",
    // planar | interleaved | block
    blockSize: 64,
    // effects
    combine: "xor",
    traversal: "raster",
    keymap: "adjacent",
    border: 0,
    aspect: null,
    // "original" | "16:9" | [W,H] | number | null
    seed: null,
    // fisher-yates
    angleA: 1,
    // angle traversal
    angleB: 1,
    kx: 0,
    // offset keymap
    ky: 0,
    // channel plan
    pack: "packed",
    // packed | aligned
    channels: null,
    // null = default (all 3, r→g→b, shared combine);
    //                 else array of { ch, combine } | letter string | token
    // entries — ordered array of { path, mimetype?, name?, ...audioParams } |
    //           { text, name? } objects. Audio entries are optional; a job with
    //           only file/text entries encodes a data-only cartridge.
    entries: []
  };
  var ENUMS = {
    combine: COMBINE_NAMES,
    keymap: KEYMAP_NAMES,
    traversal: TRAVERSAL_NAMES,
    pack: PACK_NAMES,
    channel: CHANNEL_NAMES,
    dir: ["fwd", "rev"],
    mode: ["relabel", "resample"],
    layout: ["planar", "interleaved", "block"],
    bits: [8, 16, 24],
    mosaic: ["cols", "rows", "2x2", "3x3", "4x4"]
  };
  var MIME_BY_EXT = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    flac: "audio/flac",
    aac: "audio/aac",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    txt: "text/plain",
    md: "text/markdown",
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "text/javascript",
    json: "application/json",
    xml: "application/xml",
    pdf: "application/pdf"
  };
  function mimeFromPath(filePath) {
    const ext = String(filePath || "").split(".").pop().toLowerCase();
    return MIME_BY_EXT[ext] || "application/octet-stream";
  }
  var NORMALIZE_DEFAULT_DB2 = -1;
  function resolveNormalize2(spec) {
    if (spec == null || spec === false) return null;
    if (spec === true) return NORMALIZE_DEFAULT_DB2;
    if (typeof spec === "string") {
      const s = spec.trim().toLowerCase();
      if (s === "" || s === "off" || s === "none" || s === "false") return null;
      if (s === "on" || s === "yes" || s === "true") return NORMALIZE_DEFAULT_DB2;
      const n = parseFloat(s);
      return Number.isFinite(n) ? Math.min(0, n) : NORMALIZE_DEFAULT_DB2;
    }
    if (typeof spec === "number")
      return Number.isFinite(spec) ? Math.min(0, spec) : null;
    return null;
  }
  function resolveAspect(aspect) {
    if (!aspect || aspect === "original") return null;
    if (typeof aspect === "string" && aspect.includes(":")) {
      const [aw, ah] = aspect.split(":").map(Number);
      return aw && ah ? aw / ah : null;
    }
    if (Array.isArray(aspect) && aspect.length === 2)
      return aspect[0] / aspect[1];
    if (typeof aspect === "number") return aspect;
    return null;
  }
  function withDefaults(job = {}) {
    const j = { ...DEFAULTS, ...job };
    if (job["angle-a"] != null) j.angleA = job["angle-a"];
    if (job["angle-b"] != null) j.angleB = job["angle-b"];
    return j;
  }
  function resolveConfig(job = {}) {
    const j = withDefaults(job);
    const sr = parseInt(j.sr) || 22050;
    const ch = parseInt(j.ch) || 1;
    const bits = parseInt(j.bits) || 16;
    const bytesPerSample = bits >> 3;
    const borderRaw = Number(j.border) || 0;
    const borderFraction = borderRaw > 0 && borderRaw < 1 ? borderRaw : 0;
    const borderWidth = borderFraction ? 1 : 1 + Math.max(0, Math.floor(borderRaw));
    const normalizeDb = resolveNormalize2(j.normalize);
    const layout = ch > 1 ? j.layout || "planar" : "planar";
    const blockSize = layout === "block" ? Math.max(1, parseInt(j.blockSize) || 64) : 0;
    const params = {};
    if (j.traversal === "fisher-yates") {
      if (j.seed != null) params.seed = j.seed >>> 0;
    } else if (j.traversal === "angle") {
      params.a = j.angleA;
      params.b = j.angleB;
    }
    if (j.keymap === "offset") {
      params.kx = j.kx | 0;
      params.ky = j.ky | 0;
    }
    const keymap = j.keymap || "adjacent";
    const encodeOpts = {
      combine: j.combine || "xor",
      traversal: j.traversal || "raster",
      keymap,
      keyMap: keymap,
      borderWidth,
      borderFraction,
      params,
      pack: j.pack === "aligned" ? "aligned" : j.pack === "mono" ? "mono" : "packed",
      channels: j.channels || null,
      bytesPerSample
    };
    return {
      files: { image: j.image, audio: j.audio, out: j.out },
      trim: { start: j.start | 0, end: j.end == null ? null : j.end | 0 },
      audio: {
        sr,
        ch,
        bits,
        dir: j.dir === "rev" ? "rev" : "fwd",
        mode: j.mode === "resample" ? "resample" : "relabel",
        normalizeDb,
        layout,
        blockSize,
        bytesPerSample
      },
      aspectOverride: resolveAspect(j.aspect),
      // `entries` is canonical; fall back to `texts` for old jobs files.
      entries: Array.isArray(j.entries) ? j.entries : Array.isArray(j.texts) ? j.texts : [],
      encodeOpts
    };
  }
  function validateConfig(job = {}) {
    const warn = [];
    const inEnum = (k, list) => {
      if (job[k] != null && !list.includes(job[k]))
        warn.push(`${k}="${job[k]}" is not one of: ${list.join(", ")}`);
    };
    inEnum("combine", ENUMS.combine);
    inEnum("keymap", ENUMS.keymap);
    inEnum("traversal", ENUMS.traversal);
    inEnum("pack", ENUMS.pack);
    inEnum("dir", ENUMS.dir);
    inEnum("mode", ENUMS.mode);
    inEnum("layout", ENUMS.layout);
    if (job.bits != null && !ENUMS.bits.includes(parseInt(job.bits)))
      warn.push(`bits=${job.bits} is not one of: ${ENUMS.bits.join(", ")}`);
    const ch = job.channels;
    const combos = [];
    if (Array.isArray(ch)) {
      for (const s of ch)
        if (s && typeof s === "object" && s.combine) combos.push(s.combine);
    }
    if (typeof ch === "string" && ch.includes("."))
      for (const t of ch.split("+")) {
        const c = t.split(".")[1];
        if (c) combos.push(c);
      }
    for (const c of combos)
      if (!ENUMS.combine.includes(c))
        warn.push(`channel combine "${c}" is not one of: ${ENUMS.combine.join(", ")}`);
    const f = job.frames;
    if (f && !Array.isArray(f)) {
      if (f.layout != null && !ENUMS.mosaic.includes(f.layout))
        warn.push(
          `frames.layout="${f.layout}" is not one of: ${ENUMS.mosaic.join(", ")}`
        );
      if (!Array.isArray(f.at) || !f.at.length)
        warn.push("frames needs an `at` array of timestamps (ms)");
    }
    return warn;
  }
  function outBase(out) {
    return String(out).replace(/\.(png|mp4|webm|mov|mkv)$/i, "");
  }
  function framesSpec(job) {
    const f = job && job.frames;
    if (!f) return null;
    const at = Array.isArray(f) ? f : Array.isArray(f.at) ? f.at : null;
    if (!at || !at.length) return null;
    const layout = !Array.isArray(f) && f.layout || "cols";
    return {
      at: at.map(Number).filter((n) => Number.isFinite(n) && n >= 0),
      layout: ENUMS.mosaic.includes(layout) ? layout : "cols"
    };
  }
  function mosaicGrid(count, layout) {
    const n = Math.max(1, count | 0);
    if (layout === "rows") return { cols: 1, rows: n };
    if (layout && /^(\d)x\1$/.test(layout)) {
      const k = parseInt(layout[0], 10);
      return { cols: k, rows: k };
    }
    return { cols: n, rows: 1 };
  }
  function isAudioEntry2(entry) {
    if (!entry || entry.path == null) return false;
    const mime = entry.mimetype || mimeFromPath(entry.path);
    if (mime.startsWith("audio/")) return true;
    return mime.startsWith("video/") && SPLIT_AUDIO_KEYS.some((k) => k !== "mimetype" && entry[k] != null);
  }
  function jobMode(job = {}) {
    if (splitSpec(job)) return "series";
    if (framesSpec(job)) return "video";
    const entries = Array.isArray(job.entries) ? job.entries : [];
    if (entries.some(isAudioEntry2)) return "clip";
    if (job.image && mimeFromPath(job.image).startsWith("video/")) return "video";
    return "data";
  }
  var SPLIT_AUDIO_KEYS = [
    "sr",
    "ch",
    "bits",
    "dir",
    "mode",
    "normalize",
    "layout",
    "blockSize",
    "mimetype"
  ];
  var PART_STRUCTURAL = ["start", "end", "image", "out", "name", "entries"];
  function splitSpec(job) {
    const s = job && job.split;
    return s && typeof s === "object" ? s : null;
  }
  function splitAudioPath(job) {
    const s = splitSpec(job);
    return s ? s.path || null : null;
  }
  function splitBytesPerSecond(spec, srcSr) {
    const sr = parseInt(spec.sr) || DEFAULTS.sr;
    const ch = parseInt(spec.ch) || DEFAULTS.ch;
    const bits = parseInt(spec.bits) || DEFAULTS.bits;
    const mode = spec.mode || DEFAULTS.mode;
    const eff = mode === "resample" ? sr : srcSr || sr;
    return Math.max(1, eff * ch * (bits >> 3));
  }
  function jobBytesPerPixel(job, spec) {
    const bits = parseInt((spec && spec.bits) ?? job.bits) || DEFAULTS.bits;
    const { encodeOpts } = resolveConfig({ ...job, bits });
    return normalizeChannelPlan(
      encodeOpts,
      encodeOpts.bytesPerSample,
      0
    ).bytesPerPixel;
  }
  function splitByteBudget(spec, ctx) {
    if (spec.maxBytes != null) return Math.max(1, Number(spec.maxBytes) || 0);
    if (spec.maxPixels != null) {
      const bpp = ctx.bytesPerPixel || 3;
      const reserve = Math.max(0, Number(spec.reserveBytes) || 0);
      const px = Math.max(2, Number(spec.maxPixels) || 0);
      return Math.max(1, Math.floor(px / 2 * bpp) - reserve);
    }
    return null;
  }
  function planChunks(spec, ctx = {}) {
    const parts = Array.isArray(spec.parts) ? spec.parts : null;
    const gap = Math.max(0, Number(spec.gap) || 0);
    if (parts && parts.length && parts.every((p) => p && p.start != null && p.end != null))
      return parts.map((p) => ({ start: Number(p.start), end: Number(p.end) }));
    const winS = Math.max(0, Number(spec.start) || 0);
    const winE = spec.end != null ? Number(spec.end) : ctx.durationMs ?? null;
    if (winE == null || !(winE > winS))
      throw new Error(
        "split: need `end` (or a readable source duration) to divide into chunks"
      );
    let count = null;
    if (parts && parts.length) count = parts.length;
    else if (spec.count != null) count = Math.max(1, parseInt(spec.count) || 1);
    if (count == null) {
      let chunkMs;
      if (spec.chunk != null) chunkMs = Math.max(1, Number(spec.chunk) || 0);
      else {
        const budget = splitByteBudget(spec, ctx);
        if (budget == null)
          throw new Error(
            "split: needs one of `parts`, `count`, `chunk`, `maxBytes` or `maxPixels`"
          );
        chunkMs = Math.max(
          1,
          Math.floor(budget / splitBytesPerSecond(spec, ctx.srcSr) * 1e3)
        );
      }
      count = Math.max(1, Math.ceil((winE - winS) / chunkMs));
    }
    const span = (winE - winS) / count;
    const windows = [];
    for (let i = 0; i < count; i++) {
      const s = winS + i * span;
      const e = i === count - 1 ? winE : winS + (i + 1) * span - gap;
      windows.push({ start: Math.round(s), end: Math.round(Math.max(s, e)) });
    }
    if (parts)
      parts.forEach((p, i) => {
        if (!p || !windows[i]) return;
        if (p.start != null) windows[i].start = Number(p.start);
        if (p.end != null) windows[i].end = Number(p.end);
      });
    return windows;
  }
  function expandJob(job = {}, ctx = {}) {
    const spec = splitSpec(job);
    if (!spec) return [job];
    const c = { bytesPerPixel: jobBytesPerPixel(job, spec), ...ctx };
    const windows = planChunks(spec, c);
    const parts = Array.isArray(spec.parts) ? spec.parts : [];
    const images = Array.isArray(spec.images) ? spec.images : [];
    const pad = spec.pad != null ? Math.max(0, parseInt(spec.pad) || 0) : 2;
    const baseOut = spec.out != null ? spec.out : job.out;
    const sharedAudio = {};
    for (const k of SPLIT_AUDIO_KEYS)
      if (spec[k] != null) sharedAudio[k] = spec[k];
    const inherited = { ...job };
    delete inherited.split;
    delete inherited.entries;
    return windows.map((w, i) => {
      const part = parts[i] || {};
      const out = { ...inherited };
      const image = part.image ?? images[i] ?? spec.image ?? job.image;
      if (image != null) out.image = image;
      const o = part.out ?? (baseOut != null ? `${outBase(baseOut)}-${String(i + 1).padStart(pad, "0")}` : null);
      if (o != null) out.out = o;
      for (const k of Object.keys(part))
        if (!PART_STRUCTURAL.includes(k) && !SPLIT_AUDIO_KEYS.includes(k))
          out[k] = part[k];
      const audio = { path: spec.path, ...sharedAudio };
      for (const k of SPLIT_AUDIO_KEYS) if (part[k] != null) audio[k] = part[k];
      const nm = part.name ?? spec.name;
      if (nm != null) audio.name = String(nm);
      audio.start = w.start;
      audio.end = w.end;
      out.entries = [
        audio,
        ...Array.isArray(part.entries) ? part.entries : [],
        ...Array.isArray(spec.entries) ? spec.entries : [],
        ...Array.isArray(job.entries) ? job.entries : []
      ];
      return out;
    });
  }
  function resolveJobs(file) {
    if (file && !Array.isArray(file) && Array.isArray(file.jobs)) {
      const defaults = file.defaults || {};
      return file.jobs.map((job) => ({ ...defaults, ...job }));
    }
    return Array.isArray(file) ? file : [file];
  }
  function expandJobs(jobs, ctxFor) {
    const list = resolveJobs(jobs);
    const out = [];
    for (const job of list) {
      const spec = splitSpec(job);
      const ctx = spec && typeof ctxFor === "function" ? ctxFor(job, spec) || {} : {};
      for (const j of expandJob(job, ctx)) out.push(j);
    }
    return out;
  }
  return __toCommonJS(jobSchema_exports);
})();
//# sourceMappingURL=jobSchema.global.js.map