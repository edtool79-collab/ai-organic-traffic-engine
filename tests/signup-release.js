const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const capture = path.resolve('.docs-capture');
fs.mkdirSync(capture, { recursive: true });
const root = fs.mkdtempSync(path.join(capture, 'signup-check-'));
const src = path.join(root, 'src');
fs.mkdirSync(src);
const files = fs.readdirSync('src').filter(name => name.endsWith('.js')).map(name => 'src/' + name);
let browser;
let server;
async function main() {
  for (const file of files) fs.copyFileSync(file, path.join(root, file));
  const fixtureKey = 'qa-fixture-key';
  process.env.HIREPULSE_OWNER_PILOT_TOKEN = fixtureKey;
  const inboxes = new Map();
  const recordedEmail = 'recording@example.test';
  const recordedCode = '612423';
  let submissions = 0;
  let pending = 0;
  let verified = 0;
  const secretText = 'FixturePasswordOnly';
  const signupPage = '<form action="/register" method="POST"><label>Email <input id="email" name="email" type="email" required></label><label>Password <input id="password" name="password" type="password" required></label><button id="register">Register</button></form>';
  const codePage = '<form action="/verify" method="POST"><label>Code <input id="code" name="code" autocomplete="one-time-code" required></label><button id="verify">Verify</button></form>';
  server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.method === 'GET' && req.url === '/') return res.end(signupPage);
    if (req.method === 'POST' && req.url === '/register') {
      const form = new URLSearchParams(Buffer.concat(await Array.fromAsync(req)).toString());
      if (form.get('email') === recordedEmail && form.get('password') === secretText) {
        res.setHeader('Set-Cookie', 'fixture-inbox=recording; SameSite=Lax; HttpOnly; Path=/');
        return res.end(codePage);
      }
      const inbox = [...inboxes.values()].find(inbox => inbox.address === form.get('email'));
      if (!inbox || form.get('password') !== secretText) {
        res.statusCode = 400;
        return res.end('Registration rejected');
      }
      submissions++;
      inbox.registered = true;
      res.setHeader('Set-Cookie', 'fixture-inbox=' + inbox.id + '; SameSite=Lax; HttpOnly; Path=/');
      return res.end(codePage);
    }
    if (req.method === 'POST' && req.url === '/verify') {
      const form = new URLSearchParams(Buffer.concat(await Array.fromAsync(req)).toString());
      const inboxId = String(req.headers.cookie).split('fixture-inbox=')[1];
      if (inboxId === 'recording' && form.get('code') === recordedCode) return res.end('<main id="verified">Email verified</main>');
      const inbox = inboxes.get(inboxId);
      if (!inbox?.registered || form.get('code') !== inbox.code) {
        res.statusCode = 400;
        return res.end('Code rejected');
      }
      verified++;
      return res.end('<main id="verified">Email verified</main>');
    }
    res.statusCode = 404;
    res.end('Not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  global.fetch = async (url, opts = {}) => {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://gethirepulse.xyz') throw new Error('Blocked nonfixture fetch');
    assert.equal(opts.headers.Authorization, 'Bearer ' + fixtureKey);
    if (parsed.pathname === '/v1/email/inboxes' && opts.method === 'POST') {
      const id = String(inboxes.size + 1);
      const inbox = { id, address: 'qa-' + id + '@example.test', code: '54000' + id, registered: false, checks: 0 };
      const body = JSON.parse(opts.body);
      assert.ok(body.idempotency_key && body.ttl_seconds >= 60);
      inboxes.set(id, inbox);
      return Response.json({ inbox_id: id, address: inbox.address, capability: 'fixture-' + id, expires_at: new Date(Date.now() + 600000).toISOString() });
    }
    const match = parsed.pathname.match(/^\/v1\/email\/inboxes\/(\d+)\/code$/);
    assert.ok(match, 'Unexpected provider API path');
    assert.equal(opts.headers['X-Inbox-Capability'], 'fixture-' + match[1]);
    const inbox = inboxes.get(match[1]);
    inbox.checks++;
    if (inbox.checks === 1) { pending++; return Response.json({ status: 'pending' }); }
    assert.equal(inbox.registered, true, 'OTP requested before browser submitted form');
    return Response.json({ status: 'code', code: inbox.code });
  };
  const { executeTaskSteps } = require(path.join(src, 'taskScenarioRunner.js'));

  const { startJourneyRecorder, stopJourneyRecorder } = require(path.join(src, 'journeyRecorder.js'));
  const launch = chromium.launch.bind(chromium);
  let recordingPage;
  process.env.WTG_ALLOW_HIDDEN_DESKTOP = '1';
  chromium.launch = async options => {
    const recorderBrowser = await launch({ ...options, headless: true, args: [] });
    const newContext = recorderBrowser.newContext.bind(recorderBrowser);
    recorderBrowser.newContext = async options => {
      const context = await newContext(options);
      await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      context.on('page', page => { recordingPage = page; });
      return context;
    };
    return recorderBrowser;
  };
  let recording;
  try {
    await startJourneyRecorder({ targetUrl: origin });
    assert.ok(recordingPage);
    await recordingPage.locator('#email').fill(recordedEmail);
    await recordingPage.locator('#password').fill(secretText);
    await recordingPage.locator('#register').click();
    await recordingPage.locator('#code').fill(recordedCode);
    await recordingPage.locator('#verify').click();
    await recordingPage.locator('#verified').waitFor();
  } finally {
    recording = await stopJourneyRecorder();
    chromium.launch = launch;
  }
  assert.ok(recording.steps.some(step => step.type === 'fill' && step.secret && step.value === ''));
  assert.ok(recording.steps.some(step => step.type === 'fill' && step.value === '{{OTP}}'));
  assert.ok(!JSON.stringify(recording).includes(secretText) && !JSON.stringify(recording).includes(recordedCode));
  // Test users supply a password locally after recording. The verification code comes from the provider.
  const replay = recording.steps
    .filter(step => step.type !== 'goto' || step.value === '/')
    .map(step => step.type === 'fill' && step.secret && !step.value ? { ...step, value: secretText } : step);
  replay.push({ type: 'assert', selector: '#verified', value: 'Email verified', assertKind: 'text_contains' });
  browser = await chromium.launch();
  const details = [];
  const results = [];
  for (let visitIndex = 1; visitIndex <= 2; visitIndex++) {
    const page = await browser.newPage();
    try {
      await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      results.push(await executeTaskSteps({
        page, targetUrl: origin, visitIndex, staySameOrigin: true,
        adSafety: { avoidAdClicks: true, dismissOverlays: false, closePopunders: false },
        onStep: message => details.push(String(message)),
        steps: replay,
      }));
      assert.equal(await page.locator('#verified').textContent({ timeout: 3000 }), 'Email verified');
    } finally { await page.close(); }
  }
  assert.equal(inboxes.size, 2);
  assert.equal(pending, 2);
  assert.equal(submissions, 2);
  assert.equal(verified, 2);
  const failingPage = await browser.newPage();
  try {
    await failingPage.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await assert.rejects(executeTaskSteps({
      page: failingPage,
      targetUrl: origin,
      visitIndex: 3,
      staySameOrigin: true,
      adSafety: { avoidAdClicks: true, dismissOverlays: false, closePopunders: false },
      steps: [
        { type: 'goto', value: '/' },
        { type: 'fill', selector: '#password', value: secretText, secret: true },
        { type: 'assert', selector: '#password', value: secretText, assertKind: 'text_contains' },
      ],
    }), error => {
      assert.ok(!String(error.stack).includes(secretText), 'A password reached a failed step error');
      assert.ok(String(error.message).includes('***'), 'A failed step did not mask the expected value');
      return true;
    });
  } finally {
    await failingPage.close();
  }

  const emitted = details.join('\n') + JSON.stringify(results);
  assert.ok(!emitted.includes(secretText), 'A recorded password reached telemetry');
  for (const inbox of inboxes.values()) {
    assert.ok(!emitted.includes(inbox.code), 'An OTP reached telemetry');
    assert.ok(!emitted.includes(inbox.address), 'An inbox address reached telemetry');
  }
  console.log(JSON.stringify({
    recordedSteps: recording.steps.length, browserSubmissions: submissions, verifiedSignups: verified, distinctInboxes: inboxes.size, pendingPolls: pending,
    fixturePasswordInStepMetadata: emitted.includes(secretText), fixtureOtpInStepMetadata: [...inboxes.values()].some(x => emitted.includes(x.code)),
    realProviderCalls: 0
  }));
}
main().catch(e => {
  console.error(e.message.replace(/https?:\/\/[^/@:\s]+:[^/@\s]+@/g, 'http://***@'));
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  for (const file of files) { const p = path.join(root, file); if (fs.existsSync(p)) fs.unlinkSync(p); }
  fs.rmdirSync(src);
  const reports = path.join(root, 'reports');
  if (fs.existsSync(reports)) {
    const logs = path.join(reports, 'run-inboxes.jsonl');
    if (fs.existsSync(logs)) fs.unlinkSync(logs);
    if (fs.readdirSync(reports).length === 0) fs.rmdirSync(reports);
  }
  if (fs.readdirSync(root).length === 0) fs.rmdirSync(root);
});

