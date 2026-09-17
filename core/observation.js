/**
 * The PageObservation contract.
 *
 * Two very different collectors produce this: the extension's content script
 * (reading the live DOM of the tab you are looking at) and the Playwright
 * collector (rendering the URL server-side, post-JS, at two viewports). They
 * MUST produce the same shape, because everything downstream — checks, scoring,
 * synthesis, wiki — is written once against this contract and must not care
 * which collector filled it.
 *
 * @module core/observation
 */

/** @typedef {{value: string|number, count: number}} Tally */

/**
 * @typedef {object} PageObservation
 * @property {string} url
 * @property {string} surface        one of core/finding SURFACES
 * @property {{width:number,height:number,label:string}} viewport
 * @property {StyleInventory} styles raw vocabulary, pre-clustering
 * @property {Record<string, RoleSample>} roles invariant roles, for cross-page agreement
 * @property {Record<string, boolean>} anatomy template landmarks present/absent
 * @property {CopySample} copy
 * @property {EngineSample} engine
 * @property {A11ySample} a11y
 * @property {LayoutNode|null} layout the page's box skeleton, for structure view
 * @property {number} collectedAt
 */

/**
 * A node in the page's layout skeleton.
 *
 * Captured so the report can show the page as boxes rather than as pixels. For
 * a Shopify migration this is the most directly useful view there is: the
 * top-level children of <main> are, almost always, the sections you will have
 * to rebuild. Seeing them as a stack of labelled rectangles answers "how many
 * sections is this page, and what shape are they" in one look.
 *
 * @typedef {object} LayoutNode
 * @property {string} id
 * @property {string} tag
 * @property {string} [role]    detected semantic role (hero, grid, nav, ...)
 * @property {number} x         document coordinates, CSS pixels
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {number} depth
 * @property {string} display   computed display
 * @property {number|null} cols grid/flex column count where detectable
 * @property {number|null} gap
 * @property {string} label     short identifier (tag + first class or id)
 * @property {boolean} [section] true if this looks like a page-level section
 * @property {LayoutNode[]} children
 */

/**
 * @typedef {object} StyleInventory
 * @property {Tally[]} colorText
 * @property {Tally[]} colorBackground
 * @property {Tally[]} colorBorder
 * @property {Tally[]} fontFamily
 * @property {Tally[]} fontSize
 * @property {Tally[]} fontWeight
 * @property {Tally[]} lineHeight
 * @property {Tally[]} letterSpacing
 * @property {Tally[]} borderRadius
 * @property {Tally[]} shadow
 * @property {Tally[]} spacing
 * @property {Tally[]} transition
 * @property {Tally[]} zIndex
 */

/**
 * A role is something that should look and read the SAME on every page. These
 * are the inputs to cross-page agreement: if the primary button is 44px tall on
 * home and 38px on the PDP, that difference is the finding.
 * @typedef {object} RoleSample
 * @property {string} [label]
 * @property {string} [background]
 * @property {string} [color]
 * @property {number} [fontSize]
 * @property {number} [fontWeight]
 * @property {number} [borderRadius]
 * @property {number} [height]
 * @property {number} [paddingX]
 * @property {string} [fontFamily]
 * @property {string[]} [items]
 */

/** @typedef {{ctas:string[], headings:{level:number,text:string}[], wordCount:number,
 *             priceFormats:string[], trustSignals:string[]}} CopySample */

/** @typedef {{scripts:string[], apps:string[], isShopify:boolean, platform:string,
 *             platformSignals:Record<string,number>, fontFaces:{family:string,src:string,weight:string,style:string}[],
 *             theme:string|null,
 *             themeVersion:string|null, requests:number, transferBytes:number,
 *             vitals:{lcp:number|null,cls:number|null,inp:number|null,ttfb:number|null},
 *             sections:string[]}} EngineSample */

/** @typedef {{contrastFailures:{selector:string,ratio:number,required:number}[],
 *             imagesMissingAlt:number, imagesTotal:number,
 *             headingJumps:number, unlabeledControls:number,
 *             smallTapTargets:number}} A11ySample */

