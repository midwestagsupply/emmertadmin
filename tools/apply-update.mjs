#!/usr/bin/env node
/* Turn a filled-in "Update the site" issue into a change to hours.json.

   This is the staff screen, and it is a GitHub issue form rather than a web
   page because a web page needs a server to catch its Save button and this
   project has decided not to run one. What the office gets instead is a
   proper form with dropdowns, on their phone, that anyone with a login can
   fill in; what the business gets is that every change is a commit with a
   name on it and no password to lose.

   WHAT IT TOUCHES. Everything the staff screen can change, because on
   2026-08-20 the screen's Save button stopped posting to a server and started
   opening one of these issues instead. If this file cannot apply a field, the
   screen cannot offer it — so the two must be kept level, and the test named
   after this comment asserts they are.

   THE PRICE STILL COMES OFF BIG RIVER'S BOARD. The cash bid is read from the
   feed and cannot be typed in during the ordinary day. What CAN be set here
   is the basis under that board (a business decision, not a reading), and the
   by-hand price, which is the break-glass for a day the feed is down.
*/
import { readFileSync, writeFileSync } from "node:fs";

/* A fat finger on the spread is the most expensive mistake available on
   this form: 10 typed instead of 0.10 pays ten dollars under the board.
   Nothing else here can cost money, so nothing else has a cap. */
export const SPREAD_MAX = 1.0;
export const MESSAGE_MAX = 160;
/* A hand-typed basis is the elevator's own number, not a reduction of
   somebody else's, so it may be either side of zero — but it is still a
   basis, and a basis a dollar and a half off the board is a typo. Same
   figure the staff screen validates against, deliberately: two numbers that
   have to agree are one number written twice. */
export const BASIS_ABS_MAX = 1.5;
export const NOTE_MAX = 400;

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

/* One reader for every money box on the form, so "0.10" and "$0.10" and
   " .10 " and "10" cannot be read four different ways in four places. */
export function money(v, what) {
  const t = String(v ?? "").trim().replace(/^\$/, "");
  if (!/^-?\d*\.?\d+$/.test(t))
    throw new Refused(`${what} “${v}” is not a number. Type it like 0.10.`);
  return Number(t);
}

export function basis(v, what) {
  const n = money(v, what);
  if (Math.abs(n) > BASIS_ABS_MAX)
    throw new Refused(
      `${what} reads as $${n.toFixed(2)}, which is more than $${BASIS_ABS_MAX.toFixed(2)} ` +
      `off the board. If that is really the number it does not go in through this form.`);
  return n;
}

export const overCap = (what, v) =>
  `the ${what} reads as $${v.toFixed(2)} under the board, which is past the ` +
  `$${SPREAD_MAX.toFixed(2)} limit this form will accept. If that is really ` +
  `the number, change pricing.json directly so it takes two people to notice.`;

/* A checkbox on a GitHub issue form comes across as "- [X] label" or "- [ ] label". */
export const yes = (v) => /\[[xX]\]/.test(String(v ?? ""));

export const span = (open, close) =>
  `${clock(open, "The opening time")} to ${clock(close, "The closing time")}`;

/* ---- the change --------------------------------------------------------
   Returns the new hours.json and pricing.json, plus a plain-English list of
   what moved, which is what gets posted back on the issue. Pure, so every
   combination can be tested without a repository. */
