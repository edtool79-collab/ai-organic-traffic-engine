const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

const PROXIES_TXT_PATH = path.join(__dirname, '..', 'proxies.txt');
const GEO_DISK_CACHE_PATH = path.join(__dirname, '..', 'session-profiles', '.proxy-geo-cache.json');

const COUNTRY_LOCALE_MAP = {
  IL: 'he-IL',
  US: 'en-US',
  GB: 'en-GB',
  UK: 'en-GB',
  CA: 'en-CA',
  AU: 'en-AU',
  DE: 'de-DE',
  FR: 'fr-FR',
  NL: 'nl-NL',
  ES: 'es-ES',
  IT: 'it-IT',
  BR: 'pt-BR',
  PL: 'pl-PL',
  JP: 'ja-JP',
  IN: 'en-IN',
  SG: 'en-SG',
};

const geoCache = new Map();
const proxyCountryCache = new Map();

function loadDiskGeoCache() {
  try {
    if (!fs.existsSync(GEO_DISK_CACHE_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(GEO_DISK_CACHE_PATH, 'utf8'));
    if (raw && typeof raw.geo === 'object') {
      for (const [k, v] of Object.entries(raw.geo)) {
        if (v && typeof v === 'object') geoCache.set(k, v);
      }
    }
    if (raw && typeof raw.country === 'object') {
      for (const [k, v] of Object.entries(raw.country)) {
        if (typeof v === 'string') proxyCountryCache.set(k, v);
      }
    }
  } catch {}
}

function saveDiskGeoCache() {
  try {
    fs.mkdirSync(path.dirname(GEO_DISK_CACHE_PATH), { recursive: true });
    fs.writeFileSync(
      GEO_DISK_CACHE_PATH,
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        geo: Object.fromEntries(geoCache),
        country: Object.fromEntries(proxyCountryCache),
      }),
      'utf8'
    );
  } catch {}
}

loadDiskGeoCache();

function inferLocaleFromCountry(countryCode, fallbackLocale = 'en-US') {
  const code = String(countryCode || '').trim().toUpperCase();
  return COUNTRY_LOCALE_MAP[code] || fallbackLocale;
}

function getSystemGeoFallback() {
  let timeZone = 'UTC';
  let locale = 'en-US';
  try {
    const opts = Intl.DateTimeFormat().resolvedOptions();
    if (opts.timeZone) timeZone = opts.timeZone;
    if (opts.locale) locale = opts.locale;
  } catch {}
  return {
    exitIp: null,
    countryCode: null,
    timezoneId: timeZone,
    locale,
  };
}

/**
 * Resolves exit IP timezone and consistent browser locale (cached per proxy endpoint).
 */
function resolveNetworkGeo(proxyUrlStr = null, timeoutMs = 2500) {
  const isRotatingGateway = Boolean(proxyUrlStr && /(-rotate|rotating|backconnect)/i.test(proxyUrlStr));
  const cacheKey = isRotatingGateway ? null : (proxyUrlStr || '__direct__');
  if (cacheKey && geoCache.has(cacheKey)) {
    return Promise.resolve(geoCache.get(cacheKey));
  }

  return new Promise(resolve => {
    const fallback = getSystemGeoFallback();
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (cacheKey) {
        geoCache.set(cacheKey, result);
        if (result?.countryCode) {
          proxyCountryCache.set(cacheKey, result.countryCode);
        }
        saveDiskGeoCache();
      }
      resolve(result);
    };

    try {
      const reqOpts = { timeout: timeoutMs };
      if (proxyUrlStr) {
        reqOpts.agent = createAgent(normalizeProxyLine(proxyUrlStr));
      }
      const req = http.get(
        'http://ip-api.com/json/?fields=status,countryCode,timezone,query',
        reqOpts,
        res => {
          let data = '';
          res.on('data', chunk => { data += chunk.toString('utf8'); });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (res.statusCode && res.statusCode < 400 && json?.status === 'success') {
                const cc = json.countryCode || null;
                return finish({
                  exitIp: json.query || null,
                  countryCode: cc,
                  timezoneId: json.timezone || fallback.timezoneId,
                  locale: inferLocaleFromCountry(cc, fallback.locale),
                });
              }
            } catch {}
            finish(fallback);
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('Timeout')));
      req.on('error', () => finish(fallback));
    } catch {
      finish(fallback);
    }
  });
}

