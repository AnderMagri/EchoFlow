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
import {
  createFinding, effortLabel, priorityBand, rank, dedupe, forClient,
  byOwner, ownerFor, OWNERS,
} from '../core/finding.js';
import { inferSurface, normalizeObservation, flattenLayout, sectionSkeleton } from '../core/observation.js';
import { analyze } from '../core/analyze.js';
import { evaluateAnswerability } from '../core/answerability.js';
import { evaluateParity } from '../core/parity.js';
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
  ok(files['START HERE.html'].includes('<!DOCTYPE html>'), 'a single obvious entry point at the top');
  ok(!Object.keys(files).some((f) => f !== 'START HERE.html' && !f.startsWith('report/')),
    'everything else lives under report/');
  ok(files['report/site/index.html'].includes('<!DOCTYPE html>'));
  ok(files['report/CLAUDE.md'].includes('effort'), 'agent contract explains the inverted scale');
  ok(files['report/manifest.json'], 'manifest present');

  const findingFiles = Object.keys(files).filter((f) => f.startsWith('report/findings/'));
  eq(findingFiles.length, r.findings.length, 'one file per finding, no orphans');

  const manifest = JSON.parse(files['report/manifest.json']);
  eq(manifest.findings.length, r.findings.length, 'manifest lists every finding');
  for (const entry of manifest.findings) {
    ok(files[`report/${entry.file}`], `manifest references a file that exists: ${entry.file}`);
  }
});

t('analysis.json excludes the bulky layout trees', () => {
  const r = analyze({ observations: messySite(), site: 'messy' });
  const files = buildBundle(r);
  ok(!JSON.parse(files['report/data/analysis.json']).observations, 'observations stripped from analysis.json');
});

// --- quality checks --------------------------------------------------------

t('collected a11y data produces findings — nothing measured is discarded', () => {
  const obs = messySite();
  obs[0].a11y = {
    targetsUnder24: 9, targetsUnder44: 12, controlsTotal: 40, inlineLinksExempt: 5,
    tinyTargets: [{ tag: 'a', w: 18, h: 18, label: 'x' }],
    textUnder12: 7, tinyTextSamples: [{ px: 10, sample: 'legal copy' }],
    imagesMissingAlt: 6, imagesTotal: 10, headingJumps: 2, unlabeledControls: 3,
    contrastFailures: [],
  };
  const r = analyze({ observations: obs, site: 'm' });
  const ids = r.findings.map((f) => f.checkId);
  ok(ids.includes('design-target-under-24'), 'sub-24px targets must surface');
  ok(ids.includes('design-text-under-12'), 'sub-12px text must surface');
  ok(ids.includes('design-heading-jumps'), 'heading jumps must surface');
  ok(ids.includes('ux-missing-alt'), 'missing alt must surface');
  ok(ids.includes('ux-unlabeled-controls'), 'unlabeled controls must surface');
});

t('a WCAG target finding cites the criterion it fails', () => {
  const obs = messySite();
  obs[0].a11y = { ...obs[0].a11y, targetsUnder24: 5, controlsTotal: 20, tinyTargets: [] };
  const f = analyze({ observations: obs, site: 'm' })
    .findings.find((x) => x.checkId === 'design-target-under-24');
  eq(f.basis, 'prescriptive');
  ok(/2\.5\.8/.test(f.citation), `must name the criterion, got "${f.citation}"`);
});

t('the 24px WCAG floor and the 44px convention are separate findings', () => {
  const obs = messySite();
  obs[0].a11y = { ...obs[0].a11y, targetsUnder24: 0, targetsUnder44: 12, controlsTotal: 30, tinyTargets: [] };
  const fs = analyze({ observations: obs, site: 'm' }).findings;
  ok(!fs.some((f) => f.checkId === 'design-target-under-24'), 'nothing fails 2.5.8');
  const soft = fs.find((f) => f.checkId === 'design-target-under-44');
  ok(soft, 'but platform convention still reports');
  eq(soft.basis, 'practice', 'and it must NOT claim to be a standard');
});

t('inline links in body text are exempt from the 24px rule', () => {
  // SC 2.5.8 exempts inline targets. Flagging every in-paragraph link is noise.
  const obs = messySite();
  obs[0].a11y = { ...obs[0].a11y, targetsUnder24: 4, controlsTotal: 20, inlineLinksExempt: 30, tinyTargets: [] };
  const f = analyze({ observations: obs, site: 'm' })
    .findings.find((x) => x.checkId === 'design-target-under-24');
  eq(f.evidence.inlineLinksExempted, 30, 'the exemption must be stated in the evidence');
});

t('dark patterns are reported with the literal matched text', () => {
  const obs = messySite();
  obs[0].darkPatterns = {
    confirmshaming: ["No thanks, I don't want to save money"],
    preCheckedOptIns: ['Subscribe me to marketing emails'],
    urgency: ['Only 2 left'], countdownTimers: 1,
    hardToLeave: [], lateCosts: [], disguisedAds: 0,
  };
  const fs = analyze({ observations: obs, site: 'm' }).findings;
  const shame = fs.find((f) => f.checkId === 'ux-confirmshaming');
  ok(shame, 'confirmshaming must surface');
  ok(shame.evidence.matched[0].includes("save money"), 'evidence carries the actual string');
  ok(fs.some((f) => f.checkId === 'ux-pre-checked-optin'), 'pre-ticked consent must surface');
  // Urgency is a prompt to verify, not a verdict — it must not claim intent.
  const urg = fs.find((f) => f.checkId === 'ux-urgency-pressure');
  ok(urg && /cannot tell/.test(urg.evidence.note), 'urgency must state its own uncertainty');
});

