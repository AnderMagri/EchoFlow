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

  async function runDiscover(method) {
    // Get the current tab's URL to determine the domain
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      projectStatus.textContent = 'No active tab';
      projectStatus.className = 'status error';
      return;
    }

    let origin;
    try {
      origin = new URL(tab.url).origin;
    } catch {
      projectStatus.textContent = 'Cannot determine site URL';
      projectStatus.className = 'status error';
      return;
    }

    btnDiscoverSitemap.disabled = true;
    btnDiscoverCrawl.disabled = true;
    discoverProgress.style.display = 'flex';
    discoverProgressText.textContent = method === 'sitemap' ? 'Fetching sitemap...' : 'Crawling links...';
    projectStatus.textContent = '';

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'DISCOVER_PAGES',
        method,
        origin,
        startUrl: tab.url
      });

      const discoverResults = document.getElementById('discover-results');
      if (result?.success && result.urls?.length > 0) {
        // Show results in the discover textarea
        discoverResults.value = result.urls.join('\n');
        discoverResults.style.display = 'block';
        // Also populate batch textarea if project is active
        if (batchUrls) batchUrls.value = result.urls.join('\n');
        projectStatus.textContent = `Found ${result.urls.length} pages via ${method}`;
        projectStatus.className = 'status success';
      } else if (result?.success && result.urls?.length === 0) {
        discoverResults.style.display = 'none';
        projectStatus.textContent = method === 'sitemap'
          ? 'No sitemap found. Try "Crawl Links" instead.'
          : 'No links discovered on this page.';
        projectStatus.className = 'status error';
      } else {
        discoverResults.style.display = 'none';
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