export function applyUpdate(form, { hours, pricing, todayISO, by, whenISO }) {
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

  /* THREE NAMES, NEWEST FIRST. The screen's label changed when "Our basis
     under Big River" was corrected to "Under Big River" -- it holds the
     spread, not the basis. Issues already open on GitHub carry the older
     headings, so those keep working; an applier that only knew the new
     name would silently ignore work the office had already filed. */
  const spread = form["Under Big River — cash"]
              ?? form["Our basis under Big River — cash"]
              ?? form["Our spread under Big River"];
  if (spread) {
    const v = money(spread, "the basis");
    if (!(v >= 0))
      throw new Refused("the spread goes in as a positive number of dollars under the board");
    if (v > SPREAD_MAX)
      throw new Refused(overCap("basis", v));
    if (v !== p.spread) {
      p.spread = v;
      did.push(`Spread set to $${v.toFixed(2)} under Big River.`);
    }
  }

  /* ---- the basis under the board ---------------------------------------
     "Spread" and "basis" are the same figure said two ways, and the screen
     says basis. Both labels are accepted: the old one because issues already
     filed carry it, the new one because it is what the form now asks. */
  const harvestSpread = form["Under Big River — new crop"]
                     ?? form["Our basis under Big River — new crop"]
                     ?? form["Our spread under Big River — new crop"];
  /* null is "the office emptied this box", which means "same as cash" -- the
     documented meaning of an absent spreadHarvest. undefined is "the heading
     never came", which means leave it alone. Without this the box could be
     set and never unset. */
  if (harvestSpread === null) {
    if (p.spreadHarvest != null) {
      p.spreadHarvest = null;
      did.push("New-crop basis cleared; new crop follows the cash basis again.");
    }
  } else if (harvestSpread) {
    const v = money(harvestSpread, "the new-crop basis");
    if (!(v >= 0)) throw new Refused("the new-crop basis goes in as a positive number of dollars under the board");
    if (v > SPREAD_MAX) throw new Refused(overCap("new-crop basis", v));
    if (v !== p.spreadHarvest) {
      p.spreadHarvest = v;
      did.push(`New-crop basis set to $${v.toFixed(2)} under Big River.`);
    }
  }

  /* ---- the price posted by hand ----------------------------------------
     The break-glass. A price with no basis beside it is publishable; a basis
     with no price beside it is not, because there is nothing for it to
     attach to. That rule is the screen's and it is repeated here rather than
     trusted, since an issue can be filed without ever loading the screen. */
  const hand = {
    cash: form["Price by hand — cash"],
    basis: form["Price by hand — cash basis"],
    harvest: form["Price by hand — new crop"],
    harvestBasis: form["Price by hand — new crop basis"],
  };
  /* CLEARING THE OVERRIDE IS THE WHOLE POINT OF THE BREAK-GLASS.
     `some(x => x != null)` skipped the block when every box came back empty,
     so `p.manual` was never cleared and a hand-typed price stayed on a live
     grain site until somebody edited the JSON by hand. The screen's own help
     text promises the opposite: "Anything typed here overrides the feed until
     you clear it."

     The four headings are only PRESENT when the office actually opened the
     by-hand panel and submitted it. Present-and-all-empty is therefore an
     explicit "take the override off"; absent is "did not touch it". */
  const handMentioned = Object.values(hand).some((x) => x !== undefined);
  const handEmpty = Object.values(hand).every((x) => x == null);
  if (handMentioned && handEmpty) {
    if (p.manual != null) {
      p.manual = null;
      did.push("By-hand price cleared; the site goes back to the automatic reading.");
    }
  } else if (Object.values(hand).some((x) => x != null)) {
    const m = {};
    if (hand.cash != null) m.cash = money(hand.cash, "the by-hand cash price");
    if (hand.harvest != null) m.harvest = money(hand.harvest, "the by-hand new-crop price");
    if (hand.basis != null) {
      if (m.cash == null) throw new Refused("a cash basis was given with no cash price beside it");
      m.basis = basis(hand.basis, "the by-hand cash basis");
    }
    if (hand.harvestBasis != null) {
      if (m.harvest == null) throw new Refused("a new-crop basis was given with no new-crop price beside it");
      m.harvestBasis = basis(hand.harvestBasis, "the by-hand new-crop basis");
    }
    p.manual = m;
    did.push("Price posted by hand: " +
      [m.cash != null ? `cash $${m.cash.toFixed(2)}` : null,
       m.harvest != null ? `new crop $${m.harvest.toFixed(2)}` : null]
        .filter(Boolean).join(", ") + ".");
  }

  /* ---- the regular weekly hours -----------------------------------------
     Changes rarely, and when it changes it is for good, so it is written to
     the same three keys the site has always read. A day marked closed is
     null, never an empty string — the site tells those apart. */
  for (const [key, label] of [["weekday", "Mon to Fri"], ["saturday", "Saturday"], ["sunday", "Sunday"]]) {
    const closed = form[`${label} — closed`];
    const open = form[`${label} — opens`];
    const close = form[`${label} — closes`];
    if (closed == null && open == null && close == null) continue;
    if (yes(closed)) {
      if (h[key] !== null) { h[key] = null; did.push(`${label}: closed.`); }
      continue;
    }
    if (open == null || close == null)
      throw new Refused(`${label} is not marked closed, so it needs both an opening and a closing time`);
    const s2 = span(open, close);
    if (h[key] !== s2) { h[key] = s2; did.push(`${label}: ${s2}.`); }
  }

  /* ---- the two bits of small print --------------------------------------
     Published straight onto both sites, so the same two hazards the banner
     guards against apply: length, and angle brackets. */
  for (const [label, obj, key, what] of [
    ["Small print under the price table", p, "price_note", "the price note"],
    ["Small print under the hours", h, "hoursnote", "the hours note"],
  ]) {
    const t = form[label];
    if (t == null) continue;
    if (t.length > NOTE_MAX)
      throw new Refused(`${what} is ${t.length} characters and the limit is ${NOTE_MAX}`);
    if (/[<>]/.test(t)) throw new Refused(`${what} cannot contain < or >`);
    if (obj[key] !== t) { obj[key] = t; did.push(`${what.replace(/^the /, "")[0].toUpperCase()}${what.replace(/^the /, "").slice(1)} updated.`); }
  }

  if (!did.length) throw new Refused("nothing on the form asked for a change");

  /* ---- WHO CHANGED IT AND WHEN, so the screen can say the change landed ----
     The office presses Save, an issue opens, and until now NOTHING ever told
     them it worked. They had to go and look at the site. That silence is the
     one thing about this system most likely to make somebody stop trusting it.

     Written by the only thing that ever writes these files, at the moment it
     writes them, so the stamp cannot drift from the change it describes. The
     admin screen already fetches both files on every load, so closing the loop
     costs no new request, no API, no token and no host. Extra keys are safe:
     nothing in either site iterates these files' keys, and hours.json has
     carried a _comment since the beginning. */
  const stampedAt = whenISO || new Date().toISOString();
  h.updated_at = stampedAt;
  if (by) h.updated_by = by;
  if (Object.keys(pricing).length) {
    p.updated_at = stampedAt;
    if (by) p.updated_by = by;
  }

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
  /* The GitHub login of whoever filed the issue, handed in by the workflow.
     Absent is fine: the stamp then carries a time and no name, which is
     still better than the silence it replaces. */
  const by = env.BY || undefined;
  const hours = JSON.parse(readFileSync("hours.json", "utf8"));
  let pricing = {};
  try { pricing = JSON.parse(readFileSync("pricing.json", "utf8")); } catch { /* optional */ }

  checkWhoAsked(association);
  const form = parseForm(body);
  const r = applyUpdate(form, { hours, pricing, todayISO, by });

  writeFileSync("hours.json", JSON.stringify(r.hours, null, 2) + "\n");
  if (Object.keys(pricing).length)
    writeFileSync("pricing.json", JSON.stringify(r.pricing, null, 2) + "\n");
  return r;
}
