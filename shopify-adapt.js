// EchoFlow — Shopify Adapt Content Script
// Analyzes any website's DOM structure and maps it to Shopify theme components.
// Injected into pages when user triggers "Shopify Adapt" analysis.

(function() {
  'use strict';

  // ── Layout Region Detection ──

  function detectLayoutRegions() {
    const regions = [];

    // Header
    const header = document.querySelector('header, [role="banner"], #header, .header, .site-header, .main-header, .page-header');
    if (header) {
      regions.push({ type: 'header', el: header, bounds: getBounds(header), children: analyzeHeaderContent(header) });
    }

    // Navigation
    const nav = document.querySelector('nav, [role="navigation"], .nav, .navbar, .main-nav, .site-nav, .primary-nav');
    if (nav && nav !== header) {
      regions.push({ type: 'navigation', el: nav, bounds: getBounds(nav), children: analyzeNavContent(nav) });
    }

    // Hero / Banner (first large visual section after header)
    const hero = document.querySelector(
      '.hero, .banner, .hero-banner, .hero-section, .main-banner, .slider, .slideshow, ' +
      '.carousel, [class*="hero"], [class*="banner"], [class*="jumbotron"], ' +
      '.swiper, .slick-slider, .owl-carousel'
    );
    if (hero) {
      regions.push({ type: 'hero', el: hero, bounds: getBounds(hero), children: analyzeHeroContent(hero) });
    }

    // Main content area
    const main = document.querySelector('main, [role="main"], #main, .main-content, .site-content, .page-content');
    if (main) {
      regions.push({ type: 'main-content', el: main, bounds: getBounds(main) });
    }

    // Sidebar
    const sidebar = document.querySelector('aside, [role="complementary"], .sidebar, .side-bar, #sidebar, .widget-area');
    if (sidebar) {
      regions.push({ type: 'sidebar', el: sidebar, bounds: getBounds(sidebar) });
    }

    // Footer
    const footer = document.querySelector('footer, [role="contentinfo"], #footer, .footer, .site-footer, .main-footer');
    if (footer) {
      regions.push({ type: 'footer', el: footer, bounds: getBounds(footer), children: analyzeFooterContent(footer) });
    }

    // Detect sections within main content
    const contentSections = detectContentSections(main || document.body);
    regions.push(...contentSections);

    return regions;
  }

  function analyzeHeaderContent(header) {
    const content = {};
    content.hasLogo = !!header.querySelector('img, svg, [class*="logo"]');
    content.hasSearch = !!header.querySelector('input[type="search"], [class*="search"], form[action*="search"]');
    content.hasCart = !!header.querySelector('[class*="cart"], [href*="cart"], [data-cart], .bag-icon');
    content.hasAccount = !!header.querySelector('[class*="account"], [href*="account"], [href*="login"]');
    content.hasMegaMenu = !!header.querySelector('[class*="mega"], .dropdown-mega, .mega-menu');
    content.hasAnnouncement = !!header.querySelector('[class*="announcement"], .top-bar, .promo-bar');
    content.navDepth = getNavDepth(header);
    return content;
  }

  function analyzeNavContent(nav) {
    const links = nav.querySelectorAll('a');
    const dropdowns = nav.querySelectorAll('ul ul, [class*="dropdown"], [class*="submenu"]');
    return {
      linkCount: links.length,
      hasDropdowns: dropdowns.length > 0,
      dropdownCount: dropdowns.length,
      depth: getNavDepth(nav)
    };
  }

  function analyzeHeroContent(hero) {
    return {
      hasImage: !!hero.querySelector('img, picture'),
      hasVideo: !!hero.querySelector('video, iframe[src*="youtube"], iframe[src*="vimeo"]'),
      hasHeading: !!hero.querySelector('h1, h2'),
      hasButton: !!hero.querySelector('a.btn, button, a[class*="button"], a[class*="cta"]'),
      hasSlider: !!hero.querySelector('.swiper, .slick, .owl-carousel, [class*="slide"]'),
      slideCount: hero.querySelectorAll('.swiper-slide, .slick-slide, .owl-item, [class*="slide-item"]').length || 1,
      hasOverlay: hasOverlayStyles(hero),
      hasParallax: hasParallaxEffect(hero)
    };
  }

  function analyzeFooterContent(footer) {
    return {
      hasNewsletter: !!footer.querySelector('form[action*="subscribe"], form[action*="newsletter"], input[type="email"], [class*="newsletter"]'),
      hasNavigation: !!footer.querySelector('nav, ul a'),
      hasSocialLinks: !!footer.querySelector('[class*="social"], [href*="facebook"], [href*="instagram"], [href*="twitter"], [href*="tiktok"]'),
      hasPaymentIcons: !!footer.querySelector('[class*="payment"], img[alt*="visa"], img[alt*="mastercard"], [class*="cc-"]'),
      columnCount: estimateColumns(footer)
    };
  }

  function getNavDepth(el) {
    let maxDepth = 1;
    const nestedLists = el.querySelectorAll('ul ul');
    nestedLists.forEach(ul => {
      let depth = 1;
      let parent = ul.parentElement;
      while (parent && parent !== el) {
        if (parent.tagName === 'UL') depth++;
        parent = parent.parentElement;
      }
      if (depth > maxDepth) maxDepth = depth;
    });
    return maxDepth;
  }

  function hasOverlayStyles(el) {
    const pseudo = window.getComputedStyle(el, '::before');
    if (pseudo && pseudo.position === 'absolute' && parseFloat(pseudo.opacity) < 1) return true;
    const overlay = el.querySelector('[class*="overlay"]');
    return !!overlay;
  }

  function hasParallaxEffect(el) {
    const style = window.getComputedStyle(el);
    if (style.backgroundAttachment === 'fixed') return true;
    if (el.hasAttribute('data-parallax') || el.className.includes('parallax')) return true;
    return false;
  }

  function estimateColumns(el) {
    const children = el.children;
    let maxInRow = 1;
    if (children.length === 0) return 0;
    const firstRect = children[0].getBoundingClientRect();
    let count = 0;
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      if (Math.abs(rect.top - firstRect.top) < 20) count++;
    }
    return Math.max(count, maxInRow);
  }

  // ── Content Section Detection ──

  function detectContentSections(root) {
    const sections = [];
    const candidates = root.querySelectorAll('section, [class*="section"], [class*="block"], [data-section], [data-block]');
    const seen = new Set();

    candidates.forEach(el => {
      if (seen.has(el) || el.offsetHeight === 0) return;
      // Skip nested sections (only top-level)
      let parent = el.parentElement;
      let isNested = false;
      while (parent && parent !== root) {
        if (seen.has(parent)) { isNested = true; break; }
        parent = parent.parentElement;
      }
      if (isNested) return;
      seen.add(el);

      const sectionType = classifySection(el);
      if (sectionType) {
        sections.push({
          type: sectionType,
          el: el,
          bounds: getBounds(el),
          children: analyzeSectionContent(el, sectionType)
        });
      }
    });

    return sections;
  }

  function classifySection(el) {
    const cls = (el.className || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const text = cls + ' ' + id;
    const html = el.innerHTML.toLowerCase().substring(0, 2000);

    // Product grid / collection
    if (text.match(/product.*(grid|list|collection|catalog)/i) || el.querySelectorAll('[class*="product-card"], [class*="product-item"]').length > 2) {
      return 'product-grid';
    }
    // Featured product
    if (text.match(/featured.?product|product.?featured|product.?detail|product.?info/i)) {
      return 'featured-product';
    }
    // Testimonials / reviews
    if (text.match(/testimonial|review|feedback|quote/i)) {
      return 'testimonials';
    }
    // FAQ / accordion
    if (text.match(/faq|accordion|collapsible|toggle/i) || el.querySelectorAll('details, [data-toggle], [class*="accordion"]').length > 1) {
      return 'faq-accordion';
    }
    // Blog / articles
    if (text.match(/blog|article|post|news/i) && el.querySelectorAll('article, [class*="post"], [class*="article"]').length > 0) {
      return 'blog-posts';
    }
    // Newsletter
    if (text.match(/newsletter|subscribe|signup|email.?capture/i) || el.querySelector('input[type="email"]')) {
      return 'newsletter';
    }
    // Video
    if (text.match(/video/i) || el.querySelector('video, iframe[src*="youtube"], iframe[src*="vimeo"]')) {
      return 'video';
    }
    // Image with text (text + single image side by side)
    if (text.match(/image.?with.?text|text.?with.?image|split|two.?col/i)) {
      return 'image-with-text';
    }
    // Multicolumn / features / USPs
    if (text.match(/feature|usp|benefit|why.?us|column|multi.?col|icon.?box/i)) {
      return 'multicolumn';
    }
    // Logo list / brands / partners
    if (text.match(/logo|brand|partner|client|sponsor|trusted/i) && el.querySelectorAll('img').length > 2) {
      return 'logo-list';
    }
    // Gallery
    if (text.match(/gallery|lightbox|masonry|photo/i)) {
      return 'gallery';
    }
    // Map / store locator
    if (text.match(/map|location|store.?locator|find.?us/i) || el.querySelector('iframe[src*="maps"]')) {
      return 'map';
    }
    // Contact form
    if (text.match(/contact|get.?in.?touch|reach.?us/i) && el.querySelector('form')) {
      return 'contact-form';
    }
    // CTA / banner
    if (text.match(/cta|call.?to.?action|promo|banner/i)) {
      return 'cta-banner';
    }
    // Tabs
    if (text.match(/tab/i) && el.querySelectorAll('[role="tab"], [class*="tab-"]').length > 1) {
      return 'tabs';
    }
    // Countdown
    if (text.match(/countdown|timer/i)) {
      return 'countdown';
    }
    // Rich text / generic content
    if (el.querySelector('h1, h2, h3') && el.querySelector('p') && !el.querySelector('img')) {
      return 'rich-text';
    }
    // Image banner
    if (el.querySelector('img') && el.querySelector('h1, h2') && el.querySelector('a, button')) {
      return 'image-banner';
    }

    return null; // Unclassified
  }

  function analyzeSectionContent(el, type) {
    const content = {};
    content.hasImages = el.querySelectorAll('img').length;
    content.hasHeadings = el.querySelectorAll('h1, h2, h3, h4').length;
    content.hasButtons = el.querySelectorAll('a[class*="btn"], button, a[class*="button"], a[class*="cta"]').length;
    content.hasForms = el.querySelectorAll('form').length;
    content.hasVideos = el.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length;

    if (type === 'product-grid') {
      content.productCardCount = el.querySelectorAll('[class*="product-card"], [class*="product-item"], .product, [data-product]').length;
      content.hasFilters = !!el.querySelector('[class*="filter"], [class*="facet"], aside');
      content.hasSort = !!el.querySelector('[class*="sort"], select[name*="sort"]');
      content.hasPagination = !!el.querySelector('[class*="pagination"], .pager, nav[aria-label*="pagination"]');
    }

    if (type === 'faq-accordion') {
      content.itemCount = el.querySelectorAll('details, [class*="accordion-item"], [class*="faq-item"], [data-toggle]').length;
    }

    if (type === 'testimonials') {
      content.testimonialCount = el.querySelectorAll('[class*="testimonial-item"], [class*="review-item"], blockquote, [class*="quote"]').length;
      content.hasRatings = !!el.querySelector('[class*="star"], [class*="rating"]');
    }

    return content;
  }

  // ── Component Detection ──

  function detectComponents() {
    const components = [];
    const doc = document;

    // Mega menu
    if (doc.querySelector('[class*="mega-menu"], [class*="megamenu"], .dropdown-mega')) {
      components.push({ type: 'mega-menu', detected: true, details: { depth: getNavDepth(doc.querySelector('header, nav') || doc.body) } });
    }

    // Sticky header
    const header = doc.querySelector('header, .header, .site-header');
    if (header) {
      const style = window.getComputedStyle(header);
      if (style.position === 'fixed' || style.position === 'sticky' || header.hasAttribute('data-sticky')) {
        components.push({ type: 'sticky-header', detected: true });
      }
    }

    // Cart drawer / mini cart
    if (doc.querySelector('[class*="cart-drawer"], [class*="mini-cart"], [class*="cart-sidebar"], [class*="minicart"], [class*="cart-slide"]')) {
      components.push({ type: 'cart-drawer', detected: true });
    }

    // Search (predictive/autocomplete)
    const searchInput = doc.querySelector('input[type="search"], [class*="search-input"]');
    if (searchInput) {
      const hasAutocomplete = !!doc.querySelector('[class*="search-result"], [class*="autocomplete"], [class*="predictive"], [class*="suggest"]');
      components.push({ type: 'search', detected: true, details: { predictive: hasAutocomplete } });
    }

    // Filters & sort
    if (doc.querySelector('[class*="filter"], [class*="facet"], [class*="refinement"]')) {
      components.push({ type: 'advanced-filters', detected: true });
    }

    // Breadcrumbs
    if (doc.querySelector('[class*="breadcrumb"], nav[aria-label*="breadcrumb"], .breadcrumbs, ol[itemtype*="BreadcrumbList"]')) {
      components.push({ type: 'breadcrumbs', detected: true });
    }

    // Product quick view
    if (doc.querySelector('[class*="quick-view"], [class*="quickview"], [data-quick-view]')) {
      components.push({ type: 'quick-view', detected: true });
    }

    // Wishlist
    if (doc.querySelector('[class*="wishlist"], [class*="wish-list"], [data-wishlist], [class*="favorite"]')) {
      components.push({ type: 'wishlist', detected: true });
    }

    // Reviews
    if (doc.querySelector('[class*="review"], [class*="rating"], .spr-container, .jdgm-widget, [class*="yotpo"], [class*="stamped"], [class*="loox"]')) {
      components.push({ type: 'reviews', detected: true });
    }

    // Newsletter popup
    if (doc.querySelector('[class*="popup"][class*="newsletter"], [class*="modal"][class*="subscribe"], [class*="popup"][class*="email"]')) {
      components.push({ type: 'popup-modal', detected: true, details: { subtype: 'newsletter-popup' } });
    }

    // Live chat
    if (doc.querySelector('[class*="chat"], #tidio, .gorgias, [class*="intercom"], [class*="zendesk"], [class*="drift"], [class*="crisp"]')) {
      components.push({ type: 'live-chat', detected: true });
    }

    // Social proof / sales notifications
    if (doc.querySelector('[class*="social-proof"], [class*="sales-pop"], [class*="recent-purchase"], [class*="nudge"]')) {
      components.push({ type: 'social-proof-notifications', detected: true });
    }

    // Countdown timer
    if (doc.querySelector('[class*="countdown"], [class*="timer"], [data-countdown]')) {
      components.push({ type: 'countdown-timer', detected: true });
    }

    // Sticky add to cart
    const stickyBars = doc.querySelectorAll('[class*="sticky"][class*="cart"], [class*="sticky"][class*="add"], [class*="sticky-bar"], [class*="fixed-bar"]');
    stickyBars.forEach(bar => {
      if (bar.querySelector('button, [class*="add-to-cart"]')) {
        components.push({ type: 'sticky-add-to-cart', detected: true });
      }
    });

    // Product tabs
    if (doc.querySelector('.product [role="tablist"], .product-tabs, [class*="product-tab"]')) {
      components.push({ type: 'product-tabs', detected: true });
    }

    // Size chart
    if (doc.querySelector('[class*="size-chart"], [class*="sizechart"], [class*="size-guide"]')) {
      components.push({ type: 'size-chart', detected: true });
    }

    // Image zoom
    if (doc.querySelector('[class*="zoom"], [data-zoom], .drift-zoom, .easyzoom')) {
      components.push({ type: 'image-zoom', detected: true });
    }

    // Recently viewed
    if (doc.querySelector('[class*="recently-viewed"], [class*="recent-products"]')) {
      components.push({ type: 'recently-viewed', detected: true });
    }

    // Back in stock
    if (doc.querySelector('[class*="back-in-stock"], [class*="notify-me"], [class*="restock"]')) {
      components.push({ type: 'back-in-stock', detected: true });
    }

    // Subscription / recurring
    if (doc.querySelector('[class*="subscription"], [class*="subscribe-save"], [class*="recurring"]')) {
      components.push({ type: 'subscription', detected: true });
    }

    // Product bundles
    if (doc.querySelector('[class*="bundle"], [class*="frequently-bought"], [class*="bought-together"]')) {
      components.push({ type: 'product-bundles', detected: true });
    }

    // Loyalty program
    if (doc.querySelector('[class*="loyalty"], [class*="rewards"], [class*="points"]')) {
      components.push({ type: 'loyalty-program', detected: true });
    }

    // Age verification
    if (doc.querySelector('[class*="age-verify"], [class*="age-gate"], [class*="age-check"]')) {
      components.push({ type: 'age-verification', detected: true });
    }

    // Currency switcher
    if (doc.querySelector('[class*="currency"], [class*="currency-switcher"], select[name*="currency"]')) {
      components.push({ type: 'currency-switcher', detected: true });
    }

    // Language switcher
    if (doc.querySelector('[class*="language"], [class*="lang-switch"], select[name*="language"], select[name*="locale"]')) {
      components.push({ type: 'multi-language', detected: true });
    }

    // Store locator / map
    if (doc.querySelector('[class*="store-locator"], [class*="find-store"], [class*="location-finder"]')) {
      components.push({ type: 'store-locator', detected: true });
    }

    // Product comparison
    if (doc.querySelector('[class*="compare"], [class*="comparison"]')) {
      components.push({ type: 'product-comparison', detected: true });
    }

    // Infinite scroll
    if (doc.querySelector('[class*="infinite"], [data-infinite], [class*="load-more"]')) {
      components.push({ type: 'infinite-scroll', detected: true });
    }

    // 360 view / 3D
    if (doc.querySelector('[class*="360"], [class*="three-d"], canvas[class*="product"], [class*="3d-viewer"]')) {
      components.push({ type: 'product-360-view', detected: true });
    }

    // Gift cards
    if (doc.querySelector('[class*="gift-card"], [class*="giftcard"]')) {
      components.push({ type: 'gift-cards', detected: true });
    }

    return components;
  }

  // ── Complexity Signals ──

  function detectTechStack() {
    const tech = {
      jsFrameworks: [],
      cssFrameworks: [],
      jsLibraries: [],
      buildTools: [],
      analytics: [],
      payments: [],
      cms: [],
      tagManagers: [],
      cdns: []
    };

    const html = document.documentElement.outerHTML.substring(0, 30000).toLowerCase();
    const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src.toLowerCase());
    const scriptStr = scripts.join(' ');
    const links = Array.from(document.querySelectorAll('link[href]')).map(l => l.href.toLowerCase());
    const linkStr = links.join(' ');
    const metas = document.querySelectorAll('meta');

    // ── JS Frameworks ──
    if (document.querySelector('[data-reactroot], [data-react-helmet], #__next, #__gatsby') || scriptStr.includes('react') || window.__NEXT_DATA__) {
      const fw = { name: 'React' };
      if (window.__NEXT_DATA__ || document.querySelector('#__next')) fw.meta = 'Next.js';
      else if (document.querySelector('#__gatsby') || scriptStr.includes('gatsby')) fw.meta = 'Gatsby';
      else if (scriptStr.includes('remix')) fw.meta = 'Remix';
      tech.jsFrameworks.push(fw);
    }
    if (document.querySelector('[data-v-], [data-vue-app], #__nuxt') || window.__VUE__ || window.__vue__) {
      const fw = { name: 'Vue.js' };
      if (document.querySelector('#__nuxt') || window.__NUXT__ || scriptStr.includes('nuxt')) fw.meta = 'Nuxt';
      tech.jsFrameworks.push(fw);
    }
    if (document.querySelector('[ng-app], [data-ng-app], app-root, [_ngcontent], [ng-version]')) {
      const fw = { name: 'Angular' };
      const ver = document.querySelector('[ng-version]');
      if (ver) fw.meta = 'v' + ver.getAttribute('ng-version');
      tech.jsFrameworks.push(fw);
    }
    if (document.querySelector('[class*="svelte-"]') || scriptStr.includes('svelte')) {
      tech.jsFrameworks.push({ name: 'Svelte' });
    }
    if (document.querySelector('[data-astro-cid]') || html.includes('astro')) {
      tech.jsFrameworks.push({ name: 'Astro' });
    }
    if (scriptStr.includes('alpine') || document.querySelector('[x-data], [x-bind], [x-on]')) {
      tech.jsFrameworks.push({ name: 'Alpine.js' });
    }
    if (document.querySelector('[data-controller]') || scriptStr.includes('stimulus') || scriptStr.includes('hotwire')) {
      tech.jsFrameworks.push({ name: 'Stimulus / Hotwire' });
    }
    if (scriptStr.includes('ember') || window.Ember) {
      tech.jsFrameworks.push({ name: 'Ember.js' });
    }
    if (scriptStr.includes('backbone') || window.Backbone) {
      tech.jsFrameworks.push({ name: 'Backbone.js' });
    }
    if (window.Preact || scriptStr.includes('preact')) {
      tech.jsFrameworks.push({ name: 'Preact' });
    }
    if (scriptStr.includes('solid') && document.querySelector('[data-hk]')) {
      tech.jsFrameworks.push({ name: 'SolidJS' });
    }
    if (scriptStr.includes('lit') || document.querySelector('[part]')) {
      // Only count if we see shadow DOM usage patterns
      if (document.querySelector('*').shadowRoot || html.includes('lit-html')) {
        tech.jsFrameworks.push({ name: 'Lit' });
      }
    }
    if (scriptStr.includes('htmx') || document.querySelector('[hx-get], [hx-post], [hx-trigger]')) {
      tech.jsFrameworks.push({ name: 'HTMX' });
    }
    if (scriptStr.includes('turbo') || document.querySelector('turbo-frame, turbo-stream')) {
      tech.jsFrameworks.push({ name: 'Turbo' });
    }

    // ── CSS Frameworks ──
    if (linkStr.includes('tailwind') || html.includes('tailwindcss') || document.querySelector('[class*="tw-"], .flex.items-center, .bg-white, .text-gray-')) {
      // More robust Tailwind detection: check for multiple utility classes
      const tailwindClasses = document.querySelectorAll('[class*="flex"][class*="items-"], [class*="bg-"][class*="text-"], [class*="px-"][class*="py-"]');
      if (tailwindClasses.length > 3 || linkStr.includes('tailwind')) {
        tech.cssFrameworks.push({ name: 'Tailwind CSS' });
      }
    }
    if (linkStr.includes('bootstrap') || scriptStr.includes('bootstrap') || document.querySelector('.container .row .col, .btn.btn-primary, .navbar-toggler')) {
      const fw = { name: 'Bootstrap' };
      // Try to detect version
      if (document.querySelector('[data-bs-toggle]')) fw.meta = 'v5';
      else if (document.querySelector('[data-toggle]')) fw.meta = 'v4 or earlier';
      tech.cssFrameworks.push(fw);
    }
    if (linkStr.includes('bulma') || document.querySelector('.columns .column, .button.is-primary, .hero.is-fullheight')) {
      tech.cssFrameworks.push({ name: 'Bulma' });
    }
    if (linkStr.includes('foundation') || scriptStr.includes('foundation') || document.querySelector('.grid-x .cell, .button.primary')) {
      tech.cssFrameworks.push({ name: 'Foundation' });
    }
    if (linkStr.includes('materialize') || document.querySelector('.materialize-textarea, .card-panel, .waves-effect')) {
      tech.cssFrameworks.push({ name: 'Materialize CSS' });
    }
    if (linkStr.includes('material') || document.querySelector('.mdc-button, .mat-button, [class*="MuiButton"]')) {
      tech.cssFrameworks.push({ name: 'Material UI / MUI' });
    }
    if (document.querySelector('[class*="chakra-"]')) {
      tech.cssFrameworks.push({ name: 'Chakra UI' });
    }
    if (document.querySelector('[class*="ant-btn"], [class*="ant-layout"]')) {
      tech.cssFrameworks.push({ name: 'Ant Design' });
    }

    // ── JS Libraries ──
    if (window.jQuery || window.$) {
      const jq = { name: 'jQuery' };
      try { jq.meta = 'v' + (window.jQuery || window.$).fn.jquery; } catch (_) {}
      tech.jsLibraries.push(jq);
    }
    if (scriptStr.includes('gsap') || scriptStr.includes('greensock') || window.gsap) {
      tech.jsLibraries.push({ name: 'GSAP' });
    }
    if (scriptStr.includes('three.js') || scriptStr.includes('three.min') || window.THREE) {
      tech.jsLibraries.push({ name: 'Three.js' });
    }
    if (scriptStr.includes('lottie') || document.querySelector('lottie-player, [class*="lottie"]')) {
      tech.jsLibraries.push({ name: 'Lottie' });
    }
    if (scriptStr.includes('d3.') || scriptStr.includes('d3.min') || window.d3) {
      tech.jsLibraries.push({ name: 'D3.js' });
    }
    if (scriptStr.includes('anime') || window.anime) {
      tech.jsLibraries.push({ name: 'Anime.js' });
    }
    if (scriptStr.includes('swiper') || document.querySelector('.swiper-container, .swiper')) {
      tech.jsLibraries.push({ name: 'Swiper' });
    }
    if (scriptStr.includes('slick') || document.querySelector('.slick-slider, .slick-track')) {
      tech.jsLibraries.push({ name: 'Slick Slider' });
    }
    if (scriptStr.includes('owl.carousel') || document.querySelector('.owl-carousel')) {
      tech.jsLibraries.push({ name: 'Owl Carousel' });
    }
    if (scriptStr.includes('splide') || document.querySelector('.splide')) {
      tech.jsLibraries.push({ name: 'Splide' });
    }
    if (scriptStr.includes('flickity') || document.querySelector('.flickity-viewport')) {
      tech.jsLibraries.push({ name: 'Flickity' });
    }
    if (scriptStr.includes('masonry') || document.querySelector('[data-masonry]')) {
      tech.jsLibraries.push({ name: 'Masonry' });
    }
    if (scriptStr.includes('isotope')) {
      tech.jsLibraries.push({ name: 'Isotope' });
    }
    if (scriptStr.includes('lodash') || window._) {
      tech.jsLibraries.push({ name: 'Lodash' });
    }
    if (scriptStr.includes('axios')) {
      tech.jsLibraries.push({ name: 'Axios' });
    }
    if (scriptStr.includes('moment') || window.moment) {
      tech.jsLibraries.push({ name: 'Moment.js' });
    }
    if (scriptStr.includes('chart.js') || scriptStr.includes('chartjs') || window.Chart) {
      tech.jsLibraries.push({ name: 'Chart.js' });
    }
    if (scriptStr.includes('mapbox')) {
      tech.jsLibraries.push({ name: 'Mapbox' });
    }
    if (scriptStr.includes('leaflet') || document.querySelector('.leaflet-container')) {
      tech.jsLibraries.push({ name: 'Leaflet' });
    }
    if (scriptStr.includes('photoswipe') || document.querySelector('.pswp')) {
      tech.jsLibraries.push({ name: 'PhotoSwipe' });
    }
    if (scriptStr.includes('lightbox') || scriptStr.includes('fancybox') || document.querySelector('[data-fancybox]')) {
      tech.jsLibraries.push({ name: 'Fancybox / Lightbox' });
    }
    if (scriptStr.includes('lazysizes') || document.querySelector('.lazyload, [data-src]')) {
      tech.jsLibraries.push({ name: 'Lazysizes' });
    }
    if (scriptStr.includes('aos') || document.querySelector('[data-aos]')) {
      tech.jsLibraries.push({ name: 'AOS (Animate on Scroll)' });
    }
    if (scriptStr.includes('scrollmagic') || scriptStr.includes('scroll-magic')) {
      tech.jsLibraries.push({ name: 'ScrollMagic' });
    }
    if (scriptStr.includes('barba')) {
      tech.jsLibraries.push({ name: 'Barba.js (Page Transitions)' });
    }
    if (scriptStr.includes('typed.js') || scriptStr.includes('typed.min')) {
      tech.jsLibraries.push({ name: 'Typed.js' });
    }
    if (scriptStr.includes('plyr') || document.querySelector('.plyr')) {
      tech.jsLibraries.push({ name: 'Plyr (Video Player)' });
    }
    if (scriptStr.includes('vidstack') || document.querySelector('media-player')) {
      tech.jsLibraries.push({ name: 'Vidstack' });
    }

    // ── Build Tools (from asset patterns) ──
    if (scriptStr.match(/\/_next\//) || scriptStr.includes('__next')) {
      tech.buildTools.push({ name: 'Next.js / Webpack' });
    } else if (scriptStr.match(/\/assets\/.*\.[a-f0-9]{8}\./) || html.includes('data-vite') || scriptStr.includes('/@vite') || scriptStr.includes('vite')) {
      tech.buildTools.push({ name: 'Vite' });
    } else if (scriptStr.match(/\/static\/js\/.*\.chunk\./) || html.includes('webpackJsonp') || scriptStr.includes('webpack')) {
      tech.buildTools.push({ name: 'Webpack' });
    }
    if (scriptStr.includes('parcel')) {
      tech.buildTools.push({ name: 'Parcel' });
    }
    if (scriptStr.includes('esbuild')) {
      tech.buildTools.push({ name: 'esbuild' });
    }

    // ── Analytics & Tracking ──
    if (scriptStr.includes('gtag') || scriptStr.includes('google-analytics') || scriptStr.includes('googletagmanager') || window.gtag || window.ga) {
      tech.analytics.push({ name: 'Google Analytics' });
    }
    if (scriptStr.includes('googletagmanager.com/gtm') || window.dataLayer) {
      tech.tagManagers.push({ name: 'Google Tag Manager' });
    }
    if (scriptStr.includes('segment.com') || scriptStr.includes('segment.io') || window.analytics) {
      tech.analytics.push({ name: 'Segment' });
    }
    if (scriptStr.includes('hotjar') || window.hj) {
      tech.analytics.push({ name: 'Hotjar' });
    }
    if (scriptStr.includes('fullstory') || window.FS) {
      tech.analytics.push({ name: 'FullStory' });
    }
    if (scriptStr.includes('clarity.ms') || window.clarity) {
      tech.analytics.push({ name: 'Microsoft Clarity' });
    }
    if (scriptStr.includes('mixpanel') || window.mixpanel) {
      tech.analytics.push({ name: 'Mixpanel' });
    }
    if (scriptStr.includes('amplitude') || window.amplitude) {
      tech.analytics.push({ name: 'Amplitude' });
    }
    if (scriptStr.includes('heap') || window.heap) {
      tech.analytics.push({ name: 'Heap' });
    }
    if (scriptStr.includes('plausible')) {
      tech.analytics.push({ name: 'Plausible' });
    }
    if (scriptStr.includes('fathom')) {
      tech.analytics.push({ name: 'Fathom' });
    }
    if (scriptStr.includes('connect.facebook') || scriptStr.includes('fbevents') || window.fbq) {
      tech.analytics.push({ name: 'Meta Pixel' });
    }
    if (scriptStr.includes('tiktok') || window.ttq) {
      tech.analytics.push({ name: 'TikTok Pixel' });
    }
    if (scriptStr.includes('pinterest') || scriptStr.includes('pintrk')) {
      tech.analytics.push({ name: 'Pinterest Tag' });
    }
    if (scriptStr.includes('snap.licdn') || scriptStr.includes('linkedin')) {
      tech.analytics.push({ name: 'LinkedIn Insight Tag' });
    }
    if (scriptStr.includes('klaviyo')) {
      tech.analytics.push({ name: 'Klaviyo' });
    }
    if (scriptStr.includes('mailchimp') || scriptStr.includes('chimpstatic')) {
      tech.analytics.push({ name: 'Mailchimp' });
    }
    if (scriptStr.includes('hubspot')) {
      tech.analytics.push({ name: 'HubSpot' });
    }
    if (scriptStr.includes('intercom') || window.Intercom) {
      tech.analytics.push({ name: 'Intercom' });
    }
    if (scriptStr.includes('sentry') || window.Sentry) {
      tech.analytics.push({ name: 'Sentry (Error Tracking)' });
    }
    if (scriptStr.includes('logrocket')) {
      tech.analytics.push({ name: 'LogRocket' });
    }
    if (scriptStr.includes('datadog')) {
      tech.analytics.push({ name: 'Datadog RUM' });
    }

    // ── Payment Providers ──
    if (scriptStr.includes('stripe') || document.querySelector('[class*="stripe"], #stripe')) {
      tech.payments.push({ name: 'Stripe' });
    }
    if (scriptStr.includes('paypal') || document.querySelector('[class*="paypal"], #paypal')) {
      tech.payments.push({ name: 'PayPal' });
    }
    if (scriptStr.includes('klarna') || document.querySelector('[class*="klarna"]')) {
      tech.payments.push({ name: 'Klarna' });
    }
    if (scriptStr.includes('afterpay') || scriptStr.includes('clearpay') || document.querySelector('[class*="afterpay"]')) {
      tech.payments.push({ name: 'Afterpay / Clearpay' });
    }
    if (scriptStr.includes('affirm') || document.querySelector('[class*="affirm"]')) {
      tech.payments.push({ name: 'Affirm' });
    }
    if (scriptStr.includes('sezzle') || document.querySelector('[class*="sezzle"]')) {
      tech.payments.push({ name: 'Sezzle' });
    }
    if (scriptStr.includes('adyen') || document.querySelector('[class*="adyen"]')) {
      tech.payments.push({ name: 'Adyen' });
    }
    if (scriptStr.includes('braintree')) {
      tech.payments.push({ name: 'Braintree' });
    }
    if (scriptStr.includes('square') && scriptStr.includes('payment')) {
      tech.payments.push({ name: 'Square' });
    }
    if (scriptStr.includes('shop-pay') || document.querySelector('[class*="shopify-payment"], [class*="shop-pay"]')) {
      tech.payments.push({ name: 'Shop Pay' });
    }
    if (document.querySelector('[class*="apple-pay"], .apple-pay-button') || scriptStr.includes('apple-pay')) {
      tech.payments.push({ name: 'Apple Pay' });
    }
    if (document.querySelector('[class*="gpay"], [class*="google-pay"]') || scriptStr.includes('google-pay') || scriptStr.includes('gpay')) {
      tech.payments.push({ name: 'Google Pay' });
    }

    // ── Headless CMS ──
    if (scriptStr.includes('contentful')) {
      tech.cms.push({ name: 'Contentful' });
    }
    if (scriptStr.includes('sanity.io') || scriptStr.includes('sanity')) {
      tech.cms.push({ name: 'Sanity' });
    }
    if (scriptStr.includes('prismic')) {
      tech.cms.push({ name: 'Prismic' });
    }
    if (scriptStr.includes('storyblok')) {
      tech.cms.push({ name: 'Storyblok' });
    }
    if (scriptStr.includes('strapi')) {
      tech.cms.push({ name: 'Strapi' });
    }
    if (scriptStr.includes('builder.io') || document.querySelector('[builder-id]')) {
      tech.cms.push({ name: 'Builder.io' });
    }
    if (scriptStr.includes('dato-cms') || scriptStr.includes('datocms')) {
      tech.cms.push({ name: 'DatoCMS' });
    }

    // ── CDNs ──
    if (scriptStr.includes('cloudflare') || linkStr.includes('cdnjs.cloudflare.com')) {
      tech.cdns.push({ name: 'Cloudflare CDN' });
    }
    if (scriptStr.includes('fastly') || linkStr.includes('fastly')) {
      tech.cdns.push({ name: 'Fastly' });
    }
    if (scriptStr.includes('akamai')) {
      tech.cdns.push({ name: 'Akamai' });
    }
    if (scriptStr.includes('unpkg.com')) {
      tech.cdns.push({ name: 'unpkg' });
    }
    if (scriptStr.includes('jsdelivr')) {
      tech.cdns.push({ name: 'jsDelivr' });
    }

    return tech;
  }

  function detectComplexitySignals() {
    const signals = {};

    // Inline styles count
    const allElements = document.body.querySelectorAll('*');
    let inlineStyleCount = 0;
    let totalElements = 0;
    const limit = 2000;
    for (let i = 0; i < Math.min(allElements.length, limit); i++) {
      totalElements++;
      if (allElements[i].hasAttribute('style') && allElements[i].getAttribute('style').length > 10) {
        inlineStyleCount++;
      }
    }
    signals.inlineStyleRatio = totalElements > 0 ? (inlineStyleCount / totalElements).toFixed(3) : 0;
    signals.inlineStyleCount = inlineStyleCount;

    // Canvas / WebGL
    signals.canvasElements = document.querySelectorAll('canvas').length;
    signals.hasWebGL = signals.canvasElements > 0 && !!document.querySelector('canvas[data-engine], canvas[class*="three"], canvas[class*="gl"]');

    // Iframes
    const iframes = document.querySelectorAll('iframe');
    signals.iframeCount = iframes.length;
    signals.iframeSources = Array.from(iframes).slice(0, 10).map(f => {
      try { return new URL(f.src).hostname; } catch { return f.src.substring(0, 50); }
    });

    // Comprehensive tech stack detection
    signals.techStack = detectTechStack();

    // Legacy compat flags
    signals.hasReact = signals.techStack.jsFrameworks.some(f => f.name === 'React');
    signals.hasVue = signals.techStack.jsFrameworks.some(f => f.name === 'Vue.js');
    signals.hasAngular = signals.techStack.jsFrameworks.some(f => f.name === 'Angular');
    signals.hasSvelte = signals.techStack.jsFrameworks.some(f => f.name === 'Svelte');

    // Video embeds
    signals.videoEmbeds = document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="wistia"]').length;

    // Animations / complex CSS
    const stylesheets = document.styleSheets;
    let animationCount = 0;
    try {
      for (let i = 0; i < stylesheets.length; i++) {
        try {
          const rules = stylesheets[i].cssRules;
          if (rules) {
            for (let j = 0; j < rules.length; j++) {
              if (rules[j].type === CSSRule.KEYFRAMES_RULE) animationCount++;
            }
          }
        } catch (_) {} // CORS-blocked stylesheets
      }
    } catch (_) {}
    signals.cssAnimations = animationCount;

    // Script count
    signals.scriptCount = document.querySelectorAll('script[src]').length;
    signals.inlineScriptCount = document.querySelectorAll('script:not([src])').length;

    // Third-party scripts — with categorized domains
    const thirdPartyScripts = [];
    const thirdPartyCategories = {};
    document.querySelectorAll('script[src]').forEach(s => {
      try {
        const url = new URL(s.src);
        const host = url.hostname;
        if (host !== window.location.hostname) {
          thirdPartyScripts.push(host);
          // Categorize known domains
          const domain = host.replace(/^www\./, '');
          if (domain.includes('google') || domain.includes('gtag') || domain.includes('gtm')) thirdPartyCategories[host] = 'analytics';
          else if (domain.includes('facebook') || domain.includes('fbcdn') || domain.includes('meta')) thirdPartyCategories[host] = 'social';
          else if (domain.includes('tiktok') || domain.includes('pinterest') || domain.includes('twitter') || domain.includes('snap')) thirdPartyCategories[host] = 'social';
          else if (domain.includes('stripe') || domain.includes('paypal') || domain.includes('klarna') || domain.includes('affirm') || domain.includes('afterpay')) thirdPartyCategories[host] = 'payment';
          else if (domain.includes('hotjar') || domain.includes('clarity') || domain.includes('fullstory') || domain.includes('heap') || domain.includes('sentry')) thirdPartyCategories[host] = 'monitoring';
          else if (domain.includes('klaviyo') || domain.includes('mailchimp') || domain.includes('hubspot') || domain.includes('intercom')) thirdPartyCategories[host] = 'marketing';
          else if (domain.includes('cdn') || domain.includes('cloudflare') || domain.includes('fastly') || domain.includes('jsdelivr') || domain.includes('unpkg')) thirdPartyCategories[host] = 'cdn';
          else if (domain.includes('shopify') || domain.includes('bigcommerce') || domain.includes('woocommerce')) thirdPartyCategories[host] = 'platform';
          else thirdPartyCategories[host] = 'other';
        }
      } catch (_) {}
    });
    signals.thirdPartyScripts = [...new Set(thirdPartyScripts)];
    signals.thirdPartyCount = signals.thirdPartyScripts.length;
    signals.thirdPartyCategories = thirdPartyCategories;

    // Platform detection
    signals.detectedPlatform = detectPlatform();

    return signals;
  }

  function detectPlatform() {
    const html = document.documentElement.innerHTML.substring(0, 5000).toLowerCase();
    const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src.toLowerCase()).join(' ');
    const meta = document.querySelector('meta[name="generator"]');
    const generator = meta ? meta.content.toLowerCase() : '';

    if (window.Shopify) return 'shopify';
    if (html.includes('wp-content') || generator.includes('wordpress')) return 'wordpress-woocommerce';
    if (html.includes('magento') || html.includes('mage')) return 'magento';
    if (html.includes('bigcommerce') || scripts.includes('bigcommerce')) return 'bigcommerce';
    if (html.includes('squarespace') || scripts.includes('squarespace')) return 'squarespace';
    if (html.includes('wixsite') || scripts.includes('wix.com')) return 'wix';
    if (html.includes('prestashop') || scripts.includes('prestashop')) return 'prestashop';
    if (scripts.includes('vtex')) return 'vtex';
    if (scripts.includes('salesforce') || html.includes('demandware')) return 'salesforce-commerce';
    if (html.includes('volusion')) return 'volusion';
    if (html.includes('3dcart') || html.includes('shift4shop')) return 'shift4shop';

    return 'custom-ecommerce';
  }

  function detectShopifyDetails() {
    if (!window.Shopify) return null;

    const details = {};

    // Theme info
    if (window.Shopify.theme) {
      details.theme = {
        name: window.Shopify.theme.name || 'Unknown',
        id: window.Shopify.theme.id || null,
        role: window.Shopify.theme.role || null // 'main' or 'unpublished'
      };
    }

    // Shop info
    details.shop = window.Shopify.shop || null;

    // Shopify features detected
    details.features = {};
    details.features.os2 = !!document.querySelector('[id^="shopify-section-template"]');
    details.features.sectionGroups = !!document.querySelector('[id^="shopify-section-group"]');
    details.features.predictiveSearch = !!document.querySelector('predictive-search, [data-predictive-search]');
    details.features.cartDrawer = !!document.querySelector('cart-drawer, [class*="cart-drawer"]');
    details.features.quickAdd = !!document.querySelector('quick-add-modal, [class*="quick-add"]');
    details.features.deferredMedia = !!document.querySelector('deferred-media');
    details.features.productMediaGallery = !!document.querySelector('media-gallery, slider-component.product');
    details.features.stickyHeader = !!document.querySelector('sticky-header');
    details.features.localizationForm = !!document.querySelector('localization-form');

    // Detect Shopify apps from script tags
    details.apps = [];
    const appSignatures = {
      'judge.me': { name: 'Judge.me (Reviews)', pattern: /judgeme|judge\.me/i },
      'loox': { name: 'Loox (Photo Reviews)', pattern: /loox/i },
      'yotpo': { name: 'Yotpo (Reviews/Loyalty)', pattern: /yotpo/i },
      'stamped': { name: 'Stamped.io (Reviews)', pattern: /stamped/i },
      'okendo': { name: 'Okendo (Reviews)', pattern: /okendo/i },
      'klaviyo': { name: 'Klaviyo (Email Marketing)', pattern: /klaviyo/i },
      'privy': { name: 'Privy (Popups/Email)', pattern: /privy/i },
      'omnisend': { name: 'Omnisend (Email)', pattern: /omnisend/i },
      'recharge': { name: 'ReCharge (Subscriptions)', pattern: /recharge|rechargepayments/i },
      'bold': { name: 'Bold (Various)', pattern: /boldapps|bold\.co/i },
      'smile': { name: 'Smile.io (Loyalty)', pattern: /smile\.io/i },
      'gorgias': { name: 'Gorgias (Helpdesk)', pattern: /gorgias/i },
      'tidio': { name: 'Tidio (Chat)', pattern: /tidio/i },
      'shopify-inbox': { name: 'Shopify Inbox', pattern: /shopify-chat|shopifychat/i },
      'aftership': { name: 'AfterShip (Tracking)', pattern: /aftership/i },
      'growave': { name: 'Growave (Reviews/Wishlist)', pattern: /growave/i },
      'wishlist-plus': { name: 'Wishlist Plus', pattern: /swymrelay|swym/i },
      'rebuy': { name: 'Rebuy (Upsell)', pattern: /rebuy/i },
      'reconvert': { name: 'ReConvert (Upsell)', pattern: /reconvert/i },
      'candy-rack': { name: 'Candy Rack (Upsell)', pattern: /candyrack|candy-rack/i },
      'zipify': { name: 'Zipify (Pages/Upsell)', pattern: /zipify/i },
      'pagefly': { name: 'PageFly (Page Builder)', pattern: /pagefly/i },
      'shogun': { name: 'Shogun (Page Builder)', pattern: /shogun/i },
      'gem-pages': { name: 'GemPages (Page Builder)', pattern: /gempages/i },
      'boost-commerce': { name: 'Boost (Filters/Search)', pattern: /boostcommerce/i },
      'searchanise': { name: 'Searchanise (Search)', pattern: /searchanise/i },
      'vitals': { name: 'Vitals (All-in-one)', pattern: /vitals\.co/i },
      'lucky-orange': { name: 'Lucky Orange (Analytics)', pattern: /luckyorange/i },
      'hotjar': { name: 'Hotjar', pattern: /hotjar/i },
      'google-analytics': { name: 'Google Analytics', pattern: /gtag|google-analytics|googletagmanager/i },
      'facebook-pixel': { name: 'Meta Pixel', pattern: /connect\.facebook|fbevents/i },
      'tiktok-pixel': { name: 'TikTok Pixel', pattern: /analytics\.tiktok/i },
      'pinterest-tag': { name: 'Pinterest Tag', pattern: /pintrk|pinterest/i },
      'kiwi-sizing': { name: 'Kiwi Size Chart', pattern: /kiwisizing/i },
      'geolocation': { name: 'Geolocation', pattern: /shopify-currency|geolocation/i },
      'langify': { name: 'Langify (Translation)', pattern: /langify/i },
      'weglot': { name: 'Weglot (Translation)', pattern: /weglot/i },
      'back-in-stock': { name: 'Back in Stock', pattern: /backinstock/i },
      'sezzle': { name: 'Sezzle (BNPL)', pattern: /sezzle/i },
      'klarna': { name: 'Klarna (BNPL)', pattern: /klarna/i },
      'afterpay': { name: 'Afterpay (BNPL)', pattern: /afterpay/i }
    };

    const allScripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
    const allHtml = document.documentElement.innerHTML.substring(0, 50000);
    const combined = allScripts.join(' ') + ' ' + allHtml;

    for (const [key, sig] of Object.entries(appSignatures)) {
      if (sig.pattern.test(combined)) {
        details.apps.push({ id: key, name: sig.name });
      }
    }

    // Count sections on page
    details.sectionCount = document.querySelectorAll('[id^="shopify-section-"]').length;

    // Detect metafields usage
    details.usesMetafields = !!document.querySelector('[class*="metafield"], [data-metafield]') || allHtml.includes('metafield');

    // Detect Shopify CDN images (optimization check)
    const shopifyImages = document.querySelectorAll('img[src*="cdn.shopify.com"]');
    let unoptimizedImages = 0;
    shopifyImages.forEach(img => {
      // Check if using image_url filter (has width param)
      if (img.src && !img.src.includes('_') && !img.src.includes('width=') && !img.src.includes('crop=')) {
        unoptimizedImages++;
      }
    });
    details.imageStats = {
      total: shopifyImages.length,
      possiblyUnoptimized: unoptimizedImages
    };

    // Detect if using app blocks vs legacy script injection
    details.usesAppBlocks = !!document.querySelector('[id*="shopify-block"], .shopify-block');

    return details;
  }

  // ── Page Type Detection ──

  function detectPageType() {
    const url = window.location.pathname.toLowerCase();
    const html = document.body.innerHTML.substring(0, 3000).toLowerCase();

    if (url === '/' || url === '/index' || url === '/home') return 'homepage';
    if (url.match(/\/(product|item|p)\//i) || document.querySelector('[itemtype*="Product"]') || html.includes('add to cart') || html.includes('add-to-cart')) return 'product';
    if (url.match(/\/(collection|category|shop|catalog|products)/i) || document.querySelectorAll('[class*="product-card"], [class*="product-item"]').length > 4) return 'collection';
    if (url.match(/\/(cart|basket)/i)) return 'cart';
    if (url.match(/\/(checkout|pay)/i)) return 'checkout';
    if (url.match(/\/(blog|article|post|news)/i)) return 'blog';
    if (url.match(/\/(about|our-story)/i)) return 'about';
    if (url.match(/\/(contact|get-in-touch)/i)) return 'contact';
    if (url.match(/\/(faq|help|support)/i)) return 'faq';
    if (url.match(/\/(account|profile|my-)/i)) return 'account';
    if (url.match(/\/(search|find)/i)) return 'search';

    return 'other';
  }

  // ── Helpers ──

  function getBounds(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      absoluteX: Math.round(rect.left + window.scrollX),
      absoluteY: Math.round(rect.top + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  // ── Main Entry Point ──

  function analyzeForShopifyAdapt() {
    const regions = detectLayoutRegions();
    const components = detectComponents();
    const complexitySignals = detectComplexitySignals();
    const pageType = detectPageType();
    const shopifyDetails = complexitySignals.detectedPlatform === 'shopify' ? detectShopifyDetails() : null;

    // Strip DOM element references (not serializable)
    const cleanRegions = regions.map(r => {
      const { el, ...rest } = r;
      return rest;
    });

    return {
      url: window.location.href,
      pageTitle: document.title,
      pageType,
      platform: complexitySignals.detectedPlatform,
      regions: cleanRegions,
      components,
      complexitySignals,
      shopifyDetails,
      timestamp: Date.now()
    };
  }

  // Listen for message from background/content script
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'SHOPIFY_ADAPT_ANALYZE') {
        try {
          const result = analyzeForShopifyAdapt();
          sendResponse({ success: true, data: result });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        return true;
      }
    });
  }

  // Also expose globally for direct injection
  window.__echoflowShopifyAdapt = analyzeForShopifyAdapt;
})();
