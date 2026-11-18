'use strict';

/**
 * Local-only environment loader.
 *
 * The public repository must never carry credentials, so every secret lives in `.env.local`
 * next to this project. That file is gitignored and is not part of the release.
 *
 * Nothing in here is required for the engine to run. If `.env.local` is missing this is a no-op
 * and every feature that depends on a key reports itself as unconfigured instead of failing hard.
 *
 * Only variable NAMES are ever returned, never values, so this is safe to log.
 */

const fs = require('fs');
const path = require('path');

const LOCAL_ENV_PATH = path.join(__dirname, '..', '.env.local');

function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted = (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}

function loadLocalEnv({ filePath = LOCAL_ENV_PATH, override = false } = {}) {
  let text;
  try {
    if (!fs.existsSync(filePath)) return { loaded: false, path: filePath, keys: [] };
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { loaded: false, path: filePath, keys: [] };
  }

  const parsed = parseEnv(text);
  const applied = [];
  for (const [key, value] of Object.entries(parsed)) {
    // An empty value means "not filled in yet". Setting it would make `key in process.env` true
    // for features that never got a real value, so empty entries are simply skipped.
    if (!value) continue;
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
      applied.push(key);
    }
  }
  return { loaded: true, path: filePath, keys: applied };
}

module.exports = { loadLocalEnv, parseEnv, LOCAL_ENV_PATH };
