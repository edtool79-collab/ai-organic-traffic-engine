const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SITE_PROFILES_DIR = path.join(ROOT_DIR, 'site-profiles');
const META_PATH = path.join(SITE_PROFILES_DIR, '_meta.json');

function sanitizeProfileId(raw) {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || `profile-${Date.now()}`;
}

function step(type, selector = '', value = '', label = '', assertKind = 'text_contains', extra = null) {
  return extra && typeof extra === 'object'
    ? { type, selector, value, assertKind, label, ...extra }
    : { type, selector, value, assertKind, label };
}

function defaultAdSafety(skipTelemetryHeader = false) {
  return {
    avoidAdClicks: false,
    dismissOverlays: true,
    closePopunders: true,
    skipTelemetryHeader,
  };
}

function hostConsistentDevices() {
  return process.platform === 'darwin'
    ? { desktopChrome: 50, desktopFirefox: 20, desktopSafari: 15, iphone14: 15, pixel7: 0, ipadPro: 0 }
    : { desktopChrome: 75, desktopFirefox: 25, pixel7: 0, iphone14: 0, desktopSafari: 0, ipadPro: 0 };
}

function defaultSessionPersistence(returningUserRate = 65, profilePoolSize = 20) {
  return {
    enabled: true,
    returningUserRate,
    profilePoolSize,
  };
}

function readerPersonas() {
  return [
    { name: 'engaged_reader', scrollDepth: 0.95, clickRate: 0.65, readTime: [3000, 7000], pageCount: [2, 4], idleChance: 0.2, resizeChance: 0.05, uTurnChance: 0.15 },
    { name: 'window_shopper', scrollDepth: 0.65, clickRate: 0.55, readTime: [1500, 4000], pageCount: [2, 3], idleChance: 0.12, resizeChance: 0.1, uTurnChance: 0.25 },
    { name: 'quick_scanner', scrollDepth: 0.4, clickRate: 0.35, readTime: [1000, 2500], pageCount: [1, 2], idleChance: 0.05, resizeChance: 0.0, uTurnChance: 0.1 },
  ];
}

