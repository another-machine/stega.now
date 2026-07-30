// codec-check.js — are the vendored codec bundles current?
//
// This repo no longer contains a codec. It vendors the bundles that
// @amplib/steganography publishes, and this checks each copy against the bytes
// amplib.app is actually serving:
//
//   lib/stegassette.js        window.Stegassette      codec + reveal player
//   lib/stegassette-jobs.js   window.StegassetteJobs  job schema (the editor)
//
// One copy for every page here — the player, /live, /geese, /me,
// /audio-console and /make all load the same two files. The ESM builds are
// vendored by stegassette-jobs, which runs in Node.
//
// It replaces a hash comparison against a local lib/steg-core.js, which is gone
// — that file was a second implementation of the format, and the hand-copying of
// it is what let the gallery site run six weeks behind with no symptom.
//
//   node scripts/codec-check.js         report
//   node scripts/codec-check.js --fix   re-vendor whatever drifted
//
// Exits 1 on drift so a build step or pre-push hook can gate on it.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

const BASE = "https://amplib.app/lib";

// local path (relative to this repo) → published filename
const BUNDLES = [
  ["lib/stegassette.js", "stegassette.js"],
  ["lib/stegassette-jobs.js", "stegassette-jobs.js"],
];

const fix = process.argv.includes("--fix");

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const versionOf = (text) =>
  (text.match(/CODEC_VERSION\s*=\s*"([^"]+)"/) || [])[1] || "—";

let drift = 0;
let unreachable = 0;

for (const [rel, remoteName] of BUNDLES) {
  const url = `${BASE}/${remoteName}`;
  const abs = join(repo, rel);

  let remote;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`UNREACHABLE  ${rel}  ${url} → HTTP ${res.status}`);
      unreachable++;
      continue;
    }
    remote = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.log(`UNREACHABLE  ${rel}  ${e.message}`);
    unreachable++;
    continue;
  }

  if (!existsSync(abs)) {
    console.log(`MISSING      ${rel}`);
    drift++;
    if (fix) {
      writeFileSync(abs, remote);
      console.log(`             └─ vendored from ${url}`);
    }
    continue;
  }

  const local = readFileSync(abs);
  if (sha(local) === sha(remote)) {
    console.log(`ok           ${rel}  v${versionOf(local.toString())}`);
    continue;
  }

  console.log(
    `DRIFT        ${rel}  local v${versionOf(local.toString())} ${sha(local).slice(0, 12)}` +
      `  ≠ published v${versionOf(remote.toString())} ${sha(remote).slice(0, 12)}`,
  );
  drift++;
  if (fix) {
    writeFileSync(abs, remote);
    console.log(`             └─ re-vendored from ${url}`);
  }
}

console.log("");
if (unreachable) {
  console.log(`${unreachable} bundle(s) could not be fetched — amplib.app down, or the`);
  console.log("Pages workflow has not published them yet.");
  process.exit(1);
}
if (!drift) {
  console.log("All vendored bundles match what amplib.app is serving.");
  process.exit(0);
}
if (fix) {
  console.log(`Re-vendored ${drift}. Commit them.`);
  process.exit(0);
}
console.log(`${drift} bundle(s) stale. Re-run with --fix, then commit.`);
process.exit(1);
