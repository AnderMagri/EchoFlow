/**
 * Page discovery — which pages is it worth measuring?
 *
 * A site run needs a representative SAMPLE, not every URL. Ten well-chosen
 * pages measure consistency better than two hundred, because the question is
 * "do pages of the same type agree" — which needs a FEW of each type, not all
 * of them. Crawling everything costs time and adds nothing.
 *
 * Lives in core/ because both surfaces need it, same rule as `fetch-signals.js`.
 * The CLI has always had it; without it the extension could only ever be driven
 * by hand, and hand-picking is exactly where a run goes wrong — someone adds
 * three pages, none of them the same type, and every comparative dimension
 * skips. Discovery is what makes the comparative half of the tool reachable
 * without the user knowing which pages it needs.
 *
 * Nothing here renders a page. It decides on a LIST; the caller does the
 * expensive part (a browser tab, or Playwright). Keeping those apart is what
 * lets the extension show the list for confirmation before it opens anything.
 *
 * @module core/discover
 */

import { inferSurface } from './observation.js';

/**
 * How many of each surface is enough to measure agreement.
 *
 * Two of a type is the minimum that proves anything; four PDPs is where the
 * theme's real variance shows. `account` and `checkout` are zero because they
 * need a session — a logged-out render measures the login wall, not the store.
 */
export const QUOTA = {
  home: 1, pdp: 4, plp: 3, cart: 1, search: 1, content: 2, account: 0, checkout: 0,
};

/**
 * Assets are not pages. Rendering a stylesheet produces a plausible-looking
 * observation full of browser defaults, which then pollutes the site's
 * vocabulary — so this filter is load-bearing, not tidiness.
 */
const ASSET_EXT = /\.(css|js|mjs|json|xml|txt|ico|png|jpe?g|gif|svg|webp|avif|pdf|zip|mp4|webm|woff2?|ttf|eot|rss|atom)(\?|$)/i;

/** URLs that are never worth measuring even though they are HTML. */
const SKIP_PATH = /\/(cdn|assets|checkouts?|account|admin|apps|services|\.well-known)\//i;

const UA = 'EchoFlow/2.0 (+consistency audit)';

/**
 * A browser refuses to let a page set `user-agent` — it is a forbidden header
 * name, silently dropped rather than an error. Sending it anyway would be
 * harmless but dishonest about what the request actually looked like, so it
 * only goes on where it survives.
 */
const headers = () => (typeof window === 'undefined' ? { 'user-agent': UA } : {});

export function isPageUrl(url) {
  if (ASSET_EXT.test(url)) return false;
  if (SKIP_PATH.test(url)) return false;
  return true;
}

/**
 * @param {object} opts
 * @param {string} opts.origin
 * @param {number} [opts.limit]
 * @param {(m:string)=>void} [opts.log]
 * @returns {Promise<string[]>} live, deduplicated page URLs, quota-sampled
 */
export async function discoverPages({ origin, limit = 12, log = () => {} }) {
  const base = new URL(origin);
  const found = new Set([base.origin + '/']);

  for (const path of ['/sitemap.xml', '/sitemap_index.xml']) {
    try {
      const urls = await readSitemap(new URL(path, base.origin).href, log);
      urls.forEach((u) => found.add(u));
      if (urls.length) break;
    } catch { /* fall through to the link crawl */ }
  }

  if (found.size < 4) {
    log('  sitemap thin — crawling links');
    try {
      for (const u of await crawl(base.origin, log)) found.add(u);
    } catch { /* keep whatever we have */ }
  }

  // Worth probing because a sitemap will not list them — but only kept if they
  // actually resolve, which verifyPages decides.
  const probes = ['/collections/all', '/cart', '/search?q=a']
    .map((p) => new URL(p, base.origin).href);

  const candidates = [...found, ...probes]
    .filter((u) => u.startsWith(base.origin) && isPageUrl(u));

  const sampled = quotaSample(candidates, limit * 2, log);
  const live = await verifyPages(sampled, log);
  return live.slice(0, limit);
}

