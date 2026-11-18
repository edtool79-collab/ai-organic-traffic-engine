const DEVICE_META = [
  { key: 'desktopChrome',  label: 'Desktop Chrome',  engine: 'Chromium Stealth + Fingerprint Suite' },
  { key: 'iphone14',       label: 'iPhone 14',       engine: 'WebKit Mobile Safari + iOS Fingerprint' },
  { key: 'pixel7',         label: 'Pixel 7',         engine: 'Chromium Mobile + Android Fingerprint' },
  { key: 'desktopFirefox', label: 'Desktop Firefox', engine: 'Firefox Desktop + FF Fingerprint' },
  { key: 'desktopSafari',  label: 'Desktop Safari',  engine: 'WebKit Safari + macOS Fingerprint' },
  { key: 'ipadPro',        label: 'iPad Pro 11',     engine: 'WebKit iPad Safari + iOS Fingerprint' },
];

const STATUS_LABELS = {
  idle: 'מוכן להרצה',
  running: 'רץ כעת...',
  paused: 'מושהה (Paused)',
  waiting_schedule: 'ממתין לשעות פעילות',
  stopping: 'עוצר תהליכים...',
  completed: 'הסתיים בהצלחה',
  stopped: 'נעצר ידנית',
  error: 'הסתיים עם שגיאה',
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
  tier1Defaults: ['US', 'GB', 'CA', 'AU', 'DE'],
  aiStatus: null,
  aiHistory: [],
  livePreviewPaused: false,
  livePreviewHidden: false,
};

