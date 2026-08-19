/* The staff screen itself, driven in a real browser.
 *
 * WHY THIS FILE EXISTS. Until 2026-08-19 this repository's only test file was
 * admin.test.mjs, which covers tools/apply-update.mjs -- the GitHub issue-form
 * path, whose field names are entirely different ("Are you open today?",
 * "Opens", "Our spread under Big River") from this screen's (today, open,
 * spread). Coverage of index.html was ZERO, and the suite was green throughout.
 * That is how a form could post "we are open on different hours today" with no
 * hours in it, and how pressing Back could silently disable the boxes the
 * answer above them depends on.
 *
 * A green suite that does not touch the artefact is worse than no suite: it
 * reads as coverage from the outside.
 *
 * Every test below is a defect that was live on 2026-08-19, or a guarantee
 * somebody depends on. The screen is loaded from file:// with no Worker, so
 * these test what staff can and cannot do, not what the Worker then does.
 *
 * SKIPS RATHER THAN FAILS WITHOUT PLAYWRIGHT. This repo has no package.json
 * and is uploaded by hand through the GitHub web UI; `node --test test/*.mjs`
 * has to keep working on a machine that has never installed a browser. CI
 * installs one -- see .github/workflows/test.yml -- so these do run somewhere
 * on every push.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

let chromium = null;
try {
  const mod = await import("playwright");
  chromium = mod.chromium || (mod.default && mod.default.chromium);
} catch {
  try {
    const mod = await import("/home/claude/.npm-global/lib/node_modules/playwright/index.js");
    chromium = mod.chromium || (mod.default && mod.default.chromium);
  } catch { /* left null on purpose */ }
}
const NO_BROWSER = chromium ? false : "playwright is not installed; screen tests skipped";

/* The live screen differs from a copy only by data-live on <html>: the copy
   disables Save. Both states are worth testing and both are built here rather
   than mutated in place, so the repo is never edited by its own tests. */
