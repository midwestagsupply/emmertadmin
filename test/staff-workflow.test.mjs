/* THE WORKFLOW THAT WRITES THE SITES HAD NO TEST.
 *
 * `deliver/site-workflow/staff-update.yml` is the only thing in this project
 * that commits to badgergrain and midwestcommodity. Every other moving part
 * had a suite; this one was shipped on reading.
 *
 * It cannot be run here -- it is GitHub Actions -- so this file splits the
 * job honestly:
 *
 *   the applier's contract is RUN. from-issue.mjs is executed for real, in a
 *   scratch directory, with a good form and with a bad one, and the file it
 *   leaves behind is inspected.
 *
 *   the workflow's wiring is PARSED. Not grepped for a happy string: the
 *   steps are pulled apart and the step that closes the issue is checked to
 *   be gated on the step that reads that file, by id.
 *
 * The defect this was written for: from-issue.mjs wrote /tmp/failed on a
 * refusal and NOTHING READ IT. A mistyped closing time was commented on the
 * issue and the issue was then closed as completed. The office's signal that
 * a change landed is the issue closing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const YML = readFileSync(join(ROOT, "deliver/site-workflow/staff-update.yml"), "utf8");

/* ---- the applier, actually run ---------------------------------------- */

const HOURS = {
  updated_at: "2026-08-01T12:00:00.000Z",
  days: { monday: { open: "07:00", close: "17:00" } },
};

function runApplier(body, { association = "OWNER" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "staffwf-"));
  writeFileSync(join(dir, "hours.json"), JSON.stringify(HOURS, null, 2));
  let status = 0, out = "";
  try {
    out = execFileSync(process.execPath, [join(ROOT, "tools/from-issue.mjs")], {
      cwd: dir,
      encoding: "utf8",
      /* from-issue.mjs writes /tmp/failed and /tmp/said at those exact paths,
         because the workflow's next step reads them there. It takes no
         environment variable for either, so passing one here would be a lie
         dressed as configuration: the tests below check the real path, and
         clear it first. Tests inside one file run in order, so they cannot
         race each other over it. */
      env: { ...process.env, BODY: body, WHO: association, BY: "jessie" },
    });
  } catch (e) { status = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
  return { dir, status, out, failed: existsSync("/tmp/failed") };
}

/* The form the screen actually builds. Headings come from the applier, not
   from this file -- if they drift, these read the drift. */
function form(lines) { return lines.join("\n"); }

test("a form the applier refuses leaves the refusal flag behind", () => {
  /* A closing time nobody can type on purpose. The point is not this
     particular string: it is that a refusal is a GREEN run, so the flag file
     is the only thing downstream can key on. */
  try { rmSync("/tmp/failed", { force: true }); } catch {}
  const r = runApplier(form([
    "### Monday",
    "",
    "open 7:00am close half past never",
  ]));
  assert.equal(r.failed, true,
    "the applier refused and left no flag — nothing downstream can tell");
});

test("a run that changes nothing still refuses rather than reporting success", () => {
  try { rmSync("/tmp/failed", { force: true }); } catch {}
  const r = runApplier("", { association: "NONE" });
  assert.equal(r.failed, true,
    "somebody without write access got a run that looks like it worked");
});

/* ---- the workflow, parsed --------------------------------------------- */

/* Pull `- name:`-led steps out of the job. Crude, but it is reading
   structure, not searching for a word: each step keeps its own body, so a
   condition found in one step cannot be credited to another. */
