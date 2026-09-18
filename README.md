# EchoFlow 2.0

**A Shopify consistency audit.** It answers one question: *how far is this site
from a clean system, and what do I fix first?*

Not a generic site analyser. Shopify is the product — for sites that **are** one
or **will be** one.

> v1 (the screenshot tool) is retired and lives in [`archive/v1`](archive/). 2.0
> shares no code with it. The reasoning behind the rewrite is in
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

```bash
git clone https://github.com/AnderMagri/EchoFlow.git
cd EchoFlow/analyzer && npm install && npx playwright install chromium
```

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

Six tools. The design constraint is context, not capability: an analysis is ~80KB
of JSON, so every tool summarises by default and offers a narrower query to drill in.

| Tool | |
|---|---|
| `echoflow_analyze` | Render and measure a site. Returns the verdict and top findings; writes the full bundle to disk. |
| `echoflow_findings` | Filter by axis, surface, band, basis or kind. One line each. |
| `echoflow_finding` | One finding in full — evidence, recommendation, criterion. |
| `echoflow_tokens` | The extracted design system as css / dtcg / tailwind / shopify / json. |
| `echoflow_structure` | Section skeleton for a surface. |
| `echoflow_retrieval` | The machine-readability picture: crawler access, structured data, no-JS survival. |
| `echoflow_explain` | What the tool measures and what a score does and does not mean. |

## Use it — Chrome sidebar

```bash
node scripts/sync-core.js     # copy core/ into the extension
```

`chrome://extensions` → Developer mode → **Load unpacked** → pick `extension/`.

The sidebar is the working surface: browse the client's site and analyse from
where you are. Three tabs —

- **Design review** — the extracted system (palette, ramp, type scale, spacing
  rhythm, radii) right in the tab, no report needed.
- **Findings** — ranked, with recommendations.
- **Structure** — draws the box skeleton **on the live page**. Sections, all
  boxes, or a 12-column overlay. Scroll the site with it on.

Export writes the same wiki bundle the CLI produces, as a `.zip`.

---

## The output bundle

Unzip it and there is exactly one thing to open:

```
START HERE.html    the verdict, the charts, and a route to everything else
report/
  site/            static HTML. Host it anywhere. The client's copy.
  pages/           markdown with front-matter — verdict, per axis, per owner, per surface.
  findings/        one file per finding, stable filename.
  data/            JSON — the source everything else is rendered from.
  CLAUDE.md        how an AI agent should navigate the folder.
  manifest.json    index of the bundle.
```

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
archive/v1/    the retired screenshot tool
```

`core/` is shared verbatim — `scripts/sync-core.js` copies it into the extension.
There is no second implementation, so a score in the sidebar and a score from the
CLI cannot disagree.

## Test

```bash
node test/run.js        # 113 tests — core, calibration, retrieval, parity, operability, bundle
cd mcp && node test.mjs # MCP protocol surface
```
