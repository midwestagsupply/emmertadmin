/* More than one way to the same number, all of them open at once, and a
 * failure that says which doors it tried.
 * ==========================================================================
 *
 * WHERE THESE ROUTES COME FROM. sources/boyceville.json's own `url` is the
 * arranged one: one page, one location, read for the two Emmert sites. Every
 * other route in that file is a path this project found in a capture of their
 * own page or in dnilgis/bids, and each one records the evidence for itself.
 * `tier` and `arrangement` still say where a route came from, because that is
 * true and worth knowing. Nothing is gated on them.
 *
 * NO LADDER, NO EARNING, NO CEILING -- 2026-09-18, BY THE OWNER'S DECISION.
 * The fallbacks were briefly held behind a failure count and an hour of
 * sustained failure, and a workflow run was capped at sixteen requests. That
 * is gone. Big River publishes this price for the public to read, the owner
 * holds the arrangement, and what he asked for is the most redundancy this
 * repository can give him. So: every route is available on every pass, and
 * they are raced rather than walked.
 *
 * RACED, NOT WALKED, WHICH IS THE PART THAT ACTUALLY ADDS REDUNDANCY.
 * Taking a gate off does not add a second way to the number; it only removes a
 * delay. Walking a list does not either: a primary that hangs for twenty
 * seconds puts every fallback twenty seconds behind it, so the list is only as
 * fast as its slowest member. This fires the arranged URL first and gives it
 * HEAD_START_MS to itself -- the one gap that keeps an ordinary day at one
 * request -- and then opens EVERY other route at once while the first is still
 * in flight. The first response that passes EVERY guard wins and the rest are
 * aborted for real: an AbortController per route, wired into the fetch, so an
 * abandoned request is cancelled rather than left running.
 *
 * WHAT A ROUTE IS NOT. A route is not a way around a check. Every route's
 * result goes through the identical guard stack -- buildFile's identity check,
 * the price band, the row reconciliation, the location filter, then the
 * max-move rail against the last committed read. A route that returns a
 * number failing any of those is a FAILED ROUTE, not a price. There is no
 * looser path for a fallback and there must never be one: the second door
 * exists so we can still read their board, not so we can publish something we
 * would otherwise have refused. Aggression is about how hard we try to GET
 * the number. It is never about what we are willing to PUBLISH.
 *
 * THE ORDER IS STILL AN ORDER OF TRUST. sources/boyceville.json's own `url`
 * starts first and gets the head start to itself, so on an ordinary day
 * exactly one request is made and nothing here changes what gets published --
 * same URL, same headers, same bytes. The rest start only because the arranged
 * URL was slow or wrong.
 *
 * TWO ROUTES THAT DISAGREE ARE A REFUSAL, NOT A VOTE. See disagreement()
 * below, and read the note there about what racing costs that walking did not.
 */
import { rowKey, Refused } from "./board.mjs";

/* THE HEAD START, AND WHY IT IS THIS NUMBER.
 *
 * It is the gap between the arranged URL starting and every other route
 * starting. It is the only gap there is. Too short and an ordinary healthy
 * pass makes thirteen requests where one would have done; too long and a sick
 * primary holds the whole pass behind it.
 *
 * WHAT IT IS MEASURED AGAINST, honestly stated: nothing in this repository or
 * in dnilgis/bids records how long bigriverbids.com takes to answer. It cannot
 * be reached from the sandbox this was written in -- the egress proxy answers
 * 403 to CONNECT -- so there is no round-trip time for their host to fit this
 * to, and a number presented as fitted to one would be invented.
 *
 * What IS known: 1500ms is already this reader's own idea of "long enough that
 * something else is worth doing", because it is the first backoff in
 * fetchBoard's retry loop -- a figure that has been in the shipped reader since
 * before any of this. And their page is not small: the one recorded response
 * from that host, on 2026-09-08, was 283 KB.
 *
 * MEASURED HERE, against a local server that logs every hit and is told to
 * answer the arranged URL after a fixed delay, with the real scripts/read.mjs
 * as a child process and the manifest pointed at it. Thirteen routes:
 *
 *     the arranged URL answers in   requests   wall clock   read via
 *     0.1s                              1        0.26s      the arranged URL
 *     0.5s                              1        0.68s      the arranged URL
 *     1.0s                              1        1.19s      the arranged URL
 *     1.4s                              1        1.55s      the arranged URL
 *     1.6s                             13        1.70s      a fallback
 *     2.0s                             13        1.67s      a fallback
 *     8.0s                             13        1.67s      a fallback
 *
 * And the constant itself, with the arranged URL answering at a fixed 2.0s:
 *
 *     head start   requests   wall clock
 *     250ms           13        0.46s
 *     500ms           13        0.66s
 *     1500ms          13        1.66s
 *     3000ms           1        2.17s
 *
 * So the number buys exactly one thing: how slow the arranged URL may be
 * before the pass stops waiting for it. At 1500ms a board that answers inside
 * a second and a half still costs their host exactly one request, and one that
 * has gone quiet costs the pass a second and a half instead of the eight it
 * used to. A healthy primary -- 200ms in the rig -- costs one request under
 * every head start measured, so the choice is not between speed and courtesy
 * on an ordinary day; it only decides how long a bad day waits. */
