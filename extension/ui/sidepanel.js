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
import {
  AXIS_LABELS, GEO_GROUPS, GEO_GROUP_BRIEF, GEO_GROUP_LABELS, OWNERS, OWNER_BRIEF,
  OWNER_LABELS, SURFACE_LABELS, effortLabel, geoGroupFor, isGeoFinding, priorityBand,
} from '../core/finding.js';
import { buildBundle } from '../core/wiki/bundle.js';
import { toggleOverlay } from '../content/overlay.js';
import { createZip } from '../lib/zip.js';
import {
  compareStatic, fetchEndpoints, fetchLlmsTxt, fetchRobots,
} from '../core/fetch-signals.js';
import { discoverPages } from '../core/discover.js';

const $ = (s) => document.querySelector(s);
const out = $('#out');

/** @type {object[]} every page collected this session */
let collected = [];
/** Site-level signals — fetched once per origin, not once per page. */
let siteSignals = null;
let current = null;
let tab = 'review';
let overlayMode = 'off';
/** null = use the grid detected from the page. A number overrides it. */
let overlayCols = null;
/** What the overlay reported back — the measured content container. */
let overlayInfo = null;
/** How the Findings tab partitions the pile: 'owner' | 'axis' | 'geo'. */
let grouping = 'owner';
/** Pages discovery proposed, awaiting confirmation. @type {{url:string,surface:string,on:boolean}[]} */
let proposed = [];
/** True once anything was collected in a background tab — changes what we can claim. */
let usedBackgroundTab = false;
/** Pages whose CSP forced the isolated world, so the theme name could not be read. */
const isolatedPages = new Set();
/** Set while an automatic run is in flight, so the button can stop it. */
let autoRun = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

// --- collect ---------------------------------------------------------------

/**
 * Inject the collector and get an observation back.
 *
 * MAIN first, ISOLATED as a fallback, and the order matters. A MAIN-world
 * injection is subject to the PAGE's Content-Security-Policy, so on a real
 * retailer — anyone with a strict `script-src` — `executeScript` resolves
 * cleanly with no result at all. It does not throw, so the failure looks like
 * "the collector returned nothing" and is trivially misread as the page being
 * unreadable. It is not: ISOLATED world reads the same DOM and the same
 * computed styles, and gets through.
 *
 * What ISOLATED costs is narrow and worth naming: `window.Shopify` is invisible
 * from it, so the theme name and version are lost, and Shopify detection falls
 * back to the section markup and script URLs — which is two of its three
 * signals, not none.
 */
async function injectCollector(tabId, args, world) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId }, func: collectFromDocument, args, world,
    });
    return res?.result ?? null;
  } catch (err) {
    // Distinguish "blocked" from "the collector itself is broken" — the second
    // must not be retried in another world, and must not be reported as CSP.
    return { failed: err.message };
  }
}

/**
 * Read one already-loaded tab. The manual button and the automatic run both
 * come through here, so a page collected by hand and the same page collected
 * automatically produce the identical observation — otherwise the two modes
 * would quietly measure different things and only one of them would be right.
 */
async function grabTab(tabId, url, say = () => {}) {
  const surface = inferSurface(url);
  const args = [{ surface, viewportLabel: 'desktop' }];

  say('Reading the page…');
  let obs = await injectCollector(tabId, args, 'MAIN');

  if (!obs || obs.failed) {
    const firstError = obs?.failed;
    say('Page blocks injected scripts — retrying in an isolated world…');
    obs = await injectCollector(tabId, args, 'ISOLATED');
    if (obs?.failed || !obs) {
      throw new Error(explainInjectionFailure(url, firstError || obs?.failed));
    }
    isolatedPages.add(url);
  }

  // The un-rendered HTML — what a crawler that does not execute JavaScript
  // receives. The extension has host permissions, so it can ask for it directly;
  // without this, parity and answerability report "not measurable" and the
  // newest checks are silently absent.
  say('Fetching the un-rendered HTML…');
  try {
    obs.retrieval.static = await compareStatic(url, obs.retrieval);
  } catch {
    obs.retrieval.static = { fetched: false };
  }
  return obs;
}

/**
 * Say what actually happened. The old message asserted chrome:// every time,
 * which sent people looking at the wrong thing on an ordinary storefront that
 * simply refused the injection.
 */
function explainInjectionFailure(url, detail) {
  let protocol = '';
  try { ({ protocol } = new URL(url)); } catch { /* unparseable */ }
  if (!/^https?:$/.test(protocol)) {
    return 'Chrome does not let extensions read this kind of page. Open the storefront in a normal tab and try again.';
  }
  // With a message from Chrome, pass it through and stop guessing — a
  // TypeError from the collector and a refused injection are different faults
  // and the same friendly hint on both sends people to the wrong place.
  return detail
    ? `Could not read ${shortUrl(url)} — ${detail}`
    : `Could not read ${shortUrl(url)}. The page returned nothing in either world, which usually means it had not finished loading. Reload it and try again.`;
}

async function grab(say) {
  const t = await activeTab();
  return grabTab(t.id, t.url, say);
}

