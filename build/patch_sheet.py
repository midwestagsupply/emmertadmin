#!/usr/bin/env python3
"""Rebuild the staff screen as one sheet: both elevators, side by side, on two
screens instead of three tabs of stacked cards.

    python3 build/patch_sheet.py <repo-root>

Every edit goes through sub(), which asserts its anchor matches exactly once.
The markup, the layout CSS and the new script all live in build/parts/ so this
file is the splice and not the content.
"""
import sys, pathlib

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
parts = root / "build/parts"

def sub(text, old, new, label):
    n = text.count(old)
    assert n == 1, f"{label}: anchor matched {n} times, expected 1"
    return text.replace(old, new)

def cut(text, start, end, new, label):
    i = text.find(start); j = text.find(end, i)
    assert i >= 0 and j > i, f"{label}: region not found"
    assert text.count(start) == 1, f"{label}: start matched {text.count(start)} times"
    return text[:i] + new + text[j + len(end):]

html = (root / "index.html").read_text(encoding="utf-8")

# ── 1. the sheet replaces the elevator switch and the empty floor ──────────
html = cut(html,
  '<!-- The two elevators. Both are live forms.',
  '<div class="floor" id="floor"></div>',
  (parts / "main.html").read_text(encoding="utf-8").rstrip() + "\n",
  "sheet markup")

# ── 2. the column definition ───────────────────────────────────────────────
html = cut(html,
  '    <div class="col-hd">',
  '    </form>\n  </section>',
  (parts / "col.html").read_text(encoding="utf-8").rstrip() + "\n  </section>",
  "column markup")

# ── 3. the rail carries two screens, not three ─────────────────────────────
html = cut(html,
  '  <button type="button" class="rail-b" data-go="overview" aria-current="true">',
  '  <button type="button" class="rail-b" data-go="basis">',
  '''  <!-- OVERVIEW IS GONE, NOT MOVED BEHIND A NARROWER DOOR. It was six lines
       of what one elevator is publishing, behind a tab. Both elevators now fit
       on one line each in their own column header, on every screen, always on.
       A tab is a promise that there is enough behind it to be worth the trip. -->
  <button type="button" class="rail-b" data-go="basis" aria-current="true">''',
  "rail buttons")

# ── 4. the rare-things toggle went with the cards it folded ────────────────
html = cut(html,
  '      <!-- Collapses the two panels that say "changes rarely"',
  'weekly hours &amp; small print<span class="rare-caret" aria-hidden="true"></span></button>\n',
  '''      <!-- THE "weekly hours & small print" TOGGLE IS GONE. It existed to
           fold two cards that were rarely changed out of a column of stacked
           cards. There is no column of stacked cards: the weekly hours are
           three rows of one table and the small print is one more, all of them
           on screen at once, and folding a row of a table hides nothing worth
           hiding. -->
''',
  "rare button")

# ── 5. the top bar ─────────────────────────────────────────────────────────
# THE HEADER IS ONE LINE NOW. It was two 33px wordmarks, a row of keys and a
# separate feed panel -- 170px of chrome above a screen whose whole argument is
# that eleven delivery months fit under it. The wordmarks said which two
# elevators this is; the sheet says that in every column heading, in their own
# colours, on both screens.
html = cut(html,
  '  <div class="wrap">\n    <div class="marks">',
  '  </div>\n</header>',
  """  <b class="brand">EMMERT</b>
  <nav class="tabs" id="rail" aria-label="Screens">
    <button type="button" class="rail-b" data-go="basis" aria-current="true">
      <span class="rail-t">Basis</span><span class="rail-s">What we post under Big River</span>
    </button>
    <button type="button" class="rail-b" data-go="hours">
      <span class="rail-t">Hours &amp; notices</span><span class="rail-s">Today, the banner, the week</span>
    </button>
  </nav>
  <!-- The two per-elevator summary lines that lived here are gone; see
       col.html. What is left in this bar is the state of the SCREEN -- whether
       the feed was read, what time it is, the help key and the handbook --
       none of which is said anywhere else. -->
  <span class="feednote" id="feedNote"></span>
  <span class="railclock" id="railClock"></span>
  <button type="button" class="helpkey" id="helpBtn" aria-pressed="false"
          title="Show or hide the explanatory text (?)">? help</button>
  <a class="docs" href="handbook.html">Handbook</a>
</header>""",
  "top bar")

