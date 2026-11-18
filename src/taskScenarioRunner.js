const fs = require('fs');
const path = require('path');
const {
  resolveTargetUrl,
  parseSnippet,
  injectSnippet,
  captureFrameSafe,
  attachPageTelemetry,
  moveMouse,
  humanType,
  smoothScrollTo,
  humanBrowsePage,
  getErgonomicTargetPoint,
  randomBetween,
  sleep,
} = require('./behaviorEngine');
const {
  AD_SAFE_EXCLUSION_SELECTOR,
  registerScenarioPage,
  dismissBlockingOverlays,
  auditAdPlacements,
} = require('./adSafetyHelper');
const { runScanProductsStep } = require('./wavePlanner');
const { runAiExploreStep, runAiSmartRecoveryStep, callAiChat, captureCompactDomForAi, isDecisionModel } = require('./aiCommander');
// clef:27b (and any other decision-only model) rejects /api/chat with MODEL_NEEDS_DECISION_API.
// Scenario steps here need free-form JSON back, so they must stay on a chat model: when the
// configured worker model is decision-only, fall back to the commander model, then the default.
function resolveChatModel(step, ctx, fallback = 'deepseek-v4.1-flash') {
  const wanted = String(step?.workerModel || ctx?.aiConfig?.workerModel || '').trim();
  if (wanted && !isDecisionModel(wanted)) return wanted;
  const alt = String(ctx?.aiConfig?.commanderModel || '').trim();
  if (alt && !isDecisionModel(alt)) return alt;
  return fallback;
}
const { pickSearchEngine, searchEngineProfile, buildQuery, buildSerpUrl, pickReferrer } = require('./referrerEngine');
const { redactText, registerSecret, maskEmail, isSecretField, safeStepLabel, registerStepSecrets } = require('./redaction');
const {
  createEmailInbox,
  getEmailCode,
  listEmailMessages,
  extractConfirmationUrlFromMessages,
  waitForEmailCode,
  getEmailClientStatus,
} = require('./emailInboxClient');

const { RUN_INBOXES_FILE, readRunInboxes } = require('./runInboxStore');

async function ensureVisitInbox(ctx, emit) {
  if (ctx.sessionInbox && ctx.sessionInbox.address && ctx.sessionInbox.inbox_id) {
    return ctx.sessionInbox;
  }
  const inbox = await createEmailInbox({ ttlSeconds: 3600 });
  ctx.sessionInbox = {
    inbox_id: inbox.inbox_id,
    address: inbox.address,
    capability: inbox.capability,
    expires_at: inbox.expires_at,
  };
  try {
    fs.mkdirSync(path.join(__dirname, '..', 'reports'), { recursive: true });
    fs.appendFileSync(
      RUN_INBOXES_FILE,
      JSON.stringify({
        inbox_id: inbox.inbox_id,
        address: inbox.address,
        capability: inbox.capability,
        expires_at: inbox.expires_at,
        createdAt: Date.now(),
      }) + '\n',
      'utf8'
    );
  } catch (persistErr) {
    if (typeof emit === 'function') emit(`[HirePulse Email] Inbox persist skipped: ${String((persistErr && persistErr.message) || persistErr).slice(0, 80)}`);
  }
  if (typeof emit === 'function') {
    emit(`[HirePulse Email] Created live inbox for session: ${maskEmail(inbox.address)}`);
  }
  return ctx.sessionInbox;
}

function safeFrames(page) {
  try { return (page && typeof page.frames === 'function') ? page.frames() : []; } catch { return []; }
}

/**
 * Attribution fix: offer-wall lockers embed partner links inside cross-origin iframes.
 * Main-frame locator can never see them, so we scan every frame of the page.
 * Returns a frame-scoped locator tagged with the source frame URL (loc.__wtgFrameUrl).
 */
async function locateInAnyFrame(page, rawSelector, timeoutMs = 8000) {
  const sel = String(rawSelector || '').trim();
  if (!sel) return null;
  const frames = safeFrames(page).filter(fr => fr && fr !== page.mainFrame() && !fr.isDetached());
  if (!frames.length) return null;
  const direct = async fr => {
    const locator = fr.locator(sel).first();
    if ((await locator.count().catch(() => 0)) > 0) return locator;
    return null;
  };
  // Pass 1: quick check of frames already loaded
  for (const fr of frames) {
    const hit = await direct(fr).catch(() => null);
    if (hit) { hit.__wtgFrameUrl = fr.url(); return hit; }
  }
  // Pass 2: locker iframes load late — poll until the budget runs out
  const deadline = Date.now() + Math.max(1000, timeoutMs);
  while (Date.now() < deadline) {
    await sleep(650);
    for (const fr of safeFrames(page)) {
      if (!fr || fr === page.mainFrame() || fr.isDetached()) continue;
      const hit = await direct(fr).catch(() => null);
      if (hit) { hit.__wtgFrameUrl = fr.url(); return hit; }
    }
  }
  return null;
}

function isLockerOpenClick(step) {
  const s = `${step.selector || ''} ${step.value || ''} ${step.label || ''}`.toLowerCase();
  return /(?:^|[^a-z])(?:lock|unlock|download|cpld_locker?|locker|offer[_-]?wall)(?:[^a-z]|$)/.test(s)
    && !/close|dismiss|skip/i.test(s);
}

function isLockerCloseClick(step) {
  const s = `${step.selector || ''} ${step.label || ''}`.toLowerCase();
  return /lck[_-]?close|close[_-]?(?:btn|button)|locker[_-]?close|modal[_-]?close|dismiss[_-]?(?:modal|overlay)|\b×\b/i.test(s);
}

