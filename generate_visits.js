const { firefox, webkit, devices } = require('playwright');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG_PATH = process.argv[2] || path.join(__dirname, 'config.json');
let cfg = {};
if (fs.existsSync(CONFIG_PATH)) {
  cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  console.log(`Loaded config: ${CONFIG_PATH}`);
} else {
  console.warn(`No config.json found — using built-in defaults`);
}

if (!cfg.targetUrl) { console.error('config.json must specify "targetUrl"'); process.exit(1); }

const VISIT_COUNT         = cfg.visitCount         ?? 1000;
const TARGET_URL          = cfg.targetUrl.replace(/\/$/, '');
const CONCURRENCY         = parseInt(process.env.CONCURRENCY ?? String(cfg.concurrency ?? 5), 10);
const FIRST_PAGE_PRIORITY = (cfg.firstPagePriority ?? 60) / 100;
const SESSION_TIMEOUT_MS  = cfg.sessionTimeoutMs   ?? 90_000;
const PAGE_MIN_MS         = cfg.pageMinMs           ?? 4_000;

const EXTRA_PAGES = (() => {
  const p = Array.isArray(cfg.pages) ? [...new Set(cfg.pages.map(x => {
    if (typeof x !== 'string') return '';
    const trimmed = x.trim();
    if (!trimmed) return '';
    return trimmed.startsWith('/') ? trimmed : '/' + trimmed;
  }).filter(Boolean))] : null;
  return (p && p.length) ? p : ['/'];
})();

const FIRST_PAGE = EXTRA_PAGES[0];

// Optional proxy rotation configuration
function parseProxyEntry(raw) {
  const str = typeof raw === 'string' ? raw.trim() : raw?.server;
  if (!str) return null;
  try {
    const u = new URL(str);
    const out = { server: `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}` };
    if (u.username || raw?.username) out.username = raw?.username || decodeURIComponent(u.username);
    if (u.password || raw?.password) out.password = raw?.password || decodeURIComponent(u.password);
    return out;
  } catch {
    return null;
  }
}

const PROXY_SERVERS = (cfg.proxy?.enabled && Array.isArray(cfg.proxy.servers))
  ? cfg.proxy.servers.map(parseProxyEntry).filter(Boolean)
  : [];
const PROXY_MODE = cfg.proxy?.mode === 'random' ? 'random' : 'round_robin';

// Optional session / cookies persistence for returning-user simulation
const SESSION_PERSISTENCE = Boolean(cfg.sessionPersistence?.enabled);
const RETURNING_USER_RATE = Math.min(1, Math.max(0, (cfg.sessionPersistence?.returningUserRate ?? 50) / 100));
const PROFILE_POOL_SIZE   = Math.max(1, parseInt(String(cfg.sessionPersistence?.profilePoolSize ?? 10), 10) || 10);
const PROFILES_DIR        = path.join(__dirname, 'session-profiles');
const activeProfileSlots  = new Set();

function acquireSessionProfile() {
  if (!SESSION_PERSISTENCE) return null;
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
  const existingSlots = [];
  const emptySlots = [];
  for (let slot = 1; slot <= PROFILE_POOL_SIZE; slot++) {
    if (activeProfileSlots.has(slot)) continue;
    const fp = path.join(PROFILES_DIR, `profile_${String(slot).padStart(2, '0')}.json`);
    if (fs.existsSync(fp)) existingSlots.push({ slot, filePath: fp, isReturning: true });
    else emptySlots.push({ slot, filePath: fp, isReturning: false });
  }
  let chosen = null;
  if (existingSlots.length && (Math.random() < RETURNING_USER_RATE || !emptySlots.length)) {
    chosen = existingSlots[Math.floor(Math.random() * existingSlots.length)];
  } else if (emptySlots.length) {
    chosen = emptySlots[Math.floor(Math.random() * emptySlots.length)];
  } else if (existingSlots.length) {
    chosen = existingSlots[Math.floor(Math.random() * existingSlots.length)];
  }
  if (chosen) activeProfileSlots.add(chosen.slot);
  return chosen;
}

// Optional snippet injected at the start of every page load.
// Accepts a raw JS string or a full <script>…</script> block.
const PAGE_SNIPPET = (() => {
  const raw = cfg.snippet;
  if (!raw) return null;
  const match = raw.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
  return (match ? match[1] : raw).trim() || null;
})();

