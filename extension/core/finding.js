/**
 * The Achado (Finding) — EchoFlow 2.0's single primitive.
 *
 * Everything the system produces has this shape. There is one kind of thing;
 * every view (axis page, surface page, client report, tokens export) is a query
 * over the pile of Findings. If something cannot be expressed as a Finding, it
 * does not belong in the output.
 *
 * @module core/finding
 */

/** Which page the finding is about. `site` = holds across the whole store. */
export const SURFACES = /** @type {const} */ ([
  'site', 'home', 'plp', 'pdp', 'cart', 'checkout', 'search', 'account', 'content',
]);

export const SURFACE_LABELS = {
  site: 'Site-wide',
  home: 'Home',
  plp: 'Collection / PLP',
  pdp: 'Product / PDP',
  cart: 'Cart',
  checkout: 'Checkout',
  search: 'Search',
  account: 'Account',
  content: 'Content pages',
};

/**
 * Axis is a TAG, never a top-level structure. v1 made the three axes the report's
 * spine and got three silos that never talked; the report is organised by the
 * reader's decision (priority, then surface), and axis is a filter over that.
 */
export const AXES = /** @type {const} */ (['design', 'ux', 'engine']);

export const AXIS_LABELS = {
  design: 'Design',
  ux: 'UX',
  engine: 'Engine',
};

/**
 * Scope rule: it is not the *analysis* that is single-page or site-wide, it is
 * the *check*.
 *   extractive  — reads what is on one page. Runs at any scope.
 *   comparative — needs the whole site to mean anything (consistency, journey
 *                 coherence). Refuses to emit on a single page.
 */
export const SCOPES = /** @type {const} */ (['extractive', 'comparative']);

/** Meta-findings come from cross-axis synthesis, not from a single check. */
export const KINDS = /** @type {const} */ (['finding', 'meta', 'strength']);

/**
 * What licenses the claim.
 *
 * The failure mode of an audit tool is sounding more certain than the evidence
 * allows, and the fix is to make the three kinds of claim visibly different in
 * the output rather than letting a convention borrow the authority of a
 * standard.
 *
 *   prescriptive  A published criterion with a number. Pass/fail, checkable,
 *                 citable (WCAG 2.5.8, 1.4.3). State plainly.
 *   practice      Strong convergent convention with no governing body — the
 *                 45-75 character measure, the 12px floor, token budgets. Say
 *                 "outside established practice", never "fails".
 *   directional   Effects observed elsewhere (conversion ranges, benchmarks).
 *                 Quote as a range, attribute to others, pair with "worth
 *                 testing on your traffic". Never project onto this client.
 */
export const BASES = /** @type {const} */ (['prescriptive', 'practice', 'directional']);

/**
 * Who owns the fix.
 *
 * A SECOND TAG, exactly like `surface` — not a hierarchy, not a score, not a
 * new record. It exists because the axes answer "what kind of problem is this"
 * and a reader also needs "is this mine". The Engine axis in particular mixes
 * two audiences badly: "third-party script set differs across pages" and "no
 * meta description" are both Engine, and a developer fixes one while a
 * marketer fixes the other.
 *
 * The question is who DECIDES, not who types. Structured data is implemented
 * in Liquid but decided by whoever owns the catalogue copy, so it is marketing.
 * A malformed JSON-LD block is a Liquid escaping bug, so it is engineering.
 *
 * There is deliberately no per-owner score. Owner pages are filtered views of
 * the one pile, reached by link — the same thing surface pages already are.
 */
export const OWNERS = /** @type {const} */ (['design', 'marketing', 'engineering']);

export const OWNER_LABELS = {
  design: 'Design',
  marketing: 'Marketing & content',
  engineering: 'Engineering',
};

export const OWNER_BRIEF = {
  design: 'Layout, type, colour and component decisions. Fixed in the design system and the theme\u2019s settings.',
  marketing: 'What the store says and how machines read it \u2014 copy, structured data, metadata, crawler access, and the persuasion patterns in use. Mostly content and settings work, not code.',
  engineering: 'How the site is built and served \u2014 rendering, apps, scripts, performance, and markup correctness. Needs a developer.',
};

export const BASIS_LABELS = {
  prescriptive: 'Standard',
  practice: 'Established practice',
  directional: 'Directional',
};

export const BASIS_NOTE = {
  prescriptive: 'A published criterion with a threshold. This is pass/fail and can be cited.',
  practice: 'Convergent convention, not a governing standard. Outside established practice, not "failing".',
  directional: 'An effect observed on other catalogues. A reason to test on your traffic, not a projection.',
};

