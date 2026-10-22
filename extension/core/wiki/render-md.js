/**
 * Markdown rendering — the agent-readable half of the wiki.
 *
 * Design rules, all of them in service of a second reader who is not a person:
 *   - Every file carries YAML front-matter, so metadata is readable without
 *     parsing prose.
 *   - Every finding is its OWN file under a stable id. An agent can read one
 *     finding without loading the report, and grep across findings without
 *     splitting a document.
 *   - Prose never carries a fact that is not also in front-matter or data/.
 *     If a number matters, it is queryable.
 *   - Filenames are deterministic. The same site re-analysed overwrites in
 *     place, so a diff between two runs is a real diff.
 *
 * @module core/wiki/render-md
 */

import {
  AXIS_LABELS, BASIS_LABELS, BASIS_NOTE, GEO_GROUP_BRIEF, GEO_GROUP_LABELS,
  OWNER_BRIEF, OWNER_LABELS, SURFACE_LABELS, effortLabel, priorityBand,
} from '../finding.js';
import { GRADE_COPY } from '../consistency.js';

const yamlValue = (v) => {
  if (v == null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map((x) => yamlValue(x)).join(', ')}]`;
  const s = String(v);
  return /[:#\-{}[\],&*?|<>=!%@`"\n]/.test(s) || s !== s.trim() ? JSON.stringify(s) : s;
};

function frontMatter(obj) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    lines.push(`${k}: ${yamlValue(v)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

/** Fenced JSON block — evidence stays machine-parsable inside a human document. */
const jsonBlock = (obj) => '```json\n' + JSON.stringify(obj, null, 2) + '\n```';

// ---------------------------------------------------------------------------

/** One file per finding. The atomic unit. */
export function renderFinding(f) {
  const band = priorityBand(f.priority);
  return frontMatter({
    id: f.id,
    check: f.checkId,
    kind: f.kind,
    axis: f.axis,
    surface: f.surface,
    scope: f.scope,
    basis: f.basis,
    owner: f.owner,
    citation: f.citation || undefined,
    impact: f.impact,
    effort: f.effort,
    effort_label: effortLabel(f.effort),
    priority: f.priority,
    band,
    client_visible: f.priority >= 40,
    url: f.url,
    derived_from: f.derivedFrom.length ? f.derivedFrom : undefined,
  }) + [
    `# ${f.title}`,
    '',
    `**${AXIS_LABELS[f.axis]}** · ${SURFACE_LABELS[f.surface] || f.surface} · priority **${f.priority}** (${band}) · impact ${f.impact}/10 · effort to fix: ${effortLabel(f.effort)}`,
    '',
    `> **${BASIS_LABELS[f.basis]}.** ${BASIS_NOTE[f.basis]}${f.citation ? ` \n> Criterion: \`${f.citation}\`` : ''}`,
    '',
    '## Recommendation',
    '',
    f.recommendation,
    '',
    '## Evidence',
    '',
    jsonBlock(f.evidence),
    '',
    f.derivedFrom.length
      ? `## Synthesised from\n\n${f.derivedFrom.map((id) => `- [${id}](./${id}.md)`).join('\n')}\n`
      : '',
  ].join('\n');
}

