const fs = require('fs');
const os = require('os');
const path = require('path');
const { AD_SAFE_EXCLUSION_SELECTOR, registerScenarioPage } = require('./adSafetyHelper');
const { runScanProductsStep, analyzeRecordedJourney } = require('./wavePlanner');
const { redactData, registerStepSecrets } = require('./redaction');

const DEFAULT_OLLAMA_HOST = 'https://ollama.com';
const DEFAULT_ULLM_HOST = 'https://api.uncensoredllm.ai';
const DEFAULT_COMMANDER_MODEL = 'glm-5.3-flash';
const DEFAULT_WORKER_MODEL = 'deepseek-v4.1-flash';
const OLLAMA_CHEAP_WORKER_POOL = [
  'deepseek-v4.1-flash',
  'beam',
  'gpt-oss:20b',
  'minimax-m3.1-flash',
  'nemotron-3-nano:30b',
  'gemma4:31b',
  'nemotron-3-super',
];
const unsupportedChatModels = new Set(['inkling-2-small', 'clef:27b']);
// A model that answers on one Ollama transport but not the other is learned at runtime and cached
// in data/ai-models.json. The set above is only a startup hint now, not a ban list.
const AI_MODELS_FILE = path.join(__dirname, '..', 'data', 'ai-models.json');
const OLLAMA_TRANSPORTS = ['chat', 'generate'];
// Thinking costs output tokens, so it is enabled per role instead of globally.
const THINK_BY_ROLE = { commander: true, recovery: true, worker: false };

let modelMemoryCache = null;

function loadModelMemory() {
  if (modelMemoryCache) return modelMemoryCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(AI_MODELS_FILE, 'utf8'));
    modelMemoryCache = (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    modelMemoryCache = {};
  }
  return modelMemoryCache;
}

function saveModelMemory() {
  try {
    fs.mkdirSync(path.dirname(AI_MODELS_FILE), { recursive: true });
    fs.writeFileSync(AI_MODELS_FILE, JSON.stringify(modelMemoryCache || {}, null, 2));
  } catch {}
}

/** Remembers the transport a model actually answered on, so the next call skips discovery. */
function rememberModelTransport(model, transport, note = '') {
  const key = String(model || '').trim().toLowerCase();
  if (!key) return;
  const mem = loadModelMemory();
  const prev = mem[key];
  mem[key] = {
    transport,
    note: note || (prev && prev.note) || '',
    checkedAt: new Date().toISOString(),
  };
  saveModelMemory();
}

function preferredTransport(model) {
  const key = String(model || '').trim().toLowerCase();
  const known = loadModelMemory()[key];
  if (known && OLLAMA_TRANSPORTS.includes(known.transport)) return known.transport;
  if (unsupportedChatModels.has(key)) return 'generate';
  return 'chat';
}

function getModelMemory() {
  return { ...loadModelMemory() };
}

const DEFAULT_ULLM_CHEAP_COMMANDER = 'glm-5.3-flash-uncensored';
const DEFAULT_ULLM_CHEAP_WORKER = 'glm-5.3-flash-uncensored';
const OLLAMA_KEY_FILE = path.join(os.homedir(), '.gemini', 'tools', '.ollama_key');
const ULLM_KEY_FILE = path.join(os.homedir(), '.gemini', 'tools', '.ullm_key');
const OLLAMA_QUOTA_COOLDOWN_MS = 10 * 60 * 1000;

let ollamaCooldownUntil = 0;

function readKeyFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const val = fs.readFileSync(filePath, 'utf8').trim();
      if (val) return val;
    }
  } catch {}
  return '';
}

function normalizeAiProvider(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'ollama' || v === 'ollama_cloud' || v === 'ollama-cloud') return 'ollama_cloud';
  if (v === 'ullm' || v === 'uncensoredllm' || v === 'uncensored') return 'uncensoredllm';
  return 'auto';
}

/**
 * Resolves credentials strictly in memory from env or ~/.gemini/tools key files.
 * Never logs, prints, or serializes raw API keys.
 */
function resolveProviderConfig(provider = 'ollama_cloud') {
  const norm = normalizeAiProvider(provider);
  if (norm === 'uncensoredllm') {
    const host = (process.env.ULLM_CLOUD_HOST || DEFAULT_ULLM_HOST).replace(/\/+$/, '');
    const envKey = String(process.env.ULLM_API_KEY || process.env.UNCENSOREDLLM_API_KEY || '').trim();
    if (envKey) return { provider: 'uncensoredllm', configured: true, source: 'env', host, apiKey: envKey };
    const fileKey = readKeyFile(ULLM_KEY_FILE);
    if (fileKey) return { provider: 'uncensoredllm', configured: true, source: 'file', host, apiKey: fileKey };
    return { provider: 'uncensoredllm', configured: false, source: 'none', host, apiKey: '' };
  }

  const host = (process.env.OLLAMA_CLOUD_HOST || DEFAULT_OLLAMA_HOST).replace(/\/+$/, '');
  const envKey = typeof process.env.OLLAMA_API_KEY === 'string' ? process.env.OLLAMA_API_KEY.trim() : '';
  if (envKey) return { provider: 'ollama_cloud', configured: true, source: 'env', host, apiKey: envKey };
  const fileKey = readKeyFile(OLLAMA_KEY_FILE);
  if (fileKey) return { provider: 'ollama_cloud', configured: true, source: 'file', host, apiKey: fileKey };
  return { provider: 'ollama_cloud', configured: false, source: 'none', host, apiKey: '' };
}

function resolveOllamaConfig() {
  const ollama = resolveProviderConfig('ollama_cloud');
  if (ollama.configured) return ollama;
  const ullm = resolveProviderConfig('uncensoredllm');
  if (ullm.configured) return ullm;
  return ollama;
}

function getOllamaStatusPublic() {
  const ollama = resolveProviderConfig('ollama_cloud');
  const ullm = resolveProviderConfig('uncensoredllm');
  const cooldownActive = ollamaCooldownUntil > Date.now();
  const activePrimary = (ollama.configured && !cooldownActive)
    ? 'ollama_cloud'
    : (ullm.configured ? 'uncensoredllm' : (ollama.configured ? 'ollama_cloud' : 'none'));

  return {
    configured: ollama.configured || ullm.configured,
    source: activePrimary === 'uncensoredllm' ? ullm.source : ollama.source,
    host: activePrimary === 'uncensoredllm' ? ullm.host : ollama.host,
    activePrimary,
    defaultCommanderModel: activePrimary === 'uncensoredllm' ? DEFAULT_ULLM_CHEAP_COMMANDER : DEFAULT_COMMANDER_MODEL,
    defaultWorkerModel: activePrimary === 'uncensoredllm' ? DEFAULT_ULLM_CHEAP_WORKER : DEFAULT_WORKER_MODEL,
    providers: {
      ollama_cloud: {
        configured: ollama.configured,
        source: ollama.source,
        cooldownActive,
      },
      uncensoredllm: {
        configured: ullm.configured,
        source: ullm.source,
        cheapCommanderModel: DEFAULT_ULLM_CHEAP_COMMANDER,
        cheapWorkerModel: DEFAULT_ULLM_CHEAP_WORKER,
      },
    },
  };
}

function mapModelForProvider(requestedModel, provider, role = 'worker') {
  const raw = String(requestedModel || '').trim().replace(/:cloud$/, '');
  if (provider === 'uncensoredllm') {
    const isOllamaAlias = !raw || [
      'glm-5.3-flash',
      'deepseek-v4.1-flash',
      'deepseek-v4.1-flash:1017',
      'inkling-2-small',
      'minimax-m3.1-flash',
      'minimax-m2.5',
      'kimi-k2.5',
      'gemini-3.8-flash',
    ].includes(raw.toLowerCase());
    if (isOllamaAlias) {
      return role === 'commander' ? DEFAULT_ULLM_CHEAP_COMMANDER : DEFAULT_ULLM_CHEAP_WORKER;
    }
    return raw;
  }
  if (!raw) {
    return role === 'commander' ? DEFAULT_COMMANDER_MODEL : DEFAULT_WORKER_MODEL;
  }
  // No silent swap any more: a model that fails on /api/chat is retried on /api/generate by the
  // transport layer, so the caller keeps the model it asked for.
  return raw;
}

function extractJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(cleaned.slice(first, last + 1));
    } catch {}
  }
  return null;
}

function flattenMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map(m => `${m?.role || 'user'}: ${String(m?.content || '')}`)
    .join('\n\n')
    .trim();
}

/**
 * One round-trip to one Ollama transport. /api/chat and /api/generate differ in the request shape
 * and in where the answer sits in the response; nothing else.
 */
async function postOllama({ cred, model, messages, temperature, tokenCap, json, think, transport, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('ollama_cloud timeout')), timeoutMs);
  try {
    const base = {
      model,
      stream: false,
      think: Boolean(think),
      options: { temperature, num_predict: tokenCap },
      ...(json ? { format: 'json' } : {}),
    };
    const payload = transport === 'generate'
      ? { ...base, prompt: flattenMessages(messages) }
      : { ...base, messages };

    const resp = await fetch(`${cred.host}/api/${transport}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cred.apiKey}`,
        'User-Agent': 'WebTrafficGen-AICommander/1.0',
      },
      body: JSON.stringify(redactData(payload)),
    });

    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => '');
      const err = new Error(`ollama_cloud ${transport} HTTP ${resp.status}: ${bodyText.slice(0, 180)}`);
      err.httpStatus = resp.status;
      err.transport = transport;
      throw err;
    }

    const data = await resp.json();
    const rawAnswer = transport === 'generate'
      ? String(data?.response || '')
      : String(data?.message?.content || '');
    return {
      transport,
      content: rawAnswer.replace(/<think[\s\S]*?<\/think>/gi, '').trim(),
      usage: data?.usage || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

const OLLAMA_DECISION_PATH = '/v1/systemone';
// clef:27b is a decision model: it refuses /api/chat and /api/generate with
// "clef:27b is a decision model and only supports /v1/systemone". It answers typed
// questions (choice / noul / score) over a state object instead of writing prose.
const DECISION_MODELS = new Set(['clef:27b']);
const DECISION_QUESTION_TYPES = ['choice', 'noul', 'score'];

function isDecisionModel(model) {
  return DECISION_MODELS.has(String(model || '').trim().toLowerCase());
}

/**
 * One round-trip to the Ollama decision transport. `state` is any non-empty string/object/array,
 * `questions` maps ids to { type, instructions, criteria }. Answers come back typed and scored.
 */
async function callDecisionModel({ cred, model, state, questions, timeoutMs = 20000 }) {
  const stateEmpty = !state || (typeof state === 'object' && !Object.keys(state).length);
  if (stateEmpty) throw new Error('ollama decision: state must be a nonempty string, object, or array');
  const ids = questions && typeof questions === 'object' ? Object.keys(questions) : [];
  if (!ids.length || ids.length > 64) throw new Error('ollama decision: questions must contain 1-64 fields');
  for (const id of ids) {
    const type = String(questions[id]?.type || '').toLowerCase();
    if (!DECISION_QUESTION_TYPES.includes(type)) {
      throw new Error(`ollama decision: question "${id}" type must be choice, noul, or score`);
    }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('ollama decision timeout')), timeoutMs);
  try {
    const resp = await fetch(`${cred.host}${OLLAMA_DECISION_PATH}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cred.apiKey}`,
        'User-Agent': 'WebTrafficGen-AICommander/1.0',
      },
      body: JSON.stringify(redactData({ model, state, questions })),
    });
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => '');
      const err = new Error(`ollama_cloud systemone HTTP ${resp.status}: ${bodyText.slice(0, 180)}`);
      err.httpStatus = resp.status;
      err.transport = 'systemone';
      throw err;
    }
    const data = await resp.json();
    return {
      transport: 'systemone',
      content: JSON.stringify(data?.answers || {}),
      answers: data?.answers || {},
      usage: data?.usage || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callSingleProviderChat({
  provider,
  cred,
  role = 'worker',
  model,
  messages,
  temperature,
  maxTokens,
  timeoutMs,
  json = false,
  think = null,
}) {
  const tokenCap = (role === 'commander' || role === 'recovery')
    ? Math.max(maxTokens || 500, 900)
    : Math.max(80, Math.min(420, maxTokens || 200));
  const useThink = think === null ? Boolean(THINK_BY_ROLE[role]) : Boolean(think);

  if (isDecisionModel(model)) {
    const err = new Error(`${model} is a decision model: use callDecisionModel (/v1/systemone), not chat`);
    err.code = 'MODEL_NEEDS_DECISION_API';
    throw err;
  }

  if (provider !== 'ollama_cloud') {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`${provider} timeout`)), timeoutMs);
    try {
      const resp = await fetch(`${cred.host}/v1/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cred.apiKey}`,
          'User-Agent': 'WebTrafficGen-AICommander/1.0',
        },
        body: JSON.stringify(redactData({
          model,
          messages,
          temperature,
          max_tokens: tokenCap,
          stream: false,
        })),
      });
      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => '');
        const err = new Error(`${provider} HTTP ${resp.status}: ${bodyText.slice(0, 180)}`);
        err.httpStatus = resp.status;
        throw err;
      }
      const data = await resp.json();
      const choice = data?.choices?.[0]?.message || {};
      return {
        provider,
        model,
        transport: 'openai',
        content: String(choice.content || '').trim().replace(/<think[\s\S]*?<\/think>/gi, '').trim(),
        usage: data?.usage || null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // Ollama: try the transport this model is known to answer on, then the other one. A 400/404/422
  // means "wrong door for this model", not "broken model" — that is why clef:27b was written off.
  const first = preferredTransport(model);
  const order = [first, ...OLLAMA_TRANSPORTS.filter(t => t !== first)];
  let lastErr = null;
  for (const transport of order) {
    try {
      const out = await postOllama({
        cred, model, messages, temperature, tokenCap, json, think: useThink, transport, timeoutMs,
      });
      if (first !== transport) rememberModelTransport(model, transport, `fell back from ${first}`);
      return { provider, model, ...out };
    } catch (err) {
      lastErr = err;
      const wrongDoor = err?.httpStatus === 400 || err?.httpStatus === 404 || err?.httpStatus === 422;
      if (!wrongDoor) throw err;
    }
  }
  throw (lastErr || new Error('ollama_cloud: neither transport answered'));
}

/**
 * Calls configured AI cloud endpoint(s) with automatic quota/429 failover from Ollama Cloud
 * to low-cost UncensoredLLM models.
 */
async function callAiChat({
  provider = 'auto',
  role = 'worker',
  model = DEFAULT_WORKER_MODEL,
  messages = [],
  temperature = 0.25,
  maxTokens = 450,
  timeoutMs = 15000,
  json = false,
  think = null,
} = {}) {
  const pref = normalizeAiProvider(provider);
  const candidates = [];

  if (pref === 'uncensoredllm') {
    candidates.push('uncensoredllm');
  } else if (pref === 'ollama_cloud') {
    candidates.push('ollama_cloud');
  } else {
    const ollamaReady = resolveProviderConfig('ollama_cloud').configured && ollamaCooldownUntil <= Date.now();
    if (ollamaReady) candidates.push('ollama_cloud');
    if (resolveProviderConfig('uncensoredllm').configured) candidates.push('uncensoredllm');
    if (!candidates.length) candidates.push('ollama_cloud');
  }

  let lastErr = null;
  for (const cand of candidates) {
    const cred = resolveProviderConfig(cand);
    if (!cred.configured) continue;
    const chosenModel = mapModelForProvider(model, cand, role);
    try {
      return await callSingleProviderChat({
        provider: cand,
        cred,
        role,
        model: chosenModel,
        messages,
        temperature,
        maxTokens,
        timeoutMs,
        json,
        think,
      });
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (cand === 'ollama_cloud' && (err.httpStatus === 400 || err.httpStatus === 404)) {
        const fallbackModel = role === 'commander' ? DEFAULT_COMMANDER_MODEL : DEFAULT_WORKER_MODEL;
        unsupportedChatModels.add(chosenModel.toLowerCase());
        if (chosenModel !== fallbackModel) {
          try {
            return await callSingleProviderChat({
              provider: cand,
              cred,
              role,
              model: fallbackModel,
              messages,
              temperature,
              maxTokens,
              timeoutMs,
              json,
              think,
            });
          } catch (retryErr) {
            lastErr = retryErr;
          }
        }
      }
      if (cand === 'ollama_cloud' && (err.httpStatus === 429 || err.httpStatus === 402 || /limit|quota/i.test(msg))) {
        ollamaCooldownUntil = Date.now() + OLLAMA_QUOTA_COOLDOWN_MS;
      }
    }
  }

  if (lastErr) throw lastErr;
  const err = new Error('No cloud AI API key configured (OLLAMA_API_KEY / ULLM_API_KEY).');
  err.code = 'AI_NOT_CONFIGURED';
  throw err;
}

