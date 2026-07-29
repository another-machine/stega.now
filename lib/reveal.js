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

    // on top: the encoded image, erased pixel by pixel.
    // Erasing means writing alpha 0 into an ImageData we hold and uploading
    // it once per frame — a clearRect per pixel made a deep seek cost
    // hundreds of milliseconds, since the work scales with how much of the
    // image the jump reveals.
    const over = cnv(W, H);
    const oc = over.getContext("2d");
    const overData = new ImageData(new Uint8ClampedArray(img.data), W, H);
    const px = overData.data;

    const km = StegCore.KEYMAP[opts.keyMap] || StegCore.KEYMAP.adjacent;
    const params = opts.params || {};
    // bounding box of the pixels touched since the last upload, so a frame
    // only re-uploads the region that actually changed
    let dx0 = 0,
      dy0 = 0,
      dx1 = -1,
      dy1 = -1;
    function touch(x, y) {
      if (dx1 < dx0) {
        dx0 = dx1 = x;
        dy0 = dy1 = y;
        return;
      }
      if (x < dx0) dx0 = x;
      else if (x > dx1) dx1 = x;
      if (y < dy0) dy0 = y;
      else if (y > dy1) dy1 = y;
    }
    // clearing a data pixel also clears its paired key pixel, so the whole
    // frame is covered rather than a checkerboard of it
    function clearAt(pi) {
      const v = pathIdx[pi];
      const lx = v % IW,
        ly = (v / IW) | 0;
      const x = lx + B,
        y = ly + B;
      px[(y * W + x) * 4 + 3] = 0;
      touch(x, y);
      const [klx, kly] = km(lx, ly, IW, IH, params);
      const kx = klx + B,
        ky = kly + B;
      px[(ky * W + kx) * 4 + 3] = 0;
      touch(kx, ky);
    }
    function flush() {
      if (dx1 < dx0) return;
      oc.putImageData(overData, 0, 0, dx0, dy0, dx1 - dx0 + 1, dy1 - dy0 + 1);
      dx1 = -1;
      dy1 = -1;
      dx0 = 0;
      dy0 = 0;
    }

    // the pixels this entry's payload occupies; the entry table and any
    // pixels past the payload aren't part of the timed sweep
    let startPx = 0,
      endPx = pathIdx.length;
    let order = null;
    if (entry) {
      // byteLength lets a caller point at a payload it has already measured,
      // without holding the bytes themselves
      const len = entry.byteLength != null ? entry.byteLength : entry.data.length;
      startPx = Math.floor(entry.dataOffset / bpp);
      endPx = Math.min(pathIdx.length, Math.ceil((entry.dataOffset + len) / bpp));
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
      px.set(img.data); // back to fully encoded
      for (let i = 0; i < startPx; i++) clearAt(i);
      for (let i = endPx; i < pathIdx.length; i++) clearAt(i);
      oc.putImageData(overData, 0, 0);
      dx1 = -1;
      dy1 = -1;
      dx0 = 0;
      dy0 = 0;
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
      flush();
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
