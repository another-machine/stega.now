// The kiddo gallery. Same shape as live/ — one work hangs at a time above a
// rail — with two additions that come out of the same payload the reveal is
// eating: the clip, and the card.
//
// A kiddo stegassette holds one audio entry, a run of `frame-001…` JPEG stills
// at 6fps, and three text entries (Metadata, Quote, Message). RevealPlayer
// decodes all of them and plays the audio; the stills and the card are ours to
// drive. There is no callback per frame, so the clip runs off the player's own
// clock — `audioContext.currentTime - player.t0`, wrapped by `player.duration`
// — which is the same clock the reveal sweeps on. One playhead, two pictures.
//
// `Stegassette` is the global installed by ../lib/stegassette.js.

const stage = document.querySelector(".stage");
const revealPane = stage.querySelector(".pane.reveal");
const standin = revealPane.querySelector("img");
const filmPane = stage.querySelector(".pane.film");
const film = filmPane.querySelector("canvas");
const filmCtx = film.getContext("2d");
const card = document.querySelector(".card");
const cardScene = card.querySelector(".scene");
const cardYear = card.querySelector(".year");
const cardQuote = card.querySelector("blockquote");
const cardMessage = card.querySelector(".message");

const decoder = new TextDecoder();
const records = new Map();

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
function frameEntries(entries) {
  return entries
    .filter((e) => e.mimetype.startsWith("image/") && /^frame-\d+$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function loadFrames(entries) {
  return Promise.all(
    frameEntries(entries).map((e) =>
      createImageBitmap(new Blob([e.data], { type: e.mimetype })),
    ),
  );
}

// ── the clip ────────────────────────────────────────────────────────────────

// How much of a frame's turn goes to dissolving into the next one. At 6fps a
// cut lands hard, and the source is soft VHS: a dissolve over the tail of each
// turn carries the motion without smearing the whole frame. 0 cuts, 1 dissolves
// end to end and never holds a frame still.
const FADE = 0.5;

// ease the ramp: a linear dissolve reads as a lurch through its midpoint
const smoothstep = (x) => x * x * (3 - 2 * x);

// `mix` is how far into the dissolve this frame is, 0–1
function paint(rec, i, mix) {
  const { frames } = rec;
  if (!frames[i]) return;
  filmCtx.drawImage(frames[i], 0, 0, film.width, film.height);
  if (mix > 0) {
    // the clip loops with the audio, so the last frame dissolves into the first
    filmCtx.globalAlpha = mix;
    filmCtx.drawImage(
      frames[(i + 1) % frames.length],
      0,
      0,
      film.width,
      film.height,
    );
    filmCtx.globalAlpha = 1;
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

// The clip's pane is sized by height, so it needs the frames' own ratio to
// find its width. It comes out of the payload, so it is not ours to assume.
function shareTheStage() {
  stage.style.setProperty("--film-share", film.width / film.height);
}

// ── selection ───────────────────────────────────────────────────────────────

function showCard(entries) {
  const meta = facts(textOf(entries, "Metadata"));
  const quote = textOf(entries, "Quote");
  cardScene.textContent = meta.scene || "";
  cardYear.textContent = meta.date || "";
  cardQuote.textContent = quote ? `“${quote}”` : "";
  cardMessage.textContent = textOf(entries, "Message");
  card.classList.remove("hidden");
}

async function build(button, thumb, media) {
  building = true;
  revealPane.toggleAttribute("data-loading", true);
  try {
    // The full-resolution stegassette is display:none until it is wanted, and a
    // lazy image with no box never intersects the viewport — so it would sit at
    // complete:false forever and the decode would never start. Asking for it
    // eagerly is what sets it going; the other stegassettes stay deferred.
    if (!media.complete) {
      media.loading = "eager";
      await new Promise((resolve, reject) => {
        media.addEventListener("load", resolve, { once: true });
        media.addEventListener("error", reject, { once: true });
      });
    }
    const player = await Stegassette.createRevealPlayer({
      source: media,
      audioContext,
      className: "rev",
    });
    const frames = await loadFrames(player.entries);
    if (!frames.length) throw new Error("no frame entries in stegassette");

    film.width = frames[0].width;
    film.height = frames[0].height;

    const rec = { player, frames, raf: null };
    records.set(button, rec);
    return rec;
  } finally {
    building = false;
    revealPane.toggleAttribute("data-loading", false);
  }
}

document.querySelectorAll("nav.rail button").forEach((button) => {
  button.addEventListener("click", async () => {
    audioContext = audioContext || new AudioContext();
    if (building) return;

    const thumb = button.querySelector("img:not(.media)");
    const media = button.querySelector("img.media");
    if (!thumb || !media) return;

    const wasActive = button.getAttribute("aria-pressed") === "true";
    document
      .querySelector('.rail .work[aria-pressed="true"]')
      ?.setAttribute("aria-pressed", "false");

    document.body.style.backgroundImage = `url(${thumb.getAttribute("src")})`;

    if (current) {
      stopFilm(current);
      current.player.stop();
      current = null;
    }

    if (wasActive) {
      // toggled off — put the room back to the rail alone
      stage.classList.add("hidden");
      card.classList.add("hidden");
      return;
    }

    button.setAttribute("aria-pressed", "true");
    stage.classList.remove("hidden");

    let rec = records.get(button);
    if (!rec) {
      // the thumbnail stands in, pulsing, while the payload decodes
      standin.src = thumb.currentSrc || thumb.src;
      standin.hidden = false;
      revealPane.querySelector(".rev")?.remove();
      try {
        rec = await build(button, thumb, media);
      } catch (err) {
        console.error("stegassette decode failed", err);
        button.setAttribute("aria-pressed", "false");
        stage.classList.add("hidden");
        return;
      }
    }

    // show only this work's surface in the pane
    revealPane.querySelectorAll(".rev").forEach((el) => {
      if (el !== rec.player.element) el.remove();
    });
    if (!rec.player.element.isConnected) revealPane.appendChild(rec.player.element);
    standin.hidden = true;

    shareTheStage();
    paint(rec, 0, 0);
    showCard(rec.player.entries);

    current = rec;
    await rec.player.play();
    runFilm(rec);
  });
});
