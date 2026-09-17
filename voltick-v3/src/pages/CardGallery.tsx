import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CARD_CATALOG, CARD_BY_ID } from '@/board/catalog'
import { BOARD_ROW_H } from '@/design/primitives/Board'

// ─────────────────────────────────────────────────────────────────────────────
// THE HOME BOARD — /v3
//
// Every card, as a tile. Click one and that card opens on its own, full width,
// with live data. That is the whole app now: a place to open one card and work
// on it, with nothing else on the screen arguing for attention.
//
// It is NOT a rebuild of the cards. Each tile calls `CardDef.render()` from
// src/board/catalog.tsx — the same call the grid board makes — so what opens is
// the real card, with its real controls and its real bugs. Adding a card to the
// catalog puts a tile here with no edit to this file.
//
// THE FRAME. A card is written to fill a grid cell, not a page: several stretch
// to their container and would grow forever inside a plain <div>. The open card
// gets an explicit height from its OWN `defaultSize.h` in board rows — the
// height the grid would have given it — and the full width of the page. So a
// tall chart stays tall and a short list stays short, and this file knows
// nothing about either.
//
// `render()` takes an instance id and gets the plain type id here: there is only
// ever one copy open, so its settings are the first copy's settings.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One line per card, for someone who has never seen the board.
 *
 * This page is a showroom: a link to it goes to someone outside CB Edge who has
 * no idea what a Core is or why a card called Gauge Rail has five tick meters on
 * it. A tile that only says "Gauge Rail" tells them nothing, and they will not
 * be reading the source to find out.
 *
 * Every line below is taken from that card's OWN header comment rather than
 * invented here, so a description cannot quietly become wrong about what the
 * card does. Keyed by catalog id: a card with no entry simply shows no note, so
 * adding a card never breaks this page and never blocks it either.
 *
 * These describe WHAT A CARD IS. If you want to say what you are PROPOSING with
 * one — why it should exist in the merged product, what you would change — that
 * is a different sentence and it belongs here too. Write it in your own words
 * and put it after the description.
 */
const NOTES: Record<string, string> = {
  'gex-candles':
    'Price candles with the option book drawn on them: every strike that matters as a bubble, sized by gamma, the biggest wall in each bucket picked out.',
  'gex-chart':
    'Net gamma per strike as bars on their own axis, with the net-delta line across them and ten stat tiles above.',
  'gauge-rail':
    'Five readings as tick meters: net gamma, net delta, the call share of volume gamma, and net GEX per minute and over the last fifteen. Each carries its own 15-minute change.',
  'multi-greek':
    'Up to four tickers side by side, each a strike ladder read down and expiries read across. The point is the across-read: the same strike on several symbols at the same DTE.',
  'vol-gex-flow': 'Net volume-gamma flow through the session, as a baseline chart.',
  'oi-by-expiry':
    'Call and put open interest per expiration date, sharing one column and one scale, so "how does call OI compare to put OI at this date" is one look.',
  'net-premium':
    'Cumulative net call premium against cumulative net put premium, one point a minute, with the minute\u2019s contract volume underneath and the underlying\u2019s own path behind it.',
  'flow-tape':
    'The live print table, one ticker at a time, with a minimum-premium floor pushed into the query so raising it keeps the biggest prints of the session rather than the most recent.',
  'top-flow':
    'The whole market\u2019s biggest prints, ranked by dollar premium, from one cached vault sweep. Not the Flow Tape: that is one ticker recorded live, this is where the size went today.',
  'key-levels':
    'Every level on one horizontal price axis \u2014 put wall, gamma flip, max pain, core, spot, call wall \u2014 each with its distance from spot, and nothing else.',
  'econ-calendar':
    'Today only, in ET, sorted by time, with earnings woven in. An event more than an hour past its start is removed rather than dimmed.',
  'quick-links': 'A short list of links you keep, saved in this browser.',
}

/** Rows to pixels, the way the grid does it, with a floor so nothing collapses. */
function paneHeight(rows: number): number {
  return Math.max(360, rows * BOARD_ROW_H)
}

export default function CardGallery() {
  const { cardId } = useParams()
  const card = useMemo(() => (cardId ? CARD_BY_ID.get(cardId) : undefined), [cardId])

  if (cardId && !card) return <Missing id={cardId} />
  return card ? <OneCard card={card} /> : <Tiles />
}

/* ── The tiles ─────────────────────────────────────────────────────────────── */

