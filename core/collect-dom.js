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
  // Visibility is INHERITED. A node with its own display:block inside a hidden
  // section is not on the page, and checking only the node itself is the single
  // largest source of false positives in a geometry audit — it reports text
  // sizes and targets for content nobody can see.
  var visCache = new WeakMap();
  function hiddenByAncestor(el) {
    var chain = [];
    var node = el;
    while (node && node !== document.body && node.nodeType === 1) {
      if (visCache.has(node)) {
        var cached = visCache.get(node);
        for (var c = 0; c < chain.length; c++) visCache.set(chain[c], cached);
        return cached;
      }
      chain.push(node);
      var s = window.getComputedStyle(node);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0'
          || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') {
        for (var h = 0; h < chain.length; h++) visCache.set(chain[h], true);
        return true;
      }
      node = node.parentElement;
    }
    for (var f = 0; f < chain.length; f++) visCache.set(chain[f], false);
    return false;
  }

  function isVisible(el, cs, rect) {
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    if (rect.width <= 0 || rect.height <= 0) return false;
    return !hiddenByAncestor(el.parentElement);
  }

  // --- walk --------------------------------------------------------------
  var all = document.querySelectorAll('body *');
  var limit = Math.min(all.length, MAX_NODES);
  var scrollX = window.scrollX || 0, scrollY = window.scrollY || 0;

  var imagesTotal = 0, imagesMissingAlt = 0, unlabeledControls = 0, imagesEager = 0;
  var targetsUnder24 = 0, targetsUnder44 = 0, controlsTotal = 0, inlineLinks = 0;
  var smallText = 0, tightLeading = 0;
  var tinyText = [], tinyTargets = [], measures = [];
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
      if (!el.getAttribute('loading')) imagesEager++;
    }
    if (/^H[1-6]$/.test(tag)) headingLevels.push(+tag[1]);

    // --- text size + measure ---------------------------------------------
    if (hasText) {
      var fs = px(cs.fontSize) || 0;
      var textLen = (el.textContent || '').trim().length;
      if (fs > 0 && fs < 12) tinyText.push({ px: fs, sample: (el.textContent || '').trim().slice(0, 40) });
      else if (fs >= 12 && fs < 14) smallText++;

      // Characters per line. Only meaningful for real paragraphs: short labels
      // and headings legitimately sit outside the 45-75 measure.
      if (textLen > 80 && rect.width > 60 && fs > 0) {
        // 0.48 of the font size is the average advance width of a humanist sans
        // at normal tracking. Verified per typeface would be better; stated as
        // an approximation so the number is not over-trusted.
        var cpl = Math.round(rect.width / (fs * 0.48));
        if (cpl > 10 && cpl < 400) {
          measures.push({ cpl: cpl, px: Math.round(fs), width: Math.round(rect.width),
            sample: (el.textContent || '').trim().slice(0, 50) });
        }
      }
      if (px(cs.lineHeight) && fs && px(cs.lineHeight) / fs < 1.4 && textLen > 120) tightLeading++;
    }

    // --- tap targets ------------------------------------------------------
    // Classify by ROLE, not by class name: a div called "chip" is not tappable
    // and flagging it is how an audit turns into damage.
    var isControl = tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA'
      || (tag === 'INPUT' && el.type !== 'hidden')
      || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link'
      || (tag === 'A' && el.hasAttribute('href'));

    if (isControl) {
      controlsTotal++;
      // WCAG 2.2 SC 2.5.8 exempts targets inline within a sentence — flagging
      // every in-paragraph link produces noise and loses the reader's trust.
      var parentTag = el.parentElement ? el.parentElement.tagName : '';
      var inlineInText = tag === 'A'
        && (parentTag === 'P' || parentTag === 'LI' || parentTag === 'SPAN' || parentTag === 'TD')
        && cs.display.indexOf('inline') === 0;

      if (!inlineInText) {
        var minSide = Math.min(rect.width, rect.height);
        if (minSide < 24) targetsUnder24++;
        else if (minSide < 44) targetsUnder44++;
        if (minSide < 24) {
          tinyTargets.push({ tag: tag.toLowerCase(), w: Math.round(rect.width), h: Math.round(rect.height),
            label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30) });
        }
      } else {
        inlineLinks++;
      }
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

  // --- platform ----------------------------------------------------------
  // Signatures inlined rather than imported because this function closes over
  // nothing. Kept in sync with knowledge/shopify/migration-patterns.json.
  var PLATFORM_SIGNATURES = {
    shopify: ['cdn.shopify.com', 'shopifycloud', 'myshopify.com', '/cdn/shop/'],
    'wordpress-woocommerce': ['wp-content', 'woocommerce', 'wp-includes', 'wp-json'],
    magento: ['magento', 'varien', 'Magento_', 'catalogsearch'],
    bigcommerce: ['bigcommerce', 'bc-sf-filter', 'stencilutils'],
    squarespace: ['squarespace', 'sqsp', 'squarespace-cdn'],
    wix: ['wixsite', 'parastorage.com', 'wixstatic.com'],
    vtex: ['vtexcommercestable', 'vtexassets', 'vteximg'],
    'salesforce-commerce': ['demandware', 'on/demandware', 'sfcc'],
    prestashop: ['prestashop', 'themes/classic'],
    webflow: ['webflow.com', 'assets.website-files.com', 'cdn.prod.website-files.com'],
    squarespace7: ['static1.squarespace.com'],
  };

  var haystack = '';
  try {
    haystack = (document.documentElement.outerHTML || '').slice(0, 600000).toLowerCase();
  } catch (e) { haystack = ''; }

  var platformHits = {};
  for (var plat in PLATFORM_SIGNATURES) {
    var sigs = PLATFORM_SIGNATURES[plat];
    for (var sg = 0; sg < sigs.length; sg++) {
      if (haystack.indexOf(sigs[sg].toLowerCase()) !== -1) {
        platformHits[plat] = (platformHits[plat] || 0) + 1;
      }
    }
  }

  var isShopifyStore = !!(window.Shopify || document.querySelector('[id^="shopify-section-"]')
    || platformHits.shopify);

  var detectedPlatform = 'unknown';
  var bestHits = 0;
  for (var ph in platformHits) {
    if (platformHits[ph] > bestHits) { bestHits = platformHits[ph]; detectedPlatform = ph; }
  }
  if (isShopifyStore) detectedPlatform = 'shopify';
  // Something is clearly being served, we just do not recognise it.
  if (detectedPlatform === 'unknown' && document.querySelector('form[action*="cart"], [class*="cart" i], [class*="product" i]')) {
    detectedPlatform = 'custom-ecommerce';
  }

  // --- webfonts ----------------------------------------------------------
  // Capture real @font-face sources so a preview can render in the ACTUAL
  // typeface rather than in whatever the viewer happens to have installed.
  // Cross-origin stylesheets throw on .cssRules, which is expected and ignored.
  var fontFaces = [];
  try {
    for (var si = 0; si < document.styleSheets.length && fontFaces.length < 24; si++) {
      var rules = null;
      try { rules = document.styleSheets[si].cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (var ri = 0; ri < rules.length && fontFaces.length < 24; ri++) {
        var rule = rules[ri];
        if (!rule || rule.type !== 5 /* CSSFontFaceRule */) continue;
        var fam = (rule.style.getPropertyValue('font-family') || '').replace(/^["']|["']$/g, '');
        var src = rule.style.getPropertyValue('src') || '';
        var urlMatch = src.match(/url\((["']?)([^"')]+)\1\)/);
        if (!fam || !urlMatch) continue;
        var href = urlMatch[2];
        try { href = new URL(href, document.styleSheets[si].href || location.href).href; } catch (e) { continue; }
        if (!/^https?:/.test(href)) continue;
        fontFaces.push({
          family: fam,
          src: href,
          weight: rule.style.getPropertyValue('font-weight') || '400',
          style: rule.style.getPropertyValue('font-style') || 'normal',
        });
      }
    }
  } catch (e) { /* stylesheet access denied */ }

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
  var docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);

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

  var layout = {
    id: 'root', tag: 'body', x: 0, y: 0, w: pageWidth, h: docHeight, depth: 0,
    display: 'block', cols: null, gap: null, label: 'body', children: [],
  };
  for (var bi = 0; bi < document.body.children.length; bi++) {
    var node = buildNode(document.body.children[bi], 1);
    if (node) layout.children.push(node);
  }

  // --- page geometry -----------------------------------------------------
  // "Measure; do not estimate." The Y of the first price and the first primary
  // action is the single most predictive pair of numbers on a commerce page, so
  // it is captured directly rather than inferred from anything else.
  function absY(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return null;
    return Math.round(r.top + scrollY);
  }
  function firstVisible(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var nodes = document.querySelectorAll(selectors[i]);
      for (var n = 0; n < nodes.length; n++) {
        var r = nodes[n].getBoundingClientRect();
        var cs2 = window.getComputedStyle(nodes[n]);
        if (isVisible(nodes[n], cs2, r)) return nodes[n];
      }
    }
    return null;
  }

  var priceEl = firstVisible(['[class*="price" i]', '.money', '[data-price]']);
  var ctaEl2 = atcEl || firstVisible([
    'main a[class*="button" i]', 'main button[class*="primary" i]', '.btn-primary',
    '[class*="button--primary" i]', 'main button',
  ]);
  var coreEl = firstVisible([
    '[class*="product-card" i]', '[class*="product-grid" i] > *', '[class*="card-wrapper" i]',
    '[class*="grid__item" i]', 'main table tbody tr',
  ]);

  // A sticky or fixed control that stays with the reader — the thing that makes
  // a long page survivable.
  var stickyControls = [];
  var candidates = document.querySelectorAll('header, [class*="sticky" i], [class*="fixed" i], [class*="bar" i], form[action*="/cart/add"]');
  for (var sc2 = 0; sc2 < candidates.length && stickyControls.length < 6; sc2++) {
    var scs = window.getComputedStyle(candidates[sc2]);
    if (scs.position !== 'sticky' && scs.position !== 'fixed') continue;
    var scr = candidates[sc2].getBoundingClientRect();
    if (scr.height < 20) continue;
    stickyControls.push({
      tag: candidates[sc2].tagName.toLowerCase(),
      position: scs.position,
      height: Math.round(scr.height),
      hasAction: !!candidates[sc2].querySelector('button, a[href], [role="button"]'),
    });
  }

  // Top-level sections in document order, for proportion analysis.
  var mainForSections = document.querySelector('main, [role="main"], #MainContent') || document.body;
  var sectionBlocks = [];
  for (var sb = 0; sb < mainForSections.children.length; sb++) {
    var child = mainForSections.children[sb];
    var cr = child.getBoundingClientRect();
    var ccs = window.getComputedStyle(child);
    if (!isVisible(child, ccs, cr) || cr.height < 40) continue;
    sectionBlocks.push({
      label: labelOf(child),
      y: Math.round(cr.top + scrollY),
      height: Math.round(cr.height),
    });
  }

  var footerEl = document.querySelector('footer, [role="contentinfo"], .site-footer');
  var footerRect = footerEl ? footerEl.getBoundingClientRect() : null;

  var navLinkCount = navItems.length;

  var geometry = {
    pageHeight: docHeight,
    viewportHeight: window.innerHeight,
    firstPriceY: absY(priceEl),
    firstActionY: absY(ctaEl2),
    firstActionLabel: text(ctaEl2) || null,
    coreContentY: absY(coreEl),
    stickyControls: stickyControls,
    sections: sectionBlocks,
    footerHeight: footerRect ? Math.round(footerRect.height) : 0,
    navItemCount: navLinkCount,
  };

  // --- dark patterns -----------------------------------------------------
  // All of these are mechanical: text matching and DOM state, no judgement.
  // Each records EVIDENCE (the actual string, the actual element) so a human
  // can overrule it — these are accusations and must be checkable.
  var bodyText = (document.body.innerText || '').slice(0, 120000);

  function findPhrases(patterns, scopeSelector) {
    var hits = [];
    var nodes = document.querySelectorAll(scopeSelector || 'button, a, label, span, p, div');
    for (var i = 0; i < nodes.length && hits.length < 12; i++) {
      if (nodes[i].children.length > 2) continue; // leaf-ish nodes only
      var t = (nodes[i].textContent || '').trim();
      if (!t || t.length > 140) continue;
      for (var pi = 0; pi < patterns.length; pi++) {
        if (patterns[pi].test(t)) { hits.push(t.slice(0, 110)); break; }
      }
    }
    return hits;
  }

  var darkPatterns = {
    // Brignull: confirmshaming — the decline option is written to shame.
    confirmshaming: findPhrases([
      /\bno,? (?:thanks?|i )?(?:don'?t|do not) want\b/i,
      /\bi (?:don'?t|do not) (?:want|like) (?:to )?(?:save|discount|deal)/i,
      /\bi (?:prefer|would rather) to pay full price\b/i,
      /\bno,? i (?:hate|don'?t like|am not interested)\b/i,
      /\bmaybe later,? i (?:enjoy|like)\b/i,
    ], 'button, a, label, [role="button"]'),

    // Pre-ticked opt-ins: consent that was never given.
    preCheckedOptIns: (function () {
      var out = [];
      var boxes = document.querySelectorAll('input[type="checkbox"]');
      for (var b = 0; b < boxes.length && out.length < 8; b++) {
        if (!boxes[b].checked) continue;
        var lbl = '';
        if (boxes[b].id) {
          var lab = document.querySelector('label[for="' + CSS.escape(boxes[b].id) + '"]');
          if (lab) lbl = (lab.textContent || '').trim();
        }
        if (!lbl && boxes[b].closest('label')) lbl = (boxes[b].closest('label').textContent || '').trim();
        // Only marketing/consent boxes matter; a "remember me" is not a dark pattern.
        if (!/subscrib|newsletter|market|offer|email|sms|partner|consent|share|updates/i.test(lbl)) continue;
        out.push(lbl.slice(0, 110));
      }
      return out;
    })(),

    // Manufactured urgency: countdowns and scarcity counters.
    urgency: findPhrases([
      /\bonly \d{1,2} left\b/i, /\b\d{1,2} (?:items?|units?) (?:left|remaining)\b/i,
      /\bhurry[,!\s]/i, /\bending soon\b/i, /\bselling fast\b/i,
      /\b\d+ (?:people|others) (?:are )?(?:viewing|looking)\b/i,
      /\boffer expires in\b/i, /\blimited time only\b/i,
    ]),
    countdownTimers: document.querySelectorAll('[class*="countdown" i], [class*="timer" i], [data-countdown]').length,

    // Roach motel: joining is a click, leaving is a phone call.
    hardToLeave: findPhrases([
      /\b(?:call|phone|contact) us to cancel\b/i,
      /\bcancel(?:lation)? (?:requires|must be requested)\b/i,
      /\bto cancel,? (?:please )?(?:email|call|contact)\b/i,
    ]),

    // Hidden costs signalled late.
    lateCosts: findPhrases([
      /\b(?:additional|extra) fees? (?:apply|at checkout)\b/i,
      /\b(?:shipping|taxes?|duties) calculated at checkout\b/i,
      /\bfinal price at checkout\b/i,
    ]),

    // Disguised ads inside content.
    disguisedAds: document.querySelectorAll('[class*="sponsor" i], [class*="promoted" i], [data-ad], ins.adsbygoogle').length,
  };

  // --- machine retrieval -------------------------------------------------
  // What a non-human reader gets. Answer engines and AI crawlers do not see the
  // rendered page the way a person does: most take the markup, the structured
  // data and the metadata, and many never run the JavaScript at all.
  var jsonLd = [];
  var jsonLdErrors = [];
  var ldNodes = document.querySelectorAll('script[type="application/ld+json"]');
  for (var li = 0; li < ldNodes.length && jsonLd.length < 20; li++) {
    var rawLd = ldNodes[li].textContent || '';
    try {
      var parsed = JSON.parse(rawLd);
      var items = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
      for (var ii = 0; ii < items.length && jsonLd.length < 20; ii++) {
        var item = items[ii];
        if (!item || typeof item !== 'object') continue;
        var type = item['@type'];
        if (Array.isArray(type)) type = type[0];
        jsonLd.push({
          type: type || 'Unknown',
          keys: Object.keys(item).filter(function (k) { return k.charAt(0) !== '@'; }).slice(0, 30),
          hasName: !!(item.name || item.headline),
          hasDescription: !!item.description,
          hasImage: !!item.image,
          // Offer detail is what decides whether a product is answerable at all.
          offers: item.offers
            ? {
                price: !!(item.offers.price || (item.offers[0] && item.offers[0].price)),
                currency: !!(item.offers.priceCurrency || (item.offers[0] && item.offers[0].priceCurrency)),
                availability: !!(item.offers.availability || (item.offers[0] && item.offers[0].availability)),
              }
            : null,
          hasRating: !!(item.aggregateRating || item.review),
          hasSameAs: !!item.sameAs,
        });
      }
    } catch (e) {
      jsonLdErrors.push((e.message || 'parse error').slice(0, 90));
    }
  }

  function metaContent(sel) {
    var n = document.querySelector(sel);
    return n ? (n.getAttribute('content') || '').trim() : null;
  }

  var h1Nodes = document.querySelectorAll('h1');
  var visibleH1 = [];
  for (var hi = 0; hi < h1Nodes.length; hi++) {
    var hr = h1Nodes[hi].getBoundingClientRect();
    var hcs = window.getComputedStyle(h1Nodes[hi]);
    if (isVisible(h1Nodes[hi], hcs, hr)) visibleH1.push((h1Nodes[hi].textContent || '').trim().slice(0, 90));
  }

  // How much of the page is content rather than furniture. A page that is
  // mostly navigation and footer gives a retrieval engine very little to quote.
  var mainText = mainForSections ? (mainForSections.innerText || '').trim().length : 0;
  var totalText = (document.body.innerText || '').trim().length;

  // Answerable structure: question-shaped headings are what Q&A retrieval
  // matches against, and they are worth nothing if they are not marked up.
  var questionHeadings = 0;
  var hAll = document.querySelectorAll('h2, h3, h4, summary, [class*="accordion" i] [class*="title" i]');
  for (var qi = 0; qi < hAll.length; qi++) {
    var qt = (hAll[qi].textContent || '').trim();
    if (qt.length > 8 && qt.length < 160 && /\?\s*$|^(how|what|why|when|where|who|can|do(es)?|is|are|will|should)\b/i.test(qt)) {
      questionHeadings++;
    }
  }

  // What the HUMAN is shown, in the same shape the machine payload carries, so
  // the two can be compared field for field. Capturing this asymmetrically —
  // structured on one side, prose on the other — is what stops most tools from
  // ever noticing that the two disagree.
  function renderedPrice() {
    var nodes = document.querySelectorAll('[class*="price" i], .money, [data-price], [itemprop="price"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var cs2 = window.getComputedStyle(el);
      var r2 = el.getBoundingClientRect();
      if (!isVisible(el, cs2, r2)) continue;
      // Skip the struck-through compare-at price. Taking it would report a
      // mismatch against JSON-LD on every discounted product, which is both
      // wrong and the most common state on a storefront.
      if (cs2.textDecorationLine.indexOf('line-through') !== -1) continue;
      var cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
      if (/compare|was-|--was|old-price|regular-price|strike|rrp/.test(cls)) continue;
      if (el.closest('s, del')) continue;

      var raw = (el.textContent || '').trim();
      // First price-shaped run in the text.
      var m = raw.match(/([^\d\s]{0,3})\s*(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?)\s*([^\d\s]{0,4})/);
      if (!m) continue;
      var digits = m[2];
      // Normalise "1.299,00" and "1,299.00" to a plain number.
      var normalised;
      if (/[.,]\d{1,2}$/.test(digits)) {
        var sep = digits.slice(-3, -2);
        normalised = digits.replace(/[.,\s]/g, function (c, idx) { return idx === digits.length - 3 && c === sep ? '.' : ''; });
      } else {
        normalised = digits.replace(/[.,\s]/g, '');
      }
      var value = parseFloat(normalised);
      if (!isFinite(value) || value <= 0) continue;
      return { value: value, text: raw.slice(0, 40), symbol: (m[1] || m[3] || '').trim() || null };
    }
    return null;
  }

  function renderedAvailability() {
    var atc = atcEl;
    if (atc && (atc.disabled || atc.getAttribute('aria-disabled') === 'true')) return 'unavailable';
    var atcText = atc ? (atc.textContent || '').trim().toLowerCase() : '';
    if (/sold out|out of stock|unavailable|notify me|back in stock/.test(atcText)) return 'unavailable';
    var body = (document.body.innerText || '').slice(0, 60000);
    if (/\b(sold out|out of stock|currently unavailable)\b/i.test(body)) return 'unavailable';
    if (/\b(in stock|available now|ships? (?:today|within|in))\b/i.test(body)) return 'available';
    return atc ? 'available' : null;
  }

  function heroImage() {
    var candidates = document.querySelectorAll('[class*="product__media" i] img, [class*="gallery" i] img, [class*="hero" i] img, main img');
    for (var i = 0; i < candidates.length; i++) {
      var r3 = candidates[i].getBoundingClientRect();
      if (r3.width < 150 || r3.height < 150) continue;
      var src = candidates[i].currentSrc || candidates[i].src;
      if (src) return src;
    }
    return null;
  }

  var renderedView = {
    h1: visibleH1[0] || null,
    title: (document.title || '').trim() || null,
    price: renderedPrice(),
    availability: renderedAvailability(),
    heroImage: heroImage(),
    url: location.href,
  };

  var retrieval = {
    rendered: renderedView,
    jsonLd: jsonLd,
    jsonLdTypes: jsonLd.map(function (j) { return j.type; }),
    jsonLdErrors: jsonLdErrors,
    title: (document.title || '').trim(),
    metaDescription: metaContent('meta[name="description"]'),
    canonical: (function () {
      var c = document.querySelector('link[rel="canonical"]');
      return c ? c.getAttribute('href') : null;
    })(),
    robotsMeta: metaContent('meta[name="robots"]'),
    ogTitle: metaContent('meta[property="og:title"]'),
    ogDescription: metaContent('meta[property="og:description"]'),
    ogImage: metaContent('meta[property="og:image"]'),
    lang: document.documentElement.getAttribute('lang') || null,
    h1Count: visibleH1.length,
    h1Text: visibleH1.slice(0, 3),
    headingCount: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
    mainTextLength: mainText,
    totalTextLength: totalText,
    contentRatio: totalText ? +(mainText / totalText).toFixed(3) : 0,
    questionHeadings: questionHeadings,
    hasFaqSchema: jsonLd.some(function (j) { return j.type === 'FAQPage' || j.type === 'QAPage'; }),
    hasBreadcrumbSchema: jsonLd.some(function (j) { return j.type === 'BreadcrumbList'; }),
    tablesForData: document.querySelectorAll('main table, article table').length,
  };

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
      isShopify: isShopifyStore,
      platform: detectedPlatform,
      platformSignals: platformHits,
      fontFaces: fontFaces,
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
      // Split by the criterion each one fails: 2.5.8 AA is 24px, 2.5.5 AAA and
      // the platform minimums are 44/48. One combined count cannot be cited.
      targetsUnder24: targetsUnder24,
      targetsUnder44: targetsUnder44,
      controlsTotal: controlsTotal,
      inlineLinksExempt: inlineLinks,
      tinyTargets: tinyTargets.slice(0, 10),
      textUnder12: tinyText.length,
      textUnder14: smallText,
      tinyTextSamples: tinyText.slice(0, 8),
      tightLeading: tightLeading,
      imagesEager: imagesEager,
    },
    typography: {
      measures: measures.slice(0, 60),
    },
    geometry: geometry,
    retrieval: retrieval,
    darkPatterns: darkPatterns,
    layout: layout,
    collectedAt: Date.now(),
  };
}

/** The collector as source text, for injection where a function reference cannot cross. */
export const COLLECTOR_SOURCE = collectFromDocument.toString();
