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
  AXIS_LABELS, BASIS_LABELS, BASIS_NOTE, OWNER_BRIEF, OWNER_LABELS,
  SURFACE_LABELS, effortLabel, priorityBand,
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
    findings_total: model.stats.total,
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
    `Analysed ${model.scope === 'site' ? `${countPages(model)} pages` : 'one page'} · ${model.stats.total} findings · ${model.stats.bands.critical} critical, ${model.stats.bands.high} high`,
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
  return frontMatter({
    type: 'axis',
    axis: page.axis,
    site: model.site,
    score: page.score,
    findings_count: findings.length,
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
    '## Findings',
    '',
    findings.length ? findingTable(findings) : '_Nothing found on this axis._',
    '',
  ].join('\n');
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

function findingTable(findings) {
  return [
    '| Priority | Band | Axis | Finding |',
    '|---|---|---|---|',
    ...findings.map((f) =>
      `| ${f.priority} | ${priorityBand(f.priority)} | ${AXIS_LABELS[f.axis]} | [${f.title}](../findings/${f.id}.md) |`),
  ].join('\n');
}

/** The tokens page — the rebuild seed, in prose plus every export format. */
export function renderTokensPage(model) {
  const t = model.tokens;
  if (!t) return '';
  return frontMatter({
    type: 'tokens',
    site: model.site,
    primary: t.color.primary,
    neutral_steps: t.color.neutral.length,
    type_steps: t.typography.scale.length,
    spacing_base: t.spacing.base,
    type_ratio: t.typography.ratio,
  }) + [
    '# Design system seed',
    '',
    'The clusters the consistency pass had to compute anyway, emitted as a system you can build with. This is a **starting point, not a finished system** — it is what the site is implicitly running, including its mistakes.',
    '',
    '## Colour',
    '',
    `- **Primary:** \`${t.color.primary || 'none detected'}\``,
    t.color.accents.length ? `- **Accents:** ${t.color.accents.map((c) => `\`${c}\``).join(' ')}` : '',
    '',
    '| Step | Hex | Uses |',
    '|---|---|---|',
    ...t.color.neutral.map((n) => `| ${n.name} | \`${n.hex}\` | ${n.uses} |`),
    '',
    t.color.contrastWarnings.length ? [
      '> **Contrast warnings**',
      '>',
      ...t.color.contrastWarnings.map((w) => `> - \`${w.pair}\` is ${w.ratio}:1, needs ${w.required}:1. ${w.note}`),
      '',
    ].join('\n') : '',
    '## Typography',
    '',
    `- **Heading:** \`${t.typography.families.heading || '—'}\``,
    `- **Body:** \`${t.typography.families.body || '—'}\``,
    `- **Base size:** ${t.typography.bodyPx}px · **detected scale ratio:** ${t.typography.ratio ?? 'no consistent ratio'}`,
    '',
    '| Step | Size | Uses |',
    '|---|---|---|',
    ...t.typography.scale.map((s) => `| ${s.name} | ${s.px}px | ${s.uses} |`),
    '',
    '## Spacing',
    '',
    `Base unit **${t.spacing.base}px**, honoured by ${Math.round(t.spacing.adherence * 100)}% of values.`,
    '',
    `Steps: ${t.spacing.steps.map((s) => `\`${s}px\``).join(' · ')}`,
    '',
    '## Exports',
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
    '### CSS',
    '',
    '```css',
    t.formats.css,
    '```',
    '',
  ].filter(Boolean).join('\n');
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
