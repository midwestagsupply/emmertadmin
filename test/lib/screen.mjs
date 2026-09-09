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
/* Real settles for the contracts BOARD_ROWS_FULL quotes, read from agsist on
   2026-09-08. They sit a quarter to a half cent away from Big River's own
   quotes on purpose: that gap is the whole reason the Futures column exists. */
export const SETTLES = {
  "corn-sep26": { ticker: "ZCU26.CBT", close: 463.75 },
  "corn-dec26": { ticker: "ZCZ26.CBT", close: 533.5 },
  "corn-mar27": { ticker: "ZCH27.CBT", close: 548.75 },
  "corn-may27": { ticker: "ZCK27.CBT", close: 556.25 },
  "corn-jul27": { ticker: "ZCN27.CBT", close: 559 },
};

export const LAYOUT = {
  CONSOLE:      { width: 1600, height: 1000 },
  CONSOLE_EDGE: { width: 1440, height: 940 },
  SHORT:        { width: 1600, height: 800 },
  SHORT_EDGE:   { width: 1440, height: 939 },
  ROOMY:        { width: 1100, height: 900 },
  ROOMY_EDGE:   { width: 1439, height: 940 },
  /* JESSE'S WINDOW, 2026-09-08. A wide desk that is not a tall one -- the
     shape every preset above skipped, and the one where the editor collapsed
     to 18px. SHORT above is 1600x800, which still left 102px and looked fine. */
  SHORT_DESK:   { width: 1440, height: 700 },
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
/* THE BASIS BOX FOR ONE DELIVERY MONTH, in one elevator's column.
 *
 * These replaced `off` and `offh` -- the cash and new-crop fallback boxes --
 * on 2026-09-08. With a box on every month a global figure was a second place
 * the posted price could come from, and the one nobody could see. Where a test
 * used to reach for `off` it reaches for the nearest delivery's box, and where
 * it used `offh` it reaches for the first new-crop month, because those are the
 * rows each of the two used to govern.
 *
 * They exist only after the board is drawn, which is a fetch: address them
 * through Playwright's auto-waiting selectors rather than $eval on load. */
export const monthBox = (site, month) =>
  `${col(site)} .cell.ctl[data-month="${month}"] input.mbasis`;
export const monthTick = (site, month) =>
  `${col(site)} .cell.pub[data-month="${month}"] input`;
/* The board fixtures lead with August and call October the first new crop. */
export const NEAREST = "August";
export const FIRST_NEW_CROP = "October";

export const named = (site, name) => `${col(site)} [name="${name}"]`;

/* ---- what the four files say, per elevator, by default -------------------
   Deliberately DIFFERENT between the two elevators, because identical
   fixtures cannot tell a column reading its own repository from a column
   reading its neighbour's. Badger runs the zero new-crop spread on purpose —
   that is a live setting, not a test convenience, and it keeps the zero state
   under test on every load. */
/* ONE PRICE LEVEL ACROSS EVERY FIXTURE IN THIS FILE.
   This board and SETTLES were written months apart and never compared: the
   settles put December corn at $5.335 while these rows priced it off a $4.83
   contract, half a dollar apart, and nothing noticed because this board carried
   no futures quote at all and the gap indicator therefore never rendered. Both
   became load-bearing on 2026-09-09, when the Futures column was pointed at the
   quote the sites actually price from -- the first render printed "-4.75c" as
   the distance between Big River and the board, which is not a market, it is
   two fixtures disagreeing.
   So the quote is derived from SETTLES, a quarter cent under, which is where
   Big River really sit; and each row's cash is that quote plus its own basis.
   cash - basis = quote = settle - 0.0025, by construction, in both boards.
   A row with NO quote is a real state -- the site refuses to price that month --
   and it gets its own test rather than being the silent default here. */
const LAG = 0.0025;                                   // Big River, under the settle
const quoteOf = (futuresMonth) => {
  const k = "corn-" + futuresMonth.toLowerCase().replace(" ", "");
  const c = SETTLES[k];
  if (!c) throw new Error("no settle fixture for " + futuresMonth + " (" + k + ")");
  return Math.round((c.close / 100 - LAG) * 10000) / 10000;
};
const board = (rows) => rows.map(({ delivery, futuresMonth, basisDollars }) => {
  const q = quoteOf(futuresMonth);
  return { commodity: "Corn", delivery, futuresMonth, basisDollars,
           cash: Math.round((q + basisDollars) * 10000) / 10000,
           futuresPriceCents: Math.round(q * 10000) / 100 };
});

export const BOARD_ROWS = board([
  { delivery: "August",    futuresMonth: "Sep 26", basisDollars: -0.52 },
  { delivery: "September", futuresMonth: "Sep 26", basisDollars: -0.46 },
  { delivery: "October",   futuresMonth: "Dec 26", basisDollars: -0.55 },
  { delivery: "November",  futuresMonth: "Dec 26", basisDollars: -0.57 },
  { delivery: "December",  futuresMonth: "Dec 26", basisDollars: -0.50 },
  { delivery: "January",   futuresMonth: "Mar 27", basisDollars: -0.60 },
]);
/* THE BOARD AT ITS REAL LENGTH. Big River posts eleven deliveries; the fixture
   above is six, and a layout that holds for six is not a layout that holds.
   Same shape, same numbers as the live file on 2026-09-08, with the contract
   quote each row carries so the basis readout can name it. */
export const BOARD_ROWS_FULL = board([
  { delivery: "September", futuresMonth: "Dec 26", basisDollars: -0.75 },
  { delivery: "October",   futuresMonth: "Dec 26", basisDollars: -0.62 },
  { delivery: "November",  futuresMonth: "Dec 26", basisDollars: -0.55 },
  { delivery: "December",  futuresMonth: "Dec 26", basisDollars: -0.50 },
  { delivery: "January",   futuresMonth: "Mar 27", basisDollars: -0.60 },
  { delivery: "February",  futuresMonth: "Mar 27", basisDollars: -0.58 },
  { delivery: "March",     futuresMonth: "Mar 27", basisDollars: -0.50 },
  { delivery: "April",     futuresMonth: "May 27", basisDollars: -0.54 },
  { delivery: "May",       futuresMonth: "May 27", basisDollars: -0.52 },
  { delivery: "June",      futuresMonth: "Jul 27", basisDollars: -0.52 },
  { delivery: "July",      futuresMonth: "Jul 27", basisDollars: -0.52 },
]);

/* THE MONTHS THE FULL BOARD CARRIES, in board order. A test that wants "some
   months" takes them from here rather than typing a list, so a fixture that
   grows a month does not leave the test asking about one that is not there. */
export const MONTHS_ON_BOARD = BOARD_ROWS_FULL.map((b) => b.delivery);
export const feedFull = (over = {}) => ({
  checkedAt: new Date().toISOString(), status: "ok", bids: BOARD_ROWS_FULL, ...over,
});

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
    /* basis, not spread. The screen sets its own basis against the contract
       month now, and a fixture carrying only a spread put every test that
       touches these boxes in the transition state -- boxes empty, no heading
       sent, Save filing nothing. The zero stays on new crop for the reason
       above it: it keeps the zero state under test on every load, and under
       the new model zero means "even with the contract" rather than "no
       spread", which is a different sentence for the same box. */
    /* updated_at / updated_by ARE NOT DECORATION. The applier stamps every
       file it writes, and the save bar prints "Live on the site - last change
       Sep 4 7:52 AM by midwestagsupply" from them. That sentence is the widest
       thing in the sheet, it sits in the elevator's own grid columns, and with
       max-content tracks it was setting their width -- a 226px checkbox column
       and a board that scrolled sideways on Sig's own screen.
       This fixture carried neither field, so the save bar was three words long
       in every test and eleven window sizes passed against a screen shape that
       does not exist once a site has been saved once. Every site here has been
       saved; the fixture says so now. */
    pricing: { basis: -0.75, basisHarvest: 0, spread: 0.10, spreadHarvest: 0,
               price_note: PRICE_NOTE,
               updated_at: "2026-09-04T12:52:00.000Z", updated_by: "midwestagsupply" },
    bids: { bids: [{ delivery: "August", cashPrice: 4.03 }, { delivery: "September", cashPrice: 4.09 },
                   { delivery: "October", cashPrice: 4.18 }, { delivery: "November", cashPrice: 4.16 }] },
  },
  midwest: {
    hours: { weekday: "7:00a to 6:00p", saturday: null, sunday: null,
             harvest: "7:00a to 7:00p", harvest_mode: false, closed_today: false,
             today_override: null, banner: null, hoursnote: HOURS_NOTE },
    /* No basisHarvest: absent means "same as the cash basis", which is the
       other half of the pair badger's zero covers. */
    pricing: { basis: -0.87, spread: 0.12, price_note: PRICE_NOTE,
               updated_at: "2026-09-08T17:38:49.726Z", updated_by: "midwestagsupply" },
    bids: { bids: [{ delivery: "August", cashPrice: 4.01 }, { delivery: "October", cashPrice: 4.15 }] },
  },
};
/* A deep-ish clone so a test that edits its copy cannot leak into the next
   one. Two tests sharing one mutable fixture is its own quiet bug. */
