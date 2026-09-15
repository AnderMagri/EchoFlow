/**
 * Structure view — the page as boxes.
 *
 * Everything else in this report is about values (colours, sizes, words). This
 * page is about shape: where the boxes are, how they nest, how many columns
 * they run, and where a Shopify section boundary probably falls.
 *
 * It exists because "how many sections is this page" is the first question of
 * any migration estimate, and reading it off a screenshot is guesswork while
 * reading it off the box tree is not.
 *
 * Rendered from the captured layout tree — no screenshot, no iframe, no request
 * back to the audited site. The wireframe is data, so it stays correct offline
 * and forever.
 *
 * @module core/wiki/render-structure
 */

import { flattenLayout } from '../observation.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Roles get colours so the skeleton reads at a glance, not just as grey boxes. */
const ROLE_HUES = {
  nav: 265, hero: 25, grid: 200, card: 200, form: 330, media: 160,
  footer: 265, aside: 95, text: 45, section: 210,
};

export const STRUCTURE_CSS = `
.structure-toolbar {
  position: sticky; top: 57px; z-index: 15; background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 11px 13px; margin: 18px 0; display: flex; gap: 16px;
  align-items: center; flex-wrap: wrap; font-size: 13px;
}
.structure-toolbar label { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; color: var(--muted); }
.structure-toolbar label:hover { color: var(--ink); }
.structure-toolbar input[type=checkbox] { accent-color: var(--accent); margin: 0; }
.structure-toolbar input[type=range] { accent-color: var(--accent); width: 108px; }
.structure-toolbar .grp { display: flex; gap: 13px; align-items: center; }
.structure-toolbar .sep { width: 1px; height: 19px; background: var(--border); }
.structure-toolbar .val { font-family: var(--mono); font-size: 12px; color: var(--ink); min-width: 15px; }

.viewport-switch { display: flex; border: 1px solid var(--border-strong); border-radius: 4px; overflow: hidden; }
.viewport-switch button {
  border: 0; background: var(--surface); color: var(--muted); font: inherit;
  font-size: 12px; padding: 3px 9px; cursor: pointer;
}
.viewport-switch button[aria-pressed="true"] { background: var(--ink); color: var(--bg); }

.stage {
  position: relative; background: var(--raised); border: 1px solid var(--border);
  border-radius: var(--radius); overflow: hidden; margin: 14px 0;
}
.canvas { position: relative; transform-origin: top left; }

.box {
  position: absolute; box-sizing: border-box; border: 1px solid transparent;
  transition: background-color .12s, border-color .12s;
}
.stage.outlines .box { border-color: color-mix(in srgb, var(--ink) 22%, transparent); }
.stage.fills .box { background: hsl(var(--hue, 210) 60% 50% / 0.07); }
.stage.fills .box:hover { background: hsl(var(--hue, 210) 60% 50% / 0.2); }
.box:hover { border-color: var(--accent) !important; border-width: 2px; z-index: 5; }
.box.is-section { border-width: 2px; }
.stage.outlines .box.is-section { border-color: color-mix(in srgb, var(--accent) 65%, transparent); }

.box-label {
  position: absolute; top: 0; left: 0; font-family: var(--mono); font-size: 9.5px;
  line-height: 1.3; padding: 1px 4px; background: var(--ink); color: var(--bg);
  white-space: nowrap; border-radius: 0 0 3px 0; pointer-events: none;
  opacity: 0; transition: opacity .12s; max-width: 100%; overflow: hidden;
}
.stage.labels .box-label { opacity: .82; }
.box:hover > .box-label { opacity: 1; z-index: 6; }

.colgrid { position: absolute; inset: 0; pointer-events: none; display: none; }
.stage.grid .colgrid { display: block; }
.colgrid i {
  position: absolute; top: 0; bottom: 0; width: 1px;
  background: color-mix(in srgb, var(--accent) 35%, transparent);
}

.inspector {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 13px 15px; margin: 14px 0;
  font-size: 13px; min-height: 76px;
}
.inspector .ph { color: var(--faint); font-style: italic; }
.inspector dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 14px; margin: 0; }
.inspector dt { color: var(--faint); font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; }
.inspector dd { margin: 0; font-family: var(--mono); font-size: 12.5px; }
.inspector h4 { margin: 0 0 8px; font-size: 14px; font-family: var(--mono); }

.legend { display: flex; gap: 13px; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin: 10px 0; }
.legend span { display: flex; align-items: center; gap: 5px; }
.legend i { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
`;

