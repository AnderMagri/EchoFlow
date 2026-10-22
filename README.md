# EchoFlow 2.0

### [⬇ Download the Chrome extension](https://github.com/AnderMagri/EchoFlow/releases/latest)

Unzip it, open `chrome://extensions`, turn on **Developer mode**, click **Load
unpacked** and pick the unzipped folder. No terminal, no clone. Full steps and
troubleshooting are under [Install](#a-chrome-extension).

---

**A Shopify readiness audit.** It answers two questions that turn out to be the
same one: *how easily could this site become a Shopify store — and how
consistent is it already?*

Those are not separate measurements. A site running a coherent system ports as
tokens and templates: extract once, rebuild once, done. A site that decides its
colour, spacing and component style afresh on every page has to be rebuilt page
by page. So the consistency score **is** the migration estimate, and the
findings are the work it would take to bring the number up — whether you are
porting the site or keeping it.

Not a generic site analyser. Shopify is the product — for sites that **are** one
or **will be** one.

> v1 (the screenshot tool) is retired and shares no code with 2.0. It is not in
> the working tree; it remains in git history at `39d5bd6` and earlier if it is
> ever needed. The reasoning behind the rewrite is in
> [`docs/CONCEPT.md`](docs/CONCEPT.md).

---

## What makes it different

**Consistency is the measuring instrument, not a score.** Design, UX and Engine
are not three methods — they are the same three primitives pointed at different
evidence, which is what lets one number legitimately span all three.

| Primitive | Measures | Scope |
|---|---|---|
| Vocabulary coherence | How close the values used for one property are to a *designed* set — near-duplicates and sprawl | Extractive |
| Cross-page agreement | For a role that should be invariant, what share of pages agree | Comparative |
| Rhythm adherence | What share of numeric values sit on the *detected* base unit | Extractive |

**Findings are routed to whoever fixes them.** Every finding carries an `owner`
— design, marketing, or engineering — because the Engine axis mixed two
audiences badly: "third-party script set differs across pages" and "no meta
description" are both Engine and different people fix them. The report gets a
page per owner, so the marketing lead reads structured data, copy and crawler
access without wading through script budgets. It is a second tag over one pile,
not a second report: no owner is scored separately.

**One primitive, one ranking.** Everything is a Finding. `priority = impact × effort`.
No second score, no per-axis weights that are comparable by accident.

**Every claim declares what licenses it.** A cited WCAG criterion, a convergent
convention, and someone else's A/B result are three different kinds of statement,
and the report never lets one borrow the authority of another. A `prescriptive`
finding cannot exist without a citation — the schema rejects it. Full provenance
for every threshold is in [`docs/REFERENCE.md`](docs/REFERENCE.md).

**It checks whether an agent could actually buy.** Not just whether a model can
read the page — whether the buy path is completable without executing it: a real
`POST` form to `/cart/add`, a variant id in a submittable field, `autocomplete`
tokens on checkout fields. Reported as the step where an agent stops, because
that is how it fails.

**It checks whether a machine can actually answer.** Beyond "is the schema
there", it resolves the questions a buyer asks — name, price, currency,
availability — from the payload a non-JS crawler receives, and counts a
`{{ product.price }}` placeholder as unanswered. It also probes with each
crawler's real user-agent, because `robots.txt` is a stated policy and bot
protection at the edge is the actual behaviour.

**It reads the site the way a machine does.** Beyond the human view, it fetches
the raw HTTP response and diffs it against the rendered DOM — because most
crawlers feeding answer engines never execute JavaScript, and a page can look
complete to a person while arriving hollow to a machine. Plus structured-data
coverage, metadata consistency, and which AI crawlers `robots.txt` actually
allows. Blocking them is treated as a decision to confirm, not a defect.

**It says what it did not measure.** Comparative dimensions are *skipped*, never
guessed, when there is only one page — and a score built on partial coverage is
labelled provisional, because the dimensions that go missing are exactly the ones
that detect inconsistency.

**The design output is a rebuild seed.** The clusters the consistency pass had to
compute anyway come out as CSS properties, W3C DTCG tokens, a Tailwind config, and
Shopify theme settings.

---

## Install

Pick the one that matches what you want to do. They are independent — you do not
need the others.

| I want to… | Use | Needs |
|---|---|---|
| Look at a store while I browse it | **Chrome extension** | Chrome. No terminal if a colleague sends you the `.zip`. |
| Produce a full report to send a client | **CLI** | Node 18+ |
| Let Claude or Cursor query an audit | **MCP server** | Node 18+ |

### A. Chrome extension

**If someone sent you a `.zip`** — no terminal needed:

1. Unzip it. You get a folder called `echoflow-extension-<version>`.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the **unzipped folder itself** — the one
   that contains `manifest.json`. Not the `.zip`, not a folder above it.
5. The card should read **EchoFlow 2.0 · 2.19.0**. Click the EchoFlow icon in the
   toolbar to open the sidebar.

Keep the unzipped folder where it is. Chrome loads the extension from that
folder every time it starts — delete or move it and the extension disappears.

**If you are working from the repo:**

```bash
git clone https://github.com/AnderMagri/EchoFlow.git
cd EchoFlow
node scripts/sync-core.js
```

Then `chrome://extensions` → Developer mode → **Load unpacked** → pick the
**`extension/`** folder (not the repo root — the repo root is v1).

To update later:

```bash
git pull
node scripts/sync-core.js
```

Then hit **↻ reload** on the EchoFlow card. No reinstall — Chrome re-reads the
folder.

**To publish a new build**, cut a release — that is what the download link at
the top of this page points at:

```bash
npm run package                      # → dist/echoflow-extension-<version>.zip
VERSION=$(node -p "require('./extension/manifest.json').version")
gh release create "v$VERSION" "dist/echoflow-extension-$VERSION.zip" \
  --title "EchoFlow $VERSION" --notes "Load unpacked from the unzipped folder."
```

`npm run package` syncs `core/` first, so a stale copy cannot ship. The zip is
deliberately **not committed** to the repo: a binary in git goes stale the
moment anyone pushes, and a stale download is exactly how v1 kept handing out
the wrong version — it had `EchoFlow.zip` sitting at the repo root. A release is
versioned, dated, and cannot drift from the tag it was built at.

### B. CLI

```bash
git clone https://github.com/AnderMagri/EchoFlow.git
cd EchoFlow/analyzer && npm install && npx playwright install chromium
```

`npx playwright install chromium` downloads a browser (~150 MB) — the CLI renders
pages properly rather than reading their HTML, so it needs one.

### C. MCP server

```bash
cd mcp && npm install
```

Then point your client at it — see [Use it — MCP](#use-it--mcp) below.

### If something goes wrong

| What you see | What it means |
|---|---|
| The card says **EchoFlow 1.6** | You are on an old clone from before 2.0 landed on `main`. `git pull`, then select the `extension/` folder. |
| **Manifest file is missing or unreadable** | You selected the wrong folder. Pick the one that directly contains `manifest.json`. |
| **fatal: not a git repository** | You are not inside the cloned folder. `cd` into `EchoFlow` first. |
| **Your local changes would be overwritten** | `git stash` then retry the checkout. |
| Sidebar says it cannot read the page | Chrome blocks extensions on `chrome://` and Web Store pages. Open a normal storefront tab. |
| Comparative checks all say *needs more than one page* | They need two pages of the same type. Use **+ Add page** or **Find pages for me**. |

## Use it — CLI

```bash
node analyzer/src/cli/index.js https://shop.example.com
```

```
  73/100 — mostly-held
  A system is visible, with drift at the edges. Tighten before rebuilding, not after.

  design   80
  ux       53
  engine   78

  15 findings (4 critical, 7 high)

  Report:  ./echoflow-shop.example.com/site/index.html
  Data:    ./echoflow-shop.example.com/data/analysis.json
  Agents:  ./echoflow-shop.example.com/CLAUDE.md
```

| Option | |
|---|---|
| `--scope page\|site` | `site` discovers and samples pages by template type (default) |
| `--axes design,ux,engine` | Which axes to run |
| `--viewports desktop,mobile` | Render at one or both |
| `--limit 12` | Max pages in a site run |
| `--out <dir>` | Output directory |

## Use it — MCP

```bash
cd mcp && npm install
```

```json
{ "mcpServers": { "echoflow": { "command": "node", "args": ["/path/to/EchoFlow/mcp/server.js"] } } }
```

Eight tools. The design constraint is context, not capability: an analysis is ~80KB
of JSON, so every tool summarises by default and offers a narrower query to drill in.

| Tool | |
|---|---|
| `echoflow_analyze` | Render and measure a site. Returns the verdict and top findings; writes the full bundle to disk. |
| `echoflow_findings` | Filter by axis, surface, band, basis or kind. One line each. |
| `echoflow_finding` | One finding in full — evidence, recommendation, criterion. |
| `echoflow_tokens` | The extracted design system as css / dtcg / tailwind / shopify / json. |
| `echoflow_structure` | Section skeleton for a surface. |
| `echoflow_retrieval` | The machine-readability picture: crawler access, structured data, no-JS survival. |
| `echoflow_recent` | Find audits already on disk, newest first — so "my latest audit" needs no path. |
| `echoflow_explain` | What the tool measures and what a score does and does not mean. |

## Use it — Chrome sidebar

Installation is under [Install → A. Chrome extension](#a-chrome-extension).

The sidebar is the working surface — browse the client's site and analyse from
where you are. Three tabs:

- **Design review** — the extracted system (palette, ramp, type scale, spacing
  rhythm, contrast warnings) with typefaces rendered in the real face.

  Every typeface says where it comes from: a **Google Fonts** link when the
  page genuinely loads from Google, the **serving host** when it does not
  (Shopify's font picker serves many Google families from its own CDN), or
  **system** when no `@font-face` exists at all. The specimen link is a claim,
  so it is only made when it is true; everything else gets a look-up instead.

  Colour is classified by the **role** it plays — action, surface, ink, line,
  accent — not as a brand: a rendered page has no access to a brand, only to
  where paint was applied. The action colour is read off the call-to-action
  button, including when that is black, and with no such button there simply is
  no action colour rather than a substitute.

- **Findings** — one pile, three groupings you switch between: **by owner**
  (design, marketing, engineering), **by axis**, or **machine readability**
  (crawler access, structured data, answerability, agent operability). Above
  them sits *What this store runs* — the platform, theme, recognised apps,
  third-party script hosts, requests and page weight. Those are facts, not
  findings, so nothing there is scored.
- **Structure** — draws the box skeleton **on the live page**. Sections, all
  boxes, or a column grid. Scroll the site with it on. The grid is measured
  against the site's **content column**, not the window, and the sections stay
  drawn underneath it so alignment is actually checkable.

  The **column count and gutter are detected, not chosen** — it reads explicit
  CSS grids off the computed style and infers the layout grid by finding the
  (columns × gutter) pair the most element edges sit on, then tells you how
  much of the page fits: *12 columns · 24px gutter — 100% of element edges sit
  on it, to within a pixel.* The number buttons are an override for checking a
  page against a grid you already know it should be on. A page with no regular
  grid says so rather than falling back to 12, and a full-bleed page says it
  found no content container rather than inventing one.

**Picking pages — by hand or automatically.** Both work, and they compose.

- **+ Add page** collects as you browse. Use it when you know the pages you
  want, or when a page needs a login, a region picker or a click to reach.
- **Find pages for me** reads the sitemap (falling back to a two-level crawl),
  samples by template type — four PDPs, three PLPs, home, cart, search — and
  shows you the list before it touches anything. Untick what you do not want,
  then **Collect**. Each page opens in one reusable background tab, is measured,
  and the tab closes; **Stop** ends the run and keeps what it already has.

The same sampling the CLI uses, so `--scope site` and the button choose the
same pages. Comparative checks need at least two pages of the same type, and
the hint tells you what is still missing either way.

One honest limit: a background tab is loaded but never painted, so
script-driven lazy loading (`data-src`, `IntersectionObserver`) does not fire.
Native `loading="lazy"` images are forced eager before measuring; the rest is
declared in the review's *What this surface cannot do* note rather than left to
show up as a finding.

The sidebar fetches the un-rendered HTML and `robots.txt` itself, so parity,
answerability and the machine-readability checks work here too. It states its
own limits: the crawler probe needs the CLI, because a browser will not let a
page set its own User-Agent.

**If a page refuses the collector.** A main-world injection is subject to the
page's own Content-Security-Policy, so a storefront with a strict `script-src`
returns nothing without raising an error. The sidebar retries in an isolated
world, which reads the same DOM and the same computed styles and gets through.
The only casualty is `window.Shopify` — the theme name and version go
unread, and Shopify detection falls back to section markup and script URLs.
The measurements are unaffected, and the review's *What this surface cannot do*
note says when it happened.

Export writes the same bundle the CLI produces, as a `.zip`.

**Send to Claude** pushes the audit straight into the running MCP server.
Nothing is downloaded and there is no path to paste. A sheet then tells you
exactly what to do next — switch to Claude and ask *"Look at my latest EchoFlow
audit"* — with a few follow-ups worth asking. Click any of them to copy it.

The extension still cannot speak MCP (that is a stdio process its client
launches), so the server opens a small **loopback listener** whose only job is
to receive one. The extension posts to `127.0.0.1`, the server writes the
bundle into its own audit folder, and every existing tool finds it.

It is a port on your machine, so: bound to `127.0.0.1` only, never `0.0.0.0`;
a custom header is required, which a web page cannot add without a CORS
preflight that is answered only for `chrome-extension://` origins; and the body
is size-capped and shape-checked before anything is written.

If the server is not running — Claude closed, or the MCP server not configured
— the button falls back to saving `data/analysis.json` and a layout per surface
into `Downloads/echoflow/<site>-<date>/` and copying the line to paste. It says
which of the two happened, and why.

## The output bundle

Unzip it and there is exactly one thing to open:

```
START HERE.html    the verdict, the charts, and a menu of every page
report/
  site/            static HTML. Host it anywhere. The client's copy.
    findings.html    every finding in one list, highest priority first
    tokens.html      the design review — colour by role, typefaces, scale, spacing, shape
    geo.html         what a machine can read
    structure-*.html the page as boxes, one per surface
  pages/           markdown with front-matter — the same pages, for an agent to read.
  findings/        one file per finding, stable filename.
  data/            JSON — the source everything else is rendered from.
  CLAUDE.md        how an AI agent should navigate the folder.
  manifest.json    index of the bundle.
```

Everything the side panel shows is in here. The **design review** page carries
the same sections the panel does — colour by role, every typeface with where it
is served from, the type scale, the spacing rhythm and shape — because the panel
is the auditor's screen and the bundle is what the client actually receives; a
section that existed only on the first one was not in the deliverable at all.
`findings.html` is the complete pile in priority order: the axis, owner,
page-type and GEO pages are that same pile asked a narrower question, linked
rather than copied.

`START HERE.html` is **self-contained** — its own styles, its own charts, no
external file. Move the folder, re-zip it, copy it half-way, and it still opens
and still says what the audit found.

`report/data/analysis.json` is the single source. Every other file is a projection of it.

**The report is charted, not just listed.** Score by group as bars, severity as
a distribution, work split by owner, and an impact-against-ease scatter whose
dashed contours *are* the band boundaries — since priority is impact × ease,
the ranking model becomes a position on a plot rather than a number to trust.
Inline SVG, no library, light and dark.

**Two densities, one document.** The report has a Full/Client toggle in the header
— a filter, not a second export. Maintaining two designs would double the work
forever, and they would drift.

**Colour or White.** The switch in the panel header repaints the panel and is
what the exported report is rendered in — one choice, both surfaces. White is
black-and-white on white: no hue anywhere, achromatic greys on a pure `#ffffff`
ground, and it does NOT follow your system setting — a report is a deliverable,
and the ground it prints on is a decision. Colour still follows light/dark. Severity becomes a ramp from ink to pale instead of
four hues; nothing is lost, because every band was already labelled and the
scatter derives its band from position, so colour was never the only channel.
Colour swatches stay in colour whatever the mode: those are measurements of the
site, and a grey one would be a lie about it. From the CLI it is `--ui white`.

**Built for Cowork.** Drop the folder in a synced directory and both you and Claude
can work from it. `CLAUDE.md` states where the truth is, what `effort` means (it is
inverted — 10 is *trivial to fix*), and what **not** to conclude from the score.

---

## Layout

```
core/          zero-dependency ESM. Runs in Node AND the browser.
  finding.js         the Finding primitive — the only record type
  consistency.js     the three measurement primitives + aggregation
  dimensions.js      19 consistency dimensions — these move the score
  checks.js          quality defects — findings only, no score effect
  checks-geometry.js fold, depth, targets, measure, choice load, strengths
  checks-patterns.js manipulative patterns, mechanically detected
  checks-retrieval.js machine readability — structured data, crawlers, no-JS survival
  answerability.js   can a machine recover the facts a buyer asks about?
  operability.js     can an agent complete the buy path without executing the page?
  parity.js          does the page tell a machine what it tells a person?
  synthesis.js       cross-axis meta-findings
  tokens.js          the design system seed
  collect-dom.js     the DOM collector (shared by both collectors)
  wiki/              model + markdown + HTML + charts + structure renderers
analyzer/      Node + Playwright. Renders pages, runs core, writes the bundle.
extension/     MV3 sidebar. Injects the same collector, runs the same core.
mcp/           MCP server. Same core, exposed as six tools over stdio.
knowledge/     Shopify domain knowledge (themes, sections, components, platform)
docs/          CONCEPT.md (source of record) · REFERENCE.md (threshold provenance)
```

`core/` is shared verbatim — `scripts/sync-core.js` copies it into the extension.
There is no second implementation, so a score in the sidebar and a score from the
CLI cannot disagree.

## Test

```bash
node test/run.js         # 129 — core, calibration, retrieval, parity, operability, bundle
cd mcp && node test.mjs  # 31  — MCP protocol surface
node test/overlay.mjs    # 47  — the overlay and grid detection, in a real browser
node test/extension.mjs  # 64  — the packaged extension, loaded in a real Chrome
```

The last two need Chromium and skip cleanly without one. They exist because
neither thing can be tested as a Node module: the column grid was wrong for its
whole life and looked right at the one window width anyone checked, and a
packaged extension that lost its icon still loads. `test/extension.mjs` loads
the real build in Chrome, reads the manifest back from Chrome rather than from
disk, and drives a full collect → analyse → export inside the side panel.
