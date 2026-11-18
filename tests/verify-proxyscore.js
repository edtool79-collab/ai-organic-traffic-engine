/**
 * Proves the per-offer behaviour of the proxy scoreboard:
 * a proxy blocked on offer A must keep a clean slate on offer B.
 * Run: node tests/verify-proxyscore.js   (no network, writes to a temp file)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpFile = path.join(os.tmpdir(), `wtg-score-${Date.now()}.json`);
process.env.WTG_SCORE_FILE = tmpFile;
const score = require(path.join(__dirname, '..', 'src', 'proxyScoreboard.js'));

let fails = 0;
const ok = (label, cond, extra = '') => {
  if (cond) console.log('  PASS  ' + label + (extra ? ' :: ' + extra : ''));
  else { fails++; console.log('  FAIL  ' + label + (extra ? ' :: ' + extra : '')); }
};

const P1 = 'http://user:pass@10.0.0.1:8080';
const P2 = 'http://user:pass@10.0.0.2:8080';
const P3 = 'http://user:pass@10.0.0.3:8080';
const OFFER_A = 'shrinkme.click';
const OFFER_B = 'rewardspark.co';

console.log('=== 1. proxyKey never leaks credentials ===');
ok('key keeps only host:port', score.proxyKey(P1) === '10.0.0.1:8080', score.proxyKey(P1));

console.log('\n=== 2. block on offer A does NOT punish offer B ===');
score.reportOutcome({ domain: OFFER_A, proxyUrl: P1, outcome: 'block403', note: '403 forbidden' });
ok('A: P1 in cooldown', score.isCoolingDown(OFFER_A, P1) === true, 'left=' + score.cooldownLeftMs(OFFER_A, P1) + 'ms');
ok('B: P1 not in cooldown', score.isCoolingDown(OFFER_B, P1) === false);
ok('B: P1 keeps neutral score', score.scoreFor(OFFER_B, P1) === 0.5, String(score.scoreFor(OFFER_B, P1)));
ok('A: P1 score dropped', score.scoreFor(OFFER_A, P1) < 0.4, String(score.scoreFor(OFFER_A, P1).toFixed(3)));

console.log('\n=== 3. successes on offer A reorder the queue ===');
score.reportOutcome({ domain: OFFER_A, proxyUrl: P2, outcome: 'ok' });
score.reportOutcome({ domain: OFFER_A, proxyUrl: P2, outcome: 'ok' });
score.reportOutcome({ domain: OFFER_A, proxyUrl: P3, outcome: 'ok' });
const rankedA = score.rankProxies([P1, P2, P3], OFFER_A);
ok('A: cooling proxy is last', rankedA.ordered[rankedA.ordered.length - 1] === P1);
ok('A: ready list excludes the cooling one', rankedA.ready.length === 2, rankedA.ready.length + '/3');
ok('A: stats report 1 cooling', rankedA.stats.cooling === 1, JSON.stringify(rankedA.stats));

console.log('\n=== 4. offer B ranks everybody as usable ===');
const rankedB = score.rankProxies([P1, P2, P3], OFFER_B);
ok('B: all 3 ready', rankedB.ready.length === 3, rankedB.ready.length + '/3');
ok('B: none cooling', rankedB.stats.cooling === 0);

console.log('\n=== 5. repeated blocks escalate the cooldown ===');
const before = score.cooldownLeftMs(OFFER_A, P1);
score.reportOutcome({ domain: OFFER_A, proxyUrl: P1, outcome: 'block403' });
const after = score.cooldownLeftMs(OFFER_A, P1);
ok('cooldown grew after the 2nd block', after > before, `${before} -> ${after}`);

console.log('\n=== 6. a later success clears the cooldown ===');
score.reportOutcome({ domain: OFFER_A, proxyUrl: P1, outcome: 'ok' });
ok('P1 is usable again on A', score.isCoolingDown(OFFER_A, P1) === false);

console.log('\n=== 7. persisted to disk (survives a restart) ===');
ok('score file written', fs.existsSync(tmpFile), tmpFile);
const onDisk = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
ok('has buckets keyed by domain::proxy', Object.keys(onDisk.buckets).some(k => k.startsWith(OFFER_A + '::')), Object.keys(onDisk.buckets).length + ' buckets');

console.log('\n=== 8. domain reset ===');
score.resetDomain(OFFER_A);
const afterReset = score.domainSummary(OFFER_A, [P1, P2, P3]);
ok('all reset to neutral', afterReset.entries.every(e => e.score === 0.5 && !e.lastOutcome));

try { fs.unlinkSync(tmpFile); } catch {}
console.log('\n=== RESULT: ' + (fails === 0 ? 'ALL PASS' : fails + ' FAILURES') + ' ===');
process.exit(fails === 0 ? 0 : 1);
