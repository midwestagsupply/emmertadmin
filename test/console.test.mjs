/* THE LAYOUT, AT THE BOUNDARIES THAT WERE MEASURED.
 *
 * THIS FILE DESCRIBED A SCREEN THAT NO LONGER EXISTS, and it is rewritten here
 * rather than repaired. It asserted three states -- a dark console with two
 * columns above 1440x940, the same console showing ONE elevator when shorter,
 * and a light "roomy" layout one elevator at a time below 1440 -- driven
 * through `.bd`, `#boardStrip`, `#elevSwitch` and `#rareBtn`. None of those
 * elements exist. The redesign Sig asked for on 2026-09-08 ("bring all the
 * bullshit together into a simple linear tabular view") replaced the console,
 * the board strip, the elevator switcher and the fold with one sheet.
 *
 * WHAT IT IS NOW. Two placements of the same markup, from one breakpoint:
 *
 *   width >= 1260   twelve grid columns: the market and Big River on the left,
 *                   then each elevator's own columns. Both elevators, always.
 *   width <  1260   six columns: each month becomes a small block, and each
 *                   elevator gets a line inside it. Both elevators, always.
 *
 * "BOTH ELEVATORS, ALWAYS" IS THE POINT, and it is the claim this file exists
 * to hold. The old layout hid one of them below its floor, which is the thing
 * the redesign was for: two columns whose common board has scrolled off, or
 * whose second column is not on the page, is just two forms crammed together.
 *
 * WHAT IS ASSERTED HERE AND WHAT IS NOT. Behaviour is identical at every size
 * -- it is a stylesheet, not a second implementation -- and behaviour is tested
 * in screen.test.mjs. What is asserted here is that at every size a person
 * actually uses, both elevators are on the page, nothing is clipped with no way
 * to reach it, nothing scrolls sideways, and Save can be pressed.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getChromium, makeFixture, dropFixture, openScreen, press, LAYOUT, col, ELEVATORS,
         feedFull } from "./lib/screen.mjs";

const chromium = await getChromium();
const SKIP = chromium ? false : "playwright is not installed; console tests skipped";

let dir, browser;
before(async () => { if (SKIP) return; dir = makeFixture(); browser = await chromium.launch(); });
after(async () => { if (browser) await browser.close(); dropFixture(dir); });
const open = (viewport, opts = {}) =>
  openScreen(browser, dir, { viewport, feed: feedFull(), ...opts });

/* EVERY SIZE A PERSON ACTUALLY USES, on both screens. The old list stopped at
   the boundaries of states that no longer exist; this one is the boundary that
   does (1260) plus the desks and phones the office has. */
const SIZES = [
  ["a big monitor",            { width: 2560, height: 1440 }],
  ["room to spare",            LAYOUT.CONSOLE],
  ["a desk",                   LAYOUT.CONSOLE_EDGE],
  ["a wide desk, not a tall one", LAYOUT.SHORT_DESK],
  ["a laptop",                 LAYOUT.SHORT],
  ["on the breakpoint",        { width: 1260, height: 900 }],
  ["one pixel under it",       { width: 1259, height: 900 }],
  ["a small laptop",           LAYOUT.ROOMY],
  ["a tablet",                 { width: 820, height: 1180 }],
  ["a phone",                  LAYOUT.PHONE],
  ["a small phone",            { width: 360, height: 780 }],
];

/* One reading of everything a placement can get wrong. Taken from the page
   rather than from the stylesheet: which rules produced it is not the point,
   what the office is looking at is. */
const survey = (p) => p.evaluate(() => {
  const vis = (e) => {
    const s = getComputedStyle(e);
    return s.display !== "none" && s.visibility !== "hidden";
  };
  const cols = [...document.querySelectorAll(".col")];
  const sheet = document.querySelector(".sheet");
  const cells = [...sheet.querySelectorAll(".cell")].filter((c) => c.getClientRects().length);
  const shown = (site) => cells.filter((c) => {
    const col = c.closest(".col");
    return col && col.getAttribute("data-elev") === site;
  }).length;
  return {
    elevators: cols.map((c) => c.getAttribute("data-elev")),
    cellsPerElevator: { badger: shown("badger"), midwest: shown("midwest") },
    months: sheet.querySelectorAll(".cell.mo[data-month]").length,
    saves: [...sheet.querySelectorAll(".col-save .btn-go")].filter(vis).length,
    sheetScrollsSideways: sheet.scrollWidth > sheet.clientWidth + 1,
    pageScrollsSideways: document.documentElement.scrollWidth > innerWidth + 1,
    clippedCells: cells.filter((c) => c.scrollWidth > c.clientWidth + 1 ||
                                      c.scrollHeight > c.clientHeight + 1)
      .map((c) => c.className.slice(0, 28)).slice(0, 4),
  };
});

