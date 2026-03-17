// EchoFlow Rule Evaluation Engine
// Evaluates knowledge base rules against captured DOM data to produce findings.

// ── Color Utilities ──

function parseRGB(colorStr) {
  if (!colorStr) return null;
  const match = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return null;
  return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
}

function relativeLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastRatio(fg, bg) {
  const fgRGB = parseRGB(fg);
  const bgRGB = parseRGB(bg);
  if (!fgRGB || !bgRGB) return null;
  const l1 = relativeLuminance(fgRGB.r, fgRGB.g, fgRGB.b);
  const l2 = relativeLuminance(bgRGB.r, bgRGB.g, bgRGB.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parsePx(value) {
  if (!value) return null;
  const match = value.match(/([\d.]+)px/);
  return match ? parseFloat(match[1]) : null;
}

// ── Element Matching ──

function findMatchingElements(data, selectors) {
  if (!selectors || !selectors.length) return [];
  const results = [];
  for (const el of data.elements) {
    for (const sel of selectors) {
      // Check matchedSelectors (pre-computed in content.js)
      if (el.matchedSelectors && el.matchedSelectors.includes(sel)) {
        results.push(el);
        break;
      }
      // Fallback: check individual parts of comma-separated selectors
      const parts = sel.split(',').map(s => s.trim());
      for (const part of parts) {
        if (el.matchedSelectors && el.matchedSelectors.includes(part)) {
          results.push(el);
          break;
        }
      }
    }
  }
  return results;
}

function findFirstMatchPosition(data, selectors) {
  const matched = findMatchingElements(data, selectors);
  if (matched.length > 0) {
    const b = matched[0].bounds;
    return { x: b.absoluteLeft || b.left, y: b.absoluteTop || b.top, width: b.width, height: b.height };
  }
  return { x: 0, y: 0, width: 100, height: 30 };
}

// ── Check Type Evaluators ──

function checkElementExists(check, data) {
  const matched = findMatchingElements(data, check.selectors);

  if (check.condition === 'count_gt') {
    if (matched.length > (check.threshold || 1)) {
      return matched.map(el => ({
        position: { x: el.bounds.absoluteLeft || el.bounds.left, y: el.bounds.absoluteTop || el.bounds.top, width: el.bounds.width, height: el.bounds.height },
        selector: el.selector
      }));
    }
    return [];
  }

  // Default: finding fires if element exists
  if (matched.length > 0) {
    return matched.map(el => ({
      position: { x: el.bounds.absoluteLeft || el.bounds.left, y: el.bounds.absoluteTop || el.bounds.top, width: el.bounds.width, height: el.bounds.height },
      selector: el.selector
    }));
  }
  return [];
}

function checkElementMissing(check, data) {
  const matched = findMatchingElements(data, check.selectors);
  if (matched.length === 0) {
    // Element is missing — finding fires. Position at fallback.
    const fallbackPos = check.target_selector
      ? findFirstMatchPosition(data, [check.target_selector])
      : { x: 0, y: 0, width: 100, height: 30 };
    return [{ position: fallbackPos, selector: null }];
  }
  return [];
}

function checkElementPosition(check, data) {
  const matched = findMatchingElements(data, check.selectors);
  const results = [];
  for (const el of matched) {
    const bounds = el.bounds;
    let fires = false;
    if (check.condition === 'below_fold') {
      fires = bounds.top >= data.viewport.height;
    } else if (check.condition === 'above_fold') {
      fires = bounds.top < data.viewport.height;
    }
    if (fires) {
      results.push({
        position: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height },
        selector: el.selector
      });
    }
  }
  return results;
}

function checkComputedStyle(check, data) {
  const matched = findMatchingElements(data, check.selectors);
  const results = [];

  for (const el of matched) {
    const styles = el.computedStyles;
    if (!styles) continue;
    let fires = false;

    if (check.property === 'minDimension') {
      const w = parsePx(styles.width);
      const h = parsePx(styles.height);
      // Also use bounds for more accurate size
      const bw = el.bounds.width;
      const bh = el.bounds.height;
      const minW = Math.min(w || bw, bw);
      const minH = Math.min(h || bh, bh);
      if (check.condition === 'lt' && (minW < check.threshold || minH < check.threshold)) {
        fires = true;
      }
    } else if (check.property === 'fontSize') {
      const size = parsePx(styles.fontSize);
      if (check.condition === 'lt' && size !== null && size < check.threshold) {
        fires = true;
      }
    } else if (check.property === 'position') {
      if (check.condition === 'not_sticky') {
        fires = styles.position !== 'sticky' && styles.position !== 'fixed';
      }
    } else if (check.property === 'overflowX') {
      if (check.condition === 'has_overflow' && data.scrollWidth > data.viewport.width + 5) {
        fires = true;
      }
    } else if (check.property === 'textDecoration') {
      if (check.condition === 'link_not_distinguishable') {
        const hasUnderline = styles.textDecoration && styles.textDecoration.includes('underline');
        // Check if link color is same as parent text
        const bodyColor = data.elements.find(e => e.tagName === 'body')?.computedStyles?.color;
        const linkColor = styles.color;
        const sameColor = bodyColor === linkColor;
        if (!hasUnderline && sameColor) {
          fires = true;
        }
      }
    } else if (check.property === 'fontVariantNumeric') {
      if (check.condition === 'not_tabular') {
        fires = !styles.fontVariantNumeric || !styles.fontVariantNumeric.includes('tabular');
      }
    } else if (check.property === 'outlineStyle') {
      if (check.condition === 'focus_not_visible') {
        fires = styles.outlineStyle === 'none' && (!styles.boxShadow || styles.boxShadow === 'none');
      }
    } else if (check.property === 'colorOnlyIndicator') {
      // Check if element uses color only without icon/text indicator
      // Heuristic: has background-color set but no ::before/::after content
      fires = false; // Difficult to check purely from computed styles — flag for AI review
    } else if (check.property === 'textOverflow') {
      if (check.condition === 'address_too_long') {
        // Check if the element text looks like a long address (40+ chars, hex-like)
        const text = el.text || '';
        if (text.length > 40 && /^0x[a-fA-F0-9]+$/.test(text.trim())) {
          fires = true;
        }
      }
    } else {
      // Generic property comparison
      const val = parsePx(styles[check.property]);
      if (val !== null) {
        if (check.condition === 'lt' && val < check.threshold) fires = true;
        if (check.condition === 'gt' && val > check.threshold) fires = true;
      }
    }

    if (fires) {
      results.push({
        position: { x: el.bounds.absoluteLeft || el.bounds.left, y: el.bounds.absoluteTop || el.bounds.top, width: el.bounds.width, height: el.bounds.height },
        selector: el.selector
      });
    }
  }

  // For sticky header check, only fire once (not per-element) and only if ALL header elements fail
  if (check.property === 'position' && check.condition === 'not_sticky') {
    if (matched.length > 0 && results.length === matched.length) {
      return [results[0]]; // All headers non-sticky — report once
    }
    return []; // At least one header is sticky — no finding
  }

  return results;
}

function checkContrastRatio(check, data) {
  const matched = findMatchingElements(data, check.selectors);
  const results = [];

  for (const el of matched) {
    const styles = el.computedStyles;
    if (!styles) continue;

    const fg = styles.color;
    const bg = styles.resolvedBackgroundColor || styles.backgroundColor;
    const ratio = getContrastRatio(fg, bg);

    if (ratio !== null && ratio < check.threshold) {
      results.push({
        position: { x: el.bounds.absoluteLeft || el.bounds.left, y: el.bounds.absoluteTop || el.bounds.top, width: el.bounds.width, height: el.bounds.height },
        selector: el.selector,
        detail: 'Contrast ratio: ' + ratio.toFixed(2) + ':1 (required: ' + check.threshold + ':1)'
      });
    }
  }

  // Limit to first 5 contrast failures to avoid noise
  return results.slice(0, 5);
}

function checkAttributeCheck(check, data) {
  const matched = findMatchingElements(data, check.selectors);
  const results = [];

  for (const el of matched) {
    let fires = false;

    if (check.condition === 'missing') {
      fires = !(check.attribute in (el.attributes || {}));
    } else if (check.condition === 'missing_label') {
      // For form inputs: check if has label, aria-label, or aria-labelledby
      // content.js captures forms separately, but we also check elements
      const hasLabel = el.attributes['aria-label'] || el.attributes['aria-labelledby'];
      const hasId = el.attributes.id;
      let hasAssociatedLabel = false;
      if (hasId) {
        hasAssociatedLabel = data.elements.some(
          e => e.tagName === 'label' && e.attributes['for'] === el.attributes.id
        );
      }
      fires = !hasLabel && !hasAssociatedLabel;
    } else if (check.condition === 'equals') {
      fires = (el.attributes || {})[check.attribute] === check.value;
    }

    if (fires) {
      results.push({
        position: { x: el.bounds.absoluteLeft || el.bounds.left, y: el.bounds.absoluteTop || el.bounds.top, width: el.bounds.width, height: el.bounds.height },
        selector: el.selector
      });
    }
  }

  // Limit per-rule to avoid flooding
  return results.slice(0, 10);
}

function checkHeadingHierarchy(check, data) {
  if (!data.headings || data.headings.length < 2) return [];

  const levels = data.headings.map(h => h.level);
  const results = [];

  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) {
      // Skip detected: e.g. h1 → h3
      results.push({
        position: {
          x: data.headings[i].bounds.left,
          y: data.headings[i].bounds.top,
          width: data.headings[i].bounds.width,
          height: data.headings[i].bounds.height
        },
        selector: data.headings[i].selector,
        detail: 'Jumps from h' + levels[i - 1] + ' to h' + levels[i]
      });
    }
  }

  return results;
}

