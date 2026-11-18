const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DEFAULT_INBOX_ENDPOINT = 'https://gethirepulse.xyz/v1/email/inboxes';
const COMMERCIAL_CATALOG_URL = 'https://gethirepulse.xyz/v1/email/catalog';
const COMMERCIAL_CREDITS_URL = 'https://gethirepulse.xyz/credits';
const OWNER_PILOT_DOC_URL = 'https://gethirepulse.xyz/email-pilot';

let cachedToken = null;
let cachedMode = null;

/**
 * Resolves the HirePulse Email API token strictly in Node.js memory.
 * Never logs or exposes the raw secret to the browser or console.
 */
function resolveEmailAuthToken() {
  if (cachedToken) {
    return { token: cachedToken, mode: cachedMode };
  }

  const envPilot = (process.env.HIREPULSE_OWNER_PILOT_TOKEN || '').trim();
  if (envPilot) {
    cachedToken = envPilot;
    cachedMode = 'owner-pilot-env';
    return { token: cachedToken, mode: cachedMode };
  }

  const envCommercial = (process.env.HIREPULSE_EMAIL_API_KEY || '').trim();
  if (envCommercial) {
    cachedToken = envCommercial;
    cachedMode = 'commercial-api-key';
    return { token: cachedToken, mode: cachedMode };
  }

  const secretPath = process.env.HIREPULSE_OWNER_PILOT_FILE;
  try {
    if (secretPath && fs.existsSync(secretPath)) {
      const raw = fs.readFileSync(secretPath, 'utf8');
      const parsed = JSON.parse(raw);
      const token = parsed?.API_KEYS?.['owner-pilot'];
      if (typeof token === 'string' && token.trim()) {
        cachedToken = token.trim();
        cachedMode = 'owner-pilot-local';
        return { token: cachedToken, mode: cachedMode };
      }
    }
  } catch {
    // Ignore file read errors safely
  }

  return { token: null, mode: 'unconfigured' };
}

function getEmailClientStatus() {
  const { token, mode } = resolveEmailAuthToken();
  return {
    configured: Boolean(token),
    mode,
    isFreeOwnerPilot: mode === 'owner-pilot-local' || mode === 'owner-pilot-env',
    endpoint: DEFAULT_INBOX_ENDPOINT,
    commercialCatalogUrl: COMMERCIAL_CATALOG_URL,
    creditsUrl: COMMERCIAL_CREDITS_URL,
    pilotDocUrl: OWNER_PILOT_DOC_URL,
  };
}

async function requestEmailApi(url, { headers = {}, timeoutMs = 15000, ...options } = {}) {
  const { token } = resolveEmailAuthToken();
  if (!token) {
    throw new Error(
      `Missing email inbox access token (HIREPULSE_OWNER_PILOT_TOKEN or commercial key from ${COMMERCIAL_CREDITS_URL})`
    );
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      redirect: 'error',
      signal: ctrl.signal,
      headers: {
        ...headers,
        Authorization: `Bearer ${token}`,
      },
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const message = res.status === 402 ? 'HirePulse Email: out of credits.' : 'HirePulse Email API returned HTTP ' + res.status + '.';
      const error = new Error(message);
      error.httpStatus = res.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Creates a fresh disposable inbox for an agent visit.
 * Returns { inbox_id, address, capability, expires_at, ... }.
 * Pass ONLY `inbox.address` to the browser context.
 */
async function createEmailInbox({ idempotencyKey = randomUUID(), ttlSeconds = 600 } = {}) {
  const key = String(idempotencyKey || randomUUID()).trim();
  const ttl = Math.max(60, Math.min(3600, Number(ttlSeconds) || 600));
  const inbox = await requestEmailApi(DEFAULT_INBOX_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotency_key: key,
      ttl_seconds: ttl,
    }),
  });
  if (!inbox?.inbox_id || !inbox.address || !inbox.capability) {
    throw new Error('HirePulse Email did not return a usable inbox.');
  }
  return inbox;
}