const callOllamaChat = callAiChat;

const AI_PLAYBOOK_TTL_MS = 25 * 60 * 1000;
const AI_PLAYBOOK_MAX_ENTRIES = 80;
const AI_PLAYBOOK_REUSE_CHANCE = 0.78;
const aiPagePlaybookCache = new Map();
const aiTokenSaverStats = {
  apiCalls: 0,
  cacheHits: 0,
  recoveryCalls: 0,
  decisionCalls: 0,
  lastPageState: null,
  estimatedTokensSaved: 0,
  promptTokensUsed: 0,
  completionTokensUsed: 0,
  byModel: {},
};

function sanitizeWorkerGoal(rawGoal, squadFocus = '') {
  const focus = String(squadFocus || '').trim();
  let txt = String(rawGoal || '').trim();
  if (
    !txt
    || /סוכנים|bots?|traffic|conversions?|המרות|רישום מייל|partner click|funnel|\b\d{2,4}\s*%/i.test(txt)
  ) {
    txt = focus || 'Explore visible tools, guides, or key navigation links naturally like a real visitor.';
  }
  return txt.slice(0, 160);
}

function getPlaybookCacheKey(domUrl, keyTag = 'default') {
  try {
    const u = new URL(domUrl);
    const cleanPath = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.origin}${cleanPath}|${keyTag || 'default'}`;
  } catch {
    return `${String(domUrl || '').split('?')[0].replace(/\/+$/, '')}|${keyTag || 'default'}`;
  }
}

function getRouteGroupCacheKey(domUrl, keyTag = 'default') {
  try {
    const u = new URL(domUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return `${u.origin}/${parts[0]}/*|${keyTag || 'default'}`;
    }
  } catch {}
  return null;
}

function getCachedPlaybook(cacheKey) {
  const entry = aiPagePlaybookCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.ts > AI_PLAYBOOK_TTL_MS) {
    aiPagePlaybookCache.delete(cacheKey);
    return null;
  }
  return entry;
}

function setCachedPlaybook(cacheKey, entry) {
  if (!cacheKey || !entry) return;
  if (aiPagePlaybookCache.size >= AI_PLAYBOOK_MAX_ENTRIES) {
    const oldestKey = aiPagePlaybookCache.keys().next().value;
    if (oldestKey) aiPagePlaybookCache.delete(oldestKey);
  }
  aiPagePlaybookCache.set(cacheKey, { ...entry, ts: Date.now() });
}

function recordTokenUsage(usage, model = '') {
  aiTokenSaverStats.apiCalls += 1;
  const modelKey = String(model || 'unknown').toLowerCase();
  const perModel = aiTokenSaverStats.byModel[modelKey]
    || (aiTokenSaverStats.byModel[modelKey] = { calls: 0, promptTokens: 0, completionTokens: 0 });
  perModel.calls += 1;
  if (!usage || typeof usage !== 'object') return;
  const pTok = Number(usage.prompt_tokens || usage.input_tokens || 0) || 0;
  const cTok = Number(usage.completion_tokens || usage.output_tokens || 0) || 0;
  aiTokenSaverStats.promptTokensUsed += pTok;
  aiTokenSaverStats.completionTokensUsed += cTok;
  perModel.promptTokens += pTok;
  perModel.completionTokens += cTok;
}

function getAiTokenSaverStats() {
  return {
    ...aiTokenSaverStats,
    totalTokensUsed: aiTokenSaverStats.promptTokensUsed + aiTokenSaverStats.completionTokensUsed,
    cachedPlaybooks: aiPagePlaybookCache.size,
  };
}

/**
 * Captures a compact, indexed DOM snapshot of safe interactive targets for Worker AI Agents.
 * Selectors stay on the Node side; the LLM only sees short numeric IDs to save 60-75% tokens.
 */
async function captureCompactDomForAi(page, avoidAds = true, { sameOriginOnly = false, excludeOutbound = false } = {}) {
  return page.evaluate(({ adSel, avoidAdsFlag, sameOriginOnlyFlag, excludeOutboundFlag }) => {
    const cssEscapeId = id => {
      if (window.CSS && CSS.escape) return `#${CSS.escape(id)}`;
      return `[id="${String(id).replace(/"/g, '\\"')}"]`;
    };

    const buildSafeSelector = el => {
      if (!el) return '';
      if (el.id) return cssEscapeId(el.id);
      const name = el.getAttribute('name');
      if (name) return `${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;
      const href = el.tagName === 'A' ? el.getAttribute('href') : '';
      if (href && href.length < 100 && !href.startsWith('javascript:')) {
        return `a[href="${href.replace(/"/g, '\\"')}"]`;
      }
      const cls = typeof el.className === 'string'
        ? el.className.split(/\s+/).filter(c => c && !/^(active|hover|focus)/.test(c)).slice(0, 2).join('.')
        : '';
      return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
    };

    const isVisible = el => {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return false;
      const st = getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
    };

    const headings = Array.from(document.querySelectorAll('h1, h2'))
      .slice(0, 4)
      .map(h => (h.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60))
      .filter(Boolean);

    const inputs = [];
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (inputs.length >= 6) break;
      const type = (el.getAttribute('type') || el.tagName).toLowerCase();
      if (['hidden', 'password', 'file', 'submit', 'button'].includes(type)) continue;
      if (!isVisible(el)) continue;
      if (avoidAdsFlag && adSel && el.closest(adSel)) continue;
      const selector = buildSafeSelector(el);
      if (!selector) continue;
      inputs.push({
        id: inputs.length,
        selector,
        type,
        placeholder: (el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.name || '').slice(0, 40),
      });
    }

    const clickables = [];
    const seen = new Set();
    const curOrigin = location.origin;
    const rawElements = [
      ...document.querySelectorAll('main a[href], article a[href], [role="main"] a[href], .product a[href], .card a[href], main button, article button'),
      ...document.querySelectorAll('a[href], button, [role="button"]'),
    ];
    for (const el of rawElements) {
      if (clickables.length >= 16) break;
      if (!isVisible(el)) continue;
      if (avoidAdsFlag && adSel && el.closest(adSel)) continue;
      let sameOrigin = true;
      if (el.tagName === 'A') {
        if (excludeOutboundFlag && (el.hasAttribute('data-lab-outbound') || /\bsponsored\b/i.test(el.getAttribute('rel') || ''))) {
          continue;
        }
        try {
          const abs = new URL(el.href, location.href);
          sameOrigin = abs.origin === curOrigin;
          if (sameOriginOnlyFlag && !sameOrigin) continue;
          if (avoidAdsFlag && /(?:uplcm|tatrck|rcpsj|ypetp|codeaven|rzekl|grfpr)\./i.test(abs.hostname)) continue;
        } catch {}
      }
      const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
      const selector = buildSafeSelector(el);
      if (!selector || seen.has(selector) || (!text && el.tagName !== 'A')) continue;
      if (/logout|signout|delete account/i.test(`${text} ${selector}`)) continue;
      seen.add(selector);
      clickables.push({
        id: clickables.length,
        selector,
        tag: el.tagName.toLowerCase(),
        sameOrigin,
        text: (text || selector).slice(0, 50),
      });
    }

    return {
      url: location.href,
      title: (document.title || '').slice(0, 70),
      headings,
      inputs,
      clickables,
    };
  }, {
    adSel: AD_SAFE_EXCLUSION_SELECTOR,
    avoidAdsFlag: Boolean(avoidAds),
    sameOriginOnlyFlag: Boolean(sameOriginOnly),
    excludeOutboundFlag: Boolean(excludeOutbound),
  }).catch(() => ({
    url: '',
    title: '',
    headings: [],
    inputs: [],
    clickables: [],
  }));
}

