/**
 * "START HERE" — the one file at the top of the bundle.
 *
 * Someone unzips a folder and has to know, without being told, what to open.
 * A directory of `site/`, `pages/`, `data/` and `findings/` does not answer
 * that; a single file named START HERE does.
 *
 * It is deliberately SELF-CONTAINED — its own styles, its own charts, no
 * reference to anything in `report/`. If the folder is moved, re-zipped, or
 * partially copied, this page still opens and still says what the audit found.
 * Everything below it is one click away but nothing here depends on it.
 *
 * @module core/wiki/render-start
 */

import {
  AXIS_LABELS, OWNERS, OWNER_BRIEF, OWNER_LABELS, SURFACE_LABELS, priorityBand,
} from '../finding.js';
import { GRADE_COPY } from '../consistency.js';
import {
  BAND_COLOR, CHART_CSS, CHART_JS, impactEffortScatter, ownerBars, scoreBars, severityBar,
} from './charts.js';
import { WIKI_CSS } from './render-html.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * @param {import('./model.js').WikiModel} model
 * @param {{slug:string, surface:string}[]} [structurePages]
 *   Structure pages are built by the bundler, not by `buildWikiModel`, so they
 *   are NOT in `model.pages`. The old menu tested `model.pages.some(p =>
 *   p.slug.startsWith('structure-'))`, which is never true — so the entry
 *   point of the bundle has never linked to the structure pages at all, while
 *   the report's own nav has. Passing them in is the fix; inferring them here
 *   would just be the same guess in a new place.
 */
export function renderStartHere(model, structurePages = []) {
  const c = model.consistency;
  const problems = model.findings.filter((f) => f.kind !== 'strength');
  const strengths = model.findings.filter((f) => f.kind === 'strength');

  const ownerRows = OWNERS.map((o) => {
    const mine = problems.filter((f) => f.owner === o);
    const bands = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of mine) bands[priorityBand(f.priority)]++;
    return { owner: o, label: OWNER_LABELS[o], bands, total: mine.length };
  });

  const hasOwnerPage = (o) => model.pages.some((p) => p.slug === `for-${o}`);

  const geo = model.pages.find((p) => p.kind === 'geo');
  const structure = structurePages[0] || null;

  /**
   * Every page in the bundle, as a menu.
   *
   * START HERE had four hand-picked "routes" and no way to reach an axis page,
   * a surface page or the GEO page at all — so the landing screen of a wiki was
   * the one screen you could not navigate from. Built from `model.pages` rather
   * than listed by hand, so a page added later cannot go missing again.
   */
  const pagesOfKind = (kind) => model.pages.filter((p) => p.kind === kind);
  const countFor = (p) => p.findingIds.filter((id) => {
    const f = model.findingIndex[id];
    return f && f.kind !== 'strength';
  }).length;

  const menuGroups = [
    {
      heading: 'By kind of problem',
      links: pagesOfKind('axis').map((p) => ({
        slug: p.slug, label: AXIS_LABELS[p.axis] || p.title, count: countFor(p),
      })),
    },
    {
      heading: 'By who fixes it',
      links: pagesOfKind('owner').map((p) => ({
        slug: p.slug, label: OWNER_LABELS[p.owner] || p.title, count: countFor(p),
      })),
    },
    {
      heading: 'By page type',
      links: pagesOfKind('surface').map((p) => ({
        slug: p.slug, label: SURFACE_LABELS[p.surface] || p.title, count: countFor(p),
      })),
    },
    {
      heading: 'Reference',
      links: [
        { slug: 'index', label: 'Full report' },
        ...(geo ? [{ slug: 'geo', label: 'Machine readability', count: countFor(geo) }] : []),
        ...pagesOfKind('tokens').map((p) => ({ slug: p.slug, label: 'Design system seed' })),
        ...structurePages.map((p) => ({ slug: p.slug, label: `Structure: ${p.surface.toUpperCase()}` })),
      ],
    },
  ].filter((g) => g.links.length);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Start here — ${esc(model.site)}</title>
<style>
${WIKI_CSS}
${CHART_CSS}
.hero { padding: 40px 0 8px; }
.hero h1 { font-size: 34px; margin: 0 0 4px; }
.hero .sub { color: var(--muted); font-size: 16px; margin: 0 0 28px; }
.headline { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin-bottom: 6px; }
.headline .num { font-size: 76px; font-weight: 300; letter-spacing: -.045em; line-height: .9; }
.headline .of { color: var(--faint); font-size: 22px; }
.headline .grade { font-size: 13px; text-transform: uppercase; letter-spacing: .09em; font-weight: 660;
  padding: 5px 11px; background: var(--ink); color: var(--bg); }
