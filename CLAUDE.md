# EchoFlow 2.0 — working notes

Read [`docs/CONCEPT.md`](docs/CONCEPT.md) first. It is the source of record; the
code is downstream of it. If a change contradicts the concept, the change needs a
reason.

## The one rule

**Everything is a Finding.** One record type. Axis pages and surface pages are
queries over the same pile, linked rather than copied. If something cannot be
expressed as a Finding, it does not belong in the output.

Adding a second record type, a second score, or a per-axis ranking is how this
becomes v1 again.

## Two kinds of check, one kind of output

| | Feeds the score | Produces Findings |
|---|---|---|
| `core/dimensions.js` — consistency dimensions | yes | yes |
| `core/checks.js` — quality checks | **no** | yes |

The consistency score answers one question: how far is this site from a coherent
system. A failing contrast ratio is a real defect but it is not an inconsistency —
a site can be perfectly consistent and consistently illegible. Folding defects
into the score would quietly turn the north star into a general quality average.

So the score stays pure and the finding pile stays complete. If you collect a
signal, something must consume it: the collector once measured tap targets, alt
text, heading structure and contrast and threw all of it away, while the Design
review tab showed contrast warnings the findings report knew nothing about. That
was the one rule being broken quietly.

When adding a check, ask: *is this drift, or is it a defect?* Drift goes in
`dimensions.js` and moves the score. Defects go in `checks.js` (which also
pulls in `checks-geometry.js` and `checks-patterns.js`) and do not.

## Every finding declares what licenses its claim

`basis` is `prescriptive` | `practice` | `directional`. They are not
interchangeable, and blurring them is how an audit loses an argument:

- **prescriptive** — a published criterion with a number. **The schema REJECTS a
  prescriptive finding with no `citation`.** Cite the specific criterion
  (`WCAG 2.2 SC 2.5.8`); vague appeals to "accessibility guidelines" are what
  make a client suspect the whole report.
- **practice** — convergent convention (45–75 measure, 12px floor, token
  budgets). Say "outside established practice", never "fails".
- **directional** — effects from other catalogues. A range, attributed, paired
  with "worth testing on your traffic". Never a projection.

`docs/REFERENCE.md` lists every threshold and its provenance. Adding a check
means adding a row there.

Every dimension also carries a `group` (Colour, Typography, Spacing, Shape,
Components, Layout, Language, …). `consistency.byGroup` is the same weighted
mean partitioned by that field, so the score can be *explained* rather than
asserted. It is a decomposition, not a second score: nothing is ranked by it.

## Two tags, two questions

`axis` answers *what kind of problem is this*. `owner` answers *is this mine*.
Both are TAGS over one pile — never hierarchies, never scored. Owner pages are
filtered views reached by link, exactly like surface pages already are.

| Owner | Who | Examples |
|---|---|---|
| `design` | design team | tokens, type, colour, layout, components, targets, fold geometry |
| `marketing` | content / SEO / brand | copy, CTA wording, structured data, metadata, crawler access, dark patterns, alt text |
| `engineering` | developers | rendering, apps, scripts, performance, malformed markup, `lang` |

This exists because the **Engine axis mixed two audiences badly**: "third-party
script set differs across pages" and "no meta description" were adjacent, and
different people fix them.

The test is **who DECIDES, not who types**. Structured data is implemented in
Liquid but decided by whoever owns the catalogue copy → marketing. A JSON-LD
block that will not parse is an escaping bug → engineering.

`ownerFor()` in `finding.js` maps check ids, so nothing is unowned and a new
check cannot silently land in the wrong team's list. **Meta-findings need an
explicit entry** — they take their axis from whichever axis scored worst, which
says nothing about ownership.

**Never add a per-owner score.** The one ranking model stands.

The **GEO page** (`geo`) is the same thing again: `geoGroupFor()` in
`finding.js` maps check ids into five groups (access, structured, answerability,
operability, parity), and the page is a filtered view carrying **no score**.
Performance is Engine but NOT GEO — `engine-lcp`, `engine-cls` and
`engine-page-weight` are a different argument with a different owner. A test
asserts every check id in `checks-retrieval.js` and `checks-operability.js`
lands in a group, so a new retrieval check cannot vanish from the page.

## GEO lives on the Engine axis, not a fourth one

