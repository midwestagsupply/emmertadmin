/* THE STAFF SCREEN, DRIVEN IN A REAL BROWSER — BOTH ELEVATORS.
 *
 * WHAT CHANGED UNDER THIS FILE, AND WHY IT HAD TO BE REBUILT RATHER THAN
 * PATCHED. Until tonight the screen was ONE form, with global ids, showing
 * whichever elevator ?site= named. It is now one page carrying BOTH: two
 * columns stamped from a single <template>, ids prefixed per elevator
 * (badger-off, midwest-off), controls found by data-id inside a column root,
 * and two independent <form>s each with its own Save that files an issue on
 * its own repository.
 *
 * Against that page the old suite was not merely failing, it was DANGEROUS
 * where it passed. `p.fill("#off")` finds nothing and fails loudly — fine. But
 * `p.$eval("[name=sat_closed]")` finds Badger's box and passes, and reports
 * that the screen works, having never once touched Midwest. Four of the
 * seventeen tests that were green before this rewrite were green that way.
 *
 * So the rule this file is built on: NO TEST MAY NAME A CONTROL WITHOUT
 * NAMING ITS ELEVATOR. Every selector goes through col()/id()/named() in
 * test/lib/screen.mjs, all of which take the elevator first and cannot be
 * called without one. Every behavioural test is generated once per elevator
 * and reported under that elevator's name, so a column that is not wired
 * fails on its own line instead of hiding behind its neighbour.
 *
 * The four files the screen reads are mocked, and mocked DIFFERENTLY for the
 * two elevators. Identical fixtures cannot tell "each column reads its own
 * repository" from "both columns read Badger's".
 *
 * SKIPS RATHER THAN FAILS WITHOUT PLAYWRIGHT. This repository has no
 * package.json and is uploaded by hand, so `node --test test/*.mjs` has to keep
 * working on a machine that has never installed a browser. CI installs one.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  REPO, getChromium, makeFixture, dropFixture, openScreen, save, refusal, warnings,
  weekRows, todayPreview, basisReads, figuresIn, files, feedNow, pick, press,
  ELEVATORS, OTHER, LAYOUT, col, id, named, SITE_FILES, BOARD_ROWS, HOURS_NOTE, PRICE_NOTE,
} from "./lib/screen.mjs";

const chromium = await getChromium();
const NO_BROWSER = chromium ? false : "playwright is not installed; screen tests skipped";

let dir, browser;
before(async () => {
  if (NO_BROWSER) return;
  dir = makeFixture();
  browser = await chromium.launch();
});
after(async () => {
  if (browser) await browser.close();
  dropFixture(dir);
});
const open = (opts) => openScreen(browser, dir, opts);
/* Generates one test per elevator. The name carries the elevator, so a page
   that wires only the left-hand column fails on exactly one line and says
   which. Written as a helper rather than a loop inside one test because a
   loop stops at the first failure and reports one elevator's problem as the
   whole screen's. */
const each = (title, body, opts = {}) => {
  for (const E of ELEVATORS)
    test(`${title} — ${E.name}`, { skip: NO_BROWSER, ...opts }, () => body(E));
};

/* ══════════════════════════════════════════════════════════════════════════
   1. TWO COLUMNS, STAMPED ONCE EACH
   ══════════════════════════════════════════════════════════════════════════ */

test("BOTH ELEVATORS ARE ON THE PAGE, each with its own form", { skip: NO_BROWSER }, async () => {
  const p = await open();
  const r = await p.evaluate(() => ({
    cols: [...document.querySelectorAll(".col")].map((c) => c.getAttribute("data-elev")),
    forms: document.querySelectorAll(".col form").length,
    /* One <template> is not two columns until something stamps it. */
    stillInTemplate: document.getElementById("elevTpl").content.querySelectorAll("[data-id]").length > 0,
  }));
  await p.done();
  assert.deepEqual(r.cols, ELEVATORS.map((e) => e.site));
  assert.equal(r.forms, 2, "each elevator must have its own form, or one Save carries both");
  assert.ok(r.stillInTemplate, "the template is the one definition and is not consumed by stamping");
});

test("THE STAMP GIVES EVERY CONTROL A UNIQUE ID, and every label still points at one",
  { skip: NO_BROWSER }, async () => {
  /* Two copies of one markup block is the moment duplicate ids arrive, and a
     duplicate id is a label that clicks the wrong elevator's box — silently,
     and only for the people who click labels, which is everyone using a
     screen reader. */
  const p = await open();
  const r = await p.evaluate(() => {
    const seen = new Set(), dup = [];
    document.querySelectorAll("[id]").forEach((e) => { if (seen.has(e.id)) dup.push(e.id); seen.add(e.id); });
    const orphanFor = [...document.querySelectorAll("label[for]")]
      .map((l) => l.getAttribute("for")).filter((f) => !document.getElementById(f));
    const orphanDesc = [...new Set([...document.querySelectorAll("[aria-describedby]")]
      .flatMap((e) => e.getAttribute("aria-describedby").split(/\s+/)))]
      .filter((i) => !document.getElementById(i));
    const leftovers = [...document.querySelectorAll(".col [data-id]")].filter((e) => !e.id).length;
    return { dup, orphanFor, orphanDesc, leftovers };
  });
  await p.done();
  assert.deepEqual(r.dup, [], "these ids exist twice on one page");
  assert.deepEqual(r.orphanFor, [], "a label points at an id that is not there");
  assert.deepEqual(r.orphanDesc, [], "aria-describedby points at an id that is not there");
  assert.equal(r.leftovers, 0, "a data-id in a column was never turned into an id");
});

each("the column carries its own elevator's identity and none of the other's", async (E) => {
  const p = await open();
  const r = await p.evaluate((s) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    return {
      name: c.querySelector(".col-name").textContent,
      town: c.querySelector(".col-town").textContent,
      saveWho: c.querySelector(".btn-go .save-who").textContent,
      harvest: c.querySelector(".who-harvest").textContent,
      hint: c.querySelector('[data-id="c-bid"] .who-town').textContent,
    };
  }, E.site);
  await p.done();
  assert.equal(r.name, E.name);
  assert.equal(r.town, E.town);
  assert.equal(r.saveWho, E.name, "Save must name the elevator it saves, on the button");
  assert.equal(r.harvest, E.harvest, "harvest hours differ between the two and are not shared");
  assert.equal(r.hint, E.town);
  const other = OTHER(E.site);
  for (const [what, got] of Object.entries(r))
    assert.ok(!String(got).includes(other.name) && !String(got).includes(other.town),
      `${what} in the ${E.name} column is showing ${other.name}`);
});

/* ══════════════════════════════════════════════════════════════════════════
   2. EVERY BEHAVIOUR THAT USED TO RUN ONCE NOW RUNS AGAINST BOTH COLUMNS
   ══════════════════════════════════════════════════════════════════════════
   The weekly card and the small print fold away on the console — they are the
   two panels that say "changes rarely" on their own faces — so the tests that
   drive them open that panel first. It is one button and it opens both
   columns at once, which is itself part of the promise. */

each("CLOSING A DAY SHOWS UP IN THE PREVIEW IMMEDIATELY", async (E) => {
  /* Jesse Cebulla, 2026-08-19: "When I update the hours (we are not open
     Saturdays) it is not reflected in the hours window on the site." Two
     faults met on that one task; this screen refusing to say what it was about
     to publish was the second. */
  const p = await open({ rare: true });
  const h = SITE_FILES[E.site].hours;
  assert.deepEqual(await weekRows(p, E.site), [
    ["Mon to Fri", h.weekday],
    ["Saturday", h.saturday || "Closed"],
    ["Sunday", h.sunday || "Closed"],
  ], "the preview starts by agreeing with the boxes this elevator's own site filled");

  /* Then the toggle itself, from a state both elevators can start from. Midwest
     publishes no Saturday at all, so its Closed box comes up ticked over the
     times the file ships with; typing the span first means the same two clicks
     mean the same thing in both columns. */
  await p.uncheck(named(E.site, "sat_closed"));
  await p.fill(named(E.site, "sat_open"), "08:00");
  await p.fill(named(E.site, "sat_close"), "12:00");
  assert.deepEqual((await weekRows(p, E.site))[1], ["Saturday", "8:00a to 12:00p"]);
  await p.check(named(E.site, "sat_closed"));
  assert.deepEqual((await weekRows(p, E.site))[1], ["Saturday", "Closed"],
    "and moves the moment the box is ticked");
  await p.uncheck(named(E.site, "sat_closed"));
  assert.deepEqual((await weekRows(p, E.site))[1], ["Saturday", "8:00a to 12:00p"], "and back");
  await p.done();
});

each("the preview follows the times, not just the closed box", async (E) => {
  const p = await open({ rare: true });
  await p.fill(named(E.site, "wk_open"), "06:30");
  await p.fill(named(E.site, "wk_close"), "19:00");
  assert.deepEqual((await weekRows(p, E.site))[0], ["Mon to Fri", "6:30a to 7:00p"]);
  await p.done();
});

each("a preview it cannot compute says Closed, exactly as the site publishes it", async (E) => {
  /* weeklyRows() in the sites' update-today.mjs prints "Closed" for a blank or
     unreadable span. A different guess here would be a confident lie, which is
     worse than the blank it replaced. */
  const p = await open({ rare: true });
  await p.fill(named(E.site, "wk_open"), "");
  assert.deepEqual((await weekRows(p, E.site))[0], ["Mon to Fri", "Closed"]);
  await p.done();
});

each("the summary beside “usual hours” is derived, not hand-typed", async (E) => {
  /* It was a fixed string, identical on both elevators, describing hours the
     table beneath it could contradict — on the option staff are told to leave
     selected. With two columns on one screen an identical sentence under two
     different sets of hours is not a small fault. */
  const p = await open({ rare: true });
  await p.check(named(E.site, "sat_closed"));
  await p.fill(named(E.site, "wk_close"), "18:00");
  const wkOpen = SITE_FILES[E.site].hours.weekday.split(" to ")[0];
  assert.equal(await p.$eval(id(E.site, "usualSummary"), (e) => e.textContent),
    `${wkOpen} to 6:00p weekdays, closed Saturday`);
  await p.done();
});

