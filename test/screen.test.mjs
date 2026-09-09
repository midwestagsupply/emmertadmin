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
  weekRows, todayPreview, figuresIn, files, feedNow, pick, press,
  ELEVATORS, OTHER, LAYOUT, col, id, named, SITE_FILES, BOARD_ROWS, HOURS_NOTE, PRICE_NOTE,
  feedFull, BOARD_ROWS_FULL,
  monthBox, monthTick, NEAREST, FIRST_NEW_CROP, only, monthRow, monthRows, MONTHS_ON_BOARD,
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

each("the elevator's identity is on its own heading and its own Save",
  async (E) => {
  /* WHERE IDENTITY LIVES NOW. The column used to carry its own header inside
     the sheet; that header cost three lines of height above the eleven months
     it sat on, so the live strip moved to the bar at the top of the page and
     the elevator's name moved into the group heading over its own three
     columns. The rule has not changed and is the reason this test exists: no
     part of one elevator's block may show the other elevator's name.

     The strip is still stamped WITH the column -- data-elev, and ids prefixed
     with the site -- so "its own" is a fact about the markup and not a
     coincidence of position. */
  const p = await open();
  const r = await p.evaluate((s) => {
    /* THE STRIP IS GONE. It carried the elevator's name, its town and which
       repository its Save wrote to, at the top of the page; Sig cut both lines
       on 2026-09-09 as a restatement of the two screens under them. Name and
       town are on the heading over the elevator's own columns, which this test
       already read; the repository is on the Save button's own confirmation,
       which the URL test proves. So what is left to ask here is the question
       this test was always for: does every part of one elevator's block name
       THAT elevator. */
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    const cols = { badger: 7, midwest: 10 };
    const heading = [...document.querySelectorAll(".sheet .cell.hd.grp")]
      .find((h) => (h.style.gridColumn || "").startsWith(String(cols[s]) + " "));
    return {
      heading: heading ? heading.textContent : null,
      saveWho: c.querySelector(".btn-go .save-who").textContent,
      harvest: c.querySelector(".who-harvest").textContent,
      colText: c.textContent,
    };
  }, E.site);
  await p.done();
  assert.ok(r.heading && r.heading.includes(E.name) && r.heading.includes(E.town),
    `the heading over this elevator's columns reads ${JSON.stringify(r.heading)}`);
  assert.ok(E.name.startsWith(r.saveWho.trim()),
    "Save must name the elevator it saves, on the button");
  assert.equal(r.harvest, E.harvest, "harvest hours differ between the two and are not shared");

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

/* ══════════════════════════════════════════════════════════════════════════
   SIX TESTS OF THE HOURS PREVIEW ARE GONE, AND SO IS THE PREVIEW.

   Sig, 2026-09-09, over a screenshot with both preview columns struck out: "i
   dont think the on the site column is necessary at all, it is just clutter for
   what is already being set or displayed on page". He was right: every line it
   printed -- "Mon to Fri 8:00a to 5:00p", "Saturday Closed", "Nothing. The
   yellow bar is hidden." -- restated the two boxes and the checkbox beside it.

   THE CLAIMS ARE NOT ORPHANED, AND THAT WAS CHECKED BEFORE DELETING ANYTHING.
   What the site does with closed_today, today_override, harvest_mode and the
   weekly rows is the SITE'S behaviour, and each site owns 84 tests of it in
   test/clientclock.test.mjs and test/hours.test.mjs -- including "Closed for
   the day" after closing time, a stale closed_today expiring, an override
   rendering, and each weekly row printing or not. Those tests read the site's
   real render. The ones deleted here read a preview of it, one level up, and a
   preview is not a second opinion: it was the same arithmetic run twice.

   What this file still owns about hours is what only this screen can get
   wrong: that a control writes into its own column, that the sentence beside
   "Usual" follows the boxes under it, that a day left open with no hours is
   refused, and that what Save files is what the applier reads.

   A SEVENTH went with the top strip on the same day: "THE NEW CROP PRICE IS
   SHOWN, NOT ONLY THE CASH ONE" watched the two-row customer preview inside
   that strip, which existed because the screen could only show two of the
   elevator's prices. It shows all eleven now, one to a row, and THE BOARD IS
   DRAWN FROM THE FEED checks every one of them.
   ══════════════════════════════════════════════════════════════════════════ */

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
  await p.fill(monthBox(E.site, NEAREST), "abc");
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
  await p.fill(monthBox(E.site, NEAREST), "abc");
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
  /* THE BASIS TRAVELS AS A TABLE NOW, under one heading, with a line per month.
     There is no longer a `label[for=...-off]` to read the wording off -- the
     boxes are cells in a row and their names are the month names -- so what
     this asserts is that the table is in the body at all and that it names the
     months. The heading's exact wording is checked once, against LABELS and
     against the applier, by THE LABEL ON THE SCREEN, THE HEADING IN THE ISSUE
     AND THE APPLIER AGREE; spelling it out here too would be a second copy. */
  assert.match(body, /### Months — what we publish\n/,
    "the issue carries no months table");
  assert.match(body, new RegExp("^" + NEAREST + "\\s+\\S+\\s+(show|hide)$", "m"),
    "the months table carries no line for " + NEAREST);
});

each("the issue carries this elevator's OWN figures, not the other column's", async (E) => {
  /* The fault this exists for: two forms carrying the same 22 control names,
     and one page-wide byName() away from the right-hand column filing the
     left-hand elevator's work under the right-hand elevator's name. */
  const other = OTHER(E.site);
  const p = await open();
  await p.fill(monthBox(E.site, NEAREST), "-0.31");
  await p.fill(monthBox(other.site, NEAREST), "-0.77");
  await p.fill(id(E.site, "msg"), `only ${E.site}`);
  await p.fill(id(other.site, "msg"), `only ${other.site}`);
  const url = await save(p, E.site);
  await p.done();
  assert.ok(url, "Save opened nothing");
  const body = new URL(url).searchParams.get("body");
  /* On its own line of the months table -- "August -0.31 show" -- rather than
     as a heading's whole value, which is what the single basis box used to be. */
  assert.match(body, new RegExp("^" + NEAREST + "\\s+-0\\.31\\s", "m"),
    "the basis this column holds is not in its own issue");
  assert.ok(!body.includes("-0.77"), "the other elevator's basis travelled in this issue");
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

test("every control that travels has a name, and the ones that do not travel say so",
  { skip: NO_BROWSER }, async () => {
  /* THE ONE EXCEPTION, AND WHY IT IS DELIBERATE. Eleven delivery months, a tick
     and a basis box each, is twenty-two controls per elevator. Named, they would
     be twenty-two headings in every issue -- past the 7,500-character cap this
     screen enforces on the URL -- and twenty-two more entries in the map that
     keeps this screen and the applier level.

     So they are unnamed on purpose: they write into one hidden field, `months`,
     which does have a name and does travel. This test asserts both halves --
     that the only unnamed controls are the month ones, and that pressing Save
     really does carry the table they wrote. Without the second half "unnamed"
     would be indistinguishable from "silently dropped". */
  const p = await open();
  const r = await p.evaluate(() => {
    const out = {};
    document.querySelectorAll(".col").forEach((c) => {
      out[c.getAttribute("data-elev")] = [...c.querySelectorAll("input,select,textarea")]
        .filter((e) => !e.name)
        .map((e) => (e.closest(".cell") || {}).className || e.outerHTML.slice(0, 40));
    });
    return out;
  });
  const url = await save(p, "badger");
  await p.done();
  for (const E of ELEVATORS) {
    const stray = r[E.site].filter((k) => !/\bpub\b|\bctl\b/.test(k));
    assert.deepEqual(stray, [], `unnamed controls in ${E.name} that are not month cells`);
    assert.ok(r[E.site].length >= 2, `${E.name} has no month controls at all`);
  }
  const body = new URL(url).searchParams.get("body");
  assert.match(body, /### Months — what we publish/,
    "the month table is not in the issue, so the unnamed controls went nowhere");
  assert.match(body, /September .* (show|hide)/,
    "the month table is in the issue but carries no months");
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
  const before = await p.evaluate(([s, m]) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    return {
      text: c.querySelector('.cell.ctl[data-month="' + m + '"] input.mbasis').value,
      time: c.querySelector('[name="wk_open"]').value,
      radioToday: c.querySelector('input[name="today"]:checked').value,
      radioBanner: c.querySelector('input[name="banner"]:checked').value,
      check: c.querySelector('[name="sat_closed"]').checked,
      area: document.getElementById(s + "-msg").value,
      details: (c.querySelector("details.byhand") || {}).open,
      /* weekPrev, todayPrev, notice and the basis note were the four readbacks
         in the "on the site" column, cut 2026-09-09. What is left that this
         column derives from its own boxes is the sentence beside "Usual" and
         the figure the site is publishing, and both still have to stay put
         while the OTHER elevator is edited. */
      posted: c.querySelector('.cell.pay[data-month="' + m + '"]').textContent,
      summary: document.getElementById(s + "-usualSummary").textContent,
    };
  }, [other.site, NEAREST]);

  /* One of every kind of control in the column under test. */
  await p.fill(monthBox(E.site, NEAREST), "0.37");                                   // text
  await p.fill(named(E.site, "wk_open"), "05:15");                           // time
  await pick(p, E.site, "today", "closed");           // radio
  await pick(p, E.site, "banner", "off");             // radio, second group
  await p.check(named(E.site, "sat_closed"));                                // checkbox
  await p.fill(id(E.site, "msg"), "one elevator only");                      // textarea
  /* NOT THE BY-HAND DRAWER. It was the `details` control in this sweep, and it
     is hidden while the board is up -- `body[data-board="on"]` -- because with
     eleven live prices on screen there is nothing to post by hand. Clicking a
     hidden summary times out, which reports as "one column edited the other"
     and is nothing of the kind. The drawer's own isolation is checked below on
     a screen with no feed, which is the only state it is on screen in. */
  await p.waitForTimeout(120);

  const after = await p.evaluate(([s, m]) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    return {
      text: c.querySelector('.cell.ctl[data-month="' + m + '"] input.mbasis').value,
      time: c.querySelector('[name="wk_open"]').value,
      radioToday: c.querySelector('input[name="today"]:checked').value,
      radioBanner: c.querySelector('input[name="banner"]:checked').value,
      check: c.querySelector('[name="sat_closed"]').checked,
      area: document.getElementById(s + "-msg").value,
      details: (c.querySelector("details.byhand") || {}).open,
      /* weekPrev, todayPrev, notice and the basis note were the four readbacks
         in the "on the site" column, cut 2026-09-09. What is left that this
         column derives from its own boxes is the sentence beside "Usual" and
         the figure the site is publishing, and both still have to stay put
         while the OTHER elevator is edited. */
      posted: c.querySelector('.cell.pay[data-month="' + m + '"]').textContent,
      summary: document.getElementById(s + "-usualSummary").textContent,
    };
  }, [other.site, NEAREST]);
  /* And the column that WAS typed into really did move — otherwise this test
     passes on a screen where nothing works at all. */
  const mine = await p.evaluate(([s, m]) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    return {
      text: c.querySelector('.cell.ctl[data-month="' + m + '"] input.mbasis').value,
      time: c.querySelector('[name="wk_open"]').value,
      details: (c.querySelector("details.byhand") || {}).open,
    };
  }, [E.site, NEAREST]);
  await p.done();

  for (const k of Object.keys(before))
    assert.deepEqual(after[k], before[k], `${other.name}'s ${k} moved when ${E.name} was edited`);
  assert.equal(mine.text, "0.37", "the column under test did not take the edit");
  assert.equal(mine.time, "05:15");
});

