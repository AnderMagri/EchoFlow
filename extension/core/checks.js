/**
 * Quality checks.
 *
 * These produce Findings but do NOT feed the consistency score, and the split
 * is deliberate.
 *
 * The score answers one question — how far is this site from a coherent system.
 * A failing contrast ratio is a real defect, but it is not an inconsistency: a
 * site can be perfectly consistent and consistently illegible. Folding these
 * into the score would quietly turn the north star into a general quality
 * average, which is the thing 2.0 exists to avoid.
 *
 * But they still have to be Findings. The rule is that everything the tool
 * surfaces is a Finding; anything that cannot be is not output. Before this
 * module existed, the collector measured tap targets, alt text, heading
 * structure and contrast, and then threw all of it away — and the design review
 * showed contrast warnings the findings report knew nothing about. That was the
 * rule being broken quietly.
 *
 * @module core/checks
 */

import { createFinding } from './finding.js';
import { contrastRatio, parseColor } from './color.js';
import { GEOMETRY_CHECKS } from './checks-geometry.js';
import { PATTERN_CHECKS } from './checks-patterns.js';
import { RETRIEVAL_CHECKS } from './checks-retrieval.js';

const sum = (observations, path) =>
  observations.reduce((n, o) => n + (path.split('.').reduce((v, k) => v?.[k], o) || 0), 0);

/** Pages carrying a given a11y count, worst first — so a finding can name them. */
function worstPages(observations, key, limit = 5) {
  return observations
    .filter((o) => (o.a11y?.[key] || 0) > 0)
    .sort((a, b) => b.a11y[key] - a.a11y[key])
    .slice(0, limit)
    .map((o) => ({ url: o.url, count: o.a11y[key] }));
}

/**
 * Each check sees the same context the dimensions do and returns Findings.
 * @type {{id:string, axis:string, run:(ctx:any)=>any[]}[]}
 */
