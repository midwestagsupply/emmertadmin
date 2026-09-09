#!/usr/bin/env python3
"""Jesse's three problems with the basis screen, 2026-09-08.

    python3 build/patch_basis.py <pristine-root> <work-root>

From Jesse Cebulla, Staff Accountant, this morning:

  "One of the issues I am having is adjusting the basis. When I go to the page
   to adjust it there is only about a centimetre that it is scrolling in ...
   Could we have less of the Big River board and more scrolling space?"

  "We need it to point at Big River's Futures price instead of their Bid. We
   also need the basis to not be automatically a negative number. Right now the
   Basis that Jerry wants is -.65. That is +.10 over Big River, but I can't
   make that happen."

MEASURED, at 1440x700 with the real eleven-row board injected:

    main            flex column, ~576px to give
      .strip        413px   flex:0 0 auto   <- the board. Cannot shrink.
      .wrap          38px   the tab strip
      .floor        125px   flex:1 1 auto   <- everything he types into
        .col-hd      35px
        .col-panes   18px   <- content 344px. "about a centimetre."
        .col-save    89px

The board is `flex:0 0 auto`, so it takes its full height and the editor
absorbs the entire shortfall. At 1600x700 it is the same 18px; at 1440x940 the
pane gets 227px and the screen is fine, which is why this was never seen on a
big monitor and why Jesse saw it "expand enough to see it" once, on a day the
board was shorter.

Every edit goes through sub(), which asserts its anchor matches exactly once.
"""
import sys, pathlib

pristine, work = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])

def sub(text, old, new, label):
    n = text.count(old)
    assert n == 1, f"{label}: anchor matched {n} times, expected 1"
    return text.replace(old, new)

css = (pristine / "admin.css").read_text(encoding="utf-8")

# ── 1. (removed) ───────────────────────────────────────────────────────────
#
# THIS WAS `.strip{flex:0 1 auto; min-height:0}`, letting the board's strip
# shrink so the editor below it could have room. It worked, and it was wrong,
# and the mutation run is what said so: reverting it made all three new tests
# pass, which is the signal that the edit was not carrying its weight.
#
# Measured with it in place: the strip shrank to 210px while the board inside
# it stayed at its 280px ceiling, so the board painted 75px past the bottom of
# its own strip and over the elevator tabs. A shrinkable strip and a capped
# board were two fixes for one problem, fighting.
#
# The ceiling below is enough on its own: it bounds the board, the strip sizes
# to the board, and the editor gets what is left, which is now plenty. Fewer
# moving parts, and nothing paints outside its box.

# ── 2. and when it does shrink, the rows scroll rather than being clipped ──
css = sub(css,
'''  .board{margin-top:16px;border:2px solid var(--ink);border-radius:var(--radius);
         overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch}''',
'''  .board{margin-top:16px;border:2px solid var(--ink);border-radius:var(--radius);
         /* overflow-y WAS hidden, which is fine while the board always gets
            its full height and is a silent truncation the moment it does not.
            `auto` keeps every row reachable instead of cutting the last ones
            off with nothing to say so. It shows a scrollbar only when the
            window has left the board no choice. */
         overflow-x:auto;overflow-y:auto;-webkit-overflow-scrolling:touch}''',
"board scrolls rather than clips")

# ── 3. the editor has a floor it cannot be pushed below ────────────────────
css = sub(css,
'''  .col-panes{
    /* 0 1 auto, not 1 1 auto -- see the note on .col above. It still SHRINKS
       and still scrolls when the tab is taller than the window; it just no
       longer GROWS to fill a window the tab does not need. */
    flex:0 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain;''',
'''  .col-panes{
    /* 0 1 auto, not 1 1 auto -- see the note on .col above. It still SHRINKS
       and still scrolls when the tab is taller than the window; it just no
       longer GROWS to fill a window the tab does not need. */
    /* AND IT HAS A FLOOR, 2026-09-08. `min-height:0` let it shrink to nothing,
       and with an unshrinkable board above it that is exactly what happened:
       18px. 200px is measured, not chosen -- the cash basis row is 66px and
       the pair of rows with their readouts is 196px, so 200 is the smallest
       height at which both boxes and both readouts are on screen at once. */
    flex:0 1 auto; min-height:200px; overflow-y:auto; overscroll-behavior:contain;''',
"the pane has a floor")

