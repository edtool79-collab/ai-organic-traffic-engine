#!/usr/bin/env node
'use strict';
/**
 * CLI: classify a target before spending a full run on it.
 *
 *   node tools/preflight-target.js https://example.com/link
 *   node tools/preflight-target.js https://example.com/link --country us
 *   node tools/preflight-target.js https://example.com/link --no-proxy
 *   node tools/preflight-target.js https://example.com/link --wait 15000 --shot out.png
 *
 * Exit code 0 when the target is usable, 1 when it is gated, 2 on a probe error.
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// Windows consoles default to a legacy code page, which turns any Hebrew label into mojibake.
// Node already emits UTF-8 bytes, so switching the console to 65001 is enough.
if (process.platform === 'win32') {
  try { require('child_process').execSync('chcp 65001', { stdio: 'ignore' }); } catch {}
}

const { classify } = require(path.join(ROOT, 'src', 'targetPreflight'));
const residentialPool = require(path.join(ROOT, 'src', 'residentialPool'));

const VERDICT_HE = {
  open: 'פתוח — אין גדר אימות',
  cf_interstitial: 'חסימת Cloudflare ברמת הדומיין (מוניטין IP)',
  site_tick: 'האתר דורש סימון וי ידני (Turnstile אינטראקטיבי)',
  dead: 'שרשרת ההפניות נגמרה בכתובת שאינה פעילה',
  unknown: 'לא זוהה — צריך להסתכל על התמונה',
};

function parseArgs(argv) {
  const out = { url: null, country: 'us', noProxy: false, wait: 12000, shot: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-proxy') out.noProxy = true;
    else if (a === '--country') out.country = String(argv[++i] || '').toLowerCase();
    else if (a === '--wait') out.wait = Number(argv[++i] || 12000);
    else if (a === '--shot') out.shot = argv[++i];
    else if (a === '--json') out.json = true;
    else if (!a.startsWith('--')) out.url = a;
  }
  return out;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error('usage: node tools/preflight-target.js <url> [--country us] [--no-proxy] [--wait ms] [--shot file.png]');
    process.exit(2);
  }
  let proxyUrl = null;
  if (!args.noProxy) {
    const pool = residentialPool.listForCountry(args.country);
    if (!pool.length) {
      console.error(`no residential exits for country "${args.country}"`);
      process.exit(2);
    }
    proxyUrl = pool[Math.floor(Math.random() * pool.length)];
    console.log(`exit: ${args.country.toUpperCase()} residential (${new URL(proxyUrl).host})`);
  } else {
    console.log('exit: direct (no proxy)');
  }

  const r = await classify({
    url: args.url,
    proxyUrl,
    waitMs: args.wait,
    screenshotPath: args.shot ? path.resolve(args.shot) : null,
  });

  if (args.json) {
    console.log(JSON.stringify(r, null, 1));
    process.exit(r.usable ? 0 : 1);
  }

  console.log('');
  console.log(`verdict    : ${r.verdict}  —  ${VERDICT_HE[r.verdict] || ''}`);
  console.log(`usable     : ${r.usable ? 'yes' : 'no'}`);
  console.log(`http status: ${r.status}`);
  console.log(`final url  : ${r.finalUrl}`);
  console.log(`title      : ${r.title}`);
  console.log(`turnstile  : widget=${r.hasWidget} tokenLen=${r.tokenLen}`);
  if (r.gateNetwork && r.gateNetwork.length) console.log(`gate calls : ${r.gateNetwork.join(' | ')}`);
  if (r.challenge) {
    const c = r.challenge;
    console.log(`challenge  : detected=${c.detected} kind=${c.kind || '-'} solved=${c.solved} solvedBy=${c.solvedBy || '-'} attempts=${c.attempts} settled=${c.settledMs}ms`);
    if (c.interactionRequired) console.log('             ^ awaiting human interaction; this tool dispatches no input');
  }
  if (r.bodyExcerpt) console.log(`body       : ${r.bodyExcerpt.slice(0, 200)}`);
  if (r.navError) console.log(`nav error  : ${r.navError}`);
  process.exit(r.usable ? 0 : 1);
})().catch(e => {
  console.error('preflight failed:', String(e && e.stack || e));
  process.exit(2);
});
