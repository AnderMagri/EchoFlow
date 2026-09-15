/**
 * The consistency engine — EchoFlow 2.0's north star, and its measuring instrument.
 *
 * Consistency is not one check among many. It is the question the whole product
 * answers: *how far is this site from a clean system?* So it is not implemented
 * per-axis. It is implemented as three general primitives that Design, UX and
 * Engine all reuse, which is what lets a single number mean the same thing
 * whether it came from a colour ramp, a CTA verb, or a third-party script.
 *
 *   1. vocabularyCoherence — given every value used for one property, how close
 *      is that to a *designed* set? Measures leakage (values that should have
 *      collapsed into one token) and sprawl (more tokens than a system needs).
 *      Extractive: works on a single page.
 *
 *   2. crossPageAgreement — given one role that should be invariant, do the pages
 *      agree? Measures drift and names the pages that break rank.
 *      Comparative: meaningless without the whole site.
 *
 *   3. rhythmAdherence — given numeric values that should sit on a scale, what
 *      fraction actually do? Detects the base unit rather than assuming 8px.
 *      Extractive.
 *
 * Every primitive returns a 0-100 score AND the evidence behind it, because a
 * score with no evidence is the thing v1 got wrong.
 *
 * @module core/consistency
 */

import { deltaE, isNeutral, parseColor, toHex } from './color.js';

// ---------------------------------------------------------------------------
// Generic clustering
// ---------------------------------------------------------------------------

/**
 * Greedy agglomerative clustering by a distance function. Values are visited
 * most-used first, so the dominant value anchors its cluster and the strays fall
 * in around it — which is what makes the leader meaningful as "the real token".
 *
 * @template T
 * @param {{value:T, count:number}[]} entries
 * @param {(a:T,b:T)=>number} distance
 * @param {number} tolerance values closer than this are the same token
 */
export function cluster(entries, distance, tolerance) {
  const sorted = [...entries].sort((a, b) => b.count - a.count);
  /** @type {{leader:T, members:{value:T,count:number}[], count:number}[]} */
  const clusters = [];

  for (const entry of sorted) {
    let best = null, bestD = Infinity;
    for (const c of clusters) {
      const d = distance(c.leader, entry.value);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best && bestD <= tolerance) {
      best.members.push(entry);
      best.count += entry.count;
    } else {
      clusters.push({ leader: entry.value, members: [entry], count: entry.count });
    }
  }
  return clusters.sort((a, b) => b.count - a.count);
}

const LEAK_WEIGHT = 0.6;   // how hard near-duplicates hurt
const SPRAWL_DECAY = 0.35; // how hard going over the token budget hurts

/**
 * PRIMITIVE 1 — vocabulary coherence.
 *
 * @template T
 * @param {object} opts
 * @param {{value:T,count:number}[]} opts.entries every distinct value + how often used
 * @param {number} opts.ideal how many tokens a designed system would have here
 * @param {(a:T,b:T)=>number} opts.distance
 * @param {number} opts.tolerance
 * @param {(v:T)=>string} [opts.format] for human-readable evidence
 * @returns {{score:number, distinct:number, tokens:number, leakage:number,
 *            nearDuplicates:object[], clusters:object[]}}
 */
export function vocabularyCoherence({ entries, ideal, distance, tolerance, format = String }) {
  const distinct = entries.length;
  if (!distinct) return { score: 100, distinct: 0, tokens: 0, leakage: 0, nearDuplicates: [], clusters: [] };

  const clusters = cluster(entries, distance, tolerance);
  const tokens = clusters.length;

  // Leakage: values that should have collapsed into an existing token but didn't.
  const leakage = distinct - tokens;
  const leakRatio = leakage / distinct;

  // Sprawl: tokens beyond what a system of this kind needs.
  const sprawlRatio = Math.max(0, tokens - ideal) / Math.max(1, ideal);

  const score = Math.round(
    100 * Math.max(0, 1 - LEAK_WEIGHT * leakRatio) * Math.exp(-SPRAWL_DECAY * sprawlRatio)
  );

  // The named offenders: clusters where several values are pretending to be
  // different tokens. Sorted by how much traffic the strays carry, because that
  // is what the fix costs.
  const nearDuplicates = clusters
    .filter((c) => c.members.length > 1)
    .map((c) => ({
      token: format(c.leader),
      variants: c.members.slice(1).map((m) => ({ value: format(m.value), uses: m.count })),
      strayUses: c.members.slice(1).reduce((s, m) => s + m.count, 0),
      totalUses: c.count,
    }))
    .sort((a, b) => b.strayUses - a.strayUses);

  return {
    score, distinct, tokens, leakage, nearDuplicates,
    clusters: clusters.map((c) => ({ token: format(c.leader), uses: c.count, variants: c.members.length })),
  };
}