# The rail used to be its own sidebar; it is the two tabs in the bar above.
html = cut(html, '<nav class="rail" id="rail"', '</nav>', '', "old rail")

# THE LINK TO THEIR BOARD COMES BACK. It sat above the read-only copy of Big
# River's board; that copy is the basis screen now, and the link went with the
# markup around it. It is the one thing on this screen that lets somebody check
# our board against theirs line for line, which is the whole reason the board is
# on it -- so it belongs in the bar, beside the feed line that says how fresh it
# is. Fetching their page is still forbidden; this opens it for a person.
html = sub(html,
  '  <a class="docs" href="handbook.html">Handbook</a>',
  '  <a class="docs" id="brOpen" href="https://www.bigriverbids.com/cashbidssingle-2121"\n'
  '     target="_blank" rel="noopener noreferrer">Their board</a>\n'
  '  <a class="docs" href="handbook.html">Handbook</a>',
  "their board link")


# THE OLD BOARD TABLE GOES; see the note it is replaced with.
html = cut(html,
  '        <div class="board">',
  '</p>\n        </div>',
  "        <!-- The board that used to live here IS the basis screen now: the\n             month rows of the sheet below, each carrying that month's tick,\n             basis box and posted price for both elevators. Left in place it\n             was a hidden table still holding the five sample rows the file\n             ships with, which the screen's own filler guard could still find\n             and warn about. What remains of this strip is the feed liveness\n             line, which is about the READER and not about the board. -->",
  "old board table")

(root / "index.html").write_text(html, encoding="utf-8")
print("index.html: markup spliced")

# ── 5. the script ──────────────────────────────────────────────────────────
js = (root / "index.html").read_text(encoding="utf-8")
sheet = (parts / "sheet.js").read_text(encoding="utf-8")

# 5b. one elevator at a time is gone: both are on every screen now.
js = cut(js,
  '''  /* ---- one elevator at a time, on a phone ---''',
  '''    showOnly(shown);
  }''',
  '''  /* ---- BOTH ELEVATORS, ON EVERY SCREEN ----------------------------------
     There used to be a chip row that showed one elevator at a time below
     1440px, because two columns of stacked cards could not both fit. The sheet
     places the same cells six wide under 1200px instead -- shared row, then
     Badger's cells, then Midwest's -- so nothing has to be hidden and Save can
     never carry a column that is not on the screen, because both always are.

     ?site= is still honoured for an old bookmark: it says which column opens
     focused, and nothing else. */
  var wanted = (location.search.match(/[?&]site=([^&#]*)/i) || [])[1];
  wanted = wanted ? decodeURIComponent(wanted).toLowerCase() : "";
  var shown = Object.prototype.hasOwnProperty.call(SITES, wanted) ? wanted : "badger";''',
  "elev switch")

# 5c. the old table-drawing pair, replaced above.
js = cut(js,
  '  function drawBoard(j) {',
  '''        });
      });
  }''',
  '  /* drawBoard() and fillPosts() are defined with the rest of the sheet. */',
  "old drawBoard/fillPosts")

# 5a. the new machinery goes in after the two columns are stamped.
js = sub(js,
'''  var COLS = {};
  Object.keys(SITES).forEach(function (site) { COLS[site] = stamp(site); });''',
'''  var COLS = {};
  Object.keys(SITES).forEach(function (site) { COLS[site] = stamp(site); });

''' + sheet.rstrip() + "\n",
  "sheet machinery")

# 5d. the board is drawn or it is not; there is no sample table to ask any more.
js = sub(js,
"""  function boardVerdict() {
    var tb = STRIP ? STRIP.querySelector("tbody") : null;
    if (tb && tb.hasAttribute("data-sample")) {""",
"""  function boardVerdict() {
    /* THE SHIPPED SAMPLE TABLE IS GONE WITH THE STRIP. The basis rows are drawn
       from the feed or they are not there at all, so the question this answers
       is now "did the read land", not "is that filler". */
    if (!boardDrawn) {""",
  "boardVerdict")
