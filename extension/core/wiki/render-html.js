/**
 * Static HTML rendering — the half you hand to a client.
 *
 * Self-contained: no build step, no CDN, no server. Unzip and open, or drop the
 * folder on any static host.
 *
 * The two densities are ONE document with a toggle, not two exports. Keeping
 * them as separate builds would mean maintaining two designs forever, and they
 * would drift — which, on a tool about consistency, would be embarrassing.
 *
 * @module core/wiki/render-html
 */

import {
  AXIS_LABELS, BASIS_LABELS, BASIS_NOTE, GEO_GROUP_BRIEF, GEO_GROUP_LABELS,
  OWNER_BRIEF, OWNER_LABELS, OWNERS, SURFACE_LABELS, effortLabel, geoGroupFor,
  priorityBand,
} from '../finding.js';
import {
  CHART_CSS, CHART_JS, bandStrip, impactEffortScatter, ownerBars, scoreBars,
  severityBar, stackedBandBars, stepLadder,
} from './charts.js';
import { GRADE_COPY } from '../consistency.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CLIENT_THRESHOLD = 40;

// ---------------------------------------------------------------------------

export const WIKI_CSS = `
:root {
  --bg: #fbfbfa; --surface: #ffffff; --raised: #f5f5f4;
  --border: #e4e4e2; --border-strong: #d0d0cd;
  --ink: #16160f; --muted: #6b6b63; --faint: #91918a;
  --accent: #1f4f8f;
  --critical: #a8321f; --high: #b06616; --medium: #5c6b3d; --low: #6b6b63;
  --critical-bg: #fbeeec; --high-bg: #fdf3e8; --medium-bg: #f1f4ec; --low-bg: #f3f3f1;
  --radius: 6px;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #14140f; --surface: #1c1c18; --raised: #242420;
    --border: #2f2f2a; --border-strong: #3d3d37;
    --ink: #eeeee8; --muted: #a3a39a; --faint: #78786f;
    --accent: #7fa8dc;
    --critical: #e28270; --high: #ddaa66; --medium: #a8bd84; --low: #a3a39a;
    --critical-bg: #2a1a16; --high-bg: #2a2118; --medium-bg: #1e2419; --low-bg: #222220;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: var(--sans); font-size: 15px; line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 920px; margin: 0 auto; padding: 0 16px 96px; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

header.site {
  border-bottom: 1px solid var(--border); background: var(--surface);
  position: sticky; top: 0; z-index: 20;
}
header.site .inner {
  max-width: 920px; margin: 0 auto; padding: 12px 16px;
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
}
.brand { font-weight: 650; letter-spacing: -0.01em; }
.brand span { color: var(--faint); font-weight: 400; }
nav.tabs { display: flex; gap: 2px; flex-wrap: wrap; margin-left: auto; }
nav.tabs a {
  padding: 5px 10px; border-radius: var(--radius); color: var(--muted);
  font-size: 13px; font-weight: 500;
}
nav.tabs a:hover { background: var(--raised); text-decoration: none; }
nav.tabs a[aria-current="page"] { background: var(--raised); color: var(--ink); }

.density {
  display: flex; gap: 0; border: 1px solid var(--border-strong);
  border-radius: var(--radius); overflow: hidden; font-size: 12px;
}
.density button {
  border: 0; background: var(--surface); color: var(--muted);
  padding: 5px 11px; cursor: pointer; font: inherit; font-weight: 500;
}
.density button[aria-pressed="true"] { background: var(--ink); color: var(--bg); }

h1 { font-size: 30px; letter-spacing: -0.02em; margin: 32px 0 6px; line-height: 1.2; }
h2 { font-size: 19px; letter-spacing: -0.01em; margin: 40px 0 12px;
     padding-bottom: 7px; border-bottom: 1px solid var(--border); }
h3 { font-size: 15px; margin: 26px 0 10px; }
p.lede { color: var(--muted); margin: 0 0 24px; font-size: 16px; }

.verdict { padding: 4px 0 26px; margin: 18px 0 0; border-bottom: 1px solid var(--border-strong); }
.verdict .score { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.verdict .num { font-size: 56px; font-weight: 300; letter-spacing: -0.04em; line-height: 1; }
.verdict .grade {
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.09em;
  font-weight: 650; padding: 4px 9px; border-radius: 4px;
  background: var(--raised); color: var(--muted);
}
.verdict .of { color: var(--faint); font-size: 18px; }
.verdict blockquote {
  margin: 18px 0 0; padding-left: 14px; border-left: 2px solid var(--border-strong);
  color: var(--muted); font-size: 15px;
}
.meter { height: 3px; background: var(--border); margin-top: 18px; }
.meter i { display: block; height: 100%; background: var(--ink); }

/* Score decomposition — the same weighted mean, partitioned, so the number is
   explained rather than asserted. */
.bd { margin: 22px 0 0; }
.bd-row { display: grid; grid-template-columns: 132px 1fr 34px; gap: 14px; align-items: center; padding: 4px 0; }
.bd-row .k { font-size: 13px; color: var(--muted); }
.bd-row .v { font-size: 13px; text-align: right; font-variant-numeric: tabular-nums; }
.bd-row .track { height: 2px; background: var(--border); position: relative; }
.bd-row .track i { position: absolute; inset: 0 auto 0 0; background: var(--ink); }
.bd-row.dim .k, .bd-row.dim .v { color: var(--faint); font-style: italic; }
.bd-row.dim .track i { width: 100% !important; background: repeating-linear-gradient(90deg,var(--border-strong) 0 3px,transparent 3px 6px); }
.platform-tag {
  display: inline-block; font-family: var(--mono); font-size: 11px; font-weight: 650;
  text-transform: uppercase; letter-spacing: .06em; padding: 3px 7px;
  background: var(--ink); color: var(--bg); margin-bottom: 12px;
}
.platform-tag.warn { background: var(--high); }

.axes { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin: 18px 0 0; }
.axis-card { padding: 11px 0 0; border-top: 2px solid var(--ink); }
.axis-card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--faint); font-weight: 600; }
.axis-card .val { font-size: 26px; font-weight: 350; letter-spacing: -0.02em; margin-top: 2px; }
.axis-card .read { font-size: 12px; color: var(--muted); }

/* Findings are hairline-separated rows with a hanging priority, not bordered
   cards. A card per finding spends its border and padding on decoration, and a
   coloured left edge on a rounded box is generic dashboard chrome — it says
   "severity" less clearly than the number itself does. */
.finding {
  display: grid; grid-template-columns: 46px 1fr; gap: 16px;
  padding: 16px 0; border-top: 1px solid var(--border);
}
.finding:first-of-type { border-top: 0; }
.finding .pri {
  font-family: var(--mono); font-size: 17px; font-weight: 600;
  font-variant-numeric: tabular-nums; line-height: 1.25;
}
.finding.critical .pri { color: var(--critical); }
.finding.high     .pri { color: var(--high); }
.finding.medium   .pri { color: var(--medium); }
.finding.low      .pri { color: var(--low); }
.finding .pri small {
  display: block; font-size: 9.5px; font-weight: 650; letter-spacing: .06em;
  text-transform: uppercase; color: var(--faint); margin-top: 2px; font-family: var(--sans);
}
.finding .top { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; margin-bottom: 4px; }
.finding .title { font-weight: 600; font-size: 15px; flex: 1; min-width: 200px; }
.finding .rec { color: var(--muted); font-size: 14px; margin: 5px 0 0; }

.tag {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em;
  font-weight: 650; padding: 2.5px 7px; border-radius: 3px; white-space: nowrap;
}
.tag.critical { background: var(--critical-bg); color: var(--critical); }
.tag.high { background: var(--high-bg); color: var(--high); }
.tag.medium { background: var(--medium-bg); color: var(--medium); }
.tag.low { background: var(--low-bg); color: var(--low); }
.tag.axis { background: var(--raised); color: var(--muted); }
.tag.meta { background: var(--accent); color: var(--surface); }
/* The three kinds of claim must look different, or a convention borrows the
   authority of a standard. */
.tag.prescriptive { background: var(--ink); color: var(--bg); }
.tag.practice { background: transparent; color: var(--muted); box-shadow: inset 0 0 0 1px var(--border-strong); }
.tag.directional { background: transparent; color: var(--faint); box-shadow: inset 0 0 0 1px var(--border); font-style: italic; }
.finding.strength .pri { color: var(--medium); }
.finding.strength .pri small { color: var(--medium); }
.cite { font-family: var(--mono); font-size: 11px; color: var(--faint); margin-top: 4px; }
.tag.owner-design { background: var(--raised); color: var(--muted); }
.tag.owner-marketing { background: color-mix(in srgb, var(--high) 16%, transparent); color: var(--high); }
.tag.owner-engineering { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
.owner-lede {
  border-left: 2px solid var(--border-strong); padding: 2px 0 2px 14px;
  color: var(--muted); font-size: 15px; margin: 0 0 26px;
}
.owner-counts, .page-counts { display: flex; gap: 26px; margin: 0 0 8px; }
.owner-counts div .n, .page-counts div .n { font-size: 26px; font-weight: 350; letter-spacing: -.02em; }
.owner-counts div .l, .page-counts div .l { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); font-weight: 650; }
.page-counts .crit .n { color: #d03b3b; }
p.lede.small { font-size: 14px; margin-bottom: 14px; max-width: 70ch; }
h2 .count { font-size: 12px; color: var(--faint); font-weight: 500; font-variant-numeric: tabular-nums; }
.limits { margin-top: 12px; }
.limits li { color: var(--muted); font-size: 13.5px; margin-bottom: 3px; }

.meta-line { font-size: 12px; color: var(--faint); margin-top: 8px; }
details.evidence { margin-top: 10px; }
details.evidence summary {
  cursor: pointer; font-size: 12.5px; color: var(--muted); font-weight: 500;
  padding: 3px 0; user-select: none;
}
details.evidence summary:hover { color: var(--ink); }
details.evidence pre {
  background: var(--raised); border-radius: var(--radius); padding: 12px;
  overflow-x: auto; font-family: var(--mono); font-size: 12px; line-height: 1.5;
  margin: 8px 0 0; color: var(--muted);
}

table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 14px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
th { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--faint); font-weight: 650; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.unmeasured td { color: var(--faint); font-style: italic; }

.swatches { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.sw { text-align: center; font-size: 11px; font-family: var(--mono); color: var(--muted); }
.sw i { display: block; width: 62px; height: 46px; border-radius: var(--radius);
        border: 1px solid var(--border-strong); margin-bottom: 4px; }

pre.code {
  background: var(--raised); border-radius: var(--radius); padding: 14px;
  overflow-x: auto; font-family: var(--mono); font-size: 12.5px; line-height: 1.55;
}
.note {
  background: var(--raised); border-left: 3px solid var(--border-strong);
  padding: 11px 14px; border-radius: 0 var(--radius) var(--radius) 0;
  font-size: 13.5px; color: var(--muted); margin: 16px 0;
}
.empty { color: var(--faint); font-style: italic; padding: 18px 0; }
.hidden-by-density { display: none !important; }
footer.site {
  border-top: 1px solid var(--border); margin-top: 56px; padding-top: 18px;
  font-size: 12px; color: var(--faint);
}
@media (max-width: 620px) {
  h1 { font-size: 25px; }
  .verdict { padding: 19px; }
  .verdict .num { font-size: 44px; }
  header.site .inner { gap: 10px; }
  nav.tabs { width: 100%; margin-left: 0; order: 3; }
}
` + CHART_CSS;

