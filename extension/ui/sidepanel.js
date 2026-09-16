/**
 * The sidebar — EchoFlow's working surface.
 *
 * Two things shape this file:
 *
 * 1. It COLLECTS, it does not just scan. Comparative checks need more than one
 *    page, and the original one-shot button could never satisfy them — every
 *    run reported "needs more than one page" for the dimensions that matter
 *    most. So the panel keeps a set of collected pages: browse the client's
 *    site, add pages as you go, and the analysis re-runs across all of them.
 *    That also happens to be the concept's own working model.
 *
 * 2. It is UI only. Every measurement comes from core/, the same code the CLI
 *    runs, so a score here and a score there cannot disagree.
 */

import { analyze } from '../core/analyze.js';
import { collectFromDocument } from '../core/collect-dom.js';
import { inferSurface, sectionSkeleton, flattenLayout } from '../core/observation.js';
import { effortLabel, priorityBand, SURFACE_LABELS } from '../core/finding.js';
import { buildBundle } from '../core/wiki/bundle.js';
import { toggleOverlay } from '../content/overlay.js';
import { createZip } from '../lib/zip.js';

const $ = (s) => document.querySelector(s);
const out = $('#out');

/** @type {object[]} every page collected this session */
let collected = [];
let current = null;
let tab = 'review';
let overlayMode = 'off';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

async function inPage(fn, args = []) {
  const t = await activeTab();
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: t.id }, func: fn, args, world: 'MAIN',
  });
  return res?.result;
}

// --- collect ---------------------------------------------------------------

async function grab() {
  const t = await activeTab();
  const surface = inferSurface(t.url);
  const obs = await inPage(collectFromDocument, [{ surface, viewportLabel: 'desktop' }]);
  if (!obs) throw new Error('Could not read this page. Chrome blocks extensions on chrome:// and Web Store pages.');
  return obs;
}

