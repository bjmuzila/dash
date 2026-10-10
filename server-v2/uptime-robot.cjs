'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * UPTIME — CB Edge and Vela, measured from OUTSIDE by UptimeRobot (2026-10-09).
 *
 * Brandon: "add an uptime tracker for cbedge and vela in the backend
 * owner.cbedge.net site · keys will be put into the .env.local in the vps".
 * Same idea as Voltick's Uptime tab: a server can't time its own downtime, so
 * the numbers come from UptimeRobot's checks, not from this process.
 *
 *   GET /api/owner/uptime            owner-only. Every site below, held
 *                                    HOLD_MS and shared by every reader, so an
 *                                    open tab never costs more than one
 *                                    UptimeRobot call per site per minute.
 *   GET /api/owner/uptime?fresh=1    skip the hold.
 *
 * KEYS (.env.local on the VPS — read on every build, so no code change to add one):
 *
 *   UPTIMEROBOT_API_KEY      ONE account key for everything (Brandon's setup).
 *                            Monitors are split by URL/name: "vela" → Vela,
 *                            "cbedge" → CB Edge. Anything else on the account
 *                            (the voltick.io monitor) is ignored — Voltick
 *                            has its own Uptime tab.
 *   UPTIMEROBOT_KEY_CBEDGE   optional: extra key(s) that are CB Edge only
 *   UPTIMEROBOT_KEY_VELA     optional: extra key(s) that are Vela only
 *
 * Each may be an account Read-Only key (ur…), a Main key, or one or more
 * monitor-specific keys (m…), comma-separated. A Read-Only key is the right
 * one: getMonitors is all this file calls, and nothing here can edit a monitor.
 * A site with no key is reported as `configured: false`, not as an error.
 *
 * NO KEY EVER LEAVES THIS FILE. The response carries names, URLs, statuses and
 * timings only; an upstream error is reduced to its message, never the request.
 *
 * Talks to UptimeRobot API v2 (POST /v2/getMonitors). v2 is "legacy" but
 * supported and is the one that takes Read-Only keys plus logs, response times,
 * 30-day ratios and SSL expiry in a single call.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const API = 'https://api.uptimerobot.com/v2/getMonitors';
const HOLD_MS = 60_000;
const TIMEOUT_MS = 10_000;
const LOGS_LIMIT = 20;            // per monitor — the newest 20 events
const RT_LIMIT = 96;              // recent checks for p50/p95 + the sparkline (8 h at 5-min checks)

const SITES = [
  // Order matters for the shared key: vela.cbedge.net contains "cbedge" too.
  { key: 'vela', label: 'Vela', env: 'UPTIMEROBOT_KEY_VELA', match: /vela/i },
  { key: 'cbedge', label: 'CB Edge', env: 'UPTIMEROBOT_KEY_CBEDGE', match: /cbedge/i },
];

// UptimeRobot monitor.status
const STATUS = { 0: 'paused', 1: 'pending', 2: 'up', 8: 'seems_down', 9: 'down' };
// UptimeRobot log.type
const LOG_TYPE = { 1: 'down', 2: 'up', 98: 'started', 99: 'paused' };

const num = (v) => {
  if (v == null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function keysFor(site) {
  return String(process.env[site.env] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function getMonitors(apiKey) {
  const body = new URLSearchParams({
    api_key: apiKey,
    format: 'json',
    logs: '1',
    logs_limit: String(LOGS_LIMIT),
    response_times: '1',
    response_times_limit: String(RT_LIMIT),
    custom_uptime_ratios: '1-7-30',
    ssl: '1',
  });
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`UptimeRobot HTTP ${r.status}`);
  const j = await r.json();
  if (j.stat !== 'ok') {
    // { stat: 'fail', error: { type, message } } — message only, never the key.
    throw new Error(String(j?.error?.message || j?.error?.type || 'UptimeRobot refused the request').slice(0, 160));
  }
  return Array.isArray(j.monitors) ? j.monitors : [];
}

function shapeMonitor(m) {
  const rts = (Array.isArray(m.response_times) ? m.response_times : [])
    .map((x) => ({ t: num(x.datetime), ms: num(x.value) }))
    .filter((x) => x.t != null && x.ms != null)
    .sort((a, b) => a.t - b.t);
  const sorted = rts.map((x) => x.ms).sort((a, b) => a - b);

  // custom_uptime_ratio is "1d-7d-30d" in the order requested.
  const [u1, u7, u30] = String(m.custom_uptime_ratio || '').split('-').map(num);

  const logs = (Array.isArray(m.logs) ? m.logs : []).map((l) => ({
    type: LOG_TYPE[l.type] || String(l.type),
    at: num(l.datetime) != null ? num(l.datetime) * 1000 : null,
    durationSec: num(l.duration),
    reason: l.reason ? String(l.reason.detail || l.reason.code || '').slice(0, 120) || null : null,
  }));

  const sslExp = num(m.ssl?.expires);
  let host = null;
  try { host = new URL(m.url).host; } catch { /* keyword/port monitors may not be URLs */ }

  return {
    id: m.id,
    name: String(m.friendly_name || host || m.url || m.id),
    url: m.url || null,
    host,
    status: STATUS[m.status] || 'unknown',
    intervalSec: num(m.interval),
    uptime1d: u1 ?? null,
    uptime7d: u7 ?? null,
    uptime30d: u30 ?? null,
    p50Ms: pct(sorted, 50),
    p95Ms: pct(sorted, 95),
    lastCheckAt: rts.length ? rts[rts.length - 1].t * 1000 : null,
    responseTimes: rts.map((x) => ({ at: x.t * 1000, ms: x.ms })),
    ssl: sslExp ? { expiresAt: sslExp * 1000, brand: m.ssl?.brand ? String(m.ssl.brand).slice(0, 60) : null } : null,
    logs,
  };
}

const SHARED_ENV = 'UPTIMEROBOT_API_KEY';
const OTHER = { key: 'other', label: 'Other', env: SHARED_ENV };

/** Which site a monitor from the shared key belongs to — by URL, then name. */
function siteFor(m) {
  const hay = `${m.url || ''} ${m.friendly_name || ''}`;
  return SITES.find((s) => s.match.test(hay)) || null;   // not CB Edge or Vela (e.g. voltick.io) → ignored
}

async function pull(keys, errors, label) {
  const results = await Promise.allSettled(keys.map(getMonitors));
  const out = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      errors.push(`${label}${keys.length > 1 ? ` #${i + 1}` : ''}: ${String(r.reason?.message || r.reason).slice(0, 160)}`);
    } else out.push(...r.value);
  });
  return out;
}

let held = null;     // { at, body }
let building = null; // one build in flight, shared

async function build() {
  const shared = String(process.env[SHARED_ENV] || '').split(',').map((x) => x.trim()).filter(Boolean);
  const all = [...SITES, OTHER];
  const bucket = new Map(all.map((s) => [s.key, {
    key: s.key, label: s.label, env: s.env,
    configured: shared.length > 0 || (s !== OTHER && keysFor(s).length > 0),
    monitors: [], errors: [], seen: new Set(),
  }]));
  const add = (b, m) => {
    if (b.seen.has(m.id)) return;   // the same monitor via two keys must not double-count
    b.seen.add(m.id);
    b.monitors.push(shapeMonitor(m));
  };

  await Promise.all([
    // One account key for everything: split by URL (vela before cbedge — vela.cbedge.net matches both).
    shared.length
      ? pull(shared, bucket.get('other').errors, SHARED_ENV).then((ms) => {
          const errs = bucket.get('other').errors;
          if (errs.length) for (const s of SITES) bucket.get(s.key).errors.push(...errs);
          for (const m of ms) { const site = siteFor(m); if (site) add(bucket.get(site.key), m); }
        })
      : null,
    // Per-site keys, if set, add to that site as-is.
    ...SITES.map((s) => {
      const keys = keysFor(s);
      if (!keys.length) return null;
      const b = bucket.get(s.key);
      return pull(keys, b.errors, s.env).then((ms) => { for (const m of ms) add(b, m); });
    }),
  ]);

  const sites = [];
  for (const s of all) {
    const b = bucket.get(s.key);
    delete b.seen;
    b.monitors.sort((a, z) => a.name.localeCompare(z.name));
    if (!b.errors.length) delete b.errors;
    if (s === OTHER) continue;   // only a holder for shared-key errors; never shown
    sites.push(b);
  }
  const ORDER = ['cbedge', 'vela'];   // display order, not match order
  sites.sort((x, y) => ORDER.indexOf(x.key) - ORDER.indexOf(y.key));
  return { asOf: new Date().toISOString(), heldAt: Date.now(), holdMs: HOLD_MS, sites };
}

async function uptime({ fresh = false } = {}) {
  if (!fresh && held && Date.now() - held.at < HOLD_MS) return held.body;
  if (!building) {
    building = build()
      .then((body) => { held = { at: Date.now(), body }; return body; })
      .finally(() => { building = null; });
  }
  return building;
}

function registerUptimeRoutes({ register, send, NO_STORE }) {
  register('/api/owner/uptime', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res) {
      const fresh = /^(1|true)$/.test(new URL(req.url || '/', 'http://localhost').searchParams.get('fresh') || '');
      try { send(res, 200, await uptime({ fresh }), { 'Cache-Control': NO_STORE }); }
      catch (e) { send(res, 500, { error: String(e?.message || e).slice(0, 160) }, { 'Cache-Control': NO_STORE }); }
    },
  });
  return 1;
}

module.exports = { registerUptimeRoutes, uptime, SITES, _shapeMonitor: shapeMonitor, _siteFor: siteFor };
