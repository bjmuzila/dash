import { useMemo, useState } from 'react'
import { Page } from '@/design/primitives/Page'
import { Card } from '@/design/primitives/Card'
import { Table, type Column } from '@/design/primitives/Table'
import { Stat } from '@/design/primitives/Stat'
import { SegGroup } from '@/design/primitives/Controls'
import { useQuery } from '@/data/api'
import { useFrame, useField } from '@/data/hooks'
import { usePageSymbol, isSocketSymbol } from '@/data/symbol'
import type { SpotFrame, GexFrame, GexRow, AuxFrame } from '@/contract/frames'

// ─────────────────────────────────────────────────────────────────────────────
// /v3/premarket — Premarket Prep. Replaces v2's components/pages/Premarket.tsx
// (mounted at /app/premarket), a ~3,300-line page with its own session picker,
// a minute-by-minute replay transport and a full Post-Market recap tab.
//
// This page answers the same three questions before the open — what regime am
// I in, where are the walls, what happened overnight — from the SAME sections
// in the SAME order, on v3 primitives and the wire contract in
// src/contract/frames.ts instead of v2's chain-scraping hooks.
//
// ── WHY THIS IS SPX-ONLY, FOR NOW ───────────────────────────────────────────
// v2 grew a second data path (useChainGex, off /api/chains) so every MAIN
// ticker could render this page. That path is not part of this port: the three
// REST calls this page fires (below) and the socket's one symbol together only
// describe SPX. If the board's global ticker (the toolbar search) is pointed
// at anything else, the page says so rather than quietly showing SPX numbers
// under another ticker's name — see the note under the page header.
//
// ── WHAT IS FULLY WIRED ──────────────────────────────────────────────────────
// Regime, the GEX level rail, the six Key Levels tiles (incl. the OI-basis
// migration line vs the prior close), max pain and the 0DTE magnet are all
// computed here from the socket's own `gex` frame (GexRow carries per-strike
// OI, volume-leg and OI+Vol gamma already split out) plus
// /api/premarket-baseline for the prior session. Biggest GEX Changes and
// Sector Heat are real reads of that baseline and of
// /api/scanner/market-quality. The playbook one-liner is generated from the
// same live numbers the tiles show.
//
// ── WHAT IS A TODO STUB, AND WHY ─────────────────────────────────────────────
// Some v2 sections are bespoke renderers or need endpoints outside the three
// this page fires, and are stubbed as a real Card with its title, a
// text-faint note on what is missing, and a `// TODO(v3):` naming the v2
// symbol — never invented numbers, never a silently dropped section:
//   • GexProfile.tsx (both the front-expiry and ex-0DTE ladders) — a
//     virtualized, pan/zoom per-strike bar chart with its own scroll geometry.
//   • useMultiExpiryGex / /proxy/gex-by-strike-multi — the whole-board sweep
//     the ex-0DTE ladder is built from.
//   • GammaBellCurve.tsx — the strike-axis gamma-mass + least-squares curve.
//   • GexHeatBar's GexChurnHistory / useGexChurnHistory — book-churn history.
//   • CbContracts.tsx / /api/cb-contracts — the CB-strike 0DTE contracts board.
//   • PostMarketTab.tsx — the entire post-close recap, its own multi-thousand
//     line component.
//   • Expected move (needs an ATM straddle off /api/chains), the overnight ES
//     range (needs useEsCandles) and Catalysts (needs useEconCalendar) are
//     each a `—` with a note rather than a fabricated number.
//
// Dropped from this port entirely, not stubbed: the session-date picker,
// frozen-session capture and minute-by-minute replay transport, and
// HistoricalRecap.tsx. All three exist to look at a PAST session, and none of
// their storage (premarket-freeze-recorder / premarket-replay-recorder / the
// per-date recap stores) is part of this page's wired data. This page is the
// live board only.
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'pre' | 'post'
type LvlBasis = 'oi' | 'oivol' | 'vol'

const KDP = 0 // strike display decimals
const PXDP = 2 // price display decimals

// ── formatting — verbatim from v2's Premarket.tsx so the numbers read the same ──
const nf = (v: number, dp = 0) => v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

function fmtUsd(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const sign = v < 0 ? '−' : signed ? '+' : ''
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}
const fmtPts = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${nf(Math.abs(v), 0)} pts`
const fmtPx = (v: number | null | undefined, dp = 0) =>
  v == null || !Number.isFinite(v) || v <= 0 ? '—' : nf(v, dp)
const fmtPct = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(dp)}%`

/** Classic max pain — the strike where total in-the-money OI value is smallest.
 *  Needs only callOI/putOI, both on GexRow, so this is a REAL number, not a
 *  stub — see computeMaxPain in v2's Premarket.tsx for the source this was
 *  transcribed from. */
