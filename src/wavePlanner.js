const { AD_SAFE_EXCLUSION_SELECTOR, dismissBlockingOverlays, registerScenarioPage } = require('./adSafetyHelper');
const { getEmailClientStatus } = require('./emailInboxClient');

const WAVE_MODE_META = {
  off: { label: 'רגיל (ללא גלים)' },
  steady: { label: 'גלים מאוזנים (Steady)' },
  ramp_up: { label: 'התגברות הדרגתית (Ramp Up)' },
  natural_peaks: { label: 'גאות ושפל טבעיים (Natural Peaks)' },
  burst: { label: 'פרצי תנועה חכמים (Smart Bursts)' },
};

const SQUAD_LEADERS = [
  {
    id: 'alpha',
    nameHe: 'מפקד אלפא (בודקי כלים ופונקציונליות)',
    workerModel: 'deepseek-v4.1-flash',
    tacticalFocus: 'Focus on interactive site tools (/tools/*), testing inputs, and verifying tool outputs.',
  },
  {
    id: 'bravo',
    nameHe: 'מפקד בראבו (צוות זרימות עומק וטפסים)',
    workerModel: 'beam',
    tacticalFocus: 'Execute complete recorded multi-step workflow, inspect form validation, and confirm responses.',
  },
  {
    id: 'charlie',
    nameHe: 'מפקד צ׳ארלי (קוראי מדריכים ותוכן עמוק)',
    workerModel: 'minimax-m3.1-flash',
    tacticalFocus: 'Deep human reading across guides (/guides/*), scrolling, and navigating between guides and tools.',
  },
  {
    id: 'delta',
    nameHe: 'מפקד דלתא (סיור אורגני וקבלת החלטות)',
    workerModel: 'gpt-oss:20b',
    tacticalFocus: 'Structured page evaluation and organic multi-page navigation across homepage, about, guides, and tool cards.',
  },
];

const DEFAULT_FORM_POOL = {
  domains: [
    'allbirds.com',
    'gymshark.com',
    'brooklinen.com',
    'colourpop.com',
    'chubbies.com',
    'ruggable.com',
    'bombas.com',
    'kotn.com',
    'tentree.com',
    'beardbrand.com',
    'glossier.com',
    'mvmt.com',
  ],
  queries: [
    'best wireless earbuds',
    'portable espresso maker',
    'ergonomic laptop stand',
    'smart fitness watch',
    'minimalist desk lamp',
    'usb c docking station',
    'noise cancelling headphones',
    'mechanical keyboard kit',
  ],
  names: [
    'Daniel Cohen',
    'Sarah Miller',
    'Liam Johnson',
    'Maya Levi',
    'Noah Taylor',
    'Emma Wilson',
    'Omer Katz',
    'Lucas Brown',
  ],
  comments: [
    'Checking shipping options and current specs.',
    'Comparing models before placing an order.',
    'Interested in warranty details and bundle pricing.',
    'Looks solid, reviewing customer feedback now.',
    'Exploring features for a small team setup.',
  ],
};

