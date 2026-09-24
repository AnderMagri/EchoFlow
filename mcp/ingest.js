/**
 * Loopback ingest — how the browser hands an audit to this server directly.
 *
 * The Chrome sidebar cannot speak MCP: the server is a stdio process its
 * client launches, and a page can neither spawn it nor open a pipe to it. The
 * first attempt at a handoff therefore went through the downloads folder,
 * which works but is exactly backwards — the point of handing an audit to
 * Claude is that nobody has to file it first.
 *
 * So the server opens a small HTTP listener on loopback, purely to RECEIVE.
 * It speaks no MCP; it takes one POST, writes the bundle where this server
 * already keeps its audits, and the normal tools find it. The extension posts
 * straight to it and the person downloads nothing.
 *
 * Three rules, because this is a port on someone's machine:
 *
 * 1. **127.0.0.1 only.** Never 0.0.0.0. This is not a service.
 * 2. **A custom header is required.** Any web page you visit can POST to
 *    localhost with a simple request; it cannot add `x-echoflow-ingest`
 *    without a CORS preflight, and preflight is answered only for
 *    chrome-extension:// origins. That is what stops a random page filling
 *    your audit folder.
 * 3. **A size cap.** An unbounded POST to a local port is a memory bomb.
 *
 * @module mcp/ingest
 */

import { createServer } from 'node:http';

/** Ports tried in order. The extension probes the same list. */
export const INGEST_PORTS = [8787, 8788, 8789, 8790];

const MAX_BYTES = 64 * 1024 * 1024;
const HEADER = 'x-echoflow-ingest';

const allowedOrigin = (origin) => !origin || origin.startsWith('chrome-extension://');

/**
 * @param {object} opts
 * @param {(analysis:object)=>Promise<string>} opts.onAudit receives the analysis, returns the bundle path
 * @param {number[]} [opts.ports]
 * @param {(m:string)=>void} [opts.log] stderr only — stdout belongs to the MCP protocol
 */
export async function startIngest({ onAudit, ports = INGEST_PORTS, log = () => {} }) {
  const server = createServer((req, res) => {
    const origin = req.headers.origin;

    // Preflight. Only an extension gets permission to send the header, which
    // is what makes the header a real check rather than decoration.
    if (req.method === 'OPTIONS') {
      if (!allowedOrigin(origin)) return end(res, 403, { error: 'origin not allowed' });
      res.writeHead(204, {
        'access-control-allow-origin': origin || '*',
        'access-control-allow-methods': 'POST, GET, OPTIONS',
        'access-control-allow-headers': `content-type, ${HEADER}`,
        'access-control-max-age': '600',
      });
      return res.end();
    }

    if (!allowedOrigin(origin)) return end(res, 403, { error: 'origin not allowed' });
    const cors = { 'access-control-allow-origin': origin || '*' };

    // Discovery. Lets the extension find which port this server landed on, and
    // tell it apart from whatever else might be listening there.
    if (req.method === 'GET' && req.url === '/health') {
      return end(res, 200, { ok: true, service: 'echoflow-ingest', version: 1 }, cors);
    }

    if (req.method !== 'POST' || req.url !== '/ingest') {
      return end(res, 404, { error: 'not found' }, cors);
    }
    if (req.headers[HEADER] !== '1') {
      return end(res, 400, { error: `missing ${HEADER} header` }, cors);
    }

    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on('error', () => { /* client went away */ });
    req.on('end', async () => {
      if (size > MAX_BYTES) return end(res, 413, { error: 'too large' }, cors);
      let analysis;
      try {
        analysis = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return end(res, 400, { error: 'body is not JSON' }, cors);
      }
      // Shape check, so a stray POST cannot land in the audit folder as if it
      // were an audit.
      if (!analysis?.consistency || !Array.isArray(analysis?.findings)) {
        return end(res, 422, { error: 'not an EchoFlow analysis' }, cors);
      }
      try {
        const bundle = await onAudit(analysis);
        log(`ingested ${analysis.site} -> ${bundle}`);
        return end(res, 200, {
          ok: true, site: analysis.site, findings: analysis.findings.length,
          score: analysis.consistency.overall ?? null, bundle,
        }, cors);
      } catch (err) {
        return end(res, 500, { error: err.message }, cors);
      }
    });
  });

  for (const port of ports) {
    try {
      await listen(server, port);
      return { port, close: () => new Promise((r) => server.close(r)) };
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  // Nothing free. The server still works; the extension falls back to saving
  // a file, which is why this is not fatal.
  return null;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (e) => { server.removeListener('listening', onOk); reject(e); };
    const onOk = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onOk);
    server.listen(port, '127.0.0.1');
  });
}

function end(res, code, body, extra = {}) {
  res.writeHead(code, { 'content-type': 'application/json', ...extra });
  res.end(JSON.stringify(body));
}
