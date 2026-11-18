'use strict';
/**
 * Read-only diagnostic: check the real exit country of every proxy in proxies.txt.
 * Hits a free geo endpoint (no API key, no cost). Never prints credentials.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { HttpsProxyAgent } = require('https-proxy-agent');

const ROOT = process.cwd();
const lines = fs.readFileSync(path.join(ROOT, 'proxies.txt'), 'utf8')
  .split(/\r?\n/)
  .map(s => s.trim())
  .filter(s => s && !s.startsWith('#'));

function probe(proxyUrl) {
  return new Promise(resolve => {
    const started = Date.now();
    let agent;
    try {
      agent = new HttpsProxyAgent(proxyUrl);
    } catch (e) {
      return resolve({ ok: false, error: 'bad-agent' });
    }
    const req = http.request({
      host: 'ip-api.com',
      path: '/json/?fields=status,country,countryCode,city',
      method: 'GET',
      agent,
      timeout: 9000,
    }, res => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        const ms = Date.now() - started;
        try {
          const j = JSON.parse(buf);
          if (j.status === 'success') {
            resolve({ ok: true, cc: j.countryCode, country: j.country, city: j.city, ms });
          } else {
            resolve({ ok: false, error: 'geo-fail', ms });
          }
        } catch {
          resolve({ ok: false, error: 'bad-json', ms });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', e => resolve({ ok: false, error: (e.code || e.message || 'error').slice(0, 28) }));
    req.end();
  });
}

(async () => {
  const results = [];
  const CONC = 5;
  for (let i = 0; i < lines.length; i += CONC) {
    const batch = lines.slice(i, i + CONC);
    const out = await Promise.all(batch.map(async p => ({ proxy: p, ...(await probe(p)) })));
    results.push(...out);
  }

  console.log('IP:PORT            OK    CC   CITY                 MS   ERR');
  console.log('-'.repeat(72));
  const counts = {};
  for (const r of results) {
    const at = r.proxy.lastIndexOf('@');
    const hp = at > 0 ? r.proxy.slice(at + 1) : r.proxy;
    if (r.ok) counts[r.cc] = (counts[r.cc] || 0) + 1;
    else counts['DEAD'] = (counts['DEAD'] || 0) + 1;
    console.log(
      hp.padEnd(18),
      String(r.ok).padEnd(5),
      String(r.cc || '-').padEnd(4),
      String(r.city || '-').slice(0, 20).padEnd(20),
      String(r.ms || '-').padEnd(4),
      r.error || ''
    );
  }
  console.log('\nsummary:', JSON.stringify(counts));
  const alive = results.filter(r => r.ok);
  console.log('alive:', alive.length, '/', results.length);
  console.log('US alive:', alive.filter(r => r.cc === 'US').length);
})();