/**
 * PRIMITIVE 2 — cross-page agreement.
 *
 * This is the comparative measure. It is the one that cannot run on a single
 * page, and the one that carries most of the value of a whole-site run: not
 * "page N has a problem" but "these pages disagree with each other".
 *
 * @param {object} opts
 * @param {{page:string, value:any}[]} opts.observations one per page
 * @param {(a:any,b:any)=>number} [opts.distance]
 * @param {number} [opts.tolerance]
 * @param {(v:any)=>string} [opts.format]
 * @returns {{score:number, pages:number, consensus:string|null, agreement:number,
 *            outliers:{page:string,value:string}[], variants:object[]}}
 */
export function crossPageAgreement({ observations, distance, tolerance = 0, format = String }) {
  const seen = observations.filter((o) => o.value != null && o.value !== '');
  const pages = seen.length;
  if (pages < 2) {
    // Not an error, just not measurable. Say so rather than inventing a score.
    return { score: null, pages, consensus: null, agreement: null, outliers: [], variants: [] };
  }

  // Group observations into variants.
  /** @type {{value:any, pages:string[]}[]} */
  const variants = [];
  for (const obs of seen) {
    const match = variants.find((v) =>
      distance ? distance(v.value, obs.value) <= tolerance : format(v.value) === format(obs.value));
    if (match) match.pages.push(obs.page);
    else variants.push({ value: obs.value, pages: [obs.page] });
  }
  variants.sort((a, b) => b.pages.length - a.pages.length);

  const consensusVariant = variants[0];
  const agreement = consensusVariant.pages.length / pages;

  const outliers = variants.slice(1).flatMap((v) =>
    v.pages.map((page) => ({ page, value: format(v.value) })));

  return {
    score: Math.round(100 * agreement),
    pages,
    consensus: format(consensusVariant.value),
    agreement,
    outliers,
    variants: variants.map((v) => ({ value: format(v.value), pages: v.pages.length, examples: v.pages.slice(0, 5) })),
  };
}

/**
 * PRIMITIVE 3 — rhythm adherence.
 *
 * Spacing systems are multiples of a base unit. We do not assume 8px: we detect
 * the base the site actually uses, then measure how much of the site honours it.
 * A site on a 5px base that honours it is consistent; a site on an 8px base with
 * 30% strays is not, and the strays are the finding.
 *
 * @param {{value:number,count:number}[]} entries
 * @param {number[]} [candidates]
 */
export function rhythmAdherence(entries, candidates = [8, 4, 6, 5, 10, 3, 2]) {
  const usable = entries.filter((e) => e.value > 0);
  const totalUses = usable.reduce((s, e) => s + e.count, 0);
  if (!totalUses) return { score: 100, base: null, adherence: 1, strays: [] };

  const fits = (v, base) => Math.abs(v - Math.round(v / base) * base) <= 0.51;

  let base = null, bestWeight = -1;
  for (const c of candidates) {
    const weight = usable.reduce((s, e) => s + (fits(e.value, c) ? e.count : 0), 0)
      // Prefer the largest base that still explains the data: a 2px base
      // "explains" every even number and tells you nothing.
      * (1 + c / 100);
    if (weight > bestWeight) { bestWeight = weight; base = c; }
  }

  const onScale = usable.filter((e) => fits(e.value, base));
  const strayEntries = usable.filter((e) => !fits(e.value, base));
  const adherence = onScale.reduce((s, e) => s + e.count, 0) / totalUses;

  return {
    score: Math.round(100 * adherence),
    base,
    adherence,
    strays: strayEntries
      .sort((a, b) => b.count - a.count)
      .map((e) => ({ value: e.value, uses: e.count, nearest: Math.round(e.value / base) * base })),
  };
}

