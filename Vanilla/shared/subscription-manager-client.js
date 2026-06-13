/**
 * Subscription Manager Client
 *
 * Provides utilities for pages to subscribe to symbols and wait for data readiness.
 * Replaces hardcoded setTimeout waits with deterministic state notifications.
 *
 * Usage:
 *   const result = await SubscriptionManagerClient.waitForReady(
 *     'my-page-id',
 *     ['SPXW260620C5800', 'SPXW260620P5800', ...],
 *     { timeout: 3000, threshold: 0.6 }
 *   );
 *
 *   if (result.ready) {
 *     console.log(`${result.count}/${result.total} symbols have Greeks`);
 *   } else if (result.timeout) {
 *     console.log('Timeout, but got:', result.count, 'symbols');
 *   }
 */

window.SubscriptionManagerClient = (function() {
  const API_BASE = window.API_BASE || '';

  return {
    /**
     * Wait for symbols to have data in dxLink cache
     *
     * @param {string} pageId - Unique page identifier (e.g. 'mult-greek-' + Date.now())
     * @param {string[]} symbols - List of streamer symbols to wait for
     * @param {object} options - Configuration
     * @param {number} options.timeout - Max wait time in ms (default 5000)
     * @param {number} options.threshold - % of symbols that must be ready (default 0.6)
     * @returns {Promise<object>} { ready: bool, timeout: bool, count: int, total: int }
     */
    async waitForReady(pageId, symbols, options = {}) {
      const { timeout = 5000, threshold = 0.6 } = options;

      if (!Array.isArray(symbols) || symbols.length === 0) {
        return { ready: true, timeout: false, count: 0, total: 0 };
      }

      try {
        const response = await fetch(`${API_BASE}/proxy/api/subscription-ready`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageId,
            symbols,
            timeout,
            threshold
          })
        });

        if (!response.ok) {
          console.warn(`[SubMgrClient] API error: ${response.status}`);
          return { ready: false, timeout: false, count: 0, total: symbols.length };
        }

        return await response.json();
      } catch (e) {
        console.error('[SubMgrClient] Request failed:', e.message);
        return { ready: false, timeout: false, count: 0, total: symbols.length };
      }
    },

    /**
     * Subscribe symbols and wait in one call
     *
     * @param {string} pageId - Unique page identifier
     * @param {string[]} symbols - List of streamer symbols
     * @param {object} options - { timeout, threshold }
     * @returns {Promise<object>} Same as waitForReady
     */
    async subscribeAndWait(pageId, symbols, options = {}) {
      return this.waitForReady(pageId, symbols, options);
    },

    /**
     * Generate a unique page ID
     *
     * @param {string} prefix - Prefix (e.g. 'mult-greek')
     * @returns {string} Unique ID
     */
    generatePageId(prefix = 'page') {
      return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    },

    /**
     * Log subscription status (for debugging)
     *
     * @param {object} result - Result from waitForReady
     * @param {string} context - Context label
     */
    logStatus(result, context = '') {
      const status = result.ready ? '✓ READY' : (result.timeout ? '⏱ TIMEOUT' : '✗ FAILED');
      const pct = result.total > 0 ? Math.round((result.count / result.total) * 100) : 0;
      console.log(
        `[SubMgrClient] ${status} ${context}: ${result.count}/${result.total} (${pct}%)`,
        result
      );
    }
  };
})();

// Export for use in other modules (if using ES6 modules)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = window.SubscriptionManagerClient;
}