// Chrome UA strings — stable-release format so headless-shell build versions don't leak
const CHROME_DESKTOP_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
];

const CHROME_MOBILE_UAS = [
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.6478.72 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.7049.115 Mobile Safari/537.36',
];

// ─── Devices & browsers ───────────────────────────────────────────────────────

// Map of config key → static browser/device spec. Chrome configs run on the Firefox
// engine so the headless-shell isn't fingerprinted by bot filters.
const DEVICE_MAP = {
  desktopChrome:  { device: devices['Desktop Chrome'],  browser: firefox, uaPool: CHROME_DESKTOP_UAS },
  desktopFirefox: { device: devices['Desktop Firefox'], browser: firefox  },
  desktopSafari:  { device: devices['Desktop Safari'],  browser: webkit   },
  iphone14:       { device: devices['iPhone 14'],       browser: webkit   },
  pixel7:         { device: devices['Pixel 7'],         browser: firefox, uaPool: CHROME_MOBILE_UAS  },
  ipadPro:        { device: devices['iPad Pro 11'],     browser: webkit   },
};

const DEFAULT_DEVICE_WEIGHTS = { desktopChrome: 40, iphone14: 20, pixel7: 12, desktopFirefox: 10, desktopSafari: 10, ipadPro: 8 };
const cfgDevices   = { ...DEFAULT_DEVICE_WEIGHTS, ...(cfg.devices || {}) };
const DEVICE_CONFIGS = Object.entries(cfgDevices)
  .filter(([k, w]) => DEVICE_MAP[k] && w > 0)
  .map(([k, weight]) => ({ ...DEVICE_MAP[k], weight }));

if (!DEVICE_CONFIGS.length) {
  console.error('config.json must enable at least one device with weight > 0');
  process.exit(1);
}

// ─── Browser pool (shared instances across all visits) ────────────────────────

const browserPool     = new Map(); // key → Browser
const browserLaunching = new Map(); // key → Promise<Browser>

async function getBrowser(browserType) {
  const key = browserType === firefox ? 'firefox' : 'webkit';
  const existing = browserPool.get(key);
  if (existing && existing.isConnected()) return existing;
  if (browserLaunching.has(key)) return browserLaunching.get(key);

  const p = browserType.launch({ headless: true }).then(b => {
    browserPool.set(key, b);
    browserLaunching.delete(key);
    return b;
  }).catch(err => {
    browserLaunching.delete(key);
    throw err;
  });
  browserLaunching.set(key, p);
  return p;
}

async function closeAllBrowsers() {
  for (const b of browserPool.values()) await b.close().catch(() => {});
  browserPool.clear();
}

// ─── Fake data ────────────────────────────────────────────────────────────────

const FIRST_NAMES  = ['James','Emma','Liam','Olivia','Noah','Ava','William','Sophia','Oliver','Isabella','Elijah','Mia','Lucas','Charlotte','Mason','Amelia','Ethan','Harper','Aiden','Evelyn'];
const LAST_NAMES   = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Wilson','Taylor','Anderson','Thomas','Jackson','White','Harris','Martin','Thompson'];
const DOMAINS      = ['gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','proton.me'];
const SEARCH_TERMS = ['pricing','features','demo','contact','about','how it works','sign up','login','trial','review'];
const SENTENCES    = [
  'This looks really interesting, I would like to learn more.',
  'Can you tell me more about the pricing?',
  'I found this through a colleague recommendation.',
  'Looking for something like this for our team.',
  'Just exploring to see if this fits our needs.',
];

// ─── Personas ─────────────────────────────────────────────────────────────────