each("TICKING “CLOSED TODAY” CHANGES WHAT THE PREVIEW SAYS", async (E) => {
  /* It did not. Three boxes carry the label "What customers will see"; this one
     was server-rendered filler that never moved. */
  const p = await open();
  /* Started from harvest rather than from "usual". Whether "usual" reads as
     open depends on what day the suite is run and on what that elevator
     publishes for it — Midwest is shut on Saturdays, so on a Saturday the two
     states genuinely look alike and the test would have been asserting the
     calendar. Harvest is open on every day of the week for both elevators. */
  await pick(p, E.site, "today", "harvest");
  const before = await todayPreview(p, E.site);
  await pick(p, E.site, "today", "closed");
  const after = await todayPreview(p, E.site);
  /* And back to the answer staff are told to leave selected, which must end up
     agreeing with this elevator's own weekly hours rather than a fixed line. */
  await pick(p, E.site, "today", "usual");
  const usual = await todayPreview(p, E.site);
  const dayIdx = await p.evaluate(() => new Date().getDay());
  await p.done();
  assert.notDeepEqual(after, before, "the preview did not move when the answer did");
  assert.match(after.label, /^Closed today, /);
  assert.equal(after.hours, "Closed");
  const h = SITE_FILES[E.site].hours;
  const span = dayIdx === 0 ? h.sunday : dayIdx === 6 ? h.saturday : h.weekday;
  assert.equal(usual.hours, span || "Closed",
    "“usual hours” must preview this elevator's published week, not a fixed sentence");
});

each("“different hours” previews the times typed under it", async (E) => {
  const p = await open();
  await pick(p, E.site, "today", "custom");
  await p.fill(id(E.site, "o"), "06:00");
  await p.fill(id(E.site, "c"), "19:30");
  assert.equal((await todayPreview(p, E.site)).hours, "6:00a to 7:30p");
  await p.done();
});

each("harvest hours preview this elevator's own harvest window", async (E) => {
  /* The two elevators run different harvest hours. One shared sentence would
     be right for one of them and wrong for the other, which is the worst of
     the three possible states. */
  const p = await open();
  await pick(p, E.site, "today", "harvest");
  assert.equal((await todayPreview(p, E.site)).hours, E.harvest);
  await p.done();
});

each("“OPEN, DIFFERENT HOURS” WITH THE BOXES BLANK IS REFUSED", async (E) => {
  /* It posted open="" and close="" and navigated away looking like a success.
     problems() only looked at the money boxes and a type=time input has no
     required attribute, so the screen announced the elevator was open on hours
     it declined to name. */
  const p = await open();
  await pick(p, E.site, "today", "custom");
  await p.fill(id(E.site, "o"), "");
  await p.fill(id(E.site, "c"), "");
  const url = await save(p, E.site);
  assert.equal(url, null, "it must not file an issue");
  assert.match(await refusal(p, E.site), /times are not filled in/);
  assert.equal(await p.$eval(id(E.site, "o"), (e) => e.getAttribute("aria-invalid")), "true",
    "and the box at fault is marked, not just described");
  await p.done();
});

each("a weekly day left open with no hours is refused too", async (E) => {
  /* Unticking Sunday's Closed box leaves two blank time inputs — the shipped
     state of those two fields, so this is one click away. */
  const p = await open({ rare: true });
  await p.uncheck(named(E.site, "sun_closed"));
  const url = await save(p, E.site);
  assert.equal(url, null);
  assert.match(await refusal(p, E.site), /Sunday is not marked closed but has no hours/);
  await p.done();
});

each("a basis that is not a number is refused, and no issue is filed", async (E) => {
  const p = await open();
  await p.fill(id(E.site, "off"), "abc");
  const url = await save(p, E.site);
  assert.equal(url, null, "a refused form must not open an issue");
  assert.match(await refusal(p, E.site), /is not a number/);
  await p.done();
});

each("the complaint announces itself and takes focus", async (E) => {
  /* It had no role and moved focus nowhere, and it was appended inside the
     collapsed by-hand drawer — so a complaint about the cash basis, a field
     outside that drawer, was printed hundreds of pixels away inside a panel
     the handler had to force open to show it.

     Driven in the roomy layout because that is where the note is on screen;
     whether the console shows it is a separate question with its own test
     below, and folding the two together would let one hide the other. */
  const p = await open({ viewport: LAYOUT.ROOMY, query: `?site=${E.site}` });
  await p.fill(id(E.site, "off"), "abc");
  await press(p, `${col(E.site)} .btn-go`);
  await p.waitForTimeout(200);
  const r = await p.evaluate((s) => ({
    role: document.getElementById(s + "-checkNote").getAttribute("role"),
    focused: document.activeElement.id,
    drawer: document.querySelector('.col[data-elev="' + s + '"] details.byhand').open,
  }), E.site);
  await p.done();
  assert.equal(r.role, "alert");
  assert.equal(r.focused, `${E.site}-checkNote`, "the complaint must take focus, in its own column");
  assert.equal(r.drawer, false, "and the by-hand drawer is left alone for a fault outside it");
});

