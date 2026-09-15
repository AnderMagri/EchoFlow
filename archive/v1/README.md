# EchoFlow — UX Audit Chrome Extension `v1.6`

EchoFlow is an internal UX audit tool that analyses any website directly in Chrome. It runs rule-based UX audits, captures a full design inventory, detects tech stacks, maps pages for Shopify migration, and lets you run AI-powered analysis with Claude or Gemini — all from a single popup, without leaving the browser.

---

## Install (takes ~1 minute)

> EchoFlow is a developer-mode Chrome extension — no Chrome Web Store required.

### Step 1 — Download

**[⬇ Download EchoFlow.zip](https://github.com/AnderMagri/EchoFlow/raw/main/EchoFlow.zip)**

Save it anywhere and unzip it.

### Step 2 — Load in Chrome

1. Open Chrome and navigate to **`chrome://extensions`**
2. Toggle **Developer mode** ON (top-right corner)
3. Click **Load unpacked**
4. Select the unzipped **`EchoFlow`** folder
5. The EchoFlow icon appears in your toolbar — pin it for quick access

> **Chrome will show a "Developer mode extensions" banner on startup.** This is normal for any extension loaded this way — it's not a security issue.

---

## Setup — API Key (required for AI features)

EchoFlow's AI analysis requires a Claude or Gemini API key.

1. Click the EchoFlow icon → run an audit → open the Results page
2. Click **Settings** (top-right)
3. Choose your provider and paste your API key
4. Keys are stored locally in your browser and only sent to the provider's API

Get a Claude key at [console.anthropic.com](https://console.anthropic.com) · Get a Gemini key at [aistudio.google.com](https://aistudio.google.com)

---

## The Popup — 4 Tabs

### Design
Scans the current page and extracts a full design inventory in seconds.

- **Health Score (0–100)** — weighted across Color, Typography, Layout, and Accessibility
- **Color System** — full palette with tokens, raw values, effects, and A11Y contrast check
- **Typography** — font families, sizes, weights, line heights, letter spacing
- **Layout & Structure** — spacing base unit, Flex/Grid/Block distribution, container widths, column patterns
- **Accessibility** — heading hierarchy, alt text, ARIA, contrast issues
- **Tech Stack** — detects UI framework, icon library, CMS, analytics, and more

### Page Review
Runs a full rule-based UX audit of the current page.

1. Choose your **vertical** — Generic UX, Shopify, Fintech, or Crypto
2. Choose a **page type** — Homepage, Landing Page, Pricing, PDP, Checkout… (varies by vertical)
3. Choose your **device** — Desktop, Mobile (390×844), Tablet (820×1180), or Compare
4. Choose **screenshot mode** — Viewport or Full Page
5. Click **Run Audit**

The results page opens with rule-based findings, ICE scores, screenshot markers, and AI analysis.

### Explorer
Maps and understands the full structure of a site.

- **Detect Tech Stack** — identifies UI framework, CMS, analytics, and more without running a full audit
- **Discover Pages** — crawls the site via sitemap or link-crawl and groups pages by template type
- **Recent Explorations** — quick access to previously crawled sites; reload any discovery into the Page Review tab

### Migration
Evaluates how well the current site can be rebuilt in Shopify.

- **Analyse Current Page** — maps sections and components to Shopify equivalents (Native / App / Custom)
- **Analyse Whole Site** — runs the analysis across all page types discovered by Explorer, produces a full component inventory and theme recommendation

---

## Results Page

After a Page Review audit the results page opens with:

| Tab | What you get |
|-----|-------------|
| **Rules** | Rule-based findings with ICE scores and numbered markers on the screenshot |
| **Design** | Full design inventory — colors, typography, spacing, layout system, shadows, images |
| **AI Analysis** | UX analysis with vision (reads the screenshot), dark pattern scan, copy intelligence |
| **Compare** | Side-by-side desktop vs mobile findings |

### AI Analysis (requires API key)
- **UX Analysis** — top issues, quick wins, UX score, design score. Includes **Vision Layer**: Claude reads the actual screenshot for visual hierarchy critique
- **Dark Pattern Detector** — scans for 12 manipulative UI patterns with EU DSA / GDPR / US FTC / CCPA regulatory references
- **Copy Intelligence** — scores value proposition, CTAs, headlines, reading level, trust signals, microcopy, emotional resonance. Includes rewrite suggestions

### Export
- **Save** as `.echoflow` file (reimport anytime)
- **Figma Presentation** — auto-generates slides per finding
- **PDF Report**
- **Copy for Notion** — markdown formatted
- **Copy JSON for Claude**

---

## Updating

When a new version is available:

1. [Re-download EchoFlow.zip](https://github.com/AnderMagri/EchoFlow/raw/main/EchoFlow.zip) and replace the contents of your folder
2. Go to `chrome://extensions`
3. Click the **↺ refresh** icon on the EchoFlow card

---

## Requirements

- Google Chrome (version 109+)
- Claude API key **or** Gemini API key for AI features (optional — rule-based audit works without a key)

---

## Questions?

Ping **@andermagri** on Slack.