export const HEAD_START_MS = 1500;

/* ONE DEADLINE FOR THE WHOLE PASS, AND IT IS A DEADLINE AND NOTHING ELSE.
 *
 * node's fetch has no default timeout, so a black-holed host would hang the
 * pass and read.yml fires every ten minutes. This is the wall-clock ceiling
 * for the pass: every route's attempts are bounded by what is left of it, and
 * routes that never got off the ground are REPORTED as not started rather than
 * quietly dropped.
 *
 * It does not limit how many routes may run or how many requests may be made.
 * Racing means the routes overlap, so the number that matters is how long the
 * LAST one needs, not the sum. Measured against the local rig: every one of
 * thirteen routes answering 503 and every one retried three times finishes in
 * 6.2 seconds, and a host that accepts the connection and then never answers
 * anything is stopped by this deadline and nothing else. Sixty seconds leaves
 * room for a genuinely slow host on every route at once and still lands well
 * inside the workflows' two-minute step ceiling, which is what stops a stuck
 * pass sitting in the shared concurrency group. */
export const ROUTE_BUDGET_MS = 60_000;

/* How many times one route asks before it gives up. Three, for every route,
 * because a torn read -- their cash cell written and their futures cell not
 * yet -- clears in seconds and is not worth a missed pass on any door.
 *
 * It used to be three for the arranged URL and two for everything else, to
 * spare a host we read by arrangement. The routes are raced now, so a
 * fallback's retries cost no wall clock at all, and the owner's instruction is
 * redundancy over politeness. One number, applied everywhere. */
export const ATTEMPTS = 3;

/* WHERE A ROUTE CAME FROM. Kept because it is accurate documentation and it
 * costs nothing; no longer used to decide anything.
 *
 *   primary      the arranged URL: sources/boyceville.json's own `url`.
 *   alias        the same arranged path at another spelling of the same host.
 *   break-glass  a path this project has no arrangement for: a sibling
 *                location, the id-less form, the site root, another of the
 *                operator's own hosts.
 *
 * routesFor() still refuses a route that does not declare which it is, and
 * still checks that anything calling itself an alias really is the arranged
 * path at another spelling of the arranged host. That is a check on honesty in
 * the manifest, not a throttle. */
export const TIERS = ["primary", "alias", "break-glass"];

/* How sure we are that a URL serves this board, recorded beside the URL
 * rather than in somebody's memory.
 *
 *   verified  read off a real capture of their page, or off this repo's own
 *             manifest. The URL demonstrably exists.
 *   inferred  derived from how this vendor's platform behaves on OTHER hosts
 *             that this project reads successfully today, or named by a page
 *             this project fetched but never asked for itself. Plausible,
 *             never confirmed against bigriverbids.com.
 *
 * An inferred route may ship. It starts after the verified ones, it is logged
 * by name when it is tried, and nothing here calls it known-good. */
export const TRUST = ["primary", "verified", "inferred"];

export class NoRoute extends Refused {}

