/* THE STATUS FILE, AND THE ONE THING IT MUST NOT DO.
 *
 * emmertadmin published nothing. Four of the five repositories in this system
 * publish something a person can look at without opening Actions; this one made
 * the daily read fall back to its git log, and its git log never moved because
 * nothing in it committed.
 *
 * tools/watch-live.mjs is the only thing in the whole system that looks at what
 * is actually SERVED, it runs five times a weekday, and everything it learned
 * went into a run log and was thrown away. It does go red on a real problem, so
 * it was never silent — but nobody could tell "the watcher ran this morning and
 * both sites were current" from "the watcher has not run since Thursday". The
 * second of those is precisely what this watchdog exists to catch everywhere
 * else, and it could not answer it about itself.
 *
 * THE THING IT MUST NOT DO is say more than the watcher measured. A status file
 * that starts carrying a price, a trend, or a figure nobody read is a second
 * source of truth about numbers this repository does not own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildStatus, watch, report, SITES, STATUS_PATH, STATUS_SCHEMA, main,
} from "../tools/watch-live.mjs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const NOW = new Date("2026-09-08T15:00:00Z");

/* A site that answers with everything in order. */
const okSite = (host) => ({
  [`https://${host}/`]: { status: 200, body: "<p>4.58</p>" },
  [`https://${host}/bids.json`]: { status: 200, body: JSON.stringify({
    observed: new Date(NOW.getTime() - 6 * 60000).toISOString(),
    bids: [{ commodity: "Corn", delivery: "September", cashPrice: 4.58 }],
  }) },
  [`https://${host}/pricing.json`]: { status: 200, body: JSON.stringify({ spread: 0.1, contact: "same" }) },
  [`https://${host}/hours.json`]: { status: 200, body: JSON.stringify({ weekday: "8-5" }) },
});
const serve = (pages) => async (url) => pages[url] ?? { status: 404, body: "" };

test("it reports what the watcher saw, for every site, and nothing else", async () => {
  const get = serve({ ...okSite("badgergrain.com"), ...okSite("midwestcommodity.com") });
  const observed = {};
  const found = await watch({ now: NOW, get, observed });
  const s = buildStatus({ found, observed, now: NOW });

  assert.equal(s.schema, STATUS_SCHEMA);
  assert.equal(s.generated, NOW.toISOString());
  assert.equal(s.ok, true);
  assert.equal(s.blocking, 0);
  assert.equal(s.sites.length, SITES.length, "a site went missing from the status file");

  const badger = s.sites.find((x) => x.host === "badgergrain.com");
  assert.equal(badger.reached, true);
  assert.equal(badger.stampField, "observed", "it should name which field it aged");
  assert.equal(badger.ageMinutes, 6);
  assert.equal(badger.rows, 1);
  assert.equal(badger.showsPrice, true);
  assert.equal(badger.spread, 0.1);
  assert.equal(badger.manualPrice, null);

  /* NO PRICE. The two sites publish prices; this repository does not, and a
     status file that grew a cash figure would be a second place to read one. */
  const text = JSON.stringify(s);
  assert.ok(!/"cashPrice"/.test(text), "the status file is carrying a price");
  assert.ok(!/4\.58/.test(text), "the status file is carrying a price");
});

test("a site that never answered says so, rather than going missing", async () => {
  const get = serve(okSite("badgergrain.com"));   // midwestcommodity answers 404
  const observed = {};
  const found = await watch({ now: NOW, get, observed });
  const s = buildStatus({ found, observed, now: NOW });

  const mid = s.sites.find((x) => x.host === "midwestcommodity.com");
  assert.ok(mid, "the unreachable site is absent from the file entirely");
  assert.equal(mid.reached, false);
  assert.equal(mid.ageMinutes, undefined, "it must not report an age it never measured");
  assert.equal(s.ok, false);
  assert.ok(s.blocking >= 1);
  assert.ok(s.findings.some((f) => f.site === "midwest" && f.severity === "critical"));
});

test("the verdict is report()'s, not a second opinion", async () => {
  const get = serve({
    ...okSite("badgergrain.com"),
    ...okSite("midwestcommodity.com"),
    /* 20 hours old and still showing a price: critical. */
    "https://midwestcommodity.com/bids.json": { status: 200, body: JSON.stringify({
      observed: new Date(NOW.getTime() - 20 * 3600e3).toISOString(),
      bids: [{ commodity: "Corn", delivery: "September", cashPrice: 4.48 }],
    }) },
  });
  const observed = {};
  const found = await watch({ now: NOW, get, observed });
  const r = report(found);
  const s = buildStatus({ found, observed, now: NOW });
  assert.equal(s.ok, r.ok);
  assert.equal(s.blocking, r.blocking);
  assert.deepEqual(s.findings.map((f) => f.what).sort(), found.map((f) => f.what).sort(),
    "the file's findings are not the ones the watcher raised");
});

