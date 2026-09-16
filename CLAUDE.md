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
`dimensions.js` and moves the score. Defects go in `checks.js` and do not.

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
- **A high consistency score does not mean "ship it."** Quality defects do not
  move the score, so narrative findings that draw conclusions from it (see
  `meta-ready-to-port` in `synthesis.js`) must check the finding pile for
  blockers before claiming the remainder is polish.

## After changing core/

```bash
node scripts/sync-core.js    # the extension loads its own copy
node test/run.js
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
