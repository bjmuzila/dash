'use strict';
/**
 * server-v2/etf-gex-recorder.js
 *
 * Server-side recorder for SPY / QQQ PER-STRIKE net GEX history — the ETF
 * equivalent of the SPX pipeline that feeds the ES-Candles heatmap, GEX bubbles
 * and strike rail.
 *
 * SPX gets its per-strike rows from the LIVE dashboard feed: proxy-tastytrade
 * streams the chain, computation/gex-calculator.js reduces it, and
 * gex-history-writer.writeGexSnapshot() persists one row per strike per minute.
 * SPY/QQQ are not on that hot feed (nothing subscribes them tick-by-tick), so
 * this recorder polls their chains on its own interval and writes into the SAME
 * table through the SAME writer — with `symbol` set to the ticker.
 *
 * Everything downstream (the /api/snapshots/option-strike-gex-history reads, the
 * heatmap, the bubble trail, the rail) therefore needs no second code path: it
 * just passes ?symbol=SPY and gets the identical row shape back.
 *
 * Chain source: fetchExpirations / fetchChainFull from proxy-tastytrade — the
 * same REST calls state/ticker-wall-recorder.js already uses for its SPY/QQQ
 * 0DTE walls, so this adds no new upstream dependency.
 *
 * GEX convention (identical to ticker-wall-recorder and the client's chain math):
 *   netGEX(strike) = (callGamma·callOI − putGamma·putOI) · spot² · 0.01 · 100
 *   netVolGEX(strike) = (callGamma·callVol − putGamma·putVol) · spot² · 0.01 · 100
 *
 * RTH only (9:30–16:00 ET, weekdays): SPY/QQQ option chains outside those hours
 * are stale quotes, and writing them would put a flat, wrong column on the
 * heatmap for every overnight minute.
 *
 * Wiring: startEtfGexRecorder() from server-with-proxy.js.
 * Disable with ETF_GEX_RECORDER=0.
 */

const { fetchExpirations, fetchChainFull } = require('./proxy-tastytrade');
const { writeGexSnapshot } = require('./gex-history-writer');

const INTERVAL_MS = Number(process.env.ETF_GEX_RECORDER_INTERVAL_MS || 60_000);
const SYMBOLS = String(process.env.ETF_GEX_SYMBOLS || 'SPY,QQQ')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

// How many expirations forward to record.
//
// DEFAULT 1 (0DTE only) ON PURPOSE. The ES-Candles heatmap requests front mode,
// which is served by getOptionStrikeGexSlotsWindowAny — a
// `DISTINCT ON (minute_bucket, strike) ... ORDER BY ..., timestamp DESC` that
// ignores expiry entirely. Recording a second expiry therefore does NOT add an
// optional extra column the UI can choose between: the 1DTE rows are written
// microseconds later than the 0DTE rows, so they win the DISTINCT ON for every
// strike the two ladders share and the "0DTE" heatmap silently becomes
// tomorrow's gamma profile with 0DTE fragments where the ladders differ.
//
// Raising this is only safe once the ETF read path asks for an explicit expiry
// instead of anyExpiry=1.
const EXPIRY_DEPTH = Math.max(1, Math.min(4, Number(process.env.ETF_GEX_EXPIRY_DEPTH || 1)));

// ── Time helpers ─────────────────────────────────────────────────────────────
function todayYmdET() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function isRthNowET() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => parts.find((x) => x.type === t)?.value ?? '';
  const wd = get('weekday');
  if (wd === 'Sat' || wd === 'Sun') return false;
  const mins = Number(get('hour')) * 60 + Number(get('minute'));
  return mins >= 570 && mins < 960; // 9:30–16:00 ET
}

// ── Chain → per-strike rows ──────────────────────────────────────────────────

/** The next `depth` expirations for a ticker, today-or-later, ascending. */
async function resolveExpiries(ticker, depth) {
  const { items } = await fetchExpirations(ticker).catch(() => ({ items: [] }));
  const today = todayYmdET();
  return (items || [])
    .map((it) => String(it['expiration-date'] || '').slice(0, 10))
    .filter((d) => d && d >= today)
    .sort()
    .slice(0, depth);
}

const num = (o, k) => (o ? parseFloat(o[k]) || 0 : 0);
const int = (o, ...keys) => {
  if (!o) return 0;
  for (const k of keys) {
    const v = parseInt(o[k] ?? 0, 10);
    if (Number.isFinite(v) && v) return v;
  }
  return 0;
};

