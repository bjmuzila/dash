// Backward-compatible loader for legacy links that still point at /pages/bzila.js.
(function () {
  var script = document.createElement('script');
  script.src = '/pages/bzila/bzila.js';
  document.head.appendChild(script);
})();
