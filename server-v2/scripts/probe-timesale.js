'use strict';
/**
 * server-v2/scripts/probe-timesale.js
 *
 * Why this exists
 * ---------------
 * flow_prints shows SPX 0DTE TimeAndSale delivering a burst the minute a
 * contract is first subscribed and then NOTHING until the ±2% window shifts and
 * re-subscribes it (~every 15-17 min). Live tick-by-tick flow is therefore
 * missing for ~95% of the session, and what's left in the tape is conflated
 * `Trade` dribble off the wider chain.
 *
 * Three candidate causes, all in FEED_SETUP / FEED_SUBSCRIPTION, all fixable
 * differently. This probe opens its OWN dxLink connection (it does not touch the
 * running feed) and runs each config against the same handful of ATM 0DTE SPX
 * contracts, counting TimeAndSale events in the first SNAPSHOT_MS (the
 * subscribe-time snapshot) versus the rest of the window (genuine live stream).
 *
 *   A  baseline      exactly what proxy-tastytrade.js sends today
 *   B  no-agg        drop acceptAggregationPeriod (suspect: conflation)
 *   C  event-flags   add eventFlags + index to acceptEventFields.TimeAndSale
 *                    (suspect: indexed-event snapshot protocol needs them)
 *   D  from-time     time-series subscription entries {type,symbol,fromTime},
 *                    the same shape subscribeCandle() already uses
 *
 * The config whose LIVE column is non-zero is the fix. If every LIVE column is
 * zero, the problem is upstream of the protocol (entitlement / market quiet) and
 * the SNAPSHOT column tells you the socket is otherwise healthy.
 *
 * Run on the VPS:
 *   docker compose exec -T dashboard node server-v2/scripts/probe-timesale.js
 * Options:
 *   PROBE_SECONDS=40   per-config window (default 35)
 *   PROBE_CONTRACTS=12 how many ATM contracts to subscribe (default 10)
 *   PROBE_SYMBOL=SPX
 *
 * Read-only: no DB writes, no changes to the live feed's subscriptions.
 */

const WebSocket = require('ws');
const { fetchChain, fetchUnderlyingQuotes, getQuoteToken } = require('../proxy-tastytrade');

const SECONDS = Number(process.env.PROBE_SECONDS || 35);
const N_CONTRACTS = Number(process.env.PROBE_CONTRACTS || 10);
const SYMBOL = (process.env.PROBE_SYMBOL || 'SPX').toUpperCase();
const SNAPSHOT_MS = 5000; // events inside this window after subscribe = snapshot

const BASE_FIELDS = ['eventType', 'eventSymbol', 'time', 'price', 'size', 'aggressorSide'];
const FLAG_FIELDS = ['eventType', 'eventSymbol', 'eventFlags', 'index', 'time', 'price', 'size', 'aggressorSide'];

