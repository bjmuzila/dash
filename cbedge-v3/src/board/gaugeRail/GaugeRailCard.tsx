import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CardToolbar } from '@/design/primitives/Card'
import { useQuery } from '@/data/api'
import { useField } from '@/data/hooks'
import { SOCKET_SYMBOL } from '@/data/symbol'
import type { GexFrame, GexRow } from '@/contract/frames'
import { GEX_NEG, GEX_POS, T, alpha } from '@/design/theme'
import { dexOf, netGexOf } from '../gexChart/values'
import { etDay } from '../gexCandles/gexHistory'
import { fmtContractDate } from '../cardTitle'

// ─────────────────────────────────────────────────────────────────────────────
// GAUGE RAIL — v2's home-page segmented-LED strip, as a board card.
//
// Five readings as tick meters: two signed LEVELS (net gamma, net delta), one
// PERCENTAGE (the call share of volume gamma), and two RATES OF CHANGE (net GEX
// per minute, and net GEX over the last fifteen minutes). Each tile carries a
// 15-minute change line under its value.
//
// v2 draws SIX. The sixth is IB Direction, and it is deliberately not here:
// Brandon asked for the rail without it (2026-09-03). It was also the one tile
// on the rail with nothing to do with the option book — it came off the ES
// candle feed through a hook of its own — so dropping it is what makes this a
// single-source card: every number below comes from ONE gex frame plus that
// frame's own history.
//
// ── Where the numbers come from, and why not from `totals` ───────────────────
//
// v2's rail reads the socket's `totals` blob (`totalGEXOiVol`, `totalDeltaOiVol`
// …). v3's wire contract does not describe that blob — `GexData.totals` is
// `unknown` — and nothing in src/ may reach for a field contract/frames.ts does
// not carry. So the rail sums the ROWS instead, through the same accessors the
// GEX Chart card and its ten stat tiles use (gexChart/values.ts, OI+VOL basis):
//
//   GEX = Σ netGexOf(r,'oi-vol')  = Σ (netGEX + netVolGEX)
//   DEX = Σ dexOf(r,'oi-vol')     = Σ (netDEX + volNetDEX)
//
// That is not a reinterpretation. It is the identical definition server-v2's own
// greeks-ts-writer.js uses when it records the greeks series this card seeds
// itself from, so the seeded past and the live present are the same quantity —
// and the rail can never disagree with the Net GEX tile on the GEX Chart card
// sitting next to it on the board.
//
// ── The seed ─────────────────────────────────────────────────────────────────
//
// Two tiles (the rate, and the 15-minute change) and two meter SCALES are
// functions of today's history, not of the current frame. Built from live frames
// alone they would read "--" for the first fifteen minutes after the card is
// added, which is most of the time anyone spends looking at a board.
//
// `/api/snapshots/greeks` is today's recorded gex/dex series in $B. One request,
// ten minutes of cache, no poll: the socket keeps the series current, the seed
// only fills in what happened before the card mounted.
//
// ── The 15-minute change line is NOT value − prevValue ───────────────────────
//
// It is driven by a per-tile ring buffer of one-minute samples (useDelta15m).
// value − prevValue would report the change since the last socket frame and
// label it a fifteen-minute move, which is the failure v2's comment on this
// block warns about. Until the ring reaches back fifteen minutes the line draws
// NOTHING rather than a short-window change wearing the wrong label.
// ─────────────────────────────────────────────────────────────────────────────

const BILLION = 1e9
const MINUTE_MS = 60_000
/** Lookback for the change line and for the Δ15m tile. */
const WINDOW_MS = 15 * MINUTE_MS
/** ~16 one-minute samples: just enough to always reach back across WINDOW_MS. */
const RING_MINUTES = 16
/** A move smaller than this share of a tile's full scale reads as flat. */
const DEADBAND_FRACTION = 0.01
/** Live points are bucketed this fine, so a fast feed cannot flood the series. */
const BUCKET_MS = 15_000
/** How many points of history to keep. A full RTH session at BUCKET_MS. */
const MAX_POINTS = 1500
/**
 * Segments per meter.
 *
 * 30, not the original 20 (2026-09-04): at 20 the bars are wide enough that a
 * near-full-scale reading reads as one solid slab rather than a meter. Thinner
 * LEDs keep the segmented look at both ends of the range, and give the fill
 * enough resolution that a few percent of scale is a visible step.
 */
