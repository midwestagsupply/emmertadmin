/* WHAT FIVE PEOPLE FOUND IN ONE AFTERNOON.
 *
 * On 2026-08-25 a five-person panel — the office manager, the grain desk, the
 * scale house on a phone, the owner, and a first-day hire told to figure it
 * out — drove this screen through their real jobs. Every finding below was
 * MEASURED by at least one of them before it was believed, and every fix got
 * the test that would have caught it. The one they all found independently is
 * first: a Save that opened the correct GitHub page and simultaneously
 * announced, in red, "Nothing was saved."
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getChromium, makeFixture, dropFixture, openScreen, press, save,
         files, feedNow, col, id, named, LAYOUT, ELEVATORS } from "./lib/screen.mjs";

const chromium = await getChromium();
const NB = chromium ? false : "playwright is not installed";
let browser, dir;
before(async () => {
  if (NB) return;
  dir = makeFixture();
  browser = await chromium.launch();
});
after(async () => {
  if (browser) await browser.close();
  dropFixture(dir);
});
const open = (opts) => openScreen(browser, dir, opts);
/* The refusal note appears after press() lands; under a fully parallel suite
   the fixed 900ms inside save() is occasionally not enough on a loaded
   machine, so the note is POLLED, not assumed. */
/* WAIT ON THE CONDITION, NOT ON A STOPWATCH.
   This was a hand-rolled poll with a 3-second budget, and it was the only
   flaky thing in the suite: the $1.50 guard failed roughly one run in five,
   always with an empty note, and passed 4/4 every time it was run on its own.
   That is contention, not a defect in the screen — a dozen browser contexts
   competing for one box, and a note that appears in under 600ms unloaded
   occasionally not making a fixed 3s window.

   The budget is not simply bigger; the WAIT is different. waitForFunction
   returns the moment the note is actually shown, so a healthy run is no slower
   than before, and a run where the note genuinely never comes still fails —
   with the timeout named, instead of an empty string that reads like the
   screen said nothing. Every caller asserts on the text, so nothing depended
   on the old "" return. */
/* WAIT UNTIL THE COLUMN HAS FINISHED FILLING ITSELF FROM THE SITE.
   This is the actual cause of the only flake in the suite, and it took three
   goes to find because the first two symptoms both pointed elsewhere.

   The column loads, then a second pass writes the site's own values into the
   boxes. A test that types before that pass lands has its value overwritten,
   and then Save sees a VALID form: no refusal, an issue opens, and — because
   save() only waits 900ms for the popup — the url comes back null anyway. So
   the test read "no issue opened, no note", which looks exactly like the
   screen silently doing nothing, and is really the screen doing the right
   thing with a value the test no longer had in the box.

   The existing guard checked the typed value at ONE INSTANT, which proves it
   arrived and not that it stayed. This waits for the fill to have HAPPENED —
   the spread box carrying the fixture's own 0.10 — before anything is typed.
   Deterministic, and no slower on a healthy run. */
async function filled(p, site = "badger", ms = 15000) {
  await p.waitForFunction(
    (id) => { const e = document.getElementById(id); return !!e && e.value === "0.10"; },
    site + "-off", { timeout: ms });
}

async function refusalOf(p, site, ms = 15000) {
  const sel = "#" + site + "-checkNote";
  try {
    await p.waitForFunction(
      (s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.textContent.trim(); },
      sel, { timeout: ms });
  } catch {
    return "";     /* genuinely never shown — the caller's assert says so */
  }
  return p.$eval(sel, (e) => e.textContent);
}

/* ══════════════════════════════════════════════════════════════════════════
   1. THE SAVE BUTTON TELLS THE TRUTH IN BOTH DIRECTIONS
   ══════════════════════════════════════════════════════════════════════════
   window.open(url, "_blank", "noopener") returns null BY SPECIFICATION even
   when the tab opens — the exact trap the Big River opener's comment already
   documented — so the blocked-popup branch ran on every successful save:
   red "Nothing was saved", no "Not finished yet" guidance, and the
   unsaved-changes guard left armed after work that was one green button from
   done. All five panellists hit it. */