// Attribution: partner networks rotate their whole offer set between renders (ids/hosts change), so
// recorded selectors can go stale. This finder clicks the closest "offer-like" cross-origin anchor
// currently present, across the main frame and every nested locker iframe.
const OFFER_LINK_RE = /(?:view\.php|click_?id|\/track|\/pixel|\/offer|\/aff|\?pub=|aff_?id|sub_?id|utm_content|(?:^|\/)s\/[A-Za-z0-9]{6,})/i;
const NON_OFFER_HOST_RE = /(?:facebook|instagram|tiktok|twitter|x\.com|youtube|t\.me|telegram|discord|reddit|linkedin|whatsapp|pinterest|snapchat|github|gitlab|wikipedia|mozilla|apple\.com|microsoft|google\.com|mailto|terms|privacy|cookie|gstatic|cloudflare)/i;
async function findOfferLikeAnchor(page, timeoutMs = 3500) {
  const selfHost = (() => { try { return new URL(page.url()).hostname; } catch { return ''; } })();
  const scanFrame = async fr => {
    const cands = await fr.evaluate(self => {
      const out = [];
      try {
        for (const a of document.querySelectorAll('a[href]')) {
          const raw = a.getAttribute('href') || '';
          if (!/^https?:\/\//i.test(raw)) continue;
          let host = '';
          try { host = new URL(raw, location.href).hostname; } catch { continue; }
          if (!host || host === self || NON_OFFER_HOST_RE.test(host)) continue;
          const visible = a.getClientRects().length > 0 && (a.offsetParent !== null || a.closest('iframe, [role="dialog"], .modal') !== null);
          const text = (a.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80);
          out.push({ href: raw.slice(0, 180), host, visible, text });
        }
      } catch {}
      return out;
    }, selfHost).catch(() => []);
    let best = null;
    for (const c of cands) {
      // VPN priority: VPN text scores highest; "Download" gives a small boost
      const txt = String(c.text || '');
      const vpnBonus = /vpn/i.test(txt) ? 30 : 0;
      const dlBonus = /download|הורדה/i.test(txt) ? 8 : 0;
      const score = (OFFER_LINK_RE.test(c.href) ? 10 : 0) + (c.visible ? 4 : 0) + vpnBonus + dlBonus;
      if (!best || score > best.score) best = { ...c, score };
    }
    return best;
  };
  const deadline = Date.now() + Math.max(800, timeoutMs);
  let hitFrame = null;
  let hitBest = null;
  while (Date.now() < deadline && !hitFrame) {
    // Pick global highest-scoring candidate across frames
    let bestOverall = null;
    for (const fr of safeFrames(page)) {
      if (!fr || fr.isDetached()) continue;
      const best = await scanFrame(fr);
      if (best && (!bestOverall || best.score > bestOverall.score)) bestOverall = { ...best, frame: fr };
    }
    if (bestOverall) {
      hitFrame = bestOverall.frame;
      hitBest = bestOverall;
      break;
    }
    await sleep(600);
  }
  if (!hitFrame || !hitBest) return null;
  const escaped = String(hitBest.href).replace(/"/g, '\\"');
  const loc = hitFrame.locator(`a[href="${escaped}"]`).first();
  if ((await loc.count().catch(() => 0)) > 0) {
    loc.__wtgFrameUrl = hitFrame.url();
    return loc;
  }
  return null;
}

/**
 * Attribution dwell gate: after the locker (offer wall) was opened, never let any
 * close/dismiss step run it off-screen before the partner iframe had a fair load window.
 */
async function enforceLockerDwellGate(step, ctx, emit) {
  try {
    if (!isLockerCloseClick(step) || !ctx.__wtgLockerOpenedAt) return;
    const dwellMs = Math.max(2000, Number(ctx.attribution?.lockerDwellMs) || 9500);
    const elapsed = Date.now() - ctx.__wtgLockerOpenedAt;
    if (elapsed < dwellMs) {
      const waitMs = Math.round((dwellMs - elapsed) + 1200 + Math.random() * 2200);
      if (typeof emit === 'function') {
        emit(`[Attribution] Settling locker close for ${Math.round(waitMs / 100) / 10}s to allow beacon completion`);
      }
      await sleep(Math.min(waitMs, 17000));
    }
    ctx.__wtgLockerOpenedAt = null;
  } catch {}
}

async function resolveInteractiveLocator(page, rawSelector, timeoutMs = 20000) {
  const sel = String(rawSelector || '').trim();
  if (!sel) throw new Error('Missing element selector or text.');

  const primary = page.locator(sel).first();
  // Partner offer anchors (full https href selectors) render lazily inside lockers through proxies
  // (measured: offers materialize 9-18s after the lock click) — give them a much longer first wait.
  const isHrefAnchorStep = /a\[href=["']https?:\/\//i.test(sel);
  // Offer landing pages ship a "Loading Offer.." JS shell and build their form only
  // after the offer renders (measured: 9-18s behind a locker or slow proxy).
  const DEFAULT_LOCATE_MS = 20000;
  const primaryWaitMs = Math.min(timeoutMs, isHrefAnchorStep ? 15000 : DEFAULT_LOCATE_MS);
  try {
    await primary.waitFor({ state: 'attached', timeout: primaryWaitMs });
    await primary.waitFor({ state: 'visible', timeout: 1800 }).catch(() => {});
    return primary;
  } catch (firstErr) {
    // If element exists in DOM (e.g. #play-btn.btn-needs-server waiting on slow proxy WebSocket), allow JS click fallback
    const attachedCount = await primary.count().catch(() => 0);
    if (attachedCount > 0) {
      return primary;
    }
    // Fallback 1: if recorded selector is a deep CSS path ending in #some-id (e.g. body > ... > #actor-detail-try-for-free-button), try the ID directly
    const trailingIdMatch = sel.match(/(#[a-zA-Z][a-zA-Z0-9_-]*)\s*$/);
    if (trailingIdMatch && trailingIdMatch[1] !== sel) {
      const byId = page.locator(trailingIdMatch[1]).first();
      const idCount = await byId.count().catch(() => 0);
      if (idCount > 0) return byId;
      try {
        await byId.waitFor({ state: 'attached', timeout: 2500 });
        return byId;
      } catch {}
    }
    // Fallback 2: if recorded selector has '>' segments, try the last meaningful segment
    if (sel.includes('>')) {
      const parts = sel.split('>').map(p => p.trim()).filter(Boolean);
      const tail = parts[parts.length - 1];
      if (tail && tail !== sel && !/^(div|span|a|li|ul|main|section|p):nth-of-type/i.test(tail)) {
        const byTail = page.locator(tail).first();
        if ((await byTail.count().catch(() => 0)) > 0) return byTail;
      }
    }
    // Fallback 2b: if selector has a[href="..."] with locale suffix like /en-US or /us/en, match prefix or path keyword
    const hrefMatch = sel.match(/a\[href=["']([^"']+)["']\]/i);
    if (hrefMatch && hrefMatch[1]) {
      const rawHref = hrefMatch[1];
      const strippedLocale = rawHref.replace(/\/(en-[a-z]{2}|[a-z]{2}-[a-z]{2}|us\/en|gb\/en|ca\/en|au\/en|de\/de)\b.*$/i, '');
      if (strippedLocale && strippedLocale !== rawHref && strippedLocale.length > 8) {
        const byPrefix = page.locator(`a[href*="${strippedLocale.replace(/^https?:\/\/[^/]+/i, '') || strippedLocale}"]`).first();
        if ((await byPrefix.count().catch(() => 0)) > 0) return byPrefix;
      }
      if (/\/signup\b/i.test(rawHref)) {
        const bySignup = page.locator('a[href*="/signup"]').first();
        if ((await bySignup.count().catch(() => 0)) > 0) return bySignup;
      }
      // Attribution fix (2d): partner offer links rotate ids/params between renders — match by host instead,
      // across the main frame AND every nested iframe (locker widgets).
      let partnerHost = '';
      try { partnerHost = new URL(rawHref).hostname; } catch {}
      if (partnerHost && !partnerHost.startsWith('www.modcraftforge')) {
        const hostSel = `a[href*="${partnerHost}"]`;
        const byHost = page.locator(hostSel).first();
        const hostCount = await byHost.count().catch(() => 0);
        if (hostCount > 0) {
          try {
            await byHost.waitFor({ state: 'attached', timeout: 2500 });
          } catch {}
          return byHost;
        }
        try {
          const hostFrameHit = await locateInAnyFrame(page, hostSel, 4500);
          if (hostFrameHit) return hostFrameHit;
        } catch {}
      }
    }
    // Fallback 2c: element may live inside a nested iframe (offer lockers, widgets) — scan all frames.
    try {
      const frameBudget = Math.max(1500, Math.min(7000, timeoutMs - primaryWaitMs));
      const frameHit = await locateInAnyFrame(page, sel, frameBudget);
      if (frameHit) return frameHit;
    } catch {}
    // Fallback 3 (attribution): offer sets rotate entirely between renders — click the closest current
    // cross-origin offer-like anchor (main frame + locker iframes).
    try {
      const genHit = await findOfferLikeAnchor(page, timeoutMs > 12000 ? 6000 : 3500);
      if (genHit) return genHit;
    } catch {}
    // Fallback 3: treat plain label as visible text only if input does not look like a CSS/XPath selector
    const looksLikeSelector = /[#.\[>+=~:]/.test(sel) || sel.startsWith('text=') || sel.startsWith('xpath=');
    if (!looksLikeSelector) {
      const byText = page.getByText(sel, { exact: false }).first();
      await byText.waitFor({ state: 'visible', timeout: Math.min(timeoutMs, DEFAULT_LOCATE_MS) });
      return byText;
    }
    throw firstErr;
  }
}

/** Attribution diagnostics (read-only): what offers/anchors actually existed when a partner step skipped. */
async function dumpLockerAnchors(page, skippedSel) {
  try {
    const dump = [];
    for (const fr of safeFrames(page)) {
      if (!fr || fr.isDetached()) continue;
      const links = await fr.evaluate(() =>
        Array.from(document.querySelectorAll('a[href], iframe[src]'))
          .map(el => (el.getAttribute('href') || el.getAttribute('src') || ''))
          .filter(h => /^https?:\/\//i.test(h))
          .slice(0, 25)
      ).catch(() => []);
      const frUrl = String(fr.url() || '').slice(0, 60);
      for (const h of links) dump.push(`[${frUrl}] ${h.slice(0, 110)}`);
    }
    console.log(`[Container Debug] Not found: ${String(skippedSel).slice(0, 70)} | frames: ${safeFrames(page).length}`);
    console.log(dump.length ? dump.slice(0, 30).map(l => `  ${l}`).join('\n') : '  (no http anchors found in any frame)');
  } catch {}
}

function shouldExpectSameTabNav(beforeUrl, meta) {
  if (!meta?.href || meta.hasDownload || meta.isButtonBehavior) return false;
  if (meta.target === '_blank' || meta.target === '_top') return false;
  if (meta.href.startsWith('#') || /^(javascript|mailto|tel|data|blob):/i.test(meta.href)) return false;
  try {
    const dest = new URL(meta.href, beforeUrl);
    const cur = new URL(beforeUrl);
    return (dest.origin + dest.pathname + dest.search) !== (cur.origin + cur.pathname + cur.search);
  } catch {
    return false;
  }
}

async function performShieldedClick(page, loc, selectorStr, shouldShield, emit, clickOpts = {}) {
  // If target is a wrapper row containing a checkbox + legal links (e.g. Square market-row "I agree to Terms, Privacy Policy"),
  // click the inner checkbox or left edge so we never accidentally click the "Privacy Policy" link in the center!
  const isConsentOrCheckboxRow = await loc.evaluate(el => {
    const tag = (el.tagName || '').toLowerCase();
    const txt = (el.innerText || '').toLowerCase();
    if (tag === 'input' || el.getAttribute('role') === 'checkbox') return false;
    const hasInnerCheckbox = Boolean(el.querySelector('input[type="checkbox"], [role="checkbox"], market-checkbox, [class*="checkbox" i]'));
    const hasInnerLinks = Boolean(el.querySelector('a[href]'));
    return hasInnerCheckbox || (hasInnerLinks && /agree|terms|privacy|consent|policy/.test(txt));
  }).catch(() => false);

  if (isConsentOrCheckboxRow) {
    const checkedViaDom = await loc.evaluate(el => {
      const cb = el.querySelector('input[type="checkbox"], [role="checkbox"], market-checkbox, [class*="checkbox" i]');
      if (cb) {
        if (typeof cb.click === 'function') cb.click();
        if ('checked' in cb && !cb.checked) {
          cb.checked = true;
          cb.dispatchEvent(new Event('input', { bubbles: true }));
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      }
      return false;
    }).catch(() => false);
    if (checkedViaDom) return;
    clickOpts = { ...clickOpts, position: { x: 14, y: 14 } };
  }

  const visibleNow = await loc.isVisible().catch(() => false);
  if (!visibleNow) {
    await loc.evaluate(el => {
      if (el.disabled) {
        el.disabled = false;
        el.removeAttribute('disabled');
      }
      const target = typeof el.click === 'function'
        ? el
        : (el.closest('button, a, [role="button"], label, div, span') || el);
      if (typeof target.click === 'function') {
        target.click();
      } else {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    });
    return;
  }
  const enabledNow = await loc.isEnabled().catch(() => true);
  if (!enabledNow) {
    await sleep(1200);
    const enabledAfterWait = await loc.isEnabled().catch(() => true);
    if (!enabledAfterWait) {
      await loc.evaluate(el => {
        el.disabled = false;
        el.removeAttribute('disabled');
      }).catch(() => {});
    }
  }
  try {
    await loc.click({ timeout: 4500, noWaitAfter: true, ...clickOpts });
  } catch (clickErr) {
    const msg = clickErr?.message || '';
    if (!shouldShield || !/intercepts pointer events|Timeout|not enabled/i.test(msg)) {
      throw clickErr;
    }
    await dismissBlockingOverlays(page, emit, selectorStr).catch(() => 0);
    await loc.evaluate(el => {
      if (el.disabled) {
        el.disabled = false;
        el.removeAttribute('disabled');
      }
    }).catch(() => {});
    try {
      await loc.click({ timeout: 3000, noWaitAfter: true, ...clickOpts });
    } catch (retryErr) {
      const retryMsg = retryErr?.message || '';
      const stillVisible = await loc.isVisible().catch(() => false);
      if (stillVisible && /intercepts pointer events|Timeout|not enabled/i.test(retryMsg)) {
        await dismissBlockingOverlays(page, emit, selectorStr).catch(() => 0);
        await loc.evaluate(el => {
          if (el.disabled) {
            el.disabled = false;
            el.removeAttribute('disabled');
          }
          const target = typeof el.click === 'function'
            ? el
            : (el.closest('button, a, [role="button"], label, div, span') || el);
          if (typeof target.click === 'function') {
            target.click();
          } else {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          }
        });
        emit(`[Overlay Shield] Clicked "${selectorStr}" directly after clearing blocking layer`);
      } else {
        throw retryErr;
      }
    }
  }
}

function withHumanJitter(baseMs, minMs = 150, maxMs = 45000, spread = 0.22) {
  const raw = Number(baseMs);
  if (!Number.isFinite(raw) || raw <= 0) return minMs;
  const jittered = Math.round(raw * randomBetween(1 - spread, 1 + spread));
  return Math.max(minMs, Math.min(maxMs, jittered));
}

async function inspectTabContentAndSettle(tabPage, maxWaitMs = 3500) {
  const probe = async () => tabPage.evaluate(() => ({
    links: document.querySelectorAll('a[href], button, input').length,
    textLen: (document.body?.innerText || '').trim().length,
  })).catch(() => ({ links: 0, textLen: 0 }));

  let stats = await probe();
  const deadline = Date.now() + maxWaitMs;
  while (stats.links === 0 && stats.textLen < 40 && Date.now() < deadline && !tabPage.isClosed()) {
    await sleep(500);
    await tabPage.waitForLoadState('domcontentloaded', { timeout: 2500 }).catch(() => {});
    stats = await probe();
  }
  return stats;
}

async function resolveFallbackExternalClick(page, step) {
  const fallbackHref = String(step.popupFallbackUrl || '').trim();
  if (fallbackHref) {
    try {
      const fbUrl = new URL(fallbackHref);
      const itemMatch = fbUrl.pathname.match(/\/(?:item|product|dp|p)\/([a-z0-9_-]{4,})/i);
      const pathToken = itemMatch ? itemMatch[1] : (fbUrl.pathname.length > 8 ? fbUrl.pathname.slice(0, 40) : '');
      if (pathToken) {
        const byHref = page.locator(`a[href*="${pathToken.replace(/"/g, '')}"]`).first();
        if ((await byHref.count().catch(() => 0)) > 0 && (await byHref.isVisible().catch(() => false))) {
          return byHref;
        }
      }
    } catch {}
  }
  const parenMatch = String(step.label || '').match(/\(([^)]{4,45})\)[^()]*$/);
  const labelHint = parenMatch ? parenMatch[1].replace(/[…."']/g, '').trim() : '';
  if (labelHint && labelHint.length >= 4 && !/^(Open Tool|Sponsored Partner Link)$/i.test(labelHint)) {
    const words = labelHint.split(/\s+/).filter(w => w.length >= 3).slice(0, 3).join(' ');
    if (words) {
      const byTxt = page.getByText(words, { exact: false }).first();
      if ((await byTxt.count().catch(() => 0)) > 0 && (await byTxt.isVisible().catch(() => false))) {
        return byTxt;
      }
    }
  }
  if (Number.isInteger(step.opensTab) && step.opensTab > 0) {
    const pickedHref = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      for (const a of links) {
        const r = a.getBoundingClientRect();
        if (r.width < 30 || r.height < 18) continue;
        const h = a.getAttribute('href') || '';
        if (!h || h.startsWith('#') || /^(javascript:|mailto:|tel:)/i.test(h)) continue;
        if (/\/(?:item|product|products|p\/|dp\/|offer|deal)/i.test(h) || (a.querySelector('img') && (a.innerText || '').trim().length >= 8)) {
          return h;
        }
      }
      return '';
    }).catch(() => '');
    if (pickedHref) {
      const loc = page.locator(`a[href="${pickedHref.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).first();
      if ((await loc.count().catch(() => 0)) > 0) return loc;
    }
  }
  return null;
}

// Link shorteners / interstitials answer 403 to a cold, direct deep-link request. A real visitor
// arrives on the domain first, accepts the consent banner and only then continues — same here.
const SHORTENER_HOST_RE = /(^|\.)(shrinkme\.\w+|shrinke\.\w+|shrinkearn|shrinklink|ouo\.\w+|exe\.io|fc\.lc|cuty\.io|gplinks|za\.gl|mboost|boostellar|linkvertise|adf\.ly|shorte\.st|cutt\.ly|rebrand\.ly|tinyurl\.com|bit\.ly|clk\.sh|shorturl\.at|surl\.li)$/i;

const CONSENT_SELECTORS = [
  '#onetrust-accept-btn-handler',
  'button:has-text("Accept all")',
  'button:has-text("Accept")',
  'button:has-text("I agree")',
  'button:has-text("Agree")',
  '.fc-consent-root button.fc-button-label',
  'button[aria-label="Accept all"]',
  '#cookie-accept',
];

/**
 * Opens the shortener's own domain first (with the search-engine referrer), accepts the consent
 * banner and lets the clearance cookies settle. Returns a note appended to the goto result, or ''.
 */
async function warmUpShortener(page, dest, ctx) {
  if (ctx.__wtgShortenerWarmed) return '';
  let host = '';
  try { host = new URL(dest).hostname.toLowerCase(); } catch { return ''; }
  if (!SHORTENER_HOST_RE.test(host)) return '';
  ctx.__wtgShortenerWarmed = true;
  const root = `https://${host}/`;
  const ref = ctx.serpUrl || '';
  try {
    await page.goto(root, ref
      ? { referer: ref, waitUntil: 'domcontentloaded', timeout: 15000 }
      : { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch {
    return '';
  }
  ctx.pagesVisited++;
  ctx.shortenerRoot = root;
  await sleep(600 + Math.round(Math.random() * 900));
  for (const sel of CONSENT_SELECTORS) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
      await loc.click({ timeout: 2500 }).catch(() => {});
      await sleep(450);
      break;
    }
  }
  // Small dwell so the WAF sees a real session, not an instant bounce.
  await sleep(900 + Math.round(Math.random() * 1600));
  return ` + domain warm-up ${host} (cookie consent)`;
}

const STEP_HANDLERS = {
  /**
   * Organic search warm-up. Walks a real search engine, types the query like a person, submits,
   * and remembers the results URL. The next navigation then leaves that SERP as its referrer,
   * so the visit is classified as organic search instead of a direct hit.
   */
  async search_entry(page, step, ctx) {
    const geo = ctx.geo || null;
    const engine = pickSearchEngine(step.engine || '', ctx.avoidEngines || []);
    const profile = searchEngineProfile(engine.id, geo?.countryCode || geo?.cc || 'US');
    const query = String(step.query || '').trim() || buildQuery({
      title: ctx.parsedSnippet?.title || '',
      targetUrl: ctx.targetUrl,
    });

    if (step.fastHeaderOnly) {
      const picked = pickReferrer({
        geo,
        title: ctx.parsedSnippet?.title || '',
        targetUrl: ctx.targetUrl,
        mode: step.mode || 'mixed',
      });
      if (picked && picked.url) {
        ctx.serpUrl = picked.url;
      } else {
        ctx.serpUrl = buildSerpUrl(engine.id, query, geo?.countryCode || geo?.cc || 'US');
      }
      ctx.searchQuery = query;
      let sourceHost = engine.id;
      try { sourceHost = new URL(ctx.serpUrl).hostname.replace(/^www\./i, ''); } catch {}
      ctx.searchEngine = sourceHost;
      return `Organic/social referrer (${sourceHost}): "${query}" → routing to target`;
    }

    let navigated = false;
    try {
      // Short leash: the warm-up is optional. A captcha/slow engine must not eat the visit budget.
      await page.goto(profile.homeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      navigated = true;
    } catch {
      navigated = false;
    }

    if (navigated) {
      ctx.pagesVisited++;
      await sleep(600 + Math.round(Math.random() * 900));
      // EU/UK proxies get a consent interstitial before the search box is usable.
      for (const sel of profile.acceptSelectors) {
        const loc = page.locator(sel).first();
        if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
          await loc.click({ timeout: 3000 }).catch(() => {});
          await sleep(700);
          break;
        }
      }
      let box = null;
      for (const sel of profile.inputSelectors) {
        const loc = page.locator(sel).first();
        if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
          box = loc;
          break;
        }
      }
      if (box) {
        await box.click({ timeout: 4000 }).catch(() => {});
        await humanType(page, box, query).catch(async () => { await box.fill(query).catch(() => {}); });
        await sleep(300 + Math.round(Math.random() * 500));
        await page.keyboard.press('Enter').catch(() => {});
        await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
        await sleep(900 + Math.round(Math.random() * 1200));
      }
      try {
        const landed = new URL(page.url());
        if (/search|results|\?q=|\?p=/.test(`${landed.pathname}${landed.search}`)) {
          ctx.serpUrl = landed.toString();
        }
      } catch {}
      // Google answers a datacenter IP with a "sorry / unusual traffic" wall instead of results.
      // Remember it so the next visits on this proxy simply use Bing/DuckDuckGo/Yahoo.
      try {
        if (/\/sorry\//i.test(page.url())) {
          ctx.engineChallenged = engine.id;
        } else {
          const bodyText = await page.locator('body').innerText({ timeout: 2500 }).catch(() => '');
          if (/unusual traffic|automated queries|before you continue|are you a robot|not a robot|verify you are human/i.test(String(bodyText || ''))) {
            ctx.engineChallenged = engine.id;
          }
        }
      } catch {}
    }

    // Even if the engine UI failed (captcha, blocked proxy), the referrer must still be a real
    // results URL — build it directly so the offer navigation is never logged as a direct hit.
    if (!ctx.serpUrl) {
      ctx.serpUrl = buildSerpUrl(engine.id, query, geo?.countryCode || geo?.cc || 'US');
    }
    ctx.searchQuery = query;
    ctx.searchEngine = engine.id;
    return `Organic search on ${engine.id}: "${query}" → navigating to target from SERP`;
  },

  /**
   * AI form guard — runs right before a submit. Fills any visible empty field from the visit
   * identity, then (only if something is still unmapped) asks the model which selector to use.
   */
  async ai_form_guard(page, step, ctx) {
    const identity = step.identity || ctx.identity || null;
    if (!identity) return 'AI Form Guard: No session identity — skipped';
    const emit = msg => { if (ctx.onStep) ctx.onStep(msg); };
    // The identity stores the inbox as a template; resolve it here so the guard never types
    // the literal "{{AGENT_EMAIL}}" into a field that the visit cannot verify.
    let emailValue = String(identity.email || '');
    if (!emailValue || /^\{\{\s*(AGENT_EMAIL|EMAIL)\s*\}\}$/i.test(emailValue)) {
      const inbox = await ensureVisitInbox(ctx, emit).catch(() => null);
      emailValue = inbox?.address || '';
    }

    const filled = await page.evaluate((id) => {
      const setVal = (el, value) => {
        // Each element type has its own value setter; calling the <input> setter on a
        // <textarea> throws Illegal invocation and used to kill this whole pass.
        const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
          : el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      };
      const pick = (el, hint) => {
        const h = String(hint || '').toLowerCase();
        // Never map a free-text <textarea> (e.g. "Tell us more") to phone/name unless explicitly named address.
        if (el.tagName === 'TEXTAREA' && !/\b(address|street)\b/i.test(`${el.id || ''} ${el.name || ''}`)) {
          return '';
        }
        const elType = String(el.getAttribute('type') || '').toLowerCase();
        if (/\b(first|fname)\b|first[_-]?name/.test(h)) return id.first;
        if (/\b(last|lname|surname)\b|last[_-]?name/.test(h)) return id.last;
        if (elType === 'email' || /\b(e?mail)\b/.test(h)) return id.email;
        if (/\b(address|street)\b|street[_-]?address/.test(h)) return id.street;
        if (/\b(city|town)\b/.test(h)) return id.city;
        if (/\b(zip|postal|postcode)\b/.test(h)) return id.zip;
        if (/\b(state|province|region)\b/.test(h)) return id.state;
        if (elType === 'tel' || /\b(phone|tel|telephone|mobile|cell)\b/.test(h)) return id.phone;
        return '';
      };
      const out = [];
      const nodes = Array.from(document.querySelectorAll('input, select, textarea'));
      for (const el of nodes) {
        const type = (el.getAttribute('type') || el.tagName).toLowerCase();
        if (['hidden', 'password', 'file', 'submit', 'button', 'checkbox', 'radio'].includes(type)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 10 || r.height < 10) continue;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
        const current = String(el.value || '').trim();
        if (current && !/^(select|choose|-{0,2}select.{0,6}-{0,2})$/i.test(current)) continue;
        const hint = `${el.id || ''} ${el.getAttribute('name') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''}`;
        const value = pick(el, hint);
        if (!value) { out.push({ selector: el.id ? `#${el.id}` : '', hint: hint.trim().slice(0, 40), filled: '' }); continue; }
        try {
          setVal(el, value);
          out.push({ selector: el.id ? `#${el.id}` : '', hint: hint.trim().slice(0, 40), filled: value });
        } catch {
          out.push({ selector: el.id ? `#${el.id}` : '', hint: hint.trim().slice(0, 40), filled: '' });
        }
      }
      return out;
    }, {
      first: identity.first || '',
      last: identity.last || '',
      street: identity.street || '',
      city: identity.city || '',
      zip: identity.zip || '',
      state: identity.state || '',
      phone: identity.phone || '',
      email: emailValue,
    }).catch(() => []);

    const filledNow = filled.filter(f => f.filled);
    const unknown = filled.filter(f => !f.filled && f.selector);

    // Only spend an API call when the deterministic pass could not map a field.
    let aiNote = '';
    if (unknown.length && ctx.aiConfig?.enabled !== false) {
      try {
        const dom = await captureCompactDomForAi(page, Boolean(ctx.avoidAdClicks), { sameOriginOnly: false });
        const filledSelectors = new Set(filledNow.map(f => f.selector).filter(Boolean));
        const unmappedInputs = (dom.inputs || []).filter(i => !filledSelectors.has(i.selector));
        const res = await callAiChat({
          provider: ctx.aiConfig?.provider || 'auto',
          role: 'worker',
          model: resolveChatModel(step, ctx),
          temperature: 0.1,
          maxTokens: 160,
          timeoutMs: 20000,
          messages: [
            { role: 'system', content: 'You complete signup forms. Fill ONLY the listed unmapped fields. Reply ONLY JSON: {"fills":[{"selector":"#id","value":"..."}]}' },
            {
              role: 'user',
              content: `Unmapped fields: ${unknown.map(u => u.hint).join(' | ').slice(0, 300)}\nInputs: ${JSON.stringify(unmappedInputs.length ? unmappedInputs : dom.inputs).slice(0, 700)}\nIdentity: ${JSON.stringify({ first: identity.first, last: identity.last, email: emailValue, street: identity.street, city: identity.city, state: identity.state, zip: identity.zip, phone: identity.phone })}`,
            },
          ],
        });
        const text = typeof res === 'string' ? res : (res?.text || res?.content || '');
        const match = String(text).match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          let appliedAi = 0;
          for (const f of (parsed.fills || []).slice(0, 6)) {
            if (!f || !f.selector || f.value == null) continue;
            const sel = String(f.selector);
            if (filledSelectors.has(sel)) continue;
            const loc = page.locator(sel).first();
            if ((await loc.count().catch(() => 0)) > 0) {
              await loc.fill(String(f.value)).catch(() => {});
              filledSelectors.add(sel);
              filledNow.push({ selector: sel, filled: String(f.value) });
              appliedAi += 1;
            }
          }
          if (appliedAi) aiNote = ` + ${appliedAi} fields completed by AI`;
        }
      } catch (err) {
        aiNote = ` (AI Form Guard unavailable: ${String(err?.message || err).slice(0, 60)})`;
      }
    }

    if (!filledNow.length && !unknown.length) return 'AI Form Guard: All visible fields already populated';
    const summary = filledNow.map(f => `${f.selector || f.hint}=${String(f.filled).slice(0, 18)}`).join(', ');
    emit(`[Visit ${ctx.visitIndex + 1 ?? ''} | AI Form Guard] Populated ${filledNow.length} fields${aiNote}`);
    return `AI Form Guard: Populated ${filledNow.length} empty fields${aiNote}${summary ? ` (${summary})` : ''}`;
  },

  /**
   * AI route repair — when the visit lands somewhere unexpected, ask the model which on-page link
   * continues the journey, and click it. Keeps a visit alive instead of dying on a wrong page.
   */
  async ai_route_repair(page, step, ctx) {
    if (!page || page.isClosed()) return 'AI Route Repair: No active page';
    // Never let the model pick a link when the page already shows the signup form — clicking
    // "a better link" there would abandon a working funnel (and burn an API call).
    const formVisible = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('input, select'));
      return nodes.some(el => {
        const type = (el.getAttribute('type') || el.tagName).toLowerCase();
        if (['hidden', 'file', 'submit', 'button'].includes(type)) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 10 || r.height < 10) return false;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        const hint = `${el.id || ''} ${el.getAttribute('name') || ''} ${el.getAttribute('type') || ''}`.toLowerCase();
        return /mail|first|last|name|address|zip|phone|tel/.test(hint);
      });
    }).catch(() => false);
    if (formVisible) return 'AI Route Repair: Target form already visible — no repair needed';
    if (Array.isArray(ctx?.steps)) {
      const upcoming = ctx.steps.slice((ctx.currentStepIndex || 0) + 1);
      const nextWithSel = upcoming.find(s => s && ['click', 'fill', 'fill_email', 'select', 'hover', 'scroll_to'].includes(s.type) && s.selector);
      if (nextWithSel) {
        const existsNow = (await page.locator(nextWithSel.selector).count().catch(() => 0)) > 0;
        if (existsNow) {
          return 'AI Route Repair: Next recorded target is already present on current page — continuing flow';
        }
      }
    }
    const dom = await captureCompactDomForAi(page, Boolean(ctx.avoidAdClicks), { sameOriginOnly: false });
    if (!dom.clickables.length) return 'AI Route Repair: No clickable links on page';
    const goal = String(step.value || ctx.aiDirective || 'continue to the offer form').slice(0, 200);
    try {
      const res = await callAiChat({
        provider: ctx.aiConfig?.provider || 'auto',
        role: 'worker',
        model: resolveChatModel(step, ctx),
        temperature: 0.1,
        maxTokens: 120,
        timeoutMs: 20000,
        messages: [
          { role: 'system', content: 'You pick the single best link to continue a signup flow. Reply ONLY JSON: {"id":0,"why":"short"}' },
          { role: 'user', content: `Goal: ${goal}\nURL: ${dom.url}\nHeadings: ${dom.headings.join(' | ')}\nLinks: ${JSON.stringify(dom.clickables.slice(0, 10))}` },
        ],
      });
      const text = typeof res === 'string' ? res : (res?.text || res?.content || '');
      const match = String(text).match(/\{[\s\S]*\}/);
      if (!match) return 'AI Route Repair: No decision returned';
      const picked = JSON.parse(match[0]);
      const target = dom.clickables.find(c => Number(c.id) === Number(picked.id));
      if (!target || !target.selector) return 'AI Route Repair: Target not found on page';
      const loc = page.locator(target.selector).first();
      if ((await loc.count().catch(() => 0)) === 0) return 'AI Route Repair: Selector not found';
      await loc.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
      await loc.click({ timeout: 6000 }).catch(() => {});
      await sleep(1200);
      return `AI Route Repair: Navigated to "${String(target.text || target.selector).slice(0, 40)}" (${String(picked.why || '').slice(0, 40)})`;
    } catch (err) {
      return `AI Route Repair failed: ${String(err?.message || err).slice(0, 60)}`;
    }
  },

  async goto(page, step, ctx) {
    const dest = resolveTargetUrl(ctx.targetUrl, step.value || step.selector || '/');
    const started = Date.now();
    // Cold deep-links into shortener domains are the #1 source of 403 in this funnel.
    const warmNote = await warmUpShortener(page, dest, ctx).catch(() => '');
    const gotoOpts = { waitUntil: 'domcontentloaded', timeout: 25000 };
    // A real browser always sends the page it is standing on as the Referer. `page.goto()` sends
    // none, which is why the affiliate report showed "Direct Hit" for almost every visit.
    const currentUrl = String(page.url() || '');
    const hasRealCurrentPage = /^https?:\/\//i.test(currentUrl) && !/^about:blank/i.test(currentUrl);
    if (step.referer === 'google') {
      gotoOpts.referer = ctx.serpUrl || ctx.initialReferer || 'https://www.google.com/';
      ctx.initialRefererConsumed = true;
    } else if (step.referer === 'serp' && ctx.serpUrl) {
      gotoOpts.referer = ctx.serpUrl;
      ctx.initialRefererConsumed = true;
    } else if (typeof step.referer === 'string' && /^https?:\/\//i.test(step.referer.trim())) {
      gotoOpts.referer = step.referer.trim();
      ctx.initialRefererConsumed = true;
    } else if (!ctx.initialRefererConsumed && ctx.serpUrl) {
      // Warm-up search step already produced a genuine results-page URL.
      gotoOpts.referer = ctx.serpUrl;
      ctx.initialRefererConsumed = true;
    } else if (!ctx.initialRefererConsumed && ctx.initialReferer) {
      gotoOpts.referer = ctx.initialReferer;
      ctx.initialRefererConsumed = true;
    } else if (hasRealCurrentPage) {
      // Same-page continuation (offer step 2, internal hop): the previous page is the referrer.
      const here = String(currentUrl).split('#')[0];
      let sameSite = true;
      try { sameSite = new URL(here).origin === new URL(dest).origin; } catch {}
      gotoOpts.referer = sameSite ? here : (ctx.serpUrl || here);
    } else if (ctx.serpUrl) {
      gotoOpts.referer = ctx.serpUrl;
    }
    const resp = await page.goto(dest, gotoOpts);
    await sleep(withHumanJitter(350, 220, 900, 0.28));
    const loadMs = Date.now() - started;
    const status = resp ? resp.status() : 'n/a';
    // Geo/ASN cloaking: some offers bounce non-qualifying proxies to google.com instead of
    // rendering the form. Treat that as a transient transport failure so the visit is retried
    // on a different proxy instead of silently burning its whole step budget on a blank page.
    try {
      const destHost = new URL(dest).hostname;
      const finalHost = new URL(page.url()).hostname;
      if (destHost && finalHost && !/(^|\.)google\./i.test(destHost) && /(^|\.)google\.[a-z.]+$/i.test(finalHost)) {
        throw new Error(`net::ERR_OFFER_REDIRECT — Target redirected to ${finalHost} (geo/proxy blocked)`);
      }
    } catch (geoErr) {
      if (/ERR_OFFER_REDIRECT/.test(String(geoErr?.message || ''))) throw geoErr;
    }
    ctx.lastStatus = status;
    ctx.loadTimes.push(loadMs);
    ctx.pagesVisited++;
    ctx.visitedUrls.push({ path: step.value || '/', url: page.url(), status, loadMs });
    await injectSnippet(page, ctx.parsedSnippet);
    if (typeof status === 'number' && status >= 400) {
      throw new Error(`Page ${dest} returned HTTP ${status}`);
    }
    return `Loaded ${page.url()} (HTTP ${status}, ${loadMs}ms)${warmNote}`;
  },

  async click(page, step, ctx) {
    const selectorStr = String(step.selector || step.value || '');
    const emit = msg => { if (ctx.onStep) ctx.onStep(msg); };
    const shouldShield = Boolean(ctx.adSafety?.dismissOverlays)
      && !selectorStr.includes('.ad-overlay-unit')
      && !selectorStr.includes('data-lab-overlay');
    // Attribution fix #2: never close the locker/offers overlay earlier than the attribution dwell window
    await enforceLockerDwellGate(step, ctx, emit).catch(() => {});

    const stayChance = Number(step.staySamePageChance ?? ctx.staySamePageChance ?? 0);
    if (stayChance > 0 && Math.random() < stayChance) {
      if (shouldShield) {
        await dismissBlockingOverlays(page, emit, selectorStr).catch(() => 0);
      }
      await humanBrowsePage(page, 3500, ctx.adSafety, emit);
      return `Staying on current page (${Math.round(stayChance * 100)}% dwell probability, skipped "${selectorStr}")`;
    }

    const beforeUrl = page.url();
    if (/(?:allow analytics|data-analytics-allow)/i.test(`${selectorStr} ${step.label || ''}`)) {
      const consentState = await page.evaluate(() => {
        try {
          const btn = document.querySelector('[data-analytics-allow]');
          const panel = document.querySelector('#analytics-preferences');
          if (btn && panel && !panel.hidden) {
            btn.click();
            return 'clicked';
          }
          if (localStorage.getItem('citedcart_tools_analytics_v1') === 'allowed' || (panel && panel.hidden)) {
            return 'already_allowed';
          }
        } catch {}
        return null;
      }).catch(() => null);
      if (consentState === 'clicked' || consentState === 'already_allowed') {
        await sleep(300);
        return 'Analytics consent enabled on page (Allow analytics)';
      }
    }
    const internalHrefMatch = !step.opensTab && selectorStr.match(/^a\[href=["'](\/[^"']*)["']\]$/i);
    let loc;
    try {
      const selTest = String(step.selector || step.value || '');
      const isPartnerHrefStep = /a\[href=["']https?:\/\//i.test(selTest);
      // Offer pages render their buttons late (JS shell + redirects), so the default
      // click wait matches the 20s locator budget instead of cutting off at 10s.
      const locatorTimeout = isPartnerHrefStep
        ? 24000
        : (internalHrefMatch ? 4500 : ((step.optional && Number.isInteger(step.tab) && step.tab > 0) ? 2200 : 20000));
      loc = await resolveInteractiveLocator(page, selectorStr, locatorTimeout);
    } catch (selErr) {
      if (internalHrefMatch) {
        const fallbackDest = resolveTargetUrl(ctx.targetUrl, internalHrefMatch[1]);
        const navStart = Date.now();
        const refererOpt = /^https?:\/\//i.test(beforeUrl) ? beforeUrl : undefined;
        const navResp = await page.goto(fallbackDest, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
          ...(refererOpt ? { referer: refererOpt } : {}),
        }).catch(() => null);
        await sleep(450);
        const navMs = Date.now() - navStart;
        const navStatus = navResp ? navResp.status() : 'n/a';
        ctx.pagesVisited++;
        ctx.visitedUrls.push({ path: internalHrefMatch[1], url: page.url(), status: navStatus, loadMs: navMs });
        return `Direct navigation to ${page.url()} (link ${internalHrefMatch[1]} was not present on current page)`;
      }
      const canFallbackExt = Number.isInteger(step.tab) && step.tab > 0 && selectorStr.includes(':nth-of-type(');
      const fallbackLoc = canFallbackExt ? await resolveFallbackExternalClick(page, step).catch(() => null) : null;
      if (!fallbackLoc) throw selErr;
      loc = fallbackLoc;
      emit(`[Tab #${step.tab}] Selector "${selectorStr.slice(0, 35)}..." shifted — located matching target on loaded page`);
    }
    if (ctx.adSafety?.avoidAdClicks !== false && !step.opensTab) {
      const strictBannerSelector = '.ad-slot-box, .ad-slot-box *, ins.adsbygoogle, .adsbygoogle, [id^="google_ads_iframe"], [id^="aswift_"], #google_vignette_container';
      const isAdTarget = await loc.evaluate(
        (node, badSel) => Boolean(node.closest(badSel)),
        strictBannerSelector
      ).catch(() => false);
      if (isAdTarget) {
        throw new Error(`Blocked click on ad element ("${selectorStr}") — avoidAdClicks enabled`);
      }
    }
    const isLocVisible = await loc.isVisible().catch(() => false);
    if (isLocVisible) {
      await loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
    }
    const box = isLocVisible ? await loc.boundingBox().catch(() => null) : null;
    let clickPoint = null;
    if (box) {
      clickPoint = getErgonomicTargetPoint(box) || {
        x: Math.round(box.x + box.width * randomBetween(0.35, 0.65)),
        y: Math.round(box.y + box.height * randomBetween(0.35, 0.65)),
      };
      await moveMouse(page.mouse, { x: Math.max(10, clickPoint.x - 120), y: Math.max(10, clickPoint.y - 80) }, clickPoint, 8).catch(() => {});
    }
    const targetMeta = await loc.evaluate(node => {
      const anchor = node.closest('a');
      const rawHref = anchor ? (anchor.getAttribute('href') || '').trim() : '';
      const targetAttr = anchor ? (anchor.getAttribute('target') || '').trim().toLowerCase() : '';
      const hasDownload = anchor ? anchor.hasAttribute('download') : false;
      const role = (node.getAttribute('role') || anchor?.getAttribute('role') || '').toLowerCase();
      const hasUiState = Boolean(
        node.getAttribute('aria-expanded')
        || node.getAttribute('aria-controls')
        || anchor?.getAttribute('aria-expanded')
        || anchor?.getAttribute('aria-controls')
      );
      return {
        tag: node.tagName ? node.tagName.toLowerCase() : 'el',
        text: (node.innerText || node.value || node.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 32),
        href: rawHref,
        target: targetAttr,
        hasDownload,
        isButtonBehavior: role === 'button' || hasUiState,
      };
    }).catch(() => ({ tag: 'el', text: '', href: '', target: '', hasDownload: false, isButtonBehavior: false }));
    if (shouldShield) {
      await dismissBlockingOverlays(page, emit, selectorStr).catch(() => 0);
    }
    const wantsPopupBase = Number.isInteger(step.opensTab) && step.opensTab > 0;
    const cameFromFrame = Boolean(loc.__wtgFrameUrl);
    // Attribution fix #1 (continuation): partner anchors found inside locker iframes must keep target=_blank,
    // open a REGISTERED popup tab (so the popunder shield never kills the click redirect chain), and be stored by tab id.
    if (cameFromFrame && !wantsPopupBase && targetMeta.target === '_blank') {
      step.opensTab = Math.max(1, ...Array.from(ctx.tabs.keys())) + 1;
    }
    const wantsPopup = Number.isInteger(step.opensTab) && step.opensTab > 0;
    if (!wantsPopup && step.followExternal && targetMeta.target === '_blank') {
      // Open genuine non-ad editorial outbound link in the same tab so Referer and Back history stay intact
      await loc.evaluate(node => {
        const a = node.closest('a');
        if (a && a.getAttribute('target') === '_blank') a.removeAttribute('target');
      }).catch(() => {});
      targetMeta.target = '';
    }

    if (wantsPopup) {
      page.context().__wtgAllowPopupUntil = Date.now() + 25000;
      page.context().once('page', newP => {
        registerScenarioPage(newP, 30000);
      });
    }
    const popupWaiter = wantsPopup
      ? page.context().waitForEvent('page', { timeout: 12000 }).catch(() => null)
      : null;

    await performShieldedClick(page, loc, selectorStr, shouldShield, emit);

    if (popupWaiter) {
      let openedTabPage = await popupWaiter;
      if (openedTabPage && !openedTabPage.isClosed()) {
        ctx.partnerActivity = true;
        registerScenarioPage(openedTabPage, 30000);
        if (openedTabPage.url() === 'about:blank') {
          await openedTabPage.waitForURL(u => u.href !== 'about:blank', { timeout: 6000 }).catch(() => {});
        }
        await openedTabPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        const tabStats = await inspectTabContentAndSettle(openedTabPage, 3500);
        ctx.tabs.set(step.opensTab, openedTabPage);
        ctx.activeTabId = step.opensTab;
        await openedTabPage.bringToFront().catch(() => {});
        ctx.pagesVisited++;
        const settledUrl = openedTabPage.url();
        ctx.visitedUrls.push({ path: `(tab #${step.opensTab})`, url: settledUrl, status: tabStats.links > 0 ? 'popup' : 'popup-empty', loadMs: 0 });
        if (tabStats.links === 0 && tabStats.textLen < 40) {
          ctx.emptyExternalTabs?.add(step.opensTab);
          let host = settledUrl;
          try { host = new URL(settledUrl).hostname; } catch {}
          emit(`[Tab #${step.opensTab}] External page (${host}) loaded without navigation links (third-party filtering)`);
        } else {
          ctx.emptyExternalTabs?.delete(step.opensTab);
        }
      } else if (step.popupFallbackUrl && /^https?:\/\//i.test(step.popupFallbackUrl)) {
        const context = page.context();
        let fallbackTab = ctx.tabs.get(step.opensTab);
        if (!fallbackTab || fallbackTab.isClosed()) {
          context.__wtgCreatingScenarioPage = true;
          try {
            fallbackTab = await context.newPage();
            registerScenarioPage(fallbackTab, 30000);
          } finally {
            context.__wtgCreatingScenarioPage = false;
          }
        } else {
          registerScenarioPage(fallbackTab, 30000);
        }
        const fbResp = await fallbackTab.goto(step.popupFallbackUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
        const fbStats = await inspectTabContentAndSettle(fallbackTab, 2500);
        ctx.tabs.set(step.opensTab, fallbackTab);
        ctx.activeTabId = step.opensTab;
        await fallbackTab.bringToFront().catch(() => {});
        ctx.pagesVisited++;
        ctx.visitedUrls.push({ path: `(tab #${step.opensTab})`, url: fallbackTab.url(), status: fbResp ? fbResp.status() : 'fallback', loadMs: 0 });
        if (fbStats.links === 0 && fbStats.textLen < 40) {
          ctx.emptyExternalTabs?.add(step.opensTab);
        }
        openedTabPage = fallbackTab;
      }
    }

    let navNote = '';
    if (!cameFromFrame && shouldExpectSameTabNav(beforeUrl, targetMeta)) {
      let isCrossOrigin = false;
      try {
        isCrossOrigin = new URL(targetMeta.href, beforeUrl).origin !== new URL(beforeUrl).origin;
      } catch {}
      const navWaitMs = isCrossOrigin ? 8500 : 1800;
      await page.waitForURL(u => u.href !== beforeUrl, { timeout: navWaitMs, waitUntil: 'domcontentloaded' }).catch(() => {});
      if (page.url() === beforeUrl) {
        // Click was likely swallowed by a timed OnClick/popunder interceptor; clean overlays and retry once
        await sleep(250);
        if (shouldShield) {
          await dismissBlockingOverlays(page, emit, selectorStr).catch(() => 0);
        }
        const stillThere = await loc.isVisible().catch(() => false);
        if (stillThere) {
          await loc.scrollIntoViewIfNeeded().catch(() => {});
          await performShieldedClick(page, loc, selectorStr, shouldShield, emit);
          await page.waitForURL(u => u.href !== beforeUrl, { timeout: isCrossOrigin ? 6000 : 2200, waitUntil: 'domcontentloaded' }).catch(() => {});
          navNote = page.url() !== beforeUrl ? ' [retried after popup]' : ' [stayed on page]';
        }
      }
    }

    await sleep(350);
    if (/submit|#request/i.test(selectorStr)) {
      await sleep(2200);
    }
    try {
      const curUrl = String(page.url() || '');
      const destOrigin = targetMeta.href ? new URL(targetMeta.href, curUrl).origin : '';
      if (destOrigin && destOrigin !== new URL(curUrl).origin) {
        // Cross-origin partner/offer click executed — attribution surface touched
        ctx.partnerActivity = true;
      }
    } catch {}
    if (isLockerOpenClick(step)) {
      ctx.__wtgLockerOpenedAt = Date.now();
    }
    const labelPart = targetMeta.text ? ` "${targetMeta.text}"` : '';
    const coordPart = clickPoint ? ` @[${clickPoint.x},${clickPoint.y}]` : '';
    return `Clicked "${selectorStr}" (<${targetMeta.tag}>${labelPart}${coordPart})${navNote}`;
  },

  async fill(page, step, ctx) {
    let val = String(step.value ?? '');
    const emit = msg => { if (ctx.onStep) ctx.onStep(msg); };
    const trimmedUpper = val.trim().toUpperCase();
    const selLower = String(step.selector || '').toLowerCase();
    const isEmailField = /mail|email|e-mail/.test(selLower) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
    const isStoreField = /store|domain|website|shop|url/.test(selLower);
    const isOtpField = /#code|\bcode\b|otp|verification|verify-code|pin/i.test(selLower) && !isEmailField && !isStoreField;
    let usedLiveInbox = false;
    const isSecretValue = step.secret === true || isSecretField(step.selector, step.label);
    if (
      trimmedUpper === '{{AGENT_EMAIL}}' ||
      trimmedUpper === '{{EMAIL}}' ||
      (isEmailField && !step.lockValue && getEmailClientStatus().configured)
    ) {
      const inbox = await ensureVisitInbox(ctx, emit);
      if (inbox && inbox.address) {
        val = inbox.address;
        usedLiveInbox = true;
      }
    } else if (
      trimmedUpper === '{{OTP_CODE}}' ||
      trimmedUpper === '{{EMAIL_CODE}}' ||
      trimmedUpper === '{{OTP}}' ||
      (isOtpField && !step.lockValue && ctx.sessionInbox && ctx.sessionInbox.inbox_id)
    ) {
      const inbox = await ensureVisitInbox(ctx, emit);
      if (inbox && inbox.inbox_id) {
        const otpRes = await waitForEmailCode({
          inbox_id: inbox.inbox_id,
          capability: inbox.capability,
          timeoutMs: isOtpField ? 18000 : 45000,
          pollIntervalMs: 2500,
          onPoll: ({ attempts, status }) => emit(`[HirePulse OTP] Poll #${attempts} on inbox (${status})...`),
        });
        if (otpRes && otpRes.code) {
          val = String(otpRes.code);
          registerSecret(val);
          emit(`[HirePulse OTP] Retrieved verification code from inbox and filled (${val.length} chars, redacted)`);
        }
      }
    }
    if (isSecretValue) registerSecret(val);
    if (isStoreField && val && !val.includes('@')) {
      ctx.lastStoreDomain = val;
    }
    if (ctx.adSafety?.dismissOverlays) {
      await dismissBlockingOverlays(page, emit, step.selector).catch(() => 0);
    }
    if (isEmailField || usedLiveInbox) {
      const fallbackStore = ctx.lastStoreDomain || 'allbirds.com';
      await page.evaluate(storeVal => {
        const storeInput = document.querySelector('form#request input#store, form input[name="store"]');
        if (storeInput && !String(storeInput.value || '').trim()) {
          storeInput.value = storeVal;
          storeInput.dispatchEvent(new Event('input', { bubbles: true }));
          storeInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, fallbackStore).catch(() => {});
    }
    const loc = await resolveInteractiveLocator(page, step.selector);
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await loc.click({ timeout: 2500 }).catch(async () => {
      if (ctx.adSafety?.dismissOverlays) {
        await dismissBlockingOverlays(page, emit, step.selector).catch(() => 0);
        await loc.click({ timeout: 2000 }).catch(() => {});
      }
    });
    await loc.fill('').catch(() => {});
    if (val.length <= 80) {
      await humanType(page, loc, val);
    } else {
      await loc.fill(val);
    }
    const actual = await loc.inputValue().catch(() => '');
    if (actual !== val) {
      await loc.fill(val).catch(() => {});
    }

    if (usedLiveInbox) {
      // Live-inbox submissions are conversion surface — remember for end-of-session beacon flush
      ctx.partnerActivity = true;
      return `Filled live agent email in ${step.selector}: ${maskEmail(val)}`;
    }
    return isSecretValue
      ? `Filled sensitive value in ${step.selector} (${val.length} chars, redacted)`
      : `Filled text in ${step.selector} (${val.length} chars: "${redactText(val)}")`;
  },

  async fill_email(page, step, ctx) {
    const emit = msg => { if (ctx.onStep) ctx.onStep(msg); };
    const inbox = await ensureVisitInbox(ctx, emit);
    const selector = String(step.selector || '').trim() ||
      'input[type="email"], input[name*="email" i], input[id*="email" i], input[placeholder*="mail" i]';
    const resText = await STEP_HANDLERS.fill(page, { ...step, selector, value: inbox.address }, ctx);
    return `${resText} [Live agent email: ${maskEmail(inbox.address)}]`;
  },

  async fill_otp(page, step, ctx) {
    const emit = msg => { if (ctx.onStep) ctx.onStep(msg); };
    const inbox = await ensureVisitInbox(ctx, emit);
    const timeoutMs = Math.max(5000, Math.min(120000, Number(step.value) || 45000));
    const otpRes = await waitForEmailCode({
      inbox_id: inbox.inbox_id,
      capability: inbox.capability,
      timeoutMs,
      onPoll: ({ attempts, status }) => emit(`[HirePulse OTP] Waiting for OTP in ${maskEmail(inbox.address)} (attempt #${attempts}, status: ${status})...`),
    });
    const selector = String(step.selector || '').trim() ||
      'input[autocomplete="one-time-code"], input[name*="code" i], input[name*="otp" i], input[id*="code" i], input[id*="otp" i]';
    await STEP_HANDLERS.fill(page, { ...step, selector, value: otpRes.code, secret: true, lockValue: true }, ctx);
    return `Filled email OTP code (${otpRes.code.length} chars, received in ${Math.round(otpRes.elapsedMs / 100) / 10}s)`;
  },

  async select(page, step) {
    const loc = await resolveInteractiveLocator(page, step.selector);
    const val = String(step.value ?? '');
    await loc.selectOption(val).catch(async () => {
      await loc.selectOption({ label: val });
    });
    return 'Selected an option in ' + redactText(step.selector) + '.';
  },

  async press(page, step) {
    const key = String(step.value || 'Enter').trim();
    if (step.selector) {
      const loc = await resolveInteractiveLocator(page, step.selector);
      await loc.press(key);
    } else {
      await page.keyboard.press(key);
    }
    await sleep(250);
    return `Pressed key ${key}`;
  },

  async scroll(page, step) {
    const pct = Math.min(100, Math.max(0, Number(step.value ?? 60) || 60));
    const maxY = await page.evaluate(() =>
      Math.max(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight)
    ).catch(() => 0);
    const targetY = Math.floor((maxY * pct) / 100);
    await smoothScrollTo(page, targetY);
    await sleep(300);
    return `Scrolled to ${pct}% of page`;
  },

  async wait(page, step) {
    if (step.selector && String(step.selector).trim()) {
      const timeout = Math.max(500, Math.min(30000, Number(step.value) || 10000));
      const loc = page.locator(String(step.selector).trim()).first();
      await loc.waitFor({ state: 'visible', timeout });
      return `Element appeared: ${step.selector}`;
    }
    const baseMs = Math.max(100, Math.min(30000, Number(step.value) || 1200));
    const ms = baseMs >= 400 ? withHumanJitter(baseMs, 300, 30000, 0.22) : baseMs;
    await sleep(ms);
    return `Waited ${ms}ms`;
  },

  async assert(page, step, ctx) {
    const kind = step.assertKind || (step.selector ? 'text_contains' : 'url_contains');
    const expected = String(step.value ?? '').trim();

    if (kind === 'status_ok') {
      const st = Number(ctx.lastStatus);
      if (!Number.isFinite(st) || st < 200 || st >= 400) {
        throw new Error(`Status assertion failed: received HTTP ${ctx.lastStatus}`);
      }
      return `PASS: HTTP status OK (${st})`;
    }

    if (kind === 'url_contains') {
      const cur = page.url();
      if (!cur.includes(expected)) {
        throw new Error(`URL assertion failed: "${cur}" does not contain "${expected}"`);
      }
      return `PASS: URL contains "${expected}"`;
    }

    if (kind === 'selector_visible') {
      const sel = String(step.selector || expected || '').trim();
      const visible = await page.locator(sel).first().isVisible().catch(() => false);
      if (!visible) {
        throw new Error(`Visibility assertion failed: "${sel}" is not visible`);
      }
      return `PASS: Element "${sel}" is visible`;
    }

    // default: text_contains
    let actualText = '';
    if (step.selector && String(step.selector).trim()) {
      const loc = page.locator(String(step.selector).trim()).first();
      actualText = (await loc.innerText().catch(() => '')) || (await loc.textContent().catch(() => '')) || '';
    } else {
      actualText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    }
    if (!actualText.includes(expected)) {
      throw new Error(`Text assertion failed on "${step.selector || 'body'}": "${actualText.trim().slice(0, 80)}" does not contain "${expected}"`);
    }
    return `PASS: Found "${expected}"`;
  },

  async read_article(page, step, ctx) {
    const totalMs = withHumanJitter(Number(step.value) || 8500, 1500, 45000, 0.22);
    const started = Date.now();
    const maxY = await page.evaluate(() =>
      Math.max(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight)
    ).catch(() => 0);

    const checkpoints = [0.22, 0.45, 0.68, 0.55, 0.85];
    const perStopWait = Math.max(300, Math.floor((totalMs - 1000) / checkpoints.length));
    for (let k = 0; k < checkpoints.length; k++) {
      if (Date.now() - started >= totalMs) break;
      const y = Math.floor(maxY * checkpoints[k] * randomBetween(0.92, 1.04));
      await smoothScrollTo(page, Math.min(maxY, Math.max(0, y))).catch(() => {});
      if (k === 1 && ctx.adSafety?.dismissOverlays) {
        await dismissBlockingOverlays(page, msg => ctx.onStep && ctx.onStep(msg)).catch(() => 0);
      }
      await moveMouse(
        page.mouse,
        { x: 220 + (k * 45) % 300, y: 240 + (k * 35) % 200 },
        { x: 340 + (k * 70) % 360, y: 290 + (k * 40) % 180 },
        8
      ).catch(() => {});
      await sleep(Math.min(perStopWait, Math.max(250, totalMs - (Date.now() - started))));
    }
    const remaining = totalMs - (Date.now() - started);
    if (remaining > 150) await sleep(remaining);
    return `Human article reading (${checkpoints.length} scroll checkpoints, ${Math.round((Date.now() - started) / 100) / 10}s, zero ad clicks)`;
  },

  async hover(page, step, ctx) {
    const selectorStr = String(step.selector || '').trim();
    const loc = await resolveInteractiveLocator(page, selectorStr);
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const pauseMs = withHumanJitter(Number(step.value) || 800, 220, 5000, 0.25);
    const box = await loc.boundingBox().catch(() => null);
    if (box) {
      const to = {
        x: Math.round(box.x + box.width * randomBetween(0.3, 0.7)),
        y: Math.round(box.y + box.height * randomBetween(0.3, 0.7)),
      };
      await moveMouse(page.mouse, { x: Math.max(10, to.x - 140), y: Math.max(10, to.y - 70) }, to, 10).catch(() => {});
    } else {
      await loc.hover().catch(() => {});
    }
    await sleep(pauseMs);
    return `Human hover on "${selectorStr}" (${pauseMs}ms)`;
  },

  async human_browse(page, step, ctx) {
    const budgetMs = withHumanJitter(Number(step.value) || 7000, 2000, 45000, 0.22);
    const secs = await humanBrowsePage(page, budgetMs, ctx.adSafety, ctx.onStep);
    return `Autonomous human browsing (scrolls, mouse, hover, selection — ${secs}s)`;
  },

  async scroll_to(page, step) {
    const selectorStr = String(step.selector || step.value || '').trim();
    const loc = await resolveInteractiveLocator(page, selectorStr);
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(350);
    return `Scrolled to "${selectorStr}" (no click)`;
  },

  async dismiss_overlays(page, _step, ctx) {
    const count = await dismissBlockingOverlays(page, msg => ctx.onStep && ctx.onStep(msg));
    return `Dismissed ${count} floating overlays`;
  },

  async audit_ads(page, _step, ctx) {
    const report = await auditAdPlacements(page);
    ctx.adAudit = report;
    const activeNames = (report.slots || []).map(s => {
      const ok = Boolean(s.visible || (s.iframeSize && s.iframeSize !== '0x0') || (s.nativeCardsCount && s.nativeCardsCount > 0));
      const dim = s.iframeSize || s.boxSize || '';
      return `${s.position}:${s.slotId}${ok ? '✓' : '○'}${dim ? `[${dim}]` : ''}`;
    }).join(', ');
    const adsenseNote = report.adsenseCount ? `, AdSense=${report.adsenseCount}` : '';
    return `Ad Audit: meta=${report.metaSlotsCount}, slots=${report.slotsFound}${activeNames ? ` (${activeNames})` : ''}${adsenseNote}, overlays=${report.overlaysFound}`;
  },

  async go_back(page, step, ctx) {
    const beforeUrl = page.url();
    const resp = await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
    let afterUrl = String(page.url() || '');
    if (!/^https?:\/\//i.test(afterUrl) || /^about:blank/i.test(afterUrl)) {
      const recoverUrl = /^https?:\/\//i.test(beforeUrl) ? beforeUrl : resolveTargetUrl(ctx.targetUrl, '/');
      await page.goto(recoverUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      afterUrl = String(page.url() || '');
    }
    await sleep(withHumanJitter(Number(step.value) || 850, 350, 5000, 0.25));
    const status = resp ? resp.status() : 'history';
    ctx.pagesVisited++;
    ctx.visitedUrls.push({ path: '(back)', url: afterUrl, status, loadMs: 0 });
    return `Navigated back in history to ${afterUrl} (from ${beforeUrl})`;
  },

  async close_tab(_page, step, ctx) {
    const tabId = Number.isInteger(step.tab) && step.tab > 0 ? step.tab : null;
    if (!tabId) return 'Skipped (cannot close primary tab)';
    const tabPage = ctx.tabs.get(tabId);
    if (tabPage && !tabPage.isClosed()) {
      const tabUrl = String(tabPage.url() || '');
      const settleMs = Math.max(0, Number(ctx.attribution?.closeSettleMs ?? 2800));
      // Attribution fix #4: let partner pixels/beacons finish firing before tearing down the offer tab.
      // Dead offer-unavailable pages and blank tabs stay instant (existing fail-fast behaviour).
      if (settleMs > 0 && tabUrl.startsWith('http') && !/offer-unavailable|not-available|about:blank/i.test(tabUrl)) {
        ctx.partnerActivity = true;
        await sleep(settleMs + Math.round(Math.random() * 1200)).catch(() => {});
      }
      await tabPage.close().catch(() => {});
    }
    ctx.tabs.delete(tabId);
    const mainPage = ctx.tabs.get(0);
    if (mainPage && !mainPage.isClosed()) {
      await mainPage.bringToFront().catch(() => {});
      ctx.activeTabId = 0;
    }
    return `Closed Tab #${tabId} and returned to primary site`;
  },

  async screenshot(_page, step) {
    return `Captured screenshot: ${step.label || step.value || 'Checkpoint'}`;
  },
};

function applyPageSafeTimeouts(targetPage) {
  if (!targetPage || targetPage.isClosed()) return;
  try {
    targetPage.setDefaultTimeout(5500);
    targetPage.setDefaultNavigationTimeout(22000);
  } catch {}
}

function pickBestOpenExternalTab(ctx, preferredTabId) {
  const candidates = [];
  for (const [id, p] of ctx.tabs.entries()) {
    if (id <= 0 || !p || p.isClosed()) continue;
    const u = String(p.url() || '');
    if (!u || u === 'about:blank') continue;
    if (ctx.emptyExternalTabs?.has(id)) continue;
    candidates.push({ id, page: p });
  }
  const exact = candidates.find(c => c.id === preferredTabId);
  if (exact) return exact;
  return candidates.sort((a, b) => b.id - a.id)[0] || null;
}

async function getStepPage(step, ctx) {
  const tabId = Number.isInteger(step.tab) && step.tab >= 0 ? step.tab : 0;
  let targetPage = ctx.tabs.get(tabId);
  const isDynamicOptionalStep = ['ai_explore', 'scan_products', 'human_browse', 'read_article', 'ai_form_guard', 'ai_route_repair'].includes(step.type) || Boolean(step.optional);

  if (tabId > 0 && (!targetPage || targetPage.isClosed() || targetPage.url() === 'about:blank' || ctx.emptyExternalTabs?.has(tabId)) && isDynamicOptionalStep) {
    const ext = pickBestOpenExternalTab(ctx, tabId);
    if (ext) {
      targetPage = ext.page;
      ctx.activeTabId = ext.id;
      await targetPage.bringToFront().catch(() => {});
      return targetPage;
    }
    const basePage = ctx.tabs.get(0);
    if (['ai_explore', 'scan_products', 'human_browse', 'read_article', 'ai_form_guard', 'ai_route_repair'].includes(step.type) && basePage && !basePage.isClosed()) {
      ctx.activeTabId = 0;
      await basePage.bringToFront().catch(() => {});
      return basePage;
    }
  }

  if (!targetPage || targetPage.isClosed()) {
    const basePage = ctx.tabs.get(0);
    if (tabId === 0) {
      targetPage = basePage;
    } else if (step.type === 'goto') {
      const context = basePage.context();
      context.__wtgCreatingScenarioPage = true;
      try {
        targetPage = await context.newPage();
        registerScenarioPage(targetPage, 8000);
      } finally {
        context.__wtgCreatingScenarioPage = false;
      }
      ctx.tabs.set(tabId, targetPage);
    } else {
      // Never spawn blank idle tabs in RAM for missing secondary steps; return an empty indicator
      return null;
    }
  } else {
    registerScenarioPage(targetPage);
  }
  applyPageSafeTimeouts(targetPage);
  if (ctx.activeTabId !== tabId) {
    await targetPage.bringToFront().catch(() => {});
    ctx.activeTabId = tabId;
  }
  return targetPage;
}

/**
 * Executes a deterministic sequence of user-defined QA steps (`taskSteps`)
 * and emits live step progress and screenshots.
 */
async function executeTaskSteps({
  page,
  targetUrl,
  steps,
  snippet,
  visitIndex,
  personaName = 'scenario',
  alreadyNavigated = false,
  initialStatus = 'n/a',
  initialLoadMs = 0,
  initialReferer = '',
  adSafety = {},
  aiConfig = {},
  aiDirective = '',
  staySameOrigin = false,
  onFrame = null,
  onStep = null,
  attribution = {},
  geoInfo = null,
  identityInfo = null,
  avoidEngines = [],
}) {
  registerStepSecrets(steps);
  const parsedSnippet = parseSnippet(snippet);
  const telemetry = attachPageTelemetry(page);
  const ctx = {
    targetUrl,
    parsedSnippet,
    adSafety: adSafety || {},
    avoidAdClicks: Boolean(adSafety?.avoidAdClicks),
    dismissOverlays: adSafety?.dismissOverlays !== false,
    aiConfig: aiConfig || {},
    aiDirective: aiDirective || '',
    staySameOrigin: Boolean(staySameOrigin),
    sessionInbox: null,
    onStep,
    visitIndex,
    geo: geoInfo || null,
    identity: identityInfo || null,
    serpUrl: '',
    searchQuery: '',
    searchEngine: '',
    initialReferer: initialReferer || '',
    initialRefererConsumed: Boolean(alreadyNavigated),
    avoidEngines: Array.isArray(avoidEngines) ? avoidEngines : [],
    lastStatus: initialStatus,
    loadTimes: initialLoadMs ? [initialLoadMs] : [],
    pagesVisited: alreadyNavigated ? 1 : 0,
    visitedUrls: [],
    tabs: new Map([[0, page]]),
    activeTabId: 0,
    emptyExternalTabs: new Set(),
    attribution: attribution || {},
    partnerActivity: false,
    __wtgLockerOpenedAt: null,
    steps,
    currentStepIndex: 0,
  };
  const stepResults = [];
  const emitStep = msg => { if (typeof onStep === 'function') onStep(redactText(msg)); };
  applyPageSafeTimeouts(page);

  try {
    if (alreadyNavigated) {
      await injectSnippet(page, parsedSnippet);
      await captureFrameSafe(page, { visitIndex, label: 'Scenario entry page', persona: personaName }, onFrame);
    } else if (!steps.length || !['goto', 'search_entry'].includes(steps[0].type)) {
      // A leading `search_entry` is the entry point: navigating to the target here first would
      // hit the offer twice per visit (and before the search engine exists).
      const entryOpts = { waitUntil: 'domcontentloaded', timeout: 25000 };
      if (!ctx.initialRefererConsumed && ctx.initialReferer) {
        entryOpts.referer = ctx.initialReferer;
        ctx.initialRefererConsumed = true;
      }
      const entryResp = await page.goto(resolveTargetUrl(targetUrl, '/'), entryOpts);
      await sleep(350);
      ctx.lastStatus = entryResp ? entryResp.status() : 'n/a';
      ctx.pagesVisited = 1;
      await injectSnippet(page, parsedSnippet);
      await captureFrameSafe(page, { visitIndex, label: 'Opened base page', persona: personaName }, onFrame);
    }

    const FAIL_FAST_SKIP_LIMIT = 4;
    const FAIL_FAST_ELIGIBLE_TYPES = new Set(['click', 'fill', 'fill_email', 'fill_otp', 'select', 'hover', 'scroll', 'scroll_to', 'wait']);
    const skipsByTabUrl = new Map();
    const recoveredTabUrls = new Set();

    const getNormalizedTabUrl = p => {
      if (!p || p.isClosed()) return '';
      try {
        const u = new URL(p.url());
        return `${u.origin}${u.pathname.replace(/\/+$/, '') || '/'}`;
      } catch {
        return String(p.url() || '').split('#')[0];
      }
    };

    for (let idx = 0; idx < steps.length; idx++) {
      ctx.currentStepIndex = idx;
      if (page.isClosed()) {
        emitStep(`[Visit ${visitIndex + 1}] Session closed (timeout or stop) — finishing cleanly`);
        break;
      }
      const step = steps[idx] || {};
      const stepTab = Number.isInteger(step.tab) && step.tab >= 0 ? step.tab : 0;
      const existingTabPage = ctx.tabs.get(stepTab);
      const preCheckUrl = getNormalizedTabUrl(existingTabPage);
      const preFailKey = preCheckUrl ? `${stepTab}|${preCheckUrl}` : '';

      if (
        preFailKey
        && FAIL_FAST_ELIGIBLE_TYPES.has(step.type)
        && !step.mustRun
        && (skipsByTabUrl.get(preFailKey) || 0) >= (stepTab > 0 ? 2 : FAIL_FAST_SKIP_LIMIT)
      ) {
        const skippedDetail = `Skipped immediately (Fail-Fast: page mismatch after ${skipsByTabUrl.get(preFailKey)} consecutive skips)`;
        const label = safeStepLabel(step);
        stepResults.push({ index: idx + 1, type: step.type, label, ok: false, durationMs: 0, detail: skippedDetail });
        emitStep(`[Visit ${visitIndex + 1} | Step ${idx + 1}/${steps.length}] ${skippedDetail}`);
        continue;
      }

      if (
        stepTab > 0
        && existingTabPage
        && !existingTabPage.isClosed()
        && /offer[-_]?unavailable|not[-_]?available/i.test(String(existingTabPage.url() || ''))
      ) {
        ctx.emptyExternalTabs.add(stepTab);
        await existingTabPage.close().catch(() => {});
        if (ctx.activeTabId === stepTab) ctx.activeTabId = 0;
        emitStep(`[Tab #${stepTab}] Unavailable offer page detected — closed tab automatically`);
      }

      if (stepTab > 0 && ctx.emptyExternalTabs.has(stepTab) && !['ai_explore', 'ai_form_guard', 'ai_route_repair', 'scan_products', 'close_tab', 'goto'].includes(step.type) && !step.mustRun) {
        const skippedDetail = `Skipped immediately (Tab #${stepTab} left without navigation links on external page)`;
        const label = safeStepLabel(step);
        stepResults.push({ index: idx + 1, type: step.type, label, ok: false, durationMs: 0, detail: skippedDetail });
        emitStep(`[Visit ${visitIndex + 1} | Step ${idx + 1}/${steps.length}] ${skippedDetail}`);
        continue;
      }

      const handler =
        step.type === 'scan_products'
          ? runScanProductsStep
          : step.type === 'ai_explore'
            ? runAiExploreStep
            : STEP_HANDLERS[step.type];
      if (!handler) {
        throw new Error(`Unknown scenario step type: ${step.type}`);
      }

      const stepLabel = safeStepLabel(step);
      const started = Date.now();
      let detail;
      let ok = true;
      let activeStepPage = page;
      try {
        let tabPage = step.type === 'close_tab' ? page : await getStepPage(step, ctx);
        if (!tabPage && stepTab > 0) {
          throw new Error(`Tab #${stepTab} did not open`);
        }
        if (
          ['ai_explore', 'scan_products', 'ai_form_guard', 'ai_route_repair'].includes(step.type)
          && tabPage
          && !tabPage.isClosed()
          && tabPage.url() === 'about:blank'
          && ctx.tabs.get(0)
          && !ctx.tabs.get(0).isClosed()
          && ctx.tabs.get(0).url() !== 'about:blank'
        ) {
          tabPage = ctx.tabs.get(0);
          await tabPage.bringToFront().catch(() => {});
          ctx.activeTabId = 0;
        }
        activeStepPage = tabPage || page;
        const preExploreUrl = (step.type === 'ai_explore' && activeStepPage && !activeStepPage.isClosed())
          ? activeStepPage.url()
          : '';
        const preExploreNorm = preExploreUrl ? getNormalizedTabUrl(activeStepPage) : '';
        detail = await handler(tabPage, step, ctx);
        if (preExploreUrl && preExploreNorm && activeStepPage && !activeStepPage.isClosed()) {
          const postExploreNorm = getNormalizedTabUrl(activeStepPage);
          if (postExploreNorm && postExploreNorm !== preExploreNorm) {
            const nextSelStep = steps.slice(idx + 1).find(s =>
              (Number.isInteger(s?.tab) ? s.tab : 0) === stepTab
              && ['click', 'fill', 'fill_email', 'select'].includes(s?.type)
              && s?.selector
            );
            if (nextSelStep) {
              const existsOnNewPage = (await activeStepPage.locator(nextSelStep.selector).count().catch(() => 0)) > 0;
              if (!existsOnNewPage) {
                await activeStepPage.goto(preExploreUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                detail = `${detail} (returned to scenario page to continue recorded steps)`;
              }
            }
          }
        }
      } catch (err) {
        // Offer pages bounce through two or three URLs during a visit. A redirect that
        // lands mid-step destroys the JS execution context and the whole visit used to
        // die on it. Wait for the navigation to settle and replay the same step once.
        let recovered = false;
        const navRace = /Execution context was destroyed|Cannot find context|because of a navigation|frame was detached/i
          .test(String(err?.message || ''));
        if (navRace && !page.isClosed()) {
          await page.waitForTimeout(1500).catch(() => {});
          try {
            detail = await handler(activeStepPage || page, step, ctx);
            recovered = true;
          } catch (retryErr) {
            err = retryErr;
          }
        }
        if (!recovered) {
          if (page.isClosed() || /Target page, context or browser has been closed/i.test(err?.message || '')) {
          if (!step.optional && page.isClosed()) {
            emitStep(`[Visit ${visitIndex + 1}] Browser closed during step ${idx + 1} — ending visit`);
            break;
          }
        }
        const canSoftSkip = step.optional || ['click', 'hover', 'scroll_to'].includes(step.type);
        if (!canSoftSkip) {
          if (err instanceof Error) {
            err.message = redactText(err.message);
            if (err.stack) err.stack = redactText(err.stack);
          }
          throw err;
        }
        if (step.type === 'click' && /a\[href=["']https?:/i.test(String(step.selector || ''))) {
          // Attribution diagnostics: show what offers/anchors actually existed on skip
          await dumpLockerAnchors(activeStepPage || page, step.selector).catch(() => {});
        }
        ok = false;
        const shortErr = redactText(err?.message || err).split('\n')[0].slice(0, 110);
        detail = `Skipped (element not present on current page): ${shortErr}`;
        }
      }
      const durationMs = Date.now() - started;

      stepResults.push({
        index: idx + 1,
        type: step.type,
        label: stepLabel,
        ok,
        durationMs,
        detail: redactText(detail),
      });

      emitStep(`[Visit ${visitIndex + 1} | Step ${idx + 1}/${steps.length}] ${detail}`);

      const postUrl = getNormalizedTabUrl(activeStepPage);
      const tabUrlKey = postUrl ? `${stepTab}|${postUrl}` : '';
      if (ok) {
        if (tabUrlKey && !['wait', 'sleep'].includes(step.type)) {
          skipsByTabUrl.set(tabUrlKey, 0);
        }
      } else if (tabUrlKey) {
        const nextSkipCount = (skipsByTabUrl.get(tabUrlKey) || 0) + 1;
        skipsByTabUrl.set(tabUrlKey, nextSkipCount);
        if (
          nextSkipCount === 2
          && !recoveredTabUrls.has(tabUrlKey)
          && aiConfig?.enabled !== false
          && !ctx.staySameOrigin
          && ['click', 'fill', 'fill_email', 'fill_otp', 'select'].includes(step.type)
          && activeStepPage
          && !activeStepPage.isClosed()
        ) {
          recoveredTabUrls.add(tabUrlKey);
          const recNote = await runAiSmartRecoveryStep(activeStepPage, ctx, step.type).catch(() => null);
          if (recNote) {
            emitStep(`[Visit ${visitIndex + 1} | AI Recovery] ${recNote}`);
          }
        }
      }

      if (['goto', 'click', 'go_back', 'close_tab', 'fill', 'fill_email', 'fill_otp', 'select', 'hover', 'scroll', 'scroll_to', 'read_article', 'human_browse', 'scan_products', 'ai_explore', 'search_entry', 'ai_form_guard', 'ai_route_repair', 'dismiss_overlays', 'audit_ads', 'screenshot'].includes(step.type)) {
        const framePage = ctx.tabs.get(ctx.activeTabId) && !ctx.tabs.get(ctx.activeTabId).isClosed()
          ? ctx.tabs.get(ctx.activeTabId)
          : page;
        await captureFrameSafe(
          framePage,
          { visitIndex, label: `Step ${idx + 1}: ${stepLabel}`, persona: personaName },
          onFrame
        );
      }
    }

    if (ctx.sessionInbox && ctx.sessionInbox.inbox_id && ctx.sessionInbox.capability) {
      let confirmed = false;
      for (let pollAttempt = 1; pollAttempt <= 6 && !confirmed; pollAttempt++) {
        await sleep(3000);
        const [inboxCheck, msgsPayload] = await Promise.all([
          getEmailCode({
            inbox_id: ctx.sessionInbox.inbox_id,
            capability: ctx.sessionInbox.capability,
          }).catch(() => null),
          listEmailMessages({
            inbox_id: ctx.sessionInbox.inbox_id,
            capability: ctx.sessionInbox.capability,
          }).catch(() => null),
        ]);

        const confirmUrl = extractConfirmationUrlFromMessages(msgsPayload);
        if (confirmUrl) {
          const activeP = (ctx.tabs.get(ctx.activeTabId) && !ctx.tabs.get(ctx.activeTabId).isClosed())
            ? ctx.tabs.get(ctx.activeTabId)
            : page;
          await activeP.goto(confirmUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await sleep(1500);
          emitStep(`[Visit ${visitIndex + 1} | ✅ Email Verified] Opened confirmation link from ${maskEmail(ctx.sessionInbox.address)}`);
          confirmed = true;
          break;
        }

        if (inboxCheck && inboxCheck.status === 'code' && inboxCheck.code) {
          const activeP = (ctx.tabs.get(ctx.activeTabId) && !ctx.tabs.get(ctx.activeTabId).isClosed())
            ? ctx.tabs.get(ctx.activeTabId)
            : page;
          const otpSel = 'input[name*="code" i], input[name*="otp" i], input[id*="code" i], input[id*="otp" i], input[placeholder*="code" i]';
          const otpLoc = activeP.locator(otpSel).first();
          if ((await otpLoc.count().catch(() => 0)) > 0 && (await otpLoc.isVisible().catch(() => false))) {
            await otpLoc.fill(String(inboxCheck.code)).catch(() => {});
            await activeP.keyboard.press('Enter').catch(() => {});
            await sleep(1500);
            emitStep(`[Visit ${visitIndex + 1} | ✅ OTP Verified] Filled verification code from ${maskEmail(ctx.sessionInbox.address)}`);
          } else {
            emitStep(`[Visit ${visitIndex + 1} | Live Inbox] Received verification in ${maskEmail(ctx.sessionInbox.address)}`);
          }
          confirmed = true;
          break;
        }

        const msgList = Array.isArray(msgsPayload?.messages)
          ? msgsPayload.messages
          : (Array.isArray(msgsPayload?.items) ? msgsPayload.items : []);
        if (msgList.length > 0) {
          emitStep(`[Visit ${visitIndex + 1} | ✅ Email Received] ${maskEmail(ctx.sessionInbox.address)}`);
          confirmed = true;
          break;
        }

        if (pollAttempt === 6 && inboxCheck) {
          emitStep(`[Visit ${visitIndex + 1} | Live Inbox] Checked ${maskEmail(ctx.sessionInbox.address)} (status: ${inboxCheck.status} — no verification email yet)`);
        }
      }
    }

    const avgLoad = ctx.loadTimes.length
      ? Math.round(ctx.loadTimes.reduce((a, b) => a + b, 0) / ctx.loadTimes.length)
      : initialLoadMs;

    return {
      status: ctx.lastStatus,
      loadMs: avgLoad,
      pagesVisited: Math.max(1, ctx.pagesVisited),
      pageErrors: telemetry.getCount(),
      errorDetails: telemetry.getDetails(),
      visitedUrls: ctx.visitedUrls,
      stepResults,
      partnerActivity: Boolean(ctx.partnerActivity),
      // Which search engine challenged this proxy ("" when none did). Feeds the per-offer scoreboard.
      engineChallenged: ctx.engineChallenged || '',
    };
  } finally {
    const openExternalTabs = Array.from(ctx.tabs.entries()).filter(([id, p]) => id > 0 && p && !p.isClosed());
    if (openExternalTabs.length) {
      // Attribution fix #4 (end-of-visit): small flush window before teardown so pending pixels/beacons complete.
      const flushMs = Math.max(0, Number(ctx.attribution?.closeSettleMs ?? 2800));
      if (flushMs > 0) await sleep(flushMs).catch(() => {});
    }
    for (const [id, tabP] of ctx.tabs.entries()) {
      if (id > 0 && tabP && !tabP.isClosed()) {
        await tabP.close().catch(() => {});
      }
    }
    telemetry.detach();
  }
}

function resetRunInboxFile() {
  try {
    fs.mkdirSync(path.dirname(RUN_INBOXES_FILE), { recursive: true });
    fs.writeFileSync(RUN_INBOXES_FILE, '', 'utf8');
  } catch {}
}

async function confirmRunInboxes({ maxPasses = 4, passDelayMs = 30000 } = {}) {
  const summary = { total: 0, confirmed: 0, failed: 0, passes: 0, ranAt: new Date().toISOString() };
  const entries = readRunInboxes().filter(inbox => inbox.capability);
  summary.total = entries.length;
  const confirmedIds = new Set();
  for (let pass = 1; pass <= maxPasses; pass++) {
    summary.passes = pass;
    const pending = entries.filter(entry => !confirmedIds.has(entry.inbox_id));
    if (!pending.length) break;
    if (pass > 1) await sleep(passDelayMs);
    for (const entry of pending) {
      try {
        const msgsPayload = await listEmailMessages({ inbox_id: entry.inbox_id, capability: entry.capability }).catch(() => null);
        const confirmUrl = extractConfirmationUrlFromMessages(msgsPayload);
        if (!confirmUrl) continue;
        await fetch(confirmUrl, {
          method: 'GET',
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        }).catch(() => {});
        confirmedIds.add(entry.inbox_id);
        summary.confirmed++;
        console.log(`📧 [Email Sweep] Verified email — opened confirmation link from ${maskEmail(entry.address)}`);
      } catch {
        summary.failed++;
      }
    }
  }
  summary.withoutLink = summary.total - summary.confirmed;
  try {
    fs.mkdirSync(path.dirname(RUN_INBOXES_FILE), { recursive: true });
    fs.writeFileSync(
      path.join(path.dirname(RUN_INBOXES_FILE), 'email-confirm-summary.json'),
      JSON.stringify(summary, null, 2),
      'utf8'
    );
  } catch {}
  console.log(`📧 [Email Sweep] Summary: ${summary.confirmed}/${summary.total} confirmed (without link: ${summary.withoutLink}).`);
  return summary;
}

module.exports = {
  resetRunInboxFile,
  confirmRunInboxes,
  resolveTargetUrl,
  executeTaskSteps,
};
