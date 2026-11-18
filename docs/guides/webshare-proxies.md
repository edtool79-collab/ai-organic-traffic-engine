# How to Use Webshare Proxies with Traffic Engine

Traffic Engine natively supports both **Webshare Datacenter** (static IPv4) and **Webshare Metered Residential** (`p.webshare.io`) pools, including automatic `-<country>` exit targeting and strict bandwidth metering.

> **Disclosure:** Links to Webshare in this guide may be affiliate links once configured. You can use any standard HTTP or SOCKS5 proxy provider with Traffic Engine.

---

## 1. Supported Webshare Formats

You can paste proxies directly into **Tab 5 (`Proxy, Cookies & Analytics`)** in the dashboard or save them in local gitignored `proxies.txt`:

```text
# Standard HTTP / SOCKS5 URL
http://<username>:<password>@<host>:<port>
socks5://<username>:<password>@<host>:<port>

# Provider export format (host:port:username:password)
198.51.100.10:8080:<username>:<password>
```

---

## 2. Datacenter vs. Metered Residential (`proxy.tier`)

In the dashboard under **Proxy Pool Tier**:

1. **`datacenter` (Recommended for High Volume):** Uses only your static datacenter list (`0MB` residential bandwidth spent).
2. **`residential` (Metered High-Trust IPs):** Uses `residentialPool.js` with automatic `-<cc>` country suffixing (e.g., `<username>-us`) and enforces `byteBudgetMb`.
3. **`auto`:** Uses the active list configured in `proxy.servers` / `proxies.txt`.

---

## 3. Verifying Your Connection

1. Paste your proxy entries into **Proxy Server List** (never commit `proxies.txt` or `config.json` to Git).
2. Click **Test Proxies** in the dashboard to verify latency and exit IP/country before launching a run.
3. For country-specific routing, select your exit country in **Exit Country** or select **Match Selected Flag Grid Above** (`__preferred__`).
