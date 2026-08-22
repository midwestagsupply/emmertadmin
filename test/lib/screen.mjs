/* THE FIXTURE THE SCREEN TESTS ARE DRIVEN THROUGH.
 *
 * WHY THERE IS A LIBRARY AT ALL, WHEN THERE WAS NOT ONE BEFORE.
 * The screen used to be one form chosen by ?site=. Every test could reach for
 * "the form", "#off", ".btn-go" and get the only one there was. The page now
 * stamps TWO columns from a <template>, so every one of those selectors is
 * ambiguous, and a test that keeps using them silently tests Badger twice and
 * reports that both elevators work. That is the exact failure mode this
 * rewrite exists to remove, so the addressing is centralised here: nothing in
 * the suite may name a control except through col()/id(), both of which take
 * the elevator as their first argument and cannot be called without one.
 *
 * WHY THE NETWORK IS ALWAYS MOCKED. The screen reads four files: Big River's
 * board from the bids repo, and hours/pricing/bids from EACH elevator's own
 * repository. Left to the real internet the suite is a weather report — and
 * worse, both columns would read the same real files, so a test could not tell
 * "each column reads its own repo" from "both columns read one repo". Here the
 * two elevators are served DIFFERENT files on purpose, and the catch-all abort
 * means a fetch to anywhere unexpected fails loudly instead of quietly
 * succeeding.
 *
 * Route order matters and is not obvious: Playwright matches handlers in
 * REVERSE order of registration, so the catch-all goes on first and the
 * specific files after it.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..");

/* ---- playwright, or an honest skip -------------------------------------
   This repository has no package.json and is uploaded by hand, so
   `node --test test/*.mjs` has to keep working on a machine that has never
   installed a browser. CI installs one — see .github/workflows/test.yml — so
   these really do run on every push. PLAYWRIGHT_IMPORT lets an unusual
   install say where it is; a hardcoded path in a shipped file is how a
   machine-specific detail becomes load-bearing. */
export async function getChromium() {
  let chromium = null;
  try {
    const mod = await import("playwright");
    chromium = mod.chromium || (mod.default && mod.default.chromium);
  } catch { /* left null on purpose */ }
  if (!chromium && process.env.PLAYWRIGHT_IMPORT) {
    try {
      const mod = await import(process.env.PLAYWRIGHT_IMPORT);
      chromium = mod.chromium || (mod.default && mod.default.chromium);
    } catch { /* still null */ }
  }
  return chromium;
}

/* ---- the two elevators, and everything that differs between them --------
   Read off the page's own SITES / TOWN / REPO_OF / HARVEST_HRS maps. A test
   that asserts "Badger says Badger" against a constant it also supplies is
   worth nothing, so these are used the other way round: to prove the column
   stamped for one elevator carries none of the other's identity. */
export const ELEVATORS = [
  { site: "badger",  name: "Badger Grain Supply",      town: "Wheeler", repo: "badgergrain",      harvest: "8:00a to 7:00p" },
  { site: "midwest", name: "Midwest Commodity Service", town: "Baldwin", repo: "midwestcommodity", harvest: "7:00a to 7:00p" },
];
export const OTHER = (site) => ELEVATORS.find((e) => e.site !== site);

/* ---- the three layout states, at the boundaries the page measured -------
   width >= 1440 AND height >= 940  two columns, whole board on screen
   width >= 1440, shorter           same dark console, ONE elevator, tabs
   width <  1440                    roomy light layout, one at a time
   The pairs ending in _EDGE are the smallest size that is still in that
   state, and the ones ending in _UNDER are one pixel outside it. A boundary
   asserted only in its comfortable middle is not asserted at all. */
export const LAYOUT = {
  CONSOLE:      { width: 1600, height: 1000 },
  CONSOLE_EDGE: { width: 1440, height: 940 },
  SHORT:        { width: 1600, height: 800 },
  SHORT_EDGE:   { width: 1440, height: 939 },
  ROOMY:        { width: 1100, height: 900 },
  ROOMY_EDGE:   { width: 1439, height: 940 },
  PHONE:        { width: 390,  height: 844 },
};

