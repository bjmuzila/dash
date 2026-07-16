'use strict';
/**
 * scripts/backfill-es-1m.js
 *
 * One-shot backfill: pulls RTH ES candles from dxLink (as far back as dxFeed
 * will serve) and upserts them into es_candles at the requested aggregation.
 *
 * ⚠ REQUIRES the composite key. Run scripts/migrate-es-candles-composite-key.sql
 *   before this script. Against the old UNIQUE("slotKey") schema, a 1m pull
 *   silently overwrote the close+volume of every 5m bar on a :00/:05/:10 minute
 *   (slotKey has no interval in it, so the two collide). On the migrated schema
 *   the conflict target below names both columns and they coexist.
 *
 * Usage (from repo root on VPS or locally with a valid .env.local):
 *
 *   node scripts/backfill-es-1m.js                       # 1m, full history
 *   BACKFILL_INTERVAL=5 BACKFILL_FROM=2026-06-23 \
 *   BACKFILL_TO=2026-06-30 node scripts/backfill-es-1m.js   # repair a 5m window
 *
 * Optional env overrides:
 *   BACKFILL_INTERVAL=1|5    aggregation to pull → dxLink {=Nm} + intervalMinutes (default 1)
 *   BACKFILL_RTH_ONLY=0      include overnight/ETH bars (default: RTH only, 09:30-16:00 ET).
 *                            The live recorder stores ETH, so use 0 to match it.
 *   BACKFILL_FROM=YYYY-MM-DD only write bars on/after this ET date (default: no floor)
 *   BACKFILL_TO=YYYY-MM-DD   only write bars on/before this ET date (default: no ceiling)
 *   BACKFILL_DAYS_BACK=730   how far back to request (dxFeed may cap it; default 730 = ~2yr)
 *   BACKFILL_DRY_RUN=1       parse + print stats but skip DB writes
 *   GEX_DEBUG=1              verbose per-candle logging
 *
 * How it works:
 *   1. Exchange TT refresh token -> access token.
 *   2. GET /api-quote-tokens  -> dxLink WS URL + quote token.
 *   3. Resolve front /ES streamer symbol (e.g. /ESU26:XCME).
 *   4. Open dxLink WS, run SETUP -> AUTH -> CHANNEL_REQUEST -> FEED_SETUP.
 *   5. Subscribe Candle "/ESU26:XCME{=Nm}" with fromTime = now - BACKFILL_DAYS_BACK * 86400000.
 *   6. Collect all Candle events.  Filter to RTH (09:30–16:00 ET, Mon–Fri) and
 *      to the optional BACKFILL_FROM/TO date window.
 *   7. Once the stream goes "live" (bar timestamp ≥ now - 5min), flush remaining
 *      rows to DB and exit. Also exits if no new candles arrive for 30s.
 *   8. Upsert into es_candles via ON CONFLICT("slotKey","intervalMinutes").
 *
 * Repairing a damaged 5m range is safe and idempotent: `open` is never updated,
 * high/low use GREATEST/LEAST (a fresh 5m bar's range equals the stored one), and
 * close/volume are overwritten outright — which is exactly what was broken.
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
// Which aggregation to pull: 1 or 5. Drives BOTH the dxLink subscription
// ("{=1m}"/"{=5m}") and the intervalMinutes column, so a 5m pull repairs the 5m
// rows in place and a 1m pull lands beside them.
const INTERVAL         = Number(process.env.BACKFILL_INTERVAL || 1);
// Optional ET date window (inclusive), 'YYYY-MM-DD'. Bars outside are dropped
// before any write. Used to repair a specific damaged range without rewriting
// history that was never broken.
const FROM_DATE        = (process.env.BACKFILL_FROM || '').trim() || null;
const TO_DATE          = (process.env.BACKFILL_TO   || '').trim() || null;
// RTH-only filter. Defaults ON (the script's original behaviour), but the LIVE
// recorder in proxy-tastytrade.js does NOT filter — it stores overnight bars too.
// So an RTH-only backfill leaves a history with no ETH sitting next to live data
// that has it, and the chart shows a gap every night before the deploy.
// BACKFILL_RTH_ONLY=0 pulls the full 23h Globex session to match the recorder.
const RTH_ONLY         = process.env.BACKFILL_RTH_ONLY !== '0';

if (INTERVAL !== 1 && INTERVAL !== 5) {
  console.error(`[backfill] BACKFILL_INTERVAL must be 1 or 5 (got ${INTERVAL})`);
  process.exit(1);
}
// Continuous contract symbol override — dxFeed serves the rolling front-month
// under /ES:XCME (no contract month code). Set ES_CANDLE_SYMBOL to override.
const ES_CANDLE_SYMBOL = process.env.ES_CANDLE_SYMBOL || null;

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
// Slot key, floored to INTERVAL minutes.
//
// NOTE the shape of the key: 'YYYY-MM-DDTHH:MM' with NO interval in it. That is
// deliberate (it matches the 5m writer in proxy-tastytrade.js) and it is why
// es_candles must be keyed UNIQUE("slotKey","intervalMinutes") — on slotKey
// alone, the 1m bar at 09:30 and the 5m bar at 09:30 are the same row, and this
// script's upsert overwrote the 5m close+volume with 1m values for every
// :00/:05/:10 minute. See scripts/migrate-es-candles-composite-key.sql.
// ---------------------------------------------------------------------------
function etSlot(epochMs, intervalMin) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  const date    = `${parts.year}-${parts.month}-${parts.day}`;
  const hour    = parts.hour === '24' ? '00' : parts.hour;
  // Floor the ET minute to the interval so a 5m pull yields :00/:05/:10… exactly
  // as the live 5m writer does — otherwise a re-pull would create NEW rows next
  // to the real ones instead of repairing them.
  const slotMin = String(Math.floor(Number(parts.minute || '0') / intervalMin) * intervalMin).padStart(2, '0');
  const time    = `${hour}:${slotMin}`;
  const slotKey = `${date}T${time}`;
  const slotMs  = Math.floor(epochMs / (intervalMin * 60_000)) * (intervalMin * 60_000);
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
        // ON CONFLICT MUST name ("slotKey","intervalMinutes"). With slotKey alone
        // this statement is what corrupted 468 five-minute rows on 2026-06-23→30:
        // every 1m bar on a :00/:05/:10 minute matched the 5m row of the same
        // clock time and replaced its close+volume — while leaving
        // intervalMinutes reading 5, so nothing looked wrong.
        //
        // `high`/`low` use GREATEST/LEAST and `open` is untouched, which is why a
        // clean re-pull fully repairs those rows rather than half-fixing them.
        `INSERT INTO es_candles
           (timestamp,date,"slotKey",time,symbol,"intervalMinutes",source,open,high,low,close,volume,"avgVolume")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT("slotKey","intervalMinutes") DO UPDATE SET
           timestamp=EXCLUDED.timestamp,
           high=GREATEST(es_candles.high,EXCLUDED.high),
           low=LEAST(es_candles.low,EXCLUDED.low),
           close=EXCLUDED.close,
           volume=EXCLUDED.volume,
           "avgVolume"=EXCLUDED."avgVolume"`,
        [
          r.slotMs, r.date, r.slotKey, r.time,
          '/ES', INTERVAL, `dxlink-backfill-${INTERVAL}m`,
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

  console.log(`[backfill] Starting ES ${INTERVAL}m RTH candle backfill`);
  console.log(`[backfill] DAYS_BACK=${DAYS_BACK}  DRY_RUN=${DRY_RUN}  DB=${pool ? 'yes' : 'no'}`);

  const accessToken  = await getAccessToken();
  console.log('[backfill] TT OAuth ok');

  const { token: quoteToken, url: wsUrl } = await getQuoteToken(accessToken);
  console.log(`[backfill] Quote token ok, WS=${wsUrl}`);

  const esStreamer = ES_CANDLE_SYMBOL || await resolveFrontEs(accessToken);
  // dxLink aggregates server-side by the {=Nm} suffix, so this is what decides
  // whether we get 1m or 5m bars — it must track INTERVAL, not be hardcoded.
  const candleSymbol = `${ES_CANDLE_SYMBOL || esStreamer}{=${INTERVAL}m}`;
  const fromTime = Date.now() - DAYS_BACK * 86_400_000;
  console.log(`[backfill] ES symbol: ${esStreamer}  candle: ${candleSymbol}`);
  console.log(`[backfill] interval: ${INTERVAL}m  →  intervalMinutes=${INTERVAL}  session=${RTH_ONLY ? 'RTH only' : 'RTH + ETH'}`);
  console.log(`[backfill] fromTime: ${new Date(fromTime).toISOString()}  (${DAYS_BACK} days back)`);
  if (FROM_DATE || TO_DATE) {
    console.log(`[backfill] ET date window: ${FROM_DATE || '-inf'} .. ${TO_DATE || '+inf'} (inclusive)`);
  }

  // Collected RTH candles keyed by slotKey (merge in case dxFeed sends partials)
  const candleMap = new Map(); // slotKey -> row
  let totalReceived = 0;
  let lastEventAt = Date.now();
  let doneReason = null; // set by the ingest loop to request a clean shutdown

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let channelOpen = false;
    let keepalive = null;

    const send = (obj) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    };

    const COMPACT_CANDLE_FIELDS = ['eventType', 'eventSymbol', 'time', 'open', 'high', 'low', 'close', 'volume'];

    // Shutdown watcher. TWO independent exits, because the idle timer ALONE
    // deadlocks during RTH: a live {=Nm} subscription pushes an update to the
    // forming bar every few seconds, so `lastEventAt` never goes stale, the
    // stream never looks "drained", and the script runs forever — while
    // flushToDB (which only runs after this promise resolves) never fires. A
    // Ctrl-C at that point writes NOTHING. That is not a hypothetical: it is
    // exactly what happened trying to repair 2026-06-23→30 at 1:20pm ET.
    //
    //   1. doneReason — set by the ingest loop once bars arrive PAST the target
    //      window (history drained) or once we reach live bars. Deterministic,
    //      and works fine mid-session.
    //   2. idle 30s — the original fallback, still correct out of hours.
    const finish = (reason) => {
      console.log(`[backfill] ${reason} — wrapping up...`);
      clearInterval(idleTimer);
      clearInterval(keepalive);
      ws.terminate();
      resolve();
    };
    const idleTimer = setInterval(() => {
      if (doneReason) return finish(doneReason);
      if (Date.now() - lastEventAt > 30_000) return finish('30s idle — stream drained');
    }, 2_000);

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
              if (RTH_ONLY && !isRth(barTime)) continue;

              totalReceived++;
              lastEventAt = Date.now();

              const { slotKey, date, time, slotMs } = etSlot(barTime, INTERVAL);
              // Optional repair window — drop anything outside it before it can
              // touch rows that were never broken.
              if (FROM_DATE && date < FROM_DATE) continue;
              if (TO_DATE && date > TO_DATE) {
                // dxFeed streams history in ascending time, so the first bar past
                // TO_DATE proves the window is fully drained. Stop HERE rather
                // than waiting for an idle gap that never comes during RTH.
                if (!doneReason && candleMap.size) doneReason = `passed BACKFILL_TO (${TO_DATE})`;
                continue;
              }
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

              // Reaching a live bar means history is drained. This USED to just
              // log and lean on the 30s idle timer to exit — which works after
              // the close but deadlocks during RTH, because the forming bar keeps
              // ticking and the stream never goes idle. Request shutdown here.
              if (barTime >= Date.now() - 2 * 60_000) {
                if (!doneReason) doneReason = `reached live bar at ${slotKey}`;
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

  console.log(`\n[backfill] ✓ Collected ${rows.length} RTH ${INTERVAL}m bars`);
  console.log(`[backfill]   Range: ${earliest}  →  ${latest}`);

  if (DRY_RUN) {
    console.log('[backfill] DRY_RUN=1 — skipping DB writes. Done.');
  } else if (!pool) {
    console.log('[backfill] No DATABASE_URL — skipping DB writes. Done.');
  } else {
    console.log('[backfill] Writing to es_candles...');
    const written = await flushToDB(rows);
    console.log(`[backfill] ✓ Upserted ${written} rows into es_candles (intervalMinutes=${INTERVAL})`);
  }

  await pool?.end().catch(() => {});
  console.log('[backfill] Complete.');
}

main().catch((err) => {
  console.error('[backfill] FATAL:', err.message);
  process.exit(1);
});
