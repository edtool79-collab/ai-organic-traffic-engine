const { chromium } = require('playwright');
const { assertSafeOutboundUrl } = require('./safeOutbound');

function resolveInspectTargetUrl(rawTargetUrl, pagePath = '/') {
  const baseStr = String(rawTargetUrl || '').trim();
  const pathStr = String(pagePath || '/').trim() || '/';

  if (/^https?:\/\//i.test(pathStr)) {
    return new URL(pathStr);
  }
  const base = new URL(baseStr);
  if (!['http:', 'https:'].includes(base.protocol)) {
    throw new Error('Target URL must start with http:// or https://');
  }
  const baseNormalized = base.pathname && base.pathname !== '/' ? base.pathname.replace(/\/$/, '') : '';
  const rel = pathStr.startsWith('/') ? pathStr : '/' + pathStr;
  return new URL(`${base.origin}${baseNormalized}${rel}`);
}

function isDisallowedPrivateHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '127.0.0.1') return false;
  if (host === '0.0.0.0' || host === '::1') return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  return false;
}

/**
 * Loads a single page in headless Chromium and maps every visible interactive element,
 * section, input, link, and ad slot along with a verified CSS selector.
 */
async function inspectPageElements({ targetUrl, pagePath = '/' }) {
  const finalUrlObj = resolveInspectTargetUrl(targetUrl, pagePath);
  if (!['http:', 'https:'].includes(finalUrlObj.protocol)) {
    throw new Error('Only http:// or https:// URLs can be inspected');
  }
  const allowedLoopbackPort = parseInt(process.env.DASHBOARD_PORT || '4310', 10);
  await assertSafeOutboundUrl(finalUrlObj.toString(), { allowLoopbackPorts: [allowedLoopbackPort] });

  const finalUrl = finalUrlObj.toString();
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: false,
    });
    const page = await context.newPage();

    let status = 0;
    try {
      const resp = await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      status = resp ? resp.status() : 0;
    } catch (err) {
      throw new Error(`Page load failed (${err.message})`);
    }

    await page.waitForTimeout(900);

    const mapped = await page.evaluate(() => {
      const adContainerSelector = [
        'aside.ad-slot-box',
        '.ad-slot-box',
        '.ad-container.sponsored-ad',
        '[data-ad-slot-id]',
        '[data-ad-position]',
        'ins.adsbygoogle',
        '.adsbygoogle',
        '.ad-overlay-unit',
        '[id^="hilltopads"]',
        '[id^="google_ads_iframe"]',
        '[id^="aswift_"]',
      ].join(', ');

      const adLinkSelector = 'a.smartlink-btn, [data-lab-outbound="1"], a[rel*="sponsored"]';

      function isVisible(el) {
        if (!el || !el.isConnected) return false;
        const closedDetails = el.closest('details:not([open])');
        if (closedDetails && !el.closest('summary')) return false;
        const style = window.getComputedStyle(el);
        if (!style || style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') <= 0) {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width >= 2 && rect.height >= 2;
      }

      function safeAttrEscape(val) {
        return String(val || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      }

      function matchesAsPrimaryVisible(selector, targetEl) {
        try {
          const all = Array.from(document.querySelectorAll(selector));
          if (all.length === 1 && all[0] === targetEl) return true;
          const visibleOnes = all.filter(isVisible);
          return visibleOnes.length > 0 && visibleOnes[0] === targetEl;
        } catch {
          return false;
        }
      }

      function getScopePrefix(el) {
        let cur = el.parentElement;
        for (let depth = 0; cur && cur !== document.body && depth < 4; depth++, cur = cur.parentElement) {
          if (cur.id) return `#${CSS.escape(cur.id)}`;
          const tag = cur.tagName.toLowerCase();
          if (tag === 'nav' || tag === 'header' || tag === 'footer' || tag === 'main') {
            const firstCls = Array.from(cur.classList).find(c => /^[a-zA-Z_-][a-zA-Z0-9_-]{1,35}$/.test(c));
            return firstCls ? `${tag}.${CSS.escape(firstCls)}` : tag;
          }
        }
        return '';
      }

      function buildDomPathSelector(el) {
        const parts = [];
        let cur = el;
        while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
          if (cur.id) {
            const idSel = `#${CSS.escape(cur.id)}`;
            parts.unshift(idSel);
            const candidate = parts.join(' > ');
            if (matchesAsPrimaryVisible(candidate, el)) return candidate;
          }
          const tag = cur.tagName.toLowerCase();
          let nth = 1;
          let sib = cur.previousElementSibling;
          while (sib) {
            if (sib.tagName === cur.tagName) nth++;
            sib = sib.previousElementSibling;
          }
          parts.unshift(`${tag}:nth-of-type(${nth})`);
          const candidate = parts.join(' > ');
          if (matchesAsPrimaryVisible(candidate, el)) return candidate;
          cur = cur.parentElement;
        }
        return parts.join(' > ');
      }

      function buildBestSelector(el) {
        if (!el) return '';
        if (el.id) {
          const idSel = `#${CSS.escape(el.id)}`;
          if (matchesAsPrimaryVisible(idSel, el)) return idSel;
        }

        const tag = el.tagName.toLowerCase();
        const attrKeys = ['data-ad-position', 'data-ad-slot-id', 'data-testid', 'data-platform', 'data-tz', 'name'];
        for (const attr of attrKeys) {
          const v = el.getAttribute(attr);
          if (v && v.length <= 120) {
            const attrSel = `${tag}[${attr}="${safeAttrEscape(v)}"]`;
            if (matchesAsPrimaryVisible(attrSel, el)) return attrSel;
          }
        }

        if (tag === 'a') {
          const rawHref = el.getAttribute('href') || '';
          if (rawHref && !rawHref.startsWith('javascript:') && rawHref.length <= 220) {
            const hrefSel = `a[href="${safeAttrEscape(rawHref)}"]`;
            if (matchesAsPrimaryVisible(hrefSel, el)) return hrefSel;
            const prefix = getScopePrefix(el);
            if (prefix) {
              const scopedSel = `${prefix} ${hrefSel}`;
              if (matchesAsPrimaryVisible(scopedSel, el)) return scopedSel;
            }
          }
        }

        if (tag === 'button' && el.getAttribute('type')) {
          const typeSel = `button[type="${safeAttrEscape(el.getAttribute('type'))}"]`;
          if (matchesAsPrimaryVisible(typeSel, el)) return typeSel;
        }

        if (['header', 'nav', 'main', 'footer', 'article'].includes(tag)) {
          if (matchesAsPrimaryVisible(tag, el)) return tag;
        }

        return buildDomPathSelector(el);
      }

      function cleanText(el, max = 68) {
        const raw = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ');
        return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
      }

      function isInsideAd(el) {
        return Boolean(el.closest(adContainerSelector) || el.closest(adLinkSelector));
      }

      const seenSelectors = new Set();
      function takeUnique(selector) {
        if (!selector || seenSelectors.has(selector)) return false;
        seenSelectors.add(selector);
        return true;
      }

      const buttons = [];
      for (const el of document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], summary')) {
        if (buttons.length >= 45) break;
        if (!isVisible(el) || isInsideAd(el)) continue;
        const selector = buildBestSelector(el);
        if (!takeUnique(selector)) continue;
        const rect = el.getBoundingClientRect();
        buttons.push({
          category: 'button',
          tag: el.tagName.toLowerCase(),
          text: cleanText(el) || selector,
          selector,
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
        });
      }

      const links = [];
      for (const el of document.querySelectorAll('a[href]')) {
        if (links.length >= 60) break;
        if (!isVisible(el) || isInsideAd(el)) continue;
        const rawHref = (el.getAttribute('href') || '').trim();
        if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:')) continue;
        const selector = buildBestSelector(el);
        if (!takeUnique(selector)) continue;
        let external = false;
        let resolvedPath = rawHref;
        try {
          const u = new URL(rawHref, window.location.href);
          external = u.origin !== window.location.origin;
          resolvedPath = external ? u.href : (u.pathname + u.search);
        } catch {}
        links.push({
          category: 'link',
          tag: 'a',
          text: cleanText(el) || resolvedPath,
          href: resolvedPath,
          external,
          targetBlank: (el.getAttribute('target') || '').toLowerCase() === '_blank',
          selector,
        });
      }

      const inputs = [];
      for (const el of document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select')) {
        if (inputs.length >= 30) break;
        if (!isVisible(el) || isInsideAd(el)) continue;
        const selector = buildBestSelector(el);
        if (!takeUnique(selector)) continue;
        const tag = el.tagName.toLowerCase();
        const type = tag === 'input' ? (el.getAttribute('type') || 'text') : tag;
        const options = tag === 'select'
          ? Array.from(el.options).slice(0, 6).map(o => o.value || o.textContent.trim()).filter(Boolean)
          : [];
        inputs.push({
          category: 'input',
          tag,
          inputType: type,
          label: cleanText(el) || el.getAttribute('name') || el.id || type,
          placeholder: (el.getAttribute('placeholder') || '').slice(0, 60),
          options,
          selector,
        });
      }

      const sections = [];
      for (const el of document.querySelectorAll('header, nav, main, section, article, footer, dialog, [role="dialog"], aside:not(.ad-slot-box)')) {
        if (sections.length >= 25) break;
        if (!isVisible(el) || isInsideAd(el)) continue;
        const selector = buildBestSelector(el);
        if (!takeUnique(selector)) continue;
        const heading = el.querySelector('h1, h2, h3');
        const label = heading ? cleanText(heading, 55) : cleanText(el, 55);
        const rect = el.getBoundingClientRect();
        sections.push({
          category: 'section',
          tag: el.tagName.toLowerCase(),
          label: label || `<${el.tagName.toLowerCase()}>`,
          selector,
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
        });
      }

      const adSlots = [];
      for (const el of document.querySelectorAll(adContainerSelector)) {
        if (adSlots.length >= 20) break;
        const rect = el.getBoundingClientRect();
        const visible = isVisible(el);
        const selector = el.getAttribute('data-ad-position')
          ? `${el.tagName.toLowerCase()}[data-ad-position="${safeAttrEscape(el.getAttribute('data-ad-position'))}"]`
          : buildBestSelector(el);
        if (!takeUnique('ad:' + selector)) continue;
        adSlots.push({
          category: 'ad',
          isAd: true,
          tag: el.tagName.toLowerCase(),
          position: el.getAttribute('data-ad-position') || el.getAttribute('data-ad-slot-id') || el.id || 'ad-unit',
          status: el.getAttribute('data-ad-status') || (visible ? 'visible' : 'hidden'),
          visible,
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          selector,
        });
      }

      return {
        url: window.location.href,
        title: document.title || '',
        buttons,
        links,
        inputs,
        sections,
        adSlots,
      };
    });

    return {
      status,
      url: mapped.url,
      title: mapped.title,
      summary: {
        buttons: mapped.buttons.length,
        links: mapped.links.length,
        inputs: mapped.inputs.length,
        sections: mapped.sections.length,
        adSlots: mapped.adSlots.length,
      },
      elements: {
        buttons: mapped.buttons,
        links: mapped.links,
        inputs: mapped.inputs,
        sections: mapped.sections,
        adSlots: mapped.adSlots,
      },
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  inspectPageElements,
  resolveInspectTargetUrl,
  isDisallowedPrivateHost,
};
