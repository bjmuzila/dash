-- Export the durable Core Bullseye history + the ES price path.
-- Run on the VPS:  psql "$DATABASE_URL" -f export-walls-core.sql
-- then copy the three CSVs off /tmp/.
--
-- These tables are NOT in scripts/db-prune.sql — walls_log is immutable once
-- written and es_candles is in the explicit do-not-prune list, so this is the
-- full history, not a 10-day window.
--
-- Variant note: since 2026-08-27 every slot is recorded four times over
-- (expiry_scope 0dte|agg x basis oivol|vol). Rows written before that are
-- labelled '0dte'/'oivol', so that pair is the only one continuous across the
-- whole history. Change it here if you want to test another variant.

\set scope '0dte'
\set gexbasis 'oivol'

-- 1. The CB level itself, per 15-min slot. Change-only: slot 0 pins the
--    baseline each day and later rows appear only when the level moved, so the
--    reader must carry the last value forward within a date.
\copy (SELECT date, ts, slot, strike AS core, spot, gex_value, reason FROM walls_log WHERE symbol = '$SPX' AND level_type = 'cb' AND expiry_scope = :'scope' AND basis = :'gexbasis' ORDER BY date, slot) TO '/tmp/walls_core.csv' WITH (FORMAT csv, HEADER true);

-- 2. Every already-classified 5-point CORE touch, with its outcome. This is the
--    system's own answer to the question, independent of any backtest.
\copy (SELECT date, hit_ts, hit_slot, strike AS core, spot_at_hit, kind, reaction, excursion_pts, reclaim_min, note FROM wall_events WHERE symbol = '$SPX' AND level_type = 'cb' AND expiry_scope = :'scope' AND basis = :'gexbasis' ORDER BY date, hit_slot) TO '/tmp/wall_events_core.csv' WITH (FORMAT csv, HEADER true);

-- 3. ES 1-minute bars — the fill path. Real ES, so MES P&L is exact rather
--    than approximated from SPX points.
\copy (SELECT timestamp, date, open, high, low, close FROM es_candles WHERE "intervalMinutes" = 1 ORDER BY timestamp) TO '/tmp/es_1m.csv' WITH (FORMAT csv, HEADER true);

-- Sanity checks worth eyeballing before you copy anything back:
--   SELECT MIN(date), MAX(date), COUNT(DISTINCT date) FROM walls_log
--     WHERE symbol='$SPX' AND level_type='cb';
--   SELECT reaction, COUNT(*) FROM wall_events
--     WHERE symbol='$SPX' AND level_type='cb' AND kind='touch'
--     GROUP BY reaction ORDER BY 2 DESC;
--   SELECT "intervalMinutes", MIN(date), MAX(date), COUNT(*)
--     FROM es_candles GROUP BY 1;
