/**
 * The analysis orchestrator.
 *
 * One entry point, used identically by the extension (one page, live DOM) and
 * the CLI (many pages, Playwright). The axes are selectable because the user
 * chooses what to run; the output shape does not change based on that choice,
 * it just carries fewer measured dimensions and says which ones it skipped.
 *
 * @module core/analyze
 */

import { aggregate, GRADE_COPY, provisionalNote } from './consistency.js';
import { DIMENSIONS } from './dimensions.js';
import { dedupe, rank } from './finding.js';
import { normalizeObservation } from './observation.js';
import { synthesize } from './synthesis.js';
import { buildTokenSeed } from './tokens.js';

/**
 * @param {object} input
 * @param {Partial<import('./observation.js').PageObservation>[]} input.observations
 * @param {('design'|'ux'|'engine')[]} [input.axes] which axes to run
 * @param {string} [input.site] display name for the report
 * @returns {AnalysisResult}
 */
export function analyze({ observations: rawObservations, axes = ['design', 'ux', 'engine'], site = '' }) {
  const observations = rawObservations.map(normalizeObservation);
  const isSiteWide = observations.length > 1;

  const ctx = {
    observations,
    isSiteWide,
    // Where a single-page finding is filed. On a site run, vocabulary findings
    // are about the site as a whole, not about whichever page we happened to
    // look at first.
    scopeSurface: isSiteWide ? 'site' : (observations[0]?.surface || 'content'),
  };

  const active = DIMENSIONS.filter((d) => axes.includes(d.axis));
  const measured = [];
  let findings = [];

  for (const dim of active) {
    let result;
    try {
      result = dim.measure(ctx);
    } catch (err) {
      result = { score: null, reason: `measurement failed: ${err.message}` };
    }

    measured.push({
      key: dim.key, axis: dim.axis, label: dim.label, question: dim.question,
      weight: dim.weight, scope: dim.scope,
      score: typeof result?.score === 'number' ? result.score : null,
      reason: result?.reason || null,
      detail: result,
    });

    if (typeof result?.score === 'number') {
      try {
        findings.push(...dim.findings(result, ctx));
      } catch (err) {
        // A broken finding-builder must not lose the score it belongs to.
        findings.push(...[]);
      }
    }
  }

  const consistency = aggregate(measured.map(({ key, axis, score, weight }) => ({ key, axis, score, weight })));
  consistency.verdict = GRADE_COPY[consistency.grade];
  consistency.dimensions = measured;
  consistency.caveat = consistency.provisional ? provisionalNote(consistency) : null;

  // Cross-axis pass. Only meaningful once more than one axis has run — with a
  // single axis there is no relationship to find.
  const metaFindings = axes.length > 1 ? synthesize(consistency, findings) : [];
  findings = rank(dedupe([...findings, ...metaFindings]));

  return {
    site: site || hostOf(observations[0]?.url),
    generatedAt: new Date().toISOString(),
    scope: isSiteWide ? 'site' : 'page',
    axes,
    pages: observations.map((o) => ({ url: o.url, surface: o.surface, viewport: o.viewport.label })),
    consistency,
    findings,
    // Carried for the structure view. Stripped out of data/analysis.json by the
    // bundler — layout trees are large and belong in their own files.
    observations,
    tokens: axes.includes('design') ? buildTokenSeed(observations) : null,
    skipped: measured.filter((m) => m.score == null).map((m) => ({ key: m.key, reason: m.reason })),
  };
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return 'unknown site'; }
}

/** @typedef {ReturnType<typeof analyze>} AnalysisResult */
