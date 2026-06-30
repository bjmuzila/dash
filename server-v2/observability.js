'use strict';
/**
 * observability.js — error monitoring for the server-v2 process.
 *
 * Dependency-OPTIONAL by design: it activates only when BOTH
 *   (a) @sentry/node is installed, and
 *   (b) SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN) is set.
 * Otherwise it falls back to console logging + process-level crash guards, so
 * this file is safe to ship before `npm i @sentry/node` has run on the box.
 *
 * It also installs uncaughtException / unhandledRejection handlers that were
 * previously MISSING — an unhandled rejection in a cron writer could take the
 * whole feed process down silently. We now log + report and keep running.
 *
 * INSTALL (on the VPS, then redeploy):
 *   npm i @sentry/node @sentry/nextjs
 *   add to .env.local:
 *     SENTRY_DSN=...                 # server
 *     NEXT_PUBLIC_SENTRY_DSN=...     # client (same project ok)
 *     SENTRY_ENV=production
 */

let Sentry = null;
let enabled = false;

function initObservability() {
  const dsn = (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || '').trim();
  if (dsn) {
    try {
      // eslint-disable-next-line global-require
      Sentry = require('@sentry/node');
      Sentry.init({
        dsn,
        environment: process.env.SENTRY_ENV || process.env.NODE_ENV || 'production',
        tracesSampleRate: Number(process.env.SENTRY_TRACES_RATE || 0.1),
        // Don't ship breadcrumbs that may contain TT/Theta tokens.
        beforeSend(event) {
          if (event.request?.headers) {
            delete event.request.headers['x-internal-token'];
            delete event.request.headers.cookie;
            delete event.request.headers.authorization;
          }
          return event;
        },
      });
      enabled = true;
      console.log('[observability] Sentry initialized');
    } catch (e) {
      console.warn('[observability] @sentry/node not installed — error reporting disabled:', e.message);
    }
  } else {
    console.log('[observability] no SENTRY_DSN — console-only error logging');
  }

  // Crash guards (run regardless of Sentry). Keep the process alive: a single
  // bad frame or rejected promise in a writer must not kill the live feed.
  process.on('unhandledRejection', (reason) => {
    console.error('[observability] unhandledRejection:', reason);
    captureError(reason, { kind: 'unhandledRejection' });
  });
  process.on('uncaughtException', (err) => {
    console.error('[observability] uncaughtException:', err);
    captureError(err, { kind: 'uncaughtException' });
    // Intentionally do NOT exit — the watchdog + pg pool error handlers already
    // recover subsystems, and exiting would drop every connected WS client.
  });
}

function captureError(err, context) {
  if (enabled && Sentry) {
    try { Sentry.captureException(err, context ? { extra: context } : undefined); } catch {}
  }
}

module.exports = { initObservability, captureError, isObservabilityEnabled: () => enabled };