for (const [what, v] of SIZES)
  test(`BOTH ELEVATORS, THE WHOLE BOARD, AND NOTHING SIDEWAYS — ${what} (${v.width}x${v.height})`,
    { skip: SKIP }, async () => {
    for (const tab of ["basis", "hours"]) {
      const p = await open(v, { tab });
      const r = await survey(p);
      await p.done();
      const at = `${tab} at ${v.width}x${v.height}`;
      assert.deepEqual(r.elevators, ELEVATORS.map((e) => e.site),
        `both elevators must be on the page — ${at}`);
      for (const E of ELEVATORS)
        assert.ok(r.cellsPerElevator[E.site] > 3,
          `${E.name} has ${r.cellsPerElevator[E.site]} cells on screen — ${at}`);
      assert.equal(r.saves, 2, `${r.saves} Save buttons on screen — ${at}`);
      if (tab === "basis")
        assert.equal(r.months, 11, `${r.months} of 11 months drawn — ${at}`);
      assert.equal(r.sheetScrollsSideways, false, `the sheet scrolls sideways — ${at}`);
      assert.equal(r.pageScrollsSideways, false, `the page scrolls sideways — ${at}`);
      assert.deepEqual(r.clippedCells, [],
        `cells clip their own content with no way to reach it — ${at}`);
    }
  });

test("THE WHOLE BOARD IS ON A DESK WITHOUT SCROLLING", { skip: SKIP }, async () => {
  /* The reason to put both elevators on one screen is a shared board, and a
     board you have to scroll to is not shared -- you cannot compare a column
     with a row you cannot see. Asserted at the smallest desk in the list, so it
     holds everywhere above it. */
  const p = await open(LAYOUT.SHORT_DESK, { tab: "basis" });
  const r = await p.evaluate(() => {
    const rows = [...document.querySelectorAll(".sheet .cell.mo[data-month]")];
    const on = rows.filter((e) => {
      const b = e.getBoundingClientRect();
      return b.top >= 0 && b.bottom <= innerHeight && b.height > 0;
    });
    return { rows: rows.length, on: on.length,
             missing: rows.filter((e) => !on.includes(e)).map((e) => e.textContent.trim()) };
  });
  await p.done();
  assert.equal(r.on, r.rows,
    `${r.on} of ${r.rows} months on screen at 1440x700; off the bottom: ` +
    JSON.stringify(r.missing));
});

test("the address only says which elevator opens focused; it no longer chooses one",
  { skip: SKIP }, async () => {
  /* ?site= used to pick which of the two forms was rendered. Both are always
     rendered now, so the only thing left for it to do is say which one the
     screen opens looking at -- and it must never take the other one away. */
  for (const site of ["badger", "midwest"]) {
    const p = await open(LAYOUT.CONSOLE, { query: `?site=${site}` });
    const r = await survey(p);
    await p.done();
    assert.deepEqual(r.elevators, ELEVATORS.map((e) => e.site),
      `?site=${site} removed the other elevator from the page`);
    for (const E of ELEVATORS)
      assert.ok(r.cellsPerElevator[E.site] > 3,
        `?site=${site} left ${E.name} with ${r.cellsPerElevator[E.site]} cells on screen`);
  }
});

