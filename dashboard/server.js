// Local secrets come from `.env.local` (gitignored). Must run before any module reads process.env.
require('../src/localEnv').loadLocalEnv();

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

const { listSavedProfiles, clearSavedProfiles } = require('../src/fingerprintManager');
const {
  PROXIES_TXT_PATH,
  normalizeProxyLine,
  readProxiesTxt,
  writeProxiesTxt,
  readDatacenterServers,
  checkProxiesBatch,
  selectProxiesForCountries,
  resolveNetworkGeo,
} = require('../src/proxyManager');
const residentialPool = require('../src/residentialPool');
const {
  ensureBuiltinSiteProfiles,
  listSiteProfiles,
  getSiteProfile,
  saveSiteProfile,
  deleteSiteProfile,
  setActiveProfileId,
} = require('../src/siteProfileManager');
const { inspectPageElements } = require('../src/pageMapper');
const {
  startJourneyRecorder,
  stopJourneyRecorder,
  getRecorderState,
  bringRecorderWindowToFront,
  focusRecorderWindow,
  getDesktopSessionInfo,
} = require('../src/journeyRecorder');
const { getEmailClientStatus, createEmailInbox, getEmailCode, listEmailMessages, extractConfirmationUrlFromMessages } = require('../src/emailInboxClient');
const { maskEmail, redactText, redactData, registerStepSecrets, safeStepLabel, isSecretField } = require('../src/redaction');
const { readRunInboxes } = require('../src/runInboxStore');
const {
  REPORTS_DIR,
  savePersistentSessionState,
  loadPersistentSessionState,
  savePersistentInboxes,
  loadPersistentInboxes,
  listSavedReports,
  generateRunPdfReport,
} = require('../src/runReportGenerator');

const activeDashboardInboxes = loadPersistentInboxes();

const app = express();
const PORT = parseInt(process.env.DASHBOARD_PORT || '4310', 10);
const HOST = '127.0.0.1';

const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const RUNNER_PATH = path.join(ROOT_DIR, 'src', 'crawleeRunner.js');
const PROFILES_DIR = path.join(ROOT_DIR, 'session-profiles');
const PUBLIC_DIR = path.join(__dirname, 'public');

const DEFAULT_CONFIG = {
  targetUrl: `http://${HOST}:${PORT}/demo-site`,
  pages: ['/', '/about', '/pricing', '/contact'],
  visitCount: 3,
  minConcurrency: 1,
  concurrency: 3,
  firstPagePriority: 60,
  sessionTimeoutMs: 90000,
  pageMinMs: 4000,
  headless: true,
  engineMode: 'crawlee_autoscaled',
  taskMode: 'behavior',
  referrerMode: 'mixed',
  taskSteps: [],
  keepBrowserOpenMs: 1500,
  interVisitDelayMs: 0,
  snippet: null,
  schedule: {
    enabled: false,
    startHour: '08:00',
    endHour: '22:00',
  },
  devices: process.platform === 'darwin'
    ? {
        desktopChrome: 45,
        iphone14: 20,
        pixel7: 10,
        desktopFirefox: 10,
        desktopSafari: 10,
        ipadPro: 5,
      }
    : {
        desktopChrome: 75,
        desktopFirefox: 25,
        pixel7: 0,
        iphone14: 0,
        desktopSafari: 0,
        ipadPro: 0,
      },
  personas: [
    { name: 'quick_scanner',  scrollDepth: 0.3, clickRate: 0.5, readTime: [500, 1800],  pageCount: [1, 2], idleChance: 0.04, resizeChance: 0.0,  uTurnChance: 0.2  },
    { name: 'engaged_reader', scrollDepth: 0.9, clickRate: 0.7, readTime: [2000, 5000], pageCount: [2, 4], idleChance: 0.15, resizeChance: 0.1,  uTurnChance: 0.05 },
    { name: 'form_filler',    scrollDepth: 0.6, clickRate: 0.9, readTime: [1000, 3000], pageCount: [2, 3], idleChance: 0.10, resizeChance: 0.05, uTurnChance: 0.05 },
    { name: 'window_shopper', scrollDepth: 0.5, clickRate: 0.6, readTime: [800, 2500],  pageCount: [2, 5], idleChance: 0.08, resizeChance: 0.15, uTurnChance: 0.3  },
    { name: 'power_user',     scrollDepth: 1.0, clickRate: 0.9, readTime: [1500, 4000], pageCount: [3, 6], idleChance: 0.12, resizeChance: 0.2,  uTurnChance: 0.1  },
  ],
  proxy: {
    enabled: false,
    tier: 'auto',
    mode: 'round_robin',
    countryFilterEnabled: true,
    fallbackToAnyIfEmpty: true,
    preferredCountries: ['US', 'GB', 'CA', 'AU', 'DE'],
    servers: [],
    fallbackServers: [],
    residential: {
      enabled: false,
      byteBudgetMb: 800,
      country: '',
      overheadFactor: 1.15,
    },
  },
  browserEngine: 'chromium',
  stealthMode: 'maximum',
  resourceMode: 'full',
  waves: {
    enabled: true,
    mode: 'natural_peaks',
    conversionRate: 25,
    childMutationRate: 75,
    scanProductsChance: 65,
    extraPageChance: 40,
    mutateForms: true,
    maxProductsPerVisit: 2,
    formInputs: [],
    referrerMode: 'mixed',
  },
  ai: {
    enabled: false,
    autoManage: false,
    provider: 'auto',
    commanderModel: 'glm-5.3-flash',
    workerModel: 'deepseek-v4.1-flash',
    workerPct: 0,
    allSquadsModel: '',
    recoveryModel: '',
    formAssist: true,
    routeRepair: true,
    commanderDirective: '',
  },
  sessionPersistence: {
    enabled: true,
    returningUserRate: 65,
    profilePoolSize: 20,
  },
  adSafety: {
    avoidAdClicks: false,
    dismissOverlays: true,
    closePopunders: true,
    skipTelemetryHeader: false,
  },
  targets: [],
  attribution: {
    lockerDwellMs: 9500,
    closeSettleMs: 2800,
  },
  emailSweepPasses: 4,
  emailSweepDelayMs: 30000,
};

const { TIER1_DEFAULT_COUNTRIES, COUNTRY_CATALOG, normalizeCountryCode } = require('../src/proxyManager');
const { askFleetCommander, getOllamaStatusPublic } = require('../src/aiCommander');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR));
function resolveRrwebDistFile(fileName) {
  try {
    return path.join(path.dirname(require.resolve('rrweb/package.json')), 'dist', fileName);
  } catch {
    return path.join(__dirname, '..', 'node_modules', 'rrweb', 'dist', fileName);
  }
}
app.get('/vendor/rrweb.min.js', (_req, res) => {
  const f = resolveRrwebDistFile('rrweb.umd.min.cjs');
  return fs.existsSync(f) ? res.sendFile(f) : res.status(404).end();
});
app.get('/vendor/rrweb.min.css', (_req, res) => {
  const f = resolveRrwebDistFile('style.min.css');
  return fs.existsSync(f) ? res.sendFile(f) : res.status(404).end();
});

// ─── Config helpers ───────────────────────────────────────────────────────────

