const DEVICE_META = [
  { key: 'desktopChrome',  label: 'Desktop Chrome',  engine: 'Chromium Stealth + Fingerprint Suite' },
  { key: 'iphone14',       label: 'iPhone 14',       engine: 'WebKit Mobile Safari + iOS Fingerprint' },
  { key: 'pixel7',         label: 'Pixel 7',         engine: 'Chromium Mobile + Android Fingerprint' },
  { key: 'desktopFirefox', label: 'Desktop Firefox', engine: 'Firefox Desktop + FF Fingerprint' },
  { key: 'desktopSafari',  label: 'Desktop Safari',  engine: 'WebKit Safari + macOS Fingerprint' },
  { key: 'ipadPro',        label: 'iPad Pro 11',     engine: 'WebKit iPad Safari + iOS Fingerprint' },
];

const STATUS_LABELS = {
  idle: 'Ready',
  running: 'Running...',
  paused: 'Paused',
  waiting_schedule: 'Waiting for Schedule',
  stopping: 'Stopping...',
  completed: 'Completed',
  stopped: 'Stopped',
  error: 'Error',
};

const state = {
  config: null,
  defaultConfig: null,
  system: null,
  runStatus: null,
  profiles: [],
  siteProfiles: [],
  activeProfileId: null,
  demoEvents: [],
  visitDetails: [],
  latestFrame: null,
  mappedPage: null,
  mapperCategory: 'buttons',
  mapperFilter: '',
  recorder: null,
  lastImportedRecorderAt: null,
  countryCatalog: [],
  datacenterCounts: {},
  tier1Defaults: ['US', 'GB', 'CA', 'AU', 'DE'],
  aiStatus: null,
  aiHistory: [],
  livePreviewPaused: false,
  livePreviewHidden: false,
};

const STEP_TYPE_META = {
  goto:             { label: 'Navigate to Page (Goto URL / Path)', selectorHint: '(optional)', valueHint: '/tools/link-cleaner or https://...' },
  click:            { label: 'Click Element (Click)', selectorHint: '#lc-clean or .main-nav a[href="/tools"]', valueHint: '(optional)' },
  go_back:          { label: 'Go Back (Browser History)', selectorHint: '(auto — leave empty)', valueHint: '1200 (delay in ms)' },
  close_tab:        { label: 'Close External Tab & Return (Close Tab)', selectorHint: '(auto)', valueHint: '(auto)' },
  fill:             { label: 'Fill Input Field (Fill)', selectorHint: '#lc-input or input[name="email"]', valueHint: 'Text or {{AGENT_EMAIL}} / {{OTP_CODE}}' },
  fill_email:       { label: '📧 Fill Live Agent Email (HirePulse Inbox)', selectorHint: 'input[type="email"] (or leave blank for auto-detect)', valueHint: '(auto — creates a live inbox per session)' },
  fill_otp:         { label: '🔑 Wait & Fill Email OTP Code', selectorHint: 'input[name*="code"] (or leave blank for auto-detect)', valueHint: '45000 (max wait in ms)' },
  select:           { label: 'Select Dropdown Option (Select)', selectorHint: 'select[name="topic"]', valueHint: 'Option value or label' },
  press:            { label: 'Press Keyboard Key (Key Press)', selectorHint: '(optional) field selector', valueHint: 'Enter / Tab / Escape' },
  hover:            { label: 'Human Mouse Hover (Hover)', selectorHint: '#hero-cta or nav a (Bezier curve)', valueHint: '800 (dwell in ms)' },
  scroll:           { label: 'Scroll Page by Percentage (Scroll %)', selectorHint: '(optional)', valueHint: '70 (scroll percentage 0–100)' },
  scroll_to:        { label: 'Scroll to Element Without Clicking (Scroll To)', selectorHint: 'aside.ad-slot-box[data-ad-position="in_content_mid"]', valueHint: '(no value needed)' },
  read_article:     { label: 'Human Article Reading (AdSense Safe)', selectorHint: '(auto — leave empty)', valueHint: '8500 (reading time in ms)' },
  human_browse:     { label: 'Autonomous Human Browsing (Human Browse)', selectorHint: '(auto — leave empty)', valueHint: '7000 (duration in ms)' },
  scan_products:    { label: 'Scan Product Cards / Links (Scan Products)', selectorHint: '(optional container selector)', valueHint: '2 (items to open)' },
  search_entry:     { label: 'Pre-Entry Organic Search (Search Entry)', selectorHint: '(auto — leave empty)', valueHint: '(optional search query)' },
  ai_explore:       { label: 'Autonomous AI Agent (Cloud AI Brain)', selectorHint: '(auto — leave empty)', valueHint: '2 (number of AI actions)' },
  ai_route_repair:  { label: 'AI Route Repair', selectorHint: '(auto — leave empty)', valueHint: 'Target guidance for continuing the flow' },
  ai_form_guard:    { label: 'AI Form Guard', selectorHint: '(auto — leave empty)', valueHint: '1' },
  wait:             { label: 'Wait Duration or Selector (Wait)', selectorHint: '(empty for timer, or CSS selector)', valueHint: '2000 (milliseconds)' },
  dismiss_overlays: { label: 'Dismiss Floating Overlays (Dismiss Ads)', selectorHint: '(auto — leave empty)', valueHint: '(auto)' },
  audit_ads:        { label: 'Audit Ad Slots DOM (Read-Only)', selectorHint: '(auto — leave empty)', valueHint: '(auto)' },
  assert:           { label: 'QA Assertion Check (Assert Pass/Fail)', selectorHint: '#lc-output (or empty for full page)', valueHint: 'Expected text or URL substring' },
  screenshot:       { label: 'Capture Screenshot', selectorHint: '(optional)', valueHint: 'Screenshot caption' },
};

const $ = id => document.getElementById(id);

function showToast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.className = 'toast'; }, 3600);
}

async function api(url, opts = {}) {
  const timeoutMs = String(url || '').includes('/api/ai/') ? 60000 : 25000;
  const res = await fetch(url, {
    signal: opts.signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined),
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setupTabs(containerId, attr, panelSelector) {
  const container = $(containerId);
  container.addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    const target = btn.getAttribute(attr);
    container.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll(panelSelector).forEach(p => {
      p.classList.toggle('active', p.id === target);
    });
  });
}

// ─── Form Sync ────────────────────────────────────────────────────────────────

function syncFormFromConfig() {
  const cfg = state.config;
  if (!cfg) return;

  $('targetUrl').value = cfg.targetUrl || '';
  $('engineMode').value = cfg.engineMode || 'crawlee_autoscaled';
$('browserEngine').value = cfg.browserEngine || 'chromium';
  $('taskMode').value = cfg.taskMode || 'behavior';
  $('visitCount').value = cfg.visitCount ?? 3;
  $('minConcurrency').value = cfg.minConcurrency ?? 1;
  $('concurrency').value = cfg.concurrency ?? 3;
  $('pageMinMs').value = cfg.pageMinMs ?? 4000;
  $('sessionTimeoutMs').value = cfg.sessionTimeoutMs ?? 90000;
  $('keepBrowserOpenMs').value = cfg.keepBrowserOpenMs ?? 1500;
  $('interVisitDelayMs').value = cfg.interVisitDelayMs ?? 0;
  $('firstPagePriority').value = cfg.firstPagePriority ?? 60;
  $('quick-watch-mode').checked = cfg.headless === false;

  $('schedule-enabled').checked = Boolean(cfg.schedule?.enabled);
  $('schedule-start').value = cfg.schedule?.startHour || '08:00';
  $('schedule-end').value = cfg.schedule?.endHour || '22:00';

  $('snippet').value = cfg.snippet || '';

  $('proxy-enabled').checked = Boolean(cfg.proxy?.enabled);
  if ($('proxy-tier')) {
    $('proxy-tier').value = ['auto', 'datacenter', 'residential'].includes(cfg.proxy?.tier) ? cfg.proxy.tier : 'auto';
  }
  $('proxy-mode').value = cfg.proxy?.mode || 'round_robin';
  if ($('proxy-country-filter')) $('proxy-country-filter').checked = cfg.proxy?.countryFilterEnabled !== false;
  if ($('proxy-country-fallback')) $('proxy-country-fallback').checked = cfg.proxy?.fallbackToAnyIfEmpty !== false;
  $('proxy-servers').value = Array.isArray(cfg.proxy?.servers) ? cfg.proxy.servers.join('\n') : '';
  if ($('proxy-residential-country')) {
    populateCountryDropdownOptions();
    const sel = $('proxy-residential-country');
    const resiCc = String(cfg.proxy?.residential?.country || '').trim().toLowerCase();
    const filterOn = cfg.proxy?.countryFilterEnabled !== false;
    const pref = Array.isArray(cfg.proxy?.preferredCountries)
      ? cfg.proxy.preferredCountries.map(c => String(c || '').trim().toUpperCase()).filter(Boolean)
      : [];
    let targetVal = '';
    if (resiCc === '__preferred__' || (!resiCc && filterOn && pref.length > 1)) {
      targetVal = '__preferred__';
    } else if (resiCc && /^[a-z]{2}$/.test(resiCc)) {
      targetVal = resiCc;
    } else if (filterOn && pref.length === 1) {
      targetVal = pref[0].toLowerCase();
    }
    if (targetVal && targetVal !== '__preferred__' && !Array.from(sel.options).some(o => o.value === targetVal)) {
      const opt = document.createElement('option');
      opt.value = targetVal;
      opt.textContent = `${flagOf(targetVal)} ${targetVal.toUpperCase()}`;
      sel.appendChild(opt);
    }
    sel.value = targetVal;
    sel.disabled = false;
  }

  if ($('stealth-mode')) $('stealth-mode').value = cfg.stealthMode || 'maximum';
  if ($('resource-mode')) $('resource-mode').value = cfg.resourceMode || 'full';

  if ($('waves-enabled')) $('waves-enabled').checked = cfg.waves?.enabled !== false;
  if ($('waves-mode')) $('waves-mode').value = cfg.waves?.mode || 'natural_peaks';
  if ($('waves-conversion-rate')) $('waves-conversion-rate').value = cfg.waves?.conversionRate ?? 25;
  if ($('waves-mutation-rate')) $('waves-mutation-rate').value = cfg.waves?.childMutationRate ?? 75;
  if ($('waves-scan-chance')) $('waves-scan-chance').value = cfg.waves?.scanProductsChance ?? 65;
  if ($('waves-extra-page-chance')) $('waves-extra-page-chance').value = cfg.waves?.extraPageChance ?? 40;
  if ($('waves-max-products')) $('waves-max-products').value = cfg.waves?.maxProductsPerVisit ?? 2;
  if ($('waves-mutate-forms')) $('waves-mutate-forms').checked = cfg.waves?.mutateForms !== false;
  if ($('referrer-mode')) $('referrer-mode').value = cfg.waves?.referrerMode || cfg.referrerMode || 'mixed';
  if ($('waves-form-inputs')) $('waves-form-inputs').value = Array.isArray(cfg.waves?.formInputs) ? cfg.waves.formInputs.join('\n') : '';

  if ($('ai-enabled')) $('ai-enabled').checked = Boolean(cfg.ai?.enabled);
  if ($('ai-auto-manage')) $('ai-auto-manage').checked = Boolean(cfg.ai?.autoManage);
  if ($('ai-provider')) $('ai-provider').value = cfg.ai?.provider || 'auto';
  if ($('ai-commander-model')) $('ai-commander-model').value = cfg.ai?.commanderModel || 'glm-5.3-flash';
  if ($('ai-worker-model')) $('ai-worker-model').value = cfg.ai?.workerModel || 'deepseek-v4.1-flash';
  if ($('ai-worker-pct')) $('ai-worker-pct').value = cfg.ai?.workerPct ?? 0;
  if ($('ai-all-squads-model')) $('ai-all-squads-model').value = cfg.ai?.allSquadsModel || '';
  if ($('ai-recovery-model')) $('ai-recovery-model').value = cfg.ai?.recoveryModel || '';
  if ($('ai-form-assist')) $('ai-form-assist').checked = cfg.ai?.formAssist !== false;
  if ($('ai-route-repair')) $('ai-route-repair').checked = cfg.ai?.routeRepair !== false;
  if ($('ai-directive-input')) $('ai-directive-input').value = cfg.ai?.commanderDirective || '';

  $('session-enabled').checked = Boolean(cfg.sessionPersistence?.enabled);
  $('session-returning-rate').value = cfg.sessionPersistence?.returningUserRate ?? 50;
  $('session-pool-size').value = cfg.sessionPersistence?.profilePoolSize ?? 10;

  $('ad-avoid-clicks').checked = cfg.adSafety?.avoidAdClicks !== false;
  $('ad-dismiss-overlays').checked = cfg.adSafety?.dismissOverlays !== false;
  $('ad-close-popunders').checked = cfg.adSafety?.closePopunders !== false;
  $('ad-skip-telemetry').checked = Boolean(cfg.adSafety?.skipTelemetryHeader);

  if ($('onboard-domain-badge')) {
    try {
      const h = new URL(cfg.targetUrl || 'https://example.com').hostname;
      $('onboard-domain-badge').textContent = `Adapted for: ${h}`;
    } catch {
      $('onboard-domain-badge').textContent = 'Ready to Adapt';
    }
  }
  if ($('onboard-ai-level') && cfg.ai) {
    const wp = Number(cfg.ai.workerPct ?? 100);
    $('onboard-ai-level').value = wp >= 80 ? 'full_autonomous' : (wp >= 40 ? 'balanced_50' : 'light_repair');
  }

  renderCountriesSelector();
  renderPages();
  renderTargets();
  renderTaskSteps();
  renderDevices();
  renderPersonas();
  renderConcurrencyAdvice();
  renderJsonPreview();
}