t('a buy control below the declared fold is found, and the fold is stated', () => {
  const obs = messySite();
  obs[0].surface = 'pdp';
  obs[0].viewport = { width: 390, height: 640, label: 'mobile' };
  obs[0].geometry = { pageHeight: 9000, viewportHeight: 640, firstPriceY: 1200,
    firstActionY: 1500, firstActionLabel: 'Add to cart', coreContentY: null,
    stickyControls: [], sections: [], footerHeight: 400, navItemCount: 4 };
  const f = analyze({ observations: obs, site: 'm' })
    .findings.find((x) => x.checkId.startsWith('ux-action-below-fold'));
  ok(f, 'must find a below-fold buy control');
  eq(f.evidence.foldLine, 640, 'the fold must be declared, not implied');
  ok(f.impact >= 8, 'no persistent control means this is expensive');
});

t('a persistent buy control softens the below-fold finding', () => {
  const mk = (sticky) => {
    const obs = messySite();
    obs[0].surface = 'pdp';
    obs[0].viewport = { width: 390, height: 640, label: 'mobile' };
    obs[0].geometry = { pageHeight: 9000, viewportHeight: 640, firstPriceY: 1200,
      firstActionY: 1500, firstActionLabel: 'Add to cart', coreContentY: null,
      stickyControls: sticky ? [{ tag: 'div', position: 'fixed', height: 60, hasAction: true }] : [],
      sections: [], footerHeight: 400, navItemCount: 4 };
    return analyze({ observations: obs, site: 'm' })
      .findings.find((x) => x.checkId.startsWith('ux-action-below-fold'));
  };
  ok(mk(true).impact < mk(false).impact, 'a sticky control must reduce the impact');
});

t('measure findings use Bringhurst bounds and claim only practice', () => {
  const obs = messySite();
  obs[0].typography = { measures: Array.from({ length: 6 }, () => ({ cpl: 110, px: 16, width: 850, sample: 'x' })) };
  const f = analyze({ observations: obs, site: 'm' })
    .findings.find((x) => x.checkId === 'design-measure-wide');
  ok(f, 'over-90 measure must surface');
  eq(f.basis, 'practice', 'the 45-75 measure is convention, not a standard');
});

t('strengths are findings, and never outrank problems', () => {
  const obs = messySite();
  obs[0].surface = 'pdp';
  obs[0].viewport = { width: 390, height: 640, label: 'mobile' };
  obs[0].geometry = { pageHeight: 3000, viewportHeight: 640, firstPriceY: 200,
    firstActionY: 300, firstActionLabel: 'Add to cart', coreContentY: null,
    stickyControls: [{ tag: 'div', position: 'fixed', height: 60, hasAction: true }],
    sections: [], footerHeight: 200, navItemCount: 4 };
  const fs = analyze({ observations: obs, site: 'm' }).findings;
  const strengths = fs.filter((f) => f.kind === 'strength');
  ok(strengths.length > 0, 'a sticky control and an above-fold buy path are strengths');
  const firstStrengthIdx = fs.findIndex((f) => f.kind === 'strength');
  const lastProblemIdx = fs.map((f) => f.kind !== 'strength').lastIndexOf(true);
  ok(firstStrengthIdx > lastProblemIdx, 'every problem ranks above every strength');
});

t('page depth is measured against the USABLE viewport, not the device height', () => {
  const obs = messySite();
  obs[0].surface = 'home';
  obs[0].viewport = { width: 390, height: 844, label: 'mobile' };
  obs[0].geometry = { pageHeight: 11455, viewportHeight: 844, firstPriceY: null,
    firstActionY: 400, firstActionLabel: 'Shop', coreContentY: null,
    stickyControls: [], sections: [], footerHeight: 900, navItemCount: 4 };
  const f = analyze({ observations: obs, site: 'm' })
    .findings.find((x) => x.checkId === 'ux-page-depth-home');
  ok(f, 'must flag an 11455px homepage');
  eq(f.evidence.foldLine, 640, 'fold is the usable 640, not the 844 device height');
  ok(f.evidence.screens > 17, `11455/640 is ~17.9 screens, got ${f.evidence.screens}`);
});

t('responsive differences are not reported as drift', () => {
  // The same three pages captured at two viewports. A button that is 48px on
  // desktop and 44px on mobile is responsive design; comparing across viewports
  // would report every such decision as drift, and would fire hardest on sites
  // that did responsive properly.
  const desktop = cleanSite().slice(0, 3).map((o) => ({
    ...o, viewport: { width: 1440, height: 800, label: 'desktop' },
  }));
  const mobile = desktop.map((o) => ({
    ...o,
    viewport: { width: 390, height: 640, label: 'mobile' },
    roles: { ...o.roles, primaryButton: { ...o.roles.primaryButton, height: 44, fontSize: 15 } },
  }));

  const oneViewport = analyze({ observations: desktop, site: 't' });
  const bothViewports = analyze({ observations: [...desktop, ...mobile], site: 't' });

  const drift = bothViewports.findings.filter((f) => f.checkId.startsWith('design-drift-'));
  eq(drift.length, 0, `adding a mobile capture invented ${drift.length} drift finding(s)`);
  eq(bothViewports.consistency.byAxis.design, oneViewport.consistency.byAxis.design,
    'the design score must not move just because a second viewport was captured');
});

t('a two-viewport run does not double-count CTA wording', () => {
  const base = messySite().slice(0, 3).map((o) => ({
    ...o, viewport: { width: 1440, height: 800, label: 'desktop' },
  }));
  const withMobile = [...base, ...base.map((o) => ({ ...o, viewport: { width: 390, height: 640, label: 'mobile' } }))];
  const one = analyze({ observations: base, site: 't' });
  const two = analyze({ observations: withMobile, site: 't' });
  const pagesOf = (r) => r.consistency.dimensions.find((d) => d.key === 'cta-language')?.detail?.pages;
  eq(pagesOf(two), pagesOf(one), 'wording is compared once per URL, not once per render');
});

// --- machine retrieval (GEO) ------------------------------------------------

const withRetrieval = (obs, retrieval) => obs.map((o) => ({ ...o, retrieval: { ...retrieval } }));

