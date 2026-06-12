# EchoFlow — UX Audit Chrome Extension

EchoFlow is an internal UX audit tool that analyses any website directly in Chrome. It evaluates UX rules, captures a full design inventory, runs mobile analysis, maps pages to Shopify, and lets you run AI-powered analysis with Claude or Gemini — all without leaving the browser.

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

EchoFlow's AI analysis (UX insights, dark pattern detection, copy intelligence) requires a Claude or Gemini API key.

1. Click the EchoFlow icon → run an audit → open the Results page
2. Click **Settings** (top-right)
3. Choose your provider and paste your API key
4. Keys are stored locally in your browser and only sent to the provider's API

Get a Claude key at [console.anthropic.com](https://console.anthropic.com) · Get a Gemini key at [aistudio.google.com](https://aistudio.google.com)

---

## How to run an audit

1. Navigate to the page you want to audit
2. Click the **EchoFlow icon** in your toolbar
3. Choose your **vertical** (Generic UX, Shopify, Fintech, Crypto)
4. Choose your **device** (Desktop, Mobile, Tablet, or Compare)
5. Optionally select a **page type** (Home, PDP, Checkout…)
6. Click **Start Audit**

The results page opens with:

| Tab | What you get |
|-----|-------------|
| **Rules** | Rule-based findings with ICE scores, markers on the screenshot |
| **Design** | Full design inventory — colors, typography, spacing, layout system, shadows, images |
| **AI Analysis** | GPT-quality UX analysis with vision (reads the screenshot), dark pattern scan, copy intelligence |
| **Compare** | Side-by-side desktop vs mobile findings |

---

## Features

### Audit Engine
- **5 rule sets** — Generic UX, Shopify, Fintech, Crypto, Mobile
- **ICE scoring** (Impact × Confidence × Ease) for every finding
- **Full-page screenshot** with numbered markers linked to each finding
- **Mobile emulation** via Chrome DevTools Protocol (real device profiles)
- **Compare mode** — runs desktop + mobile simultaneously, shows delta findings

### Design Inventory
- Color palette, typography, font sizes, line heights, letter spacing
- **Layout System** — spacing base unit, Flex/Grid/Block distribution, column patterns, gap values, container widths
- Border radii, shadows, text alignment
- Image format breakdown (WebP, AVIF, SVG, PNG, JPG) + lazy loading detection
- Logo extraction (SVG download), SVG inventory, icon library detection, UI framework detection

### Design Health Score (0–100)
Automatic warnings for: too many fonts, color sprawl, arbitrary spacing, inconsistent corners, broken heading hierarchy, elevation chaos, no spacing base unit, competing container widths.

### AI Analysis (requires API key)
- **UX Analysis** — top issues, quick wins, UX score, design score. Includes **Vision Layer**: Claude reads the actual screenshot for visual hierarchy and layout critique
- **Dark Pattern Detector** — scans for 12 manipulative UI patterns with EU DSA / GDPR / US FTC / CCPA regulatory references
- **Copy Intelligence** — scores value proposition, CTAs, headlines, reading level, trust signals, microcopy, emotional resonance. Includes rewrite suggestions

### Shopify Migration
- Maps any page's sections and components to Shopify equivalents (Green / Yellow / Red)
- Discovers all site pages via sitemap, classifies by template type
- AI-generated migration summary

### Export
- **Save** as `.echoflow` file (reimport anytime)
- **Figma Presentation** — auto-generates slides per finding
- **PDF Report**
- **Copy for Notion** — markdown formatted
- **Export as Slides**
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
