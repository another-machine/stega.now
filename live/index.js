// Ported from the Parcel machine this gallery used to be. Plain JS against the
// vendored codec bundle, so the page needs no build step — the only TypeScript
// here was type annotations, and Parcel was only ever compiling those, rewriting
// asset URLs, and hashing filenames. None of which a static page needs.
//
// `Stegassette` is the global installed by ../lib/stegassette.js.

let audioContext;
let current = null;
let building = false;

const players = new Map();

document.querySelectorAll("nav button").forEach((button) => {
  button.addEventListener("click", async () => {
    audioContext = audioContext || new AudioContext();
    if (building) return;

    const section = button.closest("section");
    const media = button.querySelector("img.media");
    const thumb = button.querySelector("img:not(.media)");
    const imgBackground =
      section?.querySelector("img.background");
    if (!section || !media || !thumb) return;

    const isActive = button.getAttribute("aria-pressed") === "true";
    section
      .querySelector('button[aria-pressed="true"]')
      ?.setAttribute("aria-pressed", "false");

    document.body.style.backgroundImage = `url(${thumb.getAttribute("src")})`;

    if (current) {
      current.stop();
    }

    if (isActive) {
      // Toggled off — leave the encoded image showing
      current = null;
      return;
    }

    button.setAttribute("aria-pressed", "true");

    let player = players.get(button);
    if (!player) {
      building = true;
      section.toggleAttribute("data-loading", true);
      // Show the thumbnail pulsing in the background slot while decoding
      if (imgBackground) {
        imgBackground.src = thumb.currentSrc || thumb.src;
        imgBackground.classList.remove("hidden");
      }
      section
        .querySelectorAll("div.background")
        .forEach((el) => el.remove());
      try {
        // The full-resolution cartridge is display:none until it is wanted,
        // and a lazy image with no box never intersects the viewport — so it
        // would sit at complete:false forever and the decode would never
        // start. Asking for it eagerly is what sets it going; the other
        // cartridges stay deferred until they are chosen.
        if (!media.complete) {
          media.loading = "eager";
          await new Promise((resolve, reject) => {
            media.addEventListener("load", resolve, { once: true });
            media.addEventListener("error", reject, { once: true });
          });
        }
        player = await Stegassette.createRevealPlayer({
          source: media,
          audioContext,
          className: "background",
        });
        players.set(button, player);
      } catch (err) {
        console.error("stegassette decode failed", err);
        // don't leave the tile claiming to play something that never loaded
        button.setAttribute("aria-pressed", "false");
        current = null;
        return;
      } finally {
        building = false;
        section.toggleAttribute("data-loading", false);
      }
    }

    // Show only this player's canvases in the section
    imgBackground?.classList.add("hidden");
    section
      .querySelectorAll("div.background")
      .forEach((el) => {
        if (el !== player.element) el.remove();
      });
    if (!player.element.isConnected) {
      section.insertBefore(player.element, section.querySelector("nav"));
    }

    current = player;
    await player.play();
  });
});
