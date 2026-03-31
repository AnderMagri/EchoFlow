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

  // ── Render Screenshot + Markers ──

  function renderScreenshot() {
    const img = document.getElementById('screenshot-img');
    if (!auditData.screenshot) {
      img.alt = 'No screenshot captured';
      return;
    }
    img.src = auditData.screenshot;
    img.onload = () => renderMarkers();
  }

  function renderMarkers() {
    const container = document.getElementById('markers-layer');
    const img = document.getElementById('screenshot-img');
    container.innerHTML = '';

    if (!img.naturalWidth) return;

    const isFullPage = auditData.meta.captureMode === 'full_page';
    const sourceWidth = auditData.meta.viewport?.width || img.naturalWidth;
    const sourceHeight = isFullPage
      ? (auditData.meta.scrollHeight || img.naturalHeight)
      : (auditData.meta.viewport?.height || img.naturalHeight);
    const scaleX = img.clientWidth / sourceWidth;
    const scaleY = img.clientHeight / sourceHeight;

    findings.forEach((finding) => {
      const pos = finding.position || { x: 0, y: 0 };
      const hasRealPosition = (pos.x !== 0 || pos.y !== 0) || (pos.width > 100 || pos.height > 30);

      // Only show markers for findings that point to a real element on the page
      if (!hasRealPosition) return;

      const marker = document.createElement('div');
      marker.className = 'marker';
      marker.dataset.number = finding.number;
      marker.textContent = finding.number;
      marker.style.backgroundColor = getMarkerColor(finding.number - 1);

      const px = isFullPage ? (pos.absoluteX ?? pos.x) : pos.x;
      const py = isFullPage ? (pos.absoluteY ?? pos.y) : pos.y;
      const cx = (px + (pos.width || 0) / 2) * scaleX;
      const cy = (py + (pos.height || 0) / 2) * scaleY;

      marker.style.left = Math.max(13, Math.min(cx, img.clientWidth - 13)) + 'px';
      marker.style.top = Math.max(13, Math.min(cy, img.clientHeight - 13)) + 'px';

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

  // ── Design Tab ──

  function renderDesignTab() {
    const inv = auditData?.designInventory;
    const container = document.getElementById('design-inventory');
    const findingsList = document.getElementById('design-findings');
    if (!container || !findingsList) return;

    const designFindings = findings.filter(f => f.category === 'design');
    document.getElementById('design-count').textContent = designFindings.length;

    if (!inv) {
      container.innerHTML = '<div class="empty-state"><p>No design data captured</p></div>';
      return;
    }

    let html = '';

    // Color palette
    if (inv.colorPalette && inv.colorPalette.length > 0) {
      html += '<div class="design-section"><h4 class="design-section-title">Color Palette <span class="design-count">' + inv.colorPalette.length + ' colors</span></h4><div class="design-swatches">';
      for (const c of inv.colorPalette.slice(0, 20)) {
        const isLight = isLightColor(c.value);
        html += '<div class="design-swatch" title="' + c.value + ' (' + c.count + ' uses)">' +
          '<div class="swatch-color" style="background:' + c.value + ';' + (isLight ? 'border:1px solid #ddd;' : '') + '"></div>' +
          '<span class="swatch-label">' + c.value + '</span>' +
          '<span class="swatch-count">' + c.count + '</span></div>';
      }
      html += '</div></div>';
    }

    // Typography
    if (inv.fontFamilies && inv.fontFamilies.length > 0) {
      html += '<div class="design-section"><h4 class="design-section-title">Typography <span class="design-count">' + inv.fontFamilies.length + ' families</span></h4><div class="design-type-list">';
      for (const f of inv.fontFamilies.slice(0, 8)) {
        html += '<div class="design-type-row"><span class="type-family" style="font-family:' + f.value + '">' + escapeHtml(f.value) + '</span><span class="type-count">' + f.count + ' uses</span></div>';
      }
      html += '</div>';
      // Font sizes
      if (inv.fontSizes && inv.fontSizes.length > 0) {
        html += '<div class="design-sizes">';
        for (const s of inv.fontSizes.sort((a, b) => parseFloat(a.value) - parseFloat(b.value))) {
          const px = parseFloat(s.value);
          html += '<span class="design-size-chip" style="font-size:' + Math.min(px, 24) + 'px">' + px + 'px</span>';
        }
        html += '</div>';
      }
      html += '</div>';
    }

    // Spacing
    if (inv.spacingValues && inv.spacingValues.length > 0) {
      html += '<div class="design-section"><h4 class="design-section-title">Spacing <span class="design-count">' + inv.spacingGridRatio + '% on 4px grid</span></h4><div class="design-spacing-scale">';
      const sortedSpacing = [...inv.spacingValues].sort((a, b) => parseFloat(a.value) - parseFloat(b.value)).slice(0, 20);
      for (const s of sortedSpacing) {
        const px = parseFloat(s.value);
        const onGrid = px % 4 === 0;
        html += '<span class="spacing-chip' + (onGrid ? ' on-grid' : ' off-grid') + '" title="' + s.count + ' uses">' + px + '</span>';
      }
      html += '</div></div>';
    }

    // Border radius
    if (inv.borderRadii && inv.borderRadii.length > 0) {
      html += '<div class="design-section"><h4 class="design-section-title">Border Radius <span class="design-count">' + inv.borderRadii.length + ' values</span></h4><div class="design-radii">';
      for (const r of inv.borderRadii.slice(0, 10)) {
        html += '<div class="radius-chip"><div class="radius-preview" style="border-radius:' + r.value + '"></div><span>' + r.value + '</span></div>';
      }
      html += '</div></div>';
    }

    // Shadows
    if (inv.shadows && inv.shadows.length > 0) {
      html += '<div class="design-section"><h4 class="design-section-title">Shadows <span class="design-count">' + inv.shadows.length + ' styles</span></h4><div class="design-shadows">';
      for (const s of inv.shadows.slice(0, 6)) {
        html += '<div class="shadow-chip"><div class="shadow-preview" style="box-shadow:' + s.value + '"></div><span class="swatch-count">' + s.count + '</span></div>';
      }
      html += '</div></div>';
    }

    container.innerHTML = html;

    // Render design findings below the inventory
    findingsList.innerHTML = '';
    if (designFindings.length > 0) {
      const title = document.createElement('h4');
      title.className = 'design-section-title';
      title.style.margin = '20px 0 12px';
      title.textContent = 'Design Findings';
      findingsList.appendChild(title);

      designFindings.forEach(finding => {
        const card = document.createElement('div');
        card.className = 'finding-card';
        card.dataset.number = finding.number;
        const color = getMarkerColor(finding.number - 1);
        const iceAvg = iceAverage(finding.ice);
        card.innerHTML = `
          <div class="finding-number" style="background:${color}">${finding.number}</div>
          <div class="finding-body">
            <div class="finding-description">${escapeHtml(finding.description)}</div>
            <div class="finding-meta">
              <span class="ice-badge ${getICELevel(finding.ice.impact)}">I:${finding.ice.impact}/10</span>
              <span class="ice-badge ${getICELevel(finding.ice.confidence)}">C:${finding.ice.confidence}/10</span>
              <span class="ice-badge ${getICELevel(finding.ice.ease)}">E:${finding.ice.ease}/10</span>
              <span class="ice-total">${iceAvg}/10</span>
              <span class="category-tag category-design">design</span>
            </div>
          </div>
        `;
        findingsList.appendChild(card);
      });
    }
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

  // ── Render All ──

  function renderAll() {
    renderToolbar();
    renderScreenshot();
    renderFindings();
    renderDesignTab();
  }

  // ── Initialize ──

  document.addEventListener('DOMContentLoaded', async () => {
    // Load data
    const stored = await chrome.storage.local.get('echoflowResults');
    auditData = stored.echoflowResults;

    if (!auditData) {
      document.getElementById('findings-list').innerHTML =
        '<div class="empty-state"><p>No audit data found.<br>Run an audit or import an .echoflow file.</p></div>';
      return;
    }

    findings = auditData.findings || [];
    renderAll();

    // Resize observer for marker repositioning
    const img = document.getElementById('screenshot-img');
    if (img) {
      const observer = new ResizeObserver(() => renderMarkers());
      observer.observe(img);
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
