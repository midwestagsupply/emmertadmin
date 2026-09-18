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
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildFile, isRefusal } from "../lib/board.mjs";
import { looksLikeShell, fetchBoard, buildIndex, alarm, iso,
         ALARM_AFTER_H, FETCH_ATTEMPTS } from "../scripts/read.mjs";
import { ROUTE_BUDGET_MS } from "../lib/routes.mjs";

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

/* THE GUARD WENT AFTER THE THING IT GUARDED -- 2026-09-12, live.
 *
 * This read badgergrain's file and THEN checked whether it had found anything:
 *
 *     const site = readFileSync(join(ROOT, "..", "badgergrain", ...));
 *     const m = site.match(...);
 *     if (!m) { assert.ok(true, "sibling site not checked out; skipped"); return; }
 *
 * readFileSync throws ENOENT before that line is ever reached. It passed here
 * because the two sites happened to be sitting beside this repository; on a
 * GitHub runner they are not. read.yml runs this file as its first step, so the
 * FIRST live pass of the new reader failed at the gate, never read their board,
 * and the feed sat at the seeded timestamp until it went cold.
 *
 * Exactly the same shape as the WASDE selftest earlier the same day: a check
 * placed after the return it was meant to precede. Look for it.
 *
 * WHERE THE SITES ACTUALLY ARE. test.yml checks them out into `.sites/` and
 * passes SITE_REPOS, which is where this comparison genuinely runs. read.yml
 * checks out nothing but this repository -- deliberately, because the whole
 * point of the mirror is that reading Boyceville depends on no other repo. So
 * this looks in both places and skips, loudly and without throwing, when
 * neither is there. */
function siteMaxAgeH() {
  const roots = [
    ...(process.env.SITE_REPOS ? [join(process.env.SITE_REPOS, "badgergrain")] : []),
    join(ROOT, "..", "badgergrain"),
  ];
  for (const r of roots) {
    let src;
    try { src = readFileSync(join(r, "tools", "update-prices.mjs"), "utf8"); }
    catch { continue; }
    const m = src.match(/const FEED_MAX_AGE_H\s*=\s*(\d+)/);
    if (m) return Number(m[1]);
    return null;   // found the file and not the constant -- that IS a failure
  }
  return undefined; // not checked out beside us; nothing to compare
}

test("the alarm threshold is the sites' withdrawal threshold", () => {
  /* If these two ever drift, either the sites go dark with nobody told, or an
     issue is opened about a price that is still on the page. */
  assert.equal(ALARM_AFTER_H, 4);
  const h = siteMaxAgeH();
  if (h === undefined) {
    console.log("    (skipped: no badgergrain beside this repo and no SITE_REPOS. " +
                "test.yml checks the sites out and runs this for real.)");
    return;
  }
  assert.notEqual(h, null, "badgergrain/tools/update-prices.mjs no longer declares FEED_MAX_AGE_H");
  assert.equal(h, ALARM_AFTER_H,
    "read.mjs alarms at ALARM_AFTER_H and the site withdraws at FEED_MAX_AGE_H; " +
    "they are the same fact and must be the same number");
});

