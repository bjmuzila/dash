# Step 4 — Secret Exposure Audit (READ-ONLY)

**Date:** 2026-06-18 · **Branch:** `server-v2-wirein` · **Scope:** audit only — no rotation, no history rewrite, no file edits.

> Headline: the handoff said secrets are "in git history." That's true, but understated.
> Live secrets are **also hardcoded as fallbacks in tracked current files**. Scrubbing
> history alone will NOT close the exposure — current files must also be cleaned.

---

## 1. Active stack (`server-v2/`) — CLEAN ✓

Every secret reads from environment variables with no hardcoded fallback:
- `server-v2/proxy-tastytrade.js` — `TT_CLIENT_SECRET`, `TT_REFRESH_TOKEN`, `TT_CLIENT_ID` (throws if missing).
- `lib/proxy/config.ts` — all values from `process.env`, confirmed stripped.
- `.gitignore` correctly excludes `.env`, `.env*.local`, `*.env`, `*.env.*` (allows `.env.example`).
- No `.pem`, `*token*.json`, or `*credentials*.json` present in the working tree except the archived key below.

## 2. Live secrets hardcoded in tracked CURRENT files (HIGH)

| # | Secret | Location | Notes |
|---|--------|----------|-------|
| 1 | Discord webhook — id `1466…854` (token `<REDACTED>`) | `server/proxy-tastytrade.js:50` | `\|\|` fallback after `process.env.DISCORD_WEBHOOK_URL`; OLD stack — ROTATED |
| 2 | Schwab client secret `<REDACTED>` | `server/proxy-tastytrade.js:48` | hardcoded fallback; OLD stack — app deleted |
| 3 | RSA private key (`-----BEGIN RSA PRIVATE KEY-----`) | `_ARCHIVED_DO_NOT_EDIT/Vanilla/bzila.pem` | full private key committed in tree |
| 3b | TLS keystore / cert | `_ARCHIVED_DO_NOT_EDIT/Vanilla/cert.pfx` | binary cert (may hold private key) committed in tree |
| 4 | Discord webhook — id `1513…830` (token `<REDACTED>`) | `_ARCHIVED_DO_NOT_EDIT/Vanilla/dashboard-server.js:9` | second distinct webhook — archive deleted |
| 5 | Webhook `1466…` + Schwab secret (duplicates of #1/#2) | `_ARCHIVED_DO_NOT_EDIT/Vanilla/` — `proxy-tastytrade.js`, `proxy-tastytrade (1).js`, `MVC/estimated-moves.html`, `pages/old/estimated-moves (2).js`, `pages/old/estimated-moves1.html`, `pages/old/top10.html`, `pages/old/overview (1).js` | ~8 archived copies |

## 3. Env-based — rotate at provider only (code is clean)

| Secret | Reference (no value in code) |
|--------|------------------------------|
| TT client secret / refresh token | `server-v2/proxy-tastytrade.js:41-42` |
| Discord bot token | `discord-bot.js:29`, `register-commands.js:20` |
| Postgres password | `server/server-with-proxy.js:121-122` via `DATABASE_URL` |
| Massive API key | `server/proxy-tastytrade.js:45` via `MASSIVE_API_KEY` |

## 4. Git history scan — PENDING (sandbox down: `HYPERVISOR_VIRT_DISABLED`)

Run in repo root (PowerShell), all read-only, then hand back output:

```
git rev-parse --abbrev-ref HEAD
git status --short
git ls-files | Select-String -Pattern "bzila.pem|\.env|token.*\.json|credentials"
git grep -n -I -i -E "discord(app)?\.com/api/webhooks|<SCHWAB_SECRET>" $(git rev-list --all) 2>$null | Select-Object -First 60
git log --all --oneline -- "_ARCHIVED_DO_NOT_EDIT/Vanilla/bzila.pem"
git log -p --all -S "<SCHWAB_SECRET>" --oneline | Select-Object -First 40
```

## 5. Recommended next steps (NOT executed)

1. **Rotate at provider** — all of §2 and §3: Schwab secret, both Discord webhooks, TT secret/refresh, Discord bot token, Postgres password, Massive key. Rotate even if you scrub history (public repo = assume leaked).
2. **Clean current files** — remove hardcoded fallbacks in `server/proxy-tastytrade.js:48,50`; delete/scrub `_ARCHIVED_DO_NOT_EDIT/Vanilla/` (incl. `bzila.pem`). History scrub does NOT cover these.
3. **Scrub history** — git-filter-repo or BFG, after §1/§2, only if clean public history is wanted.
4. **Update `.env.local`** with rotated values; re-verify `server-v2` boots.

Do not rotate or rewrite history without Brandon's confirmation.
