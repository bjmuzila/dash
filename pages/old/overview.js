// Backward-compatible loader for legacy links that still point at /pages/overview.js.
(function () {
  var script = document.createElement('script');
  script.src = '/pages/overview/overview.js';
  document.head.appendChild(script);
})();
