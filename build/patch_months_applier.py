#!/usr/bin/env python3
"""Teach the applier the per-month table the new basis screen sends.

    python3 build/patch_months_applier.py <repo-root>

WHY ONE FIELD AND NOT TWENTY-TWO. Eleven delivery months, a basis and a tick
each, is forty-four controls on a screen carrying two elevators -- and the issue
body is a URL, capped at 7,500 characters by index.html and by GitHub not far
above that. Twenty-two headings per issue would also mean twenty-two entries in
the ROUTED map that keeps the screen and this file level, which is a list nobody
would keep true for long.

So the months travel as ONE field whose value is a small table a person can read
in the issue before pressing Submit:

    ### Months -- what we publish

    September  -0.85  show
    October    -0.95  show
    November   same   hide

`same` means no basis of its own: that month falls through to the cash or
new-crop basis, which is what a blank box means on the screen. `show` and `hide`
are the tick.

Every edit goes through sub(), which asserts its anchor matches exactly once.
"""
import sys, pathlib

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
p = root / "tools/apply-update.mjs"
src = p.read_text(encoding="utf-8")

def sub(text, old, new, label):
    n = text.count(old)
    assert n == 1, f"{label}: anchor matched {n} times, expected 1"
    return text.replace(old, new)

# ── 1. the parser, beside the other readers ────────────────────────────────
src = sub(src,
'''/* A checkbox on a GitHub issue form comes across as "- [X] label" or "- [ ] label". */''',
'''/* The twelve names a delivery month may have. Not a formality: the value of
   this field is typed into a URL by a browser and read back by a workflow, and
   "Setpember" quietly writing a month nothing will ever match is worse than a
   refusal somebody can read. */
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* ---- the per-month table ----------------------------------------------
 *
 * One field, not twenty-two. Lines of
 *
 *     September  -0.85  show
 *
 * where the middle column is a basis or the word `same`, and the last is the
 * tick. Returns the object that goes into pricing.json, so what this function
 * accepts and what a site reads are one shape rather than two.
 *
 * REFUSES AN EMPTY TICK SET. A table where every month says `hide` publishes
 * nothing, and a site with nothing to publish falls back to "Call for today's
 * price". That may be what somebody wants one day, but it is not what anybody
 * means by pressing Save on a price screen, so it has to be said some other
 * way than by unticking everything.
 */
export function months(text) {
  const rows = String(text ?? "").split(/\\r?\\n/).map((l) => l.trim()).filter(Boolean);
  if (!rows.length) throw new Refused("the months table arrived empty");
  const out = {};
  for (const row of rows) {
    const m = /^(\\S+)\\s+(\\S+)\\s+(show|hide)$/i.exec(row);
    if (!m)
      throw new Refused(
        `“${row}” is not a line this form can read. Each line is a month, a basis ` +
        `or the word same, then show or hide — for instance “October -0.95 show”.`);
    const [, month, rawBasis, tick] = m;
    if (!MONTH_NAMES.includes(month))
      throw new Refused(`“${month}” is not a delivery month`);
    if (month in out) throw new Refused(`${month} is on the months table twice`);
    const b = /^same$/i.test(rawBasis) ? null : basis(rawBasis, `the ${month} basis`);
    out[month] = { basis: b, publish: /^show$/i.test(tick) };
  }
  if (!Object.values(out).some((v) => v.publish))
    throw new Refused(
      "no delivery month is ticked to show, so the site would have no price to " +
      "publish and would go back to “Call for today’s price”. Tick at least one.");
  return out;
}

/* A checkbox on a GitHub issue form comes across as "- [X] label" or "- [ ] label". */''',
"months parser")

# ── 2. the branch that writes it ───────────────────────────────────────────
src = sub(src,
'''  /* ---- THE OLD SPREAD HEADINGS, WHICH STILL MEAN A SPREAD ----------------''',
'''  /* ---- WHICH MONTHS THE SITE PUBLISHES, AND WHAT EACH ONE PAYS ----------
   *
   * The whole table arrives or none of it does: this field is built from every
   * row on the screen every time, so what it carries IS the new state. It is
   * compared before it is written, like everything else here, because a Save
   * that reports "months updated" on a day nobody touched them is the bug the
   * comment at the top of applyUpdate describes.
   *
   * p.months is created only inside this branch. Creating it unconditionally
   * would add a key to pricing.json on a form that never mentioned months --
   * which test/admin.test.mjs asserts does not happen.
   */
  if ("Months — what we publish" in form) {
    const raw = form["Months — what we publish"];
    if (raw == null)
      throw new Refused(
        "the months table cannot be emptied. Untick the months you do not want " +
        "shown, leaving at least one ticked.");
    const table = months(raw);
    if (JSON.stringify(table) !== JSON.stringify(p.months ?? null)) {
      p.months = table;
      const shown = Object.keys(table).filter((k) => table[k].publish);
      const priced = Object.entries(table)
        .filter(([, v]) => v.publish && v.basis != null)
        .map(([k, v]) => `${k} ${v.basis < 0 ? "" : "+"}${v.basis.toFixed(2)}`);
      did.push(
        `The site now shows ${shown.length} delivery month${shown.length === 1 ? "" : "s"}: ` +
        `${shown.join(", ")}.` +
        (priced.length ? ` Basis set on ${priced.join(", ")}.` : ""));
    }
  }

  /* ---- THE OLD SPREAD HEADINGS, WHICH STILL MEAN A SPREAD ----------------''',
"months branch")

p.write_text(src, encoding="utf-8")
print("tools/apply-update.mjs patched")