const DEFAULT_PERSONAS = [
  { name: 'quick_scanner',  scrollDepth: 0.3, clickRate: 0.5, readTime: [500,  1800], pageCount: [1,2], idleChance: 0.04, resizeChance: 0.0,  uTurnChance: 0.2  },
  { name: 'engaged_reader', scrollDepth: 0.9, clickRate: 0.7, readTime: [2000, 5000], pageCount: [2,4], idleChance: 0.15, resizeChance: 0.1,  uTurnChance: 0.05 },
  { name: 'form_filler',    scrollDepth: 0.6, clickRate: 0.9, readTime: [1000, 3000], pageCount: [2,3], idleChance: 0.10, resizeChance: 0.05, uTurnChance: 0.05 },
  { name: 'window_shopper', scrollDepth: 0.5, clickRate: 0.6, readTime: [800,  2500], pageCount: [2,5], idleChance: 0.08, resizeChance: 0.15, uTurnChance: 0.3  },
  { name: 'power_user',     scrollDepth: 1.0, clickRate: 0.9, readTime: [1500, 4000], pageCount: [3,6], idleChance: 0.12, resizeChance: 0.2,  uTurnChance: 0.1  },
];

const PERSONAS = (Array.isArray(cfg.personas) && cfg.personas.length)
  ? cfg.personas.map(p => ({
      name:         p.name         ?? 'custom',
      scrollDepth:  p.scrollDepth  ?? 0.5,
      clickRate:    p.clickRate    ?? 0.5,
      readTime:     p.readTime     ?? [1000, 3000],
      pageCount:    p.pageCount    ?? [1, 3],
      idleChance:   p.idleChance   ?? 0.08,
      resizeChance: p.resizeChance ?? 0.1,
      uTurnChance:  p.uTurnChance  ?? 0.1,
    }))
  : DEFAULT_PERSONAS;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function weightedRandom(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

const randomDeviceConfig = () => weightedRandom(DEVICE_CONFIGS, DEVICE_CONFIGS.map(c => c.weight));
const randomPersona = () => PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
const randomBetween = (min, max) => min + Math.random() * (max - min);
const randomInt     = (min, max) => Math.floor(randomBetween(min, max + 1));
const randomChoice  = arr => arr[Math.floor(Math.random() * arr.length)];
const sleep         = ms => new Promise(r => setTimeout(r, ms));

function fakeEmail() {
  const sep = randomChoice(['', '.', '_']);
  const num = Math.random() < 0.3 ? randomInt(1, 99) : '';
  return `${randomChoice(FIRST_NAMES).toLowerCase()}${sep}${randomChoice(LAST_NAMES).toLowerCase()}${num}@${randomChoice(DOMAINS)}`;
}

// ─── Mouse & input ────────────────────────────────────────────────────────────

function cubicBezier(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
}

async function moveMouse(mouse, from, to, steps = 10) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if (dist < 5) return;
  const actualSteps = Math.max(Math.ceil(steps / 2), Math.floor(dist / 25));
  const perp  = { x: -dy / (dist || 1), y: dx / (dist || 1) };
  const bulge = randomBetween(-dist * 0.3, dist * 0.3);
  const cp1   = { x: from.x + dx*0.25 + perp.x*bulge, y: from.y + dy*0.25 + perp.y*bulge };
  const cp2   = { x: from.x + dx*0.75 + perp.x*bulge, y: from.y + dy*0.75 + perp.y*bulge };
  for (let s = 1; s <= actualSteps; s++) {
    const t    = s / actualSteps;
    const ease = t * t * (3 - 2 * t);
    await mouse.move(
      cubicBezier(ease, from.x, cp1.x, cp2.x, to.x) + randomBetween(-1, 1),
      cubicBezier(ease, from.y, cp1.y, cp2.y, to.y) + randomBetween(-1, 1),
    );
    if (Math.random() < 0.05) await sleep(randomInt(10, 35));
  }
}

async function humanType(page, locator, text) {
  try {
    await locator.click({ timeout: 2000 });
    await sleep(randomBetween(80, 220));
    for (let i = 0; i < text.length; i++) {
      if (Math.random() < 0.04 && i < text.length - 1) {
        await locator.press(String.fromCharCode(text.charCodeAt(i) + randomInt(-2, 2)));
        await sleep(randomBetween(50, 140));
        await locator.press('Backspace');
        await sleep(randomBetween(40, 90));
      }
      await locator.press(text[i]);
      const base = (i === 0 || i === text.length - 1) ? 110 : 45;
      await sleep(randomBetween(base * 0.5, base * 1.5));
    }
  } catch (_) {}
}

