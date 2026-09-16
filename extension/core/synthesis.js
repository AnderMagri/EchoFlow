/**
 * Cross-axis synthesis.
 *
 * The axes run separately and write into the same format. This is what that
 * buys: once two or three axes have run, a pass over the combined pile finds
 * things no single axis could say — "the design promises premium and the UX
 * delivers generic" is not a design finding or a UX finding, it is the
 * relationship between them.
 *
 * Without this step, running three axes means three reports stapled together,
 * which is concatenation, which is the failure mode this version exists to fix.
 *
 * @module core/synthesis
 */

import { createFinding } from './finding.js';

/**
 * Each rule sees the aggregate scores and the finding pile, and either fires or
 * does not. Rules must be *relational* — if a rule only looks at one axis it
 * belongs in that axis, not here.
 */
const RULES = [
  {
    id: 'promise-gap',
    when: ({ byAxis }) => byAxis.design != null && byAxis.ux != null
      && byAxis.design >= 70 && byAxis.ux < 55,
    build: ({ byAxis }, findings) => ({
      title: 'The design system is disciplined; the experience built on it is not',
      impact: 8, effort: 6,
      evidence: {
        designConsistency: byAxis.design, uxConsistency: byAxis.ux,
        gap: byAxis.design - byAxis.ux,
        reading: 'Visual decisions were made once and held. Interaction decisions were made per page.',
      },
      recommendation: 'The tokens are portable, so the rebuild is cheap on the design side. Spend the saved budget on the flow: standardise CTA wording and template anatomy before the theme work starts.',
      derivedFrom: pick(findings, ['ux-cta-drift', 'ux-nav-drift'], 3),
    }),
  },
  {
    id: 'inverse-promise-gap',
    when: ({ byAxis }) => byAxis.design != null && byAxis.ux != null
      && byAxis.ux >= 70 && byAxis.design < 55,
    build: ({ byAxis }, findings) => ({
      title: 'The flows are coherent; the visual language they are wearing is not',
      impact: 7, effort: 7,
      evidence: {
        designConsistency: byAxis.design, uxConsistency: byAxis.ux,
        gap: byAxis.ux - byAxis.design,
        reading: 'Someone thought hard about the journey and never got a design system to express it in.',
      },
      recommendation: 'Keep the information architecture as-is through the migration. The work is a token pass: this is the cheap kind of inconsistency to fix, because nothing about the structure has to move.',
      derivedFrom: pick(findings, ['design-colour-sprawl', 'design-type-sprawl', 'design-rhythm-break'], 3),
    }),
  },
  {
    id: 'tokens-without-components',
    when: (agg, findings) => {
      const vocab = avgScore(agg, ['color-chromatic', 'type-scale', 'spacing-rhythm']);
      const drift = scoreOf(agg, 'component-drift');
      return vocab != null && drift != null && vocab >= 70 && drift < 60;
    },
    build: (agg, findings) => ({
      title: 'Tokens exist, but components are not using them',
      impact: 8, effort: 5,
      evidence: {
        vocabularyScore: avgScore(agg, ['color-chromatic', 'type-scale', 'spacing-rhythm']),
        componentDriftScore: scoreOf(agg, 'component-drift'),
        reading: 'The palette and scale are tight, yet the same component renders differently page to page — the values are being re-picked locally instead of referenced.',
      },
      recommendation: 'This is the best-case migration: the system is already decided, it is just not enforced. Build the components once as Shopify snippets bound to theme settings and the drift cannot come back.',
      derivedFrom: pick(findings, ['design-drift'], 4, true),
    }),
  },
  {
    id: 'weight-is-apps',
    when: (agg) => {
      const perf = scoreOf(agg, 'perf-variance');
      const apps = scoreOf(agg, 'app-footprint');
      return perf != null && apps != null && perf < 70 && apps < 80;
    },
    build: (agg, findings) => ({
      title: 'Performance varies because the app load varies, not because the pages differ',
      impact: 7, effort: 7,
      evidence: {
        perfVarianceScore: scoreOf(agg, 'perf-variance'),
        appFootprintScore: scoreOf(agg, 'app-footprint'),
        reading: 'Pages that disagree about which scripts to load also disagree about how fast they are.',
      },
      recommendation: 'Audit app embeds before the rebuild, not after. Carrying the current app set into a new theme carries the variance with it, and it will read as the new theme being slow.',
      derivedFrom: pick(findings, ['engine-app-drift', 'engine-perf-variance'], 3),
    }),
  },
  {
    id: 'no-system-anywhere',
    when: ({ overall, byAxis }) => overall != null && overall < 45
      && Object.values(byAxis).filter((s) => s != null && s < 55).length >= 2,
    build: ({ overall, byAxis }, findings) => ({
      title: 'There is no system to port — one has to be chosen',
      impact: 10, effort: 3,
      evidence: {
        overall, byAxis,
        reading: 'Low scores on two or more axes at once means the site was assembled page by page. There is no underlying set of decisions to carry across.',
      },
      recommendation: 'Do not scope this as a migration. Scope it as a design project with a migration at the end — a theme rebuild that ports the current inconsistency will cost more than starting from Dawn and deciding the system once.',
      derivedFrom: topIds(findings, 5),
    }),
  },
  {
    id: 'ready-to-port',
    when: ({ overall }) => overall != null && overall >= 82,
    build: ({ overall, byAxis }, findings) => {
      // The consistency score deliberately excludes quality defects, so a site
      // can score 90 for coherence while carrying a critical contrast failure.
      // Saying "what remains is polish, not blockers" in that situation is
      // simply false, and it is the sentence a client would quote back. Check
      // the pile before making the claim.
      const blockers = findings.filter((f) => f.priority >= 63 && f.kind !== 'meta');
      return {
        title: blockers.length
          ? 'Consistent enough to port — but not before the blockers are fixed'
          : 'This site is ready to rebuild as-is',
        impact: blockers.length ? 7 : 6,
        effort: 9,
        evidence: {
          overall, byAxis,
          blockingFindings: blockers.map((f) => ({ id: f.id, title: f.title, priority: f.priority })),
          reading: blockers.length
            ? 'Decisions were made once and held, so the system is portable. Separately, there are defects that the consistency score does not measure and that should not travel into the new theme.'
            : 'Decisions were made once and held across the site. The design system is recoverable from the markup.',
        },
        recommendation: blockers.length
          ? `Take the extracted tokens straight into theme settings — the system is portable. But ${blockers.length} finding${blockers.length === 1 ? '' : 's'} above are defects rather than drift, and porting them forward makes them the new theme's problem. Fix those first.`
          : 'Take the extracted tokens straight into theme settings and build components against them. The audit findings that remain are polish, not blockers — ship the migration and fix them in the new theme.',
        derivedFrom: blockers.length ? blockers.slice(0, 4).map((f) => f.id) : topIds(findings, 3),
      };
    },
  },
];

