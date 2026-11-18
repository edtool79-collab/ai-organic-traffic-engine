'use strict';

/**
 * Verifies the residential pool: parsing the provider export, spreading the sample across the
 * pool, and — the part that protects a 1 GB plan — that the byte budget actually stops usage.
 *
 * Runs against temporary files, never the real pool or the real usage counter.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtg-resi-'));
process.env.WTG_RESI_POOL_FILE = path.join(tmpDir, 'pool.json');
process.env.WTG_RESI_USAGE_FILE = path.join(tmpDir, 'usage.json');

const pool = require('../src/residentialPool');

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
function eq(name, actual, expected) {
  if (actual === expected) ok(name, String(actual));
  else bad(name, `expected ${expected}, got ${actual}`);
}

console.log('=== 1. parsing the provider export (host:port:user:pass) ===');
const lines = [];
for (let i = 1; i <= 500; i += 1) lines.push(`p.example.io:80:userresidential-${i}:secretpass`);
lines.push('');
lines.push('# a comment line');
lines.push('bad line without enough parts');
const parsed = pool.parseProxyList(lines.join('\n'));
eq('parsed valid lines only', parsed.length, 500);
eq('url shape', parsed[0], 'http://userresidential-1:secretpass@p.example.io:80');

console.log('=== 1b. country targeting suffix (Webshare appends -<cc> to the username) ===');
const usParsed = pool.parseProxyList(lines.slice(0, 3).join('\n'), { country: 'US' });
eq('suffix appended once', usParsed[0], 'http://userresidential-1-us:secretpass@p.example.io:80');
eq('same count as input', usParsed.length, 3);
const noCountry = pool.parseProxyList(lines.slice(0, 1).join('\n'), { country: '' });
eq('empty country leaves username untouched', noCountry[0].includes('-us@'), false);

console.log('=== 2. sampling spreads across the whole pool ===');const sampled = pool.sampleEvenly(parsed, 10);
eq('sample size', sampled.length, 10);
eq('first sample is first entry', sampled[0], parsed[0]);
eq('sample reaches the tail', sampled[sampled.length - 1], parsed[450]);
const tooMany = pool.sampleEvenly(parsed, 900);
eq('sample never exceeds the pool', tooMany.length, 500);

console.log('=== 3. building and reading the pool from disk ===');
const sourceFile = path.join(tmpDir, 'export.txt');
fs.writeFileSync(sourceFile, lines.join('\n'), 'utf8');
const built = pool.buildPool(sourceFile, { sampleCount: 20 });
eq('total parsed', built.total, 500);
eq('sampled written', built.sampled, 20);
eq('getServers reads it back', pool.getServers({ residential: { enabled: true } }).length, 20);
eq('disabled pool returns nothing', pool.getServers({ residential: { enabled: false } }).length, 0);

console.log('=== 4. byte budget (the 1 GB guard) ===');
const cfg = { residential: { enabled: true, byteBudgetMb: 1 } };
let s = pool.summary(cfg);
eq('starts at zero', s.usedMb, 0);
eq('starts not exhausted', s.exhausted, false);

pool.addBytes(400 * 1024, { visits: 1 });
s = pool.summary(cfg);
eq('counts partial usage', Number(s.usedMb.toFixed(2)), Number((0.39).toFixed(2)));
eq('still not exhausted', s.exhausted, false);
eq('remaining shrinks', s.remainingMb > 0.6 && s.remainingMb < 0.7, true);

pool.addBytes(700 * 1024, { visits: 1 });
s = pool.summary(cfg);
eq('exhausted after crossing the budget', s.exhausted, true);
eq('remaining clamped at zero', s.remainingMb, 0);
eq('visits counted', s.visits, 2);
eq('isExhausted agrees', pool.isExhausted(cfg), true);

console.log('=== 5. pool membership check (used to skip metered prefilters) ===');
eq('member detected', pool.isPoolMember(parsed[0], { residential: { enabled: true } }), true);
eq('outsider rejected', pool.isPoolMember('http://x:y@1.2.3.4:8080', { residential: { enabled: true } }), false);

console.log('=== 6. reset ===');
pool.resetUsage();
eq('usage cleared', pool.summary(cfg).usedMb, 0);

console.log(`=== RESULT: ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'} (${pass} passed) ===`);
fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
