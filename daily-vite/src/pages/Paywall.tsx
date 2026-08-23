import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth'
import { billing, ApiError, type Plan, type SubStatus } from '../api'
import { PlanChoice, PublicFrame } from './Pricing'
import { FormError } from './SignIn'
import { T, display, label, body, section, button, textAction } from '../theme'

/**
 * What a signed-in account with no live subscription sees instead of the app.
 *
 * The rule this screen is built around: it is NEVER a dead end. Somebody who
 * reaches it is signed in, which means they already trusted this thing with an
 * account, and quite possibly with money. Every state below ends in something
 * they can press — pick a plan, open the Stripe portal, fix a card, or sign out
 * — and every state names what actually happened rather than saying "no access".
 */

/**
 * After checkout, Stripe redirects the customer back here before its webhook is
 * guaranteed to have landed. Usually the webhook wins by a comfortable margin;
 * occasionally it is queued, retried, or delayed by seconds. In that window the
 * customer has a charge on their card and this app still believes they have no
 * subscription — which is the single worst screen the product can show, and the
 * one that generates a chargeback rather than a support email.
 *
 * So on ?checkout=success we pull the subscription straight from Stripe instead
 * of waiting to be told, and we do it a few times: three attempts about a second
 * and a half apart covers the realistic delay without leaving anybody watching a
 * spinner for a quarter of a minute. If all three come back short we stop and
 * show the paywall with an explanation and a portal link — quietly retrying
 * forever would be worse than admitting it.
 */
const SYNC_TRIES = 3
const SYNC_DELAY_MS = 1500

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function Paywall() {
  const [params] = useSearchParams()
  const justPaid = params.get('checkout') === 'success'
  const cancelled = params.get('checkout') === 'cancelled'

  const { user, refresh, signOut } = useAuth()
  const [settling, setSettling] = useState(justPaid)
  const [syncGaveUp, setSyncGaveUp] = useState(false)
  const ranSync = useRef(false)

  useEffect(() => {
    // The ref guard matters twice over: StrictMode double-invokes effects in
    // development, and this loop takes seconds — two of them interleaved would
    // fight over the same state.
    if (!justPaid || ranSync.current) return
    ranSync.current = true
    let alive = true

    void (async () => {
      for (let attempt = 1; attempt <= SYNC_TRIES; attempt++) {
        try {
          const s = await billing.sync()
          // /me is what the router reads, so refreshing it is what actually
          // opens the app. A successful sync that never reached the context
          // would leave the customer paid up and still looking at this page.
          await refresh()
          if (!alive) return
          if (s.status === 'active' || s.status === 'trialing') return
        } catch {
          // Swallowed on purpose. A failed sync is precisely the situation this
          // loop exists for; surfacing each attempt would flash an error at
          // somebody whose payment is about to be confirmed.
        }
        if (attempt < SYNC_TRIES) await sleep(SYNC_DELAY_MS)
      }
      if (alive) { setSettling(false); setSyncGaveUp(true) }
    })()

    return () => { alive = false }
  }, [justPaid, refresh])

  if (settling) return <Settling />

  const status: SubStatus = user?.subscription?.status ?? 'none'
  const returning = status !== 'none'

  return (
    <PublicFrame width={720}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        paddingBottom: 24,
      }}>
        <div style={label()}>{user?.email}</div>
        <button type="button" onClick={() => void signOut()} style={textAction({ color: T.muted })}>
          Sign out
        </button>
      </header>

      <div style={{ maxWidth: 560 }}>
        <div style={label({ color: T.accent })}>{STATUS[status].badge}</div>
        <h1 style={{ ...display(32), marginTop: 10 }}>{STATUS[status].title}</h1>
        <p style={{ ...body(16), color: T.inkSoft, marginTop: 12 }}>{STATUS[status].blurb}</p>
      </div>

      {syncGaveUp && (
        <div style={section({ marginTop: 22, maxWidth: 560 })}>
          <div style={label()}>Payment taken, not confirmed yet</div>
          <p style={{ ...body(15), color: T.inkSoft, marginTop: 8 }}>
            Stripe hasn't finished telling us about your payment. This usually clears
            within a minute — reload the page and it should let you straight in. If it
            doesn't, open the billing portal below: whatever it shows there is the
            truth, and we'll catch up to it.
          </p>
          <button type="button" onClick={() => window.location.reload()} style={{ ...button('ghost'), marginTop: 12 }}>
            Reload
          </button>
        </div>
      )}

      {cancelled && (
        <div style={section({ marginTop: 22, maxWidth: 560 })}>
          <p style={{ ...body(15), color: T.inkSoft, margin: 0 }}>
            You closed checkout before finishing. Nothing was charged — pick a plan
            whenever you're ready.
          </p>
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <Plans />
      </div>

      {/* Offered to anyone who has ever had a subscription, whatever state it is
          in now. A lapsed card, a cancellation they want to undo and an
          unfinished payment are all fixed in the same place, and it is the one
          screen that can show them their real invoices. */}
      {returning && (
        <div style={section({ marginTop: 22, maxWidth: 560 })}>
          <div style={label()}>Already a customer</div>
          <p style={{ ...body(15), color: T.inkSoft, marginTop: 8 }}>
            Update a card, restart a cancelled plan, or read your invoices in the
            billing portal.
          </p>
          <PortalButton />
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 26, alignItems: 'center' }}>
        {/* Settings stays reachable from here on purpose: it is where the email
            address, the household and sign-out live, and locking somebody out of
            it while their billing is broken is how an account becomes
            unfixable. */}
        <Link to="/settings" style={textAction({ color: T.muted })}>Account settings</Link>
        <Link to="/pricing" style={textAction({ color: T.muted })}>What's included</Link>
      </div>
    </PublicFrame>
  )
}

