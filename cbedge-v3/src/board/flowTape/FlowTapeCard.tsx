import { useEffect, useMemo, useRef, useState } from 'react'
import { CardToolbar } from '@/design/primitives/Card'
import { useFrame } from '@/data/hooks'
import { usePageSymbol } from '@/data/symbol'
import type { FlowFrame } from '@/contract/frames'
import { useContractStats, useFlowHistory, useLiveSpots } from '@/data/flowData'
import {
  fmtPremium,
  mergeTape,
  normTicker,
  passesFilters,
  sumTotals,
  todayYmdET,
  type FlowFilters,
} from '@/data/flowMath'
import { Tape, type Row } from '@/pages/flow/FlowTape'

// ─────────────────────────────────────────────────────────────────────────────
// FLOW TAPE — the /flow page's print table, as a board card.
//
// The SAME table, not a smaller one: pages/flow/FlowTape.tsx is imported by
// both, so every column, tooltip and whale drawer the page has is here too.
// The card supplies the one control it needs and nothing else.
//
// ── The one control: Min Premium ─────────────────────────────────────────────
// A slider with SIX STOPS — Any, $50K, $100K, $250K, $500K, $1M — rather than
// the page's continuous 0…$1M range. On a board the slider is 110 pixels wide
// and a continuous range at that size is a guessing game; six labelled detents
// land on the number you meant every time. The floor is pushed into SQL by
// useFlowHistory, so raising it makes the server's 20k-row cap keep the BIGGEST
// prints of the session rather than the most recent slice.
//
// ── The slider does not move while you are dragging it ───────────────────────
// Two separate things used to make it squirm out from under the pointer, and
// both are fixed here rather than papered over with a debounce:
//
//   1. IT COMMITS ON RELEASE, NOT ON EVERY TICK. A range input fires onChange
//      for every intermediate value, and each one re-queried the session and
//      re-rendered the whole tape. Dragging across six stops meant six fetches
//      nobody asked for. `draft` drives the thumb and the label immediately;
//      `stop` — the value the data actually reads — is committed on pointerup /
//      keyup / blur. A window-level listener is the backstop for a pointer
//      released outside the control.
//   2. THE HEADER HOLDS ITS SHAPE. The toolbar is right-aligned, so anything
//      that appears or disappears to the RIGHT of the slider pushes it sideways
//      mid-drag — which is exactly what the "loading…" chip did, on and off,
//      once per fetch. The slider is now LAST in the row (with justify-end,
//      that pins its right edge), the chip holds its width whether or not it
//      has anything to say, and the value label is a fixed-width box so "Any"
//      and "$1.00M" do not shift the track between them.
//
// Everything else is the page's default: both sides, both types, OTM only, no
// DTE window, every expiry. The card is a glance at what is printing; the page
// is where a filter chain belongs.
//
// ── Ticker ───────────────────────────────────────────────────────────────────
// Follows the board's page symbol, because flow IS recorded per ticker
// (/proxy/flow-history?underlying=…). The socket's `flow` frame is index-only,
// so live prints merge in for that symbol and the rest of the tape is the REST
// backfill — which is exactly what the page does.
// ─────────────────────────────────────────────────────────────────────────────

/** The detents, in dollars. Index 0 is "Any". */
const PREMIUM_STOPS = [0, 50_000, 100_000, 250_000, 500_000, 1_000_000] as const

/**
 * $100K. High enough that the card is a list of prints worth reading at a
 * glance, low enough that a normal SPX session still fills it.
 */
const DEFAULT_STOP = 2

/** Rendered row cap. Well under the page's 800 — this is a tile, not a page. */
const CARD_MAX_ROWS = 250

const STOP_KEY = 'cb-v3-board-flowtape-stop'

function loadStop(): number {
  try {
    const raw = localStorage.getItem(STOP_KEY)
    // `Number(null)` and `Number('')` are both 0 — a perfectly valid index —
    // so a first visit silently came up on "Any" instead of the default. Test
    // for "nothing stored" BEFORE converting.
    if (raw == null || raw === '') return DEFAULT_STOP
    const n = Number(raw)
    return Number.isInteger(n) && n >= 0 && n < PREMIUM_STOPS.length ? n : DEFAULT_STOP
  } catch {
    return DEFAULT_STOP
  }
}

