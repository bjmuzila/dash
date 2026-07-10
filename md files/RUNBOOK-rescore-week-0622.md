# Runbook — re-score EM Tracker week 6/22 (fix partial-candle mis-scoring)

## What was wrong
The Saturday evaluator scored each ticker against a **still-forming weekly
candle** (a partial Friday bar) instead of the finalized weekly close. ~53 of 383
rows flipped hit↔miss (e.g. MSFT: scored vs partial 352.83 → "miss"; real close
372.97 is inside the band → should be "hit"). See
`em-tracker-misscored-2026-06-22.md`.

## Code fix (already in the repo, must be deployed)
`server-v2/levels-engine.js` → `fetchWeeklyClose()`:
- Selects the **canonical Monday-anchored** weekly bar, never an intraweek
  forming bar.
- Refuses to score until past the week's **Friday 16:00 ET** close.
- No longer falls back to a partial same-week bar.

## Steps (run in order, AFTER deploy)

### 1. Deploy
Push on Windows (`/push`), then on the VPS:
```
cd /opt/dashboard
git pull
APP_PORT=$(grep '^PORT=' .env.local | cut -d= -f2-) \
NEXT_PUBLIC_OWNER_USER_ID=$(grep '^NEXT_PUBLIC_OWNER_USER_ID=' .env.local | cut -d= -f2-) \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$(grep '^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=' .env.local | cut -d= -f2-) \
NEXT_PUBLIC_APP_NAME=$(grep '^NEXT_PUBLIC_APP_NAME=' .env.local | cut -d= -f2-) \
docker compose up -d --build
```

### 2. Clear the bad results for week 6/22
The evaluator only (re)scores rows where `result IS NULL`. Clear the week first.
Connect to Postgres (psql) and run:
```sql
-- preview first
SELECT count(*) FROM em_tracker WHERE week_start = '2026-06-22';   -- expect 383

-- clear results + stale OHLC so they re-pull finalized candles
UPDATE em_tracker
   SET result = NULL, result_source = NULL, o = NULL, h = NULL, l = NULL, c = NULL, breach = NULL
 WHERE week_start = '2026-06-22';
```

### 3. Re-run the evaluator (uses the fixed candle selection)
```
curl -X POST http://localhost:$APP_PORT/api/em-tracker/evaluate
```
(or run it inside the container against the app port). The default path scores
the just-completed week from finalized weekly candles. Watch logs:
```
docker compose logs -f dashboard | grep -i em-eval
```

### 4. Verify
```sql
SELECT ticker, c, up, down, result FROM em_tracker
 WHERE week_start = '2026-06-22' AND ticker IN ('MSFT','ADI','AMAT','AG');
```
Expect: **MSFT c≈372.97 → hit**, AMAT → hit, ADI → miss, AG → hit. Spot-check a
few more from the flip list. Confirm count of rows with a result is back to 383
(none left NULL).

## Notes
- The `result IS NULL` requery means this is safe to repeat — already-scored rows
  are skipped, so re-running won't double-process.
- If any ticker now ERRORS with "No finalized weekly candle" / "not yet closed",
  that's the guard working — it means the feed still lacks a finalized bar for
  that symbol; retry later or backfill its OHLC manually.
