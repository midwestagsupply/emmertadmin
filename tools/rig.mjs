#!/usr/bin/env node
/* COUNT THE REQUESTS AND TIME THE PASS. A MEASURING TOOL, NOT A TEST.
 * ==========================================================================
 *
 * Every number in lib/routes.mjs's head start and deadline comments, and in
 * the "what one run costs their host" note in test/mirror.test.mjs, was
 * produced by this file. It is here so those numbers can be reproduced rather
 * than believed.
 *
 * It starts a local HTTP server that logs every hit and can be told to answer
 * 503, to hang, to serve a torn board, or to serve one with a column blanked;
 * copies this repository to a temporary directory; rewrites
 * sources/boyceville.json so every route points at that server; and runs the
 * REAL scripts/read.mjs against it as a child process. What is measured is the
 * shipped file, not a paraphrase of it.
 *
 *   node tools/rig.mjs . healthy
 *   node tools/rig.mjs . primary-hangs --primary-delay=8000
 *   node tools/rig.mjs . primary-hangs --primary-delay=2000 --head-start=500
 *   node tools/rig.mjs . all-503 --races=5
 *   node tools/rig.mjs . cash-broken
 *
 * Scenarios: healthy, primary-hangs, primary-503, all-503, cash-broken,
 * two-broken, torn, shell, black-hole. `--races N` also runs the push-race
 * re-read N times, which is what one workflow run can do. `--seed-failing`
 * writes a long run of failures into data/index.json first, which is what the
 * gated version needed before it would walk its ladder; it changes nothing
 * now and is kept so the two designs can be measured the same way.
 *
 * It writes nothing into this repository: everything happens in a copy.
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const [, , REPO_ARG, SCENARIO, ...rest] = process.argv;
const REPO = REPO_ARG ? new URL(REPO_ARG, `file://${process.cwd()}/`).pathname
                      : new URL("..", import.meta.url).pathname;
const RACES = Number((rest.find((a) => a.startsWith("--races=")) || "--races=0").split("=")[1]);
const HEAD = rest.find((a) => a.startsWith("--head-start=")); // ms, patched into the copy
const DELAY = Number((rest.find((a) => a.startsWith("--primary-delay=")) || "--primary-delay=8000").split("=")[1]);

/* ---- the boards this server can serve ---------------------------------- */
const board = readFileSync(join(REPO, "fixtures/bigriver-2121.html"), "utf8");

/* Only the panel keyed 2121 is touched: the other locations on the page stay
   exactly as they are, which is what their real page looks like when one
   column of one panel fails to render. */
const blank = (html, cls) => html.replace(
  new RegExp(`(<ul class='sixColumnsBigFirst fcControls[12]'><li class='c1'>(?:(?!<\\/ul>).)*?CashBidsLocationID=2121(?:(?!<\\/ul>).)*?<li class='${cls}'>)[^<]*(<\\/li>)`, "g"),
  "$1$2");

const CASH_BROKEN = blank(board, "c2");
/* Two of the three gone and the row still there: their Bid and their Futures
   cells blank, the Basis cell fine. Blanking Bid AND Basis instead makes the
   row vanish from the parse altogether, which is a different failure. */
const TWO_BROKEN = blank(blank(board, "c2"), "c4");
/* A torn read: one cash cell a tick out of step with its own quote. */
const TORN = board.replace("<li class='c2'>4.0750</li>", "<li class='c2'>4.0775</li>");
const SHELL = "<html><body><div>nothing here</div></body></html>";

/* ---- what each route gets ---------------------------------------------- */
/* answer(path, hitNumber) -> {status, body, delayMs} */
function answerFor(scenario) {
  const isPrimary = (p) => p === "/cashbidssingle-2121";
  switch (scenario) {
    case "healthy":
      return () => ({ status: 200, body: board });
    case "primary-hangs":
      /* The primary answers, eventually. Everything else is fine. */
      return (p) => isPrimary(p) ? { status: 200, body: board, delayMs: DELAY }
                                 : { status: 200, body: board };
    case "primary-503":
      return (p) => isPrimary(p) ? { status: 503, body: "" } : { status: 200, body: board };
    case "all-503":
      return () => ({ status: 503, body: "" });
    case "cash-broken":
      return () => ({ status: 200, body: CASH_BROKEN });
    case "two-broken":
      return () => ({ status: 200, body: TWO_BROKEN });
    case "torn":
      return () => ({ status: 200, body: TORN });
    case "shell":
      return () => ({ status: 200, body: SHELL });
    case "black-hole":
      /* Never answers at all. */
      return () => ({ status: 200, body: board, delayMs: 10 * 60 * 1000 });
    default:
      throw new Error(`no scenario ${scenario}`);
  }
}

