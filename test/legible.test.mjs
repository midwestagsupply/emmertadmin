/* CAN IT BE READ, AND DOES IT FIT.
 *
 * Two complaints from the owner on 2026-08-24, in his words: "the color is
 * also very hard for me to see", and "too much dead space, wasted space".
 *
 * Both were true and neither was caught by 216 passing tests, because every
 * one of those tests asked what the screen SAYS and none asked what it LOOKS
 * LIKE. The worst element on the screen measured 1.22:1 -- the console's cream
 * ink drawn on the site's yellow notice bar -- and had been shipping for days.
 *
 * So these two guards. They are deliberately not "does this rule say #fff":
 * a stylesheet can pass that and still paint white on white, which is exactly
 * what happened. They open the real page in a real browser, ask the browser
 * for the COMPUTED colour of every piece of text and the ACTUAL painted
 * surface behind it, and do the arithmetic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getChromium, makeFixture, dropFixture } from "./lib/screen.mjs";
import { join, resolve } from "node:path";

const chromium = await getChromium();
const NB = chromium ? false : "playwright is not installed";

/* WCAG AA for body text. Not aspirational -- the floor. */
const FLOOR = 4.5;

/* The measuring function runs in the page, because only the page knows what is
   actually behind a transparent element. */
const PROBE = () => {
  const lum = (rgb) => {
    const p = rgb.match(/[\d.]+/g);
    if (!p) return null;
    const [r, g, b] = p.slice(0, 3).map(Number).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  /* WALK UP FOR THE REAL GROUND. An element with no background of its own is
     painted on whatever its first opaque ancestor has. Comparing text against
     its own `background-color` -- which is `rgba(0,0,0,0)` -- is how a check
     like this passes while the page is unreadable. */
  const surfaceOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    /* OWN TEXT ONLY. A wrapper "contains" all its children's words; scoring it
       would measure a colour no character on screen is actually drawn in. */
    let own = "";
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    if (!own.trim()) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const fg = lum(cs.color), bg = lum(surfaceOf(el));
    if (fg === null || bg === null) continue;
    const hi = Math.max(fg, bg), lo = Math.min(fg, bg);
    out.push({
      ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2),
      text: own.trim().replace(/\s+/g, " ").slice(0, 44),
      cls: (el.className && el.className.baseVal === undefined ? String(el.className) : "").slice(0, 30),
      color: cs.color, on: surfaceOf(el),
    });
  }
  return out;
};

async function onEachScreen(fn) {
  const dir = makeFixture();
  const browser = await chromium.launch();
  try {
    /* BOTH STATES. `filled` is what the office sees every day; `live` is the
       shipped file before anything has filled it in, which is also a state a
       human can be looking at -- and it is the one that carries the filler
       warning and the sample values. A colour that only fails in one of them
       still fails. */
    for (const page of ["filled.html", "live.html"]) {
      for (const [w, h] of [[1920, 1080], [1600, 1000], [1440, 900], [1280, 800], [390, 844]]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h } });
        const p = await ctx.newPage();
        await p.goto("file://" + join(dir, page));
        await p.waitForTimeout(350);
        await fn(p, `${page} at ${w}x${h}`, w, h);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    dropFixture(dir);
  }
}

test("nothing on this screen is written in a colour you cannot read", { skip: NB }, async () => {
  const bad = [];
  await onEachScreen(async (p, where) => {
    const items = await p.evaluate(PROBE);
    assert.ok(items.length > 40, `${where}: only ${items.length} text elements measured — the probe is not finding the page`);
    for (const i of items)
      if (i.ratio < FLOOR) bad.push(`${where}: ${i.ratio}:1  "${i.text}"  ${i.color} on ${i.on}  (.${i.cls})`);
  });
  assert.deepEqual(bad, [],
    "text below " + FLOOR + ":1 —\n  " + bad.join("\n  "));
});

