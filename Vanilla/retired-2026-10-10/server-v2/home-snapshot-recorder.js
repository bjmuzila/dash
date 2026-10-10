'use strict';
/**
 * server-v2/home-snapshot-recorder.js
 *
 * Feeds /home in "delayed" mode for signed-up-but-unpaid users. Every 30
 * minutes (RTH only, force-bypassable) it reads the SAME hot /proxy/gex
 * snapshot app/home/page.tsx's readInitial() reads for the LIVE render, shapes
 * it into the exact HomeInitial-equivalent object, and POSTs it to
 * /api/home-snapshot → home_static_snapshots. The unpaid /home render just
 * swaps its data source for this frozen row; every component downstream
 * (GexChart, toolbar, etc.) is unchanged — same shape, just not live.
 */

const INTERVAL_MIN = 30;

function internalHeaders(extra = {}) {
  return Object.assign({}, extra,
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {});
}

function nowParts() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

/** RTH-ish gate (Mon-Fri, 09:30-16:00 ET) — matches the other recorders. */
function isRTH() {
  const { hour, minute, weekday } = nowParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const mins = hour * 60 + minute;
  return mins >= 570 && mins < 960;
}

async function collectOnce(base, opts = {}) {
  const force = !!opts.force;
  if (!isRTH() && !force) { console.log('[home-snapshot] skip — outside RTH'); return; }
  if (force && !isRTH()) console.log('[home-snapshot] FORCE — snapshot outside RTH (owner override)');

  let v2;
  try {
    // Same hot in-memory endpoint app/home/page.tsx's readInitial() reads for
    // the live render — guarantees an identical shape, zero translation needed.
    const res = await fetch(`${base}/proxy/gex`, { cache: 'no-store' });
    if (!res.ok) { console.log(`[home-snapshot] /proxy/gex ${res.status} — skip`); return { ok: false, error: `/proxy/gex ${res.status}` }; }
    v2 = await res.json();
  } catch (e) {
    console.log(`[home-snapshot] /proxy/gex unreachable — skip (${e.message})`);
    return { ok: false, error: e.message };
  }

  const rows = Array.isArray(v2.gexRows) ? v2.gexRows : [];
  if (!rows.length) { console.log('[home-snapshot] empty chain — skip'); return { ok: false, error: 'empty chain' }; }

  const spot = Number(v2.spot ?? 0);
  const snapshot = {
    gexRows: rows,
    spot,
    spotDisplay: Number(v2.spotDisplay ?? spot ?? 0),
    prevClose: Number(v2.prevClose ?? 0),
    expiry: String(v2.expiry ?? ''),
    expirations: Array.isArray(v2.expirations) ? v2.expirations : [],
    callWall: v2.callWall ?? null,
    putWall: v2.putWall ?? null,
    chartReady: true,
  };

  try {
    const res = await fetch(`${base}/api/home-snapshot`, {
      method: 'POST',
      headers: internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ts: Date.now(), snapshot }),
    });
    if (!res.ok) { console.log(`[home-snapshot] POST ${res.status}`); return { ok: false, error: `POST ${res.status}` }; }
    console.log(`[home-snapshot] saved — ${rows.length} strikes · spot ${spot} · expiry ${snapshot.expiry}`);
    return { ok: true, rows: rows.length, spot, expiry: snapshot.expiry };
  } catch (e) {
    console.log(`[home-snapshot] POST failed — ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/** Aligns to the next :00/:30 wall-clock boundary, then every INTERVAL_MIN. */
function startHomeSnapshotRecorder(port) {
  const base = `http://localhost:${port}`;

  function msToNextBoundary() {
    const now = new Date();
    const min = now.getMinutes();
    const sec = now.getSeconds();
    const ms = now.getMilliseconds();
    const minsToNext = INTERVAL_MIN - (min % INTERVAL_MIN) || INTERVAL_MIN;
    return (minsToNext * 60 - sec) * 1000 - ms;
  }

  console.log(`[home-snapshot] enabled — every ${INTERVAL_MIN}m during RTH, first scheduled run in ${Math.round(msToNextBoundary() / 60000)}m`);

  // Staggered a few seconds after preview-snapshot-recorder's startup run so
  // they don't both hammer /proxy/gex in the same tick.
  setTimeout(() => { console.log('[home-snapshot] startup test run…'); void collectOnce(base); }, 30_000);

  let stopped = false;
  let timer = null;
  function arm() {
    if (stopped) return;
    timer = setTimeout(() => {
      console.log(`[home-snapshot] tick ${new Date().toISOString()}`);
      void collectOnce(base);
      arm();
    }, msToNextBoundary());
  }
  arm();

  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

module.exports = { startHomeSnapshotRecorder, collectOnce };