/* ---- addressing a control inside ONE column ----------------------------- */
export const col = (site) => `.col[data-elev="${site}"]`;
/* The stamp turns data-id="off" into id="badger-off". Tests ask for the
   data-id and the elevator; they never spell a prefixed id themselves, so a
   change to the prefixing scheme lands in one place. */
export const id = (site, dataId) => `#${site}-${dataId}`;
/* A named control, scoped to its own column's form. `[name=spread]` on its
   own matches both forms and Playwright silently takes the first. */
export const named = (site, name) => `${col(site)} [name="${name}"]`;

/* ---- what the four files say, per elevator, by default -------------------
   Deliberately DIFFERENT between the two elevators, because identical
   fixtures cannot tell a column reading its own repository from a column
   reading its neighbour's. Badger runs the zero new-crop spread on purpose —
   that is a live setting, not a test convenience, and it keeps the zero state
   under test on every load. */
export const BOARD_ROWS = [
  { commodity: "Corn", delivery: "August",    futuresMonth: "Sep 26", basisDollars: -0.52, cash: 4.07 },
  { commodity: "Corn", delivery: "September", futuresMonth: "Sep 26", basisDollars: -0.46, cash: 4.13 },
  { commodity: "Corn", delivery: "October",   futuresMonth: "Dec 26", basisDollars: -0.55, cash: 4.2825 },
  { commodity: "Corn", delivery: "November",  futuresMonth: "Dec 26", basisDollars: -0.57, cash: 4.2725 },
  { commodity: "Corn", delivery: "December",  futuresMonth: "Dec 26", basisDollars: -0.50, cash: 4.3325 },
  { commodity: "Corn", delivery: "January",   futuresMonth: "Mar 27", basisDollars: -0.60, cash: 4.39 },
];
export const feedNow = (over = {}) => ({
  checkedAt: new Date().toISOString(), status: "ok", bids: BOARD_ROWS, ...over,
});

export const PRICE_NOTE = "Prices change with the market and are not final until you call. " +
  "Grain is bought subject to the drying and discount schedule below.";
export const HOURS_NOTE = "During harvest we run longer, seven days a week. Outside harvest " +
  "the hours above hold. Updated hours are posted here first. When in doubt, call.";

export const SITE_FILES = {
  badger: {
    hours: { weekday: "8:00a to 5:00p", saturday: "8:00a to 12:00p", sunday: null,
             harvest: "8:00a to 7:00p", harvest_mode: false, closed_today: false,
             today_override: null, banner: null, hoursnote: HOURS_NOTE },
    pricing: { spread: 0.10, spreadHarvest: 0, price_note: PRICE_NOTE },
    bids: { bids: [{ delivery: "August", cashPrice: 4.03 }, { delivery: "September", cashPrice: 4.09 },
                   { delivery: "October", cashPrice: 4.18 }, { delivery: "November", cashPrice: 4.16 }] },
  },
  midwest: {
    hours: { weekday: "7:00a to 6:00p", saturday: null, sunday: null,
             harvest: "7:00a to 7:00p", harvest_mode: false, closed_today: false,
             today_override: null, banner: null, hoursnote: HOURS_NOTE },
    pricing: { spread: 0.12, price_note: PRICE_NOTE },
    bids: { bids: [{ delivery: "August", cashPrice: 4.01 }, { delivery: "October", cashPrice: 4.15 }] },
  },
};
/* A deep-ish clone so a test that edits its copy cannot leak into the next
   one. Two tests sharing one mutable fixture is its own quiet bug. */
export const files = (over = {}) => {
  const out = JSON.parse(JSON.stringify(SITE_FILES));
  for (const site of Object.keys(over || {}))
    for (const k of Object.keys(over[site] || {}))
      out[site][k] = over[site][k] === null ? null : { ...out[site][k], ...over[site][k] };
  return out;
};