js = sub(js,
"""      gwarn("The price board below is the sample this screen ships with, not a " +
            "reading from Big River. Do not quote it.", "strip:filler");""",
"""      gwarn("Big River's board has not been read yet, so the months below are " +
            "empty. Nothing here is a price.", "strip:filler");""",
  "boardVerdict text")

# 5e. the CBOT settles are wanted before the first draw, not after it.
js = sub(js,
"""  if (fl) {
    if (flGo) flGo.addEventListener("click", checkFeed);
    checkFeed();
  }""",
"""  if (fl) {
    if (flGo) flGo.addEventListener("click", checkFeed);
    /* The settles first, so the Futures column is filled on the first draw
       rather than on a redraw nobody triggers. A failure to read them is not a
       reason to hold up the board: SETTLES stays null and the column says so. */
    loadSettles().then(checkFeed, checkFeed);
  }""",
  "settles before feed")

# 5f. the rail moves between two screens, and moving between them is a relayout.
js = sub(js,
"""      if (tab === "settings") tab = "hours";
      document.body.setAttribute("data-tab", tab);""",
"""      /* Two screens now. Anyone whose browser remembers "settings" or
         "overview" as their last tab lands on the basis screen, which is the
         one this terminal exists for. */
      if (tab === "settings" || tab === "overview") tab = "basis";
      document.body.setAttribute("data-tab", tab);""",
  "go() tabs")
js = sub(js,
"""      syncOver();
      /* What is outlined depends on which tab is showing""",
"""      /* THE SHEET IS PLACED PER SCREEN, so changing screen is a relayout. The
         two screens do not have the same columns or the same rows, and a grid
         still holding the other one's tracks is where dead space comes from. */
      layout();
      syncOver();
      /* What is outlined depends on which tab is showing""",
  "go() relayout")
js = sub(js,
"""    var want = "overview";
    try { want = localStorage.getItem("emmert-tab") || want; } catch (e) { /* ignore */ }
    if (!btns.some(function (b) { return b.getAttribute("data-go") === want; })) want = "overview";""",
"""    var want = "basis";
    try { want = localStorage.getItem("emmert-tab") || want; } catch (e) { /* ignore */ }
    if (!btns.some(function (b) { return b.getAttribute("data-go") === want; })) want = "basis";""",
  "go() default")

# 5g. syncOver ran only while the overview tab was showing. The figures it
#     copies are in every column header now, on both screens, all the time.
js = sub(js,
"""  function syncOver() {
    if (document.body.getAttribute("data-tab") !== "overview") return;""",
"""  function syncOver() {""",
  "syncOver gate")

# 5h. the Save says the elevator's short name. "Save Midwest Commodity Service"
#     wrapped the command bar onto two lines beside an Undo button; the column it
#     sits under is already headed with the full name in the elevator's colour.
js = sub(js,
"""    node.querySelectorAll(".save-who").forEach(function (el) {""",
"""    node.querySelectorAll(".save-who").forEach(function (el) { el.textContent = SHORT[site]; });
    node.querySelectorAll(".save-who-never").forEach(function (el) {""",
  "short save label")
js = sub(js,
"""  var TOWN    = { badger: "Wheeler",     midwest: "Baldwin" };""",
"""  var TOWN    = { badger: "Wheeler",     midwest: "Baldwin" };
  /* The name on the button. The full one is in the column header above it, in
     this elevator's own colour, so the button does not have to carry it. */
  var SHORT   = { badger: "Badger",      midwest: "Midwest" };""",
  "SHORT map")


# 5i. byId falls back to the stamped id, because the live strip moved out of the
#     sheet and into the top bar. Every [data-id] in a column is stamped
#     id="<site>-<data-id>", so the fallback is exact rather than a guess, and one
#     lookup serves an element whether it sits in the column or in the bar above.
js = sub(js,
    """    var byId = function (id) { return root.querySelector('[data-id="' + id + '"]'); };""",
    """    var byId = function (id) {
      return root.querySelector('[data-id="' + id + '"]') ||
             document.getElementById(site + "-" + id);
    };""",
    "byId fallback")

