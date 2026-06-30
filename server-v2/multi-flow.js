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

// Indices priced via /index snapshot; everything else via /stock snapshot.
const INDEX_ROOTS = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'VIX', 'RUT', 'XSP', 'DJX']);

// How wide a strike band around spot to stream per root, as a % of spot.
const FLOW_STRIKE_WINDOW_PCT = Number(process.env.FLOW_STRIKE_WINDOW_PCT || 0.06);
// Max contracts (C+P rows) to stream per root, newest-window first, so a giant
// chain can't blow up the Theta subscription/bandwidth budget.
const FLOW_MAX_CONTRACTS = Number(process.env.FLOW_MAX_CONTRACTS || 120);
// How often to re-pick each root's window as spot moves (ms).
const FLOW_WINDOW_REFRESH_MS = Number(process.env.FLOW_WINDOW_REFRESH_MS || 5 * 60 * 1000);

function parseFlowTickers() {
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
    const band = spot > 0 ? spot * FLOW_STRIKE_WINDOW_PCT : Infinity;
    const legs = chain.contracts
      .filter((c) => c.expiration === expiry)
      .filter((c) => spot <= 0 || Math.abs(c.strike - spot) <= band)
      // nearest-the-money first so the cap keeps the most relevant strikes
      .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
      .slice(0, FLOW_MAX_CONTRACTS)
      .map((c) => ({ strike: c.strike, type: c.type, expiration: c.expiration }));
    return legs;
  }

  /** Fetch chain + spot for one root and subscribe its near-spot window. */
  async _subscribeRoot(root) {
    if (!this.thetaStream) return;
    const thetaR = thetaAdapter.thetaRoot(root);
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
