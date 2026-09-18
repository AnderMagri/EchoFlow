/**
 * Machine-retrieval signals that need a network fetch rather than a DOM.
 *
 * Lives in core/ because BOTH surfaces need it. The extension has host
 * permissions and can fetch the raw HTML just as the analyzer can, and without
 * this the sidebar silently reports "not measurable" for parity, answerability
 * and structured-data coverage — the newest and most useful checks, absent with
 * no explanation. One implementation, two callers, same rule as the collector.
 *
 * Only `probeCrawlers` stays analyzer-side: a browser will not let a page set
 * its own User-Agent header, so the crawler probe cannot run in an extension.
 *
 * Two things live here:
 *
 * 1. Site-level files — robots.txt, llms.txt, the sitemap. A crawler reads
 *    these before it reads a page.
 *
 * 2. The un-rendered HTML. This is the one that matters most and the one a
 *    DOM-only tool cannot see: many crawlers that feed answer engines do NOT
 *    execute JavaScript. If the product name, price and structured data only
 *    exist after hydration, the machine reader gets an empty shell while the
 *    human sees a complete page — and nothing in the rendered DOM reveals the
 *    difference. Fetching the raw response and diffing it against the rendered
 *    page is the only way to find it.
 *
 * @module analyzer/collect/retrieval
 */

import { AI_CRAWLERS } from './observation.js';

const UA = 'EchoFlow/2.0 (+consistency audit)';

/**
 * robots.txt, parsed for what it says to AI crawlers specifically.
 * @param {string} origin
 */
export async function fetchRobots(origin) {
  let text = null;
  try {
    const res = await fetch(new URL('/robots.txt', origin).href, { headers: { 'user-agent': UA } });
    if (res.ok) text = await res.text();
  } catch { /* unreachable — reported as unknown, not as allowed */ }

  if (text == null) return { present: false, agents: {}, sitemaps: [], raw: null };

  // Group directives by user-agent block.
  const blocks = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, '').trim();
    if (!clean) continue;
    const m = clean.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, key, value] = [m[0], m[1].toLowerCase(), m[2].trim()];
    if (key === 'user-agent') {
      if (!current || current.directives.length) {
        current = { agents: [], directives: [] };
        blocks.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current) {
      current.directives.push({ key, value });
    }
  }

  const sitemaps = [...text.matchAll(/^\s*sitemap\s*:\s*(.+)$/gim)].map((x) => x[1].trim());

  /** Does any block covering this agent disallow everything? */
  const statusFor = (agent) => {
    const name = agent.toLowerCase();
    const relevant = blocks.filter((b) => b.agents.includes(name));
    const wildcard = blocks.filter((b) => b.agents.includes('*'));
    // A named block wins over the wildcard, which is how robots.txt precedence works.
    const source = relevant.length ? relevant : wildcard;
    if (!source.length) return { state: 'allowed', by: 'no matching rule' };

    const disallows = source.flatMap((b) => b.directives.filter((d) => d.key === 'disallow').map((d) => d.value));
    const allows = source.flatMap((b) => b.directives.filter((d) => d.key === 'allow').map((d) => d.value));
    if (disallows.includes('/') && !allows.includes('/')) {
      return { state: 'blocked', by: relevant.length ? `explicit ${agent} block` : 'wildcard block' };
    }
    if (disallows.length) return { state: 'partial', by: `${disallows.length} disallow rule(s)`, paths: disallows.slice(0, 5) };
    return { state: 'allowed', by: relevant.length ? `explicit ${agent} rule` : 'wildcard rule' };
  };

  const agents = {};
  for (const c of AI_CRAWLERS) agents[c.agent] = { ...statusFor(c.agent), operator: c.operator, purpose: c.purpose };

  return { present: true, agents, sitemaps, raw: text.slice(0, 4000) };
}

/**
 * llms.txt — an emerging convention (llmstxt.org) for a markdown summary aimed
 * at language models. Genuinely new: report its absence as an opportunity, not
 * as a failure, because it is not established practice yet.
 * @param {string} origin
 */
export async function fetchLlmsTxt(origin) {
  for (const path of ['/llms.txt', '/llms-full.txt']) {
    try {
      const res = await fetch(new URL(path, origin).href, { headers: { 'user-agent': UA } });
      if (!res.ok) continue;
      const type = res.headers.get('content-type') || '';
      if (/html/i.test(type)) continue; // a soft-404 serving the app shell
      const body = await res.text();
      if (body.trim().length < 20) continue;
      return { present: true, path, bytes: body.length, preview: body.slice(0, 400) };
    } catch { /* try the next path */ }
  }
  return { present: false, path: null };
}

