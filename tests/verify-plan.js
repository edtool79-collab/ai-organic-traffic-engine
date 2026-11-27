/**
 * Offline verification for the referrer + AI-in-the-loop plan changes.
 * Run: node tests/verify-plan.js   (no network, no browser, no API cost)
 */
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const wp = require(path.join(root, 'src', 'wavePlanner.js'));
const re = require(path.join(root, 'src', 'referrerEngine.js'));

let fails = 0;
const ok = (label, cond, extra = '') => {
  if (cond) {
    console.log('  PASS  ' + label + (extra ? ' :: ' + extra : ''));
  } else {
    fails++;
    console.log('  FAIL  ' + label + (extra ? ' :: ' + extra : ''));
  }
};

const SUBMIT_RX = /submit|continue|claim|next|send|confirm/i;
const isSubmit = (s) => {
  if (s.type === 'click' || s.type === 'press') {
    return SUBMIT_RX.test(`${s.selector || ''} ${s.label || ''} ${s.value || ''}`);
  }
  return false;
};

console.log('=== CONFIG ===');
console.log('waves.enabled=' + cfg.waves?.enabled +
  ' conversionRate=' + cfg.waves?.conversionRate +
  ' referrerMode=' + cfg.waves?.referrerMode +
  ' refMode(top)=' + cfg.referrerMode +
  ' ai.enabled=' + cfg.ai?.enabled +
  ' ai.workerModel=' + cfg.ai?.workerModel +
  ' ai.allSquadsModel=' + cfg.ai?.allSquadsModel +
  ' ai.formAssist=' + cfg.ai?.formAssist +
  ' ai.routeRepair=' + cfg.ai?.routeRepair +
  ' proxy.enabled=' + cfg.proxy?.enabled +
  ' servers=' + (cfg.proxy?.servers || []).length);

const VISITS = 3;
// Mirror crawleeRunner: the runtime waves config carries the top-level referrerMode.
const effectiveMode = cfg.referrerMode || cfg.waves?.referrerMode || 'mixed';
const wavesCfg = { ...(cfg.waves || {}), referrerMode: effectiveMode };
const plans = [];
for (let v = 0; v < VISITS; v++) {
  plans.push(wp.buildChildJourney({
    baseSteps: cfg.taskSteps,
    pages: cfg.pages,
    wavesCfg,
    visitIndex: v,
    totalPlanned: cfg.visitCount || VISITS,
    persona: null,
    aiCfg: cfg.ai || {},
    targetUrl: cfg.targetUrl,
    runtimeState: {},
  }));
}

