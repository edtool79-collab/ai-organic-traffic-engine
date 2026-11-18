const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const {
  getLauncher,
  getChromiumStealthArgs,
  applyMaximumStealth,
  generateDeviceFingerprint,
  getNativeChromeUserAgent,
} = require('./fingerprintManager');
const { isDisallowedPrivateHost } = require('./pageMapper');
const { toPlaywrightProxy } = require('./proxyManager');
const { isSecretField, redactText } = require('./redaction');
const { detectChallenge } = require('./challengeDetector');

let cachedFinderBrowserScript = null;
function getFinderBrowserScript() {
  if (cachedFinderBrowserScript !== null) return cachedFinderBrowserScript;
  try {
    const finderPath = require.resolve('@medv/finder/finder.js');
    const raw = fs.readFileSync(finderPath, 'utf8')
      .replace(/\bexport\s+(?=function\b|const\b|let\b|var\b)/g, '');
    cachedFinderBrowserScript = `window.__wtgFinder = (() => {\n${raw}\nreturn typeof finder === 'function' ? finder : null;\n})();`;
  } catch {
    cachedFinderBrowserScript = '';
  }
  return cachedFinderBrowserScript;
}

let cachedDesktopSession = null;

function queryDesktopSessionInfoSyncOrAsync() {
  if (process.platform !== 'win32') {
    const info = {
      platform: process.platform,
      isInteractiveDesktop: true,
      windowStation: 'posix',
      currentDesktop: 'posix',
      inputDesktop: 'posix',
    };
    cachedDesktopSession = info;
    return Promise.resolve(info);
  }
  const psScript = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WtgDesktopProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint dwThreadId);
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr hDesktop);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformationW(IntPtr hObj, int nIndex, StringBuilder pvInfo, int nLength, out int lpnLengthNeeded);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  public static string NameOf(IntPtr h) {
    if (h == IntPtr.Zero) return "";
    var sb = new StringBuilder(256);
    int needed = 0;
    if (!GetUserObjectInformationW(h, 2, sb, sb.Capacity * 2, out needed)) return "";
    return sb.ToString();
  }
  public static string Probe() {
    string winsta = NameOf(GetProcessWindowStation());
    string cur = NameOf(GetThreadDesktop(GetCurrentThreadId()));
    IntPtr inpH = OpenInputDesktop(0, false, 1);
    string inp = NameOf(inpH);
    if (inpH != IntPtr.Zero) CloseDesktop(inpH);
    return winsta + "|" + cur + "|" + inp;
  }
}
"@
[WtgDesktopProbe]::Probe()
`;
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 10000 },
      (err, stdout) => {
        if (err) {
          const fallback = {
            platform: 'win32',
            isInteractiveDesktop: true,
            windowStation: 'unknown',
            currentDesktop: 'unknown',
            inputDesktop: 'unknown',
          };
          cachedDesktopSession = fallback;
          return resolve(fallback);
        }
        const parts = String(stdout || '').trim().split('|');
        const windowStation = parts[0] || '';
        const currentDesktop = parts[1] || '';
        const inputDesktop = parts[2] || '';
        const isInteractiveDesktop =
          windowStation.toLowerCase() === 'winsta0' &&
          currentDesktop.toLowerCase() === 'default';
        const info = {
          platform: 'win32',
          isInteractiveDesktop,
          windowStation,
          currentDesktop,
          inputDesktop,
        };
        cachedDesktopSession = info;
        resolve(info);
      }
    );
  });
}

async function getDesktopSessionInfo(forceRefresh = false) {
  if (!forceRefresh && cachedDesktopSession) return cachedDesktopSession;
  return queryDesktopSessionInfoSyncOrAsync();
}

function getCachedDesktopSessionInfo() {
  return cachedDesktopSession;
}

function bringRecorderWindowToFront(targetPid = null) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, raised: 0, reason: 'not_win32' });
  const numericPid = Number.isInteger(targetPid) && targetPid > 0 ? targetPid : 0;
  const pidDiscovery = numericPid > 0
    ? `$pids = @(${numericPid})`
    : `$pids = @(Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%--wtg-recorder-window%'" | Select-Object -ExpandProperty ProcessId)`;
  const psScript = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Text;
public class WtgRecorderRaise {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  public static string Raise(int[] pids) {
    var set = new HashSet<int>(pids);
    var HWND_TOPMOST = new IntPtr(-1);
    var HWND_NOTOPMOST = new IntPtr(-2);
    AllowSetForegroundWindow(-1);
    int raised = 0;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (set.Contains((int)pid) && GetWindow(h, 4) == IntPtr.Zero) {
        var cls = new StringBuilder(64);
        GetClassName(h, cls, 64);
        if (cls.ToString() == "Chrome_WidgetWin_1") {
          RECT rc;
          GetWindowRect(h, out rc);
          int w = rc.R - rc.L;
          int ht = rc.B - rc.T;
          if (!IsIconic(h) && (w < 80 || ht < 80)) return true;
          IntPtr fg = GetForegroundWindow();
          uint fgPid; uint fgTid = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out fgPid) : 0;
          uint curTid = GetCurrentThreadId();
          if (fgTid != 0 && fgTid != curTid) AttachThreadInput(curTid, fgTid, true);
          ShowWindow(h, 9);
          ShowWindow(h, 3);
          BringWindowToTop(h);
          SwitchToThisWindow(h, true);
          SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, 0x0043);
          SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, 0x0043);
          SetForegroundWindow(h);
          if (fgTid != 0 && fgTid != curTid) AttachThreadInput(curTid, fgTid, false);
          raised++;
        }
      }
      return true;
    }, IntPtr.Zero);
    return "RAISED=" + raised;
  }
}
"@
${pidDiscovery}
if ($pids.Count -gt 0) { [WtgRecorderRaise]::Raise([int[]]$pids) } else { "NO_PIDS" }
`;
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 15000 },
      (err, stdout, stderr) => {
        if (err) {
          console.error('[Recorder Focus] error:', stderr || err.message);
          return resolve({ ok: false, raised: 0, reason: stderr || err.message });
        }
        const out = String(stdout || '').trim();
        const match = out.match(/RAISED=(\d+)/);
        const raised = match ? Number(match[1]) : 0;
        resolve({
          ok: raised > 0,
          raised,
          reason: out === 'NO_PIDS' ? 'no_recorder_process' : raised > 0 ? 'raised' : 'no_window_found_in_desktop',
        });
      }
    );
  });
}

let activeSession = null;
let lastState = {
  active: false,
  status: 'idle', // idle | recording | completed | error
  targetUrl: '',
  startedAt: null,
  finishedAt: null,
  currentUrl: '',
  stepCount: 0,
  steps: [],
  error: null,
};

function stripInternalFields(steps) {
  return (steps || []).map(({ _pageUrl, _recordedAt, ...clean }) => ({ ...clean }));
}

function cloneRecorderState() {
  return {
    ...lastState,
    steps: stripInternalFields(lastState.steps),
  };
}

function toStepTarget(rawUrl, startOrigin) {
  try {
    const u = new URL(rawUrl);
    if (startOrigin && u.origin === startOrigin) {
      return (u.pathname || '/') + (u.search || '');
    }
    return u.toString();
  } catch {
    return String(rawUrl || '/');
  }
}

function buildRecorderInitScript() {
  const finderScript = getFinderBrowserScript();
  return `(() => {
    if (window !== window.top) return;
    if (window.__wtgRecorderInstalled) return;
    window.__wtgRecorderInstalled = true;
    ${finderScript}

    function safeAttrEscape(val) {
      return String(val || '').replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
    }

    function isUniqueOrPrimary(selector, el) {
      try {
        const list = Array.from(document.querySelectorAll(selector));
        return list.length > 0 && list[0] === el;
      } catch {
        return false;
      }
    }

    function getScopePrefix(el) {
      let cur = el.parentElement;
      for (let d = 0; cur && cur !== document.body && d < 4; d++, cur = cur.parentElement) {
        if (cur.id) return '#' + CSS.escape(cur.id);
        const t = cur.tagName.toLowerCase();
        if (t === 'nav' || t === 'header' || t === 'footer' || t === 'main') {
          const cls = Array.from(cur.classList).find(c => /^[a-zA-Z_-][a-zA-Z0-9_-]{1,35}$/.test(c));
          return cls ? t + '.' + CSS.escape(cls) : t;
        }
      }
      return '';
    }

    function buildDomPathSelector(el) {
      const parts = [];
      let cur = el;
      while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
        if (cur.id) {
          parts.unshift('#' + CSS.escape(cur.id));
          const cand = parts.join(' > ');
          if (isUniqueOrPrimary(cand, el)) return cand;
        }
        const tag = cur.tagName.toLowerCase();
        let nth = 1;
        let sib = cur.previousElementSibling;
        while (sib) {
          if (sib.tagName === cur.tagName) nth++;
          sib = sib.previousElementSibling;
        }
        parts.unshift(tag + ':nth-of-type(' + nth + ')');
        const cand = parts.join(' > ');
        if (isUniqueOrPrimary(cand, el)) return cand;
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }

    function buildBestSelector(el) {
      if (!el || el.nodeType !== 1) return '';
      if (el.id) {
        const idSel = '#' + CSS.escape(el.id);
        if (isUniqueOrPrimary(idSel, el)) return idSel;
      }
      const tag = el.tagName.toLowerCase();
      const attrs = ['data-testid', 'data-ad-position', 'data-ad-slot-id', 'data-platform', 'name', 'aria-label'];
      for (const attr of attrs) {
        const v = el.getAttribute(attr);
        if (v && v.length <= 120) {
          const sel = tag + '[' + attr + '="' + safeAttrEscape(v) + '"]';
          if (isUniqueOrPrimary(sel, el)) return sel;
        }
      }
      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        if (href && !href.startsWith('javascript:')) {
          const baseHref = href.split('?')[0].split('#')[0];
          const tryHrefSel = candidateSel => {
            if (isUniqueOrPrimary(candidateSel, el)) return candidateSel;
            const prefix = getScopePrefix(el);
            if (prefix) {
              const scoped = prefix + ' ' + candidateSel;
              if (isUniqueOrPrimary(scoped, el)) return scoped;
            }
            return '';
          };
          if (href.length <= 220) {
            const matched = tryHrefSel('a[href="' + safeAttrEscape(href) + '"]');
            if (matched) return matched;
          }
          let hasMeaningfulPath = false;
          try {
            const parsedBase = new URL(baseHref, window.location.href);
            hasMeaningfulPath = parsedBase.pathname && parsedBase.pathname !== '/' && parsedBase.pathname.length > 2;
          } catch {
            hasMeaningfulPath = baseHref.startsWith('/') && baseHref.length > 2;
          }
          if (baseHref && baseHref.length >= 10 && baseHref.length <= 160 && hasMeaningfulPath) {
            const matchedPrefix = tryHrefSel('a[href*="' + safeAttrEscape(baseHref) + '"]');
            if (matchedPrefix) return matchedPrefix;
          }
        }
      }
      if (tag === 'button' && el.getAttribute('type')) {
        const tSel = 'button[type="' + safeAttrEscape(el.getAttribute('type')) + '"]';
        if (isUniqueOrPrimary(tSel, el)) return tSel;
      }
      if (typeof window.__wtgFinder === 'function') {
        try {
          const fSel = window.__wtgFinder(el, {
            root: document.body || document.documentElement,
            seedMinLength: 1,
            optimizedMinLength: 2,
            threshold: 1000,
            timeoutMs: 250,
          });
          if (fSel && isUniqueOrPrimary(fSel, el)) return fSel;
        } catch {}
      }
      return buildDomPathSelector(el);
    }

    function cleanLabel(el) {
      const txt = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '')
        .trim()
        .replace(/\\s+/g, ' ');
      return txt.length > 48 ? txt.slice(0, 47) + '…' : txt;
    }

    function captureField(el) {
      const descriptor = [el.type, el.name, el.id, el.autocomplete, el.getAttribute('aria-label'), el.placeholder].join(' ');
      const otp = /one-time-code|otp|verification[-_ ]?code|(?:^|[\\s_-])(?:code|pin)(?:$|[\\s_-])/i.test(descriptor);
      const secret = otp || /password|passwd|pwd|passcode|secret|token|api[-_ ]?key/i.test(descriptor);
      return { secret, value: otp ? '{{OTP}}' : (secret ? '' : String(el.value ?? '')) };
    }

    function emit(evt) {
      try {
        const href = String(window.location.href || '');
        if (!href.startsWith('http://') && !href.startsWith('https://')) return;
        if (typeof window.__wtgRecorderEmit === 'function') {
          window.__wtgRecorderEmit({ ...evt, url: href });
        }
      } catch {}
    }

    let lastNotifiedHref = '';
    function notifyPageArrival() {
      const href = String(window.location.href || '');
      if (!href.startsWith('http://') && !href.startsWith('https://')) return;
      if (lastNotifiedHref === href) return;
      lastNotifiedHref = href;
      let navType = 'navigate';
      try {
        const entries = performance.getEntriesByType('navigation');
        if (entries && entries[0] && entries[0].type) navType = entries[0].type;
      } catch {}
      emit({ kind: 'page_arrival', navType });
    }

    let lastRecordedScrollY = window.scrollY || 0;
    let scrollTimer = null;
    let scrollDirty = false;
    function flushPendingScroll() {
      if (scrollTimer) {
        clearTimeout(scrollTimer);
        scrollTimer = null;
      }
      if (!scrollDirty) return;
      scrollDirty = false;
      const curY = window.scrollY || 0;
      if (Math.abs(curY - lastRecordedScrollY) < 140) return;
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const pct = Math.max(0, Math.min(100, Math.round((curY / maxScroll) * 100)));
      lastRecordedScrollY = curY;
      emit({ kind: 'scroll', pct });
    }

    // Listen on window (survives Chromium initial about:blank -> real Document swap in popups/new tabs)
    window.addEventListener('DOMContentLoaded', notifyPageArrival, true);
    window.addEventListener('load', notifyPageArrival, true);
    window.addEventListener('pageshow', notifyPageArrival, true);
    if (document.readyState !== 'loading') {
      notifyPageArrival();
    }

    window.addEventListener('popstate', () => {
      flushPendingScroll();
      emit({ kind: 'popstate' });
    });

    window.addEventListener('click', event => {
      flushPendingScroll();
      const raw = event.target;
      if (!raw || raw.nodeType !== 1) return;
      const el = raw.closest('a, button, [role="button"], input, textarea, select, summary') || raw;
      const tag = el.tagName.toLowerCase();

      // Text inputs and <select> are captured cleanly on 'change' instead of noisy focus clicks
      if (tag === 'textarea' || tag === 'select') return;
      if (tag === 'input') {
        const itype = (el.getAttribute('type') || 'text').toLowerCase();
        if (!['submit', 'button', 'reset', 'checkbox', 'radio', 'image'].includes(itype)) return;
      }

      const isInteractiveTag = ['a', 'button', 'input', 'summary'].includes(tag) || el.getAttribute('role') === 'button';
      if (!isInteractiveTag) {
        const cs = window.getComputedStyle(el);
        const hasHandler = Boolean(el.getAttribute('onclick') || el.getAttribute('tabindex'));
        if (!hasHandler && (!cs || cs.cursor !== 'pointer')) return;
      }

      const selector = buildBestSelector(el);
      if (!selector) return;

      let followExternal = false;
      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        const targetAttr = (el.getAttribute('target') || '').toLowerCase();
        if (targetAttr === '_blank') followExternal = true;
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          try {
            if (new URL(href, window.location.href).origin !== window.location.origin) {
              followExternal = true;
            }
          } catch {}
        }
      }

      emit({
        kind: 'click',
        selector,
        text: cleanLabel(el),
        followExternal,
      });
    }, true);

    window.addEventListener('change', event => {
      flushPendingScroll();
      const el = event.target;
      if (!el || el.nodeType !== 1) return;
      const tag = el.tagName.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return;
      if (tag === 'input') {
        const itype = (el.getAttribute('type') || 'text').toLowerCase();
        if (['submit', 'button', 'reset', 'checkbox', 'radio', 'file', 'image', 'hidden'].includes(itype)) return;
      }
      const selector = buildBestSelector(el);
      if (!selector) return;
      emit({
        kind: tag === 'select' ? 'select' : 'fill',
        selector,
        ...captureField(el),
      });
    }, true);

    window.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      flushPendingScroll();
      const el = event.target;
      if (!el || el.nodeType !== 1) return;
      const tag = el.tagName.toLowerCase();
      if (tag !== 'input') return;
      const itype = (el.getAttribute('type') || 'text').toLowerCase();
      if (['submit', 'button', 'checkbox', 'radio'].includes(itype)) return;
      const selector = buildBestSelector(el);
      if (!selector) return;
      emit({
        kind: 'fill_and_enter',
        selector,
        ...captureField(el),
      });
    }, true);

    window.addEventListener('scroll', () => {
      scrollDirty = true;
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(flushPendingScroll, 350);
    }, { passive: true });
    window.addEventListener('visibilitychange', () => {
      if (document.hidden) flushPendingScroll();
    }, true);
    window.addEventListener('blur', flushPendingScroll, true);
    window.addEventListener('pagehide', flushPendingScroll, true);
  })();`;
}

async function startJourneyRecorder({
  targetUrl,
  proxyUrl = '',
  locale = '',
  timezoneId = '',
  onUpdate = null,
  mock = false,
  browserEngine = 'chromium',
  // Real Chrome + a residential IP already carries the right signals; heavy JS injection only adds
  // values that contradict the real engine. 'standard' keeps a real browser real.
  stealthMode = 'standard',
}) {
  if (activeSession) {
    const stillAlive = Boolean(activeSession.browser && activeSession.browser.isConnected && activeSession.browser.isConnected());
    if (stillAlive) {
      throw new Error('A live browser recording session is already active. Stop it before starting a new one.');
    }
    activeSession = null;
  }

  const desktop = await getDesktopSessionInfo();
  if (
    process.platform === 'win32' &&
    !desktop.isInteractiveDesktop &&
    process.env.WTG_ALLOW_HIDDEN_DESKTOP !== '1'
  ) {
    const deskName = desktop.currentDesktop || 'unknown';
    const err = new Error(
      `Dashboard server is running in an isolated background desktop (${deskName}) rather than your active interactive desktop (${desktop.inputDesktop || 'Default'}), so the Chromium recorder window will not be visible. Double-click start-dashboard.bat to launch interactively.`
    );
    err.code = 'NON_INTERACTIVE_DESKTOP';
    throw err;
  }

  let startUrlObj;
  try {
    startUrlObj = new URL(String(targetUrl || '').trim());
  } catch {
    throw new Error('Invalid target URL for recording.');
  }
  if (!['http:', 'https:'].includes(startUrlObj.protocol)) {
    throw new Error('Only http:// or https:// URLs can be recorded');
  }
  if (isDisallowedPrivateHost(startUrlObj.hostname)) {
    throw new Error('Recording private/internal network addresses is not permitted.');
  }

  const normalizedStartUrl = startUrlObj.toString();
  const startOrigin = startUrlObj.origin;

  const pwProxy = proxyUrl ? toPlaywrightProxy(proxyUrl) : null;

  // ── Hardened launch (same stack as a real visit) ───────────────────────────
  // The recorder used to open bundled Chromium through plain Playwright: no stealth args, no
  // installed-Chrome channel, no UA fix, and — worst of all — a datacenter exit IP. Those are
  // exactly the signals Cloudflare/Turnstile and link-shortener WAFs score first, so every
  // recording ended on a robot challenge. It now launches the same engine/stealth profile the
  // visit runner uses, so a recording is challenged as rarely as a real visit.
  const engine = ['camoufox', 'patchright', 'chromium'].includes(browserEngine) ? browserEngine : 'chromium';
  const chromiumLike = engine === 'chromium' || engine === 'patchright';
  const launcher = getLauncher(engine);
  // Camoufox (Firefox) refuses the Chromium-only per-context proxy placeholder, so it gets the
  // proxy on the context instead of at launch. Chromium/patchright keep it at launch.
  const launchProxy = chromiumLike ? pwProxy : null;
  const preferRealChrome = chromiumLike && process.env.WTG_BROWSER_CHANNEL !== 'bundle';
  const launchRecorderBrowser = async opts => {
    try {
      return await launcher.launch(opts);
    } catch (err) {
      if (opts.channel) {
        console.log('[Recorder] Installed Chrome channel unavailable — falling back to bundled Chromium.');
        const { channel, ...rest } = opts;
        return launcher.launch(rest);
      }
      throw err;
    }
  };
  const launchOpts = {
    headless: false,
    ...(chromiumLike
      ? {
        args: [
          // GPU off turns WebGL into a software renderer — a fingerprint mismatch on a real machine,
          // and Turnstile reads WebGL. The recorder keeps the real GPU stack.
          ...getChromiumStealthArgs(false, { stealthMode, proxied: Boolean(pwProxy) })
            .filter(a => !/^--disable-gpu$|^--disable-software-rasterizer$/.test(a)),
          '--start-maximized',
          '--wtg-recorder-window',
        ],
      }
      : {}),
    ...(launchProxy ? { proxy: launchProxy } : {}),
  };
  const browser = await launchRecorderBrowser({ ...launchOpts, ...(preferRealChrome ? { channel: 'chrome' } : {}) });
  const browserPid = browser.process?.()?.pid || null;

  const pageTabIds = new WeakMap();
  let nextTabId = 0;
  const getTabId = pageObj => {
    if (!pageObj) return 0;
    if (!pageTabIds.has(pageObj)) pageTabIds.set(pageObj, nextTabId++);
    return pageTabIds.get(pageObj);
  };

  const session = {
    browser,
    context: null,
    startOrigin,
    mock: Boolean(mock),
    lastClickAtByTab: new Map(),
    lastRecordedUrlByTab: new Map(),
    popupOpenedAtByTab: new Map(),
    popupOwnerStepByTab: new Map(),
    hadUserActionOnTab: new Set(),
    stopping: false,
    onUpdate,
  };
  activeSession = session;

  lastState = {
    active: true,
    status: mock ? 'live_browsing' : 'recording',
    mock: Boolean(mock),
    targetUrl: normalizedStartUrl,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    currentUrl: normalizedStartUrl,
    stepCount: 0,
    steps: [],
    challenge: null,
    error: null,
  };

  const emitUpdate = () => {
    lastState.stepCount = lastState.steps.length;
    if (typeof session.onUpdate === 'function') {
      session.onUpdate(cloneRecorderState());
    }
  };

  const pushStep = (stepObj, mergeScrollUrl = null) => {
    if (!lastState.active || lastState.steps.length >= 100) return;
    if (mergeScrollUrl && lastState.steps.length) {
      const prev = lastState.steps[lastState.steps.length - 1];
      if (prev.type === 'scroll' && prev._pageUrl === mergeScrollUrl && prev.tab === stepObj.tab) {
        prev.value = stepObj.value;
        prev.label = stepObj.label;
        emitUpdate();
        return;
      }
    }
    lastState.steps.push(stepObj);
    emitUpdate();
  };

  try {
    // The UA must describe the binary that actually started: the launch may fall back from
    // installed Chrome to the bundled Chromium, and reporting the wrong build is a leak of its own.
    let recorderUserAgent;
    if (chromiumLike) {
      const baseUa = getNativeChromeUserAgent(true);
      let major = '';
      try {
        const match = String(browser.version() || '').match(/^(\d+)/);
        major = match ? match[1] : '';
      } catch {}
      recorderUserAgent = major ? baseUa.replace(/Chrome\/\d+\.\d+\.\d+\.\d+/, `Chrome/${major}.0.0.0`) : baseUa;
    }

    // Returning-visitor cookies: a first-ever browser with zero cookies is itself a bot signal on
    // link shorteners and ad networks, so the recording profile persists between sessions.
    const storageStatePath = path.join(__dirname, '..', 'data', 'recorder-storage-state.json');
    // Cloudflare clearance cookies are bound to the exit IP and to the browser that earned them.
    // Replaying them from a different residential session makes Cloudflare treat the visitor as a
    // suspicious returning client, so they are never persisted with the rest of the profile.
    const CLOUDFLARE_COOKIE = /^(cf_clearance|__cf_bm|cf_chl_|__cfruid|_cfuvid)/i;
    let storageStateOpt = null;
    if (fs.existsSync(storageStatePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          parsed.cookies = (Array.isArray(parsed.cookies) ? parsed.cookies : []).filter(c => !CLOUDFLARE_COOKIE.test(String(c?.name || '')));
          storageStateOpt = parsed;
        }
      } catch {}
    }

    const context = await browser.newContext({
      viewport: null,
      ignoreHTTPSErrors: false,
      ...(locale ? { locale } : {}),
      ...(timezoneId ? { timezoneId } : {}),
      ...(recorderUserAgent ? { userAgent: recorderUserAgent } : {}),
      ...(engine === 'camoufox' && pwProxy ? { proxy: pwProxy } : {}),
      ...(storageStateOpt ? { storageState: storageStateOpt } : {}),
    });
    session.context = context;

    session.saveStorageState = async () => {
      if (!session.context || typeof session.context.storageState !== 'function') return;
      try {
        const state = await Promise.race([
          session.context.storageState(),
          new Promise(r => setTimeout(r, 1200)),
        ]);
        if (!state || typeof state !== 'object') return;
        const cookies = (Array.isArray(state.cookies) ? state.cookies : []).filter(c => !CLOUDFLARE_COOKIE.test(String(c?.name || '')));
        fs.writeFileSync(storageStatePath, JSON.stringify({ cookies, origins: state.origins || [] }), 'utf8');
      } catch {}
    };

    // Challenge awareness for the operator. The recorder is human-driven, so the only useful
    // signal is "a bot check is on screen right now" — it says nothing about success, and it never
    // clicks or solves anything on its own.
    let challengeTimer = null;
    session.stopChallengeWatch = () => {
      if (challengeTimer) { clearInterval(challengeTimer); challengeTimer = null; }
    };
    const lastStateChallenge = () => {
      const pages = context.pages();
      return pages.length ? pages[pages.length - 1] : null;
    };
    challengeTimer = setInterval(async () => {
      if (activeSession !== session || session.stopping || lastState.challenge) return;
      const target = lastStateChallenge();
      if (!target) return;
      try {
        const found = await detectChallenge(target);
        if (found.detected && activeSession === session) {
          lastState.challenge = { ...found, pageUrl: target.url(), at: new Date().toISOString() };
          emitUpdate();
        }
      } catch {}
    }, 4000);
    if (challengeTimer.unref) challengeTimer.unref();

    const desktopSpec = generateDeviceFingerprint(engine === 'camoufox' ? 'desktopFirefox' : 'desktopChrome').spec;
    if (engine !== 'camoufox') {
      if (stealthMode === 'maximum') {
        await applyMaximumStealth(context, {
          spec: desktopSpec,
          proxied: Boolean(pwProxy),
          seed: Math.floor(Math.random() * 100000),
          viewport: null,
        }).catch(() => {});
      } else {
        await context.addInitScript(() => {
          try {
            if (navigator.webdriver) {
              Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
            }
          } catch {}
        }).catch(() => {});
      }
    }

    if (session.mock) {
      // Mock/mini mode (fix from operator request): open the browser for real (proxy IP + locale),
      // skip all journey recording bindings — no click/nav capture, only a screen MOCK in the mini UI.
      lastState.stepCount = 0;
      const finalizeOnCloseMock = async () => {
        if (activeSession !== session || session.stopping) return;
        session.stopping = true;
        activeSession = null;
        lastState.active = false;
        lastState.status = 'completed';
        lastState.finishedAt = new Date().toISOString();
        emitUpdate();
        if (typeof session.stopChallengeWatch === 'function') session.stopChallengeWatch();
        if (typeof session.saveStorageState === 'function') await session.saveStorageState();
        browser.close().catch(() => {});
      };
      browser.on('disconnected', finalizeOnCloseMock);
      const page = await context.newPage();
      page.on('close', () => {
        if (!context.pages().length) finalizeOnCloseMock();
      });
      context.on('page', newPage => {
        newPage.on('close', () => {
          if (!context.pages().length) finalizeOnCloseMock();
        });
      });
      emitUpdate();
      const gotoPromise = page.goto(normalizedStartUrl, { waitUntil: 'domcontentloaded', timeout: 18000 }).catch(() => {});
      await Promise.race([gotoPromise, new Promise(r => setTimeout(r, 1500))]);
      void page.bringToFront().catch(() => {});
      void bringRecorderWindowToFront(browserPid).catch(() => {});
      setTimeout(() => {
        if (activeSession === session && !session.stopping) {
          void bringRecorderWindowToFront(browserPid).catch(() => {});
        }
      }, 500);
      return cloneRecorderState();
    }

    await context.exposeBinding('__wtgRecorderEmit', (source, evt) => {
      if (!activeSession || activeSession !== session || session.stopping) return;
      const evtUrl = String(evt?.url || '');
      if (!evtUrl.startsWith('http://') && !evtUrl.startsWith('https://')) return;
      const tabId = getTabId(source?.page);
      const isExtraTab = tabId > 0;
      const now = Date.now();
      lastState.currentUrl = evtUrl;
      // A new document means any challenge we flagged belongs to the previous page.
      lastState.challenge = null;

      if (evt.kind === 'page_arrival') {
        const navType = evt.navType || 'navigate';
        const prevTabUrl = session.lastRecordedUrlByTab.get(tabId) || '';
        if (!lastState.steps.length && tabId === 0) {
          session.lastRecordedUrlByTab.set(tabId, evtUrl);
          pushStep({
            type: 'goto',
            tab: tabId,
            selector: '',
            value: toStepTarget(evtUrl, session.startOrigin),
            assertKind: 'text_contains',
            label: `Open start page (${toStepTarget(evtUrl, session.startOrigin)})`,
            _recordedAt: now,
          });
          return;
        }
        if (evtUrl === prevTabUrl) return;

        if (navType === 'back_forward') {
          session.lastRecordedUrlByTab.set(tabId, evtUrl);
          pushStep({
            type: 'go_back',
            tab: tabId,
            selector: '',
            value: '800',
            assertKind: 'text_contains',
            label: `Navigate back to ${toStepTarget(evtUrl, session.startOrigin)}`,
            ...(isExtraTab ? { optional: true } : {}),
            _recordedAt: now,
          });
          return;
        }

        const lastClickAt = session.lastClickAtByTab.get(tabId) || 0;
        const withinClickNavWindow = now - lastClickAt < 2500;
        const popupOpenedAt = session.popupOpenedAtByTab.get(tabId) || 0;
        const withinInitialPopupOpen = isExtraTab && popupOpenedAt > 0 && !session.hadUserActionOnTab.has(tabId) && (now - popupOpenedAt) < 8000;
        session.lastRecordedUrlByTab.set(tabId, evtUrl);
        if (withinInitialPopupOpen) {
          const ownerStep = session.popupOwnerStepByTab.get(tabId);
          if (ownerStep && (evtUrl.startsWith('http://') || evtUrl.startsWith('https://'))) {
            ownerStep.popupFallbackUrl = evtUrl;
          }
          emitUpdate();
          return;
        }
        if (!withinClickNavWindow) {
          const targetVal = toStepTarget(evtUrl, session.startOrigin);
          let isExt = false;
          try { isExt = new URL(evtUrl).origin !== session.startOrigin; } catch {}
          const lastStep = lastState.steps[lastState.steps.length - 1];
          // Collapse rapid ad/affiliate redirect hops in extra tabs into the landed destination
          if (
            isExtraTab
            && lastStep
            && lastStep.type === 'goto'
            && lastStep.tab === tabId
            && now - (lastStep._recordedAt || 0) < 5500
          ) {
            lastStep.value = targetVal;
            lastStep.label = `Navigate in Tab #${tabId} to ${targetVal}`;
            if (isExt) lastStep.followExternal = true;
            lastStep._recordedAt = now;
            emitUpdate();
            return;
          }
          pushStep({
            type: 'goto',
            tab: tabId,
            selector: '',
            value: targetVal,
            assertKind: 'text_contains',
            label: isExtraTab ? `Navigate in Tab #${tabId} to ${targetVal}` : `Navigate to ${targetVal}`,
            ...(isExt ? { followExternal: true } : {}),
            ...(isExtraTab ? { optional: true } : {}),
            _recordedAt: now,
          });
        } else {
          emitUpdate();
        }
        return;
      }

      if (evt.kind === 'popstate') {
        const prevTabUrl = session.lastRecordedUrlByTab.get(tabId) || '';
        if (!evtUrl || evtUrl === prevTabUrl) return;
        const lastClickAt = session.lastClickAtByTab.get(tabId) || 0;
        if (now - lastClickAt >= 900) {
          session.lastRecordedUrlByTab.set(tabId, evtUrl);
          pushStep({
            type: 'go_back',
            tab: tabId,
            selector: '',
            value: '800',
            assertKind: 'text_contains',
            label: `History back to ${toStepTarget(evtUrl, session.startOrigin)}`,
            ...(isExtraTab ? { optional: true } : {}),
            _recordedAt: now,
          });
        }
        return;
      }

      const ensureSameTabContext = () => {
        const prevTabUrl = session.lastRecordedUrlByTab.get(tabId) || '';
        if (!prevTabUrl || evtUrl === prevTabUrl) return;
        try {
          const curU = new URL(evtUrl);
          const prevU = new URL(prevTabUrl);
          if (curU.origin === prevU.origin && curU.pathname === prevU.pathname) return;
          const targetVal = toStepTarget(evtUrl, session.startOrigin);
          const isExt = curU.origin !== session.startOrigin;
          session.lastRecordedUrlByTab.set(tabId, evtUrl);
          pushStep({
            type: 'goto',
            tab: tabId,
            selector: '',
            value: targetVal,
            assertKind: 'text_contains',
            label: `Navigate to ${targetVal}`,
            ...(isExt ? { followExternal: true } : {}),
            ...(isExtraTab ? { optional: true } : {}),
            _recordedAt: now,
          });
        } catch {}
      };

      if (evt.kind === 'click') {
        ensureSameTabContext();
        session.hadUserActionOnTab.add(tabId);
        session.lastClickAtByTab.set(tabId, now);
        const desc = evt.text ? ` (${evt.text})` : '';
        pushStep({
          type: 'click',
          tab: tabId,
          selector: evt.selector,
          value: '',
          assertKind: 'text_contains',
          label: `Click ${evt.selector}${desc}`,
          ...(evt.followExternal ? { followExternal: true } : {}),
          ...(isExtraTab ? { optional: true } : {}),
          _recordedAt: now,
        });
        return;
      }

      const secretInput = evt.secret === true || isSecretField(evt.selector, evt.text);
      const fieldValue = secretInput && evt.value !== '{{OTP}}' ? '' : evt.value;

      if (evt.kind === 'fill' || evt.kind === 'select') {
        ensureSameTabContext();
        session.hadUserActionOnTab.add(tabId);
        const last = lastState.steps[lastState.steps.length - 1];
        if (last && last.type === evt.kind && last.selector === evt.selector && last.tab === tabId && last._pageUrl === evtUrl) {
          last.value = fieldValue;
          if (secretInput) last.secret = true;
          last._recordedAt = now;
          emitUpdate();
          return;
        }
        pushStep({
          type: evt.kind,
          tab: tabId,
          selector: evt.selector,
          value: fieldValue,
          ...(secretInput ? { secret: true } : {}),
          assertKind: 'text_contains',
          label: redactText(evt.kind + ' ' + evt.selector),
          ...(isExtraTab ? { optional: true } : {}),
          _pageUrl: evtUrl,
          _recordedAt: now,
        });
        return;
      }

      if (evt.kind === 'fill_and_enter') {
        ensureSameTabContext();
        const last = lastState.steps[lastState.steps.length - 1];
        if (!(last && last.type === 'fill' && last.selector === evt.selector && last.tab === tabId && last.value === fieldValue)) {
          pushStep({
            type: 'fill',
            tab: tabId,
            selector: evt.selector,
            value: fieldValue,
            ...(secretInput ? { secret: true } : {}),
            assertKind: 'text_contains',
            label: `Fill ${evt.selector}`,
            ...(isExtraTab ? { optional: true } : {}),
            _pageUrl: evtUrl,
            _recordedAt: now,
          });
        }
        pushStep({
          type: 'press',
          tab: tabId,
          selector: evt.selector,
          value: 'Enter',
          assertKind: 'text_contains',
          label: `Press Enter in ${evt.selector}`,
          ...(isExtraTab ? { optional: true } : {}),
          _recordedAt: now,
        });
        return;
      }

      if (evt.kind === 'scroll') {
        ensureSameTabContext();
        session.hadUserActionOnTab.add(tabId);
        pushStep(
          {
            type: 'scroll',
            tab: tabId,
            selector: '',
            value: String(evt.pct ?? 50),
            assertKind: 'text_contains',
            label: `Scroll to ${evt.pct ?? 50}%`,
            ...(isExtraTab ? { optional: true } : {}),
            _pageUrl: evtUrl,
            _recordedAt: now,
          },
          evtUrl
        );
      }
    });

    await context.addInitScript(buildRecorderInitScript());

    const finalizeOnClose = async () => {
      if (activeSession !== session || session.stopping) return;
      session.stopping = true;
      activeSession = null;
      lastState.active = false;
      lastState.status = 'completed';
      lastState.finishedAt = new Date().toISOString();
      lastState.steps = stripInternalFields(lastState.steps);
      lastState.stepCount = lastState.steps.length;
      emitUpdate();
      if (typeof session.stopChallengeWatch === 'function') session.stopChallengeWatch();
      if (typeof session.saveStorageState === 'function') await session.saveStorageState();
      browser.close().catch(() => {});
    };

    browser.on('disconnected', finalizeOnClose);

    const page = await context.newPage();
    const rootTabId = getTabId(page);
    page.on('close', () => {
      if (!context.pages().length) finalizeOnClose();
    });

    context.on('page', newPage => {
      const tid = getTabId(newPage);
      const now = Date.now();
      for (let idx = lastState.steps.length - 1; idx >= 0; idx--) {
        const cand = lastState.steps[idx];
        if (cand && cand.type === 'click' && cand.tab !== tid && !cand.opensTab && now - (cand._recordedAt || 0) < 3500) {
          cand.opensTab = tid;
          session.popupOpenedAtByTab.set(tid, now);
          session.popupOwnerStepByTab.set(tid, cand);
          emitUpdate();
          break;
        }
      }
      newPage.on('close', () => {
        if (!context.pages().length) {
          finalizeOnClose();
          return;
        }
        if (tid > rootTabId && activeSession === session && !session.stopping) {
          const prev = lastState.steps[lastState.steps.length - 1];
          if (!(prev && prev.type === 'close_tab' && prev.tab === tid)) {
            pushStep({
              type: 'close_tab',
              tab: tid,
              selector: '',
              value: '',
              assertKind: 'text_contains',
              label: `Close Tab #${tid} and return`,
              optional: true,
              _recordedAt: Date.now(),
            });
          }
        }
      });
    });

    emitUpdate();
    // Navigate asynchronously after a short head-start so the UI button never hangs for 15-20s on a slow proxy
    const gotoPromise = page.goto(normalizedStartUrl, { waitUntil: 'domcontentloaded', timeout: 18000 }).catch(() => {});
    await Promise.race([gotoPromise, new Promise(r => setTimeout(r, 1500))]);
    void page.bringToFront().catch(() => {});
    void bringRecorderWindowToFront(browserPid).catch(() => {});
    setTimeout(() => {
      if (activeSession === session && !session.stopping) {
        void bringRecorderWindowToFront(browserPid).catch(() => {});
      }
    }, 500);
    return cloneRecorderState();
  } catch (err) {
    activeSession = null;
    lastState.active = false;
    lastState.status = 'error';
    lastState.error = err?.message || String(err);
    lastState.finishedAt = new Date().toISOString();
    await browser.close().catch(() => {});
    emitUpdate();
    throw err;
  }
}

