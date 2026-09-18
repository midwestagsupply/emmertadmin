/* A SECOND WAY TO THE NUMBER THAT COSTS NO EXTRA REQUEST.
 * ==========================================================================
 *
 * Their board publishes three things per row and the three agree:
 *
 *     cash - basis = futures        (cash and basis in dollars, futures in cents)
 *
 * That identity is already the guard that proves a figure came out of the
 * right column -- lib/parse.mjs checkIdentity, and the verdict in
 * lib/board.mjs. Read the other way round it is also arithmetic: given any two
 * of the three, the third is DERIVABLE. So a row whose Bid cell failed to
 * render, on a page whose Basis and Futures cells rendered perfectly well, is
 * not a lost row. It is a row we can still answer, out of their own numbers.
 *
 * Before this, a blank Bid column refused the whole board and both sites
 * started their four-hour walk toward "Call for today's price" with the price
 * sitting on the page in two of its three forms -- and a blank BASIS cell,
 * which refuses nothing, published a row with null in that field and printed a
 * dash on a grower's screen instead. Both are the same loss.
 *
 * scripts/read.mjs asks for this in exactly two cases: a board that refused,
 * and a board that built with a hole in a published row. A board that built
 * cleanly and printed every figure never comes here at all.
 *
 * WHY IT LIVES HERE AND NOT IN lib/board.mjs. board.mjs, parse.mjs and
 * currency.mjs are a byte-for-byte fork of dnilgis/bids, hash-pinned by
 * test/fork.test.mjs. This hangs off the hook buildFile already offers -- its
 * `extract` argument, the platform adapter -- so the rows are repaired on the
 * way in and then go through every guard in board.mjs unchanged and unedited.
 * Nothing here re-implements a check that exists there; checkIdentity,
 * bandFor, futuresScale and filterLocation are imported and used as they are.
 *
 * THE FIVE RULES. Every one of them narrows what may be reconstructed; not one
 * of them widens what may be published.
 *
 *  1. EXACTLY ONE of the three may be missing. Two missing is two unknowns and
 *     one equation, and the row is refused exactly as it is today.
 *
 *  2. THE OTHER TWO HAVE TO BE SANE. A cash figure outside its own commodity's
 *     band is not a value to derive a basis from.
 *
 *  3. EVERY ROW THIS DOES NOT TOUCH, AND WHICH COULD BE TESTED AT ALL, HAS TO
 *     HAVE BALANCED EXACTLY. This is the rule that stops reconstruction from
 *     softening the identity guard, and it is the one worth reading twice. A
 *     reconstructed row satisfies cash - basis = futures BY CONSTRUCTION: it
 *     is arithmetic, not evidence, and it proves nothing about that row's
 *     columns. Board.mjs decides whether a board's columns are trustworthy by
 *     asking whether the failures are a minority of the TESTABLE rows -- so
 *     filling blanks would pad that denominator with rows that can never fail,
 *     and a board that should have refused as "unproven" could publish. So:
 *     if any row that was testable on its own disagrees with its own quote,
 *     nothing is reconstructed and the board takes whatever verdict it had.
 *     The columns are proven by the untouched rows or not at all.
 *
 *  4. A RECONSTRUCTED VALUE STILL FACES EVERY GUARD. It goes into the rows
 *     buildFile is about to check, so it faces the price band, the row
 *     reconciliation, the basis-units check and the location filter there, and
 *     the max-move rail in scripts/read.mjs after. A derived number that
 *     lands outside the band, or a dollar away from the last committed read,
 *     refuses the board like any other bad number.
 *
 *  5. A BOARD THAT PROVES NOTHING ABOUT ITS OWN COLUMNS NEEDS THE RAIL. When
 *     the broken column is broken on EVERY row -- their whole Bid column blank
 *     -- there is no untouched row left to balance, so rule 3 is satisfied
 *     vacuously and the derived figures have only the band and the max-move
 *     rail behind them. scripts/read.mjs then requires the rail to have
 *     something to check: at least one reconstructed row must have a previous
 *     committed reading to be compared against. `provenBy` in the return value
 *     is how that is asked. A first-ever read cannot reconstruct a whole
 *     column, which is correct: nothing would be checking it.
 *
 *  6. IT IS NEVER SILENT. Every repaired row is returned in `marks`, written
 *     into the published row as `reconstructed`, listed in data/index.json and
 *     named in the log. A derived number that looks exactly like a read one is
 *     the thing this must never become.
 *
 * WHAT IS DELIBERATELY NOT RECONSTRUCTED.
 *
 * A futures quote of ZERO. board.mjs treats a zero quote as a missing one on
 * purpose -- an expired contract still on their board makes cash equal its own
 * basis and turns the identity check into 0 == 0. Deriving a quote for such a
 * row would put a number where that doctrine wants a hole, and on the real
 * case it was written for the derived answer is zero again anyway, because
 * cash and basis are the same figure. Left alone.
 *
 * A BASIS THAT PARSED BUT LOOKS ODD. There is no independent sanity range for
 * a basis in this codebase -- cash has a band, futures has the band by
 * implication, a basis on its own has neither -- so "fails its own sanity
 * check" is only ever "did not parse" for that column. Saying otherwise would
 * mean inventing a range.
 */
