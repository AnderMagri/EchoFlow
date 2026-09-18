/**
 * Machine-retrieval checks — how findable and parseable the content is to a
 * non-human reader.
 *
 * Three honesty constraints shape this file, and they matter more here than
 * anywhere else in the tool because this is the area where confident nonsense
 * is easiest to produce:
 *
 * 1. **Crawler behaviour changes.** Which agents run JavaScript, which respect
 *    which directives, and which exist at all moves every few months. Nothing
 *    here is `prescriptive` — there is no standards body for this. It is all
 *    `practice`, and the evidence says so.
 *
 * 2. **Blocking AI crawlers is a decision, not a defect.** A brand may refuse
 *    training crawlers deliberately. Findings report the state and ask for
 *    confirmation; they never assume it was an accident.
 *
 * 3. **No traffic claims.** Being retrievable is not the same as being cited,
 *    and nobody has a credible model of the second. The recommendations talk
 *    about what a machine can and cannot read, and stop there.
 *
 * @module core/checks-retrieval
 */

import { createFinding } from './finding.js';
import { EXPECTED_SCHEMA } from './observation.js';

const firstWith = (obs, fn) => obs.find(fn) || null;
/** One entry per URL — markup does not change between viewports. */
function uniquePages(observations) {
  const seen = new Set();
  return observations.filter((o) => !seen.has(o.url) && seen.add(o.url));
}

