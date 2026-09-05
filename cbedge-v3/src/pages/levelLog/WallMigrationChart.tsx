// ─────────────────────────────────────────────────────────────────────────────
// WALL MIGRATION — the level log drawn: where the levels sat, slot by slot,
// against the price captured with them.
//
// A port of v2's WallMigrationChart (components/pages/LevelLog.tsx:1488–2181)
// against docs/parity/level-log.md Part H. The MODEL is transcribed row for
// row — the forward fill, the CORE-sign rule, the two-role drawing, the shared
// y range, the legend eligibility test. Only the palette and the chrome are new.
//
//   ONE LINE PER RECORDED LEVEL. Call wall, put wall and CORE, each in the
//   colour the rest of the app reads as that level. CORE is the recorded `cb`
//   strike and it frequently sits ON one of the walls, because the biggest node
//   on the chain is usually also the biggest node on one side of spot. That
//   overlap IS the reading.
//
// Two honest consequences of reading the log instead of a ladder:
//
//   1. walls_log is CHANGE-ONLY, so each series is forward-filled from its last
//      written row. That is exactly what the level did — a wall holds its strike
//      until it rolls — which is why every level is a STEP and never a slope. A
//      diagonal between two captures would draw the level at prices it never
//      occupied, which is precisely the reading this panel exists for.
//   2. Spot is only stored on the slots that wrote a row, plus the touch and
//      approach events. When the 1-minute tape is there the price line is the
//      tape; when it is not, it is those captures joined up, and the caption
//      says which — never the two spliced together.
//
// Nothing is filled in. A level with no rows for the day is simply not drawn,
// and the whole panel returns null rather than render an empty frame.
//
// PAINT TARGET: SVG, not canvas — <line> and <polyline> only, no <text> and no
// <circle> inside it, every stroke `vectorEffect="non-scaling-stroke"` so the
// horizontal squash never thickens a line. Non-negotiables 5 and 6 (visibility
// guard, `data-cb-layer`) are about canvases on the animation frame; this draws
// once per model change and has nothing to gate.
//
// DEPARTURES FROM v2, all deliberate:
//   · No `data-cap-center` / `data-cap-swatch` and no absolutely-positioned
//     swatch. Those exist to work around html2canvas drawing every text run at
//     its own probed baseline; v3's shell/snapshot.ts has no html2canvas, so a
//     plain inline-flex chip is centred in the PNG because it is centred on the
//     page. The workaround came out with the library it was for.
//   · No watermark prop. v2 stamped /cb-edge-logo.png over the popout's plot so
//     it rode into the screenshot; v3's snapshot bakes its own titled band.
//   · No `reverse` param on stepRun — v2 carried one and never passed it true.
//   · Every array read is bound and guarded rather than indexed twice. v3
//     compiles under `noUncheckedIndexedAccess`, so `arr[s]` is `T | undefined`
//     however sure the loop bound made us; the binding is what narrows it.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react'
import { ES_CANDLE_UP, LEVEL_COLORS, T, alpha } from '@/design/theme'
import {
  type DaySlice,
  type LogView,
  VIEW_LEVELS,
  WALL_SLOTS,
  type WallLevel,
  dowName,
  inView,
  mdShort,
  slotAtMins,
  slotClock,
  wallNum,
  wallStrike,
} from '@/pages/levelLog/wallData'

/**
 * Chart body height in px, and the breathing room inside it. The body is taller
 * than the post-market recap's 190 it was ported from, because this chart draws
 * a whole session of steps against a 1-minute tape and at 190 the walls sat
 * within a few pixels of price all day.
 */
export const MIG_H = 250
const MIG_PAD = 8

/** Painted size of a legend colour swatch — border included (border-box). */
const LEGEND_SWATCH = 11

const LEVEL_LABEL: Record<WallLevel, string> = {
  call_wall: 'Call Wall',
  put_wall: 'Put Wall',
  cb: 'CORE',
}

/**
 * Deliberately NOT `LEVEL_COLORS.cw` for the call wall. That token is blue, and
 * blue beside a red put wall does not read as the up side — v2 made the same
 * call for the same reason and reached for the candle up colour. Gold CORE,
 * green call wall, red put wall.
 */