plans.forEach((plan, i) => {
  const types = plan.steps.map(s => s.type);
  const count = (t) => types.filter(x => x === t).length;
  console.log('\n=== VISIT ' + (i + 1) + ' :: steps=' + plan.steps.length +
    ' converter=' + plan.summary.isConverter +
    ' | search_entry=' + count('search_entry') +
    ' ai_route_repair=' + count('ai_route_repair') +
    ' ai_form_guard=' + count('ai_form_guard') +
    ' ai_explore=' + count('ai_explore') + ' ===');
  plan.steps.forEach((s, idx) => {
    const v = String(s.value || '');
    console.log('  ' + String(idx + 1).padStart(3) + '. ' + (s.type || '?').padEnd(15) +
      ' tab=' + (s.tab === undefined ? '-' : s.tab) +
      ' | ' + String(s.selector || s.url || '-').slice(0, 60) +
      (v ? ' | ' + v.slice(0, 55) : ''));
  });

  const mode = effectiveMode;
  if (mode !== 'direct') {
    ok('visit ' + (i + 1) + ': has search_entry', count('search_entry') >= 1);
  }
  if (cfg.ai?.enabled) {
    ok('visit ' + (i + 1) + ': has ai_route_repair', count('ai_route_repair') >= 1);
    ok('visit ' + (i + 1) + ': has ai_explore', count('ai_explore') >= 1);
  }

  // every submit click must be immediately preceded by an ai_form_guard (when form assist is on)
  const hasFormSteps = plan.steps.some(s => s.type === 'fill' || s.type === 'select');
  if (cfg.ai?.enabled && cfg.ai?.formAssist !== false && hasFormSteps) {
    const submitIdx = plan.steps.map((s, idx) => (isSubmit(s) ? idx : -1)).filter(x => x >= 0);
    const guarded = submitIdx.filter(idx => {
      for (let b = idx - 1; b >= Math.max(0, idx - 3); b--) {
        if (plan.steps[b].type === 'ai_form_guard') return true;
      }
      return false;
    });
    ok('visit ' + (i + 1) + ': every submit guarded',
      submitIdx.length > 0 && guarded.length === submitIdx.length,
      guarded.length + '/' + submitIdx.length);
  }

  // identity consistency
  const id = plan.summary.identity;
  ok('visit ' + (i + 1) + ': identity present', !!(id && id.email && id.state && id.zip && id.phone));
  if (id) {
    const st = String(id.state).toUpperCase();
    const zipOk = { IN: '46', NC: '28', FL: '32', OH: '43', AZ: '85', TX: '75', VA: '23', TN: '37', MI: '49', PA: '15', GA: '30', CA: '92' }[st];
    ok('visit ' + (i + 1) + ': state<->zip match', !!zipOk && String(id.zip).startsWith(zipOk), st + '/' + id.zip);
    const area = String(id.phone).replace(/\D/g, '');
    ok('visit ' + (i + 1) + ': phone is 10 digits', area.length === 10, id.phone);
    ok('visit ' + (i + 1) + ': email matches name',
      String(id.email).toLowerCase().includes(String(id.first).toLowerCase()),
      id.email);
    const emailStep = plan.steps.find(s => (s.type === 'fill' || s.type === 'select') && /mail|email/i.test(String(s.selector || '')));
    if (emailStep) {
      ok('visit ' + (i + 1) + ': form email == identity email',
        String(emailStep.value) === String(id.email),
        String(emailStep.value));
    }
  }

  // the very first navigation must be preceded by the organic search warm-up, so the landing
  // request carries a SERP referrer (the runner derives it at runtime from ctx.serpUrl).
  const firstGoto = plan.steps.findIndex(s => s.type === 'goto');
  if (mode !== 'direct') {
    ok('visit ' + (i + 1) + ': first goto is preceded by search_entry',
      firstGoto > 0 && plan.steps.slice(0, firstGoto).some(s => s.type === 'search_entry'));
  } else {
    ok('visit ' + (i + 1) + ': direct mode has no search warm-up', count('search_entry') === 0);
  }
});

console.log('\n=== pickReferrer sampling (300 draws, mixed) ===');
const kinds = {};
let empty = 0;
let direct = 0;
const sampleUrls = [];
for (let i = 0; i < 300; i++) {
  const geo = { country: ['US', 'CA', 'GB', 'AU', 'DE'][i % 5] };
  const r = re.pickReferrer({ geo, title: 'CitedCart Storefront SEO Audit', targetUrl: cfg.targetUrl, mode: 'mixed' });
  if (!r || (r.kind === 'direct' && !r.url)) { direct++; continue; }
  if (!r.url || !/^https?:\/\//.test(r.url)) empty++;
  else {
    kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    if (sampleUrls.length < 6) sampleUrls.push(r.kind + ' -> ' + r.url);
  }
}
console.log('  kinds: ' + JSON.stringify(kinds) + ' | direct(no referer)=' + direct);
console.log('  invalid non-direct urls: ' + empty + '/300');
sampleUrls.forEach(u => console.log('  e.g. ' + u));
ok('pickReferrer: no invalid search/social urls', empty === 0, empty + ' bad');
ok('pickReferrer: search dominates', (kinds.search || 0) > 150, String(kinds.search || 0));
ok('pickReferrer: direct stays a small natural tail', direct < 40, String(direct));
ok('pickReferrer(search_engines): never direct',
  (() => { for (let i = 0; i < 100; i++) { const r = re.pickReferrer({ title: 'x', targetUrl: cfg.targetUrl, mode: 'search_engines' }); if (!r.url) return false; } return true; })());

console.log('\n=== searchEngineProfile sanity ===');
['google', 'bing', 'duckduckgo', 'yahoo', 'brave', 'ecosia'].forEach(e => {
  const p = re.searchEngineProfile(e, 'US');
  ok('profile ' + e, !!(p && p.homeUrl && p.inputSelectors && p.inputSelectors.length));
});

console.log('\n=== RESULT: ' + (fails === 0 ? 'ALL PASS' : fails + ' FAILURES') + ' ===');
process.exit(fails === 0 ? 0 : 1);