function resolveClickTargetFromPlan(planStep, dom) {
  const list = dom?.clickables || [];
  if (!list.length) return null;
  if (planStep.selectorHint) {
    const exact = list.find(c => c.selector === planStep.selectorHint);
    if (exact) return exact;
  }
  if (planStep.targetText) {
    const needle = String(planStep.targetText).toLowerCase();
    const byText = list.find(c => c.text.toLowerCase().includes(needle) || needle.includes(c.text.toLowerCase()));
    if (byText) return byText;
  }
  if (Number.isInteger(planStep.id)) {
    return list.find(c => c.id === planStep.id) || null;
  }
  return null;
}

function resolveInputTargetFromPlan(planStep, dom) {
  const list = dom?.inputs || [];
  if (!list.length) return null;
  if (planStep.selectorHint) {
    const exact = list.find(inp => inp.selector === planStep.selectorHint);
    if (exact) return exact;
  }
  if (Number.isInteger(planStep.id)) {
    return list.find(inp => inp.id === planStep.id) || null;
  }
  return null;
}

async function executePlannedWorkerActions(page, planSteps, dom, ctx) {
  const actionsDone = [];
  for (const ps of (planSteps || []).slice(0, 3)) {
    const act = String(ps?.act || ps?.action || 'scroll').toLowerCase();
    try {
      if (act === 'done' || act === 'none') break;
      if (act === 'scan' || act === 'scan_products') {
        const msg = await runScanProductsStep(page, { value: '1', sameOriginOnly: Boolean(ctx.staySameOrigin) }, ctx);
        actionsDone.push(`scan: ${msg}`);
      } else if (act === 'go_back') {
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
        actionsDone.push('go_back');
      } else if (act === 'fill' && ps.val) {
        const target = resolveInputTargetFromPlan(ps, dom);
        if (target) {
          const loc = page.locator(target.selector).first();
          if ((await loc.count()) > 0) {
            await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
            await loc.fill(String(ps.val).slice(0, 120), { timeout: 4000 });
            actionsDone.push(`fill(${target.selector})`);
          }
        }
      } else if (act === 'click') {
        const target = resolveClickTargetFromPlan(ps, dom);
        if (target && (!ctx.staySameOrigin || target.sameOrigin !== false)) {
          const loc = page.locator(target.selector).first();
          if ((await loc.count()) > 0) {
            page.context().__wtgAllowPopupUntil = Math.max(page.context().__wtgAllowPopupUntil || 0, Date.now() + 6000);
            const popupPromise = page.context().waitForEvent('page', { timeout: 1800 }).catch(() => null);
            let popup = null;
            await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
            await Promise.all([
              popupPromise.then(p => {
                popup = p;
                if (p) registerScenarioPage(p, 6000);
              }),
              loc.click({ timeout: 4000 }).catch(() => {}),
            ]);
            if (popup && !popup.isClosed()) {
              await popup.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
              await popup.evaluate(() => window.scrollBy({ top: 320, behavior: 'smooth' })).catch(() => {});
              await popup.waitForTimeout(1400);
              await popup.evaluate(() => window.scrollBy({ top: 380, behavior: 'smooth' })).catch(() => {});
              await popup.waitForTimeout(1100);
              await popup.close().catch(() => {});
            } else {
              await page.waitForTimeout(900);
            }
            actionsDone.push(`click(${target.selector})`);
          }
        } else {
          await page.evaluate(() => window.scrollBy({ top: 320, behavior: 'smooth' })).catch(() => {});
          actionsDone.push('scroll(safe)');
        }
      } else {
        await page.evaluate(() => window.scrollBy({ top: 360, behavior: 'smooth' })).catch(() => {});
        await page.waitForTimeout(700);
        actionsDone.push('scroll');
      }
    } catch {
      actionsDone.push(`step-skip(${act})`);
    }
  }
  return actionsDone;
}

/**
 * Runs a token-frugal AI-driven browser step (`ai_explore`) powered by Ollama Cloud:
 * - Uses indexed micro-DOM (no selectors sent in prompts)
 * - Plans 2 steps in ONE single LLM call instead of looping per turn
 * - Shares an in-memory per-route AI Playbook Cache across the swarm (~78% cache hits = 0 tokens)
 */
async function runAiExploreStep(page, step = {}, ctx = {}) {
  const maxSteps = Math.min(4, Math.max(1, Number(step.value) || 2));
  const baseGoal = sanitizeWorkerGoal(step.label || ctx.aiDirective, step.squadFocus || '');
  const recHint = typeof step.recordingHint === 'string' && step.recordingHint.trim() ? ` ${step.recordingHint.trim()}` : '';
  const goal = `${baseGoal}${recHint}`.slice(0, 260);
  const model = step.workerModel || ctx.aiConfig?.workerModel || DEFAULT_WORKER_MODEL;
  const providerPref = normalizeAiProvider(ctx.aiConfig?.provider || 'auto');
  let onPrimaryOrigin = false;
  try {
    onPrimaryOrigin = Boolean(ctx.targetUrl && new URL(page.url()).origin === new URL(ctx.targetUrl).origin);
  } catch {}
  const sameOriginOnly = Boolean(step.sameOriginOnly ?? ctx.staySameOrigin) || onPrimaryOrigin;

  const statusInfo = getOllamaStatusPublic();
  const hasSelectedCred = providerPref === 'ollama_cloud'
    ? statusInfo.providers.ollama_cloud.configured
    : (providerPref === 'uncensoredllm' ? statusInfo.providers.uncensoredllm.configured : statusInfo.configured);

  if (!hasSelectedCred || ctx.aiConfig?.enabled === false) {
    const fallbackNote = await runScanProductsStep(page, { value: '1', sameOriginOnly }, ctx).catch(() => 'בוצעה גלילה אנושית');
    return `AI Agent (מצב Fallback ללא מפתח): ${fallbackNote}`;
  }

  const dom = await captureCompactDomForAi(page, Boolean(ctx.avoidAdClicks), { sameOriginOnly, excludeOutbound: onPrimaryOrigin });
  const hasDomTargets = Boolean(dom.url && dom.url !== 'about:blank' && (dom.headings.length || dom.inputs.length || dom.clickables.length));
  if (!hasDomTargets) {
    return 'מוח AI: דולג (הדף עדיין ריק — נחסכה קריאת AI)';
  }

  const cacheScope = sameOriginOnly ? 'int' : 'ext';
  const cacheKey = getPlaybookCacheKey(dom.url, cacheScope);
  const routeGroupKey = getRouteGroupCacheKey(dom.url, cacheScope);
  const cached = getCachedPlaybook(cacheKey) || (routeGroupKey ? getCachedPlaybook(routeGroupKey) : null);
  if (cached && Array.isArray(cached.planSteps) && cached.planSteps.length && Math.random() < AI_PLAYBOOK_REUSE_CHANCE) {
    aiTokenSaverStats.cacheHits += 1;
    aiTokenSaverStats.estimatedTokensSaved += cached.estTokens || 240;
    const picked = cached.planSteps.length > 1 && Math.random() < 0.35
      ? [...cached.planSteps].reverse().slice(0, maxSteps)
      : cached.planSteps.slice(0, maxSteps);
    const done = await executePlannedWorkerActions(page, picked, dom, { ...ctx, staySameOrigin: sameOriginOnly });
    return `מוח AI [Cache Save ⚡ | ${cached.model}]: ${done.join(' -> ') || 'scroll'}`;
  }

  const systemPrompt = [
    'You are a single-user web UX tester.',
    `Return ONLY JSON with up to ${maxSteps} sequential UI steps using the provided numeric IDs:`,
    '{"steps":[{"act":"click|fill|scroll|scan","id":0,"val":"short text if fill"}],"note":"max 6 words"}',
    'Allowed ids must exist in c (for click) or i (for fill).',
  ].join(' ');

  const microPage = {
    t: dom.title,
    h: dom.headings,
    i: dom.inputs.map(x => ({ id: x.id, t: x.type, ph: x.placeholder })),
    c: dom.clickables.map(x => ({ id: x.id, txt: x.text })),
  };
  const userPrompt = JSON.stringify(redactData({ goal, p: microPage }));

  let usedModelLabel = model;
  let planSteps = [];
  let pageState = null;
  try {
    if (isDecisionModel(model)) {
      // A decision model cannot write prose, but it classifies the page and picks one action in a
      // single ~200-token request, and it cannot invent a selector that is not on the page.
      const pick = await askActionChoice({
        model,
        dom,
        instructions: 'Which single action would a real visitor take next on this page?',
        contextNote: goal,
        askPageState: true,
        maxClicks: 14,
        maxInputs: 8,
        timeoutMs: 12000,
        emailPlaceholder: ctx.sessionInbox?.address || ctx.sessionInbox?.email || '',
      });
      if (!pick) throw new Error('decision model returned no usable option');
      pageState = pick.pageState;
      usedModelLabel = `systemone:${model}`;
      if (pageState === 'error' || pageState === 'empty') {
        aiTokenSaverStats.lastPageState = pageState;
        return `מוח AI [decision:${pageState}]: הדף אינו שמיש — לא בוצעה פעולה`;
      }
      if (pick.act !== 'none') {
        planSteps = [{
          act: pick.act,
          id: pick.id,
          val: pick.val,
          selectorHint: pick.selectorHint,
          targetText: pick.targetText,
        }];
      }
    } else {
      const resp = await callAiChat({
        provider: providerPref,
        role: 'worker',
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.25,
        maxTokens: 180,
        timeoutMs: 20000,
        json: true,
      });
      recordTokenUsage(resp.usage, resp.model);
      usedModelLabel = resp.provider ? `${resp.provider}:${resp.model}` : resp.model;
      const parsed = extractJsonObject(resp.content);
      const rawSteps = Array.isArray(parsed?.steps)
        ? parsed.steps
        : (parsed?.act || parsed?.action ? [parsed] : []);
      planSteps = rawSteps
        .filter(s => s && typeof s === 'object')
        .slice(0, maxSteps)
        .map(s => {
          const act = String(s.act || s.action || 'scroll').toLowerCase();
          const clickItem = act === 'click' && Number.isInteger(s.id) ? dom.clickables.find(c => c.id === s.id) : null;
          const inputItem = act === 'fill' && Number.isInteger(s.id) ? dom.inputs.find(i => i.id === s.id) : null;
          return {
            act,
            id: Number.isInteger(s.id) ? s.id : undefined,
            val: typeof s.val === 'string' ? s.val : (typeof s.value === 'string' ? s.value : ''),
            selectorHint: clickItem?.selector || inputItem?.selector || '',
            targetText: clickItem?.text || '',
          };
        });
    }
  } catch (err) {
    const fb = await runScanProductsStep(page, { value: '1', sameOriginOnly }, ctx).catch(() => 'גלילה אנושית');
    return `מוח AI (Fallback ${err.message}): ${fb}`;
  }

  if (planSteps.length > 0) {
    const cacheEntry = {
      model: usedModelLabel,
      planSteps,
      estTokens: Math.round((systemPrompt.length + userPrompt.length) / 3.5) + 70,
    };
    setCachedPlaybook(cacheKey, cacheEntry);
    if (routeGroupKey) {
      setCachedPlaybook(routeGroupKey, cacheEntry);
    }
  }

  const actionsDone = await executePlannedWorkerActions(
    page,
    planSteps.length ? planSteps : [{ act: 'scroll' }],
    dom,
    { ...ctx, staySameOrigin: sameOriginOnly }
  );
  const stateTag = pageState && pageState !== 'ready' ? ` [page:${pageState}]` : '';
  return `מוח AI (${usedModelLabel})${stateTag}: ${actionsDone.join(' -> ') || 'scroll'}`;
}