test("`generated` moves even when nothing at all has changed", async () => {
  /* THE WHOLE POINT. A stamp that only advances when something is wrong cannot
     tell a quiet week from a watchdog that has stopped, which is the exact
     failure this watchdog was built to catch in the sites. */
  const get = serve({ ...okSite("badgergrain.com"), ...okSite("midwestcommodity.com") });
  const a = buildStatus({ found: [], observed: {}, now: NOW });
  const b = buildStatus({ found: [], observed: {}, now: new Date(NOW.getTime() + 7200e3) });
  assert.notEqual(a.generated, b.generated);
  assert.notEqual(JSON.stringify(a), JSON.stringify(b),
    "two runs two hours apart produce an identical file, so nothing would ever be committed");
  await get("https://badgergrain.com/");   // keep the fixture honest about being used
});

test("the file is written on the FAILING run too, and the run still fails", async () => {
  /* Executed, not read. The status of the run that goes red is the one somebody
     actually needs, and a file published only on the good days lies by
     omission. */
  const dir = mkdtempSync(join(tmpdir(), "emmert-status-"));
  const cwd = process.cwd();
  const realFetch = globalThis.fetch;
  const code = process.exitCode;
  try {
    process.chdir(dir);
    globalThis.fetch = async () => ({ status: 503, text: async () => "" });
    process.exitCode = 0;
    await main();
    assert.ok(existsSync(join(dir, STATUS_PATH)), "no status file was written on the failing run");
    const s = JSON.parse(readFileSync(join(dir, STATUS_PATH), "utf8"));
    assert.equal(s.ok, false, "the file claims everything is fine on a run that failed");
    assert.ok(s.findings.length >= 2, "both sites failing should both be named");
    assert.equal(process.exitCode, 1, "the run stopped failing, so nobody would notice");
  } finally {
    process.chdir(cwd);
    globalThis.fetch = realFetch;
    process.exitCode = code;
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ── the guards on the workflow, because a file nobody commits is no file ── */

test("the workflow can write, stages the file, and does it whatever happened", () => {
  /* COMMENTS ARE NOT COVERAGE, AND THIS TEST LEARNED THAT THE HARD WAY.
     The first version matched /if:\s*always\(\)/ against the whole file. The
     step's own comment begins "# if: always() BECAUSE THE FAILING RUN IS THE
     ONE THAT MATTERS", so deleting the actual directive left the test green —
     found by deleting it. Comments are stripped first now, and the directive is
     looked for inside the publish step rather than anywhere in the file. */
  const wf = read(".github/workflows/watch-live.yml").replace(/^\s*#.*$/gm, "");

  assert.match(wf, /permissions:\s*\n\s*contents:\s*write/,
    "watch-live.yml still has contents: read, so the push would be rejected");

  const start = wf.indexOf("- name: Publish what it saw");
  assert.ok(start > 0, "the publish step is gone; nothing commits status.json at all");
  const rest = wf.slice(start + 1);
  const end = rest.indexOf("- name:");
  const step = end < 0 ? rest : rest.slice(0, end);

  assert.match(step, /git add status\.json/, "the publish step does not stage status.json");
  assert.match(step, /if:\s*always\(\)/,
    "the publish step is not if: always(), so a failing run — the one that matters — "
    + "would never publish its status");
  assert.match(step, /git commit/, "the publish step stages but never commits");
  assert.match(step, /git push/, "the publish step commits but never pushes");
});

test("the committed status file is either the placeholder or a real one", () => {
  /* THE SHIPPED ARTEFACT, not the code that writes it. If this fails, look at
     whether watch-live.yml is committing before looking anywhere else. */
  const s = JSON.parse(read(STATUS_PATH));
  assert.equal(s.schema, STATUS_SCHEMA);
  assert.ok(Array.isArray(s.sites) && s.sites.length === SITES.length);

  if (s.generated === null) return;   // the placeholder committed with the change

  const ageH = (Date.now() - Date.parse(s.generated)) / 36e5;
  assert.ok(Number.isFinite(ageH), "generated is neither null nor a readable time");
  /* The watchdog runs five times a weekday and once a day at weekends, so 36
     hours covers a long weekend and still fails on a watcher that has stopped. */
  assert.ok(ageH < 36,
    `status.json was last written ${Math.round(ageH)}h ago. The watchdog runs at least `
    + `daily, so either it has stopped or it has stopped committing.`);
});