/**
 * Normalizes a proxy entry into a standard URL string:
 * Supports:
 * - http://host:port
 * - https://host:port
 * - socks5://user:pass@host:port
 * - host:port (assumes http://)
 * - host:port:user:pass (assumes http://)
 */
function normalizeProxyLine(rawLine) {
  if (typeof rawLine !== 'string') return null;
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) return null;

  let candidate = line;
  if (!/^[a-z0-9]+:\/\//i.test(candidate)) {
    const parts = candidate.split(':');
    if (parts.length === 2 && parts[0] && /^\d+$/.test(parts[1])) {
      candidate = `http://${parts[0]}:${parts[1]}`;
    } else if (parts.length === 4 && parts[0] && /^\d+$/.test(parts[1])) {
      candidate = `http://${encodeURIComponent(parts[2])}:${encodeURIComponent(parts[3])}@${parts[0]}:${parts[1]}`;
    } else {
      throw new Error(`פורמט Proxy לא תקין: ${line}`);
    }
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`כתובת Proxy לא תקינה: ${line}`);
  }

  if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(parsed.protocol)) {
    throw new Error(`פרוטוקול Proxy לא נתמך (${parsed.protocol}): ${line}`);
  }
  if (!parsed.hostname) {
    throw new Error(`חסר hostname ב-Proxy: ${line}`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function readProxiesTxt(filePath = PROXIES_TXT_PATH) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const out = [];
  for (const l of lines) {
    try {
      const normalized = normalizeProxyLine(l);
      if (normalized) out.push(normalized);
    } catch {
      // Skip invalid comment/line safely when reading file
    }
  }
  return out;
}

function writeProxiesTxt(servers, filePath = PROXIES_TXT_PATH) {
  const header = [
    '# Proxy list (one server per line)',
    '# Supported formats: http://host:port | http://host:port | socks5://host:port | host:port',
    '',
  ];
  const body = (servers || []).map(s => s.trim()).filter(Boolean);
  fs.writeFileSync(filePath, header.concat(body).join('\n') + '\n', 'utf8');
}

function isLoopbackUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

function toPlaywrightProxy(urlStr) {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    const out = {
      server: `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`,
    };
    if (u.username) out.username = decodeURIComponent(u.username);
    if (u.password) out.password = decodeURIComponent(u.password);
    return out;
  } catch {
    return null;
  }
}

function createCrawleeProxyConfiguration(proxyUrls) {
  if (!Array.isArray(proxyUrls) || !proxyUrls.length) return null;
  const { ProxyConfiguration } = require('crawlee');
  return new ProxyConfiguration({ proxyUrls });
}

const FALLBACK_PROXIES_TXT_PATH = path.join(__dirname, '..', 'proxies-fallback.txt');
const DATACENTER_PROXIES_PATH = path.join(__dirname, '..', 'data', 'proxies-datacenter.json');

function readFallbackProxiesTxt() {
  return readProxiesTxt(FALLBACK_PROXIES_TXT_PATH);
}

