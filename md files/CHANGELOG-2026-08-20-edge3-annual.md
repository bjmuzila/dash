## 2026-08-20 (n) - EDGE3 annual promo email template ($1,000/yr → $400/yr)

Added: `lib/emails/edge3-annual.ts`.
Edited: `app/api/admin/email-templates/route.ts`.

The EDGE3 annual-promo email was drafted in a previous session but the files
were only handed back as downloads — neither the template module nor the
picker registration ever landed on disk, which is why the preset never showed
up at owner.cbedge.net → Emails. Both are now written into the repo.

- **Template** — same invoice-style layout as `midnight-300.ts` /
  `nopants-promo.ts`, minus the countdown and spot-cap scarcity. Badge reads
  "60% off the annual plan", hero is `$400/yr` against a struck-through
  `$1,000.00` line, code block is **EDGE3**, fine print says explicitly "no
  countdown, no spot cap". Adds a short included-pages list (GEX, orderflow +
  scanner, EM/chain/multi-greek, phone build, future pages).
- Options (`price`, `listPrice`, `code`, `ctaUrl`, `email`) are all defaulted,
  so the picker's zero-arg call renders; percent-off and the ~$33/mo line are
  derived from the numbers rather than hardcoded.
- Keeps `{{UNSUBSCRIBE_URL}}` via `UNSUB_URL_PLACEHOLDER` so the send route can
  swap in the per-recipient tokenized link.
- **Registration** — appended last in `buildTemplates()` per the checklist in
  `EMAILS_HANDOFF.md`, so `newestFirst()` puts it at the top of the picker as
  `💎 Annual promo — $1,000/yr → $400/yr, no deadline (EDGE3)`.

Note: `/api/admin/email-templates` is still served by the Next route — it has
not been ported into `server-v2/api-router.js` — so this only reaches the live
owner site after a `.\push.ps1` deploy. **EDGE3 must exist as a coupon in
Stripe** or the code will fail at checkout.

