# Browser QA Dashboard

A self-hosted dashboard for running real Playwright browser sessions with Crawlee. Record and replay multi-step journeys, exercise a site across device and persona profiles, inspect the DOM, and review run logs and PDF reports.

![Dashboard overview on the built-in demo site](docs/img/dashboard-overview.png)

## Features

| Area | What the dashboard supports |
| --- | --- |
| Runs engine | Concurrent Playwright sessions, device and persona variation, scheduled start windows, live status and pause, resume, and stop controls. |
| Journey recorder | Capture and replay navigation, form interactions, waits and other steps. Inspect the DOM and audit ad surfaces on authorized sites. |
| Inbox flows | Create a live inbox through the configured email service and fill email or one-time code fields during an authorized test. |
| Proxy layer | Assign a proxy per visit, optionally filter the pool by country, and check reachability and latency before a run. |
| Reports | Review live logs and per-session step outcomes. Download a summary PDF when Chromium can render it. |
| AI commander | Optional provider-backed chat and run review. Configured integrations can supply guidance or propose configuration changes. |

[Live run log](docs/img/live-run-log.png) · [Generated PDF report page](docs/img/generated-pdf-report.png)

## Quickstart

Use a supported Node.js LTS release on Windows. From the repository root in PowerShell:

```powershell
npm install
npm --prefix dashboard install
npx playwright install chromium firefox webkit
Copy-Item config.example.json config.json
```

Edit `targetUrl` in `config.json` to point to a site you own or are authorized to test. The example points to the dashboard's local demo site. Run `start-dashboard.bat` and open [http://127.0.0.1:4310](http://127.0.0.1:4310).

## Proxies

The repository ships **no proxies**. Supply your own list in `proxies.txt` at the repository root, with one entry per line in the form `http://<user>:<pass>@<host>:<port>`. Git ignores this file. Never commit it.

When enabled, the proxy layer can filter candidates by country and precheck reachability and latency. It selects a proxy for each visit using round-robin or random rotation. An optional static fallback pool can be kept in the ignored `proxies-fallback.txt` file.

## Configuration reference

| Key | Purpose |
| --- | --- |
| `targetUrl` | Base HTTP(S) URL for the site under test. |
| `pages` | Navigation paths used by the browsing engine. |
| `visitCount` | Number of sessions planned for a run. |
| `minConcurrency` | Baseline parallelism for the autoscaled engine. |
| `concurrency` | Upper bound on simultaneous sessions. |
| `firstPagePriority` | Weighted preference for the first entry in `pages`, as a percentage. |
| `sessionTimeoutMs` | Time budget for a session in milliseconds. |
| `pageMinMs` | Minimum page dwell time for flows that use it, in milliseconds. |
| `headless` | Whether the browser launches without a visible window. |
| `engineMode` | Selects the Playwright execution and scheduling mode. |
| `taskMode` | Chooses browsing behavior, an explicit scenario, or a hybrid run. |
| `referrerMode` | Selects the referrer policy applied by the runner. |
| `taskSteps` | Ordered step objects for scenario playback. |
| `keepBrowserOpenMs` | Delay before browser context cleanup, in milliseconds. |
| `interVisitDelayMs` | Requested pacing delay between visits, in milliseconds. |
| `snippet` | Optional initialization JavaScript for browser pages. |
| `schedule` | Optional local-time execution window. |
| `devices` | Relative weights for the available browser and device profiles. |
| `personas` | Session presets that vary scrolling, interaction and dwell time. |
| `proxy` | Enables proxy assignment and configures pool selection and country filtering. |
| `stealthMode` | Selects the browser launch profile. |
| `resourceMode` | Controls browser resource handling or selects a CDP backend. |
| `waves` | Optional run planning settings for grouping and varying scenario sessions. |
| `ai` | Optional AI provider, models, guidance and orchestration settings. |
| `sessionPersistence` | Controls local profile reuse and the size of the pool. |
| `adSafety` | Safety switches that control overlay dismissal, pop-under handling, click filtering and a telemetry header. |

See [the technical specification](docs/SPEC.md) for the run pipeline, API and scenario step types.

## Ethics and limitations

Operators are responsible for complying with the terms of service, robots directives and advertising policies of any site they automate. The authors provide this software as-is for testing, QA and monitoring of sites the operator owns or is authorized to test.

## License

[MIT](LICENSE)