function clamp(num, min, max, fallback) {
  const n = Number(num);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampInt(num, min, max, fallback) {
  return Math.round(clamp(num, min, max, fallback));
}

function normalizePages(pages) {
  if (!Array.isArray(pages)) return ['/'];
  const cleaned = [];
  const seen = new Set();
  for (const raw of pages) {
    if (typeof raw !== 'string') continue;
    let p = raw.trim();
    if (!p) continue;
    if (!p.startsWith('/')) p = '/' + p;
    if (!seen.has(p)) {
      seen.add(p);
      cleaned.push(p);
    }
  }
  return cleaned.length ? cleaned : ['/'];
}

function normalizeHourStr(val, fallback) {
  if (typeof val !== 'string') return fallback;
  const m = val.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function normalizeProxyList(rawList) {
  const out = [];
  for (const item of Array.isArray(rawList) ? rawList : []) {
    const line = typeof item === 'string' ? item.trim() : (typeof item?.server === 'string' ? item.server.trim() : '');
    if (!line || line.startsWith('#')) continue;
    const normalized = normalizeProxyLine(line);
    if (normalized) out.push(normalized);
  }
  return out;
}

function normalizeTargets(rawTargets, fallbackPages) {
  if (!Array.isArray(rawTargets)) return [];
  const out = [];
  for (const t of rawTargets.slice(0, 50)) {
    if (!t || typeof t !== 'object') continue;
    const rawUrl = typeof t.url === 'string' ? t.url.trim() : '';
    if (!rawUrl) continue;
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
    } catch {
      continue;
    }
    const cleanUrl = rawUrl.replace(/\/+$/, '');
    const tPages = Array.isArray(t.pages) && t.pages.length ? normalizePages(t.pages) : [...fallbackPages];
    const vc = t.visitCount != null ? clampInt(t.visitCount, 0, 100000, 0) : 0;
    out.push({
      url: cleanUrl,
      pages: tPages,
      ...(vc > 0 ? { visitCount: vc } : {}),
    });
  }
  return out;
}

function validateAndNormalizeConfig(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('גוף הבקשה חייב להיות אובייקט JSON תקין.');
  }

  let targetUrl = typeof input.targetUrl === 'string' ? input.targetUrl.trim() : '';
  if (!targetUrl) throw new Error('חובה להזין כתובת יעד (targetUrl).');
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    throw new Error('כתובת היעד (targetUrl) אינה כתובת URL תקינה.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('כתובת היעד חייבת להתחיל ב-http:// או https://.');
  }
  targetUrl = targetUrl.replace(/\/+$/, '');

  const deviceKeys = ['desktopChrome', 'iphone14', 'pixel7', 'desktopFirefox', 'desktopSafari', 'ipadPro'];
  const devices = {};
  let totalDeviceWeight = 0;
  for (const key of deviceKeys) {
    const w = clamp(input.devices?.[key], 0, 10000, DEFAULT_CONFIG.devices[key]);
    devices[key] = w;
    totalDeviceWeight += w;
  }
  if (totalDeviceWeight <= 0) {
    throw new Error('לפחות פרופיל מכשיר אחד חייב להיות בעל משקל גדול מ-0.');
  }

  const rawPersonas = Array.isArray(input.personas) && input.personas.length
    ? input.personas
    : DEFAULT_CONFIG.personas;

  const personas = rawPersonas.map((p, idx) => {
    const readMin = clampInt(p?.readTime?.[0], 0, 120000, 1000);
    const readMax = clampInt(p?.readTime?.[1], readMin, 120000, Math.max(readMin, 3000));
    const pageMin = clampInt(p?.pageCount?.[0], 1, 50, 1);
    const pageMax = clampInt(p?.pageCount?.[1], pageMin, 50, Math.max(pageMin, 3));
    return {
      name: (typeof p?.name === 'string' && p.name.trim()) ? p.name.trim() : `persona_${idx + 1}`,
      scrollDepth: Number(clamp(p?.scrollDepth, 0, 1, 0.5).toFixed(2)),
      clickRate: Number(clamp(p?.clickRate, 0, 1, 0.5).toFixed(2)),
      readTime: [readMin, readMax],
      pageCount: [pageMin, pageMax],
      idleChance: Number(clamp(p?.idleChance, 0, 1, 0.08).toFixed(2)),
      resizeChance: Number(clamp(p?.resizeChance, 0, 1, 0.1).toFixed(2)),
      uTurnChance: Number(clamp(p?.uTurnChance, 0, 1, 0.1).toFixed(2)),
    };
  });

  const proxyServers = normalizeProxyList(input.proxy?.servers);
  const fallbackServers = normalizeProxyList(input.proxy?.fallbackServers);

  const engineMode = ['crawlee_autoscaled', 'crawlee_playwright', 'http_fast'].includes(input.engineMode)
    ? input.engineMode
    : 'crawlee_autoscaled';
  const maxAllowedConcurrency = engineMode === 'http_fast' ? 128 : 32;
  const concurrency = clampInt(input.concurrency, 1, maxAllowedConcurrency, 3);
  const minConcurrency = clampInt(input.minConcurrency, 1, concurrency, 1);
  const snippet = (typeof input.snippet === 'string' && input.snippet.trim()) ? input.snippet.trim() : null;
  const validStepTypes = new Set(['goto', 'click', 'go_back', 'close_tab', 'fill', 'fill_email', 'fill_otp', 'select', 'press', 'hover', 'scroll', 'scroll_to', 'read_article', 'human_browse', 'scan_products', 'ai_explore', 'ai_route_repair', 'ai_form_guard', 'search_entry', 'wait', 'dismiss_overlays', 'audit_ads', 'assert', 'screenshot']);
  const taskSteps = Array.isArray(input.taskSteps)
    ? input.taskSteps
        .filter(s => s && typeof s === 'object' && validStepTypes.has(s.type))
        .slice(0, 100)
        .map(s => ({
          type: s.type,
          selector: typeof s.selector === 'string' ? s.selector.trim() : '',
          value: s.value != null ? String(s.value) : '',
          assertKind: typeof s.assertKind === 'string' ? s.assertKind.trim() : 'text_contains',
          label: typeof s.label === 'string'
            ? (s.secret === true || isSecretField(s.selector, s.label) ? safeStepLabel(s) : redactText(s.label.trim()))
            : '',
          ...(s.secret === true ? { secret: true } : {}),
          ...(s.lockValue === true ? { lockValue: true } : {}),
          ...(Number.isInteger(s.tab) && s.tab >= 0 ? { tab: s.tab } : {}),
          ...(Number.isInteger(s.opensTab) && s.opensTab > 0 ? { opensTab: s.opensTab } : {}),
          ...(typeof s.popupFallbackUrl === 'string' && /^https?:\/\//i.test(s.popupFallbackUrl.trim())
            ? { popupFallbackUrl: s.popupFallbackUrl.trim().slice(0, 1000) }
            : {}),
          ...(s.optional ? { optional: true } : {}),
          ...(typeof s.referer === 'string' && s.referer.trim() ? { referer: s.referer.trim() } : {}),
          ...(s.followExternal ? { followExternal: true } : {}),
          ...(typeof s.workerModel === 'string' && s.workerModel.trim() ? { workerModel: s.workerModel.trim().slice(0, 80) } : {}),
          ...(typeof s.query === 'string' && s.query.trim() ? { query: s.query.trim().slice(0, 200) } : {}),
          ...(Number(s.staySamePageChance) > 0
            ? { staySamePageChance: Math.min(1, Math.max(0, Number(s.staySamePageChance))) }
            : {}),
        }))
    : [];

  const pages = normalizePages(input.pages);
  return {
    targetUrl,
    pages,
    targets: normalizeTargets(input.targets, pages),
    visitCount: clampInt(input.visitCount, 1, 100000, 3),
    minConcurrency,
    concurrency,
    firstPagePriority: clampInt(input.firstPagePriority, 0, 100, 60),
    sessionTimeoutMs: clampInt(input.sessionTimeoutMs, 5000, 600000, 90000),
    pageMinMs: clampInt(input.pageMinMs, 0, 120000, 4000),
    headless: input.headless !== false,
    engineMode,
    browserEngine: ['chromium', 'patchright', 'camoufox'].includes(input.browserEngine) ? input.browserEngine : 'chromium',
    taskMode: ['behavior', 'scenario', 'hybrid'].includes(input.taskMode) ? input.taskMode : 'behavior',
    referrerMode: ['mixed', 'google_organic', 'search_engines', 'social', 'direct'].includes(input.referrerMode)
      ? input.referrerMode
      : 'mixed',
    taskSteps,
    keepBrowserOpenMs: clampInt(input.keepBrowserOpenMs, 0, 30000, 1500),
    interVisitDelayMs: clampInt(input.interVisitDelayMs, 0, 120000, 0),
    snippet,
    schedule: {
      enabled: Boolean(input.schedule?.enabled),
      startHour: normalizeHourStr(input.schedule?.startHour, '08:00'),
      endHour: normalizeHourStr(input.schedule?.endHour, '22:00'),
    },
    devices,
    personas,
    proxy: {
      enabled: Boolean(input.proxy?.enabled),
      tier: ['auto', 'datacenter', 'residential'].includes(String(input.proxy?.tier || '').toLowerCase())
        ? String(input.proxy.tier).toLowerCase()
        : 'auto',
      mode: input.proxy?.mode === 'random' ? 'random' : 'round_robin',
      countryFilterEnabled: input.proxy?.countryFilterEnabled !== false,
      fallbackToAnyIfEmpty: input.proxy?.fallbackToAnyIfEmpty !== false,
      preferredCountries: (() => {
        const arr = Array.isArray(input.proxy?.preferredCountries)
          ? [...new Set(input.proxy.preferredCountries.map(normalizeCountryCode).filter(Boolean))]
          : null;
        if (arr === null) return [...TIER1_DEFAULT_COUNTRIES];
        return arr;
      })(),
      servers: proxyServers,
      fallbackServers,
      residential: {
        enabled: input.proxy?.residential?.enabled !== false,
        byteBudgetMb: clampInt(input.proxy?.residential?.byteBudgetMb, 50, 5000, 800),
        country: String(input.proxy?.residential?.country || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 2),
        overheadFactor: Math.min(3, Math.max(1, Number(input.proxy?.residential?.overheadFactor) || 1.15)),
      },
    },
    stealthMode: input.stealthMode === 'standard' ? 'standard' : 'maximum',
    resourceMode: ['full', 'lite', 'ultra_lite', 'browserless_cdp', 'lightpanda_cdp'].includes(input.resourceMode) ? input.resourceMode : 'ultra_lite',
    waves: {
      enabled: input.waves?.enabled !== false,
      mode: ['off', 'steady', 'ramp_up', 'natural_peaks', 'burst'].includes(input.waves?.mode)
        ? input.waves.mode
        : 'natural_peaks',
      conversionRate: clampInt(input.waves?.conversionRate, 0, 100, 25),
      childMutationRate: clampInt(input.waves?.childMutationRate, 0, 100, 75),
      scanProductsChance: clampInt(input.waves?.scanProductsChance, 0, 100, 65),
      extraPageChance: clampInt(input.waves?.extraPageChance, 0, 100, 40),
      mutateForms: input.waves?.mutateForms !== false,
      maxProductsPerVisit: clampInt(input.waves?.maxProductsPerVisit, 1, 4, 2),
      formInputs: Array.isArray(input.waves?.formInputs)
        ? input.waves.formInputs.map(s => String(s || '').trim()).filter(Boolean).slice(0, 50)
        : [],
      // Where the traffic pretends to come from: mixed (search+social+small direct tail),
      // search_engines (no direct at all), social, google_organic or direct.
      referrerMode: ['mixed', 'google_organic', 'search_engines', 'social', 'direct'].includes(input.waves?.referrerMode)
        ? input.waves.referrerMode
        : (['mixed', 'google_organic', 'search_engines', 'social', 'direct'].includes(input.referrerMode)
          ? input.referrerMode
          : 'mixed'),
    },
    ai: {
      enabled: Boolean(input.ai?.enabled),
      autoManage: Boolean(input.ai?.autoManage),
      provider: ['auto', 'ollama_cloud', 'uncensoredllm'].includes(input.ai?.provider)
        ? input.ai.provider
        : 'auto',
      commanderModel: (typeof input.ai?.commanderModel === 'string' && input.ai.commanderModel.trim())
        ? input.ai.commanderModel.trim().slice(0, 80)
        : 'glm-5.3-flash',
      workerModel: (() => {
        const rawWm = (typeof input.ai?.workerModel === 'string' && input.ai.workerModel.trim())
          ? input.ai.workerModel.trim().slice(0, 80)
          : 'deepseek-v4.1-flash';
        return rawWm.toLowerCase() === 'inkling-2-small' ? 'deepseek-v4.1-flash' : rawWm;
      })(),
      workerPct: clampInt(input.ai?.workerPct, 0, 100, 0),
      allSquadsModel: typeof input.ai?.allSquadsModel === 'string'
        ? input.ai.allSquadsModel.trim().slice(0, 80)
        // Preserve any operator setting from disk when omitted by older UI callers.
        : String(readConfigFromDisk().ai?.allSquadsModel || '').slice(0, 80),
      recoveryModel: typeof input.ai?.recoveryModel === 'string'
        ? input.ai.recoveryModel.trim().slice(0, 80)
        : String(readConfigFromDisk().ai?.recoveryModel || '').slice(0, 80),
      formAssist: input.ai?.formAssist !== false,
      routeRepair: input.ai?.routeRepair !== false,
      commanderDirective: typeof input.ai?.commanderDirective === 'string'
        ? input.ai.commanderDirective.trim().slice(0, 300)
        : '',
    },
    sessionPersistence: {
      enabled: input.sessionPersistence?.enabled !== false,
      returningUserRate: clampInt(input.sessionPersistence?.returningUserRate, 0, 100, 65),
      profilePoolSize: clampInt(input.sessionPersistence?.profilePoolSize, 1, 200, 20),
    },
    adSafety: {
      avoidAdClicks: input.adSafety?.avoidAdClicks !== false,
      dismissOverlays: input.adSafety?.dismissOverlays !== false,
      closePopunders: input.adSafety?.closePopunders !== false,
      skipTelemetryHeader: Boolean(input.adSafety?.skipTelemetryHeader),
    },
    attribution: {
      lockerDwellMs: clampInt(input.attribution?.lockerDwellMs, 0, 120000, 9500),
      closeSettleMs: clampInt(input.attribution?.closeSettleMs, 0, 60000, 2800),
    },
    emailSweepPasses: clampInt(input.emailSweepPasses, 0, 20, 4),
    emailSweepDelayMs: clampInt(input.emailSweepDelayMs, 1000, 180000, 30000),
  };
}

function readConfigFromDisk() {
  const fileProxies = readProxiesTxt();
  if (!fs.existsSync(CONFIG_PATH)) {
    const fresh = structuredClone(DEFAULT_CONFIG);
    if (fileProxies.length) fresh.proxy.servers = fileProxies;
    return fresh;
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const mergedProxies = Array.isArray(raw.proxy?.servers) && raw.proxy.servers.length
    ? raw.proxy.servers
    : fileProxies;
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    schedule: { ...DEFAULT_CONFIG.schedule, ...(raw.schedule || {}) },
    devices: { ...DEFAULT_CONFIG.devices, ...(raw.devices || {}) },
    personas: Array.isArray(raw.personas) && raw.personas.length ? raw.personas : DEFAULT_CONFIG.personas,
    proxy: {
      ...DEFAULT_CONFIG.proxy,
      ...(raw.proxy || {}),
      servers: mergedProxies,
      fallbackServers: Array.isArray(raw.proxy?.fallbackServers) ? raw.proxy.fallbackServers : DEFAULT_CONFIG.proxy.fallbackServers,
      residential: { ...DEFAULT_CONFIG.proxy.residential, ...(raw.proxy?.residential || {}) },
    },
    waves: { ...DEFAULT_CONFIG.waves, ...(raw.waves || {}) },
    ai: { ...DEFAULT_CONFIG.ai, ...(raw.ai || {}) },
    sessionPersistence: { ...DEFAULT_CONFIG.sessionPersistence, ...(raw.sessionPersistence || {}) },
    adSafety: { ...DEFAULT_CONFIG.adSafety, ...(raw.adSafety || {}) },
    targets: Array.isArray(raw.targets) ? raw.targets : DEFAULT_CONFIG.targets,
    attribution: { ...DEFAULT_CONFIG.attribution, ...(raw.attribution || {}) },
    emailSweepPasses: raw.emailSweepPasses ?? DEFAULT_CONFIG.emailSweepPasses,
    emailSweepDelayMs: raw.emailSweepDelayMs ?? DEFAULT_CONFIG.emailSweepDelayMs,
  };
}

function writeConfigToDisk(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  writeProxiesTxt(cfg.proxy?.servers || []);
}

// ─── Hardware & profile stats ─────────────────────────────────────────────────

function getSystemInfo() {
  const cpus = os.cpus();
  const cpuCount = cpus.length || 4;
  const cpuModel = cpus[0]?.model || 'CPU';
  const totalRamBytes = os.totalmem();
  const freeRamBytes = os.freemem();
  const totalRamGb = Number((totalRamBytes / 1024 ** 3).toFixed(2));
  const freeRamGb = Number((freeRamBytes / 1024 ** 3).toFixed(2));
  const memUsedPct = Math.round(((totalRamBytes - freeRamBytes) / totalRamBytes) * 100);

  const byRam = Math.max(1, Math.floor(totalRamGb / 2.5));
  const byCpu = Math.max(1, Math.floor(cpuCount / 2));
  const recommended = Math.max(1, Math.min(6, byRam, byCpu));
  const minSafe = Math.max(1, Math.min(3, recommended));
  const maxStress = Math.max(recommended, Math.min(12, Math.floor(totalRamGb / 1.5)));

  return {
    platform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    nodeVersion: process.version,
    cpuModel,
    cpuCount,
    totalRamGb,
    freeRamGb,
    memUsedPct,
    concurrencyAdvice: {
      recommended: Math.min(5, recommended),
      sweetSpot: [minSafe, recommended],
      maxStress,
    },
    savedProfilesCount: listSavedProfiles(PROFILES_DIR).length,
  };
}

// ─── Runner & SSE streaming ───────────────────────────────────────────────────

const MAX_LOGS = 1500;
const sseClients = new Set();

const persistedSession = loadPersistentSessionState();

const persistedRunState = persistedSession?.runState || null;
const persistedPlanned = Number(persistedRunState?.totalPlanned || 0);
const persistedCompleted = Number(persistedRunState?.completed || 0);
const wasInterruptedOnBoot = ['running', 'paused'].includes(persistedRunState?.status)
  && !persistedRunState?.finishedAt
  && persistedPlanned > 0
  && persistedCompleted < persistedPlanned;

let runState = {
  status: 'idle', // idle | running | paused | waiting_schedule | stopping | completed | stopped | error
  pid: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  totalPlanned: 0,
  completed: 0,
  succeeded: 0,
  timedOut: 0,
  failed: 0,
  errorsTotal: 0,
  returningSessions: 0,
  newSessions: 0,
  avgLoadMs: null,
  currentConcurrency: 0,
  desiredConcurrency: 0,
  minConcurrency: 1,
  maxConcurrency: 3,
  memUsedPct: 0,
  freeRamGb: 0,
  isSystemOverloaded: false,
  targetUrl: null,
  engineMode: 'crawlee_autoscaled',
  headless: true,
  ...(persistedRunState ? {
    ...persistedRunState,
    status: wasInterruptedOnBoot
      ? 'running'
      : (['running', 'paused', 'stopping'].includes(persistedRunState.status)
          ? 'completed'
          : (persistedRunState.status || 'idle')),
    pid: null,
    currentConcurrency: 0,
  } : {}),
};

