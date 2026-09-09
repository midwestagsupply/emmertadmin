  /* ══════════════════════════════════════════════════════════════════════
     PLACEMENT
     ══════════════════════════════════════════════════════════════════════
     Every cell says which logical row it belongs to (data-row), which of an
     elevator's three columns it wants (data-col: a, b, c, or a run like "bc"),
     and which screen it is on (data-tab). layout() turns that into real grid
     coordinates for the tab that is showing.

     ROWS ARE ASSIGNED CONTIGUOUSLY, which is the whole reason this is script
     and not a stylesheet. A grid row that is numbered but empty is still a
     track, and an empty track is dead space -- the thing this screen was
     rebuilt to get rid of. Only the rows actually on screen get a number, in
     order, with no gaps.

     AND IT PLACES THE SHEET TWICE. Over 1200px the twelve columns are the
     screen. Under it the same cells go six wide, shared cells full width and
     each elevator's beneath them, which is the only honest thing to do with
     twelve columns on a phone. Same markup both times. */
  var COL_BASE = { badger: 7, midwest: 10 };
  var SPAN = { a: [0, 1], b: [1, 2], c: [2, 3], ab: [0, 2], bc: [1, 3], abc: [0, 3] };
  /* What each elevator is called when there is no room for what it is called.
     Same word as its own Save button, so the two cannot drift apart. */
  var SHORT = { badger: "Badger", midwest: "Midwest" };
  /* Big River's basis by delivery month, filled by drawBoard. */
  var THEIRS = {};
  var wide = null;

  function layout() {
    var sheet = floor;
    if (!sheet) return;
    var tab = document.body.getAttribute("data-tab") || "basis";
    /* `all` is both screens at once. Nothing in the office ever sees it -- the
       tabs cannot produce it -- but a test that reaches for every control on
       the page needs one state where every control has a row. */
    var showAll = tab === "all";
    var isWide = matchMedia("(min-width: 1260px)").matches;
    var cells = [].slice.call(sheet.querySelectorAll(".cell"));

    /* The logical rows on this screen, in the order their data-row sorts. A
       month row's id is "M" + its place on the board, so they sort after the
       static ones and among themselves in the board's own order. */
    var order = {}, seen = {};
    cells.forEach(function (c) {
      var t = c.getAttribute("data-tab");
      if (t && !showAll && t !== tab) return;
      var r = c.getAttribute("data-row");
      if (!r || r === "1" || r === "2" || r === "99") return;
      if (!seen[r]) { seen[r] = true; }
    });
    /* THE MONTHS COME FIRST. They are the screen: eleven rows a person ticks
       and types in. Everything else on the basis screen is a fallback nobody
       touches in a normal week, and it used to sit ABOVE them -- a hundred and
       eighty pixels of rarely-used boxes between the header and the board.
       Sig, 2026-09-08: "i want the basis page to read like the lower portion".
       So: month rows in board order, then whatever is numbered after them. */
    Object.keys(seen).sort(function (a, b) {
      var na = a.charAt(0) === "M", nb = b.charAt(0) === "M";
      if (na !== nb) return na ? -1 : 1;
      return parseFloat(a.replace("M", "")) - parseFloat(b.replace("M", ""));
    }).forEach(function (r, i) { order[r] = i; });

    var n = Object.keys(order).length;
    var sizes = [];
    var lines = [];

    if (isWide) {
      /* row 1 is the two column headers, row 2 the column names. */
      sizes.push("auto", "auto");
      var rowFlex = {};
      cells.forEach(function (c) {
        var r = c.getAttribute("data-row");
        if (r in order && c.hasAttribute("data-flex")) rowFlex[r] = true;
      });
      Object.keys(order).forEach(function () {});
      var byIndex = [];
      Object.keys(order).forEach(function (r) { byIndex[order[r]] = r; });
      /* A CEILING ON THE FLEX ROWS. `1fr` let eleven month rows share every
         spare pixel of a tall desk, which is how a row holding one checkbox,
         one box and two figures came to be 71px of mostly air -- and reading
         across 71px of nothing is what made the table look loose even after
         the clutter came out of it. 52px is a comfortable target for a finger
         and about as tall as the tallest thing in the row. The slack that used
         to be spread down the table now sits under it, as one margin instead
         of eleven gaps -- the same move the columns just made sideways. */
      byIndex.forEach(function (r) {
        sizes.push(rowFlex[r] ? "minmax(34px, 52px)" : "auto");
      });
      sizes.push("auto");                                    // the save row
      cells.forEach(function (c) {
        var r = c.getAttribute("data-row");
        var elev = c.closest ? c.closest(".col") : null;
        var site = elev && elev.getAttribute("data-elev");
        var base = site ? COL_BASE[site] : 1;
        var span = parseInt(c.getAttribute("data-rowspan") || "1", 10);
        c.style.gridRow = r === "1" ? "1" : r === "2" ? "2"
          : r === "99" ? String(n + 3)
          : (order[r] + 3) + (span > 1 ? " / span " + span : "");
        if (c.classList.contains("colhd")) {
          c.style.gridColumn = base + " / " + (base + 3);
        } else if (c.classList.contains("col-save")) {
          c.style.gridColumn = base + " / " + (base + 3);
        } else if (site) {
          var sp = SPAN[c.getAttribute("data-col") || "a"] || SPAN.a;
          c.style.gridColumn = (base + sp[0]) + " / " + (base + sp[1]);
        } else if (!c.style.gridColumn) {
          c.style.gridColumn = "1 / 7";
        }
        c.classList.remove("narrow-head");
        c.removeAttribute("data-head");
        c.removeAttribute("data-who");
      });
      lines = sizes;
    } else {
      /* NARROW: one logical row becomes a small block, not a stack of cells.
         The first version gave every cell its own row -- twelve rows a month,
         a hundred and forty-eight in all -- which is not a card, it is a list
         of fragments.

         The basis screen PACKS: the six market facts two to a line, then each
         elevator's tick, basis and posted price on one line of its own behind
         its own colour. That is the mock, and it is what fits a month into two
         hundred pixels instead of eight hundred.

         The hours screen STACKS: its cells hold a four-way choice, a pair of
         time boxes and a sentence, and none of those survive a third of a
         phone. Full width each. */
      /* THE HEADINGS, FOR A SCREEN THAT HAS NO HEADING ROW.
         On a phone the row of column headings is dropped -- there are no
         columns left to head -- and the six market figures came out as
         "$5.33 · $5.33 -0.25c · −0.75 · $4.58" with nothing saying which was
         the futures, which was Big River's quote and which was their basis.
         Four dollar figures in a stack, one of them the number the basis is
         set against and one of them somebody else's bid. Measured on a 430px
         render before this went in.
         Read out of the heading cells themselves rather than typed here, so
         the phone cannot start calling a column something the desk does not. */
      var HEADS = cells.filter(function (c) {
        return c.getAttribute("data-row") === "2" && !c.closest(".col") &&
               (c.getAttribute("data-tab") || tab) === tab;
      }).map(function (c) { return (c.textContent || "").trim(); });

      var at = 1;
      var byIndexN = [];
      Object.keys(order).forEach(function (r) { byIndexN[order[r]] = r; });
      var full = function (c, row) { c.style.gridRow = String(row); c.style.gridColumn = "1 / -1"; };

      cells.forEach(function (c) {
        var r = c.getAttribute("data-row");
        if (r === "1") { full(c, at); if (c.classList.contains("colhd")) at++; }
        else if (r === "2") { c.style.gridRow = ""; c.style.gridColumn = ""; }
      });
      at++;

      byIndexN.forEach(function (r) {
        var mine = cells.filter(function (c) {
          var t = c.getAttribute("data-tab");
          return c.getAttribute("data-row") === r && (!t || showAll || t === tab);
        });
        var shared = mine.filter(function (c) { return !c.closest(".col"); });
        var first = true;
        if (tab === "basis" && shared.length > 1) {
          /* A MONTH IS TWO LINES, NOT THREE RAGGED ONES.
             Sig, 2026-09-09: "htha mobile expierience looks like a hot mess".
             He was right. Five figures packed two to a line left the fifth
             alone on a line of its own with half the phone empty beside it,
             and the pairs did not line up down the block: CONTRACT sat over
             THEIR BASIS sat over nothing.

                 September  cash          CONTRACT Dec 26
                 FUTURES $5.33  -0.25c    THEIR BASIS -0.75
                 THEIR BID $4.58

             Now the name and its contract take the first line, and the three
             figures share the second, each a third of the width, so they line
             up as columns down the whole board the way they do on the desk. */
          var NARROW = ["1 / 4", "4 / 7", "1 / 3", "3 / 5", "5 / 7"];   // see LINE
          var LINE   = [0, 0, 1, 1, 1];
          shared.forEach(function (c, i) {
            c.style.gridRow = String(at + (LINE[i] === undefined ? Math.floor(i / 2) : LINE[i]));
            c.style.gridColumn = NARROW[i] || "1 / 7";
            /* The month names itself; the figures do not. */
            if (i > 0 && HEADS[i]) c.setAttribute("data-head", HEADS[i]);
            c.classList.toggle("narrow-head", first); first = false;
          });
          at += 2;
        } else {
          shared.forEach(function (c) {
            full(c, at); c.classList.toggle("narrow-head", first); first = false; at++;
          });
        }
        ["badger", "midwest"].forEach(function (site) {
          var group = mine.filter(function (c) {
            var col = c.closest(".col");
            return col && col.getAttribute("data-elev") === site;
          });
          if (!group.length) return;
          var packable = tab === "basis" && group.length === 3 &&
                         !group.some(function (c) { return c.classList.contains("wide"); });
          group.forEach(function (c, i) {
            c.setAttribute("data-elev", site);
            /* THE SHORT NAME ON A PHONE. "Midwest Commodity Service" wrapped
               to three lines beside a 42px box and made every elevator block
               taller than the four figures above it; the column it heads is
               already the elevator's own colour and the Save button under it
               says the same word. The full name is on the block above. */
            c.setAttribute("data-who", i === 0 ? (SHORT[site] || SITES[site]) : "");
            if (packable) {
              c.style.gridRow = String(at);
              c.style.gridColumn = ["1 / 3", "3 / 5", "5 / 7"][i];
              /* The elevator's own name heads the first cell of its line, so
                 the tick and the box are placed. The third is a dollar figure
                 sitting on its own next to another dollar figure, and only the
                 heading says one is ours and the other is what is published. */
              if (i === 2 && HEADS[HEADS.length - 1])
                c.setAttribute("data-head", HEADS[HEADS.length - 1]);
            } else {
              full(c, at + i);
            }
          });
          if (group[0] && !shared.length && !first) group[0].classList.add("narrow-head");
          at += packable ? 1 : group.length;
        });
      });
      /* The two Saves share the last row, side by side, because a sticky footer
         two rows tall would hide the row above it -- which on the first phone
         render was Badger's own Save. */
      var sv = 0;
      cells.forEach(function (c) {
        if (c.getAttribute("data-row") !== "99") return;
        if (c.classList.contains("foot-note")) { c.style.gridRow = ""; return; }
        c.style.gridRow = String(at);
        c.style.gridColumn = sv === 0 ? "1 / 4" : "4 / 7";
        sv++;
      });
      at++;
      lines = null;
    }

    sheet.style.gridTemplateColumns = isWide
      ? (tab !== "hours"
          /* PACKED, NOT SPREAD. Every column is sized to the widest thing it
             holds and no wider; the fr shares are small and equal so what slack
             there is spreads evenly instead of opening a gap between a heading
             and the figures under it. Sig: "reduce wasted space bigtime. left
             hand justify, orderly." */
          /* EVERY COLUMN IS ITS OWN CONTENT WIDE, AND ONE TRAILING TRACK TAKES
             THE REST. Sig, 2026-09-09: "i just wanted wasted space tightend
             up, remember to justify everthing left".

             The old template gave every column an fr share, so slack was
             spread evenly down the table: a 46px checkbox column resolved to
             197px on a wide desk and the tick sat alone at the left of it with
             a hand's width of nothing to its right. Sharing the slack is what
             MAKES the wasted space -- eleven columns each holding a little of
             it reads as a table that has come apart.

             So: max-content on the columns that hold a figure, a fixed width
             on the two that hold a box, and one greedy track at the end. The
             table packs hard against the left edge and whatever the desk has
             spare lands in a single margin on the right, where it is margin
             rather than eleven gaps. Track 6 is the gutter the "Their quote"
             cut left; it is the one place a deliberate space is wanted, so it
             is the one fixed non-zero gap. */
          /* fit-content(), NOT max-content. THE FAULT, live 2026-09-09: Sig's
             own screen scrolling sideways with a checkbox column 226px wide.
             `max-content` lets ANY cell in a track set that track's width, and
             the widest thing in these columns is not a figure -- it is the save
             bar's own "Live on the site - last change Sep 4 7:52 AM by
             midwestagsupply", which only exists once a site has been saved.
             The test fixture never carried that line, so eleven window sizes
             passed here and the real screen needed 1792px and cut Midwest off.
             Measured both ways: with the line, SHOW resolved to 226px and the
             sheet to 1792; without it, 58px and 1418.
             fit-content(N) caps a track at N however wide its contents are, so
             a long sentence in the save row wraps instead of shoving the board
             sideways. The caps are each column's real content plus a little. */
          ? "fit-content(190px) fit-content(96px) fit-content(122px) " +
            "fit-content(98px) fit-content(98px) 26px " +
            "fit-content(64px) 112px fit-content(112px) " +
            "fit-content(64px) 112px fit-content(112px) minmax(0, 1fr)"
          /* The minimums add up to what the screen actually needs: two time
             boxes wide enough to show AM/PM is 256, and 130 + (100+256+120)*2
             is 1082, which fits the 1200px this layout starts at. The first
             set totalled 1190 and the hours screen scrolled sideways at 1280. */
          /* Only the two time columns carry a real minimum -- 256 is two boxes
             wide enough to show AM/PM. Everything else is free to take what is
             left, because a definite minimum on twelve tracks is twelve chances
             for a fractional pixel to land outside the box, and eight of them
             did at 1200. */
          /* THE TWO 1.1fr TRACKS ARE NOW 0px: they held the "On the site"
             preview, which Sig cut on 2026-09-09 as a readback of the boxes
             beside it. Zeroed rather than deleted because the grid is twelve
             tracks wide on both screens and the elevator group headings, the
             save bars and every `bc`/`abc` span are placed against those
             numbers -- renumbering the hours screen alone is how a heading
             ends up over the wrong column. A 0px track with nothing in it
             takes no room, which is the whole point of the cut; a track that
             kept its 1.1fr and lost its cell is exactly the dead space he has
             been asking me to stop leaving. The width goes to the text boxes,
             which is where the small print and the banner message live. */
          : "minmax(0,.85fr) 0px 0px 0px 0px 0px minmax(0,1.1fr) minmax(256px,1.55fr) " +
            "0px minmax(0,1.1fr) minmax(256px,1.55fr) 0px")
      : "repeat(6, minmax(0, 1fr))";
    sheet.style.gridTemplateRows = lines ? lines.join(" ") : "";
    sheet.style.gridAutoRows = lines ? "" : "auto";
    wide = isWide;
  }

  /* Exposed for the test harness, which has to re-place the sheet after it sets
     a state the tabs cannot reach. Nothing on the page calls it this way. */
  window.__layout = layout;

  var layoutPending = null;
  function relayout() {
    if (layoutPending) return;
    layoutPending = requestAnimationFrame(function () { layoutPending = null; layout(); });
  }
  window.addEventListener("resize", relayout);

  /* ══════════════════════════════════════════════════════════════════════
     THE MONTHS THIS ELEVATOR PUBLISHES
     ══════════════════════════════════════════════════════════════════════
     One hidden field per column carries the whole table, because forty-four
     visible controls would not fit the 7,500-character cap this screen already
     enforces on the issue URL, and would mean twenty-two more entries in the
     map that keeps this screen and the applier level.

     The value is lines of "September -0.85 show" -- a table a person can read
     on the issue page before pressing Submit. `same` means the month has no
     basis of its own and falls through to the cash or new-crop box above.

     WHAT IT STARTS AS. The months the site is publishing today, read from its
     own pricing.json. If it has never been set -- which is every site right now
     -- the default is the nearest delivery and the first new-crop month, which
     is exactly what the page shows today. So saving without touching anything
     publishes what is already published. */
  var MONTHS = {};        // site -> { Month: {basis: string, publish: bool} }
  var MONTH_ORDER = [];   // board order

  function monthsField(site) {
    var col = COLS[site];
    return col ? col.querySelector('[data-id="months"]') : null;
  }
  /* SEEDING IS NOT TYPING. writeMonths fires an input event so the unsaved-work
     guard, the previews and the refusal checks see this table the way they see
     every other field. It is also called while the screen reads what each site
     is publishing -- eleven months, twice, and again after a save -- and that
     armed the guard over work nobody had done: the office pressed Save, the tab
     opened, and the screen still said they had unsaved changes. Only a real
     change, made by a person, fires. */
  var seeding = 0;
  function writeMonths(site) {
    var f = monthsField(site);
    if (!f) return;
    var t = MONTHS[site] || {};
    var was = f.value;
    f.value = MONTH_ORDER.filter(function (m) { return t[m]; }).map(function (m) {
      var v = String(t[m].basis == null ? "" : t[m].basis).trim();
      return m + " " + (v === "" ? "same" : v) + " " + (t[m].publish ? "show" : "hide");
    }).join("\n");
    if (f.value === was || seeding) return;
    var ev = document.createEvent("HTMLEvents");
    ev.initEvent("input", true, false);
    f.dispatchEvent(ev);
  }
  function seedMonths(site, pricing) {
    seeding++;
    try { seedMonthsInner(site, pricing); } finally { seeding--; }
  }
  function seedMonthsInner(site, pricing) {
    var t = MONTHS[site] = MONTHS[site] || {};
    var have = pricing && pricing.months && typeof pricing.months === "object" ? pricing.months : null;
    /* What this site prices a month on today, out of its own pricing.json. On
       the basis path that is `basis` and `basisHarvest`; a site still on the old
       spread path has neither, and its boxes open empty and mean "leave it as it
       is", which is what an empty box has always meant here. */
    var num = function (v) { return typeof v === "number" && isFinite(v) ? String(v) : ""; };
    var cash = pricing ? num(pricing.basis) : "";
    var crop = pricing && pricing.basisHarvest != null ? num(pricing.basisHarvest) : cash;
    MONTH_ORDER.forEach(function (m, i) {
      if (t[m]) return;
      if (have && have[m])
        t[m] = { basis: have[m].basis == null ? "" : String(have[m].basis),
                 publish: have[m].publish === true, mine: true };
      else {
        /* A SITE WITH NO MONTHS TABLE STILL PUBLISHES TWO MONTHS -- the
           nearest delivery and the first new crop -- off its two global basis
           figures. Those two are live prices, so they are `mine` and Big
           River's board must not touch them, exactly like a month the file
           names. It is the other nine, which the site prices nothing on, that
           take their board as a starting point. */
        var live = i === 0 || m === firstNewCrop();
        t[m] = { basis: NEW_CROP.indexOf(m) !== -1 ? crop : cash,
                 publish: live, mine: live };
      }
    });
    fromTheirBoard(site);
    writeMonths(site);
  }
  /* THEIR BASIS IS THE DEFAULT ON A MONTH THIS SITE DOES NOT PRICE YET.
     Sig, 2026-09-09: "big rivers is their for reference and as the default if a
     month box is selected on the site".

     A month the site already publishes keeps the site's own figure -- that is
     what is live and nothing here may move it. Every other month used to open
     holding the site's ONE global basis, so ticking March offered whatever
     September happened to be set at: a number with nothing to do with March,
     four contracts and eight months away. Big River quote a basis for every
     month on the board, and their March basis is the only sensible thing to
     start a March price from.

     `mine` says where a row's figure came from. It is set false only for a
     month the site's own pricing.json says nothing about, and push() drops it
     the moment somebody types in the box or ticks it -- after that the row is
     theirs and nothing reseeds it. */
  function fromTheirBoard(site) {
    var t = MONTHS[site];
    if (!t) return;
    Object.keys(t).forEach(function (m) {
      if (t[m].mine) return;
      if (typeof THEIRS[m] !== "number") return;
      t[m].basis = String(THEIRS[m]);
    });
  }

  function firstNewCrop() {
    for (var i = 0; i < MONTH_ORDER.length; i++)
      if (NEW_CROP.indexOf(MONTH_ORDER[i]) !== -1) return MONTH_ORDER[i];
    return null;
  }

  /* ══════════════════════════════════════════════════════════════════════
     THE BOARD IS THE BASIS SCREEN
     ══════════════════════════════════════════════════════════════════════
     It used to be a table above both columns, read-only, with a "Badger posts"
     and a "Midwest posts" column tacked on the end. It is now the left six
     columns of the sheet, and each elevator's tick, basis box and posted price
     sit on the same row as the month they are about -- which is the whole of
     what Sig asked for and the reason the cards are gone.

     WHAT IS STILL NOT COMPUTED HERE. "On the site" is read out of each site's
     own published bids.json and joined by delivery month, exactly as the posts
     columns always were. No cash price is worked out on this screen; that rule
     is older than this layout and the rounding rule it protects still has one
     implementation, in each site's update-prices.mjs. */
  var boardDrawn = false;
  var SETTLES = null;            // contract -> CBOT settle, from agsist

  function cellFor(cls, text) {
    var d = document.createElement("div");
    d.className = "cell " + cls;
    if (text != null) d.textContent = text;
    return d;
  }

  function drawBoard(j) {
    if (!floor) return;
    var rows = (j.bids || []).filter(function (r) { return r.commodity === "Corn"; });
    if (!rows.length) return;
    /* Big River's own basis, month by month, kept for seedMonths -- see
       THEIR BASIS IS THE DEFAULT below. */
    rows.forEach(function (r) {
      if (typeof r.basisDollars === "number") THEIRS[r.delivery] = r.basisDollars;
    });
    /* THE BOARD CAN LAND AFTER THE SITES DO. Each column reads its own
       pricing.json and the feed is a separate fetch, so seedMonths has often
       already run with THEIRS still empty and filled the untouched months from
       the site's one global basis. Re-apply now that their board is here.
       Inside the seeding counter: this is the screen reading, not a person
       typing, and it must not arm the unsaved-work guard. */
    seeding++;
    try {
      Object.keys(SITES).forEach(function (site) {
        if (!MONTHS[site]) return;
        fromTheirBoard(site);
        writeMonths(site);
      });
    } finally { seeding--; }

    /* TO THE CENT. Sig, 2026-09-08: "i always want to round the corn price to
       the hundreds only."
       This reverses a decision made on 2026-08-31, and the reason it was made is
       still true and is the cost of this one: Big River's page prints quarter
       cents, so a board printed to the cent can no longer be compared with
       theirs line for line -- 5.3325 and 5.335 both read $5.33 and $5.34 and two
       different quotes of theirs can read the same here.
       WHAT IS NOT LOST: the arithmetic still balances on screen, because their
       cash and their quote round the same way -- 4.58 plus 0.75 is 5.33 whichever
       of the two you check. And nothing here changes a stored figure: the feed,
       bids.json and everything the sites publish carry the full number. This is
       how it is PRINTED on this screen and nowhere else. */
    var money = function (v) {
      if (typeof v !== "number") return "—";
      return "$" + v.toFixed(2);
    };
    var signed = function (v) {
      if (typeof v !== "number") return "—";
      return (v < 0 ? "−" : "") + Math.abs(v).toFixed(2);
    };

    [].slice.call(floor.querySelectorAll("[data-month]")).forEach(function (e) { e.remove(); });
    MONTH_ORDER = rows.map(function (r) { return r.delivery; });

    rows.forEach(function (r, i) {
      var rid = "M" + i;
      var quote = typeof r.futuresPriceCents === "number" ? r.futuresPriceCents / 100 : null;
      var settle = SETTLES ? SETTLES[r.futuresMonth] : null;

      var mo = cellFor("mo", null);
      mo.appendChild(document.createTextNode(r.delivery));
      if (i === 0 || NEW_CROP.indexOf(r.delivery) !== -1) {
        var tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = i === 0 ? "cash" : "new crop";
        mo.appendChild(tag);
      }
      var con = cellFor("num mut", r.futuresMonth || "—");
      /* THEIR QUOTE IS NO LONGER ITS OWN COLUMN. Sig, 2026-09-09, drawing a
         line down the whole length of it: "get rid of a lot oof dumb shit".

         What it printed was "$5.33" beside a Futures column already reading
         $5.33, with a quarter-cent tick after it. To the cent the two numbers
         are the same number on every contract on the board today, so the
         column was a second copy of its neighbour carrying one small
         difference -- and eleven rows of near-duplicate is exactly the kind of
         thing that makes a person stop reading a table.

         THE DIFFERENCE ITSELF IS NOT DROPPED. Big River's quoted futures and
         the CBOT settle really are a quarter to a half cent apart, and the
         basis is set against THEIRS, because theirs is what the applier pays
         from. The tick now hangs off the Futures figure -- one column, both
         facts -- and `data-quote` still carries the exact figure for anything
         that needs it. Rounded through 10000 because Math.round(-0.25) is -0,
         which is falsy, and the indicator was invisible on exactly the gap it
         exists for. */
      /* THE FUTURES IN THIS COLUMN IS THE ONE THE PRICE IS MADE FROM.
         Sig, 2026-09-09: "our on site price is future minus basis".

         That sentence has to be true of the two numbers actually printed in
         the row, and until now it was not. The column showed the CBOT SETTLE
         while both sites compute the price from Big River's QUOTED futures --
         update-prices.mjs, board(): `futures = b.futuresPriceCents / 100`,
         then `payFromBasis(futures, ours)`. The two are a quarter to a half
         cent apart on every contract on the board today, so a person reading
         Futures minus their basis off this screen got an answer the site would
         not publish. It went unnoticed while "Their quote" had a column of its
         own; cutting that column is what made it a lie.

         So the figure is theirs, and the settle is the small reference beside
         it. Same two facts, opposite billing, and the row now says what it
         means: this futures, less this basis, is what the site posts. */
      var fut = cellFor("num set", quote == null ? "—" : "$" + quote.toFixed(2));
      if (quote != null && settle != null) {
        var lagC = Math.round((quote - settle) * 10000) / 100;
        if (lagC) {
          var lg = document.createElement("span");
          lg.className = "lag";
          lg.title = "Big River quote this contract at $" + quote.toFixed(4).replace(/0+$/, "") +
                     ". The CBOT settle is $" + settle.toFixed(4).replace(/0+$/, "") +
                     ". The price is made from theirs.";
          lg.textContent = (lagC > 0 ? "+" : "") + lagC.toFixed(2) + "c";
          fut.appendChild(lg);
        }
      }
      var bas = cellFor("num mut basis-cell", signed(r.basisDollars));
      var bid = cellFor("num mut", money(r.cash));

      /* The two marks the basis readouts read back: the nearest delivery, which
         the cash box governs, and the first new-crop month, which the new-crop
         box governs. One definition -- NEW_CROP, held to the sites' own
         HARVEST_MONTHS by a test -- rather than a second list down here. */
      if (i === 0) bas.classList.add("is-ref");
      if (NEW_CROP.indexOf(r.delivery) !== -1) bas.classList.add("is-new");
      bas.setAttribute("data-contract", r.futuresMonth || "");
      if (quote != null) bas.setAttribute("data-quote", quote.toFixed(4));

      [mo, con, fut, bas, bid].forEach(function (c, k) {
        c.setAttribute("data-row", rid);
        c.setAttribute("data-tab", "basis");
        c.setAttribute("data-month", r.delivery);
        c.setAttribute("data-flex", "1");
        c.style.gridColumn = String(k + 1);
        floor.appendChild(c);
      });

      Object.keys(SITES).forEach(function (site) {
        var form = COLS[site] && COLS[site].querySelector("form");
        if (!form) return;
        var pub = cellFor("pub", null);
        var lab = document.createElement("label");
        lab.className = "cl";
        var box = document.createElement("input");
        box.type = "checkbox";
        box.setAttribute("aria-label", "Show " + r.delivery + " on " + SITES[site]);
        lab.appendChild(box);
        pub.appendChild(lab);

        var bx = cellFor("ctl", null);
        var inp = document.createElement("input");
        inp.type = "text";
        inp.setAttribute("inputmode", "decimal");
        inp.className = "mbasis";
        /* "same" is what an empty box means to the applier and to the sites:
           leave this month on whatever the file already says. It is a
           placeholder rather than a value, so a box somebody clears still says
           what clearing it does. */
        inp.placeholder = "same";
        inp.setAttribute("aria-label", "Our " + r.delivery + " basis on " + SITES[site]);
        bx.appendChild(inp);

        /* THE "0.62 OVER THEM" NOTE IS GONE. Sig, 2026-09-09, striking it out
           down both columns: "get rid of a lot oof dumb shit".
           It said their basis less ours, in words, under all twenty-two boxes:
           a line of grey text per box restating a subtraction of the two
           figures sitting in the same row -- Their basis −0.62, ours 0. It was
           twenty-two lines of screen to save one subtraction, and it made every
           month a line taller on a phone. The comparison it made is still
           there to be made, in the row, by eye. */

        /* THE SAMPLE MARKER LIVES HERE NOW.
           `data-sample` is how this screen knows nothing real has been loaded
           yet, and it is what outlines every box still holding the value the
           page shipped with -- the one thing standing between the office and
           quoting a made-up price. It used to sit on the customer preview
           inside the live strip; that strip is gone (see col.html), and this
           is the honest replacement: the cells that genuinely hold placeholder
           content until fillPosts() reads the site's own bids.json. */
        var pay = cellFor("pay", "…");
        pay.setAttribute("data-elev", site);
        pay.setAttribute("data-delivery", r.delivery);
        pay.setAttribute("data-sample", "");
        pay.classList.add("posts");

        var st = (MONTHS[site] && MONTHS[site][r.delivery]) || null;
        if (st) { box.checked = st.publish; inp.value = st.basis || ""; }

        var push = function () {
          MONTHS[site] = MONTHS[site] || {};
          MONTHS[site][r.delivery] = { basis: inp.value.trim(), publish: box.checked };
          writeMonths(site);
          paintRow(r.delivery);
        };
        box.addEventListener("change", push);
        inp.addEventListener("input", push);

        [pub, bx, pay].forEach(function (c, k) {
          c.setAttribute("data-row", rid);
          c.setAttribute("data-tab", "basis");
          c.setAttribute("data-month", r.delivery);
          c.setAttribute("data-col", ["a", "b", "c"][k]);
          c.setAttribute("data-flex", "1");
          form.appendChild(c);
        });
      });
    });

    boardDrawn = true;
    Object.keys(SITES).forEach(function (site) { seedMonths(site, null); paintRow(null); });
    layout();
    boardHooks.forEach(function (f) { try { f(); } catch (_) {} });
    Object.keys(SITES).forEach(fillPosts);
    Object.keys(SITES).forEach(readLiveMonths);
  }

  /* A ticked month is worth seeing from across the room; an unticked one has to
     stay legible, because its box is still where you would type. */
  function paintRow(month) {
    if (!floor) return;
    MONTH_ORDER.forEach(function (m) {
      if (month && m !== month) return;
      var on = Object.keys(SITES).some(function (s) {
        return MONTHS[s] && MONTHS[s][m] && MONTHS[s][m].publish;
      });
      [].slice.call(floor.querySelectorAll('[data-month="' + m + '"]')).forEach(function (c) {
        c.classList.toggle("row-on", on);
      });
      Object.keys(SITES).forEach(function (s) {
        var t = MONTHS[s] && MONTHS[s][m];
        [].slice.call(floor.querySelectorAll(
          '.cell.pay[data-elev="' + s + '"][data-delivery="' + m + '"]')).forEach(function (c) {
          c.classList.toggle("off", !(t && t.publish));
        });
      });
    });
  }

  /* What the site is publishing today, so the ticks open on the truth rather
     than on a guess. A site that has never had a months table falls back to the
     nearest delivery and the first new-crop month, which is exactly the two
     rows its page shows today. */
  function readLiveMonths(site) {
    fetch(LIVE_BASE + REPO_OF[site] + "/main/pricing.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (pr) {
        MONTHS[site] = {};
        seedMonths(site, pr);
        MONTH_ORDER.forEach(function (m) {
          var st = MONTHS[site][m];
          if (!st) return;
          var form = COLS[site] && COLS[site].querySelector("form");
          if (!form) return;
          var pub = form.querySelector('.cell.pub[data-month="' + m + '"] input');
          var bx = form.querySelector('.cell.ctl[data-month="' + m + '"] input');
          if (pub) pub.checked = st.publish;
          /* NO EVENT IS FIRED HERE. It used to be, so the "how far off them"
             note beside the box would be rewritten with the figure that had
             just landed. Sig cut that note on 2026-09-09, and the dispatch
             outlived the only thing that listened to it -- so every load fired
             an `input` on every month box in both columns, which is exactly
             what the unsaved-changes guard watches for. The screen came up
             telling the office it had unsaved work before anybody had touched
             it, and went on saying so after a save.
             Setting .value does not fire input, which is the whole reason the
             line was there and is now the reason it is not. */
          if (bx) bx.value = st.basis || "";
        });
        paintRow(null);
      })
      .catch(function () { seedMonths(site, null); });
  }

  /* The CBOT settle, from agsist, which is the only place in this system that
     holds one. It is NOT what the basis is set against -- the applier pays from
     Big River's own quote -- so it is shown beside theirs with the gap named,
     and a failure to read it leaves an em dash rather than a guess. */
  function loadSettles() {
    return fetch(SETTLES_URL + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (p) {
        SETTLES = {};
        Object.keys(p || {}).forEach(function (k) {
          var m = /^corn-([a-z]{3})(\d{2})$/.exec(k);
          if (!m) return;
          var close = p[k] && typeof p[k].close === "number" ? p[k].close : null;
          if (close == null) return;
          SETTLES[m[1].charAt(0).toUpperCase() + m[1].slice(1) + " " + m[2]] = close / 100;
        });
      })
      .catch(function () { SETTLES = null; });
  }

  function fillPosts(site) {
    var cells = floor ? floor.querySelectorAll('.cell.pay[data-elev="' + site + '"]') : [];
    if (!cells.length) return;
    fetch(LIVE_BASE + REPO_OF[site] + "/main/bids.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (bj) {
        var by = {};
        ((bj && bj.bids) || []).forEach(function (r) { by[r.delivery] = r.cashPrice; });
        [].slice.call(cells).forEach(function (td) {
          var v = by[td.getAttribute("data-delivery")];
          /* What the site is publishing, to the cent like everything else on
             this screen. The site's own page still prints what it prints. */
          td.textContent = typeof v === "number" ? "$" + v.toFixed(2) : "—";
          td.removeAttribute("title");
          /* Read from the site: no longer a sample. A month the site does not
             post reads "—", which is an answer from the file rather than the
             placeholder, so its marker comes off too. */
          td.removeAttribute("data-sample");
        });
      })
      .catch(function () {
        /* A dash would read as "this elevator does not post that month", which
           is a different and much more alarming thing than "this screen could
           not read the file". Say which one it is. */
        [].slice.call(cells).forEach(function (td) {
          td.textContent = "?";
          td.setAttribute("title", "Could not read what " + SITES[site] +
            " is publishing. This is not a price of theirs.");
          /* NOT SAMPLE CONTENT EITHER. "?" is this screen reporting a failed
             read -- an answer, and one the office has to act on. The marker
             means "still showing what the page shipped with", so it comes off
             on both paths; leaving it on the failure path would put eleven
             cells into the filler count and bury the boxes that really are
             still holding their shipped values. */
          td.removeAttribute("data-sample");
        });
      });
  }
