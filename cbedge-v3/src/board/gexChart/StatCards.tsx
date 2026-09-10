import { useMemo } from 'react'
import { useQuery } from '@/data/api'
import { isSocketSymbol } from '@/data/symbol'
import type { GexRow } from '@/contract/frames'
import { computeMaxPain, fmtPx, strikeDp } from '../keyLevels/levelsMath'
import type { GexBasis, StatKey } from './settings'
import { LEVEL_BASIS_LABEL, dexOf, fmtGexShort, levelsOf, posGexPct, totalNet } from './values'

// ─────────────────────────────────────────────────────────────────────────────
// The ten cards, ported from v2's home GEX toolbar.
//
//   Net GEX · Call Wall · Put Wall · Flip · CB · Max Pain · +1σ · −1σ ·
//   +GEX % · Bull/Bear
//
// ── They read the CHART'S numbers, not their own ─────────────────────────────
// They are derived from the same rows the bars are drawn from, through the same
// accessors in values.ts. That is the whole point of the row sitting directly
// above the chart: v2's comment on this block says it out loud — "the cards can
// never disagree with the chart beneath them" — and the only way to keep that
// true is to have one definition of each level, not two.
//
// Net GEX and +GEX % follow the ACTIVE basis, so switching the chart to VOL
// moves them with it. A tile that did NOT move would be the bug.
//
// ── The four LEVELS: Call Wall · Put Wall · Flip · CB ────────────────────────
// One call to `levelsOf`, which is data/levels.ts — the same derivation the Key
// Levels card draws, read on the basis the chart is on. Two things follow:
//
//   · ON THE OI+VOL TAB these four tiles ARE Key Levels' four marks, to the
//     strike. They were not before: this row derived its own walls and core on
//     `netVolGEX` alone while Key Levels derived them on OI+VOL, so the board
//     printed two different CALL WALLs under one name. Same finders now.
//   · FLOW IS NOT A LEVEL BASIS. On the FLOW tab the bars draw the dealer's
//     signed tape inventory and these four stay on OI+VOL. A wall is a place
//     the book has put gamma; the tape is a different quantity in the same
//     unit, and "CALL WALL" derived from it answers nothing anyone asked.
//     See levelBasisOf in values.ts — the tile titles say which basis is live.
//
// ── The two that come from somewhere else ────────────────────────────────────
//   ±1σ (EM)   this week's estimated-move band, /api/em-tracker — the same
//              weekly row the Key Levels axis draws. Weekly, so ten minutes of
//              cache and no poll.
//   Bull/Bear  the classified options tape, /proxy/flow-history. There is no
//              per-ticker tape anywhere in server-v2, so this one tile cannot
//              follow the board's symbol; off the socket symbol it says so
//              rather than showing SPX's split under another ticker's heading.
// ─────────────────────────────────────────────────────────────────────────────

/** `/api/em-tracker` rows, newest week first. Same shape KeyLevelsCard reads. */
interface EmTrackerRow {
  em?: number | null
  ref_close?: number | null
  up?: number | null
  down?: number | null
}

interface FlowHistoryPrint {
  premium?: number
  type?: string
  side?: string
}

export interface StatCardsProps {
  rows: GexRow[]
  spot: number
  symbol: string
  basis: GexBasis
  /** Resolved by the card: the basis is FLOW *and* these rows can support it. */
  flowActive: boolean
}

interface Tile {
  key: StatKey
  label: string
  value: string
  /** A `--color-*` token name. Never a literal. */
  colour: string
  title: string
}

const MUTED = '--color-flat'

/** U+2014. One spelling, so a missing figure looks the same in both rows. */
const EM_DASH = '—'

