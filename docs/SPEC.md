# Technical specification

## Architecture and file map

The Express dashboard binds to loopback on port 4310 by default. It serves a static browser UI, manages local configuration and starts a Node.js child process for each run. The runner opens Playwright sessions and sends status, step outcomes and preview frames back to the server. The UI receives updates through server-sent events.

| Path | Responsibility |
| --- | --- |
| `start-dashboard.bat` | Windows launcher for the dashboard and default browser. |
| `dashboard/server.js` | HTTP routes, configuration validation, process lifecycle, event stream, built-in demo site and report download. |
| `dashboard/public/` | Dashboard UI, styles, compact view and SSE worker. |
| `src/crawleeRunner.js` | Runner CLI, run planning, Playwright orchestration, outcomes and dashboard IPC. |
| `src/taskScenarioRunner.js` | Ordered scenario playback, per-step results, tabs and per-session data. |
| `src/journeyRecorder.js`, `src/pageMapper.js` | Interaction recording, page inspection and selector discovery. |
| `src/behaviorEngine.js`, `src/fingerprintManager.js` | Browsing behavior, device profiles, context setup and local profile reuse. |
| `src/proxyManager.js`, `src/cdpPoolManager.js` | Proxy source loading, checks and selection, and optional CDP browser connections. |
| `src/emailInboxClient.js`, `src/adSafetyHelper.js` | Email service integration, overlay handling and ad surface inspection. |
| `src/siteProfileManager.js`, `src/wavePlanner.js` | Site profile storage and run grouping. |
| `src/aiCommander.js` | Optional provider-backed command, chat and report review. |
| `src/rrwebLiveBridge.js`, `src/runReportGenerator.js` | Live browser replay capture and local report/state persistence. |
| `generate_visits.js` | Legacy runner entry point for the earlier visit engine. |

## Configuration schema

The dashboard normalizes and bounds inputs on write and on run start. Use `config.example.json` for a working starting point.

| Fields | Shape and validation |
| --- | --- |
| `targetUrl`, `pages` | HTTP(S) base URL and array of navigation paths. |
| `visitCount`, `minConcurrency`, `concurrency`, `firstPagePriority` | Integers. Dashboard bounds are 1–100,000 visits, 1–32 concurrent sessions, minimum concurrency at most the maximum, and priority 0–100. |
| `sessionTimeoutMs`, `pageMinMs`, `keepBrowserOpenMs`, `interVisitDelayMs` | Nonnegative millisecond values with dashboard bounds. Session timeout ranges from 5,000 to 600,000 ms. |
| `headless`, `engineMode`, `taskMode` | Boolean, runner mode (`crawlee_autoscaled` or `crawlee_playwright`), and workload (`behavior`, `scenario`, or `hybrid`). |
| `referrerMode`, `stealthMode`, `resourceMode` | Runner policies for referrer, browser launch profile and resource loading. Resource choices include `full`, `lite`, `ultra_lite`, `browserless_cdp` and `lightpanda_cdp`. |
| `taskSteps`, `snippet` | Ordered array of step objects and an optional string of page initialization JavaScript. |
| `schedule` | Object with an enable flag and start/end times in local `HH:mm` format. |
| `devices`, `personas` | Map of device names to weights and array of behavioral profiles. Persona entries have a name, reading time and page count ranges, and interaction probabilities. |
| `proxy` | Object with an enable flag, `round_robin` or `random` selection, country filter and fallback options, and optional inline servers. Keep credentials in local files. |
| `waves` | Planning object with mode, variation probabilities, caps and optional form inputs. |
| `ai` | Integration object with enable/auto-management flags, provider, model names, worker share and free-text guidance. Report generation can attempt provider review when credentials are configured and falls back to a local summary on failure. |
| `sessionPersistence` | Enable flag, reuse percentage and maximum local profile pool size. |
| `adSafety` | Boolean switches for overlay dismissal, pop-under cleanup, click filtering and the telemetry header. |

## Run pipeline