each("a form with nothing wrong with it files an issue on this elevator's OWN repository",
  async (E) => {
  /* Asserting the URL is a stronger test than asserting a submit event: it
     checks the elevator, the labels and the values, not just that a click did
     something. And it is a real window — a stub over window.open cannot tell a
     blocked window from a built URL. */
  const p = await open({ rare: true });
  await p.uncheck(named(E.site, "sun_closed"));
  await p.fill(named(E.site, "sun_open"), "09:00");
  await p.fill(named(E.site, "sun_close"), "13:00");
  const labels = await p.evaluate((s) => ({
    cash: (document.querySelector('label[for="' + s + '-off"]') || {}).textContent,
    crop: (document.querySelector('label[for="' + s + '-offh"]') || {}).textContent,
  }), E.site);
  const url = await save(p, E.site);
  const why = await refusal(p, E.site);
  await p.done();

  assert.ok(url, "Save opened nothing; the screen said: " + why);
  const u = new URL(url);
  assert.equal(u.host, "github.com");
  assert.equal(u.pathname, `/midwestagsupply/${E.repo}/issues/new`,
    "the issue must be filed on the elevator being edited");
  assert.match(u.searchParams.get("title"), new RegExp("^Update " + E.name + " — \\d{4}-\\d\\d-\\d\\d$"),
    "the title has to name the elevator, or the office cannot tell two issues apart");
  const body = u.searchParams.get("body");
  assert.ok(body, "the issue carries no body");
  /* A time input reports "09:00", not "9:00" — the house format is composed at
     the other end by clock(), not here. The raw value is what travels. */
  assert.match(body, /### Sunday — opens\n\n09:00/);
  assert.match(body, /### Sunday — closes\n\n13:00/);
  assert.match(body, /### Sunday — closed\n\n- \[ \] Closed/,
    "an UNTICKED box must still be reported, or un-closing a day says nothing");
  /* The basis heading is not spelled out here on purpose. It was renamed
     tonight — "Our basis under Big River" became "Under Big River", because
     the box holds the spread and not the basis — and a copy of the new wording
     written into this file would be a fourth place it has to be changed. The
     heading is taken from the label the office read on the screen, which is
     the thing it actually has to match. */
  assert.ok(labels.cash && body.includes("### " + labels.cash + "\n"),
    `the issue does not carry a heading matching the on-screen label “${labels.cash}”`);
});

each("the issue carries this elevator's OWN figures, not the other column's", async (E) => {
  /* The fault this exists for: two forms carrying the same 22 control names,
     and one page-wide byName() away from the right-hand column filing the
     left-hand elevator's work under the right-hand elevator's name. */
  const other = OTHER(E.site);
  const p = await open();
  await p.fill(id(E.site, "off"), "0.31");
  await p.fill(id(other.site, "off"), "0.77");
  await p.fill(id(E.site, "msg"), `only ${E.site}`);
  await p.fill(id(other.site, "msg"), `only ${other.site}`);
  const url = await save(p, E.site);
  await p.done();
  assert.ok(url, "Save opened nothing");
  const body = new URL(url).searchParams.get("body");
  assert.ok(body.includes("\n\n0.31"), "the basis this column holds is not in its own issue");
  assert.ok(!body.includes("0.77"), "the other elevator's basis travelled in this issue");
  assert.ok(body.includes(`only ${E.site}`));
  assert.ok(!body.includes(`only ${other.site}`), "the other elevator's banner travelled in this issue");
});

each("COMING BACK DOES NOT LEAVE THE ANSWER AND ITS BOXES DISAGREEING", async (E) => {
  /* THE DEFECT. The browser restores what was typed when you press Back, and
     it does it AFTER this script has run, without firing a single event. So the
     radio came back as "open, different hours" while the two time boxes came
     back DISABLED — and disabled boxes are not submitted. Pressing Save again
     filed "different hours" with no hours at all, silently. Back is not an
     unusual thing to press here: it is what you press when the save was
     refused. The page's answer is a pageshow handler that re-runs sync().

     HOW THIS IS DRIVEN, AND WHY IT IS NOT page.goBack(). Measured first: a
     real back navigation to a file:// page in headless Chromium restores
     NOTHING — a textarea typed into comes back empty and the navigation type is
     back_forward with a full re-parse. A test written on page.goBack() is
     therefore not exercising restoration at all; it re-loads the page and
     asserts the defaults, which is how it would go green against a screen with
     the handler deleted. So the restore is reproduced exactly as the browser
     performs it — the control's state set without dispatching an event — and
     then the real pageshow is fired at the real handler. */
  const p = await open();
  const state = await p.evaluate((s) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    const o = document.getElementById(s + "-o"), cl = document.getElementById(s + "-c");
    /* Exactly what a restore does: values back, no events. */
    c.querySelector('input[name="today"][value="custom"]').checked = true;
    o.value = "06:00"; cl.value = "19:00";
    const beforeShow = { picked: c.querySelector('input[name="today"]:checked').value,
                         oDisabled: o.disabled, cDisabled: cl.disabled };
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    return { beforeShow, after: { picked: c.querySelector('input[name="today"]:checked').value,
                                  oDisabled: o.disabled, cDisabled: cl.disabled } };
  }, E.site);
  await p.done();
  assert.equal(state.beforeShow.picked, "custom");
  assert.equal(state.beforeShow.oDisabled, true,
    "the fixture is not reproducing the defect: the boxes were never disabled");
  assert.equal(state.after.picked, "custom", "the restored answer must be left alone");
  assert.equal(state.after.oDisabled, false, "the box the restored answer depends on is live");
  assert.equal(state.after.cDisabled, false);
});

each("and a restored answer in one column does not wake the other column's boxes", async (E) => {
  /* pageshow is a WINDOW event: both columns hear it. Each must re-sync itself
     against its own radio, not against the one that happened to be restored. */
  const other = OTHER(E.site);
  const p = await open();
  const r = await p.evaluate((pair) => {
    const [s, o] = pair;
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    c.querySelector('input[name="today"][value="custom"]').checked = true;
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    return { mine: document.getElementById(s + "-o").disabled,
             theirs: document.getElementById(o + "-o").disabled,
             theirPick: document.querySelector('.col[data-elev="' + o + '"] input[name="today"]:checked').value };
  }, [E.site, other.site]);
  await p.done();
  assert.equal(r.mine, false);
  assert.equal(r.theirs, true, "the other elevator's time boxes were opened by this column's restore");
  assert.equal(r.theirPick, "usual");
});

each("the counters are tied to their boxes, in this column", async (E) => {
  /* The browser stops accepting keystrokes at maxlength, which reads like a
     broken keyboard. The count was on screen but attached to nothing. With two
     columns the counter's own id has to be unique too, or one box is described
     by the other elevator's count. */
  const p = await open({ rare: true });
  for (const which of ["pnote", "msg", "hn"]) {
    const d = await p.$eval(id(E.site, which), (e) => e.getAttribute("aria-describedby"));
    assert.ok(d && d.includes(`${E.site}-${which}-left`),
      `${E.site}-${which} is described by "${d}", which is not its own counter`);
  }
  await p.done();
});

test("every control still has a name, in both columns, and the buttons still do not",
  { skip: NO_BROWSER }, async () => {
  const p = await open();
  const r = await p.evaluate(() => {
    const out = {};
    document.querySelectorAll(".col").forEach((c) => {
      out[c.getAttribute("data-elev")] = [...c.querySelectorAll("input,select,textarea")]
        .filter((e) => !e.name).map((e) => e.id || e.outerHTML.slice(0, 60));
    });
    return out;
  });
  await p.done();
  for (const E of ELEVATORS) assert.deepEqual(r[E.site], [], `unnamed controls in ${E.name}`);
});

test("the screen loads clean, with nothing in the console", { skip: NO_BROWSER }, async () => {
  /* Every address it accepts, including the ones that no longer choose an
     elevator. ?site= survives only to say which column opens focused. */
  for (const q of ["", "?site=badger", "?site=midwest", "?SITE=MIDWEST", "?site=bogus"]) {
    const p = await open({ query: q });
    const errs = p.errors;
    await p.done();
    assert.deepEqual(errs, [], "console/page errors on " + (q || "(no query)"));
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   3. THE COLUMNS ARE INDEPENDENT
   ══════════════════════════════════════════════════════════════════════════
   Not a nicety. Everything below wire() used to run once against the page, and
   a page-wide lookup would not have thrown: it would have quietly returned
   Badger's control and wired Midwest's validation, dirty guard, reset and Save
   to it. The screen would have looked completely normal while the right-hand
   column saved the left-hand elevator's work.

   Every control TYPE is exercised, because the failure is per-lookup: a
   page-wide byName() breaks the named controls and leaves the data-id ones
   working, and a page-wide querySelector breaks the opposite half.
   ══════════════════════════════════════════════════════════════════════════ */

each("TYPING IN ONE COLUMN CHANGES NOTHING IN THE OTHER — every control type", async (E) => {
  const other = OTHER(E.site);
  const p = await open({ rare: true });
  const before = await p.evaluate((s) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    return {
      text: document.getElementById(s + "-off").value,
      time: c.querySelector('[name="wk_open"]').value,
      radioToday: c.querySelector('input[name="today"]:checked').value,
      radioBanner: c.querySelector('input[name="banner"]:checked').value,
      check: c.querySelector('[name="sat_closed"]').checked,
      area: document.getElementById(s + "-msg").value,
      details: c.querySelector("details.byhand").open,
      weekPrev: document.getElementById(s + "-prevWeek").textContent,
      todayPrev: document.getElementById(s + "-prevToday").textContent,
      notice: c.querySelector(".prev-notice").textContent,
      basis: document.getElementById(s + "-basisCash").textContent,
      summary: document.getElementById(s + "-usualSummary").textContent,
    };
  }, other.site);

  /* One of every kind of control in the column under test. */
  await p.fill(id(E.site, "off"), "0.37");                                   // text
  await p.fill(named(E.site, "wk_open"), "05:15");                           // time
  await pick(p, E.site, "today", "closed");           // radio
  await pick(p, E.site, "banner", "off");             // radio, second group
  await p.check(named(E.site, "sat_closed"));                                // checkbox
  await p.fill(id(E.site, "msg"), "one elevator only");                      // textarea
  await p.click(`${col(E.site)} details.byhand > summary`);                  // details
  await p.waitForTimeout(120);

  const after = await p.evaluate((s) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    return {
      text: document.getElementById(s + "-off").value,
      time: c.querySelector('[name="wk_open"]').value,
      radioToday: c.querySelector('input[name="today"]:checked').value,
      radioBanner: c.querySelector('input[name="banner"]:checked').value,
      check: c.querySelector('[name="sat_closed"]').checked,
      area: document.getElementById(s + "-msg").value,
      details: c.querySelector("details.byhand").open,
      weekPrev: document.getElementById(s + "-prevWeek").textContent,
      todayPrev: document.getElementById(s + "-prevToday").textContent,
      notice: c.querySelector(".prev-notice").textContent,
      basis: document.getElementById(s + "-basisCash").textContent,
      summary: document.getElementById(s + "-usualSummary").textContent,
    };
  }, other.site);
  /* And the column that WAS typed into really did move — otherwise this test
     passes on a screen where nothing works at all. */
  const mine = await p.evaluate((s) => ({
    text: document.getElementById(s + "-off").value,
    time: document.querySelector('.col[data-elev="' + s + '"] [name="wk_open"]').value,
    details: document.querySelector('.col[data-elev="' + s + '"] details.byhand').open,
  }), E.site);
  await p.done();

  for (const k of Object.keys(before))
    assert.deepEqual(after[k], before[k], `${other.name}'s ${k} moved when ${E.name} was edited`);
  assert.equal(mine.text, "0.37", "the column under test did not take the edit");
  assert.equal(mine.time, "05:15");
  assert.equal(mine.details, true);
});

each("Undo in one column does not undo the other", async (E) => {
  const other = OTHER(E.site);
  const p = await open();
  await p.fill(id(E.site, "off"), "0.41");
  await p.fill(id(other.site, "off"), "0.42");
  await p.click(`${col(E.site)} button[type=reset]`);
  await p.waitForTimeout(150);
  const r = await p.evaluate((pair) => ({
    mine: document.getElementById(pair[0] + "-off").value,
    theirs: document.getElementById(pair[1] + "-off").value,
  }), [E.site, other.site]);
  await p.done();
  assert.notEqual(r.mine, "0.41", "Undo did nothing in the column it was pressed in");
  assert.equal(r.theirs, "0.42", "Undo in one column threw away the other elevator's work");
});

each("a refusal in one column does not put a complaint on the other", async (E) => {
  const other = OTHER(E.site);
  const p = await open();
  await p.fill(id(E.site, "off"), "abc");
  await save(p, E.site);
  const r = await p.evaluate((pair) => ({
    mine: !document.getElementById(pair[0] + "-checkNote").hidden,
    theirs: !document.getElementById(pair[1] + "-checkNote").hidden,
    invalidThere: document.querySelectorAll('.col[data-elev="' + pair[1] + '"] [aria-invalid="true"]').length,
  }), [E.site, other.site]);
  await p.done();
  assert.equal(r.mine, true, "the column at fault says nothing");
  assert.equal(r.theirs, false, "the other column is showing a complaint about its neighbour");
  assert.equal(r.invalidThere, 0);
});

test("a warning names the elevator it is about, and one column cannot retract the other's",
  { skip: NO_BROWSER }, async () => {
  /* "A price is being posted by hand" over a screen showing two elevators
     sends somebody to check the wrong one. The retraction tag is namespaced
     for the same reason: Badger's filler warning clearing must not take
     Midwest's down with it. Driven by letting ONE elevator's files fail, so
     that column keeps its filler while the other fills itself. */
  const p = await open({ sites: files({ badger: { hours: null, pricing: null } }) });
  const w = await warnings(p);
  await p.done();
  const badger = w.filter((t) => t.startsWith("Badger Grain Supply —"));
  const midwest = w.filter((t) => t.startsWith("Midwest Commodity Service —"));
  assert.ok(w.every((t) => /^(Badger Grain Supply|Midwest Commodity Service) — /.test(t)),
    "an unattributed warning on a two-elevator screen: " + JSON.stringify(w));
  assert.ok(badger.some((t) => /still showing filler/.test(t)),
    "the elevator whose files could not be read must still say its boxes are filler");
  assert.deepEqual(midwest.filter((t) => /still showing filler/.test(t)), [],
    "the elevator that filled itself is still being called filler");
});

/* ══════════════════════════════════════════════════════════════════════════
   4. IN THE ONE-AT-A-TIME STATES THE HIDDEN COLUMN IS REALLY GONE
   ══════════════════════════════════════════════════════════════════════════ */

for (const [label, viewport] of [["a short desk", LAYOUT.SHORT], ["the roomy layout", LAYOUT.ROOMY]])
  test(`THE HIDDEN COLUMN IS OUT OF THE TAB ORDER — ${label}`, { skip: NO_BROWSER }, async () => {
  /* display:none, not a visual trick over two live forms. Tab landing in the
     elevator you are not looking at is how somebody types Badger's hours into
     Midwest without ever seeing the box they were typing into. */
  const p = await open({ viewport, query: "?site=badger" });
  const hidden = await p.$eval(col("midwest"), (e) => getComputedStyle(e).display);
  assert.equal(hidden, "none", `the second column is ${hidden}, not display:none`);

  const touched = new Set();
  for (let i = 0; i < 140; i++) {
    await p.keyboard.press("Tab");
    touched.add(await p.evaluate(() => {
      const a = document.activeElement;
      const c = a && a.closest ? a.closest(".col") : null;
      return c ? c.getAttribute("data-elev") : "chrome";
    }));
  }
  await p.done();
  assert.ok(touched.has("badger"), "tabbing never reached the elevator on screen");
  assert.ok(!touched.has("midwest"),
    "Tab reached a control in the column that is not on the screen");
});

test("SWITCHING ELEVATOR SWAPS WHICH ONE IS GONE, and the board stays", { skip: NO_BROWSER }, async () => {
  const p = await open({ viewport: LAYOUT.SHORT, query: "?site=badger" });
  const read = () => p.evaluate(() => ({
    badger: getComputedStyle(document.querySelector('.col[data-elev="badger"]')).display,
    midwest: getComputedStyle(document.querySelector('.col[data-elev="midwest"]')).display,
    board: !!document.querySelector(".bd").getBoundingClientRect().height,
    pressed: [...document.querySelectorAll("#elevSwitch button")]
      .map((b) => [b.getAttribute("data-elev"), b.getAttribute("aria-pressed")]),
  }));
  const first = await read();
  await p.click('#elevSwitch button[data-elev="midwest"]');
  await p.waitForTimeout(120);
  const second = await read();
  await p.done();
  assert.equal(first.midwest, "none");
  assert.equal(second.badger, "none");
  assert.notEqual(second.midwest, "none");
  assert.ok(first.board && second.board, "the shared board must survive the switch");
  assert.deepEqual(second.pressed, [["badger", "false"], ["midwest", "true"]],
    "the tabs must say which elevator is showing");
});

each("SAVE CARRIES NOTHING FROM THE COLUMN THAT IS NOT ON THE SCREEN", async (E) => {
  /* The hidden column's controls are not merely invisible — they are out of
     the layout, and they were never in this form to begin with. Set up while
     both columns are on screen, then shrink the window so one of them goes,
     and file the issue from the one that is left. */
  const other = OTHER(E.site);
  const p = await open();
  await p.fill(id(E.site, "off"), "0.19");
  await p.fill(id(other.site, "off"), "0.88");
  await p.fill(id(other.site, "msg"), "the other elevator's banner");
  await p.setViewportSize(LAYOUT.SHORT);
  await p.waitForTimeout(150);
  await p.click(`#elevSwitch button[data-elev="${E.site}"]`);
  await p.waitForTimeout(120);
  const gone = await p.$eval(col(other.site), (e) => getComputedStyle(e).display);
  const url = await save(p, E.site);
  await p.done();
  assert.equal(gone, "none", "the fixture did not actually hide the other column");
  assert.ok(url, "Save opened nothing");
  const body = new URL(url).searchParams.get("body");
  assert.ok(body.includes("\n\n0.19"), "the visible column's own basis is not in its issue");
  assert.ok(!body.includes("0.88"), "the hidden column's basis was submitted");
  assert.ok(!body.includes("the other elevator's banner"), "the hidden column's banner was submitted");
  assert.equal(new URL(url).pathname, `/midwestagsupply/${E.repo}/issues/new`);
});

test("the hidden column's Save cannot be pressed at all", { skip: NO_BROWSER }, async () => {
  const p = await open({ viewport: LAYOUT.SHORT, query: "?site=badger" });
  const box = await p.$eval(`${col("midwest")} .btn-go`, (e) => {
    const r = e.getBoundingClientRect();
    return { w: r.width, h: r.height, visible: !!e.offsetParent };
  });
  await p.done();
  assert.deepEqual(box, { w: 0, h: 0, visible: false },
    "the hidden elevator's Save still has a box on the page");
});

/* ══════════════════════════════════════════════════════════════════════════
   5. THE BOARD SAYS WHICH ROW EACH BASIS BOX GOVERNS
   ══════════════════════════════════════════════════════════════════════════ */

test("THE BOARD IS DRAWN FROM THE FEED, and tags the nearest delivery and the new crop",
  { skip: NO_BROWSER }, async () => {
  /* This table shipped as five rows of filler and nothing filled it in after
     the Worker was removed, so it showed invented prices under the heading
     "Their posted board". It is now drawn from the same read the liveness
     check performs — and it has to carry TWO marks, because there are two
     basis boxes: the nearest delivery, which the cash basis governs, and
     October/November, which the new-crop basis governs. Without them the
     screen asks for two figures and gives no sign of which rows each moves. */
  const p = await open();
  const r = await p.evaluate(() => ({
    rows: [...document.querySelectorAll(".bd tbody tr")].map((t) => ({
      month: t.children[0].textContent,
      cls: t.className,
      basis: t.querySelector("td.basis-cell") ? t.querySelector("td.basis-cell").textContent : null,
    })),
    stillSample: !!document.querySelector(".bd tbody[data-sample]"),
  }));
  await p.done();
  assert.equal(r.stillSample, false, "the shipped sample rows are still on screen");
  assert.deepEqual(r.rows.map((x) => x.month), BOARD_ROWS.map((x) => x.delivery),
    "the board must print their rows, in their order");
  assert.deepEqual(r.rows.filter((x) => /\bis-ref\b/.test(x.cls)).map((x) => x.month), ["August"],
    "exactly one row is the nearest delivery");
  assert.deepEqual(r.rows.filter((x) => /\bis-new\b/.test(x.cls)).map((x) => x.month),
    ["October", "November"], "the new-crop rows are the ones the sites call harvest");
  /* Every basis on screen is their figure, printed, not worked out. */
  for (const row of r.rows) {
    const want = BOARD_ROWS.find((b) => b.delivery === row.month).basisDollars;
    assert.equal(row.basis.replace("−", "-"), want.toFixed(2));
  }
});

/* ---- and the month list is the sites' list, not a second one -------------
 *
 * The page keeps NEW_CROP = ["October","November"] with a comment saying it is
 * kept identical to HARVEST_MONTHS in each site's tools/update-prices.mjs. A
 * comment is not a check. This imports the sites' real module and RUNS it —
 * HARVEST_MONTHS is an export, not a string in a file — then asks the page
 * which rows it tagged. Two answers about the same question, from the two
 * places that must agree.
 *
 * The site repositories are not part of this one and are not always beside it.
 * When they cannot be found this SKIPS AND SAYS SO, rather than falling back
 * to a list written here — a copy of the list in the test is the third copy of
 * the thing there are already two of, and it would go green forever.
 */
const SITE_REPO_DIRS = [
  process.env.SITE_REPO_BADGER, process.env.SITE_REPO_MIDWEST,
  ...(process.env.SITE_REPOS ? ["badgergrain", "midwestcommodity", "bgx", "mc"]
      .map((n) => join(process.env.SITE_REPOS, n)) : []),
  ...["badgergrain", "midwestcommodity", "bgx", "mc",
      join("diag", "bg"), join("diag", "mc")].map((n) => join(REPO, "..", n)),
].filter(Boolean);
const HARVEST_SOURCES = SITE_REPO_DIRS
  .map((d) => join(d, "tools", "update-prices.mjs")).filter((f) => existsSync(f));

test("THE NEW-CROP MONTHS ARE THE SITES' HARVEST_MONTHS, not a second list", {
  skip: NO_BROWSER || (HARVEST_SOURCES.length
    ? false
    : "no site checkout beside this repo, so HARVEST_MONTHS could not be read; " +
      "point SITE_REPOS at a directory holding badgergrain/ and midwestcommodity/ to run it"),
}, async () => {
  const lists = [];
  for (const f of HARVEST_SOURCES) {
    const mod = await import("file://" + f);
    assert.ok(Array.isArray(mod.HARVEST_MONTHS),
      `${f} no longer exports HARVEST_MONTHS — the screen's new-crop rows have lost their source`);
    lists.push([f, mod.HARVEST_MONTHS]);
  }
  for (const [f, l] of lists)
    assert.deepEqual(l, lists[0][1], `${f} disagrees with ${lists[0][0]} about the harvest window`);
  const HARVEST = lists[0][1];

  /* Every month of the year on the board, so the answer is the page's own
     definition rather than what our fixture happened to include. */
  const MONTHS = ["August", "September", "October", "November", "December", "January",
                  "February", "March", "April", "May", "June", "July"];
  const p = await open({ feed: feedNow({ bids: MONTHS.map((m, i) => ({
    commodity: "Corn", delivery: m, futuresMonth: "Dec 26",
    basisDollars: -0.50 - i / 100, cash: 4 + i / 100 })) }) });
  const tagged = await p.$$eval(".bd tbody tr.is-new td:first-child", (t) => t.map((x) => x.textContent));
  await p.done();
  assert.deepEqual(tagged, HARVEST,
    "the screen rings a different set of rows than the sites price as harvest");
});

test("a board that will not load leaves the screen saying nothing about their basis",
  { skip: NO_BROWSER }, async () => {
  /* A sample board is not a source. While the marker is still on the table the
     screen has no idea what Big River's basis is, and the correct output is
     silence — not arithmetic on filler, which is what it used to print. */
  const p = await open({ feed: null });
  const r = await p.evaluate(() => ({
    stillSample: !!document.querySelector(".bd tbody[data-sample]"),
    reads: [...document.querySelectorAll(".basis-read")].map((e) => e.textContent),
  }));
  await p.done();
  assert.equal(r.stillSample, true, "the fixture did not leave the sample board in place");
  for (const t of r.reads)
    assert.deepEqual(figuresIn(t), [],
      `a figure was printed off the sample board: "${t}"`);
});

/* ══════════════════════════════════════════════════════════════════════════
   6. WHAT THE BASIS READOUT SAYS, IN ALL THREE NEW-CROP STATES
   ══════════════════════════════════════════════════════════════════════════
   The box holds the SPREAD (0.10). Our basis is -0.62. Calling the spread "our
   basis" is the confusion Jessie hit: she thinks in the basis, like everyone in
   the trade, and the screen was showing her a different quantity under that
   name. The box is now labelled "Under Big River" and the basis is printed
   beside it, live, read from the row of the board that box governs.

   It is a subtraction of two figures the board gave us — their basis less our
   spread — and that is allowed. No cash price is worked out here: that one
   carries a rounding rule which lives in update-prices.mjs and must have
   exactly one implementation.
   ══════════════════════════════════════════════════════════════════════════ */

const REF = BOARD_ROWS[0].basisDollars;                       // the nearest delivery, August
const NEWROW = BOARD_ROWS.find((b) => b.delivery === "October").basisDollars;
const money = (v) => (v < 0 ? "−" : "") + Math.abs(v).toFixed(2);

each("the cash readout names their basis and ours, from the row it governs", async (E) => {
  const p = await open();
  const spread = Number(SITE_FILES[E.site].pricing.spread);
  const r = await basisReads(p, E.site);
  assert.equal(r.cash, `Big River ${money(REF)} · we post ${money(REF - spread)}`);
  /* And it follows the box, rather than being written once at load. */
  await p.fill(id(E.site, "off"), "0.30");
  await p.waitForTimeout(80);
  assert.equal((await basisReads(p, E.site)).cash,
    `Big River ${money(REF)} · we post ${money(REF - 0.3)}`);
  await p.done();
});

each("BLANK AND ZERO ON THE NEW-CROP BOX MEAN OPPOSITE THINGS, and it says which", async (E) => {
  /* spreadFor() in update-prices.mjs treats them differently because 0 != null,
     and Badger is deliberately running the zero. A screen where those two look
     alike is a screen where somebody clears the box to mean 0, or types 0 to
     mean blank, and moves the new-crop price by the whole cash spread without
     knowing they did. */
  const p = await open();

  await p.fill(id(E.site, "offh"), "");
  await p.waitForTimeout(80);
  const cash = Number(await p.$eval(id(E.site, "off"), (e) => e.value));
  let r = await basisReads(p, E.site);
  assert.match(r.cropClass, /basis-read/);
  assert.ok(!/is-zero/.test(r.cropClass), "blank must not be dressed as the zero state");
  assert.equal(r.crop, `Blank — same as cash · we post ${money(NEWROW - cash)}`,
    "blank means it follows the cash box, measured against the NEW CROP row");

  await p.fill(id(E.site, "offh"), "0");
  await p.waitForTimeout(80);
  r = await basisReads(p, E.site);
  assert.match(r.cropClass, /is-zero/, "the zero state must be marked, not only worded");
  assert.equal(r.crop, `Zero spread — we pay Big River’s exact board · we post ${money(NEWROW)}`);

  await p.fill(id(E.site, "offh"), "0.07");
  await p.waitForTimeout(80);
  r = await basisReads(p, E.site);
  assert.ok(!/is-zero/.test(r.cropClass));
  assert.equal(r.crop, `Big River ${money(NEWROW)} · we post ${money(NEWROW - 0.07)}`);

  /* Something that is not a figure at all is not guessed at. */
  await p.fill(id(E.site, "offh"), "zz");
  await p.waitForTimeout(80);
  assert.equal((await basisReads(p, E.site)).crop, "");
  await p.done();
});

each("the new-crop readout is measured against the NEW CROP row, not the nearest delivery",
  async (E) => {
  /* The one that would pass by accident if the second box quietly reused the
     first box's row. The fixture gives October a different basis from August
     precisely so the two answers cannot coincide. */
  const p = await open();
  await p.fill(id(E.site, "offh"), "0.10");
  await p.waitForTimeout(80);
  const r = await basisReads(p, E.site);
  await p.done();
  assert.ok(REF !== NEWROW, "the fixture cannot tell the two rows apart");
  assert.equal(r.crop, `Big River ${money(NEWROW)} · we post ${money(NEWROW - 0.1)}`);
  assert.ok(!r.crop.includes(money(REF)), "the new-crop line is quoting the cash row");
});

test("the two columns read the same board row and their own spread", { skip: NO_BROWSER }, async () => {
  const p = await open();
  const r = {};
  for (const E of ELEVATORS) r[E.site] = await basisReads(p, E.site);
  await p.done();
  for (const E of ELEVATORS) {
    const spread = Number(SITE_FILES[E.site].pricing.spread);
    assert.equal(r[E.site].cash, `Big River ${money(REF)} · we post ${money(REF - spread)}`);
  }
  assert.notEqual(r.badger.cash, r.midwest.cash,
    "both columns are printing the same basis — one of them is reading the other's spread");
});

test("NO CASH PRICE IS WORKED OUT ON THIS SCREEN", { skip: NO_BROWSER }, async () => {
  /* The standing rule, and the one this whole screen is arranged around. The
     rounding rule for a price we post lives in each site's update-prices.mjs
     and must have exactly one implementation; a rule invented here that
     differed by a tenth of a cent would put a figure in front of staff that
     neither site posts. So every figure in the two We pay columns, in the
     customer previews and in the basis readouts has to be one that arrived in
     a file — read from each elevator's own published bids.json, which is the
     answer it is serving to customers this minute.

     Their cash column is a separate claim with its own test below; it is their
     figure, not ours, and it is checked against their file rather than ours. */
  const p = await open();
  const shown = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll("td.pay, .prev-bid, .basis-read").forEach((e) => {
      (e.textContent.match(/\$\d+(?:\.\d+)?/g) || []).forEach((m) => out.push(Number(m.slice(1))));
    });
    return out;
  });
  await p.done();
  const published = new Set(
    ELEVATORS.flatMap((E) => SITE_FILES[E.site].bids.bids.map((b) => b.cashPrice)));
  assert.ok(shown.length, "no figures were found at all — the fixture is not loading");
  for (const v of shown)
    assert.ok(published.has(v),
      `$${v} is offered to staff as a price but is in neither elevator's bids.json`);
});

