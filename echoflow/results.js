// EchoFlow Results Viewer
// Two-column layout: wireframe schematic + tabbed findings (Rules / AI).

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

    const date = new Date(auditData.meta.timestamp);
    document.getElementById('audit-time').textContent = date.toLocaleString();
  }

  // ── Render Wireframe Schematic ──

  function renderWireframe() {
    const container = document.getElementById('wireframe-container');
    container.innerHTML = '';

    const viewport = auditData.meta.viewport || { width: 1440, height: 900 };
    const scrollHeight = auditData.meta.scrollHeight || viewport.height;

    // Show viewport info
    const vpEl = document.getElementById('wireframe-viewport');
    vpEl.textContent = viewport.width + 'x' + viewport.height;

    // Get layout blocks from structured data
    const blocks = auditData.layout || buildLayoutFromSections();

    if (blocks.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No page structure detected</p></div>';
      return;
    }

    // Build a mapping: which findings belong to which block
    const blockFindings = mapFindingsToBlocks(blocks);

    // Track if we've drawn the fold line
    let foldDrawn = false;

    blocks.forEach((block, i) => {
      // Draw fold line before the first block that's below the fold
      if (!foldDrawn && block.top >= viewport.height) {
        const foldLine = document.createElement('div');
        foldLine.className = 'wf-fold-line';
        foldLine.textContent = 'fold (' + viewport.height + 'px)';
        container.appendChild(foldLine);
        foldDrawn = true;
      }

      const el = document.createElement('div');
      el.className = 'wf-block';
      el.dataset.blockIndex = i;

      // Scale height proportionally — min 24px, max 80px
      const scaledHeight = Math.max(24, Math.min(80, (block.height / scrollHeight) * 600));
      el.style.minHeight = scaledHeight + 'px';

      // Label
      const label = document.createElement('span');
      label.className = 'wf-block-label';
      label.textContent = cleanLabel(block.label);
      el.appendChild(label);

      // Size indicator
      const size = document.createElement('span');
      size.className = 'wf-block-size';
      size.textContent = Math.round(block.height) + 'px';
      el.appendChild(size);

      // Finding markers on this block
      const findingsHere = blockFindings.get(i) || [];
      findingsHere.forEach(f => {
        const marker = document.createElement('div');
        marker.className = 'wf-marker';
        marker.dataset.number = f.number;
        marker.textContent = f.number;
        marker.style.backgroundColor = getMarkerColor(f.number - 1);
        el.appendChild(marker);
      });

      // Click to highlight findings
      el.addEventListener('click', () => {
        if (findingsHere.length > 0) {
          setActiveFinding(findingsHere[0].number);
        }
      });

      container.appendChild(el);
    });

    // Draw fold line at end if never drawn and page is shorter than viewport
    if (!foldDrawn && scrollHeight > viewport.height) {
      const foldLine = document.createElement('div');
      foldLine.className = 'wf-fold-line';
      foldLine.textContent = 'fold';
      container.appendChild(foldLine);
    }
  }

  function cleanLabel(label) {
    // Clean up section type names: kebab-case → readable
    return label
      .replace(/-/g, ' ')
      .replace(/_/g, ' ')
      .replace(/\./g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }

  function buildLayoutFromSections() {
    // Fallback: build layout from sections data if no layout property
    if (!auditData.sections?.length) return [];
    return auditData.sections.map(s => ({
      label: s.type || s.id || 'section',
      type: 'section',
      top: s.position?.top || 0,
      height: s.position?.height || 100,
      width: s.position?.width || 0
    }));
  }

  function mapFindingsToBlocks(blocks) {
    const map = new Map(); // blockIndex → [findings]

    findings.forEach(f => {
      const pos = f.position || {};
      const fy = pos.y || 0;

      // Find the block that contains this finding's y position
      let bestIndex = 0;
      let bestDist = Infinity;
      blocks.forEach((block, i) => {
        const blockTop = block.top;
        const blockBottom = block.top + block.height;
        if (fy >= blockTop && fy <= blockBottom) {
          bestIndex = i;
          bestDist = 0;
        } else {
          const dist = Math.min(Math.abs(fy - blockTop), Math.abs(fy - blockBottom));
          if (dist < bestDist) {
            bestDist = dist;
            bestIndex = i;
          }
        }
      });

      if (!map.has(bestIndex)) map.set(bestIndex, []);
      map.get(bestIndex).push(f);
    });

    return map;
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

    // Highlight wireframe block
    document.querySelectorAll('.wf-block').forEach(block => {
      const hasMarker = block.querySelector(`.wf-marker[data-number="${number}"]`);
      block.classList.toggle('active', !!hasMarker);
    });

    // Highlight wireframe marker
    document.querySelectorAll('.wf-marker').forEach(marker => {
      const isActive = parseInt(marker.dataset.number) === number;
      marker.style.transform = isActive ? 'translateY(-50%) scale(1.3)' : 'translateY(-50%)';
    });

    // Scroll card into view
    const activeCard = document.querySelector(`.finding-card[data-number="${number}"]`);
    if (activeCard) {
      activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    renderWireframe();
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
    renderWireframe();
  }

  // ── Export / Import ──

  function exportAudit() {
    const exportData = { ...auditData };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `echoflow-audit-${dateStr}.echoflow`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Audit exported');
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
        showToast('Audit imported');
      } catch (err) {
        showToast('Failed to parse file');
      }
    };
    reader.readAsText(file);
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
    const stored = await chrome.storage.local.get('echoflowApiKey');
    const apiKey = stored.echoflowApiKey;

    if (!apiKey) {
      openSettings();
      showToast('Set your API key first');
      return;
    }

    // Show loading
    document.getElementById('ai-placeholder').style.display = 'none';
    document.getElementById('ai-loading').style.display = 'flex';
    document.getElementById('ai-result').style.display = 'none';
    document.getElementById('ai-error').style.display = 'none';

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'AI_ANALYZE',
        data: auditData,
        apiKey: apiKey
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
    chrome.storage.local.get('echoflowApiKey', (stored) => {
      document.getElementById('api-key-input').value = stored.echoflowApiKey || '';
    });
  }

  function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
  }

  function saveSettings() {
    const key = document.getElementById('api-key-input').value.trim();
    chrome.storage.local.set({ echoflowApiKey: key }, () => {
      closeSettings();
      showToast(key ? 'API key saved' : 'API key cleared');
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
    renderWireframe();
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

    // ── Tabs ──
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // ── Toolbar Buttons ──
    document.getElementById('btn-export').addEventListener('click', exportAudit);
    document.getElementById('btn-copy-all').addEventListener('click', copyAllFindings);
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
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-cancel-settings').addEventListener('click', closeSettings);
    document.querySelector('.modal-backdrop')?.addEventListener('click', closeSettings);
  });
})();
