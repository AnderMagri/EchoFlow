/**
 * MCP server smoke test — real client, real stdio handshake.
 *
 *   cd mcp && node test.mjs [url]
 *
 * With no URL it checks the protocol surface only (tool list, schemas, error
 * shape). With one, it runs a full analyse -> query -> drill-down round trip.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const url = process.argv[2];

/**
 * Serve the fixture storefront so the round trip runs with no arguments.
 * Passing a URL still overrides it.
 */
const { createServer } = await import('node:http');
const { readFile: readFixture } = await import('node:fs/promises');
const { resolve: resolvePath, extname: ext, dirname: dirOf } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const fixtures = resolvePath(dirOf(fileURLToPath(import.meta.url)), '../test/fixture-site');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.txt': 'text/plain' };
const fixtureServer = createServer(async (req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const path = resolvePath(fixtures, '.' + rel);
  if (!path.startsWith(fixtures)) { res.writeHead(403).end(); return; }
  try {
    // Read BEFORE writing the head: awaiting inside the .end() argument sends
    // the 200 first, so a missing file then throws ERR_HTTP_HEADERS_SENT in
    // the catch instead of returning a clean 404.
    const body = await readFixture(path);
    res.writeHead(200, { 'content-type': TYPES[ext(path)] || 'text/html' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => fixtureServer.listen(0, '127.0.0.1', r));
const target = url || `http://127.0.0.1:${fixtureServer.address().port}/`;
const OUT = resolve(tmpdir(), 'echoflow-mcp-test');
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name}`); } };

const transport = new StdioClientTransport({
  command: 'node',
  args: [resolve(import.meta.dirname, 'server.js')],
  env: { ...process.env, ECHOFLOW_OUT: OUT },
});
const client = new Client({ name: 'echoflow-test', version: '2.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
ok(tools.length === 7, `exposes 7 tools (got ${tools.length})`);
ok(tools.every((t) => t.description && t.description.length > 60), 'every tool has a real description');
ok(tools.every((t) => t.annotations), 'every tool declares annotations');
ok(tools.filter((t) => t.annotations?.readOnlyHint).length === 6, 'only echoflow_analyze is non-read-only');

const ex = await client.callTool({ name: 'echoflow_explain', arguments: {} });
ok(ex.structuredContent?.dimensions?.length === 20, 'explain returns all 20 dimensions');
ok(/effort is INVERTED/.test(ex.content[0].text), 'explain warns about the inverted effort scale');

const err = await client.callTool({ name: 'echoflow_findings', arguments: { bundle: '/does/not/exist' } });
ok(err.isError === true, 'a missing bundle is an error, not an empty result');
ok(/Try:/.test(err.content[0].text), 'and the error suggests a next step');

// The round trip: analyse, then read the result back.
//
// This block was guarded by an opt-in env var, so it never ran — and the one
// bug it would have caught sat here for weeks. When the bundle grew a report/
// level, every read tool started failing on a bundle echoflow_analyze had just
// written, and the suite stayed green. It now runs against a local fixture by
// default and only skips when there is no browser to render with.
{
  const a = await client.callTool({ name: 'echoflow_analyze', arguments: { url: target, scope: 'site', limit: 6 } });
  if (a.isError && /browser|chromium|executable|launch/i.test(a.content?.[0]?.text || '')) {
    console.log('  skipped the round trip — no Chromium to render with');
  } else {
  ok(!a.isError, `analyse succeeds${a.isError ? ': ' + a.content?.[0]?.text?.slice(0, 120) : ''}`);
  const bundle = a.structuredContent?.bundlePath;
  ok(!!bundle, 'analyse returns a bundle path');
  ok(typeof a.structuredContent?.score === 'number', 'analyse returns a score');
  ok(Array.isArray(a.structuredContent?.notAssessed), 'analyse declares what it did not assess');

  const f = await client.callTool({ name: 'echoflow_findings', arguments: { bundle, limit: 5 } });
  ok(f.structuredContent?.findings?.length > 0, 'findings can be queried back');
  const id = f.structuredContent.findings[0].id;
  const one = await client.callTool({ name: 'echoflow_finding', arguments: { bundle, id } });
  ok(one.structuredContent?.evidence, 'a single finding carries its evidence');
  const bad = await client.callTool({ name: 'echoflow_finding', arguments: { bundle, id: 'nope' } });
  ok(bad.isError && /did you mean|list ids/.test(bad.content[0].text), 'unknown id suggests how to find a real one');

  // The tools have to accept the path analyse HANDED BACK, whatever level the
  // JSON happens to sit at. This is the assertion the report/ move broke.
  const t = await client.callTool({ name: 'echoflow_tokens', arguments: { bundle, format: 'json' } });
  ok(!t.isError, 'tokens read back from the same path analyse returned');
  const r = await client.callTool({ name: 'echoflow_retrieval', arguments: { bundle } });
  ok(!r.isError, 'retrieval reads back from the same path too');
  }
}

fixtureServer.close();
await client.close();
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