/** Reads the static datacenter proxy pool (`WTG_DATACENTER_FILE` override supported). */
function readDatacenterServers() {
  try {
    const p = process.env.WTG_DATACENTER_FILE || DATACENTER_PROXIES_PATH;
    if (!fs.existsSync(p)) return [];
    const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

const PROXY_FAILURE_RE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_PROXY_AUTH|ERR_UNSUPPORTED_AUTH_SCHEME|ERR_NO_SUPPORTED_PROXIES|Proxy Authentication Required|\b40[27]\b/i;

/**
 * Proxy pool with automatic failover: runs on the primary list (e.g. Rotating Residential) and,
 * when the primary keeps failing on proxy-level errors AND a live probe confirms it is dead
 * (quota exhausted / auth rejected), switches to the fallback list (e.g. Static) without stopping the run.
 */
function createFailoverProxyPool(primaryUrls, fallbackUrls = [], hooks = {}) {
  const { ProxyConfiguration } = require('crawlee');
  let active = Array.isArray(primaryUrls) ? [...primaryUrls] : [];
  const fallbackRaw = Array.isArray(fallbackUrls) ? [...fallbackUrls] : [];
  const failureThreshold = Number(hooks.failureThreshold) > 0 ? Number(hooks.failureThreshold) : 3;
  let usingFallback = false;
  let rr = 0;
  let consecutiveFailures = 0;
  let switching = false;
  const sticky = new Map();

  const pick = sessionId => {
    if (!active.length) return null;
    if (sessionId !== undefined && sessionId !== null) {
      const key = String(sessionId);
      if (sticky.has(key)) return sticky.get(key);
      const url = active[rr++ % active.length];
      sticky.set(key, url);
      if (sticky.size > 5000) sticky.delete(sticky.keys().next().value);
      return url;
    }
    return active[rr++ % active.length];
  };

  const proxyConfiguration = new ProxyConfiguration({ newUrlFunction: sessionId => pick(sessionId) });

  async function switchToFallback(reason) {
    if (usingFallback || !fallbackRaw.length) return false;
    let list = fallbackRaw;
    if (typeof hooks.filterFallback === 'function') {
      try {
        const filtered = await hooks.filterFallback(fallbackRaw);
        if (Array.isArray(filtered) && filtered.length) list = filtered;
      } catch {}
    }
    active = [...list];
    sticky.clear();
    rr = 0;
    usingFallback = true;
    consecutiveFailures = 0;
    if (typeof hooks.onSwitch === 'function') hooks.onSwitch(active, reason);
    return true;
  }

  function reportFailure(err) {
    const msg = String(err?.message || err || '');
    if (!PROXY_FAILURE_RE.test(msg)) return;
    consecutiveFailures++;
    if (consecutiveFailures < failureThreshold || usingFallback || !fallbackRaw.length || switching) return;
    switching = true;
    Promise.resolve().then(async () => {
      try {
        const probes = await Promise.all(active.slice(0, 2).map(p => checkSingleProxy(p, 5500)));
        if (probes.some(r => r && r.ok)) {
          consecutiveFailures = 0;
          return;
        }
        const reason = [...new Set(probes.map(r => r?.error || 'Unreachable'))].join(', ');
        await switchToFallback(reason);
      } catch {} finally {
        switching = false;
      }
    });
  }

  function reportSuccess() {
    consecutiveFailures = 0;
  }

  return {
    proxyConfiguration,
    pick,
    reportFailure,
    reportSuccess,
    switchToFallback,
    getActiveUrls: () => [...active],
    isUsingFallback: () => usingFallback,
    hasFallback: () => fallbackRaw.length > 0,
  };
}

function createAgent(proxyUrlStr) {
  const u = new URL(proxyUrlStr);
  if (u.protocol === 'socks4:' || u.protocol === 'socks5:') {
    return new SocksProxyAgent(proxyUrlStr);
  }
  return new HttpsProxyAgent(proxyUrlStr);
}

function maskProxyLabel(proxyUrlStr) {
  try {
    const u = new URL(proxyUrlStr);
    return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
  } catch {
    return proxyUrlStr;
  }
}

function checkSingleProxy(rawProxy, timeoutMs = 6000) {
  return new Promise(resolve => {
    let normalized;
    try {
      normalized = normalizeProxyLine(rawProxy);
    } catch (err) {
      return resolve({ proxy: rawProxy, ok: false, latencyMs: null, exitIp: null, country: null, error: err.message });
    }
    if (!normalized) {
      return resolve({ proxy: rawProxy, ok: false, latencyMs: null, exitIp: null, country: null, error: 'שורה ריקה' });
    }

    const masked = maskProxyLabel(normalized);
    const started = Date.now();
    let settled = false;
    const finish = res => {
      if (settled) return;
      settled = true;
      resolve({ proxy: masked, raw: normalized, ...res });
    };

    try {
      const agent = createAgent(normalized);
      const req = http.get(
        'http://ip-api.com/json/?fields=status,country,countryCode,timezone,query',
        { agent, timeout: timeoutMs },
        res => {
          let data = '';
          res.on('data', chunk => { data += chunk.toString('utf8'); });
          res.on('end', () => {
            const latencyMs = Date.now() - started;
            if (res.statusCode && res.statusCode >= 400) {
              return finish({ ok: false, latencyMs, exitIp: null, country: null, timezoneId: null, error: `HTTP ${res.statusCode}` });
            }
            try {
              const json = JSON.parse(data);
              finish({
                ok: true,
                latencyMs,
                exitIp: json.query || null,
                country: json.countryCode ? `${json.country || ''} (${json.countryCode})`.trim() : null,
                timezoneId: json.timezone || null,
                error: null,
              });
            } catch {
              finish({ ok: true, latencyMs, exitIp: null, country: null, timezoneId: null, error: null });
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Timeout'));
      });
      req.on('error', err => {
        finish({ ok: false, latencyMs: Date.now() - started, exitIp: null, country: null, error: err.message });
      });
    } catch (err) {
      finish({ ok: false, latencyMs: Date.now() - started, exitIp: null, country: null, error: err.message });
    }
  });
}

async function checkProxiesBatch(proxyLines, concurrency = 5) {
  const results = [];
  const queue = [...proxyLines];
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      results.push(await checkSingleProxy(item));
    }
  });
  await Promise.all(workers);
  return results;
}

const TIER1_DEFAULT_COUNTRIES = ['US', 'GB', 'CA', 'AU', 'DE'];

const COUNTRY_CATALOG = [
  { code: 'US', nameHe: 'ארה״ב (US)', tier: 1 },
  { code: 'GB', nameHe: 'בריטניה (GB)', tier: 1 },
  { code: 'CA', nameHe: 'קנדה (CA)', tier: 1 },
  { code: 'AU', nameHe: 'אוסטרליה (AU)', tier: 1 },
  { code: 'DE', nameHe: 'גרמניה (DE)', tier: 1 },
  { code: 'IL', nameHe: 'ישראל (IL)', tier: 2 },
  { code: 'FR', nameHe: 'צרפת (FR)', tier: 2 },
  { code: 'NL', nameHe: 'הולנד (NL)', tier: 2 },
  { code: 'ES', nameHe: 'ספרד (ES)', tier: 2 },
  { code: 'IT', nameHe: 'איטליה (IT)', tier: 2 },
  { code: 'PL', nameHe: 'פולין (PL)', tier: 2 },
  { code: 'SG', nameHe: 'סינגפור (SG)', tier: 2 },
  { code: 'JP', nameHe: 'יפן (JP)', tier: 2 },
  { code: 'BR', nameHe: 'ברזיל (BR)', tier: 3 },
  { code: 'IN', nameHe: 'הודו (IN)', tier: 3 },
];

function normalizeCountryCode(raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return code === 'UK' ? 'GB' : code;
}

function parseProxyCountryHint(proxyUrlStr) {
  const s = String(proxyUrlStr || '').trim();
  if (!s) return null;
  const patterns = [
    /#(?:country[=:]?)?([a-z]{2})\b/i,
    /[?&](?:country|cc|geo|region)=([a-z]{2})\b/i,
    /[-_](?:country|cc|geo|zone|region)[-_]([a-z]{2})\b/i,
    /__cr\.([a-z]{2})\b/i,
    /-([a-z]{2})-\d+(?=[:@])/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const norm = normalizeCountryCode(m[1]);
      if (norm) return norm;
    }
  }
  return null;
}

function stripProxyHashMetadata(proxyUrlStr) {
  return String(proxyUrlStr || '').trim().replace(/#.*$/, '');
}

function expandProxyForCountries(rawProxies = [], preferredCountries = TIER1_DEFAULT_COUNTRIES) {
  const countries = (Array.isArray(preferredCountries) ? preferredCountries : [])
    .map(normalizeCountryCode)
    .filter(Boolean);
  const effectiveCountries = countries.length ? countries : TIER1_DEFAULT_COUNTRIES;
  const out = [];
  const seen = new Set();

  for (const raw of Array.isArray(rawProxies) ? rawProxies : []) {
    const trimmed = String(raw || '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/\{country\}/i.test(trimmed)) {
      for (const cc of effectiveCountries) {
        const substituted = trimmed
          .replace(/\{COUNTRY\}/g, cc.toUpperCase())
          .replace(/\{country\}/g, cc.toLowerCase());
        const normalized = normalizeProxyLine(stripProxyHashMetadata(substituted));
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          out.push({ url: normalized, hint: cc });
        }
      }
    } else {
      const hint = parseProxyCountryHint(trimmed);
      const normalized = normalizeProxyLine(stripProxyHashMetadata(trimmed));
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        out.push({ url: normalized, hint });
      }
    }
  }
  return out;
}