test("THE DAILY JOB IS ON THE SCREEN WITHOUT SCROLLING, AT A DESK", { skip: NB }, async () => {
  /* The owner asked for one page that shows all the data on screen, for both
     elevators. It is TWO screens now and that is a change worth stating rather
     than smuggling: the basis and the eleven delivery months are one subject and
     the hours, the banner and the week are another, and crowding both into one
     view is what produced the card screen this replaced.

     What did not change is the promise underneath. On a desk, each screen shows
     everything it is about, for BOTH elevators, with nothing scrolling and Save
     on the page. That is what is checked here, per screen, rather than four
     named cards being simultaneously visible.

     Driven on filled.html, which is the shipped file with the sample markers
     stripped and no network at all -- so the month rows are not drawn. The
     static rows are, and they are what this measures. */
  const bad = [];
  await onEachScreen(async (p, where, w, h) => {
    if (!(w >= 1440 && h >= 940)) return;
    for (const tab of ["basis", "hours"]) {
      await p.click(`.rail-b[data-go="${tab}"]`);
      await p.waitForTimeout(80);
      const r = await p.evaluate((t) => {
        const sheet = document.querySelector(".sheet");
        const seen = (sel) => {
          const els = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length);
          if (!els.length) return "missing";
          for (const e of els) {
            const b = e.getBoundingClientRect();
            if (!(b.top >= -1 && b.bottom <= window.innerHeight + 1))
              return `${Math.round(b.top)}..${Math.round(b.bottom)} of ${window.innerHeight}`;
          }
          return true;
        };
        /* THE BASIS SCREEN'S BOXES ARE MONTH ROWS AND THEY NEED THE FEED.
           `[data-id="off"]` and `[data-id="offh"]` were the two fallback basis
           boxes, gone since 2026-09-08. Their replacements are drawn by
           drawBoard from Big River's board, and this test runs on filled.html
           with no network at all, so there is nothing to look for here -- the
           comment at the top of the test already says the month rows are not
           drawn. That every month row and both Saves are on screen at every
           size a person uses is checked in console.test.mjs, on a real feed.
           What filled.html can still answer is that the basis screen renders
           its own furniture and its Saves without scrolling. */
        const want = t === "basis"
          ? { save: ".col-save .btn-go" }
          : { today: '[name="today"]', banner: '[name="message"]',
              week: '[name="wk_open"]', save: ".col-save .btn-go" };
        const out = { overflow: sheet.scrollHeight - sheet.clientHeight,
                      sideways: sheet.scrollWidth > sheet.clientWidth };
        for (const k of Object.keys(want)) out[k] = seen(want[k]);
        /* Both elevators, not one. This is the whole reason the screen was
           rebuilt, so it is asserted rather than assumed. */
        out.columns = document.querySelectorAll(".col").length;
        return out;
      }, tab);
      for (const [k, v] of Object.entries(r)) {
        if (k === "overflow" || k === "sideways" || k === "columns") continue;
        if (v !== true) bad.push(`${where} on ${tab}: ${k} is not fully on screen (${v})`);
      }
      if (r.overflow > 1) bad.push(`${where} on ${tab}: the sheet scrolls by ${r.overflow}px`);
      if (r.sideways) bad.push(`${where} on ${tab}: the sheet scrolls sideways`);
      if (r.columns !== 2) bad.push(`${where} on ${tab}: ${r.columns} elevators on screen, not 2`);
    }
  });
  assert.deepEqual(bad, [], "not all of it fits —\n      " + bad.join("\n      "));
});

