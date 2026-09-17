// ─────────────────────────────────────────────────────────────────────────────
// REPLAY (/v3/replay) — the replay hub. ONE page, one tab per rewindable
// surface. Spec: docs/parity/replay.md.
//
// The replays were scattered: the chain ladder behind the Options Chain's "⛶
// Ladder" button, the GEX-levels ladders inside /analytics' Ticker Lookup, the
// four-panel rewind nowhere at all in v3, the full grid inside /options-chain.
// Each stays reachable where it lives — rewinding IN CONTEXT is the point of
// having it there — and this page is where you go when replay itself is the
// thing you want, without having to remember which page hides which one.
//
// TWO SHAPES OF TAB, and the difference is load-bearing:
//
//   FRAMED  a component small enough to sit in a Card (the chain ladder, the
//           GEX-levels card). The hub supplies the plate, the title and the
//           one-line blurb.
//   FULL    a whole page that renders its OWN frame (Multi Greek, Options
//           Chain). Wrapping those in a second frame doubles the padding and
//           nests a scroll container inside a scroll container, so they get the
//           tab bar and the rest of the viewport and nothing else. `minHeight:0`
//           on BOTH the column and the pane is what lets the embedded page's
//           internal scroller size itself instead of pushing the tab bar off the
//           top of the screen.
//
// EVERY TAB OPENS ALREADY REWOUND. That is the reason the page exists: making
// someone press the embedded page's own replay toggle first is asking them to
// confirm the thing they just navigated to. It is INITIAL STATE only — each
// tab's own toggle still works, so leaving replay inside a tab behaves normally.
//
// Every tab is lazy(): opening this page must not pull the Options Chain's
// chunk down before anyone has picked that tab. They are the same chunks the
// /options-chain and /analytics routes already load, so a user who has been to
// either arrives here with the tab already cached.
//
// EVERY TAB FOLLOWS THE TOOLBAR TICKER. Four tabs that each remembered their own
// symbol meant switching tabs could change the subject without saying so, and
// the toolbar — the one control that looks like it drives the page — drove only
// the Options Chain tab. The board symbol (data/symbol.tsx) now seeds all four:
//
//   chain-ladder   the recorded ladder opens on the board symbol; its own
//                  picker stays, because only roots the RECORDER swept can be
//                  replayed and that list is not the board's.
//   gex-levels     follows outright — its dropdown is gone (TickerLookup.tsx).
//   gex-candles    the board's GEX Candles card, mounted with `replay`. It
//                  already reads usePageSymbol, so it follows on its own.
//   mult-greek     SLOT 1 follows; slots 2-4 stay independently typeable. Four
//                  slots pinned to one symbol would leave the tab comparing a
//                  symbol with itself, which is the point of that card — the
//                  live Multi Greek board is shaped the same way (panel 1 = the
//                  board ticker, the rest added by hand).
//   options-chain  already followed; it reads usePageSymbol directly.
// ─────────────────────────────────────────────────────────────────────────────

import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Card } from '@/design/primitives/Card'
import { Page } from '@/design/primitives/Page'
import { usePageSymbol } from '@/data/symbol'

const LadderReplay = lazy(() =>
  import('./optionsChain/LadderModal').then((m) => ({ default: m.LadderModal })),
)
const TickerLookupCard = lazy(() =>
  import('./analysis/lookup/TickerLookup').then((m) => ({ default: m.TickerLookupCard })),
)
const MultiGreekReplay = lazy(() =>
  import('./replay/MultiGreekReplay').then((m) => ({ default: m.MultiGreekReplay })),
)
const OptionsChain = lazy(() => import('./OptionsChain'))
// The board's GEX Candles card, mounted with `replay` — see the REPLAY note in
// GexCandlesCard.tsx. Same chunk the board already loads.
const GexCandles = lazy(() =>
  import('@/board/gexCandles/GexCandlesCard').then((m) => ({ default: m.GexCandlesCard })),
)

type TabId = 'chain-ladder' | 'gex-levels' | 'gex-candles' | 'mult-greek' | 'options-chain'

interface TabDef {
  id: TabId
  label: string
  /** Card header — framed tabs only. */
  title: string
  /** One line saying what this replay actually shows. Also the tab's tooltip. */
  blurb: string
  /** true = the tab renders its own frame and takes the whole viewport. */
  full: boolean
  /**
   * The framed body is a CHART, not a scrolling list.
   *
   * The default framed body is a block scroller (`overflow-y-auto`), which is
   * right for a ladder and wrong for a chart: a `flex-1` chart inside a block
   * parent has nothing to stretch against and collapses to nothing. This swaps
   * the wrapper for a flex column so the chart gets the Card's remaining
   * height, which is what every board card is written to expect.
   */
  chart?: boolean
}

