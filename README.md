<div align="center">
  <img src="docs/img/logo.png" alt="Traffic Engine Logo" width="88" />
  <h1>Traffic Engine AI — Autonomous Synthetic User Journey QA, Traffic Simulator &amp; GA4 Verification Studio</h1>
  <p>
    <strong>Run instantly in the cloud via our official <a href="https://apify.com/hirepulse/website-traffic-generator">Apify Store Actor</a> or self-host the multi-engine Playwright &amp; Crawlee QA studio locally</strong><br/>
    Managed Apify Cloud + Apify Proxy &bull; Local Express Dashboard (<code>http://127.0.0.1:4310</code>) &bull; Live Browser Preview (<code>rrweb</code>) &bull; Organic Search &amp; Social Referrers &bull; Live GA4 &amp; OTP Verification
  </p>
  <p>
    <a href="https://apify.com/hirepulse/website-traffic-generator"><img src="https://img.shields.io/badge/Run_on_Apify_Cloud-Website_Traffic_Generator-ff6b2b?logo=apify&logoColor=white" alt="Run on Apify Store" /></a>
    <a href="https://edtool79-collab.github.io/ai-organic-traffic-engine/config-builder/"><img src="https://img.shields.io/badge/Interactive_Builder-Apify_%26_Local_JSON-2563eb" alt="Interactive Config Builder" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-10b981.svg" alt="MIT License" /></a>
    <img src="https://img.shields.io/badge/Engines-Patchright%20%7C%20Playwright%20%7C%20Camoufox-38bdf8.svg" alt="Supported Engines" />
  </p>
</div>

> **New — Zero-Setup Cloud Execution:** Launch synthetic multi-step browser journeys, load tests, and live `GA4` beacon verification directly in the cloud via **[Website Traffic Generator on Apify Store (`hirepulse/website-traffic-generator`)](https://apify.com/hirepulse/website-traffic-generator)**, or export both `apify-input.json` and local `config.json` in one click at **[edtool79-collab.github.io/ai-organic-traffic-engine/config-builder/](https://edtool79-collab.github.io/ai-organic-traffic-engine/config-builder/)**.

<p align="center">
  <img src="docs/img/hero-banner.png" alt="Traffic Engine 4-Layer Architecture Banner" width="100%" />
</p>

## Live Dashboard Execution &amp; Real-Time GA4 Verification

<p align="center">
  <img src="docs/img/live-ga4-demo.gif" alt="Live Traffic Engine Run Counter, Active Workers, Browser Preview & GA4 Hit Verification" width="100%" />
</p>
<p align="center">
  <em>Zero-edit live capture (English dashboard): click <strong>Start Run</strong> &rarr; Crawlee workers spin up &rarr; live browser frames stream &rarr; real <code>google-analytics.com/g/collect</code> hits verify per session (<code>6 / 6 &bull; 100%</code>).</em>
</p>

---

## Multi-Agent Hybrid AI Architecture (Playbook Cache + Open-Core Gateway)

<p align="center">
  <img src="docs/img/ai-architecture.jpg" alt="Traffic Engine Multi-Agent Hybrid AI Architecture, Playbook Cache & Hosted Credit Gateway" width="100%" />
</p>

Unlike brute-force LLM browser agents that burn tokens on every click, **Traffic Engine** runs a cost-aware, multi-agent orchestration architecture with route-level **Playbook Caching**, dual-transport execution, automatic failover, and two flexible credential modes (**BYOK Local Cloud** or **Zero-Setup Hosted HirePulse Credits**):

### 1. Specialized Agent Roles (`src/wavePlanner.js` + `src/aiCommander.js`)

When runs scale without a single fixed model override, `askFleetCommander` and the wave planner assign 4 specialized AI agent roles dynamically across concurrent sessions:

| Agent Role | Core Focus | Default Worker Model | Automated Capabilities |
| --- | --- | --- | --- |
| **Tools &amp; Forms Agent** | Interactive Tools &amp; Feature QA | `deepseek-v4.1-flash` | Evaluates calculators, tool forms (`use_tool`), result extraction &amp; copy validation |
| **Multi-Tab Flow Agent** | Multi-Tab &amp; Checkout Journeys | `beam` | Coordinates multi-tab user flows, external CTA verification tabs, consent banners &amp; popunder cleanup |
| **Content &amp; UX Dwell Agent** | Guides &amp; Biometric Engagement | `minimax-m3.1-flash` | Natural long-form reading (`read_article`), horizontal biometric mouse sweeps &amp; text selection |
| **SERP &amp; Route Healing Agent** | Organic Search &amp; Recovery | `gpt-oss:20b` | Live SERP navigation, DOM exploration (`ai_explore`) &amp; broken-selector repair (`ai_route_repair`, `ai_form_guard`) |

### 2. Decision Models (`/v1/systemone`) vs. Chat Models

* **Zero-Output-Token Worker Decisions (`callDecisionModel` / `askActionChoice`):** Decision models such as `clef:27b` route strictly to `/v1/systemone`, returning deterministic element-ID/state choices without wasting tokens generating prose.
* **Structured Chat &amp; Recovery (`callAiChat` / `resolveChatModel`):** Free-form JSON steps (`ai_route_repair`, `ai_form_guard`) and AI Commander chat automatically fall back from decision-only models to chat-capable models (e.g., `deepseek-v4.1-flash` or `glm-5.3-flash`).
* **Persistent Transport Discovery (`data/ai-models.json`):** The engine learns at runtime whether each model prefers `/api/chat`, `/api/generate`, or `/v1/systemone` and remembers it across restarts.

### 3. Playbook Cache, Failover Chain &amp; Funnel Cloner

* **Route &amp; Site Playbook Cache (`aiPagePlaybookCache`):** Once an AI worker explores a page or heals a skipped selector, the compact DOM action plan is cached per route pattern so subsequent concurrent visits replay human-jittered variations at **0 extra AI tokens**.
* **Multi-Tier Failover (`ai.provider`):** Runs cleanly across **Ollama Cloud** (`OLLAMA_API_KEY`) &rarr; **UncensoredLLM** (`ULLM_API_KEY`, auto-failover on HTTP 429/402 cooldown) &rarr; **HirePulse Cloud Credits** (`HIREPULSE_CREDIT_KEY` / `HIREPULSE_EMAIL_API_KEY`) &rarr; **Deterministic Offline Advisor** (`buildLocalCommanderFallback`), never crashing when keys are omitted.
* **Hosted Open-Core Cloud Mode ([`gethirepulse.xyz/credits`](https://gethirepulse.xyz/credits)):** Prefer not to manage multiple upstream AI vendor keys or local Ollama configs? Set `ai.provider = "hirepulse"` (or `auto` with `HIREPULSE_CREDIT_KEY` in `.env.local`) to route **AI Commander** (`/v1/qa/commander`), **DOM Step Decisions &amp; Recovery** (`/v1/qa/step-decision`), and **Public Funnel Audits** (`/v1/qa/funnel-audit`) directly through the hosted HirePulse Gateway alongside **Live Email/OTP Inboxes** — while strictly enforcing **Operator Concurrency Sovereignty** server-side.
* **AI Onboarding Wizard &amp; Funnel Intelligence Cloner:** Paste any authorized site URL into **AI Onboarding** (`POST /api/ai/onboard-site` + `/api/ai/onboard-reply`) or **Analyze Pixels &amp; Clone Funnel** (`POST /api/ai/clone-funnel`) to detect GA4, GTM, AdSense, Meta, TikTok, Clarity, Hotjar, and Cloudflare Turnstile tags, map interactive tool/guide routes, and synthesize a tailored test scenario automatically.
* **Runtime Orchestration Directives (`askFleetCommander`):** Monitors live run telemetry and logs to emit structured runtime actions (`update_config`, `set_wave_mode`, `set_resource_mode`, `dispatch_directive`, `pause`/`resume`/`stop`) while never reducing operator-configured concurrency.

---

## Visual Showcase

![Dashboard overview on the built-in demo site](docs/img/dashboard-overview.png)

### AI Onboarding, Live Inboxes &amp; Automated OTP Verification
<p align="center">
  <img src="docs/img/feature-ai-otp.png" alt="AI Commander, Live Inboxes, OTP Verification &amp; PDF Reporting" width="100%" />
</p>

| AI Site Onboarding &amp; Multi-Target Scale | Live Inbox &amp; OTP Verification |
| :---: | :---: |
| ![AI Site Onboarding &amp; Multi-Target Execution](docs/img/onboarding-and-targets.png) | ![Live Inboxes &amp; OTP Verification CTA](docs/img/live-inbox-cta.png) |

### Global Geo Proxy Routing, Multi-Engine Stealth &amp; Ad-Safe Shield
<p align="center">
  <img src="docs/img/feature-proxies-stealth.png" alt="Global Geo Proxy Routing &amp; Multi-Engine Stealth" width="100%" />
</p>

| Unified Geo Routing &amp; Proxy Tier Controls | Live Runner Logs &amp; AI PDF Report |
| :---: | :---: |
| ![Geo Routing &amp; Proxy Controls](docs/img/proxy-geo-routing.png) | ![Live run log](docs/img/live-run-log.png)<br/><br/>![Generated PDF report](docs/img/generated-pdf-report.png) |

## Why Traffic Engine?

* **Watch Every Visit Live (Smart Live Preview):** See exactly what every headless or visible worker sees in real time inside the dashboard via live `rrweb` DOM streaming and step-by-step screenshots — pause, inspect, or hide the live feed anytime.
* **Authentic Organic Search &amp; Social Traffic:** Automatically generates realistic `Referer` headers and search-engine entry trails (`google_organic`, `search_engines`, `social` via YouTube/Reddit/Facebook/X/LinkedIn/TikTok, or `mixed`) with domain-aware search queries.
* **Smart Waves &amp; Child Variations:** Never replay identical robotic paths. Configure `natural_peaks`, `ramp_up`, `burst`, or `steady` waves so each visitor gets randomized dwell times, extra internal pages, varied form inputs, and multi-day returning-visitor cookies (`sessionPersistence`).
* **Massive Scale &amp; Operator Concurrency Sovereignty:** Scale from 100 to 5,000+ browser sessions across local workers or remote VPS nodes (`POST /api/swarm/dispatch`)—or switch to `http_fast` (up to 128 concurrent connections, 1,000+ hits/min)—with strict **Operator Concurrency Sovereignty** (no automatic RAM throttling overrides) and JS/CSS asset caching (`lite` / `ultra_lite`).
* **AI Site Onboarding, Funnel Cloner &amp; Runtime Commander:** Paste any URL into the AI Onboarding Wizard or Funnel Cloner (`POST /api/ai/clone-funnel`) to detect analytics/ad pixels, map interactive tools and forms, auto-build a tailored scenario, refine rules via interactive chat (`Enter` / Reply), and let specialized AI agents optimize sessions in real time.

## Why This Project Stands Out

Most traffic and QA automation tools fall into one of three weak buckets:
1. **Dumb HTTP bots** that cannot execute JavaScript, consent flows, or Google Analytics 4.
2. **Brittle headless Playwright/Selenium scripts** that behave robotically and fail on dynamic layouts or anti-bot checks.
3. **Pure LLM browser agents** that burn dollars on every single click across large runs.

**Traffic Engine** fuses all three worlds into one self-hosted engine:

- **Multi-Layer Stealth &amp; Geo-Matched Fingerprints:** Injects consistent Canvas/WebGL/Audio/Navigator profiles (`FingerprintGenerator` + `FingerprintInjector`), automatically aligns browser locale &amp; timezone across 50 countries to each proxy's exit IP, and maintains multi-day `Persistent Contexts` with real cookie jars.
- **Cost-Aware Resource &amp; Proxy Economics:** Clean separation between cheap **Datacenter** pools (`0 MB` metered spend) and **Residential** pools (with a configurable 1 GB byte-budget cap and automatic datacenter failover), bandwidth-saving asset caching + GA4-safe `ultra_lite` mode that keeps analytics beacons firing while cutting ~80% of media overhead.
- **Hybrid Multi-Agent Intelligence (`Playbook Cache + Specialized Roles`):** Instead of paying an LLM call for every click at scale, the first visitor explores the DOM, caches a compact action playbook, and lets workers replay variations with human jitter and route self-healing (`ai_route_repair`, `ai_form_guard`).

### 7 Pro Capabilities Built-In

1. **Real SERP Click-Through (`Real Search Engine CTR`):** Alongside organic &amp; social HTTP referrers (Google country TLDs, Bing, DuckDuckGo, YouTube, `l.facebook.com`, Reddit, `t.co` / X, LinkedIn), selected visits open the search engine, type domain-relevant queries, scan pages 1–2, and click directly through the organic result link.
2. **Multi-Day Persona Lifecycle (`session-profiles` Memory):** Returning persistent browser profiles automatically evolve through lifecycle stages (`day1_discovery` -&gt; `day2_consideration` -&gt; `day3_conversion` -&gt; `loyal_advocate`), carrying persistent cookies (`_ga`) and scaling reading dwell time organically (`1.0x` -&gt; `1.25x` -&gt; `1.45x`).
3. **Smart Interactive Tool Runner (`use_tool`):** Instead of only scrolling static pages, agents recognize interactive tools, calculators, schema generators, and checkers on the target page, fill realistic context-appropriate inputs, trigger execution buttons, and click `Copy Result`.
4. **Closed-Loop Real-Time GA4 Verification:** Every browser session listens live to outgoing `google-analytics.com/g/collect` (plus Clarity, Plausible, and PostHog) telemetry requests, verifying hits and referrer sources (`dr`) in real time inside the Dashboard KPI badge and logs.
5. **Biometric Mouse &amp; Viewport Scroll Physics:** Smooth wheel scrolling slows naturally near headings, tables, and interactive cards, while `performBiometricReadingPass` sweeps the cursor across headings/text lines and performs occasional natural text selections (`selectionchange` / `copy`).
6. **1-Click Distributed Cloud Swarm (`POST /api/swarm/dispatch`):** Scale beyond a single machine's RAM — point the dashboard at remote worker nodes running this dashboard over HTTP (`Docker` or VPS) and split thousands of visits across machines with one click.
7. **Target &amp; Funnel Intelligence Cloner (`POST /api/ai/clone-funnel` + AI Onboarding Wizard):** Point the wizard at any landing page to detect installed analytics/ad pixels (GA4, GTM, AdSense, Meta, TikTok, Clarity, Hotjar, Cloudflare Turnstile), map forms and interactive tools, auto-build a tailored scenario, and refine agent instructions via interactive chat (`Enter` / Reply).

## Capabilities at a Glance

| Area | Implemented Behavior |
| --- | --- |
| **Execution & Scheduling** | Runs in `crawlee_autoscaled` (Mode A — real browsers), `crawlee_playwright` (Mode B — real browsers), or `http_fast` (no-browser protocol load mode for high-throughput HTTP/S requests with proxies, UTM params, and `Referer` headers — without JS execution or client-side analytics). Real-browser modes run `behavior`, `scenario`, and `hybrid` task modes with wave pacing (`off`, `steady`, `ramp_up`, `natural_peaks`, `burst`), strict operator concurrency sovereignty, live GA4 hit verification, sampled `rrweb` preview on mass runs, local time windows (`schedule`), and single- or multi-target (`targets[]`) round-robin execution with `byTarget` metrics. |
| **Browser Engines & Profiles** | Selects between `chromium` (Playwright + stealth evasions), `patchright`, and `camoufox` (Firefox-based engine), plus optional CDP connections via `browserless` and `@lightpanda/browser`. Weighted device emulation across desktop and mobile viewports plus geo-matched persistent browser profiles (`sessionPersistence`) with multi-day lifecycle stages (`day1_discovery` through `loyal_advocate`). |
| **Recorder & Scenario Steps** | Interactive browser recorder (`journeyRecorder.js`), DOM/ad-slot inspector (`pageMapper.js`), and 25 scenario step handlers including `goto`, `click`, `fill`, `fill_email`, `fill_otp`, `select`, `press`, `hover`, `scroll`, `scroll_to`, `read_article`, `human_browse`, `use_tool`, `scan_products`, `search_entry`, `ai_explore`, `ai_route_repair`, `ai_form_guard`, `wait`, `dismiss_overlays`, `audit_ads`, `assert`, `go_back`, `close_tab`, and `screenshot`. |
| **AI Commander & Onboarding** | Connects to **HirePulse Cloud Credits** (`HIREPULSE_CREDIT_KEY` &rarr; `gethirepulse.xyz/v1/qa/*`), Ollama Cloud (`OLLAMA_API_KEY`), and UncensoredLLM (`ULLM_API_KEY`) with automatic quota/429 failover and an offline local fallback advisor. Includes a built-in **AI Site Onboarding Wizard** (`POST /api/ai/onboard-site`), interactive follow-up chat (`POST /api/ai/onboard-reply`), and **Funnel Cloner** (`POST /api/ai/clone-funnel`) that detects pixels, maps tools/forms, and builds a tailored scenario across 4 specialized AI roles with route Playbook Caching and `/v1/systemone` decision routing (`clef:27b`). |
| **Proxy Pool, Scoring & Saver** | Supports `proxy.tier` (`datacenter`, `residential`, `auto`), `round_robin` / `random` selection, Tier-1 country filtering, concurrent preflight reachability/latency checks, per-domain proxy cooldowns and scoring (`proxyScoreboard.js`), metered residential byte budgeting (`residentialPool.js`) with automatic static datacenter fallback (`fallbackServers` / `proxies-fallback.txt`), and a static asset RAM cache + tracker/media blocker (`lite` / `ultra_lite`). |
| **Live Inbox & Email Sweeps** | Integrates with the HirePulse inbox API (`src/emailInboxClient.js`) to create temporary inboxes per visit, inject addresses (`fill_email`), retrieve OTP codes or confirmation links (`fill_otp`), and run post-visit confirmation sweeps (`emailSweepPasses` / `emailSweepDelayMs`). |
| **Diagnostics & Safety Gates** | Includes read-only target preflight classification (`open`, `cf_interstitial`, `site_tick`, `dead`, `unknown` via `tools/preflight-target.js`) and read-only CAPTCHA/challenge widget detection (`challengeDetector.js` — detection and reporting only, never solves challenges). Ad-safety switches control overlay dismissal, pop-under cleanup, element exclusion (`avoidAdClicks`), and origin-scoped telemetry headers. |
| **Redaction, Live Stream & Reports** | Masks passwords, OTP tokens, inbox addresses, and proxy credentials before logs, telemetry, or step metadata (`src/redaction.js`). Streams live SSE status and `rrweb` browser frames to the dashboard and writes run state plus HTML/PDF reports (`reports/`). |

---

## Quickstart (Windows / Node.js LTS)

From the repository root in PowerShell:

```powershell
npm install
npm --prefix dashboard install
npx playwright install chromium firefox webkit
Copy-Item config.example.json config.json
Copy-Item .env.example .env.local
```

1. Edit `targetUrl` (or `targets`) in `config.json` to point to a site you own or are authorized to test (`config.example.json` targets the built-in loopback demo site).
2. Fill in optional tokens in `.env.local` (never committed; automatically loaded by `src/localEnv.js` on dashboard startup).
3. Launch the dashboard with `start-dashboard.bat` (or `npm start`) and open [http://127.0.0.1:4310](http://127.0.0.1:4310), or run headless directly via CLI:

Run headless directly via CLI or scale workers with Docker:

```powershell
node src/crawleeRunner.js config.json
```

### Docker Swarm & Lightpanda Sidecar

For multi-container execution on a high-RAM Linux host or VPS, [docker-compose.yml](docker-compose.yml) includes a `swarm` worker profile (with `./data` and `./site-profiles` mounts, `2gb` `/dev/shm`, `WTG_DOCKER=1`, and Playwright bundled Chromium) and an optional `lightpanda` CDP sidecar (`127.0.0.1:9222`):

```powershell
docker compose up -d dashboard
docker compose --profile swarm up -d --scale worker=4
docker compose --profile lightpanda up -d
```

---

## Secrets & Environment Variables (`.env.local`)

Sensitive files (`config.json`, `.env.local`, `proxies.txt`, `proxies-fallback.txt`, `data/*`, `reports/*`, `runs/*`, `session-profiles/*`, `site-profiles/*` outside the 9 bundled templates) are excluded via `.gitignore`. See [docs/LOCAL-vs-PUBLIC.md](docs/LOCAL-vs-PUBLIC.md) for the full boundary between local secrets and public code.

| Variable | Purpose | Source |
| --- | --- | --- |
| `HIREPULSE_OWNER_PILOT_TOKEN` | Owner-pilot bearer token for HirePulse live inboxes (takes precedence over paid key). | Local gateway config (`https://gethirepulse.xyz/email-pilot`) |
| `HIREPULSE_CREDIT_KEY` | Hosted Cloud AI QA &amp; Funnel Audit key (routes AI Commander, DOM step decisions, and funnel audits via `gethirepulse.xyz/v1/qa/*` with zero local Ollama setup). | `https://gethirepulse.xyz/credits` |
| `HIREPULSE_EMAIL_API_KEY` | Commercial API key for HirePulse live inboxes (also reused as a HirePulse AI credit key fallback if `HIREPULSE_CREDIT_KEY` is unset). | `https://gethirepulse.xyz/credits` |
| `HIREPULSE_OWNER_PILOT_FILE` | Optional path to a local JSON holding `{"API_KEYS":{"owner-pilot":"..."}}`. | Local file |
| `OLLAMA_API_KEY` | Ollama Cloud API key (or stored locally outside repo). | Ollama Cloud |
| `ULLM_API_KEY` | UncensoredLLM API key for primary or 429-failover routing. | UncensoredLLM |
| `WTG_API_TOKEN` | Reserved bearer token for future HTTP/MCP surfaces. | Operator-generated |

Features without a configured key report themselves as `unconfigured` in the dashboard instead of crashing (`GET /api/email/status` and `GET /api/ai/status` perform zero paid calls).

---

## Proxies, Bandwidth Metering & CLI Utilities

* **Proxy Sources:** Provide proxies in `config.json -> proxy.servers` or in ignored `proxies.txt` (`http://user:pass@host:port`, `socks5://...`, or `host:port:user:pass`). Optional fallback proxies go in `proxy.fallbackServers` or `proxies-fallback.txt`.
* **Residential Guard:** When Webshare-style metered residential endpoints are active, `residentialPool.js` counts session transfer bytes (including `overheadFactor`) in `data/residential-usage.json` and automatically hands over to static datacenter fallbacks (`proxy.fallbackServers` or `data/proxies-datacenter.json`) when `byteBudgetMb` is reached — stopping cleanly rather than overspending if no fallback is configured.
* **CLI Tools (`tools/`):**
  * `node tools/preflight-target.js <url> [--country us] [--no-proxy] [--wait 12000] [--shot out.png] [--json]` — read-only target gate classifier (`open`, `cf_interstitial`, `site_tick`, `dead`, `unknown`).
  * `node tools/build-proxy-geo.js` — probes configured proxies against `ip-api.com` and writes anonymized country/latency metadata to `data/proxy-geo.json`.

---

## Live Inboxes &amp; Proxy Setup

* **Live Inboxes &amp; OTP Verification ([gethirepulse.xyz/credits](https://gethirepulse.xyz/credits)):** All core browser automation, recording, and QA features run 100% free with zero API keys. To unlock automated end-to-end signup &amp; OTP verification (`fill_email` / `fill_otp` steps and post-run confirmation sweeps), add your `HIREPULSE_EMAIL_API_KEY` from [gethirepulse.xyz/credits](https://gethirepulse.xyz/credits) to `.env.local`.
* **Datacenter vs. Residential Proxies:** Use `proxy.tier = "datacenter"` for high-throughput internal QA (0MB residential usage), or `"residential"` with `proxy.residential.byteBudgetMb` to enforce a strict bandwidth cap with automatic datacenter fallback.

### Integration &amp; Optimization Guides

* [How to Use Webshare Proxies with Traffic Engine](docs/guides/webshare-proxies.md)
* [How to Configure Decodo Proxies in Traffic Engine](docs/guides/decodo-proxies.md)
* [How to Limit Residential Proxy Bandwidth in Playwright &amp; Crawlee](docs/guides/limit-residential-bandwidth.md)
* [How to Run AI Browser Agents with a Fixed Budget](docs/guides/ai-agents-budget.md)

---

## Verification & Tests

Run the offline/loopback verification suite (no external paid API or proxy spend):

```powershell
npm test                               # tests/redaction.js
node tests/verify-plan.js              # child journey planner, identity, referrer builder
node tests/verify-proxy-resolution.js  # residential budget guard & datacenter fallback
node tests/verify-proxyscore.js        # per-domain cooldowns & proxy scoring
node tests/verify-residential.js       # residential pool parsing & byte metering
node tests/signup-release.js           # loopback recorder + OTP verification + secret redaction
node tests/verify-engine.js chromium   # engine launch & navigator sanity (chromium | patchright | camoufox)
```

Read-only network diagnostic scripts (`tests/probe-geo.js`, `tests/probe-render.js`, `tests/probe-target.js`) connect through entries in `proxies.txt` and are intended only for manual proxy/target inspection.

---

## Configuration Reference (`config.json`)

| Key | Purpose |
| --- | --- |
| `targetUrl`, `pages` | Primary HTTP(S) base URL and default path array. |
| `targets` | Optional array of `{ url, pages, visitCount }` for multi-target round-robin runs with isolated session profiles. |
| `visitCount`, `minConcurrency`, `concurrency`, `firstPagePriority` | Total planned visits (1–100,000), concurrency bounds (1–32 for real browsers, up to 128 for `http_fast`), and landing-page entry weighting (0–100%). |
| `sessionTimeoutMs`, `pageMinMs`, `keepBrowserOpenMs`, `interVisitDelayMs` | Per-visit timeout, minimum page dwell, cleanup wait, and pacing delay in milliseconds. |
| `headless`, `engineMode`, `browserEngine`, `taskMode`, `referrerMode` | Headless toggle, `crawlee_autoscaled` / `crawlee_playwright` / `http_fast`, `chromium` / `patchright` / `camoufox`, `behavior` / `scenario` / `hybrid`, and referrer distribution. |
| `taskSteps`, `snippet` | Ordered scenario steps (up to 100) and optional page init JavaScript. |
| `schedule` | Local-time window `{ enabled, startHour, endHour }`. |
| `devices`, `personas` | Device weights and behavioral reading/interaction presets. |
| `proxy` | Proxy `enabled`, `tier` (`datacenter` / `residential` / `auto`), `mode` (`round_robin`/`random`), `countryFilterEnabled`, `fallbackToAnyIfEmpty`, `preferredCountries`, `servers`, `fallbackServers`, `residential { enabled, byteBudgetMb, country, overheadFactor }`. |
| `stealthMode`, `resourceMode` | `standard`/`maximum` launch profile and `full`/`lite`/`ultra_lite`/`browserless_cdp`/`lightpanda_cdp`. |
| `waves` | Scenario variation settings (`enabled`, `mode`, `conversionRate`, `childMutationRate`, `scanProductsChance`, `extraPageChance`, `mutateForms`, `maxProductsPerVisit`, `formInputs`, `referrerMode`). |
| `ai` | `{ enabled, autoManage, provider, commanderModel, workerModel, workerPct, allSquadsModel, recoveryModel, formAssist, routeRepair, commanderDirective }`. |
| `sessionPersistence` | Persistent browser context pool `{ enabled, returningUserRate, profilePoolSize }`. |
| `adSafety` | `{ avoidAdClicks, dismissOverlays, closePopunders, skipTelemetryHeader }`. |
| `attribution` | `{ lockerDwellMs, closeSettleMs }` keep-alive timings for flow completion beacons. |
| `emailSweepPasses`, `emailSweepDelayMs` | Post-run inbox confirmation retry count and interval in milliseconds. |

See [docs/SPEC.md](docs/SPEC.md) for the full dashboard HTTP API and pipeline layout, and [docs/LOCAL-vs-PUBLIC.md](docs/LOCAL-vs-PUBLIC.md) for security hygiene rules.

---

## Ethics and Limitations

Operators are responsible for complying with the terms of service, `robots.txt` directives, privacy laws, and advertising network policies of any target site. This software is provided as-is strictly for authorized QA, flow monitoring, and self-hosted testing on systems you own or have explicit permission to test. It intentionally does **not** bypass or solve CAPTCHAs (`challengeDetector.js` and `targetPreflight.js` are read-only observers).

## License

[MIT](LICENSE)
