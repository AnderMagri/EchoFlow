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
  // Kept APART, not merged. Which property a colour was painted with is the
  // only evidence there is for what it is FOR, and folding the three together
  // throws it away before anything can use it.
  const byProperty = {
    text: fold(mergeTallies(observations, 'colorText')),
    background: fold(mergeTallies(observations, 'colorBackground')),
    border: fold(mergeTallies(observations, 'colorBorder')),
  };

  const color = buildColors(byProperty, observations);
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

/**
 * Colour, classified by the ROLE it plays in the interface.
 *
 * The old model named one colour "primary" and called it the brand. A rendered
 * page cannot support that claim — it has no access to a brand, only to where
 * paint was applied — and trying to make it produced exactly the failure you
 * would expect: a store with a black logo and black buttons was told its brand
 * colour was the red on its sale badges.
 *
 * So describe what is measurable. Every label here answers "what was this used
 * for", which is also the question a rebuild asks:
 *
 *   action   the colour of the main call to action
 *   ink      colours text is set in
 *   surface  colours things are painted on
 *   line     borders and dividers
 *   accent   chromatic colours doing none of the above
 *
 * Nothing is called primary, nothing is called brand, and no colour is ranked
 * above another except by how much it is used.
 */
function buildColors(byProperty, observations) {
  const clusterOf = (entries, tolerance) => cluster(entries, colorDistance, tolerance)
    .map((c) => ({ hex: c.leader, uses: c.count }));

  /**
   * The structural ramp for one property: its neutrals, plus a chromatic ONLY
   * when that chromatic is the single most-used value of the property.
   *
   * Without that rule a sale badge lands in the surface list next to white and
   * grey, and the export names it `--color-surface-2` — which says the page is
   * painted red somewhere structural. It is not; it is sixteen small badges.
   * The promotion rule keeps the genuinely chromatic case working: a store with
   * a navy page background has navy as its most-used background, so navy is
   * surface-0 and not an accent.
   *
   * Neutrals and chromatics also need different tolerances, so they are split
   * within each property rather than across the merged pile. See consistency.js.
   */
  const ramp = (entries) => {
    const { chromatic, neutral } = splitColorEntries(entries);
    const neutrals = clusterOf(neutral, TOLERANCES.colorNeutral);
    const chromatics = clusterOf(chromatic, TOLERANCES.colorChromatic);
    const topChromatic = chromatics.sort((a, b) => b.uses - a.uses)[0];
    const topNeutral = neutrals.slice().sort((a, b) => b.uses - a.uses)[0];
    const promoted = topChromatic && (!topNeutral || topChromatic.uses > topNeutral.uses)
      ? [topChromatic] : [];
    return [...neutrals, ...promoted].sort((a, b) => b.uses - a.uses);
  };

  const ink = ramp(byProperty.text);
  const line = ramp(byProperty.border);
  // Surfaces read light to dark: that ordering is the whole value of the list,
  // because an unordered set of greys is what the site already has.
  const surface = ramp(byProperty.background).sort((a, b) => lightnessOf(b.hex) - lightnessOf(a.hex));

  const pageSurface = surface[0]?.hex || '#ffffff';
  const bodyInk = ink[0]?.hex || '#000000';

  /**
   * The action colour, read off the main call to action — including when it is
   * black. A monochrome interface is an answer, not a missing one.
   *
   * A button painted the same colour as the page is an outlined button: that
   * is the surface showing through, not a decision, so it is not an action
   * colour.
   */
  const buttonBg = mostCommon(observations
    .map((o) => o.roles?.primaryButton?.background)
    .map((c) => {
      const parsed = c ? parseColor(c) : null;
      return parsed && parsed.a !== 0 ? toHex(parsed) : null;
    })
    .filter(Boolean));
  const action = buttonBg && buttonBg !== pageSurface ? buttonBg : null;

  /**
   * Accents: chromatic colours that are not the action and not the dominant
   * text or background. On a sale page this is where the badge red lands —
   * described by where it was seen rather than promoted to "the brand".
   */
  const seen = new Map();
  for (const [prop, entries] of Object.entries(byProperty)) {
    const { chromatic } = splitColorEntries(entries);
    for (const c of clusterOf(chromatic, TOLERANCES.colorChromatic)) {
      const at = seen.get(c.hex) || { hex: c.hex, uses: 0, where: [] };
      at.uses += c.uses;
      if (!at.where.includes(prop)) at.where.push(prop);
      seen.set(c.hex, at);
    }
  }
  // Anything already carrying a structural role is not also an accent.
  const structural = new Set([action, ...surface.map((x) => x.hex),
    ...ink.map((x) => x.hex), ...line.map((x) => x.hex)]);
  const accents = [...seen.values()]
    .filter((c) => !structural.has(c.hex))
    .sort((a, b) => b.uses - a.uses)
    .slice(0, 6);

  return {
    action,
    // Where the action colour came from, so the UI never has to guess whether
    // "none" means monochrome or unmeasured.
    actionFrom: action ? 'primary button' : null,
    actionIsNeutral: action ? chroma(parseColor(action)) <= 6 : false,
    ink: ink.slice(0, 6),
    surface: surface.slice(0, 6),
    line: line.slice(0, 4),
    accents,
    semantic: { surface: pageSurface, ink: bodyInk },
    contrastWarnings: contrastWarnings(action, pageSurface, bodyInk),
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
  const c = seed.color;
  if (c.action) L.push(`  --color-action: ${c.action};`);
  c.surface.forEach((x, i) => L.push(`  --color-surface-${i}: ${x.hex};`));
  c.ink.forEach((x, i) => L.push(`  --color-ink-${i}: ${x.hex};`));
  c.line.forEach((x, i) => L.push(`  --color-line-${i}: ${x.hex};`));
  c.accents.forEach((x, i) => L.push(`  --color-accent-${i + 1}: ${x.hex};`));
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
  if (seed.color.action) color.action = { $type: 'color', $value: seed.color.action };
  seed.color.surface.forEach((x, i) => { color[`surface-${i}`] = { $type: 'color', $value: x.hex }; });
  seed.color.ink.forEach((x, i) => { color[`ink-${i}`] = { $type: 'color', $value: x.hex }; });
  seed.color.line.forEach((x, i) => { color[`line-${i}`] = { $type: 'color', $value: x.hex }; });
  seed.color.accents.forEach((x, i) => { color[`accent-${i + 1}`] = { $type: 'color', $value: x.hex }; });

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
  const colors = {};
  if (seed.color.action) colors.action = seed.color.action;
  seed.color.surface.forEach((x, i) => { colors[`surface${i}`] = x.hex; });
  seed.color.ink.forEach((x, i) => { colors[`ink${i}`] = x.hex; });
  seed.color.line.forEach((x, i) => { colors[`line${i}`] = x.hex; });
  seed.color.accents.forEach((x, i) => { colors[`accent${i + 1}`] = x.hex; });

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
          button: seed.color.action || ink,
          button_label: surface,
          shadow: seed.shadow.steps[0]?.value || 'rgba(0,0,0,0.08)',
        },
      },
      'scheme-2': {
        settings: {
          background: seed.color.surface[1]?.hex || surface, text: ink,
          button: seed.color.accents[0]?.hex || seed.color.action || ink,
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
