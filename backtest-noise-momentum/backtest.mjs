// Intraday Momentum Breakout — "Noise Area" + Volatility Targeting
// Quantitativo/academic-inspired. Runs on 5-min RTH ES bars.
// No external deps. Node >= 16.  Run: node backtest.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- CONFIG ---------------------------------------------------------------
const CSV_PATH = process.env.CSV_PATH ||
  'C:\\Users\\Brandon\\AppData\\Roaming\\Claude\\local-agent-mode-sessions\\5fa131bf-a5cb-4861-a456-faf745a3eb0c\\fe054dcd-b9f6-4c80-82e6-67b384e51708\\local_c8009e26-f4c2-49fa-8de1-cd067e6b0a1e\\uploads\\ESU6 - 5 min - RTH.csv';

const CFG = {
  pointValue: 50,          // ES $ per point (per 1.0 index point)
  lookbackDays: 20,        // days to average the "noise" band from
  kBand: 1.0,              // band half-width multiplier on avg intraday move
  confirmCloses: 2,        // consecutive closes beyond band to confirm breakout
  direction: 'both',       // 'long' | 'short' | 'both'
  mode: 'follow',          // 'follow' (momentum breakout) | 'fade' (mean-revert)
  // ---- GEX regime overlay (needs gex.csv) ----
  useRegime: false,        // true -> mode set per day by dealer gamma sign
  gexDeadband: 0,          // |netGex| below this -> skip the day (dead zone near flip)
  useWalls: false,         // true -> gate fade entries by call/put wall proximity
  wallTolPts: 5,           // how close (ES pts) to a wall counts as "at the wall"
  fadeTargetFlip: true,    // fade trades take profit at the gamma flip level
  gexBasis: 0,             // add to SPX levels to convert to ES (if levels are SPX). 0 = already ES
  volLookbackBars: 20,     // bars for volume moving average
  volMult: 1.0,            // entry bar volume must exceed volMult * volMA
  maxTradesPerDay: 3,      // cap churn
  exitMode: 'opp_boundary',// 'opp_boundary' | 'vwap' | 'close_only'
  trailAnchor: 'close',    // trail off running close
  costPointsRT: 0.75,      // round-turn cost (commission+slippage) in ES points
  // vol targeting
  targetDailyVol: 0.02,    // 2% daily vol target
  volTargetLookback: 20,   // days of unlevered returns for realized-vol estimate
  leverageCap: 6,          // max leverage
  annualDays: 252,
};

// Parameter sweep (robustness). Base run uses CFG above.
const SWEEP = {
  kBand: [0.5, 0.75, 1.0, 1.25],
  lookbackDays: [14, 20, 30, 60],
};
// ---------------------------------------------------------------------------

function loadBars(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  const bars = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const [dt, o, h, l, c, v] = line.split(',');
    const day = dt.slice(0, 8);
    const hhmmss = dt.slice(9);              // "HHMMSS"
    const minutes = parseInt(hhmmss.slice(0, 2), 10) * 60 + parseInt(hhmmss.slice(2, 4), 10);
    bars.push({
      day, minutes,
      o: +o, h: +h, l: +l, c: +c, v: +v,
    });
  }
  return bars;
}

// Load per-day GEX. Schema (header required): day,netGex,flip,callWall,putWall
//   day       = YYYYMMDD
//   netGex    = signed net dealer gamma (any unit; only sign vs deadband matters)
//   flip,callWall,putWall = price levels (ES pts, or SPX + set CFG.gexBasis)
// Returns Map(day -> {netGex, flip, callWall, putWall}). Missing file -> null.
function loadGex(file) {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8').trim();
  const lines = raw.split(/\r?\n/);
  const hdr = lines[0].toLowerCase().split(',').map(s => s.trim());
  const idx = (name) => hdr.indexOf(name);
  const iDay = idx('day'), iG = idx('netgex'), iS = idx('spot'),
        iF = idx('flip'), iC = idx('callwall'), iP = idx('putwall');
  const num = (v) => (v === undefined || v === '' ? null : +v);
  const map = new Map();
  for (let k = 1; k < lines.length; k++) {
    if (!lines[k]) continue;
    const c = lines[k].split(',');
    const day = c[iDay].trim().replace(/-/g, '');
    map.set(day, {
      netGex: iG >= 0 ? +c[iG] : 0,
      spot: iS >= 0 ? num(c[iS]) : null,   // SPX spot; used for ES-SPX basis
      flip: iF >= 0 ? num(c[iF]) : null,   // raw (SPX pts); converted in runCore
      callWall: iC >= 0 ? num(c[iC]) : null,
      putWall: iP >= 0 ? num(c[iP]) : null,
    });
  }
  return map;
}

