/* THE WRITTEN-DOWN VERSION, AND THE LINK TO IT.
 *
 * handbook.html is what the office reads when they have been handed this
 * screen and nobody is standing next to them. It is served from this same
 * repository, so it is one hop from the screen, needs no login, and shares
 * the fonts already here.
 *
 * Three things can quietly break it and none of them shows up in a diff:
 * the link can point at a file that is not here; the page can start calling
 * some other company for a font; and the link can inherit the rule that
 * hides the two console keys below 1440px -- which would take the handbook
 * away from a phone, the one place the person who needs it is standing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getChromium, makeFixture, dropFixture } from "./lib/screen.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const SCREEN = readFileSync(join(ROOT, "index.html"), "utf8");
const DOC = join(ROOT, "handbook.html");

test("the screen links to the handbook, and the handbook is here", () => {
  const m = /<a class="docs" href="([^"]+)"/.exec(SCREEN);
  assert.ok(m, "the screen no longer links to the handbook");
  assert.ok(!/^https?:|^\/\//.test(m[1]),
    `the handbook link points off-site (${m[1]}); it is meant to be one hop on this host`);
  assert.ok(existsSync(join(ROOT, m[1])),
    `the screen links to ${m[1]} and that file is not in the repository`);
});

test("the handbook is a whole document, not a fragment", () => {
  const h = readFileSync(DOC, "utf8");
  for (const tag of ["<!DOCTYPE html>", "<html", "<head>", "</head>", "<body>", "</body>"])
    assert.ok(h.includes(tag), `handbook.html has no ${tag} — it will not stand on its own`);
  assert.match(h, /<title>[^<]+<\/title>/, "handbook.html has no title");
});

test("the handbook calls nobody", () => {
  /* Same rule the screen and both public sites live under. A font host is
     still another company deciding whether this page renders. */
  const h = readFileSync(DOC, "utf8");
  const hits = [...h.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+/gi)]
    .concat([...h.matchAll(/url\(\s*["']?(https?:)?\/\/[^"')]+/gi)])
    .concat([...h.matchAll(/@import[^;]*["'](https?:)?\/\/[^"']+/gi)])
    .map((m) => m[0]);
  assert.deepEqual(hits, [], `handbook.html reaches off-host: ${hits.join(", ")}`);
});

test("every font and image the handbook names is in the repository", () => {
  const h = readFileSync(DOC, "utf8");
  const have = new Set(readdirSync(join(ROOT, "fonts")).concat(readdirSync(join(ROOT, "assets"))));
  const named = [...h.matchAll(/(?:url\(\s*["']?|href=")(fonts|assets)\/([^"')]+)/g)];
  assert.ok(named.length, "the handbook names no local font or image at all");
  for (const m of named)
    assert.ok(have.has(m[2]), `${m[1]}/${m[2]} is referenced but not in the repo`);
});

const chromium = await getChromium();
const NB = chromium ? false : "playwright is not installed";

test("the handbook link is reachable on the desk AND on a phone", { skip: NB }, async () => {
  /* The two keys beside it are hidden below 1440 on purpose -- they are
     console controls. If the handbook picks that rule up, it disappears
     exactly where it is most wanted. */
  const dir = makeFixture();
  const browser = await chromium.launch();
  try {
    for (const [w, h, where] of [[1600, 1000, "the desk"], [390, 844, "a phone"]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const p = await ctx.newPage();
      await p.goto("file://" + join(dir, "live.html"));
      /* ASK FOR A ROUTE TO THE HANDBOOK, NOT FOR ONE PARTICULAR ELEMENT.
         This used to name `a.docs` and only `a.docs`, which made it impossible
         to remove the header copy on the desk without failing a test whose
         real subject is "can the office get to the handbook from here". The
         desk has TWO candidates -- the header link and the one at the foot of
         the rail -- and below 1440 the rail's is display:none and the header's
         is the only one. Either satisfies this; neither being visible does not. */
      const links = await p.$$eval('a[href="handbook.html"]', (els) =>
        els.map((e) => {
          const c = getComputedStyle(e), b = e.getBoundingClientRect();
          /* How much of the link is inside the WINDOW, unscrolled — which is
             the state the office arrives in. */
          const on = Math.max(0, Math.min(b.right, innerWidth) - Math.max(b.left, 0));
          return { cls: e.className,
                   shown: c.display !== "none" && c.visibility !== "hidden" && b.width > 0,
                   w: Math.round(b.width), h: Math.round(b.height),
                   onScreen: Math.round(on) };
        }));
      const shown = links.filter((l) => l.shown);
      assert.ok(links.length >= 1, `no handbook link is on the page at ${w}x${h}`);
      assert.equal(shown.length, 1,
        `${where} (${w}x${h}) shows ${shown.length} handbook links: ` +
        `${JSON.stringify(shown)} — one route, not none and not two`);
      assert.ok(shown[0].w > 0 && shown[0].h > 0,
        `the handbook link has no box on ${where}`);
      if (w < 1440)
        assert.ok(shown[0].h >= 32,
          `the handbook link is ${shown[0].h}px tall on a phone — too small to tap`);
      /* PAINTED IS NOT ON SCREEN. Below the console width the nav is a
         horizontal scroller — 598px of chips in a 390px box — so a link can
         satisfy every check above and still sit 200px past the right edge of a
         row that gives no sign it scrolls. It is pinned there for that reason
         (see .rail-foot in admin.css); this is the assertion that holds the
         pin, and it fails if the pin is ever removed. Rule 32: measure what is
         inside the box, not what the stylesheet says. */
      assert.ok(shown[0].onScreen === shown[0].w,
        `the handbook link is ${shown[0].w - shown[0].onScreen}px off the edge on ` +
        `${where} — reachable only by dragging a row with no scrollbar`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    dropFixture(dir);
  }
});

test("the handbook itself renders clean, on the desk and on a phone", { skip: NB }, async () => {
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const p = await ctx.newPage();
      const bad = [];
      p.on("pageerror", (e) => bad.push(String(e)));
      p.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
      await p.goto("file://" + DOC);
      const r = await p.evaluate(() => ({
        sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        back: !!document.querySelector("a.backlink"),
        figures: document.querySelectorAll("figure svg").length,
      }));
      assert.deepEqual(bad, [], `the handbook errors at ${w}x${h}`);
      assert.equal(r.sideways, false,
        `the handbook scrolls sideways at ${w}: ${r.scrollW} in ${r.clientW}`);
      assert.equal(r.back, true, "no way back to the screen from the handbook");
      assert.equal(r.figures, 1, "the flow figure is missing");
      await ctx.close();
    }
  } finally { await browser.close(); }
});