/** Shown while the post-checkout sync runs. Deliberately not the paywall: the
 *  whole point of the retry is that a customer who has just paid never sees a
 *  page asking them to pay. */
function Settling() {
  return (
    <PublicFrame width={520}>
      <div style={{ minHeight: '60dvh', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <div style={label({ color: T.accent })}>Payment received</div>
          <h1 style={{ ...display(30), marginTop: 10 }}>Setting up your household…</h1>
          <p style={{ ...body(15), color: T.inkSoft, marginTop: 12 }}>
            A few seconds while Stripe and Daily agree. Don't close this tab.
          </p>
        </div>
      </div>
    </PublicFrame>
  )
}

function Plans() {
  const q = useQuery({ queryKey: ['plans'], queryFn: () => billing.plans() })
  const [busy, setBusy] = useState<Plan['id'] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const choose = async (plan: Plan['id']) => {
    if (busy) return
    setBusy(plan); setError(null)
    try {
      const { url } = await billing.checkout(plan)
      window.location.assign(url)
      // No setBusy(null): the navigation is already in flight, and re-enabling
      // the buttons invites a second checkout session in the gap.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open checkout.')
      setBusy(null)
    }
  }

  if (q.isLoading) return <div style={label({ color: T.faint })}>Loading plans…</div>

  if (!q.data?.plans?.length) {
    return (
      <div style={section({ maxWidth: 560 })}>
        <div style={label()}>Plans unavailable</div>
        <p style={{ ...body(15), color: T.inkSoft, marginTop: 8 }}>
          We can't reach the billing service right now. Your account and everything in
          it are untouched — try again shortly.
        </p>
      </div>
    )
  }

  return (
    <>
      <div style={label({ marginBottom: 12 })}>Choose a plan</div>
      {error && <FormError>{error}</FormError>}
      <PlanChoice plans={q.data.plans} busy={busy} onChoose={choose} />
    </>
  )
}

function PortalButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div style={{ marginTop: 12 }}>
      {error && <FormError>{error}</FormError>}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (busy) return
          setBusy(true); setError(null)
          try {
            const { url } = await billing.portal()
            window.location.assign(url)
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not open the billing portal.')
            setBusy(false)
          }
        }}
        style={{ ...button('ghost'), opacity: busy ? 0.5 : 1 }}
      >
        {busy ? 'Opening…' : 'Open billing portal'}
      </button>
    </div>
  )
}

/**
 * Every subscription state, in words a customer would use. Two rules here:
 * nothing says "error" for a state the customer chose, and nothing is left to a
 * default — an unhandled status rendering as a blank heading is how somebody
 * ends up staring at a page that tells them nothing at all.
 */
const STATUS: Record<SubStatus, { badge: string; title: string; blurb: string }> = {
  none: {
    badge: 'No subscription',
    title: 'Pick a plan to get started',
    blurb: 'Your account exists and your data is safe — there just isn’t a subscription on it yet. Daily is paid from day one, so this is the last step.',
  },
  active: {
    badge: 'Active',
    title: 'Your subscription is active',
    blurb: 'If you are seeing this screen, something is out of step between your subscription and this session. Reload the page, or open the billing portal to check.',
  },
  trialing: {
    badge: 'Trial',
    title: 'Your trial is running',
    blurb: 'If you are seeing this screen, something is out of step between your subscription and this session. Reload the page, or open the billing portal to check.',
  },
  past_due: {
    badge: 'Payment failed',
    title: 'Your last payment didn’t go through',
    blurb: 'Nothing has been deleted and nothing is lost. Update the card in the billing portal and everything comes straight back.',
  },
  unpaid: {
    badge: 'Unpaid',
    title: 'There’s an unpaid invoice',
    blurb: 'Stripe stopped retrying after several failed attempts. Settle it in the billing portal, or start a fresh plan below — either way your household is exactly as you left it.',
  },
  canceled: {
    badge: 'Cancelled',
    title: 'Your subscription has ended',
    blurb: 'Everything you put in is still here and still yours. Start a plan again whenever you want it back.',
  },
  incomplete: {
    badge: 'Not finished',
    title: 'That payment was never completed',
    blurb: 'The card needed an extra confirmation step that didn’t finish — a bank prompt, usually. Try again below, or finish it in the billing portal.',
  },
  incomplete_expired: {
    badge: 'Expired',
    title: 'That payment attempt expired',
    blurb: 'It sat unconfirmed too long and Stripe closed it. Nothing was charged. Start again below.',
  },
  paused: {
    badge: 'Paused',
    title: 'Your subscription is paused',
    blurb: 'Billing is on hold, so the app is too. Resume it in the billing portal and you’re back where you were.',
  },
}
