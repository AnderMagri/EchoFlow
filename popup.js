// EchoFlow Popup Script
// Handles 3-tab layout, vertical/mode selection, audit triggering,
// project management, batch audits, and Shopify Migration.

document.addEventListener('DOMContentLoaded', () => {
  const capturePanel = document.getElementById('capture-panel');
  const errorPanel = document.getElementById('error-panel');
  const runBtn = document.getElementById('run-audit-btn');
  const loadBtn = document.getElementById('load-audit-btn');
  const fileInput = document.getElementById('file-input');
  const statusEl = document.getElementById('status');
  const btnText = runBtn.querySelector('.btn-text');
  const btnSpinner = runBtn.querySelector('.btn-spinner');

  let selectedVertical = 'generic-ux';
  let selectedDevice = 'desktop';

  // ══════════════════════════════════════════════
  //  Tab Switching
  // ══════════════════════════════════════════════

  document.querySelectorAll('.popup-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.popup-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.popup-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById('tab-' + tab.dataset.popupTab);
      if (target) target.classList.add('active');

      // Load project list when switching to project tab
      if (tab.dataset.popupTab === 'project-review') {
        loadProjectList();
      }
      // Load explorations when switching to explorer tab
      if (tab.dataset.popupTab === 'explorer') {
        loadExplorerTab();
      }
      // Warn if the current site is already on Shopify
      if (tab.dataset.popupTab === 'shopify-adapt') {
        maybeWarnShopifyMigration();
      }
    });
  });

  // ══════════════════════════════════════════════
  //  Page Review Tab (existing functionality)
  // ══════════════════════════════════════════════

  const PAGE_TYPES = {
    'shopify': [
      { value: 'homepage', label: 'Homepage' },
      { value: 'pdp', label: 'Product Detail Page (PDP)' },
      { value: 'collection', label: 'Collection Page' },
      { value: 'checkout', label: 'Checkout' },
      { value: 'landing', label: 'Landing Page' },
      { value: 'other', label: 'Other' }
    ],
    'fintech': [
      { value: 'dashboard', label: 'Dashboard' },
      { value: 'onboarding', label: 'Onboarding / KYC' },
      { value: 'portfolio', label: 'Portfolio Overview' },
      { value: 'transactions', label: 'Transaction History' },
      { value: 'payment', label: 'Payment / Transfer' },
      { value: 'card-management', label: 'Card Management' },
      { value: 'landing', label: 'Landing Page' },
      { value: 'pricing', label: 'Pricing Page' },
      { value: 'other', label: 'Other' }
    ],
    'crypto': [
      { value: 'wallet', label: 'Wallet' },
      { value: 'exchange', label: 'Exchange / Trading' },
      { value: 'defi', label: 'DeFi Protocol' },
      { value: 'token-detail', label: 'Token / NFT Detail' },
      { value: 'onboarding', label: 'Onboarding' },
      { value: 'portfolio', label: 'Portfolio' },
      { value: 'staking', label: 'Staking / Yield' },
      { value: 'landing', label: 'Landing Page' },
      { value: 'other', label: 'Other' }
    ]
  };

  function updatePageTypeSelector(vertical) {
    const section = document.getElementById('page-type-section');
    const select = document.getElementById('page-type-select');

    if (!PAGE_TYPES[vertical]) {
      section.style.display = 'none';
      return;
    }

    select.innerHTML = PAGE_TYPES[vertical]
      .map(opt => `<option value="${opt.value}">${opt.label}</option>`)
      .join('');
    section.style.display = 'block';
  }

  // Vertical Selection
  document.querySelectorAll('.vertical-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.vertical-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectedVertical = card.dataset.vertical;
      updatePageTypeSelector(selectedVertical);
    });
  });

  function getSelectedMode() {
    const checked = document.querySelector('input[name="mode"]:checked');
    return checked ? checked.value : 'viewport';
  }

  function getSelectedDevice() {
    return selectedDevice;
  }

  // Device card selection
  const DEVICE_INFO_TEXT = {
    desktop: 'Current browser viewport',
    mobile: '390×844 — iPhone 15 Pro',
    tablet: '820×1180 — iPad',
    compare: 'Desktop + Mobile — side-by-side comparison'
  };

  const deviceInfoEl = document.getElementById('device-info');
  document.querySelectorAll('.device-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.device-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectedDevice = card.dataset.device;
      if (deviceInfoEl) deviceInfoEl.textContent = DEVICE_INFO_TEXT[selectedDevice] || '';
    });
  });

  // Run Audit
  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    btnText.textContent = 'Analyzing...';
    btnSpinner.style.display = 'inline-flex';
    statusEl.textContent = '';
    statusEl.className = 'status';

    const mode = getSelectedMode();

    if (mode === 'region') {
      statusEl.textContent = 'Click an element on the page to select a region...';
    }

    try {
      const pageTypeSelect = document.getElementById('page-type-select');
      const pageType = PAGE_TYPES[selectedVertical] ? pageTypeSelect.value : null;

      // Check if there's an active project to auto-save
      const { activeProjectId } = await chrome.storage.local.get('activeProjectId');

      const device = getSelectedDevice();
      const result = await chrome.runtime.sendMessage({
        action: 'START_AUDIT',
        vertical: selectedVertical,
        pageType: pageType,
        mode: mode,
        device: device,
        projectId: activeProjectId || null
      });

      if (result?.success) {
        if (device === 'compare') {
          statusEl.textContent = `Compare: ${result.desktopCount} desktop / ${result.mobileCount} mobile findings`;
        } else {
          statusEl.textContent = result.findingCount + ' findings detected';
        }
        statusEl.className = 'status success';
      } else {
        statusEl.textContent = result?.error || 'Audit failed';
        statusEl.className = 'status error';
      }
    } catch (err) {
      statusEl.textContent = err.message || 'Connection error';
      statusEl.className = 'status error';
    }

    runBtn.disabled = false;
    btnText.textContent = 'Run Audit';
    btnSpinner.style.display = 'none';
  });

  // Load Saved Audit
  loadBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    statusEl.textContent = 'Loading audit...';
    statusEl.className = 'status';

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.version || !data.findings) {
        throw new Error('Invalid audit file format');
      }

      await chrome.runtime.sendMessage({
        action: 'LOAD_AUDIT_FILE',
        data: data
      });

      statusEl.textContent = 'Audit loaded';
      statusEl.className = 'status success';
    } catch (err) {
      statusEl.textContent = err.message || 'Failed to load file';
      statusEl.className = 'status error';
    }

    fileInput.value = '';
  });

  // Retry Button
  const retryBtn = document.getElementById('retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      errorPanel.style.display = 'none';
      capturePanel.style.display = 'block';
    });
  }

  // ══════════════════════════════════════════════
  //  Project Review Tab
  // ══════════════════════════════════════════════

  const projectSelect = document.getElementById('project-select');
  const newProjectRow = document.getElementById('new-project-row');
  const newProjectName = document.getElementById('new-project-name');
  const btnCreateProject = document.getElementById('btn-create-project');
  const projectInfo = document.getElementById('project-info');
  const projectInfoName = document.getElementById('project-info-name');
  const projectInfoStats = document.getElementById('project-info-stats');
  const projectStatus = document.getElementById('project-status');
  const batchUrls = document.getElementById('batch-urls');
  const batchVertical = document.getElementById('batch-vertical');
  const btnBatchAudit = document.getElementById('btn-batch-audit');
  const batchProgress = document.getElementById('batch-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const btnBatchStop = document.getElementById('btn-batch-stop');
  const btnViewProject = document.getElementById('btn-view-project');
  const btnDeleteProject = document.getElementById('btn-delete-project');

  let batchRunning = false;

  // ── Explorer Tab ──
  async function loadExplorerTab() {
    const container = document.getElementById('explorer-list');
    if (!container) return;

    try {
      const stored = await chrome.storage.local.get('__echoflowExplorations');
      const explorations = stored['__echoflowExplorations'] || [];

      if (explorations.length === 0) {
        container.innerHTML = '<div class="explorer-empty"><span class="explorer-empty-icon">🔍</span><p>No explorations yet.</p><p class="explorer-empty-hint">Crawl any site on the Page Review tab — it\'ll appear here automatically.</p></div>';
        return;
      }

      container.innerHTML = '';
      for (const exp of explorations) {
        const card = document.createElement('div');
        card.className = 'explorer-card';

        const ago = formatTimeAgo(exp.timestamp);
        const methodLabel = exp.method === 'crawl' ? '🕷 Crawl' : '🗺 Sitemap';
        const pageCount = (exp.result?.totalDetected || exp.pageCount || 0).toLocaleString();

        card.innerHTML = `
          <div class="explorer-card-main">
            <img class="explorer-favicon" src="${exp.favicon}" onerror="this.style.display='none'" />
            <div class="explorer-info">
              <div class="explorer-site">${escapeHtml(exp.siteName)}</div>
              <div class="explorer-meta">${methodLabel} · ${pageCount} pages · ${ago}</div>
            </div>
            <button class="explorer-delete" data-id="${exp.id}" title="Remove">✕</button>
          </div>
          <button class="explorer-restore btn-sm-secondary" data-id="${exp.id}">Reload Discovery</button>
        `;

        // Restore discovery results
        card.querySelector('.explorer-restore').addEventListener('click', () => {
          // Switch to Page Review tab
          const pageReviewTab = document.querySelector('[data-popup-tab="page-review"]');
          if (pageReviewTab) pageReviewTab.click();

          // Load the stored result into the discover section
          if (exp.result) {
            renderDiscoveryResult(exp.result, exp.method);
            if (projectStatus) {
              projectStatus.textContent = `Loaded: ${exp.siteName} (${pageCount} pages)`;
              projectStatus.className = 'status success';
            }
          }
        });

        // Delete exploration
        card.querySelector('.explorer-delete').addEventListener('click', async (e) => {
          e.stopPropagation();
          const stored2 = await chrome.storage.local.get('__echoflowExplorations');
          const updated = (stored2['__echoflowExplorations'] || []).filter(ex => ex.id !== exp.id);
          await chrome.storage.local.set({ '__echoflowExplorations': updated });
          card.remove();
          if (container.children.length === 0) loadExplorerTab();
        });

        container.appendChild(card);
      }
    } catch (err) {
      container.innerHTML = '<div class="explorer-empty"><p>Could not load explorations.</p></div>';
    }
  }

  function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  async function loadProjectList() {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'LIST_PROJECTS' });
      if (!result?.success) return;

      const projects = result.projects || [];
      const { activeProjectId } = await chrome.storage.local.get('activeProjectId');

      // Rebuild select
      projectSelect.innerHTML = '<option value="">Select a project...</option><option value="__new__">+ New Project</option>';
      projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        projectSelect.appendChild(opt);
      });

      // Re-select active project
      if (activeProjectId && projects.find(p => p.id === activeProjectId)) {
        projectSelect.value = activeProjectId;
        showProjectInfo(activeProjectId);
      }
    } catch (err) {
      projectStatus.textContent = 'Failed to load projects';
      projectStatus.className = 'status error';
    }
  }

  projectSelect.addEventListener('change', async () => {
    const val = projectSelect.value;
    newProjectRow.style.display = 'none';
    projectInfo.style.display = 'none';

    if (val === '__new__') {
      newProjectRow.style.display = 'flex';
      newProjectName.focus();
      await chrome.storage.local.remove('activeProjectId');
    } else if (val) {
      await chrome.storage.local.set({ activeProjectId: val });
      showProjectInfo(val);
    } else {
      await chrome.storage.local.remove('activeProjectId');
    }
  });

  btnCreateProject.addEventListener('click', async () => {
    const name = newProjectName.value.trim();
    if (!name) return;

    try {
      const result = await chrome.runtime.sendMessage({ action: 'CREATE_PROJECT', name });
      if (result?.success) {
        await chrome.storage.local.set({ activeProjectId: result.project.id });
        newProjectName.value = '';
        newProjectRow.style.display = 'none';
        await loadProjectList();
        projectSelect.value = result.project.id;
        showProjectInfo(result.project.id);
        projectStatus.textContent = 'Project created';
        projectStatus.className = 'status success';
      }
    } catch (err) {
      projectStatus.textContent = 'Failed to create project';
      projectStatus.className = 'status error';
    }
  });

  newProjectName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnCreateProject.click();
  });

  async function showProjectInfo(projectId) {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'GET_PROJECT_AUDITS', projectId });
      if (!result?.success) return;

      const project = result.project;
      const audits = result.audits || [];

      projectInfoName.textContent = project.name;
      projectInfoStats.textContent = `${audits.length} page${audits.length !== 1 ? 's' : ''} audited`;
      projectInfo.style.display = 'block';
    } catch (_) {}
  }

  // ── Discover Pages ──
  const btnDiscoverSitemap = document.getElementById('btn-discover-sitemap');
  const btnDiscoverCrawl = document.getElementById('btn-discover-crawl');
  const discoverProgress = document.getElementById('discover-progress');
  const discoverProgressText = document.getElementById('discover-progress-text');
  const btnDiscoverStop = document.getElementById('btn-discover-stop');

  let discoveredGroups = {}; // Store grouped results
  let discoveredTree = null;  // { parentOf, childrenOf, depthOf, roots }
  let discoveredNavStructure = null; // { header, footer, secondary } from nav extraction
  let discoveredOrigin = '';  // e.g. "https://bookdepot.ca"
  let lastTotalCount = 0;      // Cached so view toggle can re-render without re-fetching state
  let currentDiscoverView = 'templates'; // 'templates' | 'sitemap' | 'navigation'
  let detectedPlatform = null;  // Set by detectAndShowPlatform(); used to warn in Shopify Migration tab

  // ── Platform Detection ──
  // Runs a lightweight script in the active tab (no network needed) to detect
  // the site's tech stack from live DOM signals, then shows a banner in the UI.
  const PLATFORMS = {
    shopify:      { label: 'Shopify',      color: '#96bf48', text: '#fff', icon: '🛍️',  note: 'This is a Shopify store — Shopify Migration mode available' },
    wordpress:    { label: 'WordPress',    color: '#21759b', text: '#fff', icon: '🔵',  note: 'WordPress site detected' },
    wix:          { label: 'Wix',          color: '#faad4d', text: '#1a1a2e', icon: '⬡', note: 'Wix site detected' },
    webflow:      { label: 'Webflow',      color: '#4353ff', text: '#fff', icon: '🌊',  note: 'Webflow site detected' },
    squarespace:  { label: 'Squarespace',  color: '#222',    text: '#fff', icon: '◾',   note: 'Squarespace site detected' },
    bigcommerce:  { label: 'BigCommerce',  color: '#34313f', text: '#fff', icon: '🛒',  note: 'BigCommerce store detected' },
    ghost:        { label: 'Ghost',        color: '#738a94', text: '#fff', icon: '👻',  note: 'Ghost CMS detected' },
  };

  async function detectAndShowPlatform() {
    const banner = document.getElementById('platform-banner');
    if (!banner) return;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

      // Check hostname for myshopify.com before injecting script
      let hostPlatform = null;
      try {
        const hostname = new URL(tab.url).hostname;
        if (hostname.includes('myshopify.com')) hostPlatform = 'shopify';
        if (hostname.includes('squarespace.com')) hostPlatform = 'squarespace';
        if (hostname.includes('wixsite.com') || hostname.includes('wix.com')) hostPlatform = 'wix';
        if (hostname.includes('webflow.io')) hostPlatform = 'webflow';
        if (hostname.includes('bigcommerce.com')) hostPlatform = 'bigcommerce';
      } catch (_) {}

      // Inject script to check live DOM signals
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const s = {};
          // Window globals
          if (window.Shopify)        s.shopify     = true;
          if (window.wixBiSession)   s.wix         = true;
          if (window.Webflow)        s.webflow     = true;
          if (window.BCData)         s.bigcommerce = true;
          if (window.Ghost)          s.ghost       = true;
          // Generator meta tag
          const gen = document.querySelector('meta[name="generator"]');
          if (gen) {
            const c = (gen.content || '').toLowerCase();
            if (c.includes('wordpress'))   s.wordpress   = true;
            if (c.includes('squarespace')) s.squarespace = true;
            if (c.includes('webflow'))     s.webflow     = true;
            if (c.includes('ghost'))       s.ghost       = true;
            if (c.includes('wix'))         s.wix         = true;
          }
          // Script src patterns
          const srcs = [...document.scripts].map(el => el.src);
          if (srcs.some(u => u.includes('cdn.shopify.com') || u.includes('/shopify/')))            s.shopify     = true;
          if (srcs.some(u => u.includes('static.wixstatic.com') || u.includes('wix-code-sdk')))   s.wix         = true;
          if (srcs.some(u => u.includes('squarespace.com')))                                       s.squarespace = true;
          if (srcs.some(u => u.includes('webflow.com')))                                           s.webflow     = true;
          if (srcs.some(u => u.includes('bigcommerce.com')))                                       s.bigcommerce = true;
          if (srcs.some(u => u.includes('/wp-content/') || u.includes('/wp-includes/')))           s.wordpress   = true;
          // Shopify meta tag
          if (document.querySelector('[name^="shopify"]'))  s.shopify = true;
          return s;
        }
      });

      const signals = result?.result || {};
      if (hostPlatform) signals[hostPlatform] = true;

      // Priority order — pick the first match
      const detected = ['shopify','bigcommerce','wordpress','wix','webflow','squarespace','ghost']
        .find(p => signals[p]);

      if (!detected) return;

      detectedPlatform = detected;

      const info = PLATFORMS[detected];
      banner.style.cssText = `
        display:flex; align-items:center; gap:8px;
        padding: 8px 10px; margin-bottom: 8px; border-radius: 6px;
        background:${info.color}; color:${info.text};
        font-size:12px; font-weight:600; line-height:1.3;
      `;
      banner.innerHTML = `<span style="font-size:15px;">${info.icon}</span><span>${info.note}</span>`;

      // If the user is already on the Shopify Migration tab when detection finishes,
      // show the warning there too (tab may have been open before detection completed).
      maybeWarnShopifyMigration();

    } catch (_) {
      // Silently ignore — scripting may be blocked on some pages
    }
  }

  // Show a contextual warning in the Shopify Migration tab if the current site
  // is already on Shopify — the migration tool is designed for non-Shopify sites.
  function maybeWarnShopifyMigration() {
    if (detectedPlatform !== 'shopify') return;
    const adaptStatusEl = document.getElementById('adapt-status');
    if (!adaptStatusEl) return;
    // Only set the warning if no analysis is currently running (don't overwrite progress)
    if (adaptStatusEl.textContent.includes('Analyzing')) return;
    adaptStatusEl.textContent = '⚠️ This is already a Shopify store. Shopify Migration is designed for non-Shopify sites. You can still run it to audit migration quality.';
    adaptStatusEl.className = 'status error';
  }

  detectAndShowPlatform();

  // URL → page type classification
  // Returns { type, label, template } where template indicates if pages share a layout
  //   template: 'shared' = high-volume, same layout (product, collection, blog post)
  //   template: 'unique' = each page likely has its own layout/content
  function classifyUrl(url) {
    let path, parsed;
    try { parsed = new URL(url); path = parsed.pathname.toLowerCase(); } catch { return { type: 'other', label: 'Other', template: 'unique' }; }

    if (path === '/' || path === '' || path === '/index.html' || path === '/home') return { type: 'homepage', label: 'Homepage', template: 'unique' };

    // Shopify product pages — all share the product template
    if (path.match(/^\/products\/[^/]+$/)) return { type: 'product', label: 'Product Pages', template: 'shared' };
    if (path.match(/^\/collections\/.+\/products\//)) return { type: 'product', label: 'Product Pages', template: 'shared' };

    // Shopify collections — shared template
    if (path.match(/^\/collections\/[^/]+$/)) return { type: 'collection', label: 'Collection Pages', template: 'shared' };
    if (path === '/collections' || path === '/collections/all') return { type: 'collection-index', label: 'All Collections Index', template: 'unique' };

    // WooCommerce / general ecommerce
    if (path.match(/^\/(product|item|shop\/[^/]+|p)\//)) return { type: 'product', label: 'Product Pages', template: 'shared' };
    if (path.match(/^\/(product-category|category|catalog)\//)) return { type: 'collection', label: 'Collection / Category Pages', template: 'shared' };
    if (path.match(/^\/shop\/?$/) || path.match(/^\/store\/?$/)) return { type: 'shop-index', label: 'Shop Index', template: 'unique' };

    // Blog — individual posts share a template, but index/tag pages are unique
    if (path.match(/^\/(blog|blogs|news|journal)\/?$/) || path.match(/^\/(blog|blogs)\/(tagged|category|tag)\//)) return { type: 'blog-index', label: 'Blog Index / Tags', template: 'unique' };
    if (path.match(/^\/(blog|blogs|articles?|news|journal)\/.+/)) return { type: 'blog-post', label: 'Blog Posts', template: 'shared' };
    if (path.match(/^\/(posts?)\/.+/)) return { type: 'blog-post', label: 'Blog Posts', template: 'shared' };

    // Account — each sub-page may differ
    if (path.match(/^\/(login|sign-in|signin)\b/)) return { type: 'login', label: 'Login', template: 'unique' };
    if (path.match(/^\/(register|sign-up|signup|create-account)\b/)) return { type: 'register', label: 'Register', template: 'unique' };
    if (path.match(/^\/(account|my-account|profile|dashboard)\b/)) return { type: 'account', label: 'Account Dashboard', template: 'unique' };
    if (path.match(/^\/(account\/orders|order-history|my-orders)\b/)) return { type: 'account-orders', label: 'Order History', template: 'unique' };
    if (path.match(/^\/(wishlist|favorites|saved)\b/)) return { type: 'wishlist', label: 'Wishlist', template: 'unique' };

    // Cart & Checkout
    if (path.match(/^\/(cart|basket)\b/)) return { type: 'cart', label: 'Cart', template: 'unique' };
    if (path.match(/^\/(checkout|pay)\b/)) return { type: 'checkout', label: 'Checkout', template: 'unique' };

    // Policy / Legal — each policy page is different content
    if (path.match(/\/(privacy|privacy-policy)\b/)) return { type: 'policy-privacy', label: 'Privacy Policy', template: 'unique' };
    if (path.match(/\/(terms|terms-of-service|terms-and-conditions|tos)\b/)) return { type: 'policy-terms', label: 'Terms of Service', template: 'unique' };
    if (path.match(/\/(refund|refund-policy|returns|return-policy)\b/)) return { type: 'policy-refund', label: 'Refund / Return Policy', template: 'unique' };
    if (path.match(/\/(shipping-policy|delivery-policy)\b/)) return { type: 'policy-shipping', label: 'Shipping Policy', template: 'unique' };
    if (path.match(/\/(cookie|cookie-policy)\b/)) return { type: 'policy-cookie', label: 'Cookie Policy', template: 'unique' };
    if (path.match(/^\/(policies|policy|legal|disclaimer)\//)) return { type: 'policy-other', label: 'Other Legal', template: 'unique' };

    // Search
    if (path.match(/^\/(search|find)\b/)) return { type: 'search', label: 'Search Results', template: 'unique' };

    // Contact / Support — FAQ may have many pages
    if (path.match(/^\/(contact|get-in-touch)\b/)) return { type: 'contact', label: 'Contact', template: 'unique' };
    if (path.match(/^\/(help|support)\/?$/)) return { type: 'help-center', label: 'Help Center', template: 'unique' };
    if (path.match(/^\/(help|support)\/.+/)) return { type: 'help-article', label: 'Help Articles', template: 'shared' };
    if (path.match(/^\/(faq)\b/)) return { type: 'faq', label: 'FAQ', template: 'unique' };

    // About / Company — each is a unique page
    if (path.match(/^\/(about|about-us)\b/)) return { type: 'about', label: 'About', template: 'unique' };
    if (path.match(/^\/(our-story|story)\b/)) return { type: 'our-story', label: 'Our Story', template: 'unique' };
    if (path.match(/^\/(team|our-team|people)\b/)) return { type: 'team', label: 'Team', template: 'unique' };
    if (path.match(/^\/(careers|jobs|work-with-us)\b/)) return { type: 'careers', label: 'Careers', template: 'unique' };
    if (path.match(/^\/(press|media|newsroom)\b/)) return { type: 'press', label: 'Press / Media', template: 'unique' };

    // Shopify /pages/* — each is a different static page (unique layout)
    if (path.match(/^\/(pages?)\/.+/)) {
      const pageName = path.replace(/^\/(pages?)\//, '').replace(/-/g, ' ').replace(/\//g, ' — ');
      const prettyName = pageName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return { type: 'page:' + path, label: prettyName, template: 'unique' };
    }

    // Stores/locations
    if (path.match(/^\/(stores?|locations?)\/?$/)) return { type: 'store-locator', label: 'Store Locator', template: 'unique' };
    if (path.match(/^\/(stores?|locations?)\/.+/)) return { type: 'store-detail', label: 'Store Detail Pages', template: 'shared' };

    // Gift cards
    if (path.match(/^\/(gift[-_]?cards?)\b/)) return { type: 'gift-card', label: 'Gift Card', template: 'unique' };

    // Loyalty / rewards
    if (path.match(/^\/(rewards?|loyalty|points)\b/)) return { type: 'loyalty', label: 'Loyalty / Rewards', template: 'unique' };

    // Sitemap / feeds
    if (path.match(/\.(xml|rss|atom|json)$/)) return { type: 'feed', label: 'Feeds / Sitemap', template: 'skip' };

    // Assets
    if (path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|pdf)$/)) return { type: 'asset', label: 'Assets', template: 'skip' };

    // 404 / error
    if (path.match(/^\/(404|error|not-found)\b/)) return { type: '404', label: '404 Page', template: 'unique' };

    // Catch-all: if it's a single-segment path, treat as unique page
    const segments = path.replace(/^\/|\/$/g, '').split('/');
    if (segments.length === 1 && segments[0]) {
      const pageName = segments[0].replace(/-/g, ' ');
      const prettyName = pageName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return { type: 'page:' + path, label: prettyName, template: 'unique' };
    }

    return { type: 'other', label: 'Other Pages', template: 'unique' };
  }

  // Group URLs into template groups vs unique pages
  function groupDiscoveredUrls(urls) {
    const groups = {};
    urls.forEach(url => {
      const { type, label, template } = classifyUrl(url);
      if (template === 'skip') return; // Skip feeds/assets
      if (!groups[type]) {
        groups[type] = { label, urls: [], sample: url, template };
      }
      groups[type].urls.push(url);
    });
    return groups;
  }

  // Build a template-level sitemap tree. Each node is a template type (one row
  // in the UI, one black rectangle in the Figma IA).
  //
  // TWO modes of inference depending on available data:
  //
  //   Crawl mode (parentMap provided):
  //     The crawl recorded which page linked to which. We aggregate votes at
  //     the template level: for every URL in template X, look up the page that
  //     linked to it → classify that page → count votes. The template with the
  //     most votes becomes X's parent. If the majority vote is "__root__" (the
  //     link target was the start URL / nobody known linked there), X becomes
  //     a root. This gives the **real navigation tree** the user sees on the
  //     site — e.g. Blog won't nest under Homepage unless the homepage
  //     actually links to a blog page.
  //
  //   Sitemap-XML mode (parentMap is null):
  //     No link data. Fall back to URL path-segment prefix matching
  //     (/Blog/Article → child of /Blog → child of /). This is a structural
  //     guess, not real navigation, so we label it "inferred".
  //
  //   hasCrawlData flag is exposed in the return so the UI can label the tree.
  function buildTemplateTree(groups, parentMap) {
    const types = Object.keys(groups);
    const pathOfType = {};
    for (const t of types) {
      try { pathOfType[t] = new URL(groups[t].sample).pathname.toLowerCase(); }
      catch { pathOfType[t] = '/'; }
    }
    const homepageType = types.includes('homepage') ? 'homepage' : null;
    const hasCrawlData = parentMap && typeof parentMap === 'object' && Object.keys(parentMap).length > 0;

    // Helper: classify any URL back to a template type we actually have
    function typeOf(url) {
      try {
        const info = classifyUrl(url);
        return types.includes(info.type) ? info.type : null;
      } catch { return null; }
    }

    const parentOf = {};

    if (hasCrawlData) {
      // ── Crawl-vote mode ──
      // Build vote table: childType → { candidateParentType → count }
      const votes = {};
      for (const [childUrl, parentUrl] of Object.entries(parentMap)) {
        const childType = typeOf(childUrl);
        if (!childType) continue;
        const parentType = parentUrl ? typeOf(parentUrl) : null;
        if (parentType === childType) continue; // same-template self-link (e.g. product → product in "related")
        if (!votes[childType]) votes[childType] = {};
        const key = parentType || '__root__';
        votes[childType][key] = (votes[childType][key] || 0) + 1;
      }

      for (const t of types) {
        if (t === homepageType) { parentOf[t] = null; continue; }

        const v = votes[t];
        if (v) {
          // Pick the candidate with the most votes (excluding self)
          let best = null, bestCount = 0;
          for (const [cand, count] of Object.entries(v)) {
            if (cand === t) continue;
            if (count > bestCount) { best = cand; bestCount = count; }
          }
          if (best && best !== '__root__' && types.includes(best)) {
            parentOf[t] = best;
          } else {
            // Majority said __root__ (nobody in our known templates linked here),
            // or we have no votes at all — this template is a top-level entry.
            parentOf[t] = null;
          }
        } else {
          // No votes at all for this type (edge case — e.g. only the start URL was in this template)
          parentOf[t] = null;
        }
      }
    } else {
      // ── Path-inference mode (sitemap.xml, no link data) ──
      for (const t of types) {
        if (t === homepageType) { parentOf[t] = null; continue; }

        const samplePath = pathOfType[t];
        const segments = samplePath.split('/').filter(Boolean);
        let pathParent = null;
        for (let i = segments.length - 1; i >= 1; i--) {
          const prefix = '/' + segments.slice(0, i).join('/');
          const match = types.find(tt => tt !== t && pathOfType[tt] === prefix);
          if (match) { pathParent = match; break; }
        }
        parentOf[t] = pathParent ?? homepageType ?? null;
      }
    }

    // Cycle break: if walking up reveals a loop, detach the starting node to root
    for (const t of types) {
      const seen = new Set();
      let cur = t;
      while (parentOf[cur]) {
        if (seen.has(cur)) { parentOf[t] = null; break; }
        seen.add(cur);
        cur = parentOf[cur];
      }
    }

    // Children index + depth
    const childrenOf = { __root__: [] };
    for (const t of types) {
      const p = parentOf[t] || '__root__';
      if (!childrenOf[p]) childrenOf[p] = [];
      childrenOf[p].push(t);
    }
    const depthOf = {};
    function depth(t, visited = new Set()) {
      if (depthOf[t] !== undefined) return depthOf[t];
      if (visited.has(t)) { depthOf[t] = 0; return 0; }
      visited.add(t);
      const p = parentOf[t];
      const d = p ? 1 + depth(p, visited) : 0;
      depthOf[t] = d;
      return d;
    }
    for (const t of types) depth(t);

    const roots = types.filter(t => !parentOf[t]);
    return { parentOf, childrenOf, depthOf, roots, hasCrawlData };
  }

  // Display order for the flat Templates view (unused in Sitemap view, which uses tree depth)
  const TYPE_ORDER = ['homepage', 'collection-index', 'shop-index', 'product', 'collection', 'blog-index', 'blog-post',
    'login', 'register', 'account', 'account-orders', 'wishlist',
    'cart', 'checkout', 'search', 'contact', 'help-center', 'help-article', 'faq',
    'about', 'our-story', 'team', 'careers', 'press',
    'store-locator', 'store-detail', 'gift-card', 'loyalty',
    'policy-privacy', 'policy-terms', 'policy-refund', 'policy-shipping', 'policy-cookie', 'policy-other',
    '404', 'other'];

  function typeRank(type) {
    const i = TYPE_ORDER.indexOf(type);
    if (i >= 0) return i;
    if (type.startsWith('page:')) return 90;
    return 99;
  }

  // Build the DOM for one template row. `depth` adds indent (tree view only).
  function buildTemplateRow(type, group, depth = 0) {
    const row = document.createElement('label');
    row.className = 'discover-group-row';
    if (depth > 0) row.style.paddingLeft = `${8 + depth * 16}px`;

    const isShared = group.template === 'shared';
    const count = group.urls.length;
    const checked = type !== 'feed' && type !== 'asset';

    let countBadge = '';
    if (isShared) {
      if (group.totalDetected && group.totalDetected > count) {
        countBadge = `<span class="discover-group-count" title="${group.sampledCount || count} samples kept of ${group.totalDetected.toLocaleString()} detected">${count} / ${group.totalDetected.toLocaleString()}</span>`;
      } else {
        countBadge = `<span class="discover-group-count">${count.toLocaleString()}</span>`;
      }
    } else if (count > 1) {
      countBadge = `<span class="discover-group-count">${count}</span>`;
    }

    const templateTag = isShared
      ? '<span class="discover-template-tag">shared</span>'
      : '<span class="discover-template-tag unique">unique</span>';

    const sampleLink = group.sample
      ? `<a href="${group.sample}" target="_blank" class="discover-sample-link" title="${group.sample}">↗</a>`
      : '';

    row.innerHTML = `
      <input type="checkbox" class="discover-group-check" data-type="${type}" ${checked ? 'checked' : ''}>
      <span class="discover-group-label">${group.label}</span>
      ${templateTag}
      ${countBadge}
      ${sampleLink}
    `;
    return row;
  }

  function renderDiscoverSummary(groups, totalCount) {
    const summary = document.getElementById('discover-summary');
    const totalEl = document.getElementById('discover-total');
    const groupsEl = document.getElementById('discover-groups');

    // Each group is one "page template" — maps 1:1 to a black rectangle in the Figma IA diagram
    const templateCount = Object.keys(groups).filter(t => t !== '__collapsed__').length;

    // Header: counts + view toggle
    const v = currentDiscoverView;
    const hasNav = !!discoveredNavStructure;
    totalEl.innerHTML = `
      <span>${totalCount.toLocaleString()} pages found</span>
      <span class="discover-templates">${templateCount} page templates</span>
      <span class="discover-view-toggle">
        <button class="discover-view-btn${v === 'templates' ? ' active' : ''}" data-view="templates">Templates</button>
        <button class="discover-view-btn${v === 'sitemap' ? ' active' : ''}" data-view="sitemap">Sitemap</button>
        <button class="discover-view-btn${v === 'navigation' ? ' active' : ''}${!hasNav ? ' disabled' : ''}" data-view="navigation" ${!hasNav ? 'disabled title="Run Crawl Links to extract navigation"' : ''}>Navigation</button>
      </span>
    `;
    // Wire up the toggle buttons (inline listeners — totalEl is re-rendered every pass)
    totalEl.querySelectorAll('.discover-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.view;
        if (v === currentDiscoverView) return;
        currentDiscoverView = v;
        renderDiscoverSummary(discoveredGroups, lastTotalCount);
      });
    });

    groupsEl.innerHTML = '';

    if (currentDiscoverView === 'navigation' && discoveredNavStructure) {
      renderNavigationView(groupsEl);
    } else if (currentDiscoverView === 'sitemap' && discoveredTree) {
      renderSitemapView(groups, groupsEl);
    } else {
      renderTemplatesView(groups, groupsEl);
    }

    summary.style.display = 'block';

    // Show/hide the right action buttons depending on view
    const isNavView = currentDiscoverView === 'navigation';
    const btnFigjam = document.getElementById('btn-discover-figjam');
    const btnScript = document.getElementById('btn-discover-nav-script');
    const btnText   = document.getElementById('btn-discover-nav-text');
    if (btnFigjam) btnFigjam.style.display = isNavView ? 'none' : '';
    if (btnScript) btnScript.style.display = isNavView ? '' : 'none';
    if (btnText)   btnText.style.display   = isNavView ? '' : 'none';
  }

  // Flat Templates view — unique pages first, then shared-template groups, with the 30-row cap
  function renderTemplatesView(groups, groupsEl) {
    // Never render the synthetic collapsed bucket twice — rebuild it from scratch each pass
    delete groups['__collapsed__'];

    const entries = Object.entries(groups);
    entries.sort((a, b) => typeRank(a[0]) - typeRank(b[0]));

    const UNIQUE_CAP = 30;
    const sharedEntries = entries.filter(([_, g]) => g.template === 'shared');
    const uniqueEntries = entries.filter(([_, g]) => g.template !== 'shared');

    let capTriggered = false;
    let collapsedCount = 0;
    let collapsedUrlCount = 0;
    let visibleUnique = uniqueEntries;

    if (uniqueEntries.length > UNIQUE_CAP) {
      capTriggered = true;
      visibleUnique = uniqueEntries.slice(0, UNIQUE_CAP);
      const tail = uniqueEntries.slice(UNIQUE_CAP);
      collapsedCount = tail.length;
      collapsedUrlCount = tail.reduce((sum, [_, g]) => sum + g.urls.length, 0);
      const collapsedSample = tail[0]?.[1]?.sample || '';
      groups['__collapsed__'] = {
        label: `Other Pages (${collapsedCount} more)`,
        urls: tail.flatMap(([_, g]) => g.urls),
        sample: collapsedSample,
        template: 'unique'
      };
    }

    if (capTriggered) {
      const warn = document.createElement('div');
      warn.className = 'discover-warning';
      warn.textContent = `${collapsedUrlCount.toLocaleString()} URLs collapsed into "Other Pages" — site may use a non-standard URL structure.`;
      groupsEl.appendChild(warn);
    }

    const renderList = [...visibleUnique, ...sharedEntries];
    if (capTriggered) renderList.push(['__collapsed__', groups['__collapsed__']]);

    for (const [type, group] of renderList) {
      groupsEl.appendChild(buildTemplateRow(type, group, 0));
    }
  }

  // Indented Sitemap view — walks the template tree; no row cap (the tree self-organizes)
  function renderSitemapView(groups, groupsEl) {
    // Clear the synthetic collapsed row — sitemap doesn't use it
    delete groups['__collapsed__'];

    const tree = discoveredTree;
    if (!tree) { renderTemplatesView(groups, groupsEl); return; }

    const emitted = new Set();
    function emit(type, depth) {
      if (emitted.has(type)) return;
      emitted.add(type);
      const group = groups[type];
      if (!group) return;
      groupsEl.appendChild(buildTemplateRow(type, group, depth));
      const kids = (tree.childrenOf[type] || []).slice().sort((a, b) => typeRank(a) - typeRank(b));
      for (const k of kids) emit(k, depth + 1);
    }

    // Roots first — homepage pinned to top, then the rest in type-order
    const sortedRoots = tree.roots.slice().sort((a, b) => {
      if (a === 'homepage') return -1;
      if (b === 'homepage') return 1;
      return typeRank(a) - typeRank(b);
    });
    for (const r of sortedRoots) emit(r, 0);

    // Safety net: any template not reached from a root (cycle remnants) renders flat at depth 0
    for (const type of Object.keys(groups)) {
      if (!emitted.has(type)) groupsEl.appendChild(buildTemplateRow(type, groups[type], 0));
    }
  }

  // Navigation view — renders the extracted nav structure as a tree
  function renderNavigationView(groupsEl) {
    if (!discoveredNavStructure) {
      groupsEl.innerHTML = '<div class="discover-empty">Navigation data not available. Run <b>Crawl Links</b> to extract navigation structure.</div>';
      return;
    }

    function createNavItem(item, depth) {
      const row = document.createElement('div');
      row.className = 'nav-item-row';
      row.style.paddingLeft = `${8 + depth * 16}px`;

      const label = document.createElement('span');
      label.className = 'nav-item-label';
      label.textContent = item.label;
      row.appendChild(label);

      if (item.url) {
        const url = document.createElement('span');
        url.className = 'nav-item-url';
        url.textContent = item.url;
        url.title = item.url;
        row.appendChild(url);
      }

      if (item.children && item.children.length > 0) {
        const badge = document.createElement('span');
        badge.className = 'nav-children-badge';
        badge.textContent = `${item.children.length}`;
        row.appendChild(badge);
      }

      return row;
    }

    function createNavSection(title, items, tag) {
      const section = document.createElement('div');
      section.className = 'nav-section';

      const header = document.createElement('div');
      header.className = 'nav-section-header';
      header.textContent = title;
      if (tag) {
        const tagEl = document.createElement('span');
        tagEl.className = `nav-section-tag ${tag}`;
        tagEl.textContent = tag;
        header.appendChild(tagEl);
      }
      const countEl = document.createElement('span');
      countEl.className = 'nav-children-badge';
      countEl.textContent = items.length;
      header.appendChild(countEl);
      section.appendChild(header);

      const body = document.createElement('div');
      body.className = 'nav-section-body';
      for (const item of items) {
        body.appendChild(createNavItem(item, 0));
        if (item.children) {
          for (const child of item.children) {
            body.appendChild(createNavItem(child, 1));
            if (child.children) {
              for (const grandchild of child.children) {
                body.appendChild(createNavItem(grandchild, 2));
              }
            }
          }
        }
      }
      section.appendChild(body);
      return section;
    }

    const nav = discoveredNavStructure;

    // Header nav
    if (nav.header && nav.header.items && nav.header.items.length > 0) {
      groupsEl.appendChild(createNavSection(nav.header.label || 'Main Navigation', nav.header.items, 'header'));
    }

    // Footer groups
    if (nav.footer && nav.footer.groups) {
      for (const group of nav.footer.groups) {
        if (group.items && group.items.length > 0) {
          groupsEl.appendChild(createNavSection(group.label || 'Footer', group.items, 'footer'));
        }
      }
    }

    // Secondary navs
    if (nav.secondary) {
      for (const sec of nav.secondary) {
        if (sec.items && sec.items.length > 0) {
          groupsEl.appendChild(createNavSection(sec.label || 'Secondary Navigation', sec.items, 'secondary'));
        }
      }
    }
  }

  // ── Discovery UI state helpers ──
  // Discovery runs in the background service worker. The popup fires it and
  // polls for state; the popup can be closed and reopened without affecting
  // the in-flight discovery.
  let discoverPollInterval = null;

  function showDiscoverRunning(text) {
    btnDiscoverSitemap.disabled = true;
    btnDiscoverCrawl.disabled = true;
    discoverProgress.style.display = 'flex';
    discoverProgressText.textContent = text || 'Discovering pages...';
    document.getElementById('discover-summary').style.display = 'none';
  }

  function hideDiscoverRunning() {
    btnDiscoverSitemap.disabled = false;
    btnDiscoverCrawl.disabled = false;
    discoverProgress.style.display = 'none';
  }

  // Render a completed discovery result (shared by fresh finishes and
  // re-hydration when the popup reopens).
  function renderDiscoveryResult(result, method) {
    if (!result || !result.urls) return;
    if (result.urls.length === 0) {
      projectStatus.textContent = method === 'sitemap'
        ? 'No sitemap found. Try "Crawl Links" instead.'
        : 'No links discovered on this page.';
      projectStatus.className = 'status error';
      return;
    }

    discoveredGroups = groupDiscoveredUrls(result.urls);
    const stats = result.sampleStats || {};
    for (const [key, stat] of Object.entries(stats)) {
      if (discoveredGroups[key]) {
        discoveredGroups[key].totalDetected = stat.total;
        discoveredGroups[key].sampledCount = stat.kept;
        discoveredGroups[key].skippedCount = stat.skipped;
      }
    }
    const totalDetected = result.totalDetected || result.urls.length;
    // Build the template-level sitemap tree once per discovery. Crawl mode supplies
    // a parentMap (URL → parent URL); sitemap.xml mode passes null and we fall back
    // to pure path-segment inference inside buildTemplateTree.
    discoveredTree = buildTemplateTree(discoveredGroups, result.parentMap || null);
    discoveredNavStructure = result.navStructure || null;
    if (result.urls && result.urls[0]) {
      try { discoveredOrigin = new URL(result.urls[0]).origin; } catch { discoveredOrigin = ''; }
    }
    lastTotalCount = totalDetected;
    renderDiscoverSummary(discoveredGroups, totalDetected);
    const collapsed = totalDetected - result.urls.length;
    projectStatus.textContent = collapsed > 0
      ? `Found ${totalDetected.toLocaleString()} pages (${collapsed.toLocaleString()} collapsed into samples) via ${method || 'discovery'}`
      : `Found ${result.urls.length.toLocaleString()} pages via ${method || 'discovery'}`;
    projectStatus.className = 'status success';
  }

  function stopDiscoverPolling() {
    if (discoverPollInterval) {
      clearInterval(discoverPollInterval);
      discoverPollInterval = null;
    }
  }

  async function pollDiscoverState() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'DISCOVER_STATE' });
      const state = resp?.state;
      if (!state) return;

      if (state.status === 'running' || state.status === 'stopping') {
        showDiscoverRunning(state.progressText || 'Discovering pages...');
        return;
      }

      // Terminal status — update UI and stop polling.
      stopDiscoverPolling();
      hideDiscoverRunning();

      if (state.status === 'completed') {
        renderDiscoveryResult(state.result, state.method);
      } else if (state.status === 'stopped') {
        projectStatus.textContent = state.error || 'Discovery stopped';
        projectStatus.className = 'status error';
      } else if (state.status === 'error') {
        projectStatus.textContent = state.error || 'Discovery failed';
        projectStatus.className = 'status error';
      }
    } catch (_) {
      // SW may briefly be unresponsive during restart — keep polling.
    }
  }

  function startDiscoverPolling() {
    if (discoverPollInterval) return;
    pollDiscoverState(); // run once immediately
    discoverPollInterval = setInterval(pollDiscoverState, 1000);
  }

  // On popup open, re-hydrate discover UI from the background state. This
  // is what makes "close popup, reopen, see results" work.
  async function hydrateDiscoverOnOpen() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'DISCOVER_STATE' });
      const state = resp?.state;
      if (!state || state.status === 'idle') return;

      if (state.status === 'running' || state.status === 'stopping') {
        showDiscoverRunning(state.progressText || 'Discovering pages...');
        startDiscoverPolling();
      } else if (state.status === 'completed' && state.result) {
        renderDiscoveryResult(state.result, state.method);
      } else if (state.status === 'stopped' && state.error) {
        projectStatus.textContent = state.error;
        projectStatus.className = 'status error';
      } else if (state.status === 'error') {
        projectStatus.textContent = state.error || 'Discovery failed';
        projectStatus.className = 'status error';
      }
    } catch (_) {}
  }
  hydrateDiscoverOnOpen();

  async function runDiscover(method) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      projectStatus.textContent = 'No active tab';
      projectStatus.className = 'status error';
      return;
    }

    let origin;
    try { origin = new URL(tab.url).origin; } catch {
      projectStatus.textContent = 'Cannot determine site URL';
      projectStatus.className = 'status error';
      return;
    }

    // Clear any previous completed/stopped state first so the run starts fresh.
    await chrome.runtime.sendMessage({ action: 'DISCOVER_CLEAR' }).catch(() => {});

    showDiscoverRunning(method === 'sitemap' ? 'Fetching sitemap...' : 'Crawling links...');
    projectStatus.textContent = '';

    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'DISCOVER_PAGES',
        method,
        origin,
        startUrl: tab.url
      });

      if (resp?.alreadyRunning) {
        // A discovery is already in progress — hydrate instead of starting a new one.
        startDiscoverPolling();
        return;
      }

      if (!resp?.success) {
        hideDiscoverRunning();
        projectStatus.textContent = resp?.error || 'Failed to start discovery';
        projectStatus.className = 'status error';
        return;
      }

      // Discovery started in the background — begin polling for progress/result.
      startDiscoverPolling();
    } catch (err) {
      hideDiscoverRunning();
      projectStatus.textContent = err.message || 'Discovery failed';
      projectStatus.className = 'status error';
    }
  }

  btnDiscoverSitemap.addEventListener('click', () => runDiscover('sitemap'));
  btnDiscoverCrawl.addEventListener('click', () => runDiscover('crawl'));

  btnDiscoverStop.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'DISCOVER_STOP' }).catch(() => {});
    // Polling will pick up the 'stopped' state on its next tick and update UI.
  });

  // "Use Selected for Batch" — one URL per checked row.
  // Shared groups (product, collection) contribute their sample; unique groups contribute their single URL.
  // This maps 1:1 to what each row represents in the Figma IA diagram.
  document.getElementById('btn-discover-use').addEventListener('click', () => {
    const checks = document.querySelectorAll('.discover-group-check:checked');
    const selectedUrls = [];
    checks.forEach(chk => {
      const type = chk.dataset.type;
      if (discoveredGroups[type]) {
        selectedUrls.push(discoveredGroups[type].sample);
      }
    });

    if (selectedUrls.length > 0 && batchUrls) {
      batchUrls.value = selectedUrls.join('\n');
      projectStatus.textContent = `${selectedUrls.length} sample URLs added to batch (1 per template)`;
      projectStatus.className = 'status success';
    }
  });

  // ── FigJam Script Generator ──
  // Converts the extracted nav structure into a self-contained JS script that
  // the Desktop Bridge plugin can run directly to build the full diagram —
  // same shape styles as the user's hand-built inventories.
  function generateFigJamScript(navStructure, siteUrl) {
    // ── Layout constants (matching existing diagram style)
    const COL_X   = [100, 390, 660, 930];   // column X positions
    const SQ_W = 186, SQ_H = 53;            // SQUARE (unique pages)
    const HEX_W = 235, HEX_H = 84;          // HEXAGON (sub-pages / dropdown items)
    const RR_W  = 235, RR_H = 84;           // ROUNDED_RECTANGLE (nav groups)
    const ROW_GAP   = 20;                   // gap between siblings
    const GROUP_GAP = 40;                   // extra gap between top-level groups

    const nodes = []; // { id, label, shapeType, x, y, w, h }
    const edges = []; // { fromId, toId }
    let counter = 0;
    let curY = 150;   // current vertical cursor (below URL label)

    function addNode(label, shapeType, col, y, parentId) {
      const id = 'n' + (counter++);
      const w = shapeType === 'SQUARE' ? SQ_W : (shapeType === 'HEXAGON' ? HEX_W : RR_W);
      const h = shapeType === 'SQUARE' ? SQ_H : HEX_H;
      nodes.push({ id, label: label.slice(0, 60), shapeType, x: COL_X[col], y, w, h });
      if (parentId) edges.push({ fromId: parentId, toId: id });
      return id;
    }

    // Home is always the root square
    const homeLabel = 'Home';
    const homeId = addNode(homeLabel, 'SQUARE', 0, curY, null);
    curY += SQ_H + ROW_GAP;

    // ── Header nav items ──
    const headerItems = navStructure.header && navStructure.header.items || [];
    for (const item of headerItems) {
      if (!item.label) continue;
      // Skip items that look like "Home" (already added as root)
      if (item.label.trim().toLowerCase() === 'home') continue;

      const hasChildren = item.children && item.children.length > 0;
      const groupY = curY;

      if (hasChildren) {
        // Nav section with dropdown → ROUNDED_RECTANGLE at col 0
        const groupId = addNode(item.label, 'ROUNDED_RECTANGLE', 0, groupY, homeId);
        let childY = groupY;

        for (const child of item.children) {
          if (!child.label) continue;
          const hasGrandchildren = child.children && child.children.length > 0;
          const childId = addNode(child.label, 'HEXAGON', 1, childY, groupId);

          if (hasGrandchildren) {
            let gcY = childY;
            for (const gc of child.children) {
              if (!gc.label) continue;
              addNode(gc.label, 'HEXAGON', 2, gcY, childId);
              gcY += HEX_H + ROW_GAP;
            }
            childY = gcY;
          } else {
            childY += HEX_H + ROW_GAP;
          }
        }
        curY = Math.max(childY, groupY + RR_H + ROW_GAP) + GROUP_GAP;
      } else {
        // Direct link (no dropdown) → SQUARE at col 0
        addNode(item.label, 'SQUARE', 0, groupY, homeId);
        curY += SQ_H + ROW_GAP;
      }
    }

    // ── Footer groups ──
    curY += GROUP_GAP;
    const footerGroups = navStructure.footer && navStructure.footer.groups || [];
    for (const group of footerGroups) {
      if (!group.items || group.items.length === 0) continue;
      for (const item of group.items) {
        if (!item.label) continue;
        addNode(item.label, 'SQUARE', 0, curY, homeId);
        curY += SQ_H + ROW_GAP;
      }
      curY += GROUP_GAP;
    }

    // ── Secondary navs ──
    const secondary = navStructure.secondary || [];
    for (const sec of secondary) {
      if (!sec.items || sec.items.length === 0) continue;
      for (const item of sec.items) {
        if (!item.label) continue;
        addNode(item.label, 'SQUARE', 0, curY, homeId);
        curY += SQ_H + ROW_GAP;
      }
      curY += GROUP_GAP;
    }

    const sectionName = (siteUrl || 'Site') + ' — Nav Structure (EchoFlow)';
    const sectionW = Math.max(...nodes.map(n => n.x + n.w)) + 100;
    const sectionH = Math.max(...nodes.map(n => n.y + n.h)) + 100;

    return `(async () => {
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

  const DARK   = [{ type:'SOLID', color:{r:0.118,g:0.118,b:0.118} }];
  const DARK_S = [{ type:'SOLID', color:{r:0.141,g:0.141,b:0.141} }];
  const WHITE  = [{ type:'SOLID', color:{r:1,g:1,b:1} }];
  const YELLOW = [{ type:'SOLID', color:{r:1,g:0.788,b:0.263} }];
  const YEL_S  = [{ type:'SOLID', color:{r:0.91,g:0.639,b:0.008} }];
  const PURPLE = [{ type:'SOLID', color:{r:0.863,g:0.8,b:1} }];
  const PUR_S  = [{ type:'SOLID', color:{r:0.529,g:0.31,b:1} }];
  const BLK80  = [{ type:'SOLID', color:{r:0,g:0,b:0}, opacity:0.8 }];

  const NODES = ${JSON.stringify(nodes)};
  const EDGES = ${JSON.stringify(edges)};

  // Create section
  const section = figma.createSection();
  section.name = ${JSON.stringify(sectionName)};
  section.resizeWithoutConstraints(${sectionW}, ${sectionH});

  // URL label
  const lbl = figma.createText();
  lbl.fontName = { family:'Inter', style:'Regular' };
  lbl.characters = ${JSON.stringify(siteUrl || 'Discovered Site')};
  lbl.fontSize = 14;
  lbl.fills = [{ type:'SOLID', color:{r:0.4,g:0.4,b:0.4} }];
  lbl.x = 100; lbl.y = 60;
  section.appendChild(lbl);

  // Create shapes
  const created = {};
  for (const n of NODES) {
    const s = figma.createShapeWithText();
    s.shapeType = n.shapeType;
    s.x = n.x; s.y = n.y;
    s.resize(n.w, n.h);
    s.name = n.label;
    if (n.shapeType === 'SQUARE') {
      s.fills = DARK; s.strokes = DARK_S; s.strokeWeight = 4;
      s.text.characters = n.label; s.text.fontSize = 16; s.text.fills = WHITE;
    } else if (n.shapeType === 'HEXAGON') {
      s.fills = YELLOW; s.strokes = YEL_S; s.strokeWeight = 4;
      s.text.characters = n.label; s.text.fontSize = 16; s.text.fills = BLK80;
    } else {
      s.fills = PURPLE; s.strokes = PUR_S; s.strokeWeight = 4;
      s.text.characters = n.label; s.text.fontSize = 16; s.text.fills = BLK80;
    }
    section.appendChild(s);
    created[n.id] = s;
  }

  // Create connectors
  for (const e of EDGES) {
    const from = created[e.fromId];
    const to = created[e.toId];
    if (!from || !to) continue;
    const c = figma.createConnector();
    c.connectorLineType = 'ELBOWED';
    c.connectorStart = { endpointNodeId: from.id, magnet: 'AUTO' };
    c.connectorEnd = { endpointNodeId: to.id, magnet: 'AUTO' };
    c.connectorEndStrokeCap = 'NONE';
  }

  figma.viewport.scrollAndZoomIntoView([section]);
  return 'EchoFlow: created ' + NODES.length + ' nodes, ' + EDGES.length + ' connectors.';
})();`;
  }

  // "Copy for FigJam" — output format depends on current view:
  //   Templates view → flat `Label<TAB>URL` per line (one black rectangle per row)
  //   Sitemap view  → tab-indented label tree (FigJam Sitemap/Autoflow plugins parse
  //                    leading tabs as parent→child; URL goes in a trailing tab column)
  const btnDiscoverFigjam = document.getElementById('btn-discover-figjam');
  if (btnDiscoverFigjam) {
    btnDiscoverFigjam.addEventListener('click', async () => {
      const checked = new Set();
      document.querySelectorAll('.discover-group-check:checked').forEach(chk => checked.add(chk.dataset.type));

      if (checked.size === 0) {
        projectStatus.textContent = 'No templates selected';
        projectStatus.className = 'status error';
        return;
      }

      let lines = [];
      let exportCount = 0;

      if (currentDiscoverView === 'sitemap' && discoveredTree) {
        // Tree export — walk the sitemap in display order, emit each checked node
        // at its tree depth. Descendants of unchecked ancestors keep their real depth
        // so the overall shape stays readable in the FigJam import.
        const emitted = new Set();
        function walk(type, depth) {
          if (emitted.has(type)) return;
          emitted.add(type);
          const group = discoveredGroups[type];
          if (group && checked.has(type)) {
            lines.push(`${'\t'.repeat(depth)}${group.label}\t${group.sample || ''}`);
            exportCount++;
          }
          const kids = (discoveredTree.childrenOf[type] || []).slice().sort((a, b) => typeRank(a) - typeRank(b));
          for (const k of kids) walk(k, depth + 1);
        }
        const roots = discoveredTree.roots.slice().sort((a, b) => {
          if (a === 'homepage') return -1;
          if (b === 'homepage') return 1;
          return typeRank(a) - typeRank(b);
        });
        for (const r of roots) walk(r, 0);
      } else {
        // Templates (flat) export — one Label<TAB>URL row per checked template
        document.querySelectorAll('.discover-group-check:checked').forEach(chk => {
          const type = chk.dataset.type;
          const group = discoveredGroups[type];
          if (group && group.sample) {
            lines.push(`${group.label}\t${group.sample}`);
            exportCount++;
          }
        });
      }

      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        const mode = currentDiscoverView === 'sitemap' ? 'sitemap tree' : currentDiscoverView === 'navigation' ? 'navigation' : 'templates';
        projectStatus.textContent = `Copied ${exportCount} ${mode} for FigJam`;
        projectStatus.className = 'status success';
      } catch (err) {
        projectStatus.textContent = 'Clipboard copy failed — check browser permissions';
        projectStatus.className = 'status error';
      }
    });
  }

  // ── "Run it" — copies JS script for Desktop Bridge ──
  const btnNavScript = document.getElementById('btn-discover-nav-script');
  if (btnNavScript) {
    btnNavScript.addEventListener('click', async () => {
      if (!discoveredNavStructure) {
        projectStatus.textContent = 'No navigation data — run Crawl Links first';
        projectStatus.className = 'status error';
        return;
      }
      try {
        const script = generateFigJamScript(discoveredNavStructure, discoveredOrigin);
        await navigator.clipboard.writeText(script);
        projectStatus.textContent = 'Script copied — paste into Desktop Bridge and click Run';
        projectStatus.className = 'status success';
      } catch (err) {
        projectStatus.textContent = 'Clipboard copy failed — check browser permissions';
        projectStatus.className = 'status error';
      }
    });
  }

  // ── "Copy Text" — clean tab-indented text for notes / docs ──
  const btnNavText = document.getElementById('btn-discover-nav-text');
  if (btnNavText) {
    btnNavText.addEventListener('click', async () => {
      if (!discoveredNavStructure) {
        projectStatus.textContent = 'No navigation data — run Crawl Links first';
        projectStatus.className = 'status error';
        return;
      }

      const lines = [];
      const nav = discoveredNavStructure;

      // Header nav
      if (nav.header && nav.header.items && nav.header.items.length > 0) {
        lines.push(`[${nav.header.label || 'Main Navigation'}]`);
        for (const item of nav.header.items) {
          lines.push(`\t${item.label}${item.url ? '  ' + item.url : ''}`);
          if (item.children) {
            for (const child of item.children) {
              lines.push(`\t\t${child.label}${child.url ? '  ' + child.url : ''}`);
              if (child.children) {
                for (const gc of child.children) {
                  lines.push(`\t\t\t${gc.label}${gc.url ? '  ' + gc.url : ''}`);
                }
              }
            }
          }
        }
      }

      // Footer groups
      if (nav.footer && nav.footer.groups) {
        for (const group of nav.footer.groups) {
          if (!group.items || group.items.length === 0) continue;
          lines.push(`[${group.label || 'Footer'}]`);
          for (const item of group.items) {
            lines.push(`\t${item.label}${item.url ? '  ' + item.url : ''}`);
          }
        }
      }

      // Secondary navs
      if (nav.secondary) {
        for (const sec of nav.secondary) {
          if (!sec.items || sec.items.length === 0) continue;
          lines.push(`[${sec.label || 'Secondary Navigation'}]`);
          for (const item of sec.items) {
            lines.push(`\t${item.label}${item.url ? '  ' + item.url : ''}`);
          }
        }
      }

      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        projectStatus.textContent = `Copied navigation structure (${lines.length} lines)`;
        projectStatus.className = 'status success';
      } catch (err) {
        projectStatus.textContent = 'Clipboard copy failed — check browser permissions';
        projectStatus.className = 'status error';
      }
    });
  }

  // Listen for discover progress updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'DISCOVER_PROGRESS') {
      discoverProgressText.textContent = message.text || `Found ${message.count} pages...`;
    }
  });

  // Batch Audit
  btnBatchAudit.addEventListener('click', async () => {
    const urlText = batchUrls.value.trim();
    if (!urlText) return;

    const urls = urlText.split('\n').map(u => u.trim()).filter(u => u && (u.startsWith('http://') || u.startsWith('https://')));
    if (urls.length === 0) {
      projectStatus.textContent = 'No valid URLs found. Each line should start with http:// or https://';
      projectStatus.className = 'status error';
      return;
    }

    const { activeProjectId } = await chrome.storage.local.get('activeProjectId');
    if (!activeProjectId) {
      projectStatus.textContent = 'Select or create a project first';
      projectStatus.className = 'status error';
      return;
    }

    batchRunning = true;
    btnBatchAudit.disabled = true;
    btnBatchAudit.querySelector('.btn-text').textContent = 'Running...';
    btnBatchAudit.querySelector('.btn-spinner').style.display = 'inline-flex';
    batchProgress.style.display = 'flex';
    progressFill.style.width = '0%';
    progressText.textContent = `Auditing 0 of ${urls.length}...`;
    projectStatus.textContent = '';

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'BATCH_AUDIT',
        urls,
        vertical: batchVertical.value,
        projectId: activeProjectId
      });

      if (result?.success) {
        projectStatus.textContent = `Batch complete: ${result.completed} of ${urls.length} audited`;
        projectStatus.className = 'status success';
        showProjectInfo(activeProjectId);
      } else {
        projectStatus.textContent = result?.error || 'Batch audit failed';
        projectStatus.className = 'status error';
      }
    } catch (err) {
      projectStatus.textContent = err.message || 'Batch audit error';
      projectStatus.className = 'status error';
    }

    batchRunning = false;
    btnBatchAudit.disabled = false;
    btnBatchAudit.querySelector('.btn-text').textContent = 'Batch Audit';
    btnBatchAudit.querySelector('.btn-spinner').style.display = 'none';
    batchProgress.style.display = 'none';
  });

  btnBatchStop.addEventListener('click', async () => {
    if (batchRunning) {
      await chrome.runtime.sendMessage({ action: 'BATCH_STOP' });
      projectStatus.textContent = 'Batch stopped';
      projectStatus.className = 'status error';
    }
  });

  // Listen for batch progress updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'BATCH_PROGRESS') {
      const { current, total } = message;
      const pct = Math.round((current / total) * 100);
      progressFill.style.width = pct + '%';
      progressText.textContent = `Auditing ${current} of ${total}...`;
    }
  });

  // View Project Results
  btnViewProject.addEventListener('click', async () => {
    const { activeProjectId } = await chrome.storage.local.get('activeProjectId');
    if (!activeProjectId) return;

    const resultsUrl = chrome.runtime.getURL('results.html') + '?projectId=' + activeProjectId;
    chrome.tabs.create({ url: resultsUrl });
  });

  // Delete Project
  btnDeleteProject.addEventListener('click', async () => {
    const { activeProjectId } = await chrome.storage.local.get('activeProjectId');
    if (!activeProjectId) return;

    try {
      await chrome.runtime.sendMessage({ action: 'DELETE_PROJECT', projectId: activeProjectId });
      await chrome.storage.local.remove('activeProjectId');
      projectSelect.value = '';
      projectInfo.style.display = 'none';
      projectStatus.textContent = 'Project deleted';
      projectStatus.className = 'status success';
      loadProjectList();
    } catch (err) {
      projectStatus.textContent = 'Failed to delete project';
      projectStatus.className = 'status error';
    }
  });

  // ══════════════════════════════════════════════
  //  Shopify Migration Tab
  // ══════════════════════════════════════════════

  const btnAdapt = document.getElementById('btn-adapt-analyze');
  const adaptStatus = document.getElementById('adapt-status');

  btnAdapt.addEventListener('click', async () => {
    btnAdapt.disabled = true;
    btnAdapt.querySelector('.btn-text').textContent = 'Analyzing...';
    btnAdapt.querySelector('.btn-spinner').style.display = 'inline-flex';
    adaptStatus.textContent = '';
    adaptStatus.className = 'status';

    try {
      const result = await chrome.runtime.sendMessage({ action: 'RUN_SHOPIFY_ADAPT' });

      if (result?.success) {
        adaptStatus.textContent = `Analysis complete — ${result.componentCount} components detected`;
        adaptStatus.className = 'status success';
      } else {
        adaptStatus.textContent = result?.error || 'Analysis failed';
        adaptStatus.className = 'status error';
      }
    } catch (err) {
      adaptStatus.textContent = err.message || 'Connection error';
      adaptStatus.className = 'status error';
    }

    btnAdapt.disabled = false;
    btnAdapt.querySelector('.btn-text').textContent = 'Analyze Current Page';
    btnAdapt.querySelector('.btn-spinner').style.display = 'none';
  });

  // ── Whole-Site Shopify Analysis ──

  const btnWholeSite = document.getElementById('btn-adapt-whole-site');
  const wholeSiteHint = document.getElementById('adapt-whole-site-hint');
  const wholeProgress = document.getElementById('adapt-whole-progress');
  const wholeProgressText = document.getElementById('adapt-whole-progress-text');
  const btnWholeSiteStop = document.getElementById('btn-adapt-whole-stop');
  let wholeSiteStopped = false;

  // Show sample-URL count when Shopify Migration tab is activated
  function updateWholeSiteHint() {
    if (!discoveredGroups || Object.keys(discoveredGroups).length === 0) {
      wholeSiteHint.textContent = 'Run Explorer → Discover Pages first to find sample URLs for each template type.';
      wholeSiteHint.className = 'adapt-whole-site-hint warn';
      wholeSiteHint.style.display = 'block';
      if (btnWholeSite) btnWholeSite.disabled = true;
    } else {
      const skipTypes = ['asset', 'feed'];
      const sampleCount = Object.entries(discoveredGroups)
        .filter(([t, g]) => !skipTypes.includes(t) && g.sample)
        .length;
      wholeSiteHint.textContent = `${sampleCount} page templates ready — will analyze one sample URL per type.`;
      wholeSiteHint.className = 'adapt-whole-site-hint';
      wholeSiteHint.style.display = 'block';
      if (btnWholeSite) btnWholeSite.disabled = false;
    }
  }

  // Update hint whenever Shopify Migration tab is shown
  document.querySelectorAll('.popup-tab[data-popup-tab="shopify-adapt"]').forEach(t => {
    t.addEventListener('click', updateWholeSiteHint);
  });
  updateWholeSiteHint();

  if (btnWholeSiteStop) {
    btnWholeSiteStop.addEventListener('click', () => { wholeSiteStopped = true; });
  }

  if (btnWholeSite) {
    btnWholeSite.addEventListener('click', async () => {
      if (!discoveredGroups || Object.keys(discoveredGroups).length === 0) {
        adaptStatus.textContent = 'Run Explorer first to discover page templates';
        adaptStatus.className = 'status error';
        return;
      }

      const skipTypes = ['asset', 'feed', '__collapsed__'];
      const sampleEntries = Object.entries(discoveredGroups)
        .filter(([t, g]) => !skipTypes.includes(t) && g.sample)
        .slice(0, 20); // Cap at 20 pages

      if (sampleEntries.length === 0) {
        adaptStatus.textContent = 'No sample URLs available';
        adaptStatus.className = 'status error';
        return;
      }

      wholeSiteStopped = false;
      btnWholeSite.disabled = true;
      btnWholeSite.querySelector('.btn-text').textContent = 'Analyzing...';
      btnWholeSite.querySelector('.btn-spinner').style.display = 'inline-flex';
      wholeProgress.style.display = 'flex';
      adaptStatus.textContent = '';
      adaptStatus.className = 'status';

      try {
        const sampleUrls = sampleEntries.map(([type, group]) => ({
          type,
          label: group.label,
          url: group.sample
        }));

        // Run analysis page by page, reporting progress
        const pageResults = [];
        for (let i = 0; i < sampleUrls.length; i++) {
          if (wholeSiteStopped) break;
          wholeProgressText.textContent = `Analyzing page ${i + 1} of ${sampleUrls.length}: ${sampleUrls[i].label}...`;

          const result = await chrome.runtime.sendMessage({
            action: 'RUN_WHOLE_SITE_ADAPT_PAGE',
            url: sampleUrls[i].url,
            templateType: sampleUrls[i].type,
            templateLabel: sampleUrls[i].label
          });

          if (result?.success) {
            pageResults.push(result.data);
          }
        }

        wholeProgress.style.display = 'none';

        if (pageResults.length > 0) {
          // Store aggregated results and open results page
          await chrome.runtime.sendMessage({
            action: 'OPEN_WHOLE_SITE_RESULTS',
            pages: pageResults,
            origin: discoveredOrigin || ''
          });
          adaptStatus.textContent = `Whole-site analysis complete — ${pageResults.length} page types analyzed`;
          adaptStatus.className = 'status success';
        } else {
          adaptStatus.textContent = wholeSiteStopped ? 'Stopped' : 'No results collected';
          adaptStatus.className = 'status error';
        }
      } catch (err) {
        adaptStatus.textContent = err.message || 'Analysis failed';
        adaptStatus.className = 'status error';
        wholeProgress.style.display = 'none';
      }

      btnWholeSite.disabled = false;
      btnWholeSite.querySelector('.btn-text').textContent = 'Analyze Whole Site';
      btnWholeSite.querySelector('.btn-spinner').style.display = 'none';
    });
  }

  // ── Explorer: CSV Export ──

  const btnDiscoverCsv = document.getElementById('btn-discover-csv');
  if (btnDiscoverCsv) {
    btnDiscoverCsv.addEventListener('click', () => {
      if (!discoveredGroups || Object.keys(discoveredGroups).length === 0) {
        projectStatus.textContent = 'No discovery data to export';
        projectStatus.className = 'status error';
        return;
      }

      const rows = ['Type,Label,Template,URL Count,Sample URL'];
      Object.entries(discoveredGroups).forEach(([type, group]) => {
        if (type === '__collapsed__') return;
        const template = group.template || 'unique';
        const count = group.urls?.length || 0;
        const sample = group.sample || '';
        rows.push(`"${type}","${group.label}","${template}",${count},"${sample}"`);
      });

      // Also include all individual URLs if available
      const allRows = ['URL,Type,Label'];
      Object.entries(discoveredGroups).forEach(([type, group]) => {
        if (type === '__collapsed__') return;
        (group.urls || []).forEach(url => {
          allRows.push(`"${url}","${type}","${group.label}"`);
        });
      });

      const csv = rows.join('\n') + '\n\n' + allRows.join('\n');
      navigator.clipboard.writeText(csv).then(() => {
        projectStatus.textContent = `CSV copied — ${rows.length - 1} template rows + all URLs`;
        projectStatus.className = 'status success';
      }).catch(() => {
        projectStatus.textContent = 'Clipboard copy failed';
        projectStatus.className = 'status error';
      });
    });

    // Show CSV button whenever discover summary is visible
    const discoverSummaryEl = document.getElementById('discover-summary');
    if (discoverSummaryEl) {
      const observer = new MutationObserver(() => {
        btnDiscoverCsv.style.display = discoverSummaryEl.style.display === 'none' ? 'none' : '';
      });
      observer.observe(discoverSummaryEl, { attributes: true, attributeFilter: ['style'] });
    }
  }
});
