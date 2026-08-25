/* The watchdog's own guards. Every branch is exercised offline against a
   fake fetcher, because the one thing these tests cannot do is reach the
   real sites -- and that is deliberately the only thing they cannot do. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { watch, report, inMarketHours, CRON_STALE_MIN } from "../tools/watch-live.mjs";

const MARKET = new Date("2026-08-19T15:00:00Z");   // a Wednesday, mid-window
const QUIET  = new Date("2026-08-23T15:00:00Z");   // a Sunday

const iso = (d) => new Date(d).toISOString();
const ago = (from, h) => iso(from.getTime() - h * 36e5);

/* A site that is entirely well, parameterised so each test can break one
   thing and only that thing. */
function fake({ checkedAt, price = 4.05, callForPrice = false, pricing, hours,
                status = 200, badJson = false, contact = "accounting@midwestagsupply.com" } = {}) {
  return async (url) => {
    const body = (o) => ({ status, body: badJson ? "{oh no" : JSON.stringify(o) });
    if (url.endsWith("/")) return { status, body: callForPrice ? "<p>Call for today's price</p>" : "<p>$4.05</p>" };
    if (url.endsWith("bids.json"))
      /* THE SHAPE THE LIVE SITES ACTUALLY SERVE, captured from
         raw.githubusercontent 2026-08-24: schema emmert-cash-bids/2 with
         `observed` and `pricedAt`, and NO checkedAt. The old fixture emitted
         checkedAt, which no site has ever published, so every test here
         agreed with the watchdog about a file neither had seen. */
      return body({ schema: "emmert-cash-bids/2", observed: checkedAt,
                    pricedAt: checkedAt, generated: checkedAt, status: "ok",
                    bids: price == null ? [] : [{ delivery: "August", cashPrice: price }] });
    if (url.endsWith("pricing.json")) return body(pricing ?? { spread: 0.1, contact });
    if (url.endsWith("hours.json")) return body(hours ?? { weekday: "8:00a to 5:00p" });
    throw new Error("unexpected " + url);
  };
}
const worst = (f) => f.map((x) => x.severity).sort()[0];

test("a healthy pair of sites reports nothing blocking", async () => {
  const found = await watch({ now: MARKET, get: fake({ checkedAt: ago(MARKET, 0.1) }) });
  const r = report(found);
  assert.equal(r.blocking, 0, r.text);
  assert.ok(r.ok);
});

test("a stale reading STILL BEING PUBLISHED is critical", async () => {
  const found = await watch({ now: MARKET, get: fake({ checkedAt: ago(MARKET, 20) }) });
  assert.ok(found.some((f) => f.severity === "critical" && /STILL PUBLISHING A PRICE/.test(f.what)),
    JSON.stringify(found, null, 1));
});

test("a stale reading the site has correctly given up on is NOT blocking", async () => {
  const found = await watch({ now: QUIET, get: fake({ checkedAt: ago(QUIET, 20), price: null, callForPrice: true }) });
  const r = report(found);
  assert.equal(r.blocking, 0, r.text);
  assert.ok(/correctly fallen back/.test(r.text), r.text);
});

test("a fresh reading the site refuses to publish is flagged", async () => {
  const found = await watch({ now: MARKET, get: fake({ checkedAt: ago(MARKET, 1), price: null, callForPrice: true }) });
  assert.ok(found.some((f) => /refusing a price it should be able to post/.test(f.what)),
    JSON.stringify(found, null, 1));
});

test("in market hours a reading older than the cadence says the run has stopped", async () => {
  const found = await watch({ now: MARKET, get: fake({ checkedAt: ago(MARKET, 1.2) }) });
  assert.ok(found.some((f) => f.severity === "high" && /scheduled run has probably stopped/.test(f.what)));
});

test("the same age on a Sunday is not a complaint", async () => {
  const found = await watch({ now: QUIET, get: fake({ checkedAt: ago(QUIET, 1.2) }) });
  assert.ok(!found.some((f) => /scheduled run has probably stopped/.test(f.what)),
    JSON.stringify(found, null, 1));
});

test("market hours is Monday to Friday, 12-21 UTC, and nothing else", () => {
  assert.equal(inMarketHours(new Date("2026-08-19T12:00:00Z")), true);
  assert.equal(inMarketHours(new Date("2026-08-19T20:59:00Z")), true);
  assert.equal(inMarketHours(new Date("2026-08-19T21:00:00Z")), false);
  assert.equal(inMarketHours(new Date("2026-08-19T11:59:00Z")), false);
  assert.equal(inMarketHours(new Date("2026-08-22T15:00:00Z")), false); // Saturday
  assert.equal(inMarketHours(new Date("2026-08-23T15:00:00Z")), false); // Sunday
});

test("a site that does not answer is critical and stops there", async () => {
  const found = await watch({ now: MARKET, get: async () => { throw new Error("ECONNREFUSED"); } });
  assert.ok(found.every((f) => f.severity === "critical"));
  assert.ok(found.some((f) => /did not answer/.test(f.what)));
});

test("an HTTP error on the page is critical", async () => {
  const found = await watch({ now: MARKET, get: fake({ checkedAt: ago(MARKET, 0.1), status: 503 }) });
  assert.ok(found.some((f) => f.severity === "critical" && /HTTP 503/.test(f.what)));
});