const STEP_TYPE_META = {
  goto:             { label: 'נווט לעמוד (Goto URL / Path)', selectorHint: '(לא חובה)', valueHint: '/tools/link-cleaner או https://...' },
  click:            { label: 'לחץ על אלמנט (Click)', selectorHint: '#lc-clean או .main-nav a[href="/tools"]', valueHint: '(לא חובה)' },
  go_back:          { label: 'חזור לדף/אתר הקודם (Go Back)', selectorHint: '(אוטומטי — השאר ריק)', valueHint: '1200 (השהיה במילישניות)' },
  close_tab:        { label: 'סגור כרטיסייה חיצונית וחזור (Close Tab)', selectorHint: '(אוטומטי)', valueHint: '(אוטומטי)' },
  fill:             { label: 'הקלד בשדה (Fill Input)', selectorHint: '#lc-input או input[name="email"]', valueHint: 'טקסט או {{AGENT_EMAIL}} / {{OTP_CODE}}' },
  fill_email:       { label: '📧 הזן אימייל סוכן חי (HirePulse Inbox)', selectorHint: 'input[type="email"] (או השאר לזיהוי אוטומטי)', valueHint: '(אוטומטי — יוצר תיבה חיה לכל סוכן)' },
  fill_otp:         { label: '🔑 המתן והזן קוד אימות מהמייל (OTP Code)', selectorHint: 'input[name*="code"] (או השאר לזיהוי אוטומטי)', valueHint: '45000 (זמן המתנה מקסימלי במילישניות)' },
  select:           { label: 'בחר ברשימה (Select)', selectorHint: 'select[name="topic"]', valueHint: 'ערך או תווית באופציה' },
  press:            { label: 'לחץ מקש (Key Press)', selectorHint: '(אופציונלי) בורר שדה', valueHint: 'Enter / Tab / Escape' },
  hover:            { label: 'ריחוף עכבר אנושי (Hover)', selectorHint: '#hero-cta או nav a (עכבר בזייה)', valueHint: '800 (השהיה במילישניות)' },
  scroll:           { label: 'גלול בעמוד לפי אחוז (Scroll %)', selectorHint: '(לא חובה)', valueHint: '70 (אחוז גלילה 0–100)' },
  scroll_to:        { label: 'גלול לאלמנט ללא לחיצה (Scroll To)', selectorHint: 'aside.ad-slot-box[data-ad-position="in_content_mid"]', valueHint: '(ללא צורך בערך)' },
  read_article:     { label: 'קריאת מאמר אנושית (AdSense Safe)', selectorHint: '(אוטומטי — השאר ריק)', valueHint: '8500 (זמן קריאה במילישניות)' },
  human_browse:     { label: 'גלישה אנושית חופשית בדף (Human Browse)', selectorHint: '(אוטומטי — השאר ריק)', valueHint: '7000 (משך גלישה במילישניות)' },
  scan_products:    { label: 'סריקת מוצרים / קישורים אנושית (Scan Products)', selectorHint: '(אופציונלי — בורר אזור מוצרים)', valueHint: '2 (כמות מוצרים לפתיחה)' },
  search_entry:     { label: 'חיפוש אורגני טרום-כניסה (Search Entry)', selectorHint: '(אוטומטי — השאר ריק)', valueHint: '(אופציונלי — שאילתת חיפוש)' },
  ai_explore:       { label: 'סוכן AI אוטונומי (Ollama Cloud Brain)', selectorHint: '(אוטומטי — השאר ריק)', valueHint: '2 (כמות פעולות AI בדף)' },
  ai_route_repair:  { label: 'תיקון מסלול AI (AI Route Repair)', selectorHint: '(אוטומטי — השאר ריק)', valueHint: 'הנחיית יעד להמשך הזרימה' },
  ai_form_guard:    { label: 'שומר טפסים AI (AI Form Guard)', selectorHint: '(אוטומטי — השאר ריק)', valueHint: '1' },
  wait:             { label: 'המתן זמן או לאלמנט (Wait)', selectorHint: '(ריק להמתנת זמן, או CSS Selector)', valueHint: '2000 (מילישניות)' },
  dismiss_overlays: { label: 'סגור Overlays צפים (Dismiss Ads)', selectorHint: '(אוטומטי — השאר ריק)', valueHint: '(אוטומטי)' },
  audit_ads:        { label: 'ביקורת סלוטי מודעות (Audit Ads DOM)', selectorHint: '(אוטומטי — השאר ריק)', valueHint: '(אוטומטי)' },
  assert:           { label: 'בדיקת אימות QA (Assert Pass/Fail)', selectorHint: '#lc-output (או ריק לבדיקת כל הדף)', valueHint: 'הטקסט או ה-URL הצפוי' },
  screenshot:       { label: 'צלם מסך (Screenshot)', selectorHint: '(לא חובה)', valueHint: 'תיאור לצילום' },
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
  if ($('proxy-residential-country')) {
    const resiCc = String(cfg.proxy?.residential?.country || '').toLowerCase();
    const sel = $('proxy-residential-country');
    if (resiCc && !Array.from(sel.options).some(o => o.value === resiCc)) {
      const opt = document.createElement('option');
      opt.value = resiCc;
      opt.textContent = `${flagOf(resiCc)} ${resiCc.toUpperCase()}`;
      sel.appendChild(opt);
    }
    sel.value = resiCc;
    sel.disabled = (($('proxy-tier')?.value || cfg.proxy?.tier) === 'datacenter');
  }
  $('proxy-mode').value = cfg.proxy?.mode || 'round_robin';
  if ($('proxy-country-filter')) $('proxy-country-filter').checked = cfg.proxy?.countryFilterEnabled !== false;
  if ($('proxy-country-fallback')) $('proxy-country-fallback').checked = cfg.proxy?.fallbackToAnyIfEmpty !== false;
  $('proxy-servers').value = Array.isArray(cfg.proxy?.servers) ? cfg.proxy.servers.join('\n') : '';

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

  renderCountriesSelector();
  renderPages();
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
    $('proxy-residential-country').disabled = (tierVal === 'datacenter');
  }

  cfg.proxy = {
    ...(cfg.proxy || {}),
    enabled: $('proxy-enabled').checked,
    tier: ['auto', 'datacenter', 'residential'].includes(tierVal) ? tierVal : 'auto',
    mode: $('proxy-mode').value === 'random' ? 'random' : 'round_robin',
    countryFilterEnabled: $('proxy-country-filter') ? $('proxy-country-filter').checked : true,
    fallbackToAnyIfEmpty: $('proxy-country-fallback') ? $('proxy-country-fallback').checked : true,
    preferredCountries: Array.isArray(cfg.proxy?.preferredCountries) ? cfg.proxy.preferredCountries : [...state.tier1Defaults],
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
      tag.textContent = 'עמוד נחיתה ראשי';
      left.appendChild(tag);
    }

    const btns = document.createElement('div');
    btns.className = 'inline-row';

    if (idx > 0) {
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'small';
      upBtn.textContent = 'העלה ראשון';
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
    delBtn.textContent = 'הסר';
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
  showToast(`נוסף צעד #${state.config.taskSteps.length}: ${stepObj.label || stepObj.type}`);
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
    metaEl.textContent = `HTTP ${data.status} | ${data.url} (${data.title || 'ללא כותרת'})`;
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
    empty.textContent = items.length ? 'לא נמצאו חלקים התואמים לסינון.' : 'אין רכיבים בקטגוריה זו בעמוד שנסרק.';
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
      warnBadge.textContent = `אזור מודעה (${item.visible ? 'גלוי' : 'מוסתר'} · ${item.size})`;
      title.appendChild(warnBadge);
      title.appendChild(document.createTextNode(` ${item.position} — לצפייה וביקורת בלבד (ללא קליק)`));
    } else {
      const badge = document.createElement('span');
      badge.className = 'mapper-badge';
      badge.textContent = item.category === 'link'
        ? (item.external ? 'קישור חיצוני' : 'קישור פנימי')
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
      scrollBtn.textContent = '+ גלילה בטוחה';
      scrollBtn.onclick = () => appendMappedStep({
        type: 'scroll_to',
        selector: item.selector,
        value: '',
        label: `גלילה בטוחה לסלוט ${item.position}`,
      });
      actions.appendChild(scrollBtn);

      const auditBtn = document.createElement('button');
      auditBtn.type = 'button';
      auditBtn.className = 'small';
      auditBtn.textContent = '+ ביקורת מודעה';
      auditBtn.onclick = () => appendMappedStep({
        type: 'audit_ads',
        selector: '',
        value: '',
        label: `ביקורת סלוטי מודעות (${item.position})`,
      });
      actions.appendChild(auditBtn);
    } else {
      if (item.category === 'input') {
        const isSel = item.tag === 'select';
        const fillBtn = document.createElement('button');
        fillBtn.type = 'button';
        fillBtn.className = 'small primary';
        fillBtn.textContent = isSel ? '+ בחירה' : '+ מילוי';
        fillBtn.onclick = () => appendMappedStep({
          type: isSel ? 'select' : 'fill',
          selector: item.selector,
          value: isSel ? (item.options?.[0] || '') : 'sample input value',
          label: `${isSel ? 'בחירה ב-' : 'הזנה בשדה '}${item.label}`,
        });
        actions.appendChild(fillBtn);
      } else {
        const clickBtn = document.createElement('button');
        clickBtn.type = 'button';
        clickBtn.className = 'small primary';
        clickBtn.textContent = '+ קליק';
        clickBtn.onclick = () => appendMappedStep({
          type: 'click',
          selector: item.selector,
          value: '',
          label: `לחיצה על: ${(item.text || item.label || item.selector).slice(0, 40)}`,
          followExternal: Boolean(item.external && item.targetBlank),
        });
        actions.appendChild(clickBtn);
      }

      const hoverBtn = document.createElement('button');
      hoverBtn.type = 'button';
      hoverBtn.className = 'small';
      hoverBtn.textContent = '+ ריחוף';
      hoverBtn.onclick = () => appendMappedStep({
        type: 'hover',
        selector: item.selector,
        value: '700',
        label: `ריחוף על: ${(item.text || item.label || item.selector).slice(0, 40)}`,
      });
      actions.appendChild(hoverBtn);

      const scrollToBtn = document.createElement('button');
      scrollToBtn.type = 'button';
      scrollToBtn.className = 'small';
      scrollToBtn.textContent = '+ גלילה אל';
      scrollToBtn.onclick = () => appendMappedStep({
        type: 'scroll_to',
        selector: item.selector,
        value: '',
        label: `גלילה אל: ${(item.text || item.label || item.selector).slice(0, 40)}`,
      });
      actions.appendChild(scrollToBtn);
    }

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'small';
    copyBtn.textContent = 'העתק בורר';
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(item.selector);
        showToast(`הבורר הועתק: ${item.selector}`);
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
    showToast(`נטענו ונשמרו ${clonedSteps.length} צעדים מוקלטים! אפשר עכשיו ללחוץ "+ שמור כפרופיל חדש".`);
  } catch (err) {
    showToast(`הצעדים נטענו לממשק, אך השמירה נכשלה: ${err.message}`, true);
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
      desktopWarnEl.textContent = `⚠️ השרת רץ כעת ברקע מתוך סביבה מבודדת (${desk.currentDesktop || 'non-Default'}) ולא משולחן העבודה שלך — לכן חלונות הדפדפן אינם גלויים על המסך. לחץ לחיצה כפולה על start-dashboard.bat בתיקייה (web-traffic-generation) כדי להפעיל עצמאית על שולחן העבודה.`;
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
        : (challenge.interstitial ? 'דף אימות של Cloudflare' : 'אתגר כללי');
      challengeEl.style.display = 'block';
      challengeEl.textContent = challenge.solved
        ? `✅ זוהה ${labelText} — נראה שכבר עברת את הבדיקה. אפשר להמשיך לגלוש.`
        : `🤖 זוהה ${labelText} בעמוד — יש לאשר אותו ידנית בחלון ההקלטה (לחיצה על התיבה), ואז להמשיך לגלוש.`;
    } else {
      challengeEl.style.display = 'none';
      challengeEl.textContent = '';
    }
  }

  box.classList.toggle('recording', active);
  if (dot) dot.classList.toggle('recording', active);
  startBtn.disabled = active || hiddenDesktop;
  if (!active && startBtn.textContent !== '🔴 הקלט מסלול בדפדפן') {
    startBtn.textContent = '🔴 הקלט מסלול בדפדפן';
  }
  stopBtn.disabled = !active;
  if (focusBtn) focusBtn.disabled = !active || hiddenDesktop;
  if (loadLastBtn) loadLastBtn.disabled = active || steps.length === 0;

  if (active) {
    metaEl.textContent = `מקליט כעת (${steps.length} צעדים) — ${rec.currentUrl || rec.targetUrl || ''}`;
  } else if (rec?.status === 'error') {
    metaEl.textContent = `שגיאת הקלטה: ${rec.error || 'לא ידוע'}`;
  } else if (rec?.status === 'completed' && steps.length) {
    metaEl.textContent = `הוקלטו ${steps.length} צעדים ומוכנים ב-Task Builder`;
  } else {
    metaEl.textContent = 'מוכן להקלטה על כתובת היעד';
  }

  listEl.innerHTML = '';
  if (!steps.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.style.fontSize = '0.84rem';
    empty.textContent = active
      ? 'ממתין לפעולות בדפדפן... לחץ, גלול, מלא טופס או חזור אחורה.'
      : 'הצעדים שתבצע בדפדפן ההקלטה יופיעו כאן בזמן אמת...';
    listEl.appendChild(empty);
  } else {
    steps.forEach((step, idx) => {
      const chip = document.createElement('div');
      chip.className = 'recorder-step-chip';

      const desc = document.createElement('span');
      const labelText = step.label || step.type;
      const tabBadge = Number.isInteger(step.tab) && step.tab > 0 ? ` [טאב #${step.tab}]` : '';
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
    empty.textContent = 'עדיין לא הוגדרו צעדי משימה ספציפיים. לחץ על "+ הוסף צעד" או בחר אחת מהתבניות למעלה.';
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
    const tabTag = Number.isInteger(step.tab) && step.tab > 0 ? ` [כרטיסייה #${step.tab}]` : '';
    const optTag = step.optional ? ' [אופציונלי]' : '';
    title.textContent = `צעד ${idx + 1}: ${meta.label}${tabTag}${optTag}`;

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
    del.textContent = 'מחק';
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
    typeLbl.textContent = 'סוג פעולה';
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
      aLbl.textContent = 'סוג אימות (Assertion)';
      aLbl.style.fontSize = '0.78rem';
      aLbl.style.color = 'var(--muted)';
      const aSel = document.createElement('select');
      [
        ['text_contains', 'טקסט בדף/אלמנט מכיל'],
        ['url_contains', 'כתובת ה-URL מכילה'],
        ['selector_visible', 'אלמנט מוצג על המסך'],
        ['status_ok', 'סטטוס HTTP תקין (200-399)'],
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

    grid.appendChild(mkInput('בורר / טקסט אלמנט (Selector)', step.selector, meta.selectorHint, v => { step.selector = v; }));
    grid.appendChild(mkInput('ערך / יעד / טקסט צפוי', step.value, meta.valueHint, v => { step.value = v; }));
    grid.appendChild(mkInput('תיאור קצר בלוג', step.label, 'לדוגמה: אימות ניקוי לינק', v => { step.label = v; }, false));

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
    delBtn.textContent = 'מחק פרופיל';
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

    grid.appendChild(numField('עומק גלילה (0–1)', p.scrollDepth, 0.05, 0, 1, v => { p.scrollDepth = v; }));
    grid.appendChild(numField('שיעור לחיצות (0–1)', p.clickRate, 0.05, 0, 1, v => { p.clickRate = v; }));
    grid.appendChild(numField('קריאה מינ׳ (ms)', p.readTime[0], 100, 0, 120000, v => { p.readTime[0] = v; }));
    grid.appendChild(numField('קריאה מקס׳ (ms)', p.readTime[1], 100, 0, 120000, v => { p.readTime[1] = v; }));
    grid.appendChild(numField('מינ׳ עמודים', p.pageCount[0], 1, 1, 50, v => { p.pageCount[0] = v; }));
    grid.appendChild(numField('מקס׳ עמודים', p.pageCount[1], 1, 1, 50, v => { p.pageCount[1] = v; }));
    grid.appendChild(numField('השהיית Idle (0–1)', p.idleChance, 0.01, 0, 1, v => { p.idleChance = v; }));
    grid.appendChild(numField('שינוי גודל חלון (0–1)', p.resizeChance, 0.01, 0, 1, v => { p.resizeChance = v; }));
    grid.appendChild(numField('חזרה לאחור U-Turn (0–1)', p.uTurnChance, 0.01, 0, 1, v => { p.uTurnChance = v; }));

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
    descEl.textContent = 'אין פרופיל נבחר.';
    if (delBtn) delBtn.disabled = true;
    return;
  }

  const activeMark = chosen.id === state.activeProfileId ? ' [טעון כעת]' : ' — לחץ "טען פרופיל למערכת 📂" להחלה';
  const stepsCnt = chosen.config?.taskSteps?.length || 0;
  descEl.textContent = `${chosen.description || 'פרופיל שמור'} | יעד: ${chosen.config?.targetUrl || '-'} | מצב: ${chosen.config?.taskMode || 'behavior'} (${stepsCnt} צעדים)${activeMark}`;
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
    box.textContent = `טיפ לצפייה חיה (Watch Mode): הרצת ${conc} דפדפנים גלויים במקביל עלולה להעמיס על המסך וה-RAM — בצפייה חיה מומלץ 1–4 מקביליות (להרצות עומס של ${conc}+ כבה "מצב צפייה חי").`;
  } else if (conc > maxStress) {
    box.className = 'advice-box warn';
    box.textContent = `אזהרה: מקסימום מקביליות ${conc} גבוה מקיבולת המחשב (${sys.totalRamGb}GB RAM, ${sys.cpuCount} ליבות). Crawlee יבלום לפי צורך, אך מומלץ ${sweetSpot[0]}–${sweetSpot[1]}.`;
  } else {
    box.className = 'advice-box';
    box.textContent = `המלצת חומרה (${sys.totalRamGb}GB RAM, ${sys.cpuCount} ליבות): Crawlee AutoscaledPool יווסת בין מינימום למקסימום (${recommended} מומלץ, תקרה בטוחה: ${maxStress}).`;
  }
}

function renderJsonPreview() {
  if (!state.config) return;
  $('json-preview').textContent = JSON.stringify(state.config, null, 2);
}

function renderSystemInfo() {
  const sys = state.system;
  if (!sys) return;
  $('kpi-system').textContent = `RAM ${sys.memUsedPct}% | ${sys.cpuCount} ליבות`;
  $('kpi-system-advice').textContent = `פנוי: ${sys.freeRamGb} / ${sys.totalRamGb} GB | מומלץ: ${sys.concurrencyAdvice.sweetSpot[0]}–${sys.concurrencyAdvice.sweetSpot[1]}`;
  renderConcurrencyAdvice();
}

function renderProfiles(profiles) {
  state.profiles = profiles || [];
  $('kpi-profiles-count').textContent = `פרופילי Persistent בדיסק: ${state.profiles.length}`;
  const el = $('profiles-list');
  if (!state.profiles.length) {
    el.textContent = 'אין כרגע פרופילי משתמש חוזר שמורים בדיסק.';
    return;
  }
  el.textContent = `שמורים בדיסק ${state.profiles.length} פרופילים: ` +
    state.profiles.map(p => `${p.name} (${p.deviceKey}, ${p.cookiesCount} cookies)`).join(' • ');
}

function renderRunStatus(st) {
  if (!st) return;
  state.runStatus = st;

  const badge = $('run-status-badge');
  badge.className = `badge ${st.status}`;
  badge.textContent = st.streamMode && st.status === 'running'
    ? `🌊 נחל רציף פעיל (גל #${st.streamWave || 1})`
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
  $('kpi-breakdown').textContent = `הצלחה: ${st.succeeded || 0} | פג תוקף: ${st.timedOut || 0} | כשל: ${st.failed || 0}`;

  $('kpi-concurrency').textContent = `${st.currentConcurrency || 0} / ${st.desiredConcurrency || 0}`;
  $('kpi-concurrency-sub').textContent = `טווח מוגדר: ${st.minConcurrency || 1}–${st.maxConcurrency || 3}${st.isSystemOverloaded ? ' (עומס גבוה — מואט)' : ''}`;
  $('crawlee-pool-badge').textContent = `Crawlee Pool: ${st.currentConcurrency || 0} פעילים (יעד: ${st.desiredConcurrency || 0})`;

  $('kpi-avg-load').textContent = st.avgLoadMs != null ? `${st.avgLoadMs} ms` : '—';
  $('kpi-errors-sub').textContent = `שגיאות JS/קונסולה: ${st.errorsTotal || 0}`;
  $('kpi-sessions').textContent = `${st.returningSessions || 0} / ${st.newSessions || 0}`;

  $('progress-label').textContent = `התקדמות הרצה: ${pct}%`;
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
  ts.textContent = new Date(entry.ts).toLocaleTimeString('he-IL', { hour12: false });

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
    lbl.textContent = 'מסך חי של הדפדפן (Live Preview)';
    urlEl.textContent = 'ממתין להרצה...';
    return;
  }

  if (frame.type === 'live_meta') {
    lbl.textContent = `ביקור #${(frame.visitIndex ?? 0) + 1}${frame.label ? ' — ' + frame.label : ''}`;
    if (frame.url) urlEl.textContent = frame.url;
    return;
  }

  if (frame.type === 'rrweb_events' && Array.isArray(frame.events) && frame.events.length && window.rrweb?.Replayer && rrContainer) {
    img.style.display = 'none';
    empty.style.display = 'none';
    rrContainer.style.display = 'block';
    lbl.textContent = `ביקור #${(frame.visitIndex ?? 0) + 1}${frame.label ? ' — ' + frame.label : ' (DOM חי)'}`;
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
  lbl.textContent = `ביקור #${(frame.visitIndex ?? 0) + 1}${frame.label ? ' — ' + frame.label : ''}`;
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
    p.textContent = 'עדיין אין דוחות ביקור מפורטים. לחץ "הפעל הרצה ▶".';
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
    title.textContent = `ביקור #${v.visitNumber} • ${v.persona} • ${v.device}`;

    const badge = document.createElement('span');
    badge.className = hasErr ? 'pill-fail' : 'pill-ok';
    const extraGeo = v.country ? ` | 🌍 ${v.country}` : '';
    const extraWave = v.waveSummary?.mutated ? ` | 🌊 גל #${v.waveSummary.waveNumber || 1}` : '';
    badge.textContent = `HTTP ${v.status} | ${v.loadMs}ms | שגיאות: ${v.pageErrors || 0}${extraGeo}${extraWave}`;

    head.appendChild(title);
    head.appendChild(badge);
    card.appendChild(head);

    if (Array.isArray(v.visitedUrls) && v.visitedUrls.length) {
      const route = document.createElement('div');
      route.style.marginTop = '5px';
      const code = document.createElement('code');
      code.style.fontSize = '0.76rem';
      code.textContent = 'מסלול: ' + v.visitedUrls.map(u => `${u.path} (${u.status})`).join(' -> ');
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
      summary.textContent = `צעדי משימה (${v.stepResults.length}): ` + v.stepResults.map(s => `✓ ${s.label}`).join(' | ');
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
    p.textContent = 'עדיין לא נקלטו אירועים מאתר הניסיון המובנה.';
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
    title.textContent = `${ev.eventType || 'event'} — ${ev.returning ? 'משתמש חוזר' : 'משתמש חדש'} (${ev.visitorId || '—'})`;
    const time = document.createElement('span');
    time.style.color = 'var(--muted)';
    time.textContent = new Date(ev.ts).toLocaleTimeString('he-IL', { hour12: false });
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
    box.textContent = 'לא נמצאו שרתי Proxy לבדיקה.';
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
      ? `תקין | ${r.latencyMs}ms | IP: ${r.exitIp || 'OK'} ${r.country ? '• ' + r.country : ''}`
      : `נכשל: ${r.error || 'Error'}`;

    row.appendChild(left);
    row.appendChild(right);
    box.appendChild(row);
  });
}

