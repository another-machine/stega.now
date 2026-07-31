// Ported from the Parcel machine this gallery used to be. Plain JS against the
// vendored codec bundle, so the page needs no build step — the only TypeScript
// here was type annotations, and Parcel was only ever compiling those, rewriting
// asset URLs, and hashing filenames. None of which a static page needs.
//
// `Stegassette` is the global installed by ../lib/stegassette.js.

let audioContext;
let current = null;

document.querySelectorAll("section").forEach((section) => {
  const button = section.querySelector("button");
  const media = button?.querySelector("img.media");
  const thumb = button?.querySelector("img:not(.media)");

  if (button && media && thumb) {
    // thumb.src, not the attribute: a relative url() inside a custom
    // property resolves against the stylesheet that uses it, not this page
    section.style.setProperty("--gal-backdrop", `url(${thumb.src})`);

    let player = null;
    let building = false;

    button.addEventListener("click", async () => {
      audioContext = audioContext || new AudioContext();
      if (building) return;

      if (!player) {
        building = true;
        try {
          player = await Stegassette.createRevealPlayer({
            source: media,
            audioContext,
            className: "player",
          });
          player.element.style.setProperty("--og-width", `${player.width}px`);
          player.element.style.setProperty("--og-height", `${player.height}px`);
          player.element.style.aspectRatio = `${player.width} / ${player.height}`;
          button.appendChild(player.element);
          thumb.classList.add("gal-ghost");
          thumb.setAttribute("aria-hidden", "true");
        } catch (err) {
          console.error("stegassette decode failed", err);
          return;
        } finally {
          building = false;
        }
      }

      // Stop playback in any other room; playing state lives on the button
      // as aria-pressed, and the gallery styles light the work from it
      if (current && current.player !== player) {
        current.player.stop();
        current.button.setAttribute("aria-pressed", "false");
        current = null;
      }

      if (player.playing) {
        player.stop();
        button.setAttribute("aria-pressed", "false");
        current = null;
      } else {
        button.setAttribute("aria-pressed", "true");
        current = { player, button };
        await player.play();
      }
    });
  }
});
