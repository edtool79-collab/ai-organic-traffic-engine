'use strict';

/**
 * Secret redaction for run output.
 *
 * Every log line, step detail, report and AI prompt is built from strings that may carry a
 * value typed into the page: a password, a one-time code, a session token. Those values must be
 * removed at the source — before they reach the console, the dashboard event stream, the run
 * state file, the PDF report or the AI commander — so no later consumer has to remember to
 * sanitise anything.
 *
 * Two mechanisms, both applied by redactText():
 *   1. A registry of exact values (registerSecret) — whatever the fill handler actually typed
 *      into a password or OTP field, matched and masked verbatim.
 *   2. Shape rules for values that were never registered — a 4-8 digit code that follows a
 *      word like "code", "otp", "password" or "קוד", and credential-looking URL userinfo.
 *
 * Registration is intentionally process-wide and capped: a secret stays masked for the rest of
 * the run even if it reappears in an unrelated message, and a 10,000-visit campaign cannot grow
 * the registry without bound.
 */

const REDACTED = '***';
const MAX_SECRETS = 500;
const secrets = new Set();

/** Field selectors and labels that mean "this value must never be printed". */
const SECRET_FIELD_RE = /password|passwd|pwd|passcode|\bpass\b|secret|token|api[-_]?key|otp|one[-_]?time|verification[-_]?code|\bpin\b/i;

function isSecretField(selector, label) {
  const haystack = `${selector || ''} ${label || ''}`;
  return SECRET_FIELD_RE.test(haystack);
}

/**
 * Remember a literal value for the rest of the run. Values shorter than 4 characters are
 * ignored: masking them would shred unrelated text and give false confidence.
 */
function registerSecret(value) {
  const raw = value === null || value === undefined ? '' : String(value);
  if (raw.length < 4) return raw;
  if (secrets.size >= MAX_SECRETS) {
    // Drop the oldest entry; insertion order is preserved by Set.
    const oldest = secrets.values().next().value;
    if (oldest !== undefined) secrets.delete(oldest);
  }
  secrets.add(raw);
  return raw;
}

function clearSecrets() {
  secrets.clear();
}

function secretCount() {
  return secrets.size;
}

/**
 * Keep the domain, hide the local part: `n7x2k@mail.example` becomes `n***@mail.example`.
 * The full address stays in the per-run inbox file where it is actually needed.
 */
function maskEmail(address) {
  const raw = String(address || '');
  const at = raw.lastIndexOf('@');
  if (at <= 0) return raw;
  return `${raw.slice(0, 1)}***${raw.slice(at)}`;
}

/**
 * Remove every known secret and every secret-shaped value from a free-text message.
 * Safe to call on undefined, numbers and already-clean strings.
 */
function redactText(input) {
  let out = input === null || input === undefined ? '' : String(input);

  // Exact values first, longest first, so a short secret cannot partially mask a longer one.
  if (secrets.size) {
    const ordered = [...secrets].sort((a, b) => b.length - a.length);
    for (const secret of ordered) out = out.split(secret).join(REDACTED);
  }

  // A code that follows a code-ish word: "code 483920", "קוד אימות: 5512", "OTP=903311".
  out = out.replace(
    /((?:otp|one[-_ ]?time(?:\s+code)?|verification\s+code|code|passcode|pin|password|קוד(?:\s+אימות)?|סיסמ[הא]?)\s*(?:is|הוא|:|=|-)?\s*)(\d{4,8})\b/gi,
    (_match, prefix, digits) => `${prefix}${REDACTED}${'·'.repeat(0)}`,
  );

  // Credential-shaped URL userinfo: scheme://user:pass@host — keep the scheme and host.
  out = out.replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}:${REDACTED}@`);

  return out;
}

module.exports = {
  REDACTED,
  isSecretField,
  registerSecret,
  clearSecrets,
  secretCount,
  maskEmail,
  redactText,
};
