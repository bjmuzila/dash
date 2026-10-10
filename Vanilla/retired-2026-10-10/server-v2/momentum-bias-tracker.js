'use strict';
/**
 * server-v2/momentum-bias-tracker.js
 *
 * Grades pending Momentum Bias TP/reversal signals by follow-through. Recording
 * happens inline in the feed (proxy-tastytrade _flushEsCandles records CLOSED
 * bars); this tracker only runs the grader — one small SELECT plus a per-row
 * UPDATE — every 5 minutes. A signal stays 'pending' until FOLLOW_BARS closed
 * bars exist after it, so end-of-session signals grade on the next session.
 *
 * Start from server-with-proxy.js after server.listen():
 *   require('./momentum-bias-tracker').startMomentumBiasGrader();
 */

const { gradePendingSignals } = require('./state/momentum-bias-writer');

const INTERVAL_MS = 5 * 60 * 1000;

function startMomentumBiasGrader() {
  console.log('[momentum-bias] grader enabled — grades pending TP signals every 5m by follow-through');
  const run = async () => {
    try {
      const n = await gradePendingSignals();
      if (n) console.log(`[momentum-bias] graded ${n} signal(s)`);
    } catch (e) {
      console.warn('[momentum-bias] grade tick error:', e.message);
    }
  };
  // Startup probe ~45s after boot (let the candle feed + DB warm), then on a
  // 5-minute cadence.
  const boot = setTimeout(run, 45_000);
  const timer = setInterval(run, INTERVAL_MS);
  return () => { clearTimeout(boot); clearInterval(timer); };
}

module.exports = { startMomentumBiasGrader };