async function run({ append }) {
  const btn = append ? $('#add') : $('#scan');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = append ? 'Adding…' : 'Analysing…';

  try {
    const obs = await grab();
    if (append) {
      // Same URL twice adds nothing — replace rather than double-count it.
      collected = collected.filter((o) => o.url !== obs.url).concat(obs);
    } else {
      collected = [obs];
    }

    const axes = [...document.querySelectorAll('#axes input:checked')].map((i) => i.value);
    if (!axes.length) throw new Error('Pick at least one axis.');

    current = analyze({ observations: collected, axes, site: new URL(collected[0].url).hostname });
    $('#tabs').hidden = false;
    $('#foot').hidden = false;
    renderPages();
    render();
  } catch (err) {
    out.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function renderPages() {
  const box = $('#pages');
  box.hidden = !collected.length;
  $('#pagecount').textContent = collected.length;
  $('#pageword').textContent = collected.length === 1 ? 'page collected' : 'pages collected';
  $('#pagelist').innerHTML = collected.map((o, i) => `<li>
    <span class="surf">${esc(o.surface)}</span>
    <span class="u" title="${esc(o.url)}">${esc(shortUrl(o.url))}</span>
    <button class="x" data-rm="${i}" title="Remove">✕</button></li>`).join('');

  // Say exactly what is still missing, not just that something is.
  const counts = {};
  for (const o of collected) counts[o.surface] = (counts[o.surface] || 0) + 1;
  const pairs = Object.entries(counts).filter(([, n]) => n >= 2);
  $('#hint').innerHTML = collected.length < 2
    ? 'Comparative checks — the ones that measure consistency <b>across</b> pages — need at least two pages of the same type. Browse to another product and hit <b>+ Add page</b>.'
    : pairs.length
      ? `Comparing ${pairs.map(([s, n]) => `<b>${n} ${s.toUpperCase()}</b>`).join(' and ')}. Add more of the same type for a sharper reading.`
      : `${collected.length} pages, but no two of the same type yet — comparative checks need <b>two PDPs</b> (or two PLPs) to compare. Add another of the same kind.`;
}

const shortUrl = (u) => { try { const x = new URL(u); return (x.pathname + x.search).slice(0, 44) || '/'; } catch { return u; } };

// --- render ----------------------------------------------------------------

function render() {
  if (!current) return;
  ({ review: renderReview, findings: renderFindings, structure: renderStructure }[tab])();
}

const PLATFORM_NAMES = {
  shopify: 'Shopify', 'wordpress-woocommerce': 'WooCommerce', magento: 'Magento',
  bigcommerce: 'BigCommerce', squarespace: 'Squarespace', squarespace7: 'Squarespace',
  wix: 'Wix', vtex: 'VTEX', 'salesforce-commerce': 'Salesforce Commerce',
  prestashop: 'PrestaShop', webflow: 'Webflow', 'custom-ecommerce': 'Custom / unrecognised',
  unknown: 'Unrecognised',
};

/**
 * The platform banner. EchoFlow is Shopify-first, so a non-Shopify site is a
 * legitimate subject — it is the pre-migration half of the product — but it has
 * to be labelled, because several checks read Shopify conventions and mean less
 * without them. Silently scoring a Wix site as if it were Shopify would be the
 * tool lying by omission.
 */
function platformBanner() {
  const p = current.platform || 'unknown';
  const shopify = current.isShopify;
  return `<div class="platform ${shopify ? '' : 'warn'}">
    <span class="tagname">${esc(PLATFORM_NAMES[p] || p)}</span>
    <p>${shopify
      ? 'Shopify store — every check applies, including theme and section analysis.'
      : `Not a Shopify store. The design and UX measurements are all valid, but Shopify-specific checks (theme sections, app embeds, money format) have nothing to read. Treat this as a <strong>pre-migration</strong> audit: the question it answers is what would have to be rebuilt.`}</p>
  </div>`;
}

function scoreBlock() {
  const c = current.consistency;
  const groups = Object.entries(c.byGroup)
    .filter(([, g]) => current.axes.includes(g.axis))
    .sort((a, b) => (a[1].score ?? 999) - (b[1].score ?? 999));

  return `${platformBanner()}
  <div class="score">
    <span class="n">${c.overall ?? '—'}</span><span class="of">/100</span>
    <span class="g">${esc(c.grade)}${c.provisional ? ' · <span class="provisional">provisional</span>' : ''}</span>
    <div class="verdict">${esc(c.verdict)}</div>
    <div class="bd">
      ${groups.map(([name, g]) => `<div class="bd-row ${g.score == null ? 'dim' : ''}">
        <span class="k">${esc(name)}</span>
        <span class="track"><i style="width:${g.score ?? 0}%"></i></span>
        <span class="v">${g.score ?? '—'}</span>
      </div>`).join('')}
    </div>
    ${c.caveat ? `<div class="note warn">${esc(c.caveat)}</div>` : ''}
  </div>`;
}

/** Inject the page's real @font-face sources so specimens render truthfully. */
function injectFonts() {
  document.getElementById('ef-fonts')?.remove();
  const faces = collected.flatMap((o) => o.engine?.fontFaces || []);
  if (!faces.length) return new Set();
  const seen = new Set();
  const css = faces.filter((f) => {
    const k = `${f.family}|${f.weight}|${f.style}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((f) => `@font-face{font-family:"EF ${cssEscape(f.family)}";src:url("${f.src}");font-weight:${f.weight};font-style:${f.style};font-display:swap;}`).join('\n');

  const el = document.createElement('style');
  el.id = 'ef-fonts';
  el.textContent = css;
  document.head.appendChild(el);
  return new Set(faces.map((f) => f.family.toLowerCase()));
}

const cssEscape = (s) => String(s).replace(/["\\]/g, '');
const firstFamily = (stack) => String(stack).split(',')[0].trim().replace(/^["']|["']$/g, '');

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const SAMPLE = 'Handgloves 123';
const SAMPLE_BODY = 'The quick brown fox jumps over the lazy dog.';

function renderReview() {
  const t = current.tokens;
  if (!t) { out.innerHTML = scoreBlock() + '<div class="empty">Run the Design axis to see the extracted system.</div>'; return; }

  const loadable = injectFonts();
  const typ = t.typography;
  const maxSpace = Math.max(...t.spacing.steps, ...t.spacing.strays.map((s) => s.value), 1);

  out.innerHTML = scoreBlock() + `
  <h3>Brand colour <span>${plural(t.color.accents.length + (t.color.primary ? 1 : 0), 'token')}</span></h3>
  <div class="sw-row">
    ${t.color.primary ? `<div class="sw"><i style="background:${esc(t.color.primary)}"></i>${esc(t.color.primary)}<b>primary</b></div>` : '<div class="sw">none detected</div>'}
    ${t.color.accents.map((c) => `<div class="sw"><i style="background:${esc(c)}"></i>${esc(c)}</div>`).join('')}
  </div>

  <h3>Neutral ramp <span>${plural(t.color.neutral.length, 'step')}</span></h3>
  <div class="sw-row">
    ${t.color.neutral.map((n) => `<div class="sw"><i style="background:${esc(n.hex)}"></i>${esc(n.hex)}<b>${esc(n.name)}</b></div>`).join('')}
  </div>
  ${t.color.contrastWarnings.map((w) => `<div class="note warn"><strong>${esc(w.pair)}</strong> is ${w.ratio}:1, needs ${w.required}:1. ${esc(w.note)}</div>`).join('')}

  <h3>Typefaces <span>${plural(typ.families.all.length, 'face')} in use</span></h3>
  ${typ.families.all.slice(0, 6).map((f) => {
    const fam = firstFamily(f.stack);
    const have = loadable.has(fam.toLowerCase());
    // Prefer the captured webfont; fall back to the raw stack, which still
    // renders correctly for system faces.
    const ff = have ? `"EF ${esc(cssEscape(fam))}", ${esc(f.stack)}` : esc(f.stack);
    return `<div class="spec" data-family="${esc(fam)}" data-captured="${have}">
      <div class="name"><b>${esc(fam)}</b><span>${plural(f.uses, 'use')}</span></div>
      <div class="sample" style="font-family:${ff}">${SAMPLE}</div>
      <div class="sample small" style="font-family:${ff}">${SAMPLE_BODY}</div>
      <div class="unavail" hidden></div>
    </div>`;
  }).join('')}

  <h3>Type scale <span>${plural(typ.scale.length, 'step')}${typ.ratio ? ` · ratio ${typ.ratio}` : ' · no consistent ratio'}</span></h3>
  ${typ.scale.slice().reverse().map((s) => {
    const fam = firstFamily(typ.families.heading || 'inherit');
    const ff = loadable.has(fam.toLowerCase()) ? `"EF ${esc(cssEscape(fam))}", ${esc(typ.families.heading)}` : 'inherit';
    return `<div class="step">
      <span class="lbl">${esc(s.name)}</span>
      <span class="demo" style="font-size:${Math.min(s.px, 34)}px;font-family:${ff}">Aa</span>
      <span class="uses">${s.px}px · ${s.uses}</span>
    </div>`;
  }).join('')}

  <h3>Spacing <span>${t.spacing.base}px base · ${Math.round(t.spacing.adherence * 100)}% on rhythm</span></h3>
  ${t.spacing.steps.map((px) => `<div class="sp">
    <span class="lbl">${px}</span>
    <span class="bar" style="width:${Math.max(2, (px / maxSpace) * 100)}%"></span>
    <span class="uses"></span>
  </div>`).join('')}
  ${t.spacing.strays.length ? `
    ${t.spacing.strays.slice(0, 8).map((s) => `<div class="sp stray">
      <span class="lbl">${s.value}</span>
      <span class="bar" style="width:${Math.max(2, (s.value / maxSpace) * 100)}%"></span>
      <span class="uses">→${s.nearest}</span>
    </div>`).join('')}
    <p class="legend">Solid bars sit on the ${t.spacing.base}px grid. Hatched bars do not — the arrow shows the nearest step they should snap to.</p>`
    : '<p class="legend">Every spacing value sits on the grid.</p>'}

  <h3>Shape</h3>
  <dl class="kv">
    <dt>Corner radii</dt><dd>${t.radius.steps.map((r) => r.px + 'px').join(' · ') || 'none'}</dd>
    <dt>Shadows</dt><dd>${t.shadow.steps.length}</dd>
  </dl>

  ${current.skipped.length ? `<div class="note"><strong>${current.skipped.length} dimension${current.skipped.length === 1 ? '' : 's'} not measured</strong> — excluded from the score, not counted as passing: ${esc(current.skipped.map((s) => s.key).join(', '))}.</div>` : ''}`;

  verifySpecimens();
}

/**
 * Is this family actually rendering, or silently falling back?
 *
 * NOT document.fonts.check(). That API reports whether CSS font-matching would
 * succeed, and matching always succeeds via fallback — it returns true for a
 * family name you just invented, so it would pronounce every specimen fine.
 *
 * Measure instead. Render a string in `"Family", <generic>` and in `<generic>`
 * alone. If the family resolved, the width is the family's and differs from the
 * generic; if it did not, the two are identical because both drew the same
 * fallback. Comparing against three different generics removes the coincidence
 * of one accidental width match.
 */
function fontResolves(family) {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return true; // cannot tell — do not cry wolf
  const probe = 'mmmwwwiiilll0123WA';
  let differs = 0;
  for (const generic of ['monospace', 'serif', 'sans-serif']) {
    ctx.font = `72px ${generic}`;
    const base = ctx.measureText(probe).width;
    ctx.font = `72px "${family}", ${generic}`;
    if (Math.abs(ctx.measureText(probe).width - base) > 0.5) differs++;
  }
  return differs >= 2;
}

/**
 * Mark specimens that are not really showing the typeface they name. Showing a
 * fallback under the real font's name is the one outcome to avoid on a design
 * review — it is worse than showing nothing, because it looks like an answer.
 */
async function verifySpecimens() {
  const specs = [...document.querySelectorAll('.spec')];
  if (!specs.length) return;

  // Webfonts must be requested before they can be measured.
  await Promise.all(specs.map(async (spec) => {
    if (spec.dataset.captured !== 'true') return;
    try { await document.fonts.load(`16px "EF ${spec.dataset.family}"`); } catch { /* blocked or 404 */ }
  }));
  try { await document.fonts.ready; } catch { /* no font API */ }

  for (const spec of specs) {
    const fam = spec.dataset.family;
    const captured = spec.dataset.captured === 'true';
    const ok = (captured && fontResolves(`EF ${fam}`)) || fontResolves(fam);

    const note = spec.querySelector('.unavail');
    note.hidden = ok;
    if (ok) continue;
    note.textContent = captured
      ? 'Webfont did not load — this is a fallback, not the real face.'
      : 'Not installed here, and no webfont file was found on the page — this is a fallback, not the real face.';
    spec.querySelectorAll('.sample').forEach((el) => { el.style.opacity = '.5'; });
  }
}

function renderFindings() {
  const fs = current.findings;
  out.innerHTML = scoreBlock() + `<h3>Findings <span>${fs.length}</span></h3>` + (fs.length
    ? fs.map((f) => {
      const band = priorityBand(f.priority);
      return `<div class="f ${band}">
        <div class="p">${f.priority}</div>
        <div>
          <div class="t">${esc(f.title)}</div>
          <div class="r">${esc(f.recommendation)}</div>
          <div class="m"><span class="band">${band}</span> · ${esc(f.axis)} · impact ${f.impact} · ${esc(effortLabel(f.effort))} fix · ${esc(SURFACE_LABELS[f.surface] || f.surface)}</div>
        </div></div>`;
    }).join('')
    : '<div class="empty">Nothing found at this scope.</div>');
}

function renderStructure() {
  const last = collected[collected.length - 1];
  const sections = last?.layout ? sectionSkeleton(last.layout) : [];
  const nodes = last?.layout ? flattenLayout(last.layout) : [];
  const cols = [...new Set(nodes.map((n) => n.cols).filter(Boolean))].sort((a, b) => a - b);

  out.innerHTML = `
  <div class="ovbtns">
    ${['sections', 'all', 'columns', 'off'].map((m) => `<button class="btn ${overlayMode === m ? 'on' : ''}" data-ov="${m}">${m === 'all' ? 'All boxes' : m[0].toUpperCase() + m.slice(1)}</button>`).join('')}
  </div>
  <p class="legend">Draws on the live page — scroll the site with it on.</p>

  <h3>Section skeleton <span>${sections.length}</span></h3>
  ${sections.length ? sections.map((n, i) => `<div class="step">
      <span class="lbl">${i + 1}</span>
      <span class="demo" style="font-family:var(--mono);font-size:11.5px">${esc(n.label)}</span>
      <span class="uses">${Math.round(n.h)}px${n.cols ? ' · ' + n.cols + 'col' : ''}</span>
    </div>`).join('') : '<p class="legend">No page-level sections detected.</p>'}

  <h3>Grid</h3>
  <dl class="kv">
    <dt>Column systems</dt><dd>${cols.join(' · ') || 'none'}</dd>
    <dt>Boxes</dt><dd>${nodes.length}</dd>
    <dt>Max depth</dt><dd>${Math.max(...nodes.map((n) => n.depth), 0)}</dd>
  </dl>`;
}

// --- export ----------------------------------------------------------------

async function exportBundle() {
  if (!current) return;
  const blob = createZip(buildBundle(current));
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({
    url,
    filename: `echoflow-${current.site.replace(/[^a-z0-9.-]/gi, '-')}-${new Date().toISOString().slice(0, 10)}.zip`,
    saveAs: true,
  });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// --- wiring ----------------------------------------------------------------

$('#scan').addEventListener('click', () => run({ append: false }));
$('#add').addEventListener('click', () => run({ append: true }));

$('#pagelist').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rm]');
  if (!b) return;
  collected.splice(+b.dataset.rm, 1);
  if (!collected.length) {
    current = null;
    $('#tabs').hidden = true;
    $('#foot').hidden = true;
    out.innerHTML = '<div class="empty">Open a storefront and hit <strong>Analyse this page</strong>.</div>';
    renderPages();
    return;
  }
  const axes = [...document.querySelectorAll('#axes input:checked')].map((i) => i.value);
  current = analyze({ observations: collected, axes, site: new URL(collected[0].url).hostname });
  renderPages();
  render();
});

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
  await chrome.scripting.executeScript({ target: { tabId: t.id }, func: toggleOverlay, args: [overlayMode], world: 'MAIN' });
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

activeTab().then((t) => { try { $('#host').textContent = new URL(t.url).hostname; } catch { /* chrome:// */ } });
