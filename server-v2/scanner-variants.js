'use strict';
/**
 * server-v2/scanner-variants.js
 *
 * THE SIX LEVEL VARIANTS (two scopes × three bases) the scanner family records, and the one definition of
 * what "the default" means. A plain data module — no pg, no fetch, no side
 * effects — so scanner-recorder, walls-recorder and the HTTP layer can all agree
 * on the same keys without importing each other.
 *
 * TWO AXES, both of which change WHICH strike wins:
 *
 *   expiry_scope
 *     '0dte'  the nearest listed contract, `chain.expirations[0]`. What every
 *             level on this page has always been. For SPX/SPY/QQQ that is the
 *             same-day contract; for a single name it is the front weekly.
 *     'agg'   every listed expiration AFTER TODAY, summed per strike, with no
 *             cap (2026-10-09, Brandon: Non-0DTE must be what the Options Chain's
 *             ⅀ Total and Analysis → Ticker Lookup's right pane show). The same
 *             set those pages read: `expiration > today (ET)`, so a single name
 *             whose front weekly is not today keeps it here, as they do. Until
 *             then it was the next 4 expiries inside 45 DTE (AGG_MAX_EXPIRIES /
 *             AGG_MAX_DTE, still there as optional env caps, 0 = none). Too many
 *             chain calls for the 1-minute sweep, so it runs on its OWN loop
 *             (scanner-recorder runAggSweep, AGG_INTERVAL_MINS).
 *
 *   basis
 *     'oivol' netGEX + netVolGEX — open interest AND the day's volume. The
 *             historical default and what the dashboard chart / heatmap / MVC
 *             read, so the default variant must stay on it.
 *     'vol'   netVolGEX alone — only what traded today. Same gamma weighting,
 *             no book. Reads as "where is today's flow building", and it moves
 *             a great deal faster than the OI term.
 *     'oi'    netGEX alone — open interest only, the gamma already on the book.
 *             Added 2026-10-07 for Vela's one GEX switch (OI only / OI + Vol /
 *             Vol only). Free like the others: the same rows ranked on another
 *             metric. Recorded from the day it shipped; there is no OI-only
 *             history before that.
 *
 * THE DEFAULT VARIANT IS LOAD-BEARING. `0dte` + `oivol` is what
 * scanner_snapshots has always held and what walls-reach, /proxy/scanner,
 * /proxy/walls-watch and the forward recorder all assume. It keeps its own
 * table and its own unqualified rows; the other three are additive and live
 * beside it. Nothing that existed before this module reads a non-default row
 * unless it asks for one by name.
 */

const EXPIRY_SCOPES = ['0dte', 'agg'];
const BASES = ['oivol', 'vol', 'oi'];

const DEFAULT_SCOPE = '0dte';
const DEFAULT_BASIS = 'oivol';

/** Every combination, default first. Iteration order is the write order. */
const VARIANTS = [];
for (const scope of EXPIRY_SCOPES) {
  for (const basis of BASES) VARIANTS.push({ scope, basis, key: `${scope}|${basis}` });
}
VARIANTS.sort((a, b) => (isDefault(a) ? -1 : isDefault(b) ? 1 : a.key.localeCompare(b.key)));

function isDefault(v) {
  return v?.scope === DEFAULT_SCOPE && v?.basis === DEFAULT_BASIS;
}

/** Normalise anything a query string can carry into a real variant. */
function normalize(scope, basis) {
  const s = EXPIRY_SCOPES.includes(String(scope)) ? String(scope) : DEFAULT_SCOPE;
  const b = BASES.includes(String(basis)) ? String(basis) : DEFAULT_BASIS;
  return { scope: s, basis: b, key: `${s}|${b}` };
}

/** Human label, for logs and for the client's switcher tooltips. */
const SCOPE_LABEL = {
  '0dte': 'Nearest expiry (0DTE)',
  agg: 'All expirations after today (Non-0DTE)',
};
const BASIS_LABEL = {
  oivol: 'OI + Volume GEX',
  vol: 'Volume-only GEX',
  oi: 'OI-only GEX',
};

// ── Aggregate leg ────────────────────────────────────────────────────────────
// THE WHOLE BOARD MINUS TODAY, uncapped by default (header). Each expiration is
// one TastyTrade by-type fetch (tt-snapshot coalesces OI, volume and greeks into
// it), so a pass over ~168 roots is a couple of thousand fetches: far too many for
// the 1-minute 0DTE sweep. It runs on its own loop instead (runAggSweep):
//   AGG_INTERVAL_MINS  how often a pass STARTS (a pass still running is not
//                      overlapped; the next tick is skipped)
//   AGG_CONCURRENCY    roots fetched at once inside a pass
// walls-recorder accepts an agg sample up to WALLS_AGG_SAMPLE_AGE_MINS (40) old,
// so a pass must finish inside that to land on every 15-minute slot.
// The caps are opt-in brakes for a bad day upstream: 0 = no cap.
const AGG_MAX_EXPIRIES = Number(process.env.SCANNER_AGG_MAX_EXPIRIES || 0);
const AGG_MAX_DTE = Number(process.env.SCANNER_AGG_MAX_DTE || 0);
const AGG_INTERVAL_MINS = Math.max(1, Number(process.env.SCANNER_AGG_INTERVAL_MINS || 5));
const AGG_CONCURRENCY = Math.max(1, Number(process.env.SCANNER_AGG_CONCURRENCY || 3));
/** No longer read (the agg leg left the main sweep); kept so an old env or import does not break. */
const AGG_EVERY_N_SWEEPS = Math.max(1, Number(process.env.SCANNER_AGG_EVERY_N_SWEEPS || 5));

/** Master switch — '0' writes the legacy default row only. */
const VARIANTS_ENABLED = String(process.env.SCANNER_VARIANTS_ENABLED ?? '1') !== '0';

module.exports = {
  EXPIRY_SCOPES, BASES, VARIANTS,
  DEFAULT_SCOPE, DEFAULT_BASIS, isDefault, normalize,
  SCOPE_LABEL, BASIS_LABEL,
  AGG_MAX_EXPIRIES, AGG_MAX_DTE, AGG_INTERVAL_MINS, AGG_CONCURRENCY, AGG_EVERY_N_SWEEPS, VARIANTS_ENABLED,
};