import { checkIdentity, extractBids, normLocationId } from "./parse.mjs";
import { bandFor, explainedByRounding, futuresScale, rowKey } from "./board.mjs";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round4 = (v) => Number(v.toFixed(4));

/* Which of the three this row cannot answer for itself, and why.
 *
 * `scale` is what board.mjs's scaleFutures will multiply futuresPrice by, so
 * the identity has to be read in those units here too -- the rows at this
 * point are still unscaled. */
export function brokenColumns(row, source, scale = 1) {
  const bad = [];
  const cash = num(row.cash), basis = num(row.basis), fut = num(row.futuresPrice);

  if (cash == null) bad.push({ field: "cash", why: "their Bid cell did not parse" });
  else {
    const band = bandFor(source, row.commodity, [row]);
    if (band && (cash < band.floor || cash > band.ceiling))
      bad.push({ field: "cash",
                 why: `their Bid cell reads ${cash}, outside the ${band.floor} to `
                    + `${band.ceiling} ${band.named} band` });
  }

  if (basis == null) bad.push({ field: "basis", why: "their Basis cell did not parse" });

  /* Zero is left to board.mjs's zero-quote doctrine, on purpose. See above. */
  if (fut == null) bad.push({ field: "futures", why: "their Futures cell did not parse" });
  else if (fut * scale === 0 && cash != null && basis != null && cash !== basis)
    bad.push({ field: "futures",
               why: `their Futures cell reads zero beside a cash of ${cash} and a basis `
                  + `of ${basis}, which cannot both be true` });

  return bad;
}

/* The third value, out of the other two. Nothing here rounds away a real
   difference: four decimals is well past an eighth of a cent and well short of
   float noise, which is the same figure board.mjs's scaleFutures uses. */
function derive(row, field, scale) {
  const cash = num(row.cash), basis = num(row.basis);
  const fut = num(row.futuresPrice) == null ? null : num(row.futuresPrice) * scale;

  if (field === "cash") return { cash: round4(basis + fut / 100) };
  if (field === "basis") return { basis: round4(cash - fut / 100),
                                  basisCents: round4(cash * 100 - fut) };
  /* Written back in the units the row is still in, because scaleFutures has
     not run yet and will multiply this by `scale` in a moment. */
  return { futuresPrice: round4(((cash - basis) * 100) / scale) };
}

/* Did every row that could be tested on its own balance? Rule 3.
 *
 * Asked of the rows as they parsed, before anything is repaired, and through
 * the same two functions board.mjs uses -- checkIdentity for the arithmetic,
 * explainedByRounding for a source that declares its cash cell is rounded. */
export function untouchedRowsBalance(rows, source, scale = 1) {
  const scaled = rows.map((r) => (typeof r.futuresPrice === "number"
    ? { ...r, futuresPrice: round4(r.futuresPrice * scale) } : r));
  const tol = Number(source.cashRoundingCents ?? 0);
  const off = explainedByRounding(source, checkIdentity(scaled), tol);
  const tested = scaled.filter((r) => num(r.cash) != null && num(r.basis) != null
                                   && num(r.futuresPrice) != null).length;
  return { balanced: off.length === 0, off, tested };
}

/* THE WHOLE THING, over one board's worth of rows.
 *
 * Returns the rows to hand to buildFile, a mark per repaired row, a note per
 * row it would not touch, and `provenBy`: how many rows balanced the identity
 * on their own, with nothing reconstructed. That last number is what
 * scripts/read.mjs needs -- a board where it is zero has proven nothing about
 * its own columns and the derived figures have only the band and the max-move
 * rail standing behind them.
 *
 * When nothing can be repaired it returns the rows it was given, unchanged and
 * uncopied, so a caller can tell "nothing to do" from "something was done"
 * without comparing boards. */
