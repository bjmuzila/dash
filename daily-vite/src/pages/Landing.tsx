import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { billing } from '../api'
import { PlanChoice, PublicFooter, PublicFrame, TopBar, linkButton } from './Pricing'
import { T, display, label, body, section, textAction, SERIF } from '../theme'

/**
 * The front page at /.
 *
 * This is the only screen in the product whose job is persuasion, and it is
 * still built entirely out of theme.ts — the same serif display type, the same
 * mono labels, the same cards. Somebody who signs up here should recognise the
 * app on the other side of the card form; a landing page in a different visual
 * language sets up a small disappointment on the very first screen.
 *
 * WHAT IS NOT HERE, deliberately: testimonials, customer logos, "join 4,000
 * households", star ratings. There are no customers yet. Inventing one is a lie
 * printed on the homepage of a product whose entire pitch is that it is the
 * thing its author actually uses — and it is the kind of lie people check.
 *
 * The prices come from billing.plans(). No amount is written into this file.
 */
export default function Landing() {
  const q = useQuery({ queryKey: ['plans'], queryFn: () => billing.plans() })
  const plans = q.data?.plans ?? []

  return (
    <PublicFrame>
      <TopBar />

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <div style={{ padding: '18px 0 8px', maxWidth: 700 }}>
          <div style={label({ color: T.accent })}>daily.cbedge.net</div>
          <h1 style={{
            ...display(clampedHero()),
            marginTop: 14,
            // A shade looser than the app's screen titles: this is the one
            // headline someone reads standing still rather than mid-task.
            lineHeight: 1.08,
          }}>
            Your whole day — tasks, meals, money and the market calendar — on one screen.
          </h1>
          <p style={{ ...body(17), color: T.inkSoft, marginTop: 16, maxWidth: 580 }}>
            Built for someone running their own life out of one app — and who also
            watches the market open. It started as a private thing its author used
            every morning; this is that app, for you.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 26 }}>
            <Link to="/sign-up" style={{ ...linkButton('primary'), paddingLeft: 26, paddingRight: 26 }}>
              Start with Daily
            </Link>
            <Link to="/sign-in" style={linkButton('ghost')}>Sign in</Link>
          </div>
          {/* Said here, before the card form, rather than discovered at Stripe.
              "No free tier" is a real objection and burying it does not make it
              go away — it just moves the moment somebody feels tricked. */}
          <div style={{ ...label({ color: T.faint, letterSpacing: '0.08em' }), marginTop: 14, lineHeight: 1.7 }}>
            Card required · No free tier · Cancel any time
          </div>
        </div>

        {/* ── What it does ─────────────────────────────────────────────── */}
        <div style={{ marginTop: 52 }}>
          <div style={label()}>What's in it</div>
          <div style={{
            display: 'grid', gap: 14, marginTop: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          }}>
            {FEATURES.map((f, i) => (
              <Feature key={f.title} n={i + 1} {...f} />
            ))}
          </div>
        </div>

        {/* ── Plans ────────────────────────────────────────────────────── */}
        <div style={{ marginTop: 52 }}>
          <div style={label()}>Plans</div>
          <h2 style={{ ...display(28), marginTop: 10 }}>One price, everything in it.</h2>
          <p style={{ ...body(16), color: T.inkSoft, marginTop: 10, maxWidth: 560 }}>
            Monthly or annual. Every screen is included on both — there is no tier
            that holds a feature back.
          </p>

          <div style={{ marginTop: 20 }}>
            {q.isLoading && <div style={label({ color: T.faint })}>Loading plans…</div>}

            {/* If billing is unreachable or switched off, the page still has to
                end somewhere useful. A silent gap where the prices should be is
                the moment a visitor decides the site is abandoned. */}
            {!q.isLoading && !plans.length && (
              <div style={section({ maxWidth: 620 })}>
                <p style={{ ...body(15), color: T.inkSoft, margin: 0 }}>
                  Prices aren't loading right now. They're on the{' '}
                  <Link to="/pricing" style={{ color: T.accent }}>pricing page</Link>, and
                  you'll see them again before anything is charged.
                </p>
              </div>
            )}

            {!!plans.length && <PlanChoice plans={plans} />}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
            <Link to="/sign-up" style={linkButton('primary')}>Create your account</Link>
            <Link to="/pricing" style={textAction()}>See what's included →</Link>
          </div>
        </div>

        {/* ── Closing ──────────────────────────────────────────────────── */}
        <div style={{ ...section({ marginTop: 44, maxWidth: 700 }) }}>
          <div style={label()}>Why it's paid</div>
          <p style={{ ...body(16), color: T.inkSoft, marginTop: 10 }}>
            Because the alternative is selling something else — your grocery list, your
            bank balances, your calendar. Daily has no ads, no analytics on your
            content, and no free tier that has to be paid for some other way. You pay
            for it, so it works for you.
          </p>
        </div>
      </main>

      <PublicFooter />
    </PublicFrame>
  )
}

/**
 * The headline steps down on a phone. `display()` takes a fixed pixel size, so
 * the choice happens here rather than in a media query — there is no stylesheet
 * in this app to put one in.
 */
function clampedHero() {
  if (typeof window === 'undefined') return 40
  return window.innerWidth < 480 ? 32 : window.innerWidth < 820 ? 40 : 50
}

const FEATURES = [
  {
    title: 'Today',
    lines: [
      'One screen for the whole day: your Top 3, what is due, tonight\'s dinner, the weather, what is left in the bank.',
      'Assembled for you when you open it — there is no dashboard to configure first.',
    ],
  },
  {
    title: 'Lists & meals',
    lines: [
      'A grocery list sorted by aisle, so one walk round the shop covers it.',
      'Plan the week\'s meals and the ingredients land on the list already grouped.',
    ],
  },
  {
    title: 'Habits & projects',
    lines: [
      'Streaks that survive a missed day — one skipped Tuesday should not erase five weeks.',
      'Projects carry milestones, the tasks underneath them, and the time you actually logged.',
    ],
  },
  {
    title: 'Money',
    lines: [
      'Your accounts, your recurring bills, and the number that matters: what is actually left.',
      'Every bill projected to the end of the month, so a paycheque gap is visible before it happens.',
    ],
  },
  {
    title: 'Markets',
    lines: [
      'The CB Edge economic calendar and earnings calendar, the same feeds the trading platform runs on.',
      'CPI at 8:30 and who reports after the close, in the same app as the school run.',
    ],
  },
]

function Feature({ n, title, lines }: { n: number; title: string; lines: string[] }) {
  return (
    <div style={section({ padding: 18 })}>
      <div style={label({ color: T.faint, letterSpacing: '0.18em' })}>
        {String(n).padStart(2, '0')}
      </div>
      <h3 style={{
        fontFamily: SERIF, fontSize: 22, fontWeight: 500, letterSpacing: '-0.015em',
        lineHeight: 1.15, color: T.ink, margin: '8px 0 0',
      }}>
        {title}
      </h3>
      {lines.map((l) => (
        <p key={l} style={{ ...body(15), color: T.inkSoft, margin: '9px 0 0' }}>{l}</p>
      ))}
    </div>
  )
}
