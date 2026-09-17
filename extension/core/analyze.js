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
import { normalizeObservation, usableHeight, USABLE_VIEWPORT } from './observation.js';
import { synthesize } from './synthesis.js';
import { buildTokenSeed } from './tokens.js';
import { runQualityChecks } from './checks.js';

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
      key: dim.key, axis: dim.axis, group: dim.group, label: dim.label, question: dim.question,
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

  // Tokens are built before the quality checks because some of them (contrast)
  // examine the extracted system itself, not the raw page.
  const tokens = axes.includes('design') ? buildTokenSeed(observations) : null;

  // Quality checks: real defects that are NOT inconsistencies. They produce
  // Findings but deliberately do not feed the consistency score — see
  // core/checks.js for why keeping the score pure matters.
  findings.push(...runQualityChecks({ ...ctx, tokens }, axes));

  const consistency = aggregate(measured.map(({ key, axis, group, score, weight }) => ({ key, axis, group, score, weight })));
  consistency.verdict = GRADE_COPY[consistency.grade];
  consistency.dimensions = measured;
  consistency.caveat = consistency.provisional ? provisionalNote(consistency) : null;

  // Cross-axis pass. Only meaningful once more than one axis has run — with a
  // single axis there is no relationship to find.
  const metaFindings = axes.length > 1 ? synthesize(consistency, findings) : [];
  findings = rank(dedupe([...findings, ...metaFindings]));

  // What platform is this? The tool is Shopify-first, so a non-Shopify site is
  // a legitimate subject (pre-migration) but has to be LABELLED — several
  // checks read Shopify conventions and mean less without them.
  const platforms = observations.map((o) => o.engine?.platform).filter((p) => p && p !== 'unknown');
  const platform = platforms.length
    ? platforms.sort((a, b) =>
        platforms.filter((p) => p === b).length - platforms.filter((p) => p === a).length)[0]
    : 'unknown';

  // An audit whose fold line is undeclared cannot be checked by the person
  // reading it, so the assumptions travel with the result.
  const viewportsSeen = [...new Set(observations.map((o) => o.viewport.label))];
  const method = {
    foldLines: Object.fromEntries(viewportsSeen.map((v) => [v, usableHeight(v)])),
    viewportNote: viewportsSeen.map((v) => USABLE_VIEWPORT[v]?.note).filter(Boolean),
    measureApproximation: 'Characters per line estimated as width / (font-size x 0.48) — a humanist-sans average, not a per-typeface measurement.',
  };

  // Saying what a score does NOT cover is what stops it implying coverage it
  // has not got. A usability number that reads as an accessibility clearance is
  // worse than no number.
  const notAssessed = [
    'Keyboard and screen-reader journeys',
    'Motion, animation and reduced-motion preferences',
    'Colour contrast of every rendered pair (only token pairs and sampled elements)',
    'Copy quality, tone and claim accuracy',
    'Anything behind authentication, including the real checkout',
    ...(observations.some((o) => o.viewport.label === 'mobile') ? [] : ['Mobile rendering — no mobile viewport was captured in this run']),
    ...(axes.includes('engine') ? [] : ['Third-party scripts, apps and performance']),
  ];

  return {
    site: site || hostOf(observations[0]?.url),
    platform,
    method,
    notAssessed,
    isShopify: observations.some((o) => o.engine?.isShopify),
    generatedAt: new Date().toISOString(),
    scope: isSiteWide ? 'site' : 'page',
    axes,
    pages: observations.map((o) => ({ url: o.url, surface: o.surface, viewport: o.viewport.label })),
    consistency,
    findings,
    // Carried for the structure view. Stripped out of data/analysis.json by the
    // bundler — layout trees are large and belong in their own files.
    observations,
    tokens,
    skipped: measured.filter((m) => m.score == null).map((m) => ({ key: m.key, reason: m.reason })),
  };
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return 'unknown site'; }
}

/** @typedef {ReturnType<typeof analyze>} AnalysisResult */