function collectSimpleFieldsToConfig() {
  const cfg = state.config;
  if (!cfg) return;
  cfg.targetUrl = $('targetUrl').value.trim();
  cfg.engineMode = $('engineMode').value;
  cfg.browserEngine = $('browserEngine').value;
  cfg.taskMode = $('taskMode').value;
  cfg.visitCount = Number($('visitCount').value) || 1;
  cfg.concurrency = Math.max(1, Number($('concurrency').value) || 1);
  cfg.minConcurrency = Math.min(cfg.concurrency, Math.max(1, Number($('minConcurrency').value) || 1));
  cfg.pageMinMs = Math.max(0, Number($('pageMinMs').value) || 0);
  cfg.sessionTimeoutMs = Math.max(5000, Number($('sessionTimeoutMs').value) || 90000);
  cfg.keepBrowserOpenMs = Math.max(0, Math.min(30000, Number($('keepBrowserOpenMs').value) || 0));
  cfg.interVisitDelayMs = Math.max(0, Math.min(120000, Number($('interVisitDelayMs').value) || 0));
  cfg.firstPagePriority = Math.min(100, Math.max(0, Number($('firstPagePriority').value) || 0));
  cfg.headless = !$('quick-watch-mode').checked;

  cfg.schedule = {
    enabled: $('schedule-enabled').checked,
    startHour: $('schedule-start').value.trim() || '08:00',
    endHour: $('schedule-end').value.trim() || '22:00',
  };

  const rawSnippet = $('snippet').value.trim();
  cfg.snippet = rawSnippet ? rawSnippet : null;

  const tierVal = $('proxy-tier') ? $('proxy-tier').value : (cfg.proxy?.tier || 'auto');
  const resiCountryVal = $('proxy-residential-country')
    ? $('proxy-residential-country').value.trim().toLowerCase()
    : (cfg.proxy?.residential?.country || '');
  if ($('proxy-residential-country')) {
    $('proxy-residential-country').disabled = false;
  }

  let countryFilterEnabled = $('proxy-country-filter') ? $('proxy-country-filter').checked : true;
  let preferredCountries = Array.isArray(cfg.proxy?.preferredCountries) ? [...cfg.proxy.preferredCountries] : [...state.tier1Defaults];
  if (resiCountryVal && resiCountryVal !== '__preferred__' && /^[a-z]{2}$/.test(resiCountryVal)) {
    countryFilterEnabled = true;
    preferredCountries = [resiCountryVal.toUpperCase()];
    if ($('proxy-country-filter')) $('proxy-country-filter').checked = true;
  } else if (resiCountryVal === '') {
    countryFilterEnabled = false;
    if ($('proxy-country-filter')) $('proxy-country-filter').checked = false;
  } else if (resiCountryVal === '__preferred__') {
    countryFilterEnabled = true;
    if ($('proxy-country-filter')) $('proxy-country-filter').checked = true;
  }

  cfg.proxy = {
    ...(cfg.proxy || {}),
    enabled: $('proxy-enabled').checked,
    tier: ['auto', 'datacenter', 'residential'].includes(tierVal) ? tierVal : 'auto',
    mode: $('proxy-mode').value === 'random' ? 'random' : 'round_robin',
    countryFilterEnabled,
    fallbackToAnyIfEmpty: $('proxy-country-fallback') ? $('proxy-country-fallback').checked : true,
    preferredCountries,
    servers: $('proxy-servers').value.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')),
    residential: {
      ...(cfg.proxy?.residential || {}),
      enabled: tierVal === 'residential' ? true : (cfg.proxy?.residential?.enabled !== false),
      country: resiCountryVal,
    },
  };

  if ($('stealth-mode')) cfg.stealthMode = $('stealth-mode').value === 'standard' ? 'standard' : 'maximum';
  if ($('resource-mode')) cfg.resourceMode = $('resource-mode').value || 'full';

  if ($('waves-enabled')) {
    const crRaw = Number($('waves-conversion-rate')?.value);
    cfg.waves = {
      enabled: $('waves-enabled').checked,
      mode: $('waves-mode')?.value || 'natural_peaks',
      // Missing here used to reset the conversion rate to 25% on every save.
      conversionRate: Number.isFinite(crRaw) ? Math.min(100, Math.max(0, crRaw)) : 25,
      referrerMode: $('referrer-mode')?.value || 'mixed',
      childMutationRate: Math.min(100, Math.max(0, Number($('waves-mutation-rate')?.value) || 0)),
      scanProductsChance: Math.min(100, Math.max(0, Number($('waves-scan-chance')?.value) || 0)),
      extraPageChance: Math.min(100, Math.max(0, Number($('waves-extra-page-chance')?.value) || 0)),
      maxProductsPerVisit: Math.min(4, Math.max(1, Number($('waves-max-products')?.value) || 2)),
      mutateForms: $('waves-mutate-forms') ? $('waves-mutate-forms').checked : true,
      formInputs: ($('waves-form-inputs')?.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    };
    cfg.referrerMode = cfg.waves.referrerMode;
  }

  if ($('ai-enabled')) {
    cfg.ai = {
      ...(cfg.ai || {}),
      enabled: $('ai-enabled').checked,
      autoManage: $('ai-auto-manage') ? $('ai-auto-manage').checked : false,
      provider: $('ai-provider')?.value || 'auto',
      commanderModel: $('ai-commander-model')?.value.trim() || 'glm-5.3-flash',
      workerModel: $('ai-worker-model')?.value.trim() || 'deepseek-v4.1-flash',
      workerPct: Math.min(100, Math.max(0, Number($('ai-worker-pct')?.value) || 0)),
      allSquadsModel: $('ai-all-squads-model')?.value.trim() || '',
      recoveryModel: $('ai-recovery-model') ? $('ai-recovery-model').value.trim() : (cfg.ai?.recoveryModel || ''),
      formAssist: $('ai-form-assist') ? $('ai-form-assist').checked : true,
      routeRepair: $('ai-route-repair') ? $('ai-route-repair').checked : true,
      commanderDirective: $('ai-directive-input')?.value.trim() || '',
    };
  }

  cfg.sessionPersistence = {
    enabled: $('session-enabled').checked,
    returningUserRate: Math.min(100, Math.max(0, Number($('session-returning-rate').value) || 0)),
    profilePoolSize: Math.min(200, Math.max(1, Number($('session-pool-size').value) || 10)),
  };

  cfg.adSafety = {
    avoidAdClicks: $('ad-avoid-clicks').checked,
    dismissOverlays: $('ad-dismiss-overlays').checked,
    closePopunders: $('ad-close-popunders').checked,
    skipTelemetryHeader: $('ad-skip-telemetry').checked,
  };

  renderConcurrencyAdvice();
  renderJsonPreview();
}

// ─── Renderers ────────────────────────────────────────────────────────────────

function renderPages() {
  const list = $('pages-list');
  list.innerHTML = '';
  const pages = state.config.pages || ['/'];

  pages.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'page-chip';

    const left = document.createElement('div');
    left.className = 'inline-row';
    const code = document.createElement('code');
    code.textContent = p;
    left.appendChild(code);

    if (idx === 0) {
      const tag = document.createElement('span');
      tag.className = 'badge';
      tag.style.padding = '2px 8px';
      tag.style.fontSize = '0.75rem';
      tag.textContent = 'Primary Landing';
      left.appendChild(tag);
    }

    const btns = document.createElement('div');
    btns.className = 'inline-row';

    if (idx > 0) {
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'small';
      upBtn.textContent = 'Make Primary';
      upBtn.onclick = () => {
        const [item] = state.config.pages.splice(idx, 1);
        state.config.pages.unshift(item);
        renderPages();
        renderJsonPreview();
      };
      btns.appendChild(upBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'small danger';
    delBtn.textContent = 'Remove';
    delBtn.disabled = pages.length <= 1;
    delBtn.onclick = () => {
      state.config.pages.splice(idx, 1);
      renderPages();
      renderJsonPreview();
    };
    btns.appendChild(delBtn);

    row.appendChild(left);
    row.appendChild(btns);
    list.appendChild(row);
  });

  const dl = $('mapper-pages-datalist');
  if (dl) {
    dl.innerHTML = '';
    pages.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      dl.appendChild(opt);
    });
  }
}

function renderTargets() {
  const listEl = $('targets-list');
  const badgeEl = $('multi-targets-count-badge');
  if (!listEl || !state.config) return;
  const targets = Array.isArray(state.config.targets)
    ? state.config.targets.filter(t => t && typeof t === 'object' && t.url)
    : [];

  if (badgeEl) {
    if (targets.length > 0) {
      badgeEl.className = 'badge completed';
      badgeEl.textContent = `🎯 ${targets.length} active targets in round-robin`;
    } else {
      badgeEl.className = 'badge idle';
      badgeEl.textContent = 'Single Target (targetUrl)';
    }
  }

  listEl.innerHTML = '';
  if (!targets.length) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = 'Currently running against the primary targetUrl above. Add extra targets here to run multiple sites in parallel.';
    listEl.appendChild(empty);
    return;
  }

  const byTargetStats = state.runStatus?.byTarget || {};
  targets.forEach((t, idx) => {
    const row = document.createElement('div');
    row.className = 'page-chip';
    row.style.flexWrap = 'wrap';
    row.style.gap = '8px';

    const left = document.createElement('div');
    left.className = 'inline-row';
    left.style.flexWrap = 'wrap';
    left.style.gap = '8px';

    const numBadge = document.createElement('span');
    numBadge.className = 'badge';
    numBadge.style.padding = '2px 7px';
    numBadge.style.fontSize = '0.75rem';
    numBadge.textContent = `Target #${idx + 1}`;
    left.appendChild(numBadge);

    const urlCode = document.createElement('code');
    urlCode.textContent = t.url;
    left.appendChild(urlCode);

    const pagesArr = Array.isArray(t.pages) && t.pages.length ? t.pages : ['/'];
    const pagesTag = document.createElement('span');
    pagesTag.className = 'muted';
    pagesTag.style.fontSize = '0.8rem';
    pagesTag.textContent = `(${pagesArr.length} pages: ${pagesArr.slice(0, 4).join(', ')}${pagesArr.length > 4 ? '...' : ''})`;
    left.appendChild(pagesTag);

    const visitsTag = document.createElement('span');
    visitsTag.className = 'badge';
    visitsTag.style.padding = '2px 8px';
    visitsTag.style.fontSize = '0.75rem';
    visitsTag.textContent = t.visitCount > 0 ? `${t.visitCount} visits` : 'Equal split';
    left.appendChild(visitsTag);

    const liveStat = byTargetStats[t.url] || byTargetStats[String(t.url).replace(/\/$/, '')];
    if (liveStat) {
      const statBadge = document.createElement('span');
      statBadge.className = 'badge completed';
      statBadge.style.padding = '2px 8px';
      statBadge.style.fontSize = '0.75rem';
      statBadge.textContent = `Done: ${liveStat.completed || 0}/${liveStat.planned || t.visitCount || '?'} (ok: ${liveStat.succeeded || 0})`;
      left.appendChild(statBadge);
    }

    const btns = document.createElement('div');
    btns.className = 'inline-row';

    const scanBtn = document.createElement('button');
    scanBtn.type = 'button';
    scanBtn.className = 'small';
    scanBtn.textContent = '🔍 Discover Pages';
    scanBtn.onclick = async () => {
      scanBtn.disabled = true;
      scanBtn.textContent = 'Scanning...';
      try {
        const res = await api('/api/discover', { method: 'POST', body: JSON.stringify({ targetUrl: t.url }) });
        if (Array.isArray(res.pages) && res.pages.length) {
          state.config.targets[idx].pages = res.pages;
          renderTargets();
          renderJsonPreview();
          showToast(`Discovered ${res.pages.length} pages for ${t.url}`);
        }
      } catch (err) {
        showToast('Target page discovery failed: ' + err.message, true);
      } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = '🔍 Discover Pages';
      }
    };
    btns.appendChild(scanBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'small danger';
    delBtn.textContent = 'Remove';
    delBtn.onclick = () => {
      state.config.targets.splice(idx, 1);
      renderTargets();
      renderJsonPreview();
    };
    btns.appendChild(delBtn);

    row.appendChild(left);
    row.appendChild(btns);
    listEl.appendChild(row);
  });
}

function appendMappedStep(stepObj) {
  if (!Array.isArray(state.config.taskSteps)) state.config.taskSteps = [];
  state.config.taskSteps.push({
    type: stepObj.type,
    selector: stepObj.selector || '',
    value: stepObj.value ?? '',
    assertKind: 'text_contains',
    label: stepObj.label || '',
    ...(stepObj.followExternal ? { followExternal: true } : {}),
  });
  renderTaskSteps();
  renderJsonPreview();
  showToast(`Added step #${state.config.taskSteps.length}: ${stepObj.label || stepObj.type}`);
}