test("THEIR BOARD IS PRINTED AS THEY POSTED IT, to the last quarter cent",
  { skip: NO_BROWSER }, async () => {
  /* "This table is the check." The note under it tells the office to open Big
     River's page beside this one and expect the two to agree LINE FOR LINE,
     and the row this file ships with carries $4.2825 — four decimals, because
     corn futures move in quarter cents and their front months carry them.

     A figure rounded on the way to the screen breaks the only thing the table
     claims to be good for, and it is also a second rounding rule on a page
     whose whole discipline is that there is exactly one. Checked against the
     feed the fixture served, not against a number written here. */
  const p = await open();
  const cells = await p.$$eval(".bd tbody tr", (rows) => rows.map((tr) => ({
    month: tr.children[0].textContent, cash: tr.children[3].textContent })));
  await p.done();
  for (const c of cells) {
    const want = BOARD_ROWS.find((b) => b.delivery === c.month).cash;
    assert.equal(c.cash, "$" + String(want),
      `their ${c.month} cash reads ${c.cash} on this screen and ${want} on their board`);
  }
});

test("the We pay columns are each elevator's own published figures", { skip: NO_BROWSER }, async () => {
  /* Read from each site's bids.json and joined to the board by delivery month.
     A month a site does not post is an em dash; a file that cannot be read is
     a "?" with a title saying so, because a dash there would read as "this
     elevator does not post that month", which is a different and much more
     alarming claim. */
  const p = await open({ sites: files({ midwest: { bids: null } }) });
  const r = await p.evaluate(() => [...document.querySelectorAll(".bd tbody tr")].map((tr) => ({
    month: tr.children[0].textContent,
    badger: tr.querySelector('td.pay[data-elev="badger"]').textContent,
    midwest: tr.querySelector('td.pay[data-elev="midwest"]').textContent,
    midwestTitle: tr.querySelector('td.pay[data-elev="midwest"]').getAttribute("title"),
  })));
  await p.done();
  const byMonth = Object.fromEntries(SITE_FILES.badger.bids.bids.map((b) => [b.delivery, b.cashPrice]));
  for (const row of r) {
    const want = byMonth[row.month];
    assert.equal(row.badger, want == null ? "—" : "$" + want.toFixed(2),
      `Badger's ${row.month} cell`);
    assert.equal(row.midwest, "?", "an unreadable file must not print as a dash");
    assert.match(row.midwestTitle, /not a price of theirs/);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   7. THE “? HELP” KEY HIDES EXPLANATION AND MUST NEVER HIDE STATE
   ══════════════════════════════════════════════════════════════════════════
   317px of permanent explanation against 539px of actual control was the
   measurement that put the prose behind a key. It is hidden by CSS rather than
   removed, so a screen reader still reaches it, and it defaults to off on the
   console only — a phone is where somebody unfamiliar is most likely to be
   standing.

   The line that must not move: EXPLANATION goes, STATE stays. Explanation is
   the same sentence on every load. State is what this screen is telling you
   about this elevator right now.
   ══════════════════════════════════════════════════════════════════════════ */

test("the ? key hides the explanation, and the key says which way it is set",
  { skip: NO_BROWSER }, async () => {
  const p = await open();
  const read = () => p.evaluate(() => ({
    flag: document.body.getAttribute("data-help"),
    pressed: document.getElementById("helpBtn").getAttribute("aria-pressed"),
    help: getComputedStyle(document.querySelector(".col .help")).display,
    counter: getComputedStyle(document.querySelector(".col .counter")).display,
    boardNote: getComputedStyle(document.querySelector(".board-note")).display,
    inDom: !!document.querySelector(".col .help"),
  }));
  const off = await read();
  await p.click("#helpBtn"); await p.waitForTimeout(80);
  const on = await read();
  await p.keyboard.press("?"); await p.waitForTimeout(80);
  const backOff = await read();
  await p.done();
  assert.deepEqual([off.flag, on.flag, backOff.flag], ["off", "on", "off"],
    "the ? key must toggle, from the button and from the keyboard");
  assert.deepEqual([off.pressed, on.pressed], ["false", "true"]);
  for (const what of ["help", "counter", "boardNote"]) {
    assert.equal(off[what], "none", `.${what} is still on screen with the key off`);
    assert.notEqual(on[what], "none", `.${what} did not come back with the key on`);
  }
  assert.ok(off.inDom, "the explanation is hidden, never deleted — it is still read aloud");
});

each("the ? key never takes away the basis readout", async (E) => {
  /* The basis is the number the trade actually quotes and the readout is the
     only place on this screen it appears. It is deliberately not a .counter
     and not a .help for exactly this reason. */
  const p = await open();
  const withKeyOff = await p.evaluate((s) => [
    getComputedStyle(document.getElementById(s + "-basisCash")).display,
    getComputedStyle(document.getElementById(s + "-basisNew")).display,
    document.getElementById(s + "-basisCash").textContent,
  ], E.site);
  await p.click("#helpBtn"); await p.waitForTimeout(80);
  const withKeyOn = await p.evaluate((s) => [
    getComputedStyle(document.getElementById(s + "-basisCash")).display,
    getComputedStyle(document.getElementById(s + "-basisNew")).display,
    document.getElementById(s + "-basisCash").textContent,
  ], E.site);
  await p.done();
  assert.ok(!withKeyOff.includes("none"), "the basis readouts vanish when the help key is off");
  assert.deepEqual(withKeyOn, withKeyOff, "the help key changed what the basis readout says");
  assert.match(withKeyOff[2], /we post/);
});

each("PRESSING SAVE ON A FORM THE SCREEN REFUSES MUST NOT LOOK LIKE NOTHING HAPPENED",
  async (E) => {
  /* A REFUSAL IS STATE, NOT EXPLANATION, and the ? key hides explanation.
     The refusal note is built with class "sanity is-bad", and the console
     carries `body[data-help="off"] .sanity { display:none }` — with the help
     key off, which is its DEFAULT here, the reason a save was refused is
     display:none. Nothing else takes its place: focus() on a display:none
     element does not move focus, and role="alert" inside one is not announced.

     Driven at its worst case, which is one the office will meet: the weekly
     panel is folded away on the console, so the two boxes the complaint is
     about have no box on the page either and even the red outline that
     normally survives is gone. Save is pressed, no issue is filed, and the
     screen is pixel-for-pixel what it was a moment before. */
  const p = await open({ rare: true });
  await p.uncheck(named(E.site, "sun_closed"));
  await p.click("#rareBtn");                      // fold the weekly panel away again
  await p.waitForTimeout(120);
  const url = await save(p, E.site);
  const r = await p.evaluate((s) => {
    const n = document.getElementById(s + "-checkNote");
    const flagged = [...document.querySelectorAll('.col[data-elev="' + s + '"] [aria-invalid="true"]')];
    return {
      help: document.body.getAttribute("data-help"),
      text: n.textContent,
      noteOnScreen: getComputedStyle(n).display !== "none" && n.getBoundingClientRect().height > 0,
      flaggedOnScreen: flagged.filter((e) => e.getBoundingClientRect().height > 0).length,
      focused: document.activeElement.id || document.activeElement.tagName,
    };
  }, E.site);
  await p.done();

  assert.equal(url, null, "the fixture is not reproducing a refusal — an issue was filed");
  assert.equal(r.help, "off", "the console defaults the help key off; that is the state under test");
  assert.match(r.text, /Not saved/, "the screen did not even compose a refusal");
  assert.ok(r.noteOnScreen || r.flaggedOnScreen > 0,
    "Save was refused and NOTHING on the screen changed: the reason is display:none with the " +
    "help key off, the boxes it names are inside the folded-away weekly panel, and focus stayed " +
    "on the button. The office presses Save and the screen sits there.");
  assert.ok(r.noteOnScreen, "the reason a save was refused is not on the screen");
  assert.equal(r.focused, `${E.site}-checkNote`, "the refusal did not take focus");
});

test("the ? key is not offered on the phone layer, and would not act there anyway",
  { skip: NO_BROWSER }, async () => {
  /* A phone is where somebody unfamiliar is most likely to be standing, so the
     explanation is never taken away there. Two things carry that: the key is
     not drawn below 1440 at all, and the rules it drives are inside the
     console's media query, so even a page that arrived with the flag already
     set — a bookmark, a restore, a future default — shows its explanation. The
     second is asserted by setting the flag directly, because a key that cannot
     be pressed cannot be used to test what pressing it does. */
  const p = await open({ viewport: LAYOUT.PHONE });
  const before = await p.evaluate(() => ({
    keyOffered: getComputedStyle(document.getElementById("helpBtn")).display !== "none",
    flag: document.body.getAttribute("data-help"),
    help: getComputedStyle(document.querySelector(".col .help")).display,
    counter: getComputedStyle(document.querySelector(".col .counter")).display,
  }));
  const forced = await p.evaluate(() => {
    document.body.setAttribute("data-help", "off");
    return { help: getComputedStyle(document.querySelector(".col .help")).display,
             counter: getComputedStyle(document.querySelector(".col .counter")).display,
             prevN: getComputedStyle(document.querySelector(".col .prev-n")).display };
  });
  await p.done();
  assert.equal(before.keyOffered, false, "the phone is offered a key that does nothing here");
  assert.notEqual(before.help, "none", "the phone came up with its explanation hidden");
  assert.notEqual(before.counter, "none");
  for (const [what, v] of Object.entries(forced))
    assert.notEqual(v, "none", `the console's ${what} rule reached the phone layer`);
});

/* ══════════════════════════════════════════════════════════════════════════
   8. FILLER — WHAT IS A READING AND WHAT IS NOT
   ══════════════════════════════════════════════════════════════════════════ */

each("A BOX STILL HOLDING THE VALUE IT SHIPPED WITH IS MARKED, in this column", async (E) => {
  /* All seven original markers sat on display elements while ten form controls
     shipped filled in and none carried one, so the promise "anything still
     marked is something nothing filled" was unenforceable for exactly the
     fields that get written back: a failed fill left 0.10 showing with no
     outline and the first Save wrote it over the real basis.

     Driven with this elevator's own files unreadable, which is the state the
     marker exists for. The expected set is the page's own record of what it
     shipped with — data-sample-value — not a list written here that would go
     stale the moment a control was added. */
  const p = await open({ sites: files({ [E.site]: { hours: null, pricing: null, bids: null } }) });
  const r = await p.evaluate((s) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    const shipped = [...c.querySelectorAll("[data-sample-value]")]
      .filter((e) => String(e.value) === e.getAttribute("data-sample-value"))
      .map((e) => e.name).sort();
    const marked = [...c.querySelectorAll("input.sample, textarea.sample")].map((e) => e.name).sort();
    return { shipped, marked };
  }, E.site);
  const warns = await warnings(p);
  await p.done();
  assert.ok(r.shipped.length, "no control on this screen records what it shipped with");
  assert.deepEqual(r.marked, r.shipped,
    "the boxes still holding their shipped value are not the boxes outlined");
  assert.ok(warns.some((w) => w.startsWith(E.name) && /still showing filler/.test(w)),
    `${E.name} did not say its screen is showing filler`);
});

each("a screen this elevator's site filled says nothing about filler", async (E) => {
  /* THE FALSE ALARM THIS EXISTS TO STOP. Marking a box because it still holds
     the shipped value cannot tell "nothing filled this" from "the real answer
     happens to be the same" — the spread really is 0.10 and the weekday hours
     really are 08:00 and 17:00. A warning on a clean screen teaches people to
     ignore the red outline before the day it is right. */
  const p = await open();
  const r = await p.evaluate((s) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    return { outlined: c.querySelectorAll(".sample").length,
             marked: c.querySelectorAll("[data-sample]").length };
  }, E.site);
  const warns = await warnings(p);
  await p.done();
  assert.equal(r.outlined, 0, "something is outlined on a column that filled itself");
  assert.equal(r.marked, 0);
  assert.deepEqual(warns.filter((w) => w.startsWith(E.name) && /filler/.test(w)), []);
});

each("typing in a box clears its filler mark, and only its own", async (E) => {
  const other = OTHER(E.site);
  const p = await open({ sites: files({ badger: { hours: null, pricing: null, bids: null },
                                        midwest: { hours: null, pricing: null, bids: null } }) });
  await p.fill(id(E.site, "off"), "0.14");
  await p.waitForTimeout(80);
  const r = await p.evaluate((pair) => ({
    mine: document.getElementById(pair[0] + "-off").hasAttribute("data-sample"),
    theirs: document.getElementById(pair[1] + "-off").hasAttribute("data-sample"),
  }), [E.site, other.site]);
  await p.done();
  assert.equal(r.mine, false, "an answer somebody has just typed is not filler");
  assert.equal(r.theirs, true, "typing in one column cleared the other column's filler mark");
});

test("a copy opened off the desktop says so, in both columns", { skip: NO_BROWSER }, async () => {
  /* The guard read `if (samples.length && live)`, so the one place every value
     on the screen is filler — a copy — was the one place nothing was outlined. */
  const p = await open({ page: "copy", sites: files({
    badger: { hours: null, pricing: null, bids: null },
    midwest: { hours: null, pricing: null, bids: null } }) });
  const r = await p.evaluate(() => ({
    outlined: document.querySelectorAll(".sample").length,
    saves: [...document.querySelectorAll(".btn-go")].map((b) => b.disabled),
  }));
  const warns = await warnings(p);
  await p.done();
  assert.ok(r.outlined > 0);
  assert.ok(warns.some((w) => /copy of the screen/.test(w)), "it does not say it is a copy");
  for (const E of ELEVATORS)
    assert.ok(warns.some((w) => w.startsWith(E.name) && /still showing filler/.test(w)),
      `${E.name} says nothing about filler on a copy`);
});

test("EVERY FILLER MARKER ON THE PAGE IS ACCOUNTED FOR, not only the ones inside a column",
  { skip: NO_BROWSER }, async () => {
  /* data-sample means "this is what the file ships with; nothing has filled it
     in". The machinery that outlines them, counts them and takes the count back
     now runs inside wire(), against ONE COLUMN'S ROOT — so a marker outside
     both columns is never outlined, never counted and never withdrawn.

     Two are: the header's signed-in line, and the whole feed block that reads
     "Reading Big River, Boyceville, through our own mirror. Last read 7:48 PM,
     one minute ago." That sentence was written by the Cloudflare Worker. There
     is no Worker. It is a fixed claim about when the board was last read,
     sitting directly above the live check that goes and finds out. */
  const p = await open();
  const stray = await p.evaluate(() => [...document.querySelectorAll("[data-sample]")]
    .filter((e) => !e.closest(".col"))
    .map((e) => ({ where: e.tagName + "." + (e.className || ""), outlined: e.classList.contains("sample"),
                   onScreen: !!e.offsetParent, text: e.textContent.replace(/\s+/g, " ").trim().slice(0, 70) })));
  await p.done();
  const unmarked = stray.filter((s) => s.onScreen && !s.outlined);
  assert.deepEqual(unmarked.map((s) => `${s.where} — “${s.text}”`), [],
    "these carry data-sample — the page's own word for “nothing filled this in” — and are on " +
    "screen with no outline, no count and nothing to withdraw them, because the machinery that " +
    "does all three now runs per column and they are outside both columns");
});

test("THE SCREEN NEVER SHOWS A DATE NOTHING FILLED IN", { skip: NO_BROWSER }, async () => {
  /* The Today's hours card carries "Friday, August 14" as its hint. It shipped
     that way for the Worker to replace, and nothing replaces it now. Worse, the
     sweep that runs after the page fills itself strips the filler marker from
     every display element in the column — including this one, which was not
     filled — so the wrong date ends up on the live screen with the outline
     taken off it. The screen's own clock is the only date it has; it uses it
     for the previews already. */
  const p = await open();
  const r = await p.evaluate(() => {
    const today = new Date();
    const want = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    return { hints: [...document.querySelectorAll('[data-id="c-today"] .hint')]
             .map((e) => e.textContent.replace(/^Sample content[^.]*\.\s*/, "").trim()), want };
  });
  await p.done();
  for (const h of r.hints)
    assert.equal(h, r.want, `the Today's hours card is dated "${h}" on a screen opened on ${r.want}`);
});

test("taking a filler marker off also withdraws what it told a screen reader",
  { skip: NO_BROWSER }, async () => {
  /* An outlined element gets a visually hidden "Sample content, not a reading."
     in front of it, because a red dashed outline is a colour and a shape and
     neither reaches somebody who cannot see it. When the page then fills itself
     it removes the attribute and the class — and leaves the sentence. The
     outline says it is a reading and the screen reader says it is not. */
  const p = await open();
  const left = await p.evaluate(() => [...document.querySelectorAll(".sr-only")]
    .filter((e) => /Sample content/.test(e.textContent) && !e.closest("[data-sample]"))
    .map((e) => (e.parentElement.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70)));
  await p.done();
  assert.deepEqual(left, [],
    "these elements are no longer marked as filler but still announce themselves as filler");
});

/* ══════════════════════════════════════════════════════════════════════════
   9. EACH COLUMN FILLS ITSELF FROM ITS OWN SITE
   ══════════════════════════════════════════════════════════════════════════
   Until the Worker was removed this page was rendered with the real settings
   already in it and these fetches only COMPARED. With nothing rendering it,
   comparison alone would leave every box holding the value the file ships with
   and the first Save would publish those samples over the elevator's real
   hours, banner and basis. So the page fills itself — and there is still
   exactly one writer, this page.

   What has to hold now is narrower and more important: it may fill what nobody
   has touched, it may never overwrite what somebody has typed, and each column
   may only ever read its OWN repository.
   ══════════════════════════════════════════════════════════════════════════ */

each("the column comes up holding what THIS elevator's site is publishing", async (E) => {
  const p = await open({ rare: true });
  const f = SITE_FILES[E.site];
  const got = await p.evaluate((s) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    const v = (n) => c.querySelector('[name="' + n + '"]').value;
    return { spread: v("spread"), hoursnote: v("hoursnote"), pricenote: v("price_note"),
             wkOpen: v("wk_open"), wkClose: v("wk_close"),
             satClosed: c.querySelector('[name="sat_closed"]').checked,
             banner: c.querySelector('input[name="banner"]:checked').value,
             message: v("message") };
  }, E.site);
  await p.done();
  assert.equal(got.spread, Number(f.pricing.spread).toFixed(2),
    "money is formatted the way the rest of the screen reads it, not pasted raw");
  assert.equal(got.hoursnote, f.hours.hoursnote);
  assert.equal(got.pricenote, f.pricing.price_note);
  const [wo, wc] = f.hours.weekday.replace(/([ap])(?= |$)/g, "$1").split(" to ");
  const to24 = (t) => { const m = /^(\d{1,2}):(\d\d)([ap])/.exec(t); let h = +m[1] % 12;
                        if (m[3] === "p") h += 12; return String(h).padStart(2, "0") + ":" + m[2]; };
  assert.equal(got.wkOpen, to24(wo));
  assert.equal(got.wkClose, to24(wc));
  assert.equal(got.satClosed, !f.hours.saturday,
    "Saturday came up disagreeing with what this elevator publishes");
  assert.equal(got.banner, f.hours.banner ? "on" : "off");
  assert.equal(got.message, f.hours.banner || "");
});