function buildBuiltinProfiles(port = 4310) {
  const demoBase = `http://127.0.0.1:${port}/demo-site`;

  return [
    {
      id: 'content-adsense-reading',
      name: 'אתר תוכן + Google AdSense (קריאה בטוחה)',
      description: 'מותאם לאתרי תוכן ומאמרים עם AdSense: קריאה אנושית הדרגתית, שהייה טבעית ומעבר בין כתבות עם אפס לחיצות על מודעות.',
      category: 'content_adsense',
      isBuiltin: true,
      config: {
        targetUrl: demoBase,
        pages: ['/', '/about', '/pricing'],
        visitCount: 5,
        minConcurrency: 1,
        concurrency: 3,
        firstPagePriority: 50,
        sessionTimeoutMs: 120000,
        pageMinMs: 5500,
        headless: false,
        engineMode: 'crawlee_autoscaled',
        taskMode: 'hybrid',
        keepBrowserOpenMs: 2000,
        devices: { desktopChrome: 45, iphone14: 25, pixel7: 15, desktopFirefox: 8, desktopSafari: 5, ipadPro: 2 },
        personas: readerPersonas(),
        adSafety: defaultAdSafety(false),
        taskSteps: [
          step('goto', '', '/', 'פתיחת דף ראשי / מאמר'),
          step('wait', '', '2000', 'המתנת טעינת יחידות AdSense (2s)'),
          step('dismiss_overlays', '', '', 'סגירת Vignette / שכבות אם מופיעות'),
          step('audit_ads', '', '', 'בדיקת נוכחות מודעות ו-AdSense (אפס קליק)'),
          step('read_article', '', '8500', 'קריאת תוכן אנושית (גלילה ועצירות קריאה)'),
          step('screenshot', '', 'Content AdSense Reading', 'צילום דף בתום הקריאה'),
        ],
      },
    },
    {
      id: 'landing-forms-qa',
      name: 'אתר תדמית וטופסי לידים (QA דמו)',
      description: 'בודק זמינות דפים, מילוי טופס יצירת קשר ואימות שהשרת מחזיר אישור שליחה תקין.',
      category: 'forms_qa',
      isBuiltin: true,
      config: {
        targetUrl: demoBase,
        pages: ['/', '/about', '/pricing', '/contact'],
        visitCount: 2,
        minConcurrency: 1,
        concurrency: 2,
        firstPagePriority: 60,
        sessionTimeoutMs: 90000,
        pageMinMs: 3000,
        headless: false,
        engineMode: 'crawlee_autoscaled',
        taskMode: 'scenario',
        keepBrowserOpenMs: 2000,
        adSafety: defaultAdSafety(false),
        taskSteps: [
          step('goto', '', '/contact', 'פתיחת דף צור קשר'),
          step('fill', 'input[name="name"]', 'Avi QA Tester', 'הזנת שם מלא'),
          step('fill', 'input[name="email"]', 'qa@hirepulse.dev', 'הזנת אימייל'),
          step('select', 'select[name="topic"]', 'demo', 'בחירת נושא'),
          step('fill', 'textarea[name="message"]', 'Automated end-to-end form QA check', 'הזנת הודעה'),
          step('click', 'button[type="submit"]', '', 'שליחת הטופס'),
          step('wait', '', '400', 'המתנה לתשובה'),
          step('assert', '#form-status', 'Form received by QA Sandbox!', 'אימות הודעת הצלחה'),
        ],
      },
    },
    {
      id: 'human-deep-reader-blog',
      name: 'בלוג ומאמרים: קריאה עמוקה והתנהגות אנושית (Hybrid)',
      description: 'משלב צעדים מוגדרים (קריאת מאמר + גלישה אנושית + ריחוף + לחיצה על ניווט) עם המשך גלישה חופשית לפי פרסונות.',
      category: 'human_reading',
      isBuiltin: true,
      config: {
        targetUrl: demoBase,
        pages: ['/', '/about', '/pricing', '/contact'],
        visitCount: 3,
        minConcurrency: 1,
        concurrency: 2,
        firstPagePriority: 65,
        sessionTimeoutMs: 120000,
        pageMinMs: 5000,
        headless: true,
        engineMode: 'crawlee_autoscaled',
        taskMode: 'hybrid',
        keepBrowserOpenMs: 2000,
        personas: readerPersonas(),
        adSafety: defaultAdSafety(false),
        taskSteps: [
          step('goto', '', '/', 'כניסה לדף הבית של האתר'),
          step('wait', '', '1500', 'השהיית קריאה ראשונית טבעית'),
          step('read_article', '', '6500', 'קריאה אנושית הדרגתית של התוכן'),
          step('human_browse', '', '4500', 'שליטה אנושית בעכבר, גלילות ובחירת טקסט'),
          step('hover', 'nav a[href*="/about"]', '700', 'ריחוף עכבר על קישור "אודות" בתפריט'),
          step('click', 'nav a[href*="/about"]', '', 'לחיצה על קישור אודות (כאן תוכל לשנות ללינק שלך)'),
          step('wait', '', '1200', 'המתנה לטעינת המאמר הפנימי'),
          step('read_article', '', '5000', 'קריאת העמוד הפנימי'),
          step('screenshot', '', 'Deep Reader Flow', 'צילום סיום המסלול'),
        ],
      },
    },
    {
      id: 'multi-page-funnel-template',
      name: 'משפך רב-עמודי: בית ← מחירון ← צור קשר (תבנית לחיצות)',
      description: 'דוגמה חיה למעבר בין דפים בלחיצות כפתור אמיתיות, בדיקת URL, קריאה וצילום מסך. החלף targetUrl והסלקטורים לאתר שלך.',
      category: 'funnel_ux',
      isBuiltin: true,
      config: {
        targetUrl: demoBase,
        pages: ['/', '/pricing', '/contact'],
        visitCount: 2,
        minConcurrency: 1,
        concurrency: 2,
        firstPagePriority: 80,
        sessionTimeoutMs: 90000,
        pageMinMs: 3000,
        headless: false,
        engineMode: 'crawlee_autoscaled',
        taskMode: 'scenario',
        keepBrowserOpenMs: 2000,
        adSafety: defaultAdSafety(false),
        taskSteps: [
          step('goto', '', '/', '1. כניסה לדף הנחיתה הראשי'),
          step('human_browse', '', '3000', '2. גלילה וריחוף אנושי בדף הבית'),
          step('hover', '#hero-cta', '600', '3. ריחוף על כפתור פעולה ראשי'),
          step('click', '#hero-cta', '', '4. לחיצה על כפתור הפעולה בדף הבית'),
          step('click', 'a.btn[href="/demo-site/pricing"]', '', '5. מעבר בלחיצה לעמוד המחירון'),
          step('assert', '', '/pricing', '6. אימות שהגענו ל-/pricing', 'url_contains'),
          step('scroll', '', '60', '7. גלילה לסקירת תוכן המחירון'),
          step('click', 'a.btn[href="/demo-site/contact"]', '', '8. לחיצה על "Start Trial" למעבר לטופס'),
          step('assert', '', '/contact', '9. אימות שהגענו לדף צור קשר', 'url_contains'),
          step('screenshot', '', 'Multi-Page Funnel Done', '10. צילום הגעה לסוף המשפך'),
        ],
      },
    },
    {
      id: 'mobile-thumb-scroller',
      name: 'חוויית מובייל אמיתית (iPhone 14 + Pixel 7): גלילה ולחיצה',
      description: 'מריץ 100% מכשירי מובייל אמולטור, בודק גלילה באגודל, קריאה אנושית, התאמה רספונסיבית ולחיצת כפתור ניווט.',
      category: 'mobile_ux',
      isBuiltin: true,
      config: {
        targetUrl: demoBase,
        pages: ['/', '/about', '/pricing'],
        visitCount: 3,
        minConcurrency: 1,
        concurrency: 2,
        firstPagePriority: 60,
        sessionTimeoutMs: 90000,
        pageMinMs: 4000,
        headless: false,
        engineMode: 'crawlee_autoscaled',
        taskMode: 'scenario',
        keepBrowserOpenMs: 2000,
        devices: { desktopChrome: 0, iphone14: 60, pixel7: 40, desktopFirefox: 0, desktopSafari: 0, ipadPro: 0 },
        adSafety: defaultAdSafety(false),
        taskSteps: [
          step('goto', '', '/', 'פתיחת האתר בתצוגת מובייל'),
          step('wait', '', '1200', 'המתנה ליציבות תצוגה'),
          step('scroll', '', '45', 'גלילת אמצע מסך מובייל (45%)'),
          step('read_article', '', '5500', 'קריאה אנושית מותאמת מובייל'),
          step('scroll_to', 'button[data-action="cta_explore"]', '', 'גלילה אל כפתור תחתון'),
          step('click', 'button[data-action="cta_explore"]', '', 'לחיצה על כפתור במובייל'),
          step('human_browse', '', '3000', 'גלישה חופשית קצרה במובייל'),
          step('screenshot', '', 'Mobile Viewport Audit', 'צילום מסך מובייל סופי'),
        ],
      },
    },
    {
      id: 'returning-visitor-session',
      name: 'משתמש חוזר + שמירת עוגיות (Persistent Profiles)',
      description: 'מדגים סשנים עם שמירת Cookies והיסטוריה בדיסק (returningUserRate=85%), התנהגות אנושית ולחיצות ניווט.',
      category: 'persistence',
      isBuiltin: true,
      config: {
        targetUrl: demoBase,
        pages: ['/', '/about', '/pricing'],
        visitCount: 4,
        minConcurrency: 1,
        concurrency: 2,
        firstPagePriority: 55,
        sessionTimeoutMs: 90000,
        pageMinMs: 4000,
        headless: false,
        engineMode: 'crawlee_autoscaled',
        taskMode: 'hybrid',
        keepBrowserOpenMs: 1500,
        sessionPersistence: { enabled: true, returningUserRate: 85, profilePoolSize: 5 },
        adSafety: defaultAdSafety(false),
        taskSteps: [
          step('goto', '', '/', 'טעינת דף הבית עם פרופיל עוגיות'),
          step('human_browse', '', '4500', 'גלישה טבעית עם פרופיל שמור'),
          step('click', '#hero-cta', '', 'לחיצת פעולה (תיעוד משתמש חדש/חוזר)'),
          step('screenshot', '', 'Persistent Cookie Session', 'צילום סיום סשן'),
        ],
      },
    },
    {
      id: 'analytics-utm-and-buttons-qa',
      name: 'אימות UTM, מדידות ולחיצות כפתורים (Analytics QA)',
      description: 'נכנס עם פרמטרי קמפיין (UTM), לוחץ על מספר כפתורים באתר ומציג הוכחות מדויקות בלוג ובטאב האנליטיקס.',
      category: 'analytics_qa',
      isBuiltin: true,
      config: {
        targetUrl: demoBase,
        pages: ['/', '/pricing'],
        visitCount: 2,
        minConcurrency: 1,
        concurrency: 2,
        firstPagePriority: 100,
        sessionTimeoutMs: 90000,
        pageMinMs: 3500,
        headless: false,
        engineMode: 'crawlee_autoscaled',
        taskMode: 'scenario',
        keepBrowserOpenMs: 2500,
        adSafety: defaultAdSafety(false),
        taskSteps: [
          step('goto', '', '/?utm_source=self_learn&utm_medium=qa&utm_campaign=clicks_proof', 'כניסה עם פרמטרי UTM לבדיקת מדידה'),
          step('wait', '', '1500', 'המתנה לשליחת Pageview ראשוני'),
          step('hover', '#hero-cta', '600', 'ריחוף לפני קליק 1'),
          step('click', '#hero-cta', '', 'קליק מדוד #1: כפתור ראשי'),
          step('scroll_to', 'button[data-action="cta_explore"]', '', 'גלילה לכפתור מדידות'),
          step('click', 'button[data-action="cta_explore"]', '', 'קליק מדוד #2: Explore Metrics'),
          step('click', 'button[data-action="cta_docs"]', '', 'קליק מדוד #3: Read Docs'),
          step('screenshot', '', 'Analytics UTM Click Proof', 'צילום הוכחת קליקים ומדידות'),
        ],
      },
    },
    {
      id: 'blank-human-starter-template',
      name: 'תבנית התאמה עצמאית: התנהגות אנושית + מקום ללחיצה שלך',
      description: 'נקודת פתיחה נקייה ללימוד עצמי: שנה רק את targetUrl ואת ה-Selector בצעד הלחיצה (צעד 6) לכל כפתור/לינק באתר שלך.',
      category: 'starter_template',
      isBuiltin: true,
      config: {
        targetUrl: demoBase,
        pages: ['/'],
        visitCount: 2,
        minConcurrency: 1,
        concurrency: 1,
        firstPagePriority: 100,
        sessionTimeoutMs: 90000,
        pageMinMs: 4000,
        headless: true,
        engineMode: 'crawlee_autoscaled',
        taskMode: 'scenario',
        keepBrowserOpenMs: 2500,
        adSafety: defaultAdSafety(false),
        taskSteps: [
          step('goto', '', '/', 'שלב 1: שנה את targetUrl למעלה לכתובת האתר שלך'),
          step('wait', '', '1500', 'שלב 2: המתנה לטעינת תסריטים בדף'),
          step('dismiss_overlays', '', '', 'שלב 3: סגירה אוטומטית של פופ-אפים חוסמים'),
          step('read_article', '', '5000', 'שלב 4: קריאה אנושית עם עצירות גלילה'),
          step('human_browse', '', '4500', 'שלב 5: תנועת עכבר בזייה + ריחוף + בחירת טקסט'),
          step('click', '#hero-cta', '', 'שלב 6: שנה כאן את ה-Selector (או טקסט הכפתור) שלך!'),
          step('wait', '', '1200', 'שלב 7: המתנה קצרה אחרי הלחיצה'),
          step('screenshot', '', 'My Custom Flow Result', 'שלב 8: צילום הוכחה בסיום'),
        ],
      },
    },
    {
      id: 'qa-fingerprint-audit',
      name: 'בדיקת עקביות טביעת אצבע ובוט-סיגנל (Fingerprint QA)',
      description: 'בודק בדף האבחון המקומי תאימות OS/WebGL, HTTP Referer, הסתרת webdriver, אזור זמן ואירועי קלט אנושיים.',
      category: 'demo',
      isBuiltin: true,
      config: {
        targetUrl: demoBase,
        pages: ['/fingerprint-check', '/', '/about', '/contact'],
        visitCount: 2,
        minConcurrency: 1,
        concurrency: 2,
        firstPagePriority: 100,
        sessionTimeoutMs: 60000,
        pageMinMs: 2500,
        headless: true,
        engineMode: 'crawlee_autoscaled',
        taskMode: 'scenario',
        keepBrowserOpenMs: 500,
        devices: hostConsistentDevices(),
        sessionPersistence: defaultSessionPersistence(),
        adSafety: defaultAdSafety(false),
        taskSteps: [
          step('goto', '', '/fingerprint-check', 'פתיחת דף בדיקת טביעת האצבע'),
          step('wait', '', '700', 'המתנה לאיסוף מדדים'),
          step('human_browse', '', '2800', 'יצירת אירועי גלילה ועכבר אנושיים'),
          step('click', '#fp-interact-btn', '', 'לחיצה על כפתור בדיקת קלט'),
          step('assert', '#fp-status', 'CLEAN_CONSISTENT', 'אימות ציון עקביות מושלם (0 סתירות)', 'text_contains'),
          step('assert', '#fp-status', 'Score: 100/100', 'אימות ציון 100/100', 'text_contains'),
          step('screenshot', '', 'Fingerprint QA Clean', 'צילום דוח עקביות'),
        ],
      },
    },
  ];
}

