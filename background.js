// EchoFlow Background Service Worker
// Orchestrates audit flow: content injection, API fetches, rule evaluation.

import { evaluateRules, extractSelectors } from './engine.js';
import {
  createProject, getProject, listProjects, deleteProject,
  saveAudit, getAuditsForProject
} from './storage.js';

// ── Rule Loading ──

async function loadRules(vertical) {
  const key = 'rules_' + vertical;
  const stored = await chrome.storage.local.get(key);
  if (stored[key]) return stored[key];

  // Fallback to bundled rules
  const response = await fetch(chrome.runtime.getURL('knowledge-base/' + vertical + '.json'));
  return response.json();
}

// ── API Fetching ──

async function fetchApiEndpoints(origin, rules) {
  const apiRules = rules.filter(r => r.check.type === 'api_endpoint');
  const responses = {};

  for (const rule of apiRules) {
    const endpoint = rule.check.endpoint;
    try {
      const resp = await fetch(origin + endpoint);
      if (!resp.ok) {
        responses[endpoint] = { error: 'HTTP ' + resp.status };
      } else {
        const data = await resp.json();
        responses[endpoint] = data;
      }
    } catch (e) {
      responses[endpoint] = { error: e.message };
    }
  }

  return responses;
}

// ── Screenshot Capture (local display only — never sent to AI) ──

async function captureViewport(tabId, resolution) {
  const scale = resolution === '120' ? 1.2 : 1.0;

  // Hide scrollbar before capture
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      document.documentElement.style.setProperty('overflow', 'hidden', 'important');
      document.body.style.setProperty('overflow', 'hidden', 'important');
    }
  });
  await sleep(100);

  let dataUrl;

  if (scale !== 1.0) {
    const originalZoom = await chrome.tabs.getZoom(tabId);
    await chrome.tabs.setZoom(tabId, scale);
    await sleep(400);
    dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'jpeg',
      quality: 95
    });
    await chrome.tabs.setZoom(tabId, originalZoom);
  } else {
    dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'jpeg',
      quality: 90
    });
  }

  // Restore scrollbar
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      document.documentElement.style.removeProperty('overflow');
      document.body.style.removeProperty('overflow');
    }
  });

  return dataUrl;
}

async function captureFullPage(tabId) {
  // Get page dimensions
  const scrollInfo = await chrome.tabs.sendMessage(tabId, { action: 'GET_SCROLL_INFO' });
  if (!scrollInfo?.success) {
    throw new Error('Could not get scroll info');
  }

  const { scrollHeight, viewportHeight, viewportWidth, devicePixelRatio } = scrollInfo;
  const dpr = devicePixelRatio || 1;
  const originalScrollY = scrollInfo.scrollY;

  // Cap at reasonable height to avoid memory issues (max ~15000px)
  const totalHeight = Math.min(scrollHeight, 15000);
  const maxScrollY = totalHeight - viewportHeight;

  // Disable smooth scrolling and hide scrollbar (but keep scroll functional)
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
      const style = document.createElement('style');
      style.id = '__echoflow-hide-scrollbar';
      style.textContent = `
        html::-webkit-scrollbar { display: none !important; }
        html { scrollbar-width: none !important; -ms-overflow-style: none !important; }
      `;
      document.head.appendChild(style);
    }
  });

  // Capture first viewport (keep fixed/sticky elements visible for first strip)
  await chrome.tabs.sendMessage(tabId, { action: 'SCROLL_TO', y: 0 });
  await sleep(400);
  const firstStrip = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 90 });
  await sleep(600); // Rate limit: max ~2 captureVisibleTab calls/sec

  // Each strip tracks: actual scroll position, how much to crop from top, and output Y
  const strips = [{
    dataUrl: firstStrip,
    srcY: 0,               // crop from top of captured image
    srcHeight: viewportHeight, // how much of captured image to use
    destY: 0               // where to place it on the final canvas
  }];

  let coveredUpTo = viewportHeight; // we've captured content from 0 to viewportHeight

  // Hide fixed/sticky elements for remaining strips to avoid duplication
  if (totalHeight > viewportHeight) {
    await chrome.tabs.sendMessage(tabId, { action: 'HIDE_FIXED_ELEMENTS' });
    await sleep(100);
  }

  // Capture remaining strips — scroll in viewport-sized steps
  let targetY = viewportHeight;
  while (coveredUpTo < totalHeight) {
    const scrollResult = await chrome.tabs.sendMessage(tabId, { action: 'SCROLL_TO', y: targetY });
    await sleep(400);

    // The browser clamps scrollY to the maximum scrollable position
    const actualScrollY = scrollResult.scrollY;

    // This capture shows content from actualScrollY to actualScrollY + viewportHeight
    const captureTop = actualScrollY;
    const captureBottom = actualScrollY + viewportHeight;

    // How much of this capture overlaps with what we already have?
    const overlap = Math.max(0, coveredUpTo - captureTop);

    // Only use the non-overlapping portion
    const usableHeight = Math.min(viewportHeight - overlap, totalHeight - coveredUpTo);

    if (usableHeight <= 0) break;

    const stripDataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 90 });
    await sleep(600); // Rate limit: max ~2 captureVisibleTab calls/sec

    strips.push({
      dataUrl: stripDataUrl,
      srcY: overlap,          // skip overlapping pixels from top of capture
      srcHeight: usableHeight, // only use this many pixels
      destY: coveredUpTo       // place at the bottom edge of what we've covered
    });

    coveredUpTo += usableHeight;
    targetY += viewportHeight;

    // Safety: if we've reached max scroll and captured everything, stop
    if (actualScrollY >= maxScrollY) break;
  }

  // Restore fixed elements and scroll position
  if (totalHeight > viewportHeight) {
    await chrome.tabs.sendMessage(tabId, { action: 'RESTORE_FIXED_ELEMENTS' });
  }

  // Restore scrollbar and scroll-behavior
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      document.documentElement.style.removeProperty('scroll-behavior');
      const style = document.getElementById('__echoflow-hide-scrollbar');
      if (style) style.remove();
    }
  });

  // Restore original scroll position
  await chrome.tabs.sendMessage(tabId, { action: 'SCROLL_TO', y: originalScrollY });

  // If only one strip, return it directly (no stitching needed)
  if (strips.length === 1) {
    return firstStrip;
  }

  // Stitch via offscreen document
  await ensureOffscreenDocument();
  const stitchResult = await chrome.runtime.sendMessage({
    action: 'STITCH_SCREENSHOTS',
    strips: strips,
    totalWidth: viewportWidth,
    totalHeight: coveredUpTo,
    devicePixelRatio: dpr
  });

  if (!stitchResult?.success) {
    throw new Error(stitchResult?.error || 'Screenshot stitching failed');
  }

  return stitchResult.dataUrl;
}

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Stitch full-page screenshot strips on canvas'
  });
}