function steps(yml) {
  const out = [];
  const lines = yml.split("\n");
  let cur = null;
  for (const ln of lines) {
    const m = /^      - name:\s*(.+?)\s*$/.exec(ln);
    if (m) { if (cur) out.push(cur); cur = { name: m[1], body: [] }; continue; }
    if (cur) {
      if (/^      - /.test(ln)) { out.push(cur); cur = null; continue; }
      cur.body.push(ln);
    }
  }
  if (cur) out.push(cur);
  /* COMMENTS ARE NOT BODY. The first version of this parser kept them, and a
     comment ABOVE a step -- which YAML indents with the step below it, but a
     line-oriented reader hands to the step above -- made "Say what happened"
     look like the step that reads the refusal flag, because the comment
     explaining the flag mentions it by name. The test then failed on the
     wrong step and would have passed on the wrong step just as easily. */
  const uncomment = (b) => b.filter((ln) => !/^\s*#/.test(ln)).join("\n");
  return out.map((s) => ({ ...s, body: uncomment(s.body) }));
}

const STEPS = steps(YML);

test("the workflow has a step that reads the refusal flag, and it has an id", () => {
  const reader = STEPS.find((s) => /\/tmp\/failed/.test(s.body));
  assert.ok(reader, "no step reads /tmp/failed — the flag is written and ignored");
  const id = /^\s*id:\s*(\S+)/m.exec(reader.body);
  assert.ok(id, "the step that reads the flag has no id, so nothing can depend on it");
  assert.match(reader.body, /if:\s*always\(\)/,
    "the flag reader is skipped when an earlier step fails, which is when it matters most");
  assert.match(reader.body, /GITHUB_OUTPUT/,
    "the flag is read but not published as a step output");
});

test("closing the issue is gated on the applier having accepted it", () => {
  const reader = STEPS.find((s) => /\/tmp\/failed/.test(s.body));
  const id = /^\s*id:\s*(\S+)/m.exec(reader.body)[1];
  const close = STEPS.find((s) => /gh issue close/.test(s.body));
  assert.ok(close, "no step closes the issue");
  const cond = /^\s*if:\s*(.+)$/m.exec(close.body);
  assert.ok(cond, "the close step has no condition at all — it closes every issue it sees");
  assert.match(cond[1], new RegExp(`steps\\.${id}\\.outputs\\.`),
    `the close step does not consult steps.${id} — a refused form still closes the issue as completed`);
  assert.match(cond[1], /success\(\)/,
    "the close step no longer requires the earlier steps to have succeeded");
});

test("the comment on the issue is posted whatever happened", () => {
  const say = STEPS.find((s) => /gh issue comment/.test(s.body));
  assert.ok(say, "nothing comments on the issue");
  assert.match(say.body, /if:\s*always\(\)/,
    "a failed run says nothing on the issue, so the office is left waiting");
});

test("the applier is checked out and gated on its own tests before it writes", () => {
  const check = STEPS.find((s) => /node --test/.test(s.body));
  assert.ok(check, "the applier is run against the live sites without running its suite");
  const apply = STEPS.findIndex((s) => /from-issue\.mjs/.test(s.body));
  const checkAt = STEPS.indexOf(check);
  assert.ok(checkAt < apply && apply !== -1,
    "the applier's tests run after it has already written the files");
});

test("only issues the screen opened are treated as forms", () => {
  assert.match(YML, /if:\s*startsWith\(github\.event\.issue\.title,\s*'Update '\)/,
    "a bug report filed on the site repository would be run as a form");
});

test("the workflow fires on edit, so a refused form can be corrected in place", () => {
  assert.match(YML, /types:\s*\[opened,\s*edited\]/,
    "a refused issue can never be re-applied by fixing it");
});

/* ---- the change has to reach the PAGE, not just the repository ---------
 *
 * hours.json and pricing.json are data. What a farmer reads is baked into
 * index.html by the site's own `Hours` and `Prices` jobs -- including the
 * hours the in-page clock works from, which live in the today-hours JSON
 * island. A commit that nothing renders is invisible.
 *
 * And the commit above cannot start those jobs by itself: it is pushed with
 * GITHUB_TOKEN, and GitHub does not start workflows from GITHUB_TOKEN pushes.
 * `Prices` would catch up at its next cron; `Hours` runs around 8am, 5pm and
 * midnight Central, so "closed today" set at 7am would appear at 5pm.
 */

test("a committed change starts the jobs that render it", () => {
  const kick = STEPS.find((s) => /gh workflow run/.test(s.body));
  assert.ok(kick,
    "nothing starts Hours or Prices — the change sits in the repository until the next cron");
  assert.match(kick.body, /gh workflow run hours\.yml/,
    "Hours is not started; its cron is ~8am/5pm/midnight Central");
  assert.match(kick.body, /gh workflow run prices\.yml/,
    "Prices is not started");
});

test("the jobs are only started when something was actually committed", () => {
  const commit = STEPS.find((s) => /git push/.test(s.body));
  const id = /^\s*id:\s*(\S+)/m.exec(commit.body);
  assert.ok(id, "the commit step has no id, so the kick cannot depend on it");
  assert.match(commit.body, /GITHUB_OUTPUT/,
    "the commit step does not report whether it pushed");
  const kick = STEPS.find((s) => /gh workflow run/.test(s.body));
  const cond = /^\s*if:\s*(.+)$/m.exec(kick.body);
  assert.ok(cond, "the kick runs unconditionally, burning two runs on every refused form");
  assert.match(cond[1], new RegExp(`steps\\.${id[1]}\\.outputs\\.`),
    "the kick does not consult the commit step");
});

test("the job is granted the permission that dispatching needs", () => {
  /* Starting a workflow is `actions: write`. The default token in a job that
     asks for `contents: write` does NOT have it, and the failure is a 403 on
     one line of a green run -- the exact shape of a fix that is not there. */
  /* Read the block by indentation, not with a regular expression. The first
     attempt here was /^permissions:\n((?:\s+.*\n)+?)(?=\S)/m, and because
     \s matches a newline and .* matches nothing, that pattern backtracks
     exponentially: the whole suite hung rather than failing. A test that can
     hang is worse than a test that is wrong. */
  const lines = YML.split("\n");
  const at = lines.findIndex((l) => /^permissions:\s*$/.test(l));
  assert.notEqual(at, -1, "no permissions block");
  const block = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    if (lines[i].trim() === "") continue;
    if (/^\s*#/.test(lines[i])) continue;
    block.push(lines[i]);
  }
  const body = block.join("\n");
  assert.match(body, /actions:\s*write/,
    "gh workflow run will 403; the change waits for the cron and nothing says so");
});