function renderCountriesSelector() {
  const grid = $('proxy-countries-grid');
  if (!grid || !state.config) return;
  const selected = new Set(Array.isArray(state.config.proxy?.preferredCountries) ? state.config.proxy.preferredCountries : state.tier1Defaults);
  const catalog = state.countryCatalog.length
    ? state.countryCatalog
    : state.tier1Defaults.map(code => ({ code, nameHe: code, tier: 1 }));

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
      state.config.proxy.preferredCountries = [...cur];
      chip.classList.toggle('selected', cb.checked);
      renderJsonPreview();
    };

    const span = document.createElement('span');
    span.textContent = c.nameHe || c.code;
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
    badge.textContent = parts.length ? `מחובר: ${parts.join(' + ')}` : `מחובר לענן (${info.source})`;
  } else {
    badge.className = 'badge idle';
    badge.textContent = 'ללא מפתח ענן (מצב בקר מקומי)';
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
    p.textContent = 'שוחח כאן עם מפקח צי ה-AI או תן פקודות בזמן אמת (שינוי גלים, מקביליות, השהיה ושליחת משימות לסוכנים).';
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
    if (Array.isArray(msg.applied) && msg.applied.length) metaParts.push(`יושם לצי: ${msg.applied.join(', ')}`);
    if (msg.ts) metaParts.push(new Date(msg.ts).toLocaleTimeString('he-IL', { hour12: false }));
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
      scrollBtn.textContent = '⬇️ חזור לתחתית הצ׳אט';
    }
  } else {
    feed.scrollTop = prevScrollTop;
    if (scrollBtn) {
      scrollBtn.classList.add('has-unread');
      scrollBtn.textContent = '⬇️ יש עדכונים חדשים למטה';
    }
  }
}

