const { AD_SAFE_EXCLUSION_SELECTOR, dismissBlockingOverlays } = require('./adSafetyHelper');
const { attachRrwebLiveStream } = require('./rrwebLiveBridge');

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

const DEFAULT_PERSONAS = [
  { name: 'quick_scanner',  scrollDepth: 0.3, clickRate: 0.5, readTime: [500,  1800], pageCount: [1,2], idleChance: 0.04, resizeChance: 0.0,  uTurnChance: 0.2  },
  { name: 'engaged_reader', scrollDepth: 0.9, clickRate: 0.7, readTime: [2000, 5000], pageCount: [2,4], idleChance: 0.15, resizeChance: 0.1,  uTurnChance: 0.05 },
  { name: 'form_filler',    scrollDepth: 0.6, clickRate: 0.9, readTime: [1000, 3000], pageCount: [2,3], idleChance: 0.10, resizeChance: 0.05, uTurnChance: 0.05 },
  { name: 'window_shopper', scrollDepth: 0.5, clickRate: 0.6, readTime: [800,  2500], pageCount: [2,5], idleChance: 0.08, resizeChance: 0.15, uTurnChance: 0.3  },
  { name: 'power_user',     scrollDepth: 1.0, clickRate: 0.9, readTime: [1500, 4000], pageCount: [3,6], idleChance: 0.12, resizeChance: 0.2,  uTurnChance: 0.1  },
];

const randomBetween = (min, max) => min + Math.random() * (max - min);
const randomInt     = (min, max) => Math.floor(randomBetween(min, max + 1));
const randomChoice  = arr => arr[Math.floor(Math.random() * arr.length)];
const sleep         = ms => new Promise(r => setTimeout(r, Math.max(0, Math.round(Number(ms) || 0))));

/**
 * Samples realistic human reaction / reading dwell time using a Log-Normal distribution.
 */
function sampleLogNormalDelay(medianMs = 1800, sigma = 0.55, minMs = 350, maxMs = 15000) {
  const u1 = Math.max(Number.EPSILON, Math.random());
  const u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  const sample = Math.exp(Math.log(Math.max(10, medianMs)) + sigma * z);
  return Math.round(Math.min(maxMs, Math.max(minMs, sample)));
}

/**
 * Picks a natural ergonomic click coordinate inside an element's bounding box
 * (Gaussian-clustered within central 60% instead of robotic exact 0.5,0.5 center).
 */
function getErgonomicTargetPoint(box) {
  if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)) return null;
  const gaussianOffset = () => ((Math.random() + Math.random() + Math.random()) / 3) - 0.5;
  return {
    x: Math.round(box.x + box.width * 0.5 + gaussianOffset() * (box.width * 0.6)),
    y: Math.round(box.y + box.height * 0.5 + gaussianOffset() * (box.height * 0.6)),
  };
}

function normalizePersonas(list) {
  if (!Array.isArray(list) || !list.length) return DEFAULT_PERSONAS;
  return list.map(p => ({
    name:         p.name         ?? 'custom',
    scrollDepth:  p.scrollDepth  ?? 0.5,
    clickRate:    p.clickRate    ?? 0.5,
    readTime:     p.readTime     ?? [1000, 3000],
    pageCount:    p.pageCount    ?? [1, 3],
    idleChance:   p.idleChance   ?? 0.08,
    resizeChance: p.resizeChance ?? 0.1,
    uTurnChance:  p.uTurnChance  ?? 0.1,
  }));
}

function normalizePages(pages) {
  const arr = Array.isArray(pages)
    ? [...new Set(pages.map(x => {
        if (typeof x !== 'string') return '';
        const t = x.trim();
        if (!t) return '';
        return t.startsWith('/') ? t : '/' + t;
      }).filter(Boolean))]
    : [];
  return arr.length ? arr : ['/'];
}

function parseSnippet(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const match = raw.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
  return (match ? match[1] : raw).trim() || null;
}

