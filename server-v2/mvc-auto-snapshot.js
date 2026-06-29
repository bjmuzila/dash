'use strict';
/**
 * server-v2/mvc-auto-snapshot.js
 *
 * In-process MVC auto-collector. Runs entirely inside the server (no browser,
 * no Claude app) — the server-side equivalent of the client SnapButton flow:
 *
 *   GET  /api/gex            → live chain (computed by this same server)
 *   POST /api/snapshots/mvc  → persist derived MVC row (triggerType: auto-30m)
 *
 * Fires every INTERVAL_MS, but only writes during RTH (Mon–Fri 09:30–16:00 ET).
 * Calls the server over localhost so the derivation matches the UI exactly and
 * can never drift from the client's logic.
 *
 * Start from server-with-proxy.js after server.listen():
 *   require('./mvc-auto-snapshot').startMvcAutoSnapshot(PORT);
 */

const INTERVAL_MIN = 5;                       // snapshot cadence (minutes)
const INTERVAL_MS = INTERVAL_MIN * 60 * 1000; // 5 minutes

// Server-to-server calls to the protected /api/* routes must carry the shared
// internal token, or Clerk middleware redirects them to "/" and returns the
// landing-page HTML ("Unexpected token '<'"). Same pattern as levels-auto-publish.
function internalHeaders(extra = {}) {
  return Object.assign(
    {},
    extra,
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {}
  );
}

// Runtime on/off switch for the auto-collector. The interval keeps firing but
// collectOnce() short-circuits when disabled, so the owner dashboard can pause
// auto-snapshotting without restarting the server. Manual snapshots ignore this.
// Default ON unless MVC_AUTO=0/false in env. A stray /proxy/mvc-auto toggle no
// longer silently kills the loop for the whole process lifetime without trace.
let autoEnabled = !(process.env.MVC_AUTO === '0' || process.env.MVC_AUTO === 'false');
function setMvcAutoEnabled(on) { autoEnabled = !!on; console.log(`[auto-mvc] auto-collector ${autoEnabled ? 'ENABLED' : 'PAUSED'}`); }
function isMvcAutoEnabled() { return autoEnabled; }

function nowParts() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

/** RTH = Mon–Fri, 09:30–16:00 ET, excluding market holidays. Half-days close 13:00 ET. */
function isRTH() {
  const { hour, minute, weekday } = nowParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const today = etDateStr();
  if (MARKET_HOLIDAYS.has(today)) return false;
  const mins = hour * 60 + minute;
  const close = MARKET_HALF_DAYS.has(today) ? 780 : 960; // 13:00 vs 16:00 ET
  return mins >= 570 && mins < close;
}

function etDateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((p) => p.type !== 'literal')
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// US equity-market full-day closures (NYSE/Cboe), ET date strings.
const MARKET_HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// Early-close days (1:00 PM ET close): day after Thanksgiving, July 3 / Christmas Eve when a trading day.
const MARKET_HALF_DAYS = new Set([
  '2026-11-27', '2026-12-24',
  '2027-11-26',
]);

function highestRow(chain, field) {
  if (!chain.length) return null;
  return chain.reduce((best, row) =>
    Math.abs(Number(row[field] ?? 0)) > Math.abs(Number(best[field] ?? 0)) ? row : best,
    chain[0]);
}

