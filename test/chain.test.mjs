/* THE WHOLE CHAIN, RUN FOR REAL.
 *
 * Sig, 2026-09-08: "and the badger and midwest sites will play nice with the
 * admin page?"
 *
 * Every hop of that already has its own green suite -- the screen builds an
 * issue, the applier reads one, the sites read a pricing.json -- and three green
 * suites are not an answer to that question. They agree with themselves. What
 * nothing checked is that the thing the SCREEN actually writes is the thing the
 * SITE actually reads, end to end, with no fixture standing in the middle
 * inventing a shape both halves happen to accept.
 *
 * So this runs it: a real browser fills in the real screen, presses Save and
 * hands over the issue body it built; the real applier parses that body into a
 * real pricing.json; the real publisher reads that file against a real feed and
 * writes a real index.html; and the price a grower would read is compared with
 * the basis that was typed at the top of it.
 *
 * IT SKIPS RATHER THAN PASSES when the site repositories are not beside this
 * one. A chain test with a stubbed link is not a chain test, and one that
 * quietly stubbed the site would go green forever.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REPO, getChromium, makeFixture, dropFixture, openScreen, save, refusal,
  feedFull, BOARD_ROWS_FULL, col, ELEVATORS,
} from "./lib/screen.mjs";
import { applyUpdate, parseForm } from "../tools/apply-update.mjs";

/* The same search the new-crop test uses, for the same reason. */
const CANDIDATES = [
  ["badger", ["badgergrain", join("diag", "bg"), process.env.SITE_REPO_BADGER]],
  ["midwest", ["midwestcommodity", join("diag", "mc"), process.env.SITE_REPO_MIDWEST]],
];
/* EVERY SITE THAT IS HERE GETS RUN, not the first one found. The two sites do
   not share a file -- each carries its own copy of update-prices.mjs -- so a
   chain proved through Badger says nothing about Midwest, and the fix that
   lands in one of two copies is a mistake this project has made before. */
const SITES = CANDIDATES.map(([name, where]) => [name, where
  .filter(Boolean)
  .map((n) => (n.startsWith("/") ? n : join(REPO, "..", n)))
  .find((d) => existsSync(join(d, "tools", "update-prices.mjs")))])
  .filter(([, d]) => d);
const NO_SITE = SITES.length ? false
  : "no site repository beside this one; the chain cannot be run";

for (const [SITE_NAME, SITE] of (SITES.length ? SITES : [["none", null]]))
test(`the chain, from the screen to the page a ${SITE_NAME} grower reads`,
  { skip: NO_SITE || (await getChromium().catch(() => null)) ? NO_SITE : "no browser" },
  async (t) => {
  const browser = await (await getChromium()).launch();
  const dir = await makeFixture();
  t.after(async () => { await browser.close(); await dropFixture(dir); });

  /* ── 1. a person, on the screen ─────────────────────────────────────────
     Ticks two months that are not the pair the site publishes today, and types
     a basis into one of them. October is on Big River's board and is new crop;
     December is on it and is not. */
  const p = await openScreen(browser, dir, {
    viewport: { width: 1600, height: 1000 }, feed: feedFull(), tab: "basis",
  });
  const site = SITE_NAME;
  const boxOf = (m) => `${col(site)} .cell.ctl[data-month="${m}"] input.mbasis`;
  const tickOf = (m) => `${col(site)} .cell.pub[data-month="${m}"] input`;
  await p.waitForSelector(boxOf("October"));
  await p.fill(boxOf("October"), "-0.42");
  await p.check(tickOf("October"));
  await p.fill(boxOf("December"), "-0.19");
  await p.check(tickOf("December"));
  /* And one the site is publishing today comes OFF, so this proves the table is
     read rather than merely added to. */
  await p.uncheck(tickOf("September")).catch(() => {});
  await p.waitForTimeout(200);

  const url = await save(p, site);
  const why = await refusal(p, site);
  assert.ok(url, "the screen refused to file the issue: " + why);

  /* ── 2. the applier, on the body the screen really built ────────────────── */
  const body = new URL(url).searchParams.get("body");
  const form = parseForm(body);
  assert.ok(form["Months — what we publish"],
    "the issue the screen built carries no months table:\n" + body.slice(0, 400));
  const applied = applyUpdate(form, {
    hours: { weekday: "8:00a to 5:00p" },
    pricing: { basis: -0.75, basisHarvest: 0, spread: 0, contact: "x@example.com" },
    todayISO: "2026-09-08",
  });
  const months = applied.pricing.months;
  assert.ok(months, "the applier read the issue and wrote no months table");
  assert.equal(months.October.basis, -0.42, "October's basis did not survive the trip");
  assert.equal(months.October.publish, true);
  assert.equal(months.December.basis, -0.19);
  assert.equal(months.December.publish, true);
  assert.equal(months.September.publish, false, "unticking a month did not survive the trip");

  /* ── 3. the site, on the file the applier really wrote ──────────────────── */
  const run = mkdtempSync(join(tmpdir(), "chain-"));
  const cwd = process.cwd();
  let html, publisher;
  try {
    cpSync(join(SITE, "index.html"), join(run, "index.html"));
    /* THE SITE'S OWN pricing.json, with only the fields this trip changed
       written over it. Typing the company and town here would prove the chain
       against a site that does not exist. */
    writeFileSync(join(run, "pricing.json"), JSON.stringify({
      ...JSON.parse(readFileSync(join(SITE, "pricing.json"), "utf8")),
      basis: -0.75, basisHarvest: 0, spread: 0,
      months: applied.pricing.months,
      price_note: null, manual: null,
    }));
    process.chdir(run);
    const feed = feedFull();
    feed.checkedAt = new Date().toISOString();
    feed.pricedAt = feed.checkedAt;
    publisher = await import(join(SITE, "tools", "update-prices.mjs"));
    await publisher.main({
      fetchImpl: async () => ({ ok: true, json: async () => feed,
                               text: async () => JSON.stringify(feed) }),
      now: new Date(),
    });
    html = readFileSync(join(run, "index.html"), "utf8");
  } finally {
    process.chdir(cwd);
    rmSync(run, { recursive: true, force: true });
  }

  /* ── 4. what a grower reads ─────────────────────────────────────────────── */
  const rows = [...html.matchAll(/<td class="mo">([^<]*)/g)].map((m) => m[1].trim());
  assert.deepEqual(rows, ["October", "December"],
    "the page shows " + JSON.stringify(rows) + ", not the months that were ticked");

  /* THROUGH THE SITE'S OWN ROUNDING RULE AND ITS OWN MONEY FORMATTER -- both
     imported from the site, never re-implemented here. A copy written in the
     test would keep agreeing with itself after the site's rule changed, which
     is the exact failure this whole file exists to catch. */
  const q = (m) => BOARD_ROWS_FULL.find((b) => b.delivery === m).futuresPriceCents / 100;
  for (const [m, b] of [["October", -0.42], ["December", -0.19]]) {
    const want = publisher.money(publisher.payFromBasis(q(m), b));
    assert.ok(html.includes(want),
      `the page does not carry ${m} at ${want}`);
  }
  await p.close();
});
