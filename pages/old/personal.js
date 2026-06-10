// Backward-compatible loader for legacy links that still point at /pages/personal.js.
(function () {
  var script = document.createElement('script');
  script.src = '/pages/personal/personal.js';
  document.head.appendChild(script);
})();