function getActiveProfileId() {
  try {
    if (!fs.existsSync(META_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
    return typeof raw.activeProfileId === 'string' ? raw.activeProfileId : null;
  } catch {
    return null;
  }
}

function setActiveProfileId(id) {
  fs.mkdirSync(SITE_PROFILES_DIR, { recursive: true });
  fs.writeFileSync(META_PATH, JSON.stringify({ activeProfileId: id || null, updatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
}

function ensureBuiltinSiteProfiles(validateCfgFn, port = 4310) {
  fs.mkdirSync(SITE_PROFILES_DIR, { recursive: true });
  const builtins = buildBuiltinProfiles(port);
  for (const p of builtins) {
    const file = path.join(SITE_PROFILES_DIR, `${p.id}.json`);
    if (!fs.existsSync(file)) {
      const normalized = {
        ...p,
        updatedAt: new Date().toISOString(),
        config: validateCfgFn(p.config),
      };
      fs.writeFileSync(file, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
    }
  }
  if (!getActiveProfileId()) {
    setActiveProfileId('blank-human-starter-template');
  }
}

function listSiteProfiles(validateCfgFn, port = 4310) {
  ensureBuiltinSiteProfiles(validateCfgFn, port);
  const files = fs.readdirSync(SITE_PROFILES_DIR).filter(f => f.endsWith('.json') && f !== '_meta.json');
  const profiles = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(SITE_PROFILES_DIR, f), 'utf8'));
      if (!raw || typeof raw !== 'object') continue;
      profiles.push({
        id: sanitizeProfileId(raw.id || f.replace(/\.json$/i, '')),
        name: String(raw.name || raw.id || f),
        description: String(raw.description || ''),
        category: String(raw.category || 'custom'),
        isBuiltin: Boolean(raw.isBuiltin),
        updatedAt: raw.updatedAt || null,
        config: validateCfgFn(raw.config || {}),
      });
    } catch {}
  }
  const activeId = getActiveProfileId();
  profiles.sort((a, b) => {
    if (a.id === activeId && b.id !== activeId) return -1;
    if (b.id === activeId && a.id !== activeId) return 1;
    if (a.isBuiltin !== b.isBuiltin) return a.isBuiltin ? 1 : -1;
    return a.name.localeCompare(b.name, 'he');
  });
  return {
    activeProfileId: getActiveProfileId(),
    profiles,
  };
}

function getSiteProfile(id, validateCfgFn, port = 4310) {
  const safeId = sanitizeProfileId(id);
  ensureBuiltinSiteProfiles(validateCfgFn, port);
  const file = path.join(SITE_PROFILES_DIR, `${safeId}.json`);
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    id: safeId,
    name: String(raw.name || safeId),
    description: String(raw.description || ''),
    category: String(raw.category || 'custom'),
    isBuiltin: Boolean(raw.isBuiltin),
    updatedAt: raw.updatedAt || null,
    config: validateCfgFn(raw.config || {}),
  };
}

function saveSiteProfile({ id, name, description, category, config }, validateCfgFn, port = 4310) {
  ensureBuiltinSiteProfiles(validateCfgFn, port);
  const cleanName = String(name || '').trim();
  if (!cleanName && !id) {
    throw new Error('חובה להזין שם לפרופיל האתר.');
  }
  const safeId = sanitizeProfileId(id || cleanName);
  const existing = getSiteProfile(safeId, validateCfgFn, port);
  const profile = {
    id: safeId,
    name: cleanName || existing?.name || safeId,
    description: description != null ? String(description).trim() : (existing?.description || ''),
    category: category || existing?.category || 'custom',
    isBuiltin: existing ? existing.isBuiltin : false,
    updatedAt: new Date().toISOString(),
    config: validateCfgFn(config || existing?.config || {}),
  };
  fs.writeFileSync(path.join(SITE_PROFILES_DIR, `${safeId}.json`), JSON.stringify(profile, null, 2) + '\n', 'utf8');
  setActiveProfileId(safeId);
  return profile;
}

function deleteSiteProfile(id, validateCfgFn, port = 4310) {
  const existing = getSiteProfile(id, validateCfgFn, port);
  if (!existing) throw new Error('הפרופיל המבוקש לא נמצא.');
  if (existing.isBuiltin) {
    throw new Error('לא ניתן למחוק פרופיל מובנה של המערכת — אפשר לערוך אותו או לשמור פרופיל מותאם חדש.');
  }
  fs.unlinkSync(path.join(SITE_PROFILES_DIR, `${existing.id}.json`));
  if (getActiveProfileId() === existing.id) {
    setActiveProfileId('cleantab-ads-qa');
  }
  return existing.id;
}

module.exports = {
  SITE_PROFILES_DIR,
  ensureBuiltinSiteProfiles,
  listSiteProfiles,
  getSiteProfile,
  saveSiteProfile,
  deleteSiteProfile,
  getActiveProfileId,
  setActiveProfileId,
};