/* Its own class, and not just a Refused, because the loop has to tell it from
   the ordinary refusals buildFile throws. "0 bids parsed" on one route means
   let the other routes finish. Two doors answering differently means stop. */
export class Disagreement extends Refused {}

/* An alias is the ARRANGED PAGE at another spelling of the arranged host, and
   nothing else. Checked rather than trusted, because a new path smuggled in
   under that label would misdescribe itself in the one field that records
   where a route came from. */
export function aliasOrThrow(primaryUrl, url) {
  const a = new URL(primaryUrl), b = new URL(url);
  const bare = (h) => h.replace(/^www\./, "");
  if (b.pathname + b.search !== a.pathname + a.search)
    throw new Error(`route ${url} calls itself an alias of ${primaryUrl}, but it is a ` +
                    `different path. An alias is the arranged page at another spelling ` +
                    `of the host; a different path is break-glass`);
  if (bare(b.hostname) !== bare(a.hostname))
    throw new Error(`route ${url} calls itself an alias of ${primaryUrl}, but it is a ` +
                    `different host`);
  return true;
}

/* The ordered list, primary first, then the manifest's own routes in the
 * order it wrote them, then anything inferred. The order decides which route
 * gets the head start and which starts last; it does not decide which run.
 *
 * The routes live in sources/boyceville.json and not in this file on purpose:
 * a URL and the evidence for it are data, and putting them beside the source
 * means a person adding one has to write down why. */
export function routesFor(source) {
  const out = [{ url: source.url, trust: "primary", tier: "primary",
                 why: "the arranged board URL this repository has always read" }];
  const seen = new Set([source.url]);
  const extra = Array.isArray(source.routes) ? source.routes : [];

  for (const r of extra) {
    if (!r || typeof r.url !== "string" || !r.url) continue;
    if (seen.has(r.url)) continue;               // asking one URL twice is not a second way in
    if (!TRUST.includes(r.trust))
      throw new Error(`route ${r.url} has trust ${JSON.stringify(r.trust)}; ` +
                      `it must be one of ${TRUST.join(", ")}`);
    if (r.trust === "primary")
      throw new Error(`route ${r.url} claims to be the primary; there is one primary ` +
                      `and it is the manifest's own url`);
    if (!r.why)
      throw new Error(`route ${r.url} records no evidence. A URL nobody can say they ` +
                      `checked must not ship as though somebody had`);
    /* THE SENTENCE A NEW ROUTE HAS TO MEET. Not a throttle -- a route has to
       say where it came from, because "somebody added a URL" and "this is the
       arranged page under another spelling" are different facts and the file
       has to be able to tell them apart a year from now. */
    if (r.tier === "primary" || !TIERS.includes(r.tier))
      throw new Error(`route ${r.url} declares tier ${JSON.stringify(r.tier)}. ` +
                      `Every route but the manifest's own url must say which it is: ` +
                      `"alias" (the arranged path at another spelling of the arranged ` +
                      `host) or "break-glass" (a path this project has no arrangement ` +
                      `for). The label is documentation; it gates nothing.`);
    if (r.tier === "alias") aliasOrThrow(source.url, r.url);
    seen.add(r.url);
    out.push({ url: r.url, trust: r.trust, tier: r.tier, why: r.why });
  }

  /* verified before inferred, and otherwise the order the manifest gave. */
  const rank = (t) => TRUST.indexOf(t);
  return out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r.trust) - rank(b.r.trust) || a.i - b.i)
    .map((x) => x.r);
}

