/* watch-live.mjs — the only thing in this system that looks at the LIVE sites.
 *
 * WHY IT EXISTS. Every other check in this project runs at BUILD time, inside
 * a repository, before anything is published: prices.yml and hours.yml both
 * run `node --test test/*.test.mjs` before they write, the admin suite runs on
 * push, and the publisher refuses a price outside FLOOR-CEILING or a feed
 * older than FEED_MAX_AGE_H. That machinery is good and it is not the gap.
 *
 * The gap is that NOTHING LOOKS AT WHAT IS ACTUALLY SERVED. If a scheduled
 * workflow silently stops -- GitHub drops crons, a job fails and nobody reads
 * the email -- the sites go on serving whatever was last committed, and the
 * first person to notice is a farmer reading a price that is three days old.
 * That is not hypothetical: it is exactly what happened to the COT page on
 * agsist, where the runs were green and the page was a week behind.
 *
 * WHAT IT WILL NOT DO. It does not re-derive a price. The rounding rule lives
 * in each site's update-prices.mjs and gets exactly one implementation; a
 * watchdog that recomputed "we pay" would be a second one, and the first
 * disagreement of a tenth of a cent would be the watchdog's fault, not the
 * site's. It checks TIMES, SHAPES and AGREEMENT -- never arithmetic.
 *
 * The fetcher is injected so every branch below is tested offline against
 * fixtures. The network call itself is the one line these tests cannot cover,
 * and it is deliberately the only line they cannot cover.
 */

export const SITES = [
  { key: "badger",  host: "badgergrain.com",      name: "Badger Grain Supply" },
  { key: "midwest", host: "midwestcommodity.com", name: "Midwest Commodity Service" },
];

/* The site publisher stops trusting a reading at 14 hours and falls back to
   "Call for today's price". Read from the site's own published record rather
   than retyped here, when the record carries it; this is the fallback for a
   record that does not. */
export const FEED_MAX_AGE_H = 14;

/* During market hours the sites rebuild every ten minutes. Three misses is a
   generous bar for "something has stopped" without firing on one dropped
   cron, which GitHub does routinely. */
export const CRON_STALE_MIN = 35;

const hoursBetween = (a, b) => Math.abs(a - b) / 36e5;

/* Sunday=0. The scrapers run 12-21 UTC Monday to Friday; outside that window
   a still checkedAt is expected and says nothing about the cron. */
export function inMarketHours(now) {
  const d = now.getUTCDay(), h = now.getUTCHours();
  return d >= 1 && d <= 5 && h >= 12 && h < 21;
}

