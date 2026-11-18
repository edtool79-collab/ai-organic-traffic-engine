'use strict';

/**
 * Camoufox engine adapter.
 *
 * Camoufox is a patched Firefox build (fingerprint spoofing happens in the C++ engine layer,
 * not by injecting JS). This module exposes a `launch()` with the same shape the shared-browser
 * pool in fingerprintManager expects, so `getLauncher('camoufox')` can return it directly.
 *
 * Verified on this machine (2026-11-17):
 *   - camoufox@0.5.9 + FireFox 158.0.1-beta.41 installed via `npx camoufox fetch`
 *   - launch works, navigator.webdriver === false
 *   - per-context proxy is accepted by `browser.newContext({ proxy })` on Firefox
 *     (so the proxy round-robin per visit keeps working)
 *
 * Deliberate omissions:
 *   - no Chromium stealth args (they are meaningless / harmful for a Firefox build)
 *   - no browser-level proxy: `{ server: 'http://per-context' }` is a Chromium-only hack and
 *     would be passed straight to the Firefox launcher, breaking every visit
 *   - no `geoip` at launch: it is launch-level only, while our proxies rotate per context.
 *     Locale/timezone are set per context by the caller instead.
 */

let cachedModule = null;
let loadError = null;

function load() {
  if (cachedModule || loadError) return cachedModule;
  try {
    cachedModule = require('camoufox');
  } catch (err) {
    loadError = String(err && err.message ? err.message : err).split('\n')[0];
    cachedModule = null;
  }
  return cachedModule;
}

function status() {
  const mod = load();
  if (!mod) {
    return { available: false, version: null, reason: loadError || 'module not installed' };
  }
  try {
    const version = mod.installedVerStr();
    return { available: true, version, reason: null };
  } catch (err) {
    return {
      available: false,
      version: null,
      reason: String(err && err.message ? err.message : err).split('\n')[0],
    };
  }
}

function isAvailable() {
  return status().available;
}

/**
 * Launches the camoufox Firefox build.
 * Accepts the shared-pool launch options but only honours the ones that make sense here.
 * @param {{ headless?: boolean, humanize?: boolean }} opts
 */
async function launch(opts = {}) {
  const mod = load();
  if (!mod) throw new Error(`camoufox module not available: ${loadError || 'not installed'}`);

  const st = status();
  if (!st.available) {
    throw new Error(`camoufox browser missing — run "npx camoufox fetch" (${st.reason})`);
  }

  const headless = opts.headless !== false;
  // Live test on this machine showed camoufox drawing a random macOS identity on a Windows host
  // (UA "Macintosh", platform "MacIntel") plus canvas noise — which the library itself flags as
  // looking like a hardened LibreWolf/Tor browser. Both are pinned to the host here.
  const browser = await mod.Camoufox({
    headless,
    humanize: true,
    os: 'windows',
    canvas_noise: false,
  });
  console.log(`[Browser] מנוע camoufox פעיל (Firefox ${st.version}${headless ? ', headless' : ''}).`);
  return browser;
}

module.exports = {
  launch,
  status,
  isAvailable,
};
