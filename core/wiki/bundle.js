/**
 * The wiki bundle.
 *
 * One analysis produces one folder that serves three readers without keeping
 * three copies of the truth:
 *
 *   site/    static HTML — unzip, open, or host anywhere. The client's copy.
 *   pages/   markdown with YAML front-matter — what an agent reads.
 *   findings/ one markdown file per finding, stable filename — the atomic unit.
 *   data/    JSON — the machine truth everything else is rendered from.
 *   CLAUDE.md  the contract: how a coding agent should navigate this folder.
 *
 * Nothing here is authored twice. data/analysis.json is the source; every other
 * file is a projection of it. A number that appears in prose also appears in
 * front-matter or JSON, so it can be queried instead of parsed out of a sentence.
 *
 * @module core/wiki/bundle
 */

import { atDensity, buildWikiModel } from './model.js';
import {
  renderAxisPage, renderFinding, renderIndex, renderOwnerPage, renderSurfacePage,
  renderTokensPage,
} from './render-md.js';
import {
  WIKI_CSS, WIKI_JS, renderAxisHTML, renderIndexHTML, renderOwnerHTML,
  renderSurfaceHTML, renderTokensHTML,
} from './render-html.js';
import { AXIS_LABELS, OWNER_LABELS } from '../finding.js';
import { renderStartHere } from './render-start.js';
import { STRUCTURE_CSS, STRUCTURE_JS, renderStructureHTML } from './render-structure.js';
import { sectionSkeleton } from '../observation.js';

/**
 * Build the whole bundle as a path -> contents map. Writing it to disk is the
 * caller's problem, which is what lets the same function serve the Node CLI and
 * the browser extension (which zips it client-side).
 *
 * @param {import('../analyze.js').AnalysisResult} analysis
 * @returns {Record<string,string>}
 */
