import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { admin, ApiError, type SubStatus } from '../api'
import { T, display, label, body, section, tile, textAction } from '../theme'

/**
 * The owner's view of the site — who has signed up and what their billing says.
 *
 * DELIBERATELY READ-ONLY. There is no button here that edits a customer, and
 * that is a decision rather than an unfinished feature: an admin panel that can
 * change somebody's data is a panel that will one day change the wrong
 * somebody's, and every write it could offer is already available over psql to
 * whoever has the box. What this screen is for is answering "is anybody using
 * it, and is Stripe agreeing with us" without SSHing in.
 *
 * The route is guarded twice, and the two guards do different jobs. `user.admin`
 * decides whether the tab is drawn; the SERVER decides whether the data comes
 * back, re-checking the session's own email on every request. A browser that
 * lies about the first one gets an empty screen from the second.
 *
 * A non-owner asking for the data gets a 404 rather than a 403, which is why
 * this renders "nothing here" rather than "access denied" — repeating the
 * server's own answer instead of contradicting it.
 */

const STATUS_WORD: Record<string, string> = {
  none: 'No subscription',
  active: 'Active',
  trialing: 'Trialing',
  past_due: 'Card declined',
  canceled: 'Cancelled',
  unpaid: 'Unpaid',
  incomplete: 'Checkout unfinished',
  incomplete_expired: 'Checkout expired',
  paused: 'Paused',
}

/** Paying, about to pay, or being chased — versus everything else. Only used to
 *  colour a chip, never to decide access; the server owns that. */
const LIVE = new Set<SubStatus>(['active', 'trialing', 'past_due'])

const when = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Admin() {
  const { user } = useAuth()
  const q = useQuery({
    queryKey: ['admin-overview'],
    queryFn: admin.overview,
    // Signups do not arrive by the second, and this screen is opened to answer a
    // question rather than to be watched. A minute of staleness costs nothing.
    staleTime: 60_000,
    retry: false,
    enabled: !!user?.admin,
  })

  if (!user?.admin) {
    return (
      <section style={section()}>
        <div style={label()}>Nothing here</div>
        <p style={{ ...body(15), color: T.inkSoft, marginTop: 10 }}>
          This page doesn't exist for your account.{' '}
          <Link to="/today" style={{ color: T.accent }}>Back to Today</Link>
        </p>
      </section>
    )
  }

  if (q.isLoading) return <div style={label({ color: T.faint })}>Loading…</div>

  if (q.error) {
    return (
      <section style={section()}>
        <div style={label({ color: T.bad })}>Couldn't load it</div>
        <p style={{ ...body(15), color: T.inkSoft, marginTop: 10 }}>
          {q.error instanceof ApiError ? q.error.message : 'Something went wrong.'}
        </p>
        <button onClick={() => void q.refetch()} style={{ ...textAction(), marginTop: 10 }}>
          Try again
        </button>
      </section>
    )
  }

  const d = q.data
  if (!d) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section style={section()}>
        <div style={label()}>Site</div>
        <div style={{
          display: 'grid', gap: 10, marginTop: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        }}>
          <Stat n={d.totals.accounts} of="accounts" />
          <Stat n={d.totals.new_this_week} of="new this week" />
          <Stat n={d.totals.active_this_week} of="signed in this week" />
          <Stat n={d.totals.households} of="tenants" />
        </div>
      </section>

      <section style={section()}>
        <div style={label()}>Billing</div>
        {d.byStatus.length === 0 ? (
          <p style={{ ...body(15), color: T.muted, marginTop: 10 }}>Nothing recorded yet.</p>
        ) : (
          <div style={{ marginTop: 6 }}>
            {d.byStatus.map((s) => (
              <div key={s.status} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                padding: '11px 0', borderTop: `1px solid ${T.rule}`,
              }}>
                <span style={{ ...body(15), color: LIVE.has(s.status) ? T.ink : T.muted }}>
                  {STATUS_WORD[s.status] ?? s.status}
                </span>
                <span style={{ ...body(15), color: T.ink }}>{s.n}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={section()}>
        <div style={label()}>Newest accounts</div>
        {/* Capped at 50 server-side and SAID so, because a list that silently
            stops at fifty reads as "that's everyone" on the day it isn't. */}
        <div style={label({ color: T.faint, letterSpacing: '0.06em', marginTop: 6 })}>
          Most recent 50
        </div>

        {d.recent.length === 0 ? (
          <p style={{ ...body(15), color: T.muted, marginTop: 12 }}>Nobody has signed up yet.</p>
        ) : (
          // Its own horizontal scroll rather than letting the page scroll
          // sideways — an email address is as wide as it is, and on a phone the
          // rest of the app must not shift because of one long address.
          <div style={{ marginTop: 6, overflowX: 'auto' }}>
            {d.recent.map((r) => (
              <div key={r.id} style={{ padding: '12px 0', borderTop: `1px solid ${T.rule}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                  <span style={{ ...body(15), wordBreak: 'break-all' }}>{r.email}</span>
                  <span style={{
                    ...label({ letterSpacing: '0.06em' }),
                    color: LIVE.has(r.subStatus) ? T.good : T.muted,
                    whiteSpace: 'nowrap',
                  }}>
                    {STATUS_WORD[r.subStatus] ?? r.subStatus}
                  </span>
                </div>
                <div style={label({ marginTop: 5, letterSpacing: '0.06em', color: T.faint })}>
                  {[
                    r.displayName,
                    `joined ${when(r.createdAt)}`,
                    r.lastLoginAt ? `last in ${when(r.lastLoginAt)}` : 'never signed in',
                    r.verified ? null : 'unverified',
                    r.plan,
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ n, of }: { n: number; of: string }) {
  return (
    <div style={tile()}>
      <div style={{ ...display(26) }}>{n}</div>
      <div style={label({ marginTop: 4, letterSpacing: '0.08em' })}>{of}</div>
    </div>
  )
}
