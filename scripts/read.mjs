#!/usr/bin/env node
/* Read Boyceville's board and publish it. Nothing else.
   ======================================================

   THIS REPO NO LONGER DEPENDS ON dnilgis/bids.
   Both Emmert sites used to read data/boyceville.json out of that repository.
   That repository reads 935 sources through a headless browser on a schedule
   GitHub delivers 17% of the time, and when it fell over -- an unhandled
   promise rejection in the browser driver on 2026-09-11, a push rejected
   because a queued run had checked out a stale SHA on 2026-09-10 -- two
   elevators' public prices went with it. The sites were one repository away
   from a board that has nothing to do with them.

   So this reads their board directly, for this one location, and writes the
   two files the sites already know how to consume. One HTTP request, no
   browser, no npm dependency, well under a second.

   WHAT IS FORKED AND WHY. lib/board.mjs, lib/parse.mjs and lib/currency.mjs
   are byte-for-byte copies of dnilgis/bids -- see lib/FORKED-FROM.json. They
   are NOT a re-implementation. Every rule in them was written against a real
   failure on this board or another on the same vendor's platform: the settle
   flag that truncated eighths after 1:20pm, the seventh column that appeared
   one morning, the front-month cell that lags its own cash by a tick, the
   futures quote of zero that made the identity check vacuous. Re-deriving any
   of that by hand is how it gets lost.

   THE TWO CLOCKS, WHICH ARE THE WHOLE SAFETY MECHANISM.

     checkedAt    the last time we SUCCESSFULLY read their board. It does not
                  advance on a failed pass. Ever.
     attemptedAt  the last time we tried. Advances every pass, pass or fail.

   The sites withdraw the price when checkedAt goes cold (FEED_MAX_AGE_H, now
   4 hours). If a failed pass advanced checkedAt, they would publish a frozen
   price for ever and nothing downstream would object -- the feed would look
   perfectly fresh. Keeping the two apart is what makes the degrade work, and
   it is the one invariant in this file that must never be traded away for a
   tidier log. test/mirror.test.mjs pins it.

   MORE THAN ONE WAY TO THE NUMBER -- 2026-09-18. This read one URL and asked
   it three times with the same method and the same headers. Three attempts at
   one door is not a second way in: one layout change, one 403, one bad DNS
   answer and there was no other attempt at a price sitting in public. It now
   RACES sources/boyceville.json's `routes`. The arranged URL goes first and
   gets a head start to itself; if it has not answered inside HEAD_START_MS the
   next route starts while it is still in flight, and so on down the list. The
   first response that passes EVERY guard wins and the rest are aborted for
   real. See lib/routes.mjs for what a route is not allowed to be.

   NO GATE, NO CEILING -- 2026-09-18, LATER THE SAME DAY, BY THE OWNER'S
   DECISION. The fallbacks were briefly held behind a failure count and an hour
   of sustained failure, a workflow run was capped at sixteen requests, and the
   push-race re-read was restricted to the arranged URL. All three are gone.
   Big River publishes this price for the public to read and the owner, who
   holds the arrangement, asked for the most redundancy this repository can
   give him. What is left is a wall-clock deadline, which is not a throttle: it
   is what stops a black-holed host from wedging a pass that fires every ten
   minutes.

   AND A SECOND WAY TO THE NUMBER THAT COSTS NO REQUEST AT ALL. Their board
   publishes cash, basis and the futures quote, and cash - basis = futures is
   the identity the guards already check. Read the other way round it is
   arithmetic: with two of the three, the third is derivable. So a row whose
   Bid cell did not render, on a page whose Basis and Futures cells did, is no
   longer a lost row -- and neither is a row that published with a null basis
   because one Basis cell came back empty, which refused nothing and printed a
   dash on a grower's screen. Exactly one of the three may be missing, the
   other two have to be sane, every untouched row has to have balanced exactly,
   the derived figure faces the band and the max-move rail like any other
   number, and the row is MARKED as reconstructed in the published file, in
   data/index.json and in the log. See lib/reconstruct.mjs.

   HOW IT DEGRADES, which is the part Sig asked for: after four hours of
   failed passes, checkedAt is four hours old, each site's own next run
   withdraws, and the panel reads "Call for today's price". No error page, no
   empty box, no stale number. The sites do that on their own clock; this
   script does not reach into them. It just stops claiming a fresh read it
   did not get.
*/
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { buildFile, isRefusal, priceChanged, checkMove, serialise, MAX_MOVE }
  from "../lib/board.mjs";
