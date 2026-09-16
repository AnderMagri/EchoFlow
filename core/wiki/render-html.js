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

import { AXIS_LABELS, SURFACE_LABELS, effortLabel, priorityBand } from '../finding.js';
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
`;

export const WIKI_JS = `
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
    .map((p) => [p.slug, p.kind === 'axis' ? AXIS_LABELS[p.axis] : p.title])];
  return items.map(([slug, label]) =>
    `<a href="${slug}.html"${slug === current ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('');
}

function findingCard(f) {
  const band = priorityBand(f.priority);
  return `<article class="finding ${band}" data-priority="${f.priority}" id="${esc(f.id)}">
  <div class="pri">${f.priority}<small>${esc(band)}</small></div>
  <div>
    <div class="top">
      <span class="title">${esc(f.title)}</span>
      ${f.kind === 'meta' ? '<span class="tag meta">cross-axis</span>' : ''}
      <span class="tag axis">${esc(AXIS_LABELS[f.axis])}</span>
    </div>
    <p class="rec">${esc(f.recommendation)}</p>
    <div class="meta-line">
      Impact ${f.impact}/10 · effort to fix: ${esc(effortLabel(f.effort))} ·
      ${esc(SURFACE_LABELS[f.surface] || f.surface)} · ${esc(f.scope)} check
    </div>
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
  <div class="bd">
    ${Object.entries(model.consistency.byGroup || {})
      .filter(([, g]) => model.axes.includes(g.axis))
      .sort((a, b) => (a[1].score ?? 999) - (b[1].score ?? 999))
      .map(([name, g]) => `<div class="bd-row ${g.score == null ? 'dim' : ''}">
        <span class="k">${esc(name)}</span>
        <span class="track"><i style="width:${g.score ?? 0}%"></i></span>
        <span class="v">${g.score ?? '—'}</span>
      </div>`).join('')}
  </div>
  <div class="axes">
    ${model.axes.map((a) => `<div class="axis-card">
      <div class="label">${esc(AXIS_LABELS[a])}</div>
      <div class="val">${c.byAxis[a] ?? '—'}</div>
      <div class="read">${esc(reading(c.byAxis[a]))}</div>
    </div>`).join('')}
  </div>
</div>

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
${model.skipped.length ? `<div class="note"><strong>${model.skipped.length} dimension${model.skipped.length === 1 ? '' : 's'} not measured</strong> — excluded from the score rather than counted as passing. ${esc(model.skipped.map((s) => `${s.key} (${s.reason})`).join('; '))}.</div>` : ''}
`;
  return layout({ title: 'Verdict', site: model.site, nav: navFor(model, 'index'), body, generatedAt: model.generatedAt });
}

const reading = (s) => (s == null ? 'not measured'
  : s >= 85 ? 'held' : s >= 70 ? 'mostly held' : s >= 50 ? 'drifting' : 'decided per page');

export function renderAxisHTML(page, model) {
  const findings = page.findingIds.map((id) => model.findingIndex[id]).filter(Boolean);
  const body = `
<h1>${esc(page.title)}</h1>
<p class="lede">${esc(page.summary)}</p>

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

  const body = `
<h1>${esc(page.title)}</h1>
<p class="lede">${esc(page.summary)}</p>
<div class="note">All three axes on one screen. Each finding also lives on its axis page — same record, reached two ways.</div>
${sections || '<p class="empty">Nothing found on this surface.</p>'}`;
  return layout({ title: page.title, site: model.site, nav: navFor(model, page.slug), body, generatedAt: model.generatedAt });
}

export function renderTokensHTML(model) {
  const t = model.tokens;
  const body = `
<h1>Design system seed</h1>
<p class="lede">The system this site is implicitly running — extracted as something you can build with.</p>
<div class="note">This is a <strong>starting point, not a finished system</strong>. It reflects what the site does today, mistakes included. Review it before shipping.</div>

<h2>Colour</h2>
<div class="swatches">
${t.color.primary ? `<div class="sw"><i style="background:${esc(t.color.primary)}"></i>${esc(t.color.primary)}<br><span style="color:var(--faint)">primary</span></div>` : ''}
${t.color.accents.map((c) => `<div class="sw"><i style="background:${esc(c)}"></i>${esc(c)}</div>`).join('')}
</div>
<div class="swatches">
${t.color.neutral.map((n) => `<div class="sw"><i style="background:${esc(n.hex)}"></i>${esc(n.hex)}<br><span style="color:var(--faint)">${esc(n.name)}</span></div>`).join('')}
</div>
${t.color.contrastWarnings.length ? `<div class="note"><strong>Contrast warnings</strong><ul style="margin:6px 0 0;padding-left:18px">
${t.color.contrastWarnings.map((w) => `<li><code>${esc(w.pair)}</code> is ${w.ratio}:1, needs ${w.required}:1. ${esc(w.note)}</li>`).join('')}
</ul></div>` : ''}

<h2>Typography</h2>
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

<h2>Exports</h2>
<p style="color:var(--muted);font-size:14px">Each of these is a real file in <code>data/</code>, ready to use:
<code>tokens.css</code>, <code>tokens.dtcg.json</code>, <code>tokens.tailwind.js</code>, <code>shopify-settings.json</code>.</p>
<h3>CSS custom properties</h3>
<pre class="code">${esc(t.formats.css)}</pre>
<h3>Shopify theme settings</h3>
<pre class="code">${esc(JSON.stringify(t.formats.shopify, null, 2))}</pre>`;
  return layout({ title: 'Design system seed', site: model.site, nav: navFor(model, 'tokens'), body, generatedAt: model.generatedAt });
}