const GOOGLE_DOMAIN_BY_COUNTRY = {
  GB: 'https://www.google.co.uk/',
  UK: 'https://www.google.co.uk/',
  ES: 'https://www.google.es/',
  PL: 'https://www.google.pl/',
  DE: 'https://www.google.de/',
  FR: 'https://www.google.fr/',
  IT: 'https://www.google.it/',
  NL: 'https://www.google.nl/',
  CA: 'https://www.google.ca/',
  AU: 'https://www.google.com.au/',
  IL: 'https://www.google.co.il/',
  BR: 'https://www.google.com.br/',
  IN: 'https://www.google.co.in/',
  JP: 'https://www.google.co.jp/',
};

function buildGoogleSearchReferrer(geo = null) {
  const cc = String(geo?.countryCode || '').trim().toUpperCase();
  return GOOGLE_DOMAIN_BY_COUNTRY[cc] || 'https://www.google.com/';
}

function buildRandomReferrer(targetUrl) {
  const referrers = [
    'https://www.google.com/',
    'https://www.google.com/',
    'https://www.google.com/',
    'https://www.bing.com/',
    'https://duckduckgo.com/',
    'https://t.co/',
    'https://www.facebook.com/',
    'https://www.reddit.com/',
    'https://www.linkedin.com/',
    'https://news.ycombinator.com/',
    'https://www.youtube.com/',
    '', '', '', '',
  ];
  return randomChoice(referrers);
}

function fakeEmail() {
  const sep = randomChoice(['', '.', '_']);
  const num = Math.random() < 0.3 ? randomInt(1, 99) : '';
  return `${randomChoice(FIRST_NAMES).toLowerCase()}${sep}${randomChoice(LAST_NAMES).toLowerCase()}${num}@${randomChoice(DOMAINS)}`;
}

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
      cubicBezier(ease, from.x, cp1.x, cp2.x, to.x) + randomBetween(-1.5, 1.5),
      cubicBezier(ease, from.y, cp1.y, cp2.y, to.y) + randomBetween(-1.5, 1.5),
    );
    if (s > 1 && s < actualSteps && Math.random() < 0.45) {
      await sleep(randomInt(4, 15));
    }
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
      const base = (i === 0 || i === text.length - 1) ? 110 : 52;
      await sleep(sampleLogNormalDelay(base, 0.45, 22, 260));
    }
  } catch (_) {}
}

async function smoothScrollTo(page, targetY) {
  const startY = await page.evaluate(() => window.scrollY || 0).catch(() => 0);
  const delta = targetY - startY;
  if (Math.abs(delta) >= 60 && Math.abs(delta) <= 1800 && page.mouse?.wheel) {
    const chunks = randomInt(3, 6);
    const stepDelta = delta / chunks;
    for (let k = 0; k < chunks; k++) {
      const jittered = Math.round(stepDelta * randomBetween(0.78, 1.22));
      await page.mouse.wheel(0, jittered).catch(() => {});
      const nearLandmark = k === 1 && await page.evaluate(() => {
        const els = document.querySelectorAll('h2, h3, table, .tool-card');
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.top >= 40 && r.top <= window.innerHeight * 0.65) return true;
        }
        return false;
      }).catch(() => false);
      await sleep(sampleLogNormalDelay(nearLandmark ? 160 : 65, 0.4, 28, nearLandmark ? 380 : 180));
    }
    return;
  }
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
  const dragBox = await page.evaluate(() => {
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const text = n.textContent || '';
        const parentTag = n.parentElement?.tagName;
        if (text.trim().length < 24 || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'].includes(parentTag)) continue;
        const range = document.createRange();
        range.setStart(n, 0);
        range.setEnd(n, Math.min(text.length, 32));
        const r = range.getBoundingClientRect();
        if (r.width >= 30 && r.height >= 10 && r.top >= 45 && r.bottom <= window.innerHeight - 45) {
          return {
            startX: Math.round(r.left + 4),
            startY: Math.round(r.top + r.height * 0.5),
            endX: Math.round(r.left + Math.min(r.width * 0.75, 160)),
            endY: Math.round(r.top + r.height * 0.5),
          };
        }
      }
    } catch (_) {}
    return null;
  }).catch(() => null);

  if (dragBox) {
    try {
      await moveMouse(page.mouse, { x: dragBox.startX - 40, y: dragBox.startY - 25 }, { x: dragBox.startX, y: dragBox.startY }, 6);
      await page.mouse.down();
      await moveMouse(page.mouse, { x: dragBox.startX, y: dragBox.startY }, { x: dragBox.endX, y: dragBox.endY }, 8);
      await page.mouse.up();
      await page.evaluate(() => {
        try {
          document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
          if (Math.random() < 0.45 && document.activeElement) {
            document.activeElement.dispatchEvent(new Event('copy', { bubbles: true }));
          }
        } catch (_) {}
      }).catch(() => {});
      await sleep(randomBetween(380, 920));
      await page.mouse.click(Math.max(10, dragBox.startX - 18), dragBox.startY).catch(() => {});
      return;
    } catch (_) {}
  }

  await page.evaluate(() => window.getSelection()?.removeAllRanges()).catch(() => {});
}

