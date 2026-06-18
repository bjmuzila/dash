/**
 * Fetches the SPXW option chain for a given expiry from TastyTrade REST.
 * Returns a flat array of raw option rows — no GEX math, no side effects.
 *
 * Each row:
 *   { strike, expDate, side, oi, volume, delta, gamma, iv, streamerSymbol, underlyingPrice }
 */
'use strict';

const { ttGet } = require('./tt-auth');

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
 * Fetch today's SPXW expirations, return as sorted date strings.
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
 * Fetch all options for a single SPXW expiry date.
 * Returns flat array of raw option objects from TT REST.
 */
async function fetchSpxwOptionsForExpiry(expDate) {
  const { status, data } = await ttGet(`/option-chains/SPXW?expiration-date=${expDate}`);
  if (status !== 200) throw new Error(`TT chain for ${expDate} returned ${status}`);

  // TT returns items = array of expiration objects.
  // Each expiration has an 'option-chains' array of individual option rows.
  const expItems = Array.isArray(data?.data?.items) ? data.data.items : [];
  const options = [];

  for (const exp of expItems) {
    const chain = exp['option-chains'];
    if (Array.isArray(chain)) {
      // Copy expiration-date onto each option row for reference
      for (const opt of chain) {
        if (!opt['expiration-date']) opt['expiration-date'] = exp['expiration-date'] ?? expDate;
        options.push(opt);
      }
    }
  }

  console.log(`[tt-chain] SPXW chain: ${expItems.length} expiry groups → ${options.length} options, sample opt keys: ${Object.keys(options[0] ?? {}).slice(0, 6).join(', ')}`);
  return options;
}

/**
 * Fetch SPX spot price.
 */
async function fetchSpxSpot() {
  try {
    const { status, data } = await ttGet('/market-data/by-type?type=Quote&symbols%5B%5D=%24SPX.X&symbols%5B%5D=SPX');
    if (status === 200 && Array.isArray(data?.data?.items)) {
      for (const item of data.data.items) {
        const bid = Number(item['bid-price'] ?? 0);
        const ask = Number(item['ask-price'] ?? 0);
        if (bid > 0 && ask > 0) return (bid + ask) / 2;
        const last = Number(item['last-price'] ?? 0);
        if (last > 0) return last;
      }
    }
  } catch (e) {
    console.error('[tt-chain] fetchSpxSpot error:', e.message);
  }
  return 0;
}

/**
 * Main export: fetch full chain for given expiry, return normalized rows.
 *
 * @param {string} expDate  - 'YYYY-MM-DD'
 * @param {number} spot     - SPX spot price (used for Greek fallback)
 * @returns {Promise<Array>} normalized option rows
 */
async function fetchChainRows(expDate, spot) {
  const rawOptions = await fetchSpxwOptionsForExpiry(expDate);
  if (!rawOptions.length) return [];

  // Infer underlying price from option data if spot not provided
  let underlyingPrice = spot || 0;
  if (!(underlyingPrice > 0)) {
    for (const opt of rawOptions.slice(0, 20)) {
      const p = Number(opt['underlying-price'] ?? opt.underlyingPrice ?? 0);
      if (p > 0) { underlyingPrice = p; break; }
    }
  }

  return rawOptions.map(opt => {
    const strike    = Number(opt['strike-price'] ?? 0);
    const rawType   = String(opt['option-type'] ?? '').toUpperCase();
    const side      = rawType === 'C' ? 'call' : 'put';
    const oi        = Number(opt['open-interest'] ?? opt.openInterest ?? 0) || 0;
    const volume    = Number(opt['day-volume'] ?? opt.volume ?? 0) || 0;
    const restDelta = Number(opt.delta ?? 0) || 0;
    const restGamma = Math.abs(Number(opt.gamma ?? 0)) || 0;
    const iv        = Number(opt['implied-volatility'] ?? opt.impliedVolatility ?? 0) || 0;

    // Use REST Greeks if present, otherwise estimate analytically
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
      streamerSymbol: opt['streamer-symbol'] ?? '',
      underlyingPrice,
    };
  }).filter(r => r.strike > 0);
}

module.exports = { fetchChainRows, fetchSpxwExpirations, fetchSpxSpot };
