#!/usr/bin/env node
/* Turn a filled-in "Update the site" issue into a change to hours.json.

   This is the staff screen, and it is a GitHub issue form rather than a web
   page because a web page needs a server to catch its Save button and this
   project has decided not to run one. What the office gets instead is a
   proper form with dropdowns, on their phone, that anyone with a login can
   fill in; what the business gets is that every change is a commit with a
   name on it and no password to lose.

   NOTHING HERE SETS A PRICE. The price comes off Big River's board through
   the feed and cannot be typed in. The two things this touches are the
   hours and the notice banner, plus the spread, which is a business
   decision rather than a reading.
*/
import { readFileSync, writeFileSync } from "node:fs";

/* A fat finger on the spread is the most expensive mistake available on
   this form: 10 typed instead of 0.10 pays ten dollars under the board.
   Nothing else here can cost money, so nothing else has a cap. */
export const SPREAD_MAX = 1.0;
export const MESSAGE_MAX = 160;

export class Refused extends Error {}

/* ---- reading what GitHub posts ----------------------------------------
   An issue form renders as markdown: a "### Label" line, a blank line, the
   answer, and the literal "_No response_" when the field was left empty.
   Parsed rather than regex-scraped per field so an unexpected heading is
   visible instead of silently missing. */
export function parseForm(body) {
  const out = {};
  const parts = String(body ?? "").split(/^###[ \t]+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const label = (nl < 0 ? part : part.slice(0, nl)).trim();
    const value = (nl < 0 ? "" : part.slice(nl + 1)).trim();
    out[label] = value === "_No response_" || value === "" ? null : value;
  }
  return out;
}

const LEAVE = "Leave it as it is";

/* ---- times -------------------------------------------------------------
   The site writes hours the way they are said: "8:00a to 5:00p". The form
   collects two clock times so nobody has to remember the house format, and
   this composes it. */
export function clock(s, what) {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(String(s ?? ""));
  if (!m) throw new Refused(`${what} needs to be a time like 8:00 or 17:00, not “${s}”`);
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) throw new Refused(`${what} is not a time on a clock: “${s}”`);
  const ampm = h < 12 ? "a" : "p";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, "0")}${ampm}`;
}

export const span = (open, close) =>
  `${clock(open, "The opening time")} to ${clock(close, "The closing time")}`;

/* ---- the change --------------------------------------------------------
   Returns the new hours.json and pricing.json, plus a plain-English list of
   what moved, which is what gets posted back on the issue. Pure, so every
   combination can be tested without a repository. */
export function applyUpdate(form, { hours, pricing, todayISO }) {
  const h = { ...hours };
  const p = { ...pricing };
  const did = [];

  const today = form["Are you open today?"];
  if (today && today !== LEAVE) {
    if (today === "Open, usual hours") {
      h.closed_today = false; h.today_override = null; h.harvest_mode = false;
      did.push("Open today on the usual hours.");
    } else if (today === "Open, different hours") {
      const s = span(form["Opens"], form["Closes"]);
      h.closed_today = false; h.harvest_mode = false; h.today_override = s;
      did.push(`Open today, ${s}.`);
    } else if (today === "Closed today") {
      h.closed_today = true; h.today_override = null;
      did.push("Closed today.");
    } else if (today === "Harvest hours") {
      h.harvest_mode = true; h.closed_today = false; h.today_override = null;
      did.push(`Harvest hours, ${h.harvest}, seven days a week.`);
    } else {
      throw new Refused(`“${today}” is not one of the choices on the form`);
    }

    /* WHICH DAY THE ANSWER WAS ABOUT. Without this, "Closed today" stays
       true for ever: nothing in the daily job ever cleared it, so one
       Thursday closure would have told every customer the elevator was shut
       for the rest of the year. See tools/update-today.mjs. */
    h.today_date = today === "Harvest hours" ? null : todayISO;
    if (today === "Open, usual hours") h.today_date = null;
  }

  const banner = form["The notice banner"];
  if (banner && banner !== LEAVE) {
    if (banner === "Show it") {
      const msg = form["Message"];
      if (!msg) throw new Refused("you asked to show the banner but left the message empty");
      if (msg.length > MESSAGE_MAX)
        throw new Refused(
          `the message is ${msg.length} characters and the bar fits ${MESSAGE_MAX}. ` +
          `Shorten it and open a new one.`);
      if (/[<>]/.test(msg)) throw new Refused("the message cannot contain < or >");
      h.banner = msg;
      did.push(`Banner showing: “${msg}”`);
    } else if (banner === "Hide it") {
      h.banner = null;
      did.push("Banner hidden.");
    } else {
      throw new Refused(`“${banner}” is not one of the choices on the form`);
    }
  }

  const spread = form["Our spread under Big River"];
  if (spread) {
    if (!/^\d*\.?\d+$/.test(spread.trim()))
      throw new Refused(`the spread “${spread}” is not a number. Type it like 0.10.`);
    const v = Number(spread.trim());
    if (!(v >= 0))
      throw new Refused("the spread goes in as a positive number of dollars under the board");
    if (v > SPREAD_MAX)
      throw new Refused(
        `the spread reads as $${v.toFixed(2)} under the board, which is past the ` +
        `$${SPREAD_MAX.toFixed(2)} limit this form will accept. If that is really ` +
        `the number, change pricing.json directly so it takes two people to notice.`);
    if (v !== p.spread) {
      p.spread = v;
      did.push(`Spread set to $${v.toFixed(2)} under Big River.`);
    }
  }

  if (!did.length) throw new Refused("nothing on the form asked for a change");
  return { hours: h, pricing: p, did };
}

/* ---- what runs in the workflow ----------------------------------------- */

const ALLOWED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export function checkWhoAsked(association) {
  if (!ALLOWED.has(String(association ?? "").toUpperCase()))
    throw new Refused(
      "this form only accepts changes from people with write access to this " +
      "repository. Nothing has been changed.");
}

export function main({ body, association, todayISO, env = process.env } = {}) {
  const hours = JSON.parse(readFileSync("hours.json", "utf8"));
  let pricing = {};
  try { pricing = JSON.parse(readFileSync("pricing.json", "utf8")); } catch { /* optional */ }

  checkWhoAsked(association);
  const form = parseForm(body);
  const r = applyUpdate(form, { hours, pricing, todayISO });

  writeFileSync("hours.json", JSON.stringify(r.hours, null, 2) + "\n");
  if (Object.keys(pricing).length)
    writeFileSync("pricing.json", JSON.stringify(r.pricing, null, 2) + "\n");
  return r;
}
