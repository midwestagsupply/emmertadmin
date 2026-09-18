/* A SECOND WAY TO THE NUMBER THAT COSTS NO EXTRA REQUEST.
 *
 * cash - basis = futures is already the guard that proves a figure came out of
 * the right column. Read the other way round it is arithmetic, so a row with
 * one unreadable column and two good ones is derivable rather than lost.
 *
 * These pin the five rules in lib/reconstruct.mjs, and they pin them against
 * the REAL capture of their board with one column blanked out, not against
 * rows written here -- the whole question is what their page does when one of
 * its cells fails to render, and a hand-built row cannot answer it.
 *
 * WHAT MATTERS MOST HERE is the third test in the file. Reconstruction is the
 * one thing in this repository that puts a number in front of a grower that
 * their board did not print, so the rules that STOP it are worth more than the
 * rule that starts it:
 *
 *   - two columns gone is still a refusal
 *   - a board whose untouched rows do not balance reconstructs nothing
 *   - a derived figure still faces the band and the max-move rail
 *   - a board that proves nothing about its own columns needs the rail to
 *     have something to check
 *   - and every derived figure is marked, in the file and in the log
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { run } from "../scripts/read.mjs";
import { routesFor } from "../lib/routes.mjs";
import { reconstructRows, brokenColumns, untouchedRowsBalance } from "../lib/reconstruct.mjs";
import { extractBids } from "../lib/parse.mjs";
import { buildFile } from "../lib/board.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = JSON.parse(readFileSync(join(ROOT, "sources/boyceville.json"), "utf8"));
const BOARD = readFileSync(join(ROOT, "fixtures/bigriver-2121.html"), "utf8");
const PRIMARY = routesFor(SOURCE)[0].url;

/* Blank one column of the panel keyed 2121 and leave every other location on
   their page exactly as it is. That is what one cell failing to render looks
   like: the rest of the page is fine. */
const blank = (html, cls) => html.replace(
  new RegExp(`(<ul class='sixColumnsBigFirst fcControls[12]'><li class='c1'>` +
             `(?:(?!<\\/ul>).)*?CashBidsLocationID=2121(?:(?!<\\/ul>).)*?` +
             `<li class='${cls}'>)[^<]*(<\\/li>)`, "g"), "$1$2");

const CASH_GONE    = blank(BOARD, "c2");
const BASIS_GONE   = blank(BOARD, "c3");
const FUTURES_GONE = blank(BOARD, "c4");
const TWO_GONE     = blank(blank(BOARD, "c2"), "c4");

/* Their real numbers, off the unmodified fixture, so a reconstructed figure is
   checked against what their board actually said rather than against itself. */
const TRUE_ROWS = buildFile(BOARD, { now: new Date("2026-09-18T12:00:00Z"),
                                     sourceUrl: PRIMARY, source: SOURCE }).file.bids;

const ok = (html) => ({ ok: true, status: 200, text: async () => html });
const serve = (html) => async () => (html === null ? { ok: false, status: 503, text: async () => "" }
                                                  : ok(html));

function scratch({ seedFeed = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "recon-"));
  const feedPath = join(dir, "boyceville.json");
  const indexPath = join(dir, "index.json");
  return { dir, feedPath, indexPath, seedFeed };
}

const pass = (paths, html, extra = {}) =>
  run({ now: new Date("2026-09-18T12:10:00Z"), fetchImpl: serve(html), log: () => {},
        wait: async () => {}, headStartMs: 30,
        feedPath: paths.feedPath, indexPath: paths.indexPath, dataDir: paths.dir, ...extra });

/* A last committed read to compare against, taken from their own board so the
   max-move rail has something real to check a derived figure against. */
async function seeded() {
  const paths = scratch();
  await run({ now: new Date("2026-09-18T12:00:00Z"), fetchImpl: serve(BOARD),
              log: () => {}, wait: async () => {}, headStartMs: 30,
              feedPath: paths.feedPath, indexPath: paths.indexPath, dataDir: paths.dir });
  return paths;
}

/* ── the thing it is for ────────────────────────────────────────────────── */

test("their Bid column blank: every row is derived from their own basis and quote", async () => {
  const paths = await seeded();
  const r = await pass(paths, CASH_GONE);

  assert.ok(r.file, "a board whose basis and futures both parsed was refused outright");
  assert.equal(r.file.count, 7);
  assert.equal(r.marks.length, 7, "not every unreadable row was reconstructed");

  /* THE NUMBERS ARE THEIRS. Checked against the same fixture with nothing
     blanked, so this is not the arithmetic checking itself. */
  const want = new Map(TRUE_ROWS.map((b) => [b.delivery, b.cash]));
  for (const b of r.file.bids)
    assert.equal(b.cash, want.get(b.delivery),
      `${b.delivery} was reconstructed as ${b.cash} and their board says ${want.get(b.delivery)}`);
});