async function captureScreenshot(tabId, resolution, mode) {
  if (mode === 'full_page') {
    return captureFullPage(tabId);
  }
  return captureViewport(tabId, resolution);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Content Script Injection ──

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  });
}

async function injectShopifyMainWorld(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    files: ['shopify-main-world.js']
  });
}

// ── Main Audit Orchestration ──

async function runAudit(tabId, tabUrl, vertical, mode, resolution, pageType) {
  const origin = new URL(tabUrl).origin;

  // Step 1: Load rules
  const rules = await loadRules(vertical);
  const selectors = extractSelectors(rules);

  // Step 2: Inject content script
  await injectContentScript(tabId);
  await sleep(200);

  // Step 3: Handle region picker mode
  let regionBounds = null;
  if (mode === 'region') {
    const regionResult = await chrome.tabs.sendMessage(tabId, { action: 'PICK_REGION' });
    if (!regionResult?.success || !regionResult.region) {
      return { success: false, error: 'Region selection cancelled' };
    }
    regionBounds = regionResult.region;
  }

  // Step 4: Inject Shopify MAIN world script if needed
  const isShopify = vertical === 'shopify';
  if (isShopify) {
    await injectShopifyMainWorld(tabId);
    await sleep(200);
  }

  // Step 5: Capture DOM data
  const captureResult = await chrome.tabs.sendMessage(tabId, {
    action: 'CAPTURE_DOM',
    vertical: vertical,
    selectors: selectors,
    waitForShopify: isShopify
  });

  if (!captureResult?.success) {
    return { success: false, error: captureResult?.error || 'DOM capture failed' };
  }

  const domData = captureResult.data;

  // Step 6: Fetch API endpoints if rules need them
  domData.apiResponses = await fetchApiEndpoints(origin, rules);

  // Step 7: Capture screenshot (local proof only — never sent to AI)
  const screenshot = await captureScreenshot(tabId, resolution, mode);

  // Step 8: Evaluate rules
  const findings = evaluateRules(rules, domData);

  // Step 9: Assemble results
  const results = {
    version: '1.0',
    meta: {
      url: domData.url,
      title: domData.title,
      vertical: vertical,
      pageType: pageType || null,
      device: domData.viewport.width <= 480 ? 'mobile' : domData.viewport.width <= 1024 ? 'tablet' : 'desktop',
      captureMode: mode,
      timestamp: Date.now(),
      viewport: domData.viewport,
      scrollHeight: domData.scrollHeight
    },
    shopify: domData.shopify,
    sections: domData.sections,
    catalog: domData.apiResponses,
    screenshot: screenshot,
    findings: findings,
    regionBounds: regionBounds,
    rawData: {
      scripts: domData.scripts,
      metaTags: domData.metaTags,
      headings: domData.headings,
      forms: domData.forms,
      imageCount: domData.images?.length || 0,
      linkCount: domData.links?.length || 0,
      elementCount: domData.elements?.length || 0
    },
    designInventory: domData.designInventory || null
  };

  // Step 10: Store results and open results page
  await chrome.storage.local.set({ echoflowResults: results });
  await chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });

  return { success: true, findingCount: findings.length, results };
}

// ── Message Handler ──

