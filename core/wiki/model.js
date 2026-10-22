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
  AXES, AXIS_LABELS, BAND_ORDER, CLIENT_THRESHOLD, GEO_GROUPS, GEO_GROUP_LABELS,
  OWNERS, OWNER_BRIEF, OWNER_LABELS, SURFACE_LABELS, effortLabel, geoGroupFor,
  isGeoFinding, priorityBand,
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

  // Owner pages. The Engine axis in particular mixes audiences — "third-party
  // script set differs" and "no meta description" are both Engine, and
  // different people fix them. Same findings, reached by a different question:
  // not "what kind of problem" but "is this mine".
  for (const owner of OWNERS) {
    const ownerFindings = findings.filter((f) => f.owner === owner);
    if (!ownerFindings.length) continue;
    pages.push({
      slug: `for-${owner}`,
      kind: 'owner',
      owner,
      title: OWNER_LABELS[owner],
      summary: OWNER_BRIEF[owner],
      findingIds: ownerFindings.map((f) => f.id),
    });
  }

  // Every finding, in priority order, on one page.
  //
  // They were reachable only through the axis, owner and surface pages — each
  // a partial view — and the verdict page shows the top twelve. So a bundle
  // handed to a client had no single screen that said "here is everything",
  // which is the first thing anyone looks for. Another query over the same
  // pile, linked not copied, like every other page here.
  pages.push({
    slug: 'findings',
    kind: 'findings',
    title: 'All findings',
    summary: `Every finding, highest priority first. ${findings.length} in total — the axis, owner and surface pages are the same records filtered by a different question.`,
    findingIds: findings.map((f) => f.id),
  });

  // The GEO page. A query over the same pile, like every other page here — the
  // findings on it are the ones already on the Engine axis page, reached by the
  // question "can a machine use this store" instead of "what kind of problem is
  // this". No score: machine retrieval scores through the Engine groups it
  // already has, and a second number here would be the fourth axis the concept
  // forbids.
  const geoFindings = findings.filter(isGeoFinding);
  if (geoFindings.length) {
    pages.push({
      slug: 'geo',
      kind: 'geo',
      title: 'Machine readability',
      summary: geoSummary(geoFindings, consistency),
      byGeoGroup: Object.fromEntries(GEO_GROUPS
        .map((g) => [g, geoFindings.filter((f) => geoGroupFor(f.checkId) === g).map((f) => f.id)])
        .filter(([, ids]) => ids.length)),
      findingIds: geoFindings.map((f) => f.id),
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
      title: 'Design review',
      summary: 'The system this site is implicitly running, extracted as tokens you can build with.',
      findingIds: [],
    });
  }

  return {
    site: analysis.site,
    platform: analysis.platform,
    isShopify: analysis.isShopify,
    method: analysis.method,
    notAssessed: analysis.notAssessed,
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
  // Severity bands describe PROBLEMS. A strength has a priority because every
  // Finding does, but counting it as "critical" makes the distribution lie —
  // the headline count and the band total stop agreeing, and the larger number
  // is the wrong one.
  const problems = findings.filter((f) => f.kind !== 'strength');
  const bands = Object.fromEntries(BAND_ORDER.map((b) => [b, 0]));
  for (const f of problems) bands[priorityBand(f.priority)]++;
  return {
    total: findings.length,
    problems: problems.length,
    strengths: findings.length - problems.length,
    clientVisible: problems.filter((f) => f.priority >= CLIENT_THRESHOLD).length,
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

/**
 * Never claim traffic or citations. Retrievable is not cited — say what a
 * machine can and cannot read, and stop.
 */
function geoSummary(findings, consistency) {
  const problems = findings.filter((f) => f.kind !== 'strength');
  const worst = GEO_GROUPS
    .map((g) => [g, problems.filter((f) => geoGroupFor(f.checkId) === g).length])
    .filter(([, n]) => n)
    .sort((a, b) => b[1] - a[1])[0];
  const lead = worst ? ` Most of it sits in ${GEO_GROUP_LABELS[worst[0]].toLowerCase()}.` : '';
  return `What an answer engine, a crawler or a shopping agent can read here — ${problems.length} thing${problems.length === 1 ? '' : 's'} standing between this store and a machine that can use it.${lead} This says what a machine can and cannot read; it does not predict traffic or citations.`;
}

function surfaceSummary(surface, findings) {
  if (!findings.length) return 'Nothing found on this surface.';
  const top = findings[0];
  const label = SURFACE_LABELS[surface] || surface;
  return `${findings.length} finding${findings.length === 1 ? '' : 's'} on ${label}. Highest priority: ${top.title}`;
}

const filterIdMap = (map, keep) => Object.fromEntries(
  Object.entries(map).map(([k, ids]) => [k, ids.filter((id) => keep.has(id))]).filter(([, ids]) => ids.length));

/** Filter a model for a density. 'full' = everything; 'client' = above the bar. */
export function atDensity(model, density) {
  if (density === 'full') return model;
  const kept = model.findings.filter((f) => f.priority >= CLIENT_THRESHOLD);
  const keptIds = new Set(kept.map((f) => f.id));
  return {
    ...model,
    findings: kept,
    findingIndex: Object.fromEntries(kept.map((f) => [f.id, f])),
    // The sub-groupings have to be filtered too, not just findingIds — a page
    // that renders from byAxis or byGeoGroup would otherwise still walk ids the
    // density dropped. It survives today only because the lookup misses and
    // `.filter(Boolean)` swallows it, which is luck, not a design.
    pages: model.pages
      .map((p) => ({
        ...p,
        findingIds: p.findingIds.filter((id) => keptIds.has(id)),
        ...(p.byAxis ? { byAxis: filterIdMap(p.byAxis, keptIds) } : {}),
        ...(p.byGeoGroup ? { byGeoGroup: filterIdMap(p.byGeoGroup, keptIds) } : {}),
      }))
      .filter((p) => (p.kind !== 'surface' && p.kind !== 'geo') || p.findingIds.length),
    stats: stats(kept),
  };
}

export { effortLabel, priorityBand, BAND_ORDER, CLIENT_THRESHOLD, AXIS_LABELS, SURFACE_LABELS };
