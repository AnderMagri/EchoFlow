# EchoFlow 2.0 — Concept

*EchoFlow stops being a screenshot tool and becomes this analysis. Same house, new engine.*

*This document exists for one reason: to stop the scope sliding back into the "dump
everything" that sank the old version. If a future decision contradicts this
one-pager, it has to justify why.*

> Translated from the original Portuguese concept note. The source of record for
> the product; the code is downstream of it.

---

## What we are fixing

Old EchoFlow was organised around what the tool **could extract** — five axes side
by side, all equally weighted, each spitting out what it found. The problem was
never technical: it was conceptual, and it leaked straight into the visuals. A
report like that answers *"what's on this site?"*, which is curiosity. It never
answers *"how far is this site from a clean system, and what do I fix first?"*,
which is the question that pays for the migration work.

The turn: **organise around the reader's decision, not around what the tool
measured.** The intelligence lives in the synthesis, not the extraction.

---

## The product in one line

A UX and design analysis for sites that **are or will be Shopify**, with
**consistency as the north star**.

Not a generic analyser with a Shopify tab. Shopify is the product. A check only
earns a place here if it changes the *analysis* — not if it just adds another
data point.

### Two moments in the cycle, one engine

- **Will be** (pre-migration): read a site that is not yet Shopify and reverse-engineer
  the design system and UX to rebuild it in a theme. Extraction leads.
- **Is** (optimisation): read a live store and use what a generic tool does not have —
  `products.json`, theme structure, runtime, app detection, conversion benchmarks.
  Comparison leads.

The north star serves both at once: *how far is this site from a clean Shopify
system?* (coherent tokens, standard PDP anatomy, sane theme sections).

---

## The primitive: the Finding

Everything the system produces has **the same shape**. There is one kind of thing;
everything else is a query over the pile of Findings.

| Field | Description |
|---|---|
| **Surface** | Which page/section (Home, PLP, PDP, Cart…) |
| **Axis** | Design / UX / Engine — a tag only, never a top-level structure |
| **Impact** | How much it weighs |
| **Effort** | How easy it is to resolve |
| **Evidence** | The extracted data that proves the finding |
| **Recommendation** | What to do |

**Ranking:** a single model — impact × effort. No five loose scores nobody knows
how to add up.

---

## The three axes

1. **Design** — tokens, fonts, colours, layout + **consistency verdict**.
2. **UX** — copy, CTAs, options, flow, against benchmark.
3. **Engine** — apps, scripts, theme and **performance** (Core Web Vitals, page
   weight). Performance is not a separate axis: it is the same family.

They run **separately** (the user picks and runs), but **write in the same format**.
On the day all three run, a cross-synthesis pass produces meta-findings — *"Design
promises premium, UX delivers generic."* Silos that do not talk to each other =
back to concatenating = the old EchoFlow mess.

---

## The scope rule

It is not the analysis that is or is not single-page — it is the **check**.

- **Extractive check** (tokens, copy on one PDP, scripts on one screen) → runs at
  **any scope**.
- **Comparative check** (consistency, journey coherence) → **requires the whole site**.

Consequences:
- **Design single-page** gives you the implicit design system, but **not** the
  consistency verdict — that needs the site.
- **UX single-page** is valid and common — auditing just the PDP (copy, CTA,
  options) is the "component deep-dive".
- **Engine is global** — apps and scripts live across the whole site; single-page
  says nothing there.

And the point that stands: **whole-site is not running single-page N times and
concatenating.** Concatenating *is* the problem. The value of site mode lives in
the layer above — the synthesis that only exists when you look at everything together.

---

## Output: a wiki report

A wiki because the same findings are navigable by **link, not by copy** — static
and self-contained, built to download and host. It needs a spine, or it becomes a
dump again.

- **Entry = the verdict.** Consistency score at the top (the north star) + priority
  findings from every axis. This is the screen that goes to the client.
- **Three axis pages:** Design, UX, Engine.
- **Surface pages:** Home, PLP, PDP, Cart — each crossing the three axes on that screen.

The same finding appears on the axis page **and** the surface page because it is a
link. The wiki working in our favour, for free.

### One output, two densities

"Me" and "client" are **not two reports** — it is the same report at different
densities (progressive disclosure):

- **Me mode:** every finding, raw, dry, jargon allowed, raw data expanded.
- **Client mode:** only above a severity threshold, narrative, plumbing hidden.

Maintaining two designs would double the work forever.

---

## The differentiator

The **Design axis output is not just critique — it is the seed of the rebuild.**
The extracted tokens come out as the start of a design system ready to reuse. The
audit becomes the **mouth of your pipeline**, not a dead end.

---

## Engine, interface, delivery

**Engine.** Live DOM via **headless Playwright**, not screenshots. Render the URL
server-side, take the real post-JS state, mobile and desktop — structured data
instead of reinterpreted pixels.

**Interface — the sidebar stays.** It is the working surface: you browse the
client's site and fire the analysis from there, without leaving the page. What
changes from old EchoFlow is what runs behind the button (structured extraction,
not a screen-print), not the gesture.

**Page selection — by hand or automatic, and the two compose.** Browsing and
adding pages is the honest default: it handles pages behind a login, a region
picker or a click, and it is how you audit the journey you actually care about.
But it is also where a run goes wrong, because someone adds three pages with no
two of the same type and every comparative dimension skips. So the same sampler
the CLI uses — sitemap, then a two-level crawl, then a quota per template type —
is available from the sidebar, and it PROPOSES rather than proceeds: the list is
shown and editable before a single tab opens on the client's site. Automatic is
a better starting point for the manual flow, not a replacement for it.

**Delivery — the wiki is the artefact.** The analysis produces a static,
self-contained wiki you **download and host wherever you want** to share with the
client. The sidebar is where you work; the wiki is what goes out the door.

---

## Non-goals (the edges that hold the scope)

- **Do not** show everything that was extracted. The tool decides what matters and
  in what order.
- **Not** a generic analyser — if it is not specific to Shopify/migration, it stays out.
- **No** axes with equal weights comparable by accident — one ranking model, one
  north star.
- **Not** two products per reader or per scope — one engine, one primitive, lenses
  on top.

---

## Additions to the original concept

Three things were added during the build. Each is recorded here so the document
stays the source of record.

### 1. Consistency as the measuring instrument, not a score

The original note names consistency as the north star. In the build it became the
*method*: three general primitives that all three axes reuse, rather than a
per-axis special case.

- **Vocabulary coherence** — how close the set of values used for one property is
  to a designed set. Penalises near-duplicates and sprawl. Extractive.
- **Cross-page agreement** — for a role that should be invariant, what share of
  pages agree. Comparative.
- **Rhythm adherence** — what share of numeric values sit on the detected base unit.

One number can legitimately span Design, UX and Engine precisely because it is the
same measurement pointed at different evidence.

### 2. The design review lives in two places

The wiki is still the artefact that goes out the door. But the design review — the
extracted system, the score, the findings — is also rendered **in the Chrome
sidebar**, for quick access while browsing, without generating a report. Same core
code, so the two cannot disagree.

### 3. Structure view

The page as boxes, captured from the live DOM. Two surfaces:

- In the **wiki**, an interactive wireframe with outlines, fills, labels, a
  12-column overlay and a depth slider.
- In the **extension**, an overlay drawn on the **live page**, so you can scroll
  the client's site with the skeleton lit up.

It is also measured, not just viewed: `layout-skeleton` compares section skeletons
across pages of the same type, and `column-systems` counts how many grids the site
is running. Structure that is only viewable would have been a toy; measured, it
answers the first question of any migration estimate — *how many sections is this?*
