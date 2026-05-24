// ===========================
// GEX/DEX CALCULATIONS MODULE
// ===========================
// All calculation logic extracted here for reusability

function getGEXScale(row) {
  const spot = Number(row.spotPrice || row.spot || 0);
  return spot > 0 ? spot : 0;
}

// Calculate Net GEX for a single row
function calculateNetGEX(row, mode = 'net') {
  if (mode === 'vol' && ('callVolGEX' in row || 'putVolGEX' in row)) {
    return (row.callVolGEX || 0) - (row.putVolGEX || 0);
  }
  if (mode !== 'vol' && ('callGEX' in row || 'putGEX' in row)) {
    return (row.callGEX || 0) - (row.putGEX || 0);
  }

  const callPos = mode === 'vol' ? (row.callVolume || 0) : (row.callOI || 0) + (row.callVolume || 0);
  const putPos = mode === 'vol' ? (row.putVolume || 0) : (row.putOI || 0) + (row.putVolume || 0);
  const scale = getGEXScale(row);
  const callGEX = (row.callGamma || 0) * callPos * 100 * scale;
  const putGEX = (row.putGamma || 0) * putPos * 100 * scale;

  return callGEX - putGEX;
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

// Find GEX flip point (where net GEX crosses zero)
function findGEXFlip(chain) {
  const sorted = [...chain].sort((a, b) => a.strike - b.strike);
  
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    
    if (curr.netGEX && next.netGEX && Math.sign(curr.netGEX) !== Math.sign(next.netGEX)) {
      // Linear interpolation to find exact zero crossing
      const slope = (next.netGEX - curr.netGEX) / (next.strike - curr.strike);
      const flip = curr.strike - curr.netGEX / slope;
      return Math.round(flip * 100) / 100;
    }
  }
  
  return null;
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

// Export all calculation functions
window.CALC = {
  calculateNetGEX,
  calculateNetDEX,
  calculateCumulativeDEX,
  findGEXFlip,
  findCallWall,
  findPutWall,
  formatGEX,
  formatStrike
};
