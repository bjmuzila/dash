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

### Update — scanner proof card added

The template now opens its body with a **scanner proof block** above the price:
"Scanner caught this / MRNA flies / $0.75 → $95.00 = +12,567%", followed by a
replica of the live scanner card (rank + ticker, `0.6M` premium in cyan,
`2026-08-21 · spot 63.52`, `captured Aug 14 · 2:00 PM ET`, then the
`OTM 7.1% · +11142% vs open · score 44` row and `★ Very strong` in amber).

- Card fields live in a `ScannerProof` interface with a `DEFAULT_PROOF` const,
  overridable per-send via `opts.proof` — so the next catch is a one-object
  change, not a markup edit.
- All proof fields run through `escapeHtml()` once at the top of the renderer
  rather than at each of the dozen interpolation sites.
- Plain-text version carries the same block.
- Rendered and screenshotted headless to confirm the card matches the live one;
  preview at `generated/2026-08-20-edge3-annual-email-preview.png`.

### Update — layout reorganized

The template had drifted into the nopants/midnight shape, which states the
price four times (hero, standalone price block, invoice, button). That drumbeat
works for a countdown email; here it fought the proof card for attention and
the middle of the email read as a pile.

Restructured into seven labelled bands, one idea each, separated by hairline
rules and a small uppercase eyebrow:

    logo → hero (offer) → PROOF (scanner catch) → WHAT THE YEAR INCLUDES
         → THE OFFER (code + invoice, one card) → CTA → sign-off

- **Dropped the standalone `$400/yr` block.** The hero already says $400 and
  the invoice totals it; the third statement was noise.
- **Folded the code chip into the top of the invoice card.** Code and price
  were two floating elements making the same point — now one card: use this
  code, here is what it does to the bill.
- Included-pages list moved out of inline markup into an `INCLUDED` array and
  rendered as a two-column table so the `›` bullets hang instead of wrapping
  under the text.
- Section eyebrows go through an `eyebrow()` helper and the font stack through
  a `SANS` const, so the ~40 inline `font:` declarations stop drifting apart.
- Plain-text version follows the same band order, with the invoice amounts
  right-aligned to a 48-column rule instead of hand-counted spaces.
