/* ============================================================
   The loop editor's authoring helpers: decode audio, cut and
   normalize PCM, and encode takes into one mix stegassette.

   One carrier, one output. A single take becomes a single loop
   file with the readable filename; several takes become a pack —
   `audio, loop.json` repeated, in take order. The codec grows
   the carrier to fit the payload, so nothing here counts pixels.

   Every loop.json gets a `source` block naming the audio file,
   the picture, the start frame and the normalize target — the
   image carries its own recipe, and stegassette-jobs can rebuild
   it from the same sources without this editor.

   Expects the vendored global `Stegassette` to be loaded as a
   classic script before this module.
   ============================================================ */

import {
  buildLoop,
  loopEntry,
  loopFileName,
  packFileName,
  slug,
} from "./format.js";

// One choice each, made once. The old editor offered rate, bits,
// channels, layout and normalize per encode; every real loop used the
// defaults, and the picture growing to fit removed the reason to trim.
const RATE = 44100;
const BITS = 16;
const LAYOUT = "planar";
const NORMALIZE_DB = -1;
const NORMALIZE_TARGET = Math.pow(10, NORMALIZE_DB / 20);

// ---- images ------------------------------------------------
// Same pair as me/: a Blob in, an Img for the codec, a PNG Blob
// back out. putImageData writes bytes verbatim rather than
// premultiplying, which matters because the STGC header lives in the
// border alpha.

async function imgFromBlob(blob) {
  let bmp;
  try {
    bmp = await createImageBitmap(blob, { colorSpaceConversion: "none" });
  } catch (_) {
    bmp = await createImageBitmap(blob);
  }
  const W = bmp.width;
  const H = bmp.height;
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
    new Uint8Array(ctx.getImageData(0, 0, W, H).data)
  );
}

function imgToPngBlob(img) {
  const cnv = Object.assign(document.createElement("canvas"), {
    width: img.width,
    height: img.height,
  });
  cnv
    .getContext("2d")
    .putImageData(
      new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
      0,
      0
    );
  return new Promise((res, rej) =>
    cnv.toBlob(
      (b) => (b ? res(b) : rej(new Error("PNG encode failed"))),
      "image/png"
    )
  );
}

// ---- audio -------------------------------------------------
// One context per sample rate: decodeAudioData resamples to the
// context's rate, which is how the fixed rate gets applied.

const ctxCache = new Map();
function audioCtxAt(rate) {
  if (!ctxCache.has(rate))
    ctxCache.set(rate, new OfflineAudioContext(2, 1, rate));
  return ctxCache.get(rate);
}

async function decodeAudioFile(file, rate = RATE) {
  const buf = await audioCtxAt(rate).decodeAudioData(await file.arrayBuffer());
  const channels = [];
  for (let c = 0; c < buf.numberOfChannels; c++)
    channels.push(new Float32Array(buf.getChannelData(c)));
  return { channels, sampleRate: buf.sampleRate, frames: buf.length };
}

/** Take `wantChannels` out of a planar set, downmixing when asked for one. */
function fitChannels(channels, wantChannels) {
  if (wantChannels === 1 && channels.length > 1) {
    const n = channels[0].length;
    const mix = new Float32Array(n);
    for (const d of channels)
      for (let i = 0; i < n; i++) mix[i] += d[i] / channels.length;
    return [mix];
  }
  const out = [];
  for (let c = 0; c < wantChannels; c++)
    out.push(channels[Math.min(c, channels.length - 1)]);
  return out;
}

function sliceChannels(channels, start, end) {
  return channels.map((d) => d.slice(start, end));
}

function peakOf(channels) {
  let p = 0;
  for (const d of channels)
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]);
      if (v > p) p = v;
    }
  return p;
}

/** Scale in place so the loudest sample lands on `target`. */
function normalizeTo(channels, target) {
  const p = peakOf(channels);
  if (!p) return channels;
  const g = target / p;
  for (const d of channels) for (let i = 0; i < d.length; i++) d[i] *= g;
  return channels;
}

/** Stereo for stereo sources, mono for mono — never padded up. */
const channelsFor = (channels) => Math.min(2, channels.length);

// ---- encode ------------------------------------------------

/**
 * Encode takes into one mix stegassette on one carrier.
 *
 * Each take is `{ channels, sampleRate, start, end, origin, beats,
 * meter, title, artist, root, mode, sourceName }` — `origin` relative
 * to `start`, everything in frames at `sampleRate`. Entries land in
 * take order, audio first in every pair, so the first take is the
 * loop a mixer's "first loop sets the mix" rule lands on.
 */
async function encodePack({ takes, carrierFile, packTitle = "" }) {
  if (!takes.length) throw new Error("nothing to encode");
  if (!carrierFile) throw new Error("no picture");
  const carrier = await imgFromBlob(carrierFile);
  const entries = [];
  const loops = [];
  for (const t of takes) {
    const cut = sliceChannels(
      fitChannels(t.channels, channelsFor(t.channels)),
      t.start,
      t.end
    );
    normalizeTo(cut, NORMALIZE_TARGET);
    const loop = buildLoop({
      frames: t.end - t.start,
      sampleRate: t.sampleRate,
      beats: t.beats,
      meter: t.meter,
      origin: t.origin,
      title: t.title,
      artist: t.artist,
      root: t.root,
      mode: t.mode,
      source: {
        audio: t.sourceName,
        image: carrierFile.name,
        start: t.start,
        normalize: NORMALIZE_DB,
      },
    });
    entries.push(
      Stegassette.buildAudioEntry({
        channels: cut,
        sampleRate: t.sampleRate,
        bitsPerSample: BITS,
        layout: LAYOUT,
        name: (slug(loop.title) || "loop") + ".pcm",
      }),
      loopEntry(loop)
    );
    loops.push(loop);
  }
  const out = Stegassette.encodeStegassette(
    entries,
    carrier,
    Stegassette.COLLECTION_STEG
  );
  const name =
    loops.length === 1 ? loopFileName(loops[0]) : packFileName(packTitle);
  return {
    loops,
    name,
    blob: await imgToPngBlob(out),
    width: out.width,
    height: out.height,
  };
}

export {
  RATE,
  BITS,
  NORMALIZE_DB,
  imgFromBlob,
  imgToPngBlob,
  decodeAudioFile,
  fitChannels,
  sliceChannels,
  peakOf,
  normalizeTo,
  channelsFor,
  encodePack,
};
