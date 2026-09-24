#!/usr/bin/env node
/**
 * EchoFlow MCP server.
 *
 * Exposes the audit as tools an agent can call directly, over stdio.
 *
 * The governing constraint is CONTEXT, not capability. A site analysis produces
 * ~80KB of JSON; handing that back whole would blow an agent's window and bury
 * the answer. So every tool returns a summary by default and offers a narrower
 * query to drill in — `analyze` gives the verdict and the top findings,
 * `findings` filters, `finding` returns exactly one in full. Nothing returns
 * the whole pile unless asked for it by name.
 *
 * Bundles are written to disk and referenced by path afterwards, so a follow-up
 * question costs a file read rather than a re-crawl.
 *
 * @module mcp/server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';

import { analyze } from '../core/analyze.js';
import { buildBundle } from '../core/wiki/bundle.js';
import { DIMENSIONS } from '../core/dimensions.js';
import {
  BASIS_LABELS, BASIS_NOTE, OWNER_BRIEF, OWNER_LABELS, priorityBand, effortLabel,
} from '../core/finding.js';
import { collectPages } from '../analyzer/src/collect/browser.js';
import { discoverPages } from '../core/discover.js';
import { collectSiteSignals } from '../analyzer/src/collect/retrieval.js';

const DEFAULT_OUT = process.env.ECHOFLOW_OUT || resolve(homedir(), '.echoflow', 'audits');

const server = new McpServer({ name: 'echoflow', version: '2.0.0' });

// --- helpers ---------------------------------------------------------------

/** Both a readable line and the structured object, per SDK guidance. */
const reply = (text, structured) => ({
  content: [{ type: 'text', text }],
  ...(structured ? { structuredContent: structured } : {}),
});

/** Errors should say what to do next, not just what failed. */
const fail = (message, suggestion) => ({
  content: [{ type: 'text', text: `${message}${suggestion ? `\n\nTry: ${suggestion}` : ''}` }],
  isError: true,
});

const summariseFinding = (f) => ({
  id: f.id,
  title: f.title,
  axis: f.axis,
  owner: f.owner,
  surface: f.surface,
  priority: f.priority,
  band: priorityBand(f.priority),
  basis: f.basis,
  kind: f.kind,
});

function verdictText(a) {
  const c = a.consistency;
  const lines = [
    `${a.site} — ${c.overall ?? '—'}/100 (${c.grade})${c.provisional ? ' [PROVISIONAL]' : ''}`,
    c.verdict,
    '',
    `Platform: ${a.platform}${a.isShopify ? '' : ' — not Shopify; Shopify-specific checks have nothing to read'}`,
    `Pages analysed: ${a.pages.length} · findings: ${a.findings.length}`
      + ` (${a.findings.filter((f) => f.priority >= 63 && f.kind !== 'strength').length} critical,`
      + ` ${a.findings.filter((f) => f.kind === 'strength').length} strengths)`,
    '',
    'By group:',
    ...Object.entries(c.byGroup)
      .filter(([, g]) => a.axes.includes(g.axis))
      .sort((x, y) => (x[1].score ?? 999) - (y[1].score ?? 999))
      .map(([name, g]) => `  ${String(g.score ?? '—').padStart(4)}  ${name}`),
  ];
  if (c.caveat) lines.push('', `CAVEAT: ${c.caveat}`);
  if (a.notAssessed?.length) lines.push('', `Not assessed: ${a.notAssessed.join('; ')}`);
  return lines.join('\n');
}

async function writeBundle(analysis, outDir) {
  const files = buildBundle(analysis);
  for (const [path, contents] of Object.entries(files)) {
    const full = resolve(outDir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, contents, 'utf8');
  }
  return outDir;
}

/**
 * Find the directory that actually holds `data/`.
 *
 * The bundle grew a `report/` level when START HERE moved to the top, and this
 * did not follow: it resolved `<dir>/data/analysis.json` against a path where
 * the file now lives at `<dir>/report/data/analysis.json`. Every read tool
 * therefore failed on a bundle `echoflow_analyze` had just written — analyse,
 * get a path, pass it straight back, ENOENT.
 *
 * Accept both, because a person handing over a path has no reason to know
 * which level the JSON sits at, and old bundles on disk still have the flat
 * shape.
 */