test("the same works for a blank Basis column and for a blank Futures column", async () => {
  for (const [name, html, field, read] of [
    ["Basis", BASIS_GONE, "basis", (b) => b.basisDollars],
    ["Futures", FUTURES_GONE, "futures", (b) => b.futuresPriceCents],
  ]) {
    const paths = await seeded();
    const r = await pass(paths, html);
    assert.ok(r.file, `a board with a blank ${name} column was refused outright`);
    assert.equal(r.marks.length, 7, `${name}: not every row was reconstructed`);
    const want = new Map(TRUE_ROWS.map((b) => [b.delivery, read(b)]));
    for (const b of r.file.bids)
      assert.equal(read(b), want.get(b.delivery),
        `${name} ${b.delivery}: derived ${read(b)}, their board says ${want.get(b.delivery)}`);
    for (const b of r.file.bids)
      assert.equal(b.reconstructed, field);
  }
});

test("a hole that does NOT refuse the board is filled too, not published as a dash", async () => {
  /* The case that is easiest to miss. One blank Basis cell refuses nothing:
     the identity check skips the row, six others balance, and the board
     publishes with basisDollars and basisCents null on that row. The sites
     print a dash for it -- a number lost in silence, on a page whose other two
     columns say exactly what it was. */
  const paths = await seeded();
  const oneHole = BOARD.replace("<li class='c3'>-0.5200</li>", "<li class='c3'></li>");
  const r = await pass(paths, oneHole);

  assert.ok(r.file, "a board with one blank basis cell was refused");
  assert.equal(r.marks.length, 1);
  const august = r.file.bids.find((b) => b.delivery === "August");
  assert.equal(august.basisDollars, -0.52, "their own basis was not recovered");
  assert.equal(august.basisCents, -52);
  assert.equal(august.reconstructed, "basis");
  for (const b of r.file.bids) {
    assert.notEqual(b.basisDollars, null, `${b.delivery} published with a null basis`);
    assert.notEqual(b.basisCents, null, `${b.delivery} published with a null basisCents`);
  }
});

test("a blank Futures cell on one row is filled rather than published as null", async () => {
  const paths = await seeded();
  const oneHole = BOARD.replace("<li class='c4'>484-0</li>", "<li class='c4'></li>");
  const r = await pass(paths, oneHole);
  assert.ok(r.file);
  assert.equal(r.marks.length, 1);
  const row = r.file.bids.find((b) => b.reconstructed === "futures");
  assert.ok(row, "the row with the blank quote was published unmarked");
  assert.equal(row.futuresPriceCents, 484);
  for (const b of r.file.bids)
    assert.notEqual(b.futuresPriceCents, null, `${b.delivery} published with a null quote`);
});

/* ── THE RULES THAT STOP IT, WHICH ARE THE ONES THAT MATTER ─────────────── */

test("two columns gone is still a refusal, and it says why per row", async () => {
  const paths = await seeded();
  const held = readFileSync(paths.feedPath, "utf8");
  const before = JSON.parse(readFileSync(paths.indexPath, "utf8")).sources[0].checkedAt;

  const lines = [];
  const r = await pass(paths, TWO_GONE, { log: (l) => lines.push(String(l)) });

  assert.equal(r.file, null, "a row with two unknowns and one equation was published");
  assert.equal(r.wroteFeed, false);
  assert.equal(readFileSync(paths.feedPath, "utf8"), held,
    "the last good file was not held byte for byte");
  assert.equal(r.index.sources[0].checkedAt, before, "checkedAt advanced on a refusal");
  assert.ok(lines.some((l) => /two unknowns and one equation/.test(l)),
    "the log does not say why the row was not reconstructed");
});

test("a board whose untouched rows do not balance reconstructs nothing", async () => {
  /* THE RULE THAT STOPS THIS FROM SOFTENING THE IDENTITY GUARD. A reconstructed
     row satisfies cash - basis = futures by construction, so it proves nothing
     about that row's columns -- the untouched rows are the whole proof. Here
     one untouched row is moved a dime off its own quote while another row's
     Bid cell is blank. The blank row is derivable in isolation and must not be
     derived, because the board it sits on is not proven. */
  const paths = await seeded();
  const doubt = blank(BOARD, "c2")                       // every cash cell blank...
    .replace("<li class='c2'></li><li class='c3'>-0.4600</li>",  // ...except September's
             "<li class='c2'>4.2350</li><li class='c3'>-0.4600</li>");
  const r = await pass(paths, doubt);

  assert.equal(r.file, null,
    "a blank column was filled in on a board whose one testable row disagrees with its "
  + "own quote, so the columns were never proven and the arithmetic proved itself");
  assert.equal(r.marks?.length ?? 0, 0);
});

