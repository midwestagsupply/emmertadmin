#!/usr/bin/env python3
"""Give emmertadmin a status file, so the daily read can see it.

    python3 build/patch_status.py <pristine-root> <work-root>

WHY. Four of the five repositories publish something a reader can look at
without opening Actions: bids has data/index.json, agsist has data/audit.json,
and the two sites have bids.json with status/count/generated/observed/pricedAt.
emmertadmin publishes nothing at all, so the daily read can only look at its git
log — and its git log never moves, because nothing in it commits.

That is the gap. tools/watch-live.mjs is the one thing in this whole system that
looks at what is actually SERVED, it runs five times a weekday, and everything
it learns goes into a run log and is thrown away. It does go red on a real
problem, so it is not silent — but nobody can tell "the watcher ran this morning
and both sites were current" from "the watcher has not run since Thursday", and
that second state is exactly what it exists to catch in everything else.

Every edit goes through sub(), which asserts its anchor matches exactly once.
"""
import sys, pathlib

pristine, work = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])

def sub(text, old, new, label):
    n = text.count(old)
    assert n == 1, f"{label}: anchor matched {n} times, expected 1"
    return text.replace(old, new)

src = (pristine / "tools/watch-live.mjs").read_text(encoding="utf-8")

# ── 1. checkSite records WHAT IT SAW, not only what it objected to ──────────
#
# An out-parameter, so the return value and every existing caller and test are
# untouched. A findings list answers "is anything wrong"; a status file has to
# answer "what did you see", and those are different questions. The facts below
# are all ones checkSite already measured and then discarded.
src = sub(src,
'''export async function checkSite(site, { now, get }) {
  const bad = [];
  const say = (severity, what) => bad.push({ site: site.key, severity, what });''',
'''export async function checkSite(site, { now, get, seen = {} }) {
  const bad = [];
  const say = (severity, what) => bad.push({ site: site.key, severity, what });

  /* WHAT THIS SITE LOOKED LIKE, for status.json. Nothing is added here that was
     not already measured below; the file must never carry a number this
     function did not actually read. `reached` starts false so a site that never
     answered says so rather than being absent and looking like an oversight. */
  const note = seen[site.key] = { host: site.host, name: site.name, reached: false };''',
"checkSite out-parameter")

src = sub(src,
'''  if (page.status !== 200) {
    say("critical", `the site answered HTTP ${page.status}`);
    return bad;
  }''',
'''  if (page.status !== 200) {
    say("critical", `the site answered HTTP ${page.status}`);
    note.httpStatus = page.status;
    return bad;
  }
  note.reached = true;
  note.httpStatus = 200;''',
"reached")

src = sub(src,
'''  const showsPrice = Array.isArray(bids.bids) && bids.bids.length > 0
                     && bids.bids.some((b) => typeof b.cashPrice === "number");
  const callForPrice = /call for/i.test(page.body);''',
'''  const showsPrice = Array.isArray(bids.bids) && bids.bids.length > 0
                     && bids.bids.some((b) => typeof b.cashPrice === "number");
  const callForPrice = /call for/i.test(page.body);
  note.stampField = stampField ?? null;
  note.observedAt = stampField ? bids[stampField] : null;
  note.rows = Array.isArray(bids.bids) ? bids.bids.length : 0;
  note.showsPrice = showsPrice;
  note.callForPrice = callForPrice;''',
"observations")

src = sub(src,
'''    const age = hoursBetween(now, checked);
    const maxAge = typeof bids.maxAgeH === "number" ? bids.maxAgeH : FEED_MAX_AGE_H;''',
'''    const age = hoursBetween(now, checked);
    const maxAge = typeof bids.maxAgeH === "number" ? bids.maxAgeH : FEED_MAX_AGE_H;
    /* Rounded to the minute. A status file is read by a person, and the extra
       decimals of an hours figure are noise they have to divide. */
    note.ageMinutes = Math.round(age * 60);
    note.maxAgeH = maxAge;''',
"age")

src = sub(src,
'''  if (pricing && typeof pricing === "object") {
    if (typeof pricing.spread !== "number")''',
'''  if (hours && typeof hours === "object") note.hasWeekdayHours = "weekday" in hours;
  if (pricing && typeof pricing === "object") {
    note.spread = typeof pricing.spread === "number" ? pricing.spread : null;
    note.manualPrice = pricing.manual ?? null;
    if (typeof pricing.spread !== "number")''',
"pricing observations")

# ── 2. watch() passes the collector through ────────────────────────────────
src = sub(src,
'''export async function watch({ now = new Date(), get }) {
  const found = [];
  const seen = {};
  for (const site of SITES) {
    found.push(...await checkSite(site, { now, get }));''',
'''export async function watch({ now = new Date(), get, observed = {} }) {
  const found = [];
  const seen = {};
  for (const site of SITES) {
    found.push(...await checkSite(site, { now, get, seen: observed }));''',
"watch out-parameter")

