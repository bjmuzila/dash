'use strict';
/**
 * server-v2/state/flow-watchdog.js
 *
 * Detects the "stuck but listening" theta-terminal failure mode (see memory
 * theta-stale-entitlement-restart / theta-spot0-chartgate-deadlock): the WS
 * stays open and `connected`, but theta-terminal itself has wedged and stops
 * producing real trade prints. Nothing closes, so ThetaStreamClient's own
 * close/error reconnect never fires and the /flow tape just silently flatlines.
 *
 * Polls `thetaStream.lastSpxOtmTradeAt` (bumped on every SPXW OTM print — the
 * flow that actually drives the /flow chart), falling back to `lastTradeAt`.
 * Three-stage response during RTH:
 *   1. Stale >90s  → soft fix: force-cycle the socket (thetaStream.forceReconnect()).
 *   2. Still stale >3min → theta-terminal itself is wedged (a socket cycle can't
 *      fix a stuck JVM) → AUTO `docker restart theta-terminal` via the
 *      docker-proxy sidecar (state/theta-restart.js). Brandon was getting the
 *      "SSH in and run: docker restart theta-terminal" email several times a
 *      session; the remedy never varies, so the box now runs it itself.
 *   3. Only page a human when self-heal is exhausted: the restart call failed,
 *      or the daily restart cap is hit, or the feed is STILL dead >6min after a
 *      restart (something worse than a wedge — entitlement, upstream outage).
 *
 * Staleness is measured against max(last print, today's open) so the first
 * minutes of the session aren't judged against yesterday's last print — that
 * was the bug behind the pre-open alerts and the "~Infinity min" email (last===0
 * → age Infinity → instant page).
 */

const { sendAlert } = require('./alerts');
const { restartThetaTerminal, MAX_PER_DAY } = require('./theta-restart');

const CHECK_INTERVAL_MS = 30_000;
const SOFT_RECONNECT_AFTER_MS = 90_000;
const RESTART_AFTER_MS = 3 * 60_000;
const ESCALATE_AFTER_RESTART_MS = 6 * 60_000; // restart happened and it's still dead

const OPEN_MINS = 9 * 60 + 30;
const WATCH_START_MINS = 9 * 60 + 35; // 5 min of grace after the bell before anything is "stale"
const WATCH_END_MINS = 16 * 60 + 5;

function etParts(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(now);
  const get = (t) => p.find((x) => x.type === t)?.value;
  const wmap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: wmap[get('weekday')] ?? -1 };
}

// Minutes into the ET day, or null outside the weekday watch window.
function watchMins(now = new Date()) {
  const { hour, minute, weekday } = etParts(now);
  if (weekday === 0 || weekday === 6) return null;
  const mins = hour * 60 + minute;
  if (mins < WATCH_START_MINS || mins > WATCH_END_MINS) return null;
  return mins;
}

let started = false;
let softReconnectedAt = 0;
let restartedAt = 0;

/**
 * Start polling. Safe to call more than once — only the first call arms the interval.
 * @param {{lastTradeAt:number, lastSpxOtmTradeAt:number, forceReconnect:() => void}} thetaStream
 */
function startFlowWatchdog(thetaStream) {
  if (started) return;
  started = true;
  setInterval(async () => {
    try {
      const mins = watchMins();
      if (mins == null) return;

      const last = thetaStream.lastSpxOtmTradeAt || thetaStream.lastTradeAt || 0;
      // Never blame the feed for time before today's open (or for a session that
      // simply hasn't printed yet) — cap the age at "minutes since the bell".
      const sinceOpenMs = (mins - OPEN_MINS) * 60_000;
      const age = Math.min(last ? Date.now() - last : Infinity, sinceOpenMs);
      if (age < SOFT_RECONNECT_AFTER_MS) return; // healthy

      const ageMin = Math.round(age / 60000);

      // Stage 3 — a restart already happened and the feed is still dead. Nothing
      // automatic is left to try; page a human.
      if (restartedAt && Date.now() - restartedAt > ESCALATE_AFTER_RESTART_MS) {
        sendAlert({
          key: 'flow-stale-after-restart',
          subject: 'CB Edge: flow feed STILL stale after auto-restart',
          message: `No SPX OTM prints for ~${ageMin} min. theta-terminal was auto-restarted `
            + `${Math.round((Date.now() - restartedAt) / 60000)} min ago and the feed did not come back. `
            + `Likely stale entitlement or an upstream Theta outage — check: docker compose logs -f theta-terminal`,
        }).catch(() => {});
        return;
      }

      // Stage 1 — soft: cycle the socket.
      if (age < RESTART_AFTER_MS) {
        if (Date.now() - softReconnectedAt > SOFT_RECONNECT_AFTER_MS) {
          softReconnectedAt = Date.now();
          thetaStream.forceReconnect();
        }
        return;
      }

      // Stage 2 — hard: bounce theta-terminal ourselves (cooldown + daily cap live
      // in theta-restart.js; a no-op return here just means we're inside those).
      const res = await restartThetaTerminal();
      if (res.ok) {
        restartedAt = Date.now();
        softReconnectedAt = 0;
        sendAlert({
          key: 'flow-auto-restart',
          subject: 'CB Edge: theta-terminal auto-restarted',
          message: `Flow feed went stale (~${ageMin} min, no SPX OTM prints) and a socket cycle didn't recover it. `
            + `theta-terminal was restarted automatically (${res.countToday}/${MAX_PER_DAY} today). `
            + `No action needed unless a follow-up alert says the feed is still dead.`,
        }).catch(() => {});
        return;
      }

      if (res.skipped && res.reason === 'cooldown') return; // restart in flight, let it settle

      // Self-heal unavailable (cap hit / proxy rejected / auto-restart disabled) → page.
      sendAlert({
        key: 'flow-stale',
        subject: 'CB Edge: flow feed stale — auto-restart unavailable',
        message: `No SPX OTM option trade prints for ~${ageMin} min during market hours, and the automatic `
          + `theta-terminal restart could not run (${res.reason}). SSH in and run: docker restart theta-terminal`,
      }).catch(() => {});
    } catch (e) {
      console.warn('[flow-watchdog] check failed:', e?.message || e);
    }
  }, CHECK_INTERVAL_MS).unref?.();
}

module.exports = { startFlowWatchdog };
