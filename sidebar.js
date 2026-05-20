// EchoFlow Sidebar v2

document.addEventListener('DOMContentLoaded', () => {

  // ── Lucide-style SVG icon constants ──
  const IC = {
    palette:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
    type:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
    layout:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
    svgIcon:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 22 22 7 12 2"/></svg>`,
    chevron:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    copy:     `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    download: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    settings: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
    tech: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  };

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
      // When Explorer tab opens, refresh tech card if we have a scan
      if (tab.dataset.sbTab === 'explorer' && lastInventory) {
        populateExplorerTechCard(lastInventory);
      }
    });
  });

  // ═══════════════════════════════════════
  //  Settings Tab
  // ═══════════════════════════════════════

  const claudeKeyInput  = document.getElementById('sb-claude-key');
  const saveSettingsBtn = document.getElementById('sb-save-settings');
  const settingsStatus  = document.getElementById('sb-settings-status');

  chrome.storage.local.get('claudeApiKey').then(({ claudeApiKey }) => {
    if (claudeApiKey && claudeKeyInput) claudeKeyInput.value = claudeApiKey;
  });

  saveSettingsBtn?.addEventListener('click', async () => {
    const key = claudeKeyInput?.value?.trim() || '';
    await chrome.storage.local.set({ claudeApiKey: key });
    settingsStatus.textContent = 'Saved';
    settingsStatus.className = 'sb-status success';
    setTimeout(() => { settingsStatus.textContent = ''; }, 1500);
  });

  // ═══════════════════════════════════════
  //  Design Tab — Live Design Scan
  // ═══════════════════════════════════════

  const scanBtn      = document.getElementById('sb-scan-btn');
  const scanLabel    = document.getElementById('sb-scan-label');
  const designEmpty  = document.getElementById('sb-design-empty');
  const designResults = document.getElementById('sb-design-results');
  const designStatus = document.getElementById('sb-design-status');

  let lastInventory  = null;
  let lastUrl        = null;

  scanBtn?.addEventListener('click', async () => {
    scanBtn.disabled = true;
    scanLabel.textContent = 'Scanning…';
    designStatus.textContent = 'Analyzing…';
    designStatus.className = 'sb-status loading';
    designEmpty.style.display = 'none';
    designResults.style.display = 'none';

    try {
      const result = await chrome.runtime.sendMessage({ action: 'LIVE_DESIGN_SCAN' });
      if (!result?.success) throw new Error(result?.error || 'Scan failed');

      lastInventory = result.inventory;
      lastUrl       = result.url;
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

  // Full audit button → switch to Audit tab
  document.getElementById('sb-fullaudit-btn')?.addEventListener('click', () => {
    document.querySelectorAll('.sb-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sb-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.sb-tab[data-sb-tab="audit"]')?.classList.add('active');
    document.getElementById('sb-tab-audit')?.classList.add('active');
  });

  // ═══════════════════════════════════════
  //  Design Cards Rendering
  // ═══════════════════════════════════════

  // System fonts that are always available — no need to load these
  const SYSTEM_FONTS = new Set([
    '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'helvetica neue', 'helvetica',
    'arial', 'sans-serif', 'serif', 'monospace', 'times new roman', 'georgia',
    'trebuchet ms', 'verdana', 'tahoma', 'courier new', 'courier', 'system-ui',
    'ui-sans-serif', 'ui-serif', 'ui-monospace', 'cursive', 'fantasy',
  ]);

  function injectPageFonts(inv) {
    document.querySelectorAll('.__ef-gf, #__ef-fonts').forEach(el => el.remove());

    // Step 1: inject any Google Fonts <link> tags captured directly from the page
    const injectedLinks = new Set();
    for (const href of inv.googleFontLinks || []) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.className = '__ef-gf';
      link.href = href;
      document.head.appendChild(link);
      injectedLinks.add(href);
    }

    // Step 2: best-effort — for any non-system font family, request it from
    // Google Fonts by name. Works regardless of HOW the page originally loaded it.
    const candidates = (inv.fontFamilies || [])
      .map(f => (f.value || '').trim().replace(/['"]/g, ''))
      .filter(name => name && !SYSTEM_FONTS.has(name.toLowerCase()))
      .slice(0, 5);

    if (candidates.length > 0) {
      const params = candidates
        .map(f => `family=${encodeURIComponent(f)}:ital,wght@0,300;0,400;0,600;0,700;1,400`)
        .join('&');
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.className = '__ef-gf';
      link.href = `https://fonts.googleapis.com/css2?${params}&display=swap`;
      document.head.appendChild(link);
    }

    // Step 3: self-hosted @font-face rules (same-origin sheets only)
    const rules = inv.fontFaceRules || [];
    if (rules.length) {
      const style = document.createElement('style');
      style.id = '__ef-fonts';
      style.textContent = rules.join('\n');
      document.head.appendChild(style);
    }
  }

  function renderDesignResults(inv, url) {
    const health = computeDesignHealth(inv);

    injectPageFonts(inv);

    document.getElementById('sb-health-overview').innerHTML  = renderHealthOverview(health);
    document.getElementById('sb-card-color').innerHTML       = renderColorCard(inv, health.color, health);
    document.getElementById('sb-card-typography').innerHTML  = renderTypographyCard(inv, health.typography);
    document.getElementById('sb-card-structure').innerHTML   = renderStructureCard(inv, health.structure);
    document.getElementById('sb-card-access').innerHTML      = renderSVGCard(inv);

    // Tech stack lives in Explorer tab
    populateExplorerTechCard(inv);

    // URL + export button
    document.getElementById('sb-scanned-url').innerHTML =
      `<span>${url || ''}</span>
       <button class="ds-export-btn" id="sb-export-tokens">${IC.download} Export Tokens</button>`;

    // Expand all cards
    document.querySelectorAll('.sb-design-card').forEach(c => c.classList.add('ds-card-expanded'));

    // Card collapse toggle (click card head)
    document.querySelectorAll('.ds-card-head').forEach(head => {
      head.addEventListener('click', () => {
        const card = head.closest('.sb-design-card');
        const body = head.nextElementSibling;
        if (!body) return;
        card.classList.toggle('ds-card-expanded');
        body.style.display = card.classList.contains('ds-card-expanded') ? '' : 'none';
      });
    });

    // Color inner tab switching
    document.querySelectorAll('.ds-ctab').forEach(tab => {
      tab.addEventListener('click', e => {
        e.stopPropagation();
        const body = tab.closest('.ds-card-body');
        body.querySelectorAll('.ds-ctab').forEach(t => t.classList.remove('active'));
        body.querySelectorAll('.ds-ctab-pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        body.querySelector(`[data-pane="${tab.dataset.ctab}"]`)?.classList.add('active');
      });
    });

    // Copy hex buttons
    document.querySelectorAll('.ds-copy-hex').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        navigator.clipboard.writeText(btn.dataset.copy || '').then(() => {
          btn.textContent = '✓';
          btn.style.color = '#00C9A7';
          setTimeout(() => { btn.innerHTML = IC.copy; btn.style.color = ''; }, 1200);
        }).catch(() => {});
      });
    });

    // Export tokens
    document.getElementById('sb-export-tokens')?.addEventListener('click', () => {
      exportTokensJSON(inv, url);
    });
  }

  // ── Scoring ──

  function scoreClass(score) {
    return score >= 70 ? 'good' : score >= 45 ? 'mid' : 'bad';
  }

  function computeDesignHealth(inv) {
    const colorPalette = inv.colorPalette || [];
    const cssVars      = inv.cssTokens?.variables || [];
    const tokenHexes   = buildTokenHexSet(cssVars);

    // Color score: if no CSS token system, score based on palette discipline only
    let colorScore;
    if (cssVars.length === 0) {
      colorScore = colorPalette.length === 0 ? 50 :
                   colorPalette.length <= 8  ? 78 :
                   colorPalette.length <= 14 ? 62 :
                   colorPalette.length <= 20 ? 44 : 22;
    } else {
      const tokenized = colorPalette.filter(c => tokenHexes.has(norm(c.value))).length;
      const coverage  = colorPalette.length ? Math.round((tokenized / colorPalette.length) * 100) : 50;
      colorScore = Math.max(20, coverage); // floor: having a token system at all is worth 20
      if (colorPalette.length > 18) colorScore = Math.max(15, colorScore - 15);
      if (colorPalette.length > 28) colorScore = Math.max(10, colorScore - 15);
    }
    colorScore = Math.min(100, Math.max(0, colorScore));

    // Typography score
    const families     = inv.fontFamilies || [];
    const fontSizeList = inv.fontSizes || [];
    let typScore = families.length <= 1 ? 95 : families.length === 2 ? 85 :
                   families.length === 3 ? 65 : families.length === 4 ? 40 : 20;
    if (fontSizeList.length > 12) typScore -= 20;
    if (fontSizeList.length > 18) typScore -= 20;
    typScore = Math.min(100, Math.max(0, typScore));

    // Structure score — base of 25 so a real page never hits 0
    const gridRatio  = inv.spacingGridRatio || 0;
    const bps        = getAllBreakpoints(inv);
    let structScore  = Math.max(25, gridRatio);
    if (bps.length >= 2) structScore = Math.min(100, structScore + 10);
    else if (bps.length === 0) structScore = Math.max(20, structScore - 10);
    structScore = Math.min(100, Math.max(0, structScore));

    // Accessibility score
    const pairs        = inv.contrastPairs || [];
    const fails        = pairs.filter(p => p.level === 'FAIL').length;
    const failRatio    = pairs.length ? fails / pairs.length : 0;
    const contrastScore = Math.round((1 - failRatio) * 100);
    const focus        = inv.focusStates;
    const focusScore   = focus?.hasFocusVisible ? 100 :
                         (focus?.outlineRemovedWithoutReplacement > 0) ? 20 : 60;
    const motionScore  = inv.motion?.reducedMotionRespected ? 100 : 65;
    const accScore     = Math.round(contrastScore * 0.55 + focusScore * 0.3 + motionScore * 0.15);

    const overall = Math.round(colorScore * 0.25 + typScore * 0.25 + structScore * 0.2 + accScore * 0.3);

    return { overall, color: colorScore, typography: typScore, structure: structScore, accessibility: accScore };
  }

  function buildTokenHexSet(cssVars) {
    const set = new Set();
    for (const v of cssVars) {
      const hex = hexFromVar(v.value);
      if (hex) set.add(hex);
    }
    return set;
  }

  function hexFromVar(val) {
    val = (val || '').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(val)) return norm(val);
    const m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) return norm('#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join(''));
    return null;
  }

  function toHex(val) {
    if (!val) return val;
    if (/^#[0-9a-f]{3,8}$/i.test(val)) return val.toLowerCase();
    const m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
    return val;
  }

  function norm(hex) {
    return (hex || '').toLowerCase().trim();
  }

  function escHtml(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function hexToHsl(hex) {
    const r = parseInt(hex.slice(1,3)||'0',16)/255;
    const g = parseInt(hex.slice(3,5)||'0',16)/255;
    const b = parseInt(hex.slice(5,7)||'0',16)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h = 0, s = 0, l = (max+min)/2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d/(2-max-min) : d/(max+min);
      if (max===r) h = (g-b)/d + (g<b?6:0);
      else if (max===g) h = (b-r)/d + 2;
      else h = (r-g)/d + 4;
      h /= 6;
    }
    return [h*360, s*100, l*100];
  }

  function sortByHue(colors) {
    return [...colors].sort((a, b) => {
      const ha = hexToHsl(toHex(a.value)||'#000'), hb = hexToHsl(toHex(b.value)||'#000');
      const grayA = ha[1] < 12, grayB = hb[1] < 12;
      if (grayA && grayB) return ha[2] - hb[2];
      if (grayA) return 1;
      if (grayB) return -1;
      return ha[0] - hb[0];
    });
  }

  function getAllBreakpoints(inv) {
    return [
      ...((inv.breakpoints?.minWidth || []).map(b => b.value)),
      ...((inv.breakpoints?.maxWidth || []).map(b => b.value))
    ].filter((v, i, arr) => arr.indexOf(v) === i).sort((a, b) => a - b);
  }

  // ── Health Overview ──

  function renderHealthOverview(health) {
    const sc  = scoreClass(health.overall);
    const cats = [
      { label: 'Color',  score: health.color },
      { label: 'Type',   score: health.typography },
      { label: 'Layout', score: health.structure },
      { label: 'A11y',   score: health.accessibility }
    ];
    return `
      <div class="sb-health-row">
        <div class="sb-health-score ${sc}">${health.overall}</div>
        <div class="sb-health-meta">
          <div class="sb-health-label">Design Health</div>
          <div class="sb-health-bar-track">
            <div class="sb-health-bar-fill ${sc}" style="width:${health.overall}%"></div>
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

  // ── Color Card (with inner tabs: Tokens | Hardcoded | Effects | A11y) ──

  function renderColorCard(inv, score, health) {
    const colors     = inv.colorPalette || [];
    const cssVars    = inv.cssTokens?.variables || [];
    const tokenHexes = buildTokenHexSet(cssVars);

    const hexToToken = {};
    for (const v of cssVars) {
      const hex = hexFromVar(v.value);
      if (hex && !hexToToken[hex]) hexToToken[hex] = v.name;
    }

    const tokenized = sortByHue(colors.filter(c =>  tokenHexes.has(norm(toHex(c.value)))));
    const hardcoded = sortByHue(colors.filter(c => !tokenHexes.has(norm(toHex(c.value)))));

    function miniCardGrid(list) {
      if (!list.length) return '<div class="ds-empty-pane">None detected</div>';
      return `<div class="ds-color-grid">${list.map(c => {
        const hex    = toHex(c.value);
        const tkName = hexToToken[norm(hex)] || '';
        return `<div class="ds-color-card">
          <div class="ds-color-preview" style="background:${c.value}"></div>
          <div class="ds-color-info">
            ${tkName ? `<div class="ds-color-name">${tkName}</div>` : ''}
            <div class="ds-color-hex-row">
              <span class="ds-color-hex">${hex}</span>
              <button class="ds-copy-hex" data-copy="${hex}" title="Copy">${IC.copy}</button>
            </div>
          </div>
        </div>`;
      }).join('')}</div>`;
    }

    // Effects pane — squared previews, CSS value collapsible
    const shadows   = (inv.shadows   || []).slice(0, 8);
    const gradients = (inv.gradients || []).slice(0, 6);

    function effectCard(previewStyle, cssValue, count) {
      return `<div class="ds-effect-card">
        <div class="ds-effect-sq" style="${previewStyle}"></div>
        <div class="ds-effect-right">
          <span class="ds-effect-count">×${count}</span>
          <details class="ds-effect-details">
            <summary class="ds-effect-summary">CSS</summary>
            <code class="ds-effect-code">${escHtml(cssValue)}</code>
          </details>
        </div>
      </div>`;
    }

    const shadowHtml   = shadows.map(s   => effectCard(`background:#f5f5f5;box-shadow:${s.value}`, s.value, s.count)).join('');
    const gradientHtml = gradients.map(g => effectCard(`background:${g.value}`, g.value, g.count)).join('');
    const effectsContent = [
      shadows.length   ? `<div class="ds-effect-section-lbl">Shadows (${shadows.length})</div><div class="ds-effect-grid">${shadowHtml}</div>` : '',
      gradients.length ? `<div class="ds-effect-section-lbl">Gradients (${gradients.length})</div><div class="ds-effect-grid">${gradientHtml}</div>` : '',
      !shadows.length && !gradients.length ? '<div class="ds-empty-pane">No effects detected</div>' : ''
    ].join('');

    return `
      <div class="ds-card-head">
        <span class="ds-card-icon">${IC.palette}</span>
        <span class="ds-card-title">Color System</span>
        <span class="ds-score-pill ${scoreClass(score)}">${score}</span>
        <span class="ds-chevron">${IC.chevron}</span>
      </div>
      <div class="ds-card-body">
        <div class="ds-ctabs">
          <button class="ds-ctab active" data-ctab="tokens">Tokens${tokenized.length ? ' ('+tokenized.length+')' : ''}</button>
          <button class="ds-ctab" data-ctab="raw">Raw${hardcoded.length ? ' ('+hardcoded.length+')' : ''}</button>
          <button class="ds-ctab" data-ctab="effects">Effects</button>
          <button class="ds-ctab" data-ctab="a11y">A11y</button>
        </div>
        <div class="ds-ctab-pane active" data-pane="tokens">${miniCardGrid(tokenized)}</div>
        <div class="ds-ctab-pane" data-pane="raw">${miniCardGrid(hardcoded)}</div>
        <div class="ds-ctab-pane" data-pane="effects">${effectsContent}</div>
        <div class="ds-ctab-pane" data-pane="a11y">${renderA11yContent(inv)}</div>
      </div>`;
  }

  function renderA11yContent(inv) {
    const fails  = (inv.contrastPairs || []).filter(p => p.level === 'FAIL').slice(0, 6);
    const passes = (inv.contrastPairs || []).filter(p => p.level !== 'FAIL');
    const focus  = inv.focusStates;
    const motion = inv.motion;

    const contrastHtml = fails.length === 0
      ? `<div class="ds-acc-check pass">Contrast OK — ${passes.length} pairs sampled</div>`
      : `<div class="ds-contrast-cards">${fails.map(f => `
          <div class="ds-contrast-card">
            <div class="ds-contrast-preview" style="background:${f.bgHex}">
              <span style="color:${f.textHex}">Aa</span>
            </div>
            <div class="ds-contrast-body">
              <div class="ds-contrast-ratio">${f.ratio}:1</div>
              <div class="ds-contrast-swatches-sm">
                <div style="width:14px;height:14px;border-radius:3px;background:${f.textHex};border:1px solid rgba(0,0,0,0.08)"></div>
                <div style="width:14px;height:14px;border-radius:3px;background:${f.bgHex};border:1px solid rgba(0,0,0,0.08)"></div>
              </div>
              <div class="ds-contrast-tag">${f.tag} · ${f.fontSize}px</div>
            </div>
          </div>`).join('')}</div>`;

    const focusHtml = focus?.hasFocusVisible
      ? `<div class="ds-acc-check pass">:focus-visible declared</div>`
      : (focus?.outlineRemovedWithoutReplacement > 0)
        ? `<div class="ds-acc-check fail">Outline removed without replacement</div>`
        : `<div class="ds-acc-check warn">No custom focus styles</div>`;

    const motionHtml = motion?.reducedMotionRespected
      ? `<div class="ds-acc-check pass">prefers-reduced-motion respected</div>`
      : `<div class="ds-acc-check warn">No reduced-motion media query</div>`;

    return `
      ${fails.length > 0 ? '<div class="ds-section-label" style="color:#e53935">Contrast Failures</div>' : ''}
      ${contrastHtml}
      <div style="margin-top:8px">${focusHtml}${motionHtml}</div>`;
  }

  // ── Typography Card ──

  function renderTypographyCard(inv, score) {
    const families = (inv.fontFamilies || []).slice(0, 5);
    const sizes = (inv.fontSizes || [])
      .slice()
      .sort((a, b) => parseFloat(a.value) - parseFloat(b.value))
      .slice(0, 10);

    const familyCards = families.map(f => {
      const name = (f.value || '').trim().replace(/['"]/g, '');
      // Quote the family name so multi-word names like "Open Sans" parse correctly
      const cssFamilyValue = `'${name}', sans-serif`;
      return `<div class="ds-family-card">
        <div class="ds-family-header">
          <span class="ds-family-name">${escHtml(name)}</span>
          <span class="ds-family-count">×${f.count}</span>
        </div>
        <div class="ds-family-preview" style="font-family:${cssFamilyValue}">Aa Bb Cc 01 23</div>
      </div>`;
    }).join('');

    const tiles = sizes.map(s => {
      const px      = parseFloat(s.value) || 16;
      const display = Math.min(Math.max(Math.round(px), 9), 22);
      return `<div class="ds-type-tile">
        <div class="ds-tile-size">${Math.round(px)}px</div>
        <div class="ds-tile-sample" style="font-size:${display}px">Aa</div>
        <div class="ds-tile-count">×${s.count}</div>
      </div>`;
    }).join('');

    return `
      <div class="ds-card-head">
        <span class="ds-card-icon">${IC.type}</span>
        <span class="ds-card-title">Typography</span>
        <span class="ds-score-pill ${scoreClass(score)}">${score}</span>
        <span class="ds-chevron">${IC.chevron}</span>
      </div>
      <div class="ds-card-body">
        <div class="ds-font-families">
          ${familyCards || '<div class="ds-empty-pane">No font data</div>'}
        </div>
        ${sizes.length ? `<div class="ds-section-label">Sizes</div><div class="ds-type-tiles">${tiles}</div>` : ''}
        ${families.length > 2 ? `<div class="ds-flag">⚠ ${families.length} font families — aim for 2 max</div>` : ''}
        ${sizes.length >= 10 ? `<div class="ds-flag">⚠ ${inv.fontSizes?.length || sizes.length}+ sizes — define a type scale</div>` : ''}
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

    const spacingValues = (inv.spacingValues || []).slice(0, 10);
    const maxPx = Math.max(...spacingValues.map(s => parseFloat(s.value)), 1);

    // Tiles like font size tiles: label / visual box / count
    const spacingTiles = spacingValues.map(s => {
      const px    = Math.round(parseFloat(s.value));
      const boxPx = Math.max(4, Math.min(Math.round((px / maxPx) * 44), 44));
      return `<div class="ds-sp-tile">
        <div class="ds-sp-val">${px}px</div>
        <div class="ds-sp-box" style="width:${boxPx}px;height:${boxPx}px"></div>
        <div class="ds-sp-count">×${s.count}</div>
      </div>`;
    }).join('');

    // Column count hints based on breakpoints
    const colHints = [];
    if (bps.some(b => b >= 1200)) colHints.push({ label: 'Desktop', cols: 12 });
    else if (bps.length > 0)      colHints.push({ label: 'Desktop', cols: 12 });
    if (bps.some(b => b >= 600 && b < 1200)) colHints.push({ label: 'Tablet', cols: 8 });
    if (bps.length > 0)           colHints.push({ label: 'Mobile',  cols: 4 });
    if (colHints.length === 0)    colHints.push({ label: 'Single col', cols: 1 });

    const colHtml = `<div class="ds-col-chips">${colHints.map(c =>
      `<div class="ds-col-chip">
        <span class="ds-col-num">${c.cols}</span>
        <span class="ds-col-label">${c.label}</span>
      </div>`).join('')}</div>`;

    const bpHtml = bps.length > 0
      ? `<div class="ds-bp-chips">${bps.map(b => `<span class="ds-bp-chip">${b}px</span>`).join('')}</div>`
      : `<div class="ds-flag">No responsive breakpoints found in stylesheets</div>`;

    return `
      <div class="ds-card-head">
        <span class="ds-card-icon">${IC.layout}</span>
        <span class="ds-card-title">Structure</span>
        <span class="ds-score-pill ${scoreClass(score)}">${score}</span>
        <span class="ds-chevron">${IC.chevron}</span>
      </div>
      <div class="ds-card-body">
        <div class="ds-section-label">Spacing — ${spacingBase}px base · ${gridRatio}% on-grid</div>
        ${spacingTiles ? `<div class="ds-sp-tiles">${spacingTiles}</div>` : '<div class="ds-empty-pane">No spacing data</div>'}
        <div class="ds-section-label">Grid Columns</div>
        ${colHtml}
        <div class="ds-section-label">Breakpoints</div>
        ${bpHtml}
        <div class="ds-card-meta">
          <span>Flexbox: ${flexPct}%</span>
          <span>CSS Grid: ${gridPct}%</span>
          <span>${bps.length} bp</span>
        </div>
        ${gridRatio < 50 && gridRatio > 0 ? `<div class="ds-flag">Only ${gridRatio}% of spacing follows the ${spacingBase}px grid</div>` : ''}
      </div>`;
  }

  // ── SVG & Icons Card ──

  function renderSVGCard(inv) {
    const svgs     = inv.svgInventory || [];
    const inline   = svgs.filter(s => s.source === 'inline');
    const imgBased = svgs.filter(s => s.source === 'img-url');
    const iconLib  = inv.iconLibrary;

    // Logo: prefer an SVG labelled "logo" or "brand", otherwise the first one
    const logo  = inline.find(s => /logo|brand|mark/i.test((s.label || '') + (s.className || ''))) || inline[0];
    const icons = inline.filter(s => s !== logo).slice(0, 20);

    function svgNeedsDarkBg(svgContent) {
      // Attribute form: fill="white", fill="#fff", fill="#FFF", fill="#ffffff"
      if (/(fill|stroke)=["']\s*(white|#fff{1,3}|#ffffff)\s*["']/i.test(svgContent)) return true;
      // Inline style form: style="fill:white" or style="color:#fff"
      if (/style=["'][^"']*(?:fill|stroke|color)\s*:\s*(?:white|#fff{1,3}|#ffffff)/i.test(svgContent)) return true;
      // currentColor with no dark fill defined (icon fonts that inherit a white color)
      if (svgContent.includes('currentColor') && /stroke=["'](white|#fff)/i.test(svgContent)) return true;
      return false;
    }

    const heroHtml = logo
      ? `<div class="ds-svg-hero ds-svg-grey" title="${logo.label || 'Logo'}">${logo.content}</div>`
      : '';

    const gridHtml = icons.map(s =>
      `<div class="ds-svg-thumb ds-svg-grey" title="${s.label || ''}">${s.content}</div>`
    ).join('');

    return `
      <div class="ds-card-head">
        <span class="ds-card-icon">${IC.svgIcon}</span>
        <span class="ds-card-title">SVGs & Icons</span>
        <span class="ds-chevron">${IC.chevron}</span>
      </div>
      <div class="ds-card-body">
        ${iconLib ? `<div class="ds-icon-lib-tag">${iconLib}</div>` : ''}
        <div class="ds-icon-stats">
          <div class="ds-icon-stat">
            <span class="ds-icon-stat-num">${inline.length}</span>
            <span class="ds-icon-stat-label">Inline SVGs</span>
          </div>
          <div class="ds-icon-stat">
            <span class="ds-icon-stat-num">${imgBased.length}</span>
            <span class="ds-icon-stat-label">SVG images</span>
          </div>
          <div class="ds-icon-stat">
            <span class="ds-icon-stat-num">${svgs.length}</span>
            <span class="ds-icon-stat-label">Total</span>
          </div>
        </div>
        ${heroHtml}
        ${gridHtml ? `<div class="ds-svg-grid">${gridHtml}</div>` : (!heroHtml ? '<div class="ds-empty-pane">No SVGs detected</div>' : '')}
      </div>`;
  }

  // ── Tech Stack Card ──

  function renderTechCard(inv) {
    const ts = inv.techStack;
    if (!ts) return '';

    function row(label, value) {
      if (!value) return '';
      return `<div class="ds-tech-row">
        <span class="ds-tech-label">${label}</span>
        <span class="ds-tech-value">${value}</span>
      </div>`;
    }

    function tags(label, arr) {
      if (!arr?.length) return '';
      return `<div class="ds-tech-row ds-tech-tags-row">
        <span class="ds-tech-label">${label}</span>
        <div class="ds-tech-tags">${arr.map(t => `<span class="ds-tech-tag">${t}</span>`).join('')}</div>
      </div>`;
    }

    const hasAny = ts.cms || ts.jsFramework || ts.cssFramework || ts.analytics?.length
      || ts.marketing?.length || ts.tagManager || ts.abTesting || ts.ecommerce;

    const body = hasAny ? `
      ${row('CMS / Platform', ts.cms)}
      ${row('JS Framework', ts.jsFramework)}
      ${row('CSS Framework', ts.cssFramework)}
      ${row('E-commerce', ts.ecommerce !== ts.cms ? ts.ecommerce : null)}
      ${row('Tag Manager', ts.tagManager)}
      ${row('A/B Testing', ts.abTesting)}
      ${tags('Analytics', ts.analytics)}
      ${tags('Marketing', ts.marketing)}
    ` : '<div class="ds-empty-pane">No stack detected</div>';

    return `
      <div class="ds-card-head">
        <span class="ds-card-icon">${IC.tech}</span>
        <span class="ds-card-title">Tech Stack</span>
        <span class="ds-chevron">${IC.chevron}</span>
      </div>
      <div class="ds-card-body">
        <div class="ds-tech-table">${body}</div>
      </div>`;
  }

  function populateExplorerTechCard(inv) {
    const el = document.getElementById('sb-card-tech');
    const bar = document.getElementById('sb-tech-scan-bar');
    if (!el) return;
    el.innerHTML = renderTechCard(inv);
    el.classList.add('ds-card-expanded');
    if (bar) bar.style.display = 'none';
    // re-attach collapse toggle for this card
    el.querySelector('.ds-card-head')?.addEventListener('click', () => {
      el.classList.toggle('ds-card-expanded');
      const body = el.querySelector('.ds-card-body');
      if (body) body.style.display = el.classList.contains('ds-card-expanded') ? '' : 'none';
    });
  }

  // "Detect Tech Stack" button in Explorer tab (works even without a Design scan)
  document.getElementById('sb-tech-scan-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('sb-tech-scan-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }
    try {
      const result = await chrome.runtime.sendMessage({ action: 'LIVE_DESIGN_SCAN' });
      if (result?.success) {
        lastInventory = result.inventory;
        lastUrl = result.url;
        populateExplorerTechCard(result.inventory);
      }
    } catch (_) {}
    if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> Detect Tech Stack`; }
  });

  // ── Export Tokens JSON (W3C tokens format — importable via Token Studio in Figma) ──

  function exportTokensJSON(inv, url) {
    const cssVars  = inv.cssTokens?.variables || [];
    const hexToToken = {};
    for (const v of cssVars) {
      const hex = hexFromVar(v.value);
      if (hex && !hexToToken[hex]) hexToToken[hex] = v.name;
    }

    const tokens = {
      '$meta': { source: 'EchoFlow', url, exportedAt: new Date().toISOString() },
      color: {},
      typography: {},
      spacing: {}
    };

    for (const c of (inv.colorPalette || [])) {
      const hex      = toHex(c.value);
      const normHex  = norm(hex);
      const tkName   = hexToToken[normHex];
      const key      = tkName
        ? tkName.replace(/^--/, '').replace(/-/g, '_')
        : 'color_' + hex.replace('#', '');
      if (!tokens.color[key]) tokens.color[key] = { '$value': hex, '$type': 'color' };
    }

    for (const f of (inv.fontFamilies || []).slice(0, 4)) {
      const name = (f.value || '').split(',')[0].trim().replace(/['"]/g, '');
      const key  = 'family_' + (name || 'default').toLowerCase().replace(/\s+/g, '_');
      tokens.typography[key] = { '$value': f.value, '$type': 'fontFamily' };
    }
    for (const s of (inv.fontSizes || []).slice(0, 12)) {
      const px  = Math.round(parseFloat(s.value));
      tokens.typography['size_' + px] = { '$value': px + 'px', '$type': 'dimension' };
    }

    for (const s of (inv.spacingValues || []).slice(0, 10)) {
      const px = Math.round(parseFloat(s.value));
      tokens.spacing['space_' + px] = { '$value': px + 'px', '$type': 'dimension' };
    }

    const json = JSON.stringify(tokens, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'echoflow-tokens.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ═══════════════════════════════════════
  //  Audit Tab
  // ═══════════════════════════════════════

  let selectedVertical = 'generic-ux';
  let selectedDevice   = 'desktop';

  const PAGE_TYPES = {
    'shopify': [{ value: 'homepage', label: 'Homepage' }, { value: 'pdp', label: 'Product Page' }, { value: 'collection', label: 'Collection' }, { value: 'checkout', label: 'Checkout' }, { value: 'other', label: 'Other' }],
    'fintech': [{ value: 'dashboard', label: 'Dashboard' }, { value: 'onboarding', label: 'Onboarding' }, { value: 'payment', label: 'Payment' }, { value: 'landing', label: 'Landing' }, { value: 'other', label: 'Other' }],
    'crypto':  [{ value: 'landing', label: 'Landing / Marketing' }, { value: 'wallet', label: 'Wallet' }, { value: 'exchange', label: 'Exchange' }, { value: 'defi', label: 'DeFi' }, { value: 'onboarding', label: 'Onboarding' }, { value: 'other', label: 'Other' }]
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
  const auditForm     = document.getElementById('sb-audit-form');
  const auditResults  = document.getElementById('sb-audit-results');

  const CAT_CLASS = {
    TRUST: 'cat-trust', USABILITY: 'cat-usability', CONVERSION: 'cat-conversion',
    PERFORMANCE: 'cat-perf', ACCESSIBILITY: 'cat-a11y', CONTENT: 'cat-content',
    MOBILE: 'cat-mobile', SEO: 'cat-seo', DESIGN: 'cat-design',
  };

  function renderScreenshotSection(screenshot, findings, viewport) {
    if (!screenshot) return '';
    const vw = viewport?.width  || 1280;
    const vh = viewport?.height || 800;
    const aspectPct = (vh / vw * 100).toFixed(2);

    const markers = findings.filter(f =>
      f.position && f.position.x >= 0 && f.position.y >= 0 &&
      f.position.x < vw && f.position.y < vh
    ).map(f => {
      const cx = f.position.x + (f.position.width  || 0) / 2;
      const cy = f.position.y + (f.position.height || 0) / 2;
      const lPct = Math.min(95, Math.max(1, cx / vw * 100)).toFixed(1);
      const tPct = Math.min(97, Math.max(1, cy / vh * 100)).toFixed(1);
      const catCls = CAT_CLASS[(f.category || '').toUpperCase()] || 'cat-other';
      return `<div class="sb-marker ${catCls}" style="left:${lPct}%;top:${tPct}%" title="#${f.number} ${escHtml(f.description)}">${f.number}</div>`;
    }).join('');

    return `<div class="sb-screenshot-wrap">
      <div class="sb-screenshot-inner" style="padding-top:${aspectPct}%">
        <img src="${screenshot}" class="sb-screenshot-img" alt="">
        ${markers}
      </div>
    </div>`;
  }

  function renderFindings(findings, meta, screenshot) {
    const list   = document.getElementById('sb-findings-list');
    const metaEl = document.getElementById('sb-results-meta');
    if (!list) return;

    const vertical = (meta?.vertical || '').toUpperCase();
    const device   = meta?.device   || '';
    metaEl.textContent = `${findings.length} findings · ${vertical} · ${device}`;

    const screenshotHtml = renderScreenshotSection(screenshot, findings, meta?.viewport);

    const findingsHtml = findings.map(f => {
      const score    = ((f.ice.impact + f.ice.confidence + f.ice.ease) / 3).toFixed(1);
      const scoreNum = parseFloat(score);
      const scoreCls = scoreNum >= 7.5 ? 'score-high' : scoreNum >= 5 ? 'score-mid' : 'score-low';
      const catKey   = (f.category || '').toUpperCase();
      const catCls   = CAT_CLASS[catKey] || 'cat-other';
      return `
        <div class="sb-finding ${catCls}-border">
          <div class="sb-finding-row">
            <div class="sb-finding-num ${catCls}">${f.number}</div>
            <div class="sb-finding-desc">${escHtml(f.description)}</div>
          </div>
          <div class="sb-finding-meta">
            <span class="sb-ice-score ${scoreCls}">${score}</span>
            <span class="sb-ice-trio">I:${f.ice.impact} · C:${f.ice.confidence} · E:${f.ice.ease}</span>
            <span class="sb-cat-tag ${catCls}">${f.category}</span>
          </div>
        </div>`;
    }).join('');

    list.innerHTML = screenshotHtml + `<div class="sb-findings-items">${findingsHtml}</div>`;
  }

  function showAuditResults(results) {
    auditForm.style.display = 'none';
    auditResults.style.display = 'block';
    renderFindings(results.findings, results.meta, results.screenshot);
  }

  function showAuditForm() {
    auditResults.style.display = 'none';
    auditForm.style.display = 'block';
  }

  document.getElementById('sb-results-back')?.addEventListener('click', showAuditForm);

  document.getElementById('sb-results-fullreport')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });
  });

  runAuditBtn?.addEventListener('click', async () => {
    runAuditBtn.disabled = true;
    runAuditLabel.textContent = 'Auditing…';
    auditStatus.textContent = 'Capturing page…';
    auditStatus.className = 'sb-status loading';

    try {
      const pageTypeSelect = document.getElementById('sb-page-type-select');
      const pageType = PAGE_TYPES[selectedVertical] ? pageTypeSelect?.value : null;
      const result = await chrome.runtime.sendMessage({
        action: 'START_AUDIT', vertical: selectedVertical, pageType,
        mode: 'viewport', device: selectedDevice, projectId: null
      });
      if (result?.success) {
        auditStatus.textContent = '';
        auditStatus.className = 'sb-status';
        showAuditResults(result.results);
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
        migrateStatus.textContent = `Done — ${result.componentCount} components. Results opened.`;
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
  //  Explorer Tab
  // ═══════════════════════════════════════

  document.getElementById('sb-discover-sitemap')?.addEventListener('click', () => runDiscover('sitemap'));
  document.getElementById('sb-discover-crawl')?.addEventListener('click',   () => runDiscover('crawl'));
  document.getElementById('sb-discover-stop')?.addEventListener('click',    () => {
    chrome.runtime.sendMessage({ action: 'DISCOVER_STOP' });
  });

  let discoverPoll = null;

  async function runDiscover(method) {
    const explStatus = document.getElementById('sb-explorer-status');
    explStatus.textContent = 'Starting…';
    explStatus.className = 'sb-status loading';

    const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
    const tab  = tabs[0];
    if (!tab) { explStatus.textContent = 'No active tab'; explStatus.className = 'sb-status error'; return; }

    let origin;
    try { origin = new URL(tab.url).origin; } catch {
      explStatus.textContent = 'Invalid URL'; explStatus.className = 'sb-status error'; return;
    }

    await chrome.runtime.sendMessage({ action: 'DISCOVER_CLEAR' });
    await chrome.runtime.sendMessage({ action: 'DISCOVER_PAGES', method, origin, startUrl: tab.url });
    document.getElementById('sb-discover-progress').style.display = 'flex';

    clearInterval(discoverPoll);
    discoverPoll = setInterval(async () => {
      const r     = await chrome.runtime.sendMessage({ action: 'DISCOVER_STATE' });
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