test("the two columns really are reading two different files", { skip: NO_BROWSER }, async () => {
  /* The check the fixture exists for. Both elevators served the SAME file
     would make every per-column test above pass on a page whose right-hand
     column reads the left-hand repository. */
  const p = await open();
  const r = await p.evaluate(() => ({
    badger: document.getElementById("badger-off").value,
    midwest: document.getElementById("midwest-off").value,
  }));
  await p.done();
  assert.equal(r.badger, Number(SITE_FILES.badger.pricing.spread).toFixed(2));
  assert.equal(r.midwest, Number(SITE_FILES.midwest.pricing.spread).toFixed(2));
  assert.notEqual(r.badger, r.midwest, "both columns hold one elevator's basis");
});

each("a banner live on this elevator's site comes up in its box, and not in the other's",
  async (E) => {
  const other = OTHER(E.site);
  const p = await open({ sites: files({ [E.site]: { hours: { banner: "Harvest starts Monday" } } }) });
  const r = await p.evaluate((pair) => {
    const one = (s) => {
      const c = document.querySelector('.col[data-elev="' + s + '"]');
      return { msg: c.querySelector('[name="message"]').value,
               on: c.querySelector('input[name="banner"]:checked').value,
               preview: c.querySelector(".prev-notice").textContent };
    };
    return { mine: one(pair[0]), theirs: one(pair[1]) };
  }, [E.site, other.site]);
  await p.done();
  assert.deepEqual(r.mine, { msg: "Harvest starts Monday", on: "on", preview: "Harvest starts Monday" });
  assert.equal(r.theirs.msg, "", "the other elevator picked up this one's banner");
  assert.equal(r.theirs.on, "off");
});

