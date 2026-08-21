// The static inventory of encoded releases on the CDN. Filenames and byte
// sizes are verified against the live bucket; everything else (titles,
// track names, lyrics) is decoded out of the PNGs themselves at runtime.
"use strict";
const Releases = {
  cdn: "https://cdn.stegassette.amplib.tech",
  order: ["cwrc-lofi", "cwrc", "rhir", "idles", "tt"],
  byId: {
    tt: {
      id: "tt",
      kind: "video",
      name: "twisted teens live in london",
      line: "seven songs · third man's blue basement · 8-bit mono",
      prefix: "tt",
      cover: null,
      items: [
        { file: "01-is-it-real.png", bytes: 26208854 },
        { file: "02-valley-spirit-never-dies.png", bytes: 22810177 },
        { file: "03-rando.png", bytes: 26518323 },
        { file: "04-tic-tac-toe.png", bytes: 29077992 },
        { file: "05-sister-heat.png", bytes: 26652997 },
        { file: "06-waiting-for-the-whip.png", bytes: 27967463 },
        { file: "07-when-the-wire-get-cut.png", bytes: 25341823 },
      ],
    },
    "cwrc-lofi": {
      id: "cwrc-lofi",
      kind: "album",
      name: "cameron winter at rockefeller chapel",
      line: "demo · 8-bit mono · lofi",
      prefix: "cwrc-lofi",
      cover: { file: "00-cover-cameron-winter-at-rockefeller-chapel.png", bytes: 4016073 },
      items: [
        { file: "01-01-entrance.png", bytes: 7013501 },
        { file: "02-01-sandbag.png", bytes: 13973999 },
        { file: "03-01-try-as-i-may.png", bytes: 18103924 },
        { file: "04-01-emperor-xiii-in-shades.png", bytes: 31079711 },
        { file: "05-01-the-rolling-stones.png", bytes: 19510049 },
        { file: "06-01-love-takes-miles.png", bytes: 24351220 },
        { file: "07-01-drinking-age.png", bytes: 33464004 },
        { file: "08-01-it-s-being-waited-for.png", bytes: 32038506 },
        { file: "09-01-lsd.png", bytes: 14552532 },
        { file: "10-01-nina-field-of-cops.png", bytes: 42894225 },
        { file: "11-01-0.png", bytes: 52984222 },
        { file: "12-01-take-it-with-you.png", bytes: 19089797 },
        { file: "13-01-encore-break.png", bytes: 10364642 },
        { file: "14-01-if-you-turn-back-now.png", bytes: 36940367 },
      ],
    },
    cwrc: {
      id: "cwrc",
      kind: "album",
      encrypted: true,
      name: "cameron winter at rockefeller chapel",
      line: "16-bit stereo · encrypted",
      prefix: "cwrc",
      cover: { file: "00-cover-cameron-winter-at-rockefeller-chapel.png", bytes: 3370429 },
      items: [
        { file: "01-01-entrance.png", bytes: 21993962 },
        { file: "02-01-sandbag.png", bytes: 69732702 },
        { file: "03-01-try-as-i-may.png", bytes: 126544111 },
        { file: "04-01-emperor-xiii-in-shades.png", bytes: 111873140 },
        { file: "05-01-the-rolling-stones.png", bytes: 101401184 },
        { file: "06-01-love-takes-miles.png", bytes: 97315819 },
        { file: "07-01-drinking-age.png", bytes: 110584450 },
        { file: "08-01-it-s-being-waited-for.png", bytes: 100407615 },
        { file: "09-01-lsd.png", bytes: 112418093 },
        { file: "10-01-nina-field-of-cops.png", bytes: 152796706 },
        { file: "11-01-0.png", bytes: 222301556 },
        { file: "12-01-take-it-with-you.png", bytes: 128935839 },
        { file: "13-01-encore-break.png", bytes: 43262941 },
        { file: "14-01-if-you-turn-back-now.png", bytes: 144464970 },
      ],
    },
    idles: {
      id: "idles",
      kind: "video",
      name: "the beachland ballroom",
      line: "idles · from the basement · loops",
      prefix: "idles",
      cover: null,
      items: [{ file: "the-beachland-ballroom.png", bytes: 4324737 }],
    },
    rhir: {
      id: "rhir",
      kind: "parts",
      name: "15 step",
      line: "one song · twelve panels · two covers",
      prefix: "rhir",
      cover: null,
      items: [
        { file: "15-step-01.png", bytes: 8023866 },
        { file: "15-step-02.png", bytes: 8033289 },
        { file: "15-step-03.png", bytes: 8035844 },
        { file: "15-step-04.png", bytes: 8041920 },
        { file: "15-step-05.png", bytes: 8039986 },
        { file: "15-step-06.png", bytes: 8033410 },
        { file: "15-step-07.png", bytes: 8040372 },
        { file: "15-step-08.png", bytes: 8027583 },
        { file: "15-step-09.png", bytes: 8029291 },
        { file: "15-step-10.png", bytes: 8034914 },
        { file: "15-step-11.png", bytes: 8040905 },
        { file: "15-step-12.png", bytes: 8036281 },
      ],
      // The two calendar covers, encoded with a wide border so the artwork
      // survives at a readable size around a small core of hidden text. No
      // audio rides in them — they are the release's documentation.
      docs: [
        { file: "cover-front.png", bytes: 8564891, name: "front cover" },
        { file: "cover-back.png", bytes: 10621567, name: "back cover" },
      ],
    },
  },
  url(rel, file) {
    return `${this.cdn}/${rel.prefix}/${file}`;
  },
  thumb(rel, file) {
    return `${this.cdn}/${rel.prefix}/thumbs/${file.replace(/\.png$/, ".jpg")}`;
  },
  totalBytes(rel) {
    let n = rel.cover ? rel.cover.bytes : 0;
    for (const it of rel.items) n += it.bytes;
    for (const d of rel.docs || []) n += d.bytes;
    return n;
  },
};