test("AND IT DOES NOT THROW WHEN THEY ARE NOT THERE", () => {
  /* The fix, tested directly rather than by inspection. Point the lookup at a
     directory that does not exist and it must come back "nothing to compare",
     not ENOENT. This is the whole difference between the gate skipping a
     cross-repo check on a runner and the price read failing. */
  const saved = process.env.SITE_REPOS;
  process.env.SITE_REPOS = join(ROOT, "no-such-directory-anywhere");
  try {
    let out, threw = null;
    try { out = siteMaxAgeH(); } catch (e) { threw = e; }
    assert.equal(threw, null, "the gate threw instead of skipping: " + (threw && threw.message));
    /* undefined when nothing is beside us either; a number when it is. Both are
       fine. Throwing is not. */
    assert.ok(out === undefined || typeof out === "number", String(out));
  } finally {
    if (saved === undefined) delete process.env.SITE_REPOS; else process.env.SITE_REPOS = saved;
  }
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

/* ── pricedAt IS THEIRS ─────────────────────────────────────────────────── */

test("a pass that finds no move does not claim their board just moved", async () => {
  /* Found live, 2026-09-12 13:35 CT, an hour after the mirror went up:
     data/boyceville.json said their board last moved at 7:51am and
     data/index.json said 1:25pm, off the same pass. buildFile stamps pricedAt
     with `now`, and the carry-forward only ran inside the branch that writes
     the feed file -- so every quiet pass handed buildIndex the wrong answer.

     THE FIRST VERSION OF THIS TEST PASSED WITH THE BUG STILL IN. It ran
     against the committed data/boyceville.json, which holds 11 rows while the
     fixture holds 7 -- so every pass looked like a price move, the quiet path
     was never reached, and the assertion held for the wrong reason. Mutation
     testing caught that; nothing else would have. It now builds the quiet
     state on purpose, in a temp directory. */
  const { run } = await import("../scripts/read.mjs");
  const html = readFileSync(join(ROOT, "fixtures/bigriver-2121.html"), "utf8");
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  const dir = mkdtempSync(join(tmpdir(), "quiet-"));
  const feedPath = join(dir, "boyceville.json");
  const indexPath = join(dir, "index.json");
  const at = (t) => ({ now: new Date(t), fetchImpl, log: () => {}, wait: async () => {},
                       feedPath, indexPath, dataDir: dir });

  /* 08:00 -- nothing on file, so this pass IS when we first saw the board. */
  const first = await run(at("2026-09-13T08:00:00Z"));
  const THEIRS = "2026-09-13T08:00:00.000Z";
  assert.equal(first.file.pricedAt, THEIRS);
  assert.equal(first.index.sources[0].pricedAt, THEIRS);
  assert.ok(first.wroteFeed, "the first pass must write the feed file");

  /* 08:10 -- the same board, unchanged. Their board has not moved since 08:00,
     whatever our clock says, and no heartbeat is due for another six hours. */
  const second = await run(at("2026-09-13T08:10:00Z"));
  assert.equal(second.wroteFeed, false, "a quiet pass must not rewrite the feed file");
  assert.equal(second.file.pricedAt, THEIRS,
    "pricedAt is THEIRS -- the last time their board showed something different");
  assert.equal(second.index.sources[0].pricedAt, THEIRS,
    "data/index.json claimed their board moved on a pass that found no change");
  assert.equal(second.index.sources[0].checkedAt, "2026-09-13T08:10:00.000Z",
    "checkedAt IS ours and must advance -- the two clocks are different questions");

  /* And what is on disk still says 08:00, so the two files agree. */
  const onDisk = JSON.parse(readFileSync(feedPath, "utf8"));
  assert.equal(onDisk.pricedAt, THEIRS);
  const ixDisk = JSON.parse(readFileSync(indexPath, "utf8"));
  assert.equal(ixDisk.sources[0].pricedAt, onDisk.pricedAt,
    "the feed file and the index disagree about when their board last moved");
});

test("and a pass that DOES find a move stamps it", async () => {
  const { run } = await import("../scripts/read.mjs");
  const dir = mkdtempSync(join(tmpdir(), "moved-"));
  const feedPath = join(dir, "boyceville.json"), indexPath = join(dir, "index.json");
  const serve = (name) => async () => ({ ok: true, status: 200,
    text: async () => readFileSync(join(ROOT, "fixtures", name + ".html"), "utf8") });

  await run({ now: new Date("2026-09-13T08:00:00Z"), fetchImpl: serve("bigriver-2121"),
              log: () => {}, wait: async () => {}, feedPath, indexPath, dataDir: dir });
  /* A different board: the seven-column capture, different rows. */
  const moved = await run({ now: new Date("2026-09-13T09:00:00Z"),
              fetchImpl: serve("bigriver-2121-lasttrade"),
              log: () => {}, wait: async () => {}, feedPath, indexPath, dataDir: dir });

  assert.ok(moved.wroteFeed, "a real move must be written");
  assert.equal(moved.file.pricedAt, "2026-09-13T09:00:00.000Z",
    "the rows changed, so THIS pass is when their board moved");
  assert.equal(moved.index.sources[0].pricedAt, moved.file.pricedAt);
});

/* ── THE ALARM IS WIRED TO THE ALARM ────────────────────────────────────── */

test("the issue is filed on the alarm, never on 'a step went red'", () => {
  /* `if: failure()` fires when ANY step fails. On 2026-09-12 the gate failed
     -- a test reading a repository that is not on a runner -- and the workflow
     filed an issue announcing that both sites had withdrawn the price, at a
     moment when the feed was fine. An alarm that cries wolf gets ignored. */
  const yml = readFileSync(join(ROOT, ".github/workflows/read.yml"), "utf8");
  const steps = yml.split(/\n      - name: /).slice(1);
  const find = (frag) => steps.find((s) => s.startsWith(frag));

  const issue = find("Say so, once, if the sites are about to go dark");
  assert.ok(issue, "the issue step is gone");
  const cond = (issue.match(/^\s*if: (.+)$/m) || [])[1] || "";
  assert.match(cond, /steps\.read\.outputs\.alarm/,
    "the issue must be gated on the reader's own alarm, not on the run's colour");
  assert.doesNotMatch(cond, /^\s*failure\(\)/, "back to firing on any red step");

  /* And the health file has to survive a reader that exited 1 -- which is
     exactly the pass whose fails/failingSince/detail somebody needs. */
  const commit = find("Commit what changed");
  assert.match((commit.match(/^\s*if: (.+)$/m) || [])[1] || "", /always\(\)/,
    "a four-hour-cold pass writes its health file and then loses it with the runner");

  /* The reader is allowed to exit 1 without skipping those two steps. */
  const read = find("Read their board");
  assert.match(read, /continue-on-error: true/);
  assert.match(read, /set -o pipefail/,
    "without pipefail the exit code is tee's, which is always 0");
});

test("the reader tells the workflow the alarm as a fact, not as an exit code", async () => {
  /* A crash must not read as an alarm: the feed may be perfectly warm and the
     script simply fell over. */
  const src = readFileSync(join(ROOT, "scripts/read.mjs"), "utf8");
  const tail = src.slice(src.indexOf("if (import.meta.url"));
  assert.match(tail, /emit\("alarm", r\.alarm \? "1" : "0"\)/);
  assert.match(tail.slice(tail.indexOf(".catch")), /emit\("alarm", "0"\)/,
    "a crash writes alarm=0; it is not evidence about their board");
});

/* ── THE PASS HAS TO LEAVE A MARK, OR THE DELIVERY NUMBER IS A GUESS ─────── */

/* WHAT THESE PIN AND WHY, 2026-09-18.
 *
 * read.yml and watchdog.yml both commit with `git diff --staged --quiet` and
 * an early exit, so a pass that changed no file on disk commits nothing and
 * leaves no trace anywhere. Everything anybody knows about whether this
 * repository is being run at all is counted off those commits:
 *
 *     206 passes landed against 846 asked, 24.4%, over the six days to
 *     2026-09-18, with eight gaps past the four hours at which both sites
 *     withdraw the price.
 *
 * That count is only true while EVERY pass rewrites data/index.json. It does,
 * because buildIndex stamps `generated` and `attemptedAt` with the pass's own
 * clock whatever happened -- but nothing was stopping a future tidy-up from
 * making the index idempotent on a quiet market, and the symptom of that would
 * be a commit history with no gaps in it because it had nothing in it. */

test("every pass rewrites data/index.json, so every landed run commits", async () => {
  const { run } = await import("../scripts/read.mjs");
  const dir = mkdtempSync(join(tmpdir(), "heartbeat-"));
  const feedPath = join(dir, "boyceville.json"), indexPath = join(dir, "index.json");
  const board = readFileSync(join(ROOT, "fixtures/bigriver-2121.html"), "utf8");
  const ok = async () => ({ ok: true, status: 200, text: async () => board });
  const down = async () => ({ ok: false, status: 503, text: async () => "" });

  const pass = async (mins, fetchImpl) => {
    await run({ now: new Date(Date.parse("2026-09-18T12:00:00Z") + mins * 60000),
                fetchImpl, log: () => {}, wait: async () => {},
                feedPath, indexPath, dataDir: dir });
    return readFileSync(indexPath, "utf8");
  };

  /* The quiet market: their board has not moved, so the FEED file must not be
     rewritten -- that is the heartbeat's whole point -- and the index must be,
     every single time, or those passes commit nothing and are invisible. */
  const a = await pass(0, ok);
  const b = await pass(1, ok);
  const c = await pass(2, ok);
  assert.notEqual(a, b, "two quiet passes wrote an identical index; the second one commits nothing");
  assert.notEqual(b, c, "two quiet passes wrote an identical index; the third one commits nothing");

  /* And a failed pass, which is the pass whose fails, failingSince and detail
     most need to reach the repository. */
  const d = await pass(3, down);
  const e = await pass(4, down);
  assert.notEqual(c, d, "a failed pass wrote an identical index; the failure commits nothing");
  assert.notEqual(d, e, "two failed passes wrote an identical index; the second commits nothing");

  /* Named, not just "the bytes differ": these two fields are the reason, and a
     test that only compares strings would pass on an index that changed for
     some unrelated reason and go quiet the day these two were dropped. */
  const last = JSON.parse(e);
  assert.equal(last.generated, "2026-09-18T12:04:00.000Z",
    "`generated` no longer carries this pass's clock");
  assert.equal(last.sources[0].attemptedAt, "2026-09-18T12:04:00.000Z",
    "`attemptedAt` no longer carries this pass's clock");
  /* checkedAt held at the last GOOD read, two failed passes back. The two
     clocks are the safety mechanism and this is the cheapest place to see it. */
  assert.equal(last.sources[0].checkedAt, "2026-09-18T12:02:00.000Z",
    "checkedAt moved on a failed pass, which is how a frozen price publishes for ever");

  /* The feed file, meanwhile, was written once and left alone. */
  assert.equal(JSON.parse(readFileSync(feedPath, "utf8")).checkedAt,
    "2026-09-18T12:00:00.000Z",
    "the feed file was rewritten on a quiet pass; the heartbeat is six hours, not one minute");
});

test("BOTH workflows exit early when nothing is staged, which is what makes the count exact", () => {
  /* The other half of the test above. If either file committed unconditionally,
     a commit would stop meaning "a pass ran" and start meaning "a job started",
     and the two differ by every run whose test gate failed. */
  for (const f of ["read.yml", "watchdog.yml"]) {
    const yml = readFileSync(join(ROOT, ".github/workflows", f), "utf8");
    assert.match(yml, /git diff --staged --quiet; then echo "Nothing changed\."; exit 0/,
      `${f} no longer exits early on an empty stage`);
    assert.match(yml, /git add data\/boyceville\.json data\/index\.json/,
      `${f} no longer stages data/index.json, so a pass with no price move leaves no trace`);
  }
});

/* ── THE TEN MINUTES COMES FROM OUTSIDE GITHUB ──────────────────────────── */

test("read.yml can be dispatched, because that is what actually delivers the ten minutes", () => {
  /* GitHub cron delivered 24.4% of this file's asked fires over the six days to
     2026-09-18. A Cloudflare Worker in dnilgis/bids now dispatches it every ten
     minutes instead, and the workflow-dispatch API returns 404 for a workflow
     that does not declare `workflow_dispatch` -- the SAME 404 an unscoped token
     returns. So deleting this line would look, from the Worker's side, exactly
     like a token problem, and the only other sign would be four-hour gaps. */
  const yml = readFileSync(join(ROOT, ".github/workflows/read.yml"), "utf8");
  const triggers = yml.slice(yml.indexOf("\non:"), yml.indexOf("\npermissions:"));
  assert.match(triggers, /^\s*workflow_dispatch:\s*$/m,
    "read.yml cannot be dispatched, so the external scheduler cannot start it");

  /* The cron stays too. It is the fallback for the day the Worker is down, and
     one pass in four is worth having. */
  assert.match(triggers, /- cron: "3,13,23,33,43,53 \* \* \* \*"/,
    "the fallback cron is gone; if the Worker stops, nothing else asks");
});

test("the watchdog's threshold stays inside the window the sites withdraw on", () => {
  /* 45 minutes against a four-hour withdrawal. The margin is what lets a cold
     spell survive this file twice over before a farmer sees anything, and it is
     the reason the threshold is not tuned down when covers look slow: measured
     over the six days to 2026-09-18 this file ended 16 of the 40 gaps that ran
     past 45 minutes, and the missing 24 were fires that never happened, which a
     smaller threshold would not have changed. */
  const yml = readFileSync(join(ROOT, ".github/workflows/watchdog.yml"), "utf8");
  const mins = Number((yml.match(/steps\.age\.outputs\.mins >= (\d+)/) || [])[1]);
  assert.ok(Number.isFinite(mins), "the watchdog's threshold is no longer a number in the file");
  assert.ok(mins * 2 <= ALARM_AFTER_H * 60,
    `the watchdog covers at ${mins} minutes, so two missed covers reach ` +
    `${(mins * 2) / 60}h against the ${ALARM_AFTER_H}h the sites withdraw at`);

  /* And it must still be able to actually read, not just alarm -- eight of the
     16 covers in the week to 2026-09-18 were this file putting a price on both
     websites, not this file complaining. */
  assert.match(yml, /node scripts\/read\.mjs \| tee/,
    "the watchdog no longer reads their board; it would only be an alarm");
  assert.match(yml, /\(watchdog\)/,
    "the watchdog's commits are no longer tagged, so covers cannot be counted apart from ordinary passes");
});

test("the watchdog's minutes stay clear of everything else that fires", () => {
  /* :08 and :38, clear of read.yml's 3,13,23,33,43,53, clear of watch-live's
     :23, and clear of :00. They share a concurrency group so a collision only
     queues -- but a queued watchdog is one that reads a board somebody else
     just read, which is a wasted pass, not a cover. */
  const mins = (f) => {
    const y = readFileSync(join(ROOT, ".github/workflows", f), "utf8");
    return [...y.matchAll(/- cron: "([^"]+)"/g)]
      .flatMap((m) => m[1].trim().split(/\s+/)[0].split(","))
      .filter((x) => /^\d+$/.test(x)).map(Number);
  };
  const wd = mins("watchdog.yml");
  assert.deepEqual(wd, [8, 38], "the watchdog's minutes moved");
  for (const m of wd) {
    assert.notEqual(m, 0, "the watchdog fires at :00, the busiest minute on the platform");
    assert.ok(!mins("read.yml").includes(m), `the watchdog fires at :${m}, the same minute as read.yml`);
    assert.ok(!mins("watch-live.yml").includes(m), `the watchdog fires at :${m}, the same minute as watch-live.yml`);
  }
});

/* ── the trigger, which is the layer that decides whether any of the rest
      happens at all ──────────────────────────────────────────────────────

   MEASURED 2026-09-12 17:58Z TO 2026-09-18 14:54Z, 845 ten-minute slots, off
   the commits each repository makes on essentially every run it gets:

       midwestagsupply/emmertadmin       186 slots   22.0%
       midwestagsupply/badgergrain       479 slots   56.7%
       midwestagsupply/midwestcommodity  479 slots   56.7%

   One account, one organisation, the same six fires an hour, the same week.
   Whatever drops this repository's fires does not drop theirs, so the sites
   start read.yml as well as rendering what it writes. These tests guard the
   three ways that arrangement can quietly stop working: the door closing, the
   poke turning into a loop, and a wedged pass holding the slot. */

const READ_YML = readFileSync(join(ROOT, ".github/workflows/read.yml"), "utf8");
const WATCHDOG_YML = readFileSync(join(ROOT, ".github/workflows/watchdog.yml"), "utf8");

test("there are TWO doors into read.yml, and the second is not the sites' own event", () => {
  /* workflow_dispatch needs a token with Actions write; repository_dispatch
     needs Contents write. A site cannot tell from a 403 or a 404 which scope
     it was given, so it tries both and one of them has to be here. */
  const triggers = READ_YML.slice(READ_YML.indexOf("\non:"), READ_YML.indexOf("\npermissions:"));
  assert.match(triggers, /^\s*workflow_dispatch:\s*$/m,
    "read.yml cannot be dispatched by workflow; the sites' first door is shut");
  assert.match(triggers, /^\s*repository_dispatch:\s*\n\s*types: \[read-now\]\s*$/m,
    "read.yml has no repository_dispatch door, so a Contents-only token cannot start it");
  /* price-moved is what the SITES listen for. If this repository ever listened
     for it too, anything that forwarded an event the wrong way would loop. */
  assert.doesNotMatch(triggers, /types: \[[^\]]*price-moved/,
    "read.yml listens for price-moved, which is the sites' own event; that is a loop waiting to happen");
});

test("a wedged pass dies inside its step, not at the job ceiling", () => {
  /* WHY THE STEP CEILINGS EXIST AND THE JOB CEILING IS NOT ENOUGH. A job
     ceiling kills whatever is running when the clock runs out, which is the
     LAST step, not the stuck one -- so a read that hangs would take the commit
     of the health file down with it, which is the exact loss continue-on-error
     and always() were added to prevent.

     Two minutes on the read is measured against lib/routes.mjs's own
     ROUTE_BUDGET_MS, an absolute deadline shared by every route. A read still
     going at twice that is stuck, not slow. */
  const budgetMin = ROUTE_BUDGET_MS / 60000;
  for (const [name, yml] of [["read.yml", READ_YML], ["watchdog.yml", WATCHDOG_YML]]) {
    const job = Number((yml.match(/^    timeout-minutes: (\d+)$/m) || [])[1]);
    assert.ok(Number.isFinite(job), `${name} has no job ceiling at all`);
    assert.ok(job <= 6, `${name}'s job ceiling is ${job} minutes; a pass is about ninety seconds`);

    const step = (label) => {
      const at = yml.indexOf(`- name: ${label}`);
      assert.ok(at > 0, `${name} no longer has a step called ${label}`);
      const block = yml.slice(at, at + 400);
      const m = block.match(/^\s+timeout-minutes: (\d+)$/m);
      assert.ok(m, `${name}'s "${label}" step has no ceiling of its own`);
      return Number(m[1]);
    };
    const read = step("Read their board");
    assert.ok(read > budgetMin,
      `${name} kills the read at ${read} min, inside routes.mjs's own ${budgetMin} min budget, ` +
      "so an ordinary slow pass would be killed as if it were stuck");
    assert.ok(read <= 3,
      `${name} gives the read ${read} minutes against a ${budgetMin}-minute budget; that is not fail-fast`);
    assert.ok(read < job, `${name}'s read may spend the whole job, leaving nothing for the commit`);
    assert.ok(step("Test the reader this pass is about to use") <= 2, `${name}'s gate ceiling is too loose`);
    assert.ok(step("Commit what changed") < job, `${name}'s commit may spend the whole job`);
  }
});

test("read.yml and watchdog.yml hold the shared group for the same length of time", () => {
  /* They run the same script under the same concurrency group. A ceiling that
     differed between them would mean the group was held for whichever number
     was larger, and the smaller one would be decoration. */
  const ceiling = (y) => (y.match(/^    timeout-minutes: (\d+)$/m) || [])[1];
  assert.equal(ceiling(READ_YML), ceiling(WATCHDOG_YML),
    "the two workflows that share `read-boyceville` no longer share a ceiling");
});

test("the sites are told when there is something to tell, not on every pass", () => {
  /* It used to be `if: steps.read.outcome == 'success'`, so every read started
     a run in each site whether or not anything had changed. That was 1.5 passes
     an hour. With the sites starting this workflow too it is about eight, and
     sixteen pointless site runs an hour is the persistent-server shape that
     cost dnilgis/bids two thirds of its coverage on 2026-08-27.

     COLD IS THE OTHER HALF AND IT IS THE ONE THAT STOPS A WRONG NUMBER. A site
     withdraws by RENDERING the withdrawal, so a site whose own cron has been
     dropped goes on showing a price this repository already knows is stale. */
  const at = READ_YML.indexOf("- name: Nudge both sites");
  assert.ok(at > 0, "the nudge step is gone");
  const block = READ_YML.slice(at, at + 400);
  assert.match(block, /steps\.news\.outputs\.moved == '1'/,
    "the nudge no longer asks whether their price moved");
  assert.match(block, /steps\.news\.outputs\.cold == '1'/,
    "the nudge no longer wakes the sites when the feed is going cold, so a site whose " +
    "own cron was dropped would keep a stale price on the page past four hours");
  assert.doesNotMatch(block, /if: steps\.read\.outcome == 'success'\s*$/m,
    "the nudge fires on every successful pass again");
  /* And the step that answers those two questions has to run BEFORE the commit
     stages anything, or there is nothing left to compare against. */
  assert.ok(READ_YML.indexOf("- name: Is there anything the sites need to know")
            < READ_YML.indexOf("- name: Commit what changed"),
    "the move check now runs after the commit, where data/boyceville.json always looks unchanged");
});

/* ── the sites' half of it ─────────────────────────────────────────────────

   Guarded from HERE and not from the sites, because this is the repository
   that depends on being poked. Same lookup as siteMaxAgeH above: SITE_REPOS
   when test.yml has checked them out, a sibling directory otherwise, and a
   loud skip when neither is there. A cross-repo check that throws is how the
   first live pass of this reader failed at the gate on 2026-09-12. */
function sitePrices(name) {
  const roots = [
    ...(process.env.SITE_REPOS ? [join(process.env.SITE_REPOS, name)] : []),
    join(ROOT, "..", name),
    join(ROOT, "..", "em", name),
  ];
  for (const r of roots) {
    try { return readFileSync(join(r, ".github/workflows/prices.yml"), "utf8"); }
    catch { continue; }
  }
  return undefined;
}

test("each site starts this reader, and does it before anything in it can fail", () => {
  let checked = 0;
  for (const name of ["badgergrain", "midwestcommodity"]) {
    const y = sitePrices(name);
    if (y === undefined) continue;
    checked++;
    assert.match(y, /actions\/workflows\/read\.yml\/dispatches/,
      `${name}/prices.yml no longer dispatches read.yml; this repository is back to its own 22%`);
    assert.match(y, /"event_type":"read-now"/,
      `${name}/prices.yml has no second door, so one token scope going stale takes the poke with it`);
    /* Before the checkout, so a broken build here cannot be why the board went
       unread. The board is what the four-hour withdrawal clock measures. */
    assert.ok(y.indexOf("- name: Start the reader") < y.indexOf("uses: actions/checkout"),
      `${name}/prices.yml pokes the reader after its checkout, so a bad checkout silences the poke`);
  }
  if (!checked) {
    console.log("    (skipped: no site repositories beside this one and no SITE_REPOS. " +
                "test.yml checks them out and runs this for real.)");
  }
});

test("THE SITES' POKE IS NOT A LOOP, which is the one way this design burns the account down", () => {
  /* This repository dispatches `price-moved` to the sites when the price moves.
     If a site run started by THAT also poked the reader, the chain is
     poke -> read -> price-moved -> poke -> read, unbounded, across three
     repositories, and it is the persistent-runner shape as well. The poke must
     happen only on the two events a clock or a person starts. */
  let checked = 0;
  for (const name of ["badgergrain", "midwestcommodity"]) {
    const y = sitePrices(name);
    if (y === undefined) continue;
    checked++;
    const at = y.indexOf("- name: Start the reader");
    assert.ok(at > 0, `${name}/prices.yml has no Start the reader step`);
    const cond = y.slice(at, at + 300).match(/^\s+if: (.+)$/m);
    assert.ok(cond, `${name}'s poke has no event condition at all, so a dispatch pokes back`);
    assert.match(cond[1], /github\.event_name == 'schedule'/,
      `${name}'s poke does not fire on the schedule, which is the whole point of it`);
    assert.doesNotMatch(cond[1], /repository_dispatch/,
      `${name}'s poke fires on repository_dispatch, which is the loop`);
    assert.doesNotMatch(cond[1], /\bpush\b/,
      `${name}'s poke fires on push, so a commit from the site starts a read that commits here`);
  }
  if (!checked) console.log("    (skipped: the site repositories are not beside this one.)");
});

test("the sites' market-hours cron covers 8am to 3pm Central on both sides of the clock change", () => {
  /* Cron is UTC. Central is UTC-5 from the second Sunday in March to the first
     Sunday in November and UTC-6 otherwise, so 8am-3pm Central is 13:00-20:00
     UTC in summer and 14:00-21:00 UTC in winter and no fixed set of UTC hours
     is exactly right all year. This COMPUTES the fire times rather than reading
     the expression, because reading a cron by eye is how two schedulers in
     dnilgis/bids ended up numbering the weekday differently. */
  const nthSunday = (y, m0, n) => {
    let c = 0;
    for (let d = 1; d <= 31; d++) {
      const x = new Date(Date.UTC(y, m0, d));
      if (x.getUTCMonth() !== m0) break;
      if (x.getUTCDay() === 0 && ++c === n) return x.getTime();
    }
    throw new Error("no such Sunday");
  };
  const offset = (t) => {
    const y = new Date(t).getUTCFullYear();
    return (t >= nthSunday(y, 2, 2) + 7 * 3600000 && t < nthSunday(y, 10, 1) + 6 * 3600000) ? -5 : -6;
  };
  let checked = 0;
  for (const name of ["badgergrain", "midwestcommodity"]) {
    const y = sitePrices(name);
    if (y === undefined) continue;
    checked++;
    const crons = [...y.matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1].trim().split(/\s+/));
    const mkt = crons.find((c) => c[1] !== "*");
    assert.ok(mkt, `${name} has no market-hours cron; every fire is spent evenly round the clock`);
    assert.equal(mkt[4], "1-5",
      `${name}'s market cron runs on days ${mkt[4]}; GitHub numbers Sunday 0, so weekdays are 1-5`);
    const [aH, bH] = mkt[1].split("-").map(Number);
    const mins = mkt[0].split(",").map(Number);

    /* Walk a whole year of Mondays-to-Fridays and check two things: every fire
       is a Central weekday, and every ten-minute slot of 8:00-15:00 Central on
       a weekday holds at least one asked fire. */
    let fires = 0, weekend = 0;
    const covered = new Set(), needed = new Set();
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 600000) {
      const u = new Date(t);
      const c = new Date(t + offset(t) * 3600000);
      const cMin = c.getUTCHours() * 60 + c.getUTCMinutes();
      const weekday = c.getUTCDay() >= 1 && c.getUTCDay() <= 5;
      const key = `${c.toISOString().slice(0, 10)}T${c.toISOString().slice(11, 16)}`;
      if (weekday && cMin >= 480 && cMin < 900) needed.add(key.slice(0, 14));
      const asked = u.getUTCHours() >= aH && u.getUTCHours() <= bH &&
                    mins.some((m) => Math.floor(m / 10) === Math.floor(u.getUTCMinutes() / 10)) &&
                    u.getUTCDay() >= 1 && u.getUTCDay() <= 5;
      if (!asked) continue;
      fires++;
      if (!weekday) weekend++;
      if (cMin >= 480 && cMin < 900) covered.add(key.slice(0, 14));
    }
    assert.ok(fires > 10000, `${name}'s market cron barely fires at all: ${fires} in a year`);
    assert.equal(weekend, 0,
      `${name}'s market cron put ${weekend} fires on a Central weekend; the UTC day wrapped`);
    const missed = [...needed].filter((k) => !covered.has(k));
    assert.deepEqual(missed.slice(0, 5), [],
      `${name}'s market cron leaves ${missed.length} ten-minute slots of the Central trading ` +
      `day unasked, the first at ${missed[0]}. The UTC hours do not cover both offsets.`);
  }
  if (!checked) console.log("    (skipped: the site repositories are not beside this one.)");
});