function checkScriptDetection(check, data) {
  const scripts = data.scripts || [];

  if (check.condition === 'none_found') {
    const found = check.sources.some(source =>
      scripts.some(src => src.toLowerCase().includes(source.toLowerCase()))
    );
    if (!found) {
      return [{ position: { x: 0, y: 0, width: 100, height: 30 }, selector: null }];
    }
    return [];
  }

  if (check.condition === 'count_gt') {
    if (scripts.length > (check.threshold || 0)) {
      return [{ position: { x: 0, y: 0, width: 100, height: 30 }, selector: null }];
    }
    return [];
  }

  return [];
}

function checkShopifyGlobal(check, data) {
  if (!data.shopify) return [];

  const pathParts = check.path.split('.');
  let value = data.shopify;
  for (const part of pathParts) {
    if (value == null) break;
    value = value[part];
  }

  if (check.condition === 'missing' && (value == null || value === '')) {
    return [{ position: { x: 0, y: 0, width: 100, height: 30 }, selector: null }];
  }

  return [];
}

function checkTextContent(check, data) {
  const matched = findMatchingElements(data, check.selectors);
  const results = [];

  // Common placeholder patterns
  const placeholderPatterns = [
    /lorem ipsum/i,
    /dolor sit amet/i,
    /placeholder/i,
    /\[insert/i,
    /\{.*text.*\}/i,
    /coming soon placeholder/i,
    /sample text/i,
    /your text here/i
  ];

  // Common grammar issues in buttons/CTAs
  const grammarIssues = [
    { pattern: /\s{2,}/, desc: 'double spaces' },
    { pattern: /^[a-z]/, desc: 'starts with lowercase (CTA/heading should be capitalised)' },
    { pattern: /\.{4,}/, desc: 'excessive dots' },
    { pattern: /[!?]{3,}/, desc: 'excessive punctuation' },
    { pattern: /\s[.,;:!?]/, desc: 'space before punctuation' }
  ];

  for (const el of matched) {
    const text = (el.text || '').trim();
    if (!text || text.length < 1) {
      if (check.condition === 'empty_text') {
        // Check if it also lacks aria-label
        if (!el.attributes?.['aria-label'] && !el.attributes?.['aria-labelledby']) {
          results.push({
            position: { x: el.bounds.absoluteLeft || el.bounds.left, y: el.bounds.absoluteTop || el.bounds.top, width: el.bounds.width, height: el.bounds.height },
            selector: el.selector,
            detail: 'Empty text content'
          });
        }
      }
      continue;
    }

    if (check.condition === 'placeholder_text') {
      for (const pat of placeholderPatterns) {
        if (pat.test(text)) {
          results.push({
            position: { x: el.bounds.absoluteLeft || el.bounds.left, y: el.bounds.absoluteTop || el.bounds.top, width: el.bounds.width, height: el.bounds.height },
            selector: el.selector,
            detail: 'Contains placeholder text: "' + text.substring(0, 40) + '..."'
          });
          break;
        }
      }
    }

    if (check.condition === 'grammar_check') {
      for (const issue of grammarIssues) {
        if (issue.pattern.test(text)) {
          results.push({
            position: { x: el.bounds.absoluteLeft || el.bounds.left, y: el.bounds.absoluteTop || el.bounds.top, width: el.bounds.width, height: el.bounds.height },
            selector: el.selector,
            detail: '"' + text.substring(0, 30) + '" — ' + issue.desc
          });
          break;
        }
      }
    }
  }

  return results.slice(0, 10);
}

function checkFocusVisible(check, data) {
  // This is handled as a computed_style check with condition 'focus_not_visible'
  // The actual focus visibility can only be partially checked via computed styles
  // We flag elements with outline:none and no box-shadow alternative
  const matched = findMatchingElements(data, check.selectors);
  const results = [];

  for (const el of matched) {
    const styles = el.computedStyles;
    if (!styles) continue;
    if (styles.outlineStyle === 'none' && !styles.boxShadow) {
      results.push({
        position: { x: el.bounds.absoluteLeft || el.bounds.left, y: el.bounds.absoluteTop || el.bounds.top, width: el.bounds.width, height: el.bounds.height },
        selector: el.selector
      });
    }
  }

  return results.slice(0, 5);
}

function checkApiEndpoint(check, data) {
  const response = data.apiResponses?.[check.endpoint];

  if (check.condition === 'unavailable') {
    if (!response || response.error) {
      return [{ position: { x: 0, y: 0, width: 100, height: 30 }, selector: null }];
    }
  }

  return [];
}

// ── Main Evaluation Function ──

export function evaluateRules(rules, capturedData) {
  const findings = [];
  let number = 1;

  for (const rule of rules) {
    let results = [];

    switch (rule.check.type) {
      case 'element_exists':
        results = checkElementExists(rule.check, capturedData);
        break;
      case 'element_missing':
        results = checkElementMissing(rule.check, capturedData);
        break;
      case 'element_position':
        results = checkElementPosition(rule.check, capturedData);
        break;
      case 'computed_style':
        results = checkComputedStyle(rule.check, capturedData);
        break;
      case 'contrast_ratio':
        results = checkContrastRatio(rule.check, capturedData);
        break;
      case 'attribute_check':
        results = checkAttributeCheck(rule.check, capturedData);
        break;
      case 'heading_hierarchy':
        results = checkHeadingHierarchy(rule.check, capturedData);
        break;
      case 'script_detection':
        results = checkScriptDetection(rule.check, capturedData);
        break;
      case 'shopify_global':
        results = checkShopifyGlobal(rule.check, capturedData);
        break;
      case 'api_endpoint':
        results = checkApiEndpoint(rule.check, capturedData);
        break;
      case 'text_content':
        results = checkTextContent(rule.check, capturedData);
        break;
    }

    // Create a finding for each result (some rules produce multiple)
    // Group similar results into one finding per rule to reduce noise
    if (results.length > 0) {
      // Use the first result's position as the marker position
      const primary = results[0];
      findings.push({
        id: rule.id,
        number: number++,
        description: primary.detail
          ? rule.finding + ' — ' + primary.detail
          : rule.finding,
        category: rule.category,
        position: primary.position,
        ice: { ...rule.ice },
        selector: primary.selector,
        ruleId: rule.id,
        matchCount: results.length
      });
    }
  }

  return findings;
}

export function extractSelectors(rules) {
  const selectors = new Set();
  for (const rule of rules) {
    if (rule.check.selectors) {
      rule.check.selectors.forEach(s => selectors.add(s));
    }
    if (rule.target_selector) {
      selectors.add(rule.target_selector);
    }
  }
  return Array.from(selectors);
}
