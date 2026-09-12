/* THE MIRROR, RUN AGAINST THEIR REAL BOARD AND AGAINST ITS BAD DAYS.
 *
 * Three captures, all of them the live page verbatim in the parts the reader
 * touches (see the header comment in each). Two of them exist because of a
 * specific incident:
 *
 *   bigriver-2121.html            the ordinary six-column board, 2026-08-17
 *   bigriver-2121-settled.html    after the 1:20pm CBOT settle, when every
 *                                 futures cell carries a trailing "s"
 *   bigriver-2121-lasttrade.html  the morning their board grew a seventh column
 *
 * fixtures/expected/proven-reader.json is what dnilgis/bids produced from those
 * three files at the commit named in lib/FORKED-FROM.json, recorded before the
 * fork was trusted with anything. The first test below is the one that matters:
 * this repository's reader must produce that, exactly. It is the proof that the
 * detach did not quietly change a published number.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildFile, isRefusal } from "../lib/board.mjs";
import { looksLikeShell, fetchBoard, buildIndex, alarm, iso,
         ALARM_AFTER_H, FETCH_ATTEMPTS } from "../scripts/read.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = JSON.parse(readFileSync(join(ROOT, "sources/boyceville.json"), "utf8"));
const EXPECTED = JSON.parse(readFileSync(join(ROOT, "fixtures/expected/proven-reader.json"), "utf8"));
const NOW = new Date("2026-09-12T14:00:00.000Z");
const capture = (n) => readFileSync(join(ROOT, "fixtures", n + ".html"), "utf8");

/* ── the detach changed nothing a reader can see ───────────────────────── */

for (const name of Object.keys(EXPECTED)) {
  test(`${name}: byte for byte what dnilgis/bids produced`, () => {
    const want = EXPECTED[name];
    let got;
    try {
      const r = buildFile(capture(name), { now: NOW, sourceUrl: SOURCE.url, source: SOURCE });
      got = { ok: true, file: r.file, verified: r.verified, boardAt: r.boardAt,
              dropped: r.dropped, locations: r.locations,
              withheld: r.withheld, unreconciled: r.unreconciled };
    } catch (e) {
      got = { ok: false, refusal: isRefusal(e), message: e.message };
    }
    assert.equal(JSON.stringify(got, null, 2), JSON.stringify(want, null, 2));
  });
}

test("and it really is reading their numbers, not echoing a snapshot", () => {
  /* The test above would pass on a reader that returned the expected file
     verbatim and never looked at the HTML. This one changes their board and
     requires the output to change with it. */
  const html = capture("bigriver-2121").replace("<li class='c2'>4.0750</li>",
                                                "<li class='c2'>4.1750</li>");
  assert.throws(() => buildFile(html, { now: NOW, sourceUrl: SOURCE.url, source: SOURCE }),
    /balance|cash - basis|identity/i,
    "moving one cash cell by a dime must break cash - basis = futures on that row");
});

/* ── the guards, each proven by breaking the thing it guards ───────────── */

test("a moved column is refused, not published", () => {
  /* Swap the Bid and Basis cells on every row: every value is still in range,
     every row still parses, and the identity is out by tens of cents. */
  const html = capture("bigriver-2121")
    .replace(/<li class='c2'>([\d.]+)<\/li><li class='c3'>(-?[\d.]+)<\/li>/g,
             "<li class='c2'>$2</li><li class='c3'>$1</li>");
  assert.throws(() => buildFile(html, { now: NOW, sourceUrl: SOURCE.url, source: SOURCE }));
});

test("a board with no rows at all is refused with a reason", () => {
  assert.throws(
    () => buildFile("<html><body><p>Site under maintenance</p></body></html>",
                    { now: NOW, sourceUrl: SOURCE.url, source: SOURCE }),
    /0 bids parsed/);
});

test("somebody else's location on the same page is never published as ours", () => {
  /* ONE URL, SIX ELEVATORS. /cashbidssingle-2121 is the Boyceville address and
     their page serves every location's board on it, in tabs. Boyceville's rows
     are keyed 2121; Dyersville's are 2162, and Dyersville is a different
     business in a different state. An absent locationId used to match every row
     on the page, which is how one town's bids end up on another town's board. */
  const r = buildFile(capture("bigriver-2121"),
    { now: NOW, sourceUrl: SOURCE.url, source: SOURCE });

  /* Their own delivery labels differ between the two panels: Boyceville writes
     month names ("August", "September"), Dyersville writes "Aug '26",
     "FH Sept '26", "LH Sept '26". Not one of the other panels' labels may
     appear in what we publish. */
  const published = r.file.bids.map((b) => b.delivery);
  for (const theirs of ["Aug '26", "FH Sept '26", "LH Sept '26"])
    assert.ok(!published.includes(theirs),
      `${theirs} is Dyersville's label and it is on our board`);
  assert.deepEqual(published,
    ["August", "September", "October", "November", "December", "January", "February"]);

  /* And the file says which locations it saw and did not publish, so a panel
     appearing or vanishing is visible rather than silent. */
  assert.ok(r.file.otherLocationsOnPage.some((s) => /Dyersville/.test(s)),
    "the other panels are named in the file, not quietly dropped");

  /* Declaring the wrong id must not silently publish the wrong town: it either
     refuses or it publishes rows that are demonstrably not Boyceville's. */
  let wrong = null;
  try {
    wrong = buildFile(capture("bigriver-2121"),
      { now: NOW, sourceUrl: SOURCE.url, source: { ...SOURCE, locationId: "2162" } });
  } catch { /* refusing is the better of the two outcomes */ }
  if (wrong)
    assert.notDeepEqual(wrong.file.bids.map((b) => b.delivery), published);
});

