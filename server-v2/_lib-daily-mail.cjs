'use strict';
/**
 * server-v2/_lib-daily-mail.cjs — transactional email for daily.cbedge.net.
 *
 * Four messages, all of them the kind someone is sitting there waiting for:
 * verify your address, reset your password, join a household, welcome aboard.
 * Resend's REST API over global fetch — no SDK, because one HTTP POST does not
 * justify a dependency, a version to keep current, or a supply chain.
 *
 * ── THE RULE THAT SHAPES THIS ENTIRE FILE ─────────────────────────────────
 *
 * A FAILED SEND MUST NEVER FAIL THE CALLER.
 *
 * Every function here returns { ok } and swallows its own errors. Nothing
 * throws into a route. That is not defensive habit, it is the product decision:
 *
 *   a signup that 500s because Resend is having an afternoon is a customer who
 *   never comes back, and the account was already created a line earlier;
 *   a signup that completes, signs them in, and offers "resend the verification
 *   link" is a customer with a working account and a minor inconvenience.
 *
 * The same applies to a password reset (the token is already minted and stored
 * — the honest response is "check your email", and a retry is one click away)
 * and to an invite. So failures are LOGGED LOUDLY, with the address and the
 * reason, and reported back as { ok:false, error } for the caller to surface if
 * it wants to. They are never raised.
 *
 * A deployment with no RESEND_API_KEY at all is treated the same way: the app
 * runs, accounts get created, and the console says exactly what is missing.
 *
 * ── TOKENS ────────────────────────────────────────────────────────────────
 *
 * NEVER LOG A TOKEN, and never log a rendered body — the body is where the
 * link lives. A verification or reset token is a bearer credential: anything
 * that reaches a log file, a log aggregator, or a support screenshot is an
 * account takeover waiting to be noticed. The log lines below carry the
 * recipient and the subject, and nothing else.
 *
 * REQUIRED ENV
 *   RESEND_API_KEY  — Resend API key. Without it configured() is false, sends
 *                     are skipped, and callers still succeed.
 *   EMAIL_FROM      — optional. Defaults to `CB Edge Daily <daily@cbedge.net>`.
 *                     Must be a verified sender domain in Resend or every send
 *                     comes back 403.
 *   DAILY_BASE_URL  — optional. Defaults to https://daily.cbedge.net. Every
 *                     link in every email is built from this, so pointing it at
 *                     a staging host is all it takes to test the flows.
 */

const API_URL = 'https://api.resend.com/emails';

const API_KEY = (process.env.RESEND_API_KEY || '').trim();
const FROM = (process.env.EMAIL_FROM || 'CB Edge Daily <daily@cbedge.net>').trim();
const BASE_URL = (process.env.DAILY_BASE_URL || 'https://daily.cbedge.net').trim().replace(/\/+$/, '');

/** Resend occasionally takes its time. Ten seconds is well past the point where
 *  a signup request should still be blocked on an email that is allowed to fail. */
const SEND_TIMEOUT_MS = 10_000;

/** True when this deployment can actually send mail. */
function configured() {
  return !!API_KEY;
}

/** Which specific piece is missing. For the owner's diagnostics — never shown
 *  to a browser, and never containing a value, only a name. */