# ── 3. the status file itself ──────────────────────────────────────────────
src = sub(src,
'''export function report(found) {''',
'''/* ── the file the daily read looks at ───────────────────────────────────────
 *
 * WHAT IT MAY SAY. Only what watch() actually observed this run, plus the
 * verdict report() already computes. There is no history in it, no trend and no
 * derived figure: this repository publishes no prices and must not start
 * looking as though it does.
 *
 * WHY `generated` MOVES EVERY RUN, even when nothing changed. Every other
 * committed file in this project is written only when its content moves, to
 * keep the diffs readable. This one is the opposite on purpose: a status file
 * whose timestamp only advances when something is wrong cannot answer the
 * question it exists for, which is "is the watcher still running at all". A
 * stopped watcher and a quiet week look identical unless the stamp moves.
 * Five commits a weekday, on a repository that otherwise commits nothing.
 */
export const STATUS_PATH = "status.json";
export const STATUS_SCHEMA = "emmert-admin-status/1";

export function buildStatus({ found, observed, now = new Date(), run = null }) {
  const r = report(found);
  return {
    schema: STATUS_SCHEMA,
    generated: new Date(now).toISOString(),
    /* ok means: the watchdog looked and found nothing above `low`. It is not a
       claim about anything this repository has not looked at. */
    ok: r.ok,
    blocking: r.blocking,
    findings: [...found].map((f) => ({ site: f.site, severity: f.severity, what: f.what })),
    sites: SITES.map((s) => observed[s.key] ?? { host: s.host, name: s.name, reached: false }),
    run,
    note: "Written by tools/watch-live.mjs on every run of watch-live.yml, whether it passed or "
        + "failed. `generated` moves every run on purpose: a stamp that only advances when "
        + "something is wrong cannot tell a quiet week from a watchdog that has stopped.",
  };
}

export function report(found) {''',
"buildStatus")

# ── 4. main() writes it, on the failing path too ───────────────────────────
src = sub(src,
'''export async function main() {
  const get = async (url) => {
    const r = await fetch(url, { cache: "no-store", headers: { "user-agent": "emmert-watchdog" } });
    return { status: r.status, body: await r.text() };
  };
  const found = await watch({ now: new Date(), get });
  const r = report(found);
  console.log(r.text || "  nothing to report; both sites are current.");
  if (!r.ok) {
    console.log(`\\n${r.blocking} thing(s) need attention. This run is failing so it is not ignorable.`);
    process.exitCode = 1;
  }
}''',
'''export async function main() {
  const get = async (url) => {
    const r = await fetch(url, { cache: "no-store", headers: { "user-agent": "emmert-watchdog" } });
    return { status: r.status, body: await r.text() };
  };
  const now = new Date();
  const observed = {};
  const found = await watch({ now, get, observed });
  const r = report(found);
  console.log(r.text || "  nothing to report; both sites are current.");

  /* THE FILE IS WRITTEN BEFORE THE EXIT CODE IS SET, and the workflow commits
     it with if: always(). The one run whose status matters most is the one that
     fails, and a status file that is only published on the good days is a
     status file that lies by omission. */
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
                 && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
  writeFileSync(STATUS_PATH, JSON.stringify(buildStatus({ found, observed, now, run: runUrl }), null, 1) + "\\n");
  console.log(`  wrote ${STATUS_PATH}`);

  if (!r.ok) {
    console.log(`\\n${r.blocking} thing(s) need attention. This run is failing so it is not ignorable.`);
    process.exitCode = 1;
  }
}''',
"main writes status")

src = sub(src,
'''export const SITES = [''',
'''import { writeFileSync } from "node:fs";

export const SITES = [''',
"fs import")

(work / "tools/watch-live.mjs").write_text(src, encoding="utf-8")
print("tools/watch-live.mjs patched")

# ── 5. the workflow commits it, pass or fail ───────────────────────────────
wf = (pristine / ".github/workflows/watch-live.yml").read_text(encoding="utf-8")
wf = sub(wf,
'''permissions:
  contents: read''',
'''permissions:
  # WRITE, because this workflow now publishes status.json. It was `read` while
  # everything the watchdog learned went into the run log and was thrown away.
  contents: write''',
"permissions")

wf = sub(wf,
'''      - name: Look at the live sites
        run: node tools/watch-live.mjs''',
'''      - name: Look at the live sites
        run: node tools/watch-live.mjs

      # if: always() BECAUSE THE FAILING RUN IS THE ONE THAT MATTERS. The step
      # above sets a non-zero exit code when it finds something above `low`, and
      # without this the status file would be published on exactly the days
      # nothing was wrong. tools/watch-live.mjs writes the file before it sets
      # that code, so there is always something here to commit.
      - name: Publish what it saw
        if: always()
        run: |
          set -uo pipefail
          git config user.name  "emmert-bot"
          git config user.email "bot@midwestagsupply.invalid"
          git add status.json
          if git diff --staged --quiet; then
            echo "status.json unchanged, which should not happen: generated moves every run"
          else
            git commit -m "watch: $(TZ=America/Chicago date '+%-d %B %-I:%M%p')"
            for i in 1 2 3; do
              git push && break
              git pull --rebase --autostash && sleep 3
            done
          fi''',
"commit step")

(work / ".github/workflows/watch-live.yml").write_text(wf, encoding="utf-8")
print(".github/workflows/watch-live.yml patched")

# ── 6. the guards run on every watch, not only in the weekly suite ─────────
wf2 = (work / ".github/workflows/watch-live.yml").read_text(encoding="utf-8")
wf2 = sub(wf2,
'''      - name: Test the watchdog before trusting it
        run: node --test test/watch-live.test.mjs''',
'''      - name: Test the watchdog before trusting it
        # status.test.mjs is here as well as in the weekly suite because its
        # guards are about THIS workflow -- that it can write, that it stages
        # the file, that it does so on a failing run. A guard that only runs on
        # Mondays would let six days of a broken publish through.
        run: node --test test/watch-live.test.mjs test/status.test.mjs''',
"watch-live runs the status guards")
(work / ".github/workflows/watch-live.yml").write_text(wf2, encoding="utf-8")
print("watch-live.yml test step widened")
