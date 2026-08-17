# emmertadmin

The staff screen: the page the office uses to change hours, the notice banner and the price.

---

## Uploading this into the existing `emmertadmin` repository

Good news first: **this is the easy one.** No hidden files, no workflow, nothing GitHub's web
uploader refuses. Eighteen files and it just works.

**1. Open the repository** at github.com/midwestagsupply/emmertadmin.

**2. Get to the uploader.**

- If the repository is **completely empty**, the page has a line saying
  "…or **uploading an existing file**". Click that.
- If it already has anything in it, even just a README, use the **Add file** button at the top
  right of the file list → **Upload files**.

**3. Unzip this folder, open it, and select everything INSIDE it.**

This is the one place people go wrong, so it is worth being fussy about.

- Open the `emmert-admin` folder so you can see `index.html`, `admin.css`, `assets`, `fonts`
  and `README.md`
- Select all five of those, `Ctrl+A` on Windows or `Cmd+A` on a Mac
- Drag them onto the browser window

**Do not drag the `emmert-admin` folder itself.** If you do, everything lands one level too
deep and the repository will contain a single folder instead of the files.

You should see a list appear including `assets/corn-left.png` and `fonts/inter-500.woff2`,
with the folder names in the paths. That is right; folders come along on their own.

**4. Scroll down, leave the commit message as it is, click "Commit changes".**

**If the repository already had a README.md**, this replaces it. GitHub does not warn you; it
just commits over it. If there was anything in the old one worth keeping, copy it out first, or
rename this file to `SITE-README.md` before uploading.

**5. Check it looks right.** The repository front page should list, at the top level:

```
assets
fonts
README.md
admin.css
index.html
```

If instead you see a single folder called `emmert-admin`, that is the mistake from step 3. In
the browser the quickest fix is to delete that folder (open it, then each file, then the bin
icon) and upload again. Annoying but not damaging; nothing is live off this repository.

---

## Do not turn on GitHub Pages for this repository

Three reasons, any one of them decisive.

**A Pages site is public even when its repository is private**, on every plan below Enterprise
Cloud. Turning Pages on here publishes the staff screen to the world.

**It has to be behind a password anyway.** It changes what customers see. Anyone who finds it
can change your grain prices.

**The Save button cannot work on a file host.** The form posts to `/save`, and a static host has
nothing there and no way to add it.

So what is in this repository is the finished **look and layout** of the screen. The part that
makes Save actually save has to be built on something that runs code. Keeping the files in git
is exactly right; just do not point a website at them.

To look at it now, unzip and open `index.html` in a browser. Everything works except Save.

---

## Where it ends up eventually

Somewhere that runs code: a Cloudflare Worker, a small VPS, any shared host with PHP. It only
has to serve one page, check one password, accept one form post, and write a file.

Its own address, not on badgergrain.com or midwestcommodity.com. It does not need a
memorable one. Bookmark whatever the host gives you. Nothing on the public sites changes, and
nothing advertises that an admin panel exists.

The `worker/` folder in the `emmert-sites` repository is a working starting point. It already
polls the price and commits on a schedule, and the same Worker can serve this page and take its
form post.

---

## What the screen lets staff change

Four things, on purpose. Every extra field is another thing that can go wrong at six in the
morning in October.

- **Today's corn bid.** Big River's posted number and the spread. The site does the subtraction,
  and Big River's own board is shown right beside the field so nobody has to go hunting in
  another tab.
- **Today's hours.** Usual, different, closed, or harvest.
- **The notice banner.** On or off, and the message.
- **The regular weekly hours** and the small print under the prices.

Feed prices are not hand-editable, because a number typed every morning goes stale by afternoon
and a wrong price is worse than no price. The bid entry is the deliberate exception and it is
guarded: the screen shows the USDA Wisconsin ethanol plant range beside the field and flags
anything typed outside it, which is what stops $44.20 going live instead of $4.42.

---

## What is in here

```
index.html    the screen
admin.css     how it looks
assets/       logo artwork and the browser tab icon
fonts/        both typefaces, bundled
```

Owned by the Emmert companies.