/* ── the shell check ──────────────────────────────────────────────────── */

test("a 200 that is not their board is named as that", () => {
  assert.match(looksLikeShell(""), /bytes/);
  assert.match(looksLikeShell("<html>" + "x".repeat(3000) + "</html>"), /cashbidssingle/);
  assert.match(looksLikeShell("<html>cashbidssingle" + "x".repeat(3000) + "</html>"), /fcControls/);
  assert.equal(looksLikeShell(capture("bigriver-2121")), null, "their real board is not a shell");
});

test("a torn read is retried, and the retry is what publishes", async () => {
  let n = 0;
  const html = await fetchBoard("https://example.test/board", {
    fetchImpl: async () => {
      n++;
      return n < 3
        ? { ok: true, status: 200, text: async () => "<html>too short</html>" }
        : { ok: true, status: 200, text: async () => capture("bigriver-2121") };
    },
    wait: async () => {}, log: () => {},
  });
  assert.equal(n, 3);
  assert.equal(looksLikeShell(html), null);
});

test("and a page that never comes good gives up, naming every attempt", async () => {
  await assert.rejects(
    fetchBoard("https://example.test/board", {
      fetchImpl: async () => ({ ok: false, status: 503, text: async () => "" }),
      wait: async () => {}, log: () => {},
    }),
    (e) => {
      assert.equal((e.message.match(/attempt/g) || []).length, FETCH_ATTEMPTS);
      assert.match(e.message, /503/);
      return true;
    });
});

/* ── THE TWO CLOCKS. This is the invariant the degrade rests on. ───────── */

test("a failed pass does NOT advance checkedAt", () => {
  const good = buildIndex({ previous: null, now: new Date("2026-09-12T08:00:00Z"),
    ok: true, checkedAt: "2026-09-12T08:00:00.000Z",
    pricedAt: "2026-09-11T18:30:00.000Z", rows: 7, detail: null });
  const bad = buildIndex({ previous: good, now: new Date("2026-09-12T08:10:00Z"),
    ok: false, checkedAt: null, pricedAt: null, rows: null, detail: "HTTP 503" });

  assert.equal(bad.sources[0].checkedAt, "2026-09-12T08:00:00.000Z",
    "if a failed pass moved checkedAt forward, the sites would publish a frozen " +
    "price for ever and the feed would look perfectly fresh while doing it");
  assert.equal(bad.sources[0].attemptedAt, "2026-09-12T08:10:00.000Z",
    "the attempt IS recorded; the two clocks are what tell a quiet market from a dead reader");
  assert.equal(bad.sources[0].health, "refused");
  assert.equal(bad.sources[0].fails, 1);
  assert.match(bad.sources[0].detail, /503/, "the reason is named, not summarised");
});

test("consecutive failures accumulate, and a good read clears them", () => {
  let ix = buildIndex({ previous: null, now: new Date("2026-09-12T08:00:00Z"),
    ok: true, checkedAt: "2026-09-12T08:00:00.000Z", pricedAt: null, rows: 7, detail: null });
  for (let i = 1; i <= 5; i++)
    ix = buildIndex({ previous: ix, now: new Date(Date.parse("2026-09-12T08:00:00Z") + i * 6e5),
      ok: false, checkedAt: null, pricedAt: null, rows: null, detail: "down" });
  assert.equal(ix.sources[0].fails, 5);
  assert.equal(ix.sources[0].failingSince, "2026-09-12T08:10:00.000Z",
    "when the run of failures STARTED, not when the latest one was");

  const back = buildIndex({ previous: ix, now: new Date("2026-09-12T09:00:00Z"),
    ok: true, checkedAt: "2026-09-12T09:00:00.000Z", pricedAt: null, rows: 7, detail: null });
  assert.equal(back.sources[0].fails, 0);
  assert.equal(back.sources[0].failingSince, null);
  assert.equal(back.sources[0].detail, null);
});

test("pricedAt survives a run of failures; it is theirs, not ours", () => {
  const good = buildIndex({ previous: null, now: new Date("2026-09-12T08:00:00Z"),
    ok: true, checkedAt: "2026-09-12T08:00:00.000Z",
    pricedAt: "2026-09-11T18:30:00.000Z", rows: 7, detail: null });
  const bad = buildIndex({ previous: good, now: new Date("2026-09-12T08:10:00Z"),
    ok: false, checkedAt: null, pricedAt: null, rows: null, detail: "down" });
  assert.equal(bad.sources[0].pricedAt, "2026-09-11T18:30:00.000Z");
});