/** Resolves Ollama credentials and asks the decision transport one typed question set. */
async function askDecision({ model, state, questions, timeoutMs = 20000 }) {
  const cred = resolveProviderConfig('ollama_cloud');
  if (!cred.configured) {
    const err = new Error('No cloud AI API key configured (OLLAMA_API_KEY).');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }
  const out = await callDecisionModel({ cred, model, state, questions, timeoutMs });
  recordTokenUsage(out.usage, model);
  return { ...out, model };
}

const PAGE_STATES = ['ready', 'consent_wall', 'login_required', 'empty', 'error'];
// clef answers typed questions, so the page vocabulary has to be fixed and short. These lines are
// the whole "prompt" — changing the wording changes the model's behaviour.
const PAGE_STATE_CRITERIA = {
  ready: 'Real content is visible and there is at least one safe element to act on.',
  consent_wall: 'A cookie, consent or age overlay is covering the page.',
  login_required: 'The page demands credentials before any content is reachable.',
  empty: 'The page still has no usable content or interactive element.',
  error: 'The page is a browser error, a server error, or a dead end.',
};

/**
 * One decision round-trip over the compact DOM. It can classify the page and pick the next action in
 * the same call, which is why it costs one 200-token request instead of a chat completion.
 * Returns { act, id, val, confidence, pageState, selectorHint, targetText, model, latencyMs }.
 */
async function askActionChoice({
  model,
  dom,
  instructions,
  contextNote = '',
  askPageState = false,
  maxClicks = 14,
  maxInputs = 8,
  timeoutMs = 12000,
  emailPlaceholder = '',
}) {
  const criteria = {};
  const clickables = (dom.clickables || []).slice(0, maxClicks);
  const inputs = (dom.inputs || []).slice(0, maxInputs);
  clickables.forEach(c => {
    criteria[`click:${c.id}`] = `Click the element labelled "${String(c.text || 'unnamed').slice(0, 60)}".`;
  });
  inputs.forEach(i => {
    const kind = i.type || 'text';
    const ph = i.placeholder ? ` with placeholder "${String(i.placeholder).slice(0, 40)}"` : '';
    const useEmail = kind === 'email' && emailPlaceholder ? ' using the session email' : '';
    criteria[`fill:${i.id}`] = `Type into the ${kind} field${ph}${useEmail}.`;
  });
  criteria.scroll = 'Scroll down when the next control is probably below the fold.';
  criteria.none = 'Do nothing when no safe action is visible.';
  if (Object.keys(criteria).length < 2) return null;

  const state = {
    page: String(dom.title || '').slice(0, 120),
    url: String(dom.url || '').slice(0, 200),
    buttonsAndLinks: clickables.map(c => String(c.text || '').slice(0, 40)),
    fields: inputs.map(i => ({ id: i.id, type: i.type || 'text' })),
    ...(contextNote ? { context: String(contextNote).slice(0, 160) } : {}),
  };

  const questions = {
    next_action: { type: 'choice', instructions, criteria },
  };
  if (askPageState) {
    questions.page_state = {
      type: 'choice',
      instructions: 'What is this page right now?',
      criteria: PAGE_STATE_CRITERIA,
    };
  }

  const t0 = Date.now();
  const out = await askDecision({ model, state, questions, timeoutMs });
  const answer = out.answers?.next_action;
  const pageAnswer = out.answers?.page_state;
  const pageState = PAGE_STATES.includes(String(pageAnswer?.choice)) ? String(pageAnswer.choice) : 'unknown';
  const picked = String(answer?.choice || '').trim();
  aiTokenSaverStats.decisionCalls += 1;

  const base = {
    pageState,
    pageConfidence: typeof pageAnswer?.confidence === 'number' ? pageAnswer.confidence : null,
    probabilities: answer?.probabilities || null,
    confidence: typeof answer?.confidence === 'number' ? answer.confidence : null,
    model,
    latencyMs: Date.now() - t0,
  };

  const [kind, rawId] = picked.split(':');
  const numId = Number(rawId);
  let act = 'scroll';
  let id;
  let selectorHint = '';
  let targetText = '';
  if (kind === 'click' && Number.isInteger(numId)) {
    const item = clickables.find(c => c.id === numId);
    if (!item) return { ...base, act: 'none' };
    act = 'click';
    id = numId;
    selectorHint = item.selector || '';
    targetText = item.text || '';
  } else if (kind === 'fill' && Number.isInteger(numId)) {
    const item = inputs.find(i => i.id === numId);
    if (!item) return { ...base, act: 'none' };
    act = 'fill';
    id = numId;
    selectorHint = item.selector || '';
  } else if (!picked || picked === 'none') {
    return { ...base, act: 'none' };
  } else if (picked !== 'scroll') {
    return { ...base, act: 'none' };
  }

  return {
    ...base,
    act,
    id,
    val: act === 'fill' ? emailPlaceholder : '',
    selectorHint,
    targetText,
  };
}