/* ---- the fixture on disk ------------------------------------------------
   The live screen and a copy differ only by data-live on <html>: the copy
   disables Save. Both are built here rather than by mutating the repository,
   so the suite never edits the thing it is testing. */
export function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), "screen-"));
  const html = readFileSync(join(REPO, "index.html"), "utf8");
  if (!/<html lang="en"/.test(html)) throw new Error("index.html is not the shape this fixture assumes");
  writeFileSync(join(dir, "live.html"), html);
  writeFileSync(join(dir, "copy.html"), html.replace('<html lang="en"', '<html lang="en" data-live="0"'));
  /* WHAT THE PAGE LOOKS LIKE WHEN SOMETHING HAS ALREADY FILLED IT. The
     data-sample markers are what "nothing rendered this" means; a screen with
     them removed is the state the filler warning must stay silent about. */
  writeFileSync(join(dir, "filled.html"), html.replace(/ data-sample(?=[ >])/g, ""));
  writeFileSync(join(dir, "admin.css"), readFileSync(join(REPO, "admin.css")));
  for (const d of ["assets", "fonts"]) {
    mkdirSync(join(dir, d), { recursive: true });
    for (const f of readdirSync(join(REPO, d)))
      writeFileSync(join(dir, d, f), readFileSync(join(REPO, d, f)));
  }
  return dir;
}
export const dropFixture = (dir) => { if (dir) rmSync(dir, { recursive: true, force: true }); };

const json = (body) => ({
  status: 200, contentType: "application/json",
  /* raw.githubusercontent really does serve this, and without it the browser
     refuses the answer and every test would exercise the failure path. */
  headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify(body),
});

/* ---- open the screen ----------------------------------------------------
   opts:
     page      "live" (default), "copy" or "filled"
     query     "?site=midwest" etc; the address no longer picks an elevator,
               it only says which column opens focused
     viewport  one of LAYOUT
     feed      the boyceville.json body, or null to make the read fail
     sites     per-elevator { hours, pricing, bids }; a null value makes that
               file's read fail, which is a different thing from an empty one
     rare      open the "Weekly hours & small print" panels, which the console
               folds away by default
     help      press the ? key on
     settle    how long to wait for the four reads to land
*/
export async function openScreen(browser, dir, opts = {}) {
  const {
    page: which = "live", query = "", viewport = LAYOUT.CONSOLE,
    feed = feedNow(), sites = files(), rare = false, help = false, settle = 500,
  } = opts;

  const context = await browser.newContext({ viewport });
  /* Catch-all FIRST so the specific handlers registered after it win. Anything
     the page asks for that this fixture did not plan for fails outright. */
  await context.route("**/*", (r) => {
    const u = r.request().url();
    if (/^file:/.test(u)) return r.continue();
    if (/github\.com\/midwestagsupply\/[a-z]+\/issues\/new/.test(u))
      return r.fulfill({ status: 200, contentType: "text/html",
                         body: "<title>issue form</title>The office would file this." });
    return r.abort();
  });
  await context.route("**/boyceville.json*", (r) => feed == null ? r.abort() : r.fulfill(json(feed)));
  for (const e of ELEVATORS) {
    const f = sites[e.site] || {};
    for (const [file, body] of [["hours", f.hours], ["pricing", f.pricing], ["bids", f.bids]])
      await context.route(`**/${e.repo}/main/${file}.json*`, (r) =>
        body == null ? r.abort() : r.fulfill(json(body)));
  }

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  /* Every window this page opens, kept so a test can read what Save filed —
     and, just as importantly, prove nothing was filed at all. */
  const popups = [];
  context.on("page", (pg) => { if (pg !== page) popups.push(pg); });

  await page.goto("file://" + join(dir, which + ".html") + query, { waitUntil: "load" });
  await page.waitForTimeout(settle);
  if (rare) { await page.click("#rareBtn"); await page.waitForTimeout(60); }
  if (help) { await page.click("#helpBtn"); await page.waitForTimeout(60); }

  page.errors = errors;
  page.popups = popups;
  page.ctx = context;
  page.done = async () => { await context.close(); };
  return page;
}