export function reconstructRows(rows, source) {
  const scale = futuresScale(source);
  const want = normLocationId(source.locationId);
  const mine = (r) => normLocationId(r.locationId) === want;
  const ours = rows.filter(mine);
  const none = (held = []) => ({ rows, marks: [], held, provenBy: 0 });
  if (!ours.length) return none();

  /* What each row would need, one row at a time. Nothing is applied yet: rule
     3 is asked of the rows this plan does NOT touch, so the plan has to exist
     before it can be checked. */
  const plan = new Map();
  const held = [];
  for (const r of ours) {
    const bad = brokenColumns(r, source, scale);
    if (!bad.length) continue;
    if (bad.length > 1) {
      held.push({ delivery: r.delivery, commodity: r.commodity,
        why: `${bad.length} of the three are unreadable (${bad.map((b) => b.field).join(", ")}); `
           + `two unknowns and one equation is not a reconstruction` });
      continue;
    }
    const only = bad[0];
    /* The two that are left have to BE there, or there is nothing to derive
       from. A cash outside its band sits here too: it is broken, and it is
       also still a number, so a row with an out-of-band cash and no futures
       quote has two unknowns and is refused above. */
    const present = { cash: num(r.cash), basis: num(r.basis), futures: num(r.futuresPrice) };
    const rest = ["cash", "basis", "futures"].filter((f) => f !== only.field);
    if (rest.some((f) => present[f] == null)) {
      held.push({ delivery: r.delivery, commodity: r.commodity,
        why: `${only.field} is unreadable and so is one of the other two` });
      continue;
    }
    const patch = derive(r, only.field, scale);
    const key = only.field === "futures" ? "futuresPrice" : only.field;
    const was = num(r[key]);
    /* NOTHING TO RECONSTRUCT. A cash cell outside its band whose own basis and
       futures agree with it is not a reading we can improve on -- the other
       two say the same number. Their board is telling us something we do not
       like, and the band is the guard for that, not this. */
    if (was != null && Math.abs(was - patch[key]) < 1e-9) {
      held.push({ delivery: r.delivery, commodity: r.commodity,
        why: `${only.why}, and the other two columns derive the same number, so there `
           + `is nothing here to reconstruct` });
      continue;
    }
    plan.set(r, { field: only.field, why: only.why, patch, key, value: patch[key] });
  }

  if (!plan.size) return none(held);

  /* RULE 3. Every row this plan does NOT touch, and which could be tested at
     all, has to balance exactly. Those rows are the only thing that proves
     this board's columns are in the right order; a reconstructed row proves
     nothing, because its identity holds by construction. */
  const untouched = ours.filter((r) => !plan.has(r));
  const { balanced, off, tested } = untouchedRowsBalance(untouched, source, scale);
  if (!balanced)
    return none([{ why:
      `${off.length} row(s) that needed no reconstruction do not balance against their `
    + `own quote (worst ${off.reduce((w, r) => Math.max(w, Math.abs(r.offCents)), 0)}c), so `
    + `this board's columns are not proven and nothing here may fill in a blank` }]);

  const marks = [];
  const out = rows.map((r) => {
    const p = plan.get(r);
    if (!p) return r;
    marks.push({ key: rowKey(r), delivery: r.delivery, commodity: r.commodity,
                 field: p.field, why: p.why, value: p.value });
    return { ...r, ...p.patch };
  });

  return { rows: out, marks, held, provenBy: tested };
}

/* buildFile's `extract` argument, wrapped.
 *
 * buildFile(html, { extract }) calls this instead of extractBids, so the
 * repair happens on the rows on their way in and every guard in board.mjs then
 * runs on them unchanged. The marks are collected on the returned object
 * because buildFile cannot hand anything back that it does not already know
 * about, and editing it to would break the fork's hash pin. */
export function reconstructingExtract(source, { extract = extractBids } = {}) {
  const collected = { marks: [], held: [], provenBy: 0 };
  const fn = (html, url) => {
    const rows = extract(html, url);
    const r = reconstructRows(rows, source);
    collected.marks = r.marks;
    collected.held = r.held;
    collected.provenBy = r.provenBy;
    /* extractBids may carry `unreconciled` on the array itself. A mapped copy
       would drop it, and board.mjs reads it. */
    if (r.rows !== rows && rows.unreconciled !== undefined)
      Object.defineProperty(r.rows, "unreconciled", { value: rows.unreconciled });
    return r.rows;
  };
  fn.collected = collected;
  return fn;
}

/* One sentence per repaired row, for the log and for data/index.json. */
export function describeMarks(marks) {
  return marks.map((m) =>
    `${m.delivery} ${m.commodity}: ${m.field} reconstructed as ${m.value} because ${m.why}`);
}
