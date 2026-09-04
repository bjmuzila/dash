// ─────────────────────────────────────────────────────────────────────────────
// LEVEL LOG — /v3/level-log
//
// FIRST SLICE OF THE PORT: the WALL MIGRATION chart and nothing else.
//
// v2's /app/level-log is 2,608 lines and thirteen surfaces; the spec for all of
// it is docs/parity/level-log.md (283 checklist rows, Parts A–Q). What has come
// across here is Part H (`WallMigrationChart`), Part I's RANGE behaviour, and
// the slice of Part P those two need. Still to come, in the parity doc's order:
// the ticker rail (E), the log card head (F), the capture rail and chips (G),
// the churn strip (J), the timeline (L), the reaction legend (M) and
// `buildLogText` (Q). Nothing below is a placeholder for them — they are simply
// not built yet, and this page says what it shows.
//
// WHAT IS DELIBERATELY NOT v2's:
//   · Part I's popout. v2 drew the week view in a portalled modal with its own
//     scrim, Escape handler and close button, which Part S lists as v2-only
//     chrome. v3 already has ONE way to make a card full size — the expand
//     control every Card carries (design/primitives/Expand.tsx) — and the range
//     switch that made the popout worth opening lives in the toolbar, where it
//     works at either size. So TODAY / 5 SESSIONS is a control, not a mode.
//   · v2 defaulted the popout to 5 sessions because opening it was an explicit
//     act. Here the range is always on screen, so it opens on TODAY: up to
//     thirteen requests must not be the cost of landing on the page.
//
// THE TICKER IS THE TOOLBAR'S. This page carries no ticker box of its own — it
// reads `usePageSymbol()`, the one symbol the app toolbar sets, for exactly the
// reason src/data/symbol.tsx gives: a second picker for the same thing is a
// second way to end up looking at two symbols at once and not notice. Only the
// DATE lives in the query string, so /v3/level-log?date=2026-09-02 still shares
// a session — which is why app/v3/level-log/route.ts has to answer it.
//
// THE RAIL SETS THAT SAME SYMBOL. The card strip above the log (Part E, as
// cards — see levelLog/TickerRail.tsx) is a SELECTOR, not a second picker: a
// card writes the page symbol the toolbar owns, so the two always agree and the
// log below is always the log of the card that is lit. Which cards are on the
// rail is per browser, and the owner's copy also lives in Postgres — the
// two-tier note is in levelLog/railStore.ts.
//
// CORE MIGRATION opens `public/core-migration.html` — v2's standalone long-range
// chart (the selected ticker's CORE across the last 63 recorded sessions, walls
// on a toggle) — in its own tab, primed with WHATEVER THIS PAGE IS ON: the
// toolbar's symbol, the selected date as the range's end, and both variant
// switches. Nothing is copied across; that page reads its own data (one
// `/api/walls-range`, falling back to `/proxy/walls` a session at a time), so a
// tab left open can simply be reloaded.
//
// It stays a plain static file rather than becoming a v3 route: it is the same
// HTML that lives in `generated/` for hand-editing, and a static file needs no
// route, no `lazy()` import and no `app/v3/<name>/route.ts`. The href is
// root-absolute and `window.open` bypasses the router, so the /v3 basename does
// not apply to it — which is exactly what we want, since the file is served from
// the v2 app's `public/` at the site root.
//
// LIVE ON TODAY, ONE MINUTE AT A TIME. The price line is a 1-minute tape, so a
// minute is the cadence the data itself has. v2 polls not at all — "so an open
// tab never hammers the recorder" — and that reasoning survives everywhere it
// still applies: the tick runs ONLY when the selected date is today ET, only
// while the tab is visible, and only in the single-session view (the week view
// would spend up to thirteen requests a minute to move one of five slices). A
// past session cannot change, so a tab left on one costs nothing at all.
//
// SNAPSHOT is the toolbar camera's, not a button of this page's own. The page
// publishes the CARD — not the plot — to `useCopyShotTargets`, because a PNG of
// the lines alone is a picture of some lines with no idea what they are of; the
// card carries the ticker, the date, the variant and the legend. It resolves
// through `[data-card-instance]` at click time rather than a ref, so the shot
// still finds the card while it is expanded and living outside its tile.
//
// REST-only: no socket, no canvas. Non-negotiables 2, 4, 5 and 6 have nothing
// to bite on.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardToolbar } from '@/design/primitives/Card'
import { SegGroup } from '@/design/primitives/Controls'
import { Page } from '@/design/primitives/Page'
import { LEVEL_COLORS, alpha } from '@/design/theme'
import { usePageSymbol } from '@/data/symbol'
import { TickerRail } from '@/pages/levelLog/TickerRail'
import { MIG_H, WallMigrationChart } from '@/pages/levelLog/WallMigrationChart'
import {
  type ExpScope,
  type GexBasis,
  type LogView,
  VIEW_SCOPE,
  todayETStr,
  useMinuteTick,
  useWallDays,
  variantTag,
} from '@/pages/levelLog/wallData'
import { NO_TARGETS, type CopyShotTarget, useCopyShotTargets } from '@/shell/CopyShot'

