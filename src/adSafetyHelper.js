/**
 * Ad-safety & telemetry controls matching CleanTab Lab / Ad-Safe QA spec:
 * 1. Origin-scoped custom headers (e.g. X-Lab-Skip-Telemetry: 1 only on target origin).
 * 2. Popunder / new tab blocker so OnClick zone popups close silently.
 * 3. Blocking overlay dismisser (Monetag Vignette Close / Push Hide) before site UI clicks.
 * 4. Strict zero-click exclusion selector list for organic traffic simulation.
 * 5. Read-only ad slot & creative DOM auditor.
 */

const AD_SAFE_EXCLUSION_SELECTOR = [
  '.ad-slot-box',
  '.ad-slot-box *',
  '.ad-container.sponsored-ad',
  '.ad-container.sponsored-ad *',
  '[data-ad-slot-id]',
  '[data-ad-slot-id] *',
  '[data-ad-status="active"]',
  '[data-ad-status="active"] *',
  'a.smartlink-btn',
  '[data-lab-outbound="1"]',
  'a[rel*="sponsored"]',
  '.ad-overlay-unit',
  '.ad-overlay-unit *',
  'ins.adsbygoogle',
  'ins.adsbygoogle *',
  '.adsbygoogle',
  '.adsbygoogle *',
  '[id^="google_ads_iframe"]',
  '[id^="aswift_"]',
  '[data-ad-slot]',
  '[data-ad-slot] *',
  '#google_vignette_container',
  '#google_vignette_container *',
  '[aria-label*="advertisement" i]',
  '[aria-label*="advertisement" i] *',
  'iframe',
].join(', ');

const installedHeaderContexts = new WeakSet();

async function applyOriginScopedHeaders(context, targetUrl, extraHeaders) {
  if (!context || !targetUrl || !extraHeaders || !Object.keys(extraHeaders).length) return;
  if (installedHeaderContexts.has(context)) return;

  let targetOrigin = '';
  try {
    targetOrigin = new URL(targetUrl).origin;
  } catch {
    return;
  }

  installedHeaderContexts.add(context);
  await context.route('**/*', route => {
    const req = route.request();
    try {
      const reqOrigin = new URL(req.url()).origin;
      if (reqOrigin === targetOrigin) {
        return route.fallback({
          headers: { ...req.headers(), ...extraHeaders },
        });
      }
    } catch {}
    return route.fallback();
  }).catch(() => {});
}

function buildAdSafetyHeaders(adSafetyCfg) {
  const headers = {};
  if (adSafetyCfg?.skipTelemetryHeader) {
    headers['x-lab-skip-telemetry'] = '1';
  }
  return headers;
}

function ensureScenarioPageSet(context) {
  if (!context) return null;
  if (!context.__wtgScenarioPages) {
    context.__wtgScenarioPages = new WeakSet();
  }
  return context.__wtgScenarioPages;
}

function registerScenarioPage(pageObj, holdPopupMs = 0) {
  if (!pageObj) return;
  try {
    const context = pageObj.context();
    const set = ensureScenarioPageSet(context);
    if (set) set.add(pageObj);
    if (holdPopupMs > 0) {
      context.__wtgAllowPopupUntil = Math.max(context.__wtgAllowPopupUntil || 0, Date.now() + holdPopupMs);
    }
  } catch {}
}

function isAllowedScenarioPage(context, newPage) {
  if (!context) return false;
  if (context.__wtgScenarioPages && context.__wtgScenarioPages.has(newPage)) return true;
  if (context.__wtgCreatingScenarioPage) return true;
  if (context.__wtgAllowPopupUntil && Date.now() < context.__wtgAllowPopupUntil) return true;
  return false;
}

