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
export const KINDS = /** @type {const} */ (['finding', 'meta']);

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
 * @returns {Finding}
 */
export function createFinding(input) {
  const {
    checkId, title, surface, axis, impact, effort, evidence, recommendation,
    scope = 'extractive', kind = 'finding', url = null, selector = null,
    refs = [], derivedFrom = [],
  } = input;

  if (!checkId) throw new Error('Finding requires checkId');
  if (!title) throw new Error(`Finding ${checkId} requires a title`);
  if (!SURFACES.includes(surface)) throw new Error(`Finding ${checkId}: bad surface "${surface}"`);
  if (!AXES.includes(axis)) throw new Error(`Finding ${checkId}: bad axis "${axis}"`);
  if (!SCOPES.includes(scope)) throw new Error(`Finding ${checkId}: bad scope "${scope}"`);
  if (!KINDS.includes(kind)) throw new Error(`Finding ${checkId}: bad kind "${kind}"`);
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
    refs: Object.freeze([...refs]),
    derivedFrom: Object.freeze([...derivedFrom]),
  });
}

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
 * Sort a pile of Findings the way the report reads: worst-first, ties broken by
 * impact so a big-and-hard beats a small-and-easy at equal priority.
 * @param {Finding[]} findings
 */
export function rank(findings) {
  return [...findings].sort((a, b) =>
    b.priority - a.priority || b.impact - a.impact || a.checkId.localeCompare(b.checkId));
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