/**
 * Biometric reading-line cursor tracking: sweeps the mouse horizontally along visible
 * headings and paragraph lines with micro-tremor and pauses, matching human heatmap signatures.
 */
async function performBiometricReadingPass(page, startMouse = { x: 200, y: 200 }) {
  const lineBoxes = await page.evaluate(() => {
    try {
      const nodes = Array.from(document.querySelectorAll('h1, h2, h3, p, li, pre, code'));
      const out = [];
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        if (r.width >= 120 && r.height >= 14 && r.top >= 40 && r.bottom <= window.innerHeight - 30) {
          out.push({
            tag: el.tagName.toLowerCase(),
            x: Math.round(r.left),
            y: Math.round(r.top),
            w: Math.round(Math.min(r.width, 620)),
            h: Math.round(r.height),
          });
          if (out.length >= 4) break;
        }
      }
      return out;
    } catch (_) {
      return [];
    }
  }).catch(() => []);

  let cur = startMouse;
  for (const b of lineBoxes.slice(0, 2)) {
    const lineY = Math.round(b.y + Math.min(22, b.h * 0.45));
    const pStart = { x: Math.max(20, b.x + 12), y: lineY };
    const pMid = { x: Math.max(40, Math.round(b.x + b.w * randomBetween(0.42, 0.58))), y: lineY + randomInt(-3, 3) };
    const pEnd = { x: Math.max(60, Math.round(b.x + b.w * randomBetween(0.75, 0.92))), y: lineY + randomInt(-2, 2) };
    await moveMouse(page.mouse, cur, pStart, 6).catch(() => {});
    await sleep(randomBetween(90, 210));
    await moveMouse(page.mouse, pStart, pMid, 7).catch(() => {});
    if (/^h[1-3]$/.test(b.tag)) {
      await sleep(randomBetween(180, 420));
    }
    await moveMouse(page.mouse, pMid, pEnd, 7).catch(() => {});
    cur = pEnd;
  }
  return cur;
}

async function simulateTabSwitch(page) {
  const vp = page.viewportSize() || { width: 1280, height: 720 };
  await moveMouse(page.mouse, { x: Math.round(vp.width * 0.5), y: Math.round(vp.height * 0.4) }, { x: 12, y: 80 }, 6).catch(() => {});
  await sleep(randomBetween(1100, 2900));
}

async function resizeViewport(page, viewport) {
  const widths = [375, 414, 768, 1024, 1280, 1440, 1920];
  const newW   = randomChoice(widths.filter(w => w !== viewport.width));
  await page.setViewportSize({ width: newW, height: viewport.height }).catch(() => {});
  await sleep(randomBetween(400, 1000));
  await page.setViewportSize(viewport).catch(() => {});
}

