'use strict';
/**
 * server-v2/state/flow-watchdog.js
 *
 * Detects the "stuck but listening" theta-terminal failure mode (see memory
 * theta-stale-entitlement-restart / theta-spot0-chartgate-deadlock): the WS
 * stays open and `connected`, but theta-terminal itself has wedged and stops
 * producing real trade prints. Nothing closes, so ThetaStreamClient's own
 * close/error reconnect never fires and the /flow tape just silently flatlines
 * until someone notices on the chart — which is the whole reason this exists:
 * Brandon isn't always watching the chart.
 *
 * Polls `thetaStream.lastSpxOtmTradeAt` (bumped on every SPXW OTM print — the
 * flow that actually drives the /flow chart), falling back to `lastTradeAt`
 * until the first SPX OTM print. Watching the chart-scoped signal catches a
 * PARTIAL dry-up, not just a total stall. Two-stage response during RTH:
 *   1. Stale >90s  → soft fix: force-cycle the socket (thetaStream.forceReconnect()).
 *      Usually enough if it was just a transient WS-level hiccup.
 *   2. Still stale >3min after that → theta-terminal itself is likely wedged
 *      (a socket cycle can't fix a stuck JVM process) → fire an ops alert
 *      (email + push, rate-limited) telling Brandon to `docker restart
 *      theta-terminal` on the VPS.
 */

const { sendAlert } = require('./alerts');

const CHECK_INTERVAL_MS = 30_000;
const SOFT_RECONNECT_AFTER_MS = 90_000;
const ALERT_AFTER_MS = 3 * 60_000;

function etParts(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(now);
  const get = (t) => p.find((x) => x.type === t)?.value;
  const wmap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: wmap[get('weekday')] ?? -1 };
}

// RTH-ish window with slack on both ends (9:25–16:05 ET, weekdays) — matches
// when a "no trades in 90s" gap is actually suspicious instead of just quiet.
function isMarketHours(now = new Date()) {
  const { hour, minute, weekday } = etParts(now);
  if (weekday === 0 || weekday === 6) return false;
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 25 && mins <= 16 * 60 + 5;
}

let started = false;
let softReconnectedAt = 0;

/**
 * Start polling. Safe to call more than once — only the first call arms the
 * interval (mirrors the `if (!this.thetaStream)` guard at the call site).
 * @param {{lastTradeAt:number, forceReconnect:() => void}} thetaStream
 */
function startFlowWatchdog(thetaStream) {
  if (started) return;
  started = true;
  setInterval(() => {
    try {
      if (!isMarketHours()) return;
      // Prefer the chart-scoped SPX-OTM liveness signal (bumped in proxy-thetadata
      // on every SPXW OTM print) so a PARTIAL dry-up is caught — not just a total
      // stall. `lastTradeAt` is bumped by ANY kept root/contract, so it stays
      // fresh even when the SPX OTM prints that drive the /flow chart have stopped.
      // Falls back to lastTradeAt until the first SPX OTM print of the session.
      const last = thetaStream.lastSpxOtmTradeAt || thetaStream.lastTradeAt || 0;
      const age = last ? Date.now() - last : Infinity;
      if (age < SOFT_RECONNECT_AFTER_MS) return; // healthy

      if (age < ALERT_AFTER_MS) {
        // In the soft-reconnect window — try once, then wait for the alert
        // threshold rather than terminating the socket every 30s.
        if (Date.now() - softReconnectedAt > SOFT_RECONNECT_AFTER_MS) {
          softReconnectedAt = Date.now();
          thetaStream.forceReconnect();
        }
        return;
      }

      // Past the alert threshold — a socket cycle alone hasn't recovered it.
      const ageMin = Math.round(age / 60000);
      sendAlert({
        key: 'flow-stale',
        subject: 'CB Edge: flow feed stale',
        message: `No SPX OTM option trade prints for ~${ageMin} min during market hours. `
          + `Socket cycling didn't recover it — theta-terminal is likely wedged. `
          + `SSH in and run: docker restart theta-terminal`,
      }).catch(() => {});
    } catch (e) {
      console.warn('[flow-watchdog] check failed:', e?.message || e);
    }
  }, CHECK_INTERVAL_MS).unref?.();
}

module.exports = { startFlowWatchdog };
