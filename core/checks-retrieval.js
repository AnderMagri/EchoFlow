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
import { BUYER_QUESTIONS, evaluateAnswerability } from './answerability.js';

const firstWith = (obs, fn) => obs.find(fn) || null;

/** "a", "a and b", "a, b and c" — titles are read aloud to clients. */
function listPhrase(items) {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
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
    id: 'crawler-probe',
    axis: 'engine',
    run(ctx) {
      const probe = ctx.siteSignals?.probe;
      if (!probe?.ran) return [];

      const stated = ctx.siteSignals?.robots?.agents || {};
      const turnedAway = Object.entries(probe.agents)
        .filter(([, v]) => ['refused', 'challenged', 'partial'].includes(v.state));
      if (!turnedAway.length) return [];

      // The interesting case is DISAGREEMENT: robots.txt welcomes the crawler
      // and the server does not. That gap is invisible to every tool that only
      // reads robots.txt, and it is usually bot protection nobody connected to
      // the answer-engine question.
      const contradicting = turnedAway.filter(([agent]) => {
        const policy = stated[agent]?.state;
        return policy === 'allowed' || policy === 'partial';
      });

      const out = [];
      if (contradicting.length) {
        out.push(createFinding({
          checkId: 'engine-crawler-blocked-at-edge', axis: 'engine', surface: 'site',
          scope: 'extractive', basis: 'practice',
          title: `${contradicting.length} crawler${contradicting.length === 1 ? ' is' : 's are'} permitted by robots.txt but turned away by the server`,
          // Almost always unintentional: someone enabled bot protection and
          // nobody connected it to the answer-engine question.
          impact: 7, effort: 5,
          evidence: {
            agents: contradicting.map(([agent, v]) => ({
              agent, operator: v.operator, observed: v.state, status: v.status,
              statedPolicy: stated[agent]?.state || 'unknown',
              bytes: v.detail?.bytes, browserBytes: v.detail?.baselineBytes,
            })),
            pagesProbed: probe.pagesProbed,
            method: 'Each page was requested with the crawler\u2019s declared user-agent and compared against the same request from a browser user-agent.',
            caveat: 'A single probe from one address. Rate limiting and geography can produce a refusal that is not a standing policy \u2014 re-run before acting on it.',
          },
          recommendation: 'robots.txt says these are welcome and the edge disagrees, which is nearly always a bot-protection rule nobody connected to this question. Allow the agents you meant to allow at the CDN or WAF, or change robots.txt so the stated policy matches what actually happens.',
        }));
      }

      const consistent = turnedAway.filter(([agent]) => stated[agent]?.state === 'blocked');
      if (consistent.length && !contradicting.length) {
        out.push(createFinding({
          checkId: 'engine-crawler-block-confirmed', axis: 'engine', surface: 'site',
          scope: 'extractive', basis: 'practice',
          title: `${consistent.length} crawler block${consistent.length === 1 ? '' : 's'} confirmed at the server, matching robots.txt`,
          impact: 2, effort: 10,
          evidence: {
            agents: consistent.map(([agent, v]) => ({ agent, operator: v.operator, observed: v.state, status: v.status })),
            note: 'Stated policy and observed behaviour agree. Recorded so the decision is visible, not because anything is wrong.',
          },
          recommendation: 'Nothing to do if this was intended \u2014 the block is real and enforced, which is what a deliberate policy should look like.',
        }));
      }
      return out;
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

  // ===== ANSWERABILITY ====================================================
  // Availability asks "can a machine reach this". This asks the question
  // underneath it: "so can it answer anything?"

  {
    id: 'answerability',
    axis: 'engine',
    run(ctx) {
      const results = uniquePages(ctx.observations)
        .map(evaluateAnswerability)
        .filter(Boolean);
      if (!results.length) return [];

      const measurable = results.filter((r) => r.measurable);
      if (!measurable.length) {
        // Say so rather than scoring what was not measured.
        return [createFinding({
          checkId: 'engine-answerability-unmeasured', axis: 'engine', surface: 'site',
          scope: 'extractive', basis: 'practice',
          title: 'Answerability could not be measured — the un-rendered HTML was not fetched',
          impact: 2, effort: 10,
          evidence: { pages: results.length, reason: results[0].reason },
          recommendation: 'Run the analyser against a reachable URL so it can fetch the raw response. Without it there is no machine payload to reason about, and guessing from the rendered DOM would answer the wrong question.',
        })];
      }
      const out = [];

      // Group by surface: "PDPs cannot answer price" is one story about a
      // template, not one finding per product.
      const bySurface = new Map();
      for (const r of measurable) {
        if (!bySurface.has(r.surface)) bySurface.set(r.surface, []);
        bySurface.get(r.surface).push(r);
      }

      for (const [surface, pages] of bySurface) {
        const total = BUYER_QUESTIONS[surface].length;
        // A question counts as unanswerable for the template only if it fails
        // on every page of that type — one odd product is not a template fault.
        const alwaysMissing = BUYER_QUESTIONS[surface]
          .filter((q) => pages.every((p) => p.unanswered.some((u) => u.id === q.id)));
        if (!alwaysMissing.length) continue;

        const criticalMissing = alwaysMissing.filter((q) => q.critical);
        const worst = pages.sort((a, b) => a.score - b.score)[0];

        out.push(createFinding({
          checkId: `engine-unanswerable-${surface}`, axis: 'engine', surface,
          scope: 'extractive', basis: 'practice', url: worst.url,
          title: criticalMissing.length
            ? `A machine reader cannot recover ${listPhrase(criticalMissing.map((q) => q.short || q.id))} from ${surface.toUpperCase()} pages`
            : `${alwaysMissing.length} buyer question${alwaysMissing.length === 1 ? '' : 's'} unanswerable from ${surface.toUpperCase()} pages`,
          impact: criticalMissing.length ? Math.min(9, 6 + criticalMissing.length) : 4,
          effort: 6,
          evidence: {
            surface,
            pagesChecked: pages.length,
            answerable: `${total - alwaysMissing.length} of ${total}`,
            unanswerable: alwaysMissing.map((q) => ({ id: q.id, question: q.question, critical: !!q.critical })),
            answeredOn: worst.answered.map((a) => ({ question: a.question, value: a.value, from: a.from })),
            method: 'Resolved from the un-rendered HTML only — the payload a crawler that does not execute JavaScript receives. Template placeholders such as {{ price }} count as unresolved, because a field-presence check would score them as present.',
          },
          recommendation: criticalMissing.length
            ? `These are the questions a shopping query actually asks. Emit ${listPhrase(criticalMissing.map((q) => q.short || q.id))} server-side in the markup, so each answer is a value rather than something to be inferred from prose.`
            : 'Worth closing if these pages are meant to be quotable by assistants. None of them are load-bearing on their own.',
        }));
      }

      // Recoverable, but only by reading prose — a real but weaker answer.
      const proseHeavy = measurable.filter((r) => r.proseOnly.length >= 2);
      if (proseHeavy.length >= 2) {
        out.push(createFinding({
          checkId: 'engine-answers-prose-only', axis: 'engine', surface: ctx.scopeSurface,
          scope: 'extractive', basis: 'practice',
          title: `${proseHeavy.length} pages answer buyer questions only in prose, not in markup`,
          impact: 4, effort: 7,
          evidence: {
            pages: proseHeavy.slice(0, 5).map((r) => ({
              url: r.url,
              proseOnly: r.proseOnly.map((a) => ({ question: a.question, value: a.value })),
            })),
            why: 'The facts are on the page and a reader has to parse them out of sentences. Structured markup turns the same fact into a value, which is the difference between being quoted correctly and being quoted approximately.',
          },
          recommendation: 'Move these into the Product markup. The content already exists — this is labelling it, not writing it.',
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
      // Fully answerable product pages are worth naming — it is the outcome
      // every other retrieval check is a proxy for.
      const answerable = pages
        .map(evaluateAnswerability)
        .filter((r) => r && r.measurable && !r.criticalMissing.length && r.surface === 'pdp');
      if (answerable.length) {
        out.push(createFinding({
          checkId: 'strength-answerable-pdp', axis: 'engine', surface: 'pdp',
          kind: 'strength', scope: 'extractive', basis: 'practice',
          title: 'A machine reader can answer every critical buyer question from the product pages',
          impact: 8, effort: 10,
          evidence: {
            pages: answerable.length,
            example: answerable[0].url,
            answered: answerable[0].answered.map((a) => ({ question: a.question, from: a.from })),
          },
          recommendation: 'This is the outcome the rest of the retrieval checks are proxies for. Protect it through the rebuild: name, price, currency and availability must stay in server-rendered markup.',
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
