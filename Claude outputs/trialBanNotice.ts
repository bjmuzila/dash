// Sending the "your account can no longer use the free trial" notice.
//
// One module so the two callers cannot drift:
//
//   · app/api/stripe/checkout — AUTOMATIC, the first time a banned email or IP
//     opens checkout after the ban. Uses sendTrialBanNoticeOnce(), which claims
//     the notice atomically so concurrent attempts send exactly one mail.
//   · app/api/admin/trial-bans — MANUAL, the Sales page's "send notice" button.
//     Uses sendTrialBanNotice(), which always sends. That is the point of the
//     button: it is how the owner tells someone up front, or tells them again.
//
// WHY THE AUTOMATIC ONE IS LATCHED: a ban is permanent and the pricing page is
// a thing people refresh. Without the latch, someone who reloaded checkout six
// times would get six identical emails, which is the fastest way to turn a
// justified policy into a spam complaint.
//
// NEVER THROWS. A ban is enforced whether or not the mail goes out — a Resend
// outage must not turn a blocked trial into a 500 on the checkout route.

import {
  claimTrialBanNotice,
  markTrialBanNotifiedForce,
  type TrialBanRecord,
} from "@/lib/db";
import { sendAuthEmail } from "@/lib/emails/send";
import {
  trialBannedEmail,
  trialBannedText,
  TRIAL_BANNED_SUBJECT,
} from "@/lib/emails/trial-banned";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TrialBanNoticeResult {
  sent: boolean;
  /** Why nothing was sent — "no-recipient", "already-notified", or a send error. */
  reason?: string;
}

/**
 * How many trials this account has actually burned, for the "started N times"
 * line. Best-effort: the ban's own hit counter plus the one trial that was
 * legitimately claimed. Returns null when that adds up to less than two, and the
 * template then uses wording that quotes no number at all — better vague than
 * confidently wrong in an email about someone's billing.
 */
export function attemptsFromBan(ban: TrialBanRecord, extra = 0): number | null {
  const n = (ban.hit_count ?? 0) + extra;
  return n >= 2 ? n : null;
}

/**
 * Send the notice unconditionally. The manual path.
 *
 * `note` is the owner's reason, and it is only included when the caller passes
 * it — the admin route asks explicitly, because an internal note ("serial
 * abuser, 6 addresses") is not something to forward to the abuser.
 */
export async function sendTrialBanNotice(opts: {
  to: string;
  ban: TrialBanRecord;
  attempts?: number | null;
  note?: string | null;
}): Promise<TrialBanNoticeResult> {
  const to = (opts.to || "").trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return { sent: false, reason: "no-recipient" };

  try {
    const attempts = opts.attempts ?? attemptsFromBan(opts.ban);
    const res = await sendAuthEmail({
      to,
      subject: TRIAL_BANNED_SUBJECT,
      html: trialBannedEmail({ attempts, note: opts.note ?? null }),
      text: trialBannedText({ attempts, note: opts.note ?? null }),
    });
    if (!res.ok) return { sent: false, reason: res.reason || "send failed" };
    await markTrialBanNotifiedForce(opts.ban.id, to);
    return { sent: true };
  } catch (err) {
    console.error("[trialBanNotice] send failed:", err);
    return { sent: false, reason: String(err) };
  }
}

/**
 * Send the notice at most once per ban. The automatic path.
 *
 * Claims first, sends second: the claim is the conditional UPDATE that decides
 * who sends, so two simultaneous checkouts cannot both win it. If the send then
 * fails the ban stays stamped as notified — deliberate. The alternative is
 * retrying on every subsequent attempt, which reintroduces exactly the repeat
 * mailing the latch exists to prevent, and the owner can always resend by hand
 * from the Sales panel.
 */
export async function sendTrialBanNoticeOnce(opts: {
  to: string;
  ban: TrialBanRecord;
  attempts?: number | null;
}): Promise<TrialBanNoticeResult> {
  const to = (opts.to || "").trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return { sent: false, reason: "no-recipient" };

  try {
    const claimed = await claimTrialBanNotice(opts.ban.id, to);
    if (!claimed) return { sent: false, reason: "already-notified" };

    const attempts = opts.attempts ?? attemptsFromBan(opts.ban, 1);
    const res = await sendAuthEmail({
      to,
      subject: TRIAL_BANNED_SUBJECT,
      html: trialBannedEmail({ attempts }),
      text: trialBannedText({ attempts }),
    });
    if (!res.ok) {
      console.warn(`[trialBanNotice] ban ${opts.ban.id}: claimed but send failed — ${res.reason}`);
      return { sent: false, reason: res.reason || "send failed" };
    }
    return { sent: true };
  } catch (err) {
    console.error("[trialBanNotice] send-once failed:", err);
    return { sent: false, reason: String(err) };
  }
}
