# Pre-Launch Hardening — what changed & what you run

This batch closes the P0/P1 findings from the audit. Code changes are in the
repo; the four items in Part C run outside the repo (Cloudflare, VPS, SaaS).

---

## Part A — Code changes already made (review the diff, then deploy)

| File | Change |
|---|---|
| `server-v2/proxy-auth.js` *(new)* | Access gate for `/proxy/*`: reads → subscriber, writes → owner, allowlist → public, cron → `x-internal-token`. |
| `server-v2/server-with-proxy.js` | Calls the gate before any proxy routing; removed `Access-Control-Allow-Origin: *` (now allowlist-only); dropped CSP `unsafe-eval`, added `object-src 'none'` + report-only toggle; wired Sentry + crash guards. |
| `server-v2/observability.js` *(new)* | Dependency-optional Sentry init + `uncaughtException`/`unhandledRejection` guards (were missing). |
| `server-v2/greeks-ts-writer.js`, `eod-gex-recorder.js` | Their internal `/proxy/gex` reads now send `x-internal-token` so the gate doesn't block them. |
| `instrumentation.ts` *(new)* | Next.js Sentry hook (inert until SDK + DSN present). |
| `tests/calculations.golden.test.ts` *(new)* | Golden-fixture tests locking GEX sign/basis conventions. |
| `.github/workflows/ci.yml` *(new)* | CI: typecheck + tests + `npm audit` on push/PR. |
| `components/shared/DataFreshness.tsx` *(new)* | Drop-in LIVE/STALE feed badge. |

### Required new env vars (add to `/opt/dashboard/.env.local` on the VPS)

```bash
# Enforce the /proxy gate. WITHOUT this set to 1, /proxy/* stays open (the gate
# is a no-op and logs a warning). Turn on only AFTER confirming INTERNAL_API_TOKEN
# is set and the cron jobs still work.
PROXY_AUTH_REQUIRED=1

# Shared secret for in-process cron → /proxy and → /api calls. If you already
# have one (middleware.ts reads it), reuse the SAME value.
INTERNAL_API_TOKEN=<long-random-string>

# Optional: only if a browser on a DIFFERENT origin must read /proxy (normally
# not needed — same-origin). Comma-separated, exact origins.
# PROXY_CORS_ORIGINS=https://cbedge.net,https://www.cbedge.net

# Optional CSP safety valve: ship the stricter CSP in report-only first.
# CSP_REPORT_ONLY=1

# Sentry (after `npm i @sentry/node @sentry/nextjs`)
SENTRY_DSN=<server dsn>
NEXT_PUBLIC_SENTRY_DSN=<client dsn>
SENTRY_ENV=production
```

### Rollout order (so you never lock yourself out)

1. Deploy the code with `PROXY_AUTH_REQUIRED` **unset** → gate is inert, nothing breaks.
2. Confirm `INTERNAL_API_TOKEN` is set and `OWNER_USER_ID` is correct.
3. Hit `/proxy/health` (should 200) and sign in as owner, load `/home` (WS + data work).
4. Set `PROXY_AUTH_REQUIRED=1`, `docker compose up -d --force-recreate`.
5. Verify: signed-out `curl https://cbedge.net/proxy/gex` → 401; owner browser → data loads; cron writers still log success (greeks_ts, eod_gex).
6. **Rollback if anything breaks:** set `PROXY_AUTH_REQUIRED=0`, recreate. (Have this ready *before* step 4 — your auth-cutover rule.)

---

## Part B — Git (sandbox couldn't run git here; run these yourself)

```powershell
cd C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed
git checkout -b hardening-prelaunch
git add -A
git commit -m "Pre-launch hardening: gate /proxy, drop CORS *, tighten CSP, Sentry, golden tests, CI, staleness badge"
git push -u origin hardening-prelaunch
# open a PR → let CI run → merge to main → deploy with push.ps1
```

---

## Part C — Out-of-repo setup

### C1. Cloudflare rate limiting + WAF

In the Cloudflare dashboard for `cbedge.net`:

1. **Security → WAF → Rate limiting rules → Create.**
   - Rule 1 (data): If URI Path starts with `/proxy/` OR `/api/` → more than **60 requests per 1 min** per IP → **Block** for 1 min.
   - Rule 2 (auth/abuse): If URI Path is `/api/waitlist` or `/api/unsubscribe` → more than **10 per 1 min** per IP → **Managed Challenge**.
2. **Security → WAF → Managed rules:** enable the Cloudflare Managed Ruleset (OWASP core). Start in **Log** mode for 48h, then **Block**.
3. **Security → Settings:** turn on Bot Fight Mode; Security Level = High.
4. **Caching → Cache Rules:** Bypass cache for `/proxy/*` and `/ws/*`; Cache Everything + Edge TTL 1y for `/_next/static/*`.
5. Confirm DNS records are **proxied (orange cloud)** so traffic actually transits CF.

### C2. Postgres backups + tested restore (run on the VPS)

```bash
# /opt/dashboard/scripts/pg-backup.sh
#!/usr/bin/env bash
set -euo pipefail
source /opt/dashboard/.env.local        # for DATABASE_URL
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/opt/backups/cbedge_${TS}.dump
mkdir -p /opt/backups
pg_dump "$DATABASE_URL" -Fc -f "$OUT"
# keep 14 days
find /opt/backups -name 'cbedge_*.dump' -mtime +14 -delete
echo "backup ok: $OUT"
```

```bash
chmod +x /opt/dashboard/scripts/pg-backup.sh
# cron: daily 04:10 UTC (after EOD writes settle)
( crontab -l 2>/dev/null; echo "10 4 * * * /opt/dashboard/scripts/pg-backup.sh >> /var/log/pg-backup.log 2>&1" ) | crontab -
```

**Test the restore (do this once now — an untested backup is not a backup):**
```bash
createdb cbedge_restore_test
pg_restore -d cbedge_restore_test --clean --no-owner /opt/backups/cbedge_<latest>.dump
psql cbedge_restore_test -c "SELECT count(*) FROM subscriptions;"   # sanity
dropdb cbedge_restore_test
```
Consider also enabling Hetzner volume snapshots as a second layer (offsite).

### C3. Uptime monitoring

Use Better Stack (Uptimekuma if self-host). Two monitors:
- `https://cbedge.net/proxy/health` — expect 200, JSON `{"ok":true}`, 1-min interval.
- `https://cbedge.net/` — expect 200 + keyword from the landing page (catches white-screen deploys).
Alert to email/SMS. Add a status page if you want subscribers to self-serve.

### C4. Privacy-friendly analytics

Plausible (hosted or self-host) — one script in the root layout `<head>`:
```html
<script defer data-domain="cbedge.net" src="https://plausible.io/js/script.js"></script>
```
Track funnel events with `plausible('Signup')`, `plausible('CheckoutStart')`,
`plausible('CheckoutComplete')` at those points in the UI. No cookie banner needed.

---

## Still open (P1 follow-ups, not launch-blocking)

- **CSP nonce migration** — to drop `unsafe-inline` from `script-src`, Next 15 needs per-request nonces threaded through this custom server's HTML stream. Bigger change; do it after launch with `CSP_REPORT_ONLY=1` validating first.
- **Rate limiting in-app** — CF covers the edge; add a small in-process limiter only if you see abuse that bypasses CF (e.g. direct-to-origin).
- **E2E smoke (Playwright)** — sign-in → dashboard loads → live data → sign-out.