export function FlowTapeCard() {
  const { symbol } = usePageSymbol()
  const active = normTicker(symbol)
  const date = todayYmdET()

  // `draft` is what the thumb shows; `stop` is what the data reads. They differ
  // only while a drag is in flight — see the header note.
  const [stop, setStop] = useState<number>(() => loadStop())
  const [draft, setDraft] = useState<number>(stop)
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    try {
      localStorage.setItem(STOP_KEY, String(stop))
    } catch {
      /* best-effort — the in-memory choice still drives this session */
    }
  }, [stop])

  // The backstop. A pointer released outside the input never fires pointerup ON
  // it, and without this the tape would sit on the old floor until the next
  // interaction — the control would look broken rather than slow.
  useEffect(() => {
    if (draft === stop) return
    const commit = () => setStop(draftRef.current)
    window.addEventListener('pointerup', commit)
    window.addEventListener('pointercancel', commit)
    window.addEventListener('keyup', commit)
    return () => {
      window.removeEventListener('pointerup', commit)
      window.removeEventListener('pointercancel', commit)
      window.removeEventListener('keyup', commit)
    }
  }, [draft, stop])

  const minPremium = PREMIUM_STOPS[stop] ?? 0
  const draftPremium = PREMIUM_STOPS[draft] ?? 0

  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const filters: FlowFilters = useMemo(
    () => ({
      side: 'all',
      optType: 'all',
      minPremium,
      minSize: 0,
      expiry: 'all',
      dteMin: 0,
      dteMax: null,
      otmOnly: true,
    }),
    [minPremium],
  )

  const { tape: history, switching } = useFlowHistory(active, date, minPremium, true)
  const flowFrame = useFrame<FlowFrame>('flow')
  const liveTape = useMemo(() => flowFrame?.data.tape ?? [], [flowFrame])
  const status: 'LIVE' | 'WAITING' = flowFrame ? 'LIVE' : 'WAITING'

  const merged = useMemo(() => mergeTape(history, liveTape, true), [history, liveTape])

  /** Newest first, which is the order a tape is read in. */
  const filtered = useMemo(
    () =>
      merged
        .filter((o) => normTicker(o.underlying) === active && passesFilters(o, filters, date))
        .reverse(),
    [merged, active, filters, date],
  )

  const visibleRows: Row[] = useMemo(
    () => filtered.slice(0, CARD_MAX_ROWS).map((o) => ({ ...o, tickerNorm: normTicker(o.underlying) })),
    [filtered],
  )

  // Vol / OI / IV and the live %OTM column, driven by the VISIBLE rows only —
  // the lookups group by (ticker, expiry), so this is a couple of calls however
  // many prints are on screen.
  const lookupStat = useContractStats(visibleRows, true)
  const visibleTickers = useMemo(
    () => [...new Set(visibleRows.map((o) => o.tickerNorm).filter(Boolean))],
    [visibleRows],
  )
  const spotByTicker = useLiveSpots(visibleTickers, true)

  const totals = useMemo(() => sumTotals(filtered), [filtered])
  // The label follows the THUMB, not the data — a drag has to read back the
  // value under your finger, not the one the tape is still showing.
  const stopLabel = draftPremium === 0 ? 'Any' : fmtPremium(draftPremium)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <CardToolbar>
        {/* Order matters: the toolbar is right-aligned, so the LAST item's right
            edge is the one that does not move. The slider goes last, and the two
            status widgets to its left hold a fixed width so they cannot shove it
            around as they change. */}
        <span
          className={[
            'tabular w-[54px] rounded-sm bg-raised px-2 py-0.5 text-center text-3xs',
            status === 'LIVE' ? 'text-accent' : 'text-down',
          ].join(' ')}
        >
          {status}
        </span>
        {/* Always rendered, so the row never changes width. `visibility` rather
            than a conditional: the box is reserved either way. */}
        <span
          aria-hidden={!switching}
          style={{ visibility: switching ? 'visible' : 'hidden' }}
          className="w-[46px] text-2xs text-muted"
        >
          loading…
        </span>
        <label className="flex items-center gap-2" title="Hide prints below this premium">
          <span className="text-3xs font-bold uppercase tracking-[0.08em] text-muted">Min prem</span>
          <input
            type="range"
            min={0}
            max={PREMIUM_STOPS.length - 1}
            step={1}
            value={draft}
            // Visual only. The fetch happens on release — see the header note.
            onChange={(e) => setDraft(Number(e.target.value))}
            onPointerUp={() => setStop(draftRef.current)}
            onKeyUp={() => setStop(draftRef.current)}
            onBlur={() => setStop(draftRef.current)}
            // A list of the six detents, so the browser draws the ticks and the
            // thumb snaps to them visibly rather than just numerically.
            list="cb-flowtape-stops"
            className="w-28 accent-[var(--color-accent)]"
          />
          <datalist id="cb-flowtape-stops">
            {PREMIUM_STOPS.map((_, i) => (
              <option key={i} value={i} />
            ))}
          </datalist>
          {/* Fixed box, right-aligned: "Any" and "$1.00M" must not move the
              track between them. */}
          <span className="tabular w-[52px] text-right text-2xs font-semibold text-accent">
            {stopLabel}
          </span>
        </label>
      </CardToolbar>

      <div className="flex flex-wrap items-baseline gap-4 px-1 text-xs text-muted">
        <span className="font-bold uppercase tracking-[0.08em] text-fg">{active}</span>
        <span>
          <strong className="tabular text-fg">{totals.count.toLocaleString()}</strong> orders
        </span>
        <span>
          Total <strong className="tabular text-fg">{fmtPremium(totals.prem)}</strong>
        </span>
        <span>
          Calls <strong className="tabular text-up">{fmtPremium(totals.callPrem)}</strong>
        </span>
        <span>
          Puts <strong className="tabular text-down">{fmtPremium(totals.putPrem)}</strong>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Tape
          rows={visibleRows}
          totalRows={filtered.length}
          cap={CARD_MAX_ROWS}
          view="ticker"
          date={date}
          isToday
          status={status}
          label={active}
          expandedKey={expandedKey}
          onToggle={setExpandedKey}
          lookupStat={lookupStat}
          spotByTicker={spotByTicker}
        />
      </div>
    </div>
  )
}
