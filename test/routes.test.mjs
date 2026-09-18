/* MORE THAN ONE WAY TO THE SAME NUMBER, AND NONE OF THEM A WAY ROUND A CHECK.
 *
 * scripts/read.mjs had one route to the price and asked it three times with
 * the same method and the same headers. These pin what replaced it:
 *
 *   - the routes are RACED, not walked: the arranged URL starts first and gets
 *     a head start to itself, and if it has not answered every other route
 *     starts at once
 *   - an ordinary day is still exactly one request through the arranged URL
 *   - a route that loses the race is ABORTED, and the abort really cancels the
 *     request rather than leaking it
 *   - nothing is gated: no failure count, no hour of failing, no per-run
 *     request ceiling, no primary-only pass
 *   - a fallback's number goes through the SAME guards, so a board that fails
 *     the identity check is refused rather than published
 *   - two routes that disagree about the number is a refusal, not a vote
 *   - everything failing still holds the last good file byte for byte and
 *     still does not advance checkedAt
 *
 * The routes themselves live in sources/boyceville.json and these tests run
 * against that real list, not against one written here -- a test that invents
 * its own routes proves nothing about the ones that ship.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { run, buildIndex } from "../scripts/read.mjs";
import { routesFor, disagreement, describeRoutes, raceRoutes, RouteFailed,
         TRUST, TIERS, aliasOrThrow, HEAD_START_MS, ROUTE_BUDGET_MS, ATTEMPTS }
  from "../lib/routes.mjs";
import { ALARM_AFTER_H } from "../scripts/read.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = JSON.parse(readFileSync(join(ROOT, "sources/boyceville.json"), "utf8"));
const BOARD = readFileSync(join(ROOT, "fixtures/bigriver-2121.html"), "utf8");

const ROUTES = routesFor(SOURCE);
const PRIMARY = ROUTES[0].url;
const SECOND = ROUTES[1].url;

/* Their board with August's corn a dollar high, and their own basis and
   futures cells recomputed so it is internally consistent: 5.0750 - (-0.5200)
   = 5.595 = 559-4. Every guard except the magnitude rail is satisfied by it,
   which is the point -- see the max-move note in lib/board.mjs. */
const GLITCHED = BOARD
  .replace("<li class='c2'>4.0750</li>", "<li class='c2'>5.0750</li>")
  .replace("<li class='c4'>459-4</li>", "<li class='c4'>559-4</li>");

/* Their board with one cash cell moved a dime and nothing else touched, so
   cash - basis no longer reaches their own quote on that row. */
const IDENTITY_BROKEN = BOARD.replace("<li class='c2'>4.0750</li>",
                                      "<li class='c2'>4.1750</li>");

const ok = (html) => ({ ok: true, status: 200, text: async () => html });
const dead = { ok: false, status: 503, text: async () => "" };

/* A fetch that answers per URL and records, in order, every URL it was asked.
 *
 * `slow` holds a URL open for a while, and honours the abort signal the racer
 * hands it -- which is the only way a test can tell a cancelled request from
 * one that was merely ignored. */
function serve(map, { slow = {}, onAbort = () => {} } = {}) {
  const asked = [];
  const aborted = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    asked.push(u);
    const delay = slow[u] ?? 0;
    if (delay) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, delay);
        opts.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          aborted.push(u);
          onAbort(u);
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        }, { once: true });
      });
    }
    const body = map[u];
    if (body === undefined) return dead;
    return ok(body);
  };
  return { fetchImpl, asked, aborted };
}

function scratch(seedFeed) {
  const dir = mkdtempSync(join(tmpdir(), "routes-"));
  const feedPath = join(dir, "boyceville.json");
  const indexPath = join(dir, "index.json");
  if (seedFeed) writeFileSync(feedPath, seedFeed);
  return { dir, feedPath, indexPath };
}

/* A short head start by default, so a test that is about the racing does not
   spend a second and a half of real time proving it. The shipped number is
   pinned separately, below. */
