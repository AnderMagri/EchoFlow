#!/usr/bin/env node
/**
 * EchoFlow 2.0 test suite.
 *
 * Weighted toward the CALIBRATION facts — the ones that were discovered by
 * measuring rather than reasoned out, and that would regress silently:
 * the two colour tolerances, Lab chroma vs HSL saturation, the inverted effort
 * scale, and "unmeasured is not passing".
 *
 *   node test/run.js
 */

import { chroma, contrastRatio, deltaE, isNeutral, parseColor, toHSL } from '../core/color.js';
import {
  aggregate, colorCoherence, crossPageAgreement, rhythmAdherence,
  splitColorEntries, TOLERANCES, vocabularyCoherence, exactDistance,
} from '../core/consistency.js';
import { createFinding, effortLabel, priorityBand, rank, dedupe, forClient } from '../core/finding.js';
import { inferSurface, normalizeObservation, flattenLayout, sectionSkeleton } from '../core/observation.js';
import { analyze } from '../core/analyze.js';
import { buildBundle } from '../core/wiki/bundle.js';
import { cleanSite, messySite } from './fixtures.js';

let pass = 0, fail = 0;
const results = [];

function t(name, fn) {
  try { fn(); pass++; results.push(['ok  ', name]); }
  catch (e) { fail++; results.push(['FAIL', `${name}\n        ${e.message}`]); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function near(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error(`${msg || ''} ${a} not within ${tol} of ${b}`);
}

const hex = (h) => parseColor(h);

// --- colour ----------------------------------------------------------------

t('parseColor handles hex, short hex, rgb and rgba', () => {
  eq(parseColor('#fff').r, 255);
  eq(parseColor('#e63946').g, 57);
  eq(parseColor('rgb(230, 57, 70)').b, 70);
  eq(parseColor('rgba(0,0,0,0.5)').a, 0.5);
  eq(parseColor('transparent'), null);
});

t('deltaE: accidental chromatic forks sit ABOVE deliberate neutral steps', () => {
  // This inversion is the entire reason two tolerances exist. If it ever stops
  // holding, the single-threshold approach becomes viable again.
  const fork = deltaE(hex('#e63946'), hex('#e5393f'));       // accident
  const neutralStep = deltaE(hex('#ffffff'), hex('#f8f9fa')); // intentional
  ok(fork > neutralStep, `fork ${fork.toFixed(2)} should exceed neutral step ${neutralStep.toFixed(2)}`);
  near(fork, 3.71, 0.1, 'brand red fork');
  near(neutralStep, 2.21, 0.1, 'white to page bg');
});

t('chromatic tolerance catches forks; neutral tolerance preserves surface tints', () => {
  ok(deltaE(hex('#e63946'), hex('#e5393f')) <= TOLERANCES.colorChromatic, 'red fork must merge');
  ok(deltaE(hex('#457b9d'), hex('#4a7fa0')) <= TOLERANCES.colorChromatic, 'blue fork must merge');
  ok(deltaE(hex('#ffffff'), hex('#f8f9fa')) > TOLERANCES.colorNeutral, 'surface tint must stay separate');
  ok(deltaE(hex('#000000'), hex('#111111')) > TOLERANCES.colorNeutral, 'near-black must stay separate');
  ok(deltaE(hex('#333333'), hex('#353535')) <= TOLERANCES.colorNeutral, 'grey leak must merge');
});

t('isNeutral uses Lab chroma — off-whites are neutral, not brand colours', () => {
  // HSL saturation reports #f8f9fa at ~17% because its denominator collapses
  // near white. Lab chroma reports 0.6. Regressing this pollutes the brand budget.
  ok(toHSL(hex('#f8f9fa')).s > 15, 'precondition: HSL saturation is misleadingly high');
  ok(chroma(hex('#f8f9fa')) < 2, 'Lab chroma should be near zero');
  ok(isNeutral(hex('#f8f9fa')), '#f8f9fa is neutral');
  ok(isNeutral(hex('#f1f3f5')), '#f1f3f5 is neutral');
  ok(!isNeutral(hex('#e63946')), '#e63946 is chromatic');
  ok(!isNeutral(hex('#264653')), '#264653 is chromatic');
});

t('contrastRatio matches WCAG reference values', () => {
  near(contrastRatio(hex('#fff'), hex('#000')), 21, 0.01);
  near(contrastRatio(hex('#fff'), hex('#fff')), 1, 0.01);
});

// --- consistency primitives ------------------------------------------------

t('vocabularyCoherence scores a tight set at 100 and a sprawling one low', () => {
  const tight = vocabularyCoherence({
    entries: [{ value: 'a', count: 9 }, { value: 'b', count: 4 }],
    ideal: 4, distance: exactDistance, tolerance: 0,
  });
  eq(tight.score, 100);
  const sprawl = vocabularyCoherence({
    entries: Array.from({ length: 40 }, (_, i) => ({ value: `v${i}`, count: 1 })),
    ideal: 4, distance: exactDistance, tolerance: 0,
  });
  ok(sprawl.score < 40, `sprawl scored ${sprawl.score}`);
});

t('colorCoherence separates forks from deliberate steps', () => {
  const entries = [['#333333', 400], ['#343434', 20], ['#ffffff', 900], ['#f8f9fa', 100]]
    .map(([value, count]) => ({ value, count }));
  const { neutral } = splitColorEntries(entries);
  const r = colorCoherence(neutral, 'neutral');
  eq(r.tokens, 3, 'should keep #333, #fff and #f8f9fa as three tokens');
  eq(r.nearDuplicates.length, 1, 'should catch exactly the #343434 leak');
});

t('crossPageAgreement returns null (not a score) below two pages', () => {
  const r = crossPageAgreement({ observations: [{ page: '/', value: 'x' }] });
  eq(r.score, null, 'one page is unmeasurable');
});

t('crossPageAgreement names the outliers', () => {
  const r = crossPageAgreement({
    observations: [
      { page: '/a', value: 'Add to cart' }, { page: '/b', value: 'Add to cart' },
      { page: '/c', value: 'Buy now' },
    ],
  });
  near(r.score, 67, 1);
  eq(r.consensus, 'Add to cart');
  eq(r.outliers.length, 1);
  eq(r.outliers[0].page, '/c');
});

t('rhythmAdherence detects the base unit rather than assuming 8', () => {
  const r = rhythmAdherence([[5, 100], [10, 90], [15, 80], [20, 70]].map(([value, count]) => ({ value, count })));
  eq(r.base, 5, 'should detect a 5px base');
  eq(r.score, 100);
});

t('rhythmAdherence reports strays with their nearest step', () => {
  const r = rhythmAdherence([[8, 200], [16, 200], [13, 10]].map(([value, count]) => ({ value, count })));
  eq(r.base, 8);
  eq(r.strays[0].value, 13);
  eq(r.strays[0].nearest, 16);
});

// --- aggregation -----------------------------------------------------------

t('unmeasured dimensions are EXCLUDED, never counted as passing', () => {
  const a = aggregate([
    { key: 'x', axis: 'design', score: 50, weight: 1 },
    { key: 'y', axis: 'design', score: null, weight: 1 },
  ]);
  eq(a.overall, 50, 'null must not average in as 100');
  eq(a.skipped.length, 1);
});

t('partial coverage marks the score provisional', () => {
  const a = aggregate([
    { key: 'x', axis: 'design', score: 90, weight: 1 },
    { key: 'y', axis: 'ux', score: null, weight: 3 },
  ]);
  ok(a.provisional, 'coverage 25% must be provisional');
  eq(a.confidence, 'indicative only');
});

t('full coverage is not provisional', () => {
  const a = aggregate([{ key: 'x', axis: 'design', score: 90, weight: 1 }]);
  eq(a.provisional, false);
  eq(a.confidence, 'high');
});

// --- the Finding -----------------------------------------------------------

t('createFinding rejects a finding with no evidence', () => {
  let threw = false;
  try {
    createFinding({ checkId: 'x', title: 't', surface: 'pdp', axis: 'design',
      impact: 5, effort: 5, recommendation: 'r' });
  } catch { threw = true; }
  ok(threw, 'a finding without evidence is an opinion and must throw');
});

t('createFinding rejects bad surface and axis', () => {
  const bad = (o) => { try { createFinding(o); return false; } catch { return true; } };
  ok(bad({ checkId: 'x', title: 't', surface: 'nope', axis: 'design', impact: 1, effort: 1, evidence: {}, recommendation: 'r' }));
  ok(bad({ checkId: 'x', title: 't', surface: 'pdp', axis: 'nope', impact: 1, effort: 1, evidence: {}, recommendation: 'r' }));
});

t('priority is impact x effort, with effort INVERTED (10 = trivial)', () => {
  const f = createFinding({ checkId: 'x', title: 't', surface: 'pdp', axis: 'design',
    impact: 8, effort: 9, evidence: {}, recommendation: 'r' });
  eq(f.priority, 72);
  eq(priorityBand(72), 'critical');
  eq(effortLabel(9), 'trivial');
  eq(effortLabel(2), 'major');
});

t('finding ids are deterministic across identical inputs', () => {
  const mk = () => createFinding({ checkId: 'x', title: 't', surface: 'pdp', axis: 'design',
    impact: 5, effort: 5, evidence: { a: 1 }, recommendation: 'r' });
  eq(mk().id, mk().id);
});

t('dedupe collapses identical findings; rank sorts worst-first', () => {
  const mk = (impact) => createFinding({ checkId: 'x', title: 't', surface: 'pdp', axis: 'design',
    impact, effort: 5, evidence: { impact }, recommendation: 'r' });
  eq(dedupe([mk(5), mk(5)]).length, 1);
  const ranked = rank([mk(2), mk(9), mk(5)]);
  eq(ranked[0].impact, 9);
  eq(forClient([mk(9), mk(1)]).length, 1, 'client density filters below 40');
});

// --- observation -----------------------------------------------------------

t('inferSurface maps Shopify URL shapes', () => {
  eq(inferSurface('https://s.com/'), 'home');
  eq(inferSurface('https://s.com/products/tee'), 'pdp');
  eq(inferSurface('https://s.com/collections/all'), 'plp');
  eq(inferSurface('https://s.com/cart'), 'cart');
  eq(inferSurface('https://s.com/pages/about'), 'content');
  eq(inferSurface('not a url'), 'content');
});

t('normalizeObservation survives a partial collector payload', () => {
  const o = normalizeObservation({ url: 'https://s.com/' });
  eq(Object.keys(o.styles).length, 13);
  eq(o.engine.vitals.lcp, null);
  eq(o.layout, null);
});

t('normalizeObservation drops junk tallies', () => {
  const o = normalizeObservation({ styles: { fontSize: [{ value: '16px', count: 2 }, { value: 'none' }, null] } });
  eq(o.styles.fontSize.length, 1);
});

t('flattenLayout and sectionSkeleton walk the tree', () => {
  const tree = { id: 'r', depth: 0, children: [
    { id: 'a', depth: 1, section: true, children: [] },
    { id: 'b', depth: 1, children: [{ id: 'c', depth: 2, section: true, children: [] }] },
  ] };
  eq(flattenLayout(tree).length, 4);
  eq(flattenLayout(tree, 1).length, 3);
  eq(sectionSkeleton(tree).length, 2);
});

// --- end to end ------------------------------------------------------------

t('a disciplined site scores as systematic', () => {
  const r = analyze({ observations: cleanSite(), site: 'clean' });
  ok(r.consistency.overall >= 85, `scored ${r.consistency.overall}`);
  eq(r.consistency.grade, 'systematic');
});

t('a page-by-page site scores materially lower', () => {
  const clean = analyze({ observations: cleanSite(), site: 'clean' });
  const messy = analyze({ observations: messySite(), site: 'messy' });
  ok(messy.consistency.overall < clean.consistency.overall - 20,
    `clean ${clean.consistency.overall} vs messy ${messy.consistency.overall}`);
});

t('component drift is ONE finding per role, not one per property', () => {
  const r = analyze({ observations: messySite(), site: 'messy' });
  const buttonFindings = r.findings.filter((f) => f.checkId === 'design-drift-primaryButton');
  eq(buttonFindings.length, 1, 'a drifting button is one finding');
  ok(buttonFindings[0].evidence.driftingProperties.length > 1, 'and it lists every drifting property');
});

t('a structural drift finding ranks critical, not buried', () => {
  const r = analyze({ observations: messySite(), site: 'messy' });
  const f = r.findings.find((x) => x.checkId === 'design-drift-primaryButton');
  ok(f.priority >= 63, `a component that is not a component scored ${f.priority}`);
});

t('single-page runs skip comparative dimensions instead of guessing', () => {
  const r = analyze({ observations: [messySite()[0]], site: 'one' });
  ok(r.skipped.length > 0, 'comparative dimensions must be skipped');
  ok(r.consistency.provisional, 'and the score must be flagged provisional');
  ok(r.consistency.dimensions.some((d) => d.scope === 'comparative' && d.score === null));
});

t('synthesis fires only with more than one axis', () => {
  const one = analyze({ observations: messySite(), axes: ['design'], site: 'm' });
  eq(one.findings.filter((f) => f.kind === 'meta').length, 0);
  const all = analyze({ observations: messySite(), site: 'm' });
  ok(all.findings.filter((f) => f.kind === 'meta').length > 0);
});

t('the token seed produces every export format', () => {
  const r = analyze({ observations: cleanSite(), site: 'clean' });
  ok(r.tokens.formats.css.includes('--color-'), 'css custom properties');
  ok(r.tokens.formats.dtcg.color, 'DTCG tokens');
  ok(r.tokens.formats.tailwind.includes('module.exports'), 'tailwind config');
  ok(r.tokens.formats.shopify.color_schemes, 'shopify settings');
});

t('the bundle is complete and self-consistent', () => {
  const r = analyze({ observations: messySite(), site: 'messy' });
  const files = buildBundle(r);
  ok(files['site/index.html'].includes('<!DOCTYPE html>'));
  ok(files['CLAUDE.md'].includes('effort'), 'agent contract explains the inverted scale');
  ok(files['manifest.json'], 'manifest present');

  const findingFiles = Object.keys(files).filter((f) => f.startsWith('findings/'));
  eq(findingFiles.length, r.findings.length, 'one file per finding, no orphans');

  const manifest = JSON.parse(files['manifest.json']);
  eq(manifest.findings.length, r.findings.length, 'manifest lists every finding');
  for (const entry of manifest.findings) {
    ok(files[entry.file], `manifest references a file that exists: ${entry.file}`);
  }
});

t('analysis.json excludes the bulky layout trees', () => {
  const r = analyze({ observations: messySite(), site: 'messy' });
  const files = buildBundle(r);
  ok(!JSON.parse(files['data/analysis.json']).observations, 'observations stripped from analysis.json');
});

// --- report ----------------------------------------------------------------

for (const [status, name] of results) {
  if (status === 'FAIL') console.log(`  \x1b[31m${status}\x1b[0m  ${name}`);
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
