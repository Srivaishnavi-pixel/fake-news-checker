# 🛡️ Fake News Checker

A conversational AI assistant that walks users, step-by-step, through verifying news, claims, and screenshots *before* sharing them — rather than giving a flat true/false verdict.

---

## 🌟 Key Features

- **Guided Checklist Conversation:** Asks one focused question at a time (Source credibility, Author/Byline, Publish date & recirculation, Cross-verification against wire services, Evidence quality & sensationalist language, Reverse image checks).
- **Domain Intelligence:** Automatically parses links, extracts author/date, detects known reputable outlets, identifies satire publications (e.g., *The Onion*), and flags typosquatted mimic domains (e.g., `bbc-news.co`).
- **Screenshot & Image Verification:** Interactive guidance directing users to Google Images, Google Lens, and TinEye to trace viral photo dates and identify AI-generation flags. Direct paste from clipboard (`Ctrl+V`) supported!
- **Standardized Verdict Cards:** Concludes each flow with a clear verdict (`✅ Likely Reliable`, `⚠️ Uncertain — Verify Further`, or `❌ Likely False or Misleading`), confidence level (`Low`/`Medium`/`High`), bulleted reasons, and a 1-click shareable verdict summary button.
- **Built-in Intelligent Engine + External LLMs:** Works out-of-the-box with zero configuration, and optionally supports Anthropic Claude (`claude-3-5-sonnet`), Google Gemini (`gemini-1.5-flash`), or OpenAI (`gpt-4o-mini`).
- **Rate-Limited API & Health Checks:** Built-in rate limiting (`express-rate-limit`) and `/health` monitoring ready for cloud production.

---

## 🚀 Quick Start (Local)

### 1. Prerequisites
- **Node.js 18+** (Node 20 or 22+ recommended)

### 2. Install & Run
```bash
# Clone or navigate to the directory
cd fakenews-aichatbot

# Install dependencies
npm install

# Start the application
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### 3. Run Automated Tests
```bash
npm test
```
Runs 12 automated unit and integration tests verifying all 5 core specification test cases (wire services, hoaxes, satire, recirculated stories, and screenshots).

---

## ☁️ Deployment Guide

You can deploy this application easily to any modern hosting service:

### Option 1: Render (Recommended — Free Tier Available)
1. Push this project to a GitHub or GitLab repository.
2. Log in to [Render](https://render.com/).
3. Click **New +** → **Blueprint**, and select your repository.
4. Render will detect `render.yaml` automatically, set up the web service, configure the `/health` check, and deploy!
   - *Optional:* Add your `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or `OPENAI_API_KEY` under the service's Environment settings in the Render dashboard.

### Option 2: Railway
1. Go to [Railway](https://railway.app/) and create a **New Project**.
2. Select **Deploy from GitHub repo**.
3. Railway automatically detects `Procfile` and `package.json` and launches the application.
4. Set the `PORT` environment variable or leave it at Railway's default.

### Option 3: Docker (Any Cloud / VPS / Fly.io)
Build and run the container locally or on any server:
```bash
# Build the Docker image
docker build -t fake-news-checker .

# Run the container on port 3000
docker run -d -p 3000:3000 --name fake-news-app fake-news-checker
```

### Option 4: Vercel
A `vercel.json` file is already included. You can deploy directly via:
```bash
npx vercel
```

---

## ⚙️ Configuration & Environment Variables

Copy `.env.example` to `.env` to configure optional features:

| Variable | Description | Default |
|---|---|---|
| `PORT` | Web server port | `3000` |
| `NODE_ENV` | Runtime environment (`development` / `production`) | `development` |
| `RATE_LIMIT_MAX` | Max requests allowed per IP per 15 minutes | `100` |
| `LLM_PROVIDER` | `local`, `anthropic`, `gemini`, or `openai` | `local` |
| `ANTHROPIC_API_KEY` | Anthropic Claude API Key (optional) | *empty* |
| `GEMINI_API_KEY` | Google Gemini API Key (optional) | *empty* |
| `OPENAI_API_KEY` | OpenAI API Key (optional) | *empty* |

*Note: If no API key is provided, the application runs its built-in heuristic reasoning engine without breaking or requiring paid credits.*

---

## 📋 Pre-Configured Test Cases (from Build Spec)

You can test these instantly using the **"Test Scenarios"** button in the top navigation:

1. **Wire Service Article:** Link to a Reuters or AP News report → *Likely Reliable (High confidence)*
2. **Documented Hoax:** Apollo moon landing denial claim → *Likely False (High confidence)*
3. **Satire Publication:** *The Onion* article link → *Satire flag / Do not share as real news*
4. **Recirculated Story:** Real airport outage from years ago shared as breaking today → *Uncertain — verify publication date*
5. **Screenshot / Viral Image:** Chat forward with no source or link → *Reverse-image search guidance (Google Images / TinEye)*

---

## ⚖️ Disclaimer
*This tool assists with verification but is not a substitute for professional fact-checking. Always use your own judgment.*