each("THE BY-HAND DRAWER OPENS IN ITS OWN COLUMN ONLY, on the screen it lives on",
  async (E) => {
  /* The `details` control, taken out of the sweep above because the drawer is
     hidden while the board is up. This is the state it exists for: no feed, no
     board, and somebody about to type a price in by hand. The claim is the same
     one every control in that sweep makes -- opening this elevator's drawer
     leaves the other elevator's shut -- and it is worth its own test rather
     than being dropped, because two <details> with the same markup one column
     apart is exactly the shape that goes wrong. */
  const other = OTHER(E.site);
  const p = await open({ feed: null });
  const sel = (s) => `.col[data-elev="${s}"] details.byhand`;
  await p.waitForSelector(`${sel(E.site)} > summary`, { state: "visible" });
  await p.click(`${sel(E.site)} > summary`);
  await p.waitForTimeout(150);
  const r = await p.evaluate(([a, b]) => ({
    mine: document.querySelector('.col[data-elev="' + a + '"] details.byhand').open,
    theirs: document.querySelector('.col[data-elev="' + b + '"] details.byhand').open,
  }), [E.site, other.site]);
  await p.done();
  assert.equal(r.mine, true, "the drawer did not open in the column it was clicked in");
  assert.equal(r.theirs, false, "opening one elevator's drawer opened the other's");
});

each("Undo in one column does not undo the other", async (E) => {
  const other = OTHER(E.site);
  const p = await open();
  await p.fill(monthBox(E.site, NEAREST), "0.41");
  await p.fill(monthBox(other.site, NEAREST), "0.42");
  /* press(), not p.click(). Playwright's click scrolls the target into view
     first even when it is already fully on screen, the console's pinShell()
     guard answers that scroll by putting the document back, and the button
     moves between mousedown and mouseup -- so NO click event is dispatched.
     This test used p.click() and passed only because the geometry happened to
     make the pre-click scroll a no-op; adding the rail moved the button and
     it started reporting Undo as broken. Undo was never broken: a raw mouse
     click at the button's own coordinates fires reset, measured. The harness
     has press() for exactly this and its comment says so. */
  await press(p, `${col(E.site)} button[type=reset]`);
  await p.waitForTimeout(150);
  const r = await p.evaluate(([a, b, m]) => {
    const box = (s) => document.querySelector(
      '.col[data-elev="' + s + '"] .cell.ctl[data-month="' + m + '"] input.mbasis').value;
    return { mine: box(a), theirs: box(b) };
  }, [E.site, other.site, NEAREST]);
  await p.done();
  assert.notEqual(r.mine, "0.41", "Undo did nothing in the column it was pressed in");
  assert.equal(r.theirs, "0.42", "Undo in one column threw away the other elevator's work");
});

