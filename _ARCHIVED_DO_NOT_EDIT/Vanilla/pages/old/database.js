// Backward-compatible loader for legacy links that still point at /pages/database.js.
(function () {
  var script = document.createElement('script');
  script.src = '/pages/database/database.js';
  document.head.appendChild(script);
})();
