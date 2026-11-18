'use strict';
/**
 * Per-offer proxy memory.
 *
 * A proxy that is blocked on one offer is often perfectly fine on another: the block belongs to
 * the pair (proxy, offer domain), not to the proxy. So every outcome is stored per domain, and a
 * cooldown only silences that pair for a while instead of burning the proxy for the whole run.
 *
 * Storage: data/proxy-scores.json — no network, no keys, no cost.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = process.env.WTG_SCORE_FILE || path.join(DATA_DIR, 'proxy-scores.json');

const MAX_BUCKETS = 1200;
const BASE_COOLDOWN_MS = 3 * 60 * 1000;
const MAX_COOLDOWN_MS = 45 * 60 * 1000;
const HALF_LIFE_MS = 6 * 60 * 60 * 1000; // successes/failures fade by half every 6h
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

// Outcomes that mean "this proxy is not welcome on this specific offer right now".
const COOLDOWN_OUTCOMES = new Set(['block403', 'block429', 'captcha', 'offer_redirect', 'blocked']);

let state = null;

function load() {
  if (state) return state;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    state = raw && typeof raw === 'object' && raw.buckets ? raw : { version: 1, buckets: {} };
  } catch {
    state = { version: 1, buckets: {} };
  }
  return state;
}

function save() {
  if (!state) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
  } catch {
    // Never let bookkeeping break a run.
  }
}

/** Registrable-ish host of a URL, lower-cased, without `www.`. */
function hostOf(url) {
  try {
    return String(new URL(String(url)).hostname || '').toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** `http://user:pass@1.2.3.4:8080` -> `1.2.3.4:8080` (never keeps or logs the secret). */
function proxyKey(proxyUrl) {
  const raw = String(proxyUrl || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return `${u.hostname}:${u.port || '80'}`;
  } catch {
    return raw.replace(/^[a-z]+:\/\//i, '').replace(/^[^@/]*@/, '').replace(/\/.*$/, '');
  }
}

function bucketKey(domain, proxy) {
  return `${String(domain || '').toLowerCase()}::${proxyKey(proxy)}`;
}

function decay(value, ageMs) {
  if (!(value > 0)) return 0;
  if (!(ageMs > 0)) return value;
  return value * Math.pow(0.5, ageMs / HALF_LIFE_MS);
}

function emptyBucket() {
  return {
    ok: 0,
    fail: 0,
    byOutcome: {},
    consecutiveFail: 0,
    firstAt: Date.now(),
    lastAt: Date.now(),
    lastOutcome: '',
    cooldownUntil: 0,
    notes: [],
  };
}

/**
 * Records one visit outcome for a (offer domain, proxy) pair.
 * outcome: 'ok' | 'block403' | 'block429' | 'captcha' | 'offer_redirect' | 'timeout' | 'blocked'
 */
function reportOutcome({ domain, proxyUrl, outcome, note = '' } = {}) {
  const dom = String(domain || '').toLowerCase();
  const proxy = proxyKey(proxyUrl);
  if (!dom || !proxy) return null;
  const st = load();
  const key = bucketKey(dom, proxy);
  const b = st.buckets[key] || emptyBucket();
  const now = Date.now();

  b.byOutcome[outcome] = (b.byOutcome[outcome] || 0) + 1;
  b.lastAt = now;
  b.lastOutcome = outcome;
  if (outcome === 'ok') {
    b.ok += 1;
    b.consecutiveFail = 0;
    b.cooldownUntil = 0;
  } else {
    b.fail += 1;
    if (COOLDOWN_OUTCOMES.has(outcome)) {
      b.consecutiveFail += 1;
      const penalty = Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * Math.pow(2, Math.max(0, b.consecutiveFail - 1)));
      b.cooldownUntil = now + penalty;
    }
  }
  if (note) {
    b.notes.push(String(note).slice(0, 120));
    if (b.notes.length > 3) b.notes.shift();
  }
  st.buckets[key] = b;
  prune(st);
  save();
  return b;
}

function prune(st) {
  const now = Date.now();
  const entries = Object.entries(st.buckets);
  if (entries.length <= MAX_BUCKETS) {
    for (const [k, b] of entries) {
      if (!b || now - Number(b.lastAt || 0) > KEEP_MS) delete st.buckets[k];
    }
    return;
  }
  entries
    .sort((a, b) => Number(b[1]?.lastAt || 0) - Number(a[1]?.lastAt || 0))
    .slice(MAX_BUCKETS)
    .forEach(([k]) => delete st.buckets[k]);
}

/** Laplace-smoothed success rate (1.0 = clean, 0.0 = never worked) with time decay. */
function scoreFor(domain, proxyUrl) {
  const st = load();
  const b = st.buckets[bucketKey(domain, proxyUrl)];
  if (!b) return 0.5; // unknown pair: neutral, so new proxies still get a turn
  const age = Math.max(0, Date.now() - Number(b.lastAt || Date.now()));
  const ok = decay(Number(b.ok) || 0, age);
  const fail = decay(Number(b.fail) || 0, age);
  return (ok + 0.3) / (ok + fail + 0.6);
}

function cooldownLeftMs(domain, proxyUrl) {
  const st = load();
  const b = st.buckets[bucketKey(domain, proxyUrl)];
  if (!b) return 0;
  return Math.max(0, Number(b.cooldownUntil || 0) - Date.now());
}

function isCoolingDown(domain, proxyUrl) {
  return cooldownLeftMs(domain, proxyUrl) > 0;
}

/**
 * Orders proxies for one offer: ready ones by score first, cooling ones last (still available,
 * because a blocked proxy may be the only one left and the retry path can revive it).
 */
function rankProxies(proxies, domain) {
  const list = (Array.isArray(proxies) ? proxies : []).filter(Boolean);
  const ready = [];
  const cooling = [];
  for (const p of list) {
    const item = { proxy: p, score: scoreFor(domain, p), cooldownMs: cooldownLeftMs(domain, p) };
    (item.cooldownMs > 0 ? cooling : ready).push(item);
  }
  ready.sort((a, b) => b.score - a.score);
  cooling.sort((a, b) => (a.cooldownMs - b.cooldownMs) || (b.score - a.score));
  return {
    ordered: [...ready, ...cooling].map(x => x.proxy),
    ready: ready.map(x => x.proxy),
    cooling: cooling.map(x => x.proxy),
    stats: {
      total: list.length,
      ready: ready.length,
      cooling: cooling.length,
      bestScore: ready.length ? Number(ready[0].score.toFixed(3)) : 0,
    },
  };
}

/** Compact per-offer view for logs, the dashboard and the AI agents. */
function domainSummary(domain, proxies = []) {
  const dom = String(domain || '').toLowerCase();
  const st = load();
  const rows = [];
  for (const [key, b] of Object.entries(st.buckets)) {
    const [bucketDomain, bucketProxy] = key.split('::');
    if (bucketDomain !== dom) continue;
    rows.push({
      proxy: bucketProxy,
      score: Number(scoreFor(dom, bucketProxy).toFixed(3)),
      ok: b.ok || 0,
      fail: b.fail || 0,
      lastOutcome: b.lastOutcome || '',
      cooldownMs: cooldownLeftMs(dom, bucketProxy),
    });
  }
  rows.sort((a, b) => b.score - a.score);
  const known = new Set(rows.map(r => r.proxy));
  for (const p of proxies) {
    const k = proxyKey(p);
    if (!k || known.has(k)) continue;
    rows.push({ proxy: k, score: 0.5, ok: 0, fail: 0, lastOutcome: '', cooldownMs: 0 });
  }
  return { domain: dom, entries: rows };
}

function resetDomain(domain) {
  const dom = String(domain || '').toLowerCase();
  const st = load();
  for (const key of Object.keys(st.buckets)) {
    if (!dom || key.startsWith(`${dom}::`)) delete st.buckets[key];
  }
  save();
}

module.exports = {
  hostOf,
  proxyKey,
  reportOutcome,
  scoreFor,
  cooldownLeftMs,
  isCoolingDown,
  rankProxies,
  domainSummary,
  resetDomain,
};
