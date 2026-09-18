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

## After changing core/

```bash
node scripts/sync-core.js    # the extension loads its own copy
node test/run.js
cd mcp && node test.mjs      # MCP protocol surface
```

## Testing against a real page

`test/fixture-site/` is a deliberately inconsistent storefront (three PDPs that
drift in button style, nav, price format and section skeleton).

```bash
python3 -m http.server 8099 --directory test/fixture-site &
node analyzer/src/cli/index.js http://127.0.0.1:8099/ --out /tmp/ef
```

In a sandbox, Chromium may need `ECHOFLOW_CHROMIUM`, `ECHOFLOW_NO_SANDBOX=1` and
`ECHOFLOW_PROXY`.
