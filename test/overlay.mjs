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
const gridRoot = resolve(here, 'fixture-grid');
const server = createServer(async (req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  // resolve() strips the trailing slash, so a directory request has to be
  // turned into index.html BEFORE resolving, not after.
  if (rel.endsWith('/')) rel += 'index.html';
  // /grid/* serves the measured-grid fixtures, whose column counts and gutters
  // are known exactly by construction.
  const isGrid = rel.startsWith('/grid/');
  const base = isGrid ? gridRoot : root;
  const path = resolve(base, '.' + (isGrid ? rel.slice(5) : rel));
  if (!path.startsWith(base)) { res.writeHead(403).end(); return; }
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

// --- grid detection ---------------------------------------------------------
//
// Offering 12 in a menu is not detection. These fixtures have grids that are
// known exactly by construction, so "what grid is this page on" has a right
// answer to check against rather than an eyeball.

console.log('\n  overlay — grid detection\n');

for (const [file, width, wantCols, wantGutter] of [
  ['12col.html', 1440, 12, 24],
  ['12col.html', 1680, 12, 24],   // a wider window must not change the answer
  ['8col.html', 1280, 8, 20],
  ['8col.html', 1440, 8, 20],
]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${origin}/grid/${file}`, { waitUntil: 'load' });
  const res = await draw(page, 'columns', null);
  const g = res.grid.inferred;
  check(!!g, `${file} @${width} — a grid was inferred`);
  check(g && g.columns === wantCols,
    `${file} @${width} — ${wantCols} columns (got ${g ? g.columns : 'none'})`);
  check(g && g.gutter === wantGutter,
    `${file} @${width} — ${wantGutter}px gutter (got ${g ? g.gutter : 'none'})`);
  check(g && g.residual < 1.5, `${file} @${width} — fits to within a pixel or so`);
  check(res.columns === wantCols, `${file} @${width} — and that is what gets drawn`);
  await page.close();
}

{
  // A coarse grid is a SUBSET of a fine one, so an 8-column page also "fits"
  // 4 columns. Only residual separates them, and getting this backwards made
  // the detector answer 4 for every 8- and 12-column page it saw.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${origin}/grid/8col.html`, { waitUntil: 'load' });
  const res = await draw(page, 'columns', null);
  check(res.grid.inferred.columns !== 4,
    'an 8-column page is not reported as 4 columns just because 4 also fits');
  await page.close();
}

{
  // An explicit CSS grid is a fact, not an inference.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${origin}/grid/cssgrid.html`, { waitUntil: 'load' });
  const res = await draw(page, 'columns', null);
  check(res.grid.explicit.some((e) => e.columns === 4),
    'a repeat(4, 1fr) product grid is read off the computed style');
  await page.close();
}

{
  // A modern collection page: no page-wide column system at all, just
  // component grids. Reported from ardene.com, where this said "no layout grid
  // found" while listing three CSS grids — and then drew the 2-up card grid,
  // because it ranked grids by how MANY there were rather than how wide.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${origin}/grid/component-grids.html`, { waitUntil: 'load' });
  const res = await draw(page, 'columns', null);
  check(res.grid.pageGrid && res.grid.pageGrid.columns === 4,
    `the grid spanning the content column is the page grid (got ${res.grid.pageGrid ? res.grid.pageGrid.columns : 'none'})`);
  check(res.columns === 4, `and that is what gets drawn, not the 12 card grids (got ${res.columns})`);
  check(res.grid.explicit[0].columns === 4, 'explicit grids rank by width, not by count');
  check(res.grid.explicit.some((e) => e.columns === 3),
    'a short filter row still counts as a 3-up grid');
  // The container must be the content column, not the padded wrapper: drawing
  // across the padding puts every line out by the padding width.
  check(Math.abs(res.container.width - 1280) <= 1,
    `container is the content column, not the padded wrapper (${res.container.width})`);
  await page.close();
}

{
  // Eight identical tiles repeat the same few x positions. Counting them each
  // time let a 14-column model explain 69% of the edges while touching five of
  // its twenty-eight lines.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${origin}/grid/component-grids.html`, { waitUntil: 'load' });
  const res = await draw(page, 'columns', null);
  check(!res.grid.inferred || res.grid.inferred.columns <= 6,
    `no over-parameterised grid from duplicate edges (got ${res.grid.inferred ? res.grid.inferred.columns : 'none'})`);
  await page.close();
}

{
  // A page with nothing to measure must say so, not fall back to 12 quietly.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent('<style>body{margin:0}p{margin:40px}</style><p>just some prose</p>');
  const res = await draw(page, 'columns', null);
  check(res.grid.inferred === null, 'a page with no grid reports none rather than inventing one');
  await page.close();
}

await browser.close();
server.close();
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
