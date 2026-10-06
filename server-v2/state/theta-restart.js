'use strict';
/**
 * server-v2/state/theta-restart.js
 *
 * Self-heal for the "theta-terminal wedged (stuck but listening)" failure mode.
 * The flow watchdog used to just EMAIL Brandon "SSH in and run: docker restart
 * theta-terminal" — every time, several times a session. The fix is always the
 * same command, so the box should run it itself.
 *
 * Restart goes through the existing docker-proxy sidecar (compose service
 * `docker-proxy`), NOT a raw docker.sock mount in the app container — a raw
 * socket mount is root-equivalent host access. The proxy is now allowed exactly
 * POST + ALLOW_RESTARTS (start/stop/exec/images/... still 0), so the worst this
 * credential can do is bounce a container.
 *
 * Guard rails (a restart loop is worse than a stale feed):
 *   - COOLDOWN_MS between restarts (default 15 min)
 *   - MAX_PER_DAY hard cap (default 3, ET-day scoped) — past that we stop and
 *     alert, because a 4th wedge in one session is not a wedge, it's a bug.
 */

const DOCKER_PROXY_URL = (process.env.DOCKER_PROXY_URL || 'http://docker-proxy:2375').trim();
const CONTAINER = (process.env.THETA_CONTAINER_NAME || 'theta-terminal').trim();
const ENABLED = process.env.THETA_AUTO_RESTART !== '0'; // default ON
const COOLDOWN_MS = Number(process.env.THETA_RESTART_COOLDOWN_MS || 15 * 60_000);
const MAX_PER_DAY = Number(process.env.THETA_RESTART_MAX_PER_DAY || 3);

let lastRestartAt = 0;
let dayKey = '';
let countToday = 0;

const etDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

function budget() {
  const d = etDay();
  if (d !== dayKey) { dayKey = d; countToday = 0; }
  return { countToday, remaining: MAX_PER_DAY - countToday };
}

/**
 * Bounce theta-terminal. Never throws.
 * @returns {Promise<{ok:boolean, skipped?:boolean, reason?:string, countToday?:number}>}
 */
async function restartThetaTerminal() {
  if (!ENABLED) return { ok: false, skipped: true, reason: 'THETA_AUTO_RESTART=0' };
  const { remaining } = budget();
  if (Date.now() - lastRestartAt < COOLDOWN_MS) return { ok: false, skipped: true, reason: 'cooldown' };
  if (remaining <= 0) return { ok: false, skipped: true, reason: `daily cap (${MAX_PER_DAY}) reached` };

  lastRestartAt = Date.now();
  countToday += 1;
  try {
    // t=10 → give the JVM 10s to exit cleanly before SIGKILL.
    const r = await fetch(`${DOCKER_PROXY_URL}/containers/${CONTAINER}/restart?t=10`, { method: 'POST' });
    if (!r.ok && r.status !== 204) {
      const detail = await r.text().catch(() => `HTTP ${r.status}`);
      console.error('[theta-restart] docker-proxy rejected:', r.status, detail.slice(0, 200));
      return { ok: false, reason: `docker-proxy ${r.status}`, countToday };
    }
    console.warn(`[theta-restart] restarted ${CONTAINER} (${countToday}/${MAX_PER_DAY} today)`);
    return { ok: true, countToday };
  } catch (e) {
    console.error('[theta-restart] restart failed:', e?.message || e);
    return { ok: false, reason: String(e?.message || e), countToday };
  }
}

module.exports = { restartThetaTerminal, MAX_PER_DAY };
