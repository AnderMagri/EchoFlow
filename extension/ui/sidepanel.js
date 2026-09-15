/**
 * The sidebar — EchoFlow's working surface.
 *
 * You browse the client's site and fire the analysis from where you are. What
 * changed from v1 is what happens behind the button (structured extraction, not
 * a screenshot), not the gesture.
 *
 * This file is UI only. Every measurement it shows comes from core/, the same
 * code the CLI runs — so a score here and a score there cannot disagree.
 */

import { analyze } from '../core/analyze.js';
import { collectFromDocument } from '../core/collect-dom.js';
import { inferSurface, sectionSkeleton, flattenLayout } from '../core/observation.js';
import { effortLabel, priorityBand, SURFACE_LABELS } from '../core/finding.js';
import { buildBundle } from '../core/wiki/bundle.js';
import { toggleOverlay } from '../content/overlay.js';
import { createZip } from '../lib/zip.js';

const $ = (sel) => document.querySelector(sel);
const out = $('#out');

let current = null;      // last AnalysisResult
let observation = null;  // last raw observation
let tab = 'review';
let overlayMode = 'off';

// --- helpers ---------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

/** Inject a function into the page and get its return value back. */
async function inPage(fn, args = []) {
  const t = await activeTab();
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: t.id },
    func: fn,
    args,
    world: 'MAIN',
  });
  return res?.result;
}

// --- scan ------------------------------------------------------------------

async function scan() {
  const btn = $('#scan');
  btn.disabled = true;
  btn.textContent = 'Analysing…';
  out.innerHTML = '<div class="empty">Reading the page…</div>';

  try {
    const t = await activeTab();
    const surface = inferSurface(t.url);
    observation = await inPage(collectFromDocument, [{ surface, viewportLabel: 'desktop' }]);
    if (!observation) throw new Error('Could not read this page. Chrome blocks extensions on chrome:// and Web Store pages.');

    const axes = [...document.querySelectorAll('#axes input:checked')].map((i) => i.value);
    if (!axes.length) throw new Error('Pick at least one axis.');

    current = analyze({ observations: [observation], axes, site: new URL(t.url).hostname });
    $('#tabs').hidden = false;
    $('#foot').hidden = false;
    render();
  } catch (err) {
    out.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analyse this page';
  }
}

// --- render ----------------------------------------------------------------

function render() {
  if (!current) return;
  if (tab === 'review') renderReview();
  else if (tab === 'findings') renderFindings();
  else renderStructure();
}

function scoreBlock() {
  const c = current.consistency;
  return `<div class="score">
    <span class="n">${c.overall ?? '—'}</span><span class="of">/100</span><span class="g">${esc(c.grade)}</span>
    <div class="bar"><i style="width:${c.overall ?? 0}%"></i></div>
    <div class="verdict">${esc(c.verdict)}</div>
    ${c.caveat ? `<div class="warn"><strong>Provisional.</strong> ${esc(c.caveat)}</div>` : ''}
    <div class="axisrow">${current.axes.map((a) => `<div>
      <div class="l">${a}</div><div class="v">${c.byAxis[a] ?? '—'}</div></div>`).join('')}</div>
  </div>`;
}

/**
 * The design review. This is the quick-access view: the extracted system, in
 * the tab, without generating or opening a report.
 */
