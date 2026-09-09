/* THE PER-MONTH TABLE, ON ITS WAY FROM THE SCREEN TO pricing.json.
 *
 * The basis screen sends eleven delivery months, a basis and a tick each, as
 * ONE field. Twenty-two headings per issue would not fit the 7,500-character
 * URL cap the screen enforces, and would mean twenty-two more entries in the
 * ROUTED map that keeps the screen and the applier level -- a list nobody would
 * keep true. So the months travel as a small table a person can read in the
 * issue before pressing Submit, and this file is what makes sure the applier
 * reads exactly what the screen wrote.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { months, applyUpdate, parseForm, Refused, BASIS_ABS_MAX, MONTH_NAMES }
  from "../tools/apply-update.mjs";

const HOURS = { weekday: "8:00a to 5:00p", saturday: null, sunday: null,
                harvest: "8:00a to 7:00p", harvest_mode: false, closed_today: false,
                today_override: null, today_date: null, banner: null, hoursnote: null };
const PRICING = { basis: -0.75, basisHarvest: -0.62, spread: 0, price_note: null, manual: null };
const apply = (form, over = {}) =>
  applyUpdate(form, { hours: { ...HOURS }, pricing: { ...PRICING, ...over },
                      todayISO: "2026-09-08" });
const LABEL = "Months — what we publish";

/* ---- the parser ------------------------------------------------------- */

test("a table reads as the object a site consumes", () => {
  assert.deepEqual(months(
    "September  -0.85  show\nOctober  -0.95  show\nNovember  same  hide"), {
    September: { basis: -0.85, publish: true },
    October:   { basis: -0.95, publish: true },
    November:  { basis: null,  publish: false },
  });
});

test("spacing, case and blank lines are the office's business, not the parser's", () => {
  assert.deepEqual(months("\n\n  October   -0.9   SHOW  \n\n  November SAME hide\n"), {
    October:  { basis: -0.9, publish: true },
    November: { basis: null, publish: false },
  });
});

test("a basis may be typed the way people type money", () => {
  const t = months("September $-0.85 show\nOctober +0.05 show\nNovember .5 show\nDecember 0 show");
  assert.equal(t.September.basis, -0.85);
  assert.equal(t.October.basis, 0.05, "a leading plus is a sign, not a character to choke on");
  assert.equal(t.November.basis, 0.5);
  assert.equal(t.December.basis, 0, "zero is even with the contract, which is a real answer");
});

test("`same` means the month has no basis of its own", () => {
  /* Not zero. Zero is even with the contract; `same` is "use the cash or
     new-crop basis", which is what a blank box on the screen means. */
  assert.equal(months("October same show").October.basis, null);
  assert.notEqual(months("October same show").October.basis, 0);
});

test("a line this form cannot read is refused, with the line in the message", () => {
  for (const bad of ["October -0.95", "October", "October -0.95 maybe",
                     "October -0.95 show extra", "-0.95 show"]) {
    assert.throws(() => months(bad), (e) =>
      e instanceof Refused && e.message.includes(bad.trim().split("\n")[0]),
      `“${bad}” was accepted`);
  }
});

test("a month that is not a month is refused by name", () => {
  assert.throws(() => months("Setpember -0.85 show"),
    (e) => e instanceof Refused && /“Setpember” is not a delivery month/.test(e.message));
  for (const m of MONTH_NAMES) assert.doesNotThrow(() => months(`${m} same show`));
});

test("the same month twice is refused rather than one silently winning", () => {
  assert.throws(() => months("October -0.90 show\nOctober -0.95 hide"),
    (e) => e instanceof Refused && /October is on the months table twice/.test(e.message));
});

test("a per-month basis past the cap is refused, either sign", () => {
  const over = (BASIS_ABS_MAX + 0.01).toFixed(2);
  /* The wording is basis()'s, not this file's: two copies of a refusal message
     is how the screen and the applier come to say different things about the
     same number. */
  assert.throws(() => months(`October ${over} show`), /more than \$1\.50 off the board/);
  assert.throws(() => months(`October -${over} show`), /more than \$1\.50 off the board/);
  assert.doesNotThrow(() => months(`October ${BASIS_ABS_MAX.toFixed(2)} show`));
  assert.doesNotThrow(() => months(`October -${BASIS_ABS_MAX.toFixed(2)} show`));
});