// ── Silent Audit (for batch — doesn't open results page) ──

async function runAuditSilent(tabId, tabUrl, vertical, mode, resolution, pageType) {
  const origin = new URL(tabUrl).origin;
  const rules = await loadRules(vertical);
  const selectors = extractSelectors(rules);

  await injectContentScript(tabId);
  await sleep(200);

  const isShopify = vertical === 'shopify';
  if (isShopify) {
    await injectShopifyMainWorld(tabId);
    await sleep(200);
  }

  const captureResult = await chrome.tabs.sendMessage(tabId, {
    action: 'CAPTURE_DOM',
    vertical: vertical,
    selectors: selectors,
    waitForShopify: isShopify
  });

  if (!captureResult?.success) {
    return { success: false, error: captureResult?.error || 'DOM capture failed' };
  }

  const domData = captureResult.data;
  domData.apiResponses = await fetchApiEndpoints(origin, rules);

  const screenshot = await captureScreenshot(tabId, resolution, mode);
  const findings = evaluateRules(rules, domData);

  const results = {
    version: '1.0',
    meta: {
      url: domData.url,
      title: domData.title,
      vertical: vertical,
      pageType: pageType || null,
      device: domData.viewport.width <= 480 ? 'mobile' : domData.viewport.width <= 1024 ? 'tablet' : 'desktop',
      captureMode: mode,
      timestamp: Date.now(),
      viewport: domData.viewport,
      scrollHeight: domData.scrollHeight
    },
    shopify: domData.shopify,
    sections: domData.sections,
    catalog: domData.apiResponses,
    screenshot: screenshot,
    findings: findings,
    regionBounds: null,
    rawData: {
      scripts: domData.scripts,
      metaTags: domData.metaTags,
      headings: domData.headings,
      forms: domData.forms,
      imageCount: domData.images?.length || 0,
      linkCount: domData.links?.length || 0,
      elementCount: domData.elements?.length || 0
    },
    designInventory: domData.designInventory || null
  };

  return { success: true, findingCount: findings.length, results };
}

// ── Shopify Adapt ──

async function runShopifyAdapt(tabId, tabUrl) {
  // Inject the shopify-adapt content script
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['shopify-adapt.js']
  });
  await sleep(300);

  // Run analysis
  const adaptResult = await chrome.tabs.sendMessage(tabId, { action: 'SHOPIFY_ADAPT_ANALYZE' });

  if (!adaptResult?.success) {
    return { success: false, error: adaptResult?.error || 'Shopify Adapt analysis failed' };
  }

  const adaptData = adaptResult.data;

  // Load the Shopify Adapt knowledge base
  const [sectionsData, componentsData, platformData, migrationData] = await Promise.all([
    fetch(chrome.runtime.getURL('knowledge-base/shopify-adapt/sections.json')).then(r => r.json()),
    fetch(chrome.runtime.getURL('knowledge-base/shopify-adapt/components.json')).then(r => r.json()),
    fetch(chrome.runtime.getURL('knowledge-base/shopify-adapt/platform.json')).then(r => r.json()),
    fetch(chrome.runtime.getURL('knowledge-base/shopify-adapt/migration-patterns.json')).then(r => r.json())
  ]);

  // Map detected regions to Shopify sections
  const sectionMappings = mapRegionsToShopify(adaptData.regions, sectionsData.sections);

  // Map detected components to Shopify support
  const componentMappings = mapComponentsToShopify(adaptData.components, componentsData.components);

  // Get migration info for detected platform
  const platformMigration = migrationData.platforms[adaptData.platform] || migrationData.platforms['custom-ecommerce'];

  // Capture screenshot for the results page
  const screenshot = await captureViewport(tabId, '100');

  // Assemble adapt results
  const results = {
    version: '1.0',
    mode: 'shopify-adapt',
    meta: {
      url: adaptData.url,
      title: adaptData.pageTitle,
      pageType: adaptData.pageType,
      platform: adaptData.platform,
      timestamp: Date.now()
    },
    screenshot,
    regions: adaptData.regions,
    components: adaptData.components,
    complexitySignals: adaptData.complexitySignals,
    shopifyDetails: adaptData.shopifyDetails || null,
    sectionMappings,
    componentMappings,
    platformMigration,
    platformConstraints: platformData
  };

  // Store and open results
  await chrome.storage.local.set({ echoflowResults: results });
  await chrome.tabs.create({ url: chrome.runtime.getURL('results.html') + '?mode=shopify-adapt' });

  return {
    success: true,
    componentCount: adaptData.components.length + adaptData.regions.length
  };
}

