/**
 * Operability checks — can an agent act, or only look?
 *
 * The framing matters. Nothing here says a storefront SHOULD be operable by an
 * agent; that is a commercial decision and not this tool's to make. It reports
 * where the buy path stops for a machine, and leaves the decision alone.
 *
 * These are defects, not drift, so they produce Findings and do not move the
 * consistency score. Owner is engineering: every one of them is markup.
 *
 * @module core/checks-operability
 */

import { createFinding } from './finding.js';
import { evaluateOperability } from './operability.js';

function uniquePages(observations) {
  const seen = new Set();
  return observations.filter((o) => !seen.has(o.url) && seen.add(o.url));
}

export const OPERABILITY_CHECKS = [

  {
    id: 'buy-path',
    axis: 'engine',
    run(ctx) {
      const results = uniquePages(ctx.observations)
        .filter((o) => o.surface === 'pdp')
        .map((o) => evaluateOperability(o, ctx.siteSignals))
        .filter(Boolean);
      if (!results.length) return [];

      const out = [];

      // Group by WHERE the path stops. "Every PDP stops at variant selection"
      // is one template fault; per-product findings would bury it.
      const byStop = new Map();
      for (const r of results) {
        if (!r.stopsAt) continue;
        const key = r.stopsAt.id;
        if (!byStop.has(key)) byStop.set(key, { step: r.stopsAt, pages: [] });
        byStop.get(key).pages.push(r);
      }

      const SEVERITY = { 'add-to-cart': 9, 'select-variant': 8, identify: 7, 'read-cart': 5, checkout: 6 };

      for (const [id, { step, pages }] of byStop) {
        out.push(createFinding({
          checkId: `engine-agent-blocked-${id}`, axis: 'engine', surface: 'pdp',
          scope: 'extractive', basis: 'practice', url: pages[0].url,
          title: `An agent cannot get past "${step.label.toLowerCase()}" on ${pages.length} product page${pages.length === 1 ? '' : 's'}`,
          impact: SEVERITY[id] || 6,
          effort: id === 'read-cart' ? 5 : 6,
          evidence: {
            step: step.label,
            reason: step.detail,
            pagesAffected: pages.length,
            examples: pages.slice(0, 5).map((p) => p.url),
            fullPath: pages[0].steps.map((s) => ({ step: s.label, state: s.state, detail: s.detail })),
            framing: 'Whether the storefront should be operable by agents is a commercial decision. This reports where the path stops, not whether it ought to.',
          },
          recommendation: id === 'add-to-cart'
            ? 'Wrap the add-to-cart control in a real form that POSTs to /cart/add. A click handler works for a person with a browser and for nothing else — and the form costs nothing, because the JavaScript can still intercept it.'
            : id === 'select-variant'
              ? 'Put the variant id in a submittable field — a select or radio group with the variant id as the value. Swatch grids can stay; they just need to write into a real input rather than into JavaScript state alone.'
              : `Close this step so the path completes: ${step.detail}.`,
        }));
      }

      // A path that completes but only by executing the page.
      const degradedOnly = results.filter((r) => r.operable && r.degraded > 0);
      if (degradedOnly.length) {
        const worst = degradedOnly.sort((a, b) => b.degraded - a.degraded)[0];
        out.push(createFinding({
          checkId: 'engine-agent-degraded', axis: 'engine', surface: 'pdp',
          scope: 'extractive', basis: 'practice', url: worst.url,
          title: `The buy path completes for an agent, but ${worst.degraded} step${worst.degraded === 1 ? '' : 's'} require guessing or executing the page`,
          impact: 4, effort: 7,
          evidence: {
            pagesAffected: degradedOnly.length,
            degradedSteps: worst.steps.filter((s) => s.state === 'degraded')
              .map((s) => ({ step: s.label, detail: s.detail })),
            fullPath: worst.steps.map((s) => ({ step: s.label, state: s.state })),
          },
          recommendation: 'Each of these works today and works by inference. Closing them turns a path that happens to succeed into one that is specified.',
        }));
      }

      // Fully operable is worth naming — it is rare and easy to lose.
      const clean = results.filter((r) => r.operable && !r.degraded);
      if (clean.length && clean.length === results.length) {
        out.push(createFinding({
          checkId: 'strength-agent-operable', axis: 'engine', surface: 'pdp',
          kind: 'strength', scope: 'extractive', basis: 'practice',
          title: 'An agent can complete the buy path without executing the page',
          impact: 8, effort: 10,
          evidence: {
            pages: clean.length,
            path: clean[0].steps.map((s) => ({ step: s.label, detail: s.detail })),
          },
          recommendation: 'Rare, and the first thing a client-side rewrite removes. Protect it explicitly in the rebuild brief: a real form to /cart/add and the variant id in a submittable field.',
        }));
      }
      return out;
    },
  },

  {
    id: 'opaque-controls',
    axis: 'engine',
    run(ctx) {
      const pages = uniquePages(ctx.observations).filter((o) => o.operability);
      const opaque = pages.reduce((n, o) => n + o.operability.controls.opaque, 0);
      const real = pages.reduce((n, o) => n + o.operability.controls.real, 0);
      if (!opaque || opaque / Math.max(1, opaque + real) < 0.3) return [];

      return [createFinding({
        checkId: 'engine-opaque-controls', axis: 'engine', surface: ctx.scopeSurface,
        scope: 'extractive', basis: 'practice',
        title: `${opaque} of ${opaque + real} interactive elements are not buttons or links`,
        impact: 5, effort: 7,
        evidence: {
          opaque, real, share: +(opaque / (opaque + real)).toFixed(2),
          why: 'A div that looks like a button is a button to a person and nothing to anything else — an agent, a screen reader, or keyboard navigation. The same markup change serves all three.',
        },
        recommendation: 'Use <button> and <a> for things that act and navigate. Styling is unaffected; the affordance becomes machine-visible, and the accessibility problem closes at the same time.',
      })];
    },
  },

  {
    id: 'json-endpoints',
    axis: 'engine',
    run(ctx) {
      const e = ctx.siteSignals?.endpoints;
      if (!e) return [];
      const closed = [];
      if (!e.cartJson?.ok) closed.push({ path: '/cart.js', purpose: 'read cart state', detail: e.cartJson });
      if (!e.productsJson?.ok) closed.push({ path: '/products.json', purpose: 'enumerate the catalogue', detail: e.productsJson });
      if (!closed.length) return [];

      return [createFinding({
        checkId: 'engine-json-endpoints-closed', axis: 'engine', surface: 'site',
        scope: 'extractive', basis: 'practice',
        title: `${closed.length} storefront JSON endpoint${closed.length === 1 ? ' is' : 's are'} unavailable`,
        // Frequently deliberate, so low impact — this is a note, not a fault.
        impact: 3, effort: 8,
        evidence: {
          closed: closed.map((c) => ({
            path: c.path, purpose: c.purpose,
            status: c.detail?.status ?? null,
            servedHtml: c.detail?.servedHtml ?? null,
          })),
          note: 'Often disabled on purpose to keep a catalogue from being scraped. Reported so the choice is visible, not because it is wrong.',
        },
        recommendation: 'If you want assistants to be able to read the catalogue and the cart, these are the endpoints they reach for first. If the catalogue is deliberately closed, this finding is answered by saying so.',
      })];
    },
  },
];
