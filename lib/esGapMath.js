'use strict';
// Pure ES-gap math — no DB, no Next, no side effects. Plain JS so the server-v2
// cron (CommonJS, no TS at runtime) can require() it, while the TS UI + the unit
// test import it through the lib/esGapMath.ts re-export. One source of truth, so
// the tested logic IS the shipped logic. See lib/db.ts es_gap for column meaning.

/**
 * @param {number} gapPts
 * @returns {'up'|'down'|'flat'}
 */
function gapDir(gapPts) {
  return gapPts > 0 ? 'up' : gapPts < 0 ? 'down' : 'flat';
}

/**
 * Continuous fill of an overnight gap.
 *   priorClose — yesterday's 16:00 print
 *   open0930   — today's 09:30 print
 *   extreme    — furthest price toward priorClose since the open
 *                (session LOW for a gap up, session HIGH for a gap down)
 * A flat gap counts as already 100% filled.
 * @returns {{ pct: number, filled: boolean }}
 */
function computeGapFill(priorClose, open0930, extreme) {
  const gapAbs = Math.abs(open0930 - priorClose);
  if (!(gapAbs > 0)) return { pct: 100, filled: true };

  const gapUp = open0930 > priorClose;
  const traveled = gapUp ? open0930 - extreme : extreme - open0930;
  const pct = Math.max(0, Math.min(100, (traveled / gapAbs) * 100));
  const filled = pct >= 100 - 1e-9;
  return { pct, filled };
}

/**
 * The extreme so far toward the close, given the post-open session high/low.
 * @returns {number}
 */
function extremeToward(open0930, priorClose, sessionLow, sessionHigh) {
  return open0930 > priorClose ? sessionLow : sessionHigh;
}

module.exports = { gapDir, computeGapFill, extremeToward };
