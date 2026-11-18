# How to Limit Residential Proxy Bandwidth in Playwright & Crawlee

Metered residential proxies are priced per gigabyte. Traffic Engine includes three built-in layers to prevent unexpected bandwidth overages during large runs.

---

## 1. Hard Byte Budget (`byteBudgetMb`)

When `proxy.tier` is set to `residential` (or metered endpoints are active), `src/residentialPool.js` tracks actual downloaded session bytes (multiplied by `overheadFactor`) in `data/residential-usage.json`:

```json
"proxy": {
  "enabled": true,
  "tier": "residential",
  "residential": {
    "enabled": true,
    "byteBudgetMb": 1000,
    "country": "us",
    "overheadFactor": 1.15
  },
  "fallbackServers": [
    "http://<user>:<pass>@<datacenter-host>:<port>"
  ]
}
```

* When `usedMb >= byteBudgetMb`, Traffic Engine automatically switches subsequent visits to `fallbackServers` (`datacenter` pool).
* If no fallback is configured, the run stops cleanly rather than overspending.

---

## 2. Smart Proxy & RAM Saver (`resourceMode`)

Switch **RAM Saver & CDP Engines (`resourceMode`)** in Tab 5 to cut per-visit bandwidth dramatically:

| Mode | What It Blocks / Caches | Best For |
| --- | --- | --- |
| `full` | Loads everything (images, fonts, media) | Visual audits & screenshots |
| `lite` | Caches JS/CSS in RAM + blocks third-party trackers & heavy media (keeps GA4/GTM) | Balanced traffic & analytics |
| `ultra_lite` | HTML/JS/CSS only + RAM cache (keeps GA4/GTM) | Maximum proxy savings & 1,000+ runs |

---

## 3. Datacenter-Only Mode for Discovery & Testing

Use `proxy.tier = "datacenter"` when running initial page discovery, scenario debugging, or high-volume internal tests—guaranteeing `0MB` residential usage.
