// The books that ship with this page. Filenames and byte sizes are real —
// diff them against the files beside this one. The name and line exist only
// so the shelf can be drawn without opening anything; everything a book
// actually contains — its chapters, plates, printing, table of contents —
// is decoded out of the PNG when you open it, and this file never repeats
// any of it.
//
// Same shape as releases/manifest.js, for the same reason: a static list of
// what is here, and nothing that could drift from what is inside.
"use strict";
const Books = {
  order: ["peekskill-usa", "american-indian-stories"],
  byId: {
    "peekskill-usa": {
      id: "peekskill-usa",
      file: "peekskill-usa.png",
      bytes: 14551718,
      name: "Peekskill USA",
      line: "Howard Fast · Civil Rights Congress, 1951",
    },
    "american-indian-stories": {
      id: "american-indian-stories",
      file: "american-indian-stories.png",
      bytes: 17037885,
      name: "American Indian Stories",
      line: "Zitkála-Šá · Hayworth Publishing House, 1921",
    },
  },

  // The shelf shows the stegassette, not the jacket it was made from — the
  // encoded picture, payload and all, is the object you get. A stegassette
  // cannot be resized without destroying it, so the shelf shows a thumbnail
  // of one instead: `npm run thumbs` in stegassette-jobs, pointed at this
  // directory. Same arrangement as releases, for the same reason.
  thumb(b) {
    return `thumbs/${b.file.replace(/\.png$/, ".jpg")}`;
  },
};