/** The verdict page — the entry point, for both readers. */
export function renderIndex(model) {
  const c = model.consistency;
  const top = model.findings.slice(0, 10);

  return frontMatter({
    type: 'verdict',
    site: model.site,
    generated: model.generatedAt,
    scope: model.scope,
    axes: model.axes,
    consistency_score: c.overall,
    grade: c.grade,
    confidence: c.confidence,
    coverage: Math.round((c.coverage || 0) * 100),
    provisional: !!c.provisional,
    design_score: c.byAxis.design,
    ux_score: c.byAxis.ux,
    engine_score: c.byAxis.engine,
    findings_total: model.stats.problems,
    strengths: model.stats.strengths,
    findings_critical: model.stats.bands.critical,
    findings_high: model.stats.bands.high,
  }) + [
    `# ${model.site} — consistency verdict`,
    '',
    `## ${c.overall ?? '—'}/100 · ${c.grade}`,
    '',
    `> ${GRADE_COPY[c.grade]}`,
    '',
    c.caveat ? `> **Provisional — confidence ${c.confidence}.** ${c.caveat}\n` : '',
    '| Axis | Score | Reading |',
    '|---|---|---|',
    ...model.axes.map((a) => `| ${AXIS_LABELS[a]} | ${c.byAxis[a] ?? 'not measured'} | ${axisReading(c.byAxis[a])} |`),
    '',
    `Analysed ${model.scope === 'site' ? `${countPages(model)} pages` : 'one page'} · ${model.stats.problems} findings · ${model.stats.bands.critical} critical, ${model.stats.bands.high} high`,
    '',
    '## What to fix first',
    '',
    ...top.map((f, i) => `${i + 1}. **[${f.title}](../findings/${f.id}.md)** — ${AXIS_LABELS[f.axis]}, priority ${f.priority}${f.kind === 'meta' ? ' _(cross-axis)_' : ''}`),
    '',
    '## Dimensions measured',
    '',
    '| Dimension | Axis | Score | Scope | Question |',
    '|---|---|---|---|---|',
    ...c.dimensions.map((d) =>
      `| ${d.label} | ${d.axis} | ${d.score ?? `— _(${d.reason || 'not measured'})_`} | ${d.scope} | ${d.question} |`),
    '',
    model.skipped.length
      ? `> **${model.skipped.length} dimension(s) not measured.** They are excluded from the score rather than counted as passing: ${model.skipped.map((s) => `\`${s.key}\` (${s.reason})`).join(', ')}.\n`
      : '',
    '## Method',
    '',
    model.method ? `Fold lines declared at ${Object.entries(model.method.foldLines).map(([v, h]) => `**${v} ${h}px**`).join(', ')}. ${model.method.viewportNote.join(' ')} ${model.method.measureApproximation}` : '',
    '',
    '## Not assessed',
    '',
    'This is a layout, token and geometry audit. It does not cover:',
    '',
    ...(model.notAssessed || []).map((n) => `- ${n}`),
    '',
    '> A score that implies accessibility or performance coverage it does not have is worse than no score.',
    '',
    '## Pages',
    '',
    ...model.pages.filter((p) => p.slug !== 'index')
      .map((p) => `- [${p.kind === 'owner' ? `For ${p.title.toLowerCase()}` : p.title}](./${p.slug}.md)`),
    '',
  ].join('\n');
}

const axisReading = (s) => {
  if (s == null) return 'not measured';
  if (s >= 85) return 'held';
  if (s >= 70) return 'mostly held';
  if (s >= 50) return 'drifting';
  return 'decided per page';
};

const countPages = (m) => new Set(m.findings.map((f) => f.url).filter(Boolean)).size || m.pageCount || '';

/** An axis page — one of three, and a filter over the pile, not a silo. */
export function renderAxisPage(page, model) {
  const findings = page.findingIds.map((id) => model.findingIndex[id]).filter(Boolean);
  // Design absorbed its owner page and the design review. Every other axis
  // renders as it always did: both of these are empty.
  const mine = (page.ownedElsewhereIds || []).map((id) => model.findingIndex[id]).filter(Boolean);
  return frontMatter({
    type: 'axis',
    axis: page.axis,
    site: model.site,
    score: page.score,
    findings_count: findings.length,
    ...(page.review ? { owned_elsewhere: mine.length, carries_design_review: true } : {}),
  }) + [
    `# ${page.title}`,
    '',
    `**${page.score ?? '—'}/100.** ${page.summary}`,
    '',
    '## Dimensions',
    '',
    '| Dimension | Score | Scope | Question |',
    '|---|---|---|---|',
    ...page.dimensions.map((d) =>
      `| ${d.label} | ${d.score ?? `— _(${d.reason || 'not measured'})_`} | ${d.scope} | ${d.question} |`),
    '',
    page.review ? '## Design drift' : '## Findings',
    '',
    page.review ? 'What the score above measures: places this site disagrees with itself.' : '',
    page.review ? '' : null,
    findings.length ? findingTable(findings) : '_Nothing found on this axis._',
    '',
    ...(mine.length ? [
      '## Also yours to fix',
      '',
      "These are the design team's to fix but sit on another axis, so the score above does not measure them.",
      '',
      findingTable(mine),
      '',
    ] : []),
    ...(page.review ? designReviewSections(model) : []),
  ].filter((l) => l !== null).join('\n');
}

