// Backward-compatible loader for legacy links that still point at /pages/quotes.js.
(function () {
  var script = document.createElement('script');
  script.src = '/pages/quotes/quotes.js';
  document.head.appendChild(script);
})();