/**
 * One expiration's strike ladder reduced to the writer's row shape.
 * Returns { spot, rows: [{ strike, netGEX, netVolGEX, callGamma, putGamma }] }.
 */
async function snapshotStrikes(ticker, expiry) {
  const { items, underlyingPrice } = await fetchChainFull(ticker, expiry);
  const spot = Number(underlyingPrice) || 0;
  if (!(spot > 0) || !Array.isArray(items) || !items.length) return { spot, rows: [] };

  // spot² · 0.01 · 100 — 1% underlying move, 100 shares per contract. Same
  // multiplier the SPX path and ticker-wall-recorder use, so the values are
  // directly comparable across underlyings.
  const mult = spot * spot * 0.01 * 100;
  const rows = [];

  for (const group of items) {
    const groupExp = String(group['expiration-date'] || '').slice(0, 10);
    if (groupExp && groupExp !== expiry) continue;
    for (const it of group.strikes || []) {
      const strike = parseFloat(it['strike-price'] || 0);
      if (!(strike > 0)) continue;
      const c = it.call;
      const p = it.put;
      const cGamma = num(c, 'gamma');
      const pGamma = num(p, 'gamma');
      const cOI = int(c, 'open-interest', 'openInterest');
      const pOI = int(p, 'open-interest', 'openInterest');
      const cVol = int(c, 'volume', 'day-volume');
      const pVol = int(p, 'volume', 'day-volume');
      // A strike with no book AND no tape is noise — skip it rather than write
      // a zero row per minute per strike for the whole dead tail of the chain.
      if (!cOI && !pOI && !cVol && !pVol) continue;
      rows.push({
        strike,
        netGEX: (cGamma * cOI - pGamma * pOI) * mult,
        netVolGEX: (cGamma * cVol - pGamma * pVol) * mult,
        callGamma: cGamma,
        putGamma: pGamma,
      });
    }
  }

  rows.sort((a, b) => a.strike - b.strike);
  return { spot, rows };
}

// ── Tick ─────────────────────────────────────────────────────────────────────
async function tick() {
  if (!isRthNowET()) return;

  for (const symbol of SYMBOLS) {
    try {
      const expiries = await resolveExpiries(symbol, EXPIRY_DEPTH); // eslint-disable-line no-await-in-loop
      if (!expiries.length) {
        console.warn(`[etf-gex] ${symbol}: no expirations returned — skipping tick`);
        continue;
      }
      for (const expiry of expiries) {
        // eslint-disable-next-line no-await-in-loop
        const { spot, rows } = await snapshotStrikes(symbol, expiry);
        if (!rows.length || !(spot > 0)) continue;
        // writeGexSnapshot throttles per (symbol, expiry) at
        // GEX_PG_WRITE_INTERVAL_MS, so each expiry gets its own minute slot
        // rather than the first one of the tick swallowing the rest.
        // eslint-disable-next-line no-await-in-loop
        await writeGexSnapshot(rows, spot, expiry, symbol);
      }
    } catch (e) {
      console.warn(`[etf-gex] ${symbol} snapshot failed:`, e.message);
    }
  }
}

let _timer = null;

function startEtfGexRecorder() {
  if (_timer) return;
  if (process.env.ETF_GEX_RECORDER === '0') {
    console.log('[etf-gex] recorder disabled (ETF_GEX_RECORDER=0)');
    return;
  }
  if (!SYMBOLS.length) return;
  _timer = setInterval(() => {
    tick().catch((e) => console.warn('[etf-gex] tick error:', e.message));
  }, INTERVAL_MS);
  if (_timer.unref) _timer.unref();
  // Stagger the first run behind the other recorders so boot doesn't fire a
  // burst of chain fetches at the same instant.
  setTimeout(() => {
    tick().catch((e) => console.warn('[etf-gex] initial tick error:', e.message));
  }, 25_000);
  console.log(
    `[etf-gex] recorder started — ${SYMBOLS.join('/')} per-strike GEX (RTH), ` +
    `${EXPIRY_DEPTH} expiry(s), every ${INTERVAL_MS / 1000}s`,
  );
}

module.exports = { startEtfGexRecorder, snapshotStrikes, resolveExpiries, tick };
