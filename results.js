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
      const marker = document.createElement('div');
      marker.className = 'marker';
      marker.dataset.number = finding.number;
      marker.textContent = finding.number;
      marker.style.backgroundColor = getMarkerColor(finding.number - 1);

      const pos = finding.position || { x: 0, y: 0 };
      const cx = (pos.x + (pos.width || 0) / 2) * scaleX;
      const cy = (pos.y + (pos.height || 0) / 2) * scaleY;

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
            <span class="ice-badge ${getICELevel(finding.ice.impact)}">I:${finding.ice.impact}</span>
            <span class="ice-badge ${getICELevel(finding.ice.confidence)}">C:${finding.ice.confidence}</span>
            <span class="ice-badge ${getICELevel(finding.ice.ease)}">E:${finding.ice.ease}</span>
            <span class="ice-total">${iceAvg}</span>
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

    // ── Finding slides ──
    findings.forEach((f) => {
      const cat = f.category.toUpperCase();
      const desc = escapeStr(f.description);
      const iceText = `Impact: ${f.ice.impact}/10    Confidence: ${f.ice.confidence}/10    Ease: ${f.ice.ease}/10    Average: ${iceAverage(f.ice)}`;

      script += `
  // ── Finding #${f.number} ──
  {
    const slide = createSlide("Finding #${f.number}");
    addScreenshot(slide, IMG_X, PAD, COL_W, H - PAD * 2);

    // Finding number circle
    const circle = figma.createEllipse();
    circle.name = "Number";
    circle.x = TXT_X;
    circle.y = ${PAD + 20};
    circle.resize(56, 56);
    circle.fills = [{ type: "SOLID", color: ACCENT }];
    slide.appendChild(circle);
    const numText = addText(slide, TXT_X + 16, ${PAD + 32}, 24, "${f.number}", 24, {r:1,g:1,b:1}, "Bold");

    addBadge(slide, TXT_X + 72, ${PAD + 30}, "${cat}", ACCENT);

    addText(slide, TXT_X, ${PAD + 110}, COL_W, "Finding #${f.number}", 40, TXT, "Bold");
    addText(slide, TXT_X, ${PAD + 170}, COL_W, "${desc}", 24, SUBTXT, "Regular");

    // ICE scores
    addText(slide, TXT_X, ${H - PAD - 100}, COL_W, "ICE Score", 16, SUBTXT, "Semi Bold");
    addText(slide, TXT_X, ${H - PAD - 70}, COL_W, "${iceText}", 16, TXT, "Regular");
  }
`;
    });

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
    document.getElementById('btn-export-figma').addEventListener('click', exportToFigma);
    document.getElementById('btn-settings').addEventListener('click', openSettings);

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
