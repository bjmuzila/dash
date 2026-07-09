-- Run second, after reviewing db-size-check.sql output.
-- Deletes rows OLDER than the cutoff from raw tape/snapshot tables that only
-- feed "today"/rolling-window UI. Does NOT touch EOD/backtest tables
-- (eod_gex, es_candles, em_tracker, mvc_snapshots, confidence_log, ict_setups,
-- far_cb_outcomes, regime_fits, trade_signals, regime_alerts, etc).
--
-- Adjust the interval per table if you want to keep more/less history.
-- Run VACUUM (FULL) on any table afterward to actually reclaim disk (VACUUM FULL
-- locks the table — do it off-hours).

-- NOTE: `date` columns in these tables are TEXT (YYYY-MM-DD), not a real DATE
-- type, so every comparison below casts with ::date.

-- Highest cardinality / heaviest first --------------------------------------
DELETE FROM strike_growth              WHERE date::date < CURRENT_DATE - INTERVAL '5 days';
DELETE FROM darkpool_prints            WHERE date::date < CURRENT_DATE - INTERVAL '10 days';  -- 7D toggle needs >=10 calendar days
DELETE FROM greek_snapshots            WHERE date::date < CURRENT_DATE - INTERVAL '10 days';

-- option_strike_gex_history: the only live consumer is the 5/15/30m-ago
-- heatmap popup, which only ever reads TODAY's front/0DTE expiry during RTH.
-- Drop anything outside RTH and any expiry that isn't the front-month one
-- for its date, on top of the age cutoff.
DELETE FROM option_strike_gex_history t
USING (
  SELECT date, MIN(expiry) AS front_expiry
  FROM option_strike_gex_history
  GROUP BY date
) f
WHERE t.date = f.date
  AND (
    t.date::date < CURRENT_DATE - INTERVAL '10 days'
    OR t.expiry <> f.front_expiry
    OR to_char(to_timestamp(t.timestamp / 1000) AT TIME ZONE 'America/New_York', 'HH24:MI')
       NOT BETWEEN '09:30' AND '16:00'
  );

-- flow_prints: once a contract's expiration date has passed it's dead —
-- no feature re-reads an expired contract's tape, so drop those rows
-- immediately regardless of the age cutoff. Rows with no expiration
-- (underlying-level prints, if any) still fall back to the date cutoff.
DELETE FROM flow_prints
WHERE (expiration IS NOT NULL AND expiration::date < CURRENT_DATE)
   OR (expiration IS NULL AND date::date < CURRENT_DATE - INTERVAL '10 days');

-- JSONB full-chain blobs every 30 min — likely biggest single offender ------
DELETE FROM home_static_snapshots      WHERE created_at < NOW() - INTERVAL '5 days';
DELETE FROM mult_greek_static_snapshots WHERE created_at < NOW() - INTERVAL '5 days';

-- Moderate --------------------------------------------------------------
DELETE FROM ticker_wall_snapshots      WHERE date::date < CURRENT_DATE - INTERVAL '10 days';
DELETE FROM scanner_snapshots          WHERE date::date < CURRENT_DATE - INTERVAL '10 days';
DELETE FROM vol_pin_snapshots          WHERE date::date < CURRENT_DATE - INTERVAL '14 days';
DELETE FROM vol_pin_events             WHERE date::date < CURRENT_DATE - INTERVAL '14 days';
DELETE FROM watch_snapshots            WHERE created_at < NOW() - INTERVAL '60 days';
DELETE FROM preview_snapshots          WHERE created_at < NOW() - INTERVAL '30 days';

-- Analytics tape, no backtest value ---------------------------------------
DELETE FROM page_visits                WHERE created_at < NOW() - INTERVAL '14 days';
DELETE FROM ticker_events              WHERE created_at < NOW() - INTERVAL '14 days';

-- Already self-pruning (oi_change_snapshots, far_cb_watch) — no action needed.

-- Legacy /server (not /server-v2) tables — CONFIRM these are dead before
-- running; if the old server/proxy-tastytrade.js stack is not deployed,
-- these are orphaned and can likely be dropped entirely instead of pruned:
--   chains_cache, mvc, premium_flow, chain_snapshots, greeks_history,
--   multi_stock_flow, greeks_time_series, big_trades, es_15m_candles,
--   gex_top3, bzila_live_snapshots, greeks_intraday, buy_sell_scores, gex_levels
-- SELECT pg_size_pretty(pg_total_relation_size('premium_flow')); -- etc, check first

VACUUM (VERBOSE, ANALYZE) strike_growth, option_strike_gex_history, flow_prints,
  darkpool_prints, greek_snapshots, home_static_snapshots, mult_greek_static_snapshots,
  ticker_wall_snapshots, scanner_snapshots, vol_pin_snapshots, watch_snapshots,
  preview_snapshots, page_visits, ticker_events;
