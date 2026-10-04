// ─────────────────────────────────────────────────────────────────────────────
// CB EDGE STUDIES — Market Profile (TPO), drawn on the chart per session.
//
// The plan in md files/TPO-ENGINE-PLAN.md, computed from the chart's own bars:
// each session is cut into 30-minute periods (TPO letters), price into rows;
// a row's count is how many periods traded through it. Drawn as a horizontal
// histogram at the session's start (one bar's width per TPO, scaled to fit the
// session), with
//   · POC  — the row with the most TPOs (ties: the one nearest the middle)
//   · VAH / VAL — the value area, grown from the POC one row at a time toward
//            the heavier side until it holds 70% (setting) of the TPOs
//   · naked POCs — an older session's POC that price has not traded back to
//            runs right until it is touched (or to now)
// Regular hours by default (09:30–16:00; a futures chart too), or the full
// session. Re-drawn as the forming bar moves, so today's profile builds live.
// ─────────────────────────────────────────────────────────────────────────────

import type { DrawingBox, DrawingLabel, DrawingLine, OHLCV } from '@luxalgo/vela'
import { tokenHexAlpha } from '@/design/theme'
import { DAY_MS, MIN_MS, bool, studyImpl, etDateKey, int, isRthBar, labelAt, sessionKey, sessionsOf, str } from './common'
import { SESSION_BASIS as BASIS_OPTS, TPO_PERIODS as PERIOD_OPTS, TPO_TYPE } from './index'



interface TpoS {
  sessions: number
  row: number | null
  periodMin: number
  va: number
  lines: boolean
  naked: boolean
  full: boolean
  opacity: number
}

export interface Profile {
  start: number
  end: number
  step: number
  lo: number
  counts: number[]
  poc: number
  vah: number
  val: number
  maxCount: number
}

const NICE = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10, 25, 50, 100, 250, 500]

/** The profile of one session's bars. Exported for the bench. */
export function profileOf(bars: readonly OHLCV[], tfMs: number, periodMs: number, rowSize: number | null, vaPct: number, minTick: number): Profile | null {
  if (!bars.length) return null
  const start = bars[0]!.time
  const end = bars[bars.length - 1]!.time + tfMs
  // each period's range: the union of its bars'
  const periods: { lo: number; hi: number }[] = []
  let H = -Infinity
  let L = Infinity
  for (const b of bars) {
    const p = Math.floor((b.time - start) / periodMs)
    const cur = periods[p]
    if (cur) {
      cur.lo = Math.min(cur.lo, b.low)
      cur.hi = Math.max(cur.hi, b.high)
    } else periods[p] = { lo: b.low, hi: b.high }
    H = Math.max(H, b.high)
    L = Math.min(L, b.low)
  }
  if (!(H >= L)) return null
  const raw = (H - L) / 40
  const step = rowSize ?? NICE.find((x) => x >= raw && x >= minTick) ?? 500
  const lo = Math.floor(L / step) * step
  const rows = Math.max(1, Math.ceil((H - lo) / step + 1e-9))
  const counts = new Array<number>(rows).fill(0)
  for (const p of periods) {
    if (!p) continue
    const a = Math.max(0, Math.floor((p.lo - lo) / step + 1e-9))
    const z = Math.min(rows - 1, Math.floor((p.hi - lo) / step - 1e-9))
    for (let r = a; r <= Math.max(a, z); r++) counts[r]!++
  }
  const maxCount = Math.max(...counts)
  const midRow = (rows - 1) / 2
  let poc = 0
  for (let r = 0; r < rows; r++) {
    if (counts[r]! > counts[poc]! || (counts[r] === counts[poc] && Math.abs(r - midRow) < Math.abs(poc - midRow))) poc = r
  }
  // the value area: from the POC toward the heavier neighbour, a row at a time
  const total = counts.reduce((a, b) => a + b, 0)
  let up = poc
  let dn = poc
  let inVa = counts[poc]!
  while (inVa < (total * vaPct) / 100 && (up < rows - 1 || dn > 0)) {
    const above = up < rows - 1 ? counts[up + 1]! : -1
    const below = dn > 0 ? counts[dn - 1]! : -1
    if (above >= below) inVa += counts[++up]!
    else inVa += counts[--dn]!
  }
  return { start, end, step, lo, counts, poc, vah: up, val: dn, maxCount }
}