let activeProcess = null;
let logHistory = Array.isArray(persistedSession?.logHistory) ? persistedSession.logHistory : [];
let logSeq = logHistory.reduce((m, x) => Math.max(m, Number(x?.id) || 0), 0);
let currentRunStartLogSeq = logSeq;
let latestFrame = null;
const runInboxSummary = new Map();
let visitDetails = Array.isArray(persistedSession?.visitDetails) ? persistedSession.visitDetails : [];
let saveStateTimer = null;

function scheduleSaveSessionState() {
  if (saveStateTimer) return;
  saveStateTimer = setTimeout(() => {
    saveStateTimer = null;
    savePersistentSessionState({
      runState,
      logHistory,
      visitDetails,
      aiHistory: typeof aiCommanderState !== 'undefined' ? aiCommanderState.history : [],
    });
  }, 1200);
}

function resetRunStats(cfg) {
  runInboxSummary.clear();
  latestFrame = null;
  visitDetails = [];
  currentRunStartLogSeq = logSeq;
  runState = {
    status: 'running',
    pid: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    totalPlanned: cfg.visitCount,
    completed: 0,
    succeeded: 0,
    timedOut: 0,
    failed: 0,
    errorsTotal: 0,
    skippedStepsTotal: 0,
    failFastTriggers: 0,
    slowVisitsCount: 0,
    lastErrorSample: '',
    lastSkippedSelector: '',
    proxyTransferMb: 0,
    proxySavedMb: 0,
    proxyCacheHits: 0,
    aiApiCalls: 0,
    aiCacheHits: 0,
    aiSavedTokens: 0,
    returningSessions: 0,
    newSessions: 0,
    avgLoadMs: null,
    currentConcurrency: 0,
    desiredConcurrency: cfg.minConcurrency || 1,
    minConcurrency: cfg.minConcurrency || 1,
    maxConcurrency: cfg.concurrency,
    memUsedPct: getSystemInfo().memUsedPct,
    freeRamGb: getSystemInfo().freeRamGb,
    isSystemOverloaded: false,
    targetUrl: cfg.targetUrl,
    engineMode: cfg.engineMode,
    headless: cfg.headless,
  };
  scheduleSaveSessionState();
}

function broadcastEvent(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

function appendLog(level, message) {
  const entry = {
    id: ++logSeq,
    ts: new Date().toISOString(),
    level,
    message: redactText(message),
  };
  logHistory.push(entry);
  if (logHistory.length > MAX_LOGS) logHistory.shift();
  broadcastEvent('log', entry);
  broadcastEvent('status', runState);
  scheduleSaveSessionState();
}

function terminateProcessTree(proc) {
  if (!proc || !proc.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], () => {});
  } else {
    proc.kill('SIGTERM');
  }
}

// Broadcast live system RAM pulse every 2.5s
setInterval(() => {
  if (sseClients.size > 0) {
    broadcastEvent('system_pulse', getSystemInfo());
  }
}, 2500);

// ─── Built-in synthetic demo target & analytics collector ─────────────────────

const MAX_DEMO_EVENTS = 250;
let demoEvents = [];
let demoSeq = 0;

function recordDemoEvent(evt) {
  const entry = {
    id: ++demoSeq,
    ts: new Date().toISOString(),
    ...evt,
  };
  demoEvents.unshift(entry);
  if (demoEvents.length > MAX_DEMO_EVENTS) demoEvents.pop();
  broadcastEvent('demo_event', entry);
  return entry;
}

