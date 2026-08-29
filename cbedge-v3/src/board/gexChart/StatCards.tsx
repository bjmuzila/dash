import { useMemo } from 'react'
import { useQuery } from '@/data/api'
import { isSocketSymbol } from '@/data/symbol'
import type { GexRow } from '@/contract/frames'
import { computeMaxPain, fmtPx, strikeDp } from '../keyLevels/levelsMath'
import type { GexBasis, StatKey } from './settings'
import { coreStrike, flipOf, fmtGexShort, posGexPct, totalNet, wallsOf } from './values'

// ─────────────────────────────────────────────────────────────────────────────
// The ten cards, ported from v2's home GEX toolbar.
//
//   Net GEX · Call Wall · Put Wall · Flip · CB · Max Pain · +1σ · −1σ ·
//   +GEX % · Bull/Bear
//
// ── They read the CHART'S numbers, not their own ─────────────────────────────
// Eight of the ten are derived from the same rows the bars are drawn from, on
// the same basis, through the same accessors in values.ts. That is the whole
// point of the row sitting directly above the chart: v2's comment on this block
// says it out loud — "the cards can never disagree with the chart beneath
// them" — and the only way to keep that true is to have one definition of each
// level, not two.
//
// So switching the chart to VOL moves the walls, the core and the flip with it.
// A tile that did NOT move would be the bug.
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
  /** Which of the ten to draw, in STAT_KEYS order. */
  enabled: Record<StatKey, boolean>
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

export function StatCards({ rows, spot, symbol, basis, flowActive, enabled }: StatCardsProps) {
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
    const walls = wallsOf(rows, spot, basis, flowActive)
    const core = coreStrike(rows, basis, flowActive)
    const flip = flipOf(rows, basis, flowActive)
    const maxPain = computeMaxPain(rows)
    const pct = rows.length ? posGexPct(rows, basis, flowActive) : null

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
        value: px(walls.call),
        colour: '--color-level-cw',
        title: 'Largest positive net gamma strictly above spot',
      },
      {
        key: 'putWall',
        label: 'Put Wall',
        value: px(walls.put),
        colour: '--color-level-pw',
        title: 'Most negative net gamma strictly below spot',
      },
      {
        key: 'flip',
        label: 'Flip',
        value: px(flip),
        colour: '--color-warn',
        title: 'Where the running total first crosses from negative to positive, walking strikes upward',
      },
      {
        key: 'cb',
        label: 'CB',
        value: px(core),
        colour: '--color-level-cb',
        title: 'Core Bullseye — the strike carrying the biggest absolute net gamma on the whole ladder. The badge on the chart marks the same strike',
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
    return all.filter((t) => enabled[t.key])
  }, [rows, spot, basis, flowActive, kDp, em, bullPct, onSocket, enabled])

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
          <span className="truncate text-[9px] font-bold uppercase tracking-[0.08em] text-muted opacity-70">
            {t.label}
          </span>
          <span
            className="tabular truncate font-mono text-[12px] font-extrabold"
            style={{ color: `var(${t.colour})` }}
          >
            {t.value}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Toolbar-facing labels for the cog's on/off chips. */
export const STAT_LABEL: Record<StatKey, string> = {
  netGex: 'Net GEX',
  callWall: 'Call Wall',
  putWall: 'Put Wall',
  flip: 'Flip',
  cb: 'CB',
  maxPain: 'Max Pain',
  emUp: '+1σ',
  emDown: '−1σ',
  posGexPct: '+GEX %',
  bullBear: 'Bull/Bear',
}
