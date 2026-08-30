import { useEffect, useMemo, useRef, useState } from 'react'
import { CardToolbar } from '@/design/primitives/Card'

// ─────────────────────────────────────────────────────────────────────────────
// GEX LEVELS · ONE AXIS — every level the card knows, on a single price rail.
//
// This replaced six tiles. Tiles answer "what is the call wall" one at a time;
// the question actually being asked is "where is price sitting inside the
// gamma", and that is a question about the DISTANCES BETWEEN the levels, which
// six boxes in a row cannot show at all. On one axis the gap between spot and
// the wall above it is a gap you can see.
//
// ── The rail ─────────────────────────────────────────────────────────────────
// Grey end to end, with the PUT WALL → CALL WALL span tinted: red at the floor,
// fading through the middle, level-blue at the ceiling. That tinted span is the
// corridor — the part of the axis gamma is actually defending.
//
// ── Labels ───────────────────────────────────────────────────────────────────
// Alternating above and below in price order, then a collision pass that nudges
// each one clear of its neighbour and off the ends. Measured against the real
// container width through a ResizeObserver rather than a guessed percentage: at
// w:12 this card is ~1400px and at w:6 it is ~700px, and a gap that works at one
// overlaps at the other.
// ─────────────────────────────────────────────────────────────────────────────

export interface AxisMark {
  key: string
  /** Short code, e.g. `CW`. */
  code: string
  /** Full name, e.g. `CALL WALL`. */
  name: string
  /** Positions the mark. */
  price: number
  /** The price as printed — the card decides the decimals, not this file. */
  text: string
  /** A CSS custom property name for this mark's colour. */
  colourVar: string
  /** The line under the price: distance, and how the level is moving. */
  note: string
  /** An optional fourth line, dimmer — the level's dollar gamma. */
  sub?: string
}

/** Label block width, px. The collision pass keeps this much clear per mark. */
const LABEL_W = 96
/** Fraction of the span left as breathing room at each end of the rail. */
const PAD_FRAC = 0.06

function pct(v: number, lo: number, hi: number): number {
  if (!(hi > lo)) return 50
  return ((v - lo) / (hi - lo)) * 100
}

/**
 * Nudge overlapping labels apart, in percent, left to right.
 *
 * Only the LABEL moves — the tick stays on the price. A label that has been
 * pushed is still unambiguous because its tick is still where the number says
 * it is; a label that has been dropped is information gone.
 */
function spread(positions: number[], minGapPct: number): number[] {
  const out = [...positions]
  const half = minGapPct / 2
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]
    const cur = out[i]
    if (prev === undefined || cur === undefined) continue
    if (cur - prev < minGapPct) out[i] = prev + minGapPct
  }
  // Then walk back from the right edge, so a run pushed past 100% comes home
  // instead of piling up off the end.
  for (let i = out.length - 1; i >= 0; i--) {
    const cur = out[i]
    if (cur === undefined) continue
    const limit = i === out.length - 1 ? 100 - half : (out[i + 1] ?? 100) - minGapPct
    if (cur > limit) out[i] = limit
  }
  for (let i = 0; i < out.length; i++) {
    const cur = out[i]
    if (cur === undefined) continue
    if (cur < half) out[i] = half
  }
  return out
}