each("it fills an untouched box and NEVER one somebody has typed in", async (E) => {
  /* The safety property that replaced "it never writes into a box". */
  const p = await open({ settle: 0,
    sites: files({ [E.site]: { pricing: { spread: 0.99 }, hours: { weekday: "6:00a to 8:00p" } } }) });
  /* Type before the reads land, so a touched box and an untouched one are
     separated inside a single run. */
  await p.fill(id(E.site, "off"), "0.33");
  await p.waitForTimeout(800);
  const after = await p.evaluate((s) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    return { spread: document.getElementById(s + "-off").value,
             wkOpen: c.querySelector('[name="wk_open"]').value };
  }, E.site);
  await p.done();
  assert.equal(after.spread, "0.33", "a box somebody typed in was overwritten — never do this");
  assert.equal(after.wkOpen, "06:00", "an untouched box was not filled from the site");
});

each("a column whose files cannot be read says nothing about them", async (E) => {
  /* From this browser an unreachable file and a dropped connection look
     identical, and guessing wrong would put a false alarm on a working screen.
     Silence, and the shipped values left where they are so the filler outline
     is the thing that speaks. */
  const p = await open({ sites: files({ [E.site]: { hours: null, pricing: null, bids: null } }) });
  const r = await p.evaluate((s) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    const live = c.querySelector(".livecheck");
    return { complaint: live && !live.hidden ? live.textContent : null,
             spread: c.querySelector('[name="spread"]').value };
  }, E.site);
  await p.done();
  assert.equal(r.complaint, null, "it invented a complaint out of a failed read");
  assert.equal(r.spread, "0.10", "the shipped value must be left where it is, outlined");
});

