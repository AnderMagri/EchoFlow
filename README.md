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

**One primitive, one ranking.** Everything is a Finding. `priority = impact × effort`.
No second score, no per-axis weights that are comparable by accident.

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

One analysis, one folder, three readers — and no copy of the truth:

```
site/          static HTML. Unzip and open, or host anywhere. The client's copy.
pages/         markdown with YAML front-matter.
findings/      one file per finding, stable filename.
data/          JSON — the source everything else is rendered from.
CLAUDE.md      how an AI agent should navigate the folder.
manifest.json  index of the bundle.
```

`data/analysis.json` is the single source. Every other file is a projection of it.

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
  finding.js       the Finding primitive — the only record type
  consistency.js   the three measurement primitives + aggregation
  dimensions.js    17 consistency dimensions across the three axes
  synthesis.js     cross-axis meta-findings
  tokens.js        the design system seed
  collect-dom.js   the DOM collector (shared by both collectors)
  wiki/            model + markdown + HTML + structure renderers
analyzer/      Node + Playwright. Renders pages, runs core, writes the bundle.
extension/     MV3 sidebar. Injects the same collector, runs the same core.
knowledge/     Shopify domain knowledge (themes, sections, components, platform)
archive/v1/    the retired screenshot tool
```

`core/` is shared verbatim — `scripts/sync-core.js` copies it into the extension.
There is no second implementation, so a score in the sidebar and a score from the
CLI cannot disagree.

## Test

```bash
node test/run.js
```