/** How many sessions the week view asks for. v2's number. */
const WEEK_SESSIONS = 5

/**
 * Card height: the plot at its designed 250 plus the header, the toolbar row,
 * the variant line, the legend and the axis stamps. Explicit rather than
 * content-sized because the chart FILLS its body — a body that sized to the
 * chart and a chart that sized to the body have no fixed point between them.
 */
const CARD_H = MIG_H + 132

/**
 * The card's DOM identity — `data-card-instance` on the Card, and what the
 * snapshot target resolves through. A constant because the two have to agree,
 * and an expanded card is portalled out of its tile, so a query is the only
 * lookup that still finds it.
 */
const CARD_ID = 'level-log-wall-migration'

const VIEW_OPTIONS: Array<{ label: string; value: LogView; title: string }> = [
  { label: 'Walls', value: 'walls', title: 'Call wall + put wall only' },
  { label: 'Core', value: 'core', title: 'CORE level only' },
  { label: 'All', value: 'all', title: 'Walls + CORE on one timeline' },
]

const SCOPE_OPTIONS: Array<{ label: string; value: ExpScope; title: string }> = [
  { label: '0DTE', value: '0dte', title: 'Nearest listed contract only — chain.expirations[0]' },
  { label: 'Non-0DTE', value: 'agg', title: 'Every OTHER listed expiration, summed per strike' },
]

const BASIS_OPTIONS: Array<{ label: string; value: GexBasis; title: string }> = [
  {
    label: 'OI + Vol',
    value: 'oivol',
    title: 'netGEX + netVolGEX — open interest and today’s volume',
  },
  { label: 'Vol only', value: 'vol', title: 'netVolGEX alone — today’s volume, no open interest' },
]

const RANGE_OPTIONS: Array<{ label: string; value: '1' | '5'; title: string }> = [
  { label: 'Today', value: '1', title: 'Just the selected date' },
  {
    label: '5 sessions',
    value: '5',
    title: 'The last 5 recorded sessions ending on the selected date',
  },
]

