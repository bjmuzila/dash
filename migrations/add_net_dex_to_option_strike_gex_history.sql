-- Adds the DEX ladder columns to option_strike_gex_history.
--
-- Why this file exists: net_dex / net_vol_dex were only ever created as a side
-- effect of server-v2/gex-history-writer.js's ensureVolColumn(), which is
-- reached AFTER the `if (!windowOpen) return;` guard in writeGexSnapshot(). So
-- the columns only appeared if the process happened to be restarted during an
-- open recording window. On a fresh database, or after any restart outside that
-- window, /api/gex-map probed information_schema, found nothing, and reported
-- "no DEX for this session" — with real DEX sitting in the calculator upstream.
--
-- Safe to run repeatedly.
ALTER TABLE option_strike_gex_history ADD COLUMN IF NOT EXISTS net_dex REAL;
ALTER TABLE option_strike_gex_history ADD COLUMN IF NOT EXISTS net_vol_dex REAL;