// ---------------------------------------------------------------------------
// Distance functions + tolerances, per property type
// ---------------------------------------------------------------------------

/** Perceptual colour distance. Below the JND, two hexes are one token. */
export const colorDistance = (a, b) => {
  const ca = typeof a === 'string' ? parseColor(a) : a;
  const cb = typeof b === 'string' ? parseColor(b) : b;
  if (!ca || !cb) return Infinity;
  return deltaE(ca, cb);
};

/** Relative distance, so 15px vs 16px counts as close but 60px vs 64px counts as closer still. */
export const ratioDistance = (a, b) => {
  const x = Number(a), y = Number(b);
  if (!x || !y) return Math.abs(x - y);
  return Math.abs(Math.log2(x / y)) * 100;
};

export const numericDistance = (a, b) => Math.abs(Number(a) - Number(b));
export const exactDistance = (a, b) => (String(a) === String(b) ? 0 : Infinity);

/**
 * The token budget a clean Shopify theme actually needs. These are the ceilings
 * a Dawn-derived system lands on when it is behaving; going over is the signal.
 */
export const TOKEN_BUDGETS = {
  colorChromatic: 8,   // brand + accents + semantic states
  colorNeutral: 10,    // a grey ramp is allowed to be long
  fontSize: 9,         // a modular scale with display sizes
  fontFamily: 2,       // heading + body. Three is already a smell.
  fontWeight: 4,
  lineHeight: 5,
  letterSpacing: 4,
  borderRadius: 4,     // none / sm / md / pill
  shadow: 5,
  spacing: 10,
  transition: 4,
  zIndex: 6,
};

/** Tolerances: below these, two values are the same token wearing two hats. */
/**
 * Tolerances: below these, two values are the same token wearing two hats.
 *
 * Colour needs TWO thresholds, and calibration data is why. Measured against
 * real pairs:
 *
 *   #e63946 -> #e5393f   dE 3.71   a brand red forked by a typo      ACCIDENT
 *   #457b9d -> #4a7fa0   dE 1.71   a blue forked by a hand-pick      ACCIDENT
 *   #ffffff -> #f8f9fa   dE 2.21   card on page background          INTENTIONAL
 *   #f8f9fa -> #f1f3f5   dE 2.22   two surface tints                INTENTIONAL
 *   #000000 -> #111111   dE 5.06   near-black for type              INTENTIONAL
 *   #333333 -> #353535   dE 0.91   a grey that leaked               ACCIDENT
 *
 * The accidental chromatic forks sit ABOVE the intentional neutral steps, so a
 * single threshold must either merge deliberate surface tints or miss real
 * forks. Chromatic palettes are designed to be well-separated, so anything
 * close is a mistake -> wide tolerance. Neutral ramps use small deliberate
 * steps for elevation -> narrow tolerance.
 */
export const TOLERANCES = {
  colorChromatic: 4.0, // brand colours this close were not both chosen on purpose
  colorNeutral: 1.2,   // deliberate surface steps live at dE ~2; only merge below that
  fontSizeRatio: 4,    // ~3% apart => same step
  spacing: 1.01,       // 1px apart => same step
  radius: 1.01,
  generic: 0,
};

// ---------------------------------------------------------------------------
// Aggregation — the single number, and the only one
// ---------------------------------------------------------------------------

/**
 * Roll dimension scores into one Consistency Score.
 *
 * Unmeasurable dimensions (score === null — e.g. a comparative dimension in a
 * single-page run) are *excluded*, never defaulted to 100. Awarding credit for
 * something you did not measure is how a score stops meaning anything.
 *
 * @param {{key:string, axis:string, score:number|null, weight:number}[]} dimensions
 */
