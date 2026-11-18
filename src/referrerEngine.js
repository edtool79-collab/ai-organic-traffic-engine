'use strict';
/**
 * Referrer engine — makes every visit arrive with a plausible, real-looking source.
 *
 * Why this matters: `page.goto()` sends NO Referer header unless we set one, so every visit used
 * to land as a "Direct Hit" in the affiliate report. A real browser sends the previous page as the
 * referrer, and organic visitors arrive from a search result page. This module produces those URLs.
 *
 * Everything here is a pure function — no network calls, no keys, no cost.
 */

const GOOGLE_DOMAIN_BY_COUNTRY = {
  US: 'www.google.com',
  CA: 'www.google.ca',
  GB: 'www.google.co.uk',
  UK: 'www.google.co.uk',
  AU: 'www.google.com.au',
  DE: 'www.google.de',
  AT: 'www.google.at',
  FR: 'www.google.fr',
  IT: 'www.google.it',
  NL: 'www.google.nl',
  ES: 'www.google.es',
  PL: 'www.google.pl',
  CZ: 'www.google.cz',
  RO: 'www.google.ro',
  JP: 'www.google.co.jp',
  KR: 'www.google.co.kr',
  SG: 'www.google.com.sg',
  BR: 'www.google.com.br',
  IN: 'www.google.co.in',
  IL: 'www.google.co.il',
};

const BING_MARKET_BY_COUNTRY = {
  US: 'en-US', CA: 'en-CA', GB: 'en-GB', UK: 'en-GB', AU: 'en-AU', DE: 'de-DE',
  AT: 'de-AT', FR: 'fr-FR', IT: 'it-IT', NL: 'nl-NL', ES: 'es-ES', PL: 'pl-PL',
  CZ: 'cs-CZ', RO: 'ro-RO', JP: 'ja-JP', KR: 'ko-KR', SG: 'en-SG', BR: 'pt-BR',
  IN: 'en-IN', IL: 'he-IL',
};

// Realistic search phrasing for reward/gift-card offers. Ordered roughly by how people type it.
const QUERY_PATTERNS = [
  '{reward} how to claim',
  '{reward} legit',
  '{reward} real or fake',
  'claim {reward}',
  '{reward} sign up',
  'how to get {reward}',
  '{reward} offer',
  '{brand} gift card ${amount}',
  '$ {amount} {brand} gift card',
  '{brand} gift card giveaway',
  '{reward} 2026',
  'is {reward} worth it',
];

const SOCIAL_REFERRERS = [
  { host: 'www.youtube.com', path: '/results', q: true, weight: 5 },
  { host: 'www.youtube.com', path: '/watch', q: false, weight: 3 },
  { host: 'www.reddit.com', path: '/search', q: true, weight: 4 },
  { host: 'old.reddit.com', path: '/r/beermoney', q: false, weight: 2 },
  { host: 'news.ycombinator.com', path: '/item', q: false, weight: 2 },
  { host: 'www.facebook.com', path: '/search/posts', q: true, weight: 2 },
  { host: 'x.com', path: '/search', q: true, weight: 2 },
  { host: 'www.pinterest.com', path: '/search/pins', q: true, weight: 2 },
  { host: 'www.linkedin.com', path: '/feed', q: false, weight: 1 },
  { host: 'www.quora.com', path: '/search', q: true, weight: 1 },
  { host: 'www.tiktok.com', path: '/search', q: true, weight: 1 },
];

// Weighted search engine mix. DuckDuckGo and Bing are first in the *flow* because they rarely
// challenge datacenter IPs, but Google keeps the largest share because buyers expect it.
const SEARCH_ENGINES = [
  { id: 'google', weight: 58 },
  { id: 'bing', weight: 16 },
  { id: 'duckduckgo', weight: 14 },
  { id: 'yahoo', weight: 6 },
  { id: 'brave', weight: 3 },
  { id: 'ecosia', weight: 3 },
];