# 5j. syncOver writes into the bar as well as the column, for the same reason.
js = sub(js,
    """      var put = function (id, txt) {
        var el = root.querySelector('[data-id="' + id + '"]');
        if (el) el.textContent = txt || "\\u2014";
      };""",
    """      var put = function (id, txt) {
        var el = root.querySelector('[data-id="' + id + '"]') ||
                 document.getElementById(site + "-" + id);
        if (el) el.textContent = txt || "\\u2014";
      };""",
    "syncOver put")

js = sub(js,
    """      var bidRows = [].slice.call(root.querySelectorAll('[data-id="prevBid"] .pb-row'));""",
    """      var prevBidEl = root.querySelector('[data-id="prevBid"]') ||
                      document.getElementById(site + "-prevBid");
      var bidRows = prevBidEl ? [].slice.call(prevBidEl.querySelectorAll(".pb-row")) : [];""",
    "syncOver prevBid")

# 5k. (stamp() no longer moves anything: the live strip is gone.)


# 5l. the feed line is one phrase in the bar, not a panel above the sheet.
js = sub(js,
    """  function setFeed(kind, html) {""",
    """  function setFeed(kind, html) {
    /* THE SAME WORDS, IN A LINE INSTEAD OF A PANEL. The panel was 60px tall and
       said "nothing for you to do" nine times out of ten. The whole sentence is
       still in the strip below for the days it is not. */
    var note = document.getElementById("feedNote");
    if (note) {
      var t = document.createElement("div");
      t.innerHTML = html;
      note.textContent = (t.textContent || "").replace(/\\s+/g, " ").trim();
      note.className = "feednote is-" + kind;
    }""",
    "feed note")


# 5m. THE BASIS READOUT READS THE SHEET, NOT THE OLD BOARD TABLE.
#     cellNum/monthOf/quoteOf all asked #boardStrip for `tr.is-ref td.basis-cell`.
#     That table still exists, hidden, still carrying the five sample rows the
#     file ships with -- so the readouts were either silent or, worse, arithmetic
#     on filler. They read the month rows of the sheet now, which is where the
#     board actually is, and the "is this filler" guard becomes "has the board
#     been drawn at all".
js = sub(js,
    """    function cellNum(sel) {
      var cell = STRIP && STRIP.querySelector(sel);
      var tb = STRIP && STRIP.querySelector(".bd tbody");
      /* A sample board is not a source. While the marker is still on the
         table, this screen has no idea what their basis is and says nothing,
         rather than saying something it made up. */
      if (!cell || !tb || tb.hasAttribute("data-sample")) return null;""",
    """    function cellNum(sel) {
      var cell = floor && floor.querySelector(sel);
      /* A board that has not been drawn is not a source. Until the feed lands
         this screen has no idea what their basis is and says nothing, rather
         than saying something it made up. */
      if (!cell || !boardDrawn) return null;""",
    "cellNum reads the sheet")

js = sub(js,
    """      refBasis = cellNum("tr.is-ref td.basis-cell");""",
    """      refBasis = cellNum(".cell.basis-cell.is-ref");""",
    "refBasis selector")
js = sub(js,
    """      newBasis = cellNum("tr.is-new td.basis-cell");""",
    """      newBasis = cellNum(".cell.basis-cell.is-new");""",
    "newBasis selector")

js = sub(js,
    """      function monthOf(row) {
        var tb = STRIP && STRIP.querySelector(".bd tbody");
        var tr = STRIP && STRIP.querySelector(row);
        if (!tr || !tb || tb.hasAttribute("data-sample")) return null;
        var t = tr.children[1] ? tr.children[1].textContent.trim() : "";
        return (t && t !== "\\u2014") ? t : null;
      }""",
    """      function monthOf(row) {
        var el = floor && floor.querySelector(row);
        if (!el || !boardDrawn) return null;
        /* The contract is carried on the basis cell itself rather than read out
           of the cell beside it: a position in a row is a thing that moves when
           somebody adds a column, and this has to keep naming the contract. */
        var t = (el.getAttribute("data-contract") || "").trim();
        return (t && t !== "\\u2014") ? t : null;
      }""",
    "monthOf")

