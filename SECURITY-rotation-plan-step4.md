# Step 4 — Secret Rotation & Cleanup Plan

**Date:** 2026-06-18 · Companion to `SECURITY-AUDIT-step4.md`.
**You execute this.** Nothing here has been run. Order matters: rotate → clean files → scrub history → verify.
Repo is public, so treat every secret in §2/§3 of the audit as already compromised — rotate all of them.

---

## A. Rotate at each provider (do FIRST)

| Secret | Where to rotate | Then put new value in |
|--------|-----------------|------------------------|
| Schwab client secret | developer.schwab.com → your app → regenerate secret | `.env.local` `SCHWAB_CLIENT_SECRET` |
| Discord webhook #1 (`1466…`) | Discord → Server Settings → Integrations → Webhooks → delete + recreate | `.env.local` `DISCORD_WEBHOOK_URL` |
| Discord webhook #2 (`1513…`) | same; delete (archived/unused — confirm before recreating) | n/a if unused |
| Discord bot token | Discord Developer Portal → your app → Bot → Reset Token | `.env.local` `DISCORD_BOT_TOKEN` |
| TT client secret + refresh token | Tastytrade OAuth app → regenerate; re-run your refresh-token flow | `.env.local` `TT_CLIENT_SECRET`, `TT_REFRESH_TOKEN` |
| Postgres password | DB host → reset role password | `.env.local` `DATABASE_URL` |
| Massive API key | Massive dashboard → rotate key | `.env.local` `MASSIVE_API_KEY` |
| RSA private key (`bzila.pem`) | regenerate keypair wherever it's used (SSH/host); revoke old public key | store outside repo |

Tick each off before moving on. A rotated secret left in code/history is still a leak until §B/§C.

## B. Clean CURRENT files (history scrub does NOT cover these)

1. `server/proxy-tastytrade.js:48` — remove the hardcoded Schwab fallback:
   ```js
   // BEFORE
   const SCHWAB_CLIENT_SECRET = process.env.SCHWAB_CLIENT_SECRET || 'BaBk...Pg1';
   // AFTER
   const SCHWAB_CLIENT_SECRET = process.env.SCHWAB_CLIENT_SECRET || '';
   ```
2. `server/proxy-tastytrade.js:50` — remove the hardcoded webhook fallback:
   ```js
   const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
   ```
3. `_ARCHIVED_DO_NOT_EDIT/Vanilla/` — delete the folder, or at minimum remove:
   `bzila.pem`, `dashboard-server.js`, `proxy-tastytrade.js`, `proxy-tastytrade (1).js`,
   `MVC/estimated-moves.html`, `pages/old/estimated-moves (2).js`,
   `pages/old/estimated-moves1.html`, `pages/old/top10.html`, `pages/old/overview (1).js`.
   (These hold duplicate webhooks/secret + the private key.)
4. Commit on `server-v2-wirein` (or a `security-cleanup` branch) — do NOT push until §A done.

## C. Scrub git history (optional — only if you want clean PUBLIC history)

Even after §A/§B, the old values remain in past commits on the public repo. To remove:

```
pip install git-filter-repo            # or use BFG
# back up first:
git clone --mirror . ../repo-backup.git

# remove the private key file from all history:
git filter-repo --path "_ARCHIVED_DO_NOT_EDIT/Vanilla/bzila.pem" --invert-paths

# redact the literal secret strings from all blobs:
#   create secrets.txt with one literal==>REDACTED per line, then:
git filter-repo --replace-text secrets.txt
```
`secrets.txt` (create at scrub time, do NOT commit — gitignored by `*.txt`? no, name it
`secrets-scrub.txt` and delete after). One `LITERAL==>REDACTED` per line. The literals are
the now-rotated Schwab secret, both Discord webhook tokens, and the bzila private key — pull
them from your password manager / the pre-cleanup git history, not from this repo.
Then force-push (`git push --force --all` / `--tags`). **Rewrites history** — coordinate, and note any forks/clones still hold the old commits, which is the real reason §A is non-negotiable.

## D. Verify

```
git grep -n -i -E "discord(app)?\.com/api/webhooks/[0-9]"   # expect: no live values
$env:SYMBOL="SPX"; npm run dev                                     # server-v2 boots with new .env.local
```
Confirm GEX/flow snapshots return data, then proceed to Step 5 (your merge to `main`).

---
**Reminder:** I have not rotated anything, edited any file, or pushed. This is a plan only.
