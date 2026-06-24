/**
 * probe-tas.js — one-off diagnostic: does dxLink stream TimeAndSale (TAS) for the
 * front ES future, and what fields/sizes come back vs the conflated Trade event?
 *
 * Subscribes BOTH TimeAndSale and Trade on the front ES symbol and logs each event
 * for RUN_SECONDS. Compares the max `size` seen on each so we can confirm whether
 * real block prints (e.g. 500 lots) arrive on TAS but get conflated away on Trade.
 *
 * Run from the repo (loads .env via the proxy module's own setup):
 *   node server-v2/probe-tas.js
 *
 * Best run during/near RTH — overnight ES flow is thin so few prints arrive.
 */
const path = require('path');
// Load .env.local the same way server-with-proxy.js does, BEFORE requiring the
// proxy (its module-level consts read env at load time).
require('dotenv').config({ path: path.join(path.resolve(__dirname, '..'), '.env.local'), override: true });

const WebSocket = require('ws');
const { getAccessToken, getQuoteToken } = require('./proxy-tastytrade');

const TT_BASE_URL = process.env.TT_BASE_URL || 'https://api.tastytrade.com';
const RUN_SECONDS = Number(process.env.PROBE_SECONDS || 60);

async function ttGet(path, token) {
  const res = await fetch(`${TT_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      // REQUIRED: the WAF in front of Tastytrade 401s requests sent with undici's
      // default User-Agent (same reason the proxy sets one).
      'User-Agent': process.env.TT_USER_AGENT || 'spx-gex-dashboard/1.0',
    },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

async function resolveFrontEs(accessToken) {
  const json = await ttGet('/instruments/futures?product-code[]=ES', accessToken);
  const items = json?.data?.items || [];
  const today = new Date().toISOString().slice(0, 10);
  const active = items
    .filter((it) => it['streamer-symbol'] && (it['expiration-date'] || '') >= today)
    .sort((a, b) => String(a['expiration-date']).localeCompare(String(b['expiration-date'])));
  const front = active[0] || items.find((it) => it['streamer-symbol']);
  if (!front?.['streamer-symbol']) throw new Error('No active ES future found');
  return front['streamer-symbol'];
}

(async () => {
  console.log('[TAS-PROBE] getting access token + quote token…');
  const accessToken = await getAccessToken();
  const { token, url } = await getQuoteToken();
  const esSym = await resolveFrontEs(accessToken);
  console.log(`[TAS-PROBE] front ES streamer symbol = ${esSym}`);
  console.log(`[TAS-PROBE] dxLink url = ${url}`);

  const ws = new WebSocket(url);
  const CH = 3;
  let keepalive = null;
  const maxSize = { TimeAndSale: 0, Trade: 0 };
  const count = { TimeAndSale: 0, Trade: 0 };

  const send = (o) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(o));

  ws.on('open', () => send({ type: 'SETUP', channel: 0, version: '0.1-probe', keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 }));

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.type) {
      case 'SETUP':
        send({ type: 'AUTH', channel: 0, token });
        break;
      case 'AUTH_STATE':
        if (msg.state === 'AUTHORIZED') {
          console.log('[TAS-PROBE] authorized; opening feed channel…');
          keepalive = setInterval(() => send({ type: 'KEEPALIVE', channel: 0 }), 30000);
          send({ type: 'CHANNEL_REQUEST', channel: CH, service: 'FEED', parameters: { contract: 'AUTO' } });
        } else if (msg.state === 'UNAUTHORIZED') {
          console.log('[TAS-PROBE] AUTH FAILED — token rejected.');
        }
        break;
      case 'CHANNEL_OPENED':
        if (msg.channel === CH) {
          // Request TAS + Trade. If the server rejects a field/event it errors here.
          send({
            type: 'FEED_SETUP',
            channel: CH,
            acceptAggregationPeriod: 0, // 0 = no conflation (full stream) where allowed
            acceptDataFormat: 'COMPACT',
            acceptEventFields: {
              TimeAndSale: ['eventType', 'eventSymbol', 'time', 'price', 'size', 'aggressorSide', 'exchangeCode', 'bidPrice', 'askPrice'],
              Trade: ['eventType', 'eventSymbol', 'price', 'size', 'dayVolume'],
            },
          });
          send({
            type: 'FEED_SUBSCRIPTION',
            channel: CH,
            add: [
              { type: 'TimeAndSale', symbol: esSym },
              { type: 'Trade', symbol: esSym },
            ],
          });
          console.log(`[TAS-PROBE] subscribed TimeAndSale + Trade on ${esSym}. Listening ${RUN_SECONDS}s…\n`);
        }
        break;
      case 'FEED_CONFIG':
        console.log(`[TAS-PROBE] FEED_CONFIG: dataFormat=${msg.dataFormat} aggregationPeriod=${msg.aggregationPeriod}`);
        break;
      case 'FEED_DATA': {
        // COMPACT: data = [ eventTypeName, [flat values...], eventTypeName, [...] ]
        const d = msg.data || [];
        for (let i = 0; i + 1 < d.length; i += 2) {
          const type = d[i];
          const vals = d[i + 1];
          if (!Array.isArray(vals)) continue;
          // vals is a flat concatenation of one-or-more events' fields. We declared
          // the field order above; walk it in chunks of that length.
          const fields = type === 'TimeAndSale'
            ? ['eventType', 'eventSymbol', 'time', 'price', 'size', 'aggressorSide', 'exchangeCode', 'bidPrice', 'askPrice']
            : ['eventType', 'eventSymbol', 'price', 'size', 'dayVolume'];
          for (let j = 0; j + fields.length <= vals.length; j += fields.length) {
            const ev = {};
            for (let k = 0; k < fields.length; k++) ev[fields[k]] = vals[j + k];
            const sz = Number(ev.size) || 0;
            count[type] = (count[type] || 0) + 1;
            if (sz > (maxSize[type] || 0)) maxSize[type] = sz;
            if (type === 'TimeAndSale') {
              console.log(`[TAS] size=${sz} px=${ev.price} aggressor=${ev.aggressorSide} ex=${ev.exchangeCode}`);
            } else if (sz >= 25) {
              console.log(`[Trade] size=${sz} px=${ev.price}`);
            }
          }
        }
        break;
      }
      case 'ERROR':
        console.log(`[TAS-PROBE] SERVER ERROR: ${JSON.stringify(msg)}`);
        break;
    }
  });

  ws.on('error', (e) => console.log(`[TAS-PROBE] ws error: ${e.message}`));

  setTimeout(() => {
    console.log('\n[TAS-PROBE] ── summary ──');
    console.log(`  TimeAndSale: ${count.TimeAndSale || 0} events, max size = ${maxSize.TimeAndSale || 0}`);
    console.log(`  Trade:       ${count.Trade || 0} events, max size = ${maxSize.Trade || 0}`);
    if ((count.TimeAndSale || 0) === 0) {
      console.log('  → No TAS events. Either no ES prints in window (thin/after-hours) OR TAS not permitted on this token.');
    }
    if (keepalive) clearInterval(keepalive);
    try { ws.close(); } catch {}
    process.exit(0);
  }, RUN_SECONDS * 1000);
})().catch((e) => { console.error('[TAS-PROBE] fatal:', e.message); process.exit(1); });
