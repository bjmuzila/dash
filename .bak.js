// ============================================================================
// INTEGRATION: CAPTURE MARKET DATA INTO DATABASE
// Add this to overview.js or call after each refresh
// ============================================================================

/**
 * Capture MVC (Max Volume Concentration) snapshot
 * Call this after MVC is calculated
 */
async function captureToDatabase_MVC(mvcOIVol, mvcVolOnly, currentPrice) {
  if (!DB || !DB.db) {

    return;
  }
  
  try {
    await DB.saveMVCSnapshot(mvcOIVol, mvcVolOnly, currentPrice);

  } catch (err) {

  }
}

/**
 * Capture premium flow from options chain
 * Call for each strike with significant volume
 */
async function captureToDatabase_PremiumFlow(strike, expiration, callVol, putVol, callPrice, putPrice) {
  if (!DB || !DB.db) return;
  
  try {
    // Determine direction based on bid-ask movement (simplified)
    const callDirection = Math.random() > 0.5 ? 'buy' : 'sell';  // TODO: implement real logic
    const putDirection = Math.random() > 0.5 ? 'buy' : 'sell';
    
    await DB.savePremiumFlow(strike, expiration, callVol, putVol, callDirection, putDirection);
  } catch (err) {

  }
}

/**
 * Capture cumulative delta for strike
 * Should be called after delta calculations
 */
async function captureToDatabase_CumulativeDelta(strike, callDelta, putDelta, cumulativeSum) {
  if (!DB || !DB.db) return;
  
  try {
    await DB.saveCumulativeDelta(strike, callDelta, putDelta, cumulativeSum);
  } catch (err) {

  }
}

/**
 * Capture full options chain snapshot (every N minutes)
 * Call after fetchOptionsChain completes
 */
async function captureToDatabase_ChainSnapshot(chainData) {
  if (!DB || !DB.db) return;
  
  try {
    await DB.saveChainSnapshot(chainData, 5);  // Save every 5 minutes
  } catch (err) {

  }
}

/**
 * Batch capture Greeks for all options in chain
 * Call after fetchGEX completes
 */
async function captureToDatabase_GreeksSnapshot(chainData) {
  if (!DB || !DB.db) return;
  
  try {
    const options = chainData.options || [];
    let saved = 0;
    
    for (const opt of options) {
      await DB.saveGreeksSnapshot(
        opt.strike,
        opt.expiration,
        {
          delta: opt.callDelta,
          gamma: opt.callGamma,
          vega: opt.callVega,
          theta: opt.callTheta,
          iv: opt.callIV
        },
        {
          delta: opt.putDelta,
          gamma: opt.putGamma,
          vega: opt.putVega,
          theta: opt.putTheta,
          iv: opt.putIV
        }
      );
      saved++;
    }
    

  } catch (err) {

  }
}

/**
 * BATCH CAPTURE - Call this once per refresh cycle
 * Captures everything at once
 */
async function captureFullSnapshot(chainData, mvcOIVol, mvcVolOnly, currentPrice) {
  if (!DB || !DB.db) {

    return;
  }
  
  try {
    // Save MVC
    await captureToDatabase_MVC(mvcOIVol, mvcVolOnly, currentPrice);
    
    // Save Greeks for all options
    await captureToDatabase_GreeksSnapshot(chainData);
    
    // Save full chain snapshot
    await captureToDatabase_ChainSnapshot(chainData);
    

  } catch (err) {

  }
}

/**
 * Query helpers for dashboard display
 */

async function queryMVC_Recent(hoursBack = 1) {
  const records = await DB.getMVCHistory(0.5);  // 12 hours max
  const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
  return records.filter(r => r.timestamp >= cutoff);
}

async function queryPremiumFlow_TopTrades(hoursBack = 1) {
  const aggregated = await DB.getPremiumFlowAggregated(hoursBack);
  return aggregated.slice(0, 10);  // Top 10 by flow magnitude
}

async function queryCumulativeDelta_Chart(hoursBack = 1) {
  // Get latest snapshot of cumulative delta
  const latest = await DB.getCumulativeDeltaSnapshot();
  return latest.sort((a, b) => a.strike - b.strike);
}

async function queryGreeksChange_Strike(strike, expiration, hoursBack = 2) {
  const history = await DB.getGreeksHistory(strike, expiration, hoursBack);
  return {
    strike,
    expiration,
    deltaChange: history.length > 1 ? history[history.length - 1].call.delta - history[0].call.delta : 0,
    gammaChange: history.length > 1 ? history[history.length - 1].call.gamma - history[0].call.gamma : 0,
    history
  };
}

async function exportDatabaseToJSON() {
  const data = await DB.export();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `market-data-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
}

// ============================================================================
// AUTO-CAPTURE INTEGRATION
// ============================================================================

// Hook into existing refresh cycle
// Add this to your main refresh function:
/*
  
  async function refreshData() {
    try {
      const chainData = await API.fetchOptionsChain('SPX', []);
      const mvcOIVol = calculateMVC(chainData, 'oi');
      const mvcVolOnly = calculateMVC(chainData, 'vol');
      
      // Existing render calls...
      renderGEXTable(chainData);
      renderGEXChart(chainData);
      
      // NEW: Capture to database
      await captureFullSnapshot(chainData, mvcOIVol, mvcVolOnly, chainData.underlying.price);
      
    } catch (err) {

    }
  }
*/
