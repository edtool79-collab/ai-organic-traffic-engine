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
      name: 'Content Site + Google AdSense (Safe Reading)',
      description: 'Tailored for content and article sites with AdSense: progressive human reading, natural dwell time, and multi-article navigation with zero ad clicks.',
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
          step('goto', '', '/', 'Open landing page / article'),
          step('wait', '', '2000', 'Wait for AdSense units to load (2s)'),
          step('dismiss_overlays', '', '', 'Dismiss vignette / blocking overlays if present'),
          step('audit_ads', '', '', 'Audit ad slots and AdSense presence (zero clicks)'),
          step('read_article', '', '8500', 'Human article reading (progressive scroll & pauses)'),
          step('screenshot', '', 'Content AdSense Reading', 'Capture page screenshot after reading'),
        ],
      },
    },
    {
      id: 'landing-forms-qa',
      name: 'Landing Page & Lead Forms (Demo QA)',
      description: 'Verifies page availability, fills out the contact form, and asserts that the server returns a valid submission confirmation.',
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
          step('goto', '', '/contact', 'Open contact page'),
          step('fill', 'input[name="name"]', 'Avi QA Tester', 'Enter full name'),
          step('fill', 'input[name="email"]', 'qa@hirepulse.dev', 'Enter email address'),
          step('select', 'select[name="topic"]', 'demo', 'Select inquiry topic'),
          step('fill', 'textarea[name="message"]', 'Automated end-to-end form QA check', 'Enter message body'),
          step('click', 'button[type="submit"]', '', 'Submit contact form'),
          step('wait', '', '400', 'Wait for submission response'),
          step('assert', '#form-status', 'Form received by QA Sandbox!', 'Verify confirmation banner'),
        ],
      },
    },
    {
      id: 'human-deep-reader-blog',
      name: 'Blog & Articles: Deep Reading & Human Behavior (Hybrid)',
      description: 'Combines structured scenario steps (article reading + human browse + hover + navigation click) with autonomous persona browsing.',
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
          step('goto', '', '/', 'Open site home page'),
          step('wait', '', '1500', 'Initial natural reading pause'),
          step('read_article', '', '6500', 'Progressive human reading of primary content'),
          step('human_browse', '', '4500', 'Human mouse trajectories, scrolls, and text selection'),
          step('hover', 'nav a[href*="/about"]', '700', 'Hover mouse over "About" link in navigation'),
          step('click', 'nav a[href*="/about"]', '', 'Click About link (customize to match your nav)'),
          step('wait', '', '1200', 'Wait for internal page load'),
          step('read_article', '', '5000', 'Read internal article page'),
          step('screenshot', '', 'Deep Reader Flow', 'Capture end-of-journey screenshot'),
        ],
      },
    },
    {
      id: 'multi-page-funnel-template',
      name: 'Multi-Page Funnel: Home -> Pricing -> Contact (Click Template)',
      description: 'Live example of multi-page navigation via real button clicks, URL assertions, reading scrolls, and screenshot capture.',
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
          step('goto', '', '/', '1. Open main landing page'),
          step('human_browse', '', '3000', '2. Human scroll and hover on home page'),
          step('hover', '#hero-cta', '600', '3. Hover over primary CTA button'),
          step('click', '#hero-cta', '', '4. Click primary CTA button on home page'),
          step('click', 'a.btn[href="/demo-site/pricing"]', '', '5. Click through to Pricing page'),
          step('assert', '', '/pricing', '6. Verify navigation to /pricing', 'url_contains'),
          step('scroll', '', '60', '7. Scroll to review pricing tiers'),
          step('click', 'a.btn[href="/demo-site/contact"]', '', '8. Click "Start Trial" to open contact form'),
          step('assert', '', '/contact', '9. Verify arrival on /contact page', 'url_contains'),
          step('screenshot', '', 'Multi-Page Funnel Done', '10. Capture funnel completion screenshot'),
        ],
      },
    },
    {
      id: 'mobile-thumb-scroller',
      name: 'Mobile UX Experience (iPhone 14 + Pixel 7): Scroll & Tap',
      description: 'Runs 100% mobile device emulation, testing thumb scrolling, mobile article reading, responsive layout, and CTA tapping.',
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
          step('goto', '', '/', 'Open site in mobile viewport'),
          step('wait', '', '1200', 'Wait for layout stability'),
          step('scroll', '', '45', 'Mid-page mobile thumb scroll (45%)'),
          step('read_article', '', '5500', 'Mobile-paced human reading'),
          step('scroll_to', 'button[data-action="cta_explore"]', '', 'Scroll to bottom CTA button'),
          step('click', 'button[data-action="cta_explore"]', '', 'Tap CTA button on mobile'),
          step('human_browse', '', '3000', 'Brief free browsing on mobile'),
          step('screenshot', '', 'Mobile Viewport Audit', 'Capture final mobile viewport screenshot'),
        ],
      },
    },
    {
      id: 'returning-visitor-session',
      name: 'Returning Visitor + Persistent Cookies (Persistent Profiles)',
      description: 'Demonstrates sessions with on-disk cookies and browsing history (returningUserRate=85%), human browsing, and CTA interaction.',
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
          step('goto', '', '/', 'Load home page with persistent cookie profile'),
          step('human_browse', '', '4500', 'Natural browsing with saved profile'),
          step('click', '#hero-cta', '', 'Click primary CTA (logs returning vs. new visitor)'),
          step('screenshot', '', 'Persistent Cookie Session', 'Capture end-of-session screenshot'),
        ],
      },
    },
    {
      id: 'analytics-utm-and-buttons-qa',
      name: 'UTM Attribution, Telemetry & Button Clicks (Analytics QA)',
      description: 'Enters with campaign UTM parameters, clicks multiple tracked buttons, and records verification proof in the logs and analytics tab.',
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
          step('goto', '', '/?utm_source=self_learn&utm_medium=qa&utm_campaign=clicks_proof', 'Enter with UTM parameters for attribution QA'),
          step('wait', '', '1500', 'Wait for initial pageview beacon'),
          step('hover', '#hero-cta', '600', 'Hover before Click #1'),
          step('click', '#hero-cta', '', 'Tracked Click #1: Hero CTA'),
          step('scroll_to', 'button[data-action="cta_explore"]', '', 'Scroll to Explore Metrics button'),
          step('click', 'button[data-action="cta_explore"]', '', 'Tracked Click #2: Explore Metrics'),
          step('click', 'button[data-action="cta_docs"]', '', 'Tracked Click #3: Read Docs'),
          step('screenshot', '', 'Analytics UTM Click Proof', 'Capture click & attribution proof screenshot'),
        ],
      },
    },
    {
      id: 'blank-human-starter-template',
      name: 'Custom Starter Template: Human Behavior + Custom Click Slot',
      description: 'Clean starting point: just update targetUrl and the selector in Step 6 to match any button or link on your own site.',
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
          step('goto', '', '/', 'Step 1: Set targetUrl above to your site URL'),
          step('wait', '', '1500', 'Step 2: Wait for page scripts to initialize'),
          step('dismiss_overlays', '', '', 'Step 3: Automatically dismiss blocking pop-ups'),
          step('read_article', '', '5000', 'Step 4: Human reading with scroll checkpoints'),
          step('human_browse', '', '4500', 'Step 5: Bezier mouse movement + hover + text selection'),
          step('click', '#hero-cta', '', 'Step 6: Replace with your own button selector or text!'),
          step('wait', '', '1200', 'Step 7: Brief settle wait after click'),
          step('screenshot', '', 'My Custom Flow Result', 'Step 8: Capture completion proof screenshot'),
        ],
      },
    },
    {
      id: 'qa-fingerprint-audit',
      name: 'Fingerprint Consistency & Bot-Signal Audit (Fingerprint QA)',
      description: 'Verifies OS/WebGL consistency, HTTP Referer, webdriver masking, timezone alignment, and human input events on the local diagnostic page.',
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
          step('goto', '', '/fingerprint-check', 'Open fingerprint diagnostic page'),
          step('wait', '', '700', 'Wait for probe collection'),
          step('human_browse', '', '2800', 'Generate human scroll and mouse input events'),
          step('click', '#fp-interact-btn', '', 'Click interactive input verification button'),
          step('assert', '#fp-status', 'CLEAN_CONSISTENT', 'Assert zero fingerprint contradictions (CLEAN_CONSISTENT)', 'text_contains'),
          step('assert', '#fp-status', 'Score: 100/100', 'Assert consistency score 100/100', 'text_contains'),
          step('screenshot', '', 'Fingerprint QA Clean', 'Capture consistency audit report'),
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
    return a.name.localeCompare(b.name, 'en');
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
    throw new Error('Site profile name is required.');
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
  if (!existing) throw new Error('Requested site profile was not found.');
  if (existing.isBuiltin) {
    throw new Error('Built-in system profiles cannot be deleted — you can update them or save a new custom profile.');
  }
  fs.unlinkSync(path.join(SITE_PROFILES_DIR, `${existing.id}.json`));
  if (getActiveProfileId() === existing.id) {
    setActiveProfileId('blank-human-starter-template');
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