let dir, browser, LIVE, COPY;
before(async () => {
  if (NO_BROWSER) return;
  dir = mkdtempSync(join(tmpdir(), "screen-"));
  const html = readFileSync(join(REPO, "index.html"), "utf8");
  assert.match(html, /<html lang="en"/, "the shape this fixture assumes");
  writeFileSync(join(dir, "copy.html"), html);
  writeFileSync(join(dir, "live.html"), html.replace('<html lang="en"', '<html lang="en" data-live="1"'));
  writeFileSync(join(dir, "admin.css"), readFileSync(join(REPO, "admin.css")));
  /* The logos and the webfont come along, so a missing-resource error in the
     console is a real one rather than an artefact of the fixture. */
  for (const d of ["assets", "fonts"]) {
    mkdirSync(join(dir, d), { recursive: true });
    for (const f of readdirSync(join(REPO, d)))
      writeFileSync(join(dir, d, f), readFileSync(join(REPO, d, f)));
  }
  LIVE = "file://" + join(dir, "live.html");
  COPY = "file://" + join(dir, "copy.html");
  browser = await chromium.launch();
});
after(async () => {
  if (browser) await browser.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const open = async (url = LIVE, q = "?site=badger", viewport = { width: 1100, height: 900 }) => {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url + q, { waitUntil: "load" });
  await page.waitForTimeout(150);
  page.errors = errors;
  return page;
};
const rows = (p) => p.$$eval("#prevWeek .prev-wrow", (r) =>
  r.map((x) => [...x.children].map((c) => c.textContent)));
const note = (p) => p.$eval("#checkNote", (e) => (e.hidden ? null : e.textContent));

/* ---- the report that started it ----------------------------------------- */

test("CLOSING A DAY SHOWS UP IN THE PREVIEW IMMEDIATELY", { skip: NO_BROWSER }, async () => {
  /* Jesse Cebulla, 2026-08-19: "When I update the hours (we are not open
     Saturdays) it is not reflected in the hours window on the site." Two
     faults met on that one task -- the site was not rendering the weekly rows,
     and this screen would not tell him what it was about to publish. This is
     the second half. */
  const p = await open();
  assert.deepEqual(await rows(p), [
    ["Mon to Fri", "8:00a to 5:00p"], ["Saturday", "8:00a to 12:00p"], ["Sunday", "Closed"],
  ], "the preview starts by agreeing with the boxes");
  await p.check("[name=sat_closed]");
  assert.deepEqual((await rows(p))[1], ["Saturday", "Closed"], "and moves the moment the box is ticked");
  await p.uncheck("[name=sat_closed]");
  assert.deepEqual((await rows(p))[1], ["Saturday", "8:00a to 12:00p"], "and back again");
  await p.close();
});

test("the preview follows the times, not just the closed box", { skip: NO_BROWSER }, async () => {
  const p = await open();
  await p.fill("[name=wk_open]", "06:30");
  await p.fill("[name=wk_close]", "19:00");
  assert.deepEqual((await rows(p))[0], ["Mon to Fri", "6:30a to 7:00p"]);
  await p.close();
});

test("a preview it cannot compute says Closed, exactly as the site publishes it",
  { skip: NO_BROWSER }, async () => {
  /* weeklyRows() in the sites' update-today.mjs prints "Closed" for a blank or
     unreadable span. If this screen guessed differently it would be a
     confident lie, which is worse than the blank it replaced. */
  const p = await open();
  await p.fill("[name=sat_open]", "");
  assert.deepEqual((await rows(p))[1], ["Saturday", "Closed"]);
  await p.close();
});

test("the summary beside “usual hours” is derived, not hand-typed", { skip: NO_BROWSER }, async () => {
  /* It was a fixed string, identical on both elevators, describing hours the
     table beneath it could contradict -- on the option staff are told to leave
     selected, so the sentence most likely to be believed and least likely to
     be checked. */
  const p = await open();
  await p.check("[name=sat_closed]");
  await p.fill("[name=wk_close]", "18:00");
  assert.equal(await p.$eval("#usualSummary", (e) => e.textContent),
    "8:00a to 6:00p weekdays, closed Saturday");
  await p.close();
});

/* ---- what customers will see, for today --------------------------------- */

test("TICKING “CLOSED TODAY” CHANGES WHAT THE PREVIEW SAYS", { skip: NO_BROWSER }, async () => {
  /* It did not. Three boxes carry the label "What customers will see"; this
     one was server-rendered filler that never moved, so you could tick Closed
     today and it went on saying "Open today, Friday, 8:00a to 5:00p". A
     preview that does not track its control answers the question wrongly
     instead of leaving it open. */
  const p = await open();
  const before = await p.$eval("#prevToday .l", (e) => e.textContent);
  await p.check("input[name=today][value=closed]");
  const after = await p.$eval("#prevToday", (e) => e.textContent);
  assert.notEqual(await p.$eval("#prevToday .l", (e) => e.textContent), before);
  assert.match(after, /^Closed today, /);
  assert.match(after, /Closed$/);
  await p.close();
});

test("“different hours” previews the times typed under it", { skip: NO_BROWSER }, async () => {
  const p = await open();
  await p.check("input[name=today][value=custom]");
  await p.fill("#o", "06:00");
  await p.fill("#c", "19:30");
  assert.equal(await p.$eval("#prevToday .h", (e) => e.textContent), "6:00a to 7:30p");
  await p.close();
});

/* ---- a day that is open has to say when --------------------------------- */

test("“OPEN, DIFFERENT HOURS” WITH THE BOXES BLANK IS REFUSED", { skip: NO_BROWSER }, async () => {
  /* It posted open="" and close="" and navigated away looking like a success.
     Nothing checked it: problems() only looked at the money boxes, and a
     type=time input has no required attribute. The screen announced the
     elevator was open on hours it declined to name. */
  const p = await open();
  await p.check("input[name=today][value=custom]");
  await p.fill("#o", "");
  await p.fill("#c", "");
  await p.click(".btn-go");
  await p.waitForTimeout(120);
  assert.match(await note(p), /times are not filled in/);
  assert.ok(p.url().includes("live.html"), "it did not submit");
  assert.equal(await p.$eval("#o", (e) => e.getAttribute("aria-invalid")), "true",
    "and the box at fault is marked, not just described");
  await p.close();
});

test("a weekly day left open with no hours is refused too", { skip: NO_BROWSER }, async () => {
  /* Unticking Sunday's Closed box leaves two blank time inputs -- that is the
     shipped state of those two fields, so this is one click away. */
  const p = await open();
  await p.uncheck("[name=sun_closed]");
  await p.click(".btn-go");
  await p.waitForTimeout(120);
  assert.match(await note(p), /Sunday is not marked closed but has no hours/);
  await p.close();
});

test("a form with nothing wrong with it does submit", { skip: NO_BROWSER }, async () => {
  /* The other half of a guard: it has to let the ordinary case through. */
  const p = await open();
  await p.uncheck("[name=sun_closed]");
  await p.fill("[name=sun_open]", "09:00");
  await p.fill("[name=sun_close]", "13:00");
  /* Asserted on the submit event rather than the address: this fixture is
     file://, so the POST cannot land anywhere. What matters is that the event
     fired and nothing on the page cancelled it. The listener goes on LAST, so
     it sees whatever the screen's own handler already did. */
  await p.evaluate(() => {
    window.__submitted = null;
    document.querySelector("form").addEventListener("submit", function (e) {
      window.__submitted = !e.defaultPrevented;
      e.preventDefault();                       // keep the fixture on the page
    });
  });
  await p.click(".btn-go");
  await p.waitForTimeout(150);
  const submitted = await p.evaluate(() => window.__submitted);
  const why = await note(p);
  await p.close();
  assert.equal(submitted, true, "the form submitted; the screen said: " + why);
});

test("the complaint announces itself and takes focus", { skip: NO_BROWSER }, async () => {
  /* It had no role and moved focus nowhere, and it was appended inside the
     collapsed "post a price by hand" drawer -- so a complaint about the cash
     basis, a field outside that drawer, was printed hundreds of pixels away
     inside a panel the handler had to force open to show it. */
  const p = await open();
  await p.fill("#off", "abc");
  await p.click(".btn-go");
  await p.waitForTimeout(120);
  assert.equal(await p.$eval("#checkNote", (e) => e.getAttribute("role")), "alert");
  assert.equal(await p.evaluate(() => document.activeElement.id), "checkNote");
  assert.equal(await p.$eval(".byhand", (e) => e.open), false,
    "and the by-hand drawer is left alone for a fault outside it");
  await p.close();
});

/* ---- coming back -------------------------------------------------------- */

test("PRESSING BACK DOES NOT LEAVE THE ANSWER AND ITS BOXES DISAGREEING",
  { skip: NO_BROWSER }, async () => {
  /* The browser restores what was typed AFTER the inline script has run and
     fires no events, so the radio came back as "open, different hours" while
     the two time boxes came back disabled -- and disabled boxes are not
     submitted. Saving again posted the answer with no hours, silently. Back is
     what you press when the save was refused. */
  const p = await open();
  await p.check("input[name=today][value=custom]");
  await p.fill("#o", "06:00");
  await p.fill("#c", "19:00");
  await p.click(".btn-go").catch(() => {});
  await p.waitForTimeout(200);
  await p.goBack({ waitUntil: "load" });
  await p.waitForTimeout(200);
  const state = await p.evaluate(() => ({
    picked: (document.querySelector('input[name="today"]:checked') || {}).value,
    oDisabled: document.getElementById("o").disabled,
    cDisabled: document.getElementById("c").disabled,
  }));
  assert.equal(state.picked, "custom");
  assert.equal(state.oDisabled, false, "the box the restored answer depends on is live");
  assert.equal(state.cDisabled, false);
  await p.close();
});

/* ---- filler ------------------------------------------------------------- */

test("A BOX STILL HOLDING THE VALUE IT SHIPPED WITH IS MARKED", { skip: NO_BROWSER }, async () => {
  /* All seven original markers were on display elements -- the board, the read
     time, the previews -- while ten form controls shipped filled in and none
     carried one. So the README's promise, "anything still marked is something
     it could not fill", was unenforceable for exactly the fields that get
     written back: a Worker that failed to fill the spread left 0.10 showing
     with no outline, and the first Save wrote it over the real one. */
  const p = await open();
  const marked = await p.$$eval("input.sample", (e) => e.map((x) => x.name).sort());
  assert.deepEqual(marked,
    ["close", "open", "sat_close", "sat_open", "spread", "wk_close", "wk_open"]);
  await p.close();
});

test("A SCREEN THE WORKER FILLED SAYS NOTHING ABOUT FILLER", { skip: NO_BROWSER }, async () => {
  /* THE FALSE ALARM THIS EXISTS TO STOP.
   *
   * Marking a box as filler because it still holds the value the file ships
   * with cannot tell "nothing filled this" from "the real answer happens to be
   * the same". On the live screen it got all three wrong at once: the spread
   * is 0.10, the weekday hours are 08:00 and 17:00, and those are exactly the
   * shipped values. So a correctly working screen told the office that three
   * parts of it were filler.
   *
   * A warning on a clean screen is worse than no warning, because it teaches
   * people to ignore the red outline before the day it is right.
   *
   * The Worker removes data-sample from the DISPLAY elements when it renders,
   * so their absence is proof it ran. Only when they are still present is the
   * value test allowed to speak. */
  const dir = mkdtempSync(join(tmpdir(), "filled-"));
  const html = readFileSync(join(REPO, "index.html"), "utf8");
  writeFileSync(join(dir, "f.html"), html
    .replace('<html lang="en"', '<html lang="en" data-live="1"')
    .replace(/ data-sample(?=[ >])/g, ""));          // what the Worker leaves behind
  writeFileSync(join(dir, "admin.css"), readFileSync(join(REPO, "admin.css")));
  const p = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await p.goto("file://" + join(dir, "f.html") + "?site=badger", { waitUntil: "load" });
  await p.waitForTimeout(200);
  const outlined = await p.$$eval(".sample", (e) => e.length);
  const warns = await p.$$eval("#adminWarn p, .warn p", (e) => e.map((x) => x.textContent));
  await p.close();
  rmSync(dir, { recursive: true, force: true });
  assert.equal(outlined, 0, "nothing is outlined on a screen that was filled");
  assert.deepEqual(warns.filter((w) => /filler/.test(w)), [], "and nothing is said about filler");
});

test("typing in a box clears its filler mark", { skip: NO_BROWSER }, async () => {
  /* An answer somebody has just typed is not filler, whatever the Worker did
     or did not do. */
  const p = await open();
  await p.fill("#off", "0.14");
  await p.waitForTimeout(60);
  assert.equal(await p.$eval("#off", (e) => e.hasAttribute("data-sample")), false);
  await p.close();
});

test("a copy opened off the desktop shows the outlines too", { skip: NO_BROWSER }, async () => {
  /* The guard read `if (samples.length && live)`, so the one place every value
     on the screen is filler -- a copy -- was the one place nothing was
     outlined, and the README said the opposite. */
  const p = await open(COPY);
  assert.ok((await p.$$eval(".sample", (e) => e.length)) > 0);
  const warns = await p.$$eval("#adminWarn p, .warn p", (e) => e.map((x) => x.textContent));
  assert.ok(warns.some((w) => /copy of the screen/.test(w)), "still says it is a copy");
  assert.ok(warns.some((w) => /still showing filler/.test(w)), "and says what is filler");
  await p.close();
});

/* ---- which elevator ----------------------------------------------------- */

test("the address is matched whatever its case, and an unknown one warns",
  { skip: NO_BROWSER }, async () => {
  /* The value was normalised but the KEY was not, so ?SITE=midwest came back
     undefined, fell through to Badger, and could not trip the warning. Editing
     one elevator while the heading names the other is the one mistake on this
     screen that costs money. */
  let p = await open(LIVE, "?SITE=midwest");
  assert.match(await p.$eval("form", (e) => e.getAttribute("action")), /site=midwest/);
  await p.close();
  p = await open(LIVE, "?site=bogus");
  assert.match(await p.$eval("form", (e) => e.getAttribute("action")), /site=badger/);
  assert.ok((await p.$$eval("#adminWarn p, .warn p", (e) => e.map((x) => x.textContent)))
    .some((w) => /site=bogus/.test(w)), "and it says so");
  await p.close();
});

/* ---- the office on a phone ---------------------------------------------- */

test("ON A PHONE EVERY “CLOSED” BOX IS ON THE SCREEN", { skip: NO_BROWSER }, async () => {
  /* Measured at 390px before the fix: the weekly table rendered 590px wide
     inside a 354px card with overflow:hidden, so all three Closed boxes sat
     off the right edge with no scrollbar and nothing to pan. The single thing
     an office is most likely to do from a phone could not be done at all. */
  const p = await open(LIVE, "?site=badger", { width: 390, height: 844 });
  for (const n of ["wk_closed", "sat_closed", "sun_closed"]) {
    const fits = await p.$eval(`[name=${n}]`, (e) => {
      const b = e.getBoundingClientRect();
      return b.left >= 0 && b.right <= document.documentElement.clientWidth && b.width > 0;
    });
    assert.ok(fits, `${n} is on the screen at 390px`);
  }
  assert.equal(await p.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth), false,
    "and the page itself does not scroll sideways");
  await p.close();
});

