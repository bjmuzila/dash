'use strict';
/**
 * server-v2/voltick-levels.js
 *
 * VOLTICK LEVELS — Volt ★ · Surge ↯ · Reversal ↘ · Coil ◆ — server side.
 *
 * A line-for-line port of cbedge-v3/src/data/voltickLevels.ts `voltickMarks()`
 * (itself the Discord bot's voltickFromBooks() in mg-ladder-discord.js), so the
 * recorder, the GEX Candles card and the owner-dash post all name the same
 * strikes off the same book. Pure: no pg, no fetch, no side effects.
 *
 *   book = OI + today's volume net GEX   (Volt / Reversal / Coil)
 *   vol  = volume-only net GEX           (Surge)
 *
 * `always: true` is the candles card's rule — every level resolves to a strike
 * whenever the ladder has any — and it is what the walls recorder uses, so the
 * Level Log always has four lines to draw.
 */

const REV_WEIGHT = 0.18;

const EMPTY = { volt: null, surge: null, reversal: null, coil: null, coils: [] };

/**
 * @param {{strike:number, book:number, vol:number}[]} input
 * @param {{always?: boolean}} [opts]
 */
function voltickMarks(input, opts = {}) {
  const rows = (input || [])
    .filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.book) && Number.isFinite(r.vol))
    .slice()
    .sort((a, b) => a.strike - b.strike);
  if (!rows.length) return { ...EMPTY, coils: [] };

  let volt = null;
  let voltAbs = 0;
  for (const r of rows) {
    const a = Math.abs(r.book);
    if (a > voltAbs) { voltAbs = a; volt = r; }
  }
  const voltSign = volt ? Math.sign(volt.book) : 0;

  let step = Infinity;
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i].strike - rows[i - 1].strike;
    if (d > 0 && d < step) step = d;
  }
  const clusterWin = (step === Infinity ? 1 : step) * 2.5;

  let reversal = null;
  let revBest = -Infinity;
  for (const r of rows) {
    if (voltSign === 0 || Math.sign(r.book) !== -voltSign) continue;
    const size = Math.abs(r.book);
    if (size < 0.05 * voltAbs) continue;
    let cluster = 0;
    for (const r2 of rows) {
      if (r2 !== r && Math.abs(r2.strike - r.strike) <= clusterWin
          && Math.sign(r2.book) === -voltSign && Math.abs(r2.book) >= 0.4 * size) cluster++;
    }
    const score = size * (1 + REV_WEIGHT * Math.min(cluster, 3));
    if (score > revBest) { revBest = score; reversal = r; }
  }

  const coils = rows
    .filter((r) => volt && r !== volt && r !== reversal && voltAbs > 0 && Math.abs(r.book) >= 0.5 * voltAbs)
    .sort((a, b) => Math.abs(b.book) - Math.abs(a.book))
    .slice(0, 5)
    .map((r) => r.strike);

  let surge = null;
  let surgeAbs = 0;
  for (const r of rows) {
    const a = Math.abs(r.vol);
    if (a > surgeAbs) { surgeAbs = a; surge = r; }
  }

  if (opts.always && volt) {
    const byAbs = rows.slice().sort((a, b) => Math.abs(b.book) - Math.abs(a.book));
    if (!reversal) {
      reversal = byAbs.find((r) => r !== volt && voltSign !== 0 && Math.sign(r.book) === -voltSign)
        ?? byAbs.find((r) => r !== volt && r.book !== 0)
        ?? null;
    }
    if (!surge) surge = volt;
    const revStrike = reversal?.strike;
    for (let i = coils.length - 1; i >= 0; i--) if (coils[i] === revStrike) coils.splice(i, 1);
    if (!coils.length) {
      const c = byAbs.find((r) => r !== volt && r !== reversal && r !== surge && r.book !== 0);
      if (c) coils.push(c.strike);
    }
  }

  return {
    volt: volt?.strike ?? null,
    surge: surge?.strike ?? null,
    reversal: reversal?.strike ?? null,
    coil: coils[0] ?? null,
    coils,
  };
}

/** The four level_type keys, in draw / priority order. */
const VT_LEVEL_TYPES = ['volt', 'surge', 'reversal', 'coil'];

module.exports = { voltickMarks, VT_LEVEL_TYPES };
