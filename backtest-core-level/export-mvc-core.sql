-- Export the Core Bullseye history for the MES backtest.
--
-- PRIMARY SOURCE: mvc_snapshots. One row per intraday MVC capture, carrying the
-- CB strike, the SPX price AND the ES price at the same instant — so no basis
-- has to be derived. It is in the explicit do-not-prune list in db-prune.sql,
-- which is why it reaches back months while option_strike_gex_history does not.
--
-- Columns are camelCase and MUST stay double-quoted.
--
--   "strikeOIVol"   CB strike on the OI+volume basis   <- the core level
--   "strikeVolOnly" CB strike on volume alone          <- the other variant
--   "spxPrice"      SPX at that capture
--   "esPrice"       ES at that capture
--
-- Run:  psql "$DATABASE_URL" -f export-mvc-core.sql

\copy (SELECT timestamp, date, time, "strikeOIVol" AS core_oivol, "strikeVolOnly" AS core_vol, "spxPrice" AS spx, "esPrice" AS es, "gexFlip" AS gex_flip, "totalAbsNetGEX" AS abs_gex, "triggerType" AS trigger_type, expiration FROM mvc_snapshots WHERE "spxPrice" > 0 ORDER BY timestamp) TO '/root/cb-export/mvc_snapshots.csv' CSV HEADER

-- CROSS-CHECK: walls_log / wall_events carry the recorder's own 5-point touch
-- classification (reject / pin / consolidated / break_5 / break_lt5). Shorter
-- history — it only starts 2026-08-03 — but it is the independent read on
-- whether the level holds or breaks, with no strategy assumptions in it.
-- Symbol is plain 'SPX' here (walls_log takes it from scanner_snapshots).

\copy (SELECT date, ts, slot, strike AS core, spot, gex_value, reason FROM walls_log WHERE symbol = 'SPX' AND level_type = 'cb' ORDER BY date, slot) TO '/root/cb-export/walls_core.csv' CSV HEADER

\copy (SELECT date, hit_ts, hit_slot, strike AS core, spot_at_hit, kind, reaction, excursion_pts, reclaim_min, note FROM wall_events WHERE symbol = 'SPX' AND level_type = 'cb' ORDER BY date, hit_slot) TO '/root/cb-export/wall_events_core.csv' CSV HEADER

-- ES 1-minute bars for the fill path, bounded to the CB history window so the
-- file does not carry years of dead weight.

\copy (SELECT timestamp, date, open, high, low, close FROM es_candles WHERE "intervalMinutes" = 1 AND date >= '2026-05-26' ORDER BY timestamp) TO '/root/cb-export/es_1m.csv' CSV HEADER

-- Graded daily ledger — one row per session, already classified
-- miss / pivot / chop / hit by confidence-grader.js. Useful as a sanity check
-- that the backtest's touch count agrees with the system's own.

\copy (SELECT * FROM confidence_log ORDER BY date) TO '/root/cb-export/confidence_log.csv' CSV HEADER