/**
 * Fetch the page WITHOUT running JavaScript, and compare it to what the browser
 * ended up rendering.
 *
 * @param {string} url
 * @param {object} rendered the observation's `retrieval` block, post-JS
 */
export async function compareStatic(url, rendered) {
  let html = null;
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (res.ok) html = await res.text();
  } catch { /* leave null — unknown, not "fails" */ }

  if (html == null) return { fetched: false };

  // Compare BODY content only.
  //
  // Including <head> makes the check lie: a product name sits in <title> on
  // every page, server-rendered or not, so "is the H1 in the static HTML"
  // returned true for a page whose body was entirely client-rendered. The
  // question is whether the CONTENT is there, and <head> is not content.
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html.replace(/<head[\s\S]*?<\/head>/i, ' ');

  // Crude tag-stripping on purpose: we are asking "is the text THERE", not
  // reproducing the browser's text layout.
  const stripped = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const haystack = stripped.toLowerCase();
  const hasText = (needle) => {
    // 3, not 8. Product names are routinely short — "Runner", "Tee", "Mug" —
    // and an 8-character floor silently returned null for most H1s on a
    // storefront, which is precisely where this check has to work.
    if (!needle) return null;
    const probe = needle.slice(0, 60).replace(/\s+/g, ' ').trim().toLowerCase();
    if (probe.length < 3) return null;
    return haystack.includes(probe);
  };

  const jsonLdBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const staticTypes = [];
  // Keep the parsed OBJECTS, not just the type names. Answerability asks
  // whether a value is actually recoverable — "does offers.price hold a number"
  // — and a list of type names cannot answer that.
  const staticItems = [];
  for (const block of jsonLdBlocks) {
    try {
      const parsed = JSON.parse(block[1]);
      const items = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        let t = item['@type'];
        if (Array.isArray(t)) t = t[0];
        if (t) staticTypes.push(t);
        if (staticItems.length < 12) staticItems.push(item);
      }
    } catch { /* malformed — the DOM pass reports that separately */ }
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);

  const renderedLen = rendered?.totalTextLength || 0;
  const ratio = renderedLen ? +(stripped.length / renderedLen).toFixed(2) : null;

  return {
    fetched: true,
    staticTextLength: stripped.length,
    renderedTextLength: renderedLen,
    // Above ~1 means the raw HTML carries at least as much text as the rendered
    // page — normal for server-rendered Liquid. Far below means hydration is
    // doing the work, and a non-JS reader sees a fraction of the page.
    textRatio: ratio,
    h1InStatic: hasText(rendered?.h1Text?.[0]),
    // Head fields are checked against the raw markup, where they actually live.
    titleInStatic: /<title[^>]*>\s*\S/i.test(html),
    descriptionInStatic: /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{5,}/i.test(html),
    jsonLdTypesInStatic: [...new Set(staticTypes)],
    jsonLdOnlyAfterJs: (rendered?.jsonLdTypes || []).filter((t) => !staticTypes.includes(t)),
    canonicalInStatic: /<link[^>]+rel=["']canonical["']/i.test(html),

    // The payload a non-JS machine reader actually receives. Everything the
    // answerability pass reasons about comes from here and nowhere else — the
    // whole point is to stop asking the rendered DOM questions the machine
    // never got to see.
    payload: {
      jsonLd: staticItems,
      text: stripped.slice(0, 20000),
      title: titleMatch ? titleMatch[1].trim() : null,
      metaDescription: descMatch ? descMatch[1].trim() : null,
    },
  };
}

/**
 * The JSON surface a storefront exposes.
 *
 * Agents reach for these before they scrape HTML: /cart.js to read cart state,
 * /products.json to enumerate the catalogue. Whether they are open is partly a
 * commercial decision and partly an accident of theme configuration, so this
 * reports what is there rather than what ought to be.
 *
 * @param {string} origin
 */
export async function fetchEndpoints(origin) {
  const probe = async (path) => {
    try {
      const res = await fetch(new URL(path, origin).href, { headers: { 'user-agent': UA } });
      const type = (res.headers.get('content-type') || '').split(';')[0];
      if (!res.ok) return { ok: false, status: res.status, path };
      const body = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* served HTML, or an app shell */ }
      return {
        ok: !!parsed && /json/i.test(type),
        status: res.status,
        contentType: type,
        path,
        // A soft-404 returning the storefront HTML with a 200 is common, and
        // must not read as "the endpoint works".
        servedHtml: !parsed,
        items: Array.isArray(parsed?.products) ? parsed.products.length : undefined,
      };
    } catch (e) {
      return { ok: false, status: null, path, error: (e.message || 'failed').slice(0, 60) };
    }
  };

  const [cartJson, productsJson] = await Promise.all([probe('/cart.js'), probe('/products.json')]);
  return { cartJson, productsJson };
}
