// The kiddo gallery. A room per year, as in geese/ — one work, one viewport,
// nothing else in it. Tapping the picture loads and plays it.
//
// A kiddo stegassette holds one audio entry, a frame sheet — every still of the
// clip tiled into one JPEG, with a `frames.json` beside it holding the grid —
// and three text entries (Metadata, Quote, Message) the page does not show yet.
// RevealPlayer decodes all of them and plays the audio; the sheet is ours to
// draw from. There is no callback per frame, so the clip runs off its own clock
// — `audioContext.currentTime - player.t0`, wrapped by `player.duration` —
// which is the same clock the reveal sweeps on. One playhead, two pictures.
//
// `Stegassette` is the global installed by ../lib/stegassette.js.

// How much of a frame's turn goes to dissolving into the next one. At 12fps a
// cut still lands hard, and the source is soft VHS: a dissolve over the tail of
// each turn carries the motion without smearing the whole frame. A share of the
// turn rather than a span, so it holds its look at any frame rate — half of a
// 12fps turn is ~42 ms. 0 cuts, 1 dissolves end to end and never holds a frame
// still.
const FADE = 0.5;

// ease the ramp: a linear dissolve reads as a lurch through its midpoint
const smoothstep = (x) => x * x * (3 - 2 * x);

let audioContext;
let current = null;
let building = false;

// The clip, as one bitmap and the grid that walks it. A sheet is one entry
// however long the clip is, where a still per frame costs an entry each — and
// the header counts entries in a single byte, so a long clip at a real frame
// rate cannot be carried that way at all. The grid names its own frame rate,
// so the clip plays at the speed it was cut at rather than at whatever speed
// its frame count over the audio's length works out to.
async function loadSheet(entries) {
  const sheet = entries.find(
    (e) => e.name === "frames" && e.mimetype.startsWith("image/"),
  );
  const grid = entries.find((e) => e.name === "frames.json");
  if (!sheet || !grid) return null;
  const { cols, cellWidth, cellHeight, count, fps } = JSON.parse(
    new TextDecoder().decode(grid.data),
  );
  return {
    bitmap: await createImageBitmap(new Blob([sheet.data], { type: sheet.mimetype })),
    cols,
    cellWidth,
    cellHeight,
    count,
    fps,
  };
}

// ── the clip ────────────────────────────────────────────────────────────────

// one cell of the sheet, drawn over the whole canvas — which build() sized to
// exactly one cell, so the two can never disagree
function drawCell(rec, i) {
  const { bitmap, cols, cellWidth: cw, cellHeight: ch } = rec.sheet;
  rec.ctx.drawImage(bitmap, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch, 0, 0, cw, ch);
}

// `mix` is how far into the dissolve this frame is, 0–1. Both cells cover the
// canvas, so the outgoing frame needs no clear underneath.
function paint(rec, i, mix) {
  if (!rec.sheet) return;
  drawCell(rec, i);
  if (mix > 0) {
    // the clip loops with the audio, so the last frame dissolves into the first
    rec.ctx.globalAlpha = mix;
    drawCell(rec, (i + 1) % rec.sheet.count);
    rec.ctx.globalAlpha = 1;
  }
}

function runFilm(rec) {
  const { player, sheet } = rec;
  const tick = () => {
    if (!player.playing) {
      rec.raf = null;
      return;
    }
    const raw = player.audioContext.currentTime - player.t0;
    const at = raw > 0 ? raw % player.duration : 0;
    // where the playhead sits in frames, not seconds: the whole part picks the
    // frame, the fraction is how far through its turn we are. The sheet carries
    // its own frame rate, so a sheet that runs short of the audio holds its last
    // frame rather than being stretched across it.
    const pos = at * sheet.fps;
    const i = Math.min(sheet.count - 1, Math.floor(pos));
    const into = pos - i;
    paint(
      rec,
      i,
      FADE > 0 ? smoothstep(Math.min(1, Math.max(0, (into - 1 + FADE) / FADE))) : 0,
    );
    rec.raf = requestAnimationFrame(tick);
  };
  rec.raf = requestAnimationFrame(tick);
}

function stopFilm(rec) {
  if (rec?.raf != null) {
    cancelAnimationFrame(rec.raf);
    rec.raf = null;
  }
}

// ── a room ──────────────────────────────────────────────────────────────────

async function build(rec) {
  // The full-resolution stegassette is display:none until it is wanted, and a
  // lazy image with no box never intersects the viewport — so it would sit at
  // complete:false forever and the decode would never start. Asking for it
  // eagerly is what sets it going; the other stegassettes stay deferred.
  if (!rec.media.complete) {
    rec.media.loading = "eager";
    await new Promise((resolve, reject) => {
      rec.media.addEventListener("load", resolve, { once: true });
      rec.media.addEventListener("error", reject, { once: true });
    });
  }
  rec.player = await Stegassette.createRevealPlayer({
    source: rec.media,
    audioContext,
    className: "rev",
  });
  rec.sheet = await loadSheet(rec.player.entries);
  if (!rec.sheet) throw new Error("no frame sheet in stegassette");

  // the clip's pane is sized by one edge; the cell's own ratio finds the
  // other, and that ratio comes out of the payload rather than a guess here
  rec.film.width = rec.sheet.cellWidth;
  rec.film.height = rec.sheet.cellHeight;
  rec.room.style.setProperty("--film-share", rec.film.width / rec.film.height);

  // the decode surface covers the button; the thumbnail stays to hold the frame
  rec.button.appendChild(rec.player.element);
  rec.thumb.classList.add("gal-ghost");
  rec.thumb.setAttribute("aria-hidden", "true");
  rec.room.toggleAttribute("data-ready", true);
}

function stopCurrent() {
  if (!current) return;
  stopFilm(current);
  current.player.stop();
  current.button.setAttribute("aria-pressed", "false");
  current = null;
}

async function select(rec) {
  audioContext = audioContext || new AudioContext();
  if (building) return;

  const wasPlaying = current === rec;
  stopCurrent();
  if (wasPlaying) return;

  rec.button.setAttribute("aria-pressed", "true");

  if (!rec.player) {
    building = true;
    // the thumbnail breathes in place while the payload decodes
    rec.button.toggleAttribute("data-loading", true);
    try {
      await build(rec);
    } catch (err) {
      console.error("stegassette decode failed", err);
      rec.button.setAttribute("aria-pressed", "false");
      return;
    } finally {
      building = false;
      rec.button.toggleAttribute("data-loading", false);
    }
  }

  paint(rec, 0, 0);
  current = rec;
  await rec.player.play();
  runFilm(rec);
}

document.querySelectorAll(".room[data-year]").forEach((room) => {
  const rec = {
    room,
    button: room.querySelector("button.work"),
    thumb: room.querySelector("img.thumb"),
    media: room.querySelector("img.media"),
    film: room.querySelector(".film canvas"),
    player: null,
    sheet: null,
    raf: null,
  };
  rec.ctx = rec.film.getContext("2d");

  // the room hangs a veiled enlargement of its own picture behind the work.
  // thumb.src, not the attribute: a relative url() inside a custom property
  // resolves against the stylesheet that uses it, not this page.
  room.style.setProperty("--gal-backdrop", `url(${rec.thumb.src})`);

  rec.button.addEventListener("click", () => select(rec));
});