function Tiles() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
      <header className="mb-4">
        <h1 className="m-0 text-lg font-bold text-fg">Cards</h1>
        <p className="mt-1 mb-0 max-w-2xl text-sm text-muted">
          Every card in the catalog, with a line on what each one is. Open one and it is the only thing
          on the screen, with live data. Each card has its own link, so one can be sent on its own.
        </p>
      </header>

      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
        {CARD_CATALOG.map((c) => (
          <li key={c.id} className="contents">
            <Link
              to={`/cards/${c.id}`}
              className="flex flex-col gap-2 rounded-md border border-line bg-surface p-4 no-underline hover:bg-surface2"
            >
              <span aria-hidden className="text-2xl leading-none">
                {c.icon}
              </span>
              <span className="text-sm font-bold text-fg">{c.label}</span>
              {NOTES[c.id] && <span className="text-xs leading-relaxed text-muted">{NOTES[c.id]}</span>}
              <span className="mt-auto pt-1 font-mono text-2xs tracking-wide text-muted">{c.id}</span>
            </Link>
          </li>
        ))}
      </ul>

      {/* The full pages are not cards and are not opened in a pane: each is a
          route of its own, so the honest thing is a link to the page. */}
      <h2 className="mt-8 mb-3 text-lg font-bold text-fg">Pages</h2>
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
        {PAGES.map((p) => (
          <li key={p.path} className="contents">
            <Link
              to={p.path}
              className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-fg no-underline hover:bg-surface2"
            >
              <span aria-hidden className="w-5 shrink-0 text-center">
                {p.icon}
              </span>
              <span className="min-w-0 truncate">{p.label}</span>
              <span aria-hidden className="ml-auto text-2xs text-muted">
                ↗
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── One card, open ────────────────────────────────────────────────────────── */

function OneCard({ card }: { card: (typeof CARD_CATALOG)[number] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 sm:p-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link to="/cards" className="text-sm text-muted no-underline hover:text-fg">
          ← Cards
        </Link>
        <h1 className="m-0 text-lg font-bold text-fg">
          <span aria-hidden className="mr-2">
            {card.icon}
          </span>
          {card.label}
        </h1>
        <span className="font-mono text-2xs tracking-widest text-muted uppercase">{card.id}</span>
        <span className="ml-auto hidden font-mono text-2xs text-muted sm:inline">
          {card.defaultSize.w}×{card.defaultSize.h} on the grid
        </span>
      </header>

      {/* A deep link lands here, not on the tiles, so the description has to be
          on this screen too — otherwise the one view an outsider is most likely
          to be sent is the one that explains itself least. */}
      {NOTES[card.id] && <p className="m-0 max-w-3xl text-sm text-muted">{NOTES[card.id]}</p>}

      {/* `key` on the card id so opening a different card REMOUNTS rather than
          reusing the last one's tree: these hold sockets, canvases and chart
          instances, and handing a live one to a different card is how a chart
          ends up drawing someone else's data. */}
      <div
        key={card.id}
        className="flex min-h-0 flex-col overflow-hidden rounded-md border border-line bg-surface"
        style={{ height: paneHeight(card.defaultSize.h) }}
      >
        {card.render(card.id)}
      </div>
    </div>
  )
}

function Missing({ id }: { id: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
      <p className="m-0 text-sm text-muted">
        No card with the id <span className="font-mono text-fg">{id}</span> in the catalog.
      </p>
      <Link to="/cards" className="text-sm text-accent no-underline">
        ← Cards
      </Link>
    </div>
  )
}

/** The full pages, each one a route of this app. */
const PAGES: { path: string; label: string; icon: string }[] = [
  { path: '/board', label: 'The grid board', icon: '🧩' },
  { path: '/traders-dashboard', label: "Trader's Dashboard", icon: '📊' },
  { path: '/premarket', label: 'Premarket', icon: '🌅' },
  { path: '/options-chain', label: 'Options Chain', icon: '⛓️' },
  { path: '/chain', label: 'Chain', icon: '🔗' },
  { path: '/analytics', label: 'Analysis', icon: '🔬' },
  { path: '/flow', label: 'Flow', icon: '🌊' },
  { path: '/em', label: 'Estimated Move', icon: '📐' },
  { path: '/replay', label: 'Replay', icon: '⏪' },
  { path: '/scanner', label: 'Scanner', icon: '🔎' },
  { path: '/economic-calendar', label: 'Economic Calendar', icon: '📅' },
  { path: '/level-log', label: 'Level Log', icon: '🪵' },
  { path: '/seasonality', label: 'Seasonality', icon: '🗓️' },
  { path: '/whales', label: 'Whales', icon: '🐋' },
]
