# Archive — EchoFlow v1

Everything in `v1/` is the **retired** screenshot-based EchoFlow (v1.6). It is kept
for reference only: rule content, Shopify knowledge, and extraction heuristics were
mined from here while building 2.0.

**Nothing in 2.0 imports from this folder.** There is no shared code, no shared
storage keys, no shared manifest. v1 and 2.0 can be installed side by side.

Why it was retired — see `../docs/CONCEPT.md`: v1 was organised around *what the
tool could extract* (five equal-weight axes, each dumping what it found). That
answers "what's on this site?" It never answers "how far is this site from a clean
system, and what do I fix first?"

What was carried forward, rewritten clean:

| From v1 | Into 2.0 |
|---|---|
| `knowledge-base/shopify-adapt/*.json` | `knowledge/shopify/*.json` — verbatim, it is domain knowledge |
| `engine.js` check predicates | `core/checks/*.js` — reimplemented against the Finding schema |
| `content.js` style harvesting | `core/tokens.js` + `extension/content/collect.js` |
| Rule corpora (`shopify.json`, `generic-ux.json`) | Folded into axis check packs, Shopify-only |
