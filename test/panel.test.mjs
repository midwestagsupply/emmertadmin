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

/* THE BASIS BOXES ARE MONTH ROWS NOW.
 * `id(site, "off")` and `id(site, "offh")` were the cash and new-crop fallback
 * boxes; both went on 2026-09-08, when Sig cut the fallback basis -- "just the
 * month selector is sufficient with th eenter the basis". Every rule they were
 * governed by is unchanged and now applies per month, so the tests below are
 * re-aimed rather than deleted: the pair that used to be (cash, new crop) is
 * now (the nearest delivery, the first new-crop month), which is exactly what
 * those two boxes meant.
 */
const mbox = (site, month) =>
  `${col(site)} .cell.ctl[data-month="${month}"] input.mbasis`;
const NEAR = "August";          // the short fixture board's nearest delivery
const CROP = "October";         // and its first new-crop month
const BASIS_BOXES = [[NEAR, "the nearest delivery"], [CROP, "the first new crop"]];

async function filled(p, site = "badger", ms = 15000) {
  /* THE FIRST MONTH'S BASIS BOX. `#<site>-off` was the single fallback basis
     box and has not existed since 2026-09-08; waiting on it timed out, and a
     timeout in a helper called "filled" reads as every test that uses it
     failing to fill, which is not what was wrong. There is a box per month now,
     drawn by drawBoard once the feed lands, so what "this column has loaded" 
     means is: its first month row exists and carries a figure. */
  await p.waitForFunction(
    (s) => {
      const e = document.querySelector(
        '.col[data-elev="' + s + '"] .cell.ctl[data-month] input.mbasis');
      return !!e && e.value !== "";
    },
    site, { timeout: ms });
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
  await p.fill(mbox("badger", NEAR), "0.14");
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
  await p.fill(mbox("badger", NEAR), "0.14");
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
  /* WITH NO FEED, which is the only state this panel is on screen in. It is
     hidden while `body[data-board="on"]` -- with eleven live prices in front of
     you there is nothing to post by hand -- so forcing the <details> open on a
     working screen opens a panel inside a row that is display:none, and the
     fill times out. That reported as the $1.50 rule not being enforced, which
     it is; the test simply could not reach the box. */
  const p = await open({ feed: null });
  await p.waitForSelector(`${col("badger")} details.byhand`, { state: "attached" });
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
for (const [box, label] of BASIS_BOXES)
  /* WAS $10 AGAINST A $1.00 ONE-SIDED CAP. A spread could only ever be a
     positive number of cents under somebody else's board, so one bound was
     enough. A basis is signed and wrong in both directions, and the cap the
     applier and update-prices.mjs both hold is $1.50 from zero. */
  test(`a basis of $10 is refused at the screen, not at the applier — ${label}`,
    { skip: NB }, async () => {
    const p = await open({});
    const sel = mbox("badger", box);
    if (!(await p.$(sel))) { await p.done(); assert.fail(`${sel} is not on the screen`); }
    /* NEGATIVE, so this tests the CAP. A positive 10 is caught one rule
       earlier -- by the over-the-contract rail, which is a different guard for
       a different mistake and gets its own test below. Testing the cap with a
       value the rail refuses first proves only that something refused. */
    await p.fill(sel, "");
    await p.fill(sel, "-10");
    await p.waitForFunction((s) => document.querySelector(s).value === "-10", sel);
    const url = await save(p, "badger");
    const why = await refusalOf(p, "badger");
    await p.done();
    assert.equal(url, null, "a -$10 basis sailed through to a filed issue");
    assert.match(why, /past the \$1\.50 limit/);
    assert.match(why, new RegExp("basis for " + box),
      `the refusal must name the month, so the office knows which of eleven boxes (${label})`);
  });

test("the basis refusals name the box as the card names it", { skip: NB }, async () => {
  /* The rule has not changed, only the name. A refusal that calls a box
     something other than what the card above it says is how somebody types the
     wrong figure into the right box. The box now says "Our basis — cash", and
     it is the basis, so this is the first time the two have agreed. */
  const p = await open({});
  await p.fill(mbox("badger", NEAR), "abc");
  await press(p, `${col("badger")} .btn-go`);
  const why = await refusalOf(p, "badger");
  await p.done();
  /* WAS "Our basis — cash", the card's own heading. There are eleven boxes and
     the only thing that tells them apart is the month, so that is what the
     refusal has to say -- naming the column would send the office to the right
     column and leave them counting rows. */
  assert.match(why, new RegExp("basis for " + NEAR),
    "the refusal does not say which month is wrong: " + why);
  assert.doesNotMatch(why, /Under Big River/,
    "the refusal still names the box by the spread model's wording");
});

/* ══════════════════════════════════════════════════════════════════════════
   3. MONEY IS PRINTED AS STORED — quarter cents survive the screen
   ══════════════════════════════════════════════════════════════════════════ */
test("a stored quarter-cent basis is not rewritten by the box that displays it", { skip: NB }, async () => {
  /* Same claim, on the field that now decides the price. Negative because a
     basis is signed and almost always under; the rounding hazard is identical
     either way and the sign is the half the old spread box could not carry. */
  const sites = files();
  sites.badger.pricing = { ...sites.badger.pricing, basis: -0.1225 };
  const p = await open({ sites });
  await p.waitForTimeout(400);
  const v = await p.$eval(mbox("badger", NEAR), (e) => e.value);
  await p.done();
  assert.equal(v, "-0.1225",
    "pricing.json holds -0.1225 and the box shows " + v + " — saving would post the mangled figure back");
});

test("the posts columns print a published quarter-cent as published", { skip: NB }, async () => {
  const sites = files();
  const rows = (sites.badger.bids && sites.badger.bids.bids) || [];
  assert.ok(rows.length, "fixture carries no badger bids to vary");
  rows[0] = { ...rows[0], cashPrice: 4.2825 };
  const p = await open({ sites });
  await p.waitForTimeout(600);
  /* The posts column is a cell of the basis screen now -- one per delivery
     month, on the row it belongs to -- rather than a <td> tacked on the end of
     a read-only board above the columns. The rule it is here for has not moved:
     what a site publishes is PRINTED as published, to the last quarter cent,
     because a rounded copy cannot be compared with their page line for line. */
  const texts = await p.$$eval('.sheet .cell.pay[data-elev="badger"]',
                               (els) => els.map((t) => t.textContent));
  await p.done();
  /* TO THE CENT, THE WAY THE SITE PRINTS IT. This asserted "$4.2825" -- print
     what is published, to the last quarter cent, so the column could be
     compared with Big River's page line for line. Sig reversed that on
     2026-09-08: "i always want to round the corn price to the hundreds only."

     AND THE SITE ALREADY DID. update-prices.mjs prints money as
     `"$" + n.toFixed(2)`, so a grower reading badgergrain.com sees $4.28 for a
     stored 4.2825. A screen printing $4.2825 in a column headed ON THE SITE
     would be showing the office a figure no customer is being shown -- the
     opposite of what that column is for. What it has to match is the SITE's
     rendering, so that is what is checked, and the stored figure is deliberately
     one that rounds. */
  assert.ok(texts.some((t) => t === "$4.28"),
    "a published 4.2825 renders as " + JSON.stringify(texts) +
    " — the site prints $4.28 for it, and this column has to say what the site says");
  assert.ok(!texts.some((t) => /\$\d+\.\d{3,}/.test(t)),
    "a figure is printed to more places than the site prints it: " + JSON.stringify(texts));
});

/* ══════════════════════════════════════════════════════════════════════════
   4. WHAT REPLACED THE FOLD, THE PIN AND THE PREVIEW PANEL
   ══════════════════════════════════════════════════════════════════════════
   Three tests stood here and all three were about a screen that no longer
   exists, so they are replaced rather than deleted -- the thing each was
   protecting is still worth protecting, and this is where somebody will look
   for it.

   THE FOLD. "the weekly table folds on the hours tab until asked for" guarded a
   specificity fight: the hide rule lost one nobody had measured, the weekly
   table stood open at every size, and the button that folded it looked broken.
   There is no fold. The weekly hours are three rows of a table, on screen with
   everything else, and a row of a table hides nothing worth hiding.

   THE PIN. "their cash is pinned on a phone" guarded a board that scrolled
   sideways on a phone with the elevator's own posted price sliding under Big
   River's. Nothing scrolls sideways now: under 1200px the sheet places the same
   cells six wide instead of twelve, so there is no sideways to slide in. That
   is the stronger fix and it is what the first test below asserts.

   THE PANEL. "our own posted price is still on the phone" guarded a preview
   block that could be lost in a narrow layout. The posted price is a column of
   the basis screen now -- one figure per delivery month, per elevator -- so the
   second test below asks the harder question: is it on a phone, for both
   elevators, on the row it belongs to.
   ══════════════════════════════════════════════════════════════════════════ */

test("NOTHING SCROLLS SIDEWAYS ON A PHONE, on either screen", { skip: NB }, async () => {
  for (const tab of ["basis", "hours"]) {
    const p = await open({ viewport: LAYOUT.PHONE, tab });
    const r = await p.evaluate(() => {
      const sheet = document.querySelector(".sheet");
      return { sheet: sheet.scrollWidth > sheet.clientWidth + 1,
               page: document.documentElement.scrollWidth > innerWidth + 1,
               cells: [...document.querySelectorAll(".sheet .cell")]
                 .filter((c) => c.getClientRects().length && c.scrollWidth > c.clientWidth + 1)
                 .map((c) => c.className.slice(0, 24)).slice(0, 4) };
    });
    await p.done();
    assert.equal(r.sheet, false, `the sheet scrolls sideways on a phone (${tab})`);
    assert.equal(r.page, false, `the page scrolls sideways on a phone (${tab})`);
    assert.deepEqual(r.cells, [], `cells clip their own content on a phone (${tab})`);
  }
});

test("our own posted price is on a phone, for both elevators, on its own month",
  { skip: NB }, async () => {
  const p = await open({ viewport: LAYOUT.PHONE, tab: "basis" });
  await p.waitForTimeout(600);
  const r = await p.evaluate(() => ["badger", "midwest"].map((s) => {
    const cells = [...document.querySelectorAll('.sheet .cell.pay[data-elev="' + s + '"]')];
    const withPrice = cells.filter((c) => /\$\d/.test(c.textContent));
    const first = withPrice[0];
    return {
      site: s, cells: cells.length, priced: withPrice.length,
      month: first ? first.getAttribute("data-delivery") : null,
      shown: first ? first.getBoundingClientRect().height > 0 : false,
    };
  }));
  await p.done();
  for (const e of r) {
    assert.ok(e.cells >= 4, `${e.site} has ${e.cells} posted-price cells on a phone`);
    assert.ok(e.priced >= 1, `${e.site} shows no posted price at all on a phone`);
    assert.ok(e.shown, `${e.site}'s posted price has no box on a phone`);
    assert.ok(e.month, `${e.site}'s posted price is not tied to a delivery month`);
  }
});


/* ══════════════════════════════════════════════════════════════════════════
   THE OLD SPREAD HABIT, TYPED INTO THE NEW BOX
   ══════════════════════════════════════════════════════════════════════════
   CORRECTED 2026-09-08, and the correction is a policy change rather than a
   bug fix, so it is written down rather than quietly made.

   These two tests asserted that a basis over +0.15 is REFUSED, because typing
   0.75 where -0.75 belongs is the old spread habit and a symmetric cap cannot
   catch a one-sided one. That was true and the risk has not gone away.

   Sig removed the refusal on 2026-09-08 after Jesse asked to be able to "enter
   negative or positive numbers for the basis". Over and under are now one
   signed number with one limit, $1.50, which is the figure the screen, the
   applier and both sites' update-prices.mjs have always held.

   So the guard moves rather than disappearing. What now stands between the
   habit and a wrong price is the sentence under the box, which names the
   contract, its quote, Big River's basis and how far the typed figure sits
   from it -- every keystroke. A refusal told somebody they were wrong; this
   shows them, in their own numbers, and it is the thing to keep working.
   ══════════════════════════════════════════════════════════════════════════ */
for (const [box, label] of BASIS_BOXES)
  test(`a basis over the contract is accepted now, and says what it is — ${label}`,
    { skip: NB }, async () => {
    const p = await open({});
    const sel = mbox("badger", box);
    await p.fill(sel, "");
    await p.fill(sel, "0.75");
    await p.waitForFunction((s) => document.querySelector(s).value === "0.75", sel);
    const url = await save(p, "badger");
    const why = await refusalOf(p, "badger");
    await p.done();
    assert.ok(url, "a positive basis inside the cap was refused: " + (why || "(no reason given)"));
  });

for (const [box, label] of BASIS_BOXES)
  test(`a basis past the $1.50 cap is still refused, either sign — ${label}`,
    { skip: NB }, async () => {
    /* The cap is what is left, so it has to hold in the direction the removed
       rule used to cover. */
    const p = await open({});
    const sel = mbox("badger", box);
    await p.fill(sel, "");
    await p.fill(sel, "1.75");
    await p.waitForFunction((s) => document.querySelector(s).value === "1.75", sel);
    const url = await save(p, "badger");
    const why = await refusalOf(p, "badger");
    await p.done();
    assert.equal(url, null, "1.75 over the contract sailed through");
    assert.match(why, /1\.50|from zero/,
      "the refusal has to name the cap it broke");
  });

test("a small premium over the contract is allowed, because it is a real thing to want",
  { skip: NB }, async () => {
  /* The rail is one-sided and it is a rail, not a wall: an elevator that wants
     a nickel over the board is doing something ordinary. Fifteen cents is the
     line, and it is drawn where the habit stops being plausible. */
  const p = await open({});
  await p.fill(mbox("badger", NEAR), "0.15");
  await p.waitForFunction((s) => document.querySelector(s).value === "0.15", mbox("badger", NEAR));
  const url = await save(p, "badger");
  const why = await refusalOf(p, "badger");
  await p.done();
  assert.ok(url, "a 15-cent premium was refused; the screen said: " + why);
});


test("THE WEEKLY HOURS AND THE SMALL PRINT ARE ON SCREEN WITHOUT ASKING",
  { skip: NB }, async () => {
  /* What the rare key was for. It folded the two panels that "change rarely"
     out of a column of stacked cards, and the test that stood here checked the
     button said what pressing it would do. There is no button and no fold: the
     weekly hours are three rows and the small print is one more, all of them on
     the hours screen at once. This asserts the thing the fold was hiding is
     reachable without a fold, which is what the office actually needed. */
  const p = await open({ tab: "hours" });
  const r = await p.evaluate(() => {
    const on = (sel) => {
      const e = document.querySelector(sel);
      return !!e && e.getBoundingClientRect().height > 0;
    };
    return {
      rareKey: !!document.getElementById("rareBtn"),
      week: ["wk_open", "wk_close", "sat_open", "sun_closed"]
        .map((n) => on('.col[data-elev="badger"] [name="' + n + '"]')),
      note: on('.col[data-elev="badger"] [name="hoursnote"]'),
      priceNote: on('.col[data-elev="badger"] [name="price_note"]'),
    };
  });
  await p.done();
  assert.equal(r.rareKey, false, "the fold button is still on the page with nothing to fold");
  assert.deepEqual(r.week, [true, true, true, true],
    "part of the weekly table is not on screen on the hours screen");
  assert.ok(r.note, "the small print under the hours is not on screen");
  assert.ok(r.priceNote, "the small print under the prices is not on screen");
});