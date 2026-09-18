#!/usr/bin/env node
/**
 * Overlay tests — the one part of the tool that only exists inside a browser.
 *
 *   node test/overlay.mjs
 *
 * The column grid was drawn on twelfths of the VIEWPORT for its whole life,
 * which aligns with nothing on any site with a centred `max-width` container.
 * It looked right at 1440 purely by coincidence — twelfths of 1440 land on a
 * 1200px centred container — so eyeballing it at one window size confirmed a
 * bug. Hence a real browser at three widths.
 *
 * Skips cleanly when no Chromium is available, because the node-only suite
 * (`test/run.js`) must stay the thing that always runs.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toggleOverlay } from '../extension/content/overlay.js';

const here = dirname(fileURLToPath(import.meta.url));

let chromium;
try { ({ chromium } = await import('../analyzer/node_modules/playwright-core/index.mjs')); }
catch { console.log('  skipped — playwright-core is not installed\n'); process.exit(0); }

let pass = 0, fail = 0;
const check = (cond, msg) => {
  if (cond) { pass++; console.log(`  ok    ${msg}`); }
  else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}`); }
};

// Serve the fixture storefront: main{max-width:1200px;margin:0 auto;padding:40px}
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.txt': 'text/plain' };
const root = resolve(here, 'fixture-site');
const server = createServer(async (req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  // resolve() strips the trailing slash, so a directory request has to be
  // turned into index.html BEFORE resolving, not after.
  if (rel.endsWith('/')) rel += 'index.html';
  const path = resolve(root, '.' + rel);
  if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.ECHOFLOW_CHROMIUM || undefined,
    args: process.env.ECHOFLOW_NO_SANDBOX ? ['--no-sandbox'] : [],
  });
} catch (e) {
  console.log(`  skipped — no Chromium (${e.message.split('\n')[0]})\n`);
  server.close();
  process.exit(0);
}

// Inject by serialising the function, exactly as chrome.scripting.executeScript
// does — so the test exercises the extension's real injection path.
const SRC = toggleOverlay.toString();
const draw = (page, mode, cols) => page.evaluate(
  (a) => (0, eval)('(' + a.src + ')')(a.mode, a.cols), { src: SRC, mode, cols });

const contentBox = (page) => page.evaluate(() => {
  const el = document.querySelector('main');
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
  return { left: Math.round(r.left + scrollX + pl), width: Math.round(r.width - pl - pr) };
});

console.log('\n  overlay — column grid\n');

// The grid must track the content column at EVERY window width, not just the
// one where the arithmetic happens to agree.
for (const width of [1440, 1600, 1920]) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.goto(origin + '/', { waitUntil: 'load' });
  const res = await draw(page, 'columns', 12);
  const box = await contentBox(page);
  check(res.container.measured, `${width}px — container measured, not assumed`);
  check(Math.abs(res.container.left - box.left) <= 1,
    `${width}px — grid starts at the content column (${res.container.left} vs ${box.left})`);
  check(Math.abs(res.container.width - box.width) <= 1,
    `${width}px — grid is as wide as the content column (${res.container.width} vs ${box.width})`);
  check(res.boxes > 0, `${width}px — sections drawn under the grid, so alignment is checkable`);
  await page.close();
}

// A full-bleed page has no grid to find. Saying so is the point; inventing one
// is how the old overlay was wrong without ever looking wrong.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent('<style>body{margin:0}section{height:400px}</style><section>a</section><section>b</section>');
  const res = await draw(page, 'columns', 12);
  check(res.container.measured === false, 'full-bleed page reports no container rather than guessing');
  check(res.container.width === 1280, 'full-bleed falls back to the viewport width');
  await page.close();
}

// A document taller than the body box must still get a full-height grid.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent('<style>body{margin:0}main{max-width:900px;margin:0 auto}section{height:1500px}</style><main><section>a</section><section>b</section></main>');
  await draw(page, 'columns', 12);
  const span = await page.evaluate(() => ({
    band: Math.round(document.querySelector('[data-ef="col"]').getBoundingClientRect().height),
    page: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
  }));
  check(span.band >= span.page - 1, `grid spans the whole document (${span.band} of ${span.page})`);
  await page.close();
}

// The column count is a question the page can answer — 4-up product grids are
// not the same question as the 12-column layout grid.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(origin + '/', { waitUntil: 'load' });
  const res = await draw(page, 'columns', 4);
  const bands = await page.evaluate(() => document.querySelectorAll('[data-ef="col"]').length);
  check(bands === 4, `honours the requested column count (${bands})`);
  check(res.columns === 4, 'reports the count it drew');

  await draw(page, 'off', 12);
  check(await page.evaluate(() => !document.getElementById('__echoflow_overlay__')),
    'off removes the layer');
  await page.close();
}

await browser.close();
server.close();
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
