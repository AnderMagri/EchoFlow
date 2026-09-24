/**
 * The design system seed.
 *
 * This is the thing that makes the audit the mouth of a pipeline instead of a
 * dead end. The Design axis already had to cluster every value on the site to
 * measure coherence; the clusters ARE the design system the site is implicitly
 * running. So we emit them as something you can build with, in the formats the
 * next step actually consumes.
 *
 * The consistency score says how far the site is from a system. This file hands
 * you the system it was reaching for.
 *
 * @module core/tokens
 */

import { contrastRatio, parseColor, toHex, chroma } from './color.js';
import {
  cluster, colorDistance, exactDistance, numericDistance, ratioDistance,
  rhythmAdherence, splitColorEntries, TOLERANCES,
} from './consistency.js';
import { mergeTallies, numericTallies } from './observation.js';

/**
 * @param {import('./observation.js').PageObservation[]} observations
 */
export function buildTokenSeed(observations) {
  const colorEntries = ['colorText', 'colorBackground', 'colorBorder']
    .flatMap((k) => mergeTallies(observations, k));
  const folded = fold(colorEntries);
  const { chromatic, neutral } = splitColorEntries(folded);

  const color = buildColors(chromatic, neutral, observations);
  const typography = buildTypography(observations);
  const spacing = buildSpacing(observations);
  const radius = buildScale(observations, 'borderRadius', TOLERANCES.radius, numericDistance, 'radius');
  const shadow = buildShadows(observations);

  const seed = { color, typography, spacing, radius, shadow };
  return {
    ...seed,
    formats: {
      css: toCSS(seed),
      dtcg: toDTCG(seed),
      tailwind: toTailwind(seed),
      shopify: toShopifySettings(seed),
    },
  };
}

// --- colour ----------------------------------------------------------------

function buildColors(chromatic, neutral, observations) {
  const chromaClusters = cluster(chromatic, colorDistance, TOLERANCES.colorChromatic);
  const neutralClusters = cluster(neutral, colorDistance, TOLERANCES.colorNeutral);

  // Neutrals sorted light -> dark become a usable ramp. This ordering is the
  // whole value: an unordered list of greys is what the site already has.
  const ramp = neutralClusters
    .map((c) => ({ hex: c.leader, uses: c.count, l: lightnessOf(c.leader) }))
    .sort((a, b) => b.l - a.l);

  const surface = ramp[0]?.hex || '#ffffff';
  const ink = ramp[ramp.length - 1]?.hex || '#000000';

  /**
   * The primary is whatever the site spends on its MAIN ACTION — including
   * black.
   *
   * This used to require the button to be chromatic (`chroma > 6`), and fell
   * back to the most-used chromatic colour when it was not. On a black-branded
   * store that is catastrophic: the black button is discarded for "not being a
   * colour", and the winner by frequency is the sale badge. Reported from a
   * real storefront whose logo and buttons are black and which was told its
   * brand colour was red.
   *
   * A monochrome brand is not a missing brand. Reading the action is the
   * measurement; the chroma test was an assumption laid over it.
   */
  const buttonBg = mostCommon(observations
    .map((o) => o.roles?.primaryButton?.background)
    .map((c) => {
      const parsed = c ? parseColor(c) : null;
      // A transparent or ghost button says nothing about a brand colour.
      return parsed && parsed.a !== 0 ? toHex(parsed) : null;
    })
    .filter(Boolean));

  // A button the same colour as the page is an outlined button: it is the
  // page surface showing through, not a choice about brand.
  const actionColor = buttonBg && buttonBg !== surface ? buttonBg : null;

  const primary = actionColor || chromaClusters[0]?.leader || null;
  const primarySource = actionColor ? 'action' : primary ? 'frequency' : null;

  const accents = chromaClusters
    .map((c) => c.leader)
    .filter((c) => c !== primary)
    .slice(0, 5);

  return {
    primary,
    // How the primary was decided, and whether it is a neutral. Without this
    // the UI cannot tell "the brand is black" from "we could not find one",
    // and would go on implying every brand has a hue.
    primarySource,
    primaryIsNeutral: primary ? chroma(parseColor(primary)) <= 6 : false,
    accents,
    neutral: ramp.map((r, i) => ({ name: rampName(i, ramp.length), hex: r.hex, uses: r.uses })),
    semantic: { surface, ink },
    // Flag pairs that will fail once someone uses them together. Cheap to
    // compute here because we already have every colour in hand.
    contrastWarnings: contrastWarnings(primary, surface, ink),
  };
}