function missingConfig() {
  const missing = [];
  if (!API_KEY) missing.push('RESEND_API_KEY');
  return missing;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * Post one message to Resend. Returns { ok:true, id } or { ok:false, error }.
 *
 * Both a `html` and a `text` body go on every send. Plain text is not a
 * courtesy: a mail client with images and HTML off, a screen reader, and most
 * spam filters all read the text part, and a message with no text alternative
 * scores worse on delivery — which for a verification email means the customer
 * never gets in.
 */
async function send({ to, subject, html, text }) {
  if (!configured()) {
    // Loud, because a deployment silently not sending verification emails looks
    // exactly like a deployment where nobody is signing up.
    console.error(`[daily-mail] NOT SENT (${missingConfig().join(', ')} missing) — "${subject}" to ${to}`);
    return { ok: false, error: 'Email is not configured on this deployment.' };
  }
  if (!to || !subject) {
    console.error('[daily-mail] NOT SENT — a recipient and a subject are both required');
    return { ok: false, error: 'Missing recipient or subject.' };
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [String(to)], subject: String(subject), html, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      // Resend puts the useful part in a JSON `message`; fall back to raw text
      // for anything that is not JSON (a gateway error page, usually).
      const detail = await res.text().catch(() => '');
      let reason = detail.slice(0, 200);
      try { reason = JSON.parse(detail)?.message || reason; } catch { /* not JSON, keep the text */ }
      console.error(`[daily-mail] send failed ${res.status} — "${subject}" to ${to}: ${reason}`);
      return { ok: false, error: `Email provider returned ${res.status}: ${reason}` };
    }

    const body = await res.json().catch(() => ({}));
    // Subject and recipient only. The body is deliberately absent from this line
    // — it is where the token is.
    console.log(`[daily-mail] sent "${subject}" to ${to} (${body?.id || 'no id'})`);
    return { ok: true, id: body?.id ?? null };
  } catch (err) {
    // A timeout, a DNS failure, Resend being down. All of it stops here.
    const reason = err?.name === 'TimeoutError'
      ? `no response within ${SEND_TIMEOUT_MS / 1000}s`
      : (err?.message || String(err));
    console.error(`[daily-mail] send threw — "${subject}" to ${to}: ${reason}`);
    return { ok: false, error: reason };
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

// The dark card from daily.cbedge.net itself, so the email looks like the thing
// the customer just signed up for rather than a generic receipt.
const BG = '#05060A';
const CARD = '#0D1119';
const BORDER = '#1C2230';
const TEXT = '#E6E9EF';
const MUTED = '#8A93A5';
const ACCENT = '#8ECAE6';

/**
 * Everything interpolated into an email body goes through here.
 *
 * `name` and `householdName` are user-supplied — someone can call themselves
 * `<img src=x onerror=...>` — and an invite is delivered to a THIRD PARTY, so
 * the one place an attacker controls text that lands in a stranger's inbox is
 * exactly the place that must not pass markup through.
 */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The shell every message shares.
 *
 * All styling is inline. Gmail strips <style> blocks, Outlook ignores most of a
 * stylesheet, and no mail client supports a linked one — an inline attribute is
 * the only thing that renders the same everywhere. Tables rather than flexbox
 * for the same unglamorous reason.
 *
 * The button is a padded <a>, not a <button>: buttons do not survive Outlook,
 * and the raw URL is repeated underneath in plain text because some clients
 * refuse to make a link clickable at all and the customer still has to be able
 * to get in.
 */
function layout({ heading, intro, ctaLabel, ctaUrl, outro }) {
  const button = ctaUrl ? `
      <tr><td style="padding:8px 0 4px;">
        <a href="${esc(ctaUrl)}" style="display:inline-block;background:${ACCENT};color:${BG};
           font-weight:600;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:8px;">
          ${esc(ctaLabel)}</a>
      </td></tr>
      <tr><td style="padding:14px 0 0;color:${MUTED};font-size:12px;line-height:1.6;">
        Or paste this into your browser:<br>
        <span style="color:${ACCENT};word-break:break-all;">${esc(ctaUrl)}</span>
      </td></tr>` : '';

  return `<div style="margin:0;padding:24px 12px;background:${BG};
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="max-width:520px;margin:0 auto;background:${CARD};border:1px solid ${BORDER};border-radius:14px;">
    <tr><td style="padding:28px 28px 8px;">
      <div style="color:${MUTED};font-size:12px;letter-spacing:.10em;text-transform:uppercase;">CB Edge Daily</div>
      <h1 style="margin:10px 0 0;color:${TEXT};font-size:21px;font-weight:600;line-height:1.3;">${esc(heading)}</h1>
    </td></tr>
    <tr><td style="padding:10px 28px 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="color:${TEXT};font-size:15px;line-height:1.65;padding-bottom:18px;">${intro}</td></tr>
        ${button}
        ${outro ? `<tr><td style="padding:18px 0 0;color:${MUTED};font-size:13px;line-height:1.6;">${outro}</td></tr>` : ''}
      </table>
    </td></tr>
    <tr><td style="padding:0 28px 26px;">
      <div style="border-top:1px solid ${BORDER};padding-top:16px;color:${MUTED};font-size:12px;line-height:1.6;">
        ${esc(BASE_URL.replace(/^https?:\/\//, ''))}
      </div>
    </td></tr>
  </table>
</div>`;
}

/** The plain-text twin of layout(). Written by hand rather than stripped from
 *  the HTML, because a regex-flattened table reads like a ransom note. */
function plain({ heading, intro, ctaLabel, ctaUrl, outro }) {
  return [
    'CB EDGE DAILY',
    '',
    heading,
    '',
    intro,
    ctaUrl ? `\n${ctaLabel}:\n${ctaUrl}` : '',
    outro ? `\n${outro}` : '',
    '',
    '—',
    BASE_URL.replace(/^https?:\/\//, ''),
  ].filter((l) => l !== '').join('\n');
}

/** Links are built here and nowhere else, so there is one place to check that a
 *  token is URL-encoded and never concatenated into a path. */
const linkTo = (route, token) => `${BASE_URL}/${route}?token=${encodeURIComponent(String(token || ''))}`;

/** A greeting that works whether or not we know who they are. Google signups
 *  arrive with a full name; an email signup may only have the address. */
const greet = (name) => (String(name || '').trim() ? `Hi ${esc(String(name).trim())},` : 'Hi,');
const greetPlain = (name) => (String(name || '').trim() ? `Hi ${String(name).trim()},` : 'Hi,');

// ---------------------------------------------------------------------------
// The four messages
// ---------------------------------------------------------------------------

/**
 * Every sender below returns { ok } and, on failure, { ok:false, error }. None
 * of them throw. See the header — the caller's job (create the account, mint the
 * reset token, record the invite) is already done by the time we are called, and
 * losing the email must not undo it.
 */

async function sendVerifyEmail({ to, name, token }) {
  const url = linkTo('verify', token);
  const heading = 'Confirm your email address';
  const introText = 'Confirm this address and your CB Edge Daily account is ready to use — your day, your lists, and the markets you follow, all in one place.';
  const outroText = 'This link works for the next seven days. If you didn’t create an account, you can ignore this email.';

  return send({
    to,
    subject: 'Confirm your email — CB Edge Daily',
    html: layout({
      heading,
      intro: `${greet(name)}<br><br>${esc(introText)}`,
      ctaLabel: 'Confirm my email',
      ctaUrl: url,
      outro: esc(outroText),
    }),
    text: plain({
      heading, intro: `${greetPlain(name)}\n\n${introText}`,
      ctaLabel: 'Confirm your email', ctaUrl: url, outro: outroText,
    }),
  });
}

async function sendPasswordReset({ to, name, token }) {
  const url = linkTo('reset', token);
  const heading = 'Reset your password';
  const introText = 'Use the link below to choose a new password. Signing in with it will also sign you out everywhere else.';
  // The expiry is stated because a reset link that quietly stopped working an
  // hour ago is the single most common "the site is broken" support message.
  const outroText = 'This link expires in one hour and can only be used once. If you didn’t ask for a password reset, nothing has changed on your account and you can safely ignore this.';

  return send({
    to,
    subject: 'Reset your CB Edge Daily password',
    html: layout({
      heading,
      intro: `${greet(name)}<br><br>${esc(introText)}`,
      ctaLabel: 'Choose a new password',
      ctaUrl: url,
      outro: esc(outroText),
    }),
    text: plain({
      heading, intro: `${greetPlain(name)}\n\n${introText}`,
      ctaLabel: 'Choose a new password', ctaUrl: url, outro: outroText,
    }),
  });
}

/**
 * The one message that goes to someone who is not yet a customer, which is why
 * both inviterName and householdName are escaped with particular care — see
 * esc(). It also says who invited them: an unexplained link to a site you have
 * never heard of is a phishing email, and gets treated like one.
 */
async function sendInvite({ to, inviterName, householdName, token }) {
  const url = linkTo('join', token);
  const who = String(inviterName || '').trim() || 'Someone';
  const house = String(householdName || '').trim() || 'their household';
  const heading = 'You’ve been invited to CB Edge Daily';
  const introText = `${who} has invited you to join ${house} on CB Edge Daily — a shared home for your tasks, meals, lists and plans. Accept the invitation to set up your sign-in.`;
  const outroText = 'If you weren’t expecting this, you can ignore it — nothing is created until you accept.';

  return send({
    to,
    subject: `${who} invited you to CB Edge Daily`,
    html: layout({
      heading,
      intro: esc(introText),
      ctaLabel: 'Accept the invitation',
      ctaUrl: url,
      outro: esc(outroText),
    }),
    text: plain({
      heading, intro: introText,
      ctaLabel: 'Accept the invitation', ctaUrl: url, outro: outroText,
    }),
  });
}

/** No token, so no link to guard — this one just points at the front door. */
async function sendWelcome({ to, name }) {
  const heading = 'You’re all set';
  const introText = 'Your CB Edge Daily account is ready. Start with today’s screen — add a couple of tasks and what’s for dinner — then turn on the Markets tab if you follow the economic and earnings calendars.';
  const outroText = 'Invite the other person in your household from Settings whenever you’re ready.';

  return send({
    to,
    subject: 'Welcome to CB Edge Daily',
    html: layout({
      heading,
      intro: `${greet(name)}<br><br>${esc(introText)}`,
      ctaLabel: 'Open CB Edge Daily',
      ctaUrl: BASE_URL,
      outro: esc(outroText),
    }),
    text: plain({
      heading, intro: `${greetPlain(name)}\n\n${introText}`,
      ctaLabel: 'Open CB Edge Daily', ctaUrl: BASE_URL, outro: outroText,
    }),
  });
}

module.exports = {
  configured, missingConfig, send,
  sendVerifyEmail, sendPasswordReset, sendInvite, sendWelcome,
  BASE_URL, FROM,
  // exported for tests
  _esc: esc, _layout: layout, _plain: plain, _linkTo: linkTo,
};
