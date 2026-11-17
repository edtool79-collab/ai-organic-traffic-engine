const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  AutoscaledPool,
  PlaywrightCrawler,
  Configuration,
} = require('crawlee');

const {
  normalizePersonas,
  normalizePages,
  buildGoogleSearchReferrer,
  buildRandomReferrer,
  runVisitInteractions,
  randomChoice,
  sleep,
} = require('./behaviorEngine');

const { executeTaskSteps, resetRunInboxFile, confirmRunInboxes } = require('./taskScenarioRunner');

const {
  applyOriginScopedHeaders,
  buildAdSafetyHeaders,
  installPopunderShield,
} = require('./adSafetyHelper');

const {
  pickDeviceKey,
  acquireProfileSlot,
  releaseProfileSlot,
  openSessionContext,
  closeAllSharedBrowsers,
  raisePlaywrightWindowsWin32,
  getChromiumStealthArgs,
  applyMaximumStealth,
  applyResourceMode,
  getProxySaverStats,
  getStealthChromium,
  getCdpIntegrationsStatus,
} = require('./fingerprintManager');

const {
  readProxiesTxt,
  readFallbackProxiesTxt,
  createFailoverProxyPool,
  normalizeProxyLine,
  toPlaywrightProxy,
  createCrawleeProxyConfiguration,
  selectProxiesForCountries,
  checkSingleProxy,
  maskProxyLabel,
  resolveNetworkGeo,
  isLoopbackUrl,
} = require('./proxyManager');

const {
  computeWavePacing,
  buildChildJourney,
  runScanProductsStep,
} = require('./wavePlanner');

const { runAiExploreStep, getAiTokenSaverStats } = require('./aiCommander');
const { resolveTargetUrl } = require('./behaviorEngine');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const PROFILES_DIR = path.join(ROOT_DIR, 'session-profiles');

function parseTimeMinutes(hhmm, fallbackMinutes) {
  if (typeof hhmm !== 'string') return fallbackMinutes;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallbackMinutes;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return fallbackMinutes;
  return h * 60 + min;
}

function isWithinActiveHours(schedule, now = new Date()) {
  if (!schedule || !schedule.enabled) return true;
  const start = parseTimeMinutes(schedule.startHour, 0);
  const end = parseTimeMinutes(schedule.endHour, 23 * 60 + 59);
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return true;
  if (start < end) return current >= start && current <= end;
  // Overnight window (e.g. 22:00 -> 06:00)
  return current >= start || current <= end;
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`קובץ config.json לא נמצא בנתיב: ${configPath}`);
  }
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!cfg.targetUrl) {
    throw new Error('config.json must specify "targetUrl"');
  }
  return cfg;
}

function resolveProxies(cfg) {
  if (!cfg.proxy?.enabled) return [];
  if (isLoopbackUrl(cfg.targetUrl)) {
    console.log(`[Proxy] יעד מקומי (${cfg.targetUrl}) אינו עובר דרך Proxy מרוחק — מדלג על רוטציית פרוקסי לריצה זו.`);
    return [];
  }
  const list = Array.isArray(cfg.proxy?.servers) && cfg.proxy.servers.length
    ? cfg.proxy.servers
    : readProxiesTxt();
  const normalized = [];
  for (const raw of list) {
    try {
      const n = normalizeProxyLine(typeof raw === 'string' ? raw : raw?.server);
      if (n) normalized.push(n);
    } catch {}
  }
  return normalized;
}

function sendIpc(payload) {
  if (typeof process.send === 'function') {
    try {
      process.send(payload);
    } catch {}
  }
}

async function executeVisitWorkload({
  page,
  cfgVars,
  persona,
  visitIndex,
  alreadyNavigated = false,
  initialStatus = 'n/a',
  initialLoadMs = 0,
  initialReferer = '',
  precomputedChildPlan = null,
}) {
  const {
    targetUrl,
    pages,
    firstPagePriority,
    pageMinMs,
    snippet,
    taskMode,
    taskSteps,
    headless,
    keepBrowserOpenMs,
    adSafety,
    visitCount,
    wavesCfg,
    aiConfig,
    runtimeState,
  } = cfgVars;
  const onFrame = frame => {
    if (runtimeState?.previewActive === false) return;
    sendIpc({ type: 'live_frame', data: frame });
  };
  const onStep = msg => console.log(msg);

  let combined = {
    status: initialStatus,
    loadMs: initialLoadMs,
    pagesVisited: 0,
    pageErrors: 0,
    errorDetails: [],
    visitedUrls: [],
    stepResults: [],
    waveSummary: null,
  };

  let effectiveSteps = taskSteps;
  let waveSummary = null;
  if ((taskMode === 'scenario' || taskMode === 'hybrid') && taskSteps.length > 0) {
    const childPlan = precomputedChildPlan || buildChildJourney({
      baseSteps: taskSteps,
      pages,
      wavesCfg,
      visitIndex,
      totalPlanned: visitCount,
      persona,
      aiCfg: aiConfig,
      targetUrl,
      runtimeState,
    });
    effectiveSteps = childPlan.steps;
    waveSummary = childPlan.summary;
    combined.waveSummary = waveSummary;
    if (wavesCfg?.enabled && waveSummary) {
      const extras = [
        waveSummary.scanProductsAdded ? '+סריקת מוצרים' : '',
        waveSummary.extraPage ? `+עמוד(${waveSummary.extraPage})` : '',
        waveSummary.formMutatedCount ? `+טפסים(${waveSummary.formMutatedCount})` : '',
        waveSummary.aiAdded ? `+מוח AI(${waveSummary.squadWorkerModel || 'auto'})` : '',
      ].filter(Boolean).join(' ');
      const squadLabel = waveSummary.squadName ? ` | ${waveSummary.squadName}` : '';
      const fullTag = waveSummary.recordingAnalysis?.hasEmailFlow ? ' 🎯[מסלול המרה+רישום מייל]' : ' 🎯[מסלול מוקלט מלא]';
      const convTag = waveSummary.isConverter === true ? fullTag : (waveSummary.isConverter === false ? ' 🌿[גלישה אורגנית באתר]' : '');
      console.log(`[Wave #${waveSummary.waveNumber}${squadLabel} | ילד #${visitIndex + 1}] נוצר מסלול דינמי (${effectiveSteps.length} צעדים) ${extras}${convTag}`);
    }

    const scenRes = await executeTaskSteps({
      page,
      targetUrl,
      steps: effectiveSteps,
      snippet,
      visitIndex,
      personaName: persona.name,
      alreadyNavigated,
      initialStatus,
      initialLoadMs,
      initialReferer,
      adSafety,
      aiConfig,
      aiDirective: runtimeState?.aiDirective || aiConfig?.commanderDirective || '',
      staySameOrigin: waveSummary?.isConverter === false,
      onFrame,
      onStep,
      attribution: cfgVars.attribution,
    });
    combined = { ...combined, ...scenRes, waveSummary };
  }

  if (taskMode === 'behavior' || taskMode === 'hybrid' || (taskMode === 'scenario' && taskSteps.length === 0)) {
    const stayAlreadyNavigated = alreadyNavigated || (taskMode === 'hybrid' && taskSteps.length > 0);
    const behRes = await runVisitInteractions({
      page,
      targetUrl,
      pages,
      firstPagePriority,
      pageMinMs,
      persona,
      snippet,
      visitIndex,
      alreadyNavigated: stayAlreadyNavigated,
      initialStatus: combined.status,
      initialLoadMs: combined.loadMs,
      initialReferer,
      adSafety,
      onFrame,
      onStep,
    });
    combined = {
      status: combined.status !== 'n/a' ? combined.status : behRes.status,
      loadMs: combined.loadMs || behRes.loadMs,
      pagesVisited: combined.pagesVisited + behRes.pagesVisited - (taskMode === 'hybrid' && taskSteps.length > 0 ? 1 : 0),
      pageErrors: combined.pageErrors + behRes.pageErrors,
      errorDetails: [...new Set([...combined.errorDetails, ...(behRes.errorDetails || [])])].slice(0, 25),
      visitedUrls: [...combined.visitedUrls, ...(behRes.visitedUrls || [])],
      stepResults: combined.stepResults,
      waveSummary: combined.waveSummary,
    };

    if (taskSteps.length === 0 && wavesCfg?.enabled && Math.random() * 100 < (wavesCfg.scanProductsChance ?? 60)) {
      const msg = await runScanProductsStep(page, { value: String(wavesCfg.maxProductsPerVisit || 2) }, {
        avoidAdClicks: Boolean(adSafety?.avoidAdClicks),
        dismissOverlays: adSafety?.dismissOverlays !== false,
      }).catch(() => null);
      if (msg) {
        combined.stepResults.push({
          index: combined.stepResults.length + 1,
          type: 'scan_products',
          label: `ילד-גל #${visitIndex + 1}: סריקת מוצרים`,
          ok: true,
          durationMs: 0,
          detail: msg,
        });
      }
    }

    if (taskSteps.length === 0 && aiConfig?.enabled && Number(aiConfig.workerPct || 0) > 0 && Math.random() * 100 < Number(aiConfig.workerPct || 0)) {
      const aiMsg = await runAiExploreStep(page, { value: '2', label: runtimeState?.aiDirective || aiConfig.commanderDirective || '' }, {
        avoidAdClicks: Boolean(adSafety?.avoidAdClicks),
        dismissOverlays: adSafety?.dismissOverlays !== false,
        aiConfig,
        aiDirective: runtimeState?.aiDirective || aiConfig.commanderDirective || '',
      }).catch(() => null);
      if (aiMsg) {
        combined.stepResults.push({
          index: combined.stepResults.length + 1,
          type: 'ai_explore',
          label: 'סוכן AI אוטונומי',
          ok: true,
          durationMs: 0,
          detail: aiMsg,
        });
      }
    }
  }

  if (!headless && keepBrowserOpenMs > 0) {
    await sleep(keepBrowserOpenMs);
  } else {
    await sleep(900);
  }
  return combined;
}

