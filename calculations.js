// ===========================
// GEX/DEX CALCULATIONS MODULE
// ===========================
// All calculation logic extracted here for reusability

function getGEXScale(row) {
  const spot = Number(row.spotPrice || row.spot || 0);
  return spot > 0 ? spot : 0;
}

// Calculate Net GEX for a single row (per-point basis)
// Always calculate from raw gamma/OI/volume, never use pre-calculated values
function calculateNetGEX(row, mode = 'net') {
  const spot = Number(row.spotPrice || row.spot || 0);
  const callPos = mode === 'vol' ? (row.callVolume || 0) : (row.callOI || 0) + (row.callVolume || 0);
  const putPos = mode === 'vol' ? (row.putVolume || 0) : (row.putOI || 0) + (row.putVolume || 0);
  // GEX per 1% move: Gamma × Position × Spot²
  const callGEX = (row.callGamma || 0) * callPos * spot * spot;
  const putGEX = (row.putGamma || 0) * putPos * spot * spot * -1;

  return callGEX + putGEX;
}

// Calculate Net DEX for a single row
function calculateNetDEX(row, spotPrice, mode = 'net') {
  const callPos = mode === 'vol' ? (row.callVolume || 0) : (row.callOI || 0) + (row.callVolume || 0);
  const putPos = mode === 'vol' ? (row.putVolume || 0) : (row.putOI || 0) + (row.putVolume || 0);
  
  return ((row.callDelta || 0) * callPos - (row.putDelta || 0) * putPos) * spotPrice * 100;
}

// Calculate cumulative DEX up to a strike
function calculateCumulativeDEX(chain, atmStrike, spotPrice, mode = 'net') {
  const sortedChain = [...chain].sort((a, b) => a.strike - b.strike);
  let cumDEX = 0;
  
  for (const row of sortedChain) {
    if (row.strike <= atmStrike) {
      cumDEX += calculateNetDEX(row, spotPrice, mode);
    } else {
      break;
    }
  }
  
  return cumDEX;
}

// Find GEX flip point (where cumulative net GEX crosses zero)
function findGEXFlip(chain) {
  const sorted = [...chain].sort((a, b) => a.strike - b.strike);
  if (!sorted.length) return null;

  const cumulative = [];
  let running = 0;
  for (const row of sorted) {
    running += Number(row.netGEX || 0);
    cumulative.push({ strike: row.strike, cumGEX: running });
  }

  for (let i = 0; i < cumulative.length - 1; i++) {
    const curr = cumulative[i];
    const next = cumulative[i + 1];
    if (curr.cumGEX === 0) return Math.round(curr.strike * 100) / 100;
    if (Math.sign(curr.cumGEX) !== Math.sign(next.cumGEX) && next.cumGEX !== 0) {
      const slope = (next.cumGEX - curr.cumGEX) / (next.strike - curr.strike);
      const flip = curr.strike - curr.cumGEX / slope;
      return Math.round(flip * 100) / 100;
    }
  }

  const closest = cumulative.reduce((best, row) =>
    Math.abs(row.cumGEX) < Math.abs(best.cumGEX) ? row : best,
    cumulative[0]
  );
  return closest ? Math.round(closest.strike * 100) / 100 : null;
}

// Find call wall (strike with max call GEX)
function findCallWall(chain) {
  return chain.reduce((max, row) => 
    (row.callGEX || 0) > (max.callGEX || 0) ? row : max, 
    chain[0]
  )?.strike;
}

// Find put wall (strike with max put GEX absolute value)
function findPutWall(chain) {
  return chain.reduce((max, row) => 
    Math.abs(row.putGEX || 0) > Math.abs(max.putGEX || 0) ? row : max, 
    chain[0]
  )?.strike;
}

// Format GEX value for display ($K, $M, $B)
function formatGEX(value) {
  const abs = Math.abs(value);
  const sign = value >= 0 ? '+' : '-';
  
  if (abs >= 1e9) {
    return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  } else if (abs >= 1e6) {
    return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  } else {
    return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  }
}

// Format strike price
function formatStrike(strike) {
  return strike.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Calculate daily estimated move from ATM straddle
function calculateDailyEstimatedMove(chain, spotPrice) {
  if (!chain || chain.length === 0) return null;
  
  // Find ATM strike (round to nearest 5)
  const atmStrike = Math.round(spotPrice / 5) * 5;
  
  // Find ATM call and put
  const atmCall = chain.find(o => o.strike === atmStrike && o.type === 'call');
  const atmPut = chain.find(o => o.strike === atmStrike && o.type === 'put');
  
  if (!atmCall || !atmPut) return null;
  
  // Straddle mid = (call mid + put mid) / 2
  const callMid = ((atmCall.bid || 0) + (atmCall.ask || 0)) / 2;
  const putMid = ((atmPut.bid || 0) + (atmPut.ask || 0)) / 2;
  const stradleMid = (callMid + putMid) / 2;
  
  // Estimated move = straddle mid × 0.84
  return Math.round(stradleMid * 0.84 * 100) / 100;
}

// Export all calculation functions
window.CALC = {
  calculateNetGEX,
  calculateNetDEX,
  calculateCumulativeDEX,
  findGEXFlip,
  findCallWall,
  findPutWall,
  calculateDailyEstimatedMove,
  formatGEX,
  formatStrike
};