export const QUALITY_CHECKS = [

  // ===== DESIGN =========================================================

  {
    id: 'contrast',
    axis: 'design',
    run(ctx) {
      const out = [];

      // Token-level: pairs the extracted system itself cannot use safely.
      for (const w of ctx.tokens?.color?.contrastWarnings || []) {
        out.push(createFinding({
          checkId: 'design-contrast-token', axis: 'design', surface: ctx.scopeSurface,
          scope: 'extractive',
          basis: 'prescriptive',
          citation: 'WCAG 2.2 SC 1.4.3 Contrast (Minimum), Level AA',
          title: `${w.pair} is ${w.ratio}:1 — below the ${w.required}:1 minimum for text`,
          // Contrast is objectively wrong rather than a judgement call, and the
          // fix is a colour value, so impact is high and effort is trivial.
          impact: w.required >= 4.5 ? 8 : 6,
          effort: 9,
          evidence: { pair: w.pair, ratio: w.ratio, required: w.required, note: w.note },
          recommendation: `${w.note} Darken the foreground or lighten the background until it clears ${w.required}:1. In Shopify this is a colour scheme setting, not a code change.`,
          refs: ['wcag/1.4.3'],
        }));
      }

      // Element-level: pairs actually rendered on the page.
      const failures = ctx.observations.flatMap((o) =>
        (o.a11y?.contrastFailures || []).map((f) => ({ ...f, url: o.url })));
      if (failures.length) {
        const worst = failures.sort((a, b) => a.ratio - b.ratio)[0];
        out.push(createFinding({
          checkId: 'design-contrast-elements', axis: 'design', surface: ctx.scopeSurface,
          scope: 'extractive',
          basis: 'prescriptive',
          citation: 'WCAG 2.2 SC 1.4.3 Contrast (Minimum), Level AA',
          title: `${failures.length} text element${failures.length === 1 ? '' : 's'} below WCAG AA contrast`,
          impact: 8, effort: 7,
          evidence: { count: failures.length, worst, samples: failures.slice(0, 10) },
          recommendation: 'Fix the colour pairs rather than the elements — these usually trace back to two or three token combinations used in many places.',
          refs: ['wcag/1.4.3'],
        }));
      }
      return out;
    },
  },

  {
    id: 'heading-structure',
    axis: 'design',
    run(ctx) {
      const total = sum(ctx.observations, 'a11y.headingJumps');
      if (!total) return [];
      return [createFinding({
        checkId: 'design-heading-jumps', axis: 'design', surface: ctx.scopeSurface,
        scope: 'extractive',
        basis: 'prescriptive',
        citation: 'WCAG 2.2 SC 1.3.1 Info and Relationships, Level A',
        title: `Heading hierarchy skips levels in ${total} place${total === 1 ? '' : 's'}`,
        impact: 5, effort: 8,
        evidence: { jumps: total, pages: worstPages(ctx.observations, 'headingJumps') },
        recommendation: 'Headings are being picked for size rather than for structure. Use the level that describes the nesting and set the size with a token — in a theme these are separate decisions and should stay that way.',
        refs: ['wcag/1.3.1'],
      })];
    },
  },

  // ===== UX =============================================================

  {
    id: 'alt-text',
    axis: 'ux',
    run(ctx) {
      const missing = sum(ctx.observations, 'a11y.imagesMissingAlt');
      const total = sum(ctx.observations, 'a11y.imagesTotal');
      if (!missing || !total) return [];
      const share = missing / total;
      if (share < 0.1) return [];
      return [createFinding({
        checkId: 'ux-missing-alt', axis: 'ux', surface: ctx.scopeSurface,
        scope: 'extractive',
        basis: 'prescriptive',
        citation: 'WCAG 2.2 SC 1.1.1 Non-text Content, Level A',
        title: `${missing} of ${total} images have no alt text (${Math.round(share * 100)}%)`,
        impact: share > 0.5 ? 7 : 5,
        effort: 6,
        evidence: { missing, total, share, pages: worstPages(ctx.observations, 'imagesMissingAlt') },
        recommendation: 'On a storefront this is product imagery, so it is also a search and merchandising problem, not only an accessibility one. Shopify pulls alt text from the product media field — fill it there and the theme inherits it.',
        refs: ['wcag/1.1.1'],
      })];
    },
  },

  {
    id: 'form-labels',
    axis: 'ux',
    run(ctx) {
      const total = sum(ctx.observations, 'a11y.unlabeledControls');
      if (!total) return [];
      return [createFinding({
        checkId: 'ux-unlabeled-controls', axis: 'ux', surface: ctx.scopeSurface,
        scope: 'extractive',
        basis: 'prescriptive',
        citation: 'WCAG 2.2 SC 3.3.2 Labels or Instructions, Level A',
        title: `${total} form control${total === 1 ? '' : 's'} with no associated label`,
        impact: 7, effort: 8,
        evidence: { total, pages: worstPages(ctx.observations, 'unlabeledControls') },
        recommendation: 'Placeholder text is not a label — it disappears the moment someone types, which is exactly when they need it. Every unlabeled control on a checkout path is a conversion risk.',
        refs: ['wcag/3.3.2'],
      })];
    },
  },

  // ===== ENGINE =========================================================

  {
    id: 'page-weight',
    axis: 'engine',
    run(ctx) {
      const withWeight = ctx.observations.filter((o) => o.engine?.transferBytes > 0);
      if (!withWeight.length) return [];
      const heaviest = withWeight.sort((a, b) => b.engine.transferBytes - a.engine.transferBytes)[0];
      const mb = heaviest.engine.transferBytes / 1e6;
      if (mb < 3) return [];
      return [createFinding({
        checkId: 'engine-page-weight', axis: 'engine', surface: ctx.scopeSurface,
        scope: 'extractive',
        title: `Heaviest page transfers ${mb.toFixed(1)}MB across ${heaviest.engine.requests} requests`,
        impact: mb > 6 ? 8 : 6,
        effort: 5,
        evidence: {
          heaviestPage: heaviest.url, megabytes: +mb.toFixed(2), requests: heaviest.engine.requests,
          apps: heaviest.engine.apps,
        },
        recommendation: 'Check what the heavy pages load that the light ones do not — on Shopify it is usually an app embed or an unoptimised hero image. Theme code is rarely the culprit.',
      })];
    },
  },

  {
    id: 'lcp',
    axis: 'engine',
    run(ctx) {
      const samples = ctx.observations.filter((o) => Number.isFinite(o.engine?.vitals?.lcp) && o.engine.vitals.lcp > 0);
      if (!samples.length) return [];
      const worst = samples.sort((a, b) => b.engine.vitals.lcp - a.engine.vitals.lcp)[0];
      const lcp = worst.engine.vitals.lcp;
      // Under 2.5s is "good" per Core Web Vitals; below 400ms is almost always a
      // local or cached render rather than a real measurement, so stay quiet.
      if (lcp <= 2500 || lcp < 400) return [];
      return [createFinding({
        checkId: 'engine-lcp', axis: 'engine', surface: ctx.scopeSurface,
        scope: 'extractive',
        title: `Largest Contentful Paint reaches ${(lcp / 1000).toFixed(1)}s — Core Web Vitals wants under 2.5s`,
        impact: lcp > 4000 ? 8 : 6,
        effort: 4,
        evidence: {
          worstPage: worst.url, lcpMs: lcp,
          threshold: 2500,
          allPages: samples.slice(0, 6).map((o) => ({ url: o.url, lcp: o.engine.vitals.lcp })),
        },
        recommendation: 'The LCP element on a storefront is nearly always the hero image or the product gallery. Preload it, serve it at the right size, and stop it waiting behind third-party scripts.',
      })];
    },
  },

  {
    id: 'cls',
    axis: 'engine',
    run(ctx) {
      const samples = ctx.observations.filter((o) => Number.isFinite(o.engine?.vitals?.cls));
      if (!samples.length) return [];
      const worst = samples.sort((a, b) => b.engine.vitals.cls - a.engine.vitals.cls)[0];
      if (worst.engine.vitals.cls <= 0.1) return [];
      return [createFinding({
        checkId: 'engine-cls', axis: 'engine', surface: ctx.scopeSurface,
        scope: 'extractive',
        title: `Cumulative Layout Shift of ${worst.engine.vitals.cls.toFixed(3)} — the page moves under the reader`,
        impact: 6, effort: 6,
        evidence: { worstPage: worst.url, cls: worst.engine.vitals.cls, threshold: 0.1 },
        recommendation: 'Reserve space for images, embeds and anything an app injects late. On a PDP this is what makes someone tap the wrong variant.',
      })];
    },
  },
];

/**
 * Run every quality check. Failures are contained per check so one bad check
 * cannot cost the whole report.
 *
 * @param {object} ctx
 * @param {('design'|'ux'|'engine')[]} axes
 */
export function runQualityChecks(ctx, axes) {
  const out = [];
  for (const check of [...QUALITY_CHECKS, ...GEOMETRY_CHECKS, ...PATTERN_CHECKS, ...RETRIEVAL_CHECKS]) {
    if (!axes.includes(check.axis)) continue;
    try {
      out.push(...check.run(ctx));
    } catch {
      // A broken check is a bug to fix, not a reason to lose the other findings.
    }
  }
  return out;
}