export function LevelsAxis({ marks, spotPrice }: { marks: AxisMark[]; spotPrice: number | null }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const model = useMemo(() => {
    const sorted = [...marks].sort((a, b) => a.price - b.price)
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    if (!first || !last) return null

    const span = last.price - first.price
    // A single-price axis (every level on one strike) still has to be drawable,
    // so give it a nominal width rather than dividing by zero.
    const pad = span > 0 ? span * PAD_FRAC : Math.max(1, first.price * 0.001)
    const lo = first.price - pad
    const hi = last.price + pad

    const minGapPct = width > 0 ? Math.min(45, (LABEL_W / width) * 100) : 12
    const raw = sorted.map((m) => pct(m.price, lo, hi))

    // Above and below are spread independently — a label above only has to
    // clear the other labels above it.
    const aboveIdx: number[] = []
    const belowIdx: number[] = []
    sorted.forEach((_, i) => (i % 2 === 0 ? aboveIdx : belowIdx).push(i))
    const placed = new Map<number, number>()
    for (const band of [aboveIdx, belowIdx]) {
      const spreadPos = spread(
        band.map((i) => raw[i] ?? 50),
        minGapPct,
      )
      band.forEach((i, k) => placed.set(i, spreadPos[k] ?? 50))
    }

    return {
      lo,
      hi,
      rows: sorted.map((m, i) => ({
        mark: m,
        tickPct: raw[i] ?? 50,
        labelPct: placed.get(i) ?? 50,
        above: i % 2 === 0,
      })),
      corridor: (() => {
        const pw = sorted.find((m) => m.key === 'pw')
        const cw = sorted.find((m) => m.key === 'cw')
        if (!pw || !cw) return null
        return { from: pct(pw.price, lo, hi), to: pct(cw.price, lo, hi) }
      })(),
      spotPct: spotPrice != null && spotPrice > 0 ? pct(spotPrice, lo, hi) : null,
    }
  }, [marks, spotPrice, width])

  if (!model) {
    return <div className="px-1 py-3 text-xs text-muted opacity-50">Waiting for levels…</div>
  }

  const { lo, hi, rows, corridor, spotPct } = model

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The axis's domain, in the Card's header rather than on a title row of
          its own — the Card already says "Key Levels", and a second heading
          inside it is the two-toolbar problem in a different costume. */}
      <CardToolbar>
        <span className="tabular font-mono text-2xs text-muted opacity-60">
          {lo.toFixed(2)} – {hi.toFixed(2)} · {(hi - lo).toFixed(2)} PTS
        </span>
      </CardToolbar>

      <div ref={wrapRef} className="relative min-h-0 flex-1">
        {/* The rail sits at the vertical middle; labels take the halves above
            and below it. Percentages, not pixels, so the strip is happy at any
            card height the user drags it to. */}
        <div className="absolute inset-x-0 top-1/2 h-[13px] -translate-y-1/2 overflow-hidden rounded-full bg-raised">
          {corridor && (
            <div
              className="absolute inset-y-0"
              style={{
                left: `${Math.min(corridor.from, corridor.to)}%`,
                width: `${Math.abs(corridor.to - corridor.from)}%`,
                background:
                  'linear-gradient(to right, color-mix(in srgb, var(--color-level-pw) 70%, transparent), color-mix(in srgb, var(--color-muted) 12%, transparent) 50%, color-mix(in srgb, var(--color-level-cw) 70%, transparent))',
              }}
            />
          )}
        </div>

        {/* Spot's tick is taller and drawn over everything: "where price is"
            must never be the ambiguous mark on this card. */}
        {spotPct != null && (
          <div
            className="pointer-events-none absolute top-1/2 h-[24px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg"
            style={{ left: `${spotPct}%`, zIndex: 2 }}
          />
        )}

        {rows.map(({ mark, tickPct, labelPct, above }) => {
          const colour = `var(${mark.colourVar})`
          return (
            <div key={mark.key}>
              <div
                className="pointer-events-none absolute top-1/2 h-[19px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: `${tickPct}%`, background: colour, zIndex: 1 }}
              />
              <div
                className={[
                  'pointer-events-none absolute flex -translate-x-1/2 flex-col items-center leading-tight',
                  above ? 'bottom-[calc(50%+14px)]' : 'top-[calc(50%+14px)]',
                ].join(' ')}
                style={{ left: `${labelPct}%`, width: LABEL_W }}
              >
                <span
                  className="whitespace-nowrap text-3xs font-black uppercase tracking-[0.08em]"
                  style={{ color: colour }}
                >
                  {mark.code} · {mark.name}
                </span>
                <span className="tabular font-mono text-base font-extrabold text-fg">{mark.text}</span>
                <span className="tabular whitespace-nowrap font-mono text-3xs" style={{ color: colour }}>
                  {mark.note}
                </span>
                {mark.sub && (
                  <span className="tabular whitespace-nowrap font-mono text-3xs text-muted opacity-60">
                    {mark.sub}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