export const WIKI_JS = CHART_JS + `
(function () {
  var KEY = 'echoflow-density';
  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  function apply(density) {
    var threshold = density === 'client' ? ${CLIENT_THRESHOLD} : 0;
    document.querySelectorAll('[data-priority]').forEach(function (el) {
      var p = parseInt(el.getAttribute('data-priority'), 10);
      el.classList.toggle('hidden-by-density', p < threshold);
    });
    document.querySelectorAll('[data-density-only]').forEach(function (el) {
      el.classList.toggle('hidden-by-density', el.getAttribute('data-density-only') !== density);
    });
    document.querySelectorAll('.density button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.density === density));
    });
    // A section whose every finding is filtered out should not leave a heading
    // hanging over nothing.
    document.querySelectorAll('[data-section]').forEach(function (sec) {
      var any = sec.querySelectorAll('[data-priority]:not(.hidden-by-density)').length;
      sec.classList.toggle('hidden-by-density', !any);
    });
    var c = document.querySelector('[data-count]');
    if (c) {
      var n = document.querySelectorAll('[data-priority]:not(.hidden-by-density)').length;
      c.textContent = n;
    }
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('.density button');
    if (!b) return;
    write(b.dataset.density);
    apply(b.dataset.density);
  });

  apply(read() || 'full');
})();
`;

