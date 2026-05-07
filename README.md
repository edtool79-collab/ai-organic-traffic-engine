# Traffic Generator

Generates realistic browser sessions on any website. Configured via `config.json`.

## How it works

Each simulated visit:
- Picks a random browser/device profile with weighted distribution (configurable)
- Lands on the first page in `pages` with `firstPagePriority`% probability, otherwise a random page from the pool
- Follows a persona (quick scanner, engaged reader, form filler, window shopper, power user) that controls scroll depth, click rate, read time, and number of pages visited
- Simulates human mouse movement along bezier curves, smooth scrolling, text selection, form interaction, and occasional rage clicks / tab switches
- Spends at least `pageMinMs` ms per page before navigating away
- Sends a realistic `Referer` header (Google, Bing, social, or direct)
- Optionally injects a custom script at the start of every page load

### Default browser distribution

| Profile | Engine | UA | Default weight |
|---|---|---|---|
| `desktopChrome` | Firefox | Chrome/136 Windows/Mac | 40 |
| `iphone14` | WebKit | Mobile Safari | 20 |
| `pixel7` | Firefox | Chrome/136 Android | 12 |
| `desktopFirefox` | Firefox | Firefox | 10 |
| `desktopSafari` | WebKit | Safari | 10 |
| `ipadPro` | WebKit | iPad Safari | 8 |

Chrome sessions run on the Firefox engine to avoid Playwright's Chromium headless-shell being fingerprinted by bot filters.

## Configuration

All settings live in `config.json`:

```json
{
  "targetUrl": "https://example.com",
  "pages": ["/", "/about", "/pricing"],
  "visitCount": 1000,
  "concurrency": 5,
  "firstPagePriority": 60,
  "sessionTimeoutMs": 90000,
  "pageMinMs": 4000,
  "snippet": null,
  "devices": { "desktopChrome": 40, "iphone14": 20, "pixel7": 12, "desktopFirefox": 10, "desktopSafari": 10, "ipadPro": 8 },
  "personas": [...]
}
```

### Core fields

| Field | Default | Description |
|---|---|---|
| `targetUrl` | — | Root URL of the site (required; trailing slash stripped automatically) |
| `pages` | `["/"]` | Pages to visit. If empty or omitted, only the root is visited. |
| `visitCount` | `1000` | Total sessions to run |
| `concurrency` | `5` | Parallel browser contexts (also overridable via `CONCURRENCY` env var) |
| `firstPagePriority` | `60` | % of sessions that land on the first entry in `pages` |
| `sessionTimeoutMs` | `90000` | Hard timeout per session in ms |
| `pageMinMs` | `4000` | Minimum dwell time per page in ms |
| `snippet` | `null` | JS injected at the start of every page load (see below) |

### Device weights

`devices` is a map of profile name → relative weight. Omit a key to disable that profile; set a weight to 0 to disable it. Weights don't need to sum to 100.

```json
"devices": {
  "desktopChrome": 40,
  "iphone14": 20,
  "pixel7": 12,
  "desktopFirefox": 10,
  "desktopSafari": 10,
  "ipadPro": 8
}
```

### Personas

`personas` is an array of visitor behavior profiles. Each session picks one at random. All fields have defaults so you only need to specify what you want to override.

| Field | Default | Description |
|---|---|---|
| `name` | `"custom"` | Label shown in logs |
| `scrollDepth` | `0.5` | Fraction of page height scrolled (0–1) |
| `clickRate` | `0.5` | Probability of clicking a link or element (0–1) |
| `readTime` | `[1000, 3000]` | `[min, max]` ms spent reading per page |
| `pageCount` | `[1, 3]` | `[min, max]` pages visited per session |
| `idleChance` | `0.08` | Probability of pausing mid-session (0–1) |
| `resizeChance` | `0.1` | Probability of resizing the window (0–1) |
| `uTurnChance` | `0.1` | Probability of hitting back before finishing a page (0–1) |

```json
"personas": [
  { "name": "quick_scanner",  "scrollDepth": 0.3, "clickRate": 0.5, "readTime": [500, 1800],  "pageCount": [1,2], "idleChance": 0.04, "resizeChance": 0.0,  "uTurnChance": 0.2  },
  { "name": "engaged_reader", "scrollDepth": 0.9, "clickRate": 0.7, "readTime": [2000, 5000], "pageCount": [2,4], "idleChance": 0.15, "resizeChance": 0.1,  "uTurnChance": 0.05 },
  { "name": "form_filler",    "scrollDepth": 0.6, "clickRate": 0.9, "readTime": [1000, 3000], "pageCount": [2,3], "idleChance": 0.10, "resizeChance": 0.05, "uTurnChance": 0.05 },
  { "name": "window_shopper", "scrollDepth": 0.5, "clickRate": 0.6, "readTime": [800, 2500],  "pageCount": [2,5], "idleChance": 0.08, "resizeChance": 0.15, "uTurnChance": 0.3  },
  { "name": "power_user",     "scrollDepth": 1.0, "clickRate": 0.9, "readTime": [1500, 4000], "pageCount": [3,6], "idleChance": 0.12, "resizeChance": 0.2,  "uTurnChance": 0.1  }
]
```

### Snippet injection

Set `snippet` to inject any JavaScript at the start of every page load — analytics, session replay, heatmap tools, etc. Accepts either a raw JS string or a full `<script>…</script>` block; the tags are stripped automatically.

```json
{
  "snippet": "<script>\nconsole.log('injected');\n</script>"
}
```

### Multiple sites / configs

Pass a config file path as the first argument:

```sh
node generate_visits.js /path/to/other-site.json
```

## Usage

### Docker (recommended)

```sh
docker compose up --build
```

Override concurrency without editing the config:

```sh
CONCURRENCY=10 docker compose up --build
```

### Local

```sh
npm install
npx playwright install firefox webkit
node generate_visits.js
```