export const tpoImpl = studyImpl<TpoS, null>({
  everyTick: true,
  settings: (i) => {
    const row = str(i.row, 'Auto')
    return {
      sessions: int(i.sessions, 3, 1, 15),
      row: row === 'Auto' ? null : Number(row) || null,
      periodMin: Number(str(i.period, PERIOD_OPTS[0]).split(' ')[0]) || 30,
      va: int(i.va, 70, 50, 95),
      lines: bool(i.lines, true),
      naked: bool(i.naked, true),
      full: str(i.basis, BASIS_OPTS[0]) === BASIS_OPTS[1],
      opacity: int(i.opacity, 35, 5, 90),
    }
  },
  render: (c, s) => {
    const { bars, tfMs } = c
    if (!bars.length || tfMs >= DAY_MS || tfMs > s.periodMin * MIN_MS) return {}
    const fut = c.sym.kind === 'futures'
    const minTick = fut ? 0.25 : 0.01
    const sessions = sessionsOf(bars, (t) => (s.full ? sessionKey(t, fut) : etDateKey(t)))
    const T = TPO_TYPE
    const a = s.opacity / 100
    // A profile is a measurement: slate value area, Paper POC. No reserved hue
    // (the CB gold POC is Voltick's Volt).
    const cVa = tokenHexAlpha('--color-vt-slate', a)
    const cOut = tokenHexAlpha('--color-vt-quiet', a * 0.45)
    const cPoc = tokenHexAlpha('--color-vt-paper', Math.min(1, a + 0.25))
    const cPocLine = tokenHexAlpha('--color-vt-paper', 0.9)
    const cVaLine = tokenHexAlpha('--color-vt-slate', 0.95)
    const boxes: DrawingBox[] = []
    const lines: DrawingLine[] = []
    const labels: DrawingLabel[] = []
    const lastT = bars[bars.length - 1]!.time
    const line = (key: string, x1: number, x2: number, y: number, color: string, dashed: boolean, width = 1.3): DrawingLine => ({
      id: `${T}:${key}`,
      paneId: '',
      xloc: 'bar_time',
      x1,
      y1: y,
      x2,
      y2: y,
      extend: 'none',
      color,
      invisible: false,
      width,
      style: dashed ? 'dashed' : 'solid',
      arrowLeft: false,
      arrowRight: false,
      overlay: true,
    })
    const hasRth = (ss: { from: number; to: number }) => {
      for (let i = ss.from; i <= ss.to; i++) if (isRthBar(bars[i]!.time)) return true
      return false
    }
    const drawn = sessions.filter((ss) => s.full || hasRth(ss)).slice(-s.sessions)
    drawn.forEach((ss, si) => {
      const own: OHLCV[] = []
      for (let i = ss.from; i <= ss.to; i++) if (s.full || isRthBar(bars[i]!.time)) own.push(bars[i]!)
      const p = profileOf(own, tfMs, s.periodMin * MIN_MS, s.row, s.va, minTick)
      if (!p) return
      const unit = Math.min(tfMs, ((p.end - p.start) * 0.6) / Math.max(1, p.maxCount))
      p.counts.forEach((n, r) => {
        if (!n) return
        const y0 = p.lo + r * p.step
        boxes.push({
          id: `${T}:${ss.key}:${r}`,
          paneId: '',
          xloc: 'bar_time',
          left: p.start,
          right: p.start + n * unit,
          top: y0 + p.step,
          bottom: y0,
          extend: 'none',
          bgColor: r === p.poc ? cPoc : r >= p.val && r <= p.vah ? cVa : cOut,
          borderWidth: 0,
          borderStyle: 'solid',
          textSize: 'auto',
          hAlign: 'left',
          vAlign: 'center',
          wrap: false,
          fontFamily: 'default',
          bold: false,
          italic: false,
          overlay: true,
        })
      })
      const pocY = p.lo + (p.poc + 0.5) * p.step
      const vahY = p.lo + (p.vah + 1) * p.step
      const valY = p.lo + p.val * p.step
      if (s.lines) {
        lines.push(line(`${ss.key}:poc`, p.start, p.end, pocY, cPocLine, false, 1.6))
        lines.push(line(`${ss.key}:vah`, p.start, p.end, vahY, cVaLine, true))
        lines.push(line(`${ss.key}:val`, p.start, p.end, valY, cVaLine, true))
      }
      const latest = si === drawn.length - 1
      if (s.naked && !latest) {
        // runs right from the session's end until a later bar trades through it
        let touch = lastT
        for (let i = ss.to + 1; i < bars.length; i++) {
          const b = bars[i]!
          if (b.low <= pocY && b.high >= pocY) {
            touch = b.time
            break
          }
        }
        if (touch > p.end || touch === lastT) lines.push(line(`${ss.key}:npoc`, p.end, touch, pocY, tokenHexAlpha('--color-vt-paper', 0.9), true, 1))
      }
      if (latest) {
        for (const [k, y, txt, col] of [
          ['poc', pocY, 'POC', cPocLine],
          ['vah', vahY, 'VAH', cVaLine],
          ['val', valY, 'VAL', cVaLine],
        ] as const)
          labels.push(labelAt(T, `tag-${k}`, lastT, y, `${txt} ${y.toFixed(2)}`, col, { textColor: col, noFill: true }))
      }
    })
    return { boxes, lines, labels }
  },
})
