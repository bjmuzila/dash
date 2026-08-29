import { useEffect, useMemo, useRef } from 'react'
import { valueOf, type GexColumn } from './gexHistory'
import type { GexMetric } from './settings'
import type { EsChartHandle, RailSink } from './chart'

// ─────────────────────────────────────────────────────────────────────────────
// The GEX rail — the live strike ladder, pinned to the chart's price axis.
//
// Shape is a bare magnitude ladder: the level tag on the left, then a single
// left-anchored bar that always grows to the RIGHT, one strike per line. The
// strike price and the dollar value are deliberately absent — the chart's own
// price axis already labels the height, and the bar's length already says the
// size, so printing either again is noise in a 96px column. Sign survives in
// the bar's colour. The tag is the ONLY thing that marks a level — no row wash,
// no bar outline. A strike can be two levels at once and each gets its own tag.
//
// ── WHY THE ROWS ARE ABSOLUTELY POSITIONED ───────────────────────────────────
//
// A rail beside a chart is only worth anything if a strike's row sits at the
// same height as that strike on the chart. A normal flowing list cannot do
// that: its rows are evenly spaced and the chart's are not — the price scale
// autoscales, the user pans and zooms, and the gap between two strikes in
// pixels changes constantly.
//
// So every row is `position:absolute` and its `top` comes from the chart's own
// `priceToCoordinate`, delivered once per animation frame through the RailSink
// the chart already runs its bubble layer from. Same mapping, same frame — the
// rail cannot drift from the bubbles or the candles because it is reading the
// number they were drawn with.
//
// That positioning is imperative, straight onto the DOM node. AGENTS.md rule 4:
// a tick never travels through React state on its way to a chart, and a pan
// gesture is sixty ticks a second.
//
// ── THINNING ─────────────────────────────────────────────────────────────────
//
// The ladder holds ~30 strikes. Zoomed out they can land within a pixel of each
// other, and a rail of overlapping text is worse than no rail. Rows are placed
// in PRIORITY order — the three named levels first, then by size — and any row
// that would land within a row-height of one already placed is hidden. So what
// survives a squeeze is always the part worth reading, and it is still the case
// that every row you can see is exactly level with its strike.
// ─────────────────────────────────────────────────────────────────────────────

/** Row height in px. Also the minimum gap between two placed rows. */
const ROW_H = 15

/** Rows nearer than this to the pane's top/bottom edge are dropped. */
const EDGE_PX = 2

export interface RailRow {
  strike: number
  value: number
}

export interface RailLevels {
  /** Core Bullseye — biggest |GEX| on the ladder. */
  cb: number | null
  /** Call wall — biggest +GEX above spot, CB excluded. */
  cw: number | null
  /** Put wall — most −GEX below spot, CB excluded. */
  pw: number | null
}

export interface RailModel {
  rows: RailRow[]
  levels: RailLevels
  spot: number
  maxAbs: number
}

const EMPTY: RailModel = { rows: [], levels: { cb: null, cw: null, pw: null }, spot: 0, maxAbs: 0 }

/**
 * The rail reads the NEWEST column of the same GEX history the bubbles are
 * built from — one fetch, two views of it. The bubbles say how the ladder got
 * here over the session; the rail says where it stands right now.
 */
export function buildRail(columns: GexColumn[], metric: GexMetric): RailModel {
  const col = columns[columns.length - 1]
  if (!col) return EMPTY

  const rows: RailRow[] = col.cells.map((cell) => ({ strike: cell.strike, value: valueOf(cell, metric) }))
  if (!rows.length) return EMPTY
  rows.sort((a, b) => b.strike - a.strike)

  // Legacy history rows carry spot 0. The recorder centres the ladder on spot,
  // so the middle of it is the honest fallback — the same one the bubble model
  // makes for the same reason.
  let spot = col.spot
  if (!(spot > 0)) {
    const hi = rows[0]?.strike ?? 0
    const lo = rows[rows.length - 1]?.strike ?? 0
    spot = (hi + lo) / 2
  }

  let maxAbs = 0
  let cb: number | null = null
  for (const r of rows) {
    const a = Math.abs(r.value)
    if (a > maxAbs) {
      maxAbs = a
      cb = r.strike
    }
  }

  // CB is excluded before the walls are picked, the same rule the Multi Greek
  // ladder follows: the biggest node on the board is frequently also the
  // biggest on one side of spot, and without this the core and the wall land on
  // one strike — losing the level price actually has to get through after it.
  let cw: number | null = null
  let pw: number | null = null
  let cwVal = 0
  let pwVal = 0
  for (const r of rows) {
    if (r.strike === cb) continue
    if (r.strike > spot && r.value > cwVal) {
      cwVal = r.value
      cw = r.strike
    }
    if (r.strike < spot && r.value < pwVal) {
      pwVal = r.value
      pw = r.strike
    }
  }

  return { rows, levels: { cb, cw, pw }, spot, maxAbs }
}

/**
 * `+1.2B`. Nothing in the rail PRINTS this any more — it is the row's hover
 * title, so the exact figure is still one hover away without spending a column
 * on it.
 */
function fmtRail(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '—'
  const abs = Math.abs(v)
  const sign = v > 0 ? '+' : '−'
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(0)}M`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}K`
  return `${sign}${abs.toFixed(0)}`
}