// ---------------------------------------------------------------------------

function layout({ title, site, nav, body, generatedAt }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${esc(site)}</title>
<link rel="stylesheet" href="assets/wiki.css">
</head>
<body>
<header class="site">
  <div class="inner">
    <div class="brand">EchoFlow <span>/ ${esc(site)}</span></div>
    <div class="density" role="group" aria-label="Report density">
      <button data-density="full" aria-pressed="true" title="Everything, raw, jargon allowed">Full</button>
      <button data-density="client" aria-pressed="false" title="Only what clears the severity bar">Client</button>
    </div>
    <nav class="tabs">${nav}</nav>
  </div>
</header>
<div class="wrap">
${body}
<footer class="site">
  Generated by EchoFlow ${esc(generatedAt)} · <span data-count></span> findings shown ·
  Machine-readable copies of everything here are in <code>data/</code> and <code>pages/</code>.
</footer>
</div>
<script src="assets/wiki.js"></script>
</body>
</html>`;
}

function navFor(model, current) {
  const items = [['index', 'Verdict'], ...model.pages
    .filter((p) => p.slug !== 'index')
    // Owner tabs get a "For " prefix. Without it the nav reads "Design ...
    // Design", because Design is both an axis (what kind of problem) and an
    // owner (whose problem) — which is the distinction, not a collision.
    .map((p) => [p.slug, p.kind === 'axis' ? AXIS_LABELS[p.axis]
      : p.kind === 'owner' ? `For ${OWNER_LABELS[p.owner].toLowerCase()}` : p.title])];
  return items.map(([slug, label]) =>
    `<a href="${slug}.html"${slug === current ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('');
}

/**
 * The counts-and-bands header every findings page now carries.
 *
 * The axis, owner and surface pages were a heading, a table and a wall of
 * cards. The verdict page had every chart and they had none, so the one screen
 * a reader actually lands on from the nav was the least legible in the bundle.
 * Same data, drawn once, used everywhere.
 */
function pageHeader(findings, { scatter = true } = {}) {
  const problems = findings.filter((f) => f.kind !== 'strength');
  const strengths = findings.length - problems.length;
  const bands = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of problems) bands[priorityBand(f.priority)]++;

  return `<div class="page-counts">
  <div><div class="n">${problems.length}</div><div class="l">finding${problems.length === 1 ? '' : 's'}</div></div>
  ${bands.critical ? `<div class="crit"><div class="n">${bands.critical}</div><div class="l">critical</div></div>` : ''}
  ${bands.high ? `<div><div class="n">${bands.high}</div><div class="l">high</div></div>` : ''}
  ${strengths ? `<div><div class="n">${strengths}</div><div class="l">working well</div></div>` : ''}
</div>
${bandStrip(bands)}
${scatter ? impactEffortScatter(problems.map((f) => ({
    title: f.title, impact: f.impact, effort: f.effort, priority: f.priority,
    band: priorityBand(f.priority), owner: OWNER_LABELS[f.owner] || f.owner,
  })), { title: 'What to do first on this page' }) : ''}`;
}

