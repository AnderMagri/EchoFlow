/**
 * Answerability — can a machine reader recover the facts a buyer asks about?
 *
 * Everything else in the retrieval pass measures AVAILABILITY: is the crawler
 * allowed in, does the content exist without JavaScript, is the schema present
 * and valid. This asks the question underneath all of those — *so can it answer
 * anything?*
 *
 * A page can pass every structured-data check and still be unanswerable. The
 * common case: `Product` is present and `offers.price` is present, but the
 * value is a template placeholder because the price is filled in client-side.
 * A presence check sees a field and calls it done. This resolves the value.
 *
 * It reasons ONLY over what a non-JS reader receives (`retrieval.static.payload`).
 * Consulting the rendered DOM would defeat the purpose.
 *
 * No model is involved. Each question has a resolver that either returns a
 * concrete value or does not.
 *
 * @module core/answerability
 */

/**
 * Markers of a value that was never filled in. Finding `{{ product.price }}`
 * where a price should be is worse than finding nothing, because every
 * field-presence check in the world will call it a pass.
 */
const UNRESOLVED = /\{\{|\}\}|\{%|%\}|\$\{|<%|%>|\[\[|\]\]|__[A-Z0-9_]{3,}__|^\s*(null|undefined|NaN)\s*$/i;

const isResolved = (v) => {
  if (v == null) return false;
  const s = String(v).trim();
  if (!s || UNRESOLVED.test(s)) return false;
  return true;
};

/** schema.org offers may be an object or an array. */
const offerOf = (item) => {
  const o = item?.offers;
  if (!o) return null;
  return Array.isArray(o) ? o[0] : o;
};

const typeOf = (item) => {
  const t = item?.['@type'];
  return Array.isArray(t) ? t[0] : t;
};

const findType = (payload, ...types) =>
  (payload.jsonLd || []).find((i) => types.includes(typeOf(i))) || null;

/** A price-shaped string in the visible text: "$98.00", "98,00 €", "USD 98". */
const PRICE_IN_TEXT = /(?:[$£€¥₹]\s?\d[\d.,]*|\d[\d.,]*\s?(?:USD|EUR|GBP|CAD|AUD|BRL|JPY)\b)/i;
const STOCK_IN_TEXT = /\b(in stock|out of stock|sold out|available now|backorder|pre-?order|ships? (?:within|in))\b/i;
const RETURNS_IN_TEXT = /\b(returns?|refunds?|exchange)\b.{0,40}\b(policy|within|days|free)\b|\b\d{1,3}[- ]day\b.{0,20}\b(return|money[- ]back)\b/i;

/**
 * Each question names what a buyer wants to know and how to recover it from
 * the machine payload. `from` records WHERE the answer came from, because
 * "recoverable from JSON-LD" and "recoverable only by reading prose" are
 * different qualities of answer.
 */
export const BUYER_QUESTIONS = {
  pdp: [
    {
      id: 'name', question: 'What is this product called?', short: 'the product name', critical: true,
      resolve(p) {
        const prod = findType(p, 'Product');
        if (prod && isResolved(prod.name)) return { value: String(prod.name).slice(0, 80), from: 'Product.name' };
        if (isResolved(p.title)) return { value: p.title.slice(0, 80), from: 'title tag' };
        return null;
      },
    },
    {
      id: 'price', question: 'What does it cost?', short: 'the price', critical: true,
      resolve(p) {
        const offer = offerOf(findType(p, 'Product'));
        if (offer && isResolved(offer.price)) return { value: String(offer.price), from: 'Product.offers.price' };
        const m = (p.text || '').match(PRICE_IN_TEXT);
        if (m) return { value: m[0], from: 'page text (not structured — a reader has to parse prose)' };
        return null;
      },
    },
    {
      id: 'currency', question: 'In what currency?', short: 'the currency', critical: false,
      resolve(p) {
        const offer = offerOf(findType(p, 'Product'));
        if (offer && isResolved(offer.priceCurrency)) return { value: String(offer.priceCurrency), from: 'Product.offers.priceCurrency' };
        const m = (p.text || '').match(/\b(USD|EUR|GBP|CAD|AUD|BRL|JPY)\b|[$£€¥₹]/);
        if (m) return { value: m[0], from: 'symbol in page text (ambiguous — $ is not one currency)' };
        return null;
      },
    },
    {
      id: 'availability', question: 'Can I buy it right now?', short: 'whether it is in stock', critical: true,
      resolve(p) {
        const offer = offerOf(findType(p, 'Product'));
        if (offer && isResolved(offer.availability)) {
          return { value: String(offer.availability).replace('https://schema.org/', ''), from: 'Product.offers.availability' };
        }
        const m = (p.text || '').match(STOCK_IN_TEXT);
        if (m) return { value: m[0], from: 'page text (not structured)' };
        return null;
      },
    },
    {
      id: 'what-it-is', question: 'What is it, in words?', short: 'what the product is', critical: true,
      resolve(p) {
        const prod = findType(p, 'Product');
        if (prod && isResolved(prod.description) && String(prod.description).length > 40) {
          return { value: `${String(prod.description).slice(0, 60)}…`, from: 'Product.description' };
        }
        if (isResolved(p.metaDescription) && p.metaDescription.length > 40) {
          return { value: `${p.metaDescription.slice(0, 60)}…`, from: 'meta description' };
        }
        if ((p.text || '').length > 400) return { value: `${p.text.length} characters of body text`, from: 'page text (unlabelled — the reader must guess which part describes the product)' };
        return null;
      },
    },
    {
      id: 'reviews', question: 'What do other people think?', short: 'what reviewers said', critical: false,
      resolve(p) {
        const prod = findType(p, 'Product');
        const r = prod?.aggregateRating;
        if (r && isResolved(r.ratingValue)) {
          return { value: `${r.ratingValue}${r.reviewCount ? ` from ${r.reviewCount}` : ''}`, from: 'Product.aggregateRating' };
        }
        return null;
      },
    },
    {
      id: 'returns', question: 'What if I want to send it back?', short: 'the returns policy', critical: false,
      resolve(p) {
        const offer = offerOf(findType(p, 'Product'));
        if (offer?.hasMerchantReturnPolicy) return { value: 'declared', from: 'offers.hasMerchantReturnPolicy' };
        const m = (p.text || '').match(RETURNS_IN_TEXT);
        if (m) return { value: m[0].slice(0, 50), from: 'page text (not structured)' };
        return null;
      },
    },
    {
      id: 'seller', question: 'Who am I buying from?', short: 'who is selling it', critical: false,
      resolve(p) {
        const org = findType(p, 'Organization', 'Store', 'OnlineStore');
        if (org && isResolved(org.name)) return { value: String(org.name), from: 'Organization.name' };
        const prod = findType(p, 'Product');
        const brand = prod?.brand;
        const brandName = typeof brand === 'string' ? brand : brand?.name;
        if (isResolved(brandName)) return { value: String(brandName), from: 'Product.brand' };
        return null;
      },
    },
  ],

  plp: [
    {
      id: 'what-collection', question: 'What is this a list of?', short: 'what the collection is', critical: true,
      resolve(p) {
        const page = findType(p, 'CollectionPage', 'WebPage', 'ItemList');
        if (page && isResolved(page.name)) return { value: String(page.name), from: 'CollectionPage.name' };
        if (isResolved(p.title)) return { value: p.title.slice(0, 70), from: 'title tag' };
        return null;
      },
    },
    {
      id: 'what-products', question: 'Which products are in it?', short: 'which products it contains', critical: true,
      resolve(p) {
        const list = findType(p, 'ItemList');
        const n = list?.itemListElement?.length || (p.jsonLd || []).filter((i) => typeOf(i) === 'Product').length;
        if (n) return { value: `${n} item${n === 1 ? '' : 's'}`, from: 'ItemList / Product markup' };
        return null;
      },
    },
    {
      id: 'prices', question: 'What do they cost?', short: 'what they cost', critical: true,
      resolve(p) {
        const prices = (p.text || '').match(new RegExp(PRICE_IN_TEXT.source, 'gi')) || [];
        if (prices.length >= 2) return { value: `${prices.length} prices in text`, from: 'page text (not structured)' };
        const withOffers = (p.jsonLd || []).filter((i) => isResolved(offerOf(i)?.price)).length;
        if (withOffers) return { value: `${withOffers} priced items`, from: 'Product.offers.price' };
        return null;
      },
    },
  ],

  home: [
    {
      id: 'what-store', question: 'What does this store sell?', short: 'what the store sells', critical: true,
      resolve(p) {
        const org = findType(p, 'Organization', 'Store', 'OnlineStore', 'WebSite');
        if (org && isResolved(org.description)) return { value: String(org.description).slice(0, 60), from: 'Organization.description' };
        if (isResolved(p.metaDescription) && p.metaDescription.length > 30) {
          return { value: p.metaDescription.slice(0, 60), from: 'meta description' };
        }
        return null;
      },
    },
    {
      id: 'who-store', question: 'Who runs it?', short: 'who runs the store', critical: true,
      resolve(p) {
        const org = findType(p, 'Organization', 'Store', 'OnlineStore');
        if (org && isResolved(org.name)) return { value: String(org.name), from: 'Organization.name' };
        return null;
      },
    },
    {
      id: 'reach', question: 'How do I contact them?', short: 'how to make contact', critical: false,
      resolve(p) {
        const org = findType(p, 'Organization', 'Store', 'OnlineStore');
        if (org && (org.contactPoint || isResolved(org.telephone) || isResolved(org.email))) {
          return { value: 'contact declared', from: 'Organization.contactPoint' };
        }
        const m = (p.text || '').match(/[\w.+-]+@[\w-]+\.[\w.]{2,}|\+?\d[\d\s()-]{7,}\d/);
        if (m) return { value: m[0].slice(0, 30), from: 'page text (not structured)' };
        return null;
      },
    },
  ],
};

/**
 * Evaluate one page.
 *
 * @param {object} observation a normalised PageObservation
 * @returns {{surface:string, measurable:boolean, reason?:string,
 *            answered:object[], unanswered:object[], proseOnly:object[],
 *            score:number|null, criticalMissing:string[]}|null}
 */
export function evaluateAnswerability(observation) {
  const questions = BUYER_QUESTIONS[observation.surface];
  if (!questions) return null;

  const payload = observation.retrieval?.static?.payload;
  if (!payload) {
    // Never guess from the rendered DOM — that is the exact substitution this
    // module exists to prevent.
    return {
      surface: observation.surface, url: observation.url, measurable: false,
      reason: 'the un-rendered HTML was not fetched, so there is no machine payload to reason about',
      answered: [], unanswered: [], proseOnly: [], score: null, criticalMissing: [],
    };
  }

  const answered = [], unanswered = [], proseOnly = [];
  for (const q of questions) {
    let result = null;
    try { result = q.resolve(payload); } catch { result = null; }
    if (result) {
      const entry = { id: q.id, question: q.question, ...result, critical: q.critical };
      answered.push(entry);
      // Recoverable, but only by reading prose — a weaker answer than a
      // structured one, and worth naming separately.
      if (/page text|symbol in page text|unlabelled/.test(result.from)) proseOnly.push(entry);
    } else {
      unanswered.push({ id: q.id, question: q.question, critical: q.critical });
    }
  }

  return {
    surface: observation.surface,
    url: observation.url,
    measurable: true,
    answered,
    unanswered,
    proseOnly,
    score: Math.round((answered.length / questions.length) * 100),
    criticalMissing: unanswered.filter((q) => q.critical).map((q) => q.id),
  };
}