// group bars by day, preserve order
function groupByDay(bars) {
  const map = new Map();
  for (const b of bars) {
    if (!map.has(b.day)) map.set(b.day, []);
    map.get(b.day).push(b);
  }
  // ensure intraday order
  for (const arr of map.values()) arr.sort((a, b) => a.minutes - b.minutes);
  return [...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1); // [ [day, bars], ... ]
}

// average intraday move (fraction of day open) for a single day
function dayMoveFrac(dayBars) {
  const open = dayBars[0].o;
  let sum = 0;
  for (const b of dayBars) sum += Math.abs(b.c / open - 1);
  return sum / dayBars.length;
}

function std(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1);
  return Math.sqrt(v);
}
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

// Core backtest. Returns { dailyRet(unlevered), trades, days, ... }
function runCore(days, cfg, gexMap = null) {
  // precompute per-day avg move fraction
  const moveFrac = days.map(([, b]) => dayMoveFrac(b));

  const trades = [];
  const dailyUnlev = []; // {day, ret}
  const dayLabels = [];

  for (let di = 0; di < days.length; di++) {
    const [day, bars] = days[di];
    dayLabels.push(day);
    // need lookback history for the band
    if (di < cfg.lookbackDays) { dailyUnlev.push(0); continue; }

    const sigma = mean(moveFrac.slice(di - cfg.lookbackDays, di)); // avg past move frac
    const open = bars[0].o;
    const halfBand = cfg.kBand * sigma * open;      // in points
    const upper = open + halfBand;
    const lower = open - halfBand;

    // ---- GEX regime overlay (prior-day EOD sets today's regime; no lookahead) ----
    let effMode = cfg.mode, skipDay = false;
    let flip = null, callWall = null, putWall = null;
    if (cfg.useRegime && gexMap) {
      const prev = di > 0 ? gexMap.get(days[di - 1][0]) : null;
      if (!prev) skipDay = true;                       // no prior GEX -> stand aside
      else {
        // ES-SPX basis from prior-day EOD (no lookahead): ES close - SPX spot
        const prevClose = days[di - 1][1][days[di - 1][1].length - 1].c;
        const basis = prev.spot != null ? prevClose - prev.spot : cfg.gexBasis;
        const cvt = (v) => (v == null ? null : v + basis);
        flip = cvt(prev.flip); callWall = cvt(prev.callWall); putWall = cvt(prev.putWall);
        if (prev.netGex > cfg.gexDeadband) effMode = 'fade';         // long gamma -> pin/fade
        else if (prev.netGex < -cfg.gexDeadband) effMode = 'follow'; // short gamma -> trend
        else skipDay = true;                            // dead zone near flip
      }
    }
    if (skipDay) { dailyUnlev.push(0); continue; }

    // rolling volume MA within the day (seeded from day's own bars)
    let dayRetSum = 0;
    let nTrades = 0;
    let pos = null; // {dir, entry, stop, runExt}
    let consUp = 0, consDn = 0;

    // session VWAP accumulators
    let pv = 0, vv = 0;
    const volWin = [];

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const typical = (b.h + b.l + b.c) / 3;
      pv += typical * b.v; vv += b.v;
      const vwap = vv ? pv / vv : b.c;
      volWin.push(b.v);
      if (volWin.length > cfg.volLookbackBars) volWin.shift();
      const volMA = mean(volWin);

      const isLastBar = i === bars.length - 1;

      // ---- manage open position (exits) ----
      if (pos) {
        let exit = null, reason = null;
        const bandW = cfg.kBand * sigma * open; // trailing distance
        if (pos.dir === 1) {
          pos.runExt = Math.max(pos.runExt, b.c);
          // trailing stop off opposite boundary anchored to running high
          if (cfg.exitMode === 'opp_boundary')
            pos.stop = Math.max(pos.stop, pos.runExt - bandW);
          else if (cfg.exitMode === 'vwap')
            pos.stop = Math.max(pos.stop, vwap);
          if (cfg.exitMode !== 'close_only' && b.l <= pos.stop) { exit = pos.stop; reason = 'trail'; }
        } else {
          pos.runExt = Math.min(pos.runExt, b.c);
          if (cfg.exitMode === 'opp_boundary')
            pos.stop = Math.min(pos.stop, pos.runExt + bandW);
          else if (cfg.exitMode === 'vwap')
            pos.stop = Math.min(pos.stop, vwap);
          if (cfg.exitMode !== 'close_only' && b.h >= pos.stop) { exit = pos.stop; reason = 'trail'; }
        }
        // fade trades: take profit at the gamma flip (pin target)
        if (exit === null && pos.isFade && cfg.fadeTargetFlip && flip != null) {
          if (pos.dir === 1 && flip > pos.entry && b.h >= flip) { exit = flip; reason = 'flip_tp'; }
          else if (pos.dir === -1 && flip < pos.entry && b.l <= flip) { exit = flip; reason = 'flip_tp'; }
        }
        if (exit === null && isLastBar) { exit = b.c; reason = 'session_close'; }
        if (exit !== null) {
          const gross = pos.dir * (exit - pos.entry);
          const net = gross - cfg.costPointsRT;            // points, round-turn cost
          const retFrac = (net) / pos.entry;               // unlevered % on notional
          trades.push({ day, dir: pos.dir, entry: pos.entry, exit, grossPts: gross, netPts: net, retFrac, reason });
          dayRetSum += retFrac;
          pos = null;
        }
      }

      // ---- entries ----
      if (!pos && nTrades < cfg.maxTradesPerDay && !isLastBar && i >= 1) {
        // update consecutive-close counters
        if (b.c > upper) { consUp++; consDn = 0; } else if (b.c < lower) { consDn++; consUp = 0; }
        else { consUp = 0; consDn = 0; }
        const volOK = b.v > cfg.volMult * volMA;
        // follow: break UP -> long, break DOWN -> short.  fade: inverse.
        const upSig = consUp >= cfg.confirmCloses && volOK;   // upside break confirmed
        const dnSig = consDn >= cfg.confirmCloses && volOK;   // downside break confirmed
        const isFade = effMode === 'fade';
        const longTrig  = isFade ? dnSig : upSig;
        const shortTrig = isFade ? upSig : dnSig;
        let allowLong  = cfg.direction === 'long'  || cfg.direction === 'both';
        let allowShort = cfg.direction === 'short' || cfg.direction === 'both';
        // wall proximity gate (fade only): only fade a move if it's at the wall
        if (cfg.useWalls && isFade) {
          allowLong  = allowLong  && putWall  != null && b.c <= putWall  + cfg.wallTolPts;
          allowShort = allowShort && callWall != null && b.c >= callWall - cfg.wallTolPts;
        }
        const bandW0 = cfg.kBand * sigma * open; // protective distance, in points
        if (longTrig && allowLong) {
          pos = { dir: 1, entry: b.c, stop: b.c - bandW0, runExt: b.c, isFade }; nTrades++; consUp = 0; consDn = 0;
        } else if (shortTrig && allowShort) {
          pos = { dir: -1, entry: b.c, stop: b.c + bandW0, runExt: b.c, isFade }; nTrades++; consUp = 0; consDn = 0;
        }
      } else if (pos) {
        // still track counters passively so re-entries after exit work
        if (b.c > upper) { consUp++; consDn = 0; } else if (b.c < lower) { consDn++; consUp = 0; }
        else { consUp = 0; consDn = 0; }
      }
    }
    dailyUnlev.push(dayRetSum);
  }

  return { dailyUnlev, dayLabels, trades };
}

