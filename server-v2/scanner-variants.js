'use strict';
/**
 * server-v2/scanner-variants.js
 *
 * THE FOUR LEVEL VARIANTS the scanner family records, and the one definition of
 * what "the default" means. A plain data module — no pg, no fetch, no side
 * effects — so scanner-recorder, walls-recorder and the HTTP layer can all agree
 * on the same four keys without importing each other.
 *
 * TWO AXES, both of which change WHICH strike wins:
 *
 *   expiry_scope
 *     '0dte'  the nearest listed contract, `chain.expirations[0]`. What every
 *             level on this page has always been. For SPX/SPY/QQQ that is the
 *             same-day contract; for a single name it is the front weekly.
 *     'agg'   every OTHER listed expiration, summed per strike. "All
 *             expirations minus 0DTE" — the board without today's contract
 *             dominating it. Bounded by AGG_MAX_EXPIRIES / AGG_MAX_DTE below,
 *             because "all" on a name with 20 listed expiries is 20 upstream
 *             chain calls per ticker per sweep and the sweep runs every minute.
 *
 *   basis
 *     'oivol' netGEX + netVolGEX — open interest AND the day's volume. The
 *             historical default and what the dashboard chart / heatmap / MVC
 *             read, so the default variant must stay on it.
 *     'vol'   netVolGEX alone — only what traded today. Same gamma weighting,
 *             no book. Reads as "where is today's flow building", and it moves
 *             a great deal faster than the OI term.
 *
 * THE DEFAULT VARIANT IS LOAD-BEARING. `0dte` + `oivol` is what
 * scanner_snapshots has always held and what walls-reach, /proxy/scanner,
 * /proxy/walls-watch and the forward recorder all assume. It keeps its own
 * table and its own unqualified rows; the other three are additive and live
 * beside it. Nothing that existed before this module reads a non-default row
 * unless it asks for one by name.
 */

const EXPIRY_SCOPES = ['0dte', 'agg'];
const BASES = ['oivol', 'vol'];

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
  agg: 'All expirations minus 0DTE',
};
const BASIS_LABEL = {
  oivol: 'OI + Volume GEX',
  vol: 'Volume-only GEX',
};

// ── Aggregate-leg bounds ─────────────────────────────────────────────────────
// "All expirations minus 0DTE" is bounded on purpose. Each extra expiration is
// one more whole-chain fetch per ticker per sweep, and the sweep now runs every
// minute across ~168 roots. Four expirations inside 45 days covers the front
// weeklies plus the monthly, which is where essentially all of the non-0DTE
// gamma sits; going deeper buys thinner and thinner strikes at linear cost.
const AGG_MAX_EXPIRIES = Number(process.env.SCANNER_AGG_MAX_EXPIRIES || 4);
const AGG_MAX_DTE = Number(process.env.SCANNER_AGG_MAX_DTE || 45);
/**
 * Run the aggregate leg only every Nth sweep. The 0DTE contract genuinely does
 * move minute to minute; a 30-day board moves on open interest, which updates
 * once a day. Default 5 keeps the non-0DTE variants on their old 5-minute
 * cadence while 0DTE goes to 1m.
 */
const AGG_EVERY_N_SWEEPS = Math.max(1, Number(process.env.SCANNER_AGG_EVERY_N_SWEEPS || 5));

/** Master switch — '0' writes the legacy default row only. */
const VARIANTS_ENABLED = String(process.env.SCANNER_VARIANTS_ENABLED ?? '1') !== '0';

module.exports = {
  EXPIRY_SCOPES, BASES, VARIANTS,
  DEFAULT_SCOPE, DEFAULT_BASIS, isDefault, normalize,
  SCOPE_LABEL, BASIS_LABEL,
  AGG_MAX_EXPIRIES, AGG_MAX_DTE, AGG_EVERY_N_SWEEPS, VARIANTS_ENABLED,
};