/** robots.txt, llms.txt and the JSON endpoints — once per origin. */
async function grabSiteSignals(url) {
  let origin;
  try { origin = new URL(url).origin; } catch { return null; }
  if (siteSignals?.origin === origin) return siteSignals;
  try {
    const [robots, llmsTxt, endpoints] = await Promise.all([
      fetchRobots(origin), fetchLlmsTxt(origin), fetchEndpoints(origin),
    ]);
    // No `probe` key: a browser will not let a page set its own User-Agent, so
    // the crawler probe is analyzer-only. Its absence means those checks skip
    // rather than report a false all-clear.
    siteSignals = { robots, llmsTxt, endpoints, origin };
  } catch {
    siteSignals = null;
  }
  return siteSignals;
}

const chosenAxes = () => [...document.querySelectorAll('#axes input:checked')].map((i) => i.value);

/** Re-run the analysis over whatever is currently collected, and repaint. */
async function reanalyze(say = () => {}) {
  const axes = chosenAxes();
  if (!axes.length) throw new Error('Pick at least one axis.');
  if (axes.includes('engine')) {
    say('Reading robots.txt and the site signals…');
    await grabSiteSignals(collected[0].url);
  }
  say('Measuring…');
  current = analyze({
    observations: collected, axes, siteSignals,
    site: new URL(collected[0].url).hostname,
  });
  $('#tabs').hidden = false;
  $('#foot').hidden = false;
  renderPages();
  render();
}