const SEGMENTS = 30

/** Stable keys for the per-tile ring buffers. Also the on-screen labels. */
const LABELS = {
  gamma: 'Gamma (Net GEX)',
  delta: 'Delta (DEX)',
  gammaPct: 'Gamma % 0DTE (Vol)',
  gexRate: 'Net GEX Rate / min',
  gexChg: '0DTE GEX Δ 15m',
} as const

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))

const num = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}

// ── One frame, reduced to the four numbers the rail draws ────────────────────

interface Snap {
  /** ms epoch of the moment these values last changed. */
  ts: number
  /** $B, OI+VOL basis. */
  gex: number
  /** $B, OI+VOL basis. */
  dex: number
  /** Call share of VOLUME gamma, 0–100. Null when nothing has traded. */
  gammaPctVol: number | null
  expiry: string
}

function readSnap(frame: GexFrame | undefined): Snap | null {
  const rows: GexRow[] | undefined = frame?.data.gexRows
  if (!rows || !rows.length) return null

  let gex = 0
  let dex = 0
  let callVolGamma = 0
  let putVolGamma = 0
  for (const r of rows) {
    gex += netGexOf(r, 'oi-vol', false)
    dex += dexOf(r, 'oi-vol')
    // v2's gammaPctVol, transcribed: the CALL share of vol-only gamma. Gamma ×
    // CONTRACTS, not dollar gamma — it answers "which side is today's volume
    // in", and weighting by spot² would make it drift with the index instead.
    callVolGamma += Math.abs(num(r.callGamma)) * num(r.callVolume)
    putVolGamma += Math.abs(num(r.putGamma)) * num(r.putVolume)
  }

  const totVol = callVolGamma + putVolGamma
  let ts = num(frame?.data.updatedAt)
  if (!(ts > 0)) ts = Date.now()
  else if (ts < 1e12) ts *= 1000

  return {
    ts,
    gex: gex / BILLION,
    dex: dex / BILLION,
    gammaPctVol: totVol > 0 ? (callVolGamma / totVol) * 100 : null,
    expiry: frame?.data.expiry ?? '',
  }
}

/**
 * ⚠ `ts` is deliberately NOT compared.
 *
 * The gex frame carries a fresh `updatedAt` on every push, so a snapshot that
 * included it would be a new object several times a second even when not one
 * number on the rail had moved — and useField would re-render the card, and the
 * effect below would append a point, on every frame. Comparing only the VALUES
 * makes the rail sample on movement, and the timestamp it keeps is then the
 * moment the reading last actually changed, which is also the honest x for a
 * per-minute rate.
 */
function sameSnap(a: Snap | null, b: Snap | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.gex === b.gex && a.dex === b.dex && a.gammaPctVol === b.gammaPctVol && a.expiry === b.expiry
}

// ── History ──────────────────────────────────────────────────────────────────

interface Point {
  ts: number
  /** $B. */
  gex: number
  /** $B. */
  dex: number
}

/** A row of `/api/snapshots/greeks`. gex/dex arrive already in $B. */
interface GreeksRow {
  timestamp?: unknown
  gex?: unknown
  dex?: unknown
}

function parseSeed(json: { rows?: GreeksRow[] } | undefined): Point[] {
  const rows = json?.rows
  if (!Array.isArray(rows)) return []
  const out: Point[] = []
  for (const r of rows) {
    const ts = num(r?.timestamp)
    if (!(ts > 0)) continue
    out.push({ ts: ts < 1e12 ? ts * 1000 : ts, gex: num(r?.gex), dex: num(r?.dex) })
  }
  out.sort((a, b) => a.ts - b.ts)
  return out
}