function mapRegionsToShopify(regions, shopifySections) {
  const typeMap = {
    'hero': 'image-banner',
    'image-banner': 'image-banner',
    'cta-banner': 'image-banner',
    'product-grid': 'featured-collection',
    'featured-product': 'featured-product',
    'faq-accordion': 'collapsible-content',
    'blog-posts': 'blog-posts',
    'newsletter': 'newsletter',
    'video': 'video',
    'rich-text': 'rich-text',
    'image-with-text': 'image-with-text',
    'multicolumn': 'multicolumn',
    'contact-form': 'contact-form',
    'testimonials': 'multicolumn',
    'logo-list': 'multicolumn',
    'gallery': 'multicolumn',
    'map': 'custom-liquid',
    'tabs': 'collapsible-content',
    'countdown': 'custom-liquid'
  };

  // Separate layout containers from content sections
  const layoutTypes = ['header', 'navigation', 'footer', 'main-content', 'sidebar'];

  return regions.map(region => {
    const isLayout = layoutTypes.includes(region.type);

    if (isLayout) {
      // Layout containers — always present, not real "mappings"
      let layoutNotes = '';
      let layoutFeatures = [];

      if (region.type === 'header' && region.children) {
        if (region.children.hasMegaMenu) layoutFeatures.push('mega menu');
        if (region.children.hasSearch) layoutFeatures.push('search');
        if (region.children.hasCart) layoutFeatures.push('cart');
        if (region.children.hasAccount) layoutFeatures.push('account');
        if (region.children.hasAnnouncement) layoutFeatures.push('announcement bar');
        if (region.children.hasLogo) layoutFeatures.push('logo');
        layoutNotes = layoutFeatures.length
          ? `Contains: ${layoutFeatures.join(', ')}`
          : 'Standard header layout';
      } else if (region.type === 'footer' && region.children) {
        if (region.children.hasNewsletter) layoutFeatures.push('newsletter');
        if (region.children.hasNavigation) layoutFeatures.push('navigation');
        if (region.children.hasSocialLinks) layoutFeatures.push('social links');
        if (region.children.hasPaymentIcons) layoutFeatures.push('payment icons');
        if (region.children.columnCount > 1) layoutFeatures.push(`${region.children.columnCount} columns`);
        layoutNotes = layoutFeatures.length
          ? `Contains: ${layoutFeatures.join(', ')}`
          : 'Standard footer layout';
      } else if (region.type === 'navigation' && region.children) {
        layoutNotes = `${region.children.linkCount || 0} links, ${region.children.dropdownCount || 0} dropdowns, depth ${region.children.depth || 1}`;
      } else if (region.type === 'sidebar') {
        layoutNotes = 'Shopify supports sidebar filters on collection pages. Custom sidebar for other pages.';
      } else if (region.type === 'main-content') {
        layoutNotes = 'Main content area — composed of Shopify sections';
      }

      return {
        ...region,
        isLayout: true,
        shopifyMapping: {
          sectionType: region.type,
          sectionName: region.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          status: 'layout',
          notes: layoutNotes,
          features: layoutFeatures
        }
      };
    }

    // Content sections — these are the real mappings
    const shopifyType = typeMap[region.type];
    const shopifySection = shopifyType ? shopifySections[shopifyType] : null;

    let status = 'red';
    let notes = '';

    if (shopifySection) {
      status = 'green';
      notes = `Maps to "${shopifySection.displayName}" section`;

      // Check for capability mismatches
      if (region.children) {
        if (region.children.hasParallax && shopifySection.doesNotSupport?.includes('parallax')) {
          status = 'yellow';
          notes += '. Parallax effect not supported natively — needs custom CSS/JS.';
        }
        if (region.children.hasSlider && region.children.slideCount > (shopifySection.maxBlocks || 5)) {
          status = 'yellow';
          notes += `. Slider has ${region.children.slideCount} slides — max ${shopifySection.maxBlocks || 5} natively.`;
        }
        if (region.children.hasVideo && shopifySection.doesNotSupport?.includes('video-background')) {
          status = 'yellow';
          notes += '. Video background not supported in this section — use Video section instead.';
        }
      }
    } else {
      status = 'yellow';
      notes = 'No direct Shopify section — use Custom Liquid section';
    }

    return {
      ...region,
      isLayout: false,
      shopifyMapping: {
        sectionType: shopifyType || 'custom-liquid',
        sectionName: shopifySection?.displayName || 'Custom Liquid',
        status,
        notes
      }
    };
  });
}

function mapComponentsToShopify(components, shopifyComponents) {
  return components.map(comp => {
    const shopifyComp = shopifyComponents[comp.type];

    let status = 'red';
    let notes = '';
    let solution = '';
    let effort = '';
    let apps = [];

    if (shopifyComp) {
      if (shopifyComp.native) {
        status = 'green';
        notes = shopifyComp.sinceTheme ? `Native since ${shopifyComp.sinceTheme}` : 'Native in Shopify';
        if (shopifyComp.limitations?.length) {
          notes += '. Limitations: ' + shopifyComp.limitations.slice(0, 2).join('; ');
        }
      } else if (shopifyComp.nativePartial || shopifyComp.nativeWorkaround) {
        status = 'yellow';
        notes = shopifyComp.workaround || shopifyComp.notes || 'Partial native support';
        solution = shopifyComp.customApproach || shopifyComp.solution || '';
        effort = shopifyComp.effort || '';
        apps = (shopifyComp.apps || []).map(a => typeof a === 'string' ? a : a.name);
      } else {
        status = shopifyComp.complexity === 'very-high' || shopifyComp.complexity === 'high' ? 'red' : 'yellow';
        notes = shopifyComp.notes || 'Not natively supported';
        solution = shopifyComp.customApproach || shopifyComp.solution || '';
        effort = shopifyComp.effort || '';
        apps = (shopifyComp.apps || []).map(a => typeof a === 'string' ? a : a.name);
      }
    } else {
      status = 'yellow';
      notes = 'Component not in Shopify knowledge base — likely needs custom development';
    }

    return {
      ...comp,
      shopifyMapping: { status, notes, solution, effort, apps }
    };
  });
}

