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

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

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

async function collectOnce(base) {
  if (!isRTH()) return; // silent skip off-hours

  let data;
  try {
    const res = await fetch(`${base}/api/gex`, { cache: 'no-store' });
    if (!res.ok) { console.log(`[auto-mvc] /api/gex ${res.status} — skip`); return; }
    data = await res.json();
  } catch (e) {
    console.log(`[auto-mvc] /api/gex unreachable — skip (${e.message})`);
    return;
  }

  const chain = data.chain ?? [];
  if (!chain.length) { console.log('[auto-mvc] empty chain — skip'); return; }

  const spot = Number(data.spotPrice) || 0;
  const expiry = data.expiration ?? '—';
  const flipPt = data.gexFlip ?? null;
  const nearestStrike = spot > 0 ? Math.round(spot / 5) * 5 : null;

  const mvcOIRow = highestRow(chain, 'netGEX');
  const mvcVolRow = highestRow(chain, 'netVolGEX');
  const dexRow = highestRow(chain, 'netDEX');

  const totalNetGEX = chain.reduce((s, r) => s + Number(r.netGEX ?? 0), 0);
  const totalNetGEX_Vol = chain.reduce((s, r) => s + Number(r.netVolGEX ?? 0), 0);
  const totalNetDEX_OI = chain.reduce((s, r) => s + Number(r.netDEX ?? 0), 0);
  const totalNetDEX_Vol = chain.reduce((s, r) => s + Number(r.volNetDEX ?? 0), 0);

  const now = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pctOI_Vol = totalNetGEX !== 0
    ? parseFloat((Math.abs(Number(mvcOIRow?.netGEX ?? 0)) / Math.abs(totalNetGEX) * 100).toFixed(2)) : null;
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
    mvcValueOIVol: Number(mvcOIRow?.netGEX ?? 0),
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
    totalAbsNetGEX: Math.abs(totalNetGEX),
    gexFlip,
    triggerType: 'auto-30m',
    expiration: expiry,
  };

  try {
    const res = await fetch(`${base}/api/snapshots/mvc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) { console.log(`[auto-mvc] POST ${res.status} — ${JSON.stringify(json)}`); return; }
    console.log(`[auto-mvc] ${body.date} ${body.time} ET — saved id ${json.id} · MVC ${body.strikeOIVol} · SPX ${spot}`);
  } catch (e) {
    console.log(`[auto-mvc] POST failed — ${e.message}`);
  }
}

/**
 * Begin the 30-min collection loop. Aligns the first fire to the next :00/:30
 * wall-clock boundary, then runs every 30 min. Returns the interval handle.
 */
function startMvcAutoSnapshot(port) {
  const base = `http://localhost:${port}`;
  const min = new Date().getMinutes();
  const sec = new Date().getSeconds();
  const minsToNext = (min < 30 ? 30 : 60) - min;
  const delayMs = (minsToNext * 60 - sec) * 1000;

  console.log(`[auto-mvc] enabled — every 30m during RTH, first scheduled run in ${Math.round(delayMs / 60000)}m`);

  // One-time startup test: fire once ~20s after boot (lets the feed warm up) so
  // you can verify collection without waiting for the next :00/:30 boundary.
  // Subject to the same RTH gate, so it silently no-ops off-hours.
  setTimeout(() => {
    console.log('[auto-mvc] startup test run…');
    void collectOnce(base);
  }, 20_000).unref();

  let timer = null;
  setTimeout(() => {
    void collectOnce(base);
    timer = setInterval(() => void collectOnce(base), INTERVAL_MS);
  }, delayMs).unref();
  return () => { if (timer) clearInterval(timer); };
}

module.exports = { startMvcAutoSnapshot, collectOnce };