test("a screen that agrees with both sites complains about neither", { skip: NO_BROWSER }, async () => {
  const p = await open();
  const complaints = await p.$$eval(".livecheck:not([hidden]) li", (e) => e.map((x) => x.textContent));
  await p.done();
  assert.deepEqual(complaints, []);
});

/* ---- what customers will see, for the price ----------------------------- */

each("THE NEW CROP PRICE IS SHOWN, NOT ONLY THE CASH ONE", async (E) => {
  /* The preview showed one row while the page prints two, and this screen has
     two basis boxes — so the new-crop basis was the one figure here with no way
     to see what it does. Only the ROW CHOICE is ported from headline() in
     update-prices.mjs; the figures are read out of the site's own bids.json. */
  const p = await open();
  const rows = await p.$$eval(`${id(E.site, "prevBid")} .pb-row`,
    (e) => e.map((x) => x.textContent.replace(/\s+/g, " ")));
  await p.done();
  const bids = SITE_FILES[E.site].bids.bids;
  const spot = bids[0];
  const inH = bids.filter((b) => ["October", "November"].includes(b.delivery));
  const harvest = inH.reduce((lo, r) => (r.cashPrice < lo.cashPrice ? r : lo));
  assert.equal(rows.length, 2, "both rows the site prints have to be here");
  assert.match(rows[0], new RegExp(`Cash, corn.*${spot.delivery} delivery.*\\$${spot.cashPrice.toFixed(2)}`));
  assert.match(rows[1], new RegExp(`Harvest.*${inH.map((r) => r.delivery).join(" and ")} delivery`));
  assert.ok(rows[1].includes("$" + harvest.cashPrice.toFixed(2)),
    "harvest must show the LOWER of the window — the higher one is a promise we did not make");
  for (const r of inH)
    if (r !== harvest) assert.ok(!rows[1].includes("$" + r.cashPrice.toFixed(2)));
});

each("it says these are the published figures, not a preview of an unsaved change", async (E) => {
  /* Two different claims, and only one of them is true here. The line under the
     basis boxes makes the other. */
  const p = await open();
  const clean = await p.$eval(id(E.site, "prevBidNote"), (e) => e.textContent);
  await p.fill(id(E.site, "offh"), "0.05");
  await p.waitForTimeout(120);
  const edited = await p.$eval(id(E.site, "prevBidNote"), (e) => e.textContent);
  const otherNote = await p.$eval(id(OTHER(E.site).site, "prevBidNote"), (e) => e.textContent);
  await p.done();
  assert.match(clean, /read from what it is publishing/);
  assert.match(edited, /You have changed a basis/);
  assert.match(edited, /will not move until you save/);
  assert.match(otherNote, /read from what it is publishing/,
    "editing one elevator's basis changed what the OTHER column claims about its own figures");
});

each("if this elevator's published prices cannot be read, its preview is left alone", async (E) => {
  const p = await open({ sites: files({ [E.site]: { bids: null } }) });
  const r = await p.evaluate((s) => ({
    rows: document.querySelectorAll("#" + s + "-prevBid .pb-row").length,
    raw: document.getElementById(s + "-prevBid").textContent,
  }), E.site);
  await p.done();
  assert.equal(r.rows, 0, "rows were built out of a read that failed");
  assert.match(r.raw, /Cash, corn/, "and what was already there is untouched");
});

/* ══════════════════════════════════════════════════════════════════════════
   10. IS THE PRICE FEED ALIVE — one board, one check, shown once
   ══════════════════════════════════════════════════════════════════════════
   The thresholds are the consumers' own: 6h is the reader's heartbeat, 14h is
   FEED_MAX_AGE_H in update-prices.mjs, past which both sites have ALREADY
   withdrawn the price. Not new numbers invented on a screen.
   ══════════════════════════════════════════════════════════════════════════ */

const agoHours = (h) => new Date(Date.now() - h * 36e5).toISOString();
const feedState = async (feed) => {
  const p = await open({ feed, settle: 0 });
  await p.waitForFunction(() => {
    const t = document.getElementById("feedLiveText");
    return t && t.textContent && !/Asking the feed/.test(t.textContent);
  });
  const out = {
    cls: await p.$eval("#feedLive", (e) => e.className),
    text: await p.$eval("#feedLiveText", (e) => e.textContent.replace(/\s+/g, " ")),
    strips: await p.$$eval("#feedLive", (e) => e.length),
  };
  await p.done();
  return out;
};

test("A LIVE FEED SAYS SO, AND SAYS NOTHING NEEDS DOING", { skip: NO_BROWSER }, async () => {
  const r = await feedState(feedNow({ checkedAt: agoHours(0.1) }));
  assert.match(r.cls, /is-ok/);
  assert.match(r.text, /price feed is live/);
  assert.match(r.text, new RegExp(BOARD_ROWS.length + " rows"));
  assert.equal(r.strips, 1, "one board, one liveness line — not one per elevator");
});

test("past the heartbeat it warns without crying wolf", { skip: NO_BROWSER }, async () => {
  const r = await feedState(feedNow({ checkedAt: agoHours(7) }));
  assert.match(r.cls, /is-warn/);
  assert.match(r.text, /nothing is wrong on the page yet/);
});

test("PAST FOURTEEN HOURS IT REPORTS WHAT HAS ALREADY HAPPENED", { skip: NO_BROWSER }, async () => {
  const r = await feedState(feedNow({ checkedAt: agoHours(16) }));
  assert.match(r.cls, /is-bad/);
  assert.match(r.text, /showing .Call for today.s price. right now/);
  assert.match(r.text, /Post a price by hand/, "and it says what to do about it");
});