const pass = (at, fetchImpl, paths, extra = {}) =>
  run({ now: new Date(at), fetchImpl, log: () => {}, wait: async () => {},
        feedPath: paths.feedPath, indexPath: paths.indexPath, dataDir: paths.dir,
        headStartMs: 30, ...extra });

/* ── the shipped list itself ────────────────────────────────────────────── */

test("the manifest ships more than one route, the arranged URL first", () => {
  assert.ok(ROUTES.length > 1, "there is still only one door");
  assert.equal(ROUTES[0].url, SOURCE.url,
    "the arranged URL is not first; it is the one we know serves this board");
  assert.equal(ROUTES[0].trust, "primary");
});

test("every route records the evidence for it, and none of them claims to be checked", () => {
  /* bigriverbids.com could not be reached when these were derived, so not one
     fallback has been confirmed against the real host. A route presented as
     known-good would be a URL somebody invented wearing a fact's clothes. */
  for (const r of ROUTES) {
    assert.ok(r.why && r.why.length > 40, `${r.url} records no evidence worth reading`);
    assert.ok(TRUST.includes(r.trust), `${r.url} has trust ${r.trust}`);
    assert.doesNotMatch(r.why, /known.good|confirmed against|verified against the host/i,
      `${r.url} describes itself as checked against their host, which nothing has been`);
  }
  assert.equal(new Set(ROUTES.map((r) => r.url)).size, ROUTES.length,
    "the same URL twice is not a second way in");
});

test("inferred routes start after verified ones, never before", () => {
  const rank = ROUTES.map((r) => TRUST.indexOf(r.trust));
  assert.deepEqual(rank, [...rank].sort((a, b) => a - b),
    "an inferred route is ordered before a verified one");
});

test("a route with no evidence, or one claiming to be the primary, is rejected outright", () => {
  assert.throws(() => routesFor({ url: "https://a.test/x",
    routes: [{ url: "https://a.test/y", trust: "verified" }] }), /records no evidence/);
  assert.throws(() => routesFor({ url: "https://a.test/x",
    routes: [{ url: "https://a.test/y", trust: "primary", why: "because" }] }), /one primary/);
  assert.throws(() => routesFor({ url: "https://a.test/x",
    routes: [{ url: "https://a.test/y", trust: "probably", why: "because" }] }), /must be one of/);
});

/* ── an ordinary day is exactly the day it was before ───────────────────── */

test("a healthy pass asks ONE door and publishes the same bytes it always did", async () => {
  const paths = scratch();
  const { fetchImpl, asked } = serve({ [PRIMARY]: BOARD });
  const r = await pass("2026-09-18T12:00:00Z", fetchImpl, paths);

  assert.equal(asked.length, 1,
    "a healthy pass asked their site more than once: " + asked.join(", "));
  assert.equal(asked[0], PRIMARY);
  assert.equal(r.via.trust, "primary");
  assert.equal(r.file.source.url, SOURCE.url, "the published record names the arranged URL");
  assert.equal(r.tried.length, ROUTES.length - 1);
  for (const t of r.tried)
    assert.match(t.why, /^not started: an earlier route had already answered$/,
      `${t.url} was started on a pass the arranged URL answered`);
  assert.equal(r.index.sources[0].via, SOURCE.url);
  assert.deepEqual(r.index.sources[0].reconstructed, [],
    "an ordinary pass reports a derived figure it did not derive");
});

/* ── THE RACE ───────────────────────────────────────────────────────────── */

test("a primary that has gone quiet does not hold the pass: every other route starts", async () => {
  /* The whole point of racing. The arranged URL is answering, eventually; the
     pass must not sit behind it for eight seconds when the board is sitting on
     twelve other doors. */
  const paths = scratch();
  const { fetchImpl, asked, aborted } = serve(
    Object.fromEntries(ROUTES.map((r) => [r.url, BOARD])),
    { slow: { [PRIMARY]: 5000 } });
  const t0 = Date.now();
  const r = await pass("2026-09-18T12:00:00Z", fetchImpl, paths);
  const ms = Date.now() - t0;

  assert.ok(r.file, "nothing was read although twelve routes were serving the board");
  assert.notEqual(r.via.url, PRIMARY, "the pass waited for the primary anyway");
  assert.ok(ms < 2000, `the pass took ${ms}ms behind a primary that takes 5000ms`);
  assert.equal(asked.length, ROUTES.length,
    "the other routes were not all started: " + asked.length);
  assert.deepEqual(aborted, [PRIMARY],
    "the primary was left running after another route won; an abandoned request that is "
  + "not cancelled goes on costing their host a 283 KB page nobody will read");
});