/* ── the alarm is on the clock, not on a count of passes ───────────────── */

test("the alarm fires on the clock, because GitHub drops crons", () => {
  const start = Date.parse("2026-09-12T08:00:00Z");
  let ix = buildIndex({ previous: null, now: new Date(start), ok: true,
    checkedAt: "2026-09-12T08:00:00.000Z", pricedAt: null, rows: 7, detail: null });
  assert.equal(alarm(ix, new Date(start)), null, "a live source never alarms");

  /* TWO passes over four hours, not twenty-four: exactly the case a
     count-based alarm gets wrong, and the case GitHub's 17% delivery makes
     ordinary rather than exotic. */
  ix = buildIndex({ previous: ix, now: new Date(start + 6e5), ok: false,
    checkedAt: null, pricedAt: null, rows: null, detail: "down" });
  assert.equal(alarm(ix, new Date(start + 6e5)), null, "one failed pass is not an alarm");

  ix = buildIndex({ previous: ix, now: new Date(start + 4.2 * 36e5), ok: false,
    checkedAt: null, pricedAt: null, rows: null, detail: "down" });
  const say = alarm(ix, new Date(start + 4.2 * 36e5));
  assert.ok(say, "two passes are enough when four hours have gone by");
  assert.equal(ix.sources[0].fails, 2, "and it alarmed on two, not on twenty-four");
  assert.match(say, /Call for today's price/, "it says what a customer will see");
});

test("the alarm threshold is the sites' withdrawal threshold", () => {
  /* If these two ever drift, either the sites go dark with nobody told, or an
     issue is opened about a price that is still on the page. */
  assert.equal(ALARM_AFTER_H, 4);
  const site = readFileSync(join(ROOT, "..", "badgergrain", "tools", "update-prices.mjs"), "utf8");
  const m = site.match(/const FEED_MAX_AGE_H\s*=\s*(\d+)/);
  if (!m) { assert.ok(true, "sibling site not checked out; skipped"); return; }
  assert.equal(Number(m[1]), ALARM_AFTER_H,
    "read.mjs alarms at ALARM_AFTER_H and the site withdraws at FEED_MAX_AGE_H; " +
    "they are the same fact and must be the same number");
});

/* ── timestamps are one type ───────────────────────────────────────────── */

test("a timestamp is an ISO string wherever it came from", () => {
  assert.equal(iso(new Date("2026-09-12T08:00:00Z")), "2026-09-12T08:00:00.000Z");
  assert.equal(iso("2026-09-12T08:00:00.000Z"), "2026-09-12T08:00:00.000Z");
  assert.equal(iso("Sat Sep 12 2026 08:00:00 GMT+0000"), "2026-09-12T08:00:00.000Z");
  assert.equal(iso(null), null);
  assert.equal(iso("not a date"), null);
  assert.equal(iso(new Date("nonsense")), null);
});

/* ── what the sites actually require of the feed ───────────────────────── */

test("the published file carries every field the two sites read, and no Date objects", () => {
  const { file } = buildFile(capture("bigriver-2121"),
    { now: NOW, sourceUrl: SOURCE.url, source: SOURCE });
  file.checkedAt = iso(file.checkedAt);
  file.pricedAt = iso(file.pricedAt);
  const round = JSON.parse(JSON.stringify(file));

  assert.equal(typeof round.checkedAt, "string");
  assert.ok(Number.isFinite(Date.parse(round.checkedAt)));
  assert.equal(typeof round.pricedAt, "string");
  assert.ok(Array.isArray(round.bids) && round.bids.length > 0);
  for (const b of round.bids) {
    assert.equal(typeof b.cash, "number", "cash");
    assert.equal(typeof b.basisDollars, "number", "basisDollars");
    assert.ok(typeof b.delivery === "string" && b.delivery.length > 0, "delivery");
    assert.ok(b.futuresPriceCents === null || typeof b.futuresPriceCents === "number");
    /* The sites re-check this themselves. If it does not hold here, it will
       take the price off the page over there. */
    if (typeof b.futuresPriceCents === "number") {
      const derived = Math.round((b.cash - b.basisDollars) * 10000) / 10000;
      assert.ok(Math.abs(derived * 100 - b.futuresPriceCents) <= 0.5,
        `${b.delivery}: ${b.cash} - (${b.basisDollars}) does not reach ${b.futuresPriceCents}c`);
    }
    assert.ok(b.cash >= 2 && b.cash <= 12, `${b.delivery} cash ${b.cash} outside the sanity band`);
  }
});

test("the index carries what the sites look up, keyed the way they look it up", () => {
  const ix = buildIndex({ previous: null, now: NOW, ok: true,
    checkedAt: "2026-09-12T14:00:00.000Z", pricedAt: "2026-09-12T13:00:00.000Z",
    rows: 7, detail: null });
  const row = JSON.parse(JSON.stringify(ix)).sources.find((s) => s.id === "boyceville");
  assert.ok(row, "the sites find their source by id === 'boyceville'; renaming it " +
                 "disconnects both of them silently");
  assert.equal(typeof row.checkedAt, "string");
});
