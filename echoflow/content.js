// EchoFlow Content Script
// Injected programmatically into the audited page to capture DOM data.

(function () {
  if (window.__echoflowInjected) return;
  window.__echoflowInjected = true;

  // ── Utilities ──

  function generateSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let current = el;
    while (current && current !== document.body && parts.length < 5) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift('#' + CSS.escape(current.id));
        break;
      }
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2);
        if (classes.length && classes[0]) {
          selector += '.' + classes.map(c => CSS.escape(c)).join('.');
        }
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function getResolvedBackground(el) {
    let current = el;
    while (current && current !== document.documentElement) {
      const bg = getComputedStyle(current).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        return bg;
      }
      current = current.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }

  function extractComputedStyles(el) {
    const cs = getComputedStyle(el);
    return {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      resolvedBackgroundColor: getResolvedBackground(el),
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily,
      lineHeight: cs.lineHeight,
      width: cs.width,
      height: cs.height,
      display: cs.display,
      position: cs.position,
      textDecoration: cs.textDecoration,
      textOverflow: cs.textOverflow,
      fontVariantNumeric: cs.fontVariantNumeric,
      overflow: cs.overflow
    };
  }

  function extractBounds(el) {
    const rect = el.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      bottom: rect.bottom,
      right: rect.right,
      absoluteTop: rect.top + window.scrollY,
      absoluteLeft: rect.left + window.scrollX
    };
  }

  function extractAttributes(el) {
    const attrs = {};
    for (const attr of el.attributes) {
      attrs[attr.name] = attr.value;
    }
    return attrs;
  }

  function matchesAny(el, selectors) {
    const matched = [];
    for (const sel of selectors) {
      try {
        if (el.matches(sel)) matched.push(sel);
      } catch (e) { /* invalid selector */ }
    }
    return matched;
  }

  // ── DOM Capture ──

  function captureElements(selectors) {
    // Query standard tags plus any rule-specific selectors
    const standardTags = 'h1,h2,h3,h4,h5,h6,a,button,[role="button"],input,select,textarea,img,video,nav,main,footer,header,section,article,form,label,p,li,span,td,svg,canvas,meta[name="viewport"]';
    const allSelectors = new Set();

    // Add standard tags
    standardTags.split(',').forEach(s => allSelectors.add(s.trim()));

    // Add rule selectors
    if (selectors) {
      selectors.forEach(s => {
        // Some selectors are comma-separated groups
        s.split(',').forEach(part => allSelectors.add(part.trim()));
      });
    }

    const captured = [];
    const seen = new WeakSet();
    let count = 0;
    const MAX_ELEMENTS = 500;

    for (const sel of allSelectors) {
      if (count >= MAX_ELEMENTS) break;
      let elements;
      try {
        elements = document.querySelectorAll(sel);
      } catch (e) { continue; }

      for (const el of elements) {
        if (count >= MAX_ELEMENTS) break;
        if (seen.has(el)) continue;
        seen.add(el);
        count++;

        const matchedSelectors = selectors ? matchesAny(el, selectors) : [];

        captured.push({
          tagName: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 200),
          innerText: (el.innerText || '').trim().slice(0, 200),
          bounds: extractBounds(el),
          computedStyles: extractComputedStyles(el),
          attributes: extractAttributes(el),
          selector: generateSelector(el),
          matchedSelectors: matchedSelectors,
          childCount: el.children.length
        });
      }
    }

    return captured;
  }

  function captureSections() {
    const sectionEls = document.querySelectorAll('[data-section-type], [data-section-id], [id^="shopify-section-"]');
    return Array.from(sectionEls).map((el, index) => {
      const rect = el.getBoundingClientRect();
      return {
        type: el.getAttribute('data-section-type') || null,
        id: el.getAttribute('data-section-id') || el.id || null,
        orderIndex: index,
        position: {
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
          width: rect.width,
          height: rect.height
        }
      };
    });
  }

  function captureScripts() {
    return Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
  }

  function captureMetaTags() {
    return Array.from(document.querySelectorAll('meta')).map(m => extractAttributes(m));
  }

  function captureForms() {
    return Array.from(document.querySelectorAll('form')).slice(0, 20).map(form => {
      const inputs = Array.from(form.querySelectorAll('input, select, textarea')).map(input => {
        const label = input.id ? document.querySelector('label[for="' + CSS.escape(input.id) + '"]') : null;
        return {
          tagName: input.tagName.toLowerCase(),
          type: input.type || null,
          name: input.name || null,
          id: input.id || null,
          required: input.required,
          pattern: input.pattern || null,
          ariaLabel: input.getAttribute('aria-label'),
          ariaLabelledby: input.getAttribute('aria-labelledby'),
          hasLabel: !!label || !!input.getAttribute('aria-label') || !!input.getAttribute('aria-labelledby'),
          autocomplete: input.autocomplete || null,
          placeholder: input.placeholder || null
        };
      });
      return {
        action: form.action || null,
        method: form.method || null,
        inputs: inputs
      };
    });
  }

  function captureImages() {
    return Array.from(document.querySelectorAll('img')).slice(0, 100).map(img => ({
      src: img.src,
      alt: img.alt,
      hasAlt: img.hasAttribute('alt'),
      bounds: extractBounds(img),
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      selector: generateSelector(img)
    }));
  }

  function captureLinks() {
    return Array.from(document.querySelectorAll('a')).slice(0, 100).map(a => ({
      href: a.href,
      text: (a.textContent || '').trim().slice(0, 100),
      bounds: extractBounds(a),
      selector: generateSelector(a)
    }));
  }

  function captureHeadings() {
    return Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
      level: parseInt(h.tagName[1]),
      text: (h.textContent || '').trim().slice(0, 200),
      bounds: extractBounds(h),
      selector: generateSelector(h)
    }));
  }

  // ── Shopify Data Listener ──

  function waitForShopifyData(timeoutMs) {
    return new Promise(resolve => {
      const timeout = setTimeout(() => resolve(null), timeoutMs || 3000);
      window.addEventListener('message', function handler(event) {
        if (event.source !== window) return;
        if (event.data?.type !== 'ECHOFLOW_SHOPIFY_DATA') return;
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        resolve(event.data.payload);
      });
    });
  }

  // ── Region Picker ──

  function activateRegionPicker() {
    return new Promise((resolve, reject) => {
      const overlay = document.createElement('div');
      overlay.id = 'echoflow-region-overlay';
      Object.assign(overlay.style, {
        position: 'fixed',
        pointerEvents: 'none',
        border: '2px solid #00C9A7',
        backgroundColor: 'rgba(0, 201, 167, 0.1)',
        zIndex: '2147483647',
        transition: 'all 0.05s ease',
        display: 'none',
        borderRadius: '4px'
      });
      document.body.appendChild(overlay);

      const label = document.createElement('div');
      Object.assign(label.style, {
        position: 'fixed',
        zIndex: '2147483647',
        background: '#00C9A7',
        color: '#fff',
        padding: '2px 8px',
        fontSize: '12px',
        fontFamily: 'system-ui, sans-serif',
        borderRadius: '3px',
        pointerEvents: 'none',
        display: 'none'
      });
      document.body.appendChild(label);

      let currentTarget = null;

      function mouseMoveHandler(e) {
        const target = e.target;
        if (target === overlay || target === label) return;
        currentTarget = target;
        const rect = target.getBoundingClientRect();
        Object.assign(overlay.style, {
          display: 'block',
          top: rect.top + 'px',
          left: rect.left + 'px',
          width: rect.width + 'px',
          height: rect.height + 'px'
        });
        Object.assign(label.style, {
          display: 'block',
          top: Math.max(0, rect.top - 22) + 'px',
          left: rect.left + 'px'
        });
        label.textContent = target.tagName.toLowerCase() +
          (target.className && typeof target.className === 'string' ? '.' + target.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
      }

      function clickHandler(e) {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        resolve({
          selector: generateSelector(currentTarget),
          bounds: extractBounds(currentTarget),
          tagName: currentTarget.tagName.toLowerCase()
        });
      }

      function keyHandler(e) {
        if (e.key === 'Escape') {
          cleanup();
          resolve(null);
        }
      }

      function cleanup() {
        document.removeEventListener('mousemove', mouseMoveHandler);
        document.removeEventListener('click', clickHandler, true);
        document.removeEventListener('keydown', keyHandler);
        overlay.remove();
        label.remove();
        document.body.style.cursor = '';
      }

      document.body.style.cursor = 'crosshair';
      document.addEventListener('mousemove', mouseMoveHandler);
      document.addEventListener('click', clickHandler, true);
      document.addEventListener('keydown', keyHandler);
    });
  }

  // ── Main Capture Function ──

  async function captureDOMData(vertical, selectors, waitForShopify) {
    const data = {
      url: window.location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      timestamp: Date.now(),
      vertical: vertical,
      elements: captureElements(selectors),
      sections: captureSections(),
      scripts: captureScripts(),
      metaTags: captureMetaTags(),
      forms: captureForms(),
      images: captureImages(),
      links: captureLinks(),
      headings: captureHeadings(),
      shopify: null,
      apiResponses: {}
    };

    if (waitForShopify) {
      data.shopify = await waitForShopifyData(3000);
    }

    return data;
  }

  // ── Message Handler ──

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'CAPTURE_DOM') {
      const { vertical, selectors, waitForShopify } = message;
      captureDOMData(vertical, selectors || [], waitForShopify)
        .then(data => sendResponse({ success: true, data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; // Keep channel open for async response
    }

    if (message.action === 'PICK_REGION') {
      activateRegionPicker()
        .then(region => sendResponse({ success: true, region }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // scrollHeight is now captured in CAPTURE_DOM response for wireframe layout
  });
})();