test("the We pay column can be reached at 390px", { skip: NO_BROWSER }, async () => {
  /* It was clipped 40px outside a container whose overflow was hidden -- the
     one figure the elevator actually pays. */
  const p = await open(LIVE, "?site=badger", { width: 390, height: 844 });
  assert.equal(await p.$eval(".board", (e) => getComputedStyle(e).overflowX), "auto");
  assert.ok(await p.$eval(".board", (e) => e.scrollWidth > e.clientWidth) === false
    || await p.$eval(".board", (e) => { e.scrollLeft = e.scrollWidth; return e.scrollLeft > 0; }),
    "and it really does scroll");
  await p.close();
});

test("the sticky save bar does not sit on top of the field you are in",
  { skip: NO_BROWSER }, async () => {
  /* Measured at 390px: the focused hours-note box was 96px tall and 96px of it
     was behind the bar. WCAG 2.2 SC 2.4.11. */
  const p = await open(LIVE, "?site=badger", { width: 390, height: 844 });
  await p.focus("#hn");
  await p.waitForTimeout(200);
  const covered = await p.evaluate(() => {
    const a = document.getElementById("hn").getBoundingClientRect();
    const s = document.querySelector(".save").getBoundingClientRect();
    return Math.max(0, Math.min(a.bottom, s.bottom) - Math.max(a.top, s.top));
  });
  assert.equal(Math.round(covered), 0);
  await p.close();
});