let batchStopped = false;
let discoverStopped = false;

// ── Page Discovery ──

// Shared-template sampling: sites with 100k+ products produce 100k+ URLs that all
// map to the same Shopify template. For IA/migration work we only need a handful
// of samples per template to confirm it exists — the rest are redundant and clog
// the UI (and waste the crawler's budget). This classifier identifies which URL
// patterns are "shared templates" worth sampling; unique pages (policies,
// /pages/*, account, etc.) are always kept.
function getSharedTemplateKey(url) {
  let path;
  try { path = new URL(url).pathname.toLowerCase(); } catch { return null; }

  // Shopify
  if (path.match(/^\/products\/[^/]+$/)) return 'product';
  if (path.match(/^\/collections\/.+\/products\//)) return 'product';
  if (path.match(/^\/collections\/[^/]+$/)) return 'collection';

  // WooCommerce / generic ecommerce
  if (path.match(/^\/(product|item|p)\/[^/]/)) return 'product';
  if (path.match(/^\/shop\/[^/]+\//)) return 'product';
  if (path.match(/^\/(product-category|category|catalog)\//)) return 'collection';

  // Blog / articles
  if (path.match(/^\/(blog|blogs|articles?|news|journal)\/.+/)) return 'blog-post';
  if (path.match(/^\/posts?\/.+/)) return 'blog-post';

  // Help / support articles
  if (path.match(/^\/(help|support)\/.+/)) return 'help-article';

  // Store / location detail pages
  if (path.match(/^\/(stores?|locations?)\/.+/)) return 'store-detail';

  return null; // Not a shared template — always keep
}

const SHARED_TEMPLATE_CAP = 5;

function createSharedSampler(cap = SHARED_TEMPLATE_CAP) {
  const kept = new Map();    // key -> count kept
  const skipped = new Map(); // key -> count dropped
  return {
    // Returns true if the URL should be kept, false if it's a shared-template
    // URL that has already hit its sample cap.
    shouldKeep(url) {
      const key = getSharedTemplateKey(url);
      if (!key) return true;
      const current = kept.get(key) || 0;
      if (current < cap) {
        kept.set(key, current + 1);
        return true;
      }
      skipped.set(key, (skipped.get(key) || 0) + 1);
      return false;
    },
    // Returns { product: { kept: 5, skipped: 8400, total: 8405 }, ... }
    stats() {
      const out = {};
      const keys = new Set([...kept.keys(), ...skipped.keys()]);
      for (const k of keys) {
        const keptCount = kept.get(k) || 0;
        const skippedCount = skipped.get(k) || 0;
        out[k] = { kept: keptCount, skipped: skippedCount, total: keptCount + skippedCount };
      }
      return out;
    },
    // Total URLs dropped across all shared-template types
    totalSkipped() {
      let sum = 0;
      for (const n of skipped.values()) sum += n;
      return sum;
    }
  };
}

async function discoverViaSitemap(origin) {
  const urls = [];
  const sitemapUrls = [];
  const sampler = createSharedSampler();

  // Try common sitemap locations
  const candidates = [
    origin + '/sitemap.xml',
    origin + '/sitemap_index.xml',
    origin + '/sitemap-index.xml',
    origin + '/wp-sitemap.xml',       // WordPress
    origin + '/sitemap_products_1.xml' // Shopify
  ];

  // Also check robots.txt for sitemap references
  try {
    sendDiscoverProgress('Checking robots.txt...');
    const robotsResp = await fetch(origin + '/robots.txt', { signal: AbortSignal.timeout(5000) });
    if (robotsResp.ok) {
      const robotsText = await robotsResp.text();
      const matches = robotsText.match(/Sitemap:\s*(\S+)/gi);
      if (matches) {
        matches.forEach(m => {
          const url = m.replace(/Sitemap:\s*/i, '').trim();
          if (!candidates.includes(url)) candidates.unshift(url);
        });
      }
    }
  } catch (_) {}

  // Try each candidate
  for (const candidate of candidates) {
    if (discoverStopped) break;
    try {
      sendDiscoverProgress(`Fetching ${new URL(candidate).pathname}...`);
      const resp = await fetch(candidate, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) continue;

      const text = await resp.text();
      if (!text.includes('<urlset') && !text.includes('<sitemapindex')) continue;

      // Check if it's a sitemap index (contains other sitemaps)
      if (text.includes('<sitemapindex')) {
        const locMatches = text.match(/<loc>\s*(.*?)\s*<\/loc>/gi);
        if (locMatches) {
          locMatches.forEach(m => {
            const loc = m.replace(/<\/?loc>/gi, '').trim();
            if (loc.includes('.xml')) sitemapUrls.push(loc);
          });
        }
      } else {
        // Regular sitemap — extract URLs
        const locMatches = text.match(/<loc>\s*(.*?)\s*<\/loc>/gi);
        if (locMatches) {
          locMatches.forEach(m => {
            const loc = m.replace(/<\/?loc>/gi, '').trim();
            if (loc.includes('.xml')) return;
            if (!sampler.shouldKeep(loc)) return; // Sample cap hit for this template
            urls.push(loc);
          });
        }
      }

      if (urls.length > 0 || sampler.totalSkipped() > 0) break; // Found URLs (or hit cap), no need to try other candidates
    } catch (_) {
      continue;
    }
  }

  // If we found sitemap index entries, fetch those too
  for (const sitemapUrl of sitemapUrls.slice(0, 10)) { // Limit to 10 sub-sitemaps
    if (discoverStopped) break;
    try {
      sendDiscoverProgress(`Fetching sub-sitemap (${urls.length} kept, ${sampler.totalSkipped().toLocaleString()} collapsed)...`);
      const resp = await fetch(sitemapUrl, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) continue;
      const text = await resp.text();
      const locMatches = text.match(/<loc>\s*(.*?)\s*<\/loc>/gi);
      if (locMatches) {
        locMatches.forEach(m => {
          const loc = m.replace(/<\/?loc>/gi, '').trim();
          if (loc.includes('.xml')) return;
          if (!sampler.shouldKeep(loc)) return;
          urls.push(loc);
        });
      }
    } catch (_) {
      continue;
    }
  }

  // Deduplicate and sort
  const unique = [...new Set(urls)].sort();
  const sampleStats = sampler.stats();
  const totalSkipped = sampler.totalSkipped();
  const totalDetected = unique.length + totalSkipped;
  sendDiscoverProgress(`Done: ${unique.length} kept (${totalDetected.toLocaleString()} detected, ${totalSkipped.toLocaleString()} collapsed into samples)`);
  return { urls: unique, sampleStats, totalDetected };
}

async function discoverViaCrawl(origin, startUrl) {
  const visited = new Set();
  const found = new Set();
  const queue = [startUrl];
  const maxPages = 200;  // Safety limit
  const maxDepth = 3;    // Don't go too deep
  const depthMap = new Map();
  depthMap.set(startUrl, 0);
  const sampler = createSharedSampler();

  // Always keep the startUrl (it's the entry point the user clicked from)
  sampler.shouldKeep(startUrl);

  while (queue.length > 0 && found.size < maxPages) {
    if (discoverStopped) break;

    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    const depth = depthMap.get(url) || 0;
    if (depth > maxDepth) continue;

    try {
      sendDiscoverProgress(`Crawling (${found.size} kept, ${sampler.totalSkipped().toLocaleString()} collapsed, ${queue.length} queued)...`);
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { 'Accept': 'text/html' }
      });
      if (!resp.ok) continue;

      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) continue;

      const html = await resp.text();
      found.add(url);

      // Extract all links from the page
      const linkRegex = /href\s*=\s*["']([^"'#]+)["']/gi;
      let match;
      while ((match = linkRegex.exec(html)) !== null) {
        let href = match[1].trim();

        // Skip non-page resources
        if (href.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|pdf|zip|mp4|mp3|webp|avif)(\?|$)/i)) continue;
        if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;

        // Resolve relative URLs
        try {
          const resolved = new URL(href, url);
          // Only follow same-origin links
          if (resolved.origin !== origin) continue;

          const clean = resolved.origin + resolved.pathname;
          if (visited.has(clean) || found.has(clean)) continue;

          // Sample cap: if this is a shared-template URL and we already have
          // enough samples, don't enqueue it. Saves network budget for actually
          // different templates (policies, account, etc.) instead of wasting
          // all 200 fetches on product pages.
          if (!sampler.shouldKeep(clean)) continue;

          queue.push(clean);
          if (!depthMap.has(clean)) depthMap.set(clean, depth + 1);
        } catch (_) {}
      }
    } catch (_) {
      continue;
    }
  }

  const unique = [...found].sort();
  const sampleStats = sampler.stats();
  const totalSkipped = sampler.totalSkipped();
  const totalDetected = unique.length + totalSkipped;
  sendDiscoverProgress(`Done: ${unique.length} kept (${totalDetected.toLocaleString()} detected, ${totalSkipped.toLocaleString()} collapsed into samples)`);
  return { urls: unique, sampleStats, totalDetected };
}

function sendDiscoverProgress(text) {
  // chrome.runtime.sendMessage returns a Promise in MV3. When the popup is
  // closed (user clicked away during a long discover), the Promise rejects
  // asynchronously — a sync try/catch can't catch it. Always attach .catch().
  try {
    const p = chrome.runtime.sendMessage({ action: 'DISCOVER_PROGRESS', text, count: 0 });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) {}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Page Review ──

  if (message.action === 'START_AUDIT') {
    const { vertical, pageType, mode, resolution, projectId } = message;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
      }
      try {
        const result = await runAudit(tabs[0].id, tabs[0].url, vertical, mode, resolution, pageType);

        // Auto-save to project if one is active
        if (projectId && result.success && result.results) {
          try {
            await saveAudit(projectId, {
              url: result.results.meta.url,
              pageType: result.results.meta.pageType,
              vertical: result.results.meta.vertical,
              device: result.results.meta.device,
              results: result.results,
              designInventory: result.results.designInventory,
              screenshot: result.results.screenshot
            });
          } catch (_) {} // Don't fail the audit if save fails
        }

        sendResponse(result);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    });

    return true;
  }

  if (message.action === 'LOAD_AUDIT_FILE') {
    chrome.storage.local.set({ echoflowResults: message.data }, async () => {
      await chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'AI_ANALYZE') {
    const provider = message.provider || 'claude';
    const analyzeFn = provider === 'gemini' ? runGeminiAnalysis : runClaudeAnalysis;
    analyzeFn(message.data, message.apiKey, message.auditContext)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ── Project Management ──

  if (message.action === 'CREATE_PROJECT') {
    createProject(message.name)
      .then(project => sendResponse({ success: true, project }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'LIST_PROJECTS') {
    listProjects()
      .then(projects => sendResponse({ success: true, projects }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'GET_PROJECT_AUDITS') {
    (async () => {
      try {
        const project = await getProject(message.projectId);
        const audits = await getAuditsForProject(message.projectId);
        sendResponse({ success: true, project, audits });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'DELETE_PROJECT') {
    deleteProject(message.projectId)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ── Batch Audit ──

  if (message.action === 'BATCH_AUDIT') {
    const { urls, vertical, projectId } = message;
    batchStopped = false;

    (async () => {
      let completed = 0;
      const total = urls.length;

      for (let i = 0; i < urls.length; i++) {
        if (batchStopped) break;

        const url = urls[i];
        try {
          // Navigate to URL
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) break;

          await chrome.tabs.update(tab.id, { url });

          // Wait for page to load
          await new Promise((resolve) => {
            const listener = (tabId, changeInfo) => {
              if (tabId === tab.id && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
            // Timeout after 30 seconds
            setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }, 30000);
          });

          await sleep(1500); // Let page fully render

          // Run audit (don't open results page for batch)
          const result = await runAuditSilent(tab.id, url, vertical, 'viewport', '100', null);

          // Save to project
          if (result.success && result.results) {
            await saveAudit(projectId, {
              url: result.results.meta.url,
              pageType: result.results.meta.pageType,
              vertical: result.results.meta.vertical,
              device: result.results.meta.device,
              results: result.results,
              designInventory: result.results.designInventory,
              screenshot: result.results.screenshot
            });
          }

          completed++;

          // Send progress to popup
          chrome.runtime.sendMessage({
            action: 'BATCH_PROGRESS',
            current: completed,
            total
          }).catch(() => {}); // Popup may be closed

        } catch (err) {
          completed++;
          // Continue to next URL on error
        }

        // Pause between audits
        if (i < urls.length - 1 && !batchStopped) {
          await sleep(3000);
        }
      }

      // Open project results when done
      if (!batchStopped && completed > 0) {
        const resultsUrl = chrome.runtime.getURL('results.html') + '?projectId=' + projectId;
        await chrome.tabs.create({ url: resultsUrl });
      }

      sendResponse({ success: true, completed });
    })();

    return true;
  }

  if (message.action === 'BATCH_STOP') {
    batchStopped = true;
    sendResponse({ success: true });
    return true;
  }

  // ── Page Discovery ──

  if (message.action === 'DISCOVER_PAGES') {
    const { method, origin, startUrl } = message;
    discoverStopped = false;

    (async () => {
      try {
        let result = { urls: [], sampleStats: {}, totalDetected: 0 };
        if (method === 'sitemap') {
          result = await discoverViaSitemap(origin);
        } else if (method === 'crawl') {
          result = await discoverViaCrawl(origin, startUrl);
        }
        sendResponse({
          success: true,
          urls: result.urls,
          sampleStats: result.sampleStats || {},
          totalDetected: result.totalDetected || result.urls.length
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }

  if (message.action === 'DISCOVER_STOP') {
    discoverStopped = true;
    sendResponse({ success: true });
    return true;
  }

  // ── Shopify Adapt ──

  if (message.action === 'RUN_SHOPIFY_ADAPT') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
      }
      try {
        const result = await runShopifyAdapt(tabs[0].id, tabs[0].url);
        sendResponse(result);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  }
});

// ── AI Analysis ──

function buildAnalysisPrompt(auditData, auditContext) {
  const findingsText = auditData.findings.map(f =>
    `${f.number}. [${f.category}] ${f.description} (ICE: I:${f.ice.impact} C:${f.ice.confidence} E:${f.ice.ease})`
  ).join('\n');

  const sectionsList = (auditData.sections || []).map(s =>
    `- ${s.type || s.id || 'unknown'} (${Math.round(s.position.height)}px tall)`
  ).join('\n');

  const meta = auditData.meta;
  const device = meta.device || 'desktop';
  const pageType = meta.pageType ? ` — ${meta.pageType.replace(/-/g, ' ')}` : '';

  let prompt = `You are a senior UX auditor analyzing a ${meta.vertical}${pageType} page on ${device}.

URL: ${meta.url}
Page title: ${meta.title}
Device: ${device} (${meta.viewport.width}x${meta.viewport.height})`;

  if (meta.pageType) {
    prompt += `\nPage type: ${meta.pageType.replace(/-/g, ' ')}`;
  }

  if (auditContext) {
    prompt += `\n\nAuditor notes:\n${auditContext}`;
  }

  // Design inventory summary
  const inv = auditData.designInventory;
  let designSection = '';
  if (inv) {
    const topColors = (inv.colorPalette || []).slice(0, 10).map(c => c.value + ' (' + c.count + ')').join(', ');
    const topFonts = (inv.fontFamilies || []).slice(0, 5).map(f => f.value + ' (' + f.count + ')').join(', ');
    const sizes = (inv.fontSizes || []).map(s => s.value + 'px').join(', ');
    const radii = (inv.borderRadii || []).map(r => r.value).join(', ');
    const shadowCount = (inv.shadows || []).length;
    const gridRatio = inv.spacingGridRatio || 0;

    designSection = `

Design inventory:
- Fonts: ${topFonts || 'none detected'}
- Font sizes: ${sizes || 'none'}
- Color palette: ${topColors || 'none'}
- Spacing: ${gridRatio}% on 4px grid, ${(inv.spacingValues || []).length} unique values
- Border-radius: ${radii || 'none'}
- Shadows: ${shadowCount} unique styles`;
  }

  prompt += `

Page sections:
${sectionsList || 'No sections detected'}

Rule-based findings:
${findingsText || 'No rule-based findings'}

Raw stats: ${auditData.rawData.elementCount} elements, ${auditData.rawData.imageCount} images, ${auditData.rawData.linkCount} links, ${auditData.rawData.forms?.length || 0} forms${designSection}

Provide a concise analysis considering this is a ${device} experience${pageType ? ' for a ' + meta.pageType.replace(/-/g, ' ') + ' page' : ''}:
1. Top 5 priority issues with specific, actionable fixes${device !== 'desktop' ? ' (consider touch targets, thumb zones, mobile patterns)' : ''}
2. Quick wins (high ease, high impact)
3. Any patterns or issues the rules may have missed${meta.pageType ? ' — consider ' + meta.vertical + ' ' + meta.pageType.replace(/-/g, ' ') + ' best practices' : ''}
4. Overall UX score (1-10) with brief justification
5. Visual design assessment:
   - Color palette coherence (1-10)
   - Typography system quality (1-10)
   - Spacing consistency (1-10)
   - The single biggest "taste" fix a designer would make first
6. Overall Design score (1-10) separate from UX score

Be direct and specific. Reference element positions and types.`;

  return prompt;
}

// ── Claude API ──

async function runClaudeAnalysis(auditData, apiKey, auditContext) {
  if (!apiKey) {
    return { success: false, error: 'No Claude API key configured. Go to Settings.' };
  }

  const prompt = buildAnalysisPrompt(auditData, auditContext);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: 'Claude API error: ' + response.status + ' — ' + err };
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || 'No response';

  return { success: true, analysis: text };
}

// ── Gemini API ──

async function runGeminiAnalysis(auditData, apiKey, auditContext) {
  if (!apiKey) {
    return { success: false, error: 'No Gemini API key configured. Go to Settings.' };
  }

  const prompt = buildAnalysisPrompt(auditData, auditContext);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1500 }
      })
    }
  );

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: 'Gemini API error: ' + response.status + ' — ' + err };
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';

  return { success: true, analysis: text };
}

// ── Knowledge Base Auto-Update ──

const GITHUB_BASE = 'https://raw.githubusercontent.com/AnderMagri/EchoFlow/main/echoflow/knowledge-base/';
const VERTICALS = ['generic-ux', 'shopify', 'fintech', 'crypto'];

async function updateKnowledgeBase() {
  for (const vertical of VERTICALS) {
    try {
      const response = await fetch(GITHUB_BASE + vertical + '.json', { cache: 'no-cache' });
      if (response.ok) {
        const rules = await response.json();
        await chrome.storage.local.set({
          ['rules_' + vertical]: rules,
          ['rules_' + vertical + '_updated']: Date.now()
        });
      }
    } catch (e) {
      // Silently fail — bundled rules remain as fallback
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  updateKnowledgeBase();
  chrome.alarms.create('updateKnowledgeBase', { periodInMinutes: 1440 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'updateKnowledgeBase') {
    updateKnowledgeBase();
  }
});