/**
 * Asks the decision model which single UI action unblocks a stalled recording step.
 * Returns { act, id, val, confidence, model, latencyMs } or null when there is nothing to pick.
 */
async function askRecoveryDecision(model, dom, ctx = {}, failedHint = '') {
  const pick = await askActionChoice({
    model,
    dom,
    instructions: 'Which single action moves the form forward with the least risk?',
    contextNote: `Previous step failed: ${String(failedHint || '').slice(0, 80)}. Goal: move a signup / consent / checkout form one step forward.`,
    emailPlaceholder: ctx.sessionInbox?.address || ctx.sessionInbox?.email || '',
    timeoutMs: 12000,
  });
  if (!pick || pick.act === 'none') return null;
  return pick;
}

/**
 * Lightweight, cached AI step recovery invoked ONLY when consecutive recorded steps fail/skip (>= 2)
 * on an active form or partner conversion flow, adapting to changed button/field layouts cleanly.
 */
async function runAiSmartRecoveryStep(page, ctx = {}, failedHint = '') {
  if (!page || page.isClosed() || ctx.aiConfig?.enabled === false) return null;
  const providerPref = normalizeAiProvider(ctx.aiConfig?.provider || 'auto');
  const statusInfo = getOllamaStatusPublic();
  const hasSelectedCred = providerPref === 'ollama_cloud'
    ? statusInfo.providers.ollama_cloud.configured
    : (providerPref === 'uncensoredllm' ? statusInfo.providers.uncensoredllm.configured : statusInfo.configured);
  if (!hasSelectedCred) return null;

  const currentUrl = page.url();
  if (!currentUrl || currentUrl === 'about:blank') return null;
  const pageVisitKey = getPlaybookCacheKey(currentUrl, 'page');
  if (!ctx._aiRecoveryVisitedPages) ctx._aiRecoveryVisitedPages = new Set();
  if (ctx._aiRecoveryVisitedPages.has(pageVisitKey)) return null;
  ctx._aiRecoveryVisitedPages.add(pageVisitKey);

  const hintLower = String(failedHint || '').toLowerCase();
  const hintKind = /\bfill|email|otp|input|#email|#code/.test(hintLower) ? 'fill' : 'click';
  const recoverKey = getPlaybookCacheKey(currentUrl, `rec:${Boolean(ctx.staySameOrigin) ? 'int' : 'ext'}:${hintKind}`);

  const dom = await captureCompactDomForAi(page, Boolean(ctx.avoidAdClicks), { sameOriginOnly: Boolean(ctx.staySameOrigin) });
  if (!dom.inputs.length && !dom.clickables.length) return null;

  const cached = getCachedPlaybook(recoverKey);
  if (cached && cached.planSteps?.length) {
    aiTokenSaverStats.cacheHits += 1;
    aiTokenSaverStats.estimatedTokensSaved += cached.estTokens || 180;
    const patched = cached.planSteps.map(s => (
      s.act === 'fill' && /@/.test(String(s.val || '')) && (ctx.sessionInbox?.address || ctx.sessionInbox?.email)
        ? { ...s, val: ctx.sessionInbox.address || ctx.sessionInbox.email }
        : s
    ));
    const done = await executePlannedWorkerActions(page, patched, dom, ctx);
    return done.length ? `התאוששות AI [Cache ⚡]: ${done.join(' -> ')}` : null;
  }

  const emailPlaceholder = ctx.sessionInbox?.address || ctx.sessionInbox?.email || '';
  const systemPrompt = [
    'Previous UI selector skipped on this page.',
    'Pick ONE visible button/link or input id to progress the form/signup/consent naturally, or act="none".',
    'Reply ONLY JSON: {"act":"click|fill|scroll|none","id":0,"val":"..."}',
  ].join(' ');
  const userPrompt = JSON.stringify(redactData({
    hint: String(failedHint || '').slice(0, 80),
    email: emailPlaceholder ? 'USE_SESSION_EMAIL' : '',
    i: dom.inputs.map(x => ({ id: x.id, t: x.type, ph: x.placeholder })),
    c: dom.clickables.map(x => ({ id: x.id, txt: x.text })),
  }));

  const recoveryModel = ctx.aiConfig?.recoveryModel || ctx.aiConfig?.commanderModel || DEFAULT_COMMANDER_MODEL;

  try {
    aiTokenSaverStats.recoveryCalls += 1;
    let parsed = null;
    let usedRecoveryModel = recoveryModel;

    if (isDecisionModel(recoveryModel)) {
      const pick = await askRecoveryDecision(recoveryModel, dom, ctx, failedHint);
      if (pick) parsed = { act: pick.act, id: pick.id, val: pick.val };
    }

    if (!parsed) {
      const resp = await callAiChat({
        provider: providerPref,
        role: 'recovery',
        model: recoveryModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.15,
        maxTokens: 110,
        timeoutMs: 14000,
        json: true,
      });
      recordTokenUsage(resp.usage, resp.model);
      usedRecoveryModel = resp.model;
      parsed = extractJsonObject(resp.content);
    }

    const act = String(parsed?.act || parsed?.action || 'none').toLowerCase();
    if (!parsed || act === 'none') return null;

    const clickItem = act === 'click' && Number.isInteger(parsed.id) ? dom.clickables.find(c => c.id === parsed.id) : null;
    const inputItem = act === 'fill' && Number.isInteger(parsed.id) ? dom.inputs.find(i => i.id === parsed.id) : null;
    let fillVal = typeof parsed.val === 'string' ? parsed.val : '';
    if (act === 'fill' && emailPlaceholder && (!fillVal || fillVal.includes('USE_SESSION_EMAIL') || inputItem?.type === 'email')) {
      fillVal = emailPlaceholder;
    }

    const planSteps = [{
      act,
      id: Number.isInteger(parsed.id) ? parsed.id : undefined,
      val: fillVal,
      selectorHint: clickItem?.selector || inputItem?.selector || '',
      targetText: clickItem?.text || '',
    }];
    setCachedPlaybook(recoverKey, {
      model: `ollama_cloud:${usedRecoveryModel}`,
      planSteps,
      estTokens: Math.round((systemPrompt.length + userPrompt.length) / 3.5) + 50,
    });
    const done = await executePlannedWorkerActions(page, planSteps, dom, ctx);
    return done.length ? `התאוששות AI (${usedRecoveryModel}): ${done.join(' -> ')}` : null;
  } catch {
    return null;
  }
}

/**
 * Generates deterministic rule-based advice when Ollama Cloud is offline/unconfigured.
 */
function buildLocalCommanderFallback({ message, runState = {}, config = {} }) {
  const directives = [];
  const lines = [];
  const lower = String(message || '').toLowerCase();
  const completed = runState.completed || 0;
  const planned = runState.totalPlanned || config.visitCount || 0;
  const mem = runState.memUsedPct || 0;

  if (mem >= 85 && runState.status === 'running') {
    const safeConc = Math.max(1, Math.min(config.concurrency || 3, 2));
    directives.push({ type: 'set_concurrency', min: 1, max: safeConc });
    lines.push(`⚠️ זיהיתי עומס RAM גבוה (${mem}%), מומלץ להגביל מקביליות ל-${safeConc} או להפעיל מצב חיסכון RAM (lite).`);
  }
  if (/pause|עצור זמנית|השהה/.test(lower) && runState.status === 'running') {
    directives.push({ type: 'pause' });
    lines.push('מבצע השהיה זמנית של צי הדפדפנים.');
  } else if (/resume|המשך/.test(lower) && runState.status === 'paused') {
    directives.push({ type: 'resume' });
    lines.push('ממשיך את הרצת הצי.');
  } else if (/boost|burst|מהר|הגבר/.test(lower)) {
    directives.push({ type: 'set_wave_mode', mode: 'burst' });
    lines.push('מעביר פרופיל גלים למצב Burst ומתגבר תיאום.');
  }

  if (!lines.length) {
    const waveInfo = config.waves?.enabled ? `מצב גלים פעיל (${config.waves.mode})` : 'גלים כבויים';
    const countries = Array.isArray(config.proxy?.preferredCountries) && config.proxy.preferredCountries.length
      ? config.proxy.preferredCountries.join(', ')
      : 'ללא סינון מדינות';
    lines.push(
      `סטטוס צי: ${runState.status || 'idle'} (${completed}/${planned} ביקורים | הצלחות: ${runState.succeeded || 0} | כשלים: ${runState.failed || 0}).`,
      `תצורה נוכחית: ${waveInfo} | מדינות מועדפות: ${countries} | זיכרון: ${mem}%.`,
      resolveOllamaConfig().configured
        ? 'Ollama Cloud מוגדר ומוכן לפקודות תוך כדי ריצה.'
        : 'Ollama Cloud אינו מוגדר (פועל במצב בקר מקומי בטוח). הוסף מפתח בסביבה OLLAMA_API_KEY לשליטה חכמה מלאה.'
    );
  }

  return {
    reply: lines.join('\n'),
    directives,
    model: 'local-advisor',
    fallbackUsed: true,
  };
}

