#!/usr/bin/env node
/**
 * EchoFlow 2.0 CLI.
 *
 *   echoflow <url> [options]
 *
 * Renders the site with Playwright, measures consistency, writes a wiki bundle.
 *
 * @module analyzer/cli
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { analyze } from '../../../core/analyze.js';
import { buildBundle } from '../../../core/wiki/bundle.js';
import { collectPages } from '../collect/browser.js';
import { discoverPages } from '../collect/discover.js';

const HELP = `
EchoFlow 2.0 — Shopify consistency audit

  echoflow <url> [options]

Options
  --scope <page|site>    page: just this URL. site: discover and sample. (default: site)
  --axes <list>          design,ux,engine  (default: all three)
  --viewports <list>     desktop,mobile    (default: desktop)
  --limit <n>            max pages in a site run (default: 12)
  --out <dir>            output directory (default: ./echoflow-<host>)
  --quiet                only print the verdict

Scope rule
  It is not the analysis that is single-page or site-wide — it is the check.
  Extractive checks (tokens, copy, scripts) run at any scope. Comparative checks
  (consistency across pages, journey coherence) need the whole site and are
  SKIPPED, not guessed, on a single page.

Examples
  echoflow https://shop.example.com
  echoflow https://shop.example.com/products/x --scope page --axes design
  echoflow https://shop.example.com --viewports desktop,mobile --limit 16
`;

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    process.exit(argv.length ? 0 : 1);
  }

  const url = argv[0];
  const opt = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const quiet = argv.includes('--quiet');
  const log = quiet ? () => {} : (m) => console.log(m);

  let target;
  try { target = new URL(url); } catch {
    console.error(`Not a URL: ${url}`);
    process.exit(1);
  }

  const scope = opt('scope', 'site');
  const axes = opt('axes', 'design,ux,engine').split(',').map((s) => s.trim()).filter(Boolean);
  const viewports = opt('viewports', 'desktop').split(',').map((s) => s.trim()).filter(Boolean);
  const limit = parseInt(opt('limit', '12'), 10);
  const outDir = resolve(opt('out', `./echoflow-${target.hostname.replace(/[^a-z0-9.-]/gi, '-')}`));

  log(`\nEchoFlow 2.0 — ${target.hostname}`);
  log(`  scope ${scope} · axes ${axes.join('+')} · viewports ${viewports.join('+')}\n`);

  let urls = [url];
  if (scope === 'site') {
    log('Discovering pages');
    urls = await discoverPages({ origin: target.origin, limit, log });
    if (!urls.length) urls = [url];
  }

  log(`\nRendering ${urls.length} page${urls.length === 1 ? '' : 's'}`);
  const { observations, errors } = await collectPages({ urls, viewports, log });

  if (!observations.length) {
    console.error('\nNothing could be collected. Check the URL is reachable.');
    if (errors.length) errors.forEach((e) => console.error(`  ${e.url} — ${e.error}`));
    process.exit(1);
  }

  log(`\nAnalysing ${observations.length} observation${observations.length === 1 ? '' : 's'}`);
  const analysis = analyze({ observations, axes, site: target.hostname });

  const files = buildBundle(analysis);
  await clearPreviousBundle(outDir, log);
  for (const [path, contents] of Object.entries(files)) {
    const full = resolve(outDir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, contents, 'utf8');
  }

  const c = analysis.consistency;
  console.log(`\n  ${c.overall ?? '—'}/100 — ${c.grade}${c.provisional ? '  [PROVISIONAL]' : ''}`);
  console.log(`  ${c.verdict}\n`);
  if (c.caveat) console.log(`  ! ${c.caveat}\n`);
  for (const axis of axes) {
    console.log(`  ${axis.padEnd(7)} ${String(c.byAxis[axis] ?? '—').padStart(3)}`);
  }
  console.log(`\n  ${analysis.findings.length} findings` +
    ` (${analysis.findings.filter((f) => f.priority >= 63).length} critical,` +
    ` ${analysis.findings.filter((f) => f.priority >= 40 && f.priority < 63).length} high)`);

  if (analysis.skipped.length) {
    console.log(`  ${analysis.skipped.length} dimension(s) not measured: ${analysis.skipped.map((s) => s.key).join(', ')}`);
  }
  if (errors.length) console.log(`  ${errors.length} page(s) failed to load`);

  console.log(`\n  Report:  ${outDir}/site/index.html`);
  console.log(`  Data:    ${outDir}/data/analysis.json`);
  console.log(`  Agents:  ${outDir}/CLAUDE.md\n`);
}

/**
 * Remove the previous run's generated files.
 *
 * Without this, re-analysing into the same directory leaves orphaned findings
 * from the old run sitting next to the new ones — files that describe problems
 * the current analysis did not find, indistinguishable from ones it did. The
 * report would contradict its own data/findings.json.
 *
 * Only ever deletes a directory we can prove EchoFlow generated (by its
 * manifest), and only the subtrees it owns. A path the user pointed at by
 * mistake is left completely alone.
 */
async function clearPreviousBundle(outDir, log) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(outDir, 'manifest.json'), 'utf8'));
  } catch {
    return; // fresh directory, or not ours — write alongside, delete nothing
  }
  if (manifest?.generator !== 'EchoFlow 2.0') {
    log('  ! output directory has a foreign manifest.json — not clearing anything');
    return;
  }
  for (const dir of ['findings', 'pages', 'site', 'data']) {
    await rm(resolve(outDir, dir), { recursive: true, force: true });
  }
  log('  cleared previous run');
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