async function resolveBundle(bundlePath) {
  if (bundlePath.endsWith('.json')) return { json: bundlePath, base: dirname(dirname(bundlePath)) };
  for (const base of [resolve(bundlePath, 'report'), bundlePath]) {
    const json = resolve(base, 'data/analysis.json');
    try { await stat(json); return { json, base }; } catch { /* try the next shape */ }
  }
  // Nothing found — report against the layout we write today.
  return { json: resolve(bundlePath, 'report/data/analysis.json'), base: resolve(bundlePath, 'report') };
}

async function loadBundle(bundlePath) {
  const { json } = await resolveBundle(bundlePath);
  const raw = await readFile(json, 'utf8');
  return JSON.parse(raw);
}

// --- tools -----------------------------------------------------------------

server.registerTool('echoflow_analyze', {
  title: 'Analyse a storefront',
  description:
    'Render a site with headless Chromium and measure how far it is from a coherent design system. '
    + 'Returns the consistency verdict, the score broken down by group, and the top findings — not the full report, '
    + 'which is written to disk and can be queried with echoflow_findings. '
    + 'A site-scope run samples pages by template type so comparative checks have peers to compare; '
    + 'a page-scope run skips every comparative check and says so.',
  inputSchema: {
    url: z.string().url().describe('Storefront URL, e.g. https://shop.example.com'),
    scope: z.enum(['site', 'page']).default('site')
      .describe('site: discover and sample pages by type (needed for consistency). page: this URL only.'),
    axes: z.array(z.enum(['design', 'ux', 'engine'])).default(['design', 'ux', 'engine'])
      .describe('Which axes to run.'),
    viewports: z.array(z.enum(['desktop', 'mobile'])).default(['desktop'])
      .describe('Render at these viewports. Fold and thumb-reach checks need mobile.'),
    limit: z.number().int().min(1).max(30).default(10).describe('Max pages in a site run.'),
    outDir: z.string().optional().describe(`Where to write the bundle. Default: ${DEFAULT_OUT}/<host>`),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ url, scope, axes, viewports, limit, outDir }) => {
  let target;
  try { target = new URL(url); } catch { return fail(`Not a URL: ${url}`, 'pass a full URL including https://'); }

  const dest = outDir || resolve(DEFAULT_OUT, target.hostname.replace(/[^a-z0-9.-]/gi, '-'));
  const urls = scope === 'site'
    ? (await discoverPages({ origin: target.origin, limit })) || [url]
    : [url];

  const { observations, errors } = await collectPages({ urls: urls.length ? urls : [url], viewports });
  if (!observations.length) {
    return fail(
      `Nothing could be collected from ${url}.${errors.length ? ` First error: ${errors[0].error}` : ''}`,
      'check the site is reachable and not blocking headless browsers, or try scope="page" on a single known URL',
    );
  }

  const siteSignals = await collectSiteSignals(target.origin, () => {}, { probeUrls: urls });
  const analysis = analyze({ observations, axes, site: target.hostname, siteSignals });
  await writeBundle(analysis, dest);

  const top = analysis.findings.filter((f) => f.kind !== 'strength').slice(0, 10);
  const text = [
    verdictText(analysis),
    '',
    'By owner: ' + ['design', 'marketing', 'engineering']
      .map((o) => `${OWNER_LABELS[o]} ${analysis.findings.filter((f) => f.owner === o).length}`).join(' · '),
    '',
    'Top findings:',
    ...top.map((f, i) => `${i + 1}. [${f.priority}] ${f.title} (${OWNER_LABELS[f.owner]}, ${f.basis})`),
    '',
    `Bundle: ${dest}`,
    `  report  ${dest}/site/index.html`,
    `  data    ${dest}/data/analysis.json`,
    `Query it with echoflow_findings bundle="${dest}".`,
    errors.length ? `\n${errors.length} page(s) failed to load.` : '',
  ].join('\n');

  return reply(text, {
    site: analysis.site,
    platform: analysis.platform,
    isShopify: analysis.isShopify,
    score: analysis.consistency.overall,
    grade: analysis.consistency.grade,
    provisional: analysis.consistency.provisional,
    byAxis: analysis.consistency.byAxis,
    byGroup: Object.fromEntries(Object.entries(analysis.consistency.byGroup).map(([k, v]) => [k, v.score])),
    findingCount: analysis.findings.length,
    byOwner: Object.fromEntries(['design', 'marketing', 'engineering']
      .map((o) => [o, analysis.findings.filter((f) => f.owner === o).length])),
    topFindings: top.map(summariseFinding),
    notAssessed: analysis.notAssessed,
    bundlePath: dest,
  });
});