function pickWeighted(list) {
  const total = list.reduce((s, x) => s + (Number(x.weight) || 1), 0);
  let roll = Math.random() * total;
  for (const item of list) {
    roll -= Number(item.weight) || 1;
    if (roll <= 0) return item;
  }
  return list[list.length - 1];
}

function normalizeCc(geo) {
  const cc = String((geo && (geo.countryCode || geo.cc)) || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : 'US';
}

/** Derives the reward wording from the offer URL so queries look like organic demand. */
function describeOffer({ title = '', targetUrl = '' } = {}) {
  const text = `${title} ${targetUrl}`.toLowerCase();
  const brand = /cash\s*app|cashapp/.test(text)
    ? 'Cash App'
    : /paypal/.test(text)
      ? 'PayPal'
      : /amazon/.test(text)
        ? 'Amazon'
        : /walmart/.test(text)
          ? 'Walmart'
          : /target/.test(text)
            ? 'Target'
            : 'Gift Card';
  const amountMatch = text.match(/\$\s?(\d{2,4})/) || text.match(/(\d{3,4})/);
  const amount = amountMatch ? amountMatch[1] : '1000';
  const reward = `${brand} gift card`;
  return { brand, amount, reward, title: String(title || '').trim() };
}

function buildQuery({ title = '', targetUrl = '' } = {}) {
  const { brand, amount, reward } = describeOffer({ title, targetUrl });
  const tpl = QUERY_PATTERNS[Math.floor(Math.random() * QUERY_PATTERNS.length)];
  const raw = tpl
    .replace(/\{reward\}/g, reward)
    .replace(/\{brand\}/g, brand)
    .replace(/\{amount\}/g, amount);
  return raw.replace(/\s+/g, ' ').trim();
}

function googleHost(cc) {
  return GOOGLE_DOMAIN_BY_COUNTRY[cc] || 'www.google.com';
}

function buildSerpUrl(engineId, query, cc) {
  const q = encodeURIComponent(query);
  switch (engineId) {
    case 'bing':
      return `https://www.bing.com/search?q=${q}&form=QBLH&setmkt=${BING_MARKET_BY_COUNTRY[cc] || 'en-US'}`;
    case 'duckduckgo':
      return `https://duckduckgo.com/?q=${q}&kl=us-en&ia=web`;
    case 'yahoo':
      return `https://search.yahoo.com/search?p=${q}`;
    case 'brave':
      return `https://search.brave.com/search?q=${q}`;
    case 'ecosia':
      return `https://www.ecosia.org/search?q=${q}`;
    case 'google':
    default:
      return `https://${googleHost(cc)}/search?q=${q}&hl=en`;
  }
}

function pickSearchEngine(engineId, avoid = []) {
  if (engineId) {
    const found = SEARCH_ENGINES.find(e => e.id === engineId);
    if (found) return found;
  }
  // A proxy that Google already challenged keeps working on the other engines.
  const blocked = new Set((Array.isArray(avoid) ? avoid : []).map(x => String(x || '').toLowerCase()));
  const pool = blocked.size ? SEARCH_ENGINES.filter(e => !blocked.has(e.id)) : SEARCH_ENGINES;
  return pickWeighted(pool.length ? pool : SEARCH_ENGINES);
}

/**
 * The URL a visitor would be standing on before they reach the offer.
 * Returned shape: { url, kind } where kind is 'search' | 'social' | 'direct'.
 */
function pickReferrer({ geo = null, title = '', targetUrl = '', mode = 'search_engines' } = {}) {
  const cc = normalizeCc(geo);
  const normalized = String(mode || '').toLowerCase();

  if (normalized === 'direct') return { url: '', kind: 'direct' };

  if (normalized === 'google_organic') {
    return { url: buildSerpUrl('google', buildQuery({ title, targetUrl }), cc), kind: 'search' };
  }

  if (normalized === 'social') {
    const s = pickWeighted(SOCIAL_REFERRERS);
    const q = s.q ? `?q=${encodeURIComponent(buildQuery({ title, targetUrl }))}` : '';
    return { url: `https://${s.host}${s.path}${q}`, kind: 'social' };
  }

  // Pure search traffic (no direct tail): every arrival is explainable by a results page.
  if (normalized === 'search_engines') {
    if (Math.random() < 0.92) {
      const engine = pickSearchEngine();
      return { url: buildSerpUrl(engine.id, buildQuery({ title, targetUrl }), cc), kind: 'search' };
    }
    const s = pickWeighted(SOCIAL_REFERRERS);
    const q = s.q ? `?q=${encodeURIComponent(buildQuery({ title, targetUrl }))}` : '';
    return { url: `https://${s.host}${s.path}${q}`, kind: 'social' };
  }

  // Default: search-dominated mix with a small direct tail, so the source split looks organic.
  const roll = Math.random();
  if (roll < 0.76) {
    const engine = pickSearchEngine();
    return { url: buildSerpUrl(engine.id, buildQuery({ title, targetUrl }), cc), kind: 'search' };
  }
  if (roll < 0.94) {
    const s = pickWeighted(SOCIAL_REFERRERS);
    const q = s.q ? `?q=${encodeURIComponent(buildQuery({ title, targetUrl }))}` : '';
    return { url: `https://${s.host}${s.path}${q}`, kind: 'social' };
  }
  return { url: '', kind: 'direct' };
}

/** Per-engine DOM hints so the warm-up step can type into the real search box. */
function searchEngineProfile(engineId, cc) {
  const q = buildQuery;
  switch (engineId) {
    case 'bing':
      return {
        id: 'bing',
        homeUrl: 'https://www.bing.com/?setlang=en',
        inputSelectors: ['#sb_form_q', 'input[name="q"]', 'textarea[name="q"]'],
        submitSelectors: ['#sb_form_go', 'button[type="submit"]'],
        acceptSelectors: ['#bnp_btn_accept', 'button#bnp_btn_accept'],
      };
    case 'duckduckgo':
      return {
        id: 'duckduckgo',
        homeUrl: 'https://duckduckgo.com/',
        inputSelectors: ['#searchbox_input', 'input[name="q"]', '#search_form_input'],
        submitSelectors: ['button[aria-label="Search"]', 'button[type="submit"]'],
        acceptSelectors: [],
      };
    case 'yahoo':
      return {
        id: 'yahoo',
        homeUrl: 'https://search.yahoo.com/',
        inputSelectors: ['#yschsp', 'input[name="p"]'],
        submitSelectors: ['button[type="submit"]'],
        acceptSelectors: ['button[name="agree"]', '#scroll-down-btn'],
      };
    case 'brave':
      return {
        id: 'brave',
        homeUrl: 'https://search.brave.com/',
        inputSelectors: ['input[name="q"]', '#search-input'],
        submitSelectors: ['button[type="submit"]'],
        acceptSelectors: [],
      };
    case 'ecosia':
      return {
        id: 'ecosia',
        homeUrl: 'https://www.ecosia.org/',
        inputSelectors: ['input[name="q"]'],
        submitSelectors: ['button[type="submit"]'],
        acceptSelectors: [],
      };
    case 'google':
    default:
      return {
        id: 'google',
        homeUrl: `https://${googleHost(cc)}/`,
        inputSelectors: ['textarea[name="q"]', 'input[name="q"]', 'textarea[title="Search"]', '#APjFqb'],
        submitSelectors: ['input[name="btnK"]', 'button[type="submit"]', 'center input[type="submit"]'],
        acceptSelectors: [
          'button#L2AGLb',
          'button[aria-label="Accept all"]',
          'button[aria-label="I agree"]',
          'form[action*="consent"] button',
          '#W0wltc',
        ],
      };
  }
  void q;
}

const MODES = ['mixed', 'google_organic', 'search_engines', 'social', 'direct'];

module.exports = {
  MODES,
  GOOGLE_DOMAIN_BY_COUNTRY,
  pickReferrer,
  pickSearchEngine,
  buildSerpUrl,
  buildQuery,
  describeOffer,
  searchEngineProfile,
  normalizeCc,
};