/** A surface page — the same findings, crossed by screen instead of by axis. */
export function renderSurfacePage(page, model) {
  const findings = page.findingIds.map((id) => model.findingIndex[id]).filter(Boolean);
  const sections = Object.entries(page.byAxis)
    .filter(([, ids]) => ids.length)
    .map(([axis, ids]) => [
      `### ${AXIS_LABELS[axis]}`,
      '',
      findingTable(ids.map((id) => model.findingIndex[id]).filter(Boolean)),
      '',
    ].join('\n'));

  return frontMatter({
    type: 'surface',
    surface: page.surface,
    site: model.site,
    findings_count: findings.length,
  }) + [
    `# ${page.title}`,
    '',
    page.summary,
    '',
    '_All three axes, on this one screen. Each finding also appears on its axis page — same record, two routes to it._',
    '',
    ...sections,
  ].join('\n');
}

/**
 * Every finding on one page, highest priority first.
 *
 * The axis, owner and surface pages are each a partial view, so an agent had
 * to union four tables to get the whole pile. One file does it instead.
 */
export function renderAllFindingsPage(page, model) {
  const findings = page.findingIds.map((id) => model.findingIndex[id]).filter(Boolean);
  const problems = findings.filter((f) => f.kind !== 'strength');
  const strengths = findings.filter((f) => f.kind === 'strength');

  return frontMatter({
    type: 'findings',
    site: model.site,
    findings_count: findings.length,
    problems: problems.length,
    strengths: strengths.length,
    // Not a score and not a ranking — the same pile, ordered by priority.
    scored: false,
  }) + [
    '# All findings',
    '',
    page.summary,
    '',
    '_Every record in the audit, ordered by priority (impact \u00d7 ease of fix). The axis, owner, surface and GEO pages are this same pile filtered by a different question — linked, never copied._',
    '',
    `## Problems (${problems.length})`,
    '',
    problems.length ? findingTable(problems) : '_Nothing found._',
    '',
    ...(strengths.length ? [`## Working well (${strengths.length})`, '', findingTable(strengths), ''] : []),
  ].join('\n');
}

function findingTable(findings) {
  return [
    '| Priority | Band | Axis | Finding |',
    '|---|---|---|---|',
    ...findings.map((f) =>
      `| ${f.priority} | ${priorityBand(f.priority)} | ${AXIS_LABELS[f.axis]} | [${f.title}](../findings/${f.id}.md) |`),
  ].join('\n');
}

/**
 * The design review — the rebuild seed, in prose plus every export format.
 *
 * The markdown half of a page is not a summary of the HTML half: it is what an
 * agent reads, and what "Send to Claude" ends up pointing at. This one had the
 * heading and body families and nothing else while the HTML carried a typeface
 * table with provenance and a shape section, so asking Claude about the fonts
 * on an audited site got two names and no sources. A test now compares the
 * section headings of the two halves.
 */