interface Sample {
  ts: number
  v: number
}

/**
 * Per-tile ring buffer of ~16 one-minute samples, and the 15-minute delta drawn
 * from it.
 *
 * Sampling is on a 5s TIMER rather than on the render cadence: socket frames
 * arrive faster and irregularly, and the timer is what makes the spacing one
 * minute. At most one sample per wall-clock minute bucket per key.
 *
 * The delta is the current value minus the newest sample at or before the
 * 15-minute mark, with a half-minute tolerance for a full ring whose oldest
 * sample sits a few seconds shy of it. No sample reaching that far back → null,
 * and the caller draws nothing.
 */
function useDelta15m(values: Record<string, number | null>): Record<string, number | null> {
  const valuesRef = useRef(values)
  valuesRef.current = values
  const [rings, setRings] = useState<Record<string, Sample[]>>({})

  useEffect(() => {
    const sample = () => {
      const now = Date.now()
      const bucket = Math.floor(now / MINUTE_MS)
      setRings((prev) => {
        const next: Record<string, Sample[]> = { ...prev }
        let changed = false
        for (const [k, v] of Object.entries(valuesRef.current)) {
          if (v == null || !Number.isFinite(v)) continue
          const buf = prev[k] ?? []
          const last = buf[buf.length - 1]
          if (last && Math.floor(last.ts / MINUTE_MS) === bucket) continue
          next[k] = [...buf, { ts: now, v }].slice(-RING_MINUTES)
          changed = true
        }
        return changed ? next : prev
      })
    }
    sample()
    const id = setInterval(sample, 5_000)
    return () => clearInterval(id)
  }, [])

  const target = Date.now() - WINDOW_MS + MINUTE_MS / 2
  const out: Record<string, number | null> = {}
  for (const [k, v] of Object.entries(values)) {
    const buf = rings[k]
    if (v == null || !Number.isFinite(v) || !buf?.length) {
      out[k] = null
      continue
    }
    const reachable = buf.filter((s) => s.ts <= target)
    const ref = reachable[reachable.length - 1]
    out[k] = ref ? v - ref.v : null
  }
  return out
}

// ── The segmented LED meter ──────────────────────────────────────────────────
//
// `t` / `midT` are 0..1 positions. "signed" fills from the centre outward and
// draws a centre tick; "pct" fills from the left edge. The SVG is STRETCHED to
// the tile's width (preserveAspectRatio none) so five tiles share a row evenly
// and the meter never decides how wide a tile has to be.

const METER_W = 118
const METER_H = 30
const METER_PAD = 5
const METER_GAP = 1.5
const SEG_H = 22
const SEG_Y = 4

function SegMeter({
  t,
  midT,
  color,
  kind,
}: {
  t: number | null
  midT: number
  color: string
  kind: 'signed' | 'pct'
}) {
  const segW = (METER_W - METER_PAD * 2 - METER_GAP * (SEGMENTS - 1)) / SEGMENTS
  const has = t != null && Number.isFinite(t)
  const tv = t != null && Number.isFinite(t) ? clamp(t, 0, 1) : midT
  const litFrom = kind === 'pct' ? 0 : Math.min(tv, midT)
  const litTo = kind === 'pct' ? tv : Math.max(tv, midT)
  const off = alpha(T.text, 0.07)
  const glow = alpha(color, 0.8)

  const rects: ReactElement[] = []
  for (let i = 0; i < SEGMENTS; i++) {
    const s = i / SEGMENTS
    const e = (i + 1) / SEGMENTS
    const on = has && e > litFrom + 1e-6 && s < litTo - 1e-6
    rects.push(
      <rect
        key={i}
        x={METER_PAD + i * (segW + METER_GAP)}
        y={SEG_Y}
        width={segW}
        height={SEG_H}
        // 1, not 2: at ~2.15px wide a 2px radius rounds a bar into a pill.
        rx={1}
        fill={on ? color : off}
        style={on ? { filter: `drop-shadow(0 0 2px ${glow})` } : undefined}
      />,
    )
  }

  const midX = METER_PAD + midT * (METER_W - METER_PAD * 2)
  return (
    <svg
      viewBox={`0 0 ${METER_W} ${METER_H}`}
      preserveAspectRatio="none"
      aria-hidden
      className="block h-[30px] w-full shrink-0"
    >
      {rects}
      {kind === 'signed' && (
        <rect
          x={midX - 0.9}
          y={SEG_Y - 3}
          width={1.8}
          height={SEG_H + 6}
          rx={0.9}
          fill={alpha(T.text, 0.92)}
          style={{ filter: `drop-shadow(0 0 3px ${alpha(T.text, 0.55)})` }}
        />
      )}
    </svg>
  )
}