function computeMaxPain(rows: GexRow[]): number | null {
  const candidates = rows.filter((r) => r.callOI > 0 || r.putOI > 0)
  if (candidates.length < 5) return null
  let best: number | null = null
  let bestVal = Infinity
  for (const cand of candidates) {
    const s = cand.strike
    let total = 0
    for (const r of candidates) {
      if (s > r.strike) total += r.callOI * (s - r.strike)
      else if (s < r.strike) total += r.putOI * (r.strike - s)
    }
    if (total < bestVal) {
      bestVal = total
      best = s
    }
  }
  return best
}

/** 0DTE magnet — biggest |OI+Vol netGEX| within the strikes nearest spot. */
function pickMagnet(rows: GexRow[], spot: number, half = 12): GexRow | null {
  if (!rows.length || !(spot > 0)) return null
  const near = [...rows].sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot)).slice(0, half * 2 + 1)
  const seed = near[0]
  if (!seed) return null
  return near.reduce((b, r) => (Math.abs(r.netGEX) > Math.abs(b.netGEX) ? r : b), seed)
}

interface GexDelta {
  was: number
  now: number
  delta: number
  pct: number | null
  flipped: boolean
}
interface PxMove {
  was: number
  now: number
  move: number
}

/** One strike's gamma Δ vs the baseline's OI-basis snapshot. Null means "we
 *  cannot say" — the caller renders no migration line at all in that case. */
function deltaAt(baseline: Baseline | null, byStrike: Map<number, number>, strike: number | null): GexDelta | null {
  if (!baseline || strike == null) return null
  const was = baseline.byStrike[String(strike)]
  const now = byStrike.get(strike)
  if (was == null || now == null || !Number.isFinite(was) || !Number.isFinite(now)) return null
  const delta = now - was
  const pct = Math.abs(was) > 1e6 ? (delta / Math.abs(was)) * 100 : null
  return { was, now, delta, pct, flipped: was >= 0 !== now >= 0 }
}
function moved(was: number | null | undefined, now: number | null | undefined): PxMove | null {
  if (was == null || now == null || !Number.isFinite(was) || !Number.isFinite(now)) return null
  return { was, now, move: now - was }
}
/** State word for a wall's gamma change, read on magnitude — a put wall's
 *  gamma is negative, so "more negative" is the wall getting HEAVIER. */
function wallTag(d: GexDelta | null, strong: string, weak: string): string | null {
  if (!d) return null
  if (d.flipped) return 'flipped sign'
  if (d.pct != null && Math.abs(d.pct) < 2) return 'unchanged'
  return Math.abs(d.now) - Math.abs(d.was) >= 0 ? strong : weak
}

// ── REST response shapes — only the fields this page reads ──────────────────
interface Baseline {
  date: string
  expiry: string
  spot: number | null
  netGex: number | null
  flip: number | null
  callWall: number | null
  putWall: number | null
  strikes: number
  byStrike: Record<string, number>
}
interface SectorRow {
  symbol: string
  name: string
  chg5d: number | null
}
interface MarketQualityResponse {
  data?: {
    sectorBars?: SectorRow[]
    globalScore?: number
    decision?: string
  }
}
interface QuoteItem {
  symbol: string
  last?: number | null
  change?: number | null
  'percent-change'?: number | null
}
interface QuotesBatchResponse {
  data?: { items?: QuoteItem[] }
}

// ── a Key Levels tile ─────────────────────────────────────────────────────────
interface MigInfo {
  tag: string | null
  was: string
  now: string
  pct?: string
}
function LevelTile({
  name,
  qualifier,
  price,
  detail,
  dist,
  distDir,
  pill,
  mig,
}: {
  name: string
  qualifier: string
  price: string
  detail: string
  dist: string
  distDir?: 'up' | 'down'
  pill?: string
  mig?: MigInfo | null
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-surface2 p-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted">{name}</span>
        <span className="text-[10px] uppercase tracking-wide text-faint">{qualifier}</span>
      </div>
      <div className="tabular text-lg font-medium leading-tight text-fg">{price}</div>
      <div className="tabular text-xs text-faint">{detail}</div>
      <div className="flex items-center gap-1.5">
        <span
          className={[
            'tabular text-xs font-medium',
            distDir === 'up' ? 'text-up' : distDir === 'down' ? 'text-down' : 'text-muted',
          ].join(' ')}
        >
          {dist}
        </span>
        {pill && (
          <span className="rounded-sm border border-line px-1 text-[10px] text-faint">{pill}</span>
        )}
      </div>
      {mig?.tag && (
        <div className="tabular border-t border-line/50 pt-1 text-[10px] text-faint">
          <span className="mr-1 font-semibold text-fg">{mig.tag}</span>
          was {mig.was} → {mig.now}
          {mig.pct ? ` · ${mig.pct}` : ''}
        </div>
      )}
    </div>
  )
}