/**
 * Selects/filters proxies matching preferred countries while keeping safe fallback behavior
 * so existing non-tagged proxy lists never drop silently unless fallbackToAnyIfEmpty is false.
 */
async function selectProxiesForCountries(rawProxies = [], options = {}) {
  const preferred = (Array.isArray(options.preferredCountries) ? options.preferredCountries : TIER1_DEFAULT_COUNTRIES)
    .map(normalizeCountryCode)
    .filter(Boolean);
  const preferredSet = new Set(preferred.length ? preferred : TIER1_DEFAULT_COUNTRIES);
  const countryFilterEnabled = options.countryFilterEnabled !== false;
  const fallbackToAnyIfEmpty = options.fallbackToAnyIfEmpty !== false;
  const probeUntagged = options.probeUntagged !== false;
  const geoProbeFn = typeof options.geoProbeFn === 'function' ? options.geoProbeFn : resolveNetworkGeo;

  const expanded = expandProxyForCountries(rawProxies, [...preferredSet]);
  const countryByUrl = new Map();

  for (const entry of expanded) {
    if (entry.hint) {
      countryByUrl.set(entry.url, entry.hint);
      proxyCountryCache.set(entry.url, entry.hint);
    } else if (proxyCountryCache.has(entry.url)) {
      countryByUrl.set(entry.url, proxyCountryCache.get(entry.url));
    }
  }

  if (!countryFilterEnabled || !expanded.length) {
    return {
      proxies: expanded.map(e => e.url),
      fallbackUsed: false,
      matchedCount: expanded.length,
      totalCount: expanded.length,
      countryByUrl: Object.fromEntries(countryByUrl),
    };
  }

  // Probe untagged proxies (up to 15) concurrently so gateway/static lists work by real exit country
  const needProbe = probeUntagged
    ? expanded.filter(e => !countryByUrl.has(e.url)).slice(0, 15)
    : [];
  if (needProbe.length) {
    const queue = [...needProbe];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const entry = queue.shift();
        try {
          const geo = await geoProbeFn(entry.url, 3000);
          const cc = normalizeCountryCode(geo?.countryCode);
          if (cc) {
            countryByUrl.set(entry.url, cc);
            proxyCountryCache.set(entry.url, cc);
          }
        } catch {}
      }
    });
    await Promise.all(workers);
    saveDiskGeoCache();
  }

  const matched = expanded.filter(e => preferredSet.has(countryByUrl.get(e.url)));
  if (matched.length) {
    return {
      proxies: matched.map(e => e.url),
      fallbackUsed: false,
      matchedCount: matched.length,
      totalCount: expanded.length,
      countryByUrl: Object.fromEntries(countryByUrl),
    };
  }

  return {
    proxies: fallbackToAnyIfEmpty ? expanded.map(e => e.url) : [],
    fallbackUsed: fallbackToAnyIfEmpty && expanded.length > 0,
    matchedCount: 0,
    totalCount: expanded.length,
    countryByUrl: Object.fromEntries(countryByUrl),
  };
}

module.exports = {
  PROXIES_TXT_PATH,
  TIER1_DEFAULT_COUNTRIES,
  COUNTRY_CATALOG,
  normalizeCountryCode,
  parseProxyCountryHint,
  expandProxyForCountries,
  selectProxiesForCountries,
  normalizeProxyLine,
  readProxiesTxt,
  writeProxiesTxt,
  toPlaywrightProxy,
  createCrawleeProxyConfiguration,
  FALLBACK_PROXIES_TXT_PATH,
  DATACENTER_PROXIES_PATH,
  readFallbackProxiesTxt,
  readDatacenterServers,
  createFailoverProxyPool,
  checkSingleProxy,
  checkProxiesBatch,
  maskProxyLabel,
  resolveNetworkGeo,
  inferLocaleFromCountry,
  isLoopbackUrl,
};
