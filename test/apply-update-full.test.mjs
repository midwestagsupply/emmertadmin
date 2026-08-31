/* THE SCREEN AND THE APPLIER HAVE TO STAY LEVEL.
 *
 * On 2026-08-20 the Save button stopped posting to a Cloudflare Worker and
 * started opening a GitHub issue instead. From that moment, a field the screen
 * offers that this applier cannot read is a field that silently does nothing:
 * the office types a basis, presses Save, sees an issue, and the number never
 * lands. Before this file the applier handled 6 of the screen's 20 fields and
 * nothing said so.
 *
 * The last test in this file is the one that matters — it reads the screen's
 * own form controls and asserts every one of them has somewhere to go.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyUpdate, parseForm, money, basis, yes, Refused,
         BASIS_ABS_MAX, SPREAD_MAX, NOTE_MAX } from "../tools/apply-update.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOURS = { weekday: "8:00a to 5:00p", saturday: null, sunday: null,
                harvest: "8:00a to 7:00p", harvest_mode: false, closed_today: false,
                today_override: null, today_date: null, banner: null, hoursnote: null };
const PRICING = { spread: 0.1, spreadHarvest: 0, price_note: "old note", manual: null };
const run = (form) => applyUpdate(form, { hours: { ...HOURS }, pricing: { ...PRICING }, todayISO: "2026-08-20" });
const refused = (form) => { try { run(form); return null; } catch (e) {
  assert.ok(e instanceof Refused, `expected a Refused, got ${e}`); return e.message; } };

/* ---- the basis, which is what the office actually changes ---------------- */

test("the cash basis can be set, under either wording", () => {
  assert.equal(run({ "Our basis under Big River — cash": "0.12" }).pricing.spread, 0.12);
  assert.equal(run({ "Our spread under Big River": "0.12" }).pricing.spread, 0.12);
});

test("the new-crop basis is its own figure and lands in its own key", () => {
  const r = run({ "Our basis under Big River — new crop": "0.18" });
  assert.equal(r.pricing.spreadHarvest, 0.18);
  assert.equal(r.pricing.spread, 0.1, "the cash basis must not move with it");
  assert.match(r.did.join(" "), /New-crop basis set to \$0\.18/);
});

test("a basis past the cap is refused, not published", () => {
  assert.match(refused({ "Our basis under Big River — new crop": "1.75" }), /past the \$1\.00 limit/);
  assert.match(refused({ "Our basis under Big River — cash": "10" }), /past the \$1\.00 limit/);
});

test("a dollar sign and stray spaces are read, not rejected", () => {
  assert.equal(money(" $0.10 ", "x"), 0.1);
  assert.equal(run({ "Our basis under Big River — cash": "$0.25" }).pricing.spread, 0.25);
});

/* ---- the by-hand price -------------------------------------------------- */

test("a by-hand price lands, with its basis beside it", () => {
  const r = run({ "Price by hand — cash": "3.97", "Price by hand — cash basis": "-0.52" });
  assert.deepEqual(r.pricing.manual, { cash: 3.97, basis: -0.52 });
});

test("A BASIS WITH NO PRICE BESIDE IT IS REFUSED — both crops", () => {
  assert.match(refused({ "Price by hand — cash basis": "-0.52" }), /no cash price beside it/);
  assert.match(refused({ "Price by hand — new crop basis": "-0.60" }), /no new-crop price beside it/);
});

test("a hand basis may be either side of zero, but not absurd", () => {
  assert.equal(basis("-0.52", "x"), -0.52);
  assert.equal(basis("0.40", "x"), 0.4);
  const msg = refused({ "Price by hand — cash": "3.97", "Price by hand — cash basis": "-2.00" });
  assert.ok(msg.includes(`more than $${BASIS_ABS_MAX.toFixed(2)}`), msg);
});

test("a price with no basis is fine — the rule is one-directional", () => {
  assert.deepEqual(run({ "Price by hand — cash": "4.01" }).pricing.manual, { cash: 4.01 });
});

/* ---- the weekly hours --------------------------------------------------- */

test("a weekday span is composed the way the site writes it", () => {
  assert.equal(run({ "Mon to Fri — opens": "7:00", "Mon to Fri — closes": "17:30" }).hours.weekday,
    "7:00a to 5:30p");
});

