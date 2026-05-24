// ═══════════════════════════════════════════════════════════════════════
// DATABASE BRIDGE — Add this code to your dashboard
// ═══════════════════════════════════════════════════════════════════════

// Save metrics to database every 5 seconds
(function() {
  let saveInterval = null;
  
  function saveMetricsToDatabase() {
    // Get MVC from overview.js state
    const mvcOI = document.getElementById('mvc-oi')?.textContent;
    const mvcValue = mvcOI && mvcOI !== '—' ? parseFloat(mvcOI.replace(/,/g, '')) : null;
    
    // Get net flow from bzila state
    const netFlowEl = document.getElementById('bzila-net-flow')?.textContent;
    const netFlow = netFlowEl ? parseFloat(netFlowEl.replace(/[$,]/g, '')) : null;
    
    // Get CVD from bzila state
    const cvdEl = document.getElementById('bzila-cvd-val')?.textContent;
    const cvd = cvdEl ? parseFloat(cvdEl.replace(/,/g, '')) : null;
    
    // Only save if we have at least one value
    if (mvcValue === null && netFlow === null && cvd === null) {
      return;
    }
    
    const timestamp = new Date().toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
    
    const payload = {
      timestamp,
      mvc: mvcValue,
      net_flow: netFlow,
      cvd: cvd
    };
    
    // Send to database bridge
    fetch('http://localhost:5001/save-metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        console.log('✓ Metrics saved:', timestamp);
      }
    })
    .catch(err => {
      console.error('Database save error:', err);
    });
  }
  
  // Start saving every 5 seconds
  function startDatabaseSync() {
    if (saveInterval) return;
    console.log('Starting database sync (every 5s)...');
    saveMetricsToDatabase(); // Save immediately
    saveInterval = setInterval(saveMetricsToDatabase, 5000);
  }
  
  // Stop saving
  function stopDatabaseSync() {
    if (saveInterval) {
      clearInterval(saveInterval);
      saveInterval = null;
      console.log('Database sync stopped');
    }
  }
  
  // Auto-start when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDatabaseSync);
  } else {
    startDatabaseSync();
  }
  
  // Expose controls
  window.startDatabaseSync = startDatabaseSync;
  window.stopDatabaseSync = stopDatabaseSync;
  
})();

// ═══════════════════════════════════════════════════════════════════════
// USAGE:
// 1. Add this code to your dashboard HTML (in a <script> tag)
// 2. Run: python metrics_bridge.py
// 3. Metrics auto-save every 5 seconds to database
// 4. Control with: window.startDatabaseSync() / window.stopDatabaseSync()
// ═══════════════════════════════════════════════════════════════════════