function installPopunderShield(context, primaryPage, enabled, onLog) {
  if (!enabled || (!context && !primaryPage)) return () => {};
  const emit = msg => { if (typeof onLog === 'function') onLog(msg); };
  const handledPopups = new WeakSet();
  if (primaryPage) registerScenarioPage(primaryPage);

  const handlePopupPage = async newPage => {
    if (!newPage || newPage === primaryPage || handledPopups.has(newPage)) return;
    if (isAllowedScenarioPage(context, newPage)) {
      registerScenarioPage(newPage);
      return;
    }
    handledPopups.add(newPage);
    try {
      const url = newPage.url();
      if (primaryPage && !primaryPage.isClosed()) {
        await primaryPage.bringToFront().catch(() => {});
      }
      // Allow playwright-extra stealth onPageCreated hooks to settle before closing popup tab
      await new Promise(r => setTimeout(r, 850));
      if (isAllowedScenarioPage(context, newPage)) {
        registerScenarioPage(newPage);
        return;
      }
      if (!newPage.isClosed()) {
        await newPage.close().catch(() => {});
      }
      const shortUrl = url && url.length > 90 ? `${url.slice(0, 90)}...` : (url || 'about:blank');
      emit(`[Popunder Shield] נסגר טאב פופ-אפ / OnClick אוטומטי (${shortUrl})`);
    } catch {}
  };

  if (context) context.on('page', handlePopupPage);
  if (primaryPage) primaryPage.on('popup', handlePopupPage);

  return () => {
    if (context) context.off('page', handlePopupPage);
    if (primaryPage) primaryPage.off('popup', handlePopupPage);
  };
}