export const EMPTY_STYLES = () => ({
  colorText: [], colorBackground: [], colorBorder: [], fontFamily: [], fontSize: [],
  fontWeight: [], lineHeight: [], letterSpacing: [], borderRadius: [], shadow: [],
  spacing: [], transition: [], zIndex: [],
});

/** The roles we hold the site to. Adding one here is how you add a drift check. */
export const TRACKED_ROLES = [
  'primaryButton', 'secondaryButton', 'header', 'footer', 'productCard',
  'bodyText', 'h1', 'link', 'input', 'priceLabel',
];

/** Template landmarks, per surface. Absence on one page but not its siblings is drift. */
export const ANATOMY_KEYS = {
  pdp: ['gallery', 'title', 'price', 'variantSelector', 'addToCart', 'description',
        'shippingInfo', 'reviews', 'recommendations', 'breadcrumbs', 'stockStatus'],
  plp: ['title', 'productGrid', 'filters', 'sort', 'pagination', 'breadcrumbs', 'resultCount'],
  home: ['hero', 'featuredProducts', 'valueProps', 'newsletter', 'socialProof'],
  cart: ['lineItems', 'subtotal', 'checkoutButton', 'quantityControls', 'shippingEstimate',
         'continueShopping', 'trustBadges'],
  checkout: ['progressIndicator', 'contactFields', 'shippingFields', 'paymentFields', 'orderSummary'],
  search: ['searchInput', 'resultCount', 'filters', 'emptyState'],
  home_: [],
};

/**
 * Normalise whatever a collector handed us into a valid PageObservation.
 * Collectors run in hostile environments (someone else's page, someone else's
 * JS); they are allowed to come back partial. Core is not allowed to crash.
 *
 * @param {Partial<PageObservation>} raw
 * @returns {PageObservation}
 */
export function normalizeObservation(raw) {
  const styles = { ...EMPTY_STYLES(), ...(raw.styles || {}) };
  for (const key of Object.keys(styles)) {
    styles[key] = tallies(styles[key]);
  }
  return {
    url: raw.url || '',
    surface: raw.surface || 'content',
    viewport: raw.viewport || { width: 0, height: 0, label: 'unknown' },
    styles,
    roles: raw.roles || {},
    anatomy: raw.anatomy || {},
    copy: {
      ctas: [], headings: [], wordCount: 0, priceFormats: [], trustSignals: [],
      ...(raw.copy || {}),
    },
    engine: {
      scripts: [], apps: [], isShopify: false, platform: 'unknown', platformSignals: {},
      fontFaces: [], theme: null, themeVersion: null,
      requests: 0, transferBytes: 0,
      vitals: { lcp: null, cls: null, inp: null, ttfb: null },
      sections: [], ...(raw.engine || {}),
    },
    a11y: {
      contrastFailures: [], imagesMissingAlt: 0, imagesTotal: 0, headingJumps: 0,
      unlabeledControls: 0, targetsUnder24: 0, targetsUnder44: 0, controlsTotal: 0,
      inlineLinksExempt: 0, tinyTargets: [], textUnder12: 0, textUnder14: 0,
      tinyTextSamples: [], tightLeading: 0, imagesEager: 0, ...(raw.a11y || {}),
    },
    typography: { measures: [], ...(raw.typography || {}) },
    geometry: {
      pageHeight: 0, viewportHeight: 0, firstPriceY: null, firstActionY: null,
      firstActionLabel: null, coreContentY: null, stickyControls: [], sections: [],
      footerHeight: 0, navItemCount: 0, ...(raw.geometry || {}),
    },
    darkPatterns: {
      confirmshaming: [], preCheckedOptIns: [], urgency: [], countdownTimers: 0,
      hardToLeave: [], lateCosts: [], disguisedAds: 0, ...(raw.darkPatterns || {}),
    },
    layout: raw.layout || null,
    collectedAt: raw.collectedAt || Date.now(),
  };
}