/* ── WHAT ONE RUN COSTS THEIR HOST, NOW THAT NOTHING RATIONS IT ─────────────
 *
 * MEASURED 2026-09-18, with the real scripts/read.mjs as a child process
 * against a local server that logged every hit and the manifest's URLs pointed
 * at it, thirteen routes raced:
 *
 *     healthy pass                              1 request     0.16s
 *     arranged URL answers after 8s            13 requests    1.68s
 *     arranged URL answers 503                  2 requests    1.68s
 *     every route answers 503                  39 requests    6.16s
 *     a host that accepts and never answers    13 requests   64.6s  (the deadline)
 *
 * There was briefly a per-run request ceiling, a counter file shared across the
 * reader's invocations, and a --primary-only re-read in the push-race loop. The
 * owner, who holds the arrangement with Big River, has said he does not want
 * the fallbacks throttled or limited. These pin that the three are gone and
 * have not come back wearing another name. */

/* The step that can invoke the reader more than once. Lifted out of the file
   rather than described, so a change to the loop breaks this and not a
   paraphrase of it. */
function commitStep(yml) {
  const lines = yml.split("\n");
  const at = lines.findIndex((l) => /^\s*- name: Commit what changed\s*$/.test(l));
  assert.ok(at > -1, "there is no Commit what changed step any more");
  let j = at;
  while (!/^\s*run: \|\s*$/.test(lines[j])) j++;
  const indent = lines[j].match(/^\s*/)[0].length + 2;
  const out = [];
  for (let k = j + 1; k < lines.length; k++) {
    if (lines[k].trim() === "") { out.push(""); continue; }
    if (lines[k].match(/^\s*/)[0].length < indent) break;
    out.push(lines[k].slice(indent));
  }
  return out.join("\n").trim();
}

