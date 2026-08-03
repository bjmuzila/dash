-- gex-vol-flow-today.sql
-- Today's NET VOLUME GEX flow, straight off option_strike_gex_history.
--   run on the VPS:  cd /opt/dashboard && set -a && . ./.env.local && set +a
--                    psql "$DATABASE_URL" -f gex-vol-flow-today.sql
--
-- Notes:
--  * option_strike_gex_history keeps only ~2 days (retention delete in
--    lib/db.ts insertOptionStrikeGexRows), so "today" is always warm.
--  * net_vol_gex = volume-side GEX, net_gex = OI-side. The dashboard's
--    headline numbers use netGEX + netVolGEX, so `combined_bn` is the
--    number that matches the UI.
--  * Day boundary is derived from the epoch-ms `timestamp` in ET, not the
--    `date` TEXT column, so it can't drift on format.

-- Symbol scope. option_strike_gex_history is shared -- etf-gex-recorder writes
-- SPY/QQQ 0DTE into it under the same expiry string SPX uses -- so every query
-- below must pin `symbol` or it sums three underlyings together.
--   override:  psql "$DATABASE_URL" -v sym=SPY -f gex-vol-flow-today.sql
\if :{?sym}
\else
  \set sym '$SPX'
\endif

\pset border 2
\pset null '-'

\echo '=== 1. 5-min flow of net vol GEX (per expiry) ==============================='

WITH src AS (
  SELECT (timestamp / 300000) * 300000 AS bucket_ms,
         timestamp, expiry, strike, spot, net_gex, net_vol_gex
    FROM option_strike_gex_history
   WHERE symbol = :'sym'
     AND to_timestamp(timestamp / 1000.0) AT TIME ZONE 'America/New_York'
         >= date_trunc('day', now() AT TIME ZONE 'America/New_York')
     AND net_vol_gex IS NOT NULL
     -- 0DTE only? uncomment:
     -- AND expiry = to_char(now() AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')
),
latest AS (                      -- last reading per (bucket, expiry, strike)
  SELECT DISTINCT ON (bucket_ms, expiry, strike)
         bucket_ms, expiry, strike, spot, net_gex, net_vol_gex
    FROM src
   ORDER BY bucket_ms, expiry, strike, timestamp DESC
),
agg AS (
  SELECT bucket_ms, expiry,
         max(spot)          AS spot,
         sum(net_vol_gex)   AS vol_gex,
         sum(net_gex)       AS oi_gex,
         count(*)           AS strikes
    FROM latest
   GROUP BY bucket_ms, expiry
)
SELECT to_char(to_timestamp(bucket_ms / 1000.0) AT TIME ZONE 'America/New_York',
               'HH24:MI')                                   AS et,
       expiry,
       round(spot::numeric, 2)                              AS spot,
       round((vol_gex / 1e9)::numeric, 3)                   AS vol_gex_bn,
       round(((vol_gex - lag(vol_gex) OVER w) / 1e9)::numeric, 3)
                                                            AS d_vol_bn,
       round((oi_gex / 1e9)::numeric, 3)                    AS oi_gex_bn,
       round(((oi_gex + vol_gex) / 1e9)::numeric, 3)        AS combined_bn,
       strikes
  FROM agg
WINDOW w AS (PARTITION BY expiry ORDER BY bucket_ms)
 ORDER BY bucket_ms, expiry;

\echo ''
\echo '=== 2. Latest snapshot — headline ==========================================='

WITH last_ts AS (
  SELECT max(timestamp) AS ts
    FROM option_strike_gex_history
   WHERE symbol = :'sym'
     AND to_timestamp(timestamp / 1000.0) AT TIME ZONE 'America/New_York'
         >= date_trunc('day', now() AT TIME ZONE 'America/New_York')
)
SELECT to_char(to_timestamp(h.timestamp / 1000.0) AT TIME ZONE 'America/New_York',
               'HH24:MI:SS')                                AS as_of_et,
       h.expiry,
       round(max(h.spot)::numeric, 2)                       AS spot,
       round((sum(h.net_vol_gex) / 1e9)::numeric, 3)        AS vol_gex_bn,
       round((sum(h.net_gex)     / 1e9)::numeric, 3)        AS oi_gex_bn,
       round(((sum(h.net_gex) + sum(h.net_vol_gex)) / 1e9)::numeric, 3)
                                                            AS combined_bn
  FROM option_strike_gex_history h, last_ts
 WHERE h.timestamp = last_ts.ts
   AND h.symbol = :'sym'
 GROUP BY h.timestamp, h.expiry
 ORDER BY h.expiry;

\echo ''
\echo '=== 3. Where the vol GEX sits — top 15 strikes at the latest print =========='

WITH last_ts AS (
  SELECT max(timestamp) AS ts
    FROM option_strike_gex_history
   WHERE symbol = :'sym'
     AND to_timestamp(timestamp / 1000.0) AT TIME ZONE 'America/New_York'
         >= date_trunc('day', now() AT TIME ZONE 'America/New_York')
)
SELECT h.expiry,
       h.strike,
       round(h.spot::numeric, 2)                            AS spot,
       round((h.net_vol_gex / 1e9)::numeric, 4)             AS vol_gex_bn,
       round((h.net_gex     / 1e9)::numeric, 4)             AS oi_gex_bn
  FROM option_strike_gex_history h, last_ts
 WHERE h.timestamp = last_ts.ts
   AND h.symbol = :'sym'
   AND h.net_vol_gex IS NOT NULL
 ORDER BY abs(h.net_vol_gex) DESC
 LIMIT 15;

\echo ''
\echo '=== 4. Session shape: open / high / low / now, net vol GEX (all expiries) ==='

WITH src AS (
  SELECT timestamp, net_vol_gex
    FROM option_strike_gex_history
   WHERE symbol = :'sym'
     AND to_timestamp(timestamp / 1000.0) AT TIME ZONE 'America/New_York'
         >= date_trunc('day', now() AT TIME ZONE 'America/New_York')
     AND net_vol_gex IS NOT NULL
),
per_ts AS (
  SELECT timestamp, sum(net_vol_gex) AS vol_gex
    FROM src GROUP BY timestamp
)
SELECT round((min(vol_gex)  / 1e9)::numeric, 3)             AS low_bn,
       round((max(vol_gex)  / 1e9)::numeric, 3)             AS high_bn,
       round(((SELECT vol_gex FROM per_ts ORDER BY timestamp ASC  LIMIT 1) / 1e9)::numeric, 3) AS open_bn,
       round(((SELECT vol_gex FROM per_ts ORDER BY timestamp DESC LIMIT 1) / 1e9)::numeric, 3) AS now_bn,
       count(*)                                             AS snapshots
  FROM per_ts;
