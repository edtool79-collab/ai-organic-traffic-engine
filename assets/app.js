(function () {
  'use strict';

  // Mobile navigation drawer
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('primary-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Copy-to-clipboard buttons
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-copy]');
    if (!btn) return;
    var targetId = btn.getAttribute('data-copy');
    var el = targetId ? document.getElementById(targetId) : null;
    var text = el ? el.textContent : (btn.getAttribute('data-copy-text') || '');
    if (!text) return;
    navigator.clipboard.writeText(text.trim()).then(function () {
      var orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(function () {
        btn.textContent = orig;
      }, 1600);
    }).catch(function () {});
  });

  // Download JSON helper buttons
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-download-target]');
    if (!btn) return;
    var targetId = btn.getAttribute('data-download-target');
    var filename = btn.getAttribute('data-filename') || 'config.json';
    var el = targetId ? document.getElementById(targetId) : null;
    if (!el || !el.textContent) return;
    var blob = new Blob([el.textContent], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  // Hero workbench preview tabs
  var tabButtons = document.querySelectorAll('.frame-tab[data-tab-target]');
  tabButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-tab-target');
      var container = btn.closest('.workbench-frame');
      if (!container) return;
      container.querySelectorAll('.frame-tab').forEach(function (b) {
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      container.querySelectorAll('.frame-panel').forEach(function (panel) {
        var match = panel.id === target;
        panel.hidden = !match;
        if (match) {
          var lazyImg = panel.querySelector('img[data-src]');
          if (lazyImg && !lazyImg.getAttribute('src')) {
            lazyImg.setAttribute('src', lazyImg.getAttribute('data-src'));
          }
          var vid = panel.querySelector('video');
          if (vid && vid.paused) {
            vid.play().catch(function () {});
          }
        }
      });
    });
  });

  // Generic output switcher tabs (Config Builder)
  var outTabs = document.querySelectorAll('.out-tab[data-out-panel]');
  outTabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var panelId = btn.getAttribute('data-out-panel');
      var wrap = btn.closest('[data-out-group]') || document;
      wrap.querySelectorAll('.out-tab[data-out-panel]').forEach(function (b) {
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      wrap.querySelectorAll('[data-out-box]').forEach(function (box) {
        box.hidden = box.id !== panelId;
      });
    });
  });

  // Interactive Apify CU & Bandwidth Cost Calculator (Homepage)
  var calcForm = document.getElementById('cu-calc-form');
  if (calcForm) {
    var renderCalc = function () {
      var visits = Math.max(1, Math.min(100000, parseInt(calcForm.calcVisits.value || '1000', 10)));
      var execMode = calcForm.calcExec.value || 'browser_journey';
      var resMode = calcForm.calcRes.value || 'ultra_lite';

      var kbPerVisit = execMode === 'http_fast'
        ? 45
        : (resMode === 'ultra_lite' ? 185 : (resMode === 'lite' ? 920 : 3800));
      var fullKbPerVisit = 3800;

      var totalMb = (visits * kbPerVisit) / 1024;
      var savedPct = execMode === 'http_fast'
        ? 98
        : Math.max(0, Math.round((1 - kbPerVisit / fullKbPerVisit) * 100));

      var cuPerVisit = execMode === 'http_fast'
        ? 0.00018
        : (resMode === 'ultra_lite' ? 0.0022 : (resMode === 'lite' ? 0.0031 : 0.0045));
      var totalCu = visits * cuPerVisit;
      var ppeUsd = 0.02 + visits * 0.003;

      var elData = document.getElementById('calc-out-mb');
      var elSaved = document.getElementById('calc-out-saved');
      var elCu = document.getElementById('calc-out-cu');
      var elUsd = document.getElementById('calc-out-usd');

      if (elData) elData.textContent = totalMb >= 1024 ? (totalMb / 1024).toFixed(2) + ' GB' : Math.round(totalMb) + ' MB';
      if (elSaved) elSaved.textContent = savedPct + '% Saved';
      if (elCu) elCu.textContent = totalCu.toFixed(2) + ' CU';
      if (elUsd) elUsd.textContent = '$' + ppeUsd.toFixed(2);
    };
    calcForm.addEventListener('input', renderCalc);
    calcForm.addEventListener('change', renderCalc);
    renderCalc();
  }

  // Interactive Dual Builder: Apify Actor Input JSON + Self-Hosted config.json (/config-builder/)
  var form = document.getElementById('config-builder-form');
  if (form) {
    var outApify = document.getElementById('generated-apify-json');
    var outJson = document.getElementById('generated-config-json');
    var outCli = document.getElementById('generated-cli');

    function renderConfig() {
      var targetUrl = (form.targetUrl.value || 'https://citedcart.com').trim();
      var pagesRaw = (form.pages ? form.pages.value : '/, /tools') || '/';
      var pagesList = pagesRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!pagesList.length) pagesList = ['/'];

      var executionMode = form.executionMode ? form.executionMode.value : 'browser_journey';
      var browserEngine = form.browserEngine.value || 'patchright';
      var devicePreset = form.devicePreset ? form.devicePreset.value : 'mixed_realistic';
      var resourceMode = form.resourceMode.value || 'ultra_lite';
      var visitCount = Math.max(1, Math.min(50000, parseInt(form.visitCount.value || '10', 10)));
      var concurrency = Math.max(1, Math.min(32, parseInt(form.concurrency.value || '3', 10)));
      var dwellTimeSecs = Math.max(1, Math.min(180, parseInt((form.dwellTimeSecs && form.dwellTimeSecs.value) || '6', 10)));
      var waveMode = (form.waveMode && form.waveMode.value) || 'natural_peaks';
      var referrerMode = form.referrerMode.value || 'mixed';
      var searchQuery = form.searchQuery ? form.searchQuery.value.trim() : '';
      var aiMode = (form.aiMode && form.aiMode.value) || 'smart_heuristic';
      var aiGoal = (form.aiGoal && form.aiGoal.value.trim()) || 'Explore featured products, tools, pricing, or guides';
      var aiRouteRepair = form.aiRouteRepair ? form.aiRouteRepair.checked : true;
      var country = ((form.country && form.country.value) || 'US').toUpperCase();
      var verifyGa4 = form.verifyGa4 ? form.verifyGa4.checked : true;
      var sessionPersistence = form.sessionPersistence ? form.sessionPersistence.checked : false;
      var useApifyProxy = form.useApifyProxy ? form.useApifyProxy.checked : true;
      var includeCustomSteps = form.includeCustomSteps ? form.includeCustomSteps.checked : true;

      var apifySteps = includeCustomSteps ? [
        { type: 'goto', value: '/', label: 'Open landing page with organic referrer' },
        { type: 'dismiss_overlays', label: 'Accept cookie/consent banner if present' },
        { type: 'human_browse', value: dwellTimeSecs * 1000, label: 'Biometric mouse & reading scroll' },
        { type: aiMode === 'off' ? 'internal_nav' : 'ai_explore', value: aiMode === 'off' ? 1 : '', label: aiMode === 'off' ? 'Follow 1 internal link' : 'AI autonomous page discovery (Playbook Cached)' }
      ] : [];

      // 100% 1:1 Schema Match with .actor/input_schema.json
      var apifyInput = {
        targetUrl: targetUrl,
        pages: pagesList,
        visitCount: visitCount,
        maxConcurrency: concurrency,
        dwellTimeSecs: dwellTimeSecs,
        waveMode: waveMode,
        aiMode: aiMode,
        aiGoal: aiGoal,
        aiRouteRepair: aiRouteRepair,
        executionMode: executionMode,
        browserEngine: browserEngine,
        devicePreset: devicePreset,
        sessionPersistence: sessionPersistence,
        referrerMode: referrerMode,
        searchQuery: searchQuery,
        scenarioSteps: apifySteps,
        verifyGa4: verifyGa4,
        resourceMode: resourceMode,
        captureScreenshots: false,
        countryCode: country,
        proxyConfiguration: {
          useApifyProxy: useApifyProxy
        }
      };

      // Self-Hosted Local Studio config.json
      var localEngineMode = executionMode === 'http_fast' ? 'http_fast' : 'crawlee_autoscaled';
      var localCfg = {
        targetUrl: targetUrl,
        pages: pagesList,
        visitCount: visitCount,
        minConcurrency: Math.min(concurrency, 2),
        concurrency: concurrency,
        firstPagePriority: 65,
        sessionTimeoutMs: 120000,
        pageMinMs: dwellTimeSecs * 1000,
        headless: true,
        engineMode: localEngineMode,
        browserEngine: browserEngine,
        taskMode: 'scenario',
        referrerMode: referrerMode,
        resourceMode: resourceMode,
        stealthMode: 'maximum',
        sessionPersistence: sessionPersistence,
        proxy: {
          enabled: useApifyProxy,
          tier: 'datacenter',
          mode: 'round_robin',
          countryFilterEnabled: true,
          preferredCountries: [country]
        },
        adSafety: {
          avoidAdClicks: true,
          dismissOverlays: true,
          closePopunders: true
        },
        taskSteps: apifySteps.length ? apifySteps : [
          { type: 'goto', value: '/', label: 'Open landing page' },
          { type: 'human_browse', value: String(dwellTimeSecs * 1000), label: 'Biometric scroll & dwell' }
        ]
      };

      if (outApify) outApify.textContent = JSON.stringify(apifyInput, null, 2);
      if (outJson) outJson.textContent = JSON.stringify(localCfg, null, 2);

      if (outCli) {
        outCli.textContent = [
          '# Option A — Run instantly on Apify Cloud via CLI:',
          'apify call hirepulse/website-traffic-generator -i apify-input.json',
          '',
          '# Option B — Run Self-Hosted Studio locally (Node.js LTS):',
          'git clone https://github.com/edtool79-collab/ai-organic-traffic-engine.git',
          'cd ai-organic-traffic-engine && npm install && npx playwright install chromium',
          'node src/crawleeRunner.js config.json'
        ].join('\n');
      }
    }

    form.addEventListener('input', renderConfig);
    form.addEventListener('change', renderConfig);
    renderConfig();
  }
})();