interface TagDef {
  key: 'cb' | 'cw' | 'pw'
  title: string
}

const TAGS: TagDef[] = [
  { key: 'cb', title: 'Core — biggest magnet' },
  { key: 'cw', title: 'Call wall — ceiling' },
  { key: 'pw', title: 'Put wall — floor' },
]

export interface GexRailProps {
  model: RailModel
  /** The card's buffered chart applier, so the rail can register its sink. */
  applyChart: (fn: (h: EsChartHandle) => void) => void
}

export function GexRail({ model, applyChart }: GexRailProps) {
  const nodes = useRef(new Map<number, HTMLDivElement>())

  const { rows, levels, maxAbs } = model

  /**
   * The order the thinning pass walks. Named levels first so a squeeze can
   * never be what hides the core, then biggest gamma first so what is left is
   * the part of the ladder worth the pixels.
   */
  const order = useMemo(() => {
    const named = new Set<number>()
    for (const s of [levels.cb, levels.cw, levels.pw]) if (s != null) named.add(s)
    const rest = rows.filter((r) => !named.has(r.strike)).sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    return [...named, ...rest.map((r) => r.strike)]
  }, [rows, levels])

  const orderRef = useRef<number[]>(order)
  orderRef.current = order

  useEffect(() => {
    const sink: RailSink = (yOfPrice, height) => {
      const placed: number[] = []
      for (const strike of orderRef.current) {
        const el = nodes.current.get(strike)
        if (!el) continue
        const y = yOfPrice(strike)
        let show = y != null && y >= EDGE_PX && y <= height - EDGE_PX
        if (show && y != null) {
          for (const p of placed) {
            if (Math.abs(p - y) < ROW_H) {
              show = false
              break
            }
          }
        }
        if (!show || y == null) {
          if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
          continue
        }
        placed.push(y)
        // Rounded, so text does not land on a half pixel and blur. Compared
        // against the value already on the node: a write per row per frame is
        // sixty style invalidations a second for a rail that mostly is not
        // moving.
        const next = `translateY(${Math.round(y - ROW_H / 2)}px)`
        if (el.style.transform !== next) el.style.transform = next
        if (el.style.visibility !== 'visible') el.style.visibility = 'visible'
      }
    }
    applyChart((h) => h.setRailSink(sink))
    return () => applyChart((h) => h.setRailSink(null))
  }, [applyChart])

  // Rows that left the ladder must leave the map with them, or the sink keeps
  // positioning a detached node forever.
  useEffect(() => {
    const live = new Set(rows.map((r) => r.strike))
    for (const strike of [...nodes.current.keys()]) if (!live.has(strike)) nodes.current.delete(strike)
  }, [rows])

  return (
    <div className="relative w-[96px] shrink-0 overflow-hidden border-l border-line pl-1.5">
      {rows.length === 0 && (
        <span className="absolute inset-x-1.5 top-1 text-[10px] text-muted opacity-50">No ladder yet</span>
      )}
      {rows.map((r) => {
        const pos = r.value >= 0
        const hue = pos ? 'var(--color-gex-pos)' : 'var(--color-gex-neg)'
        const pct = maxAbs > 0 ? Math.max(2, (Math.abs(r.value) / maxAbs) * 100) : 0
        const marks = TAGS.filter((t) => levels[t.key] === r.strike)
        return (
          <div
            key={r.strike}
            ref={(el) => {
              if (el) nodes.current.set(r.strike, el)
              else nodes.current.delete(r.strike)
            }}
            title={`${r.strike.toLocaleString('en-US', { maximumFractionDigits: 2 })}  ${fmtRail(r.value)}`}
            // `visibility: hidden` and no transform until the first frame
            // positions it — otherwise every row paints stacked at the top of
            // the rail for one frame on mount.
            style={{ height: ROW_H, visibility: 'hidden', willChange: 'transform' }}
            className="absolute inset-x-0 top-0 flex items-center gap-1 whitespace-nowrap"
          >
            {/* Named tags, not anonymous dots. Three dot colours is a legend to
                memorise; "CB" is not. The column keeps its width whether or not
                this strike is tagged, so every bar starts on the same x. */}
            <span className="flex w-[22px] shrink-0 items-center gap-px">
              {marks.map((m) => (
                <span
                  key={m.key}
                  title={m.title}
                  className="rounded-[2px] px-[3px] text-[8px] font-black leading-[1.5] tracking-[0.04em]"
                  style={{ background: `var(--color-level-${m.key})`, color: 'var(--color-app)' }}
                >
                  {m.key.toUpperCase()}
                </span>
              ))}
            </span>

            {/* ONE DIRECTION. Every bar is anchored to the same left edge and
                grows right, positive or negative — the centre hairline is gone,
                so the full width is spent on magnitude and the eye compares
                lengths off one baseline instead of two. Sign is the colour.
                The bar is still UNTOUCHED by the level marking — no outline, no
                glow; which level it is gets said by the tag and nowhere else. */}
            <span className="flex min-w-0 flex-1 items-center">
              <span className="h-[7px] rounded-r-[2px]" style={{ width: `${pct}%`, background: hue }} />
            </span>
          </div>
        )
      })}
    </div>
  )
}
