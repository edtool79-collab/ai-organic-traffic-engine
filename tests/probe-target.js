'use strict';
/**
 * Read-only: fetch the configured target through a few proxies and report
 * status, title and whether the signup form fields exist.
 * Never prints proxy credentials.
 */
const fs = require('fs');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');

const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const target = cfg.targetUrl;

const lines = fs.readFileSync('proxies.txt', 'utf8')
  .split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

function hostOf(p) { const at = p.lastIndexOf('@'); return at > 0 ? p.slice(at + 1) : p; }

function fetchThrough(proxyUrl) {
  return new Promise(resolve => {
    const started = Date.now();
    let agent;
    try { agent = new HttpsProxyAgent(proxyUrl); } catch { return resolve({ ok: false, err: 'bad-agent' }); }
    const req = https.request(target, {
      agent, timeout: 20000,
      headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml' },
    }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        resolve({
          ok: true,
          code: res.statusCode,
          location: res.headers.location || '',
          len: body.length,
          title: (body.match(/<title[^>]*>([^<]*)/i) || [])[1] || '',
          hasEmail: /id=["']email["']/.test(body),
          hasFirst: /first_name/.test(body),
          ms: Date.now() - started,
        });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, err: 'timeout' }); });
    req.on('error', e => resolve({ ok: false, err: (e.code || e.message || '').slice(0, 24) }));
    req.end();
  });
}

(async () => {
  console.log('target:', target);
  console.log('proxies:', lines.length, '\n');
  const sample = [lines[0], lines[5], lines[9], lines[13], lines[19]].filter(Boolean);
  for (const p of sample) {
    const r = await fetchThrough(p);
    console.log(hostOf(p).padEnd(20), JSON.stringify(r));
  }
})();
