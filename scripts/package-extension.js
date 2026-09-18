#!/usr/bin/env node
/**
 * Package the extension for handing to someone who is not cloning the repo.
 *
 *   node scripts/package-extension.js [outDir]
 *
 * Syncs core first, so a stale copy cannot be shipped — the extension loads its
 * own copy of core/ and forgetting to sync is the one way to ship a build whose
 * sidebar and CLI disagree.
 *
 * The zip is NOT committed. A binary in the repo goes stale the moment anyone
 * pushes, and a stale download button is exactly how v1 kept handing out the
 * wrong version.
 */
import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from '../extension/lib/zip.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = join(root, 'extension');

// Never package a stale core.
execFileSync(process.execPath, [join(root, 'scripts/sync-core.js')], { stdio: 'inherit' });

const manifest = JSON.parse(await readFile(join(extDir, 'manifest.json'), 'utf8'));

/** Read as bytes rather than text — encoding these as UTF-8 corrupts them. */
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf)$/i;

async function walk(dir, base = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) out.push(...await walk(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

const all = await walk(extDir);
const files = {};
for (const rel of all) {
  files[rel] = BINARY.test(rel)
    ? new Uint8Array(await readFile(join(extDir, rel)))
    : await readFile(join(extDir, rel), 'utf8');
}

const outDir = resolve(process.argv[2] || join(root, 'dist'));
await mkdir(outDir, { recursive: true });
const name = `echoflow-extension-${manifest.version}.zip`;
const blob = createZip(files);
await writeFile(join(outDir, name), Buffer.from(await blob.arrayBuffer()));

console.log(`\n  ${name}`);
console.log(`  ${all.length} files · ${(blob.size / 1024).toFixed(0)} KB`);
console.log(`  ${join(outDir, name)}\n`);
console.log('  Install: chrome://extensions → Developer mode → Load unpacked → the unzipped folder\n');