function clamp(n, min, max, fallback) {
  const num = Number(n);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function clampInt(n, min, max, fallback) {
  return Math.round(clamp(n, min, max, fallback));
}

function pickRandom(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function jitterNumber(base, pct = 0.25, minVal = 200, maxVal = 120000) {
  const factor = 1 + (Math.random() * 2 - 1) * pct;
  return clampInt(Math.round(base * factor), minVal, maxVal, base);
}

/**
 * Computes per-visit delay and dynamic concurrency target based on the active wave curve.
 */
function computeWavePacing({
  wavesCfg = {},
  visitIndex = 0,
  totalPlanned = 1,
  baseDelayMs = 0,
  baseMinConcurrency = 1,
  baseMaxConcurrency = 3,
} = {}) {
  const enabled = Boolean(wavesCfg?.enabled) && (wavesCfg?.mode || 'natural_peaks') !== 'off';
  const waveMode = wavesCfg?.mode || 'natural_peaks';
  const total = Math.max(1, Number(totalPlanned) || 1);
  const progress = Math.min(1, Math.max(0, visitIndex / Math.max(1, total - 1)));
  const waveSize = Math.max(3, Math.ceil(total / Math.max(2, Math.min(8, Math.ceil(total / 5)))));
  const waveNumber = Math.floor(visitIndex / waveSize) + 1;
  const minConc = Math.max(1, Number(baseMinConcurrency) || 1);
  const maxConc = Math.max(minConc, Number(baseMaxConcurrency) || minConc);

  if (!enabled) {
    return {
      enabled: false,
      waveMode: 'off',
      waveNumber: 1,
      wavePhase: 'steady',
      recommendedDelayMs: Math.max(0, Number(baseDelayMs) || 0),
      targetMaxConcurrency: maxConc,
    };
  }

  let ratio = 1;
  let wavePhase = 'cruise';
  let delayMultiplier = 1;

  if (waveMode === 'ramp_up') {
    ratio = 0.35 + 0.65 * Math.min(1, progress * 1.25);
    wavePhase = progress < 0.3 ? 'warmup' : progress < 0.85 ? 'peak' : 'cruise';
    delayMultiplier = progress < 0.25 ? 1.4 : 0.85;
  } else if (waveMode === 'natural_peaks') {
    const theta = progress * Math.PI * Math.max(2, Math.min(6, Math.ceil(total / 6)));
    const sine = (Math.sin(theta) + 1) / 2; // 0..1
    ratio = 0.4 + 0.6 * sine;
    wavePhase = sine >= 0.68 ? 'peak' : sine <= 0.3 ? 'ebb' : 'cruise';
    delayMultiplier = sine >= 0.68 ? 0.65 : 1.35;
  } else if (waveMode === 'burst') {
    const posInWave = visitIndex % waveSize;
    const isGapBoundary = posInWave === 0 && visitIndex > 0;
    ratio = isGapBoundary ? 0.5 : 1.0;
    wavePhase = isGapBoundary ? 'wave_gap' : 'burst';
    delayMultiplier = isGapBoundary ? 2.6 : 0.45;
  } else {
    ratio = 0.85 + Math.random() * 0.15;
    wavePhase = 'steady';
    delayMultiplier = 1;
  }

  const effectiveBaseDelay = Number(baseDelayMs) > 0 ? Number(baseDelayMs) : 350;
  const recommendedDelayMs = Math.min(
    30000,
    Math.max(0, Math.round(jitterNumber(effectiveBaseDelay * delayMultiplier, 0.35, 0, 30000)))
  );
  const targetMaxConcurrency = Math.max(
    minConc,
    Math.min(maxConc, Math.round(minConc + (maxConc - minConc) * ratio))
  );

  return {
    enabled: true,
    waveMode,
    waveNumber,
    wavePhase,
    recommendedDelayMs,
    targetMaxConcurrency,
  };
}

function buildNormalizedFormPool(wavesCfg = {}) {
  const customLines = Array.isArray(wavesCfg?.formInputs)
    ? wavesCfg.formInputs
    : typeof wavesCfg?.formInputs === 'string'
      ? wavesCfg.formInputs.split(/\r?\n/)
      : [];
  const cleanedCustom = customLines.map(s => String(s || '').trim()).filter(Boolean);
  return {
    queries: cleanedCustom.length ? cleanedCustom : DEFAULT_FORM_POOL.queries,
    names: DEFAULT_FORM_POOL.names,
    comments: DEFAULT_FORM_POOL.comments,
  };
}

function selectVariedFormValue(step, formPool, persona) {
  const rawSel = String(step.selector || '').toLowerCase();
  const rawVal = String(step.value || '').trim();
  const labelValHint = `${step.label || ''} ${rawVal}`.toLowerCase();
  const attrHint = rawSel.replace(/\[\s*name\s*=/g, ' ');
  const hint = `${attrHint} ${labelValHint}`;

  if (/mail|email|e-mail/.test(hint) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawVal)) {
    try {
      if (getEmailClientStatus().configured) {
        return '{{AGENT_EMAIL}}';
      }
    } catch {}
    const rawName = (pickRandom(formPool.names) || 'alex.morgan').toLowerCase().replace(/[^a-z]+/g, '.');
    const dom = pickRandom(['gmail.com', 'outlook.com', 'yahoo.com', 'icloud.com']);
    return `${rawName}${Math.floor(10 + Math.random() * 89)}@${dom}`;
  }
  if (/pass|pwd|סיסמה/.test(hint)) {
    const prefixes = ['Aurora', 'Kinetix', 'Nordic', 'Velvet', 'Harbor', 'Solaris'];
    return `${pickRandom(prefixes)}#${Math.floor(1000 + Math.random() * 8999)}!a`;
  }
  if (/company|brand|business|org|חברה|מותג/.test(hint)) {
    const brands = ['Northline Studio', 'Apex Commerce', 'Lumina Goods', 'Harbor & Co', 'Veloce Retail', 'PureBotanics'];
    return pickRandom(brands);
  }
  if (/store|domain|website|shop|url|אתר|חנות/.test(hint) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(rawVal)) {
    return pickRandom(DEFAULT_FORM_POOL.domains) || 'allbirds.com';
  }
  if (/search|query|keyword|term|חיפוש|"q"|'q'|#q\b/.test(hint)) {
    return pickRandom(formPool.queries) || step.value;
  }
  if (/first.?name|last.?name|full.?name|your.?name|author|שם מלא/.test(hint) || /\bname\b/.test(labelValHint)) {
    return pickRandom(formPool.names) || step.value;
  }
  if (/comment|message|msg|note|desc|feedback|body/.test(hint)) {
    return pickRandom(formPool.comments) || step.value;
  }
  if (/phone|tel|mobile/.test(hint)) {
    return `+1555${Math.floor(1000000 + Math.random() * 8999999)}`;
  }
  return pickRandom(formPool.queries) || step.value;
}

/**
 * Generates an organic, non-destructive "child" step journey derived from the recorded parent taskSteps.
 * Multi-tab integrity (opensTab / tab IDs) and assertion-referenced inputs are strictly preserved.
 */
const MAIL_STEP_RE = /#email|input[^"' ]*mail|fill_email|fill_otp|verification|otp/i;

/**
 * Inspects recorded taskSteps to classify the user's real scenario automatically
 * (e.g. email funnel vs multi-tab navigation vs interactive site tools vs guide reading)
 * so AI Workers, Commander, and Reports never hallucinate missing email steps.
 */
function analyzeRecordedJourney(baseSteps = [], targetUrl = '') {
  const steps = Array.isArray(baseSteps) ? baseSteps : [];
  let hasEmailFlow = false;
  let hasMultiTabFlow = false;
  let hasToolOrFormFlow = false;
  let hasGuidesFlow = false;
  const routeSet = new Set();
  const actionLabels = [];
  const externalTabSet = new Set();
  const compactSteps = [];

  for (let idx = 0; idx < steps.length; idx++) {
    const s = steps[idx];
    if (!s || typeof s !== 'object') continue;
    const selVal = `${s.selector || ''} ${s.value || ''} ${s.label || ''}`;
    if (['fill_email', 'fill_otp'].includes(s.type) || MAIL_STEP_RE.test(selVal)) {
      hasEmailFlow = true;
    }
    if ((Number.isInteger(s.opensTab) && s.opensTab > 0) || (Number.isInteger(s.tab) && s.tab > 0) || s.followExternal) {
      hasMultiTabFlow = true;
    }
    if (Number.isInteger(s.opensTab) && s.opensTab > 0) externalTabSet.add(s.opensTab);
    if (Number.isInteger(s.tab) && s.tab > 0) externalTabSet.add(s.tab);
    if (['fill', 'select', 'press'].includes(s.type) || /\/tools\/|#(pf|lc|pe|robots)/i.test(selVal)) {
      hasToolOrFormFlow = true;
    }
    if (/\/guides\//i.test(selVal)) {
      hasGuidesFlow = true;
    }
    if (s.type === 'goto' && s.value && !/^https?:/i.test(String(s.value))) {
      routeSet.add(String(s.value));
    } else if (s.selector) {
      const m = String(s.selector).match(/a\[href=["'](\/[^"']*)["']\]/i);
      if (m && m[1]) routeSet.add(m[1]);
    }
    if (['click', 'fill', 'fill_email', 'fill_otp'].includes(s.type) && actionLabels.length < 6 && s.label) {
      actionLabels.push(String(s.label).slice(0, 55));
    }
    if (compactSteps.length < 25) {
      let targetHint = s.value || '';
      if (!targetHint && s.selector) {
        targetHint = String(s.selector).slice(0, 65);
      }
      let fallbackHost = '';
      if (s.popupFallbackUrl) {
        try { fallbackHost = new URL(s.popupFallbackUrl).hostname; } catch {}
      }
      const fullLabel = String(s.label || targetHint || s.type);
      const compactLabel = fullLabel.length <= 125
        ? fullLabel
        : `${fullLabel.slice(0, 70)} ... ${fullLabel.slice(-45)}`;
      compactSteps.push({
        i: idx + 1,
        type: s.type,
        tab: Number.isInteger(s.tab) ? s.tab : 0,
        ...(Number.isInteger(s.opensTab) && s.opensTab > 0 ? { opensTab: s.opensTab } : {}),
        ...(fallbackHost ? { fallbackHost } : {}),
        ...(s.optional ? { optional: true } : {}),
        label: compactLabel,
      });
    }
  }

  const externalTabs = Array.from(externalTabSet).sort((a, b) => a - b);
  const primaryExternalTab = externalTabs.length ? externalTabs[0] : null;

  let flowLabelHe = 'מסלול גלישה ותוכן באתר (ללא רישום מייל)';
  if (hasEmailFlow) {
    flowLabelHe = 'מסלול המרה + הרשמת מייל חיה';
  } else if (hasMultiTabFlow && hasToolOrFormFlow) {
    flowLabelHe = 'מסלול כלים אינטראקטיביים וטאבים חיצוניים (ללא רישום מייל)';
  } else if (hasMultiTabFlow) {
    flowLabelHe = 'מסלול גלישה ורב-כרטיסיות / פרטנרים (ללא רישום מייל)';
  } else if (hasToolOrFormFlow) {
    flowLabelHe = 'בדיקת כלים אינטראקטיביים וטפסים באתר (ללא רישום מייל)';
  }

  const keyRoutes = Array.from(routeSet).slice(0, 6);
  const parts = [];
  if (hasEmailFlow) parts.push('includes email/OTP signup flow');
  else parts.push('no email signup needed');
  if (hasMultiTabFlow) parts.push(`multi-tab navigation (external tabs: ${externalTabs.join(',') || 'yes'})`);
  if (hasToolOrFormFlow) parts.push('interactive tools/forms');
  if (hasGuidesFlow) parts.push('guide articles');
  const workerHint = `Recorded QA flow (${steps.length} steps): ${parts.join(', ')}${keyRoutes.length ? `; routes: ${keyRoutes.slice(0, 4).join(', ')}` : ''}.`;

  return {
    stepsCount: steps.length,
    hasEmailFlow,
    hasMultiTabFlow,
    hasToolOrFormFlow,
    hasGuidesFlow,
    externalTabs,
    primaryExternalTab,
    keyRoutes,
    flowLabelHe,
    workerHint,
    actionLabels,
    compactSteps,
    targetHost: (() => { try { return new URL(targetUrl).hostname; } catch { return ''; } })(),
  };
}

function buildChildJourney({
  baseSteps = [],
  pages = ['/'],
  wavesCfg = {},
  visitIndex = 0,
  totalPlanned = 1,
  persona = null,
  aiCfg = {},
  targetUrl = '',
  runtimeState = null,
} = {}) {
  const cloned = Array.isArray(baseSteps) ? baseSteps.map(s => ({ ...s })) : [];
  const recordingAnalysis = analyzeRecordedJourney(cloned, targetUrl);
  const pacing = computeWavePacing({
    wavesCfg,
    visitIndex,
    totalPlanned,
    baseDelayMs: 0,
    baseMinConcurrency: 1,
    baseMaxConcurrency: 1,
  });

  if (!wavesCfg?.enabled) {
    return {
      steps: cloned,
      pacing,
      summary: {
        mutated: false,
        extraPage: null,
        scanProductsAdded: false,
        formMutatedCount: 0,
        aiAdded: false,
        waveNumber: pacing.waveNumber,
        wavePhase: pacing.wavePhase,
      },
    };
  }

  const conversionRate = clamp(wavesCfg.conversionRate ?? 100, 0, 100, 100);
  const hasConversionSteps = cloned.some(s =>
    (Number.isInteger(s.opensTab) && s.opensTab > 0) ||
    (Number.isInteger(s.tab) && s.tab > 0) ||
    s.type === 'fill_email' ||
    s.type === 'fill_otp' ||
    /mail|email|otp|consent|#result-save-link|#request\s*>/i.test(`${s.selector || ''} ${s.value || ''} ${s.label || ''}`)
  );
  // Deterministic + jittered quota so even small runs (e.g. 3-5 visits at 25%) convert ~1 agent and keep the rest organic
  const isConverter = (() => {
    if (!hasConversionSteps || conversionRate >= 100) return true;
    if (conversionRate <= 0) return false;
    const rateFrac = conversionRate / 100;
    if (totalPlanned <= 10) {
      const targetConverters = Math.max(1, Math.round(totalPlanned * rateFrac));
      const stride = Math.max(1, Math.round(totalPlanned / targetConverters));
      return (visitIndex % stride === 0) && Math.floor(visitIndex / stride) < targetConverters;
    }
    return Math.random() < rateFrac;
  })();
  const mutationProb = clamp(wavesCfg.childMutationRate ?? 75, 0, 100, 75) / 100;
  const extraPageProb = isConverter
    ? clamp(wavesCfg.extraPageChance ?? 40, 0, 100, 40) / 100
    : Math.max(0.8, clamp(wavesCfg.extraPageChance ?? 40, 0, 100, 40) / 100);
  const scanProductsProb = clamp(wavesCfg.scanProductsChance ?? 65, 0, 100, 65) / 100;
  const mutateForms = wavesCfg.mutateForms !== false;
  const formPool = buildNormalizedFormPool(wavesCfg);

  // If !isConverter, strip out external tab / partner clicks, ad redirects, and email signup steps so only conversionRate% convert
  const PARTNER_AD_HOST_RE = /(?:uplcm|tatrck|rcpsj|ypetp|codeaven|rzekl|grfpr|click\.|track\.|go\.)/i;
  let baseOrigin = '';
  try { baseOrigin = new URL(targetUrl).origin; } catch {}

  const effectiveCloned = isConverter
    ? cloned
    : cloned.filter(s => {
        if ((Number.isInteger(s.opensTab) && s.opensTab > 0) || (Number.isInteger(s.tab) && s.tab > 0) || s.type === 'close_tab') {
          return false;
        }
        if (s.followExternal === true) {
          return false;
        }
        if (['fill_email', 'fill_otp'].includes(s.type)) return false;
        const selVal = `${s.selector || ''} ${s.value || ''} ${s.label || ''}`.toLowerCase();
        if (/mail|email|otp|consent|#result-save-link|#request\s*>/.test(selVal)) {
          return false;
        }
        if (PARTNER_AD_HOST_RE.test(selVal)) {
          return false;
        }
        if (s.type === 'goto' && s.value && baseOrigin) {
          try {
            if (new URL(s.value, baseOrigin).origin !== baseOrigin) return false;
          } catch {}
        }
        return true;
      });
  const workingSteps = effectiveCloned.length > 0 ? effectiveCloned : [{ type: 'goto', selector: '', value: '/', label: 'פתיחת דף הבית', tab: 0 }];

  // Protect any fill value that an assertion later verifies verbatim, so QA assertions never flake.
  const protectedValues = new Set(
    workingSteps
      .filter(s => s.type === 'assert' && typeof s.value === 'string' && s.value.trim())
      .map(s => s.value.trim())
  );

  // Track which tab IDs remain used later so we never drop an opensTab step or corrupt tab sequence.
  const tabIds = new Set(workingSteps.map(s => (Number.isInteger(s.tab) ? s.tab : 0)));
  let maxTabId = 0;
  for (const s of workingSteps) {
    if (Number.isInteger(s.tab) && s.tab > maxTabId) maxTabId = s.tab;
    if (Number.isInteger(s.opensTab) && s.opensTab > maxTabId) maxTabId = s.opensTab;
  }

  let formMutatedCount = 0;
  let mutated = !isConverter;
  const childSteps = [];

  for (let i = 0; i < workingSteps.length; i++) {
    const step = { ...workingSteps[i] };
    const shouldMutateThis = Math.random() < mutationProb;

    // Never drop core navigations, clicks, form fills, assertions, close_tab, or steps opening tabs
    if (
      step.optional
      && !step.opensTab
      && ['scroll', 'hover', 'wait'].includes(step.type)
      && Math.random() < mutationProb * 0.25
    ) {
      mutated = true;
      continue;
    }

    if (shouldMutateThis) {
      if (['read_article', 'human_browse', 'wait', 'go_back', 'hover'].includes(step.type)) {
        const numeric = Number(step.value);
        if (Number.isFinite(numeric) && numeric > 100) {
          step.value = String(jitterNumber(numeric, 0.28, 350, 45000));
          mutated = true;
        }
      } else if (step.type === 'scroll' && step.value !== '') {
        const pct = Number(step.value);
        if (Number.isFinite(pct)) {
          step.value = String(clampInt(pct + Math.round((Math.random() * 2 - 1) * 14), 15, 95, pct));
          mutated = true;
        }
      } else if (
        step.type === 'fill' &&
        mutateForms &&
        !step.lockValue &&
        !protectedValues.has(String(step.value || '').trim()) &&
        !/^\{\{\s*(AGENT_EMAIL|EMAIL|OTP_CODE|EMAIL_CODE|OTP)\s*\}\}$/i.test(String(step.value || '').trim()) &&
        !/#code|\bcode\b|otp|verification|verify|pin/i.test(`${step.selector || ''} ${step.label || ''}`)
      ) {
        step.value = selectVariedFormValue(step, formPool, persona);
        formMutatedCount++;
        mutated = true;
      }
    }

    childSteps.push(step);
  }

  // Determine primary active external tab (prefer the first opened external tab with recorded actions, e.g. tab #1)
  const openedTabIds = childSteps
    .map(s => (Number.isInteger(s.opensTab) && s.opensTab > 0 ? s.opensTab : 0))
    .filter(id => id > 0)
    .sort((a, b) => a - b);
  const externalTabId = openedTabIds.find(id => childSteps.some(s => (s.tab || 0) === id))
    || openedTabIds[0]
    || (maxTabId > 0 ? 1 : null);
  let scanProductsAdded = false;

  const insertIntoExternalTab = (stepObj) => {
    const tId = stepObj.tab;
    const closeIdx = childSteps.findIndex(s => s.type === 'close_tab' && s.tab === tId);
    if (closeIdx >= 0) {
      childSteps.splice(closeIdx, 0, stepObj);
      return;
    }
    const lastTabStepIdx = childSteps.map(s => s.tab || 0).lastIndexOf(tId);
    if (lastTabStepIdx >= 0) {
      childSteps.splice(lastTabStepIdx + 1, 0, stepObj);
      return;
    }
    const openerIdx = childSteps.findIndex(s => s.opensTab === tId);
    if (openerIdx >= 0) {
      childSteps.splice(openerIdx + 1, 0, stepObj);
      return;
    }
    childSteps.push(stepObj);
  };

  const hasScanStep = childSteps.some(s => s.type === 'scan_products');
  if (!hasScanStep && Math.random() < scanProductsProb) {
    const targetTab = externalTabId !== null ? externalTabId : 0;
    const scanStep = {
      type: 'scan_products',
      selector: '',
      value: String(clampInt(wavesCfg.maxProductsPerVisit ?? 2, 1, 4, 2)),
      assertKind: 'text_contains',
      label: externalTabId !== null
        ? `ילד-גל #${visitIndex + 1}: סריקת מוצרים/קישורים בכרטיסייה #${targetTab}`
        : `ילד-גל #${visitIndex + 1}: סריקת מוצרים וקישורים באתר`,
      sameOriginOnly: !isConverter && targetTab === 0,
      tab: targetTab,
      optional: true,
    };

    if (externalTabId !== null) {
      insertIntoExternalTab(scanStep);
    } else {
      childSteps.push(scanStep);
    }
    scanProductsAdded = true;
    mutated = true;
  }

  // Optionally add 1 extra internal page hop on Tab 0 (e.g., another article/category page)
  let extraPage = null;
  const candidatePages = (Array.isArray(pages) ? pages : []).filter(p => typeof p === 'string' && p.trim() && p.trim() !== '/');
  if (candidatePages.length > 0 && Math.random() < extraPageProb) {
    const chosenPage = pickRandom(candidatePages);
    extraPage = chosenPage;
    const browseMs = persona?.readTime
      ? clampInt((persona.readTime[0] + persona.readTime[1]) / 2, 1500, 12000, 3500)
      : 3500;
    const hopSteps = [
      {
        type: 'goto',
        selector: '',
        value: chosenPage,
        assertKind: 'text_contains',
        label: `ילד-גל #${visitIndex + 1}: מעבר אורגני לעמוד ${chosenPage}`,
        tab: 0,
        optional: true,
      },
      {
        type: 'human_browse',
        selector: '',
        value: String(jitterNumber(browseMs, 0.25, 1200, 15000)),
        assertKind: 'text_contains',
        label: `גלישה טבעית בעמוד ${chosenPage}`,
        tab: 0,
        optional: true,
      },
    ];
    // Append cleanly on Tab 0 at the end (returning user browsing deeper before exit)
    childSteps.push(...hopSteps);
    mutated = true;
  }

  const bravoSquad = recordingAnalysis.hasEmailFlow
    ? SQUAD_LEADERS[1]
    : {
        ...SQUAD_LEADERS[1],
        nameHe: 'מפקד בראבו (מבצעי ההקלטה המלאה וטאבים)',
        tacticalFocus: 'Execute complete recorded multi-step navigation, tools, and tab interactions smoothly; no email signup step.',
      };
  const organicSquads = [SQUAD_LEADERS[0], SQUAD_LEADERS[2], SQUAD_LEADERS[3]];
  const assignedSquad = hasConversionSteps
    ? (isConverter ? bravoSquad : organicSquads[visitIndex % organicSquads.length])
    : (visitIndex % 4 === 1 ? bravoSquad : SQUAD_LEADERS[visitIndex % SQUAD_LEADERS.length]);

  const assignedModel = runtimeState?.squadModels?.[assignedSquad.id]
    || runtimeState?.squadModels?.all
    || assignedSquad.workerModel
    || aiCfg?.workerModel
    || 'deepseek-v4.1-flash';

  // Inject AI Explore early/mid-journey (plus a 2nd checkpoint at high workerPct) so AI stays actively involved
  let aiAdded = false;
  const rawPct = runtimeState?.workerPct != null ? runtimeState.workerPct : (aiCfg?.workerPct ?? 0);
  const aiWorkerPct = clamp(rawPct, 0, 100, 0);
  if (aiCfg?.enabled && aiWorkerPct > 0 && Math.random() * 100 < aiWorkerPct) {
    const hasAi = childSteps.some(s => s.type === 'ai_explore');
    if (!hasAi) {
      const extHasNav = externalTabId !== null && childSteps.some(s =>
        (s.opensTab === externalTabId) || (s.tab === externalTabId)
      );
      const targetTab = extHasNav ? externalTabId : 0;
      const aiStep = {
        type: 'ai_explore',
        selector: '',
        value: '2',
        assertKind: 'text_contains',
        label: `[${assignedSquad.nameHe}] ${assignedSquad.tacticalFocus}`,
        squadId: assignedSquad.id,
        squadFocus: assignedSquad.tacticalFocus,
        recordingHint: recordingAnalysis.workerHint,
        workerModel: assignedModel,
        sameOriginOnly: !isConverter && targetTab === 0,
        tab: targetTab,
        optional: true,
      };
      if (targetTab > 0) {
        insertIntoExternalTab(aiStep);
        if (aiWorkerPct >= 70 && childSteps.length >= 8) {
          childSteps.push({
            ...aiStep,
            tab: 0,
            sameOriginOnly: !isConverter,
            value: '2',
            label: `[${assignedSquad.nameHe} | חקירת המשך באתר] ${assignedSquad.tacticalFocus}`,
          });
        }
      } else {
        // Place primary AI involvement mid-journey (after first 4 Tab-0 steps) so early stops still execute AI
        let tab0Seen = 0;
        let insertIdx = childSteps.length;
        for (let k = 0; k < childSteps.length; k++) {
          if ((childSteps[k].tab || 0) === 0) tab0Seen++;
          if (tab0Seen >= 4) {
            insertIdx = k + 1;
            break;
          }
        }
        childSteps.splice(insertIdx, 0, aiStep);

        // Optional 2nd lightweight checkpoint on deeper journeys (>= 10 steps) when workerPct >= 70
        if (aiWorkerPct >= 70 && childSteps.length >= 10) {
          childSteps.push({
            ...aiStep,
            value: '1',
            label: `[${assignedSquad.nameHe} | בדיקה משנית] ${assignedSquad.tacticalFocus}`,
          });
        }
      }
      aiAdded = true;
      mutated = true;
    }
  }

  return {
    steps: childSteps,
    pacing,
    summary: {
      mutated,
      extraPage,
      scanProductsAdded,
      formMutatedCount,
      aiAdded,
      isConverter: hasConversionSteps ? isConverter : null,
      recordingAnalysis,
      squadId: assignedSquad.id,
      squadName: assignedSquad.nameHe,
      squadWorkerModel: assignedModel,
      tabCount: Math.max(1, tabIds.size),
      waveNumber: pacing.waveNumber,
      wavePhase: pacing.wavePhase,
    },
  };
}

/**
 * Safely scans visible non-ad product/article/item cards on the active page,
 * opens 1-2 items organically (handling both same-tab and popup tabs), scrolls/reads, and returns cleanly.
 */
async function runScanProductsStep(page, step = {}, ctx = {}) {
  if (ctx.dismissOverlays) {
    await dismissBlockingOverlays(page).catch(() => {});
  }

  const maxToOpen = clampInt(step.value || 2, 1, 4, 2);
  const avoidAds = Boolean(ctx.avoidAdClicks);
  const sameOriginOnly = Boolean(step.sameOriginOnly ?? ctx.staySameOrigin);
  const customHint = typeof step.selector === 'string' && step.selector.trim() ? step.selector.trim() : '';

  // Gentle initial scroll so lazy-loaded product cards become visible
  await page.evaluate(() => {
    window.scrollBy({ top: Math.min(480, Math.round(document.body.scrollHeight * 0.25)), behavior: 'smooth' });
  }).catch(() => {});
  await page.waitForTimeout(700 + Math.floor(Math.random() * 600)).catch(() => {});

  const candidates = await page.evaluate(
    ({ adSel, avoidAdsFlag, sameOriginOnlyFlag, selectorFilter }) => {
      const origin = location.origin;
      const currentHref = location.href.split('#')[0];
      const results = [];
      const seenHref = new Set();

      const roots = selectorFilter ? Array.from(document.querySelectorAll(selectorFilter)) : [document];
      const anchors = [];
      for (const r of roots) {
        if (!r) continue;
        if (r.tagName === 'A') anchors.push(r);
        else anchors.push(...r.querySelectorAll('a[href]'));
      }

      for (const a of anchors) {
        if (anchors.length > 400 && results.length >= 30) break;
        try {
          const hrefRaw = a.getAttribute('href') || '';
          if (!hrefRaw || hrefRaw.startsWith('#') || /^(javascript:|mailto:|tel:)/i.test(hrefRaw)) continue;
          const absUrl = new URL(a.href, currentHref);
          const cleanUrl = absUrl.href.split('#')[0];
          if (cleanUrl === currentHref || seenHref.has(cleanUrl)) continue;
          if (sameOriginOnlyFlag && absUrl.origin !== origin) continue;
          if (/logout|signout|signin|login|register|cart\/remove/i.test(absUrl.pathname)) continue;
          if (avoidAdsFlag && /(?:uplcm|tatrck|rcpsj|ypetp|codeaven|rzekl|grfpr)\./i.test(absUrl.hostname)) continue;
          if (avoidAdsFlag && adSel && a.closest(adSel)) continue;

          const rect = a.getBoundingClientRect();
          if (rect.width < 24 || rect.height < 14) continue;
          const style = getComputedStyle(a);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

          const text = (a.innerText || a.getAttribute('aria-label') || a.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
          const hasImage = Boolean(a.querySelector('img'));
          if (!text && !hasImage) continue;

          // Build a deterministic locator hint via data-wtg-scan index only in memory? Better: match exact href!
          let score = 0;
          if (absUrl.origin === origin) score += 20;
          if (/\/(product|products|item|items|p\/|dp\/|shop|store|tools|article|post|blog|offer|deal)/i.test(absUrl.pathname)) score += 35;
          if (hasImage) score += 15;
          if (/\$|₪|€|£|\d+\.\d{2}/.test(text)) score += 20;
          if (a.closest('article, .product, .card, .item, [class*="product"], [class*="card"], main')) score += 15;
          if (text.length >= 6 && text.length <= 120) score += 10;

          seenHref.add(cleanUrl);
          results.push({
            href: absUrl.href,
            rawHref: hrefRaw,
            text: text.slice(0, 80) || absUrl.pathname,
            score,
            sameOrigin: absUrl.origin === origin,
          });
        } catch {}
      }

      results.sort((a, b) => b.score - a.score);
      return results.slice(0, 14);
    },
    { adSel: AD_SAFE_EXCLUSION_SELECTOR, avoidAdsFlag: avoidAds, sameOriginOnlyFlag: sameOriginOnly, selectorFilter: customHint }
  ).catch(err => {
    console.warn('[ScanProducts]', err?.message || err);
    return [];
  });

  if (!candidates.length) {
    await page.evaluate(() => {
      window.scrollBy({ top: 380, behavior: 'smooth' });
    }).catch(() => {});
    await page.waitForTimeout(900).catch(() => {});
    return 'נסרק העמוד (לא זוהו כרטיסי מוצרים/קישורים נוספים זמינים — בוצעה גלילה אנושית)';
  }

  // Pick from top ranked pool with randomness so every child picks different items
  const pool = [...candidates.slice(0, Math.min(8, candidates.length))];
  const chosen = [];
  while (chosen.length < maxToOpen && pool.length) {
    const idx = Math.floor(Math.random() * Math.min(pool.length, 4));
    chosen.push(pool.splice(idx, 1)[0]);
  }

  const visitedLabels = [];
  const startUrl = page.url();
  const context = page.context();

  for (const item of chosen) {
    try {
      const safeHref = String(item.rawHref || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const targetLocator = page.locator(`a[href="${safeHref}"]`).first();
      const count = await targetLocator.count().catch(() => 0);

      let openedPopup = null;
      context.__wtgAllowPopupUntil = Date.now() + 10000;
      const popupPromise = context.waitForEvent('page', { timeout: 4500 }).catch(() => null);

      if (count > 0) {
        await targetLocator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(300 + Math.floor(Math.random() * 400));
        context.__wtgAllowPopupUntil = Date.now() + 10000;
        await Promise.all([
          popupPromise.then(p => {
            if (p) {
              openedPopup = p;
              registerScenarioPage(p, 12000);
            }
          }),
          targetLocator.click({ timeout: 5000, noWaitAfter: true }).catch(async () => {
            await page.goto(item.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
          }),
        ]);
      } else {
        await page.goto(item.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
      }

      const activeView = openedPopup || page;
      if (openedPopup) registerScenarioPage(openedPopup, 12000);
      await activeView.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      if (ctx.dismissOverlays) {
        await dismissBlockingOverlays(activeView).catch(() => {});
      }

      // Read product / item details naturally
      const scrollSteps = 2 + Math.floor(Math.random() * 2);
      for (let s = 0; s < scrollSteps; s++) {
        await activeView.evaluate(() => {
          window.scrollBy({ top: Math.round(220 + Math.random() * 340), behavior: 'smooth' });
        }).catch(() => {});
        await activeView.waitForTimeout(700 + Math.floor(Math.random() * 900)).catch(() => {});
      }

      visitedLabels.push(item.text);

      if (openedPopup && !openedPopup.isClosed()) {
        await openedPopup.close().catch(() => {});
      } else if (page.url() !== startUrl) {
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(async () => {
          await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        });
      }
      await page.waitForTimeout(450 + Math.floor(Math.random() * 450)).catch(() => {});
    } catch {
      // Ensure we end cleanly back on listing page even if one product card failed
      if (page.url() !== startUrl) {
        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      }
    }
  }

  return visitedLabels.length
    ? `סריקת מוצרים/קישורים הושלמה (${visitedLabels.length}): ${visitedLabels.join(' | ')}`
    : 'בוצעה סריקת עמוד וגלילה אנושית';
}

module.exports = {
  WAVE_MODE_META,
  SQUAD_LEADERS,
  DEFAULT_FORM_POOL,
  computeWavePacing,
  analyzeRecordedJourney,
  buildChildJourney,
  runScanProductsStep,
};
