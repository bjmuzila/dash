'use strict';
/**
 * server-v2/lifecycle-email-scheduler.js
 *
 * Once-a-day (10:00 ET) trigger for the lifecycle-email sweep. It holds NO
 * logic of its own — it POSTs the loopback route and logs what came back:
 *
 *   POST /api/internal/lifecycle-emails   (x-internal-token)
 *
 * Two campaigns run in that one call (see the route's header for the rules):
 *   trial-lapsed        took the free trial, never became a customer
 *   signup-no-purchase  made an account, never bought, never even trialed
 * Both offer one month at $30, then normal pricing.
 *
 * WHY A THIN SHIM: everything the sweep needs — Stripe, the email templates,
 * the offer minting — is TypeScript under lib/, which this CommonJS process
 * cannot require. Same split, and the same loopback + INTERNAL_API_TOKEN
 * handshake, that app/api/stripe/webhook already uses to reach the affiliate
 * ledger in the other direction.
 *
 * 10:00 ET, not overnight: this is a promotional email and it should land in a
 * working-hours inbox, not at 3am where it reads as a blast. Weekends included
 * — this audience is not office-hours traffic, and holding a Saturday lapse
 * until Monday only makes the offer staler.
 *
 * The sweep is idempotent (one offer per person, claimed by a conditional
 * insert), so a catch-up run after a restart cannot double-send. That is why
 * this can be a "have we run today?" flag rather than a durable cron.
 *
 * Start from server-with-proxy.js after server.listen():
 *   require('./lifecycle-email-scheduler').startLifecycleEmailScheduler(PORT);
 *
 * Env:
 *   INTERNAL_API_TOKEN          required — the route rejects an unauthenticated call
 *   LIFECYCLE_EMAIL_HOUR_ET     default 10 (0-23)
 *   LIFECYCLE_EMAILS_DISABLED   "1" to stop the scheduler without touching the
 *                               route (WINBACK_ENABLED=0 is the other switch,
 *                               and turns the campaigns off everywhere)
 */

const CHECK_MS = 10 * 60 * 1000;

function internalHeaders(extra = {}) {
  return Object.assign({ 'content-type': 'application/json' }, extra,
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {});
}

function etHour() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  return Number(p.find((x) => x.type === 'hour')?.value);
}

function etDateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((p) => p.type !== 'literal')
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function truthy(v) { return /^(1|true|yes|on)$/i.test(String(v || '').trim()); }

async function runSweep(base) {
  let res;
  try {
    res = await fetch(`${base}/api/internal/lifecycle-emails`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({}),
      cache: 'no-store',
    });
  } catch (e) {
    console.warn('[lifecycle-emails] request failed:', e.message);
    return;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.warn(`[lifecycle-emails] sweep ${res.status}: ${detail.slice(0, 300)}`);
    return;
  }
  const j = await res.json().catch(() => ({}));
  if (j.skipped) { console.log(`[lifecycle-emails] skipped — ${j.skipped}`); return; }

  const lines = Array.isArray(j.lines) ? j.lines : [];
  const byKind = lines.reduce((a, l) => {
    if (l.result === 'sent') a[l.kind] = (a[l.kind] || 0) + 1;
    return a;
  }, {});
  console.log(
    `[lifecycle-emails] sent ${j.sent || 0} ` +
    `(lapsed ${byKind['trial-lapsed'] || 0}, dormant ${byKind['signup-no-purchase'] || 0}), ` +
    `${lines.length - (j.sent || 0)} skipped`
  );
  // Anything that CLAIMED an offer but failed to mail it is worth seeing in the
  // logs by address — the offer is live on that account with nobody told.
  for (const l of lines) {
    if (typeof l.result === 'string' && l.result.startsWith('not-sent')) {
      console.warn(`[lifecycle-emails] ${l.kind} ${l.email}: ${l.result}`);
    }
  }
}

function startLifecycleEmailScheduler(port) {
  if (truthy(process.env.LIFECYCLE_EMAILS_DISABLED)) {
    console.log('[lifecycle-emails] disabled by LIFECYCLE_EMAILS_DISABLED');
    return;
  }
  if (!process.env.INTERNAL_API_TOKEN) {
    console.warn('[lifecycle-emails] INTERNAL_API_TOKEN not set — scheduler not started');
    return;
  }

  const base = `http://127.0.0.1:${port}`;
  const hour = Math.min(23, Math.max(0, Number(process.env.LIFECYCLE_EMAIL_HOUR_ET ?? 10) || 10));
  let lastRunDate = null;

  async function check() {
    const today = etDateStr();
    if (lastRunDate === today) return;
    // At or after the hour, not exactly on it: a box that was asleep at 10:00
    // still catches up on its next tick, and the sweep's own latch means a late
    // run cannot double-send.
    if (etHour() < hour) return;
    lastRunDate = today;
    await runSweep(base);
  }

  console.log(`[lifecycle-emails] enabled — daily sweep at ~${String(hour).padStart(2, '0')}:00 ET`);
  // Startup probe is deliberately long: let the Next server finish booting
  // before the first loopback POST, or the catch-up run 404s on cold start.
  setTimeout(() => { void check(); }, 90_000);
  setInterval(() => { void check(); }, CHECK_MS).unref();
}

module.exports = { startLifecycleEmailScheduler, runSweep };
