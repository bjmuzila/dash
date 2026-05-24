// ============================================================================
// INTEGRATION: CAPTURE MARKET DATA INTO DATABASE
// ============================================================================

/**
 * Capture MVC snapshot — call after MVC is calculated
 * triggerType: 'manual' | 'auto-9:45' | 'auto-10:30' | 'auto-12:00'
 */
async function captureToDatabase_MVC(mvcOIVol, mvcVolOnly, currentPrice, triggerType = 'manual') {
  if (!DB || !DB.db) { console.warn('Database not ready'); return; }
  try {
    await DB.saveMVCSnapshot(mvcOIVol, mvcVolOnly, currentPrice, triggerType);
    console.log(`✓ MVC saved [${triggerType}]: Strike ${mvcOIVol.strike} @ ${currentPrice}`);
  } catch (err) {
    console.error('Failed to save MVC:', err);
  }
}

/**
 * Capture 1-minute premium flow bucket — call every minute from polling loop
 * netCallPremium / netPutPremium: positive = net buying, negative = net selling
 */
async function captureToDatabase_PremiumFlow(netCallPremium, netPutPremium, spxPrice) {
  if (!DB || !DB.db) return;
  try {
    await DB.saveMinutePremiumFlow(netCallPremium, netPutPremium, spxPrice);
  } catch (err) {
    console.error('Failed to save premium flow:', err);
  }
}

/**
 * Capture 1-minute ES cumulative delta — call every minute from polling loop
 * cumulativeDelta: running session total
 * deltaThisMinute: raw delta added this minute
 */
async function captureToDatabase_CumulativeDelta(cumulativeDelta, deltaThisMinute, esPrice) {
  if (!DB || !DB.db) return;
  try {
    await DB.saveMinuteCumulativeDelta(cumulativeDelta, deltaThisMinute, esPrice);
  } catch (err) {
    console.error('Failed to save cumulative delta:', err);
  }
}

/**
 * Capture full options chain snapshot (every 5 min throttled inside DB)
 */
async function captureToDatabase_ChainSnapshot(chainData) {
  if (!DB || !DB.db) return;
  try {
    await DB.saveChainSnapshot(chainData, 5);
  } catch (err) {
    console.error('Failed to save chain snapshot:', err);
  }
}

/**
 * Batch capture Greeks for all options in chain
 */
async function captureToDatabase_GreeksSnapshot(chainData) {
  if (!DB || !DB.db) return;
  try {
    const options = chainData.options || [];
    let saved = 0;
    for (const opt of options) {
      await DB.saveGreeksSnapshot(
        opt.strike, opt.expiration,
        { delta: opt.callDelta, gamma: opt.callGamma, vega: opt.callVega, theta: opt.callTheta, iv: opt.callIV },
        { delta: opt.putDelta,  gamma: opt.putGamma,  vega: opt.putVega,  theta: opt.putTheta,  iv: opt.putIV  }
      );
      saved++;
    }
    console.log(`✓ Saved Greeks for ${saved} options`);
  } catch (err) {
    console.error('Failed to save Greeks snapshot:', err);
  }
}

/**
 * BATCH CAPTURE — call once per refresh cycle
 */
async function captureFullSnapshot(chainData, mvcOIVol, mvcVolOnly, currentPrice, triggerType = 'manual') {
  if (!DB || !DB.db) { console.warn('Database not initialized'); return; }
  try {
    await captureToDatabase_MVC(mvcOIVol, mvcVolOnly, currentPrice, triggerType);
    await captureToDatabase_GreeksSnapshot(chainData);
    await captureToDatabase_ChainSnapshot(chainData);
    console.log('✓ Full snapshot captured');
  } catch (err) {
    console.error('Snapshot capture failed:', err);
  }
}

// ============================================================================
// QUERY HELPERS — used by database.html display functions
// ============================================================================

async function queryMVC_Recent(hoursBack = 24) {
  return DB.queryMVC_Recent(hoursBack);
}

async function queryPremiumFlow_TopTrades(hoursBack = 1) {
  return DB.queryPremiumFlow_TopTrades(hoursBack);
}

async function queryCumulativeDelta_Chart(hoursBack = 1) {
  return DB.queryCumulativeDelta_Chart(hoursBack);
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
// AUTO-SNAP SCHEDULER BOOT
// Call this after db-ready if you want the 9:45 / 10:30 / 12:00 ET auto-snaps.
// Replace getLatestMVCData() with whatever returns your live mvcOIVol/mvcVolOnly/price.
// ============================================================================
/*
window.addEventListener('db-ready', () => {
  DB.startAutoSnapScheduler(async (triggerLabel) => {
    const { mvcOIVol, mvcVolOnly, price } = getLatestMVCData();
    await captureToDatabase_MVC(mvcOIVol, mvcVolOnly, price, triggerLabel);
  });
});
*/

// ============================================================================
// 1-MINUTE POLLING LOOP EXAMPLE
// Uncomment and wire into your existing refresh cycle.
// ============================================================================
/*
let _minutePoller = null;

function startMinuteCapture() {
  if (_minutePoller) return;
  _minutePoller = setInterval(async () => {
    const { netCallPremium, netPutPremium, spxPrice } = getLatestPremiumFlow();
    const { cumulativeDelta, deltaThisMinute, esPrice } = getLatestCumulativeDelta();
    await captureToDatabase_PremiumFlow(netCallPremium, netPutPremium, spxPrice);
    await captureToDatabase_CumulativeDelta(cumulativeDelta, deltaThisMinute, esPrice);
  }, 60 * 1000);
  console.log('✓ 1-minute capture loop started');
}

function stopMinuteCapture() {
  clearInterval(_minutePoller);
  _minutePoller = null;
}
*/