const TAB_OPTIONS: { label: string; value: Tab; title?: string }[] = [
  { label: 'Premarket', value: 'pre' },
  { label: 'Post-Market', value: 'post', title: 'Post-close recap — not yet ported, see the TODO stub' },
]
const LVL_BASIS_OPTIONS: { label: string; value: LvlBasis; title: string }[] = [
  { label: 'OI', value: 'oi', title: 'γ × OI × S² — the premarket-honest basis; the only one the baseline can diff against' },
  { label: 'OI+VOL', value: 'oivol', title: 'γ × (OI+Vol) × S² — what the KPI prints; no baseline to diff on this leg' },
  { label: 'VOL', value: 'vol', title: 'γ × Volume × S² — today\'s trading only; near zero before 09:30' },
]

export default function Premarket() {
  const { symbol } = usePageSymbol()
  const onSpx = isSocketSymbol(symbol)

  // ── live frames ─────────────────────────────────────────────────────────
  // Spot ticks fast, so it goes through useField (re-renders only when the
  // 2dp value actually changes). gex/aux are far slower — a few times a
  // minute — so reading the whole frame with useFrame is fine and keeps every
  // field the sections below need in one place.
  const spot = useField<SpotFrame, number>('spot', (f) => f?.data.spot ?? 0)
  const gexFrame = useFrame<GexFrame>('gex')
  const auxFrame = useFrame<AuxFrame>('aux')

  const hasData = gexFrame != null
  const gexRows = gexFrame?.data.gexRows ?? []
  const callWall = gexFrame?.data.callWall ?? null
  const putWall = gexFrame?.data.putWall ?? null
  const flip = gexFrame?.data.gexFlip ?? null
  const totalNetGex = gexFrame?.data.totalNetGex ?? null
  const expiry = gexFrame?.data.expiry
  const updatedAt = gexFrame?.data.updatedAt
  const esFut = auxFrame?.data.esFut ?? null
  const esFutPrevClose = auxFrame?.data.esFutPrevClose ?? null
  const vix = auxFrame?.data.vix ?? null
  const vixPrevClose = auxFrame?.data.vixPrevClose ?? null
  const auxBasis = auxFrame?.data.basis ?? null

  const isZeroDte = gexRows.length > 0 && Math.min(...gexRows.map((r) => r.dte)) === 0

  // ── every REST call this route needs, fired in parallel, right here ───────
  // No waterfall: the baseline's URL depends on `expiry`, which arrives over
  // the SOCKET (not from another fetch), so this still fires at mount, not
  // after some parent request resolves.
  const marketQualityRes = useQuery<MarketQualityResponse>('/api/scanner/market-quality', { pollMs: 60_000 })
  const baselineRes = useQuery<Baseline>(
    expiry ? `/api/premarket-baseline?expiry=${encodeURIComponent(expiry)}&basis=oi&symbol=SPX` : null,
    { staleMs: 5 * 60_000 },
  )
  const quotesRes = useQuery<QuotesBatchResponse>('/api/quotes-batch?symbols=SPX', { pollMs: 30_000 })
  const baseline = baselineRes.data ?? null
  const spxQuote = quotesRes.data?.data?.items?.find((i) => i.symbol === 'SPX')

  const [tab, setTab] = useState<Tab>('pre')
  const [lvlBasis, setLvlBasis] = useState<LvlBasis>('oi')

  const posGamma = (totalNetGex ?? 0) >= 0
  const distFlip = spot > 0 && flip != null ? spot - flip : null
  const distCall = spot > 0 && callWall != null ? callWall - spot : null
  const distPut = spot > 0 && putWall != null ? putWall - spot : null

  // Per-strike value on the SELECTED Key Levels basis. `netGEX` is the wire's
  // OI+Vol number and `netVolGEX` is its volume-only leg, so `netGEX -
  // netVolGEX` is the OI-only leg — same split v2's oiLeg() computes, just off
  // the frame's own fields instead of a fetched chain.
  const byStrikeSel = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of gexRows) {
      const v = lvlBasis === 'vol' ? r.netVolGEX : lvlBasis === 'oivol' ? r.netGEX : r.netGEX - r.netVolGEX
      if (Number.isFinite(v)) m.set(r.strike, v)
    }
    return m
  }, [gexRows, lvlBasis])

  const oiByStrike = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of gexRows) m.set(r.strike, r.netGEX - r.netVolGEX)
    return m
  }, [gexRows])

  const magnet = useMemo(() => pickMagnet(gexRows, spot), [gexRows, spot])
  const magnetValue = magnet ? byStrikeSel.get(magnet.strike) ?? magnet.netGEX : null
  const maxPain = useMemo(() => computeMaxPain(gexRows), [gexRows])
  const wallGexCall = callWall != null ? byStrikeSel.get(callWall) ?? null : null
  const wallGexPut = putWall != null ? byStrikeSel.get(putWall) ?? null : null

  const oiTotal = useMemo(() => {
    let sum = 0
    for (const v of oiByStrike.values()) sum += v
    return oiByStrike.size ? sum : null
  }, [oiByStrike])
  const netGexChangePct =
    oiTotal != null && baseline?.netGex ? ((oiTotal - baseline.netGex) / Math.abs(baseline.netGex)) * 100 : null

  // Migration lines only render on the OI tab: the baseline is fetched on the
  // OI basis and diffing it against an OI+Vol or Vol-only live leg would be
  // pure basis mismatch (see v2's basisMap()/header for the full argument).
  const migBasis = lvlBasis === 'oi'
  const callWallDelta = migBasis ? deltaAt(baseline, byStrikeSel, callWall) : null
  const putWallDelta = migBasis ? deltaAt(baseline, byStrikeSel, putWall) : null
  const magnetDelta = migBasis && magnet ? deltaAt(baseline, byStrikeSel, magnet.strike) : null
  const flipMove = moved(baseline?.flip, flip)
  const spotMove = moved(baseline?.spot, spot > 0 ? spot : null)

  const biggestChanges = useMemo(() => {
    if (!baseline) return []
    const rows: { strike: number; delta: number }[] = []
    for (const [strike, oi] of oiByStrike) {
      const b = baseline.byStrike[String(strike)]
      if (b == null) continue
      const delta = oi - b
      if (Number.isFinite(delta) && delta !== 0) rows.push({ strike, delta })
    }
    return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 4)
  }, [baseline, oiByStrike])

  const sectorRows = (marketQualityRes.data?.data?.sectorBars ?? []).slice(0, 8)
  const mq = marketQualityRes.data?.data
    ? { score: marketQualityRes.data.data.globalScore ?? 0, decision: marketQualityRes.data.data.decision ?? '' }
    : null

  const dexRows = gexRows.filter((r) => typeof r.netDEX === 'number')
  const dexTotal = dexRows.length ? dexRows.reduce((s, r) => s + (r.netDEX ?? 0), 0) : null
  const callGexTotal = gexRows.length ? gexRows.reduce((s, r) => s + r.callGEX, 0) : null
  const putGexTotal = gexRows.length ? gexRows.reduce((s, r) => s + r.putGEX, 0) : null

  // ── GEX Level Rail — every level on one axis, proportionally placed ───────
  const railMarks = useMemo(() => {
    const raw: { code: string; px: number; dot: string; text: string }[] = []
    if (callWall != null) raw.push({ code: 'CW', px: callWall, dot: 'bg-level-cw', text: 'text-level-cw' })
    if (flip != null) raw.push({ code: 'FLIP', px: flip, dot: 'bg-accent', text: 'text-accent' })
    if (magnet) raw.push({ code: 'MAG', px: magnet.strike, dot: 'bg-level-cb', text: 'text-level-cb' })
    if (putWall != null) raw.push({ code: 'PW', px: putWall, dot: 'bg-level-pw', text: 'text-level-pw' })
    if (spot > 0) raw.push({ code: 'SPOT', px: spot, dot: 'bg-fg', text: 'text-fg' })
    if (raw.length < 2) return null
    const pxs = raw.map((m) => m.px)
    const lo = Math.min(...pxs) * 0.998
    const hi = Math.max(...pxs) * 1.002
    const span = hi - lo || 1
    return {
      lo,
      hi,
      marks: raw.map((m) => ({ ...m, pos: Math.max(3, Math.min(97, ((m.px - lo) / span) * 100)) })),
    }
  }, [callWall, flip, magnet, putWall, spot])

  // ── playbook one-liner — the same read the tiles above already support ────
  const playbook = hasData
    ? posGamma
      ? `Fade extremes, scalp toward the ${magnet ? nf(magnet.strike, KDP) : 'magnet'}.`
      : 'Stand aside at the edges, trade continuation through the walls.'
    : 'Waiting for the first chain frame.'

  const biggestChangesEmpty = !baseline
    ? baselineRes.loading
      ? 'Loading the prior-close baseline…'
      : 'No prior-session board yet — server-v2/premarket-baseline.js records one at the 16:05 close.'
    : 'No strike moved against the prior close.'
  const sectorEmpty = marketQualityRes.loading ? 'Loading sector data…' : 'No sector data available.'

  const changeCols: Column<{ strike: number; delta: number }>[] = [
    { key: 'strike', header: 'Strike', numeric: true, cell: (r) => nf(r.strike, KDP) },
    { key: 'delta', header: 'Δ vs prior close', numeric: true, cell: (r) => (
      <span className={r.delta >= 0 ? 'text-up' : 'text-down'}>{fmtUsd(r.delta)}</span>
    ) },
  ]
  const sectorCols: Column<SectorRow>[] = [
    { key: 'name', header: 'Sector', cell: (r) => <>{r.name} <span className="text-faint">{r.symbol}</span></> },
    { key: 'chg5d', header: '5D %', numeric: true, cell: (r) => (
      <span className={(r.chg5d ?? 0) >= 0 ? 'text-up' : 'text-down'}>{fmtPct(r.chg5d)}</span>
    ) },
  ]

  const footerLine = [
    'SPX',
    onSpx ? 'live socket' : 'socket carries SPX only',
    `spot ${fmtPx(spot, PXDP)}`,
    `ES ${fmtPx(esFut, 2)}`,
    auxBasis != null ? `basis ${auxBasis >= 0 ? '+' : '−'}${Math.abs(auxBasis).toFixed(2)}` : null,
    `${gexRows.length} strikes`,
    updatedAt
      ? `${new Date(updatedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false })} ET`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Page
      title={tab === 'post' ? 'Post-Market Recap' : 'Premarket Prep'}
      actions={<SegGroup options={TAB_OPTIONS} value={tab} onChange={setTab} title="Premarket vs. post-close recap" />}
    >
      {!onSpx && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-xs text-warn">
          The board's ticker is <b>{symbol}</b>, but this page follows the socket's one symbol (SPX) — the
          three feeds it reads (gex/spot frames, the OI baseline, the SPX quote) have no per-ticker form yet.
          Every number below is SPX's.
        </div>
      )}

      {tab === 'post' ? (
        <Card title="Post-Market Recap">
          <p className="text-sm text-faint">
            The post-close recap — the settled book, the session's price path and its wall log — is a
            separate multi-thousand-line component in v2 with its own data model.
          </p>
          {/* TODO(v3): port components/pages/premarket/PostMarketTab.tsx. */}
        </Card>
      ) : (
        <>
          {/* ── 1. Regime ──────────────────────────────────────────────────── */}
          <Card title="Regime">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span
                  className={['h-2.5 w-2.5 shrink-0 rounded-full', !hasData ? 'bg-faint' : posGamma ? 'bg-up' : 'bg-down'].join(' ')}
                />
                <div>
                  <div className={['text-sm font-semibold', !hasData ? 'text-faint' : posGamma ? 'text-up' : 'text-down'].join(' ')}>
                    {!hasData ? 'WAITING FOR FEED' : posGamma ? 'POSITIVE GAMMA' : 'NEGATIVE GAMMA'}
                  </div>
                  <div className="text-xs text-faint">
                    {!hasData
                      ? 'no chain frame yet'
                      : posGamma
                        ? 'Dealers long gamma · mean-reverting tape'
                        : 'Dealers short gamma · moves get amplified'}
                  </div>
                </div>
              </div>
              <div className="h-8 w-px bg-line" />
              <Stat
                label="Net GEX"
                value={fmtUsd(totalNetGex)}
                sub={netGexChangePct != null ? `${netGexChangePct >= 0 ? '▲' : '▼'} ${Math.abs(netGexChangePct).toFixed(0)}% OI vs prior close` : 'vs prior close —'}
                direction={netGexChangePct == null ? undefined : netGexChangePct >= 0 ? 'up' : 'down'}
              />
              <div className="h-8 w-px bg-line" />
              <Stat
                label="Gamma Flip"
                value={fmtPx(flip, KDP)}
                sub={distFlip == null || spot <= 0 ? undefined : `${fmtPts(distFlip)} / ${fmtPct((distFlip / spot) * 100)}`}
                direction={distFlip == null ? undefined : distFlip >= 0 ? 'up' : 'down'}
              />
              <div className="h-8 w-px bg-line" />
              <Stat label="SPX / ES" value={fmtPx(spot, PXDP)} sub={`ES ${fmtPx(esFut, 2)}`} />
            </div>
            <div className={['mt-3 rounded-md border p-2 text-sm', posGamma ? 'border-up/30 bg-up/5' : 'border-down/30 bg-down/5'].join(' ')}>
              <div className={['font-semibold', posGamma ? 'text-up' : 'text-down'].join(' ')}>
                {posGamma ? 'Range day — fade the walls' : 'Trend day — follow the breaks'}
              </div>
              <div className="text-xs text-faint">
                {distFlip == null
                  ? 'Flip unavailable — no crossing in the current chain.'
                  : `${distFlip >= 0 ? 'Above' : 'Below'} flip by ${nf(Math.abs(distFlip), PXDP)} pts. ${
                      posGamma ? `Suppression regime until ${fmtPx(flip, KDP)} breaks.` : `Acceleration regime until ${fmtPx(flip, KDP)} is reclaimed.`
                    }`}
              </div>
            </div>
          </Card>

          {/* ── 1b. GEX Level Rail ────────────────────────────────────────────
              Simplified vs v2's — every mark is placed proportionally on one
              axis, but the anti-overlap label clustering v2's `rail` memo does
              is not reproduced here. */}
          <Card
            title="GEX Levels · one axis"
            actions={
              <span className="tabular text-xs text-faint">
                {railMarks ? `${fmtPx(railMarks.lo, KDP)} – ${fmtPx(railMarks.hi, KDP)}` : 'waiting for the chain'}
              </span>
            }
          >
            {railMarks ? (
              <div className="relative h-20">
                <div className="absolute left-0 right-0 top-1/2 h-px bg-line" />
                {railMarks.marks.map((m) => (
                  <div
                    key={m.code}
                    className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
                    style={{ left: `${m.pos}%` }}
                  >
                    <span className={['h-2 w-2 rounded-full', m.dot].join(' ')} />
                    <span className={['text-[10px] font-semibold', m.text].join(' ')}>{m.code}</span>
                    <span className="tabular text-[10px] text-faint">{fmtPx(m.px, KDP)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-faint">Waiting for the chain…</div>
            )}
          </Card>

          {/* ── 2. Key Levels ─────────────────────────────────────────────────
              ES-converted sub-lines are deliberately OMITTED — AuxData.basis
              is documented in contract/frames.ts as NOT a usable ES/SPX
              conversion, and the endpoint that is (/proxy/es-spx-basis) is
              outside this page's wired REST calls. */}
          <Card
            title="Key Levels"
            actions={
              <span className="text-xs text-faint">
                {!baseline ? (baselineRes.loading ? 'baseline loading…' : 'no baseline — levels only') : `vs ${baseline.date} close`}
              </span>
            }
          >
            <div className="mb-2">
              <SegGroup options={LVL_BASIS_OPTIONS} value={lvlBasis} onChange={setLvlBasis} title="Key levels basis" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <LevelTile
                name="Call Wall"
                qualifier="resistance"
                price={fmtPx(callWall, KDP)}
                detail={fmtUsd(wallGexCall, false)}
                dist={fmtPts(distCall)}
                distDir={distCall == null ? undefined : distCall >= 0 ? 'up' : 'down'}
                mig={callWallDelta ? { tag: wallTag(callWallDelta, 'building', 'eroding'), was: fmtUsd(callWallDelta.was, false), now: fmtUsd(callWallDelta.now, false), pct: callWallDelta.pct != null ? fmtPct(callWallDelta.pct, 0) : undefined } : null}
              />
              <LevelTile
                name="0DTE Magnet"
                qualifier="max γ"
                price={magnet ? fmtPx(magnet.strike, KDP) : '—'}
                detail={magnet ? fmtUsd(magnetValue, false) : '—'}
                dist={magnet ? fmtPts(magnet.strike - spot) : '—'}
                distDir={!magnet ? undefined : magnet.strike - spot >= 0 ? 'up' : 'down'}
                pill={magnet ? (Math.abs(magnet.strike - spot) <= 5 ? 'pinning' : 'magnet') : undefined}
                mig={
                  magnetDelta
                    ? {
                        tag: magnetDelta.flipped
                          ? magnetDelta.now >= 0
                            ? 'flipped +γ'
                            : 'flipped −γ'
                          : Math.abs(magnetDelta.now) >= Math.abs(magnetDelta.was)
                            ? 'building'
                            : 'eroding',
                        was: fmtUsd(magnetDelta.was, false),
                        now: fmtUsd(magnetDelta.now, false),
                        pct: magnetDelta.pct != null ? fmtPct(magnetDelta.pct, 0) : undefined,
                      }
                    : null
                }
              />
              <LevelTile
                name="Spot"
                qualifier="live"
                price={fmtPx(spot, PXDP)}
                detail={spxQuote?.['percent-change'] != null ? fmtPct(spxQuote['percent-change']) : '—'}
                dist=""
                mig={
                  spotMove
                    ? {
                        tag: Math.abs(spotMove.move) < 0.5 ? 'flat o/n' : spotMove.move > 0 ? 'gap up' : 'gap down',
                        was: fmtPx(spotMove.was, PXDP),
                        now: fmtPx(spotMove.now, PXDP),
                        pct: fmtPts(spotMove.move),
                      }
                    : null
                }
              />
              <LevelTile
                name="Max Pain"
                qualifier={isZeroDte ? '0DTE' : 'front'}
                price={fmtPx(maxPain, KDP)}
                detail="OI-weighted"
                dist={maxPain != null ? fmtPts(maxPain - spot) : '—'}
                distDir={maxPain == null ? undefined : maxPain - spot >= 0 ? 'up' : 'down'}
                pill={maxPain != null ? (maxPain > spot ? 'drift ↑' : 'drift ↓') : undefined}
              />
              <LevelTile
                name="Gamma Flip"
                qualifier="regime"
                price={fmtPx(flip, KDP)}
                detail="zero γ"
                dist={fmtPts(distFlip)}
                distDir={distFlip == null ? undefined : distFlip >= 0 ? 'up' : 'down'}
                mig={
                  flipMove
                    ? {
                        tag: Math.abs(flipMove.move) < 0.5 ? 'held' : flipMove.move > 0 ? `rose ${nf(flipMove.move, PXDP)}` : `fell ${nf(Math.abs(flipMove.move), PXDP)}`,
                        was: fmtPx(flipMove.was, KDP),
                        now: fmtPx(flipMove.now, KDP),
                      }
                    : null
                }
              />
              <LevelTile
                name="Put Wall"
                qualifier="support"
                price={fmtPx(putWall, KDP)}
                detail={fmtUsd(wallGexPut, false)}
                dist={fmtPts(distPut)}
                distDir={distPut == null ? undefined : distPut >= 0 ? 'up' : 'down'}
                mig={putWallDelta ? { tag: wallTag(putWallDelta, 'deepening', 'easing'), was: fmtUsd(putWallDelta.was, false), now: fmtUsd(putWallDelta.now, false), pct: putWallDelta.pct != null ? fmtPct(putWallDelta.pct, 0) : undefined } : null}
              />
            </div>
          </Card>

          {/* ── 3. The two ladders ─────────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card title="GEX Profile by Strike" actions={<span className="text-xs text-faint">{isZeroDte ? '0DTE' : 'front'}{expiry ? ` ${expiry}` : ''} · OI + Vol</span>}>
              <div className="mb-2 grid grid-cols-3 gap-2">
                <Stat label="DEX" value={fmtUsd(dexTotal)} direction={dexTotal == null ? undefined : dexTotal >= 0 ? 'up' : 'down'} sub={dexTotal == null ? 'no per-contract delta on this feed' : dexTotal >= 0 ? 'calls leading · tilt ↑' : 'puts leading · tilt ↓'} size="sm" />
                <Stat label="Vanna" value="—" sub="no per-contract vanna on this feed" size="sm" />
                <Stat label="Call / Put γ" value={`${fmtUsd(callGexTotal, false)} / ${fmtUsd(putGexTotal != null ? Math.abs(putGexTotal) : null, false)}`} size="sm" />
              </div>
              <p className="text-xs text-faint">
                The scrolling per-strike bar ladder (spot/flip markers, pan &amp; zoom) is not ported.
              </p>
              {/* TODO(v3): port premarket/GexProfile.tsx's front-expiry ladder — it owns its
                  own ±60-strike windowed scroll geometry (PROFILE_ROW_H), which this Card's
                  three stats above do not attempt to reproduce. */}
            </Card>
            <Card title="GEX Profile · ex-0DTE" actions={<span className="text-xs text-faint">all expirations less 0DTE</span>}>
              <p className="text-xs text-faint">
                Needs the whole-board multi-expiry sweep — not one of this page's wired endpoints.
              </p>
              {/* TODO(v3): port useMultiExpiryGex (/proxy/gex-by-strike-multi) and mount
                  premarket/GexProfile.tsx a second time against its ex-0DTE ladder. */}
            </Card>
          </div>

          {/* ── 4. Overnight context / expected range ─────────────────────── */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Card title="Overnight Context" actions={<span className="text-xs text-faint">ES · 18:00</span>}>
                <div className="grid grid-cols-2 gap-2">
                  <Stat
                    label="ES change"
                    value={esFut != null && esFutPrevClose != null ? fmtPts(esFut - esFutPrevClose) : '—'}
                    direction={esFut == null || esFutPrevClose == null ? undefined : esFut - esFutPrevClose >= 0 ? 'up' : 'down'}
                    size="sm"
                  />
                  <Stat label="NQ change" value="—" sub="no NQ feed wired in v3 yet" size="sm" />
                  <Stat
                    label="VIX"
                    value={vix != null ? vix.toFixed(2) : '—'}
                    sub={vix != null && vixPrevClose != null ? fmtPts(vix - vixPrevClose) : undefined}
                    /* Inverted on purpose, matching v2: rising VIX is bad news. */
                    direction={vix == null || vixPrevClose == null ? undefined : vix - vixPrevClose >= 0 ? 'down' : 'up'}
                    size="sm"
                  />
                  <Stat label="Prior RTH close (ES)" value={fmtPx(esFutPrevClose, PXDP)} size="sm" />
                </div>
                <p className="mt-2 text-xs text-faint">
                  The overnight range bar, gap-to-fill and prior-day range need the ES candle history
                  (useEsCandles) — not wired here.
                </p>
                {/* TODO(v3): port the `overnight`/`gap` memos in v2's Premarket.tsx, which read
                    a 5m ES candle pool for the Globex session. */}
                {quotesRes.error && <p className="mt-1 text-xs text-down">Quotes feed failed — showing last good data.</p>}
              </Card>

              <Card title="Biggest GEX Changes" actions={<span className="text-xs text-faint">{baseline ? `vs ${baseline.date} close · OI basis` : 'vs prior close'}</span>}>
                <Table columns={changeCols} rows={biggestChanges} rowKey={(r) => r.strike} empty={biggestChangesEmpty} />
                {baselineRes.error && <p className="mt-1 text-xs text-down">Baseline feed failed — showing last good data.</p>}
              </Card>

              <Card title="Sector Heat" actions={<span className="text-xs text-faint">Market Quality · 5d %</span>}>
                <Table columns={sectorCols} rows={sectorRows} rowKey={(r) => r.symbol} empty={sectorEmpty} />
                {marketQualityRes.error && <p className="mt-1 text-xs text-down">Market quality feed failed — showing last good data.</p>}
              </Card>
            </div>

            <div className="flex flex-col gap-3">
              <Card title="Expected Range" actions={<span className="text-xs text-faint">{isZeroDte ? '0DTE' : 'front'}</span>}>
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="IV-implied move" value="—" sub="needs an ATM straddle off /api/chains" size="sm" />
                  <Stat
                    label="GEX-implied range"
                    value={putWall != null && callWall != null ? `${fmtPx(putWall, KDP)} – ${fmtPx(callWall, KDP)}` : '—'}
                    sub={putWall != null && callWall != null ? `${nf(Math.abs(callWall - putWall), PXDP)} pts` : undefined}
                    size="sm"
                  />
                  <Stat label="Overlap / conviction" value="—" sub="depends on the IV-implied move above" size="sm" />
                  <Stat
                    label="Market quality"
                    value={mq ? `${Math.round(mq.score)} / 100` : '—'}
                    sub={mq?.decision}
                    direction={mq == null ? undefined : mq.score >= 60 ? 'up' : mq.score >= 40 ? 'flat' : 'down'}
                    size="sm"
                  />
                </div>
                <div className="mt-3 rounded-md border border-line bg-surface2 p-2">
                  <div className="text-xs font-semibold text-fg">Today&apos;s one-liner</div>
                  <p className="mt-1 text-xs text-faint">
                    {hasData ? (
                      <>
                        {posGamma ? 'Positive gamma' : 'Negative gamma'}, flip{' '}
                        {distFlip == null ? 'n/a' : `${nf(Math.abs(distFlip), PXDP)} pts ${distFlip >= 0 ? 'below' : 'above'}`}, Call Wall{' '}
                        {distCall == null ? 'n/a' : `${nf(Math.abs(distCall), PXDP)} ${distCall >= 0 ? 'above' : 'below'}`}, Put Wall{' '}
                        {distPut == null ? 'n/a' : `${nf(Math.abs(distPut), PXDP)} ${distPut >= 0 ? 'above' : 'below'}`} — <b className="text-fg">{playbook}</b>
                      </>
                    ) : (
                      'Waiting for the first chain frame.'
                    )}
                  </p>
                </div>
              </Card>

              <Card title="Catalysts" actions={<span className="text-xs text-faint">today</span>}>
                <p className="text-xs text-faint">Econ calendar and earnings-week feeds are not wired into v3 yet.</p>
                {/* TODO(v3): port useEconCalendar (+ /proxy/earnings-week) and the
                    todayEvents/todayEarnings lists from v2's Premarket.tsx. */}
              </Card>
            </div>
          </div>

          {/* ── Gamma bell curve, full width ──────────────────────────────── */}
          <Card title="Gamma Bell Curve">
            <p className="text-xs text-faint">
              The strike-axis gamma-mass chart with its least-squares normal and ±1σ band is a bespoke
              canvas renderer.
            </p>
            {/* TODO(v3): port premarket/GammaBellCurve.tsx. */}
          </Card>

          {/* ── 5. What changed in the book ────────────────────────────────── */}
          <Card title="Gamma Book Churn">
            <p className="text-xs text-faint">
              How much of SPX&apos;s whole book has been rewriting itself, session by session — the level
              log&apos;s own history component, keyed to this page&apos;s symbol.
            </p>
            {/* TODO(v3): port components/shared/GexHeatBar's GexChurnHistory / useGexChurnHistory. */}
          </Card>

          {/* ── 6. Contracts ──────────────────────────────────────────────── */}
          <Card title="Contracts">
            <p className="text-xs text-faint">
              The CB-strike 0DTE contracts board, read-only off /api/cb-contracts.
            </p>
            {/* TODO(v3): port premarket/CbContracts.tsx. */}
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-faint">
            <span className="tabular">{footerLine}</span>
            <span className="tabular rounded-sm border border-line px-1.5 py-0.5">
              {isZeroDte ? '0DTE' : 'FRONT'} {expiry ?? '—'}
            </span>
          </div>
        </>
      )}
    </Page>
  )
}
