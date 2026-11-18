const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { askFleetCommander } = require('./aiCommander');
const { maskEmail, redactText, redactData, registerStepSecrets } = require('./redaction');

const ROOT_DIR = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(ROOT_DIR, 'reports');
const SESSION_STATE_FILE = path.join(REPORTS_DIR, 'latest-session-state.json');
const INBOXES_STATE_FILE = path.join(REPORTS_DIR, 'active-inboxes.json');

function ensureReportsDir() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function savePersistentSessionState({ runState, logHistory, visitDetails, aiHistory }) {
  try {
    ensureReportsDir();
    const payload = {
      savedAt: new Date().toISOString(),
      runState: runState || null,
      logHistory: Array.isArray(logHistory) ? logHistory.slice(-800) : [],
      visitDetails: Array.isArray(visitDetails) ? visitDetails.slice(0, 100) : [],
      aiHistory: Array.isArray(aiHistory) ? aiHistory.slice(-40) : [],
    };
    fs.writeFileSync(SESSION_STATE_FILE, JSON.stringify({ ...redactData(payload), redactionVersion: 1 }, null, 2), 'utf8');
  } catch {}
}

function loadPersistentSessionState() {
  try {
    if (!fs.existsSync(SESSION_STATE_FILE)) return null;
    const state = JSON.parse(fs.readFileSync(SESSION_STATE_FILE, 'utf8'));
    if (state.redactionVersion === 1) return redactData(state);
    // Older saved telemetry can include truncated field values that cannot be safely matched.
    if (state.runState) {
      const { status, startedAt, finishedAt, totalPlanned, completed, succeeded, failed, streamMode, streamWave } = state.runState;
      return { runState: { status, startedAt, finishedAt, totalPlanned, completed, succeeded, failed, streamMode, streamWave } };
    }
    return null;
  } catch {
    return null;
  }
}

function savePersistentInboxes(mapObj) {
  try {
    ensureReportsDir();
    const entries = Array.from(mapObj.entries());
    fs.writeFileSync(INBOXES_STATE_FILE, JSON.stringify(entries, null, 2), 'utf8');
  } catch {}
}

function loadPersistentInboxes() {
  try {
    if (!fs.existsSync(INBOXES_STATE_FILE)) return new Map();
    const entries = JSON.parse(fs.readFileSync(INBOXES_STATE_FILE, 'utf8'));
    return new Map(Array.isArray(entries) ? entries : []);
  } catch {
    return new Map();
  }
}