function renderDemoPage(pageKey, title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — QA Sandbox</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; line-height: 1.6; }
    header { background: #1e293b; border-bottom: 1px solid #334155; padding: 16px 24px; display: flex; gap: 20px; align-items: center; justify-content: space-between; }
    nav a { color: #38bdf8; text-decoration: none; margin-right: 16px; font-weight: 600; }
    nav a:hover { text-decoration: underline; }
    main { max-width: 900px; margin: 32px auto; padding: 0 24px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
    button, .btn { background: #2563eb; color: #fff; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-weight: 600; display: inline-block; text-decoration: none; margin-right: 8px; }
    button:hover, .btn:hover { background: #1d4ed8; }
    input, select, textarea { width: 100%; box-sizing: border-box; padding: 10px; margin: 8px 0 16px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #f8fafc; }
    .tall-section { min-height: 450px; }
  </style>
</head>
<body>
  <header>
    <strong>QA Sandbox Target (${pageKey})</strong>
    <nav>
      <a href="/demo-site/">Home</a>
      <a href="/demo-site/about">About</a>
      <a href="/demo-site/pricing">Pricing</a>
      <a href="/demo-site/contact">Contact</a>
    </nav>
  </header>
  <main>
    ${bodyHtml}
    <section class="card tall-section">
      <h2>Scroll &amp; Engagement Zone</h2>
      <p>Synthetic User Monitoring verifies behavior simulation, fingerprint injection, persistent cookies, and live analytics beacons.</p>
      <button type="button" class="btn-track" data-action="cta_explore">Explore Metrics</button>
      <button type="button" class="btn-track" data-action="cta_docs">Read Docs</button>
    </section>
  </main>
  <script>
    (function () {
      function getOrSetVisitorId() {
        var m = document.cookie.match(/(?:^|; )qa_vid=([^;]+)/);
        if (m) return { id: decodeURIComponent(m[1]), returning: true };
        var id = 'vid_' + Math.random().toString(36).slice(2, 10);
        document.cookie = 'qa_vid=' + encodeURIComponent(id) + '; path=/; max-age=86400; SameSite=Lax';
        localStorage.setItem('qa_last_visit', new Date().toISOString());
        return { id: id, returning: false };
      }

      var visitor = getOrSetVisitorId();
      var params = new URLSearchParams(location.search);

      function sendBeaconEvent(eventType, extra) {
        var payload = JSON.stringify({
          eventType: eventType,
          page: location.pathname + location.search,
          referrer: document.referrer || '(direct)',
          visitorId: visitor.id,
          returning: visitor.returning,
          utmSource: params.get('utm_source'),
          utmMedium: params.get('utm_medium'),
          utmCampaign: params.get('utm_campaign'),
          viewport: window.innerWidth + 'x' + window.innerHeight,
          userAgent: navigator.userAgent,
          extra: extra || null
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/demo-site/collect', new Blob([payload], { type: 'application/json' }));
        } else {
          fetch('/demo-site/collect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }).catch(function () {});
        }
      }

      sendBeaconEvent('pageview');

      document.addEventListener('click', function (e) {
        var btn = e.target.closest('button, a.btn');
        if (btn) sendBeaconEvent('click', { text: (btn.innerText || '').trim().slice(0, 40) });
      });

      var form = document.getElementById('qa-contact-form');
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          sendBeaconEvent('form_submit', { status: 'ok' });
          var msg = document.getElementById('form-status');
          if (msg) msg.textContent = 'Form received by QA Sandbox!';
        });
      }
    })();
  </script>
</body>
</html>`;
}

app.get(['/demo-site', '/demo-site/'], (_req, res) => {
  res.type('html').send(renderDemoPage('Home', 'Home', `
    <section class="card">
      <h1>Welcome to the Local QA &amp; Analytics Sandbox</h1>
      <p>Safe built-in test target for verifying Crawlee AutoscaledPool, Fingerprint Suite, Persistent Contexts, and Analytics.</p>
      <a class="btn" href="/demo-site/pricing">View Pricing</a>
      <a class="btn" href="/demo-site/contact">Open Contact Form</a>
      <button type="button" id="hero-cta">Test Action Button</button>
    </section>
  `));
});

app.get('/demo-site/about', (_req, res) => {
  res.type('html').send(renderDemoPage('About', 'About', `
    <section class="card">
      <h1>About Our Test Application</h1>
      <p>Simulates reading, scrolling, text selection, U-turns, and viewport resizing.</p>
      <button type="button">Load Team Details</button>
      <a class="btn" href="/demo-site/contact">Contact Team</a>
    </section>
  `));
});

app.get('/demo-site/pricing', (_req, res) => {
  res.type('html').send(renderDemoPage('Pricing', 'Pricing', `
    <section class="card">
      <h1>Pricing Plans (Demo)</h1>
      <p>Starter: Free | Growth: \$49/mo | Enterprise: Custom</p>
      <button type="button">Toggle Billing Cycle</button>
      <a class="btn" href="/demo-site/contact">Start Trial</a>
    </section>
  `));
});

app.get('/demo-site/contact', (_req, res) => {
  res.type('html').send(renderDemoPage('Contact', 'Contact', `
    <section class="card">
      <h1>Test Contact Form</h1>
      <form id="qa-contact-form">
        <label>Full Name <input type="text" name="name" placeholder="Your name" /></label>
        <label>Email <input type="email" name="email" placeholder="you@company.com" /></label>
        <label>Company <input type="text" name="company" placeholder="Company name" /></label>
        <label>Topic
          <select name="topic">
            <option value="">Select...</option>
            <option value="demo">Product Demo</option>
            <option value="pricing">Pricing Question</option>
            <option value="support">Technical Support</option>
          </select>
        </label>
        <label>Message <textarea name="message" rows="3" placeholder="Tell us more..."></textarea></label>
        <label><input type="checkbox" name="agree" style="width:auto" /> Accept demo terms</label><br/>
        <button type="submit">Submit Test Form</button>
        <p id="form-status" style="color:#4ade80;font-weight:600;"></p>
      </form>
    </section>
  `));
});

app.get('/demo-site/fingerprint-check', (req, res) => {
  const serverInfo = {
    httpReferer: req.get('referer') || '',
    httpAcceptLanguage: req.get('accept-language') || '',
    httpUserAgent: req.get('user-agent') || '',
    hasLabHeader: Boolean(req.get('x-lab-skip-telemetry')),
    remoteIp: req.ip || req.socket?.remoteAddress || '',
  };
  const safeServerJson = JSON.stringify(serverInfo).replace(/</g, '\\u003c');
  res.type('html').send(renderDemoPage('Fingerprint Check', 'Fingerprint & Consistency Check', `
    <section class="card">
      <h1>Browser Consistency & Bot-Signal Check</h1>
      <p>Local diagnostic endpoint verifying HTTP vs DOM Referer, OS/WebGL alignment, Timezone/Locale, automation flags, cookies persistence, and live interaction events.</p>
      <div id="fp-status" style="font-size:1.1rem;font-weight:700;margin:10px 0;">Evaluating...</div>
      <div id="fp-flags" style="margin-bottom:10px;color:#fbbf24;"></div>
      <pre id="fp-report-json" style="background:#0f172a;padding:12px;border-radius:8px;overflow:auto;font-size:12px;color:#e2e8f0;"></pre>
      <button type="button" id="fp-interact-btn">Verify Pointer & Scroll Activity</button>
    </section>
    <script>
      (function () {
        const srv = ${safeServerJson};
        const flags = [];
        let webglVendor = null;
        let webglRenderer = null;
        try {
          const canvas = document.createElement('canvas');
          const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
          if (gl) {
            const dbg = gl.getExtension('WEBGL_debug_renderer_info');
            webglVendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
            webglRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
          }
        } catch {}

        const ua = navigator.userAgent || '';
        const platform = navigator.platform || '';
        const webdriver = navigator.webdriver;
        const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();
        const domRef = document.referrer || '';

        if (webdriver === true) flags.push('webdriver_exposed');
        if (domRef && !srv.httpReferer) flags.push('dom_referer_without_http_referer');
        if (/iPhone|iPad|Macintosh|Mac OS X/i.test(ua) && /Direct3D|DirectX|ANGLE.*(NVIDIA|AMD|Intel).*Direct3D|Win32/i.test(String(webglRenderer) + ' ' + platform)) {
          flags.push('os_webgl_mismatch');
        }
        if (/Win32|Windows/i.test(ua + ' ' + platform) && (/Apple GPU|Metal/i.test(String(webglRenderer)) || /OpenGL Engine/i.test(String(webglRenderer)))) {
          flags.push('os_webgl_mismatch');
        }
        if (srv.httpUserAgent && ua && ua !== srv.httpUserAgent) {
          flags.push('ua_http_js_mismatch');
        }
        if (/HeadlessChrome/i.test(ua + ' ' + srv.httpUserAgent)) {
          flags.push('headless_ua_exposed');
        }
        if (/SwiftShader|llvmpipe/i.test(String(webglRenderer))) {
          flags.push('software_webgl_swiftshader');
        }
        if (Object.getOwnPropertyDescriptor(document, 'hidden')) {
          flags.push('artificial_document_hidden_override');
        }
        const navLangBase = String(navigator.language || '').split('-')[0].toLowerCase();
        const httpLangBase = String(srv.httpAcceptLanguage || '').split(/[,;-]/)[0].trim().toLowerCase();
        if (navLangBase && httpLangBase && navLangBase !== httpLangBase) {
          flags.push('accept_language_mismatch');
        }

        let prevVisits = 0;
        try {
          prevVisits = parseInt(localStorage.getItem('wtg_fp_visits') || '0', 10) || 0;
          localStorage.setItem('wtg_fp_visits', String(prevVisits + 1));
        } catch {}
        const hasCookieBefore = document.cookie.includes('wtg_fp_seen=');
        document.cookie = 'wtg_fp_seen=1; path=/; max-age=2592000; SameSite=Lax';

        let mouseMoves = 0;
        let scrolls = 0;
        let pointerDowns = 0;
        window.addEventListener('mousemove', () => { mouseMoves++; render(); }, { passive: true });
        window.addEventListener('scroll', () => { scrolls++; render(); }, { passive: true });
        window.addEventListener('pointerdown', () => { pointerDowns++; render(); }, { passive: true });

        function render() {
          const score = Math.max(0, 100 - flags.length * 25);
          const verdict = flags.length === 0 ? 'CLEAN_CONSISTENT' : 'WARN_FLAGS_DETECTED';
          const statusEl = document.getElementById('fp-status');
          const flagsEl = document.getElementById('fp-flags');
          const preEl = document.getElementById('fp-report-json');
          if (statusEl) {
            statusEl.textContent = verdict + ' | Score: ' + score + '/100 | ReturningVisits: ' + prevVisits;
            statusEl.style.color = flags.length === 0 ? '#4ade80' : '#f87171';
          }
          if (flagsEl) {
            flagsEl.textContent = flags.length ? 'Flags: ' + flags.join(', ') : 'Flags: none (0 mismatches)';
          }
          if (preEl) {
            preEl.textContent = JSON.stringify({
              verdict,
              trustScore: score,
              flags,
              webdriver,
              ua,
              httpUserAgent: srv.httpUserAgent,
              platform,
              language: navigator.language,
              languages: navigator.languages,
              httpAcceptLanguage: srv.httpAcceptLanguage,
              timeZone: tz,
              webglVendor,
              webglRenderer,
              httpReferer: srv.httpReferer,
              documentReferrer: domRef,
              returningLocalVisitsBeforeThis: prevVisits,
              cookieSeen: hasCookieBefore,
              interactions: { mouseMoves, scrolls, pointerDowns },
            }, null, 2);
          }
        }
        render();
      })();
    </script>
  `));
});

app.post('/demo-site/collect', express.text({ type: '*/*', limit: '100kb' }), (req, res) => {
  let parsed = req.body;
  if (typeof req.body === 'string') {
    try { parsed = JSON.parse(req.body); } catch { parsed = { raw: req.body }; }
  }
  recordDemoEvent(parsed && typeof parsed === 'object' ? parsed : { raw: parsed });
  res.status(204).end();
});

app.get('/api/demo-events', (_req, res) => res.json({ events: demoEvents }));
app.delete('/api/demo-events', (_req, res) => { demoEvents = []; res.json({ ok: true }); });

// ─── API Routes ───────────────────────────────────────────────────────────────

app.get('/api/system', (_req, res) => {
  res.json(getSystemInfo());
});

app.get('/api/config', (_req, res) => {
  try {
    const config = readConfigFromDisk();
    res.json({ config, defaultConfig: DEFAULT_CONFIG, configPath: CONFIG_PATH, proxiesTxtPath: PROXIES_TXT_PATH });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/config', (req, res) => {
  try {
    const normalized = validateAndNormalizeConfig(req.body);
    writeConfigToDisk(normalized);
    res.json({ ok: true, config: normalized });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/config/reset', (_req, res) => {
  try {
    const fresh = structuredClone(DEFAULT_CONFIG);
    writeConfigToDisk(fresh);
    res.json({ ok: true, config: fresh });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/proxies/test', async (req, res) => {
  try {
    const rawList = Array.isArray(req.body?.servers) ? req.body.servers : readProxiesTxt();
    const cleaned = rawList.map(s => String(s || '').trim()).filter(s => s && !s.startsWith('#'));
    if (!cleaned.length) {
      return res.json({ results: [], message: 'לא הוזנו שרתי Proxy לבדיקה.' });
    }
    const results = await checkProxiesBatch(cleaned.slice(0, 50), 5);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/profiles', (_req, res) => {
  res.json({ profiles: listSavedProfiles(PROFILES_DIR), storageDir: PROFILES_DIR });
});

app.delete('/api/profiles', (_req, res) => {
  try {
    clearSavedProfiles(PROFILES_DIR);
    res.json({ ok: true, profiles: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Saved Site Profiles API ──────────────────────────────────────────────────

app.get('/api/site-profiles', (_req, res) => {
  try {
    res.json(listSiteProfiles(validateAndNormalizeConfig, PORT));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/site-profiles', (req, res) => {
  try {
    const profile = saveSiteProfile(req.body || {}, validateAndNormalizeConfig, PORT);
    const list = listSiteProfiles(validateAndNormalizeConfig, PORT);
    res.json({ ok: true, profile, ...list });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/site-profiles/:id', (req, res) => {
  try {
    const profile = saveSiteProfile({ ...(req.body || {}), id: req.params.id }, validateAndNormalizeConfig, PORT);
    const list = listSiteProfiles(validateAndNormalizeConfig, PORT);
    res.json({ ok: true, profile, ...list });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/site-profiles/:id/load', (req, res) => {
  try {
    const profile = getSiteProfile(req.params.id, validateAndNormalizeConfig, PORT);
    if (!profile) return res.status(404).json({ error: 'פרופיל האתר לא נמצא.' });
    const currentCfg = readConfigFromDisk();
    const includeInfra = Boolean(req.body?.includeInfra);

    const isDeadWebshare = servers =>
      Array.isArray(servers) && servers.some(s => /45\.38\.107\.97|64\.137\.96\.74|plgotzsz/i.test(String(s || '')));

    const curServers = Array.isArray(currentCfg.proxy?.servers) ? currentCfg.proxy.servers : [];
    const profServers = Array.isArray(profile.config?.proxy?.servers) ? profile.config.proxy.servers : [];
    const keepCurrentProxy =
      !includeInfra
      && curServers.length > 0
      && (!isDeadWebshare(curServers) || profServers.length === 0 || isDeadWebshare(profServers));

    const mergedProxy = keepCurrentProxy
      ? currentCfg.proxy
      : (profServers.length > 0 && !isDeadWebshare(profServers) ? profile.config.proxy : currentCfg.proxy);

    const mergedAi = (!includeInfra && currentCfg.ai?.enabled)
      ? {
          ...(profile.config?.ai || {}),
          enabled: currentCfg.ai.enabled,
          autoManage: currentCfg.ai.autoManage,
          provider: currentCfg.ai.provider || profile.config?.ai?.provider || 'auto',
          commanderModel: currentCfg.ai.commanderModel || profile.config?.ai?.commanderModel || 'glm-5.3-flash',
          workerModel: currentCfg.ai.workerModel || profile.config?.ai?.workerModel || 'deepseek-v4.1-flash',
          allSquadsModel: currentCfg.ai.allSquadsModel ?? profile.config?.ai?.allSquadsModel ?? '',
          recoveryModel: currentCfg.ai.recoveryModel ?? profile.config?.ai?.recoveryModel ?? '',
          workerPct: Number.isFinite(Number(currentCfg.ai.workerPct)) ? currentCfg.ai.workerPct : (profile.config?.ai?.workerPct ?? 60),
          commanderDirective: (profile.config?.ai?.commanderDirective && profile.config.ai.commanderDirective.trim())
            ? profile.config.ai.commanderDirective
            : currentCfg.ai.commanderDirective,
        }
      : profile.config?.ai;

    const mergedResourceMode = (!includeInfra && currentCfg.resourceMode && currentCfg.resourceMode !== 'full')
      ? currentCfg.resourceMode
      : (profile.config?.resourceMode || currentCfg.resourceMode || 'lite');

    const mergedSession = (!includeInfra && currentCfg.sessionPersistence?.enabled)
      ? currentCfg.sessionPersistence
      : (profile.config?.sessionPersistence || currentCfg.sessionPersistence);

    const mergedInput = {
      ...profile.config,
      proxy: mergedProxy,
      ...(mergedAi ? { ai: mergedAi } : {}),
      resourceMode: mergedResourceMode,
      ...(mergedSession ? { sessionPersistence: mergedSession } : {}),
    };
    const normalized = validateAndNormalizeConfig(mergedInput);
    writeConfigToDisk(normalized);
    setActiveProfileId(profile.id);
    const list = listSiteProfiles(validateAndNormalizeConfig, PORT);
    res.json({ ok: true, profile, config: normalized, preservedInfra: !includeInfra, ...list });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/site-profiles/:id', (req, res) => {
  try {
    const deletedId = deleteSiteProfile(req.params.id, validateAndNormalizeConfig, PORT);
    const list = listSiteProfiles(validateAndNormalizeConfig, PORT);
    res.json({ ok: true, deletedId, ...list });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/discover', async (req, res) => {
  try {
    const rawUrl = typeof req.body?.targetUrl === 'string' ? req.body.targetUrl.trim() : '';
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'כתובת היעד חייבת להתחיל ב-http:// או https://' });
    }
    const baseOrigin = parsed.origin;
    const basePath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/$/, '') : '';
    const discovered = new Set(['/']);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let html = '';
    let rootStatus = 0;
    try {
      const resp = await fetch(parsed.toString(), { signal: ctrl.signal, redirect: 'follow' });
      rootStatus = resp.status;
      html = await resp.text();
    } finally {
      clearTimeout(timer);
    }

    const hrefRegex = /href\s*=\s*["']([^"'#]+)["']/gi;
    let m;
    while ((m = hrefRegex.exec(html)) !== null) {
      try {
        const u = new URL(m[1], parsed.toString());
        if (u.origin !== baseOrigin) continue;
        if (/\.(css|js|png|jpg|jpeg|svg|webp|ico|woff2?|xml|json|pdf)$/i.test(u.pathname)) continue;
        let rel = u.pathname || '/';
        if (basePath && rel.startsWith(basePath)) {
          rel = rel.slice(basePath.length) || '/';
        }
        if (!rel.startsWith('/')) rel = '/' + rel;
        discovered.add(rel);
      } catch {}
    }

    // Also inspect sitemap.xml if available (best-effort)
    try {
      const sCtrl = new AbortController();
      const sTimer = setTimeout(() => sCtrl.abort(), 4000);
      const sResp = await fetch(`${baseOrigin}${basePath}/sitemap.xml`, { signal: sCtrl.signal }).catch(() => null);
      clearTimeout(sTimer);
      if (sResp && sResp.ok) {
        const xml = await sResp.text();
        const locRegex = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
        while ((m = locRegex.exec(xml)) !== null) {
          try {
            const u = new URL(m[1]);
            if (u.origin !== baseOrigin) continue;
            let rel = u.pathname || '/';
            if (basePath && rel.startsWith(basePath)) rel = rel.slice(basePath.length) || '/';
            if (!rel.startsWith('/')) rel = '/' + rel;
            discovered.add(rel);
          } catch {}
        }
      }
    } catch {}

    const pages = [...discovered].slice(0, 25);
    res.json({ ok: true, rootStatus, pages });
  } catch (err) {
    res.status(400).json({ error: err.message || 'סריקת האתר נכשלה.' });
  }
});

app.post('/api/inspect-page', async (req, res) => {
  try {
    const targetUrl = typeof req.body?.targetUrl === 'string' ? req.body.targetUrl.trim() : '';
    const pagePath = typeof req.body?.pagePath === 'string' ? req.body.pagePath.trim() : '/';
    if (!targetUrl && !/^https?:\/\//i.test(pagePath)) {
      return res.status(400).json({ error: 'יש להזין כתובת אתר ראשית (targetUrl) או כתובת URL מלאה.' });
    }
    const mapped = await inspectPageElements({ targetUrl, pagePath });
    res.json({ ok: true, mapped });
  } catch (err) {
    res.status(400).json({ error: err.message || 'מיפוי חלקי העמוד נכשל.' });
  }
});

app.get('/api/recorder/status', async (_req, res) => {
  const desktop = await getDesktopSessionInfo();
  res.json({ ok: true, recorder: getRecorderState(), desktop });
});

app.get('/api/email/status', (_req, res) => {
  res.json({ ok: true, email: getEmailClientStatus() });
});

app.post('/api/email/create', async (req, res) => {
  try {
    const ttlSeconds = Number(req.body?.ttlSeconds) || 600;
    const inbox = await createEmailInbox({ ttlSeconds });
    if (inbox?.inbox_id && inbox?.capability) {
      activeDashboardInboxes.set(inbox.inbox_id, {
        capability: inbox.capability,
        address: inbox.address,
        createdAt: Date.now(),
      });
      savePersistentInboxes(activeDashboardInboxes);
    }
    res.json({
      ok: true,
      inbox: {
        inbox_id: inbox.inbox_id,
        address: inbox.address,
        expires_at: inbox.expires_at,
      },
    });
  } catch (err) {
    res.status(err.httpStatus === 402 ? 402 : 400).json({ error: redactText(err.message || 'Could not create an inbox.') });
  }
});

app.get('/api/email/code/:inboxId', async (req, res) => {
  try {
    const inboxId = String(req.params.inboxId || '').trim();
    const stored = activeDashboardInboxes.get(inboxId);
    if (!stored || !stored.capability) {
      return res.status(404).json({ error: 'תיבת המייל לא נמצאה בזיכרון השרת הנוכחי.' });
    }
    const [result, msgsPayload] = await Promise.all([
      getEmailCode({
        inbox_id: inboxId,
        capability: stored.capability,
      }).catch(() => null),
      listEmailMessages({
        inbox_id: inboxId,
        capability: stored.capability,
      }).catch(() => null),
    ]);

    const confirmUrl = extractConfirmationUrlFromMessages(msgsPayload);
    if (confirmUrl) {
      try {
        await fetch(confirmUrl, {
          method: 'GET',
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
      } catch {}
      return res.json({
        ok: true,
        address: stored.address,
        status: 'link_confirmed',
        code: null,
        confirmationUrl: confirmUrl,
      });
    }

    if (result?.status === 'code' && result.code) {
      return res.json({
        ok: true,
        address: stored.address,
        status: 'code',
        code: result.code,
      });
    }

    const msgList = Array.isArray(msgsPayload?.messages)
      ? msgsPayload.messages
      : (Array.isArray(msgsPayload?.items) ? msgsPayload.items : []);
    if (msgList.length > 0) {
      return res.json({
        ok: true,
        address: stored.address,
        status: 'message_received',
        code: null,
        subject: msgList[0]?.subject || 'הודעה חדשה',
      });
    }

    res.json({
      ok: true,
      address: stored.address,
      status: result?.status || 'pending',
      code: null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'בדיקת קוד האימות נכשלה.' });
  }
});

app.get('/api/reports', (_req, res) => {
  res.json({ ok: true, reports: listSavedReports() });
});

app.get('/api/reports/latest/pdf', (_req, res) => {
  const reports = listSavedReports();
  const latest = reports.find(r => r.pdfFile || r.htmlFile);
  if (!latest) return res.status(404).send('טרם נוצרו דוחות הרצה.');
  const targetFile = latest.pdfFile || latest.htmlFile;
  const fullPath = path.join(REPORTS_DIR, path.basename(targetFile));
  if (!fs.existsSync(fullPath)) return res.status(404).send('קובץ הדוח לא נמצא.');
  if (targetFile.endsWith('.pdf')) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(targetFile)}"`);
  }
  res.sendFile(fullPath);
});

app.get('/api/reports/:filename', (req, res) => {
  const safeName = path.basename(String(req.params.filename || ''));
  if (!safeName.startsWith('run-report-') || !/\.(pdf|html|json)$/i.test(safeName)) {
    return res.status(400).send('שם קובץ לא תקין.');
  }
  const fullPath = path.join(REPORTS_DIR, safeName);
  if (!fs.existsSync(fullPath)) return res.status(404).send('קובץ הדוח לא נמצא.');
  if (safeName.endsWith('.pdf')) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  }
  res.sendFile(fullPath);
});