# ── 3b. and the board is SIZED, by a number, not by a flex negotiation ─────
#
# TWO WRONG ATTEMPTS BEFORE THIS ONE, both measured:
#
#   overflow-y:auto alone -- .strip shrank to 255px and .board went on being
#   399px, painting 149px past its own strip and over the elevator tabs.
#   overflow-y clips a box's CHILDREN; it says nothing about the box's height.
#
#   align-items/align-content:stretch with grid-template-rows:minmax(0,1fr) --
#   fixed the spill, and then shrank the board on windows that did not need it.
#   At 1440x940 the pane had been 227px, comfortably past the 200px floor, and
#   all eleven months were on screen; after that change the board scrolled and
#   only eight were. That is the standing rule broken for nothing.
#
# So the board takes an explicit ceiling instead of joining a negotiation. One
# number, and what it does at each height can be worked out by reading it:
#
#     700px window -> 200px board, ~4 months, pane 200, SAVE ON SCREEN
#     940px window -> 440px board, all eleven, no scroll (unchanged)
#    1080px window -> 580px board, all eleven, no scroll (unchanged)
#
# 500 IS MEASURED, AND THE FIRST NUMBER HERE WAS 420, WHICH WAS WRONG. At 420
# the pane got its 200px and the SAVE BUTTON sat 79px below the bottom of a
# 700px window -- the shell is overflow:hidden, so it was simply not painted.
# Jesse could have typed the basis and not been able to save it, which is the
# same bug one step further down the page.
#
# The 495 is everything the console needs around the board at 1440x700:
#
#     header  62   banner 58   tab strip 38
#     column: header 35 + panes 200 (their floor) + save bar 88  = 323
#     strip padding and the board's own margin                   =  14
#                                            total 495, taken to 500 for slack
#
# Above roughly 900px of window the ceiling is never reached and this rule does
# nothing at all.
css = sub(css,
'''  .strip .board{''',
'''  /* THE CEILING, 2026-09-08. See the long note in build/patch_basis.py --
     or rather, see the two paragraphs above this rule in the kit's README.
     Short version: the board may not take so much of a short window that the
     editor below it collapses. Every row stays rendered and reachable; on a
     window tall enough this rule never fires. */
  .strip .board{ max-height:calc(100vh - 500px); min-height:120px; }

  .strip .board{''',
"the board has a ceiling")

(work / "admin.css").write_text(css, encoding="utf-8")
print("admin.css patched")

# ── 4. a basis over the contract is a basis, not an error ──────────────────
html = (pristine / "index.html").read_text(encoding="utf-8")

html = sub(html,
'''        /* A basis OVER the contract is a real thing and a rare one; a basis
           over fifteen cents is almost always the old spread habit, typed
           without its minus. Named as the habit rather than as a range, so the
           person reads the sentence and sees their own mistake in it. */
        else if (parseFloat(v) > 0.15) out.push("The " + p[1] + " box, “" + v + "”, is a basis " +
          parseFloat(v).toFixed(2) + " OVER the contract, which would post well above the board. " +
          "If you meant " + parseFloat(v).toFixed(2) + " under, type −" + parseFloat(v).toFixed(2) +
          ". If you really do mean over, it has to be set in pricing.json, so that it takes " +
          "two people to notice.")
        else if (Math.abs(parseFloat(v)) > 1.5)''',
'''        /* THE +0.15 REFUSAL IS GONE -- 2026-09-08, Sig's call after Jesse
           asked to "enter negative or positive numbers for the basis".
           It read: a basis over fifteen cents is almost always the old spread
           habit typed without its minus, so refuse it and make it a
           two-person change in pricing.json. The habit is real, but the rule
           made the screen the only one of the three that would not take a
           signed number: tools/apply-update.mjs and both sites' update-prices
           .mjs have capped it symmetrically at BASIS_ABS_MAX = 1.50 since the
           basis path was built. Checked before removing, not assumed.
           Over and under are now one signed number with one limit. The
           sentence under the box says what the number will post, every
           keystroke, which is a better guard against a missing minus than a
           refusal that sent the office to a file it cannot edit. */
        else if (Math.abs(parseFloat(v)) > 1.5)''',
"positive basis allowed")


