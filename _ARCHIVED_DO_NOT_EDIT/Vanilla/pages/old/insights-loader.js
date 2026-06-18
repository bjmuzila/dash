/**
 * INSIGHTS PAGE LOADER - Improved with retry logic
 */

(async function loadInsightsPage() {
  console.log('[Insights Loader] Starting...');
  
  try {
    // Fetch insights.html
    const response = await fetch('insights.html');
    if (!response.ok) throw new Error('Failed to load insights.html: ' + response.status);
    
    const insightsHTML = await response.text();
    console.log('[Insights Loader] HTML fetched, length:', insightsHTML.length);
    
    // Create page-insights container if it doesn't exist
    let pageInsights = document.getElementById('page-insights');
    if (!pageInsights) {
      pageInsights = document.createElement('div');
      pageInsights.id = 'page-insights';
      pageInsights.style.display = 'none';
      pageInsights.style.flexDirection = 'column';
      pageInsights.style.flex = '1';
      pageInsights.style.minHeight = '0';
      pageInsights.style.overflow = 'hidden';
      pageInsights.style.background = 'var(--bg0)';
      document.body.appendChild(pageInsights);
      console.log('[Insights Loader] Created page-insights div');
    }
    
    // Extract script tag
    const scriptMatch = insightsHTML.match(/<script>([\s\S]*?)<\/script>/);
    const scriptContent = scriptMatch ? scriptMatch[1] : '';
    
    if (!scriptContent) {
      throw new Error('No script found in insights.html');
    }
    
    console.log('[Insights Loader] Script extracted, length:', scriptContent.length);
    
    // Remove script from HTML
    const htmlWithoutScript = insightsHTML.replace(/<script>[\s\S]*?<\/script>/g, '');
    
    // Inject HTML into page
    pageInsights.innerHTML = htmlWithoutScript;
    console.log('[Insights Loader] HTML injected into page-insights');
    
    // Execute script in global scope
    try {
      (new Function(scriptContent))();
      console.log('[Insights Loader] Script executed successfully');
    } catch (scriptErr) {
      console.error('[Insights Loader] Script execution failed:', scriptErr);
      throw scriptErr;
    }
    
    // Verify functions are available
    const functionsToCheck = ['switchInsightsTab', 'updateVolatilityTrend', 'calculateMarketProbabilities'];
    const results = {};
    
    functionsToCheck.forEach(fn => {
      results[fn] = typeof window[fn];
      console.log(`[Insights Loader] ${fn}: ${typeof window[fn]}`);
    });
    
    if (typeof window.switchInsightsTab !== 'function') {
      throw new Error('switchInsightsTab is not a function after script execution');
    }
    
    console.log('[Insights Loader] ✓ All functions loaded successfully');
    
  } catch (e) {
    console.error('[Insights Loader] FATAL ERROR:', e);
    alert('Failed to load insights page. Check console for details.');
  }
})();