/**
 * Run the synthesis pass.
 *
 * @param {object} aggregate result of consistency.aggregate()
 * @param {import('./finding.js').Finding[]} findings everything the axes produced
 * @returns {import('./finding.js').Finding[]} meta-findings
 */
export function synthesize(aggregate, findings) {
  const out = [];
  for (const rule of RULES) {
    let fires = false;
    try { fires = rule.when(aggregate, findings); } catch { fires = false; }
    if (!fires) continue;

    const spec = rule.build(aggregate, findings);
    out.push(createFinding({
      checkId: `meta-${rule.id}`,
      kind: 'meta',
      axis: dominantAxis(aggregate),
      surface: 'site',
      scope: 'comparative',
      ...spec,
    }));
  }
  return out;
}

// --- helpers ---------------------------------------------------------------

const scoreOf = (agg, key) => agg.dimensions?.find((d) => d.key === key)?.score ?? null;

function avgScore(agg, keys) {
  const vals = keys.map((k) => scoreOf(agg, k)).filter((v) => typeof v === 'number');
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

/** The axis carrying the most weight in the verdict, used to tag meta-findings. */
function dominantAxis(agg) {
  const entries = Object.entries(agg.byAxis || {}).filter(([, v]) => v != null);
  if (!entries.length) return 'design';
  return entries.sort((a, b) => a[1] - b[1])[0][0];
}

/** Ids of findings whose checkId matches, so a meta-finding can cite its sources. */
function pick(findings, checkIds, limit, prefix = false) {
  return findings
    .filter((f) => checkIds.some((id) => (prefix ? f.checkId.startsWith(id) : f.checkId === id)))
    .slice(0, limit)
    .map((f) => f.id);
}

const topIds = (findings, n) =>
  [...findings].sort((a, b) => b.priority - a.priority).slice(0, n).map((f) => f.id);
