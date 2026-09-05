import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/data/auth'

// ─────────────────────────────────────────────────────────────────────────────
// THE LIVE OFFER — a dropdown in the toolbar, not a popup.
//
// Someone who took the free trial and did not convert, or who made an account
// and never came back, gets a "first month at $30, normal price after" offer
// (lib/lifecycleOffers.ts). It is minted as a Stripe promotion code RESTRICTED
// TO THEIR CUSTOMER and pre-applied by /api/stripe/checkout, so the discount is
// attached to the ACCOUNT — checkout was going to give them the price whether
// or not they ever opened the email.
//
// WHICH IS WHY THIS IS NOT A MODAL. There is nothing the user must do. A dialog
// that blocks the board to announce a price they already have is an interruption
// dressed up as a favour. This says the offer exists, from the toolbar, and
// waits. It also reaches everyone the email did not — bounced, filtered, unread
// — which was a silent loss.
//
// NO DISMISS BUTTON, on purpose. Outside click, Esc, or simply ignoring it all
// close the panel, and none of them can lose the offer: the pill stays until the
// offer is redeemed or expires, at which point /api/offers/active stops
// returning it and this unmounts itself. There is no state anyone can reach
// where a live offer has been permanently dismissed.
//
// It auto-opens ONCE per code per browser, because a pill nobody notices
// converts nobody. The localStorage flag is a convenience, not state that
// matters — cleared storage or a second device just means one more auto-open —
// and it is try/caught because Safari private mode throws on access.
//
// RENDERS NOTHING for almost everyone: no fetch at all for signed-out or
// currently-paying accounts, and `{ offer: null }` for everyone else with no
// live offer.
//
// Colours come from tokens only (non-negotiable 1). `warn` is the amber the
// shell already uses for "something is waiting for you" — the same token behind
// the unread-ticket dot on the avatar.
// ─────────────────────────────────────────────────────────────────────────────

/** /pricing is a Next route OUTSIDE the SPA — see the note on the anchor below. */
const CLAIM_HREF = '/pricing'
const AUTO_OPEN_DELAY_MS = 900
const SEEN_KEY_PREFIX = 'cbe_offer_seen:'

interface ActiveOffer {
  kind: string | null
  code: string | null
  offerCents: number | null
  listCents: number | null
  expiresAt: string | null
}

function money(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`
}

/** "3 days left" / "ends today" / null when there is no expiry to report. */
function daysLeft(iso: string | null): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const days = Math.ceil(ms / 86_400_000)
  return days <= 1 ? 'ends today' : `${days} days left`
}

export function OfferPill() {
  const { user, isPaid } = useAuth()
  const [offer, setOffer] = useState<ActiveOffer | null>(null)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // ── load ───────────────────────────────────────────────────────────────────
  // Skipped entirely for signed-out and for anyone who currently HAS access:
  // a paying customer has no win-back to be shown, and that is most signed-in
  // users, so this is one fewer request on almost every session.
  //
  // Silent by design — the endpoint answers { offer: null } for its own failures
  // too, so there is nothing here worth a console entry on every page load.
  useEffect(() => {
    if (!user || isPaid) {
      setOffer(null)
      return
    }
    let alive = true
    void (async () => {
      try {
        const r = await fetch('/api/offers/active', { cache: 'no-store', credentials: 'same-origin' })
        if (!r.ok) return
        const j = (await r.json()) as { offer?: ActiveOffer | null }
        const o = j?.offer
        if (alive && o?.offerCents && o?.listCents) setOffer(o)
      } catch {
        /* no pill, no noise */
      }
    })()
    return () => {
      alive = false
    }
  }, [user, isPaid])

  // ── auto-open, once per code per browser ──────────────────────────────────
  useEffect(() => {
    const code = offer?.code
    if (!code) return
    const key = SEEN_KEY_PREFIX + code
    let seen = false
    try {
      seen = localStorage.getItem(key) === '1'
    } catch {
      /* private mode — treat as unseen, it just opens once more */
    }
    if (seen) return
    const id = window.setTimeout(() => {
      setOpen(true)
      try {
        localStorage.setItem(key, '1')
      } catch {
        /* nothing to do */
      }
    }, AUTO_OPEN_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [offer?.code])

  // ── close on outside pointer / Esc ────────────────────────────────────────
  // Both, because the panel has no dismiss button: whichever reflex the user
  // has, it works. Same listeners UserMenu uses, for the same reason.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!offer?.offerCents || !offer?.listCents) return null

  const offerStr = money(offer.offerCents)
  const listStr = money(offer.listCents)
  const savedStr = money(offer.listCents - offer.offerCents)
  const left = daysLeft(offer.expiresAt)

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={`Your first month is ${offerStr} instead of ${listStr}${left ? ` — ${left}` : ''}`}
        className={[
          'flex h-7 items-center gap-1.5 rounded-sm border border-warn bg-raised px-2.5',
          'text-xs font-bold tracking-wide text-warn transition-opacity',
          open ? 'opacity-100' : 'opacity-80 hover:opacity-100',
        ].join(' ')}
      >
        <span aria-hidden>★</span>
        {offerStr} first month
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Your offer"
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-md border border-line bg-surface p-3 shadow-lg"
        >
          <div className="text-xs uppercase tracking-wider text-faint opacity-60">Your first month</div>

          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-black leading-none text-warn">{offerStr}</span>
            <span className="text-xs text-faint line-through opacity-60">{listStr}</span>
            <span className="text-xs text-up">save {savedStr}</span>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-muted opacity-80">
            Then <span className="font-bold text-fg">{listStr}/month</span>, cancel any time. It&apos;s already on
            your account — start the monthly plan and the price is applied at checkout. Nothing to type.
          </p>

          {/* A NATIVE <a>, never the router. v3 runs with basename="/v3", so a
              <NavLink to="/pricing"> resolves to /v3/pricing — not a v3 route,
              and App.tsx's no-catch-all rule renders NotFound rather than the
              real Next page. Same rule UserMenu.tsx states once for all of its
              links; /pricing is a top-level Next route outside this SPA. */}
          <a
            href={CLAIM_HREF}
            className="mt-3 block rounded-sm bg-warn px-3 py-2 text-center text-xs font-bold text-bg no-underline"
          >
            Claim {offerStr} for a month →
          </a>

          <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-faint opacity-60">
            <span>{left ?? 'no expiry'}</span>
            {offer.code && <span className="font-mono">{offer.code}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