export function buildBundle(analysis) {
  const model = buildWikiModel(analysis);
  /** @type {Record<string,string>} */
  const raw = {};
  // Built at the flat paths the renderers already know about, then moved under
  // report/ in one place at the end. Keeping the move here means no renderer
  // has to know where the bundle root is.
  const files = raw;

  // --- data/ : the truth ---------------------------------------------------
  // Layout trees are large and structural rather than analytical, so they live
  // in their own files and analysis.json stays something a person can open.
  const { observations, ...analysisCore } = analysis;
  files['data/analysis.json'] = json(analysisCore);
  files['data/findings.json'] = json(model.findings);
  files['data/consistency.json'] = json(model.consistency);

  if (analysis.tokens) {
    const t = analysis.tokens;
    files['data/tokens.json'] = json({ color: t.color, typography: t.typography, spacing: t.spacing, radius: t.radius, shadow: t.shadow });
    files['data/tokens.css'] = t.formats.css;
    files['data/tokens.dtcg.json'] = json(t.formats.dtcg);
    files['data/tokens.tailwind.js'] = t.formats.tailwind;
    files['data/shopify-settings.json'] = json(t.formats.shopify);
  }

  // --- findings/ : one file each, stable name ------------------------------
  for (const f of model.findings) {
    files[`findings/${f.id}.md`] = renderFinding(f);
  }

  // --- pages/ : markdown projections ---------------------------------------
  files['pages/index.md'] = renderIndex(model);
  for (const page of model.pages) {
    if (page.kind === 'axis') files[`pages/${page.slug}.md`] = renderAxisPage(page, model);
    else if (page.kind === 'owner') files[`pages/${page.slug}.md`] = renderOwnerPage(page, model);
    else if (page.kind === 'surface') files[`pages/${page.slug}.md`] = renderSurfacePage(page, model);
    else if (page.kind === 'tokens') files['pages/tokens.md'] = renderTokensPage(model);
  }

  // --- site/ : the hostable static wiki ------------------------------------
  files['site/assets/wiki.css'] = WIKI_CSS;
  files['site/assets/wiki.js'] = WIKI_JS;
  files['site/index.html'] = renderIndexHTML(model);
  for (const page of model.pages) {
    if (page.kind === 'axis') files[`site/${page.slug}.html`] = renderAxisHTML(page, model);
    else if (page.kind === 'owner') files[`site/${page.slug}.html`] = renderOwnerHTML(page, model);
    else if (page.kind === 'surface') files[`site/${page.slug}.html`] = renderSurfaceHTML(page, model);
    else if (page.kind === 'tokens') files['site/tokens.html'] = renderTokensHTML(model);
  }

  // --- structure/ : the page as boxes --------------------------------------
  const structurePages = [];
  for (const obs of observations || []) {
    if (!obs.layout) continue;
    const slug = `structure-${obs.surface}`;
    // One structure page per surface. A second PDP adds nothing a first does not.
    if (structurePages.some((p) => p.slug === slug)) continue;
    structurePages.push({ slug, surface: obs.surface, title: `Structure — ${obs.surface.toUpperCase()}`, obs });
  }

  if (structurePages.length) {
    files['site/assets/structure.css'] = STRUCTURE_CSS;
    files['site/assets/structure.js'] = STRUCTURE_JS;
    for (const sp of structurePages) {
      const nav = navWithStructure(model, structurePages, sp.slug);
      const html = renderStructureHTML({
        observation: sp.obs, site: model.site, nav, generatedAt: model.generatedAt,
      });
      if (html) files[`site/${sp.slug}.html`] = html;
      files[`data/layout-${sp.surface}.json`] = json({
        url: sp.obs.url,
        viewport: sp.obs.viewport,
        sections: sectionSkeleton(sp.obs.layout).map((n) => ({
          label: n.label, role: n.role || null, y: n.y, height: n.h,
          display: n.display, cols: n.cols,
        })),
        tree: sp.obs.layout,
      });
    }
    // Re-render the standard pages so their nav includes the structure tabs.
    for (const page of model.pages) {
      const nav = navWithStructure(model, structurePages, page.slug);
      if (page.kind === 'axis') files[`site/${page.slug}.html`] = withNav(renderAxisHTML(page, model), nav);
      else if (page.kind === 'owner') files[`site/${page.slug}.html`] = withNav(renderOwnerHTML(page, model), nav);
      else if (page.kind === 'surface') files[`site/${page.slug}.html`] = withNav(renderSurfaceHTML(page, model), nav);
      else if (page.kind === 'tokens') files['site/tokens.html'] = withNav(renderTokensHTML(model), nav);
    }
    files['site/index.html'] = withNav(renderIndexHTML(model), navWithStructure(model, structurePages, 'index'));
    files['pages/structure.md'] = renderStructureMD(structurePages, model);
  }

  // --- contracts and indexes -----------------------------------------------
  files['manifest.json'] = json(buildManifest(model, files));
  files['CLAUDE.md'] = renderAgentContract(model);
  files['README.md'] = renderReadme(model);

  // One file at the top of the folder, everything else beneath it. Someone who
  // unzips this should not have to guess which of site/, pages/, data/ and
  // findings/ is the one to open.
  const bundled = { 'START HERE.html': renderStartHere(model) };
  for (const [path, contents] of Object.entries(files)) {
    bundled[`report/${path}`] = contents;
  }
  return bundled;
}

const json = (o) => JSON.stringify(o, null, 2) + '\n';

/** Nav including the structure tabs. */
function navWithStructure(model, structurePages, current) {
  const items = [['index', 'Verdict'],
    ...model.pages.filter((p) => p.slug !== 'index')
      .map((p) => [p.slug, p.kind === 'axis' ? AXIS_LABELS[p.axis]
        : p.kind === 'owner' ? `For ${OWNER_LABELS[p.owner].toLowerCase()}` : p.title]),
    ...structurePages.map((p) => [p.slug, `Structure: ${p.surface.toUpperCase()}`])];
  return items.map(([slug, label]) =>
    `<a href="${slug}.html"${slug === current ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`).join('');
}

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Swap a rendered page's nav block for one that knows about structure pages. */
function withNav(html, nav) {
  return html.replace(/<nav class="tabs">[\s\S]*?<\/nav>/, `<nav class="tabs">${nav}</nav>`);
}

/** Markdown companion to the structure view, for the agent-readable half. */
function renderStructureMD(structurePages, model) {
  const blocks = structurePages.map((sp) => {
    const sections = sectionSkeleton(sp.obs.layout);
    return [
      `## ${sp.surface.toUpperCase()}`,
      '',
      `\`${sp.obs.url}\` · ${sp.obs.viewport.label} ${sp.obs.viewport.width}px · ${sections.length} likely sections`,
      '',
      sections.length ? [
        '| # | Box | Height | Layout | Role |',
        '|---|---|---|---|---|',
        ...sections.map((n, i) => `| ${i + 1} | \`${n.label}\` | ${Math.round(n.h)}px | ${n.display}${n.cols ? ` · ${n.cols} cols` : ''} | ${n.role || '—'} |`),
      ].join('\n') : '_No page-level sections detected._',
      '',
      `Full box tree: \`data/layout-${sp.surface}.json\``,
      '',
    ].join('\n');
  });

  return `---
type: structure
site: ${JSON.stringify(model.site)}
surfaces: [${structurePages.map((p) => p.surface).join(', ')}]
---

# Page structure

The page as boxes, captured from the live DOM rather than from a screenshot.
Each surface below lists the blocks that look like page-level sections — in a
Shopify rebuild, roughly what you would have to build as sections.

Interactive version: \`site/structure-<surface>.html\` (toggle outlines, fills,
labels, a 12-column overlay, and nesting depth).

${blocks.join('\n')}`;
}

