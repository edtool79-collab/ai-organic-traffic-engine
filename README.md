<div align="center">
  <img src="docs/img/logo.png" alt="Traffic Engine Logo" width="88" />
  <h1>Traffic Engine — Web Traffic Generation &amp; Browser QA Studio</h1>
  <p>
    <strong>Self-hosted multi-engine Playwright &amp; Crawlee browser automation, flow verification, and observability suite</strong><br/>
    Local Express Dashboard (<code>http://127.0.0.1:4310</code>) &bull; Live <code>rrweb</code> Preview &bull; Proxy Tier &amp; Metering Controls &bull; Optional Live-Inbox OTP Verification &bull; AI Fleet Orchestration
  </p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-10b981.svg" alt="MIT License" /></a>
    <img src="https://img.shields.io/badge/Node.js-LTS-3b82f6.svg" alt="Node.js LTS" />
    <img src="https://img.shields.io/badge/Engines-Playwright%20%7C%20Patchright%20%7C%20Camoufox-38bdf8.svg" alt="Supported Engines" />
  </p>
</div>

<p align="center">
  <img src="docs/img/hero-banner.png" alt="Traffic Engine 4-Layer Architecture Banner" width="100%" />
</p>

## Visual Showcase

![Dashboard overview on the built-in demo site](docs/img/dashboard-overview.png)

### AI Fleet, Live Inboxes &amp; Automated OTP Verification
<p align="center">
  <img src="docs/img/feature-ai-otp.png" alt="AI Fleet Commander, Live Inboxes, OTP Verification &amp; PDF Reporting" width="100%" />
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

## Capabilities at a Glance

| Area | Implemented Behavior |
| --- | --- |
| **Execution & Scheduling** | Runs in `crawlee_autoscaled` (Mode A — real browsers), `crawlee_playwright` (Mode B — real browsers), or `http_fast` (no-browser protocol load mode for high-throughput HTTP/S requests with proxies, UTM params, and `Referer` headers — without JS execution or client-side analytics). Real-browser modes run `behavior`, `scenario`, and `hybrid` task modes with wave pacing (`off`, `steady`, `ramp_up`, `natural_peaks`, `burst`), progressive free-MB RAM throttling (`RAM Governor`), sampled `rrweb` preview on mass runs, local time windows (`schedule`), and single- or multi-target (`targets[]`) round-robin execution with `byTarget` metrics. |
| **Browser Engines & Profiles** | Selects between `chromium` (Playwright + stealth evasions), `patchright`, and `camoufox` (Firefox-based engine), plus optional CDP connections via `browserless` and `@lightpanda/browser`. Weighted device emulation across desktop and mobile viewports plus geo-matched persistent browser profiles (`sessionPersistence`). |
| **Recorder & Scenario Steps** | Interactive browser recorder (`journeyRecorder.js`), DOM/ad-slot inspector (`pageMapper.js`), and 24 scenario step handlers including `goto`, `click`, `fill`, `fill_email`, `fill_otp`, `select`, `press`, `hover`, `scroll`, `scroll_to`, `read_article`, `human_browse`, `scan_products`, `search_entry`, `ai_explore`, `ai_route_repair`, `ai_form_guard`, `wait`, `dismiss_overlays`, `audit_ads`, `assert`, `go_back`, `close_tab`, and `screenshot`. |
| **AI Fleet Commander & Onboarding** | Connects to Ollama Cloud (`OLLAMA_API_KEY`) and UncensoredLLM (`ULLM_API_KEY`) with automatic quota/429 failover and an offline local fallback advisor. Includes a built-in **AI Site Onboarding Wizard** (`POST /api/ai/onboard-site`) that crawls a new target site, prunes 404s, builds a tailored scenario, and asks follow-up focus questions. Routes `/v1/systemone` decision models such as `clef:27b` (0 output tokens) for worker/recovery steps while keeping free-form JSON scenario helpers (`ai_route_repair`, `ai_form_guard`, Fleet Commander chat) on chat-capable models. |
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
| `HIREPULSE_EMAIL_API_KEY` | Commercial API key for HirePulse inboxes. | `https://gethirepulse.xyz/credits` |
| `HIREPULSE_OWNER_PILOT_FILE` | Optional path to a local JSON holding `{"API_KEYS":{"owner-pilot":"..."}}`. | Local file |
| `OLLAMA_API_KEY` | Ollama Cloud API key (or stored locally outside repo). | Ollama Cloud |
| `ULLM_API_KEY` | UncensoredLLM API key for primary or 429-failover routing. | UncensoredLLM |
| `WTG_API_TOKEN` | Reserved bearer token for future HTTP/MCP surfaces. | Operator-generated |

Features without a configured key report themselves as `unconfigured` in the dashboard instead of crashing (`GET /api/email/status` and `GET /api/ai/status` perform zero paid calls).

---

## AI Fleet & Decision Routing

* **Squads & Roles:** `askFleetCommander` monitors live run telemetry and logs, emits structured runtime directives (`update_config`, `set_concurrency`, `set_wave_mode`, `set_resource_mode`, `assign_squad_model`, `pause`/`resume`/`stop`), and coordinates 4 default tactical squads (`alpha`, `bravo`, `charlie`, `delta`) unless overridden by `ai.allSquadsModel`.
* **Decision vs. Chat Models:** Decision models such as `clef:27b` only accept `/v1/systemone` (`callDecisionModel` / `askActionChoice`) and return typed `choice`/`score` decisions with 0 output tokens. Free-form scenario steps (`ai_route_repair`, `ai_form_guard`) and Fleet Commander chat automatically fall back via `resolveChatModel` to `ai.commanderModel` (or `deepseek-v4.1-flash`) when `workerModel` is set to a decision model.
* **Transport Memory:** Runtime model transport discovery (`/api/chat` vs `/api/generate` vs `/v1/systemone`) is persisted locally to ignored `data/ai-models.json`.

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
