const fs = require('fs');
const path = require('path');
const { chromium, firefox, webkit, devices } = require('playwright');
let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch {}
const {
  getCdpBrowserConnection,
  closeAllCdpDaemons,
  getCdpIntegrationsStatus,
} = require('./cdpPoolManager');

let fpGeneratorInstance = null;
let fpInjectorInstance = null;

function getFpGenerator() {
  if (!fpGeneratorInstance) {
    const { FingerprintGenerator } = require('fingerprint-generator');
    fpGeneratorInstance = new FingerprintGenerator();
  }
  return fpGeneratorInstance;
}

function getFpInjector() {
  if (!fpInjectorInstance) {
    const { FingerprintInjector } = require('fingerprint-injector');
    fpInjectorInstance = new FingerprintInjector();
  }
  return fpInjectorInstance;
}

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

let stealthChromiumInstance = null;
function getStealthChromium() {
  if (stealthChromiumInstance) return stealthChromiumInstance;
  try {
    const { addExtra } = require('playwright-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    const WebglVendorPlugin = require('puppeteer-extra-plugin-stealth/evasions/webgl.vendor');
    const extra = addExtra(chromium);
    const stealth = StealthPlugin();
    // Avoid overriding locale/Accept-Language, UA version, or injecting macOS WebGL on Windows
    stealth.enabledEvasions.delete('user-agent-override');
    stealth.enabledEvasions.delete('navigator.languages');
    stealth.enabledEvasions.delete('webgl.vendor');
    extra.use(stealth);
    if (IS_WIN) {
      extra.use(WebglVendorPlugin({
        vendor: 'Google Inc. (Intel)',
        renderer: 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
      }));
    } else if (IS_MAC) {
      extra.use(WebglVendorPlugin({
        vendor: 'Intel Inc.',
        renderer: 'Intel Iris OpenGL Engine',
      }));
    }
    stealthChromiumInstance = extra;
  } catch {
    stealthChromiumInstance = chromium;
  }
  return stealthChromiumInstance;
}

let patchrightChromiumInstance = null;
// Patchright patches the Playwright driver/CDP layer (no Runtime.enable leak, no automation
// flags) instead of injecting JS evasions. Mixing it with playwright-extra would re-introduce
// the leaks it removes, so it is used on its own and only when explicitly selected.
function getPatchrightChromium() {
  if (patchrightChromiumInstance) return patchrightChromiumInstance;
  try {
    const pr = require('patchright');
    patchrightChromiumInstance = pr.chromium;
    console.log('[Browser] מנוע patchright פעיל (Chromium מוטמע, ללא playwright-extra).');
  } catch (err) {
    console.log(`[Browser] patchright לא זמין (${String(err && err.message || err).split('\n')[0]}) — חוזר ל-Playwright הרגיל.`);
    patchrightChromiumInstance = getStealthChromium();
  }
  return patchrightChromiumInstance;
}

let cachedNativeChromeUA = null;
let cachedRealChromeUA = null;
let cachedInstalledChromeVersion = '';

function compareDottedVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// The bundled Chromium lags behind the installed Chrome (145 vs 157 on this machine), so a UA
// derived from it never matched the browser actually launched. Chrome also reduced its UA string
// to `<major>.0.0.0` on desktop — reporting a full build number is itself a fingerprint.
function getInstalledChromeVersion() {
  if (cachedInstalledChromeVersion !== '') return cachedInstalledChromeVersion;
  cachedInstalledChromeVersion = '';
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    .filter(Boolean)
    .map(root => path.join(root, 'Google', 'Chrome', 'Application'));
  let best = '';
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      for (const name of fs.readdirSync(root)) {
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(name)) continue;
        if (!best || compareDottedVersions(name, best) > 0) best = name;
      }
    } catch {}
  }
  cachedInstalledChromeVersion = best;
  return best;
}

