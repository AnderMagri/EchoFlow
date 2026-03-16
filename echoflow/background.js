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

async function captureScreenshot(tabId, resolution) {
  // resolution: '100' = standard, '120' = high-res (1.2x)
  const scale = resolution === '120' ? 1.2 : 1.0;

  if (scale !== 1.0) {
    // Temporarily zoom the tab for higher resolution capture
    const originalZoom = await chrome.tabs.getZoom(tabId);
    await chrome.tabs.setZoom(tabId, scale);
    await sleep(400); // Let the page re-render at new zoom
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'jpeg',
      quality: 95
    });
    await chrome.tabs.setZoom(tabId, originalZoom);
    return dataUrl;
  }

  return chrome.tabs.captureVisibleTab(null, {
    format: 'jpeg',
    quality: 90
  });
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

async function runAudit(tabId, tabUrl, vertical, mode, resolution) {
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

  // Step 7: Capture viewport screenshot (local proof only — never sent to AI)
  const screenshot = await captureScreenshot(tabId, resolution);

  // Step 8: Evaluate rules
  const findings = evaluateRules(rules, domData);

  // Step 9: Assemble results
  const results = {
    version: '1.0',
    meta: {
      url: domData.url,
      title: domData.title,
      vertical: vertical,
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
    }
  };

  // Step 10: Store results and open results page
  await chrome.storage.local.set({ echoflowResults: results });
  await chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });

  return { success: true, findingCount: findings.length };
}

// ── Message Handler ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_AUDIT') {
    const { vertical, mode, resolution } = message;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
      }
      try {
        const result = await runAudit(tabs[0].id, tabs[0].url, vertical, mode, resolution);
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
    runAIAnalysis(message.data, message.apiKey)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ── AI Analysis via Claude API ──

async function runAIAnalysis(auditData, apiKey) {
  if (!apiKey) {
    return { success: false, error: 'No API key configured. Go to Settings.' };
  }

  const findingsText = auditData.findings.map(f =>
    `${f.number}. [${f.category}] ${f.description} (ICE: I:${f.ice.impact} C:${f.ice.confidence} E:${f.ice.ease})`
  ).join('\n');

  const sectionsList = (auditData.sections || []).map(s =>
    `- ${s.type || s.id || 'unknown'} (${Math.round(s.position.height)}px tall)`
  ).join('\n');

  const prompt = `You are a UX auditor analyzing a ${auditData.meta.vertical} website.

URL: ${auditData.meta.url}
Page title: ${auditData.meta.title}
Viewport: ${auditData.meta.viewport.width}x${auditData.meta.viewport.height}

Page sections:
${sectionsList || 'No sections detected'}

Rule-based findings:
${findingsText || 'No rule-based findings'}

Raw stats: ${auditData.rawData.elementCount} elements, ${auditData.rawData.imageCount} images, ${auditData.rawData.linkCount} links, ${auditData.rawData.forms?.length || 0} forms

Provide a concise UX analysis:
1. Top 5 priority issues with specific, actionable fixes
2. Quick wins (high ease, high impact)
3. Any patterns or issues the rules may have missed
4. Overall UX score (1-10) with brief justification

Be direct and specific. Reference element positions and types.`;

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
    return { success: false, error: 'API error: ' + response.status + ' — ' + err };
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || 'No response';

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
