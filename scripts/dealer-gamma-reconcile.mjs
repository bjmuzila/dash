#!/usr/bin/env node
/**
 * scripts/dealer-gamma-reconcile.mjs
 *
 * READ-ONLY analysis. Answers the question that decides whether a cumulative
 * signed dealer book is worth building on this data:
 *
 *   "How much of the classified tape actually shows up as a change in
 *    exchange-reported open interest?"
 *
 * Why that is the deciding question: flow-gex.js mirrors taker flow into dealer
 * inventory, which is directionally right but size-blind. The tape it mirrors is
 * premium-floored (FLOW_TAPE_FLOOR), ring-buffer capped (FLOW_TAPE_CAP), partly
 * unclassifiable, and cannot distinguish a customer-vs-dealer trade from two
 * market makers crossing. None of that matters much for an intraday snapshot
 * that resets every day. All of it compounds if you accumulate across days.
 *
 * Open interest is the independent check. It is exchange-reported, it is not
 * premium-floored, and it moves only when contracts are actually created or
 * destroyed. So this script compares, per strike per day:
 *
 *   tape-implied position change   (signed flow)
 *   OI-implied position change     (|ΔOI|, signed by the tape's direction)
 *
 * and reports how far apart they are, in contracts and in dollar gamma per 1%.
 *
 * Run this BEFORE wiring anything into the live path. If the two agree closely,
 * the naive mirror is sound and cumulative flow GEX is cheap to build. If the
 * tape systematically overstates (the usual outcome for 0DTE SPX, where the
 * same contracts round-trip many times a session), then a cumulative book built
 * on the raw mirror is noise and you want the OI-anchored estimator.
 *
 * ── Safety ────────────────────────────────────────────────────────────────
 * Every query runs inside a READ ONLY transaction, so this cannot write to your
 * database even if it has a bug.
 *
 * ── Usage (on the VPS, where DATABASE_URL resolves) ───────────────────────
 *   node scripts/dealer-gamma-reconcile.mjs --days 20
 *   node scripts/dealer-gamma-reconcile.mjs --from 2026-07-01 --to 2026-07-29
 *   node scripts/dealer-gamma-reconcile.mjs --days 20 --iv 0.14 --json out.json
 *
 * Flags:
 *   --days N       lookback in oi_daily snapshots (default 20)
 *   --from / --to  explicit YYYY-MM-DD range (overrides --days)
 *   --symbol S     oi_daily symbol (default SPX)
 *   --underlying U flow_prints underlying_norm filter (default SPX; the SPXW
 *                  root is matched too, since both share the SPX chain)
 *   --iv X         flat implied vol for the Black-Scholes gamma estimate
 *                  (default 0.14). Affects only ABSOLUTE dollar figures; every
 *                  ratio reported below is gamma-invariant.
 *   --rate X       risk-free rate (default 0.045, matching RISK_FREE_RATE)
 *   --json PATH    also write the full per-strike result set as JSON
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

// Reuse the real implementation rather than restating the math here — if the
// module and this script ever disagree, the module is the one under test.
const require = createRequire(import.meta.url);
const D = require('../server-v2/computation/dealer-inventory.js');

// ── arg parsing ────────────────────────────────────────────────────────────
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const OPT = {
  days: Number(arg('days', 20)),
  from: arg('from'),
  to: arg('to'),
  symbol: String(arg('symbol', 'SPX')).toUpperCase(),
  underlying: String(arg('underlying', 'SPX')).toUpperCase(),
  iv: Number(arg('iv', 0.14)),
  rate: Number(arg('rate', 0.045)),
  json: arg('json'),
};

// ── DATABASE_URL discovery ─────────────────────────────────────────────────
// Prefer the real env; fall back to .env.local so this works when run straight
// out of the repo without a dotenv preload.
function resolveDbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const f of ['.env.local', '.env']) {
    try {
      const txt = readFileSync(path.resolve(process.cwd(), f), 'utf8');
      const m = txt.match(/^DATABASE_URL=(.*)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* not present, try the next */ }
  }
  return null;
}

