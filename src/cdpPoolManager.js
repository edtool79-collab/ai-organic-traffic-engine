const net = require('net');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

let proxyChainPkg = null;
function getProxyChain() {
  if (!proxyChainPkg) {
    try {
      proxyChainPkg = require('proxy-chain');
    } catch {}
  }
  return proxyChainPkg;
}

const cdpDaemons = new Map();
const anonymizedProxies = new Map();

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function isTcpPortOpen(host, port, timeoutMs = 600) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

/**
 * Converts an authenticated upstream proxy (http://host:port) into a local
 * unauthenticated loopback proxy via `proxy-chain` (bundled with `browserless`) when needed by CDP.
 */
async function ensureLocalAnonymizedProxy(proxyObj) {
  if (!proxyObj || !proxyObj.server) return null;
  if (!proxyObj.username && !proxyObj.password) return proxyObj.server;
  const pc = getProxyChain();
  if (!pc || typeof pc.anonymizeProxy !== 'function') {
    return null;
  }
  const u = new URL(proxyObj.server);
  u.username = proxyObj.username || '';
  u.password = proxyObj.password || '';
  const fullUpstream = u.toString().replace(/\/$/, '');
  if (anonymizedProxies.has(fullUpstream)) {
    return anonymizedProxies.get(fullUpstream);
  }
  try {
    const localProxyUrl = await pc.anonymizeProxy(fullUpstream);
    anonymizedProxies.set(fullUpstream, localProxyUrl);
    return localProxyUrl;
  } catch {
    return null;
  }
}

async function closeAnonymizedProxies() {
  const pc = getProxyChain();
  if (!pc || typeof pc.closeAnonymizedProxy !== 'function') return;
  for (const localUrl of anonymizedProxies.values()) {
    await pc.closeAnonymizedProxy(localUrl, true).catch(() => {});
  }
  anonymizedProxies.clear();
}

/**
 * Connects to a live Lightpanda CDP server (ws://127.0.0.1:9222) if running (e.g. via WSL/Docker),
 * or connects/spawns a Browserless-style local Chromium CDP pool daemon.
 */
async function getCdpBrowserConnection({
  mode = 'browserless_cdp',
  headless = true,
  proxy = null,
  stealthArgs = [],
  cdpEndpoint = '',
} = {}) {
  // 1. If user specified an explicit remote CDP endpoint (Browserless / Lightpanda ws:// or http://)
  const customEndpoint = String(cdpEndpoint || process.env.BROWSERLESS_WS_ENDPOINT || process.env.LIGHTPANDA_CDP_URL || '').trim();
  if (customEndpoint) {
    const key = `remote|${customEndpoint}`;
    const existing = cdpDaemons.get(key);
    if (existing?.browser && existing.browser.isConnected()) return existing.browser;
    const browser = await chromium.connectOverCDP(customEndpoint, { timeout: 6000 });
    cdpDaemons.set(key, { browser, type: 'remote_cdp', endpoint: customEndpoint });
    return browser;
  }

  // 2. If mode is lightpanda_cdp, check if Lightpanda CDP server is active on 127.0.0.1:9222
  if (mode === 'lightpanda_cdp') {
    const lpOpen = await isTcpPortOpen('127.0.0.1', 9222, 450);
    if (lpOpen) {
      const lpKey = 'lightpanda|127.0.0.1:9222';
      const existingLp = cdpDaemons.get(lpKey);
      if (existingLp?.browser && existingLp.browser.isConnected()) return existingLp.browser;
      try {
        const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 4000 });
        cdpDaemons.set(lpKey, { browser, type: 'lightpanda_native', endpoint: 'http://127.0.0.1:9222' });
        return browser;
      } catch {}
    }
  }

  // 3. Local Browserless / Lightpanda-UltraLite CDP Pool Daemon on Windows
  const poolKey = `${mode}|${headless ? 'hl' : 'hd'}|${proxy ? 'proxied' : 'direct'}`;
  const existing = cdpDaemons.get(poolKey);
  if (existing?.browser && existing.browser.isConnected()) {
    return existing.browser;
  }

  const port = await findFreePort();
  const exePath = chromium.executablePath();
  const userDataDir = path.join(
    process.env.LOCALAPPDATA || require('os').tmpdir(),
    'wtg-cdp-pool',
    `daemon_${port}`
  );
  fs.mkdirSync(userDataDir, { recursive: true });

  const localAnonProxy = proxy ? await ensureLocalAnonymizedProxy(proxy) : null;
  const proxyArg = localAnonProxy
    ? `--proxy-server=${localAnonProxy}`
    : (proxy?.server ? `--proxy-server=${proxy.server}` : '');

  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${userDataDir}`,
    ...(headless ? ['--headless=new'] : []),
    ...stealthArgs,
    ...(mode === 'lightpanda_cdp'
      ? [
          '--blink-settings=imagesEnabled=false',
          '--disable-remote-fonts',
          '--disable-Accelerated-2d-canvas',
          '--renderer-process-limit=2',
        ]
      : ['--renderer-process-limit=4']),
    ...(proxyArg ? [proxyArg] : []),
    'about:blank',
  ];

  const proc = spawn(exePath, args, {
    stdio: 'ignore',
    windowsHide: true,
    detached: false,
  });

  // Wait for CDP port to become ready
  let ready = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    if (await isTcpPortOpen('127.0.0.1', port, 250)) {
      ready = true;
      break;
    }
    await new Promise(r => setTimeout(r, 120));
  }
  if (!ready) {
    try { proc.kill(); } catch {}
    throw new Error(`CDP Pool Daemon did not start on port ${port}`);
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 6000 });
  cdpDaemons.set(poolKey, {
    browser,
    proc,
    port,
    userDataDir,
    type: mode,
    endpoint: `http://127.0.0.1:${port}`,
  });
  return browser;
}

async function closeAllCdpDaemons() {
  for (const entry of cdpDaemons.values()) {
    await entry.browser?.close?.().catch(() => {});
    if (entry.proc) {
      try { entry.proc.kill(); } catch {}
    }
    if (entry.userDataDir) {
      try { fs.rmSync(entry.userDataDir, { recursive: true, force: true }); } catch {}
    }
  }
  cdpDaemons.clear();
  await closeAnonymizedProxies();
}

function getCdpIntegrationsStatus() {
  let browserlessVersion = null;
  let lightpandaVersion = null;
  let proxyChainVersion = null;
  try {
    browserlessVersion = require('browserless/package.json').version;
  } catch {}
  try {
    lightpandaVersion = require('@lightpanda/browser/package.json').version;
  } catch {}
  try {
    proxyChainVersion = require('proxy-chain/package.json').version;
  } catch {}

  return {
    browserless: {
      installed: Boolean(browserlessVersion),
      version: browserlessVersion,
      proxyChainVersion,
      description: 'Browserless CDP Pool + Proxy-Chain Anonymizer (fast CDP connection & memory pool)',
    },
    lightpanda: {
      installed: Boolean(lightpandaVersion),
      version: lightpandaVersion,
      platformNote: process.platform === 'win32'
        ? '@lightpanda/browser package installed (runs in Lightpanda CDP Ultra-Lite ~25MB mode or via WSL/Docker on port 9222)'
        : 'Lightpanda Native CDP Binary Ready',
    },
    activeDaemons: cdpDaemons.size,
  };
}

module.exports = {
  getCdpBrowserConnection,
  closeAllCdpDaemons,
  ensureLocalAnonymizedProxy,
  getCdpIntegrationsStatus,
};
