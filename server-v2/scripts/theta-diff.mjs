/**
 * server-v2/scripts/theta-diff.mjs
 *
 * Phase 1 verification: pull the SPXW 0DTE chain OI from the Theta adapter and
 * diff it, per strike+side, against the live TT figure (via the running
 * server-v2 /proxy/probe-rest route). Prints only divergences + a summary.
 *
 * Prereqs (all local):
 *   - Theta Terminal running, REST on 25503 (or set THETA_BASE_URL)
 *   - server-v2 running on 3002 (or set SERVER_V2_URL) for the TT side
 *
 * Run:  node server-v2/scripts/theta-diff.mjs 2026-06-29  [spotGuess] [windowPct]
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const theta = require('../proxy-thetadata.js');

const EXP = process.argv[2] || new Date().toISOString().slice(0, 10);
const SPOT = Number(process.argv[3] || 7409); // rough SPX spot; just to window strikes
const WIN = Number(process.argv[4] || 0.05);  // +/-5% window
const SERVER = (process.env.SERVER_V2_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '');

const lo = SPOT * (1 - WIN);
const hi = SPOT * (1 + WIN);

async function ttOI(strike, type) {
  const u = `${SERVER}/proxy/probe-rest?ticker=SPX&expiry=${EXP}&type=${type}&strike=${strike}`;
  try {
    const r = await fetch(u);
    const j = await r.json();
    return Number(j?.result?.feeds?.Summary?.openInterest);
  } catch { return NaN; }
}

(async () => {
  console.log(`[theta-diff] exp=${EXP} window=${lo.toFixed(0)}..${hi.toFixed(0)} (SPXW)`);
  const oiMap = await theta.fetchOpenInterestTheta('SPX', EXP);
  if (oiMap.size === 0) {
    console.log('[theta-diff] Theta OI empty — pre-06:30 ET, weekend/holiday, or tier gate. Stop.');
    process.exit(2);
  }

  // Theta keys are `exp|strike|type`. Filter to the window.
  const strikes = [...new Set([...oiMap.keys()]
    .map((k) => Number(k.split('|')[1]))
    .filter((s) => s >= lo && s <= hi))].sort((a, b) => a - b);

  let checked = 0, exact = 0, diffs = 0, ttMissing = 0;
  const rows = [];
  for (const strike of strikes) {
    for (const type of ['C', 'P']) {
      const t = oiMap.get(`${EXP}|${strike}|${type}`);
      if (!t) continue;
      const tt = await ttOI(strike, type);
      checked++;
      if (!Number.isFinite(tt)) { ttMissing++; continue; }
      if (tt === t.oi) { exact++; }
      else {
        diffs++;
        const pct = tt ? ((t.oi - tt) / tt) * 100 : Infinity;
        rows.push({ strike, type, theta: t.oi, tt, dPct: pct.toFixed(1) });
      }
    }
  }

  if (rows.length) {
    console.log('\nDIVERGENCES (theta vs tt):');
    console.table(rows);
  }
  console.log(`\n[theta-diff] strikes=${strikes.length} checked=${checked} exact=${exact} diffs=${diffs} ttMissing=${ttMissing}`);
  console.log(diffs === 0 && exact > 0
    ? '[theta-diff] PASS — Theta OI matches TT across the window.'
    : '[theta-diff] review divergences above.');
})();