/**
 * A machine index of the bundle. An agent reads this first and knows what is in
 * the folder without listing or guessing at filenames.
 */
function buildManifest(model, files) {
  return {
    generator: 'EchoFlow 2.0',
    schema: 'echoflow.wiki/1',
    site: model.site,
    generatedAt: model.generatedAt,
    scope: model.scope,
    axes: model.axes,
    consistency: {
      overall: model.consistency.overall,
      grade: model.consistency.grade,
      byAxis: model.consistency.byAxis,
      measured: model.consistency.measured,
      declared: model.consistency.declared,
      coverage: model.consistency.coverage,
      confidence: model.consistency.confidence,
      provisional: model.consistency.provisional,
      caveat: model.consistency.caveat,
      skipped: model.consistency.skipped,
    },
    counts: model.stats,
    byOwner: Object.fromEntries(['design', 'marketing', 'engineering'].map((o) => [o,
      model.findings.filter((f) => f.owner === o).length])),
    entrypoints: {
      start: '../START HERE.html',
      humans: 'site/index.html',
      agents: 'pages/index.md',
      data: 'data/analysis.json',
      contract: 'CLAUDE.md',
    },
    findings: model.findings.map((f) => ({
      id: f.id, file: `findings/${f.id}.md`, title: f.title,
      axis: f.axis, owner: f.owner, surface: f.surface, kind: f.kind,
      impact: f.impact, effort: f.effort, priority: f.priority,
    })),
    files: Object.keys(files).sort(),
  };
}

/**
 * The agent contract.
 *
 * Written for a coding agent opening this folder cold, with no memory of the
 * run that produced it. It states where the truth is, what the numbers mean,
 * and — most importantly — what NOT to infer, because a score with no stated
 * semantics gets misread confidently.
 */
function renderAgentContract(model) {
  const c = model.consistency;
  return `# Reading this folder

This is an **EchoFlow 2.0 consistency audit** of \`${model.site}\`, generated ${model.generatedAt}.
If you are an AI agent asked to work with this report, read this file first.

## Where the truth is

\`data/analysis.json\` is the single source. Every other file is rendered from it.
If prose and JSON ever disagree, the JSON is right.

| Path | What it is | Read it when |
|---|---|---|
| \`manifest.json\` | Index of the whole bundle + finding list with scores | You want to know what is here without listing files |
| \`data/analysis.json\` | The complete result | You need everything |
| \`data/findings.json\` | Flat array of findings | You want to filter, sort, or count |
| \`data/consistency.json\` | Scores + every dimension measured | You are reasoning about the score |
| \`data/tokens.*\` | Design system seed in 4 formats | You are rebuilding the front end |
| \`findings/<id>.md\` | One finding, self-contained, YAML front-matter | You want one finding without loading the report |
| \`pages/*.md\` | Human-readable report, front-matter on every file | You want the narrative |
| \`site/*.html\` | Static hostable wiki for the client | You are publishing, not reading |

## The data model

Everything is a **Finding**. There is one record type; the axis pages and the
surface pages are both queries over the same pile, linked rather than copied.

\`\`\`
id              stable across re-runs — safe to reference
checkId         which check produced it
kind            "finding" | "meta"  (meta = produced by cross-axis synthesis)
axis            "design" | "ux" | "engine"   — A TAG, not a hierarchy
surface         "site" | "home" | "plp" | "pdp" | "cart" | ...
impact          1-10, how much it weighs
effort          1-10, HOW EASY TO FIX (10 = trivial). Not "how much work".
priority        impact x effort. The only ranking. There is no second score.
evidence        the extracted data proving it
recommendation  what to do
scope           "extractive" (works on one page) | "comparative" (needs whole site)
\`\`\`

**\`effort\` is inverted from the usual sense.** 10 means trivial to fix, not
"a lot of effort". \`priority = impact x effort\` therefore ranks
high-impact-and-easy first. Do not re-derive a priority assuming the opposite.

Bands: \`critical\` >= 63, \`high\` >= 40, \`medium\` >= 20, \`low\` below that.
\`client_visible: true\` in front-matter means priority >= 40.

## What the score means

**${c.overall ?? '—'}/100 — ${c.grade}.** Confidence: **${c.confidence}** (${Math.round((c.coverage || 0) * 100)}% of intended measurement ran).

${c.caveat ? `> **This score is provisional.** ${c.caveat}\n` : ''}

The consistency score answers one question: *how far is this site from a clean,
coherent system?* It is not a quality score, a performance score, or an SEO
score. A beautiful slow site can score 95. An ugly fast site can score 30.

It is a weighted mean over ${c.measured} measured dimensions, each scored 0-100 by one
of three primitives:

- **vocabulary coherence** — how close the set of values used for one property
  is to a designed set. Penalises near-duplicates (values too close to be
  deliberate) and sprawl (more tokens than a system needs).
- **cross-page agreement** — for a role that should be invariant, what share of
  pages agree. Requires more than one page.
- **rhythm adherence** — what share of numeric values sit on the detected base
  unit. The base is detected, not assumed.

${c.skipped.length ? `**${c.skipped.length} dimension(s) were not measured** and are EXCLUDED from the
score rather than counted as passing: ${c.skipped.map((s) => `\`${s}\``).join(', ')}.
Do not treat an unmeasured dimension as a pass. Check \`data/consistency.json\`
for the reason each was skipped.` : 'All declared dimensions were measured in this run.'}