function designReviewSections(model) {
  const t = model.tokens;
  if (!t) return [];
  return [
    '## The system as measured',
    '',
    'What this site is implicitly running, emitted as a system you can build with. A **starting point, not a finished system** — it is what the site does today, including its mistakes.',
    '',
    '### Colour',
    '',
    `- **Action:** \`${t.color.action || 'none found'}\` — the main call to action, read off the button.`,
    `- **Surface:** ${t.color.surface.map((c) => `\`${c.hex}\``).join(' ') || 'none'}`,
    `- **Ink:** ${t.color.ink.map((c) => `\`${c.hex}\``).join(' ') || 'none'}`,
    `- **Line:** ${t.color.line.map((c) => `\`${c.hex}\``).join(' ') || 'none'}`,
    t.color.accents.length ? `- **Accent:** ${t.color.accents.map((c) => `\`${c.hex}\` (${c.where.join('+')})`).join(' ')}` : '',
    '',
    '_Classified by the role each colour plays. Nothing here is a brand colour: a rendered page has no access to a brand, only to where paint was applied._',
    '',
    '| Step | Hex | Uses |',
    '|---|---|---|',
    ...t.color.surface.map((n, i) => `| surface-${i} | \`${n.hex}\` | ${n.uses} |`),
    ...t.color.ink.map((n, i) => `| ink-${i} | \`${n.hex}\` | ${n.uses} |`),
    '',
    t.color.contrastWarnings.length ? [
      '> **Contrast warnings**',
      '>',
      ...t.color.contrastWarnings.map((w) => `> - \`${w.pair}\` is ${w.ratio}:1, needs ${w.required}:1. ${w.note}`),
      '',
    ].join('\n') : '',
    '### Typefaces',
    '',
    '_Where each family is served from. A family can be in Google\'s catalogue and still be loaded from somewhere else — Shopify\'s font picker does exactly that — so the Google link is only given when the page really does load from Google._',
    '',
    '| Family | Full stack | Served from | Uses |',
    '|---|---|---|---|',
    ...(t.typography.families.all || []).map((f) => {
      const name = String(f.stack).split(',')[0].replace(/^["']|["']$/g, '').trim();
      const src = f.source || { kind: 'system' };
      const where = src.kind === 'google'
        ? `[Google Fonts](https://fonts.google.com/specimen/${encodeURIComponent(src.googleName).replace(/%20/g, '+')})`
        : src.kind === 'webfont'
          ? `webfont · \`${src.host || 'unknown host'}\``
          : 'system, or no `@font-face` on the page';
      return `| **${name}** | \`${f.stack}\` | ${where} | ${f.uses} |`;
    }),
    '',
    '### Type scale',
    '',
    `- **Heading:** \`${t.typography.families.heading || '—'}\``,
    `- **Body:** \`${t.typography.families.body || '—'}\``,
    `- **Base size:** ${t.typography.bodyPx}px · **detected scale ratio:** ${t.typography.ratio ?? 'no consistent ratio'}`,
    '',
    '| Step | Size | Uses |',
    '|---|---|---|',
    ...t.typography.scale.map((s) => `| ${s.name} | ${s.px}px | ${s.uses} |`),
    '',
    '### Spacing',
    '',
    `Base unit **${t.spacing.base}px**, honoured by ${Math.round(t.spacing.adherence * 100)}% of values.`,
    '',
    `Steps: ${t.spacing.steps.map((s) => `\`${s}px\``).join(' · ')}`,
    '',
    '### Shape',
    '',
    `- **Corner radii:** ${t.radius.steps.length ? t.radius.steps.map((r) => `\`${r.px}px\``).join(' · ') : 'none used'}`,
    `- **Shadows:** ${t.shadow.steps.length ? t.shadow.steps.map((sh) => `\`${sh.name}\``).join(' · ') : 'none used'}`,
    '',
    '### Exports',
    '',
    'Every format below is also a real file in `data/`, ready to use as-is:',
    '',
    '| Format | File | Consumed by |',
    '|---|---|---|',
    '| CSS custom properties | `data/tokens.css` | any stylesheet |',
    '| W3C DTCG tokens | `data/tokens.dtcg.json` | Figma, Style Dictionary |',
    '| Tailwind config | `data/tokens.tailwind.js` | Tailwind builds |',
    '| Shopify settings | `data/shopify-settings.json` | `config/settings_data.json` |',
    '',
    '#### CSS',
    '',
    '```css',
    t.formats.css,
    '```',
    '',
  ].filter(Boolean);
}


/**
 * An owner page — "is this mine", answered over the same pile of findings.
 */