async function focusRecorderWindow() {
  const desktop = await getDesktopSessionInfo();
  if (!activeSession || !activeSession.browser || !activeSession.browser.isConnected?.()) {
    activeSession = null;
    return {
      ok: false,
      raised: 0,
      reason: 'No active recording session. Click "Record Journey in Browser" first.',
      desktop,
    };
  }
  if (
    process.platform === 'win32' &&
    !desktop.isInteractiveDesktop &&
    process.env.WTG_ALLOW_HIDDEN_DESKTOP !== '1'
  ) {
    return {
      ok: false,
      raised: 0,
      reason: `Server is running in an isolated desktop (${desktop.currentDesktop || 'non-Default'}) — launch via start-dashboard.bat to see the window.`,
      desktop,
    };
  }
  const pages = activeSession.context?.pages?.() || [];
  await Promise.all(pages.map(p => p.bringToFront().catch(() => {})));
  const focusPid = activeSession.browser.process?.()?.pid || null;
  const focusRes = await bringRecorderWindowToFront(focusPid);
  return {
    ...focusRes,
    reason: focusRes.ok
      ? 'Recorder window brought to front.'
      : 'No open recorder browser window found on the current desktop.',
    desktop,
  };
}

async function stopJourneyRecorder() {
  const session = activeSession;
  if (!session) {
    lastState.active = false;
    if (['recording', 'live_browsing'].includes(lastState.status)) lastState.status = 'completed';
    lastState.steps = stripInternalFields(lastState.steps);
    lastState.stepCount = lastState.steps.length;
    return cloneRecorderState();
  }

  session.stopping = true;
  activeSession = null;
  lastState.active = false;
  lastState.status = 'completed';
  lastState.finishedAt = new Date().toISOString();
  lastState.steps = stripInternalFields(lastState.steps);
  lastState.stepCount = lastState.steps.length;

  if (typeof session.stopChallengeWatch === 'function') session.stopChallengeWatch();
  if (typeof session.saveStorageState === 'function') {
    await session.saveStorageState();
  }
  await Promise.race([
    session.browser.close().catch(() => {}),
    new Promise(r => setTimeout(r, 4000)),
  ]);
  const pid = session.browser.process?.()?.pid;
  if (pid && process.platform === 'win32') {
    try { process.kill(pid); } catch {}
  }
  if (typeof session.onUpdate === 'function') {
    session.onUpdate(cloneRecorderState());
  }
  return cloneRecorderState();
}

function getRecorderState() {
  const cleanSteps = stripInternalFields(lastState.steps);
  return {
    ...lastState,
    steps: cleanSteps,
    stepCount: cleanSteps.length,
    desktop: getCachedDesktopSessionInfo(),
  };
}

module.exports = {
  buildRecorderInitScript,
  startJourneyRecorder,
  stopJourneyRecorder,
  getRecorderState,
  bringRecorderWindowToFront,
  focusRecorderWindow,
  getDesktopSessionInfo,
};