function parseCommanderReply(rawContent = '') {
  let reply = String(rawContent || '').trim();
  let directives = [];

  const cmdIdx = reply.search(/COMMAND_JSON\s*:/i);
  if (cmdIdx >= 0) {
    const rawCmd = reply.slice(cmdIdx).replace(/^COMMAND_JSON\s*:\s*/i, '').trim();
    reply = reply.slice(0, cmdIdx).trim();

    let parsed = null;
    if (rawCmd.startsWith('[')) {
      const endArr = rawCmd.lastIndexOf(']');
      if (endArr > 0) {
        try { parsed = JSON.parse(rawCmd.slice(0, endArr + 1)); } catch {}
      }
    }
    if (!parsed) {
      parsed = extractJsonObject(rawCmd);
    }

    if (Array.isArray(parsed)) {
      directives = parsed;
    } else if (parsed && Array.isArray(parsed.directives)) {
      directives = parsed.directives;
    } else {
      // Recover any complete directive objects if JSON was truncated mid-stream
      const objMatches = rawCmd.match(/\{[^{}]*"type"\s*:\s*"[^"]+"[^{}]*\}/g) || [];
      for (const m of objMatches) {
        try {
          const obj = JSON.parse(m);
          if (obj && typeof obj === 'object') directives.push(obj);
        } catch {}
      }
    }
  }

  // Strip any dangling truncated directive JSON fragment so chat text stays clean
  reply = reply.replace(/,?\s*\{\s*"type"\s*:[\s\S]*$/i, '').trim();
  directives = directives.filter(d => d && typeof d === 'object' && typeof d.type === 'string');

  return { reply, directives };
}

/**
 * Interactive Fleet Commander (Ollama Cloud) — answers user in Hebrew, inspects live swarm telemetry,
 * and emits structured runtime directives for the running Crawlee swarm.
 */
async function askFleetCommander({
  message,
  runState = {},
  config = {},
  recentLogs = [],
  visitDetails = [],
  history = [],
  model,
  provider,
  maxTokens = 1800,
  isAutoCheck = false,
} = {}) {
  registerStepSecrets(config.taskSteps);
  const chosenModel = model || config.ai?.commanderModel || DEFAULT_COMMANDER_MODEL;
  const providerPref = normalizeAiProvider(provider || config.ai?.provider || 'auto');
  const statusInfo = getOllamaStatusPublic();
  const hasCred = providerPref === 'ollama_cloud'
    ? statusInfo.providers.ollama_cloud.configured
    : (providerPref === 'uncensoredllm' ? statusInfo.providers.uncensoredllm.configured : statusInfo.configured);
  if (!hasCred) {
    return buildLocalCommanderFallback({ message, runState, config });
  }

  const recordingProfile = analyzeRecordedJourney(config.taskSteps || [], runState.targetUrl || config.targetUrl || '');
  const trimmedLogs = (recentLogs || [])
    .slice(-24)
    .map(l => String(l?.message || l || '').slice(0, 180))
    .filter(Boolean);
  const wasManualStop = trimmedLogs.some(m => /נעצרו ידנית|מתבצעת עצירה מבוקרת/.test(m));
  const emptyTabNotes = trimmedLogs.filter(m => /נותר ללא קישורים|נותר ריק|סינון\/חסימת צד-ג/.test(m)).slice(-4);

  const telemetrySummary = {
    status: runState.status || 'idle',
    targetUrl: runState.targetUrl || config.targetUrl || '',
    headless: config.headless !== false,
    taskMode: config.taskMode || 'behavior',
    streamMode: Boolean(runState.streamMode),
    recordingProfile: {
      stepsCount: recordingProfile.stepsCount,
      flowType: recordingProfile.flowLabelHe,
      hasEmailFlow: recordingProfile.hasEmailFlow,
      hasMultiTabFlow: recordingProfile.hasMultiTabFlow,
      externalTabs: recordingProfile.externalTabs,
      primaryExternalTab: recordingProfile.primaryExternalTab,
      hasToolOrFormFlow: recordingProfile.hasToolOrFormFlow,
      hasGuidesFlow: recordingProfile.hasGuidesFlow,
      keyRoutes: recordingProfile.keyRoutes,
      steps: recordingProfile.compactSteps,
    },
    completed: runState.completed || 0,
    totalPlanned: runState.totalPlanned || config.visitCount || 0,
    succeeded: runState.succeeded || 0,
    failed: runState.failed || 0,
    timedOut: runState.timedOut || 0,
    avgLoadMs: runState.avgLoadMs || null,
    slowVisitsCount: runState.slowVisitsCount || 0,
    errorsTotal: runState.errorsTotal || 0,
    lastErrorSample: runState.lastErrorSample || null,
    skippedStepsTotal: runState.skippedStepsTotal || 0,
    failFastTriggers: runState.failFastTriggers || 0,
    lastSkippedSelector: runState.lastSkippedSelector || null,
    currentConcurrency: runState.currentConcurrency || 0,
    maxConcurrency: runState.maxConcurrency || config.concurrency || 1,
    memUsedPct: runState.memUsedPct || 0,
    freeRamGb: runState.freeRamGb || 0,
    stealthMode: config.stealthMode || 'standard',
    resourceMode: runState.activeResourceMode || config.resourceMode || 'full',
    conversionRate: runState.activeConversionRate ?? config.waves?.conversionRate ?? 25,
    workerPct: runState.activeWorkerPct ?? config.ai?.workerPct ?? 0,
    squadModels: runState.activeSquadModels || null,
    diagnostics: {
      wasManualStop,
      emptyTabNotes,
    },
    proxy: {
      preferredCountries: config.proxy?.preferredCountries || [],
      transferMb: runState.proxyTransferMb ?? 0,
      savedMb: runState.proxySavedMb ?? 0,
      cacheHits: runState.proxyCacheHits ?? 0,
      blocked: runState.proxyBlockedRequests ?? 0,
    },
    aiStats: {
      apiCalls: runState.aiApiCalls ?? 0,
      cacheHits: runState.aiCacheHits ?? 0,
      recoveryCalls: runState.aiRecoveryCalls ?? 0,
      savedTokens: runState.aiSavedTokens ?? 0,
    },
    waves: config.waves || {},
    currentConfig: {
      targetUrl: config.targetUrl || '',
      visitCount: config.visitCount,
      minConcurrency: config.minConcurrency,
      concurrency: config.concurrency,
      headless: config.headless !== false,
      engineMode: config.engineMode,
      taskMode: config.taskMode,
      referrerMode: config.referrerMode,
      stealthMode: config.stealthMode,
      resourceMode: config.resourceMode,
      pageMinMs: config.pageMinMs,
      sessionTimeoutMs: config.sessionTimeoutMs,
      keepBrowserOpenMs: config.keepBrowserOpenMs,
      interVisitDelayMs: config.interVisitDelayMs,
      firstPagePriority: config.firstPagePriority,
      pages: config.pages,
      devices: config.devices,
      schedule: config.schedule,
      sessionPersistence: config.sessionPersistence,
      adSafety: config.adSafety,
      proxyEnabled: Boolean(config.proxy?.enabled),
      proxyMode: config.proxy?.mode,
      preferredCountries: config.proxy?.preferredCountries || [],
      proxyServersCount: Array.isArray(config.proxy?.servers) ? config.proxy.servers.length : 0,
      ai: config.ai,
    },
    recentVisitsSample: (visitDetails || []).slice(0, 6).map(v => ({
      visit: v.visitNumber || v.visit,
      status: v.status,
      loadMs: v.loadMs,
      errors: v.pageErrors || 0,
      skipped: v.skippedSteps || 0,
      device: v.device,
      persona: v.persona,
      country: v.country || null,
      urls: Array.isArray(v.visitedUrls) ? v.visitedUrls.map(u => u.url || u.path).slice(0, 5) : undefined,
    })),
    recentLogs: trimmedLogs,
  };

  const systemPrompt = [
    'אתה מפקד הצי העליון (Supreme AI Fleet Commander) המנהל 4 מפקדי צוותים ב-Ollama Cloud:',
    'אלפא (deepseek-v4.1-flash — כלים), בראבו (beam — טאבים וזרימות עומק), צ׳ארלי (minimax-m3.1-flash — מדריכים), דלתא (gpt-oss:20b — ניווט וקבלת החלטות).',
    'מודלים זולים נוספים להקצאה: nemotron-3-nano:30b, nemotron-3-super, gemma4:31b, deepseek-v4.1-flash:1017 (אין להשתמש ב-clef:27b).',
    'כלל אמינות ברזל (אפס המצאות): הסתמך אך ורק על הנתונים האמיתיים ב-telemetrySummary (צעדי ההקלטה, הלוגים האחרונים, currentConfig והדיאגנוסטיקה).',
    'כלל שפה חשוב: דבר בעברית טבעית, ברורה, פשוטה וזורמת — כמו עוזר אנושי חכם שמדבר עם בעל המערכת! אסור לכתוב בתשובה שמות משתנים טכניים באנגלית מתוך הקוד (אל תכתוב avgLoadMs, hasEmailFlow, emptyTabNotes, popup-empty, workerPct, failFastTriggers, conversionRate, resourceMode). במקום זאת תרגם הכל לעברית פשוטה: "זמן טעינה ממוצע", "אחוז המרות", "טאב חיצוני ריק", "דילוג מהיר", "מצב חיסכון מקסימלי".',
    'אם אין שלב מייל בהקלטה — אל תתלונן על "0 מיילים". אם resourceMode כבר מוגדר כ-ultra_lite לחיסכון בפרוקסי וב-RAM — אל תשנה אותו בחזרה ל-lite!',
    isAutoCheck
      ? 'זו בדיקת מצב שוטפת: סכם בקצרה בעברית ברורה ונקייה (עד 140 מילים, שורה לכל נושא): תקלות/טאבים, מהירות, חיסכון בפרוקסי וב-AI, זיכרון פנוי, והחלטה מעשית.'
      : 'זו פנייה ישירה של המפעיל! ענה קודם ישירות, חכם וברור בעברית על מה ששאל או ביקש, הצע פתרונות יצירתיים ומעשיים לבעיה אם יש כזו, ובצע מיד כל שינוי/אופטימיזציה שביקש דרך COMMAND_JSON!',
    'כאשר יש לבצע פעולה או כשהמפעיל מבקש שינוי, הוסף בסוף התשובה בשורה נפרדת JSON מדויק בפורמט: COMMAND_JSON:{"directives":[...]} (אובייקט עם מפתח directives).',
    'יש לך שליטה מלאה על כל המערכת! אתה יכול לשנות **כל ערך** בקונפיגורציה דרך update_config (patch חלקי על currentConfig — למשל devices, proxy, adSafety, sessionPersistence, schedule, stealthMode, referrerMode, pageMinMs, sessionTimeoutMs, keepBrowserOpenMs, interVisitDelayMs, firstPagePriority, pages, waves, ai, visitCount, concurrency, targetUrl):',
    '{"type":"update_config","patch":{"devices":{"iphone14":50,"pixel7":30,"desktopChrome":20},"adSafety":{"avoidAdClicks":true},"sessionPersistence":{"returningUserRate":70},"referrerMode":"google_organic"}},',
    'ובנוסף פקודות ייעודיות:',
    '{"type":"set_visits","visits":100}, {"type":"start_run","visits":25,"conversionRate":100,"headless":false,"streamMode":false}, {"type":"stop_run"}, {"type":"pause"}, {"type":"resume"},',
    '{"type":"set_concurrency","min":1,"max":3}, {"type":"set_conversion_rate","rate":100}, {"type":"set_worker_pct","pct":85},',
    '{"type":"set_headless","headless":true}, {"type":"set_task_mode","mode":"scenario|hybrid|behavior"}, {"type":"set_stream_mode","enabled":true},',
    '{"type":"set_wave_mode","mode":"off|steady|ramp_up|natural_peaks|burst"}, {"type":"set_resource_mode","mode":"full|lite|ultra_lite"},',
    '{"type":"set_exploration","extraPageChance":70,"scanProductsChance":80,"maxProducts":2}, {"type":"set_delays","interVisitDelayMs":1500},',
    '{"type":"add_recording_step","afterTab":1,"step":{"type":"ai_explore|scan_products|human_browse|read_article|scroll|wait|goto|close_tab","tab":1,"value":"3","label":"תיאור הצעד"}},',
    '{"type":"remove_recording_step","index":5}, {"type":"replace_task_steps","steps":[...]},',
    '{"type":"assign_squad_model","squadId":"alpha|bravo|charlie|delta|all","model":"beam|deepseek-v4.1-flash|minimax-m3.1-flash|gpt-oss:20b|nemotron-3-nano:30b|gemma4:31b"},',
    '{"type":"focus_countries","countries":["US","GB","CA","DE","AU"]}, {"type":"dispatch_directive","directive":"הוראה מעשית חיה לצוותים"}.',
    'אם אין מה לשנות/להפעיל, אל תכלול COMMAND_JSON.',
  ].join(' ');

  const sanitizedHistory = (Array.isArray(history) ? history : [])
    .slice(-6)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && !/^Let me analyze/i.test(m.content.trim()))
    .map(m => ({ role: m.role, content: m.content.slice(0, 500) }));

  const messages = [
    { role: 'system', content: systemPrompt },
    ...sanitizedHistory,
    {
      role: 'user',
      content: `פקודה/שאלה מהמפעיל: ${message || 'תן תמונת מצב קצרה על הצי והמלצה'}\n\nטלמטריה חיה:\n${JSON.stringify(redactData(telemetrySummary))}`,
    },
  ];

  try {
    const resp = await callAiChat({
      provider: providerPref,
      role: 'commander',
      model: chosenModel,
      messages,
      temperature: 0.3,
      maxTokens: Number(maxTokens) || 1500,
      timeoutMs: 22000,
    });

    recordTokenUsage(resp.usage, resp.model);
    const parsedReply = parseCommanderReply(resp.content || '');

    return {
      reply: parsedReply.reply || 'פקודת הניטור התקבלה במפקד הצי.',
      directives: parsedReply.directives,
      provider: resp.provider,
      model: resp.model,
      fallbackUsed: false,
    };
  } catch (err) {
    const fallback = buildLocalCommanderFallback({ message, runState, config });
    return {
      ...fallback,
      reply: `${fallback.reply}\n(הערת חיבור Cloud AI: ${err.message})`,
    };
  }
}

module.exports = {
  DEFAULT_COMMANDER_MODEL,
  DEFAULT_WORKER_MODEL,
  OLLAMA_CHEAP_WORKER_POOL,
  DEFAULT_ULLM_CHEAP_COMMANDER,
  DEFAULT_ULLM_CHEAP_WORKER,
  normalizeAiProvider,
  mapModelForProvider,
  resolveProviderConfig,
  resolveOllamaConfig,
  getOllamaStatusPublic,
  callAiChat,
  callOllamaChat,
  callDecisionModel,
  askDecision,
  askActionChoice,
  PAGE_STATES,
  askRecoveryDecision,
  isDecisionModel,
  DECISION_MODELS,
  OLLAMA_DECISION_PATH,
  captureCompactDomForAi,
  sanitizeWorkerGoal,
  getPlaybookCacheKey,
  getRouteGroupCacheKey,
  getAiTokenSaverStats,
  getModelMemory,
  preferredTransport,
  THINK_BY_ROLE,
  AI_MODELS_FILE,
  aiPagePlaybookCache,
  runAiExploreStep,
  runAiSmartRecoveryStep,
  askFleetCommander,
  parseCommanderReply,
  buildLocalCommanderFallback,
};