const bandsOf = (findings) => {
  const bands = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings.filter((x) => x.kind !== 'strength')) bands[priorityBand(f.priority)]++;
  return bands;
};

function findingCard(f) {
  const band = priorityBand(f.priority);
  return `<article class="finding ${band}" data-priority="${f.priority}" id="${esc(f.id)}">
  <div class="pri">${f.kind === 'strength' ? '&#10003;' : f.priority}<small>${f.kind === 'strength' ? 'strength' : esc(band)}</small></div>
  <div>
    <div class="top">
      <span class="title">${esc(f.title)}</span>
      ${f.kind === 'meta' ? '<span class="tag meta">cross-axis</span>' : ''}
      <span class="tag axis">${esc(AXIS_LABELS[f.axis])}</span>
      <span class="tag owner-${esc(f.owner)}" title="${esc(OWNER_BRIEF[f.owner] || '')}">${esc(OWNER_LABELS[f.owner] || f.owner)}</span>
      <span class="tag ${esc(f.basis)}" title="${esc(BASIS_NOTE[f.basis] || '')}">${esc(BASIS_LABELS[f.basis] || f.basis)}</span>
    </div>
    <p class="rec">${esc(f.recommendation)}</p>
    <div class="meta-line">
      Impact ${f.impact}/10 · effort to fix: ${esc(effortLabel(f.effort))} ·
      ${esc(SURFACE_LABELS[f.surface] || f.surface)} · ${esc(f.scope)} check
    </div>
    ${f.citation ? `<div class="cite">${esc(f.citation)}</div>` : ''}
    <details class="evidence"><summary>Evidence</summary><pre>${esc(JSON.stringify(f.evidence, null, 2))}</pre></details>
  </div>
</article>`;
}

// --- pages -----------------------------------------------------------------