test("EVERYTHING HIDDEN IS REFUSED, because it takes the site's price down", () => {
  assert.throws(() => months("September same hide\nOctober same hide"),
    (e) => e instanceof Refused && /no delivery month is ticked to show/.test(e.message));
  assert.throws(() => months(""), (e) => e instanceof Refused && /arrived empty/.test(e.message));
});

/* ---- the branch that writes it ---------------------------------------- */

test("the table lands in pricing.json and the note says what the office will see", () => {
  const r = apply({ [LABEL]: "September -0.85 show\nOctober -0.95 show\nNovember same hide" });
  assert.deepEqual(r.pricing.months, {
    September: { basis: -0.85, publish: true },
    October:   { basis: -0.95, publish: true },
    November:  { basis: null,  publish: false },
  });
  assert.match(r.did.join(" "), /shows 2 delivery months: September, October/);
  assert.match(r.did.join(" "), /Basis set on September -0\.85, October -0\.95/);
});

test("a table set to what it already said is not a change", () => {
  /* The screen sends the whole table on every Save, so without this the office
     would be told the months moved every time they changed the banner. */
  const same = { September: { basis: -0.85, publish: true },
                 October: { basis: null, publish: false } };
  assert.throws(
    () => apply({ [LABEL]: "September -0.85 show\nOctober same hide" }, { months: same }),
    (e) => e instanceof Refused && /nothing on the form asked for a change/.test(e.message));
});

test("one month moving is a change, and only the months line is reported", () => {
  const before = { September: { basis: -0.85, publish: true },
                   October: { basis: null, publish: false } };
  const r = apply({ [LABEL]: "September -0.85 show\nOctober same show" }, { months: before });
  assert.equal(r.pricing.months.October.publish, true);
  assert.equal(r.did.length, 1);
});

test("THE MONTHS KEY IS NOT CREATED BY A FORM THAT NEVER MENTIONED MONTHS", () => {
  /* pricing.json is a file two sites read. A form about the banner must not add
     a key to it, and `p.months ??= {}` at the top of applyUpdate would. */
  /* A form that really changes something, so the refusal below cannot be
     "nothing asked for a change" wearing this test's name. */
  const r = apply({ "Small print under the hours": "Call before you haul." });
  assert.equal(r.hours.hoursnote, "Call before you haul.");
  assert.ok(!("months" in r.pricing), "a hours-only save added a months key to pricing.json");
});

test("an emptied months field is refused rather than wiping the table", () => {
  assert.throws(() => apply({ [LABEL]: null }),
    (e) => e instanceof Refused && /cannot be emptied/.test(e.message));
});

test("the months a site reads and the months this writes are the same shape", () => {
  /* Both ends, in one assertion: every value is {basis: number|null, publish:
     boolean} and nothing else. update-prices.mjs normalises to exactly this. */
  const t = apply({ [LABEL]: "September -0.85 show\nOctober same hide" }).pricing.months;
  for (const [m, v] of Object.entries(t)) {
    assert.deepEqual(Object.keys(v).sort(), ["basis", "publish"], `${m} carries extra keys`);
    assert.ok(v.basis === null || typeof v.basis === "number");
    assert.equal(typeof v.publish, "boolean");
  }
});

/* ---- through a real issue body ---------------------------------------- */

test("IT SURVIVES THE ROUND TRIP THROUGH AN ISSUE, which is how it really arrives", () => {
  /* parseForm() splits on "### " and trims. A multi-line value is the first
     thing on this form that could be flattened or truncated by that, so it is
     tested through the real parser rather than by handing applyUpdate an
     object the screen never produces. */
  const body = [
    "### Are you open today?", "", "Closed today", "",
    `### ${LABEL}`, "",
    "September  -0.85  show",
    "October  -0.95  show",
    "November  same  hide", "",
    "### Small print under the hours", "", "Call before you haul.",
  ].join("\n");
  const form = parseForm(body);
  assert.equal(Object.keys(form).length, 3);
  const r = applyUpdate(form, { hours: { ...HOURS }, pricing: { ...PRICING },
                                todayISO: "2026-09-08" });
  assert.deepEqual(Object.keys(r.pricing.months), ["September", "October", "November"]);
  assert.equal(r.pricing.months.October.basis, -0.95);
  assert.equal(r.hours.closed_today, true, "the fields either side of it still applied");
  assert.equal(r.hours.hoursnote, "Call before you haul.");
});