import { routesFor, raceRoutes, describeRoutes, RouteFailed, ROUTE_BUDGET_MS,
         HEAD_START_MS, ATTEMPTS }
  from "../lib/routes.mjs";
import { reconstructingExtract, describeMarks } from "../lib/reconstruct.mjs";
import { rowKey } from "../lib/board.mjs";

const SOURCE_PATH = new URL("../sources/boyceville.json", import.meta.url);
const FEED_PATH   = new URL("../data/boyceville.json", import.meta.url);
const INDEX_PATH  = new URL("../data/index.json", import.meta.url);
const DATA_DIR    = new URL("../data/", import.meta.url);

/* The heartbeat. Their board can sit unchanged from Friday afternoon to Monday
   morning and be entirely correct the whole time, so an unchanged file is not
   a problem and rewriting it on every pass would fill the history with noise.
   But checkedAt lives IN that file, and the sites read it, so it cannot go
   stale just because the market is quiet. Six hours is well inside the sites'
   four-hour window only because data/index.json carries the true time and is
   rewritten every pass -- that is why the index exists.

   CHECKED, 2026-09-18, BECAUSE A SECOND THING NOW RESTS ON IT. Both workflows
   commit with `git diff --staged --quiet && exit 0`, so a pass that changed no
   file commits nothing and leaves no trace. buildIndex stamps `generated` and
   `attemptedAt` with this pass's `now` unconditionally, so the index is a
   different file on every pass -- verified by running run() five times a minute
   apart against one unchanged fixture and against a failing fetch, and getting
   five different index files and one unchanged feed file.

   That is what makes a commit an exact record of a pass, and it is how the
   24.4% delivery figure in read.yml was counted. Anyone tempted to stop writing
   `generated`, or to round `attemptedAt` to the minute, would make this file
   idempotent on a quiet market -- and the reward would be a history that shows
   no gaps because it shows nothing, on the one measurement that says whether
   the feed is being read at all. test/mirror.test.mjs pins it. */
export const HEARTBEAT_H = 6;

/* How many consecutive failures before this says so out loud. At a ten-minute
   cadence four hours is 24 passes; GitHub delivers cron unreliably, so the
   test is the CLOCK, not the count. Counting passes would raise the alarm
   late on exactly the days delivery is worst. */
export const ALARM_AFTER_H = 4;

/* Kept as a name because the tests and the workflow prose speak of it, and
   because one number for every route is the whole point: lib/routes.mjs sets
   it and this re-exports it rather than holding a second copy that could drift
   from the one the race actually uses. */
export const FETCH_ATTEMPTS = ATTEMPTS;

/* A 200 that is not their board.
 *
 * Their platform serves an error shell -- a nav, a footer, no board -- with a
 * 200 status. Parsed, it yields zero bids and buildFile refuses, which is
 * correct but reports "their page layout has changed" and sends somebody to
 * read a parser that is fine. Short-circuiting on the shell names the real
 * thing and lets the retry do its job, because a shell is usually transient. */