const LEVEL_COLOR: Record<WallLevel, string> = {
  call_wall: ES_CANDLE_UP,
  put_wall: LEVEL_COLORS.pw,
  cb: LEVEL_COLORS.cb,
}

/** Which wall a role-model line IS at a given slot. */
type WallSide = 'call' | 'put'

/** One day reduced to what the drawing needs. */
type DaySeg = {
  date: string
  series: Map<WallLevel, (number | null)[]>
  /**
   * The two ROLES — CORE (the heavier wall) and OTHER (the lighter one), with
   * the side OTHER currently is so it can be drawn in that wall's colour. Null
   * on the views where there is nothing to resolve.
   */
  roles: { core: (number | null)[]; other: (number | null)[]; side: (WallSide | null)[] } | null
  spotPts: { s: number; v: number }[]
  spotDrawn: { s: number; v: number }[]
  dense: boolean
  lastSlot: number
  lastWrite: number
}

/** What the legend can switch off — the three levels plus the price line. */
type MigKey = WallLevel | 'spot'

export interface WallMigrationChartProps {
  days: DaySlice[]
  view: LogView
  /** Plot height in px, and the viewBox's y extent. */
  height?: number
  /**
   * Stretch the plot to the height of its container instead of that fixed px.
   * The viewBox is unchanged and `preserveAspectRatio` is already "none", so
   * this is a pure vertical scale — what the card uses when it is expanded to
   * the page stage.
   */
  fill?: boolean
  /**
   * PLOT ONLY — no head, no legend, no clock rail, no toggles.
   *
   * This is what the ticker rail's cards draw: the same model, the same steps,
   * the same forward fill, at 60-odd pixels inside a 200px tile. It is a prop on
   * THIS component rather than a second mini-chart module for one reason — the
   * model in the memo above (the forward fill, the CORE-sign role rule, the
   * shared y range) is the part that must never drift, and a "just a sparkline"
   * copy of it is exactly how two charts of the same data start disagreeing.
   *
   * The legend is what the compact card gives up, so the card's own header has
   * to carry the symbol and the numbers — see levelLog/TickerRail.tsx.
   */
  compact?: boolean
  /** An escape hatch for a host that wants its own full-size control. */
  onExpand?: () => void
}