js = sub(js,
    """      function quoteOf(row) {
        var tb = STRIP && STRIP.querySelector(".bd tbody");
        var tr = STRIP && STRIP.querySelector(row);
        if (!tr || !tb || tb.hasAttribute("data-sample")) return null;
        var q = parseFloat(tr.getAttribute("data-quote"));
        return isFinite(q) ? q : null;
      }""",
    """      function quoteOf(row) {
        var el = floor && floor.querySelector(row);
        if (!el || !boardDrawn) return null;
        var q = parseFloat(el.getAttribute("data-quote"));
        return isFinite(q) ? q : null;
      }""",
    "quoteOf")

for old, new, label in [
    ('line(monthOf("tr.is-ref"), refBasis, c, quoteOf("tr.is-ref"))',
     'line(monthOf(".cell.basis-cell.is-ref"), refBasis, c, quoteOf(".cell.basis-cell.is-ref"))',
     "cash readout row"),
    ('(monthOf("tr.is-new") ? " &middot; " + monthOf("tr.is-new") : "")',
     '(monthOf(".cell.basis-cell.is-new") ? " &middot; " + monthOf(".cell.basis-cell.is-new") : "")',
     "new crop label"),
    ('line(monthOf("tr.is-new"), theirNew, h, quoteOf("tr.is-new"))',
     'line(monthOf(".cell.basis-cell.is-new"), theirNew, h, quoteOf(".cell.basis-cell.is-new"))',
     "new crop readout row"),
    ('var el = STRIP && STRIP.querySelector("tr.is-ref td.basis-cell");',
     'var el = floor && floor.querySelector(".cell.basis-cell.is-ref");',
     "nobasis warning"),
]:
    js = sub(js, old, new, label)

# 5n. the months field travels, which means it needs a heading like every other.
js = sub(js,
    """      spread: "Our basis — cash",""",
    """      /* ONE FIELD FOR ELEVEN MONTHS. Twenty-two headings would not fit the
         7,500-character cap this screen enforces below, and would mean twenty-two
         more entries in the map that keeps this screen and the applier level. */
      months: "Months — what we publish",
      spread: "Our basis — cash",""",
    "months label")

# 5p2. "IS THIS PAGE STILL UNFILLED" IS NOT A QUESTION ANY MORE.
# It was answered by sniffing for a display element still carrying data-sample,
# because the page used to be rendered by a Worker that arrived with the real
# settings already in the boxes -- so "a sample is still on screen" meant "the
# Worker did not run". The Worker was removed on 2026-08-20. Served from Pages,
# EVERY box holds what the file ships with until a fetch fills it, always, so
# the sniff can only ever be true; and on 2026-09-09 it started being false by
# accident, because the one display element carrying the marker moved onto board
# cells that do not exist yet when this runs. Measured: six time boxes still
# holding their shipped hours with no outline on them, on a column whose files
# had failed to load. That is the exact fault the marker exists to prevent.
# A fill removes both attributes from the box it fills (see putVal), and typing
# removes them too, so the marks come off the moment anything real arrives.
js = sub(js,
    '    var pageUnfilled = qs("[data-sample]:not(input):not(textarea):not(select)") !== null;',
    """    /* Always. Nothing renders this page with real values before the office
       sees it, so every box holds its shipped value until a fetch or a person
       replaces it -- and both of those take the marker off. See patch step 5p2. */
    var pageUnfilled = true;""",
    "the page always ships unfilled")

# 5o/5p. THE FILLER WALKERS ARE COLUMN-SCOPED AGAIN. All three of these steps
#        existed only because the live strip was stamped inside the column and
#        then moved out of it into the top bar, so a walker scoped to the
#        column stopped seeing the one display element carrying data-sample.
#        The strip is gone (see col.html) and nothing leaves the column now, so
#        the original one-line walkers are correct as written. The marker they
#        look for moved onto the ON THE SITE cells, which are the sample data
#        this screen actually ships with -- see drawBoard and fillPosts.