/* A MOUSE CLICK AT THE BUTTON'S OWN COORDINATES, WITHOUT THE SCROLL FIRST.
   Measured, because the difference is not theoretical. Playwright's click()
   scrolls the target into view before pressing, even when it is already fully
   on screen; the console's pinShell() guard answers every scroll by putting the
   document back to 0; the button therefore moves between mousedown and mouseup
   and NO CLICK EVENT IS DISPATCHED. In the short-desk state that made Save look
   dead — submit fired 0 times — while a plain click at the same coordinates
   fired it, and so did Enter on the focused button. So the harness's scroll was
   the whole of the difference, and a test built on it would have been reporting
   its own artefact as a broken Save.

   This presses where the button actually is, after checking it is somewhere a
   person could reach. */
export async function press(page, selector) {
  const box = await page.$eval(selector, (e) => {
    const b = e.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height,
             inView: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth };
  });
  if (!box.w || !box.h) throw new Error(selector + " has no box on the page");
  if (!box.inView) throw new Error(selector + " is not on the screen to be pressed");
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(60);
}

/* Presses one column's Save and answers with the issue URL it opened, or null
   if it opened none. The real window, not a stub over window.open: what is
   being tested is that the office ends up in front of a filled-in issue on the
   right repository, and a stub cannot tell a blocked window from a built URL.
   The wait is bounded so "no issue" is an answer rather than a hang. */
export async function save(page, site, { wait = 900 } = {}) {
  const before = page.popups.length;
  await press(page, `${col(site)} .btn-go`);
  const until = Date.now() + wait;
  while (Date.now() < until && page.popups.length === before) await page.waitForTimeout(50);
  if (page.popups.length === before) return null;
  const pop = page.popups[page.popups.length - 1];
  await pop.waitForLoadState("load").catch(() => {});
  const url = pop.url();
  await pop.close().catch(() => {});
  return url;
}

/* PICKS A RADIO THE WAY A PERSON DOES — by its chip.
   The console hides the radio dot (position:absolute, opacity:0, 1px square)
   because the whole segment lights up instead, so the input itself is a
   one-pixel target. Playwright will still click it, but it first scrolls it
   into view, and the console's pinShell() guard snaps the window back to 0 on
   every scroll — the two race, and the click lands on nothing perhaps one time
   in three. Clicking the label is both more faithful to what the office does
   and the only stable way to do it. */
export async function pick(page, site, name, value) {
  await page.click(`${col(site)} label.choice:has(input[name="${name}"][value="${value}"])`);
  await page.waitForTimeout(60);
}

/* What the screen actually said when it refused. Reading textContent rather
   than asking Playwright whether it is visible is deliberate here: whether the
   note is on screen is a SEPARATE question with its own test, and folding the
   two together is how a styling fault hides behind a behaviour pass. */
export const refusal = (page, site) =>
  page.$eval(id(site, "checkNote"), (e) => (e.hidden ? null : e.textContent));

export const warnings = (page) =>
  page.$$eval("#adminWarn p", (ps) => ps.map((p) => p.textContent));

export const weekRows = (page, site) =>
  page.$$eval(`${id(site, "prevWeek")} .prev-wrow`, (rs) =>
    rs.map((r) => [...r.children].map((c) => c.textContent)));

export const todayPreview = (page, site) =>
  page.$eval(id(site, "prevToday"), (e) => ({
    label: e.querySelector(".l").textContent, hours: e.querySelector(".h").textContent,
  }));

export const basisReads = (page, site) =>
  page.evaluate((s) => ({
    cash: document.getElementById(s + "-basisCash").textContent,
    crop: document.getElementById(s + "-basisNew").textContent,
    cropClass: document.getElementById(s + "-basisNew").className,
  }), site);

/* Every figure printed anywhere in an element, as numbers. Used to ask the
   only question that matters about a readout on this screen: is each of these
   a figure that came from data, or did somebody start doing arithmetic here. */
export const figuresIn = (text) => (String(text).match(/\d+\.\d+/g) || []).map(Number);
