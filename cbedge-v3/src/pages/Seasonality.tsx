import { useAuth } from '@/data/auth'
import SeasonalityView from '@/pages/seasonality/SeasonalityView'
import { SEA } from '@/pages/seasonality/seaTheme'

// ─────────────────────────────────────────────────────────────────────────────
// /seasonality — THE ALMANAC.
//
// 98 years of S&P 500 daily closes, plus the event studies built on the same
// record (FOMC, Jackson Hole, opex, earnings, and every Apple keynote since
// 2007). Ported from v2's /explore/seasonality on 2026-09-07 — the marketing
// page there stays exactly as it is and stays free; this is the in-app door,
// on the rail, for people who are paying.
//
// NOT wrapped in <Page />. The view is a self-contained grid block — a sticky
// section rail down the left, cards down the right — that expects to sit on a
// page ground it does not paint, on its own palette (seaTheme: six surfaces,
// darker and flatter than the app's cards, deliberately not promoted into
// design/tokens.css because it would restyle every route as a side effect).
// So the scroll container and the gutter belong here, in SEA.app, rather than
// in Page's padded column, whose gutter is sized for board cards.
//
// ── The gate ────────────────────────────────────────────────────────────────
// `isPaid` here decides what is DRAWN, exactly as data/auth.tsx says: it is
// chrome, not a gate. The same flag hides the rail icon in shell/Shell.tsx, and
// this check is what stops a typed URL rendering the page anyway. Neither is a
// security boundary — the almanac's own numbers ship in the route chunk, and
// the free page at /explore/seasonality serves most of them to anyone. If any
// of this ever becomes genuinely paid-only data, it moves behind an API the
// server gates, not behind this boolean.
// ─────────────────────────────────────────────────────────────────────────────

export default function Seasonality() {
  const { isPaid, isLoaded, isSignedIn } = useAuth()

  // Nothing until /api/auth/me answers — otherwise a subscriber sees the
  // upsell flash for a beat on every load, which reads as a billing problem.
  if (!isLoaded) return null

  if (!isPaid) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
        style={{ background: SEA.app }}
      >
        <span className="text-lg text-fg">The almanac is part of a subscription</span>
        <span className="max-w-prose text-sm text-faint">
          98 years of S&amp;P 500 seasonality, the FOMC and opex studies, and every Apple keynote
          since 2007 — month by month, day of week, turn of the month, with the sample size printed
          on every table.
        </span>
        <div className="flex items-center gap-3 pt-1 text-sm">
          <a className="underline" href={isSignedIn ? '/pricing' : '/sign-in'}>
            {isSignedIn ? 'See plans' : 'Sign in'}
          </a>
          <a className="text-faint underline" href="/explore/seasonality">
            Or read the free version
          </a>
        </div>
      </div>
    )
  }

  return (
    <main
      className="min-h-0 flex-1 overflow-y-auto"
      style={{ background: SEA.app, padding: 12 }}
    >
      <SeasonalityView />
    </main>
  )
}