const DB_URL = resolveDbUrl();
if (!DB_URL) {
  console.error('DATABASE_URL not set and not found in .env.local / .env — run this on the VPS.');
  process.exit(1);
}

const { default: pg } = await import('pg');
const pool = new pg.Pool({
  connectionString: DB_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DB_URL) ? undefined : { rejectUnauthorized: false },
  max: 2,
});

/** Run one query inside a READ ONLY transaction. */
async function ro(sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN TRANSACTION READ ONLY');
    const r = await c.query(sql, params);
    await c.query('COMMIT');
    return r.rows;
  } finally {
    c.release();
  }
}

// ── Black-Scholes gamma (mirrors server-v2/computation/utils.js) ───────────
const normPdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

function bsGamma(S, K, T, sigma, r = OPT.rate) {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(sigma > 0)) return 0;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  return normPdf(d1) / (S * sigma * sqrtT);
}

/** Trading-day year fraction, matching the client's T = dte/262 convention. */
function yearsToExpiry(dateStr, expiryStr) {
  const d0 = Date.parse(`${dateStr}T00:00:00Z`);
  const d1 = Date.parse(`${expiryStr}T00:00:00Z`);
  if (!Number.isFinite(d0) || !Number.isFinite(d1)) return 0;
  const calDays = Math.max(0, (d1 - d0) / 86400000);
  const tradingDays = calDays * (252 / 365);
  return Math.max(tradingDays, 0.15) / 262; // stub floor keeps 0DTE finite
}

