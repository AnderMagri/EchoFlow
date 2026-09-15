// EchoFlow Results Viewer
// Two-column layout: screenshot with markers + tabbed findings (Rules / AI).

(function () {
  // ── State ──

  let auditData = null;
  let findings = [];
  let activeFindingNumber = null;

  // ── Marker Colors ──

  const MARKER_COLORS = [
    '#e53935', '#d81b60', '#8e24aa', '#5e35b1',
    '#3949ab', '#1e88e5', '#039be5', '#00acc1',
    '#00897b', '#43a047', '#7cb342', '#c0ca33',
    '#fdd835', '#ffb300', '#fb8c00', '#f4511e'
  ];

  function getMarkerColor(index) {
    return MARKER_COLORS[index % MARKER_COLORS.length];
  }

  function getICELevel(value) {
    if (value >= 7) return 'high';
    if (value >= 4) return 'medium';
    return 'low';
  }

  function iceAverage(ice) {
    return ((ice.impact + ice.confidence + ice.ease) / 3).toFixed(1);
  }

  // ── Toast ──

  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // ── Render Toolbar ──

  function renderToolbar() {
    const urlEl = document.getElementById('audit-url');
    urlEl.textContent = auditData.meta.url;
    urlEl.href = auditData.meta.url;

    document.getElementById('audit-badge').textContent = auditData.meta.vertical.replace('-', ' ');

    // Device badge
    const device = auditData.meta.device || 'desktop';
    const deviceBadge = document.getElementById('audit-device');
    if (deviceBadge) {
      const icon = device === 'mobile' ? '\u{1F4F1}' : device === 'tablet' ? '\u{1F4CB}' : '\u{1F5A5}';
      deviceBadge.textContent = icon + ' ' + device;
    }

    // Page type badge
    const pageTypeBadge = document.getElementById('audit-page-type');
    if (pageTypeBadge && auditData.meta.pageType) {
      pageTypeBadge.textContent = auditData.meta.pageType.replace(/-/g, ' ');
      pageTypeBadge.style.display = 'inline-block';
    }

    const date = new Date(auditData.meta.timestamp);
    document.getElementById('audit-time').textContent = date.toLocaleString();
  }

  // ── Screenshot (only mode) ──

  function renderScreenshot() { renderStaticScreenshot(); }
  function renderPreview()    { renderStaticScreenshot(); }

  function renderStaticScreenshot() {
    const img       = document.getElementById('screenshot-img');
    const container = document.getElementById('screenshot-container');

    container.style.width  = '';
    container.style.height = '';
    container.style.display = '';

    if (!auditData.screenshot) {
      img.style.display = 'none';
      let ph = document.getElementById('screenshot-placeholder');
      if (!ph) {
        ph = document.createElement('div');
        ph.id = 'screenshot-placeholder';
        ph.className = 'screenshot-placeholder';
        ph.innerHTML = `
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#bbb" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <p class="screenshot-ph-label">No screenshot yet</p>
          <p class="screenshot-ph-hint">Capture the page to overlay all finding markers on a static image</p>
          <div class="screenshot-ph-btns">
            <button class="btn-ph-capture" id="btn-capture-viewport">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              Viewport
            </button>
            <button class="btn-ph-capture btn-ph-capture--secondary" id="btn-capture-fullpage">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>
              Full Page
            </button>
          </div>
          <div id="screenshot-ph-status" class="screenshot-ph-status"></div>
        `;
        container.appendChild(ph);
        ph.querySelector('#btn-capture-viewport').addEventListener('click', () => takeScreenshot('viewport'));
        ph.querySelector('#btn-capture-fullpage').addEventListener('click', () => takeScreenshot('full_page'));
      } else {
        ph.style.display = '';
      }
      return;
    }

    const ph = document.getElementById('screenshot-placeholder');
    if (ph) ph.style.display = 'none';
    img.style.display = '';
    img.src = auditData.screenshot;
    img.onload = () => renderMarkers();
  }

  async function takeScreenshot(mode) {
    const status = document.getElementById('screenshot-ph-status');
    const btns   = document.querySelectorAll('.btn-ph-capture');

    btns.forEach(b => { b.disabled = true; });
    if (status) {
      status.textContent = mode === 'full_page' ? 'Scrolling & stitching full page…' : 'Capturing viewport…';
      status.className = 'screenshot-ph-status loading';
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'TAKE_SCREENSHOT',
        url: auditData.meta.url,
        mode
      });

      if (response?.success) {
        auditData.screenshot  = response.screenshot;
        auditData.meta.captureMode = mode;
        renderStaticScreenshot();
        renderMarkers();
      } else {
        if (status) {
          status.textContent = response?.error || 'Screenshot failed. Make sure the page is still open.';
          status.className = 'screenshot-ph-status error';
        }
        btns.forEach(b => { b.disabled = false; });
      }
    } catch (err) {
      if (status) {
        status.textContent = 'Could not reach extension background. Try reloading.';
        status.className = 'screenshot-ph-status error';
      }
      btns.forEach(b => { b.disabled = false; });
    }
  }

  // ── Markers (works for both live-preview and screenshot modes) ──

  function renderMarkers() {
    const container = document.getElementById('markers-layer');
    container.innerHTML = '';

    let displayW, displayH, sourceW, sourceH, isFullPage;

    if (previewMode === 'live') {
      const wrap = document.getElementById('live-preview-wrap');
      if (!wrap || wrap.style.display === 'none') return;
      displayW = parseInt(wrap.dataset.dispW) || wrap.clientWidth;
      displayH = parseInt(wrap.dataset.dispH) || wrap.clientHeight;
      sourceW  = parseInt(wrap.dataset.srcW)  || auditData.meta.viewport?.width  || displayW;
      sourceH  = parseInt(wrap.dataset.srcH)  || auditData.meta.viewport?.height || displayH;
      isFullPage = false;   // live preview always shows viewport slice
    } else {
      const img = document.getElementById('screenshot-img');
      if (!img || !img.naturalWidth) return;
      isFullPage = auditData.meta.captureMode === 'full_page';
      displayW   = img.clientWidth;
      displayH   = img.clientHeight;
      sourceW    = auditData.meta.viewport?.width  || img.naturalWidth;
      sourceH    = isFullPage
        ? (auditData.meta.scrollHeight || img.naturalHeight)
        : (auditData.meta.viewport?.height || img.naturalHeight);
    }

    const scaleX = displayW / sourceW;
    const scaleY = displayH / sourceH;
    const vw     = auditData.meta.viewport?.width  || sourceW;
    const vh     = auditData.meta.viewport?.height || sourceH;

    findings.forEach((finding) => {
      const pos = finding.position || { x: 0, y: 0 };
      const hasRealPosition = (pos.x !== 0 || pos.y !== 0) || (pos.width > 100 || pos.height > 30);
      if (!hasRealPosition) return;

      const px = isFullPage ? (pos.absoluteX ?? pos.x) : pos.x;
      const py = isFullPage ? (pos.absoluteY ?? pos.y) : pos.y;
      const pw = pos.width  || 0;
      const ph = pos.height || 0;

      // Skip elements outside the visible frame
      if (!isFullPage) {
        if (py > vh || py + ph < 0) return;
        if (px > vw || px + pw < 0) return;
      }

      const visibleW = isFullPage ? pw : Math.min(pw, vw - px);
      const visibleH = isFullPage ? ph : Math.min(ph, vh - py);

      const marker = document.createElement('div');
      marker.className = 'marker';
      marker.dataset.number = finding.number;
      marker.textContent    = finding.number;
      marker.style.backgroundColor = getMarkerColor(finding.number - 1);
      marker.title = finding.description;

      const cx = (px + visibleW / 2) * scaleX;
      const cy = (py + visibleH / 2) * scaleY;

      marker.style.left = Math.max(13, Math.min(cx, displayW - 13)) + 'px';
      marker.style.top  = Math.max(13, Math.min(cy, displayH - 13)) + 'px';

      marker.addEventListener('click', () => setActiveFinding(finding.number));
      container.appendChild(marker);
    });
  }

  // ── Render Findings List ──

  function renderFindings() {
    const list = document.getElementById('findings-list');
    list.innerHTML = '';

    document.getElementById('findings-count').textContent = findings.length;

    if (findings.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No findings detected</p></div>';
      return;
    }

    findings.forEach((finding) => {
      const card = document.createElement('div');
      card.className = 'finding-card';
      card.dataset.number = finding.number;

      const color = getMarkerColor(finding.number - 1);
      const iceAvg = iceAverage(finding.ice);

      card.innerHTML = `
        <div class="finding-number" style="background:${color}">${finding.number}</div>
        <div class="finding-body">
          <div class="finding-description" data-number="${finding.number}">${escapeHtml(finding.description)}</div>
          <div class="finding-meta">
            <span class="ice-badge ${getICELevel(finding.ice.impact)}">I:${finding.ice.impact}/10</span>
            <span class="ice-badge ${getICELevel(finding.ice.confidence)}">C:${finding.ice.confidence}/10</span>
            <span class="ice-badge ${getICELevel(finding.ice.ease)}">E:${finding.ice.ease}/10</span>
            <span class="ice-total">${iceAvg}/10</span>
            <span class="category-tag">${finding.category}</span>
          </div>
          <div class="finding-actions">
            <button class="finding-action-btn copy-btn" data-number="${finding.number}">Copy</button>
            <button class="finding-action-btn edit-btn" data-number="${finding.number}">Edit</button>
            <button class="finding-action-btn delete" data-number="${finding.number}">Delete</button>
          </div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.finding-action-btn')) return;
        setActiveFinding(finding.number);
      });

      list.appendChild(card);
    });

    // Wire up action buttons
    list.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => copyFinding(parseInt(btn.dataset.number)));
    });

    list.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => editFinding(parseInt(btn.dataset.number)));
    });

    list.querySelectorAll('.finding-action-btn.delete').forEach(btn => {
      btn.addEventListener('click', () => deleteFinding(parseInt(btn.dataset.number)));
    });

    // ── Overall Score Summary ──
    renderScoreSummary(list);
  }

  function renderScoreSummary(list) {
    if (!findings.length) return;

    const totalIssues = findings.length;
    const avgIce = (findings.reduce((sum, f) => sum + parseFloat(iceAverage(f.ice)), 0) / totalIssues).toFixed(1);

    // Page score: start at 10, deduct based on findings severity
    // High severity (ICE >= 7) deducts 0.8, medium (5-7) deducts 0.4, low (<5) deducts 0.2
    let deductions = 0;
    findings.forEach(f => {
      const avg = parseFloat(iceAverage(f.ice));
      if (avg >= 7) deductions += 0.8;
      else if (avg >= 5) deductions += 0.4;
      else deductions += 0.2;
    });
    const currentScore = Math.max(1, 10 - deductions).toFixed(1);
    const potentialScore = Math.min(10, parseFloat(currentScore) + deductions * 0.8).toFixed(1);

    const scoreColor = currentScore >= 7 ? '#22c55e' : currentScore >= 5 ? '#f59e0b' : '#ef4444';
    const potentialColor = potentialScore >= 7 ? '#22c55e' : potentialScore >= 5 ? '#f59e0b' : '#ef4444';

    const summary = document.createElement('div');
    summary.className = 'score-summary';
    summary.innerHTML = `
      <div class="score-summary-title">Overall UX Score</div>
      <div class="score-cards">
        <div class="score-card">
          <div class="score-value" style="color:${scoreColor}">${currentScore}<span class="score-max">/10</span></div>
          <div class="score-label">Current Score</div>
        </div>
        <div class="score-card">
          <div class="score-value" style="color:${potentialColor}">${potentialScore}<span class="score-max">/10</span></div>
          <div class="score-label">Potential Score</div>
        </div>
      </div>
      <div class="score-detail">${totalIssues} findings detected — avg severity ${avgIce}/10</div>
    `;
    list.appendChild(summary);
  }

  // ── Design Health Score ──

  function computeDesignHealth(inv) {
    const warnings = [];
    let score = 100;

    // Font families
    const fontCount = inv.fontFamilies?.length || 0;
    if (fontCount > 5) {
      score -= 20;
      warnings.push({ level: 'error', metric: 'Font Families', message: `${fontCount} typefaces detected`, detail: 'More than 5 fonts signals no design system. Aim for 1–2 (one for headings, one for body).' });
    } else if (fontCount > 3) {
      score -= 10;
      warnings.push({ level: 'warning', metric: 'Font Families', message: `${fontCount} typefaces in use`, detail: 'More than 3 fonts is unusual. A clean brand uses 2, occasionally 3.' });
    }

    // Font sizes
    const sizeCount = inv.fontSizes?.length || 0;
    if (sizeCount > 10) {
      score -= 12;
      warnings.push({ level: 'error', metric: 'Type Scale', message: `${sizeCount} distinct font sizes`, detail: 'Professional type scales use 5–7 sizes. Beyond 10 creates visual noise and broken hierarchy.' });
    } else if (sizeCount > 7) {
      score -= 5;
      warnings.push({ level: 'warning', metric: 'Type Scale', message: `${sizeCount} font sizes`, detail: 'Consider trimming to 5–7 sizes for a tighter, more intentional scale.' });
    }

    // Color palette
    const colorCount = inv.colorPalette?.length || 0;
    if (colorCount > 16) {
      score -= 15;
      warnings.push({ level: 'error', metric: 'Color Palette', message: `${colorCount} unique colors`, detail: 'Color sprawl. A focused brand palette uses ≤12–16 colors (primaries + tints + neutrals). Consolidate similar shades.' });
    } else if (colorCount > 12) {
      score -= 7;
      warnings.push({ level: 'warning', metric: 'Color Palette', message: `${colorCount} unique colors`, detail: 'Near the upper limit. Look for near-duplicates you can merge into a single token.' });
    }

    // Border radius variety
    const radiiCount = inv.borderRadii?.length || 0;
    if (radiiCount > 8) {
      score -= 10;
      warnings.push({ level: 'error', metric: 'Border Radii', message: `${radiiCount} corner-radius values`, detail: 'No consistent corner system. Define 3–5 radius tokens (none, small, medium, large, pill).' });
    } else if (radiiCount > 5) {
      score -= 4;
      warnings.push({ level: 'warning', metric: 'Border Radii', message: `${radiiCount} radius values`, detail: 'Consider consolidating to ≤5 tokens for a more systematic approach.' });
    }

    // Spacing grid alignment
    const gridRatio = inv.spacingGridRatio ?? 100;
    if (gridRatio < 70) {
      score -= 15;
      warnings.push({ level: 'error', metric: 'Spacing Grid', message: `Only ${gridRatio}% on 4px grid`, detail: 'Most spacing values are arbitrary. Random spacing breaks visual rhythm — align to 4/8px increments.' });
    } else if (gridRatio < 85) {
      score -= 7;
      warnings.push({ level: 'warning', metric: 'Spacing Grid', message: `${gridRatio}% on 4px grid`, detail: 'Several off-grid values detected. Tightening to the 4/8px scale will improve consistency.' });
    }

    // Heading hierarchy
    if (inv.headings && inv.headings.length > 0) {
      const levels = new Set(inv.headings.map(h => h.level || h.tag || '').map(l => l.toUpperCase()));
      if (!levels.has('H1')) {
        score -= 10;
        warnings.push({ level: 'error', metric: 'Heading Hierarchy', message: 'No H1 found on page', detail: 'Every page needs exactly one H1 for SEO and screen-reader navigation.' });
      } else if (levels.has('H3') && !levels.has('H2')) {
        score -= 8;
        warnings.push({ level: 'error', metric: 'Heading Hierarchy', message: 'H1 → H3 without H2 (skipped level)', detail: 'Heading levels must not be skipped. This breaks assistive technology navigation.' });
      }
    }

    // Shadow variety
    const shadowCount = inv.shadows?.length || 0;
    if (shadowCount > 8) {
      score -= 6;
      warnings.push({ level: 'warning', metric: 'Shadows / Elevation', message: `${shadowCount} shadow styles`, detail: 'Too many elevations. A design system needs 3–4 levels (flat, subtle, raised, overlay).' });
    }

    // Layout system
    const layout = inv.layoutSystem;
    if (layout) {
      // No detectable spacing base unit
      if (layout.spacingBase === null && (inv.spacingValues?.length || 0) > 5) {
        score -= 8;
        warnings.push({ level: 'warning', metric: 'Spacing Base Unit', message: 'No consistent base unit found', detail: 'Spacing values don\'t align to a common grid (4px, 8px, etc.). Arbitrary spacing breaks visual rhythm.' });
      }

      // Too many unique gap values
      const gapCount = layout.gapValues?.length || 0;
      if (gapCount > 6) {
        score -= 5;
        warnings.push({ level: 'warning', metric: 'Gap / Gutter', message: `${gapCount} unique gap values`, detail: 'Too many gap values across flex/grid containers. Standardise to 3–4 gutter sizes.' });
      }

      // Competing container widths
      const cwCount = layout.containerWidths?.length || 0;
      if (cwCount > 3) {
        score -= 5;
        warnings.push({ level: 'warning', metric: 'Container Widths', message: `${cwCount} different max-widths`, detail: 'Multiple max-width values suggest no single layout grid. One canonical container width keeps columns aligned across sections.' });
      }
    }

    // CSS Tokens / Design System
    const tokTotal = inv.cssTokens?.total || 0;
    if (tokTotal === 0) {
      score -= 10;
      warnings.push({ level: 'warning', metric: 'Design Tokens', message: 'No CSS custom properties found', detail: 'CSS variables (--color-primary, --spacing-md, etc.) are the foundation of a scalable design system. None were detected.' });
    }

    // Focus States
    const noFV = inv.focusStates?.outlineRemovedWithoutReplacement || 0;
    if (noFV > 0) {
      score -= 15;
      warnings.push({ level: 'error', metric: 'Focus Accessibility', message: `outline:none on ${noFV} rule${noFV > 1 ? 's' : ''} without :focus-visible`, detail: 'Removing the focus ring without a :focus-visible replacement makes the site unusable for keyboard users. WCAG 2.1 AA requires visible focus indicators.' });
    } else if (!(inv.focusStates?.hasFocusVisible)) {
      score -= 5;
      warnings.push({ level: 'warning', metric: 'Focus States', message: 'No :focus-visible rules detected', detail: ':focus-visible provides focus rings for keyboard users only (not mouse). Preferred over :focus for visual polish without accessibility cost.' });
    }

    // Breakpoints / Responsive
    const bpCount = (inv.breakpoints?.minWidth?.length || 0) + (inv.breakpoints?.maxWidth?.length || 0);
    if (bpCount === 0) {
      score -= 12;
      warnings.push({ level: 'error', metric: 'Responsive Design', message: 'No breakpoints found in stylesheets', detail: 'No @media width queries detected. The layout may not adapt to mobile screens — a critical usability gap.' });
    }

    // Contrast
    const failPairs = (inv.contrastPairs || []).filter(p => p.level === 'FAIL');
    if (failPairs.length > 0) {
      score -= Math.min(20, failPairs.length * 5);
      warnings.push({ level: 'error', metric: 'Contrast (WCAG)', message: `${failPairs.length} failing text/background pair${failPairs.length > 1 ? 's' : ''}`, detail: 'Text contrast below WCAG AA minimums (4.5:1 normal, 3:1 large). Fails accessibility and can result in legal exposure.' });
    }

    // Motion / reduced-motion
    const hasAnimations = (inv.motion?.animations?.length || 0) > 0 || (inv.motion?.transitions?.length || 0) > 2;
    if (hasAnimations && !inv.motion?.reducedMotionRespected) {
      score -= 8;
      warnings.push({ level: 'warning', metric: 'Reduced Motion', message: 'Animations detected but no prefers-reduced-motion', detail: '@media (prefers-reduced-motion) is not handled. Users who need reduced motion (vestibular disorders, epilepsy) will see all animations. WCAG 2.1 SC 2.3.3.' });
    }

    // Z-index chaos
    const ziCount = inv.zIndexAudit?.uniqueCount || 0;
    const ziMax   = inv.zIndexAudit?.maxValue || 0;
    if (ziMax >= 9999) {
      score -= 6;
      warnings.push({ level: 'warning', metric: 'Z-index', message: `z-index reaches ${ziMax}`, detail: 'Extreme z-index values (9999, 99999) are a code smell — they signal stacking context problems being "fixed" with escalation rather than proper structure.' });
    } else if (ziCount > 8) {
      score -= 4;
      warnings.push({ level: 'warning', metric: 'Z-index', message: `${ziCount} unique z-index values`, detail: 'Many unique z-index values suggest an unmanaged stacking order. Define a z-index scale as tokens (--z-dropdown: 100, --z-modal: 200, etc.).' });
    }

    // Per-category scores (each starts at 100, deductions applied)
    let colorScore  = 100;
    let typScore    = 100;
    let structScore = 100;
    let accScore    = 100;

    // Color deductions
    if (colorCount > 16)      colorScore -= 25;
    else if (colorCount > 12) colorScore -= 12;
    if ((inv.cssTokens?.total || 0) === 0 && colorCount > 0) colorScore -= 15;

    // Typography deductions
    if (fontCount > 5)       typScore -= 25;
    else if (fontCount > 3)  typScore -= 12;
    if (sizeCount > 10)      typScore -= 20;
    else if (sizeCount > 7)  typScore -= 10;

    // Structure deductions
    if (gridRatio < 70)      structScore -= 25;
    else if (gridRatio < 85) structScore -= 12;
    const bpCount2 = (inv.breakpoints?.minWidth?.length || 0) + (inv.breakpoints?.maxWidth?.length || 0);
    if (bpCount2 === 0)      structScore -= 20;
    if (radiiCount > 8)      structScore -= 12;
    else if (radiiCount > 5) structScore -= 5;

    // Accessibility deductions
    if (failPairs.length > 0) accScore -= Math.min(35, failPairs.length * 8);
    if (noFV > 0)             accScore -= 25;
    else if (!(inv.focusStates?.hasFocusVisible)) accScore -= 8;
    if (hasAnimations && !inv.motion?.reducedMotionRespected) accScore -= 12;

    return {
      score: Math.max(0, score),
      warnings,
      colorScore:  Math.max(0, colorScore),
      typScore:    Math.max(0, typScore),
      structScore: Math.max(0, structScore),
      accScore:    Math.max(0, accScore),
    };
  }

  // ── Design Tab ──

  function renderDesignTab() {
    const inv = auditData?.designInventory;
    const container = document.getElementById('design-inventory');
    const findingsList = document.getElementById('design-findings');
    if (!container || !findingsList) return;

    const designFindings = findings.filter(f => f.category === 'design');

    if (!inv) {
      document.getElementById('design-count').textContent = designFindings.length;
      container.innerHTML = '<div class="empty-state"><p>No design data captured</p></div>';
      return;
    }

    // Run health scoring
    const health = computeDesignHealth(inv);
    const totalDesignIssues = designFindings.length + health.warnings.length;
    document.getElementById('design-count').textContent = totalDesignIssues || '';

    // Build token hex set for color card
    const cssVars    = inv.cssTokens?.variables || [];
    const tokenHexes = dsTokenHexSet(cssVars);
    const colors     = (inv.colorPalette || []).slice(0, 18);
    const tokenized  = colors.filter(c => dsNorm(c.value) && tokenHexes.has(dsNorm(c.value))).length;
    const coverage   = colors.length ? Math.round((tokenized / colors.length) * 100) : 0;
    const hardcoded  = colors.length - tokenized;

    // Breakpoints
    const bps = [
      ...((inv.breakpoints?.minWidth || []).map(b => b.value)),
      ...((inv.breakpoints?.maxWidth || []).map(b => b.value))
    ].filter((v, i, arr) => arr.indexOf(v) === i).sort((a, b) => a - b);

    // Scores (0-100)
    const colorScore  = health.colorScore  || 0;
    const typScore    = health.typScore    || 0;
    const structScore = health.structScore || 0;
    const accScore    = health.accScore    || 0;

    function dsSc(score) {
      return score >= 70 ? 'ds-good' : score >= 45 ? 'ds-mid' : 'ds-bad';
    }

    // ── Health Bar ──
    const overallColor = health.score >= 70 ? '#00C9A7' : health.score >= 45 ? '#f59e0b' : '#ef4444';
    let html = `
      <div class="ds4-header">
        <div class="ds4-score-wrap">
          <span class="ds4-score-num" style="color:${overallColor}">${health.score}</span>
          <div class="ds4-score-meta">
            <span class="ds4-score-label">Design Health</span>
            <div class="ds4-bar-track">
              <div class="ds4-bar-fill" style="width:${health.score}%;background:${overallColor}"></div>
            </div>
          </div>
        </div>
        <div class="ds4-signals">
          <div class="ds4-signal"><span class="ds4-signal-num ${dsSc(colorScore)}">${colorScore}</span><span class="ds4-signal-lbl">Color</span></div>
          <div class="ds4-signal"><span class="ds4-signal-num ${dsSc(typScore)}">${typScore}</span><span class="ds4-signal-lbl">Type</span></div>
          <div class="ds4-signal"><span class="ds4-signal-num ${dsSc(structScore)}">${structScore}</span><span class="ds4-signal-lbl">Layout</span></div>
          <div class="ds4-signal"><span class="ds4-signal-num ${dsSc(accScore)}">${accScore}</span><span class="ds4-signal-lbl">A11y</span></div>
        </div>
      </div>`;

    // ── Color Card ──
    const swatches = colors.map(c => {
      const isToken = tokenHexes.has(dsNorm(c.value));
      return `<div class="ds4-swatch ${isToken ? '' : 'ds4-swatch-raw'}" style="background:${c.value}" title="${c.value}${isToken ? ' · token' : ' · hardcoded'} · ×${c.count}"></div>`;
    }).join('');
    const coverageCls = coverage >= 70 ? 'ds-good-txt' : 'ds-warn-txt';
    html += `
      <div class="ds4-card">
        <div class="ds4-card-head">
          <span class="ds4-card-icon">🎨</span>
          <span class="ds4-card-title">Color System</span>
          <span class="ds4-pill ${dsSc(colorScore)}">${colorScore}</span>
        </div>
        <div class="ds4-swatches">${swatches || '<span class="ds4-empty-note">No colors detected</span>'}</div>
        <div class="ds4-meta">
          <span>${colors.length} unique color${colors.length !== 1 ? 's' : ''}</span>
          ${cssVars.length > 0
            ? `<span class="${coverageCls}">Token coverage: ${coverage}%</span>`
            : '<span class="ds-warn-txt">No CSS tokens</span>'}
        </div>
        ${hardcoded > 0 && cssVars.length > 0 ? `<div class="ds4-flag">⚠ ${hardcoded} hardcoded color${hardcoded > 1 ? 's' : ''} (dashed border) not in token set</div>` : ''}
        ${cssVars.length === 0 && colors.length > 0 ? '<div class="ds4-flag">⚠ No CSS custom properties — consider a token layer</div>' : ''}
        ${colors.length > 16 ? `<div class="ds4-flag">⚠ ${colors.length} colors on page — a focused palette uses 6–12</div>` : ''}
      </div>`;

    // ── Typography Card ──
    const families   = (inv.fontFamilies || []).slice(0, 5);
    const fontSizes  = (inv.fontSizes    || []).slice(0, 8);
    const maxFontCount = Math.max(...fontSizes.map(s => s.count), 1);
    const scaleRows = fontSizes.map(s => {
      const px    = parseFloat(s.value) || 16;
      const width = Math.max(4, Math.round((s.count / maxFontCount) * 100));
      const clampPx = Math.min(Math.max(px, 10), 22);
      return `<div class="ds4-type-row">
        <span class="ds4-type-sz">${Math.round(px)}</span>
        <div class="ds4-type-bar-wrap"><div class="ds4-type-bar" style="width:${width}%"></div></div>
        <span class="ds4-type-sample" style="font-size:${clampPx}px">Aa</span>
      </div>`;
    }).join('');
    const familyNames = families.map(f => (f.value || '').split(',')[0].trim().replace(/['"]/g, '')).join(', ');
    html += `
      <div class="ds4-card">
        <div class="ds4-card-head">
          <span class="ds4-card-icon" style="font-weight:900;font-size:12px">Aa</span>
          <span class="ds4-card-title">Typography</span>
          <span class="ds4-pill ${dsSc(typScore)}">${typScore}</span>
        </div>
        <div class="ds4-type-scale">${scaleRows || '<span class="ds4-empty-note">No font data</span>'}</div>
        <div class="ds4-meta">
          <span>${families.length} font ${families.length === 1 ? 'family' : 'families'}: ${familyNames}</span>
        </div>
        ${families.length > 2 ? `<div class="ds4-flag">⚠ ${families.length} font families — aim for 2 or fewer</div>` : ''}
        ${(inv.fontSizes || []).length > 10 ? `<div class="ds4-flag">⚠ ${inv.fontSizes.length} different font sizes — consider a type scale</div>` : ''}
      </div>`;

    // ── Structure Card ──
    const layout      = inv.layoutSystem || {};
    const gridRatio   = inv.spacingGridRatio || 0;
    const spacingBase = layout.spacingBase || 8;
    const bpHtml = bps.length > 0
      ? `<div class="ds4-bp-chips">${bps.map(b => `<span class="ds4-bp-chip">${b}px</span>`).join('')}</div>`
      : '<div class="ds4-flag">⚠ No responsive breakpoints detected</div>';
    html += `
      <div class="ds4-card">
        <div class="ds4-card-head">
          <span class="ds4-card-icon">⊞</span>
          <span class="ds4-card-title">Structure</span>
          <span class="ds4-pill ${dsSc(structScore)}">${structScore}</span>
        </div>
        <div class="ds4-struct-row">
          <span class="ds4-struct-lbl">Spacing</span>
          <div class="ds4-struct-bar-wrap"><div class="ds4-struct-bar" style="width:${gridRatio}%"></div></div>
          <span class="ds4-struct-val">${gridRatio}% on ${spacingBase}px grid</span>
        </div>
        ${bpHtml}
        <div class="ds4-meta">
          <span>${bps.length} breakpoint${bps.length !== 1 ? 's' : ''}</span>
          <span>${layout.layoutEngines?.flex || 0}% flex · ${layout.layoutEngines?.grid || 0}% grid</span>
        </div>
        ${gridRatio < 50 && gridRatio > 0 ? `<div class="ds4-flag">⚠ Only ${gridRatio}% on ${spacingBase}px grid — spacing may feel inconsistent</div>` : ''}
      </div>`;

    // ── Accessibility Card ──
    const contrastFails = (inv.contrastPairs || []).filter(p => p.level === 'FAIL').slice(0, 5);
    const contrastPasses = (inv.contrastPairs || []).filter(p => p.level !== 'FAIL');
    const focus  = inv.focusStates;
    const motion = inv.motion;
    const contrastHtml = contrastFails.length === 0
      ? `<div class="ds4-acc-pass">✓ ${contrastPasses.length ? `${contrastPasses.length} sampled pairs all pass` : 'No contrast issues'}</div>`
      : contrastFails.map(f => `
          <div class="ds4-contrast-fail">
            <div class="ds4-contrast-swatches">
              <div style="width:14px;height:14px;border-radius:2px;background:${f.textHex};border:1px solid rgba(0,0,0,0.1)"></div>
              <div style="width:14px;height:14px;border-radius:2px;background:${f.bgHex};border:1px solid rgba(0,0,0,0.1)"></div>
            </div>
            <span class="ds4-contrast-ratio">${f.ratio}:1</span>
            <span class="ds4-contrast-tag">&lt;${f.tag}&gt; · ${f.fontSize}px · needs ${f.isLarge ? '3' : '4.5'}:1</span>
          </div>`).join('');
    const focusHtml  = focus?.hasFocusVisible
      ? '<div class="ds4-acc-pass">✓ :focus-visible styles declared</div>'
      : (focus?.outlineRemovedWithoutReplacement > 0)
        ? `<div class="ds4-acc-fail">✕ Outline removed without :focus-visible replacement</div>`
        : '<div class="ds4-acc-warn">○ No custom focus styles</div>';
    const motionHtml = motion?.reducedMotionRespected
      ? '<div class="ds4-acc-pass">✓ prefers-reduced-motion declared</div>'
      : '<div class="ds4-acc-warn">○ No reduced-motion media query</div>';
    html += `
      <div class="ds4-card">
        <div class="ds4-card-head">
          <span class="ds4-card-icon">♿</span>
          <span class="ds4-card-title">Accessibility</span>
          <span class="ds4-pill ${dsSc(accScore)}">${accScore}</span>
        </div>
        ${contrastFails.length > 0 ? '<div class="ds4-sub-head">Contrast failures</div>' : ''}
        ${contrastHtml}
        <div class="ds4-acc-checks">
          ${focusHtml}
          ${motionHtml}
        </div>
      </div>`;

    container.innerHTML = html;

    // Rule-based design findings (unchanged — shows per-finding cards)
    findingsList.innerHTML = '';
    if (designFindings.length > 0) {
      designFindings.forEach(finding => {
        const card = document.createElement('div');
        card.className = 'finding-card';
        card.innerHTML = `
          <div class="finding-header">
            <span class="finding-number" style="background:${getMarkerColor(finding.number - 1)}">${finding.number}</span>
            <div class="finding-title-wrap">
              <span class="finding-title">${escapeHtml(finding.description)}</span>
            </div>
            <div class="ice-scores">
              <span class="ice-score ice-${getICELevel(finding.ice.impact)}">I:${finding.ice.impact}</span>
              <span class="ice-score ice-${getICELevel(finding.ice.confidence)}">C:${finding.ice.confidence}</span>
              <span class="ice-score ice-${getICELevel(finding.ice.ease)}">E:${finding.ice.ease}</span>
            </div>
          </div>`;
        findingsList.appendChild(card);
      });
    }
  }

  // Helper functions used by the new design tab cards
  function dsNorm(hex) { return (hex || '').toLowerCase().trim(); }

  function dsTokenHexSet(cssVars) {
    const set = new Set();
    for (const v of cssVars) {
      const val = (v.value || '').trim();
      if (/^#[0-9a-f]{3,8}$/i.test(val)) { set.add(dsNorm(val)); continue; }
      const m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m) {
        const hex = '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
        set.add(dsNorm(hex));
      }
    }
    return set;
  }

  function isLightColor(hex) {
    if (!hex || !hex.startsWith('#') || hex.length < 7) return false;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 200;
  }

  // ── Active Finding Highlight ──

  function setActiveFinding(number) {
    activeFindingNumber = number;

    // Highlight card
    document.querySelectorAll('.finding-card').forEach(card => {
      card.classList.toggle('active', parseInt(card.dataset.number) === number);
    });

    // Highlight marker on screenshot
    document.querySelectorAll('.marker').forEach(marker => {
      marker.classList.toggle('active', parseInt(marker.dataset.number) === number);
    });

    // Scroll card into view
    const activeCard = document.querySelector(`.finding-card[data-number="${number}"]`);
    if (activeCard) {
      activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Scroll marker into view on screenshot
    const activeMarker = document.querySelector(`.marker[data-number="${number}"]`);
    if (activeMarker) {
      activeMarker.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ── Finding Actions ──

  function copyFinding(number) {
    const finding = findings.find(f => f.number === number);
    if (!finding) return;
    const text = `${finding.number}. ${finding.description} (ICE: I:${finding.ice.impact} C:${finding.ice.confidence} E:${finding.ice.ease})`;
    navigator.clipboard.writeText(text);
    showToast('Finding copied');
  }

  function editFinding(number) {
    const finding = findings.find(f => f.number === number);
    if (!finding) return;

    const descEl = document.querySelector(`.finding-description[data-number="${number}"]`);
    if (!descEl) return;

    const currentText = finding.description;
    descEl.innerHTML = `<input type="text" value="${escapeAttr(currentText)}" />`;
    const input = descEl.querySelector('input');
    input.focus();
    input.select();

    function save() {
      finding.description = input.value || currentText;
      descEl.textContent = finding.description;
      updateStoredFindings();
    }

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { descEl.textContent = currentText; }
    });
  }

  function deleteFinding(number) {
    findings = findings.filter(f => f.number !== number);
    findings.forEach((f, i) => { f.number = i + 1; });
    renderFindings();
    renderMarkers();
    updateStoredFindings();
    showToast('Finding removed');
  }

  function updateStoredFindings() {
    if (auditData) {
      auditData.findings = findings;
      chrome.storage.local.set({ echoflowResults: auditData });
    }
  }

  // ── Sorting ──

  function sortFindings(method) {
    switch (method) {
      case 'ice-desc':
        findings.sort((a, b) => iceAverage(b.ice) - iceAverage(a.ice));
        break;
      case 'ice-asc':
        findings.sort((a, b) => iceAverage(a.ice) - iceAverage(b.ice));
        break;
      case 'category':
        findings.sort((a, b) => a.category.localeCompare(b.category));
        break;
      default:
        findings.sort((a, b) => a.number - b.number);
    }
    findings.forEach((f, i) => { f.number = i + 1; });
    renderFindings();
    renderMarkers();
  }

  // ── Save / Import ──

  function saveAudit() {
    // Save includes screenshot + findings + AI analysis (if run)
    const saveData = { ...auditData };
    // Include AI analysis if it exists
    const aiResultEl = document.getElementById('ai-result');
    if (aiResultEl && aiResultEl.style.display !== 'none' && aiResultEl.textContent) {
      saveData.aiAnalysis = aiResultEl.textContent;
    }
    const blob = new Blob([JSON.stringify(saveData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `echoflow-audit-${dateStr}.echoflow`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Audit saved');
  }

  function importAudit(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.findings) {
          showToast('Invalid audit file — no findings');
          return;
        }
        auditData = data;
        findings = data.findings;
        renderAll();
        updateStoredFindings();
        // Restore AI analysis if present in saved file
        if (data.aiAnalysis) {
          document.getElementById('ai-placeholder').style.display = 'none';
          const resultEl = document.getElementById('ai-result');
          resultEl.innerHTML = formatAIResponse(data.aiAnalysis);
          resultEl.style.display = 'block';
        }
        showToast('Audit imported');
      } catch (err) {
        showToast('Failed to parse file');
      }
    };
    reader.readAsText(file);
  }

  // ── Export to Figma ──

  function getPresSettings() {
    const sizeVal = document.getElementById('pres-frame-size').value;
    let width, height;
    if (sizeVal === 'custom') {
      width = parseInt(document.getElementById('pres-width').value) || 1920;
      height = parseInt(document.getElementById('pres-height').value) || 1080;
    } else {
      [width, height] = sizeVal.split('x').map(Number);
    }
    const bgColor = document.getElementById('pres-bg-hex').value || '#000000';
    const layout = document.querySelector('input[name="pres-layout"]:checked')?.value || 'screenshot-left';
    return { width, height, bgColor, layout };
  }

  function exportToFigma() {
    if (!auditData || findings.length === 0) {
      showToast('No findings to export');
      return;
    }

    const pres = getPresSettings();
    const W = pres.width;
    const H = pres.height;
    const bg = pres.bgColor;
    const layout = pres.layout;
    const url = auditData.meta.url;
    const vertical = auditData.meta.vertical.replace('-', ' ');
    const dateStr = new Date(auditData.meta.timestamp).toLocaleString();

    // Parse hex color to Figma RGB (0-1)
    function hexToFigma(hex) {
      const h = hex.replace('#', '');
      return {
        r: parseInt(h.substring(0, 2), 16) / 255,
        g: parseInt(h.substring(2, 4), 16) / 255,
        b: parseInt(h.substring(4, 6), 16) / 255
      };
    }

    const bgRgb = hexToFigma(bg);
    // Determine text color based on bg brightness
    const bgLum = 0.299 * bgRgb.r + 0.587 * bgRgb.g + 0.114 * bgRgb.b;
    const txtColor = bgLum > 0.5 ? '{r:0.1,g:0.1,b:0.18}' : '{r:1,g:1,b:1}';
    const subtxtColor = bgLum > 0.5 ? '{r:0.4,g:0.4,b:0.45}' : '{r:0.65,g:0.65,b:0.7}';
    const accentColor = '{r:0,g:0.788,b:0.655}'; // #00C9A7

    // Screenshot base64 (strip data URI prefix)
    const screenshotB64 = auditData.screenshot
      ? auditData.screenshot.split(',')[1] || ''
      : '';

    // Column positions based on layout
    const PAD = 80;
    const GAP = 60;
    const colW = Math.floor((W - PAD * 2 - GAP) / 2);
    const imgX = layout === 'screenshot-left' ? PAD : PAD + colW + GAP;
    const txtX = layout === 'screenshot-left' ? PAD + colW + GAP : PAD;

    // Build the Figma Plugin API script
    let script = `
// EchoFlow Presentation — Auto-generated for Figma Run It
// ${url} | ${vertical} | ${dateStr}

(async () => {
  // ── Helpers ──
  const W = ${W}, H = ${H};
  const PAD = ${PAD}, GAP = ${GAP}, COL_W = ${colW};
  const IMG_X = ${imgX}, TXT_X = ${txtX};
  const BG = {r:${bgRgb.r.toFixed(3)},g:${bgRgb.g.toFixed(3)},b:${bgRgb.b.toFixed(3)}};
  const TXT = ${txtColor};
  const SUBTXT = ${subtxtColor};
  const ACCENT = ${accentColor};

  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });

  let imageHash = null;
`;

    // Add screenshot decoding if available
    if (screenshotB64) {
      script += `
  // Decode screenshot
  try {
    const b64 = "${screenshotB64}";
    const raw = atob(b64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    const img = figma.createImage(arr);
    imageHash = img.hash;
  } catch(e) {
    console.log("Screenshot decode failed:", e);
  }
`;
    }

    script += `
  const section = figma.createSection();
  section.name = "EchoFlow — ${escapeStr(url)}";
  let slideY = 0;

  function createSlide(name) {
    const frame = figma.createFrame();
    frame.name = name;
    frame.resize(W, H);
    frame.x = 0;
    frame.y = slideY;
    frame.fills = [{ type: "SOLID", color: BG }];
    frame.clipsContent = true;
    section.appendChild(frame);
    slideY += H + 100;
    return frame;
  }

  function addText(parent, x, y, w, text, size, color, weight) {
    const t = figma.createText();
    t.x = x;
    t.y = y;
    t.resize(w, size * 2);
    t.textAutoResize = "HEIGHT";
    t.characters = text;
    t.fontSize = size;
    t.fills = [{ type: "SOLID", color: color }];
    t.fontName = { family: "Inter", style: weight || "Regular" };
    parent.appendChild(t);
    return t;
  }

  function addScreenshot(parent, x, y, w, h) {
    const rect = figma.createRectangle();
    rect.name = "Screenshot";
    rect.x = x;
    rect.y = y;
    rect.resize(w, h);
    rect.cornerRadius = 12;
    if (imageHash) {
      rect.fills = [{ type: "IMAGE", imageHash: imageHash, scaleMode: "FIT" }];
    } else {
      rect.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.2 } }];
    }
    parent.appendChild(rect);
    return rect;
  }

  function addBadge(parent, x, y, text, color) {
    const badge = figma.createFrame();
    badge.name = "Badge";
    badge.x = x;
    badge.y = y;
    badge.cornerRadius = 6;
    badge.fills = [{ type: "SOLID", color: color, opacity: 0.15 }];
    badge.layoutMode = "HORIZONTAL";
    badge.paddingLeft = 12;
    badge.paddingRight = 12;
    badge.paddingTop = 6;
    badge.paddingBottom = 6;
    badge.primaryAxisSizingMode = "AUTO";
    badge.counterAxisSizingMode = "AUTO";
    const t = figma.createText();
    t.characters = text;
    t.fontSize = 14;
    t.fills = [{ type: "SOLID", color: color }];
    t.fontName = { family: "Inter", style: "Semi Bold" };
    badge.appendChild(t);
    parent.appendChild(badge);
    return badge;
  }
`;

    // ── Slide 1: Title ──
    script += `
  // ── Title Slide ──
  {
    const slide = createSlide("Title");
    addText(slide, TXT_X, ${H * 0.25}, COL_W, "UX Audit Report", 56, TXT, "Bold");
    addText(slide, TXT_X, ${H * 0.25 + 80}, COL_W, "${escapeStr(url)}", 22, ACCENT, "Semi Bold");
    addText(slide, TXT_X, ${H * 0.25 + 120}, COL_W, "${escapeStr(vertical)} | ${escapeStr(dateStr)}", 18, SUBTXT, "Regular");
    addText(slide, TXT_X, ${H * 0.25 + 160}, COL_W, "${findings.length} findings identified", 18, SUBTXT, "Regular");
    addScreenshot(slide, IMG_X, PAD, COL_W, H - PAD * 2);
  }
`;

    // Severity color helper in generated script
    script += `
  function getSeverityColor(avg) {
    if (avg >= 7) return {r:0.937,g:0.267,b:0.267}; // red
    if (avg >= 5) return {r:0.961,g:0.620,b:0.043}; // amber
    return {r:0.133,g:0.773,b:0.369}; // green
  }
`;

    // ── Finding slides ──
    findings.forEach((f) => {
      const cat = f.category.toUpperCase();
      const desc = escapeStr(f.description);
      const avg = iceAverage(f.ice);
      const iceText = `Impact: ${f.ice.impact}/10    Confidence: ${f.ice.confidence}/10    Ease: ${f.ice.ease}/10    Average: ${avg}`;
      const sevLabel = parseFloat(avg) >= 7 ? 'HIGH' : parseFloat(avg) >= 5 ? 'MEDIUM' : 'LOW';

      script += `
  // ── Finding #${f.number} ──
  {
    const slide = createSlide("Finding #${f.number}");
    addScreenshot(slide, IMG_X, PAD, COL_W, H - PAD * 2);

    // Finding number circle — colored by severity
    const sevColor = getSeverityColor(${avg});
    const circle = figma.createEllipse();
    circle.name = "Number";
    circle.x = TXT_X;
    circle.y = ${PAD + 20};
    circle.resize(56, 56);
    circle.fills = [{ type: "SOLID", color: sevColor }];
    slide.appendChild(circle);
    addText(slide, TXT_X + 16, ${PAD + 32}, 24, "${f.number}", 24, {r:1,g:1,b:1}, "Bold");

    addBadge(slide, TXT_X + 72, ${PAD + 30}, "${cat}", ACCENT);
    addBadge(slide, TXT_X + 72 + ${cat.length * 10 + 40}, ${PAD + 30}, "${sevLabel}", sevColor);

    addText(slide, TXT_X, ${PAD + 110}, COL_W, "Finding #${f.number}", 40, TXT, "Bold");
    addText(slide, TXT_X, ${PAD + 170}, COL_W, "${desc}", 24, SUBTXT, "Regular");

    // ICE scores
    addText(slide, TXT_X, ${H - PAD - 100}, COL_W, "ICE Score", 16, SUBTXT, "Semi Bold");
    addText(slide, TXT_X, ${H - PAD - 70}, COL_W, "${iceText}", 16, TXT, "Regular");
  }
`;
    });

    // ── AI Analysis slide (if available) ──
    const aiResultEl2 = document.getElementById('ai-result');
    if (aiResultEl2 && aiResultEl2.style.display !== 'none' && aiResultEl2.textContent) {
      const aiText = escapeStr(aiResultEl2.textContent.substring(0, 2000));
      script += `
  // ── AI Analysis Slide ──
  {
    const slide = createSlide("AI Analysis");
    addText(slide, PAD, PAD, W - PAD * 2, "AI Analysis", 48, TXT, "Bold");
    addText(slide, PAD, PAD + 70, W - PAD * 2, "${aiText}", 18, SUBTXT, "Regular");
  }
`;
    }

    // ── Summary slide ──
    const categories = findings.reduce((acc, f) => {
      acc[f.category] = (acc[f.category] || 0) + 1;
      return acc;
    }, {});
    const avgScore = (findings.reduce((sum, f) => sum + parseFloat(iceAverage(f.ice)), 0) / findings.length).toFixed(1);
    const catLines = Object.entries(categories).map(([k, v]) => `${k}: ${v}`).join('    ');

    script += `
  // ── Summary Slide ──
  {
    const slide = createSlide("Summary");
    addScreenshot(slide, IMG_X, PAD, COL_W, H - PAD * 2);

    addText(slide, TXT_X, ${PAD + 20}, COL_W, "Summary", 56, TXT, "Bold");
    addText(slide, TXT_X, ${PAD + 110}, COL_W, "Total Findings", 16, SUBTXT, "Semi Bold");
    addText(slide, TXT_X, ${PAD + 135}, COL_W, "${findings.length}", 48, ACCENT, "Bold");

    addText(slide, TXT_X, ${PAD + 220}, COL_W, "Average ICE Score", 16, SUBTXT, "Semi Bold");
    addText(slide, TXT_X, ${PAD + 245}, COL_W, "${avgScore}", 48, ACCENT, "Bold");

    addText(slide, TXT_X, ${PAD + 340}, COL_W, "Categories", 16, SUBTXT, "Semi Bold");
    addText(slide, TXT_X, ${PAD + 370}, COL_W, "${escapeStr(catLines)}", 20, TXT, "Regular");

    addText(slide, TXT_X, ${H - PAD - 40}, COL_W, "Generated by EchoFlow", 14, SUBTXT, "Regular");
  }

  // Focus on the section
  figma.viewport.scrollAndZoomIntoView([section]);
  figma.notify("EchoFlow: ${findings.length + 2} slides created ✓");
})();
`;

    // Save as .js file
    const blob = new Blob([script], { type: 'text/javascript' });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fileDateStr = new Date().toISOString().slice(0, 10);
    a.href = dlUrl;
    a.download = `echoflow-presentation-${fileDateStr}.js`;
    a.click();
    URL.revokeObjectURL(dlUrl);
    showToast('Figma script exported — paste into Run It plugin');
  }

  function escapeStr(str) {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '');
  }

  // ── Export JSON for Claude ──
  // Builds a structured envelope that Claude can read and reason over.
  // Pattern: EchoFlow → clipboard → paste into Claude chat → Claude writes Run It JS → paste into FigJam.
  // Schema version lets us evolve safely later.
  function buildClaudeEnvelope() {
    const meta = auditData.meta || {};
    const isAdapt = auditData.mode === 'shopify-adapt';

    // Strip screenshot from envelope — too large for chat paste, not needed by Claude for analysis.
    // Claude can ask for it explicitly if required later.
    const envelope = {
      echoflow: {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        mode: isAdapt ? 'shopify-migration' : 'page-audit',
        note: 'Paste this JSON into a Claude chat. Claude can summarize findings, compare sites, or generate Run It JS for Figma/FigJam.'
      },
      site: {
        url: meta.url || auditData.url || null,
        title: meta.title || auditData.pageTitle || null,
        vertical: meta.vertical || null,
        device: meta.device || 'desktop',
        pageType: meta.pageType || auditData.pageType || null,
        platform: meta.platform || auditData.platform || null,
        timestamp: meta.timestamp || auditData.timestamp || Date.now()
      }
    };

    // ── Page audit branch ──
    if (!isAdapt) {
      const allFindings = (auditData.findings || []).map(f => ({
        number: f.number,
        category: f.category,
        description: f.description,
        ice: f.ice,
        iceAverage: parseFloat(iceAverage(f.ice)),
        severity: parseFloat(iceAverage(f.ice)) >= 7 ? 'high' : parseFloat(iceAverage(f.ice)) >= 5 ? 'medium' : 'low',
        selector: f.selector || null,
        ruleId: f.ruleId || null
      }));

      const avgScore = allFindings.length
        ? (allFindings.reduce((s, f) => s + f.iceAverage, 0) / allFindings.length).toFixed(2)
        : null;

      const categoryCounts = allFindings.reduce((acc, f) => {
        acc[f.category] = (acc[f.category] || 0) + 1;
        return acc;
      }, {});

      envelope.audit = {
        findingCount: allFindings.length,
        averageICE: avgScore ? parseFloat(avgScore) : null,
        categoryCounts,
        findings: allFindings,
        designInventory: auditData.designInventory || null,
        aiAnalysis: auditData.aiAnalysis || null
      };
    }

    // ── Shopify Migration branch ──
    if (isAdapt) {
      envelope.shopifyMigration = {
        viability: auditData.viability || null,
        regions: auditData.regions || [],
        components: auditData.components || [],
        complexitySignals: auditData.complexitySignals || null,
        techStack: auditData.complexitySignals?.techStack || null,
        thirdPartyScripts: auditData.complexitySignals?.thirdPartyScripts || [],
        thirdPartyCategories: auditData.complexitySignals?.thirdPartyCategories || null,
        shopifyDetails: auditData.shopifyDetails || null,
        mappings: {
          sections: auditData.sectionMappings || [],
          components: auditData.componentMappings || []
        },
        platformMigration: auditData.platformMigration || null,
        aiAnalysis: auditData.aiAnalysis || null
      };
    }

    return envelope;
  }

  async function exportJSONForClaude() {
    if (!auditData) {
      showToast('No audit data to export');
      return;
    }

    try {
      const envelope = buildClaudeEnvelope();
      const json = JSON.stringify(envelope, null, 2);
      await navigator.clipboard.writeText(json);
      const sizeKB = (json.length / 1024).toFixed(1);
      showToast(`JSON copied for Claude (${sizeKB} KB)`);
    } catch (err) {
      // Fallback: download as file if clipboard blocked (some extension contexts restrict it)
      try {
        const envelope = buildClaudeEnvelope();
        const json = JSON.stringify(envelope, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = dlUrl;
        a.download = `echoflow-claude-${dateStr}.json`;
        a.click();
        URL.revokeObjectURL(dlUrl);
        showToast('Clipboard blocked — JSON downloaded instead');
      } catch (err2) {
        showToast('Export failed: ' + (err.message || 'unknown'));
      }
    }
  }

  // ── Copy All ──

  function copyAllFindings() {
    const lines = findings.map(f =>
      `${f.number}. ${f.description} [${f.category}] (ICE: I:${f.ice.impact} C:${f.ice.confidence} E:${f.ice.ease} = ${iceAverage(f.ice)})`
    );
    const text = `EchoFlow UX Audit — ${auditData.meta.url}\n${auditData.meta.vertical} | ${new Date(auditData.meta.timestamp).toLocaleString()}\n\n${lines.join('\n')}`;
    navigator.clipboard.writeText(text);
    showToast('All findings copied');
  }

  // ── Export: PDF Report ──

  function exportPDF() {
    if (!findings.length) { showToast('No findings to export'); return; }

    const meta = auditData.meta;
    const device = meta.device || 'desktop';
    const pageType = meta.pageType ? ` — ${meta.pageType.replace(/-/g, ' ')}` : '';
    const dateStr = new Date(meta.timestamp).toLocaleString();
    const screenshot = auditData.screenshot || '';

    // Build category summary
    const categories = findings.reduce((acc, f) => {
      acc[f.category] = (acc[f.category] || 0) + 1;
      return acc;
    }, {});
    const avgScore = (findings.reduce((sum, f) => sum + parseFloat(iceAverage(f.ice)), 0) / findings.length).toFixed(1);

    // Severity helper
    function severity(ice) {
      const avg = parseFloat(iceAverage(ice));
      if (avg >= 7) return { label: 'High', color: '#ef4444', bg: '#fef2f2' };
      if (avg >= 5) return { label: 'Medium', color: '#f59e0b', bg: '#fffbeb' };
      return { label: 'Low', color: '#22c55e', bg: '#f0fdf4' };
    }

    // Build HTML
    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>EchoFlow Audit Report — ${escapeHtml(meta.url)}</title>
<style>
  @page { size: A4; margin: 20mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11pt; color: #1a1a2e; line-height: 1.5; }
  .page-break { page-break-before: always; }
  .cover { display: flex; flex-direction: column; justify-content: center; min-height: 90vh; }
  .cover h1 { font-size: 36pt; color: #00C9A7; margin-bottom: 12px; }
  .cover .url { font-size: 14pt; color: #666; word-break: break-all; }
  .cover .meta-row { display: flex; gap: 16px; margin-top: 20px; flex-wrap: wrap; }
  .cover .meta-pill { padding: 6px 14px; border-radius: 20px; font-size: 10pt; font-weight: 600; }
  .cover .meta-pill.vert { background: #f0fdf9; color: #00996e; }
  .cover .meta-pill.dev { background: #f1f5f9; color: #475569; }
  .cover .meta-pill.date { background: #f5f3ff; color: #6366f1; }
  .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 30px 0; }
  .stat-card { border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px; text-align: center; }
  .stat-value { font-size: 28pt; font-weight: 700; color: #00C9A7; }
  .stat-label { font-size: 9pt; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
  .cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin: 16px 0 30px; }
  .cat-pill { padding: 8px 12px; border-radius: 8px; background: #f8fafc; border: 1px solid #e2e8f0; font-size: 10pt; display: flex; justify-content: space-between; }
  .cat-count { font-weight: 700; color: #00C9A7; }
  h2 { font-size: 18pt; color: #1a1a2e; border-bottom: 2px solid #00C9A7; padding-bottom: 6px; margin: 24px 0 16px; }
  .finding-card { border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px; margin-bottom: 16px; break-inside: avoid; }
  .finding-header { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
  .finding-num { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13pt; color: #fff; flex-shrink: 0; }
  .finding-title { flex: 1; font-size: 11pt; font-weight: 500; }
  .finding-badges { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .fbadge { padding: 3px 10px; border-radius: 12px; font-size: 8.5pt; font-weight: 600; }
  .ice-row { display: flex; gap: 16px; margin-top: 12px; font-size: 9.5pt; color: #666; }
  .ice-item strong { color: #1a1a2e; }
  .screenshot-section { margin: 20px 0; text-align: center; }
  .screenshot-section img { max-width: 100%; border-radius: 8px; border: 1px solid #e0e0e0; }
  .ai-section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-top: 16px; white-space: pre-wrap; font-size: 10pt; line-height: 1.6; }
  .footer { text-align: center; color: #aaa; font-size: 9pt; margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; }
  @media print { .no-print { display: none; } }
</style></head><body>`;

    // Cover page
    html += `<div class="cover">
  <h1>UX Audit Report</h1>
  <div class="url">${escapeHtml(meta.url)}</div>
  <div class="meta-row">
    <span class="meta-pill vert">${escapeHtml(meta.vertical.replace('-', ' '))}${escapeHtml(pageType)}</span>
    <span class="meta-pill dev">${device} (${meta.viewport.width}x${meta.viewport.height})</span>
    <span class="meta-pill date">${escapeHtml(dateStr)}</span>
  </div>
  <div class="stats-grid">
    <div class="stat-card"><div class="stat-value">${findings.length}</div><div class="stat-label">Total Findings</div></div>
    <div class="stat-card"><div class="stat-value">${avgScore}</div><div class="stat-label">Avg ICE Score</div></div>
    <div class="stat-card"><div class="stat-value">${Object.keys(categories).length}</div><div class="stat-label">Categories</div></div>
  </div>
  <div class="cat-grid">
    ${Object.entries(categories).map(([k, v]) => `<div class="cat-pill"><span>${k}</span><span class="cat-count">${v}</span></div>`).join('')}
  </div>
</div>`;

    // Screenshot page
    if (screenshot) {
      html += `<div class="page-break"></div><h2>Page Screenshot</h2>
<div class="screenshot-section"><img src="${screenshot}" alt="Page screenshot"></div>`;
    }

    // Findings
    html += `<div class="page-break"></div><h2>Findings (${findings.length})</h2>`;
    findings.forEach(f => {
      const sev = severity(f.ice);
      const avg = iceAverage(f.ice);
      html += `<div class="finding-card">
  <div class="finding-header">
    <div class="finding-num" style="background:${sev.color};">${f.number}</div>
    <div class="finding-title">${escapeHtml(f.description)}</div>
  </div>
  <div class="finding-badges">
    <span class="fbadge" style="background:${sev.bg};color:${sev.color};">${sev.label} Priority</span>
    <span class="fbadge" style="background:#f0fdf9;color:#00996e;">${f.category}</span>
  </div>
  <div class="ice-row">
    <span><strong>Impact:</strong> ${f.ice.impact}/10</span>
    <span><strong>Confidence:</strong> ${f.ice.confidence}/10</span>
    <span><strong>Ease:</strong> ${f.ice.ease}/10</span>
    <span><strong>Average:</strong> ${avg}</span>
  </div>
</div>`;
    });

    // AI analysis if available
    const aiResultEl = document.getElementById('ai-result');
    if (aiResultEl && aiResultEl.style.display !== 'none' && aiResultEl.textContent) {
      html += `<div class="page-break"></div><h2>AI Analysis</h2>
<div class="ai-section">${escapeHtml(aiResultEl.textContent)}</div>`;
    }

    html += `<div class="footer">Generated by EchoFlow — ${escapeHtml(dateStr)}</div>`;
    html += `</body></html>`;

    // Open in new tab for print
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    showToast('PDF report opened — use Ctrl/Cmd+P to print');
  }

  // ── AI Analysis ──

  async function runAIAnalysis() {
    const stored = await chrome.storage.local.get(['echoflowProvider', 'echoflowClaudeKey', 'echoflowGeminiKey']);
    const provider = stored.echoflowProvider || 'claude';
    const apiKey = provider === 'gemini' ? stored.echoflowGeminiKey : stored.echoflowClaudeKey;

    if (!apiKey) {
      openSettings();
      showToast('Set your ' + (provider === 'gemini' ? 'Gemini' : 'Claude') + ' API key first');
      return;
    }

    // Show loading
    document.getElementById('ai-placeholder').style.display = 'none';
    document.getElementById('ai-loading').style.display = 'flex';
    document.getElementById('ai-result').style.display = 'none';
    document.getElementById('ai-error').style.display = 'none';

    try {
      const contextEl = document.getElementById('audit-context');
      const auditContext = contextEl ? contextEl.value.trim() : '';

      const response = await chrome.runtime.sendMessage({
        action: 'AI_ANALYZE',
        data: auditData,
        apiKey: apiKey,
        provider: provider,
        auditContext: auditContext || null
      });

      document.getElementById('ai-loading').style.display = 'none';

      if (response.success) {
        const resultEl = document.getElementById('ai-result');
        resultEl.innerHTML = formatAIResponse(response.analysis);
        resultEl.style.display = 'block';
      } else {
        const errorEl = document.getElementById('ai-error');
        errorEl.textContent = response.error || 'Analysis failed';
        errorEl.style.display = 'block';
      }
    } catch (err) {
      document.getElementById('ai-loading').style.display = 'none';
      const errorEl = document.getElementById('ai-error');
      errorEl.textContent = 'Error: ' + err.message;
      errorEl.style.display = 'block';
    }
  }

  function formatAIResponse(text) {
    // Simple markdown-like formatting
    return text
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }

  // ── Dark Pattern Detector ──

  async function runDarkPatternsAnalysis() {
    const stored = await chrome.storage.local.get(['echoflowClaudeKey']);
    const apiKey = stored.echoflowClaudeKey;

    if (!apiKey) {
      openSettings();
      showToast('Set your Claude API key first');
      return;
    }

    document.getElementById('dark-pattern-loading').style.display = 'flex';
    document.getElementById('dark-pattern-result').style.display = 'none';
    document.getElementById('dark-pattern-error').style.display = 'none';
    document.getElementById('btn-dark-patterns').disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'AI_SPECIALIST',
        mode: 'dark-patterns',
        data: auditData,
        apiKey: apiKey
      });

      document.getElementById('dark-pattern-loading').style.display = 'none';
      document.getElementById('btn-dark-patterns').disabled = false;

      if (response.success) {
        const resultEl = document.getElementById('dark-pattern-result');
        resultEl.innerHTML = renderDarkPatternResult(response.result);
        resultEl.style.display = 'block';
      } else {
        const errorEl = document.getElementById('dark-pattern-error');
        errorEl.textContent = response.error || 'Analysis failed';
        errorEl.style.display = 'block';
      }
    } catch (err) {
      document.getElementById('dark-pattern-loading').style.display = 'none';
      document.getElementById('btn-dark-patterns').disabled = false;
      const errorEl = document.getElementById('dark-pattern-error');
      errorEl.textContent = 'Error: ' + err.message;
      errorEl.style.display = 'block';
    }
  }

  function renderDarkPatternResult(result) {
    if (result.raw) {
      return `<pre style="white-space:pre-wrap;font-size:12px;">${escapeHtml(result.raw)}</pre>`;
    }

    const riskColors = { low: '#43a047', medium: '#ffb300', high: '#fb8c00', critical: '#e53935' };
    const sevLabels = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
    const riskColor = riskColors[result.riskLevel] || '#888';
    const patternsFound = result.patternsFound || [];
    const patternsClear = result.patternsClear || [];

    let html = `<div class="dp-summary">
      <div class="dp-risk-row">
        <span class="dp-risk-badge" style="background:${riskColor};">${(result.riskLevel || 'unknown').toUpperCase()} RISK</span>
        <span class="dp-summary-text">${escapeHtml(result.summary || '')}</span>
      </div>
    </div>`;

    if (patternsFound.length > 0) {
      html += `<div class="dp-section-title">⚠ Patterns Detected (${patternsFound.length})</div>`;
      patternsFound.forEach(p => {
        const sevColor = riskColors[p.severity] || '#888';
        const regTags = [
          p.euRegulation ? `<span class="reg-badge reg-badge-eu">${escapeHtml(p.euRegulation)}</span>` : '',
          p.usRegulation ? `<span class="reg-badge reg-badge-us">${escapeHtml(p.usRegulation)}</span>` : ''
        ].filter(Boolean).join(' ');

        html += `<div class="dp-pattern-card">
          <div class="dp-pattern-header">
            <span class="dp-severity-dot" style="background:${sevColor};"></span>
            <strong class="dp-pattern-name">${escapeHtml(p.pattern)}</strong>
            <span class="dp-sev-label" style="color:${sevColor};">${sevLabels[p.severity] || p.severity}</span>
          </div>
          ${regTags ? `<div class="dp-reg-tags">${regTags}</div>` : ''}
          <div class="dp-evidence">Evidence: <em>${escapeHtml(p.evidence || '')}</em></div>
          <div class="dp-recommendation">Fix: ${escapeHtml(p.recommendation || '')}</div>
        </div>`;
      });
    } else {
      html += `<div class="dp-clean-banner">✓ No dark patterns detected in scanned content</div>`;
    }

    if (patternsClear.length > 0) {
      html += `<div class="dp-section-title dp-clean-title">✓ Patterns Checked — Clear (${patternsClear.length})</div>
        <div class="dp-clean-list">${patternsClear.map(p => `<span class="dp-clean-tag">${escapeHtml(p)}</span>`).join('')}</div>`;
    }

    if (result.complianceNotes) {
      html += `<div class="dp-compliance-note">${escapeHtml(result.complianceNotes)}</div>`;
    }

    return html;
  }

  // ── Copy Intelligence ──

  async function runCopyIntelligence() {
    const stored = await chrome.storage.local.get(['echoflowClaudeKey']);
    const apiKey = stored.echoflowClaudeKey;

    if (!apiKey) {
      openSettings();
      showToast('Set your Claude API key first');
      return;
    }

    document.getElementById('copy-loading').style.display = 'flex';
    document.getElementById('copy-result').style.display = 'none';
    document.getElementById('copy-error').style.display = 'none';
    document.getElementById('btn-copy-intel').disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'AI_SPECIALIST',
        mode: 'copy-intelligence',
        data: auditData,
        apiKey: apiKey
      });

      document.getElementById('copy-loading').style.display = 'none';
      document.getElementById('btn-copy-intel').disabled = false;

      if (response.success) {
        const resultEl = document.getElementById('copy-result');
        resultEl.innerHTML = renderCopyResult(response.result);
        resultEl.style.display = 'block';
      } else {
        const errorEl = document.getElementById('copy-error');
        errorEl.textContent = response.error || 'Analysis failed';
        errorEl.style.display = 'block';
      }
    } catch (err) {
      document.getElementById('copy-loading').style.display = 'none';
      document.getElementById('btn-copy-intel').disabled = false;
      const errorEl = document.getElementById('copy-error');
      errorEl.textContent = 'Error: ' + err.message;
      errorEl.style.display = 'block';
    }
  }

  function renderCopyResult(result) {
    if (result.raw) {
      return `<pre style="white-space:pre-wrap;font-size:12px;">${escapeHtml(result.raw)}</pre>`;
    }

    const score = result.overallScore || 0;
    const scoreColor = score >= 8 ? '#43a047' : score >= 6 ? '#ffb300' : score >= 4 ? '#fb8c00' : '#e53935';
    const dims = result.dimensions || [];

    let html = `<div class="copy-summary">
      <div class="copy-score-row">
        <div class="copy-score-ring" style="--score-color:${scoreColor};">
          <span class="copy-score-num">${score}</span>
          <span class="copy-score-label">/10</span>
        </div>
        <div class="copy-summary-text">${escapeHtml(result.overallSummary || '')}</div>
      </div>`;

    if (result.readingLevel) {
      html += `<div class="copy-reading-level">📖 Reading Level: <strong>${escapeHtml(result.readingLevel)}</strong></div>`;
    }
    html += `</div>`;

    if (dims.length > 0) {
      html += `<div class="copy-dims-grid">`;
      dims.forEach(d => {
        const ds = d.score || 0;
        const dc = ds >= 8 ? '#43a047' : ds >= 6 ? '#ffb300' : ds >= 4 ? '#fb8c00' : '#e53935';
        const barW = Math.round(ds * 10);
        html += `<div class="copy-dim-card">
          <div class="copy-dim-header">
            <span class="copy-dim-name">${escapeHtml(d.name)}</span>
            <span class="copy-dim-score" style="color:${dc};">${ds}/10</span>
          </div>
          <div class="copy-dim-bar"><div class="copy-dim-bar-fill" style="width:${barW}%;background:${dc};"></div></div>
          <div class="copy-dim-finding">${escapeHtml(d.finding || '')}</div>
          ${d.recommendation ? `<div class="copy-dim-rec">→ ${escapeHtml(d.recommendation)}</div>` : ''}
        </div>`;
      });
      html += `</div>`;
    }

    if (result.topFixes && result.topFixes.length > 0) {
      html += `<div class="copy-section-title">Top Priority Fixes</div><ul class="copy-fixes-list">`;
      result.topFixes.forEach(f => { html += `<li>${escapeHtml(f)}</li>`; });
      html += `</ul>`;
    }

    if (result.rewriteSuggestions && result.rewriteSuggestions.length > 0) {
      html += `<div class="copy-section-title">Rewrite Suggestions</div>`;
      result.rewriteSuggestions.forEach(rw => {
        html += `<div class="copy-rewrite-card">
          <div class="copy-rewrite-original"><span class="copy-rw-label">Original</span> "${escapeHtml(rw.original || '')}"</div>
          <div class="copy-rewrite-new"><span class="copy-rw-label copy-rw-new">Rewrite</span> "${escapeHtml(rw.rewrite || '')}"</div>
          ${rw.reason ? `<div class="copy-rewrite-reason">${escapeHtml(rw.reason)}</div>` : ''}
        </div>`;
      });
    }

    return html;
  }

  // ── Settings Modal ──

  function openSettings() {
    const modal = document.getElementById('settings-modal');
    modal.style.display = 'flex';
    chrome.storage.local.get([
      'echoflowProvider', 'echoflowClaudeKey', 'echoflowGeminiKey',
      'echoflowPresSize', 'echoflowPresWidth', 'echoflowPresHeight',
      'echoflowPresBg', 'echoflowPresLayout'
    ], (stored) => {
      // AI settings
      const provider = stored.echoflowProvider || 'claude';
      document.getElementById('provider-select').value = provider;
      document.getElementById('claude-key-input').value = stored.echoflowClaudeKey || '';
      document.getElementById('gemini-key-input').value = stored.echoflowGeminiKey || '';
      toggleKeyFields(provider);

      // Presentation settings
      document.getElementById('pres-frame-size').value = stored.echoflowPresSize || '1920x1080';
      toggleCustomSize(stored.echoflowPresSize || '1920x1080');
      if (stored.echoflowPresWidth) document.getElementById('pres-width').value = stored.echoflowPresWidth;
      if (stored.echoflowPresHeight) document.getElementById('pres-height').value = stored.echoflowPresHeight;
      const bg = stored.echoflowPresBg || '#000000';
      document.getElementById('pres-bg-color').value = bg;
      document.getElementById('pres-bg-hex').value = bg;
      const layout = stored.echoflowPresLayout || 'screenshot-left';
      const layoutRadio = document.querySelector(`input[name="pres-layout"][value="${layout}"]`);
      if (layoutRadio) layoutRadio.checked = true;
    });
  }

  function toggleKeyFields(provider) {
    document.getElementById('claude-key-group').style.display = provider === 'claude' ? 'block' : 'none';
    document.getElementById('gemini-key-group').style.display = provider === 'gemini' ? 'block' : 'none';
  }

  function toggleCustomSize(sizeVal) {
    document.getElementById('pres-custom-size').style.display = sizeVal === 'custom' ? 'flex' : 'none';
  }

  function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
  }

  function saveSettings() {
    const provider = document.getElementById('provider-select').value;
    const claudeKey = document.getElementById('claude-key-input').value.trim();
    const geminiKey = document.getElementById('gemini-key-input').value.trim();
    const presSize = document.getElementById('pres-frame-size').value;
    const presWidth = document.getElementById('pres-width').value;
    const presHeight = document.getElementById('pres-height').value;
    const presBg = document.getElementById('pres-bg-hex').value.trim();
    const presLayout = document.querySelector('input[name="pres-layout"]:checked')?.value || 'screenshot-left';

    chrome.storage.local.set({
      echoflowProvider: provider,
      echoflowClaudeKey: claudeKey,
      echoflowGeminiKey: geminiKey,
      echoflowPresSize: presSize,
      echoflowPresWidth: presWidth,
      echoflowPresHeight: presHeight,
      echoflowPresBg: presBg,
      echoflowPresLayout: presLayout
    }, () => {
      closeSettings();
      showToast('Settings saved');
    });
  }

  // ── Tab Switching ──

  function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === 'tab-' + tabName);
    });
  }

  // ── Utilities ──

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Export: Copy for Notion ──

  function exportToNotion() {
    if (!auditData) { showToast('No data to export'); return; }

    const isAdapt = auditData.mode === 'shopify-adapt';
    let md = '';

    if (isAdapt) {
      // ── Adapt / Migration Notion Export ──
      const meta = auditData.meta;
      const sections = auditData.sectionMappings || [];
      const components = auditData.componentMappings || [];
      const contentSections = sections.filter(s => !s.isLayout);
      const allItems = [...contentSections, ...components];
      const green = allItems.filter(i => i.shopifyMapping?.status === 'green').length;
      const yellow = allItems.filter(i => i.shopifyMapping?.status === 'yellow').length;
      const red = allItems.filter(i => i.shopifyMapping?.status === 'red').length;
      const viability = allItems.length > 0 ? Math.round((green / allItems.length) * 100) : 0;
      const dateStr = new Date(meta.timestamp).toLocaleDateString();

      md += `# Shopify Migration Assessment\n`;
      md += `**URL:** ${meta.url}\n`;
      md += `**Date:** ${dateStr} | **Source Platform:** ${(meta.platform || 'unknown').replace(/-/g, ' ')} | **Page Type:** ${meta.pageType || 'unknown'}\n\n`;
      md += `---\n\n`;
      md += `## Viability: ${viability}%\n`;
      md += `| Native (✅) | App / Custom (🟡) | Custom Dev (🔴) | Total |\n`;
      md += `|---|---|---|---|\n`;
      md += `| ${green} | ${yellow} | ${red} | ${allItems.length} |\n\n`;

      if (contentSections.length > 0) {
        md += `## Content Sections\n`;
        md += `| Section Detected | Maps to Shopify Section | Status |\n`;
        md += `|---|---|---|\n`;
        contentSections.forEach(s => {
          const m = s.shopifyMapping;
          const emoji = m.status === 'green' ? '✅' : m.status === 'yellow' ? '🟡' : '🔴';
          md += `| ${s.type.replace(/-/g, ' ')} | ${m.sectionName} | ${emoji} ${m.status === 'green' ? 'Native' : m.status === 'yellow' ? 'App/Custom' : 'Custom Dev'} |\n`;
        });
        md += `\n`;
      }

      if (components.length > 0) {
        md += `## Components\n`;
        md += `| Component | Status | Solution |\n`;
        md += `|---|---|---|\n`;
        components.forEach(c => {
          const m = c.shopifyMapping;
          const emoji = m.status === 'green' ? '✅' : m.status === 'yellow' ? '🟡' : '🔴';
          const sol = m.apps?.length ? `Apps: ${m.apps.slice(0, 2).map(a => typeof a === 'string' ? a : a.name).join(', ')}` : (m.solution || m.notes || '—');
          md += `| ${c.type.replace(/-/g, ' ')} | ${emoji} ${m.status === 'green' ? 'Native' : m.status === 'yellow' ? 'App/Custom' : 'Custom Dev'} | ${sol} |\n`;
        });
        md += `\n`;
      }

      // Tech stack
      const tech = auditData.complexitySignals?.techStack || {};
      const fwList = (tech.jsFrameworks || []).map(f => f.meta ? `${f.name} (${f.meta})` : f.name);
      const payments = (tech.payments || []).map(p => p.name || p);
      if (fwList.length || payments.length) {
        md += `## Tech Stack\n`;
        if (fwList.length) md += `- **JS Framework:** ${fwList.join(', ')}\n`;
        if (payments.length) md += `- **Payments:** ${payments.join(', ')}\n`;
        md += `\n`;
      }

      // Migration checklist
      md += `## Migration Checklist\n\n`;
      md += `### Phase 1 — Foundation\n`;
      md += `- [ ] Select Shopify theme\n`;
      md += `- [ ] Configure DNS + domain\n`;
      md += `- [ ] Set up Shopify Payments\n`;
      md += `- [ ] Import products (CSV or migration app)\n\n`;
      md += `### Phase 2 — Content & Structure\n`;
      md += `- [ ] Recreate page templates (${contentSections.length} section types detected)\n`;
      contentSections.filter(s => s.shopifyMapping?.status === 'green').forEach(s => {
        md += `  - [ ] ${(s.type || '').replace(/-/g, ' ')} → ${s.shopifyMapping.sectionName}\n`;
      });
      md += `\n### Phase 3 — Apps & Custom Work\n`;
      if (yellow + red === 0) {
        md += `- [ ] No apps or custom development required\n`;
      } else {
        const customWork = allItems.filter(i => i.shopifyMapping?.status === 'yellow' || i.shopifyMapping?.status === 'red');
        customWork.forEach(item => {
          const m = item.shopifyMapping;
          const name = item.type.replace(/-/g, ' ');
          const appNames = (m.apps || []).slice(0, 1).map(a => typeof a === 'string' ? a : a.name);
          md += `- [ ] ${name}: ${appNames.length ? `Install ${appNames[0]}` : m.effort || 'custom dev needed'}\n`;
        });
      }
      md += `\n### Phase 4 — QA & Launch\n`;
      md += `- [ ] Test all page templates on mobile + desktop\n`;
      md += `- [ ] Verify tracking (GA, Meta Pixel, etc.)\n`;
      md += `- [ ] 301 redirects from old URLs\n`;
      md += `- [ ] Performance check (Core Web Vitals)\n`;
      md += `- [ ] UAT with client\n`;
      md += `- [ ] Go live\n\n`;
      md += `---\n*Generated by EchoFlow v1.5 — ${dateStr}*\n`;

    } else {
      // ── UX Audit Notion Export ──
      if (!findings.length) { showToast('No findings to export'); return; }
      const meta = auditData.meta;
      const dateStr = new Date(meta.timestamp).toLocaleDateString();
      const avgICE = (findings.reduce((s, f) => s + parseFloat(iceAverage(f.ice)), 0) / findings.length).toFixed(1);
      const categories = findings.reduce((acc, f) => { acc[f.category] = (acc[f.category] || 0) + 1; return acc; }, {});

      md += `# UX Audit — ${meta.url}\n`;
      md += `**Date:** ${dateStr} | **Vertical:** ${meta.vertical} | **Device:** ${meta.device || 'desktop'} | **Findings:** ${findings.length} | **Avg ICE:** ${avgICE}\n\n`;
      md += `---\n\n`;
      md += `## Summary\n`;
      md += `| Category | Count |\n|---|---|\n`;
      Object.entries(categories).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
        md += `| ${k} | ${v} |\n`;
      });
      md += `\n`;

      // AI analysis if available
      const aiText = document.getElementById('ai-result')?.textContent?.trim();
      if (aiText) {
        md += `## AI Analysis\n${aiText}\n\n`;
      }

      md += `## Findings\n\n`;
      findings.forEach(f => {
        const avg = parseFloat(iceAverage(f.ice));
        const priority = avg >= 7 ? '🔴 High' : avg >= 5 ? '🟡 Medium' : '🟢 Low';
        md += `### ${f.number}. ${f.description}\n`;
        md += `**Category:** ${f.category} | **Priority:** ${priority} | **ICE:** I:${f.ice.impact} C:${f.ice.confidence} E:${f.ice.ease}\n\n`;
        if (f.details) md += `${f.details}\n\n`;
        if (f.recommendation) md += `> 💡 **Recommendation:** ${f.recommendation}\n\n`;
        md += `---\n\n`;
      });
      md += `*Generated by EchoFlow v1.5 — ${dateStr}*\n`;
    }

    navigator.clipboard.writeText(md).then(() => {
      showToast('Copied — paste directly into Notion');
    }).catch(() => {
      showToast('Copy failed — check browser permissions');
    });
  }

  // ── Export: HTML Slide Deck ──

  function exportAsSlides() {
    if (!auditData) { showToast('No data to export'); return; }

    const isAdapt = auditData.mode === 'shopify-adapt';
    const meta = isAdapt ? auditData.meta : auditData.meta;
    const dateStr = new Date(meta.timestamp).toLocaleDateString();
    const url = meta.url;
    const screenshot = auditData.screenshot || '';

    const slideStyles = `
      @page { size: 16in 9in; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f1a; color: #fff; }
      .slide { width: 1600px; min-height: 900px; padding: 80px; display: flex; flex-direction: column; justify-content: center; page-break-after: always; position: relative; overflow: hidden; background: #0f0f1a; }
      .slide-accent { position: absolute; top: 0; left: 0; width: 6px; height: 100%; background: #00C9A7; }
      .slide-number { position: absolute; bottom: 30px; right: 40px; font-size: 12px; color: rgba(255,255,255,0.3); }
      .slide-logo { position: absolute; top: 30px; right: 40px; font-size: 12px; color: rgba(255,255,255,0.3); font-weight: 600; letter-spacing: 1px; }
      .slide h1 { font-size: 56px; font-weight: 700; line-height: 1.15; color: #fff; margin-bottom: 24px; }
      .slide h2 { font-size: 36px; font-weight: 700; color: #fff; margin-bottom: 20px; }
      .slide h3 { font-size: 22px; font-weight: 600; color: #00C9A7; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
      .slide p { font-size: 18px; color: rgba(255,255,255,0.7); line-height: 1.6; }
      .slide .meta { font-size: 16px; color: rgba(255,255,255,0.45); margin-top: 16px; }
      .cover-url { font-size: 20px; color: #00C9A7; margin-bottom: 10px; word-break: break-all; }
      .stat-row { display: flex; gap: 40px; margin-top: 40px; }
      .stat-box { flex: 1; background: rgba(255,255,255,0.06); border-radius: 16px; padding: 32px 24px; text-align: center; border: 1px solid rgba(255,255,255,0.1); }
      .stat-value { font-size: 52px; font-weight: 800; color: #00C9A7; }
      .stat-label { font-size: 14px; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 8px; }
      .two-col { display: flex; gap: 60px; align-items: flex-start; }
      .col { flex: 1; }
      .screenshot-wrap { flex: 1; }
      .screenshot-wrap img { max-width: 100%; border-radius: 12px; border: 1px solid rgba(255,255,255,0.15); }
      .finding-row { display: flex; align-items: flex-start; gap: 20px; padding: 20px 0; border-bottom: 1px solid rgba(255,255,255,0.07); }
      .finding-num { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 15px; flex-shrink: 0; color: #fff; }
      .finding-content { flex: 1; }
      .finding-title { font-size: 17px; font-weight: 600; color: #fff; margin-bottom: 6px; }
      .finding-meta { font-size: 13px; color: rgba(255,255,255,0.4); }
      .tag { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-right: 6px; }
      .tag-green { background: rgba(34,197,94,0.15); color: #22c55e; }
      .tag-yellow { background: rgba(245,158,11,0.15); color: #f59e0b; }
      .tag-red { background: rgba(239,68,68,0.15); color: #ef4444; }
      .table-wrap { width: 100%; border-collapse: collapse; margin-top: 16px; }
      .table-wrap th { text-align: left; font-size: 13px; color: rgba(255,255,255,0.4); padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.1); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
      .table-wrap td { font-size: 15px; color: rgba(255,255,255,0.85); padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.05); }
      .checklist { list-style: none; margin-top: 16px; }
      .checklist li { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; font-size: 16px; color: rgba(255,255,255,0.75); border-bottom: 1px solid rgba(255,255,255,0.05); }
      .checklist li::before { content: "☐"; color: #00C9A7; flex-shrink: 0; font-size: 18px; }
      @media print { .slide { page-break-after: always; } }
    `;

    let slides = '';
    let slideNum = 0;

    function slide(content, extraClass = '') {
      slideNum++;
      return `<div class="slide ${extraClass}">
        <div class="slide-accent"></div>
        <div class="slide-logo">ECHOFLOW</div>
        <div class="slide-number">${slideNum}</div>
        ${content}
      </div>`;
    }

    if (isAdapt) {
      const sections = auditData.sectionMappings || [];
      const components = auditData.componentMappings || [];
      const contentSections = sections.filter(s => !s.isLayout);
      const allItems = [...contentSections, ...components];
      const green = allItems.filter(i => i.shopifyMapping?.status === 'green').length;
      const yellow = allItems.filter(i => i.shopifyMapping?.status === 'yellow').length;
      const red = allItems.filter(i => i.shopifyMapping?.status === 'red').length;
      const viability = allItems.length > 0 ? Math.round((green / allItems.length) * 100) : 0;

      // Cover
      slides += slide(`
        <h3>Shopify Migration Assessment</h3>
        <h1>Migration Feasibility Report</h1>
        <div class="cover-url">${escapeHtml(url)}</div>
        <p class="meta">${escapeHtml(meta.platform?.replace(/-/g, ' ') || 'Unknown platform')} &nbsp;·&nbsp; ${dateStr}</p>
      `);

      // Viability
      slides += slide(`
        <h3>Overall Score</h3>
        <h2>Shopify Viability: ${viability}%</h2>
        <div class="stat-row">
          <div class="stat-box"><div class="stat-value" style="color:#22c55e">${green}</div><div class="stat-label">Native</div></div>
          <div class="stat-box"><div class="stat-value" style="color:#f59e0b">${yellow}</div><div class="stat-label">App / Custom</div></div>
          <div class="stat-box"><div class="stat-value" style="color:#ef4444">${red}</div><div class="stat-label">Custom Dev</div></div>
          <div class="stat-box"><div class="stat-value">${allItems.length}</div><div class="stat-label">Total Items</div></div>
        </div>
      `);

      // Screenshot + platform
      if (screenshot) {
        slides += slide(`
          <h3>Page Analyzed</h3>
          <div class="two-col" style="align-items:center;">
            <div class="screenshot-wrap"><img src="${screenshot}" alt="screenshot"></div>
            <div class="col">
              <h2>${escapeHtml(meta.pageType || 'Page')}</h2>
              <p>${escapeHtml(url)}</p>
              <p class="meta" style="margin-top:12px;">Platform: ${escapeHtml(meta.platform?.replace(/-/g, ' ') || 'Unknown')}</p>
            </div>
          </div>
        `);
      }

      // Content sections table
      if (contentSections.length > 0) {
        slides += slide(`
          <h3>Content Sections</h3>
          <h2>Page Structure Analysis</h2>
          <table class="table-wrap">
            <tr><th>Detected Section</th><th>Shopify Equivalent</th><th>Status</th></tr>
            ${contentSections.slice(0, 10).map(s => {
              const m = s.shopifyMapping;
              const emoji = m.status === 'green' ? '✅' : m.status === 'yellow' ? '🟡' : '🔴';
              const tagCls = 'tag-' + m.status;
              return `<tr><td>${escapeHtml(s.type.replace(/-/g, ' '))}</td><td>${escapeHtml(m.sectionName)}</td><td><span class="tag ${tagCls}">${emoji} ${m.status === 'green' ? 'Native' : m.status === 'yellow' ? 'App/Custom' : 'Custom Dev'}</span></td></tr>`;
            }).join('')}
          </table>
        `);
      }

      // Components table
      if (components.length > 0) {
        slides += slide(`
          <h3>Components</h3>
          <h2>Ecommerce Component Compatibility</h2>
          <table class="table-wrap">
            <tr><th>Component</th><th>Status</th><th>Solution</th></tr>
            ${components.slice(0, 10).map(c => {
              const m = c.shopifyMapping;
              const emoji = m.status === 'green' ? '✅' : m.status === 'yellow' ? '🟡' : '🔴';
              const tagCls = 'tag-' + m.status;
              const apps = (m.apps || []).slice(0, 1).map(a => typeof a === 'string' ? a : a.name);
              const sol = apps.length ? apps[0] : (m.solution ? m.solution.substring(0, 40) : m.notes?.substring(0, 40) || '—');
              return `<tr><td>${escapeHtml(c.type.replace(/-/g, ' '))}</td><td><span class="tag ${tagCls}">${emoji} ${m.status === 'green' ? 'Native' : m.status === 'yellow' ? 'App/Custom' : 'Custom Dev'}</span></td><td>${escapeHtml(sol)}</td></tr>`;
            }).join('')}
          </table>
        `);
      }

      // Migration checklist slide
      const customWork = allItems.filter(i => i.shopifyMapping?.status === 'yellow' || i.shopifyMapping?.status === 'red');
      slides += slide(`
        <h3>Next Steps</h3>
        <h2>Migration Checklist</h2>
        <ul class="checklist">
          <li>Select Shopify theme &amp; configure basic settings</li>
          <li>Import products via CSV or migration app</li>
          <li>Recreate ${contentSections.filter(s => s.shopifyMapping?.status === 'green').length} native section templates</li>
          ${customWork.length ? `<li>Implement ${customWork.length} custom/app features</li>` : '<li>No custom development required ✅</li>'}
          <li>Set up DNS, domain, and Shopify Payments</li>
          <li>QA all page templates on mobile + desktop</li>
          <li>Configure 301 redirects from old URLs</li>
          <li>Performance check &amp; go live</li>
        </ul>
      `);

    } else {
      // ── UX Audit slides ──
      if (!findings.length) { showToast('No findings to export'); return; }
      const vertical = meta.vertical || 'ux';
      const device = meta.device || 'desktop';
      const avgICE = (findings.reduce((s, f) => s + parseFloat(iceAverage(f.ice)), 0) / findings.length).toFixed(1);
      const high = findings.filter(f => parseFloat(iceAverage(f.ice)) >= 7).length;
      const med  = findings.filter(f => { const v = parseFloat(iceAverage(f.ice)); return v >= 5 && v < 7; }).length;
      const low  = findings.length - high - med;
      const categories = findings.reduce((acc, f) => { acc[f.category] = (acc[f.category] || 0) + 1; return acc; }, {});

      // Cover
      slides += slide(`
        <h3>${escapeHtml(vertical.replace('-', ' '))} Audit</h3>
        <h1>UX Audit Report</h1>
        <div class="cover-url">${escapeHtml(url)}</div>
        <p class="meta">${device} &nbsp;·&nbsp; ${meta.viewport?.width}x${meta.viewport?.height} &nbsp;·&nbsp; ${dateStr}</p>
      `);

      // Stats
      slides += slide(`
        <h3>Executive Summary</h3>
        <h2>${findings.length} Findings Identified</h2>
        <div class="stat-row">
          <div class="stat-box"><div class="stat-value" style="color:#ef4444">${high}</div><div class="stat-label">High Priority</div></div>
          <div class="stat-box"><div class="stat-value" style="color:#f59e0b">${med}</div><div class="stat-label">Medium Priority</div></div>
          <div class="stat-box"><div class="stat-value" style="color:#22c55e">${low}</div><div class="stat-label">Low Priority</div></div>
          <div class="stat-box"><div class="stat-value">${avgICE}</div><div class="stat-label">Avg ICE Score</div></div>
        </div>
      `);

      // Screenshot
      if (screenshot) {
        slides += slide(`
          <h3>Page Analyzed</h3>
          <div class="two-col" style="align-items:center;">
            <div class="screenshot-wrap"><img src="${screenshot}" alt="screenshot"></div>
            <div class="col">
              <h2>${device.charAt(0).toUpperCase() + device.slice(1)}</h2>
              <p>${escapeHtml(url)}</p>
              <p class="meta" style="margin-top:12px;">${meta.viewport?.width}x${meta.viewport?.height} viewport</p>
            </div>
          </div>
        `);
      }

      // Category breakdown
      slides += slide(`
        <h3>By Category</h3>
        <h2>Findings Breakdown</h2>
        <table class="table-wrap">
          <tr><th>Category</th><th>Count</th></tr>
          ${Object.entries(categories).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v}</td></tr>`).join('')}
        </table>
      `);

      // Top findings — one slide per 5 findings
      const highFindings = [...findings].sort((a, b) => parseFloat(iceAverage(b.ice)) - parseFloat(iceAverage(a.ice)));
      for (let i = 0; i < Math.min(highFindings.length, 15); i += 5) {
        const batch = highFindings.slice(i, i + 5);
        const slideContent = batch.map(f => {
          const avg = parseFloat(iceAverage(f.ice));
          const color = avg >= 7 ? '#ef4444' : avg >= 5 ? '#f59e0b' : '#22c55e';
          return `<div class="finding-row">
            <div class="finding-num" style="background:${color}">${f.number}</div>
            <div class="finding-content">
              <div class="finding-title">${escapeHtml(f.description)}</div>
              <div class="finding-meta">${escapeHtml(f.category)} &nbsp;·&nbsp; ICE ${avg}</div>
            </div>
          </div>`;
        }).join('');
        slides += slide(`
          <h3>Findings ${i + 1}–${Math.min(i + 5, highFindings.length)}</h3>
          <h2>Priority Issues</h2>
          ${slideContent}
        `);
      }
    }

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EchoFlow Slides</title><style>${slideStyles}</style></head><body>${slides}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank');
    showToast('Slide deck opened — use File → Print → Save as PDF');
  }

  // ── Shopify: Theme Recommendation ──

  async function renderThemeRecommendations(container) {
    let themesData;
    try {
      themesData = await fetch(chrome.runtime.getURL('knowledge-base/shopify-adapt/themes.json')).then(r => r.json());
    } catch { return; }

    const sections = (auditData.sectionMappings || []).filter(s => !s.isLayout);
    const components = auditData.componentMappings || [];

    // Required Shopify sections (sectionType is the knowledge-base key)
    const neededSections = new Set(
      sections
        .filter(s => s.shopifyMapping?.status === 'green' && s.shopifyMapping?.sectionType)
        .map(s => s.shopifyMapping.sectionType)
    );

    // Feature requirements
    const needsMegaMenu  = components.some(c => c.type === 'mega-menu');
    const needsQuickView = components.some(c => c.type === 'quick-view');
    const needsSlideshow = sections.some(s => s.shopifyMapping?.shopifySection === 'slideshow');
    const hasProductGrid = sections.some(s => s.shopifyMapping?.shopifySection === 'featured-collection');
    const hasFeaturedProduct = sections.some(s => s.shopifyMapping?.shopifySection === 'featured-product');

    const themes = Object.values(themesData.themes || {});
    const scored = themes.map(theme => {
      let score = 0;
      // Section coverage
      neededSections.forEach(sec => {
        if (theme.sections?.includes(sec)) score += 2;
      });
      // Feature bonuses
      if (needsMegaMenu && theme.features?.includes('mega-menu')) score += 4;
      if (needsQuickView && (theme.features?.includes('quick-view') || theme.features?.includes('quick-add'))) score += 3;
      if (needsSlideshow && theme.sections?.includes('slideshow')) score += 2;
      if (hasProductGrid && theme.sections?.includes('featured-collection')) score += 1;
      if (hasFeaturedProduct && theme.sections?.includes('featured-product')) score += 1;
      // Free theme bonus (lower cost)
      if (theme.free) score += 1;

      const coverage = neededSections.size > 0
        ? Math.round((Array.from(neededSections).filter(s => theme.sections?.includes(s)).length / neededSections.size) * 100)
        : 100;

      return { theme, score, coverage };
    });

    scored.sort((a, b) => b.score - a.score);
    const top3 = scored.slice(0, 3);

    if (top3.length === 0) return;

    const card = document.createElement('div');
    card.className = 'adapt-dev-card adapt-theme-reco';
    card.innerHTML = `
      <h4>Recommended Themes <span class="adapt-dev-count">${top3.length} matches</span></h4>
      <p class="adapt-dev-hint">Ranked by section coverage and feature fit for the detected page structure.</p>
      <div class="adapt-theme-list">
        ${top3.map((entry, idx) => {
          const t = entry.theme;
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
          const price = t.free ? '<span class="adapt-tag-free">Free</span>' : '<span class="adapt-tag-premium">Premium</span>';
          const missingFeatures = [];
          if (needsMegaMenu && !t.features?.includes('mega-menu')) missingFeatures.push('mega menu');
          if (needsQuickView && !t.features?.includes('quick-view') && !t.features?.includes('quick-add')) missingFeatures.push('quick view');
          return `<div class="adapt-theme-card ${idx === 0 ? 'adapt-theme-top' : ''}">
            <div class="adapt-theme-header">
              <span class="adapt-theme-medal">${medal}</span>
              <span class="adapt-theme-name">${escapeHtml(t.name)}</span>
              ${price}
              <span class="adapt-theme-version">v${escapeHtml(t.version || '—')}</span>
            </div>
            <div class="adapt-theme-coverage">
              <div class="adapt-theme-bar"><div class="adapt-theme-fill" style="width:${entry.coverage}%"></div></div>
              <span class="adapt-theme-pct">${entry.coverage}% section coverage</span>
            </div>
            ${missingFeatures.length ? `<div class="adapt-theme-missing">Missing: ${missingFeatures.map(f => '<code>' + f + '</code>').join(', ')}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    `;
    container.appendChild(card);
  }

  // ── Shopify: App Conflict Detection ──

  function renderAppConflicts(container) {
    const components = auditData.componentMappings || [];

    // Category buckets for conflict detection
    const categories = {
      reviews:    { label: 'Reviews & Ratings',      apps: [] },
      email:      { label: 'Email Marketing',         apps: [] },
      chat:       { label: 'Live Chat / Helpdesk',    apps: [] },
      loyalty:    { label: 'Loyalty & Rewards',       apps: [] },
      search:     { label: 'Search & Filters',        apps: [] },
      upsell:     { label: 'Upsell / Cross-sell',     apps: [] },
      pagebuilder:{ label: 'Page Builder',            apps: [] }
    };

    const catMap = {
      'reviews':                   'reviews',
      'back-in-stock':             'email',
      'newsletter':                'email',
      'live-chat':                 'chat',
      'loyalty-program':           'loyalty',
      'advanced-filters':          'search',
      'product-bundles':           'upsell',
      'sticky-add-to-cart':        'upsell'
    };

    components.forEach(c => {
      const cat = catMap[c.type];
      if (!cat) return;
      const apps = (c.shopifyMapping?.apps || []).map(a => typeof a === 'string' ? a : a.name).filter(Boolean);
      if (apps.length) categories[cat].apps.push(...apps);
    });

    const conflicts = Object.entries(categories).filter(([, v]) => {
      const unique = [...new Set(v.apps)];
      return unique.length >= 2;
    });

    if (conflicts.length === 0) return;

    const card = document.createElement('div');
    card.className = 'adapt-dev-card adapt-conflicts';
    card.innerHTML = `
      <h4>⚠️ Potential App Conflicts <span class="adapt-dev-count">${conflicts.length}</span></h4>
      <p class="adapt-dev-hint">Multiple recommended apps overlap in the same category. Install only one per category to avoid conflicts and bloat.</p>
      ${conflicts.map(([, v]) => `
        <div class="adapt-conflict-row">
          <div class="adapt-conflict-cat">${escapeHtml(v.label)}</div>
          <div class="adapt-conflict-apps">${[...new Set(v.apps)].map(a => '<span class="adapt-tech-tag adapt-tag-conflict">' + escapeHtml(a) + '</span>').join('')}</div>
          <div class="adapt-conflict-hint">Choose one — don't install both.</div>
        </div>
      `).join('')}
    `;
    container.appendChild(card);
  }

  // ── Shopify Adapt Rendering ──

  function renderAdaptMode() {
    // Hide normal results panel, show adapt panel
    document.querySelector('.results-panel:not(#adapt-results-panel)').style.display = 'none';
    document.getElementById('adapt-results-panel').style.display = 'flex';

    renderAdaptToolbar();
    renderScreenshot();
    renderAdaptNotEcommerce(); // Show warning if not an ecommerce site
    renderAdaptStructure();
    renderAdaptComponents();
    renderAdaptMigration();

    // Adapt tab switching
    document.querySelectorAll('.adapt-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.adapt-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('#adapt-results-panel .tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById('adapt-tab-' + btn.dataset.adaptTab).classList.add('active');
      });
    });
  }

  function renderAdaptToolbar() {
    const urlEl = document.getElementById('audit-url');
    urlEl.textContent = auditData.meta.url;
    urlEl.href = auditData.meta.url;

    const isShopify = auditData.meta.platform === 'shopify';
    document.getElementById('audit-badge').textContent = isShopify ? 'Shopify Audit' : 'Shopify Migration';
    document.getElementById('audit-badge').style.background = isShopify ? '#22c55e' : '#8b5cf6';

    const deviceBadge = document.getElementById('audit-device');
    if (deviceBadge && auditData.meta.platform) {
      deviceBadge.textContent = auditData.meta.platform.replace(/-/g, ' ');
    }

    const pageTypeBadge = document.getElementById('audit-page-type');
    if (pageTypeBadge && auditData.meta.pageType) {
      pageTypeBadge.textContent = auditData.meta.pageType;
      pageTypeBadge.style.display = 'inline-block';
    }

    const date = new Date(auditData.meta.timestamp);
    document.getElementById('audit-time').textContent = date.toLocaleString();
  }

  function renderAdaptNotEcommerce() {
    const components = auditData.componentMappings || [];
    const sections = auditData.sectionMappings || [];
    const contentSections = sections.filter(s => !s.isLayout);
    const platform = auditData.meta.platform || 'unknown';
    const pageType = auditData.meta.pageType || 'other';
    const isShopify = platform === 'shopify';

    // Determine if this looks like an ecommerce site
    const ecommercePageTypes = ['product', 'collection', 'cart', 'checkout', 'homepage'];
    const hasEcommerceComponents = components.length > 0;
    const hasEcommercePageType = ecommercePageTypes.includes(pageType);
    const isKnownPlatform = platform !== 'custom-ecommerce' && platform !== 'unknown';
    const hasEcommerceSections = contentSections.some(s =>
      ['product-grid', 'featured-product', 'newsletter', 'blog-posts'].includes(s.type)
    );

    const looksLikeEcommerce = hasEcommerceComponents || hasEcommercePageType || isKnownPlatform || hasEcommerceSections || isShopify;

    // Insert warning banner at the top of the adapt panel content area
    const panel = document.getElementById('adapt-results-panel');
    const existingWarning = document.getElementById('adapt-not-ecommerce-warning');
    if (existingWarning) existingWarning.remove();

    if (!looksLikeEcommerce) {
      const warning = document.createElement('div');
      warning.id = 'adapt-not-ecommerce-warning';
      warning.className = 'adapt-not-ecommerce';
      warning.innerHTML = `
        <div class="adapt-not-ecommerce-icon">!</div>
        <div class="adapt-not-ecommerce-text">
          <strong>This doesn't appear to be an ecommerce site</strong>
          <p>No ecommerce components, product pages, or known platform detected. The Shopify Migration analysis is designed for online stores — results on non-ecommerce pages will be limited and may not be useful.</p>
          <p class="adapt-not-ecommerce-detail">Detected: <strong>${escapeHtml(platform.replace(/-/g, ' '))}</strong> &middot; Page type: <strong>${escapeHtml(pageType)}</strong> &middot; Components found: <strong>${components.length}</strong></p>
        </div>
      `;
      // Insert before the first tab content
      const firstTab = panel.querySelector('.tab-content');
      if (firstTab) {
        firstTab.parentElement.insertBefore(warning, firstTab);
      }
    }
  }

  function renderAdaptStructure() {
    const list = document.getElementById('adapt-structure-list');
    const mappings = auditData.sectionMappings || [];
    const isShopify = auditData.meta.platform === 'shopify';
    const shopifyDetails = auditData.shopifyDetails || null;
    list.innerHTML = '';

    // Separate layout containers from content sections
    const layoutItems = mappings.filter(m => m.isLayout);
    const contentItems = mappings.filter(m => !m.isLayout);

    // Count only content sections for the tab badge
    document.getElementById('adapt-sections-count').textContent = contentItems.length;

    if (mappings.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No page sections detected</p></div>';
      return;
    }

    // ── Shopify Store Banner ──
    if (isShopify && shopifyDetails) {
      const banner = document.createElement('div');
      banner.className = 'adapt-shopify-banner';
      const themeName = shopifyDetails.theme?.name || 'Unknown theme';
      const appCount = shopifyDetails.apps?.length || 0;
      const sectionCount = shopifyDetails.sectionCount || 0;
      const isOS2 = shopifyDetails.features?.os2;
      banner.innerHTML = `
        <div class="adapt-shopify-banner-icon">&#9432;</div>
        <div class="adapt-shopify-banner-text">
          <strong>This site is already on Shopify</strong>
          <p>Theme: <strong>${escapeHtml(themeName)}</strong>${isOS2 ? ' (OS 2.0)' : ' (Legacy)'} &middot; ${sectionCount} sections on page &middot; ${appCount} apps detected</p>
        </div>
      `;
      list.appendChild(banner);
    }

    // ── Content Sections (the real analysis) ──
    if (contentItems.length > 0) {
      const contentGreen = contentItems.filter(m => m.shopifyMapping.status === 'green').length;
      const contentYellow = contentItems.filter(m => m.shopifyMapping.status === 'yellow').length;
      const contentRed = contentItems.filter(m => m.shopifyMapping.status === 'red').length;
      const allContentGreen = contentYellow === 0 && contentRed === 0;

      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'adapt-section-header';
      sectionHeader.innerHTML = `<h4>Content Sections <span class="adapt-dev-count">${contentItems.length}</span></h4>
        <div class="adapt-mini-stats">
          <span class="adapt-mini-stat adapt-status-green">${contentGreen} native</span>
          ${contentYellow ? '<span class="adapt-mini-stat adapt-status-yellow">' + contentYellow + ' app/custom</span>' : ''}
          ${contentRed ? '<span class="adapt-mini-stat adapt-status-red">' + contentRed + ' custom dev</span>' : ''}
        </div>`;
      list.appendChild(sectionHeader);

      contentItems.forEach(item => {
        const m = item.shopifyMapping;
        const statusClass = 'adapt-status-' + m.status;
        const statusLabel = m.status === 'green' ? 'Native' : m.status === 'yellow' ? 'Custom/App' : 'Custom Dev';

        const card = document.createElement('div');
        card.className = 'finding-card adapt-card';
        card.innerHTML = `
          <div class="adapt-status-dot ${statusClass}"></div>
          <div class="finding-body">
            <div class="adapt-row">
              <span class="adapt-source-type">${escapeHtml(item.type)}</span>
              <span class="adapt-arrow">&rarr;</span>
              <span class="adapt-shopify-type">${escapeHtml(m.sectionName)}</span>
            </div>
            <div class="adapt-notes">${escapeHtml(m.notes)}</div>
            <div class="finding-meta">
              <span class="adapt-badge ${statusClass}">${statusLabel}</span>
              ${item.bounds ? '<span class="adapt-size">' + item.bounds.width + 'x' + item.bounds.height + 'px</span>' : ''}
            </div>
          </div>
        `;
        list.appendChild(card);
      });
    } else {
      const noContent = document.createElement('div');
      noContent.className = 'adapt-section-header';
      noContent.innerHTML = `<h4>Content Sections</h4><p class="adapt-dev-hint">No content sections detected (hero, product grid, FAQ, etc.). The page may be too simple or use non-standard markup.</p>`;
      list.appendChild(noContent);
    }

    // ── Layout Summary (collapsed, less prominent) ──
    if (layoutItems.length > 0) {
      const layoutHeader = document.createElement('div');
      layoutHeader.className = 'adapt-section-header adapt-layout-header';
      layoutHeader.innerHTML = `<h4>Layout Structure <span class="adapt-dev-count">${layoutItems.length}</span></h4>
        <p class="adapt-dev-hint">Standard page containers — these exist on all sites and are natively handled by Shopify themes.</p>`;
      list.appendChild(layoutHeader);

      layoutItems.forEach(item => {
        const m = item.shopifyMapping;
        const card = document.createElement('div');
        card.className = 'adapt-layout-card';

        let featuresHtml = '';
        if (m.features && m.features.length > 0) {
          featuresHtml = '<div class="adapt-layout-features">' + m.features.map(f => '<span class="adapt-layout-feature">' + escapeHtml(f) + '</span>').join('') + '</div>';
        }

        card.innerHTML = `
          <div class="adapt-layout-name">${escapeHtml(item.type.replace(/-/g, ' '))}</div>
          <div class="adapt-layout-notes">${escapeHtml(m.notes)}</div>
          ${featuresHtml}
        `;
        list.appendChild(card);
      });
    }

    // ── Shopify Apps Detected (only for Shopify sites) ──
    if (isShopify && shopifyDetails?.apps?.length > 0) {
      const appsHeader = document.createElement('div');
      appsHeader.className = 'adapt-section-header';
      appsHeader.style.marginTop = '16px';
      appsHeader.innerHTML = `<h4>Installed Apps <span class="adapt-dev-count">${shopifyDetails.apps.length}</span></h4>
        <p class="adapt-dev-hint">Apps detected from script signatures on this page.</p>`;
      list.appendChild(appsHeader);

      shopifyDetails.apps.forEach(app => {
        const tag = document.createElement('span');
        tag.className = 'adapt-tech-tag adapt-tag-lib';
        tag.textContent = app.name;
        appsHeader.appendChild(tag);
      });
    }
  }

  function renderAdaptComponents() {
    const list = document.getElementById('adapt-components-list');
    const mappings = auditData.componentMappings || [];
    list.innerHTML = '';

    document.getElementById('adapt-components-count').textContent = mappings.length;

    if (mappings.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No ecommerce components detected</p></div>';
      return;
    }

    const allGreenComps = mappings.every(m => m.shopifyMapping.status === 'green');
    if (allGreenComps) {
      const banner = document.createElement('div');
      banner.className = 'adapt-all-native';
      banner.innerHTML = `
        <div class="adapt-all-native-icon">&#10003;</div>
        <div class="adapt-all-native-text">
          <strong>All components natively supported</strong>
          <p>Every detected component (${mappings.length}) has native Shopify support. No apps or custom code required.</p>
        </div>
      `;
      list.appendChild(banner);
    }

    mappings.forEach((item) => {
      const m = item.shopifyMapping;
      const statusClass = 'adapt-status-' + m.status;
      const statusLabel = m.status === 'green' ? 'Native' : m.status === 'yellow' ? 'App / Custom' : 'Custom Dev Required';

      const card = document.createElement('div');
      card.className = 'finding-card adapt-card';

      let details = '';
      if (m.apps && m.apps.length > 0) {
        details += '<div class="adapt-apps"><strong>Apps:</strong> ' + m.apps.slice(0, 3).map(a => escapeHtml(a)).join(', ') + '</div>';
      }
      if (m.solution) {
        details += '<div class="adapt-solution"><strong>Custom:</strong> ' + escapeHtml(m.solution) + '</div>';
      }
      if (m.effort) {
        details += '<div class="adapt-effort"><strong>Effort:</strong> ' + escapeHtml(m.effort) + '</div>';
      }

      card.innerHTML = `
        <div class="adapt-status-dot ${statusClass}"></div>
        <div class="finding-body">
          <div class="adapt-component-name">${escapeHtml(item.type.replace(/-/g, ' '))}</div>
          <div class="adapt-notes">${escapeHtml(m.notes)}</div>
          ${details}
          <div class="finding-meta">
            <span class="adapt-badge ${statusClass}">${statusLabel}</span>
          </div>
        </div>
      `;
      list.appendChild(card);
    });
  }

  function renderAdaptMigration() {
    const container = document.getElementById('adapt-migration-summary');
    const sections = auditData.sectionMappings || [];
    const components = auditData.componentMappings || [];
    const migration = auditData.platformMigration || {};
    const complexity = auditData.complexitySignals || {};
    const platform = auditData.meta.platform || 'unknown';
    const isShopify = platform === 'shopify';
    const shopifyDetails = auditData.shopifyDetails || null;

    // Only count content sections (not layout containers) for viability
    const contentSections = sections.filter(s => !s.isLayout);
    const greenSections = contentSections.filter(s => s.shopifyMapping.status === 'green').length;
    const yellowSections = contentSections.filter(s => s.shopifyMapping.status === 'yellow').length;
    const redSections = contentSections.filter(s => s.shopifyMapping.status === 'red').length;

    const greenComps = components.filter(c => c.shopifyMapping.status === 'green').length;
    const yellowComps = components.filter(c => c.shopifyMapping.status === 'yellow').length;
    const redComps = components.filter(c => c.shopifyMapping.status === 'red').length;

    const totalItems = contentSections.length + components.length;
    const greenTotal = greenSections + greenComps;
    const yellowTotal = yellowSections + yellowComps;
    const redTotal = redSections + redComps;

    const viabilityPct = totalItems > 0 ? Math.round((greenTotal / totalItems) * 100) : 0;
    const viabilityColor = viabilityPct >= 70 ? '#22c55e' : viabilityPct >= 40 ? '#f59e0b' : '#ef4444';

    const isWholeSite = auditData.wholeSite === true;
    const summaryTitle = isWholeSite ? `Whole-Site Analysis (${auditData.meta.pageCount || '?'} pages)` : isShopify ? 'Shopify Store Audit' : 'Shopify Viability';
    const summaryLabel = isShopify ? 'features using native Shopify' : 'native Shopify coverage';

    let html = `
      <div class="adapt-summary-card">
        <div class="adapt-summary-title">${summaryTitle}</div>
        <div class="adapt-viability" style="color:${viabilityColor}">${viabilityPct}%</div>
        <div class="adapt-viability-label">${summaryLabel}</div>
      </div>

      <div class="adapt-stats-grid">
        <div class="adapt-stat adapt-status-green"><span class="adapt-stat-value">${greenTotal}</span><span class="adapt-stat-label">Native</span></div>
        <div class="adapt-stat adapt-status-yellow"><span class="adapt-stat-value">${yellowTotal}</span><span class="adapt-stat-label">App / Custom</span></div>
        <div class="adapt-stat adapt-status-red"><span class="adapt-stat-value">${redTotal}</span><span class="adapt-stat-label">Custom Dev</span></div>
      </div>
    `;

    // Shopify store info card
    if (isShopify && shopifyDetails) {
      const themeName = shopifyDetails.theme?.name || 'Unknown';
      const isOS2 = shopifyDetails.features?.os2;
      const appCount = shopifyDetails.apps?.length || 0;
      const imgStats = shopifyDetails.imageStats || {};

      html += `<div class="adapt-dev-card">
        <h4>Store Details</h4>
        <div class="adapt-dev-row"><span class="adapt-dev-label">Theme</span><span class="adapt-dev-value">${escapeHtml(themeName)}</span></div>
        <div class="adapt-dev-row"><span class="adapt-dev-label">OS 2.0</span><span class="adapt-dev-value">${isOS2 ? 'Yes' : 'No (Legacy)'}</span></div>
        <div class="adapt-dev-row"><span class="adapt-dev-label">Sections on Page</span><span class="adapt-dev-value">${shopifyDetails.sectionCount || 0}</span></div>
        <div class="adapt-dev-row"><span class="adapt-dev-label">Apps Detected</span><span class="adapt-dev-value">${appCount}</span></div>
        <div class="adapt-dev-row"><span class="adapt-dev-label">Uses App Blocks</span><span class="adapt-dev-value">${shopifyDetails.usesAppBlocks ? 'Yes' : 'No'}</span></div>
        <div class="adapt-dev-row"><span class="adapt-dev-label">Metafields</span><span class="adapt-dev-value">${shopifyDetails.usesMetafields ? 'Detected' : 'Not detected'}</span></div>
        ${imgStats.total ? '<div class="adapt-dev-row"><span class="adapt-dev-label">Images</span><span class="adapt-dev-value">' + imgStats.total + ' total' + (imgStats.possiblyUnoptimized > 0 ? ', ' + imgStats.possiblyUnoptimized + ' possibly unoptimized' : '') + '</span></div>' : ''}
      </div>`;
    }

    // All native message
    if (yellowTotal === 0 && redTotal === 0 && totalItems > 0) {
      html += `<div class="adapt-all-native" style="margin-bottom:16px;">
        <div class="adapt-all-native-icon">&#10003;</div>
        <div class="adapt-all-native-text">
          <strong>${isShopify ? 'All detected features are native' : 'Fully compatible with Shopify'}</strong>
          <p>All ${totalItems} detected features (${contentSections.length} sections + ${components.length} components) are natively supported.${isShopify ? '' : ' No custom development required.'}</p>
        </div>
      </div>`;
    } else if (totalItems === 0) {
      html += `<div class="adapt-all-native" style="margin-bottom:16px;border-color:#f59e0b;background:linear-gradient(135deg,#fffbeb,#fef3c7);">
        <div class="adapt-all-native-icon" style="background:#f59e0b;">?</div>
        <div class="adapt-all-native-text" style="color:#92400e;">
          <strong>Limited detection</strong>
          <p>No content sections or ecommerce components were detected. The page may use non-standard markup, be a simple static page, or require JavaScript rendering to show content.</p>
        </div>
      </div>`;
    }

    // ── Platform & Tech Stack ──
    const tech = complexity.techStack || {};
    const fmtTech = (arr) => (arr || []).map(t => t.meta ? `${t.name} (${t.meta})` : t.name);

    const jsFrameworks = fmtTech(tech.jsFrameworks);
    const cssFrameworks = fmtTech(tech.cssFrameworks);
    const jsLibraries = fmtTech(tech.jsLibraries);
    const buildTools = fmtTech(tech.buildTools);
    const analyticsTools = fmtTech(tech.analytics);
    const tagManagers = fmtTech(tech.tagManagers);
    const payments = fmtTech(tech.payments);
    const cmsTools = fmtTech(tech.cms);
    const cdns = fmtTech(tech.cdns);

    // Fallback to legacy flags if techStack not available
    if (jsFrameworks.length === 0) {
      if (complexity.hasReact) jsFrameworks.push('React');
      if (complexity.hasVue) jsFrameworks.push('Vue.js');
      if (complexity.hasAngular) jsFrameworks.push('Angular');
      if (complexity.hasSvelte) jsFrameworks.push('Svelte');
    }

    html += `<div class="adapt-dev-card">
      <h4>Tech Stack</h4>
      <div class="adapt-dev-row"><span class="adapt-dev-label">Source Platform</span><span class="adapt-dev-value">${escapeHtml(migration.name || platform.replace(/-/g, ' '))}</span></div>
      ${jsFrameworks.length ? '<div class="adapt-dev-row"><span class="adapt-dev-label">JS Framework</span><span class="adapt-dev-value">' + jsFrameworks.map(f => escapeHtml(f)).join(', ') + '</span></div>' : ''}
      ${cssFrameworks.length ? '<div class="adapt-dev-row"><span class="adapt-dev-label">CSS Framework</span><span class="adapt-dev-value">' + cssFrameworks.map(f => escapeHtml(f)).join(', ') + '</span></div>' : ''}
      ${buildTools.length ? '<div class="adapt-dev-row"><span class="adapt-dev-label">Build Tool</span><span class="adapt-dev-value">' + buildTools.map(f => escapeHtml(f)).join(', ') + '</span></div>' : ''}
      <div class="adapt-dev-row"><span class="adapt-dev-label">Total Scripts</span><span class="adapt-dev-value">${complexity.scriptCount || 0} (${complexity.inlineScriptCount || 0} inline)</span></div>
      <div class="adapt-dev-row"><span class="adapt-dev-label">CSS Animations</span><span class="adapt-dev-value">${complexity.cssAnimations || 0}</span></div>
      <div class="adapt-dev-row"><span class="adapt-dev-label">Inline Styles</span><span class="adapt-dev-value">${(parseFloat(complexity.inlineStyleRatio || 0) * 100).toFixed(0)}% of elements (${complexity.inlineStyleCount || 0} total)</span></div>
      <div class="adapt-dev-row"><span class="adapt-dev-label">Canvas Elements</span><span class="adapt-dev-value">${complexity.canvasElements || 0}${complexity.hasWebGL ? ' (WebGL detected)' : ''}</span></div>
      <div class="adapt-dev-row"><span class="adapt-dev-label">Iframes</span><span class="adapt-dev-value">${complexity.iframeCount || 0}</span></div>
    </div>`;

    // ── JS Libraries ──
    if (jsLibraries.length > 0) {
      html += `<div class="adapt-dev-card">
        <h4>JS Libraries <span class="adapt-dev-count">${jsLibraries.length}</span></h4>
        <p class="adapt-dev-hint">Libraries detected on the page. Check which need Shopify equivalents or can be dropped.</p>
        <div class="adapt-tag-list">${jsLibraries.map(lib => '<span class="adapt-tech-tag adapt-tag-lib">' + escapeHtml(lib) + '</span>').join('')}</div>
      </div>`;
    }

    // ── Analytics & Tracking ──
    const allTracking = [...analyticsTools, ...tagManagers];
    if (allTracking.length > 0) {
      html += `<div class="adapt-dev-card">
        <h4>Analytics & Tracking <span class="adapt-dev-count">${allTracking.length}</span></h4>
        <p class="adapt-dev-hint">Verify each tracking service is compatible with Shopify. Most work via GTM or Shopify pixels.</p>
        <div class="adapt-tag-list">${allTracking.map(t => '<span class="adapt-tech-tag adapt-tag-analytics">' + escapeHtml(t) + '</span>').join('')}</div>
      </div>`;
    }

    // ── Payment Providers ──
    if (payments.length > 0) {
      html += `<div class="adapt-dev-card">
        <h4>Payment Providers <span class="adapt-dev-count">${payments.length}</span></h4>
        <p class="adapt-dev-hint">Shopify Payments supports most providers. BNPL (Klarna, Afterpay) available as additional payment methods.</p>
        <div class="adapt-tag-list">${payments.map(p => '<span class="adapt-tech-tag adapt-tag-payment">' + escapeHtml(p) + '</span>').join('')}</div>
      </div>`;
    }

    // ── Headless CMS ──
    if (cmsTools.length > 0) {
      html += `<div class="adapt-dev-card">
        <h4>Headless CMS <span class="adapt-dev-count">${cmsTools.length}</span></h4>
        <p class="adapt-dev-hint">Headless CMS integrations may require Hydrogen (Shopify's headless framework) or custom storefront API setup.</p>
        <div class="adapt-tag-list">${cmsTools.map(c => '<span class="adapt-tech-tag adapt-tag-cms">' + escapeHtml(c) + '</span>').join('')}</div>
      </div>`;
    }

    // ── CDNs ──
    if (cdns.length > 0) {
      html += `<div class="adapt-dev-card">
        <h4>CDNs <span class="adapt-dev-count">${cdns.length}</span></h4>
        <p class="adapt-dev-hint">Shopify uses its own CDN globally. External CDNs for third-party assets may still be needed.</p>
        <div class="adapt-tag-list">${cdns.map(c => '<span class="adapt-tech-tag adapt-tag-cdn">' + escapeHtml(c) + '</span>').join('')}</div>
      </div>`;
    }

    // ── Third-Party Scripts (named + categorized) ──
    const scripts = complexity.thirdPartyScripts || [];
    const categories = complexity.thirdPartyCategories || {};
    if (scripts.length > 0) {
      const catLabels = { analytics: 'Analytics', social: 'Social', payment: 'Payment', monitoring: 'Monitoring', marketing: 'Marketing', cdn: 'CDN', platform: 'Platform', other: 'Other' };
      const catColors = { analytics: '#6366f1', social: '#ec4899', payment: '#22c55e', monitoring: '#f59e0b', marketing: '#3b82f6', cdn: '#94a3b8', platform: '#8b5cf6', other: '#9ca3af' };
      html += `<div class="adapt-dev-card">
        <h4>Third-Party Scripts <span class="adapt-dev-count">${scripts.length}</span></h4>
        <p class="adapt-dev-hint">Review each service — check if a Shopify app or native alternative exists.</p>
        <div class="adapt-script-list">`;
      scripts.forEach(domain => {
        const cat = categories[domain] || 'other';
        const label = catLabels[cat] || 'Other';
        const color = catColors[cat] || '#9ca3af';
        html += `<div class="adapt-script-item"><code>${escapeHtml(domain)}</code><span class="adapt-script-cat" style="background:${color}">${label}</span></div>`;
      });
      html += `</div></div>`;
    }

    // ── Iframe Sources ──
    const iframes = complexity.iframeSources || [];
    if (iframes.length > 0) {
      html += `<div class="adapt-dev-card">
        <h4>Embedded Iframes <span class="adapt-dev-count">${iframes.length}</span></h4>
        <p class="adapt-dev-hint">Iframes may need Shopify app blocks or custom Liquid sections.</p>
        <div class="adapt-script-list">`;
      iframes.forEach(src => {
        html += `<div class="adapt-script-item"><code>${escapeHtml(src)}</code></div>`;
      });
      html += `</div></div>`;
    }

    // ── Custom Dev Scope (yellow + red items as dev tickets) ──
    const customWork = [...sections, ...components]
      .filter(item => (item.shopifyMapping?.status === 'yellow' || item.shopifyMapping?.status === 'red'))
      .sort((a, b) => (a.shopifyMapping.status === 'red' ? 0 : 1) - (b.shopifyMapping.status === 'red' ? 0 : 1));

    if (customWork.length > 0) {
      html += `<div class="adapt-dev-card">
        <h4>Development Scope <span class="adapt-dev-count">${customWork.length} items</span></h4>
        <p class="adapt-dev-hint">Features that need apps or custom Liquid/JS development.</p>`;
      customWork.forEach(item => {
        const m = item.shopifyMapping;
        const statusClass = 'adapt-status-' + m.status;
        const name = item.type.replace(/-/g, ' ');
        const effort = m.effort ? `<span class="adapt-ticket-effort">${escapeHtml(m.effort)}</span>` : '';
        const appsList = (m.apps && m.apps.length) ? `<div class="adapt-ticket-apps">Apps: ${m.apps.slice(0, 3).map(a => '<code>' + escapeHtml(a) + '</code>').join(', ')}</div>` : '';
        const solution = m.solution ? `<div class="adapt-ticket-solution">${escapeHtml(m.solution)}</div>` : '';

        html += `<div class="adapt-ticket ${statusClass}">
          <div class="adapt-ticket-header">
            <span class="adapt-ticket-name">${escapeHtml(name)}</span>
            ${effort}
          </div>
          <div class="adapt-ticket-notes">${escapeHtml(m.notes)}</div>
          ${solution}
          ${appsList}
        </div>`;
      });
      html += `</div>`;
    } else if (totalItems > 0) {
      html += `<div class="adapt-dev-card">
        <h4>Development Scope</h4>
        <p class="adapt-dev-hint" style="color:#22c55e;font-weight:600;">No custom development needed. All features are native to Shopify.</p>
      </div>`;
    }

    // ── Knowledge Base Reference ──
    const kbRef = auditData.platformConstraints?._lastUpdated || null;
    const kbSource = auditData.platformConstraints?._shopifyReference || null;
    if (kbRef) {
      html += `<div class="adapt-kb-ref">
        <span>Knowledge base last updated: <strong>${escapeHtml(kbRef)}</strong></span>
        ${kbSource ? '<span> &middot; ' + escapeHtml(kbSource) + '</span>' : ''}
      </div>`;
    }

    container.innerHTML = html;

    // App conflict detector
    renderAppConflicts(container);
  }

  // ── Project Sidebar ──

  async function loadProjectSidebar(projectId) {
    const sidebar = document.getElementById('project-sidebar');
    if (!projectId || !sidebar) return;

    try {
      const result = await chrome.runtime.sendMessage({ action: 'GET_PROJECT_AUDITS', projectId });
      if (!result?.success) return;

      sidebar.style.display = 'flex';
      document.querySelector('.main').classList.add('has-sidebar');
      document.getElementById('sidebar-project-name').textContent = result.project.name;

      const listEl = document.getElementById('sidebar-audit-list');
      listEl.innerHTML = '';

      const audits = result.audits || [];
      audits.forEach(audit => {
        const item = document.createElement('div');
        item.className = 'sidebar-item';
        item.dataset.auditId = audit.id;

        const urlShort = audit.url.replace(/^https?:\/\/(www\.)?/, '').substring(0, 35);
        const pageType = audit.pageType ? `<span class="sidebar-page-type">${audit.pageType}</span>` : '';

        item.innerHTML = `
          <div class="sidebar-url">${escapeHtml(urlShort)}</div>
          <div class="sidebar-meta">${pageType}<span class="sidebar-vertical">${audit.vertical}</span></div>
        `;

        item.addEventListener('click', () => switchToAudit(audit, listEl));
        listEl.appendChild(item);
      });

      // Collapse button
      document.getElementById('btn-collapse-sidebar').addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
      });

      // Cross-page summary
      document.getElementById('sidebar-summary-btn').addEventListener('click', () => {
        renderCrossPageSummary(audits);
      });

    } catch (_) {}
  }

  function switchToAudit(audit, listEl) {
    // Highlight active
    listEl.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    const activeItem = listEl.querySelector(`[data-audit-id="${audit.id}"]`);
    if (activeItem) activeItem.classList.add('active');

    // Load audit data
    if (audit.results) {
      auditData = audit.results;
      findings = auditData.findings || [];
      renderAll();
    }
  }

  function renderCrossPageSummary(audits) {
    const list = document.getElementById('findings-list');
    list.innerHTML = '';

    const totalFindings = audits.reduce((sum, a) => sum + (a.results?.findings?.length || 0), 0);
    const avgFindings = audits.length > 0 ? (totalFindings / audits.length).toFixed(0) : 0;

    // Find repeated rules across pages
    const ruleCounts = {};
    audits.forEach(a => {
      const seen = new Set();
      (a.results?.findings || []).forEach(f => {
        const key = f.description.substring(0, 60);
        if (!seen.has(key)) {
          ruleCounts[key] = (ruleCounts[key] || 0) + 1;
          seen.add(key);
        }
      });
    });

    const repeated = Object.entries(ruleCounts)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1]);

    let html = `
      <div class="score-summary">
        <div class="score-summary-title">Cross-Page Summary</div>
        <div class="score-cards">
          <div class="score-card">
            <div class="score-value" style="color:#00C9A7">${audits.length}</div>
            <div class="score-label">Pages Audited</div>
          </div>
          <div class="score-card">
            <div class="score-value" style="color:#f59e0b">${totalFindings}</div>
            <div class="score-label">Total Findings</div>
          </div>
          <div class="score-card">
            <div class="score-value" style="color:#8b5cf6">${avgFindings}</div>
            <div class="score-label">Avg per Page</div>
          </div>
        </div>
      </div>
    `;

    if (repeated.length > 0) {
      html += '<h4 style="margin:20px 0 12px;color:#1a1a2e;">Repeated Issues (appear on 2+ pages)</h4>';
      repeated.slice(0, 15).forEach(([desc, count]) => {
        html += `<div class="finding-card" style="padding:12px;">
          <div class="finding-body">
            <div class="finding-description">${escapeHtml(desc)}...</div>
            <div class="finding-meta"><span class="ice-badge high">${count} pages</span></div>
          </div>
        </div>`;
      });
    }

    list.innerHTML = html;
  }

  // ── Journey Mode Rendering ──

  function renderJourneyMode() {
    // Replace the entire page content with a journey-specific layout
    document.body.innerHTML = `
      <header class="toolbar">
        <div class="toolbar-left">
          <div class="toolbar-logo">
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
              <rect width="22" height="22" rx="6" fill="#00C9A7"/>
              <path d="M3 11 C5.5 6 8.5 6 11 11 C13.5 16 16.5 16 19 11" stroke="white" stroke-width="2.2" stroke-linecap="round" fill="none"/>
              <path d="M3 14 C5.5 9 8.5 9 11 14 C13.5 19 16.5 19 19 14" stroke="white" stroke-width="1.2" stroke-linecap="round" fill="none" opacity="0.4"/>
            </svg>
            <span class="toolbar-brand">EchoFlow</span>
          </div>
          <span class="toolbar-sep">|</span>
          <span class="badge badge-journey">Journey Audit</span>
          <span class="toolbar-time">${new Date(auditData.meta.timestamp).toLocaleString()}</span>
        </div>
        <div class="toolbar-right">
          <button id="journey-btn-copy" class="toolbar-btn">Copy Report</button>
        </div>
      </header>
      <div class="journey-results-layout">
        <div class="journey-sidebar">
          <div class="journey-sidebar-header">
            <div class="journey-flow-score-wrap">
              <div class="journey-flow-score" id="journey-flow-score">—</div>
              <div class="journey-flow-label">Flow Score</div>
            </div>
            <p class="journey-sidebar-summary" id="journey-sidebar-summary"></p>
          </div>
          <div class="journey-steps-timeline" id="journey-steps-timeline"></div>
        </div>
        <div class="journey-main">
          <div class="journey-findings-grid" id="journey-findings-grid">
            <div class="journey-section" id="journey-friction-section"></div>
            <div class="journey-section" id="journey-consistency-section"></div>
            <div class="journey-section" id="journey-positives-section"></div>
            <div class="journey-section" id="journey-recommendations-section"></div>
          </div>
        </div>
      </div>
      <div id="toast" class="toast"></div>
    `;

    const steps = auditData.steps || [];
    const analysis = auditData.analysis || {};

    // Flow score
    const scoreEl = document.getElementById('journey-flow-score');
    if (scoreEl && analysis.flowScore != null) {
      scoreEl.textContent = analysis.flowScore;
      const score = analysis.flowScore;
      scoreEl.className = 'journey-flow-score ' + (score >= 70 ? 'score-good' : score >= 45 ? 'score-mid' : 'score-bad');
    }

    // Summary
    const summaryEl = document.getElementById('journey-sidebar-summary');
    if (summaryEl) summaryEl.textContent = analysis.summary || '';

    // Steps timeline
    const timelineEl = document.getElementById('journey-steps-timeline');
    if (timelineEl) {
      timelineEl.innerHTML = steps.map((s, i) => {
        const frictions = (analysis.frictionPoints || []).filter(f => f.step === s.stepNumber);
        const hasFriction = frictions.length > 0;
        const h1 = s.headings?.find(h => h.level === 'H1');
        const label = h1?.text || s.title || s.url;
        const host = (() => { try { return new URL(s.url).pathname; } catch { return s.url; } })();
        return `
          <div class="journey-step-timeline-item ${hasFriction ? 'has-friction' : ''}">
            <div class="journey-step-connector ${i === 0 ? 'first' : ''}"></div>
            <div class="journey-step-dot ${hasFriction ? 'dot-friction' : 'dot-ok'}">
              ${hasFriction ? '⚠' : i + 1}
            </div>
            <div class="journey-step-meta">
              <div class="journey-step-meta-title" title="${escapeHtml(label)}">${escapeHtml(label.slice(0, 48))}${label.length > 48 ? '…' : ''}</div>
              <div class="journey-step-meta-url" title="${escapeHtml(s.url)}">${escapeHtml(host)}</div>
              ${s.forms?.length ? `<div class="journey-step-meta-tag">📝 ${s.forms.length} form${s.forms.length > 1 ? 's' : ''}</div>` : ''}
              ${s.ctaCount ? `<div class="journey-step-meta-tag">🎯 ${s.ctaCount} CTAs</div>` : ''}
            </div>
          </div>`;
      }).join('');
    }

    // Friction points
    const frictionEl = document.getElementById('journey-friction-section');
    if (frictionEl) {
      const frictions = analysis.frictionPoints || [];
      frictionEl.innerHTML = `
        <h2 class="journey-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e53935" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Friction Points <span class="journey-count-badge">${frictions.length}</span>
        </h2>
        ${frictions.length === 0
          ? '<p class="journey-empty">No major friction points detected.</p>'
          : frictions.map(f => `
            <div class="journey-finding-card severity-${f.severity || 'medium'}">
              <div class="journey-finding-header">
                <span class="journey-sev-badge sev-${f.severity || 'medium'}">${(f.severity || 'medium').toUpperCase()}</span>
                <span class="journey-step-ref">Step ${f.step}</span>
                <strong class="journey-finding-title">${escapeHtml(f.title)}</strong>
              </div>
              <p class="journey-finding-desc">${escapeHtml(f.description)}</p>
            </div>`).join('')}`;
    }

    // Consistency issues
    const consistencyEl = document.getElementById('journey-consistency-section');
    if (consistencyEl) {
      const issues = analysis.consistencyIssues || [];
      consistencyEl.innerHTML = `
        <h2 class="journey-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          Consistency Issues <span class="journey-count-badge">${issues.length}</span>
        </h2>
        ${issues.length === 0
          ? '<p class="journey-empty">No major consistency issues detected.</p>'
          : issues.map(c => `
            <div class="journey-finding-card severity-medium">
              <div class="journey-finding-header">
                <span class="journey-sev-badge sev-medium">CONSISTENCY</span>
                <span class="journey-step-ref">Steps ${(c.steps || []).join(', ')}</span>
                <strong class="journey-finding-title">${escapeHtml(c.title)}</strong>
              </div>
              <p class="journey-finding-desc">${escapeHtml(c.description)}</p>
            </div>`).join('')}`;
    }

    // Positives
    const positivesEl = document.getElementById('journey-positives-section');
    if (positivesEl) {
      const positives = analysis.positives || [];
      positivesEl.innerHTML = `
        <h2 class="journey-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00C9A7" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          What's Working <span class="journey-count-badge positive">${positives.length}</span>
        </h2>
        ${positives.length === 0
          ? '<p class="journey-empty">No positives captured.</p>'
          : positives.map(p => `<div class="journey-positive-item">✓ ${escapeHtml(p)}</div>`).join('')}`;
    }

    // Recommendations
    const recsEl = document.getElementById('journey-recommendations-section');
    if (recsEl) {
      const recs = analysis.recommendations || [];
      recsEl.innerHTML = `
        <h2 class="journey-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3949ab" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          Recommendations <span class="journey-count-badge">${recs.length}</span>
        </h2>
        ${recs.length === 0
          ? '<p class="journey-empty">No recommendations generated.</p>'
          : recs.map(r => `
            <div class="journey-rec-card priority-${r.priority || 'medium'}">
              <div class="journey-finding-header">
                <span class="journey-sev-badge sev-${r.priority === 'high' ? 'high' : r.priority === 'medium' ? 'medium' : 'low'}">${(r.priority || 'medium').toUpperCase()}</span>
                <strong class="journey-finding-title">${escapeHtml(r.title)}</strong>
              </div>
              <p class="journey-finding-desc">${escapeHtml(r.description)}</p>
            </div>`).join('')}`;
    }

    // Copy report button
    document.getElementById('journey-btn-copy')?.addEventListener('click', () => {
      const lines = [
        `EchoFlow Journey Audit`,
        `${new Date(auditData.meta.timestamp).toLocaleString()}`,
        `Flow Score: ${analysis.flowScore || '—'}/100`,
        ``,
        analysis.summary || '',
        ``,
        `STEPS (${steps.length})`,
        ...steps.map(s => `  ${s.stepNumber}. ${s.url}`),
        ``,
        `FRICTION POINTS`,
        ...(analysis.frictionPoints || []).map(f => `  [${f.severity?.toUpperCase()}] Step ${f.step}: ${f.title} — ${f.description}`),
        ``,
        `CONSISTENCY ISSUES`,
        ...(analysis.consistencyIssues || []).map(c => `  Steps ${(c.steps || []).join(',')}: ${c.title} — ${c.description}`),
        ``,
        `RECOMMENDATIONS`,
        ...(analysis.recommendations || []).map(r => `  [${r.priority?.toUpperCase()}] ${r.title}: ${r.description}`)
      ];
      navigator.clipboard.writeText(lines.join('\n')).then(() => {
        const toast = document.getElementById('toast');
        if (toast) { toast.textContent = 'Report copied!'; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2000); }
      });
    });
  }

  // ── Compare Mode Rendering ──

  function renderCompareMode() {
    // Show normal results panel (screenshot left + tabs right)
    renderToolbar();
    renderScreenshot();

    // Update toolbar device badge
    const deviceBadge = document.getElementById('audit-device');
    if (deviceBadge) deviceBadge.textContent = '⚖️ compare';

    // Show compare tab button and activate it
    const compareTabBtn = document.getElementById('tab-compare-btn');
    if (compareTabBtn) compareTabBtn.style.display = 'inline-block';
    switchTab('compare');

    // Update findings count badge on tab
    const desktopFindings = auditData.desktop?.findings || [];
    const mobileFindings = auditData.mobile?.findings || [];
    const totalUniq = new Set([...desktopFindings.map(f => f.ruleId), ...mobileFindings.map(f => f.ruleId)]).size;
    const countEl = document.getElementById('compare-count');
    if (countEl) countEl.textContent = totalUniq;

    const container = document.getElementById('compare-container');
    if (!container) return;

    const mobileAvailable = !!auditData.mobile;
    const dIds = new Set(desktopFindings.map(f => f.ruleId));
    const mIds = new Set(mobileFindings.map(f => f.ruleId));
    const mobileOnly = mobileFindings.filter(f => !dIds.has(f.ruleId));
    const desktopOnly = desktopFindings.filter(f => !mIds.has(f.ruleId));
    const shared = desktopFindings.filter(f => mIds.has(f.ruleId));

    function findingCard(f) {
      const avg = ((f.ice.impact + f.ice.confidence + f.ice.ease) / 3).toFixed(1);
      const level = avg >= 7 ? 'high' : avg >= 4 ? 'medium' : 'low';
      return `<div class="compare-finding-card">
        <div class="compare-finding-header">
          <span class="compare-finding-cat">${f.category}</span>
          <span class="ice-badge ice-${level}">ICE ${avg}</span>
        </div>
        <p class="compare-finding-text">${f.finding}</p>
        <p class="compare-finding-rec">${f.recommendation}</p>
      </div>`;
    }

    let html = `
      <div class="compare-stats">
        <div class="compare-stat-col">
          <span class="compare-stat-device">🖥 Desktop</span>
          <span class="compare-stat-num">${desktopFindings.length}</span>
          <span class="compare-stat-label">findings</span>
        </div>
        <div class="compare-stat-vs">vs</div>
        <div class="compare-stat-col">
          <span class="compare-stat-device">📱 Mobile</span>
          <span class="compare-stat-num">${mobileAvailable ? mobileFindings.length : '—'}</span>
          <span class="compare-stat-label">${mobileAvailable ? 'findings' : 'emulation failed'}</span>
        </div>
      </div>`;

    if (!mobileAvailable) {
      html += `<div class="compare-error">Mobile emulation did not complete. Try again or check if the page blocks DevTools.</div>`;
    }

    if (mobileOnly.length > 0) {
      html += `<div class="compare-section">
        <h3 class="compare-section-title mobile-only-title">📱 Mobile-Only Issues <span class="compare-section-count">${mobileOnly.length}</span></h3>
        <p class="compare-section-hint">These issues only appear on mobile — prioritize for your responsive design.</p>
        ${mobileOnly.map(findingCard).join('')}
      </div>`;
    }

    if (shared.length > 0) {
      html += `<div class="compare-section">
        <h3 class="compare-section-title shared-title">⚠️ Issues on Both Devices <span class="compare-section-count">${shared.length}</span></h3>
        <p class="compare-section-hint">Cross-cutting problems — fix these first for maximum impact.</p>
        ${shared.map(findingCard).join('')}
      </div>`;
    }

    if (desktopOnly.length > 0) {
      html += `<div class="compare-section">
        <h3 class="compare-section-title desktop-only-title">🖥 Desktop-Only Issues <span class="compare-section-count">${desktopOnly.length}</span></h3>
        ${desktopOnly.map(findingCard).join('')}
      </div>`;
    }

    container.innerHTML = html;
  }

  // ── Render All ──

  function renderAll() {
    renderToolbar();
    renderScreenshot();
    renderFindings();
    renderDesignTab();
  }

  // ── Initialize ──

  document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    const projectId = urlParams.get('projectId');

    // Load data
    const stored = await chrome.storage.local.get('echoflowResults');
    auditData = stored.echoflowResults;

    if (!auditData) {
      document.getElementById('findings-list').innerHTML =
        '<div class="empty-state"><p>No audit data found.<br>Run an audit or import an .echoflow file.</p></div>';
      return;
    }

    // Route to correct render mode
    if (mode === 'journey' || auditData.mode === 'journey') {
      renderJourneyMode();
      return; // Journey mode has its own complete layout
    } else if (mode === 'shopify-adapt' || auditData.mode === 'shopify-adapt') {
      renderAdaptMode();
    } else if (auditData.compareMode) {
      findings = auditData.findings || [];
      renderCompareMode();
    } else {
      findings = auditData.findings || [];
      renderAll();
    }

    // Load project sidebar if project context
    if (projectId) {
      loadProjectSidebar(projectId);
    }

    // Resize observer — re-render markers when panel resizes.
    // rAF defers the work until after the browser finishes layout,
    // preventing the "ResizeObserver loop" warning.
    const resizeTarget = document.getElementById('screenshot-panel');
    if (resizeTarget) {
      let rafId;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => renderMarkers());
      });
      observer.observe(resizeTarget);
    }

    // ── Tabs ──
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // ── Toolbar Buttons ──
    document.getElementById('btn-save').addEventListener('click', saveAudit);
    document.getElementById('btn-copy-all').addEventListener('click', copyAllFindings);
    document.getElementById('btn-settings').addEventListener('click', openSettings);

    // Export dropdown
    const exportBtn = document.getElementById('btn-export');
    const exportMenu = document.getElementById('export-menu');
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle('open');
    });
    document.addEventListener('click', () => exportMenu.classList.remove('open'));
    exportMenu.addEventListener('click', (e) => e.stopPropagation());

    document.getElementById('btn-export-figma').addEventListener('click', () => { exportMenu.classList.remove('open'); exportToFigma(); });
    document.getElementById('btn-export-pdf').addEventListener('click', () => { exportMenu.classList.remove('open'); exportPDF(); });
    document.getElementById('btn-export-notion').addEventListener('click', () => { exportMenu.classList.remove('open'); exportToNotion(); });
    document.getElementById('btn-export-slides').addEventListener('click', () => { exportMenu.classList.remove('open'); exportAsSlides(); });
    const btnExportClaude = document.getElementById('btn-export-claude');
    if (btnExportClaude) {
      btnExportClaude.addEventListener('click', () => { exportMenu.classList.remove('open'); exportJSONForClaude(); });
    }

    const importInput = document.getElementById('import-input');
    document.getElementById('btn-import').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (e) => {
      if (e.target.files[0]) importAudit(e.target.files[0]);
      importInput.value = '';
    });

    // ── Sort ──
    document.getElementById('sort-select').addEventListener('change', (e) => {
      sortFindings(e.target.value);
    });

    // ── AI Button ──
    document.getElementById('btn-run-ai').addEventListener('click', runAIAnalysis);

    // ── Specialist Analysis Buttons ──
    document.getElementById('btn-dark-patterns').addEventListener('click', runDarkPatternsAnalysis);
    document.getElementById('btn-copy-intel').addEventListener('click', runCopyIntelligence);

    // ── Settings Modal ──
    document.getElementById('provider-select').addEventListener('change', (e) => {
      toggleKeyFields(e.target.value);
    });
    document.getElementById('pres-frame-size').addEventListener('change', (e) => {
      toggleCustomSize(e.target.value);
    });
    // Sync color picker ↔ hex input
    document.getElementById('pres-bg-color').addEventListener('input', (e) => {
      document.getElementById('pres-bg-hex').value = e.target.value;
    });
    document.getElementById('pres-bg-hex').addEventListener('input', (e) => {
      const hex = e.target.value;
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        document.getElementById('pres-bg-color').value = hex;
      }
    });
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-cancel-settings').addEventListener('click', closeSettings);
    document.querySelector('.modal-backdrop')?.addEventListener('click', closeSettings);
  });
})();
