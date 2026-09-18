/**
 * The consistency dimensions.
 *
 * Every dimension here answers the same question about a different property:
 * *is this decided once, or re-decided per page?* Design, UX and Engine are not
 * three different methods — they are the same two primitives (vocabulary
 * coherence, cross-page agreement) pointed at different evidence. That is what
 * makes one score legitimate across all three.
 *
 * A dimension declares its scope honestly. Comparative dimensions return
 * score:null on a single page rather than guessing, and the report says
 * "not measured" instead of quietly awarding credit.
 *
 * @module core/dimensions
 */

import {
  colorCoherence, crossPageAgreement, rhythmAdherence, splitColorEntries,
  vocabularyCoherence, ratioDistance, numericDistance, exactDistance,
  TOKEN_BUDGETS, TOLERANCES,
} from './consistency.js';
import { createFinding } from './finding.js';
import { evaluateParity, MISMATCH_CONSEQUENCE } from './parity.js';
import {
  mergeTallies, numericTallies, TRACKED_ROLES, ANATOMY_KEYS,
  flattenLayout, sectionSkeleton,
} from './observation.js';

const pct = (n) => `${Math.round(n * 100)}%`;

/**
 * Group observations by viewport before comparing them.
 *
 * Comparative checks ask "do pages that should agree, agree?" — and a
 * responsive layout is SUPPOSED to differ between breakpoints. Comparing a
 * desktop render against a mobile one reports every responsive decision as
 * drift, which is both wrong and the most annoying possible kind of wrong: it
 * fires hardest on sites that did responsive properly.
 *
 * So agreement is measured WITHIN a viewport and then averaged across them.
 * @param {any[]} observations
 */