async function smoothScrollTo(page, targetY) {
  await page.evaluate(async (target) => {
    await new Promise(resolve => {
      const start = window.scrollY;
      const dist  = target - start;
      const dur   = 350 + Math.random() * 600;
      let startTime = null;
      function step(ts) {
        if (!startTime) startTime = ts;
        const p    = Math.min((ts - startTime) / dur, 1);
        const ease = p < 0.5 ? 2*p*p : -1 + (4 - 2*p)*p;
        window.scrollTo(0, start + dist * ease);
        p < 1 ? requestAnimationFrame(step) : resolve();
      }
      requestAnimationFrame(step);
    });
  }, targetY);
}

async function textSelect(page) {
  await page.evaluate(() => {
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes  = [];
      let n;
      while ((n = walker.nextNode())) if (n.textContent.trim().length > 20) nodes.push(n);
      if (!nodes.length) return;
      const node  = nodes[Math.floor(Math.random() * nodes.length)];
      const len   = node.textContent.length;
      const start = Math.floor(Math.random() * (len - 5));
      const end   = start + 3 + Math.floor(Math.random() * Math.min(40, len - start));
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, Math.min(end, len));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  });
  await sleep(randomBetween(300, 900));
  if (Math.random() < 0.3) await page.keyboard.press('Control+c');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
}