export async function checkSite(site, { now, get }) {
  const bad = [];
  const say = (severity, what) => bad.push({ site: site.key, severity, what });

  let page, bids, pricing, hours;
  try { page = await get(`https://${site.host}/`); }
  catch (e) { say("critical", `the site did not answer: ${e.message}`); return bad; }
  if (page.status !== 200) {
    say("critical", `the site answered HTTP ${page.status}`);
    return bad;
  }

  for (const [name, target] of [["bids", "bids.json"], ["pricing", "pricing.json"], ["hours", "hours.json"]]) {
    let r;
    try { r = await get(`https://${site.host}/${target}`); }
    catch (e) { say("critical", `${target} did not answer: ${e.message}`); continue; }
    if (r.status !== 200) { say("critical", `${target} answered HTTP ${r.status}`); continue; }
    let parsed;
    try { parsed = JSON.parse(r.body); }
    catch { say("critical", `${target} is not readable JSON, so the site is publishing from a broken file`); continue; }
    if (name === "bids") bids = parsed;
    if (name === "pricing") pricing = parsed;
    if (name === "hours") hours = parsed;
  }
  if (!bids) return bad;

  /* ---- is the site telling the truth about its own freshness? ------------
     Two claims have to agree: how old the reading is, and whether the page is
     showing a figure. A page showing a price from a reading it has itself
     given up on is the one failure that puts a wrong number in front of a
     farmer, and it is invisible from inside the repository. */
  /* THE FIELD THE SITES ACTUALLY PUBLISH.
   *
   * This read `bids.checkedAt` and failed both live sites at 23:33 on
   * 2026-08-24 with "carries no readable checkedAt". The sites were fine. The
   * watchdog was wrong: `emmert-cash-bids/2` publishes
   *
   *     observed   when the board was last READ      23:43, a minute ago
   *     pricedAt   when the price last MOVED         19:09, four hours ago
   *     generated  when this file was last written
   *
   * and no checkedAt at all. Fifteen tests passed against it because the test
   * fixture invented `checkedAt` too -- the code and its tests agreed with
   * each other and both disagreed with the thing being watched.
   *
   * `observed` is the right one and the choice matters. The age limit asks
   * "has anything looked at the board lately"; `pricedAt` would answer "has
   * the price moved lately", so a flat afternoon would read as a dead feed --
   * the exact confusion update-prices.mjs warns about at its own FEED_MAX_AGE.
   *
   * checkedAt is still accepted, second, so an older file is aged rather than
   * called unreadable. */
  const stampField = ["observed", "checkedAt", "generated"]
    .find((k) => Number.isFinite(Date.parse(bids[k])));
  const checked = stampField ? Date.parse(bids[stampField]) : NaN;
  const showsPrice = Array.isArray(bids.bids) && bids.bids.length > 0
                     && bids.bids.some((b) => typeof b.cashPrice === "number");
  const callForPrice = /call for/i.test(page.body);

  if (!Number.isFinite(checked)) {
    say("critical", "bids.json carries no readable observed, checkedAt or generated time, " +
      "so nothing can tell how old the price is");
  } else {
    const age = hoursBetween(now, checked);
    const maxAge = typeof bids.maxAgeH === "number" ? bids.maxAgeH : FEED_MAX_AGE_H;

    if (age > maxAge && showsPrice)
      say("critical", `the reading is ${age.toFixed(1)}h old, past the ${maxAge}h the site itself will accept, ` +
                      `and the site is STILL PUBLISHING A PRICE from it`);
    if (age <= maxAge && !showsPrice && callForPrice)
      say("high", `the reading is only ${age.toFixed(1)}h old but the site is showing ` +
                  `"Call for today's price" -- it is refusing a price it should be able to post`);
    if (age > maxAge && !showsPrice)
      say("low", `the reading is ${age.toFixed(1)}h old and the site has correctly fallen back to ` +
                 `"Call for today's price". Nothing is wrong on the page; the READER has stopped.`);

    /* ---- has the pipeline stopped? ------------------------------------
       The strongest signal available without any credential: how old the
       reading the site is serving actually is, during the window when it is
       supposed to be refreshed every ten minutes. */
    if (inMarketHours(now) && age * 60 > CRON_STALE_MIN)
      say("high", `it is market hours and this site's newest reading is ${Math.round(age * 60)} minutes old ` +
                  `(expected under ${CRON_STALE_MIN}). The scheduled run has probably stopped.`);
  }

  /* ---- the staff-editable files still make sense ---------------------- */
  if (hours && typeof hours === "object") {
    if (!("weekday" in hours))
      say("high", "hours.json has no weekday, so the site cannot say when it is open");
  }
  if (pricing && typeof pricing === "object") {
    if (typeof pricing.spread !== "number")
      say("critical", "pricing.json has no numeric spread, so what the site pays is undefined");
    if (pricing.manual != null)
      say("low", "a by-hand price is in force on this site, overriding the automatic reading");
  }

  return bad;
}

export async function watch({ now = new Date(), get }) {
  const found = [];
  const seen = {};
  for (const site of SITES) {
    found.push(...await checkSite(site, { now, get }));
    try {
      const r = await get(`https://${site.host}/pricing.json`);
      if (r.status === 200) seen[site.key] = JSON.parse(r.body);
    } catch { /* already reported above */ }
  }

  /* ---- the two sites must agree about the things they share ------------
     One office runs both elevators and both footers carry the same address.
     They have disagreed before: Badger's address was once published on
     Midwest's feed as Midwest's own. */
  const a = seen.badger, b = seen.midwest;
  if (a && b && a.contact && b.contact && a.contact !== b.contact)
    found.push({ site: "both", severity: "high",
      what: `the two sites publish different contact addresses ("${a.contact}" and "${b.contact}"). ` +
            `One office runs both; one of these is wrong.` });

  return found;
}

export function report(found) {
  const rank = { critical: 0, high: 1, low: 2 };
  const sorted = [...found].sort((x, y) => rank[x.severity] - rank[y.severity]);
  const bad = sorted.filter((f) => f.severity !== "low");
  const lines = sorted.map((f) => `  [${f.severity}] ${f.site}: ${f.what}`);
  return { ok: bad.length === 0, text: lines.join("\n"), blocking: bad.length };
}

/* ---- the entry point CI uses ------------------------------------------
   The only place a real network call is made. Everything above is pure and
   tested; this is deliberately three lines so there is almost nothing here
   for a test to have missed. */
export async function main() {
  const get = async (url) => {
    const r = await fetch(url, { cache: "no-store", headers: { "user-agent": "emmert-watchdog" } });
    return { status: r.status, body: await r.text() };
  };
  const found = await watch({ now: new Date(), get });
  const r = report(found);
  console.log(r.text || "  nothing to report; both sites are current.");
  if (!r.ok) {
    console.log(`\n${r.blocking} thing(s) need attention. This run is failing so it is not ignorable.`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