test("the head start is what keeps an ordinary day at one request", async () => {
  /* A primary that answers INSIDE the head start wins alone. The same board on
     every route, so if a fallback is started at all it will answer and the
     count shows it. */
  const paths = scratch();
  const { fetchImpl, asked } = serve(
    Object.fromEntries(ROUTES.map((r) => [r.url, BOARD])),
    { slow: { [PRIMARY]: 20 } });
  const r = await pass("2026-09-18T12:00:00Z", fetchImpl, paths, { headStartMs: 400 });
  assert.equal(asked.length, 1, "a primary answering inside the head start cost " +
    asked.length + " requests");
  assert.equal(r.via.url, PRIMARY);
});

test("the shipped head start is under a second and a half of every ten minutes", () => {
  /* It is the only gap there is, and it is the only thing that decides how
     long a bad day waits. Measured in the header of lib/routes.mjs. */
  assert.ok(HEAD_START_MS > 0, "the arranged URL gets no head start at all, so an "
    + "ordinary healthy pass opens thirteen doors");
  assert.ok(HEAD_START_MS <= 3000,
    `a ${HEAD_START_MS}ms head start makes a quiet primary cost the pass more than the `
  + `page is worth`);
  assert.ok(ROUTE_BUDGET_MS >= 10 * HEAD_START_MS,
    "the whole-pass deadline is not comfortably longer than one head start");
});

test("the deadline is a wall clock and not a route count", async () => {
  /* A host that accepts the connection and never answers. Nothing else stops
     this: node's fetch has no default timeout. */
  let t = 0;
  const failed = await raceRoutes({
    routes: ROUTES, clock: () => t, budgetMs: 1000, headStartMs: 0, log: () => {},
    attempt: async () => { t += 5000; throw new RouteFailed("took the lot"); },
  }).then(() => null, (e) => e);

  assert.ok(failed, "a pass that spent its whole deadline reported success");
  assert.equal(failed.tried.length, ROUTES.length,
    "the routes that never got off the ground were dropped rather than reported");
  assert.ok(failed.tried.some((t2) => /time budget/.test(t2.why)),
    "nothing in the record says the pass ran out of time");
});

/* ── THE SECOND DOOR ────────────────────────────────────────────────────── */

test("when the arranged URL fails, another route is used, and the record says which", async () => {
  const paths = scratch();
  const { fetchImpl, asked } = serve({ [SECOND]: BOARD });   // the primary answers 503
  const r = await pass("2026-09-18T12:00:00Z", fetchImpl, paths);

  assert.ok(r.file, "the price was sitting on the second route and the pass failed anyway");
  assert.equal(r.via.url, SECOND);
  assert.equal(r.file.count, 7, "the fallback published a different board");

  /* The published file names the door the number came through, so a silent
     migration to a fallback is visible in the committed diff. */
  assert.equal(r.file.source.url, SECOND);
  assert.equal(JSON.parse(readFileSync(paths.feedPath, "utf8")).source.url, SECOND);

  /* And the index says what happened to the primary, by name. */
  const row = r.index.sources[0];
  assert.equal(row.via, SECOND);
  assert.equal(row.health, "live");
  const primaryRow = row.routesTried.find((t) => t.url === PRIMARY);
  assert.match(primaryRow.why, /503/,
    "the primary's failure is not recorded, so nobody can tell why the door changed");
  assert.equal(asked[0], PRIMARY, "the arranged URL was not asked first");
});

