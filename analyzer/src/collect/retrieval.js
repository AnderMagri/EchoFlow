/**
 * Site-level signal collection.
 *
 * The fetching primitives live in core/fetch-signals.js so the extension can
 * use them too; this module adds the one thing a browser cannot do — setting a
 * User-Agent to probe as a named crawler.
 *
 * @module analyzer/collect/retrieval
 */

import {
  compareStatic, fetchEndpoints, fetchLlmsTxt, fetchRobots,
} from '../../../core/fetch-signals.js';

export { compareStatic, fetchEndpoints, fetchLlmsTxt, fetchRobots };

/**
 * Everything that is true of the site rather than of one page.
 *
 * @param {string} origin
 * @param {(m:string)=>void} [log]
 * @param {{probeUrls?:string[]}} [opts] pass urls to additionally probe what
 *   the server actually serves each crawler; omit to skip the probe entirely.
 */
export async function collectSiteSignals(origin, log = () => {}, opts = {}) {
  log('  reading robots.txt and llms.txt');
  const [robots, llmsTxt] = await Promise.all([fetchRobots(origin), fetchLlmsTxt(origin)]);
  const blocked = Object.entries(robots.agents || {}).filter(([, v]) => v.state === 'blocked');
  if (robots.present) log(`  robots.txt: ${blocked.length} AI crawler(s) blocked of ${Object.keys(robots.agents).length}`);
  else log('  robots.txt: not found');

  const endpoints = await fetchEndpoints(origin);
  log(`  endpoints: /cart.js ${endpoints.cartJson.ok ? 'open' : 'not available'} · /products.json ${endpoints.productsJson.ok ? 'open' : 'not available'}`);

  let probe = null;
  if (opts.probeUrls?.length) {
    const { probeCrawlers } = await import('./probe.js');
    probe = await probeCrawlers({ urls: opts.probeUrls, log });
  }

  return { robots, llmsTxt, probe, endpoints, origin };
}