The concept forbids adding axes ("no axes with equal weights comparable by
accident"). Machine retrieval is therefore two new **groups** on Engine —
`Structured data` and `Retrieval` — which gives it its own line in the score
breakdown without changing the three-axis model. `core/checks-retrieval.js`
holds the defects; `analyzer/src/collect/retrieval.js` does the fetching that
needs a network rather than a DOM.

Three rules specific to it:

- **Nothing in GEO is `prescriptive`** except `engine-no-lang` (WCAG 3.1.1).
  There is no standards body for answer-engine retrieval and crawler behaviour
  moves; every finding carries that caveat.
- **Blocking AI crawlers is a decision, not a defect.** Report the state and ask
  for confirmation. A wildcard block outranks a named one because it is likelier
  to be accidental.
- **Never claim traffic or citations.** Retrievable is not cited. Say what a
  machine can and cannot read, and stop.

**Answerability reads `retrieval.static.payload` and nothing else.** Consulting
the rendered DOM would answer a different question — whether a person can see
the fact, not whether a machine received it. With no static payload it returns
`measurable: false` rather than scoring. Unresolved placeholders (`{{ price }}`)
are NOT answers, which is the one case every field-presence check gets wrong.

**Operability is measured as STEPS, not a percentage.** An agent does not get
part-way into a cart — it stops at the first step with no machine-visible
affordance. `core/operability.js` reports where; findings group by that step,
because "every PDP stops at variant selection" is one template fault.

**Never assert a site should be agent-operable.** That is a commercial decision.
Report where the path stops. Closed `/cart.js` and `/products.json` are often
deliberate, so that finding is capped below priority 40.

**The probe reports disagreement, not refusal.** robots.txt permitting a crawler
the server turns away is the finding; policy and behaviour agreeing is recorded
at low priority. A challenge page is a refusal even with a 200 status.

The static-vs-rendered comparison is **body-only**: including `<head>` made it
report `h1InStatic: true` for a fully client-rendered page, because the product
name is in `<title>` either way.

## Things that will trip you up

- **`effort` is inverted.** 10 means *trivial to fix*, not "lots of work".
  `priority = impact × effort` so high-impact-and-easy ranks first.
- **`spread` in `weigh()` is distinct things to fix**, not total occurrences. A
  button whose colour, radius and height all drift is ONE snippet to rebuild.
  Getting this backwards buries the most structural findings.
- **Colour needs two tolerances.** Accidental chromatic forks (ΔE ~1.7–3.7) sit
  *above* deliberate neutral steps (ΔE ~2.2). One threshold must either merge real
  surface tints or miss real forks. See the calibration table in `consistency.js`.
- **Use Lab chroma, not HSL saturation**, to decide if a colour is neutral. HSL
  saturation is unstable near white — `#f8f9fa` reports 17% saturation and gets
  filed as a brand colour.
- **`core/collect-dom.js` closes over nothing.** It is serialised into the page by
  `page.evaluate()` and injected by the extension. No imports, no module scope.
  Breaking that splits the two collectors apart.
- **Unmeasured ≠ passing.** A dimension that could not run is excluded from the
  score and reported in `skipped`. Never default it to 100.
- **No spacing base below 4px.** `rhythmAdherence` takes the *coarsest* base the
  site honours, not the best-fitting one. Best-fit is the wrong objective: a 2px
  base fits every even number, always wins, and reports a meaningless grid at
  high adherence. Below 4px you are describing arithmetic, not a decision.
- **Never use `document.fonts.check()` to test if a font resolved.** It reports
  whether CSS font-matching would succeed, and matching always succeeds via
  fallback — it returns `true` for a family name you invented. Measure text
  width against several generics instead (`fontResolves` in `sidepanel.js`).
- **Spacing below 4px is not spacing.** Hairlines and border compensation are
  excluded from rhythm in both `tokens.js` and the `spacing-rhythm` dimension.
  Including them produced "snap 1px to 0px", which is not a fix.
- **Scale step names must be unique.** Naming by size ratio collides (30px and
  32px both land in "2xl"), and a token set with two steps of the same name is
  unusable. Names are assigned by rank; past 14 steps it switches to numbering,
  because a site with 19 sizes has no t-shirt scale to describe.
- **Visibility is inherited.** `collect-dom.js` walks the ancestor chain. A node
  with its own `display:block` inside a hidden section is not on the page;
  checking only the node was the largest source of false positives.
- **Page discovery decides on a LIST, it never renders.** `core/discover.js`
  returns URLs; the caller spends the browser. That split is what lets the
  extension show the sample for confirmation before it opens a tab on someone's
  storefront with their session attached. The CLI and the sidebar call the same
  function, so `--scope site` and **Find pages for me** pick the same pages.
- **`chrome.tabs.onUpdated` fires `complete` for the page already in the tab.**
  The automatic run navigates ONE reusable tab, so it must see `loading` before
  it accepts `complete` — otherwise the collector reads the previous URL and
  every page in the run is attributed to the wrong address, which looks like
  drift rather than like a bug.
- **A background tab is loaded but never painted**, so `loading="lazy"` images
  never fetch. They are flipped to eager before measuring — not scrolled into
  view, because scrolling moves the fold and the fold is measured. Script-driven
  lazy loading is still out of reach and is declared in `surfaceLimits()`.
- **A MAIN-world injection is subject to the PAGE's CSP.** On a storefront with
  a strict `script-src`, `chrome.scripting.executeScript` resolves with no
  result and does not throw, so it reads as "the collector returned nothing" and
  was being reported as a `chrome://` page. The sidebar retries in ISOLATED,
  which reads the same DOM and computed styles; the only loss is
  `window.Shopify` (theme name and version, and one of three detection signals).
  Never report an injection failure as a cause you have not established.
- **The column grid is measured against the CONTENT COLUMN, not the viewport.**
  Twelfths of the window align with nothing on a site with a centred
  `max-width` container — which is nearly all of them. It looked correct only
  at 1440, where twelfths of the window land on a 1200px container by
  coincidence; at 1920 four of eleven lines fell outside the content area.
  `detectContainer()` takes the most REPEATED (left, width) among block
  elements, which lands on the container's content box — the right answer,
  since a design tool draws columns inside the margin, not across it. A
  full-bleed page reports `measured:false` instead of inventing a grid.
- **The column count is MEASURED, not chosen.** Offering 12 in a menu is a
  guess wearing a measurement's clothes. `detectGrid()` reads explicit CSS
  grids off `grid-template-columns` (a resolved px track list, so the count is
  a fact) and infers the layout grid by searching (columns × gutter) for the
  pair the most element edges land on. The search MUST include the gutter: a
  12-col grid with a 24px gutter puts edges at multiples of (col + gutter),
  never at twelfths of the container. The buttons are an override for checking
  a page against a grid you already know; `null` means use what was measured.
- **Rank grid candidates by coverage, then RESIDUAL.** Two earlier scorings
  were wrong. Multiplying coverage by the share of gridlines used punished
  exactly the grids it was meant to find — a real 12-col layout leaves most of
  its 24 lines empty. Falling back to "fewer columns wins" was worse: a coarse
  grid is a SUBSET of a fine one, so an 8-col page also fits 4 columns and
  simplicity picked wrong every time. Only residual separates them — the real
  grid sits on the edges to within a pixel, an accidental fit is out by two or
  three. Tolerance stays tight (≤3px) for the same reason.
- **Rank CSS grids by WIDTH, not by how many there are.** A collection page has
  a dozen 2-up grids inside cards and one 4-up product grid. Counting
  occurrences picks the cards — reported from a real store, where the panel
  said "no layout grid found", listed three CSS grids, and drew the 2-up. The
  grid spanning the content column (`span >= 0.9`) is `pageGrid`; anything
  narrower is a component laid out inside it.
- **Dedupe edges before scoring a grid.** Eight identical tiles repeat the same
  handful of x positions, and counting each occurrence let a 14-column model
  "explain" 69% of the edges while touching five of its twenty-eight lines. A
  claim of n columns also needs at least n lines with something on them.
- **`detectContainer` breaks ties toward the NARROWER box.** A wrapper with
  32px of padding repeats exactly as often as the content column inside it,
  and drawing the grid across the padding puts every line out by the padding.
- **A grid the page never demonstrates cannot be detected.** If nothing spans
  an odd number of columns, an 8-col page is indistinguishable from a 4-col
  one and the coarser answer is the honest one. `test/fixture-grid/8col.html`
  carries odd spans deliberately; without them the first version of that test
  was asserting something unmeasurable.
- **A grid with nothing under it cannot be checked.** `columns` mode draws the
  section boxes too. It used to draw the grid over an empty layer (`boxes: 0`)
  while still walking the whole DOM to draw nothing.
- **The overlay runs in ISOLATED world.** It only appends elements and reads
  computed styles, so it has no use for page globals, and MAIN would expose it
  to the page's CSP — the buttons would silently do nothing on a strict
  storefront. Drawn elements carry `data-ef` (`section` / `box` / `col` /
  `label`): the `border` shorthand makes a band and a box indistinguishable by
  style alone, which fooled the first verification pass into counting boxes as
  columns.
- **Colour is classified by ROLE, never as a brand.** `action` / `surface` /
  `ink` / `line` / `accent`, each read off the property the colour was painted
  with. "Brand colour" was a claim about identity that a rendered page cannot
  support — it has no access to a brand, only to where paint was applied — and
  trying to make it told a store with a black logo that its brand colour was
  the red on its sale badges. Nothing is called primary. The three colour
  properties (`colorText`, `colorBackground`, `colorBorder`) are kept APART in
  `buildTokenSeed`, because which property a colour was painted with is the
  only evidence there is for what it is for.
- **The action colour comes off the CTA, including when it is black.** A
  monochrome interface is an answer, not a missing one. With no call-to-action
  button there is simply NO action colour — nothing stands in for it, because
  substituting the most-used chromatic value is exactly what produced the wrong
  answer before. A button the colour of the page surface is an outlined
  button — the surface showing through, not a decision — so it does not count.
- **A chromatic joins a role ramp only if it DOMINATES that property.** Without
  that rule sixteen sale badges land in the surface list beside white and grey,
  and the export names one `--color-surface-2` — which says the page is painted
  red somewhere structural. The rule keeps the real case working: a store with
  a navy page has navy as its most-used background, so navy is `surface-0` and
  not an accent. Everything chromatic that is left is an accent, carrying
  `where` (text / background / border) rather than a promotion.
- **Served-from is not available-on.** A family can be on Google Fonts and not
  be loaded from Google — Shopify's font picker serves many of them from its
  own CDN, and plenty of themes self-host. Reported as "Figtree is a Google
  font, why is there no link": the page was right and so was the tool, but the
  panel said nothing about provenance so the silence read as a bug. Every
  typeface now states its source. The direct specimen link is a CLAIM, so it is
  used only when the page really loads from Google; otherwise the host is named
  and a search link offered, which asserts nothing about the catalogue. The
  catalogue itself cannot be bundled — the proxy blocks fonts.google.com — and
  a hand-curated partial list would make absence ambiguous all over again.
- **Never use `:first-of-type` for a class.** It means "first element of that
  TAG among its siblings", not "first of that class". One `div` ahead of
  `.spec` in the same parent and `.spec:first-of-type` silently misses, leaving
  the row's top border stacked under the heading's bottom border — two
  hairlines a few pixels apart, which is what "these 2 lines make no sense"
  was. Use the adjacency (`h3 + .spec`) instead.
- **Google Fonts are read off the STYLESHEET URL, not `@font-face`.** Google
  serves its CSS cross-origin, so `.cssRules` throws and the font-face loop
  never sees those families at all. `engine.googleFonts` parses `family=` from
  any `fonts.googleapis.com` href — css2 repeats the parameter, css v1
  separates with `|` — and also claims any face served from `fonts.gstatic.com`.
  An `@import`ed sheet is NOT a top-level `document.styleSheets` entry either;
  it is a `CSSImportRule` on the parent, so it needs its own pass.
- **Classify controls by role, not by class name.** A `div.chip` is not
  tappable. Name-based classification is how an audit turns into damage.
- **Viewports are USABLE heights** (`USABLE_VIEWPORT`): mobile 390×**640**,
  desktop 1440×**800**. Device height flatters every design by about a quarter.
  The fold is declared in `analysis.method.foldLines` — an audit whose fold is
  undeclared cannot be checked.
- **WCAG 2.5.8 exempts inline links.** Flagging every in-paragraph link is noise
  and loses trust. The exemption count travels in the evidence.
- **Dark-pattern findings are accusations.** Always carry the literal matched
  string, and describe the PATTERN, never the intent. A regex cannot establish
  motive, and urgency cues are reported as a prompt to verify, not a verdict.
- **A high consistency score does not mean "ship it."** Quality defects do not
  move the score, so narrative findings that draw conclusions from it (see
  `meta-ready-to-port` in `synthesis.js`) must check the finding pile for
  blockers before claiming the remainder is polish.

**Sending finishes somewhere else, so say so in a sheet.** The outcome of
"Send to Claude" is an instruction — go to Claude and ask this — not a status.
A line under the buttons sits where the panel puts page-collection hints and
was being missed. Both routes open the sheet: one says it was sent and gives
the sentence to ask, the other says why it had to save and gives the line to
paste. Every ask copies itself on click.

**"Send to Claude" pushes over loopback; downloading is the FALLBACK.** The
first version had this backwards — it saved files and handed over a path, which
is the opposite of handing an audit to Claude. `mcp/ingest.js` opens a receive-
only HTTP listener (127.0.0.1, ports 8787–8790) and the extension posts the
analysis to it; the server writes the bundle where it already keeps audits, so
every tool finds it. Three rules, because it is a port on someone's machine:
loopback only, a custom header that a web page cannot add without a preflight
answered solely for `chrome-extension://` origins, and a size cap with a shape
check before anything is written. A failed listener is never fatal — the server
runs as before and the extension falls back to saving files.

**The sidebar still cannot speak MCP, and the fallback does not pretend to.** The
server is a stdio process its client launches; a page can neither spawn it nor
open a pipe to it, and native messaging would cost a per-OS host manifest
install. So the button writes what the read tools take a path to — 
`data/analysis.json` plus a layout per surface — under `Downloads/echoflow/`,
and copies the line to paste. `echoflow_recent` then finds it without a path.
Chrome knows the absolute path and the panel does not: read it back from the
download record, and return null rather than a guess when the shape is not
there — a non-matching `replace()` hands back the FILE path labelled as the
directory.

**The bundle root is `report/`, and everything that reads it must know.** When
START HERE moved to the top, the MCP server kept resolving
`<dir>/data/analysis.json` while `buildBundle` writes
`<dir>/report/data/analysis.json` — so every read tool failed on a bundle
`echoflow_analyze` had just written, and the CLI printed three paths that did
not exist. `resolveBundle()` now accepts either level. The round-trip test that
would have caught it was behind an opt-in `if (url)` guard and had never run;
it serves the fixture itself now and skips only when there is no browser.

## The bundle has one entry point

`START HERE.html` sits alone at the top; everything else is under `report/`.
Someone unzipping a folder should not have to guess which of `site/`, `pages/`,
`data/` and `findings/` to open.

It is **self-contained** — inline styles, inline charts, no external reference —
so a moved, re-zipped or partially copied folder still opens. Renderers build at
flat paths and `buildBundle` moves everything under `report/` in one place, so no
renderer knows where the bundle root is.

**Every page must be reachable from START HERE.** It had four hand-picked
routes and no way to reach an axis, surface or GEO page — the landing screen of
a wiki was the one screen you could not navigate from. The menu is built from
`model.pages`, plus a sticky top bar, and a test asserts every page is linked.

**Structure pages are NOT in `model.pages`.** The bundler builds them from the
observations, so `renderStartHere` takes them as a second argument. The old code
asked `model.pages` whether any existed, which is never true — so no report ever
generated linked to them from the entry point.

**Severity bands count problems, not strengths.** A strength carries a priority
because every Finding does, but counting it as "critical" makes the headline
count and the band total disagree — and the larger number is the wrong one.
`model.stats` exposes `problems`, `strengths` and `total` separately.

Charts are inline SVG in `core/wiki/charts.js` — no library, because the bundle
must open from disk forever and a CDN tag breaks the day the CDN moves. Colour
follows the job: **ink for magnitude** (scores, counts), the **reserved status
palette for state** (severity). Never colour alone — every band is labelled, and
in the scatter the band is derived from position, so hue is redundant.

## After changing core/

```bash
node scripts/sync-core.js    # the extension loads its own copy
node test/run.js
cd mcp && node test.mjs      # MCP protocol + the analyse/read round trip
node test/overlay.mjs        # the overlay + grid detection, in a real browser
node test/extension.mjs      # the built extension, loaded in a real Chrome
```

The last two need Chromium and skip cleanly without one.

`test/overlay.mjs` exists because the column grid was wrong for its whole life
and looked right at the one window width anyone checked.

`test/extension.mjs` exists because nothing else can see the failures that only
appear once the thing is an extension: a stale `extension/core/`, an import that
resolves on disk but not from an extension origin, a manifest naming a file
nobody shipped, a binary mangled by the zip writer. It reads the manifest back
from **Chrome**, not from disk, and drives a full collect → analyse → export in
the side panel's own document. Dynamic `import()` is barred in a service worker
by spec, so that work belongs on the panel page.

## Testing against a real page

`test/fixture-site/` is a deliberately inconsistent storefront (three PDPs that
drift in button style, nav, price format and section skeleton).

```bash
python3 -m http.server 8099 --directory test/fixture-site &
node analyzer/src/cli/index.js http://127.0.0.1:8099/ --out /tmp/ef
```

In a sandbox, Chromium may need `ECHOFLOW_CHROMIUM`, `ECHOFLOW_NO_SANDBOX=1` and
`ECHOFLOW_PROXY`.