// רוטציית IP להקלטות: זכירת הפרוקסי האחרון שנבחר כדי שההקלטה הבאה תיפתח עם IP אחר (ללא חזרה עצמית)
let lastRecorderProxyUrl = '';

// ---- בחירת פרוקסי להקלטה -------------------------------------------------
// data/proxy-geo.json נבנה ע"י tools/build-proxy-geo.js (ip-api.com חינמי + בדיקת ההצעה).
// מחזיר מיפוי "host:port" -> { cc, city, ms, offerOk }. לעולם לא נשמרים כאן פרטי התחברות.
function readProxyGeoMap() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'proxy-geo.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.proxies === 'object' ? parsed.proxies : {};
  } catch {
    return {};
  }
}

function hostPortOf(proxyUrl) {
  const s = String(proxyUrl || '');
  const at = s.lastIndexOf('@');
  return at > 0 ? s.slice(at + 1) : s;
}

function recorderProxyCandidates(cfg) {
  const fromCfg = Array.isArray(cfg?.proxy?.servers) ? cfg.proxy.servers : [];
  const fromLegacy = Array.isArray(cfg?.proxyList) ? cfg.proxyList : [];
  const fromFileRaw = readProxiesTxt();
  const fromFile = Array.isArray(fromFileRaw) ? fromFileRaw : [];
  return Array.from(new Set([...fromCfg, ...fromLegacy, ...fromFile].map(s => String(s || '').trim()).filter(Boolean)));
}

const RECORDER_LOCALE_BY_CC = {
  US: ['en-US', 'America/New_York'],
  CA: ['en-CA', 'America/Toronto'],
  GB: ['en-GB', 'Europe/London'],
  AU: ['en-AU', 'Australia/Sydney'],
  DE: ['de-DE', 'Europe/Berlin'],
  AT: ['de-AT', 'Europe/Vienna'],
  FR: ['fr-FR', 'Europe/Paris'],
  IT: ['it-IT', 'Europe/Rome'],
  NL: ['nl-NL', 'Europe/Amsterdam'],
  CZ: ['cs-CZ', 'Europe/Prague'],
  RO: ['ro-RO', 'Europe/Bucharest'],
  JP: ['ja-JP', 'Asia/Tokyo'],
  KR: ['ko-KR', 'Asia/Seoul'],
  SG: ['en-SG', 'Asia/Singapore'],
};

// רשימת הפרוקסים הזמינים לבחירה במסך ההקלטה (ללא סיסמאות).
// יתרת המכסה הרזידנציאלית (1GB) — נספרת מהבייטים שירדו בפועל בכל ביקור, לא מהערכה.
app.get('/api/proxy/residential', (_req, res) => {
  try {
    const cfg = readConfigFromDisk();
    const residentialPool = require('../src/residentialPool');
    const resiCfg = cfg.proxy?.residential || {};
    const dcStatic = new Set([
      ...readDatacenterServers(),
      ...recorderProxyCandidates(cfg),
    ].filter(u => u && !residentialPool.isResidentialUrl(u)));
    res.json({
      ok: true,
      ...residentialPool.summary(resiCfg),
      usage: residentialPool.getUsage(),
      datacenterCount: dcStatic.size,
      tier: cfg.proxy?.tier || 'auto',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
});

app.get('/api/proxy/list', (_req, res) => {
  try {
    const cfg = readConfigFromDisk();
    const geo = readProxyGeoMap();
    const seenHostPorts = new Set();
    const proxies = recorderProxyCandidates(cfg).map(p => {
      const hp = hostPortOf(p);
      const g = geo[hp] || {};
      return {
        hostPort: hp,
        cc: g.cc || '',
        city: g.city || '',
        ms: typeof g.ms === 'number' ? g.ms : null,
        offerOk: g.offerOk === undefined ? null : g.offerOk,
      };
    }).filter(p => (seenHostPorts.has(p.hostPort) ? false : (seenHostPorts.add(p.hostPort), true)));
    res.json({ ok: true, proxies, geoUpdatedAt: (() => {
      try {
        const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'proxy-geo.json'), 'utf8');
        return JSON.parse(raw).updatedAt || null;
      } catch {
        return null;
      }
    })() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'קריאת רשימת הפרוקסים נכשלה.' });
  }
});

app.post('/api/recorder/start', async (req, res) => {
  if (activeProcess) {
    return res.status(409).json({ error: 'כבר פועלת הרצת סשנים כעת. עצור קודם את ההרצה לפני פתיחת ההקלטה.' });
  }
  try {
    const cfg = readConfigFromDisk();
    const targetUrl = typeof req.body?.targetUrl === 'string' && req.body.targetUrl.trim()
      ? req.body.targetUrl.trim()
      : cfg.targetUrl;
    const rawMode = String(req.body?.proxyMode || 'auto').trim();
    const proxyMode = rawMode.toLowerCase();
    // Country pin for the metered pool: Webshare targets a country with a `-<cc>` username suffix,
    // so the recording can exit from the US/UK/DE without buying anything extra.
    const wantedCountry = String(req.body?.proxyCountry || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    const geoMap = readProxyGeoMap();
    let proxyUrl = '';
    let proxyCountry = 'DIRECT';
    if (proxyMode !== 'direct') {
      const candidates = recorderProxyCandidates(cfg);
      if (proxyMode === 'datacenter') {
        const dcPool = Array.from(new Set([
          ...candidates,
          ...readDatacenterServers(),
        ].filter(p => p && !residentialPool.isResidentialUrl(p))));
        if (!dcPool.length) {
          return res.status(400).json({
            error: 'לא נמצאו פרוקסי דאטה־סנטר זמינים. הוסף פרוקסים סטטיים או בחר רזידנציאלי / חיבור ישיר.',
          });
        }
        const offerOkPool = dcPool.filter(p => (geoMap[hostPortOf(p)] || {}).offerOk === true);
        const usable = offerOkPool.length ? offerOkPool : dcPool;
        const rotated = usable.filter(p => !lastRecorderProxyUrl || p !== lastRecorderProxyUrl || usable.length <= 1);
        proxyUrl = rotated[Math.floor(Math.random() * rotated.length)] || usable[0];
      } else {
      if (!candidates.length) {
        return res.status(400).json({
          error: 'לא נמצאו פרוקסים בהגדרות (proxy.servers / proxies.txt). הוסף פרוקסים או בחר "ישיר מהמחשב (ישראל)".',
        });
      }
      // Residential first — Cloudflare/Turnstile and link-shortener WAFs reject datacenter ASNs
      // before the page even loads, so the recorder must leave through the metered pool while it
      // has budget; the static/datacenter list is only the fallback.
      const resiCfg = cfg.proxy?.residential || {};
      const resiPool = resiCfg.enabled === false || residentialPool.isExhausted(resiCfg)
        ? []
        : residentialPool.getServers(resiCfg);
      const resiCountryPool = wantedCountry ? residentialPool.listForCountry(wantedCountry) : [];
      const resiCandidates = resiCountryPool.length ? resiCountryPool : resiPool;
      if (resiCandidates.length && (proxyMode === 'us' || proxyMode === 'auto')) {
        const rotatedResi = resiCandidates.filter(p => !lastRecorderProxyUrl || p !== lastRecorderProxyUrl || resiCandidates.length <= 1);
        proxyUrl = rotatedResi[Math.floor(Math.random() * rotatedResi.length)] || resiCandidates[0];
      } else if (wantedCountry && (proxyMode === 'us' || proxyMode === 'auto')) {
        return res.status(400).json({
          error: `אין פרוקסי רזידנציאלי למדינה ${wantedCountry.toUpperCase()} — נסה מדינה אחרת או "אקראי — כל המדינות".`,
        });
      } else if (proxyMode === 'us' || proxyMode === 'auto') {
        const pool = proxyMode === 'us'
          ? candidates.filter(p => (geoMap[hostPortOf(p)] || {}).cc === 'US')
          : candidates;
        const basePool = pool.length ? pool : candidates;
        // מעדיפים פרוקסים שידוע שמקבלים את דף ההצעה (offerOk=true), ואז מסובבים
        const offerOkPool = basePool.filter(p => (geoMap[hostPortOf(p)] || {}).offerOk === true);
        const usable = offerOkPool.length ? offerOkPool : basePool;
        const rotated = usable.filter(p => !lastRecorderProxyUrl || p !== lastRecorderProxyUrl || usable.length <= 1);
        proxyUrl = rotated[Math.floor(Math.random() * rotated.length)] || '';
        if (!proxyUrl) {
          return res.status(400).json({
            error: proxyMode === 'us'
              ? 'לא נמצא פרוקסי מארה״ב (US) ברשימה. בחר מדינה אחרת מהרשימה או "ישיר מהמחשב (ישראל)".'
              : 'לא נמצא פרוקסי זמין ברשימה. בחר "ישיר מהמחשב (ישראל)".',
          });
        }
      } else {
        // בחירה ידנית: proxyMode מכיל "host:port"
        const match = candidates.find(p => hostPortOf(p).toLowerCase() === proxyMode);
        if (!match) {
          return res.status(400).json({
            error: `הפרוקסי ${rawMode} לא נמצא ברשימה הנוכחית. רענן את הרשימה במסך ההקלטה ונסה שוב.`,
          });
        }
        proxyUrl = match;
      }
      }
      proxyCountry = (geoMap[hostPortOf(proxyUrl)] || {}).cc || 'AUTO';
    }
    let locPair = proxyUrl ? (RECORDER_LOCALE_BY_CC[proxyCountry] || RECORDER_LOCALE_BY_CC.US) : ['', ''];
    if (proxyUrl && !RECORDER_LOCALE_BY_CC[proxyCountry]) {
    }
    if (proxyUrl && !RECORDER_LOCALE_BY_CC[proxyCountry]) {
      // Every sticky residential session shares one host:port, so the static geo table cannot say
      // where the exit is. Ask the proxy itself — a locale/timezone that contradicts the exit IP
      // is a bot signal on its own.
      const geo = await resolveNetworkGeo(proxyUrl, 3000).catch(() => null);
      if (geo && geo.countryCode) {
        proxyCountry = geo.countryCode;
        locPair = [geo.locale || locPair[0], geo.timezoneId || locPair[1]];
      }
    }
    const recorder = await startJourneyRecorder({
      targetUrl,
      proxyUrl,
      locale: proxyUrl ? locPair[0] : '',
      timezoneId: proxyUrl ? locPair[1] : '',
      browserEngine: cfg.browserEngine,
      // The recorder is deliberately independent of the runner-wide stealthMode: heavy injection
      // there produced a browser whose fingerprint contradicted itself. Opt in explicitly if needed.
      stealthMode: process.env.WTG_RECORDER_STEALTH === 'maximum' ? 'maximum' : 'standard',
      // מצב מוק: לפתוח דפדפן אמיתי עם הפרוקסי (IP אמריקאי) בלי להקליט צעדים בפועל
      mock: Boolean(req.body?.mock),
      onUpdate: st => broadcastEvent('recorder_update', st),
    });
    if (proxyUrl) lastRecorderProxyUrl = proxyUrl;
    const proxyHost = proxyUrl ? hostPortOf(proxyUrl) : 'DIRECT';
    res.json({ ok: true, recorder, proxyCountry, proxyHost, proxyCountryRequested: wantedCountry || null, mock: Boolean(req.body?.mock) });
  } catch (err) {
    const status = err?.code === 'NON_INTERACTIVE_DESKTOP' ? 409 : 400;
    const desktop = await getDesktopSessionInfo().catch(() => null);
    res.status(status).json({ error: err.message || 'פתיחת ההקלטה נכשלה.', code: err?.code || null, desktop });
  }
});

app.post('/api/recorder/stop', async (_req, res) => {
  try {
    const recorder = await stopJourneyRecorder();
    broadcastEvent('recorder_update', recorder);
    res.json({ ok: true, recorder });
  } catch (err) {
    res.status(500).json({ error: err.message || 'סיום ההקלטה נכשל.' });
  }
});

app.post('/api/recorder/focus', async (_req, res) => {
  try {
    const focusRes = await focusRecorderWindow();
    res.json(focusRes);
  } catch (err) {
    res.status(500).json({ error: err.message || 'הבאת חלון ההקלטה לחזית נכשלה.' });
  }
});

function getRunStatus() {
  return { ...redactData({ status: runState, logs: logHistory, visitDetails }), latestFrame };
}

app.get('/api/run/status', (_req, res) => res.json(getRunStatus()));

const aiCommanderState = {
  history: Array.isArray(persistedSession?.aiHistory)
    ? persistedSession.aiHistory.filter(m => !/^Let me analyze/i.test(String(m?.content || '').trim()))
    : [],
  activeDirective: '',
  autoTimer: null,
  lastUserChatAt: 0,
};

function deepMergeConfigPatch(target, patch, depth = 0) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || depth > 3) return target;
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
      deepMergeConfigPatch(target[k], v, depth + 1);
    } else if (v !== undefined) {
      target[k] = v;
    }
  }
  return target;
}