each("a refusal in one column does not put a complaint on the other", async (E) => {
  const other = OTHER(E.site);
  const p = await open();
  await p.fill(monthBox(E.site, NEAREST), "abc");
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
   4. BOTH COLUMNS ARE ON EVERY SCREEN, AND EACH SAVE CARRIES ONLY ITS OWN
   ══════════════════════════════════════════════════════════════════════════
   This section used to prove that the column you were NOT looking at was
   display:none -- out of the tab order, out of its form's submission, its Save
   unpressable. That was the right guarantee for a screen that could only show
   one elevator at a time below 1440px, because two columns of stacked cards did
   not fit.

   The sheet does not stack cards. Under 1200px it places the same cells six
   wide -- shared row, then Badger's, then Midwest's -- so nothing has to be
   hidden at any width, and the elevator switch is gone with the hiding.

   THE GUARANTEE UNDERNEATH IT IS UNCHANGED AND IS WHAT THESE TESTS NOW ASSERT:
   one Save never carries the other elevator's work. That was true because the
   other column was gone; it is true now because there are two forms and every
   control is inside exactly one of them, which is the stronger reason. */

for (const [label, viewport] of [["a short desk", LAYOUT.SHORT],
                                 ["the roomy layout", LAYOUT.ROOMY],
                                 ["a phone", LAYOUT.PHONE]])
  test(`BOTH ELEVATORS ARE ON THE SCREEN — ${label}`, { skip: NO_BROWSER }, async () => {
  const p = await open({ viewport, query: "?site=badger" });
  const r = await p.evaluate(() => {
    const box = (s) => {
      const e = document.querySelector('.col[data-elev="' + s + '"] .btn-go');
      const b = e.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    };
    return {
      cells: ["badger", "midwest"].map((s) =>
        [...document.querySelectorAll('.col[data-elev="' + s + '"] .cell')]
          .filter((c) => c.getClientRects().length).length),
      saves: { badger: box("badger"), midwest: box("midwest") },
      switcher: !!document.getElementById("elevSwitch"),
    };
  });
  await p.done();
  assert.ok(r.cells[0] > 3 && r.cells[1] > 3,
    `one of the elevators has almost nothing on screen: ${JSON.stringify(r.cells)}`);
  for (const s of ["badger", "midwest"])
    assert.ok(r.saves[s].w > 40 && r.saves[s].h > 20,
      `${s}'s Save is ${JSON.stringify(r.saves[s])} — it cannot be pressed`);
  assert.equal(r.switcher, false,
    "the elevator switch is still on the page, and there is nothing left for it to switch");
});

test("TABBING REACHES BOTH ELEVATORS AND NOTHING THAT IS NOT ON SCREEN",
  { skip: NO_BROWSER }, async () => {
  const p = await open({ viewport: LAYOUT.SHORT });
  const touched = new Set();
  const offscreen = [];
  for (let i = 0; i < 160; i++) {
    await p.keyboard.press("Tab");
    const r = await p.evaluate(() => {
      const a = document.activeElement;
      const c = a && a.closest ? a.closest(".col") : null;
      const on = a && a.getClientRects && a.getClientRects().length > 0;
      return { elev: c ? c.getAttribute("data-elev") : "chrome", on };
    });
    touched.add(r.elev);
    if (!r.on && r.elev !== "chrome") offscreen.push(r.elev);
  }
  await p.done();
  assert.ok(touched.has("badger") && touched.has("midwest"),
    `tabbing reached ${[...touched].join(", ")} — both elevators are on the screen`);
  assert.deepEqual(offscreen, [],
    "Tab reached a control that is not painted, which is how somebody types into a box they cannot see");
});

each("SAVE CARRIES NOTHING FROM THE OTHER COLUMN", async (E) => {
  /* The reason changed and the rule did not. Both columns are on screen now, so
     this is no longer "the other one is display:none" -- it is "there are two
     forms and every control belongs to one of them". Typed into both, saved
     from one, and the other's figures must be nowhere in the issue. */
  const other = OTHER(E.site);
  const p = await open();
  await p.fill(monthBox(E.site, NEAREST), "-0.19");
  await p.fill(monthBox(other.site, NEAREST), "-0.88");
  await p.fill(id(other.site, "msg"), "the other elevator's banner");
  const url = await save(p, E.site);
  await p.done();
  assert.ok(url, "Save opened nothing");
  const body = new URL(url).searchParams.get("body");
  /* On its own line of the months table, not as a heading's whole value. */
  assert.match(body, new RegExp("^" + NEAREST + "\\s+-0\\.19\\s", "m"),
    "the column's own basis is not in its issue");
  assert.ok(!body.includes("-0.88"), "the other column's basis was submitted");
  assert.ok(!body.includes("the other elevator's banner"), "the other column's banner was submitted");
  assert.equal(new URL(url).pathname, `/midwestagsupply/${E.repo}/issues/new`);
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
  /* AMENDED FOR THE SHEET. The board is no longer a table above both columns;
     its rows ARE the basis screen, one per delivery month, with each elevator's
     tick, basis box and posted price on the row they belong to. The two marks
     are on the basis cell rather than on a <tr>, because there is no <tr>: they
     are what the two readouts read back, and they still mean the same two
     things. The shipped sample table is gone entirely rather than hidden, so
     "is it still filler" is now "was the board drawn at all". */
  const p = await open({ tab: "basis" });
  const p2 = p;
  const r = await p.evaluate(() => ({
    rows: [...document.querySelectorAll(".sheet .cell.mo[data-month]")].map((c) => ({
      month: c.getAttribute("data-month"),
    })),
    marks: [...document.querySelectorAll(".sheet .cell.basis-cell")].map((c) => ({
      month: c.getAttribute("data-month"),
      cls: c.className,
      basis: c.textContent,
    })),
    stillSample: !!document.querySelector("[data-sample]:not(input):not(textarea):not(select)"),
  }));
  assert.equal(r.stillSample, false, "the shipped sample rows are still on screen");
  assert.deepEqual(r.rows.map((x) => x.month), BOARD_ROWS.map((x) => x.delivery),
    "the board must print their rows, in their order");
  assert.deepEqual(r.marks.filter((x) => /\bis-ref\b/.test(x.cls)).map((x) => x.month), ["August"],
    "exactly one row is the nearest delivery");
  assert.deepEqual(r.marks.filter((x) => /\bis-new\b/.test(x.cls)).map((x) => x.month),
    ["October", "November"], "the new-crop rows are the ones the sites call harvest");
  /* Every basis on screen is their figure, printed, not worked out. */
  for (const row of r.marks) {
    const want = BOARD_ROWS.find((b) => b.delivery === row.month).basisDollars;
    assert.equal(row.basis.replace("−", "-"), want.toFixed(2));
  }
  /* TO THE CENT, EVERY FIGURE, ON PURPOSE. Sig, 2026-09-08: "i always want to
     round the corn price to the hundreds only." This reverses the 2026-08-31
     decision to print their quarter cents here, and the cost of the reversal is
     real: two different quotes of theirs can now read the same on this screen,
     so it is no longer a line-for-line check against their page. What it buys is
     a board a person can read across without doing arithmetic on thousandths.
     Nothing stored changes -- the feed, bids.json and both sites still carry the
     full figure; this is about what is PRINTED here. */
  /* THE FIGURE, NOT THE CELL. The Futures cell carries the gap to the CBOT
     settle after its price -- "$5.33-0.25c" -- and that suffix is a cent count,
     not money, so it is read off the figure node rather than the cell's whole
     text. Reading textContent made the test claim the board was not printed to
     the cent when what it had found was the label beside the price. */
  const printed = await p2.evaluate(() => [...document.querySelectorAll(".sheet .cell.num")]
    .map((c) => (c.firstChild ? c.firstChild.textContent : "").trim())
    .filter((t) => t.startsWith("$")));
  /* TWO MONEY COLUMNS PER ROW: the futures the price is made from, and Big
     River's bid. It was three until "Their quote" was cut on 2026-09-09, and
     this read `> 10` -- a number that meant "three columns times four fixture
     rows, less a margin" and quietly became a real assertion about the deleted
     column. Counted off the board itself now, so cutting or adding a money
     column changes the expectation with the screen instead of failing. */
  const moneyCols = 2;
  assert.equal(printed.length, BOARD_ROWS.length * moneyCols,
    `${printed.length} money figures on a ${BOARD_ROWS.length}-row board; ` +
    `expected ${moneyCols} a row: ${JSON.stringify(printed)}`);
  for (const t of printed)
    assert.match(t, /^\$\d+\.\d{2}(\s|$)/,
      `${JSON.stringify(t)} is not printed to the cent`);
  await p.done();
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
  /* Read off the month cells, not off `.bd tbody tr.is-new` -- the board was a
     <table> and is a grid of cells now, and the old selector matched nothing,
     which deepEqual reported as "the screen rings a different set of rows"
     rather than as a test asking about markup that is gone. */
  const tagged = await p.$$eval(".sheet .cell.mo", (cells) => cells
    .filter((c) => /new crop/i.test((c.querySelector(".tag") || {}).textContent || ""))
    .map((c) => c.firstChild.textContent.trim()));
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
    /* AMENDED: there is no sample board left to leave in place. A feed that
       will not load leaves the basis screen with NO month rows at all, which is
       the same claim said in the one way that cannot be mistaken for filler --
       and the readouts still have to stay silent about a board they never saw. */
    monthRows: document.querySelectorAll(".sheet .cell[data-month]").length,
    reads: [...document.querySelectorAll(".basis-read")].map((e) => e.textContent),
  }));
  await p.done();
  assert.equal(r.monthRows, 0, "a feed that did not load still drew month rows");
  /* AMENDED: the claim is that nothing is quoted off the SAMPLE BOARD, and
     it used to be enough to say "no figures at all", because every figure in
     that line came from the board. The blank new-crop state now prints our own
     basis -- out of pricing.json, nothing to do with their board -- so the
     check names the board's own figures instead of forbidding arithmetic
     wholesale. It is the stricter reading of the same rule: a sample basis
     reaching that line still fails, and now it fails by name. */
  const BOARD_FIGURES = BOARD_ROWS.flatMap((b) => [Math.abs(b.basisDollars), Math.abs(b.cash)]);
  for (const t of r.reads)
    for (const n of figuresIn(t))
      assert.ok(!BOARD_FIGURES.includes(Math.abs(n)),
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
const REFMO = BOARD_ROWS[0].futuresMonth;                     // and the contract it sits on
const NEWMO = BOARD_ROWS.find((b) => b.delivery === "October").futuresMonth;
const BASIS = (s) => SITE_FILES[s].pricing.basis;             // what this elevator posts
/* "0.23 under them" -- the gap between our basis and theirs, said the way the
   readout says it, so the expectation is built from the fixture rather than
   from a number typed twice. */
const versus = (mine, theirs) => Math.abs(mine - theirs) < 1e-9
  ? "even with them"
  : `${money(Math.abs(mine - theirs))} ${mine < theirs ? "under" : "over"} them`;
const NEWROW = BOARD_ROWS.find((b) => b.delivery === "October").basisDollars;
const money = (v) => (v < 0 ? "−" : "") + Math.abs(v).toFixed(2);

/* ══════════════════════════════════════════════════════════════════════════
   WHAT REPLACED THE TWO READOUTS.

   These six tests used to interrogate two standing paragraphs -- a cash basis
   readout and a new-crop one -- each naming a contract month, Big River's
   basis on it, and the gap between theirs and ours. Sig deleted the block they
   lived in: "what the fuck is all the nonsense up top ... i want the basis
   page to read like the lower portion, select which months to display on site,
   set baasis for each".

   Every claim those paragraphs made is still made, and made eleven times
   instead of twice -- once per row of the table, where the row IS the contract
   month and the board figures sit in the same row as the box. So the tests are
   re-aimed rather than deleted: the guard that mattered was never "this
   paragraph exists", it was "the figure beside the box is measured against the
   row that box governs, and no cash price is worked out here."
   ══════════════════════════════════════════════════════════════════════════ */

const THEIRS = (m) => BOARD_ROWS_FULL.find((b) => b.delivery === m).basisDollars;

/* THE TWO TESTS THAT STOOD HERE ARE GONE WITH THE NOTE THEY WATCHED.
   They asked whether the "0.62 over them" line under each box was measured
   against that month's own board row, and whether it ever printed a dollar
   figure. Sig cut the note on 2026-09-09 -- "get rid of a lot oof dumb shit" --
   because it restated a subtraction of two numbers already in the row.
   NEITHER CLAIM IS ORPHANED. "No price is worked out on this screen" is the
   standing rule and has its own test above, now scoped to every `.cell.pay`
   rather than to a list of class names, so it covers anything that starts
   printing money here. And the figures the note was measured against are the
   board's own, which THE BOARD IS DRAWN FROM THE FEED checks row by row. */

each("“NO BASIS SET YET” UNDERSTANDS THE MODEL THE SITE IS ACTUALLY ON", async (E) => {
  /* THE FAULT, on Sig's own screen, 2026-09-09. He set Badger's basis, saved
     it, the applier wrote it, the site published $4.54 off it -- and the red
     warning went on saying "no basis set yet. Still pricing off the old $0.00
     spread." He saved again. It stayed. It would have stayed forever.

     The check read pricing.json's TOP-LEVEL `basis`, which is what the old
     one-figure-per-site model wrote. The months model never writes it: it
     writes months.<Month>.basis, one per delivery. So on any site that has
     moved over, the condition was permanently true -- a red warning sitting
     above boxes showing the right figures, on a site posting the right price.

     Both directions are checked, because deleting the warning would also make
     the first half pass. It has to stay silent on a site that IS priced and
     stay loud on one that is not. */
  const table = (pub) => Object.fromEntries(BOARD_ROWS_FULL.map((r) =>
    [r.delivery, { basis: r.basisDollars, publish: pub.includes(r.delivery) }]));
  const nobasis = (p) => warnings(p).then((w) => w.filter((t) => /no basis set yet/.test(t)));

  for (const [what, pricing, shouldWarn] of [
    ["a site still on the old spread", only({ spread: 0.1, spreadHarvest: 0 }), true],
    ["a months table with nothing published", only({ spread: 0, months: table([]) }), true],
    ["a published month whose basis is null",
      only({ spread: 0, months: { September: { basis: null, publish: true } } }), true],
    ["a site priced by its months table",
      only({ spread: 0, months: table(["September", "October"]) }), false],
    ["a site still carrying the single basis", only({ spread: 0, basis: -0.7 }), false],
  ]) {
    const p = await open({ tab: "basis", feed: feedFull(),
                           sites: files({ [E.site]: { pricing } }) });
    await p.waitForTimeout(700);
    const w = await nobasis(p);
    await p.done();
    assert.equal(w.length > 0, shouldWarn,
      shouldWarn
        ? `${what}: the warning is silent on a site that cannot price a month`
        : `${what}: the warning fires on a site that IS priced — ${JSON.stringify(w)}`);
  }
});

each("BLANK AND A FIGURE MEAN OPPOSITE THINGS, and a typo is neither", async (E) => {
  /* WAS blank-versus-zero on the new-crop box, where blank meant "same as the
     cash basis" and zero meant "even with the contract" -- two states that had
     to look different or somebody clears a box to mean 0 and moves a price.

     The pair survives every redesign since, with the same teeth. Blank is the
     only thing that means "leave this month alone", and the box says so in its
     own placeholder. A figure -- zero included -- is a basis and travels as
     one. And a typo is not quietly folded into either: it stops the save and
     the refusal names the month, because "leave it alone" and "I typed zz" must
     never reach the site as the same instruction.

     This used to read the note beside the box for the difference. The note is
     gone; what the box SENDS is the stronger question anyway, and it is asked
     of the real issue body through the real parser. */
  const p = await open({ tab: "basis", feed: feedFull() });
  const m = FIRST_NEW_CROP;
  const table = async () => {
    const url = await save(p, E.site);
    assert.ok(url, "Save opened nothing: " + (await refusal(p, E.site)));
    const { parseForm } = await import("../tools/apply-update.mjs");
    return parseForm(new URL(url).searchParams.get("body"))["Months — what we publish"];
  };

  assert.equal(await p.$eval(monthBox(E.site, m), (e) => e.placeholder), "same",
    "a box does not say what leaving it blank does");

  await p.fill(monthBox(E.site, m), "");
  await p.waitForTimeout(120);
  assert.match(await table(), new RegExp("^" + m + "\\s+same\\s+", "m"),
    "a blank box did not travel as 'same'");

  await p.fill(monthBox(E.site, m), "0");
  await p.waitForTimeout(120);
  assert.match(await table(), new RegExp("^" + m + "\\s+0\\s+", "m"),
    "zero was treated as blank; zero is a basis and travels as one");

  await p.fill(monthBox(E.site, m), "-0.45");
  await p.waitForTimeout(120);
  assert.match(await table(), new RegExp("^" + m + "\\s+-0\\.45\\s+", "m"));

  await p.fill(monthBox(E.site, m), "zz");
  await p.waitForTimeout(120);
  assert.equal(await save(p, E.site), null, "a typo in a basis box saved anyway");
  assert.match(await refusal(p, E.site), new RegExp("basis for " + m + ".*not a number"),
    "the refusal does not say which month is wrong");
  await p.done();
});

test("the two columns read the same board row and their own box", { skip: NO_BROWSER }, async () => {
  /* Same month, same board row, two elevators. Both notes are measured against
     ONE figure -- Big River's basis on that row -- and each against its own
     box, so the two cannot come out the same unless a column is reading the
     other's typing. The fixture gives them different basis figures for exactly
     this. */
  const p = await open({ tab: "basis", feed: feedFull() });
  /* The board's own first row, not NEAREST: NEAREST is the nearest delivery on
     the SHORT fixture board, and this test runs on the full one. */
  const m = MONTHS_ON_BOARD[0];
  const r = {};
  for (const E of ELEVATORS) r[E.site] = await monthRow(p, E.site, m);
  await p.done();
  assert.notEqual(BASIS("badger"), BASIS("midwest"),
    "the fixture cannot tell the two columns apart");
  for (const E of ELEVATORS)
    assert.equal(r[E.site].basis, String(BASIS(E.site)),
      `${E.site}'s box on ${m} does not hold its own site's basis`);
  assert.notEqual(r.badger.basis, r.midwest.basis,
    "both columns hold the same figure — one is reading the other's file");
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
  /* WHEREVER OURS APPEARS. `td.pay, .prev-bid, .basis-read` were the three
     places a price of ours was printed on the old screen; all three are gone
     -- the table, the customer preview in the top strip, and the two basis
     readouts. There is one place now, the ON THE SITE cell on each month row,
     and it is asked the same question: is every dollar figure in it one that
     arrived in a file. Scoped to `.cell.pay` rather than to a list of class
     names, so a fourth place to print a price of ours cannot appear without
     this test seeing it. */
  const p = await open();
  const shown = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll(".sheet .cell.pay").forEach((e) => {
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

/* .counter IS TWO THINGS WEARING ONE CLASS. Most of it is explanation --
   "Two lines on a phone" -- and the ? key is right to hide that. The "N left"
   tag the script appends into it is STATE, and hiding state is how somebody
   types a sentence into the notice box, has it stop at 160 characters mid-word
   with no beep, and reads the preview ending "...please p" without noticing. So
   the words go to font-size 0 and the tag stays readable. These tests ask about
   the WORDS, not the box around them. */
const COUNTER_PROBE = `(() => {
  const el = document.querySelector(".col .counter");
  if (!el) return "missing";
  const cs = getComputedStyle(el);
  return cs.display === "none" || cs.fontSize === "0px" ? "none" : cs.display;
})()`;

test("the ? key hides the explanation, and the key says which way it is set",
  { skip: NO_BROWSER }, async () => {
  const p = await open();
  const read = () => p.evaluate((COUNTER_PROBE_ARG) => ({
    flag: document.body.getAttribute("data-help"),
    pressed: document.getElementById("helpBtn").getAttribute("aria-pressed"),
    help: getComputedStyle(document.querySelector(".col .help")).display,
    counter: eval(COUNTER_PROBE_ARG),
    /* AMENDED: .board-note lived under the read-only board table above both
       columns, and that table is the basis screen now. The third thing the key
       hides is the label over each preview, which is explanation in exactly the
       same sense: it tells you what the block under it is. */
    /* The third thing the key hides is the sentence under each row's name --
       what the setting is and where it shows on the site. That is explanation
       in exactly the sense the key exists for. */
    rowNote: getComputedStyle(document.querySelector(".sheet .cell.lab .sub")).display,
    inDom: !!document.querySelector(".col .help"),
  }), COUNTER_PROBE);
  const off = await read();
  await p.click("#helpBtn"); await p.waitForTimeout(80);
  const on = await read();
  await p.keyboard.press("?"); await p.waitForTimeout(80);
  const backOff = await read();
  await p.done();
  assert.deepEqual([off.flag, on.flag, backOff.flag], ["off", "on", "off"],
    "the ? key must toggle, from the button and from the keyboard");
  assert.deepEqual([off.pressed, on.pressed], ["false", "true"]);
  for (const what of ["help", "counter", "rowNote"]) {
    assert.equal(off[what], "none", `.${what} is still on screen with the key off`);
    assert.notEqual(on[what], "none", `.${what} did not come back with the key on`);
  }
  assert.ok(off.inDom, "the explanation is hidden, never deleted — it is still read aloud");
});

each("the ? key never takes away the board or the boxes", async (E) => {
  /* The basis is the number the trade actually quotes, and the board it is set
     against is the only thing on this screen a person cannot work out for
     themselves. Neither is a .counter and neither is a .help, for exactly this
     reason: the ? key folds away the explanatory text, and it must never fold
     away the figures.

     WAS TWO STANDING READOUTS; is eleven rows. The claim did not change -- the
     help key may not take the basis off this screen -- so it is now asked of
     the row: the board figure, the box, and what the site is publishing. */
  const p = await open({ tab: "basis", feed: feedFull() });
  const m = MONTHS_ON_BOARD[0];
  const read = () => p.evaluate(([s, mo]) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    const gone = (el) => !el || getComputedStyle(el).display === "none";
    const board = document.querySelector('.sheet .cell.num.set[data-month="' + mo + '"]');
    const box = c.querySelector('.cell.ctl[data-month="' + mo + '"] input');
    const pay = c.querySelector('.cell.pay[data-month="' + mo + '"]');
    return { boardGone: gone(board), boxGone: gone(box), payGone: gone(pay),
             board: board ? board.textContent.trim() : null,
             box: box ? box.value : null };
  }, [E.site, m]);

  const off = await read();
  await p.click("#helpBtn"); await p.waitForTimeout(80);
  const on = await read();
  await p.done();
  for (const state of [["off", off], ["on", on]])
    for (const k of ["boardGone", "boxGone", "payGone"])
      assert.equal(state[1][k], false,
        `${k.replace("Gone", "")} is not on screen with the help key ${state[0]}`);
  assert.deepEqual(on, off, "the help key changed what the row says");
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
  /* AMENDED: there is no fold left to drive this at. The weekly hours were two
     cards low in a scrolling column and could be put away; they are three rows
     of a table now and are always on screen. The worst case this test exists for
     is unchanged -- Save pressed, nothing filed, and the screen apparently
     identical -- so it is driven on the hours screen, where the box in question
     lives, with the ? key off, which is how the office will actually meet it. */
  const p = await open({ tab: "hours" });
  await p.uncheck(named(E.site, "sun_closed"));
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
  /* NOT THE FIRST .help ON THE PAGE. The first one is inside the by-hand panel,
     which is a <details> and is closed -- so it is display:none for a reason
     that has nothing to do with the ? key, and asking about it would have this
     test pass or fail on whether somebody had opened a panel. Ask about one
     that is not behind a fold. */
  const pick = () => {
    /* AND NOT ONLY `.help`. Every `.help` on this screen now lives inside the
       by-hand <details>, so this found nothing and returned "missing" -- which
       is not "none", so the assertion below passed while checking nothing at
       all. `.hint` is the other class the console's fold rules reach, and the
       sentence under the Today buttons carries it outside any fold. The
       assertion that something was found is below, for the same reason. */
    const el = [...document.querySelectorAll(".col .help, .col .hint")]
      .find((e) => !e.closest("details"));
    return el ? getComputedStyle(el).display : "missing";
  };
  const before = await p.evaluate(([f, COUNTER_PROBE_ARG]) => ({
    keyOffered: getComputedStyle(document.getElementById("helpBtn")).display !== "none",
    flag: document.body.getAttribute("data-help"),
    help: (0, eval)("(" + f + ")")(),
    counter: eval(COUNTER_PROBE_ARG),
  }), [pick.toString(), COUNTER_PROBE]);
  const forced = await p.evaluate(([f, COUNTER_PROBE_ARG]) => {
    document.body.setAttribute("data-help", "off");
    return { help: (0, eval)("(" + f + ")")(),
             counter: eval(COUNTER_PROBE_ARG),
             /* WAS `.col .prev-n`, the note under the Today preview, which went
                with that column on 2026-09-09. The sentence itself did not: it
                is the one thing in there that was not a readback -- what the
                site does on its own after closing time -- and it sits under the
                Today buttons now, carrying `.hint`. */
             prevN: getComputedStyle(
               document.querySelector('.col [data-id="prevTodayNote"]')).display };
  }, [pick.toString(), COUNTER_PROBE]);
  await p.done();
  assert.equal(before.keyOffered, false, "the phone is offered a key that does nothing here");
  assert.notEqual(before.help, "missing",
    "no explanatory text outside a fold was found at all — this test was passing on nothing");
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
  /* A BOX THAT SHIPS FILLED, in both columns, so "only its own" has something
     to be true of. The basis boxes are drawn from the board and carry no
     shipped value; the weekday opening time does, in the markup, and is the
     kind of box the marker exists for -- one that would be published over the
     elevator's real hours by the first Save. */
  const box = (s) => `.col[data-elev="${s}"] [name="wk_open"]`;
  await p.fill(box(E.site), "05:15");
  await p.waitForTimeout(80);
  const r = await p.evaluate((pair) => {
    const at = (s) => document.querySelector('.col[data-elev="' + s + '"] [name="wk_open"]');
    return { mine: at(pair[0]).hasAttribute("data-sample"),
             theirs: at(pair[1]).hasAttribute("data-sample") };
  }, [E.site, other.site]);
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
    /* CENTRAL, BECAUSE THE SCREEN IS CENTRAL. todayCentral() fills this hint
       from America/Chicago -- every other time on this page is Central, and an
       office in Wheeler reading a laptop still set to another zone must not be
       told a different day. This test computed the expectation from the
       machine's own clock, so it agreed only while the runner happened to be
       on the same date as Chicago. At 00:05 UTC on 25 August it failed: the
       card correctly said Monday 24 August and the test wanted Tuesday 25.
       A latent flake, not a regression -- and the fix is the test, not the
       screen. */
    const want = new Date().toLocaleDateString("en-US", {
      timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric" });
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
    /* `[name=spread]` is gone with the fallback basis. What this site prices
       its nearest delivery on is the box on that month's row. */
    const near = c.querySelector(".cell.ctl[data-month] input.mbasis");
    return { basis: near ? near.value : null,
             hoursnote: v("hoursnote"), pricenote: v("price_note"),
             wkOpen: v("wk_open"), wkClose: v("wk_close"),
             satClosed: c.querySelector('[name="sat_closed"]').checked,
             banner: c.querySelector('input[name="banner"]:checked').value,
             message: v("message") };
  }, E.site);
  await p.done();
  assert.equal(got.basis, Number(f.pricing.basis).toFixed(2),
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
  /* The nearest delivery's box, which is where a site's cash basis lands now
     that there is a box per month instead of one for the lot. */
  const r = await p.evaluate((m) => {
    const box = (s) => document.querySelector(
      '.col[data-elev="' + s + '"] .cell.ctl[data-month="' + m + '"] input.mbasis').value;
    return { badger: box("badger"), midwest: box("midwest") };
  }, NEAREST);
  await p.done();
  assert.equal(r.badger, Number(SITE_FILES.badger.pricing.basis).toFixed(2));
  assert.equal(r.midwest, Number(SITE_FILES.midwest.pricing.basis).toFixed(2));
  assert.notEqual(r.badger, r.midwest, "both columns hold one elevator's basis");
});

each("a banner live on this elevator's site comes up in its box, and not in the other's",
  async (E) => {
  const other = OTHER(E.site);
  const p = await open({ sites: files({ [E.site]: { hours: { banner: "Harvest starts Monday" } } }) });
  const r = await p.evaluate((pair) => {
    const one = (s) => {
      const c = document.querySelector('.col[data-elev="' + s + '"]');
      /* `preview` was the banner's readback cell, cut on 2026-09-09 with the
         rest of the "on the site" column. What the banner will say is the box's
         own value; the site's rendering of it is the sites' own tests. */
      return { msg: c.querySelector('[name="message"]').value,
               on: c.querySelector('input[name="banner"]:checked').value };
    };
    return { mine: one(pair[0]), theirs: one(pair[1]) };
  }, [E.site, other.site]);
  await p.done();
  assert.deepEqual(r.mine, { msg: "Harvest starts Monday", on: "on" });
  assert.equal(r.theirs.msg, "", "the other elevator picked up this one's banner");
  assert.equal(r.theirs.on, "off");
});

each("it fills an untouched box and NEVER one somebody has typed in", async (E) => {
  /* The safety property that replaced "it never writes into a box". */
  const p = await open({ settle: 0,
    sites: files({ [E.site]: { pricing: { spread: 0.99 }, hours: { weekday: "6:00a to 8:00p" } } }) });
  /* Type before the reads land, so a touched box and an untouched one are
     separated inside a single run. */
  await p.fill(monthBox(E.site, NEAREST), "0.33");
  await p.waitForTimeout(800);
  const after = await p.evaluate(([s, m]) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    return { basis: c.querySelector('.cell.ctl[data-month="' + m + '"] input.mbasis').value,
             wkOpen: c.querySelector('[name="wk_open"]').value };
  }, [E.site, NEAREST]);
  await p.done();
  assert.equal(after.basis, "0.33", "a box somebody typed in was overwritten — never do this");
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
    /* `[name=spread]` went with the fallback basis. What must survive an
       unreadable file is the same thing it always was: no complaint, and the
       shipped value left exactly where it is so the filler outline speaks. */
    const live = c.querySelector(".livecheck");
    const box = c.querySelector(".cell.ctl[data-month] input.mbasis");
    return { complaint: live && !live.hidden ? live.textContent : null,
             basis: box ? box.value : null,
             stillSample: !!c.querySelector("[data-sample]") ||
               !!document.querySelector('.cell.pay[data-elev="' + s + '"][data-sample]') };
  }, E.site);
  assert.equal(r.complaint, null, "it invented a complaint out of a failed read");
  /* AND IT PROPOSES NOTHING. This used to assert the shipped sample was left in
     the box for the filler outline to speak about. The boxes are drawn from the
     board now, and a column whose own pricing.json could not be read leaves the
     months it publishes EMPTY -- which is a better answer than a stale sample
     and has to be checked as one rather than assumed. Empty means "same": leave
     it exactly as the site has it. So a screen that could not read a thing
     still cannot move a price, and the filler marker is still there to outline
     what has not been filled. */
  assert.equal(r.basis, "", "a read that failed left a figure in the box to be saved");
  assert.equal(r.stillSample, true,
    "nothing was read, so the filler marker must still be there to outline it");

  /* AND THE REAL ANSWER IS STRONGER THAN "IT PROPOSES NOTHING": it will not
     file at all. Written expecting a "same" line in the table and measured
     instead -- the sample guard fires first, because nothing on this column
     loaded, and the screen says so in words rather than filing an issue full
     of shipped values. That is the behaviour worth pinning, so it is what is
     pinned. The "same" path has its own test above, on a screen that loaded. */
  const url = await save(p, E.site);
  const why = await refusal(p, E.site);
  await p.done();
  assert.equal(url, null, "a column that could not read its own files filed an issue anyway");
  assert.match(why, /have not loaded into this screen yet/,
    "it refused without saying the refusal was about unloaded settings: " + why);
  assert.match(why, /sample/,
    "the refusal does not tell the office what saving now would publish: " + why);
});

test("a screen that agrees with both sites complains about neither", { skip: NO_BROWSER }, async () => {
  const p = await open();
  const complaints = await p.$$eval(".livecheck:not([hidden]) li", (e) => e.map((x) => x.textContent));
  await p.done();
  assert.deepEqual(complaints, []);
});

/* ---- what customers will see, for the price ----------------------------- */

each("ON THE SITE IS WHAT IS PUBLISHED, and typing in a box does not move it", async (E) => {
  /* Two different claims and only one of them is true of that column. It shows
     what a grower is being handed RIGHT NOW, read from the elevator's own
     bids.json. It is not a preview of a basis somebody is part-way through
     typing -- if it followed the box, the office would watch a price change on
     screen that no customer has been shown, and press Save believing it had
     already happened.

     WAS a sentence under a two-row customer preview inside the top strip: "read
     from what it is publishing", switching to "You have changed a basis ... will
     not move until you save". Sig cut the strip on 2026-09-09. The claim did not
     go with it -- it is now the column's own behaviour, which is a stronger
     place for it than a sentence about itself. */
  const p = await open({ tab: "basis", feed: feedFull() });
  const posted = async (site) => Object.fromEntries(
    Object.entries(await monthRows(p, site)).map(([k, v]) => [k, v.posted]));

  const before = await posted(E.site);
  const theirs = await posted(OTHER(E.site).site);
  assert.ok(Object.values(before).some((v) => /^\$/.test(v)),
    "no published figure was read at all — the fixture is not loading: " +
    JSON.stringify(before));

  await p.fill(monthBox(E.site, MONTHS_ON_BOARD[0]), "-0.01");
  await p.fill(monthBox(E.site, FIRST_NEW_CROP), "0.05");
  await p.waitForTimeout(250);

  assert.deepEqual(await posted(E.site), before,
    "the published figures followed the box — that price has not been published");
  /* And the other column's are untouched, which is the same fault one seat over. */
  assert.deepEqual(await posted(OTHER(E.site).site), theirs,
    "editing one basis changed what the OTHER column says it is publishing");
  await p.done();
});

each("A PUBLISHED PRICE THAT CANNOT BE READ SAYS SO, and is never shown as a dash",
  async (E) => {
  /* THE DISTINCTION THIS EXISTS FOR. "—" in that column means the elevator does
     not post that month: an answer, read out of its own file. A file that could
     not be read is not an answer, and a dash for it would tell the office this
     elevator posts nothing all year when the truth is that this screen could
     not reach the file.

     The old form compared the customer preview against its pristine copy in the
     <template> to prove the builder had left it alone. There is no preview now;
     the column says what went wrong instead, which is better than being left
     alone, and it is what gets checked. */
  const p = await open({ tab: "basis", feed: feedFull(),
    sites: files({ [E.site]: { bids: null } }) });
  await p.waitForTimeout(500);
  const r = await p.evaluate((s) => {
    const cells = [...document.querySelectorAll('.cell.pay[data-elev="' + s + '"]')];
    return { texts: [...new Set(cells.map((c) => c.textContent.trim()))],
             titles: [...new Set(cells.map((c) => c.getAttribute("title") || ""))] };
  }, E.site);
  const other = await p.evaluate((s) => [...new Set(
    [...document.querySelectorAll('.cell.pay[data-elev="' + s + '"]')]
      .map((c) => c.textContent.trim()))], OTHER(E.site).site);
  await p.done();

  assert.deepEqual(r.texts, ["?"],
    "a column whose price file could not be read is showing " +
    JSON.stringify(r.texts) + "; a dash there reads as “posts nothing”");
  for (const t of r.titles)
    assert.match(t, /not a price of theirs/,
      "the cell does not say the figure is missing rather than zero: " + JSON.stringify(t));
  assert.ok(other.some((t) => /^\$/.test(t)),
    "one column's failed read took the other column's published prices with it");
});

/* RESTORED. This helper sits between two tests, and a bulk removal of the
   preview tests on 2026-09-09 cut from one test's opening line to the next
   one's, taking the code in between with it -- six liveness tests then failed
   with "feedState is not defined". Recovered rather than rewritten, so nothing
   about what it asks has quietly changed. */
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
  await p.fill(monthBox(E.site, NEAREST), "0.14");
  const url = await save(p, E.site);
  const why = await refusal(p, E.site);
  await p.done();
  assert.ok(url, "Save opened nothing; the screen said: " + why);

  const body = new URL(url).searchParams.get("body");
  const form = parseForm(body);
  assert.equal(form["Sunday — opens"], "09:00");
  /* THE BASIS, ALL THE WAY THROUGH. It is the field where a mismatch costs
     money: the office types a basis, sees an issue, and the number never
     lands. It travels as a line of the months table now rather than as a
     heading's whole value, and no copy of the heading's wording lives in this
     file -- the table is found by its shape, the same way the heading test
     above finds it. */
  const tbl = Object.values(form).find((v) => typeof v === "string" &&
    new RegExp("^" + NEAREST + "\\s+\\S+\\s+(show|hide)$", "m").test(v));
  assert.ok(tbl, "the issue carries no months table. Headings: " +
    JSON.stringify(Object.keys(form)));
  assert.match(tbl, new RegExp("^" + NEAREST + "\\s+0\\.14\\s", "m"),
    "the basis the office typed is not in the table it travels in:\n" + tbl);

  /* The file the applier is handed is the one this elevator is actually
     publishing — the same file the column filled itself from. Anything the
     office did not touch has to come out the far end unchanged, and "unchanged"
     means unchanged from THAT, not from a line written here. */
  const published = SITE_FILES[E.site].hours;
  const before = { ...published, today_date: null };
  const r = applyUpdate(form, { hours: before, pricing: { basis: -0.75, basisHarvest: 0 },
                                todayISO: "2026-08-20" });
  assert.equal(r.hours.sunday, "9:00a to 1:00p", "Sunday did not survive the trip");
  assert.equal(r.pricing.months[NEAREST].basis, 0.14, "the basis did not survive the trip");
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

each("THE HEADING THE SCREEN WRITES IS THE HEADING THE APPLIER READS", async (E) => {
  /* Three places used to carry the wording of the two basis boxes: the <label>
     the office read, the LABELS table that writes the issue, and the headings
     apply-update.mjs looks for. A rename that reached two of the three was a
     field that silently stopped arriving, which is exactly what happened when
     "Our basis under Big River" was renamed.

     There is one basis field now -- a table of months, written under one
     heading -- and there is no <label> to read it off, because the boxes are
     cells in a row and their names are the month names. So the pair that can
     still drift is the heading the SCREEN writes and the heading the APPLIER
     looks for, and that pair is what this checks.

     NOTHING HERE SPELLS THE WORDING OUT. The heading is found by looking for
     the one whose value is a months table, then handed to the applier. It goes
     on working through the next rename and fails the moment one of the two is
     left behind. */
  const { applyUpdate, parseForm } = await import("../tools/apply-update.mjs");
  const p = await open({ tab: "basis", feed: feedFull() });
  const near = MONTHS_ON_BOARD[0];
  await p.fill(monthBox(E.site, near), "-0.23");
  await p.fill(monthBox(E.site, FIRST_NEW_CROP), "-0.09");
  const url = await save(p, E.site);
  const why = await refusal(p, E.site);
  await p.done();
  assert.ok(url, "Save opened nothing; the screen said: " + why);

  const form = parseForm(new URL(url).searchParams.get("body"));
  const isTable = (v) => typeof v === "string" &&
    new RegExp("^" + near + "\\s+\\S+\\s+(show|hide)$", "m").test(v);
  const heads = Object.keys(form).filter((h) => isTable(form[h]));
  assert.equal(heads.length, 1,
    "the issue carries " + heads.length + " headings holding a months table: " +
    JSON.stringify(Object.keys(form)));
  const HEAD = heads[0];

  const base = () => ({ hours: { ...SITE_FILES[E.site].hours, today_date: null },
                        pricing: { basis: -0.75, basisHarvest: 0 }, todayISO: "2026-09-08" });
  const r = applyUpdate(form, base());
  assert.ok(r.pricing.months, `the applier read the issue and wrote no months table`);
  assert.equal(r.pricing.months[near].basis, -0.23,
    `the applier does not read the heading the screen writes, “${HEAD}”`);
  assert.equal(r.pricing.months[FIRST_NEW_CROP].basis, -0.09);

  /* AND THAT HEADING IS WHY, not something else in the body that happens to
     agree. Take it away and the months must not arrive: without this the test
     passes on an applier that ignores the issue and rebuilds the table itself. */
  const without = { ...form };
  delete without[HEAD];
  const r2 = applyUpdate(without, base());
  assert.ok(!r2.pricing.months || r2.pricing.months[near] === undefined,
    `the months arrived with “${HEAD}” removed from the issue — the applier is not reading it`);
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
    /* THE STAMP IS STRIPPED HERE ON PURPOSE. This used to pass `files()` and
       lean on the default fixture happening to carry no stamp -- so the day
       the fixture gained one (2026-09-09, because the save bar's real width
       turned out to matter for layout) this test started asserting that a
       stamped file shows nothing, which is the opposite of what it means.
       A test about the absence of a field says which field it removed. */
    const bare = files();
    for (const E of ELEVATORS) {
      delete bare[E.site].pricing.updated_at; delete bare[E.site].pricing.updated_by;
      delete bare[E.site].hours.updated_at;   delete bare[E.site].hours.updated_by;
    }
    const p = await open({ sites: bare });
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


/* ══════════════════════════════════════════════════════════════════════════
   A WIDE DESK THAT IS NOT A TALL ONE, WITH THE BOARD AT ITS REAL LENGTH
   ══════════════════════════════════════════════════════════════════════════
   From Jesse Cebulla, 2026-09-08: "When I go to the page to adjust it there is
   only about a centimetre that it is scrolling in ... Could we have less of
   the Big River board and more scrolling space?"

   Measured at 1440x700 with the eleven-row board: the pane he types into was
   18px tall against 344px of content. .strip was flex:0 0 auto, so the board
   took its full height and the editor absorbed the entire shortfall.

   NOTHING IN THE HARNESS COULD SEE IT. Every layout preset was 800px tall or
   more, and every board fixture was six months rather than eleven. Both halves
   are in ./lib/screen.mjs now.
   ══════════════════════════════════════════════════════════════════════════ */

test("A SHORT DESK WITH A FULL BOARD STILL HAS A BASIS BOX YOU CAN TYPE IN",
  { skip: NO_BROWSER }, async () => {
  /* Jesse, 2026-09-08: "there is only about a centimetre that it is scrolling
     in". The pane he typed into was 18px at his own window, because the board
     took its full height above it and the editor absorbed the whole shortfall.
     There is no pane and no board-above-editor any more -- the board IS the
     editor, one row per month -- so the fault cannot recur in that shape. What
     still has to be true is what he was actually asking for, and it is stronger
     than the 200px floor that fixed it: the box is on screen, the Save is on
     screen, and the sheet is the only thing that scrolls. */
  const p = await open({ viewport: LAYOUT.SHORT_DESK, feed: feedFull(), tab: "basis" });
  const m = await p.evaluate(() => {
    /* THE FIRST BASIS BOX ON THE BOARD. `[data-id="off"]` was the single
       fallback basis box, gone since 2026-09-08; there is one per month now
       and the top one is the one a short desk would push off screen first. */
    const box = document.querySelector(".sheet .cell.ctl[data-month] input.mbasis");
    const sheet = document.querySelector(".sheet");
    const r = box.getBoundingClientRect();
    const sv = document.querySelector(".col-save").getBoundingClientRect();
    const sr = sheet.getBoundingClientRect();
    return {
      boxOnScreen: r.top >= 0 && r.bottom <= innerHeight && r.height > 0,
      saveCutOff: Math.max(0, Math.round(sv.bottom - innerHeight)),
      /* The Save bar is sticky at the bottom of the sheet, so it is on screen
         whatever the sheet is scrolled to. */
      saveInSheet: sv.bottom <= sr.bottom + 1,
      hScroll: sheet.scrollWidth > sheet.clientWidth + 1,
      pageScroll: document.documentElement.scrollWidth > innerWidth + 1,
      months: document.querySelectorAll(".sheet .cell.mo[data-month]").length,
      monthsOnScreen: [...document.querySelectorAll(".sheet .cell.mo[data-month]")]
        .filter((c) => { const b = c.getBoundingClientRect();
                         return b.top >= sr.top - 1 && b.bottom <= sr.bottom + 1; }).length,
    };
  });
  await p.done();
  assert.ok(m.boxOnScreen, "the basis box is not on screen at all on a short desk");
  assert.equal(m.saveCutOff, 0,
    `the save bar is ${m.saveCutOff}px below the bottom of the window and is not painted`);
  assert.ok(m.saveInSheet, "the save bar is not inside the sheet it belongs to");
  assert.equal(m.hScroll, false, "the sheet scrolls sideways on a short desk");
  assert.equal(m.pageScroll, false, "the page scrolls sideways on a short desk");
  assert.equal(m.months, 11, "the full board is not on the screen at all");
  /* Eleven months, four static rows and two heading rows do not fit 700px, and
     pretending they do is what produced an 18px editor. They scroll, under a
     heading that stays and above a Save that stays. What must not happen is
     that so few are reachable that the screen is useless. */
  assert.ok(m.monthsOnScreen >= 4,
    `only ${m.monthsOnScreen} of ${m.months} months are on screen at 1440x700`);
});

test("AND THE BOARD KEEPS EVERY ROW, on a desk with room for them",
  { skip: NO_BROWSER }, async () => {
  /* The standing rule is that every month stays visible where there IS room,
     because the board is a line-for-line check against Big River's own page and
     a line you cannot see is not a line you can check. */
  const p = await open({ viewport: LAYOUT.CONSOLE, feed: feedFull(), tab: "basis" });
  const m = await p.evaluate(() => {
    const sheet = document.querySelector(".sheet");
    const c = sheet.getBoundingClientRect();
    const rows = [...document.querySelectorAll(".sheet .cell.mo[data-month]")];
    return { rows: rows.length, scrolls: sheet.scrollHeight > sheet.clientHeight + 1,
             visible: rows.filter((el) => { const r = el.getBoundingClientRect();
               return r.top >= c.top - 1 && r.bottom <= c.bottom + 1; }).length };
  });
  await p.done();
  assert.equal(m.visible, m.rows,
    `${m.visible} of ${m.rows} months on screen at 1600x1000. All of them have to be: ` +
    `the board is the check, and a line you cannot see is not a line you can check.`);
  assert.equal(m.scrolls, false, "the sheet is scrolling on a desk with room for it");
});

each("A PER-MONTH BASIS TYPED ON THE SCREEN IS THE ONE THAT TRAVELS", async (E) => {
  /* THE MUTATION THAT SURVIVED. Dropping the typed value on its way into the
     months table -- writing every month as "same" however the box was filled --
     left the whole suite green. The tick was tested, the field was tested, and
     the number in the box between them was not, which is the number the grower
     is paid on.

     Typed, ticked, saved, and read back out of the real issue body through the
     real parser. Nothing here is asserted about the screen's own state: the
     claim is that what was typed reaches the applier. */
  const p = await open({ tab: "basis", feed: feedFull() });
  const box = `${col(E.site)} .cell.ctl[data-month="October"] input`;
  const tick = `${col(E.site)} .cell.pub[data-month="November"] input`;
  await p.waitForSelector(box);
  await p.fill(box, "-0.93");
  await p.check(tick);
  await p.waitForTimeout(120);
  const url = await save(p, E.site);
  await p.done();
  assert.ok(url, "Save opened nothing");
  /* The real parser and the real applier, imported here rather than at the top
     of the file: this is the only test in it that needs them. */
  const { applyUpdate, parseForm } = await import("../tools/apply-update.mjs");
  const form = parseForm(new URL(url).searchParams.get("body"));
  const table = form["Months — what we publish"];
  assert.ok(table, "the issue carries no months table at all");
  const rows = Object.fromEntries(table.split("\n").map((l) => {
    const m = /^(\S+)\s+(\S+)\s+(show|hide)$/.exec(l.trim());
    return m ? [m[1], { basis: m[2], tick: m[3] }] : ["?", {}];
  }));
  assert.equal(rows.October.basis, "-0.93",
    `October went out as ${JSON.stringify(rows.October)} — the typed basis was dropped`);
  assert.equal(rows.November.tick, "show", "ticking a month did not travel");
  /* A MONTH NOBODY TOUCHED CARRIES WHAT ITS BOX SHOWS, which is what the site
     is pricing that month on today. The boxes open filled on purpose -- the
     office has to be able to see what every month is set at, not guess -- and a
     screen that showed -0.75 and quietly sent "leave it alone" would be lying
     about the one number on it that matters. Sending it back unchanged changes
     nothing at the site; it is the same figure that was already there. */
  const shows = String(SITE_FILES[E.site].pricing.basis);
  assert.equal(rows.September.basis, shows,
    `September went out as ${JSON.stringify(rows.September)}, not the ${shows} its box is showing`);
  /* And the applier really reads it, rather than the shape merely looking right. */
  const out = applyUpdate({ "Months — what we publish": table },
    { hours: {}, pricing: {}, todayISO: "2026-09-08" });
  assert.equal(out.pricing.months.October.basis, -0.93);
  assert.equal(out.pricing.months.November.publish, true);
  assert.equal(out.pricing.months.September.basis, SITE_FILES[E.site].pricing.basis);
});

each("AN EMPTY BASIS BOX MEANS LEAVE IT ALONE, and is the only thing that does", async (E) => {
  /* THE OTHER HALF OF THE RULE ABOVE, and the one with teeth. A site whose
     pricing.json carries no basis at all -- one still on the old spread path --
     opens with empty boxes, and an empty box has always meant "leave it as it
     is" on this screen. If that ever started sending 0, every month on that
     site would silently reprice to the board.

     This is why "same" still exists in the table the screen writes, now that a
     filled box always sends its figure. */
  const p = await open({ tab: "basis", feed: feedFull(),
    sites: files({ [E.site]: { pricing: only({ spread: 0.1 }) } }) });
  const box = `${col(E.site)} .cell.ctl[data-month="October"] input`;
  await p.waitForSelector(box);
  assert.equal(await p.$eval(box, (el) => el.value), "",
    "a site with no basis on file opened with a figure in the box anyway");
  const url = await save(p, E.site);
  await p.done();
  assert.ok(url, "Save opened nothing");
  const { applyUpdate, parseForm } = await import("../tools/apply-update.mjs");
  const table = parseForm(new URL(url).searchParams.get("body"))["Months — what we publish"];
  assert.ok(/^October\s+same\s+/m.test(table),
    "an untouched empty box did not go out as 'same':\n" + table);
  const out = applyUpdate({ "Months — what we publish": table },
    { hours: {}, pricing: {}, todayISO: "2026-09-08" });
  assert.equal(out.pricing.months.October.basis, null,
    "an empty box reached the site as a figure");
});

test("EVERY ROW NAMES THE CONTRACT ITS BASIS IS SET AGAINST, and shows its price",
  { skip: NO_BROWSER }, async () => {
  /* Jesse: "We need it to point at Big River's Futures price instead of their
     Bid." It always did, once a basis was saved; the screen never said so.

     WAS A SENTENCE UNDER A BOX. It named one contract, because there was one
     basis box. There are eleven, and the contract each is set against is a
     column on its own row -- which is the same answer given eleven times
     instead of once, and read across rather than looked up.

     AND THE PRICE IN THAT ROW IS BIG RIVER'S QUOTE, NOT THE CBOT SETTLE. Both
     sites compute from `b.futuresPriceCents` -- update-prices.mjs, board() --
     so a screen printing the settle under a column headed Futures would give a
     person "futures minus basis" arithmetic the site would not honour. The two
     are a quarter cent apart, which is small enough to go unnoticed and large
     enough to matter on a truckload. Checked against the feed's own figure. */
  const p = await open({ viewport: LAYOUT.CONSOLE, feed: feedFull(), tab: "basis" });
  const rows = await p.evaluate(() => {
    const out = {};
    document.querySelectorAll(".sheet .cell.mo[data-month]").forEach((mo) => {
      const m = mo.getAttribute("data-month");
      const at = (sel) => document.querySelector(".sheet " + sel + '[data-month="' + m + '"]');
      const fut = at(".cell.num.set");
      out[m] = { contract: (at(".cell.num.mut") || {}).textContent,
                 futures: fut && fut.firstChild ? fut.firstChild.textContent.trim() : null,
                 lag: fut && fut.querySelector(".lag")
                   ? fut.querySelector(".lag").textContent.trim() : "" };
    });
    return out;
  });
  await p.done();

  assert.equal(Object.keys(rows).length, BOARD_ROWS_FULL.length,
    "the board did not draw every month");
  for (const b of BOARD_ROWS_FULL) {
    const r = rows[b.delivery];
    assert.equal(r.contract, b.futuresMonth,
      `${b.delivery} does not name the contract it is set against`);
    assert.equal(r.futures, "$" + (b.futuresPriceCents / 100).toFixed(2),
      `${b.delivery}'s Futures is not Big River's quote, which is what the site prices from`);
    /* And it says how far that sits from the CBOT settle, which is the fact the
       deleted "Their quote" column carried and the reason it could be deleted. */
    assert.match(r.lag, /^[+-]?\d+\.\d\dc$/,
      `${b.delivery} does not say how far their quote is from the settle: ` +
      JSON.stringify(r.lag));
  }
});