function listSavedReports() {
  try {
    ensureReportsDir();
    const files = fs.readdirSync(REPORTS_DIR)
      .filter(f => f.startsWith('run-report-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 30);
    return files.map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), 'utf8'));
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function generateRunPdfReport({
  runState = {},
  config = {},
  logs = [],
  visitDetails = [],
  inboxes = [],
} = {}) {
  registerStepSecrets(config.taskSteps);
  runState = redactData(runState);
  logs = redactData(logs);
  visitDetails = redactData(visitDetails);
  ensureReportsDir();
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportId = `run-report-${stamp}`;
  const htmlFile = `${reportId}.html`;
  const pdfFile = `${reportId}.pdf`;
  const jsonFile = `${reportId}.json`;

  const htmlPath = path.join(REPORTS_DIR, htmlFile);
  const pdfPath = path.join(REPORTS_DIR, pdfFile);
  const jsonPath = path.join(REPORTS_DIR, jsonFile);

  const createdEmails = [...new Map(inboxes.map(inbox => [inbox.inbox_id, maskEmail(inbox.address)])).values()];
  const planned = runState.totalPlanned ?? config.visitCount ?? 0;
  const succeeded = runState.succeeded ?? 0;
  const failed = runState.failed ?? 0;
  const averageLoadMs = runState.avgLoadMs ?? 0;
  const target = redactText(runState.targetUrl || config.targetUrl);
  let summary = [
    'Visits: ' + succeeded + ' succeeded out of ' + planned + ' planned. ' + failed + ' failed.',
    'Average page load: ' + averageLoadMs + ' ms.',
    'Live inboxes created: ' + createdEmails.length + '.'
  ].join('\n');
  let aiModelUsed = 'Local summary';

  if (config.ai?.enabled) {
    const prompt = [
      'Summarize this browser QA run in English, focusing on failures and next steps.',
      'Report only outcomes visible in the supplied data. An inbox created is not evidence of a verified signup.',
      'Target: ' + target,
      'Status: ' + (runState.status || 'unknown'),
      summary,
    ].join('\n');
    try {
      const review = await askFleetCommander({
        message: prompt, runState, config, recentLogs: logs.slice(-25), visitDetails,
        model: config.ai.commanderModel, provider: config.ai.provider, maxTokens: 1500,
      });
      if (!review.fallbackUsed && review.reply && !/^Let me analyze/i.test(review.reply.trim())) {
        summary = redactText(review.reply.trim());
        aiModelUsed = review.provider + ':' + review.model;
      }
    } catch {}
  }

  const visitRowsHtml = (visitDetails || []).slice().reverse().map(v => {
    const pathStr = Array.isArray(v.visitedUrls)
      ? v.visitedUrls.map(u => `${u.path || u.url} (${u.status})`).join(' ← ')
      : (v.routeSummary || '-');
    const isOk = Boolean(v.ok || (typeof v.status === 'number' && v.status >= 200 && v.status < 400));
    const badgeLabel = isOk ? `OK (${v.status || 200})` : `Error (${v.status || 'err'})`;
    return `
      <tr>
        <td>#${escapeHtml(v.visit ?? v.visitNumber ?? '-')}</td>
        <td>${isOk ? `<span class="badge ok">${escapeHtml(badgeLabel)}</span>` : `<span class="badge err">${escapeHtml(badgeLabel)}</span>`}</td>
        <td>${escapeHtml(v.persona || '-')}</td>
        <td>${escapeHtml(v.device || '-')}</td>
        <td>${escapeHtml(v.country || v.geo || '-')}</td>
        <td>${escapeHtml(v.loadMs ? `${v.loadMs}ms` : '-')}</td>
        <td style="font-size:11px;direction:ltr;text-align:left;">${escapeHtml(pathStr)}</td>
      </tr>
    `;
  }).join('');

  const logLinesHtml = (logs || []).map(l => {
    const timeStr = l.ts ? l.ts.slice(11, 19) : '';
    const cls = l.level === 'stderr' ? 'log-err' : 'log-info';
    return `<div class="log-line ${cls}"><span class="log-ts">${escapeHtml(timeStr)}</span> ${escapeHtml(l.message)}</div>`;
  }).join('');

  const htmlContent = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8" />
  <title>Run report — ${escapeHtml(reportId)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #0f172a; color: #f1f5f9; margin: 0; padding: 24px; line-height: 1.55; }
    .header { background: linear-gradient(135deg, #1e293b, #0f172a); border: 1px solid #334155; border-radius: 12px; padding: 20px 24px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { margin: 0 0 6px 0; font-size: 20px; color: #38bdf8; }
    .header .meta { font-size: 12px; color: #94a3b8; }
    .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 18px; }
    .kpi { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 12px; text-align: center; }
    .kpi .val { font-size: 20px; font-weight: 700; color: #4ade80; }
    .kpi .lbl { font-size: 11px; color: #94a3b8; margin-top: 4px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 18px 20px; margin-bottom: 18px; page-break-inside: avoid; }
    .card h2 { margin: 0 0 10px 0; font-size: 15px; color: #38bdf8; border-bottom: 1px solid #334155; padding-bottom: 6px; }
    .ai-box { white-space: pre-wrap; font-size: 13px; color: #e2e8f0; background: #0f172a; border-right: 4px solid #38bdf8; padding: 14px; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #334155; padding: 8px 6px; text-align: left; }
    th { color: #94a3b8; background: #0f172a; }
    .badge { padding: 2px 7px; border-radius: 99px; font-size: 10px; font-weight: 700; }
    .badge.ok { background: rgba(74, 222, 128, 0.18); color: #4ade80; }
    .badge.err { background: rgba(248, 113, 113, 0.2); color: #f87171; }
    .log-container { background: #090d16; border: 1px solid #1e293b; border-radius: 8px; padding: 12px; font-family: Consolas, monospace; font-size: 10.5px; line-height: 1.45; }
    .log-line { padding: 2px 0; border-bottom: 1px dashed rgba(51,65,85,0.3); word-break: break-word; }
    .log-ts { color: #64748b; margin-left: 6px; }
    .log-err { color: #f87171; }
    .log-info { color: #cbd5e1; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Run report</h1>
      <div class="meta">Target <strong>${escapeHtml(redactText(runState.targetUrl || config.targetUrl))}</strong> | Date ${escapeHtml(now.toLocaleString('en-GB'))} | Summary ${escapeHtml(aiModelUsed)}</div>
    </div>
    <div style="text-align:left;font-size:12px;color:#4ade80;font-weight:700;">Report ID<br/>${escapeHtml(reportId)}</div>
  </div>

  <div class="kpi-grid">
    <div class="kpi"><div class="val">${escapeHtml(`${runState.succeeded || 0}/${runState.totalPlanned || config.visitCount || 0}`)}</div><div class="lbl">Successful visits</div></div>
    <div class="kpi"><div class="val">${escapeHtml(`${runState.avgLoadMs || 0}ms`)}</div><div class="lbl">Average load time</div></div>
    <div class="kpi"><div class="val">${escapeHtml(`${failed}`)}</div><div class="lbl">Failed visits</div></div>
    <div class="kpi"><div class="val">${escapeHtml(String(createdEmails.length))}</div><div class="lbl">Inboxes created</div></div>
    <div class="kpi"><div class="val">${escapeHtml(config.proxy?.enabled ? ((config.proxy.preferredCountries || []).join(', ') || 'Any') : 'Direct')}</div><div class="lbl">Proxy countries</div></div>
  </div>

  <div class="card">
    <h2>Run summary (${escapeHtml(aiModelUsed)})</h2>
    <div class="ai-box">${escapeHtml(summary)}</div>
  </div>

  <div class="card">
    <h2>Inboxes created in this run</h2>
    <div style="font-size:12px;color:#cbd5e1;">
      ${createdEmails.length
        ? createdEmails.map(e => `<div>• <code>${escapeHtml(e)}</code> <span class="badge">Created</span></div>`).join('')
        : 'No inboxes were created.'}
    </div>
  </div>

  <div class="card">
    <h2>Visit results</h2>
    <table>
      <thead>
        <tr>
          <th>Visit</th>
          <th>Status</th>
          <th>Persona</th>
          <th>Device</th>
          <th>Country</th>
          <th>Load time</th>
          <th>Pages and tabs</th>
        </tr>
      </thead>
      <tbody>
        ${visitRowsHtml || '<tr><td colspan="7">No visit details available.</td></tr>'}
      </tbody>
    </table>
  </div>

  <div class="card" style="page-break-inside: auto;">
    <h2>Run log (${logs.length} lines)</h2>
    <div class="log-container">
      ${logLinesHtml || 'No log entries.'}
    </div>
  </div>
</body>
</html>`;

  fs.writeFileSync(htmlPath, htmlContent, 'utf8');

  let pdfCreated = false;
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
    pdfCreated = fs.existsSync(pdfPath);
  } catch {
    pdfCreated = false;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const meta = {
    id: reportId,
    createdAt: now.toISOString(),
    targetUrl: runState.targetUrl || config.targetUrl || '',
    totalPlanned: runState.totalPlanned || config.visitCount || 0,
    succeeded: runState.succeeded || 0,
    failed: runState.failed || 0,
    avgLoadMs: runState.avgLoadMs || 0,
    emailsCreated: createdEmails.length,
    aiModelUsed,
    aiSummaryHe: summary,
    pdfFile: pdfCreated ? pdfFile : null,
    htmlFile,
    logLinesCount: logs.length,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

module.exports = {
  REPORTS_DIR,
  savePersistentSessionState,
  loadPersistentSessionState,
  savePersistentInboxes,
  loadPersistentInboxes,
  listSavedReports,
  generateRunPdfReport,
};