t('blocking AI crawlers is reported as a decision, never as a mistake', () => {
  const siteSignals = {
    origin: 'https://s.com',
    robots: {
      present: true, sitemaps: [],
      agents: {
        GPTBot: { state: 'blocked', by: 'explicit GPTBot block', operator: 'OpenAI', purpose: 'training' },
        ClaudeBot: { state: 'allowed', by: 'wildcard rule', operator: 'Anthropic', purpose: 'training' },
      },
    },
    llmsTxt: { present: true },
  };
  const f = analyze({ observations: messySite(), site: 's', siteSignals })
    .findings.find((x) => x.checkId === 'engine-ai-crawlers-blocked');
  ok(f, 'a blocked crawler must be reported');
  ok(/deliberate|confirm/i.test(f.recommendation), 'and framed as a decision to confirm, not a defect');
  eq(f.basis, 'practice', 'there is no standard requiring AI crawler access');
});

t('a wildcard block scores higher than a named one — it is likelier accidental', () => {
  const mk = (by) => analyze({
    observations: messySite(), site: 's',
    siteSignals: { origin: 'https://s.com', llmsTxt: { present: true },
      robots: { present: true, sitemaps: [], agents: { GPTBot: { state: 'blocked', by, operator: 'OpenAI', purpose: 'x' } } } },
  }).findings.find((x) => x.checkId === 'engine-ai-crawlers-blocked');
  ok(mk('wildcard block').impact > mk('explicit GPTBot block').impact,
    'a catch-all Disallow catching an answer engine is likelier to be unintended');
});

t('llms.txt absence is directional and low priority — the convention is new', () => {
  const f = analyze({
    observations: messySite(), site: 's',
    siteSignals: { origin: 'https://s.com', robots: { present: true, agents: {}, sitemaps: [] }, llmsTxt: { present: false } },
  }).findings.find((x) => x.checkId === 'engine-no-llms-txt');
  ok(f, 'absence is noted');
  eq(f.basis, 'directional', 'it is not established practice');
  ok(f.priority < 40, `must not crowd real findings, got ${f.priority}`);
});

t('content that only exists after JavaScript is found', () => {
  const obs = withRetrieval(messySite().slice(0, 2), {
    jsonLd: [], jsonLdTypes: ['Product'], jsonLdErrors: [], title: 'Hiker',
    metaDescription: null, canonical: null, h1Count: 1, h1Text: ['Hiker'],
    contentRatio: 0.9, questionHeadings: 0, hasFaqSchema: false, lang: 'en',
    mainTextLength: 900, totalTextLength: 1000,
    static: {
      fetched: true, staticTextLength: 140, renderedTextLength: 1000, textRatio: 0.14,
      h1InStatic: false, titleInStatic: true, jsonLdTypesInStatic: [], jsonLdOnlyAfterJs: ['Product'],
    },
  });
  const f = analyze({ observations: obs, site: 's' })
    .findings.find((x) => x.checkId.startsWith('engine-content-requires-js'));
  ok(f, 'a hydration-dependent page must be flagged');
  ok(f.impact >= 8, 'missing h1, thin text and JS-only schema together is severe');
  ok(/varies by operator|changes/i.test(f.evidence.caveat), 'and must not overstate crawler behaviour');
});

t('a server-rendered page is a strength, not a finding', () => {
  const obs = withRetrieval(messySite().slice(0, 2), {
    jsonLd: [{ type: 'Product', offers: { price: true, currency: true, availability: true } }],
    jsonLdTypes: ['Product'], jsonLdErrors: [], title: 'Runner', metaDescription: 'A shoe',
    canonical: 'https://s.com/p', h1Count: 1, h1Text: ['Runner'], contentRatio: 0.8,
    questionHeadings: 0, hasFaqSchema: false, lang: 'en', mainTextLength: 800, totalTextLength: 1000,
    static: { fetched: true, staticTextLength: 1010, renderedTextLength: 1000, textRatio: 1.01,
      h1InStatic: true, titleInStatic: true, jsonLdTypesInStatic: ['Product'], jsonLdOnlyAfterJs: [] },
  });
  const fs = analyze({ observations: obs, site: 's' }).findings;
  ok(!fs.some((f) => f.checkId.startsWith('engine-content-requires-js')), 'no false positive');
  ok(fs.some((f) => f.checkId === 'strength-server-rendered'), 'and it is named as a strength');
});

t('Product markup without price or availability is incomplete, not absent', () => {
  const obs = withRetrieval(messySite().slice(0, 2), {
    jsonLd: [{ type: 'Product', offers: { price: false, currency: true, availability: false } }],
    jsonLdTypes: ['Product'], jsonLdErrors: [], title: 't', metaDescription: 'd', canonical: 'c',
    h1Count: 1, h1Text: ['t'], contentRatio: 0.8, questionHeadings: 0, hasFaqSchema: false,
    lang: 'en', mainTextLength: 800, totalTextLength: 1000, static: null,
  });
  const fs = analyze({ observations: obs, site: 's' }).findings;
  ok(fs.some((f) => f.checkId === 'engine-incomplete-product-schema'), 'incomplete offers must surface');
  ok(!fs.some((f) => f.checkId === 'engine-missing-schema-pdp'), 'and it must not also report as missing');
});

t('structured data drift across same-type pages moves the score', () => {
  const obs = messySite().map((o, i) => ({
    ...o,
    surface: 'pdp',
    url: `https://s.com/products/${i}`,
    retrieval: {
      jsonLd: [], jsonLdTypes: i === 0 ? ['Product'] : [], jsonLdErrors: [],
      title: 't', metaDescription: 'd', canonical: 'c', h1Count: 1, h1Text: ['t'],
      contentRatio: 0.8, questionHeadings: 0, hasFaqSchema: false, lang: 'en',
      mainTextLength: 800, totalTextLength: 1000, static: null,
    },
  }));
  const r = analyze({ observations: obs, site: 's' });
  const dim = r.consistency.dimensions.find((d) => d.key === 'structured-data-coverage');
  ok(typeof dim.score === 'number' && dim.score < 100, `drift must score below 100, got ${dim.score}`);
  eq(r.consistency.byGroup['Structured data'].axis, 'engine', 'GEO lives on the Engine axis, not a fourth one');
});

