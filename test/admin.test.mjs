/* The staff screen, as a form rather than a page.
 *
 * Every case here is a thing somebody actually does at six in the morning,
 * plus the ones where they do it wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseForm, applyUpdate, clock, span, checkWhoAsked, Refused,
  SPREAD_MAX, MESSAGE_MAX,
} from "../tools/apply-update.mjs";

const HOURS = {
  _comment: "x",
  weekday: "8:00a to 5:00p", saturday: "8:00a to 12:00p", sunday: null,
  harvest: "8:00a to 7:00p", harvest_mode: false, closed_today: false,
  today_override: null,
};
const PRICING = { spread: 0.10, company: "Badger Grain Supply, LLC" };
const TODAY = "2026-08-18";
const ctx = () => ({ hours: { ...HOURS }, pricing: { ...PRICING }, todayISO: TODAY });

const form = (o) => ({
  "Are you open today?": "Leave it as it is",
  "The notice banner": "Leave it as it is",
  ...o,
});

/* ---- reading what GitHub posts ---------------------------------------- */

test("an issue form body is read back field by field", () => {
  const body = [
    "### Are you open today?", "", "Closed today", "",
    "### Opens", "", "_No response_", "",
    "### The notice banner", "", "Show it", "",
    "### Message", "", "Scale is down until noon.", "",
    "### Our spread under Big River", "", "_No response_", "",
  ].join("\n");
  const f = parseForm(body);
  assert.equal(f["Are you open today?"], "Closed today");
  assert.equal(f["Opens"], null, "_No response_ must read as empty, not as text");
  assert.equal(f["Message"], "Scale is down until noon.");
  assert.equal(f["Our spread under Big River"], null);
});

test("a multi-line message survives being read back", () => {
  const f = parseForm("### Message\n\nline one\nline two\n\n### Opens\n\n8:00");
  assert.equal(f["Message"], "line one\nline two");
  assert.equal(f["Opens"], "8:00");
});

test("an empty or missing body does not throw", () => {
  for (const v of ["", null, undefined]) assert.deepEqual(parseForm(v), {});
});

/* ---- who is allowed ---------------------------------------------------- */

test("ONLY PEOPLE WITH WRITE ACCESS CAN CHANGE THE SITE", () => {
  /* The repository is public, so anyone with a GitHub account can open the
     form. That is fine as long as opening it is all they can do. */
  for (const ok of ["OWNER", "MEMBER", "COLLABORATOR", "collaborator"])
    assert.doesNotThrow(() => checkWhoAsked(ok), ok);
  for (const no of ["CONTRIBUTOR", "NONE", "FIRST_TIME_CONTRIBUTOR", "", null, undefined])
    assert.throws(() => checkWhoAsked(no),
      (e) => e instanceof Refused && /write access/.test(e.message), String(no));
});

/* ---- today's hours ----------------------------------------------------- */

test("closed today", () => {
  const r = applyUpdate(form({ "Are you open today?": "Closed today" }), ctx());
  assert.equal(r.hours.closed_today, true);
  assert.equal(r.hours.today_override, null);
  assert.equal(r.hours.today_date, TODAY);
  assert.match(r.did[0], /Closed today/);
});

test("A ONE-DAY CLOSURE DOES NOT BECOME A PERMANENT ONE", () => {
  /* The bug this fixes: nothing ever cleared closed_today. One Thursday
     closure told every customer the elevator was shut for the rest of the
     year, and the only cure was somebody remembering. The answer now
     records which day it was about. */
  const r = applyUpdate(form({ "Are you open today?": "Closed today" }), ctx());
  assert.equal(r.hours.today_date, TODAY,
    "the answer has to carry the day it was an answer about");
  const tomorrow = { ...r.hours };
  assert.notEqual(tomorrow.today_date, "2026-08-19",
    "so tomorrow's run can tell it is out of date");
});

test("open on different hours, composed into the house format", () => {
  const r = applyUpdate(form({
    "Are you open today?": "Open, different hours", Opens: "6:30", Closes: "20:00",
  }), ctx());
  assert.equal(r.hours.today_override, "6:30a to 8:00p");
  assert.equal(r.hours.closed_today, false);
  assert.equal(r.hours.today_date, TODAY);
});

test("back to usual hours clears everything, including the date", () => {
  const started = { ...HOURS, closed_today: true, today_override: "9:00a to 1:00p",
                    harvest_mode: true, today_date: "2026-08-17" };
  const r = applyUpdate(form({ "Are you open today?": "Open, usual hours" }),
    { hours: started, pricing: PRICING, todayISO: TODAY });
  assert.equal(r.hours.closed_today, false);
  assert.equal(r.hours.today_override, null);
  assert.equal(r.hours.harvest_mode, false);
  assert.equal(r.hours.today_date, null);
});

test("harvest hours are a season, not a day, so they do not expire overnight", () => {
  const r = applyUpdate(form({ "Are you open today?": "Harvest hours" }), ctx());
  assert.equal(r.hours.harvest_mode, true);
  assert.equal(r.hours.today_date, null,
    "harvest runs until somebody turns it off, unlike a one-day answer");
  assert.match(r.did[0], /8:00a to 7:00p/);
});

test("times are refused rather than guessed at", () => {
  for (const bad of ["", "eight", "8", "25:00", "8:60", "8am", null]) {
    assert.throws(() => applyUpdate(form({
      "Are you open today?": "Open, different hours", Opens: bad, Closes: "17:00",
    }), ctx()), (e) => e instanceof Refused && /opening time/i.test(e.message), String(bad));
  }
});