async function dismissBlockingOverlays(page, onLog, targetSelector = null) {
  const emit = msg => { if (typeof onLog === 'function') onLog(msg); };
  let dismissedCount = 0;

  try {
    const overlays = await page.locator('.ad-overlay-unit[data-ad-status="active"], div[id*="vignette"], div[class*="vignette"]').all().catch(() => []);
    for (const overlay of overlays) {
      const visible = await overlay.isVisible().catch(() => false);
      if (!visible) continue;
      const name = await overlay.getAttribute('data-lab-overlay').catch(() => null)
        || await overlay.getAttribute('id').catch(() => null)
        || 'overlay';

      const candidates = [
        overlay.locator('#dismiss-button, [aria-label="Close ad" i], [aria-label*="close" i], [aria-label*="hide" i]').first(),
        overlay.locator('button, a, [role="button"]').filter({ hasText: /^(close|hide|skip|dismiss|סגור|הסתר|×|✕)$/i }).first(),
        overlay.locator('[class*="close" i], [class*="hide" i]').first(),
        overlay.getByText(/^(Close|Hide)$/i).first(),
      ];

      for (const btn of candidates) {
        const canClick = await btn.isVisible().catch(() => false);
        if (canClick) {
          await btn.click({ timeout: 2000 }).catch(() => {});
          dismissedCount++;
          emit(`[Overlay Shield] הוסרה שכבת פרסומת (${name}) לפני לחיצה באתר`);
          break;
        }
      }
    }

    // Check child iframes strictly for genuine close/dismiss controls (never clicking ad bodies)
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      // Attribution fix #5: locker iframes belong to the conversion flow — never close them
      if (/cpld|locker|content[_-]?lock|lck/i.test(frame.url())) continue;
      const closeBtn = frame.locator('#dismiss-button, [aria-label="Close ad" i], [aria-label*="close ad" i], button:has-text("Close"), button:has-text("Skip")').first();
      const visible = await closeBtn.isVisible().catch(() => false);
      if (visible) {
        await closeBtn.click({ timeout: 1500 }).catch(() => {});
        dismissedCount++;
        emit('[Overlay Shield] נסגר חלון פרסומת צף מתוך iframe (Close)');
      }
    }

    // Layer 2 & 3: Neutralize floating external iframes / high-z-index interceptors outside .ad-overlay-unit
    const neutralized = await page.evaluate(sel => {
      const removed = [];
      let targetEl = null;
      if (sel && !/^(text|role|xpath|css)=/i.test(sel) && !sel.includes(':has-text(')) {
        try {
          targetEl = document.querySelector(sel);
        } catch {}
      }

      const SEMANTIC_TAGS = new Set([
        'HEADER', 'MAIN', 'NAV', 'FOOTER', 'SECTION', 'ARTICLE',
        'FORM', 'SUMMARY', 'DETAILS', 'P', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI',
      ]);

      // Attribution fix #5: locker/offer-wall surfaces must never be treated as ad overlays
      const isLockerSurface = el => {
        try {
          const sig = `${el.id || ''} ${el.className || ''} ${el.getAttribute('data-cpld') || ''}`.toLowerCase();
          if (/(?:cpld|lck|locker|content[_-]?lock|cp[_-]?lead|cpalead|offer[_-]?wall|unlock|download[_-]?lock)/i.test(sig)) return true;
          if (el.querySelector && el.querySelector('#cpld_lck_close_btn, iframe[src*="locker"], a[href*="view.php"], a[href*="click_id"], a[href*="clickid"]')) return true;
        } catch {}
        return false;
      };

      const isSafeToHide = el => {
        if (!el || el === document.body || el === document.documentElement) return false;
        // Attribution fix #5: NEVER neutralize the site's own download/offer lockers —
        // they are the affiliate conversion surface (cpld lockers embed the offer wall).
        if (isLockerSurface(el)) return false;
        if (targetEl && (el === targetEl || el.contains(targetEl) || targetEl.contains(el))) return false;
        if (SEMANTIC_TAGS.has(el.tagName) && !el.classList?.contains('ad-overlay-unit')) return false;
        if (el.closest && el.closest('header, nav') && !el.closest('.ad-overlay-unit')) return false;
        if (el.querySelector && el.querySelector('main, nav, header, form, #lc-clean, #pf-build, #pe-gen, #store, #check-anonymous')) return false;
        return true;
      };

      const isFloatingInterceptor = el => {
        if (!el || el === document.body || el === document.documentElement) return false;
        if (el.tagName === 'IFRAME' || el.classList?.contains('ad-overlay-unit')) return true;
        const cs = getComputedStyle(el);
        const z = parseInt(cs.zIndex, 10) || 0;
        return cs.position === 'fixed' || (cs.position === 'absolute' && z >= 50) || z >= 900;
      };

      // CSP-safe removal/hiding: never mutate inline el.style (avoids triggering style-src CSP violations & securitypolicyviolation events)
      const hideEl = (el, reason) => {
        try { el.hidden = true; } catch {}
        try { el.setAttribute('inert', ''); } catch {}
        try { el.setAttribute('aria-hidden', 'true'); } catch {}
        try {
          if (getComputedStyle(el).display !== 'none' || el.tagName === 'IFRAME') {
            el.remove();
          }
        } catch {}
        removed.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} (${reason})`);
      };

      // A) Direct hit test over the element we want to click/fill
      if (targetEl) {
        try {
          targetEl.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
        } catch {}
        for (let attempt = 0; attempt < 4; attempt++) {
          const r = targetEl.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) break;
          const cx = Math.min(window.innerWidth - 2, Math.max(2, r.left + r.width / 2));
          const cy = Math.min(window.innerHeight - 2, Math.max(2, r.top + r.height / 2));
          const topEl = document.elementFromPoint(cx, cy);
          if (!topEl || topEl === targetEl || targetEl.contains(topEl) || topEl.contains(targetEl)) break;

          let victim = topEl;
          while (victim.parentElement && victim.parentElement !== document.body && victim.parentElement !== document.documentElement) {
            if (!isSafeToHide(victim.parentElement)) break;
            const pcs = getComputedStyle(victim.parentElement);
            if (pcs.position === 'fixed' || pcs.position === 'absolute' || Number(pcs.zIndex) >= 50) {
              victim = victim.parentElement;
            } else {
              break;
            }
          }
          if (!isSafeToHide(victim) || !isFloatingInterceptor(victim)) break;
          hideEl(victim, 'interceptor');
        }
      }

      // B) Any floating fixed high-z-index iframe or external overlay covering the viewport
      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 720;
      const fixedCandidates = Array.from(document.querySelectorAll('body > iframe, html > iframe, body > div, div[style*="z-index"], iframe[style*="z-index"]'));
      for (const el of fixedCandidates) {
        if (!isSafeToHide(el)) continue;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
        // Preserve decorative background stages (e.g. aria-hidden canvas stages that do not hold ad units/frames)
        if (el.getAttribute('aria-hidden') === 'true' && !el.classList.contains('ad-overlay-unit') && !el.querySelector('iframe, a[href], button')) continue;
        const z = parseInt(cs.zIndex, 10) || 0;
        const isAdFrame = el.tagName === 'IFRAME' && (cs.position === 'fixed' || z >= 900 || (r.width >= vw * 0.45 && r.height >= vh * 0.45));
        const isAdWrap = el.classList.contains('ad-overlay-unit') || ((cs.position === 'fixed' || z >= 2147483000) && !el.closest('header, nav, main, footer'));
        const coversCenter = r.left <= vw / 2 && r.right >= vw / 2 && r.top <= vh / 2 && r.bottom >= vh / 2;
        if (isAdFrame || (isAdWrap && (coversCenter || z >= 99999))) {
          hideEl(el, 'floating-overlay');
        }
      }

      return removed;
    }, targetSelector).catch(() => []);

    if (Array.isArray(neutralized) && neutralized.length) {
      dismissedCount += neutralized.length;
      emit(`[Overlay Shield] נוטרלו ${neutralized.length} שכבות iframe/overlay שחסמו לחיצה: ${neutralized.join(', ')}`);
    }
  } catch {}

  return dismissedCount;
}

/**
 * Strictly zero-click audit of page ad architecture (meta tags, slots, iframes, native bar, overlays, Google AdSense).
 */
async function auditAdPlacements(page) {
  return page.evaluate(() => {
    const metaEl = document.querySelector('meta[name="ad-lab-active-slots"]');
    const metaContent = metaEl ? metaEl.getAttribute('content') || '' : null;

    const slotEls = Array.from(document.querySelectorAll('aside.ad-slot-box[data-ad-status="active"], .ad-container.sponsored-ad[data-ad-slot-id]'));
    const slots = slotEls.map(el => {
      const box = el.getBoundingClientRect();
      const iframe = el.querySelector('iframe');
      const ir = iframe ? iframe.getBoundingClientRect() : null;
      const smartlink = el.querySelector('a.smartlink-btn[data-lab-outbound="1"]');
      const nativeRoot = el.querySelector('#container-6c624644ee2e8dac6a0f4c2b841fe4d0');
      const labelEl = el.querySelector('.ad-slot-label');

      return {
        position: el.getAttribute('data-ad-position') || 'unknown',
        slotId: el.getAttribute('data-ad-slot-id') || 'unknown',
        network: el.getAttribute('data-ad-network') || 'unknown',
        visible: box.width > 0 && box.height > 0,
        boxSize: `${Math.round(box.width)}x${Math.round(box.height)}`,
        iframeSize: ir ? `${Math.round(ir.width)}x${Math.round(ir.height)}` : null,
        hasLabel: Boolean(labelEl && /SPONSORED AD/i.test(labelEl.textContent || '')),
        smartlinkHref: smartlink ? smartlink.getAttribute('href') : null,
        nativeCardsCount: nativeRoot ? nativeRoot.children.length : null,
      };
    });

    const adsenseEls = Array.from(document.querySelectorAll('ins.adsbygoogle'));
    const adsenseSlots = adsenseEls.map((el, i) => {
      const box = el.getBoundingClientRect();
      return {
        index: i + 1,
        slot: el.getAttribute('data-ad-slot') || 'auto',
        status: el.getAttribute('data-ad-status') || el.getAttribute('data-adsbygoogle-status') || 'present',
        visible: box.width > 0 && box.height > 0,
        boxSize: `${Math.round(box.width)}x${Math.round(box.height)}`,
      };
    });

    const overlays = Array.from(document.querySelectorAll('.ad-overlay-unit[data-ad-status="active"][data-lab-overlay]')).map(el => {
      const r = el.getBoundingClientRect();
      return {
        overlay: el.getAttribute('data-lab-overlay'),
        visible: r.width > 0 && r.height > 0,
      };
    });

    return {
      url: location.pathname + location.search,
      metaSlotsCount: metaContent ? metaContent.split(',').filter(Boolean).length : 0,
      metaSlots: metaContent,
      slotsFound: slots.length,
      slots,
      adsenseCount: adsenseSlots.length,
      adsenseSlots,
      overlaysFound: overlays.length,
      overlays,
    };
  });
}

module.exports = {
  AD_SAFE_EXCLUSION_SELECTOR,
  applyOriginScopedHeaders,
  buildAdSafetyHeaders,
  registerScenarioPage,
  installPopunderShield,
  dismissBlockingOverlays,
  auditAdPlacements,
};