# 5q. (the guard lives in build/parts/sheet.js, beside the function it guards)


# 5r. A THIRD ADDRESS GETS A THIRD NAMED CONSTANT. The CBOT settle is the one
#     figure on this screen that comes from neither Big River's reader nor the
#     two sites, and a literal URL inside a function is exactly the shape the
#     serving test exists to refuse: there is then no single place to change
#     when the answer moves, and the copy that gets forgotten is the one nobody
#     is looking at.
js = sub(js,
    """  var STRIP = document.getElementById("boardStrip");""",
    """  /* THE CBOT SETTLE, and the only address on this screen outside the reader
     and the two sites. It is what the Futures column shows beside Big River's
     own quote, so the gap between the two is printed rather than implied. */
  var SETTLES_URL = "https://raw.githubusercontent.com/dnilgis/agsist/main/data/prices.json";

  var STRIP = document.getElementById("boardStrip");""",
    "SETTLES_URL constant")
# (sheet.js already uses the name; nothing to rewrite here.)


# 5s. EVERY PRICE ON THIS SCREEN IS PRINTED TO THE CENT. Sig, 2026-09-08: "i
#     always want to round the corn price to the hundreds only." The board rows
#     are handled where they are drawn; these are the three that print a price
#     somewhere else -- the basis readout, the customer preview and the
#     what-changed list -- and leaving them at four decimals would have put
#     "$5.33" and "$5.3325" on the same screen, describing the same number.
js = sub(js,
    """               (quote != null ? (month ? " at " : "") + "$" + quote.toFixed(4) : "") +""",
    """               (quote != null ? (month ? " at " : "") + "$" + quote.toFixed(2) : "") +""",
    "readout quote to cents")
js = sub(js,
    """              return typeof v === "number" ? "$" + moneyQ(v) : "\\u2014";""",
    """              return typeof v === "number" ? "$" + v.toFixed(2) : "\\u2014";""",
    "preview to cents")
js = sub(js,
    """        var money2 = function (v) { return v == null ? "" : moneyQ(Number(v)); };""",
    """        var money2 = function (v) { return v == null ? "" : Number(v).toFixed(2); };""",
    "changed-list to cents")


# 5t. THE BASIS IS CHECKED WHERE IT IS NOW TYPED.
#     The two fallback boxes were the only basis this screen validated, and they
#     are gone -- Sig, 2026-09-08: "why do we need fallback basis at all, just
#     the month selector is sufficient with the enter the basis." Without this,
#     nothing on the screen would refuse a fat finger: the applier and both sites
#     still cap at $1.50, so the refusal would arrive as a comment on a filed
#     issue, one save too late. That is the exact gap the by-hand check below was
#     written to close, re-opened on the box that is now the whole job.
js = sub(js,
    """      [[cashBox, "Our basis — cash", true],
       [cropBox, "Our basis — new crop", false]].forEach(function (p) {
        var el = p[0]; if (!el) return;
        var v = el.value.trim();""",
    """      [].slice.call(qsa(".cell.ctl[data-month] input.mbasis")).map(function (el) {
        return [el, "basis for " + (el.closest("[data-month]") || {}).getAttribute("data-month")];
      }).forEach(function (p) {
        var el = p[0]; if (!el) return;
        var v = el.value.trim();""",
    "per-month basis validation")

# The refusal has to name the month AND the elevator, or it names neither: two
# columns of eleven boxes each is twenty-two places a bad number can be.
js = sub(js,
    """        else if (Math.abs(parseFloat(v)) > 1.5) out.push("The " + p[1] + " box, “" + v + "”, is $" +""",
    """        else if (Math.abs(parseFloat(v)) > 1.5) out.push("The " + p[1] + ", “" + v + "”, is $" +""",
    "refusal wording")