function applyFleetDirectives(directives = []) {
  const applied = [];
  let configChanged = false;
  let latestConfig = null;

  const updateSavedConfig = fn => {
    const cur = readConfigFromDisk();
    fn(cur);
    const normalized = validateAndNormalizeConfig(cur);
    writeConfigToDisk(normalized);
    latestConfig = normalized;
    configChanged = true;
    return normalized;
  };

  for (const d of Array.isArray(directives) ? directives : []) {
    if (!d || typeof d !== 'object') continue;
    if (d.type === 'pause' && activeProcess) {
      activeProcess.send({ type: 'pause' });
      runState.status = 'paused';
      broadcastEvent('status', runState);
      applied.push('pause');
    } else if (d.type === 'resume' && activeProcess) {
      activeProcess.send({ type: 'resume' });
      runState.status = 'running';
      broadcastEvent('status', runState);
      applied.push('resume');
    } else if (d.type === 'set_concurrency') {
      try {
        const nextMax = clampInt(d.max, 1, 32, runState.maxConcurrency || 3);
        const nextMin = clampInt(d.min, 1, nextMax, runState.minConcurrency || 1);
        updateSavedConfig(cur => {
          cur.minConcurrency = nextMin;
          cur.concurrency = nextMax;
        });
        if (activeProcess) {
          try { activeProcess.send({ type: 'set_concurrency', min: nextMin, max: nextMax }); } catch {}
        }
        runState.minConcurrency = nextMin;
        runState.maxConcurrency = nextMax;
        broadcastEvent('status', runState);
        applied.push(`set_concurrency(${nextMin}-${nextMax})`);
      } catch {}
    } else if (d.type === 'set_wave_mode' && typeof d.mode === 'string') {
      if (['off', 'steady', 'ramp_up', 'natural_peaks', 'burst'].includes(d.mode)) {
        try {
          updateSavedConfig(cur => {
            cur.waves = { ...(cur.waves || {}), enabled: d.mode !== 'off', mode: d.mode };
          });
        } catch {}
        if (activeProcess) {
          try { activeProcess.send({ type: 'set_wave_mode', mode: d.mode }); } catch {}
        }
        applied.push(`set_wave_mode(${d.mode})`);
      }
    } else if (d.type === 'dispatch_directive' && typeof d.directive === 'string') {
      aiCommanderState.activeDirective = d.directive.trim().slice(0, 300);
      try {
        updateSavedConfig(cur => {
          cur.ai = { ...(cur.ai || {}), commanderDirective: aiCommanderState.activeDirective };
        });
      } catch {}
      if (activeProcess) {
        try { activeProcess.send({ type: 'ai_directive', directive: aiCommanderState.activeDirective }); } catch {}
      }
      applied.push('dispatch_directive');
    } else if (d.type === 'focus_countries' && Array.isArray(d.countries)) {
      try {
        const codes = [...new Set(d.countries.map(normalizeCountryCode).filter(Boolean))];
        if (codes.length) {
          updateSavedConfig(cur => {
            cur.proxy = { ...(cur.proxy || {}), preferredCountries: codes };
          });
          applied.push(`focus_countries(${codes.join(',')})`);
        }
      } catch {}
    } else if (d.type === 'set_conversion_rate' && d.rate != null) {
      try {
        const rate = clampInt(d.rate, 0, 100, 25);
        updateSavedConfig(cur => {
          cur.waves = { ...(cur.waves || {}), conversionRate: rate };
        });
        if (activeProcess) {
          try { activeProcess.send({ type: 'set_conversion_rate', rate }); } catch {}
        }
        applied.push(`set_conversion_rate(${rate}%)`);
      } catch {}
    } else if (d.type === 'set_worker_pct' && d.pct != null) {
      try {
        const pct = clampInt(d.pct, 0, 100, 75);
        updateSavedConfig(cur => {
          cur.ai = { ...(cur.ai || {}), enabled: pct > 0, workerPct: pct };
        });
        if (activeProcess) {
          try { activeProcess.send({ type: 'set_worker_pct', pct }); } catch {}
        }
        applied.push(`set_worker_pct(${pct}%)`);
      } catch {}
    } else if (d.type === 'set_resource_mode' && ['full', 'lite', 'ultra_lite'].includes(d.mode)) {
      try {
        updateSavedConfig(cur => {
          cur.resourceMode = d.mode;
        });
        if (activeProcess) {
          try { activeProcess.send({ type: 'set_resource_mode', mode: d.mode }); } catch {}
        }
        applied.push(`set_resource_mode(${d.mode})`);
      } catch {}
    } else if (d.type === 'set_headless' && d.headless != null) {
      try {
        const nextHeadless = Boolean(d.headless);
        updateSavedConfig(cur => {
          cur.headless = nextHeadless;
        });
        applied.push(`set_headless(${nextHeadless ? 'hidden' : 'watch'})`);
      } catch {}
    } else if (d.type === 'set_task_mode' && ['scenario', 'hybrid', 'behavior'].includes(d.mode)) {
      try {
        updateSavedConfig(cur => {
          cur.taskMode = d.mode;
        });
        if (activeProcess) {
          try { activeProcess.send({ type: 'set_task_mode', mode: d.mode }); } catch {}
        }
        applied.push(`set_task_mode(${d.mode})`);
      } catch {}
    } else if (d.type === 'set_stream_mode' && d.enabled != null) {
      const nextStream = Boolean(d.enabled);
      streamState.active = nextStream;
      runState.streamMode = nextStream;
      if (!nextStream && streamState.nextWaveTimer) {
        clearTimeout(streamState.nextWaveTimer);
        streamState.nextWaveTimer = null;
      }
      broadcastEvent('status', runState);
      applied.push(`set_stream_mode(${nextStream ? 'on' : 'off'})`);
    } else if (d.type === 'add_recording_step' && d.step && typeof d.step === 'object') {
      try {
        const allowedTypes = new Set(['ai_explore', 'scan_products', 'human_browse', 'read_article', 'scroll', 'wait', 'goto', 'close_tab']);
        const rawType = String(d.step.type || 'ai_explore').trim();
        if (allowedTypes.has(rawType)) {
          const targetTab = clampInt(d.step.tab, 0, 10, 1);
          const newStep = {
            type: rawType,
            selector: typeof d.step.selector === 'string' ? d.step.selector.trim() : '',
            value: d.step.value != null ? String(d.step.value) : (rawType === 'ai_explore' ? '3' : ''),
            assertKind: 'text_contains',
            label: typeof d.step.label === 'string' && d.step.label.trim()
              ? d.step.label.trim().slice(0, 90)
              : `צעד AI (${rawType}) בטאב #${targetTab}`,
            tab: targetTab,
            optional: true,
          };
          const updated = updateSavedConfig(cur => {
            const list = Array.isArray(cur.taskSteps) ? [...cur.taskSteps] : [];
            const afterTab = d.afterTab != null ? clampInt(d.afterTab, 0, 10, targetTab) : targetTab;
            const closeIdx = list.findIndex(s => s.type === 'close_tab' && (s.tab || 0) === afterTab);
            if (closeIdx >= 0) {
              list.splice(closeIdx, 0, newStep);
            } else {
              const lastTabIdx = list.map(s => Number(s.tab) || 0).lastIndexOf(afterTab);
              const openerIdx = list.findIndex(s => Number(s.opensTab) === afterTab);
              const insertAt = lastTabIdx >= 0 ? lastTabIdx + 1 : (openerIdx >= 0 ? openerIdx + 1 : list.length);
              list.splice(insertAt, 0, newStep);
            }
            cur.taskSteps = list;
          });
          if (activeProcess) {
            try { activeProcess.send({ type: 'update_task_steps', taskSteps: updated.taskSteps }); } catch {}
          }
          applied.push(`add_recording_step(${rawType}@tab${targetTab})`);
        }
      } catch {}
    } else if (d.type === 'set_exploration') {
      try {
        let nextWavesSnapshot = null;
        updateSavedConfig(cur => {
          const nextWaves = { ...(cur.waves || {}) };
          if (d.extraPageChance != null) nextWaves.extraPageChance = clampInt(d.extraPageChance, 0, 100, nextWaves.extraPageChance ?? 40);
          if (d.scanProductsChance != null) nextWaves.scanProductsChance = clampInt(d.scanProductsChance, 0, 100, nextWaves.scanProductsChance ?? 65);
          if (d.maxProducts != null) nextWaves.maxProductsPerVisit = clampInt(d.maxProducts, 1, 4, nextWaves.maxProductsPerVisit ?? 2);
          cur.waves = nextWaves;
          nextWavesSnapshot = nextWaves;
        });
        if (activeProcess && nextWavesSnapshot) {
          try {
            activeProcess.send({
              type: 'set_exploration',
              extraPageChance: nextWavesSnapshot.extraPageChance,
              scanProductsChance: nextWavesSnapshot.scanProductsChance,
              maxProducts: nextWavesSnapshot.maxProductsPerVisit,
            });
          } catch {}
        }
        if (nextWavesSnapshot) {
          applied.push(`set_exploration(${nextWavesSnapshot.extraPageChance}%/${nextWavesSnapshot.scanProductsChance}%)`);
        }
      } catch {}
    } else if (d.type === 'set_delays' && d.interVisitDelayMs != null) {
      try {
        const delayMs = clampInt(d.interVisitDelayMs, 0, 60000, 0);
        updateSavedConfig(cur => {
          cur.interVisitDelayMs = delayMs;
        });
        if (activeProcess) {
          try { activeProcess.send({ type: 'set_delays', interVisitDelayMs: delayMs }); } catch {}
        }
        applied.push(`set_delays(${delayMs}ms)`);
      } catch {}
    } else if (d.type === 'assign_squad_model' && typeof d.model === 'string' && d.model.trim()) {
      const squadId = ['alpha', 'bravo', 'charlie', 'delta', 'all'].includes(d.squadId) ? d.squadId : 'all';
      const cleanModel = d.model.trim().slice(0, 80);
      if (squadId === 'all') {
        try {
          updateSavedConfig(cur => {
            cur.ai = { ...(cur.ai || {}), workerModel: cleanModel };
          });
        } catch {}
      }
      if (activeProcess) {
        try { activeProcess.send({ type: 'assign_squad_model', squadId, model: cleanModel }); } catch {}
      }
      applied.push(`assign_squad_model(${squadId}->${cleanModel})`);
    } else if (d.type === 'set_visits' && d.visits != null) {
      try {
        const visits = clampInt(d.visits, 1, 100000, 300);
        updateSavedConfig(cur => {
          cur.visitCount = visits;
        });
        applied.push(`set_visits(${visits})`);
      } catch {}
    } else if (d.type === 'start_run' && !activeProcess) {
      try {
        const normalized = updateSavedConfig(cur => {
          if (d.visits != null) cur.visitCount = clampInt(d.visits, 1, 100000, cur.visitCount || 300);
          if (d.conversionRate != null) {
            cur.waves = { ...(cur.waves || {}), conversionRate: clampInt(d.conversionRate, 0, 100, 25) };
          }
          // Watch-mode fix (2026-11-16): start_run no longer overrides the user's headless choice.
          // The standing config / UI checkbox wins; explicit set_headless directive still works.
          if (['scenario', 'hybrid', 'behavior'].includes(d.taskMode)) cur.taskMode = d.taskMode;
        });
        streamState.active = Boolean(d.streamMode);
        streamState.waveNumber = 1;
        launchRunnerWave(normalized, { isContinuationWave: false });
        applied.push(`start_run(${normalized.visitCount} visits, ${normalized.waves.conversionRate}% conv)`);
      } catch {}
    } else if (d.type === 'stop_run' && activeProcess) {
      streamState.active = false;
      runState.streamMode = false;
      try { activeProcess.send({ type: 'stop' }); } catch {}
      applied.push('stop_run');
    } else if (d.type === 'update_config' && d.patch && typeof d.patch === 'object') {
      try {
        // Operator-guard (2026-11-17): the AI Commander must not override operator-owned fields.
        // Previously an AI update_config silently rewrote targetUrl (rzekl override at every run
        // start, user complaint 2026-11-16) and could flip headless/proxio pool as well. The
        // landing target, watch mode and proxy pool are controlled from the dashboard/config only.
        const patch = { ...d.patch };
        const blocked = [];
        for (const k of ['targetUrl', 'headless', 'proxy']) {
          if (Object.prototype.hasOwnProperty.call(patch, k)) {
            blocked.push(k);
            delete patch[k];
          }
        }
        if (blocked.length) {
          appendLog('warn', `[AI Commander Guard] נחסמו שדות בבעלות המפעיל מפני שכתובת AI: ${blocked.join(', ')}`);
        }
        if (Object.keys(patch).length) {
          const updated = updateSavedConfig(cur => deepMergeConfigPatch(cur, patch));
          if (activeProcess) {
            try { activeProcess.send({ type: 'update_runtime_config', config: updated }); } catch {}
          }
          const keys = Object.keys(patch).slice(0, 4).join(',');
          applied.push(`update_config(${keys || 'custom'})${blocked.length ? ' [target/headless/proxy-locked]' : ''}`);
        } else if (blocked.length) {
          applied.push('update_config(blocked: targetUrl/headless/proxy are operator-owned)');
        }
      } catch {}
    } else if (d.type === 'remove_recording_step') {
      try {
        const updated = updateSavedConfig(cur => {
          const list = Array.isArray(cur.taskSteps) ? [...cur.taskSteps] : [];
          if (Number.isInteger(d.index) && d.index >= 1 && d.index <= list.length) {
            list.splice(d.index - 1, 1);
          } else if (Number.isInteger(d.tab) && d.tab >= 0) {
            cur.taskSteps = list.filter(s => (Number(s.tab) || 0) !== d.tab);
            return;
          } else if (typeof d.match === 'string' && d.match.trim()) {
            const needle = d.match.trim().toLowerCase();
            cur.taskSteps = list.filter(s => !`${s.label || ''} ${s.selector || ''} ${s.value || ''}`.toLowerCase().includes(needle));
            return;
          }
          cur.taskSteps = list;
        });
        if (activeProcess) {
          try { activeProcess.send({ type: 'update_task_steps', taskSteps: updated.taskSteps }); } catch {}
        }
        applied.push(`remove_recording_step(${d.index || d.tab || d.match || 'step'})`);
      } catch {}
    } else if (d.type === 'replace_task_steps' && Array.isArray(d.steps)) {
      try {
        const updated = updateSavedConfig(cur => { cur.taskSteps = d.steps; });
        if (activeProcess) {
          try { activeProcess.send({ type: 'update_task_steps', taskSteps: updated.taskSteps }); } catch {}
        }
        applied.push(`replace_task_steps(${updated.taskSteps.length})`);
      } catch {}
    }
  }
  if (configChanged && latestConfig) {
    broadcastEvent('config_updated', { config: latestConfig });
  }
  if (applied.length) {
    appendLog('info', `[AI Commander] יושמו פקודות צי: ${applied.join(', ')}`);
  }
  return applied;
}