// Apply volatility targeting to an unlevered daily return series (no lookahead)
function applyVolTarget(dailyUnlev, cfg) {
  const lev = new Array(dailyUnlev.length).fill(0);
  const levered = new Array(dailyUnlev.length).fill(0);
  for (let i = 0; i < dailyUnlev.length; i++) {
    if (i >= cfg.volTargetLookback) {
      const win = dailyUnlev.slice(i - cfg.volTargetLookback, i);
      const rv = std(win);
      let L = rv > 1e-9 ? cfg.targetDailyVol / rv : 0;
      L = Math.min(L, cfg.leverageCap);
      lev[i] = L;
      levered[i] = L * dailyUnlev[i];
    } else {
      lev[i] = 0; levered[i] = 0;
    }
  }
  return { lev, levered };
}

function stats(daily, cfg) {
  const active = daily.filter((_, i) => true);
  const m = mean(daily);
  const s = std(daily);
  const sharpe = s > 0 ? (m / s) * Math.sqrt(cfg.annualDays) : 0;
  // equity
  let eq = 1; const curve = [];
  let peak = 1, maxDD = 0;
  for (const r of daily) { eq *= (1 + r); curve.push(eq); peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq / peak - 1); }
  const nDays = daily.length;
  const total = eq - 1;
  const cagr = Math.pow(eq, cfg.annualDays / nDays) - 1;
  const annVol = s * Math.sqrt(cfg.annualDays);
  return { total, cagr, annVol, sharpe, maxDD, finalEq: eq, curve, nDays };
}

