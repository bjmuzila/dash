'use strict';
/**
 * server-v2/preview-snapshot-recorder.js
 *
 * Feeds the /preview page (delayed teaser for signed-up-but-unpaid users).
 * Every 30 minutes it reads the SAME live /api/gex chain the paid dashboard
 * uses, derives spot + call wall / put wall / gamma flip, and POSTs one row to
 * /api/preview → preview_snapshots. The /preview page only ever reads the
 * latest row, so the 30-minute write cadence IS the delay — no separate
 * "delayed data source" is needed, the staleness comes from how often we
 * bother to look.
 *
 * Mirrors mvc-auto-snapshot.js (same /api/gex read, same internal-token POST
 * pattern) and ref-levels-recorder.js (wall-clock-boundary self-reschedule).
 */

const INTERVAL_MIN = 30;
const INTERVAL_MS = INTERVAL_MIN * 60 * 1000;

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
function etDateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((p) => p.type !== 'literal')
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** RTH-ish gate (Mon-Fri, 09:30-16:00 ET) — matches mvc-auto-snapshot's window
 *  so the free feed never captures a stale/empty chain outside market hours. */
function isRTH() {
  const { hour, minute, weekday } = nowParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const mins = hour * 60 + minute;
  return mins >= 570 && mins < 960;
}

function highestRow(chain, field) {
  if (!chain.length) return null;
  return chain.reduce((best, row) =>
    Math.abs(Number(row[field] ?? 0)) > Math.abs(Number(best[field] ?? 0)) ? row : best,
    chain[0]);
}

async function collectOnce(base) {
  if (!isRTH()) { console.log('[preview-snapshot] skip — outside RTH'); return; }

  let data;
  try {
    const res = await fetch(`${base}/api/gex`, { cache: 'no-store', headers: internalHeaders() });
    if (!res.ok) { console.log(`[preview-snapshot] /api/gex ${res.status} — skip`); return; }
    data = await res.json();
  } catch (e) {
    console.log(`[preview-snapshot] /api/gex unreachable — skip (${e.message})`);
    return;
  }

  const chain = data.chain ?? [];
  if (!chain.length) { console.log('[preview-snapshot] empty chain — skip'); return; }

  // Basic call/put wall on the OI+Vol basis (same combined field the paid
  // dashboard uses): highest positive netGEX = call wall, most negative = put wall.
  for (const r of chain) {
    r.netGexOiVol = Number(r.netGEX ?? 0) + Number(r.netVolGEX ?? 0);
  }
  const callWallRow = chain.reduce((best, r) =>
    (r.netGexOiVol ?? -Infinity) > (best?.netGexOiVol ?? -Infinity) ? r : best, null);
  const putWallRow = chain.reduce((best, r) =>
    (r.netGexOiVol ?? Infinity) < (best?.netGexOiVol ?? Infinity) ? r : best, null);

  const spot = Number(data.spotPrice) || null;
  const flipRaw = Number(data.gexFlip);
  const gexFlip = Number.isFinite(flipRaw) && flipRaw > 500 ? flipRaw : highestRow(chain, 'netGexOiVol')?.strike ?? null;

  const now = new Date();
  const body = {
    ts: now.getTime(),
    date: etDateStr(now),
    time: now.toTimeString().split(' ')[0],
    spx_price: spot,
    gex_flip: gexFlip,
    call_wall: callWallRow?.strike ?? null,
    put_wall: putWallRow?.strike ?? null,
    expiration: data.expiration ?? null,
  };

  try {
    const res = await fetch(`${base}/api/preview`, {
      method: 'POST',
      headers: internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) { console.log(`[preview-snapshot] POST ${res.status}`); return; }
    console.log(`[preview-snapshot] ${body.date} ${body.time} ET — SPX ${spot} · call ${body.call_wall} · put ${body.put_wall} · flip ${body.gex_flip}`);
  } catch (e) {
    console.log(`[preview-snapshot] POST failed — ${e.message}`);
  }
}

/** Aligns the first fire to the next :00/:30 wall-clock boundary, then runs
 *  every INTERVAL_MIN, re-arming from a fresh boundary each time so it can't
 *  drift even across a host sleep/idle. */
function startPreviewSnapshotRecorder(port) {
  const base = `http://localhost:${port}`;

  function msToNextBoundary() {
    const now = new Date();
    const min = now.getMinutes();
    const sec = now.getSeconds();
    const ms = now.getMilliseconds();
    const minsToNext = INTERVAL_MIN - (min % INTERVAL_MIN) || INTERVAL_MIN;
    return (minsToNext * 60 - sec) * 1000 - ms;
  }

  console.log(`[preview-snapshot] enabled — every ${INTERVAL_MIN}m during RTH, first scheduled run in ${Math.round(msToNextBoundary() / 60000)}m`);

  // Startup test run ~25s after boot so /preview isn't empty until the first
  // :00/:30 boundary (skips outside RTH like every other tick).
  setTimeout(() => { console.log('[preview-snapshot] startup test run…'); void collectOnce(base); }, 25_000);

  let stopped = false;
  let timer = null;
  function arm() {
    if (stopped) return;
    timer = setTimeout(() => {
      console.log(`[preview-snapshot] tick ${new Date().toISOString()}`);
      void collectOnce(base);
      arm();
    }, msToNextBoundary());
  }
  arm();

  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

module.exports = { startPreviewSnapshotRecorder, collectOnce };
