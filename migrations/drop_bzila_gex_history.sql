-- Drops the /bzila page-only GEX history tables.
-- bzila_snapshots is intentionally KEPT (used by the dashboard SnapshotPanel).
DROP TABLE IF EXISTS bzila_strike_gex_history;
DROP TABLE IF EXISTS bzila_gex_history;