const clamp10 = (n) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));

/**
 * Deterministic id so the same finding on the same site keeps the same anchor
 * across runs — the wiki links by id, and re-running must not break links.
 */
function fingerprint(parts) {
  const s = parts.filter(Boolean).join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(7, '0');
}

/**
 * Build a Finding. Throws on anything structurally wrong — a malformed Finding
 * is a bug in a check, and silently dropping it is how dumps start.
 *
 * @param {object} input
 * @param {string} input.checkId       id of the check that produced this
 * @param {string} input.title         one line, the finding itself
 * @param {string} input.surface       one of SURFACES
 * @param {string} input.axis          one of AXES — a tag
 * @param {number} input.impact        1-10, how much it weighs
 * @param {number} input.effort        1-10 — HOW EASY TO FIX. 10 = trivial.
 *                                     Named for the doc's "Esforço"; scored as ease
 *                                     so priority = impact x effort reads high-to-low.
 * @param {object} input.evidence      the extracted data that proves it
 * @param {string} input.recommendation what to do
 * @param {string} [input.scope]       'extractive' | 'comparative'
 * @param {string} [input.kind]        'finding' | 'meta'
 * @param {string} [input.url]         page it was observed on
 * @param {string} [input.selector]    element it points at
 * @param {string[]} [input.refs]      knowledge-base keys backing the recommendation
 * @param {string[]} [input.derivedFrom] ids of findings a meta-finding synthesises
 * @param {string} [input.basis]       'prescriptive' | 'practice' | 'directional'
 * @param {string} [input.citation]    the specific criterion, e.g. "WCAG 2.2 SC 2.5.8"
 * @param {string} [input.owner]       'design' | 'marketing' | 'engineering'
 * @returns {Finding}
 */
export function createFinding(input) {
  const {
    checkId, title, surface, axis, impact, effort, evidence, recommendation,
    scope = 'extractive', kind = 'finding', url = null, selector = null,
    refs = [], derivedFrom = [], basis = 'practice', citation = null, owner = null,
  } = input;

  if (!checkId) throw new Error('Finding requires checkId');
  if (!title) throw new Error(`Finding ${checkId} requires a title`);
  if (!SURFACES.includes(surface)) throw new Error(`Finding ${checkId}: bad surface "${surface}"`);
  if (!AXES.includes(axis)) throw new Error(`Finding ${checkId}: bad axis "${axis}"`);
  if (!SCOPES.includes(scope)) throw new Error(`Finding ${checkId}: bad scope "${scope}"`);
  if (!KINDS.includes(kind)) throw new Error(`Finding ${checkId}: bad kind "${kind}"`);
  if (!BASES.includes(basis)) throw new Error(`Finding ${checkId}: bad basis "${basis}"`);
  const resolvedOwner = owner || ownerFor(checkId, axis);
  if (!OWNERS.includes(resolvedOwner)) throw new Error(`Finding ${checkId}: bad owner "${resolvedOwner}"`);
  // A prescriptive claim without a criterion to point at is an opinion wearing
  // a lab coat, and vague appeals to "accessibility guidelines" are exactly what
  // make a client suspect the whole report.
  if (basis === 'prescriptive' && !citation) {
    throw new Error(`Finding ${checkId}: basis "prescriptive" requires a citation (e.g. "WCAG 2.2 SC 2.5.8")`);
  }
  if (!recommendation) throw new Error(`Finding ${checkId} requires a recommendation`);
  if (evidence == null || typeof evidence !== 'object') {
    throw new Error(`Finding ${checkId} requires an evidence object — a finding without evidence is an opinion`);
  }

  const i = clamp10(impact);
  const e = clamp10(effort);

  return Object.freeze({
    id: `${checkId}-${fingerprint([surface, url, selector, JSON.stringify(evidence)])}`,
    checkId, kind, title, surface, axis,
    impact: i,
    effort: e,
    priority: i * e,
    evidence, recommendation, scope, url, selector,
    basis, citation,
    owner: resolvedOwner,
    refs: Object.freeze([...refs]),
    derivedFrom: Object.freeze([...derivedFrom]),
  });
}

/**
 * Default owner from the check id, so nothing is ever unowned and a new check
 * does not silently land in the wrong team's list.
 *
 * Explicit prefixes first; then the axis as a fallback, which is right often
 * enough (design checks are design work) and wrong exactly where the Engine
 * axis is ambiguous — which is what the explicit list is for.
 *
 * @param {string} checkId
 * @param {string} axis
 */