async function keyboardNavForm(page) {
  const fields = await page.$$('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea').catch(() => []);
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
  if (Math.random() < 0.3) await page.keyboard.press('Escape').catch(() => {});
}

async function querySafeElements(page, selector, excludeAds = true, sameOriginOnly = false) {
  const handles = await page.$$(selector).catch(() => []);
  if ((!excludeAds && !sameOriginOnly) || !handles.length) return handles;
  let currentOrigin = '';
  if (sameOriginOnly) {
    try {
      currentOrigin = new URL(page.url()).origin;
    } catch {}
  }
  const safe = [];
  for (const el of handles) {
    const allowed = await el.evaluate(
      (node, { badSel, checkAds, origin }) => {
        if (checkAds && node.closest(badSel)) return false;
        if (origin && node.tagName === 'A') {
          const href = node.getAttribute('href') || '';
          if (!href) return false;
          try {
            return new URL(href, window.location.href).origin === origin;
          } catch {
            return false;
          }
        }
        return true;
      },
      { badSel: AD_SAFE_EXCLUSION_SELECTOR, checkAds: excludeAds, origin: currentOrigin }
    ).catch(() => false);
    if (allowed) safe.push(el);
  }
  return safe;
}

async function randomInteract(page, fallbackViewport, persona, isFirstPage, adSafety = {}, onStep = null) {
  const viewport = page.viewportSize() || fallbackViewport || { width: 1280, height: 720 };
  const avoidAdClicks = adSafety?.avoidAdClicks !== false;
  if (adSafety?.dismissOverlays !== false) {
    await dismissBlockingOverlays(page, onStep).catch(() => {});
  }

  const buttonElements = await querySafeElements(page, 'button:not([disabled]), [role=button], input[type=submit], a.btn, *[class*="btn-"], *[class*="-btn"]', avoidAdClicks, true);
  const linkElements   = await querySafeElements(page, 'a[href]:not([href^="mailto"]):not([href^="tel"]):not([href^="#"])', avoidAdClicks, true);
  const formElements   = await querySafeElements(page, 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea', avoidAdClicks);
  const imageElements  = await querySafeElements(page, 'img[src]', avoidAdClicks);
  const navElements    = await querySafeElements(page, 'nav a, header a, *[class*="nav"] a, *[class*="menu"] a', avoidAdClicks, true);

  const clickTargets = [
    ...Array(5).fill(buttonElements).flat(),
    ...Array(4).fill(navElements).flat(),
    ...Array(2).fill(linkElements).flat(),
  ];

  if (isFirstPage) await sleep(randomBetween(600, 2000));
  if (Math.random() < 0.08) await simulateTabSwitch(page).catch(() => {});

  let maxScroll = 0;
  try {
    maxScroll = await page.evaluate(() =>
      Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight
    );
  } catch (_) {}

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

      if (Math.random() < 0.12 && k > 0) {
        await smoothScrollTo(page, Math.max(0, lastScrollY - randomInt(80, 250)));
        await sleep(randomBetween(300, 1000));
      }

      if (Math.random() < persona.idleChance) await sleep(randomBetween(4000, 12000)).catch(() => {});
      if (Math.random() < 0.04) await simulateTabSwitch(page).catch(() => {});
    } catch (_) {}
  }

  let lastMouse = {
    x: randomInt(40, Math.max(60, viewport.width - 60)),
    y: randomInt(40, Math.max(60, Math.min(400, viewport.height - 50))),
  };

  if (Math.random() < 0.5) {
    const steps = randomInt(1, 3);
    for (let w = 0; w < steps; w++) {
      const target = {
        x: randomInt(30, Math.max(50, viewport.width - 40)),
        y: lastScrollY + randomInt(30, Math.max(50, viewport.height - 30)),
      };
      await moveMouse(page.mouse, lastMouse, target, 10).catch(() => {});
      lastMouse = target;
      await sleep(randomBetween(100, 500));

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

  if (formElements.length) {
    const shouldFill = persona.name === 'form_filler' ? Math.random() < 0.7 : Math.random() < 0.2;
    if (shouldFill) await interactWithForm(page, formElements).catch(() => {});
  }
  if (formElements.length && Math.random() < 0.25) await keyboardNavForm(page).catch(() => {});

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

  if (Math.random() < persona.resizeChance) await resizeViewport(page, viewport).catch(() => {});

  const minClicks  = persona.clickRate < 0.5 ? 1 : 3;
  const maxClicks  = persona.clickRate < 0.5 ? 5 : 9;
  const clickCount = randomInt(minClicks, maxClicks);
  const doRage     = Math.random() < 0.06;
  let   rageDone   = false;

  for (let j = 0; j < clickCount; j++) {
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

    if (Math.random() < 0.08) {
      const deadEls = await querySafeElements(page, 'p, h2, h3, li', avoidAdClicks);
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

    if (!clickTargets.length) continue;
    const el  = randomChoice(clickTargets);
    const box = await el.boundingBox().catch(() => null);
    if (!box) continue;

    const t = {
      x: Math.floor(box.x + box.width  * randomBetween(0.15, 0.85)),
      y: Math.floor(box.y + box.height * randomBetween(0.15, 0.85)),
    };

    await moveMouse(page.mouse, lastMouse, t, 10).catch(() => {});
    if (Math.random() < 0.2) await sleep(randomBetween(250, 700));
    await page.mouse.click(t.x, t.y).catch(() => {});
    lastMouse = t;
    await sleep(randomBetween(180, 700));
  }

  if (Math.random() < 0.15) await textSelect(page).catch(() => {});

  const [readMin, readMax] = persona.readTime;
  await sleep(randomBetween(readMin * 0.3, readMax * 0.45));
}

/**
 * Simulates human-like in-page reading, smooth scrolling, Bezier mouse moves,
 * safe element hovers, and text selection inside a deterministic task step.
 */
async function humanBrowsePage(page, totalMs = 7000, adSafety = {}, onStep = null) {
  const budgetMs = Math.max(2000, Math.min(45000, Number(totalMs) || 7000));
  const started = Date.now();
  const avoidAdClicks = adSafety?.avoidAdClicks !== false;
  const viewport = page.viewportSize() || { width: 1280, height: 720 };

  if (adSafety?.dismissOverlays) {
    await dismissBlockingOverlays(page, onStep).catch(() => 0);
  }

  const maxY = await page.evaluate(() =>
    Math.max(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight)
  ).catch(() => 0);

  const hoverCandidates = await querySafeElements(
    page,
    'h1, h2, nav a, header a, button:not([disabled]), a.btn, article a[href]',
    avoidAdClicks
  );

  let lastMouse = {
    x: randomInt(60, Math.max(100, viewport.width - 80)),
    y: randomInt(60, Math.max(100, Math.min(360, viewport.height - 60))),
  };

  const scrollStops = [0.25, 0.55, 0.42, 0.82];
  const pauseSlice = Math.max(350, Math.floor((budgetMs - 900) / scrollStops.length));

  for (let i = 0; i < scrollStops.length; i++) {
    if (Date.now() - started >= budgetMs) break;

    if (maxY > 0) {
      const targetY = Math.floor(maxY * scrollStops[i] * randomBetween(0.88, 1.05));
      await smoothScrollTo(page, Math.min(maxY, Math.max(0, targetY))).catch(() => {});
    }

    const wanderTarget = {
      x: randomInt(40, Math.max(80, viewport.width - 60)),
      y: randomInt(50, Math.max(90, viewport.height - 60)),
    };
    await moveMouse(page.mouse, lastMouse, wanderTarget, 9).catch(() => {});
    lastMouse = wanderTarget;

    if (hoverCandidates.length && Math.random() < 0.75) {
      const candidate = randomChoice(hoverCandidates);
      const box = await candidate.boundingBox().catch(() => null);
      if (box && box.width > 4 && box.height > 4 && box.y >= 0 && box.y < viewport.height) {
        const hp = {
          x: Math.floor(box.x + box.width * randomBetween(0.25, 0.75)),
          y: Math.floor(box.y + box.height * randomBetween(0.25, 0.75)),
        };
        await moveMouse(page.mouse, lastMouse, hp, 9).catch(() => {});
        lastMouse = hp;
      }
    }

    if (i === 1 && Math.random() < 0.55) {
      lastMouse = await performBiometricReadingPass(page, lastMouse).catch(() => lastMouse);
      await textSelect(page).catch(() => {});
    } else if (i === 2 && Math.random() < 0.65) {
      lastMouse = await performBiometricReadingPass(page, lastMouse).catch(() => lastMouse);
    }

    const rem = budgetMs - (Date.now() - started);
    if (rem > 120) {
      await sleep(Math.min(pauseSlice, rem));
    }
  }

  return Math.round((Date.now() - started) / 100) / 10;
}

async function injectSnippet(page, parsedSnippet) {
  if (!parsedSnippet) return;
  await page.evaluate(s => { try { eval(s); } catch (_) {} }, parsedSnippet).catch(() => {});
}

async function captureFrameSafe(page, meta, onFrame) {
  if (typeof onFrame !== 'function') return;
  try {
    if (!meta?.forceScreenshot) {
      const rrwebOk = await attachRrwebLiveStream(page, meta, onFrame).catch(() => false);
      if (rrwebOk) {
        onFrame({
          type: 'live_meta',
          url: page.url(),
          ts: new Date().toISOString(),
          ...meta,
        });
        return;
      }
    }
    const mask = page.frames().map(frame => frame.locator('input, textarea, select, [contenteditable]'));
    const buf = await page.screenshot({ type: 'jpeg', quality: 55, timeout: 4000, mask });
    const title = await page.title().catch(() => '');
    onFrame({
      imageDataUrl: 'data:image/jpeg;base64,' + buf.toString('base64'),
      url: page.url(),
      title,
      ts: new Date().toISOString(),
      ...meta,
    });
  } catch (_) {}
}

function attachPageTelemetry(page) {
  let pageErrors = 0;
  const errorDetails = [];
  const pushErr = msg => {
    pageErrors++;
    if (errorDetails.length < 25 && !errorDetails.includes(msg)) {
      errorDetails.push(msg);
    }
  };
  const onPageErr = err => pushErr(`pageerror: ${String(err?.message || err).slice(0, 140)}`);
  const onConsole = msg => {
    if (msg.type() === 'error') {
      const txt = String(msg.text() || '');
      if (/\b407\b|Proxy Authentication Required|net::ERR_FAILED|net::ERR_ABORTED|net::ERR_BLOCKED_BY_CLIENT|Content[- ]Security[- ]Policy|downloadable font: rejected by sanitizer/i.test(txt)) return;
      pushErr(`console.error: ${txt.slice(0, 140)}`);
    }
  };
  const onResponse = resp => {
    try {
      const st = resp.status();
      if (st >= 400 && st !== 407) {
        const u = new URL(resp.url());
        pushErr(`HTTP ${st}: ${u.pathname}${u.search}`.slice(0, 140));
      }
    } catch (_) {}
  };
  page.on('pageerror', onPageErr);
  page.on('console', onConsole);
  page.on('response', onResponse);

  return {
    getCount: () => pageErrors,
    getDetails: () => [...errorDetails],
    detach: () => {
      page.off('pageerror', onPageErr);
      page.off('console', onConsole);
      page.off('response', onResponse);
    },
  };
}

function resolveTargetUrl(baseUrl, rawTarget) {
  const target = String(rawTarget || '/').trim() || '/';
  if (/^https?:\/\//i.test(target)) return target;
  try {
    const baseObj = new URL(String(baseUrl || '').trim());
    if (target === '/' || target === '') return baseObj.toString();
    if (target.startsWith('?') || target.startsWith('/?')) {
      const merged = new URL(baseObj.toString());
      const q = target.startsWith('/?') ? target.slice(2) : target.slice(1);
      for (const [k, v] of new URLSearchParams(q)) merged.searchParams.set(k, v);
      return merged.toString();
    }
    const rel = target.startsWith('/') ? target : '/' + target;
    if (rel === baseObj.pathname) return baseObj.toString();
    return new URL(rel, baseObj.origin).toString();
  } catch {
    const cleanBase = String(baseUrl || '').replace(/\/+$/, '');
    const rel = target.startsWith('/') ? target : '/' + target;
    return cleanBase + rel;
  }
}

async function runVisitInteractions({
  page,
  targetUrl,
  pages,
  firstPagePriority,
  pageMinMs,
  persona,
  snippet,
  visitIndex,
  alreadyNavigated = false,
  initialStatus = 'n/a',
  initialLoadMs = 0,
  initialReferer = '',
  adSafety = {},
  onFrame = null,
  onStep = null,
}) {
  const allPages = normalizePages(pages);
  const firstPage = allPages[0];
  const parsedSnippet = parseSnippet(snippet);

  const telemetry = attachPageTelemetry(page);
  const visitedUrls = [];
  const emitStep = msg => { if (typeof onStep === 'function') onStep(msg); };
  const postDomWaitMs = (adSafety?.avoidAdClicks !== false || adSafety?.dismissOverlays !== false) ? 2000 : 300;

  try {
    const otherPages = allPages.filter(p => p !== firstPage);
    const entryPath  = (Math.random() < (firstPagePriority / 100) || !otherPages.length)
      ? firstPage
      : randomChoice(otherPages);
    const shuffled = allPages.filter(p => p !== entryPath).sort(() => 0.5 - Math.random());

    let firstStatus = initialStatus;
    let firstLoadMs = initialLoadMs;
    if (!alreadyNavigated) {
      const navStart = Date.now();
      const gotoOpts = { waitUntil: 'domcontentloaded', timeout: 25000 };
      if (initialReferer) gotoOpts.referer = initialReferer;
      const resp = await page.goto(resolveTargetUrl(targetUrl, entryPath), gotoOpts);
      firstLoadMs = Date.now() - navStart;
      firstStatus = resp ? resp.status() : 'n/a';
    }
    await sleep(postDomWaitMs);
    visitedUrls.push({ path: entryPath, url: page.url(), status: firstStatus, loadMs: firstLoadMs });
    emitStep(`[ביקור ${visitIndex + 1}] נכנס אל ${entryPath} (סטטוס: ${firstStatus}, ${firstLoadMs}ms)`);

    let pagesVisited = 1;
    await injectSnippet(page, parsedSnippet);
    await captureFrameSafe(page, { visitIndex, label: `טעינת ${entryPath} (${firstStatus})`, persona: persona.name }, onFrame);

    let t0 = Date.now();
    await randomInteract(page, page.viewportSize(), persona, true, adSafety, emitStep);
    await captureFrameSafe(page, { visitIndex, label: `גלילה ואינטראקציה ב-${entryPath}`, persona: persona.name }, onFrame);
    const firstRem = pageMinMs - (Date.now() - t0);
    if (firstRem > 0) await sleep(firstRem);

    const numExtra = randomInt(persona.pageCount[0] - 1, persona.pageCount[1] - 1);

    // ~20% of multi-page visitors naturally stay on the landing page to keep reading and navigating within it
    if (numExtra > 0 && Math.random() < 0.2) {
      emitStep(`[ביקור ${visitIndex + 1}] נשאר באותו עמוד (${entryPath}) ומנווט בתוכו (~20% התפלגות)`);
      await humanBrowsePage(page, randomBetween(3500, 6000), adSafety, emitStep);
      await randomInteract(page, page.viewportSize(), persona, false, adSafety, emitStep);
      await captureFrameSafe(page, { visitIndex, label: `ניווט פנימי באותו עמוד (${entryPath})`, persona: persona.name }, onFrame);
    } else {
      for (let idx = 0; idx < Math.min(numExtra, shuffled.length); idx++) {
        let nextPath = shuffled[idx];

        if (Math.random() < persona.uTurnChance) {
          await sleep(randomBetween(300, 700));
          const navT = Date.now();
          const r = await page.goto(resolveTargetUrl(targetUrl, nextPath), { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
          if (r) {
            pagesVisited++;
            await sleep(postDomWaitMs);
            visitedUrls.push({ path: nextPath, url: page.url(), status: r.status(), loadMs: Date.now() - navT });
            emitStep(`[ביקור ${visitIndex + 1}] U-Turn אל ${nextPath} (${r.status()})`);
          }
          await injectSnippet(page, parsedSnippet);
          await captureFrameSafe(page, { visitIndex, label: `U-Turn ב-${nextPath}`, persona: persona.name }, onFrame);
          await sleep(randomBetween(pageMinMs, pageMinMs + 1500));
          await page.goBack({ timeout: 10000 }).catch(() => {});
          await sleep(randomBetween(200, 500));
          continue;
        }

        if (Math.random() < 0.2) {
          const src = randomChoice(['google','bing','facebook','twitter','linkedin','newsletter','direct']);
          const med = randomChoice(['email','social','cpc','organic','referral','display']);
          const cmp = randomChoice(['spring_sale','launch','promo','testing','demo',`visit${visitIndex + 1}`]);
          const cnt = randomChoice(['header_link','footer_banner','main_cta','button_click',`content${randomInt(1,9999)}`]);
          nextPath += (nextPath.includes('?') ? '&' : '?') + `utm_source=${src}&utm_medium=${med}&utm_campaign=${cmp}&utm_content=${cnt}`;
        }

        await sleep(randomBetween(400, 1500));
        const navT = Date.now();
        const resp = await page.goto(resolveTargetUrl(targetUrl, nextPath), { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => null);
        if (!resp) continue;
        pagesVisited++;
        const navMs = Date.now() - navT;
        await sleep(postDomWaitMs);
        visitedUrls.push({ path: nextPath, url: page.url(), status: resp.status(), loadMs: navMs });
        emitStep(`[ביקור ${visitIndex + 1}] ניווט פנימי אל ${nextPath} (סטטוס: ${resp.status()})`);

        await injectSnippet(page, parsedSnippet);
        await captureFrameSafe(page, { visitIndex, label: `עמוד פנימי ${nextPath} (${resp.status()})`, persona: persona.name }, onFrame);
        t0 = Date.now();
        await randomInteract(page, page.viewportSize(), persona, false, adSafety, emitStep);
        await captureFrameSafe(page, { visitIndex, label: `סיום אינטראקציה ב-${nextPath}`, persona: persona.name }, onFrame);
        const pageRem = pageMinMs - (Date.now() - t0);
        if (pageRem > 0) await sleep(pageRem);
      }
    }

    return {
      status: firstStatus,
      loadMs: firstLoadMs,
      pagesVisited,
      pageErrors: telemetry.getCount(),
      errorDetails: telemetry.getDetails(),
      visitedUrls,
    };
  } finally {
    telemetry.detach();
  }
}

module.exports = {
  resolveTargetUrl,
  DEFAULT_PERSONAS,
  normalizePersonas,
  normalizePages,
  parseSnippet,
  buildGoogleSearchReferrer,
  buildRandomReferrer,
  randomInteract,
  injectSnippet,
  captureFrameSafe,
  attachPageTelemetry,
  moveMouse,
  humanType,
  smoothScrollTo,
  humanBrowsePage,
  performBiometricReadingPass,
  runVisitInteractions,
  sampleLogNormalDelay,
  getErgonomicTargetPoint,
  randomBetween,
  randomInt,
  randomChoice,
  sleep,
};