export const MIN_BYTES = 2000;
export function looksLikeShell(html) {
  const s = String(html ?? "");
  if (s.length < MIN_BYTES) return `only ${s.length} bytes; their board is tens of kilobytes`;
  if (!/cashbidssingle/i.test(s)) return "no cashbidssingle reference anywhere on it";
  if (!/fcControls/i.test(s)) return "none of their board markup (fcControls) on it";
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Three tries, widening. A torn read -- their cash cell written and their
   futures cell not yet -- clears in seconds, and so does a shell. Neither is
   worth a whole missed pass. A layout change does not clear, and three tries
   cost three seconds and prove that. */
/* AND A DEADLINE, BECAUSE node's fetch HAS NONE.
 *
 * A black-holed host would hang the pass, and read.yml fires every ten
 * minutes. `msLeft` is what is left of the whole pass's wall-clock deadline
 * when this route started, and it bounds every attempt this route makes. It is
 * a deadline and not a schedule: a route that is merely slow is untouched, and
 * only one that would have wedged the runner is cut short. */
/* AND AN ABORT, BECAUSE THE ROUTES ARE RACED AND THE LOSERS MUST ACTUALLY STOP.
 *
 * `signal` comes from the route's own AbortController in lib/routes.mjs. When
 * another route wins, that controller fires and the fetch in flight here is
 * cancelled -- the socket closes and their host stops sending. Without this
 * an "aborted" route would go on downloading a 283 KB page nobody will read,
 * which is the opposite of what racing is for. The deadline and the abort are
 * combined by hand rather than with AbortSignal.any so this does not depend on
 * a node version the runner might not have. */
function until(ms, outer) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(new Error("out of time")), ms);
  const onAbort = () => c.abort(outer.reason ?? new Error("aborted"));
  if (outer) {
    if (outer.aborted) onAbort();
    else outer.addEventListener("abort", onAbort, { once: true });
  }
  return { signal: c.signal,
           done: () => { clearTimeout(t); outer?.removeEventListener("abort", onAbort); } };
}