test("nothing in either workflow rations the reader's requests to their host", () => {
  for (const [name, yml] of [["read.yml", READ_YML], ["watchdog.yml", WATCHDOG_YML]]) {
    assert.doesNotMatch(yml, /BOYCEVILLE_RUN_REQUESTS/,
      `${name} still sets a per-run request counter. The owner asked for no throttle; a `
    + `counter that caps a run is a throttle whatever it is called.`);
    assert.doesNotMatch(yml, /--primary-only/,
      `${name} still restricts a read to the arranged URL. The push-race re-read may use `
    + `the full ladder.`);
  }
  const src = readFileSync(join(ROOT, "scripts/read.mjs"), "utf8");
  for (const gone of ["RUN_REQUEST_CEILING", "runBudget", "primaryOnly", "--primary-only"])
    assert.ok(!src.includes(gone),
      `scripts/read.mjs still carries ${gone}; the gate was removed, not renamed`);
  const lib = readFileSync(join(ROOT, "lib/routes.mjs"), "utf8");
  for (const gone of ["ALIAS_AFTER_FAILS", "BREAK_GLASS_AFTER_H", "openDoors", "class Ceiling"])
    assert.ok(!lib.includes(gone),
      `lib/routes.mjs still carries ${gone}; the earned ladder was removed, not renamed`);
});