function logVisitOutcome(i, persona, deviceLabel, engineLabel, result, sessionTag, proxyTag, metaExtra = {}) {
  console.log(
    `[${i + 1}] Done — persona: ${persona.name}, device: ${deviceLabel} (${engineLabel}), status: ${result.status}, load: ${result.loadMs}ms, pages: ${result.pagesVisited}, errors: ${result.pageErrors}${sessionTag}${proxyTag}`
  );
  if (Array.isArray(result.visitedUrls) && result.visitedUrls.length) {
    const trail = result.visitedUrls.map(v => `${v.path} (${v.status})`).join(' -> ');
    console.log(`  ↳ מסלול: ${trail}`);
  }
  if (Array.isArray(result.errorDetails) && result.errorDetails.length) {
    console.log(`  ↳ פירוט שגיאות (${result.errorDetails.length}): ${result.errorDetails.slice(0, 4).join(' | ')}`);
  }
  sendIpc({
    type: 'visit_detail',
    data: {
      visitNumber: i + 1,
      persona: persona.name,
      device: `${deviceLabel} (${engineLabel})`,
      status: result.status,
      loadMs: result.loadMs,
      pagesVisited: result.pagesVisited,
      pageErrors: result.pageErrors,
      visitedUrls: result.visitedUrls || [],
      errorDetails: result.errorDetails || [],
      stepResults: result.stepResults || [],
      skippedSteps: Number(result.skippedSteps || 0),
      country: metaExtra.country || null,
      waveSummary: result.waveSummary || null,
      ts: new Date().toISOString(),
    },
  });
}

function logVisitFailure(visitIndex, persona, err, stats) {
  const num = Number.isFinite(Number(visitIndex)) ? Number(visitIndex) + 1 : '?';
  stats.completed++;
  const isTimeout = err?.name === 'TimeoutError' || String(err?.message || '').includes('timeout');
  if (isTimeout) {
    stats.timedOut++;
    console.log(`[${num}] Timed out, ending session`);
  } else {
    stats.failed++;
    console.error(`[${num}] Failed:`, err?.message || String(err));
  }
  sendIpc({
    type: 'visit_detail',
    data: {
      visitNumber: num,
      persona: persona?.name || 'unknown',
      device: '-',
      status: isTimeout ? 'TIMEOUT' : 'FAIL',
      loadMs: 0,
      pagesVisited: 0,
      pageErrors: 1,
      visitedUrls: [],
      errorDetails: [err?.message || String(err)],
      stepResults: [],
      ts: new Date().toISOString(),
    },
  });
}

