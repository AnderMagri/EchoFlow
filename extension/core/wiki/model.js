/**
 * The wiki page model.
 *
 * The findings are a flat pile. A wiki is a graph. This turns one into the other
 * WITHOUT copying: a finding belongs to exactly one record, and the axis page and
 * the surface page both link to it. That is the whole reason the output is a wiki
 * and not a document — the same finding is reachable from "show me the design
 * problems" and from "show me what is wrong with the PDP", by link, not by
 * duplication.
 *
 * @module core/wiki/model
 */

import {
  AXES, AXIS_LABELS, BAND_ORDER, CLIENT_THRESHOLD, SURFACE_LABELS,
  effortLabel, priorityBand,
} from '../finding.js';

/**
 * @param {import('../analyze.js').AnalysisResult} analysis
 * @returns {WikiModel}
 */
export function buildWikiModel(analysis) {
  const { findings, consistency } = analysis;

  const surfacesPresent = [...new Set(findings.map((f) => f.surface))];
  const axesPresent = AXES.filter((a) => analysis.axes.includes(a));

  const pages = [];

  // The entry page is the verdict, not a table of contents. This is the screen
  // that goes to the client, so it has to answer the question on its own.
  pages.push({
    slug: 'index',
    kind: 'verdict',
    title: `${analysis.site} — consistency verdict`,
    summary: consistency.verdict,
    findingIds: findings.slice(0, 12).map((f) => f.id),
  });

  for (const axis of axesPresent) {
    const axisFindings = findings.filter((f) => f.axis === axis);
    pages.push({
      slug: `axis-${axis}`,
      kind: 'axis',
      axis,
      title: `${AXIS_LABELS[axis]}`,
      score: consistency.byAxis[axis],
      summary: axisSummary(axis, consistency, axisFindings),
      dimensions: consistency.dimensions.filter((d) => d.axis === axis),
      findingIds: axisFindings.map((f) => f.id),
    });
  }

  for (const surface of surfacesPresent) {
    const surfaceFindings = findings.filter((f) => f.surface === surface);
    pages.push({
      slug: `surface-${surface}`,
      kind: 'surface',
      surface,
      title: SURFACE_LABELS[surface] || surface,
      summary: surfaceSummary(surface, surfaceFindings),
      // Crossing all three axes on one screen — this is the view the axis pages
      // cannot give you.
      byAxis: Object.fromEntries(axesPresent.map((a) => [a, surfaceFindings.filter((f) => f.axis === a).map((f) => f.id)])),
      findingIds: surfaceFindings.map((f) => f.id),
    });
  }

  if (analysis.tokens) {
    pages.push({
      slug: 'tokens',
      kind: 'tokens',
      title: 'Design system seed',
      summary: 'The system this site is implicitly running, extracted as tokens you can build with.',
      findingIds: [],
    });
  }

  return {
    site: analysis.site,
    platform: analysis.platform,
    isShopify: analysis.isShopify,
    generatedAt: analysis.generatedAt,
    scope: analysis.scope,
    axes: axesPresent,
    consistency,
    pages,
    findings,
    findingIndex: Object.fromEntries(findings.map((f) => [f.id, f])),
    tokens: analysis.tokens,
    skipped: analysis.skipped,
    stats: stats(findings),
  };
}

function stats(findings) {
  const bands = Object.fromEntries(BAND_ORDER.map((b) => [b, 0]));
  for (const f of findings) bands[priorityBand(f.priority)]++;
  return {
    total: findings.length,
    clientVisible: findings.filter((f) => f.priority >= CLIENT_THRESHOLD).length,
    meta: findings.filter((f) => f.kind === 'meta').length,
    bands,
  };
}

function axisSummary(axis, consistency, findings) {
  const score = consistency.byAxis[axis];
  if (score == null) return `${AXIS_LABELS[axis]} was not measured in this run.`;
  const worst = consistency.dimensions
    .filter((d) => d.axis === axis && typeof d.score === 'number')
    .sort((a, b) => a.score - b.score)[0];
  const lead = worst ? ` The weakest dimension is ${worst.label.toLowerCase()} at ${worst.score}.` : '';
  return `${AXIS_LABELS[axis]} consistency scores ${score}/100 across ${findings.length} finding${findings.length === 1 ? '' : 's'}.${lead}`;
}

function surfaceSummary(surface, findings) {
  if (!findings.length) return 'Nothing found on this surface.';
  const top = findings[0];
  const label = SURFACE_LABELS[surface] || surface;
  return `${findings.length} finding${findings.length === 1 ? '' : 's'} on ${label}. Highest priority: ${top.title}`;
}

/** Filter a model for a density. 'full' = everything; 'client' = above the bar. */
export function atDensity(model, density) {
  if (density === 'full') return model;
  const kept = model.findings.filter((f) => f.priority >= CLIENT_THRESHOLD);
  const keptIds = new Set(kept.map((f) => f.id));
  return {
    ...model,
    findings: kept,
    findingIndex: Object.fromEntries(kept.map((f) => [f.id, f])),
    pages: model.pages
      .map((p) => ({ ...p, findingIds: p.findingIds.filter((id) => keptIds.has(id)) }))
      .filter((p) => p.kind !== 'surface' || p.findingIds.length),
    stats: stats(kept),
  };
}

export { effortLabel, priorityBand, BAND_ORDER, CLIENT_THRESHOLD, AXIS_LABELS, SURFACE_LABELS };