const TABS: TabDef[] = [
  {
    id: 'chain-ladder',
    label: 'Chain ladder',
    title: 'Option chain replay',
    blurb: 'Per-strike net GEX for one expiry, played through the session. Its own symbol and date pickers.',
    full: false,
  },
  {
    id: 'gex-levels',
    label: 'GEX levels',
    title: 'GEX levels replay',
    blurb:
      "The Ticker Lookup's two ladders — one expiry beside the whole board ex-0DTE — with the walls and gamma flip they imply.",
    full: false,
  },
  {
    id: 'gex-candles',
    label: 'GEX candles',
    title: 'GEX candles replay',
    blurb:
      'The candles with the GEX bubbles and the rail over them, scrubbed through the session on one cursor — the ladder as it stood at each bar, not as it stands now.',
    full: false,
    chart: true,
  },
  {
    id: 'mult-greek',
    label: 'Multi Greek',
    title: 'Multi Greek replay',
    blurb: 'Four tickers rewound off one shared clock.',
    full: true,
  },
  {
    id: 'options-chain',
    label: 'Options chain',
    title: 'Options chain replay',
    blurb: 'The full grid — every strike and column — rewound.',
    full: true,
  },
]

const DEFAULT_TAB: TabId = 'chain-ladder'

/**
 * `#tab=<id>` if it names a real tab, else null.
 *
 * A hash and not a route param: this page is ONE route and the tab is a view of
 * it, not a location. The hash still makes a tab linkable and back-button-able,
 * which is what the tab bar is for.
 */
function tabFromHash(): TabId | null {
  if (typeof window === 'undefined') return null
  const raw = window.location.hash.replace(/^#/, '')
  const id = new URLSearchParams(raw).get('tab')
  return TABS.some((t) => t.id === id) ? (id as TabId) : null
}

const fallback = (
  <div className="flex flex-1 items-center justify-center p-10 text-sm tracking-[0.08em] text-faint">
    LOADING REPLAY…
  </div>
)

export default function ReplayPage() {
  const [tab, setTab] = useState<TabId>(DEFAULT_TAB)
  const { symbol } = usePageSymbol()

  // Read the hash AFTER mount rather than in the initializer. The route mounts
  // inside a Suspense boundary and a shared link can arrive before the chunk
  // does; settling the tab in an effect means the hash is read once, from the
  // real location, with the listener attached in the same pass.
  useEffect(() => {
    const fromHash = tabFromHash()
    if (fromHash) setTab(fromHash)
    const onHash = () => {
      const next = tabFromHash()
      if (next) setTab(next)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const select = useCallback((id: TabId) => {
    setTab(id)
    // Assigning the same value is a no-op, so the hashchange this fires lands on
    // the state just set rather than fighting it.
    window.location.hash = `tab=${id}`
  }, [])

  const active = TABS.find((t) => t.id === tab) ?? (TABS[0] as TabDef)

  const tabBar = (
    <div role="tablist" aria-label="Replay surfaces" className="flex shrink-0 flex-wrap items-center gap-2 px-3 pt-3">
      {TABS.map((t) => {
        const on = t.id === tab
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => select(t.id)}
            title={t.blurb}
            className={[
              'rounded-md px-3.5 py-1.5 text-xs font-extrabold uppercase tracking-[0.08em] transition-colors',
              on ? 'border border-accent bg-accent text-bg' : 'border border-line bg-raised text-fg hover:bg-surface2',
            ].join(' ')}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )

  return (
    <Page fill>
      {tabBar}
      {active.full ? (
        // The embedded page brings its own frame, so the hub contributes the tab
        // bar and gets out of the way.
        <div className="flex min-h-0 flex-1 flex-col">
          <Suspense fallback={fallback}>
            {active.id === 'mult-greek' ? (
              <MultiGreekReplay />
            ) : (
              // Opens scoped to 0DTE: this tab is for watching the front
              // contract move, and "all expiries" is one click away on the bar's
              // own scope control.
              <OptionsChain initialReplay initialReplayScope="0dte" />
            )}
          </Suspense>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <Card title={active.title} fill>
            <p className="mb-3 shrink-0 text-xs text-muted">{active.blurb}</p>
            {/* See TabDef.chart: a chart needs a flex column to stretch in, a
                ladder needs a scroller. */}
            <div
              className={
                active.chart ? 'flex min-h-0 flex-1 flex-col' : 'min-h-0 flex-1 overflow-y-auto'
              }
            >
              <Suspense fallback={fallback}>
                {active.id === 'chain-ladder' ? (
                  // The board symbol, and it re-seeds when the toolbar moves.
                  // The ladder keeps its own picker: only a root the RECORDER
                  // swept can be replayed, so a board symbol with no recorded
                  // session says so and the picker offers what there is.
                  <LadderReplay symbol={symbol} embedded />
                ) : active.id === 'gex-candles' ? (
                  // Follows the toolbar on its own — the card reads
                  // usePageSymbol directly, like the Options Chain tab.
                  <GexCandles replay />
                ) : (
                  <TickerLookupCard embedded initialReplay />
                )}
              </Suspense>
            </div>
          </Card>
        </div>
      )}
    </Page>
  )
}
