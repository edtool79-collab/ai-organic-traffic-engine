# How to Configure Decodo Proxies in Traffic Engine

Traffic Engine works out of the box with **Decodo** HTTP and SOCKS5 endpoints, supporting both rotating residential gateways and sticky-session ports.

> **Disclosure:** Links to Decodo in this guide may be affiliate links once configured. You can use any standard HTTP or SOCKS5 proxy provider with Traffic Engine.

---

## 1. Formatting Decodo Endpoints

Add your Decodo proxy endpoints in **Tab 5 (`Proxy, Cookies & Analytics`)** or in your local gitignored `proxies.txt` file:

```text
# HTTP endpoint
http://<username>:<password>@gate.decodo.com:<port>

# SOCKS5 endpoint
socks5://<username>:<password>@gate.decodo.com:<port>
```

If your provider export uses `host:port:username:password`, Traffic Engine parses it automatically.

---

## 2. Geo-Targeting & Sticky Sessions

* **Country targeting:** Use Decodo's country-specific username parameters or `{country}` placeholder templates (e.g., `user-country-{country}`), and enable **Prioritize and filter proxy servers by the selected countries below** in Tab 5.
* **Session rotation:** Choose `round_robin` for even distribution across ports, or `random` for randomized selection per visit.
* **Fallback safety:** Add static datacenter proxies to `proxy.fallbackServers` (or `proxies-fallback.txt`) so runs fall back cleanly instead of exposing your local IP if a metered pool reaches its cap.

---

## 3. Testing Before a Run

Click **Test Proxies** in Tab 5 to verify reachability, latency (ms), and exit country before starting a full wave.