const hits = [];
const answer = answerFor(SCENARIO);
const open = new Set();
const server = createServer((req, res) => {
  const t = Date.now();
  const path = req.url;
  hits.push({ path, at: t });
  const a = answer(path, hits.filter((h) => h.path === path).length);
  const send = () => {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(a.status, { "content-type": "text/html" });
    res.end(a.body);
  };
  if (a.delayMs) {
    const timer = setTimeout(send, a.delayMs);
    open.add(timer);
    /* An aborted request shows up here as the socket closing. Recorded so the
       table can say whether an abort really cancelled the request. */
    res.on("close", () => {
      if (!res.writableEnded) {
        clearTimeout(timer);
        open.delete(timer);
        hits[hits.length - 1].aborted = true;
      }
    });
  } else send();
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

/* ---- the repository under test, with the manifest pointed here ---------- */
const dir = mkdtempSync(join(tmpdir(), "rig-"));
cpSync(REPO, dir, { recursive: true, filter: (s) => !/\/(\.git|node_modules)(\/|$)/.test(s) });
const manifestPath = join(dir, "sources/boyceville.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const local = (u) => { const x = new URL(u); return base + x.pathname + x.search; };
manifest.url = local(manifest.url);
/* Two routes can collapse onto one local URL once the host is dropped (the www
   twin is the same path). Kept anyway: the count is what the reader really
   asks, and a collapsed pair is still two requests. */
manifest.routes = (manifest.routes || []).map((r) => ({ ...r, url: local(r.url) }));
/* aliasOrThrow compares host and path; on one local host the www twin becomes
   the same URL as the primary, which routesFor would dedupe. Give it a
   distinguishable query so every route is still asked separately. */
const seen = new Set([manifest.url]);
manifest.routes = manifest.routes.map((r) => {
  let u = r.url;
  if (seen.has(u)) u = u + (u.includes("?") ? "&" : "?") + "twin=" + Math.random().toString(36).slice(2, 6);
  seen.add(u);
  return { ...r, url: u, tier: r.tier === "alias" ? "break-glass" : r.tier };
});
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

/* A pass that has already been failing for hours, which is what opened the
   gated ladder. Written into the same two fields the gate and the alarm read,
   so nothing here reaches past the shipped reader's own inputs. */
if (rest.includes("--seed-failing")) {
  const ip = join(dir, "data/index.json");
  const idx = JSON.parse(readFileSync(ip, "utf8"));
  const row = idx.sources.find((x) => x.id === "boyceville");
  row.health = "refused"; row.status = "refused"; row.fails = 6;
  row.failingSince = new Date(Date.now() - 3 * 3600e3).toISOString();
  writeFileSync(ip, JSON.stringify(idx, null, 1) + "\n");
}

/* ---- run the real reader ------------------------------------------------ */
if (HEAD) {
  const rp = join(dir, "lib/routes.mjs");
  const src = readFileSync(rp, "utf8")
    .replace(/export const HEAD_START_MS = \d+;/, `export const HEAD_START_MS = ${HEAD.split("=")[1]};`);
  writeFileSync(rp, src);
}
const feedBefore = (() => { try { return readFileSync(join(dir, "data/boyceville.json"), "utf8"); }
                            catch { return null; } })();
/* The gated version counted a run's requests into this file; the ungated one
   ignores the variable entirely. Set either way so the comparison is fair to
   the design that used it. */
const env = { ...process.env, BOYCEVILLE_RUN_REQUESTS: join(dir, "run-requests") };
function once(args = []) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, ["scripts/read.mjs", ...args], { cwd: dir, env });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.on("close", (code) => resolve({ code, ms: Date.now() - t0, out }));
  });
}

const runs = [await once([])];
/* The push-race re-read. The gated version restricted it to the arranged URL;
   the ungated one has no such flag, so ask the reader itself what it takes. */
const reReadFlags = readFileSync(join(dir, "scripts/read.mjs"), "utf8").includes("--primary-only")
  ? ["--primary-only"] : [];
for (let i = 0; i < RACES; i++) runs.push(await once(reReadFlags));

const feed = (() => { try { return JSON.parse(readFileSync(join(dir, "data/boyceville.json"), "utf8")); }
                      catch { return null; } })();
const index = (() => { try { return JSON.parse(readFileSync(join(dir, "data/index.json"), "utf8")); }
                       catch { return null; } })();

console.log(JSON.stringify({
  scenario: SCENARIO, races: RACES,
  seededFailing: rest.includes("--seed-failing"),
  requests: hits.length,
  aborted: hits.filter((h) => h.aborted).length,
  seconds: Number((runs.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(2)),
  perRun: runs.map((r) => ({ ms: r.ms, code: r.code })),
  paths: hits.reduce((m, h) => (m[h.path] = (m[h.path] || 0) + 1, m), {}),
  health: index?.sources?.[0]?.health ?? null,
  rows: index?.sources?.[0]?.rows ?? null,
  checkedAt: index?.sources?.[0]?.checkedAt ?? null,
  via: index?.sources?.[0]?.via ?? null,
  reconstructed: index?.sources?.[0]?.reconstructed ?? null,
  feedRows: feed?.bids?.length ?? null,
  feedUnchanged: feedBefore !== null
    && feedBefore === (() => { try { return readFileSync(join(dir, "data/boyceville.json"), "utf8"); }
                               catch { return null; } })(),
  feedMarks: (feed?.bids ?? []).filter((b) => b.reconstructed).map((b) => `${b.delivery}:${b.reconstructed}`),
  detail: String(index?.sources?.[0]?.detail ?? "").slice(0, 300),
  log: runs.map((r) => r.out).join("\n---\n"),
}, null, 1));

for (const t of open) clearTimeout(t);
server.close();
rmSync(dir, { recursive: true, force: true });
process.exit(0);
