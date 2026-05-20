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

// ── Screenshot Capture (used by Vision Layer when size < 4MB) ──

async function captureViewport(tabId, resolution) {
  const scale = resolution === '120' ? 1.2 : 1.0;

  // Resolve the window that owns this tab so captureVisibleTab is explicit
  const tabInfo   = await chrome.tabs.get(tabId);
  const windowId  = tabInfo.windowId;

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
    dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: 'jpeg',
      quality: 95
    });
    await chrome.tabs.setZoom(tabId, originalZoom);
  } else {
    dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
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
  // Resolve window once so all captureVisibleTab calls are explicit
  const tabInfo  = await chrome.tabs.get(tabId);
  const windowId = tabInfo.windowId;

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

  // ── Phase 1: Prepare page for distortion-free capture ──
  // Freeze CSS animations/transitions so no element is mid-state between strips.
  // Force background-attachment:scroll to fix parallax heroes.
  // Promote lazy images to eager so lower strips have loaded content.
  await chrome.tabs.sendMessage(tabId, { action: 'PREPARE_FOR_CAPTURE' }).catch(() => {});

  // Disable smooth scrolling and hide scrollbar
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

  // ── Phase 2: Pre-scroll to trigger lazy loading and scroll-reveal elements ──
  // Quickly scroll through the full page so Intersection Observers and JS lazy
  // loaders detect lower sections and begin fetching images before we capture.
  // Animations are already frozen so elements snap to their final visible state.
  if (totalHeight > viewportHeight) {
    const preScrollStep = Math.floor(viewportHeight * 0.75);
    for (let y = preScrollStep; y < totalHeight; y += preScrollStep) {
      await chrome.tabs.sendMessage(tabId, { action: 'SCROLL_TO', y });
      await sleep(80); // Just enough for IO to fire, not a full render wait
    }
    // Return to top and let lazy-loaded images finish loading
    await chrome.tabs.sendMessage(tabId, { action: 'SCROLL_TO', y: 0 });
    await sleep(800);
  }

  // ── Phase 3: Capture strips ──
  // Capture first viewport (keep fixed/sticky elements visible for first strip)
  await chrome.tabs.sendMessage(tabId, { action: 'SCROLL_TO', y: 0 });
  await sleep(500);
  const firstStrip = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 90 });
  await sleep(500); // Rate limit: ~1 capture/sec max

  // Each strip tracks: actual scroll position, how much to crop from top, and output Y
  const strips = [{
    dataUrl: firstStrip,
    srcY: 0,               // crop from top of captured image
    srcHeight: viewportHeight, // how much of captured image to use
    destY: 0               // where to place it on the final canvas
  }];

  let coveredUpTo = viewportHeight; // we've captured content from 0 to viewportHeight

  // ── Install persistent fixed-element suppressor ──
  // Strategy: use inline style.setProperty('display','none','important') which beats
  // any CSS rule including 3rd-party !important declarations. A MutationObserver
  // re-hides anything that page JS tries to show back (scroll-triggered promo bars,
  // cookie banners, chat widgets that fire AFTER our hide pass).
  // Infinite-loop guard: before re-hiding we check if display is already 'none !important';
  // if it is, we know WE set it and skip — so our own setProperty calls don't retrigger.
  if (totalHeight > viewportHeight) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Apply inline !important hide to one element
        function efHide(el) {
          el.style.setProperty('display',    'none',   'important');
          el.style.setProperty('visibility', 'hidden', 'important');
          el.style.setProperty('opacity',    '0',      'important');
          el.dataset.efHidden = '1';
        }

        // Scan and hide all fixed/sticky elements in the current DOM
        function efScan() {
          for (const el of document.querySelectorAll('*')) {
            if (el.tagName === 'HTML' || el.tagName === 'BODY') continue;
            const pos = getComputedStyle(el).position;
            if (pos === 'fixed' || pos === 'sticky') efHide(el);
          }
        }
        efScan();

        // MutationObserver: catch scroll-triggered shows and lazy-injected overlays
        window.__efObserver = new MutationObserver((mutations) => {
          for (const m of mutations) {
            if (m.type === 'childList') {
              // New element injected into DOM — check if it's an overlay
              m.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                if (getComputedStyle(node).position === 'fixed' ||
                    getComputedStyle(node).position === 'sticky') efHide(node);
                node.querySelectorAll('*').forEach(child => {
                  const cp = getComputedStyle(child).position;
                  if (cp === 'fixed' || cp === 'sticky') efHide(child);
                });
              });
            } else if (m.type === 'attributes') {
              const el = m.target;
              // Guard: if display is already 'none !important' we set it — skip to avoid loop
              if (el.style.getPropertyValue('display') === 'none' &&
                  el.style.getPropertyPriority('display') === 'important') continue;
              // Something changed style/class — re-evaluate if this element should be hidden
              const pos = getComputedStyle(el).position;
              if (pos === 'fixed' || pos === 'sticky') efHide(el);
            }
          }
        });

        window.__efObserver.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['style', 'class']
        });

        void document.body.getBoundingClientRect();
      }
    });
    await sleep(600);
  }

  // Capture remaining strips — scroll in viewport-sized steps
  let targetY = viewportHeight;
  while (coveredUpTo < totalHeight) {
    const scrollResult = await chrome.tabs.sendMessage(tabId, { action: 'SCROLL_TO', y: targetY });
    await sleep(400); // Wait for scroll, lazy loads, and scroll-triggered JS to settle

    // Extra synchronous re-hide sweep: catches anything the MutationObserver missed
    // (e.g. inline style changes that don't go through style/class attributes).
    // Runs immediately before captureVisibleTab with no sleep gap.
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        for (const el of document.querySelectorAll('*')) {
          if (el.tagName === 'HTML' || el.tagName === 'BODY') continue;
          const pos = getComputedStyle(el).position;
          if (pos === 'fixed' || pos === 'sticky') {
            el.style.setProperty('display',    'none',   'important');
            el.style.setProperty('visibility', 'hidden', 'important');
            el.style.setProperty('opacity',    '0',      'important');
            el.dataset.efHidden = '1';
          }
        }
        void document.body.getBoundingClientRect();
      }
    });
    // No sleep between this re-hide and captureVisibleTab — minimise window for JS re-show

    // The browser clamps scrollY to the maximum scrollable position
    const actualScrollY = scrollResult.scrollY;

    // How much of this capture overlaps with what we already have?
    const overlap = Math.max(0, coveredUpTo - actualScrollY);

    // Only use the non-overlapping portion
    const usableHeight = Math.min(viewportHeight - overlap, totalHeight - coveredUpTo);

    if (usableHeight <= 0) break;

    const stripDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 90 });
    await sleep(500); // Rate limit buffer (~1 capture/sec)

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

  // ── Phase 4: Restore page to original state ──
  if (totalHeight > viewportHeight) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Stop the observer first so it doesn't fight the restore
        if (window.__efObserver) {
          window.__efObserver.disconnect();
          window.__efObserver = null;
        }
        // Remove inline styles we injected and clear our data attribute
        for (const el of document.querySelectorAll('[data-ef-hidden="1"]')) {
          el.style.removeProperty('display');
          el.style.removeProperty('visibility');
          el.style.removeProperty('opacity');
          delete el.dataset.efHidden;
        }
      }
    });
  }

  // Unfreeze animations and restore scrollbar/scroll-behavior
  await chrome.tabs.sendMessage(tabId, { action: 'RESTORE_AFTER_CAPTURE' }).catch(() => {});
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

