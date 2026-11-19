'use strict';

const dns = require('dns');
const net = require('net');

/**
 * Checks whether an IPv4 or IPv6 address belongs to loopback, private, link-local,
 * carrier-grade NAT, multicast, or unspecified address ranges.
 */
function isPrivateOrReservedIp(ipRaw) {
  let ip = String(ipRaw || '').trim().toLowerCase();
  if (!ip) return true;
  if (ip.startsWith('[')) ip = ip.slice(1, -1);
  const zoneIdx = ip.indexOf('%');
  if (zoneIdx > -1) ip = ip.slice(0, zoneIdx);

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (ip.startsWith('::ffff:')) {
    const v4Part = ip.slice(7);
    if (net.isIPv4(v4Part)) return isPrivateOrReservedIp(v4Part);
    const hexParts = v4Part.split(':');
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16);
      const lo = parseInt(hexParts[1], 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        const mappedV4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
        return isPrivateOrReservedIp(mappedV4);
      }
    }
  }

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(n => parseInt(n, 10));
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a === 169 && b === 254) return true; // Link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && (parts[2] === 0 || parts[2] === 2)) return true;
    if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }

  if (net.isIPv6(ip)) {
    if (ip === '::' || ip === '::1') return true;
    const firstWord = parseInt(ip.split(':')[0] || '0', 16);
    if (!Number.isFinite(firstWord)) return true;
    if ((firstWord & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((firstWord & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((firstWord & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }

  return true;
}

/**
 * Validates that a URL uses HTTP(S) without embedded credentials and does not resolve
 * to loopback, private, link-local, or cloud metadata networks unless explicitly allowed.
 */
async function assertSafeOutboundUrl(rawUrl, { allowLoopbackPorts = [] } = {}) {
  let u;
  try {
    u = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error('Invalid target URL.');
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error('Only http:// and https:// URLs are permitted.');
  }
  if (u.username || u.password) {
    throw new Error('URLs with embedded credentials are not permitted.');
  }

  const host = u.hostname.toLowerCase();
  const effectivePort = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  const isExplicitLoopback = (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]')
    && Array.isArray(allowLoopbackPorts)
    && allowLoopbackPorts.includes(effectivePort);

  if (isExplicitLoopback) return u;

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'metadata.google.internal') {
    throw new Error(`Blocked internal/local hostname: ${host}`);
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error(`Blocked private or reserved IP address: ${host}`);
    }
    return u;
  }

  let resolved;
  try {
    resolved = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new Error(`DNS lookup failed for host: ${host}`);
  }
  if (!Array.isArray(resolved) || !resolved.length) {
    throw new Error(`DNS returned no addresses for host: ${host}`);
  }
  for (const entry of resolved) {
    if (isPrivateOrReservedIp(entry.address)) {
      throw new Error(`Blocked target resolving to private/reserved address (${host})`);
    }
  }
  return u;
}

/**
 * Fetches an external HTTP(S) text resource with SSRF validation on every redirect hop,
 * active timeout spanning body consumption, and a strict byte cap to prevent OOM/DoS.
 */
async function safeFetchText(rawUrl, {
  method = 'GET',
  headers = {},
  timeoutMs = 8000,
  maxBytes = 1500000,
  maxRedirects = 3,
  allowLoopbackPorts = [],
} = {}) {
  let currentUrl = (await assertSafeOutboundUrl(rawUrl, { allowLoopbackPorts })).toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('Outbound request timeout')), timeoutMs);

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const resp = await fetch(currentUrl, {
        method,
        headers,
        redirect: 'manual',
        signal: ctrl.signal,
      });

      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get('location');
        if (!loc || hop === maxRedirects) {
          throw new Error(`Blocked redirect chain (HTTP ${resp.status})`);
        }
        const nextUrl = new URL(loc, currentUrl).toString();
        currentUrl = (await assertSafeOutboundUrl(nextUrl, { allowLoopbackPorts })).toString();
        continue;
      }

      const contentLength = Number(resp.headers.get('content-length') || 0);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        await resp.body?.cancel?.().catch(() => {});
        throw new Error(`Response exceeds maximum allowed size (${maxBytes} bytes)`);
      }

      if (!resp.body || typeof resp.body.getReader !== 'function') {
        const txt = await resp.text();
        if (Buffer.byteLength(txt, 'utf8') > maxBytes) {
          throw new Error(`Response exceeds maximum allowed size (${maxBytes} bytes)`);
        }
        return { status: resp.status, url: currentUrl, text: txt };
      }

      const reader = resp.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new Error(`Response exceeds maximum allowed size (${maxBytes} bytes)`);
          }
          chunks.push(Buffer.from(value));
        }
      }
      return {
        status: resp.status,
        url: currentUrl,
        text: Buffer.concat(chunks).toString('utf8'),
      };
    }
    throw new Error('Exceeded maximum redirects');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  isPrivateOrReservedIp,
  assertSafeOutboundUrl,
  safeFetchText,
};
