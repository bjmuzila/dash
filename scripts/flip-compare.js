'use strict';
/**
 * scripts/flip-compare.js
 *
 * Compares the GEX "Zero Gamma" flip computed three ways on the LIVE 0DTE chain:
 *   1. BARS    — zero-crossing of the static per-strike net-GEX bars (what the
 *                gold bars on the chart actually net to; findGEXFlip).
 *   2. SWEEP   — spot-sweep BS gamma profile exactly as the dashboard does it,
 *                with the 1/262 trading-day floor for 0DTE (computeGEXProfile).
 *                This is the orange "Profile" curve / the 7,473-type number.
 *   3. SWEEP-T — identical spot-sweep, but the 0DTE leg's time-to-expiry is the
 *                LIVE fraction of the RTH session left until 16:00 ET, instead of
 *                the synthetic full-day floor. Isolates how much of the SWEEP
 *                flip is real curvature vs. the 1/262 floor.
 *
 * Run against your own dashboard (already authed / on localhost):
 *   node scripts/flip-compare.js                       # hits http://localhost:3001/api/gex
 *   node scripts/flip-compare.js --base https://dash-1fa2.onrender.com
 *   node scripts/flip-compare.js --file chain.json     # use a saved /api/gex JSON
 *   node scripts/flip-compare.js --mode vol-only       # default oi-vol
 *
 * No deps. Node 18+ (built-in fetch). Read-only — touches nothing.
 */

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};
const BASE = (getArg('--base', process.env.BASE_URL || 'http://localhost:3001')).replace(/\/$/, '');
const FILE = getArg('--file', null);
const MODE = getArg('--mode', 'oi-vol'); // 'oi-vol' | 'vol-only'

// ── contract basis (mirrors computeGEXProfile / calculateNetGEX) ─────────────
const callContracts = (r) =>
  MODE === 'vol-only' ? (r.callVolume ?? 0) : (r.callOI ?? 0) + (r.callVolume ?? 0);
const putContracts = (r) =>
  MODE === 'vol-only' ? (r.putVolume ?? 0) : (r.putOI ?? 0) + (r.putVolume ?? 0);

// ── Black-Scholes gamma (verbatim from lib/calculations/calculations.ts) ─────
function bsGamma(S, K, vol, T) {
  if (T <= 0 || vol <= 0 || S <= 0 || K <= 0) return 0;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * vol * vol * T) / (vol * sqrtT);
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return pdf / (S * vol * sqrtT);
}

// ── live RTH fraction remaining to 16:00 ET (for SWEEP-T) ────────────────────
// Returns T in the SAME annualization the dashboard uses (trading-days / 262),
// but for the 0DTE leg the "days" term is the fraction of the 6.5h session left.
function liveZeroDteT() {
  // Current wall-clock in America/New_York, regardless of host TZ.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const nowSec = get('hour') * 3600 + get('minute') * 60 + get('second');
  const open = 9.5 * 3600;   // 09:30 ET
  const close = 16 * 3600;   // 16:00 ET
  const sessionLen = close - open; // 6.5h
  const leftSec = Math.min(Math.max(close - nowSec, 0), sessionLen);
  const fracOfDay = leftSec / sessionLen;          // 0..1 of one RTH day
  const T = fracOfDay / 262;                        // same /262 annualization
  return { T, leftSec, fracOfDay };
}

// ── 1. BARS: per-strike net-GEX zero crossing (port of findGEXFlip) ──────────
function flipFromBars(rows, spot) {
  const netOf = (r) => {
    const s = Number(r.spotPrice ?? r.spot ?? spot);
    const cg = Math.abs(r.callGamma ?? 0) * callContracts(r) * s * s;
    const pg = -(Math.abs(r.putGamma ?? 0) * putContracts(r) * s * s);
    return cg + pg;
  };
  const sorted = rows
    .map((r) => ({ strike: r.strike, net: netOf(r) }))
    .filter((r) => Number.isFinite(r.net))
    .sort((a, b) => a.strike - b.strike);
  const crossings = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i].net, b = sorted[i + 1].net;
    if (a === 0) { crossings.push(sorted[i].strike); continue; }
    if (b === 0) { crossings.push(sorted[i + 1].strike); continue; }
    if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
      const sA = sorted[i].strike, sB = sorted[i + 1].strike;
      const zero = sA + (sB - sA) * (Math.abs(a) / (Math.abs(a) + Math.abs(b)));
      if (Number.isFinite(zero)) crossings.push(Math.round(zero * 10) / 10);
    }
  }
  if (!crossings.length) return null;
  const best = crossings.reduce((bst, c) =>
    Math.abs(c - spot) < Math.abs(bst - spot) ? c : bst);
  return best > 0 ? best : null;
}