export const STRUCTURE_JS = `
(function () {
  var stage = document.querySelector('.stage');
  if (!stage) return;
  var canvas = stage.querySelector('.canvas');
  var data = window.__ECHOFLOW_LAYOUT__ || {};
  var insp = document.querySelector('.inspector');

  function toggle(cls, on) { stage.classList.toggle(cls, on); }

  document.querySelectorAll('[data-toggle]').forEach(function (cb) {
    toggle(cb.dataset.toggle, cb.checked);
    cb.addEventListener('change', function () { toggle(cb.dataset.toggle, cb.checked); });
  });

  var depth = document.querySelector('[data-depth]');
  if (depth) {
    var out = document.querySelector('[data-depth-val]');
    var applyDepth = function () {
      var max = parseInt(depth.value, 10);
      if (out) out.textContent = max;
      stage.querySelectorAll('.box').forEach(function (b) {
        b.style.display = parseInt(b.dataset.depth, 10) > max ? 'none' : '';
      });
    };
    depth.addEventListener('input', applyDepth);
    applyDepth();
  }

  // Scale the captured page to the width we actually have. The tree is stored in
  // real CSS pixels, so this is the only place that knows about display size.
  function fit() {
    var pageW = parseFloat(canvas.dataset.pagew) || 1440;
    var avail = stage.clientWidth;
    var scale = Math.min(1, avail / pageW);
    canvas.style.transform = 'scale(' + scale + ')';
    stage.style.height = (parseFloat(canvas.dataset.pageh) * scale) + 'px';
  }
  window.addEventListener('resize', fit);
  fit();

  stage.addEventListener('mouseover', function (e) {
    var box = e.target.closest('.box');
    if (!box || !insp) return;
    var n = data[box.dataset.id];
    if (!n) return;
    insp.innerHTML = '<h4>' + (n.label || n.tag) + '</h4><dl>'
      + row('Size', Math.round(n.w) + ' x ' + Math.round(n.h) + ' px')
      + row('Position', Math.round(n.x) + ', ' + Math.round(n.y))
      + row('Display', n.display + (n.cols ? ' (' + n.cols + ' cols)' : ''))
      + (n.gap != null ? row('Gap', n.gap + 'px') : '')
      + row('Depth', n.depth)
      + (n.role ? row('Role', n.role) : '')
      + (n.section ? row('Section', 'likely a page section') : '')
      + '</dl>';
  });
  function row(k, v) { return '<dt>' + k + '</dt><dd>' + v + '</dd>'; }
})();
`;

/**
 * @param {object} opts
 * @param {import('../observation.js').PageObservation} opts.observation
 * @param {string} opts.site
 * @param {string} opts.nav
 * @param {string} opts.generatedAt
 */
