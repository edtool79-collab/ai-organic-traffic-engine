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
      btn.textContent = 'Copied';
      setTimeout(function () {
        btn.textContent = orig;
      }, 1600);
    }).catch(function () {});
  });

  // Hero workbench preview tabs (lazy-assign GIF src only when selected or scrolled)
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
        }
      });
    });
  });

  // Interactive config.json & Docker CLI builder (/config-builder/)
  var form = document.getElementById('config-builder-form');
  if (form) {
    var outJson = document.getElementById('generated-config-json');
    var outCli = document.getElementById('generated-cli');

    function renderConfig() {
      var targetUrl = (form.targetUrl.value || 'https://citedcart.com').trim();
      var engineMode = form.engineMode.value;
      var browserEngine = form.browserEngine.value;
      var resourceMode = form.resourceMode.value;
      var visitCount = Math.max(1, Math.min(100000, parseInt(form.visitCount.value || '25', 10)));
      var concurrency = Math.max(1, Math.min(32, parseInt(form.concurrency.value || '4', 10)));
      var proxyTier = form.proxyTier.value;
      var byteBudgetMb = Math.max(50, parseInt(form.byteBudgetMb.value || '1000', 10));
      var country = (form.country.value || 'US').toUpperCase();
      var referrerMode = form.referrerMode.value;
      var aiProvider = form.aiProvider.value;
      var workerPct = Math.max(0, Math.min(100, parseInt(form.workerPct.value || '50', 10)));
      var useInbox = form.useInbox.checked;
      var headless = form.headless.checked;

      var steps = [
        { type: 'search_entry', value: '', label: 'Enter from ' + referrerMode + ' search/social trail' },
        { type: 'goto', value: '/', label: 'Load landing page' },
        { type: 'human_browse', value: '8000', label: 'Biometric scroll & dwell' }
      ];
      if (useInbox) {
        steps.push({ type: 'fill_email', selector: 'input[type="email"]', label: 'Create HirePulse inbox & fill email' });
        steps.push({ type: 'fill_otp', selector: 'input[name="otp"]', label: 'Poll live inbox & submit verification code' });
      }
      steps.push({ type: 'assert', assertKind: 'url_contains', value: '/', label: 'Confirm session completion' });

      var cfg = {
        targetUrl: targetUrl,
        pages: ['/', '/guides', '/tools'],
        visitCount: visitCount,
        minConcurrency: Math.min(concurrency, 2),
        concurrency: concurrency,
        firstPagePriority: 60,
        sessionTimeoutMs: 120000,
        pageMinMs: 4000,
        headless: headless,
        engineMode: engineMode,
        browserEngine: browserEngine,
        taskMode: aiProvider === 'none' ? 'scenario' : 'hybrid',
        referrerMode: referrerMode,
        resourceMode: resourceMode,
        stealthMode: 'maximum',
        proxy: {
          enabled: proxyTier !== 'none',
          tier: proxyTier === 'none' ? 'datacenter' : proxyTier,
          mode: 'round_robin',
          countryFilterEnabled: proxyTier !== 'none',
          preferredCountries: [country],
          residential: {
            enabled: proxyTier === 'residential',
            byteBudgetMb: byteBudgetMb,
            country: country.toLowerCase(),
            overheadFactor: 1.15
          }
        },
        ai: {
          enabled: aiProvider !== 'none',
          provider: aiProvider === 'none' ? 'auto' : aiProvider,
          commanderModel: 'glm-5.3-flash',
          workerModel: aiProvider === 'ollama_cloud' ? 'clef:27b' : 'deepseek-v4.1-flash',
          workerPct: aiProvider === 'none' ? 0 : workerPct,
          routeRepair: aiProvider !== 'none',
          formAssist: aiProvider !== 'none'
        },
        adSafety: {
          avoidAdClicks: true,
          dismissOverlays: true,
          closePopunders: true
        },
        taskSteps: steps
      };

      outJson.textContent = JSON.stringify(cfg, null, 2);

      var envLines = [];
      if (aiProvider === 'hirepulse' || useInbox) {
        envLines.push('# Get key at https://gethirepulse.xyz/credits');
        envLines.push('HIREPULSE_CREDIT_KEY=<your-hirepulse-credit-key>');
      }
      if (aiProvider === 'ollama_cloud') {
        envLines.push('OLLAMA_API_KEY=<your-ollama-cloud-key>');
      }
      var cliText = [
        'git clone https://github.com/edtool79-collab/ai-organic-traffic-engine.git',
        'cd ai-organic-traffic-engine',
        'npm install && npm --prefix dashboard install',
        'npx playwright install chromium',
        (envLines.length ? envLines.join('\n') + '\n' : '') + '# Save config.json above, then launch:',
        'node src/crawleeRunner.js config.json'
      ].join('\n');
      outCli.textContent = cliText;
    }

    form.addEventListener('input', renderConfig);
    form.addEventListener('change', renderConfig);
    renderConfig();
  }
})();
