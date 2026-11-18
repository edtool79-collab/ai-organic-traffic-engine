const fs = require('node:fs');
const path = require('node:path');

const RUN_INBOXES_FILE = path.join(__dirname, '..', 'reports', 'run-inboxes.jsonl');

function readRunInboxes() {
  let lines;
  try {
    lines = fs.readFileSync(RUN_INBOXES_FILE, 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
  const inboxes = new Map();
  for (const line of lines) {
    if (!line) continue;
    try {
      const inbox = JSON.parse(line);
      if (inbox?.inbox_id && inbox.address) inboxes.set(inbox.inbox_id, inbox);
    } catch {
      // A partially written journal line does not invalidate the completed entries.
    }
  }
  return [...inboxes.values()];
}

module.exports = { RUN_INBOXES_FILE, readRunInboxes };