export function WallMigrationChart({
  days,
  view,
  height = MIG_H,
  fill = false,
  compact = false,
  onExpand,
}: WallMigrationChartProps) {
  /**
   * Legend switches. Click a chip to drop that series out of the plot; click it
   * again to bring it back. Kept as the set of what is OFF so a level that only
   * appears later (a week fetch landing, the view switching) arrives visible.
   */
  const [off, setOff] = useState<Set<MigKey>>(() => new Set())
  const toggle = (k: MigKey) =>
    setOff((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  const model = useMemo(() => {
    const inSlot = (s: number) => Number.isFinite(s) && s >= 0 && s < WALL_SLOTS

    // Level types this view covers AND that have rows on at least one of the
    // days. Union, not intersection: a level that only exists on three of five
    // sessions should draw on those three, not be dropped from the week.
    const levels = VIEW_LEVELS[view].filter((lt) =>
      days.some((d) => d.log.some((r) => r.level_type === lt)),
    )
    if (!levels.length) return null

    const segs: DaySeg[] = []
    for (const day of days) {
      // Scoped to the view HERE rather than by the caller, so a chart handed
      // already-filtered rows and one handed a raw day count the same captures.
      // Idempotent on rows that were already filtered.
      const log = day.log.filter((r) => inView(view, r.level_type))
      const events = day.events.filter((e) => inView(view, e.level_type))
      const price = day.price

      // How much session the LOG wrote.
      let lastWrite = 0
      for (const r of log) if (inSlot(r.slot) && r.slot > lastWrite) lastWrite = r.slot
      for (const e of events) if (inSlot(e.hit_slot) && e.hit_slot > lastWrite) lastWrite = e.hit_slot

      /**
       * HOW FAR THE DAY DRAWS — the session, not the log.
       *
       * The x axis used to end at the last row `walls_log` wrote, and walls_log
       * is change-only. So a ticker whose walls stopped rolling at 10:00 drew a
       * half-hour chart and threw away the six hours of tape already in hand —
       * exactly backwards, because "the level sat while price travelled all day"
       * is the single most tradeable thing this panel can show.
       *
       * So the extent is the TAPE. Mid-session it ends at the last closed
       * minute, so the chart ends at now; on a past date it ends at 16:00. With
       * no tape `tapeEnd` is 0 and the extent falls back to the log.
       */
      const tapeAll = price
        .map((p) => ({ s: slotAtMins(p.mins), v: p.px }))
        .filter((p) => Number.isFinite(p.s) && p.s >= 0 && p.s <= WALL_SLOTS - 1 && p.v > 0)
      let tapeEnd = 0
      for (const p of tapeAll) if (p.s > tapeEnd) tapeEnd = p.s
      const lastSlot = Math.min(WALL_SLOTS - 1, Math.max(lastWrite, Math.ceil(tapeEnd)))

      // Forward-fill: at slot s a level is whatever it was last written as.
      const series = new Map<WallLevel, (number | null)[]>()
      for (const lt of levels) {
        const rows = log
          .filter((r) => r.level_type === lt && inSlot(r.slot) && Number.isFinite(Number(r.strike)))
          .sort((a, b) => a.slot - b.slot)
        if (!rows.length) continue
        const out: (number | null)[] = new Array(WALL_SLOTS).fill(null)
        let cur: number | null = null
        let i = 0
        for (let s = 0; s <= lastSlot; s++) {
          for (;;) {
            const row = rows[i]
            if (!row || row.slot > s) break
            cur = Number(row.strike)
            i++
          }
          out[s] = cur
        }
        series.set(lt, out)
      }

      /**
       * THE CORE-SIGN RULE, AS TWO ROLES.
       *
       * CORE is the single largest |net GEX| node on the chain, so it IS one of
       * the walls: positive gamma at that node makes it the call wall, negative
       * makes it the put wall. Drawing the matching wall beside it is the same
       * strike twice in two colours.
       *
       * Masking the matching wall out per slot was right about the rule and
       * wrong about the drawing — green and red kept blinking out mid-session,
       * so the eye read a level that had vanished rather than a role that had
       * swapped. TWO ROLES, NOT THREE LEVELS: CORE is the heavier wall, OTHER is
       * the lighter one, both run the whole session, and when dominance flips
       * the lines swap. OTHER carries the colour of the wall it currently IS.
       */
      const coreG: (number | null)[] = new Array(WALL_SLOTS).fill(null)
      {
        const gRows = log
          .filter(
            (r) =>
              r.level_type === 'cb' &&
              inSlot(r.slot) &&
              r.level_gex != null &&
              Number.isFinite(Number(r.level_gex)),
          )
          .sort((a, b) => a.slot - b.slot)
        let cur: number | null = null
        let i = 0
        for (let s = 0; s <= lastSlot; s++) {
          for (;;) {
            const row = gRows[i]
            if (!row || row.slot > s) break
            cur = Number(row.level_gex)
            i++
          }
          coreG[s] = cur
        }
      }

      const cwArr = series.get('call_wall')
      const pwArr = series.get('put_wall')
      const cbArr = series.get('cb')

      /**
       * Roles only exist where the CORE and at least one wall are both in play.
       * The WALLS view (no cb) and the CORE view (no walls) have nothing to
       * resolve and fall through to the plain per-level drawing below.
       */
      let roles: DaySeg['roles'] = null
      if (cbArr && (cwArr || pwArr)) {
        const core: (number | null)[] = new Array(WALL_SLOTS).fill(null)
        const other: (number | null)[] = new Array(WALL_SLOTS).fill(null)
        const side: (WallSide | null)[] = new Array(WALL_SLOTS).fill(null)
        for (let s = 0; s <= lastSlot; s++) {
          const c = cbArr[s]
          if (c == null) continue
          const a = cwArr?.[s] ?? null
          const b = pwArr?.[s] ?? null
          /**
           * WHICH WALL THE CORE IS. The strike itself answers it whenever CORE
           * is sitting on one — which is most slots. Failing that the recorded
           * gamma sign answers it. Failing that (a day whose cb rows predate
           * `level_gex`) the nearer wall does, which is never wrong by much and
           * is at least stable from slot to slot — a role that flickers is the
           * thing this model exists to stop.
           */
          let coreSide: WallSide
          if (a != null && c === a) coreSide = 'call'
          else if (b != null && c === b) coreSide = 'put'
          else {
            const g = coreG[s]
            if (g != null && g !== 0) coreSide = g > 0 ? 'call' : 'put'
            else if (a != null && b != null)
              coreSide = Math.abs(c - a) <= Math.abs(c - b) ? 'call' : 'put'
            else coreSide = a != null ? 'call' : 'put'
          }
          core[s] = c
          const o = coreSide === 'call' ? b : a
          if (o != null) {
            other[s] = o
            side[s] = coreSide === 'call' ? 'put' : 'call'
          }
        }
        if (core.some((v) => v != null)) roles = { core, other, side }
      }

      // Spot, from every capture that carried one. Events are written second so
      // a tag's spot_at_hit wins over the level row at the same slot — the tag
      // is the more precise reading of where price actually was.
      const spot: (number | null)[] = new Array(WALL_SLOTS).fill(null)
      for (const r of log) {
        if (inSlot(r.slot) && Number.isFinite(Number(r.spot)) && Number(r.spot) > 0) {
          spot[r.slot] = Number(r.spot)
        }
      }
      for (const e of events) {
        if (
          inSlot(e.hit_slot) &&
          Number.isFinite(Number(e.spot_at_hit)) &&
          Number(e.spot_at_hit) > 0
        ) {
          spot[e.hit_slot] = Number(e.spot_at_hit)
        }
      }
      const spotPts: { s: number; v: number }[] = []
      spot.forEach((v, s) => {
        if (v != null) spotPts.push({ s, v })
      })

      /**
       * WHICH PRICE GETS DRAWN. The 1-minute tape when it arrived, the log's own
       * captures when it did not — never the two spliced together, which would
       * put a smooth stretch next to a stepped one and read as the tape going
       * quiet rather than the data running out. Decided PER DAY, so one session
       * missing its tape does not downgrade the other four.
       */
      const tape = tapeAll.filter((p) => p.s <= lastSlot)
      const dense = tape.length >= 20
      const spotDrawn = dense ? tape : spotPts.map((p) => ({ s: p.s, v: p.v }))

      if (!series.size && !spotDrawn.length) continue
      segs.push({ date: day.date, series, roles, spotPts, spotDrawn, dense, lastSlot, lastWrite })
    }
    if (!segs.length) return null

    // ONE y range across every day drawn. Per-day scaling would make a week of
    // levels look flat by rescaling each session to its own range — the whole
    // point of the week view is seeing a wall hold its strike ACROSS days.
    const vals: number[] = []
    for (const seg of segs) {
      for (const arr of seg.series.values()) for (const v of arr) if (v != null) vals.push(v)
      for (const p of seg.spotDrawn) vals.push(p.v)
    }
    if (vals.length < 2) return null

    let lo = Math.min(...vals)
    let hi = Math.max(...vals)
    if (!(hi > lo)) {
      const c = lo || 1
      lo = c * 0.999
      hi = c * 1.001
    }
    const padY = (hi - lo) * 0.08
    lo -= padY
    hi += padY

    // What the LEGEND may offer. Under the role model a wall earns its chip by
    // being the OTHER line somewhere — a wall that is the CORE all session is
    // already on screen in gold and must not also take a chip that toggles
    // nothing.
    const roled = segs.some((seg) => seg.roles)
    const kept = levels.filter((lt) => {
      if (!roled) return segs.some((seg) => seg.series.has(lt))
      if (lt === 'cb') return true
      const want: WallSide = lt === 'call_wall' ? 'call' : 'put'
      return segs.some((seg) => seg.roles?.side.some((v) => v === want))
    })
    if (!kept.length) return null

    return { levels: kept, segs, lo, hi, roled }
  }, [days, view])

  if (!model) return null
  const { levels, segs, lo, hi, roled } = model
  const N = segs.length
  const segW = 100 / N
  const last = segs[N - 1]
  if (!last) return null

  /**
   * Index across what was recorded, edge to edge. Each day owns an equal SLICE
   * of the 100-wide viewBox and its own slots run edge to edge inside it. Equal
   * width per day, not equal minutes: the comparison the week view exists for is
   * "where did the levels sit each day", not "how long was each day".
   */
  const x = (i: number, s: number) => {
    const seg = segs[i]
    const span = seg ? Math.max(1, seg.lastSlot) : 1
    return i * segW + (s / span) * segW
  }
  /**
   * 8px of breathing room at 250, proportionally less on the rail's 62px tiles —
   * a fixed 8 top and bottom there would spend a quarter of the plot on margin
   * and flatten the very thing the mini chart is for.
   */
  const plotPad = Math.min(MIG_PAD, height * 0.08)
  const y = (v: number) => plotPad + (1 - (v - lo) / (hi - lo)) * (height - plotPad * 2)

  /**
   * Step, not slope — a level holds its strike until it rolls. Walks one DAY's
   * fill; never across a day boundary, which would draw a diagonal through an
   * overnight the level did not travel.
   */
  const stepRun = (i: number, arr: (number | null)[], a: number, b: number) => {
    const out: string[] = []
    let prev: number | null = null
    for (let s = a; s <= b; s++) {
      const v = arr[s]
      if (v == null) continue
      if (prev != null && v !== prev) out.push(`${x(i, s)},${y(prev)}`)
      out.push(`${x(i, s)},${y(v)}`)
      prev = v
    }
    return out
  }

  /**
   * A level's day as one polyline PER CONTIGUOUS RUN. One polyline for the whole
   * day was fine while the only gap was before the first capture — but the
   * CORE-sign rule punches holes mid-day, and a single polyline would bridge one
   * with a diagonal through strikes the wall never held while it was suppressed.
   */
  const stepRuns = (i: number, arr: (number | null)[] | undefined): string[] => {
    const seg = segs[i]
    if (!arr || !seg) return []
    const out: string[] = []
    const L = seg.lastSlot
    let s = 0
    while (s <= L) {
      if (arr[s] == null) {
        s++
        continue
      }
      const a = s
      while (s <= L && arr[s] != null) s++
      const pts = stepRun(i, arr, a, s - 1)
      if (pts.length) out.push(pts.join(' '))
    }
    return out
  }

  /** Last written value of a level across the whole span — the legend's number. */
  const lastOf = (lt: WallLevel): number | null => {
    for (let i = N - 1; i >= 0; i--) {
      const seg = segs[i]
      const arr = seg?.series.get(lt)
      if (!seg || !arr) continue
      for (let s = seg.lastSlot; s >= 0; s--) {
        const v = arr[s]
        if (v != null) return v
      }
    }
    return null
  }

  /**
   * THE TWO LINES.
   *
   * Under the role model there are exactly two: CORE in gold, thick, running the
   * whole session; and OTHER, drawn as one polyline per contiguous same-side
   * stretch so it carries the colour of the wall it currently is. Each stretch
   * joins the next at the vertical edge of the swap, so the line is continuous
   * through a role change — the swap reads as a colour change at a step, not as
   * two levels disappearing.
   *
   * SWITCHING CORE OFF DROPS THE ROLE MODEL WITH IT. The whole reason CORE
   * suppresses a wall is that it IS that wall. With CORE hidden there is no
   * double, so there is nothing left to suppress: both walls go back to their
   * own recorded series and each runs the full span.
   */
  const drawOrder: WallLevel[] = ['put_wall', 'call_wall', 'cb']
  const drawn = drawOrder.filter((lt) => levels.includes(lt))
  const paths: { key: string; d: string; color: string; w: number }[] = []
  if (roled && !off.has('cb')) {
    segs.forEach((seg, i) => {
      const r = seg.roles
      if (!r) return
      const L = seg.lastSlot
      let s = 0
      let k = 0
      while (s <= L) {
        const sd = r.side[s]
        if (r.other[s] == null || sd == null) {
          s++
          continue
        }
        const a = s
        while (s <= L && r.other[s] != null && r.side[s] === sd) s++
        const b = s - 1
        const lt: WallLevel = sd === 'call' ? 'call_wall' : 'put_wall'
        if (!off.has(lt)) {
          const pts = stepRun(i, r.other, a, b)
          // Carry the run to the next slot's value, so consecutive runs meet at
          // the vertical edge instead of leaving a slot-wide hole between them.
          const held = r.other[b]
          const nx = r.other[b + 1]
          if (pts.length && held != null && nx != null && b + 1 <= L) {
            pts.push(`${x(i, b + 1)},${y(held)}`, `${x(i, b + 1)},${y(nx)}`)
          }
          if (pts.length) {
            paths.push({ key: `other-${i}-${k}`, d: pts.join(' '), color: LEVEL_COLOR[lt], w: 1.8 })
          }
        }
        k++
      }
      // No `off.has("cb")` guard: this branch only runs while CORE is on.
      stepRuns(i, r.core).forEach((d, j) => {
        paths.push({ key: `core-${i}-${j}`, d, color: LEVEL_COLOR.cb, w: 2.2 })
      })
    })
  } else {
    for (const lt of drawn) {
      if (off.has(lt)) continue
      segs.forEach((seg, i) => {
        stepRuns(i, seg.series.get(lt)).forEach((d, k) => {
          paths.push({
            key: `${lt}-${i}-${k}`,
            d,
            color: LEVEL_COLOR[lt],
            w: lt === 'cb' ? 2.2 : 1.8,
          })
        })
      })
    }
  }

  const spotLines = off.has('spot')
    ? []
    : segs
        .map((seg, i) => ({
          key: `spot-${i}`,
          d: seg.spotDrawn.map((p) => `${x(i, p.s)},${y(p.v)}`).join(' '),
        }))
        .filter((c) => c.d)

  /** x of the last written slot on the LIVE day, only when it runs past it. */
  const heldFrom = last.lastWrite < last.lastSlot ? x(N - 1, last.lastWrite) : null

  const totalPts = segs.reduce((n, seg) => n + (seg.dense ? seg.spotDrawn.length : 0), 0)
  const totalCaps = segs.reduce((n, seg) => n + seg.spotPts.length, 0)
  const anyDense = segs.some((seg) => seg.dense)

  /**
   * HOW OFTEN THE TAPE SAMPLES, in minutes, read off the data rather than
   * assumed. The caption used to print the point count as "N min of price",
   * which was true only while every tape was the dxFeed 1-minute one. The week
   * view now takes its price from /api/walls-range — `scanner_snapshots.spot`
   * at 5 minutes — so a 78-point session would have read as 78 minutes of a
   * 390-minute day.
   *
   * `s` is a FRACTIONAL SLOT and slots 1…26 are 15 minutes apart, so a gap in
   * slots × 15 is the gap in minutes. Measured across the middle of the first
   * dense day, past the 09:29→09:45 slot 0 seam, which is its own 16-minute
   * scale and would otherwise be the number that got measured.
   */
  const cadenceMin = (() => {
    const pts = segs.find((s) => s.dense)?.spotDrawn
    if (!pts || pts.length < 4) return null
    const a = pts[Math.floor(pts.length / 2)]
    const b = pts[Math.floor(pts.length / 2) + 1]
    if (!a || !b) return null
    const m = Math.round((b.s - a.s) * 15)
    return m >= 1 && m <= 60 ? m : null
  })()

  /**
   * A small square swatch, the level in sentence case, and the strike it
   * currently sits on. Each chip is also the series' SWITCH — three levels and a
   * price line inside 250px is a lot of ink for one question, and the question
   * is usually about one of them. Off reads as off: the swatch hollows out and
   * the whole chip dims, rather than the row looking identical to a chart that
   * simply had no data.
   */
  const legendChip = (key: MigKey, color: string, label: string, value: string) => {
    const on = !off.has(key)
    return (
      <button
        key={key}
        type="button"
        onClick={() => toggle(key)}
        aria-pressed={on}
        title={on ? `Hide ${label}` : `Show ${label}`}
        className={[
          'inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm text-xs transition-opacity',
          on ? 'text-fg' : 'text-muted opacity-40 hover:opacity-70',
        ].join(' ')}
      >
        <span
          aria-hidden
          className="block shrink-0 rounded-sm border"
          style={{
            width: LEGEND_SWATCH,
            height: LEGEND_SWATCH,
            boxSizing: 'border-box',
            background: on ? color : 'transparent',
            borderColor: color,
          }}
        />
        <span>{label}</span>
        <span className="tabular font-mono">{value}</span>
      </button>
    )
  }

  const lastPt = last.spotDrawn[last.spotDrawn.length - 1]
  const lastSpot = lastPt ? lastPt.v : null

  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col' : 'flex flex-col'}>
      {compact ? null : (
      <div className="mb-1.5 flex flex-wrap items-baseline gap-3">
        <span className="text-xs font-extrabold uppercase tracking-widest text-fg">
          Wall migration
        </span>
        <span className="tabular font-mono text-xs text-muted">
          {N > 1 ? `${N} sessions · ` : ''}recorded levels ·{' '}
          {anyDense
            ? cadenceMin
              ? `${totalPts.toLocaleString()} × ${cadenceMin}m price`
              : `${totalPts.toLocaleString()} price points`
            : `${totalCaps} spot capture${totalCaps === 1 ? '' : 's'}`}
        </span>
        {onExpand ? (
          <button
            type="button"
            onClick={onExpand}
            title="Open this chart full size"
            className="ml-auto rounded-sm border border-line px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide text-fg transition-colors hover:bg-raised"
          >
            <span aria-hidden>⤢</span> Expand
          </button>
        ) : null}
      </div>
      )}

      {/* Its own legend, under the head and above the plot. The card title says
          nothing about these series — which is exactly how a CORE line reads as
          an unexplained squiggle. */}
      {compact ? null : (
      <div className="mb-1.5 flex flex-wrap items-center gap-3.5">
        {drawn.map((lt) => legendChip(lt, LEVEL_COLOR[lt], LEVEL_LABEL[lt], wallStrike(lastOf(lt))))}
        {lastSpot != null ? legendChip('spot', T.text, 'spot', wallNum(lastSpot)) : null}
      </div>
      )}

      {/* preserveAspectRatio="none" — the x axis is slots, the y axis is price,
          and the two have no business sharing a scale. Every stroke carries
          vectorEffect so the squash never thickens a line, and there is no
          <text> or <circle> inside for the same reason. */}
      <div className={fill ? 'relative min-h-0 flex-1' : 'relative'}>
        <svg
          viewBox={`0 0 100 ${height}`}
          height={fill ? undefined : height}
          preserveAspectRatio="none"
          style={
            fill
              ? { width: '100%', height: '100%', display: 'block' }
              : { width: '100%', display: 'block' }
          }
        >
          {/* Session boundaries. Solid, unlike the dashed "log stopped writing"
              mark, because they are a different kind of edge: one is a gap in
              the clock, the other a gap in the rows. */}
          {segs.slice(1).map((seg, k) => (
            <line
              key={`div-${seg.date}`}
              x1={(k + 1) * segW}
              x2={(k + 1) * segW}
              y1={0}
              y2={height}
              stroke={alpha(T.text, 0.22)}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* Where the log stopped writing. Everything right of it is the
              forward fill — the levels held, which is why there are no rows —
              and the reader is entitled to see which half is captures and which
              is hold. */}
          {heldFrom != null ? (
            <line
              x1={heldFrom}
              x2={heldFrom}
              y1={0}
              y2={height}
              stroke={alpha(T.text, 0.16)}
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {paths.map((p) => (
            <polyline
              key={p.key}
              points={p.d}
              fill="none"
              stroke={p.color}
              strokeWidth={p.w}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="miter"
            />
          ))}
          {/* Spot last, so it reads on top of the levels it is compared with. */}
          {spotLines.map((c) => (
            <polyline
              key={c.key}
              points={c.d}
              fill="none"
              stroke={T.text}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>

      {/* One clock rail for a single session; one date stamp per slice for a
          week, because 09:29/12:45/16:00 repeated five times says nothing. */}
      {compact ? null : N === 1 ? (
        <div className="tabular mt-1 flex justify-between font-mono text-2xs text-muted" aria-hidden>
          <span>{slotClock(0)}</span>
          <span>{slotClock(Math.round(last.lastSlot / 2))}</span>
          <span>{slotClock(last.lastSlot)}</span>
        </div>
      ) : (
        <div className="mt-1 flex text-muted" aria-hidden>
          {segs.map((seg) => (
            <span key={seg.date} className="block text-center" style={{ flex: `0 0 ${segW}%` }}>
              <span className="block text-2xs font-extrabold uppercase tracking-widest text-fg">
                {dowName(seg.date)}
              </span>
              <span className="tabular block font-mono text-2xs">{mdShort(seg.date)}</span>
            </span>
          ))}
        </div>
      )}

      {/* No caption under the plot. The legend names every series and the page
          head carries the scope, and a paragraph under a 250px plot was taller
          than half the plot. */}
    </div>
  )
}