function tradeStats(trades) {
  const n = trades.length;
  const wins = trades.filter(t => t.netPts > 0);
  const losses = trades.filter(t => t.netPts <= 0);
  const gWin = wins.reduce((a, t) => a + t.netPts, 0);
  const gLoss = Math.abs(losses.reduce((a, t) => a + t.netPts, 0));
  return {
    n, winRate: n ? wins.length / n : 0,
    avgWin: wins.length ? gWin / wins.length : 0,
    avgLoss: losses.length ? -gLoss / losses.length : 0,
    profitFactor: gLoss > 0 ? gWin / gLoss : Infinity,
    totalNetPts: trades.reduce((a, t) => a + t.netPts, 0),
  };
}

function buyHold(days, cfg) {
  // daily close-to-close of underlying, RTH only
  const closes = days.map(([, b]) => b[b.length - 1].c);
  const daily = [];
  for (let i = 1; i < closes.length; i++) daily.push(closes[i] / closes[i - 1] - 1);
  return stats(daily, cfg);
}

function pct(x) { return (x * 100).toFixed(2) + '%'; }

// ---- MAIN -----------------------------------------------------------------
console.error('Loading bars...');
const bars = loadBars(CSV_PATH);
const days = groupByDay(bars);
console.error(`Loaded ${bars.length} bars over ${days.length} trading days (${days[0][0]} → ${days[days.length - 1][0]})`);

// GEX regime data (optional). Drop gex.csv next to this script to activate.
const GEX_PATH = process.env.GEX_PATH || path.join(__dirname, 'gex.csv');
const gexMap = loadGex(GEX_PATH);
if (gexMap) console.error(`Loaded GEX for ${gexMap.size} days from ${GEX_PATH}`);
else console.error(`No gex.csv found at ${GEX_PATH} — regime section will be skipped. See README for schema.`);

// Base run
const core = runCore(days, CFG);
const { lev, levered } = applyVolTarget(core.dailyUnlev, CFG);
const unlevStats = stats(core.dailyUnlev, CFG);
const levStats = stats(levered, CFG);
const tStats = tradeStats(core.trades);
const bh = buyHold(days, CFG);
const avgLev = mean(lev.filter(x => x > 0));

const out = {
  config: CFG,
  data: { bars: bars.length, days: days.length, start: days[0][0], end: days[days.length - 1][0] },
  base: {
    unlevered: unlevStats,
    volTargeted: { ...levStats, avgLeverage: avgLev },
    trades: tStats,
    buyHold: bh,
  },
};

// Sweep
const sweep = [];
for (const k of SWEEP.kBand) {
  for (const L of SWEEP.lookbackDays) {
    const cfg = { ...CFG, kBand: k, lookbackDays: L };
    const c = runCore(days, cfg);
    const vt = applyVolTarget(c.dailyUnlev, cfg);
    const st = stats(vt.levered, cfg);
    const ts = tradeStats(c.trades);
    sweep.push({ k, L, cagr: st.cagr, sharpe: st.sharpe, maxDD: st.maxDD, trades: ts.n, winRate: ts.winRate });
  }
}
out.sweep = sweep;

