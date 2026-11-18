'use strict';

/**
 * Verifies that the browserEngine switch really routes to the right browser.
 * This exercises the real code path (openSessionContext), not a copy of it.
 *
 *   node tests/verify-engine.js camoufox
 *   node tests/verify-engine.js patchright
 *   node tests/verify-engine.js chromium
 */

const { openSessionContext, closeAllSharedBrowsers } = require('../src/fingerprintManager');

let pass = 0;
let fail = 0;
function ok(name, extra = '') {
  pass += 1;
  console.log(`  PASS  ${name}${extra ? ' :: ' + extra : ''}`);
}
function bad(name, extra = '') {
  fail += 1;
  console.log(`  FAIL  ${name}${extra ? ' :: ' + extra : ''}`);
}

const engine = (process.argv[2] || 'chromium').toLowerCase();
const expected = {
  camoufox: { ua: /Firefox\/158/, family: 'firefox' },
  patchright: { ua: /Chrome\/(15[0-9])/, family: 'chromium' },
  chromium: { ua: /Chrome\/(15[0-9])/, family: 'chromium' },
}[engine];

(async () => {
  console.log(`=== browserEngine = ${engine} ===`);
  if (!expected) {
    bad('unknown engine argument');
    process.exit(1);
  }

  let handle = null;
  try {
    handle = await openSessionContext({
      deviceWeights: null,
      headless: true,
      proxy: null,
      sessionSlot: null,
      referrer: '',
      geo: null,
      stealthMode: 'maximum',
      resourceMode: 'full',
      sessionSeed: 4242,
      browserEngine: engine,
    });

    if (handle.engine === engine) ok('reported engine matches', handle.engine);
    else bad('reported engine mismatch', `got ${handle.engine}`);

    const info = await handle.page.evaluate(() => ({
      ua: navigator.userAgent,
      wd: navigator.webdriver,
      platform: navigator.platform,
      plugins: navigator.plugins.length,
    }));

    console.log(`  info: UA=${info.ua}`);
    console.log(`  info: webdriver=${info.wd} platform=${info.platform} plugins=${info.plugins}`);

    if (expected.ua.test(info.ua)) ok('user agent matches engine family');
    else bad('user agent does not match engine family', info.ua);

    if (info.wd === false) ok('navigator.webdriver is false');
    else bad('navigator.webdriver leaked', String(info.wd));

    if (info.plugins > 0) ok('navigator.plugins non-empty', String(info.plugins));
    else console.log('  note: navigator.plugins is 0 (Firefox may report 5 — check manually)');
  } catch (err) {
    bad('openSessionContext threw', String(err && err.message || err).split('\n')[0]);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await closeAllSharedBrowsers().catch(() => {});
  }

  console.log(`=== RESULT: ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'} (${pass} passed) ===`);
  process.exit(fail === 0 ? 0 : 1);
})();
