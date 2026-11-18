'use strict';
/**
 * Target preflight — classifies a URL by which gate, if any, blocks it.
 *
 * The measured problem (see brain://cloudflare-gate-findings.md): a shortlink funnel can sit behind
 * two independent gates. Mixing them into one "failed" bucket makes every report unreadable, so this
 * module returns one of four explicit verdicts:
 *
 *   open            page loaded and no verification gate was observed
 *   cf_interstitial Cloudflare's own domain-level challenge page ("Just a moment...") — decided by
 *                   IP/ASN reputation, before the site's markup is ever served
 *   site_tick       the target's own interactive Turnstile ("Tick the box") — renders, token stays
 *                   empty, CONTINUE stays disabled until a real interaction happens
 *   unknown         neither pattern matched; the caller should look at the returned raw snapshot
 *
 * Read-only: it navigates once, observes, screenshots, and closes. It never submits, never clicks a
 * challenge widget, and never injects a token.
 */

const { getLauncher, getChromiumStealthArgs, getNativeChromeUserAgent } = require('./fingerprintManager');
const { toPlaywrightProxy } = require('./proxyManager');

const CF_TITLE_RE = /just a moment|attention required|verifying you are human/i;
const CF_BODY_RE = /performing security verification|security service to protect against malicious bots|checking (if the site connection is secure|your browser)|verify you are human by completing|ray id:/i;
const SITE_TICK_RE = /tick the box|check you['’]re human|tick the checkbox|complete the (security )?check/i;

function classifySnapshot({ url, status, title, body, hasWidget, tokenLen }) {
  const t = String(title || '');
  const b = String(body || '');
  // A redirect chain can end on a host that no longer exists. Chrome then paints its own error
  // page, which still reports the status of the FIRST response — so without this check a dead
  // funnel looks like a clean `open`.
  if (/^chrome-error:\/\//i.test(String(url || '')) || /ERR_[A-Z_]+|can't be reached|לא ניתן לגשת|net::ERR_/i.test(b)) return 'dead';
  if (CF_TITLE_RE.test(t) || (CF_BODY_RE.test(b) && !SITE_TICK_RE.test(b))) return 'cf_interstitial';
  if (SITE_TICK_RE.test(b)) return 'site_tick';
  if (status >= 200 && status < 400 && !hasWidget) return 'open';
  if (hasWidget && tokenLen === 0) return 'site_tick';
  return 'unknown';
}

async function snapshot(page) {
  return page.evaluate(() => {
    const tok = document.querySelector('[name="cf-turnstile-response"]');
    const widget = document.querySelector('[id^="cf-chl-widget"]')
      || document.querySelector('iframe[src*="challenges.cloudflare.com"]')
      || document.querySelector('.cf-turnstile, [class*="turnstile"]');
    const body = document.body ? document.body.innerText : '';
    return {
      url: location.href,
      title: document.title,
      tokenLen: tok ? String(tok.value || '').length : -1,
      hasWidget: !!widget,
      hasTurnstileApi: typeof window.turnstile !== 'undefined',
      body: String(body || '').replace(/\s+/g, ' ').slice(0, 400),
    };
  });
}

/**
 * @param {object} opts
 * @param {string} opts.url            target to classify
 * @param {string|null} [opts.proxyUrl] full proxy URL; omit/null for a direct connection
 * @param {number} [opts.waitMs=12000] settle time after navigation
 * @param {boolean} [opts.headless=false]
 * @param {boolean} [opts.screenshot=false] write a PNG next to the caller
 */
async function classify(opts = {}) {
  const url = opts.url;
  if (!url) throw new Error('url is required');
  const waitMs = Number(opts.waitMs || 12000);
  const headless = opts.headless === true;
  const proxy = opts.proxyUrl ? toPlaywrightProxy(opts.proxyUrl) : undefined;
  const launcher = getLauncher('chromium');
  const args = getChromiumStealthArgs(false, { stealthMode: 'standard', proxied: !!proxy });

  let browser;
  try {
    browser = await launcher.launch({ headless, args, proxy, channel: 'chrome' });
  } catch {
    browser = await launcher.launch({ headless, args, proxy });
  }

  const out = { url, proxy: proxy ? proxy.server : 'direct', at: new Date().toISOString() };
  try {
    const major = (String(browser.version()).match(/^(\d+)/) || [])[1] || '';
    const ua = getNativeChromeUserAgent(true).replace(/Chrome\/\d+\.\d+\.\d+\.\d+/, `Chrome/${major}.0.0.0`);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      userAgent: ua,
    });
    const page = await context.newPage();
    const gateHits = [];
    page.on('response', r => {
      const u = r.url();
      if (isTurnstileTest(u)) {
        gateHits.push(`${r.status()} ${u.slice(0, 90)}`);
      }
    });

    let status = null;
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      status = resp ? resp.status() : null;
    } catch (e) {
      out.navError = String(e.message).slice(0, 200);
    }

    // Settle by polling, not by sleeping a fixed amount: Cloudflare's managed challenge resolves on
    // its own often enough that a single fixed wait either wastes time or reports a false failure.
    // We only ever OBSERVE here — no input is dispatched and the widget is never driven.
    const settleMs = Number(opts.settleMs || waitMs);
    const started = Date.now();
    let snap = null;
    let firstVerdict = null;
    let resolvedAtMs = null;
    for (;;) {
      snap = await snapshot(page).catch(e => ({ error: String(e.message).slice(0, 160) }));
      const v = classifySnapshot({
        url: snap.url,
        status,
        title: snap.title,
        body: snap.body,
        hasWidget: snap.hasWidget,
        tokenLen: snap.tokenLen,
      });
      if (firstVerdict === null) firstVerdict = v;
      if (v === 'open' && firstVerdict !== 'open') { resolvedAtMs = Date.now() - started; break; }
      if (Date.now() - started >= settleMs) break;
      await page.waitForTimeout(1000);
    }

    const verdict = classifySnapshot({
      url: snap.url,
      status,
      title: snap.title,
      body: snap.body,
      hasWidget: snap.hasWidget,
      tokenLen: snap.tokenLen,
    });

    out.status = status;
    out.finalUrl = snap.url;
    out.title = snap.title;
    out.tokenLen = snap.tokenLen;
    out.hasWidget = snap.hasWidget;
    out.hasTurnstileApi = snap.hasTurnstileApi;
    out.bodyExcerpt = snap.body;
    out.gateNetwork = gateHits.slice(0, 6);
    out.verdict = verdict;
    out.usable = verdict === 'open';
    // Observed challenge history. `solved` is only ever set when the page advanced on its own,
    // with no interaction from us — so a non-zero value here is a real measurement, not an estimate.
    out.challenge = {
      detected: firstVerdict === 'cf_interstitial' || firstVerdict === 'site_tick',
      kind: (firstVerdict === 'cf_interstitial' || firstVerdict === 'site_tick') ? firstVerdict : null,
      solved: resolvedAtMs !== null,
      solvedBy: resolvedAtMs !== null ? 'passive' : null,
      interactionRequired: verdict === 'site_tick',
      attempts: 0,
      settledMs: Date.now() - started,
    };

    if (opts.screenshotPath) {
      await page.screenshot({ path: opts.screenshotPath, timeout: 15000 }).catch(() => {});
    }
    await context.close().catch(() => {});
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return out;
}

// Small helper so the guard regex above stays readable.
function isTurnstileTest(u) {
  return /__cf_chl|cdn-cgi\/challenge-platform|challenges\.cloudflare/i.test(u);
}

module.exports = { classify, classifySnapshot };