test("a route change rewrites the feed even on a quiet market", async () => {
  /* priceChanged compares the bids and the count and nothing else, so without
     this the file would go on naming a door that stopped answering. */
  const paths = scratch();
  await pass("2026-09-18T12:00:00Z", serve({ [PRIMARY]: BOARD }).fetchImpl, paths);
  const before = readFileSync(paths.feedPath, "utf8");

  const r = await pass("2026-09-18T12:10:00Z", serve({ [SECOND]: BOARD }).fetchImpl, paths);
  assert.ok(r.wroteFeed, "the route changed and the published file was not rewritten");
  const after = readFileSync(paths.feedPath, "utf8");
  assert.notEqual(before, after);
  assert.equal(JSON.parse(after).source.url, SECOND);
  /* The price did not move, so their own clock must not have been touched. */
  assert.equal(JSON.parse(after).pricedAt, JSON.parse(before).pricedAt,
    "the route changing was recorded as their board moving");
});

/* ── A FALLBACK IS NOT A WAY ROUND A CHECK ──────────────────────────────── */

test("a fallback whose number fails the identity check is refused, not published", async () => {
  /* The primary is down and the second door serves a board whose cash cell no
     longer reaches its own quote. The whole reason for a second door is to
     keep reading THEIR number, so a second door that hands back a number the
     guards reject must fail like any other route. */
  const paths = scratch();
  const { fetchImpl } = serve({ [SECOND]: IDENTITY_BROKEN });
  const r = await pass("2026-09-18T12:00:00Z", fetchImpl, paths);

  assert.equal(r.file, null, "a board failing the identity check was published");
  assert.equal(r.wroteFeed, false);
  assert.equal(r.index.sources[0].health, "refused");
  assert.match(r.failure.message, /balance|cash - basis|identity/i);

  /* Named, in order, so whoever reads it can tell a dead site from a moved
     page from a broken parse. */
  const tried = r.index.sources[0].routesTried;
  assert.match(tried.find((t) => t.url === PRIMARY).why, /503/);
  assert.match(tried.find((t) => t.url === SECOND).why, /balance|cash - basis|identity/i);
});

test("every route in the list gets the same guards, not just the first two", async () => {
  /* Serve the broken board on EVERY route. Nothing may publish. */
  const paths = scratch();
  const all = Object.fromEntries(ROUTES.map((r) => [r.url, IDENTITY_BROKEN]));
  const { fetchImpl, asked } = serve(all);
  const r = await pass("2026-09-18T12:00:00Z", fetchImpl, paths);

  assert.equal(r.file, null, "one of the routes published a board that fails the identity check");
  assert.equal(new Set(asked).size, ROUTES.length, "not every route was tried");
  assert.equal(r.index.sources[0].routesTried.length, ROUTES.length);
  for (const t of r.index.sources[0].routesTried)
    assert.match(t.why, /balance|cash - basis|identity/i, `${t.url} failed for some other reason`);
});

/* ── NOTHING IS GATED ───────────────────────────────────────────────────── */

test("a first bad response reaches every route, on a pass that has never failed before", async () => {
  /* The fallbacks were briefly held behind a failure count and an hour of
     sustained failure, so one 503 cost three requests and nothing else. The
     owner has overruled that. There is no state anywhere that makes the first
     failure of the day cheaper than the hundredth. */
  const paths = scratch();
  const { fetchImpl, asked } = serve({});          // every door answers 503
  const r = await pass("2026-09-18T12:00:00Z", fetchImpl, paths);

  assert.equal(new Set(asked).size, ROUTES.length,
    "a first failure did not reach every door: " + [...new Set(asked)].join(", "));
  assert.equal(asked.length, ROUTES.length * ATTEMPTS,
    `every route gets ${ATTEMPTS} attempts; this pass made ${asked.length}`);
  assert.equal(r.file, null);
  for (const t of r.index.sources[0].routesTried)
    assert.doesNotMatch(t.why, /not tried|not started|break-glass|earned/,
      `${t.url} was held back on a pass where everything was failing`);
});