// ── small helpers ──────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function pctl(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[clamp(Math.floor((p / 100) * s.length), 0, s.length - 1)];
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fmt$ = (v) => {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(2)}K`;
  return `${s}$${a.toFixed(0)}`;
};

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  // 1. Resolve the window from what oi_daily actually holds. The OI baseline is
  //    the binding constraint — flow_prints normally reaches further back.
  let dates;
  if (OPT.from && OPT.to) {
    dates = (await ro(
      `SELECT DISTINCT date::text AS d FROM oi_daily
        WHERE symbol = $1 AND date BETWEEN $2::date AND $3::date
        ORDER BY d`,
      [OPT.symbol, OPT.from, OPT.to]
    )).map((r) => r.d);
  } else {
    dates = (await ro(
      `SELECT DISTINCT date::text AS d FROM oi_daily
        WHERE symbol = $1 ORDER BY d DESC LIMIT $2`,
      [OPT.symbol, OPT.days + 1]
    )).map((r) => r.d).reverse();
  }

  if (dates.length < 2) {
    console.error(
      `Need at least 2 oi_daily snapshots for ${OPT.symbol} to form an OI delta; found ${dates.length}.\n` +
      'Check: SELECT count(*), min(date), max(date) FROM oi_daily;'
    );
    process.exit(2);
  }

  console.log(`\n=== Dealer gamma reconciliation — ${OPT.symbol} ===`);
  console.log(`Window: ${dates[0]} → ${dates[dates.length - 1]}  (${dates.length} OI snapshots)`);
  console.log(`BS gamma assumption: flat IV ${OPT.iv}, r ${OPT.rate}\n`);

  // 2. Open interest per date/expiry/strike.
  const oiRows = await ro(
    `SELECT date::text AS date, expiry, strike, call_oi, put_oi, spot
       FROM oi_daily
      WHERE symbol = $1 AND date::text = ANY($2)`,
    [OPT.symbol, dates]
  );

  const oi = new Map();
  const spotByDate = new Map();
  for (const r of oiRows) {
    oi.set(`${r.date}|${r.expiry}|${Number(r.strike)}`, {
      callOi: Number(r.call_oi) || 0,
      putOi: Number(r.put_oi) || 0,
      spot: Number(r.spot) || 0,
    });
    if (Number(r.spot) > 0) spotByDate.set(r.date, Number(r.spot));
  }

  // 3. Signed flow per date/expiry/strike/type. This is the rehydrate query
  //    from server-v2/state/flow-gex-rehydrate.js, generalised past one day and
  //    one expiry, keeping the same neutral-bucket exclusion so unclassifiable
  //    prints cannot leak in as taker buys.
  const flowRows = await ro(
    `SELECT date, expiration, strike, type, side,
            SUM(size) AS vol, COUNT(*) AS prints
       FROM flow_prints
      WHERE date = ANY($1)
        AND (underlying_norm = $2 OR underlying_norm = $2 || 'W')
        AND strike IS NOT NULL AND size IS NOT NULL AND expiration IS NOT NULL
        AND (bucket IS NULL OR bucket <> 'neutral')
        AND side IN ('buy','sell')
      GROUP BY date, expiration, strike, type, side`,
    [dates, OPT.underlying]
  );

  const [cov] = await ro(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN bucket = 'neutral' THEN 1 ELSE 0 END) AS neutral,
            SUM(CASE WHEN side NOT IN ('buy','sell') THEN 1 ELSE 0 END) AS unclassified,
            MIN(premium) AS min_premium
       FROM flow_prints
      WHERE date = ANY($1)
        AND (underlying_norm = $2 OR underlying_norm = $2 || 'W')`,
    [dates, OPT.underlying]
  );

  if (!flowRows.length) {
    console.error(
      `No classified flow_prints rows for underlying ${OPT.underlying} in this window.\n` +
      'Check: SELECT DISTINCT underlying_norm FROM flow_prints LIMIT 20;'
    );
    process.exit(3);
  }

  // Fold into per-strike-per-day dealer inventory, using flow-gex.js's field
  // naming so signedPosition() applies unchanged: callBuyVol is what the DEALER
  // bought, i.e. what takers sold.
  const flow = new Map();
  for (const r of flowRows) {
    const key = `${r.date}|${r.expiration}|${Number(r.strike)}`;
    if (!flow.has(key)) {
      flow.set(key, {
        date: r.date, expiration: r.expiration, strike: Number(r.strike),
        callBuyVol: 0, callSellVol: 0, putBuyVol: 0, putSellVol: 0,
        callVol: 0, putVol: 0, prints: 0,
      });
    }
    const f = flow.get(key);
    const v = Number(r.vol) || 0;
    f.prints += Number(r.prints) || 0;
    const isCall = String(r.type).toUpperCase().startsWith('C');
    if (isCall) f.callVol += v; else f.putVol += v;
    // taker buy -> dealer sold; taker sell -> dealer bought
    if (r.side === 'buy') {
      if (isCall) f.callSellVol += v; else f.putSellVol += v;
    } else if (isCall) f.callBuyVol += v; else f.putBuyVol += v;
  }

  // 4. Join flow to the OI delta for the same expiry+strike and score it.
  //    dates[i-1] is the prior AVAILABLE snapshot, so a gap in the recorder
  //    widens the delta window instead of silently dropping the day.
  const perStrike = [];
  const turnovers = [];
  const flowVsOi = [];

  for (let i = 1; i < dates.length; i += 1) {
    const d = dates[i];
    const prev = dates[i - 1];
    for (const f of flow.values()) {
      if (f.date !== d) continue;
      const cur = oi.get(`${d}|${f.expiration}|${f.strike}`);
      const was = oi.get(`${prev}|${f.expiration}|${f.strike}`);
      if (!cur || !was) continue; // no OI baseline -> unscorable

      const callOiDelta = cur.callOi - was.callOi;
      const putOiDelta = cur.putOi - was.putOi;
      const oiDelta = { call: callOiDelta, put: putOiDelta };

      const signed = D.signedPosition(f);
      const naive = D.reconcilePositionChange(signed, oiDelta, 'flow');
      const anchored = D.reconcilePositionChange(signed, oiDelta, 'oi');
      const conservative = D.reconcilePositionChange(signed, oiDelta, 'min');

      const tC = D.turnoverRatio(callOiDelta, f.callVol);
      const tP = D.turnoverRatio(putOiDelta, f.putVol);
      if (f.callVol > 0) turnovers.push(tC);
      if (f.putVol > 0) turnovers.push(tP);

      const naiveContracts = Math.abs(naive.callNet) + Math.abs(naive.putNet);
      const anchoredContracts = Math.abs(anchored.callNet) + Math.abs(anchored.putNet);
      if (naiveContracts > 0) flowVsOi.push(anchoredContracts / naiveContracts);

      const spot = cur.spot || spotByDate.get(d) || 0;
      const T = yearsToExpiry(d, f.expiration);
      const g = bsGamma(spot, f.strike, T, OPT.iv);
      const gammas = { callGamma: g, putGamma: g };

      perStrike.push({
        date: d, prevDate: prev, expiration: f.expiration, strike: f.strike,
        spot, dte: Math.round(T * 262),
        callVol: f.callVol, putVol: f.putVol, prints: f.prints,
        callOiDelta, putOiDelta,
        callTurnover: tC, putTurnover: tP,
        gamma: g,
        naiveContracts: naive,
        anchoredContracts: anchored,
        naiveGamma$: D.strikeDealerGamma(naive, gammas, spot).netGamma$,
        anchoredGamma$: D.strikeDealerGamma(anchored, gammas, spot).netGamma$,
        conservativeGamma$: D.strikeDealerGamma(conservative, gammas, spot).netGamma$,
        // The OI-convention figure for the same strike, for reference only:
        // calls +, puts -, applied to OUTSTANDING open interest (a different
        // basis entirely — not a competing estimate of the same quantity).
        oiConventionGamma$: D.notionalGammaPer1Pct(g, cur.callOi - cur.putOi, spot),
      });
    }
  }

  if (!perStrike.length) {
    console.error(
      'Flow and OI never lined up on the same expiry+strike. Most likely the OI\n' +
      'recorder and the flow tape cover different expiries. Compare:\n' +
      "  SELECT DISTINCT expiry FROM oi_daily WHERE symbol='SPX' ORDER BY expiry LIMIT 10;\n" +
      '  SELECT DISTINCT expiration FROM flow_prints ORDER BY expiration LIMIT 10;'
    );
    process.exit(4);
  }

  // ── report ───────────────────────────────────────────────────────────────
  console.log('--- 1. Turnover: |ΔOI| / volume per strike-day ---');
  console.log('How much traded volume actually changed open interest.');
  console.log('Near 1 = positions are being established and held.');
  console.log('Near 0 = the same contracts round-trip intraday (typical 0DTE).\n');
  console.log('        n         p10     p25     med     p75     p90    mean');
  console.log(
    `  all  ${String(turnovers.length).padStart(7)}  ` +
    [10, 25, 50, 75, 90].map((p) => (pctl(turnovers, p) ?? 0).toFixed(3).padStart(6)).join('  ') +
    `  ${mean(turnovers).toFixed(3).padStart(6)}`
  );

  console.log('\n--- 2. Does the tape overstate position change? ---');
  console.log('Ratio of OI-implied contracts to tape-implied contracts, per strike-day.');
  console.log('1.0 = the tape and OI agree. Below 1 = the tape overstates.\n');
  console.log(
    `        n ${String(flowVsOi.length).padStart(6)}   med ${(pctl(flowVsOi, 50) ?? 0).toFixed(3)}` +
    `   mean ${mean(flowVsOi).toFixed(3)}   p90 ${(pctl(flowVsOi, 90) ?? 0).toFixed(3)}`
  );
  const mRatio = mean(flowVsOi);
  if (mRatio > 0 && mRatio < 0.9) {
    console.log(`\n  The raw mirror overstates position change by roughly ${(1 / mRatio).toFixed(1)}x.`);
    console.log('  Accumulated over N days that error compounds, so use the OI-anchored');
    console.log("  estimator (mode 'oi') for any cumulative book.");
  } else if (mRatio >= 0.9) {
    console.log('\n  Tape and OI agree closely. The naive mirror is sound here, and a');
    console.log('  cumulative book can be built from flow alone.');
  }

  console.log('\n--- 3. Aggregate dealer gamma per 1% move ---');
  const sum = (k) => perStrike.reduce((a, r) => a + (r[k] || 0), 0);
  console.log(`  naive mirror (mode 'flow')      ${fmt$(sum('naiveGamma$')).padStart(12)}`);
  console.log(`  OI-anchored  (mode 'oi')        ${fmt$(sum('anchoredGamma$')).padStart(12)}   <-- recommended`);
  console.log(`  conservative (mode 'min')       ${fmt$(sum('conservativeGamma$')).padStart(12)}`);
  console.log(`  OI convention, call+/put-       ${fmt$(sum('oiConventionGamma$')).padStart(12)}   [different basis]`);
  console.log('\n  Every RATIO above is invariant to the --iv assumption.');
  console.log('  Absolute dollar figures are only as good as --iv.');

  console.log('\n--- 4. Sign agreement ---');
  const both = perStrike.filter((r) => r.naiveGamma$ !== 0 && r.anchoredGamma$ !== 0);
  const agree = both.filter((r) => Math.sign(r.naiveGamma$) === Math.sign(r.anchoredGamma$)).length;
  console.log(`  naive and OI-anchored agree on sign at ${both.length ? ((agree / both.length) * 100).toFixed(1) : 'n/a'}% of ${both.length} strike-days.`);
  console.log('  Both take direction from the tape, so this should be ~100%. Anything');
  console.log('  lower means strikes where one estimator is zero and the other is not,');
  console.log('  i.e. the tape saw flow the OI data does not corroborate at all.');

  console.log('\n--- 5. Tape coverage caveats ---');
  const total = Number(cov?.total) || 0;
  const neutral = Number(cov?.neutral) || 0;
  console.log(`  flow_prints rows in window : ${total}`);
  console.log(`  dropped as bucket=neutral  : ${neutral} (${total ? ((neutral / total) * 100).toFixed(1) : '0'}%)`);
  console.log(`  side not buy/sell          : ${Number(cov?.unclassified) || 0}`);
  console.log(`  min premium seen           : $${Number(cov?.min_premium) || 0}  <-- FLOW_TAPE_FLOOR cuts below this`);
  console.log(`  scorable strike-days       : ${perStrike.length}`);
  console.log('\n  flow_prints is premium-floored, so its volume is an UNDERSTATED');
  console.log('  denominator in section 1 — true turnover is LOWER than shown, meaning');
  console.log('  the naive mirror is worse than this output suggests, not better.');

  if (OPT.json) {
    writeFileSync(OPT.json, JSON.stringify({
      opts: OPT,
      window: { from: dates[0], to: dates[dates.length - 1], dates },
      coverage: cov,
      summary: {
        naiveGamma$: sum('naiveGamma$'),
        anchoredGamma$: sum('anchoredGamma$'),
        conservativeGamma$: sum('conservativeGamma$'),
        oiConventionGamma$: sum('oiConventionGamma$'),
        meanTurnover: mean(turnovers),
        meanOiToFlowRatio: mRatio,
        signAgreement: both.length ? agree / both.length : null,
      },
      perStrike,
    }, null, 2));
    console.log(`\nWrote ${OPT.json} (${perStrike.length} strike-day rows).`);
  }
  console.log('');
}

try {
  await main();
} catch (e) {
  console.error('\nFailed:', e?.message || e);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