test("A SAVE THAT OPENED ITS TAB DOES NOT SAY NOTHING WAS SAVED", { skip: NB }, async () => {
  const p = await open({});
  await p.fill(id("badger", "off"), "0.14");
  const url = await save(p, "badger");
  const r = await p.evaluate(() => {
    const note = document.getElementById("badger-checkNote");
    const how = document.querySelector('.col[data-elev="badger"] [data-id="saveHow"]');
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return {
      noteHidden: !note || note.hidden,
      noteText: note ? note.textContent : "",
      howNow: how ? how.classList.contains("is-now") : false,
      howText: how ? how.textContent : "",
      stillDirty: e.defaultPrevented,
    };
  });
  await p.done();
  assert.ok(url, "the save opened no tab at all");
  assert.match(url, /github\.com\/midwestagsupply\/badgergrain\/issues\/new/);
  assert.equal(r.noteHidden, true,
    "the tab opened AND the screen says: " + r.noteText);
  assert.equal(r.howNow, true, "the 'Not finished yet' guidance never appeared");
  assert.match(r.howText, /green|Submit new issue/i,
    "the guidance does not point at the green button");
  assert.equal(r.stillDirty, false,
    "the unsaved-changes guard is still armed after a save that opened its tab");
});

test("a save whose window really was blocked still says so", { skip: NB }, async () => {
  const p = await open({});
  await p.evaluate(() => { window.open = () => null; });
  await p.fill(id("badger", "off"), "0.14");
  await press(p, `${col("badger")} .btn-go`);
  const text = await refusalOf(p, "badger");
  await p.done();
  assert.ok(text, "a genuinely blocked popup went unreported");
  assert.match(text, /Nothing was saved/,
    "the blocked case lost its plain-words message");
});

/* ══════════════════════════════════════════════════════════════════════════
   2. GUARDS THE SCREEN PROMISED, OR OBVIOUSLY NEEDED, AND DID NOT HAVE
   ══════════════════════════════════════════════════════════════════════════ */
test("a day that ends before it starts is refused", { skip: NB }, async () => {
  const p = await open({});
  await p.evaluate(() => {
    const c = document.querySelector('.col[data-elev="badger"]');
    c.querySelector('input[name="today"][value="custom"]').click();
  });
  await p.fill(named("badger", "open"), "17:00");
  await p.fill(named("badger", "close"), "08:00");
  const url = await save(p, "badger");
  const why = await refusalOf(p, "badger");
  await p.done();
  assert.equal(url, null, "a backwards day was filed without a word");
  assert.match(why, /end before they start/);
});