// ─── Actions & SSE ────────────────────────────────────────────────────────────

const RECORDER_CC_LABEL = {
  US: 'ארה״ב', CA: 'קנדה', GB: 'בריטניה', AU: 'אוסטרליה', DE: 'גרמניה', AT: 'אוסטריה',
  FR: 'צרפת', IT: 'איטליה', NL: 'הולנד', CZ: 'צ׳כיה', RO: 'רומניה', JP: 'יפן',
  KR: 'קוריאה', SG: 'סינגפור',
};

function flagOf(cc) {
  const key = String(cc || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(key)) return '🌐';
  return String.fromCodePoint(...[...key].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}

function countryLabel(cc) {
  const key = String(cc || '').toUpperCase();
  if (!key) return 'לא ידוע';
  return `${flagOf(key)} ${RECORDER_CC_LABEL[key] || key}`;
}

// ממלא את רשימת הפרוקסים במסך ההקלטה (מדינה · עיר — host:port, כולל ✅/⛔ מול ההצעה).
async function loadRecorderProxyList() {
  const group = $('recorder-proxy-country-group');
  if (!group) return;
  group.innerHTML = '<option value="" disabled>טוען רשימת פרוקסים…</option>';
  try {
    const data = await api('/api/proxy/list');
    const list = Array.isArray(data?.proxies) ? data.proxies : [];
    if (!list.length) {
      group.innerHTML = '<option value="" disabled>לא נמצאו פרוקסים בהגדרות</option>';
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
      const label = p.cc ? countryLabel(p.cc) : (/webshare/i.test(p.hostPort) ? '🌍 רזידנציאלי (Webshare)' : 'לא ידוע');
      return `<option value="${p.hostPort}">${label}${city} — ${p.hostPort}${ms} ${offerMark}</option>`;
    }).join('');
  } catch {
    group.innerHTML = '<option value="" disabled>טעינת רשימת הפרוקסים נכשלה</option>';
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
    showToast(`נוסף צעד: ${btn.dataset.qlbl || btn.dataset.qtype}`);
  });

  $('btn-discover-pages').onclick = async () => {
    collectSimpleFieldsToConfig();
    const targetUrl = state.config.targetUrl;
    if (!targetUrl) {
      showToast('הזן קודם כתובת אתר ב-targetUrl.', true);
      return;
    }
    const btn = $('btn-discover-pages');
    btn.disabled = true;
    btn.textContent = 'סורק את האתר...';
    try {
      const res = await api('/api/discover', { method: 'POST', body: JSON.stringify({ targetUrl }) });
      if (Array.isArray(res.pages) && res.pages.length) {
        state.config.pages = res.pages;
        renderPages();
        renderJsonPreview();
        showToast(`נמצאו ${res.pages.length} עמודים אמיתיים באתר (HTTP ${res.rootStatus})! כעת לחץ "שמור הגדרות" או "הפעל הרצה".`);
      } else {
        showToast('לא נמצאו קישורים פנימיים נוספים מעבר ל-/.');
      }
    } catch (err) {
      showToast('סריקת עמודים נכשלה: ' + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'סרוק עמודים קיימים באתר 🔍';
    }
  };

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
      showToast('יש להזין כתובת אתר יעד לפני תחילת ההקלטה.', true);
      return;
    }
    startBtn.disabled = true;
    startBtn.textContent = '⏳ פותח דפדפן הקלטה...';
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
        ? ' (חיבור ישיר — IP שלך)'
        : ` (יוצא מהארץ: ${countryLabel(data.proxyCountry)} · ${data.proxyHost})`;
      const statusEl = $('recorder-proxy-status');
      if (statusEl) {
        statusEl.textContent = isDirect
          ? '🌐 IP הקלטה: ישיר מהמחשב שלך (ישראל)'
          : `📍 IP הקלטה: ${countryLabel(data.proxyCountry)} · ${data.proxyHost}`;
      }
      showToast(`נפתח חלון Chrome נפרד להקלטה${geoLabel}! בסיום לחצו "סיים הקלטה" או סגרו אותו.`);
    } catch (err) {
      startBtn.disabled = false;
      startBtn.textContent = '🔴 הקלט מסלול בדפדפן';
      showToast(`פתיחת ההקלטה נכשלה: ${err.message}`, true);
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
        showToast('ההקלטה נסגרה ללא צעדים מוקלטים.');
      }
    } catch (err) {
      stopBtn.disabled = false;
      showToast(`סיום ההקלטה נכשל: ${err.message}`, true);
    }
  };

  if ($('btn-recorder-focus')) {
    $('btn-recorder-focus').onclick = async () => {
      try {
        const res = await api('/api/recorder/focus', { method: 'POST' });
        showToast(
          res.ok
            ? (res.reason || 'חלון ההקלטה הוקפץ לחזית.')
            : (res.reason || 'לא נמצא חלון הקלטה פתוח להקפצה.'),
          !res.ok
        );
      } catch (err) {
        showToast(`שגיאה בהקפצת חלון ההקלטה: ${err.message}`, true);
      }
    };
  }

  const refreshProxyBtn = $('btn-recorder-proxy-refresh');
  if (refreshProxyBtn) {
    refreshProxyBtn.onclick = async () => {
      refreshProxyBtn.disabled = true;
      await loadRecorderProxyList();
      refreshProxyBtn.disabled = false;
      showToast('רשימת הפרוקסים רועננה — בחר מדינה ופתח הקלטה.');
    };
  }
  loadRecorderProxyList();

  $('btn-recorder-load-last').onclick = async () => {
    try {
      const rec = state.recorder?.steps?.length ? state.recorder : (await api('/api/recorder/status')).recorder;
      const ok = await importRecordedSteps(rec, { force: true });
      if (!ok) showToast('אין צעדים מוקלטים זמינים לטעינה.', true);
    } catch (err) {
      showToast(`טעינת הצעדים נכשלה: ${err.message}`, true);
    }
  };

  $('btn-inspect-page').onclick = async () => {
    collectSimpleFieldsToConfig();
    const targetUrl = state.config.targetUrl;
    const pagePath = $('mapper-page-input').value.trim() || '/';
    if (!targetUrl && !/^https?:\/\//i.test(pagePath)) {
      showToast('הזן קודם כתובת אתר ב-targetUrl או URL מלא למיפוי.', true);
      return;
    }
    const btn = $('btn-inspect-page');
    btn.disabled = true;
    btn.textContent = 'ממפה חלקים בדפדפן...';
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
      showToast(`מופה בהצלחה: ${s.buttons || 0} כפתורים, ${s.links || 0} קישורים, ${s.inputs || 0} שדות, ${s.sections || 0} אזורים, ${s.adSlots || 0} מודעות.`);
    } catch (err) {
      showToast('מיפוי העמוד נכשל: ' + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = '🔍 מפה את כל חלקי העמוד';
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
      { type: 'goto', selector: '', value: '/contact', label: 'פתיחת דף צור קשר' },
      { type: 'fill', selector: 'input[name="name"]', value: 'Avi QA Tester', label: 'הזנת שם מלא' },
      { type: 'fill', selector: 'input[name="email"]', value: 'qa@hirepulse.dev', label: 'הזנת אימייל' },
      { type: 'select', selector: 'select[name="topic"]', value: 'demo', label: 'בחירת נושא' },
      { type: 'fill', selector: 'textarea[name="message"]', value: 'Automated end-to-end task verification test', label: 'הזנת הודעה' },
      { type: 'click', selector: 'button[type="submit"]', value: '', label: 'שליחת הטופס' },
      { type: 'wait', selector: '', value: '400', label: 'המתנה לתשובה' },
      { type: 'assert', selector: '#form-status', value: 'Form received by QA Sandbox!', assertKind: 'text_contains', label: 'אימות הודעת הצלחה' },
    ];
    syncFormFromConfig();
    showToast('נטענה משימת מילוי ואימות טופס באתר הדמו!');
  };

  $('btn-tpl-landing').onclick = () => {
    state.config.taskMode = 'scenario';
    state.config.taskSteps = [
      { type: 'goto', selector: '', value: '/', label: 'טעינת דף הבית' },
      { type: 'assert', selector: '', value: '', assertKind: 'status_ok', label: 'אימות HTTP 200' },
      { type: 'scroll', selector: '', value: '60', label: 'גלילה ל-60%' },
      { type: 'wait', selector: '', value: '1200', label: 'המתנת קריאה' },
      { type: 'screenshot', selector: '', value: 'Landing Check', label: 'צילום דף הבית' },
    ];
    syncFormFromConfig();
    showToast('נטענה משימת בדיקת דף הבית + גלילה + צילום.');
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
    showToast('הוגדרה כתובת אתר הניסיון המובנה.');
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
    showToast('נטענה בדיקת ניסיון גלויה (3 ביקורים). לחץ על "הפעל הרצה ▶" לצפייה בדפדפן חי!');
  };

  $('btn-apply-recommended-conc').onclick = () => {
    if (!state.system) return;
    state.config.minConcurrency = 1;
    state.config.concurrency = state.system.concurrencyAdvice.recommended;
    syncFormFromConfig();
    showToast(`המקביליות הותאמה אוטומטית לטווח 1–${state.config.concurrency}.`);
  };

  document.querySelectorAll('.preset-scale-btn').forEach((btn) => {
    btn.onclick = () => {
      const visits = Number(btn.dataset.visits) || 25;
      const minConc = Number(btn.dataset.min) || 2;
      const maxConc = Number(btn.dataset.max) || 6;
      const ramMode = btn.dataset.ram || 'lite';
      state.config.visitCount = visits;
      state.config.minConcurrency = minConc;
      state.config.concurrency = maxConc;
      state.config.resourceMode = ramMode;
      state.config.stealthMode = 'maximum';
      state.config.waveConfig = {
        ...(state.config.waveConfig || {}),
        enabled: true,
        pattern: 'natural_peaks',
        childrenPerRecording: visits >= 500 ? 6 : 4,
      };
      syncFormFromConfig();
      showToast(`הוגדרה ריצת סקאלה של ${visits.toLocaleString('he-IL')} סשנים (מקביליות ${minConc}–${maxConc}, Headless ברקע, מצב זיכרון: ${ramMode}).`);
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
          ? 'מחובר (Owner Pilot)'
          : 'מחובר (מפתח API)';
        $('btn-create-live-inbox').disabled = false;
        badge.style.color = '#4ade80';
        if (pilotBox) pilotBox.style.display = '';
      } else {
        // Optional feature: no key means no inbox — the box simply stays out of the way instead of
        // asking the operator to set an environment variable that traffic generation never needs.
        badge.textContent = 'לא מוגדר — תיבת מייל זמנית כבויה';
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
        showToast('העתק ידנית מהשדה.', true);
      }
    };
  }

  if ($('btn-check-live-otp')) {
    $('btn-check-live-otp').onclick = async () => {
      if (!currentLiveInboxId) return;
      const btn = $('btn-check-live-otp');
      btn.disabled = true;
      btn.textContent = 'בודק מייל...';
      try {
        const res = await api(`/api/email/code/${encodeURIComponent(currentLiveInboxId)}`);
        if (res.status === 'link_confirmed' && res.confirmationUrl) {
          $('live-otp-result').textContent = '✅ המייל אומת אוטומטית! (נמצא ואושר לינק אימות מהמייל)';
          $('live-otp-result').style.color = '#4ade80';
          showToast('התקבל מייל עם לינק אימות והוא אושר אוטומטית!');
        } else if (res.status === 'code' && res.code) {
          $('live-otp-result').textContent = `🔑 קוד אימות: ${res.code}`;
          $('live-otp-result').style.color = '#4ade80';
          try { await navigator.clipboard.writeText(String(res.code)); } catch {}
          showToast('Verification code received.');
        } else if (res.status === 'message_received') {
          $('live-otp-result').textContent = `📩 התקבל מייל בתיבה: "${res.subject || 'הודעה חדשה'}"`;
          $('live-otp-result').style.color = '#4ade80';
          showToast(`התקבל מייל בתיבה: ${res.subject || ''}`);
        } else {
          $('live-otp-result').textContent = `⏳ עדיין ממתין למייל (${res.status})... נסה שוב בעוד 2 שניות`;
          showToast('עדיין לא הגיע קוד אימות — המתן 2 שניות ונסה שוב.');
        }
      } catch (err) {
        showToast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = '🔑 שלוף קוד אימות (OTP)';
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
    showToast('הפרסונות אופסו לברירת המחדל.');
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
      showToast('הזן לפחות שרת Proxy אחד בתיבה כדי לבדוק.', true);
      return;
    }
    const btn = $('btn-test-proxies');
    btn.disabled = true;
    btn.textContent = 'בודק שרתי Proxy...';
    try {
      const res = await api('/api/proxies/test', { method: 'POST', body: JSON.stringify({ servers }) });
      renderProxyTestResults(res.results);
      const okCount = (res.results || []).filter(r => r.ok).length;
      showToast(`בדיקת Proxies הושלמה: ${okCount} מתוך ${res.results.length} תקינים.`);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'בדוק תקינות Proxies';
    }
  };

  $('btn-clear-profiles').onclick = async () => {
    try {
      const res = await api('/api/profiles', { method: 'DELETE' });
      renderProfiles(res.profiles);
      showToast('כל פרופילי ה-Persistent נמחקו.');
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
      showToast('ההגדרות נשמרו ל-config.json ול-proxies.txt בהצלחה!');
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
      showToast(`הפרופיל "${res.profile.name}" נטען למערכת ומוכן — פשוט לחץ "הפעל הרצה ▶"!`);
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
      showToast(`השינויים נשמרו בפרופיל "${res.profile.name}"!`);
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
      showToast('הזן שם לפרופיל החדש.', true);
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
      showToast(`נוצר פרופיל חדש: "${res.profile.name}"!`);
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
      showToast('הפרופיל נמחק.');
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $('btn-start').onclick = async () => {
    try {
      collectSimpleFieldsToConfig();
      const res = await api('/api/run/start', { method: 'POST', body: JSON.stringify({ config: state.config, streamMode: false }) });
      renderRunStatus(res.status);
      showToast('ההרצה הופעלה! עקוב אחר הלוגים והמקביליות בזמן אמת.');
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
        showToast('🌊 מצב נחלים רציפים הופעל! ראשי הצוות ב-AI ישגרו גלים אוטומטית עד שתלחץ עצור.');
      } catch (err) {
        showToast(err.message, true);
      }
    };
  }

  $('btn-pause').onclick = async () => {
    try {
      const res = await api('/api/run/pause', { method: 'POST' });
      renderRunStatus(res.status);
      showToast('הרצה הושהתה.');
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $('btn-resume').onclick = async () => {
    try {
      const res = await api('/api/run/resume', { method: 'POST' });
      renderRunStatus(res.status);
      showToast('הרצה חודשה.');
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $('btn-stop').onclick = async () => {
    try {
      const res = await api('/api/run/stop', { method: 'POST' });
      renderRunStatus(res.status);
      showToast('פקודת עצירה נשלחה.');
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $('btn-reset-config').onclick = async () => {
    try {
      const res = await api('/api/config/reset', { method: 'POST' });
      state.config = res.config;
      syncFormFromConfig();
      showToast('קובץ config.json אופס לברירת המחדל.');
    } catch (err) {
      showToast(err.message, true);
    }
  };

  $('btn-copy-json').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('json-preview').textContent);
      showToast('ה-JSON הועתק ללוח!');
    } catch {
      showToast('לא ניתן להעתיק ללוח בדפדפן זה.', true);
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
      showToast('סומנו 5 מדינות Tier-1 האיכותיות כברירת מחדל.');
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
        showToast(res.liveDelivered ? 'ההנחיה שוגרה ישירות לצי הפעיל!' : 'ההנחיה נשמרה למשימה הבאה.');
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
      btn.textContent = 'מפקד AI חושב...';
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
      showToast('שגיאת מפקח AI: ' + err.message, true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'שלח למפקד ↗';
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
      $('btn-live-pause').textContent = state.livePreviewPaused ? '▶️ המשך תצוגה' : '⏸️ השהה תצוגה';
      api('/api/run/preview', { method: 'POST', body: JSON.stringify({ active: !state.livePreviewPaused && !state.livePreviewHidden }) }).catch(() => {});
    };
  }
  if ($('btn-live-toggle')) {
    $('btn-live-toggle').onclick = () => {
      state.livePreviewHidden = !state.livePreviewHidden;
      const body = $('live-screen-body');
      if (body) body.style.display = state.livePreviewHidden ? 'none' : 'block';
      $('btn-live-toggle').textContent = state.livePreviewHidden ? '👁️ הצג תצוגה' : '🙈 הסתר';
      api('/api/run/preview', { method: 'POST', body: JSON.stringify({ active: !state.livePreviewPaused && !state.livePreviewHidden }) }).catch(() => {});
    };
  }
  if ($('btn-ai-scroll-bottom')) {
    $('btn-ai-scroll-bottom').onclick = () => {
      const feed = $('ai-chat-feed');
      if (feed) {
        feed.scrollTop = feed.scrollHeight;
        $('btn-ai-scroll-bottom').classList.remove('has-unread');
        $('btn-ai-scroll-bottom').textContent = '⬇️ חזור לתחתית הצ׳אט';
      }
    };
  }
  if ($('btn-ai-expand')) {
    $('btn-ai-expand').onclick = () => {
      const feed = $('ai-chat-feed');
      if (!feed) return;
      const expanded = feed.classList.toggle('expanded');
      $('btn-ai-expand').textContent = expanded ? '⛶ כווץ חלון צ׳אט' : '⛶ הרחב חלון צ׳אט';
    };
  }
  if ($('ai-chat-feed')) {
    $('ai-chat-feed').addEventListener('scroll', () => {
      const feed = $('ai-chat-feed');
      const btn = $('btn-ai-scroll-bottom');
      if (feed && btn && (feed.scrollHeight - feed.scrollTop - feed.clientHeight) <= 35) {
        btn.classList.remove('has-unread');
        btn.textContent = '⬇️ חזור לתחתית הצ׳אט';
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
        showToast('⚙️ ההגדרות סונכרנו אוטומטית מהמפקח.');
      }
      break;
    case 'report_ready': {
      const btn = $('btn-download-pdf-report');
      if (btn && (data.pdfFile || data.htmlFile)) {
        btn.href = '/api/reports/' + (data.pdfFile || data.htmlFile);
      }
      showToast('📄 דוח PDF מפורט ומסוכם ב-AI בעברית מוכן להורדה!');
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
    const selectedTier = $('proxy-tier')?.value || state.config?.proxy?.tier || d.tier || 'auto';
    const tierLabel = selectedTier === 'datacenter'
      ? '🏢 מצב פעיל: זול (דאטה־סנטר בלבד — 0MB רזידנציאלי)'
      : (selectedTier === 'residential' ? '🌍 מצב פעיל: יקר (רזידנציאלי מדוד)' : '⚙️ מצב פעיל: אוטומטי (לפי הרשימה)');
    const tail = d.exhausted
      ? ' · המכסה נוצלה — הריצה תעבור לדאטה־סנטר'
      : '';
    el.textContent = `${tierLabel} | דאטה־סנטר: ${d.datacenterCount ?? 0} שרתים | רזידנציאלי: ${d.poolSize ?? 0} סשנים · נוצלו ${d.usedMb}/${d.budgetMb}MB (נותרו ${d.remainingMb}MB · ${d.visits} ביקורים)${tail}`;
  } catch {
    el.textContent = 'מאגר פרוקסים: לא ניתן לקרוא סטטוס מהשרת';
  }
}
$('proxy-tier')?.addEventListener('change', refreshResidentialStatus);

wireActions();
refreshResidentialStatus();
setInterval(refreshResidentialStatus, 20000);

  try {
    const [sys, cfgData, profilesData, countriesData, aiData] = await Promise.all([
      api('/api/system'),
      api('/api/config'),
      api('/api/site-profiles'),
      api('/api/proxies/countries').catch(() => ({ tier1Defaults: state.tier1Defaults, catalog: [] })),
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
    showToast('שגיאה בטעינת הדאשבורד: ' + err.message, true);
  }
}

init();