1. The dashboard validates configuration and rejects concurrent run starts or starts during a recording. A request with a configuration body also saves the validated configuration to disk.
2. The server launches the runner as a child process. It passes the configuration path and receives structured IPC messages alongside stdout and stderr.
3. The runner selects the workload, prepares any enabled proxy pool and schedules visits within concurrency and timing limits. Per-visit browser contexts apply device and persona settings.
4. The workload opens test pages, executes configured steps or the browsing engine, and emits navigation, step, log and preview data. Scenario execution records successes, skips and failures.
5. The server updates run status and streams events to the dashboard. On completion it stores run state and creates report metadata and HTML. Chromium renders a PDF when available.

## HTTP API

The dashboard serves its local API without an application login. Keep it bound to loopback. Paths below are relative to the dashboard root.

| Method and route | Function |
| --- | --- |
| `GET /api/system` | Dashboard and host settings summary. |
| `GET /api/config`, `PUT /api/config`, `POST /api/config/reset` | Read, replace or reset the local configuration. |
| `POST /api/proxies/test`, `GET /api/proxies/countries` | Test a proxy pool and list country choices. |
| `GET /api/profiles`, `DELETE /api/profiles` | Inspect or clear saved browser profiles. |
| `GET /api/site-profiles`, `POST /api/site-profiles` | List or create site profiles. |
| `PUT /api/site-profiles/:id`, `DELETE /api/site-profiles/:id`, `POST /api/site-profiles/:id/load` | Update, delete or load a site profile into current configuration. |
| `POST /api/discover`, `POST /api/inspect-page` | Discover pages or inspect DOM elements on an authorized target. |
| `GET /api/recorder/status`, `POST /api/recorder/start`, `POST /api/recorder/stop`, `POST /api/recorder/focus` | Inspect or control the browser recorder. |
| `GET /api/email/status`, `POST /api/email/create`, `GET /api/email/code/:inboxId` | Inspect service status, create an inbox or retrieve an OTP for a known inbox. |
| `GET /api/run/status`, `POST /api/run/start`, `POST /api/run/preview` | Read run state, start a run or toggle preview capture. |
| `POST /api/run/pause`, `POST /api/run/resume`, `POST /api/run/stop` | Control the active runner. |
| `GET /api/events` | Server-sent log, status and live preview events. |
| `GET /api/reports`, `GET /api/reports/latest/pdf`, `GET /api/reports/:filename` | List reports or fetch a rendered report artifact. |
| `GET /api/ai/status`, `POST /api/ai/directive`, `POST /api/ai/chat` | Read AI integration status, set guidance or send a chat request. |
| `GET /api/demo-events`, `DELETE /api/demo-events` | Read or clear in-memory demo events. |
| `GET /demo-site`, `GET /demo-site/about`, `GET /demo-site/pricing`, `GET /demo-site/contact`, `GET /demo-site/fingerprint-check`, `POST /demo-site/collect` | Built-in test pages and event endpoint. |

## Scenario steps

Each step has a `type`. Depending on the handler it can also carry `selector`, `value`, `label`, tab information, and failure-handling flags. In `goto` steps, the value `/` uses the configured target URL. Other absolute paths resolve against the host root. For the bundled demo, use paths such as `/demo-site/about`.

| Types | Purpose |
| --- | --- |
| `goto`, `go_back`, `close_tab` | Navigate or operate on tabs. |
| `click`, `hover`, `press`, `select`, `fill` | Interact with a DOM element or send input. |
| `fill_email`, `fill_otp` | Use the current session's inbox data in a form. |
| `scroll`, `scroll_to`, `wait`, `assert` | Move through a page, wait or verify a condition. |
| `read_article`, `human_browse`, `scan_products`, `ai_explore` | Run higher-level browsing steps. AI exploration depends on configuration and provider availability. |
| `dismiss_overlays`, `audit_ads`, `screenshot` | Dismiss overlays, inspect ad surfaces or capture a preview. |

## Data files

| Path | Contents |
| --- | --- |
| `config.example.json` | Public configuration template. |
| `config.json` | Ignored local operator configuration. |
| `proxies.txt`, `proxies-fallback.txt` | Ignored operator-supplied primary and fallback pools. |
| `site-profiles/` | Named scenario/configuration presets and active-profile metadata. Review profiles before sharing them. |
| `session-profiles/` | Ignored browser session and proxy geography cache. |
| `reports/` | Ignored run and inbox state, report metadata, HTML and PDFs. |
| `storage/` | Ignored Crawlee runtime storage. |
| `docs/img/` | Captures from a local run against the bundled demo site. |
