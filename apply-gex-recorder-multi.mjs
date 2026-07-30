#!/usr/bin/env node
/**
 * apply-gex-recorder-multi.mjs — re-applies the GEX-basis changes to
 * server-v2/eod-gex-recorder.js by ANCHORED STRING REPLACEMENT.
 *
 * WHY THIS EXISTS. That file was edited in parallel after these changes were
 * first written to it, and the parallel version won — which is why prod has
 * server-with-proxy.js's new /proxy/gex-by-strike-multi route but NOT the
 * getLiveGexRowsMulti export it calls, giving:
 *     {"ok":false,"error":"getLiveGexRowsMulti is not a function"}
 * Overwriting the file wholesale would clobber that parallel work a second
 * time, so each of the 21 edits below is anchored on a unique block of the
 * ORIGINAL file and re-applied on top of whatever is there now.
 *
 * Anything that landed inside one of those blocks is reported per-anchor and
 * nothing is written — so this can't silently half-merge two versions.
 *
 * Safe to run twice: an edit already present is detected and skipped.
 *
 * Depends on computation/gex-calculator.js exporting computeGexRowsMultiExpiry
 * and computation/utils.js exporting etEpochMs. Both are already deployed.
 *
 * Run from the repo root:  node apply-gex-recorder-multi.mjs
 *   --dry   report what would change, write nothing
 *   --file <path>  target a different file
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const fi = argv.indexOf('--file');
const TARGET = fi !== -1 ? argv[fi + 1] : 'server-v2/eod-gex-recorder.js';

// [anchor, replacement, label]
const EDITS = [
  [
    " * Guard: if Greeks/OI are missing for most strikes (< MIN_POPULATED_STRIKES\r\n * strikes with non-zero gamma AND non-zero OI), SKIP the write and log.\r\n * Never writes 0 / partial GEX.\r\n */\r\n\r\nconst { computeGexRows, totalNetGex } = require('./computation/gex-calculator');\r\nconst { useTheta } = require('./config/data-source');\r\n// Option data source follows the SAME DATA_SOURCE flag as the main feed:\r\n// Theta when on, TastyTrade REST (tt-snapshot) when the subscription is paused.",
    " * Guard: if Greeks/OI are missing for most strikes (< MIN_POPULATED_STRIKES\r\n * strikes with non-zero gamma AND non-zero OI), SKIP the write and log.\r\n * Never writes 0 / partial GEX.\r\n *\r\n * \u2500\u2500 COLUMN BASES (read this before charting any of them) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\r\n * `total_gex` is HISTORICALLY MIXED and is kept only for back-compat. Its\r\n * meaning depends on which writer touched the row last:\r\n *   source='ladder'       0DTE only,   OI-only     (PM pass, per-strike ladder)\r\n *   source='live_state'   front expiry, OI+Vol     (PM fallback, /proxy/gex header)\r\n *   source='theta'        ALL expirations, OI+Vol  (AM settled pass + catch-up,\r\n *                                                   which OVERWRITE the PM row)\r\n *   source='mvc_snapshot' 0DTE-ish,    OI-only     (last-resort fallback)\r\n * Because the AM pass overwrites yesterday, a `total_gex` series is mostly\r\n * all-expiration OI+Vol with today's bar on the 0DTE OI-only basis. Do not\r\n * chart it as a single series.\r\n *\r\n * The two columns below ARE single-definition, both on the OI+Vol basis\r\n * (gamma \u00d7 (OI + volume) \u00d7 spot\u00b2, puts negated), and every path that can\r\n * produce them now writes both:\r\n *   total_gex_0dte    0DTE expiry ONLY          <- \"SPX EOD GEX by session\" card\r\n *   total_gex_ex0dte  every expiry EXCEPT 0DTE  <- the ex-0DTE card\r\n * Their sum is the whole-chain OI+Vol total. NULL means \"this path could not\r\n * produce it\", never 0 \u2014 see the COALESCE in upsertEodGex.\r\n *\r\n * One caveat no column can hide: the PM pass sees PROVISIONAL intraday OI, the\r\n * AM pass sees SETTLED OPRA OI, so a row's values firm up the next morning.\r\n * That is a data-vintage difference, not a basis difference.\r\n */\r\n\r\n// computeGexRows is SINGLE-EXPIRY (it groups by strike alone, so multi-expiry\r\n// input keeps only the last expiry per strike/side). Anything spanning more than\r\n// one expiration must use computeGexRowsMultiExpiry.\r\nconst { computeGexRows, computeGexRowsMultiExpiry, totalNetGex, findGexFlip } = require('./computation/gex-calculator');\r\nconst { useTheta } = require('./config/data-source');\r\n// Option data source follows the SAME DATA_SOURCE flag as the main feed:\r\n// Theta when on, TastyTrade REST (tt-snapshot) when the subscription is paused.",
    "require computeGexRowsMultiExpiry (multi-expiry aggregator)"
  ],
  [
    "  fetchIndexEodTheta,\r\n  fetchStockEodTheta,\r\n} = useTheta() ? require('./proxy-thetadata') : require('./tt-snapshot');\r\nconst { bsGreeks, impliedVol, yearsToExpiry } = require('./computation/utils');\r\n\r\n// `exp|strike|type` key matching proxy-thetadata's keyOf()\r\nconst keyOf = (exp, strike, type) => `${exp}|${Number(strike)}|${type}`;",
    "  fetchIndexEodTheta,\r\n  fetchStockEodTheta,\r\n} = useTheta() ? require('./proxy-thetadata') : require('./tt-snapshot');\r\nconst { bsGreeks, impliedVol, yearsToExpiry, etEpochMs } = require('./computation/utils');\r\n\r\n// `exp|strike|type` key matching proxy-thetadata's keyOf()\r\nconst keyOf = (exp, strike, type) => `${exp}|${Number(strike)}|${type}`;",
    "header docblock: COLUMN BASES (which column means what)"
  ],
  [
    "// Minimum number of strikes with gamma AND OI present to trust the data.\r\nconst MIN_POPULATED_STRIKES = 20;\r\n\r\n// EOD window: 15:55\u201316:05 ET (minutes-since-midnight)\r\nconst WINDOW_OPEN_MINS  = 15 * 60 + 55; // 955\r\nconst WINDOW_CLOSE_MINS = 16 * 60 +  5; // 965",
    "// Minimum number of strikes with gamma AND OI present to trust the data.\r\nconst MIN_POPULATED_STRIKES = 20;\r\n\r\n// Fraction of a persisted ladder's strikes that must carry a non-NULL\r\n// net_vol_gex before we will call the sum an OI+Vol total. See fetchSpxLadder.\r\nconst VOL_COVERAGE_MIN = 0.5;\r\n\r\n// EOD window: 15:55\u201316:05 ET (minutes-since-midnight)\r\nconst WINDOW_OPEN_MINS  = 15 * 60 + 55; // 955\r\nconst WINDOW_CLOSE_MINS = 16 * 60 +  5; // 965",
    "VOL_COVERAGE_MIN constant"
  ],
  [
    "\r\n// \u2500\u2500 Data fetchers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\r\n\r\n// Epoch ms for `hh:mm` ET on an ET date string, DST-correct (no hardcoded -4/-5).\r\nfunction etEpochMs(dateStr, hh, mm) {\r\n  const asUtc = Date.parse(\r\n    `${dateStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`\r\n  );\r\n  const tzn = new Intl.DateTimeFormat('en-US', {\r\n    timeZone: 'America/New_York', timeZoneName: 'longOffset',\r\n  }).formatToParts(new Date(asUtc)).find((p) => p.type === 'timeZoneName')?.value || 'GMT-4';\r\n  const m = /GMT([+-])(\\d{1,2})(?::(\\d{2}))?/.exec(tzn);\r\n  const offMin = m\r\n    ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0))\r\n    : -240;\r\n  return asUtc - offMin * 60_000;\r\n}\r\n\r\n/**\r\n * $SPX net GEX from the PERSISTED per-strike ladder, not from live market-state.",
    "\r\n// \u2500\u2500 Data fetchers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\r\n\r\n// etEpochMs (DST-correct \"hh:mm ET on this date\" \u2192 epoch ms) now lives in\r\n// computation/utils.js so scripts/backfill-eod-gex-0dte.js can use the exact\r\n// same 16:00-ET cutoff without importing this module's Theta/TT graph.\r\n\r\n/**\r\n * $SPX net GEX from the PERSISTED per-strike ladder, not from live market-state.",
    "drop local etEpochMs (moved to computation/utils.js)"
  ],
  [
    " * drift materially on some sessions (2026-07-24 moves -21.3B -> -8.9B if you\r\n * take max(timestamp) instead), so the cutoff is load-bearing, not cosmetic.\r\n *\r\n * Returns { totalNetGex, totalFlowGex, spot, pinStrike, pinNetGex, pinShare }.\r\n */\r\nasync function fetchSpxLadder(date) {\r\n  const p = getPool();",
    " * drift materially on some sessions (2026-07-24 moves -21.3B -> -8.9B if you\r\n * take max(timestamp) instead), so the cutoff is load-bearing, not cosmetic.\r\n *\r\n * TWO totals come back, from the SAME snapshot row set:\r\n *   totalNetGex      \u03a3 net_gex                  \u2014 OI-only, what total_gex has\r\n *                                                 always held for source='ladder'\r\n *   totalNetGex0dte  \u03a3 (net_gex + net_vol_gex)  \u2014 OI+Vol, the basis the walls,\r\n *                                                 the flip and $Gamma all use\r\n * The OI+Vol one is null unless net_vol_gex is actually populated (see\r\n * VOL_COVERAGE_MIN): the column was added after this table existed, so older\r\n * snapshots have it NULL, and COALESCE-ing those to 0 would silently emit an\r\n * OI-only number wearing an OI+Vol label.\r\n *\r\n * Returns { totalNetGex, totalNetGex0dte, totalFlowGex, spot, pinStrike,\r\n *           pinNetGex, pinShare, snapMs }.\r\n */\r\nasync function fetchSpxLadder(date) {\r\n  const p = getPool();",
    "fetchSpxLadder docblock: two totals, OI-only + OI+Vol"
  ],
  [
    "       FROM option_strike_gex_history\r\n       WHERE symbol = $1 AND date = $2 AND expiry = $2 AND timestamp < $3\r\n     )\r\n     SELECT h.strike, h.spot, h.net_gex, h.call_gamma, h.put_gamma, h.timestamp\r\n     FROM option_strike_gex_history h, snap\r\n     WHERE h.symbol = $1 AND h.date = $2 AND h.expiry = $2\r\n       AND h.timestamp = snap.t`,",
    "       FROM option_strike_gex_history\r\n       WHERE symbol = $1 AND date = $2 AND expiry = $2 AND timestamp < $3\r\n     )\r\n     SELECT h.strike, h.spot, h.net_gex, h.net_vol_gex, h.call_gamma, h.put_gamma, h.timestamp\r\n     FROM option_strike_gex_history h, snap\r\n     WHERE h.symbol = $1 AND h.date = $2 AND h.expiry = $2\r\n       AND h.timestamp = snap.t`,",
    "fetchSpxLadder query: select net_vol_gex"
  ],
  [
    "  }\r\n\r\n  let tng = 0, absSum = 0, pin = null;\r\n  for (const r of rows) {\r\n    const g = Number(r.net_gex) || 0;\r\n    tng += g;\r\n    absSum += Math.abs(g);\r\n    if (!pin || Math.abs(g) > Math.abs(pin.g)) pin = { g, strike: Number(r.strike) };\r\n  }\r\n\r\n  const spot = Number(rows[0].spot) || 0;",
    "  }\r\n\r\n  let tng = 0, absSum = 0, pin = null;\r\n  // OI+Vol sibling of `tng`, accumulated over the same rows. `volRows` counts\r\n  // strikes that actually carried a net_vol_gex value \u2014 a strike with genuinely\r\n  // zero volume writes 0.0, not NULL, so NULL here means \"not recorded\".\r\n  let tngOiVol = 0, volRows = 0;\r\n  for (const r of rows) {\r\n    const g = Number(r.net_gex) || 0;\r\n    tng += g;\r\n    absSum += Math.abs(g);\r\n    if (!pin || Math.abs(g) > Math.abs(pin.g)) pin = { g, strike: Number(r.strike) };\r\n    if (r.net_vol_gex != null && Number.isFinite(Number(r.net_vol_gex))) {\r\n      volRows++;\r\n      tngOiVol += g + Number(r.net_vol_gex);\r\n    } else {\r\n      tngOiVol += g;\r\n    }\r\n  }\r\n\r\n  // Partial vol coverage is worse than none: it produces a number that is\r\n  // neither basis. Demand most of the ladder before claiming an OI+Vol total.\r\n  const volCovered = rows.length >= MIN_POPULATED_STRIKES\r\n    && volRows / rows.length >= VOL_COVERAGE_MIN;\r\n  if (!volCovered) {\r\n    console.warn(\r\n      `[eod-gex] $SPX ladder ${date}: ` +\r\n      (rows.length < MIN_POPULATED_STRIKES\r\n        ? `only ${rows.length} strikes in the ladder (min ${MIN_POPULATED_STRIKES})`\r\n        : `net_vol_gex on ${volRows}/${rows.length} strikes (need \u2265${(VOL_COVERAGE_MIN * 100).toFixed(0)}%)`) +\r\n      ` \u2014 leaving total_gex_0dte NULL rather than writing an OI-only number as OI+Vol`\r\n    );\r\n  }\r\n\r\n  const spot = Number(rows[0].spot) || 0;",
    "fetchSpxLadder: accumulate OI+Vol total + coverage guard"
  ],
  [
    "\r\n  return {\r\n    totalNetGex: tng,\r\n    totalFlowGex: 0,\r\n    spot,\r\n    pinStrike: pin.strike,",
    "\r\n  return {\r\n    totalNetGex: tng,\r\n    totalNetGex0dte: volCovered ? tngOiVol : null,\r\n    totalFlowGex: 0,\r\n    spot,\r\n    pinStrike: pin.strike,",
    "fetchSpxLadder: return totalNetGex0dte"
  ],
  [
    "\r\nconst EXP_CONCURRENCY = 4;\r\n\r\n// Compute combined net GEX across all expirations except 0DTE for a symbol, from\r\n// the live chain. `spot` is passed in from the front pass so both totals share\r\n// the same underlying price. Returns a number, or null if it can't be trusted.\r\nasync function computeLiveGexEx0dte(symbol, sessionDate, spot) {\r\n  if (!(Number(spot) > 0)) return null;\r\n  const underlying = chainUnderlying(symbol);\r\n  const { contracts, expirations } = await fetchChainTheta(underlying);\r\n  if (!expirations?.length) throw new Error(`no expirations for ${underlying}`);\r\n\r\n  // Every listed expiration that is NOT the 0DTE (session-date) expiry. Past\r\n  // expirations never appear in a live chain, so this is \"0DTE-and-out, minus 0DTE\".\r\n  const exps = expirations.filter((e) => e && e !== sessionDate);\r\n  if (!exps.length) return null; // only a 0DTE listed \u2192 nothing to combine\r\n\r\n  // Greeks + OI + volume per expiration (trio coalesced upstream), flattened.\r\n  const perExp = await mapLimit(exps, EXP_CONCURRENCY, async (exp) => {\r\n    const [greekMap, oiMap, volMap] = await Promise.all([\r\n      fetchGreeksTheta(underlying, exp).catch(() => new Map()),",
    "\r\nconst EXP_CONCURRENCY = 4;\r\n\r\n// Flatten the live chain for `exps` into gex-calculator input rows, each tagged\r\n// with its `expiration` so callers can split 0DTE out without re-fetching.\r\n// Shared by computeLiveGexEx0dte (EOD totals) and computeLiveGexRowsMulti (the\r\n// /proxy/gex-by-strike-multi ladders) so the two can never drift apart.\r\nasync function fetchLiveFlatRows(underlying, exps, contracts) {\r\n  const perExp = await mapLimit(exps, EXP_CONCURRENCY, async (exp) => {\r\n    const [greekMap, oiMap, volMap] = await Promise.all([\r\n      fetchGreeksTheta(underlying, exp).catch(() => new Map()),",
    "fetchLiveFlatRows + populatedCount helpers"
  ],
  [
    "      const gamma = Math.abs(Number(g.gamma ?? 0));\r\n      const delta = Math.abs(Number(g.delta ?? 0));\r\n      if (!(gamma > 0) && !(oi > 0)) continue;\r\n      rows.push({ strike: c.strike, side: c.type === 'C' ? 'call' : 'put', oi, volume: vol, gamma, delta });\r\n    }\r\n    return rows;\r\n  });\r\n\r\n  const flatRows = perExp.flat();\r\n  if (!flatRows.length) throw new Error(`${symbol}: no ex-0DTE option rows`);\r\n\r\n  const gexRows = computeGexRows(flatRows, Number(spot));\r\n  const populated = gexRows.filter(\r\n    (r) => (r.callGamma > 0 || r.putGamma > 0) && (r.callOI > 0 || r.putOI > 0)\r\n  ).length;\r\n  if (populated < MIN_POPULATED_STRIKES) {\r\n    throw new Error(`${symbol}: only ${populated} ex-0DTE populated strikes \u2014 skip`);\r\n  }\r\n  return totalNetGex(gexRows);\r\n}\r\n\r\n// One PM computation of the ex-0DTE total per (date, symbol): the full-chain\r\n// sweep is heavy, and the value barely moves across the 10-minute window, so we\r\n// compute it on the first tick that succeeds and reuse it for later ticks (which",
    "      const gamma = Math.abs(Number(g.gamma ?? 0));\r\n      const delta = Math.abs(Number(g.delta ?? 0));\r\n      if (!(gamma > 0) && !(oi > 0)) continue;\r\n      rows.push({\r\n        strike: c.strike,\r\n        side: c.type === 'C' ? 'call' : 'put',\r\n        oi,\r\n        volume: vol,\r\n        gamma,\r\n        delta,\r\n        expiration: c.expiration,\r\n      });\r\n    }\r\n    return rows;\r\n  });\r\n  return perExp.flat();\r\n}\r\n\r\n// How many strikes of a computed ladder carry both a gamma and some OI \u2014 the\r\n// \"is this data real\" test used by every guard in this file.\r\nfunction populatedCount(gexRows) {\r\n  return gexRows.filter(\r\n    (r) => (r.callGamma > 0 || r.putGamma > 0) && (r.callOI > 0 || r.putOI > 0)\r\n  ).length;\r\n}\r\n\r\n// Compute combined net GEX across all expirations except 0DTE for a symbol, from\r\n// the live chain. `spot` is passed in from the front pass so both totals share\r\n// the same underlying price. Returns a number, or null if it can't be trusted.\r\nasync function computeLiveGexEx0dte(symbol, sessionDate, spot) {\r\n  if (!(Number(spot) > 0)) return null;\r\n  const underlying = chainUnderlying(symbol);\r\n  const { contracts, expirations } = await fetchChainTheta(underlying);\r\n  if (!expirations?.length) throw new Error(`no expirations for ${underlying}`);\r\n\r\n  // Every listed expiration that is NOT the 0DTE (session-date) expiry. Past\r\n  // expirations never appear in a live chain, so this is \"0DTE-and-out, minus 0DTE\".\r\n  const exps = expirations.filter((e) => e && e !== sessionDate);\r\n  if (!exps.length) return null; // only a 0DTE listed \u2192 nothing to combine\r\n\r\n  const flatRows = await fetchLiveFlatRows(underlying, exps, contracts);\r\n  if (!flatRows.length) throw new Error(`${symbol}: no ex-0DTE option rows`);\r\n\r\n  // MULTI-expiry: computeGexRows would keep only the last expiry per strike and\r\n  // understate this total (it did exactly that until the multi-expiry helper\r\n  // existed \u2014 expect this column to step UP the first time it runs after that\r\n  // fix, on the same sessions, without the market having changed).\r\n  const gexRows = computeGexRowsMultiExpiry(flatRows, Number(spot));\r\n  const populated = populatedCount(gexRows);\r\n  if (populated < MIN_POPULATED_STRIKES) {\r\n    throw new Error(`${symbol}: only ${populated} ex-0DTE populated strikes \u2014 skip`);\r\n  }\r\n  return totalNetGex(gexRows);\r\n}\r\n\r\n// \u2500\u2500 Live per-strike ladders across expirations (for the /test net-gamma cards) \u2500\u2500\r\n//\r\n// The GEX Levels tab's original \"Net gamma exposure by strike\" card is fed by\r\n// /proxy/gex, which is ONE expiry (0DTE for SPX). These two ladders are the same\r\n// curve widened to the rest of the board:\r\n//   all     every listed expiration, 0DTE included\r\n//   ex0dte  every listed expiration except the 0DTE one\r\n// Both on the OI+Vol basis via computeGexRows, so they are directly comparable\r\n// to the 0DTE card and to eod_gex.total_gex_0dte / total_gex_ex0dte.\r\n//\r\n// Returned rows are deliberately slim \u2014 { strike, netGEX, netVolGEX } is all the\r\n// client's cumulative curve needs (it sums netGEX + netVolGEX per strike), and a\r\n// full SPX board is ~1500 strikes, so shipping every greek would bloat the\r\n// payload for nothing.\r\nconst MULTI_TTL_MS = Number(process.env.GEX_MULTI_TTL_MS || 60_000);\r\nconst _multiCache = new Map(); // `symbol|sessionDate` -> { at:number, payload:object }\r\n\r\nfunction slimRows(gexRows) {\r\n  return gexRows.map((r) => ({\r\n    strike: r.strike,\r\n    netGEX: Math.round(r.netGEX || 0),\r\n    netVolGEX: Math.round(r.netVolGEX || 0),\r\n  }));\r\n}\r\n\r\nasync function computeLiveGexRowsMulti(symbol, sessionDate, spot) {\r\n  if (!(Number(spot) > 0)) throw new Error(`${symbol}: spot is 0`);\r\n  const underlying = chainUnderlying(symbol);\r\n  const { contracts, expirations } = await fetchChainTheta(underlying);\r\n  if (!expirations?.length) throw new Error(`no expirations for ${underlying}`);\r\n\r\n  const exps = expirations.filter(Boolean);\r\n  const flatRows = await fetchLiveFlatRows(underlying, exps, contracts);\r\n  if (!flatRows.length) throw new Error(`${symbol}: no option rows across ${exps.length} expirations`);\r\n\r\n  // Both ladders span expirations, so both go through the multi-expiry path \u2014\r\n  // per-strike sums across expiries, not last-expiry-wins.\r\n  const allRows = computeGexRowsMultiExpiry(flatRows, Number(spot));\r\n  const populated = populatedCount(allRows);\r\n  if (populated < MIN_POPULATED_STRIKES) {\r\n    throw new Error(`${symbol}: only ${populated} populated strikes across the board \u2014 skip`);\r\n  }\r\n\r\n  const exFlat = flatRows.filter((r) => r.expiration !== sessionDate);\r\n  // A board with nothing but 0DTE listed is possible in principle; emit an empty\r\n  // ex-0DTE ladder rather than pretending it equals `all`.\r\n  const exRows = exFlat.length ? computeGexRowsMultiExpiry(exFlat, Number(spot)) : [];\r\n\r\n  return {\r\n    symbol,\r\n    sessionDate,\r\n    spot: Number(spot),\r\n    expirations: exps,\r\n    expiryCount: exps.length,\r\n    all: {\r\n      rows: slimRows(allRows),\r\n      totalNetGex: totalNetGex(allRows),\r\n      gexFlip: findGexFlip(allRows, Number(spot)),\r\n    },\r\n    ex0dte: {\r\n      rows: slimRows(exRows),\r\n      totalNetGex: exRows.length ? totalNetGex(exRows) : null,\r\n      gexFlip: exRows.length ? findGexFlip(exRows, Number(spot)) : null,\r\n    },\r\n    updatedAt: Date.now(),\r\n  };\r\n}\r\n\r\n// Cached wrapper: the full-board sweep is one upstream call per expiration, so a\r\n// page with two cards open at a 15s poll must not re-run it every tick.\r\nasync function getLiveGexRowsMulti(symbol, sessionDate, spot) {\r\n  const key = `${symbol}|${sessionDate}`;\r\n  const hit = _multiCache.get(key);\r\n  if (hit && Date.now() - hit.at < MULTI_TTL_MS) return { ...hit.payload, cached: true };\r\n  const payload = await computeLiveGexRowsMulti(symbol, sessionDate, spot);\r\n  _multiCache.set(key, { at: Date.now(), payload });\r\n  for (const k of _multiCache.keys()) {\r\n    if (k.split('|')[1] < sessionDate) _multiCache.delete(k);\r\n  }\r\n  return { ...payload, cached: false };\r\n}\r\n\r\n// One PM computation of the ex-0DTE total per (date, symbol): the full-chain\r\n// sweep is heavy, and the value barely moves across the 10-minute window, so we\r\n// compute it on the first tick that succeeds and reuse it for later ticks (which",
    "computeLiveGexRowsMulti + getLiveGexRowsMulti (the endpoint's data source)"
  ],
  [
    "    // matches the session date). Nullable \u2014 a row written before it could be\r\n    // computed (e.g. the chain fetch failed) leaves it NULL, never a bogus 0.\r\n    await p.query(`ALTER TABLE eod_gex ADD COLUMN IF NOT EXISTS total_gex_ex0dte DOUBLE PRECISION`);\r\n    // The 0DTE close collapses onto a small number of strikes, and how small\r\n    // varies enormously session to session (13% of |GEX| on the top strike on\r\n    // 2026-07-17, 86% on 2026-07-22). total_gex alone hides that, so record the",
    "    // matches the session date). Nullable \u2014 a row written before it could be\r\n    // computed (e.g. the chain fetch failed) leaves it NULL, never a bogus 0.\r\n    await p.query(`ALTER TABLE eod_gex ADD COLUMN IF NOT EXISTS total_gex_ex0dte DOUBLE PRECISION`);\r\n    // 0DTE-ONLY net GEX on the OI+Vol basis \u2014 the single-definition sibling of\r\n    // total_gex_ex0dte, and the column the \"SPX EOD GEX by session\" card charts.\r\n    // total_gex is left alone precisely because its basis varies by source (see\r\n    // the COLUMN BASES block at the top of this file); this one never does.\r\n    // Nullable: paths that cannot split 0DTE out (mvc_snapshot) or that predate\r\n    // net_vol_gex in the ladder leave it NULL rather than write the wrong basis.\r\n    await p.query(`ALTER TABLE eod_gex ADD COLUMN IF NOT EXISTS total_gex_0dte DOUBLE PRECISION`);\r\n    // The 0DTE close collapses onto a small number of strikes, and how small\r\n    // varies enormously session to session (13% of |GEX| on the top strike on\r\n    // 2026-07-17, 86% on 2026-07-22). total_gex alone hides that, so record the",
    "ensureColumns: ADD COLUMN total_gex_0dte"
  ],
  [
    "  }\r\n}\r\n\r\n// total_gex_ex0dte is the LAST positional arg (defaults to null) so every\r\n// existing call site stays valid; only callers that have the value pass it.\r\n// COALESCE on update: a later provisional write that couldn't compute ex0dte\r\n// (null) must not wipe a good value already stored for the row.\r\nasync function upsertEodGex(date, symbol, total_gex, total_flow_gex, spot, computed_at, source = 'live', total_gex_ex0dte = null, pin = null) {\r\n  const p = getPool();\r\n  if (!p) { console.warn('[eod-gex] no DB \u2014 skipping write'); return; }\r\n  await ensureColumns(p);\r\n  await p.query(\r\n    `INSERT INTO eod_gex (date, symbol, total_gex, total_flow_gex, spot, computed_at, source, total_gex_ex0dte,\r\n                          pin_strike, pin_net_gex, pin_share)\r\n     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)\r\n     ON CONFLICT (date, symbol) DO UPDATE SET\r\n       total_gex        = EXCLUDED.total_gex,\r\n       total_flow_gex   = EXCLUDED.total_flow_gex,",
    "  }\r\n}\r\n\r\n// New optional args go on the END (defaulting to null) so every existing call\r\n// site stays valid; only callers that have the value pass it. total_gex_0dte is\r\n// therefore arg 10, after `pin`.\r\n// COALESCE on update: a later provisional write that couldn't compute ex0dte or\r\n// 0dte (null) must not wipe a good value already stored for the row.\r\nasync function upsertEodGex(date, symbol, total_gex, total_flow_gex, spot, computed_at, source = 'live', total_gex_ex0dte = null, pin = null, total_gex_0dte = null) {\r\n  const p = getPool();\r\n  if (!p) { console.warn('[eod-gex] no DB \u2014 skipping write'); return; }\r\n  await ensureColumns(p);\r\n  await p.query(\r\n    `INSERT INTO eod_gex (date, symbol, total_gex, total_flow_gex, spot, computed_at, source, total_gex_ex0dte,\r\n                          pin_strike, pin_net_gex, pin_share, total_gex_0dte)\r\n     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)\r\n     ON CONFLICT (date, symbol) DO UPDATE SET\r\n       total_gex        = EXCLUDED.total_gex,\r\n       total_flow_gex   = EXCLUDED.total_flow_gex,",
    "upsertEodGex: accept total_gex_0dte (arg 10)"
  ],
  [
    "       computed_at      = EXCLUDED.computed_at,\r\n       source           = EXCLUDED.source,\r\n       total_gex_ex0dte = COALESCE(EXCLUDED.total_gex_ex0dte, eod_gex.total_gex_ex0dte),\r\n       pin_strike       = COALESCE(EXCLUDED.pin_strike,  eod_gex.pin_strike),\r\n       pin_net_gex      = COALESCE(EXCLUDED.pin_net_gex, eod_gex.pin_net_gex),\r\n       pin_share        = COALESCE(EXCLUDED.pin_share,   eod_gex.pin_share)`,\r\n    [date, symbol, total_gex, total_flow_gex, spot, computed_at, source, total_gex_ex0dte,\r\n     pin?.strike ?? null, pin?.netGex ?? null, pin?.share ?? null]\r\n  );\r\n}\r\n",
    "       computed_at      = EXCLUDED.computed_at,\r\n       source           = EXCLUDED.source,\r\n       total_gex_ex0dte = COALESCE(EXCLUDED.total_gex_ex0dte, eod_gex.total_gex_ex0dte),\r\n       total_gex_0dte   = COALESCE(EXCLUDED.total_gex_0dte,   eod_gex.total_gex_0dte),\r\n       pin_strike       = COALESCE(EXCLUDED.pin_strike,  eod_gex.pin_strike),\r\n       pin_net_gex      = COALESCE(EXCLUDED.pin_net_gex, eod_gex.pin_net_gex),\r\n       pin_share        = COALESCE(EXCLUDED.pin_share,   eod_gex.pin_share)`,\r\n    [date, symbol, total_gex, total_flow_gex, spot, computed_at, source, total_gex_ex0dte,\r\n     pin?.strike ?? null, pin?.netGex ?? null, pin?.share ?? null, total_gex_0dte]\r\n  );\r\n}\r\n",
    "upsertEodGex: COALESCE total_gex_0dte on update"
  ],
  [
    "        ? { strike: result.pinStrike, netGex: result.pinNetGex, share: result.pinShare }\r\n        : null;\r\n\r\n      await upsertEodGex(date, symbol, tng, tfg || 0, spot, computedAt, writeSource, ex0dte, pin);\r\n      saved.push(symbol);\r\n      console.log(\r\n        `[eod-gex] ${symbol} ${date} \u2014 GEX ${tng >= 0 ? '+' : ''}${(tng / 1e9).toFixed(3)}B  flow ${tfg >= 0 ? '+' : ''}${((tfg || 0) / 1e9).toFixed(3)}B  exFrontGEX ${ex0dte == null ? 'n/a' : `${ex0dte >= 0 ? '+' : ''}${(ex0dte / 1e9).toFixed(3)}B`}  spot=${spot.toFixed(2)}` +\r\n        (pin ? `  pin=${pin.strike} (${pin.share.toFixed(0)}% of |GEX|)` : '') +\r\n        `  src=${writeSource}`\r\n      );",
    "        ? { strike: result.pinStrike, netGex: result.pinNetGex, share: result.pinShare }\r\n        : null;\r\n\r\n      // 0DTE-only OI+Vol total. Only the ladder path produces it; the header\r\n      // fallback ('live_state') is a single expiry on an unverified basis, so it\r\n      // stays null and the column keeps whatever the AM pass writes tomorrow.\r\n      const gex0dte = Number.isFinite(result.totalNetGex0dte) ? result.totalNetGex0dte : null;\r\n\r\n      await upsertEodGex(date, symbol, tng, tfg || 0, spot, computedAt, writeSource, ex0dte, pin, gex0dte);\r\n      saved.push(symbol);\r\n      console.log(\r\n        `[eod-gex] ${symbol} ${date} \u2014 GEX ${tng >= 0 ? '+' : ''}${(tng / 1e9).toFixed(3)}B  flow ${tfg >= 0 ? '+' : ''}${((tfg || 0) / 1e9).toFixed(3)}B  exFrontGEX ${ex0dte == null ? 'n/a' : `${ex0dte >= 0 ? '+' : ''}${(ex0dte / 1e9).toFixed(3)}B`}  0dteOiVol ${gex0dte == null ? 'n/a' : `${gex0dte >= 0 ? '+' : ''}${(gex0dte / 1e9).toFixed(3)}B`}  spot=${spot.toFixed(2)}` +\r\n        (pin ? `  pin=${pin.strike} (${pin.share.toFixed(0)}% of |GEX|)` : '') +\r\n        `  src=${writeSource}`\r\n      );",
    "PM pass: write the 0DTE OI+Vol total + log it"
  ],
  [
    "\r\n  if (!flatRows.length) throw new Error(`${symbol}: no historical rows for ${date}`);\r\n\r\n  const gexRows = computeGexRows(flatRows, Number(spot));\r\n  const populated = gexRows.filter(\r\n    (r) => (r.callGamma > 0 || r.putGamma > 0) && (r.callOI > 0 || r.putOI > 0)\r\n  ).length;\r\n  if (populated < MIN_POPULATED_STRIKES) {\r\n    throw new Error(`${symbol}: only ${populated} populated strikes for ${date} \u2014 skip`);\r\n  }",
    "\r\n  if (!flatRows.length) throw new Error(`${symbol}: no historical rows for ${date}`);\r\n\r\n  // oiMap spans the WHOLE settled chain (strikeRange 500, every expiration), so\r\n  // this must be the multi-expiry aggregation. With plain computeGexRows every\r\n  // strike kept only its last-seen expiry, which understated the settled total\r\n  // and every wall/flip derived from these rows (the gex_levels_history catch-up\r\n  // reads this same ladder).\r\n  const gexRows = computeGexRowsMultiExpiry(flatRows, Number(spot));\r\n  const populated = populatedCount(gexRows);\r\n  if (populated < MIN_POPULATED_STRIKES) {\r\n    throw new Error(`${symbol}: only ${populated} populated strikes for ${date} \u2014 skip`);\r\n  }",
    "computeHistoricalGexRows: use the multi-expiry aggregator"
  ],
  [
    "function ex0dteTotalFromFlatRows(flatRows, spot, date) {\r\n  const ex = flatRows.filter((r) => r.expiration !== date);\r\n  if (!ex.length) return null;\r\n  return totalNetGex(computeGexRows(ex, Number(spot)));\r\n}\r\n\r\n// Back-compat wrapper: EOD callers only need the total(s) + spot.",
    "function ex0dteTotalFromFlatRows(flatRows, spot, date) {\r\n  const ex = flatRows.filter((r) => r.expiration !== date);\r\n  if (!ex.length) return null;\r\n  return totalNetGex(computeGexRowsMultiExpiry(ex, Number(spot)));\r\n}\r\n\r\n// Mirror of the above for the 0DTE expiry ALONE (expiration === the session\r\n// date). Same OI+Vol basis, so ex0dte + 0dte reconstructs the whole-chain total\r\n// that computeHistoricalGexRows returns. Null when the settled history had no\r\n// 0DTE rows for the date (a holiday-shortened board, or a Theta gap).\r\nfunction zeroDteTotalFromFlatRows(flatRows, spot, date) {\r\n  const z = flatRows.filter((r) => r.expiration === date);\r\n  if (!z.length) return null;\r\n  // One expiry by construction, so the multi-expiry helper is a no-op here \u2014\r\n  // used anyway so this and its ex-0DTE sibling stay provably the same math.\r\n  return totalNetGex(computeGexRowsMultiExpiry(z, Number(spot)));\r\n}\r\n\r\n// Back-compat wrapper: EOD callers only need the total(s) + spot.",
    "ex0dteTotalFromFlatRows: multi-expiry aggregation"
  ],
  [
    "  return {\r\n    totalNetGex: totalNetGex(gexRows),\r\n    totalNetGexEx0dte: ex0dteTotalFromFlatRows(flatRows, spot, date),\r\n    spot,\r\n  };\r\n}",
    "  return {\r\n    totalNetGex: totalNetGex(gexRows),\r\n    totalNetGexEx0dte: ex0dteTotalFromFlatRows(flatRows, spot, date),\r\n    totalNetGex0dte: zeroDteTotalFromFlatRows(flatRows, spot, date),\r\n    spot,\r\n  };\r\n}",
    "zeroDteTotalFromFlatRows + computeHistoricalEodGex returns it"
  ],
  [
    "    if (st.baked) { done.push(`${symbol}(baked)`); continue; }\r\n\r\n    try {\r\n      const { totalNetGex: tng, totalNetGexEx0dte: ex0dte, spot } = await computeHistoricalEodGex(symbol, date);\r\n      if (!Number.isFinite(tng) || !(spot > 0)) {\r\n        console.warn(`[eod-gex/am] ${symbol} ${date}: invalid tng=${tng} spot=${spot} \u2014 skip`);\r\n        continue;",
    "    if (st.baked) { done.push(`${symbol}(baked)`); continue; }\r\n\r\n    try {\r\n      const { totalNetGex: tng, totalNetGexEx0dte: ex0dte, totalNetGex0dte: gex0dte, spot } = await computeHistoricalEodGex(symbol, date);\r\n      if (!Number.isFinite(tng) || !(spot > 0)) {\r\n        console.warn(`[eod-gex/am] ${symbol} ${date}: invalid tng=${tng} spot=${spot} \u2014 skip`);\r\n        continue;",
    "AM settled pass: destructure totalNetGex0dte"
  ],
  [
    "      // NOTE: this used to be upsertEodGex(date, symbol, tng, spot, computedAt) \u2014\r\n      // 5 args into a 6-arg signature, so `spot` landed in total_flow_gex and\r\n      // computedAt in spot. The settled pass has no flow GEX (history has no\r\n      // dealer inventory), so pass 0 explicitly. ex0dte = settled all-exp-ex-0DTE.\r\n      await upsertEodGex(date, symbol, tng, 0, spot, computedAt, 'theta', ex0dte);\r\n\r\n      // Bake-in: at/after 09:30, if unchanged from the previous poll, freeze it.\r\n      const unchanged = st.last != null && Math.abs(st.last - tng) < 1; // ~$1 of GEX",
    "      // NOTE: this used to be upsertEodGex(date, symbol, tng, spot, computedAt) \u2014\r\n      // 5 args into a 6-arg signature, so `spot` landed in total_flow_gex and\r\n      // computedAt in spot. The settled pass has no flow GEX (history has no\r\n      // dealer inventory), so pass 0 explicitly. ex0dte = settled all-exp-ex-0DTE,\r\n      // gex0dte = settled 0DTE-only \u2014 this pass overwrites the PM row's\r\n      // provisional-OI 0DTE value with the settled one, which is the point.\r\n      await upsertEodGex(date, symbol, tng, 0, spot, computedAt, 'theta', ex0dte, null, gex0dte);\r\n\r\n      // Bake-in: at/after 09:30, if unchanged from the previous poll, freeze it.\r\n      const unchanged = st.last != null && Math.abs(st.last - tng) < 1; // ~$1 of GEX",
    "AM settled pass: pass it to upsertEodGex"
  ],
  [
    "\r\n      // 1) Theta history (settled OI) \u2014 the real fix.\r\n      try {\r\n        const { totalNetGex: tng, totalNetGexEx0dte: ex0dte, spot } = await computeHistoricalEodGex(symbol, date);\r\n        if (Number.isFinite(tng) && spot > 0) {\r\n          await upsertEodGex(date, symbol, tng, 0, spot, computedAt, 'theta', ex0dte);\r\n          filled.push(`${symbol}:${date}(theta)`);\r\n          console.log(`[eod-gex/catchup] ${symbol} ${date} \u2014 theta  GEX ${tng >= 0 ? '+' : ''}${(tng / 1e9).toFixed(3)}B  spot=${spot.toFixed(2)}`);\r\n          continue;",
    "\r\n      // 1) Theta history (settled OI) \u2014 the real fix.\r\n      try {\r\n        const { totalNetGex: tng, totalNetGexEx0dte: ex0dte, totalNetGex0dte: gex0dte, spot } = await computeHistoricalEodGex(symbol, date);\r\n        if (Number.isFinite(tng) && spot > 0) {\r\n          await upsertEodGex(date, symbol, tng, 0, spot, computedAt, 'theta', ex0dte, null, gex0dte);\r\n          filled.push(`${symbol}:${date}(theta)`);\r\n          console.log(`[eod-gex/catchup] ${symbol} ${date} \u2014 theta  GEX ${tng >= 0 ? '+' : ''}${(tng / 1e9).toFixed(3)}B  spot=${spot.toFixed(2)}`);\r\n          continue;",
    "catch-up pass: compute + write the 0DTE total"
  ],
  [
    "  computeHistoricalGexRows,\r\n  catchUpMissing,\r\n  missingDates,\r\n};",
    "  computeHistoricalGexRows,\r\n  catchUpMissing,\r\n  missingDates,\r\n  // Live per-strike ladders across expirations \u2014 served by\r\n  // GET /proxy/gex-by-strike-multi (see server-with-proxy.js).\r\n  getLiveGexRowsMulti,\r\n  computeLiveGexRowsMulti,\r\n};",
    "module.exports: getLiveGexRowsMulti / computeLiveGexRowsMulti"
  ]
];

