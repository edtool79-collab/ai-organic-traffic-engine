'use strict';

/**
 * Proves that the proxy list shown in the dashboard is the list the runner actually uses,
 * and that the metered residential budget hands over to the datacenter fallback when spent.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtg-resolve-'));
process.env.WTG_RESI_USAGE_FILE = path.join(tmpDir, 'usage.json');
process.env.WTG_RESI_POOL_FILE = path.join(tmpDir, 'pool.json');

const { resolveProxies } = require('../src/crawleeRunner');
const pool = require('../src/residentialPool');

let pass = 0;
let fail = 0;
const ok = (n, e = '') => { pass += 1; console.log(`  PASS  ${n}${e ? ' :: ' + e : ''}`); };
const bad = (n, e = '') => { fail += 1; console.log(`  FAIL  ${n}${e ? ' :: ' + e : ''}`); };
const eq = (n, a, b) => (a === b ? ok(n, String(a)) : bad(n, `expected ${b}, got ${a}`));

const residentialThree = [
  'http://user1:pass@p.webshare.io:80',
  'http://user2:pass@p.webshare.io:80',
  'http://user3:pass@p.webshare.io:80',
];
const datacenterTwo = [
  'http://dc:pw@1.2.3.4:8080',
  'http://dc:pw@5.6.7.8:9090',
];

const baseCfg = {
  targetUrl: 'https://shrinkme.click/QIsZu',
  proxy: {
    enabled: true,
    servers: [...residentialThree],
    fallbackServers: [...datacenterTwo],
    residential: { enabled: true, byteBudgetMb: 1, country: '', overheadFactor: 1 },
  },
};

console.log('=== 1. the dashboard list is what gets used ===');
let resolved = resolveProxies(baseCfg);
eq('count matches the configured list', resolved.length, 3);
eq('all entries are the residential ones', resolved.every(u => u.includes('p.webshare.io')), true);

console.log('=== 2. non-residential list passes through unchanged ===');
const dcCfg = { ...baseCfg, proxy: { ...baseCfg.proxy, servers: [...datacenterTwo] } };
resolved = resolveProxies(dcCfg);
eq('datacenter list untouched', resolved.length, 2);
eq('host preserved', resolved[0].includes('1.2.3.4:8080'), true);

console.log('=== 3. budget exhaustion hands over to the fallback ===');
pool.addBytes(2 * 1024 * 1024, { visits: 1 }); // 2MB against a 1MB budget
eq('budget reports exhausted', pool.isExhausted({ residential: { byteBudgetMb: 1 } }), true);
resolved = resolveProxies(baseCfg);
eq('fell back to datacenter', resolved.length, 2);
eq('no webshare entry left', resolved.some(u => u.includes('p.webshare.io')), false);

console.log('=== 4. exhausted with no fallback at all stops instead of spending ===');
const emptyDcFile = path.join(tmpDir, 'datacenter-empty.json');
fs.writeFileSync(emptyDcFile, '[]', 'utf8');
process.env.WTG_DATACENTER_FILE = emptyDcFile;
const noFallbackCfg = { ...baseCfg, proxy: { ...baseCfg.proxy, fallbackServers: [] } };
resolved = resolveProxies(noFallbackCfg);
eq('returns an empty list (run will stop)', resolved.length, 0);
process.env.WTG_DATACENTER_FILE = '';

console.log('=== 5. residential disabled means the list is used as-is ===');
pool.resetUsage();
const disabledCfg = { ...baseCfg, proxy: { ...baseCfg.proxy, residential: { enabled: false } } };
resolved = resolveProxies(disabledCfg);
eq('all three still returned', resolved.length, 3);
eq('metering skipped (isResidentialUrl still true, but not charged)', resolved.filter(u => u.includes('p.webshare.io')).length, 3);

const dcFile = path.join(tmpDir, 'datacenter.json');
fs.writeFileSync(dcFile, JSON.stringify(datacenterTwo), 'utf8');
process.env.WTG_DATACENTER_FILE = dcFile;

console.log('=== 6. explicit tier="datacenter" ignores residential servers cleanly ===');
const forceDcCfg = {
  ...baseCfg,
  proxy: {
    ...baseCfg.proxy,
    tier: 'datacenter',
    servers: [...residentialThree],
  },
};
resolved = resolveProxies(forceDcCfg);
eq('tier=datacenter uses cheap pool even if servers has residential', resolved.length, 2);
eq('tier=datacenter never contains webshare', resolved.some(u => u.includes('p.webshare.io')), false);

console.log('=== 7. explicit tier="residential" pulls metered pool even if servers has datacenter ===');
fs.writeFileSync(process.env.WTG_RESI_POOL_FILE, JSON.stringify(residentialThree), 'utf8');
pool.resetUsage();
const forceResiCfg = {
  ...baseCfg,
  proxy: {
    ...baseCfg.proxy,
    tier: 'residential',
    servers: [...datacenterTwo],
  },
};
resolved = resolveProxies(forceResiCfg);
eq('tier=residential pulls residential pool', resolved.length, 3);
eq('tier=residential contains only webshare', resolved.every(u => u.includes('p.webshare.io')), true);

pool.addBytes(2 * 1024 * 1024, { visits: 1 });
resolved = resolveProxies(forceResiCfg);
eq('tier=residential falls back to datacenter once exhausted', resolved.some(u => u.includes('p.webshare.io')), false);
eq('tier=residential fallback returns datacenter entries', resolved.length, 2);

console.log(`=== RESULT: ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'} (${pass} passed) ===`);
fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
