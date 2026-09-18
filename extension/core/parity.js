/**
 * Machine/human parity — does the page tell a machine the same thing it tells
 * a person?
 *
 * This is the consistency primitive pointed at a new boundary. Everywhere else
 * the tool asks "do pages that should agree, agree?"; here it asks the same
 * question of two VIEWS of one page: the structured payload a machine receives,
 * and the rendered page a customer sees.
 *
 * It matters more than it sounds. If JSON-LD carries 98.00 and InStock while
 * the page shows £129 and "Sold out", an answer engine will confidently quote
 * a price and an availability the customer will never see. That is brand
 * damage, and in several jurisdictions an advertised-price problem. No
 * structured-data validator catches it, because both sides are individually
 * valid — the defect only exists in the relationship.
 *
 * Unlike most retrieval checks this is EXTRACTIVE: one page carries both views,
 * so it works in the sidebar on a single page.
 *
 * Silence is not agreement. A field present on only one side is `unmeasurable`,
 * never a mismatch.
 *
 * @module core/parity
 */

const typeOf = (item) => {
  const t = item?.['@type'];
  return Array.isArray(t) ? t[0] : t;
};

const findType = (items, ...types) => (items || []).find((i) => types.includes(typeOf(i))) || null;

const offerOf = (item) => {
  const o = item?.offers;
  if (!o) return null;
  return Array.isArray(o) ? o[0] : o;
};

const PLACEHOLDER = /\{\{|\}\}|\{%|%\}|\$\{|<%|%>/;
const usable = (v) => v != null && String(v).trim() !== '' && !PLACEHOLDER.test(String(v));

/** Loose text comparison — case, punctuation and whitespace are not the point. */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const CURRENCY_SYMBOLS = { $: ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN', 'BRL'], '£': ['GBP'], '€': ['EUR'], '¥': ['JPY', 'CNY'], '₹': ['INR'] };

/**
 * Compare the two views of one page.
 *
 * @param {import('./observation.js').PageObservation} observation
 * @returns {{measurable:boolean, checks:object[], agreed:number, compared:number,
 *            score:number|null, mismatches:object[]}}
 */
export function evaluateParity(observation) {
  const rendered = observation.retrieval?.rendered;
  const payload = observation.retrieval?.static?.payload;

  if (!rendered || !payload) {
    return {
      measurable: false,
      reason: !payload
        ? 'the un-rendered HTML was not fetched, so there is no machine view to compare against'
        : 'the rendered view was not captured',
      checks: [], agreed: 0, compared: 0, score: null, mismatches: [],
    };
  }

  const product = findType(payload.jsonLd, 'Product');
  const offer = offerOf(product);
  const checks = [];

  /** Record a comparison. `null` on either side means unmeasurable, not a mismatch. */
  const compare = (id, label, machine, human, equal, severity = 'normal') => {
    if (!usable(machine) || !usable(human)) {
      checks.push({ id, label, state: 'unmeasurable', machine: machine ?? null, human: human ?? null });
      return;
    }
    checks.push({
      id, label, severity,
      state: equal(machine, human) ? 'agree' : 'disagree',
      machine: String(machine).slice(0, 60),
      human: String(human).slice(0, 60),
    });
  };

  // --- price: the one that costs money to get wrong -----------------------
  const humanPrice = rendered.price?.value ?? null;
  let machinePrice = offer && usable(offer.price) ? Number(offer.price) : null;
  let priceRange = null;
  if (offer && typeOf(offer) === 'AggregateOffer' && usable(offer.lowPrice)) {
    priceRange = { low: Number(offer.lowPrice), high: Number(offer.highPrice ?? offer.lowPrice) };
    machinePrice = null;
  }

  if (priceRange && humanPrice != null) {
    // A variant range is correct as long as the shown price sits inside it.
    const inRange = humanPrice >= priceRange.low - 0.01 && humanPrice <= priceRange.high + 0.01;
    checks.push({
      id: 'price', label: 'Price', severity: 'critical',
      state: inRange ? 'agree' : 'disagree',
      machine: `${priceRange.low}–${priceRange.high} (AggregateOffer)`,
      human: String(humanPrice),
    });
  } else {
    compare('price', 'Price', machinePrice, humanPrice,
      // A cent of float noise is not a disagreement.
      (m, h) => Math.abs(Number(m) - Number(h)) < 0.015, 'critical');
  }

  // --- availability -------------------------------------------------------
  const machineAvail = offer && usable(offer.availability)
    ? String(offer.availability).replace(/^https?:\/\/schema\.org\//, '') : null;
  const humanAvail = rendered.availability;
  compare('availability', 'Availability', machineAvail, humanAvail, (m, h) => {
    const mOut = /OutOfStock|SoldOut|Discontinued/i.test(m);
    const hOut = h === 'unavailable';
    return mOut === hOut;
  }, 'critical');

  // --- identity -----------------------------------------------------------
  compare('name', 'Product name', product?.name, rendered.h1, (m, h) => {
    const a = norm(m), b = norm(h);
    // One containing the other is fine — "Runner" vs "Runner — Trail Shoe".
    return a === b || a.includes(b) || b.includes(a);
  });

  compare('currency', 'Currency', offer?.priceCurrency, rendered.price?.symbol, (m, h) => {
    const code = String(m).toUpperCase();
    if (code === String(h).toUpperCase()) return true;
    const plausible = CURRENCY_SYMBOLS[h];
    // "$" is not one currency; treat it as consistent with any dollar code
    // rather than inventing a mismatch the page cannot resolve either.
    return plausible ? plausible.includes(code) : false;
  });

  compare('title', 'Title tag', payload.title, rendered.title,
    (m, h) => norm(m) === norm(h));

  const canonical = observation.retrieval?.canonical;
  if (usable(canonical) && usable(rendered.url)) {
    let same = false;
    try {
      const c = new URL(canonical, rendered.url);
      const u = new URL(rendered.url);
      same = c.origin === u.origin && c.pathname.replace(/\/$/, '') === u.pathname.replace(/\/$/, '');
    } catch { same = false; }
    checks.push({
      id: 'canonical', label: 'Canonical URL',
      state: same ? 'agree' : 'disagree',
      machine: String(canonical).slice(0, 70), human: String(rendered.url).slice(0, 70),
    });
  }

  const measured = checks.filter((c) => c.state !== 'unmeasurable');
  const agreed = measured.filter((c) => c.state === 'agree').length;

  return {
    measurable: measured.length > 0,
    url: observation.url,
    surface: observation.surface,
    checks,
    compared: measured.length,
    agreed,
    // Excludes unmeasurable fields rather than counting them as agreement —
    // the same rule the consistency score follows everywhere else.
    score: measured.length ? Math.round((agreed / measured.length) * 100) : null,
    mismatches: measured.filter((c) => c.state === 'disagree'),
  };
}

/** Plain-language consequence, for the finding a client reads. */
export const MISMATCH_CONSEQUENCE = {
  price: 'An answer engine will quote a price the customer does not see on the page.',
  availability: 'An assistant may recommend a product the customer cannot buy, or hide one they can.',
  name: 'The product is identified to machines under a different name than it is shown under.',
  currency: 'The amount may be quoted in the wrong currency.',
  title: 'The page is summarised under a heading that does not match what it renders.',
  canonical: 'The page nominates a different URL as canonical, so citations may point elsewhere.',
};