export default function LevelLog() {
  // The ticker follows the app toolbar; only the date is this page's own, and
  // it lives in the query string so /v3/level-log?date=2026-09-02 is a
  // shareable link — which is also why app/v3/level-log/route.ts has to answer
  // the hard refresh.
  const { symbol, setSymbol } = usePageSymbol()
  const [params, setParams] = useSearchParams()
  const date = (params.get('date') || '').trim() || todayETStr()

  const [view, setView] = useState<LogView>('all')
  const [scope, setScope] = useState<ExpScope>('0dte')
  const [basis, setBasis] = useState<GexBasis>('oivol')
  const [range, setRange] = useState<'1' | '5'>('1')
  // Bumped by Refresh. It is a dep of the fetch effect and nothing else — the
  // requests are `no-store`, so a bump is a genuine re-read of the recorder.
  const [nonce, setNonce] = useState(0)

  // Live only where a minute can change the answer — see the header note.
  const isToday = date === todayETStr()
  const live = isToday && range === '1'
  const tick = useMinuteTick(live)

  const { days, loading } = useWallDays(
    symbol,
    date,
    range === '5' ? WEEK_SESSIONS : 1,
    nonce + tick,
    scope,
    basis,
  )

  /**
   * The toolbar camera's row for this page. Published only once a session has
   * actually landed, so the menu never offers a shot of the empty state, and
   * named the way v2's SnapLogButton named its file.
   */
  const shotTargets = useMemo<CopyShotTarget[]>(
    () =>
      days.length
        ? [
            {
              id: 'level-log:wall-migration',
              icon: '🧱',
              label: 'Wall migration',
              group: 'This page',
              meta: `${symbol} · ${range === '5' ? `5 sessions to ${date}` : date} · ${variantTag(scope, basis)}`,
              file: `${symbol.toLowerCase()}-wall-migration-${view}-${scope}-${basis}-${date}${range === '5' ? '-5d' : ''}`,
              resolve: () =>
                document.querySelector<HTMLElement>(`[data-card-instance="${CARD_ID}"]`),
            },
          ]
        : NO_TARGETS,
    [days.length, symbol, date, range, scope, basis, view],
  )
  useCopyShotTargets(shotTargets)

  /**
   * v2's CoreMigrationButton, same query contract. `noopener` so the new tab
   * cannot reach back through `window.opener`.
   */
  const openCoreMigration = () => {
    const q = new URLSearchParams({ symbol, end: date, scope, basis })
    window.open(`/core-migration.html?${q.toString()}`, '_blank', 'noopener')
  }

  const setDate = (next: string) => {
    const q = new URLSearchParams(params)
    q.set('date', next || todayETStr())
    setParams(q, { replace: true })
  }

  return (
    <Page>
      {/* Above the log, and driving it: the card whose symbol is lit is the
          session drawn underneath. Same date and same variant switches, so the
          rail's numbers and the chart's are one reading of one recorder. */}
      <TickerRail
        date={date}
        view={view}
        scope={scope}
        basis={basis}
        nonce={nonce + tick}
        symbol={symbol}
        onPick={setSymbol}
      />

      <Card
        title="Level Log"
        expandId={CARD_ID}
        style={{ height: CARD_H }}
        actions={
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            title="Re-read the recorder for this date"
            className="rounded-sm px-1 text-xs text-faint transition-colors hover:bg-raised hover:text-fg"
          >
            <span aria-hidden>↻</span>
          </button>
        }
      >
        <CardToolbar>
          <input
            type="date"
            value={date}
            max={todayETStr()}
            onChange={(e) => setDate(e.target.value)}
            title="Session date, ET"
            className="tabular rounded-sm border border-line bg-surface2 px-1.5 py-0.5 font-mono text-2xs text-fg"
          />
          <SegGroup options={VIEW_OPTIONS} value={view} onChange={setView} title="Which levels" />
          <SegGroup
            options={SCOPE_OPTIONS}
            value={scope}
            onChange={setScope}
            title="Which contracts"
          />
          <SegGroup options={BASIS_OPTIONS} value={basis} onChange={setBasis} title="Which GEX" />
          <SegGroup
            options={RANGE_OPTIONS}
            value={range}
            onChange={setRange}
            title="One session, or the last five recorded ones"
          />
          <button
            type="button"
            onClick={openCoreMigration}
            title={`Open ${symbol}'s CORE migration — the last 63 recorded sessions — in a new tab`}
            className="shrink-0 rounded-sm border px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide transition-opacity hover:opacity-80"
            style={{
              borderColor: LEVEL_COLORS.cb,
              color: LEVEL_COLORS.cb,
              background: alpha(LEVEL_COLORS.cb, 0.12),
            }}
          >
            <span aria-hidden>⤢</span> CORE migration
          </button>
        </CardToolbar>

        <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
          <span className="tabular font-mono text-2xs text-muted">
            {variantTag(scope, basis)} · {VIEW_SCOPE[view]} view · 09:29 open + every 15m to 16:00
            ET, change-only
          </span>
          {live ? (
            <span className="text-2xs text-muted" title="Re-reads the recorder and the 1-minute tape every minute while this tab is open">
              live · 1m
            </span>
          ) : null}
          {/* Only while there is nothing on screen. A pip that blinks on every
              minute tick is noise about a refresh nobody asked to watch. */}
          {loading && !days.length ? (
            <span className="text-2xs text-faint">loading…</span>
          ) : null}
        </div>

        {days.length ? (
          <WallMigrationChart days={days} view={view} fill />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-muted">
            {loading
              ? 'Loading sessions…'
              : range === '5'
                ? `No recorded sessions for ${symbol} in the ${WEEK_SESSIONS} weekdays ending ${date} on ${variantTag(scope, basis)}.`
                : `No recorded levels for ${symbol} on ${date} — ${variantTag(scope, basis)}.`}
          </div>
        )}
      </Card>
    </Page>
  )
}