async function readSitemap(url, log, depth = 0) {
  if (depth > 2) return [];
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return [];
  const xml = await res.text();

  const nested = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>(.*?)<\/loc>/g)].map((m) => m[1].trim());
  if (nested.length) {
    log(`  sitemap index: ${nested.length} child sitemaps`);
    const out = [];
    for (const child of nested.slice(0, 5)) out.push(...await readSitemap(child, log, depth + 1));
    return out;
  }
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].trim());
  if (locs.length) log(`  sitemap: ${locs.length} urls`);
  return locs;
}

/**
 * Two-level crawl. One level is not enough: on most storefronts the homepage
 * links to collections, and the products only appear one hop further in. A
 * depth-1 crawl therefore finds zero PDPs, which silently disables every
 * comparative check that matters most.
 */
async function crawl(origin, log, maxDepth = 2) {
  const seen = new Set([origin]);
  const collected = new Set();
  let frontier = [origin];

  for (let depth = 0; depth < maxDepth; depth++) {
    const next = [];
    // A handful of pages per level is plenty to surface the link shapes.
    for (const url of frontier.slice(0, 6)) {
      let html;
      try {
        const res = await fetch(url, { headers: headers() });
        if (!res.ok) continue;
        if (!/text\/html/i.test(res.headers.get('content-type') || '')) continue;
        html = await res.text();
      } catch { continue; }

      for (const m of html.matchAll(/href=["']([^"']+)["']/g)) {
        let href;
        try { href = new URL(m[1], url).href.split('#')[0]; } catch { continue; }
        if (!href.startsWith(origin) || seen.has(href) || !isPageUrl(href)) continue;
        seen.add(href);
        collected.add(href);
        next.push(href);
      }
    }
    // Follow listing pages first — that is where product links live.
    frontier = next.sort((a, b) => score(b) - score(a));
    if (!frontier.length) break;
  }
  log(`  crawled ${collected.size} candidate pages`);
  return [...collected];
}

const score = (u) => (/\/collections\//.test(u) ? 2 : /\/products\//.test(u) ? 1 : 0);

/**
 * Confirm each candidate is a live HTML page before we spend a browser on it.
 * A 404 still renders, and its styles are the theme's error page, not the
 * site's — measuring it would quietly corrupt the vocabulary.
 *
 * Capped concurrency because this now runs from a client's browser as well as
 * from a CLI: two dozen simultaneous requests at someone's storefront is the
 * kind of thing that gets an audit tool rate-limited and then blamed.
 */
async function verifyPages(urls, log, concurrency = 6) {
  const live = new Set();
  const dropped = [];
  const queue = [...urls];

  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        let res = await fetch(url, { method: 'HEAD', headers: headers(), redirect: 'follow' });
        // Some servers refuse HEAD; fall back rather than dropping a real page.
        if (res.status === 405 || res.status === 501) {
          res = await fetch(url, { headers: headers() });
        }
        const type = res.headers.get('content-type') || '';
        if (res.ok && (!type || /text\/html/i.test(type))) live.add(url);
        else dropped.push(`${url} (${res.status})`);
      } catch {
        dropped.push(`${url} (unreachable)`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));

  if (dropped.length) log(`  dropped ${dropped.length} dead or non-HTML url(s)`);
  return urls.filter((u) => live.has(u));
}

/** Take up to QUOTA of each surface, so every template type gets peers to compare. */
function quotaSample(urls, limit, log) {
  const buckets = {};
  for (const url of urls) {
    const s = inferSurface(url);
    (buckets[s] ||= []).push(url);
  }
  const picked = [];
  for (const [surface, list] of Object.entries(buckets)) {
    const want = QUOTA[surface] ?? 1;
    picked.push(...list.slice(0, want));
  }
  const summary = Object.entries(buckets)
    .map(([s, l]) => `${s}:${Math.min(l.length, QUOTA[s] ?? 1)}`).join(' ');
  log(`  sampled ${Math.min(picked.length, limit)} pages — ${summary}`);
  return picked.slice(0, limit);
}
