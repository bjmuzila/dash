// Root entry shim. The real server lives in server-v2/server-with-proxy.js
// (invoked by `npm start`). This file exists so that a bare `node server.js`
// start command — Render's default if the Start Command is ever reset — boots
// the correct server instead of crash-looping on MODULE_NOT_FOUND.
require('./server-v2/server-with-proxy.js');
