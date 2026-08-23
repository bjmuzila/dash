import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { billing, type Plan } from '../api'
import {
  T, display, label, body, section, card, button, textAction, SANS, SERIF,
} from '../theme'

/**
 * The plans page.
 *
 * This file is also where the rest of the signed-out surface gets its plan
 * rendering from. Landing, SignUp and Paywall all show the same two plans, and
 * the exports at the bottom of this file (`planPrice`, `PlanChoice`,
 * `WHAT_YOU_GET`, plus the shared public chrome) are how they stay identical.
 * Four hand-written copies of "$X / month" is four places for a price to be
 * wrong, and a price that is wrong on the homepage is a refund conversation.
 *
 * The imports only ever run one way — Landing/SignUp/Paywall import from here,
 * this file imports from none of them — so there is no cycle to trip over.
 *
 * NOTHING here hardcodes an amount. Every figure on this page comes from
 * billing.plans(), which reads it from Stripe.
 */
export default function Pricing() {
  const [params] = useSearchParams()
  const cancelled = params.get('checkout') === 'cancelled'
  const q = useQuery({ queryKey: ['plans'], queryFn: () => billing.plans() })

  return (
    <PublicFrame>
      <TopBar />

      <main style={{ padding: '10px 0 8px' }}>
        <div style={{ maxWidth: 620 }}>
          <div style={label()}>Plans</div>
          <h1 style={{ ...display(36), marginTop: 10 }}>One subscription, two people.</h1>
          <p style={{ ...body(16), color: T.inkSoft, marginTop: 12 }}>
            Daily is paid from the first day — there is no free tier and nothing to
            downgrade into. Pick monthly if you want to try it for a month, annual if
            you already know how you work.
          </p>
        </div>

        {/* A cancelled checkout is somebody changing their mind at the Stripe
            page, not a failure. It gets a flat sentence in the ordinary text
            colour: red and the word "error" would tell a person who did nothing
            wrong that something broke. */}
        {cancelled && (
          <div style={{ ...section({ marginTop: 22, maxWidth: 620 }) }}>
            <div style={label()}>Checkout closed</div>
            <p style={{ ...body(15), color: T.inkSoft, marginTop: 8 }}>
              Nothing was charged and nothing was set up. Pick a plan below whenever
              you're ready.
            </p>
          </div>
        )}

        <div style={{ marginTop: 26 }}>
          <PlanBlock
            plans={q.data?.plans}
            configured={q.data?.configured}
            loading={q.isLoading}
            failed={q.isError}
          />
        </div>

        <div style={{ ...section({ marginTop: 26, maxWidth: 620 }) }}>
          <div style={label()}>What you get</div>
          <ul style={{ margin: '12px 0 0', padding: 0, listStyle: 'none' }}>
            {WHAT_YOU_GET.map((line) => (
              <li key={line} style={{
                ...body(15), color: T.inkSoft,
                display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 0',
              }}>
                <span aria-hidden style={{ color: T.accent, fontFamily: SERIF, lineHeight: 1 }}>—</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ ...section({ marginTop: 18, maxWidth: 620 }) }}>
          <div style={label()}>The small print, in plain words</div>
          <p style={{ ...body(15), color: T.inkSoft, marginTop: 8 }}>
            A card is required to sign up. You can cancel from inside the app at any
            time and keep access to the end of the period you already paid for. Two
            people share one household and one bill — the second person is invited
            from Settings and costs nothing extra.
          </p>
        </div>
      </main>

      <PublicFooter />
    </PublicFrame>
  )
}

// ── Shared plan rendering ────────────────────────────────────────────────────

/**
 * Stripe reports amounts in the smallest unit of the currency — 1200 is twelve
 * dollars, not twelve hundred. Dividing by 100 here rather than at four call
 * sites is the difference between a wrong price on one page and a wrong price
 * everywhere. Whole amounts drop the cents, because "$12" reads as a price and
 * "$12.00" reads as an invoice line.
 */
export function planPrice(p: Plan): string {
  const amount = p.amount / 100
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (p.currency || 'usd').toUpperCase(),
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    // An unknown currency code throws rather than falling back, and a thrown
    // formatter on the pricing page takes the whole page down with it.
    return `${amount} ${(p.currency || '').toUpperCase()}`
  }
}

/** "per month" / "per year", from Stripe's interval, never from the plan id. */
export const planCadence = (p: Plan) => `per ${p.interval}`

export const WHAT_YOU_GET = [
  'Today — the whole day on one screen, and nothing you have to assemble.',
  'Tasks with a Top 3, an urgent flag, and a nudge when something starts slipping.',
  'Shared lists and a week of meals, sorted by aisle so one shop covers it.',
  'Habits with streaks, a 30-day history, and no punishment for one missed day.',
  'Projects with milestones and logged time.',
  'Money — your accounts, your bills, and what is actually left this month.',
  'The CB Edge economic and earnings calendars, in the same app as the rest of it.',
  'Your Google Calendar on Today, if you want it there.',
  'Two people in one household on one subscription.',
  'A 4-digit PIN for the phone you use every day.',
]

/**
 * The plan cards. Used on the pricing page, the landing page, the last step of
 * sign-up and the paywall — which is why it takes its plans as a prop instead of
 * fetching: the paywall already has them, and a second identical request while
 * somebody is mid-checkout is a request that can fail on its own.
 */
