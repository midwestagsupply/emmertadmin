/* THE DOMAIN DOC IS A PAGE SOMEBODY TYPES NUMBERS OFF.
 *
 * Kristi opens dns.html, reads four IP addresses, and types them into GoDaddy.
 * A transposed digit there does not fail loudly: the domain simply never opens,
 * and the failure looks like "DNS is slow" for a day. So the addresses are
 * checked here against the ones GitHub publishes, character for character, and
 * so is every other instruction on the page that can be got wrong.
 *
 * The four A records and four AAAA records below were read from
 * docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site
 * /managing-a-custom-domain-for-your-github-pages-site on 2026-09-12. They are
 * GitHub's, they are the same for every site they host, and they change about
 * never -- but they are typed twice in this repository now (the doc and this
 * file), which is exactly the arrangement that catches a typo in either.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = readFileSync(join(ROOT, "dns.html"), "utf8");
const screen = readFileSync(join(ROOT, "index.html"), "utf8");

const A = ["185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"];
const AAAA = ["2606:50c0:8000::153", "2606:50c0:8001::153",
              "2606:50c0:8002::153", "2606:50c0:8003::153"];

test("all four A records are there, exactly, and no others", () => {
  for (const ip of A)
    assert.equal((doc.match(new RegExp(ip.replace(/\./g, "\\."), "g")) || []).length, 1,
      `${ip} should appear exactly once`);
  /* AND NOTHING THAT LOOKS LIKE AN ADDRESS BUT IS NOT ONE. A fifth number on
     the page is either a typo or an address from somewhere else, and either
     way somebody will type it. */
  const found = doc.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || [];
  assert.deepEqual([...new Set(found)].sort(), [...A].sort());
});

test("the IPv6 addresses too, and they are marked optional", () => {
  for (const ip of AAAA) assert.ok(doc.includes(ip), ip);
  const found = doc.match(/2606:[0-9a-f:]+/g) || [];
  assert.deepEqual([...new Set(found)].sort(), [...AAAA].sort());
  assert.match(doc, /optional/i, "AAAA is not required and the page must say so");
});

test("www points at the organisation, not at a person", () => {
  /* midwestagsupply.github.io. A user account's github.io would resolve and
     serve the wrong thing, or nothing. */
  assert.match(doc, /midwestagsupply\.github\.io/);
  assert.doesNotMatch(doc, /\bdnilgis\.github\.io/,
    "that is a personal account; these repositories belong to the organisation");
  assert.match(doc, /CNAME/, "the www job has to name the record type");
});

test("the email warning is on the page, and it says stop rather than be careful", () => {
  /* The one change on that screen that breaks something a business needs the
     same hour. "Be careful" is not an instruction; "stop and ring" is. */
  assert.match(doc, /\bMX\b/);
  const flag = doc.slice(doc.indexOf('class="flag"'), doc.indexOf('class="flag"') + 900);
  assert.match(flag, /\bMX\b/, "the MX warning must be in the flagged box, not buried in prose");
  assert.match(flag, /stop|Stop/);
  assert.match(flag, /ring Sig/i);
});

test("the domain that must not be touched is named", () => {
  const i = doc.indexOf("midwestagsupply.com");
  assert.notEqual(i, -1, "midwestagsupply.com is not mentioned at all");
  assert.match(doc.slice(i, i + 260), /Leave alone|leave alone/,
    "it is in the table but not marked as hands-off");
});

test("the two live domains are shown as already done, not as work", () => {
  for (const d of ["badgergrain.com", "midwestcommodity.com"]) {
    const i = doc.indexOf(d);
    assert.notEqual(i, -1, d);
    assert.match(doc.slice(i, i + 220), /Already set up/,
      `${d} is live; telling Kristi to re-point it is how a working site breaks`);
  }
});

test("it is reachable from the staff screen", () => {
  assert.match(screen, /href="dns\.html"/,
    "a document nobody can find is a document nobody reads");
});

test("it runs on nothing: no script, no outside request", () => {
  /* Same rule as the sites. This one is on the admin repo, which does use
     JavaScript elsewhere -- but a page of instructions has no reason to, and a
     page that fetches from a font host is a page that renders wrong on a bad
     rural connection. */
  assert.doesNotMatch(doc, /<script/i);
  const hosts = [...doc.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]);
  assert.deepEqual([...new Set(hosts)], [], "dns.html names an outside host: " + hosts.join(", "));
});

test("the numbers a person types are in a monospace cell, not in prose", () => {
  /* A proportional font renders 1 and l alike and 0 and O alike. Every address
     on this page sits in a .mono cell for that reason. */
  for (const ip of [...A, ...AAAA]) {
    const i = doc.indexOf(ip);
    const before = doc.slice(Math.max(0, i - 120), i);
    assert.match(before, /class="mono"/, `${ip} is not in a monospace cell`);
  }
});
