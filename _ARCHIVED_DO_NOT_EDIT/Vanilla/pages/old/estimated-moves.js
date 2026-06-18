// Backward-compatible loader for legacy links that still point at /pages/estimated-moves.js.
(function () {
  var script = document.createElement('script');
  script.src = '/pages/estimated-moves/estimated-moves.js';
  document.head.appendChild(script);
})();