function renderPageMapperResults() {
  const wrap = $('page-mapper-results');
  const metaEl = $('mapper-status-meta');
  const listEl = $('mapper-list');
  const data = state.mappedPage;
  if (!wrap || !listEl) return;

  if (!data) {
    wrap.style.display = 'none';
    if (metaEl) metaEl.textContent = '';
    return;
  }

  wrap.style.display = 'block';
  const els = data.elements || {};
  $('mcnt-buttons').textContent = String((els.buttons || []).length);
  $('mcnt-links').textContent = String((els.links || []).length);
  $('mcnt-inputs').textContent = String((els.inputs || []).length);
  $('mcnt-sections').textContent = String((els.sections || []).length);
  $('mcnt-ads').textContent = String((els.adSlots || []).length);

  if (metaEl) {
    metaEl.textContent = `HTTP ${data.status} | ${data.url} (${data.title || 'Untitled'})`;
  }

  document.querySelectorAll('#mapper-category-tabs button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mcat === state.mapperCategory);
  });

  const items = Array.isArray(els[state.mapperCategory]) ? els[state.mapperCategory] : [];
  const q = String(state.mapperFilter || '').trim().toLowerCase();
  const filtered = q
    ? items.filter(it => JSON.stringify(it).toLowerCase().includes(q))
    : items;

  listEl.innerHTML = '';
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = items.length ? 'No elements match your filter.' : 'No elements found in this category.';
    listEl.appendChild(empty);
    return;
  }

  filtered.forEach(item => {
    const row = document.createElement('div');
    row.className = `mapper-row${item.isAd ? ' is-ad' : ''}`;

    const info = document.createElement('div');
    info.className = 'mapper-row-info';

    const title = document.createElement('div');
    title.className = 'mapper-row-title';

    if (item.isAd) {
      const warnBadge = document.createElement('span');
      warnBadge.className = 'mapper-badge ad-warn';
      warnBadge.textContent = `Ad Slot (${item.visible ? 'visible' : 'hidden'} · ${item.size})`;
      title.appendChild(warnBadge);
      title.appendChild(document.createTextNode(` ${item.position} — View & Audit Only (no click)`));
    } else {
      const badge = document.createElement('span');
      badge.className = 'mapper-badge';
      badge.textContent = item.category === 'link'
        ? (item.external ? 'External Link' : 'Internal Link')
        : (item.inputType || item.tag || item.category);
      title.appendChild(badge);
      const labelTxt = item.text || item.label || item.href || item.selector;
      title.appendChild(document.createTextNode(' ' + labelTxt));
      if (item.href) {
        const hrefSpan = document.createElement('span');
        hrefSpan.style.cssText = 'color:var(--muted);font-weight:400;font-size:0.78rem;';
        hrefSpan.textContent = ` -> ${item.href}`;
        title.appendChild(hrefSpan);
      }
    }

    const code = document.createElement('code');
    code.className = 'mapper-code';
    code.textContent = item.selector;

    info.appendChild(title);
    info.appendChild(code);

    const actions = document.createElement('div');
    actions.className = 'inline-row';

    if (item.isAd) {
      const scrollBtn = document.createElement('button');
      scrollBtn.type = 'button';
      scrollBtn.className = 'small';
      scrollBtn.textContent = '+ Safe Scroll';
      scrollBtn.onclick = () => appendMappedStep({
        type: 'scroll_to',
        selector: item.selector,
        value: '',
        label: `Safe scroll to slot ${item.position}`,
      });
      actions.appendChild(scrollBtn);

      const auditBtn = document.createElement('button');
      auditBtn.type = 'button';
      auditBtn.className = 'small';
      auditBtn.textContent = '+ Audit Ad Slot';
      auditBtn.onclick = () => appendMappedStep({
        type: 'audit_ads',
        selector: '',
        value: '',
        label: `Audit ad slots (${item.position})`,
      });
      actions.appendChild(auditBtn);
    } else {
      if (item.category === 'input') {
        const isSel = item.tag === 'select';
        const fillBtn = document.createElement('button');
        fillBtn.type = 'button';
        fillBtn.className = 'small primary';
        fillBtn.textContent = isSel ? '+ Select' : '+ Fill';
        fillBtn.onclick = () => appendMappedStep({
          type: isSel ? 'select' : 'fill',
          selector: item.selector,
          value: isSel ? (item.options?.[0] || '') : 'sample input value',
          label: `${isSel ? 'Select ' : 'Fill '}${item.label}`,
        });
        actions.appendChild(fillBtn);
      } else {
        const clickBtn = document.createElement('button');
        clickBtn.type = 'button';
        clickBtn.className = 'small primary';
        clickBtn.textContent = '+ Click';
        clickBtn.onclick = () => appendMappedStep({
          type: 'click',
          selector: item.selector,
          value: '',
          label: `Click: ${(item.text || item.label || item.selector).slice(0, 40)}`,
          followExternal: Boolean(item.external && item.targetBlank),
        });
        actions.appendChild(clickBtn);
      }

      const hoverBtn = document.createElement('button');
      hoverBtn.type = 'button';
      hoverBtn.className = 'small';
      hoverBtn.textContent = '+ Hover';
      hoverBtn.onclick = () => appendMappedStep({
        type: 'hover',
        selector: item.selector,
        value: '700',
        label: `Hover: ${(item.text || item.label || item.selector).slice(0, 40)}`,
      });
      actions.appendChild(hoverBtn);

      const scrollToBtn = document.createElement('button');
      scrollToBtn.type = 'button';
      scrollToBtn.className = 'small';
      scrollToBtn.textContent = '+ Scroll To';
      scrollToBtn.onclick = () => appendMappedStep({
        type: 'scroll_to',
        selector: item.selector,
        value: '',
        label: `Scroll to: ${(item.text || item.label || item.selector).slice(0, 40)}`,
      });
      actions.appendChild(scrollToBtn);
    }

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'small';
    copyBtn.textContent = 'Copy Selector';
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(item.selector);
        showToast(`Selector copied: ${item.selector}`);
      } catch {
        showToast(item.selector);
      }
    };
    actions.appendChild(copyBtn);

    row.appendChild(info);
    row.appendChild(actions);
    listEl.appendChild(row);
  });
}

async function importRecordedSteps(rec, opts = {}) {
  if (!rec || !Array.isArray(rec.steps) || !rec.steps.length) return false;
  const force = Boolean(opts && opts.force);
  if (!force && rec.finishedAt && state.lastImportedRecorderAt === rec.finishedAt) return false;
  state.lastImportedRecorderAt = rec.finishedAt || String(Date.now());

  if (!state.config) return false;
  collectSimpleFieldsToConfig();

  const clonedSteps = rec.steps.map(s => ({
    type: s.type,
    selector: s.selector || '',
    value: s.value || '',
    assertKind: s.assertKind || 'text_contains',
    label: s.label || '',
    ...(Number.isInteger(s.tab) && s.tab >= 0 ? { tab: s.tab } : {}),
    ...(Number.isInteger(s.opensTab) && s.opensTab > 0 ? { opensTab: s.opensTab } : {}),
    ...(typeof s.popupFallbackUrl === 'string' && /^https?:\/\//i.test(s.popupFallbackUrl) ? { popupFallbackUrl: s.popupFallbackUrl } : {}),
    ...(s.optional ? { optional: true } : {}),
    ...(s.followExternal ? { followExternal: true } : {}),
  }));

  const mode = $('recorder-mode')?.value === 'append' ? 'append' : 'replace';
  state.config.taskSteps = mode === 'append' && Array.isArray(state.config.taskSteps)
    ? [...state.config.taskSteps, ...clonedSteps]
    : clonedSteps;

  const postTaskMode = $('recorder-post-taskmode')?.value;
  if (postTaskMode === 'scenario' || postTaskMode === 'hybrid') {
    state.config.taskMode = postTaskMode;
  }

  syncFormFromConfig();
  renderJsonPreview();

  try {
    const saved = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify(state.config),
    });
    if (saved && saved.config) {
      state.config = saved.config;
      syncFormFromConfig();
      renderJsonPreview();
    }
    showToast(`Loaded and saved ${clonedSteps.length} recorded steps! You can now click "+ Save as New Profile".`);
  } catch (err) {
    showToast(`Steps loaded into UI, but saving failed: ${err.message}`, true);
  }
  return true;
}

function renderRecorderState(rec) {
  const prevActive = Boolean(state.recorder && state.recorder.active);
  state.recorder = rec || null;

  const box = $('journey-recorder-box');
  const dot = $('recorder-dot');
  const desktopWarnEl = $('recorder-desktop-warning');
  const startBtn = $('btn-recorder-start');
  const stopBtn = $('btn-recorder-stop');
  const focusBtn = $('btn-recorder-focus');
  const loadLastBtn = $('btn-recorder-load-last');
  const metaEl = $('recorder-status-meta');
  const listEl = $('recorder-live-preview');
  if (!box || !startBtn || !stopBtn || !metaEl || !listEl) return;

  if (rec && rec.desktop) {
    state.recorderDesktop = rec.desktop;
  }
  const desk = state.recorderDesktop || rec?.desktop || null;
  const hiddenDesktop = Boolean(desk && desk.platform === 'win32' && desk.isInteractiveDesktop === false);
  if (desktopWarnEl) {
    if (hiddenDesktop) {
      desktopWarnEl.style.display = 'block';
      desktopWarnEl.textContent = `⚠️ Server is currently running in an isolated background desktop (${desk.currentDesktop || 'non-Default'}) rather than your interactive desktop — browser windows are not visible. Double-click start-dashboard.bat to launch interactively.`;
    } else {
      desktopWarnEl.style.display = 'none';
      desktopWarnEl.textContent = '';
    }
  }

  const active = Boolean(rec && rec.active);
  const steps = Array.isArray(rec?.steps) ? rec.steps : [];

  // Detection only: the recorder never clicks a bot check. It tells the operator one is on screen.
  const challengeEl = $('recorder-challenge-warning');
  const challenge = rec?.challenge || null;
  if (challengeEl) {
    if (challenge && challenge.detected) {
      const labelText = Array.isArray(challenge.labels) && challenge.labels.length
        ? challenge.labels.join(' + ')
        : (challenge.interstitial ? 'Cloudflare verification interstitial' : 'Bot challenge');
      challengeEl.style.display = 'block';
      challengeEl.textContent = challenge.solved
        ? `✅ Detected ${labelText} — verification appears passed. You may continue browsing.`
        : `🤖 Detected ${labelText} on page — please complete it manually in the recording browser window, then continue browsing.`;
    } else {
      challengeEl.style.display = 'none';
      challengeEl.textContent = '';
    }
  }

  box.classList.toggle('recording', active);
  if (dot) dot.classList.toggle('recording', active);
  startBtn.disabled = active || hiddenDesktop;
  if (!active && startBtn.textContent !== '🔴 Record Journey in Browser') {
    startBtn.textContent = '🔴 Record Journey in Browser';
  }
  stopBtn.disabled = !active;
  if (focusBtn) focusBtn.disabled = !active || hiddenDesktop;
  if (loadLastBtn) loadLastBtn.disabled = active || steps.length === 0;

  if (active) {
    metaEl.textContent = `Recording (${steps.length} steps) — ${rec.currentUrl || rec.targetUrl || ''}`;
  } else if (rec?.status === 'error') {
    metaEl.textContent = `Recording error: ${rec.error || 'Unknown'}`;
  } else if (rec?.status === 'completed' && steps.length) {
    metaEl.textContent = `Recorded ${steps.length} steps — ready in Task Builder`;
  } else {
    metaEl.textContent = 'Ready to record on target URL';
  }

  listEl.innerHTML = '';
  if (!steps.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.style.fontSize = '0.84rem';
    empty.textContent = active
      ? 'Waiting for browser actions... click, scroll, fill forms, or navigate back.'
      : 'Actions you perform in the recording browser will appear here in real time...';
    listEl.appendChild(empty);
  } else {
    steps.forEach((step, idx) => {
      const chip = document.createElement('div');
      chip.className = 'recorder-step-chip';

      const desc = document.createElement('span');
      const labelText = step.label || step.type;
      const tabBadge = Number.isInteger(step.tab) && step.tab > 0 ? ` [Tab #${step.tab}]` : '';
      desc.textContent = `${idx + 1}. [${step.type}]${tabBadge} ${labelText}`;

      const targetCode = document.createElement('code');
      targetCode.textContent = step.selector || step.value || '';

      chip.appendChild(desc);
      chip.appendChild(targetCode);
      listEl.appendChild(chip);
    });
    listEl.scrollTop = listEl.scrollHeight;
  }

  if (prevActive && !active && steps.length) {
    importRecordedSteps(rec);
  }
}

function renderTaskSteps() {
  const container = $('task-steps-container');
  container.innerHTML = '';
  const steps = Array.isArray(state.config.taskSteps) ? state.config.taskSteps : (state.config.taskSteps = []);

  if (!steps.length) {
    const empty = document.createElement('div');
    empty.className = 'advice-box';
    empty.textContent = 'No scenario steps defined yet. Click "+ Add Step" or select a template above.';
    container.appendChild(empty);
    return;
  }

  steps.forEach((step, idx) => {
    const meta = STEP_TYPE_META[step.type] || STEP_TYPE_META.goto;
    const card = document.createElement('div');
    card.className = 'task-step-card';

    const head = document.createElement('div');
    head.className = 'task-step-head';

    const title = document.createElement('strong');
    const tabTag = Number.isInteger(step.tab) && step.tab > 0 ? ` [Tab #${step.tab}]` : '';
    const optTag = step.optional ? ' [optional]' : '';
    title.textContent = `Step ${idx + 1}: ${meta.label}${tabTag}${optTag}`;

    const controls = document.createElement('div');
    controls.className = 'inline-row';

    if (idx > 0) {
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'small';
      up.textContent = '↑';
      up.onclick = () => {
        [steps[idx - 1], steps[idx]] = [steps[idx], steps[idx - 1]];
        renderTaskSteps();
        renderJsonPreview();
      };
      controls.appendChild(up);
    }

    if (idx < steps.length - 1) {
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'small';
      down.textContent = '↓';
      down.onclick = () => {
        [steps[idx + 1], steps[idx]] = [steps[idx], steps[idx + 1]];
        renderTaskSteps();
        renderJsonPreview();
      };
      controls.appendChild(down);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'small danger';
    del.textContent = 'Delete';
    del.onclick = () => {
      steps.splice(idx, 1);
      renderTaskSteps();
      renderJsonPreview();
    };
    controls.appendChild(del);

    head.appendChild(title);
    head.appendChild(controls);
    card.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'task-step-grid';

    // Step Type
    const typeWrap = document.createElement('div');
    const typeLbl = document.createElement('label');
    typeLbl.textContent = 'Action Type';
    typeLbl.style.fontSize = '0.78rem';
    typeLbl.style.color = 'var(--muted)';
    const typeSel = document.createElement('select');
    Object.entries(STEP_TYPE_META).forEach(([k, info]) => {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = info.label;
      if (k === step.type) opt.selected = true;
      typeSel.appendChild(opt);
    });
    typeSel.onchange = e => {
      step.type = e.target.value;
      renderTaskSteps();
      renderJsonPreview();
    };
    typeWrap.appendChild(typeLbl);
    typeWrap.appendChild(typeSel);
    grid.appendChild(typeWrap);

    // Assert kind selector (only when step.type === 'assert')
    if (step.type === 'assert') {
      const aWrap = document.createElement('div');
      const aLbl = document.createElement('label');
      aLbl.textContent = 'Assertion Type';
      aLbl.style.fontSize = '0.78rem';
      aLbl.style.color = 'var(--muted)';
      const aSel = document.createElement('select');
      [
        ['text_contains', 'Page/Element Text Contains'],
        ['url_contains', 'URL Contains'],
        ['selector_visible', 'Element Is Visible'],
        ['status_ok', 'HTTP Status OK (200-399)'],
      ].forEach(([k, txt]) => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = txt;
        if ((step.assertKind || 'text_contains') === k) opt.selected = true;
        aSel.appendChild(opt);
      });
      aSel.onchange = e => { step.assertKind = e.target.value; renderJsonPreview(); };
      aWrap.appendChild(aLbl);
      aWrap.appendChild(aSel);
      grid.appendChild(aWrap);
    }

    const mkInput = (labelText, value, placeholder, onInput, ltr = true) => {
      const w = document.createElement('div');
      const l = document.createElement('label');
      l.textContent = labelText;
      l.style.fontSize = '0.78rem';
      l.style.color = 'var(--muted)';
      const i = document.createElement('input');
      i.type = 'text';
      if (ltr) i.className = 'ltr';
      i.placeholder = placeholder;
      i.value = value || '';
      i.oninput = e => {
        onInput(e.target.value);
        renderJsonPreview();
      };
      w.appendChild(l);
      w.appendChild(i);
      return w;
    };

    grid.appendChild(mkInput('Selector / Element Text', step.selector, meta.selectorHint, v => { step.selector = v; }));
    grid.appendChild(mkInput('Value / Target / Expected Text', step.value, meta.valueHint, v => { step.value = v; }));
    grid.appendChild(mkInput('Short Log Label', step.label, 'e.g. Verify link cleaner output', v => { step.label = v; }, false));

    card.appendChild(grid);
    container.appendChild(card);
  });
}