.verdict-line { color: var(--muted); font-size: 17px; line-height: 1.55; margin: 14px 0 0; max-width: 62ch; }
.counts { display: flex; gap: 34px; flex-wrap: wrap; margin: 30px 0 4px;
  padding-top: 22px; border-top: 1px solid var(--border-strong); }
.counts div .n { font-size: 30px; font-weight: 350; letter-spacing: -.02em; }
.counts div .l { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); font-weight: 650; }
.counts .crit .n { color: ${BAND_COLOR.critical}; }
.routes { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; margin: 14px 0 0; }
.route { display: block; padding: 16px 18px; border: 1px solid var(--border); text-decoration: none; }
.route:hover { border-color: var(--ink); text-decoration: none; }
.route b { display: block; font-size: 15px; color: var(--ink); margin-bottom: 4px; }
.route span { display: block; font-size: 12.5px; color: var(--muted); line-height: 1.5; }
.route .cnt { font-family: var(--mono); font-size: 11px; color: var(--faint); margin-top: 7px; }
.top { margin: 6px 0 0; }
.top li { margin-bottom: 9px; color: var(--muted); font-size: 14px; }
.top li b { color: var(--ink); font-weight: 600; }
.files { font-size: 13px; color: var(--muted); }
.files code { font-family: var(--mono); font-size: 12px; color: var(--ink); }

/* The menu. START HERE is self-contained, so this is a real list of links
   rather than the report's own nav bar — the report's nav lives in a stylesheet
   under report/, and depending on it would break the day someone copies this
   file out on its own. */
.menu { margin-top: 4px; }
.menu-group { margin-bottom: 20px; }
.menu-group > .h {
  font-size: 11px; text-transform: uppercase; letter-spacing: .08em;
  color: var(--faint); font-weight: 650; margin-bottom: 9px;
}
.menu-links { display: flex; flex-wrap: wrap; gap: 6px 8px; }
.menu-links a {
  display: inline-flex; align-items: baseline; gap: 7px;
  padding: 7px 12px; background: var(--raised); color: var(--ink);
  font-size: 13.5px; text-decoration: none;
}
.menu-links a:hover { background: var(--ink); color: var(--bg); text-decoration: none; }
.menu-links a .n { font-family: var(--mono); font-size: 11px; opacity: .6; }

/* A menu at the foot of a long page is a menu you have to find. This is the
   one the reader lands on. */
.topbar { position: sticky; top: 0; z-index: 10; background: var(--bg);
  border-bottom: 1px solid var(--border); margin: 0 -24px 0; padding: 0 24px; }
.topbar .inner { display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  max-width: 980px; margin: 0 auto; padding: 9px 0; }
.topbar .mark { font-size: 12.5px; font-weight: 650; letter-spacing: -.01em; }
.topbar .mark span { color: var(--faint); font-weight: 400; }
.topbar nav { display: flex; gap: 2px; flex-wrap: wrap; margin-left: auto; }
.topbar nav a { font-size: 12.5px; color: var(--muted); text-decoration: none; padding: 4px 8px; }
.topbar nav a:hover { background: var(--raised); color: var(--ink); text-decoration: none; }
@media (max-width: 700px) {
  .topbar nav { width: 100%; margin-left: 0; }
}
</style>
</head>
<body>
<div class="topbar"><div class="inner">
  <div class="mark">EchoFlow <span>/ ${esc(model.site)}</span></div>
  <nav>
    <a href="report/site/index.html">Full report</a>
    ${model.pages.filter((p) => p.kind === 'axis').map((p) =>
      `<a href="report/site/${esc(p.slug)}.html">${esc(AXIS_LABELS[p.axis] || p.title)}</a>`).join('')}
    ${geo ? '<a href="report/site/geo.html">Machine readability</a>' : ''}
    <a href="#all-pages">All pages &darr;</a>
  </nav>
</div></div>
<div class="wrap">

