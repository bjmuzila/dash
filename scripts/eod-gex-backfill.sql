-- eod-gex-backfill.sql
--
-- Rebuild eod_gex.total_gex for $SPX from the persisted 0DTE ladder in
-- option_strike_gex_history, replacing the /proxy/gex market-state values that
-- do not reconcile with the chain (17x..167x off, sign inverted on 2 of 7 days).
--
-- Matches fetchSpxLadder() in server-v2/eod-gex-recorder.js exactly:
--   * expiry = date            (0DTE ladder only)
--   * last snapshot STRICTLY BEFORE 16:00 ET  <- load-bearing; post-close
--     snapshots drift (2026-07-24 reads -21.3B before 16:00, -8.9B at max())
--
-- Only affects 2026-07-17 onward — that is as far back as per-strike history goes.
--
-- Run STEP 0 and STEP 1 first. Only run STEP 2 if STEP 1 looks right.

-- ── STEP 0 — backup (this UPDATE is not otherwise reversible) ────────────────
CREATE TABLE IF NOT EXISTS eod_gex_backup_pre_ladder AS SELECT * FROM eod_gex;

ALTER TABLE eod_gex ADD COLUMN IF NOT EXISTS pin_strike  DOUBLE PRECISION;
ALTER TABLE eod_gex ADD COLUMN IF NOT EXISTS pin_net_gex DOUBLE PRECISION;
ALTER TABLE eod_gex ADD COLUMN IF NOT EXISTS pin_share   DOUBLE PRECISION;


-- ── STEP 1 — preview. Nothing is written. ────────────────────────────────────
WITH snap AS (
  SELECT date, max(timestamp) AS t
  FROM option_strike_gex_history
  WHERE symbol = '$SPX' AND expiry = date
    AND to_timestamp(timestamp / 1000) AT TIME ZONE 'America/New_York'
        < (date::date + time '16:00')
  GROUP BY date
),
lad AS (
  SELECT h.date,
         SUM(h.net_gex)      AS ladder,
         SUM(abs(h.net_gex)) AS abs_sum,
         (array_agg(h.strike  ORDER BY abs(h.net_gex) DESC))[1] AS pin_strike,
         (array_agg(h.net_gex ORDER BY abs(h.net_gex) DESC))[1] AS pin_net_gex
  FROM option_strike_gex_history h
  JOIN snap s ON s.date = h.date AND s.t = h.timestamp
  WHERE h.symbol = '$SPX' AND h.expiry = h.date
  GROUP BY h.date
)
SELECT l.date,
       ROUND(e.total_gex::numeric, 0) AS current_value,
       ROUND(l.ladder::numeric, 0)    AS new_value,
       l.pin_strike,
       ROUND((abs(l.pin_net_gex) / NULLIF(l.abs_sum, 0) * 100)::numeric, 1) AS pin_share_pct,
       e.source AS current_source
FROM lad l
JOIN eod_gex e ON e.date = l.date AND e.symbol = '$SPX'
ORDER BY l.date DESC;


-- ── STEP 2 — the write. ──────────────────────────────────────────────────────
BEGIN;

WITH snap AS (
  SELECT date, max(timestamp) AS t
  FROM option_strike_gex_history
  WHERE symbol = '$SPX' AND expiry = date
    AND to_timestamp(timestamp / 1000) AT TIME ZONE 'America/New_York'
        < (date::date + time '16:00')
  GROUP BY date
),
lad AS (
  SELECT h.date,
         SUM(h.net_gex)      AS ladder,
         SUM(abs(h.net_gex)) AS abs_sum,
         (array_agg(h.strike  ORDER BY abs(h.net_gex) DESC))[1] AS pin_strike,
         (array_agg(h.net_gex ORDER BY abs(h.net_gex) DESC))[1] AS pin_net_gex
  FROM option_strike_gex_history h
  JOIN snap s ON s.date = h.date AND s.t = h.timestamp
  WHERE h.symbol = '$SPX' AND h.expiry = h.date
  GROUP BY h.date
)
UPDATE eod_gex e
SET total_gex   = l.ladder,
    pin_strike  = l.pin_strike,
    pin_net_gex = l.pin_net_gex,
    pin_share   = CASE WHEN l.abs_sum > 0
                       THEN abs(l.pin_net_gex) / l.abs_sum * 100 END,
    source      = 'ladder'
FROM lad l
WHERE e.symbol = '$SPX' AND e.date = l.date;

-- Expect: UPDATE 7
COMMIT;


-- ── Rollback, if needed ──────────────────────────────────────────────────────
-- UPDATE eod_gex e
-- SET total_gex = b.total_gex, source = b.source
-- FROM eod_gex_backup_pre_ladder b
-- WHERE e.date = b.date AND e.symbol = b.symbol AND e.symbol = '$SPX';
