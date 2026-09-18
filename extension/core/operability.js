/**
 * Operability — could an AGENT complete the buy path, not merely read it?
 *
 * Reading is where every tool in this market is competing. Acting is the thing
 * almost nobody measures, and for a storefront it is decided entirely by markup
 * a machine can see without executing the page: a real form that POSTs to
 * /cart/add, a variant control that carries a submittable id, fields that
 * declare what they want.
 *
 * The buy path is evaluated as STEPS, because that is how it fails. An agent
 * does not get 70% of the way into a cart — it gets to the first step that has
 * no machine-visible affordance and stops. So the finding worth reporting is
 * *where* it stops, not a percentage.
 *
 * Nothing here judges whether a site SHOULD be agent-operable. That is a
 * business decision. It reports whether it is.
 *
 * @module core/operability
 */

/**
 * One step of the path. `blocked` means an agent cannot proceed; `degraded`
 * means it can, but only by executing the page or guessing.
 */
export const BUY_PATH = [
  {
    id: 'identify',
    label: 'Identify the product',
    evaluate(op, obs) {
      const name = obs.retrieval?.static?.payload?.jsonLd
        ?.find((i) => (Array.isArray(i['@type']) ? i['@type'][0] : i['@type']) === 'Product')?.name;
      if (name) return { state: 'ok', detail: 'Product markup names it in the raw HTML' };
      if (obs.retrieval?.static?.h1InStatic) return { state: 'degraded', detail: 'Only an H1 — no Product markup to confirm what it is' };
      return { state: 'blocked', detail: 'Neither Product markup nor an H1 survives without JavaScript' };
    },
  },
  {
    id: 'select-variant',
    label: 'Choose a variant',
    evaluate(op) {
      const v = op.variant;
      if (!v) return { state: 'ok', detail: 'No variants to choose' };
      if (v.kind === 'opaque') {
        return { state: 'blocked', detail: 'Swatches carry the selection in JavaScript state — no form field holds the variant id' };
      }
      if (!v.optionsWithValue) {
        return {
          state: 'blocked',
          detail: v.options
            ? `${v.options} options, none carrying a variant id — an option with no value submits its own label, which does not identify a variant`
            : 'A variant field with no selectable values',
        };
      }
      if (!v.inForm) return { state: 'degraded', detail: 'The variant field sits outside the add-to-cart form, so it is not submitted with it' };
      return { state: 'ok', detail: `${v.optionsWithValue} variant${v.optionsWithValue === 1 ? '' : 's'} selectable as form values` };
    },
  },
  {
    id: 'add-to-cart',
    label: 'Add it to the cart',
    evaluate(op) {
      const a = op.addToCart;
      if (!a || !a.present) {
        return {
          state: 'blocked',
          detail: a?.jsOnlyCandidate
            ? 'An add-to-cart control exists but no form wraps it — the action is a JavaScript handler with no submittable fallback'
            : 'No add-to-cart form found',
        };
      }
      if (a.method !== 'post') {
        return { state: 'degraded', detail: `The form declares method="${a.method}". Shopify's cart endpoint expects POST` };
      }
      if (a.submitKind === 'opaque') {
        return { state: 'degraded', detail: 'The form exists but its trigger is not a submit control, so submitting it means simulating a click' };
      }
      return { state: 'ok', detail: `Real ${a.method.toUpperCase()} form to ${a.action}` };
    },
  },
  {
    id: 'read-cart',
    label: 'Read the cart back',
    evaluate(op, obs, site) {
      const api = site?.endpoints?.cartJson;
      if (api?.ok) return { state: 'ok', detail: '/cart.js returns the cart as JSON' };
      if (op.cartLink) return { state: 'degraded', detail: 'A cart page is linked, but there is no JSON endpoint — the contents have to be scraped' };
      return { state: 'blocked', detail: 'No cart JSON endpoint and no link to a cart page' };
    },
  },
  {
    id: 'checkout',
    label: 'Reach checkout',
    evaluate(op) {
      if (!op.forms.total) return { state: 'ok', detail: 'No form on this page to judge' };
      const share = op.forms.withAutocomplete / op.forms.total;
      if (share >= 0.6) return { state: 'ok', detail: `${op.forms.withAutocomplete} of ${op.forms.total} fields declare an autocomplete token` };
      if (op.forms.withName / op.forms.total >= 0.8) {
        return { state: 'degraded', detail: `Only ${op.forms.withAutocomplete} of ${op.forms.total} fields declare autocomplete — an agent has to infer each field from its name` };
      }
      return { state: 'blocked', detail: `${op.forms.total} fields with neither autocomplete tokens nor meaningful names` };
    },
  },
];

const RANK = { ok: 0, degraded: 1, blocked: 2 };

/**
 * @param {import('./observation.js').PageObservation} observation
 * @param {object} [siteSignals]
 */
export function evaluateOperability(observation, siteSignals) {
  const op = observation.operability;
  if (!op) return null;

  const steps = BUY_PATH.map((step) => {
    let r;
    try { r = step.evaluate(op, observation, siteSignals); } catch { r = { state: 'degraded', detail: 'could not be evaluated' }; }
    return { id: step.id, label: step.label, ...r };
  });

  const blocked = steps.filter((s) => s.state === 'blocked');
  const degraded = steps.filter((s) => s.state === 'degraded');

  return {
    url: observation.url,
    surface: observation.surface,
    steps,
    // Where it stops, which is the only number that means anything here — an
    // agent does not get part-way into a cart.
    stopsAt: blocked[0] || null,
    blocked: blocked.length,
    degraded: degraded.length,
    operable: blocked.length === 0,
    opaqueControls: op.controls.opaque,
    realControls: op.controls.real,
  };
}
