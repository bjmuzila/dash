'use strict';
/**
 * server-v2/backfill-etf-candles.js — one-shot.
 *
 * Pulls SPY / QQQ 1-minute bars from dxFeed and upserts them into etf_candles,
 * for sessions the recorder wasn't running for. The recorder itself only ever
 * reaches back to today's ET midnight on its minute tick, and its boot backfill
 * only runs when the server restarts — so a session that happened before this
 * pipeline shipped (or during any downtime) has to be filled in by hand.
 *
 * dxFeed serves roughly SEVEN days of 1-minute history. Anything older than that
 * is simply not available from this source, and the script will say so rather
 * than write a short series and call it done.
 *
 * Idempotent — goes through the same ON CONFLICT upsert as the live recorder, so
 * re-running only refreshes bars it already has. Safe to run against a live DB
 * while the server is up.
 *
 *   # last 5 days, SPY + QQQ (the default)
 *   node server-v2/backfill-etf-candles.js
 *
 *   # just enough to cover last Friday, from a Sunday
 *   node server-v2/backfill-etf-candles.js --days 3
 *
 *   # one symbol
 *   node server-v2/backfill-etf-candles.js --symbols SPY --days 7
 *
 * On the VPS, run it where .env.local lives so DATABASE_URL and the TastyTrade
 * credentials resolve:
 *   cd /opt/dashboard && node server-v2/backfill-etf-candles.js --days 3
 */

const path = require('path');
const dotenv = require('dotenv');

// Same load as server-with-proxy.js: .env.local is the single source of truth,
// override:true so a stale shell variable can't hijack the DB or the feed
// credentials. Harmless in the container, where the vars are already set.
const ROOT_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT_DIR, '.env.local'), override: true });

const { backfill, getPool, ensureSchema } = require('./etf-candle-recorder');

// ── args ─────────────────────────────────────────────────────────────────────
function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}

const days = Math.max(1, Math.min(7, Number(argOf('days', 5))));
const symbols = String(argOf('symbols', 'SPY,QQQ'))
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

const ET_DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('no DATABASE_URL — run this where .env.local is readable (e.g. /opt/dashboard on the VPS)');
    process.exit(1);
  }
  const pool = getPool();
  if (!pool || !(await ensureSchema())) {
    console.error('could not reach Postgres / create etf_candles');
    process.exit(1);
  }

  const from = ET_DATE_FMT.format(new Date(Date.now() - days * 86_400_000));
  console.log(`backfilling ${symbols.join(', ')} 1m bars — last ${days} day(s), back to ~${from} ET`);

  const results = await backfill(days, symbols);

  // Report what's actually IN the table per session, not just what the fetch
  // returned — a dxFeed replay that gets cut short still "succeeds".
  //
  // Completeness is judged on RTH bars ONLY. dxFeed's SPY/QQQ 1m aggregation
  // covers the full extended day (and, on these two, the overnight ATS session
  // as well), so the raw per-day count runs well past 390 and tells you nothing
  // about whether the part you care about is intact. 09:30–15:59 ET is exactly
  // 390 one-minute bars; a minute with no prints produces no bar, so a
  // low-liquidity name can legitimately land just under.
  const RTH_EXPR = `(EXTRACT(HOUR FROM to_timestamp(timestamp/1000) AT TIME ZONE 'America/New_York') * 60
                   + EXTRACT(MINUTE FROM to_timestamp(timestamp/1000) AT TIME ZONE 'America/New_York'))`;
  console.log('\netf_candles by session — RTH 09:30–15:59 ET is 390 bars:');
  for (const symbol of symbols) {
    const { rows } = await pool.query( // eslint-disable-line no-await-in-loop
      `SELECT date,
              COUNT(*)::int AS bars,
              COUNT(*) FILTER (WHERE ${RTH_EXPR} BETWEEN 570 AND 959)::int AS rth_bars,
              MIN(timestamp) FILTER (WHERE ${RTH_EXPR} BETWEEN 570 AND 959) AS rth_first,
              MAX(timestamp) FILTER (WHERE ${RTH_EXPR} BETWEEN 570 AND 959) AS rth_last,
              MIN(timestamp) AS first_ts, MAX(timestamp) AS last_ts
         FROM etf_candles
        WHERE symbol = $1 AND timestamp >= $2
        GROUP BY date
        ORDER BY date ASC`,
      [symbol, Date.now() - days * 86_400_000],
    );
    if (!rows.length) { console.log(`  ${symbol}: nothing in range`); continue; }
    for (const r of rows) {
      const hm = (ts) => (ts == null ? '--:--' : new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
      }).format(new Date(Number(ts))));
      const rth = Number(r.rth_bars);
      const flag = rth >= 390 ? 'RTH COMPLETE'
        : rth >= 385 ? `RTH ${rth}/390 (thin minutes)`
        : rth === 0 ? 'NO RTH DATA'
        : `RTH ${rth}/390 PARTIAL`;
      console.log(
        `  ${symbol} ${r.date}  rth ${String(rth).padStart(3)}/390 ${hm(r.rth_first)}–${hm(r.rth_last)}` +
        `  ·  all ${String(r.bars).padStart(4)} bars ${hm(r.first_ts)}–${hm(r.last_ts)} ET  ${flag}`,
      );
    }
  }
  console.log('\nA partial FIRST day is expected — the window starts mid-session that many days back.');

  const failed = results.filter((r) => r.error);
  if (failed.length) {
    console.error(`\n${failed.length} symbol(s) failed: ${failed.map((f) => `${f.symbol} (${f.error})`).join(', ')}`);
  }

  await pool.end();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('backfill-etf-candles failed:', e);
  process.exit(1);
});
