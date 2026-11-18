'use strict';
/**
 * Builds data/proxy-geo.json: host:port -> { cc, city, ms, offerOk }.
 * Geo source: free ip-api.com (no key, no cost). Offer verdict: runs/offer-geo-probe.json when present.
 * Never prints or stores proxy credentials.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { HttpsProxyAgent } = require('https-proxy-agent');

const ROOT = process.cwd();
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const list = Array.isArray(cfg?.proxy?.servers) ? cfg.proxy.servers : [];

function hostPort(p) {
  const at = p.lastIndexOf('@');
  return at > 0 ? p.slice(at + 1) : p;
}

function probe(proxyUrl) {
  return new Promise(resolve => {
    const started = Date.now();
    let agent;
    try {
      agent = new HttpsProxyAgent(proxyUrl);
    } catch {
      return resolve({ ok: false });
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
        try {
          const j = JSON.parse(buf);
          if (j.status === 'success') {
            resolve({ ok: true, cc: j.countryCode, city: j.city, ms: Date.now() - started });
          } else {
            resolve({ ok: false });
          }
        } catch {
          resolve({ ok: false });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.on('error', () => resolve({ ok: false }));
    req.end();
  });
}

(async () => {
  let offerVerdict = {};
  const offerFile = path.join(ROOT, 'runs', 'offer-geo-probe.json');
  if (fs.existsSync(offerFile)) {
    try {
      const rows = JSON.parse(fs.readFileSync(offerFile, 'utf8'));
      rows.forEach(r => {
        if (r && r.host) offerVerdict[r.host] = !/google\.com/i.test(String(r.eff || '')) && String(r.status) === '200';
      });
    } catch {}
  }

  const CONC = 5;
  const out = {};
  for (let i = 0; i < list.length; i += CONC) {
    const batch = list.slice(i, i + CONC);
    const res = await Promise.all(batch.map(async p => ({ hp: hostPort(p), geo: await probe(p) })));
    res.forEach(({ hp, geo }) => {
      out[hp] = {
        cc: geo.ok ? geo.cc : '',
        city: geo.ok ? geo.city : '',
        ms: geo.ok ? geo.ms : null,
        offerOk: offerVerdict[hp] === undefined ? null : offerVerdict[hp],
      };
    });
  }

  const payload = { updatedAt: new Date().toISOString(), proxies: out };
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'proxy-geo.json'), JSON.stringify(payload, null, 2), 'utf8');
  Object.keys(out).forEach(hp => {
    const g = out[hp];
    console.log(hp, g.cc || '??', g.city || '-', g.ms ? g.ms + 'ms' : 'dead', g.offerOk === null ? '' : (g.offerOk ? 'OFFER-OK' : 'OFFER-BLOCKED'));
  });
})();
