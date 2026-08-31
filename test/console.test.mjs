/* THE THREE LAYOUT STATES, AT THE BOUNDARIES THAT WERE MEASURED.
 *
 * The screen has three, and the reason there are three rather than two is a
 * measurement rather than a taste. Driving the real page and focusing every one
 * of its controls in turn:
 *
 *   height >= 915   the whole Big River board is on screen
 *   height <  915   the board runs off the bottom, at EVERY width from 1440 to
 *                   2560 — a height problem, not a width one, and no amount of
 *                   narrowing helps
 *
 * The shared board is the entire reason to put both elevators on one screen:
 * two columns whose common reference has scrolled off the top is just two forms
 * crammed together. So the floor is a height as well as a width, set at 940 to
 * leave headroom for a longer board than the five rows Big River posts today.
 *
 *   width >= 1440 AND height >= 940   two columns, whole board on screen
 *   width >= 1440, shorter            same dark console, ONE elevator, tabs
 *   width <  1440                     roomy light layout, one at a time
 *
 * WHAT THIS FILE IS FOR, AND WHAT IT IS NOT. Behaviour is identical in all
 * three — it is a stylesheet, not a second implementation — and behaviour is
 * tested in screen.test.mjs. What is asserted here is that each state is really
 * the state it claims to be, ON ITS OWN EDGE. A boundary checked only in its
 * comfortable middle is not checked: 1280x700 used to be in the list below and
 * failed by 494px, which was this file being wrong about where the floor was.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getChromium, makeFixture, dropFixture, openScreen, press, LAYOUT, col, ELEVATORS }
  from "./lib/screen.mjs";

const chromium = await getChromium();
const SKIP = chromium ? false : "playwright is not installed; console tests skipped";

let dir, browser;
before(async () => { if (SKIP) return; dir = makeFixture(); browser = await chromium.launch(); });
after(async () => { if (browser) await browser.close(); dropFixture(dir); });
const open = (viewport, opts = {}) => openScreen(browser, dir, { viewport, ...opts });

/* One reading of everything the three states differ in. Taken from the page
   rather than from the stylesheet: which rules produced it is not the point,
   what the office is looking at is. */
