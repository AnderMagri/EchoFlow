#!/usr/bin/env node
/**
 * Copy core/ into the extension.
 *
 * A Chrome extension can only load files inside its own directory, so core/
 * has to physically exist under extension/. This copy is the ONLY mechanism —
 * there is no second implementation and no bundler. Run it after changing core.
 *
 *   node scripts/sync-core.js
 */
import { cp, rm, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = resolve(root, 'extension/core');

await rm(dest, { recursive: true, force: true });
await cp(resolve(root, 'core'), dest, { recursive: true });

const count = async (dir) => {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? await count(resolve(dir, e.name)) : 1;
  }
  return n;
};
console.log(`synced ${await count(dest)} core files into extension/core/`);