/** Coerce a tally list, dropping junk without throwing. */
function tallies(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((t) => t && t.value != null && t.value !== '' && t.value !== 'none'
      && t.value !== 'normal' && t.value !== 'auto')
    .map((t) => ({ value: t.value, count: Math.max(1, Number(t.count) || 1) }));
}

/**
 * Merge the same property across several pages, summing usage. This is how a
 * site-wide vocabulary is built — and note it is a *union*, not a concatenation
 * of per-page reports. The whole point is that the union reveals what no single
 * page could: that the site owns 31 greys.
 *
 * @param {PageObservation[]} observations
 * @param {keyof StyleInventory} key
 * @returns {Tally[]}
 */
export function mergeTallies(observations, key) {
  const total = new Map();
  for (const obs of observations) {
    for (const { value, count } of obs.styles[key] || []) {
      total.set(value, (total.get(value) || 0) + count);
    }
  }
  return [...total.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

/** Numeric view of a tally list, for rhythm/scale measurement. */
export function numericTallies(list) {
  return list
    .map((t) => ({ value: typeof t.value === 'number' ? t.value : parseFloat(t.value), count: t.count }))
    .filter((t) => Number.isFinite(t.value));
}

/**
 * Infer which surface a URL is, from its shape. Shopify URLs are predictable,
 * which is one of the advantages of being a Shopify-only tool.
 * @param {string} url
 */
export function inferSurface(url) {
  let path;
  try { path = new URL(url).pathname.toLowerCase(); } catch { return 'content'; }

  if (path === '/' || path === '') return 'home';
  if (/\/products\//.test(path)) return 'pdp';
  if (/\/collections\/[^/]+\/?$/.test(path) || /\/collections\/?$/.test(path)) return 'plp';
  if (/\/cart/.test(path)) return 'cart';
  if (/\/checkouts?\//.test(path)) return 'checkout';
  if (/\/search/.test(path)) return 'search';
  if (/\/account/.test(path)) return 'account';
  return 'content';
}


/**
 * Flatten a layout tree to a list, optionally capped by depth.
 * @param {LayoutNode|null} root
 * @param {number} [maxDepth]
 * @returns {LayoutNode[]}
 */
export function flattenLayout(root, maxDepth = Infinity) {
  if (!root) return [];
  const out = [];
  const walk = (n) => {
    if (n.depth > maxDepth) return;
    out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return out;
}

/**
 * The page's section skeleton: the boxes a Shopify rebuild would have to
 * reproduce as sections. Full-width children of the main content area, tall
 * enough to be structural rather than decorative.
 * @param {LayoutNode|null} root
 */
export function sectionSkeleton(root) {
  return flattenLayout(root).filter((n) => n.section);
}


/**
 * Usable viewport heights, not device heights.
 *
 * A 390x844 iPhone does not show 844px of page: the address bar and browser
 * chrome take roughly 200 of it. Measuring "screens" against the full device
 * height flatters every design by about a quarter, which is exactly the kind of
 * quiet inaccuracy that makes a geometry audit worthless.
 *
 * The fold line must also be DECLARED in the output — an audit whose fold is
 * undeclared cannot be checked by the person reading it.
 */
export const USABLE_VIEWPORT = {
  mobile: { width: 390, height: 640, note: 'iPhone-class viewport less browser chrome with the address bar showing' },
  desktop: { width: 1440, height: 800, note: '1440x900 display less browser chrome' },
};

/** @param {string} label */
export const usableHeight = (label) =>
  (USABLE_VIEWPORT[label] || USABLE_VIEWPORT.desktop).height;

/**
 * Page depth benchmarks, in screens, by surface.
 *
 * DTC convention, NOT a standard — these are the bands a healthy storefront
 * lands in, and findings built on them must be labelled `practice`, never
 * presented as pass/fail.
 */
export const DEPTH_BENCHMARK = {
  home: { good: 8, investigate: 12 },
  pdp: { good: 12, investigate: 16 },
  plp: { good: 10, investigate: 14 },
  cart: { good: 4, investigate: 6 },
  content: { good: 10, investigate: 15 },
};