const survey = (p) => p.evaluate(() => {
  const vis = (e) => getComputedStyle(e).display !== "none";
  const cols = [...document.querySelectorAll(".col")];
  const shown = cols.filter(vis);
  const board = document.querySelector(".bd").getBoundingClientRect();
  const strip = document.getElementById("boardStrip").getBoundingClientRect();
  return {
    columnsShown: shown.map((c) => c.getAttribute("data-elev")),
    columnsHidden: cols.filter((c) => !vis(c)).map((c) => c.getAttribute("data-elev")),
    switcher: vis(document.getElementById("elevSwitch")),
    rareKey: vis(document.getElementById("rareBtn")),
    ink: getComputedStyle(document.body).backgroundColor,
    boardOnScreen: board.top >= 0 && board.bottom <= innerHeight && board.height > 0,
    boardAboveColumns: strip.bottom <= (shown[0] ? shown[0].getBoundingClientRect().top + 1 : 0),
    /* The console pins the page to the window and gives each column its own
       scrolling pane; the roomy layout lets the document scroll instead. */
    pageScrolls: getComputedStyle(document.documentElement).overflow !== "hidden",
    /* WHERE THE SAVE BAR SITS, AND WHY IT IS NO LONGER ALWAYS THE FLOOR.
       Until 2026-08-31 the pane was flex:1 1 auto, so it swallowed every
       spare pixel and the bar was pinned to the bottom of the window at every
       size. That is what left the Hours tab 358px of empty white above its own
       bar, and Settings 493px. The pane now takes only what it needs.

       So the invariant is no longer "always zero". It is: the bar is FULLY ON
       SCREEN, and it is on the floor exactly when the pane has more work than
       window. Both facts are collected here and asserted together. */
    bars: [...document.querySelectorAll(".col")].filter(vis).map((c) => {
      const bar = c.querySelector(".col-save").getBoundingClientRect();
      const pane = c.querySelector(".col-panes");
      return { fromFloor: Math.round(innerHeight - bar.bottom),
               onScreen: bar.top >= 0 && bar.bottom <= innerHeight + 1,
               paneOverflows: pane.scrollHeight > pane.clientHeight + 1 };
    }),
    sidewaysScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
});

/* Every save bar must be reachable, and it is on the floor exactly when its
   pane has more to show than the window can hold. A bar off the bottom is the
   serious one: the console pins the page (html{overflow:hidden}), so there is
   no scrolling to it. That is the failure the first attempt at tightening the
   short tabs produced, and this is what caught it. */
function assertBars(bars, expected, where) {
  assert.equal(bars.length, expected, `${where}: ${bars.length} save bars, expected ${expected}`);
  bars.forEach((b, i) => {
    assert.ok(b.onScreen, `${where}: save bar ${i} is off the screen (${b.fromFloor}px from the floor)`);
    if (b.paneOverflows)
      assert.equal(b.fromFloor, 0,
        `${where}: save bar ${i} is ${b.fromFloor}px off the floor while its pane is still scrolling`);
  });
}

/* ---- state one: two columns -------------------------------------------- */

for (const [what, v] of [["on its own floor", LAYOUT.CONSOLE_EDGE], ["with room to spare", LAYOUT.CONSOLE],
                         ["on a big monitor", { width: 2560, height: 1440 }]])
  test(`TWO COLUMNS AND THE WHOLE BOARD — ${what} (${v.width}x${v.height})`, { skip: SKIP }, async () => {
    const p = await open(v);
    const r = await survey(p);
    await p.done();
    assert.deepEqual(r.columnsShown, ELEVATORS.map((e) => e.site), "both elevators must be on screen");
    assert.deepEqual(r.columnsHidden, []);
    assert.equal(r.switcher, false, "there is nothing left to switch between");
    assert.equal(r.boardOnScreen, true,
      "the shared board is the whole reason both columns are here and it is off the screen");
    assert.equal(r.boardAboveColumns, true, "the board must sit above both columns, read once");
    assert.equal(r.pageScrolls, false, "the console pins the page to the window");
    assertBars(r.bars, 2, `${what} (${v.width}x${v.height})`);
    assert.equal(r.sidewaysScroll, false);
  });

/* ---- state two: a short desk ------------------------------------------- */

for (const [what, v] of [["one pixel under the floor", LAYOUT.SHORT_EDGE],
                         ["a laptop", LAYOUT.SHORT]])
  test(`A SHORT DESK KEEPS THE CONSOLE AND THE BOARD, and shows ONE elevator — ${what} (${v.width}x${v.height})`,
    { skip: SKIP }, async () => {
    /* The state that exists because of the measurement. It is still a desk:
       dark, dense, board on screen, weekly panel folded away. What it gives up
       is the second column, and it gets tabs in exchange. */
    const p = await open(v, { query: "?site=badger" });
    const r = await survey(p);
    const dark = await open(LAYOUT.CONSOLE);
    const consoleInk = (await survey(dark)).ink;
    await dark.done();
    await p.done();
    assert.deepEqual(r.columnsShown, ["badger"], "a short desk shows one elevator at a time");
    assert.deepEqual(r.columnsHidden, ["midwest"]);
    assert.equal(r.switcher, true, "with nothing to switch with, the second elevator is unreachable");
    assert.equal(r.rareKey, true, "it is still the console: the rare panels still fold");
    assert.equal(r.ink, consoleInk, "a short desk is a desk — it must not fall back to the light layout");
    assert.equal(r.boardOnScreen, true, "the board is kept; that is the point of the state");
    assert.equal(r.pageScrolls, false);
    assertBars(r.bars, 1, `${what} (${v.width}x${v.height})`);
  });

/* ══════════════════════════════════════════════════════════════════════════
   A SHORT TAB DOES NOT LEAVE HALF THE COLUMN EMPTY
   ══════════════════════════════════════════════════════════════════════════
   Measured 2026-08-31 at 1440x940, before: the Hours tab ended 358px above its
   own save bar and Settings ended 493px above it -- half the column, white,
   on the tab with the least in it. Not padding: Settings' whole card is 202px
   of which 188px is heading and body. The pane was taking every remaining
   pixel because it was flex:1 1 auto.

   The two tabs that overflow are checked the other way in the tests above, and
   they still put the bar on the floor. This one is about the two that do not.
   Guarded as a MEASURED GAP rather than as a CSS keyword -- rule 32. */
for (const tab of ["hours", "settings"])
  test(`the ${tab} tab does not end in a field of white — the bar comes up to meet it`,
    { skip: SKIP }, async () => {
    const p = await open(LAYOUT.CONSOLE, { tab });
    const r = await p.evaluate(() => [...document.querySelectorAll(".col")]
      .filter((c) => getComputedStyle(c).display !== "none")
      .map((c) => {
        const cards = [...c.querySelectorAll(".card")]
          .filter((x) => getComputedStyle(x).display !== "none");
        const last = cards[cards.length - 1];
        const bar = c.querySelector(".col-save");
        return { elev: c.getAttribute("data-elev"), cards: cards.length,
                 gap: Math.round(bar.getBoundingClientRect().top - last.getBoundingClientRect().bottom) };
      }));
    await p.done();
    for (const c of r) {
      assert.ok(c.cards > 0, `${c.elev} shows no cards on the ${tab} tab`);
      assert.ok(c.gap >= 0 && c.gap <= 40,
        `${c.elev}'s ${tab} tab leaves ${c.gap}px between its last card and its save bar`);
    }
  });

/* ---- state three: the roomy light layout ------------------------------- */

for (const [what, v] of [["one pixel under the console", LAYOUT.ROOMY_EDGE],
                         ["a small laptop", LAYOUT.ROOMY], ["a phone", LAYOUT.PHONE]])
  test(`UNDER 1440 IT IS THE ROOMY LIGHT LAYOUT, one elevator at a time — ${what} (${v.width}x${v.height})`,
    { skip: SKIP }, async () => {
    const p = await open(v, { query: "?site=badger" });
    const r = await survey(p);
    const dark = await open(LAYOUT.CONSOLE);
    const consoleInk = (await survey(dark)).ink;
    await dark.done();
    await p.done();
    assert.deepEqual(r.columnsShown, ["badger"]);
    assert.deepEqual(r.columnsHidden, ["midwest"]);
    assert.equal(r.switcher, true);
    assert.equal(r.rareKey, false,
      "the panels do not fold here, so the key that folds them must not be offered");
    assert.notEqual(r.ink, consoleInk, "this layer is deliberately the opposite of the console");
    assert.equal(r.pageScrolls, true, "the document scrolls here; the panes do not");
    assert.equal(r.sidewaysScroll, false, "the page must never scroll sideways");
  });

test("the address only says which elevator opens focused; it no longer chooses one",
  { skip: SKIP }, async () => {
  /* ?site= used to pick the elevator and an unknown value was a warning. Both
     are on the page now, so there is nothing left for it to get wrong — an
     unknown or absent value simply opens on Badger. The case of the KEY was
     the old bug: ?SITE=midwest came back undefined and fell through. */
  for (const [q, want] of [["?site=midwest", "midwest"], ["?SITE=MIDWEST", "midwest"],
                           ["?site=BADGER", "badger"], ["?site=bogus", "badger"], ["", "badger"]]) {
    const p = await open(LAYOUT.SHORT, { query: q });
    const shown = await p.$eval(".floor", (e) => e.getAttribute("data-only"));
    const hidden = await p.$eval(col(want === "badger" ? "midwest" : "badger"),
      (e) => getComputedStyle(e).display);
    await p.done();
    assert.equal(shown, want, `"${q}" opened on the wrong elevator`);
    assert.equal(hidden, "none");
  }
});

test("both lockups are in the header, because both elevators are on the page",
  { skip: SKIP }, async () => {
  /* This used to assert the opposite — one mark, one colour — from when the
     screen showed one elevator chosen by the address. A header naming one
     elevator over a page carrying two is the same mistake wearing the other
     hat. */
  const p = await open(LAYOUT.CONSOLE);
  const r = await p.evaluate(() => [...document.querySelectorAll(".marks .logo")]
    .filter((e) => e.offsetParent).map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  await p.done();
  assert.equal(r.length, 2, "the header shows " + r.length + " lockups over a page with two elevators");
  for (const E of ELEVATORS)
    assert.ok(r.some((t) => t.includes(E.name)), `${E.name} is not named in the header`);
});

test("the chosen answer is readable on its own chip, in BOTH columns", { skip: SKIP }, async () => {
  /* A chip carrying a solid accent takes ink for every scrap of text in it,
     including the small print, which inherits a grey that vanishes on gold.
     White on the Midwest green measured 3.04:1 and a test caught it, not my
     eye. Both columns, because the two accents are different colours. */
  const lum = (c) => {
    const [r, g, b] = c.match(/\d+/g).slice(0, 3).map((n) => {
      const v = n / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const p = await open(LAYOUT.CONSOLE);
  const got = await p.evaluate(() => {
    const out = {};
    document.querySelectorAll(".col").forEach((c) => {
      const chip = c.querySelector(".choice:has(input:checked)");
      if (!chip) return;
      const s = getComputedStyle(chip);
      const small = chip.querySelector("small") || chip;
      out[c.getAttribute("data-elev")] =
        { bg: s.backgroundColor, ink: s.color, smallInk: getComputedStyle(small).color };
    });
    return out;
  });
  await p.done();
  for (const E of ELEVATORS) {
    const r = got[E.site];
    assert.ok(r, `${E.name}: no chip is selected`);
    for (const [what, ink] of [["its text", r.ink], ["its small print", r.smallInk]]) {
      const [a, b] = [lum(r.bg), lum(ink)].sort((x, y) => y - x);
      const ratio = (a + 0.05) / (b + 0.05);
      assert.ok(ratio >= 4.5,
        `${E.name}: ${what} is ${ratio.toFixed(2)}:1 on the chosen chip, under the 4.5 floor`);
    }
  }
});

test("NOTHING IS CLIPPED WITH NO WAY TO REACH IT, in any state", { skip: SKIP }, async () => {
  /* Older than this layout and it stands: `overflow:hidden` on the shell made
     the page report itself as fitting while amputating the bottom of the bid
     card. What does not fit gets a pane to move in. */
  for (const v of [LAYOUT.CONSOLE_EDGE, LAYOUT.CONSOLE, LAYOUT.SHORT_EDGE, LAYOUT.SHORT,
                   LAYOUT.ROOMY_EDGE, LAYOUT.ROOMY, LAYOUT.PHONE]) {
    const p = await open(v, { query: "?site=badger" });
    const r = await p.evaluate(() => {
      const out = [];
      document.querySelectorAll(".col").forEach((c) => {
        if (getComputedStyle(c).display === "none") return;
        const pane = c.querySelector(".col-panes");
        const over = pane.scrollHeight - pane.clientHeight;
        pane.scrollTop = pane.scrollHeight;
        out.push({ elev: c.getAttribute("data-elev"), over, moved: pane.scrollTop > 0,
                   docOver: document.documentElement.scrollHeight - document.documentElement.clientHeight,
                   docScrolls: getComputedStyle(document.documentElement).overflow !== "hidden" });
      });
      return out;
    });
    await p.done();
    for (const c of r)
      assert.ok(c.over === 0 || c.moved || c.docScrolls,
        `${c.elev} is clipped by ${c.over}px with nothing to scroll at ${v.width}x${v.height}`);
  }
});

test("the phone can reach every Closed box and the We pay columns", { skip: SKIP }, async () => {
  /* Measured at 390px before the fix: the weekly table rendered 590px wide
     inside a 354px card with overflow:hidden, so all three Closed boxes sat off
     the right edge with no scrollbar and nothing to pan — the single thing an
     office is most likely to do from a phone could not be done at all. And the
     We pay column, the one figure the elevator actually pays, was clipped 40px
     outside a container whose overflow was hidden. */
  const p = await open(LAYOUT.PHONE, { query: "?site=badger" });
  for (const n of ["wk_closed", "sat_closed", "sun_closed"]) {
    const fits = await p.$eval(`${col("badger")} [name=${n}]`, (e) => {
      const b = e.getBoundingClientRect();
      return b.left >= 0 && b.right <= document.documentElement.clientWidth && b.width > 0;
    });
    assert.ok(fits, `${n} is off the screen at 390px`);
  }
  assert.equal(await p.$eval(".board", (e) => getComputedStyle(e).overflowX), "auto");
  assert.ok(await p.$eval(".board", (e) => e.scrollWidth <= e.clientWidth
    || ((e.scrollLeft = e.scrollWidth), e.scrollLeft > 0)), "the board does not really scroll");
  await p.done();
});

test("the sticky save bar does not sit on top of the field you are in", { skip: SKIP }, async () => {
  /* Measured at 390px: the focused hours-note box was 96px tall and 96px of it
     was behind the bar. WCAG 2.2 SC 2.4.11. */
  const p = await open(LAYOUT.PHONE, { query: "?site=badger" });
  await p.focus("#badger-hn");
  await p.waitForTimeout(250);
  const covered = await p.evaluate(() => {
    const a = document.getElementById("badger-hn").getBoundingClientRect();
    const s = document.querySelector('.col[data-elev="badger"] .save').getBoundingClientRect();
    return Math.max(0, Math.min(a.bottom, s.bottom) - Math.max(a.top, s.top));
  });
  await p.done();
  assert.equal(Math.round(covered), 0);
});

test("a closed row does not grey out the box that reopens it", { skip: SKIP }, async () => {
  /* .is-off and tr.is-off td both matched, so cells rendered at .5 x .55 = .275
     — 1.87:1 against white, on the row whose only enabled control is the way
     back. Checked in both columns: the rule is written once and applies twice. */
  const p = await open(LAYOUT.CONSOLE, { rare: true });
  for (const E of ELEVATORS) {
    await p.check(`${col(E.site)} [name=sun_closed]`);
    const o = await p.$eval(`${col(E.site)} [name=sun_closed]`, (e) => {
      let n = e, acc = 1;
      while (n && n !== document.body) { acc *= parseFloat(getComputedStyle(n).opacity); n = n.parentElement; }
      return acc;
    });
    assert.ok(o > 0.99, `${E.name}: the Closed control is at ${o} opacity`);
  }
  await p.done();
});

test("SAVE CAN BE PRESSED IN EVERY STATE, by mouse and by keyboard", { skip: SKIP }, async () => {
  /* The command bar is positioned three different ways across the three states
     — static on the console, sticky to the thumb below it — and in the console
     states the page is pinned to the window by a guard that answers every
     scroll by putting the document back. Measured while writing this suite: a
     press preceded by a scroll-into-view loses its click entirely in the
     short-desk state, because the button moves between mousedown and mouseup.
     A person's click does not scroll first and is unaffected, and this asserts
     that — the button is where it appears to be, a press there lands, and Enter
     on it lands too. */
  for (const v of [LAYOUT.CONSOLE_EDGE, LAYOUT.SHORT_EDGE, LAYOUT.SHORT,
                   LAYOUT.ROOMY, LAYOUT.PHONE]) {
    const p = await openScreen(browser, dir, { viewport: v, query: "?site=badger" });
    await p.evaluate(() => {
      window.__sub = 0;
      window.open = () => null;
      document.querySelector('.col[data-elev="badger"] form')
        .addEventListener("submit", () => { window.__sub++; }, true);
    });
    /* Below the console the form is several screens long and the bar follows
       the thumb, so the button has to be brought into view the way a person
       scrolls to it. */
    if (v.width < 1440) await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(120);
    await press(p, `${col("badger")} .btn-go`);
    const byMouse = await p.evaluate(() => window.__sub);
    await p.focus(`${col("badger")} .btn-go`);
    await p.keyboard.press("Enter");
    await p.waitForTimeout(150);
    const total = await p.evaluate(() => window.__sub);
    await p.done();
    assert.equal(byMouse, 1, `pressing Save did nothing at ${v.width}x${v.height}`);
    assert.equal(total, 2, `Enter on Save did nothing at ${v.width}x${v.height}`);
  }
});