function getNativeChromeUserAgent(preferRealChrome = false) {
  if (preferRealChrome && cachedRealChromeUA) return cachedRealChromeUA;
  if (!preferRealChrome && cachedNativeChromeUA) return cachedNativeChromeUA;

  const installed = preferRealChrome ? getInstalledChromeVersion() : '';
  let version = installed ? `${installed.split('.')[0]}.0.0.0` : '';
  if (!version) {
    version = '145.0.7632.6';
    try {
      const exeDir = path.dirname(chromium.executablePath());
      if (fs.existsSync(exeDir)) {
        const manifest = fs.readdirSync(exeDir).find(f => /^\d+\.\d+\.\d+\.\d+\.manifest$/i.test(f));
        if (manifest) version = manifest.replace(/\.manifest$/i, '');
      }
    } catch {}
  }

  const osToken = IS_WIN
    ? 'Windows NT 10.0; Win64; x64'
    : IS_MAC
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : 'X11; Linux x86_64';
  const ua = `Mozilla/5.0 (${osToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
  if (preferRealChrome) cachedRealChromeUA = ua;
  else cachedNativeChromeUA = ua;
  return ua;
}


const HOST_DESKTOP_OS = IS_WIN ? ['windows'] : IS_MAC ? ['macos'] : ['linux', 'windows'];

const DESKTOP_VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1280, height: 720 },
];

const DEVICE_SPECS = {
  desktopChrome: {
    label: 'Desktop Chrome',
    engine: 'chromium',
    hostConsistent: true,
    nativeEngine: true,
    pwDevice: devices['Desktop Chrome'],
    fpOptions: { devices: ['desktop'], browsers: ['chrome'], operatingSystems: HOST_DESKTOP_OS },
  },
  desktopFirefox: {
    label: 'Desktop Firefox',
    engine: 'firefox',
    hostConsistent: true,
    nativeEngine: true,
    pwDevice: devices['Desktop Firefox'],
    fpOptions: { devices: ['desktop'], browsers: ['firefox'], operatingSystems: HOST_DESKTOP_OS },
  },
  desktopSafari: {
    label: 'Desktop Safari',
    engine: 'webkit',
    hostConsistent: IS_MAC,
    nativeEngine: IS_MAC,
    pwDevice: devices['Desktop Safari'],
    fpOptions: { devices: ['desktop'], browsers: ['safari'], operatingSystems: ['macos'] },
  },
  iphone14: {
    label: 'iPhone 14',
    engine: 'webkit',
    hostConsistent: IS_MAC,
    nativeEngine: false,
    pwDevice: devices['iPhone 14'],
    fpOptions: { devices: ['mobile'], browsers: ['safari'], operatingSystems: ['ios'] },
  },
  pixel7: {
    label: 'Pixel 7',
    engine: 'chromium',
    hostConsistent: false,
    nativeEngine: false,
    pwDevice: devices['Pixel 7'],
    fpOptions: { devices: ['mobile'], browsers: ['chrome'], operatingSystems: ['android'] },
  },
  ipadPro: {
    label: 'iPad Pro 11',
    engine: 'webkit',
    hostConsistent: IS_MAC,
    nativeEngine: false,
    pwDevice: devices['iPad Pro 11'],
    fpOptions: { devices: ['mobile'], browsers: ['safari'], operatingSystems: ['ios'] },
  },
};

const DEFAULT_DEVICE_WEIGHTS = IS_MAC
  ? {
      desktopChrome: 50,
      iphone14: 15,
      pixel7: 0,
      desktopFirefox: 20,
      desktopSafari: 15,
      ipadPro: 0,
    }
  : {
      desktopChrome: 75,
      desktopFirefox: 25,
      pixel7: 0,
      iphone14: 0,
      desktopSafari: 0,
      ipadPro: 0,
    };

function pickDeviceKey(deviceWeights) {
  const merged = { ...DEFAULT_DEVICE_WEIGHTS, ...(deviceWeights || {}) };
  let entries = Object.entries(merged).filter(([k, w]) => DEVICE_SPECS[k] && Number(w) > 0);
  const consistentEntries = entries.filter(([k]) => DEVICE_SPECS[k].hostConsistent);
  if (consistentEntries.length) {
    entries = consistentEntries;
  }
  if (!entries.length) return 'desktopChrome';
  const total = entries.reduce((sum, [, w]) => sum + Number(w), 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) {
    r -= Number(w);
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

// Every device spec belongs to exactly one engine family. patchright is a Chromium build and
// camoufox is a real Firefox build, so both map onto the family of the binary they run.
const ENGINE_DEFAULT_DEVICE = {
  chromium: 'desktopChrome',
  patchright: 'desktopChrome',
  firefox: 'desktopFirefox',
  camoufox: 'desktopFirefox',
  webkit: 'desktopSafari',
};

function specEngineFor(launchEngine) {
  if (launchEngine === 'patchright') return 'chromium';
  if (launchEngine === 'camoufox') return 'firefox';
  return launchEngine;
}

// Picks a device spec that belongs to the same engine family as the launcher. Without this,
// browserEngine:'chromium' could still hand a firefox spec to the Chromium launcher and the
// reported engine, the UA and the real binary would disagree.
function pickDeviceKeyForEngine(deviceWeights, launchEngine) {
  const family = specEngineFor(launchEngine);
  const fallback = ENGINE_DEFAULT_DEVICE[launchEngine] || 'desktopChrome';
  const merged = { ...DEFAULT_DEVICE_WEIGHTS, ...(deviceWeights || {}) };
  let entries = Object.entries(merged).filter(
    ([k, w]) => DEVICE_SPECS[k] && DEVICE_SPECS[k].engine === family && Number(w) > 0
  );
  if (!entries.length) return DEVICE_SPECS[fallback] ? fallback : 'desktopChrome';
  const consistentEntries = entries.filter(([k]) => DEVICE_SPECS[k].hostConsistent);
  if (consistentEntries.length) entries = consistentEntries;
  const total = entries.reduce((sum, [, w]) => sum + Number(w), 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) {
    r -= Number(w);
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

function generateDeviceFingerprint(deviceKey, locale = null) {
  const spec = DEVICE_SPECS[deviceKey] || DEVICE_SPECS.desktopChrome;
  if (spec.nativeEngine) {
    const viewport = DESKTOP_VIEWPORTS[Math.floor(Math.random() * DESKTOP_VIEWPORTS.length)];
    return { spec, fp: null, viewport };
  }
  const locales = locale && locale !== 'en-US' ? [locale, 'en-US'] : ['en-US'];
  const fp = getFpGenerator().getFingerprint({ ...spec.fpOptions, locales });
  const pwViewport = spec.pwDevice?.viewport;
  const screenW = fp.fingerprint?.screen?.width;
  const screenH = fp.fingerprint?.screen?.height;
  const viewport = (pwViewport && spec.fpOptions.devices.includes('mobile'))
    ? pwViewport
    : {
        width: Math.min(1920, Math.max(1024, screenW || pwViewport?.width || 1366)),
        height: Math.min(1080, Math.max(720, screenH || pwViewport?.height || 768)),
      };
  return { spec, fp, viewport };
}

function getChromiumStealthArgs(headless = true, { stealthMode = 'standard', proxied = false } = {}) {
  const disabledFeatures = [
    'Translate',
    'OptimizationHints',
    'MediaRouter',
    'BackForwardCache',
    'IsolateOrigins',
    'site-per-process',
    'OptimizationGuideModelDownloading',
  ];
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-site-isolation-trials',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--js-flags=--max-old-space-size=256',
    '--disk-cache-size=1',
    '--media-cache-size=1',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-pings',
    `--disable-features=${disabledFeatures.join(',')}`,
    ...(headless ? [] : ['--window-position=90,60']),
  ];
  if (stealthMode === 'maximum' || proxied) {
    args.push(
      '--webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'
    );
  }
  return args;
}

/**
 * Applies enhanced GitHub-inspired browser stealth hardening inside page init scripts
 * without breaking host OS consistency or triggering document.hidden detection flags.
 */
async function applyMaximumStealth(context, { spec, proxied = false, seed = 1337, viewport = null } = {}) {
  if (!context) return;
  const isChromium = spec?.engine === 'chromium';
  const cores = [4, 6, 8, 12][Math.abs(seed) % 4];
  const memGb = [8, 16][Math.abs(seed >> 2) % 2];
  const rttMs = [50, 75, 100][Math.abs(seed >> 3) % 3];
  const downlinkMbps = Number((9.5 + (Math.abs(seed % 11) * 1.1)).toFixed(1));
  const noiseDelta = (Math.abs(seed) % 3) + 1;
  const audioOffset = ((Math.abs(seed) % 9) + 1) * 1e-7;
  const vpW = viewport?.width || 1366;
  const vpH = viewport?.height || 768;

  await context.addInitScript(({ isChrome, coresVal, memVal, rttVal, downlinkVal, delta, audOff, isProxied, w, h, isWinHost, isMacHost }) => {
    try {
      // 0. Native Function.prototype.toString cloak (prevents Sodar/CreepJS/BotD from seeing patched JS source)
      const nativeLabels = new WeakMap();
      const origFnToString = Function.prototype.toString;
      const customToString = function toString() {
        if (typeof this === 'function' && nativeLabels.has(this)) {
          return nativeLabels.get(this);
        }
        return origFnToString.call(this);
      };
      nativeLabels.set(customToString, 'function toString() { [native code] }');
      try {
        Object.defineProperty(Function.prototype, 'toString', {
          value: customToString,
          writable: true,
          configurable: true,
        });
      } catch {}
      const cloakFn = (fn, name = '') => {
        if (typeof fn === 'function') {
          nativeLabels.set(fn, `function ${name}() { [native code] }`);
        }
        return fn;
      };

      // Clean lingering automation globals if any.
      // Only ChromeDriver-style markers are removed here: Playwright keeps its binding/exposeFunction
      // registry on `__playwright*` globals, and deleting those silently kills every exposed binding
      // (the journey recorder's step capture, the live rrweb bridge) without any error surfacing.
      for (const k of Object.keys(window)) {
        if (/^(cdc_|domAutomation)/i.test(k)) {
          try { delete window[k]; } catch {}
        }
      }

      // Remove/mask navigator.webdriver on prototype with native-cloaked getter
      try {
        const wdGetter = cloakFn(() => false, 'get webdriver');
        Object.defineProperty(Navigator.prototype, 'webdriver', { get: wdGetter, configurable: true });
      } catch {}

      // Ensure realistic outerWidth / outerHeight in headless Chromium
      if (window.outerWidth === 0 || window.outerHeight === 0) {
        try {
          Object.defineProperty(window, 'outerWidth', { get: cloakFn(() => window.innerWidth || w, 'get outerWidth'), configurable: true });
          Object.defineProperty(window, 'outerHeight', { get: cloakFn(() => (window.innerHeight || h) + 84, 'get outerHeight'), configurable: true });
        } catch {}
      }

      if (isChrome) {
        if (!window.chrome) window.chrome = {};
        if (!window.chrome.app) {
          window.chrome.app = { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } };
        }
        if (!window.chrome.csi) window.chrome.csi = cloakFn(() => ({ onloadT: Date.now(), pageT: 1200, startE: Date.now() - 1200, tran: 15 }), 'csi');
        if (!window.chrome.loadTimes) window.chrome.loadTimes = cloakFn(() => ({ commitLoadTime: Date.now() / 1000, connectionInfo: 'h2', finishLoadTime: Date.now() / 1000, firstPaintTime: Date.now() / 1000, requestTime: Date.now() / 1000, wasFetchedViaSpdy: true, wasNpnNegotiated: true }), 'loadTimes');
        if (!window.chrome.runtime) {
          window.chrome.runtime = { OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update' }, PlatformOs: { WIN: 'win', MAC: 'mac', LINUX: 'linux', ANDROID: 'android' } };
        }

        // Sanitize navigator.userAgentData (Client Hints API) so "HeadlessChrome" never leaks to Google Sodar / Cloudflare
        try {
          const uaMatch = (navigator.userAgent || '').match(/Chrome\/((\d+)\.\d+\.\d+\.\d+)/);
          const fullVer = uaMatch ? uaMatch[1] : '145.0.7632.6';
          const majorVer = uaMatch ? uaMatch[2] : '145';
          const platformName = isWinHost ? 'Windows' : isMacHost ? 'macOS' : 'Linux';
          const cleanBrands = [
            { brand: 'Not:A-Brand', version: '99' },
            { brand: 'Google Chrome', version: majorVer },
            { brand: 'Chromium', version: majorVer },
          ];
          const cleanFullList = [
            { brand: 'Not:A-Brand', version: '99.0.0.0' },
            { brand: 'Google Chrome', version: fullVer },
            { brand: 'Chromium', version: fullVer },
          ];
          const isMob = /Mobile|Android|iPhone/i.test(navigator.userAgent || '');
          const fakeUaData = {
            brands: cleanBrands,
            mobile: isMob,
            platform: platformName,
            toJSON: cloakFn(() => ({ brands: cleanBrands, mobile: isMob, platform: platformName }), 'toJSON'),
            getHighEntropyValues: cloakFn(async hints => {
              const out = { brands: cleanBrands, mobile: isMob, platform: platformName };
              const list = Array.isArray(hints) ? hints : [];
              if (list.includes('architecture')) out.architecture = 'x86';
              if (list.includes('bitness')) out.bitness = '64';
              if (list.includes('model')) out.model = '';
              if (list.includes('platformVersion')) out.platformVersion = isWinHost ? '15.0.0' : '14.4.0';
              if (list.includes('uaFullVersion')) out.uaFullVersion = fullVer;
              if (list.includes('fullVersionList')) out.fullVersionList = cleanFullList;
              if (list.includes('wow64')) out.wow64 = false;
              return out;
            }, 'getHighEntropyValues'),
          };
          Object.defineProperty(Navigator.prototype, 'userAgentData', {
            get: cloakFn(() => fakeUaData, 'get userAgentData'),
            configurable: true,
          });
        } catch {}

        // Ensure WebGL2RenderingContext matches WebGL1 vendor/renderer
        try {
          if (typeof WebGL2RenderingContext !== 'undefined' && WebGL2RenderingContext.prototype.getParameter) {
            const origGl2GetParam = WebGL2RenderingContext.prototype.getParameter;
            const gl2GetParam = cloakFn(function (param) {
              if (param === 37445) return isWinHost ? 'Google Inc. (Intel)' : (isMacHost ? 'Intel Inc.' : origGl2GetParam.call(this, param));
              if (param === 37446) return isWinHost ? 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' : (isMacHost ? 'Intel Iris OpenGL Engine' : origGl2GetParam.call(this, param));
              return origGl2GetParam.call(this, param);
            }, 'getParameter');
            WebGL2RenderingContext.prototype.getParameter = gl2GetParam;
          }
        } catch {}

        // Realistic PDF plugin entries if missing in headless desktop
        if (!navigator.plugins || navigator.plugins.length === 0) {
          try {
            const fakePlugins = [
              { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
              { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
              { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            ];
            Object.defineProperty(Navigator.prototype, 'plugins', { get: cloakFn(() => fakePlugins, 'get plugins'), configurable: true });
          } catch {}
        }
      }

      // Consistent hardware hints & network connection
      if (!navigator.hardwareConcurrency || navigator.hardwareConcurrency < 2) {
        try { Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: cloakFn(() => coresVal, 'get hardwareConcurrency'), configurable: true }); } catch {}
      }
      if (typeof navigator.deviceMemory === 'undefined') {
        try { Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: cloakFn(() => memVal, 'get deviceMemory'), configurable: true }); } catch {}
      }
      if (!navigator.connection) {
        try {
          Object.defineProperty(Navigator.prototype, 'connection', {
            get: cloakFn(() => ({ effectiveType: '4g', rtt: rttVal, downlink: downlinkVal, saveData: false }), 'get connection'),
            configurable: true,
          });
        } catch {}
      }

      // Safe permissions.query handler for notifications/clipboard checks
      if (navigator.permissions && typeof navigator.permissions.query === 'function') {
        const origQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = cloakFn(params => {
          if (params && params.name === 'notifications') {
            return Promise.resolve({ state: typeof Notification !== 'undefined' ? Notification.permission : 'default', onchange: null });
          }
          return origQuery(params).catch(() => ({ state: 'prompt', onchange: null }));
        }, 'query');
      }

      // Deterministic per-session subtle Canvas & Audio noise with native toString cloak
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = cloakFn(function (...args) {
        try {
          const ctx2d = this.getContext && this.getContext('2d');
          if (ctx2d && this.width > 4 && this.height > 4 && this.width <= 600 && this.height <= 400) {
            const img = ctx2d.getImageData(0, 0, 2, 2);
            img.data[0] = (img.data[0] ^ delta) & 255;
            ctx2d.putImageData(img, 0, 0);
          }
        } catch {}
        return origToDataURL.apply(this, args);
      }, 'toDataURL');

      if (typeof AudioBuffer !== 'undefined' && AudioBuffer.prototype.getChannelData) {
        const origGetChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = cloakFn(function (...args) {
          const data = origGetChannelData.apply(this, args);
          try {
            if (data && data.length > 0 && !data.__wtgNoised) {
              data[0] = data[0] + audOff;
              data.__wtgNoised = true;
            }
          } catch {}
          return data;
        }, 'getChannelData');
      }

      // Strip RFC1918 local IP / .local mDNS candidates from WebRTC when running through proxy
      if (isProxied && typeof window.RTCPeerConnection === 'function') {
        const OrigRTC = window.RTCPeerConnection;
        const cleanSdp = sdp => String(sdp || '').replace(/^a=candidate:.*(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|\.local\b).*(\r?\n|$)/gim, '');
        window.RTCPeerConnection = cloakFn(function (...rtcArgs) {
          const pc = new OrigRTC(...rtcArgs);
          const origAddEvent = pc.addEventListener.bind(pc);
          pc.addEventListener = cloakFn(function (type, listener, opts) {
            if (type === 'icecandidate' && typeof listener === 'function') {
              return origAddEvent(type, ev => {
                const cand = ev?.candidate?.candidate || '';
                if (/(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|\.local\b)/i.test(cand)) return;
                listener(ev);
              }, opts);
            }
            return origAddEvent(type, listener, opts);
          }, 'addEventListener');
          const origCreateOffer = pc.createOffer.bind(pc);
          pc.createOffer = cloakFn(async (...oArgs) => {
            const offer = await origCreateOffer(...oArgs);
            if (offer && offer.sdp) offer.sdp = cleanSdp(offer.sdp);
            return offer;
          }, 'createOffer');
          return pc;
        }, 'RTCPeerConnection');
        window.RTCPeerConnection.prototype = OrigRTC.prototype;
      }
    } catch {}
  }, {
    isChrome: isChromium,
    coresVal: cores,
    memVal: memGb,
    rttVal: rttMs,
    downlinkVal: downlinkMbps,
    delta: noiseDelta,
    audOff: audioOffset,
    isProxied: Boolean(proxied),
    w: vpW,
    h: vpH,
    isWinHost: IS_WIN,
    isMacHost: IS_MAC,
  }).catch(() => {});
}

/**
 * Optional bandwidth/RAM saver routing for massive concurrent sessions.
 */
const PROXY_SAVER_BLOCKED_HOSTS = [
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'connect.facebook.net',
  'analytics.tiktok.com',
  'ads-twitter.com',
  'snap.licdn.com',
  'posthog.com',
  'hotjar.com',
  'clarity.ms',
  'fullstory.com',
  'logrocket.com',
  'lr-ingest.io',
  'sentry.io',
  'sentry-cdn.com',
  'datadoghq.com',
  'newrelic.com',
  'nr-data.net',
  'bugsnag.com',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'amplitude.com',
  'cookielaw.org',
  'onetrust.com',
  'convertexperiments.com',
  'ubembed.com',
  'intercom.io',
  'intercomcdn.com',
  'crisp.chat',
  'zdassets.com',
  'neuro-id.com',
  'cello.so',
  'heapanalytics.com',
  'pendo.io',
  'braze.com',
  'optimizely.com',
  'youtube.com',
  'youtube-nocookie.com',
  'ytimg.com',
  'vimeo.com',
  'vimeocdn.com',
  'doubleverify.com',
  'moatads.com',
  'criteo.com',
  'criteo.net',
  'taboola.com',
  'outbrain.com',
  'adnxs.com',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'casalemedia.com',
  'yandex.ru',
  'yastatic.net',
  'mc.yandex.ru',
  'an.yandex.ru',
];

const CAPTCHA_AUTH_SAFE_HOST_RE = /(?:recaptcha|hcaptcha|turnstile|arkoselabs|funcaptcha|geetest|accounts\.google\.com|challenges\.cloudflare\.com)/i;

// Attribution allowlist (fix #3): affiliate/partner networks live on tiny tracking pixels & beacons.
// Blocking them in saving modes silently breaks conversion attribution, so these stay untouched.
const ATTRIBUTION_HOST_RE = /(?:cdnflyer|lnksforyou|mobilerewards|getgokart|brownboots|spassvault|mssh|prizepromote|rewardspark|reward4spot|displayoptoffers|uplevelrewards|impact|clickbank|cpagrip|cpalead|ogads|adsterra|monetag|propellerads|hilltopads|adcash|zeydoo|looty|offerwall|firead|proppeller)$/i;
const ATTRIBUTION_PATH_RE = /(?:view\.php|\/track(?:er|ing)?\b|\/pixel|\/collect\b|\/postback|\/beacon|\/conversion|\/aff(?:iliate)?\b|\/click\b|(?:^|\/)s\/[a-z0-9]{6,}|[?&](?:click_?id|sub_?id|aff_?id|pub_id|transaction_id|s2s)=)/i;
function isAttributionRequest(hostname = '', pathname = '', search = '') {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  if (ATTRIBUTION_HOST_RE.test(getRootDomain(h)) || ATTRIBUTION_HOST_RE.test(h)) return true;
  return ATTRIBUTION_PATH_RE.test(`${pathname || ''}${search || ''}`);
}
const STATIC_ASSET_MAX_BYTES = 4 * 1024 * 1024;
const STATIC_CACHE_MAX_TOTAL_BYTES = 24 * 1024 * 1024; // Small hot RAM mirror; main cache lives on SSD SQLite!
const staticBundleCache = new Map(); // url -> { body, headers, size, ts }
const inFlightStaticFetches = new Map();
let staticCacheTotalBytes = 0;
const proxySaverStats = {
  blockedRequests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  savedBytes: 0,
};

const EMPTY_PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);
const PUBLIC_CDN_HOST_REGEX = /(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|ajax\.googleapis\.com|www\.gstatic\.com|code\.jquery\.com|stackpath\.bootstrapcdn\.com)$/i;
const HEAVY_PAYLOAD_REGEX = /\.(?:m3u8|mpd|ts|m4s|mp4|webm|ogg|mp3|wav|woff2?|ttf|eot|map|wasm|lottie|avif|pdf|zip)(?:\?|$)/i;

let assetDbHandle = null;
let assetGetStmt = null;
let assetSetStmt = null;
function getAssetSqliteStmts() {
  if (!DatabaseSync) return null;
  if (assetGetStmt && assetSetStmt) return { get: assetGetStmt, set: assetSetStmt };
  try {
    const reportsDir = path.join(__dirname, '..', 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    assetDbHandle = new DatabaseSync(path.join(reportsDir, 'asset-cache.sqlite'));
    assetDbHandle.exec(`
      CREATE TABLE IF NOT EXISTS http_cache (
        url_key TEXT PRIMARY KEY,
        headers_json TEXT,
        body BLOB,
        size INTEGER,
        created_at INTEGER
      );
    `);
    assetGetStmt = assetDbHandle.prepare('SELECT headers_json, body, size FROM http_cache WHERE url_key = ?');
    assetSetStmt = assetDbHandle.prepare('INSERT OR REPLACE INTO http_cache (url_key, headers_json, body, size, created_at) VALUES (?, ?, ?, ?, ?)');
    return { get: assetGetStmt, set: assetSetStmt };
  } catch {
    return null;
  }
}

function normalizeAssetKey(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete('_');
    u.searchParams.delete('t');
    u.searchParams.delete('cb');
    u.searchParams.delete('rnd');
    return u.origin + u.pathname + u.search;
  } catch {
    return String(rawUrl || '').split('#')[0];
  }
}

function getRootDomain(hostname = '') {
  const clean = String(hostname || '').toLowerCase().replace(/^www\./, '');
  const parts = clean.split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : clean;
}

function isBlockedTrackerHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (CAPTCHA_AUTH_SAFE_HOST_RE.test(h)) return false;
  return PROXY_SAVER_BLOCKED_HOSTS.some(b => h === b || h.endsWith(`.${b}`));
}

function isCacheableStaticBundle(urlStr, rType) {
  if (!urlStr || !/^https?:\/\//i.test(urlStr)) return false;
  if (rType !== 'script' && rType !== 'stylesheet') return false;
  if (CAPTCHA_AUTH_SAFE_HOST_RE.test(urlStr)) return false;
  if (/\/(?:api|oauth|auth|token|graphql|login|signup|webhook|session|collect|pixel|beacon|telemetry)\b/i.test(urlStr)) return false;
  if (/[?&](?:token|code|auth|sig|nonce|state|session|ticket|cb|cachebust|_)=/i.test(urlStr)) return false;
  const pathPart = urlStr.split('?')[0].split('#')[0];
  return (
    /\/(?:_next\/static|static|assets|builds|chunks?|dist|build|webpack)\//i.test(urlStr) ||
    /\.(?:chunk|bundle|min)\.(?:js|mjs|css)(?:\?|$)/i.test(urlStr) ||
    /^https:\/\/js\.stripe\.com\/v\d/i.test(urlStr) ||
    /\.(?:js|mjs|css)$/i.test(pathPart)
  );
}

function setStaticCacheEntry(key, entry) {
  if (!entry || !entry.body || entry.size <= 0 || entry.size > STATIC_ASSET_MAX_BYTES) return;
  try {
    const stmts = getAssetSqliteStmts();
    if (stmts) {
      stmts.set.run(key, JSON.stringify(entry.headers || {}), entry.body, entry.size, Date.now());
    }
  } catch {}
  if (staticBundleCache.has(key)) {
    staticCacheTotalBytes -= staticBundleCache.get(key).size;
    staticBundleCache.delete(key);
  }
  while (staticCacheTotalBytes + entry.size > STATIC_CACHE_MAX_TOTAL_BYTES && staticBundleCache.size > 0) {
    const oldestKey = staticBundleCache.keys().next().value;
    const oldVal = staticBundleCache.get(oldestKey);
    staticCacheTotalBytes -= oldVal?.size || 0;
    staticBundleCache.delete(oldestKey);
  }
  staticBundleCache.set(key, entry);
  staticCacheTotalBytes += entry.size;
}

function getStaticCacheEntry(key) {
  const mem = staticBundleCache.get(key);
  if (mem) return mem;
  try {
    const stmts = getAssetSqliteStmts();
    if (!stmts) return null;
    const row = stmts.get.get(key);
    if (row && row.body) {
      const headers = JSON.parse(row.headers_json || '{}');
      return {
        body: Buffer.from(row.body),
        headers,
        size: Number(row.size || row.body.length || 0),
        ts: Date.now(),
      };
    }
  } catch {}
  return null;
}

function getProxySaverStats() {
  return {
    ...proxySaverStats,
    cachedFiles: staticBundleCache.size,
    cacheRamMb: Number((staticCacheTotalBytes / (1024 * 1024)).toFixed(2)),
    savedMb: Number((proxySaverStats.savedBytes / (1024 * 1024)).toFixed(2)),
  };
}

async function applyResourceMode(context, resourceMode = 'full') {
  if (!context || !['lite', 'ultra_lite', 'browserless_cdp', 'lightpanda_cdp'].includes(resourceMode)) return;
  if (context.__wtgResourceRouteInstalled) return;
  context.__wtgResourceRouteInstalled = true;

  const isUltra = resourceMode === 'ultra_lite' || resourceMode === 'lightpanda_cdp';
  // 'ping' (navigator.sendBeacon) is exempted in every mode: a few hundred bytes, and blocking it
  // silently kills affiliate attribution beacons.
  const blockedTypes = isUltra
    ? new Set(['image', 'media', 'font', 'texttrack', 'manifest', 'csp_report'])
    : new Set(['media', 'font', 'texttrack', 'manifest', 'csp_report']);

  // Clean browser hygiene: Clipboard shim (prevents NotAllowedError noise) + CSS font suppression in lite/ultra_lite
  await context.addInitScript(modeName => {
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText = async () => Promise.resolve();
        navigator.clipboard.readText = async () => Promise.resolve('');
      }
      if (modeName === 'lite' || modeName === 'ultra_lite' || modeName === 'lightpanda_cdp') {
        const injectFontKiller = () => {
          if (document.getElementById('__lab_font_killer')) return;
          const st = document.createElement('style');
          st.id = '__lab_font_killer';
          st.textContent = '* { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important; }';
          (document.head || document.documentElement)?.appendChild(st);
        };
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', injectFontKiller, { once: true });
        } else {
          injectFontKiller();
        }
      }
    } catch {}
  }, resourceMode).catch(() => {});

  const fulfillMockBlocked = (route, rType) => {
    proxySaverStats.blockedRequests++;
    proxySaverStats.savedBytes += rType === 'image' ? 45000 : 80000;
    if (rType === 'image') {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=31536000' },
        body: EMPTY_PNG_BUFFER,
      }).catch(() => {});
    }
    return route.fulfill({
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=31536000' },
      body: Buffer.alloc(0),
    }).catch(() => {});
  };

  await context.route('**/*', async route => {
    try {
      const req = route.request();
      const url = req.url();
      const rType = req.resourceType();
      const method = req.method();
      let parsedUrl = null;
      try {
        parsedUrl = new URL(url);
      } catch {}

      if (parsedUrl && (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:')) {
        if (!CAPTCHA_AUTH_SAFE_HOST_RE.test(parsedUrl.hostname) && !isAttributionRequest(parsedUrl.hostname, parsedUrl.pathname, parsedUrl.search)) {
          if (blockedTypes.has(rType)) {
            return fulfillMockBlocked(route, rType);
          }
          if (!isUltra && rType === 'image') {
            let pageRoot = '';
            try {
              const fUrl = req.frame()?.url?.();
              if (fUrl && fUrl.startsWith('http')) {
                pageRoot = getRootDomain(new URL(fUrl).hostname);
              }
            } catch {}
            const imgRoot = getRootDomain(parsedUrl.hostname);
            if (pageRoot && imgRoot && imgRoot !== pageRoot) {
              return fulfillMockBlocked(route, 'image');
            }
          }
          if (HEAVY_PAYLOAD_REGEX.test(parsedUrl.pathname)) {
            return fulfillMockBlocked(route, rType === 'image' ? 'image' : 'media');
          }
          if (isBlockedTrackerHost(parsedUrl.hostname)) {
            proxySaverStats.blockedRequests++;
            proxySaverStats.savedBytes += 65000;
            return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' }, body: Buffer.alloc(0) }).catch(() => {});
          }
        }

        // Serve static JS & CSS from SQLite SSD Cache (+ RAM mirror) or Split-Tunnel public CDNs directly
        if (method === 'GET' && isCacheableStaticBundle(url, rType)) {
          const cacheKey = normalizeAssetKey(url);
          const cached = getStaticCacheEntry(cacheKey);
          if (cached) {
            proxySaverStats.cacheHits++;
            proxySaverStats.savedBytes += cached.size;
            return route.fulfill({
              status: 200,
              headers: { ...cached.headers, 'x-wtg-cache': '1' },
              body: cached.body,
            }).catch(() => route.continue().catch(() => {}));
          }

          if (PUBLIC_CDN_HOST_REGEX.test(parsedUrl.hostname)) {
            try {
              const directRes = await fetch(url);
              if (directRes.ok) {
                const body = Buffer.from(await directRes.arrayBuffer());
                const ct = directRes.headers.get('content-type') || (rType === 'stylesheet' ? 'text/css' : 'application/javascript');
                const cleanHeaders = { 'content-type': ct, 'Access-Control-Allow-Origin': '*' };
                setStaticCacheEntry(cacheKey, { body, headers: cleanHeaders, size: body.length, ts: Date.now() });
                proxySaverStats.cacheHits++;
                proxySaverStats.savedBytes += body.length;
                return route.fulfill({
                  status: 200,
                  headers: { ...cleanHeaders, 'x-wtg-cache': '1' },
                  body,
                }).catch(() => {});
              }
            } catch {}
          }

          if (inFlightStaticFetches.has(cacheKey)) {
            const sharedEntry = await inFlightStaticFetches.get(cacheKey).catch(() => null);
            if (sharedEntry) {
              proxySaverStats.cacheHits++;
              proxySaverStats.savedBytes += sharedEntry.size;
              return route.fulfill({
                status: 200,
                headers: { ...sharedEntry.headers, 'x-wtg-cache': '1' },
                body: sharedEntry.body,
              }).catch(() => route.continue().catch(() => {}));
            }
          } else {
            let resolveFlight;
            const flightPromise = new Promise(r => { resolveFlight = r; });
            inFlightStaticFetches.set(cacheKey, flightPromise);
            try {
              const resp = await route.fetch({ maxRedirects: 4, timeout: 15000 });
              const status = resp.status();
              const headers = resp.headers();
              const cc = String(headers['cache-control'] || '').toLowerCase();
              const body = await resp.body();
              const cleanHeaders = { ...headers };
              delete cleanHeaders['content-encoding'];
              delete cleanHeaders['content-length'];
              delete cleanHeaders['transfer-encoding'];
              let storedEntry = null;
              if (status === 200 && body && body.length >= 1024 && body.length <= STATIC_ASSET_MAX_BYTES && !cc.includes('no-store')) {
                storedEntry = { body, headers: cleanHeaders, size: body.length, ts: Date.now() };
                setStaticCacheEntry(cacheKey, storedEntry);
                proxySaverStats.cacheMisses++;
              }
              resolveFlight(storedEntry);
              inFlightStaticFetches.delete(cacheKey);
              return route.fulfill({
                status,
                headers: cleanHeaders,
                body,
              }).catch(() => {});
            } catch {
              resolveFlight(null);
              inFlightStaticFetches.delete(cacheKey);
            }
          }
        }
      }
    } catch {}
    return route.continue().catch(() => {});
  }).catch(() => {});
}

const { execFile } = require('child_process');

function getLauncher(engine) {
  if (engine === 'camoufox') return require('./camoufoxEngine');
  if (engine === 'patchright') return getPatchrightChromium();
  if (engine === 'firefox') return firefox;
  if (engine === 'webkit') return webkit;
  return getStealthChromium();
}

let lastRaiseAt = 0;
function raisePlaywrightWindowsWin32() {
  if (process.platform !== 'win32') return;
  const now = Date.now();
  if (now - lastRaiseAt < 1500) return;
  lastRaiseAt = now;

  const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class WtgRaise {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  public static void Raise(int[] pids) {
    var set = new HashSet<int>(pids);
    var HWND_TOPMOST = new IntPtr(-1);
    var HWND_NOTOPMOST = new IntPtr(-2);
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (set.Contains((int)pid) && IsWindowVisible(h)) {
        RECT r; GetWindowRect(h, out r);
        if ((r.R - r.L) >= 220 && (r.B - r.T) >= 220) {
          ShowWindow(h, 9);
          SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, 0x0043);
          SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, 0x0043);
        }
      }
      return true;
    }, IntPtr.Zero);
  }
}
"@
$pids = @(Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%remote-debugging-pipe%' OR CommandLine LIKE '%juggler-pipe%' OR CommandLine LIKE '%inspector-pipe%'" | Select-Object -ExpandProperty ProcessId)
if ($pids.Count -gt 0) { [WtgRaise]::Raise($pids) }
`;
  const child = execFile(
    'powershell.exe',
    ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    { windowsHide: true },
    () => {}
  );
  child.unref();
}

