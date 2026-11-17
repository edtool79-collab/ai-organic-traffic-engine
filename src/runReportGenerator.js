const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { askFleetCommander } = require('./aiCommander');

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
    fs.writeFileSync(SESSION_STATE_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch {}
}

function loadPersistentSessionState() {
  try {
    if (!fs.existsSync(SESSION_STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(SESSION_STATE_FILE, 'utf8'));
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
} = {}) {
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

  // Extract email addresses created & confirmed from logs
  const createdEmails = [];
  const confirmedEmails = [];
  let convertersCount = 0;
  let organicCount = 0;

  for (const entry of logs) {
    const msg = String(entry?.message || '');
    const emailMatch = msg.match(/([a-f0-9]{16,64}@gethirepulse\.xyz)/i);
    if (msg.includes('נוצרה תיבת מייל חיה לסוכן') && emailMatch) {
      if (!createdEmails.includes(emailMatch[1])) createdEmails.push(emailMatch[1]);
    }
    if (
      msg.includes('אישור מייל אוטומטי') ||
      msg.includes('אישור קוד OTP אוטומטי') ||
      msg.includes('מייל התקבל בתיבת הסוכן') ||
      msg.includes('נשלף קוד אימות חי מהמייל')
    ) {
      const targetEmail = emailMatch ? emailMatch[1] : `otp-${confirmedEmails.length + 1}`;
      if (!confirmedEmails.includes(targetEmail)) confirmedEmails.push(targetEmail);
    }
    if (msg.includes('🎯[מסלול המרה+רישום מייל]') || msg.includes('🎯[מסלול מוקלט מלא]')) convertersCount++;
    if (msg.includes('🌿[גלישה אורגנית באתר]')) organicCount++;
  }

  // Ask the connected AI model for a comprehensive Hebrew executive summary
  let aiSummaryHe = '';
  let aiModelUsed = config.ai?.commanderModel || 'glm-5.3-flash';
  try {
    const proxySaverLine = logs.find(l => String(l?.message || '').includes('[Proxy Saver]'))?.message || '';
    const aiBrainLine = logs.find(l => String(l?.message || '').includes('[AI Brain]'))?.message || '';
    const hasEmailFlow = (config.taskSteps || []).some(
      s => ['fill_email', 'fill_otp'].includes(s?.type) || /mail|email|otp/i.test(`${s?.selector || ''} ${s?.label || ''}`)
    );
    const wasManualStop = logs.some(l => /נעצרו ידנית|מתבצעת עצירה מבוקרת/.test(String(l?.message || '')));
    const summaryPrompt = [
      'הריצה הסתיימה כעת. כתוב דוח סיכום מנהלים מקצועי ומפורט בעברית בלבד (ללא שום מילה באנגלית וללא COMMAND_JSON).',
      `יעד הריצה: ${runState.targetUrl || config.targetUrl}`,
      `תוצאות: ${runState.succeeded || 0}/${runState.totalPlanned || config.visitCount || 0} הצליחו, ${runState.failed || 0} נכשלו, זמן טעינה ממוצע: ${runState.avgLoadMs || 0}ms.`,
      wasManualStop ? 'הערה חשובה: ההרצה הופסקה ידנית על ידי המפעיל (סגירת דפדפנים אחרי פקודת העצירה היא חלק מכיבוי מבוקר ואינה קריסת זיכרון).' : '',
      hasEmailFlow
        ? `פיצול סוכנים: ${convertersCount} סוכני המרה ורישום מייל, ${organicCount} סוכני גלישה אורגנית.`
        : `פיצול סוכנים: ${convertersCount} סוכני מסלול מוקלט מלא, ${organicCount} סוכני גלישה אורגנית באתר.`,
      (hasEmailFlow || createdEmails.length > 0)
        ? `תיבות מייל חיות שנוצרו: ${createdEmails.length} (${confirmedEmails.length} אומתו).`
        : 'סוג תרחיש: ללא שלב רישום מייל בהקלטה (אין לצפות לתיבות מייל או המרות מייל).',
      proxySaverLine ? `חיסכון בפרוקסי: ${proxySaverLine}` : '',
      aiBrainLine ? `חיסכון ופעילות AI: ${aiBrainLine}` : '',
      'חלק את הסיכום ל-4 סעיפים קצרים וברורים עם נקודות:',
      '1. ציון כולל וביצועי הרצה',
      '2. ניתוח מסלולי הסוכנים',
      '3. יציבות רשת, פרוקסי וזיכרון',
      '4. מסקנות והמלצות להרצה הבאה',
    ].filter(Boolean).join('\n');

    const SYNTHETIC_NOISE_RE = /Clipboard|writeText|downloadable font|ResizeObserver loop|favicon\.ico|ERR_BLOCKED_BY_CLIENT/i;
    const cleanVisitDetails = (visitDetails || []).map(v => {
      if (!v || !Array.isArray(v.errorDetails)) return v;
      const filtered = v.errorDetails.filter(e => !SYNTHETIC_NOISE_RE.test(String(e || '')));
      return { ...v, errorDetails: filtered, pageErrors: filtered.length };
    });

    const aiRes = await askFleetCommander({
      message: summaryPrompt,
      runState,
      config,
      recentLogs: logs.slice(-25),
      visitDetails: cleanVisitDetails,
      model: config.ai?.commanderModel,
      provider: config.ai?.provider,
      maxTokens: 1500,
    });
    if (aiRes && aiRes.reply && !/^Let me analyze/i.test(aiRes.reply.trim())) {
      aiSummaryHe = aiRes.reply.trim();
      aiModelUsed = `${aiRes.provider || 'cloud'}:${aiRes.model || aiModelUsed}`;
    }
  } catch {}

  if (!aiSummaryHe) {
    aiSummaryHe = [
      `• ביצועי הריצה: הושלמו ${runState.completed || 0} מתוך ${runState.totalPlanned || config.visitCount || 0} ביקורים מתוכננים ביעד ${runState.targetUrl || config.targetUrl} (${runState.succeeded || 0} הצליחו, ${runState.failed || 0} שגיאות, זמן טעינה ממוצע: ${runState.avgLoadMs || 0}ms).`,
      `• פיצול משפך: ${convertersCount} סוכנים ביצעו את מסלול ההמרה והרישום המלא, ו-${organicCount} סוכנים ביצעו גלישה אורגנית מגוונת בעמודי האתר.`,
      `• אימיילים חיים (@gethirepulse.xyz): נוצרו ${createdEmails.length} תיבות מייל ייחודיות לסוכנים (${confirmedEmails.length} אומתו).`,
      `• רשת ופרוקסי: הריצה פעלה במצב ${config.stealthMode || 'maximum'} עם רוטציית פרוקסי (${(config.proxy?.preferredCountries || []).join(', ') || 'ללא סינון'}).`,
    ].join('\n');
  }

  const visitRowsHtml = (visitDetails || []).slice().reverse().map(v => {
    const pathStr = Array.isArray(v.visitedUrls)
      ? v.visitedUrls.map(u => `${u.path || u.url} (${u.status})`).join(' ← ')
      : (v.routeSummary || '-');
    const isOk = Boolean(v.ok || (typeof v.status === 'number' && v.status >= 200 && v.status < 400));
    const badgeLabel = isOk ? `תקין (${v.status || 200})` : `שגיאה (${v.status || 'err'})`;
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
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>דוח הרצה מסכם — ${escapeHtml(reportId)}</title>
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
    th, td { border-bottom: 1px solid #334155; padding: 8px 6px; text-align: right; }
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
      <h1>📊 דוח הרצה מסכם ומפורט (AI Fleet Report)</h1>
      <div class="meta">יעד: <strong>${escapeHtml(runState.targetUrl || config.targetUrl)}</strong> | תאריך: ${escapeHtml(now.toLocaleString('he-IL'))} | מודל מסכם: ${escapeHtml(aiModelUsed)}</div>
    </div>
    <div style="text-align:left;font-size:12px;color:#4ade80;font-weight:700;">מזהה דוח:<br/>${escapeHtml(reportId)}</div>
  </div>

  <div class="kpi-grid">
    <div class="kpi"><div class="val">${escapeHtml(`${runState.succeeded || 0}/${runState.totalPlanned || config.visitCount || 0}`)}</div><div class="lbl">ביקורים שהצליחו</div></div>
    <div class="kpi"><div class="val">${escapeHtml(`${runState.avgLoadMs || 0}ms`)}</div><div class="lbl">זמן טעינה ממוצע</div></div>
    <div class="kpi"><div class="val">${escapeHtml(`${convertersCount} / ${organicCount}`)}</div><div class="lbl">המרה 🎯 מול אורגני 🌿</div></div>
    <div class="kpi"><div class="val">${escapeHtml(String(createdEmails.length))}</div><div class="lbl">תיבות מייל חיות שנוצרו</div></div>
    <div class="kpi"><div class="val">${escapeHtml((config.proxy?.preferredCountries || []).join(', ') || 'Direct')}</div><div class="lbl">מדינות Proxy פעילות</div></div>
  </div>

  <div class="card">
    <h2>🧠 סיכום מנהלים ותובנות מודל ה-AI (${escapeHtml(aiModelUsed)})</h2>
    <div class="ai-box">${escapeHtml(aiSummaryHe)}</div>
  </div>

  <div class="card">
    <h2>📧 תיבות אימייל חיות שנוצרו בריצה (@gethirepulse.xyz)</h2>
    <div style="font-size:12px;color:#cbd5e1;">
      ${createdEmails.length
        ? createdEmails.map(e => `<div>• <code>${escapeHtml(e)}</code> ${confirmedEmails.includes(e) ? '<span class="badge ok">אומת בהצלחה ✅</span>' : '<span class="badge">נוצר והוזן בטופס</span>'}</div>`).join('')
        : 'לא נוצרו תיבות מייל חדשות בריצה זו.'}
    </div>
  </div>

  <div class="card">
    <h2>🛣️ פירוט ביקורים ומסלולים (Visit-by-Visit Breakdown)</h2>
    <table>
      <thead>
        <tr>
          <th>ביקור</th>
          <th>סטטוס</th>
          <th>פרסונה</th>
          <th>מכשיר</th>
          <th>מדינה (Geo)</th>
          <th>זמן טעינה</th>
          <th>מסלול עמודים וטאבים</th>
        </tr>
      </thead>
      <tbody>
        ${visitRowsHtml || '<tr><td colspan="7">אין נתוני ביקורים מפורטים.</td></tr>'}
      </tbody>
    </table>
  </div>

  <div class="card" style="page-break-inside: auto;">
    <h2>📜 יומן לוגים מלא של ההרצה (${logs.length} שורות — שמור לצמיתות)</h2>
    <div class="log-container">
      ${logLinesHtml || 'אין שורות לוג.'}
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
    convertersCount,
    organicCount,
    emailsCreated: createdEmails.length,
    emailsConfirmed: confirmedEmails.length,
    aiModelUsed,
    aiSummaryHe,
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
