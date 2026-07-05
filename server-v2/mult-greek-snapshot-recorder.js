'use strict';
/**
 * server-v2/mult-greek-snapshot-recorder.js
 *
 * Feeds /mult-greek in "delayed" mode for signed-up-but-unpaid users. Every 30
 * minutes (RTH only, force-bypassable) it:
 *   1. resolves a shared near-dated expiry (prefers today's 0DTE) the same way
 *      MultGreekClient's loadExpirations() does client-side, via
 *      /proxy/api/tt/expirations/SPX;
 *   2. pulls the SPX/SPY/QQQ chain at that expiry via /proxy/api/tt/chains/:ticker
 *      (same adapter /api/chains forwards to);
 *   3. POSTs { expiry, tickers: { SPX, SPY, QQQ } } to /api/mult-greek-snapshot.
 *
 * The payload intentionally matches what MultGreekClient already parses with
 * buildStrikes()/computeRows() — the frozen render reuses the SAME client code
 * as the live page, just fed a static payload instead of a live fetch.
 */

const TICKERS = ['SPX', 'SPY', 'QQQ'];
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

function isRTH() {
  const { hour, minute, weekday } = nowParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const mins = hour * 60 + minute;
  return mins >= 570 && mins < 960;
}

function todayETStr() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const m = {};
  parts.forEach((p) => { m[p.type] = p.value; });
  return `${m.year}-${m.month}-${m.day}`;
}

function daysTo(dateStr) {
  return Math.round((new Date(dateStr).getTime() - new Date(todayETStr()).getTime()) / 86400000);
}

/** Same selection MultGreekClient's loadExpirations() uses: keep expirations
 *  within 7 DTE, or weekly/monthly, or any Friday; pick 0DTE if present, else
 *  the nearest. */
function pickExpiry(items) {
  const seen = new Set();
  const list = [];
  items.forEach((item) => {
    const d = String(item['expiration-date'] ?? '');
    if (!d || seen.has(d)) return;
    seen.add(d);
    const dt = daysTo(d);
    if (dt < 0) return;
    const expType = String(item['expiration-type'] ?? '').toLowerCase();
    const keep = dt <= 7 || expType === 'weekly' || expType === 'monthly'
      || new Date(d + 'T12:00:00').getDay() === 5;
    if (!keep) return;
    list.push({ date: d, daysTo: dt });
  });
  list.sort((a, b) => a.daysTo - b.daysTo);
  if (!list.length) return null;
  return (list.find((e) => e.daysTo === 0) ?? list[0]).date;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

async function collectOnce(base, opts = {}) {
  const force = !!opts.force;
  if (!isRTH() && !force) { console.log('[mult-greek-snapshot] skip — outside RTH'); return; }
  if (force && !isRTH()) console.log('[mult-greek-snapshot] FORCE — snapshot outside RTH (owner override)');

  let expiry;
  try {
    const expJson = await fetchJson(`${base}/proxy/api/tt/expirations/SPX`);
    const items = expJson?.data?.items ?? [];
    expiry = pickExpiry(items);
    if (!expiry) {
      // Fallback: derive from the chain itself (mirrors the client's safety net).
      const chainJson = await fetchJson(`${base}/proxy/api/tt/chains/SPX?range=all`);
      const chainItems = chainJson?.data?.items ?? [];
      const dates = chainItems.map((i) => String(i['expiration-date'] ?? '')).filter(Boolean).sort();
      expiry = dates.find((d) => daysTo(d) >= 0) ?? dates[0] ?? null;
    }
  } catch (e) {
    console.log(`[mult-greek-snapshot] expiry resolution failed — skip (${e.message})`);
    return { ok: false, error: e.message };
  }
  if (!expiry) { console.log('[mult-greek-snapshot] no expiry resolved — skip'); return { ok: false, error: 'no expiry' }; }

  const tickers = {};
  let anyOk = false;
  for (const ticker of TICKERS) {
    try {
      const json = await fetchJson(`${base}/proxy/api/tt/chains/${ticker}?expiration=${encodeURIComponent(expiry)}&range=all`);
      const allItems = json?.data?.items ?? [];
      // Same filter the client applies: keep only groups matching this expiry.
      const filtered = allItems.filter((i) => String(i['expiration-date'] ?? '').slice(0, 10) === expiry.slice(0, 10));
      const items = filtered.length ? filtered : allItems;
      const underlyingPrice = Number(json?.data?.underlyingPrice ?? 0) || 0;
      if (items.length) { tickers[ticker] = { items, underlyingPrice }; anyOk = true; }
      else console.log(`[mult-greek-snapshot] ${ticker} — empty chain at ${expiry}`);
    } catch (e) {
      console.log(`[mult-greek-snapshot] ${ticker} chain fetch failed — ${e.message}`);
    }
  }
  if (!anyOk) { console.log('[mult-greek-snapshot] no tickers resolved — skip'); return { ok: false, error: 'empty chain' }; }

  const snapshot = { expiry, tickers };
  try {
    const res = await fetch(`${base}/api/mult-greek-snapshot`, {
      method: 'POST',
      headers: internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ts: Date.now(), snapshot }),
    });
    if (!res.ok) { console.log(`[mult-greek-snapshot] POST ${res.status}`); return { ok: false, error: `POST ${res.status}` }; }
    console.log(`[mult-greek-snapshot] saved — expiry ${expiry} · tickers ${Object.keys(tickers).join(',')}`);
    return { ok: true, expiry, tickers: Object.keys(tickers) };
  } catch (e) {
    console.log(`[mult-greek-snapshot] POST failed — ${e.message}`);
    return { ok: false, error: e.message };
  }
}

function startMultGreekSnapshotRecorder(port) {
  const base = `http://localhost:${port}`;

  function msToNextBoundary() {
    const now = new Date();
    const min = now.getMinutes();
    const sec = now.getSeconds();
    const ms = now.getMilliseconds();
    const minsToNext = INTERVAL_MIN - (min % INTERVAL_MIN) || INTERVAL_MIN;
    return (minsToNext * 60 - sec) * 1000 - ms;
  }

  console.log(`[mult-greek-snapshot] enabled — every ${INTERVAL_MIN}m during RTH, first scheduled run in ${Math.round(msToNextBoundary() / 60000)}m`);

  // Staggered after preview/home startup runs so they don't all hammer the
  // proxy in the same tick.
  setTimeout(() => { console.log('[mult-greek-snapshot] startup test run…'); void collectOnce(base); }, 35_000);

  let stopped = false;
  let timer = null;
  function arm() {
    if (stopped) return;
    timer = setTimeout(() => {
      console.log(`[mult-greek-snapshot] tick ${new Date().toISOString()}`);
      void collectOnce(base);
      arm();
    }, msToNextBoundary());
  }
  arm();

  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

module.exports = { startMultGreekSnapshotRecorder, collectOnce };