# ── 5. the contract quote the basis is set against, named on the screen ────
#
# Jesse: "We need it to point at Big River's Futures price instead of their
# Bid." It already does -- the moment a basis is saved, both sites price off
# futuresPriceCents and not off Big River's cash. What was missing is that the
# screen never showed the quote, so there was no way to see which of the two it
# was working from.
#
# WHAT THIS DOES NOT DO, AND WHY. It does not print what we will post. That
# figure carries the rounding rule, the rule has exactly one implementation in
# each site's update-prices.mjs, and this screen's own standing rule -- enforced
# by screen.test.mjs -- is that every $ figure in a .basis-read arrived in a
# file rather than being worked out here. A second rounding implementation is
# how the screen and the site come to disagree by a cent with nobody able to
# say which is right. futuresPriceCents DOES arrive in a file, so naming it
# breaks nothing; "you post $4.68" would.
#
# What customers will see already shows the posted price, read from what the
# site is publishing.
html = sub(html,
'''      if (cls.length) tr.className = cls.join(" ");''',
'''      if (cls.length) tr.className = cls.join(" ");
      /* The contract quote, carried on the row so the basis readout can name
         it. It is not a column: the board is a line-for-line check against
         what Big River publishes, and they do not publish this. It came from
         their feed all the same, so it is a figure from a file. */
      if (typeof r.futuresPriceCents === "number")
        tr.setAttribute("data-quote", (r.futuresPriceCents / 100).toFixed(4));''',
"the quote rides on the row")

html = sub(html,
'''      function line(month, theirBasis, mine) {
        return (month || "") +
               (theirBasis != null ? (month ? " &middot; " : "") + "Big River " + fmt(theirBasis) : "") +
               versus(mine, theirBasis);
      }''',
'''      /* The contract quote for a row, read back off the row that carries it.
         Same rule as cellNum: a sample board is not a source. */
      function quoteOf(row) {
        var tb = STRIP && STRIP.querySelector(".bd tbody");
        var tr = STRIP && STRIP.querySelector(row);
        if (!tr || !tb || tb.hasAttribute("data-sample")) return null;
        var q = parseFloat(tr.getAttribute("data-quote"));
        return isFinite(q) ? q : null;
      }
      function line(month, theirBasis, mine, quote) {
        /* THE ANCHOR, NAMED. "Dec 26 at $5.3325" is the number the basis is
           set against, and until 2026-09-08 the screen never said it -- which
           is why the office believed the basis was working off Big River's
           bid. It is read from their feed, not worked out here. */
        return (month || "") +
               (quote != null ? (month ? " at " : "") + "$" + quote.toFixed(4) : "") +
               (theirBasis != null ? ((month || quote != null) ? " &middot; " : "") +
                                     "Big River " + fmt(theirBasis) : "") +
               versus(mine, theirBasis);
      }''',
"the readout names the quote")

html = sub(html,
'''      if (readCash) readCash.innerHTML = line(monthOf("tr.is-ref"), refBasis, c);''',
'''      if (readCash) readCash.innerHTML =
        line(monthOf("tr.is-ref"), refBasis, c, quoteOf("tr.is-ref"));''',
"cash readout")