export function renderOwnerPage(page, model) {
  const findings = page.findingIds.map((id) => model.findingIndex[id]).filter(Boolean);
  const bands = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) if (f.kind !== 'strength') bands[priorityBand(f.priority)]++;

  return frontMatter({
    type: 'owner',
    owner: page.owner,
    site: model.site,
    findings_count: findings.length,
    critical: bands.critical,
    high: bands.high,
  }) + [
    `# ${OWNER_LABELS[page.owner]}`,
    '',
    OWNER_BRIEF[page.owner],
    '',
    `${findings.length} finding${findings.length === 1 ? '' : 's'} \u2014 ${bands.critical} critical, ${bands.high} high.`,
    '',
    '_The same findings appear on their axis and surface pages. This is the same record reached by a different question, not a second copy._',
    '',
    '| Priority | Finding | Basis | Where |',
    '|---|---|---|---|',
    ...findings.map((f) =>
      `| ${f.kind === 'strength' ? 'strength' : f.priority} | [${f.title}](../findings/${f.id}.md) | ${BASIS_LABELS[f.basis]} | ${SURFACE_LABELS[f.surface] || f.surface} |`),
    '',
  ].join('\n');
}

/**
 * The GEO page, for the half of the audience that is a machine.
 *
 * Grouped the same way as the HTML, so an agent reading `pages/geo.md` and a
 * person reading `site/geo.html` are looking at the same partition of the same
 * pile — which is the whole point of the wiki being a projection rather than a
 * document.
 */
export function renderGeoPage(page, model) {
  const findings = page.findingIds.map((id) => model.findingIndex[id]).filter(Boolean);
  const problems = findings.filter((f) => f.kind !== 'strength');
  const bands = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of problems) bands[priorityBand(f.priority)]++;

  const path = findings.map((f) => f.evidence?.fullPath).find((p) => Array.isArray(p) && p.length);

  const sections = Object.entries(page.byGeoGroup).flatMap(([g, ids]) => {
    const list = ids.map((id) => model.findingIndex[id]).filter(Boolean);
    if (!list.length) return [];
    return [
      `## ${GEO_GROUP_LABELS[g]}`,
      '',
      GEO_GROUP_BRIEF[g],
      '',
      '| Priority | Finding | Basis | Where |',
      '|---|---|---|---|',
      ...list.map((f) =>
        `| ${f.kind === 'strength' ? 'strength' : f.priority} | [${f.title}](../findings/${f.id}.md) | ${BASIS_LABELS[f.basis]} | ${SURFACE_LABELS[f.surface] || f.surface} |`),
      '',
    ];
  });

  return frontMatter({
    type: 'geo',
    site: model.site,
    findings_count: findings.length,
    critical: bands.critical,
    high: bands.high,
    // Stated in the front matter so an agent reading only the header cannot
    // mistake this for a fourth axis with a score of its own.
    scored: false,
    note: 'A filtered view of the Engine axis. No separate score.',
  }) + [
    '# Machine readability',
    '',
    page.summary,
    '',
    `${problems.length} problem${problems.length === 1 ? '' : 's'} \u2014 ${bands.critical} critical, ${bands.high} high.`,
    '',
    '_This is a filtered view of findings that already live on the Engine axis page. It carries no score of its own: machine retrieval scores through the Engine groups Structured data, Retrieval and Machine parity._',
    '',
    ...(path ? [
      '## The buy path',
      '',
      'An agent stops at the first step with no machine-visible affordance. This reports where, not a percentage.',
      '',
      '| Step | State | Detail |',
      '|---|---|---|',
      ...path.map((s) => `| ${s.step} | ${s.state} | ${s.detail || ''} |`),
      '',
      '_Whether this storefront should be operable by agents is a commercial decision._',
      '',
    ] : []),
    ...sections,
    '## What this does not say',
    '',
    'Retrievable is not cited. Nothing here predicts traffic, rankings or whether an answer engine will quote this store \u2014 only what a machine can and cannot read. Crawler behaviour moves and there is no standards body for answer-engine retrieval, so apart from `lang` (WCAG 3.1.1) none of these findings is prescriptive.',
    '',
  ].join('\n');
}