async function collectOnce(base, opts = {}) {
  const manual = !!opts.manual;
  const force = !!opts.force; // owner override: snapshot even outside RTH
  if (!manual && !autoEnabled) { console.log('[auto-mvc] skip — auto-collector PAUSED'); return; }
  if (!isRTH() && !force) {
    if (!manual) console.log('[auto-mvc] skip — outside RTH');
    return manual ? { ok: false, error: 'outside RTH' } : undefined;
  }
  if (force && !isRTH()) console.log('[auto-mvc] FORCE — snapshot outside RTH (owner override)');

  let data;
  try {
    const res = await fetch(`${base}/api/gex`, { cache: 'no-store', headers: internalHeaders() });
    if (!res.ok) { console.log(`[auto-mvc] /api/gex ${res.status} — skip`); return manual ? { ok: false, error: `/api/gex ${res.status}` } : undefined; }
    data = await res.json();
  } catch (e) {
    console.log(`[auto-mvc] /api/gex unreachable — skip (${e.message})`);
    return manual ? { ok: false, error: e.message } : undefined;
  }

  const chain = data.chain ?? [];
  if (!chain.length) { console.log('[auto-mvc] empty chain — skip'); return manual ? { ok: false, error: 'empty chain' } : undefined; }

  // "OI+Vol" basis = open interest + volume combined. The chain carries netGEX
  // (OI-only) and netVolGEX (vol-only); their sum is the true OI+Vol GEX used by
  // the heatmap / greeks / mult-greek. Attach it so highestRow + the reducers
  // below can key on one field. (Previously the OI+Vol track used netGEX alone,
  // i.e. OI-only — a mislabel that fed confidence-score the wrong basis.)
  for (const r of chain) {
    r.netGexOiVol = Number(r.netGEX ?? 0) + Number(r.netVolGEX ?? 0);
  }

  const spot = Number(data.spotPrice) || 0;
  const expiry = data.expiration ?? '—';
  const flipPt = data.gexFlip ?? null;
  const nearestStrike = spot > 0 ? Math.round(spot / 5) * 5 : null;

  const mvcOIRow = highestRow(chain, 'netGexOiVol');
  const mvcVolRow = highestRow(chain, 'netVolGEX');
  const dexRow = highestRow(chain, 'netDEX');

  // OI+Vol total + dominance denominator now use the combined basis.
  const totalNetGEX = chain.reduce((s, r) => s + Number(r.netGexOiVol ?? 0), 0);
  // Gross sum of |GEX| across strikes — the correct dominance denominator.
  // (Previously totalAbsNetGEX stored Math.abs(totalNetGEX), which made GEX
  // dominance pin at ~100 and inflated the confidence Hit score.)
  const totalAbsGexSum = chain.reduce((s, r) => s + Math.abs(Number(r.netGexOiVol ?? 0)), 0);
  const totalNetGEX_Vol = chain.reduce((s, r) => s + Number(r.netVolGEX ?? 0), 0);
  const totalNetDEX_OI = chain.reduce((s, r) => s + Number(r.netDEX ?? 0), 0);
  const totalNetDEX_Vol = chain.reduce((s, r) => s + Number(r.volNetDEX ?? 0), 0);

  const now = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pctOI_Vol = totalNetGEX !== 0
    ? parseFloat((Math.abs(Number(mvcOIRow?.netGexOiVol ?? 0)) / Math.abs(totalNetGEX) * 100).toFixed(2)) : null;
  const pctVol_Only = totalNetGEX_Vol !== 0
    ? parseFloat((Math.abs(Number(mvcVolRow?.netVolGEX ?? 0)) / Math.abs(totalNetGEX_Vol) * 100).toFixed(2)) : null;
  const gexFlipRaw = Number(flipPt);
  const gexFlip = Number.isFinite(gexFlipRaw) && gexFlipRaw > 500
    ? gexFlipRaw : (mvcOIRow?.strike ?? mvcVolRow?.strike ?? null);

  const body = {
    timestamp: now.getTime(),
    date: etDateStr(now),
    day: days[now.getDay()],
    time: now.toTimeString().split(' ')[0],
    strikeOIVol: mvcOIRow?.strike ?? nearestStrike ?? null,
    mvcValueOIVol: Number(mvcOIRow?.netGexOiVol ?? 0),
    pctOI_Vol,
    volumeOIVol: Number(mvcOIRow?.callVolume ?? 0) + Number(mvcOIRow?.putVolume ?? 0),
    totalNetGEX_OI: Math.abs(totalNetGEX),
    strikeVolOnly: mvcVolRow?.strike ?? nearestStrike ?? null,
    mvcValueVolOnly: Number(mvcVolRow?.netVolGEX ?? 0),
    pctVol_Only,
    volumeVolOnly: Number(mvcVolRow?.callVolume ?? 0) + Number(mvcVolRow?.putVolume ?? 0),
    totalNetGEX_Vol,
    spxPrice: spot,
    esPrice: spot,
    netDEXStrike: dexRow?.strike ?? nearestStrike ?? null,
    totalNetDEX_OI,
    totalNetDEX_Vol,
    totalAbsNetGEX: totalAbsGexSum,
    gexFlip,
    triggerType: manual ? 'manual' : `auto-${INTERVAL_MIN}m`,
    expiration: expiry,
  };

  try {
    const res = await fetch(`${base}/api/snapshots/mvc`, {
      method: 'POST',
      headers: internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) { console.log(`[auto-mvc] POST ${res.status} — ${JSON.stringify(json)}`); return { ok: false, error: `POST ${res.status}` }; }
    console.log(`[auto-mvc] ${body.date} ${body.time} ET — saved id ${json.id} · MVC ${body.strikeOIVol} · SPX ${spot}`);
    return { ok: true, id: json.id, strike: body.strikeOIVol, spot };
  } catch (e) {
    console.log(`[auto-mvc] POST failed — ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * Begin the collection loop. Aligns the first fire to the next INTERVAL_MIN
 * wall-clock boundary (:00/:05/:10…), then runs every INTERVAL_MIN. Returns the
 * interval handle.
 */
function startMvcAutoSnapshot(port) {
  const base = `http://localhost:${port}`;

  // ms until the next INTERVAL_MIN wall-clock boundary (:00/:05/:10…).
  function msToNextBoundary() {
    const now = new Date();
    const min = now.getMinutes();
    const sec = now.getSeconds();
    const ms = now.getMilliseconds();
    const minsToNext = INTERVAL_MIN - (min % INTERVAL_MIN) || INTERVAL_MIN;
    return (minsToNext * 60 - sec) * 1000 - ms;
  }

  console.log(`[auto-mvc] enabled — every ${INTERVAL_MIN}m during RTH, first scheduled run in ${Math.round(msToNextBoundary() / 60000)}m`);

  // One-time startup test: fire once ~20s after boot (lets the feed warm up) so
  // you can verify collection without waiting for the next boundary. Subject to
  // the same auto/RTH gates (each logs its own skip reason now).
  setTimeout(() => {
    console.log('[auto-mvc] startup test run…');
    void collectOnce(base);
  }, 20_000);

  // Self-rescheduling boundary loop. Re-arming from a fresh msToNextBoundary()
  // after every fire keeps the cadence locked to :00/:05/:10 even if the host
  // idled/slept and a setInterval would have drifted or stalled. No .unref():
  // the loop must survive even if it were the only thing on the event loop.
  let stopped = false;
  let timer = null;
  function arm() {
    if (stopped) return;
    timer = setTimeout(() => {
      console.log(`[auto-mvc] tick ${new Date().toISOString()}`);
      void collectOnce(base);
      arm();
    }, msToNextBoundary());
  }
  arm();

  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

module.exports = { startMvcAutoSnapshot, collectOnce, setMvcAutoEnabled, isMvcAutoEnabled };
