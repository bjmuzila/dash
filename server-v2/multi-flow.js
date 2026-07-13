'use strict';
/**
 * server-v2/multi-flow.js
 *
 * Multi-ticker options-flow streaming. The core feed engine (proxy-tastytrade.js)
 * is single-SYMBOL (SPX): it builds ONE chain, ONE active window, and streams
 * only SPX option trades into this.flow. That's correct for GEX/greeks but it
 * means the /flow page's non-SPX ticker chips never populate.
 *
 * MultiFlowManager runs ALONGSIDE that engine, flow-only (no GEX/greeks). For
 * each extra root in FLOW_TICKERS it:
 *   1. fetches the Theta chain (expirations + strikes),
 *   2. resolves spot (index vs. stock snapshot),
 *   3. picks the near-spot strike window of the nearest expiry,
 *   4. subscribes those contracts' TRADE+QUOTE on the SHARED ThetaStreamClient,
 *   5. re-picks the window periodically as spot drifts.
 *
 * Trade prints route into the SAME FlowProcessor (this.flow.addPrint). Because
 * addPrint records parsed.root as `underlying`, the tape becomes multi-ticker
 * with no change to the processor or the page.
 *
 * No-op unless DATA_SOURCE=theta and at least one FLOW_TICKERS entry is set.
 */

const thetaAdapter = require('./proxy-thetadata');
const { SYMBOLS: EM_SYMBOLS } = require('./em-tickers');
const { SCANNER_TICKERS } = require('./scanner-tickers');

// Indices priced via /index snapshot; everything else via /stock snapshot.
const INDEX_ROOTS = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'VIX', 'RUT', 'XSP', 'DJX']);

// How wide a strike band around spot to stream per root, as a % of spot.
const FLOW_STRIKE_WINDOW_PCT = Number(process.env.FLOW_STRIKE_WINDOW_PCT || 0.06);
// Max contracts (C+P rows) to stream per root, newest-window first, so a giant
// chain can't blow up the Theta subscription/bandwidth budget.
const FLOW_MAX_CONTRACTS = Number(process.env.FLOW_MAX_CONTRACTS || 120);
// How often to re-pick each root's window as spot moves (ms).
const FLOW_WINDOW_REFRESH_MS = Number(process.env.FLOW_WINDOW_REFRESH_MS || 5 * 60 * 1000);
// Match proxy-tastytrade: 1 = single STREAM_BULK firehose filtered to our roots,
// so adding tickers costs zero new subscriptions. Default = per-contract windows.
const FLOW_BULK_STREAM = process.env.FLOW_BULK_STREAM === '1';

// FLOW_FROM_EM=1 (or FLOW_TICKERS=EM) sources the flow roots from the Estimated-
// Moves roster (em-tickers.js SYMBOLS) instead of a hand-maintained FLOW_TICKERS
// list, so the two stay in sync. Futures (ESM/NQM = ESU/NQU) are excluded — they
// have no OPRA option chain. SPX/SPXW are dropped downstream (core engine owns them).
const FLOW_FROM_EM = process.env.FLOW_FROM_EM === '1'
  || String(process.env.FLOW_TICKERS || '').trim().toUpperCase() === 'EM';
// FLOW_TICKERS=SCANNER sources flow roots from the curated scanner universe
// (scanner-tickers.js) so the flow tape and the /scanner page share one list.
const FLOW_FROM_SCANNER = String(process.env.FLOW_TICKERS || '').trim().toUpperCase() === 'SCANNER';
const EM_FLOW_EXCLUDE = new Set(['ESM', 'NQM', 'ESU', 'NQU']);

