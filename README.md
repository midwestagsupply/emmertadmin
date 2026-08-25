# emmertadmin

The staff screen: the page the office uses to change hours, the notice banner and the price.

---

## What changed in this version, and why it matters

Two things on the old screen said something that was not true, and one thing could not be
done at all.

**The USDA claim is gone.** The old screen, and the old copy of this README, said the
by-hand box showed "the USDA Wisconsin ethanol plant range" and flagged anything typed
outside it. Nothing anywhere ever fetched that figure. The range was decoration and the
promise was false, which is worse than having no check, because staff trusted it. The screen
now describes the checks that actually run and nothing else.

**Sunday hours could not be set.** `sun_open` and `sun_close` shipped with `disabled` in the
markup and `sun_closed` ticked, and nothing anywhere turned them back on. A disabled input is
also never submitted, so there was no way to open on a Sunday during harvest — the one time
of year it matters.

**The side-by-side link could shrink the screen to half and put nothing beside it.** The
guard read `if (!win && win !== null) return;`, which can never be true: a blocked popup
returns `null`, so `!win` was true and `win !== null` was false and the code carried on to
suppress the link and resize the window. The `noopener` in the feature string was the other
half of it — it makes `window.open` return `null` whether it worked or was blocked, so there
was nothing left to test.

The rest of the changes are the same kind of thing: controls that looked live and were not.

---

## Sample content, and the one rule about it

This file ships filled in — a posted board with five prices, a last-read time, today's date,
a "last saved" line, and the customer previews — so it can be opened on its own and looked
at. **None of it is a reading.** Those five prices are the most dangerous thing in the
repository, because a stale sample price is indistinguishable from a live one at a glance.

Every one of them carries a `data-sample` attribute. The screen finds them on load, outlines
them in red, and says so at the top.

> **The rule: the Worker replaces the contents AND removes the attribute. Nothing else ever
> removes the attribute.** Deleting `data-sample` by hand to quieten the warning turns the
> only thing standing between sample content and a customer straight back off.

The marked elements are: the feed status line, the `<tbody>` of the posted board, the cash
preview, today's date beside the hours heading, the today preview, the "last saved" line, and
the "signed in as" line.

---

## What serves this screen

**Nothing. There is no server any more.** Changed 2026-08-20.

This used to be a Cloudflare Worker: it served the page, checked one password,
held a session store and a per-IP lockout, and wrote `hours.json` and
`pricing.json` into whichever site repository was being edited. All of that
existed so a button could write two JSON files.

Save now builds a **prefilled GitHub issue** on the elevator being edited and
opens it. Somebody presses Submit; `.github/workflows/staff-update.yml` in that
repository runs `tools/apply-update.mjs` from here, commits the two files,
comments what it changed, and closes the issue.

What that buys: no server, no password to lose, no secret anywhere, and every
change is a commit with a name on it. What it costs: the office needs GitHub
logins with write access, it is two clicks rather than one, and the change
lands about a minute later instead of instantly.

**The authority is the GitHub account.** `apply-update.mjs` refuses any issue
whose author is not an OWNER, MEMBER or COLLABORATOR. The page itself holds no
credential of any kind — it builds a link.

### It is served by GitHub Pages

Decided 2026-08-20. Turn Pages on for this repository, from `main`, root.
The address is `https://midwestagsupply.github.io/emmertadmin/`.

**The screen is public, and that is understood.** It holds no secret and no
authority: it builds a link. Anyone can open it, fill it in and press Save —
the issue they file is then refused by `checkWhoAsked`, which only accepts an
OWNER, MEMBER or COLLABORATOR. `robots.txt` disallows everything, so it stays
out of search results.

**The screen fills itself.** The Worker used to render this page with the real
settings already in the boxes. Nothing renders it now, so the page reads
`hours.json` and `pricing.json` from the site repository and fills its own
form. Without that, every box would hold the value this file ships with and
the first Save would publish those samples over the elevator's real hours,
banner and basis. It fills only boxes nobody has typed in, and a test asserts
both halves of that.

Checked served from a subpath, not assumed: no 404s, Save enabled and pointing
at the right elevator's issues, no console errors, no false "showing filler"
warning, and every box holding what the site is actually running.

