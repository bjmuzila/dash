'use strict';
/**
 * scripts/backfill-es-1m.js
 *
 * One-shot backfill: pulls 1-minute RTH ES candles from dxLink (as far back
 * as dxFeed will serve) and upserts them into es_candles (intervalMinutes=1).
 *
 * Usage (from repo root on VPS or locally with a valid .env.local):
 *
 *   node scripts/backfill-es-1m.js
 *
 * Optional env overrides:
 *   BACKFILL_DAYS_BACK=730   how far back to request (dxFeed may cap it; default 730 = ~2yr)
 *   BACKFILL_DRY_RUN=1       parse + print stats but skip DB writes
 *   GEX_DEBUG=1              verbose per-candle logging
 *
 * How it works:
 *   1. Exchange TT refresh token -> access token.
 *   2. GET /api-quote-tokens  -> dxLink WS URL + quote token.
 *   3. Resolve front /ES streamer symbol (e.g. /ESU26:XCME).
 *   4. Open dxLink WS, run SETUP -> AUTH -> CHANNEL_REQUEST -> FEED_SETUP.
 *   5. Subscribe Candle "/ESU26:XCME{=1m}" with fromTime = now - BACKFILL_DAYS_BACK * 86400000.
 *   6. Collect all Candle events.  Filter to RTH (09:30–16:00 ET, Mon–Fri).
 *   7. Once the stream goes "live" (bar timestamp ≥ now - 5min), flush remaining
 *      rows to DB and exit. Also exits if no new candles arrive for 30s.
 *   8. Upsert into es_candles via ON CONFLICT("slotKey") DO UPDATE.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });

const WebSocket = require('ws');
const { Pool }  = require('pg');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const TT_BASE_URL      = process.env.TT_BASE_URL || 'https://api.tastytrade.com';
const TT_CLIENT_ID     = (process.env.TT_CLIENT_ID || process.env.CLIENT_ID || '').trim();
const TT_CLIENT_SECRET = (process.env.TT_CLIENT_SECRET || process.env.CLIENT_SECRET || '').trim();
const TT_REFRESH_TOKEN = (process.env.TT_REFRESH_TOKEN || process.env.REFRESH_TOKEN || '').trim();
const TT_UA            = process.env.TT_USER_AGENT || 'spx-gex-dashboard/1.0';
const DXLINK_WS_URL    = process.env.DXFEED_WS_URL || 'wss://tasty-openapi-ws.dxfeed.com/realtime';
const DAYS_BACK        = Number(process.env.BACKFILL_DAYS_BACK || 730);
const DRY_RUN          = process.env.BACKFILL_DRY_RUN === '1';
const DEBUG            = process.env.GEX_DEBUG === '1';

// ---------------------------------------------------------------------------
// DB pool (skip if DRY_RUN or no DATABASE_URL)
// ---------------------------------------------------------------------------
let pool = null;
if (!DRY_RUN && process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
      ? undefined
      : { rejectUnauthorized: false },
    max: 3,
    keepAlive: true,
  });
  pool.on('error', (e) => console.warn('[db] pool error:', e.message));
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------
async function getAccessToken() {
  const basic = Buffer.from(`${TT_CLIENT_ID}:${TT_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`${TT_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': TT_UA,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: TT_REFRESH_TOKEN }).toString(),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`OAuth failed: ${r.status} ${text.slice(0, 200)}`);
  return JSON.parse(text).access_token;
}

async function ttGet(path, token) {
  const r = await fetch(`${TT_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': TT_UA },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`TT GET ${path} failed: ${r.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function getQuoteToken(accessToken) {
  const json = await ttGet('/api-quote-tokens', accessToken);
  const token = json?.data?.token;
  const url   = json?.data?.['dxlink-url'] || DXLINK_WS_URL;
  if (!token) throw new Error('No dxLink quote token');
  return { token, url };
}

async function resolveFrontEs(accessToken) {
  const json = await ttGet('/instruments/futures?product-code=ES', accessToken);
  const items = json?.data?.items || [];
  const today = new Date().toISOString().slice(0, 10);
  const active = items
    .filter((it) => it['streamer-symbol'] && String(it['expiration-date'] || '') >= today)
    .sort((a, b) => String(a['expiration-date']).localeCompare(String(b['expiration-date'])));
  const front = active[0] || items.find((it) => it['streamer-symbol']);
  if (!front?.['streamer-symbol']) throw new Error('No active ES future found');
  return front['streamer-symbol']; // e.g. /ESU26:XCME
}

// ---------------------------------------------------------------------------
// RTH filter — 09:30..16:00 ET, Mon–Fri
// ---------------------------------------------------------------------------
const ET_OFFSET_MS = -5 * 3600_000; // EST; DST handled via Intl.DateTimeFormat below

function isRth(epochMs) {
  // Use Intl to get the true ET wall-clock fields (handles DST automatically).
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', weekday: 'short',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  const dow = parts.weekday; // 'Mon'..'Sun'
  if (dow === 'Sat' || dow === 'Sun') return false;
  const h = Number(parts.hour);
  const m = Number(parts.minute);
  const minOfDay = h * 60 + m;
  // 09:30 (570) inclusive .. 16:00 (960) exclusive
  return minOfDay >= 570 && minOfDay < 960;
}

// ---------------------------------------------------------------------------
// Slot key (1-minute granularity)
// ---------------------------------------------------------------------------
function etOneMinSlot(epochMs) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  const date    = `${parts.year}-${parts.month}-${parts.day}`;
  const hour    = parts.hour === '24' ? '00' : parts.hour;
  const time    = `${hour}:${parts.minute}`;
  const slotKey = `${date}T${time}`;
  // Floor to 1-min boundary
  const slotMs = Math.floor(epochMs / 60_000) * 60_000;
  return { slotKey, date, time, slotMs };
}

// ---------------------------------------------------------------------------
// DB upsert (batch)
// ---------------------------------------------------------------------------
async function flushToDB(candles) {
  if (!pool || !candles.length) return 0;
  let written = 0;
  for (const r of candles) {
    try {
      await pool.query(
        `INSERT INTO es_candles
           (timestamp,date,"slotKey",time,symbol,"intervalMinutes",source,open,high,low,close,volume,"avgVolume")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT("slotKey") DO UPDATE SET
           timestamp=EXCLUDED.timestamp,
           high=GREATEST(es_candles.high,EXCLUDED.high),
           low=LEAST(es_candles.low,EXCLUDED.low),
           close=EXCLUDED.close,
           volume=EXCLUDED.volume,
           "avgVolume"=EXCLUDED."avgVolume"`,
        [
          r.slotMs, r.date, r.slotKey, r.time,
          '/ES', 1, 'dxlink-backfill',
          r.open, r.high, r.low, r.close, r.volume, 0,
        ]
      );
      written++;
    } catch (e) {
      console.warn('[db] upsert error:', e.message.slice(0, 120));
    }
  }
  return written;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!TT_CLIENT_ID || !TT_CLIENT_SECRET || !TT_REFRESH_TOKEN) {
    throw new Error('Missing TT_CLIENT_ID / TT_CLIENT_SECRET / TT_REFRESH_TOKEN in .env.local');
  }

  console.log(`[backfill] Starting ES 1m RTH candle backfill`);
  console.log(`[backfill] DAYS_BACK=${DAYS_BACK}  DRY_RUN=${DRY_RUN}  DB=${pool ? 'yes' : 'no'}`);

  const accessToken  = await getAccessToken();
  console.log('[backfill] TT OAuth ok');

  const { token: quoteToken, url: wsUrl } = await getQuoteToken(accessToken);
  console.log(`[backfill] Quote token ok, WS=${wsUrl}`);

  const esStreamer = await resolveFrontEs(accessToken);
  const candleSymbol = `${esStreamer}{=1m}`;
  const fromTime = Date.now() - DAYS_BACK * 86_400_000;
  console.log(`[backfill] ES symbol: ${esStreamer}  candle: ${candleSymbol}`);
  console.log(`[backfill] fromTime: ${new Date(fromTime).toISOString()}  (${DAYS_BACK} days back)`);

  // Collected RTH candles keyed by slotKey (merge in case dxFeed sends partials)
  const candleMap = new Map(); // slotKey -> row
  let totalReceived = 0;
  let lastEventAt = Date.now();

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let channelOpen = false;
    let keepalive = null;

    const send = (obj) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    };

    const COMPACT_CANDLE_FIELDS = ['eventType', 'eventSymbol', 'time', 'open', 'high', 'low', 'close', 'volume'];

    // Idle-timeout: if no candle arrives for 30s, we've drained the history.
    const idleTimer = setInterval(async () => {
      if (Date.now() - lastEventAt > 30_000) {
        console.log('[backfill] 30s idle — stream drained. Wrapping up...');
        clearInterval(idleTimer);
        clearInterval(keepalive);
        ws.terminate();
        resolve();
      }
    }, 5_000);

    ws.on('open', () => {
      send({ type: 'SETUP', channel: 0, version: '0.1-js', keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 });
    });

    ws.on('error', (err) => {
      clearInterval(idleTimer);
      clearInterval(keepalive);
      reject(new Error(`WS error: ${err.message}`));
    });

    ws.on('close', () => {
      clearInterval(idleTimer);
      clearInterval(keepalive);
      resolve();
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {
        case 'SETUP':
          send({ type: 'AUTH', channel: 0, token: quoteToken });
          break;

        case 'AUTH_STATE':
          if (msg.state === 'AUTHORIZED') {
            keepalive = setInterval(() => send({ type: 'KEEPALIVE', channel: 0 }), 30_000);
            send({ type: 'CHANNEL_REQUEST', channel: 1, service: 'FEED', parameters: { contract: 'AUTO' } });
          }
          break;

        case 'CHANNEL_OPENED':
          if (msg.channel === 1) {
            send({
              type: 'FEED_SETUP',
              channel: 1,
              acceptAggregationPeriod: 1,
              acceptDataFormat: 'COMPACT',
              acceptEventFields: {
                Candle: COMPACT_CANDLE_FIELDS,
              },
            });
            channelOpen = true;
            // Subscribe 1m candle with historical fromTime
            send({
              type: 'FEED_SUBSCRIPTION',
              channel: 1,
              add: [{ type: 'Candle', symbol: candleSymbol, fromTime }],
            });
            console.log(`[backfill] Subscribed ${candleSymbol} from ${new Date(fromTime).toISOString()}`);
          }
          break;

        case 'FEED_DATA': {
          const data = msg.data;
          if (!Array.isArray(data)) break;
          for (let i = 0; i < data.length; i += 2) {
            if (data[i] !== 'Candle') continue;
            const values = data[i + 1];
            if (!Array.isArray(values)) continue;
            const stride = COMPACT_CANDLE_FIELDS.length;
            for (let off = 0; off + stride <= values.length; off += stride) {
              const ev = {};
              for (let f = 0; f < stride; f++) ev[COMPACT_CANDLE_FIELDS[f]] = values[off + f];

              const barTime = Number(ev.time);
              const open    = Number(ev.open);
              const high    = Number(ev.high);
              const low     = Number(ev.low);
              const close   = Number(ev.close);
              const volume  = Number(ev.volume) || 0;

              if (!(barTime > 0) || !(open > 0)) continue;
              if (!isRth(barTime)) continue;

              totalReceived++;
              lastEventAt = Date.now();

              const { slotKey, date, time, slotMs } = etOneMinSlot(barTime);
              const prev = candleMap.get(slotKey);
              candleMap.set(slotKey, prev
                ? {
                    ...prev,
                    high:   Math.max(prev.high, high),
                    low:    Math.min(prev.low, low),
                    close,
                    volume: Math.max(prev.volume, volume),
                  }
                : { slotMs, slotKey, date, time, open, high, low, close, volume }
              );

              if (DEBUG && totalReceived % 500 === 0) {
                console.log(`[backfill] ${totalReceived} RTH bars collected, latest: ${slotKey}`);
              }

              // Once the stream reaches "now" bars, we're live — drain for another
              // 30s then the idle timer will fire and close the connection.
              if (barTime >= Date.now() - 2 * 60_000) {
                if (DEBUG) console.log(`[backfill] Reached live bar at ${slotKey}`);
              }
            }
          }
          break;
        }

        case 'KEEPALIVE':
          break;
      }
    });
  });

  // ---- Write to DB ----
  const rows = [...candleMap.values()].sort((a, b) => a.slotMs - b.slotMs);
  const earliest = rows[0]?.slotKey ?? 'n/a';
  const latest   = rows[rows.length - 1]?.slotKey ?? 'n/a';

  console.log(`\n[backfill] ✓ Collected ${rows.length} RTH 1m bars`);
  console.log(`[backfill]   Range: ${earliest}  →  ${latest}`);

  if (DRY_RUN) {
    console.log('[backfill] DRY_RUN=1 — skipping DB writes. Done.');
  } else if (!pool) {
    console.log('[backfill] No DATABASE_URL — skipping DB writes. Done.');
  } else {
    console.log('[backfill] Writing to es_candles...');
    const written = await flushToDB(rows);
    console.log(`[backfill] ✓ Upserted ${written} rows into es_candles (intervalMinutes=1)`);
  }

  await pool?.end().catch(() => {});
  console.log('[backfill] Complete.');
}

main().catch((err) => {
  console.error('[backfill] FATAL:', err.message);
  process.exit(1);
});
