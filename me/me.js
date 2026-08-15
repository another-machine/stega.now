"use strict";
/* ============================================================
   me.js — the stega-me format.

   One stegassette, one person: a picture of you with your own voice
   hidden inside it.

     me-<who>-<date>.png   a raw PCM entry (the sound) followed by
                           me.json (who it is from, the layout the
                           picture was built with, the audio format,
                           and the pattern used to hide it)

   The audio entry comes FIRST on purpose: a player with no idea what
   stega-me is opens a stegassette on its first entry, so it lands on the
   sound and develops the picture while the voice plays.

   Two halves, and they compose freely:

     the picture   frames grabbed out of a video you record (or hand
                   it), or images you supply — laid out in a template
                   at whatever aspect ratio you pick
     the sound     the audio recorded alongside that video, or a
                   message recorded into a picture on its own

   The stegassette is rendered at the size the audio needs, instead of
   scaling a small composite up to fit: the frames are drawn straight
   at the final resolution, so the picture is as sharp as the camera
   allowed and every data pixel carries a real sample.
   ============================================================ */

const Me = (() => {
  const FORMAT = "stega-me/1";
  const INFO_ENTRY = "me.json";

  // The payload is real audio (never ciphertext), so a combine that tracks
  // amplitude is the interesting default: under `signed` silence leaves a
  // pixel exactly where it was and only loudness displaces it, so the
  // picture wears the waveform. boustrophedon fills in scanlines, which is
  // also the order it develops in as the voice plays back.
  const STEG = {
    combine: "signed",
    traversal: "boustrophedon",
    keymap: "adjacent",
    border: 0.02,
    pack: "packed",
  };
  const METHODS = {
    combine: Stegassette.COMBINE_NAMES,
    traversal: Stegassette.TRAVERSAL_NAMES,
    keymap: Stegassette.KEYMAP_NAMES,
    pack: Stegassette.PACK_NAMES,
  };

  // 8 or 16 bit. A voice at 8 bit is grainy and half the pixels — which is
  // the point of offering it: the same take, a very different picture.
  const BITS = [8, 16];
  const RATES = [8000, 11025, 16000, 22050, 44100];

  // Frame rects are fractions of the canvas, so a template holds its shape
  // at any aspect ratio and any size.
  const TEMPLATES = [
    { id: "single", label: "one frame", frames: [[0, 0, 1, 1]] },
    {
      id: "pair-across",
      label: "two across",
      frames: [
        [0, 0, 0.5, 1],
        [0.5, 0, 0.5, 1],
      ],
    },
    {
      id: "pair-down",
      label: "two down",
      frames: [
        [0, 0, 1, 0.5],
        [0, 0.5, 1, 0.5],
      ],
    },
    // The photobooth strips. `aspect` is a suggestion, not a constraint — the
    // frames are still fractions and hold their shape at any shape of picture.
    // But a strip stacked into a square is three letterbox slices rather than a
    // strip, so picking one moves the aspect with it and the frames come out
    // roughly square. Change the aspect afterwards and it stays changed.
    {
      id: "strip3",
      label: "vertical strip of three",
      aspect: "1:3",
      frames: [
        [0, 0, 1, 1 / 3],
        [0, 1 / 3, 1, 1 / 3],
        [0, 2 / 3, 1, 1 / 3],
      ],
    },
    {
      id: "strip4",
      label: "vertical strip of four",
      aspect: "1:4",
      frames: [
        [0, 0, 1, 0.25],
        [0, 0.25, 1, 0.25],
        [0, 0.5, 1, 0.25],
        [0, 0.75, 1, 0.25],
      ],
    },
    {
      id: "row4",
      label: "four across",
      frames: [
        [0, 0, 0.25, 1],
        [0.25, 0, 0.25, 1],
        [0.5, 0, 0.25, 1],
        [0.75, 0, 0.25, 1],
      ],
    },
    {
      id: "quad",
      label: "two by two",
      frames: [
        [0, 0, 0.5, 0.5],
        [0.5, 0, 0.5, 0.5],
        [0, 0.5, 0.5, 0.5],
        [0.5, 0.5, 0.5, 0.5],
      ],
    },
    {
      id: "six",
      label: "three by two",
      frames: [
        [0, 0, 1 / 3, 0.5],
        [1 / 3, 0, 1 / 3, 0.5],
        [2 / 3, 0, 1 / 3, 0.5],
        [0, 0.5, 1 / 3, 0.5],
        [1 / 3, 0.5, 1 / 3, 0.5],
        [2 / 3, 0.5, 1 / 3, 0.5],
      ],
    },
    {
      id: "nine",
      label: "three by three",
      frames: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => [
        (i % 3) / 3,
        ((i / 3) | 0) / 3,
        1 / 3,
        1 / 3,
      ]),
    },
    {
      id: "hero",
      label: "one big, three under",
      frames: [
        [0, 0, 1, 0.72],
        [0, 0.72, 1 / 3, 0.28],
        [1 / 3, 0.72, 1 / 3, 0.28],
        [2 / 3, 0.72, 1 / 3, 0.28],
      ],
    },
    {
      id: "sidebar",
      label: "one big, two beside",
      frames: [
        [0, 0, 0.66, 1],
        [0.66, 0, 0.34, 0.5],
        [0.66, 0.5, 0.34, 0.5],
      ],
    },
  ];
  // square, then progressively taller, then landscape. The tall end runs past
  // what a camera gives you because a stacked strip needs it: four square
  // frames down a picture is 1:4 and nothing shallower.
  const ASPECTS = [
    { id: "1:1", v: 1 },
    { id: "4:5", v: 4 / 5 },
    { id: "3:4", v: 3 / 4 },
    { id: "2:3", v: 2 / 3 },
    { id: "9:16", v: 9 / 16 },
    { id: "1:2", v: 1 / 2 },
    { id: "1:3", v: 1 / 3 },
    { id: "1:4", v: 1 / 4 },
    { id: "4:3", v: 4 / 3 },
    { id: "3:2", v: 3 / 2 },
    { id: "16:9", v: 16 / 9 },
  ];
  const templateById = (id) =>
    TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
  const aspectOf = (id) => (ASPECTS.find((a) => a.id === id) || ASPECTS[0]).v;

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const tick = () => new Promise((r) => setTimeout(r, 0));

  function slug(s) {
    return (
      String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "me"
    );
  }
  function fmtTime(sec) {
    sec = Math.max(0, sec || 0);
    const m = (sec / 60) | 0;
    return m + ":" + String(Math.floor(sec % 60)).padStart(2, "0");
  }
  const hex = (n) =>
    Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");

  // ---- images ------------------------------------------------
  // Same two helpers the album page keeps: putImageData writes bytes
  // verbatim (no premultiplication), which matters because the STGC header
  // lives in the border alpha.
  const cnvEl = (w, h) =>
    Object.assign(document.createElement("canvas"), { width: w, height: h });

  async function imgFromBlob(blob) {
    let bmp;
    try {
      bmp = await createImageBitmap(blob, { colorSpaceConversion: "none" });
    } catch (_) {
      bmp = await createImageBitmap(blob);
    }
    const cnv = cnvEl(bmp.width, bmp.height);
    const ctx = cnv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const W = bmp.width,
      H = bmp.height;
    bmp.close();
    return new Stegassette.Img(
      W,
      H,
      new Uint8Array(ctx.getImageData(0, 0, W, H).data),
    );
  }
  function imgToPngBlob(img) {
    const cnv = cnvEl(img.width, img.height);
    cnv
      .getContext("2d")
      .putImageData(
        new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
        0,
        0,
      );
    return new Promise((res, rej) =>
      cnv.toBlob(
        (b) => (b ? res(b) : rej(new Error("PNG encode failed"))),
        "image/png",
      ),
    );
  }

  // ---- the layout --------------------------------------------
  const srcW = (s) => s.width || s.videoWidth || 0;
  const srcH = (s) => s.height || s.videoHeight || 0;

  // Fill a rect with a source, centre-cropped rather than squashed — a
  // portrait frame in a landscape template keeps the face's proportions.
  function drawCover(ctx, src, x, y, w, h, mirror) {
    const sw0 = srcW(src),
      sh0 = srcH(src);
    if (!sw0 || !sh0) return;
    const want = w / h,
      have = sw0 / sh0;
    let sw = sw0,
      sh = sh0;
    if (have > want) sw = sh0 * want;
    else sh = sw0 / want;
    const sx = (sw0 - sw) / 2,
      sy = (sh0 - sh) / 2;
    ctx.save();
    if (mirror) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    } else {
      ctx.drawImage(src, sx, sy, sw, sh, x, y, w, h);
    }
    ctx.restore();
  }

  // frames[i] = { src, mirror } for template.frames[i]; empty slots are left
  // as matte. The gap is taken out of every frame's own edges, so neighbours
  // end up a full gap apart and the picture keeps half of it as a margin.
  function renderLayout(W, H, tpl, frames, { gap = 0, matte = "#000000" } = {}) {
    const cnv = cnvEl(W, H);
    const ctx = cnv.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = matte;
    ctx.fillRect(0, 0, W, H);
    const g = Math.max(0, Number(gap) || 0) * Math.min(W, H);
    tpl.frames.forEach((rect, i) => {
      const f = frames[i];
      if (!f || !f.src) return;
      const x = rect[0] * W + g / 2,
        y = rect[1] * H + g / 2,
        w = rect[2] * W - g,
        h = rect[3] * H - g;
      if (w <= 1 || h <= 1) return;
      drawCover(
        ctx,
        f.src,
        Math.round(x),
        Math.round(y),
        Math.round(w),
        Math.round(h),
        !!f.mirror,
      );
    });
    return cnv;
  }

  // ---- sizing ------------------------------------------------
  // How big the stegassette has to be to hold `bytes` at `bpp` bytes per data
  // pixel, at the requested aspect — which is the whole of it: the picture is
  // the size the sound needs, so the sound reaches the last pixel and the
  // picture develops end to end. There used to be a `minLong` floor here to
  // keep short messages off thumbnail size, and it is still honoured, but
  // nothing sets it: a floor above the natural size is exactly how a waveform
  // ends early, with the pixels past the payload never written and so already
  // developed before playback starts. Want a bigger picture, ask for more
  // sound — a higher sample rate or 16-bit buys pixels that carry samples.
  // `minWidth` is the one real floor: the width the STGC header itself
  // occupies, below which encoding refuses.
  function planCanvas({
    bytes,
    bpp = 3,
    aspect = 1,
    border = 0.02,
    minLong = 0,
    minWidth = 0,
  }) {
    const dataPx = Math.max(1, Math.ceil(bytes / bpp));
    let B = Stegassette.resolveBorderWidth(border, dataPx, aspect);
    const { IW, IH } = Stegassette.interiorDims(dataPx, aspect, B);
    let W = IW + 2 * B,
      H = IH + 2 * B;
    const grow = Math.max(
      minLong / Math.max(W, H),
      minWidth / W,
    );
    if (grow > 1) {
      W = Math.round(W * grow);
      H = Math.max(2, Math.round(W / aspect));
      // a fractional border is a share of the width, so it grows with it
      if (border > 0 && border < 1) B = Math.max(1, Math.round(border * W));
    }
    // rounding can leave the interior a few pixels short of the payload
    let guard = 0;
    while (
      Stegassette.dataPixelCount(W - 2 * B, H - 2 * B) * bpp < bytes &&
      guard++ < 4096
    ) {
      W++;
      H = Math.max(2, Math.round(W / aspect));
    }
    return { W, H, B };
  }

  // ---- the core's moving parts -------------------------------
  // The codec is @amplib/steganography itself (lib/stegassette.js), vendored
  // and pinned in package.json, so its exports are simply there to be called.
  // Note the spelling: `keymap`, lowercase m. The package throws on `keyMap`
  // rather than silently falling back to `adjacent`, so this file uses the
  // package's spelling throughout and there is nothing to translate.
  const headerFloor = Stegassette.stgcHeaderWidth;

  // The entry table's own size, which is what an aligned channel plan pads
  // against.
  const tableSize = Stegassette.entryTableSize;

  // What one stegassette is going to cost, before anything is recorded — the
  // estimate line and the real build both go through this.
  function plan({ seconds, rate, bits, channels, aspect, steg, minLong, noteBytes = 400 }) {
    const frames = Math.max(1, Math.round((seconds || 0) * rate));
    const pcmBytes = frames * channels * (bits >> 3);
    const fake = [
      { mimetype: "audio/L16; rate=00000; channels=0", name: "voice" },
      { mimetype: "application/json", name: INFO_ENTRY },
    ];
    const cplan = Stegassette.normalizeChannelPlan(
      { combine: steg.combine, pack: steg.pack },
      bits >> 3,
      tableSize(fake),
    );
    const bpp = cplan.bytesPerPixel;
    const bytes = tableSize(fake) + cplan.pad + pcmBytes + noteBytes;
    const dims = planCanvas({
      bytes,
      bpp,
      aspect,
      border: steg.border,
      minLong,
      minWidth: headerFloor({
        combine: steg.combine,
        keymap: steg.keymap,
        traversal: steg.traversal,
        plan: cplan,
      }),
    });
    // How much of the picture the sound actually reaches. Pixels past the
    // payload are never written, so they are already developed when playback
    // starts — a stegassette sized well past its sound only animates a strip of
    // itself. Worth knowing before it is made rather than after.
    const room = Stegassette.dataPixelCount(dims.W - 2 * dims.B, dims.H - 2 * dims.B);
    const fill = Math.min(1, Math.ceil(bytes / bpp) / Math.max(1, room));
    return { ...dims, bpp, bytes, pcmBytes, frames, fill, pack: cplan.pack };
  }

  // ---- audio -------------------------------------------------
  // One context per sample rate: decodeAudioData resamples to the context's
  // rate, which is how the target rate gets applied.
  const ctxCache = new Map();
  function audioCtxAt(rate) {
    if (!ctxCache.has(rate))
      ctxCache.set(rate, new OfflineAudioContext(2, 1, rate));
    return ctxCache.get(rate);
  }
  async function decodeAudioBlob(blob, rate, wantChannels) {
    const buf = await audioCtxAt(rate).decodeAudioData(await blob.arrayBuffer());
    const out = [];
    if (wantChannels === 1 && buf.numberOfChannels > 1) {
      const n = buf.length;
      const mix = new Float32Array(n);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < n; i++) mix[i] += d[i] / buf.numberOfChannels;
      }
      out.push(mix);
    } else {
      for (let c = 0; c < wantChannels; c++)
        out.push(
          new Float32Array(
            buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)),
          ),
        );
    }
    return { channels: out, frames: buf.length, rate: buf.sampleRate };
  }

  function peakOf(channels) {
    let peak = 0;
    for (const c of channels)
      for (let i = 0; i < c.length; i++) {
        const a = Math.abs(c[i]);
        if (a > peak) peak = a;
      }
    return peak;
  }

  // ---- camera / microphone -----------------------------------
  const VIDEO_MIMES = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  const AUDIO_MIMES = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  function pickMime(list) {
    if (typeof MediaRecorder === "undefined") return null;
    if (!MediaRecorder.isTypeSupported) return "";
    for (const m of list) if (MediaRecorder.isTypeSupported(m)) return m;
    return "";
  }

  const openCamera = ({ video = true } = {}) => {
    // getUserMedia only exists in a secure context, and "served from a file or
    // a LAN address" is the shape that failure takes — say so plainly
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      return Promise.reject(
        new Error(
          "the camera needs a secure context — open this over localhost or https",
        ),
      );
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: video
        ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } }
        : false,
    });
  };
  function closeStream(stream) {
    if (stream) for (const t of stream.getTracks()) t.stop();
  }

  // One live stream, two recorders. The video keeps the pictures; the sound
  // gets its own plain audio container, because reading samples back out of
  // a *video* container is not something every browser will do — and the
  // samples are the part this format can't do without.
  function record(stream, { video = true } = {}) {
    if (typeof MediaRecorder === "undefined")
      throw new Error("this browser can't record");
    const mk = (src, mime, fallbackType) => {
      const chunks = [];
      const rec = new MediaRecorder(src, mime ? { mimeType: mime } : undefined);
      rec.addEventListener("dataavailable", (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      });
      const ended = new Promise((res) =>
        rec.addEventListener("stop", () =>
          res(new Blob(chunks, { type: rec.mimeType || fallbackType })),
        ),
      );
      rec.start();
      return { rec, ended };
    };
    const audio = mk(
      new MediaStream(stream.getAudioTracks()),
      pickMime(AUDIO_MIMES),
      "audio/webm",
    );
    const vid =
      video && stream.getVideoTracks().length
        ? mk(stream, pickMime(VIDEO_MIMES), "video/webm")
        : null;
    const t0 = performance.now();
    return {
      async stop() {
        for (const r of [audio, vid]) if (r) r.rec.stop();
        return {
          ms: performance.now() - t0,
          audioBlob: await audio.ended,
          videoBlob: vid ? await vid.ended : null,
        };
      },
    };
  }

  // A live peak reading, so a recording that isn't reaching the microphone
  // looks wrong while it is happening rather than after.
  function meter(stream, onLevel) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return () => {};
    const ctx = new AC();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const timer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const a = Math.abs(buf[i]);
        if (a > peak) peak = a;
      }
      onLevel(peak);
    }, 100);
    return () => {
      clearInterval(timer);
      try {
        ctx.close();
      } catch (_) {}
    };
  }

  // MediaRecorder blobs often report duration Infinity until something has
  // seeked past the end, which also blocks seeking — so provoke it once. But
  // never on pain of hanging: a camera take that keeps its duration to itself
  // resolves NaN after a bound instead, and the caller falls back to the
  // recording's own clock. A promise that only the browser can resolve is a
  // promise that sometimes doesn't — and every one of these awaits sits on the
  // path that fills frames, where "it silently never returns" reads as the
  // page being broken, with nothing in the console to say why.
  function durationOf(v) {
    if (Number.isFinite(v.duration) && v.duration > 0)
      return Promise.resolve(v.duration);
    return new Promise((res) => {
      let done = false;
      const fin = (val) => {
        if (done) return;
        done = true;
        v.removeEventListener("timeupdate", on);
        res(val);
      };
      const on = () => {
        if (Number.isFinite(v.duration) && v.duration > 0) {
          v.currentTime = 0;
          fin(v.duration);
        }
      };
      v.addEventListener("timeupdate", on);
      setTimeout(() => fin(NaN), 3000);
      v.currentTime = 1e101;
    });
  }
  // Resolves on `seeked` — or on a timer, because a MediaRecorder take can
  // refuse a seek (a target past the media's real end, which is exactly where
  // a duration taken from the recording clock sends the last frame of a
  // spread) and then `seeked` never comes. The target is also clamped to the
  // seekable range when the browser will say what that is.
  function seekTo(v, t) {
    return new Promise((res) => {
      try {
        const s = v.seekable;
        if (s && s.length) t = Math.min(t, Math.max(0, s.end(s.length - 1) - 0.001));
      } catch (_) {}
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        v.removeEventListener("seeked", fin);
        res();
      };
      v.addEventListener("seeked", fin);
      setTimeout(fin, 800);
      v.currentTime = t;
    });
  }
  // A still, at the video's own resolution — kept as a canvas so it can be
  // drawn into any layout later without decoding anything again.
  function still(v) {
    const c = cnvEl(v.videoWidth, v.videoHeight);
    c.getContext("2d").drawImage(v, 0, 0);
    return c;
  }
  // `seeked` says the seek landed, not that the frame it landed on has been
  // handed over for drawing — draw straight away and you can copy the frame
  // that was already there, which is how a spread comes out as N copies of one
  // moment. requestVideoFrameCallback fires when the new frame is actually
  // presented, so it is registered BEFORE the seek (the presentation the seek
  // causes can otherwise land before anything is listening) and then given a
  // short window to arrive. Only ever a window: a hidden tab presents no frames
  // at all, so waiting on it outright would hang every grab.
  async function frameAt(v, t) {
    const rvfc = typeof v.requestVideoFrameCallback === "function";
    let shown = false;
    if (rvfc) v.requestVideoFrameCallback(() => (shown = true));
    await seekTo(v, t);
    if (rvfc && !document.hidden) {
      const t0 = performance.now();
      while (!shown && performance.now() - t0 < 300)
        await new Promise((r) => setTimeout(r, 16));
    }
    return still(v);
  }

  // ---- build -------------------------------------------------
  // audio.channels is float PCM already at audio.rate (decodeAudioBlob).
  async function build({
    kind = "video",
    note = {},
    layout = {},
    frames = [],
    audio,
    steg = {},
    normalize = { on: true, db: -1 },
    minLong = 0,
    onProgress = () => {},
  }) {
    const method = { ...STEG, ...steg };
    if (!audio || !audio.channels || !audio.channels.length)
      throw new Error("no sound yet");
    const tpl = templateById(layout.template);
    if (!frames.some((f) => f && f.src)) throw new Error("no picture yet");
    const bits = BITS.includes(+audio.bits) ? +audio.bits : 16;
    const chLayout = audio.layout || "planar";
    const aspect = aspectOf(layout.aspect);

    onProgress("laying out the sound", 0.1);
    const mixed = audio.channels.map((c) => new Float32Array(c));
    if (normalize.on)
      Stegassette.peakNormalize(mixed, {
        targetDb: Number.isFinite(normalize.db) ? Math.min(0, normalize.db) : -1,
      });
    const pcm = Stegassette.float32ToPcm(
      Stegassette.layoutChannels({ mixed, layout: chLayout }),
      bits,
    );
    const nFrames = mixed[0].length;

    const info = {
      format: FORMAT,
      id: hex(6),
      created: new Date().toISOString(),
      kind,
      from: note.from || "",
      to: note.to || "",
      note: note.note || "",
      picture: {
        template: tpl.id,
        aspect: layout.aspect || "1:1",
        gap: Number(layout.gap) || 0,
        matte: layout.matte || "#000000",
        frames: frames.map((f, i) => ({
          slot: i + 1,
          filled: !!(f && f.src),
          mirror: !!(f && f.mirror),
          ...(f && f.t != null ? { t: Math.round(f.t * 1000) / 1000 } : {}),
        })),
      },
      audio: {
        source: audio.source || (kind === "video" ? "video" : "message"),
        rate: audio.rate,
        bits,
        channels: mixed.length,
        layout: chLayout,
        frames: nFrames,
        durationMs: Math.round((nFrames / audio.rate) * 1000),
        normalize: normalize.on
          ? { db: Number.isFinite(normalize.db) ? Math.min(0, normalize.db) : -1 }
          : null,
      },
      steg: method,
    };

    // The sound goes first so any player opens the stegassette on it and
    // develops the picture while it plays.
    const entries = [
      {
        mimetype: Stegassette.buildAudioMime({
          bits,
          rate: audio.rate,
          channels: mixed.length,
          layout: chLayout,
        }),
        name: slug(note.from) === "me" ? "voice" : slug(note.from),
        data: pcm,
      },
      {
        mimetype: "application/json",
        name: INFO_ENTRY,
        data: enc.encode(JSON.stringify(info)),
      },
    ];

    const cplan = Stegassette.normalizeChannelPlan(
      { combine: method.combine, pack: method.pack },
      bits >> 3,
      tableSize(entries),
    );
    const total = Stegassette.containerInteriorBytes(entries) + cplan.pad;
    const { W, H, B } = planCanvas({
      bytes: total,
      bpp: cplan.bytesPerPixel,
      aspect,
      border: method.border,
      minLong,
      minWidth: headerFloor({
        combine: method.combine,
        keymap: method.keymap,
        traversal: method.traversal,
        plan: cplan,
      }),
    });

    onProgress(`drawing the picture at ${W}×${H}`, 0.3);
    await tick();
    const cnv = renderLayout(W, H, tpl, frames, {
      gap: layout.gap,
      matte: layout.matte,
    });
    const carrier = new Stegassette.Img(
      W,
      H,
      new Uint8Array(
        cnv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H)
          .data,
      ),
    );

    onProgress("hiding the sound in it", 0.55);
    await tick();
    // (entries, srcImg, opts, keyImg) — opts is the THIRD argument here, where
    // the old vendored core took the key image there. Self-keying, so the same
    // image is both.
    const out = Stegassette.encodeContainer(
      entries,
      carrier,
      {
        combine: method.combine,
        traversal: method.traversal,
        keymap: method.keymap,
        borderWidth: B,
        params: {},
        plan: cplan,
      },
      carrier,
    );

    onProgress("writing the stegassette", 0.85);
    await tick();
    const blob = await imgToPngBlob(out);
    onProgress("done", 1);
    return {
      blob,
      width: out.width,
      height: out.height,
      bytes: total,
      bpp: cplan.bytesPerPixel,
      info,
      name: `me-${slug(note.from || info.kind)}-${info.created.slice(0, 10)}.png`,
    };
  }

  // ---- read --------------------------------------------------
  // Anything this reads back is a plain STGC stegassette, so me.json missing
  // isn't fatal: the sound and the picture are still there.
  async function read(blob) {
    const img = await imgFromBlob(blob);
    const { entries, opts } = Stegassette.decodeContainer(img, img);
    const ie = entries.find((e) => e.name === INFO_ENTRY);
    const ae = entries.find((e) => /^audio\/l/i.test(e.mimetype || ""));
    let info = null;
    if (ie)
      try {
        info = JSON.parse(dec.decode(ie.data));
      } catch (_) {}
    return { img, opts, entries, info, audioEntry: ae || null };
  }

  // A PCM entry as channel data, ready for an AudioBuffer.
  function audioOf(entry) {
    const fmt = Stegassette.parseAudioMime(entry.mimetype);
    const planar = Stegassette.unlayoutChannels({
      f32: Stegassette.toFloat32(entry.data, fmt.bits),
      layout: fmt.layout,
      channels: fmt.channels,
      blockSize: fmt.blockSize,
    });
    const n = (planar.length / fmt.channels) | 0;
    const channels = [];
    for (let c = 0; c < fmt.channels; c++)
      channels.push(planar.subarray(c * n, (c + 1) * n));
    return { fmt, channels, frames: n, seconds: n / fmt.rate };
  }

  return {
    FORMAT,
    INFO_ENTRY,
    STEG,
    METHODS,
    BITS,
    RATES,
    TEMPLATES,
    ASPECTS,
    templateById,
    aspectOf,
    slug,
    fmtTime,
    imgFromBlob,
    imgToPngBlob,
    renderLayout,
    drawCover,
    planCanvas,
    plan,
    decodeAudioBlob,
    peakOf,
    openCamera,
    closeStream,
    record,
    meter,
    durationOf,
    seekTo,
    still,
    frameAt,
    build,
    read,
    audioOf,
  };
})();