function parseFlowTickers() {
  if (FLOW_FROM_SCANNER) {
    // ~100 roots — per-contract subscribing that many is a JVM sub meltdown, so
    // require bulk stream mode, same guard as the EM path.
    if (!FLOW_BULK_STREAM) {
      console.error('[MULTIFLOW] FLOW_TICKERS=SCANNER set but FLOW_BULK_STREAM!=1 — refusing to per-contract-subscribe ~100 roots. Set FLOW_BULK_STREAM=1. Staying SPX-only.');
      return [];
    }
    return SCANNER_TICKERS.filter((t) => !EM_FLOW_EXCLUDE.has(t));
  }
  if (FLOW_FROM_EM) {
    // The EM roster is ~200 roots. Per-contract subscribing that many would be
    // thousands of JVM subs (each root × up to FLOW_MAX_CONTRACTS) — the exact
    // meltdown bulk mode exists to avoid. Refuse unless bulk is on.
    if (!FLOW_BULK_STREAM) {
      console.error('[MULTIFLOW] FLOW_FROM_EM set but FLOW_BULK_STREAM!=1 — refusing to per-contract-subscribe the full EM roster. Set FLOW_BULK_STREAM=1. Staying SPX-only.');
      return [];
    }
    return EM_SYMBOLS.filter((t) => !EM_FLOW_EXCLUDE.has(t));
  }
  return String(process.env.FLOW_TICKERS || '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

class MultiFlowManager {
  /**
   * @param {object} opts
   * @param {object} opts.thetaStream  shared ThetaStreamClient (already connected)
   * @param {string[]} [opts.tickers]  extra roots; defaults to FLOW_TICKERS env
   */
  constructor({ thetaStream, tickers = parseFlowTickers() } = {}) {
    this.thetaStream = thetaStream;
    // Drop SPX/SPXW — the core engine already streams those into this.flow.
    this.tickers = [...new Set(tickers)].filter((t) => t !== 'SPX' && t !== 'SPXW');
    // root -> { chain, spot, subscribedKeys:Set }
    this.state = new Map();
    this.refreshTimer = null;
    this.started = false;
  }

  /** Resolve spot for a root: index snapshot for indices, stock snapshot else. */
  async _resolveSpot(root) {
    try {
      if (INDEX_ROOTS.has(root)) {
        const p = await thetaAdapter.fetchIndexPriceTheta(root);
        return p > 0 ? p : 0;
      }
      const q = await thetaAdapter.fetchStockQuoteTheta(root);
      return q && q.mark > 0 ? q.mark : (q && q.last > 0 ? q.last : 0);
    } catch {
      return 0;
    }
  }

  /** Pick the near-spot window of the nearest expiry for a root's chain. */
  _windowLegs(chain, spot) {
    if (!chain || !Array.isArray(chain.contracts) || !chain.contracts.length) return [];
    const expiry = (chain.expirations || [])[0];
    if (!expiry) return [];
    const expContracts = chain.contracts.filter((c) => c.expiration === expiry);
    if (!expContracts.length) return [];
    // If spot is unknown (stock snapshot gated/empty), DON'T center on 0 — that
    // grabs the lowest strikes (deep ITM calls / far OTM puts) which never trade.
    // Fall back to the chain's MEDIAN strike, which is near the money for a
    // symmetric chain, so we still subscribe the liquid strikes.
    let center = spot;
    if (!(center > 0)) {
      const strikes = [...new Set(expContracts.map((c) => c.strike))].sort((a, b) => a - b);
      center = strikes[Math.floor(strikes.length / 2)] || 0;
    }
    const band = center > 0 ? center * FLOW_STRIKE_WINDOW_PCT : Infinity;
    const legs = expContracts
      .filter((c) => center <= 0 || Math.abs(c.strike - center) <= band)
      // nearest-the-money first so the cap keeps the most relevant strikes
      .sort((a, b) => Math.abs(a.strike - center) - Math.abs(b.strike - center))
      .slice(0, FLOW_MAX_CONTRACTS)
      .map((c) => ({ strike: c.strike, type: c.type, expiration: c.expiration }));
    return legs;
  }

  /** Fetch chain + spot for one root and subscribe its near-spot window. */
  async _subscribeRoot(root) {
    if (!this.thetaStream) return;
    const thetaR = thetaAdapter.thetaRoot(root);
    // Bulk mode: no per-contract subs. Register the root in the firehose keep-list
    // and just refresh spot so isOtm tagging stays correct. Adding a ticker here
    // costs one Set entry + a spot lookup — no subscription growth on the JVM.
    if (FLOW_BULK_STREAM) {
      this.thetaStream.addBulkRoot(thetaR);
      const spot = await this._resolveSpot(root);
      // TEMP: tracing a cross-root spot leak (SPCX prints tagged with SPX's
      // spot). Log every rootSpot write so we can see which key gets which value.
      console.log(`[MULTIFLOW-SPOT] bulk write root=${root} thetaR=${thetaR} spot=${spot}`);
      if (spot > 0 && this.thetaStream.rootSpot) this.thetaStream.rootSpot.set(thetaR, spot);
      this.state.set(root, { spot, mode: 'bulk' });
      return;
    }
    let chain;
    try {
      chain = await thetaAdapter.fetchChainTheta(root);
    } catch (e) {
      console.warn(`[MULTIFLOW] chain fetch failed for ${root}: ${String(e?.message || e).slice(0, 120)}`);
      return;
    }
    const spot = await this._resolveSpot(root);
    const legs = this._windowLegs(chain, spot);
    if (!legs.length) {
      console.warn(`[MULTIFLOW] ${root}: no contracts in window (spot=${spot})`);
      return;
    }
    // Record spot per root so the stream client tags non-SPX prints' isOtm
    // against the correct underlying (keyed by the Theta root, e.g. SPXW).
    // TEMP: see [MULTIFLOW-SPOT] note above — tracing the cross-root spot leak.
    console.log(`[MULTIFLOW-SPOT] sub write root=${root} thetaR=${thetaR} spot=${spot}`);
    if (spot > 0 && this.thetaStream.rootSpot) this.thetaStream.rootSpot.set(thetaR, spot);
    // subscribeActive seeds the quote cache + sends TRADE+QUOTE per contract; the
    // stream client de-dupes its own sub list, so re-calling on window shift is safe.
    this.thetaStream.subscribeActive(legs, thetaR);
    this.state.set(root, { spot, expiry: legs[0].expiration, count: legs.length });
    console.log(`[MULTIFLOW] ${root} (root=${thetaR}) streaming ${legs.length} contracts, expiry ${legs[0].expiration}, spot ${spot}`);
  }

  /** Initial subscription pass for all configured tickers. */
  async start() {
    if (this.started) return;
    this.started = true;
    if (!this.tickers.length) {
      console.log('[MULTIFLOW] no FLOW_TICKERS configured — SPX-only flow.');
      return;
    }
    console.log(`[MULTIFLOW] starting flow streams for: ${this.tickers.join(', ')}`);
    for (const root of this.tickers) {
      // Sequential to keep Theta REST load gentle on startup.
      await this._subscribeRoot(root); // eslint-disable-line no-await-in-loop
    }
    this.refreshTimer = setInterval(() => this._refresh(), FLOW_WINDOW_REFRESH_MS);
    if (this.refreshTimer.unref) this.refreshTimer.unref();
  }

  /** Re-pick each root's window so the tape tracks spot as it drifts. */
  async _refresh() {
    for (const root of this.tickers) {
      await this._subscribeRoot(root).catch(() => {}); // eslint-disable-line no-await-in-loop
    }
  }

  stop() {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    this.started = false;
  }
}

module.exports = { MultiFlowManager, parseFlowTickers };