test("the two elevators are told apart by something other than colour", { skip: NB }, async () => {
  /* Rule 5. If the red and the teal were the only difference, one reader in
     twelve is running two identical forms side by side. */
  const dir = makeFixture();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const p = await ctx.newPage();
    await p.goto("file://" + join(dir, "filled.html"));
    await p.waitForTimeout(300);
    const r = await p.evaluate(() => {
      /* AMENDED AGAIN, 2026-09-09. The name, the town and the repository lived
         in the strip at the top of the page; Sig cut both its lines that day as
         a restatement of the two screens under them. The claim is unchanged and
         is the one that matters -- neither elevator is told from the other by
         colour alone -- so each fact is read from wherever it now lives: the
         name and the town are on the heading over that elevator's own columns,
         and the elevator's name is on its own Save button. The repository is no
         longer written on the screen at all, and it does not need to be: it is
         in the URL the Save opens, which is checked in screen.test.mjs against
         the elevator being edited. */
      const of = (site) => {
        const c = document.querySelector(`.col[data-elev="${site}"]`);
        const cols = { badger: 7, midwest: 10 };
        const head = [...document.querySelectorAll(".sheet .cell.hd.grp")]
          .find((h) => (h.style.gridColumn || "").startsWith(String(cols[site]) + " "));
        return {
          save: (c.querySelector(".btn-go") || {}).textContent || "",
          heading: head ? head.textContent : "",
        };
      };
      return { badger: of("badger"), midwest: of("midwest") };
    });
    for (const k of ["save", "heading"]) {
      assert.notEqual(r.badger[k].trim(), "", `badger ${k} is empty`);
      assert.notEqual(r.badger[k].trim(), r.midwest[k].trim(),
        `the two columns' ${k} read the same, so colour is carrying it alone`);
    }
  } finally { await browser.close(); dropFixture(dir); }
});

/* ══════════════════════════════════════════════════════════════════════════
   SAVE TELLS THE TRUTH ABOUT ITSELF
   ══════════════════════════════════════════════════════════════════════════
   Reported by a review panel on 2026-08-24 and confirmed against the page:
   the button said "Save Badger Grain Supply", the word GitHub appeared
   NOWHERE a person could read, and `dirty = false` ran three lines before
   the second page was opened -- so the unsaved-changes guard was already off
   while the work was still unsaved.

   A static page holds no password and cannot write to the site. Save opening
   a second page is not a wart to hide; it is the whole reason there is no
   password to leak. What was wrong was saying nothing about it. */
test("the screen says Save opens a second page, and where", { skip: NB }, async () => {
  const dir = makeFixture();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const p = await ctx.newPage();
    await p.goto("file://" + join(dir, "filled.html"));
    await p.waitForTimeout(300);
    const r = await p.evaluate(() => {
      const vis = (el) => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        const b = el.getBoundingClientRect();
        return cs.display !== "none" && cs.visibility !== "hidden" && b.width > 0 && b.height > 0;
      };
      const how = [...document.querySelectorAll('[data-id="saveHow"]')];
      return {
        text: document.body.innerText,
        howCount: how.length,
        howVisible: how.filter(vis).length,
        subOnButtons: [...document.querySelectorAll(".btn-go .btn-sub")].filter(vis).length,
        footNote: (() => { const f = document.querySelector(".sheet .foot-note");
          return !!f && vis(f) && /Submit new issue/.test(f.textContent); })(),
      };
    });
    await p.done?.();
    await ctx.close();
    assert.match(r.text, /GitHub/,
      "the screen never names the site it is about to send somebody to");
    assert.match(r.text, /Submit new issue/,
      "the screen does not say which button on that page actually saves");
    /* AMENDED: it IS one shared line now, and deliberately. The same sentence
       under two Save buttons was the tallest thing in the command bar -- 131px
       of a 700px window, above the eleven months it was sitting on. It is said
       once, in the sheet's own footer under the market columns, where both
       Saves are on the same row and it reads as being about both. The per-column
       element stays in the DOM because the screen still marks it "now" the
       moment a save opens its tab, which is a per-column thing. */
    assert.equal(r.howCount, 2, "each elevator's own guidance element is gone");
    assert.ok(r.footNote, "the instruction is nowhere on the screen");
    void r.subOnButtons;   /* said once in the footer now, see above */
  } finally { await browser.close(); dropFixture(dir); }
});

