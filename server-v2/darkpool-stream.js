'use strict';
/**
 * server-v2/darkpool-stream.js
 *
 * "Dark pool" prints aren't a distinct feed anywhere in the public tape — they're
 * off-exchange (ATS/dark-pool) executions that FINRA requires to be printed
 * through a Trade Reporting Facility (TRF). We identify them the same way every
 * retail dark-pool tool does: subscribe Theta's US Stock Full Trade Stream
 * (Stocks Pro tier) and keep only prints whose `exchange` code is a TRF.
 *
 * Theta Exchange codes (docs: Articles/Data-And-Requests/Values/Exchanges.html):
 *   57 = FINRA/NASDAQ Trade Reporting Facility (NQNX)
 *   58 = BSE Trade Reporting Facility (BTRF)
 *   59 = NYSE Trade Reporting Facility (NTRF)
 * All three are off-exchange prints (dark pools + internalizers report here);
 * there's no further per-venue breakout in the public SIP feed.
 *
 * This is a SEPARATE WS connection from ThetaStreamClient (proxy-thetadata.js)
 * — that class's _onMessage assumes an OPTION/INDEX contract shape (strike/right
 * or bare index root); a STOCK trade message (`{security_type:"STOCK", root}`,
 * no strike/right) would misroute into its index branch. Keeping this isolated
 * means a dark-pool bug can't touch the live GEX/options feed.
 *
 * Bulk-firehose mode only (STREAM_BULK sec_type STOCK) — one subscription for
 * every US stock trade, filtered client-side to a tracked-root keep-list so we
 * don't pay to process/store the other ~8000 tickers nobody asked about.
 */

const WebSocket = require('ws');
const { THETA_WS_URL } = require('./config/data-source');

const DARK_POOL_EXCHANGES = new Set([57, 58, 59]);
const EXCHANGE_NAMES = { 57: 'Nasdaq TRF', 58: 'BSE TRF', 59: 'NYSE TRF' };

// Indices have no stock listing / no dark-pool prints — never worth tracking.
const NON_TRACKABLE = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'RUTW', 'XSP', 'XSPW', 'VIX', 'DJX']);