test("a flagged or empty board is reported as theirs, not as ours", { skip: NO_BROWSER }, async () => {
  const flagged = await feedState(feedNow({ checkedAt: agoHours(0.2), status: "stale" }));
  assert.match(flagged.text, /flagged/);
  assert.match(flagged.text, /Not our failure/);
  const empty = await feedState(feedNow({ checkedAt: agoHours(0.2), bids: [] }));
  assert.match(empty.text, /posting no rows/);
});

test("IT DOES NOT CLAIM THE FEED IS DEAD WHEN IT IS THE WI-FI", { skip: NO_BROWSER }, async () => {
  const r = await feedState(null);
  assert.match(r.cls, /is-warn/, "not is-bad");
  assert.match(r.text, /either the feed or this connection/);
  assert.match(r.text, /not a reason to post a price by hand/);
});

test("the liveness line renders no prices of its own", { skip: NO_BROWSER }, async () => {
  /* The board below is the one renderer of the figures. A second one is how two
     views of the same file drift apart. */
  const r = await feedState(feedNow({ checkedAt: agoHours(0.1),
    bids: [{ commodity: "Corn", delivery: "August", cash: 4.1525, basisDollars: -0.52 }] }));
  assert.doesNotMatch(r.text, /4\.15|0\.52|\$/, "a figure from the feed appears in the strip");
});

/* ══════════════════════════════════════════════════════════════════════════
   11. THE ROUND TRIP — what the screen sends really is what the applier reads
   ══════════════════════════════════════════════════════════════════════════
   Every other test checks one end or the other. This one takes what the real
   screen puts in a real issue URL and hands it to the real applier. It is the
   test that catches a label spelled one way on the screen and another way in
   the applier: a field that vanishes silently between pressing Save and the
   file changing. Run for BOTH elevators, because both file their own issue.
   ══════════════════════════════════════════════════════════════════════════ */

each("WHAT THE SCREEN SENDS IS WHAT THE APPLIER READS", async (E) => {
  const { applyUpdate, parseForm } = await import("../tools/apply-update.mjs");

  const p = await open({ rare: true });
  await p.uncheck(named(E.site, "sun_closed"));
  await p.fill(named(E.site, "sun_open"), "09:00");
  await p.fill(named(E.site, "sun_close"), "13:00");
  await p.fill(id(E.site, "off"), "0.14");
  const cashLabel = await p.$eval(`label[for="${E.site}-off"]`, (e) => e.textContent);
  const url = await save(p, E.site);
  const why = await refusal(p, E.site);
  await p.done();
  assert.ok(url, "Save opened nothing; the screen said: " + why);

  const body = new URL(url).searchParams.get("body");
  const form = parseForm(body);
  assert.equal(form["Sunday — opens"], "09:00");
  /* THE LABEL, THE HEADING AND THE APPLIER, HELD TOGETHER.
     The wording of this one changed tonight, and it is the field where a
     mismatch costs money: the office types a basis, sees an issue, and the
     number never lands. So the heading is taken from the label the office
     actually read on the screen, and that same string is what the applier is
     asked for — no copy of the wording lives in this file. */
  assert.equal(form[cashLabel], "0.14",
    `the applier cannot find the basis under the label the screen showed, “${cashLabel}”. ` +
    "Headings in the issue: " + JSON.stringify(Object.keys(form)));

  /* The file the applier is handed is the one this elevator is actually
     publishing — the same file the column filled itself from. Anything the
     office did not touch has to come out the far end unchanged, and "unchanged"
     means unchanged from THAT, not from a line written here. */
  const published = SITE_FILES[E.site].hours;
  const before = { ...published, today_date: null };
  const r = applyUpdate(form, { hours: before, pricing: { spread: 0.1, spreadHarvest: 0 },
                                todayISO: "2026-08-20" });
  assert.equal(r.hours.sunday, "9:00a to 1:00p", "Sunday did not survive the trip");
  assert.equal(r.pricing.spread, 0.14, "the basis did not survive the trip");
  assert.ok(r.did.length, "the applier reported no change at all");
  assert.equal(r.hours.weekday, published.weekday, "something the office did not touch moved");
  assert.equal(r.hours.saturday, published.saturday, "Saturday moved and nobody asked it to");
});

test("THE TWO COLUMNS CARRY EXACTLY THE SAME SET OF CONTROLS", { skip: NO_BROWSER }, async () => {
  /* They are stamped from one <template>, which is the only way two columns
     cannot drift apart — but "stamped from one template" is a claim about the
     source and this is the check on the result. A control present in one column
     and missing from the other is an elevator that cannot be told something the
     other one can, and the screen would look completely normal.

     Read off the rendered page rather than out of the file: the ids are made at
     stamp time and a control that failed to stamp still appears in the markup. */
  const p = await open({ rare: true });
  const r = await p.evaluate(() => {
    const out = {};
    document.querySelectorAll(".col").forEach((c) => {
      out[c.getAttribute("data-elev")] = {
        names: [...c.querySelectorAll("input,textarea,select")]
          .map((e) => e.name + ":" + e.type).sort(),
        hooks: [...c.querySelectorAll("[data-id]")].map((e) => e.getAttribute("data-id")).sort(),
      };
    });
    return out;
  });
  await p.done();
  const [a, b] = ELEVATORS.map((e) => r[e.site]);
  assert.ok(a && b, "a column is missing from the page entirely");
  assert.deepEqual(a.names, b.names, "the two columns do not carry the same controls");
  assert.deepEqual(a.hooks, b.hooks, "the two columns do not carry the same hooks");
  assert.ok(a.names.length > 20, "only " + a.names.length + " controls stamped — the template did not render");
});

each("THE LABEL ON THE SCREEN, THE HEADING IN THE ISSUE AND THE APPLIER AGREE", async (E) => {
  /* Three places carry the wording of the two basis boxes: the <label> the
     office reads, the LABELS table that writes the issue, and the headings
     apply-update.mjs looks for. They were renamed tonight — "Our basis under
     Big River" holds the SPREAD, not the basis, which is the exact confusion
     Jessie hit — and a rename that reaches two of the three is a field that
     silently stops arriving.

     Nothing here spells the wording out. The label is read off the screen and
     carried through the issue into the applier, so this test keeps working
     through the next rename and fails the moment one of the three is left
     behind. */
  const { applyUpdate, parseForm } = await import("../tools/apply-update.mjs");
  const p = await open();
  const labels = await p.evaluate((s) => ({
    cash: document.querySelector('label[for="' + s + '-off"]').textContent.trim(),
    crop: document.querySelector('label[for="' + s + '-offh"]').textContent.trim(),
  }), E.site);
  await p.fill(id(E.site, "off"), "0.23");
  await p.fill(id(E.site, "offh"), "0.09");
  const url = await save(p, E.site);
  const why = await refusal(p, E.site);
  await p.done();
  assert.ok(url, "Save opened nothing; the screen said: " + why);

  const form = parseForm(new URL(url).searchParams.get("body"));
  const headings = Object.keys(form);
  for (const [which, label] of Object.entries(labels))
    assert.ok(headings.includes(label),
      `the ${which} box is labelled “${label}” on screen but the issue calls it something ` +
      `else: ${JSON.stringify(headings.filter((h) => /Big River/i.test(h)))}`);
  assert.equal(form[labels.cash], "0.23");
  assert.equal(form[labels.crop], "0.09");

  const r = applyUpdate(form, { hours: { ...SITE_FILES[E.site].hours, today_date: null },
                                pricing: { spread: 0.1, spreadHarvest: 0 }, todayISO: "2026-08-20" });
  assert.equal(r.pricing.spread, 0.23,
    `the applier does not read the heading the screen writes for “${labels.cash}”`);
  assert.equal(r.pricing.spreadHarvest, 0.09,
    `the applier does not read the heading the screen writes for “${labels.crop}”`);
});

/* ══════════════════════════════════════════════════════════════════════════
   DID MY CHANGE LAND?
   ══════════════════════════════════════════════════════════════════════════
   Save opens a GitHub issue in a new tab and the screen used to never mention
   it again -- the office had to go and look at the site to find out whether
   their change had taken. The applier now stamps updated_at / updated_by as it
   writes, and the screen reads that back out of the file it already fetches.

   The claim is deliberately about the PUBLISHED FILE, not about the button:
   "live on the site" is checkable and useful, "saved" would only be a report
   on the screen's own behaviour.
   ══════════════════════════════════════════════════════════════════════════ */

const stamped = (over) => {
  const f = files();
  for (const e of ELEVATORS) f[e.site].hours = { ...f[e.site].hours, ...over };
  return f;
};

for (const e of ELEVATORS) {
  test(`THE SCREEN SAYS WHEN THE SITE LAST CHANGED, AND WHO — ${e.name}`, { skip: NO_BROWSER }, async () => {
    const p = await open({ sites: stamped({ updated_at: "2026-08-19T13:41:00Z", updated_by: "jessie" }) });
    const line = await p.textContent(`${col(e.site)} .saved`);
    assert.match(line, /live on the site/i,
      `the command bar says nothing about the published file: ${JSON.stringify(line)}`);
    assert.match(line, /jessie/, `the change is not attributed: ${JSON.stringify(line)}`);
    assert.match(line, /Aug 19/, `the date is missing or not Central: ${JSON.stringify(line)}`);
    /* 13:41 UTC is 8:41 in Wheeler. A UTC clock here would read 1:41 PM and
       the office would think somebody edited the site over lunch. */
    assert.match(line, /8:41/, `the time is not Central: ${JSON.stringify(line)}`);
    await p.close();
  });

  test(`A FILE WITH NO STAMP CLAIMS NOTHING — ${e.name}`, { skip: NO_BROWSER }, async () => {
    const p = await open({ sites: files() });
    const line = (await p.textContent(`${col(e.site)} .saved`)) || "";
    assert.equal(line.trim(), "",
      `with no updated_at in the file the screen invented a last-changed line: ${JSON.stringify(line)}`);
    await p.close();
  });

  test(`AN UNREADABLE STAMP CLAIMS NOTHING RATHER THAN SHOWING NaN — ${e.name}`, { skip: NO_BROWSER }, async () => {
    const p = await open({ sites: stamped({ updated_at: "last Tuesday", updated_by: "jessie" }) });
    const line = (await p.textContent(`${col(e.site)} .saved`)) || "";
    assert.equal(line.trim(), "", `a bad timestamp reached the screen: ${JSON.stringify(line)}`);
    await p.close();
  });
}