test("THE CHOSEN ANSWER IS READABLE ON ITS OWN CHIP, in BOTH columns", { skip: SKIP }, async () => {
  /* A chip carrying a solid accent takes ink for every scrap of text in it.
     White on the Midwest green measured 3.04:1 once and a test caught it, not
     my eye.

     MEASURED ON THE PAINTED ELEMENT, which is the <span> inside the label. This
     read the <label> itself, which has no background of its own -- so it was
     comparing dark ink against a transparent box and reporting 1.16:1 on a chip
     that is actually white on #12161a. A contrast test that measures the wrong
     box is worse than none: it cries wolf until somebody deletes it.
     Anything not rendered is skipped rather than measured -- the sub-labels
     inside these chips are display:none in this layout, and a colour nobody can
     see is not a contrast failure. */
  const lum = (c) => {
    const [r, g, b] = c.match(/\d+/g).slice(0, 3).map((n) => {
      const v = n / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const p = await open(LAYOUT.CONSOLE, { tab: "hours" });
  const got = await p.evaluate(() => {
    const out = {};
    document.querySelectorAll(".col").forEach((c) => {
      const chip = c.querySelector(".choice:has(input:checked) > span");
      if (!chip || !chip.getClientRects().length) return;
      const s = getComputedStyle(chip);
      const parts = [["its text", s.color]];
      chip.querySelectorAll("small").forEach((sm) => {
        if (sm.getClientRects().length) parts.push(["its small print", getComputedStyle(sm).color]);
      });
      out[c.getAttribute("data-elev")] = { bg: s.backgroundColor, parts };
    });
    return out;
  });
  await p.done();
  for (const E of ELEVATORS) {
    const r = got[E.site];
    assert.ok(r, `${E.name}: no chip is selected, or none is on screen`);
    assert.notEqual(r.bg, "rgba(0, 0, 0, 0)",
      `${E.name}: the chip measured has no background of its own — this is measuring the wrong box`);
    for (const [what, ink] of r.parts) {
      const [a, b] = [lum(r.bg), lum(ink)].sort((x, y) => y - x);
      const ratio = (a + 0.05) / (b + 0.05);
      assert.ok(ratio >= 4.5,
        `${E.name}: ${what} is ${ratio.toFixed(2)}:1 on the chosen chip, under the 4.5 floor`);
    }
  }
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

test("NOTHING ENDS UP PERMANENTLY BEHIND THE STICKY SAVE BAR", { skip: SKIP }, async () => {
  /* The save bar is `position: sticky; bottom: 0`, so on a phone content passes
     UNDER it as you scroll -- which is what a bar under the thumb is supposed
     to do, and is not a fault. What would be a fault is a row that is behind it
     at every scroll position there is, because then a tick or a basis box
     exists on the page and cannot be reached.

     Measured while checking a phone render that looked as though the bar was
     sitting on the banner controls: up to 46px of live cells sit behind it
     mid-scroll on a 390px phone, and none of them at the bottom of the page.
     So the claim is scrolled to the end and asked there. It is a different
     claim from "the bar does not cover the field you are IN", which is WCAG
     2.4.11 and has its own test above; this one is about the rows you have not
     reached yet. */
  for (const v of [LAYOUT.PHONE, { width: 360, height: 780 }, { width: 1259, height: 900 }]) {
    for (const tab of ["basis", "hours"]) {
      const p = await open(v, { tab });
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await p.waitForTimeout(200);
      const hidden = await p.evaluate(() => {
        const bars = [...document.querySelectorAll(".sheet .cell.col-save")]
          .map((b) => b.getBoundingClientRect()).filter((b) => b.height > 0);
        const out = [];
        for (const c of document.querySelectorAll(".sheet .cell:not(.col-save)")) {
          const q = c.getBoundingClientRect();
          if (!q.height || !/\S/.test(c.textContent) &&
              !c.querySelector("input,textarea,select,button")) continue;
          for (const b of bars) {
            const ov = Math.min(b.bottom, q.bottom) - Math.max(b.top, q.top);
            const ox = Math.min(b.right, q.right) - Math.max(b.left, q.left);
            if (ov > 2 && ox > 2 && ov >= q.height - 2) out.push(c.className.slice(0, 24));
          }
        }
        return [...new Set(out)];
      });
      await p.done();
      assert.deepEqual(hidden, [],
        `cells are wholly behind the save bar at the bottom of the page — ` +
        `${tab} at ${v.width}x${v.height}`);
    }
  }
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
  for (const v of [LAYOUT.CONSOLE_EDGE, LAYOUT.SHORT_DESK, LAYOUT.SHORT,
                   { width: 1259, height: 900 }, LAYOUT.ROOMY, LAYOUT.PHONE]) {
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
    if (v.width < 1260) await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
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