test("a pass carries no memory of previous failures into which doors it opens", async () => {
  /* The gate read data/index.json's `fails` and `failingSince`. Both fields
     are still written -- the alarm runs on them -- and neither may change what
     this pass asks. Two passes, one with a clean index and one whose index says
     it has been failing for twelve hours, must ask exactly the same doors. */
  const clean = scratch();
  const sore = scratch();
  const a = await pass("2026-09-18T12:00:00Z", serve({}).fetchImpl, clean);
  writeFileSync(sore.indexPath, JSON.stringify({
    generated: "2026-09-18T00:00:00Z", counts: {},
    sources: [{ id: "boyceville", health: "refused", status: "refused", fails: 40,
                failingSince: "2026-09-18T00:00:00Z" }],
  }, null, 1));
  const two = serve({});
  await pass("2026-09-18T12:00:00Z", two.fetchImpl, sore);

  assert.equal(a.index.sources[0].fails, 1, "the clean pass did not record its own failure");
  assert.equal(two.asked.length, ROUTES.length * ATTEMPTS,
    "a long-failing pass asked a different number of doors from a fresh one");
});

/* ── TWO ANSWERS FOR ONE BOARD IS A REFUSAL ─────────────────────────────── */

test("two routes disagreeing about the number is a refusal, not a vote", async () => {
  /* Establish the last committed read, then have the primary serve a board
     whose August corn is a dollar high and internally consistent -- the
     magnitude rail rejects it -- while the second door serves their real
     board. Two readings of one board, no way to tell which is theirs.
     The primary is given a head start long enough to finish first, because a
     disagreement can only be seen when both boards are in hand. */
  const paths = scratch();
  await pass("2026-09-18T12:00:00Z", serve({ [PRIMARY]: BOARD }).fetchImpl, paths);
  const held = readFileSync(paths.feedPath, "utf8");

  const r = await pass("2026-09-18T12:10:00Z",
    serve({ [PRIMARY]: GLITCHED, [SECOND]: BOARD }).fetchImpl, paths,
    { headStartMs: 250 });

  assert.equal(r.file, null, "one of the two readings was published");
  assert.match(r.failure.message, /disagree/);
  assert.match(r.failure.message, /Not averaged, not resolved by recency/,
    "the refusal does not say why it refused rather than picking one");
  assert.match(r.failure.message, /5\.075/, "the two numbers are not named");

  /* And nothing was averaged into the file. */
  assert.equal(readFileSync(paths.feedPath, "utf8"), held,
    "the held file changed on a pass that could not decide what the price was");
  const cash = JSON.parse(held).bids[0].cash;
  assert.equal(cash, 4.075, "the held file is the last good read, unaveraged");
});

