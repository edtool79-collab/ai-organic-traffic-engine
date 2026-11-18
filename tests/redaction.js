'use strict';

/**
 * Redaction contract test: nothing that looks like a credential may survive the log path,
 * and ordinary run text must pass through untouched.
 *
 * Run with: node tests/redaction.js
 */

const assert = require('assert');
const { redactData, redactText, registerSecret, clearSecrets, maskEmail, isSecretField } = require('../src/redaction');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL  ${name} — ${err.message}`);
  }
}

check('registered OTP is removed from a log line', () => {
  clearSecrets();
  registerSecret('483920');
  const out = redactText('[HirePulse OTP] נשלף קוד אימות חי מהמייל: 483920');
  assert.ok(!out.includes('483920'), `code survived: ${out}`);
  assert.ok(out.includes('***'), `no mask marker: ${out}`);
});

check('registered password is removed even in an unrelated message', () => {
  clearSecrets();
  registerSecret('Str0ng!Passw0rd');
  const out = redactText('הוזן טקסט בשדה #login-pass (16 תווים: "Str0ng!Passw0rd")');
  assert.ok(!out.includes('Str0ng!Passw0rd'), `password survived: ${out}`);
});

check('unregistered code after a code word is masked', () => {
  clearSecrets();
  for (const line of [
    'verification code: 5512',
    'OTP=903311',
    'your code is 774411',
    'קוד אימות: 445566',
    'password 12345678',
  ]) {
    const out = redactText(line);
    assert.ok(!/\d{4,8}/.test(out), `digits survived in "${line}" -> "${out}"`);
  }
});

check('credential-shaped URL userinfo is masked, host kept', () => {
  clearSecrets();
  const url = new URL('http://proxy.example.com:8000');
  url.username = 'user';
  url.password = 'sup3rs3cret';
  const out = redactText('proxy ' + url + ' failed');
  assert.ok(!out.includes('sup3rs3cret'), `password survived: ${out}`);
  assert.ok(out.includes('proxy.example.com:8000'), `host lost: ${out}`);
});

check('emails keep the domain and lose the local part', () => {
  assert.strictEqual(maskEmail('n7x2k9@inbox.example'), 'n***@inbox.example');
  assert.strictEqual(maskEmail('not-an-address'), 'not-an-address');
});

check('SOCKS URL credentials are masked before logging', () => {
  clearSecrets();
  assert.strictEqual(
    redactText('proxy socks5h://fake-user:fake-pass@proxy.example:1080 failed'),
    'proxy socks5h://***:***@proxy.example:1080 failed',
  );
});

check('structured credentials are masked without dropping ordinary data', () => {
  clearSecrets();
  const input = {
    completed: 2,
    headers: { Authorization: 'Bearer fixture', 'Set-Cookie': ['session=fixture'], 'content-type': 'text/plain' },
    visits: [{ proxy_password: 'fixture', accessToken: 'fixture', otp: 123456, otpReceived: true, status: 'blocked' }],
  };
  assert.deepStrictEqual(redactData(input), {
    completed: 2,
    headers: { Authorization: '***', 'Set-Cookie': '***', 'content-type': 'text/plain' },
    visits: [{ proxy_password: '***', accessToken: '***', otp: '***', otpReceived: true, status: 'blocked' }],
  });
  assert.strictEqual(input.headers.Authorization, 'Bearer fixture');
});

check('secret fields are recognised by selector and label', () => {
  assert.strictEqual(isSecretField('input[type="password"]'), true);
  assert.strictEqual(isSecretField('#login-pass'), true);
  assert.strictEqual(isSecretField('input[name="otp_code"]'), true);
  assert.strictEqual(isSecretField('input[id="email"]'), false);
  assert.strictEqual(isSecretField('#search'), false);
});

check('ordinary run text is left alone', () => {
  clearSecrets();
  for (const line of [
    '[ביקור 3 | צעד 4/12] נלחץ "a.cta" (<a>)',
    'הוזן טקסט בשדה #search (5 תווים: "shoes")',
    '[ביקור 2] הדפדפן נסגר במהלך צעד 7 — מסיים ביקור',
    'נטען עמוד https://example.com/pricing (HTTP 200, 812ms)',
  ]) {
    assert.strictEqual(redactText(line), line, `over-redacted: ${line}`);
  }
});

check('non-string input does not throw', () => {
  clearSecrets();
  assert.strictEqual(redactText(undefined), '');
  assert.strictEqual(redactText(null), '');
  assert.strictEqual(redactText(42), '42');
});

check('registry is capped', () => {
  clearSecrets();
  for (let i = 0; i < 700; i += 1) registerSecret(`value-${i}-secret`);
  const { secretCount } = require('../src/redaction');
  assert.ok(secretCount() <= 500, `registry grew to ${secretCount()}`);
  clearSecrets();
});

if (failures) {
  console.error(`\n${failures} redaction check(s) failed`);
  process.exit(1);
}
console.log('\nPASS — redaction');