server.registerTool('echoflow_findings', {
  title: 'Query findings from an audit',
  description:
    'Filter the findings of a completed audit. Returns one line per finding, not full records — '
    + 'use echoflow_finding with an id for the evidence and recommendation. '
    + 'Filter by axis, surface, severity band, owner, or basis (prescriptive = a cited standard, '
    + 'practice = convention, directional = an effect seen elsewhere). '
    + 'Filter by owner to get one team\u2019s work: the axes say what kind of problem it is, owner says whose it is.',
  inputSchema: {
    bundle: z.string().describe('Bundle directory or path to data/analysis.json, as returned by echoflow_analyze.'),
    axis: z.enum(['design', 'ux', 'engine']).optional(),
    surface: z.string().optional().describe('site, home, plp, pdp, cart, checkout, search, account, content'),
    band: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    basis: z.enum(['prescriptive', 'practice', 'directional']).optional(),
    owner: z.enum(['design', 'marketing', 'engineering']).optional()
      .describe('Who owns the fix. marketing = copy, structured data, metadata, crawler access, persuasion patterns. engineering = rendering, apps, performance, markup correctness. design = layout, type, colour, components.'),
    kind: z.enum(['finding', 'meta', 'strength']).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ bundle, axis, surface, band, basis, owner, kind, limit }) => {
  let analysis;
  try { analysis = await loadBundle(bundle); } catch (e) {
    return fail(`Could not read a bundle at ${bundle}: ${e.message}`,
      'pass the directory echoflow_analyze reported, or run echoflow_analyze first');
  }

  let fs = analysis.findings;
  if (axis) fs = fs.filter((f) => f.axis === axis);
  if (surface) fs = fs.filter((f) => f.surface === surface);
  if (band) fs = fs.filter((f) => priorityBand(f.priority) === band);
  if (basis) fs = fs.filter((f) => f.basis === basis);
  if (owner) fs = fs.filter((f) => f.owner === owner);
  if (kind) fs = fs.filter((f) => f.kind === kind);

  const shown = fs.slice(0, limit);
  const text = shown.length
    ? [`${fs.length} matching finding${fs.length === 1 ? '' : 's'}${fs.length > limit ? `, showing ${limit}` : ''}:`, '',
      ...shown.map((f) => `[${String(f.priority).padStart(3)}] ${f.id}\n      ${f.title}\n      ${OWNER_LABELS[f.owner]} · ${f.axis} · ${f.surface} · ${BASIS_LABELS[f.basis]}`)].join('\n')
    : 'No findings match that filter.';

  return reply(text, { total: fs.length, shown: shown.length, findings: shown.map(summariseFinding) });
});