test("the clock reads midnight and noon the way people say them", () => {
  assert.equal(clock("0:00", "x"), "12:00a");
  assert.equal(clock("12:00", "x"), "12:00p");
  assert.equal(clock("12:30", "x"), "12:30p");
  assert.equal(clock("13:05", "x"), "1:05p");
  assert.equal(span("8:00", "17:00"), "8:00a to 5:00p");
});

/* ---- the banner -------------------------------------------------------- */

test("showing and hiding the banner", () => {
  const on = applyUpdate(form({ "The notice banner": "Show it", Message: "Scale down till noon." }), ctx());
  assert.equal(on.hours.banner, "Scale down till noon.");
  const off = applyUpdate(form({ "The notice banner": "Hide it" }), ctx());
  assert.equal(off.hours.banner, null);
});

test("asking to show a banner with no message is refused, not shown empty", () => {
  assert.throws(() => applyUpdate(form({ "The notice banner": "Show it" }), ctx()),
    (e) => e instanceof Refused && /left the message empty/.test(e.message));
});

test("a message too long for the bar is refused with the count", () => {
  const long = "x".repeat(MESSAGE_MAX + 1);
  assert.throws(() => applyUpdate(form({ "The notice banner": "Show it", Message: long }), ctx()),
    (e) => e instanceof Refused && new RegExp(`${MESSAGE_MAX + 1} characters`).test(e.message));
});

test("a message cannot smuggle markup onto the page", () => {
  assert.throws(() => applyUpdate(form({
    "The notice banner": "Show it", Message: "<script>alert(1)</script>",
  }), ctx()), (e) => e instanceof Refused && /cannot contain/.test(e.message));
});

/* ---- the spread -------------------------------------------------------- */

test("the spread changes, and says so in dollars", () => {
  const r = applyUpdate(form({ "Our spread under Big River": "0.15" }), ctx());
  assert.equal(r.pricing.spread, 0.15);
  assert.match(r.did[0], /\$0\.15 under Big River/);
});

test("A FAT FINGER ON THE SPREAD IS THE ONE MISTAKE HERE THAT COSTS MONEY", () => {
  /* 10 typed instead of 0.10 pays ten dollars under the board on every
     load that comes through the door. Nothing else on this form can do
     that, so nothing else has a cap. */
  assert.throws(() => applyUpdate(form({ "Our spread under Big River": "10" }), ctx()),
    (e) => e instanceof Refused && /past the \$1\.00 limit/.test(e.message));
  assert.doesNotThrow(() => applyUpdate(form({
    "Our spread under Big River": String(SPREAD_MAX) }), ctx()),
    "the limit itself must still be allowed");
});

test("a spread that is not a number is refused", () => {
  for (const bad of ["-0.10", "ten cents", "0.1.0", "$0.10"])
    assert.throws(() => applyUpdate(form({ "Our spread under Big River": bad }), ctx()),
      (e) => e instanceof Refused, bad);
});

test("re-typing the spread that is already set is not reported as a change", () => {
  assert.throws(() => applyUpdate(form({ "Our spread under Big River": "0.10" }), ctx()),
    (e) => e instanceof Refused && /nothing on the form asked for a change/.test(e.message));
});

/* ---- nothing else moves ------------------------------------------------ */

test("THE FORM CANNOT SET A PRICE", () => {
  /* The whole doctrine in one test. A number typed every morning goes stale
     by afternoon, so the bid comes off the board or it does not appear. */
  const r = applyUpdate(form({ "Are you open today?": "Closed today" }), ctx());
  for (const k of Object.keys(r.hours)) assert.doesNotMatch(k, /price|cash|bid|basis/i);
  assert.deepEqual(Object.keys(r.pricing), Object.keys(PRICING));
});

test("an empty form changes nothing and says so", () => {
  assert.throws(() => applyUpdate(form({}), ctx()),
    (e) => e instanceof Refused && /nothing on the form asked for a change/.test(e.message));
});

test("a choice that is not on the form is refused rather than ignored", () => {
  assert.throws(() => applyUpdate(form({ "Are you open today?": "Maybe" }), ctx()),
    (e) => e instanceof Refused && /not one of the choices/.test(e.message));
});

test("the weekly hours and the company details are never touched by this form", () => {
  const r = applyUpdate(form({
    "Are you open today?": "Closed today",
    "The notice banner": "Show it", Message: "x",
    "Our spread under Big River": "0.20",
  }), ctx());
  assert.equal(r.hours.weekday, HOURS.weekday);
  assert.equal(r.hours.saturday, HOURS.saturday);
  assert.equal(r.hours.harvest, HOURS.harvest);
  assert.equal(r.pricing.company, PRICING.company);
});

test("three changes at once are all reported back", () => {
  const r = applyUpdate(form({
    "Are you open today?": "Open, different hours", Opens: "7:00", Closes: "15:30",
    "The notice banner": "Show it", Message: "Dryer down.",
    "Our spread under Big River": "0.12",
  }), ctx());
  assert.equal(r.did.length, 3);
  assert.match(r.did.join(" "), /7:00a to 3:30p/);
  assert.match(r.did.join(" "), /Dryer down/);
  assert.match(r.did.join(" "), /\$0\.12/);
});

test("the original objects are not mutated", () => {
  const c = ctx();
  const before = JSON.stringify(c.hours);
  applyUpdate(form({ "Are you open today?": "Closed today" }), c);
  assert.equal(JSON.stringify(c.hours), before);
});