/* TWO ANSWERS FOR ONE BOARD IS A REFUSAL.
 *
 * A pass reaches this when one route already produced a parseable Boyceville
 * board and was rejected by a guard -- the max-move rail is the case that
 * matters, because their futures cell glitching from 484 to 584 makes their
 * own page internally consistent and the identity check passes. If a second
 * route then shows a DIFFERENT number, we have two readings of one board and
 * no way to tell which is theirs. Averaging them invents a price nobody
 * published; preferring the newer one is a coin toss wearing a rule. So it
 * refuses, and a refusal holds the last good file.
 *
 * WHAT RACING COSTS HERE, SAID PLAINLY. When the routes were walked one at a
 * time, a winning fallback was always compared against every route that had
 * already failed above it. Raced, a fallback can win while the arranged URL is
 * still in flight, and that primary's board is then never seen -- it is
 * aborted. So a disagreement is compared against whatever had already come
 * back when the winner arrived, and the routes still in the air at that moment
 * are named in the log as aborted rather than as agreeing. The guard that
 * actually catches a glitched quote is the max-move rail, which every route's
 * board goes through on its own; this is the second net, and racing makes the
 * second net smaller. That is the trade the speed buys.
 *
 * Compared on cash and basis per row, which is "the number". The futures and
 * change cells tick on their own and are not what the sites publish. */
export function disagreement(boards) {
  if (boards.length < 2) return null;
  const [first, ...rest] = boards;
  const mapOf = (b) => new Map((b.file?.bids ?? []).map((r) => [rowKey(r), r]));
  const a = mapOf(first);

  for (const other of rest) {
    const b = mapOf(other);
    const diffs = [];

    for (const [k, ra] of a) {
      const rb = b.get(k);
      if (!rb) { diffs.push(`${ra.delivery} is on one and not the other`); continue; }
      if (ra.cash !== rb.cash)
        diffs.push(`${ra.delivery} cash ${ra.cash} vs ${rb.cash}`);
      else if (ra.basisDollars !== rb.basisDollars)
        diffs.push(`${ra.delivery} basis ${ra.basisDollars} vs ${rb.basisDollars}`);
    }
    for (const [k, rb] of b) if (!a.has(k)) diffs.push(`${rb.delivery} is on one and not the other`);

    if (diffs.length)
      return `two routes disagree about their board and neither can be preferred: `
           + `${first.route.url} and ${other.route.url} differ on `
           + `${diffs.slice(0, 6).join("; ")}`
           + `${diffs.length > 6 ? ` (and ${diffs.length - 6} more)` : ""}. `
           + `Not averaged, not resolved by recency. Holding the last good read.`;
  }
  return null;
}

/* One line per route, in the order they were started, in plain sentences.
 *
 * A failure used to say "HTTP 403" three times and whoever read it could not
 * tell whether the site was down, the page had moved, or the parse had broken.
 * This is what goes in the log and in data/index.json's `detail`. */
export function describeRoutes(tried) {
  return tried.map((t, i) =>
    `${i + 1}. ${t.url} (${t.trust}) -- ${t.why}`).join("\n");
}

/* Carries the board a route DID build, so the caller can still compare it
   against another route's board. A guard rejecting a number does not mean the
   number was never read. */
export class RouteFailed extends Error {
  constructor(message, board = null) { super(message); this.board = board; }
}

const TICK = Symbol("open the rest of the doors");

/* A timer that can be called off, so a pass that finishes early does not sit
   waiting for a head start nobody is going to use. */
function headStartTimer(ms) {
  let id = null;
  const p = new Promise((r) => { id = setTimeout(() => r(TICK), ms); });
  return { p, cancel: () => clearTimeout(id) };
}

/* RACE THE LIST.
 *
 * The arranged URL starts on its own and gets HEAD_START_MS to answer. That
 * one gap is what keeps an ordinary day at exactly one request. If it has not
 * answered by then -- or if it has already failed outright -- EVERY remaining
 * route starts at once, together, while it is still in flight.
 *
 * WHY THE REST ARE NOT STAGGERED TOO. A gap between the second route and the
 * third buys nothing: the only thing a gap can protect is the one-request
 * ordinary day, and that is already bought by the first gap. Staggering the
 * other eleven would only spread the load on a host we are deliberately no
 * longer rationing, and it would put the last door twelve gaps behind the
 * first: twelve times 1500ms is eighteen seconds of a pass spent waiting on
 * purpose, which is arithmetic rather than a measurement but is not in doubt.
 * Measured, all at once behind one head start: a total outage -- every one of
 * thirteen routes answering 503, every one retried three times -- makes 39
 * requests and finishes in 6.2 seconds.
 *
 * The first response that passes every guard AND does not disagree with a
 * board another route already produced wins; everything still in flight is
 * aborted.
 *
 * `attempt(route, { attempts, msLeft, signal })` does the fetching and the
 * guards and either returns a built board or throws. It throws a RouteFailed
 * carrying `.board` when a board really was parsed and a guard then rejected
 * it. `signal` aborts that route's requests; honouring it is what makes an
 * abandoned route stop costing their host bandwidth.
 */