## What NOT to conclude

- **Do not read axis scores as a ranking of importance.** Axis is a tag. A site
  can have a perfect Design score and still be unusable.
- **Do not treat a missing finding as a clean bill of health.** ${model.scope === 'page'
    ? 'This was a SINGLE-PAGE run, so every comparative dimension was skipped. Consistency across the site was not measured at all.'
    : 'Only the crawled pages were measured.'}
- **Do not sum or average findings.** They are ranked, not additive.
- **Do not re-score.** If you need a different ranking, filter on impact and
  effort directly rather than inventing a second formula — one ranking model is
  a deliberate constraint of this tool.

## The token seed is a starting point

\`data/tokens.*\` is reverse-engineered from the live site. It reflects what the
site does **today, mistakes included**. It is a seed for a rebuild, not a
validated design system. Check \`color.contrastWarnings\` before using any pair
as text on background.

## Current state

| | |
|---|---|
| Consistency | ${c.overall ?? '—'}/100 (${c.grade}) |
${model.axes.map((a) => `| ${AXIS_LABELS[a]} | ${c.byAxis[a] ?? 'not measured'} |`).join('\n')}
| Findings | ${model.stats.total} (${model.stats.bands.critical} critical, ${model.stats.bands.high} high) |
| Cross-axis meta-findings | ${model.stats.meta} |
| Scope | ${model.scope === 'site' ? 'whole site' : 'single page'} |

## Top findings

${model.findings.slice(0, 8).map((f, i) =>
  `${i + 1}. \`${f.id}\` — ${f.title} _(${f.axis}, priority ${f.priority})_`).join('\n')}
`;
}

function renderReadme(model) {
  const c = model.consistency;
  return `# ${model.site} — EchoFlow consistency audit

**${c.overall ?? '—'}/100 · ${c.grade}** · generated ${model.generatedAt}

## Open the report

Open \`site/index.html\` in any browser. No server, no build step, no internet
connection required. To share it, host the \`site/\` folder anywhere static.

The report has two densities, toggled in the header:

- **Full** — every finding, raw evidence expanded, jargon allowed.
- **Client** — only findings above the severity bar, narrative framing.

Same document, same design. The toggle is a filter, not a second export.

## Read it as data

- \`pages/\` — the same report as markdown, with YAML front-matter.
- \`findings/\` — one file per finding, stable filename.
- \`data/\` — JSON, the source everything else is rendered from.
- \`CLAUDE.md\` — how an AI agent should navigate this folder.

## Rebuild from it

\`data/\` carries the extracted design system in four formats:

| File | Use |
|---|---|
| \`tokens.css\` | CSS custom properties |
| \`tokens.dtcg.json\` | W3C design tokens — Figma, Style Dictionary |
| \`tokens.tailwind.js\` | Tailwind theme config |
| \`shopify-settings.json\` | Paste into \`config/settings_data.json\` |
`;
}

export { buildWikiModel, atDensity };