function renderDevices() {
  const container = $('devices-container');
  container.innerHTML = '';
  const weights = state.config.devices || {};
  const total = DEVICE_META.reduce((acc, d) => acc + (Number(weights[d.key]) || 0), 0);

  DEVICE_META.forEach(d => {
    const val = Number(weights[d.key] ?? 0);
    const pct = total > 0 ? Math.round((val / total) * 100) : 0;

    const row = document.createElement('div');
    row.className = 'device-row';

    const meta = document.createElement('div');
    meta.className = 'device-meta';
    const title = document.createElement('strong');
    title.textContent = d.label;
    const sub = document.createElement('small');
    sub.textContent = d.engine;
    meta.appendChild(title);
    meta.appendChild(sub);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.min(100, val));

    const num = document.createElement('input');
    num.type = 'number';
    num.min = '0';
    num.max = '10000';
    num.value = String(val);

    const pctEl = document.createElement('div');
    pctEl.className = 'pct-pill';
    pctEl.textContent = `${pct}%`;

    const updateVal = newVal => {
      const clean = Math.max(0, Number(newVal) || 0);
      state.config.devices[d.key] = clean;
      slider.value = String(Math.min(100, clean));
      num.value = String(clean);
      updateDevicePercentages();
      renderJsonPreview();
    };

    slider.oninput = e => updateVal(e.target.value);
    num.oninput = e => updateVal(e.target.value);

    row.appendChild(meta);
    row.appendChild(slider);
    row.appendChild(num);
    row.appendChild(pctEl);
    container.appendChild(row);
  });
}

function updateDevicePercentages() {
  const weights = state.config.devices || {};
  const total = DEVICE_META.reduce((acc, d) => acc + (Number(weights[d.key]) || 0), 0);
  const pills = $('devices-container').querySelectorAll('.pct-pill');
  DEVICE_META.forEach((d, idx) => {
    const val = Number(weights[d.key] ?? 0);
    const pct = total > 0 ? Math.round((val / total) * 100) : 0;
    if (pills[idx]) pills[idx].textContent = `${pct}%`;
  });
}

function renderPersonas() {
  const container = $('personas-container');
  container.innerHTML = '';

  state.config.personas.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = 'persona-card';

    const header = document.createElement('div');
    header.className = 'persona-header';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'ltr';
    nameInput.style.maxWidth = '240px';
    nameInput.value = p.name;
    nameInput.oninput = e => {
      p.name = e.target.value;
      renderJsonPreview();
    };

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'small danger';
    delBtn.textContent = 'Delete Persona';
    delBtn.disabled = state.config.personas.length <= 1;
    delBtn.onclick = () => {
      state.config.personas.splice(idx, 1);
      renderPersonas();
      renderJsonPreview();
    };

    header.appendChild(nameInput);
    header.appendChild(delBtn);
    card.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'persona-grid';

    const numField = (label, val, step, min, max, onChange) => {
      const wrap = document.createElement('div');
      const lbl = document.createElement('label');
      lbl.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = String(step);
      inp.min = String(min);
      inp.max = String(max);
      inp.value = String(val);
      inp.oninput = e => {
        onChange(Number(e.target.value));
        renderJsonPreview();
      };
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      return wrap;
    };

    grid.appendChild(numField('Scroll Depth (0–1)', p.scrollDepth, 0.05, 0, 1, v => { p.scrollDepth = v; }));
    grid.appendChild(numField('Click Rate (0–1)', p.clickRate, 0.05, 0, 1, v => { p.clickRate = v; }));
    grid.appendChild(numField('Min Read (ms)', p.readTime[0], 100, 0, 120000, v => { p.readTime[0] = v; }));
    grid.appendChild(numField('Max Read (ms)', p.readTime[1], 100, 0, 120000, v => { p.readTime[1] = v; }));
    grid.appendChild(numField('Min Pages', p.pageCount[0], 1, 1, 50, v => { p.pageCount[0] = v; }));
    grid.appendChild(numField('Max Pages', p.pageCount[1], 1, 1, 50, v => { p.pageCount[1] = v; }));
    grid.appendChild(numField('Idle Chance (0–1)', p.idleChance, 0.01, 0, 1, v => { p.idleChance = v; }));
    grid.appendChild(numField('Viewport Resize (0–1)', p.resizeChance, 0.01, 0, 1, v => { p.resizeChance = v; }));
    grid.appendChild(numField('Backtrack U-Turn (0–1)', p.uTurnChance, 0.01, 0, 1, v => { p.uTurnChance = v; }));

    card.appendChild(grid);
    container.appendChild(card);
  });
}

function updateSelectedProfileDesc() {
  const sel = $('site-profile-select');
  const descEl = $('site-profile-desc');
  const delBtn = $('btn-profile-delete');
  if (!sel || !descEl) return;

  const chosen = (state.siteProfiles || []).find(p => p.id === sel.value);
  if (!chosen) {
    descEl.textContent = 'No profile selected.';
    if (delBtn) delBtn.disabled = true;
    return;
  }

  const activeMark = chosen.id === state.activeProfileId ? ' [Currently Loaded]' : ' — click "Load Profile 📂" to apply';
  const stepsCnt = chosen.config?.taskSteps?.length || 0;
  descEl.textContent = `${chosen.description || 'Saved profile'} | Target: ${chosen.config?.targetUrl || '-'} | Mode: ${chosen.config?.taskMode || 'behavior'} (${stepsCnt} steps)${activeMark}`;
  if (delBtn) delBtn.disabled = Boolean(chosen.isBuiltin);
}

function renderSiteProfilesBar() {
  const sel = $('site-profile-select');
  if (!sel) return;
  const prevValue = sel.value;
  sel.innerHTML = '';

  (state.siteProfiles || []).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.isBuiltin ? '★ ' : ''}${p.name}`;
    sel.appendChild(opt);
  });

  if (state.activeProfileId && (state.siteProfiles || []).some(p => p.id === state.activeProfileId)) {
    sel.value = state.activeProfileId;
  } else if (prevValue && (state.siteProfiles || []).some(p => p.id === prevValue)) {
    sel.value = prevValue;
  }
  updateSelectedProfileDesc();
}

function renderConcurrencyAdvice() {
  const sys = state.system;
  const box = $('concurrency-advice-box');
  if (!sys) return;
  const conc = Number($('concurrency').value) || 1;
  const watchMode = $('quick-watch-mode')?.checked;
  const { recommended, sweetSpot, maxStress } = sys.concurrencyAdvice;

  if (watchMode && conc > 4) {
    box.className = 'advice-box warn';
    box.textContent = `Watch Mode Tip: Running ${conc} visible browsers concurrently can strain display and RAM — 1–4 is recommended for visible mode (uncheck visible windows for ${conc}+ load runs).`;
  } else if (conc > maxStress) {
    box.className = 'advice-box warn';
    box.textContent = `Warning: Max concurrency ${conc} exceeds host capacity (${sys.totalRamGb}GB RAM, ${sys.cpuCount} cores). Crawlee will throttle automatically, but ${sweetSpot[0]}–${sweetSpot[1]} is recommended.`;
  } else {
    box.className = 'advice-box';
    box.textContent = `Hardware Recommendation (${sys.totalRamGb}GB RAM, ${sys.cpuCount} cores): Crawlee AutoscaledPool scales between min and max (${recommended} recommended, safe cap: ${maxStress}).`;
  }
}

function renderJsonPreview() {
  if (!state.config) return;
  $('json-preview').textContent = JSON.stringify(state.config, null, 2);
}

function renderSystemInfo() {
  const sys = state.system;
  if (!sys) return;
  $('kpi-system').textContent = `RAM ${sys.memUsedPct}% | ${sys.cpuCount} cores`;
  $('kpi-system-advice').textContent = `Free: ${sys.freeRamGb} / ${sys.totalRamGb} GB | Recommended: ${sys.concurrencyAdvice.sweetSpot[0]}–${sys.concurrencyAdvice.sweetSpot[1]}`;
  renderConcurrencyAdvice();
}

function renderProfiles(profiles) {
  state.profiles = profiles || [];
  $('kpi-profiles-count').textContent = `Persistent profiles on disk: ${state.profiles.length}`;
  const el = $('profiles-list');
  if (!state.profiles.length) {
    el.textContent = 'No persistent returning-visitor profiles saved on disk yet.';
    return;
  }
  el.textContent = `${state.profiles.length} profiles saved on disk: ` +
    state.profiles.map(p => `${p.name} (${p.deviceKey}, ${p.cookiesCount} cookies)`).join(' • ');
}

function renderRunStatus(st) {
  if (!st) return;
  state.runStatus = st;

  const badge = $('run-status-badge');
  badge.className = `badge ${st.status}`;
  badge.textContent = st.streamMode && st.status === 'running'
    ? `🌊 Continuous Stream Active (Wave #${st.streamWave || 1})`
    : (STATUS_LABELS[st.status] || st.status);

  const isRunning = st.status === 'running' || st.status === 'waiting_schedule';
  const isPaused = st.status === 'paused';
  const isActive = isRunning || isPaused || st.status === 'stopping';

  $('btn-start').disabled = isActive;
  if ($('btn-stream')) $('btn-stream').disabled = isActive;
  $('btn-pause').disabled = !isRunning;
  $('btn-resume').disabled = !isPaused;
  $('btn-stop').disabled = !isActive;

  const total = st.totalPlanned || 0;
  const done = st.completed || 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  $('kpi-completed').textContent = `${done} / ${total}`;
  $('kpi-breakdown').textContent = `Succeeded: ${st.succeeded || 0} | Timed Out: ${st.timedOut || 0} | Failed: ${st.failed || 0}`;

  $('kpi-concurrency').textContent = `${st.currentConcurrency || 0} / ${st.desiredConcurrency || 0}`;
  $('kpi-concurrency-sub').textContent = `Configured range: ${st.minConcurrency || 1}–${st.maxConcurrency || 3}${st.isSystemOverloaded ? ' (high load — throttling)' : ''}`;
  $('crawlee-pool-badge').textContent = `Crawlee Pool: ${st.currentConcurrency || 0} active (target: ${st.desiredConcurrency || 0})`;

  $('kpi-avg-load').textContent = st.avgLoadMs != null ? `${st.avgLoadMs} ms` : '—';
  $('kpi-errors-sub').textContent = `JS / Console errors: ${st.errorsTotal || 0}`;
  $('kpi-sessions').textContent = `${st.returningSessions || 0} / ${st.newSessions || 0}`;

  $('progress-label').textContent = `Run Progress: ${pct}%`;
  $('progress-target').textContent = st.targetUrl ? st.targetUrl : '';
  $('progress-fill').style.width = `${pct}%`;
}

function appendLogLine(entry) {
  const box = $('log-box');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;

  const line = document.createElement('div');
  line.className = `log-line ${entry.level || 'stdout'}`;

  const ts = document.createElement('span');
  ts.className = 'log-ts';
  ts.textContent = new Date(entry.ts).toLocaleTimeString('en-GB', { hour12: false });

  const msg = document.createElement('span');
  msg.textContent = entry.message;

  line.appendChild(ts);
  line.appendChild(msg);
  box.appendChild(line);

  if (nearBottom) box.scrollTop = box.scrollHeight;
}

let liveRrwebReplayer = null;
let liveRrwebVisitIndex = null;
let liveRrwebStarted = false;

function scaleLiveRrwebPlayer(container) {
  if (!container) return;
  const wrapper = container.querySelector('.replayer-wrapper');
  const iframe = container.querySelector('iframe');
  if (!wrapper || !iframe) return;
  const w = Number(iframe.getAttribute('width') || iframe.style.width?.replace('px', '') || 1280) || 1280;
  const h = Number(iframe.getAttribute('height') || iframe.style.height?.replace('px', '') || 720) || 720;
  const cw = container.clientWidth || 360;
  const ch = container.clientHeight || 220;
  const scale = Math.min(cw / w, ch / h);
  wrapper.style.transform = `scale(${scale})`;
  wrapper.style.left = `${Math.max(0, (cw - w * scale) / 2)}px`;
  wrapper.style.top = `${Math.max(0, (ch - h * scale) / 2)}px`;
}

function resetLiveRrwebPlayer(container) {
  if (liveRrwebReplayer) {
    try { liveRrwebReplayer.pause(); } catch {}
    liveRrwebReplayer = null;
  }
  liveRrwebStarted = false;
  if (container) container.innerHTML = '';
}

function renderLiveFrame(frame) {
  if (state.livePreviewPaused && frame) return;
  state.latestFrame = frame || null;
  const img = $('live-screen-img');
  const rrContainer = $('live-rrweb-container');
  const empty = $('live-screen-empty');
  const lbl = $('live-screen-label');
  const urlEl = $('live-screen-url');

  if (!frame) {
    resetLiveRrwebPlayer(rrContainer);
    liveRrwebVisitIndex = null;
    if (rrContainer) rrContainer.style.display = 'none';
    img.style.display = 'none';
    empty.style.display = 'flex';
    lbl.textContent = 'Live Browser Preview';
    urlEl.textContent = 'Waiting for run...';
    return;
  }

  if (frame.type === 'live_meta') {
    lbl.textContent = `Visit #${(frame.visitIndex ?? 0) + 1}${frame.label ? ' — ' + frame.label : ''}`;
    if (frame.url) urlEl.textContent = frame.url;
    return;
  }

  if (frame.type === 'rrweb_events' && Array.isArray(frame.events) && frame.events.length && window.rrweb?.Replayer && rrContainer) {
    img.style.display = 'none';
    empty.style.display = 'none';
    rrContainer.style.display = 'block';
    lbl.textContent = `Visit #${(frame.visitIndex ?? 0) + 1}${frame.label ? ' — ' + frame.label : ' (Live DOM)'}`;
    if (frame.url) urlEl.textContent = frame.url;

    const hasFullSnapshot = frame.events.some(ev => ev && ev.type === 2);
    if (!liveRrwebReplayer || (hasFullSnapshot && (liveRrwebVisitIndex !== frame.visitIndex || liveRrwebStarted))) {
      resetLiveRrwebPlayer(rrContainer);
      liveRrwebVisitIndex = frame.visitIndex;
      liveRrwebReplayer = new window.rrweb.Replayer([], {
        root: rrContainer,
        liveMode: true,
        showWarning: false,
        showDebug: false,
        UNSAFE_replayCanvas: false,
      });
    }

    for (const ev of frame.events) {
      if (!ev) continue;
      if (!liveRrwebStarted && ev.timestamp) {
        try {
          liveRrwebReplayer.startLive(ev.timestamp);
          liveRrwebStarted = true;
        } catch {}
      }
      try {
        liveRrwebReplayer.addEvent(ev);
      } catch {}
    }
    scaleLiveRrwebPlayer(rrContainer);
    return;
  }

  if (!frame.imageDataUrl) return;

  resetLiveRrwebPlayer(rrContainer);
  if (rrContainer) rrContainer.style.display = 'none';
  img.src = frame.imageDataUrl;
  img.style.display = 'block';
  empty.style.display = 'none';
  lbl.textContent = `Visit #${(frame.visitIndex ?? 0) + 1}${frame.label ? ' — ' + frame.label : ''}`;
  urlEl.textContent = frame.url || '';
}

