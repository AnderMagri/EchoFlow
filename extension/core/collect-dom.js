/**
 * The DOM collector.
 *
 * CONSTRAINT: this function is serialised into a browser context by
 * Playwright's page.evaluate() and injected verbatim by the extension's content
 * script. It therefore closes over NOTHING — no imports, no module scope, no
 * helpers from outside its own body. Everything it needs is defined inside it.
 *
 * That is why it is one long function rather than a tidy module. Breaking it up
 * would break serialisation, and the two collectors would drift apart — which,
 * on a tool about consistency, is not a trade worth making.
 *
 * @module core/collect-dom
 */

/**
 * Runs inside the page. Returns a PageObservation-shaped plain object.
 * @param {{surface?:string, maxNodes?:number, viewportLabel?:string}} [options]
 */
export function collectFromDocument(options) {
  var opts = options || {};
  var MAX_NODES = opts.maxNodes || 5000;

  // --- tallies -----------------------------------------------------------
  var counters = {
    colorText: {}, colorBackground: {}, colorBorder: {}, fontFamily: {},
    fontSize: {}, fontWeight: {}, lineHeight: {}, letterSpacing: {},
    borderRadius: {}, shadow: {}, spacing: {}, transition: {}, zIndex: {},
  };
  function bump(key, value) {
    if (value == null || value === '' || value === 'none' || value === 'normal' ||
        value === 'auto' || value === '0px' || value === 'rgba(0, 0, 0, 0)') return;
    counters[key][value] = (counters[key][value] || 0) + 1;
  }
  function toTallies(obj) {
    var out = [];
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out.push({ value: k, count: obj[k] });
    return out.sort(function (a, b) { return b.count - a.count; });
  }
  function px(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }

  // --- visibility --------------------------------------------------------
  function isVisible(el, cs, rect) {
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return rect.width > 0 && rect.height > 0;
  }

  // --- walk --------------------------------------------------------------
  var all = document.querySelectorAll('body *');
  var limit = Math.min(all.length, MAX_NODES);
  var scrollX = window.scrollX || 0, scrollY = window.scrollY || 0;

  var imagesTotal = 0, imagesMissingAlt = 0, unlabeledControls = 0, smallTapTargets = 0;
  var headingLevels = [];

  for (var i = 0; i < limit; i++) {
    var el = all[i];
    var tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG' || tag === 'PATH') continue;

    var rect = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    if (!isVisible(el, cs, rect)) continue;

    // Only tally text colour where there is actually text, or every wrapper
    // inherits the body colour and the palette looks tidier than it is.
    var hasText = false;
    for (var c = 0; c < el.childNodes.length; c++) {
      if (el.childNodes[c].nodeType === 3 && el.childNodes[c].nodeValue.trim()) { hasText = true; break; }
    }
    if (hasText) {
      bump('colorText', cs.color);
      bump('fontFamily', cs.fontFamily);
      bump('fontSize', px(cs.fontSize));
      bump('fontWeight', cs.fontWeight);
      bump('lineHeight', cs.lineHeight);
      bump('letterSpacing', cs.letterSpacing);
    }
    bump('colorBackground', cs.backgroundColor);
    if (px(cs.borderTopWidth) > 0) bump('colorBorder', cs.borderTopColor);
    if (px(cs.borderRadius) > 0) bump('borderRadius', px(cs.borderTopLeftRadius));
    bump('shadow', cs.boxShadow);
    bump('transition', cs.transitionDuration);
    if (cs.zIndex !== 'auto') bump('zIndex', cs.zIndex);

    var sides = ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'];
    for (var s = 0; s < sides.length; s++) {
      var v = px(cs[sides[s]]);
      if (v && v > 0) bump('spacing', v);
    }
    if (cs.gap && cs.gap !== 'normal') { var g = px(cs.gap); if (g) bump('spacing', g); }

    if (tag === 'IMG') {
      imagesTotal++;
      if (!el.getAttribute('alt')) imagesMissingAlt++;
    }
    if (/^H[1-6]$/.test(tag)) headingLevels.push(+tag[1]);
    if (tag === 'BUTTON' || tag === 'A' || el.getAttribute('role') === 'button') {
      if (rect.width < 44 || rect.height < 44) smallTapTargets++;
    }
    if ((tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA')
        && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')
        && !(el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'))
        && !el.closest('label')) {
      unlabeledControls++;
    }
  }

  var headingJumps = 0;
  for (var h = 1; h < headingLevels.length; h++) {
    if (headingLevels[h] - headingLevels[h - 1] > 1) headingJumps++;
  }

  // --- roles -------------------------------------------------------------
  function pick(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var found = document.querySelector(selectors[i]);
      if (found) {
        var r = found.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return found;
      }
    }
    return null;
  }
  function sample(el, extra) {
    if (!el) return undefined;
    var cs = window.getComputedStyle(el);
    var r = el.getBoundingClientRect();
    var out = {
      background: cs.backgroundColor, color: cs.color,
      fontSize: px(cs.fontSize), fontWeight: parseInt(cs.fontWeight, 10) || null,
      borderRadius: px(cs.borderTopLeftRadius), height: Math.round(r.height),
      paddingX: px(cs.paddingLeft), fontFamily: cs.fontFamily,
    };
    if (extra) for (var k in extra) out[k] = extra[k];
    return out;
  }
  function text(el) { return el ? (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80) : undefined; }

  var atcEl = pick([
    'form[action*="/cart/add"] button[type="submit"]', '[name="add"]',
    '.product-form__submit', '.shopify-payment-button__button',
    'button[class*="add-to-cart" i]', 'button[class*="addtocart" i]',
  ]);
  var ctaEl = atcEl || pick([
    'main a[class*="button" i]', 'main button[class*="primary" i]',
    '.btn-primary', '[class*="button--primary" i]', 'main button', 'main a[class*="btn" i]',
  ]);
  var headerEl = pick(['header', '[role="banner"]', '.site-header', '#header', '.header']);
  var navItems = [];
  if (headerEl) {
    var links = headerEl.querySelectorAll('nav a, ul a');
    for (var l = 0; l < links.length && navItems.length < 12; l++) {
      var t = (links[l].textContent || '').trim().replace(/\s+/g, ' ');
      if (t && t.length < 32 && navItems.indexOf(t) === -1) navItems.push(t);
    }
  }

  var roles = {
    primaryButton: sample(ctaEl, { label: text(ctaEl) }),
    secondaryButton: sample(pick(['[class*="button--secondary" i]', '.btn-secondary', 'main a[class*="secondary" i]'])),
    header: sample(headerEl, { items: navItems }),
    footer: sample(pick(['footer', '[role="contentinfo"]', '.site-footer'])),
    productCard: sample(pick(['[class*="product-card" i]', '[class*="card-wrapper" i]', '[class*="grid__item" i] a'])),
    bodyText: sample(pick(['main p', 'article p', 'p'])),
    h1: sample(pick(['h1'])),
    link: sample(pick(['main a:not([class*="button" i])', 'article a', 'p a'])),
    input: sample(pick(['input[type="text"]', 'input[type="email"]', 'input:not([type="hidden"])'])),
    priceLabel: sample(pick(['[class*="price" i]:not([class*="price-item--regular" i])', '.price', '[data-price]'])),
  };
  for (var rk in roles) if (roles[rk] === undefined) delete roles[rk];

  // --- anatomy -----------------------------------------------------------
  function has(selectors) {
    for (var i = 0; i < selectors.length; i++) if (document.querySelector(selectors[i])) return true;
    return false;
  }
  var anatomy = {
    gallery: has(['[class*="product__media" i]', '[class*="product-gallery" i]', '[class*="product-images" i]']),
    title: has(['h1']),
    price: has(['[class*="price" i]', '[data-price]', '.money']),
    variantSelector: has(['[name="id"]', 'variant-selects', '[class*="variant" i] select', '[class*="swatch" i]']),
    addToCart: !!atcEl,
    description: has(['[class*="product__description" i]', '[class*="product-description" i]', '.rte']),
    shippingInfo: has(['[class*="shipping" i]', '[class*="delivery" i]']),
    reviews: has(['[class*="review" i]', '[data-reviews]', '.jdgm-widget', '.yotpo']),
    recommendations: has(['[class*="recommend" i]', '[class*="related" i]', '[class*="you-may-also" i]']),
    breadcrumbs: has(['[class*="breadcrumb" i]', 'nav[aria-label*="readcrumb"]']),
    stockStatus: has(['[class*="stock" i]', '[class*="inventory" i]', '[class*="availability" i]']),
    productGrid: has(['[class*="product-grid" i]', '[class*="collection__" i]', '[class*="grid--" i]']),
    filters: has(['[class*="filter" i]', '[class*="facet" i]']),
    sort: has(['[class*="sort" i]', 'select[name*="sort" i]']),
    pagination: has(['[class*="pagination" i]', 'nav[aria-label*="agination"]']),
    resultCount: has(['[class*="result-count" i]', '[class*="product-count" i]']),
    hero: has(['[class*="hero" i]', '[class*="banner" i]', '[class*="slideshow" i]']),
    featuredProducts: has(['[class*="featured" i]', '[class*="featured-collection" i]']),
    valueProps: has(['[class*="value-prop" i]', '[class*="usp" i]', '[class*="multicolumn" i]', '[class*="icon-row" i]']),
    newsletter: has(['[class*="newsletter" i]', 'form[action*="contact"]', '[class*="subscribe" i]']),
    socialProof: has(['[class*="testimonial" i]', '[class*="trust" i]', '[class*="as-seen" i]']),
    lineItems: has(['[class*="cart-item" i]', '[class*="line-item" i]']),
    subtotal: has(['[class*="subtotal" i]', '[class*="totals" i]']),
    checkoutButton: has(['[name="checkout"]', '[class*="checkout" i]']),
    quantityControls: has(['[class*="quantity" i]', 'input[name*="quantity" i]']),
    searchInput: has(['input[type="search"]', '[class*="search" i] input']),
  };

  // --- copy --------------------------------------------------------------
  var ctas = [];
  var buttons = document.querySelectorAll('button, a[class*="button" i], a[class*="btn" i], input[type="submit"]');
  for (var b = 0; b < buttons.length && ctas.length < 40; b++) {
    var bt = (buttons[b].textContent || buttons[b].value || '').trim().replace(/\s+/g, ' ');
    if (bt && bt.length < 48) ctas.push(bt);
  }
  var headings = [];
  var hs = document.querySelectorAll('h1, h2, h3');
  for (var hh = 0; hh < hs.length && headings.length < 40; hh++) {
    headings.push({ level: +hs[hh].tagName[1], text: (hs[hh].textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120) });
  }

  // Price FORMAT, not price value — "$1,299.00" and "$19.99" are one format.
  var priceFormats = {};
  var priceEls = document.querySelectorAll('[class*="price" i], .money, [data-price]');
  for (var p = 0; p < priceEls.length && p < 60; p++) {
    var raw = (priceEls[p].textContent || '').trim();
    var m = raw.match(/([^\d\s]{0,3})\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*([^\d\s]{0,4})/);
    if (!m) continue;
    var shape = (m[1] || '') + '0' + (/[.,]\d{3}/.test(m[2]) ? (m[2].match(/\d[.,]\d{3}/) ? m[2].replace(/\d/g, '0') : '0') : '')
      + (m[2].match(/[.,]\d{2}$/) ? m[2].slice(-3).replace(/\d/g, '0') : '') + (m[3] || '');
    shape = shape.replace(/0{3,}/g, '0');
    if (shape.length > 1) priceFormats[shape] = true;
  }

  // --- engine ------------------------------------------------------------
  var APP_SIGNATURES = {
    klaviyo: 'klaviyo', judgeme: 'judge.me', yotpo: 'yotpo', okendo: 'okendo',
    stamped: 'stamped.io', loox: 'loox', gorgias: 'gorgias', tidio: 'tidio',
    rechargeh: 'rechargepayments', bold: 'boldapps', pushowl: 'pushowl',
    privy: 'privy', attentive: 'attentivemobile', hotjar: 'hotjar',
    gtm: 'googletagmanager', ga: 'google-analytics', fbpixel: 'connect.facebook',
    tiktok: 'analytics.tiktok', clarity: 'clarity.ms', searchanise: 'searchanise',
    algolia: 'algolia', swym: 'swymrelay', smile: 'smile.io', zendesk: 'zdassets',
  };
  var scripts = [], apps = {};
  var scriptEls = document.querySelectorAll('script[src]');
  for (var sc = 0; sc < scriptEls.length; sc++) {
    var src = scriptEls[sc].src || '';
    scripts.push(src);
    for (var appName in APP_SIGNATURES) {
      if (src.indexOf(APP_SIGNATURES[appName]) !== -1) apps[appName] = true;
    }
  }

  var sections = {};
  var sectionEls = document.querySelectorAll('[id^="shopify-section-"], section[class*="section" i], [data-section-type]');
  for (var se = 0; se < sectionEls.length; se++) {
    var sid = sectionEls[se].getAttribute('data-section-type')
      || (sectionEls[se].id || '').replace(/^shopify-section-(template--\d+__)?/, '')
      || '';
    if (sid) sections[sid.replace(/\d{6,}/g, '').replace(/^[-_]+|[-_]+$/g, '')] = true;
  }

  var vitals = { lcp: null, cls: null, inp: null, ttfb: null };
  try {
    var nav = performance.getEntriesByType('navigation')[0];
    if (nav) vitals.ttfb = Math.round(nav.responseStart);
    var lcpEntries = performance.getEntriesByType('largest-contentful-paint');
    if (lcpEntries.length) vitals.lcp = Math.round(lcpEntries[lcpEntries.length - 1].startTime);
    else if (nav) vitals.lcp = Math.round(nav.domContentLoadedEventEnd);
  } catch (e) { /* performance API unavailable */ }

  var transferBytes = 0, requests = 0;
  try {
    var res = performance.getEntriesByType('resource');
    requests = res.length;
    for (var rr = 0; rr < res.length; rr++) transferBytes += res[rr].transferSize || 0;
  } catch (e) { /* ignore */ }

  // --- layout tree -------------------------------------------------------
  var nodeId = 0;
  var MIN_BOX = 24;       // smaller than this is decoration, not structure
  var MAX_DEPTH = 7;

  function roleOf(el, cs, rect) {
    var tag = el.tagName.toLowerCase();
    var cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
    if (tag === 'nav' || /(^|\s)(nav|menu|header)/.test(cls)) return 'nav';
    if (tag === 'footer') return 'footer';
    if (tag === 'form' || el.querySelector(':scope > form')) return 'form';
    if (tag === 'aside') return 'aside';
    if (/hero|banner|slideshow|slider/.test(cls)) return 'hero';
    if (cs.display === 'grid' || /grid|collection|products|cards/.test(cls)) return 'grid';
    if (/card|item|tile/.test(cls)) return 'card';
    if (tag === 'img' || tag === 'picture' || tag === 'video' || /media|image|gallery/.test(cls)) return 'media';
    if (rect.height > 0 && el.textContent && el.textContent.trim().length > 120) return 'text';
    return null;
  }

  function columnCount(el, cs) {
    if (cs.display === 'grid') {
      var tpl = cs.gridTemplateColumns;
      if (tpl && tpl !== 'none') return tpl.trim().split(/\s+/).length;
    }
    if (cs.display === 'flex' && cs.flexDirection.indexOf('row') === 0) {
      var kids = 0;
      for (var k = 0; k < el.children.length; k++) {
        var kr = el.children[k].getBoundingClientRect();
        if (kr.width > 0 && kr.height > 0) kids++;
      }
      return kids > 1 ? kids : null;
    }
    return null;
  }

  function labelOf(el) {
    var tag = el.tagName.toLowerCase();
    if (el.id) return tag + '#' + el.id.slice(0, 28);
    var cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    return cls ? tag + '.' + cls.slice(0, 28) : tag;
  }

  var mainEl = document.querySelector('main, [role="main"], #MainContent') || document.body;
  var pageWidth = document.documentElement.clientWidth;

  function buildNode(el, depth) {
    if (depth > MAX_DEPTH || nodeId > 1200) return null;
    var cs = window.getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    if (!isVisible(el, cs, rect)) return null;
    if (rect.width < MIN_BOX || rect.height < MIN_BOX) return null;

    var children = [];
    for (var ci = 0; ci < el.children.length; ci++) {
      var kid = buildNode(el.children[ci], depth + 1);
      if (kid) children.push(kid);
    }

    // A "section" is a structurally tall block that fills ITS CONTAINER and sits
    // shallow in the tree.
    //
    // Measuring against the viewport instead of the container is wrong and was
    // the original bug: almost every theme wraps content in a max-width
    // container, so a 1200px section inside a 1440px viewport is 83% of the page
    // and would be rejected — while being, obviously, a section. What makes it
    // one is that it spans its parent, not that it spans the screen.
    var parentRect = el.parentElement ? el.parentElement.getBoundingClientRect() : null;
    var containerW = parentRect && parentRect.width > 0 ? parentRect.width : pageWidth;
    var fillsContainer = rect.width >= containerW * 0.9;

    // An explicit Shopify section is a section whatever its geometry.
    var declared = el.hasAttribute('data-section-type') || /^shopify-section/.test(el.id || '');

    var isSection = declared || (
      depth <= 4 && fillsContainer && rect.height >= 80
      && (el.tagName === 'SECTION' || el.parentElement === mainEl
        || el.parentElement === document.body || el.tagName === 'HEADER' || el.tagName === 'FOOTER')
    );

    return {
      id: 'n' + (nodeId++),
      tag: el.tagName.toLowerCase(),
      role: roleOf(el, cs, rect) || undefined,
      x: Math.round(rect.left + scrollX),
      y: Math.round(rect.top + scrollY),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      depth: depth,
      display: cs.display,
      cols: columnCount(el, cs),
      gap: cs.gap && cs.gap !== 'normal' ? px(cs.gap) : null,
      label: labelOf(el),
      section: isSection || undefined,
      children: children,
    };
  }

  var docH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  var layout = {
    id: 'root', tag: 'body', x: 0, y: 0, w: pageWidth, h: docH, depth: 0,
    display: 'block', cols: null, gap: null, label: 'body', children: [],
  };
  for (var bi = 0; bi < document.body.children.length; bi++) {
    var node = buildNode(document.body.children[bi], 1);
    if (node) layout.children.push(node);
  }

  // --- assemble ----------------------------------------------------------
  var styles = {};
  for (var key in counters) styles[key] = toTallies(counters[key]);

  return {
    url: location.href,
    surface: opts.surface || null,
    viewport: {
      width: window.innerWidth, height: window.innerHeight,
      label: opts.viewportLabel || (window.innerWidth < 500 ? 'mobile' : 'desktop'),
    },
    styles: styles,
    roles: roles,
    anatomy: anatomy,
    copy: {
      ctas: ctas, headings: headings,
      wordCount: (document.body.innerText || '').split(/\s+/).length,
      priceFormats: Object.keys(priceFormats),
      trustSignals: [],
    },
    engine: {
      scripts: scripts.slice(0, 80),
      apps: Object.keys(apps),
      isShopify: !!(window.Shopify || document.querySelector('[id^="shopify-section-"]')),
      theme: (window.Shopify && window.Shopify.theme && window.Shopify.theme.name) || null,
      themeVersion: (window.Shopify && window.Shopify.theme && window.Shopify.theme.theme_store_id) || null,
      requests: requests, transferBytes: transferBytes,
      vitals: vitals,
      sections: Object.keys(sections).filter(Boolean),
    },
    a11y: {
      contrastFailures: [],
      imagesMissingAlt: imagesMissingAlt, imagesTotal: imagesTotal,
      headingJumps: headingJumps, unlabeledControls: unlabeledControls,
      smallTapTargets: smallTapTargets,
    },
    layout: layout,
    collectedAt: Date.now(),
  };
}

/** The collector as source text, for injection where a function reference cannot cross. */
export const COLLECTOR_SOURCE = collectFromDocument.toString();