# AND IT POINTS AT THE BOX. The cap branch pushed a sentence and left the field
# unmarked, which was survivable with two basis boxes on the screen and is not
# with twenty-two: "the basis for October" is a sentence, and the outline is
# what puts a finger on the row.
js = sub(js,
    """          Math.abs(parseFloat(v)).toFixed(2) + " from zero — past the $1.50 limit the site will " +
          "accept. If that is really the number it has to be changed in pricing.json, " +
          "so that it takes two people to notice.");""",
    """          Math.abs(parseFloat(v)).toFixed(2) + " from zero — past the $1.50 limit the site will " +
          "accept. If that is really the number it has to be changed in pricing.json, " +
          "so that it takes two people to notice."), markBad(el);""",
    "cap marks the box")


# 5u. BY HAND IS BREAK GLASS, so it is behind the glass rather than beside the
#     board. Sig, 2026-09-08: "why do we need the whole post a price by hand
#     thing at the bottom, isnt that what we are doing up top anyway?"
#     Almost. Every box on the board is a row of Big River's board, so when their
#     feed cannot be read there are no rows and nothing to type in -- and this is
#     the only way to put a price up at all. That is a different job from the one
#     the board does, and it is the only day it matters. On every other day it
#     was a panel taking space on a screen about something else.
js = sub(js,
    """    boardDrawn = true;""",
    """    boardDrawn = true;
    document.body.setAttribute("data-board", "on");""",
    "board drawn flag on the body")
js = sub(js,
    """  var boardDrawn = false;""",
    """  var boardDrawn = false;
  /* Set before anything is read, so the by-hand panel is on screen for the
     moment between load and the first answer -- the state where somebody who
     has come to post a price by hand because they already know the feed is down
     should not have to wait to be shown the box. */
  document.body.setAttribute("data-board", "off");""",
    "board flag starts off")

# ── 5u2. the Today line is computed, not read back off a cell ──────────────
# The "On the site" column is gone from the hours screen, and the top bar's
# TODAY chip was built out of that column's own text. The line is still worked
# out the same way; it is now stamped on the column instead of drawn into it,
# so the chip is unchanged and the cell is unnecessary. Measured before the
# cut: "Open today, Wednesday \u00b7 8:00a to 5:00p" -- get() joined the
# preview's two divs with that separator, so the stamp spells it out.
js = sub(js,
    """    var prevToday = byId("prevToday");
""", "", "today preview element: gone")
js = sub(js,
    """    function syncTodayPreview() {
      if (!prevToday) return;""",
    """    function syncTodayPreview() {""",
    "today line: no cell to guard on")
# The Today preview cell is gone, and so is the chip its text fed. `label` and
# `hours` are still worked out for the sentence below, which is the one thing in
# that column that was never a readback: what the SITE does on its own after
# closing time. It now sits under the Today buttons.
js = sub(js,
    """      prevToday.innerHTML = "";
      var l = document.createElement("div"); l.className = "l"; l.textContent = label;
      var h = document.createElement("div"); h.className = "h"; h.textContent = hours;
      prevToday.appendChild(l); prevToday.appendChild(h);
      prevToday.classList.toggle("is-shut", hours === "Closed");""",
    """      void label;   /* the line itself is no longer drawn */""",
    "today line: no longer drawn")

# ── 5u3. the week and banner previews are gone with their column ───────────
# syncWeekPreview built the "Mon to 8:00a to 5:00p" block; syncBanner wrote
# "Nothing. The yellow bar is hidden." Both wrote into cells that no longer
# exist. The guards below them (`if (!prevWeek) return`, `if (prevNotice)`)
# would have kept the screen working with the functions doing nothing at all,
# which is worse than deleting them: a reader six months from now finds a
# preview builder and goes looking for the preview.
# THE WEEK PREVIEW IS GONE; THE SUMMARY BESIDE "USUAL" IS NOT.
# The first cut of this set `prevWeek = null` and let the function's own
# `if (!prevWeek) return` switch it off -- which also switched off the sentence
# beside the "Usual" button. That sentence is still on the screen, it is the
# option staff are told to leave selected, and it went straight back to
# describing the hours the page shipped with while the boxes under it said
# something else. Caught by "the summary beside 'usual hours' is derived, not
# hand-typed", which is the test that exists for exactly that sentence, and it
# is the failure the comment two steps above warned about: a builder left in
# place doing nothing is worse than one deleted.
# So the preview is CUT and the summary kept.
js = cut(js,
    """    function syncWeekPreview() {
      if (!prevWeek) return;
      prevWeek.innerHTML = "";""",
    """        prevWeek.appendChild(row);
      });""",
    """    /* What is left of the function that drew the week preview column: the
       sentence beside "Open, usual hours", which is on the screen and has to
       follow the boxes under it. The column itself is gone; see col.html. */
    function syncWeekPreview() {""",
    "week preview cut, summary kept")