async function simulateTabSwitch(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden',          { get: () => true,    configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(randomBetween(1500, 5000));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden',          { get: () => false,   configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(randomBetween(200, 500));
}

async function resizeViewport(page, viewport) {
  const widths = [375, 414, 768, 1024, 1280, 1440, 1920];
  const newW   = randomChoice(widths.filter(w => w !== viewport.width));
  await page.setViewportSize({ width: newW, height: viewport.height }).catch(() => {});
  await sleep(randomBetween(400, 1000));
  await page.setViewportSize(viewport).catch(() => {});
}

async function keyboardNavForm(page) {
  const fields = await page.$$('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea');
  if (!fields.length) return;
  const start = randomInt(0, Math.max(0, fields.length - 1));
  const count = randomInt(1, Math.min(3, fields.length));
  try {
    await fields[start].focus();
    await sleep(randomBetween(150, 400));
    for (let t = 0; t < count; t++) {
      await page.keyboard.press('Tab');
      await sleep(randomBetween(200, 600));
    }
    if (Math.random() < 0.3) await page.keyboard.press('Escape');
  } catch (_) {}
}

// ─── Smart form filling ───────────────────────────────────────────────────────

async function fillFormField(page, el) {
  try {
    const tag  = await el.evaluate(e => e.tagName.toLowerCase());
    const type = tag === 'input' ? (await el.getAttribute('type') ?? 'text').toLowerCase() : null;
    const hint = ((await el.getAttribute('name') ?? '') + ' ' + (await el.getAttribute('placeholder') ?? '') + ' ' + (await el.getAttribute('id') ?? '')).toLowerCase();
    const visible = await el.isVisible().catch(() => false);
    if (!visible) return;

    if (tag === 'input') {
      if (!type || ['text', 'search', 'url', 'tel'].includes(type)) {
        const val = /name|first|last/i.test(hint) ? `${randomChoice(FIRST_NAMES)} ${randomChoice(LAST_NAMES)}`
          : /company|org|business/i.test(hint)    ? 'Acme Corp'
          : /phone|mobile/i.test(hint)             ? `${randomInt(200,999)}-${randomInt(100,999)}-${randomInt(1000,9999)}`
          : /city|location/i.test(hint)            ? randomChoice(['New York','London','Berlin','Paris','Tokyo'])
          : randomChoice(SEARCH_TERMS);
        await humanType(page, el, val);
      } else if (type === 'email') {
        await humanType(page, el, fakeEmail());
      } else if (type === 'password') {
        await humanType(page, el, 'P@ss' + randomInt(100, 9999));
      } else if (['checkbox', 'radio'].includes(type)) {
        if (Math.random() < 0.7) await el.check().catch(() => {});
      } else if (type === 'number') {
        await humanType(page, el, String(randomInt(1, 99)));
      } else if (type === 'date') {
        await el.fill(new Date(Date.now() - randomInt(0, 1e10)).toISOString().slice(0, 10)).catch(() => {});
      }
    } else if (tag === 'textarea') {
      if (Math.random() < 0.65) await humanType(page, el, randomChoice(SENTENCES));
    } else if (tag === 'select') {
      const valid = await el.evaluate(s =>
        Array.from(s.options).map(o => o.value).filter(v => v && v !== '' && v !== '0')
      ).catch(() => []);
      if (valid.length) await el.selectOption(randomChoice(valid)).catch(() => {});
    }
    await sleep(randomBetween(200, 600));
  } catch (_) {}
}

async function interactWithForm(page, formElements) {
  if (!formElements.length) return;
  const shuffled = [...formElements].sort(() => 0.5 - Math.random());
  const toFill   = shuffled.slice(0, randomInt(1, Math.min(4, shuffled.length)));
  for (const el of toFill) await fillFormField(page, el);
  // Abandon form mid-way sometimes
  if (Math.random() < 0.3) await page.keyboard.press('Escape').catch(() => {});
}

// ─── Core interaction loop ────────────────────────────────────────────────────

async function randomInteract(page, device, persona, isFirstPage) {
  const viewport = page.viewportSize() || device.viewport || { width: 1280, height: 720 };

  const buttonElements = await page.$$('button:not([disabled]), [role=button], input[type=submit], a.btn, *[class*="btn-"], *[class*="-btn"]').catch(() => []);
  const linkElements   = await page.$$('a[href]:not([href^="mailto"]):not([href^="tel"]):not([href^="#"])').catch(() => []);
  const formElements   = await page.$$('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea').catch(() => []);
  const imageElements  = await page.$$('img[src]').catch(() => []);
  const navElements    = await page.$$('nav a, header a, *[class*="nav"] a, *[class*="menu"] a').catch(() => []);

  // Click targets weighted toward buttons and nav — not forms (those are handled separately)
  const clickTargets = [
    ...Array(5).fill(buttonElements).flat(),
    ...Array(4).fill(navElements).flat(),
    ...Array(2).fill(linkElements).flat(),
  ];

  if (isFirstPage) await sleep(randomBetween(600, 2000));
  if (Math.random() < 0.08) await simulateTabSwitch(page).catch(() => {});

  // ── Scroll phase ──
  let maxScroll = 0;
  try {
    maxScroll = await page.evaluate(() =>
      Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight
    );
  } catch (_) {}

  // Fewer scroll segments: 1–3 depending on persona depth
  const scrollCount = 1 + Math.floor(persona.scrollDepth * (1 + Math.random() * 1.5));
  let lastScrollY   = 0;

  if (maxScroll <= 0) {
    const [readMin, readMax] = persona.readTime;
    await sleep(randomBetween(readMin * 0.4, readMax * 0.55));
  }

  for (let k = 0; k < scrollCount && maxScroll > 0; k++) {
    try {
      const frac    = persona.scrollDepth * (k + 1) / scrollCount * randomBetween(0.75, 1.1);
      const targetY = Math.min(maxScroll, Math.floor(maxScroll * frac));
      await smoothScrollTo(page, targetY);
      lastScrollY = targetY;

      const [readMin, readMax] = persona.readTime;
      await sleep(randomBetween(readMin * 0.4, readMax * 0.55));

      if (Math.random() < 0.2) await textSelect(page).catch(() => {});

      // Re-read: scroll back up slightly
      if (Math.random() < 0.12 && k > 0) {
        await smoothScrollTo(page, Math.max(0, lastScrollY - randomInt(80, 250)));
        await sleep(randomBetween(300, 1000));
      }

      if (Math.random() < persona.idleChance) await sleep(randomBetween(4000, 12000)).catch(() => {});
      if (Math.random() < 0.04) await simulateTabSwitch(page).catch(() => {});
    } catch (_) {}
  }

  // ── Mouse wander ──
  let lastMouse = { x: randomInt(100, viewport.width - 100), y: randomInt(50, Math.min(400, viewport.height - 50)) };

  if (Math.random() < 0.5) {
    const steps = randomInt(1, 3);
    for (let w = 0; w < steps; w++) {
      const target = {
        x: randomInt(50, viewport.width  - 50),
        y: lastScrollY + randomInt(30, viewport.height - 30),
      };
      await moveMouse(page.mouse, lastMouse, target, 10).catch(() => {});
      lastMouse = target;
      await sleep(randomBetween(100, 500));

      // Hover-dwell over interactive elements — only 20% of wander steps
      if (Math.random() < 0.2 && (buttonElements.length || navElements.length)) {
        const pool    = [...buttonElements, ...navElements];
        const hoverEl = randomChoice(pool);
        const hBox    = await hoverEl.boundingBox().catch(() => null);
        if (hBox) {
          const hp = {
            x: Math.floor(hBox.x + hBox.width  * randomBetween(0.2, 0.8)),
            y: Math.floor(hBox.y + hBox.height * randomBetween(0.2, 0.8)),
          };
          await moveMouse(page.mouse, lastMouse, hp, 10).catch(() => {});
          await sleep(randomBetween(350, 1200));
          lastMouse = hp;
        }
      }
    }
  }

  // ── Form interaction ──
  if (formElements.length) {
    const shouldFill = persona.name === 'form_filler' ? Math.random() < 0.7 : Math.random() < 0.2;
    if (shouldFill) await interactWithForm(page, formElements).catch(() => {});
  }
  if (formElements.length && Math.random() < 0.25) await keyboardNavForm(page).catch(() => {});

  // ── Right-click ──
  if (Math.random() < 0.08) {
    const pool = [...buttonElements, ...imageElements];
    if (pool.length) {
      const el  = randomChoice(pool);
      const box = await el.boundingBox().catch(() => null);
      if (box) {
        const t = { x: Math.floor(box.x + box.width * 0.5), y: Math.floor(box.y + box.height * 0.5) };
        await moveMouse(page.mouse, lastMouse, t, 10).catch(() => {});
        await page.mouse.click(t.x, t.y, { button: 'right' }).catch(() => {});
        await sleep(randomBetween(200, 600));
        await page.keyboard.press('Escape').catch(() => {});
        lastMouse = t;
      }
    }
  }

  // ── Viewport resize ──
  if (Math.random() < persona.resizeChance) await resizeViewport(page, viewport).catch(() => {});

  // ── Click sequence — realistic counts ──
  const minClicks  = persona.clickRate < 0.5 ? 1 : 3;
  const maxClicks  = persona.clickRate < 0.5 ? 5 : 9;
  const clickCount = randomInt(minClicks, maxClicks);
  const doRage     = Math.random() < 0.06;
  let   rageDone   = false;

  for (let j = 0; j < clickCount; j++) {
    // Click-rage burst
    if (doRage && !rageDone && j === Math.floor(clickCount / 2)) {
      const el  = clickTargets.length ? randomChoice(clickTargets) : null;
      const box = el ? await el.boundingBox().catch(() => null) : null;
      if (box) {
        const t = { x: Math.floor(box.x + Math.random() * box.width), y: Math.floor(box.y + Math.random() * box.height) };
        await moveMouse(page.mouse, lastMouse, t, 8).catch(() => {});
        for (let r = 0; r < 4; r++) {
          await page.mouse.click(t.x, t.y).catch(() => {});
          await sleep(randomBetween(50, 130));
        }
        lastMouse = t;
        rageDone  = true;
        continue;
      }
    }

    // Dead click ~8%
    if (Math.random() < 0.08) {
      const deadEls = await page.$$('p, h2, h3, li').catch(() => []);
      if (deadEls.length) {
        const el  = randomChoice(deadEls);
        const box = await el.boundingBox().catch(() => null);
        if (box) {
          const t = { x: Math.floor(box.x + Math.random() * box.width), y: Math.floor(box.y + Math.random() * box.height) };
          await moveMouse(page.mouse, lastMouse, t, 8).catch(() => {});
          await page.mouse.click(t.x, t.y).catch(() => {});
          lastMouse = t;
          await sleep(randomBetween(150, 450));
          continue;
        }
      }
    }

    // Normal click on button/nav/link
    if (!clickTargets.length) continue;
    const el  = randomChoice(clickTargets);
    const box = await el.boundingBox().catch(() => null);
    if (!box) continue;

    const t = {
      x: Math.floor(box.x + box.width  * randomBetween(0.15, 0.85)),
      y: Math.floor(box.y + box.height * randomBetween(0.15, 0.85)),
    };

    await moveMouse(page.mouse, lastMouse, t, 10).catch(() => {});
    // Only 20% of clicks get a hover-dwell (was 100%)
    if (Math.random() < 0.2) await sleep(randomBetween(250, 700));
    await page.mouse.click(t.x, t.y).catch(() => {});
    lastMouse = t;
    await sleep(randomBetween(180, 700));
  }

  if (Math.random() < 0.15) await textSelect(page).catch(() => {});

  // Final reading pause — reduced multipliers
  const [readMin, readMax] = persona.readTime;
  await sleep(randomBetween(readMin * 0.3, readMax * 0.45));
}

async function injectSnippet(page) {
  if (!PAGE_SNIPPET) return;
  await page.evaluate(s => { try { eval(s); } catch (_) {} }, PAGE_SNIPPET).catch(() => {});
}

async function visitSite(i) {
  const referrers = [
    'https://google.com/search?q=' + encodeURIComponent(randomChoice(SEARCH_TERMS)),
    'https://google.com/search?q=' + encodeURIComponent(randomChoice(SEARCH_TERMS)),
    'https://google.com/search?q=' + encodeURIComponent(randomChoice(SEARCH_TERMS)),
    'https://bing.com/search?q='   + encodeURIComponent(randomChoice(SEARCH_TERMS)),
    'https://duckduckgo.com/?q='   + encodeURIComponent(randomChoice(SEARCH_TERMS)),
    'https://twitter.com', 'https://facebook.com', 'https://reddit.com',
    'https://linkedin.com', 'https://github.com', 'https://news.ycombinator.com',
    'https://medium.com', 'https://youtube.com', 'https://instagram.com', 'https://tiktok.com',
    TARGET_URL + '/previous-page',
    '', '', '', // direct traffic
  ];

  const randomReferrer                                  = randomChoice(referrers);
  const { device, browser: browserType, uaPool }       = randomDeviceConfig();
  const deviceName                                      = Object.keys(devices).find(k => devices[k] === device) ?? 'unknown';
  const persona                                         = randomPersona();
  // Override UA for Chromium configs — use a real stable-release string so the
  // chrome-headless-shell build version doesn't leak through.
  const userAgent = uaPool ? randomChoice(uaPool) : undefined;
  const selectedProxy = PROXY_SERVERS.length
    ? (PROXY_MODE === 'random' ? randomChoice(PROXY_SERVERS) : PROXY_SERVERS[i % PROXY_SERVERS.length])
    : null;
  const sessionProfile = acquireSessionProfile();

  let validStorageState;
  if (sessionProfile?.isReturning) {
    try {
      JSON.parse(fs.readFileSync(sessionProfile.filePath, 'utf8'));
      validStorageState = sessionProfile.filePath;
    } catch {
      sessionProfile.isReturning = false;
    }
  }

  let context;
  try {
    const browser = await getBrowser(browserType);
    // Firefox doesn't support isMobile / hasTouch — strip them for FF contexts
    const { isMobile: _im, hasTouch: _ht, ...ffSafeDevice } = device;
    const deviceOptions = browserType === firefox ? ffSafeDevice : device;
    context = await browser.newContext({
      ...deviceOptions,
      ...(userAgent ? { userAgent } : {}),
      ...(selectedProxy ? { proxy: selectedProxy } : {}),
      ...(validStorageState ? { storageState: validStorageState } : {}),
      ignoreHTTPSErrors: true,
    });
  } catch (err) {
    if (sessionProfile) activeProfileSlots.delete(sessionProfile.slot);
    console.error(`[${i+1}] Failed to create context:`, err.message);
    return;
  }

  const page = await context.newPage();
  let pageErrors = 0;
  page.on('pageerror', () => { pageErrors++; });
  page.on('console', msg => { if (msg.type() === 'error') pageErrors++; });

  // Stealth plugin (chromium only) handles all fingerprint patches.
  // We only need to spoof document.referrer, which stealth doesn't touch.
  await page.addInitScript(ref => {
    if (ref) Object.defineProperty(document, 'referrer', { get: () => ref });
  }, randomReferrer);

  const killTimer = setTimeout(() => context.close().catch(() => {}), SESSION_TIMEOUT_MS);

  try {
    const otherPages = EXTRA_PAGES.filter(p => p !== FIRST_PAGE);
    const entryPath  = (Math.random() < FIRST_PAGE_PRIORITY || !otherPages.length) ? FIRST_PAGE : randomChoice(otherPages);
    const shuffled   = EXTRA_PAGES.filter(p => p !== entryPath).sort(() => 0.5 - Math.random());

    const navStart    = Date.now();
    const firstResp   = await page.goto(TARGET_URL + entryPath, { waitUntil: 'load', timeout: 25000 });
    const firstLoadMs = Date.now() - navStart;
    const firstStatus = firstResp ? firstResp.status() : 'n/a';
    let pagesVisited  = 1;

    await injectSnippet(page);
    let t0 = Date.now();
    await randomInteract(page, device, persona, true);
    const firstRem = PAGE_MIN_MS - (Date.now() - t0);
    if (firstRem > 0) await sleep(firstRem);

    const numExtra = randomInt(persona.pageCount[0] - 1, persona.pageCount[1] - 1);

    for (let idx = 0; idx < Math.min(numExtra, shuffled.length); idx++) {
      let path = shuffled[idx];

      // U-turn: visit and immediately go back
      if (Math.random() < persona.uTurnChance) {
        await sleep(randomBetween(300, 700));
        const r = await page.goto(TARGET_URL + path, { waitUntil: 'load', timeout: 20000 }).catch(() => null);
        if (r) pagesVisited++;
        await injectSnippet(page);
        await sleep(randomBetween(PAGE_MIN_MS, PAGE_MIN_MS + 1500));
        await page.goBack({ timeout: 10000 }).catch(() => {});
        await sleep(randomBetween(200, 500));
        continue;
      }

      if (Math.random() < 0.2) {
        const src = randomChoice(['google','bing','facebook','twitter','linkedin','newsletter','direct']);
        const med = randomChoice(['email','social','cpc','organic','referral','display']);
        const cmp = randomChoice(['spring_sale','launch','promo','testing','demo',`visit${i+1}`]);
        const cnt = randomChoice(['header_link','footer_banner','main_cta','button_click',`content${randomInt(1,9999)}`]);
        path += (path.includes('?') ? '&' : '?') + `utm_source=${src}&utm_medium=${med}&utm_campaign=${cmp}&utm_content=${cnt}`;
      }

      await sleep(randomBetween(400, 1500));
      const resp = await page.goto(TARGET_URL + path, { waitUntil: 'load', timeout: 25000 }).catch(() => null);
      if (!resp) continue;
      pagesVisited++;
      await injectSnippet(page);
      t0 = Date.now();
      await randomInteract(page, device, persona, false);
      const pageRem = PAGE_MIN_MS - (Date.now() - t0);
      if (pageRem > 0) await sleep(pageRem);
    }

    const sessionTag = sessionProfile
      ? `, session: ${sessionProfile.isReturning ? 'returning' : 'new'}(#${sessionProfile.slot})`
      : '';
    const proxyTag = selectedProxy ? `, proxy: ${selectedProxy.server}` : '';
    console.log(`[${i+1}] Done — persona: ${persona.name}, device: ${deviceName}, status: ${firstStatus}, load: ${firstLoadMs}ms, pages: ${pagesVisited}, errors: ${pageErrors}${sessionTag}${proxyTag}`);
  } catch (err) {
    if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
      console.log(`[${i+1}] Timed out, ending session`);
    } else {
      console.error(`[${i+1}] Failed:`, err.message);
    }
  } finally {
    clearTimeout(killTimer);
    // Give scripts ~2s to flush its final beacon before the context dies
    await sleep(2000).catch(() => {});
    if (sessionProfile) {
      await context.storageState({ path: sessionProfile.filePath }).catch(() => {});
      activeProfileSlots.delete(sessionProfile.slot);
    }
    await context.close().catch(() => {});
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runAllVisits() {
  console.log(`Starting ${VISIT_COUNT} visits at concurrency ${CONCURRENCY}`);
  const running = [];
  for (let i = 0; i < VISIT_COUNT; i++) {
    const p = visitSite(i).finally(() => {
      const idx = running.indexOf(p);
      if (idx !== -1) running.splice(idx, 1);
    });
    running.push(p);
    if (running.length >= CONCURRENCY) await Promise.race(running);
  }
  await Promise.all(running);
  await closeAllBrowsers();
  console.log('All visits complete.');
}

runAllVisits().catch(err => console.error('Fatal error:', err));
