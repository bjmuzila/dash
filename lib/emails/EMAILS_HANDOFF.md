# CB Edge — Email System Handoff

Everything about the email/broadcast system, for a new session to take over.

## How the email system works

Two send paths:

1. **Owner broadcast** — the owner composes/sends from the UI at `/owner/admin/emails`
   (page: `app/owner/admin/emails/page.tsx`). It POSTs to `app/api/admin/send-email/route.ts`,
   which sends **per-recipient** via **Resend** with a tokenized unsubscribe footer +
   RFC 8058 one-click `List-Unsubscribe` headers. Owner-gated by `OWNER_USER_ID`.
2. **Transactional (automatic)** — server code sends a single email via the shared helper
   `lib/emails/send.ts` (`sendTransactional`, `lookupUser`). Currently used by the Stripe
   webhook to auto-send the founder thank-you on a new paid signup (see below).

**Templates** are TypeScript modules in `lib/emails/`. Each exports:
`XxxEmail()` (HTML string), `xxxText()` (plain-text), and `XXX_SUBJECT`.
They're registered as one-click presets in `app/api/admin/email-templates/route.ts`
(`buildTemplates()`), which the compose page loads into the editor.

## Brand / template conventions (match these for any new email)

- Palette (from `components/shared/homeTheme.ts`): bg `#05060A`, panel `#0D1119`,
  cyan `#219EBC`, accent `#8ECAE6`, body text `#d4dde6`.
- Structure: dark shell, 3px cyan accent bar, centered logo
  (`${SITE_URL}/cb-edge-logo.png`, ~260px), heading + subheading, body, optional
  cyan callout card, cyan CTA button, footer.
- Email-client-safe: table layout, all styles inline, no external CSS.
- Every template must contain the `{{UNSUBSCRIBE_URL}}` placeholder (from
  `lib/unsubscribe.ts` `UNSUB_URL_PLACEHOLDER`). The send route swaps it per-recipient.
  Don't remove it — it guarantees exactly one working unsubscribe link.
- Footer currently: Unsubscribe · cbedge.net (both 14px) + "Market analytics, not
  financial advice." The "You're receiving this because…" line was intentionally removed.
- `escapeHtml()` helper is copied into each template for any interpolated user text.

## Current registered templates (order in the picker)

1. `subscriber-thankyou` — "Subscriber thank-you + weekend dashboard". Thanks subscribers;
   teases this weekend's unified homepage that wires every page's data into one screen.
   Contains the phrase "fuck this market up" (intentional, keep). Signed "— The CB Edge Team".
2. `founder-thankyou` — "Founder thank-you (auto-welcome)". Warm founder note; CB = sons
   Conor + Brennan; "dream come true / against all odds". **This is the one auto-sent on
   new paid signup.** Signed "— Bzila". (`lib/emails/founder-thankyou.ts`)
3. `maintenance` — "Maintenance — hardware upgrade". Framed as planned "upgrade as we scale"
   (NOT "machines couldn't keep up"). Signed "— Bzila".
4. `launch` — "Fully launched — 20% off (LAUNCH)". Founder launch note. Code **LAUNCH** = 20% off.
5. `launch-promo` — "🚀 Launch sale promo — 20% off (LAUNCH)". Big marketing layout, no
   personal name (owner kept vague), signed "— The CB Edge Team". Code **LAUNCH**.

## Coupons referenced in emails (must exist in Stripe)

- `CB-BETA` — 50% off (beta). Used by older removed emails.
- `LAUNCH` — 20% off. Used by `launch` and `launch-promo`. **Confirm it exists in Stripe.**

## Retired / removed (hidden from picker, files may still exist unused)

- `welcome` (Beta welcome), `coming-soon`, `beta-live` (`lib/emails/announce.ts`),
  `beta-launch` "Launch update — pushed to July 1" (`lib/emails/beta-launch.ts`) —
  all unregistered from the picker.
- `lib/emails/beta-coupon-expiry.ts` — the "last chance — 50% off ends Jul 6" email.
  Emptied to `export {}` (couldn't shell-delete; superseded by `launch.ts`).
- These files are still on disk but not imported. Safe to delete later if desired.

## Auto-welcome on new PAID signup (already wired)

- Trigger: `app/api/stripe/webhook/route.ts` → `syncSubscription()` → `maybeSendWelcome()`
  fires when a subscription becomes paid (`PAID_STATUSES` = active/trialing).
- Idempotency: `subscriptions.welcome_email_sent_at` column + `claimWelcomeEmail()` in
  `lib/db.ts` (atomic `UPDATE … WHERE welcome_email_sent_at IS NULL`) → exactly one email.
- Email sent: `founderThankYouEmail()` via `sendTransactional()`.
- `lib/emails/send.ts` `lookupUser()` resolves email from OUR users table via
  `getUserById` (firstName is always null now — post Supabase-Auth migration).
- Non-blocking: mail failure is logged, never fails the webhook.

## Recipient lists / audiences (compose page)

Audiences: All users, Subscribers, Not paying, Waitlist, Old emails, Old emails 2, Custom.
Each built-in list has **View list** and **Edit list**. "Edit list" loads that list's
addresses into the editable Custom box so you can delete recipients before a send
(send-time only — not a permanent DB change). To send the subscriber thank-you, pick
the **Subscribers** audience.

## Env required (already set on VPS unless noted)

`RESEND_API_KEY`, `EMAIL_FROM` (default "CB Edge <hello@cbedge.net>"),
`OWNER_USER_ID`, `UNSUBSCRIBE_SECRET` (or `WAITLIST_ADMIN_SECRET`),
plus Supabase/DB envs used elsewhere.

## Deploy

Never run git/push here. Owner runs on the LAPTOP:
`cd C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed` then `.\push.ps1`
(commits, pushes to GitHub, auto-deploys to the VPS). `push.ps1` runs `next build` as a
gate — a TypeScript error stops the push. Workspace VM has been down, so builds can't be
verified from chat; rely on the push build gate.

## Adding a new template — checklist

1. Create `lib/emails/<name>.ts` with `xxxEmail()`, `xxxText()`, `XXX_SUBJECT`
   (copy an existing template as the base; keep `{{UNSUBSCRIBE_URL}}`).
2. Import + add an entry to `buildTemplates()` in `app/api/admin/email-templates/route.ts`.
3. (Optional) Write a standalone `*-preview.html` in the outputs folder for a browser preview.
4. Tell the owner to `.\push.ps1`.