test("the push-race re-read is an ordinary pass, with every route available to it", () => {
  /* Its job is to put this pass's read on top of a new HEAD. It used to be
     restricted to the arranged URL so a rejected push could not knock on five
     more doors. If the arranged URL stopped answering between the first read
     and the rebase, the re-read should find the board the same way the first
     one would have. */
  for (const [name, yml] of [["read.yml", READ_YML], ["watchdog.yml", WATCHDOG_YML]]) {
    const step = commitStep(yml);
    const reads = [...step.matchAll(/node scripts\/read\.mjs[^\n|]*/g)].map((m) => m[0]);
    assert.ok(reads.length > 0, `${name}: the push-race loop no longer re-reads at all`);
    for (const r of reads)
      assert.doesNotMatch(r, /--primary-only|--[a-z-]*only/,
        `${name}'s push-race loop still restricts the re-read: "${r.trim()}"`);
  }
});

test("and it only re-reads at all when the commits it lost to moved the feed", () => {
  /* read.yml and watchdog.yml share the concurrency group, so the commits this
     loop loses to are almost never another reader's -- they are staff updates
     and site rebuilds, which do not touch data/. Rebasing onto one of those
     needs this pass's two files put back, and no request to their host. That is
     not a throttle: it is not asking a question whose answer we already have. */
  for (const [name, yml] of [["read.yml", READ_YML], ["watchdog.yml", WATCHDOG_YML]]) {
    const step = commitStep(yml);
    assert.match(step, /git diff --quiet "\$WAS" "origin\/\$BR" -- data\/boyceville\.json data\/index\.json/,
      `${name} no longer asks whether the incoming commits touched the feed, so it either `
    + `re-reads on every race or restores over somebody else's published price`);
    assert.match(step, /cp "\$KEEP\/boyceville\.json" "\$KEEP\/index\.json" data\//,
      `${name} no longer puts this pass's own read back after the reset`);
  }
});

test("the two loops are the same loop, so a watchdog run costs their host what a read does", () => {
  const read = commitStep(READ_YML);
  const watch = commitStep(WATCHDOG_YML).replace(" (watchdog)", "");
  assert.equal(read, watch,
    "read.yml and watchdog.yml no longer share the commit loop; they run the same reader "
  + "against the same host and a difference here is a second cost nobody measured");
});
