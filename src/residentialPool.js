'use strict';

/**
 * Residential proxy pool (Webshare) with a hard byte budget.
 *
 * The plan is metered: 1 GB total, no rollover. Every visit that goes through this pool is
 * charged, so this module exists to (a) build a small, evenly-spread sample of sticky sessions
 * out of the provider's export and (b) keep a persistent running total of the bytes consumed,
 * so the runner can fall back to the datacenter pool before the quota is silently exhausted.
 *
 * The provider export format is `host:port:user:pass` (one line per sticky session). It is never
 * logged and never written to a report — only `host:port` labels are printed.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const POOL_FILE = process.env.WTG_RESI_POOL_FILE || path.join(DATA_DIR, 'proxies-residential.json');
const USAGE_FILE = process.env.WTG_RESI_USAGE_FILE || path.join(DATA_DIR, 'residential-usage.json');

// Leave headroom below the 1 GB plan: the budget is a safety rail, not the provider's limit.
const DEFAULT_BUDGET_MB = 800;
const DEFAULT_SAMPLE = 60;

function hostPort(url) {
  try {
    const u = new URL(String(url));
    return `${u.hostname}:${u.port || '80'}`;
  } catch {
    return 'proxy';
  }
}

/** Parses `host:port:user:pass` lines (or full URLs) into proxy URLs.
 *  Webshare targets a country by appending `-<cc>` to the username (verified live: `-us` returns a
 *  Charter residential IP, while `-country-us` is rejected with HTTP 400). */
function parseProxyList(text, { country = '' } = {}) {
  const suffix = String(country || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const out = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^https?:\/\//i.test(line)) {
      out.push(line);
      continue;
    }
    const parts = line.split(':');
    if (parts.length !== 4) continue;
    const [host, port, user, pass] = parts;
    if (!host || !port || !user) continue;
    const finalUser = suffix ? `${user}-${suffix}` : user;
    out.push(`http://${encodeURIComponent(finalUser)}:${encodeURIComponent(pass)}@${host}:${port}`);
  }
  return out;
}

/** Picks `count` entries spread evenly across the list, so sticky sessions cover the whole pool. */
function sampleEvenly(list, count) {
  if (!Array.isArray(list) || !list.length) return [];
  const target = Math.max(1, Math.min(Number(count) || DEFAULT_SAMPLE, list.length));
  if (target >= list.length) return list.slice();
  const picked = [];
  const step = list.length / target;
  for (let i = 0; i < target; i += 1) {
    picked.push(list[Math.floor(i * step)]);
  }
  return [...new Set(picked)];
}

const SOURCE_FILE = process.env.WTG_RESI_SOURCE_FILE || path.join(DATA_DIR, 'proxies-residential.txt');
const countryCache = new Map();

/**
 * Country-targeted view of the provider export, generated on the fly.
 *
 * Webshare targets a country by appending `-<cc>` to the username, so the same 1 GB plan can exit
 * from the US, the UK, etc. without any extra purchase. The result is intentionally NOT written to
 * POOL_FILE: the runner keeps its global pool, and a recording can be pinned to one country
 * without silently changing what every future visit uses.
 */
function listForCountry(country = '', { sampleCount = DEFAULT_SAMPLE } = {}) {
  const cc = String(country || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!cc) return getServers({ residential: { enabled: true } });
  if (countryCache.has(cc)) return countryCache.get(cc);
  let list = [];
  try {
    const text = fs.readFileSync(SOURCE_FILE, 'utf8');
    list = sampleEvenly(parseProxyList(text, { country: cc }), sampleCount);
  } catch {
    list = [];
  }
  countryCache.set(cc, list);
  return list;
}

/** Reads a provider export, samples it, and caches the compact pool on disk. */
function buildPool(sourceFile, { sampleCount = DEFAULT_SAMPLE, country = '' } = {}) {
  const text = fs.readFileSync(sourceFile, 'utf8');
  const all = parseProxyList(text, { country });
  if (!all.length) throw new Error(`no proxies parsed from ${path.basename(sourceFile)}`);
  const pool = sampleEvenly(all, sampleCount);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(POOL_FILE, JSON.stringify(pool, null, 0), 'utf8');
  return { total: all.length, sampled: pool.length, country: country || null, poolFile: POOL_FILE };
}

function getServers(cfg = {}) {
  const resi = cfg.residential || cfg || {};
  if (resi.enabled === false) return [];
  try {
    if (!fs.existsSync(POOL_FILE)) return [];
    const arr = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
    return Array.isArray(arr) ? arr.filter(u => typeof u === 'string' && u) : [];
  } catch {
    return [];
  }
}

function getUsage() {
  try {
    if (!fs.existsSync(USAGE_FILE)) return { bytes: 0, visits: 0, updatedAt: null };
    const parsed = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    return {
      bytes: Number(parsed.bytes) || 0,
      visits: Number(parsed.visits) || 0,
      updatedAt: parsed.updatedAt || null,
    };
  } catch {
    return { bytes: 0, visits: 0, updatedAt: null };
  }
}

function budgetMbOf(cfg = {}) {
  const resi = cfg.residential || cfg || {};
  const n = Number(resi.byteBudgetMb);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUDGET_MB;
}

function summary(cfg = {}) {
  const usage = getUsage();
  const budgetMb = budgetMbOf(cfg);
  const usedMb = usage.bytes / (1024 * 1024);
  const remainingMb = Math.max(0, budgetMb - usedMb);
  return {
    budgetMb,
    usedMb: Number(usedMb.toFixed(2)),
    remainingMb: Number(remainingMb.toFixed(2)),
    usedPct: Number(((usedMb / budgetMb) * 100).toFixed(1)),
    visits: usage.visits,
    exhausted: remainingMb <= 0,
    poolSize: getServers(cfg).length,
    updatedAt: usage.updatedAt,
  };
}

function isExhausted(cfg = {}) {
  return summary(cfg).exhausted;
}

/** Adds the bytes of one finished visit to the persistent counter. */
function addBytes(bytes, { visits = 0 } = {}) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return summary({});
  const current = getUsage();
  const next = {
    bytes: current.bytes + Math.round(n),
    visits: current.visits + (Number(visits) || 0),
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USAGE_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch {}
  return next;
}

function resetUsage() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USAGE_FILE, JSON.stringify({ bytes: 0, visits: 0, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch {}
}

/** True for any proxy that bills against the metered residential plan (the Webshare gateway). */
function isResidentialUrl(url) {
  if (!url) return false;
  const raw = String(url);
  if (/p\.webshare\.io/i.test(raw)) return true;
  return getServers({ residential: { enabled: true } }).includes(raw);
}

function isPoolMember(url, cfg = {}) {
  if (!url) return false;
  return getServers(cfg).includes(String(url));
}

module.exports = {
  parseProxyList,
  sampleEvenly,
  buildPool,
  getServers,
  getUsage,
  addBytes,
  resetUsage,
  summary,
  isExhausted,
  isPoolMember,
  isResidentialUrl,
  listForCountry,
  budgetMbOf,
  hostPort,
  POOL_FILE,
  USAGE_FILE,
  DEFAULT_BUDGET_MB,
};