export function renderIndexHTML(model) {
  const c = model.consistency;
  const body = `
<h1>Consistency verdict</h1>
<p class="lede">${esc(model.site)} · ${model.scope === 'site' ? 'whole site' : 'single page'} · ${model.axes.map((a) => AXIS_LABELS[a]).join(' + ')}</p>
${model.platform ? `<div class="platform-tag ${model.isShopify ? '' : 'warn'}">${esc(model.platform === 'shopify' ? 'Shopify' : model.platform.replace(/-/g, ' '))}</div>
${model.isShopify ? '' : '<div class="note">This is <strong>not a Shopify store</strong>. Design and UX measurements are all valid; Shopify-specific checks (theme sections, app embeds, money format) have nothing to read. Treat it as a pre-migration audit.</div>'}` : ''}

<div class="verdict">
  <div class="score">
    <span class="num">${c.overall ?? '—'}</span><span class="of">/100</span>
    <span class="grade">${esc(c.grade)}</span>
    ${c.provisional ? '<span class="grade" style="background:var(--high-bg);color:var(--high)">provisional</span>' : ''}
  </div>
  <div class="meter"><i style="width:${c.overall ?? 0}%"></i></div>
  <blockquote>${esc(GRADE_COPY[c.grade])}</blockquote>
  ${c.caveat ? `<div class="note" style="margin-top:16px"><strong>Provisional — confidence ${esc(c.confidence)}.</strong> ${esc(c.caveat)}</div>` : ''}
  <div class="axes">
    ${model.axes.map((a) => `<div class="axis-card">
      <div class="label">${esc(AXIS_LABELS[a])}</div>
      <div class="val">${c.byAxis[a] ?? '—'}</div>
      <div class="read">${esc(reading(c.byAxis[a]))}</div>
    </div>`).join('')}
  </div>
</div>

${scoreBars(Object.entries(model.consistency.byGroup || {})
  .filter(([, g]) => model.axes.includes(g.axis))
  .sort((a, b) => (a[1].score ?? 999) - (b[1].score ?? 999))
  .map(([name, g]) => ({ name, score: g.score, measured: g.measured, declared: g.declared })))}

${severityBar(model.stats.bands)}

${ownerBars(OWNERS.map((o) => {
  const mine = model.findings.filter((f) => f.owner === o && f.kind !== 'strength');
  const bands = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of mine) bands[priorityBand(f.priority)]++;
  return { owner: o, label: OWNER_LABELS[o], bands, total: mine.length };
}))}

${impactEffortScatter(model.findings.filter((f) => f.kind !== 'strength').map((f) => ({
  title: f.title, impact: f.impact, effort: f.effort, priority: f.priority,
  band: priorityBand(f.priority), owner: OWNER_LABELS[f.owner] || f.owner,
})))}

<h2>What to fix first</h2>
<div data-section>
${model.findings.slice(0, 12).map(findingCard).join('\n')}
</div>

<h2>Dimensions measured</h2>
<table>
<thead><tr><th>Dimension</th><th>Axis</th><th class="num">Score</th><th>Scope</th></tr></thead>
<tbody>
${c.dimensions.map((d) => `<tr${d.score == null ? ' class="unmeasured"' : ''}>
  <td>${esc(d.label)}<br><span style="color:var(--faint);font-size:12px">${esc(d.question)}</span></td>
  <td>${esc(AXIS_LABELS[d.axis])}</td>
  <td class="num">${d.score ?? 'not measured'}</td>
  <td>${esc(d.scope)}</td></tr>`).join('')}
</tbody>
</table>
<h2>How to read this</h2>
<table>
<thead><tr><th>Label</th><th>What it licenses</th></tr></thead>
<tbody>
${Object.entries(BASIS_LABELS).map(([k, label]) =>
  `<tr><td><span class="tag ${k}">${esc(label)}</span></td><td>${esc(BASIS_NOTE[k])}</td></tr>`).join('')}
</tbody>
</table>
${model.method ? `<p style="color:var(--muted);font-size:13.5px">
Fold lines declared at ${esc(Object.entries(model.method.foldLines).map(([v, h]) => `${v} ${h}px`).join(', '))}.
${esc(model.method.viewportNote.join(' '))} ${esc(model.method.measureApproximation)}</p>` : ''}

${model.notAssessed?.length ? `<h2>Not assessed</h2>
<p style="color:var(--muted);font-size:13.5px">This is a layout, token and geometry audit. It does not cover:</p>
<ul class="limits">${model.notAssessed.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
<div class="note">A score that implies accessibility or performance coverage it does not have is worse than no score. Everything above was outside what this run measured.</div>` : ''}

${model.skipped.length ? `<div class="note"><strong>${model.skipped.length} dimension${model.skipped.length === 1 ? '' : 's'} not measured</strong> — excluded from the score rather than counted as passing. ${esc(model.skipped.map((s) => `${s.key} (${s.reason})`).join('; '))}.</div>` : ''}
`;
  return layout({ title: 'Verdict', site: model.site, nav: navFor(model, 'index'), body, generatedAt: model.generatedAt });
}

const reading = (s) => (s == null ? 'not measured'
  : s >= 85 ? 'held' : s >= 70 ? 'mostly held' : s >= 50 ? 'drifting' : 'decided per page');

export function renderAxisHTML(page, model) {
  const findings = page.findingIds.map((id) => model.findingIndex[id]).filter(Boolean);
  const groups = Object.entries(model.consistency.byGroup || {})
    .filter(([, g]) => g.axis === page.axis)
    .sort((a, b) => (a[1].score ?? 999) - (b[1].score ?? 999))
    .map(([name, g]) => ({ name, score: g.score, measured: g.measured, declared: g.declared }));

  const body = `
<h1>${esc(page.title)}</h1>
<p class="lede">${esc(page.summary)}</p>
${pageHeader(findings)}
${scoreBars(groups, { title: `Where the ${AXIS_LABELS[page.axis].toLowerCase()} score comes from` })}

<h2>Dimensions</h2>
<table>
<thead><tr><th>Dimension</th><th class="num">Score</th><th>Scope</th></tr></thead>
<tbody>
${page.dimensions.map((d) => `<tr${d.score == null ? ' class="unmeasured"' : ''}>
  <td>${esc(d.label)}<br><span style="color:var(--faint);font-size:12px">${esc(d.question)}</span></td>
  <td class="num">${d.score ?? esc(d.reason || 'not measured')}</td>
  <td>${esc(d.scope)}</td></tr>`).join('')}
</tbody>
</table>

<h2>Findings</h2>
<div data-section>
${findings.length ? findings.map(findingCard).join('\n') : '<p class="empty">Nothing found on this axis.</p>'}
</div>`;
  return layout({ title: page.title, site: model.site, nav: navFor(model, page.slug), body, generatedAt: model.generatedAt });
}

export function renderSurfaceHTML(page, model) {
  const sections = Object.entries(page.byAxis)
    .filter(([, ids]) => ids.length)
    .map(([axis, ids]) => `<div data-section><h2>${esc(AXIS_LABELS[axis])}</h2>
${ids.map((id) => model.findingIndex[id]).filter(Boolean).map(findingCard).join('\n')}</div>`)
    .join('\n');

  const findings = page.findingIds.map((id) => model.findingIndex[id]).filter(Boolean);
  const axisRows = Object.entries(page.byAxis).map(([axis, ids]) => {
    const list = ids.map((id) => model.findingIndex[id]).filter(Boolean);
    return { label: AXIS_LABELS[axis], bands: bandsOf(list), total: list.filter((f) => f.kind !== 'strength').length };
  });

  const body = `
<h1>${esc(page.title)}</h1>
<p class="lede">${esc(page.summary)}</p>
${pageHeader(findings)}
${stackedBandBars(axisRows, { title: 'Which axis this surface is failing on' })}
<div class="note">All three axes on one screen. Each finding also lives on its axis page — same record, reached two ways.</div>
${sections || '<p class="empty">Nothing found on this surface.</p>'}`;
  return layout({ title: page.title, site: model.site, nav: navFor(model, page.slug), body, generatedAt: model.generatedAt });
}

export function renderTokensHTML(model) {
  const t = model.tokens;
  const body = `
<h1>Design review</h1>
<p class="lede">The system this site is implicitly running — colour, type, spacing and shape as measured, then exported as something you can build with.</p>
<div class="note">This is a <strong>starting point, not a finished system</strong>. It reflects what the site does today, mistakes included. Review it before shipping.</div>

<h2>Colour</h2>
<p style="color:var(--muted);font-size:14px">Classified by the <strong>role</strong> each colour plays, because that is what a rendered page can actually show. Nothing here is called a brand colour: a page has no access to a brand, only to where paint was applied.</p>
${[
  ['Action', t.color.action ? [{ hex: t.color.action }] : [], 'The main call to action, read off the button itself.'],
  ['Surface', t.color.surface, 'What things are painted on, lightest first.'],
  ['Ink', t.color.ink, 'What text is set in.'],
  ['Line', t.color.line, 'Borders and dividers.'],
  ['Accent', t.color.accents, 'Chromatic colours doing none of the above, named by where they were seen.'],
].map(([name, list, note]) => `<h3>${esc(name)} <span style="color:var(--faint);font-weight:400;font-size:13px">${list.length ? '' : '— none found'}</span></h3>
<p style="color:var(--muted);font-size:13.5px;margin:0 0 8px">${esc(note)}</p>
${list.length ? `<div class="swatches">${list.map((c) => `<div class="sw"><i style="background:${esc(c.hex)}"></i>${esc(c.hex)}${c.where ? `<br><span style="color:var(--faint)">${esc(c.where.join(' · '))}</span>` : ''}</div>`).join('')}</div>` : ''}`).join('')}
${t.color.contrastWarnings.length ? `<div class="note"><strong>Contrast warnings</strong><ul style="margin:6px 0 0;padding-left:18px">
${t.color.contrastWarnings.map((w) => `<li><code>${esc(w.pair)}</code> is ${w.ratio}:1, needs ${w.required}:1. ${esc(w.note)}</li>`).join('')}
</ul></div>` : ''}

<h2>Typefaces</h2>
<p style="color:var(--muted);font-size:13.5px">Where each family is served from. A
family can be in Google's catalogue and still be loaded from somewhere else — Shopify's
font picker does exactly that — so the Google link is only given when the page really
does load from Google.</p>
<table>
<thead><tr><th>Family</th><th>Served from</th><th class="num">Uses</th></tr></thead>
<tbody>${t.typography.families.all.map((f) => {
    const src = f.source || { kind: 'system' };
    const where = src.kind === 'google'
      ? `<a href="https://fonts.google.com/specimen/${encodeURIComponent(src.googleName).replace(/%20/g, '+')}">Google Fonts</a>`
      : src.kind === 'webfont'
        ? `webfont &middot; <code>${esc(src.host || 'unknown host')}</code>`
        : 'system, or no <code>@font-face</code> on the page';
    return `<tr><td><strong>${esc(String(f.stack).split(',')[0].replace(/^["']|["']$/g, ''))}</strong><br>
      <span style="color:var(--faint);font-size:12px">${esc(f.stack)}</span></td>
      <td>${where}</td><td class="num">${f.uses}</td></tr>`;
  }).join('')}</tbody>
</table>

<h2>Type scale</h2>
<table>
<thead><tr><th>Step</th><th class="num">Size</th><th class="num">Uses</th></tr></thead>
<tbody>${t.typography.scale.map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${s.px}px</td><td class="num">${s.uses}</td></tr>`).join('')}</tbody>
</table>
<p style="color:var(--muted);font-size:14px">
Heading <code>${esc(t.typography.families.heading || '—')}</code> ·
body <code>${esc(t.typography.families.body || '—')}</code> ·
base ${t.typography.bodyPx}px · detected ratio ${t.typography.ratio ?? 'none consistent'}
</p>

<h2>Spacing</h2>
<p style="color:var(--muted);font-size:14px">Base unit <strong>${t.spacing.base}px</strong>, honoured by ${Math.round(t.spacing.adherence * 100)}% of values. Steps: ${t.spacing.steps.map((s) => `<code>${s}px</code>`).join(' ')}</p>

<h2>Shape</h2>
<table>
<thead><tr><th>Corner radii</th><th>Shadows</th></tr></thead>
<tbody><tr>
  <td>${t.radius.steps.length ? t.radius.steps.map((r) => `<code>${r.px}px</code>`).join(' ') : 'none used'}</td>
  <td>${t.shadow.steps.length ? t.shadow.steps.map((sh) => `<code>${esc(sh.name)}</code>`).join(' ') : 'none used'}</td>
</tr></tbody>
</table>

<h2>Exports</h2>
<p style="color:var(--muted);font-size:14px">Each of these is a real file in <code>data/</code>, ready to use:
<code>tokens.css</code>, <code>tokens.dtcg.json</code>, <code>tokens.tailwind.js</code>, <code>shopify-settings.json</code>.</p>
<h3>CSS custom properties</h3>
<pre class="code">${esc(t.formats.css)}</pre>
<h3>Shopify theme settings</h3>
<pre class="code">${esc(JSON.stringify(t.formats.shopify, null, 2))}</pre>`;
  return layout({ title: 'Design review', site: model.site, nav: navFor(model, 'tokens'), body, generatedAt: model.generatedAt });
}


/**
 * Every finding on one page, highest priority first.
 *
 * The axis, owner and surface pages are each a partial view, and the verdict
 * shows only the top twelve — so nothing in the bundle answered "show me
 * everything", which is the first thing a reader looks for.
 */
export function renderAllFindingsHTML(page, model) {
  const findings = page.findingIds.map((id) => model.findingIndex[id]).filter(Boolean);
  const problems = findings.filter((f) => f.kind !== 'strength');
  const strengths = findings.filter((f) => f.kind === 'strength');

  const body = `
<h1>All findings</h1>
<p class="lede">${esc(page.summary)}</p>
${pageHeader(findings)}
<div class="note">The number on each finding is its <strong>priority</strong> — impact multiplied by how easy the fix is, so something big and cheap outranks something big and slow. Every record here also appears on its axis, owner and surface page; this is the same pile, not a copy.</div>

<h2>Problems <span class="count">${problems.length}</span></h2>
<div data-section>
${problems.length ? problems.map(findingCard).join('\n') : '<p class="empty">Nothing found.</p>'}
</div>
${strengths.length ? `<h2>Working well <span class="count">${strengths.length}</span></h2>
<div data-section>${strengths.map(findingCard).join('\n')}</div>` : ''}`;

  return layout({ title: 'All findings', site: model.site, nav: navFor(model, 'findings'), body, generatedAt: model.generatedAt });
}

/**
 * The GEO page — can a machine find, read and act on this store?
 *
 * A query over the same pile, like every page here. What earns it its own
 * screen is that the answer was previously spread across the Engine axis page
 * (mixed in with performance), the marketing owner page and the surface pages,
 * and you had to know which entries counted as machine-readability to assemble
 * it. Grouped by the question each finding answers, because being allowed in,
 * being parseable, having the answer present and being able to act are four
 * different jobs.
 *
 * No score. Machine retrieval already scores through its Engine groups, and a
 * number here would be the fourth axis the concept forbids.
 */
export function renderGeoHTML(page, model) {
  const findings = page.findingIds.map((id) => model.findingIndex[id]).filter(Boolean);
  const problems = findings.filter((f) => f.kind !== 'strength');

  const groupRows = Object.entries(page.byGeoGroup).map(([g, ids]) => {
    const list = ids.map((id) => model.findingIndex[id]).filter(Boolean);
    return { key: g, label: GEO_GROUP_LABELS[g], list, bands: bandsOf(list),
      total: list.filter((f) => f.kind !== 'strength').length };
  }).filter((r) => r.list.length);

  // The buy path, taken from the evidence of whichever operability finding
  // recorded it. Derived from the pile — not a second measurement.
  const path = findings
    .map((f) => f.evidence?.fullPath)
    .find((p) => Array.isArray(p) && p.length);

  const geoGroups = Object.entries(model.consistency.byGroup || {})
    .filter(([name]) => ['Structured data', 'Retrieval', 'Machine parity'].includes(name))
    .map(([name, g]) => ({ name, score: g.score, measured: g.measured, declared: g.declared }));

  const sections = groupRows.map((r) => `<div data-section>
  <h2>${esc(r.label)} <span class="count">${r.list.length}</span></h2>
  <p class="lede small">${esc(GEO_GROUP_BRIEF[r.key])}</p>
  ${r.list.map(findingCard).join('\n')}
</div>`).join('\n');

  const body = `
<h1>Machine readability</h1>
<p class="lede">${esc(page.summary)}</p>
${pageHeader(findings)}

${geoGroups.length ? `${scoreBars(geoGroups, { title: 'What this contributes to the Engine score' })}
<div class="note">These bars measure <strong>consistency, not quality</strong> — whether pages of the same type agree with each other. A site with no structured data anywhere is perfectly consistent about it, and scores 100 here while every finding below still stands. The score says how far this is from a coherent system; the findings say what is wrong with it. Read them together.</div>` : ''}
${stackedBandBars(groupRows, { title: 'Where the work sits', minRows: 1 })}

${path ? `<h2>The buy path</h2>
<p class="lede small">An agent does not get part-way into a cart — it stops at the first control it cannot see. This is where that happens, not a percentage.</p>
${stepLadder(path.map((s) => ({ step: s.step, state: s.state, detail: s.detail })))}
<div class="note">Whether this storefront <em>should</em> be operable by agents is a commercial decision. This reports where the path stops, not whether it ought to.</div>` : ''}

<div class="note"><strong>What this does not say.</strong> Retrievable is not cited. Nothing here predicts traffic, rankings or whether an answer engine will quote this store — only what a machine can and cannot read. Crawler behaviour also moves, and there is no standards body for answer-engine retrieval, so apart from <code>lang</code> (WCAG 3.1.1) none of these findings is prescriptive.</div>

${sections || '<p class="empty">Nothing found.</p>'}
${problems.length ? '' : '<p class="empty">No machine-readability problems found.</p>'}`;

  return layout({ title: 'Machine readability', site: model.site, nav: navFor(model, 'geo'), body, generatedAt: model.generatedAt });
}

/** An owner page: the same findings, filtered to one team's work. */
export function renderOwnerHTML(page, model) {
  const findings = page.findingIds.map((id) => model.findingIndex[id]).filter(Boolean);
  const problems = findings.filter((f) => f.kind !== 'strength');
  const strengths = findings.filter((f) => f.kind === 'strength');
  const bands = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of problems) bands[priorityBand(f.priority)]++;

  // Where this team's work sits across the three axes — the question an owner
  // page raises and could not previously answer without counting cards.
  const axisRows = model.axes.map((a) => {
    const mine = problems.filter((f) => f.axis === a);
    return { label: AXIS_LABELS[a], bands: bandsOf(mine), total: mine.length };
  });

  const body = `
<h1>${esc(OWNER_LABELS[page.owner])}</h1>
<p class="owner-lede">${esc(OWNER_BRIEF[page.owner])}</p>
${pageHeader(findings)}
${stackedBandBars(axisRows, { title: 'Spread across the axes' })}
<div class="note">The same findings appear on their axis and surface pages. This is one record reached by a different question &mdash; not a second copy, and nothing here is scored separately.</div>

<h2>Findings</h2>
<div data-section>
${problems.length ? problems.map(findingCard).join('\n') : '<p class="empty">Nothing in this area.</p>'}
</div>
${strengths.length ? `<h2>Working well</h2><div data-section>${strengths.map(findingCard).join('\n')}</div>` : ''}`;

  return layout({ title: OWNER_LABELS[page.owner], site: model.site, nav: navFor(model, page.slug), body, generatedAt: model.generatedAt });
}
