# Thresholds and their provenance

Every number EchoFlow compares against, and — more usefully — **what it licenses
you to claim**. Overclaiming is the main failure mode of an audit tool, so the
basis matters as much as the threshold.

Each finding carries a `basis` field, and the three are not interchangeable:

| Basis | Meaning | Language to use |
|---|---|---|
| `prescriptive` | A published criterion with a number. Pass/fail, checkable, cited. | "fails SC 2.5.8" |
| `practice` | Convergent convention with no governing body. | "outside established practice" |
| `directional` | An effect observed on other catalogues. | "worth testing on your traffic" |

A `prescriptive` finding **cannot be created without a citation** — the schema
rejects it. Vague appeals to "accessibility guidelines" are what make a client
suspect the whole report is opinion in a lab coat.

---

## Prescriptive — cited standards

| Check | Criterion | Threshold |
|---|---|---|
| `design-target-under-24` | WCAG 2.2 SC 2.5.8 Target Size (Minimum), AA | 24×24 CSS px |
| `design-contrast-token`, `design-contrast-elements` | WCAG 2.2 SC 1.4.3 Contrast (Minimum), AA | 4.5:1 body, 3:1 large |
| `ux-missing-alt` | WCAG 2.2 SC 1.1.1 Non-text Content, A | alt present |
| `ux-unlabeled-controls` | WCAG 2.2 SC 3.3.2 Labels or Instructions, A | label associated |
| `design-heading-jumps` | WCAG 2.2 SC 1.3.1 Info and Relationships, A | no skipped levels |

**The 2.5.8 exemptions are implemented.** Targets inline within a sentence are
exempt, and the count of exempted links travels in the evidence. An audit that
flags every in-paragraph link produces noise and loses trust.

---

## Established practice — convention, not standard

| Check | Threshold | Source |
|---|---|---|
| `design-target-under-44` | 44×44pt (Apple HIG), 48×48dp (Material) | Platform conventions. Stronger than WCAG AA, and what muscle memory is trained on. |
| `design-text-under-12` | 12px floor | **WCAG sets no minimum pixel size.** Practical convention only. |
| `design-measure-wide` / `-narrow` | 45–75 characters per line | Bringhurst (66 ideal); Nielsen Norman 50–70; Baymard the same range for ecommerce. Three independent sources converging makes this unusually safe ground. |
| `ux-action-below-fold` | first action above the fold | NNG *Scrolling and Attention* (2018): 57% of viewing time above the fold, 74% within two screenfuls. |
| `ux-page-depth-*` | home 8/12, pdp 12/16, plp 10/14 screens | DTC health/wellness convention. A benchmark to argue from, not a rule to fail against. |
| `ux-core-content-depth` | first product ≤ 1 screen | Same attention research. |
| `design-section-outlier` | section > 2.5 screens | Convention. Usually desktop padding carried into mobile. |
| `design-footer-share` | < 8% good, > 12% problem | Convention. |
| `ux-nav-overload` | 5–7 top-level items | Hick's Law — T = b × log₂(n+1). Modest per item, compounds across a journey. |
| `ux-thumb-reach` | primary action in bottom 60% | Thumb-zone research. Bottom-centre third is the resting position. |

---

## Directional — other people's numbers

Quoted as a range, attributed to others, never projected onto the client.

- Retailers publishing A/B results on sticky buy bars report add-to-cart gains
  around **10–15%**, larger on mobile because mobile users scroll further past
  the original button.
- Baymard's form research: a 15-field form split across three steps outperformed
  a 10-field single-page form by **11–14%** on completion. The argument for
  grouping and collapsing — people judge difficulty by how much they can see,
  not how much exists.

The correct framing is always *"this is why it is worth testing on your
traffic"*, never *"this will lift your conversion by X"*.

---

## Manipulative patterns

Brignull's taxonomy, restricted to what is mechanically detectable. Every
finding carries the **literal matched string**, because these are accusations
and the reader must be able to overrule the tool in one glance. The language
describes the pattern, never the intent — a regex cannot establish motive.

| Check | Pattern | Detection |
|---|---|---|
| `ux-confirmshaming` | Confirmshaming | Text patterns on decline controls |
| `ux-pre-checked-optin` | Pre-selected consent | `input[type=checkbox][checked]` with marketing-related labels |
| `ux-urgency-pressure` | Scarcity / urgency | Text patterns + countdown elements. **Reported as a prompt to verify, not a verdict** — the tool cannot tell a live stock count from a decorative one. |
| `ux-hard-to-cancel` | Roach motel | Text patterns on cancellation copy |
| `ux-late-costs` | Hidden costs | Text patterns deferring fees to checkout |
| `ux-disguised-promos` | Disguised ads | Sponsored/promoted markers in the content flow |

Several are regulated in the EU and UK. That is stated as context for why they
are worth fixing, not as a legal opinion.

---

## Measurement protocol

**Viewports are usable heights, not device heights.**

| | Width | Usable height | Why |
|---|---|---|---|
| Mobile | 390 | **640** | iPhone-class viewport less browser chrome with the address bar showing. Using the full 844 flatters the design by about a quarter. |
| Desktop | 1440 | **800** | 1440×900 display less browser chrome. |

The fold line is **declared in every report** (`method.foldLines`). An audit
whose fold is undeclared cannot be checked by the person reading it.

**Method notes that prevent false results, all implemented:**

- **Visibility is inherited.** The collector walks the ancestor chain. A node
  with its own `display:block` inside a hidden section is not on the page, and
  checking only the node is the largest single source of false positives.
- **Controls are classified by role, not by class name.** A `div` called `chip`
  is not tappable. Name-based classification is how an audit turns into damage.
- **Characters per line** is `width / (font-size × 0.48)` — a humanist-sans
  average. Stated as an approximation in the evidence so the number is not
  over-trusted.

---

## What is never assessed

Declared in every report as `notAssessed`, because a usability score that
implies accessibility coverage it does not have is worse than no score:

- Keyboard and screen-reader journeys
- Motion, animation, reduced-motion preferences
- Contrast of every rendered pair (only token pairs and sampled elements)
- Copy quality, tone, claim accuracy
- Anything behind authentication, including the real checkout
