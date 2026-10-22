#!/usr/bin/env node
/**
 * Does the PACKAGED extension actually work?
 *
 *   node scripts/package-extension.js && node test/extension.mjs
 *
 * Everything else in the suite tests `core/` as Node modules. That cannot catch
 * the failures that only exist once the thing is a Chrome extension: a stale
 * `extension/core/` copy, an import that resolves on disk but not from an
 * extension origin, a manifest that names a file nobody shipped, a binary
 * mangled by the zip writer. Those are exactly the failures someone hits on
 * THEIR machine after you hand them a zip, and they are silent until then —
 * a packaged extension that lost its icon still loads.
 *
 * So this loads the built artefact in a real Chromium, reads the manifest back
 * from Chrome rather than from disk, and drives a full collect → analyse →
 * export inside the side panel's own document.
 *
 * Skips cleanly when there is no Chromium or no build.
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startIngest } from '../mcp/ingest.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const EXT = resolve(root, 'extension');

let pass = 0, fail = 0;
const check = (cond, msg) => {
  if (cond) { pass++; console.log(`  ok    ${msg}`); }
  else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}`); }
};

let chromium;
try { ({ chromium } = await import('../analyzer/node_modules/playwright-core/index.mjs')); }
catch { console.log('  skipped — playwright-core is not installed\n'); process.exit(0); }

if (!existsSync(join(EXT, 'core/analyze.js'))) {
  console.log('  skipped — run `node scripts/sync-core.js` first\n');
  process.exit(0);
}

// Serve the fixture storefront.
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.txt': 'text/plain' };
const fixtures = resolve(here, 'fixture-site');
const brandFixtures = resolve(here, 'fixture-brand');
const server = createServer(async (req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const isBrand = rel.startsWith('/brand/');
  const base = isBrand ? brandFixtures : fixtures;
  const path = resolve(base, '.' + (isBrand ? rel.slice(6) : rel));
  if (!path.startsWith(base)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

let ctx;
try {
  ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'echoflow-')), {
    executablePath: process.env.ECHOFLOW_CHROMIUM || undefined,
    headless: true,
    args: [
      ...(process.env.ECHOFLOW_NO_SANDBOX ? ['--no-sandbox'] : []),
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
    ],
  });
} catch (e) {
  console.log(`  skipped — no Chromium (${e.message.split('\n')[0]})\n`);
  server.close();
  process.exit(0);
}

// Chrome's red "Errors" button on chrome://extensions reports whatever ANY of
// the extension's contexts logged — the service worker and every page it runs
// in, not just the side panel. This suite watched the panel alone, so a worker
// that threw on install, or an injection that failed on a real storefront,
// could ship with every assertion green and a red button on the user's screen.
const contextErrors = [];
// Discovery probes URLs that may not exist, and a fixture page may reference an
// asset it does not ship. Both are data about the page, not faults in the tool.
const benign = (t) => /404|Failed to load resource|net::ERR_/.test(t);
const watch = (where, target) => {
  target.on('console', (m) => {
    if (m.type() === 'error' && !benign(m.text())) contextErrors.push(`${where}: ${m.text()}`);
  });
  target.on('pageerror', (e) => contextErrors.push(`${where}: ${e.message}`));
};
ctx.on('serviceworker', (w) => watch('service worker', w));
for (const w of ctx.serviceWorkers()) watch('service worker', w);
ctx.on('page', (p) => watch(`page ${p.url().slice(0, 48) || 'about:blank'}`, p));

console.log('\n  packaged extension\n');

// --- does Chrome accept it at all? -----------------------------------------
const sw = ctx.serviceWorkers()[0]
  || await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null);
check(!!sw, 'the MV3 service worker registers');
if (!sw) { await ctx.close(); server.close(); process.exit(1); }

const extId = new URL(sw.url()).host;
// Read the manifest back from CHROME, not from disk — that is the copy that
// decides whether the thing runs on someone else's machine.
const mf = await sw.evaluate(() => chrome.runtime.getManifest());
const onDisk = JSON.parse(await readFile(join(EXT, 'manifest.json'), 'utf8'));
check(mf.manifest_version === 3, `manifest v3 (${mf.manifest_version})`);
check(mf.version === onDisk.version, `Chrome loaded version ${mf.version}`);
check(!!mf.side_panel?.default_path, 'a side panel is declared');

// The icon survived packaging. A packaged extension that lost its icon still
// loads, so nothing else would ever tell you.
const iconOk = await sw.evaluate(async (path) => {
  const res = await fetch(chrome.runtime.getURL(path));
  const buf = new Uint8Array(await res.arrayBuffer());
  // PNG magic number: a UTF-8 round trip corrupts byte 0 and this catches it.
  return res.ok && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}, mf.icons['128']);
check(iconOk, 'the icon is still a valid PNG after packaging');

// --- does the side panel come up? ------------------------------------------
const panel = await ctx.newPage();
const hard = [];
panel.on('pageerror', (e) => hard.push(e.message));
panel.on('console', (m) => {
  // Discovery's own liveness probes 404 by design; that is data, not a fault.
  if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) hard.push(m.text());
});
await panel.goto(`chrome-extension://${extId}/ui/sidepanel.html`, { waitUntil: 'load' });
await panel.waitForTimeout(800);

const ui = await panel.evaluate(() => ({
  controls: [...document.querySelectorAll('button[id]')].map((b) => b.id),
  styled: getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)',
  version: document.querySelector('#ver')?.textContent.trim(),
}));
check(ui.styled, 'the stylesheet loads from the extension origin');
// A stale load went unnoticed for several releases because the only place the
// version appeared was a card in chrome://extensions.
check(ui.version === mf.version,
  `the sidebar states the build it is running (${ui.version})`);
for (const id of ['scan', 'add', 'auto', 'export', 'send']) {
  check(ui.controls.includes(id), `the ${id} control is present`);
}

// The axes are styled buttons now, but the inputs underneath are still real
// checkboxes — the styling is paint, not a replacement. If that ever stops
// being true, the control looks the same and silently stops working.
{
  const axes = await panel.evaluate(() => ({
    inputs: document.querySelectorAll('#axes input[type="checkbox"]').length,
    focusable: [...document.querySelectorAll('#axes input')].every((i) => i.tabIndex >= 0),
    allOn: [...document.querySelectorAll('#axes input:checked')].length,
  }));
  check(axes.inputs === 3, `three real checkboxes underneath (${axes.inputs})`);
  check(axes.focusable, 'still reachable by keyboard');
  check(axes.allOn === 3, 'all three on by default');

  await panel.click('#axes .axis:nth-child(2) span');
  await panel.waitForTimeout(150);
  const after = await panel.evaluate(() =>
    [...document.querySelectorAll('#axes input:checked')].map((i) => i.value));
  check(after.join() === 'design,engine', `clicking one toggles it (${after.join(', ')})`);
  await panel.click('#axes .axis:nth-child(2) span');
  await panel.waitForTimeout(150);
  check(await panel.evaluate(() => document.querySelectorAll('#axes input:checked').length) === 3,
    'and back on again');
}
check(hard.length === 0, `the panel module graph evaluates without errors${hard.length ? ': ' + hard[0] : ''}`);

// --- a real run, through the packaged core ---------------------------------
for (const path of ['/products/a.html', '/products/b.html']) {
  const p = await ctx.newPage();
  await p.goto(origin + path, { waitUntil: 'load' });
}

const run = await panel.evaluate(async (base) => {
  const { collectFromDocument } = await import('../core/collect-dom.js');
  const { analyze } = await import('../core/analyze.js');
  const { inferSurface } = await import('../core/observation.js');
  const { buildBundle } = await import('../core/wiki/bundle.js');
  const { compareStatic, fetchRobots } = await import('../core/fetch-signals.js');
  const { discoverPages } = await import('../core/discover.js');

  const tabs = await chrome.tabs.query({ url: base + '/*' });
  const observations = [];
  for (const t of tabs) {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: t.id }, func: collectFromDocument,
      args: [{ surface: inferSurface(t.url), viewportLabel: 'desktop' }], world: 'MAIN',
    });
    if (!r?.result) continue;
    r.result.retrieval.static = await compareStatic(t.url, r.result.retrieval);
    observations.push(r.result);
  }
  const robots = await fetchRobots(base);
  const discovered = await discoverPages({ origin: base, limit: 8 });
  const a = analyze({
    observations, axes: ['design', 'ux', 'engine'], site: 'fixture',
    siteSignals: { robots, origin: base },
  });
  const files = buildBundle(a);
  // Kept for the black-and-white check below, so that test re-renders the
  // bundle rather than re-collecting the site. Test scaffolding: nothing in
  // the extension itself puts an analysis on window.
  window.__efLast = a;
  return {
    pages: observations.length,
    staticFetched: observations.every((o) => o.retrieval.static?.fetched),
    score: a.consistency.overall,
    findings: a.findings.length,
    discovered: discovered.length,
    robots: !!robots,
    hasStart: !!files['START HERE.html'],
    hasGeo: !!files['report/site/geo.html'],
  };
}, origin);

check(run.pages === 2, `the collector reads real pages through the extension (${run.pages})`);
check(run.staticFetched, 'the un-rendered HTML is fetched, so parity and answerability can run');
check(typeof run.score === 'number', `the analysis produces a score (${run.score})`);
check(run.findings > 0, `and findings (${run.findings})`);
check(run.robots, 'robots.txt is read from the extension origin');
check(run.discovered > 0, `automatic discovery finds pages (${run.discovered})`);
check(run.hasStart && run.hasGeo, 'the export builds a complete bundle');

// --- black and white -------------------------------------------------------
// One choice, two surfaces: it repaints the panel and it is what the exported
// bundle is rendered in. Tested in the panel's own document because the
// specificity of an attribute override against two prefers-color-scheme blocks
// is exactly the kind of thing that reads correct and computes wrong.
const uiStart = await panel.evaluate(() => ({
  exists: !!document.querySelector('#uimode button[data-ui="mono"]'),
  buttons: document.querySelectorAll('#uimode button').length,
  attr: document.documentElement.dataset.ui || null,
  pressed: document.querySelector('#uimode button[aria-pressed="true"]')?.dataset.ui || null,
}));
check(uiStart.exists && uiStart.buttons === 2, `a colour/B&W switch, two buttons (${uiStart.buttons})`);
check(uiStart.attr === 'colour' && uiStart.pressed === 'colour', 'colour by default, and it says so');

const monoPanel = await panel.evaluate(async () => {
  const before = getComputedStyle(document.documentElement).getPropertyValue('--critical').trim();
  document.querySelector('#uimode button[data-ui="mono"]').click();
  await new Promise((r) => setTimeout(r, 60));
  const cs = getComputedStyle(document.documentElement);
  const stored = await chrome.storage.local.get('uiMode').catch(() => ({}));
  return {
    attr: document.documentElement.dataset.ui,
    pressed: document.querySelector('#uimode button[aria-pressed="true"]')?.dataset.ui,
    before,
    after: cs.getPropertyValue('--critical').trim(),
    accent: cs.getPropertyValue('--accent').trim(),
    ink: cs.getPropertyValue('--ink').trim(),
    stored: stored?.uiMode || null,
  };
});
check(monoPanel.attr === 'mono' && monoPanel.pressed === 'mono', 'clicking B&W switches the panel');
check(monoPanel.before !== monoPanel.after,
  `and the severity colour really changes (${monoPanel.before} to ${monoPanel.after})`);
check(monoPanel.after === monoPanel.ink && monoPanel.accent === monoPanel.ink,
  `severity and accent collapse onto ink (${monoPanel.ink})`);
// Black and white means the ground too. Overriding only the severity tokens
// left the warm paper theme underneath, which is a warm wash, not B&W.
const ground = await panel.evaluate(() => {
  const bg = getComputedStyle(document.body).backgroundColor;
  const [r, g, b] = bg.match(/\d+/g).map(Number);
  return { bg, pure: (r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255), grey: r === g && g === b };
});
check(ground.grey && ground.pure, `the panel's ground is pure white or black (${ground.bg})`);
check(monoPanel.stored === 'mono', 'the choice is stored, so it survives the panel closing');

// The export has to follow the switch — that is the whole point of putting it
// in the panel rather than in the report.
const monoExport = await panel.evaluate(async () => {
  const { buildBundle } = await import('../core/wiki/bundle.js');
  const a = window.__efLast;
  if (!a) return { skipped: true };
  const files = buildBundle(a, { ui: 'mono' });
  const pages = Object.keys(files).filter((k) => k.endsWith('.html'));
  return {
    pages: pages.length,
    allMarked: pages.every((k) => /<html[^>]*data-ui="mono"/.test(files[k])),
  };
});
check(monoExport.skipped || (monoExport.pages > 0 && monoExport.allMarked),
  monoExport.skipped ? 'export follows the switch (no analysis retained to re-export)'
    : `every page of a B&W export is marked (${monoExport.pages})`);

// Back to colour, so nothing downstream in this run inherits the mode.
await panel.evaluate(() => document.querySelector('#uimode button[data-ui="colour"]').click());

// --- Send to Claude ---------------------------------------------------------
//
// Two routes, and the first is the point: with the MCP server running the audit
// goes straight to it over loopback and nothing is downloaded. Saving files is
// only the fallback for when the server is not there.
//
// Playwright rewrites every download target to a GUID in its own directory, so
// the fallback's PATH cannot be asserted here. Its CONTENTS can, and that is
// what the MCP tools actually read.
{
  // Drive the real buttons first. The run above imported core/ into the page
  // and analysed there, which leaves the PANEL's own state empty — sendToClaude
  // returns immediately with nothing to send. The button has to be exercised
  // the way a person exercises it.
  const tabIds = await panel.evaluate(async (base) =>
    (await chrome.tabs.query({ url: base + '/*' })).map((t) => t.id), origin);
  await panel.evaluate((id) => chrome.tabs.update(id, { active: true }), tabIds[0]);
  await panel.click('#scan');
  await panel.waitForTimeout(2500);
  await panel.evaluate((id) => chrome.tabs.update(id, { active: true }), tabIds[1]);
  await panel.click('#add');
  await panel.waitForTimeout(2500);
  const collected = await panel.evaluate(() => +document.querySelector('#pagecount').textContent);
  check(collected === 2, `the panel collected both pages through its own buttons (${collected})`);

  // Route 1: a listener is running. This is the case that must not download.
  const received = [];
  const ingest = await startIngest({ onAudit: async (a) => { received.push(a); return '/audits/' + a.site; } });
  check(!!ingest, 'the ingest listener starts');

  const pushed = await panel.evaluate(async () => {
    const before = (await chrome.downloads.search({ limit: 100 })).length;
    document.querySelector('#send').click();
    await new Promise((r) => setTimeout(r, 4000));
    return {
      hint: document.querySelector('#hint').textContent,
      sheetOpen: !document.querySelector('#sheet').hidden,
      sheetTitle: document.querySelector('#sheet-title').textContent,
      asks: [...document.querySelectorAll('[data-ask]')].map((b) => b.dataset.ask),
      downloadsAdded: (await chrome.downloads.search({ limit: 100 })).length - before,
    };
  });
  check(received.length === 1, `the audit reaches the server (${received.length})`);
  check(received[0] && typeof received[0].consistency?.overall === 'number'
    && received[0].findings?.length > 0,
    'complete, with its score and findings');
  check(received[0]?.observations?.length === 2,
    'and its observations, so the server can build layouts from it');
  check(pushed.downloadsAdded === 0, `nothing was downloaded (${pushed.downloadsAdded} new files)`);

  // Sending finishes somewhere else, so the panel has to say what to do next
  // rather than leave a line of text under the buttons to be missed.
  check(pushed.sheetOpen, 'a sheet opens to say what happened');
  check(/sent to claude/i.test(pushed.sheetTitle), `and names the outcome ("${pushed.sheetTitle}")`);
  check(pushed.asks.includes('Look at my latest EchoFlow audit'),
    'and gives the exact sentence to ask Claude');
  check(pushed.asks.length >= 3, `plus follow-ups worth asking (${pushed.asks.length})`);

  await panel.evaluate(() => document.querySelector('#sheet-close').click());
  check(await panel.evaluate(() => document.querySelector('#sheet').hidden), 'and it closes');

  await ingest.close();

  // Route 2: no listener. It must fall back rather than fail.
  const written = await panel.evaluate(async () => {
    const before = (await chrome.downloads.search({ limit: 100 })).length;
    document.querySelector('#send').click();
    for (let i = 0; i < 40 && (await chrome.downloads.search({ limit: 100 })).length === before; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 1200));
    const items = await chrome.downloads.search({ limit: 100 });
    return items.filter((i) => i.state === 'complete').map((i) => i.filename);
  });
  check(written.length >= 2, `with no server it falls back to files (${written.length})`);

  let analysis = null, layout = null;
  for (const f of written) {
    try {
      const j = JSON.parse(await readFile(f, 'utf8'));
      if (j.consistency && j.findings) analysis = j;
      else if (j.sections && j.viewport) layout = j;
    } catch { /* not one of ours */ }
  }
  check(!!analysis, 'one of them is a complete analysis the MCP can load');
  check(analysis && typeof analysis.consistency?.overall === 'number'
    && Array.isArray(analysis.findings) && analysis.findings.length > 0,
    'carrying a score and findings, not an empty shell');
  check(!!layout, 'and a layout, so echoflow_structure has something to read');

  const fell = await panel.evaluate(() => ({
    open: !document.querySelector('#sheet').hidden,
    title: document.querySelector('#sheet-title').textContent,
    asks: [...document.querySelectorAll('[data-ask]')].map((b) => b.dataset.ask),
  }));
  check(fell.open, 'the fallback opens a sheet too');
  check(/not running/i.test(fell.title), `explaining why it saved rather than sent ("${fell.title}")`);
  // Two legitimate wordings: one naming the absolute path when Chrome gives a
  // usable one, one naming the folder when it does not. Playwright renames
  // every download to a GUID, so the harness always sees the second.
  check(fell.asks.some((a) => /Read my EchoFlow audit/.test(a)),
    'and offers the line to paste');

  // Leave the panel usable for what follows: an open sheet covers the page and
  // swallows every later click.
  await panel.evaluate(() => document.querySelector('#sheet-close').click());
}