// Shared browser pool keyed by engine + headless + proxyMode (single browser process, per-context isolation)
const sharedBrowsers = new Map();
const launchingBrowsers = new Map();

async function getSharedBrowser(engine, headless, proxy, { stealthMode = 'standard', resourceMode = 'full' } = {}) {
  if (engine === 'chromium' && !proxy && ['browserless_cdp', 'lightpanda_cdp'].includes(resourceMode)) {
    try {
      const stealthArgs = getChromiumStealthArgs(headless, { stealthMode, proxied: false });
      return await getCdpBrowserConnection({ mode: resourceMode, headless, proxy: null, stealthArgs });
    } catch {}
  }
  const supportsContextProxy = engine === 'chromium' || engine === 'firefox' || engine === 'patchright' || engine === 'camoufox';
  const proxyKey = proxy
    ? (supportsContextProxy ? 'proxied-pool' : `${proxy.server}|${proxy.username || ''}`)
    : 'direct';
  // Real Chrome (`channel: 'chrome'`) brings a genuine TLS/HTTP2 stack, a real GPU profile and no
  // automation build flags, which datacenter-facing WAFs score far better than bundled Chromium.
  // The automatic fallback below keeps machines without Chrome working exactly as before.
  const preferRealChrome = (engine === 'chromium' || engine === 'patchright') && process.env.WTG_BROWSER_CHANNEL !== 'bundle';
  const key = `${engine}|${headless ? 'hl' : 'hd'}|${stealthMode}|${preferRealChrome ? 'chrome' : 'bundle'}|${proxyKey}`;
  const existing = sharedBrowsers.get(key);
  if (existing && existing.isConnected()) return existing;
  if (launchingBrowsers.has(key)) return launchingBrowsers.get(key);

  const launcher = getLauncher(engine);
  // Camoufox (Firefox) accepts a per-context proxy — verified live — so it must NOT receive the
  // Chromium-only `http://per-context` placeholder as a browser-level proxy.
  const browserLevelProxy = proxy && engine !== 'camoufox'
    ? (supportsContextProxy ? { server: proxy.server || 'http://per-context' } : proxy)
    : undefined;
  const launchOpts = {
    headless,
    ...((engine === 'chromium' || engine === 'patchright') ? { args: getChromiumStealthArgs(headless, { stealthMode, proxied: Boolean(proxy) }) } : {}),
    ...(browserLevelProxy ? { proxy: browserLevelProxy } : {}),
  };
  const launchOnce = async (opts) => {
    try {
      return await launcher.launch(opts);
    } catch (err) {
      if (opts.channel) {
        console.log('[Browser] ערוץ Chrome המותקן לא זמין — חוזר אוטומטית ל-Chromium המצורף.');
        const { channel, ...rest } = opts;
        return launcher.launch(rest);
      }
      throw err;
    }
  };
  const p = launchOnce({ ...launchOpts, ...(preferRealChrome ? { channel: 'chrome' } : {}) })
    .then(b => {
      sharedBrowsers.set(key, b);
      launchingBrowsers.delete(key);
      return b;
    })
    .catch(err => {
      launchingBrowsers.delete(key);
      throw err;
    });
  launchingBrowsers.set(key, p);
  return p;
}

