/**
 * Geometry, typography and manipulation checks.
 *
 * Defects, not drift — these produce Findings and do not move the consistency
 * score (see core/checks.js for why that separation exists).
 *
 * Every finding here declares its `basis`, because the three kinds of claim are
 * not interchangeable and blurring them is how an audit loses an argument:
 *
 *   prescriptive  a published criterion with a number, cited. Pass/fail.
 *   practice      convergent convention. "Outside established practice."
 *   directional   an effect seen on other catalogues. A reason to test.
 *
 * @module core/checks-geometry
 */

import { createFinding } from './finding.js';
import { DEPTH_BENCHMARK, usableHeight } from './observation.js';

const sum = (obs, path) => obs.reduce((n, o) => n + (path.split('.').reduce((v, k) => v?.[k], o) || 0), 0);
const flat = (obs, path) => obs.flatMap((o) => path.split('.').reduce((v, k) => v?.[k], o) || []);

/** Mobile observations, where fold and thumb-reach questions actually apply. */
const mobileOf = (obs) => obs.filter((o) => o.viewport?.label === 'mobile');
/** Fall back to whatever we have, but say which it was. */
const foldSet = (obs) => (mobileOf(obs).length ? mobileOf(obs) : obs);

export const GEOMETRY_CHECKS = [

  // ===== TARGETS — the one genuinely prescriptive check here ==============

  {
    id: 'target-minimum',
    axis: 'design',
    run(ctx) {
      const under24 = sum(ctx.observations, 'a11y.targetsUnder24');
      if (!under24) return [];
      const total = sum(ctx.observations, 'a11y.controlsTotal') || 1;
      const exempt = sum(ctx.observations, 'a11y.inlineLinksExempt');
      return [createFinding({
        checkId: 'design-target-under-24', axis: 'design', surface: ctx.scopeSurface,
        scope: 'extractive',
        basis: 'prescriptive',
        citation: 'WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA',
        title: `${under24} interactive target${under24 === 1 ? '' : 's'} below the 24x24px minimum`,
        impact: under24 / total > 0.2 ? 8 : 6,
        effort: 7,
        evidence: {
          failing: under24, controlsMeasured: total,
          share: +(under24 / total).toFixed(3),
          inlineLinksExempted: exempt,
          examples: flat(ctx.observations, 'a11y.tinyTargets').slice(0, 8),
          exemptionsApplied: 'Links inline within a sentence are exempt under SC 2.5.8 and were not counted.',
        },
        recommendation: 'Raise the hit area with padding rather than the font size — the target is what fails, not the label. 24px is the legal floor; 44px (Apple HIG) and 48px (Material) are what thumbs are trained on.',
        refs: ['wcag/2.5.8'],
      })];
    },
  },

  {
    id: 'target-comfortable',
    axis: 'design',
    run(ctx) {
      const under44 = sum(ctx.observations, 'a11y.targetsUnder44');
      const total = sum(ctx.observations, 'a11y.controlsTotal') || 1;
      if (under44 < 4 || under44 / total < 0.15) return [];
      return [createFinding({
        checkId: 'design-target-under-44', axis: 'design', surface: ctx.scopeSurface,
        scope: 'extractive',
        basis: 'practice',
        title: `${under44} targets sit between 24 and 44px — legal, but below platform convention`,
        impact: 5, effort: 7,
        evidence: {
          between24And44: under44, controlsMeasured: total,
          appleMinimum: '44x44pt', materialMinimum: '48x48dp',
        },
        recommendation: 'These pass WCAG AA and still cost taps. Apple and Google both set a higher floor, and that is what users\' muscle memory is trained on. Worth raising on anything in the buy path.',
      })];
    },
  },

  // ===== TYPE =============================================================

  {
    id: 'text-size-floor',
    axis: 'design',
    run(ctx) {
      const under12 = sum(ctx.observations, 'a11y.textUnder12');
      if (!under12) return [];
      return [createFinding({
        checkId: 'design-text-under-12', axis: 'design', surface: ctx.scopeSurface,
        scope: 'extractive',
        basis: 'practice',
        title: `${under12} visible text element${under12 === 1 ? '' : 's'} render below 12px`,
        impact: 6, effort: 8,
        evidence: {
          count: under12,
          samples: flat(ctx.observations, 'a11y.tinyTextSamples').slice(0, 8),
          note: 'WCAG sets NO minimum pixel size. The 12px floor is practical convention — claiming it is required by WCAG is false and will be caught.',
        },
        recommendation: 'Raise to at least 12px, ideally 14px for anything a customer has to read. If it is legal or disclosure copy, that is the text most likely to be contested and least likely to be readable.',
      })];
    },
  },

  {
    id: 'measure',
    axis: 'design',
    run(ctx) {
      const measures = flat(ctx.observations, 'typography.measures');
      if (measures.length < 3) return [];

      const tooWide = measures.filter((m) => m.cpl > 90);
      const tooNarrow = measures.filter((m) => m.cpl < 45);
      const out = [];

      if (tooWide.length) {
        const worst = tooWide.sort((a, b) => b.cpl - a.cpl)[0];
        out.push(createFinding({
          checkId: 'design-measure-wide', axis: 'design', surface: ctx.scopeSurface,
          scope: 'extractive', basis: 'practice',
          title: `${tooWide.length} paragraph${tooWide.length === 1 ? '' : 's'} run past 90 characters per line`,
          impact: 5, effort: 8,
          evidence: {
            count: tooWide.length, widest: worst, target: '45-75 characters',
            sources: 'Bringhurst 45-75 (66 ideal); Nielsen Norman 50-70; Baymard the same range for ecommerce body copy.',
            method: 'characters ~= width / (font-size x 0.48), an approximation for a humanist sans at normal tracking.',
          },
          recommendation: 'Cap paragraph width with a max-width container. Past ~75 characters the eye loses the start of the next line — three independent sources converge on the same range, which makes this unusually safe ground.',
        }));
      }

      if (tooNarrow.length >= 3) {
        const worst = tooNarrow.sort((a, b) => a.cpl - b.cpl)[0];
        out.push(createFinding({
          checkId: 'design-measure-narrow', axis: 'design', surface: ctx.scopeSurface,
          scope: 'extractive', basis: 'practice',
          title: `${tooNarrow.length} paragraphs are squeezed below 45 characters per line`,
          impact: 4, effort: 6,
          evidence: { count: tooNarrow.length, narrowest: worst, target: '45-75 characters' },
          recommendation: 'Usually a column that was designed for desktop and never re-thought at mobile width. Below 45 characters the eye jumps lines too often and reading tires — either widen the column or drop the font size to fit more per line.',
        }));
      }
      return out;
    },
  },

  // ===== FOLD AND DEPTH ===================================================

  {
    id: 'buy-path-fold',
    axis: 'ux',
    run(ctx) {
      const set = foldSet(ctx.observations).filter((o) => ['pdp', 'home', 'plp'].includes(o.surface));
      const out = [];

      for (const o of set) {
        const fold = usableHeight(o.viewport.label);
        const g = o.geometry || {};
        const hasSticky = (g.stickyControls || []).some((s) => s.hasAction);
        if (g.firstActionY == null) continue;
        if (g.firstActionY <= fold) continue;

        const screens = +(g.firstActionY / fold).toFixed(1);
        out.push(createFinding({
          checkId: `ux-action-below-fold-${o.surface}`, axis: 'ux', surface: o.surface,
          scope: 'extractive', url: o.url,
          basis: 'practice',
          title: `First ${o.surface === 'plp' ? 'action' : 'buy control'} sits ${g.firstActionY}px down — ${screens} screens below the fold`,
          // A buy control below the fold with no persistent alternative is the
          // most expensive geometry problem a commerce page can have.
          impact: hasSticky ? 6 : 9,
          effort: 5,
          evidence: {
            firstActionY: g.firstActionY,
            firstActionLabel: g.firstActionLabel,
            firstPriceY: g.firstPriceY,
            foldLine: fold,
            viewport: `${o.viewport.width}x${o.viewport.height} (fold declared at ${fold}px usable)`,
            screensDown: screens,
            persistentControl: hasSticky ? g.stickyControls.filter((s) => s.hasAction) : null,
            attention: '57% of page-viewing time is spent above the fold; 74% within the first two screenfuls (Nielsen Norman, Scrolling and Attention, 2018).',
            conversionContext: hasSticky ? undefined
              : 'Retailers publishing A/B results on sticky buy bars report add-to-cart gains in the 10-15% region, larger on mobile. That is other catalogues, not a projection for this one — it is a reason to test.',
          },
          recommendation: hasSticky
            ? 'A persistent control exists, which covers the worst of it. Still worth pulling the price and first action higher — attention is concentrated in the first screenful and decays sharply.'
            : 'Move the price and primary action above the fold, or add a persistent buy bar. With neither, the decision is being asked for after most of the available attention has already been spent.',
        }));
      }
      return out;
    },
  },

  {
    id: 'page-depth',
    axis: 'ux',
    run(ctx) {
      const out = [];
      const seen = new Set();
      for (const o of foldSet(ctx.observations)) {
        const bench = DEPTH_BENCHMARK[o.surface];
        const g = o.geometry || {};
        if (!bench || !g.pageHeight) continue;
        const fold = usableHeight(o.viewport.label);
        const screens = +(g.pageHeight / fold).toFixed(1);
        if (screens <= bench.investigate) continue;
        const key = `${o.surface}-${o.viewport.label}`;
        if (seen.has(key)) continue;
        seen.add(key);

        out.push(createFinding({
          checkId: `ux-page-depth-${o.surface}`, axis: 'ux', surface: o.surface,
          scope: 'extractive', url: o.url,
          basis: 'practice',
          title: `${o.surface.toUpperCase()} runs ${screens} screens deep on ${o.viewport.label} — benchmark is ${bench.good}`,
          impact: screens > bench.investigate * 1.4 ? 7 : 5,
          effort: 4,
          evidence: {
            pageHeight: g.pageHeight, foldLine: fold, screens,
            benchmark: { good: bench.good, investigate: bench.investigate },
            benchmarkBasis: 'DTC health/wellness conventions, not a standard. A benchmark to argue from, not a rule to fail against.',
            tallestSections: (g.sections || []).slice().sort((a, b) => b.height - a.height).slice(0, 4),
          },
          recommendation: 'Look at the tallest sections first — depth is usually three or four blocks, not uniform bloat. Subtraction beats refinement here: removing a section that serves no decision outperforms tightening every section.',
        }));
      }
      return out;
    },
  },

  {
    id: 'core-content-depth',
    axis: 'ux',
    run(ctx) {
      const out = [];
      for (const o of foldSet(ctx.observations).filter((x) => x.surface === 'plp')) {
        const g = o.geometry || {};
        if (g.coreContentY == null) continue;
        const fold = usableHeight(o.viewport.label);
        const screens = +(g.coreContentY / fold).toFixed(1);
        if (screens <= 1) continue;
        out.push(createFinding({
          checkId: 'ux-core-content-depth', axis: 'ux', surface: 'plp',
          scope: 'extractive', url: o.url, basis: 'practice',
          title: `First product on the listing page is ${screens} screens down`,
          impact: screens > 2 ? 8 : 6,
          effort: 6,
          evidence: { coreContentY: g.coreContentY, foldLine: fold, screens,
            aboveIt: (g.sections || []).filter((s) => s.y < g.coreContentY) },
          recommendation: 'A listing page exists to list. Everything above the first product is a toll, and the banners and copy blocks stacked there are usually inherited from a homepage layout rather than chosen for this template.',
        }));
      }
      return out;
    },
  },

  {
    id: 'section-proportion',
    axis: 'design',
    run(ctx) {
      const out = [];
      for (const o of foldSet(ctx.observations)) {
        const g = o.geometry || {};
        const sections = g.sections || [];
        if (sections.length < 3) continue;
        const fold = usableHeight(o.viewport.label);
        const outliers = sections.filter((s) => s.height > fold * 2.5);
        if (!outliers.length) continue;

        out.push(createFinding({
          checkId: `design-section-outlier-${o.surface}`, axis: 'design', surface: o.surface,
          scope: 'extractive', url: o.url, basis: 'practice',
          title: `${outliers.length} section${outliers.length === 1 ? '' : 's'} on ${o.surface.toUpperCase()} exceed 2.5 screens on their own`,
          impact: 5, effort: 5,
          evidence: {
            foldLine: fold,
            outliers: outliers.map((s) => ({ ...s, screens: +(s.height / fold).toFixed(1) })),
            allSections: sections.length,
          },
          recommendation: 'A single section taller than two and a half screens is usually a desktop layout carrying its padding into mobile unchanged. Check the vertical padding first — it is the cheapest fix and often the whole problem.',
        }));
      }
      return out;
    },
  },

  {
    id: 'footer-share',
    axis: 'design',
    run(ctx) {
      const out = [];
      const seen = new Set();
      for (const o of foldSet(ctx.observations)) {
        const g = o.geometry || {};
        if (!g.pageHeight || !g.footerHeight) continue;
        const share = g.footerHeight / g.pageHeight;
        if (share <= 0.12) continue;
        if (seen.has(o.surface)) continue;
        seen.add(o.surface);
        out.push(createFinding({
          checkId: `design-footer-share-${o.surface}`, axis: 'design', surface: o.surface,
          scope: 'extractive', url: o.url, basis: 'practice',
          title: `Footer is ${Math.round(share * 100)}% of the ${o.surface.toUpperCase()} page`,
          impact: 4, effort: 7,
          evidence: { footerHeight: g.footerHeight, pageHeight: g.pageHeight,
            share: +share.toFixed(3), benchmark: 'under 8% good, 8-12% investigate, over 12% a problem' },
          recommendation: 'Collapse footer link groups into accordions on mobile. Nothing is removed, so the "you are hiding content" objection does not apply — people judge difficulty by how much they can see, not how much exists.',
        }));
      }
      return out;
    },
  },

  // ===== CHOICE LOAD ======================================================

  {
    id: 'nav-load',
    axis: 'ux',
    run(ctx) {
      const counts = ctx.observations.map((o) => o.geometry?.navItemCount || 0).filter(Boolean);
      if (!counts.length) return [];
      const max = Math.max(...counts);
      if (max <= 7) return [];
      return [createFinding({
        checkId: 'ux-nav-overload', axis: 'ux', surface: 'site',
        scope: 'extractive', basis: 'practice',
        title: `Primary navigation carries ${max} top-level items`,
        impact: 5, effort: 5,
        evidence: {
          items: max, guideline: '5-7 top-level items',
          law: "Hick's Law — decision time rises logarithmically with the number of options (T = b x log2(n+1)). The effect is modest per item and compounds across a journey.",
        },
        recommendation: 'Group into 5-7 top-level entries with the rest one level down. This argues for clarity in navigation, not for removing functionality — the items still exist, they stop competing for the same glance.',
      })];
    },
  },

  {
    id: 'thumb-reach',
    axis: 'ux',
    run(ctx) {
      const out = [];
      for (const o of mobileOf(ctx.observations)) {
        const g = o.geometry || {};
        const hasSticky = (g.stickyControls || []).some((s) => s.hasAction);
        if (hasSticky || g.firstActionY == null) continue;
        const fold = usableHeight('mobile');
        // In the top 40% of the first screen, and nothing persistent to fall
        // back on — the action lives outside comfortable thumb reach for the
        // entire scroll.
        if (g.firstActionY > fold * 0.4) continue;
        out.push(createFinding({
          checkId: 'ux-thumb-reach', axis: 'ux', surface: o.surface,
          scope: 'extractive', url: o.url, basis: 'practice',
          title: 'Primary action sits high on the screen with no persistent control',
          impact: 4, effort: 6,
          evidence: {
            firstActionY: g.firstActionY, foldLine: fold,
            comfortableZone: 'bottom 60% of the screen; primary actions belong in the bottom-centre third',
            persistentControl: false,
          },
          recommendation: 'The natural resting position of the thumb is the bottom third. An action pinned to the top of a long mobile page requires a grip change every time — a sticky bar solves it without moving the layout.',
        }));
      }
      return out;
    },
  },

  // ===== STRENGTHS ========================================================
  // Naming what works is what lets it survive the next redesign, and a report
  // that only ever accuses is easy to dismiss wholesale.

  {
    id: 'strengths',
    axis: 'ux',
    run(ctx) {
      const out = [];
      const set = foldSet(ctx.observations);

      const sticky = set.find((o) => (o.geometry?.stickyControls || []).some((s) => s.hasAction));
      if (sticky) {
        out.push(createFinding({
          checkId: 'strength-persistent-control', axis: 'ux', surface: sticky.surface,
          kind: 'strength', scope: 'extractive', basis: 'practice',
          title: 'A persistent control follows the reader down the page',
          impact: 6, effort: 10,
          evidence: { controls: sticky.geometry.stickyControls.filter((s) => s.hasAction), url: sticky.url },
          recommendation: 'Keep this through the rebuild. It is what makes a long page survivable, and it is the first thing lost when a theme is swapped.',
        }));
      }

      const aboveFold = set.filter((o) => {
        const g = o.geometry || {};
        return o.surface === 'pdp' && g.firstActionY != null && g.firstActionY <= usableHeight(o.viewport.label);
      });
      if (aboveFold.length) {
        out.push(createFinding({
          checkId: 'strength-buy-above-fold', axis: 'ux', surface: 'pdp',
          kind: 'strength', scope: 'extractive', basis: 'practice',
          title: 'Price and buy control are above the fold on the product page',
          impact: 7, effort: 10,
          evidence: {
            pages: aboveFold.map((o) => ({ url: o.url, priceY: o.geometry.firstPriceY, actionY: o.geometry.firstActionY })),
            foldLine: usableHeight(aboveFold[0].viewport.label),
          },
          recommendation: 'This is the most valuable piece of geometry on a commerce page and it is already right. Protect it explicitly in the rebuild brief — it is easy to lose to one extra hero section.',
        }));
      }
      return out;
    },
  },
];
