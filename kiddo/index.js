// The kiddo gallery. A room per year, as in geese/ — one work, one viewport,
// nothing else in it. Tapping the picture loads and plays it.
//
// A kiddo stegassette holds one audio entry, a run of `frame-001…` JPEG stills
// at 6fps, and three text entries (Metadata, Quote, Message). RevealPlayer
// decodes all of them and plays the audio; the stills and the card are ours to
// drive. There is no callback per frame, so the clip runs off the player's own
// clock — `audioContext.currentTime - player.t0`, wrapped by `player.duration`
// — which is the same clock the reveal sweeps on. One playhead, two pictures.
//
// `Stegassette` is the global installed by ../lib/stegassette.js.

// How much of a frame's turn goes to dissolving into the next one. At 6fps a
// cut lands hard, and the source is soft VHS: a dissolve over the tail of each
// turn carries the motion without smearing the whole frame. 0 cuts, 1 dissolves
// end to end and never holds a frame still.
const FADE = 0.5;

// ease the ramp: a linear dissolve reads as a lurch through its midpoint
const smoothstep = (x) => x * x * (3 - 2 * x);

const decoder = new TextDecoder();

let audioContext;
let current = null;
let building = false;

// ── entries ─────────────────────────────────────────────────────────────────

const textOf = (entries, name) => {
  const entry = entries.find((e) => e.name === name);
  return entry ? decoder.decode(entry.data).trim() : "";
};

// Metadata is a block of `Key: value` lines
function facts(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

// the stills, in order. Names are zero-padded to a fixed width, so they sort
// as strings — but sort explicitly rather than trusting entry order.
async function loadFrames(entries) {
  return Promise.all(
    entries
      .filter((e) => e.mimetype.startsWith("image/") && /^frame-\d+$/.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => createImageBitmap(new Blob([e.data], { type: e.mimetype }))),
  );
}

// ── the clip ────────────────────────────────────────────────────────────────

// `mix` is how far into the dissolve this frame is, 0–1
function paint(rec, i, mix) {
  const { frames, film, ctx } = rec;
  if (!frames?.[i]) return;
  ctx.drawImage(frames[i], 0, 0, film.width, film.height);
  if (mix > 0) {
    // the clip loops with the audio, so the last frame dissolves into the first
    ctx.globalAlpha = mix;
    ctx.drawImage(frames[(i + 1) % frames.length], 0, 0, film.width, film.height);
    ctx.globalAlpha = 1;
  }
}

function runFilm(rec) {
  const { player, frames } = rec;
  const tick = () => {
    if (!player.playing) {
      rec.raf = null;
      return;
    }
    const raw = player.audioContext.currentTime - player.t0;
    const at = raw > 0 ? raw % player.duration : 0;
    // where the playhead sits in frames, not seconds: the whole part picks the
    // frame, the fraction is how far through its turn we are
    const pos = (at / player.duration) * frames.length;
    const i = Math.min(frames.length - 1, Math.floor(pos));
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

function showCard(rec) {
  const entries = rec.player.entries;
  const meta = facts(textOf(entries, "Metadata"));
  const quote = textOf(entries, "Quote");
  rec.card.querySelector(".scene").textContent = meta.scene || "";
  rec.card.querySelector(".year").textContent = meta.date || rec.room.dataset.year;
  rec.card.querySelector("blockquote").textContent = quote ? `“${quote}”` : "";
  rec.card.querySelector(".message").textContent = textOf(entries, "Message");
  rec.card.classList.remove("hidden");
}

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
  rec.frames = await loadFrames(rec.player.entries);
  if (!rec.frames.length) throw new Error("no frame entries in stegassette");

  // the clip's pane is sized by one edge; the frames' own ratio finds the
  // other, and that ratio comes out of the payload rather than a guess here
  rec.film.width = rec.frames[0].width;
  rec.film.height = rec.frames[0].height;
  rec.room.style.setProperty("--film-share", rec.film.width / rec.film.height);

  // the decode surface covers the button; the thumbnail stays to hold the frame
  rec.button.appendChild(rec.player.element);
  rec.thumb.classList.add("gal-ghost");
  rec.thumb.setAttribute("aria-hidden", "true");
  showCard(rec);
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
    card: room.querySelector(".card"),
    player: null,
    frames: null,
    raf: null,
  };
  rec.ctx = rec.film.getContext("2d");

  // the room hangs a veiled enlargement of its own picture behind the work.
  // thumb.src, not the attribute: a relative url() inside a custom property
  // resolves against the stylesheet that uses it, not this page.
  room.style.setProperty("--gal-backdrop", `url(${rec.thumb.src})`);

  rec.button.addEventListener("click", () => select(rec));
});
