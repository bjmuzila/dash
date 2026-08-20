#!/usr/bin/env node
/* Google sign-in retirement — find the accounts it stranded, and (optionally)
 * email each one a link to set a password.
 *
 * WHY
 *   Google OAuth was removed on 2026-08-20. Accounts created through it have
 *   users.google_sub set and users.password_hash NULL, so their owner can
 *   neither sign in (no password exists) nor sign up (email already taken).
 *   Everyone else — including anyone who linked Google to an account that
 *   already had a password — is unaffected and is NOT emailed.
 *
 * WHAT --send DOES
 *   Per stranded account: inserts a single-use password_resets row (same table
 *   and same sha256(token) shape as /api/auth/forgot-password) and emails the
 *   link via Resend. /auth/reset-password consumes it and calls
 *   updateUserPasswordHash on the EXISTING row, so the user id, the Stripe
 *   customer and the subscription all carry over untouched.
 *
 * WHAT IT NEVER DOES
 *   No writes to users, subscriptions or sessions. Without --send it only
 *   reads. It never mails an account that already has a password.
 *
 * USAGE (on the VPS)
 *   Report only (safe, default):
 *     docker exec -i dashboard-dashboard-1 node - < scripts/notify-google-only-accounts.mjs
 *
 *   Test send to yourself first:
 *     docker exec -i dashboard-dashboard-1 node - --send --only=bjmuzila@gmail.com \
 *       < scripts/notify-google-only-accounts.mjs
 *
 *   Real send:
 *     docker exec -i dashboard-dashboard-1 node - --send \
 *       < scripts/notify-google-only-accounts.mjs
 *
 *   Paying customers only:
 *     ... node - --send --paid-only < scripts/notify-google-only-accounts.mjs
 *
 * FLAGS
 *   --send            actually create tokens + send email (default: report only)
 *   --only=<email>    restrict to one address (test sends)
 *   --paid-only       only accounts whose subscription is active/trialing
 *   --ttl-hours=N     reset-link lifetime, default 168 (7 days)
 *   --resend-after=N  re-mail someone only if their last token is older than N
 *                     hours, default 24 — makes a re-run safe after a crash
 *
 * ENV (all already set in the container)
 *   DATABASE_URL, RESEND_API_KEY, EMAIL_FROM, NEXT_PUBLIC_APP_URL
 */
import pg from "pg";
import { randomBytes, createHash } from "crypto";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const SEND = flag("send");
const PAID_ONLY = flag("paid-only");
const ONLY = (value("only", "") || "").trim().toLowerCase();
const TTL_HOURS = Number(value("ttl-hours", "168"));
const RESEND_AFTER_HOURS = Number(value("resend-after", "24"));

