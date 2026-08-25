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
async function refusalOf(p, site, ms = 3000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const r = await p.$eval("#" + site + "-checkNote",
      (e) => e.hidden ? null : e.textContent).catch(() => null);
    if (r) return r;
    await p.waitForTimeout(100);
  }
  return "";
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
   5. THE PHONE PINS THE ELEVATOR BEING EDITED
   ══════════════════════════════════════════════════════════════════════════ */
test("editing Badger on a phone pins Badger's posts, not Midwest's", { skip: NB }, async () => {
  const p = await open({ viewport: LAYOUT.PHONE, query: "?site=badger" });
  const r = await p.evaluate(() => {
    const cell = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const cs = getComputedStyle(e);
      return { pos: cs.position, display: cs.display };
    };
    return {
      badger: cell('.bd td.pay[data-elev="badger"]'),
      midwest: cell('.bd td.pay[data-elev="midwest"]'),
      only: document.body.getAttribute("data-only"),
    };
  });
  await p.done();
  assert.equal(r.only, "badger");
  assert.equal(r.badger.pos, "sticky", "Badger's own posts slide away under the pin");
  assert.equal(r.midwest.display, "none",
    "the other elevator's posts column crowds a 390px screen it was not asked onto");
});