server.registerTool('echoflow_finding', {
  title: 'Read one finding in full',
  description: 'The complete record for a single finding: evidence, recommendation, what licenses the claim, and the criterion cited if it is a standard.',
  inputSchema: {
    bundle: z.string().describe('Bundle directory or data/analysis.json path.'),
    id: z.string().describe('Finding id, as listed by echoflow_findings.'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ bundle, id }) => {
  let analysis;
  try { analysis = await loadBundle(bundle); } catch (e) {
    return fail(`Could not read a bundle at ${bundle}: ${e.message}`, 'run echoflow_analyze first');
  }
  const f = analysis.findings.find((x) => x.id === id);
  if (!f) {
    const near = analysis.findings.filter((x) => x.checkId === id || x.id.startsWith(id)).slice(0, 5);
    return fail(`No finding with id "${id}".`,
      near.length ? `did you mean: ${near.map((x) => x.id).join(', ')}` : 'list ids with echoflow_findings');
  }

  const text = [
    f.title,
    '',
    `${f.axis} · ${f.surface} · priority ${f.priority} (${priorityBand(f.priority)}) · impact ${f.impact}/10 · ${effortLabel(f.effort)} fix`,
    `${BASIS_LABELS[f.basis]} — ${BASIS_NOTE[f.basis]}`,
    f.citation ? `Criterion: ${f.citation}` : '',
    '',
    'Recommendation:',
    f.recommendation,
    '',
    'Evidence:',
    JSON.stringify(f.evidence, null, 2),
  ].filter(Boolean).join('\n');

  return reply(text, f);
});

server.registerTool('echoflow_tokens', {
  title: 'Get the extracted design system',
  description:
    'The design tokens reverse-engineered from the site — palette, neutral ramp, type scale, spacing rhythm, radii. '
    + 'Available as css, dtcg (W3C design tokens), tailwind, shopify (theme settings), or json. '
    + 'This is what the site is implicitly running today, mistakes included: a seed for a rebuild, not a validated system.',
  inputSchema: {
    bundle: z.string(),
    format: z.enum(['json', 'css', 'dtcg', 'tailwind', 'shopify']).default('json'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ bundle, format }) => {
  let analysis;
  try { analysis = await loadBundle(bundle); } catch (e) {
    return fail(`Could not read a bundle at ${bundle}: ${e.message}`, 'run echoflow_analyze first');
  }
  const t = analysis.tokens;
  if (!t) return fail('This audit has no token seed.', 'the design axis must be included in the run');

  if (format === 'json') {
    return reply(JSON.stringify({ color: t.color, typography: t.typography, spacing: t.spacing }, null, 2),
      { color: t.color, typography: t.typography, spacing: t.spacing, radius: t.radius });
  }
  const body = format === 'css' ? t.formats.css
    : format === 'tailwind' ? t.formats.tailwind
      : JSON.stringify(t.formats[format], null, 2);
  const warn = t.color.contrastWarnings.length
    ? `\n\n/* ${t.color.contrastWarnings.length} contrast warning(s): ${t.color.contrastWarnings.map((w) => `${w.pair} ${w.ratio}:1`).join('; ')} */`
    : '';
  return reply(body + warn, { format, contrastWarnings: t.color.contrastWarnings });
});

server.registerTool('echoflow_structure', {
  title: 'Get a page section skeleton',
  description:
    'The page as boxes: the blocks that look like page-level sections, their heights and column counts. '
    + 'Answers "how many sections is this page" — the first question of any rebuild estimate — from the captured '
    + 'layout tree rather than from a screenshot.',
  inputSchema: {
    bundle: z.string(),
    surface: z.string().default('pdp').describe('home, plp, pdp, cart, …'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ bundle, surface }) => {
  const { base } = await resolveBundle(bundle);
  let layout;
  try {
    layout = JSON.parse(await readFile(resolve(base, `data/layout-${surface}.json`), 'utf8'));
  } catch {
    return fail(`No captured layout for surface "${surface}" in ${base}.`,
      'surfaces are only present if that page type was crawled — check the audit summary for which ones were');
  }
  const text = [
    `${layout.url} (${layout.viewport.label} ${layout.viewport.width}px)`,
    `${layout.sections.length} likely sections:`,
    ...layout.sections.map((s, i) => `${i + 1}. ${s.label} — ${s.height}px${s.cols ? `, ${s.cols} cols` : ''}${s.role ? `, ${s.role}` : ''}`),
  ].join('\n');
  return reply(text, { url: layout.url, viewport: layout.viewport, sections: layout.sections });
});

server.registerTool('echoflow_explain', {
  title: 'Explain what EchoFlow measures',
  description:
    'The measurement model: every dimension, which axis and group it belongs to, whether it needs the whole site, '
    + 'and the question it answers. Call this to understand what a score means before interpreting one.',
  inputSchema: {
    axis: z.enum(['design', 'ux', 'engine']).optional().describe('Limit to one axis.'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ axis }) => {
  const dims = axis ? DIMENSIONS.filter((d) => d.axis === axis) : DIMENSIONS;
  const text = [
    'EchoFlow measures ONE thing: how far a site is from a coherent design system.',
    'It is not a quality, performance or SEO score. A beautiful slow site can score 95.',
    '',
    'Three primitives, reused across all axes:',
    '  vocabulary coherence  — how close the values used for one property are to a designed set (extractive)',
    '  cross-page agreement  — for a role that should be invariant, what share of pages agree (comparative)',
    '  rhythm adherence      — what share of numeric values sit on the detected base unit (extractive)',
    '',
    'Comparative dimensions are SKIPPED, never guessed, when there is only one page,',
    'and are excluded from the score rather than counted as passing.',
    '',
    'Ranking: priority = impact x effort, where effort is INVERTED (10 = trivial to fix).',
    'There is no second score.',
    '',
    'Claims carry a basis:',
    ...Object.entries(BASIS_NOTE).map(([k, v]) => `  ${BASIS_LABELS[k]} — ${v}`),
    '',
    'Findings also carry an owner — who decides the fix, not who types it:',
    ...Object.entries(OWNER_BRIEF).map(([k, v]) => `  ${OWNER_LABELS[k]} — ${v}`),
    '',
    `Dimensions (${dims.length}):`,
    ...dims.map((d) => `  ${d.axis.padEnd(7)} ${d.group.padEnd(12)} ${d.key.padEnd(18)} ${d.scope.padEnd(12)} ${d.question}`),
  ].join('\n');

  return reply(text, {
    dimensions: dims.map((d) => ({ key: d.key, axis: d.axis, group: d.group, scope: d.scope, weight: d.weight, question: d.question })),
    bases: BASIS_NOTE,
  });
});

server.registerTool('echoflow_retrieval', {
  title: 'How readable is the site to machines',
  description:
    'The machine-retrieval picture: which AI crawlers robots.txt allows, what structured data each page type '
    + 'carries, and — the one a DOM-only tool cannot see — whether the content survives without JavaScript. '
    + 'Many crawlers that feed answer engines never execute scripts, so a page can look complete to a person '
    + 'and arrive hollow to a machine.',
  inputSchema: {
    bundle: z.string().describe('Bundle directory or data/analysis.json path.'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ bundle }) => {
  let analysis;
  try { analysis = await loadBundle(bundle); } catch (e) {
    return fail(`Could not read a bundle at ${bundle}: ${e.message}`, 'run echoflow_analyze first');
  }

  const robots = analysis.siteSignals?.robots;
  const findings = analysis.findings.filter((f) => f.axis === 'engine'
    && /^(engine-(ai-crawlers|no-robots|no-llms|content-requires-js|no-structured|missing-schema|incomplete-product|malformed|h1-structure|missing-description|thin-content|unmarked-faq|no-lang|schema-drift|metadata-drift))/.test(f.checkId));

  const crawlers = robots?.agents
    ? Object.entries(robots.agents).map(([agent, v]) => `  ${v.state === 'blocked' ? 'BLOCKED' : v.state === 'partial' ? 'partial' : 'allowed'}  ${agent} (${v.operator})`)
    : ['  robots.txt not read'];

  const text = [
    `${analysis.site} — machine retrieval`,
    '',
    'AI crawler access:',
    ...crawlers,
    '',
    `llms.txt: ${analysis.siteSignals?.llmsTxt?.present ? 'present' : 'absent (emerging convention — absence is not a defect)'}`,
    '',
    `Structured data consistency: ${analysis.consistency.byGroup?.['Structured data']?.score ?? 'not measured'}`,
    `Metadata consistency: ${analysis.consistency.byGroup?.Retrieval?.score ?? 'not measured'}`,
    '',
    findings.length ? `${findings.length} retrieval finding(s):` : 'No retrieval findings.',
    ...findings.map((f) => `  [${f.priority}] ${f.title}\n        ${f.id}`),
    '',
    'Caveat: which crawlers execute JavaScript and honour which directives changes every few months. '
      + 'Nothing here is a standard — treat it as current practice.',
  ].join('\n');

  return reply(text, {
    site: analysis.site,
    crawlers: robots?.agents || null,
    llmsTxt: analysis.siteSignals?.llmsTxt || null,
    structuredDataScore: analysis.consistency.byGroup?.['Structured data']?.score ?? null,
    metadataScore: analysis.consistency.byGroup?.Retrieval?.score ?? null,
    findings: findings.map(summariseFinding),
  });
});

// --- start -----------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