function byViewport(observations) {
  const groups = new Map();
  for (const o of observations) {
    const key = o.viewport?.label || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  return [...groups.entries()];
}

/** Mean of per-viewport scores, ignoring viewports that could not be measured. */
function meanScore(scores) {
  const real = scores.filter((n) => typeof n === 'number');
  return real.length ? Math.round(real.reduce((a, b) => a + b, 0) / real.length) : null;
}
const list = (arr, n = 4) => arr.slice(0, n).join(', ') + (arr.length > n ? ` (+${arr.length - n} more)` : '');

/**
 * Impact/effort for a consistency finding, derived from how bad the score is
 * and how much traffic the strays carry. Kept in one place so every dimension
 * ranks on the same footing — no per-dimension fudge factors.
 */
function weigh(score, { spread = 0, systemic = false, impactFloor = 0 } = {}) {
  const deficit = (100 - score) / 100;
  const impact = Math.max(
    impactFloor,
    Math.min(10, Math.round(3 + deficit * 6 + (systemic ? 1.5 : 0)))
  );
  // `spread` is DISTINCT THINGS TO FIX, not total occurrences. A button whose
  // colour, radius and height all drift is one snippet to rebuild, so spread is
  // 1-ish and the fix is cheap; a palette with 40 stray hexes is 40 decisions.
  // Getting this backwards buries the most structural findings, because the
  // worst ones touch the most properties.
  const effort = Math.max(2, Math.min(10, Math.round(10 - Math.log2(1 + spread) * 1.6)));
  return { impact, effort };
}

// ---------------------------------------------------------------------------

/** @type {Dimension[]} */
export const DIMENSIONS = [

  // ===== DESIGN =========================================================

  {
    key: 'color-chromatic', axis: 'design', weight: 3, group: 'Colour', scope: 'extractive',
    label: 'Brand colour vocabulary',
    question: 'Are the brand colours a chosen set, or an accumulation?',
    measure(ctx) {
      const all = ['colorText', 'colorBackground', 'colorBorder']
        .flatMap((k) => mergeTallies(ctx.observations, k));
      const merged = foldTallies(all);
      const { chromatic } = splitColorEntries(merged);
      return colorCoherence(chromatic, 'chromatic');
    },
    findings(r, ctx) {
      const out = [];
      for (const dupe of r.nearDuplicates.slice(0, 6)) {
        out.push(createFinding({
          checkId: 'design-colour-fork', axis: 'design', surface: ctx.scopeSurface,
          scope: 'extractive',
          title: `Brand colour ${dupe.token} exists in ${dupe.variants.length + 1} near-identical versions`,
          ...weigh(r.score, { spread: dupe.variants.length }),
          evidence: {
            token: dupe.token, variants: dupe.variants, strayUses: dupe.strayUses,
            note: 'These are visually indistinguishable but are separate values in CSS.',
          },
          recommendation: `Collapse ${list(dupe.variants.map((v) => v.value))} into ${dupe.token} and expose it as a single theme colour setting.`,
          refs: ['shopify/platform#colorSchemes'],
        }));
      }
      if (r.tokens > TOKEN_BUDGETS.colorChromatic) {
        out.push(createFinding({
          checkId: 'design-colour-sprawl', axis: 'design', surface: ctx.scopeSurface,
          scope: 'extractive',
          title: `${r.tokens} distinct brand colours — a Shopify colour scheme system expects about ${TOKEN_BUDGETS.colorChromatic}`,
          ...weigh(r.score, { spread: r.tokens - TOKEN_BUDGETS.colorChromatic, systemic: true }),
          evidence: { tokens: r.tokens, budget: TOKEN_BUDGETS.colorChromatic, palette: r.clusters.slice(0, 20) },
          recommendation: 'Reduce to a primary, a secondary, and semantic states (success/warning/error/info), then map each to a Shopify colour scheme. Everything else becomes a usage of those.',
          refs: ['shopify/platform#colorSchemes'],
        }));
      }
      return out;
    },
  },

  {
    key: 'color-neutral', axis: 'design', weight: 2, group: 'Colour', scope: 'extractive',
    label: 'Neutral ramp',
    question: 'Is the grey ramp a ladder, or a pile?',
    measure(ctx) {
      const all = ['colorText', 'colorBackground', 'colorBorder']
        .flatMap((k) => mergeTallies(ctx.observations, k));
      const { neutral } = splitColorEntries(foldTallies(all));
      return colorCoherence(neutral, 'neutral');
    },
    findings(r, ctx) {
      if (!r.nearDuplicates.length) return [];
      const worst = r.nearDuplicates[0];
      return [createFinding({
        checkId: 'design-neutral-leak', axis: 'design', surface: ctx.scopeSurface,
        scope: 'extractive',
        title: `Neutral ${worst.token} has ${worst.variants.length} near-duplicate${worst.variants.length > 1 ? 's' : ''} that no one can see apart`,
        ...weigh(r.score, { spread: r.leakage }),
        evidence: { leaks: r.nearDuplicates.slice(0, 8), rampSize: r.tokens },
        recommendation: 'Define the neutral ramp as explicit steps (surface, surface-raised, border, text-muted, text) and delete the in-between values.',
      })];
    },
  },

  {
    key: 'type-scale', axis: 'design', weight: 3, group: 'Typography', scope: 'extractive',
    label: 'Type scale',
    question: 'Do the font sizes form a scale, or a list of guesses?',
    measure(ctx) {
      const entries = numericTallies(mergeTallies(ctx.observations, 'fontSize'));
      return vocabularyCoherence({
        entries, ideal: TOKEN_BUDGETS.fontSize,
        distance: ratioDistance, tolerance: TOLERANCES.fontSizeRatio,
        format: (v) => `${v}px`,
      });
    },
    findings(r, ctx) {
      const out = [];
      if (r.tokens > TOKEN_BUDGETS.fontSize) {
        out.push(createFinding({
          checkId: 'design-type-sprawl', axis: 'design', surface: ctx.scopeSurface,
          scope: 'extractive',
          title: `${r.tokens} distinct font sizes in use — a modular scale needs about ${TOKEN_BUDGETS.fontSize}`,
          ...weigh(r.score, { spread: r.tokens - TOKEN_BUDGETS.fontSize, systemic: true }),
          evidence: { tokens: r.tokens, distinct: r.distinct, budget: TOKEN_BUDGETS.fontSize, sizes: r.clusters.slice(0, 24) },
          recommendation: 'Collapse to a modular scale and expose it as theme typography settings. Sizes that differ by 1px are the same step.',
        }));
      }
      for (const d of r.nearDuplicates.slice(0, 3)) {
        out.push(createFinding({
          checkId: 'design-type-fork', axis: 'design', surface: ctx.scopeSurface,
          scope: 'extractive',
          title: `Font size ${d.token} duplicated as ${list(d.variants.map((v) => v.value))}`,
          ...weigh(r.score, { spread: d.variants.length }),
          evidence: d,
          recommendation: `Use ${d.token} everywhere. A 1px difference is not a design decision, it is a leak.`,
        }));
      }
      return out;
    },
  },

  {
    key: 'type-families', axis: 'design', weight: 2, group: 'Typography', scope: 'extractive',
    label: 'Font families',
    question: 'How many typefaces are actually loaded?',
    measure(ctx) {
      const entries = mergeTallies(ctx.observations, 'fontFamily')
        .map((t) => ({ value: primaryFamily(t.value), count: t.count }));
      return vocabularyCoherence({
        entries: foldTallies(entries), ideal: TOKEN_BUDGETS.fontFamily,
        distance: exactDistance, tolerance: 0,
      });
    },
    findings(r, ctx) {
      if (r.tokens <= TOKEN_BUDGETS.fontFamily) return [];
      return [createFinding({
        checkId: 'design-font-sprawl', axis: 'design', surface: ctx.scopeSurface,
        scope: 'extractive',
        title: `${r.tokens} typefaces in use — each one is a webfont request on every page`,
        ...weigh(r.score, { spread: r.tokens - TOKEN_BUDGETS.fontFamily, systemic: true }),
        evidence: { families: r.clusters, budget: TOKEN_BUDGETS.fontFamily },
        recommendation: 'Reduce to a heading face and a body face. In Shopify both are theme settings, so this is a settings change plus cleanup, not a rebuild.',
        refs: ['shopify/platform#typography'],
      })];
    },
  },

  {
    key: 'spacing-rhythm', axis: 'design', weight: 3, group: 'Spacing', scope: 'extractive',
    label: 'Spacing rhythm',
    question: 'Does spacing sit on a base unit, or wherever it landed?',
    measure(ctx) {
      // Same 4px floor as the token seed: sub-4px values are hairlines and
      // border compensation, not spacing decisions, and scoring them as rhythm
      // violations punishes a site for having 1px borders.
      return rhythmAdherence(
        numericTallies(mergeTallies(ctx.observations, 'spacing')).filter((e) => e.value >= 4)
      );
    },
    findings(r, ctx) {
      if (!r.strays.length || r.score >= 92) return [];
      return [createFinding({
        checkId: 'design-rhythm-break', axis: 'design', surface: ctx.scopeSurface,
        scope: 'extractive',
        title: `${pct(1 - r.adherence)} of spacing values ignore the ${r.base}px base unit`,
        ...weigh(r.score, { spread: r.strays.length, systemic: true }),
        evidence: { base: r.base, adherence: r.adherence, strays: r.strays.slice(0, 15) },
        recommendation: `Snap stray values to the nearest multiple of ${r.base}px (e.g. ${r.strays.slice(0, 3).map((s) => `${Math.round(s.value * 10) / 10}px -> ${Math.max(r.base, s.nearest)}px`).join(', ')}). Shopify section padding settings are already stepped, so this aligns with how the theme editor works.`,
      })];
    },
  },

  {
    key: 'radius-scale', axis: 'design', weight: 1, group: 'Shape', scope: 'extractive',
    label: 'Corner radius',
    question: 'Is roundness a token or a mood?',
    measure(ctx) {
      const entries = numericTallies(mergeTallies(ctx.observations, 'borderRadius')).filter((e) => e.value > 0);
      return vocabularyCoherence({
        entries, ideal: TOKEN_BUDGETS.borderRadius,
        distance: numericDistance, tolerance: TOLERANCES.radius, format: (v) => `${v}px`,
      });
    },
    findings(r, ctx) {
      if (r.tokens <= TOKEN_BUDGETS.borderRadius) return [];
      return [createFinding({
        checkId: 'design-radius-sprawl', axis: 'design', surface: ctx.scopeSurface,
        scope: 'extractive',
        title: `${r.tokens} distinct corner radii — Shopify themes expose one global radius setting`,
        ...weigh(r.score, { spread: r.tokens - TOKEN_BUDGETS.borderRadius }),
        evidence: { radii: r.clusters.slice(0, 12), budget: TOKEN_BUDGETS.borderRadius },
        recommendation: 'Pick none / small / medium / pill. A theme that exposes a single radius setting cannot reproduce a nine-radius design without custom CSS on every component.',
      })];
    },
  },

  {
    key: 'elevation-scale', axis: 'design', weight: 1, group: 'Shape', scope: 'extractive',
    label: 'Elevation',
    question: 'Are shadows a system, or copy-paste?',
    measure(ctx) {
      const entries = mergeTallies(ctx.observations, 'shadow');
      return vocabularyCoherence({
        entries, ideal: TOKEN_BUDGETS.shadow, distance: exactDistance, tolerance: 0,
      });
    },
    findings(r, ctx) {
      if (r.tokens <= TOKEN_BUDGETS.shadow) return [];
      return [createFinding({
        checkId: 'design-elevation-sprawl', axis: 'design', surface: ctx.scopeSurface,
        scope: 'extractive',
        title: `${r.tokens} distinct shadows doing the work of about ${TOKEN_BUDGETS.shadow}`,
        ...weigh(r.score, { spread: r.tokens - TOKEN_BUDGETS.shadow }),
        evidence: { shadows: r.clusters.slice(0, 10).map((c) => c.token) },
        recommendation: 'Define an elevation ladder (raised / overlay / modal) and reuse it. Near-identical shadows read as sloppiness at scale.',
      })];
    },
  },

  // The comparative design dimension — the one that pays for crawling the site.
  {
    key: 'component-drift', axis: 'design', weight: 4, group: 'Components', scope: 'comparative',
    label: 'Component drift',
    question: 'Does the same component look the same on every page?',
    measure(ctx) {
      if (!ctx.isSiteWide) return { score: null, reason: 'needs more than one page' };
      const results = {};
      const scores = [];

      for (const role of TRACKED_ROLES) {
        const props = ['background', 'color', 'fontSize', 'fontWeight', 'borderRadius', 'height'];
        for (const prop of props) {
          // Within each viewport, not across them: a 48px button on desktop and
          // a 44px one on mobile is responsive design, not drift.
          const perViewport = [];
          let worst = null;
          for (const [, group] of byViewport(ctx.observations)) {
            const observations = group
              .filter((o) => o.roles?.[role]?.[prop] != null)
              .map((o) => ({ page: o.url, value: o.roles[role][prop] }));
            if (observations.length < 2) continue;
            const numeric = typeof observations[0].value === 'number';
            const agreement = crossPageAgreement({
              observations,
              distance: numeric ? numericDistance : undefined,
              tolerance: numeric ? 1.01 : 0,
            });
            if (agreement.score == null) continue;
            perViewport.push(agreement.score);
            if (!worst || agreement.score < worst.score) worst = agreement;
          }
          if (!perViewport.length) continue;
          results[`${role}.${prop}`] = worst;
          scores.push(meanScore(perViewport));
        }
      }
      if (!scores.length) return { score: null, reason: 'no shared roles observed at a single viewport' };
      return { score: meanScore(scores), roles: results };
    },
    findings(r, ctx) {
      if (r.score == null) return [];

      // One role that drifts is ONE finding, not one per property. A button
      // whose colour, radius, height and weight all differ across pages is not
      // four problems — it is one component that was never a component. Emitting
      // four rows would be reporting what we measured instead of what it means.
      const byRole = new Map();
      for (const [roleProp, agreement] of Object.entries(r.roles || {})) {
        if (agreement.score >= 100) continue;
        const [role, prop] = roleProp.split('.');
        if (!byRole.has(role)) byRole.set(role, []);
        byRole.get(role).push({ prop, agreement });
      }

      return [...byRole.entries()]
        .map(([role, drifts]) => {
          drifts.sort((a, b) => a.agreement.score - b.agreement.score);
          const worst = drifts[0].agreement;
          // Score the role by its least-agreed property — a component is only
          // as consistent as its most-drifting attribute.
          const roleScore = worst.score;
          const props = drifts.map((d) => humanProp(d.prop).toLowerCase());
          const pagesOff = new Set(drifts.flatMap((d) => d.agreement.outliers.map((o) => o.page)));

          return { role, drifts, roleScore, props, pagesOff, worst };
        })
        .sort((a, b) => a.roleScore - b.roleScore)
        .slice(0, 6)
        .map(({ role, drifts, roleScore, props, pagesOff, worst }) => createFinding({
          checkId: `design-drift-${role}`, axis: 'design', surface: 'site',
          scope: 'comparative',
          title: props.length === 1
            ? `${humanRole(role)} ${props[0]} differs across pages`
            : `${humanRole(role)} is not one component — ${props.length} properties drift across ${pagesOff.size} pages`,
          // spread 1: this is one component to standardise, however many of its
          // properties wandered. impactFloor: a role drifting on 3+ properties
          // means no component abstraction exists at all, which outranks what
          // the raw agreement percentage suggests on its own.
          ...weigh(roleScore, {
            spread: 1,
            systemic: props.length > 2,
            impactFloor: props.length >= 3 ? 8 : 0,
          }),
          evidence: {
            role,
            driftingProperties: drifts.map((d) => ({
              property: d.prop,
              consensus: d.agreement.consensus,
              agreement: d.agreement.agreement,
              variants: d.agreement.variants,
            })),
            pagesDisagreeing: [...pagesOff],
            pagesCompared: worst.pages,
          },
          recommendation: props.length === 1
            ? `Standardise ${humanRole(role).toLowerCase()} ${props[0]} on ${worst.consensus}.`
            : `Rebuild ${humanRole(role).toLowerCase()} as a single Shopify snippet driven by theme settings (${props.join(', ')}). Every property here has to be decided once before the component can exist — doing it now costs one decision, doing it during the build costs one per template.`,
        }));
    },
  },

  {
    key: 'layout-skeleton', axis: 'design', weight: 3, group: 'Layout', scope: 'comparative',
    label: 'Layout skeleton',
    question: 'Do pages of the same type have the same box structure?',
    measure(ctx) {
      const scores = [], detail = {};
      const surfaces = [...new Set(ctx.observations.map((o) => o.surface))];

      for (const surface of surfaces) {
        // Per viewport: a responsive template legitimately collapses two columns
        // into one, which changes the skeleton without changing the template.
        const perViewport = [];
        let worst = null;
        for (const [, group] of byViewport(ctx.observations)) {
          const peers = group.filter((o) => o.surface === surface && o.layout);
          if (peers.length < 2) continue;

          // The signature is the ordered list of section roles. Two PDPs that
          // run hero/grid/text/grid have the same skeleton even if their
          // content and exact heights differ — the right granularity, because
          // that is what a Shopify template has to reproduce.
          const observations = peers.map((o) => ({
            page: o.url,
            value: sectionSkeleton(o.layout).map((n) => n.role || n.tag).join(' > ') || '(none)',
          }));
          const a = crossPageAgreement({ observations });
          if (a.score == null) continue;
          perViewport.push(a.score);
          if (!worst || a.score < worst.score) worst = a;
        }
        if (!perViewport.length) continue;
        detail[surface] = worst;
        scores.push(meanScore(perViewport));
      }
      if (!scores.length) return { score: null, reason: 'needs at least two pages of the same type with layout captured' };
      return { score: Math.round(scores.reduce((x, y) => x + y, 0) / scores.length), detail };
    },
    findings(r) {
      if (r.score == null) return [];
      return Object.entries(r.detail || {})
        .filter(([, a]) => a.score < 100)
        .map(([surface, a]) => createFinding({
          checkId: `design-skeleton-${surface}`, axis: 'design', surface, scope: 'comparative',
          title: `${surface.toUpperCase()} pages have ${a.variants.length} different section skeletons`,
          ...weigh(a.score, { spread: 1, systemic: true, impactFloor: a.variants.length > 2 ? 8 : 0 }),
          evidence: {
            surface,
            consensusSkeleton: a.consensus,
            skeletons: a.variants,
            pagesDiffering: a.outliers.slice(0, 10),
          },
          recommendation: `One template should produce one skeleton. ${a.variants.length} skeletons on ${surface.toUpperCase()} means sections were added per page in the theme editor, or these pages use different templates. Decide which skeleton is the ${surface.toUpperCase()} before rebuilding — see \`site/structure-${surface}.html\` for the box view.`,
        }));
    },
  },

  {
    key: 'column-systems', axis: 'design', weight: 2, group: 'Layout', scope: 'extractive',
    label: 'Column systems',
    question: 'How many different grids is the page running?',
    measure(ctx) {
      const counts = ctx.observations
        .filter((o) => o.layout)
        .flatMap((o) => flattenLayout(o.layout))
        .map((n) => n.cols)
        .filter((c) => Number.isFinite(c) && c > 1 && c <= 16);
      if (!counts.length) return { score: null, reason: 'no multi-column layouts detected' };

      const tally = new Map();
      for (const c of counts) tally.set(c, (tally.get(c) || 0) + 1);
      const entries = [...tally.entries()].map(([value, count]) => ({ value, count }));

      // A theme normally runs a handful: a 12-ish page grid, a product grid,
      // and a couple of content splits. More than that and every block is
      // improvising its own layout.
      return vocabularyCoherence({
        entries, ideal: 4, distance: exactDistance, tolerance: 0,
        format: (v) => `${v} columns`,
      });
    },
    findings(r, ctx) {
      if (r.score == null || r.tokens <= 4) return [];
      return [createFinding({
        checkId: 'design-column-sprawl', axis: 'design', surface: ctx.scopeSurface,
        scope: 'extractive',
        title: `${r.tokens} different column counts in use across the layout`,
        ...weigh(r.score, { spread: r.tokens - 4, systemic: true }),
        evidence: { columnSystems: r.clusters, budget: 4 },
        recommendation: 'Settle on one page grid and one product grid. Every extra column count is a layout that has to be rebuilt by hand instead of reusing a theme section.',
      })];
    },
  },

  // ===== UX =============================================================

  {
    key: 'cta-language', axis: 'ux', weight: 3, group: 'Language', scope: 'comparative',
    label: 'CTA language',
    question: 'Is the same action called the same thing everywhere?',
    measure(ctx) {
      // Wording is content: it should be identical at every viewport, so the
      // same URL twice would just double-count. One observation per URL.
      const seen = new Set();
      const observations = ctx.observations
        .filter((o) => o.roles?.primaryButton?.label)
        .filter((o) => !seen.has(o.url) && seen.add(o.url))
        .map((o) => ({ page: o.url, value: normalizeLabel(o.roles.primaryButton.label) }));
      if (observations.length < 2) return { score: null, reason: 'needs more than one page' };
      return crossPageAgreement({ observations });
    },
    findings(r, ctx) {
      if (r.score == null || r.score === 100) return [];
      return [createFinding({
        checkId: 'ux-cta-drift', axis: 'ux', surface: 'site', scope: 'comparative',
        title: `The primary action is worded ${r.variants.length} different ways across the site`,
        ...weigh(r.score, { spread: r.variants.length, systemic: true }),
        evidence: { consensus: r.consensus, variants: r.variants, outliers: r.outliers.slice(0, 10) },
        recommendation: `Pick one verb and use it everywhere — "${r.consensus}" already leads. Shoppers learn one word for one action; three words read as three different actions.`,
      })];
    },
  },

  {
    key: 'nav-stability', axis: 'ux', weight: 2, group: 'Navigation', scope: 'comparative',
    label: 'Navigation stability',
    question: 'Does the main navigation stay put?',
    measure(ctx) {
      // Nav contents should match everywhere; one observation per URL so a
      // two-viewport run does not count each page twice.
      const seen = new Set();
      const observations = ctx.observations
        .filter((o) => o.roles?.header?.items?.length)
        .filter((o) => !seen.has(o.url) && seen.add(o.url))
        .map((o) => ({ page: o.url, value: o.roles.header.items.join(' > ') }));
      if (observations.length < 2) return { score: null, reason: 'needs more than one page' };
      return crossPageAgreement({ observations });
    },
    findings(r) {
      if (r.score == null || r.score === 100) return [];
      return [createFinding({
        checkId: 'ux-nav-drift', axis: 'ux', surface: 'site', scope: 'comparative',
        title: `Main navigation differs on ${r.outliers.length} of ${r.pages} pages`,
        ...weigh(r.score, { spread: r.outliers.length, systemic: true }),
        evidence: { consensus: r.consensus, variants: r.variants, outliers: r.outliers.slice(0, 10) },
        recommendation: 'Navigation should be one Shopify menu rendered by one header section. Divergence here usually means hardcoded links in templates, which will not survive the migration.',
        refs: ['shopify/sections#header'],
      })];
    },
  },

  {
    key: 'template-anatomy', axis: 'ux', weight: 3, group: 'Templates', scope: 'comparative',
    label: 'Template anatomy',
    question: 'Do pages of the same type contain the same parts?',
    measure(ctx) {
      const scores = [], detail = {};
      for (const [surface, keys] of Object.entries(ANATOMY_KEYS)) {
        // Anatomy is content, not layout, so it SHOULD match across viewports —
        // but a peer set that mixes them double-counts every page. Take the
        // richest single viewport instead.
        const peers = byViewport(ctx.observations)
          .map(([, g]) => g.filter((o) => o.surface === surface))
          .sort((a, b) => b.length - a.length)[0] || [];
        if (peers.length < 2) continue;
        for (const key of keys) {
          const observations = peers.map((o) => ({ page: o.url, value: o.anatomy?.[key] ? 'present' : 'absent' }));
          const a = crossPageAgreement({ observations });
          if (a.score == null || a.score === 100) continue;
          detail[`${surface}.${key}`] = a;
          scores.push(a.score);
        }
        // Full agreement across peers still counts toward the score.
        for (const key of keys) {
          const observations = peers.map((o) => ({ page: o.url, value: o.anatomy?.[key] ? 'present' : 'absent' }));
          const a = crossPageAgreement({ observations });
          if (a.score === 100) scores.push(100);
        }
      }
      if (!scores.length) return { score: null, reason: 'needs at least two pages of the same type' };
      return { score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), detail };
    },
    findings(r) {
      if (r.score == null) return [];

      // Grouped by template, for the same reason as component drift: a PDP
      // missing reviews, breadcrumbs and recommendations on some pages is one
      // story about the template, not three.
      const bySurface = new Map();
      for (const [key, agreement] of Object.entries(r.detail || {})) {
        const [surface, part] = key.split('.');
        if (!bySurface.has(surface)) bySurface.set(surface, []);
        bySurface.get(surface).push({ part, agreement });
      }

      return [...bySurface.entries()].map(([surface, parts]) => {
        parts.sort((a, b) => a.agreement.score - b.agreement.score);
        const worstScore = parts[0].agreement.score;
        const pagesOff = new Set(parts.flatMap((p) => p.agreement.outliers.map((o) => o.page)));
        const names = parts.map((p) => humanProp(p.part).toLowerCase());

        return createFinding({
          checkId: `ux-anatomy-${surface}`, axis: 'ux', surface, scope: 'comparative',
          title: parts.length === 1
            ? `${names[0]} is present on some ${surface.toUpperCase()} pages and missing on others`
            : `${surface.toUpperCase()} pages are not one template — ${parts.length} parts vary across ${pagesOff.size} pages`,
          // One template to settle, not one fix per varying part.
          ...weigh(worstScore, {
            spread: 1,
            systemic: parts.length > 2,
            impactFloor: parts.length >= 3 ? 8 : 0,
          }),
          evidence: {
            surface,
            varyingParts: parts.map((p) => ({
              part: p.part,
              majority: p.agreement.consensus,
              agreement: p.agreement.agreement,
              pagesDiffering: p.agreement.outliers.map((o) => o.page),
            })),
            pagesCompared: parts[0].agreement.pages,
          },
          recommendation: `Decide what a ${surface.toUpperCase()} contains, then make every ${surface.toUpperCase()} that. Varying parts: ${list(names, 6)}. In Shopify these are template sections — a part that appears on two of four products is a section someone added by hand, and it will not survive the migration as-is.`,
        });
      }).sort((a, b) => b.priority - a.priority).slice(0, 5);
    },
  },

  {
    key: 'price-format', axis: 'ux', weight: 1, group: 'Language', scope: 'extractive',
    label: 'Price formatting',
    question: 'Is money written the same way everywhere?',
    measure(ctx) {
      const entries = foldTallies(ctx.observations.flatMap((o) =>
        (o.copy?.priceFormats || []).map((value) => ({ value, count: 1 }))));
      if (!entries.length) return { score: null, reason: 'no prices observed' };
      return vocabularyCoherence({ entries, ideal: 1, distance: exactDistance, tolerance: 0 });
    },
    findings(r, ctx) {
      if (r.score == null || r.tokens <= 1) return [];
      return [createFinding({
        checkId: 'ux-price-format-drift', axis: 'ux', surface: ctx.scopeSurface,
        scope: 'extractive',
        title: `Prices are formatted ${r.tokens} different ways`,
        ...weigh(r.score, { spread: r.tokens }),
        evidence: { formats: r.clusters },
        recommendation: 'Shopify formats money from one store setting. Multiple formats mean prices are being rendered by hand somewhere, which will break on migration.',
        refs: ['shopify/platform#money'],
      })];
    },
  },

  // ===== ENGINE =========================================================

  {
    key: 'app-footprint', axis: 'engine', weight: 3, group: 'Apps', scope: 'comparative',
    label: 'App and script footprint',
    question: 'Do the same third-party scripts load on every page?',
    measure(ctx) {
      const observations = ctx.observations.map((o) => ({
        page: o.url, value: [...(o.engine?.apps || [])].sort().join(','),
      })).filter((o) => o.value !== '');
      if (observations.length < 2) return { score: null, reason: 'needs more than one page' };
      return crossPageAgreement({ observations });
    },
    findings(r) {
      if (r.score == null || r.score === 100) return [];
      return [createFinding({
        checkId: 'engine-app-drift', axis: 'engine', surface: 'site', scope: 'comparative',
        title: `Third-party script set differs across ${r.outliers.length} of ${r.pages} pages`,
        ...weigh(r.score, { spread: r.outliers.length }),
        evidence: { consensus: r.consensus, variants: r.variants, outliers: r.outliers.slice(0, 10) },
        recommendation: 'Apps loading on pages that do not use them is pure weight. In Shopify, app embeds are global by default — decide per app whether it belongs everywhere, then gate the rest.',
        refs: ['shopify/platform#appEmbeds'],
      })];
    },
  },

  {
    key: 'perf-variance', axis: 'engine', weight: 2, group: 'Performance', scope: 'comparative',
    label: 'Performance variance',
    question: 'Do pages of the same type perform the same?',
    measure(ctx) {
      const samples = ctx.observations
        .filter((o) => Number.isFinite(o.engine?.vitals?.lcp))
        .map((o) => ({ page: o.url, lcp: o.engine.vitals.lcp }));
      if (samples.length < 2) return { score: null, reason: 'needs more than one page' };
      const values = samples.map((s) => s.lcp);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
      // Coefficient of variation: spread relative to the mean, so a slow-but-even
      // site is not punished for being slow here — that is a quality check, not
      // a consistency one.
      const cv = mean ? sd / mean : 0;
      return {
        score: Math.round(100 * Math.max(0, 1 - cv * 2)),
        mean: Math.round(mean), sd: Math.round(sd), cv,
        slowest: samples.sort((a, b) => b.lcp - a.lcp).slice(0, 5),
      };
    },
    findings(r) {
      if (r.score == null || r.score >= 80) return [];
      return [createFinding({
        checkId: 'engine-perf-variance', axis: 'engine', surface: 'site', scope: 'comparative',
        title: `LCP varies by ${pct(r.cv)} across pages (mean ${r.mean}ms)`,
        ...weigh(r.score, { spread: r.slowest.length }),
        evidence: { meanLcp: r.mean, stdDev: r.sd, coefficientOfVariation: r.cv, slowest: r.slowest },
        recommendation: 'Wide variance means some templates carry weight others do not. Find what the slow pages load that the fast ones skip — usually an app block or an unoptimised hero image.',
      })];
    },
  },

  {
    key: 'machine-parity', axis: 'engine', weight: 3, group: 'Machine parity', scope: 'extractive',
    label: 'Machine/human parity',
    question: 'Does the page tell a machine the same thing it tells a person?',
    measure(ctx) {
      // One observation per URL — both views live on the same page, and a
      // second viewport would only weight that page twice.
      const seen = new Set();
      const results = ctx.observations
        .filter((o) => !seen.has(o.url) && seen.add(o.url))
        .map(evaluateParity)
        .filter((r) => r.measurable);

      if (!results.length) {
        return { score: null, reason: 'needs the un-rendered HTML alongside the rendered page' };
      }
      const compared = results.reduce((n, r) => n + r.compared, 0);
      const agreed = results.reduce((n, r) => n + r.agreed, 0);
      return {
        score: Math.round((agreed / compared) * 100),
        compared, agreed, results,
      };
    },
    findings(r) {
      if (r.score == null) return [];

      // Group by WHICH FIELD disagrees, not by page. "Price disagrees on every
      // PDP" is one template fault; listing it per product buries it.
      const byField = new Map();
      for (const page of r.results) {
        for (const m of page.mismatches) {
          if (!byField.has(m.id)) byField.set(m.id, { field: m, pages: [] });
          byField.get(m.id).pages.push({ url: page.url, machine: m.machine, human: m.human });
        }
      }
      if (!byField.size) return [];

      const SEVERITY = { price: 9, availability: 9, name: 6, currency: 6, canonical: 5, title: 4 };

      return [...byField.entries()]
        .sort((a, b) => (SEVERITY[b[0]] || 3) - (SEVERITY[a[0]] || 3))
        .map(([id, { field, pages }]) => createFinding({
          checkId: `engine-parity-${id}`, axis: 'engine', surface: 'site',
          scope: 'extractive', basis: 'practice', url: pages[0].url,
          title: `${field.label} disagrees between the structured data and the rendered page on ${pages.length} page${pages.length === 1 ? '' : 's'}`,
          impact: SEVERITY[id] || 4,
          // Almost always one template emitting one value while another part
          // renders a different one — a single place to fix.
          effort: 7,
          evidence: {
            field: id,
            consequence: MISMATCH_CONSEQUENCE[id],
            examples: pages.slice(0, 6).map((p) => ({
              url: p.url, machineSees: p.machine, personSees: p.human,
            })),
            pagesAffected: pages.length,
            method: 'The structured payload a crawler receives, compared field for field against the rendered page. Both sides are individually valid — the defect only exists in the relationship, which is why no structured-data validator reports it.',
          },
          recommendation: id === 'price' || id === 'availability'
            ? `Emit ${id} from the same source the template renders from. Two sources drift the moment one changes, and this is the pair where drift is quoted back to a customer as fact.`
            : `Bind ${field.label.toLowerCase()} in the markup to the same value the page renders, rather than maintaining it separately.`,
        }));
    },
  },

  {
    key: 'structured-data-coverage', axis: 'engine', weight: 3, group: 'Structured data', scope: 'comparative',
    label: 'Structured data coverage',
    question: 'Do pages of the same type carry the same structured data?',
    measure(ctx) {
      const scores = [], detail = {};
      const surfaces = [...new Set(ctx.observations.map((o) => o.surface))];

      for (const surface of surfaces) {
        // One observation per URL: markup is identical at every viewport, so a
        // two-viewport run would otherwise count each page twice.
        const seen = new Set();
        const peers = ctx.observations
          .filter((o) => o.surface === surface && o.retrieval)
          .filter((o) => !seen.has(o.url) && seen.add(o.url));
        if (peers.length < 2) continue;

        const observations = peers.map((o) => ({
          page: o.url,
          value: [...new Set(o.retrieval.jsonLdTypes || [])].sort().join(',') || '(none)',
        }));
        const a = crossPageAgreement({ observations });
        if (a.score == null) continue;
        detail[surface] = a;
        scores.push(a.score);
      }
      if (!scores.length) return { score: null, reason: 'needs at least two pages of the same type' };
      return { score: Math.round(scores.reduce((x, y) => x + y, 0) / scores.length), detail };
    },
    findings(r) {
      if (r.score == null) return [];
      return Object.entries(r.detail || {})
        .filter(([, a]) => a.score < 100)
        .map(([surface, a]) => createFinding({
          checkId: `engine-schema-drift-${surface}`, axis: 'engine', surface,
          scope: 'comparative', basis: 'practice',
          title: `${surface.toUpperCase()} pages carry ${a.variants.length} different sets of structured data`,
          ...weigh(a.score, { spread: 1, systemic: true, impactFloor: a.variants.length > 2 ? 8 : 0 }),
          evidence: {
            surface, consensus: a.consensus, variants: a.variants,
            pagesDiffering: a.outliers.slice(0, 10),
            why: 'Answer engines match on structured data. A Product schema on three of five product pages means two of them are invisible to that matching while looking identical to a person.',
          },
          recommendation: `Emit the same schema from the ${surface.toUpperCase()} template rather than per page. In Shopify this belongs in the template or a shared snippet — divergence here usually means someone pasted JSON-LD into one page by hand.`,
        }));
    },
  },

  {
    key: 'metadata-completeness', axis: 'engine', weight: 2, group: 'Retrieval', scope: 'comparative',
    label: 'Metadata completeness',
    question: 'Does every page of a type carry the same metadata fields?',
    measure(ctx) {
      const seen = new Set();
      const pages = ctx.observations
        .filter((o) => o.retrieval)
        .filter((o) => !seen.has(o.url) && seen.add(o.url));
      if (pages.length < 2) return { score: null, reason: 'needs more than one page' };

      const fields = ['title', 'metaDescription', 'canonical', 'ogTitle', 'ogImage'];
      const scores = [], detail = {};
      for (const field of fields) {
        const observations = pages.map((o) => ({
          page: o.url,
          value: o.retrieval[field] ? 'present' : 'absent',
        }));
        const a = crossPageAgreement({ observations });
        if (a.score == null) continue;
        // Everything present everywhere is the good case and still scores.
        if (a.score < 100) detail[field] = a;
        scores.push(a.score);
      }
      if (!scores.length) return { score: null, reason: 'no metadata observed' };
      return { score: Math.round(scores.reduce((x, y) => x + y, 0) / scores.length), detail };
    },
    findings(r, ctx) {
      if (r.score == null || !Object.keys(r.detail || {}).length) return [];
      const fields = Object.entries(r.detail);
      const worst = fields.sort((a, b) => a[1].score - b[1].score)[0];
      return [createFinding({
        checkId: 'engine-metadata-drift', axis: 'engine', surface: ctx.scopeSurface,
        scope: 'comparative', basis: 'practice',
        title: `${fields.length} metadata field${fields.length === 1 ? '' : 's'} present on some pages and missing on others`,
        ...weigh(worst[1].score, { spread: 1, systemic: fields.length > 2 }),
        evidence: {
          fields: fields.map(([name, a]) => ({
            field: name, majority: a.consensus, agreement: a.agreement,
            pagesMissing: a.outliers.filter((o) => o.value === 'absent').map((o) => o.page).slice(0, 6),
          })),
        },
        recommendation: 'Metadata should come from the template, never from per-page entry. A field that is present on most pages and absent on a few is the signature of hand-editing, and it is the pages nobody remembered to edit that get skipped by retrieval.',
      })];
    },
  },

  {
    key: 'section-reuse', axis: 'engine', weight: 2, group: 'Theme', scope: 'extractive',
    label: 'Section reuse',
    question: 'Is the same job done by one section type, or several?',
    measure(ctx) {
      const entries = foldTallies(ctx.observations.flatMap((o) =>
        (o.engine?.sections || []).map((value) => ({ value, count: 1 }))));
      if (!entries.length) return { score: null, reason: 'no sections detected' };
      // A healthy theme reuses a modest set of section types across templates.
      return vocabularyCoherence({
        entries, ideal: 18, distance: exactDistance, tolerance: 0,
      });
    },
    findings(r, ctx) {
      if (r.score == null || r.tokens <= 18) return [];
      return [createFinding({
        checkId: 'engine-section-sprawl', axis: 'engine', surface: ctx.scopeSurface,
        scope: 'extractive',
        title: `${r.tokens} distinct section types — most themes ship about 18`,
        ...weigh(r.score, { spread: r.tokens - 18 }),
        evidence: { sections: r.clusters.slice(0, 25) },
        recommendation: 'Look for sections that do the same job under different names. Each one is a file to maintain and a choice the merchant has to make in the theme editor.',
        refs: ['shopify/sections'],
      })];
    },
  },
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Sum counts for repeated values across merged lists. */
function foldTallies(entries) {
  const m = new Map();
  for (const { value, count } of entries) m.set(value, (m.get(value) || 0) + count);
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

/** "Inter", -apple-system, sans-serif  ->  Inter */
function primaryFamily(stack) {
  return String(stack).split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
}

/** "  ADD TO CART  " and "Add to cart" are the same intent, differently shouted. */
function normalizeLabel(label) {
  return String(label).trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!•]+$/, '');
}

const ROLE_WORDS = {
  primaryButton: 'Primary button', secondaryButton: 'Secondary button', header: 'Header',
  footer: 'Footer', productCard: 'Product card', bodyText: 'Body text', h1: 'Page heading',
  link: 'Link', input: 'Form input', priceLabel: 'Price',
};
const humanRole = (r) => ROLE_WORDS[r] || r;
const humanProp = (p) => String(p)
  .replace(/([A-Z])/g, ' $1')
  .replace(/^./, (c) => c.toUpperCase())
  .trim()
  .toLowerCase()
  .replace(/^./, (c) => c.toUpperCase());

/**
 * @typedef {object} Dimension
 * @property {string} key
 * @property {'design'|'ux'|'engine'} axis
 * @property {number} weight
 * @property {'extractive'|'comparative'} scope
 * @property {string} label
 * @property {string} question
 * @property {(ctx:any)=>any} measure
 * @property {(result:any, ctx:any)=>any[]} findings
 */