if (!existsSync(TARGET)) {
  console.error(`not found: ${TARGET}  (run this from the repo root, or pass --file)`);
  process.exit(2);
}

const original = readFileSync(TARGET, 'utf8');
let src = original;
const applied = [], already = [], missing = [];

for (const [anchor, replacement, label] of EDITS) {
  const hits = src.split(anchor).length - 1;
  if (hits === 1) {
    src = src.replace(anchor, replacement);
    applied.push(label);
  } else if (hits === 0 && src.includes(replacement)) {
    already.push(label);                       // idempotent re-run
  } else {
    missing.push({ label, hits });
  }
}

const w = (s) => process.stdout.write(s + '\n');
w('');
w(`${TARGET}`);
w(`  applied  ${applied.length}`);
w(`  already  ${already.length}`);
w(`  missing  ${missing.length}`);
for (const a of applied) w(`    + ${a}`);
for (const a of already) w(`    = ${a} (already present)`);
for (const m of missing) w(`    ! ${m.label} — anchor found ${m.hits}x, expected 1`);

if (missing.length) {
  w('');
  w('NOTHING WRITTEN. An anchor above did not resolve, which means that exact');
  w('block of the file changed. Fix by hand, or send me `git diff -- ' + TARGET + '`');
  w('and I will rebuild the edit against your current version.');
  process.exit(1);
}

if (!applied.length) {
  w('');
  w('All edits already present — nothing to do.');
  process.exit(0);
}

if (dry) {
  w('');
  w(`--dry: ${applied.length} edit(s) would be applied, nothing written.`);
  process.exit(0);
}

copyFileSync(TARGET, TARGET + '.bak');
writeFileSync(TARGET, src);
w('');
w(`Wrote ${TARGET}  (backup at ${TARGET}.bak)`);
w(`${original.length} -> ${src.length} bytes`);