function renderReview() {
  const t = current.tokens;
  if (!t) {
    out.innerHTML = scoreBlock() + '<div class="empty">Run the Design axis to see the extracted system.</div>';
    return;
  }
  const typ = t.typography;

  out.innerHTML = scoreBlock() + `
  <h3>Brand colour</h3>
  <div class="swatches">
    ${t.color.primary ? `<div class="sw"><i style="background:${esc(t.color.primary)}"></i>${esc(t.color.primary)}</div>` : '<div class="sw">none detected</div>'}
    ${t.color.accents.map((c) => `<div class="sw"><i style="background:${esc(c)}"></i>${esc(c)}</div>`).join('')}
  </div>

  <h3>Neutral ramp — ${t.color.neutral.length} steps</h3>
  <div class="swatches">
    ${t.color.neutral.map((n) => `<div class="sw"><i style="background:${esc(n.hex)}"></i>${esc(n.name)}</div>`).join('')}
  </div>
  ${t.color.contrastWarnings.map((w) => `<div class="warn"><strong>${esc(w.pair)}</strong> is ${w.ratio}:1, needs ${w.required}:1. ${esc(w.note)}</div>`).join('')}

  <h3>Type scale — ${typ.scale.length} steps${typ.ratio ? `, ratio ${typ.ratio}` : ', no consistent ratio'}</h3>
  <div class="rows">
    ${typ.scale.map((s) => `<div class="row"><b>${esc(s.name)}</b><span>${s.px}px · ${s.uses} uses</span></div>`).join('')}
  </div>

  <h3>Typefaces — ${typ.families.all.length}</h3>
  <div class="rows">
    ${typ.families.all.slice(0, 5).map((f) => `<div class="row"><b>${esc(f.stack.split(',')[0].replace(/['"]/g, ''))}</b><span>${f.uses}</span></div>`).join('')}
  </div>

  <h3>Spacing — base ${t.spacing.base}px, ${Math.round(t.spacing.adherence * 100)}% on rhythm</h3>
  <div class="rows">
    <div class="row"><b>Steps</b><span>${t.spacing.steps.map((s) => s + 'px').join(' ')}</span></div>
    ${t.spacing.strays.length ? `<div class="row"><b>Off-rhythm</b><span>${t.spacing.strays.slice(0, 6).map((s) => s.value + 'px').join(' ')}</span></div>` : ''}
  </div>

  <h3>Radius &amp; elevation</h3>
  <div class="rows">
    <div class="row"><b>Radii</b><span>${t.radius.steps.map((r) => r.px + 'px').join(' ') || 'none'}</span></div>
    <div class="row"><b>Shadows</b><span>${t.shadow.steps.length} distinct</span></div>
  </div>

  ${current.skipped.length ? `<div class="skipped"><strong>${current.skipped.length} dimension(s) not measured</strong> on a single page — excluded from the score, not counted as passing:
  ${esc(current.skipped.map((s) => s.key).join(', '))}.</div>` : ''}`;
}

function renderFindings() {
  const fs = current.findings;
  out.innerHTML = scoreBlock() + (fs.length
    ? fs.map((f) => `<div class="f ${priorityBand(f.priority)}">
        <div class="t">${esc(f.title)}</div>
        <div class="r">${esc(f.recommendation)}</div>
        <div class="m">${f.priority} · ${esc(f.axis)} · impact ${f.impact} · ${esc(effortLabel(f.effort))} fix · ${esc(SURFACE_LABELS[f.surface] || f.surface)}</div>
      </div>`).join('')
    : '<div class="empty">Nothing found at this scope.</div>');
}

/**
 * Structure tab. The overlay draws on the LIVE page rather than on a capture,
 * so you can scroll the site with the skeleton lit up.
 */
function renderStructure() {
  const sections = observation?.layout ? sectionSkeleton(observation.layout) : [];
  const nodes = observation?.layout ? flattenLayout(observation.layout) : [];
  const cols = [...new Set(nodes.map((n) => n.cols).filter(Boolean))].sort((a, b) => a - b);

  out.innerHTML = `
  <div class="ovbtns">
    <button data-ov="sections" class="${overlayMode === 'sections' ? 'on' : ''}">Sections</button>
    <button data-ov="all" class="${overlayMode === 'all' ? 'on' : ''}">All boxes</button>
    <button data-ov="columns" class="${overlayMode === 'columns' ? 'on' : ''}">Columns</button>
    <button data-ov="off" class="${overlayMode === 'off' ? 'on' : ''}">Off</button>
  </div>
  <div class="skipped">Draws on the live page — scroll the site with it on.</div>

  <h3>Section skeleton — ${sections.length}</h3>
  <div class="rows seclist">
    ${sections.length ? sections.map((n) => `<div class="row"><b>${esc(n.label)}</b><span>${Math.round(n.h)}px${n.cols ? ' · ' + n.cols + 'col' : ''}</span></div>`).join('')
      : '<div class="row"><b>None detected</b><span>—</span></div>'}
  </div>

  <h3>Column systems — ${cols.length}</h3>
  <div class="rows">
    <div class="row"><b>In use</b><span>${cols.join(', ') || 'none'}</span></div>
    <div class="row"><b>Boxes</b><span>${nodes.length} · ${Math.max(...nodes.map((n) => n.depth), 0)} deep</span></div>
  </div>`;
}

// --- export ----------------------------------------------------------------

async function exportBundle() {
  if (!current) return;
  const files = buildBundle(current);
  const blob = createZip(files);
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  await chrome.downloads.download({
    url,
    filename: `echoflow-${current.site.replace(/[^a-z0-9.-]/gi, '-')}-${stamp}.zip`,
    saveAs: true,
  });
  // Revoke late: the download reads from the URL asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// --- wiring ----------------------------------------------------------------

$('#scan').addEventListener('click', scan);

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  render();
});

out.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-ov]');
  if (!b) return;
  overlayMode = b.dataset.ov;
  const t = await activeTab();
  await chrome.scripting.executeScript({
    target: { tabId: t.id },
    func: toggleOverlay,
    args: [overlayMode],
    world: 'MAIN',
  });
  renderStructure();
});

$('#export').addEventListener('click', exportBundle);

$('#copyjson').addEventListener('click', async () => {
  if (!current) return;
  const { observations, ...core } = current;
  await navigator.clipboard.writeText(JSON.stringify(core, null, 2));
  const b = $('#copyjson');
  b.textContent = 'Copied';
  setTimeout(() => { b.textContent = 'Copy JSON'; }, 1400);
});

activeTab().then((t) => {
  try { $('#host').textContent = new URL(t.url).hostname; } catch { /* chrome:// page */ }
});