export const files = (over = {}) => {
  const out = JSON.parse(JSON.stringify(SITE_FILES));
  for (const site of Object.keys(over || {}))
    for (const k of Object.keys(over[site] || {}))
      out[site][k] = over[site][k] === null ? null
        : over[site][k][ONLY] ? { ...over[site][k], [ONLY]: undefined }
        : { ...out[site][k], ...over[site][k] };
  return out;
};
/* files() MERGES OVER THE FIXTURE, which is what nearly every test wants: say
   the one field you care about and let the rest stay realistic. It is the wrong
   tool for testing what a site MISSING a field does, because the fixture's
   field survives the merge and the test quietly exercises the ordinary path.
   Wrap the body in only() to say "this file is exactly this and nothing else".
       sites: files({ midwest: only({ spread: 0.1 }) })   // no basis at all */
const ONLY = Symbol("only");
export const only = (body) => ({ ...body, [ONLY]: true });

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
     tab       name a rail section to open it for real; omitted, every card
               is shown at once, which is what nearly every test wants.
     rare      open the "Weekly hours & small print" panels, which the console
               folds away by default
     help      press the ? key on
     settle    how long to wait for the four reads to land
*/
export async function openScreen(browser, dir, opts = {}) {
  const {
    page: which = "live", query = "", viewport = LAYOUT.CONSOLE,
    feed = feedNow(), sites = files(), rare = false, help = false, settle = 500,
    tab = null,
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
  /* THE CBOT SETTLES, from agsist. The catch-all above aborts everything it
     does not route, so without this the Futures column is an em dash in every
     test -- which renders "we could not read the settle" and cannot be told
     apart from "there is no gap between their quote and the contract". */
  await context.route("**/agsist/main/data/prices.json*", (r) =>
    r.fulfill(json(opts.settles === undefined ? SETTLES : opts.settles)));
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
  /* THE TABS, AND WHY THE DEFAULT IS "ALL OF THEM".
   *
   * The rail slices the screen into four jobs and shows one at a time, so a
   * card that is not in the current tab is display:none. That is right for a
   * person and wrong for most of these tests, which are not about navigation
   * at all -- they are about what the form holds, what the previews say and
   * what Save files, and every one of those is true regardless of which tab
   * happens to be up. Making two hundred tests each name a tab would be two
   * hundred chances to name the wrong one.
   *
   * So the harness clears body[data-tab] by default, which the stylesheet
   * reads as "show every card", and the tab behaviour is tested where it
   * belongs -- in the tests that are about the rail.
   *
   * This is deliberately NOT done by hiding the rail or stubbing it out: the
   * rail still runs, still wires its buttons, and a test that wants a tab
   * asks for one by name and gets the real thing. */
  if (tab) {
    await page.click(`.rail-b[data-go="${tab}"]`);
    await page.waitForTimeout(80);
  } else {
    /* SHOW BOTH SCREENS AT ONCE. This used to remove data-tab altogether, which
       worked while the tabs only hid cards. The sheet is placed per screen -- a
       row that is not on the screen showing gets no row of its own -- so "no
       tab" has to be a real state the layout knows about rather than the
       absence of one. `all` lays the basis rows out and then the hours rows
       under them, which is what a test that wants to reach every control needs. */
    await page.evaluate(() => {
      document.body.setAttribute("data-tab", "all");
      if (window.__layout) window.__layout();
    });
    await page.waitForTimeout(80);
  }
  /* `rare` WAS A FOLD, AND THERE IS NOTHING FOLDED ANY MORE. The weekly hours
     and the small print were two cards low in a scrolling column; they are four
     rows of a table now, on screen with everything else. Kept as an accepted
     option so the tests that ask for it still read, and so the reason is here
     rather than in a diff. */
  void rare;
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
  /* MEASURE, THEN LET IT SETTLE, THEN CLICK.
     This used to click at the coordinates measured on the line above, and that
     is a race it lost. An input event on this screen reflows for about thirty
     milliseconds -- a warning bar is inserted, the sticky save bar recomputes
     -- and during that window the button reports a box 40px above where it
     settles. Measured on origin/main and on this build: the same transient on
     both, and `press` clicking inside it sent the pointer 40px under the
     button, which the suite reported as "Save opened nothing".
     A person cannot hit that window; they take a quarter of a second to move a
     mouse. The helper could, because it measured and clicked in the same tick.
     The two assertions above are the point of this helper and they stay: the
     button has a real box, and it is on screen where somebody could reach it.
     What changes is that the box is measured a second time, after the reflow
     has settled, and the pointer goes to where the button actually is. Still a
     real mouse click at real coordinates -- the same mechanism, aimed after
     the page has stopped moving, which is what a person does. Playwright's own
     click() was tried first and failed six other tests, so this stays as close
     to the original as the race allows. */
  await page.waitForTimeout(80);
  const at = await page.$eval(selector, (e) => {
    const b = e.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(at.x, at.y);
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

/* ONE MONTH'S ROW, read off the rendered screen.
 *
 * This replaces basisReads(), which read two standing paragraphs -- a cash
 * basis readout and a new-crop one -- that the screen no longer has. There are
 * no longer two basis figures on this screen with a sentence under each; there
 * are eleven rows, and each carries its own box, its own note saying how far
 * off Big River that box is, and the figure the elevator's site is publishing
 * for that month right now.
 *
 *   basis   what is in the box (what WE would set)
 *   vs      the note beside it: "0.20 over them" / "even with them" / ""
 *   posted  the figure the site is publishing for that month, or "" if none
 *   tick    whether the month is set to show on the site
 *   missing true when the board has no such month, so a test can say so rather
 *           than fail on a null dereference three lines later
 */
export const monthRow = (page, site, month) =>
  page.evaluate(([s, m]) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    const at = (sel) => c && c.querySelector(sel + '[data-month="' + m + '"]');
    const ctl = at(".cell.ctl"), pub = at(".cell.pub"), pay = at(".cell.pay");
    if (!ctl) return { missing: true, basis: "", posted: "", tick: false };
    const box = ctl.querySelector("input");
    return {
      missing: false,
      basis: box ? box.value : "",
      posted: pay ? pay.textContent.trim() : "",
      tick: !!(pub && pub.querySelector("input") && pub.querySelector("input").checked),
    };
  }, [site, month]);

/* Every month on one elevator, in board order: { October: {...}, ... } */
export const monthRows = (page, site) =>
  page.evaluate((s) => {
    const c = document.querySelector('.col[data-elev="' + s + '"]');
    const out = {};
    for (const ctl of c ? c.querySelectorAll(".cell.ctl[data-month]") : []) {
      const m = ctl.getAttribute("data-month");
      const pub = c.querySelector('.cell.pub[data-month="' + m + '"]');
      const pay = c.querySelector('.cell.pay[data-month="' + m + '"]');
      const box = ctl.querySelector("input");
      out[m] = { basis: box ? box.value : "",
                 posted: pay ? pay.textContent.trim() : "",
                 tick: !!(pub && pub.querySelector("input") && pub.querySelector("input").checked) };
    }
    return out;
  }, site);

/* Every figure printed anywhere in an element, as numbers. Used to ask the
   only question that matters about a readout on this screen: is each of these
   a figure that came from data, or did somebody start doing arithmetic here. */
export const figuresIn = (text) => (String(text).match(/\d+\.\d+/g) || []).map(Number);