test("the unsaved-changes guard stays on until the second page is really open", { skip: NB }, async () => {
  /* Measured on the source rather than by closing a browser, because the
     beforeunload dialog cannot be inspected from here. The order of those two
     statements IS the defect: cleared before the open, the guard is off while
     the work is unsaved; cleared after, it is not. */
  const src = readFileSync(join(resolve(import.meta.dirname, ".."), "index.html"), "utf8");
  const open = src.indexOf("window.open(url");
  const clear = src.indexOf("dirty = false", src.indexOf("var url = issueUrl(form)"));
  assert.ok(open > 0 && clear > 0, "the save handler no longer has the shape this checks");
  assert.ok(clear > open,
    "dirty is cleared BEFORE the second page is opened — the unsaved-changes guard is off while the work is still unsaved");
  assert.match(src.slice(open, open + 400), /if \(!win\)/,
    "window.open's return value is discarded, so a blocked popup looks exactly like a saved change");
});

test("the characters-left figure survives the ? help key", { skip: NB }, async () => {
  /* .counter carries BOTH the explanation ("Two lines on a phone") and the
     "N left" figure the script appends into it. The ? key is right to hide
     the first and wrong to hide the second: with it off -- the default -- a
     sentence typed into the notice box stops dead at 160 characters with no
     beep, no red and no count, and the preview shows the truncation without
     saying it is one. The file's own rule: the key hides EXPLANATION, never
     STATE. */
  const dir = makeFixture();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const p = await ctx.newPage();
    await p.goto("file://" + join(dir, "filled.html"));
    await p.waitForTimeout(300);
    /* SHOW EVERY TAB. This is a question about the ? help key, not about the
       rail: with one section up, three of the four counters are behind a tab
       and would be "hidden" for a reason that has nothing to do with what is
       being tested. Clearing the attribute is what the shared harness does
       for the same reason. */
    await p.evaluate(() => {
      document.body.setAttribute("data-tab", "all");
      if (window.__layout) window.__layout();
    });
    /* THERE IS NO FOLDED PANEL. The two counters that used to sit behind
       "Weekly hours & small print" are rows of the hours screen now and are on
       screen with everything else, so nothing has to be opened before asking
       what the help key hides. */
    await p.waitForTimeout(80);
    const r = await p.evaluate(() => {
      const helpOff = document.body.getAttribute("data-help") !== "on";
      const tags = [...document.querySelectorAll(".counter .left")];
      const seen = tags.filter((t) => {
        const cs = getComputedStyle(t);
        const b = t.getBoundingClientRect();
        return cs.display !== "none" && cs.visibility !== "hidden" &&
               parseFloat(cs.fontSize) > 6 && b.width > 0 && b.height > 0;
      });
      return { helpOff, total: tags.length, seen: seen.length,
               text: seen.map((t) => t.textContent.trim()).slice(0, 2) };
    });
    await ctx.close();
    assert.equal(r.helpOff, true, "this test is only meaningful with the help key off, which is the default");
    assert.ok(r.total >= 2, "no characters-left figures were rendered at all");
    assert.equal(r.seen, r.total,
      `${r.total - r.seen} of ${r.total} characters-left figures are hidden while the help key is off`);
    for (const t of r.text) assert.match(t, /\d+\s+left/, `"${t}" is not a readable count`);
  } finally { await browser.close(); dropFixture(dir); }
});

/* ══════════════════════════════════════════════════════════════════════════
   NOTHING RUNS OFF THE EDGE OF ITS OWN COLUMN, on any tab.
   ══════════════════════════════════════════════════════════════════════════
   Found 2026-08-25 on the Basis tab at 1600x1000: the c-bid card's two-up
   grid sized its tracks from a nowrap label plus a fixed money box -- a 445px
   min-content in a 330px cell -- and since a grid track cannot shrink below
   min-content, the card ran 128px past the viewport with no scrollbar to
   reach it. The clipped edge was the new-crop box itself: a field for a
   number, half off the screen, on the tab whose whole job is that number.

   The general form of the guard, not the specific one: for every tab, no
   element inside a column may extend past the column's own right edge unless
   an ancestor actually scrolls sideways. The contrast probe cannot catch
   this -- clipped text is perfectly legible right up to the pixel where it
   stops existing. */