// Variant grid: mode x direction, at two band settings
const variants = [];
for (const mode of ['follow', 'fade']) {
  for (const direction of ['both', 'long']) {
    for (const [k, Lb] of [[1.0, 60], [1.25, 60]]) {
      const cfg = { ...CFG, mode, direction, kBand: k, lookbackDays: Lb };
      const c = runCore(days, cfg);
      const vt = applyVolTarget(c.dailyUnlev, cfg);
      const st = stats(vt.levered, cfg);
      const su = stats(c.dailyUnlev, cfg);
      const ts = tradeStats(c.trades);
      variants.push({ mode, direction, k, L: Lb, cagr: st.cagr, sharpe: st.sharpe, maxDD: st.maxDD,
        unlevCagr: su.cagr, unlevSharpe: su.sharpe, trades: ts.n, winRate: ts.winRate, pf: ts.profitFactor });
    }
  }
}
out.variants = variants;

// GEX regime overlay: pos-GEX->fade, neg-GEX->follow, switched per prior-day EOD
let regime = null;
if (gexMap) {
  regime = [];
  for (const direction of ['both', 'long']) {
    for (const useWalls of [false, true]) {
      for (const [k, Lb] of [[1.0, 60], [1.25, 60]]) {
        const cfg = { ...CFG, useRegime: true, direction, useWalls, kBand: k, lookbackDays: Lb };
        const c = runCore(days, cfg, gexMap);
        const vt = applyVolTarget(c.dailyUnlev, cfg);
        const st = stats(vt.levered, cfg);
        const su = stats(c.dailyUnlev, cfg);
        const ts = tradeStats(c.trades);
        const tradedDays = c.dailyUnlev.filter(r => r !== 0).length;
        regime.push({ direction, useWalls, k, L: Lb, cagr: st.cagr, sharpe: st.sharpe, maxDD: st.maxDD,
          unlevCagr: su.cagr, unlevSharpe: su.sharpe, trades: ts.n, winRate: ts.winRate, pf: ts.profitFactor, tradedDays });
      }
    }
  }
  out.regime = regime;
}

// ---- write outputs ----
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(out, null, 2));

// equity curve csv (vol-targeted base)
let eqCsv = 'day,unlevered_equity,voltargeted_equity,leverage\n';
const uCurve = unlevStats.curve, vCurve = levStats.curve;
for (let i = 0; i < core.dayLabels.length; i++) {
  eqCsv += `${core.dayLabels[i]},${(uCurve[i] || 1).toFixed(6)},${(vCurve[i] || 1).toFixed(6)},${lev[i].toFixed(3)}\n`;
}
fs.writeFileSync(path.join(__dirname, 'equity_curve.csv'), eqCsv);

// trades csv
let trCsv = 'day,dir,entry,exit,grossPts,netPts,retFrac,reason\n';
for (const t of core.trades)
  trCsv += `${t.day},${t.dir},${t.entry},${t.exit},${t.grossPts.toFixed(2)},${t.netPts.toFixed(2)},${(t.retFrac).toFixed(6)},${t.reason}\n`;
fs.writeFileSync(path.join(__dirname, 'trades.csv'), trCsv);

