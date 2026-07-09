-- Run first. Read-only. Shows biggest tables by disk size + row counts.
SELECT
  relname AS table,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid)) AS table_size,
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS index_size,
  n_live_tup AS est_rows
FROM pg_catalog.pg_statio_user_tables
JOIN pg_stat_user_tables USING (relid)
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 40;
