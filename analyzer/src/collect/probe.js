/**
 * Crawler probe — what a site ACTUALLY serves an AI crawler.
 *
 * robots.txt is a stated policy. It is not behaviour. Plenty of storefronts sit
 * behind bot protection that challenges or refuses `GPTBot` at the edge while
 * robots.txt says the crawler is welcome, and nothing in the file reveals that.
 * The only way to know is to ask.
 *
 * So this sends a real request with each crawler's declared user-agent and
 * records what comes back: the status, whether the body is materially smaller
 * than what a browser receives, and whether it looks like a challenge page.
 *
 * Deliberately small: a couple of representative URLs, sequential, with a pause
 * between requests. This is a diagnostic on a site you are auditing, not a
 * crawl, and it should cost the origin almost nothing.
 *
 * @module analyzer/collect/probe
 */

import { AI_CRAWLERS } from '../../../core/observation.js';

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Crawlers actually worth probing — the ones that feed answer engines. */
const PROBE_AGENTS = ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'];

/** Real declared user-agent strings, as each operator documents them. */
const UA_STRINGS = {
  GPTBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
  'OAI-SearchBot': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
  ClaudeBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +claudebot@anthropic.com',
  PerplexityBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot',
  'Google-Extended': 'Mozilla/5.0 (compatible; Google-Extended/1.0; +https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers)',
};

/** Signatures of an interstitial rather than the page. */
const CHALLENGE = /just a moment|checking your browser|cf-browser-verification|enable javascript and cookies|attention required|access denied|__cf_chl|px-captcha|are you a robot/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probeOnce(url, ua, timeout = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'user-agent': ua }, redirect: 'follow', signal: ctl.signal });
    const body = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      bytes: body.length,
      challenged: CHALLENGE.test(body.slice(0, 4000)),
      contentType: (res.headers.get('content-type') || '').split(';')[0],
    };
  } catch (e) {
    return { status: null, ok: false, bytes: 0, challenged: false, error: (e.message || 'request failed').slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} opts
 * @param {string[]} opts.urls  representative pages; only the first few are used
 * @param {number} [opts.sample] how many URLs to probe
 * @param {(m:string)=>void} [opts.log]
 */
export async function probeCrawlers({ urls, sample = 2, log = () => {} }) {
  const targets = urls.slice(0, sample);
  if (!targets.length) return { ran: false, reason: 'no urls to probe' };

  log(`  probing ${PROBE_AGENTS.length} crawler agents against ${targets.length} page(s)`);
  const results = {};

  for (const url of targets) {
    // Baseline first: without it a 403 for a crawler is indistinguishable from
    // a site that is simply down.
    const baseline = await probeOnce(url, BROWSER_UA);
    await sleep(250);

    for (const agent of PROBE_AGENTS) {
      const r = await probeOnce(url, UA_STRINGS[agent]);
      await sleep(250);

      // Materially thinner than the browser got — served a stub.
      const thin = baseline.ok && r.ok && baseline.bytes > 0
        && r.bytes / baseline.bytes < 0.5;

      const state = !baseline.ok ? 'baseline-failed'
        : r.status === 403 || r.status === 401 ? 'refused'
          : r.status === 429 ? 'rate-limited'
            : r.challenged ? 'challenged'
              : !r.ok ? 'error'
                : thin ? 'partial'
                  : 'served';

      (results[agent] ||= { agent, observations: [] }).observations.push({
        url, state, status: r.status, bytes: r.bytes,
        baselineBytes: baseline.bytes, error: r.error,
      });
    }
  }

  // Collapse per agent: the worst outcome seen is the one that matters.
  const RANK = { served: 0, partial: 1, 'rate-limited': 2, challenged: 3, refused: 4, error: 5, 'baseline-failed': 6 };
  const agents = {};
  for (const [agent, data] of Object.entries(results)) {
    const worst = data.observations.reduce((w, o) => (RANK[o.state] > RANK[w.state] ? o : w), data.observations[0]);
    agents[agent] = {
      state: worst.state,
      status: worst.status,
      detail: worst,
      operator: (AI_CRAWLERS.find((c) => c.agent === agent) || {}).operator || null,
    };
  }

  const refused = Object.entries(agents).filter(([, v]) => ["refused", "challenged"].includes(v.state));
  log(`  probe: ${refused.length} of ${PROBE_AGENTS.length} agents refused or challenged`);

  return { ran: true, agents, pagesProbed: targets, probedAt: new Date().toISOString() };
}