test("a closed row does not grey out the box that reopens it", { skip: NO_BROWSER }, async () => {
  /* .is-off and tr.is-off td both matched, so cells rendered at .5 x .55 =
     .275 -- 1.87:1 against white. On the row whose only enabled control is the
     way back. */
  const p = await open();
  await p.check("[name=sun_closed]");
  const o = await p.$eval("[name=sun_closed]", (e) => {
    let n = e, acc = 1;
    while (n && n !== document.body) { acc *= parseFloat(getComputedStyle(n).opacity); n = n.parentElement; }
    return acc;
  });
  assert.ok(o > 0.99, "the Closed control is at full opacity, got " + o);
  await p.close();
});

/* ---- things that must simply not be broken ------------------------------ */

test("the screen loads clean on every address it accepts", { skip: NO_BROWSER }, async () => {
  for (const q of ["?site=badger", "?site=midwest", "?site=bogus", "", "?SITE=MIDWEST"]) {
    const p = await open(LIVE, q);
    assert.deepEqual(p.errors, [], "console/page errors on " + (q || "(no query)"));
    await p.close();
  }
});

test("every control still has a name, and the two buttons still do not",
  { skip: NO_BROWSER }, async () => {
  const p = await open();
  const unnamed = await p.$$eval("input,select,textarea", (els) =>
    els.filter((e) => !e.name).map((e) => e.id || e.outerHTML.slice(0, 60)));
  assert.deepEqual(unnamed, []);
  await p.close();
});

