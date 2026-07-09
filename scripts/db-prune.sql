-- Run second, after reviewing db-size-check.sql output.
-- Deletes rows OLDER than the cutoff from raw tape/snapshot tables that only
-- feed "today"/rolling-window UI. Does NOT touch EOD/backtest tables
-- (eod_gex, es_candles, em_tracker, mvc_snapshots, confidence_log, ict_setups,
-- far_cb_outcomes, regime_fits, trade_signals, regime_alerts, etc).
--
-- Adjust the interval per table if you want to keep more/less history.
-- Run VACUUM (FULL) on any table afterward to actually reclaim disk (VACUUM FULL
-- locks the table — do it off-hours).

-- Highest cardinality / heaviest first --------------------------------------
DELETE FROM strike_growth              WHERE date < CURRENT_DATE - INTERVAL '5 days';
DELETE FROM option_strike_gex_history  WHERE date < CURRENT_DATE - INTERVAL '10 days';
DELETE FROM flow_prints                WHERE date < CURRENT_DATE - INTERVAL '10 days';
DELETE FROM darkpool_prints            WHERE date < CURRENT_DATE - INTERVAL '10 days';
DELETE FROM greek_snapshots            WHERE date < CURRENT_DATE - INTERVAL '10 days';

-- JSONB full-chain blobs every 30 min — likely biggest single offender ------
DELETE FROM home_static_snapshots      WHERE created_at < NOW() - INTERVAL '5 days';
DELETE FROM mult_greek_static_snapshots WHERE created_at < NOW() - INTERVAL '5 days';

-- Moderate --------------------------------------------------------------
DELETE FROM ticker_wall_snapshots      WHERE date < CURRENT_DATE - INTERVAL '10 days';
DELETE FROM scanner_snapshots          WHERE date < CURRENT_DATE - INTERVAL '10 days';
DELETE FROM vol_pin_snapshots          WHERE date < CURRENT_DATE - INTERVAL '14 days';
DELETE FROM vol_pin_events             WHERE date < CURRENT_DATE - INTERVAL '14 days';
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
