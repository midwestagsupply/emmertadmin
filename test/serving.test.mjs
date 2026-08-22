/* WHERE THIS SCREEN GETS ITS BYTES — enforced, not documented.
 *
 * The whole point of this admin screen is that it is a static page on GitHub
 * Pages talking to two GitHub raw files and nothing else: prices come from the
 * `bids` repo, site state comes from the two site repos, and the fonts and
 * images ship inside this repository. There is no CDN, no analytics, no
 * webfont host, no third-party script.
 *
 * That was true when this file was written. Nothing was stopping it becoming
 * untrue — one pasted <script src="https://cdn..."> would have done it, and
 * nobody would have noticed until the page broke behind a firewall or started
 * leaking who was looking at it. These tests are what stops that silently.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const css = readFileSync(join(ROOT, "admin.css"), "utf8");

/* Hosts the page is allowed to name at all. raw.githubusercontent.com is the
   only one it may TALK to; bigriverbids.com appears once, as an href a person
   clicks to open the elevator's own board beside this screen. It is a link,
   never a fetch, and the test below proves that distinction still holds. */
const ALLOWED_HOSTS = new Set([
  "raw.githubusercontent.com",   // the only host the page TALKS to
  "www.bigriverbids.com",        // a link a person clicks, never a fetch
  "github.com",                  // where Save sends the office to file the change
]);

const hosts = (s) => [...s.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());

test("the page names no host outside the allow-list", () => {
  for (const src of [html, css]) {
    for (const h of hosts(src)) {
      assert.ok(ALLOWED_HOSTS.has(h), `unexpected host: ${h}`);
    }
  }
});

test("prices come from the bids repo, and from nowhere else", () => {
  const m = html.match(/FEED_URL\s*=\s*"([^"]+)"/);
  assert.ok(m, "FEED_URL is gone — the price feed has moved or been renamed");
  assert.equal(m[1], "https://raw.githubusercontent.com/dnilgis/bids/main/data/boyceville.json");
});

test("site state comes from the site repos on GitHub", () => {
  const m = html.match(/LIVE_BASE\s*=\s*"([^"]+)"/);
  assert.ok(m, "LIVE_BASE is gone");
  assert.equal(m[1], "https://raw.githubusercontent.com/midwestagsupply/");
});

test("EVERY FETCH IS BUILT FROM ONE OF THE TWO NAMED CONSTANTS", () => {
  /* Catches the one that matters: a fetch() pointed somewhere new. Each call
     has to be built from one of the two constants above, never from a literal —
     not because a literal is insecure today, but because there is then no
     single place to change when the answer moves, and the copy that gets
     forgotten is the one nobody is looking at.

     This is a source-shape check and it is deliberately kept alongside the
     behavioural one below, which drives the page and records what the browser
     really asked for. The behavioural test cannot see this fault at all: a
     second hardcoded copy of LIVE_BASE requests exactly the same host as the
     constant does, right up until the day one of them is edited. */
  const calls = [...html.matchAll(/fetch\s*\(\s*([^,)]+)/g)].map((m) => m[1].trim());
  assert.ok(calls.length >= 2, "expected at least the feed and the live-state reads");
  for (const c of calls) {
    assert.ok(/^(FEED_URL|LIVE_BASE)\b/.test(c),
      "fetch() target is a literal rather than one of the two constants — there are now two " +
      "copies of this address and only one of them will be changed: " + c.replace(/\s+/g, " "));
  }
});

test("Save opens an issue and does not post to a server", () => {
  /* The Cloudflare Worker is gone. If a form action or a POST ever comes back
     into this page, the whole no-server premise has quietly been undone. */
  assert.ok(/github\.com\/" \+ OWNER \+ "\/|github\.com/.test(html),
    "Save no longer points at GitHub");
  assert.ok(!/method="post"/i.test(html),
    "the form posts somewhere — Save is meant to open an issue, not post");
  assert.ok(!/fetch\s*\([^)]*\/save/.test(html), "something still calls /save");
});

test("bigriverbids is linked for a person, never fetched by the page", () => {
  assert.ok(/href="https:\/\/www\.bigriverbids\.com/.test(html),
    "the open-their-board link is gone");
  assert.ok(!/fetch\s*\([^)]*bigriverbids/.test(html),
    "the page must never fetch bigriverbids — it is a link, not a feed");
});