test("the counters are tied to their boxes", { skip: NO_BROWSER }, async () => {
  /* The browser stops accepting keystrokes at maxlength, which reads like a
     broken keyboard. The count was on screen but attached to nothing, so it
     did not reach anyone who was not looking at it. */
  const p = await open();
  for (const id of ["pnote", "msg", "hn"]) {
    const d = await p.$eval("#" + id, (e) => e.getAttribute("aria-describedby"));
    assert.ok(d && d.includes("-left"), `#${id} is described by its counter, got ${d}`);
  }
  await p.close();
});

/* ---- is the price feed alive -------------------------------------------
 *
 * Staff asked for the bid board on this screen. It was already here -- the
 * Worker fills the table from the same file -- so what was missing was not the
 * numbers but whether anything is still reading them. This block asks the feed
 * directly, from the browser, and is therefore a second opinion rather than a
 * second copy: if the Worker failed to fill this page, the line it wrote is
 * filler and outlined in red, and this still tells the truth.
 *
 * The thresholds are the consumers' own -- 6h heartbeat, 14h withdrawal in
 * update-prices.mjs -- not new ones invented on a screen.
 */
const feedState = async (body, { abort = false } = {}) => {
  const p = await open();
  await p.route("**/boyceville.json*", (r) =>
    abort ? r.abort() : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
  await p.reload({ waitUntil: "load" });
  await p.waitForFunction(() => {
    const t = document.getElementById("feedLiveText");
    return t && t.textContent && !/Asking the feed/.test(t.textContent);
  });
  const out = {
    cls: await p.$eval("#feedLive", (e) => e.className),
    text: await p.$eval("#feedLiveText", (e) => e.textContent.replace(/\s+/g, " ")),
  };
  await p.close();
  return out;
};
const agoHours = (h) => new Date(Date.now() - h * 36e5).toISOString();

test("A LIVE FEED SAYS SO, AND SAYS NOTHING NEEDS DOING", { skip: NO_BROWSER }, async () => {
  const r = await feedState({ checkedAt: agoHours(0.1), status: "ok", bids: [1, 2, 3, 4, 5, 6, 7] });
  assert.match(r.cls, /is-ok/);
  assert.match(r.text, /price feed is live/);
  assert.match(r.text, /7 rows/);
});

test("past the heartbeat it warns without crying wolf", { skip: NO_BROWSER }, async () => {
  /* Six hours is "nothing has looked", not "the page is wrong". Saying the
     second would send somebody to post a price by hand for no reason. */
  const r = await feedState({ checkedAt: agoHours(7), status: "ok", bids: [1, 2, 3] });
  assert.match(r.cls, /is-warn/);
  assert.match(r.text, /nothing is wrong on the page yet/);
});

test("PAST FOURTEEN HOURS IT REPORTS WHAT HAS ALREADY HAPPENED", { skip: NO_BROWSER }, async () => {
  /* By this point it is not a warning. update-prices.mjs has already withdrawn
     the price at both sites, and the screen should say that rather than
     imply there is still time to prevent it. */
  const r = await feedState({ checkedAt: agoHours(16), status: "ok", bids: [1, 2, 3] });
  assert.match(r.cls, /is-bad/);
  assert.match(r.text, /showing .Call for today.s price. right now/);
  assert.match(r.text, /Post a price by hand/, "and it says what to do about it");
});

test("a flagged or empty board is reported as theirs, not as ours", { skip: NO_BROWSER }, async () => {
  const flagged = await feedState({ checkedAt: agoHours(0.2), status: "stale", bids: [1, 2] });
  assert.match(flagged.text, /flagged/);
  assert.match(flagged.text, /Not our failure/);
  const empty = await feedState({ checkedAt: agoHours(0.2), status: "ok", bids: [] });
  assert.match(empty.text, /posting no rows/);
});

test("IT DOES NOT CLAIM THE FEED IS DEAD WHEN IT IS THE WI-FI", { skip: NO_BROWSER }, async () => {
  /* From this browser a dead feed and a dropped connection look identical.
     Picking one would send somebody to the break-glass box over office wi-fi. */
  const r = await feedState(null, { abort: true });
  assert.match(r.cls, /is-warn/, "not is-bad");
  assert.match(r.text, /either the feed or this connection/);
  assert.match(r.text, /not a reason to post a price by hand/);
});

test("it renders no prices of its own", { skip: NO_BROWSER }, async () => {
  /* The board below is the one renderer of the figures. A second one is how
     two views of the same file drift apart, and this screen has been bitten by
     exactly that before. */
  const r = await feedState({ checkedAt: agoHours(0.1), status: "ok",
    bids: [{ delivery: "August", cash: 4.1525, basisDollars: -0.52 }] });
  assert.doesNotMatch(r.text, /4\.15|0\.52|\$/, "no figure from the feed appears in the strip");
});

/* ---- does every box agree with what is published ------------------------
 *
 * THE GAP I SAID COULD NOT BE CLOSED FROM HERE.
 *
 * The data-sample check cannot catch a Worker that renders the page but
 * misses one box, and I wrote that off because the Worker's source is not
 * available. Wrong question. The screen does not need to know what the Worker
 * did -- it can read the two files the Worker writes and compare them to what
 * is in front of the user. Both repos are public and both files are served
 * with access-control-allow-origin:*.
 *
 * It is the better check of the two, because it does not care WHY a box
 * disagrees: skipped, filled from something stale, or left over from a
 * half-finished edit all give the same answer.
 */
const LIVEISH = (over = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "liveish-"));
  const html = readFileSync(join(REPO, "index.html"), "utf8")
    .replace('<html lang="en"', '<html lang="en" data-live="1"')
    .replace(/ data-sample(?=[ >])/g, "")
    .replace('name="sat_closed" value="1"', 'name="sat_closed" value="1" checked')
    .replace(/(<textarea id="msg"[^>]*>)[\s\S]*?(<\/textarea>)/, "$1$2");
  writeFileSync(join(dir, "i.html"), html);
  writeFileSync(join(dir, "admin.css"), readFileSync(join(REPO, "admin.css")));
  void over;
  return dir;
};
const PUBLISHED_HOURS = {
  weekday: "8:00a to 5:00p", saturday: null, sunday: null, banner: null,
  hoursnote: "During harvest we run longer, seven days a week. Outside harvest the hours " +
             "above hold. Updated hours are posted here first. When in doubt, call.",
};
const PUBLISHED_PRICING = {
  spread: 0.10,
  price_note: "Prices change with the market and are not final until you call. Grain is " +
              "bought subject to the drying and discount schedule below.",
};
async function compare(hours, pricing, { abort = false, act = null } = {}) {
  const dir = LIVEISH();
  const p = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await p.route("**/boyceville.json*", (r) => r.fulfill({ status: 200,
    contentType: "application/json",
    body: JSON.stringify({ checkedAt: new Date().toISOString(), status: "ok", bids: [1] }) }));
  for (const [pat, body] of [["**/hours.json*", hours], ["**/pricing.json*", pricing]])
    await p.route(pat, (r) => abort ? r.abort()
      : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
  await p.goto("file://" + join(dir, "i.html") + "?site=badger", { waitUntil: "load" });
  await p.waitForTimeout(450);
  if (act) { await act(p); await p.waitForTimeout(250); }
  const lines = await p.$$eval(".livecheck:not([hidden]) li", (e) => e.map((x) => x.textContent));
  await p.close();
  rmSync(dir, { recursive: true, force: true });
  return lines;
}

test("A SCREEN THAT MATCHES THE SITE SAYS NOTHING", { skip: NO_BROWSER }, async () => {
  assert.deepEqual(await compare(PUBLISHED_HOURS, PUBLISHED_PRICING), []);
});

test("A BOX THE WORKER MISSED IS CAUGHT — THIS IS THE GAP", { skip: NO_BROWSER }, async () => {
  /* The spread is the one that costs money: the screen showing 0.10 while the
     site is running 0.14 means the next Save quietly moves what we pay. */
  const l = await compare(PUBLISHED_HOURS, { ...PUBLISHED_PRICING, spread: 0.14 });
  assert.equal(l.length, 1);
  assert.match(l[0], /the site says 0\.14, this box says .0\.10./);
});

test("a day whose published hours differ is caught", { skip: NO_BROWSER }, async () => {
  const l = await compare({ ...PUBLISHED_HOURS, saturday: "8:00a to 12:00p" }, PUBLISHED_PRICING);
  assert.equal(l.length, 1);
  assert.match(l[0], /^Saturday/);
  assert.match(l[0], /this screen has it closed/);
});

test("and so is a banner that is live on the site but not on this screen",
  { skip: NO_BROWSER }, async () => {
  const l = await compare({ ...PUBLISHED_HOURS, banner: "Harvest starts Monday" }, PUBLISHED_PRICING);
  assert.equal(l.length, 1);
  assert.match(l[0], /Harvest starts Monday/);
});

test("IT SAYS NOTHING AT ALL WHEN IT CANNOT READ THE FILES", { skip: NO_BROWSER }, async () => {
  /* From this browser an unreachable file and a dropped connection look the
     same. Guessing would put a warning on a working screen, which is the fault
     that had to be corrected here twice in one afternoon. */
  assert.deepEqual(await compare(PUBLISHED_HOURS, PUBLISHED_PRICING, { abort: true }), []);
});

test("a complaint withdraws itself once the box is edited", { skip: NO_BROWSER }, async () => {
  /* Reported on load and then left standing, it would go on complaining about
     a box somebody had just deliberately changed -- which is how a true
     warning becomes one people learn to scroll past. */
  const l = await compare(PUBLISHED_HOURS, { ...PUBLISHED_PRICING, spread: 0.14 },
    { act: (p) => p.fill("#off", "0.22") });
  assert.deepEqual(l, []);
});

test("it never writes into a box", { skip: NO_BROWSER }, async () => {
  /* The Worker fills this form. A second thing writing the same fields is the
     two-writers fault that has bitten this system three times. */
  const dir = LIVEISH();
  const p = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await p.route("**/boyceville.json*", (r) => r.fulfill({ status: 200,
    contentType: "application/json", body: '{"checkedAt":"' + new Date().toISOString() + '","status":"ok","bids":[1]}' }));
  await p.route("**/hours.json*", (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ ...PUBLISHED_HOURS, weekday: "6:00a to 8:00p" }) }));
  await p.route("**/pricing.json*", (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ ...PUBLISHED_PRICING, spread: 0.99 }) }));
  await p.goto("file://" + join(dir, "i.html") + "?site=badger", { waitUntil: "load" });
  await p.waitForTimeout(500);
  const after = await p.evaluate(() => ({
    spread: document.getElementById("off").value,
    wkOpen: document.querySelector('[name=wk_open]').value,
  }));
  await p.close();
  rmSync(dir, { recursive: true, force: true });
  assert.equal(after.spread, "0.10", "the box still holds what it held");
  assert.equal(after.wkOpen, "08:00");
});