test("no tab clips its own content at the column edge", { skip: NB }, async () => {
  const dir = makeFixture();
  const browser = await chromium.launch();
  const bad = [];
  try {
    for (const [w, h] of [[1600, 1000], [1440, 940]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const p = await ctx.newPage();
      await p.goto("file://" + join(dir, "filled.html"));
      await p.waitForTimeout(300);
      for (const tab of ["basis", "hours"]) {
        await p.click(`.rail-b[data-go="${tab}"]`);
        await p.waitForTimeout(60);
        const clipped = await p.evaluate(() => {
          const out = [];
          /* AMENDED: a column is display:contents now -- it has no box of its
             own -- so the edge that content may not pass is the sheet's. That
             is the stricter reading: it catches a cell painting past the last
             elevator's columns as well as one painting past its own. */
          for (const col of document.querySelectorAll(".sheet")) {
            if (getComputedStyle(col).display === "none") continue;
            const edge = col.getBoundingClientRect().right + 1;
            for (const el of col.querySelectorAll("*")) {
              const cs = getComputedStyle(el);
              if (cs.display === "none" || cs.visibility === "hidden") continue;
              const r = el.getBoundingClientRect();
              if (!r.width || !r.height || r.right <= edge) continue;
              /* An ancestor that really scrolls sideways is a pane, not a
                 clip: the phone's board table lives in one on purpose. */
              let n = el.parentElement, scrolls = false;
              while (n && n !== col.parentElement) {
                const ncs = getComputedStyle(n);
                if (/auto|scroll/.test(ncs.overflowX) && n.scrollWidth > n.clientWidth + 1) { scrolls = true; break; }
                n = n.parentElement;
              }
              if (!scrolls)
                out.push(`${el.tagName}.${String(el.className).split(" ")[0]} right=${Math.round(r.right)} past ${Math.round(edge)}`);
            }
          }
          return [...new Set(out)].slice(0, 6);
        });
        for (const c of clipped) bad.push(`${tab} at ${w}x${h}: ${c}`);
      }
      await ctx.close();
    }
  } finally { await browser.close(); dropFixture(dir); }
  assert.deepEqual(bad, [], "content past its column's edge with nothing to scroll —\n  " + bad.join("\n  "));
});

/* ══════════════════════════════════════════════════════════════════════════
   ONE LIVENESS LINE, not a stale one above a live one.
   ══════════════════════════════════════════════════════════════════════════
   The shipped .feed block was written for the Worker to replace, and there is
   no Worker: on Pages it is forever the sample sentence with the sample time
   in it. The live check below it already stands the sample DOWN in script --
   but `hidden` is UA-level display:none and `.feed{display:flex}` is an
   author rule, so the attribute lost and both lines rendered: "the feed is
   live, 7:48 PM" above "the feed is live, 1 minute ago". Two claims, two
   times, one truth. This drives the real page and counts what is visible. */
test("once the live check answers, the shipped feed line is gone", { skip: NB }, async () => {
  const dir = makeFixture();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const p = await ctx.newPage();
    await p.goto("file://" + join(dir, "filled.html"));
    /* No routes are mocked here, so the live check FAILS -- which is still an
       answer written into #feedLive, and exactly the moment two lines about
       the feed must not both be up. */
    await p.waitForFunction(() => {
      const t = document.getElementById("feedLiveText");
      return t && t.textContent.trim().length > 0 && !/Asking the feed/.test(t.textContent);
    }, { timeout: 8000 });
    const r = await p.evaluate(() => {
      const vis = (el) => el && el.offsetParent !== null &&
        getComputedStyle(el).display !== "none";
      /* AMENDED: the feed panel became a phrase in the bar at the top of the
         page. The claim is unchanged -- two claims about the same feed, with
         two different times, must never both be up -- so it is asked of the
         line that is now on screen and of the shipped one that must not be. */
      return {
        shipped: vis(document.querySelector(".strip .feed")),
        live: (() => { const n = document.getElementById("feedNote");
          return !!n && vis(n) && n.textContent.trim().length > 0; })(),
      };
    });
    await ctx.close();
    assert.equal(r.live, true, "the live check never wrote its line");
    assert.equal(r.shipped, false,
      "the shipped sample line is still on screen above the live one — two claims about " +
      "the same feed with two different times");
  } finally { await browser.close(); dropFixture(dir); }
});
