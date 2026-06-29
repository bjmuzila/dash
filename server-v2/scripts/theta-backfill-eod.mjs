/**
 * server-v2/scripts/theta-backfill-eod.mjs   (Phase 5 — historical EOD GEX)
 *
 * Backfills the `eod_gex` table (date,$SPX,total_gex,spot) from ThetaData history
 * so confidence/MVC analogs can read real past sessions. A backfilled day is
 * indistinguishable from a live eod-gex-recorder day — same computeGexRows path.
 *
 * Per trading day:
 *   1. index/history/eod SPX  -> spot (true cash index close)
 *   2. option/history/eod SPXW (expiration=*, strike_range) -> per-contract close/volume
 *   3. option/history/open_interest SPXW -> per-contract OI
 *   4. BS-derive gamma/delta from EOD close-implied IV (FREE tier; mirrors the
 *      live BS fallback — swap to Theta greeks_eod later for a greeks-true pass)
 *   5. computeGexRows -> totalNetGex -> upsert eod_gex
 *
 * Idempotent (skips dates already present), resumable (re-run continues),
 * sequential dates (each date is one bulk call; keeps the concurrency budget calm).
 *
 * Prereqs: Theta Terminal on 25503 (PRO trial for history), DATABASE_URL set.
 * Run:  node --env-file=../.env.local scripts/theta-backfill-eod.mjs [years=2] [strikeRange=40] [--greeks]
 *
 *   --greeks : use Theta's HISTORICAL gamma (history/greeks/eod) instead of
 *              BS-deriving it from the EOD close. PRO-gated; per-strike BS
 *              fallback still covers any strike Theta lacks. Verify the endpoint
 *              path resolves first (it 404s if the build names it differently):
 *                curl "http://127.0.0.1:25503/v3/option/history/greeks/eod?symbol=SPXW&expiration=*&start_date=20250627&end_date=20250627&strike_range=5&format=json"
 *              The adapter tries history/greeks/eod then history/greeks_eod.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const theta = require('../proxy-thetadata.js');
const { computeGexRows, totalNetGex } = require('../computation/gex-calculator.js');
const { bsGreeks, impliedVol, yearsToExpiry } = require('../computation/utils.js');

const args = process.argv.slice(2).filter((a) => a !== '--greeks');
const USE_THETA_GREEKS = process.argv.includes('--greeks'); // gamma from Theta history vs BS
const YEARS = Number(args[0] || 2);
const STRIKE_RANGE = Number(args[1] || 40);
const RISK_FREE = Number(process.env.RISK_FREE_RATE || 0.045);
const SYMBOL = 'SPX';

const MARKET_HOLIDAYS = new Set([
  '2024-01-01','2024-01-15','2024-02-19','2024-03-29','2024-05-27','2024-06-19','2024-07-04','2024-09-02','2024-11-28','2024-12-25',
  '2025-01-01','2025-01-20','2025-02-17','2025-04-18','2025-05-26','2025-06-19','2025-07-04','2025-09-01','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
]);

function tradingDays(years) {
  const out = [];
  const end = new Date();
  const start = new Date(); start.setFullYear(start.getFullYear() - years);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    if (MARKET_HOLIDAYS.has(iso)) continue;
    out.push(iso);
  }
  return out;
}

// --- DB ---------------------------------------------------------------------
const { Pool } = require('pg');
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
  max: 2, keepAlive: true,
});

async function alreadyDone() {
  const r = await pool.query(`SELECT date FROM eod_gex WHERE symbol = '$SPX'`);
  return new Set(r.rows.map((x) => (x.date instanceof Date ? x.date.toISOString().slice(0, 10) : String(x.date).slice(0, 10))));
}

async function upsert(date, total_gex, spot) {
  await pool.query(
    `INSERT INTO eod_gex (date, symbol, total_gex, spot, computed_at)
     VALUES ($1,'$SPX',$2,$3,$4)
     ON CONFLICT (date, symbol) DO UPDATE SET
       total_gex=EXCLUDED.total_gex, spot=EXCLUDED.spot, computed_at=EXCLUDED.computed_at`,
    [date, total_gex, spot, new Date().toISOString()],
  );
}

// --- per-day build ----------------------------------------------------------
async function buildDay(date) {
  const spot = await theta.fetchIndexEodTheta(SYMBOL, date);
  if (!spot) return { skip: 'no index close' };

  const [eod, oiMap, greekMap] = await Promise.all([
    theta.fetchEodHistoryTheta(SYMBOL, date, { strikeRange: STRIKE_RANGE }),
    theta.fetchOiHistoryTheta(SYMBOL, date, { strikeRange: STRIKE_RANGE }),
    USE_THETA_GREEKS
      ? theta.fetchGreeksEodHistoryTheta(SYMBOL, date, { strikeRange: STRIKE_RANGE }).catch(() => new Map())
      : Promise.resolve(new Map()),
  ]);
  if (!eod.length) return { skip: 'no eod rows' };

  const rows = [];
  for (const c of eod) {
    const oi = oiMap.get(`${c.expiration}|${c.strike}|${c.type}`) || 0;
    const mid = (c.bid > 0 && c.ask > 0) ? (c.bid + c.ask) / 2 : c.close;
    if (!(mid > 0) && !(oi > 0)) continue;
    let g = { gamma: 0, delta: 0 };
    if (USE_THETA_GREEKS) {
      const tg = greekMap.get(`${c.expiration}|${c.strike}|${c.type}`);
      if (tg && Number.isFinite(tg.gamma)) g = tg;
    }
    // BS fallback: when not using Theta greeks, or Theta had none for this strike.
    if (!(g.gamma > 0)) {
      const T = yearsToExpiry(c.expiration);
      let iv = 0;
      if (mid > 0 && T > 0) {
        iv = impliedVol({ price: mid, S: spot, K: c.strike, T, r: RISK_FREE, type: c.type });
      }
      if (iv > 0) g = bsGreeks({ S: spot, K: c.strike, T, sigma: iv, r: RISK_FREE, type: c.type });
    }
    rows.push({
      strike: c.strike,
      side: c.type === 'C' ? 'call' : 'put',
      oi,
      volume: c.volume,
      gamma: g.gamma,
      delta: g.delta,
    });
  }

  const gexRows = computeGexRows(rows, spot);
  const populated = gexRows.filter((r) => (r.callGamma > 0 || r.putGamma > 0) && (r.callOI > 0 || r.putOI > 0)).length;
  if (populated < 20) return { skip: `only ${populated} populated strikes` };
  return { total: totalNetGex(gexRows), spot, populated };
}

// --- main -------------------------------------------------------------------
(async () => {
  const days = tradingDays(YEARS);
  const done = await alreadyDone();
  const todo = days.filter((d) => !done.has(d));
  console.log(`[backfill] ${YEARS}y = ${days.length} trading days; ${done.size} already done; ${todo.length} to do; strike_range=${STRIKE_RANGE}`);

  let ok = 0, skipped = 0, failed = 0;
  for (let i = 0; i < todo.length; i++) {
    const date = todo[i];
    try {
      const r = await buildDay(date);
      if (r.skip) { skipped++; console.log(`[backfill] ${date} SKIP (${r.skip})`); continue; }
      await upsert(date, r.total, r.spot);
      ok++;
      console.log(`[backfill] ${date}  GEX ${r.total >= 0 ? '+' : ''}${(r.total / 1e9).toFixed(3)}B  spot=${r.spot.toFixed(2)}  (${r.populated} strikes)  [${i + 1}/${todo.length}]`);
    } catch (e) {
      failed++;
      console.warn(`[backfill] ${date} FAIL ${String(e.message || e).slice(0, 160)}`);
    }
  }
  console.log(`[backfill] done — ok=${ok} skipped=${skipped} failed=${failed}`);
  await pool.end();
})();
