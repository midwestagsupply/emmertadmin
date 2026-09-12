/* WHAT WAS FORKED, AND WHETHER IT IS STILL WHAT WAS FORKED.
 *
 * lib/board.mjs, lib/parse.mjs and lib/currency.mjs are byte-for-byte copies
 * of dnilgis/bids. That is deliberate: every rule in them was written against a
 * real failure on this board or another on the same vendor's platform, and
 * re-deriving any of it by hand is how the nuance gets lost.
 *
 * A fork has one cost and this file is about that cost. Nobody will remember
 * next spring which commit these came from, and a hand-edit here -- a "small
 * fix" -- would silently turn a copy into a variant, which is the worst of both
 * arrangements: it no longer tracks upstream AND it no longer matches what was
 * proven. So the provenance is recorded and checked.
 *
 * This does NOT check against dnilgis/bids over the network. It cannot: this
 * repository has to work when that one is unreachable, which is the entire
 * reason the fork exists. It checks the copies against the hashes recorded when
 * they were taken. To compare against upstream, diff them by hand against the
 * commit named in lib/FORKED-FROM.json.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const prov = JSON.parse(readFileSync(join(ROOT, "lib/FORKED-FROM.json"), "utf8"));

test("the fork records where it came from, precisely enough to diff", () => {
  assert.match(prov.repo, /^https:\/\/github\.com\/\S+$/);
  assert.match(prov.commit, /^[0-9a-f]{40}$/, "a full commit sha, not a branch name");
  assert.match(prov.copiedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(Object.keys(prov.files).length, 3);
});

test("every forked file is byte for byte what was recorded", () => {
  for (const [rel, want] of Object.entries(prov.files)) {
    const buf = readFileSync(join(ROOT, rel));
    const got = createHash("sha256").update(buf).digest("hex");
    assert.equal(got, want.sha256,
      `${rel} has been edited since it was forked. If that was deliberate, say so ` +
      `in lib/FORKED-FROM.json and update the hash -- a copy that quietly became a ` +
      `variant tracks neither upstream nor what was proven.`);
    assert.equal(buf.length, want.bytes, `${rel} byte count`);
  }
});

test("the forked reader needs nothing outside lib/", async () => {
  /* The whole point is that this runs with no npm install and no sibling
     repository. Three files, no imports out of the directory. */
  for (const f of ["board.mjs", "parse.mjs", "currency.mjs"]) {
    const src = readFileSync(join(ROOT, "lib", f), "utf8");
    for (const m of src.matchAll(/^\s*import\s[\s\S]*?from\s+["']([^"']+)["']/gm)) {
      const spec = m[1];
      assert.ok(spec.startsWith("./") || spec.startsWith("node:"),
        `lib/${f} imports ${spec}; the fork must depend on nothing but itself ` +
        `and node's own modules`);
    }
  }
  /* And it really does load, which a static scan cannot tell you. */
  const board = await import("../lib/board.mjs");
  assert.equal(typeof board.buildFile, "function");
});