// ── Formatting ───────────────────────────────────────────────────────────────
// The minus is U+2212 throughout, so a signed value does not jitter as it
// crosses zero.

const fmtB = (v: number) => `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(2)}B`
const fmtPct = (v: number) => `${v.toFixed(0)}%`
/**
 * The rate is $M of gamma-per-1%-move per minute — MILLIONS, unlike the level
 * tiles beside it. A per-minute slice of the book is two or three orders of
 * magnitude smaller than the book: in billions an ordinary minute reads
 * "+$0.02B/m" and most of the day rounds to zero. Whole millions, because the
 * sub-million digit is feed jitter and a fixed unit keeps the tile from
 * twitching as the value ticks.
 */
const fmtRate = (v: number) => {
  const m = Math.round(Math.abs(v))
  if (m === 0) return '0M/m'
  return `${v >= 0 ? '+' : '−'}$${m.toLocaleString('en-US')}M/m`
}

// Unsigned magnitudes for the change line — its ▲/▼ carries the sign.
const fmtAbsB = (v: number) => `$${v.toFixed(2)}B`
const fmtAbsPct = (v: number) => `${v.toFixed(0)}%`
const fmtAbsRate = (v: number) => `$${Math.round(v).toLocaleString('en-US')}M/m`

// ── Tiles ────────────────────────────────────────────────────────────────────

interface GaugeDef {
  label: string
  value: number | null
  /** Normalised 0..1. */
  t: number | null
  midT: number
  kind: 'signed' | 'pct'
  color: string
  fmt: (v: number) => string
  /** Full scale of the meter — the deadband is DEADBAND_FRACTION of this. */
  scale: number
  fmtAbs: (v: number) => string
  delta15m: number | null
  title: string
}

/**
 * The 15-minute change line — text only, directly under the value, never
 * touching the meter. Only the magnitude carries the up/down accent; "/ 15m"
 * stays muted, so the colour reads as the direction of the move rather than as
 * part of the label.
 */
function Delta15m({ g }: { g: GaugeDef }) {
  const d = g.delta15m
  if (d == null || !Number.isFinite(d)) return null
  const flat = Math.abs(d) < g.scale * DEADBAND_FRACTION
  const up = d > 0
  return (
    <div className="tabular whitespace-nowrap pt-px text-2xs font-bold">
      <span
        className={flat ? 'opacity-50' : undefined}
        style={{ color: flat ? T.muted : up ? T.green : T.red }}
      >
        {flat ? '—' : `${up ? '▲' : '▼'} ${g.fmtAbs(Math.abs(d))}`}
      </span>
      <span className="font-semibold opacity-50" style={{ color: T.muted }}>
        {' / 15m'}
      </span>
    </div>
  )
}