<div class="hero">
  <h1>${esc(model.site)}</h1>
  <p class="sub">Consistency audit · ${esc(new Date(model.generatedAt).toISOString().slice(0, 10))} · ${model.scope === 'site' ? 'whole site' : 'single page'}${model.platform ? ` · ${esc(model.platform === 'shopify' ? 'Shopify' : model.platform.replace(/-/g, ' '))}` : ''}</p>

  <div class="headline">
    <span class="num">${c.overall ?? '—'}</span><span class="of">/100</span>
    <span class="grade">${esc(c.grade)}</span>
    ${c.provisional ? '<span class="grade" style="background:var(--high)">provisional</span>' : ''}
  </div>
  <p class="verdict-line">${esc(GRADE_COPY[c.grade])}</p>
  ${c.caveat ? `<div class="note" style="margin-top:18px">${esc(c.caveat)}</div>` : ''}

  <div class="counts">
    <div><div class="n">${problems.length}</div><div class="l">findings</div></div>
    <div class="crit"><div class="n">${model.stats.bands.critical}</div><div class="l">critical</div></div>
    <div><div class="n">${model.stats.bands.high}</div><div class="l">high</div></div>
    ${strengths.length ? `<div><div class="n">${strengths.length}</div><div class="l">working well</div></div>` : ''}
    ${model.axes.map((a) => `<div><div class="n">${c.byAxis[a] ?? '—'}</div><div class="l">${esc(AXIS_LABELS[a])}</div></div>`).join('')}
  </div>
</div>

<h2>Where the score comes from</h2>
${scoreBars(Object.entries(c.byGroup || {})
  .filter(([, g]) => model.axes.includes(g.axis))
  .sort((a, b) => (a[1].score ?? 999) - (b[1].score ?? 999))
  .map(([name, g]) => ({ name, score: g.score, measured: g.measured, declared: g.declared })),
  { title: 'Consistency by group' })}

${severityBar(model.stats.bands)}

<h2>Who picks this up</h2>
${ownerBars(ownerRows)}
<div class="routes">
  ${ownerRows.filter((r) => r.total && hasOwnerPage(r.owner)).map((r) => `<a class="route" href="report/site/for-${r.owner}.html">
    <b>${esc(r.label)}</b>
    <span>${esc(OWNER_BRIEF[r.owner])}</span>
    <span class="cnt">${r.total} finding${r.total === 1 ? '' : 's'}${r.bands.critical ? ` · ${r.bands.critical} critical` : ''}</span>
  </a>`).join('')}
</div>

<h2>What to fix first</h2>
${impactEffortScatter(problems.map((f) => ({
  title: f.title, impact: f.impact, effort: f.effort, priority: f.priority,
  band: priorityBand(f.priority), owner: OWNER_LABELS[f.owner] || f.owner,
})))}
<ol class="top">
${problems.slice(0, 6).map((f) => `<li><b>${esc(f.title)}</b><br>${esc(f.recommendation.slice(0, 180))}${f.recommendation.length > 180 ? '…' : ''}</li>`).join('')}
</ol>

<h2>Open the full report</h2>
<div class="routes">
  <a class="route" href="report/site/index.html">
    <b>Full report</b>
    <span>Every finding with its evidence, by axis and by page. Has a Full/Client density toggle.</span>
  </a>
  ${geo ? `<a class="route" href="report/site/geo.html">
    <b>Machine readability</b>
    <span>What an answer engine, a crawler or a shopping agent can read — crawler access, structured data, answerability, and how far an agent gets along the buy path.</span>
    <span class="cnt">${geo.findingIds.length} finding${geo.findingIds.length === 1 ? '' : 's'}</span>
  </a>` : ''}
  ${model.pages.some((p) => p.kind === 'tokens') ? `<a class="route" href="report/site/tokens.html">
    <b>Design system seed</b>
    <span>The palette, type scale and spacing the site is implicitly running — exported as CSS, Figma tokens, Tailwind and Shopify settings.</span>
  </a>` : ''}
  ${structure ? `<a class="route" href="report/site/${esc(structure.slug)}.html">
    <b>Page structure</b>
    <span>The page as boxes — how many sections a rebuild would have to reproduce.</span>
  </a>` : ''}
</div>

<h2 id="all-pages">Every page in this report</h2>
<div class="menu">
  ${menuGroups.map((g) => `<div class="menu-group">
    <div class="h">${esc(g.heading)}</div>
    <div class="menu-links">
      ${g.links.map((l) => `<a href="report/site/${esc(l.slug)}.html">${esc(l.label)}${l.count != null ? `<span class="n">${l.count}</span>` : ''}</a>`).join('')}
    </div>
  </div>`).join('')}
</div>

<h2>If you are reading this as a machine</h2>
<p class="files">
Everything is under <code>report/</code>. <code>report/data/analysis.json</code> is the single source —
every other file is rendered from it. <code>report/CLAUDE.md</code> states where the truth is, what the
numbers mean and what <em>not</em> to conclude from them. One finding per file under
<code>report/findings/</code>, with YAML front-matter and stable names.
</p>

<footer class="site">
  Generated by EchoFlow ${esc(model.generatedAt)} ·
  ${model.notAssessed?.length ? `${model.notAssessed.length} areas explicitly not assessed — see the full report.` : ''}
</footer>
</div>
<script>${CHART_JS}</script>
</body>
</html>`;
}
