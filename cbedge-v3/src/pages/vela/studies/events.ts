// ─────────────────────────────────────────────────────────────────────────────
// CB EVENTS: economic releases, the engine's alerts and your script alerts as
// marks along the bottom of the chart (Brandon, 2026-10-04: E1 with a settings
// menu; mockup generated/2026-10-04-vela-events-r2.html).
//
// A study, so it has what every study has: a legend row with ◉ / ⚙ / ✕, a
// settings dialog, and a place in the saved layout per chart. Vela.tsx gives it
// to each chart once; ✕ takes it off and Indicators → Events puts it back.
//
//   inputs   one switch per kind (EV_KINDS, studies/index.ts: high / medium /
//            low releases, Volt, Flip, IB, Whale, Top GEX, script alerts) and
//            the size (Small 14px, Medium 16px, Large 20px). On the desktop the
//            legend card's ⚙ on the Events row opens a menu of the same switches.
//   data     marks.ts: the week's releases, the engine's alerts for the chart's
//            symbol, your scripts' alerts. One read for every chart; re-read
//            every minute while the chart is live.
//   drawing  eventsLayer.ts, a renderer layer: one mark per moment along the
//            bottom of the price pane, a count where several crowd one spot,
//            a hover line, and a card on click.
//
// WHERE A MARK GOES. On the bar whose span holds its moment; a moment in a gap
// (an 08:30 release on a regular-hours chart) goes to the next bar. A moment
// after the newest bar (a release later this week) goes into the space to the
// right, as many bars out as the session calendar says it is (cbedgeProvider
// sessionWindows: the chart's own session, RTH or ETH).
//
// BAR REPLAY: nothing after the replay clock is drawn, so a replay does not show
// a release's number before it came out.
// ─────────────────────────────────────────────────────────────────────────────

import { sessionWindows } from '@/pages/vela/cbedgeProvider'
import { eventMarksFor, refreshEventFeeds, type EventMark } from '@/pages/vela/marks'
import { DAY_MS, MIN_MS, etDateKey, provideLayer, studyImpl, weekKey, type StudyCtx } from './common'
import { publishEventsCount } from './eventsHost'
import { EventsLayer, type EventsPayload } from './eventsLayer'
import { EVENTS_TYPE, EV_KINDS, EV_SIZES, type EvKind } from './index'

provideLayer(EVENTS_TYPE, () => new EventsLayer())

const SIZE_PX: Record<(typeof EV_SIZES)[number], number> = { Small: 14, Medium: 16, Large: 20 }

interface Settings {
  on: Record<EvKind, boolean>
  px: number
}

/** How many bars past the newest one `t` lands, by the session calendar. */
function barsAhead(c: StudyCtx, lastOpen: number, t: number): number {
  const tf = Math.max(MIN_MS, c.tfMs)
  const from = lastOpen + tf
  if (t < from) return 0
  if (tf >= DAY_MS) {
    // daily and longer: trading days (weekdays) out
    let n = 0
    for (let d = from; d <= t && n < 400; d += DAY_MS) {
      const wd = new Date(`${etDateKey(d)}T12:00:00Z`).getUTCDay()
      if (wd !== 0 && wd !== 6) n++
    }
    return Math.max(1, Math.ceil(n / Math.max(1, Math.round(tf / DAY_MS))))
  }
  const session = c.sym.kind === 'index' ? 'regular' : c.ctx.session === 'extended' ? 'extended' : 'regular'
  let minutes = 0
  for (const [s, e] of sessionWindows(c.sym.kind, from, t, session)) minutes += Math.max(0, e - s) / MIN_MS
  return 1 + Math.floor(minutes / (tf / MIN_MS))
}

export const eventsImpl = studyImpl<Settings, number>({
  settings: (inputs) => {
    const on = {} as Record<EvKind, boolean>
    for (const k of EV_KINDS) on[k.key] = typeof inputs[k.key] === 'boolean' ? (inputs[k.key] as boolean) : k.defval
    const size = typeof inputs.size === 'string' && inputs.size in SIZE_PX ? (inputs.size as keyof typeof SIZE_PX) : 'Medium'
    return { on, px: SIZE_PX[size] }
  },
  load: (_c, _s, fresh) => refreshEventFeeds(fresh),
  refreshMs: 60_000,
  // the marks are a layer of their own; nothing goes through Vela's drawing primitives
  render: () => ({}),
  layer: (c, s): EventsPayload | null => {
    const id = c.ctx.id
    const bars = c.bars
    const n = bars.length
    if (!n) {
      publishEventsCount(id, 0)
      return null
    }
    const tf = Math.max(MIN_MS, c.tfMs)
    const out: EventsPayload['marks'] = []
    const thisWeek = weekKey(etDateKey(Date.now()))
    let week = 0
    const first = bars[0]!.time
    const lastOpen = bars[n - 1]!.time
    let i = 0
    for (const m of eventMarksFor(c.ticker)) {
      if (!s.on[m.kind] || m.t < first || m.t > c.until) continue
      // bars and marks both ascend: walk forward to the last bar opening at or before it
      while (i < n - 1 && bars[i + 1]!.time <= m.t) i++
      let li: number
      if (m.t < bars[i]!.time + tf) li = i
      else if (i < n - 1) li = i + 1
      else li = n - 1 + barsAhead(c, lastOpen, m.t)
      out.push({ m, li })
      if (weekKey(etDateKey(m.t)) === thisWeek) week++
    }
    publishEventsCount(id, week)
    return { id, px: s.px, marks: out }
  },
})

export type { EventMark }
