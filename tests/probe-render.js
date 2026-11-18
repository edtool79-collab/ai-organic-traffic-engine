'use strict';
/**
 * Read-only diagnostic: open the offer page in a real headless Chromium through a
 * chosen proxy and report what actually renders after 25s: title, final URL,
 * whether the signup fields exist, and the first visible text.
 * Never prints proxy credentials.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const target = cfg.targetUrl;

const lines = fs.readFileSync('proxies.txt', 'utf8')
  .split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));

const { toPlaywrightProxy } = require(path.join(__dirname, '..', 'src', 'proxyManager'));

function parseProxy(u) {
  try {
    return toPlaywrightProxy(u);
  } catch {
    return null;
  }
}

const picks = [
  { label: 'US 9.142.40.101', raw: lines[5] },
  { label: 'CA 188.221.55.187', raw: lines[13] },
];

(async () => {
  for (const pick of picks) {
    const proxy = parseProxy(pick.raw);
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({
      proxy,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
    });
    const page = await ctx.newPage();
    let navs = [];
    page.on('framenavigated', f => { if (f === page.mainFrame()) navs.push(f.url().slice(0, 90)); });

    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(25000);
      const title = await page.title().catch(() => '');
      const url = page.url();
      const email = await page.locator('#email').count().catch(() => -1);
      const first = await page.locator('#first_name').count().catch(() => -1);
      const submit = await page.locator('#submitbutton').count().catch(() => -1);
      const bodyText = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '') || '')
        .replace(/\s+/g, ' ').slice(0, 180);
      console.log(`\n[${pick.label}]`);
      console.log('  final url :', url.slice(0, 110));
      console.log('  title     :', title);
      console.log('  #email    :', email, '| #first_name:', first, '| #submitbutton:', submit);
      console.log('  navigations:', navs.length, '→', navs.slice(-3).join(' | '));
      console.log('  text      :', bodyText);
    } catch (e) {
      console.log(`\n[${pick.label}] ERROR:`, (e.message || '').split('\n')[0].slice(0, 120));
    }
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
})();