const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.APP_URL ||
  "https://cbedge.net"
).replace(/\/+$/, "");
const EMAIL_FROM = process.env.EMAIL_FROM || "CB Edge <hello@cbedge.net>";

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL in the environment.");
  process.exit(1);
}
if (SEND && !process.env.RESEND_API_KEY) {
  console.error("Missing RESEND_API_KEY — cannot --send.");
  process.exit(1);
}
if (!Number.isFinite(TTL_HOURS) || TTL_HOURS <= 0) {
  console.error("--ttl-hours must be a positive number.");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

const hashToken = (t) => createHash("sha256").update(t).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Email (inline: this runs as a bare node script inside the container, so it
// can't import the TypeScript templates in lib/emails/). Brand conventions from
// lib/emails/EMAILS_HANDOFF.md: dark shell, cyan accent bar, centered logo,
// table layout, inline styles only. Transactional — no unsubscribe footer, same
// as the ordinary password-reset email.
const SUBJECT = "Action needed: set a password for your CB Edge account";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function emailHtml({ resetUrl, expiresInDays }) {
  const url = escapeHtml(resetUrl);
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#05060A;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05060A;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0D1119;border-radius:12px;overflow:hidden;">
    <tr><td style="height:3px;background:#219EBC;line-height:3px;font-size:0;">&nbsp;</td></tr>
    <tr><td align="center" style="padding:28px 28px 8px;">
      <img src="${SITE_URL}/cb-edge-logo.png" alt="CB Edge" width="260" style="max-width:260px;height:auto;display:block;" />
    </td></tr>
    <tr><td style="padding:8px 28px 0;">
      <h1 style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.3;color:#ffffff;font-weight:800;">
        Google sign-in has been retired
      </h1>
      <p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#8ECAE6;">
        Your CB Edge account needs a password now.
      </p>
      <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#d4dde6;">
        You signed up for CB Edge with the &ldquo;Continue with Google&rdquo; button.
        That option has been removed, so signing in now takes an email and a
        password &mdash; and your account doesn&rsquo;t have a password yet.
      </p>
      <p style="margin:0 0 22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#d4dde6;">
        Use the button below to set one. Same account, same email, same
        subscription &mdash; nothing else changes and you don&rsquo;t need to sign
        up again.
      </p>
    </td></tr>
    <tr><td align="center" style="padding:0 28px 24px;">
      <a href="${url}" style="display:inline-block;background:#219EBC;color:#05060A;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:800;text-decoration:none;padding:14px 30px;border-radius:8px;">
        Set my password
      </a>
    </td></tr>
    <tr><td style="padding:0 28px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid rgba(33,158,188,0.35);border-radius:8px;background:rgba(33,158,188,0.07);">
        <tr><td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#d4dde6;">
          This link expires in ${expiresInDays} days and can be used once. If it
          expires, go to <a href="${SITE_URL}/sign-in" style="color:#8ECAE6;">${SITE_URL.replace(/^https?:\/\//, "")}/sign-in</a>,
          enter your email and click <strong>Forgot password?</strong> for a fresh one.
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 28px 28px;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#7c8794;">
        Didn&rsquo;t expect this? You can ignore it &mdash; nothing changes until
        someone opens the link above and sets a password.
      </p>
    </td></tr>
    <tr><td align="center" style="padding:0 28px 26px;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#7c8794;">
        <a href="${SITE_URL}" style="color:#8ECAE6;text-decoration:none;">cbedge.net</a>
      </p>
      <p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5d6874;">
        Market analytics, not financial advice.
      </p>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

function emailText({ resetUrl, expiresInDays }) {
  return [
    "Google sign-in has been retired",
    "",
    'You signed up for CB Edge with the "Continue with Google" button. That option',
    "has been removed, so signing in now takes an email and a password - and your",
    "account doesn't have a password yet.",
    "",
    "Set one here (same account, same subscription, no need to sign up again):",
    resetUrl,
    "",
    `This link expires in ${expiresInDays} days and can be used once. If it expires,`,
    `go to ${SITE_URL}/sign-in, enter your email and click "Forgot password?".`,
    "",
    "Didn't expect this? Ignore it - nothing changes until someone opens the link",
    "and sets a password.",
    "",
    "cbedge.net - Market analytics, not financial advice.",
  ].join("\n");
}

async function sendViaResend({ to, html, text }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject: SUBJECT, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  // Bucket 1 — stranded: Google account, no password. These are the only ones
  // that get mail.
  const { rows: stranded } = await pool.query(
    `SELECT u.id,
            u.email,
            u.created_at,
            COALESCE(sub.status IN ('active','trialing'), FALSE) AS is_paid,
            sub.status AS sub_status,
            (SELECT MAX(pr.created_at) FROM password_resets pr WHERE pr.user_id = u.id) AS last_reset_at
       FROM users u
       LEFT JOIN subscriptions sub ON sub.clerk_user_id = u.id
      WHERE u.google_sub IS NOT NULL
        AND u.password_hash IS NULL
      ORDER BY is_paid DESC, u.email`
  );

  // Bucket 2 — linked but fine: Google was attached to an account that already
  // had a password. Reported for completeness, never emailed.
  const { rows: linkedOk } = await pool.query(
    `SELECT COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE COALESCE(sub.status IN ('active','trialing'), FALSE))::int AS paid
       FROM users u
       LEFT JOIN subscriptions sub ON sub.clerk_user_id = u.id
      WHERE u.google_sub IS NOT NULL
        AND u.password_hash IS NOT NULL`
  );

  const strandedPaid = stranded.filter((r) => r.is_paid);

  console.log("");
  console.log("Google sign-in retirement — account audit");
  console.log("─".repeat(64));
  console.log(`Stranded (Google, no password)   : ${stranded.length}  (${strandedPaid.length} paying)`);
  console.log(`Google linked but has a password : ${linkedOk[0].n}  (${linkedOk[0].paid} paying)  <- unaffected, no email`);
  console.log("─".repeat(64));

  if (!stranded.length) {
    console.log("Nobody is stranded. No email needed.");
    await pool.end();
    return;
  }

  for (const r of stranded) {
    const tag = r.is_paid ? "PAYING" : r.sub_status ? r.sub_status : "free  ";
    console.log(`  ${tag.padEnd(8)} ${r.email}`);
  }
  console.log("");

  let targets = stranded;
  if (PAID_ONLY) targets = targets.filter((r) => r.is_paid);
  if (ONLY) targets = targets.filter((r) => r.email.toLowerCase() === ONLY);

  if (ONLY && !targets.length) {
    console.log(`--only=${ONLY} matched nobody in the stranded list.`);
    await pool.end();
    return;
  }

  if (!SEND) {
    console.log(`Report only. ${targets.length} account(s) would be emailed.`);
    console.log("Re-run with --send to create reset links and mail them.");
    console.log("Preview of the link each would receive:");
    console.log(`  ${SITE_URL}/auth/reset-password?token=<one-time-token>`);
    await pool.end();
    return;
  }

  const expiresInDays = Math.max(1, Math.round(TTL_HOURS / 24));
  const cutoff = Date.now() - RESEND_AFTER_HOURS * 3600_000;
  let sent = 0;
  let skipped = 0;
  const failures = [];

  for (const r of targets) {
    if (r.last_reset_at && new Date(r.last_reset_at).getTime() > cutoff) {
      console.log(`  skip  ${r.email} — already sent a link within ${RESEND_AFTER_HOURS}h`);
      skipped++;
      continue;
    }
    const token = randomBytes(32).toString("base64url");
    try {
      await pool.query(
        `INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1,$2,$3)`,
        [hashToken(token), r.id, new Date(Date.now() + TTL_HOURS * 3600_000).toISOString()]
      );
      const resetUrl = `${SITE_URL}/auth/reset-password?token=${token}`;
      await sendViaResend({
        to: r.email,
        html: emailHtml({ resetUrl, expiresInDays }),
        text: emailText({ resetUrl, expiresInDays }),
      });
      console.log(`  sent  ${r.email}`);
      sent++;
    } catch (err) {
      console.error(`  FAIL  ${r.email} — ${err.message}`);
      failures.push(r.email);
    }
    await sleep(700); // stay under Resend's per-second cap
  }

  console.log("");
  console.log(`Done. sent=${sent} skipped=${skipped} failed=${failures.length}`);
  if (failures.length) console.log(`Failed: ${failures.join(", ")}`);
  console.log("Re-running is safe — anyone mailed in the last " + RESEND_AFTER_HOURS + "h is skipped.");

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