async function run({ append }) {
  const btn = append ? $('#add') : $('#scan');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = append ? 'Adding…' : 'Analysing…';

  try {
    busy('Reading the page…');
    const obs = await grab(busy);
    if (append) {
      // Same URL twice adds nothing — replace rather than double-count it.
      collected = collected.filter((o) => o.url !== obs.url).concat(obs);
    } else {
      collected = [obs];
      usedBackgroundTab = false;
      isolatedPages.clear();
    }
    await reanalyze(busy);
  } catch (err) {
    out.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// --- automatic page selection ----------------------------------------------
//
// Picking pages by hand is the part of a run most likely to go wrong: someone
// adds three pages, no two of them the same type, and every comparative
// dimension skips with "needs more than one page" — the tool looks broken when
// it was only ever badly fed. Discovery fixes the feeding, not the tool.
//
// It stays a THREE-step flow — find, confirm, collect — for one reason: the
// collection step navigates a real browser tab around a real storefront, with
// the operator's cookies and session attached. That is not something to start
// without showing the list first. The proposal is editable, so automatic is a
// starting point for the manual flow rather than a replacement for it.

/** Read the sitemap (or crawl) and propose a sample, without opening anything. */
async function findPages() {
  const btn = $('#auto');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Looking…';
  const panel = $('#autopanel');
  panel.hidden = false;
  panel.innerHTML = '<p class="auto-status">Reading the sitemap…</p>';

  try {
    const t = await activeTab();
    const { origin, protocol } = new URL(t.url);
    if (!/^https?:$/.test(protocol)) throw new Error('Open the storefront first — there is nothing to discover from this page.');
    const urls = await discoverPages({
      origin,
      limit: 12,
      log: (m) => { panel.innerHTML = `<p class="auto-status">${esc(m.trim())}</p>`; },
    });
    if (!urls.length) throw new Error('Nothing found. The sitemap is missing and the homepage links nowhere crawlable — add pages by hand.');

    const already = new Set(collected.map((o) => o.url));
    proposed = urls.map((url) => ({
      url, surface: inferSurface(url), on: !already.has(url),
    }));
    renderProposal();
  } catch (err) {
    panel.innerHTML = `<p class="auto-status warn">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function renderProposal() {
  const panel = $('#autopanel');
  panel.hidden = false;
  panel.innerHTML = `
    <div class="auto-head">Found ${plural(proposed.length, 'page')} — untick any you do not want</div>
    <ul class="auto-list">
      ${proposed.map((p, i) => `<li>
        <label>
          <input type="checkbox" data-pick="${i}"${p.on ? ' checked' : ''}>
          <span class="surf">${esc(p.surface)}</span>
          <span class="u" title="${esc(p.url)}">${esc(shortUrl(p.url))}</span>
        </label></li>`).join('')}
    </ul>
    <p class="auto-note" id="autosum"></p>
    <div class="btn-row">
      <button id="collect" class="btn btn-main">Collect</button>
      <button id="cancelauto" class="btn">Cancel</button>
    </div>
    <p class="auto-note">Each page opens in a background tab, is measured, and the tab closes. Leave the window alone while it runs.</p>`;
  refreshProposal();
}

/**
 * Update only the parts a tick changes. Re-rendering the list instead would
 * replace the checkbox mid-click and drop focus, which makes ticking several
 * rows in a row feel broken.
 */
function refreshProposal() {
  const on = proposed.filter((p) => p.on);
  const counts = {};
  for (const p of on) counts[p.surface] = (counts[p.surface] || 0) + 1;
  const pairs = Object.entries(counts).filter(([, n]) => n >= 2);

  $('#autosum').innerHTML = pairs.length
    ? `${pairs.map(([s, n]) => `<b>${n} ${s.toUpperCase()}</b>`).join(', ')} — enough to compare.`
    : 'No two pages of the same type selected, so comparative checks will still skip.';
  const go = $('#collect');
  go.disabled = !on.length;
  go.textContent = on.length ? `Collect ${plural(on.length, 'page')}` : 'Nothing selected';
}

/**
 * Wait for a tab to finish a navigation we just started.
 *
 * The `loading` guard is not optional. `complete` can arrive for the page that
 * was ALREADY in the tab, before the new navigation has begun — without
 * requiring a `loading` first, the collector fires against the previous URL and
 * every page in the run is silently attributed to the wrong address.
 */
function waitForLoad(tabId, timeout = 25000) {
  return new Promise((resolve, reject) => {
    let started = false;
    const finish = (err) => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
      err ? reject(err) : resolve();
    };
    const onUpdated = (id, info) => {
      if (id !== tabId) return;
      if (info.status === 'loading') started = true;
      else if (info.status === 'complete' && started) finish(null);
    };
    const onRemoved = (id) => { if (id === tabId) finish(new Error('the collection tab was closed')); };
    const timer = setTimeout(() => finish(new Error('timed out loading')), timeout);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

/**
 * Chrome does not load `loading="lazy"` images in a tab that is never painted,
 * so a background collection would report no hero image on pages that plainly
 * have one. Flipping the attribute starts the fetch without scrolling, which
 * matters because scrolling would move the fold and the fold is measured.
 *
 * JS-driven lazy loaders (data-src, IntersectionObserver) are still out of
 * reach — `surfaceLimits()` says so rather than letting the gap pass as a
 * finding.
 */
function eagerImages() {
  for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
  return document.querySelectorAll('img').length;
}

async function collectProposed() {
  const targets = proposed.filter((p) => p.on);
  if (!targets.length) return;

  const panel = $('#autopanel');
  autoRun = { stop: false };
  let tabId = null;
  const failed = [];

  const paint = (i) => {
    panel.innerHTML = `
      <div class="auto-head">Collecting ${i + 1} of ${targets.length}</div>
      <ul class="auto-list">
        ${targets.map((p, n) => `<li class="prog ${n < i ? 'done' : n === i ? 'now' : ''}">
          <span class="tick">${n < i ? '✓' : n === i ? '›' : '·'}</span>
          <span class="surf">${esc(p.surface)}</span>
          <span class="u">${esc(shortUrl(p.url))}</span></li>`).join('')}
      </ul>
      <div class="btn-row"><button id="stopauto" class="btn">Stop</button></div>`;
  };

  try {
    // One reusable tab, opened on about:blank so that every page in the run is
    // reached by the same navigation path — and so only one tab ever appears.
    tabId = (await chrome.tabs.create({ url: 'about:blank', active: false })).id;

    for (let i = 0; i < targets.length; i++) {
      if (autoRun.stop) break;
      paint(i);
      const { url } = targets[i];
      try {
        const loaded = waitForLoad(tabId);
        await chrome.tabs.update(tabId, { url });
        await loaded;
        // Best effort — a strict CSP refuses this the same way it refuses the
        // collector, and an un-eager image is a smaller loss than a lost page.
        try {
          await chrome.scripting.executeScript({ target: { tabId }, func: eagerImages, world: 'MAIN' });
        } catch { /* CSP; the isolated-world collector still runs below */ }
        // Themes hydrate after load; measuring the pre-hydration DOM reports
        // drift that a visitor never sees.
        await new Promise((r) => setTimeout(r, 900));
        const obs = await grabTab(tabId, url);
        collected = collected.filter((o) => o.url !== obs.url).concat(obs);
        usedBackgroundTab = true;
      } catch (err) {
        failed.push(`${shortUrl(url)} — ${err.message}`);
      }
    }
  } catch (err) {
    failed.push(err.message);
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId); } catch { /* already gone */ } }
    autoRun = null;
  }

  panel.hidden = true;
  proposed = [];

  if (!collected.length) {
    out.innerHTML = `<div class="empty">Nothing could be collected.${failed.length ? ' ' + esc(failed[0]) : ''}</div>`;
    return;
  }
  try {
    await reanalyze(busy);
  } catch (err) {
    out.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    return;
  }
  if (failed.length) {
    $('#hint').innerHTML += ` <span class="warn">${plural(failed.length, 'page')} could not be read: ${esc(failed.join('; '))}</span>`;
  }
}

/** What the sidebar structurally cannot do, said once rather than implied. */
function surfaceLimits() {
  const bits = [];
  if (!siteSignals) bits.push('site-level signals (robots.txt, endpoints) were not read');
  bits.push('the crawler probe needs the CLI — a browser cannot set a User-Agent');
  if (usedBackgroundTab) bits.push('pages found automatically were read in a background tab, where script-driven lazy loading does not run');
  if (isolatedPages.size) bits.push(`${plural(isolatedPages.size, 'page')} blocked injected scripts, so the theme name and version could not be read — the measurements themselves are unaffected`);
  if (collected.length < 2) bits.push('comparative checks need a second page of the same type');
  return bits;
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
    ? 'Comparative checks — the ones that measure consistency <b>across</b> pages — need at least two pages of the same type. Browse to another product and hit <b>+ Add page</b>, or let <b>Find pages for me</b> pick a sample.'
    : pairs.length
      ? `Comparing ${pairs.map(([s, n]) => `<b>${n} ${s.toUpperCase()}</b>`).join(' and ')}. Add more of the same type for a sharper reading.`
      : `${collected.length} pages, but no two of the same type yet — comparative checks need <b>two PDPs</b> (or two PLPs) to compare. Add another of the same kind.`;
}

const shortUrl = (u) => { try { const x = new URL(u); return (x.pathname + x.search).slice(0, 44) || '/'; } catch { return u; } };

/**
 * A run is three or four network round-trips — the raw HTML, robots.txt,
 * llms.txt, the JSON endpoints — so several seconds of nothing is normal and
 * looked like the button had not registered. Name the step rather than spin:
 * a spinner says "wait", a step says "this is what it is waiting for", and on
 * a slow storefront that is the difference between patience and a second click.
 */
function busy(step) {
  out.innerHTML = `<div class="working">
    <div class="working-bar"><i></i></div>
    <p>${esc(step)}</p>
  </div>`;
}

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
  // Families the page loads from Google, keyed lower-case so a stack written
  // "playfair display" still matches the "Playfair Display" in the URL.
  const googleFonts = new Map(collected
    .flatMap((o) => o.engine?.googleFonts || [])
    .map((name) => [name.toLowerCase(), name]));
  const typ = t.typography;
  const maxSpace = Math.max(...t.spacing.steps, ...t.spacing.strays.map((s) => s.value), 1);

  out.innerHTML = scoreBlock() + `
  <h3>Brand colour <span>${plural(t.color.accents.length + (t.color.primary ? 1 : 0), 'token')}</span></h3>
  <div class="sw-row">
    ${t.color.primary ? `<div class="sw"><i style="background:${esc(t.color.primary)}"></i>${esc(t.color.primary)}<b>primary</b></div>` : '<div class="sw">none detected</div>'}
    ${t.color.accents.map((c) => `<div class="sw"><i style="background:${esc(c)}"></i>${esc(c)}</div>`).join('')}
  </div>
  <p class="legend">${t.color.primarySource === 'action'
    ? `Taken from the main action button${t.color.primaryIsNeutral ? ' — this brand is <b>monochrome</b>, and that is the answer, not a missing one' : ''}. Accents beside it are every other colour in the palette, which on a sale page usually includes the badge red.`
    : t.color.primary
      ? 'No primary action button was found, so this is the <b>most-used</b> colour on the page — which is a weaker claim. Collect a page with a clear call to action for a better reading.'
      : 'No brand colour could be measured on this page.'}</p>

  <h3>Neutral ramp <span>${plural(t.color.neutral.length, 'step')}</span></h3>
  <div class="sw-row">
    ${t.color.neutral.map((n) => `<div class="sw"><i style="background:${esc(n.hex)}"></i>${esc(n.hex)}<b>${esc(n.name)}</b></div>`).join('')}
  </div>
  ${t.color.contrastWarnings.map((w) => `<div class="note warn"><strong>${esc(w.pair)}</strong> is ${w.ratio}:1, needs ${w.required}:1. ${esc(w.note)}</div>`).join('')}

  <h3>Typefaces <span>${plural(typ.families.all.length, 'face')} in use</span></h3>
  ${typ.families.all.slice(0, 6).map((f) => {
    const fam = firstFamily(f.stack);
    const have = loadable.has(fam.toLowerCase());
    const google = googleFonts.get(fam.toLowerCase());
    // Prefer the captured webfont; fall back to the raw stack, which still
    // renders correctly for system faces.
    const ff = have ? `"EF ${esc(cssEscape(fam))}", ${esc(f.stack)}` : esc(f.stack);
    return `<div class="spec" data-family="${esc(fam)}" data-captured="${have}">
      <div class="name"><b>${esc(fam)}</b>${google
        ? `<a class="gf" href="https://fonts.google.com/specimen/${encodeURIComponent(google).replace(/%20/g, '+')}" target="_blank" rel="noreferrer">Google Fonts &#8599;</a>`
        : ''}<span>${plural(f.uses, 'use')}</span></div>
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

  ${current.skipped.length ? `<div class="note"><strong>${current.skipped.length} dimension${current.skipped.length === 1 ? '' : 's'} not measured</strong> — excluded from the score, not counted as passing: ${esc(current.skipped.map((s) => s.key).join(', '))}.</div>` : ''}
  <div class="note"><strong>What this surface cannot do.</strong> ${esc(surfaceLimits().join('; '))}.</div>`;

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

const findingRow = (f) => {
  const band = f.kind === 'strength' ? 'strength' : priorityBand(f.priority);
  return `<div class="f ${band}">
    <div class="p">${f.kind === 'strength' ? '&#10003;' : f.priority}</div>
    <div>
      <div class="t">${esc(f.title)}</div>
      <div class="r">${esc(f.recommendation)}</div>
      <div class="m"><span class="band">${esc(band)}</span> · ${esc(f.axis)} · impact ${f.impact} · ${esc(effortLabel(f.effort))} fix · ${esc(SURFACE_LABELS[f.surface] || f.surface)}</div>
    </div></div>`;
};

/**
 * What the site is actually running.
 *
 * The findings say what is wrong; this says what is THERE. An audit that
 * reports "the third-party script set differs across pages" without ever
 * naming the apps leaves the reader to go and look for themselves, which is
 * the work the tool was supposed to do. Facts, not findings — so nothing here
 * is scored or ranked.
 */
function enginePanel() {
  const engines = collected.map((o) => o.engine).filter(Boolean);
  if (!engines.length) return '';

  const apps = [...new Set(engines.flatMap((e) => e.apps || []))].sort();
  const hosts = [...new Set(engines.flatMap((e) => (e.scripts || [])
    .map((src) => { try { return new URL(src).hostname.replace(/^www\./, ''); } catch { return null; } })
    .filter(Boolean)))];
  // First-party scripts are not third-party weight; separating them is the
  // whole point of counting.
  let own = null;
  try { own = new URL(collected[0].url).hostname.replace(/^www\./, ''); } catch { /* unparseable */ }
  const thirdParty = hosts.filter((h) => h !== own);

  const avg = (pick) => {
    const vals = engines.map(pick).filter((n) => typeof n === 'number' && n > 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };
  const weight = avg((e) => e.transferBytes);
  const requests = avg((e) => e.requests);
  const sections = [...new Set(engines.flatMap((e) => e.sections || []))];
  const theme = engines.find((e) => e.theme)?.theme;

  // Per page, because "how many apps does this store run" is a different
  // question from "how many does this page load".
  const perPage = collected.map((o) => ({
    surface: o.surface,
    apps: (o.engine?.apps || []).length,
    scripts: (o.engine?.scripts || []).length,
  }));
  const maxScripts = Math.max(...perPage.map((p) => p.scripts), 1);

  return `<h3>What this store runs <span>facts, not findings</span></h3>
  <dl class="kv">
    <dt>Platform</dt><dd>${esc(PLATFORM_NAMES[current.platform] || current.platform || 'unrecognised')}${theme ? ` · theme <b>${esc(theme)}</b>` : ''}</dd>
    <dt>Apps detected</dt><dd>${apps.length ? apps.map((a) => `<span class="chip">${esc(a)}</span>`).join('') : 'none recognised'}</dd>
    <dt>Third-party hosts</dt><dd>${thirdParty.length}${thirdParty.length ? ` — ${esc(thirdParty.slice(0, 6).join(', '))}${thirdParty.length > 6 ? ` +${thirdParty.length - 6} more` : ''}` : ''}</dd>
    ${requests ? `<dt>Requests</dt><dd>${requests} average per page</dd>` : ''}
    ${weight ? `<dt>Transferred</dt><dd>${(weight / 1024).toFixed(0)} KB average per page</dd>` : ''}
    ${sections.length ? `<dt>Theme sections</dt><dd>${sections.length} distinct</dd>` : ''}
  </dl>
  ${maxScripts > 1 ? `<div class="eng-bars">${perPage.map((p) => `<div class="eng-row">
    <span class="k">${esc(p.surface)}</span>
    <span class="track"><i style="width:${Math.max(2, (p.scripts / maxScripts) * 100)}%"></i></span>
    <span class="v">${p.scripts}</span>
  </div>`).join('')}</div>
  <p class="legend">Scripts per page. A set that differs from page to page is drift; the finding for it is in the list below.</p>` : ''}
  <p class="legend">App names come from known vendor URLs, so an unrecognised app is not counted — absence here means <b>not recognised</b>, never "not present".</p>`;
}

const sectionFor = (label, brief, list) => {
  if (!list.length) return '';
  const critical = list.filter((f) => f.kind !== 'strength' && priorityBand(f.priority) === 'critical').length;
  return `<h3>${esc(label)} <span>${list.length}${critical ? ` · ${critical} critical` : ''}</span></h3>
    ${brief ? `<p class="legend">${esc(brief)}</p>` : ''}
    ${list.map(findingRow).join('')}`;
};

/**
 * One pile, three groupings.
 *
 * Owner answers "is this mine", axis answers "what kind of problem is this",
 * and machine readability answers "can an answer engine or a shopping agent
 * use this store" — the question the Engine axis buried, because a missing
 * meta description and a heavy third-party script set are both Engine and are
 * nothing like each other.
 *
 * A switch rather than extra sections: a finding appearing twice on one screen
 * is the copying the wiki model exists to avoid, and in a panel with no links
 * there is nothing to link it back to.
 */
function renderFindings() {
  const fs = current.findings;
  if (!fs.length) { out.innerHTML = scoreBlock() + '<div class="empty">Nothing found at this scope.</div>'; return; }

  const geoCount = fs.filter(isGeoFinding).length;
  const tabs = [['owner', 'By owner'], ['axis', 'By axis'], ['geo', `Machine readability${geoCount ? ` · ${geoCount}` : ''}`]];

  let sections;
  if (grouping === 'owner') {
    sections = OWNERS.map((o) =>
      sectionFor(OWNER_LABELS[o], OWNER_BRIEF[o], fs.filter((f) => f.owner === o))).join('');
  } else if (grouping === 'axis') {
    sections = current.axes.map((a) =>
      sectionFor(AXIS_LABELS[a], '', fs.filter((f) => f.axis === a))).join('');
  } else {
    const geo = fs.filter(isGeoFinding);
    sections = geo.length
      ? `<p class="legend">What an answer engine, a crawler or a shopping agent can read. These findings also sit on the Engine axis — this is the same record asked a different question, and it carries no score of its own. Retrievable is not cited: nothing here predicts traffic or rankings.</p>
         ${GEO_GROUPS.map((g) => sectionFor(GEO_GROUP_LABELS[g], GEO_GROUP_BRIEF[g],
           geo.filter((f) => geoGroupFor(f.checkId) === g))).join('')}`
      : '<div class="empty">No machine-readability findings — run the Engine axis to measure it.</div>';
  }

  out.innerHTML = scoreBlock() + enginePanel()
    + `<div class="ovbtns group">${tabs.map(([k, label]) =>
        `<button class="btn ${grouping === k ? 'on' : ''}" data-group="${k}">${esc(label)}</button>`).join('')}</div>`
    + sections;
}

/**
 * What the grid detection actually found, with its evidence.
 *
 * A column count with no confidence attached is the same guess the menu was,
 * just wearing a measurement's clothes. The coverage figure is what licenses
 * the claim, and a page that gives no evidence has to say so rather than
 * fall back to 12 quietly.
 */
function gridReadout(detected, explicit) {
  if (!overlayInfo) return '';
  const pageGrid = overlayInfo.grid?.pageGrid || null;
  // Grids narrower than the content column are components laid out inside the
  // page, not the page's own grid.
  const components = explicit.filter((e) => e !== pageGrid && e.span < 0.9);
  const parts = [];

  if (detected) {
    parts.push(`<b>${detected.columns} columns</b>${detected.gutter ? ` · <b>${detected.gutter}px</b> gutter` : ' · no gutter'}
      — ${Math.round(detected.coverage * 100)}% of element edges sit on it${detected.residual < 1 ? ', to within a pixel' : ''}.`);
  } else if (pageGrid) {
    // "No layout grid found" next to a list of CSS grids reads as a
    // contradiction, and it was one: the page plainly has grids. What it does
    // not have is a single system every element is placed against.
    parts.push(`<b>${pageGrid.columns} columns</b>, read from the CSS grid that spans the content column.
      No single page-wide system underneath it — this page is composed from grids rather than placed on one, which is normal for a collection page.`);
  } else {
    parts.push('<b>No column system found.</b> No CSS grid spans the content column, and not enough element edges line up on any regular one — which is itself the finding.');
  }

  if (components.length) {
    parts.push(`Inside it: ${components.map((e) => `<b>${e.columns}-up</b>${e.uses > 1 ? ` ×${e.uses}` : ''}`).join(', ')}.`);
  }
  // A coarse grid is all that is provable when nothing spans an odd number of
  // its columns — a finer one would be structure the page never demonstrates.
  if (detected && detected.columns <= 6 && !pageGrid) {
    parts.push('A finer grid may be intended; nothing on this page spans an odd number of these columns, so nothing here can show it.');
  }
  return `<p class="legend grid-read">${parts.join(' ')}</p>`;
}

function renderStructure() {
  const last = collected[collected.length - 1];
  const sections = last?.layout ? sectionSkeleton(last.layout) : [];
  const nodes = last?.layout ? flattenLayout(last.layout) : [];
  const cols = [...new Set(nodes.map((n) => n.cols).filter(Boolean))].sort((a, b) => a - b);

  // Detected first. The counts on offer are an OVERRIDE, for checking the page
  // against a grid you already know it is meant to be on — not the way you
  // find out what grid it uses, which is the overlay's job.
  const detected = overlayInfo?.grid?.inferred || null;
  const explicit = overlayInfo?.grid?.explicit || [];
  const choices = [...new Set([
    ...(detected ? [detected.columns] : []),
    ...explicit.map((e) => e.columns),
    12, ...cols.filter((c) => c >= 2 && c <= 24),
  ])].filter((c) => c >= 2 && c <= 24).sort((a, b) => a - b);

  out.innerHTML = `
  <div class="ovbtns">
    ${['sections', 'all', 'columns', 'off'].map((m) => `<button class="btn ${overlayMode === m ? 'on' : ''}" data-ov="${m}">${m === 'all' ? 'All boxes' : m[0].toUpperCase() + m.slice(1)}</button>`).join('')}
  </div>
  ${overlayMode === 'columns' ? `<div class="ovbtns cols">
    <button class="btn ${overlayCols === null ? 'on' : ''}" data-cols="auto" title="Measure the grid from the page">Detected</button>
    ${choices.map((c) => `<button class="btn ${overlayCols === c ? 'on' : ''}" data-cols="${c}">${c}</button>`).join('')}
  </div>` : ''}
  ${overlayMode === 'columns' ? gridReadout(detected, explicit) : ''}
  <p class="legend">Draws on the live page — scroll the site with it on.${overlayMode === 'columns' && overlayInfo
    ? overlayInfo.container?.measured
      ? ` Measured on the <b>${Math.round(overlayInfo.container.width)}px</b> content column, not the window.`
      : ' <b>No repeating content container</b> — this page is full-bleed, so the grid falls back to the viewport.'
    : ''}</p>

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

/**
 * The bottom sheet.
 *
 * Sending an audit finishes somewhere else — in a conversation, in another
 * app. A line of text under the buttons is the wrong place to say so: it sits
 * where the panel puts hints about page collection, and it was being missed.
 * The sheet interrupts, says what happened, and gives the sentence to say
 * next, because "it worked" is not the useful part — "go and ask this" is.
 */
function showSheet(title, bodyHtml) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = bodyHtml;
  $('#scrim').hidden = false;
  $('#sheet').hidden = false;
  $('#sheet-close').focus();
}

function closeSheet() {
  $('#sheet').hidden = true;
  $('#scrim').hidden = true;
}

/** A question worth asking, that copies itself when clicked. */
const askButton = (text) => `<button class="ask" data-ask="${esc(text)}">${esc(text)}</button>`;

$('#sheet-close').addEventListener('click', closeSheet);
$('#scrim').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

$('#sheet-body').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ask]');
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.ask);
    const was = b.textContent;
    b.classList.add('copied');
    b.textContent = `${was}   — copied`;
    setTimeout(() => { b.textContent = was; b.classList.remove('copied'); }, 1600);
  } catch { /* clipboard blocked; the text is on screen to read anyway */ }
});