export async function fetchBoard(url, { fetchImpl = fetch, attempts = FETCH_ATTEMPTS,
                                        wait = sleep, log = console.log,
                                        signal = undefined,
                                        msLeft = Infinity } = {}) {
  const tried = [];
  const deadline = Number.isFinite(msLeft) ? Date.now() + msLeft : Infinity;
  for (let i = 1; i <= attempts; i++) {
    let stop = null;
    try {
      if (signal?.aborted) throw new Error("another route answered first");
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("out of time before asking");
      stop = until(Number.isFinite(left) ? left : 2 ** 31 - 1, signal);
      const res = await fetchImpl(url, {
        cache: "no-store",
        signal: stop.signal,
        headers: { "user-agent": "EmmertAdmin/1.0 (+https://badgergrain.com)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const shell = looksLikeShell(html);
      if (shell) throw new Error(`not their board: ${shell}`);
      if (i > 1) log(`  read on attempt ${i} (${tried.join("; ")})`);
      return html;
    } catch (e) {
      tried.push(`attempt ${i}: ${e.message}`);
      if (signal?.aborted) throw new Error("another route answered first");
      if (i === attempts) throw new Error(tried.join("; "));
      await wait(1500 * i);
    } finally {
      stop?.done();
    }
  }
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/* ONE TYPE FOR A TIMESTAMP, AT THE BOUNDARY.
 *
 * buildFile sets checkedAt and pricedAt to the Date object it was handed.
 * JSON.stringify turns that into the same ISO string the sites require, so the
 * published FILE has always been right -- but the in-memory object carries a
 * Date while a value read back out of a previous file carries a string, and
 * every consumer downstream then has to cope with both. Measured on the third
 * pass of a dry run: the log printed one as "Sat Sep 12 2026 14:10:00 GMT+0000"
 * and the next as "2026-09-12T14:10:00.000Z", off the same field.
 *
 * Date.parse happens to accept both, which is exactly why this would have sat
 * there until something stricter read it. Normalised here, at the edge, rather
 * than in lib/ -- those three files are a byte-for-byte fork and keeping them
 * that way is what makes lib/FORKED-FROM.json worth anything. */
export const iso = (v) => {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/* WHAT THE INDEX SAYS, AND WHAT IT MUST NEVER SAY.
 *
 * One row, because there is one source. The shape is the shape the sites
 * already read (`sources[]`, matched on `id`, `checkedAt` taken off it), so
 * cutting them over is a URL change and nothing else.
 *
 * `checkedAt` is carried forward from the previous index on a failed pass. It
 * is not recomputed, not defaulted to now, and not filled in from the feed
 * file -- the feed file's own checkedAt is the same number and would be just
 * as stale, but reading it here would mean two places deciding one fact. */
export function buildIndex({ previous, now, ok, checkedAt, pricedAt, rows, detail,
                             via = null, tried = [], marks = [] }) {
  const prevRow = (previous?.sources ?? []).find((s) => s?.id === "boyceville") ?? null;
  const fails = ok ? 0 : Number(prevRow?.fails ?? 0) + 1;
  /* When the failures started, kept across runs because a fresh runner has no
     memory. The clock is what the alarm is measured on, so it has to persist
     in the one file that is written on every pass. */
  const failingSince = ok ? null : (prevRow?.failingSince ?? now.toISOString());
  const lastChecked = iso(ok ? checkedAt : (prevRow?.checkedAt ?? checkedAt ?? null));
  const coldH = lastChecked
    ? (now.getTime() - Date.parse(lastChecked)) / 36e5
    : null;
  return {
    generated: now.toISOString(),
    note: "One source. This file is rewritten on EVERY pass, pass or fail, which is "
        + "why the sites measure the feed's age against it rather than against "
        + "data/boyceville.json -- that one is only rewritten when the price moves.",
    counts: { total: 1, live: ok ? 1 : 0, refused: ok ? 0 : 1, broken: 0, skipped: 0 },
    sources: [{
      id: "boyceville",
      operator: "Big River Resources",
      location: "Boyceville",
      usState: "WI",
      /* THE TWO CLOCKS. checkedAt does not move on a failed pass. */
      checkedAt: lastChecked,
      attemptedAt: now.toISOString(),
      pricedAt: iso(ok ? pricedAt : (prevRow?.pricedAt ?? null)),
      rows: ok ? rows : (prevRow?.rows ?? null),
      health: ok ? "live" : "refused",
      status: ok ? "ok" : "refused",
      fails,
      failingSince,
      coldHours: coldH == null ? null : Math.round(coldH * 100) / 100,
      /* Named, not summarised. "refused" on its own sends somebody to read the
         parser; the vendor's own message usually says it was their shell.
         Roomier than it was because it now carries a line per route, which is
         the thing that says whether the site is down, the page moved, or the
         parse broke. */
      detail: ok ? null : String(detail ?? "").slice(0, 2000),
      /* WHICH DOOR THE NUMBER CAME THROUGH.
         Carried forward on a failed pass exactly like checkedAt: it is a fact
         about the last GOOD read and a failed pass learned nothing about it. */
      via: ok ? (via?.url ?? null) : (prevRow?.via ?? null),
      viaTrust: ok ? (via?.trust ?? null) : (prevRow?.viaTrust ?? null),
      /* Every route that was started and did not win, in the order it was
         started, on a pass that had to start more than one. Empty on an
         ordinary pass because an ordinary pass asks one door and it opens. */
      routesTried: tried.map((t) => ({ url: t.url, trust: t.trust, why: String(t.why ?? "") })),
      /* WHICH FIGURES WERE DERIVED RATHER THAN READ.
         Empty on an ordinary pass. Carried forward on a failed pass exactly
         like checkedAt and `via`: it is a fact about the last GOOD read and a
         failed pass learned nothing about it. A row here is a row whose value
         came out of cash - basis = futures instead of out of their cell, and
         the same mark is on the row in data/boyceville.json. */
      reconstructed: ok
        ? marks.map((m) => ({ commodity: m.commodity, delivery: m.delivery,
                              field: m.field, value: m.value, why: m.why }))
        : (prevRow?.reconstructed ?? []),
      commodities: ok ? ["Corn"] : (prevRow?.commodities ?? null),
    }],
  };
}

/* Is it time to say something out loud? By the clock, not the count. */
export function alarm(index, now, { afterH = ALARM_AFTER_H } = {}) {
  const s = (index?.sources ?? []).find((x) => x?.id === "boyceville");
  if (!s || s.health === "live") return null;
  const since = Date.parse(s.failingSince ?? "");
  if (!Number.isFinite(since)) return null;
  const h = (now.getTime() - since) / 36e5;
  if (h < afterH) return null;
  const cold = s.coldHours == null ? "unknown" : `${s.coldHours}h`;
  return `Boyceville has refused for ${h.toFixed(1)}h (last good read ${cold} ago). `
       + `Both sites withdraw the price once it is ${ALARM_AFTER_H}h cold and show `
       + `"Call for today's price". Last message: ${s.detail || "none recorded"}`;
}

/* THE PATHS ARE ARGUMENTS SO THE WRITE PATH CAN BE TESTED AT ALL.
 *
 * They were module constants, which meant the only way to exercise a pass was
 * against whatever happened to be committed in data/. That is why the first
 * test written for the pricedAt bug PASSED WITH THE BUG STILL IN: the file on
 * disk holds 11 rows and the fixture holds 7, so every test pass looked like a
 * price move and the carry-forward it was meant to check never ran. A test
 * that cannot reach the state it is about is not a test. */
export async function run({ now = new Date(), fetchImpl = fetch, log = console.log,
                            write = true, wait = sleep,
                            feedPath = FEED_PATH, indexPath = INDEX_PATH,
                            dataDir = DATA_DIR,
                            headStartMs = HEAD_START_MS,
                            budgetMs = ROUTE_BUDGET_MS } = {}) {
  const source = JSON.parse(readFileSync(SOURCE_PATH, "utf8"));
  const previousFeed = readJson(feedPath);
  const previousIndex = readJson(indexPath);
  const routes = routesFor(source);

  log(`read: ${source.location} ${source.url}`);
  log(`      ${now.toISOString()}`);
  log(`      ${routes.length} route(s), all of them available this pass; the first `
    + `answer that passes every guard wins`);

  /* WHAT THE LAST COMMITTED READ SAYS ABOUT EACH ROW, for the one rule
     reconstruction cannot check for itself. See lib/reconstruct.mjs rule 5. */
  const railHas = new Set((previousFeed?.bids ?? [])
    .filter((b) => b && b.cash != null).map((b) => rowKey(b)));

  /* ONE ROUTE'S WORTH OF WORK, AND EVERY ROUTE GETS THE SAME GUARDS.
   *
   * This is the whole guard stack, unchanged, run per route: buildFile does
   * the location filter, the identity check, the price band and the row
   * reconciliation; the max-move rail runs here against the last committed
   * read. A route that gets through the fetch and then fails any of them is a
   * FAILED ROUTE, not a price. There is no shorter path for a fallback and
   * there is no shorter path for a reconstructed row either.
   *
   * A guard rejecting a board does not mean no board was read, so the board
   * rides out on the error -- raceRoutes needs it to tell another route's
   * number apart from this one's. */
  const attempt = async (route, { attempts, msLeft, signal }) => {
    const html = await fetchBoard(route.url, { fetchImpl, log, wait, attempts, msLeft,
                                               signal });

    /* THE ORDINARY WAY FIRST, ALWAYS. A board that builds cleanly and carries
       every figure their page printed is published exactly as it always was,
       with no derived number anywhere near it and no second parse.
       Reconstruction is asked for in exactly two cases:

         the board REFUSED               -- a blank Bid column takes the whole
                                            board down today, and it is
                                            derivable from the other two
         the board built with a HOLE     -- a blank Basis or Futures cell does
                                            not refuse anything. The row
                                            publishes with null in that field
                                            and the sites print a dash for it,
                                            which is a number lost in silence
                                            on a page where the other two
                                            columns say what it was. */
    let built = null, marks = [], plainRefusal = null;
    try {
      built = buildFile(html, { now, sourceUrl: route.url, source });
    } catch (e) {
      if (!isRefusal(e)) throw e;
      plainRefusal = e;
    }

    const hasHole = built ? built.file.bids.some(
      (b) => b.cash == null || b.basisDollars == null || b.basisCents == null
          || b.futuresPriceCents == null) : false;

    if (plainRefusal || hasHole) {
      const repair = reconstructingExtract(source);
      let second = null, secondRefusal = null;
      try {
        second = buildFile(html, { now, sourceUrl: route.url, source, extract: repair });
      } catch (e2) { secondRefusal = e2; }
      const found = repair.collected.marks;

      /* RULE 5. A board where not one row balanced on its own has proven
         nothing about its own columns, so the derived figures have only the
         band and the max-move rail behind them -- and the rail has to have
         something to compare against or it is not checking anything. */
      const unbacked = found.length && repair.collected.provenBy === 0
                    && !found.some((m) => railHas.has(m.key));

      if (second && found.length && !unbacked) {
        built = second;
        marks = found;
        for (const line of describeMarks(marks))
          log(`      RECONSTRUCTED: ${line}`);
        log(`      ${repair.collected.provenBy} row(s) balanced cash - basis = futures with `
          + `nothing reconstructed; the derived figure(s) face the band and the max-move `
          + `rail like any other number.`);
      } else {
        for (const h of repair.collected.held)
          log(`      not reconstructed: ${h.delivery ?? "this board"} -- ${h.why}`);
        if (unbacked) {
          const say = `Reconstruction could fill ${found.length} row(s) from `
            + `cash - basis = futures, but NOT ONE row on this board balanced that identity `
            + `on its own, so nothing here proves its columns are in the right order -- and `
            + `no reconstructed row has a previous committed reading for the max-move rail `
            + `to check it against. A derived number with nothing standing behind it is a `
            + `guess.`;
          log(`      ${say}`);
          /* A board that ALSO refused on its own stays refused, and says both
             things. A board that built with a hole in it keeps its hole: that
             is what their page printed, and it is not made better by filling
             it with a figure nothing is checking. */
          if (plainRefusal)
            throw new RouteFailed(`${plainRefusal.message}\n  ${say} Holding the last good read.`);
        } else if (plainRefusal && found.length && secondRefusal) {
          /* THE REFUSAL THAT STANDS IS THE FIRST ONE, because it is about their
             board rather than about what we tried to do with it -- but if a
             reconstruction was attempted and then refused in its own right, the
             second reason is the one that says what actually stopped it, and
             leaving it out sends a reader to look at the wrong thing. */
          plainRefusal.message += `\n  ${found.length} row(s) could be derived from `
            + `cash - basis = futures, and the derived board was refused too: `
            + `${secondRefusal.message}`;
        } else if (!plainRefusal && found.length && secondRefusal) {
          log(`      a hole in this board was derivable, and the derived board was refused: `
            + `${secondRefusal.message}. Publishing what their page printed, hole and all.`);
        }
        if (plainRefusal) throw plainRefusal;
      }
    }

    const file = built.file;
    /* Before anything reads them. */
    file.checkedAt = iso(file.checkedAt);
    file.pricedAt = iso(file.pricedAt);
    if (!file.checkedAt)
      throw new RouteFailed("the build produced no readable checkedAt, so its age could "
                          + "never be known and the sites could never withdraw", built);

    /* MARKED IN THE FILE ITSELF, so a derived number is never indistinguishable
       from a read one on a grower's screen or in a committed diff. Added to the
       published row rather than beside it because the row is what travels. */
    if (marks.length) {
      const byRow = new Map(marks.map((m) => [m.key, m]));
      for (const b of file.bids) {
        const m = byRow.get(rowKey(b));
        if (m) b.reconstructed = m.field;
      }
      built.marks = marks;
    }

    /* THE MAGNITUDE RAIL. The identity check proves a figure came out of the
       right column; it cannot tell a right column from a wrong number. A
       futures cell that glitches from 484 to 584 recomputes their own cash to
       match, so the identity passes and the band passes and a corn bid a
       dollar over the market publishes. Compared against the last COMMITTED
       read, which is at most a heartbeat old. A reconstructed row goes through
       this exactly like a read one; it is the guard that stands behind the
       arithmetic. */
    const jumps = checkMove(previousFeed, file, { maxMove: MAX_MOVE });
    if (jumps.length)
      throw new RouteFailed(
        `refusing: ${jumps.length} row(s) moved more than ${MAX_MOVE} since the last `
        + `committed read -- `
        + jumps.map((j) => `${j.delivery} ${j.from} -> ${j.to} (${j.move > 0 ? "+" : ""}`
                         + `${j.move.toFixed(4)})`).join("; ")
        + `. That is a glitched quote, not a market. Holding the last good read.`,
        built);

    return built;
  };

  let file = null, failure = null, via = null, tried = [], marks = [];
  try {
    const won = await raceRoutes({ routes, attempt, log, budgetMs, headStartMs,
                                   attempts: FETCH_ATTEMPTS });
    file = won.file;
    via = won.route;
    tried = won.tried;
    marks = won.built.marks ?? [];

    /* SAY SO WHEN IT WAS NOT THE FRONT DOOR. A migration to a fallback that
       nobody can see is the same as no fallback at all: the arranged URL could
       be dead for a month and every pass would look green. */
    if (via.trust !== "primary")
      log(`      READ VIA A FALLBACK ROUTE: ${via.url} (${via.trust}). `
        + `The primary did not answer. Routes tried:\n${describeRoutes(tried)}`);

    log(`      ${file.count} row(s), ${won.built.verified} verified, status ${file.status}`
      + (marks.length ? `, ${marks.length} RECONSTRUCTED` : ``));
  } catch (e) {
    tried = e.tried ?? tried;
    failure = e;
    /* REFUSED AND BROKEN READ THE SAME FROM HERE, AND THAT IS DELIBERATE.
       Either way we have no answer to publish, so either way the last good
       read stands and checkedAt does not move. The distinction matters to
       whoever reads the log, not to what gets written. */
    log(`      NO READ: ${isRefusal(e) ? "refused" : "failed"} -- ${e.message}`);
    log(`      Holding the last good read. checkedAt is NOT advanced.`);
  }

  /* ---- what gets written ------------------------------------------------ */

  let wroteFeed = false;
  if (file) {
    /* Only when the price moved, or the heartbeat is due. `priceChanged`
       compares the published rows -- never a field we write ourselves against
       one they publish, which once made a correctly-frozen board look fresh. */
    const prevChecked = Date.parse(previousFeed?.checkedAt ?? "");
    const dueH = Number.isFinite(prevChecked)
      ? (now.getTime() - prevChecked) / 36e5 : Infinity;
    const moved = priceChanged(previousFeed, file);

    /* pricedAt IS THEIRS, AND IT IS DECIDED HERE -- NOT INSIDE THE WRITE.
     *
     * buildFile stamps pricedAt with `now`, because from where it sits every
     * read is the first one. Carrying the previous value forward when the rows
     * have not changed used to happen inside the `if` below, so it only ran on
     * a pass that actually wrote the file. On every other pass `file.pricedAt`
     * stayed at `now` -- and buildIndex was handed that.
     *
     * Measured live, 2026-09-12 13:35 CT, one hour after the mirror went up:
     *
     *     FEED  pricedAt  7:51:14AM     <- correct: when their board last moved
     *     INDEX pricedAt  1:25:43PM     <- the moment of the last read
     *
     * Two files disagreeing about one fact, in a repository whose whole design
     * is that pricedAt and checkedAt are different questions. Nothing consumed
     * index.pricedAt yet, which is the only reason it was harmless -- and
     * exactly why it would have been believed the first time something did.
     *
     * The decision belongs to the row comparison, so it is made where the row
     * comparison is, once, before anything reads it. */
    if (!moved && previousFeed?.pricedAt) file.pricedAt = iso(previousFeed.pricedAt);

    /* AND WHEN THE DOOR CHANGED, EVEN IF THE PRICE DID NOT.
     *
     * `file.source.url` is the route that produced this number, so a migration
     * to a fallback shows up as a one-line diff in the published file. But
     * `priceChanged` compares the bids and the count and nothing else -- on
     * purpose, so that a field we write ourselves can never look like a price
     * move. On a quiet market that means the file would not be rewritten and
     * `source.url` would go on naming a door that stopped answering hours ago.
     * The route is part of what the file asserts, so a change in it is a
     * reason to write. */
    const routeMoved = Boolean(previousFeed?.source?.url)
                    && previousFeed.source.url !== file.source.url;
    if (routeMoved)
      log(`      the route changed: ${previousFeed.source.url} -> ${file.source.url}`);

    if (moved || routeMoved || dueH >= HEARTBEAT_H) {
      if (write) writeFileSync(feedPath, serialise(file));
      wroteFeed = true;
      log(`      wrote data/boyceville.json (${moved ? "price moved"
            : routeMoved ? "the route changed" : `heartbeat, ${dueH.toFixed(1)}h`})`);
    } else {
      log(`      data/boyceville.json unchanged (no move, heartbeat in ${(HEARTBEAT_H - dueH).toFixed(1)}h)`);
    }
    log(`      their board last moved ${file.pricedAt}${moved ? " (this pass)" : ""}`);
  }

  const index = buildIndex({
    previous: previousIndex, now, ok: Boolean(file),
    checkedAt: file?.checkedAt ?? null,
    pricedAt: file?.pricedAt ?? null,
    rows: file?.count ?? null,
    detail: failure?.message ?? null,
    via, tried, marks,
  });
  if (write) {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(indexPath, JSON.stringify(index, null, 1) + "\n");
  }
  const row = index.sources[0];
  log(`      wrote data/index.json (health ${row.health}, fails ${row.fails}, `
    + `checkedAt ${row.checkedAt ?? "never"})`);

  const say = alarm(index, now);
  if (say) log(`\nALARM: ${say}`);

  return { file, index, wroteFeed, failure, alarm: say, via, tried, marks };
}

/* The exit code is about THIS PASS, not about the alarm.
 *
 * A single failed pass is ordinary -- their site hiccups, GitHub's runner has
 * a bad minute -- and a red run every time one happens trains everybody to
 * ignore red runs. The alarm is the signal that something is actually wrong.
 * So: exit 0 on a failed pass with the reason in the log, exit 1 only once the
 * clock says the sites are about to go dark.
 *
 * AND IT SAYS SO IN A WAY THE WORKFLOW CAN TELL APART FROM A CRASH.
 *
 * `read.yml` used to open its "the feed is cold" issue on `if: failure()`,
 * which fires when ANY step fails. So the gate failures of 2026-09-12 -- a test
 * reading a repository that is not on the runner -- filed an issue announcing
 * that both sites had withdrawn the price, at a moment when the feed was fine
 * and nothing had withdrawn. An alarm that cries wolf is worse than no alarm:
 * the next one gets ignored.
 *
 * The alarm is now written to GITHUB_OUTPUT as a fact, so the workflow can act
 * on the alarm itself rather than on the exit code, which any step can produce
 * for any reason. */
function emit(name, value) {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  try {
    const delim = "EOF_" + Math.random().toString(36).slice(2);
    appendFileSync(f, `${name}<<${delim}\n${value}\n${delim}\n`);
  } catch { /* not fatal: the log still carries it */ }
}

/* THE PUSH-RACE RE-READ IS AN ORDINARY PASS.
 *
 * read.yml's commit loop re-runs this script after a rejected push whose
 * incoming commits touched the feed, because this pass's number was then
 * checked against a baseline that is no longer the last committed read and the
 * max-move rail has to run again. That re-read used to be restricted to the
 * arranged URL. It is not any more: if the arranged URL has stopped answering
 * between the first read and the rebase, the re-read should find the board the
 * same way the first one would have. There is no flag left to pass.
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((r) => {
    emit("alarm", r.alarm ? "1" : "0");
    if (r.alarm) emit("alarm_text", r.alarm);
    process.exit(r.alarm ? 1 : 0);
  }).catch((e) => {
    /* A crash is NOT an alarm. The feed may be perfectly warm; this script
       fell over. Saying otherwise would file the wrong issue again. */
    emit("alarm", "0");
    console.error("read.mjs itself crashed:", e);
    process.exit(1);
  });
}