function parseTickerList(raw) {
  return String(raw || '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

// Default keep-list mirrors the /flow page's DEFAULT_TICKERS (minus indices).
// Override/extend via DARKPOOL_TICKERS; chip-added tickers on the page get
// auto-tracked at read time via addRoot() (see darkpool-routes.js).
const DEFAULT_TRACKED = ['SPY', 'QQQ', 'META', 'TSLA', 'AMZN', 'AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMD'];

/**
 * Convert a Theta `date` (YYYYMMDD int/string) + `ms_of_day` (ms since ET
 * midnight) into an epoch-ms timestamp, DST-correct. Same two-pass
 * guess-then-correct trick the /flow page uses client-side for RTH bounds.
 */
function etMidnightUtcMs(yyyymmdd) {
  const s = String(yyyymmdd);
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  const guessUtc = Date.UTC(y, mo - 1, d, 0, 0, 0);
  const asET = new Date(new Date(guessUtc).toLocaleString('en-US', { timeZone: 'America/New_York' })).getTime();
  const asUTC = new Date(new Date(guessUtc).toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  return guessUtc + (asUTC - asET);
}
function thetaTradeTs(dateYyyymmdd, msOfDay) {
  const base = etMidnightUtcMs(dateYyyymmdd);
  const ms = Number(msOfDay);
  return base + (Number.isFinite(ms) ? ms : 0);
}
// ET session date (YYYY-MM-DD) for a Theta YYYYMMDD int, for the `date` column.
function ymdFromThetaDate(yyyymmdd) {
  const s = String(yyyymmdd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

class DarkpoolStreamClient {
  /**
   * @param {(print:{ts:number,date:string,underlying:string,seq:number,price:number,size:number,exchange:number}) => void} onDarkTrade
   */
  constructor({ onDarkTrade, tickers = [] } = {}) {
    this.onDarkTrade = onDarkTrade;
    this.tracked = new Set([...DEFAULT_TRACKED, ...parseTickerList(process.env.DARKPOOL_TICKERS), ...tickers].filter((t) => !NON_TRACKABLE.has(t)));
    this.ws = null;
    this.nextId = 1;
    this.connected = false;
    this.closing = false;
    this.subscribed = false;
  }

  /** Start (or grow) tracking a ticker at runtime — e.g. a chip added on /flow. */
  addRoot(ticker) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t || NON_TRACKABLE.has(t) || this.tracked.has(t)) return;
    this.tracked.add(t);
    console.log(`[DARKPOOL-WS] now tracking ${t} (${this.tracked.size} tickers)`);
  }

  isTracked(ticker) {
    return this.tracked.has(String(ticker || '').toUpperCase());
  }

  connect() {
    if (this.ws) return;
    this.closing = false;
    const ws = new WebSocket(THETA_WS_URL);
    this.ws = ws;
    ws.on('open', () => {
      this.connected = true;
      console.log(`[DARKPOOL-WS] connected ${THETA_WS_URL}; tracking ${[...this.tracked].join(',')}`);
      this._subscribe();
    });
    ws.on('message', (buf) => this._onMessage(buf));
    ws.on('close', () => {
      this.connected = false;
      this.subscribed = false;
      this.ws = null;
      if (this.closing) return;
      console.warn('[DARKPOOL-WS] closed — reconnecting in 2s');
      setTimeout(() => this.connect(), 2000);
    });
    ws.on('error', (e) => {
      console.warn('[DARKPOOL-WS] error:', String(e?.message || e).slice(0, 160));
      try { ws.close(); } catch { /* noop */ }
    });
  }

  stop() {
    this.closing = true;
    if (this.ws) { try { this.ws.close(); } catch { /* noop */ } }
  }

  _subscribe() {
    if (!this.connected || this.subscribed) return;
    this.subscribed = true;
    this._send({
      msg_type: 'STREAM_BULK',
      sec_type: 'STOCK',
      req_type: 'TRADE',
      add: true,
      id: this.nextId++,
    });
    console.log('[DARKPOOL-WS] STREAM_BULK STOCK TRADE subscribed');
  }

  _send(obj) {
    if (this.ws && this.connected) {
      try { this.ws.send(JSON.stringify(obj)); } catch { /* noop */ }
    }
  }

  _onMessage(buf) {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    const type = msg?.header?.type;
    const contract = msg?.contract;
    const trade = msg?.trade;
    if (type !== 'TRADE' || !contract || !trade) return;
    if (contract.security_type !== 'STOCK') return;

    const root = String(contract.root || '').toUpperCase();
    if (!root || !this.tracked.has(root)) return;

    const exchange = Number(trade.exchange);
    if (!DARK_POOL_EXCHANGES.has(exchange)) return; // lit-exchange print — not dark pool

    const price = Number(trade.price);
    const size = Number(trade.size);
    if (!(price > 0) || !(size > 0)) return;

    const dateInt = trade.date;
    const ts = thetaTradeTs(dateInt, trade.ms_of_day);
    const date = ymdFromThetaDate(dateInt);
    const seq = Number(trade.sequence) || 0;

    try {
      this.onDarkTrade({
        ts,
        date,
        underlying: root,
        seq,
        price,
        size,
        notional: price * size,
        exchange,
        exchangeName: EXCHANGE_NAMES[exchange] || String(exchange),
        condition: Number(trade.condition) || null,
      });
    } catch { /* never let one bad print kill the socket */ }
  }
}

module.exports = {
  DarkpoolStreamClient,
  DARK_POOL_EXCHANGES,
  EXCHANGE_NAMES,
  NON_TRACKABLE,
  thetaTradeTs,
  ymdFromThetaDate,
};
