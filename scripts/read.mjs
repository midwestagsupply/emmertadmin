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

   HOW IT DEGRADES, which is the part Sig asked for: after four hours of
   failed passes, checkedAt is four hours old, each site's own next run
   withdraws, and the panel reads "Call for today's price". No error page, no
   empty box, no stale number. The sites do that on their own clock; this
   script does not reach into them. It just stops claiming a fresh read it
   did not get.
*/
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { buildFile, isRefusal, priceChanged, checkMove, serialise, MAX_MOVE }
  from "../lib/board.mjs";

const SOURCE_PATH = new URL("../sources/boyceville.json", import.meta.url);
const FEED_PATH   = new URL("../data/boyceville.json", import.meta.url);
const INDEX_PATH  = new URL("../data/index.json", import.meta.url);

/* The heartbeat. Their board can sit unchanged from Friday afternoon to Monday
   morning and be entirely correct the whole time, so an unchanged file is not
   a problem and rewriting it on every pass would fill the history with noise.
   But checkedAt lives IN that file, and the sites read it, so it cannot go
   stale just because the market is quiet. Six hours is well inside the sites'
   four-hour window only because data/index.json carries the true time and is
   rewritten every pass -- that is why the index exists. */
export const HEARTBEAT_H = 6;

/* How many consecutive failures before this says so out loud. At a ten-minute
   cadence four hours is 24 passes; GitHub delivers cron unreliably, so the
   test is the CLOCK, not the count. Counting passes would raise the alarm
   late on exactly the days delivery is worst. */
export const ALARM_AFTER_H = 4;

export const FETCH_ATTEMPTS = 3;

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
export async function fetchBoard(url, { fetchImpl = fetch, attempts = FETCH_ATTEMPTS,
                                        wait = sleep, log = console.log } = {}) {
  const tried = [];
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetchImpl(url, {
        cache: "no-store",
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
      if (i === attempts) throw new Error(tried.join("; "));
      await wait(1500 * i);
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
export function buildIndex({ previous, now, ok, checkedAt, pricedAt, rows, detail }) {
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
         parser; the vendor's own message usually says it was their shell. */
      detail: ok ? null : String(detail ?? "").slice(0, 600),
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

export async function run({ now = new Date(), fetchImpl = fetch, log = console.log,
                            write = true, wait = sleep } = {}) {
  const source = JSON.parse(readFileSync(SOURCE_PATH, "utf8"));
  const previousFeed = readJson(FEED_PATH);
  const previousIndex = readJson(INDEX_PATH);

  log(`read: ${source.location} ${source.url}`);
  log(`      ${now.toISOString()}`);

  let file = null, failure = null;
  try {
    const html = await fetchBoard(source.url, { fetchImpl, log, wait });
    const built = buildFile(html, { now, sourceUrl: source.url, source });
    file = built.file;
    /* Before anything reads them. */
    file.checkedAt = iso(file.checkedAt);
    file.pricedAt = iso(file.pricedAt);
    if (!file.checkedAt)
      throw new Error("the build produced no readable checkedAt, so its age could "
                    + "never be known and the sites could never withdraw");

    /* THE MAGNITUDE RAIL. The identity check proves a figure came out of the
       right column; it cannot tell a right column from a wrong number. A
       futures cell that glitches from 484 to 584 recomputes their own cash to
       match, so the identity passes and the band passes and a corn bid a
       dollar over the market publishes. Compared against the last COMMITTED
       read, which is at most a heartbeat old. */
    const jumps = checkMove(previousFeed, file, { maxMove: MAX_MOVE });
    if (jumps.length)
      throw new Error(
        `refusing: ${jumps.length} row(s) moved more than ${MAX_MOVE} since the last `
        + `committed read -- `
        + jumps.map((j) => `${j.delivery} ${j.from} -> ${j.to} (${j.move > 0 ? "+" : ""}`
                         + `${j.move.toFixed(4)})`).join("; ")
        + `. That is a glitched quote, not a market. Holding the last good read.`);

    log(`      ${file.count} row(s), ${built.verified} verified, status ${file.status}`);
  } catch (e) {
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
    if (moved || dueH >= HEARTBEAT_H) {
      /* pricedAt is THEIRS: the last time their board showed something
         different. It survives a heartbeat, or the sites' "as of" line would
         claim a price is fresher than it is. */
      if (!moved && previousFeed?.pricedAt) file.pricedAt = previousFeed.pricedAt;
      if (write) writeFileSync(FEED_PATH, serialise(file));
      wroteFeed = true;
      log(`      wrote data/boyceville.json (${moved ? "price moved" : `heartbeat, ${dueH.toFixed(1)}h`})`);
    } else {
      log(`      data/boyceville.json unchanged (no move, heartbeat in ${(HEARTBEAT_H - dueH).toFixed(1)}h)`);
    }
  }

  const index = buildIndex({
    previous: previousIndex, now, ok: Boolean(file),
    checkedAt: file?.checkedAt ?? null,
    pricedAt: file?.pricedAt ?? null,
    rows: file?.count ?? null,
    detail: failure?.message ?? null,
  });
  if (write) {
    mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
    writeFileSync(INDEX_PATH, JSON.stringify(index, null, 1) + "\n");
  }
  const row = index.sources[0];
  log(`      wrote data/index.json (health ${row.health}, fails ${row.fails}, `
    + `checkedAt ${row.checkedAt ?? "never"})`);

  const say = alarm(index, now);
  if (say) log(`\nALARM: ${say}`);

  return { file, index, wroteFeed, failure, alarm: say };
}

/* The exit code is about THIS PASS, not about the alarm.
 *
 * A single failed pass is ordinary -- their site hiccups, GitHub's runner has
 * a bad minute -- and a red run every time one happens trains everybody to
 * ignore red runs. The alarm is the signal that something is actually wrong,
 * and it opens an issue. So: exit 0 on a failed pass with the reason in the
 * log, exit 1 only once the clock says the sites are about to go dark. */
if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((r) => process.exit(r.alarm ? 1 : 0))
       .catch((e) => { console.error("read.mjs itself crashed:", e); process.exit(1); });
}