// ── 2/3. SWEEP: BS gamma profile (port of computeGEXProfile, T overridable) ──
// tOverride: (dte:number) => T   — lets SWEEP-T substitute the live 0DTE T.
function flipFromSweep(rows, spot, tOverride) {
  const usable = rows.filter((r) =>
    (r.callIV ?? 0) > 0 && (r.putIV ?? 0) > 0 &&
    callContracts(r) + putContracts(r) > 0 && (r.dte ?? 0) >= 0);
  if (usable.length < 5) return { flip: null, levels: [], values: [], usable: usable.length };

  const lo = spot * 0.8, hi = spot * 1.2, N = 60;
  const levels = Array.from({ length: N }, (_, i) => lo + (hi - lo) * (i / (N - 1)));
  const values = [];
  for (const S of levels) {
    let net = 0;
    for (const r of usable) {
      const dte = r.dte ?? 0;
      const T = tOverride ? tOverride(dte) : (dte <= 0 ? 1 / 262 : dte / 262);
      net += callContracts(r) * 100 * S * S * bsGamma(S, r.strike, r.callIV, T);
      net -= putContracts(r) * 100 * S * S * bsGamma(S, r.strike, r.putIV, T);
    }
    values.push(net / 1e9);
  }
  let flip = null;
  for (let i = 0; i < values.length - 1; i++) {
    const a = values[i], b = values[i + 1];
    if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) {
      flip = levels[i + 1] - ((levels[i + 1] - levels[i]) * b / (b - a));
      break;
    }
  }
  if (flip !== null) flip = Math.round(flip * 10) / 10;
  return { flip, levels, values, usable: usable.length };
}

// ── data ─────────────────────────────────────────────────────────────────────
async function loadChain() {
  if (FILE) {
    const fs = require('fs');
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  }
  const res = await fetch(`${BASE}/api/gex`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${BASE}/api/gex → HTTP ${res.status}`);
  return res.json();
}

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }));

(async () => {
  const data = await loadChain();
  const rows = Array.isArray(data.chain) ? data.chain
            : Array.isArray(data.gexRows) ? data.gexRows : [];
  const spot = Number(data.spotPrice ?? data.spot ?? 0);
  if (!rows.length || !(spot > 0)) {
    console.error('No chain rows or spot. Got keys:', Object.keys(data));
    process.exit(1);
  }
  const dtes = [...new Set(rows.map((r) => r.dte))].sort((a, b) => a - b);

  const bars = flipFromBars(rows, spot);
  const sweep = flipFromSweep(rows, spot, null);
  const live = liveZeroDteT();
  const sweepT = flipFromSweep(rows, spot, (dte) => (dte <= 0 ? live.T : dte / 262));

  const hrs = (live.leftSec / 3600).toFixed(2);
  console.log('');
  console.log(`  expiry ${data.expiration ?? '?'}   spot ${fmt(spot)}   mode ${MODE}   strikes ${rows.length}   dte set [${dtes.join(', ')}]`);
  console.log(`  ──────────────────────────────────────────────────────────────`);
  console.log(`  1. BARS    (static per-strike zero crossing) : ${fmt(bars)}`);
  console.log(`  2. SWEEP   (BS profile, 1/262 floor)         : ${fmt(sweep.flip)}   ← the orange-curve flip`);
  console.log(`  3. SWEEP-T (BS profile, ${hrs}h to 16:00 ET) : ${fmt(sweepT.flip)}`);
  console.log(`  ──────────────────────────────────────────────────────────────`);
  if (sweep.flip != null && sweepT.flip != null) {
    const dFloor = (sweep.flip - bars).toFixed(1);
    const dReal = (sweepT.flip - bars).toFixed(1);
    const floorShare = (sweep.flip - sweepT.flip).toFixed(1);
    console.log(`  SWEEP − BARS   = ${dFloor}  (full gap: model + floor)`);
    console.log(`  SWEEP-T − BARS = ${dReal}  (gap with realistic T)`);
    console.log(`  SWEEP − SWEEP-T= ${floorShare}  (pts of flip attributable to the 1/262 floor)`);
  }
  console.log('');
})().catch((e) => { console.error('flip-compare failed:', e.message); process.exit(1); });