/** The value seen most often; ties go to the first, which is page order. */
function mostCommon(values) {
  if (!values.length) return null;
  const tally = new Map();
  for (const v of values) tally.set(v, (tally.get(v) || 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function contrastWarnings(primary, surface, ink) {
  const warn = [];
  const p = parseColor(primary), s = parseColor(surface), k = parseColor(ink);
  if (p && s) {
    const r = contrastRatio(p, s);
    if (r < 4.5) warn.push({ pair: `${primary} on ${surface}`, ratio: +r.toFixed(2), required: 4.5,
      note: 'Primary colour fails AA as text on the main surface. Safe as a button fill with white text, not as a link colour.' });
  }
  if (k && s) {
    const r = contrastRatio(k, s);
    if (r < 4.5) warn.push({ pair: `${ink} on ${surface}`, ratio: +r.toFixed(2), required: 4.5,
      note: 'Body text fails AA on the main surface.' });
  }
  return warn;
}

const lightnessOf = (hex) => {
  const c = parseColor(hex);
  return c ? (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) : 0;
};

function rampName(i, total) {
  if (total <= 2) return i === 0 ? 'surface' : 'ink';
  const names = ['surface', 'surface-raised', 'border-subtle', 'border', 'text-muted', 'text', 'ink'];
  const idx = Math.round((i / (total - 1)) * (names.length - 1));
  return names[idx];
}

// --- typography ------------------------------------------------------------

function buildTypography(observations) {
  const sizes = cluster(
    numericTallies(mergeTallies(observations, 'fontSize')),
    ratioDistance, TOLERANCES.fontSizeRatio
  ).map((c) => ({ px: round(c.leader), uses: c.count })).sort((a, b) => a.px - b.px);

  const families = cluster(
    fold(mergeTallies(observations, 'fontFamily').map((t) => ({ value: t.value, count: t.count }))),
    exactDistance, 0
  ).map((c) => ({ stack: c.leader, uses: c.count }));

  const weights = cluster(
    numericTallies(mergeTallies(observations, 'fontWeight')), numericDistance, 0
  ).map((c) => ({ weight: c.leader, uses: c.count })).sort((a, b) => a.weight - b.weight);

  // Name the steps relative to the body size — the most-used size is the body
  // size, near enough always, and naming off it survives a site with a 15px body.
  const bodyPx = [...sizes].sort((a, b) => b.uses - a.uses)[0]?.px || 16;
  const scale = nameScale(sizes, bodyPx);

  const heading = families[0]?.stack || null;
  const body = families[1]?.stack || families[0]?.stack || null;

  return {
    families: { heading, body, all: families },
    scale,
    weights,
    bodyPx,
    ratio: detectRatio(sizes.map((s) => s.px)),
  };
}

/**
 * Name every step, uniquely.
 *
 * Naming by size ratio alone collides: on a site with 30px and 32px headings
 * both land in the same band and the scale comes out with two steps called
 * "2xl". A token set with duplicate names is not a token set — you cannot
 * reference either one — so names are assigned by RANK outward from the body
 * size instead, which is unique by construction and still carries the meaning.
 *
 * @param {{px:number,uses:number}[]} sizes ascending
 * @param {number} bodyPx
 */
function nameScale(sizes, bodyPx) {
  const asc = [...sizes].sort((a, b) => a.px - b.px);
  // The step closest to the body size is "base"; everything else is measured
  // from it in steps, not in ratios.
  let baseIdx = 0, bestGap = Infinity;
  asc.forEach((s, i) => {
    const gap = Math.abs(s.px - bodyPx);
    if (gap < bestGap) { bestGap = gap; baseIdx = i; }
  });

  const DOWN = ['sm', 'xs', '2xs', '3xs', '4xs', '5xs'];
  const UP = ['lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl'];

  // Past a certain size a t-shirt scale stops describing anything. Running out
  // of names and continuing "…7xl, xl-9, xl-10" implies a semantic ladder that
  // is not there — the honest reading of 19 distinct sizes is that the site has
  // no scale, so number them and let the sprawl finding say the rest.
  if (asc.length > DOWN.length + UP.length) {
    const width = String(asc.length).length;
    return asc.map((s, i) => ({ ...s, name: `size-${String(i + 1).padStart(width, '0')}` }));
  }

  return asc.map((s, i) => {
    const d = i - baseIdx;
    return { ...s, name: d === 0 ? 'base' : d < 0 ? DOWN[-d - 1] : UP[d - 1] };
  });
}

/** The median step ratio — tells you whether a modular scale was ever intended. */
function detectRatio(pxs) {
  const sorted = [...new Set(pxs)].sort((a, b) => a - b);
  if (sorted.length < 3) return null;
  const ratios = sorted.slice(1).map((v, i) => v / sorted[i]).filter((r) => r > 1.01);
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  return +ratios[Math.floor(ratios.length / 2)].toFixed(3);
}

// --- spacing / radius / shadow ---------------------------------------------

function buildSpacing(observations) {
  // Values under 4px are hairlines, icon nudges and border compensation — not
  // spacing decisions. Including them produced advice like "snap 1px to 0px",
  // which is not a fix, and dragged adherence down for no reason.
  const MIN_SPACING = 4;
  const entries = numericTallies(mergeTallies(observations, 'spacing'))
    .filter((e) => e.value >= MIN_SPACING);

  const rhythm = rhythmAdherence(entries);
  const base = rhythm.base || 8;
  const steps = [...new Set(entries
    .filter((e) => Math.abs(e.value - Math.round(e.value / base) * base) <= 0.51)
    .map((e) => Math.round(e.value)))].sort((a, b) => a - b).slice(0, 12);

  return {
    base,
    steps,
    adherence: rhythm.adherence,
    // Round for display, and never propose snapping to zero — the nearest
    // MEANINGFUL step is at least one base unit.
    strays: rhythm.strays.slice(0, 10).map((s) => ({
      value: Math.round(s.value * 10) / 10,
      uses: s.uses,
      nearest: Math.max(base, Math.round(s.value / base) * base),
    })),
    ignoredBelow: MIN_SPACING,
  };
}

function buildScale(observations, key, tolerance, distance, label) {
  const entries = numericTallies(mergeTallies(observations, key)).filter((e) => e.value > 0);
  const clusters = cluster(entries, distance, tolerance);
  return {
    steps: clusters.map((c) => ({ px: round(c.leader), uses: c.count }))
      .sort((a, b) => a.px - b.px).slice(0, 8),
    label,
  };
}

function buildShadows(observations) {
  const clusters = cluster(mergeTallies(observations, 'shadow'), exactDistance, 0);
  return {
    steps: clusters.slice(0, 6).map((c, i) => ({
      name: ['raised', 'card', 'overlay', 'modal', 'popover', 'extra'][i] || `shadow-${i}`,
      value: c.leader, uses: c.count,
    })),
  };
}

// --- output formats --------------------------------------------------------

function toCSS(seed) {
  const L = [':root {'];
  if (seed.color.primary) L.push(`  --color-primary: ${seed.color.primary};`);
  seed.color.accents.forEach((c, i) => L.push(`  --color-accent-${i + 1}: ${c};`));
  seed.color.neutral.forEach((n) => L.push(`  --color-${n.name}: ${n.hex};`));
  L.push('');
  if (seed.typography.families.heading) L.push(`  --font-heading: ${seed.typography.families.heading};`);
  if (seed.typography.families.body) L.push(`  --font-body: ${seed.typography.families.body};`);
  seed.typography.scale.forEach((s) => L.push(`  --text-${s.name}: ${s.px}px;`));
  seed.typography.weights.forEach((w) => L.push(`  --weight-${w.weight}: ${w.weight};`));
  L.push('');
  L.push(`  --space-unit: ${seed.spacing.base}px;`);
  seed.spacing.steps.forEach((s) => L.push(`  --space-${s / seed.spacing.base}: ${s}px;`));
  seed.radius.steps.forEach((r, i) => L.push(`  --radius-${['sm', 'md', 'lg', 'xl', 'pill'][i] || i}: ${r.px}px;`));
  seed.shadow.steps.forEach((s) => L.push(`  --shadow-${s.name}: ${s.value};`));
  L.push('}');
  // Dedupe: a scale with two steps at the same name would emit a duplicate line.
  return [...new Set(L)].join('\n');
}

/** W3C Design Tokens Community Group format — what Figma/Style Dictionary read. */
function toDTCG(seed) {
  const color = {};
  if (seed.color.primary) color.primary = { $type: 'color', $value: seed.color.primary };
  seed.color.accents.forEach((c, i) => { color[`accent-${i + 1}`] = { $type: 'color', $value: c }; });
  seed.color.neutral.forEach((n) => { color[n.name] = { $type: 'color', $value: n.hex }; });

  const fontSize = {};
  seed.typography.scale.forEach((s) => { fontSize[s.name] = { $type: 'dimension', $value: `${s.px}px` }; });

  const space = {};
  seed.spacing.steps.forEach((s) => { space[String(s / seed.spacing.base)] = { $type: 'dimension', $value: `${s}px` }; });

  const radius = {};
  seed.radius.steps.forEach((r, i) => {
    radius[['sm', 'md', 'lg', 'xl', 'pill'][i] || `r${i}`] = { $type: 'dimension', $value: `${r.px}px` };
  });

  return {
    $description: 'Design tokens reverse-engineered from the live site by EchoFlow. A starting point for the rebuild, not a finished system.',
    color, fontSize, space, radius,
  };
}

function toTailwind(seed) {
  const colors = { primary: seed.color.primary };
  seed.color.neutral.forEach((n) => { colors[n.name] = n.hex; });
  seed.color.accents.forEach((c, i) => { colors[`accent${i + 1}`] = c; });

  const fontSize = {};
  seed.typography.scale.forEach((s) => { fontSize[s.name] = `${s.px}px`; });
  const spacing = {};
  seed.spacing.steps.forEach((s) => { spacing[String(s / seed.spacing.base)] = `${s}px`; });

  return `/** Generated by EchoFlow from the live site. Review before shipping. */
module.exports = {
  theme: {
    extend: {
      colors: ${JSON.stringify(colors, null, 8).replace(/\n}/, '\n      }')},
      fontSize: ${JSON.stringify(fontSize, null, 8).replace(/\n}/, '\n      }')},
      spacing: ${JSON.stringify(spacing, null, 8).replace(/\n}/, '\n      }')},
      fontFamily: {
        heading: [${JSON.stringify(seed.typography.families.heading || 'sans-serif')}],
        body: [${JSON.stringify(seed.typography.families.body || 'sans-serif')}],
      },
    },
  },
};
`;
}

/**
 * Shopify colour schemes + typography settings, shaped the way settings_data.json
 * wants them. This is the handoff: paste into the theme rather than retyping
 * hexes out of a PDF.
 */
function toShopifySettings(seed) {
  const surface = seed.color.semantic.surface;
  const ink = seed.color.semantic.ink;
  return {
    _note: 'Paste into config/settings_data.json under current.color_schemes. Verify contrast in the theme editor before publishing.',
    color_schemes: {
      'scheme-1': {
        settings: {
          background: surface, text: ink,
          button: seed.color.primary || ink,
          button_label: surface,
          shadow: seed.shadow.steps[0]?.value || 'rgba(0,0,0,0.08)',
        },
      },
      'scheme-2': {
        settings: {
          background: seed.color.neutral[1]?.hex || surface, text: ink,
          button: seed.color.accents[0] || seed.color.primary || ink,
          button_label: surface,
        },
      },
    },
    typography: {
      type_header_font: seed.typography.families.heading,
      type_body_font: seed.typography.families.body,
      heading_scale: Math.round((seed.typography.ratio || 1.25) * 100),
      body_scale: Math.round((seed.typography.bodyPx / 16) * 100),
    },
    layout: {
      spacing_base: seed.spacing.base,
      buttons_radius: seed.radius.steps[0]?.px ?? 0,
      inputs_radius: seed.radius.steps[0]?.px ?? 0,
    },
  };
}

// --- utils -----------------------------------------------------------------

const round = (n) => Math.round(Number(n) * 100) / 100;

function fold(entries) {
  const m = new Map();
  for (const { value, count } of entries) m.set(value, (m.get(value) || 0) + count);
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}