test("a banner set to show with nothing written in it is refused", { skip: NB }, async () => {
  const p = await open({});
  await p.evaluate(() => {
    const c = document.querySelector('.col[data-elev="badger"]');
    c.querySelector('input[name="banner"][value="on"]').click();
    const m = c.querySelector('[name="message"]');
    m.value = "";
    m.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const url = await save(p, "badger");
  const why = await refusalOf(p, "badger");
  await p.done();
  assert.equal(url, null, "an empty shown banner was filed");
  assert.match(why, /nothing written in it/);
});

test("a message pasted past the limit is refused, not quietly filed", { skip: NB }, async () => {
  /* maxlength stops the keyboard but not a paste through script. The panel
     put 500 characters into the 160-character bar and the issue carried all
     of them; the counter went red and nothing else happened. */
  const p = await open({});
  await p.evaluate(() => {
    const c = document.querySelector('.col[data-elev="badger"]');
    c.querySelector('input[name="banner"][value="on"]').click();
    const m = c.querySelector('[name="message"]');
    m.value = "x".repeat(500);
    m.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const url = await save(p, "badger");
  const why = await refusalOf(p, "badger");
  await p.done();
  assert.equal(url, null, "500 characters went into a 160-character bar");
  assert.match(why, /340 characters over the 160/);
});

test("THE $1.50 THE SANITY BOX PROMISES IS ENFORCED, not just described", { skip: NB }, async () => {
  /* "This screen refuses a basis further than $1.50 from zero" stood on the
     screen with no code behind it. The 1.50 is the applier's own limit,
     mirrored — not a number invented here. */
  const p = await open({});
  await filled(p);
  await p.evaluate(() => {
    document.querySelector('.col[data-elev="badger"] details.byhand').open = true;
  });
  await p.fill(named("badger", "manual_cash"), "4.05");
  await p.fill(named("badger", "manual_basis"), "2.00");
  /* The fill is VERIFIED before Save is pressed: under a fully parallel
     suite this test once raced the column's own fill-from-site pass, and a
     guard that sometimes tests an empty box is not a guard. */
  await p.waitForFunction(
    (sel) => document.querySelector(sel) && document.querySelector(sel).value === "2.00",
    '.col[data-elev="badger"] [name="manual_basis"]');
  const url = await save(p, "badger");
  const why = await refusalOf(p, "badger");
  await p.done();
  assert.equal(url, null, "a 2.00 basis sailed through a screen that promises to refuse past 1.50");
  assert.match(why, /further than \$1\.50/);
});

/* THE ONE MISTAKE ON THIS FORM THAT COSTS MONEY, refused before it is filed.
   tools/apply-update.mjs caps both spread boxes at SPREAD_MAX = 1.00 and says
   why: "10 typed instead of 0.10 pays ten dollars under the board." Measured
   2026-08-31: the screen did not mirror that cap. Typing 10 and pressing Save
   opened the GitHub issue with no complaint, and the refusal arrived later as
   a comment from a workflow run -- one save too late, which is the same defect
   the $1.50 test above was written for, on a box that matters more.

   Asserted through SAVE rather than through the check function, because "the
   validator returns a string" and "the office cannot file this" are different
   claims and only the second one is the guard. */
for (const [box, label] of [["off", "Under Big River — cash"],
                            ["offh", "Under Big River — new crop"]])
  test(`a spread of $10 is refused at the screen, not at the applier — ${label}`,
    { skip: NB }, async () => {
    const p = await open({});
    const sel = id("badger", box);
    if (!(await p.$(sel))) { await p.done(); assert.fail(`${sel} is not on the screen`); }
    await p.fill(sel, "");
    await p.fill(sel, "10");
    await p.waitForFunction((s) => document.querySelector(s).value === "10", sel);
    const url = await save(p, "badger");
    const why = await refusalOf(p, "badger");
    await p.done();
    assert.equal(url, null, "a $10 spread sailed through to a filed issue");
    assert.match(why, /past the \$1\.00 limit/);
    assert.match(why, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "the refusal must name the box as the card names it");
  });

test("the spread refusals name the box as the card names it", { skip: NB }, async () => {
  /* The card was renamed from "our basis" to "Under Big River" because the
     box holds the SPREAD — and the refusals kept saying "the cash basis",
     coaching the exact substitution the rename exists to prevent. */
  const p = await open({});
  await p.fill(id("badger", "off"), "abc");
  await press(p, `${col("badger")} .btn-go`);
  const why = await refusalOf(p, "badger");
  await p.done();
  assert.match(why, /Under Big River — cash/);
  assert.doesNotMatch(why, /The cash basis[,:]/,
    "the refusal still calls the spread box 'the cash basis'");
});

/* ══════════════════════════════════════════════════════════════════════════
   3. MONEY IS PRINTED AS STORED — quarter cents survive the screen
   ══════════════════════════════════════════════════════════════════════════ */
test("a stored quarter-cent spread is not rewritten by the box that displays it", { skip: NB }, async () => {
  const sites = files();
  sites.badger.pricing = { ...sites.badger.pricing, spread: 0.1225 };
  const p = await open({ sites });
  await p.waitForTimeout(400);
  const v = await p.$eval(id("badger", "off"), (e) => e.value);
  await p.done();
  assert.equal(v, "0.1225",
    "pricing.json holds 0.1225 and the box shows " + v + " — saving would post the mangled figure back");
});

test("the posts columns print a published quarter-cent as published", { skip: NB }, async () => {
  const sites = files();
  const rows = (sites.badger.bids && sites.badger.bids.bids) || [];
  assert.ok(rows.length, "fixture carries no badger bids to vary");
  rows[0] = { ...rows[0], cashPrice: 4.2825 };
  const p = await open({ sites });
  await p.waitForTimeout(600);
  const texts = await p.$$eval('.bd td.pay[data-elev="badger"]', (tds) => tds.map((t) => t.textContent));
  await p.done();
  assert.ok(texts.some((t) => t === "$4.2825"),
    "a published 4.2825 renders as " + JSON.stringify(texts) + " — rounded on its way to the screen");
});

/* ══════════════════════════════════════════════════════════════════════════
   4. THE HOURS TAB FOLD, AND THE BUTTON THAT FOLDS IT
   ══════════════════════════════════════════════════════════════════════════
   The hide rule lost a specificity fight nobody had measured, so the weekly
   table stood open on the hours tab at every size, pushed the previews below
   a 1440x940 fold, and made the "Weekly hours & small print" button look
   broken — pressing it changed nothing you could see. */
test("the weekly table folds on the hours tab until asked for", { skip: NB }, async () => {
  const p = await open({ tab: "hours", viewport: LAYOUT.CONSOLE_EDGE });
  const before = await p.evaluate(() => {
    const w = document.querySelector('.col[data-elev="badger"] [data-id="c-weekly"]');
    const pane = document.querySelector('.col[data-elev="badger"] .col-panes');
    return { shown: getComputedStyle(w).display !== "none",
             over: pane.scrollHeight - pane.clientHeight };
  });
  await press(p, "#rareBtn");
  await p.waitForTimeout(120);
  const after = await p.evaluate(() => {
    const w = document.querySelector('.col[data-elev="badger"] [data-id="c-weekly"]');
    return getComputedStyle(w).display !== "none";
  });
  await p.done();
  assert.equal(before.shown, false, "the weekly table is up before anyone asked");
  assert.equal(before.over, 0,
    `the daily tab scrolls by ${before.over}px on the 1440x940 monitor`);
  assert.equal(after, true, "and the button that promises it does not deliver it");
});

/* ══════════════════════════════════════════════════════════════════════════
   5. ON THEIR BOARD, THEIR CASH IS THE FIGURE THAT NEVER LEAVES THE PHONE
   ══════════════════════════════════════════════════════════════════════════
   This test used to assert the opposite -- that the phone pinned the EDITED
   ELEVATOR'S posts column -- and it passed while the screen was wrong.

   Measured 2026-08-31 at 390px: the table is 628px in a 390px box, "Their
   cash" begins at x=361, and the pinned posts column covered everything from
   x=240. So a table headed "Their posted board" showed, without scrolling:
   Month, Contract, and OUR price. Their cash and their basis -- the two
   columns the note beneath calls "the check" -- were both hidden, one of them
   underneath ours.

   Sig, in his own words: "their posted board should always show their posted
   cash price not what badger posts or midwest posts."

   So the assertion is inverted and made about POSITION ON SCREEN rather than
   about a CSS keyword, because "position: sticky" is what the stylesheet says
   and "is the number in the box" is what the office sees. Our own price is not
   lost: it is checked by test 6 below, in the panel where it is larger. */
test("their cash is pinned on a phone; our posts is not on top of it", { skip: NB }, async () => {
  const p = await open({ viewport: LAYOUT.PHONE, query: "?site=badger" });
  const r = await p.evaluate(() => {
    const box = document.querySelector(".board").getBoundingClientRect();
    const read = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const cs = getComputedStyle(e), b = e.getBoundingClientRect();
      /* How much of this cell is actually inside the box, with the box left
         un-scrolled -- which is the state the reader arrives in. */
      const onScreen = Math.max(0, Math.min(b.right, box.right) - Math.max(b.left, box.left));
      return { pos: cs.position, display: cs.display, onScreen: Math.round(onScreen),
               width: Math.round(b.width) };
    };
    return {
      only: document.body.getAttribute("data-only"),
      cash: read(".bd td.cash-cell"),
      badger: read('.bd td.pay[data-elev="badger"]'),
      midwest: read('.bd td.pay[data-elev="midwest"]'),
      scrolls: document.querySelector(".board").scrollWidth >
               document.querySelector(".board").clientWidth,
    };
  });
  await p.done();
  assert.equal(r.only, "badger");
  assert.ok(r.scrolls, "if the board no longer scrolls sideways this test proves nothing");
  assert.equal(r.cash.pos, "sticky", "their cash must be the pinned column on their own board");
  assert.equal(r.cash.onScreen, r.cash.width,
    `their cash is ${r.cash.width - r.cash.onScreen}px short of fully on screen unscrolled`);
  assert.equal(r.badger.pos, "static",
    "our posts must not be pinned as well -- two cells at right:0 means one covers the other");
  assert.equal(r.badger.onScreen, 0,
    "our posts should be off to the right, reachable by dragging, not sitting over theirs");
  assert.equal(r.midwest.display, "none",
    "the other elevator's posts column crowds a 390px screen it was not asked onto");
});

/* ══════════════════════════════════════════════════════════════════════════
   THE RARE KEY SAYS WHAT IT DOES, AND SHOWS YOU WHAT IT DID
   ══════════════════════════════════════════════════════════════════════════
   Sig, 2026-08-31: "wtf is the weekly hours button in the top right, i clicked
   it and it changes colors, wow."

   He was right, and the button was working. It reveals two panels — the weekly
   hours and the small print — and both of them sit low in a column that
   scrolls on its own, so from where he was standing the only observable effect
   of pressing it was the button inverting. A control whose entire feedback is
   its own colour is a control that has not told you anything.

   Three assertions, because the fix is three things: the label carries a VERB
   and the verb changes; the caret turns; and the panel that was opened is
   brought into view. */
test("the rare key names the action, and the name changes when it is pressed",
  { skip: NB }, async () => {
  const p = await open(LAYOUT.CONSOLE, { tab: "hours" });
  const read = () => p.evaluate(() => {
    const b = document.getElementById("rareBtn");
    const card = document.querySelector('.col:not([hidden]) [data-id="c-weekly"]');
    const pane = card && card.closest(".col-panes");
    return { label: b.textContent.replace(/\s+/g, " ").trim(),
             expanded: b.getAttribute("aria-expanded"),
             caretTurn: getComputedStyle(document.querySelector(".rare-caret"), "::before").transform,
             cardShown: card ? getComputedStyle(card).display !== "none" : null,
             /* IS IT ACTUALLY IN THE VISIBLE PART OF THE PANE — not "how many
                pixels down", which was the first version of this and is a
                magic number that means different things at different window
                heights. 215px down a 700px pane is on screen; 215px down a
                200px pane is not. Ask the question that matters. */
             inSight: (() => {
               if (!card || !pane) return null;
               const c = card.getBoundingClientRect(), q = pane.getBoundingClientRect();
               return c.top >= q.top - 1 && c.top < q.bottom;
             })() };
  });
  const before = await read();
  await press(p, "#rareBtn");
  await p.waitForTimeout(500);
  const after = await read();
  await p.done();

  assert.match(before.label, /^Show /, `the key reads "${before.label}" before it is pressed`);
  assert.equal(before.expanded, "false");
  assert.match(after.label, /^Hide /, `the key still reads "${after.label}" after it is pressed`);
  assert.equal(after.expanded, "true");
  assert.equal(after.cardShown, true, "the weekly panel did not open");
  assert.notEqual(after.caretTurn, before.caretTurn, "the caret does not turn");
  assert.equal(after.inSight, true,
    "the panel it opened is not in the visible part of its own scrolling pane — " +
    "opened, and out of sight, which is the complaint");
});

/* The half of the old decision that still has to hold: taking our price off
   the pin is only acceptable because it is somewhere better. */
test("our own posted price is still on the phone, in our own panel", { skip: NB }, async () => {
  const p = await open({ viewport: LAYOUT.PHONE, query: "?site=badger" });
  const r = await p.evaluate(() => {
    const prev = document.querySelector('.col[data-elev="badger"] [data-id="prevBid"]');
    if (!prev) return { found: false };
    const cs = getComputedStyle(prev);
    const head = prev.querySelector(".pb-h");
    return { found: true, shown: cs.display !== "none" && prev.getBoundingClientRect().height > 0,
             text: (head ? head.textContent : "").trim() };
  });
  await p.done();
  assert.ok(r.found, "the panel that carries our own posted price is gone");
  assert.ok(r.shown, "our own posted price is not visible on a phone, so the pin should not have moved");
  assert.match(r.text, /\$\d/, `our own posted price reads "${r.text}"`);
});