test("fonts, styles and images ship inside this repository", () => {
  for (const m of html.matchAll(/<(?:link|script|img)[^>]*(?:src|href)="([^"]+)"/g)) {
    const u = m[1];
    if (u.startsWith("#") || u.startsWith("?")) continue;
    assert.ok(!/^https?:|^\/\//.test(u), `loaded from off-site: ${u}`);
  }
  for (const m of css.matchAll(/url\(\s*["']?([^"')]+)/g)) {
    const u = m[1];
    if (u.startsWith("data:")) continue;
    assert.ok(!/^https?:|^\/\//.test(u), `stylesheet loads from off-site: ${u}`);
  }
});

test("the files it names are actually in the repository", () => {
  const have = new Set(readdirSync(join(ROOT, "fonts")).concat(readdirSync(join(ROOT, "assets"))));
  for (const m of css.matchAll(/url\(\s*["']?(fonts|assets)\/([^"')]+)/g)) {
    assert.ok(have.has(m[2]), `${m[1]}/${m[2]} is referenced but not in the repo`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   AND THE SAME QUESTION ASKED OF THE RUNNING PAGE
   ══════════════════════════════════════════════════════════════════════════
   Everything above reads the file. That is the right shape for "nobody may
   paste a CDN script in here" — the fault it guards against is textual and
   arrives in a diff. It is the wrong shape for "where does this page actually
   go", because a URL can be assembled at runtime out of pieces none of which
   look like a host. So the page is loaded in a real browser with every request
   recorded, and what it asked for is checked rather than what it says.
   ══════════════════════════════════════════════════════════════════════════ */
import { getChromium, makeFixture, dropFixture, ELEVATORS } from "./lib/screen.mjs";
import { join as pjoin } from "node:path";

const chromium = await getChromium();
const NB = chromium ? false : "playwright is not installed; the live serving check is skipped";

test("THE RUNNING PAGE TALKS TO GITHUB AND NOTHING ELSE", { skip: NB }, async () => {
  const dir = makeFixture();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const asked = [];
  /* Recorded, then answered with nothing. What is being measured is where it
     went, and a test that needed the real internet to say so would be a
     weather report. */
  await context.route("**/*", (r) => {
    const u = r.request().url();
    if (!/^file:/.test(u)) asked.push(u);
    return /^file:/.test(u) ? r.continue() : r.abort();
  });
  const page = await context.newPage();
  await page.goto("file://" + pjoin(dir, "live.html"), { waitUntil: "load" });
  await page.waitForTimeout(900);
  await context.close();
  await browser.close();
  dropFixture(dir);

  assert.ok(asked.length, "the page asked for nothing at all — this test is measuring nothing");
  for (const u of asked) {
    const { host, pathname } = new URL(u);
    assert.equal(host, "raw.githubusercontent.com", `the page fetched ${host}`);
    assert.ok(/^\/(dnilgis\/bids|midwestagsupply\/[a-z]+)\//.test(pathname),
      `the page fetched a raw path outside the bids repo and the two site repos: ${pathname}`);
  }
  /* And it really did ask each elevator's own repository, rather than one of
     them twice — which is a fault this file can see and no other test would. */
  for (const E of ELEVATORS)
    assert.ok(asked.some((u) => u.includes("/midwestagsupply/" + E.repo + "/")),
      `nothing was ever read from ${E.name}'s repository (${E.repo})`);
});

test("nothing secret leaves in the issue the page builds", { skip: NB }, async () => {
  /* The whole premise: this page holds no credential, so the authority to
     change anything is the GitHub account of whoever presses Submit. The link
     it builds must therefore carry the form and nothing else. */
  const dir = makeFixture();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.route("**/*", (r) => /^file:/.test(r.request().url()) ? r.continue() : r.abort());
  const page = await context.newPage();
  await page.goto("file://" + pjoin(dir, "live.html"), { waitUntil: "load" });
  await page.waitForTimeout(600);
  const urls = [];
  for (const E of ELEVATORS) {
    const u = await page.evaluate((s) => {
      let out = null;
      const w = window.open;
      window.open = (x) => { out = x; return null; };
      document.querySelector('.col[data-elev="' + s + '"] .btn-go').click();
      window.open = w;
      return out;
    }, E.site);
    urls.push([E, u]);
  }
  await context.close();
  await browser.close();
  dropFixture(dir);

  for (const [E, u] of urls) {
    assert.ok(u, `${E.name} built no issue link`);
    const url = new URL(u);
    assert.equal(url.host, "github.com");
    assert.equal(url.pathname, "/midwestagsupply/" + E.repo + "/issues/new");
    assert.deepEqual([...url.searchParams.keys()].sort(), ["body", "title"],
      "the link carries something other than the title and the body");
    assert.ok(!/token|secret|key=|password|authorization/i.test(u),
      "the issue link looks like it is carrying a credential");
  }
});
