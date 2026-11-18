# Local Copy vs. Remote Repository

Two copies of the **same codebase**. The only difference is what stays on your machine: private files remain local, while application code is pushed to your private backup repository on GitHub.

```
<local-workspace>/web-traffic-generation                  ← Your local working copy (everything)
        │
        │  git push private main  (only tracked files not in .gitignore)
        ▼
github.com/edtool79-collab/web-traffic-generation-private ← Your private GitHub backup (code only)
```

---

## 1. What Gets Committed vs. What Stays Local

| Item | Location | Committed to Git? | Reason |
|---|---|---|---|
| `src/` — 24 modules | Local | ✅ **Yes** | Core application |
| `dashboard/` — routes + UI | Local | ✅ **Yes** | Core application |
| `tests/`, `tools/` | Local | ✅ **Yes** | Verification & CLI utilities |
| `.env.example` | Local | ✅ **Yes** | Empty template showing supported variables |
| `.env.local` | Local | ❌ **No** | **Your private API keys & tokens** |
| `config.json` | Local | ❌ No | Your active target URL, proxies, and personas |
| `data/` | Local | ❌ No | Residential byte ledger, proxy geo metadata, scoreboards |
| `site-profiles/` (custom) | Local | ❌ No | Only the 9 clean built-in starter templates are tracked |
| `session-profiles/`, `storage/` | Local | ❌ No | Persistent browser profiles with live cookies |
| `reports/`, `runs/` | Local | ❌ No | Local run telemetry and generated reports |
| `scratch/` | Local | ❌ No | Temporary scratch scripts |
| `sideOps/` | Local | ❌ No | Excluded via `.gitignore` |
| `tools/google-workspace-account/` | Local | ❌ No | Excluded via `.gitignore` |

**Core Rule:** Source code (`.js`, `.html`, `.css`) and clean templates are tracked. Secrets, personal configuration, proxy lists, and runtime state stay strictly local.

---

## 2. Environment Variables & Keys (`.env.local`)

| Variable | Purpose | Source | Required? |
|---|---|---|---|
| `HIREPULSE_OWNER_PILOT_TOKEN` | Owner-pilot bearer token for your live inbox gateway | `API_KEYS['owner-pilot']` on your `hirepulse-gateway` Worker | No |
| `HIREPULSE_EMAIL_API_KEY` | Commercial API key for the same inbox service | `https://gethirepulse.xyz/credits` | No |
| `HIREPULSE_OWNER_PILOT_FILE` | Path to a local JSON file containing the owner-pilot token | Local file | No |
| `OLLAMA_API_KEY` | Ollama Cloud API key for AI Fleet Commander & worker steps | Ollama Cloud | No |
| `ULLM_API_KEY` | UncensoredLLM API key for direct or failover AI routing | UncensoredLLM | No |
| `WTG_API_TOKEN` | Reserved bearer token for future HTTP/MCP endpoints | Operator-generated (`openssl rand -hex 32`) | Optional |

### How Live Inboxes Work

Live inboxes are not created locally. `src/emailInboxClient.js` calls `https://gethirepulse.xyz/v1/email/inboxes` with `Authorization: Bearer <token>`. Without a configured token, the inbox client reports:

```json
{ "configured": false, "mode": "unconfigured" }
```

### How to Enable Live Inboxes

1. Copy the template:
   ```powershell
   Copy-Item .env.example .env.local
   ```
2. Open `.env.local` and fill in **one** of `HIREPULSE_OWNER_PILOT_TOKEN` or `HIREPULSE_EMAIL_API_KEY`.
3. Restart the dashboard (`dashboard/server.js` automatically loads `.env.local` on startup).
4. Verify status (zero spend):
   ```powershell
   node -e "console.log(require('./src/emailInboxClient').getEmailClientStatus())"
   ```
   It should report `configured: true`.

⚠️ Creating a live inbox consumes service quota/credits. Do not trigger live inbox creation in automated tests without operator approval.

---

## 3. Verifying the Boundary Before Pushing

```powershell
# 1. Verify no sensitive files are tracked
git ls-files | Select-String "\.env|config\.json|proxies|secret|license\.key"

# 2. Verify no credentials exist in staged/tracked files
git grep -n -I -E "(socks5|http)://[^ \x22@]*:[^ \x22@]*@" --cached

# 3. Verify all 24 core modules are tracked
(git ls-files src | Measure-Object -Line).Lines
```

* Check #1 must only return `.env.example` and `config.example.json`.
* Check #2 must only return documented placeholders/test fixtures (`user:pass`, `user1:pass`, `${...}`).
* Check #3 must return **24**.

---

## 4. Hygiene Rules

- `.env.local` and `config.json` are never committed, even temporarily.
- If a real credential ever enters a commit, rotate/revoke it immediately.
- `config.example.json` is the tracked public template; `config.json` is your local working configuration.
- Any new file holding credentials or runtime state must be added to `.gitignore` **before** it is created.
