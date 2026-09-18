/**
 * The Playwright collector.
 *
 * Renders the URL server-side and reads the real post-JS DOM. Not a screenshot:
 * a screenshot is pixels that have to be re-interpreted, while this is the
 * structured state the page actually reached.
 *
 * It runs the SAME collector function the extension injects, so the two paths
 * cannot drift.
 *
 * @module analyzer/collect/browser
 */

import { chromium } from 'playwright';
import { collectFromDocument } from '../../../core/collect-dom.js';
import { inferSurface } from '../../../core/observation.js';
import { compareStatic } from './retrieval.js';

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, label: 'desktop' },
  mobile: { width: 390, height: 844, label: 'mobile', isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
};

/**
 * @param {object} opts
 * @param {string[]} opts.urls
 * @param {('desktop'|'mobile')[]} [opts.viewports]
 * @param {number} [opts.timeout]
 * @param {(msg:string)=>void} [opts.log]
 * @returns {Promise<{observations:object[], errors:{url:string,error:string}[]}>}
 */
export async function collectPages({ urls, viewports = ['desktop'], timeout = 30000, log = () => {} }) {
  const browser = await chromium.launch(launchOptions());
  const observations = [];
  const errors = [];

  try {
    for (const vpName of viewports) {
      const vp = VIEWPORTS[vpName];
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: vp.width, height: vp.height },
        isMobile: !!vp.isMobile,
        hasTouch: !!vp.hasTouch,
        deviceScaleFactor: vp.deviceScaleFactor || 1,
        userAgent: vp.isMobile
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
          : undefined,
      });

      for (const url of urls) {
        try {
          log(`  ${vpName}  ${url}`);
          const page = await context.newPage();

          // LCP has to be observed before it is read, so the observer is
          // installed before navigation rather than queried afterwards.
          await page.addInitScript(() => {
            window.__lcp = 0;
            window.__cls = 0;
            try {
              new PerformanceObserver((list) => {
                const entries = list.getEntries();
                window.__lcp = entries[entries.length - 1].startTime;
              }).observe({ type: 'largest-contentful-paint', buffered: true });
              new PerformanceObserver((list) => {
                for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
              }).observe({ type: 'layout-shift', buffered: true });
            } catch (e) { /* older engines */ }
          });

          await page.goto(url, { waitUntil: 'networkidle', timeout });
          // Lazy-loaded sections below the fold are part of the page. Scroll so
          // they exist before the tree is captured, or the skeleton is a lie.
          await autoScroll(page);
          await page.waitForTimeout(400);

          const surface = inferSurface(url);
          const raw = await page.evaluate(collectFromDocument, { surface, viewportLabel: vp.label });
          const vitals = await page.evaluate(() => ({ lcp: Math.round(window.__lcp || 0), cls: +(window.__cls || 0).toFixed(4) }));

          raw.engine.vitals.lcp = vitals.lcp || raw.engine.vitals.lcp;
          raw.engine.vitals.cls = vitals.cls;
          raw.surface = surface;

          // What a crawler that does not run JavaScript would have received.
          // Only worth doing once per URL, not once per viewport.
          if (vpName === viewports[0]) {
            raw.retrieval.static = await compareStatic(url, raw.retrieval);
          }

          observations.push(raw);
          await page.close();
        } catch (err) {
          errors.push({ url, error: err.message.split('\n')[0] });
          log(`  !! ${url} — ${err.message.split('\n')[0]}`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  return { observations, errors };
}

/**
 * Launch options that survive a sandboxed or proxied environment. Both are
 * opt-in via env: nothing here changes behaviour on a normal machine.
 */
function launchOptions() {
  const opts = { args: ['--disable-dev-shm-usage'] };
  if (process.env.ECHOFLOW_CHROMIUM) opts.executablePath = process.env.ECHOFLOW_CHROMIUM;
  if (process.env.ECHOFLOW_NO_SANDBOX) opts.args.push('--no-sandbox');
  // Corporate/agent proxies: Chromium does not read HTTPS_PROXY on its own.
  const proxy = process.env.ECHOFLOW_PROXY || process.env.HTTPS_PROXY;
  if (proxy) opts.proxy = { server: proxy };
  return opts;
}

/** Walk the page so lazy content renders before the tree is read. */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const step = 600;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        y += step;
        if (y >= document.body.scrollHeight - window.innerHeight || y > 25000) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          setTimeout(resolve, 150);
        }
      }, 60);
    });
  });
}