app.get('/api/proxies/countries', (_req, res) => {
  res.json({
    tier1Defaults: TIER1_DEFAULT_COUNTRIES,
    catalog: COUNTRY_CATALOG,
  });
});

app.get('/api/ai/status', (_req, res) => {
  const cfg = readConfigFromDisk();
  res.json({
    ...getOllamaStatusPublic(),
    aiConfig: cfg.ai || DEFAULT_CONFIG.ai,
    activeDirective: aiCommanderState.activeDirective || cfg.ai?.commanderDirective || '',
    history: aiCommanderState.history.slice(-20),
  });
});

app.post('/api/ai/directive', (req, res) => {
  const directive = typeof req.body?.directive === 'string' ? req.body.directive.trim().slice(0, 300) : '';
  aiCommanderState.activeDirective = directive;
  if (activeProcess) {
    try {
      activeProcess.send({ type: 'ai_directive', directive });
    } catch {}
  }
  appendLog('info', `[AI Commander] עודכנה הנחיית סוכנים ידנית: ${directive || '(נוקה)'}`);
  broadcastEvent('ai_feed', { role: 'system', content: `הנחיית סוכנים עודכנה: ${directive || '(ללא)'}`, ts: new Date().toISOString() });
  res.json({ ok: true, activeDirective: directive, liveDelivered: Boolean(activeProcess) });
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) return res.status(400).json({ error: 'הזן הודעה או פקודה למפקח ה-AI.' });
    const cfg = readConfigFromDisk();
    const model = typeof req.body?.model === 'string' && req.body.model.trim()
      ? req.body.model.trim()
      : cfg.ai?.commanderModel;
    const provider = typeof req.body?.provider === 'string' && req.body.provider.trim()
      ? req.body.provider.trim()
      : cfg.ai?.provider;

    aiCommanderState.lastUserChatAt = Date.now();
    aiCommanderState.history.push({ role: 'user', content: redactText(message), ts: new Date().toISOString() });
    if (aiCommanderState.history.length > 30) aiCommanderState.history.shift();

    const result = await askFleetCommander({
      message,
      runState,
      config: cfg,
      recentLogs: logHistory.slice(-24),
      visitDetails,
      history: aiCommanderState.history.slice(-8),
      model,
      provider,
      isAutoCheck: false,
    });

    const applied = req.body?.autoApply !== false
      ? applyFleetDirectives(result.directives)
      : [];

    const entry = {
      role: 'assistant',
      content: redactText(result.reply),
      directives: result.directives || [],
      applied,
      provider: result.provider || 'local-advisor',
      model: result.model,
      fallbackUsed: Boolean(result.fallbackUsed),
      ts: new Date().toISOString(),
    };
    aiCommanderState.history.push(entry);
    if (aiCommanderState.history.length > 30) aiCommanderState.history.shift();
    broadcastEvent('ai_feed', entry);

    res.json({ ok: true, ...entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const streamState = {
  active: wasInterruptedOnBoot && Boolean(persistedRunState?.streamMode),
  waveNumber: Number(persistedRunState?.streamWave) || 1,
  nextWaveTimer: null,
  autoRecoveryTimer: null,
  autoRecoveryAttempts: 0,
};

function launchRunnerWave(cfg, { isContinuationWave = false, isAutoResume = false, overrideVisitCount = null } = {}) {
  registerStepSecrets(cfg.taskSteps);
  const waveStartedAt = Date.now();
  if (streamState.autoRecoveryTimer) {
    clearTimeout(streamState.autoRecoveryTimer);
    streamState.autoRecoveryTimer = null;
  }
  const resumeOffsets = isAutoResume
    ? {
        totalPlanned: Math.max(Number(runState.totalPlanned) || 0, Number(cfg.visitCount) || 0),
        completed: Number(runState.completed) || 0,
        succeeded: Number(runState.succeeded) || 0,
        timedOut: Number(runState.timedOut) || 0,
        failed: Number(runState.failed) || 0,
        errorsTotal: Number(runState.errorsTotal) || 0,
        returningSessions: Number(runState.returningSessions) || 0,
        newSessions: Number(runState.newSessions) || 0,
      }
    : null;

  if (isAutoResume) {
    runState.status = 'running';
    runState.finishedAt = null;
    runState.exitCode = null;
    runState.currentConcurrency = 0;
    scheduleSaveSessionState();
  } else {
    streamState.autoRecoveryAttempts = 0;
    resetRunStats(cfg);
  }
  // Keep existing logs visible so the user never loses log lines; insert a clear visual separator
  if (!isContinuationWave && !isAutoResume && logHistory.length > 0) {
    appendLog('info', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  const effectiveVisitCount = Math.max(1, Number(overrideVisitCount) || Number(cfg.visitCount) || 1);
  const childEnv = { ...process.env, CONCURRENCY: String(cfg.concurrency) };
  if (overrideVisitCount && Number(overrideVisitCount) > 0) {
    childEnv.VISIT_COUNT_OVERRIDE = String(effectiveVisitCount);
  }

  const child = spawn(process.execPath, ['--max-old-space-size=1536', RUNNER_PATH, CONFIG_PATH], {
    cwd: ROOT_DIR,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  activeProcess = child;
  runState.pid = child.pid;
  runState.streamMode = streamState.active;
  runState.streamWave = streamState.waveNumber;
  const streamTag = streamState.active ? `🌊 [נחל רציף — גל #${streamState.waveNumber}] ` : '';
  const resumeTag = isAutoResume ? '🔄 [המשך אוטומטי] ' : '';
  appendLog(
    'info',
    `${resumeTag}${streamTag}מפעיל הרצה (${cfg.engineMode}): ${effectiveVisitCount} ביקורים | מקביליות: ${cfg.minConcurrency}-${cfg.concurrency} | דפדפן ${cfg.headless ? 'מוסתר (Headless)' : 'גלוי (Watch Mode)'} | יעד: ${cfg.targetUrl}`
  );

  child.on('message', msg => {
    if (msg?.type === 'telemetry' && msg.data) {
      if (resumeOffsets) {
        const d = msg.data;
        Object.assign(runState, {
          ...d,
          totalPlanned: resumeOffsets.totalPlanned,
          completed: Math.min(resumeOffsets.totalPlanned, resumeOffsets.completed + (Number(d.completed) || 0)),
          succeeded: resumeOffsets.succeeded + (Number(d.succeeded) || 0),
          timedOut: resumeOffsets.timedOut + (Number(d.timedOut) || 0),
          failed: resumeOffsets.failed + (Number(d.failed) || 0),
          errorsTotal: resumeOffsets.errorsTotal + (Number(d.errorsTotal) || 0),
          returningSessions: resumeOffsets.returningSessions + (Number(d.returningSessions) || 0),
          newSessions: resumeOffsets.newSessions + (Number(d.newSessions) || 0),
        });
      } else {
        Object.assign(runState, redactData(msg.data));
      }
      runState.streamMode = streamState.active;
      runState.streamWave = streamState.waveNumber;
      if (runState.status !== 'stopping' && runState.status !== 'completed' && runState.status !== 'stopped' && runState.status !== 'error') {
        if (msg.data.waitingForSchedule) runState.status = 'waiting_schedule';
        else if (msg.data.paused) runState.status = 'paused';
        else runState.status = 'running';
      }
      broadcastEvent('status', runState);
    } else if (msg?.type === 'live_frame' && msg.data) {
      const d = msg.data;
      if (d.imageDataUrl || (d.type === 'rrweb_events' && Array.isArray(d.events) && d.events.some(ev => ev?.type === 2))) {
        latestFrame = d;
      } else if (d.type === 'live_meta' && latestFrame) {
        latestFrame = { ...latestFrame, url: d.url || latestFrame.url, label: d.label || latestFrame.label, visitIndex: d.visitIndex ?? latestFrame.visitIndex };
      }
      broadcastEvent('live_frame', d);
    } else if (msg?.type === 'visit_detail' && msg.data) {
      const detail = redactData(msg.data);
      visitDetails.unshift(detail);
      if (visitDetails.length > 100) visitDetails.pop();
      broadcastEvent('visit_detail', detail);
    }
  });

  const wireStream = (stream, level) => {
    let buffer = '';
    stream.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) appendLog(level, line);
      }
    });
    stream.on('end', () => {
      if (buffer.trim()) appendLog(level, buffer.trim());
    });
  };

  wireStream(child.stdout, 'stdout');
  wireStream(child.stderr, 'stderr');

  child.on('close', (code, signal) => {
    const wasStopping = runState.status === 'stopping';
    activeProcess = null;
    runState.pid = null;
    runState.currentConcurrency = 0;
    runState.finishedAt = new Date().toISOString();
    runState.exitCode = code;
    if (aiCommanderState.autoTimer) {
      clearInterval(aiCommanderState.autoTimer);
      aiCommanderState.autoTimer = null;
    }
    for (const inbox of readRunInboxes()) {
      if (inbox.createdAt >= waveStartedAt) {
        runInboxSummary.set(inbox.inbox_id, { inbox_id: inbox.inbox_id, address: maskEmail(inbox.address) });
      }
    }
    broadcastEvent('profiles_updated', { profiles: listSavedProfiles(PROFILES_DIR) });

    const remainingVisits = Math.max(0, (Number(runState.totalPlanned) || 0) - (Number(runState.completed) || 0));
    if (!wasStopping && code !== 0 && remainingVisits > 0 && streamState.autoRecoveryAttempts < 5) {
      streamState.autoRecoveryAttempts += 1;
      runState.status = 'running';
      runState.finishedAt = null;
      broadcastEvent('status', runState);
      appendLog(
        'info',
        `🔄 [Auto-Recovery #${streamState.autoRecoveryAttempts}/5] מזהה עצירה לא מתוכננת (קוד: ${code ?? signal ?? 'unknown'}, הושלמו ${runState.completed}/${runState.totalPlanned}) — ממשיך אוטומטית את ${remainingVisits} הביקורים שנותרו בעוד 5 שניות...`
      );
      streamState.autoRecoveryTimer = setTimeout(() => {
        streamState.autoRecoveryTimer = null;
        if (activeProcess || runState.status !== 'running') return;
        try {
          const nextCfg = validateAndNormalizeConfig(readConfigFromDisk());
          launchRunnerWave(nextCfg, { isAutoResume: true, overrideVisitCount: remainingVisits });
        } catch (err) {
          runState.status = 'error';
          broadcastEvent('status', runState);
          appendLog('stderr', `שגיאה ב-Auto-Recovery: ${err.message}`);
        }
      }, 5000);
      return;
    }

    if (!wasStopping && streamState.active && code === 0) {
      const finishedWave = streamState.waveNumber;
      streamState.waveNumber += 1;
      runState.status = 'running';
      broadcastEvent('status', runState);
      appendLog(
        'info',
        `🌊 [נחל אוטונומי רציף — גל #${finishedWave} הושלם בהצלחה!] ראשי הצוות (GLM-5.3-Flash + DeepSeek + Beam + Clef) משגרים את גל #${streamState.waveNumber} בעוד 10 שניות...`
      );
      streamState.nextWaveTimer = setTimeout(() => {
        streamState.nextWaveTimer = null;
        if (!streamState.active || activeProcess) return;
        try {
          const nextCfg = validateAndNormalizeConfig(readConfigFromDisk());
          launchRunnerWave(nextCfg, { isContinuationWave: true });
        } catch (err) {
          streamState.active = false;
          runState.status = 'error';
          broadcastEvent('status', runState);
          appendLog('stderr', `שגיאה בשיגור גל הבא בנחל: ${err.message}`);
        }
      }, 10000);
      return;
    }

    streamState.active = false;
    runState.streamMode = false;
    runState.status = wasStopping ? 'stopped' : (code === 0 ? 'completed' : 'error');
    broadcastEvent('status', runState);

    appendLog(
      runState.status === 'error' ? 'stderr' : 'info',
      wasStopping
        ? 'ההרצה והנחל נעצרו ידנית על ידי המשתמש.'
        : `ההרצה הסתיימה (קוד יציאה: ${code ?? signal ?? 'unknown'}). מייצר דוח PDF מפורט ומסוכם ב-AI בעברית...`
    );

    const runLogsSnapshot = logHistory.filter(l => (Number(l?.id) || 0) > currentRunStartLogSeq);
    const runStateSnapshot = { ...runState };
    const visitDetailsSnapshot = [...visitDetails];
    generateRunPdfReport({
      runState: runStateSnapshot,
      config: cfg,
      logs: runLogsSnapshot.length ? runLogsSnapshot : logHistory.slice(-200),
      visitDetails: visitDetailsSnapshot,
      inboxes: [...runInboxSummary.values()],
    })
      .then(reportMeta => {
        const dlTarget = reportMeta.pdfFile || reportMeta.htmlFile;
        appendLog(
          'info',
          `📄 [דוח PDF אוטומטי מוכן] נשמר דוח הרצה מלא + סיכום AI בעברית: /api/reports/${dlTarget} (לחץ על "📄 הורד דוח PDF אחרון" למעלה!)`
        );
        const summaryEntry = {
          role: 'assistant',
          auto: true,
          content: `📄 **דוח סיכום הרצה אוטומטי (${reportMeta.id}):**\n\n${reportMeta.aiSummaryHe}`,
          directives: [],
          applied: [],
          provider: 'report-ai',
          model: reportMeta.aiModelUsed,
          reportUrl: `/api/reports/${dlTarget}`,
          ts: new Date().toISOString(),
        };
        aiCommanderState.history.push(summaryEntry);
        if (aiCommanderState.history.length > 30) aiCommanderState.history.shift();
        broadcastEvent('ai_feed', summaryEntry);
        broadcastEvent('report_ready', reportMeta);
        scheduleSaveSessionState();
      })
      .catch(err => {
        appendLog('stderr', `שגיאה ביצירת דוח ה-PDF האוטומטי: ${err.message}`);
      });
  });

  if (cfg.ai?.enabled && cfg.ai?.autoManage) {
    if (aiCommanderState.autoTimer) clearInterval(aiCommanderState.autoTimer);
    let lastReviewedCompleted = 0;
    let lastReviewedErrors = 0;
    let lastReviewedSkips = 0;
    let lastReviewedSlow = 0;
    let lastReviewTs = 0;

    aiCommanderState.autoTimer = setInterval(async () => {
      if (!activeProcess || !['running', 'paused'].includes(runState.status)) return;
      const now = Date.now();
      if (now - lastReviewTs < 85000) return;
      if (now - (aiCommanderState.lastUserChatAt || 0) < 35000) return;

      const curCompleted = Number(runState.completed || 0);
      const curErrors = Number(runState.errorsTotal || 0);
      const curSkips = Number(runState.skippedStepsTotal || 0);
      const curSlow = Number(runState.slowVisitsCount || 0);

      const ramAlert = Number(runState.memUsedPct || 0) >= 82;
      const failAlert = Number(runState.failed || 0) >= 1;
      const errorAlert = curErrors - lastReviewedErrors >= 2;
      const skipAlert = curSkips - lastReviewedSkips >= 4;
      const speedAlert = curSlow - lastReviewedSlow >= 2 || Number(runState.avgLoadMs || 0) >= 3200;
      const milestoneAlert = curCompleted > 0 && curCompleted - lastReviewedCompleted >= 5;

      if (!ramAlert && !failAlert && !errorAlert && !skipAlert && !speedAlert && !milestoneAlert) return;

      lastReviewTs = now;
      lastReviewedCompleted = curCompleted;
      lastReviewedErrors = curErrors;
      lastReviewedSkips = curSkips;
      lastReviewedSlow = curSlow;

      try {
        const resReview = await askFleetCommander({
          message: 'סקור טלמטריה רחבה של הריצה: שגיאות JS/דפים, צעדים מדולגים או סלקטורים שבורים, מהירות טעינה, חיסכון פרוקסי ו-AI Cache, ועומס זיכרון. דווח תובנות קצרות בעברית וקבל החלטת איזון אם נדרש.',
          runState,
          config: readConfigFromDisk(),
          recentLogs: logHistory.slice(-24),
          visitDetails,
          model: cfg.ai.commanderModel,
          provider: cfg.ai.provider,
          isAutoCheck: true,
        });
        const applied = applyFleetDirectives(resReview.directives);
        const item = {
          role: 'assistant',
          auto: true,
          content: redactText(resReview.reply),
          directives: resReview.directives || [],
          applied,
          provider: resReview.provider || 'local-advisor',
          model: resReview.model,
          ts: new Date().toISOString(),
        };
        aiCommanderState.history.push(item);
        broadcastEvent('ai_feed', item);
      } catch {}
    }, 25000);
  }

  child.on('error', err => {
    activeProcess = null;
    streamState.active = false;
    runState.pid = null;
    runState.finishedAt = new Date().toISOString();
    runState.status = 'error';
    appendLog('stderr', `שגיאת הפעלה: ${err.message}`);
  });
}

app.post('/api/run/start', (req, res) => {
  if (activeProcess || streamState.nextWaveTimer) {
    return res.status(409).json({ error: 'כבר קיימת הרצה פעילה כרגע. השהה או עצור אותה לפני הפעלה חדשה.' });
  }
  if (getRecorderState().active) {
    return res.status(409).json({ error: 'הקלטת מסלול פעילה כרגע. סיים את ההקלטה לפני הפעלת סשנים.' });
  }

  let cfg;
  try {
    if (req.body && req.body.config) {
      cfg = validateAndNormalizeConfig(req.body.config);
      writeConfigToDisk(cfg);
    } else {
      cfg = validateAndNormalizeConfig(readConfigFromDisk());
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  streamState.active = Boolean(req.body?.streamMode);
  streamState.waveNumber = 1;
  if (streamState.nextWaveTimer) {
    clearTimeout(streamState.nextWaveTimer);
    streamState.nextWaveTimer = null;
  }

  launchRunnerWave(cfg, { isContinuationWave: false });
  res.json({ ok: true, status: runState, streamMode: streamState.active });
});

app.post('/api/run/preview', (req, res) => {
  const active = req.body?.active !== false;
  if (activeProcess) {
    try { activeProcess.send({ type: 'set_preview_active', active }); } catch {}
  }
  res.json({ ok: true, active });
});

app.post('/api/run/pause', (_req, res) => {
  if (!activeProcess) return res.status(409).json({ error: 'אין הרצה פעילה להשהיה.' });
  try {
    activeProcess.send({ type: 'pause' });
    runState.status = 'paused';
    broadcastEvent('status', runState);
    res.json({ ok: true, status: runState });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/run/resume', (_req, res) => {
  if (!activeProcess) return res.status(409).json({ error: 'אין הרצה פעילה לחידוש.' });
  try {
    activeProcess.send({ type: 'resume' });
    runState.status = 'running';
    broadcastEvent('status', runState);
    res.json({ ok: true, status: runState });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/run/stop', (_req, res) => {
  streamState.active = false;
  runState.streamMode = false;
  if (streamState.nextWaveTimer) {
    clearTimeout(streamState.nextWaveTimer);
    streamState.nextWaveTimer = null;
  }
  if (streamState.autoRecoveryTimer) {
    clearTimeout(streamState.autoRecoveryTimer);
    streamState.autoRecoveryTimer = null;
  }
  if (!activeProcess) {
    runState.status = 'stopped';
    broadcastEvent('status', runState);
    return res.json({ ok: true, status: runState });
  }
  const procToStop = activeProcess;
  runState.status = 'stopping';
  appendLog('info', 'שולח פקודת עצירה ל-Crawlee ולדפדפנים הפתוחים...');
  broadcastEvent('status', runState);

  try { procToStop.send({ type: 'stop' }); } catch {}
  setTimeout(() => {
    if (activeProcess === procToStop) {
      terminateProcessTree(procToStop);
    }
  }, 3500);

  res.json({ ok: true, status: runState });
});

app.get('/api/events', async (req, res) => {
  await getDesktopSessionInfo().catch(() => null);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`event: init\ndata: ${JSON.stringify({
    ...getRunStatus(),
    demoEvents,
    profiles: listSavedProfiles(PROFILES_DIR),
    system: getSystemInfo(),
    recorder: getRecorderState(),
  })}\n\n`);

  if (sseClients.size >= 3) {
    const oldest = sseClients.values().next().value;
    if (oldest) {
      sseClients.delete(oldest);
      try { oldest.end(); } catch {}
    }
  }
  sseClients.add(res);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

const server = app.listen(PORT, HOST, () => {
  ensureBuiltinSiteProfiles(validateAndNormalizeConfig, PORT);
  const dashUrl = `http://${HOST}:${PORT}`;
  console.log(`QA & Crawlee Dashboard listening at ${dashUrl}`);
  console.log(`Built-in Safe Test Site at ${dashUrl}/demo-site`);
  getDesktopSessionInfo()
    .then(desk => {
      if (desk && !desk.isInteractiveDesktop) {
        console.warn(`[Desktop Warning] Server running inside non-interactive desktop (${desk.windowStation}\\${desk.currentDesktop}). Visible browser recorder windows require launching start-dashboard.bat from Windows Desktop.`);
      }
    })
    .catch(() => {});
  if (wasInterruptedOnBoot) {
    const remainingVisits = Math.max(1, persistedPlanned - persistedCompleted);
    appendLog(
      'info',
      `🔄 [Auto-Recovery] זוהה סבב פעיל שנקטע (${persistedCompleted}/${persistedPlanned}) — ממשיך אוטומטית את ${remainingVisits} הביקורים שנותרו בעוד 3 שניות...`
    );
    streamState.autoRecoveryTimer = setTimeout(() => {
      streamState.autoRecoveryTimer = null;
      if (activeProcess || runState.status !== 'running') return;
      try {
        const nextCfg = validateAndNormalizeConfig(readConfigFromDisk());
        launchRunnerWave(nextCfg, { isAutoResume: true, overrideVisitCount: remainingVisits });
      } catch (err) {
        runState.status = 'error';
        broadcastEvent('status', runState);
        appendLog('stderr', `שגיאה בחידוש אוטומטי של הסבב: ${err.message}`);
      }
    }, 3000);
  }
  if (process.argv.includes('--open') || process.env.OPEN_BROWSER === '1') {
    if (process.platform === 'win32') {
      execFile('cmd', ['/c', 'start', '', dashUrl], () => {});
    }
  }
});

server.on('error', err => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use (dashboard is probably already running at http://${HOST}:${PORT}).`);
  } else {
    console.error('Dashboard server failed to start:', err?.message || err);
  }
  process.exit(1);
});