export function PlanChoice({ plans, chosen, busy, onChoose }: {
  plans: Plan[]
  chosen?: Plan['id'] | null
  busy?: Plan['id'] | null
  /** Omitted on the signed-out pages, where there is no account to attach a
   *  subscription to yet: the cards are then read-only and the CTA underneath
   *  goes to sign-up instead. */
  onChoose?: (id: Plan['id']) => void
}) {
  return (
    <div style={{
      display: 'grid', gap: 14,
      // Side by side the moment there is room, stacked below that. Two cards
      // squeezed into a 390px screen is two cards you can't read.
      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      maxWidth: 620,
    }}>
      {plans.map((p) => {
        const isChosen = chosen === p.id
        return (
          <div key={p.id} style={card({
            padding: 18,
            border: `1px solid ${isChosen ? T.accentSoft : T.rule}`,
            display: 'flex', flexDirection: 'column', gap: 10,
          })}>
            <div style={label({ color: isChosen ? T.accent : T.muted })}>{p.name}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontFamily: SERIF, fontSize: 40, fontWeight: 400, lineHeight: 1, letterSpacing: '-0.02em', color: T.ink }}>
                {planPrice(p)}
              </span>
              <span style={label({ letterSpacing: '0.08em' })}>{planCadence(p)}</span>
            </div>
            {p.blurb && (
              <p style={{ ...body(14), color: T.inkSoft, margin: 0 }}>{p.blurb}</p>
            )}
            {onChoose && (
              <button
                type="button"
                onClick={() => onChoose(p.id)}
                disabled={!!busy}
                style={{
                  ...button(isChosen ? 'primary' : 'ghost'),
                  width: '100%', marginTop: 'auto',
                  opacity: busy && busy !== p.id ? 0.45 : 1,
                }}
              >
                {busy === p.id ? 'Opening checkout…' : `Choose ${p.name}`}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Plans plus every way fetching them can go sideways. Stripe being unconfigured
 * and the request failing are different sentences: one means "not switched on
 * yet", the other means "try again". Neither may render as an empty gap where
 * the prices should be — a pricing page with no prices reads as a dead site.
 */
function PlanBlock({ plans, configured, loading, failed }: {
  plans?: Plan[]
  configured?: boolean
  loading: boolean
  failed: boolean
}) {
  if (loading) return <div style={label({ color: T.faint })}>Loading plans…</div>

  if (failed) {
    return (
      <div style={section({ maxWidth: 620 })}>
        <div style={label()}>Prices unavailable</div>
        <p style={{ ...body(15), color: T.inkSoft, marginTop: 8 }}>
          We couldn't reach the billing service just now. Reload in a moment — you can
          still create an account and pick a plan on the way in.
        </p>
        <Link to="/sign-up" style={{ ...textAction(), marginTop: 6 }}>Create an account →</Link>
      </div>
    )
  }

  if (!plans?.length || configured === false) {
    return (
      <div style={section({ maxWidth: 620 })}>
        <div style={label()}>Not open yet</div>
        <p style={{ ...body(15), color: T.inkSoft, marginTop: 8 }}>
          Signups aren't switched on at the moment. Nothing is broken — there is just
          nothing to sell you today.
        </p>
      </div>
    )
  }

  return (
    <>
      {/* Choosing a plan HERE, signed out, cannot open Stripe: checkout needs an
          account to attach the subscription to. So the card is a link into
          sign-up, where the same component appears again with a live handler. */}
      <PlanChoice plans={plans} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 18, maxWidth: 620 }}>
        <Link to="/sign-up" style={linkButton('primary')}>Start with a card</Link>
        <Link to="/sign-in" style={linkButton('ghost')}>Sign in</Link>
      </div>
    </>
  )
}

// ── Shared public chrome ─────────────────────────────────────────────────────

/** `button()` gives CSSProperties for a <button>. An <a> needs three more
 *  properties before it sits on the same baseline and stops underlining. */
export function linkButton(variant: 'primary' | 'ghost' = 'primary'): React.CSSProperties {
  return {
    ...button(variant),
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
  }
}

/**
 * The page shell every signed-out route sits in. Phone-first, but the landing
 * and pricing pages get read on laptops too, so the column is capped — a
 * paragraph running the full width of a 27" monitor is a paragraph nobody
 * finishes.
 */
export function PublicFrame({ children, width = 960 }: { children: React.ReactNode; width?: number }) {
  return (
    <div style={{
      minHeight: '100dvh',
      background: T.paper, backgroundImage: T.glow,
      color: T.ink, fontFamily: SANS,
      padding: 'max(18px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(28px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left))',
    }}>
      <div style={{ width: '100%', maxWidth: width, margin: '0 auto' }}>{children}</div>
    </div>
  )
}

export function TopBar() {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 16, paddingBottom: 26,
    }}>
      <Link to="/" style={{
        fontFamily: SERIF, fontSize: 22, fontWeight: 500, letterSpacing: '-0.015em',
        color: T.ink, textDecoration: 'none',
      }}>
        Daily
      </Link>
      <nav style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link to="/pricing" style={textAction({ color: T.muted })}>Pricing</Link>
        <Link to="/sign-in" style={textAction()}>Sign in</Link>
      </nav>
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer style={{
      marginTop: 44, paddingTop: 20, borderTop: `1px solid ${T.rule}`,
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 18,
    }}>
      <Link to="/pricing" style={textAction({ color: T.muted })}>Pricing</Link>
      <Link to="/sign-in" style={textAction({ color: T.muted })}>Sign in</Link>
      {/* Real pages served by the marketing site, not SPA routes — a plain <a>
          so the router doesn't swallow them into a 404 of its own. */}
      <a href="/terms" style={textAction({ color: T.muted })}>Terms</a>
      <a href="/privacy" style={textAction({ color: T.muted })}>Privacy</a>
      <span style={{ ...label({ color: T.faint, letterSpacing: '0.08em' }), marginLeft: 'auto' }}>
        daily.cbedge.net — from CB Edge
      </span>
    </footer>
  )
}