// --- the score breakdown folds away -----------------------------------------
//
// Fifteen group rows under the headline pushed the rest of the review off the
// screen. Collapsed by default, with the weakest group on the summary line so
// folding it never hides the one number that would make you open it.
{
  const collapsed = await panel.evaluate(() => {
    const d = document.querySelector('.bd-wrap');
    const row = document.querySelector('.bd-row');
    return {
      present: !!d,
      open: d?.open,
      // checkVisibility() is the test that works inside a closed <details>;
      // offsetParent stays non-null there and reports rows as visible.
      rowVisible: row ? row.checkVisibility() : null,
      summary: d?.querySelector('summary')?.textContent.replace(/\s+/g, ' ').trim(),
    };
  });
  check(collapsed.present, 'the breakdown is a disclosure, not a wall of rows');
  check(collapsed.open === false, 'closed by default');
  check(collapsed.rowVisible === false, 'and its rows really are hidden');
  check(/weakest:/i.test(collapsed.summary || ''),
    `with the weakest group on the summary line ("${collapsed.summary}")`);

  await panel.click('.bd-wrap summary');
  await panel.waitForTimeout(250);
  const opened = await panel.evaluate(() => ({
    open: document.querySelector('.bd-wrap').open,
    rowVisible: document.querySelector('.bd-row').checkVisibility(),
  }));
  check(opened.open && opened.rowVisible, 'the chevron opens it');

  // A panel that re-collapses on every tab switch is worse than one that never
  // folded, because you lose the state you just chose.
  await panel.click('[data-tab="findings"]');
  await panel.waitForTimeout(200);
  await panel.click('[data-tab="review"]');
  await panel.waitForTimeout(200);
  check(await panel.evaluate(() => document.querySelector('.bd-wrap').open),
    'and it stays open across a tab switch');
}

