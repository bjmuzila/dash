// Compatibility shim for the topbar SPX price helper.
// Core SPX display logic now lives in shared/overview.js.
(function () {
  if (window.__esStatsPriceShimLoaded) return;
  window.__esStatsPriceShimLoaded = true;

  function syncEsLevels() {
    if (window._esLevels && typeof window._esLevels === 'object') return;
    if (window._levels && typeof window._levels === 'object' && typeof window.getESLevelsFromSPX === 'function') {
      window._esLevels = window.getESLevelsFromSPX(window._levels);
    }
  }

  syncEsLevels();
  window.addEventListener('load', syncEsLevels, { once: true });
})();