html = sub(html,
'''          readNew.innerHTML = line(monthOf("tr.is-new"), theirNew, h);''',
'''          readNew.innerHTML = line(monthOf("tr.is-new"), theirNew, h, quoteOf("tr.is-new"));''',
"new-crop readout")

(work / "index.html").write_text(html, encoding="utf-8")
print("index.html patched (the quote is named)")

# ── 6. the tests for the rule that was removed, replaced by tests for the ───
#      rule that took its place. Not deleted: the risk is real and still needs
#      a guard, it just is not a refusal any more.
t = (pristine / "test/panel.test.mjs").read_text(encoding="utf-8")

t = sub(t,
'''/* ══════════════════════════════════════════════════════════════════════════
   THE OLD SPREAD HABIT, TYPED INTO THE NEW BOX
   ══════════════════════════════════════════════════════════════════════════
   This box took a positive spread for years and the minus is deliberately no
   longer printed beside it. Typing 0.75 where -0.75 belongs is inside the
   symmetric $1.50 cap and posts $6.12 against a board paying $4.62 -- a
   symmetric cap cannot catch a one-sided habit.
   ══════════════════════════════════════════════════════════════════════════ */
for (const [box, label] of [["off", "Our basis — cash"],
                            ["offh", "Our basis — new crop"]])
  test(`a basis typed positive out of spread habit is refused — ${label}`,
    { skip: NB }, async () => {
    const p = await open({});
    const sel = id("badger", box);
    await p.fill(sel, "");
    await p.fill(sel, "0.75");
    await p.waitForFunction((s) => document.querySelector(s).value === "0.75", sel);
    const url = await save(p, "badger");
    const why = await refusalOf(p, "badger");
    await p.done();
    assert.equal(url, null, "0.75 typed where -0.75 belongs sailed through to a filed issue");
    assert.match(why, /OVER the contract/);
    assert.match(why, /type −0\\.75/,
      "the refusal has to show the number they meant, not only say they are wrong");
  });''',
'''/* ══════════════════════════════════════════════════════════════════════════
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
for (const [box, label] of [["off", "Our basis — cash"],
                            ["offh", "Our basis — new crop"]])
  test(`a basis over the contract is accepted now, and says what it is — ${label}`,
    { skip: NB }, async () => {
    const p = await open({});
    const sel = id("badger", box);
    await p.fill(sel, "");
    await p.fill(sel, "0.75");
    await p.waitForFunction((s) => document.querySelector(s).value === "0.75", sel);
    const url = await save(p, "badger");
    const why = await refusalOf(p, "badger");
    await p.done();
    assert.ok(url, "a positive basis inside the cap was refused: " + (why || "(no reason given)"));
  });

for (const [box, label] of [["off", "Our basis — cash"],
                            ["offh", "Our basis — new crop"]])
  test(`a basis past the $1.50 cap is still refused, either sign — ${label}`,
    { skip: NB }, async () => {
    /* The cap is what is left, so it has to hold in the direction the removed
       rule used to cover. */
    const p = await open({});
    const sel = id("badger", box);
    await p.fill(sel, "");
    await p.fill(sel, "1.75");
    await p.waitForFunction((s) => document.querySelector(s).value === "1.75", sel);
    const url = await save(p, "badger");
    const why = await refusalOf(p, "badger");
    await p.done();
    assert.equal(url, null, "1.75 over the contract sailed through");
    assert.match(why, /1\\.50|from zero/,
      "the refusal has to name the cap it broke");
  });''',
"positive basis policy tests")

(work / "test/panel.test.mjs").write_text(t, encoding="utf-8")
print("test/panel.test.mjs patched")

