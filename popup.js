// EchoFlow Popup Script
// Handles vertical/mode selection, audit triggering, and file loading.

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

  // ── Page Type Options per Vertical ──

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

  // ── Vertical Selection ──

  document.querySelectorAll('.vertical-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.vertical-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectedVertical = card.dataset.vertical;
      updatePageTypeSelector(selectedVertical);
    });
  });

  // ── Get Selected Mode ──

  function getSelectedMode() {
    const checked = document.querySelector('input[name="mode"]:checked');
    return checked ? checked.value : 'viewport';
  }

  function getSelectedResolution() {
    const checked = document.querySelector('input[name="resolution"]:checked');
    return checked ? checked.value : '100';
  }

  // ── Run Audit ──

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    btnText.textContent = 'Analyzing...';
    btnSpinner.style.display = 'inline-flex';
    statusEl.textContent = '';
    statusEl.className = 'status';

    const mode = getSelectedMode();

    if (mode === 'region') {
      statusEl.textContent = 'Click an element on the page to select a region...';
      // Close popup briefly so user can interact with the page
      // The content script handles the picker; background handles the flow
    }

    try {
      const pageTypeSelect = document.getElementById('page-type-select');
      const pageType = PAGE_TYPES[selectedVertical] ? pageTypeSelect.value : null;

      const result = await chrome.runtime.sendMessage({
        action: 'START_AUDIT',
        vertical: selectedVertical,
        pageType: pageType,
        mode: mode,
        resolution: getSelectedResolution()
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

  // ── Load Saved Audit ──

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

      // Basic validation
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

  // ── Retry Button ──

  const retryBtn = document.getElementById('retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      errorPanel.style.display = 'none';
      capturePanel.style.display = 'block';
    });
  }
});
