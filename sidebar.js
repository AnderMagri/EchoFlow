// EchoFlow Sidebar Script
// Handles the persistent side-panel UI: live design scan, full audit trigger,
// explorer, and Shopify Migration.

document.addEventListener('DOMContentLoaded', () => {

  // ═══════════════════════════════════════
  //  Tab switching
  // ═══════════════════════════════════════

  document.querySelectorAll('.sb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sb-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sb-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById('sb-tab-' + tab.dataset.sbTab);
      if (target) target.classList.add('active');
    });
  });

  // ═══════════════════════════════════════
  //  Settings panel
  // ═══════════════════════════════════════

  const settingsBtn   = document.getElementById('sb-settings-btn');
  const settingsPanel = document.getElementById('sb-settings-panel');
  const settingsClose = document.getElementById('sb-settings-close');
  const claudeKeyInput = document.getElementById('sb-claude-key');
  const saveSettingsBtn = document.getElementById('sb-save-settings');
  const settingsStatus = document.getElementById('sb-settings-status');

  // Load saved key
  chrome.storage.local.get('claudeApiKey').then(({ claudeApiKey }) => {
    if (claudeApiKey && claudeKeyInput) claudeKeyInput.value = claudeApiKey;
  });

  settingsBtn?.addEventListener('click', () => {
    settingsPanel.style.display = 'flex';
  });

  settingsClose?.addEventListener('click', () => {
    settingsPanel.style.display = 'none';
  });

  settingsPanel?.addEventListener('click', (e) => {
    if (e.target === settingsPanel) settingsPanel.style.display = 'none';
  });

  saveSettingsBtn?.addEventListener('click', async () => {
    const key = claudeKeyInput?.value?.trim() || '';
    await chrome.storage.local.set({ claudeApiKey: key });
    settingsStatus.textContent = 'Saved ✓';
    settingsStatus.className = 'sb-status success';
    setTimeout(() => { settingsPanel.style.display = 'none'; settingsStatus.textContent = ''; }, 1200);
  });

  // ═══════════════════════════════════════
  //  Design Tab — Live Design Scan
  // ═══════════════════════════════════════

  const scanBtn     = document.getElementById('sb-scan-btn');
  const scanLabel   = document.getElementById('sb-scan-label');
  const designEmpty = document.getElementById('sb-design-empty');
  const designResults = document.getElementById('sb-design-results');
  const designStatus = document.getElementById('sb-design-status');

  scanBtn?.addEventListener('click', async () => {
    scanBtn.disabled = true;
    scanLabel.textContent = 'Scanning…';
    designStatus.textContent = 'Analyzing design…';
    designStatus.className = 'sb-status loading';
    designEmpty.style.display = 'none';
    designResults.style.display = 'none';

    try {
      const result = await chrome.runtime.sendMessage({ action: 'LIVE_DESIGN_SCAN' });

      if (!result?.success) {
        throw new Error(result?.error || 'Scan failed');
      }

      renderDesignResults(result.inventory, result.url);
      designResults.style.display = 'block';
      designStatus.textContent = '';
    } catch (err) {
      designEmpty.style.display = 'flex';
      designStatus.textContent = err.message || 'Scan failed';
      designStatus.className = 'sb-status error';
    }

    scanBtn.disabled = false;
    scanLabel.textContent = 'Scan Design';
  });

  // Full audit button (opens results page)
  const fullAuditBtn = document.getElementById('sb-fullaudit-btn');
  fullAuditBtn?.addEventListener('click', () => {
    // Switch to Audit tab
    document.querySelectorAll('.sb-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sb-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.sb-tab[data-sb-tab="audit"]')?.classList.add('active');
    document.getElementById('sb-tab-audit')?.classList.add('active');
  });

  // ═══════════════════════════════════════
  //  Design Cards Rendering
  // ═══════════════════════════════════════

  function renderDesignResults(inv, url) {
    const health = computeDesignHealth(inv);

    // Health overview
    document.getElementById('sb-health-overview').innerHTML = renderHealthOverview(health);

    // 4 cards
    document.getElementById('sb-card-color').innerHTML      = renderColorCard(inv, health.color);
    document.getElementById('sb-card-typography').innerHTML = renderTypographyCard(inv, health.typography);
    document.getElementById('sb-card-structure').innerHTML  = renderStructureCard(inv, health.structure);
    document.getElementById('sb-card-access').innerHTML     = renderAccessibilityCard(inv, health.accessibility);

    // Scanned URL
    document.getElementById('sb-scanned-url').textContent = url || '';

    // Expand all cards
    document.querySelectorAll('.sb-design-card').forEach(card => {
      card.classList.add('ds-card-expanded');
    });

    // Toggle on header click
    document.querySelectorAll('.ds-card-head').forEach(head => {
      head.addEventListener('click', () => {
        const card = head.closest('.sb-design-card');
        const body = head.nextElementSibling;
        if (!body) return;
        card.classList.toggle('ds-card-expanded');
        body.style.display = card.classList.contains('ds-card-expanded') ? '' : 'none';
      });
    });
  }

  // ── Scoring ──

  function scoreClass(score) {
    return score >= 70 ? 'good' : score >= 45 ? 'mid' : 'bad';
  }

  function computeDesignHealth(inv) {
    // Color score — based on token coverage and color count
    const colorPalette = inv.colorPalette || [];
    const cssVars      = inv.cssTokens?.variables || [];
    const tokenHexes   = buildTokenHexSet(cssVars);
    const tokenized    = colorPalette.filter(c => tokenHexes.has(norm(c.value))).length;
    const coverage     = colorPalette.length ? Math.round((tokenized / colorPalette.length) * 100) : 50;
    let colorScore     = coverage;
    if (colorPalette.length > 18) colorScore = Math.max(0, colorScore - 15);
    if (colorPalette.length > 28) colorScore = Math.max(0, colorScore - 15);
    colorScore = Math.min(100, Math.max(0, colorScore));

    // Typography score
    const families   = inv.fontFamilies || [];
    const fontSizeList = inv.fontSizes || [];
    let typScore = families.length <= 1 ? 95 : families.length === 2 ? 85 :
                   families.length === 3 ? 65 : families.length === 4 ? 40 : 20;
    if (fontSizeList.length > 12) typScore -= 20;
    if (fontSizeList.length > 18) typScore -= 20;
    typScore = Math.min(100, Math.max(0, typScore));

    // Structure score — based on spacing grid adherence + breakpoints
    const gridRatio  = inv.spacingGridRatio || 0;
    const bps        = getAllBreakpoints(inv);
    let structScore  = gridRatio;
    if (bps.length >= 2) structScore = Math.min(100, structScore + 10);
    else if (bps.length === 0) structScore = Math.max(0, structScore - 20);
    structScore = Math.min(100, Math.max(0, structScore));

    // Accessibility score
    const pairs      = inv.contrastPairs || [];
    const fails      = pairs.filter(p => p.level === 'FAIL').length;
    const failRatio  = pairs.length ? fails / pairs.length : 0;
    const contrastScore  = Math.round((1 - failRatio) * 100);
    const focus      = inv.focusStates;
    const focusScore = focus?.hasFocusVisible ? 100 :
                       (focus?.outlineRemovedWithoutReplacement > 0) ? 20 : 60;
    const motionScore = inv.motion?.reducedMotionRespected ? 100 : 65;
    const accScore   = Math.round(contrastScore * 0.55 + focusScore * 0.3 + motionScore * 0.15);

    const overall = Math.round(colorScore * 0.25 + typScore * 0.25 + structScore * 0.2 + accScore * 0.3);

    return {
      overall,
      color:        colorScore,
      typography:   typScore,
      structure:    structScore,
      accessibility: accScore
    };
  }

  function buildTokenHexSet(cssVars) {
    const set = new Set();
    for (const v of cssVars) {
      const val = (v.value || '').trim();
      if (/^#[0-9a-f]{3,8}$/i.test(val)) {
        set.add(norm(val));
      } else {
        // Try parsing rgb/rgba
        const m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (m) {
          const hex = '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
          set.add(norm(hex));
        }
      }
    }
    return set;
  }

  function norm(hex) {
    return (hex || '').toLowerCase().trim();
  }

  function getAllBreakpoints(inv) {
    return [
      ...((inv.breakpoints?.minWidth || []).map(b => b.value)),
      ...((inv.breakpoints?.maxWidth || []).map(b => b.value))
    ].filter((v, i, arr) => arr.indexOf(v) === i).sort((a, b) => a - b);
  }

  // ── Health Overview ──

  function renderHealthOverview(health) {
    const sc   = scoreClass(health.overall);
    const bw   = health.overall;
    const cats = [
      { key: 'color',        label: 'Color',  score: health.color },
      { key: 'typography',   label: 'Type',   score: health.typography },
      { key: 'structure',    label: 'Layout', score: health.structure },
      { key: 'accessibility', label: 'A11y',  score: health.accessibility }
    ];

    return `
      <div class="sb-health-row">
        <div class="sb-health-score ${sc}">${health.overall}</div>
        <div class="sb-health-meta">
          <div class="sb-health-label">Design Health</div>
          <div class="sb-health-bar-track">
            <div class="sb-health-bar-fill ${sc}" style="width:${bw}%"></div>
          </div>
        </div>
      </div>
      <div class="sb-health-signals">
        ${cats.map(c => `
          <div class="sb-signal">
            <span class="sb-signal-num ${scoreClass(c.score)}">${c.score}</span>
            <span class="sb-signal-lbl">${c.label}</span>
          </div>`).join('')}
      </div>`;
  }

  // ── Color Card ──

  function renderColorCard(inv, score) {
    const colors    = (inv.colorPalette || []).slice(0, 18);
    const cssVars   = inv.cssTokens?.variables || [];
    const tokenHexes = buildTokenHexSet(cssVars);
    const tokenized  = colors.filter(c => tokenHexes.has(norm(c.value))).length;
    const coverage   = colors.length ? Math.round((tokenized / colors.length) * 100) : 0;
    const hardcoded  = colors.length - tokenized;

    const swatches = colors.map(c => {
      const isToken = tokenHexes.has(norm(c.value));
      return `<div class="ds-swatch ${isToken ? '' : 'ds-swatch-raw'}"
        style="background:${c.value}"
        title="${c.value}${isToken ? ' · token' : ' · hardcoded'} · ×${c.count}">
      </div>`;
    }).join('');

    const coverageClass = coverage >= 70 ? 'ds-good' : 'ds-warn';

    return `
      <div class="ds-card-head">
        <span class="ds-card-icon">🎨</span>
        <span class="ds-card-title">Color System</span>
        <span class="ds-score-pill ${scoreClass(score)}">${score}</span>
        <span class="ds-chevron">›</span>
      </div>
      <div class="ds-card-body">
        <div class="ds-swatches">${swatches || '<span style="color:#bbb;font-size:11px;">No colors detected</span>'}</div>
        <div class="ds-card-meta">
          <span>${colors.length} unique color${colors.length !== 1 ? 's' : ''}</span>
          ${cssVars.length > 0
            ? `<span class="${coverageClass}">Token coverage: ${coverage}%</span>`
            : '<span class="ds-warn">No CSS tokens found</span>'}
        </div>
        ${hardcoded > 0 && cssVars.length > 0
          ? `<div class="ds-flag">⚠ ${hardcoded} hardcoded color${hardcoded > 1 ? 's' : ''} — dashed border above</div>`
          : ''}
        ${cssVars.length === 0 && colors.length > 0
          ? `<div class="ds-flag">⚠ No CSS custom properties — consider building a token layer</div>`
          : ''}
        ${colors.length > 16
          ? `<div class="ds-flag">⚠ ${colors.length} colors on one page — a focused palette uses 6–12</div>`
          : ''}
      </div>`;
  }

  // ── Typography Card ──

  function renderTypographyCard(inv, score) {
    const families = (inv.fontFamilies || []).slice(0, 5);
    const sizes    = (inv.fontSizes    || []).slice(0, 8);
    const maxCount = Math.max(...sizes.map(s => s.count), 1);

    const scaleRows = sizes.map(s => {
      const px    = parseFloat(s.value) || 16;
      const width = Math.max(4, Math.round((s.count / maxCount) * 100));
      const clampPx = Math.min(Math.max(px, 10), 22);
      return `<div class="ds-type-row">
        <span class="ds-type-size">${Math.round(px)}</span>
        <div class="ds-type-bar-wrap">
          <div class="ds-type-bar" style="width:${width}%"></div>
        </div>
        <span class="ds-type-sample" style="font-size:${clampPx}px">Aa</span>
      </div>`;
    }).join('');

    const familyNames = families.map(f => {
      const name = (f.value || '').split(',')[0].trim().replace(/['"]/g, '');
      return name || f.value;
    }).join(', ');

    return `
      <div class="ds-card-head">
        <span class="ds-card-icon" style="font-weight:900;font-size:12px">Aa</span>
        <span class="ds-card-title">Typography</span>
        <span class="ds-score-pill ${scoreClass(score)}">${score}</span>
        <span class="ds-chevron">›</span>
      </div>
      <div class="ds-card-body">
        <div class="ds-type-scale">${scaleRows || '<span style="color:#bbb;font-size:11px">No font data</span>'}</div>
        <div class="ds-card-meta">
          <span>${families.length} font ${families.length === 1 ? 'family' : 'families'}: ${familyNames}</span>
        </div>
        ${families.length > 2
          ? `<div class="ds-flag">⚠ ${families.length} font families — aim for 2 or fewer for visual consistency</div>`
          : ''}
        ${sizes.length > 10
          ? `<div class="ds-flag">⚠ ${inv.fontSizes?.length || sizes.length} different font sizes — consider a defined type scale</div>`
          : ''}
      </div>`;
  }

  // ── Structure Card ──

  function renderStructureCard(inv, score) {
    const bps         = getAllBreakpoints(inv);
    const layout      = inv.layoutSystem || {};
    const gridRatio   = inv.spacingGridRatio || 0;
    const spacingBase = layout.spacingBase || 8;
    const flexPct     = layout.layoutEngines?.flex  || 0;
    const gridPct     = layout.layoutEngines?.grid  || 0;

    const bpHtml = bps.length > 0
      ? `<div class="ds-bp-chips">${bps.map(b => `<span class="ds-bp-chip">${b}px</span>`).join('')}</div>`
      : `<div class="ds-flag">⚠ No responsive breakpoints detected in stylesheets</div>`;

    return `
      <div class="ds-card-head">
        <span class="ds-card-icon">⊞</span>
        <span class="ds-card-title">Structure</span>
        <span class="ds-score-pill ${scoreClass(score)}">${score}</span>
        <span class="ds-chevron">›</span>
      </div>
      <div class="ds-card-body">
        <div class="ds-structure-rows">
          <div class="ds-structure-row">
            <span class="ds-structure-label">Spacing</span>
            <div class="ds-structure-bar-wrap">
              <div class="ds-structure-bar" style="width:${gridRatio}%"></div>
            </div>
            <span class="ds-structure-val">${gridRatio}% on ${spacingBase}px grid</span>
          </div>
        </div>
        ${bpHtml}
        <div class="ds-card-meta">
          <span>${bps.length} breakpoint${bps.length !== 1 ? 's' : ''}</span>
          <span>${flexPct}% flex · ${gridPct}% grid</span>
        </div>
        ${gridRatio < 50 && gridRatio > 0
          ? `<div class="ds-flag">⚠ Only ${gridRatio}% of spacing values follow the ${spacingBase}px grid</div>`
          : ''}
      </div>`;
  }

  // ── Accessibility Card ──

  function renderAccessibilityCard(inv, score) {
    const fails  = (inv.contrastPairs || []).filter(p => p.level === 'FAIL').slice(0, 4);
    const passes = (inv.contrastPairs || []).filter(p => p.level !== 'FAIL');
    const focus  = inv.focusStates;
    const motion = inv.motion;

    const contrastHtml = fails.length === 0
      ? `<div class="ds-acc-check pass">✓ ${passes.length ? `${passes.length} sampled contrast pairs all pass` : 'No contrast issues detected'}</div>`
      : fails.map(f => `
          <div class="ds-contrast-fail">
            <div class="ds-contrast-swatches">
              <div style="width:14px;height:14px;border-radius:2px;background:${f.textHex};border:1px solid rgba(0,0,0,0.1)"></div>
              <div style="width:14px;height:14px;border-radius:2px;background:${f.bgHex};border:1px solid rgba(0,0,0,0.1)"></div>
            </div>
            <span class="ds-contrast-ratio">${f.ratio}:1</span>
            <span class="ds-contrast-tag">${f.tag} · ${f.fontSize}px</span>
          </div>`).join('');

    const focusHtml = focus?.hasFocusVisible
      ? `<div class="ds-acc-check pass">✓ :focus-visible styles declared</div>`
      : (focus?.outlineRemovedWithoutReplacement > 0)
        ? `<div class="ds-acc-check fail">✕ Outline removed without replacement (${focus.outlineRemovedWithoutReplacement} rules)</div>`
        : `<div class="ds-acc-check warn">○ No custom focus styles found</div>`;

    const motionHtml = motion?.reducedMotionRespected
      ? `<div class="ds-acc-check pass">✓ prefers-reduced-motion declared</div>`
      : `<div class="ds-acc-check warn">○ No reduced-motion media query</div>`;

    return `
      <div class="ds-card-head">
        <span class="ds-card-icon">♿</span>
        <span class="ds-card-title">Accessibility</span>
        <span class="ds-score-pill ${scoreClass(score)}">${score}</span>
        <span class="ds-chevron">›</span>
      </div>
      <div class="ds-card-body">
        ${fails.length > 0 ? `<div style="font-size:11px;color:#e53935;font-weight:600;margin-bottom:4px;">Contrast failures (${fails.length})</div>` : ''}
        ${contrastHtml}
        <div style="margin-top:6px;">
          ${focusHtml}
          ${motionHtml}
        </div>
      </div>`;
  }

  // ═══════════════════════════════════════
  //  Audit Tab
  // ═══════════════════════════════════════

  let selectedVertical = 'generic-ux';
  let selectedDevice   = 'desktop';

  const PAGE_TYPES = {
    'shopify':  [{ value: 'homepage', label: 'Homepage' }, { value: 'pdp', label: 'Product Page' }, { value: 'collection', label: 'Collection' }, { value: 'checkout', label: 'Checkout' }, { value: 'other', label: 'Other' }],
    'fintech':  [{ value: 'dashboard', label: 'Dashboard' }, { value: 'onboarding', label: 'Onboarding' }, { value: 'payment', label: 'Payment' }, { value: 'landing', label: 'Landing' }, { value: 'other', label: 'Other' }],
    'crypto':   [{ value: 'wallet', label: 'Wallet' }, { value: 'exchange', label: 'Exchange' }, { value: 'defi', label: 'DeFi' }, { value: 'onboarding', label: 'Onboarding' }, { value: 'other', label: 'Other' }]
  };

  document.querySelectorAll('.sb-vertical').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sb-vertical').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedVertical = btn.dataset.vertical;
      updatePageTypeSelect(selectedVertical);
    });
  });

  document.querySelectorAll('.sb-device').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sb-device').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedDevice = btn.dataset.device;
    });
  });

  function updatePageTypeSelect(vertical) {
    const section = document.getElementById('sb-page-type-section');
    const select  = document.getElementById('sb-page-type-select');
    if (!PAGE_TYPES[vertical]) { section.style.display = 'none'; return; }
    select.innerHTML = PAGE_TYPES[vertical].map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    section.style.display = 'block';
  }

  const runAuditBtn   = document.getElementById('sb-run-audit-btn');
  const runAuditLabel = document.getElementById('sb-run-audit-label');
  const auditStatus   = document.getElementById('sb-audit-status');

  runAuditBtn?.addEventListener('click', async () => {
    runAuditBtn.disabled = true;
    runAuditLabel.textContent = 'Starting…';
    auditStatus.textContent = '';
    auditStatus.className = 'sb-status';

    try {
      const pageTypeSelect = document.getElementById('sb-page-type-select');
      const pageType = PAGE_TYPES[selectedVertical] ? pageTypeSelect?.value : null;

      const result = await chrome.runtime.sendMessage({
        action: 'START_AUDIT',
        vertical: selectedVertical,
        pageType,
        mode: 'viewport',
        device: selectedDevice,
        projectId: null
      });

      if (result?.success) {
        auditStatus.textContent = result.findingCount + ' findings — results opened in new tab';
        auditStatus.className = 'sb-status success';
      } else {
        throw new Error(result?.error || 'Audit failed');
      }
    } catch (err) {
      auditStatus.textContent = err.message || 'Connection error';
      auditStatus.className = 'sb-status error';
    }

    runAuditBtn.disabled = false;
    runAuditLabel.textContent = 'Run Full Audit';
  });

  // ═══════════════════════════════════════
  //  Migration Tab
  // ═══════════════════════════════════════

  const migrateBtn    = document.getElementById('sb-migrate-btn');
  const migrateLabel  = document.getElementById('sb-migrate-label');
  const migrateStatus = document.getElementById('sb-migrate-status');

  migrateBtn?.addEventListener('click', async () => {
    migrateBtn.disabled = true;
    migrateLabel.textContent = 'Analyzing…';
    migrateStatus.textContent = 'Running Shopify analysis…';
    migrateStatus.className = 'sb-status loading';

    try {
      const result = await chrome.runtime.sendMessage({ action: 'RUN_SHOPIFY_ADAPT' });
      if (result?.success) {
        migrateStatus.textContent = `Done — ${result.componentCount} components detected. Results opened.`;
        migrateStatus.className = 'sb-status success';
      } else {
        throw new Error(result?.error || 'Analysis failed');
      }
    } catch (err) {
      migrateStatus.textContent = err.message || 'Error';
      migrateStatus.className = 'sb-status error';
    }

    migrateBtn.disabled = false;
    migrateLabel.textContent = 'Analyze for Shopify';
  });

  // ═══════════════════════════════════════
  //  Explorer Tab (minimal bridge — full logic is in popup.js)
  // ═══════════════════════════════════════

  document.getElementById('sb-discover-sitemap')?.addEventListener('click', () => {
    runDiscover('sitemap');
  });

  document.getElementById('sb-discover-crawl')?.addEventListener('click', () => {
    runDiscover('crawl');
  });

  document.getElementById('sb-discover-stop')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'DISCOVER_STOP' });
  });

  let discoverPoll = null;

  async function runDiscover(method) {
    const explStatus = document.getElementById('sb-explorer-status');
    explStatus.textContent = 'Starting discovery…';
    explStatus.className = 'sb-status loading';

    const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
    const tab  = tabs[0];
    if (!tab) { explStatus.textContent = 'No active tab'; explStatus.className = 'sb-status error'; return; }

    let origin;
    try { origin = new URL(tab.url).origin; } catch {
      explStatus.textContent = 'Invalid page URL'; explStatus.className = 'sb-status error'; return;
    }

    await chrome.runtime.sendMessage({ action: 'DISCOVER_CLEAR' });
    await chrome.runtime.sendMessage({ action: 'DISCOVER_PAGES', method, origin, startUrl: tab.url });

    document.getElementById('sb-discover-progress').style.display = 'flex';

    clearInterval(discoverPoll);
    discoverPoll = setInterval(async () => {
      const r = await chrome.runtime.sendMessage({ action: 'DISCOVER_STATE' });
      const state = r?.state;
      document.getElementById('sb-discover-progress-text').textContent = state?.progressText || '';

      if (state?.status === 'completed' || state?.status === 'stopped' || state?.status === 'error') {
        clearInterval(discoverPoll);
        document.getElementById('sb-discover-progress').style.display = 'none';

        if (state.status === 'error') {
          explStatus.textContent = state.error || 'Discovery error';
          explStatus.className = 'sb-status error';
          return;
        }

        const urls = state.result?.urls || [];
        explStatus.textContent = `${urls.length} pages found`;
        explStatus.className = 'sb-status success';
        document.getElementById('sb-discover-summary').style.display = 'block';
        document.getElementById('sb-discover-total').textContent = `${urls.length} pages discovered`;
      }
    }, 1200);
  }

});