# ── 7. the fixture that would have caught this, and the test that uses it ──
#
# WHY IT WAS NEVER CAUGHT. Every layout test runs against BOARD_ROWS, which is
# six months. The live board is eleven, and the difference is 168px of table
# against 347px. The whole failure is a board taller than the fixture on a
# window shorter than the presets, and neither half existed in the harness.
lib = (pristine / "test/lib/screen.mjs").read_text(encoding="utf-8")

lib = sub(lib,
'''  ROOMY_EDGE:   { width: 1439, height: 940 },''',
'''  ROOMY_EDGE:   { width: 1439, height: 940 },
  /* JESSE'S WINDOW, 2026-09-08. A wide desk that is not a tall one -- the
     shape every preset above skipped, and the one where the editor collapsed
     to 18px. SHORT above is 1600x800, which still left 102px and looked fine. */
  SHORT_DESK:   { width: 1440, height: 700 },''',
"the short-desk viewport")

lib = sub(lib,
'''export const feedNow = (over = {}) => ({''',
'''/* THE BOARD AT ITS REAL LENGTH. Big River posts eleven deliveries; the fixture
   above is six, and a layout that holds for six is not a layout that holds.
   Same shape, same numbers as the live file on 2026-09-08, with the contract
   quote each row carries so the basis readout can name it. */
export const BOARD_ROWS_FULL = [
  ["September", "Dec 26", -0.75, 4.5825], ["October",  "Dec 26", -0.62, 4.7125],
  ["November",  "Dec 26", -0.55, 4.7825], ["December", "Dec 26", -0.50, 4.8325],
  ["January",   "Mar 27", -0.60, 4.885],  ["February", "Mar 27", -0.58, 4.905],
  ["March",     "Mar 27", -0.50, 4.9825], ["April",    "May 27", -0.54, 5.0175],
  ["May",       "May 27", -0.52, 5.0375], ["June",     "Jul 27", -0.52, 5.0675],
  ["July",      "Jul 27", -0.52, 5.0675],
].map(([delivery, futuresMonth, basisDollars, cash]) => ({
  commodity: "Corn", delivery, futuresMonth, basisDollars, cash,
  futuresPriceCents: Math.round((cash - basisDollars) * 10000) / 100,
}));

export const feedFull = (over = {}) => ({
  checkedAt: new Date().toISOString(), status: "ok", bids: BOARD_ROWS_FULL, ...over,
});

export const feedNow = (over = {}) => ({''',
"the eleven-row fixture")

(work / "test/lib/screen.mjs").write_text(lib, encoding="utf-8")
print("test/lib/screen.mjs patched")

s = (pristine / "test/screen.test.mjs").read_text(encoding="utf-8")

s = sub(s,
'''  ELEVATORS, OTHER, LAYOUT, col, id, named, SITE_FILES, BOARD_ROWS, HOURS_NOTE, PRICE_NOTE,
} from "./lib/screen.mjs";''',
'''  ELEVATORS, OTHER, LAYOUT, col, id, named, SITE_FILES, BOARD_ROWS, HOURS_NOTE, PRICE_NOTE,
  feedFull, BOARD_ROWS_FULL,
} from "./lib/screen.mjs";''',
"import the full board")

