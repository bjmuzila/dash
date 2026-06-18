/**
 * Fetches the SPXW option chain for a given expiry from TastyTrade REST.
 * Uses /option-chains/SPXW/nested which returns OI data for all strikes.
 * Greeks are estimated analytically (Gaussian) since REST doesn't include them.
 *
 * Each returned row:
 *   { strike, expDate, side, oi, volume, delta, gamma, iv, streamerSymbol, underlyingPrice }
 */
'use strict';

const { ttGet } = require('./tt-auth');
const http = require('http');

const PROXY_PORT = process.env.PROXY_PORT || 3001;

/**
 * Estimate Greeks analytically when TT REST doesn't return them.
 * Gaussian approximation — good enough for GEX weighting.
 */
function estimateGreeks(strike, underlyingPrice, expDate, side) {
  const price = underlyingPrice || 0;
  if (!(price > 0) || !(strike > 0)) return { delta: 0, gamma: 0 };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = expDate ? new Date(`${expDate}T12:00:00`) : today;
  exp.setHours(0, 0, 0, 0);
  const dte = Math.max(0, Math.round((exp - today) / 86400000));

  const width     = Math.max(18, price * (0.006 + Math.min(dte, 14) * 0.0016));
  const moneyness = (strike - price) / width;
  const density   = Math.exp(-0.5 * moneyness * moneyness);
  const gamma     = Math.max(0.00002, Math.min(0.0035, density / (price * (0.05 + Math.sqrt(dte + 1) * 0.16))));
  const sigmoid   = 1 / (1 + Math.exp(moneyness));
  const delta     = side === 'call' ? sigmoid : -(1 - sigmoid);

  return { delta, gamma };
}

/**
 * Fetch today's SPXW expirations from /nested endpoint.
 */
async function fetchSpxwExpirations() {
  const { status, data } = await ttGet('/option-chains/SPXW/nested');
  if (status !== 200) throw new Error(`TT nested chain returned ${status}`);

  const expirations = data?.data?.items?.[0]?.expirations || [];
  const today = new Date().toISOString().slice(0, 10);

  return expirations
    .map(e => e['expiration-date'])
    .filter(d => d && d >= today)
    .sort();
}

/**
 * Fetch SPX spot price from the proxy's market-data cache (already running on port 3001).
 * Falls back to TT REST if proxy isn't ready.
 */
async function fetchSpxSpot() {
  // Try proxy first (fast, already has live data)
  try {
    const spot = await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${PROXY_PORT}/proxy/api/tt/market-data/SPX`, { timeout: 3000 }, res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(raw);
            // Proxy returns { data: { items: [...] } } or { spotPrice: N }
            const price = Number(
              json?.spotPrice ??
              json?.data?.items?.[0]?.last ??
              json?.data?.items?.[0]?.['last-price'] ??
              0
            );
            resolve(price > 0 ? price : 0);
          } catch { resolve(0); }
        });
      });
      req.on('error', () => resolve(0));
      req.on('timeout', () => { req.destroy(); resolve(0); });
    });
    if (spot > 0) return spot;
  } catch {}

  // Fall back to TT REST market-data endpoint
  try {
    const { status, data } = await ttGet('/market-data/by-type?index%5B%5D=SPX');
    if (status === 200 && Array.isArray(data?.data?.items)) {
      for (const item of data.data.items) {
        const last = Number(item.last ?? item['last-price'] ?? 0);
        if (last > 0) return last;
      }
    }
  } catch (e) {
    console.error('[tt-chain] fetchSpxSpot REST error:', e.message);
  }
  return 0;
}

/**
 * Fetch all options for a single SPXW expiry using /nested endpoint.
 * Returns flat array with OI data included.
 */
async function fetchSpxwOptionsForExpiry(expDate) {
  const { status, data } = await ttGet('/option-chains/SPXW/nested');
  if (status !== 200) throw new Error(`TT nested chain returned ${status}`);

  // The /nested endpoint only has streamer symbols, not OI/Greeks.
  // Use the flat endpoint which has all named fields including open-interest.
  const flatResp = await ttGet(`/option-chains/SPXW?expiration-date=${expDate}`);
  if (flatResp.status !== 200) throw new Error(`TT flat chain returned ${flatResp.status}`);

  const flatItems = Array.isArray(flatResp.data?.data?.items) ? flatResp.data.data.items : [];
  // The flat endpoint returns options across all expirations — filter to our target date
  const options = flatItems.filter(opt => {
    const d = String(opt['expiration-date'] ?? '');
    return !d || d.slice(0, 10) === expDate;
  });

  console.log(`[tt-chain] Flat chain ${expDate}: ${flatItems.length} total, ${options.length} filtered. Keys: ${Object.keys(options[0] ?? {}).slice(0, 10).join(', ')}`);
  return options;
}

/**
 * Main export: fetch full chain for given expiry, return normalized rows.
 */
async function fetchChainRows(expDate, spot) {
  const rawOptions = await fetchSpxwOptionsForExpiry(expDate);
  if (!rawOptions.length) return [];

  // Use provided spot, or infer from option data
  let underlyingPrice = spot || 0;
  if (!(underlyingPrice > 0)) {
    underlyingPrice = rawOptions[0]?._underlyingPrice ?? 0;
  }
  if (!(underlyingPrice > 0)) {
    for (const opt of rawOptions.slice(0, 20)) {
      const p = Number(opt['underlying-price'] ?? opt._underlyingPrice ?? 0);
      if (p > 0) { underlyingPrice = p; break; }
    }
  }

  return rawOptions.map(opt => {
    const strike    = Number(opt['strike-price'] ?? opt.strike ?? 0);
    const rawType   = String(opt['option-type'] ?? '').toUpperCase();
    const side      = rawType === 'C' ? 'call' : 'put';
    const oi        = Number(opt['open-interest'] ?? opt.openInterest ?? 0) || 0;
    const volume    = Number(opt['day-volume'] ?? opt.volume ?? 0) || 0;
    const restDelta = Number(opt.delta ?? 0) || 0;
    const restGamma = Math.abs(Number(opt.gamma ?? 0)) || 0;
    const iv        = Number(opt['implied-volatility'] ?? opt.impliedVolatility ?? 0) || 0;

    const fallback  = (!restGamma) ? estimateGreeks(strike, underlyingPrice, expDate, side) : null;
    const delta     = restDelta || (fallback?.delta ?? 0);
    const gamma     = restGamma || (fallback?.gamma ?? 0);

    return {
      strike,
      expDate,
      side,
      oi,
      volume,
      delta,
      gamma,
      iv,
      streamerSymbol: opt['streamer-symbol'] ?? opt.symbol ?? '',
      underlyingPrice,
    };
  }).filter(r => r.strike > 0);
}

module.exports = { fetchChainRows, fetchSpxwExpirations, fetchSpxSpot };