function waitForTabLoad(tabId, timeoutMs = 30000) {
  return new Promise(resolve => {
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, timeoutMs);
  });
}

// ── Device Profiles for Mobile Emulation (via Chrome DevTools Protocol) ──

const DEVICE_PROFILES = {
  mobile: {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  },
  tablet: {
    width: 820, height: 1180, deviceScaleFactor: 2, mobile: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  }
};

/**
 * Attach the Chrome debugger to `tabId`, apply a device metrics override,
 * reload the page so media queries re-evaluate, run `fn(tabId)`, then
 * restore the emulation and detach — regardless of success or failure.
 */
async function withMobileEmulation(tabId, profile, fn) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
    await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', {
      width: profile.width,
      height: profile.height,
      deviceScaleFactor: profile.deviceScaleFactor,
      mobile: profile.mobile
    });
    await chrome.debugger.sendCommand(target, 'Emulation.setUserAgentOverride', {
      userAgent: profile.userAgent
    });
    // Reload so the page receives the correct UA + viewport from the start
    await chrome.tabs.reload(tabId);
    await waitForTabLoad(tabId);
    await sleep(1000); // extra settle for JS-driven layouts
    return await fn(tabId);
  } finally {
    await chrome.debugger.sendCommand(target, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
    await chrome.debugger.detach(target).catch(() => {});
  }
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

async function runAudit(tabId, tabUrl, vertical, mode, resolution, pageType, device = 'desktop') {
  const origin = new URL(tabUrl).origin;

  // Step 1: Load rules — merge mobile rules when running a mobile/tablet audit
  const rules = await loadRules(vertical);
  if (device === 'mobile' || device === 'tablet') {
    const mobileRules = await loadRules('mobile');
    rules.push(...mobileRules);
  }
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

  // Step 7: Evaluate rules
  const findings = evaluateRules(rules, domData);

  // Step 7b: Capture screenshot now while the tab is still active (before results page opens)
  const screenshot = await captureViewport(tabId, '100').catch(() => null);

  // Step 8: Assemble results
  const results = {
    version: '1.0',
    meta: {
      url: domData.url,
      title: domData.title,
      vertical: vertical,
      pageType: pageType || null,
      device: device || (domData.viewport.width <= 480 ? 'mobile' : domData.viewport.width <= 1024 ? 'tablet' : 'desktop'),
      captureMode: mode,
      timestamp: Date.now(),
      viewport: domData.viewport,
      scrollHeight: domData.scrollHeight
    },
    shopify: domData.shopify,
    sections: domData.sections,
    catalog: domData.apiResponses,
    screenshot,
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

async function runAuditSilent(tabId, tabUrl, vertical, mode, resolution, pageType, device = 'desktop') {
  const origin = new URL(tabUrl).origin;
  const rules = await loadRules(vertical);
  if (device === 'mobile' || device === 'tablet') {
    const mobileRules = await loadRules('mobile');
    rules.push(...mobileRules);
  }
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

  const findings = evaluateRules(rules, domData);

  const results = {
    version: '1.0',
    meta: {
      url: domData.url,
      title: domData.title,
      vertical: vertical,
      pageType: pageType || null,
      device: device || (domData.viewport.width <= 480 ? 'mobile' : domData.viewport.width <= 1024 ? 'tablet' : 'desktop'),
      captureMode: mode,
      timestamp: Date.now(),
      viewport: domData.viewport,
      scrollHeight: domData.scrollHeight
    },
    shopify: domData.shopify,
    sections: domData.sections,
    catalog: domData.apiResponses,
    screenshot: null,
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

// ── Discovery State (background-resident, persisted for popup reconnect) ──
// The popup can close mid-discover; the service worker keeps running. State
// is mirrored to chrome.storage.local so a freshly-opened popup (or a
// service worker that was restarted) can see what's in progress / what
// completed while the popup was gone.
let discoveryState = {
  status: 'idle', // 'idle' | 'running' | 'stopping' | 'stopped' | 'completed' | 'error'
  method: null,
  origin: null,
  startUrl: null,
  progressText: '',
  result: null,
  error: null,
  startedAt: null,
  finishedAt: null
};

async function persistDiscoveryState() {
  try {
    await chrome.storage.local.set({ __echoflowDiscoveryState: discoveryState });
    // Keep the toolbar badge in sync with state so users see discovery is alive
    // even when the popup is closed.
    updateDiscoveryBadge();
  } catch (_) {}
}

const EXPLORATIONS_KEY = '__echoflowExplorations';
const EXPLORATIONS_MAX = 10;

async function saveExploration({ siteUrl, method, pageCount, result }) {
  try {
    const hostname = new URL(siteUrl).hostname;
    const stored = await chrome.storage.local.get(EXPLORATIONS_KEY);
    let explorations = stored[EXPLORATIONS_KEY] || [];

    // Remove existing entry for same origin (dedup — keep the freshest)
    explorations = explorations.filter(e => e.siteUrl !== siteUrl);

    // Build the new exploration record
    const exploration = {
      id: 'exp_' + Date.now(),
      siteUrl,
      siteName: hostname,
      favicon: siteUrl + '/favicon.ico',
      timestamp: Date.now(),
      pageCount,
      method,
      result
    };

    // Prepend and cap at max
    explorations.unshift(exploration);
    if (explorations.length > EXPLORATIONS_MAX) explorations = explorations.slice(0, EXPLORATIONS_MAX);

    await chrome.storage.local.set({ [EXPLORATIONS_KEY]: explorations });
  } catch (_) {}
}

// Toolbar-icon badge reflects discoveryState:
//   running/stopping → teal, live "N kept" count pulled from progressText
//   completed         → green "✓" that persists until the popup is opened
//   error/stopped     → red "!" that persists until the popup is opened
//   idle              → cleared
function updateDiscoveryBadge() {
  if (!chrome.action || !chrome.action.setBadgeText) return; // older Chrome
  const s = discoveryState || {};
  try {
    if (s.status === 'running' || s.status === 'stopping') {
      // Try to scrape a kept-count out of the progress text for a meaningful number
      const m = typeof s.progressText === 'string' ? s.progressText.match(/(\d[\d,]*)\s*kept/i) : null;
      const text = m ? m[1].replace(/,/g, '').slice(0, 4) : '...';
      chrome.action.setBadgeText({ text });
      chrome.action.setBadgeBackgroundColor({ color: s.status === 'stopping' ? '#b36b00' : '#00C9A7' });
      chrome.action.setTitle({ title: `EchoFlow — ${s.progressText || 'Discovering pages...'}` });
    } else if (s.status === 'completed') {
      chrome.action.setBadgeText({ text: '✓' });
      chrome.action.setBadgeBackgroundColor({ color: '#00996e' });
      const count = s.result?.urls?.length ?? 0;
      chrome.action.setTitle({ title: `EchoFlow — Discovery complete (${count.toLocaleString()} pages)` });
    } else if (s.status === 'error' || s.status === 'stopped') {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#e53935' });
      chrome.action.setTitle({ title: `EchoFlow — ${s.error || 'Discovery stopped'}` });
    } else {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: 'EchoFlow' });
    }
  } catch (_) {}
}

// Once the user opens the popup on a terminal state, they've seen the result —
// clear the badge so it doesn't linger across sessions.
function clearDiscoveryBadgeIfTerminal() {
  if (!chrome.action || !chrome.action.setBadgeText) return;
  const s = discoveryState || {};
  if (s.status === 'completed' || s.status === 'error' || s.status === 'stopped') {
    try {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: 'EchoFlow' });
    } catch (_) {}
  }
}

async function hydrateDiscoveryState() {
  try {
    const { __echoflowDiscoveryState } = await chrome.storage.local.get('__echoflowDiscoveryState');
    if (__echoflowDiscoveryState) {
      discoveryState = __echoflowDiscoveryState;
      // If the previous SW died mid-run, there's nothing running now. Mark
      // the state as stopped so the popup doesn't poll forever.
      if (discoveryState.status === 'running' || discoveryState.status === 'stopping') {
        discoveryState.status = 'stopped';
        discoveryState.finishedAt = Date.now();
        discoveryState.error = 'Service worker was restarted — discovery interrupted';
        await persistDiscoveryState();
      }
    }
    updateDiscoveryBadge();
  } catch (_) {}
}
hydrateDiscoveryState();

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

/* ─── Nav Structure Extraction ─── */

/**
 * Extract navigation structure from raw HTML string.
 * Works in service worker context (no DOM) using regex-based parsing.
 * Returns { header: { items }, footer: { groups }, secondary: [] }
 */
function extractNavStructure(html, pageUrl) {
  let baseUrl;
  try { baseUrl = new URL(pageUrl).origin; } catch { return null; }

  // ── Helpers ──

  /** Strip HTML tags, decode common entities, collapse whitespace */
  function stripTags(s) {
    return s.replace(/<[^>]*>/g, ' ')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ').trim();
  }

  /** Resolve href to absolute pathname (same-origin only), or null */
  function resolveHref(href) {
    if (!href) return null;
    href = href.trim();
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return null;
    if (href === '#' || href === '') return null;
    try {
      const u = new URL(href, pageUrl);
      if (u.origin !== baseUrl) return null;
      return u.pathname;
    } catch { return null; }
  }

  /** Extract all <a> from an HTML fragment: [{ label, url }] */
  function extractLinks(fragment) {
    const links = [];
    const re = /<a\s[^>]*href\s*=\s*["']([^"'#]*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(fragment)) !== null) {
      const url = resolveHref(m[1]);
      const label = stripTags(m[2]);
      if (url && label && label.length < 80) links.push({ label, url });
    }
    return links;
  }

  /**
   * Parse nested <ul>/<li> structure into a tree of { label, url, children }.
   * Handles up to 3 levels of nesting.
   */
  function parseUlTree(ulHtml, maxDepth = 3) {
    if (maxDepth <= 0) return [];
    const items = [];
    // Match each top-level <li>
    const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch;
    while ((liMatch = liRegex.exec(ulHtml)) !== null) {
      const liContent = liMatch[1];
      // Get the first <a> in this <li>
      const aMatch = /<a\s[^>]*href\s*=\s*["']([^"'#]*)["'][^>]*>([\s\S]*?)<\/a>/i.exec(liContent);
      if (!aMatch) continue;
      const url = resolveHref(aMatch[1]);
      const label = stripTags(aMatch[2]);
      if (!label || label.length > 80) continue;

      // Look for nested <ul> inside this <li> (dropdown children)
      let children = [];
      const nestedUl = /<ul\b[^>]*>([\s\S]*?)<\/ul>/i.exec(liContent);
      if (nestedUl) {
        children = parseUlTree(nestedUl[1], maxDepth - 1);
      }

      items.push({ label, url, children });
    }
    return items;
  }

  /** Extract items from a region, trying <ul> structure first, then flat <a> links */
  function extractNavItems(regionHtml) {
    // Try structured <ul> parsing first
    const ulMatch = /<ul\b[^>]*>([\s\S]*?)<\/ul>/i.exec(regionHtml);
    if (ulMatch) {
      const items = parseUlTree(ulMatch[1]);
      if (items.length >= 2) return items;
    }
    // Fallback: flat <a> extraction
    return extractLinks(regionHtml).map(l => ({ ...l, children: [] }));
  }

  // ── Main extraction ──

  // Split HTML into before-main and after-main to classify nav position
  const mainSplit = html.search(/<main[\s>]/i);
  const footerStart = html.search(/<footer[\s>]/i);

  // Extract all <nav> regions with their position
  const navRegions = [];
  const navRegex = /<nav\b([^>]*)>([\s\S]*?)<\/nav>/gi;
  let navMatch;
  while ((navMatch = navRegex.exec(html)) !== null) {
    const attrs = navMatch[1];
    const content = navMatch[2];
    const pos = navMatch.index;
    const ariaLabel = (attrs.match(/aria-label\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const id = (attrs.match(/id\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const className = (attrs.match(/class\s*=\s*["']([^"']*)["']/i) || [])[1] || '';

    navRegions.push({ content, pos, ariaLabel, id, className });
  }

  // Classify navs as header, footer, or secondary
  let headerNav = null;
  let footerNavs = [];
  let secondaryNavs = [];

  for (const nav of navRegions) {
    const isFooter = (footerStart > 0 && nav.pos > footerStart) ||
                     /footer/i.test(nav.ariaLabel) || /footer/i.test(nav.className) || /footer/i.test(nav.id);
    const isHeader = !isFooter && (
      (mainSplit > 0 && nav.pos < mainSplit) ||
      /main[-\s]nav|primary|header/i.test(nav.ariaLabel) ||
      /main[-_\s]nav|primary|header/i.test(nav.className) ||
      /main[-_]nav/i.test(nav.id)
    );

    if (isHeader && !headerNav) {
      headerNav = nav;
    } else if (isFooter) {
      footerNavs.push(nav);
    } else if (!headerNav && navRegions.indexOf(nav) === 0) {
      // First nav in the document, likely header
      headerNav = nav;
    } else {
      secondaryNavs.push(nav);
    }
  }

  // If no <nav> found, try extracting from <header> directly
  if (!headerNav) {
    const headerMatch = /<header\b[^>]*>([\s\S]*?)<\/header>/i.exec(html);
    if (headerMatch) {
      headerNav = { content: headerMatch[1], ariaLabel: '', className: '', id: '' };
    }
  }

  // ── Build header structure ──
  let header = { label: 'Main Navigation', items: [] };
  if (headerNav) {
    // Try to find the main <ul> (often class="nav" or similar)
    const allUls = [];
    const ulRegex = /<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi;
    let ulM;
    while ((ulM = ulRegex.exec(headerNav.content)) !== null) {
      const items = parseUlTree(ulM[2]);
      allUls.push(items);
    }
    // Pick the <ul> with the most items (the main nav, not a utility nav)
    if (allUls.length > 0) {
      allUls.sort((a, b) => b.length - a.length);
      header.items = allUls[0];
    } else {
      // Fallback: flat <a> extraction from header
      header.items = extractLinks(headerNav.content).map(l => ({ ...l, children: [] }));
    }
    if (headerNav.ariaLabel) header.label = headerNav.ariaLabel;
  }

  // ── Build footer structure ──
  let footer = { groups: [] };
  if (footerNavs.length > 0) {
    // Each footer <nav> becomes a group
    for (const fNav of footerNavs) {
      const label = fNav.ariaLabel || 'Footer';
      const items = extractLinks(fNav.content);
      if (items.length > 0) footer.groups.push({ label, items });
    }
  }
  // Also try extracting from <footer> tag directly if no footer navs
  if (footer.groups.length === 0 && footerStart > 0) {
    const footerMatch = /<footer\b[^>]*>([\s\S]*?)<\/footer>/i.exec(html);
    if (footerMatch) {
      // Look for heading + link list patterns
      const groupRegex = /(?:<h[2-6]\b[^>]*>([\s\S]*?)<\/h[2-6]>)([\s\S]*?)(?=<h[2-6]\b|<\/footer|$)/gi;
      let gm;
      while ((gm = groupRegex.exec(footerMatch[1])) !== null) {
        const heading = stripTags(gm[1]);
        const links = extractLinks(gm[2]);
        if (heading && links.length > 0) footer.groups.push({ label: heading, items: links });
      }
      // Fallback: all footer links as one group
      if (footer.groups.length === 0) {
        const allFooterLinks = extractLinks(footerMatch[1]);
        if (allFooterLinks.length > 0) footer.groups.push({ label: 'Footer', items: allFooterLinks });
      }
    }
  }

  // ── Secondary navs ──
  const secondary = secondaryNavs.map(nav => {
    const items = extractNavItems(nav.content);
    return { label: nav.ariaLabel || 'Secondary Navigation', items };
  }).filter(s => s.items.length > 0);

  // Skip if we got nothing useful
  if (header.items.length === 0 && footer.groups.length === 0 && secondary.length === 0) return null;

  return { header, footer, secondary };
}

/**
 * Merge multiple nav structure samples into a consensus structure.
 * Uses majority vote on header item labels to pick the most representative sample.
 */
function mergeNavSamples(samples) {
  const valid = samples.filter(Boolean);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  // Score each sample by how many top-level header items it has
  // Pick the one with the most complete structure
  let best = valid[0];
  let bestScore = 0;
  for (const s of valid) {
    const score = (s.header?.items?.length || 0) +
                  (s.footer?.groups?.reduce((n, g) => n + g.items.length, 0) || 0);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
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
  // No parent data from sitemap.xml — signal null so the popup uses pure path-segment inference.
  // Fetch homepage to extract nav structure (single extra fetch for big payoff)
  let navStructure = null;
  try {
    const homeResp = await fetch(origin + '/', { signal: AbortSignal.timeout(8000), headers: { 'Accept': 'text/html' } });
    if (homeResp.ok) {
      const homeHtml = await homeResp.text();
      navStructure = extractNavStructure(homeHtml, origin + '/');
    }
  } catch (_) {}
  return { urls: unique, sampleStats, totalDetected, parentMap: null, navStructure };
}

async function discoverViaCrawl(origin, startUrl) {
  const visited = new Set();
  const found = new Set();
  const queue = [startUrl];
  const maxPages = 200;  // Safety limit
  const maxDepth = 3;    // Don't go too deep
  const depthMap = new Map();
  const parentMap = {};  // child URL → URL of page that first linked to it (null for startUrl)
  depthMap.set(startUrl, 0);
  parentMap[startUrl] = null;
  const sampler = createSharedSampler();
  const NAV_PARSE_LIMIT = 5;
  let navParsedCount = 0;
  const navSamples = [];

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

      // Extract nav structure from first few pages (it's consistent site-wide)
      if (navParsedCount < NAV_PARSE_LIMIT) {
        try {
          const pageNav = extractNavStructure(html, url);
          if (pageNav) { navSamples.push(pageNav); navParsedCount++; }
        } catch (_) {} // Never let nav parsing break the crawl
      }

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
          if (!(clean in parentMap)) parentMap[clean] = url;
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
  // Only keep parentMap entries for URLs we actually kept (saves payload, keeps tree clean).
  const keptParents = {};
  for (const u of unique) if (u in parentMap) keptParents[u] = parentMap[u];
  sendDiscoverProgress(`Done: ${unique.length} kept (${totalDetected.toLocaleString()} detected, ${totalSkipped.toLocaleString()} collapsed into samples)`);
  const navStructure = mergeNavSamples(navSamples);
  return { urls: unique, sampleStats, totalDetected, parentMap: keptParents, navStructure };
}

function sendDiscoverProgress(text) {
  // Mirror progress into the persisted state so a popup opened later can
  // pick up the current text via DISCOVER_STATE polling.
  discoveryState.progressText = text;
  persistDiscoveryState();

  // Also push a live notification to any open popup. Swallow the async
  // "no receiver" rejection when no popup is listening.
  try {
    const p = chrome.runtime.sendMessage({ action: 'DISCOVER_PROGRESS', text, count: 0 });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) {}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Page Review ──

  if (message.action === 'START_AUDIT') {
    const { vertical, pageType, mode, device = 'desktop', projectId } = message;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
      }

      const tabId = tabs[0].id;
      const tabUrl = tabs[0].url;

      try {
        let result;

        if (device === 'compare') {
          // ── Compare mode: desktop audit first, then mobile emulation ──
          const desktopResult = await runAuditSilent(tabId, tabUrl, vertical, mode, '100', pageType);
          if (!desktopResult.success) {
            sendResponse(desktopResult);
            return;
          }

          let mobileResult = { success: false, findings: [], results: null };
          try {
            mobileResult = await withMobileEmulation(tabId, DEVICE_PROFILES.mobile, (tid) =>
              runAuditSilent(tid, tabUrl, vertical, 'viewport', '100', pageType, 'mobile')
            );
          } catch (e) {
            // Mobile emulation failed — still show desktop results
            mobileResult = { success: false, error: e.message, results: null };
          }

          const compareResults = {
            version: '1.0',
            compareMode: true,
            meta: {
              url: desktopResult.results.meta.url,
              title: desktopResult.results.meta.title,
              vertical,
              pageType: pageType || null,
              device: 'compare',
              captureMode: mode,
              timestamp: Date.now()
            },
            desktop: desktopResult.results,
            mobile: mobileResult.success ? mobileResult.results : null,
            screenshot: desktopResult.results.screenshot,
            findings: desktopResult.results.findings
          };

          await chrome.storage.local.set({ echoflowResults: compareResults });
          await chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });

          sendResponse({
            success: true,
            findingCount: desktopResult.results.findings.length,
            desktopCount: desktopResult.results.findings.length,
            mobileCount: mobileResult.success ? mobileResult.results.findings.length : 0
          });
          return;

        } else if (device === 'mobile' || device === 'tablet') {
          // ── Mobile / Tablet emulation mode ──
          const profile = DEVICE_PROFILES[device];
          result = await withMobileEmulation(tabId, profile, (tid) =>
            runAudit(tid, tabUrl, vertical, mode, '100', pageType, device)
          );

        } else {
          // ── Desktop: current tab, current viewport ──
          result = await runAudit(tabId, tabUrl, vertical, mode, '100', pageType, 'desktop');
        }

        // Auto-save to project if one is active
        if (projectId && result?.success && result.results) {
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
          } catch (_) {}
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

  if (message.action === 'AI_SPECIALIST') {
    // Specialist analyses (dark-patterns, copy-intelligence) — Claude only
    runSpecialistAnalysis(message.mode, message.data, message.apiKey)
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

    // Reject if a discovery is already running — the user would have to stop
    // it first. The popup's auto-hydration normally prevents this; this is
    // just a safety net for duplicate clicks.
    if (discoveryState.status === 'running' || discoveryState.status === 'stopping') {
      sendResponse({ success: false, error: 'Discovery already running', alreadyRunning: true });
      return true;
    }

    discoverStopped = false;
    discoveryState = {
      status: 'running',
      method, origin, startUrl,
      progressText: method === 'sitemap' ? 'Fetching sitemap...' : 'Crawling links...',
      result: null,
      error: null,
      startedAt: Date.now(),
      finishedAt: null
    };
    persistDiscoveryState();

    // Fire and forget — the popup no longer awaits this. It polls DISCOVER_STATE.
    (async () => {
      try {
        let result = { urls: [], sampleStats: {}, totalDetected: 0 };
        if (method === 'sitemap') {
          result = await discoverViaSitemap(origin);
        } else if (method === 'crawl') {
          result = await discoverViaCrawl(origin, startUrl);
        }
        discoveryState.status = discoverStopped ? 'stopped' : 'completed';
        discoveryState.result = {
          urls: result.urls,
          sampleStats: result.sampleStats || {},
          totalDetected: result.totalDetected || result.urls.length,
          parentMap: result.parentMap || null,
          navStructure: result.navStructure || null
        };
        discoveryState.finishedAt = Date.now();
        await persistDiscoveryState();

        // Auto-save to Explorations (only on completed crawls, not stopped/errored)
        if (!discoverStopped && result.urls.length > 0) {
          await saveExploration({
            siteUrl: origin,
            method,
            pageCount: result.totalDetected || result.urls.length,
            result: discoveryState.result
          });
        }
      } catch (err) {
        discoveryState.status = 'error';
        discoveryState.error = err.message || String(err);
        discoveryState.finishedAt = Date.now();
        await persistDiscoveryState();
      }
    })();

    sendResponse({ success: true, started: true });
    return true;
  }

  if (message.action === 'DISCOVER_STATE') {
    // If the popup is asking for state and discovery is finished, the user has
    // seen the result — clear the toolbar badge so it doesn't linger.
    clearDiscoveryBadgeIfTerminal();
    sendResponse({ success: true, state: discoveryState });
    return true;
  }

  if (message.action === 'DISCOVER_STOP') {
    discoverStopped = true;
    if (discoveryState.status === 'running') {
      discoveryState.status = 'stopping';
      persistDiscoveryState();
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'DISCOVER_CLEAR') {
    // Resets finished/error/stopped state back to idle so the popup returns
    // to its initial "click Sitemap or Crawl" UI. Does nothing if a
    // discovery is actively running.
    if (discoveryState.status !== 'running' && discoveryState.status !== 'stopping') {
      discoveryState = {
        status: 'idle',
        method: null, origin: null, startUrl: null,
        progressText: '', result: null, error: null,
        startedAt: null, finishedAt: null
      };
      persistDiscoveryState();
    }
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

  // ── Whole-Site Adapt: analyze one page (called per-page from popup) ──

  if (message.action === 'RUN_WHOLE_SITE_ADAPT_PAGE') {
    (async () => {
      try {
        const { url, templateType, templateLabel } = message;

        // Get the active tab to reuse for navigation
        const tabs = await new Promise(resolve =>
          chrome.tabs.query({ active: true, currentWindow: true }, resolve)
        );
        if (!tabs[0]) {
          sendResponse({ success: false, error: 'No active tab' });
          return;
        }
        const tabId = tabs[0].id;

        // Navigate to the sample URL
        await chrome.tabs.update(tabId, { url });
        await waitForTabLoad(tabId);
        await sleep(600);

        // Inject and run adapt analysis
        await chrome.scripting.executeScript({ target: { tabId }, files: ['shopify-adapt.js'] });
        await sleep(300);

        const adaptResult = await chrome.tabs.sendMessage(tabId, { action: 'SHOPIFY_ADAPT_ANALYZE' });
        if (!adaptResult?.success) {
          sendResponse({ success: false, error: adaptResult?.error || 'Analysis failed' });
          return;
        }

        const adaptData = adaptResult.data;

        // Load knowledge base (cached after first call via module-level const)
        const [sectionsData, componentsData] = await Promise.all([
          fetch(chrome.runtime.getURL('knowledge-base/shopify-adapt/sections.json')).then(r => r.json()),
          fetch(chrome.runtime.getURL('knowledge-base/shopify-adapt/components.json')).then(r => r.json())
        ]);

        const sectionMappings  = mapRegionsToShopify(adaptData.regions, sectionsData.sections);
        const componentMappings = mapComponentsToShopify(adaptData.components, componentsData.components);

        sendResponse({
          success: true,
          data: {
            templateType,
            templateLabel,
            url: adaptData.url,
            pageType: adaptData.pageType,
            platform: adaptData.platform,
            sectionMappings,
            componentMappings,
            complexitySignals: adaptData.complexitySignals,
            shopifyDetails: adaptData.shopifyDetails || null
          }
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── Whole-Site Adapt: aggregate + open results ──

  if (message.action === 'OPEN_WHOLE_SITE_RESULTS') {
    (async () => {
      try {
        const { pages, origin } = message;

        // Aggregate unique sections and components across all pages
        const allSections   = new Map();  // shopifySection → {count, pages[], status}
        const allComponents = new Map();  // type → {count, pages[], mapping}
        let dominantPlatform = 'custom-ecommerce';
        let shopifyDetails = null;

        for (const page of pages) {
          if (page.platform && page.platform !== 'custom-ecommerce') dominantPlatform = page.platform;
          if (page.shopifyDetails) shopifyDetails = page.shopifyDetails;

          for (const sm of (page.sectionMappings || [])) {
            if (sm.isLayout) continue;
            const key = sm.shopifyMapping?.shopifySection || sm.type;
            if (!allSections.has(key)) {
              allSections.set(key, { ...sm, count: 0, pages: [] });
            }
            const entry = allSections.get(key);
            entry.count++;
            entry.pages.push(page.templateLabel);
          }

          for (const cm of (page.componentMappings || [])) {
            if (!allComponents.has(cm.type)) {
              allComponents.set(cm.type, { ...cm, count: 0, pages: [] });
            }
            const entry = allComponents.get(cm.type);
            entry.count++;
            entry.pages.push(page.templateLabel);
          }
        }

        // Load platform/migration data
        const [platformData, migrationData] = await Promise.all([
          fetch(chrome.runtime.getURL('knowledge-base/shopify-adapt/platform.json')).then(r => r.json()),
          fetch(chrome.runtime.getURL('knowledge-base/shopify-adapt/migration-patterns.json')).then(r => r.json())
        ]);

        const results = {
          version: '1.5',
          mode: 'shopify-adapt',
          wholeSite: true,
          meta: {
            url: origin,
            title: `Whole-Site Analysis — ${origin}`,
            pageType: 'multi-page',
            platform: dominantPlatform,
            timestamp: Date.now(),
            pageCount: pages.length
          },
          screenshot: null,
          regions: [],
          components: [],
          sectionMappings:  Array.from(allSections.values()),
          componentMappings: Array.from(allComponents.values()),
          complexitySignals: pages[0]?.complexitySignals || {},
          shopifyDetails,
          platformMigration: migrationData.platforms[dominantPlatform] || migrationData.platforms['custom-ecommerce'],
          platformConstraints: platformData,
          pages // raw per-page data for drill-down
        };

        await chrome.storage.local.set({ echoflowResults: results });
        await chrome.tabs.create({ url: chrome.runtime.getURL('results.html') + '?mode=shopify-adapt' });

        sendResponse({ success: true, pageCount: pages.length });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── Journey Audit ──

  if (message.action === 'START_JOURNEY') {
    (async () => {
      try {
        const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
        const tab = tabs[0];
        if (!tab) { sendResponse({ success: false, error: 'No active tab' }); return; }

        const journeyState = {
          recording: true,
          tabId: tab.id,
          vertical: message.vertical || 'generic-ux',
          startedAt: Date.now(),
          steps: []
        };
        await chrome.storage.local.set({ echoflowJourney: journeyState });

        // Capture the starting page immediately
        await captureJourneyStep(tab.id, tab.url, tab.title);

        sendResponse({ success: true, tabId: tab.id });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'STOP_JOURNEY') {
    (async () => {
      try {
        const { echoflowJourney } = await chrome.storage.local.get('echoflowJourney');
        if (!echoflowJourney) { sendResponse({ success: false, error: 'No journey in progress' }); return; }
        echoflowJourney.recording = false;
        echoflowJourney.stoppedAt = Date.now();
        await chrome.storage.local.set({ echoflowJourney });
        sendResponse({ success: true, steps: echoflowJourney.steps });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'JOURNEY_STATUS') {
    (async () => {
      try {
        const { echoflowJourney } = await chrome.storage.local.get('echoflowJourney');
        sendResponse({ success: true, journey: echoflowJourney || null });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'JOURNEY_CLEAR') {
    chrome.storage.local.remove('echoflowJourney', () => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'ANALYZE_JOURNEY') {
    (async () => {
      try {
        const { steps, apiKey, vertical } = message;
        if (!steps || steps.length === 0) {
          sendResponse({ success: false, error: 'No steps to analyze' }); return;
        }
        const result = await analyzeJourney(steps, apiKey, vertical);
        sendResponse(result);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'JOURNEY_CAPTURE_STEP') {
    (async () => {
      try {
        const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
        const tab = tabs[0];
        if (!tab) { sendResponse({ success: false, error: 'No active tab' }); return; }

        const { echoflowJourney } = await chrome.storage.local.get('echoflowJourney');
        if (!echoflowJourney?.recording) { sendResponse({ success: false, error: 'Not recording' }); return; }

        await captureJourneyStep(tab.id, tab.url, tab.title);
        const updated = await chrome.storage.local.get('echoflowJourney');
        sendResponse({ success: true, stepCount: updated.echoflowJourney?.steps?.length || 0 });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── Live Design Scan (sidebar inline mode) ──

  if (message.action === 'LIVE_DESIGN_SCAN') {
    (async () => {
      try {
        const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
        const tab = tabs[0];
        if (!tab || !tab.url || tab.url.startsWith('chrome') || tab.url.startsWith('chrome-extension')) {
          sendResponse({ success: false, error: 'Cannot scan this page.' }); return;
        }

        // Inject content script (idempotent — content.js guards with __echoflowInjected)
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        await sleep(200);

        const result = await chrome.tabs.sendMessage(tab.id, { action: 'CAPTURE_DESIGN_INVENTORY' });
        if (!result?.success) {
          sendResponse({ success: false, error: result?.error || 'Design scan failed' }); return;
        }

        sendResponse({
          success: true,
          url: tab.url,
          title: tab.title,
          inventory: result.inventory
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── Frame-options check (can this URL be embedded in an iframe?) ──
  if (message.action === 'CHECK_FRAME_OPTIONS') {
    (async () => {
      try {
        const resp = await fetch(message.url, { method: 'HEAD', redirect: 'follow' });
        const xfo = resp.headers.get('x-frame-options') || '';
        const csp = resp.headers.get('content-security-policy') || '';
        const xfoDenied = /deny|sameorigin/i.test(xfo);
        // frame-ancestors 'none' or frame-ancestors that doesn't include * / chrome-extension:
        const cspDenied = csp.includes('frame-ancestors') &&
          !csp.includes('frame-ancestors *') &&
          !csp.includes('frame-ancestors \'*\'');
        sendResponse({ blocked: xfoDenied || cspDenied, xfo, csp });
      } catch (_) {
        // Network error or CORS — assume not blocked, let the iframe try
        sendResponse({ blocked: false });
      }
    })();
    return true;
  }

  // ── On-demand Screenshot ──
  if (message.action === 'TAKE_SCREENSHOT') {
    (async () => {
      // The results page IS the sender tab — we must exclude it when searching
      // for the audited page, then temporarily switch to it so captureVisibleTab
      // captures the right thing.
      const senderTabId = sender.tab?.id;

      try {
        const { url, mode } = message;
        const allTabs = await chrome.tabs.query({});
        const baseUrl  = url.split('?')[0].split('#')[0];

        // Find the audited page tab (never the results page itself)
        const targetTab = allTabs.find(t =>
          t.id !== senderTabId &&
          t.url && (t.url === url || t.url.startsWith(baseUrl))
        );

        if (!targetTab) {
          sendResponse({ success: false, error: 'The audited page is no longer open. Navigate back to it and try again.' });
          return;
        }

        // Remember which tab/window to return to
        const returnTabId    = senderTabId;
        const returnWindowId = sender.tab?.windowId;

        // Switch focus to the audited page so captureVisibleTab picks it up
        await chrome.windows.update(targetTab.windowId, { focused: true });
        await chrome.tabs.update(targetTab.id, { active: true });
        await sleep(350); // let the tab paint

        const screenshot = mode === 'full_page'
          ? await captureFullPage(targetTab.id)
          : await captureViewport(targetTab.id, '100');

        // Switch back to the results page
        if (returnTabId) {
          await chrome.windows.update(returnWindowId, { focused: true });
          await chrome.tabs.update(returnTabId, { active: true });
        }

        sendResponse({ success: true, screenshot });
      } catch (err) {
        // Always try to return focus even on error
        if (senderTabId) {
          try { await chrome.tabs.update(senderTabId, { active: true }); } catch (_) {}
        }
        sendResponse({ success: false, error: err.message });
      }
    })();
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

    const layout = inv.layoutSystem;
    const layoutSection = layout ? `
- Layout engines: ${layout.layoutEngines?.flex || 0}% Flex, ${layout.layoutEngines?.grid || 0}% Grid, ${layout.layoutEngines?.block || 0}% Block
- Spacing base unit: ${layout.spacingBase ? layout.spacingBase + 'px' : 'not detected'}
- Column patterns: ${(layout.columnPatterns || []).map(p => p.pattern + ' (×' + p.count + ')').join(', ') || 'none'}
- Gap/gutter values: ${(layout.gapValues || []).map(g => g.value).slice(0, 5).join(', ') || 'none'}
- Container max-widths: ${(layout.containerWidths || []).map(c => c.value + 'px').join(', ') || 'none'}` : '';

    designSection = `

Design inventory:
- Fonts: ${topFonts || 'none detected'}
- Font sizes: ${sizes || 'none'}
- Color palette: ${topColors || 'none'}
- Spacing: ${gridRatio}% on 4px grid, ${(inv.spacingValues || []).length} unique values
- Border-radius: ${radii || 'none'}
- Shadows: ${shadowCount} unique styles${layoutSection}`;
  }

  // Check if screenshot will be included (vision layer active)
  const hasScreenshot = auditData.screenshot && auditData.screenshot.startsWith('data:image/') &&
    auditData.screenshot.length < 4_000_000;
  const visionNote = hasScreenshot
    ? '\nA screenshot of the page is attached — use it to assess visual hierarchy, CTA prominence, whitespace quality, image effectiveness, and layout balance. Reference what you observe visually.'
    : '';

  prompt += `${visionNote}

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
5. Visual design assessment${hasScreenshot ? ' (use the screenshot to assess visually)' : ''}:
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

  // ── Vision Layer: include screenshot as image block if available ──
  let messageContent;
  const screenshot = auditData.screenshot;
  if (screenshot && screenshot.startsWith('data:image/')) {
    // Extract base64 data from data URL: data:image/jpeg;base64,<data>
    const commaIdx = screenshot.indexOf(',');
    const base64Data = screenshot.substring(commaIdx + 1);
    const mediaType = screenshot.substring(5, screenshot.indexOf(';')); // e.g. "image/jpeg"

    // Only include if reasonably sized (< 4MB base64 ≈ 3MB image)
    if (base64Data.length < 4_000_000) {
      messageContent = [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64Data }
        },
        { type: 'text', text: prompt }
      ];
    } else {
      messageContent = prompt;
    }
  } else {
    messageContent = prompt;
  }

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
      max_tokens: 1800,
      messages: [{ role: 'user', content: messageContent }]
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

// ── Dark Pattern Detector Prompt ──

function buildDarkPatternPrompt(auditData) {
  const meta = auditData.meta;
  const raw = auditData.rawData;

  const headingsText = (raw.headings || []).map(h => `H${h.level}: ${h.text}`).join('\n');
  const linksText = (raw.links || [])
    .filter(l => l.text && l.text.trim())
    .map(l => `"${l.text.trim()}"`)
    .slice(0, 60)
    .join(', ');
  const formsText = (raw.forms || []).map((f, i) => {
    const fieldNames = (f.fields || []).map(fi => fi.label || fi.name || fi.type || '?').join(', ');
    return `Form ${i + 1}: [${fieldNames}]`;
  }).join('\n');

  return `You are a dark pattern auditor and consumer protection specialist. Analyze this ${meta.vertical} page for manipulative UI patterns under EU and US regulations.

URL: ${meta.url}
Page type: ${(meta.pageType || 'unknown').replace(/-/g, ' ')}
Page title: ${meta.title}

PAGE HEADINGS:
${headingsText || '(none)'}

BUTTON / LINK TEXT (sample):
${linksText || '(none)'}

FORMS:
${formsText || '(none)'}

DARK PATTERNS CHECKLIST — evaluate each for evidence on this page:

EU Regulatory Framework:
- DSA Art. 25: Deceptive interface design prohibited
- GDPR Art. 7: Freely given, specific, informed consent
- EU Consumer Rights Directive: Clear pricing, no hidden fees

US Regulatory Framework:
- FTC Act Section 5: Unfair or deceptive acts
- FTC "Bringing Dark Patterns to Light" (2022 report)
- California CCPA/CPRA: Opt-out must be as easy as opt-in
- FTC Endorsement Guides: Native ads must be clearly labeled

PATTERNS TO ASSESS:
1. Confirmshaming — dismiss/opt-out text uses guilt or shame ("No thanks, I hate saving money")
2. Pre-checked consent boxes — consent/marketing opt-ins pre-selected
3. Urgency/scarcity fabrication — fake countdown timers, unverifiable "Only N left!" claims
4. Hidden unsubscribe / Roach Motel — easy to subscribe, difficult to cancel or opt out
5. Forced continuity — free trial auto-converts to paid without clear notice
6. Hidden costs — fees, taxes, or shipping revealed only at checkout
7. Trick questions — confusing double-negative opt-in/out language in forms
8. Disguised ads / native advertising — paid/sponsored content not clearly labeled
9. Basket sneaking — items added to cart without explicit user action
10. Bait-and-switch — advertised price or product differs from what's actually available
11. Nagging / guilt-tripping — repeated requests after user declined
12. Privacy Zuckering — burying or obscuring privacy settings / data collection scope

RESPONSE FORMAT — return valid JSON only, no markdown wrapper:
{
  "summary": "1-2 sentence overall assessment",
  "riskLevel": "low|medium|high|critical",
  "patternsFound": [
    {
      "pattern": "Pattern name",
      "evidence": "Specific text or element found on the page",
      "severity": "low|medium|high|critical",
      "euRegulation": "Relevant EU law/article or null",
      "usRegulation": "Relevant US law/regulation or null",
      "recommendation": "Specific fix"
    }
  ],
  "patternsClear": ["List of patterns checked that appear clean"],
  "complianceNotes": "Brief note on overall compliance posture"
}`;
}

// ── Copy Intelligence Prompt ──

function buildCopyPrompt(auditData) {
  const meta = auditData.meta;
  const raw = auditData.rawData;

  const headingsText = (raw.headings || []).map(h => `H${h.level}: ${h.text}`).join('\n');
  const ctasText = (raw.links || [])
    .filter(l => {
      const t = (l.text || '').trim().toLowerCase();
      return t && t.length < 60 && (
        l.isButton ||
        /buy|shop|add|cart|checkout|get|start|try|sign|join|learn|discover|explore|view|see|read|download|book|order|reserve|claim|grab|save|unlock/i.test(t)
      );
    })
    .map(l => `"${l.text.trim()}"`)
    .slice(0, 30)
    .join(', ');

  const formLabels = (raw.forms || []).flatMap(f =>
    (f.fields || []).map(fi => fi.label || fi.placeholder || fi.name).filter(Boolean)
  ).slice(0, 20).join(', ');

  return `You are an expert conversion copywriter and UX content strategist. Analyze the copy and messaging on this ${meta.vertical} page.

URL: ${meta.url}
Page type: ${(meta.pageType || 'unknown').replace(/-/g, ' ')}
Page title: ${meta.title}

PAGE HEADINGS (in order):
${headingsText || '(none detected)'}

CALLS TO ACTION (buttons and key links):
${ctasText || '(none detected)'}

FORM FIELDS / MICROCOPY:
${formLabels || '(none detected)'}

Evaluate the copy across these 7 dimensions. Score each 1–10 (10 = excellent):

1. VALUE PROPOSITION CLARITY — Is the primary benefit/offer immediately clear within 5 seconds?
2. CTA EFFECTIVENESS — Are CTAs specific, action-oriented, and benefit-led? Avoid generic "Click here" or "Submit"
3. HEADLINE IMPACT — Do headlines communicate unique value or just describe features?
4. READING LEVEL — Estimate Flesch-Kincaid grade level. Is it appropriate for the audience?
5. TRUST SIGNALS — Social proof, guarantees, certifications, reviews — are they prominent and specific?
6. MICROCOPY QUALITY — Form labels, placeholder text, error messages, helper text — clear and reassuring?
7. EMOTIONAL RESONANCE — Does copy speak to user motivations, fears, or desires beyond functional benefits?

RESPONSE FORMAT — return valid JSON only, no markdown wrapper:
{
  "overallScore": <number 1-10>,
  "overallSummary": "2-3 sentence overall assessment",
  "dimensions": [
    {
      "name": "Dimension name",
      "score": <number 1-10>,
      "finding": "What was found — quote specific copy when possible",
      "recommendation": "Specific, actionable improvement"
    }
  ],
  "topWins": ["List of 2-3 copy elements that are working well"],
  "topFixes": ["List of 3 highest-priority copy improvements"],
  "readingLevel": "Grade N — <description of who this suits>",
  "rewriteSuggestions": [
    {
      "original": "exact text from page",
      "rewrite": "improved version",
      "reason": "why this works better"
    }
  ]
}

Provide up to 3 rewrite suggestions for the weakest copy elements.`;
}

// ── Specialist Analysis Runner ──

async function runSpecialistAnalysis(mode, auditData, apiKey) {
  if (!apiKey) {
    return { success: false, error: 'No Claude API key configured. Go to Settings.' };
  }

  const prompt = mode === 'dark-patterns'
    ? buildDarkPatternPrompt(auditData)
    : buildCopyPrompt(auditData);

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
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: 'Claude API error: ' + response.status + ' — ' + err };
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '{}';

  // Parse JSON response
  try {
    const parsed = JSON.parse(text);
    return { success: true, mode, result: parsed };
  } catch {
    // If JSON parsing fails, return raw text
    return { success: true, mode, result: { raw: text } };
  }
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

// Open the side panel when the extension icon is clicked (sidebar-only mode)
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  updateKnowledgeBase();
  chrome.alarms.create('updateKnowledgeBase', { periodInMinutes: 1440 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'updateKnowledgeBase') {
    updateKnowledgeBase();
  }
});

// ── Journey Audit ──

// Persistent tabs.onUpdated listener — auto-captures each page load during a recording session.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || tab.url.startsWith('chrome') || tab.url.startsWith('chrome-extension')) return;
  try {
    const { echoflowJourney } = await chrome.storage.local.get('echoflowJourney');
    if (!echoflowJourney?.recording) return;
    if (echoflowJourney.tabId !== tabId) return;
    await captureJourneyStep(tabId, tab.url, tab.title);
  } catch (_) {}
});

/**
 * Capture a snapshot of the current page state and append it to the journey steps.
 * Lightweight — only collects structural DOM data, no screenshots.
 */
async function captureJourneyStep(tabId, url, title) {
  const { echoflowJourney } = await chrome.storage.local.get('echoflowJourney');
  if (!echoflowJourney) return;

  // Avoid duplicate steps for same URL (e.g. SPA hash changes)
  const steps = echoflowJourney.steps || [];
  const last = steps[steps.length - 1];
  if (last && last.url === url) return;

  let stepData = {
    stepNumber: steps.length + 1,
    url,
    title: title || url,
    timestamp: Date.now(),
    headings: [],
    forms: [],
    ctaCount: 0,
    linkCount: 0,
    viewport: { width: 0, height: 0 },
    errorMessages: [],
    loadTime: null
  };

  try {
    await sleep(600); // Wait for page to settle after load
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
          .slice(0, 6)
          .map(h => ({ level: h.tagName, text: h.innerText?.trim().slice(0, 120) || '' }))
          .filter(h => h.text);

        const forms = Array.from(document.querySelectorAll('form')).map(form => ({
          id: form.id || form.name || '',
          action: form.action || '',
          fields: Array.from(form.querySelectorAll('input:not([type="hidden"]),select,textarea'))
            .map(f => ({ type: f.type || f.tagName.toLowerCase(), name: f.name || f.placeholder || f.id || '' }))
            .slice(0, 10)
        })).slice(0, 5);

        const ctaSelectors = ['button[type="submit"]','a.btn','a.button','.cta','[class*="cta"]',
          'button:not([type="button"]):not([type="reset"])'];
        const ctaCount = new Set(document.querySelectorAll(ctaSelectors.join(','))).size;

        const linkCount = document.querySelectorAll('a[href]').length;

        const errorMessages = Array.from(document.querySelectorAll(
          '[class*="error"],[class*="alert"],[role="alert"],[aria-live="assertive"]'
        )).map(el => el.innerText?.trim().slice(0, 100)).filter(Boolean).slice(0, 3);

        return {
          headings,
          forms,
          ctaCount,
          linkCount,
          errorMessages,
          viewport: { width: window.innerWidth, height: window.innerHeight }
        };
      }
    });

    if (result?.result) {
      Object.assign(stepData, result.result);
    }
  } catch (_) {
    // Scripting may fail on restricted pages — keep bare-minimum step data
  }

  steps.push(stepData);
  echoflowJourney.steps = steps;
  await chrome.storage.local.set({ echoflowJourney });
}

/**
 * Build the AI prompt for Journey analysis.
 */
function buildJourneyPrompt(steps, vertical) {
  const stepsText = steps.map(s => {
    const headings = s.headings.map(h => `${h.level}: "${h.text}"`).join(', ');
    const forms = s.forms.map(f =>
      `Form (${f.fields.map(field => field.name || field.type).join(', ')})`
    ).join('; ');
    const errors = s.errorMessages.length ? `⚠️ Errors: ${s.errorMessages.join(' | ')}` : '';
    return [
      `Step ${s.stepNumber}: ${s.url}`,
      `  Title: "${s.title}"`,
      headings ? `  Headings: ${headings}` : '',
      `  CTAs: ${s.ctaCount} | Links: ${s.linkCount}`,
      forms ? `  ${forms}` : '',
      errors ? `  ${errors}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return `You are a senior UX auditor specializing in ${vertical} user journeys.

The user recorded the following browsing session across ${steps.length} pages:

${stepsText}

Analyze this journey and return your findings as a JSON object with this exact structure:
{
  "flowScore": <number 0-100, overall flow quality>,
  "summary": "<2-3 sentence overview of the journey>",
  "frictionPoints": [
    { "step": <stepNumber>, "title": "<short title>", "description": "<what's broken or confusing>", "severity": "high|medium|low" }
  ],
  "consistencyIssues": [
    { "title": "<short title>", "description": "<inconsistency across steps>", "steps": [<step numbers>] }
  ],
  "positives": [
    "<one thing done well>"
  ],
  "recommendations": [
    { "priority": "high|medium|low", "title": "<action>", "description": "<specific fix>" }
  ]
}

Focus on: navigation clarity, form usability, CTA placement, error handling, content hierarchy, and flow continuity.
Return ONLY the JSON object, no markdown fences, no preamble.`;
}

/**
 * Run AI analysis on a recorded journey.
 */
async function analyzeJourney(steps, apiKey, vertical) {
  if (!apiKey) {
    return { success: false, error: 'No Claude API key configured. Go to Settings → Claude API Key.' };
  }

  const prompt = buildJourneyPrompt(steps, vertical);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: 'Claude API error: ' + response.status + ' — ' + err.slice(0, 200) };
  }

  const data = await response.json();
  const raw = data.content?.[0]?.text || '';

  let analysis;
  try {
    analysis = JSON.parse(raw);
  } catch (_) {
    // Try extracting JSON from response
    const match = raw.match(/\{[\s\S]+\}/);
    if (match) {
      try { analysis = JSON.parse(match[0]); }
      catch (__) { return { success: false, error: 'Could not parse AI response as JSON.' }; }
    } else {
      return { success: false, error: 'AI returned unexpected format.' };
    }
  }

  // Store results and open results page
  const journeyResults = {
    version: '1.0',
    mode: 'journey',
    meta: {
      url: steps[0]?.url || '',
      title: 'Journey Audit — ' + (steps[0]?.title || steps[0]?.url || ''),
      timestamp: Date.now(),
      vertical,
      stepCount: steps.length
    },
    steps,
    analysis
  };

  await chrome.storage.local.set({ echoflowResults: journeyResults });
  await chrome.tabs.create({ url: chrome.runtime.getURL('results.html') + '?mode=journey' });

  return { success: true };
}