test("a derived figure still faces the max-move rail", async () => {
  /* Their futures cell glitches a dollar and their Bid cell is blank, so the
     derived cash is a dollar over the market and internally consistent with
     everything on the page. The identity cannot see it -- it is satisfied by
     construction -- and the band cannot either. The rail is what is left, and
     it has to hold. */
  const paths = await seeded();
  const held = readFileSync(paths.feedPath, "utf8");
  const glitched = blank(BOARD, "c2").replace("<li class='c4'>459-4</li>",
                                              "<li class='c4'>559-4</li>");
  const r = await pass(paths, glitched);

  assert.equal(r.file, null, "a derived cash a dollar over the market was published");
  assert.match(r.failure.message, /moved more than/);
  assert.equal(readFileSync(paths.feedPath, "utf8"), held);
});

test("a derived figure still faces the price band", async () => {
  /* Their futures quote reads as a tenth of what it is, so the derived cash
     lands under the 2.00 floor. Every row is out, which board.mjs reads as the
     wrong band rather than bad prices -- so the commodity is withheld and there
     is nothing publishable left. Either way nothing reaches the file. */
  const paths = await seeded();
  const low = blank(BOARD, "c2")
    .replace(/<li class='c4'>459-4<\/li>/g, "<li class='c4'>45-7</li>")
    .replace(/<li class='c4'>484-0<\/li>/g, "<li class='c4'>48-4</li>")
    .replace(/<li class='c4'>499-6<\/li>/g, "<li class='c4'>49-7</li>");
  const r = await pass(paths, low);
  assert.equal(r.file, null, "a derived cash outside the sanity band was published");
  /* And the refusal says the derived board was the thing that failed, not only
     that their columns could not be checked -- otherwise it sends a reader to
     look at the parser. */
  assert.match(String(r.index.sources[0].detail),
    /row\(s\) could be derived from cash - basis = futures, and the derived board was refused too/,
    "the refusal does not say that a reconstruction was tried and then rejected");
});

test("a board that proves nothing about its own columns needs the rail to have something to check", async () => {
  /* Rule 5. Their whole Bid column is blank, so not one row balanced on its
     own and the derived figures have only the band and the rail behind them.
     With no previous committed read there is nothing for the rail to check, so
     there is nothing standing behind the arithmetic at all. */
  const paths = scratch();                       // no seeded feed: a first-ever read
  const r = await pass(paths, CASH_GONE);

  assert.equal(r.file, null,
    "a whole column was reconstructed on a first-ever read, with no previous reading "
  + "for the max-move rail to check a single derived figure against");
  assert.match(String(r.index.sources[0].detail), /NOT ONE row on this board balanced/,
    "the refusal does not say that nothing was standing behind the arithmetic");
  assert.match(String(r.index.sources[0].detail), /no reconstructed row has a previous committed reading/,
    "the refusal does not say that the rail had nothing to check");
});

test("a board that CAN prove its own columns reconstructs without needing the rail", async () => {
  /* The other side of rule 5. One row's Bid cell is blank and the other six
     balance exactly, so the columns are proven by rows nothing touched -- and a
     first-ever read may then fill the one blank. */
  const paths = scratch();
  const one = BOARD.replace("<li class='c2'>4.0750</li>", "<li class='c2'></li>");
  const r = await pass(paths, one);
  assert.ok(r.file, "six rows balancing exactly did not prove the columns for the seventh");
  assert.equal(r.marks.length, 1);
  assert.equal(r.marks[0].delivery, "August");
  assert.equal(r.file.bids.find((b) => b.delivery === "August").cash, 4.075);
});

/* ── IT IS NEVER SILENT ─────────────────────────────────────────────────── */

test("every derived figure is marked in the published file, in the index and in the log", async () => {
  const paths = await seeded();
  const lines = [];
  const r = await pass(paths, CASH_GONE, { log: (l) => lines.push(String(l)) });

  /* In the file, on the row, because the row is what travels to the sites. */
  const onDisk = JSON.parse(readFileSync(paths.feedPath, "utf8"));
  assert.equal(onDisk.bids.length, 7);
  for (const b of onDisk.bids)
    assert.equal(b.reconstructed, "cash",
      `${b.delivery} is published with a derived cash and no mark on it`);

  /* In data/index.json, which is the file the health of this feed is read off. */
  const row = r.index.sources[0];
  assert.equal(row.reconstructed.length, 7);
  assert.deepEqual([...new Set(row.reconstructed.map((x) => x.field))], ["cash"]);
  for (const x of row.reconstructed) {
    assert.ok(x.delivery && x.commodity, "a reconstructed row is not named");
    assert.match(x.why, /did not parse/, "it does not say what was wrong with their cell");
  }

  /* And in the log, one line per row, with the number and the reason. */
  const said = lines.filter((l) => /RECONSTRUCTED:/.test(l));
  assert.equal(said.length, 7, "the log does not name every derived figure");
  assert.match(said[0], /August Corn: cash reconstructed as 4\.075 because/);
});