test("a day marked closed becomes null, never an empty string", () => {
  const r = run({ "Saturday — opens": "8:00", "Saturday — closes": "12:00" });
  assert.equal(r.hours.saturday, "8:00a to 12:00p");
  const c = applyUpdate({ "Saturday — closed": "- [X] Closed" },
    { hours: { ...HOURS, saturday: "8:00a to 12:00p" }, pricing: { ...PRICING }, todayISO: "2026-08-20" });
  assert.equal(c.hours.saturday, null);
  assert.notEqual(c.hours.saturday, "");
});

test("SUNDAY CAN BE OPENED — the one that used to be impossible", () => {
  /* The markup shipped Sunday's inputs disabled and its Closed box ticked, so
     there was no way to open on a Sunday during harvest, the one time of year
     it matters. */
  assert.equal(run({ "Sunday — opens": "8:00", "Sunday — closes": "16:00" }).hours.sunday,
    "8:00a to 4:00p");
});

test("a day left open with a blank time is refused, not published half-set", () => {
  assert.match(refused({ "Mon to Fri — opens": "8:00" }), /both an opening and a closing time/);
});

test("an unticked Closed box is not a closure", () => {
  assert.equal(yes("- [ ] Closed"), false);
  assert.equal(yes("- [X] Closed"), true);
  assert.match(refused({ "Sunday — closed": "- [ ] Closed" }), /both an opening and a closing time/);
});

/* ---- the small print ---------------------------------------------------- */

test("both notes can be set and are guarded like the banner", () => {
  const r = run({ "Small print under the price table": "New wording.",
                  "Small print under the hours": "Harvest hours posted here first." });
  assert.equal(r.pricing.price_note, "New wording.");
  assert.equal(r.hours.hoursnote, "Harvest hours posted here first.");
  assert.match(refused({ "Small print under the hours": "a <script> b" }), /cannot contain/);
  assert.match(refused({ "Small print under the price table": "x".repeat(NOTE_MAX + 1) }),
    new RegExp(`limit is ${NOTE_MAX}`));
});

test("a note set to what it already said is not a change", () => {
  assert.match(refused({ "Small print under the price table": "old note" }),
    /nothing on the form asked for a change/);
});

/* ---- the whole point ---------------------------------------------------- */

