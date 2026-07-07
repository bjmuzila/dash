'use strict';
/**
 * server-v2/state/alerts.js
 *
 * Minimal dual-channel ops alert (email via Resend + push via Pushover) for
 * things that need the owner's attention even when he's away from the
 * dashboard — e.g. the flow watchdog (state/flow-watchdog.js) going stale.
 *
 * Deliberately NOT lib/emails/send.ts: that path stamps tokenized unsubscribe
 * links/headers meant for customer marketing mail and looks up recipients by
 * user id. This is a raw system alert to a fixed owner address, so it skips
 * all of that (and can't be silently dropped by the subscriber suppression
 * table — see unsubscribe-removes-social-lists).
 *
 * Every call is rate-limited per `key` so a flapping feed can't spam either
 * channel; both sends are fire-and-forget and never throw.
 */

const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim();
const EMAIL_FROM = (process.env.EMAIL_FROM || 'CB Edge <hello@cbedge.net>').trim();
const ALERT_EMAIL_TO = (process.env.ALERT_EMAIL_TO || 'bjmuzila@gmail.com').trim();

const PUSHOVER_TOKEN = (process.env.PUSHOVER_TOKEN || '').trim();
const PUSHOVER_USER = (process.env.PUSHOVER_USER || '').trim();

const MIN_INTERVAL_MS = Number(process.env.ALERT_MIN_INTERVAL_MS || 15 * 60 * 1000); // 15 min
const lastSentAt = new Map(); // key -> ts

function rateLimited(key) {
  const now = Date.now();
  const last = lastSentAt.get(key) || 0;
  if (now - last < MIN_INTERVAL_MS) return true;
  lastSentAt.set(key, now);
  return false;
}

async function sendEmail(subject, text) {
  if (!RESEND_API_KEY) return { ok: false, skipped: true, reason: 'RESEND_API_KEY not set' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [ALERT_EMAIL_TO],
        subject,
        text,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => `HTTP ${r.status}`);
      console.error('[alerts] resend rejected:', detail.slice(0, 300));
      return { ok: false, reason: `resend ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('[alerts] email send failed:', e?.message || e);
    return { ok: false, reason: String(e?.message || e) };
  }
}

async function sendPush(title, message) {
  if (!PUSHOVER_TOKEN || !PUSHOVER_USER) return { ok: false, skipped: true, reason: 'pushover not configured' };
  try {
    const r = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: PUSHOVER_TOKEN,
        user: PUSHOVER_USER,
        title,
        message,
        priority: '1', // high priority: bypasses quiet hours-ish, still no 2-way ack
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => `HTTP ${r.status}`);
      console.error('[alerts] pushover rejected:', detail.slice(0, 300));
      return { ok: false, reason: `pushover ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('[alerts] push send failed:', e?.message || e);
    return { ok: false, reason: String(e?.message || e) };
  }
}

/**
 * Fire an ops alert on both channels (whichever are configured). Rate-limited
 * per `key` so repeated checks of the same condition don't spam.
 * @param {{key:string, subject:string, message:string}} opts
 */
async function sendAlert({ key, subject, message }) {
  if (rateLimited(key)) return { ok: false, skipped: true, reason: 'rate-limited' };
  const [email, push] = await Promise.allSettled([
    sendEmail(subject, message),
    sendPush(subject, message),
  ]);
  console.warn('[alerts] sent', key, '-', subject,
    '| email:', email.status === 'fulfilled' ? email.value : email.reason,
    '| push:', push.status === 'fulfilled' ? push.value : push.reason);
  return { ok: true };
}

module.exports = { sendAlert };
