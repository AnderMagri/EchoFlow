// EchoFlow Background Service Worker
// Orchestrates audit flow: content injection, API fetches, rule evaluation.

import { evaluateRules, extractSelectors } from './engine.js';

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

  return { success: true, findingCount: findings.length };
}

// ── Message Handler ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_AUDIT') {
    const { vertical, pageType, mode, resolution } = message;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
      }
      try {
        const result = await runAudit(tabs[0].id, tabs[0].url, vertical, mode, resolution, pageType);
        sendResponse(result);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    });

    return true; // Keep channel open for async
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