function ownerFor(checkId, axis) {
  // Marketing decides these, whoever implements them.
  const MARKETING = [
    'engine-ai-crawlers-blocked', 'engine-no-robots-txt', 'engine-no-llms-txt',
    'engine-no-structured-data', 'engine-missing-schema', 'engine-incomplete-product-schema',
    'engine-schema-drift', 'engine-metadata-drift', 'engine-missing-description',
    'engine-thin-content', 'engine-unmarked-faq', 'engine-h1-structure',
    'strength-product-schema',
    'ux-missing-alt', 'ux-cta-drift', 'ux-price-format-drift',
    'ux-confirmshaming', 'ux-pre-checked-optin', 'ux-urgency-pressure',
    'ux-hard-to-cancel', 'ux-late-costs', 'ux-disguised-promos',
  ];
  // A developer has to touch these, whoever asked for them.
  const ENGINEERING = [
    // Meta-findings take their AXIS from whichever axis scored worst, which is
    // meaningless for ownership — a synthesis about app weight is engineering
    // work whether or not design happened to score lower that run.
    'meta-weight-is-apps',
    'engine-lcp', 'engine-cls', 'engine-page-weight', 'engine-eager-images',
    'engine-app-drift', 'engine-perf-variance', 'engine-section-sprawl',
    'engine-malformed-jsonld', 'engine-content-requires-js', 'engine-no-lang',
    'strength-server-rendered',
  ];

  // Cross-axis syntheses are about the system as a whole; design leads the
  // response to all of them except the app-weight one above.
  if (ENGINEERING.some((p) => checkId.startsWith(p))) return 'engineering';
  if (MARKETING.some((p) => checkId.startsWith(p))) return 'marketing';
  if (checkId.startsWith('meta-')) return 'design';
  if (axis === 'engine') return 'engineering';
  return 'design';
}

export { ownerFor };

/** @param {Finding[]} findings */
export const byOwner = (findings, owner) => findings.filter((f) => f.owner === owner);

/** @typedef {ReturnType<typeof createFinding>} Finding */

/**
 * Effort as a word, for the client-facing density where a 1-10 number is noise.
 * @param {number} effort
 */
export function effortLabel(effort) {
  if (effort >= 9) return 'trivial';
  if (effort >= 7) return 'small';
  if (effort >= 5) return 'medium';
  if (effort >= 3) return 'large';
  return 'major';
}

/**
 * The one ranking model. Impact x effort, banded. There is no second score and
 * no per-axis score — five loose numbers nobody knows how to add up is exactly
 * what 2.0 exists to kill.
 * @param {number} priority
 */
export function priorityBand(priority) {
  if (priority >= 63) return 'critical';
  if (priority >= 40) return 'high';
  if (priority >= 20) return 'medium';
  return 'low';
}

export const BAND_ORDER = ['critical', 'high', 'medium', 'low'];

/** Client density shows only this band and above. */
export const CLIENT_THRESHOLD = 40;

/**
 * Strengths are Findings too — same record, positive valence. Naming what works
 * and why is what lets it survive the next redesign, and a report that only
 * ever accuses is easy to dismiss wholesale.
 */
export const isStrength = (f) => f.kind === 'strength';

/**
 * Sort a pile of Findings the way the report reads: worst-first, ties broken by
 * impact so a big-and-hard beats a small-and-easy at equal priority.
 * @param {Finding[]} findings
 */
export function rank(findings) {
  // Strengths never outrank problems — they are context, not work.
  return [...findings].sort((a, b) =>
    (isStrength(a) - isStrength(b))
    || b.priority - a.priority || b.impact - a.impact || a.checkId.localeCompare(b.checkId));
}

/**
 * Drop duplicate findings. Site-wide runs visit many pages and the same check
 * fires on each; identical evidence is one finding, not N.
 * @param {Finding[]} findings
 */
export function dedupe(findings) {
  const seen = new Map();
  for (const f of findings) if (!seen.has(f.id)) seen.set(f.id, f);
  return [...seen.values()];
}

/** @param {Finding[]} findings */
export const byAxis = (findings, axis) => findings.filter((f) => f.axis === axis);
/** @param {Finding[]} findings */
export const bySurface = (findings, surface) => findings.filter((f) => f.surface === surface);
/** @param {Finding[]} findings */
export const forClient = (findings) => findings.filter((f) => f.priority >= CLIENT_THRESHOLD);