async function run() {
  const configPath = process.argv[2] || DEFAULT_CONFIG_PATH;
  const cfg = loadConfig(configPath);
  console.log(`Loaded config: ${configPath}`);

  const targetUrl = cfg.targetUrl.replace(/\/$/, '');
  const pages = normalizePages(cfg.pages);
  const visitCount = Math.max(1, parseInt(String(process.env.VISIT_COUNT_OVERRIDE ?? cfg.visitCount ?? 10), 10) || 10);
  const maxConcurrency = Math.max(1, parseInt(String(process.env.CONCURRENCY ?? cfg.concurrency ?? 5), 10) || 5);
  const minConcurrency = Math.min(maxConcurrency, Math.max(1, parseInt(String(cfg.minConcurrency ?? 1), 10) || 1));
  const firstPagePriority = Math.min(100, Math.max(0, Number(cfg.firstPagePriority ?? 60)));
  const minStepsTimeout = Array.isArray(cfg.taskSteps) ? cfg.taskSteps.length * 8000 : 0;
  const sessionTimeoutMs = Math.max(5000, Number(cfg.sessionTimeoutMs ?? 90000), minStepsTimeout);
  const pageMinMs = Math.max(0, Number(cfg.pageMinMs ?? 4000));
  const stealthMode = cfg.stealthMode === 'maximum' ? 'maximum' : 'standard';
  let resourceMode = ['full', 'lite', 'ultra_lite', 'browserless_cdp', 'lightpanda_cdp'].includes(cfg.resourceMode)
    ? cfg.resourceMode
    : 'ultra_lite';
  let headless = cfg.headless !== false;
  const isMultiScaleRun = visitCount >= 3 || maxConcurrency >= 2;
  if (isMultiScaleRun && resourceMode === 'full') {
    resourceMode = 'lite';
    try {
      cfg.resourceMode = 'lite';
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    } catch {}
  }
  if (!headless && (['lite', 'ultra_lite', 'browserless_cdp', 'lightpanda_cdp'].includes(resourceMode) || (isMultiScaleRun && process.env.FORCE_PHYSICAL_WINDOWS !== '1'))) {
    headless = true;
    try {
      cfg.headless = true;
      cfg.resourceMode = resourceMode;
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    } catch {}
    console.log('[RAM & Background Mode] מצב חיסכון זיכרון פעיל — הדפדפנים רצים ברקע (Headless) ללא חלונות פיזיים, והתצוגה החיה משודרת למסך הדאשבורד!');
  }
  const engineMode = cfg.engineMode === 'crawlee_playwright' ? 'crawlee_playwright' : 'crawlee_autoscaled';
  const personas = normalizePersonas(cfg.personas);
  const deviceWeights = cfg.devices || {};
  const snippet = cfg.snippet || null;
  const schedule = cfg.schedule || { enabled: false, startHour: '00:00', endHour: '23:59' };
  const taskMode = ['behavior', 'scenario', 'hybrid'].includes(cfg.taskMode) ? cfg.taskMode : 'behavior';
  const referrerMode = cfg.referrerMode === 'google_organic' ? 'google_organic' : 'mixed';
  const taskSteps = Array.isArray(cfg.taskSteps) ? cfg.taskSteps : [];
  const keepBrowserOpenMs = Math.max(0, Math.min(30000, Number(cfg.keepBrowserOpenMs ?? 1500) || 0));
  const interVisitDelayMs = Math.max(0, Math.min(120000, Number(cfg.interVisitDelayMs ?? 0) || 0));
  const adSafety = {
    avoidAdClicks: cfg.adSafety?.avoidAdClicks !== false,
    dismissOverlays: cfg.adSafety?.dismissOverlays !== false,
    closePopunders: cfg.adSafety?.closePopunders !== false,
    skipTelemetryHeader: Boolean(cfg.adSafety?.skipTelemetryHeader),
  };
  const wavesCfg = {
    enabled: Boolean(cfg.waves?.enabled),
    mode: cfg.waves?.mode || 'natural_peaks',
    conversionRate: Number(cfg.waves?.conversionRate ?? 25),
    childMutationRate: Number(cfg.waves?.childMutationRate ?? 75),
    scanProductsChance: Number(cfg.waves?.scanProductsChance ?? 65),
    extraPageChance: Number(cfg.waves?.extraPageChance ?? 40),
    mutateForms: cfg.waves?.mutateForms !== false,
    maxProductsPerVisit: Number(cfg.waves?.maxProductsPerVisit ?? 2),
    formInputs: cfg.waves?.formInputs || [],
  };
  const aiConfig = {
    enabled: Boolean(cfg.ai?.enabled),
    provider: cfg.ai?.provider || 'auto',
    commanderModel: cfg.ai?.commanderModel || 'glm-5.3-flash',
    workerModel: cfg.ai?.workerModel || 'deepseek-v4.1-flash',
    workerPct: Number(cfg.ai?.workerPct ?? 0),
    commanderDirective: cfg.ai?.commanderDirective || '',
  };
  const runtimeState = {
    aiDirective: aiConfig.commanderDirective || '',
    workerPct: aiConfig.workerPct,
    resourceMode,
    interVisitDelayMs,
    previewActive: true,
    preferredCountries: Array.isArray(cfg.proxy?.preferredCountries) ? cfg.proxy.preferredCountries : [],
    squadModels: {
      alpha: 'deepseek-v4.1-flash',
      bravo: 'beam',
      charlie: 'minimax-m3.1-flash',
      delta: 'gpt-oss:20b',
    },
  };

  const originExtraHeaders = buildAdSafetyHeaders(adSafety);
  const attributionCfg = {
    lockerDwellMs: Number(cfg.attribution?.lockerDwellMs ?? 9500),
    closeSettleMs: Number(cfg.attribution?.closeSettleMs ?? 2800),
  };
  const cfgVars = {
    targetUrl,
    pages,
    firstPagePriority,
    pageMinMs,
    snippet,
    taskMode,
    taskSteps,
    headless,
    keepBrowserOpenMs,
    adSafety,
    visitCount,
    wavesCfg,
    aiConfig,
    runtimeState,
    attribution: attributionCfg,
  };

  const sessionCfg = {
    enabled: Boolean(cfg.sessionPersistence?.enabled),
    returningUserRate: Number(cfg.sessionPersistence?.returningUserRate ?? 50),
    profilePoolSize: Number(cfg.sessionPersistence?.profilePoolSize ?? 10),
    profilesDir: PROFILES_DIR,
  };

  const rawProxyUrls = resolveProxies(cfg);
  let proxyUrls = rawProxyUrls;
  let proxyCountryByUrl = {};
  const fallbackProxyUrls = (cfg.proxy?.enabled && cfg.proxy?.fallbackToStatic !== false && rawProxyUrls.length)
    ? readFallbackProxiesTxt()
    : [];
  const filterFallbackProxies = async list => {
    const sel = await selectProxiesForCountries(list, {
      preferredCountries: cfg.proxy?.preferredCountries,
      countryFilterEnabled: cfg.proxy?.countryFilterEnabled !== false,
      fallbackToAnyIfEmpty: true,
    });
    return sel.proxies;
  };
  let startedOnFallback = false;
  if (rawProxyUrls.length) {
    const countrySel = await selectProxiesForCountries(rawProxyUrls, {
      preferredCountries: cfg.proxy?.preferredCountries,
      countryFilterEnabled: cfg.proxy?.countryFilterEnabled !== false,
      fallbackToAnyIfEmpty: cfg.proxy?.fallbackToAnyIfEmpty !== false,
    });
    proxyUrls = countrySel.proxies;
    proxyCountryByUrl = countrySel.countryByUrl || {};
    const prefList = Array.isArray(cfg.proxy?.preferredCountries) ? cfg.proxy.preferredCountries.join(',') : 'Tier-1';
    if (countrySel.fallbackUsed) {
      console.log(`[Proxy Geo] לא נמצאו פרוקסי תואמים למדינות (${prefList}) — משתמש בגיבוי בכל ${proxyUrls.length} השרתים הזמינים.`);
    } else if (cfg.proxy?.countryFilterEnabled !== false) {
      console.log(`[Proxy Geo] סוננו ${proxyUrls.length}/${countrySel.totalCount} פרוקסי למדינות מועדפות (${prefList}).`);
    }
    if (proxyUrls.length) {
      const doFullPrefilter = cfg.proxy?.prefilter !== false && proxyUrls.length > 1;
      const probeTargets = doFullPrefilter ? proxyUrls : proxyUrls.slice(0, 1);
      console.log(`[Proxy Prefilter] בודק ${probeTargets.length} פרוקסים (עד 16 במקביל, תמלית 5.5 שניות) לפני ההרצה...`);
      const probeResults = [];
      let probeCursor = 0;
      const probeWorkers = Array.from({ length: Math.min(16, probeTargets.length) }, async () => {
        while (true) {
          const idx = probeCursor++;
          if (idx >= probeTargets.length) return;
          probeResults[idx] = await checkSingleProxy(probeTargets[idx], 5500).catch(() => null);
        }
      });
      // Deterministic full-pool prefilter (fix: 26 timeouts in run 2026-11-16T20:10 — dead/slow US proxies)
      await Promise.all(probeWorkers);
      let prefilterKeptAlive = false;
      if (doFullPrefilter) {
        const beforeCount = proxyUrls.length;
        const slowCutMs = Number(cfg.proxy?.prefilterMaxLatencyMs ?? 2600);
        const healthy = [];
        const rejectedSummary = {};
        proxyUrls.forEach((p, idx) => {
          const r = probeResults[idx];
          if (r && r.ok && (r.latencyMs == null || r.latencyMs <= slowCutMs)) {
            healthy.push(p);
          } else {
            const reason = r && !r.ok ? String(r.error || 'Unreachable').slice(0, 60) : `slow>${slowCutMs}ms`;
            rejectedSummary[reason] = (rejectedSummary[reason] || 0) + 1;
          }
        });
        if (healthy.length) {
          proxyUrls = healthy;
          prefilterKeptAlive = true;
          const detail = Object.entries(rejectedSummary).map(([reason, count]) => `${reason}×${count}`).slice(0, 6).join(', ').slice(0, 180);
          console.log(`[Proxy Prefilter] נשמרו ${healthy.length}/${beforeCount} פרוקסים פעילים (נופו: ${detail}).`);
        } else {
          console.log(`[Proxy Prefilter] אף פרוקסי לא עבר סינון — נשארת עם הכל (${beforeCount}) והלוגיקה של מכסה/כשל תיכנס בהמשך.`);
        }
      }
      const anyAlive = (doFullPrefilter && prefilterKeptAlive) || probeResults.some(r => r && r.ok);
      if (!anyAlive) {
        const errReasons = [...new Set(probeResults.map(r => r?.error || 'Unreachable'))].join(', ');
        if (fallbackProxyUrls.length) {
          const fbList = await filterFallbackProxies(fallbackProxyUrls).catch(() => fallbackProxyUrls);
          const fbProbe = fbList.length ? await checkSingleProxy(fbList[0], 5500) : null;
          if (fbProbe && fbProbe.ok) {
            proxyUrls = fbList;
            startedOnFallback = true;
            console.log(
              `🔁 [Proxy Failover] הפרוקסי הראשי אינו זמין (${errReasons}) — עובר אוטומטית לגיבוי Static (${fbList.length} כתובות).`
            );
          }
        }
        if (!startedOnFallback) {
          if (errReasons.includes('402')) {
            console.log(
              `⚠️ [Proxy Alert — HTTP 402] מכסת הנתונים בשרתי Webshare הסתיימה (${errReasons})! עובר אוטומטית לחיבור ישיר כדי שההרצה לא תיכשל ב-ERR_TUNNEL_CONNECTION_FAILED.`
            );
          } else {
            console.log(
              `⚠️ [Proxy Alert] שרתי הפרוקסי אינם מגיבים כעת (${errReasons}) — עובר אוטומטית לחיבור ישיר להמשך ההרצה.`
            );
          }
          proxyUrls = [];
        }
      }
    }
  }
  const proxyPool = createFailoverProxyPool(proxyUrls, startedOnFallback ? [] : fallbackProxyUrls, {
    filterFallback: filterFallbackProxies,
    onSwitch: (list, reason) => {
      proxyUrls = list;
      console.log(
        `🔁 [Proxy Failover] הפרוקסי הראשי נכשל באימות/מכסה (${reason}) — עברנו אוטומטית לגיבוי Static (${list.length} כתובות). ההרצה ממשיכה בלי עצירה.`
      );
    },
  });
  const proxyConfiguration = proxyUrls.length ? proxyPool.proxyConfiguration : null;
  const proxyMode = cfg.proxy?.mode === 'random' ? 'random' : 'round_robin';

  try { resetRunInboxFile(); } catch (resetErr) { console.log(`[Email] run-inboxes reset skipped: ${String(resetErr?.message || resetErr).slice(0, 80)}`); }
  console.log(
    `Engine: ${engineMode} | Visits: ${visitCount} | Concurrency: ${minConcurrency}-${maxConcurrency} | Headless: ${headless} | Stealth: ${stealthMode} | RAM: ${resourceMode} | Waves: ${wavesCfg.enabled ? wavesCfg.mode : 'off'} | Proxies: ${proxyUrls.length}`
  );
  try {
    const cdpSt = getCdpIntegrationsStatus();
    if (cdpSt.browserless.installed || cdpSt.lightpanda.installed) {
      console.log(
        `[GitHub Engines] מחוברים: Browserless CDP Pool (${cdpSt.browserless.version || 'active'}) + Lightpanda Ultra-Light (${cdpSt.lightpanda.version || 'active'})`
      );
    }
  } catch {}

  const stats = {
    totalPlanned: visitCount,
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
    proxyTransferBytes: 0,
    returningSessions: 0,
    newSessions: 0,
    loadTimesMs: [],
    currentConcurrency: 0,
    desiredConcurrency: minConcurrency,
    minConcurrency,
    maxConcurrency,
    paused: false,
    waitingForSchedule: false,
    memUsedPct: 0,
    freeRamGb: 0,
    isSystemOverloaded: false,
  };

  let userPaused = false;
  let schedulePaused = !isWithinActiveHours(schedule);
  let aborted = false;
  let activePoolRef = null;

  const syncPauseState = async () => {
    const shouldPause = userPaused || schedulePaused;
    stats.paused = userPaused;
    stats.waitingForSchedule = schedulePaused;
    if (!activePoolRef) return;
    if (shouldPause) {
      await activePoolRef.pause().catch(() => {});
    } else {
      activePoolRef.resume();
    }
  };

  process.on('message', async msg => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'pause') {
      userPaused = true;
      console.log('[Control] ההרצה הושהתה (Paused) — מסיים סשנים פעילים ומקפיא תור...');
      await syncPauseState();
    } else if (msg.type === 'resume') {
      userPaused = false;
      console.log('[Control] ההרצה חודשה (Resumed).');
      await syncPauseState();
    } else if (msg.type === 'stop') {
      aborted = true;
      console.log('[Control] מתבצעת עצירה מבוקרת של Crawlee Pool...');
      if (activePoolRef) await activePoolRef.abort().catch(() => {});
    } else if (msg.type === 'set_concurrency') {
      const nextMax = Math.max(1, Math.min(32, Number(msg.max) || maxConcurrency));
      const nextMin = Math.max(1, Math.min(nextMax, Number(msg.min) || minConcurrency));
      stats.minConcurrency = nextMin;
      stats.maxConcurrency = nextMax;
      if (activePoolRef) {
        activePoolRef.minConcurrency = nextMin;
        activePoolRef.maxConcurrency = nextMax;
        activePoolRef.desiredConcurrency = Math.min(nextMax, Math.max(nextMin, activePoolRef.desiredConcurrency || nextMin));
      }
      console.log(`[AI Commander] עודכן טווח מקביליות חי ל-${nextMin}–${nextMax}.`);
    } else if (msg.type === 'set_wave_mode' && typeof msg.mode === 'string') {
      wavesCfg.enabled = msg.mode !== 'off';
      wavesCfg.mode = msg.mode;
      console.log(`[AI Commander] עודכן מצב גלים חי ל-${msg.mode}.`);
    } else if (msg.type === 'ai_directive') {
      runtimeState.aiDirective = String(msg.directive || '').trim();
      aiConfig.enabled = true;
      console.log(`[AI Commander] הועברה הנחיית משימה חיה לסוכנים: ${runtimeState.aiDirective || '(ריענון)'}`);
    } else if (msg.type === 'set_worker_pct' && msg.pct != null) {
      const pct = Math.max(0, Math.min(100, Math.round(Number(msg.pct) || 0)));
      aiConfig.enabled = pct > 0;
      aiConfig.workerPct = pct;
      runtimeState.workerPct = pct;
      console.log(`[AI Commander] עודכן שיעור מעורבות מוח AI לסוכנים ל-${pct}%.`);
    } else if (msg.type === 'set_resource_mode' && typeof msg.mode === 'string') {
      if (['full', 'lite', 'ultra_lite'].includes(msg.mode)) {
        runtimeState.resourceMode = msg.mode;
        console.log(`[AI Commander] עודכן מצב משאבים ופרוקסי חי ל-${msg.mode}.`);
      }
    } else if (msg.type === 'set_conversion_rate' && msg.rate != null) {
      const rate = Math.max(0, Math.min(100, Math.round(Number(msg.rate) || 0)));
      wavesCfg.conversionRate = rate;
      console.log(`[AI Commander] עודכן יחס המרות חי ל-${rate}%.`);
    } else if (msg.type === 'set_exploration') {
      if (msg.extraPageChance != null) wavesCfg.extraPageChance = Math.max(0, Math.min(100, Math.round(Number(msg.extraPageChance) || 0)));
      if (msg.scanProductsChance != null) wavesCfg.scanProductsChance = Math.max(0, Math.min(100, Math.round(Number(msg.scanProductsChance) || 0)));
      if (msg.maxProducts != null) wavesCfg.maxProductsPerVisit = Math.max(1, Math.min(4, Math.round(Number(msg.maxProducts) || 2)));
      console.log(`[AI Commander] עודכנו פרמטרי חקירה: דפים=${wavesCfg.extraPageChance}%, סריקה=${wavesCfg.scanProductsChance}%, פריטים=${wavesCfg.maxProductsPerVisit}.`);
    } else if (msg.type === 'set_delays' && msg.interVisitDelayMs != null) {
      runtimeState.interVisitDelayMs = Math.max(0, Math.min(60000, Math.round(Number(msg.interVisitDelayMs) || 0)));
      console.log(`[AI Commander] עודכנה השהייה בין ביקורים ל-${runtimeState.interVisitDelayMs}ms.`);
    } else if (msg.type === 'update_task_steps' && Array.isArray(msg.taskSteps)) {
      taskSteps.splice(0, taskSteps.length, ...msg.taskSteps);
      cfgVars.taskSteps = taskSteps;
      console.log(`[AI Commander] עודכנו ${taskSteps.length} צעדי תרחיש בשידור חי עבור הביקורים הבאים.`);
    } else if (msg.type === 'set_preview_active') {
      runtimeState.previewActive = msg.active !== false;
    } else if (msg.type === 'set_task_mode' && ['scenario', 'hybrid', 'behavior'].includes(msg.mode)) {
      cfgVars.taskMode = msg.mode;
      console.log(`[AI Commander] מצב המשימה עודכן חי ל-${msg.mode}.`);
    } else if (msg.type === 'update_runtime_config' && msg.config && typeof msg.config === 'object') {
      const nc = msg.config;
      if (Array.isArray(nc.taskSteps)) {
        taskSteps.splice(0, taskSteps.length, ...nc.taskSteps);
        cfgVars.taskSteps = taskSteps;
      }
      if (Array.isArray(nc.pages)) cfgVars.pages = normalizePages(nc.pages);
      if (nc.taskMode) cfgVars.taskMode = nc.taskMode;
      if (nc.pageMinMs != null) cfgVars.pageMinMs = Number(nc.pageMinMs) || cfgVars.pageMinMs;
      if (nc.keepBrowserOpenMs != null) cfgVars.keepBrowserOpenMs = Number(nc.keepBrowserOpenMs) || cfgVars.keepBrowserOpenMs;
      if (nc.interVisitDelayMs != null) runtimeState.interVisitDelayMs = Number(nc.interVisitDelayMs) || 0;
      if (nc.firstPagePriority != null) cfgVars.firstPagePriority = Number(nc.firstPagePriority);
      if (nc.resourceMode) runtimeState.resourceMode = nc.resourceMode;
      if (nc.waves && typeof nc.waves === 'object') Object.assign(wavesCfg, nc.waves);
      if (nc.ai && typeof nc.ai === 'object') {
        Object.assign(aiConfig, nc.ai);
        if (nc.ai.workerPct != null) runtimeState.workerPct = Number(nc.ai.workerPct) || 0;
        if (typeof nc.ai.commanderDirective === 'string') runtimeState.aiDirective = nc.ai.commanderDirective;
      }
      if (nc.adSafety && typeof nc.adSafety === 'object') Object.assign(adSafety, nc.adSafety);
      if (nc.devices && typeof nc.devices === 'object') Object.assign(deviceWeights, nc.devices);
      console.log('[AI Commander] כל הגדרות הקונפיגורציה סונכרנו בשידור חי לצי.');
    } else if (msg.type === 'assign_squad_model' && typeof msg.model === 'string') {
      const targetSquad = ['alpha', 'bravo', 'charlie', 'delta', 'all'].includes(msg.squadId) ? msg.squadId : 'all';
      const cleanModel = msg.model.trim().slice(0, 80);
      if (cleanModel) {
        if (targetSquad === 'all') {
          for (const k of ['alpha', 'bravo', 'charlie', 'delta']) runtimeState.squadModels[k] = cleanModel;
        } else {
          runtimeState.squadModels[targetSquad] = cleanModel;
        }
        console.log(`[AI Commander] מודל מחלקת ${targetSquad} עודכן בשידור חי ל-${cleanModel}.`);
      }
    }
  });

  const emitTelemetry = (systemStatusObj = null) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    stats.memUsedPct = Math.round(((totalMem - freeMem) / totalMem) * 100);
    stats.freeRamGb = Number((freeMem / 1024 ** 3).toFixed(2));
    if (activePoolRef) {
      stats.currentConcurrency = activePoolRef.currentConcurrency || 0;
      stats.desiredConcurrency = activePoolRef.desiredConcurrency || minConcurrency;
    }
    if (systemStatusObj) {
      stats.isSystemOverloaded = !systemStatusObj.isSystemIdle;
    }
    const avgLoadMs = stats.loadTimesMs.length
      ? Math.round(stats.loadTimesMs.reduce((a, b) => a + b, 0) / stats.loadTimesMs.length)
      : null;
    const ps = getProxySaverStats();
    const aiSt = getAiTokenSaverStats();
    const { loadTimesMs: _omit, proxyTransferBytes: rawBytes, ...clean } = stats;
    sendIpc({
      type: 'telemetry',
      data: {
        ...clean,
        avgLoadMs,
        proxyTransferMb: Number((rawBytes / (1024 * 1024)).toFixed(2)),
        proxySavedMb: ps.savedMb || 0,
        proxyCacheHits: ps.cacheHits || 0,
        proxyBlockedRequests: ps.blockedRequests || 0,
        aiApiCalls: aiSt.apiCalls || 0,
        aiCacheHits: aiSt.cacheHits || 0,
        aiRecoveryCalls: aiSt.recoveryCalls || 0,
        aiSavedTokens: aiSt.estimatedTokensSaved || 0,
        activeWorkerPct: runtimeState.workerPct,
        activeResourceMode: runtimeState.resourceMode,
        activeConversionRate: wavesCfg.conversionRate,
        activeSquadModels: { ...runtimeState.squadModels },
      },
    });
  };

  if (schedulePaused) {
    console.log(`[Schedule] השעה הנוכחית מחוץ לחלון הפעילות (${schedule.startHour}-${schedule.endHour}). ממתין לפתיחת החלון...`);
  }

  // ── Mode A: Crawlee AutoscaledPool + Multi-Engine + FingerprintSuite + Persistent Contexts ──
  if (engineMode === 'crawlee_autoscaled') {
    let nextVisitIndex = 0;
    let inFlight = 0;
    let nextSlotStartAt = 0;
    let totalTransferBytes = 0;

    const pool = new AutoscaledPool({
      minConcurrency,
      maxConcurrency,
      desiredConcurrency: Math.min(maxConcurrency, Math.max(minConcurrency, Math.min(3, maxConcurrency))),
      autoscaleIntervalSecs: 2,
      loggingIntervalSecs: null,
      snapshotterOptions: {
        maxBlockedMillis: 250,
        maxUsedMemoryRatio: 0.98,
      },
      systemStatusOptions: {
        maxMemoryOverloadedRatio: 0.9,
        maxCpuOverloadedRatio: 0.95,
      },
      isTaskReadyFunction: async () => {
        if (aborted || userPaused || schedulePaused) return false;
        const freeGbNow = os.freemem() / (1024 ** 3);
        if (inFlight >= 2 && freeGbNow < 0.45) return false;
        return nextVisitIndex < visitCount;
      },
      isFinishedFunction: async () => {
        if (aborted && inFlight === 0) return true;
        return nextVisitIndex >= visitCount && inFlight === 0;
      },
      runTaskFunction: async () => {
        if (aborted || nextVisitIndex >= visitCount) return;
        const i = nextVisitIndex++;
        inFlight++;

        const persona = randomChoice(personas);
        let retried = false;
        while (true) {
        let selectedProxyUrl = null;
        if (proxyConfiguration) {
          selectedProxyUrl = proxyMode === 'random'
            ? randomChoice(proxyUrls)
            : await proxyConfiguration.newUrl(retried ? `visit-${i}-retry2` : `visit-${i}`);
        }
        const proxyObj = toPlaywrightProxy(selectedProxyUrl);
        const geo = await resolveNetworkGeo(selectedProxyUrl).catch(() => null);
        const referrer = referrerMode === 'google_organic'
          ? buildGoogleSearchReferrer(geo)
          : buildRandomReferrer(targetUrl);
        const sessionSlot = acquireProfileSlot({
          ...sessionCfg,
          countryCode: geo?.countryCode || null,
          locale: geo?.locale || null,
        });

        let sessionHandle = null;
        let killTimer = null;
        let stopPopunderShield = null;
        let sessionTransferBytes = 0;
        let onRespSize = null;

        const pacing = computeWavePacing({
          wavesCfg,
          visitIndex: i,
          totalPlanned: visitCount,
          baseDelayMs: runtimeState.interVisitDelayMs ?? interVisitDelayMs,
          baseMinConcurrency: stats.minConcurrency,
          baseMaxConcurrency: stats.maxConcurrency,
        });
        if (wavesCfg.enabled && activePoolRef && pacing.targetMaxConcurrency) {
          activePoolRef.desiredConcurrency = Math.min(
            stats.maxConcurrency,
            Math.max(stats.minConcurrency, pacing.targetMaxConcurrency)
          );
        }

        try {
          if (i > 0 && pacing.recommendedDelayMs > 0 && !aborted) {
            const now = Date.now();
            const waitUntil = Math.max(now, nextSlotStartAt) + pacing.recommendedDelayMs;
            nextSlotStartAt = waitUntil;
            const waitMs = Math.min(120000, Math.max(0, waitUntil - now));
            if (waitMs > 0) await sleep(waitMs);
          }
          if (aborted) return;

          const precomputedChildPlan = (taskMode === 'scenario' || taskMode === 'hybrid') && taskSteps.length > 0
            ? buildChildJourney({
                baseSteps: taskSteps,
                pages,
                wavesCfg,
                visitIndex: i,
                totalPlanned: visitCount,
                persona,
                aiCfg: aiConfig,
                targetUrl,
                runtimeState,
              })
            : null;
          // Organic (!isConverter) visits use ultra_lite automatically when lite is selected to maximize proxy bandwidth savings
          const baseResMode = runtimeState.resourceMode || resourceMode;
          const effectiveResourceMode = (precomputedChildPlan?.summary?.isConverter === false && baseResMode === 'lite')
            ? 'ultra_lite'
            : baseResMode;

          sessionHandle = await openSessionContext({
            deviceWeights,
            headless,
            proxy: proxyObj,
            sessionSlot,
            referrer,
            geo,
            stealthMode,
            resourceMode: effectiveResourceMode,
            sessionSeed: i + 100,
          });

          onRespSize = async req => {
            try {
              const resp = await req.response().catch(() => null);
              if (resp && resp.headers?.()['x-wtg-cache'] === '1') return;
              const s = await req.sizes();
              const wire = (s?.responseBodySize || 0) + (s?.responseHeadersSize || 0);
              if (wire > 0) {
                sessionTransferBytes += wire;
                return;
              }
              const len = Number(resp?.headers?.()['content-length'] || 0);
              if (Number.isFinite(len) && len > 0) sessionTransferBytes += len;
            } catch {}
          };
          sessionHandle.page.on('requestfinished', onRespSize);
          sessionHandle.context.on('page', extraTab => {
            extraTab.on('requestfinished', onRespSize);
          });

          if (Object.keys(originExtraHeaders).length) {
            await applyOriginScopedHeaders(sessionHandle.context, targetUrl, originExtraHeaders);
          }
          stopPopunderShield = installPopunderShield(
            sessionHandle.context,
            sessionHandle.page,
            adSafety.closePopunders,
            msg => console.log(`[${i + 1}] ${msg}`)
          );

          killTimer = setTimeout(() => {
            sessionHandle?.close().catch(() => {});
          }, sessionTimeoutMs);

          const result = await executeVisitWorkload({
            page: sessionHandle.page,
            cfgVars,
            persona,
            visitIndex: i,
            initialReferer: sessionHandle.referrer || referrer,
            precomputedChildPlan,
          });

          stats.completed++;
          stats.succeeded++;
          stats.errorsTotal += result.pageErrors;
          stats.loadTimesMs.push(result.loadMs);
          if (result.loadMs > 3000) stats.slowVisitsCount++;
          if (Array.isArray(result.errorDetails) && result.errorDetails.length) {
            stats.lastErrorSample = String(result.errorDetails[0] || '').slice(0, 140);
          }
          const skippedInVisit = (result.stepResults || []).filter(s => s && s.ok === false);
          if (skippedInVisit.length) {
            stats.skippedStepsTotal += skippedInVisit.length;
            stats.failFastTriggers += skippedInVisit.filter(s => String(s.detail || '').includes('Fail-Fast')).length;
            const lastSkip = skippedInVisit[skippedInVisit.length - 1];
            if (lastSkip?.label) stats.lastSkippedSelector = String(lastSkip.label).slice(0, 90);
          }
          stats.proxyTransferBytes += sessionTransferBytes;
          if (sessionSlot) {
            if (sessionHandle.isReturning) stats.returningSessions++;
            else stats.newSessions++;
          }
          if (result?.partnerActivity) {
            // Attribution flush (fix #4): brief keep-alive so pending partner pixels/beacons finish before teardown
            await sleep(Math.max(0, Number(attributionCfg.closeSettleMs) || 2800)).catch(() => {});
          }

          const sessionTag = sessionSlot
            ? `, session: ${sessionHandle.isReturning ? 'returning' : 'new'}(#${sessionSlot.slot})`
            : '';
          const resolvedCountry = geo?.countryCode || (selectedProxyUrl ? proxyCountryByUrl[selectedProxyUrl] : null) || null;
          const geoTag = geo?.countryCode
            ? `, geo: ${geo.countryCode}(${geo.locale}/${geo.timezoneId})`
            : (resolvedCountry ? `, geo: ${resolvedCountry}` : '');
          const kbTag = sessionTransferBytes > 0 ? `, transfer: ${Math.round(sessionTransferBytes / 1024)}KB` : '';
          const refTag = referrerMode === 'google_organic' ? `, ref: ${referrer}` : '';
          const proxyTag = selectedProxyUrl ? `, proxy: ${maskProxyLabel(selectedProxyUrl)}${geoTag}${kbTag}${refTag}` : `${geoTag}${kbTag}${refTag}`;
          logVisitOutcome(i, persona, sessionHandle.deviceLabel, sessionHandle.engine, { ...result, skippedSteps: skippedInVisit.length }, sessionTag, proxyTag, { country: resolvedCountry });
          proxyPool.reportSuccess();
          } catch (err) {
            const errMsg = String(err?.message || err || '');
            const isTransient = err?.name === 'TimeoutError' || errMsg.includes('timeout') || /net::|ERR_TUNNEL|ERR_SSL|ERR_CONNECTION/i.test(errMsg);
            const retryBudget = Number(stats.retriedVisitsCount || 0);
            const retryCap = Math.max(3, Math.ceil(visitCount * 0.25));
            if (!retried && !aborted && !schedulePaused && !userPaused && retryBudget < retryCap && isTransient) {
              retried = true;
              stats.retriedVisitsCount = retryBudget + 1;
              console.log(`[${i + 1}] ↻ [Retry Fix] כשל זמני — ניסיון חוזר אחד עם פרוקסי חדש (${errMsg.slice(0, 90)})`);
              inFlight++;
              continue;
            }
            if (sessionSlot && !sessionHandle) releaseProfileSlot(sessionSlot);
            logVisitFailure(i, persona, err, stats);
            proxyPool.reportFailure(err);
          } finally {
            totalTransferBytes += sessionTransferBytes;
            if (killTimer) clearTimeout(killTimer);
            if (stopPopunderShield) stopPopunderShield();
            if (sessionHandle?.page && onRespSize) sessionHandle.page.off('requestfinished', onRespSize);
            if (sessionHandle) await sessionHandle.close().catch(() => {});
            inFlight--;
            emitTelemetry(pool.systemStatus?.getCurrentStatus?.());
          }
          break;
        }
      },
    });

    activePoolRef = pool;
    const configuredMaxCap = maxConcurrency;
    let lastRamScaleAt = 0;
    const monitorTimer = setInterval(async () => {
      const within = isWithinActiveHours(schedule);
      if (schedule.enabled && !within && !schedulePaused) {
        schedulePaused = true;
        console.log(`[Schedule] יצאנו מחלון הפעילות (${schedule.startHour}-${schedule.endHour}) — משהה עד לפתיחה מחדש.`);
        await syncPauseState();
      } else if (schedule.enabled && within && schedulePaused) {
        schedulePaused = false;
        console.log(`[Schedule] נכנסנו לחלון הפעילות (${schedule.startHour}-${schedule.endHour}) — ממשיך הרצה.`);
        await syncPauseState();
      }

      // Deterministic RAM Governor (Hysteresis: 70%-86% deadband, 90s cooldown, emergency brake >= 92%)
      const usedMemPct = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
      const nowMs = Date.now();
      if (usedMemPct >= 92 && stats.maxConcurrency > 1 && activePoolRef) {
        stats.minConcurrency = 1;
        stats.maxConcurrency = 1;
        activePoolRef.minConcurrency = 1;
        activePoolRef.maxConcurrency = 1;
        activePoolRef.desiredConcurrency = 1;
        runtimeState.resourceMode = 'ultra_lite';
        lastRamScaleAt = nowMs;
        console.log(`[RAM Governor] עומס זיכרון קריטי (${usedMemPct}%) — בלם חירום: מקביליות 1 ומצב ultra_lite.`);
      } else if (nowMs - lastRamScaleAt >= 90000 && activePoolRef) {
        if (usedMemPct < 68 && stats.maxConcurrency < configuredMaxCap) {
          const nextMax = Math.min(configuredMaxCap, stats.maxConcurrency + 1);
          stats.maxConcurrency = nextMax;
          activePoolRef.maxConcurrency = nextMax;
          activePoolRef.desiredConcurrency = Math.min(nextMax, Math.max(stats.minConcurrency, activePoolRef.desiredConcurrency + 1));
          lastRamScaleAt = nowMs;
          console.log(`[RAM Governor] זיכרון פנוי (${usedMemPct}%) — העלאה הדרגתית של מקביליות ל-${nextMax}.`);
        }
      }

      emitTelemetry(pool.systemStatus?.getCurrentStatus?.());
    }, 1500);

    try {
      if (schedulePaused) await syncPauseState();
      await pool.run();
      await closeAllSharedBrowsers();
      const ps = getProxySaverStats();
      const totalMb = (totalTransferBytes / (1024 * 1024)).toFixed(2);
      if (ps.savedBytes > 0 || ps.blockedRequests > 0 || ps.cacheHits > 0 || totalTransferBytes > 0) {
        console.log(
          `🛡️ [Proxy Saver] תעבורה בפועל: ${totalMb}MB | נחסכו ~${ps.savedMb}MB תעבורת פרוקסי (${ps.cacheHits} קבצי JS/CSS מ-Cache [${ps.cachedFiles} קבצים, ${ps.cacheRamMb}MB RAM] + ${ps.blockedRequests} טראקרים/תמונות/מדיה שנחסמו).`
        );
      }
      const aiStats = getAiTokenSaverStats();
      if (aiStats.apiCalls > 0 || aiStats.cacheHits > 0) {
        console.log(
          `🧠 [AI Brain] קריאות API: ${aiStats.apiCalls} (מתוכן התאוששות: ${aiStats.recoveryCalls}) | Cache Hits: ${aiStats.cacheHits} (${aiStats.cachedPlaybooks} תבניות שמורות) | נחסכו ~${aiStats.estimatedTokensSaved} טוקנים.`
        );
      }
      console.log('All visits complete.');
      try {
        const emailSweepSummary = await confirmRunInboxes({
          maxPasses: Number(cfg.emailSweepPasses ?? 4),
          passDelayMs: Number(cfg.emailSweepDelayMs ?? 30000),
        });
        if (emailSweepSummary && emailSweepSummary.total > 0) {
          console.log(`📧 [Email Sweep] הושלם: ${emailSweepSummary.confirmed}/${emailSweepSummary.total} תיבות קיבלו לחיצת אישור (מיילים בלי קישור: ${emailSweepSummary.withoutLink}).`);
        }
      } catch (sweepErr) {
        console.log(`[Email Sweep] דילוג: ${String(sweepErr?.message || sweepErr).slice(0, 120)}`);
      }
    } finally {
      clearInterval(monitorTimer);
      emitTelemetry(null);
    }
    return;
  }

  // ── Mode B: Crawlee PlaywrightCrawler (RequestQueue + SessionPool + FingerprintSuite) ──
  const crawleeCfg = new Configuration({
    persistStorage: false,
    logLevel: 'WARNING',
  });

  const allPages = normalizePages(pages);
  const firstPage = allPages[0];
  const requests = Array.from({ length: visitCount }, (_, i) => {
    const otherPages = allPages.filter(p => p !== firstPage);
    const entryPath = (Math.random() < (firstPagePriority / 100) || !otherPages.length)
      ? firstPage
      : randomChoice(otherPages);
    return {
      url: resolveTargetUrl(targetUrl, entryPath),
      uniqueKey: `visit-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      userData: {
        visitIndex: i,
        persona: randomChoice(personas),
        deviceKey: pickDeviceKey(deviceWeights),
        referrer: referrerMode === 'google_organic' ? buildGoogleSearchReferrer(null) : buildRandomReferrer(targetUrl),
      },
    };
  });

  const crawler = new PlaywrightCrawler({
    minConcurrency,
    maxConcurrency,
    maxRequestRetries: 0,
    requestHandlerTimeoutSecs: Math.ceil(sessionTimeoutMs / 1000) + 15,
    navigationTimeoutSecs: 25,
    useSessionPool: true,
    persistCookiesPerSession: true,
    proxyConfiguration: proxyConfiguration || undefined,
    browserPoolOptions: {
      useFingerprints: true,
      fingerprintOptions: {
        fingerprintGeneratorOptions: {
          devices: ['desktop', 'mobile'],
          operatingSystems: process.platform === 'win32' ? ['windows', 'android'] : ['windows', 'macos', 'android'],
        },
      },
    },
    launchContext: {
      launcher: getStealthChromium(),
      launchOptions: {
        headless,
        args: getChromiumStealthArgs(headless, { stealthMode, proxied: proxyUrls.length > 0 }),
      },
    },
    preNavigationHooks: [
      async ({ page, request }, gotoOptions) => {
        if (gotoOptions) {
          gotoOptions.waitUntil = 'domcontentloaded';
          if (request.userData.referrer) {
            gotoOptions.referer = request.userData.referrer;
          }
        }
        const ctx = page.context();
        if (['lite', 'ultra_lite', 'browserless_cdp', 'lightpanda_cdp'].includes(resourceMode)) {
          await applyResourceMode(ctx, resourceMode).catch(() => {});
        }
        if (Object.keys(originExtraHeaders).length) {
          await applyOriginScopedHeaders(ctx, targetUrl, originExtraHeaders);
        }
        if (!headless) {
          await page.bringToFront().catch(() => {});
          setTimeout(() => raisePlaywrightWindowsWin32(), 350);
        }
        request.userData._navStartedAt = Date.now();
        // Store session state JSON separately from persistent Chromium/FF/WebKit userDataDirs
        if (sessionCfg.enabled) {
          fs.mkdirSync(sessionCfg.profilesDir, { recursive: true });
          const slotNum = 1 + Math.floor(Math.random() * Math.max(1, sessionCfg.profilePoolSize));
          const stateFile = path.join(sessionCfg.profilesDir, `crawlee_state_${String(slotNum).padStart(2, '0')}.json`);
          const isReturning = fs.existsSync(stateFile) && Math.random() < (sessionCfg.returningUserRate / 100);
          request.userData._crawleeState = { slot: slotNum, file: stateFile, isReturning };
          if (isReturning) {
            try {
              const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
              if (Array.isArray(st.cookies) && st.cookies.length) {
                await page.context().addCookies(st.cookies).catch(() => {});
              }
            } catch {}
          }
        }
      },
    ],
    async requestHandler({ page, request, response, proxyInfo }) {
      const i = request.userData.visitIndex;
      const persona = request.userData.persona;
      const cState = request.userData._crawleeState;
      const loadMs = Date.now() - (request.userData._navStartedAt || Date.now());
      const status = response ? response.status() : 'n/a';
      const stopPopunderShield = installPopunderShield(
        null,
        page,
        adSafety.closePopunders,
        msg => console.log(`[${i + 1}] ${msg}`)
      );

      try {
        const ctxObj = page.context();
        if (!ctxObj.__wtgEnhanced) {
          ctxObj.__wtgEnhanced = true;
          if (stealthMode === 'maximum') {
            await applyMaximumStealth(ctxObj, {
              spec: { engine: 'chromium' },
              proxied: Boolean(proxyInfo?.url),
              seed: i + 100,
            }).catch(() => {});
          }
          if (['lite', 'ultra_lite'].includes(resourceMode)) {
            await applyResourceMode(ctxObj, resourceMode).catch(() => {});
          }
        }
        const res = await executeVisitWorkload({
          page,
          cfgVars,
          persona,
          visitIndex: i,
          alreadyNavigated: true,
          initialStatus: status,
          initialLoadMs: loadMs,
        });

        if (res?.partnerActivity) {
          // Attribution flush (fix #4): brief keep-alive before the pool recycles the context
          await sleep(Math.max(0, Number(attributionCfg.closeSettleMs) || 2800)).catch(() => {});
        }

        if (cState) {
          await page.context().storageState({ path: cState.file }).catch(() => {});
        }

        stats.completed++;
        stats.succeeded++;
        stats.errorsTotal += res.pageErrors;
        stats.loadTimesMs.push(res.loadMs);
        if (cState) {
          if (cState.isReturning) stats.returningSessions++;
          else stats.newSessions++;
        }

        const sessionTag = cState
          ? `, session: ${cState.isReturning ? 'returning' : 'new'}(#${cState.slot})`
          : '';
        const proxyTag = proxyInfo?.url ? `, proxy: ${maskProxyLabel(proxyInfo.url)}` : '';
        logVisitOutcome(i, persona, 'Crawlee Chromium', request.userData.deviceKey, res, sessionTag, proxyTag);
        proxyPool.reportSuccess();
      } finally {
        stopPopunderShield();
        emitTelemetry(crawler.autoscaledPool?.systemStatus?.getCurrentStatus?.());
      }
    },
    failedRequestHandler({ request }, err) {
      logVisitFailure(request.userData?.visitIndex, request.userData?.persona, err, stats);
      proxyPool.reportFailure(err);
      emitTelemetry(null);
    },
  }, crawleeCfg);

  const monitorTimer = setInterval(async () => {
    if (crawler.autoscaledPool && !activePoolRef) {
      activePoolRef = crawler.autoscaledPool;
      if (schedulePaused || userPaused) await syncPauseState();
    }
    const within = isWithinActiveHours(schedule);
    if (schedule.enabled && !within && !schedulePaused) {
      schedulePaused = true;
      console.log(`[Schedule] יצאנו מחלון הפעילות (${schedule.startHour}-${schedule.endHour}) — משהה עד לפתיחה מחדש.`);
      await syncPauseState();
    } else if (schedule.enabled && within && schedulePaused) {
      schedulePaused = false;
      console.log(`[Schedule] נכנסנו לחלון הפעילות (${schedule.startHour}-${schedule.endHour}) — ממשיך הרצה.`);
      await syncPauseState();
    }
    emitTelemetry(crawler.autoscaledPool?.systemStatus?.getCurrentStatus?.());
  }, 1000);

  try {
    await crawler.addRequests(requests);
    await crawler.run();
    await crawler.teardown().catch(() => {});
    console.log('All visits complete.');
  } finally {
    clearInterval(monitorTimer);
    emitTelemetry(null);
  }
}

process.on('unhandledRejection', err => {
  const msg = String(err?.message || err || '');
  if (/Target page, context or browser has been closed|Session closed|Protocol error.*Target closed/i.test(msg)) {
    return;
  }
  console.error('UnhandledRejection:', msg);
});

run()
  .then(() => {
    if (typeof process.disconnect === 'function' && process.connected) {
      process.disconnect();
    }
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err.message || err);
    if (typeof process.disconnect === 'function' && process.connected) {
      process.disconnect();
    }
    process.exit(1);
  });