function Cell({ g }: { g: GaugeDef }) {
  const has = g.value != null && Number.isFinite(g.value)
  return (
    <div
      title={g.title}
      className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-sm border border-line bg-raised px-1.5 py-1.5"
    >
      <span className="min-h-[22px] text-center text-3xs font-bold uppercase leading-tight tracking-[0.08em] text-muted opacity-70">
        {g.label}
      </span>
      <SegMeter t={g.t} midT={g.midT} color={g.color} kind={g.kind} />
      <div className="min-w-0 text-center">
        <div
          className={['tabular truncate font-mono text-sm font-extrabold', has ? '' : 'opacity-50']
            .filter(Boolean)
            .join(' ')}
          style={{ color: has ? T.text : T.faint }}
        >
          {has && g.value != null ? g.fmt(g.value) : '--'}
        </div>
        <Delta15m g={g} />
      </div>
    </div>
  )
}

// ── The card ─────────────────────────────────────────────────────────────────

export function GaugeRailCard() {
  const snap = useField<GexFrame, Snap | null>('gex', readSnap, sameSnap)

  // Today's recorded series, in $B, on the same OI+VOL definition.
  const seedQ = useQuery<{ rows?: GreeksRow[] }>(
    `/api/snapshots/greeks?date=${etDay(Date.now())}&limit=5000`,
    { staleMs: 600_000 },
  )
  const seed = useMemo(() => parseSeed(seedQ.data), [seedQ.data])

  // Live points, bucketed at BUCKET_MS. `snap` is reference-stable while its
  // numbers are unchanged (see sameSnap), so this appends on real movement
  // rather than on every frame.
  const [live, setLive] = useState<Point[]>([])
  useEffect(() => {
    if (!snap) return
    const point: Point = { ts: snap.ts, gex: snap.gex, dex: snap.dex }
    setLive((prev) => {
      const bucket = Math.floor(point.ts / BUCKET_MS)
      const kept = prev.filter((p) => Math.floor(p.ts / BUCKET_MS) !== bucket)
      return [...kept, point].sort((a, b) => a.ts - b.ts).slice(-MAX_POINTS)
    })
  }, [snap])

  // Seed BEHIND live, never interleaved: the recorder writes once a minute and
  // the socket lands whenever it lands, so overlapping the two would put two
  // samples of the same minute in the series and let a rate be computed across a
  // span of a couple of seconds.
  const history = useMemo<Point[]>(() => {
    if (!seed.length) return live
    const firstLive = live[0]?.ts
    if (firstLive == null) return seed
    return [...seed.filter((p) => p.ts < firstLive), ...live]
  }, [seed, live])

  const gex = snap?.gex ?? null
  const dex = snap?.dex ?? null
  const gammaPctVol = snap?.gammaPctVol ?? null

  const newest = history[history.length - 1]
  const now = snap?.ts ?? newest?.ts ?? Date.now()

  // 15-minute change in net GEX: current − the newest sample at or before the
  // 15-min mark, falling back to the oldest sample there is.
  const gexChg = useMemo(() => {
    if (gex == null || !history.length) return null
    const cutoff = now - WINDOW_MS
    const past = history.filter((p) => p.ts <= cutoff)
    const ref = past.length ? past[past.length - 1] : history[0]
    return ref ? gex - ref.gex : null
  }, [gex, history, now])

  // ── Net GEX RATE — $M of gamma-per-1%-move added (+) or pulled (−) per minute
  //
  // Δ is taken against the newest sample at least MIN_SPAN old and no older than
  // MAX_SPAN, then normalised to a per-minute figure by the ACTUAL elapsed time.
  // Normalising rather than assuming the reference sits exactly 60s back is what
  // keeps it honest: the series is bucketed and the feed's cadence drifts, so a
  // raw last-minus-reference would silently scale with however stale the
  // reference happened to be. A too-short span is rejected outright — dividing a
  // small Δ by a few seconds manufactures an enormous rate out of feed jitter.
  const gexRate = useMemo(() => {
    if (gex == null || history.length < 2) return null
    const MIN_SPAN_MS = 30_000
    const MAX_SPAN_MS = 180_000
    const target = now - MINUTE_MS
    const eligible = history.filter((p) => now - p.ts >= MIN_SPAN_MS && now - p.ts <= MAX_SPAN_MS)
    if (!eligible.length) return null
    const atOrBefore = eligible.filter((p) => p.ts <= target)
    const ref = atOrBefore.length ? atOrBefore[atOrBefore.length - 1] : eligible[0]
    if (!ref) return null
    const spanMs = now - ref.ts
    if (!(spanMs >= MIN_SPAN_MS)) return null
    // history carries $B; ×1000 emits the rate in $M per minute.
    return ((gex - ref.gex) / (spanMs / MINUTE_MS)) * 1000
  }, [gex, history, now])

  // ── Meter scales ───────────────────────────────────────────────────────────
  // The two level meters self-scale to today's biggest absolute reading, so a
  // quiet day still uses the whole meter.
  const gexScale = useMemo(() => {
    let m = Math.abs(gex ?? 0)
    for (const p of history) m = Math.max(m, Math.abs(p.gex))
    return m > 0 ? m : 1
  }, [history, gex])

  const dexScale = useMemo(() => {
    let m = Math.abs(dex ?? 0)
    for (const p of history) m = Math.max(m, Math.abs(p.dex))
    return m > 0 ? m : 1
  }, [history, dex])

  const chgScale = useMemo(() => {
    let m = Math.max(0.05, Math.abs(gexChg ?? 0))
    for (let i = 1; i < history.length; i++) {
      const cur = history[i]
      const prev = history[i - 1]
      if (!cur || !prev) continue
      m = Math.max(m, Math.abs(cur.gex - prev.gex))
    }
    return m
  }, [history, gexChg])

  /**
   * The rate meter's scale, in $M/min: the p99 of today's per-minute moves
   * rather than the raw max, so one absurd print cannot define the whole meter,
   * floored so a dead tape does not turn feed noise into a full-scale swing.
   * Exact zeros are dropped — long flat stretches (pre-open, lunch) would
   * otherwise drag the percentile down until the meter pegged on any tick.
   */
  const rateScale = useMemo(() => {
    const moves: number[] = []
    for (let i = 1; i < history.length; i++) {
      const cur = history[i]
      const prev = history[i - 1]
      if (!cur || !prev) continue
      const spanMs = cur.ts - prev.ts
      if (spanMs < 5_000) continue
      const perMin = (Math.abs(cur.gex - prev.gex) / (spanMs / MINUTE_MS)) * 1000
      if (Number.isFinite(perMin) && perMin > 0) moves.push(perMin)
    }
    let p99 = 0
    if (moves.length) {
      moves.sort((a, b) => a - b)
      p99 = moves[Math.min(moves.length - 1, Math.floor(moves.length * 0.99))] ?? 0
    }
    return Math.max(50, p99, Math.abs(gexRate ?? 0))
  }, [history, gexRate])

  /**
   * The rate meter's position — SQUARE-ROOT compressed, unlike every other tile
   * here. Per-minute GEX moves are heavily tailed: a calm minute and a headline
   * burst differ by two orders of magnitude, so under the linear mapping the
   * level tiles use, any scale large enough to show the burst leaves every
   * ordinary minute inside the first segment. sqrt spreads that range out — 1%
   * of scale still lights a segment, 25% reaches halfway, and only a genuine
   * full-scale burst pegs it.
   */
  const rateT = useMemo(() => {
    if (gexRate == null || !Number.isFinite(gexRate) || !(rateScale > 0)) return null
    const mag = Math.sqrt(clamp(Math.abs(gexRate) / rateScale, 0, 1)) / 2
    return clamp(0.5 + (gexRate >= 0 ? mag : -mag), 0, 1)
  }, [gexRate, rateScale])

  const ringInputs = useMemo(
    () => ({
      [LABELS.gamma]: gex,
      [LABELS.delta]: dex,
      [LABELS.gammaPct]: gammaPctVol,
      [LABELS.gexRate]: gexRate,
      [LABELS.gexChg]: gexChg,
    }),
    [gex, dex, gammaPctVol, gexRate, gexChg],
  )
  const delta15m = useDelta15m(ringInputs)

  /** Signed value → 0..1 with 0.5 at the centre tick. */
  const signedT = (v: number | null, scale: number) =>
    v == null ? null : clamp(0.5 + v / (2 * scale), 0, 1)

  const gauges: GaugeDef[] = [
    {
      label: LABELS.gamma,
      value: gex,
      t: signedT(gex, gexScale),
      midT: 0.5,
      kind: 'signed',
      color: gex == null ? T.cyan : gex >= 0 ? GEX_POS : GEX_NEG,
      fmt: fmtB,
      scale: gexScale,
      fmtAbs: fmtAbsB,
      delta15m: delta15m[LABELS.gamma] ?? null,
      title:
        'Net dealer gamma across the streamed expiry, OI+VOL basis — the same total the GEX Chart card puts in its Net GEX tile',
    },
    {
      label: LABELS.delta,
      value: dex,
      t: signedT(dex, dexScale),
      midT: 0.5,
      kind: 'signed',
      color: dex == null ? T.cyan : dex >= 0 ? GEX_POS : GEX_NEG,
      fmt: fmtB,
      scale: dexScale,
      fmtAbs: fmtAbsB,
      delta15m: delta15m[LABELS.delta] ?? null,
      title: 'Net dealer delta exposure — same rows, same basis as the gamma tile',
    },
    {
      label: LABELS.gammaPct,
      value: gammaPctVol,
      t: gammaPctVol == null ? null : clamp(gammaPctVol / 100, 0, 1),
      midT: 0,
      kind: 'pct',
      color: gammaPctVol == null ? T.cyan : gammaPctVol >= 50 ? GEX_POS : GEX_NEG,
      fmt: fmtPct,
      scale: 100,
      fmtAbs: fmtAbsPct,
      delta15m: delta15m[LABELS.gammaPct] ?? null,
      title: "Call share of today's VOLUME gamma. Above 50%, the day's traded gamma is call-side",
    },
    {
      label: LABELS.gexRate,
      value: gexRate,
      t: rateT,
      midT: 0.5,
      kind: 'signed',
      color: gexRate == null ? T.cyan : gexRate >= 0 ? GEX_POS : GEX_NEG,
      fmt: fmtRate,
      scale: rateScale,
      fmtAbs: fmtAbsRate,
      delta15m: delta15m[LABELS.gexRate] ?? null,
      title:
        'How fast dealer gamma is being added or pulled, in $M of gamma-per-1%-move per minute. Millions, not billions — a per-minute slice of the book is far smaller than the book',
    },
    {
      label: LABELS.gexChg,
      value: gexChg,
      t: signedT(gexChg, chgScale),
      midT: 0.5,
      kind: 'signed',
      color: gexChg == null ? T.cyan : gexChg >= 0 ? GEX_POS : GEX_NEG,
      fmt: fmtB,
      scale: chgScale,
      fmtAbs: fmtAbsB,
      delta15m: delta15m[LABELS.gexChg] ?? null,
      title: 'Net GEX now against net GEX fifteen minutes ago',
    },
  ]

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      // The caption under a CopyShot reads `Gauge Rail · <time> · <this>`. The
      // contract date is what makes a shared PNG of this card still mean
      // something later. See shell/snapshot.ts (META_ATTR).
      data-capture-meta={`${SOCKET_SYMBOL}${snap?.expiry ? ` · ${fmtContractDate(snap.expiry)}` : ''} · OI+VOL`}
    >
      <CardToolbar>
        <span className="text-2xs font-bold uppercase tracking-[0.08em] text-muted">OI+VOL</span>
        <span className="tabular text-2xs font-semibold text-accent">
          {SOCKET_SYMBOL}
          {snap?.expiry ? ` · ${fmtContractDate(snap.expiry)}` : ''}
        </span>
      </CardToolbar>

      <div className="flex min-h-0 flex-1 items-stretch gap-1.5 overflow-hidden">
        {gauges.map((g) => (
          <Cell key={g.label} g={g} />
        ))}
      </div>
    </div>
  )
}