export function aggregate(dimensions) {
  const measured = dimensions.filter((d) => typeof d.score === 'number');
  const byAxis = {};

  for (const axis of ['design', 'ux', 'engine']) {
    const inAxis = measured.filter((d) => d.axis === axis);
    const w = inAxis.reduce((s, d) => s + d.weight, 0);
    byAxis[axis] = w
      ? Math.round(inAxis.reduce((s, d) => s + d.score * d.weight, 0) / w)
      : null;
  }

  const totalWeight = measured.reduce((s, d) => s + d.weight, 0);
  const declaredWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const overall = totalWeight
    ? Math.round(measured.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight)
    : null;

  // Coverage: how much of the intended measurement actually happened. A score
  // built on a third of the dimensions is not wrong, but it is not entitled to
  // sound as certain as one built on all of them — and the dimensions that go
  // missing are systematically the comparative ones, which are exactly the ones
  // that detect inconsistency. So low coverage biases the score UPWARD, and
  // saying so is the difference between a measurement and a flattering guess.
  const coverage = declaredWeight ? totalWeight / declaredWeight : 0;

  return {
    overall,
    byAxis,
    grade: grade(overall),
    coverage,
    confidence: confidenceOf(coverage),
    provisional: coverage < 0.7,
    measured: measured.length,
    declared: dimensions.length,
    skipped: dimensions.filter((d) => d.score == null).map((d) => d.key),
    dimensions,
  };
}

/** @param {number} coverage 0..1 */
export function confidenceOf(coverage) {
  if (coverage >= 0.9) return 'high';
  if (coverage >= 0.7) return 'moderate';
  if (coverage >= 0.4) return 'low';
  return 'indicative only';
}

/**
 * The caveat that has to travel with a provisional score. Written to be shown,
 * not buried: the failure mode is a client reading "systematic" off a run that
 * never looked at two pages of the same type.
 * @param {{coverage:number, skipped:string[]}} c
 */
export function provisionalNote(c) {
  const pct = Math.round(c.coverage * 100);
  return `Only ${pct}% of the intended measurement ran (${c.measured} of ${c.declared} dimensions). `
    + `The dimensions that did not run are mostly comparative ones, which are the checks that find inconsistency — `
    + `so this score is more likely to be too generous than too harsh. Treat it as provisional until more pages of the same type are analysed.`;
}

/** @param {number|null} score */
export function grade(score) {
  if (score == null) return 'unmeasured';
  if (score >= 85) return 'systematic';   // there is a design system and it is obeyed
  if (score >= 70) return 'mostly-held';  // a system exists, with drift at the edges
  if (score >= 50) return 'drifting';     // intentions visible, discipline gone
  if (score >= 30) return 'ad-hoc';       // decisions made per-page
  return 'no-system';                     // every screen invented from scratch
}

export const GRADE_COPY = {
  systematic: 'A design system exists and the site obeys it. Migration is mostly transcription.',
  'mostly-held': 'A system is visible, with drift at the edges. Tighten before rebuilding, not after.',
  drifting: 'The intentions are legible but the discipline is gone. Rebuilding will surface conflicts.',
  'ad-hoc': 'Decisions were made page by page. There is no system to port — one has to be chosen.',
  'no-system': 'Every screen was invented from scratch. Treat the rebuild as a design project.',
  unmeasured: 'Not enough was measured to judge consistency.',
};

/**
 * Colours split into two populations, each with its own budget AND its own
 * tolerance. A long grey ramp is fine; a long brand ramp is not. A grey two
 * shades off is a leak; a brand colour two shades off is a fork.
 */
export function splitColorEntries(entries) {
  const chromatic = [], neutral = [];
  for (const e of entries) {
    const c = typeof e.value === 'string' ? parseColor(e.value) : e.value;
    if (!c || c.a === 0) continue;
    (isNeutral(c) ? neutral : chromatic).push({ ...e, value: toHex(c) });
  }
  return { chromatic, neutral };
}

/**
 * Measure a colour population with the right budget and tolerance for its kind.
 * @param {{value:string,count:number}[]} entries
 * @param {'chromatic'|'neutral'} kind
 */
export function colorCoherence(entries, kind) {
  return vocabularyCoherence({
    entries,
    ideal: kind === 'neutral' ? TOKEN_BUDGETS.colorNeutral : TOKEN_BUDGETS.colorChromatic,
    distance: colorDistance,
    tolerance: kind === 'neutral' ? TOLERANCES.colorNeutral : TOLERANCES.colorChromatic,
  });
}