export async function raceRoutes({ routes, attempt, log = () => {},
                                   budgetMs = ROUTE_BUDGET_MS,
                                   headStartMs = HEAD_START_MS,
                                   clock = Date.now,
                                   attempts = ATTEMPTS } = {}) {
  if (!routes.length) throw new NoRoute("this source lists no routes at all");
  const deadline = clock() + budgetMs;

  const state = routes.map((route) => ({
    route, started: false, settled: false, why: null, ctl: null, p: null,
  }));
  const boards = [];

  const abortTheRest = (why) => {
    for (const s of state) {
      if (s.started && !s.settled) {
        s.ctl.abort(new Error(why));
        s.why = `aborted: ${why}`;
      }
    }
  };

  const start = (s) => {
    s.started = true;
    s.ctl = new AbortController();
    const msLeft = deadline - clock();
    s.p = (async () => {
      if (msLeft <= 0) throw new RouteFailed("the pass ran out of its time budget");
      return attempt(s.route, { attempts, msLeft, signal: s.ctl.signal });
    })().then((built) => ({ s, built }), (error) => ({ s, error }));
    return s.p;
  };

  /* Everything that was started and did not win, for the log and for
     data/index.json. A route that never started is named as that rather than
     left out, so a held door and a failed one read differently. */
  const triedOf = (winner) => {
    const out = [];
    for (const s of state) {
      if (s === winner) continue;
      if (!s.started) {
        out.push({ ...s.route, why: "not started: " + (winner
          ? "an earlier route had already answered"
          : "the pass ran out of its time budget first") });
      } else {
        out.push({ ...s.route, why: s.why ?? "still in flight when the pass ended" });
      }
    }
    return out;
  };

  log(`      racing: the arranged URL now, and every other route at once if it has `
    + `not answered in ${headStartMs}ms`);

  let opened = 1;
  start(state[0]);
  const openTheRest = () => {
    for (const s of state.slice(1)) if (!s.started) start(s);
    opened = state.length;
    if (state.length > 1)
      log(`      opened the other ${state.length - 1} route(s) at once`);
  };

  const timer = state.length > 1 ? headStartTimer(headStartMs) : null;
  try {
    for (;;) {
      const inFlight = state.filter((s) => s.started && !s.settled);
      if (!inFlight.length) {
        if (opened >= state.length) break;
        /* The arranged URL failed outright before the head start ran out.
           Nothing to wait for; open everything now. */
        openTheRest();
        continue;
      }

      const waits = inFlight.map((s) => s.p);
      if (opened < state.length) waits.push(timer.p);
      const done = await Promise.race(waits);

      if (done === TICK) { openTheRest(); continue; }

      const { s, built, error } = done;
      s.settled = true;

      if (error) {
        if (error.board) boards.push({ route: s.route, file: error.board.file });
        s.why = s.why ?? String(error.message ?? error);
        continue;
      }

      boards.push({ route: s.route, file: built.file });

      /* Before anything is published: does this agree with whatever another
         route already managed to read off their board? */
      const clash = disagreement(boards);
      if (clash) {
        s.why = "read a board, but it disagrees with another route";
        abortTheRest("two routes disagree, so the pass is refusing");
        const tried = triedOf(null);
        const stop = new Disagreement(clash + "\nRoutes tried:\n" + describeRoutes(tried));
        stop.tried = tried;
        throw stop;
      }

      abortTheRest(`${s.route.url} answered first and passed every guard`);
      return { file: built.file, built, route: s.route, tried: triedOf(s), boards };
    }
  } finally {
    timer?.cancel();
  }

  const tried = triedOf(null);
  const out = new NoRoute(
    `no route produced a board that passes every guard. ${tried.length} tried:\n`
    + describeRoutes(tried));
  out.tried = tried;
  throw out;
}