export const RETRIEVAL_CHECKS = [

  // ===== SITE LEVEL =======================================================

  {
    id: 'ai-crawler-access',
    axis: 'engine',
    run(ctx) {
      const robots = ctx.siteSignals?.robots;
      if (!robots) return [];

      if (!robots.present) {
        return [createFinding({
          checkId: 'engine-no-robots-txt', axis: 'engine', surface: 'site',
          scope: 'extractive', basis: 'practice',
          title: 'No robots.txt found',
          impact: 3, effort: 9,
          evidence: { checked: `${ctx.siteSignals.origin}/robots.txt`, note: 'Absence means crawlers apply their own defaults, which differ between operators.' },
          recommendation: 'Add one, even if it allows everything. It is the file that states the policy, and without it the policy is whatever each crawler assumes.',
        })];
      }

      const blocked = Object.entries(robots.agents).filter(([, v]) => v.state === 'blocked');
      if (!blocked.length) return [];

      const explicit = blocked.filter(([, v]) => v.by.includes('explicit'));
      const byWildcard = blocked.filter(([, v]) => !v.by.includes('explicit'));

      return [createFinding({
        checkId: 'engine-ai-crawlers-blocked', axis: 'engine', surface: 'site',
        scope: 'extractive', basis: 'practice',
        title: `robots.txt blocks ${blocked.length} AI crawler${blocked.length === 1 ? '' : 's'}${byWildcard.length ? ' — some via a wildcard rule' : ''}`,
        // Deliberate or not, the reader needs to know. Impact reflects how
        // likely it is to be unintentional, not how bad blocking is.
        impact: byWildcard.length ? 6 : 3,
        effort: 9,
        evidence: {
          blocked: blocked.map(([agent, v]) => ({ agent, operator: v.operator, purpose: v.purpose, by: v.by })),
          blockedExplicitly: explicit.map(([a]) => a),
          blockedByWildcard: byWildcard.map(([a]) => a),
          allowed: Object.entries(robots.agents).filter(([, v]) => v.state === 'allowed').map(([a]) => a),
          caveat: 'This list of agents is a snapshot and moves. Crawler names and behaviour change every few months.',
        },
        recommendation: byWildcard.length
          ? `${byWildcard.map(([a]) => a).join(', ')} ${byWildcard.length === 1 ? 'is' : 'are'} blocked by a catch-all rule rather than by name, which is usually accidental — a broad Disallow written for scrapers catches answer engines too. Decide each one deliberately: if the content should be quotable by assistants, allow them by name; if not, keep the block and this finding is answered.`
          : 'These are blocked by name, which reads as deliberate. Nothing to fix if that was the intent — confirm it and this finding is answered.',
      })];
    },
  },

  {
    id: 'llms-txt',
    axis: 'engine',
    run(ctx) {
      const llms = ctx.siteSignals?.llmsTxt;
      if (!llms || llms.present) return [];
      return [createFinding({
        checkId: 'engine-no-llms-txt', axis: 'engine', surface: 'site',
        scope: 'extractive', basis: 'directional',
        title: 'No llms.txt — an emerging convention, not yet established practice',
        // Low impact on purpose: this is genuinely new and adoption is thin.
        impact: 2, effort: 9,
        evidence: {
          checked: ['/llms.txt', '/llms-full.txt'],
          status: 'Proposed at llmstxt.org. Adoption is early and support across assistants is inconsistent.',
          honesty: 'Listed as an opportunity, not a gap. There is no evidence yet that its absence costs anything.',
        },
        recommendation: 'Cheap to add if you want to shape how the catalogue is summarised: a markdown file naming what the store sells, the key collections and the policies. Ignore it without concern if you would rather wait for the convention to settle.',
      })];
    },
  },

  // ===== RENDERING ========================================================

  {
    id: 'content-requires-js',
    axis: 'engine',
    run(ctx) {
      const out = [];
      for (const o of uniquePages(ctx.observations)) {
        const st = o.retrieval?.static;
        if (!st?.fetched) continue;

        const missingH1 = st.h1InStatic === false;
        const thinText = st.textRatio != null && st.textRatio < 0.35;
        const schemaAfterJs = (st.jsonLdOnlyAfterJs || []).length > 0;
        if (!missingH1 && !thinText && !schemaAfterJs) continue;

        const severity = (missingH1 ? 3 : 0) + (thinText ? 3 : 0) + (schemaAfterJs ? 2 : 0);
        out.push(createFinding({
          checkId: `engine-content-requires-js-${o.surface}`, axis: 'engine', surface: o.surface,
          scope: 'extractive', url: o.url, basis: 'practice',
          title: `${o.surface.toUpperCase()} content only appears after JavaScript runs`,
          impact: Math.min(9, 4 + severity),
          effort: 3,
          evidence: {
            url: o.url,
            staticTextLength: st.staticTextLength,
            renderedTextLength: st.renderedTextLength,
            textRatio: st.textRatio,
            h1PresentWithoutJs: st.h1InStatic,
            titlePresentWithoutJs: st.titleInStatic,
            structuredDataOnlyAfterJs: st.jsonLdOnlyAfterJs,
            structuredDataInRawHtml: st.jsonLdTypesInStatic,
            why: 'Many crawlers that feed answer engines take the raw HTML and never execute scripts. What is missing above is what those readers do not receive — the page looks complete to a person and hollow to a machine.',
            caveat: 'Which crawlers execute JavaScript varies by operator and changes. Treat this as "some readers see less", not "no machine can read this".',
          },
          recommendation: 'Render the product name, price, description and JSON-LD server-side. On Shopify that is Liquid output rather than an app or a client-side framework — anything a merchandiser can see in view-source is safe, and anything that only appears in DevTools is not.',
        }));
      }
      return out.slice(0, 4);
    },
  },

  // ===== STRUCTURED DATA ==================================================

  {
    id: 'structured-data-present',
    axis: 'engine',
    run(ctx) {
      const pages = uniquePages(ctx.observations).filter((o) => o.retrieval);
      if (!pages.length) return [];
      const out = [];

      const withNone = pages.filter((o) => !(o.retrieval.jsonLdTypes || []).length);
      if (withNone.length === pages.length) {
        out.push(createFinding({
          checkId: 'engine-no-structured-data', axis: 'engine', surface: 'site',
          scope: 'extractive', basis: 'practice',
          title: 'No structured data anywhere on the site',
          impact: 8, effort: 5,
          evidence: {
            pagesChecked: pages.length,
            expected: EXPECTED_SCHEMA,
            why: 'Structured data is how a machine knows this is a product rather than a page that mentions one — the name, the price, whether it is in stock. Without it, everything has to be inferred from prose.',
          },
          recommendation: 'Add Product with offers (price, currency, availability) to product templates, and Organization to the layout. Most Shopify themes emit this already, so an empty result usually means it was removed or the theme is older than OS 2.0.',
        }));
      }

      // Per-surface expectations, only where we have the page type.
      for (const [surface, expected] of Object.entries(EXPECTED_SCHEMA)) {
        const peers = pages.filter((o) => o.surface === surface);
        if (!peers.length || withNone.length === pages.length) continue;
        const missing = peers.filter((o) => !expected.some((t) => (o.retrieval.jsonLdTypes || []).includes(t)));
        if (!missing.length) continue;
        out.push(createFinding({
          checkId: `engine-missing-schema-${surface}`, axis: 'engine', surface,
          scope: 'extractive', basis: 'practice',
          title: `${missing.length} of ${peers.length} ${surface.toUpperCase()} pages have no ${expected.join(' or ')} markup`,
          impact: surface === 'pdp' ? 7 : 5,
          effort: 6,
          evidence: {
            expected, missingOn: missing.map((o) => o.url).slice(0, 6),
            presentTypes: [...new Set(peers.flatMap((o) => o.retrieval.jsonLdTypes || []))],
          },
          recommendation: `Emit ${expected[0]} from the ${surface.toUpperCase()} template so every page of the type gets it. Per-page markup is how you end up with some pages machine-readable and others not.`,
        }));
      }

      // Product schema that exists but cannot answer the question asked of it.
      const thinProducts = pages.filter((o) => (o.retrieval.jsonLd || [])
        .some((j) => j.type === 'Product' && (!j.offers || !j.offers.price || !j.offers.availability)));
      if (thinProducts.length) {
        out.push(createFinding({
          checkId: 'engine-incomplete-product-schema', axis: 'engine', surface: 'pdp',
          scope: 'extractive', basis: 'practice',
          title: `Product markup on ${thinProducts.length} page${thinProducts.length === 1 ? '' : 's'} is missing price or availability`,
          impact: 6, effort: 7,
          evidence: {
            pages: thinProducts.map((o) => ({
              url: o.url,
              offers: (o.retrieval.jsonLd.find((j) => j.type === 'Product') || {}).offers,
            })).slice(0, 6),
            required: 'offers.price, offers.priceCurrency, offers.availability',
          },
          recommendation: 'Price and availability are the two things a shopping question actually asks. Product markup without them identifies the item and cannot answer anything about buying it.',
        }));
      }

      const broken = pages.filter((o) => (o.retrieval.jsonLdErrors || []).length);
      if (broken.length) {
        out.push(createFinding({
          checkId: 'engine-malformed-jsonld', axis: 'engine', surface: ctx.scopeSurface,
          scope: 'extractive', basis: 'practice',
          title: `Structured data fails to parse on ${broken.length} page${broken.length === 1 ? '' : 's'}`,
          impact: 7, effort: 8,
          evidence: {
            pages: broken.map((o) => ({ url: o.url, errors: o.retrieval.jsonLdErrors })).slice(0, 5),
            note: 'A JSON-LD block that does not parse is not partially read — it is discarded whole.',
          },
          recommendation: 'Usually an unescaped quote or a Liquid variable interpolated without the json filter. In Liquid, pipe values through `| json` rather than quoting them by hand.',
        }));
      }
      return out;
    },
  },

  // ===== PAGE LEGIBILITY ==================================================

  {
    id: 'page-legibility',
    axis: 'engine',
    run(ctx) {
      const pages = uniquePages(ctx.observations).filter((o) => o.retrieval);
      const out = [];

      const noH1 = pages.filter((o) => o.retrieval.h1Count === 0);
      const manyH1 = pages.filter((o) => o.retrieval.h1Count > 1);
      if (noH1.length || manyH1.length) {
        out.push(createFinding({
          checkId: 'engine-h1-structure', axis: 'engine', surface: ctx.scopeSurface,
          scope: 'extractive', basis: 'practice',
          title: noH1.length
            ? `${noH1.length} page${noH1.length === 1 ? ' has' : 's have'} no visible H1`
            : `${manyH1.length} page${manyH1.length === 1 ? ' has' : 's have'} more than one H1`,
          impact: 5, effort: 8,
          evidence: {
            withoutH1: noH1.map((o) => o.url).slice(0, 5),
            withMultipleH1: manyH1.map((o) => ({ url: o.url, count: o.retrieval.h1Count, texts: o.retrieval.h1Text })).slice(0, 5),
            why: 'The H1 is the strongest single statement of what a page is about. Zero leaves it to be guessed; several leave it ambiguous.',
          },
          recommendation: 'One H1 per page, carrying the product or collection name. If several headings look like titles, the others should be H2.',
        }));
      }

      const noDescription = pages.filter((o) => !o.retrieval.metaDescription);
      if (noDescription.length >= Math.max(2, pages.length * 0.3)) {
        out.push(createFinding({
          checkId: 'engine-missing-description', axis: 'engine', surface: ctx.scopeSurface,
          scope: 'extractive', basis: 'practice',
          title: `${noDescription.length} of ${pages.length} pages have no meta description`,
          impact: 4, effort: 8,
          evidence: { pages: noDescription.map((o) => o.url).slice(0, 8) },
          recommendation: 'A short written summary is the one piece of text you control that a machine will quote nearly verbatim. Without it, something gets extracted from the page instead, and it is rarely the sentence you would have chosen.',
        }));
      }

      const boilerplate = pages.filter((o) => o.retrieval.contentRatio > 0 && o.retrieval.contentRatio < 0.35);
      if (boilerplate.length) {
        out.push(createFinding({
          checkId: 'engine-thin-content', axis: 'engine', surface: ctx.scopeSurface,
          scope: 'extractive', basis: 'practice',
          title: `${boilerplate.length} page${boilerplate.length === 1 ? ' is' : 's are'} mostly navigation and footer rather than content`,
          impact: 5, effort: 4,
          evidence: {
            pages: boilerplate.map((o) => ({ url: o.url, contentRatio: o.retrieval.contentRatio,
              mainText: o.retrieval.mainTextLength, totalText: o.retrieval.totalTextLength })).slice(0, 6),
            measure: 'Text inside <main> as a share of all page text.',
          },
          recommendation: 'A reader extracting an answer has to separate the page from its furniture. Put the substance inside a single <main> landmark so the boundary is explicit rather than inferred from position.',
        }));
      }

      // Answer-shaped content that is not marked up as answerable.
      const unmarkedQA = pages.filter((o) => o.retrieval.questionHeadings >= 3 && !o.retrieval.hasFaqSchema);
      if (unmarkedQA.length) {
        out.push(createFinding({
          checkId: 'engine-unmarked-faq', axis: 'engine', surface: ctx.scopeSurface,
          scope: 'extractive', basis: 'practice',
          title: `${unmarkedQA.length} page${unmarkedQA.length === 1 ? ' has' : 's have'} question-shaped headings but no FAQ markup`,
          impact: 5, effort: 7,
          evidence: {
            pages: unmarkedQA.map((o) => ({ url: o.url, questionHeadings: o.retrieval.questionHeadings })).slice(0, 6),
            why: 'The content is already in the shape a question-answering reader wants. FAQPage markup is what makes the pairing explicit instead of inferred from layout.',
          },
          recommendation: 'Wrap the existing question-and-answer blocks in FAQPage markup. The writing is done — this only labels it.',
        }));
      }

      const noLang = pages.filter((o) => !o.retrieval.lang);
      if (noLang.length === pages.length && pages.length) {
        out.push(createFinding({
          checkId: 'engine-no-lang', axis: 'engine', surface: 'site',
          scope: 'extractive', basis: 'prescriptive',
          citation: 'WCAG 2.2 SC 3.1.1 Language of Page, Level A',
          title: 'No lang attribute on the html element',
          impact: 5, effort: 10,
          evidence: { pagesChecked: pages.length },
          recommendation: 'Add lang to <html>. It is one attribute, it is a Level A criterion, and it tells both screen readers and machine readers which language to interpret the content as.',
        }));
      }
      return out;
    },
  },

  // ===== STRENGTH =========================================================

  {
    id: 'retrieval-strengths',
    axis: 'engine',
    run(ctx) {
      const pages = uniquePages(ctx.observations).filter((o) => o.retrieval);
      const serverRendered = pages.filter((o) => o.retrieval.static?.fetched
        && o.retrieval.static.h1InStatic === true
        && (o.retrieval.static.textRatio ?? 0) >= 0.7);
      const withProduct = firstWith(pages, (o) => (o.retrieval.jsonLd || [])
        .some((j) => j.type === 'Product' && j.offers?.price && j.offers?.availability));

      const out = [];
      if (serverRendered.length && serverRendered.length === pages.length) {
        out.push(createFinding({
          checkId: 'strength-server-rendered', axis: 'engine', surface: 'site',
          kind: 'strength', scope: 'extractive', basis: 'practice',
          title: 'Content is in the HTML before JavaScript runs',
          impact: 7, effort: 10,
          evidence: {
            pages: serverRendered.length,
            textRatios: serverRendered.map((o) => ({ url: o.url, ratio: o.retrieval.static.textRatio })).slice(0, 5),
          },
          recommendation: 'Every machine reader gets the full page, including the ones that never execute scripts. Protect this in the rebuild — it is the single thing most easily lost to a client-side framework or an app-rendered section.',
        }));
      }
      if (withProduct) {
        out.push(createFinding({
          checkId: 'strength-product-schema', axis: 'engine', surface: 'pdp',
          kind: 'strength', scope: 'extractive', basis: 'practice',
          title: 'Product markup carries price and availability',
          impact: 6, effort: 10,
          evidence: { example: withProduct.url, offers: (withProduct.retrieval.jsonLd.find((j) => j.type === 'Product') || {}).offers },
          recommendation: 'This is what makes a product answerable rather than merely identifiable. Keep the offers block complete through the migration.',
        }));
      }
      return out;
    },
  },
];