export function StatCards({ rows, spot, symbol, basis, flowActive }: StatCardsProps) {
  const onSocket = isSocketSymbol(symbol)
  const kDp = useMemo(() => strikeDp(rows, spot), [rows, spot])

  // ── This week's EM band ────────────────────────────────────────────────────
  // `up`/`down` are prices; `ref_close ± em` is the fallback for a row imported
  // before the bounds were stored. Ten minutes of cache, no poll — weekly data.
  const emQ = useQuery<{ rows?: EmTrackerRow[] }>(`/api/em-tracker?ticker=${encodeURIComponent(symbol)}`, {
    staleMs: 600_000,
  })
  const em = useMemo(() => {
    const row = emQ.data?.rows?.[0]
    if (!row) return { up: null as number | null, down: null as number | null }
    const ref = typeof row.ref_close === 'number' ? row.ref_close : null
    const mag = typeof row.em === 'number' ? row.em : null
    const up = typeof row.up === 'number' ? row.up : ref != null && mag != null ? ref + mag : null
    const down = typeof row.down === 'number' ? row.down : ref != null && mag != null ? ref - mag : null
    return { up: up && up > 0 ? up : null, down: down && down > 0 ? down : null }
  }, [emQ.data])

  // ── Bull/Bear premium split ────────────────────────────────────────────────
  // v2's calculation, transcribed: bought calls and sold puts are the bullish
  // side, everything else the bearish one, weighted by PREMIUM rather than
  // contract count so one big trade counts for what it cost.
  //
  // `null` URL when the board is off the socket symbol, which is what stops the
  // request from firing at all rather than firing and being ignored.
  const flowQ = useQuery<{ tape?: FlowHistoryPrint[] }>(
    onSocket ? `/proxy/flow-history?underlying=${encodeURIComponent(symbol)}&limit=20000` : null,
    { staleMs: 25_000, pollMs: 30_000 },
  )
  const bullPct = useMemo(() => {
    const tape = flowQ.data?.tape
    if (!Array.isArray(tape) || !tape.length) return null
    let bull = 0
    let bear = 0
    for (const o of tape) {
      const prem = Number(o.premium) || 0
      const isPut = o.type === 'P'
      const isBuy = o.side === 'buy'
      if ((isBuy && !isPut) || (!isBuy && isPut)) bull += prem
      else bear += prem
    }
    const tot = bull + bear
    return tot > 0 ? Math.round((bull / tot) * 100) : null
  }, [flowQ.data])

  const tiles = useMemo<Tile[]>(() => {
    const total = rows.length ? totalNet(rows, basis, flowActive) : null
    // The four levels, in one derivation, matching Key Levels — see the block
    // at the top of this file.
    const levels = levelsOf(rows, spot, basis)
    const maxPain = computeMaxPain(rows)
    const pct = rows.length ? posGexPct(rows, basis, flowActive) : null

    // Which basis the four LEVEL tiles were actually read on. Equal to the
    // chart's basis except on FLOW, where it is OI+VOL, which is exactly the
    // case worth spelling out in a tooltip.
    const lvlLabel = LEVEL_BASIS_LABEL[basis]
    const lvlNote =
      basis === 'flow'
        ? ' Read on OI+VOL: the chart is drawing flow, and a wall found on the dealer’s tape inventory is a different quantity.'
        : ` Read on ${lvlLabel}, following the basis switch.`

    const px = (v: number | null) => (v == null ? '—' : fmtPx(v, kDp))

    const all: Tile[] = [
      {
        key: 'netGex',
        label: 'Net GEX',
        value: total == null ? '—' : fmtGexShort(total),
        colour: total == null ? MUTED : total >= 0 ? '--color-up' : '--color-down',
        title: 'Every strike on the ladder, summed on the basis the chart is drawing',
      },
      {
        key: 'callWall',
        label: 'Call Wall',
        value: px(levels.callWall),
        colour: '--color-level-cw',
        title: `Largest positive net gamma strictly above spot.${lvlNote} Same derivation the Key Levels card draws`,
      },
      {
        key: 'putWall',
        label: 'Put Wall',
        value: px(levels.putWall),
        colour: '--color-level-pw',
        title: `Most negative net gamma strictly below spot.${lvlNote} Same derivation the Key Levels card draws`,
      },
      {
        key: 'flip',
        label: 'Flip',
        value: px(levels.flip),
        colour: '--color-warn',
        title: `Where cumulative net gamma crosses zero, taking the crossing nearest spot.${lvlNote}`,
      },
      {
        key: 'cb',
        label: 'CB',
        value: px(levels.core?.strike ?? null),
        colour: '--color-level-cb',
        title: `Core Bullseye — the strike carrying the biggest absolute net gamma on the whole ladder.${lvlNote} The badge on the chart marks the same strike`,
      },
      {
        key: 'maxPain',
        label: 'Max Pain',
        value: px(maxPain),
        colour: '--color-series-5',
        title: 'The expiry price at which the total intrinsic payout to option holders is smallest. Open interest only — it does not move with the basis switch',
      },
      {
        key: 'emUp',
        label: '+1σ (EM)',
        value: px(em.up),
        colour: '--color-up',
        title: "This week's published estimated-move high",
      },
      {
        key: 'emDown',
        label: '−1σ (EM)',
        value: px(em.down),
        colour: '--color-down',
        title: "This week's published estimated-move low",
      },
      {
        key: 'posGexPct',
        label: '+GEX %',
        value: pct == null ? '—' : `${pct.toFixed(0)}%`,
        colour: pct == null ? MUTED : pct >= 50 ? '--color-up' : '--color-down',
        title: 'Share of the board’s total absolute gamma that is positive. 100% is a pure long-gamma chain, 0% a pure short-gamma one',
      },
      {
        key: 'bullBear',
        label: 'Bull/Bear',
        value: bullPct == null ? '—' : `${bullPct} / ${100 - bullPct}`,
        colour: bullPct == null ? MUTED : bullPct >= 50 ? '--color-up' : '--color-down',
        title: onSocket
          ? 'Premium split of the classified tape: bought calls and sold puts against everything else'
          : 'Options flow is only recorded for the socket symbol — this tile does not follow the board ticker',
      },
    ]
    // No per-card filter any more: the row is all ten or it is not drawn at
    // all, and the card's `cardsOn` chip decides which.
    return all
  }, [rows, spot, basis, flowActive, kDp, em, bullPct, onSocket])

  if (!tiles.length) return null

  return (
    <div className="flex shrink-0 items-stretch gap-1.5 overflow-hidden">
      {tiles.map((t) => (
        <div
          key={t.key}
          title={t.title}
          // flex-1 with a zero basis: ten tiles share the width evenly and each
          // one shrinks rather than the row wrapping or scrolling. minWidth 0 is
          // what actually lets a flex item go below its content width.
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-px rounded-sm border border-line bg-raised px-1 py-1"
        >
          <span className="truncate text-3xs font-bold uppercase tracking-[0.08em] text-muted opacity-70">
            {t.label}
          </span>
          <span
            className="tabular truncate font-mono text-sm font-extrabold"
            style={{ color: `var(${t.colour})` }}
          >
            {t.value}
          </span>
        </div>
      ))}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// DeltaStatCards — the row above a DELTA ladder.
//
// A separate component rather than a branch inside StatCards, because seven of
// those ten tiles are gamma facts and there is nothing to substitute for them:
// a Call Wall is where the book has put GAMMA, the CB is the biggest gamma
// strike, +GEX % is a gamma ratio. Printing a delta number under a gamma label
// is the exact class of bug the note at the top of StatCards exists to prevent.
//
// So the delta row answers the delta questions instead — how much, which way,
// where it turns and where it is concentrated — in the same tile shape and the
// same order of magnitude, so switching series moves the numbers without moving
// the layout.
//
// Nothing here fetches. The EM band and the Bull/Bear split are the two tiles
// above that come from elsewhere, and neither is a delta fact.
// ─────────────────────────────────────────────────────────────────────────────

export interface DeltaStatCardsProps {
  rows: GexRow[]
  spot: number
  basis: GexBasis
  /** e.g. "11 expirations, 0DTE excluded" — printed on the Scope tile. */
  scopeNote: string
}

export function DeltaStatCards({ rows, spot, basis, scopeNote }: DeltaStatCardsProps) {
  const kDp = useMemo(() => strikeDp(rows, spot), [rows, spot])

  const tiles = useMemo(() => {
    let total = 0
    let long = 0
    let short = 0
    let peak: number | null = null
    let peakAbs = 0
    let zero: number | null = null
    let prevSign = 0
    // The rows arrive ascending by strike from every producer; sorted here
    // anyway because the ZERO CROSSING is the one figure that would be silently
    // wrong on an unsorted ladder rather than merely unordered.
    const sorted = rows.length ? rows.slice().sort((a, b) => a.strike - b.strike) : []
    for (const r of sorted) {
      const v = dexOf(r, basis)
      total += v
      if (v > 0) long += v
      else short += -v
      if (Math.abs(v) > peakAbs) {
        peakAbs = Math.abs(v)
        peak = r.strike
      }
      const sign = v > 0 ? 1 : v < 0 ? -1 : 0
      if (zero == null && sign !== 0 && prevSign !== 0 && sign !== prevSign) zero = r.strike
      if (sign !== 0) prevSign = sign
    }
    const px = (v: number | null) => (v == null ? EM_DASH : fmtPx(v, kDp))
    const empty = sorted.length === 0
    return [
      {
        key: 'netDex',
        label: 'Net Δ$',
        value: empty ? EM_DASH : fmtGexShort(total),
        colour: empty ? MUTED : total >= 0 ? '--color-gexbar-pos' : '--color-gexbar-neg',
        title: 'Every strike on the ladder, summed. Summed here rather than read off the payload: there is no server-side delta total, and the number has to be the bars’',
      },
      {
        key: 'longDex',
        label: 'Long Δ$',
        value: empty ? EM_DASH : fmtGexShort(long),
        colour: '--color-gexbar-pos',
        title: 'The positive strikes alone — where the dealer is long delta',
      },
      {
        key: 'shortDex',
        label: 'Short Δ$',
        value: empty ? EM_DASH : fmtGexShort(-short),
        colour: '--color-gexbar-neg',
        title: 'The negative strikes alone — where the dealer is short delta',
      },
      {
        key: 'dexZero',
        label: 'Δ Zero',
        value: px(zero),
        colour: '--color-warn',
        title: 'The lowest strike at which net delta changes sign. Not a gamma flip — it is where the delta ladder itself turns over',
      },
      {
        key: 'peakDex',
        label: 'Peak |Δ|',
        value: px(peak),
        colour: '--color-series-5',
        title: 'The strike carrying the biggest absolute net delta on the whole ladder',
      },
      {
        key: 'strikes',
        label: 'Strikes',
        value: empty ? EM_DASH : String(sorted.length),
        colour: MUTED,
        title: 'How many strikes this ladder covers',
      },
      {
        key: 'scope',
        label: 'Scope',
        value: scopeNote || EM_DASH,
        colour: MUTED,
        title: 'Which expirations these bars are summed over',
      },
    ]
  }, [rows, basis, kDp, scopeNote])

  return (
    <div className="flex shrink-0 items-stretch gap-1.5 overflow-hidden">
      {tiles.map((t) => (
        <div
          key={t.key}
          title={t.title}
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-px rounded-sm border border-line bg-raised px-1 py-1"
        >
          <span className="truncate text-3xs font-bold uppercase tracking-[0.08em] text-muted opacity-70">
            {t.label}
          </span>
          <span className="tabular truncate font-mono text-sm font-extrabold" style={{ color: `var(${t.colour})` }}>
            {t.value}
          </span>
        </div>
      ))}
    </div>
  )
}