async function closeAllSharedBrowsers() {
  for (const b of sharedBrowsers.values()) {
    await b.close().catch(() => {});
  }
  sharedBrowsers.clear();
  await closeAllCdpDaemons().catch(() => {});
}

// ─── Persistent profile slot manager ──────────────────────────────────────────

const activeProfileSlots = new Set();
const BROWSER_DATA_ROOT = path.join(
  process.env.LOCALAPPDATA || require('os').tmpdir(),
  'wtg-browser-profiles'
);

function acquireProfileSlot({ enabled, returningUserRate, profilePoolSize, profilesDir, countryCode = null, locale = null, prefix = '' }) {
  if (!enabled) return null;
  fs.mkdirSync(profilesDir, { recursive: true });
  fs.mkdirSync(BROWSER_DATA_ROOT, { recursive: true });
  const poolSize = Math.max(1, parseInt(String(profilePoolSize ?? 10), 10) || 10);
  const rate = Math.min(1, Math.max(0, Number(returningUserRate ?? 50) / 100));
  const cleanPrefix = String(prefix || '').replace(/[^a-zA-Z0-9_-]/g, '');

  const matchingExisting = [];
  const otherExisting = [];
  const empty = [];
  for (let slot = 1; slot <= poolSize; slot++) {
    const slotKey = `${cleanPrefix}${slot}`;
    if (activeProfileSlots.has(slotKey)) continue;
    const name = `persistent_${cleanPrefix}${String(slot).padStart(2, '0')}`;
    const dir = path.join(profilesDir, name);
    const userDataDir = path.join(BROWSER_DATA_ROOT, name);
    const metaPath = path.join(dir, 'profile-meta.json');
    if (fs.existsSync(metaPath)) {
      let geoMatches = true;
      if (countryCode || locale) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          if (countryCode && meta.countryCode && meta.countryCode !== countryCode) {
            geoMatches = false;
          } else if (locale && meta.locale && meta.locale !== locale) {
            geoMatches = false;
          } else if (countryCode && !meta.countryCode && meta.locale && locale && meta.locale !== locale) {
            geoMatches = false;
          }
        } catch {}
      }
      const entry = { slot, slotKey, dir, userDataDir, metaPath, isReturning: geoMatches };
      if (geoMatches) matchingExisting.push(entry);
      else otherExisting.push(entry);
    } else {
      empty.push({ slot, slotKey, dir, userDataDir, metaPath, isReturning: false });
    }
  }

  let chosen = null;
  if (matchingExisting.length && (Math.random() < rate || !empty.length)) {
    chosen = matchingExisting[Math.floor(Math.random() * matchingExisting.length)];
  } else if (empty.length) {
    chosen = empty[Math.floor(Math.random() * empty.length)];
  } else if (matchingExisting.length) {
    chosen = matchingExisting[Math.floor(Math.random() * matchingExisting.length)];
  } else if (otherExisting.length) {
    chosen = otherExisting[Math.floor(Math.random() * otherExisting.length)];
  }

  if (chosen) activeProfileSlots.add(chosen.slotKey ?? chosen.slot);
  return chosen;
}