test("a published file that is not JSON is critical, not a crash", async () => {
  const found = await watch({ now: MARKET, get: fake({ checkedAt: ago(MARKET, 0.1), badJson: true }) });
  assert.ok(found.some((f) => f.severity === "critical" && /not readable JSON/.test(f.what)),
    JSON.stringify(found, null, 1));
});

test("pricing.json with no numeric spread is critical", async () => {
  const found = await watch({ now: MARKET, get: fake({ checkedAt: ago(MARKET, 0.1), pricing: { contact: "x" } }) });
  assert.ok(found.some((f) => f.severity === "critical" && /no numeric spread/.test(f.what)));
});

test("hours.json with no weekday is reported", async () => {
  const found = await watch({ now: MARKET, get: fake({ checkedAt: ago(MARKET, 0.1), hours: {} }) });
  assert.ok(found.some((f) => /cannot say when it is open/.test(f.what)));
});

test("a by-hand override in force is reported, but does not block", async () => {
  const found = await watch({ now: MARKET,
    get: fake({ checkedAt: ago(MARKET, 0.1), pricing: { spread: 0.1, manual: { cash: 4.0 } } }) });
  assert.ok(found.some((f) => /by-hand price is in force/.test(f.what)));
  assert.equal(report(found).blocking, 0);
});

test("the two sites disagreeing about the shared contact is flagged", async () => {
  const get = async (url) => {
    const host = url.includes("badgergrain") ? "badger" : "midwest";
    const base = fake({ checkedAt: ago(MARKET, 0.1),
      contact: host === "badger" ? "office@badgergrain.com" : "accounting@midwestagsupply.com" });
    return base(url);
  };
  const found = await watch({ now: MARKET, get });
  assert.ok(found.some((f) => f.site === "both" && /different contact addresses/.test(f.what)),
    JSON.stringify(found, null, 1));
});

test("report puts critical first and counts only what blocks", async () => {
  const found = await watch({ now: MARKET,
    get: fake({ checkedAt: ago(MARKET, 20), pricing: { spread: 0.1, manual: { cash: 4 } } }) });
  const r = report(found);
  assert.ok(r.text.indexOf("[critical]") < r.text.indexOf("[low]"), r.text);
  assert.ok(r.blocking > 0);
  assert.ok(!r.ok);
});

/* THE FIELD NAME IS THE WHOLE BUG, SO IT GETS ITS OWN TESTS. */
test("a file with only the legacy checkedAt is still aged, not called unreadable", async () => {
  const get = async (url) => {
    if (url.endsWith("/")) return { status: 200, body: "<p>$4.05</p>" };
    if (url.endsWith("bids.json"))
      return { status: 200, body: JSON.stringify({ checkedAt: ago(MARKET, 0.1),
        bids: [{ delivery: "August", cashPrice: 4.05 }] }) };
    if (url.endsWith("pricing.json"))
      return { status: 200, body: JSON.stringify({ spread: 0.1, contact: "accounting@midwestagsupply.com" }) };
    if (url.endsWith("hours.json")) return { status: 200, body: JSON.stringify({ weekday: "8:00a to 5:00p" }) };
    throw new Error("unexpected " + url);
  };
  const found = await watch({ now: MARKET, get });
  assert.equal(found.filter((f) => /no readable/.test(f.what)).length, 0,
    "an older file with checkedAt was reported as having no time at all");
});

test("a file with no time at all is still critical", async () => {
  const get = async (url) => {
    if (url.endsWith("/")) return { status: 200, body: "<p>$4.05</p>" };
    if (url.endsWith("bids.json"))
      return { status: 200, body: JSON.stringify({ bids: [{ delivery: "August", cashPrice: 4.05 }] }) };
    if (url.endsWith("pricing.json"))
      return { status: 200, body: JSON.stringify({ spread: 0.1, contact: "accounting@midwestagsupply.com" }) };
    if (url.endsWith("hours.json")) return { status: 200, body: JSON.stringify({ weekday: "8:00a to 5:00p" }) };
    throw new Error("unexpected " + url);
  };
  const found = await watch({ now: MARKET, get });
  assert.ok(found.some((f) => f.severity === "critical" && /no readable/.test(f.what)),
    "a bids.json with no time of any kind should still be critical");
});

test("a flat market is not a dead feed", async () => {
  /* pricedAt is when the price last MOVED. Ageing against it would report a
     quiet afternoon as a stopped reader, which is the confusion this file
     exists to avoid. */
  const get = async (url) => {
    if (url.endsWith("/")) return { status: 200, body: "<p>$4.05</p>" };
    if (url.endsWith("bids.json"))
      return { status: 200, body: JSON.stringify({ schema: "emmert-cash-bids/2",
        observed: ago(MARKET, 0.2), pricedAt: ago(MARKET, 30),
        bids: [{ delivery: "August", cashPrice: 4.05 }] }) };
    if (url.endsWith("pricing.json"))
      return { status: 200, body: JSON.stringify({ spread: 0.1, contact: "accounting@midwestagsupply.com" }) };
    if (url.endsWith("hours.json")) return { status: 200, body: JSON.stringify({ weekday: "8:00a to 5:00p" }) };
    throw new Error("unexpected " + url);
  };
  const found = await watch({ now: MARKET, get });
  assert.deepEqual(found.filter((f) => f.severity === "critical"), [],
    "a board read 12 minutes ago whose price last moved 30 hours ago is a quiet market, not an outage");
});
