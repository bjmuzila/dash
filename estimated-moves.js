// Compatibility loader for the standalone dashboard.
// The full implementation lives under pages/estimated-moves.js.
(function () {
  if (window.__estimatedMovesBootstrapLoaded) return;
  window.__estimatedMovesBootstrapLoaded = true;

  const script = document.createElement('script');
  script.src = 'pages/estimated-moves.js?v=20260527-em-page-snapshots';
  script.async = true;
  document.head.appendChild(script);
})();
