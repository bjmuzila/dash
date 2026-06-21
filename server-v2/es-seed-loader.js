'use strict';
/**
 * server-v2/es-seed-loader.js
 *
 * One-shot loader that seeds the Footprint page with a transcribed ES time &
 * sales file (server-v2/data/es-seed-ts.json) when no live ES feed is running
 * (e.g. reviewing a past session after hours).
 *
 * It builds the same payload the live proxy produces — a ring buffer of big
 * prints plus per-minute signed-delta buckets — and pushes it to
 * marketState.esBigTrades. The seed is only (re)applied while the live ES feed
 * is quiet; once real prints start flowing, the proxy's own flush wins.
 *
 * Enable with ES_SEED=1 (optionally ES_SEED_FILE=/abs/path.json).
 *
 * Mirrors the proxy's thresholds so the bubbles match live:
 *   ES_BIG_TRADE_MIN, ES_BIG_TRADES_MAX, ES_DELTA_BUCKET_MS, ES_DELTA_BUCKETS_MAX
 */

const fs = require('fs');
const path = require('path');
const marketState = require('./state/market-state');

const BIG_MIN = Number(process.env.ES_BIG_TRADE_MIN || 1);
const BIG_MAX = Number(process.env.ES_BIG_TRADES_MAX || 400);
const BUCKET_MS = Number(process.env.ES_DELTA_BUCKET_MS || 60_000);
const BUCKETS_MAX = Number(process.env.ES_DELTA_BUCKETS_MAX || 60);

/**
 * Convert an ET wall-clock "HH:MM" on a given YYYY-MM-DD to an epoch-ms value.
 * Resolves the America/New_York UTC offset for that date so the timestamps land
 * on the right minute regardless of the host machine's timezone.
 */
function etToEpochMs(dateStr, hh, mm, ss) {
  // Build a UTC guess, then correct by NY's offset at that instant.
  const guess = Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)),
    hh, mm, ss
  );
  const tzName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', timeZoneName: 'shortOffset',
  }).formatToParts(new Date(guess)).find((p) => p.type === 'timeZoneName')?.value || 'GMT-5';
  const m = tzName.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  const offsetHours = m ? Number(m[1]) : -5;
  const offsetMin = m && m[2] ? Number(m[2]) : 0;
  const offsetMs = (offsetHours * 60 + Math.sign(offsetHours || 1) * offsetMin) * 60_000;
  // ET = UTC + offset  =>  UTC = ET - offset.
  return guess - offsetMs;
}

/** Assign each row a timestamp; rows sharing a minute are spread by arrival order. */
function buildTrades(seed) {
  const date = seed.date;
  const perMinute = new Map(); // "HH:MM" -> count seen so far
  const out = [];
  for (const r of seed.rows || []) {
    if (typeof r.time !== 'string' || !(r.size > 0)) continue;
    const [hh, mm] = r.time.split(':').map(Number);
    const key = r.time;
    const idx = perMinute.get(key) || 0;
    perMinute.set(key, idx + 1);
    // Spread within the minute: 1s gaps, capped under 60.
    const ss = Math.min(59, idx);
    const ts = etToEpochMs(date, hh, mm, ss);
    const side = r.side === 'sell' ? 'sell' : 'buy';
    const size = Number(r.size);
    out.push({ ts, price: Number(r.price), size, side, signed: side === 'buy' ? size : -size });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

/** Build the esBigTrades payload (big-print buffer + delta buckets) from rows. */
function buildPayload(seed) {
  const all = buildTrades(seed);
  const big = all.filter((t) => t.size >= BIG_MIN).slice(-BIG_MAX);

  const buckets = new Map();
  for (const t of all) {
    const start = Math.floor(t.ts / BUCKET_MS) * BUCKET_MS;
    const b = buckets.get(start) || { ts: start, buy: 0, sell: 0 };
    if (t.side === 'buy') b.buy += t.size; else b.sell += t.size;
    buckets.set(start, b);
  }
  const delta = [...buckets.values()]
    .sort((a, b) => a.ts - b.ts)
    .slice(-BUCKETS_MAX)
    .map((x) => ({ ts: x.ts, buy: x.buy, sell: x.sell, net: x.buy - x.sell }));

  return {
    symbol: seed.symbol || '/ESU6',
    updatedAt: Date.now(),
    seeded: true,
    trades: big,
    delta,
  };
}

/**
 * Load + apply the seed. Keeps it applied while the live feed is quiet; backs
 * off permanently once the live proxy publishes real (non-seed) prints.
 */
function startEsSeed({ log = console } = {}) {
  if (String(process.env.ES_SEED || '') !== '1') return;
  const file = process.env.ES_SEED_FILE
    ? path.resolve(process.env.ES_SEED_FILE)
    : path.join(__dirname, 'data', 'es-seed-ts.json');

  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    log.warn?.(`[ES-SEED] could not read ${file}: ${err.message}`);
    return;
  }

  const payload = buildPayload(seed);
  if (!payload.trades.length) {
    log.warn?.('[ES-SEED] no qualifying big prints in seed file');
    return;
  }

  const apply = () => {
    const cur = marketState.getState().esBigTrades;
    // Back off only once the LIVE feed has published REAL prints — an empty
    // {seeded:false} payload at startup must not disable the seed.
    if (cur && cur.seeded === false && Array.isArray(cur.trades) && cur.trades.length > 0) {
      log.log?.('[ES-SEED] live ES prints detected — handing off to live feed');
      stop();
      return;
    }
    marketState.setState({ esBigTrades: { ...payload, updatedAt: Date.now() } });
  };

  // Apply shortly after boot (after the initial snapshot is built) and refresh
  // periodically so a reconnecting client always gets the seeded footprint.
  const first = setTimeout(apply, 1500);
  const timer = setInterval(apply, 10_000);
  function stop() { clearTimeout(first); clearInterval(timer); }

  log.log?.(`[ES-SEED] seeded ${payload.trades.length} big prints + ${payload.delta.length} delta buckets from ${path.basename(file)}`);
  return stop;
}

module.exports = { startEsSeed, buildPayload };
