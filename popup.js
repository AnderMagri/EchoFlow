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

  function getSelectedResolution() {
    const checked = document.querySelector('input[name="resolution"]:checked');
    return checked ? checked.value : '100';
  }

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

      const result = await chrome.runtime.sendMessage({
        action: 'START_AUDIT',
        vertical: selectedVertical,
        pageType: pageType,
        mode: mode,
        resolution: getSelectedResolution(),
        projectId: activeProjectId || null
      });

      if (result?.success) {
        statusEl.textContent = result.findingCount + ' findings detected';
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

  function renderDiscoverSummary(groups, totalCount) {
    const summary = document.getElementById('discover-summary');
    const totalEl = document.getElementById('discover-total');
    const groupsEl = document.getElementById('discover-groups');

    // Each group is one "page template" — maps 1:1 to a black rectangle in the Figma IA diagram
    const templateCount = Object.keys(groups).length;

    totalEl.innerHTML = `
      <span>${totalCount.toLocaleString()} pages found</span>
      <span class="discover-templates">${templateCount} page templates</span>
    `;
    groupsEl.innerHTML = '';

    // Display order: unique pages first (each is a template), then shared-template groups
    const typeOrder = ['homepage', 'collection-index', 'shop-index', 'product', 'collection', 'blog-index', 'blog-post',
      'login', 'register', 'account', 'account-orders', 'wishlist',
      'cart', 'checkout', 'search', 'contact', 'help-center', 'help-article', 'faq',
      'about', 'our-story', 'team', 'careers', 'press',
      'store-locator', 'store-detail', 'gift-card', 'loyalty',
      'policy-privacy', 'policy-terms', 'policy-refund', 'policy-shipping', 'policy-cookie', 'policy-other',
      '404', 'other'];

    const entries = Object.entries(groups);
    entries.sort((a, b) => {
      const ai = typeOrder.indexOf(a[0]);
      const bi = typeOrder.indexOf(b[0]);
      // page:xxx entries go between known unique pages and 'other'
      const aIdx = ai >= 0 ? ai : (a[0].startsWith('page:') ? 90 : 99);
      const bIdx = bi >= 0 ? bi : (b[0].startsWith('page:') ? 90 : 99);
      return aIdx - bIdx;
    });

    // Overflow cap: if we have >30 unique-template rows, collapse the tail so the list stays scannable.
    // Shared-template rows (product, collection, blog posts) never get capped — they're always just 1 row each.
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
      // Stash collapsed group entries under a synthetic key so "Copy for FigJam" / batch still see a sample
      const collapsedSample = tail[0]?.[1]?.sample || '';
      groups['__collapsed__'] = {
        label: `Other Pages (${collapsedCount} more)`,
        urls: tail.flatMap(([_, g]) => g.urls),
        sample: collapsedSample,
        template: 'unique'
      };
    }

    // Show a warning banner above the list when the cap fired
    if (capTriggered) {
      const warn = document.createElement('div');
      warn.className = 'discover-warning';
      warn.textContent = `${collapsedUrlCount.toLocaleString()} URLs collapsed into "Other Pages" — site may use a non-standard URL structure.`;
      groupsEl.appendChild(warn);
    }

    // Render order: visible unique entries (sorted), then shared entries, then the synthetic collapsed row
    const renderList = [...visibleUnique, ...sharedEntries];
    if (capTriggered) renderList.push(['__collapsed__', groups['__collapsed__']]);

    for (const [type, group] of renderList) {
      const row = document.createElement('label');
      row.className = 'discover-group-row';

      const isShared = group.template === 'shared';
      const count = group.urls.length;
      const checked = type !== 'feed' && type !== 'asset';

      // For shared templates: show count badge. When the backend sampled
      // (e.g. kept 5 of 8,400 products), show "5 / 8,400" so the user sees
      // both what was kept and the real size of the template.
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
      groupsEl.appendChild(row);
    }

    summary.style.display = 'block';
  }

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

    btnDiscoverSitemap.disabled = true;
    btnDiscoverCrawl.disabled = true;
    discoverProgress.style.display = 'flex';
    discoverProgressText.textContent = method === 'sitemap' ? 'Fetching sitemap...' : 'Crawling links...';
    projectStatus.textContent = '';
    document.getElementById('discover-summary').style.display = 'none';

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'DISCOVER_PAGES',
        method,
        origin,
        startUrl: tab.url
      });

      if (result?.success && result.urls?.length > 0) {
        discoveredGroups = groupDiscoveredUrls(result.urls);
        // Annotate shared-template groups with the real backend-detected totals.
        // Without this, a "Product Pages" group would show 5 even though the
        // site has 8,400 products — the 5 is our sample cap, not reality.
        const stats = result.sampleStats || {};
        for (const [key, stat] of Object.entries(stats)) {
          if (discoveredGroups[key]) {
            discoveredGroups[key].totalDetected = stat.total;
            discoveredGroups[key].sampledCount = stat.kept;
            discoveredGroups[key].skippedCount = stat.skipped;
          }
        }
        const totalDetected = result.totalDetected || result.urls.length;
        renderDiscoverSummary(discoveredGroups, totalDetected);
        const collapsed = totalDetected - result.urls.length;
        projectStatus.textContent = collapsed > 0
          ? `Found ${totalDetected.toLocaleString()} pages (${collapsed.toLocaleString()} collapsed into samples) via ${method}`
          : `Found ${result.urls.length.toLocaleString()} pages via ${method}`;
        projectStatus.className = 'status success';
      } else if (result?.success && result.urls?.length === 0) {
        projectStatus.textContent = method === 'sitemap'
          ? 'No sitemap found. Try "Crawl Links" instead.'
          : 'No links discovered on this page.';
        projectStatus.className = 'status error';
      } else {
        projectStatus.textContent = result?.error || 'Discovery failed';
        projectStatus.className = 'status error';
      }
    } catch (err) {
      projectStatus.textContent = err.message || 'Discovery failed';
      projectStatus.className = 'status error';
    }

    btnDiscoverSitemap.disabled = false;
    btnDiscoverCrawl.disabled = false;
    discoverProgress.style.display = 'none';
  }

  btnDiscoverSitemap.addEventListener('click', () => runDiscover('sitemap'));
  btnDiscoverCrawl.addEventListener('click', () => runDiscover('crawl'));

  btnDiscoverStop.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'DISCOVER_STOP' });
    btnDiscoverSitemap.disabled = false;
    btnDiscoverCrawl.disabled = false;
    discoverProgress.style.display = 'none';
    projectStatus.textContent = 'Discovery stopped';
    projectStatus.className = 'status error';
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

  // "Copy for FigJam" — puts one tab-separated `Label<TAB>URL` row per checked template on the clipboard.
  // Format is compatible with FigJam sitemap plugins (Sitemap, Autoflow, Sitemapping for FigJam) which
  // accept either plain URL lists or delimited text. One row = one black rectangle in the IA diagram.
  const btnDiscoverFigjam = document.getElementById('btn-discover-figjam');
  if (btnDiscoverFigjam) {
    btnDiscoverFigjam.addEventListener('click', async () => {
      const checks = document.querySelectorAll('.discover-group-check:checked');
      const lines = [];
      checks.forEach(chk => {
        const type = chk.dataset.type;
        const group = discoveredGroups[type];
        if (group && group.sample) {
          lines.push(`${group.label}\t${group.sample}`);
        }
      });

      if (lines.length === 0) {
        projectStatus.textContent = 'No templates selected';
        projectStatus.className = 'status error';
        return;
      }

      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        projectStatus.textContent = `Copied ${lines.length} templates for FigJam`;
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
    btnAdapt.querySelector('.btn-text').textContent = 'Analyze for Shopify';
    btnAdapt.querySelector('.btn-spinner').style.display = 'none';
  });
});
