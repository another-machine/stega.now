"use strict";
/* ============================================================
   reveal.js — the decode, animated.

   Encoding hid a payload in a cover's pixels, so reading it back
   develops the cover again: the encoded image sits on top of the
   reconstruction and every pixel that has been read is cleared away,
   resolving the picture in the cartridge's own traversal order.

   Reveal.build(img, opts, entry) → { el, reset, seek, timer }
     img   StegCore.Img of the encoded cartridge
     opts  the decode opts from StegCore.decodeContainer
     entry the entry whose payload drives the sweep, or null for the
           whole interior
     el    a <div class="rev"> holding both canvases
     seek(p) reveals up to fraction p (monotonic — reset() to start over)

   Reveal.animate(rev, ms, onDone) runs a reveal on the clock instead of
   a playhead.
   ============================================================ */

const Reveal = (() => {
  const cnv = (w, h) =>
    Object.assign(document.createElement("canvas"), { width: w, height: h });

  function build(img, opts, entry) {
    const W = img.width,
      H = img.height,
      B = opts.borderWidth || 1;
    const IW = W - 2 * B,
      IH = H - 2 * B;
    const pathIdx = StegCore.getPathIndices(
      IW,
      IH,
      opts.traversal,
      opts.params || {},
    );
    const bpp = opts.plan
      ? opts.plan.bytesPerPixel || opts.plan.slots.length
      : 3;

    // underneath: the reconstructed cover, scaled up if it came back at
    // half resolution (key-preserving combines)
    const rec = StegCore.computeRecon(img, pathIdx, opts);
    const small = cnv(rec.width, rec.height);
    small
      .getContext("2d")
      .putImageData(new ImageData(rec.data, rec.width, rec.height), 0, 0);
    const base = cnv(W, H);
    base.getContext("2d").drawImage(small, 0, 0, W, H);

    // on top: the encoded image, erased pixel by pixel
    const enc = cnv(W, H);
    enc
      .getContext("2d")
      .putImageData(
        new ImageData(new Uint8ClampedArray(img.data), W, H),
        0,
        0,
      );
    const over = cnv(W, H);
    const oc = over.getContext("2d");

    const km = StegCore.KEYMAP[opts.keyMap] || StegCore.KEYMAP.adjacent;
    const params = opts.params || {};
    // clearing a data pixel also clears its paired key pixel, so the whole
    // frame is covered rather than a checkerboard of it
    function clearAt(pi) {
      const v = pathIdx[pi];
      const lx = v % IW,
        ly = (v / IW) | 0;
      oc.clearRect(lx + B, ly + B, 1, 1);
      const [klx, kly] = km(lx, ly, IW, IH, params);
      oc.clearRect(klx + B, kly + B, 1, 1);
    }

    // the pixels this entry's payload occupies; the entry table and any
    // pixels past the payload aren't part of the timed sweep
    let startPx = 0,
      endPx = pathIdx.length;
    let order = null;
    if (entry) {
      startPx = Math.floor(entry.dataOffset / bpp);
      endPx = Math.min(
        pathIdx.length,
        Math.ceil((entry.dataOffset + entry.data.length) / bpp),
      );
      if (/^audio\/l/i.test(entry.mimetype || "")) {
        const f = StegCore.parseAudioMime(entry.mimetype);
        // raw PCM frames don't map to pixels in order under planar or
        // interleaved layouts — this is the order they light up in
        order = StegCore.computeRevealOrder({
          pathLen: Math.max(1, endPx - startPx),
          channels: f.channels,
          bits: f.bits,
          layout: f.layout,
          blockSize: f.blockSize,
          bytesPerPixel: bpp,
        });
      }
    }
    const span = Math.max(1, endPx - startPx);

    let filled = -1;
    function reset() {
      oc.clearRect(0, 0, W, H);
      oc.drawImage(enc, 0, 0);
      for (let i = 0; i < startPx; i++) clearAt(i);
      for (let i = endPx; i < pathIdx.length; i++) clearAt(i);
      filled = 0;
    }
    function seek(p) {
      const upto = Math.min(
        span - 1,
        Math.floor(Math.max(0, Math.min(1, p)) * span),
      );
      if (upto + 1 <= filled) return;
      for (let i = Math.max(0, filled); i <= upto; i++)
        clearAt(startPx + (order ? order[i] : i));
      filled = upto + 1;
    }

    const el = document.createElement("div");
    el.className = "rev";
    el.append(base, over);
    reset();
    return { el, reset, seek, timer: null };
  }

  // Interval rather than requestAnimationFrame: a backgrounded tab stops
  // serving frames, which would leave the image half developed, whereas
  // progress measured against the clock still finishes.
  function animate(rev, ms, onDone) {
    if (rev.timer) clearInterval(rev.timer);
    rev.reset();
    const t0 = performance.now();
    rev.timer = setInterval(() => {
      const p = (performance.now() - t0) / ms;
      rev.seek(p);
      if (p >= 1) {
        clearInterval(rev.timer);
        rev.timer = null;
        if (onDone) onDone();
      }
    }, 33);
  }

  return { build, animate };
})();
