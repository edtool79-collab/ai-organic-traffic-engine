'use strict';

/**
 * Bot-check detector (detection only).
 *
 * The point of this module is reporting accuracy, not evasion: a visit that ends on a CAPTCHA is
 * not a successful visit, and "blocked by the site" and "our fingerprint failed" are two different
 * facts. Detection is a DOM read — it never solves, clicks, or submits anything.
 *
 * In scope: reCAPTCHA v2, Cloudflare Turnstile, hCaptcha, and Cloudflare interstitial pages.
 * Out of scope (no reliable DOM signal / no token to inspect): reCAPTCHA v3, Arkose, DataDome.
 */

const TYPES = [
  {
    id: 'turnstile',
    label: 'Cloudflare Turnstile',
    sel: [
      'input[name="cf-turnstile-response"]',
      '.cf-turnstile',
      '[id^="cf-chl-widget"]',
      'iframe[src*="challenges.cloudflare.com"]',
    ],
  },
  {
    id: 'recaptcha_v2',
    label: 'reCAPTCHA v2',
    sel: [
      '.g-recaptcha',
      'textarea[name="g-recaptcha-response"]',
      'iframe[src*="recaptcha/api2"]',
      'iframe[title*="reCAPTCHA"]',
    ],
  },
  {
    id: 'hcaptcha',
    label: 'hCaptcha',
    sel: [
      '.h-captcha',
      'textarea[name="h-captcha-response"]',
      'iframe[src*="hcaptcha.com"]',
    ],
  },
];

// Response fields whose filled-in value means the visitor already passed the check.
const RESPONSE_FIELDS = ['cf-turnstile-response', 'g-recaptcha-response', 'h-captcha-response'];

/**
 * Reads the current document and reports whether a bot check is in front of the visitor.
 * Never throws: a navigation race or a detached frame is reported as "not detected".
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{detected: boolean, types: string[], labels: string[], interstitial: boolean, solved: boolean, title: string}>}
 */
async function detectChallenge(page) {
  const empty = { detected: false, types: [], labels: [], interstitial: false, solved: false, title: '' };
  if (!page || (typeof page.isClosed === 'function' && page.isClosed())) return empty;
  try {
    const result = await page.evaluate(({ groups, fields }) => {
      const hits = [];
      for (const group of groups) {
        for (const sel of group.sel) {
          try {
            if (document.querySelector(sel)) { hits.push(group.id); break; }
          } catch {}
        }
      }
      let solved = false;
      for (const name of fields) {
        const el = document.querySelector(`[name="${name}"]`);
        if (el && String(el.value || '').length > 20) solved = true;
      }
      const bodyText = document.body ? String(document.body.innerText || '') : '';
      return {
        types: hits,
        solved,
        interstitial: /just a moment|checking your browser|verify you are human|check you're human|attention required|enable javascript and cookies/i.test(bodyText),
        title: document.title || '',
      };
    }, { groups: TYPES.map(t => ({ id: t.id, sel: t.sel })), fields: RESPONSE_FIELDS });

    const types = Array.isArray(result.types) ? result.types : [];
    const detected = types.length > 0 || Boolean(result.interstitial);
    return {
      detected,
      types,
      labels: TYPES.filter(t => types.includes(t.id)).map(t => t.label),
      interstitial: Boolean(result.interstitial),
      solved: Boolean(result.solved),
      title: result.title || '',
    };
  } catch {
    return empty;
  }
}

/** Stable one-line summary for logs/reports. */
function describeChallenge(found) {
  if (!found || !found.detected) return 'none';
  const parts = [];
  if (found.types && found.types.length) parts.push(found.types.join('+'));
  if (found.interstitial) parts.push('interstitial');
  return `${parts.join(',')}${found.solved ? ' (token present)' : ''}`;
}

module.exports = {
  TYPES,
  detectChallenge,
  describeChallenge,
  RESPONSE_FIELDS,
};
