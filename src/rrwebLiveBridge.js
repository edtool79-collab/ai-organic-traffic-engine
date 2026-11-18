const fs = require('fs');
const path = require('path');

let cachedRrwebScript = null;
function getRrwebBrowserScript() {
  if (cachedRrwebScript !== null) return cachedRrwebScript;
  try {
    const pkgDir = path.dirname(require.resolve('rrweb/package.json'));
    const umdPath = path.join(pkgDir, 'dist', 'rrweb.umd.min.cjs');
    cachedRrwebScript = fs.readFileSync(umdPath, 'utf8');
  } catch {
    try {
      const fallbackPath = path.join(__dirname, '..', 'node_modules', 'rrweb', 'dist', 'rrweb.umd.min.cjs');
      cachedRrwebScript = fs.readFileSync(fallbackPath, 'utf8');
    } catch {
      cachedRrwebScript = '';
    }
  }
  return cachedRrwebScript;
}

function buildRrwebPageRecorderScript(rrwebUmd) {
  return `(() => {
    if (window !== window.top) return;
    if (window.__wtgRrwebStarted) return;
    window.__wtgRrwebStarted = true;
    ${rrwebUmd}
    if (!window.rrweb || typeof window.rrweb.record !== 'function') return;

    let queue = [];
    let flushTimer = null;
    const flush = () => {
      flushTimer = null;
      if (!queue.length) return;
      const batch = queue.splice(0, 40);
      try {
        if (typeof window.__wtgRrwebEmitBatch === 'function') {
          window.__wtgRrwebEmitBatch(batch);
        }
      } catch {}
      if (queue.length && !flushTimer) {
        flushTimer = setTimeout(flush, 180);
      }
    };

    try {
      window.rrweb.record({
        emit(event) {
          if (!event) return;
          queue.push(event);
          if (queue.length >= 25) {
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
            flush();
          } else if (!flushTimer) {
            flushTimer = setTimeout(flush, 250);
          }
        },
        sampling: {
          mousemove: 100,
          mouseInteraction: true,
          scroll: 150,
          media: 800,
          input: 'last',
        },
        maskAllInputs: true,
        slimDOMOptions: {
          script: true,
          comment: true,
          headFavicon: true,
          headWhitespace: true,
          headMetaDescKeywords: true,
          headMetaSocial: true,
          headMetaRobots: true,
          headMetaHttpEquiv: true,
          headMetaAuthorship: true,
          headMetaVerification: true,
        },
        inlineStylesheet: true,
        collectFonts: false,
      });
      window.addEventListener('pagehide', flush, { passive: true });
    } catch {}
  })();`;
}

/**
 * Attaches lightweight rrweb DOM streaming to a Playwright page for Live Preview.
 * Emits `{ type: 'rrweb_events', ... }` batches via `onFrame`, avoiding heavy JPEG screenshots.
 */
async function attachRrwebLiveStream(page, meta, onFrame) {
  if (!page || page.isClosed() || typeof onFrame !== 'function') return false;
  const rrwebUmd = getRrwebBrowserScript();
  if (!rrwebUmd) return false;

  page.__wtgRrwebMeta = { ...(page.__wtgRrwebMeta || {}), ...(meta || {}) };
  if (page.__wtgRrwebAttached) return true;
  page.__wtgRrwebAttached = true;

  try {
    await page.exposeFunction('__wtgRrwebEmitBatch', events => {
      if (!Array.isArray(events) || !events.length) return;
      const m = page.__wtgRrwebMeta || {};
      let currentUrl = '';
      try { currentUrl = page.url(); } catch {}
      onFrame({
        type: 'rrweb_events',
        visitIndex: m.visitIndex ?? 0,
        label: m.label || '',
        persona: m.persona || '',
        url: currentUrl,
        ts: new Date().toISOString(),
        events,
      });
    });
  } catch (err) {
    if (!String(err?.message || '').includes('already been registered')) {
      page.__wtgRrwebAttached = false;
      return false;
    }
  }

  const recorderScript = buildRrwebPageRecorderScript(rrwebUmd);
  try {
    await page.addInitScript(recorderScript);
  } catch {}
  try {
    await page.evaluate(recorderScript);
  } catch {}

  return true;
}

module.exports = {
  attachRrwebLiveStream,
};