test("the disagreement is decided on the price, and it names the rows", () => {
  const a = { route: { url: "https://a.test/" },
              file: { bids: [{ commodity: "Corn", delivery: "August", cash: 4.075, basisDollars: -0.52 }] } };
  const b = { route: { url: "https://b.test/" },
              file: { bids: [{ commodity: "Corn", delivery: "August", cash: 5.075, basisDollars: -0.52 }] } };
  assert.equal(disagreement([a]), null, "one board cannot disagree with itself");
  assert.equal(disagreement([a, structuredClone(a)]), null, "two identical boards are not a disagreement");

  const say = disagreement([a, b]);
  assert.match(say, /August cash 4\.075 vs 5\.075/);
  assert.match(say, /https:\/\/a\.test\/ and https:\/\/b\.test\//);

  /* A row on one and not the other is a disagreement about their board too. */
  const short = { route: { url: "https://c.test/" }, file: { bids: [] } };
  assert.match(disagreement([a, short]), /August is on one and not the other/);
});

/* ── EVERYTHING FAILING STILL HOLDS ─────────────────────────────────────── */

test("every door shut holds the last good file BYTE for byte and does not move checkedAt", async () => {
  const paths = scratch();
  const first = await pass("2026-09-18T12:00:00Z", serve({ [PRIMARY]: BOARD }).fetchImpl, paths);
  const held = readFileSync(paths.feedPath, "utf8");
  const goodChecked = first.index.sources[0].checkedAt;

  const { fetchImpl, asked } = serve({});                 // nothing answers anywhere
  const r = await pass("2026-09-18T12:10:00Z", fetchImpl, paths);

  assert.equal(r.file, null);
  assert.equal(r.wroteFeed, false);
  assert.equal(readFileSync(paths.feedPath, "utf8"), held,
    "the held file is not byte-identical, so the sites' four-hour clock is reading "
  + "a file this pass touched without having read their board");

  const row = r.index.sources[0];
  assert.equal(row.checkedAt, goodChecked,
    "checkedAt advanced on a pass that read nothing, which is how a frozen price "
  + "publishes for ever with nothing downstream objecting");
  assert.equal(row.attemptedAt, "2026-09-18T12:10:00.000Z", "the attempt IS recorded");
  assert.equal(row.health, "refused");
  assert.equal(row.fails, 1);

  /* checkedAt did not move, and neither did the note of which door last
     worked: a failed pass learned nothing about that either. */
  assert.equal(row.via, SOURCE.url);

  /* Every door is named, with its own reason. */
  assert.equal(row.routesTried.length, ROUTES.length);
  assert.deepEqual([...row.routesTried.map((t) => t.url)].sort(),
                   [...ROUTES.map((r2) => r2.url)].sort());
  for (const t of row.routesTried) assert.match(t.why, /503/);
  assert.equal(new Set(asked).size, ROUTES.length, "a door was never actually knocked on");
});

test("the failure text is sentences naming each door, not HTTP 403 three times", () => {
  const text = describeRoutes([
    { url: "https://a.test/one", trust: "primary", why: "attempt 1: HTTP 403; attempt 2: HTTP 403" },
    { url: "https://a.test/two", trust: "verified", why: "0 bids parsed; their page layout has changed" },
  ]);
  assert.match(text, /^1\. https:\/\/a\.test\/one \(primary\) -- /m);
  assert.match(text, /^2\. https:\/\/a\.test\/two \(verified\) -- 0 bids parsed/m);
});

/* ── the index carries it, and a failed pass does not invent it ─────────── */

test("buildIndex carries the route forward on a failed pass, like checkedAt", () => {
  const good = buildIndex({ previous: null, now: new Date("2026-09-18T08:00:00Z"),
    ok: true, checkedAt: "2026-09-18T08:00:00.000Z", pricedAt: null, rows: 7, detail: null,
    via: { url: "https://bigriverbids.com/cashbidssingle-2121", trust: "primary" }, tried: [] });
  assert.equal(good.sources[0].via, "https://bigriverbids.com/cashbidssingle-2121");
  assert.equal(good.sources[0].viaTrust, "primary");

  const bad = buildIndex({ previous: good, now: new Date("2026-09-18T08:10:00Z"),
    ok: false, checkedAt: null, pricedAt: null, rows: null, detail: "everything shut",
    via: null, tried: [{ url: "https://bigriverbids.com/cashbidssingle-2121",
                         trust: "primary", why: "HTTP 403" }] });
  assert.equal(bad.sources[0].via, "https://bigriverbids.com/cashbidssingle-2121",
    "a failed pass rewrote which door last worked, which it learned nothing about");
  assert.equal(bad.sources[0].routesTried[0].why, "HTTP 403");
});

/* ── WHERE A ROUTE CAME FROM IS STILL WRITTEN DOWN ──────────────────────── */

test("every route declares its tier, and only the arranged path's twin is an alias", () => {
  assert.equal(ROUTES[0].tier, "primary");
  for (const r of ROUTES.slice(1)) {
    assert.ok(TIERS.includes(r.tier), `${r.url} declares tier ${r.tier}`);
    assert.notEqual(r.tier, "primary", "there is one primary and it is the manifest's own url");
  }
  const primaryPath = new URL(SOURCE.url).pathname;
  const ALIAS = ROUTES.filter((r) => r.tier === "alias");
  const BREAK_GLASS = ROUTES.filter((r) => r.tier === "break-glass");
  assert.equal(ALIAS.length, 1,
    "there is one arranged page and it has one www twin; anything else calling itself "
  + "an alias is a path this project has no arrangement for");
  assert.equal(BREAK_GLASS.length, ROUTES.length - 2,
    "a route is neither the arranged URL, nor its twin, nor break-glass");
  for (const a of ALIAS)
    assert.equal(new URL(a.url).pathname, primaryPath,
      `${a.url} is called an alias and is a different path`);
  for (const b of BREAK_GLASS)
    assert.notEqual(new URL(b.url).pathname + new URL(b.url).search, primaryPath,
      `${b.url} is the arranged path and is marked break-glass`);
});

test("a new route has to say where it came from before it can ship", () => {
  const base = { url: "https://bigriverbids.com/cashbidssingle-2121",
                 routes: [{ url: "https://bigriverbids.com/somewhere-else",
                            trust: "inferred", why: "a URL somebody thought of" }] };
  assert.throws(() => routesFor(base), /must say which it is/i,
    "a route with no tier shipped without anybody saying where it came from");

  /* And "alias" is not a label that turns a new path into the arranged one. */
  const smuggled = { ...base, routes: [{ ...base.routes[0], tier: "alias" }] };
  assert.throws(() => routesFor(smuggled), /different path/);
  assert.throws(() => aliasOrThrow("https://bigriverbids.com/cashbidssingle-2121",
                                   "https://someone-else.com/cashbidssingle-2121"),
    /different host/);
  assert.ok(aliasOrThrow("https://bigriverbids.com/cashbidssingle-2121",
                         "https://www.bigriverbids.com/cashbidssingle-2121"));

  /* The real list still builds, which is what says the check is a check on new
     routes and not on the ones that ship. */
  assert.equal(routesFor(SOURCE).length, ROUTES.length);
});

test("the arrangement is still written down, and it is written down as history", () => {
  /* Big River's host is robots-disallowed to crawlers with the one arranged URL
     exempt, and that is worth a reader knowing. It is no longer a gate, and the
     files must not go on saying that it is. */
  const manifest = readFileSync(join(ROOT, "sources/boyceville.json"), "utf8");
  const lib = readFileSync(join(ROOT, "lib/routes.mjs"), "utf8");
  for (const [name, text] of [["sources/boyceville.json", manifest], ["lib/routes.mjs", lib]]) {
    assert.match(text, /by arrangement/i, `${name} does not say the host is read by arrangement`);
    assert.match(text, /break-glass/i, `${name} no longer records which routes are not ours`);
    assert.doesNotMatch(text, /walked only (when|after)|only after an hour|earned/i,
      `${name} still describes a gate that is gone; a comment that describes a gate ` +
      `that is not there is worse than no comment`);
  }
  assert.match(manifest, /robots-disallowed/i,
    "the manifest no longer records that the host is robots-disallowed to crawlers");
});

test("the threshold that used to hold the fallbacks back is gone from the code", async () => {
  const lib = readFileSync(join(ROOT, "lib/routes.mjs"), "utf8");
  const read = readFileSync(join(ROOT, "scripts/read.mjs"), "utf8");
  for (const name of ["ALIAS_AFTER_FAILS", "BREAK_GLASS_AFTER_H", "RUN_REQUEST_CEILING",
                      "runBudget", "openDoors", "FALLBACK_ATTEMPTS"]) {
    assert.ok(!lib.includes(name), `lib/routes.mjs still carries ${name}`);
    assert.ok(!read.includes(name), `scripts/read.mjs still carries ${name}`);
  }
  /* And the module really does not export them, which a text scan cannot say. */
  const mod = await import("../lib/routes.mjs");
  for (const name of ["ALIAS_AFTER_FAILS", "BREAK_GLASS_AFTER_H", "gate", "openDoors", "Ceiling"])
    assert.equal(mod[name], undefined, `lib/routes.mjs still exports ${name}`);
  assert.ok(ALARM_AFTER_H > 0, "the alarm clock is still there; it was never the gate");
});
