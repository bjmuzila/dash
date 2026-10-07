#!/usr/bin/env node
'use strict';
/**
 * server-v2/scripts/lse-ws-probe.js — one-off probe of the LSE options websocket.
 *
 * Answers the questions that decide whether the Top Flow sweep can move off
 * REST polling and onto the stream (2026-10-07):
 *
 *   1. Is an options "tick" a TRADE (a print, with size) or a QUOTE update?
 *      Only trades can replace /options/flow.
 *   2. Does a tick carry bid/ask at the moment of the print? Then the side
 *      (bought at the ask / sold at the bid) comes for free, no quote lookup.
 *   3. How heavy is one underlying's chain — ticks/sec and bytes/min? Streamed
 *      bytes count against the MONTHLY data allowance, so this sets the cost.
 *   4. Which underlyings have options at all (the docs say 56).
 *
 * Read-only: subscribes, listens, prints a summary, disconnects. Opens no REST
 * calls except one GET /usage at the end (counts as one request).
 *
 *   node server-v2/scripts/lse-ws-probe.js [UNDERLYING=SPY] [SECONDS=60]
 *
 * Uses LSE_API_KEY_2 if set, else LSE_API_KEY. The key is never printed.
 */

const UNDERLYING = (process.argv[2] || 'SPY').toUpperCase();
const SECONDS = Math.max(10, Math.min(600, Number(process.argv[3]) || 60));
const WS_URL = 'wss://data-ws.londonstrategicedge.com';
const KEY = String(process.env.LSE_API_KEY_2 || process.env.LSE_API_KEY || '').trim();
if (!KEY) { console.error('No LSE_API_KEY / LSE_API_KEY_2 in env'); process.exit(1); }

let WS = globalThis.WebSocket;
if (!WS) { try { WS = require('ws'); } catch { console.error('No WebSocket (Node <22 and no `ws` package)'); process.exit(1); } }

const stats = {
  ticks: 0, bytes: 0, symbols: new Set(), withVolume: 0, withBidAsk: 0,
  atAsk: 0, atBid: 0, between: 0, bigPremium: 0, maxPremium: 0, samples: [], keys: new Set(),
};
let optionsUnderlyings = null;
let subscribedInfo = null;
let started = 0;

const ws = new WS(WS_URL);
const send = (o) => ws.send(JSON.stringify(o));

function onMessage(raw) {
  const text = typeof raw === 'string' ? raw : (raw && raw.data !== undefined ? raw.data : String(raw));
  stats.bytes += Buffer.byteLength(String(text));
  let m;
  try { m = JSON.parse(text); } catch { return; }
  switch (m.type) {
    case 'welcome':
      send({ action: 'auth', api_key: KEY });
      break;
    case 'authenticated':
      console.log(`authenticated — ${Array.isArray(m.symbols) ? m.symbols.length : '?'} symbols in catalog`);
      send({ action: 'list_symbols', category: 'options' });
      send({ action: 'subscribe_options', underlying: UNDERLYING });
      break;
    case 'symbols': {
      const list = Array.isArray(m.symbols) ? m.symbols : [];
      optionsUnderlyings = list.map((s) => (typeof s === 'string' ? s : s.symbol)).filter(Boolean);
      break;
    }
    case 'options_subscribed':
      subscribedInfo = m;
      started = Date.now();
      console.log(`options_subscribed ${UNDERLYING}: ${m.contracts} contracts (count ${m.count}/${m.max}) — listening ${SECONDS}s…`);
      setTimeout(finish, SECONDS * 1000);
      break;
    case 'tick': {
      stats.ticks += 1;
      Object.keys(m).forEach((k) => stats.keys.add(k));
      stats.symbols.add(m.symbol);
      const vol = Number(m.volume);
      const px = Number(m.price);
      const bid = Number(m.bid);
      const ask = Number(m.ask);
      if (vol > 0) stats.withVolume += 1;
      if (bid > 0 && ask > 0) {
        stats.withBidAsk += 1;
        if (px >= ask) stats.atAsk += 1;
        else if (px <= bid) stats.atBid += 1;
        else stats.between += 1;
      }
      const prem = vol > 0 && px > 0 ? vol * px * 100 : 0;
      if (prem >= 50_000) stats.bigPremium += 1;
      if (prem > stats.maxPremium) stats.maxPremium = prem;
      if (stats.samples.length < 8) stats.samples.push(m);
      break;
    }
    case 'error':
      console.log(`error ${m.code}: ${m.message}`);
      if (m.code === 'INVALID_KEY' || m.code === 'QUOTA_EXCEEDED' || m.code === 'INVALID_UNDERLYING') finish();
      break;
    default:
      break;
  }
}

if (typeof ws.on === 'function') {
  ws.on('message', (d) => onMessage(d.toString()));
  ws.on('error', (e) => { console.error('ws error', e.message); process.exit(1); });
} else {
  ws.onmessage = (ev) => onMessage(ev.data);
  ws.onerror = (e) => { console.error('ws error', e && e.message ? e.message : e); process.exit(1); };
}

let done = false;
async function finish() {
  if (done) return;
  done = true;
  try { send({ action: 'unsubscribe_options', underlying: UNDERLYING }); } catch { /* closing anyway */ }
  try { ws.close(); } catch { /* ignore */ }
  const secs = started ? (Date.now() - started) / 1000 : SECONDS;
  const pct = (n) => (stats.ticks ? `${((n / stats.ticks) * 100).toFixed(1)}%` : '—');
  console.log('\n──── RESULT ────');
  console.log(`underlying           ${UNDERLYING}  (${subscribedInfo ? subscribedInfo.contracts : '?'} contracts)`);
  console.log(`listened             ${secs.toFixed(0)}s`);
  console.log(`ticks                ${stats.ticks}  (${(stats.ticks / secs).toFixed(1)}/s)`);
  console.log(`contracts that ticked ${stats.symbols.size}`);
  console.log(`bytes                ${(stats.bytes / 1024).toFixed(0)} KB  → ~${((stats.bytes / secs) * 60 * 390 / 1024 / 1024).toFixed(0)} MB per 6.5h session`);
  console.log(`fields seen          ${[...stats.keys].join(', ')}`);
  console.log(`with volume > 0      ${pct(stats.withVolume)}   ← ~100% = trades, ~0% = quotes`);
  console.log(`with bid AND ask     ${pct(stats.withBidAsk)}`);
  console.log(`  at/above ask       ${pct(stats.atAsk)}`);
  console.log(`  at/below bid       ${pct(stats.atBid)}`);
  console.log(`  between            ${pct(stats.between)}`);
  console.log(`premium ≥ $50K       ${stats.bigPremium} ticks (max $${Math.round(stats.maxPremium).toLocaleString()})  ← if volume = per-print size`);
  console.log(`options underlyings  ${optionsUnderlyings ? `${optionsUnderlyings.length}: ${optionsUnderlyings.join(' ')}` : 'not returned'}`);
  console.log('\nsample ticks:');
  for (const s of stats.samples) console.log(' ', JSON.stringify(s));

  // Monthly allowance — one REST request.
  try {
    const r = await fetch('https://api.londonstrategicedge.com/vault/usage', {
      headers: { 'x-api-key': KEY, 'User-Agent': 'lse-data-sdk (+https://londonstrategicedge.com)' },
    });
    console.log(`\nGET /usage → ${r.status} ${(await r.text()).slice(0, 400)}`);
  } catch (e) {
    console.log(`\nGET /usage failed: ${e.message}`);
  }
  process.exit(0);
}

setTimeout(() => { if (!started) { console.log('never got options_subscribed — giving up'); finish(); } }, 30_000);