**The screen is filled in before it is served.** This file ships with sample
values in every box: a spread of `0.10`, hours of 08:00 to 17:00, a banner
about harvest. Served as it comes, the first person to press Save would write
all of that over the real settings without touching a field. The Worker fills
every box from the live files first, and clears the `data-sample` marker on
each one it fills. Anything still marked is something it could not fill, and
the screen outlines it in red and says so.

**So if you change a field in this file, change the Worker to fill it.**
There is a test in the Worker named after this. Adding a box here and not
there is how a sample value gets saved as a real one.

**Sign out is not wired up.** `SIGN_OUT_URL` is an empty string at the top of
the script and the link shows as unavailable until it is set. It used to be
`href="#"`: a live-looking link that did nothing, on a screen whose whole
premise is being behind a password.

## Where the price comes from

A GitHub Actions workflow in the **`bids`** repository reads Big River's Boyceville board —
every ten minutes in market hours, hourly outside them — and commits the numbers as JSON.
This screen's Worker reads that file and publishes. "Check again now" skips the wait.

The old copy of this README pointed at a `worker/` folder in an `emmert-sites` repository.
That path does not resolve, and the Cloudflare reader it described was replaced by the
Actions one. `bids` is the live source; do not go looking for the other.

**Two clocks come across in that file and both matter.** `pricedAt` is when their board last
showed something different, and can be days old across a quiet weekend without anything being
wrong. `checkedAt` is the last successful read, and is what goes stale if the reader has
stopped. The feed line on this screen must never quote one as the other.

---

## What the screen lets staff change

Deliberately small. Every extra field is another thing that can go wrong at six in the
morning in October.

- **The spread.** The one number on the corn card that is a decision rather than a reading.
  Their posted board is shown beside it, exactly as read, so the table itself is the check:
  open their page next to this and the two should agree line for line.
- **A price by hand.** The break-glass for when the reading is down. It overrides the feed
  until it is cleared, so the screen now opens the box and says so at the top when a value is
  sitting in it, rather than folding it away where it gets forgotten.
- **Today's hours.** Usual, different, closed, or harvest.
- **The notice banner.** On or off, and the message.
- **The regular weekly hours** and the small print under the prices.

The posted corn bid itself is not typed. A number typed every morning goes stale by
afternoon, and a wrong price is worse than no price.

---

## GitHub Pages — read the section above first

*(This section was written while a Cloudflare Worker served the screen
privately. The Worker is gone. The reasoning below is still correct about what
Pages does; whether that is now a problem is the open question above.)*

## Do not turn on GitHub Pages for this repository

Three reasons, any one of them decisive.

**A Pages site is public even when its repository is private**, on every plan below
Enterprise Cloud. Turning Pages on here publishes the staff screen to the world.

**It has to be behind a password anyway.** It changes what customers see. Anyone who finds it
can change your grain prices.

**The Save button cannot work on a file host.** The form posts to `/save`, and a static host
has nothing there and no way to add it.

What is in this repository is the finished **look and layout** of the screen. Keeping the
files in git is exactly right; just do not point a website at them.

To look at it now, open `index.html` in a browser. Everything works except Save — and the red
outlines will be showing, which is correct: nothing has filled the samples in.

**This repository is public.** Nothing in it is secret — no keys, no passwords, no customer
data — but it does describe the staff screen in detail. That is a decision worth making on
purpose rather than by default.

---

## Uploading a new version through the browser

**1.** Open github.com/midwestagsupply/emmertadmin.

**2.** **Add file → Upload files** at the top right of the file list.

**3.** Drag in the files you are replacing. To replace only `index.html`, drag only
`index.html`; GitHub commits over the old one. Nothing else is touched.

**4.** Scroll down, leave the commit message, click **Commit changes**.

If you are ever uploading the whole thing from a zip: unzip it, open the folder so you can
see `index.html`, `admin.css`, `assets` and `fonts`, select those **and not the folder around
them**, and drag those in. Dragging the folder itself puts everything one level too deep and
the repository ends up containing a single folder instead of the files.

---

## What is in here

```
index.html    the screen
admin.css     how it looks
assets/       logo artwork and the browser tab icon
fonts/        both typefaces, bundled
```

Owned by the Emmert companies.