t('there are still exactly three axes', () => {
  // The concept forbids adding axes. GEO is groups on Engine, not a new axis.
  const r = analyze({ observations: messySite(), site: 's' });
  eq(Object.keys(r.consistency.byAxis).sort().join(','), 'design,engine,ux');
});

// --- ownership --------------------------------------------------------------

t('every finding has a valid owner', () => {
  const r = analyze({ observations: messySite(), site: 'm' });
  for (const f of r.findings) {
    ok(OWNERS.includes(f.owner), `${f.checkId} has owner "${f.owner}"`);
  }
});

t('the Engine axis splits across two owners — that is the whole point', () => {
  // "third-party script set differs" and "no meta description" are both Engine
  // and are fixed by different people. If they land with the same owner, the
  // split has stopped doing its job.
  eq(ownerFor('engine-app-drift', 'engine'), 'engineering');
  eq(ownerFor('engine-perf-variance', 'engine'), 'engineering');
  eq(ownerFor('engine-missing-description', 'engine'), 'marketing');
  eq(ownerFor('engine-no-structured-data', 'engine'), 'marketing');
  eq(ownerFor('engine-ai-crawlers-blocked', 'engine'), 'marketing');
});

t('implementation bugs go to engineering even when the topic is marketing', () => {
  // Structured data is decided by marketing; a JSON-LD block that will not
  // parse is a Liquid escaping bug and nobody in marketing can fix it.
  eq(ownerFor('engine-malformed-jsonld', 'engine'), 'engineering');
  eq(ownerFor('engine-content-requires-js-pdp', 'engine'), 'engineering');
  eq(ownerFor('engine-schema-drift-pdp', 'engine'), 'marketing');
});

t('dark patterns and copy belong to marketing, not design', () => {
  for (const id of ['ux-confirmshaming', 'ux-pre-checked-optin', 'ux-urgency-pressure',
    'ux-cta-drift', 'ux-price-format-drift', 'ux-missing-alt']) {
    eq(ownerFor(id, 'ux'), 'marketing', id);
  }
});

t('meta-findings are owned by topic, not by whichever axis scored worst', () => {
  // A meta-finding takes its axis from the lowest-scoring axis, which says
  // nothing about who fixes it.
  eq(ownerFor('meta-weight-is-apps', 'design'), 'engineering');
  eq(ownerFor('meta-weight-is-apps', 'ux'), 'engineering');
  eq(ownerFor('meta-promise-gap', 'engine'), 'design');
});

t('owner is a tag, not a hierarchy — no owner is scored', () => {
  const r = analyze({ observations: messySite(), site: 'm' });
  ok(!r.consistency.byOwner, 'there must be no per-owner score');
  const keys = Object.keys(r.consistency);
  ok(!keys.some((k) => /owner/i.test(k)), `consistency must not mention owners, has: ${keys.join(',')}`);
});

t('owner pages are linked views, not copies', () => {
  const r = analyze({ observations: messySite(), site: 'm' });
  const files = buildBundle(r);
  const ownerPages = Object.keys(files).filter((f) => /^report\/pages\/for-/.test(f));
  ok(ownerPages.length >= 2, `expected owner pages, got ${ownerPages.join(',')}`);

  // Every finding appears exactly once in findings/, however many views cite it.
  const findingFiles = Object.keys(files).filter((f) => f.startsWith('report/findings/'));
  eq(findingFiles.length, r.findings.length, 'one file per finding regardless of how many pages link it');

  const manifest = JSON.parse(files['report/manifest.json']);
  const total = Object.values(manifest.byOwner).reduce((a, b) => a + b, 0);
  eq(total, r.findings.length, 'the owner split partitions the pile exactly — no finding in two lists, none missing');
});

t('byOwner partitions the findings with no overlap', () => {
  const r = analyze({ observations: messySite(), site: 'm' });
  const counts = OWNERS.map((o) => byOwner(r.findings, o).length);
  eq(counts.reduce((a, b) => a + b, 0), r.findings.length);
});

// --- answerability ----------------------------------------------------------

const pdpWith = (payload) => ({
  ...messySite()[0], surface: 'pdp', url: 'https://s.com/products/x',
  retrieval: {
    jsonLd: [], jsonLdTypes: [], jsonLdErrors: [], title: 'Runner', metaDescription: null,
    canonical: null, h1Count: 1, h1Text: ['Runner'], contentRatio: 0.8, questionHeadings: 0,
    hasFaqSchema: false, lang: 'en', mainTextLength: 800, totalTextLength: 1000,
    static: { fetched: true, textRatio: 1, h1InStatic: true, jsonLdTypesInStatic: [],
      jsonLdOnlyAfterJs: [], payload },
  },
});

t('an unresolved template placeholder is NOT an answer', () => {
  // The case every field-presence check gets wrong: Product exists, offers
  // exists, price exists — and holds "{{ product.price }}".
  const r = evaluateAnswerability(pdpWith({
    jsonLd: [{ '@type': 'Product', name: 'Runner',
      offers: { price: '{{ product.price }}', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } }],
    text: 'Runner. A shoe.', title: 'Runner', metaDescription: null,
  }));
  ok(r.unanswered.some((q) => q.id === 'price'), 'a placeholder price must not count as answered');
  ok(r.answered.some((q) => q.id === 'currency'), 'but a real sibling field still does');
});

t('a resolved price from markup beats one scraped from prose', () => {
  const structured = evaluateAnswerability(pdpWith({
    jsonLd: [{ '@type': 'Product', name: 'Runner', offers: { price: '98.00', priceCurrency: 'USD' } }],
    text: 'Runner', title: 'Runner', metaDescription: null,
  }));
  const prose = evaluateAnswerability(pdpWith({
    jsonLd: [], text: 'Runner costs $98.00 today', title: 'Runner', metaDescription: null,
  }));
  ok(structured.answered.find((a) => a.id === 'price').from.includes('offers.price'));
  ok(prose.answered.find((a) => a.id === 'price').from.includes('page text'));
  ok(prose.proseOnly.length > 0, 'prose answers are tracked separately — they are weaker');
  ok(structured.proseOnly.every((a) => a.id !== 'price'), 'a structured answer is not prose-only');
});

