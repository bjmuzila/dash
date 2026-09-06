-- Export per-strike GEX history from the VPS so build_core_snapshots.py can
-- derive the core level (largest |net_gex| strike) per snapshot.
--
-- Run on the VPS:
--   psql "$DATABASE_URL" -f export-core-level.sql
-- then copy /tmp/gex_strike_history.csv back to the laptop.
--
-- NOTE: scripts/db-prune.sql keeps only 10 days of this table, RTH, front
-- expiry only. That is the entire reason the backtest has no sample. See the
-- retention note at the bottom.

\copy (
  SELECT date, timestamp, spot, strike, net_gex
  FROM option_strike_gex_history
  WHERE symbol = '$SPX'
  ORDER BY timestamp, strike
) TO '/tmp/gex_strike_history.csv' WITH (FORMAT csv, HEADER true);

-- How much history actually survives the prune, per session:
--   SELECT date, COUNT(DISTINCT timestamp) AS snapshots
--   FROM option_strike_gex_history WHERE symbol = '$SPX'
--   GROUP BY date ORDER BY date;

-- ---------------------------------------------------------------------------
-- To accumulate history going forward WITHOUT growing the heavy table:
-- record only the derived core level, one row per snapshot (~390 rows/session,
-- a few hundred KB per year), and never prune it.
--
--   CREATE TABLE IF NOT EXISTS core_level_history (
--     date       TEXT NOT NULL,
--     timestamp  BIGINT NOT NULL,
--     symbol     TEXT NOT NULL DEFAULT '$SPX',
--     spot       DOUBLE PRECISION NOT NULL,
--     core       DOUBLE PRECISION NOT NULL,   -- strike with largest |net_gex|
--     core_gex   DOUBLE PRECISION,
--     PRIMARY KEY (timestamp, symbol)
--   );
--
-- Backfill it from whatever is currently in the heavy table:
--   INSERT INTO core_level_history (date, timestamp, symbol, spot, core, core_gex)
--   SELECT DISTINCT ON (timestamp)
--          date, timestamp, symbol, spot, strike, net_gex
--   FROM option_strike_gex_history
--   WHERE symbol = '$SPX'
--   ORDER BY timestamp, ABS(net_gex) DESC
--   ON CONFLICT DO NOTHING;
--
-- Then have the strike recorder write one row here per poll, and leave
-- core_level_history out of db-prune.sql.
