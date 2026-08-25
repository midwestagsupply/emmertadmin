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

test("the daily job is on the screen without scrolling, at a desk", { skip: NB }, async () => {
  /* The owner asked for four things to be visible at once: the board, the
     basis boxes, today's hours and the notice banner, with Save pinned. The
     two-column layer is what promises that, so it is what is checked. The
     short-window layer shows ONE elevator and is allowed to scroll -- that is
     its whole reason for existing. */
  const bad = [];
  await onEachScreen(async (p, where, w, h) => {
    if (!(w >= 1440 && h >= 940)) return;
    const r = await p.evaluate(() => {
      const pane = document.querySelector(".col-panes");
      const seen = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return "missing";
        const b = e.getBoundingClientRect();
        return b.top >= -1 && b.bottom <= window.innerHeight + 1 ? true : `${Math.round(b.top)}..${Math.round(b.bottom)} of ${window.innerHeight}`;
      };
      return {
        overflow: pane ? pane.scrollHeight - pane.clientHeight : null,
        sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        board: seen(".strip .board"),
        basis: seen('[data-id="c-bid"]'),
        today: seen('[data-id="c-today"]'),
        banner: seen('[data-id="c-banner"]'),
        save: seen(".col .save"),
      };
    });
    if (r.overflow > 0) bad.push(`${where}: the pane scrolls by ${r.overflow}px`);
    if (r.sideways) bad.push(`${where}: the page scrolls sideways`);
    for (const k of ["board", "basis", "today", "banner", "save"])
      if (r[k] !== true) bad.push(`${where}: ${k} is not fully on screen (${r[k]})`);
  });
  assert.deepEqual(bad, [], "not all of it fits —\n  " + bad.join("\n  "));
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
      const of = (site) => {
        const c = document.querySelector(`.col[data-elev="${site}"]`);
        return {
          name: (c.querySelector(".col-name") || {}).textContent || "",
          town: (c.querySelector(".col-town") || {}).textContent || "",
          save: (c.querySelector(".btn-go") || {}).textContent || "",
          repo: (c.querySelector(".col-live") || {}).textContent || "",
        };
      };
      return { badger: of("badger"), midwest: of("midwest") };
    });
    for (const k of ["name", "town", "save", "repo"]) {
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
      };
    });
    await p.done?.();
    await ctx.close();
    assert.match(r.text, /GitHub/,
      "the screen never names the site it is about to send somebody to");
    assert.match(r.text, /Submit new issue/,
      "the screen does not say which button on that page actually saves");
    assert.equal(r.howCount, 2, "each elevator needs its own instruction, not one shared line");
    assert.equal(r.howVisible, 2, "the instruction is on the page but not visible");
    assert.equal(r.subOnButtons, 2, "the Save buttons do not say they open a second page");
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
    await p.evaluate(() => document.body.removeAttribute("data-tab"));
    /* AND OPEN THE FOLDED PANEL. Two of the four counters live behind
       "Weekly hours & small print", which is a deliberate fold with its own
       button -- a different control answering a different question. Leaving
       it shut would credit the help key with hiding something the fold is
       hiding on purpose. */
    await p.click("#rareBtn");
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
