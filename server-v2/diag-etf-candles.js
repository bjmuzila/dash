'use strict';
/**
 * server-v2/diag-etf-candles.js — THROWAWAY DIAGNOSTIC (round 2). Delete when done.
 *
 * Round 1 established: SPY{=1m} with fromTime in MILLIS returns 1076 bars. So the
 * token, the entitlement, the symbol format and the fromTime units are all fine,
 * and the failure is inside fetchIntradayCandles rather than at the feed.
 *
 * The one thing that function does which the raw probe did NOT is filter events:
 *
 *     if (ev.eventType !== 'Candle' || ev.eventSymbol !== candleSymbol) return;
 *
 * `candleSymbol` is the string we SENT ("SPY{=1m}"). dxFeed is free to echo back a
 * canonicalized eventSymbol — extra attributes, reordered attributes, a price-type
 * suffix — and if it does, that === is false for every event and the function
 * resolves [] with no error. That would also explain why etf_candles has been
 * empty since the recorder shipped, not just for Friday.
 *
 * This prints the DISTINCT eventSymbols the feed actually sends, next to what we
 * compare against, and then calls the real fetchIntradayCandles in the same
 * process so the two results sit side by side.
 *
 *   node server-v2/diag-etf-candles.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(path.resolve(__dirname, '..'), '.env.local'), override: true });

const { getQuoteToken } = require('./proxy-tastytrade');
const { fetchIntradayCandles } = require('./candle-history');
const WebSocket = require('ws');

const SYM = 'SPY';
const IV = '1m';
const SENT = `${SYM}{=${IV}}`;
const FROM = Date.now() - 3 * 86_400_000;
const RUN_MS = 12_000;

// Mirrors COMPACT_FIELDS.Candle in proxy-tastytrade.js.
const CANDLE_FIELDS = ['eventType', 'eventSymbol', 'time', 'open', 'high', 'low', 'close', 'volume'];

function rawProbe({ token, url }) {
  return new Promise((resolve) => {
    const symbols = new Map(); // eventSymbol → count
    let sample = null, total = 0, done = false;
    const CH = 1;
    let ws;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* noop */ }
      resolve({ symbols, sample, total });
    };
    const send = (o) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };
    const timer = setTimeout(finish, RUN_MS);

    ws = new WebSocket(url);
    ws.on('open', () => send({ type: 'SETUP', channel: 0, version: '0.1-js', keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 }));
    ws.on('error', () => finish());
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'SETUP') send({ type: 'AUTH', channel: 0, token });
      else if (m.type === 'AUTH_STATE' && m.state === 'AUTHORIZED') {
        send({ type: 'CHANNEL_REQUEST', channel: CH, service: 'FEED', parameters: { contract: 'AUTO' } });
      } else if (m.type === 'CHANNEL_OPENED' && m.channel === CH) {
        send({
          type: 'FEED_SETUP', channel: CH, acceptAggregationPeriod: 1, acceptDataFormat: 'COMPACT',
          acceptEventFields: { Candle: CANDLE_FIELDS },
        });
        send({ type: 'FEED_SUBSCRIPTION', channel: CH, add: [{ type: 'Candle', symbol: SENT, fromTime: FROM }] });
      } else if (m.type === 'FEED_DATA' && Array.isArray(m.data)) {
        for (let i = 0; i < m.data.length; i += 2) {
          if (m.data[i] !== 'Candle') continue;
          const vals = m.data[i + 1];
          if (!Array.isArray(vals)) continue;
          const stride = CANDLE_FIELDS.length;
          for (let off = 0; off + stride <= vals.length; off += stride) {
            // Rebuild the event object EXACTLY as _handleFeedData does.
            const ev = {};
            for (let f = 0; f < stride; f++) ev[CANDLE_FIELDS[f]] = vals[off + f];
            total++;
            symbols.set(ev.eventSymbol, (symbols.get(ev.eventSymbol) || 0) + 1);
            if (!sample) sample = ev;
          }
        }
      }
    });
  });
}

(async () => {
  const { token, url } = await getQuoteToken();
  console.log(`token OK, url = ${url}`);
  console.log(`subscribing with symbol: ${JSON.stringify(SENT)}\n`);

  const { symbols, sample, total } = await rawProbe({ token, url });

  console.log(`raw probe: ${total} Candle events`);
  console.log('distinct eventSymbol values the feed sent back:');
  for (const [s, n] of symbols) {
    const match = s === SENT ? 'MATCHES the filter' : '!! DOES NOT MATCH !!';
    console.log(`   ${JSON.stringify(s)}  ×${n}   ${match}`);
  }
  if (sample) {
    console.log('\nsample event as _handleFeedData builds it:');
    console.log(`   ${JSON.stringify(sample)}`);
    console.log(`   Number(time)  = ${Number(sample.time)}  → ${new Date(Number(sample.time)).toISOString()}`);
    console.log(`   Number(close) = ${Number(sample.close)}   (must be > 0 to survive the filter)`);
  }

  console.log('\nnow the real fetchIntradayCandles, same process, same window:');
  const rows = await fetchIntradayCandles(SYM, IV, FROM, { cache: false, quietMs: 2_500, hardMs: 30_000 });
  console.log(`   returned ${rows.length} bars`);
  if (rows.length) {
    console.log(`   first ${new Date(rows[0].time).toISOString()}  last ${new Date(rows[rows.length - 1].time).toISOString()}`);
  }

  console.log('\nverdict:');
  if (total > 0 && rows.length === 0) {
    const bad = [...symbols.keys()].filter((s) => s !== SENT);
    console.log(`   feed delivers ${total} events but fetchIntradayCandles keeps 0.`);
    if (bad.length) console.log(`   cause: eventSymbol mismatch — feed says ${bad.map((b) => JSON.stringify(b)).join(', ')}, filter wants ${JSON.stringify(SENT)}`);
    else console.log('   eventSymbols DO match — cause is the close>0 filter or the settle timing, see the sample above');
  } else if (rows.length > 0) {
    console.log('   fetchIntradayCandles works here — the bug is in the recorder/upsert path, not the fetch');
  } else {
    console.log('   feed sent nothing this run — rerun; if it persists it is intermittent, not a filter bug');
  }
  process.exit(0);
})().catch((e) => { console.error('diag failed:', e); process.exit(1); });