test("an ordinary board is published with no mark anywhere and no second build", async () => {
  /* Reconstruction is a second attempt at a board this repository has already
     refused. A board that builds cleanly must never go near it. */
  const paths = await seeded();
  const r = await pass(paths, BOARD);
  assert.ok(r.file);
  assert.equal(r.marks.length, 0);
  for (const b of r.file.bids)
    assert.equal(b.reconstructed, undefined,
      `${b.delivery} carries a reconstruction mark on a board that read perfectly`);
  assert.deepEqual(r.index.sources[0].reconstructed, []);
});

test("the mark stays out of the way of what the sites already read", async () => {
  /* The two Emmert sites read cash, basisCents and futuresPriceCents off each
     row. A new key beside them must not disturb those, and a row that was not
     reconstructed must not grow one. */
  const paths = await seeded();
  const r = await pass(paths, BASIS_GONE);
  for (const b of r.file.bids) {
    assert.equal(typeof b.cash, "number");
    assert.equal(typeof b.basisCents, "number");
    assert.equal(typeof b.futuresPriceCents, "number");
    assert.equal(b.basisCents, Math.round((b.cash * 100 - b.futuresPriceCents) * 10000) / 10000,
      `${b.delivery}: basisCents does not agree with its own cash and quote`);
  }
});

/* ── the rules, on their own, where the board cannot reach every case ───── */

test("brokenColumns names what is unreadable and nothing else", () => {
  const rows = extractBids(BOARD, PRIMARY).filter((b) => String(b.locationId) === "2121");
  assert.deepEqual(brokenColumns(rows[0], SOURCE), [],
    "a row off their real board was called broken");

  assert.deepEqual(brokenColumns({ ...rows[0], cash: null }, SOURCE).map((b) => b.field), ["cash"]);
  assert.deepEqual(brokenColumns({ ...rows[0], basis: null }, SOURCE).map((b) => b.field), ["basis"]);
  assert.deepEqual(brokenColumns({ ...rows[0], futuresPrice: null }, SOURCE).map((b) => b.field),
                   ["futures"]);

  /* Out of its own band is a broken cash cell, not a price. */
  assert.deepEqual(brokenColumns({ ...rows[0], cash: 41.35 }, SOURCE).map((b) => b.field), ["cash"]);

  /* A zero quote is left to board.mjs's zero-quote doctrine when the row is
     self-consistent, and named when it cannot be. */
  assert.deepEqual(brokenColumns({ ...rows[0], cash: -0.3075, basis: -0.3075, futuresPrice: 0 },
                                 SOURCE).map((b) => b.field), ["cash"],
    "an expired zero-quote row should be refused on its cash, not given a derived quote");
});

test("reconstructRows refuses to touch a board whose untouched rows do not balance", () => {
  const rows = extractBids(BOARD, PRIMARY);
  const mine = (b) => String(b.locationId) === "2121";
  /* One row blank, one row a dime off its own quote. */
  const hurt = rows.map((b) => {
    if (!mine(b)) return b;
    if (b.delivery === "August") return { ...b, cash: null };
    if (b.delivery === "September") return { ...b, cash: 4.235 };
    return b;
  });
  const r = reconstructRows(hurt, SOURCE);
  assert.equal(r.marks.length, 0, "a blank was filled in on an unproven board");
  assert.equal(r.rows, hurt, "the rows were copied although nothing was done to them");
  assert.match(r.held[0].why, /do not balance/);
});

test("untouchedRowsBalance counts what was actually testable", () => {
  const rows = extractBids(BOARD, PRIMARY).filter((b) => String(b.locationId) === "2121");
  const all = untouchedRowsBalance(rows, SOURCE);
  assert.equal(all.balanced, true);
  assert.equal(all.tested, 7, "their real board has seven testable rows");

  const blind = untouchedRowsBalance(rows.map((b) => ({ ...b, cash: null })), SOURCE);
  assert.equal(blind.balanced, true, "a board with nothing to test cannot fail the check");
  assert.equal(blind.tested, 0,
    "a board with nothing to test must report that it proved nothing");
});