test("EVERY CONTROL ON THE SCREEN HAS SOMEWHERE TO GO", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const names = new Set([...html.matchAll(/name="([a-z_0-9]+)"/g)].map((m) => m[1]));
  /* Not form data: the two meta tags and the robots control are page
     furniture, not something the office sets. */
  for (const skip of ["viewport", "robots"]) names.delete(skip);

  /* The label each control's value travels under in the issue. If a control is
     added to the screen and not added here, this test fails — which is the
     point of it. */
  const ROUTED = {
    today: "Are you open today?", open: "Opens", close: "Closes",
    banner: "The notice banner", message: "Message",
    spread: "Our basis under Big River — cash",
    spread_harvest: "Our basis under Big River — new crop",
    manual_cash: "Price by hand — cash", manual_basis: "Price by hand — cash basis",
    manual_harvest: "Price by hand — new crop",
    manual_harvest_basis: "Price by hand — new crop basis",
    price_note: "Small print under the price table",
    hoursnote: "Small print under the hours",
    wk_open: "Mon to Fri — opens", wk_close: "Mon to Fri — closes", wk_closed: "Mon to Fri — closed",
    sat_open: "Saturday — opens", sat_close: "Saturday — closes", sat_closed: "Saturday — closed",
    sun_open: "Sunday — opens", sun_close: "Sunday — closes", sun_closed: "Sunday — closed",
  };
  for (const n of names)
    assert.ok(ROUTED[n], `the screen has a control named "${n}" that no issue field carries`);

  /* And every label this file claims is routed must be one applyUpdate really
     reads. Checked by RUNNING it, not by grepping the source: three of these
     labels are built from a template string and never appear in the file as
     literals, so a text search called them missing when they work. A test that
     reads code instead of running it is how you get a green suite that proves
     nothing — which is the fault this repository was already carrying.

     A field is "read" if supplying it either changes something or is refused
     for a reason of its own. The only wrong answer is the applier shrugging:
     "nothing on the form asked for a change". */
  const COREQ = {
    "Opens": { "Are you open today?": "Open, different hours", "Closes": "17:00" },
    "Closes": { "Are you open today?": "Open, different hours", "Opens": "8:00" },
    "Message": { "The notice banner": "Show it" },
    "Price by hand — cash basis": { "Price by hand — cash": "3.97" },
    "Price by hand — new crop basis": { "Price by hand — new crop": "4.20" },
    "Mon to Fri — opens": { "Mon to Fri — closes": "17:00" },
    "Mon to Fri — closes": { "Mon to Fri — opens": "8:00" },
    "Saturday — opens": { "Saturday — closes": "12:00" },
    "Saturday — closes": { "Saturday — opens": "8:00" },
    "Sunday — opens": { "Sunday — closes": "16:00" },
    "Sunday — closes": { "Sunday — opens": "8:00" },
  };
  const SAMPLE = {
    "Are you open today?": "Closed today", "The notice banner": "Hide it",
    "Mon to Fri — closed": "- [X] Closed", "Saturday — closed": "- [X] Closed",
    "Sunday — closed": "- [X] Closed",
  };
  /* Every day OPEN in the starting state, so that ticking Closed is a real
     change. With the shipped fixture (Saturday and Sunday already null) the
     applier correctly reported no change, and the test read that as the field
     being ignored — the fixture was wrong, not the code.

     SECOND TIME, 2026-08-31, and the same fault one field over. "The notice
     banner": "Hide it" was probed against a state with no banner in it. That
     passed only while the applier reported hiding an already-hidden banner as
     a change; once it started comparing first — as every other field on this
     form always has — the correct silence read here as "applyUpdate ignores
     it". So the starting state now has a banner up, the way it needs a day
     open before Closed can mean anything.

     The lesson is the same both times and worth saying plainly: THIS TEST
     PROBES WHETHER A FIELD IS READ, and the only way to ask that is to make
     the field's value DIFFERENT from what is already there. A fixture that
     already agrees with the probe cannot tell "read and unchanged" from
     "not read at all". */
  const OPEN_WEEK = { ...HOURS, saturday: "8:00a to 12:00p", sunday: "9:00a to 1:00p",
                      banner: "There is something on the bar to take down." };
  for (const label of Object.values(ROUTED)) {
    const value = SAMPLE[label] ?? (/opens|closes/i.test(label) ? "9:00"
                 : /basis|price by hand/i.test(label) ? "0.15" : "something new");
    const form = { ...(COREQ[label] || {}), [label]: value };
    let outcome;
    try {
      outcome = applyUpdate(form, { hours: { ...OPEN_WEEK }, pricing: { ...PRICING },
                                    todayISO: "2026-08-20" }).did.join(" ");
    } catch (e) { outcome = e.message; }
    assert.ok(!/nothing on the form asked for a change/.test(outcome),
      `the issue field "${label}" is carried by the screen but applyUpdate ignores it`);
  }
});

/* The stamp the admin screen reads back to tell the office their change landed.
   Written by the only thing that ever writes these files, at the moment it
   writes them, so it cannot drift from the change it describes. */
test("a change stamps when it happened and who asked for it", () => {
  const r = applyUpdate({ "Are you open today?": "Closed today" },
    { hours: { weekday: "8:00a to 5:00p" }, pricing: { spread: 0.1 },
      by: "jessie", whenISO: "2026-08-22T14:05:00Z" });
  assert.equal(r.hours.updated_at, "2026-08-22T14:05:00Z");
  assert.equal(r.hours.updated_by, "jessie");
  assert.equal(r.pricing.updated_at, "2026-08-22T14:05:00Z", "pricing.json is stamped too");
});

test("no login still stamps a time — a time and no name beats silence", () => {
  const r = applyUpdate({ "Are you open today?": "Closed today" },
    { hours: { weekday: "8:00a to 5:00p" }, pricing: {}, whenISO: "2026-08-22T14:05:00Z" });
  assert.equal(r.hours.updated_at, "2026-08-22T14:05:00Z");
  assert.equal("updated_by" in r.hours, false, "no name is written when none was given");
});

test("a refused change stamps nothing", () => {
  assert.throws(() => applyUpdate({}, { hours: { weekday: "8:00a to 5:00p" }, pricing: {},
    by: "jessie", whenISO: "2026-08-22T14:05:00Z" }), /nothing on the form asked for a change/);
});

test("an empty pricing.json is not given a stamp it would have to carry alone", () => {
  const r = applyUpdate({ "Are you open today?": "Closed today" },
    { hours: { weekday: "8:00a to 5:00p" }, pricing: {}, by: "j", whenISO: "2026-08-22T14:05:00Z" });
  assert.equal("updated_at" in r.pricing, false);
});
