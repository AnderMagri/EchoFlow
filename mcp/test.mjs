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

if (url) {
  const a = await client.callTool({ name: 'echoflow_analyze', arguments: { url, scope: 'site', limit: 6 } });
  ok(!a.isError, 'analyse succeeds');
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
}

await client.close();
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