function renderVisitDetails() {
  $('visit-details-count').textContent = String(state.visitDetails.length);
  const list = $('visit-details-list');
  list.innerHTML = '';

  if (!state.visitDetails.length) {
    const p = document.createElement('p');
    p.style.color = 'var(--muted)';
    p.style.padding = '12px';
    p.textContent = 'No visit reports yet. Click "Start Run ▶" to begin.';
    list.appendChild(p);
    return;
  }

  state.visitDetails.forEach(v => {
    const hasErr = v.status === 'FAIL' || v.status === 'TIMEOUT' || Number(v.status) >= 400 || (v.pageErrors || 0) > 0;
    const card = document.createElement('div');
    card.className = `visit-card ${hasErr ? 'has-errors' : 'clean'}`;

    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.justifyContent = 'space-between';
    head.style.gap = '8px';

    const title = document.createElement('strong');
    title.textContent = `Visit #${v.visitNumber} • ${v.persona} • ${v.device}`;

    const badge = document.createElement('span');
    badge.className = hasErr ? 'pill-fail' : 'pill-ok';
    const extraGeo = v.country ? ` | 🌍 ${v.country}` : '';
    const extraWave = v.waveSummary?.mutated ? ` | 🌊 Wave #${v.waveSummary.waveNumber || 1}` : '';
    badge.textContent = `HTTP ${v.status} | ${v.loadMs}ms | Errors: ${v.pageErrors || 0}${extraGeo}${extraWave}`;

    head.appendChild(title);
    head.appendChild(badge);
    card.appendChild(head);

    if (Array.isArray(v.visitedUrls) && v.visitedUrls.length) {
      const route = document.createElement('div');
      route.style.marginTop = '5px';
      const code = document.createElement('code');
      code.style.fontSize = '0.76rem';
      code.textContent = 'Trail: ' + v.visitedUrls.map(u => `${u.path} (${u.status})`).join(' -> ');
      route.appendChild(code);
      card.appendChild(route);
    }

    if (Array.isArray(v.stepResults) && v.stepResults.length) {
      const detailsEl = document.createElement('details');
      detailsEl.className = 'visit-steps-details';
      const summary = document.createElement('summary');
      summary.style.color = '#34d399';
      summary.style.fontSize = '0.78rem';
      summary.style.cursor = 'pointer';
      summary.textContent = `Scenario steps (${v.stepResults.length}): ` + v.stepResults.map(s => `✓ ${s.label}`).join(' | ');
      detailsEl.appendChild(summary);

      const ol = document.createElement('ol');
      ol.className = 'visit-step-list';
      v.stepResults.forEach(s => {
        const li = document.createElement('li');
        li.textContent = `${s.detail || s.label} (${s.durationMs || 0}ms)`;
        ol.appendChild(li);
      });
      detailsEl.appendChild(ol);
      card.appendChild(detailsEl);
    }

    if (Array.isArray(v.errorDetails) && v.errorDetails.length) {
      const ul = document.createElement('ul');
      ul.className = 'visit-err-list';
      v.errorDetails.slice(0, 6).forEach(msg => {
        const li = document.createElement('li');
        li.textContent = msg;
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }

    list.appendChild(card);
  });
}

function renderDemoEvents() {
  $('demo-events-count').textContent = String(state.demoEvents.length);
  const list = $('demo-events-list');
  list.innerHTML = '';

  if (!state.demoEvents.length) {
    const p = document.createElement('p');
    p.style.color = 'var(--muted)';
    p.style.padding = '12px';
    p.textContent = 'No events captured from the built-in demo site yet.';
    list.appendChild(p);
    return;
  }

  state.demoEvents.forEach(ev => {
    const item = document.createElement('div');
    item.className = 'demo-event-item';

    const top = document.createElement('div');
    top.style.display = 'flex';
    top.style.justifyContent = 'space-between';
    top.style.gap = '8px';
    const title = document.createElement('strong');
    title.textContent = `${ev.eventType || 'event'} — ${ev.returning ? 'Returning Visitor' : 'New Visitor'} (${ev.visitorId || '—'})`;
    const time = document.createElement('span');
    time.style.color = 'var(--muted)';
    time.textContent = new Date(ev.ts).toLocaleTimeString('en-GB', { hour12: false });
    top.appendChild(title);
    top.appendChild(time);

    const details = document.createElement('div');
    details.style.marginTop = '4px';
    const code = document.createElement('code');
    const utm = ev.utmSource ? ` | utm=${ev.utmSource}/${ev.utmMedium}/${ev.utmCampaign}` : '';
    code.textContent = `${ev.page || '/'} | ${ev.viewport || ''} | ref: ${ev.referrer || '(direct)'}${utm}`;
    details.appendChild(code);

    item.appendChild(top);
    item.appendChild(details);
    list.appendChild(item);
  });
}

function renderProxyTestResults(results) {
  const box = $('proxy-test-results');
  box.innerHTML = '';
  if (!results || !results.length) {
    box.textContent = 'No proxy servers configured to test.';
    return;
  }
  results.forEach(r => {
    const row = document.createElement('div');
    row.className = `proxy-row ${r.ok ? 'ok' : 'fail'}`;

    const left = document.createElement('code');
    left.dir = 'ltr';
    left.textContent = r.proxy || r.raw || 'unknown';

    const right = document.createElement('span');
    right.className = r.ok ? 'pill-ok' : 'pill-fail';
    right.textContent = r.ok
      ? `OK | ${r.latencyMs}ms | IP: ${r.exitIp || 'OK'} ${r.country ? '• ' + r.country : ''}`
      : `Failed: ${r.error || 'Error'}`;

    row.appendChild(left);
    row.appendChild(right);
    box.appendChild(row);
  });
}

function populateCountryDropdownOptions() {
  const sel = $('proxy-residential-country');
  if (!sel) return;
  const counts = state.datacenterCounts || {};
  Array.from(sel.options).forEach(opt => {
    const val = String(opt.value || '').trim().toUpperCase();
    if (!val || val === '__PREFERRED__' || val.length !== 2) return;
    const catItem = (state.countryCatalog || []).find(c => c.code === val);
    const baseName = catItem ? catItem.nameHe : `${ RECORDER_CC_LABEL[val] || val } (${val})`;
    const dcCount = Number(counts[val] || 0);
    const dcSuffix = dcCount > 0 ? ` — ${dcCount} DC + Residential` : ' — Residential';
    opt.textContent = `${flagOf(val)} ${baseName}${dcSuffix}`;
  });
}

function renderCountriesSelector() {
  const grid = $('proxy-countries-grid');
  if (!grid || !state.config) return;
  populateCountryDropdownOptions();
  const selected = new Set(Array.isArray(state.config.proxy?.preferredCountries) ? state.config.proxy.preferredCountries : state.tier1Defaults);
  const catalog = state.countryCatalog.length
    ? state.countryCatalog
    : state.tier1Defaults.map(code => ({ code, nameHe: code, tier: 1 }));
  const counts = state.datacenterCounts || {};

  grid.innerHTML = '';
  catalog.forEach(c => {
    const chip = document.createElement('label');
    chip.className = `country-chip${c.tier === 1 ? ' tier1' : ''}${selected.has(c.code) ? ' selected' : ''}`;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(c.code);
    cb.style.margin = '0';
    cb.onchange = () => {
      if (!state.config.proxy) state.config.proxy = {};
      const cur = new Set(Array.isArray(state.config.proxy.preferredCountries) ? state.config.proxy.preferredCountries : []);
      if (cb.checked) cur.add(c.code);
      else cur.delete(c.code);
      const nextPref = [...cur];
      state.config.proxy.preferredCountries = nextPref;
      state.config.proxy.countryFilterEnabled = nextPref.length > 0;
      if ($('proxy-country-filter')) $('proxy-country-filter').checked = nextPref.length > 0;
      if ($('proxy-residential-country')) {
        if (nextPref.length === 1) {
          $('proxy-residential-country').value = nextPref[0].toLowerCase();
          if (state.config.proxy.residential) state.config.proxy.residential.country = nextPref[0].toLowerCase();
        } else if (nextPref.length > 1) {
          $('proxy-residential-country').value = '__preferred__';
          if (state.config.proxy.residential) state.config.proxy.residential.country = '__preferred__';
        } else {
          $('proxy-residential-country').value = '';
          if (state.config.proxy.residential) state.config.proxy.residential.country = '';
        }
      }
      chip.classList.toggle('selected', cb.checked);
      renderJsonPreview();
    };

    const span = document.createElement('span');
    const dcCount = Number(counts[c.code] || 0);
    span.textContent = `${flagOf(c.code)} ${c.nameEn || c.name || c.code}${dcCount > 0 ? ` [${dcCount} DC]` : ''}`;
    chip.appendChild(cb);
    chip.appendChild(span);
    if (c.tier === 1) {
      const tb = document.createElement('span');
      tb.className = 'tier-badge';
      tb.textContent = 'Tier-1';
      chip.appendChild(tb);
    }
    grid.appendChild(chip);
  });
}

function renderAiStatusBadge(info) {
  const badge = $('ai-cred-badge');
  if (!badge || !info) return;
  const parts = [];
  if (info.providers?.ollama_cloud?.configured) parts.push(`Ollama(${info.providers.ollama_cloud.source})`);
  if (info.providers?.uncensoredllm?.configured) parts.push(`UncensoredLLM(${info.providers.uncensoredllm.source})`);
  if (info.configured) {
    badge.className = 'badge completed';
    badge.textContent = parts.length ? `Connected: ${parts.join(' + ')}` : `Cloud Connected (${info.source})`;
  } else {
    badge.className = 'badge idle';
    badge.textContent = 'Offline (Local Advisor Mode)';
  }
}

function renderAiChatFeed({ forceScroll = false } = {}) {
  const feed = $('ai-chat-feed');
  if (!feed) return;
  const prevScrollTop = feed.scrollTop;
  const wasNearBottom = feed.scrollHeight <= feed.clientHeight + 10
    || (feed.scrollHeight - feed.scrollTop - feed.clientHeight) <= 50;

  feed.innerHTML = '';
  const scrollBtn = $('btn-ai-scroll-bottom');
  if (!state.aiHistory.length) {
    const p = document.createElement('div');
    p.style.color = 'var(--muted)';
    p.style.fontSize = '0.86rem';
    p.textContent = 'Chat with the AI Fleet Commander or issue real-time directives (adjust waves, concurrency, pause/resume, or assign field tasks).';
    feed.appendChild(p);
    if (scrollBtn) scrollBtn.classList.remove('has-unread');
    return;
  }
  state.aiHistory.forEach(msg => {
    const card = document.createElement('div');
    card.className = `ai-msg ${msg.role || 'assistant'}`;
    card.textContent = msg.content || '';
    const metaParts = [];
    if (msg.model) metaParts.push(msg.model);
    if (Array.isArray(msg.applied) && msg.applied.length) metaParts.push(`Applied: ${msg.applied.join(', ')}`);
    if (msg.ts) metaParts.push(new Date(msg.ts).toLocaleTimeString('en-GB', { hour12: false }));
    if (metaParts.length) {
      const meta = document.createElement('div');
      meta.className = 'ai-msg-meta';
      meta.textContent = metaParts.join(' • ');
      card.appendChild(meta);
    }
    feed.appendChild(card);
  });

  if (forceScroll || wasNearBottom) {
    feed.scrollTop = feed.scrollHeight;
    if (scrollBtn) {
      scrollBtn.classList.remove('has-unread');
      scrollBtn.textContent = '⬇️ Scroll to Bottom';
    }
  } else {
    feed.scrollTop = prevScrollTop;
    if (scrollBtn) {
      scrollBtn.classList.add('has-unread');
      scrollBtn.textContent = '⬇️ New updates below';
    }
  }
}

// ─── Actions & SSE ────────────────────────────────────────────────────────────

const RECORDER_CC_LABEL = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia', DE: 'Germany', AT: 'Austria',
  FR: 'France', IT: 'Italy', NL: 'Netherlands', CZ: 'Czechia', RO: 'Romania', JP: 'Japan',
  KR: 'South Korea', SG: 'Singapore',
};

function flagOf(cc) {
  const key = String(cc || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(key)) return '🌐';
  return String.fromCodePoint(...[...key].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}

function countryLabel(cc) {
  const key = String(cc || '').toUpperCase();
  if (!key) return 'Unknown';
  return `${flagOf(key)} ${RECORDER_CC_LABEL[key] || key}`;
}

// Populate the proxy selector in the recorder panel (country · city — host:port, with ✅/⛔ offer status).
async function loadRecorderProxyList() {
  const group = $('recorder-proxy-country-group');
  if (!group) return;
  group.innerHTML = '<option value="" disabled>Loading proxy list…</option>';
  try {
    const data = await api('/api/proxy/list');
    const list = Array.isArray(data?.proxies) ? data.proxies : [];
    if (!list.length) {
      group.innerHTML = '<option value="" disabled>No proxies found in config</option>';
      return;
    }
    const order = Object.keys(RECORDER_CC_LABEL);
    list.sort((a, b) => {
      const ia = order.indexOf(a.cc);
      const ib = order.indexOf(b.cc);
      return ((ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)) || String(a.city || '').localeCompare(String(b.city || ''));
    });
    group.innerHTML = list.map(p => {
      const offerMark = p.offerOk === true ? '✅' : (p.offerOk === false ? '⛔' : '');
      const city = p.city ? ` · ${p.city}` : '';
      const ms = p.ms ? ` · ${p.ms}ms` : '';
      // The metered gateway publishes one host:port for every sticky session, so it has no single country.
      const label = p.cc ? countryLabel(p.cc) : (/webshare/i.test(p.hostPort) ? '🌍 Residential (Webshare)' : 'Unknown');
      return `<option value="${p.hostPort}">${label}${city} — ${p.hostPort}${ms} ${offerMark}</option>`;
    }).join('');
  } catch {
    group.innerHTML = '<option value="" disabled>Failed to load proxy list</option>';
  }
}

function wireActions() {
  [
    'targetUrl', 'engineMode', 'browserEngine', 'taskMode', 'visitCount', 'minConcurrency', 'concurrency',
    'pageMinMs', 'sessionTimeoutMs', 'keepBrowserOpenMs', 'interVisitDelayMs', 'firstPagePriority', 'quick-watch-mode',
    'schedule-enabled', 'schedule-start', 'schedule-end', 'snippet',
    'proxy-enabled', 'proxy-tier', 'proxy-residential-country', 'proxy-mode', 'proxy-country-filter', 'proxy-country-fallback', 'proxy-servers',
    'stealth-mode', 'resource-mode',
    'waves-enabled', 'waves-mode', 'waves-conversion-rate', 'referrer-mode', 'waves-mutation-rate', 'waves-scan-chance', 'waves-extra-page-chance', 'waves-max-products', 'waves-mutate-forms', 'waves-form-inputs',
    'ai-enabled', 'ai-auto-manage', 'ai-provider', 'ai-commander-model', 'ai-worker-model', 'ai-all-squads-model', 'ai-recovery-model', 'ai-form-assist', 'ai-route-repair', 'ai-worker-pct', 'ai-directive-input',
    'session-enabled', 'session-returning-rate', 'session-pool-size',
    'ad-avoid-clicks', 'ad-dismiss-overlays', 'ad-close-popunders', 'ad-skip-telemetry',
  ].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', collectSimpleFieldsToConfig);
    el.addEventListener('change', collectSimpleFieldsToConfig);
  });

  $('quick-selectors-bar')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-qtype]');
    if (!btn) return;
    if (!Array.isArray(state.config.taskSteps)) state.config.taskSteps = [];
    if (state.config.taskMode === 'behavior') {
      state.config.taskMode = 'scenario';
      $('taskMode').value = 'scenario';
    }
    state.config.taskSteps.push({
      type: btn.dataset.qtype,
      selector: btn.dataset.qsel || '',
      value: btn.dataset.qval || '',
      assertKind: 'text_contains',
      label: btn.dataset.qlbl || '',
    });
    renderTaskSteps();
    renderJsonPreview();
    showToast(`Added step: ${btn.dataset.qlbl || btn.dataset.qtype}`);
  });

  $('btn-discover-pages').onclick = async () => {
    collectSimpleFieldsToConfig();
    const targetUrl = state.config.targetUrl;
    if (!targetUrl) {
      showToast('Please enter a targetUrl first.', true);
      return;
    }
    const btn = $('btn-discover-pages');
    btn.disabled = true;
    btn.textContent = 'Scanning site...';
    try {
      const res = await api('/api/discover', { method: 'POST', body: JSON.stringify({ targetUrl }) });
      if (Array.isArray(res.pages) && res.pages.length) {
        state.config.pages = res.pages;
        renderPages();
        renderJsonPreview();
        showToast(`Discovered ${res.pages.length} pages (HTTP ${res.rootStatus})! Click "Save Settings" or "Start Run".`);
      } else {
        showToast('No additional internal links found beyond /.');
      }
    } catch (err) {
      showToast('Page discovery failed: ' + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Discover Site Pages 🔍';
    }
  };

  $('proxy-residential-country')?.addEventListener('change', () => {
    renderCountriesSelector();
  });

  $('targetUrl')?.addEventListener('change', () => {
    const raw = $('targetUrl')?.value.trim() || '';
    try {
      const h = new URL(raw).hostname;
      const box = $('onboard-ai-result');
      if (box) {
        box.style.display = 'block';
        box.textContent = `🔄 Detected new target (${h}). Click "✨ Scan Site & Auto-Adapt with AI" to discover live pages (avoiding 404s) and tailor AI workers!`;
      }
    } catch {}
  });

  if ($('btn-onboard-site')) {
    $('btn-onboard-site').onclick = async () => {
      collectSimpleFieldsToConfig();
      const targetUrl = $('targetUrl')?.value.trim() || state.config?.targetUrl;
      if (!targetUrl) {
        showToast('Please enter a targetUrl first.', true);
        return;
      }
      const btn = $('btn-onboard-site');
      const resBox = $('onboard-ai-result');
      btn.disabled = true;
      btn.textContent = '🤖 Scanning site & auto-adapting with AI...';
      if (resBox) {
        resBox.style.display = 'block';
        resBox.textContent = 'Scanning site pages, analyzing buttons/tools/guides, and configuring AI workers...';
      }
      try {
        const res = await api('/api/ai/onboard-site', {
          method: 'POST',
          body: JSON.stringify({
            targetUrl,
            goal: $('onboard-goal')?.value || 'tools_clicks',
            aiLevel: $('onboard-ai-level')?.value || 'full_autonomous',
            proxyTier: $('proxy-tier')?.value || state.config?.proxy?.tier || 'datacenter',
            country: $('proxy-residential-country')?.value ?? '',
            visitCount: Number($('visitCount')?.value) || state.config?.visitCount || 500,
            userNotes: $('onboard-user-notes')?.value.trim() || '',
            rebuildSteps: Boolean($('onboard-rebuild-steps')?.checked),
          }),
        });
        if (res && res.config) {
          state.config = res.config;
          syncFormFromConfig();
          renderJsonPreview();
        }
        if (resBox && res.reply) {
          resBox.style.display = 'block';
          resBox.textContent = res.reply;
        }
        showToast(`✅ Site ${res.siteTitle || targetUrl} scanned & auto-adapted (${(res.discoveredPages || []).length} pages)!`);
      } catch (err) {
        if (resBox) {
          resBox.style.display = 'block';
          resBox.textContent = 'Auto-adapt error: ' + err.message;
        }
        showToast('Site auto-adapt failed: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = '✨ Scan Site & Auto-Adapt with AI';
      }
    };
  }

  const addTargetHelper = async ({ autoDiscover = false } = {}) => {
    if (!state.config) return;
    const rawUrl = $('new-target-url')?.value.trim() || '';
    if (!rawUrl) {
      showToast('Enter a target URL in the multi-target field.', true);
      return;
    }
    let cleanUrl;
    try {
      const u = new URL(rawUrl);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Invalid protocol');
      cleanUrl = u.toString().replace(/\/$/, '');
    } catch {
      showToast('Target URL must be a valid full URL (https://...)', true);
      return;
    }

    const rawPagesStr = $('new-target-pages')?.value.trim() || '';
    let pages = rawPagesStr
      ? rawPagesStr.split(',').map(s => s.trim()).filter(Boolean).map(p => (p.startsWith('/') ? p : '/' + p))
      : [];
    const visitCount = Math.max(0, parseInt(String($('new-target-visits')?.value || '0'), 10) || 0);

    if (autoDiscover || !pages.length) {
      const btn = $('btn-discover-add-target');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Scanning target...';
      }
      try {
        const res = await api('/api/discover', { method: 'POST', body: JSON.stringify({ targetUrl: cleanUrl }) });
        if (Array.isArray(res.pages) && res.pages.length) {
          pages = res.pages;
        }
      } catch (err) {
        showToast('Target discovery failed; adding with / only: ' + err.message, true);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🔍 Discover Pages & Add +';
        }
      }
    }
    if (!pages.length) pages = ['/'];

    if (!Array.isArray(state.config.targets)) state.config.targets = [];
    // If adding a secondary site when targets[] was empty, also include the primary targetUrl as Target #1
    if (state.config.targets.length === 0 && state.config.targetUrl && state.config.targetUrl.replace(/\/$/, '') !== cleanUrl) {
      state.config.targets.push({
        url: state.config.targetUrl.replace(/\/$/, ''),
        pages: Array.isArray(state.config.pages) && state.config.pages.length ? [...state.config.pages] : ['/'],
        visitCount: 0,
      });
    }
    state.config.targets.push({ url: cleanUrl, pages, visitCount });
    if ($('new-target-url')) $('new-target-url').value = '';
    if ($('new-target-pages')) $('new-target-pages').value = '';
    if ($('new-target-visits')) $('new-target-visits').value = '';
    renderTargets();
    renderJsonPreview();
    showToast(`Added multi-target site: ${cleanUrl} (${pages.length} pages)`);
  };

  if ($('btn-add-target')) {
    $('btn-add-target').onclick = () => addTargetHelper({ autoDiscover: false });
  }
  if ($('btn-discover-add-target')) {
    $('btn-discover-add-target').onclick = () => addTargetHelper({ autoDiscover: true });
  }
  if ($('btn-clear-targets')) {
    $('btn-clear-targets').onclick = () => {
      if (!state.config) return;
      state.config.targets = [];
      renderTargets();
      renderJsonPreview();
      showToast('Extra targets cleared — running against primary targetUrl only.');
    };
  }

  $('btn-add-step').onclick = () => {
    if (!Array.isArray(state.config.taskSteps)) state.config.taskSteps = [];
    state.config.taskSteps.push({ type: 'goto', selector: '', value: '/', assertKind: 'text_contains', label: '' });
    renderTaskSteps();
    renderJsonPreview();
  };

  $('btn-clear-steps').onclick = () => {
    state.config.taskSteps = [];
    renderTaskSteps();
    renderJsonPreview();
  };

  $('btn-recorder-start').onclick = async () => {
    const startBtn = $('btn-recorder-start');
    const urlInput = $('targetUrl').value.trim();
    if (!urlInput) {
      showToast('Please enter a target URL before starting recording.', true);
      return;
    }
    startBtn.disabled = true;
    startBtn.textContent = '⏳ Launching recorder browser...';
    try {
      const modeRaw = $('recorder-proxy-mode')?.value || 'resi:';
      // `resi:<cc>` = metered residential pool pinned to one country (Webshare `-<cc>` suffix).
      const isResi = modeRaw.startsWith('resi:');
      const proxyMode = isResi ? 'auto' : modeRaw;
      const proxyCountry = isResi ? modeRaw.slice(5) : '';
      const data = await api('/api/recorder/start', {
        method: 'POST',
        body: JSON.stringify({ targetUrl: urlInput, proxyMode, proxyCountry }),
      });
      renderRecorderState(data.recorder);
      const isDirect = !data.proxyHost || data.proxyHost === 'DIRECT';
      const geoLabel = isDirect
        ? ' (Direct — your local IP)'
        : ` (Exit: ${countryLabel(data.proxyCountry)} · ${data.proxyHost})`;
      const statusEl = $('recorder-proxy-status');
      if (statusEl) {
        statusEl.textContent = isDirect
          ? '🌐 Recorder IP: Direct from local machine'
          : `📍 Recorder IP: ${countryLabel(data.proxyCountry)} · ${data.proxyHost}`;
      }
      showToast(`Opened recording browser${geoLabel}! Click "Stop Recording" or close it when done.`);
    } catch (err) {
      startBtn.disabled = false;
      startBtn.textContent = '🔴 Record Journey in Browser';
      showToast(`Failed to start recorder: ${err.message}`, true);
    }
  };

  $('btn-recorder-stop').onclick = async () => {
    const stopBtn = $('btn-recorder-stop');
    stopBtn.disabled = true;
    try {
      const data = await api('/api/recorder/stop', { method: 'POST' });
      renderRecorderState(data.recorder);
      await importRecordedSteps(data.recorder, { force: true });
      if (!data.recorder?.steps?.length) {
        showToast('Recording closed with no recorded steps.');
      }
    } catch (err) {
      stopBtn.disabled = false;
      showToast(`Failed to stop recording: ${err.message}`, true);
    }
  };

  if ($('btn-recorder-focus')) {
    $('btn-recorder-focus').onclick = async () => {
      try {
        const res = await api('/api/recorder/focus', { method: 'POST' });
        showToast(
          res.ok
            ? (res.reason || 'Recorder window brought to front.')
            : (res.reason || 'No open recorder window found.'),
          !res.ok
        );
      } catch (err) {
        showToast(`Error focusing recorder window: ${err.message}`, true);
      }
    };
  }

  const refreshProxyBtn = $('btn-recorder-proxy-refresh');
  if (refreshProxyBtn) {
    refreshProxyBtn.onclick = async () => {
      refreshProxyBtn.disabled = true;
      await loadRecorderProxyList();
      refreshProxyBtn.disabled = false;
      showToast('Proxy list refreshed — choose a country and start recording.');
    };
  }
  loadRecorderProxyList();

  $('btn-recorder-load-last').onclick = async () => {
    try {
      const rec = state.recorder?.steps?.length ? state.recorder : (await api('/api/recorder/status')).recorder;
      const ok = await importRecordedSteps(rec, { force: true });
      if (!ok) showToast('No recorded steps available to load.', true);
    } catch (err) {
      showToast(`Failed to load recorded steps: ${err.message}`, true);
    }
  };

  $('btn-inspect-page').onclick = async () => {
    collectSimpleFieldsToConfig();
    const targetUrl = state.config.targetUrl;
    const pagePath = $('mapper-page-input').value.trim() || '/';
    if (!targetUrl && !/^https?:\/\//i.test(pagePath)) {
      showToast('Enter a targetUrl or full URL to inspect.', true);
      return;
    }
    const btn = $('btn-inspect-page');
    btn.disabled = true;
    btn.textContent = 'Inspecting page in browser...';
    try {
      const res = await api('/api/inspect-page', {
        method: 'POST',
        body: JSON.stringify({ targetUrl, pagePath }),
      });
      state.mappedPage = res.mapped;
      state.mapperFilter = '';
      if ($('mapper-filter-input')) $('mapper-filter-input').value = '';
      renderPageMapperResults();
      const s = res.mapped?.summary || {};
      showToast(`Mapped: ${s.buttons || 0} buttons, ${s.links || 0} links, ${s.inputs || 0} inputs, ${s.sections || 0} sections, ${s.adSlots || 0} ad slots.`);
    } catch (err) {
      showToast('Page inspection failed: ' + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = '🔍 Inspect Page Elements';
    }
  };

  $('mapper-category-tabs').addEventListener('click', e => {
    const btn = e.target.closest('button[data-mcat]');
    if (!btn) return;
    state.mapperCategory = btn.dataset.mcat;
    renderPageMapperResults();
  });

  $('mapper-filter-input').addEventListener('input', e => {
    state.mapperFilter = e.target.value;
    renderPageMapperResults();
  });

  $('btn-tpl-demosite').onclick = () => {
    state.config.targetUrl = `${location.origin}/demo-site`;
    state.config.pages = ['/', '/about', '/pricing', '/contact'];
    state.config.taskMode = 'scenario';
    state.config.visitCount = 1;
    state.config.minConcurrency = 1;
    state.config.concurrency = 1;
    state.config.headless = true;
    state.config.keepBrowserOpenMs = 2000;
    state.config.taskSteps = [
      { type: 'goto', selector: '', value: '/contact', label: 'Open contact page' },
      { type: 'fill', selector: 'input[name="name"]', value: 'Avi QA Tester', label: 'Enter full name' },
      { type: 'fill', selector: 'input[name="email"]', value: 'qa@hirepulse.dev', label: 'Enter email' },
      { type: 'select', selector: 'select[name="topic"]', value: 'demo', label: 'Select topic' },
      { type: 'fill', selector: 'textarea[name="message"]', value: 'Automated end-to-end task verification test', label: 'Enter message' },
      { type: 'click', selector: 'button[type="submit"]', value: '', label: 'Submit form' },
      { type: 'wait', selector: '', value: '400', label: 'Wait for response' },
      { type: 'assert', selector: '#form-status', value: 'Form received by QA Sandbox!', assertKind: 'text_contains', label: 'Verify success banner' },
    ];
    syncFormFromConfig();
    showToast('Loaded demo site form fill & assertion scenario!');
  };

  $('btn-tpl-landing').onclick = () => {
    state.config.taskMode = 'scenario';
    state.config.taskSteps = [
      { type: 'goto', selector: '', value: '/', label: 'Load home page' },
      { type: 'assert', selector: '', value: '', assertKind: 'status_ok', label: 'Assert HTTP 200' },
      { type: 'scroll', selector: '', value: '60', label: 'Scroll to 60%' },
      { type: 'wait', selector: '', value: '1200', label: 'Reading dwell' },
      { type: 'screenshot', selector: '', value: 'Landing Check', label: 'Capture home screenshot' },
    ];
    syncFormFromConfig();
    showToast('Loaded landing page + scroll + screenshot scenario.');
  };

  $('btn-add-page').onclick = () => {
    const inp = $('new-page-input');
    let val = inp.value.trim();
    if (!val) return;
    if (!val.startsWith('/')) val = '/' + val;
    if (!state.config.pages.includes(val)) {
      state.config.pages.push(val);
      renderPages();
      renderJsonPreview();
    }
    inp.value = '';
  };

  $('new-page-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('btn-add-page').click();
    }
  });

  $('btn-use-demo-url').onclick = () => {
    state.config.targetUrl = `${location.origin}/demo-site`;
    state.config.pages = ['/', '/about', '/pricing', '/contact'];
    syncFormFromConfig();
    showToast('Target URL set to built-in demo site.');
  };

  $('btn-demo-preset').onclick = () => {
    state.config.targetUrl = `${location.origin}/demo-site`;
    state.config.pages = ['/', '/about', '/pricing', '/contact'];
    state.config.engineMode = 'crawlee_autoscaled';
    state.config.taskMode = 'behavior';
    state.config.visitCount = 3;
    state.config.minConcurrency = 1;
    state.config.concurrency = 2;
    state.config.pageMinMs = 2000;
    state.config.sessionTimeoutMs = 45000;
    state.config.keepBrowserOpenMs = 2000;
    state.config.firstPagePriority = 60;
    state.config.headless = false;
    state.config.schedule = { enabled: false, startHour: '00:00', endHour: '23:59' };
    state.config.proxy = { ...(state.config.proxy || {}), enabled: false };
    state.config.sessionPersistence = { enabled: true, returningUserRate: 50, profilePoolSize: 5 };
    state.config.snippet = `<script>\nconsole.log('[QA-Monitor] Synthetic snippet active on', location.pathname);\n</script>`;
    syncFormFromConfig();
    showToast('Loaded visible demo preset (3 visits). Click "Start Run ▶" to watch!');
  };

  $('btn-apply-recommended-conc').onclick = () => {
    if (!state.system) return;
    state.config.minConcurrency = 1;
    state.config.concurrency = state.system.concurrencyAdvice.recommended;
    syncFormFromConfig();
    showToast(`Concurrency automatically matched to 1–${state.config.concurrency}.`);
  };

  document.querySelectorAll('.preset-scale-btn').forEach((btn) => {
    btn.onclick = () => {
      const visits = Number(btn.dataset.visits) || 100;
      const minConc = Number(btn.dataset.min) || 2;
      const maxConc = Number(btn.dataset.max) || 6;
      const ramMode = btn.dataset.ram || 'ultra_lite';
      const engine = btn.dataset.engine || 'crawlee_autoscaled';
      state.config.engineMode = engine;
      state.config.visitCount = visits;
      state.config.minConcurrency = minConc;
      state.config.concurrency = maxConc;
      state.config.resourceMode = ramMode;
      state.config.stealthMode = 'maximum';
      state.config.headless = true;
      state.config.interVisitDelayMs = (visits >= 500 || engine === 'http_fast')
        ? 0
        : Math.min(Number(state.config.interVisitDelayMs ?? 0) || 0, 500);
      delete state.config.waveConfig;
      state.config.waves = {
        ...(state.config.waves || {}),
        enabled: true,
        mode: (visits >= 1000 || engine === 'http_fast') ? 'burst' : 'natural_peaks',
      };
      syncFormFromConfig();
      const modeTag = engine === 'http_fast' ? 'HTTP Fast (Browserless)' : `Headless background, RAM mode: ${ramMode}`;
      showToast(`Configured scale run of ${visits.toLocaleString('en-US')} sessions (concurrency ${minConc}–${maxConc}, delay ${state.config.interVisitDelayMs}ms, ${modeTag}).`);
    };
  });

  // ─── HirePulse Owner Pilot Live Inbox UI ───────────────────────────────────
  let currentLiveInboxId = null;
  api('/api/email/status')
    .then(res => {
      const badge = $('email-pilot-status-badge');
      const pilotBox = $('agent-email-pilot-box');
      if (!badge) return;
      if (res.email?.configured) {
        badge.textContent = res.email.isFreeOwnerPilot
          ? 'Connected (Owner Pilot)'
          : 'Connected (API Key)';
        $('btn-create-live-inbox').disabled = false;
        badge.style.color = '#4ade80';
        if (pilotBox) pilotBox.style.display = '';
      } else {
        // Optional feature: no key means no inbox — the box simply stays out of the way instead of
        // asking the operator to set an environment variable that traffic generation never needs.
        badge.textContent = 'Unconfigured — live inbox disabled';
        badge.style.color = '#94a3b8';
        if (pilotBox) pilotBox.style.display = 'none';
      }
    })
    .catch(() => {});

  if ($('btn-create-live-inbox')) {
    $('btn-create-live-inbox').onclick = async () => {
      const btn = $('btn-create-live-inbox');
      btn.disabled = true;
      btn.textContent = 'Creating inbox…';
      try {
        const res = await api('/api/email/create', { method: 'POST', body: JSON.stringify({ ttlSeconds: 600 }) });
        currentLiveInboxId = res.inbox.inbox_id;
        $('live-inbox-address').value = res.inbox.address || '';
        $('btn-copy-live-inbox').disabled = false;
        $('btn-check-live-otp').disabled = false;
        $('live-otp-result').textContent = 'Inbox ready. Waiting for verification email.';
        showToast('Live inbox created.');
      } catch (err) {
        showToast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create live inbox';
      }
    };
  }

  if ($('btn-copy-live-inbox')) {
    $('btn-copy-live-inbox').onclick = async () => {
      const addr = $('live-inbox-address')?.value;
      if (!addr) return;
      try {
        await navigator.clipboard.writeText(addr);
        showToast('Inbox address copied.');
      } catch {
        showToast('Please copy manually from the field.', true);
      }
    };
  }

  if ($('btn-check-live-otp')) {
    $('btn-check-live-otp').onclick = async () => {
      if (!currentLiveInboxId) return;
      const btn = $('btn-check-live-otp');
      btn.disabled = true;
      btn.textContent = 'Checking inbox...';
      try {
        const res = await api(`/api/email/code/${encodeURIComponent(currentLiveInboxId)}`);
        if (res.status === 'link_confirmed' && res.confirmationUrl) {
          $('live-otp-result').textContent = '✅ Email verified automatically! (confirmation link opened)';
          $('live-otp-result').style.color = '#4ade80';
          showToast('Confirmation link received and verified automatically!');
        } else if (res.status === 'code' && res.code) {
          $('live-otp-result').textContent = `🔑 Verification Code: ${res.code}`;
          $('live-otp-result').style.color = '#4ade80';
          try { await navigator.clipboard.writeText(String(res.code)); } catch {}
          showToast('Verification code received.');
        } else if (res.status === 'message_received') {
          $('live-otp-result').textContent = `📩 Email received: "${res.subject || 'New message'}"`;
          $('live-otp-result').style.color = '#4ade80';
          showToast(`Email received: ${res.subject || ''}`);
        } else {
          $('live-otp-result').textContent = `⏳ Still waiting for email (${res.status})... try again in 2s`;
          showToast('No verification code received yet — wait 2 seconds and retry.');
        }
      } catch (err) {
        showToast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Check verification code';
      }
    };
  }

  $('btn-dev-default').onclick = () => {
    state.config.devices = { desktopChrome: 40, iphone14: 20, pixel7: 12, desktopFirefox: 10, desktopSafari: 10, ipadPro: 8 };
    renderDevices();
    renderJsonPreview();
  };

  $('btn-dev-mobile').onclick = () => {
    state.config.devices = { desktopChrome: 20, iphone14: 40, pixel7: 25, desktopFirefox: 5, desktopSafari: 5, ipadPro: 5 };
    renderDevices();
    renderJsonPreview();
  };

  $('btn-dev-desktop').onclick = () => {
    state.config.devices = { desktopChrome: 60, iphone14: 0, pixel7: 0, desktopFirefox: 20, desktopSafari: 20, ipadPro: 0 };
    renderDevices();
    renderJsonPreview();
  };

  $('btn-add-persona').onclick = () => {
    state.config.personas.push({
      name: `custom_${state.config.personas.length + 1}`,
      scrollDepth: 0.6,
      clickRate: 0.6,
      readTime: [1000, 3000],
      pageCount: [2, 3],
      idleChance: 0.1,
      resizeChance: 0.1,
      uTurnChance: 0.1,
    });
    renderPersonas();
    renderJsonPreview();
  };

  $('btn-reset-personas').onclick = () => {
    if (!state.defaultConfig) return;
    state.config.personas = structuredClone(state.defaultConfig.personas);
    renderPersonas();
    renderJsonPreview();
    showToast('Personas reset to defaults.');
  };

  $('btn-sample-snippet').onclick = () => {
    state.config.snippet = `<script>\nwindow.__qaSyntheticHit = (window.__qaSyntheticHit || 0) + 1;\nconsole.log('[Analytics-Check] Page loaded:', location.pathname, 'hit #' + window.__qaSyntheticHit);\n</script>`;
    syncFormFromConfig();
  };

  $('btn-clear-snippet').onclick = () => {
    state.config.snippet = null;
    syncFormFromConfig();
  };

  $('btn-test-proxies').onclick = async () => {
    collectSimpleFieldsToConfig();
    const servers = state.config.proxy?.servers || [];
    if (!servers.length) {
      showToast('Enter at least one proxy server to test.', true);
      return;
    }
    const btn = $('btn-test-proxies');
    btn.disabled = true;
    btn.textContent = 'Testing proxies...';
    try {
      const res = await api('/api/proxies/test', { method: 'POST', body: JSON.stringify({ servers }) });
      renderProxyTestResults(res.results);
      const okCount = (res.results || []).filter(r => r.ok).length;
      showToast(`Proxy test complete: ${okCount} of ${res.results.length} passed.`);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test Proxies';
    }
  };

  $('btn-clear-profiles').onclick = async () => {
    try {
      const res = await api('/api/profiles', { method: 'DELETE' });
      renderProfiles(res.profiles);
      showToast('All persistent profiles cleared.');
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $('btn-save').onclick = async () => {
    try {
      collectSimpleFieldsToConfig();
      const res = await api('/api/config', { method: 'PUT', body: JSON.stringify(state.config) });
      state.config = res.config;
      syncFormFromConfig();
      showToast('Settings saved to config.json and proxies.txt!');
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $('site-profile-select').onchange = updateSelectedProfileDesc;

  $('btn-profile-load').onclick = async () => {
    const id = $('site-profile-select').value;
    if (!id) return;
    try {
      const res = await api(`/api/site-profiles/${encodeURIComponent(id)}/load`, { method: 'POST' });
      state.config = res.config;
      state.siteProfiles = res.profiles || state.siteProfiles;
      state.activeProfileId = res.activeProfileId || id;
      syncFormFromConfig();
      renderSiteProfilesBar();
      showToast(`Profile "${res.profile.name}" loaded — click "Start Run ▶" to begin!`);
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $('btn-profile-update').onclick = async () => {
    const id = $('site-profile-select').value;
    if (!id) return;
    try {
      collectSimpleFieldsToConfig();
      await api('/api/config', { method: 'PUT', body: JSON.stringify(state.config) });
      const res = await api(`/api/site-profiles/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ config: state.config }),
      });
      state.siteProfiles = res.profiles || state.siteProfiles;
      state.activeProfileId = res.activeProfileId || id;
      renderSiteProfilesBar();
      showToast(`Changes saved to profile "${res.profile.name}"!`);
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $('btn-profile-new-toggle').onclick = () => {
    $('new-profile-drawer').classList.toggle('open');
  };

  $('btn-profile-cancel').onclick = () => {
    $('new-profile-drawer').classList.remove('open');
  };

  $('btn-profile-create').onclick = async () => {
    const name = $('new-profile-name').value.trim();
    const description = $('new-profile-desc').value.trim();
    if (!name) {
      showToast('Enter a name for the new profile.', true);
      return;
    }
    try {
      collectSimpleFieldsToConfig();
      await api('/api/config', { method: 'PUT', body: JSON.stringify(state.config) });
      const res = await api('/api/site-profiles', {
        method: 'POST',
        body: JSON.stringify({ name, description, category: 'custom', config: state.config }),
      });
      state.siteProfiles = res.profiles || [];
      state.activeProfileId = res.activeProfileId || res.profile.id;
      $('new-profile-name').value = '';
      $('new-profile-desc').value = '';
      $('new-profile-drawer').classList.remove('open');
      renderSiteProfilesBar();
      showToast(`Created new profile: "${res.profile.name}"!`);
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $('btn-profile-delete').onclick = async () => {
    const id = $('site-profile-select').value;
    if (!id) return;
    try {
      const res = await api(`/api/site-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.siteProfiles = res.profiles || [];
      state.activeProfileId = res.activeProfileId || null;
      renderSiteProfilesBar();
      showToast('Profile deleted.');
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $('btn-start').onclick = async () => {
    try {
      collectSimpleFieldsToConfig();
      const res = await api('/api/run/start', { method: 'POST', body: JSON.stringify({ config: state.config, streamMode: false }) });
      renderRunStatus(res.status);
      showToast('Run started! Monitor live logs and concurrency.');
    } catch (err) {
      showToast(err.message, true);
    }
  };

  if ($('btn-stream')) {
    $('btn-stream').onclick = async () => {
      try {
        collectSimpleFieldsToConfig();
        const res = await api('/api/run/start', { method: 'POST', body: JSON.stringify({ config: state.config, streamMode: true }) });
        renderRunStatus(res.status);
        showToast('🌊 Continuous stream mode started! Waves will run until you click Stop.');
      } catch (err) {
        showToast(err.message, true);
      }
    };
  }

  $('btn-pause').onclick = async () => {
    try {
      const res = await api('/api/run/pause', { method: 'POST' });
      renderRunStatus(res.status);
      showToast('Run paused.');
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $('btn-resume').onclick = async () => {
    try {
      const res = await api('/api/run/resume', { method: 'POST' });
      renderRunStatus(res.status);
      showToast('Run resumed.');
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $('btn-stop').onclick = async () => {
    try {
      const res = await api('/api/run/stop', { method: 'POST' });
      renderRunStatus(res.status);
      showToast('Stop signal sent.');
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $('btn-reset-config').onclick = async () => {
    try {
      const res = await api('/api/config/reset', { method: 'POST' });
      state.config = res.config;
      syncFormFromConfig();
      showToast('config.json reset to defaults.');
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $('btn-copy-json').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('json-preview').textContent);
      showToast('JSON copied to clipboard!');
    } catch {
      showToast('Clipboard copy unavailable in this browser.', true);
    }
  };

  $('btn-clear-logs').onclick = () => { $('log-box').innerHTML = ''; };
  $('btn-clear-demo').onclick = async () => {
    await api('/api/demo-events', { method: 'DELETE' });
    state.demoEvents = [];
    renderDemoEvents();
  };

  if ($('btn-countries-tier1')) {
    $('btn-countries-tier1').onclick = () => {
      if (!state.config.proxy) state.config.proxy = {};
      state.config.proxy.preferredCountries = [...state.tier1Defaults];
      renderCountriesSelector();
      renderJsonPreview();
      showToast('Selected 5 Tier-1 default countries.');
    };
  }
  if ($('btn-countries-all')) {
    $('btn-countries-all').onclick = () => {
      if (!state.config.proxy) state.config.proxy = {};
      state.config.proxy.preferredCountries = state.countryCatalog.map(c => c.code);
      renderCountriesSelector();
      renderJsonPreview();
    };
  }
  if ($('btn-countries-clear')) {
    $('btn-countries-clear').onclick = () => {
      if (!state.config.proxy) state.config.proxy = {};
      state.config.proxy.preferredCountries = [];
      renderCountriesSelector();
      renderJsonPreview();
    };
  }

  if ($('btn-ai-send-directive')) {
    $('btn-ai-send-directive').onclick = async () => {
      collectSimpleFieldsToConfig();
      const directive = $('ai-directive-input')?.value.trim() || '';
      try {
        const res = await api('/api/ai/directive', { method: 'POST', body: JSON.stringify({ directive }) });
        showToast(res.liveDelivered ? 'Directive dispatched to active fleet!' : 'Directive saved for next run.');
      } catch (err) {
        showToast(err.message, true);
      }
    };
  }

  const sendAiChat = async customText => {
    const inputEl = $('ai-chat-input');
    const message = (customText ?? inputEl?.value ?? '').trim();
    if (!message) return;
    if (!customText && inputEl) inputEl.value = '';
    collectSimpleFieldsToConfig();
    state.aiHistory.push({ role: 'user', content: message, ts: new Date().toISOString() });
    renderAiChatFeed({ forceScroll: true });
    const btn = $('btn-ai-chat-send');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'AI Commander thinking...';
    }
    try {
      const res = await api('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          message,
          provider: state.config?.ai?.provider || 'auto',
          model: state.config?.ai?.commanderModel,
          autoApply: true,
        }),
      });
      const existsSame = state.aiHistory.some(
        x => x.ts && res.ts && x.ts === res.ts && x.content === res.content
      );
      if (!existsSame) {
        state.aiHistory.push({
          role: 'assistant',
          content: res.content,
          directives: res.directives,
          applied: res.applied,
          model: res.provider ? `${res.provider}: ${res.model}` : res.model,
          ts: res.ts || new Date().toISOString(),
        });
      }
      renderAiChatFeed({ forceScroll: true });
    } catch (err) {
      showToast('AI Commander error: ' + err.message, true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Send to Commander ↗';
      }
    }
  };

  if ($('btn-ai-chat-send')) {
    $('btn-ai-chat-send').onclick = () => sendAiChat();
  }
  if ($('ai-chat-input')) {
    $('ai-chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendAiChat();
      }
    });
  }
  document.querySelectorAll('.ai-quick-btn').forEach(b => {
    b.addEventListener('click', () => sendAiChat(b.dataset.aiprompt || ''));
  });
  if ($('btn-live-pause')) {
    $('btn-live-pause').onclick = () => {
      state.livePreviewPaused = !state.livePreviewPaused;
      $('btn-live-pause').textContent = state.livePreviewPaused ? '▶️ Resume Preview' : '⏸️ Pause Preview';
      api('/api/run/preview', { method: 'POST', body: JSON.stringify({ active: !state.livePreviewPaused && !state.livePreviewHidden }) }).catch(() => {});
    };
  }
  if ($('btn-live-toggle')) {
    $('btn-live-toggle').onclick = () => {
      state.livePreviewHidden = !state.livePreviewHidden;
      const body = $('live-screen-body');
      if (body) body.style.display = state.livePreviewHidden ? 'none' : 'block';
      $('btn-live-toggle').textContent = state.livePreviewHidden ? '👁️ Show Preview' : '🙈 Hide';
      api('/api/run/preview', { method: 'POST', body: JSON.stringify({ active: !state.livePreviewPaused && !state.livePreviewHidden }) }).catch(() => {});
    };
  }
  if ($('btn-ai-scroll-bottom')) {
    $('btn-ai-scroll-bottom').onclick = () => {
      const feed = $('ai-chat-feed');
      if (feed) {
        feed.scrollTop = feed.scrollHeight;
        $('btn-ai-scroll-bottom').classList.remove('has-unread');
        $('btn-ai-scroll-bottom').textContent = '⬇️ Scroll to Bottom';
      }
    };
  }
  if ($('btn-ai-expand')) {
    $('btn-ai-expand').onclick = () => {
      const feed = $('ai-chat-feed');
      if (!feed) return;
      const expanded = feed.classList.toggle('expanded');
      $('btn-ai-expand').textContent = expanded ? '⛶ Collapse Chat' : '⛶ Expand Chat';
    };
  }
  if ($('ai-chat-feed')) {
    $('ai-chat-feed').addEventListener('scroll', () => {
      const feed = $('ai-chat-feed');
      const btn = $('btn-ai-scroll-bottom');
      if (feed && btn && (feed.scrollHeight - feed.scrollTop - feed.clientHeight) <= 35) {
        btn.classList.remove('has-unread');
        btn.textContent = '⬇️ Scroll to Bottom';
      }
    });
  }
}

function handleSseEvent(type, rawData) {
  const data = rawData ? JSON.parse(rawData) : null;
  switch (type) {
    case 'init': {
      if (data.system) {
        state.system = data.system;
        renderSystemInfo();
      }
      renderRunStatus(data.status);
      if (Array.isArray(data.logs) && data.logs.length > 0) {
        $('log-box').innerHTML = '';
        data.logs.forEach(appendLogLine);
      }
      state.demoEvents = data.demoEvents || [];
      state.visitDetails = data.visitDetails || [];
      renderLiveFrame(data.latestFrame || null);
      renderVisitDetails();
      renderDemoEvents();
      renderProfiles(data.profiles || []);
      renderRecorderState(data.recorder || null);
      break;
    }
    case 'system_pulse':
      state.system = data;
      renderSystemInfo();
      break;
    case 'clear_logs':
      $('log-box').innerHTML = '';
      state.visitDetails = [];
      renderVisitDetails();
      renderLiveFrame(null);
      break;
    case 'log':
      appendLogLine(data);
      break;
    case 'status':
      renderRunStatus(data);
      break;
    case 'live_frame':
      renderLiveFrame(data);
      break;
    case 'visit_detail':
      state.visitDetails.unshift(data);
      if (state.visitDetails.length > 100) state.visitDetails.pop();
      renderVisitDetails();
      break;
    case 'demo_event':
      state.demoEvents.unshift(data);
      if (state.demoEvents.length > 250) state.demoEvents.pop();
      renderDemoEvents();
      break;
    case 'profiles_updated':
      renderProfiles(data.profiles || []);
      break;
    case 'recorder_update':
      renderRecorderState(data);
      break;
    case 'config_updated':
      if (data && data.config) {
        state.config = data.config;
        syncFormFromConfig();
        showToast('⚙️ Configuration synced from AI Commander.');
      }
      break;
    case 'report_ready': {
      const btn = $('btn-download-pdf-report');
      if (btn && (data.pdfFile || data.htmlFile)) {
        btn.href = '/api/reports/' + (data.pdfFile || data.htmlFile);
      }
      showToast('📄 AI-summarized PDF report is ready for download!');
      break;
    }
    case 'ai_feed': {
      const last = state.aiHistory[state.aiHistory.length - 1];
      if (!last || last.content !== data.content || last.ts !== data.ts) {
        state.aiHistory.push(data);
        if (state.aiHistory.length > 40) state.aiHistory.shift();
        renderAiChatFeed();
      }
      break;
    }
  }
}

function connectSSE() {
  if (typeof window.SharedWorker === 'function') {
    try {
      const worker = new SharedWorker('/sse-worker.js');
      worker.port.onmessage = ev => {
        if (ev?.data?.type) handleSseEvent(ev.data.type, ev.data.data);
      };
      worker.port.start();
      window.addEventListener('pagehide', () => {
        try { worker.port.postMessage({ type: 'disconnect' }); } catch {}
      });
      return;
    } catch {}
  }

  const es = new EventSource('/api/events');
  const evtNames = [
    'init', 'system_pulse', 'clear_logs', 'log', 'status', 'live_frame',
    'visit_detail', 'demo_event', 'profiles_updated', 'recorder_update',
    'config_updated', 'report_ready', 'ai_feed',
  ];
  for (const name of evtNames) {
    es.addEventListener(name, e => handleSseEvent(name, e.data));
  }
  window.addEventListener('pagehide', () => {
    try { es.close(); } catch {}
  });
}

async function init() {
  setupTabs('config-tabs', 'data-tab', '#tab-general, #tab-tasks, #tab-devices, #tab-personas, #tab-network, #tab-json');
  setupTabs('monitor-tabs', 'data-mtab', '#mtab-logs, #mtab-report, #mtab-demo, #mtab-ai');
  const reqTab = new URLSearchParams(location.search).get('tab');
  if (reqTab) {
    const tabBtn = document.querySelector(`#config-tabs .tab-btn[data-tab="tab-${reqTab}"]`);
    if (tabBtn) tabBtn.click();
  }
  async function refreshResidentialStatus() {
  const el = $('residential-status');
  if (!el) return;
  try {
    const res = await fetch('/api/proxy/residential');
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || 'failed');
    if (d.datacenterCounts && typeof d.datacenterCounts === 'object') {
      state.datacenterCounts = d.datacenterCounts;
      populateCountryDropdownOptions();
    }
    const selectedTier = $('proxy-tier')?.value || state.config?.proxy?.tier || d.tier || 'auto';
    const tierLabel = selectedTier === 'datacenter'
      ? '🏢 Active Mode: Datacenter Only (0MB residential)'
      : (selectedTier === 'residential' ? '🌍 Active Mode: Residential (metered)' : '⚙️ Active Mode: Auto (follow list)');
    const selCountry = $('proxy-residential-country')?.value || '';
    const prefList = Array.isArray(state.config?.proxy?.preferredCountries) ? state.config.proxy.preferredCountries : [];
    const activeCodes = selCountry === '__preferred__'
      ? prefList
      : (selCountry ? [selCountry.toUpperCase()] : []);
    let geoInfo = 'All countries';
    if (activeCodes.length) {
      const matchedDc = activeCodes.reduce((sum, code) => sum + Number(state.datacenterCounts?.[code] || 0), 0);
      geoInfo = `Countries: ${activeCodes.join(',')} (${matchedDc} matching DC servers)`;
    }
    const tail = d.exhausted
      ? ' · Budget exhausted — falling back to datacenter'
      : '';
    el.textContent = `${tierLabel} | ${geoInfo} | Total Datacenter: ${d.datacenterCount ?? 0} servers | Residential: ${d.poolSize ?? 0} sessions · Used ${d.usedMb}/${d.budgetMb}MB (${d.remainingMb}MB remaining · ${d.visits} visits)${tail}`;
  } catch {
    el.textContent = 'Proxy Pool: Unable to fetch status from server';
  }
}
$('proxy-tier')?.addEventListener('change', refreshResidentialStatus);
$('proxy-residential-country')?.addEventListener('change', refreshResidentialStatus);

wireActions();
refreshResidentialStatus();
setInterval(refreshResidentialStatus, 20000);

  try {
    const [sys, cfgData, profilesData, countriesData, aiData] = await Promise.all([
      api('/api/system'),
      api('/api/config'),
      api('/api/site-profiles'),
      api('/api/proxies/countries').catch(() => ({ tier1Defaults: state.tier1Defaults, catalog: [], datacenterCounts: {} })),
      api('/api/ai/status').catch(() => null),
    ]);
    state.system = sys;
    state.config = cfgData.config;
    state.defaultConfig = cfgData.defaultConfig;
    state.siteProfiles = profilesData.profiles || [];
    state.activeProfileId = profilesData.activeProfileId || null;
    if (Array.isArray(countriesData.tier1Defaults) && countriesData.tier1Defaults.length) {
      state.tier1Defaults = countriesData.tier1Defaults;
    }
    state.countryCatalog = countriesData.catalog || [];
    if (countriesData.datacenterCounts && typeof countriesData.datacenterCounts === 'object') {
      state.datacenterCounts = countriesData.datacenterCounts;
    }
    if (aiData) {
      state.aiStatus = aiData;
      state.aiHistory = Array.isArray(aiData.history) ? aiData.history : [];
      renderAiStatusBadge(aiData);
      renderAiChatFeed({ forceScroll: true });
    }
    renderSystemInfo();
    syncFormFromConfig();
    renderSiteProfilesBar();
    connectSSE();
  } catch (err) {
    showToast('Dashboard load error: ' + err.message, true);
  }
}

init();