s += '''

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
  const p = await open({ viewport: LAYOUT.SHORT_DESK, feed: feedFull(), tab: "basis" });
  const m = await p.evaluate(() => {
    const box = document.querySelector('[data-id="off"]');
    let el = box, pane = null;
    while (el && el !== document.body) {
      if (/auto|scroll/.test(getComputedStyle(el).overflowY)) { pane = el; break; }
      el = el.parentElement;
    }
    const r = box.getBoundingClientRect();
    const strip = document.querySelector(".strip").getBoundingClientRect();
    const bd = document.querySelector(".board").getBoundingClientRect();
    const sv = document.querySelector(".col-save").getBoundingClientRect();
    return { pane: pane ? pane.clientHeight : 0,
             spill: Math.round(bd.bottom - strip.bottom),
             saveCutOff: Math.max(0, Math.round(sv.bottom - innerHeight)),
             boxOnScreen: r.top >= 0 && r.bottom <= innerHeight && r.height > 0 };
  });
  await p.done();
  /* 200 is the floor admin.css sets, and the floor is what this is testing. */
  assert.ok(m.pane >= 200,
    `the pane he types into is ${m.pane}px tall. It was 18px when Jesse reported it; ` +
    `the floor in admin.css is 200px.`);
  assert.ok(m.boxOnScreen, "the basis box is not on screen at all on a short desk");
  /* AND THE BOARD STAYS INSIDE ITS OWN STRIP. The first fix gave the editor
     its room and left the board painting 149px past the bottom of the strip,
     over the elevator tabs: overflow-y clips a box's children, not the box. */
  assert.ok(m.spill <= 0,
    `the board paints ${m.spill}px past the bottom of its own strip, over the tabs below it`);
  /* AND THE SAVE BUTTON IS ON SCREEN. Added after a mutation run: with only
     the pane's floor and no ceiling on the board, this test passed while the
     save bar sat 198px below the bottom of the window. The shell is
     overflow:hidden, so it was not painted at all -- Jesse could have typed
     the basis and had nothing to press. A pane he can type in and a button he
     cannot reach is the same bug one step further down the page. */
  assert.equal(m.saveCutOff, 0,
    `the save bar is ${m.saveCutOff}px below the bottom of the window and is not painted`);
});

test("AND THE BOARD KEEPS EVERY ROW, on a desk with room for them",
  { skip: NO_BROWSER }, async () => {
  /* The standing rule is that all twelve months stay visible, because the
     board is a line-for-line check. The fix must not have bought the editor
     its room out of that. Checked on the console layout, where there IS room:
     nothing may scroll and every row must be on screen. */
  const p = await open({ viewport: LAYOUT.CONSOLE, feed: feedFull(), tab: "basis" });
  const m = await p.evaluate(() => {
    const bd = document.querySelector(".board");
    const c = bd.getBoundingClientRect();
    const rows = [...document.querySelectorAll(".bd tbody tr")];
    return { rows: rows.length, scrolls: bd.scrollHeight > bd.clientHeight + 1,
             visible: rows.filter((tr) => { const r = tr.getBoundingClientRect();
               return r.top >= c.top - 1 && r.bottom <= c.bottom + 1; }).length };
  });
  await p.done();
  assert.equal(m.visible, m.rows,
    `${m.visible} of ${m.rows} months on screen at 1600x1000. All of them have to be: ` +
    `the board is the check, and a line you cannot see is not a line you can check.`);
  assert.equal(m.scrolls, false, "the board is scrolling on a desk with room for it");
});

test("THE BASIS READOUT NAMES THE CONTRACT IT IS SET AGAINST",
  { skip: NO_BROWSER }, async () => {
  /* Jesse: "We need it to point at Big River's Futures price instead of their
     Bid." It always did, once a basis was saved; the screen never said so. */
  const p = await open({ viewport: LAYOUT.CONSOLE, feed: feedFull(), tab: "basis" });
  await p.fill(id("badger", "off"), "-0.65");
  await p.waitForFunction((s) => document.querySelector(s).value === "-0.65", id("badger", "off"));
  const read = await p.evaluate((s) => document.querySelector(s).textContent.trim(),
                                col("badger") + ' [data-id="basisCash"]');
  await p.done();
  /* 5.3325 = 4.5825 - (-0.75), and it arrives in the feed as futuresPriceCents.
     No figure in this readout is worked out by the screen. */
  assert.match(read, /Dec 26/, "the contract month is not named: " + read);
  assert.match(read, /5\\.3325/, "the contract quote is not named: " + read);
  assert.match(read, /0\\.10 over them/,
    "the readout does not say where the typed basis sits against Big River: " + read);
});
'''

(work / "test/screen.test.mjs").write_text(s, encoding="utf-8")
print("test/screen.test.mjs patched")