/** Ports the MCP server's ingest listener tries, in the same order. */
const INGEST_PORTS = [8787, 8788, 8789, 8790];

/**
 * Push the audit straight into the running MCP server.
 *
 * The extension still cannot speak MCP — that is a stdio process its client
 * launches — but it does not need to. The server opens a small loopback
 * listener whose only job is to RECEIVE an audit, and this posts to it. The
 * server writes the bundle into its own audit folder and every existing tool
 * finds it.
 *
 * Returns null when nothing is listening, which is the normal case if Claude
 * is not running or the MCP server is not configured. The caller falls back
 * to saving a file rather than failing.
 */
async function pushToServer(analysis) {
  for (const port of INGEST_PORTS) {
    const base = `http://127.0.0.1:${port}`;
    try {
      // Identify the service before posting an audit at it. Something else may
      // well own this port, and it should not receive a few megabytes of JSON.
      const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(400) });
      if (!health.ok) continue;
      const who = await health.json();
      if (who?.service !== 'echoflow-ingest') continue;

      const res = await fetch(`${base}/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-echoflow-ingest': '1' },
        body: JSON.stringify(analysis),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `server said ${res.status}`);
      return await res.json();
    } catch (err) {
      // A closed port is not an error worth reporting; a server that answered
      // and then refused is.
      if (err?.name === 'TimeoutError' || err instanceof TypeError) continue;
      throw err;
    }
  }
  return null;
}

/**
 * Hand the audit to Claude.
 *
 * Two routes, and the first one is the point: if the MCP server is running,
 * the audit goes straight to it over loopback and nobody downloads anything.
 * Saving files was the first attempt at this and had it backwards — the whole
 * value of handing an audit to Claude is that it does not have to be filed
 * first. That path survives only as the fallback for when the server is not
 * there.
 */
async function sendToClaude() {
  if (!current) return;
  const btn = $('#send');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    const pushed = await pushToServer(current);
    if (pushed) {
      btn.textContent = 'Sent ✓';
      showSheet('Sent to Claude', `
        <p><b>${esc(pushed.site)}</b> — ${pushed.findings} findings${typeof pushed.score === 'number' ? `, scoring ${pushed.score}/100` : ''}.
        It went straight to the MCP server on this machine. Nothing was downloaded.</p>
        <div class="step"><span class="n">1</span><span>Switch to Claude — the app or the terminal, wherever the EchoFlow MCP server is configured.</span></div>
        <div class="step"><span class="n">2</span><span>In any conversation, ask:</span></div>
        ${askButton('Look at my latest EchoFlow audit')}
        <div class="more">
          <div class="lbl">Then, for example</div>
          ${askButton('What should I fix first, and who owns it?')}
          ${askButton('What can a machine not read on this store?')}
          ${askButton('Show me the marketing findings')}
          ${askButton('Give me the design tokens as CSS')}
        </div>
        <p style="margin-top:12px">Click any of those to copy it. This does not reach claude.ai in a browser —
        the audit is on <b>this machine</b>, and only a Claude that runs here can read it.</p>`);
      return;
    }
    btn.textContent = 'Saving…';
    const files = buildBundle(current);
    const site = current.site.replace(/[^a-z0-9.-]/gi, '-');
    const stamp = new Date().toISOString().slice(0, 10);
    const dir = `echoflow/${site}-${stamp}`;

    // Only what the MCP tools actually read: the analysis, and a layout per
    // surface for echoflow_structure. The rest of the bundle is for people and
    // belongs in the zip.
    const wanted = Object.keys(files).filter((p) =>
      p === 'report/data/analysis.json' || /^report\/data\/layout-.*\.json$/.test(p));

    let firstId = null;
    for (const path of wanted) {
      const rel = path.replace(/^report\//, '');
      const url = URL.createObjectURL(new Blob([files[path]], { type: 'application/json' }));
      const id = await chrome.downloads.download({
        url,
        filename: `${dir}/${rel}`,
        // Re-running the same day must overwrite, not become "analysis (1).json"
        // — a uniquified name is a path the pasted line no longer points at.
        conflictAction: 'overwrite',
        saveAs: false,
      });
      firstId = firstId ?? id;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    // Chrome knows the absolute path; the panel does not, and guessing at
    // someone's home directory is how a pasted path fails on one machine in
    // three.
    const absolute = await bundleDir(firstId);
    const line = absolute
      ? `Read my EchoFlow audit at ${absolute} — use echoflow_findings, echoflow_tokens and echoflow_retrieval on that path.`
      : `Read my EchoFlow audit — it is the newest folder under Downloads/${dir}. Use echoflow_findings on it.`;
    await navigator.clipboard.writeText(line);

    btn.textContent = 'Saved ✓';
    showSheet('Saved — the MCP server is not running', `
      <p>Nothing was listening on this machine, so the audit was written to disk instead:
      <code>${esc(absolute || 'Downloads/' + dir)}</code></p>
      <div class="step"><span class="n">1</span><span>Open Claude and paste this — it is already on your clipboard:</span></div>
      ${askButton(line)}
      <div class="step"><span class="n">2</span><span>Or attach <code>data/analysis.json</code> from that folder to a conversation on claude.ai.</span></div>
      <p style="margin-top:12px">Start Claude with the <b>EchoFlow MCP server</b> configured and this button
      sends the audit directly next time, with no file and no path to paste.</p>`);
  } catch (err) {
    $('#hint').innerHTML = `<span class="warn">${esc(err.message)}</span>`;
    btn.textContent = label;
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = label; }, 2600);
  }
}

/** The directory Chrome actually wrote to, from the download record. */
async function bundleDir(id) {
  if (id == null) return null;
  try {
    const [item] = await chrome.downloads.search({ id });
    if (!item?.filename) return null;
    // filename is the absolute path of data/analysis.json; the bundle root is
    // two levels up, which is what the MCP tools want.
    //
    // Only claim a path when the shape is actually there. A non-matching
    // replace() returns the string unchanged, which would have handed back the
    // FILE path labelled as the bundle directory — and anything downstream
    // would then look for data/analysis.json inside a .json file.
    const m = /^(.*)[\\/]data[\\/][^\\/]+$/.exec(item.filename);
    return m ? m[1] : null;
  } catch { return null; }
}

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
$('#auto').addEventListener('click', findPages);

$('#autopanel').addEventListener('click', (e) => {
  if (e.target.id === 'collect') collectProposed();
  else if (e.target.id === 'cancelauto') { proposed = []; $('#autopanel').hidden = true; }
  else if (e.target.id === 'stopauto') {
    if (autoRun) autoRun.stop = true;
    e.target.disabled = true;
    e.target.textContent = 'Stopping…';
  }
});

$('#autopanel').addEventListener('change', (e) => {
  const box = e.target.closest('[data-pick]');
  if (!box) return;
  proposed[+box.dataset.pick].on = box.checked;
  refreshProposal();
});

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
  reanalyze().catch((err) => { out.innerHTML = `<div class="empty">${esc(err.message)}</div>`; });
});

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  render();
});

out.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-group]');
  if (!b) return;
  grouping = b.dataset.group;
  renderFindings();
});

out.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-ov], button[data-cols]');
  if (!b) return;
  if (b.dataset.cols) overlayCols = b.dataset.cols === 'auto' ? null : +b.dataset.cols;
  else overlayMode = b.dataset.ov;
  await drawOverlay();
  renderStructure();
});

/**
 * ISOLATED, not MAIN. The overlay only appends elements and reads computed
 * styles, so it has no use for page globals — and a MAIN-world injection is
 * subject to the page's CSP, which on a strict storefront means the buttons
 * would do nothing at all with no error to explain it.
 */
async function drawOverlay() {
  const t = await activeTab();
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: t.id }, func: toggleOverlay,
      args: [overlayMode, overlayCols], world: 'ISOLATED',
    });
    overlayInfo = res?.result ?? null;
  } catch {
    overlayInfo = null;
  }
}

$('#export').addEventListener('click', exportBundle);
$('#send').addEventListener('click', sendToClaude);

activeTab().then((t) => { try { $('#host').textContent = new URL(t.url).hostname; } catch { /* chrome:// */ } });

// The running build, stated by the build itself.
//
// "Is my extension actually updated?" was answered by walking to
// chrome://extensions and reading a card, which is far enough away that a
// stale load went unnoticed for several releases. The panel knows its own
// version; there is no reason to make anyone go and look it up.
try { $('#ver').textContent = chrome.runtime.getManifest().version; } catch { /* not in an extension */ }