const CONFIGS = [
  { name: 'A baseline',    agg: 1,    fields: BASE_FIELDS, fromTime: false },
  { name: 'B no-agg',      agg: null, fields: BASE_FIELDS, fromTime: false },
  { name: 'C event-flags', agg: 1,    fields: FLAG_FIELDS, fromTime: false },
  { name: 'D from-time',   agg: 1,    fields: BASE_FIELDS, fromTime: true  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Nearest-the-money contracts on the front expiry. */
async function pickContracts() {
  const [{ expirations, contracts }, quotes] = await Promise.all([
    fetchChain(SYMBOL),
    fetchUnderlyingQuotes([SYMBOL]).catch(() => new Map()),
  ]);
  const q = quotes.get(SYMBOL) || {};
  const spot = Number(q.mark) > 0 ? Number(q.mark) : Number(q.last) || 0;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const expiry = expirations.filter((e) => e >= today)[0] || expirations[0];
  let legs = contracts.filter((c) => c.expiration === expiry && c.streamerSymbol);
  if (spot > 0) legs.sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
  legs = legs.slice(0, N_CONTRACTS);
  return { spot, expiry, legs };
}

/** Run ONE config on its own connection. Resolves with the tallies. */
function runConfig(cfg, url, token, symbols) {
  return new Promise((resolve) => {
    const CH = 1;
    let subscribedAt = 0;
    let snapshot = 0, live = 0;
    const perSymbol = new Map();
    const seenTypes = new Set();
    let feedConfig = null;
    let errored = null;
    let done = false;

    const ws = new WebSocket(url);
    const finish = () => {
      if (done) return; done = true;
      try { ws.close(); } catch { /* noop */ }
      resolve({ cfg: cfg.name, snapshot, live, symbols: perSymbol.size, feedConfig, errored, seenTypes: [...seenTypes] });
    };
    const timer = setTimeout(finish, SECONDS * 1000 + 8000); // hard stop
    const send = (o) => { try { ws.send(JSON.stringify(o)); } catch { /* noop */ } };

    ws.on('open', () => send({ type: 'SETUP', channel: 0, version: '0.1-probe', keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 }));
    ws.on('error', (e) => { errored = String(e && e.message || e).slice(0, 120); clearTimeout(timer); finish(); });

    ws.on('message', async (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      switch (m.type) {
        case 'SETUP':
          send({ type: 'AUTH', channel: 0, token });
          break;
        case 'AUTH_STATE':
          if (m.state === 'AUTHORIZED') {
            setInterval(() => send({ type: 'KEEPALIVE', channel: 0 }), 25000).unref();
            send({ type: 'CHANNEL_REQUEST', channel: CH, service: 'FEED', parameters: { contract: 'AUTO' } });
          } else if (m.state === 'UNAUTHORIZED') {
            errored = 'UNAUTHORIZED'; clearTimeout(timer); finish();
          }
          break;
        case 'CHANNEL_OPENED': {
          const setup = {
            type: 'FEED_SETUP',
            channel: CH,
            acceptDataFormat: 'COMPACT',
            acceptEventFields: { TimeAndSale: cfg.fields },
          };
          if (cfg.agg != null) setup.acceptAggregationPeriod = cfg.agg;
          send(setup);
          // fromTime = 60s back: enough to prove a time-series sub replays, without
          // pulling the whole session into the snapshot tally.
          const from = Date.now() - 60_000;
          const add = symbols.map((s) => (cfg.fromTime
            ? { type: 'TimeAndSale', symbol: s, fromTime: from }
            : { type: 'TimeAndSale', symbol: s }));
          send({ type: 'FEED_SUBSCRIPTION', channel: CH, add });
          subscribedAt = Date.now();
          await sleep(SECONDS * 1000);
          clearTimeout(timer);
          finish();
          break;
        }
        case 'FEED_CONFIG':
          // Server echoes the aggregation period + field layout it ACTUALLY applied,
          // which is not always what was asked for — worth seeing.
          feedConfig = { aggregationPeriod: m.aggregationPeriod, dataFormat: m.dataFormat };
          break;
        case 'FEED_DATA': {
          const data = m.data;
          if (!Array.isArray(data)) break;
          for (let i = 0; i < data.length; i += 2) {
            const evType = data[i];
            const values = data[i + 1];
            seenTypes.add(evType);
            if (evType !== 'TimeAndSale' || !Array.isArray(values)) continue;
            const stride = cfg.fields.length;
            const symIdx = cfg.fields.indexOf('eventSymbol');
            for (let off = 0; off + stride <= values.length; off += stride) {
              const age = Date.now() - subscribedAt;
              if (age <= SNAPSHOT_MS) snapshot++; else live++;
              const sym = values[off + symIdx];
              perSymbol.set(sym, (perSymbol.get(sym) || 0) + 1);
            }
          }
          break;
        }
        default: break;
      }
    });
  });
}

(async () => {
  const { spot, expiry, legs } = await pickContracts();
  if (!legs.length) { console.error('no contracts resolved — is the chain reachable?'); process.exit(1); }
  const symbols = legs.map((c) => c.streamerSymbol);
  console.log(`${SYMBOL} spot=${spot || '(unknown)'} expiry=${expiry}`);
  console.log(`subscribing ${symbols.length} nearest-the-money contracts, ${SECONDS}s per config`);
  console.log(`strikes: ${[...new Set(legs.map((c) => c.strike))].sort((a, b) => a - b).join(', ')}`);
  console.log(`first 3 symbols: ${symbols.slice(0, 3).join('  ')}`);
  console.log(`(events in the first ${SNAPSHOT_MS / 1000}s after subscribe count as SNAPSHOT, the rest as LIVE)\n`);

  const { token, url } = await getQuoteToken();
  const rows = [];
  for (const cfg of CONFIGS) {
    process.stdout.write(`running ${cfg.name} … `);
    const r = await runConfig(cfg, url, token, symbols); // eslint-disable-line no-await-in-loop
    rows.push({
      config: r.cfg,
      SNAPSHOT: r.snapshot,
      LIVE: r.live,
      'live/sec': (r.live / Math.max(1, SECONDS - SNAPSHOT_MS / 1000)).toFixed(2),
      contracts: r.symbols,
      aggApplied: r.feedConfig ? r.feedConfig.aggregationPeriod : '?',
      error: r.errored || '',
    });
    console.log(`snapshot=${r.snapshot} live=${r.live}${r.errored ? ` ERROR=${r.errored}` : ''}`);
  }

  console.log('');
  console.table(rows);
  const winner = rows.filter((r) => r.LIVE > 0).sort((a, b) => b.LIVE - a.LIVE)[0];
  console.log(winner
    ? `\n=> ${winner.config} streams live (${winner.LIVE} events). That's the fix.`
    : '\n=> NO config streamed live. Protocol is not the cause — look at entitlement, or re-run during active trading.');
  process.exit(0);
})().catch((e) => { console.error('probe failed:', e && e.stack || e); process.exit(1); });
