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

  function rgbToHex(rgb) {
    if (!rgb) return null;
    const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
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
      overflow: cs.overflow,
      marginTop: cs.marginTop,
      marginRight: cs.marginRight,
      marginBottom: cs.marginBottom,
      marginLeft: cs.marginLeft,
      paddingTop: cs.paddingTop,
      paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom,
      paddingLeft: cs.paddingLeft,
      borderRadius: cs.borderRadius,
      boxShadow: cs.boxShadow,
      letterSpacing: cs.letterSpacing,
      textAlign: cs.textAlign,
      gap: cs.gap,
      borderColor: cs.borderColor
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

  // ── Design Inventory ──

  async function captureDesignInventory() {
    const allEls = document.body.querySelectorAll('*');
    const colors = {};        // hex → count
    const fonts = {};         // family → count
    const fontSizes = {};     // px → count
    const typoCombos = {};    // "family|size|weight" → { fontFamily, fontSize, fontWeight, lineHeight, count }
    const spacings = {};      // px → count
    const radii = {};         // value → count
    const shadows = {};       // value → count
    const aligns = {};        // value → count
    const lineHeights = {};   // value → count
    const letterSpacings = {};// value → count
    let processed = 0;

    // ── Extra inventory buckets (features 1-6) ──
    const zIndexMap     = {};   // value → count
    const transitionMap = {};   // "duration|easing" → count
    const animationMap  = {};   // name → { duration, count }
    const contrastPairs = [];   // WCAG pairs (capped at 15)
    const seenPairs     = new Set();
    const gradients     = {};   // backgroundImage gradient → count

    function relativeLuminance(rgb) {
      const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (!m) return 1;
      const [r, g, b] = [m[1], m[2], m[3]].map(v => {
        const s = parseInt(v) / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    for (const el of allEls) {
      if (processed >= 1000) break;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      processed++;

      // Colors
      for (const prop of ['color', 'backgroundColor', 'borderColor']) {
        const val = cs[prop];
        if (!val || val === 'transparent' || val === 'rgba(0, 0, 0, 0)') continue;
        const hex = rgbToHex(val);
        if (hex) colors[hex] = (colors[hex] || 0) + 1;
      }

      // Typography
      const family = cs.fontFamily.split(',')[0].trim().replace(/['"]/g, '');
      if (family) fonts[family] = (fonts[family] || 0) + 1;
      const sizePx = parseFloat(cs.fontSize);
      if (sizePx) fontSizes[sizePx] = (fontSizes[sizePx] || 0) + 1;
      const comboKey = family + '|' + sizePx + '|' + cs.fontWeight;
      if (!typoCombos[comboKey]) {
        typoCombos[comboKey] = { fontFamily: family, fontSize: sizePx, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, count: 0 };
      }
      typoCombos[comboKey].count++;

      // Line height (normalize to ratio if px, else keep as-is)
      const lh = cs.lineHeight;
      if (lh && lh !== 'normal') {
        const lhNum = parseFloat(lh);
        const lhVal = sizePx && lhNum ? (Math.round((lhNum / sizePx) * 10) / 10).toString() : lh;
        lineHeights[lhVal] = (lineHeights[lhVal] || 0) + 1;
      }

      // Letter spacing
      const ls = cs.letterSpacing;
      if (ls && ls !== '0px' && ls !== 'normal') {
        letterSpacings[ls] = (letterSpacings[ls] || 0) + 1;
      }

      // Spacing
      for (const prop of ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
        const px = parseFloat(cs[prop]);
        if (px > 0) spacings[px] = (spacings[px] || 0) + 1;
      }

      // Border radius
      const br = cs.borderRadius;
      if (br && br !== '0px') radii[br] = (radii[br] || 0) + 1;

      // Box shadow
      const bs = cs.boxShadow;
      if (bs && bs !== 'none') shadows[bs] = (shadows[bs] || 0) + 1;

      // Background gradients
      const bi = cs.backgroundImage;
      if (bi && bi !== 'none' && bi.includes('gradient')) {
        const gKey = bi.length > 120 ? bi.slice(0, 120) + '…' : bi;
        gradients[gKey] = (gradients[gKey] || 0) + 1;
      }

      // Text align
      const ta = cs.textAlign;
      if (ta) aligns[ta] = (aligns[ta] || 0) + 1;

      // ── Z-index ──
      const zi = cs.zIndex;
      if (zi && zi !== 'auto') {
        const zn = parseInt(zi);
        if (!isNaN(zn)) zIndexMap[zn] = (zIndexMap[zn] || 0) + 1;
      }

      // ── Motion: transitions ──
      const td = cs.transitionDuration;
      if (td && td !== '0s') {
        const te = cs.transitionTimingFunction || 'ease';
        const durs = td.split(',').map(s => s.trim());
        const eases = te.split(',').map(s => {
          const t = s.trim();
          if (t === 'ease' || t.includes('0.25, 0.1, 0.25, 1')) return 'ease';
          if (t === 'linear' || t.includes('0, 0, 1, 1')) return 'linear';
          if (t === 'ease-in-out') return 'ease-in-out';
          if (t === 'ease-in') return 'ease-in';
          if (t === 'ease-out') return 'ease-out';
          return t.slice(0, 30);
        });
        for (let i = 0; i < durs.length; i++) {
          const d = durs[i];
          if (!d || d === '0s' || d === '0ms') continue;
          const key = d + '|' + (eases[i] || 'ease');
          transitionMap[key] = (transitionMap[key] || 0) + 1;
        }
      }

      // ── Motion: animations ──
      const an = cs.animationName;
      if (an && an !== 'none') {
        const aDur = cs.animationDuration || '0s';
        animationMap[an] = { duration: aDur, count: (animationMap[an]?.count || 0) + 1 };
      }

      // ── Contrast Sampling ──
      if (contrastPairs.length < 15 && el.textContent?.trim() && el.children.length <= 4) {
        const textRgb = cs.color;
        const bgRgb   = getResolvedBackground(el);
        if (textRgb && bgRgb) {
          const pKey = textRgb + '|' + bgRgb;
          if (!seenPairs.has(pKey)) {
            seenPairs.add(pKey);
            const lT = relativeLuminance(textRgb);
            const lB = relativeLuminance(bgRgb);
            const lighter = Math.max(lT, lB);
            const darker  = Math.min(lT, lB);
            const ratio   = (lighter + 0.05) / (darker + 0.05);
            const fsPx    = parseFloat(cs.fontSize) || 16;
            const fw      = parseInt(cs.fontWeight) || 400;
            const isLarge = fsPx >= 18 || (fsPx >= 14 && fw >= 700);
            const aaThresh  = isLarge ? 3 : 4.5;
            const aaaThresh = isLarge ? 4.5 : 7;
            contrastPairs.push({
              textHex: rgbToHex(textRgb) || textRgb,
              bgHex:   rgbToHex(bgRgb)   || bgRgb,
              textRgb, bgRgb,
              ratio:   Math.round(ratio * 100) / 100,
              level:   ratio >= aaaThresh ? 'AAA' : ratio >= aaThresh ? 'AA' : 'FAIL',
              fontSize: Math.round(fsPx),
              isLarge,
              tag: el.tagName.toLowerCase()
            });
          }
        }
      }
    }

    const toSorted = obj => Object.entries(obj)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);

    // Calculate spacing scale adherence (% on 4px grid)
    const spacingEntries = Object.entries(spacings);
    let onGrid = 0, totalSpacing = 0;
    for (const [px, count] of spacingEntries) {
      totalSpacing += count;
      if (parseFloat(px) % 4 === 0) onGrid += count;
    }

    // ── Logo detection ──
    // Tries each candidate selector in priority order. When the matched element
    // is an <img src="*.svg">, fetches the SVG text so the results page can show
    // an inline preview and offer "Download SVG" instead of a raster download.
    let logo = null;
    const logoSelectors = [
      'header a[href="/"] svg', 'header a[href="/"] img',
      'nav a[href="/"] svg', 'nav a[href="/"] img',
      '[class*="logo"] svg', '[class*="logo"] img',
      '[id*="logo"] svg', '[id*="logo"] img',
      'header svg', '.site-logo svg', '.site-logo img',
      '.navbar-brand img', '.navbar-brand svg',
    ];

    function normalizeSvgEl(svgEl) {
      svgEl.style.maxWidth = '160px';
      svgEl.style.maxHeight = '60px';
      svgEl.removeAttribute('width');
      svgEl.removeAttribute('height');
      if (!svgEl.getAttribute('viewBox')) {
        svgEl.setAttribute('viewBox', '0 0 ' + (svgEl.getAttribute('width') || 100) + ' ' + (svgEl.getAttribute('height') || 40));
      }
      return svgEl.outerHTML;
    }

    for (const sel of logoSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;

      if (el.tagName === 'svg') {
        const clone = el.cloneNode(true);
        clone.setAttribute('viewBox', el.getAttribute('viewBox') || '0 0 ' + (el.getAttribute('width') || 100) + ' ' + (el.getAttribute('height') || 40));
        logo = { type: 'svg', content: normalizeSvgEl(clone) };
        break;
      } else if (el.tagName === 'IMG') {
        const src = el.src || el.getAttribute('src');
        if (!src) continue;

        // If the img src points to an SVG file, fetch its content so we can
        // provide inline display + "Download SVG" instead of a raster download.
        const isSvgSrc = src.split('?')[0].toLowerCase().endsWith('.svg');
        if (isSvgSrc) {
          try {
            const resp = await fetch(src, { credentials: 'omit' });
            if (resp.ok) {
              const svgText = await resp.text();
              if (svgText.includes('<svg')) {
                const parser = new DOMParser();
                const parsed = parser.parseFromString(svgText, 'image/svg+xml');
                const svgEl = parsed.querySelector('svg');
                const parseErr = parsed.querySelector('parsererror');
                if (svgEl && !parseErr) {
                  logo = { type: 'svg', content: normalizeSvgEl(svgEl) };
                  break;
                }
              }
            }
          } catch (_) {
            // CORS block or parse failure — fall through to img type below
          }
        }

        logo = { type: 'img', src };
        break;
      }
    }

    // ── Image format distribution ──
    const imageFormats = {};
    let hasLazyLoading = false;
    const imgs = document.querySelectorAll('img, source');
    for (const img of imgs) {
      const src = img.src || img.srcset || img.getAttribute('src') || img.getAttribute('srcset') || '';
      if (img.loading === 'lazy' || img.getAttribute('loading') === 'lazy') hasLazyLoading = true;
      const extMatch = src.match(/\.(webp|avif|svg|png|jpg|jpeg|gif|bmp|ico)(\?|$|\s|,)/i);
      if (extMatch) {
        const fmt = extMatch[1].toLowerCase().replace('jpeg', 'jpg');
        imageFormats[fmt] = (imageFormats[fmt] || 0) + 1;
      }
    }

    // ── UI framework detection ──
    let uiFramework = null;
    const bodyClasses = document.body.className || '';
    const allClassNames = Array.from(document.querySelectorAll('[class]')).map(el => el.className).join(' ');
    if (/\b(tw-|tailwind)/.test(allClassNames) || /\bflex\b|\bgrid\b|\bblock\b|\bhidden\b|\btext-\w+-\d+\b/.test(allClassNames)) uiFramework = 'Tailwind CSS';
    else if (/\bcol-\w+-\d+\b|\bbtn-\w+\b|\bnavbar\b|\bcontainer\b/.test(allClassNames)) uiFramework = 'Bootstrap';
    else if (window.Shopify) uiFramework = 'Shopify (Dawn)';
    const materialLink = document.querySelector('link[href*="material"], script[src*="material-ui"], script[src*="@mui"]');
    if (materialLink) uiFramework = 'Material UI';

    // ── Icon library detection ──
    let iconLibrary = null;
    const iconLinks = Array.from(document.querySelectorAll('link[href], script[src]')).map(el => el.href || el.src || '');
    if (iconLinks.some(u => u.includes('font-awesome') || u.includes('fontawesome'))) iconLibrary = 'Font Awesome';
    else if (iconLinks.some(u => u.includes('material-icons') || u.includes('material.io/icons'))) iconLibrary = 'Material Icons';
    else if (document.querySelector('[class*="heroicon"], [data-heroicon]')) iconLibrary = 'Heroicons';
    else if (document.querySelector('[class*="lucide"]')) iconLibrary = 'Lucide';
    else if (document.querySelector('[class*="feather"]')) iconLibrary = 'Feather Icons';
    else if (iconLinks.some(u => u.includes('remix-icon') || u.includes('remixicon'))) iconLibrary = 'Remix Icons';
    else if (document.querySelector('.icon-tabler')) iconLibrary = 'Tabler Icons';

    // ── @font-face capture (for sidebar preview) ──
    // Google Fonts: capture the <link> href — cssRules is inaccessible cross-origin
    const googleFontLinks = Array.from(document.querySelectorAll('link[href*="fonts.googleapis.com"]'))
      .map(l => l.href)
      .filter(Boolean);

    // Self-hosted fonts: capture @font-face rules from same-origin sheets
    const fontFaceRules = [];
    try {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules || []) {
            if (rule.constructor.name === 'CSSFontFaceRule') {
              const text = rule.cssText;
              if (text.length < 4000) fontFaceRules.push(text);
            }
          }
        } catch (_) {} // cross-origin sheets throw SecurityError — skip silently
      }
    } catch (_) {}

    // ── Full tech stack detection ──
    const allScripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src || '');
    const allLinks   = Array.from(document.querySelectorAll('link[href]')).map(l => l.href || '');
    const allAssets  = [...allScripts, ...allLinks, ...iconLinks];
    const metaGenerator = document.querySelector('meta[name="generator"]')?.content || '';
    const bodyHtml = document.body.innerHTML.slice(0, 40000);

    function detectAny(patterns) {
      return patterns.some(p => {
        if (typeof p === 'string') return allAssets.some(u => u.includes(p)) || bodyHtml.includes(p);
        return p.test(bodyHtml) || allAssets.some(u => p.test(u));
      });
    }

    const techStack = {
      cms: null,
      jsFramework: null,
      cssFramework: uiFramework || null,
      analytics: [],
      marketing: [],
      abTesting: null,
      tagManager: null,
      ecommerce: null,
    };

    // CMS
    if (window.Shopify || detectAny(['cdn.shopify.com'])) techStack.cms = 'Shopify';
    else if (/wp-content|wp-includes/.test(bodyHtml) || /wordpress/.test(metaGenerator.toLowerCase())) techStack.cms = 'WordPress';
    else if (/wix\.com|wixsite/.test(bodyHtml) || detectAny(['static.wixstatic.com'])) techStack.cms = 'Wix';
    else if (detectAny(['webflow.com', 'assets-global.website-files.com'])) techStack.cms = 'Webflow';
    else if (/squarespace/.test(bodyHtml) || detectAny(['sqspcdn.com', 'squarespace.com'])) techStack.cms = 'Squarespace';
    else if (/framer\.com/.test(bodyHtml) || detectAny(['framer.com'])) techStack.cms = 'Framer';
    else if (/ghost-url|ghost\.io/.test(bodyHtml)) techStack.cms = 'Ghost';
    else if (detectAny(['cdn.webcompat.com']) || /drupal/.test(metaGenerator.toLowerCase())) techStack.cms = 'Drupal';

    // JS Framework
    if (window.__NEXT_DATA__ || detectAny(['/_next/'])) techStack.jsFramework = 'Next.js';
    else if (window.__nuxt || window.$nuxt) techStack.jsFramework = 'Nuxt';
    else if (window.angular || detectAny(['/angular'])) techStack.jsFramework = 'Angular';
    else if (window.__SVELTE__ || detectAny(['.svelte'])) techStack.jsFramework = 'SvelteKit';
    else if (window.React || document.querySelector('[data-reactroot], [data-reactid]') || detectAny(['react.production.min.js', 'react-dom'])) techStack.jsFramework = 'React';
    else if (window.Vue || document.querySelector('[data-v-]') || detectAny(['vue.runtime', 'vue.min.js'])) techStack.jsFramework = 'Vue';
    else if (window.Astro || detectAny(['astro/'])) techStack.jsFramework = 'Astro';
    else if (window.Ember || detectAny(['ember.min'])) techStack.jsFramework = 'Ember';

    // Analytics
    if (window.gtag || window.ga || detectAny(['google-analytics.com', 'googletagmanager.com/gtag'])) techStack.analytics.push('Google Analytics');
    if (detectAny(['hotjar.com', 'static.hotjar.com'])) techStack.analytics.push('Hotjar');
    if (detectAny(['cdn.segment.com', 'segment.io'])) techStack.analytics.push('Segment');
    if (detectAny(['mixpanel.com'])) techStack.analytics.push('Mixpanel');
    if (detectAny(['heap.io', 'heapanalytics.com'])) techStack.analytics.push('Heap');
    if (detectAny(['clarity.ms', 'clarity.microsoft.com'])) techStack.analytics.push('Clarity');
    if (detectAny(['plausible.io'])) techStack.analytics.push('Plausible');

    // Tag manager
    if (window.google_tag_manager || detectAny(['googletagmanager.com/gtm'])) techStack.tagManager = 'Google Tag Manager';
    else if (detectAny(['tealiumiq.com', 'tiqcdn.com'])) techStack.tagManager = 'Tealium';
    else if (detectAny(['launch.adobe.com', 'assets.adobedtm.com'])) techStack.tagManager = 'Adobe Launch';

    // Marketing / CRM
    if (detectAny(['js.hs-scripts.com', 'hubspot.com'])) techStack.marketing.push('HubSpot');
    if (detectAny(['intercomcdn.com', 'widget.intercom.io'])) techStack.marketing.push('Intercom');
    if (detectAny(['drift.com', 'js.driftt.com'])) techStack.marketing.push('Drift');
    if (detectAny(['crisp.chat'])) techStack.marketing.push('Crisp');
    if (detectAny(['zendesk.com', 'zopim.com'])) techStack.marketing.push('Zendesk');
    if (detectAny(['connect.facebook.net', 'fbevents.js'])) techStack.marketing.push('Meta Pixel');
    if (detectAny(['klaviyo.com'])) techStack.marketing.push('Klaviyo');
    if (detectAny(['mailchimp.com', 'chimpstatic.com'])) techStack.marketing.push('Mailchimp');

    // A/B testing
    if (detectAny(['optimizely.com'])) techStack.abTesting = 'Optimizely';
    else if (detectAny(['vwo.com'])) techStack.abTesting = 'VWO';
    else if (detectAny(['abtasty.com'])) techStack.abTesting = 'AB Tasty';
    else if (detectAny(['launchdarkly.com'])) techStack.abTesting = 'LaunchDarkly';

    // E-commerce
    if (techStack.cms === 'Shopify') techStack.ecommerce = 'Shopify';
    else if (detectAny(['woocommerce'])) techStack.ecommerce = 'WooCommerce';
    else if (detectAny(['magento'])) techStack.ecommerce = 'Magento';
    else if (detectAny(['bigcommerce.com'])) techStack.ecommerce = 'BigCommerce';

    // ── SVG inventory ──
    // Collect every visible inline <svg> and every <img src="*.svg"> on the page.
    // Inline SVGs are serialized; img-based SVGs store only the URL (fetched at
    // download time in the results page to avoid blocking capture).
    const svgInventory = [];
    const svgSeen = new Set();
    const MAX_SVG_CONTENT = 12000; // ~12 KB per SVG — skip overly complex ones

    // 1. Inline <svg> elements
    for (const svgEl of document.querySelectorAll('svg')) {
      const rect = svgEl.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue; // invisible / micro
      const cs = getComputedStyle(svgEl);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;

      const clone = svgEl.cloneNode(true);
      if (!clone.getAttribute('viewBox')) {
        clone.setAttribute('viewBox', '0 0 ' + Math.round(rect.width) + ' ' + Math.round(rect.height));
      }
      // Strip inline style so preview uses its own colours
      clone.removeAttribute('style');
      const content = clone.outerHTML;
      if (content.length > MAX_SVG_CONTENT) continue;

      const key = content.slice(0, 140); // dedup by first 140 chars
      if (svgSeen.has(key)) continue;
      svgSeen.add(key);

      const label = (svgEl.getAttribute('aria-label') ||
        svgEl.closest('[aria-label]')?.getAttribute('aria-label') ||
        svgEl.closest('a')?.textContent?.trim() ||
        svgEl.closest('button')?.textContent?.trim() || '').slice(0, 60);

      svgInventory.push({
        source: 'inline',
        content,
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        label
      });
      if (svgInventory.length >= 60) break;
    }

    // 2. <img src="*.svg"> — URL only, preview via <img> tag
    for (const imgEl of document.querySelectorAll('img')) {
      const src = imgEl.src || '';
      if (!src) continue;
      if (!src.split('?')[0].toLowerCase().endsWith('.svg')) continue;
      if (svgSeen.has(src)) continue;
      svgSeen.add(src);

      const rect = imgEl.getBoundingClientRect();
      svgInventory.push({
        source: 'img-url',
        src,
        w: Math.round(imgEl.naturalWidth || rect.width),
        h: Math.round(imgEl.naturalHeight || rect.height),
        label: (imgEl.alt || '').slice(0, 60)
      });
      if (svgInventory.length >= 60) break;
    }

    // ── Layout System Detection ──

    // Helper: count top-level space-separated tokens in a CSS value string,
    // respecting parentheses (so minmax(200px, 1fr) counts as one token).
    function countCssTokens(val) {
      if (!val || val === 'none') return 0;
      let depth = 0, count = 0, inToken = false;
      for (const ch of val) {
        if (ch === '(') { depth++; inToken = true; }
        else if (ch === ')') { depth--; inToken = true; }
        else if (ch === ' ' && depth === 0) { if (inToken) { count++; inToken = false; } }
        else { inToken = true; }
      }
      if (inToken) count++;
      return count;
    }

    // Helper: find the best-fit spacing base unit (4, 5, 6, 8, 10…)
    function detectSpacingBase(spacingObj) {
      const vals = Object.keys(spacingObj)
        .map(v => Math.round(parseFloat(v)))
        .filter(v => v > 0 && v <= 80);
      if (vals.length < 4) return null;
      const candidates = [4, 5, 6, 8, 10, 12];
      let bestBase = null, bestScore = 0;
      for (const base of candidates) {
        const score = vals.filter(v => v % base === 0).length / vals.length;
        if (score > bestScore) { bestScore = score; bestBase = base; }
      }
      return bestScore >= 0.55 ? bestBase : null;
    }

    // Scan layout containers
    let flexCount = 0, gridCount = 0, blockCount = 0;
    const gapMap = {};
    const maxWidthMap = {};
    const colPatternMap = {};
    const layoutEls = document.querySelectorAll(
      'div, section, article, main, header, footer, nav, aside, ul, ol, form'
    );

    for (const el of layoutEls) {
      const cs = getComputedStyle(el);
      const disp = cs.display;

      if (disp === 'flex' || disp === 'inline-flex') {
        flexCount++;

        // Detect equal-width flex column layouts
        if (cs.flexWrap !== 'nowrap') {
          const kids = Array.from(el.children).filter(c => {
            const kcs = getComputedStyle(c);
            return kcs.display !== 'none' && c.offsetWidth > 0;
          });
          if (kids.length >= 2 && kids.length <= 8) {
            const pw = el.offsetWidth;
            if (pw >= 300) {
              const widths = kids.map(k => k.offsetWidth);
              const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
              const maxDev = Math.max(...widths.map(w => Math.abs(w - avg)));
              if (avg > 0 && maxDev < avg * 0.2) {
                const key = kids.length + '-col';
                colPatternMap[key] = (colPatternMap[key] || 0) + 1;
              }
            }
          }
        }
      } else if (disp === 'grid' || disp === 'inline-grid') {
        gridCount++;

        // Detect column count from gridTemplateColumns
        const gtc = cs.gridTemplateColumns;
        if (gtc && gtc !== 'none') {
          // Try explicit repeat() first
          const repeatMatch = gtc.match(/repeat\(\s*(\d+)/);
          const colCount = repeatMatch ? parseInt(repeatMatch[1]) : countCssTokens(gtc);
          if (colCount >= 2 && colCount <= 12) {
            const key = colCount + '-col';
            colPatternMap[key] = (colPatternMap[key] || 0) + 1;
          }
        }
      } else if (disp === 'block') {
        blockCount++;
      }

      // Gap values (flex and grid)
      if (disp === 'flex' || disp === 'inline-flex' || disp === 'grid' || disp === 'inline-grid') {
        const gap = cs.gap;
        const colGap = cs.columnGap;
        const rowGap = cs.rowGap;
        const gapVal = (gap && gap !== 'normal' && gap !== '0px') ? gap
          : (colGap && colGap !== 'normal' && colGap !== '0px') ? colGap : null;
        if (gapVal) gapMap[gapVal] = (gapMap[gapVal] || 0) + 1;
        if (rowGap && rowGap !== 'normal' && rowGap !== '0px' && rowGap !== colGap) {
          gapMap[rowGap] = (gapMap[rowGap] || 0) + 1;
        }
      }

      // Container max-widths (meaningful range only)
      const mw = cs.maxWidth;
      if (mw && mw !== 'none') {
        const px = parseFloat(mw);
        if (px >= 600 && px <= 2560) {
          const rounded = Math.round(px / 20) * 20; // group ±10px together
          maxWidthMap[rounded] = (maxWidthMap[rounded] || 0) + 1;
        }
      }
    }

    // ── Stylesheet scan: CSS Custom Properties + Breakpoints + Focus States ──
    const cssVarDefs   = {};   // name → value (definition only)
    const bpMin        = {};   // px → count
    const bpMax        = {};   // px → count
    const focusRulesList = [];
    let hasFocusVisible      = false;
    let outlineRemovedNoFV   = 0;
    let prefersColorScheme   = false;
    let prefersReducedMotion = false;
    let mediaRuleTotal       = 0;

    function scanSheetRules(rules) {
      for (const rule of rules || []) {
        if (rule.type === 1) { // CSSStyleRule
          const sel = rule.selectorText || '';
          // CSS custom properties
          const st = rule.style;
          for (let i = 0; i < st.length; i++) {
            const prop = st[i];
            if (prop.startsWith('--') && !cssVarDefs[prop]) {
              cssVarDefs[prop] = st.getPropertyValue(prop).trim().slice(0, 80);
            }
          }
          // Focus rules
          if (sel.includes(':focus')) {
            const outlineVal = (rule.style.outline || '').trim();
            const isOutlineOff = outlineVal === 'none' || outlineVal === '0' || outlineVal === '0px';
            if (sel.includes(':focus-visible')) hasFocusVisible = true;
            if (isOutlineOff && !sel.includes(':focus-visible')) outlineRemovedNoFV++;
            if (focusRulesList.length < 12) {
              focusRulesList.push({
                selector: sel.slice(0, 80),
                outline: outlineVal,
                boxShadow: (rule.style.boxShadow || '').slice(0, 60),
                outlineOffset: rule.style.outlineOffset || ''
              });
            }
          }
        } else if (rule.type === 4) { // CSSMediaRule
          mediaRuleTotal++;
          const text = rule.conditionText || rule.media?.mediaText || '';
          if (text.includes('prefers-color-scheme'))    prefersColorScheme   = true;
          if (text.includes('prefers-reduced-motion')) prefersReducedMotion = true;
          const minM = text.match(/min-width:\s*(\d+(?:\.\d+)?)px/);
          const maxM = text.match(/max-width:\s*(\d+(?:\.\d+)?)px/);
          if (minM) { const v = Math.round(parseFloat(minM[1])); bpMin[v] = (bpMin[v] || 0) + 1; }
          if (maxM) { const v = Math.round(parseFloat(maxM[1])); bpMax[v] = (bpMax[v] || 0) + 1; }
          try { scanSheetRules(rule.cssRules); } catch(_) {}
        } else if (rule.type === 12) { // CSSSupportsRule
          try { scanSheetRules(rule.cssRules); } catch(_) {}
        }
      }
    }
    for (const sheet of document.styleSheets) {
      try { scanSheetRules(sheet.cssRules); } catch(_) { /* cross-origin — skip */ }
    }

    // Assemble the 6 new inventory objects
    const cssTokens = {
      variables: Object.entries(cssVarDefs)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 80),
      total: Object.keys(cssVarDefs).length,
    };

    const breakpoints = {
      minWidth: Object.entries(bpMin).map(([v, c]) => ({ value: parseInt(v), count: c })).sort((a, b) => a.value - b.value),
      maxWidth: Object.entries(bpMax).map(([v, c]) => ({ value: parseInt(v), count: c })).sort((a, b) => a.value - b.value),
      prefersColorScheme,
      prefersReducedMotion,
      totalMediaRules: mediaRuleTotal,
    };

    const focusStates = {
      hasFocusVisible,
      outlineRemovedWithoutReplacement: outlineRemovedNoFV,
      rules: focusRulesList,
    };

    const zIndexAudit = {
      values: Object.entries(zIndexMap)
        .map(([v, c]) => ({ value: parseInt(v), count: c }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 15),
      uniqueCount: Object.keys(zIndexMap).length,
      maxValue: Object.keys(zIndexMap).reduce((m, v) => Math.max(m, parseInt(v)), -Infinity),
    };

    const motion = {
      transitions: Object.entries(transitionMap)
        .map(([key, count]) => { const [duration, easing] = key.split('|'); return { duration, easing, count }; })
        .sort((a, b) => b.count - a.count).slice(0, 10),
      animations: Object.entries(animationMap)
        .map(([name, { duration, count }]) => ({ name: name.slice(0, 50), duration, count }))
        .sort((a, b) => b.count - a.count).slice(0, 10),
      reducedMotionRespected: prefersReducedMotion,
    };

    const layoutTotal = flexCount + gridCount + blockCount || 1;
    const spacingBase = detectSpacingBase(spacings);

    const layoutSystem = {
      spacingBase,
      layoutEngines: {
        flex:  Math.round((flexCount  / layoutTotal) * 100),
        grid:  Math.round((gridCount  / layoutTotal) * 100),
        block: Math.round((blockCount / layoutTotal) * 100),
      },
      columnPatterns: Object.entries(colPatternMap)
        .map(([pattern, count]) => ({ pattern, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
      gapValues: Object.entries(gapMap)
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      containerWidths: Object.entries(maxWidthMap)
        .map(([value, count]) => ({ value: parseInt(value), count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };

    return {
      logo,
      svgInventory,
      colorPalette: toSorted(colors).slice(0, 30),
      fontFamilies: toSorted(fonts),
      fontSizes: toSorted(fontSizes),
      fontFaceRules,
      googleFontLinks,
      lineHeights: toSorted(lineHeights).slice(0, 10),
      letterSpacings: toSorted(letterSpacings).slice(0, 8),
      typography: Object.values(typoCombos).sort((a, b) => b.count - a.count).slice(0, 20),
      spacingValues: toSorted(spacings),
      spacingGridRatio: totalSpacing > 0 ? Math.round((onGrid / totalSpacing) * 100) : 0,
      borderRadii: toSorted(radii),
      shadows: toSorted(shadows),
      gradients: toSorted(gradients).slice(0, 10),
      textAlignments: toSorted(aligns),
      imageFormats,
      hasLazyLoading,
      uiFramework,
      iconLibrary,
      layoutSystem,
      cssTokens,
      breakpoints,
      focusStates,
      zIndexAudit,
      motion,
      contrastPairs,
      techStack,
    };
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
      apiResponses: {},
      designInventory: await captureDesignInventory()
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

    if (message.action === 'SCROLL_TO') {
      // Force instant scroll — override any smooth scrolling on the page
      document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
      window.scrollTo({ top: message.y, behavior: 'instant' });
      // Small delay for repaint
      setTimeout(() => {
        sendResponse({ success: true, scrollY: window.scrollY });
      }, 50);
      return true;
    }

    if (message.action === 'GET_SCROLL_INFO') {
      sendResponse({
        success: true,
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        devicePixelRatio: window.devicePixelRatio || 1
      });
      return true;
    }

    if (message.action === 'PREPARE_FOR_CAPTURE') {
      // 1. Freeze all CSS animations and transitions so nothing is mid-state
      //    between strip captures (scroll-reveal animations, hover effects, etc.)
      // 2. Force background-attachment:scroll so parallax/fixed backgrounds
      //    move with the page and align correctly in every strip.
      const style = document.createElement('style');
      style.id = '__echoflow-freeze';
      style.textContent = `
        *, *::before, *::after {
          animation-duration: 0.001s !important;
          animation-delay: 0s !important;
          transition-duration: 0.001s !important;
          transition-delay: 0s !important;
        }
        * { background-attachment: scroll !important; }
      `;
      document.head.appendChild(style);

      // 3. Promote lazy images to eager so lower strips have loaded content.
      //    Also works for native loading="lazy" images.
      document.querySelectorAll('img[loading="lazy"]').forEach(img => {
        img.loading = 'eager';
      });

      sendResponse({ success: true });
      return true;
    }

    if (message.action === 'RESTORE_AFTER_CAPTURE') {
      const style = document.getElementById('__echoflow-freeze');
      if (style) style.remove();
      sendResponse({ success: true });
      return true;
    }

    if (message.action === 'HIDE_FIXED_ELEMENTS') {
      // Hide sticky/fixed elements (headers, navs, chat widgets) to avoid duplication in stitched screenshots.
      // We save original inline styles and forcibly override with display:none.
      // A double requestAnimationFrame ensures the browser has fully painted before we respond,
      // so captureVisibleTab sees the hidden state and not a stale frame.
      const hidden = [];
      for (const el of document.querySelectorAll('*')) {
        const pos = getComputedStyle(el).position;
        if ((pos === 'fixed' || pos === 'sticky') && el.tagName !== 'HTML' && el.tagName !== 'BODY') {
          hidden.push({ el, display: el.style.display, visibility: el.style.visibility });
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('visibility', 'hidden', 'important');
        }
      }
      window.__echoflowHiddenFixed = hidden;
      // Force layout recalculation synchronously, then wait two rAF cycles
      // so the compositor has flushed the new frame before we respond.
      void document.body.getBoundingClientRect();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        sendResponse({ success: true, count: hidden.length });
      }));
      return true; // keep channel open for async response
    }

    if (message.action === 'RESTORE_FIXED_ELEMENTS') {
      const hidden = window.__echoflowHiddenFixed || [];
      for (const item of hidden) {
        item.el.style.display = item.display;
        item.el.style.visibility = item.visibility;
      }
      window.__echoflowHiddenFixed = [];
      sendResponse({ success: true });
      return true;
    }

    // Standalone design inventory scan — used by sidebar Live Scan
    if (message.action === 'CAPTURE_DESIGN_INVENTORY') {
      captureDesignInventory()
        .then(inv => sendResponse({ success: true, inventory: inv }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });
})();