t('answerability reads the machine payload, never the rendered DOM', () => {
  const obs = pdpWith(null);
  obs.retrieval.static = null;
  // The rendered page is complete; the machine payload is absent.
  obs.retrieval.jsonLd = [{ type: 'Product', offers: { price: true } }];
  const r = evaluateAnswerability(obs);
  eq(r.measurable, false, 'with no static payload it must refuse to answer');
  eq(r.score, null, 'and must not invent a score from the rendered DOM');
});

t('a fully answerable product page reports every critical question resolved', () => {
  const r = evaluateAnswerability(pdpWith({
    jsonLd: [
      { '@type': 'Product', name: 'Runner', description: 'A lightweight running shoe for daily mileage and long runs.',
        offers: { price: '98.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } },
      { '@type': 'Organization', name: 'Fixture' },
    ],
    text: 'Runner. Free returns within 30 days.', title: 'Runner', metaDescription: null,
  }));
  eq(r.criticalMissing.length, 0, `critical questions unresolved: ${r.criticalMissing.join(',')}`);
  ok(r.score >= 75, `score was ${r.score}`);
});

t('a critical unanswerable question outranks an optional one', () => {
  const mk = (payload) => analyze({
    observations: [pdpWith(payload), { ...pdpWith(payload), url: 'https://s.com/products/y' }],
    site: 's',
  }).findings.find((f) => f.checkId === 'engine-unanswerable-pdp');

  const noPrice = mk({ jsonLd: [{ '@type': 'Product', name: 'R' }], text: 'R', title: 'R', metaDescription: null });
  const noReviews = mk({
    jsonLd: [{ '@type': 'Product', name: 'R', description: 'A shoe that is good for running long distances.',
      offers: { price: '98', priceCurrency: 'USD', availability: 'InStock' } }],
    text: 'R. Returns within 30 days. Sold by Fixture.', title: 'R', metaDescription: null,
  });
  ok(noPrice.impact > (noReviews?.impact ?? 0), 'an unrecoverable price must outrank a missing review count');
});

// --- crawler probe -----------------------------------------------------------

const withProbe = (probeAgents, robotsAgents) => ({
  origin: 'https://s.com',
  robots: { present: true, sitemaps: [], agents: robotsAgents },
  llmsTxt: { present: true },
  probe: { ran: true, pagesProbed: ['https://s.com/'], agents: probeAgents },
});

t('robots.txt permitting a crawler the server refuses is the finding', () => {
  const f = analyze({
    observations: messySite(), site: 's',
    siteSignals: withProbe(
      { GPTBot: { state: 'refused', status: 403, operator: 'OpenAI', detail: { bytes: 39, baselineBytes: 1900 } } },
      { GPTBot: { state: 'allowed', by: 'wildcard rule', operator: 'OpenAI', purpose: 'x' } },
    ),
  }).findings.find((x) => x.checkId === 'engine-crawler-blocked-at-edge');
  ok(f, 'the disagreement must surface');
  eq(f.evidence.agents[0].statedPolicy, 'allowed');
  eq(f.evidence.agents[0].observed, 'refused');
  ok(/re-run|caveat/i.test(JSON.stringify(f.evidence)), 'and must caveat a single probe');
});

t('a block that robots.txt and the server agree on is only recorded', () => {
  const fs = analyze({
    observations: messySite(), site: 's',
    siteSignals: withProbe(
      { GPTBot: { state: 'refused', status: 403, operator: 'OpenAI', detail: {} } },
      { GPTBot: { state: 'blocked', by: 'explicit GPTBot block', operator: 'OpenAI', purpose: 'x' } },
    ),
  }).findings;
  ok(!fs.some((f) => f.checkId === 'engine-crawler-blocked-at-edge'), 'no contradiction, so no alarm');
  const confirmed = fs.find((f) => f.checkId === 'engine-crawler-block-confirmed');
  ok(confirmed && confirmed.priority < 40, 'recorded, but it must not crowd real findings');
});

t('a challenge page counts as turned away even with a 200 status', () => {
  const f = analyze({
    observations: messySite(), site: 's',
    siteSignals: withProbe(
      { PerplexityBot: { state: 'challenged', status: 200, operator: 'Perplexity', detail: { bytes: 152, baselineBytes: 1900 } } },
      { PerplexityBot: { state: 'allowed', by: 'wildcard rule', operator: 'Perplexity', purpose: 'x' } },
    ),
  }).findings.find((x) => x.checkId === 'engine-crawler-blocked-at-edge');
  ok(f, 'a 200 that serves an interstitial is still a refusal');
});

t('probe findings and answerability belong to marketing', () => {
  for (const id of ['engine-crawler-blocked-at-edge', 'engine-unanswerable-pdp', 'engine-answers-prose-only']) {
    eq(ownerFor(id, 'engine'), 'marketing', id);
  }
});

// --- machine parity ---------------------------------------------------------

const parityObs = (jsonLd, rendered, extra = {}) => ({
  ...messySite()[0], surface: 'pdp', url: 'https://s.com/products/x',
  retrieval: {
    jsonLd: [], jsonLdTypes: [], jsonLdErrors: [], title: 'T', metaDescription: null,
    canonical: extra.canonical ?? null, h1Count: 1, h1Text: [rendered.h1], contentRatio: 0.8,
    questionHeadings: 0, hasFaqSchema: false, lang: 'en', mainTextLength: 800, totalTextLength: 1000,
    rendered,
    static: { fetched: true, textRatio: 1, h1InStatic: true, jsonLdTypesInStatic: ['Product'],
      jsonLdOnlyAfterJs: [], payload: { jsonLd, text: '', title: extra.staticTitle ?? rendered.title, metaDescription: null } },
  },
});

const PRODUCT = (price, availability) => [{
  '@type': 'Product', name: 'Runner',
  offers: { '@type': 'Offer', price, priceCurrency: 'USD', availability },
}];

t('a price the markup and the page disagree on is found', () => {
  const r = evaluateParity(parityObs(
    PRODUCT('49.00', 'https://schema.org/InStock'),
    { h1: 'Runner', title: 'T', price: { value: 79, symbol: '$' }, availability: 'available', url: 'https://s.com/products/x' },
  ));
  const price = r.checks.find((c) => c.id === 'price');
  eq(price.state, 'disagree');
  eq(price.machine, '49');
  eq(price.human, '79');
});

t('float noise is not a disagreement', () => {
  const r = evaluateParity(parityObs(
    PRODUCT('98.00', 'https://schema.org/InStock'),
    { h1: 'Runner', title: 'T', price: { value: 98.001, symbol: '$' }, availability: 'available', url: 'https://s.com/products/x' },
  ));
  eq(r.checks.find((c) => c.id === 'price').state, 'agree');
});

t('a variant price range agrees when the shown price is inside it', () => {
  const agg = [{ '@type': 'Product', name: 'Runner',
    offers: { '@type': 'AggregateOffer', lowPrice: '80.00', highPrice: '120.00', priceCurrency: 'USD' } }];
  const inside = evaluateParity(parityObs(agg,
    { h1: 'Runner', title: 'T', price: { value: 98, symbol: '$' }, availability: 'available', url: 'https://s.com/p' }));
  const outside = evaluateParity(parityObs(agg,
    { h1: 'Runner', title: 'T', price: { value: 140, symbol: '$' }, availability: 'available', url: 'https://s.com/p' }));
  eq(inside.checks.find((c) => c.id === 'price').state, 'agree', 'inside the range is fine');
  eq(outside.checks.find((c) => c.id === 'price').state, 'disagree', 'outside it is not');
});

t('InStock markup over a sold-out page is caught', () => {
  const r = evaluateParity(parityObs(
    PRODUCT('98.00', 'https://schema.org/InStock'),
    { h1: 'Runner', title: 'T', price: { value: 98, symbol: '$' }, availability: 'unavailable', url: 'https://s.com/p' },
  ));
  eq(r.checks.find((c) => c.id === 'availability').state, 'disagree');
});

t('a dollar symbol is not treated as one currency', () => {
  // "$" is USD, CAD, AUD and others. Calling it a mismatch invents a defect
  // the page could not have resolved either.
  const r = evaluateParity(parityObs(
    [{ '@type': 'Product', name: 'R', offers: { price: '98', priceCurrency: 'CAD' } }],
    { h1: 'R', title: 'T', price: { value: 98, symbol: '$' }, availability: 'available', url: 'https://s.com/p' },
  ));
  eq(r.checks.find((c) => c.id === 'currency').state, 'agree');
});

t('a placeholder price is unmeasurable, not a mismatch', () => {
  const r = evaluateParity(parityObs(
    PRODUCT('{{ product.price }}', 'https://schema.org/InStock'),
    { h1: 'Runner', title: 'T', price: { value: 98, symbol: '$' }, availability: 'available', url: 'https://s.com/p' },
  ));
  eq(r.checks.find((c) => c.id === 'price').state, 'unmeasurable',
    'silence is not agreement, and an unfilled template is not a contradiction');
});

t('parity refuses to score without both views', () => {
  const o = parityObs(PRODUCT('98', 'InStock'),
    { h1: 'R', title: 'T', price: { value: 98, symbol: '$' }, availability: 'available', url: 'https://s.com/p' });
  o.retrieval.static = null;
  const r = evaluateParity(o);
  eq(r.measurable, false);
  eq(r.score, null);
});

t('a name that extends the h1 is not a mismatch', () => {
  const r = evaluateParity(parityObs(
    [{ '@type': 'Product', name: 'Runner — Trail Shoe', offers: { price: '98', priceCurrency: 'USD' } }],
    { h1: 'Runner', title: 'T', price: { value: 98, symbol: '$' }, availability: 'available', url: 'https://s.com/p' },
  ));
  eq(r.checks.find((c) => c.id === 'name').state, 'agree');
});

t('parity moves the score and groups findings by field, not by page', () => {
  const bad = { h1: 'Runner', title: 'T', price: { value: 79, symbol: '$' }, availability: 'available', url: 'https://s.com/p1' };
  const obs = [
    parityObs(PRODUCT('49.00', 'https://schema.org/InStock'), bad),
    { ...parityObs(PRODUCT('49.00', 'https://schema.org/InStock'), { ...bad, url: 'https://s.com/p2' }), url: 'https://s.com/products/y' },
  ];
  const r = analyze({ observations: obs, site: 's' });
  const dim = r.consistency.dimensions.find((d) => d.key === 'machine-parity');
  ok(typeof dim.score === 'number' && dim.score < 100, `parity must move the score, got ${dim.score}`);
  eq(r.consistency.byGroup['Machine parity'].axis, 'engine');

  const priceFindings = r.findings.filter((f) => f.checkId === 'engine-parity-price');
  eq(priceFindings.length, 1, 'one finding for the field, not one per page');
  eq(priceFindings[0].evidence.pagesAffected, 2);
  ok(priceFindings[0].impact >= 9, 'a wrong quoted price is as severe as it gets');
});

t('severity bands count problems, not strengths', () => {
  const r = analyze({ observations: messySite(), site: 'm' });
  const files = buildBundle(r);
  const manifest = JSON.parse(files['report/manifest.json']);
  const bandTotal = Object.values(manifest.counts.bands).reduce((a, b) => a + b, 0);
  eq(bandTotal, manifest.counts.problems,
    'the headline count and the severity distribution must agree');
  eq(manifest.counts.problems + manifest.counts.strengths, manifest.counts.total);
});

t('START HERE is self-contained and links into report/', () => {
  const files = buildBundle(analyze({ observations: messySite(), site: 'm' }));
  const start = files['START HERE.html'];
  ok(!/<link[^>]+stylesheet/i.test(start), 'no external stylesheet — it must open from anywhere');
  ok(!/<script[^>]+src=/i.test(start), 'no external script');
  ok(start.includes('report/site/index.html'), 'links into the report');
  for (const m of start.matchAll(/href="(report\/[^"]+)"/g)) {
    ok(files[m[1]], `START HERE links to a file that exists: ${m[1]}`);
  }
});

// --- report ----------------------------------------------------------------

t('a contrast failure in the token seed becomes a Finding', () => {
  const obs = cleanSite();
  // A primary that fails AA as text on white.
  for (const o of obs) o.roles.primaryButton.background = '#dd3844';
  const r = analyze({ observations: obs, site: 'c' });
  const f = r.findings.find((x) => x.checkId === 'design-contrast-token');
  ok(f, 'the design review showed this; the findings report must too');
  ok(f.priority >= 63, `a trivially-fixable legibility failure should rank high, got ${f.priority}`);
});

t('quality checks do NOT move the consistency score', () => {
  const clean = analyze({ observations: cleanSite(), site: 'c' });
  const dirty = cleanSite();
  for (const o of dirty) {
    o.a11y = { smallTapTargets: 30, imagesMissingAlt: 20, imagesTotal: 20,
      headingJumps: 5, unlabeledControls: 8, contrastFailures: [] };
  }
  const withDefects = analyze({ observations: dirty, site: 'c' });
  eq(withDefects.consistency.overall, clean.consistency.overall,
    'the score measures consistency only — defects must not bleed into it');
  ok(withDefects.findings.length > clean.findings.length, 'but the findings must appear');
});

t('rhythmAdherence never reports a meaningless 2px or 3px base', () => {
  // Every value here is even, so a 2px base would fit perfectly and say nothing.
  const r = rhythmAdherence([[10, 50], [20, 40], [30, 30], [50, 20]].map(([value, count]) => ({ value, count })));
  ok(r.base >= 4, `base ${r.base} is arithmetic, not a design decision`);
  eq(r.base, 10, 'should take the coarsest base actually honoured');
});

t('rhythmAdherence reports low adherence rather than inventing a fine base', () => {
  const r = rhythmAdherence([[8, 10], [13, 10], [21, 10], [34, 10]].map(([value, count]) => ({ value, count })));
  ok(r.base >= 4, 'no sub-4px bases');
  ok(r.adherence < 0.8, 'a site with no grid should report as having no grid');
});

t('ready-to-port does not call a site clean while blockers exist', () => {
  const obs = cleanSite();
  for (const o of obs) o.roles.primaryButton.background = '#dd3844'; // fails AA
  const r = analyze({ observations: obs, site: 'c' });
  const meta = r.findings.find((f) => f.checkId === 'meta-ready-to-port');
  if (meta) {
    ok(!/polish, not blockers/.test(meta.recommendation),
      'must not claim the remainder is polish when a critical finding exists');
    ok(meta.evidence.blockingFindings.length > 0, 'and must name the blockers');
  }
});

t('type scale step names are always unique', () => {
  for (const obs of [cleanSite(), messySite()]) {
    const scale = analyze({ observations: obs, site: 't' }).tokens.typography.scale;
    const names = scale.map((s) => s.name);
    eq(new Set(names).size, names.length,
      `duplicate step names make the scale unusable as tokens: ${names.join(' ')}`);
  }
});

t('spacing never advises snapping a value to 0px', () => {
  for (const obs of [cleanSite(), messySite()]) {
    const sp = analyze({ observations: obs, site: 't' }).tokens.spacing;
    ok(sp.strays.every((s) => s.nearest >= sp.base), 'nearest step is at least one base unit');
  }
});

t('sub-4px hairlines are excluded from spacing rhythm', () => {
  const obs = cleanSite();
  // A pile of 1px borders must not read as a rhythm violation.
  for (const o of obs) o.styles.spacing = [...o.styles.spacing, { value: '1px', count: 900 }];
  const r = analyze({ observations: obs, site: 't' });
  ok(r.tokens.spacing.adherence > 0.9, `1px borders dragged adherence to ${r.tokens.spacing.adherence}`);
  ok(!r.tokens.spacing.steps.includes(1), 'and 1px is not a spacing step');
});

t('the score decomposes into groups that cover every dimension', () => {
  const r = analyze({ observations: messySite(), site: 'm' });
  const grouped = Object.values(r.consistency.byGroup).reduce((n, g) => n + g.declared, 0);
  eq(grouped, r.consistency.dimensions.length, 'every dimension belongs to exactly one group');
  for (const [, g] of Object.entries(r.consistency.byGroup)) {
    if (g.measured === 0) eq(g.score, null, 'an unmeasured group scores null, not 0');
  }
});

t('platform is detected and carried through to the report', () => {
  const obs = messySite();
  for (const o of obs) o.engine.platform = 'wordpress-woocommerce';
  const r = analyze({ observations: obs, site: 'm' });
  eq(r.platform, 'wordpress-woocommerce');
});

t('responsive differences are not reported as drift', () => {
  // The same three pages captured at two viewports. A button that is 48px on
  // desktop and 44px on mobile is responsive design; comparing across viewports
  // would report every such decision as drift, and would fire hardest on sites
  // that did responsive properly.
  const desktop = cleanSite().slice(0, 3).map((o) => ({
    ...o, viewport: { width: 1440, height: 800, label: 'desktop' },
  }));
  const mobile = desktop.map((o) => ({
    ...o,
    viewport: { width: 390, height: 640, label: 'mobile' },
    roles: { ...o.roles, primaryButton: { ...o.roles.primaryButton, height: 44, fontSize: 15 } },
  }));

  const oneViewport = analyze({ observations: desktop, site: 't' });
  const bothViewports = analyze({ observations: [...desktop, ...mobile], site: 't' });

  const drift = bothViewports.findings.filter((f) => f.checkId.startsWith('design-drift-'));
  eq(drift.length, 0, `adding a mobile capture invented ${drift.length} drift finding(s)`);
  eq(bothViewports.consistency.byAxis.design, oneViewport.consistency.byAxis.design,
    'the design score must not move just because a second viewport was captured');
});

t('a two-viewport run does not double-count CTA wording', () => {
  const base = messySite().slice(0, 3).map((o) => ({
    ...o, viewport: { width: 1440, height: 800, label: 'desktop' },
  }));
  const withMobile = [...base, ...base.map((o) => ({ ...o, viewport: { width: 390, height: 640, label: 'mobile' } }))];
  const one = analyze({ observations: base, site: 't' });
  const two = analyze({ observations: withMobile, site: 't' });
  const pagesOf = (r) => r.consistency.dimensions.find((d) => d.key === 'cta-language')?.detail?.pages;
  eq(pagesOf(two), pagesOf(one), 'wording is compared once per URL, not once per render');
});

// --- ownership --------------------------------------------------------------

t('every finding has a valid owner', () => {
  const r = analyze({ observations: messySite(), site: 'm' });
  for (const f of r.findings) {
    ok(OWNERS.includes(f.owner), `${f.checkId} has owner "${f.owner}"`);
  }
});

t('the Engine axis splits across two owners — that is the whole point', () => {
  // "third-party script set differs" and "no meta description" are both Engine
  // and are fixed by different people. If they land with the same owner, the
  // split has stopped doing its job.
  eq(ownerFor('engine-app-drift', 'engine'), 'engineering');
  eq(ownerFor('engine-perf-variance', 'engine'), 'engineering');
  eq(ownerFor('engine-missing-description', 'engine'), 'marketing');
  eq(ownerFor('engine-no-structured-data', 'engine'), 'marketing');
  eq(ownerFor('engine-ai-crawlers-blocked', 'engine'), 'marketing');
});

t('implementation bugs go to engineering even when the topic is marketing', () => {
  // Structured data is decided by marketing; a JSON-LD block that will not
  // parse is a Liquid escaping bug and nobody in marketing can fix it.
  eq(ownerFor('engine-malformed-jsonld', 'engine'), 'engineering');
  eq(ownerFor('engine-content-requires-js-pdp', 'engine'), 'engineering');
  eq(ownerFor('engine-schema-drift-pdp', 'engine'), 'marketing');
});

t('dark patterns and copy belong to marketing, not design', () => {
  for (const id of ['ux-confirmshaming', 'ux-pre-checked-optin', 'ux-urgency-pressure',
    'ux-cta-drift', 'ux-price-format-drift', 'ux-missing-alt']) {
    eq(ownerFor(id, 'ux'), 'marketing', id);
  }
});

t('meta-findings are owned by topic, not by whichever axis scored worst', () => {
  // A meta-finding takes its axis from the lowest-scoring axis, which says
  // nothing about who fixes it.
  eq(ownerFor('meta-weight-is-apps', 'design'), 'engineering');
  eq(ownerFor('meta-weight-is-apps', 'ux'), 'engineering');
  eq(ownerFor('meta-promise-gap', 'engine'), 'design');
});

t('owner is a tag, not a hierarchy — no owner is scored', () => {
  const r = analyze({ observations: messySite(), site: 'm' });
  ok(!r.consistency.byOwner, 'there must be no per-owner score');
  const keys = Object.keys(r.consistency);
  ok(!keys.some((k) => /owner/i.test(k)), `consistency must not mention owners, has: ${keys.join(',')}`);
});

t('owner pages are linked views, not copies', () => {
  const r = analyze({ observations: messySite(), site: 'm' });
  const files = buildBundle(r);
  const ownerPages = Object.keys(files).filter((f) => /^report\/pages\/for-/.test(f));
  ok(ownerPages.length >= 2, `expected owner pages, got ${ownerPages.join(',')}`);

  // Every finding appears exactly once in findings/, however many views cite it.
  const findingFiles = Object.keys(files).filter((f) => f.startsWith('report/findings/'));
  eq(findingFiles.length, r.findings.length, 'one file per finding regardless of how many pages link it');

  const manifest = JSON.parse(files['report/manifest.json']);
  const total = Object.values(manifest.byOwner).reduce((a, b) => a + b, 0);
  eq(total, r.findings.length, 'the owner split partitions the pile exactly — no finding in two lists, none missing');
});

t('byOwner partitions the findings with no overlap', () => {
  const r = analyze({ observations: messySite(), site: 'm' });
  const counts = OWNERS.map((o) => byOwner(r.findings, o).length);
  eq(counts.reduce((a, b) => a + b, 0), r.findings.length);
});

t('severity bands count problems, not strengths', () => {
  const r = analyze({ observations: messySite(), site: 'm' });
  const files = buildBundle(r);
  const manifest = JSON.parse(files['report/manifest.json']);
  const bandTotal = Object.values(manifest.counts.bands).reduce((a, b) => a + b, 0);
  eq(bandTotal, manifest.counts.problems,
    'the headline count and the severity distribution must agree');
  eq(manifest.counts.problems + manifest.counts.strengths, manifest.counts.total);
});

t('START HERE is self-contained and links into report/', () => {
  const files = buildBundle(analyze({ observations: messySite(), site: 'm' }));
  const start = files['START HERE.html'];
  ok(!/<link[^>]+stylesheet/i.test(start), 'no external stylesheet — it must open from anywhere');
  ok(!/<script[^>]+src=/i.test(start), 'no external script');
  ok(start.includes('report/site/index.html'), 'links into the report');
  for (const m of start.matchAll(/href="(report\/[^"]+)"/g)) {
    ok(files[m[1]], `START HERE links to a file that exists: ${m[1]}`);
  }
});

// --- report ----------------------------------------------------------------

for (const [status, name] of results) {
  if (status === 'FAIL') console.log(`  \x1b[31m${status}\x1b[0m  ${name}`);
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