// --- the priority number explains itself ------------------------------------
//
// "What means the numbers in front of the findings? like 35, 24?" — asked
// directly, which is the proof a bare number was not carrying its meaning.
{
  await panel.click('[data-tab="findings"]');
  await panel.waitForTimeout(400);
  const key = await panel.evaluate(() => {
    const p = document.querySelector('.f .p');
    return {
      legend: document.querySelector('.legend.key')?.textContent.replace(/\s+/g, ' ').trim() || '',
      band: p?.querySelector('small')?.textContent.trim(),
      tip: p?.getAttribute('title') || '',
    };
  });
  check(/priority/i.test(key.legend), 'the list says once what the number is');
  check(/impact/i.test(key.legend) && /easy/i.test(key.legend),
    'and that it is impact against ease, not effort — the scale is inverted');
  check(!!key.band, `each number wears its band as a word ("${key.band}")`);
  check(/^Priority \d+ — impact \d+\/10/.test(key.tip),
    `and explains its own arithmetic on hover ("${key.tip}")`);
  await panel.click('[data-tab="review"]');
  await panel.waitForTimeout(200);
}

// --- what the collector reads off a page ------------------------------------
{
  // A black-branded store with red sale badges. Reported from a real
  // storefront that was told its brand colour was red.
  const shop = await ctx.newPage();
  await shop.goto(`${origin}/brand/black-brand.html`, { waitUntil: 'load' });
  const brand = await panel.evaluate(async (base) => {
    const { collectFromDocument } = await import('../core/collect-dom.js');
    const { analyze } = await import('../core/analyze.js');
    const [t] = await chrome.tabs.query({ url: base + '/brand/black-brand.html' });
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: t.id }, func: collectFromDocument,
      args: [{ surface: 'plp', viewportLabel: 'desktop' }], world: 'MAIN',
    });
    const a = analyze({ observations: [r.result], axes: ['design'], site: 'b' });
    return { button: r.result.roles?.primaryButton?.background, color: a.tokens.color };
  }, origin);
  check(brand.button === 'rgb(0, 0, 0)', `the collector reads the black action button (${brand.button})`);
  check(brand.color.action === '#000000',
    `and the action colour is black, not the sale badge (${brand.color.action})`);
  check(brand.color.accents.some((c) => c.hex === '#d0021b'),
    'with the badge red as an accent, named by where it was seen');
  check(!brand.color.surface.some((c) => c.hex === '#d0021b'),
    'and never listed among the surfaces');
  await shop.close();

  // Google's stylesheet is cross-origin, so its @font-face rules are invisible
  // to .cssRules — the families are only knowable from the stylesheet URL.
  const fonts = await ctx.newPage();
  await fonts.route('**fonts.googleapis.com**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await fonts.goto(`${origin}/brand/google-fonts.html`, { waitUntil: 'load' });
  const gf = await panel.evaluate(async (base) => {
    const { collectFromDocument } = await import('../core/collect-dom.js');
    const [t] = await chrome.tabs.query({ url: base + '/brand/google-fonts.html' });
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: t.id }, func: collectFromDocument,
      args: [{ surface: 'content', viewportLabel: 'desktop' }], world: 'MAIN',
    });
    return r.result.engine.googleFonts;
  }, origin);
  check(gf.includes('Inter') && gf.includes('Playfair Display'),
    `css2 families are parsed, spaces and all (${gf.join(', ')})`);
  check(gf.includes('Lora') && gf.includes('Open Sans'),
    'and the older pipe-separated css v1 shape too');
  await fonts.close();

  // Every typeface states where it comes from. Without that, a font that is
  // simply not from Google looks identical to a broken link — which is exactly
  // how it was reported.
  const sources = await ctx.newPage();
  await sources.route('**fonts.googleapis.com**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await sources.route('**cdn.example-shop.com**', (r) => r.fulfill({ status: 404, body: '' }));
  await sources.goto(`${origin}/brand/font-sources.html`, { waitUntil: 'load' });
  const srcTabId = await panel.evaluate(async (base) =>
    (await chrome.tabs.query({ url: base + '/brand/font-sources.html' }))[0].id, origin);
  await panel.evaluate((id) => chrome.tabs.update(id, { active: true }), srcTabId);
  await panel.click('#scan');
  await panel.waitForTimeout(3000);

  const specs = await panel.evaluate(() => [...document.querySelectorAll('.spec')].map((e) => ({
    fam: e.dataset.family,
    link: e.querySelector('.gf')?.getAttribute('href') || null,
    src: e.querySelector('.src')?.textContent.trim() || null,
  })));
  const by = (n) => specs.find((x) => x.fam === n);
  check(by('Lora')?.link === 'https://fonts.google.com/specimen/Lora',
    // An @import'ed sheet is not a top-level document.styleSheets entry, so
    // the href loop never sees it; it is a CSSImportRule on the parent.
    `a Google face reached by @import still gets its link (${by('Lora')?.link})`);
  check(/^webfont · cdn\.example-shop\.com$/.test(by('HouseSans')?.src || ''),
    `a self-hosted face names its host instead (${by('HouseSans')?.src})`);
  check(by('Georgia')?.src === 'system',
    `and a system stack says so (${by('Georgia')?.src})`);
  // A family can be on Google Fonts and not be served from Google — Shopify's
  // font picker does exactly that. The direct specimen link is a claim, so it
  // is only used when the page really loads from Google; everything else gets
  // a search, which asserts nothing.
  check(/fonts\.google\.com\/\?query=/.test(by('HouseSans')?.link || ''),
    'a self-hosted family offers a look-up rather than a specimen link');

  // Two hairlines stacked under a heading. `.spec:first-of-type` means "first
  // div among its siblings", not "first .spec" — one div ahead of it and the
  // rule silently misses, so the heading's own rule and the row's doubled up.
  const rules = await panel.evaluate(() => {
    const h = [...document.querySelectorAll('#out h3')].find((x) => /TYPEFACES/i.test(x.textContent));
    return {
      heading: getComputedStyle(h).borderBottomWidth,
      firstRow: getComputedStyle(h.nextElementSibling).borderTopWidth,
    };
  });
  check(rules.heading === '1px' && rules.firstRow === '0px',
    `one rule under the heading, not two (${rules.heading} + ${rules.firstRow})`);
  await sources.close();
}

await ctx.close();
server.close();
// Last, so it covers everything the run did rather than one moment in it.
check(contextErrors.length === 0,
  `no context logged an error Chrome would show on its card${contextErrors.length ? `: ${contextErrors[0]}` : ''}`);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
