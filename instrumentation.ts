/**
 * Next.js instrumentation hook (runs once when the server boots).
 * Dependency-optional: only initializes Sentry when @sentry/nextjs is installed
 * AND a DSN is set. Safe to ship before the SDK is added on the box.
 *
 * Install (then redeploy):
 *   npm i @sentry/nextjs
 *   .env.local: SENTRY_DSN=... NEXT_PUBLIC_SENTRY_DSN=... SENTRY_ENV=production
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  try {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      const Sentry = await import("@sentry/nextjs");
      Sentry.init({
        dsn,
        environment: process.env.SENTRY_ENV || process.env.NODE_ENV,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_RATE || 0.1),
      });
    }
  } catch {
    // @sentry/nextjs not installed yet — no-op.
  }
}
