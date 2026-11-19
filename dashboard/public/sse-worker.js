const ports = new Set();
let es = null;
let lastInit = null;

function broadcast(type, rawData) {
  for (const p of ports) {
    try {
      p.postMessage({ type, data: rawData });
    } catch {
      ports.delete(p);
    }
  }
}

function patchInitCache(type, rawData) {
  if (!lastInit) return;
  try {
    const parsed = rawData ? JSON.parse(rawData) : null;
    if (!parsed) return;
    if (type === 'status') lastInit.status = parsed;
    else if (type === 'system_pulse') lastInit.system = parsed;
    else if (type === 'live_frame') lastInit.latestFrame = parsed;
    else if (type === 'recorder_update') lastInit.recorder = parsed;
    else if (type === 'profiles_updated') lastInit.profiles = parsed.profiles || lastInit.profiles;
    else if (type === 'log') {
      lastInit.logs = Array.isArray(lastInit.logs) ? lastInit.logs : [];
      lastInit.logs.push(parsed);
      if (lastInit.logs.length > 1000) lastInit.logs.shift();
    } else if (type === 'clear_logs') {
      lastInit.logs = [];
      lastInit.visitDetails = [];
      lastInit.latestFrame = null;
    } else if (type === 'visit_detail') {
      lastInit.visitDetails = Array.isArray(lastInit.visitDetails) ? lastInit.visitDetails : [];
      lastInit.visitDetails.unshift(parsed);
      if (lastInit.visitDetails.length > 100) lastInit.visitDetails.pop();
    } else if (type === 'demo_event') {
      lastInit.demoEvents = Array.isArray(lastInit.demoEvents) ? lastInit.demoEvents : [];
      lastInit.demoEvents.unshift(parsed);
      if (lastInit.demoEvents.length > 250) lastInit.demoEvents.pop();
    }
  } catch {}
}

function ensureEventSource() {
  if (es) return;
  es = new EventSource('/api/events');
  // Clear cached init whenever the backend restarts so a new tab never flashes stale state (e.g. old desktop warning).
  es.onerror = () => {
    lastInit = null;
  };
  const events = [
    'init',
    'system_pulse',
    'clear_logs',
    'log',
    'status',
    'live_frame',
    'visit_detail',
    'demo_event',
    'profiles_updated',
    'recorder_update',
    'config_updated',
    'report_ready',
    'ai_feed',
  ];
  for (const evtName of events) {
    es.addEventListener(evtName, e => {
      const raw = e.data || '';
      if (evtName === 'init') {
        try { lastInit = JSON.parse(raw); } catch {}
      } else {
        patchInitCache(evtName, raw);
      }
      broadcast(evtName, raw);
    });
  }
}

self.onconnect = event => {
  const port = event.ports[0];
  if (!port) return;
  ports.add(port);
  if (es && !lastInit && es.readyState === 0) {
    try { es.close(); } catch {}
    es = null;
  }
  ensureEventSource();

  port.onmessage = msg => {
    if (msg?.data?.type === 'disconnect') {
      ports.delete(port);
      if (ports.size === 0 && es) {
        try { es.close(); } catch {}
        es = null;
      }
    }
  };

  if (lastInit) {
    try {
      port.postMessage({ type: 'init', data: JSON.stringify(lastInit) });
    } catch {}
  }
};
