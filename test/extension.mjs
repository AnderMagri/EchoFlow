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
const server = createServer(async (req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const path = resolve(fixtures, '.' + rel);
  if (!path.startsWith(fixtures)) { res.writeHead(403).end(); return; }
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
  check(/nothing was downloaded/i.test(pushed.hint), 'and the panel says so');

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

  const hint = await panel.evaluate(() => document.querySelector('#hint')?.textContent || '');
  check(/clipboard/i.test(hint), 'and says the line to paste is on the clipboard');
  check(/not running/i.test(hint), 'and explains why it had to save rather than send');
}

await ctx.close();
server.close();
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
