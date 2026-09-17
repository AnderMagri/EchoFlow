/**
 * Manipulative-pattern checks.
 *
 * Brignull's dark-pattern taxonomy, restricted to what is mechanically
 * detectable: text matching and DOM state. No model, no judgement call.
 *
 * Two rules govern everything here, because these findings are ACCUSATIONS and
 * a false one is worse than a missed one:
 *
 * 1. Every finding carries the literal matched string or element. The reader
 *    must be able to look at the page and overrule the tool in one glance.
 * 2. The language describes the PATTERN, never the intent. "This is a
 *    confirmshaming construction" is checkable; "they are manipulating
 *    customers" is not, and it is not ours to assert from a regex.
 *
 * Several of these are regulated in the EU and UK. That is stated as context
 * for why they are worth fixing, not as a legal opinion.
 *
 * @module core/checks-patterns
 */

import { createFinding } from './finding.js';

const gather = (obs, key) => obs.flatMap((o) => (o.darkPatterns?.[key] || []));
const count = (obs, key) => obs.reduce((n, o) => n + (o.darkPatterns?.[key] || 0), 0);
const pageOf = (obs, key) => obs.find((o) => (o.darkPatterns?.[key] || []).length)?.url || null;

export const PATTERN_CHECKS = [

  {
    id: 'confirmshaming',
    axis: 'ux',
    run(ctx) {
      const hits = [...new Set(gather(ctx.observations, 'confirmshaming'))];
      if (!hits.length) return [];
      return [createFinding({
        checkId: 'ux-confirmshaming', axis: 'ux', surface: ctx.scopeSurface,
        scope: 'extractive', basis: 'practice',
        url: pageOf(ctx.observations, 'confirmshaming'),
        title: `Decline option is worded to shame the reader (${hits.length} instance${hits.length === 1 ? '' : 's'})`,
        impact: 6, effort: 9,
        evidence: {
          matched: hits,
          pattern: 'Confirmshaming (Brignull taxonomy) — the opt-out is phrased so that choosing it is an admission.',
          note: 'Matched by text pattern. Read the strings above and overrule this if they read neutrally in context.',
        },
        recommendation: 'Make the decline neutral: "No thanks" rather than "No, I don\'t want to save money". The shame wording buys a small lift on the modal and is remembered as the brand\'s voice, which is a bad trade.',
      })];
    },
  },

  {
    id: 'pre-checked-consent',
    axis: 'ux',
    run(ctx) {
      const hits = [...new Set(gather(ctx.observations, 'preCheckedOptIns'))];
      if (!hits.length) return [];
      return [createFinding({
        checkId: 'ux-pre-checked-optin', axis: 'ux', surface: ctx.scopeSurface,
        scope: 'extractive', basis: 'practice',
        url: pageOf(ctx.observations, 'preCheckedOptIns'),
        title: `${hits.length} marketing or consent checkbox${hits.length === 1 ? ' is' : 'es are'} pre-ticked`,
        // Defaults swing adoption enormously, which is exactly why a pre-ticked
        // consent box is not a small detail.
        impact: 7, effort: 9,
        evidence: {
          matched: hits,
          pattern: 'Pre-selected opt-in. Consent that was never actively given.',
          why: 'Opt-in versus opt-out defaults can swing adoption by 30-70%. A default is a design decision, not a neutral starting state.',
          regulatory: 'Pre-ticked consent boxes are restricted under GDPR and equivalent UK rules. Flagged as context, not as legal advice.',
        },
        recommendation: 'Ship these unticked. A list built from unticked boxes is smaller and worth more, and it removes a category of complaint entirely.',
      })];
    },
  },

  {
    id: 'manufactured-urgency',
    axis: 'ux',
    run(ctx) {
      const phrases = [...new Set(gather(ctx.observations, 'urgency'))];
      const timers = count(ctx.observations, 'countdownTimers');
      if (!phrases.length && !timers) return [];
      return [createFinding({
        checkId: 'ux-urgency-pressure', axis: 'ux', surface: ctx.scopeSurface,
        scope: 'extractive', basis: 'practice',
        title: `Urgency and scarcity cues on the page${timers ? ` (${timers} countdown element${timers === 1 ? '' : 's'})` : ''}`,
        impact: 4, effort: 8,
        evidence: {
          phrases, countdownElements: timers,
          pattern: 'Scarcity and urgency cues. Legitimate when the underlying fact is true and verifiable.',
          note: 'The tool cannot tell a real stock count from a decorative one. This is a prompt to check, not a verdict: if the number is live, it is fine; if the timer resets on reload, it is not.',
        },
        recommendation: 'Confirm each cue is backed by something real — genuine inventory, a genuine end date. A countdown that restarts on refresh is the version customers notice, and it discredits the honest ones next to it.',
      })];
    },
  },

  {
    id: 'roach-motel',
    axis: 'ux',
    run(ctx) {
      const hits = [...new Set(gather(ctx.observations, 'hardToLeave'))];
      if (!hits.length) return [];
      return [createFinding({
        checkId: 'ux-hard-to-cancel', axis: 'ux', surface: ctx.scopeSurface,
        scope: 'extractive', basis: 'practice',
        url: pageOf(ctx.observations, 'hardToLeave'),
        title: 'Cancelling appears to require a channel that signing up did not',
        impact: 7, effort: 5,
        evidence: {
          matched: hits,
          pattern: 'Roach motel (Brignull) — easy to enter, effortful to leave.',
          regulatory: 'Asymmetric cancellation is restricted in several jurisdictions. Context, not legal advice.',
        },
        recommendation: 'If subscribing takes one click, cancelling should too. The asymmetry does not retain customers so much as delay and annoy them, and it converts a quiet churn into a public complaint.',
      })];
    },
  },

  {
    id: 'late-costs',
    axis: 'ux',
    run(ctx) {
      const hits = [...new Set(gather(ctx.observations, 'lateCosts'))];
      if (!hits.length) return [];
      return [createFinding({
        checkId: 'ux-late-costs', axis: 'ux', surface: ctx.scopeSurface,
        scope: 'extractive', basis: 'practice',
        url: pageOf(ctx.observations, 'lateCosts'),
        title: 'Costs are deferred to checkout rather than shown with the price',
        impact: 6, effort: 5,
        evidence: {
          matched: hits,
          pattern: 'Hidden costs (Brignull) — fees revealed at the final step.',
          why: 'Unexpected extra cost at checkout is consistently the most-cited reason for cart abandonment in ecommerce research.',
        },
        recommendation: 'Show shipping and fees on the product page, or state the threshold that removes them. The cost is paid either way; disclosing it early buys the trust instead of spending it.',
      })];
    },
  },

  {
    id: 'disguised-ads',
    axis: 'ux',
    run(ctx) {
      const n = count(ctx.observations, 'disguisedAds');
      if (n < 2) return [];
      return [createFinding({
        checkId: 'ux-disguised-promos', axis: 'ux', surface: ctx.scopeSurface,
        scope: 'extractive', basis: 'practice',
        title: `${n} promoted or sponsored blocks sit inside the content flow`,
        impact: 4, effort: 7,
        evidence: { elements: n, pattern: 'Disguised advertising — promotional content styled as editorial or product content.' },
        recommendation: 'Label promoted placements so they read as promotions. Blending them raises short-term clicks and teaches customers to distrust the surrounding content.',
      })];
    },
  },

  // Not a dark pattern — a performance defect, but it lives with the DOM
  // checks and there is no reason to collect it and say nothing.
  {
    id: 'eager-images',
    axis: 'engine',
    run(ctx) {
      const eager = ctx.observations.reduce((n, o) => n + (o.a11y?.imagesEager || 0), 0);
      const total = ctx.observations.reduce((n, o) => n + (o.a11y?.imagesTotal || 0), 0);
      if (!total || eager / total < 0.6 || eager < 8) return [];
      return [createFinding({
        checkId: 'engine-eager-images', axis: 'engine', surface: ctx.scopeSurface,
        scope: 'extractive', basis: 'practice',
        title: `${eager} of ${total} images load eagerly with no loading attribute`,
        impact: 5, effort: 8,
        evidence: { eager, total, share: +(eager / total).toFixed(2) },
        recommendation: 'Add loading="lazy" to everything below the fold and leave the hero eager. On a long storefront page this is usually the cheapest weight reduction available.',
      })];
    },
  },
];