/**
 * Polls the inbox for an OTP / verification code using the capability token in Node.js.
 * Use `code` only when `status === 'code'`.
 */
async function getEmailCode({ inbox_id, capability }) {
  if (!inbox_id || !capability) {
    throw new Error('Missing inbox_id or capability to check verification code.');
  }
  const url = `${DEFAULT_INBOX_ENDPOINT}/${encodeURIComponent(inbox_id)}/code`;
  return requestEmailApi(url, {
    method: 'GET',
    headers: {
      'X-Inbox-Capability': capability,
    },
  });
}

async function listEmailMessages({ inbox_id, capability }) {
  if (!inbox_id || !capability) {
    throw new Error('Missing inbox_id or capability to read inbox messages.');
  }
  const url = `${DEFAULT_INBOX_ENDPOINT}/${encodeURIComponent(inbox_id)}/messages`;
  return requestEmailApi(url, {
    method: 'GET',
    headers: {
      'X-Inbox-Capability': capability,
    },
  });
}

function extractConfirmationUrlFromMessages(messagesPayload) {
  const list = Array.isArray(messagesPayload?.messages)
    ? messagesPayload.messages
    : (Array.isArray(messagesPayload) ? messagesPayload : []);
  for (const msg of list) {
    const rawText = [
      msg?.text,
      msg?.html,
      msg?.body,
      msg?.snippet,
      msg?.subject,
    ].filter(Boolean).join('\n');
    const urls = rawText.match(/https?:\/\/[^\s"'<>)+]+/gi) || [];
    const confirmLink = urls.find(u =>
      /verify|confirm|activate|token=|code=|auth|magic|welcome|validate|report|audit/i.test(u) &&
      !/unsubscribe|privacy|terms|facebook\.com|twitter\.com|linkedin\.com/i.test(u)
    );
    if (confirmLink) return confirmLink.replace(/[.,;]+$/, '');
    if (urls.length > 0) {
      const firstSafe = urls.find(u => !/unsubscribe|privacy|terms|\.png|\.jpg|\.gif|\.svg|\.css/i.test(u));
      if (firstSafe) return firstSafe.replace(/[.,;]+$/, '');
    }
  }
  return null;
}

/**
 * Waits for an OTP code to arrive in the inbox, enforcing a minimum 2-second interval
 * between polls when `status === 'pending'`.
 */
async function waitForEmailCode({
  inbox_id,
  capability,
  timeoutMs = 45000,
  pollIntervalMs = 2500,
  onPoll = null,
} = {}) {
  const effectiveInterval = Math.max(2000, Number(pollIntervalMs) || 2500);
  const maxDuration = Math.max(4000, Math.min(120000, Number(timeoutMs) || 45000));
  const startedAt = Date.now();
  let attempts = 0;

  while (Date.now() - startedAt < maxDuration) {
    attempts++;
    const result = await getEmailCode({ inbox_id, capability });
    if (result && result.status === 'code' && result.code) {
      return {
        ok: true,
        status: 'code',
        code: String(result.code).trim(),
        attempts,
        elapsedMs: Date.now() - startedAt,
      };
    }
    if (result?.status === 'expired') throw new Error('The email inbox expired before a verification code arrived.');
    if (typeof onPoll === 'function') {
      onPoll({ attempts, status: result?.status || 'pending', elapsedMs: Date.now() - startedAt });
    }
    const remaining = maxDuration - (Date.now() - startedAt);
    if (remaining <= 0) break;
    await new Promise(r => setTimeout(r, Math.min(effectiveInterval, Math.max(2000, remaining))));
  }

  throw new Error(`No email verification code received within ${Math.round(maxDuration / 1000)}s (${attempts} polls).`);
}

module.exports = {
  DEFAULT_INBOX_ENDPOINT,
  COMMERCIAL_CATALOG_URL,
  COMMERCIAL_CREDITS_URL,
  OWNER_PILOT_DOC_URL,
  getEmailClientStatus,
  createEmailInbox,
  getEmailCode,
  listEmailMessages,
  extractConfirmationUrlFromMessages,
  waitForEmailCode,
};