js = sub(js, '    var prevWeek = byId("prevWeek");\n', "", "week preview: no element")
js = sub(js,
    'var prevNotice = qs(".prev-notice");',
    'var prevNotice = null; /* the banner preview column is gone; see col.html */',
    "banner preview: no element")

# ── 5v. the refusal no longer calls a month a box ──────────────────────────
# The label reaching this sentence used to be a card's name ("Our basis — cash"),
# so "the ... box" read correctly. Every box that reaches it now is one month in
# the table, labelled "basis for October", and the sentence came out as "The
# basis for October box, "zz", is not a number." The limit refusal two rules
# below never said "box" and reads correctly; this one now matches it.
js = sub(js,
    'out.push("The " + p[1] + " box, \u201c" + v + "\u201d, is not a number.")',
    'out.push("The " + p[1] + ", \u201c" + v + "\u201d, is not a number.")',
    "refusal wording: month is not a box")

# ── 5w. syncOver() and the second bids.json read go with the strip ─────────
# syncOver existed to fill the chips and nothing else -- every put() in it
# addressed a data-id that lived inside .livechips. It was wired to `input` and
# `change` on the document, capturing, so it ran on every keystroke anywhere on
# the screen to write text into elements that no longer exist.
# The tab switch called it too, to re-copy the form into the chips on a change
# of screen. There are no chips to copy into.
js = sub(js,
    """      layout();
      syncOver();""",
    """      layout();""",
    "tab switch stops calling syncOver")
js = cut(js, "  function syncOver() {",
         "  document.addEventListener(\"change\", syncOver, true);",
         "  /* syncOver() is gone with the strip it filled; see col.html. */",
         "syncOver")
# And the chip's own copy of bids.json. fillPosts() reads the same file and
# puts a figure on every month rather than two; this read filled prevBid, which
# was hidden inside the strip and shown nowhere.
js = cut(js, '        fetch(LIVE_BASE + repo + "/main/bids.json" + bust, { cache: "no-store" })',
         '          }, function () { /* leave whatever the Worker rendered; see rule 3 */ });',
         "        /* The strip's own bids.json read is gone; fillPosts() has it. */",
         "chip bids read")

(root / "index.html").write_text(js, encoding="utf-8")
print("index.html: script spliced")

# ── 6. the stylesheet ──────────────────────────────────────────────────────
css = (root / "admin.css").read_text(encoding="utf-8")
i = css.find(".hd-acts{ display:flex; align-items:center; gap:12px; margin-left:auto; }")
assert i > 0, "admin.css: cut point not found"
keep = css[: i + len(".hd-acts{ display:flex; align-items:center; gap:12px; margin-left:auto; }")]

# Rules in the kept half that laid out the cards and the old sticky save bar.
for old, label in [
  ('.card{ background:var(--paper); border:1px solid var(--line); border-radius:var(--radius);\n        overflow:hidden; }', 'card box'),
]:
    if old in keep:
        keep = keep.replace(old, "/* .card is gone with the cards. */")

keep += "\n\n/* ---- everything below this line was the console, the phone layer, the tab\n" \
        "     system and the rail, all of which laid out a screen that no longer\n" \
        "     exists. Replaced wholesale rather than overridden: two layouts fighting\n" \
        "     in one stylesheet is how the board came to paint over the tabs. ---- */\n"
keep += (parts / "layout.css").read_text(encoding="utf-8")
(root / "admin.css").write_text(keep, encoding="utf-8")
print(f"admin.css: {css.count(chr(10))} lines -> {keep.count(chr(10))} lines")