function releaseProfileSlot(slotInfo) {
  if (slotInfo) activeProfileSlots.delete(slotInfo.slotKey ?? slotInfo.slot);
}

function listSavedProfiles(profilesDir) {
  if (!fs.existsSync(profilesDir)) return [];
  const entries = fs.readdirSync(profilesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const out = [];
  for (const ent of entries) {
    if (ent.isDirectory() && ent.name.startsWith('persistent_')) {
      const dir = path.join(profilesDir, ent.name);
      const metaPath = path.join(dir, 'profile-meta.json');
      const statePath = path.join(dir, 'storage-state.json');
      let meta = {};
      let cookiesCount = 0;
      let originsCount = 0;
      try {
        if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (fs.existsSync(statePath)) {
          const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          cookiesCount = Array.isArray(st.cookies) ? st.cookies.length : 0;
          originsCount = Array.isArray(st.origins) ? st.origins.length : 0;
        }
      } catch {}
      const stat = fs.statSync(dir);
      out.push({
        name: ent.name,
        type: 'persistent-context',
        deviceKey: meta.deviceKey || 'unknown',
        engine: meta.engine || 'chromium',
        cookiesCount,
        originsCount,
        visitsCount: meta.visitsCount || 1,
        updatedAt: stat.mtime.toISOString(),
      });
    } else if (ent.isFile() && ent.name.endsWith('.json')) {
      const fp = path.join(profilesDir, ent.name);
      const stat = fs.statSync(fp);
      let cookiesCount = 0;
      let originsCount = 0;
      try {
        const st = JSON.parse(fs.readFileSync(fp, 'utf8'));
        cookiesCount = Array.isArray(st.cookies) ? st.cookies.length : 0;
        originsCount = Array.isArray(st.origins) ? st.origins.length : 0;
      } catch {}
      out.push({
        name: ent.name,
        type: 'storage-state',
        deviceKey: 'mixed',
        engine: 'playwright',
        cookiesCount,
        originsCount,
        visitsCount: 1,
        updatedAt: stat.mtime.toISOString(),
      });
    }
  }
  return out;
}

function clearSavedProfiles(profilesDir) {
  if (fs.existsSync(profilesDir)) {
    for (const ent of fs.readdirSync(profilesDir, { withFileTypes: true })) {
      const full = path.join(profilesDir, ent.name);
      fs.rmSync(full, { recursive: true, force: true });
    }
  }
  if (fs.existsSync(BROWSER_DATA_ROOT)) {
    fs.rmSync(BROWSER_DATA_ROOT, { recursive: true, force: true });
  }
}

/**
 * Opens either a Persistent Context (when sessionPersistence is enabled)
 * or an ephemeral Fingerprint-Injected Context for a visit.
 */
async function openSessionContext({
  deviceWeights,
  headless = true,
  proxy = null,
  sessionSlot = null,
  referrer = '',
  geo = null,
  stealthMode = 'standard',
  resourceMode = 'full',
  sessionSeed = null,
  browserEngine = 'chromium',
  deviceKey: pinnedDeviceKey = null,
}) {
  // The launcher is derived from the requested engine and nothing else. It used to be taken from
  // the randomly-picked device spec, so browserEngine:'chromium' could launch Firefox while the
  // dashboard, the report and the caller all believed they were looking at Chromium.
  const launchEngine = browserEngine === 'patchright' ? 'patchright'
    : browserEngine === 'camoufox' ? 'camoufox'
      : browserEngine === 'firefox' ? 'firefox'
        : browserEngine === 'webkit' ? 'webkit'
          : 'chromium';
  const camoufoxForced = launchEngine === 'camoufox';
  // The device spec must come from the same engine family as the launcher, otherwise the
  // fingerprint, the user agent and the binary contradict each other.
  // The caller (crawleeRunner) picks the device once per visit and records it in the report.
  // Re-drawing here would make the logged device a different coin flip from the real one.
  const pinnedAllowed = pinnedDeviceKey && DEVICE_SPECS[pinnedDeviceKey]
    && DEVICE_SPECS[pinnedDeviceKey].engine === specEngineFor(launchEngine);
  let deviceKey = pinnedAllowed ? pinnedDeviceKey : pickDeviceKeyForEngine(deviceWeights, launchEngine);
  let fpBundle = null;
  let meta = null;

  if (sessionSlot && sessionSlot.isReturning) {
    try {
      meta = JSON.parse(fs.readFileSync(sessionSlot.metaPath, 'utf8'));
      const geoMismatch = Boolean(
        (geo?.countryCode && meta.countryCode && meta.countryCode !== geo.countryCode) ||
        (geo?.locale && meta.locale && meta.locale !== geo.locale)
      );
      if (meta.deviceKey && DEVICE_SPECS[meta.deviceKey]
        && DEVICE_SPECS[meta.deviceKey].engine === specEngineFor(launchEngine)
        && (DEVICE_SPECS[meta.deviceKey].hostConsistent || IS_MAC) && !geoMismatch) {
        deviceKey = meta.deviceKey;
      } else {
        sessionSlot.isReturning = false;
        meta = null;
      }
      if (meta?.fpBundle && sessionSlot.isReturning && meta.fpSchemaV2 === 3) {
        fpBundle = meta.fpBundle;
      }
    } catch {
      sessionSlot.isReturning = false;
      meta = null;
    }
  }

  const locale = geo?.locale || meta?.locale || 'en-US';
  const timezoneId = geo?.timezoneId || meta?.timezoneId || null;

  const generated = generateDeviceFingerprint(deviceKey, locale);
  const spec = generated.spec;
  const fp = spec.nativeEngine ? null : (fpBundle || generated.fp);
  const viewport = meta?.viewport || generated.viewport;
  const userAgent = spec.nativeEngine
    ? ((launchEngine === 'chromium' || launchEngine === 'patchright') ? getNativeChromeUserAgent(process.env.WTG_BROWSER_CHANNEL !== 'bundle') : undefined)
    : (fp?.fingerprint?.navigator?.userAgent || spec.pwDevice?.userAgent);

  const baseContextOpts = {
    headless,
    viewport,
    ...(userAgent ? { userAgent } : {}),
    ignoreHTTPSErrors: true,
    ...(locale ? { locale } : {}),
    ...(timezoneId ? { timezoneId } : {}),
    ...((launchEngine === 'chromium' || launchEngine === 'patchright') ? { args: getChromiumStealthArgs(headless, { stealthMode, proxied: Boolean(proxy) }) } : {}),
    ...(proxy ? { proxy } : {}),
  };

  if (spec.engine !== 'firefox' && spec.pwDevice?.isMobile) {
    baseContextOpts.isMobile = true;
    baseContextOpts.hasTouch = true;
  }

  let context;

  try {
    let storageStatePath = null;
    if (sessionSlot) {
      fs.mkdirSync(sessionSlot.dir, { recursive: true });
      const candidateStatePath = path.join(sessionSlot.dir, 'storage-state.json');
      if (sessionSlot.isReturning && fs.existsSync(candidateStatePath)) {
        try {
          const parsedState = JSON.parse(fs.readFileSync(candidateStatePath, 'utf8'));
          if (parsedState && typeof parsedState === 'object') {
            storageStatePath = candidateStatePath;
          }
        } catch {}
      }
      const nextMeta = {
        deviceKey,
        engine: launchEngine,
        viewport,
        countryCode: geo?.countryCode || meta?.countryCode || null,
        locale: locale || meta?.locale || null,
        timezoneId: timezoneId || meta?.timezoneId || null,
        fpSchemaV2: 3,
        fpBundle: fp,
        visitsCount: (meta?.visitsCount || 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(sessionSlot.metaPath, JSON.stringify(nextMeta), 'utf8');
    }

    const browser = await getSharedBrowser(launchEngine, headless, proxy, { stealthMode, resourceMode });
    const { headless: _hl, args: _args, ...ctxOpts } = baseContextOpts;
    if (storageStatePath) {
      ctxOpts.storageState = storageStatePath;
    }
    context = await browser.newContext(ctxOpts);

    if (fp) {
      await getFpInjector().attachFingerprintToPlaywright(context, fp).catch(() => {});
    }

    const derivedSeed = Number.isFinite(Number(sessionSeed))
      ? Number(sessionSeed)
      : (sessionSlot?.slot ? Number(sessionSlot.slot) * 7919 : Math.floor(Math.random() * 100000));

    if (camoufoxForced) {
      // Camoufox spoofs navigator/plugins at the engine level; extra JS evasions here would
      // create a surface that contradicts the real Firefox build it actually runs.
    } else if (stealthMode === 'maximum') {
      await applyMaximumStealth(context, {
        spec,
        proxied: Boolean(proxy),
        seed: derivedSeed,
        viewport,
      });
    } else {
      await context.addInitScript(() => {
        try {
          if (navigator.webdriver) {
            Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
          }
        } catch {}
      }).catch(() => {});
    }

    if (['lite', 'ultra_lite', 'browserless_cdp', 'lightpanda_cdp'].includes(resourceMode)) {
      await applyResourceMode(context, resourceMode);
    }

    const existingPages = context.pages();
    const page = existingPages.length ? existingPages[0] : await context.newPage();

    if (!headless) {
      await page.bringToFront().catch(() => {});
      setTimeout(() => raisePlaywrightWindowsWin32(), 350);
    }

    return {
      context,
      page,
      deviceKey,
      deviceLabel: spec.label,
      engine: launchEngine,
      viewport,
      locale,
      timezoneId,
      referrer: referrer || '',
      isReturning: Boolean(sessionSlot?.isReturning),
      slot: sessionSlot?.slot || null,
      close: async () => {
        if (sessionSlot) {
          await context.storageState({ path: path.join(sessionSlot.dir, 'storage-state.json') }).catch(() => {});
        }
        await context.close().catch(() => {});
        if (sessionSlot) releaseProfileSlot(sessionSlot);
      },
    };
  } catch (err) {
    if (context) await context.close().catch(() => {});
    if (sessionSlot) releaseProfileSlot(sessionSlot);
    throw err;
  }
}

module.exports = {
  DEVICE_SPECS,
  DEFAULT_DEVICE_WEIGHTS,
  pickDeviceKey,
  pickDeviceKeyForEngine,
  generateDeviceFingerprint,
  getChromiumStealthArgs,
  applyMaximumStealth,
  applyResourceMode,
  getProxySaverStats,
  acquireProfileSlot,
  releaseProfileSlot,
  listSavedProfiles,
  clearSavedProfiles,
  openSessionContext,
  closeAllSharedBrowsers,
  raisePlaywrightWindowsWin32,
  getFpGenerator,
  getFpInjector,
  getStealthChromium,
  getCdpIntegrationsStatus,
  getLauncher,
  getNativeChromeUserAgent,
};