// human summary
const L = [];
L.push('==================================================================');
L.push(' NOISE-AREA MOMENTUM BREAKOUT + VOL TARGETING — BACKTEST RESULTS');
L.push('==================================================================');
L.push(`Data      : ${bars.length} 5-min RTH bars, ${days.length} days (${days[0][0]} → ${days[days.length - 1][0]})`);
L.push(`Exit rule : ${CFG.exitMode}  |  band k=${CFG.kBand}, lookback=${CFG.lookbackDays}d, confirm=${CFG.confirmCloses} closes`);
L.push(`Costs     : ${CFG.costPointsRT} pts round-turn  |  vol target=${pct(CFG.targetDailyVol)}/day, cap ${CFG.leverageCap}x`);
L.push('');
L.push('--- STRATEGY (volatility-targeted) -------------------------------');
L.push(`Total return : ${pct(levStats.total)}`);
L.push(`CAGR (ann.)  : ${pct(levStats.cagr)}`);
L.push(`Ann. vol     : ${pct(levStats.annVol)}`);
L.push(`Sharpe       : ${levStats.sharpe.toFixed(2)}`);
L.push(`Max drawdown : ${pct(levStats.maxDD)}`);
L.push(`Avg leverage : ${avgLev.toFixed(2)}x`);
L.push('');
L.push('--- STRATEGY (unlevered, 1x notional) ----------------------------');
L.push(`Total return : ${pct(unlevStats.total)}   CAGR ${pct(unlevStats.cagr)}   Sharpe ${unlevStats.sharpe.toFixed(2)}   MaxDD ${pct(unlevStats.maxDD)}`);
L.push('');
L.push('--- TRADES -------------------------------------------------------');
L.push(`Count        : ${tStats.n}`);
L.push(`Win rate     : ${pct(tStats.winRate)}`);
L.push(`Avg win/loss : +${tStats.avgWin.toFixed(2)} / ${tStats.avgLoss.toFixed(2)} pts`);
L.push(`Profit factor: ${tStats.profitFactor.toFixed(2)}`);
L.push(`Net points   : ${tStats.totalNetPts.toFixed(1)} pts  (≈ $${(tStats.totalNetPts * CFG.pointValue).toFixed(0)} per 1 contract, ungeared)`);
L.push('');
L.push('--- BUY & HOLD (RTH close-to-close, 1x) --------------------------');
L.push(`Total ${pct(bh.total)}   CAGR ${pct(bh.cagr)}   Sharpe ${bh.sharpe.toFixed(2)}   MaxDD ${pct(bh.maxDD)}`);
L.push('');
L.push('--- PARAMETER SWEEP (vol-targeted) -------------------------------');
L.push('  k    L    CAGR      Sharpe   MaxDD     Trades  Win%');
for (const s of sweep)
  L.push(`  ${s.k.toFixed(2)} ${String(s.L).padStart(3)}  ${pct(s.cagr).padStart(8)}  ${s.sharpe.toFixed(2).padStart(6)}  ${pct(s.maxDD).padStart(8)}  ${String(s.trades).padStart(6)}  ${(s.winRate * 100).toFixed(1)}`);
L.push('');
L.push('--- VARIANT GRID: mode x direction (vol-targeted) ----------------');
L.push('  mode    dir    k    L    CAGR      Sharpe   MaxDD     PF     Win%   Trades   | unlev CAGR/Sharpe');
for (const v of variants)
  L.push(`  ${v.mode.padEnd(6)} ${v.direction.padEnd(5)} ${v.k.toFixed(2)} ${String(v.L).padStart(3)}  ${pct(v.cagr).padStart(8)}  ${v.sharpe.toFixed(2).padStart(6)}  ${pct(v.maxDD).padStart(8)}  ${(isFinite(v.pf)?v.pf.toFixed(2):'inf').padStart(5)}  ${(v.winRate*100).toFixed(1).padStart(4)}  ${String(v.trades).padStart(6)}   | ${pct(v.unlevCagr).padStart(8)} / ${v.unlevSharpe.toFixed(2)}`);
if (regime) {
  L.push('');
  L.push('--- GEX REGIME OVERLAY: +GEX=fade / -GEX=follow (vol-targeted) ----');
  L.push('  dir    walls  k    L    CAGR      Sharpe   MaxDD     PF     Win%   Trades  Days  | unlev CAGR/Sharpe');
  for (const v of regime)
    L.push(`  ${v.direction.padEnd(5)} ${(v.useWalls?'on ':'off').padEnd(5)} ${v.k.toFixed(2)} ${String(v.L).padStart(3)}  ${pct(v.cagr).padStart(8)}  ${v.sharpe.toFixed(2).padStart(6)}  ${pct(v.maxDD).padStart(8)}  ${(isFinite(v.pf)?v.pf.toFixed(2):'inf').padStart(5)}  ${(v.winRate*100).toFixed(1).padStart(4)}  ${String(v.trades).padStart(6)}  ${String(v.tradedDays).padStart(4)}  | ${pct(v.unlevCagr).padStart(8)} / ${v.unlevSharpe.toFixed(2)}`);
} else {
  L.push('');
  L.push('--- GEX REGIME OVERLAY -------------------------------------------');
  L.push('  (no gex.csv found — drop one next to this script to run it; schema in README.md)');
}
L.push('==================================================================');
const summary = L.join('\n');
fs.writeFileSync(path.join(__dirname, 'results.txt'), summary);
console.error('\n' + summary);
console.error('\nWrote results.json, results.txt, equity_curve.csv, trades.csv');