export function renderStructureHTML({ observation, site, nav, generatedAt }) {
  const root = observation.layout;
  if (!root) return null;

  const nodes = flattenLayout(root);
  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const pageW = root.w || observation.viewport.width || 1440;
  const pageH = root.h || 2000;

  // Lookup table for the inspector — shipped as data so hovering costs nothing
  // and works with the file opened from disk.
  const lookup = Object.fromEntries(nodes.map((n) => [n.id, {
    label: n.label, tag: n.tag, role: n.role || null, x: n.x, y: n.y, w: n.w, h: n.h,
    depth: n.depth, display: n.display, cols: n.cols ?? null, gap: n.gap ?? null,
    section: !!n.section,
  }]));

  const boxes = nodes.map((n) => {
    const hue = ROLE_HUES[n.role] ?? ROLE_HUES.section;
    return `<div class="box${n.section ? ' is-section' : ''}" data-id="${esc(n.id)}" data-depth="${n.depth}"
 style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;--hue:${hue}">
<span class="box-label">${esc(n.label)}${n.cols ? ` · ${n.cols}col` : ''}</span></div>`;
  }).join('\n');

  const sections = nodes.filter((n) => n.section);
  const colCounts = [...new Set(nodes.map((n) => n.cols).filter(Boolean))].sort((a, b) => a - b);

  const body = `
<h1>Structure</h1>
<p class="lede">${esc(observation.url)} · ${esc(observation.viewport.label)} ${observation.viewport.width}px · ${nodes.length} boxes, ${maxDepth} levels deep</p>
<div class="note">The page as boxes, drawn from the captured layout tree — not a screenshot. <strong>${sections.length} likely section${sections.length === 1 ? '' : 's'}</strong> detected: in a Shopify rebuild these are roughly what you would have to build as sections.</div>

<div class="structure-toolbar">
  <div class="grp">
    <label><input type="checkbox" data-toggle="outlines" checked> Outlines</label>
    <label><input type="checkbox" data-toggle="fills"> Fills</label>
    <label><input type="checkbox" data-toggle="labels"> Labels</label>
    <label><input type="checkbox" data-toggle="grid"> Columns</label>
  </div>
  <div class="sep"></div>
  <div class="grp">
    <label>Depth <input type="range" data-depth min="0" max="${maxDepth}" value="${Math.min(3, maxDepth)}"></label>
    <span class="val" data-depth-val>${Math.min(3, maxDepth)}</span>
  </div>
</div>

<div class="legend">
  <span><i style="background:hsl(${ROLE_HUES.hero} 60% 50% / .5)"></i>hero</span>
  <span><i style="background:hsl(${ROLE_HUES.grid} 60% 50% / .5)"></i>grid / card</span>
  <span><i style="background:hsl(${ROLE_HUES.nav} 60% 50% / .5)"></i>nav / footer</span>
  <span><i style="background:hsl(${ROLE_HUES.form} 60% 50% / .5)"></i>form</span>
  <span><i style="background:hsl(${ROLE_HUES.media} 60% 50% / .5)"></i>media</span>
  <span><i style="background:hsl(${ROLE_HUES.text} 60% 50% / .5)"></i>text</span>
</div>

<div class="stage outlines">
  <div class="canvas" data-pagew="${pageW}" data-pageh="${pageH}" style="width:${pageW}px;height:${pageH}px">
    <div class="colgrid">${gridLines(pageW)}</div>
    ${boxes}
  </div>
</div>

<div class="inspector"><span class="ph">Hover a box to inspect it.</span></div>

<h2>Section skeleton</h2>
${sections.length ? `<table>
<thead><tr><th>#</th><th>Box</th><th class="num">Height</th><th>Layout</th><th>Role</th></tr></thead>
<tbody>
${sections.map((n, i) => `<tr><td class="num">${i + 1}</td><td><code>${esc(n.label)}</code></td>
<td class="num">${Math.round(n.h)}px</td><td>${esc(n.display)}${n.cols ? ` · ${n.cols} cols` : ''}</td>
<td>${esc(n.role || '—')}</td></tr>`).join('')}
</tbody></table>` : '<p class="empty">No page-level sections detected.</p>'}

${colCounts.length ? `<h2>Column systems in use</h2>
<p style="color:var(--muted);font-size:14px">This page runs ${colCounts.length} different column count${colCounts.length === 1 ? '' : 's'}: ${colCounts.map((c) => `<code>${c}</code>`).join(' ')}.
${colCounts.length > 3 ? 'That is more grid systems than a theme normally needs — each one is a separate layout decision to port.' : ''}</p>` : ''}

<script>window.__ECHOFLOW_LAYOUT__ = ${JSON.stringify(lookup)};</script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Structure — ${esc(site)}</title>
<link rel="stylesheet" href="assets/wiki.css">
<link rel="stylesheet" href="assets/structure.css">
</head>
<body>
<header class="site">
  <div class="inner">
    <div class="brand">EchoFlow <span>/ ${esc(site)}</span></div>
    <nav class="tabs">${nav}</nav>
  </div>
</header>
<div class="wrap">
${body}
<footer class="site">Generated by EchoFlow ${esc(generatedAt)} · structure captured from the live DOM, not a screenshot.</footer>
</div>
<script src="assets/structure.js"></script>
</body>
</html>`;
}

/** 12-column reference grid, the default most themes assume. */
function gridLines(pageW, cols = 12) {
  const lines = [];
  for (let i = 1; i < cols; i++) lines.push(`<i style="left:${(pageW / cols) * i}px"></i>`);
  return lines.join('');
}
