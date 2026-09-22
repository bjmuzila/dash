import { useEffect, useMemo, useState } from 'react'
import { LEVEL_COLORS, T, alpha } from '@/design/theme'
import { useAlertsFeed } from '@/shell/AlertsFeed'
import type { AlertKind } from '@/shell/alertTypes'
import { ALERT_TYPES, TYPE_BY_ID, fetchMasterEnabled, readShown, writeShown } from '@/shell/alertTypes'
import { MobileShell } from '../MobileShell'
import type { AlertType } from '@/shell/alertTypes'

// PHONE-ONLY COLOUR OVERRIDES. Whales read in CB gold here (the desktop panel
// keeps the catalogue's colour), and the ticker is inked by the print's lean —
// up for bullish, down for bearish — falling back to the type colour when the
// detector has no side.
const WHALE_GOLD = LEVEL_COLORS.cb
const colorOf = (t: AlertType) => (t.id === 'whale' ? WHALE_GOLD : t.color)
const tickerInk = (bias: 'bullish' | 'bearish' | undefined, t: AlertType) =>
  bias === 'bullish' ? T.green : bias === 'bearish' ? T.red : colorOf(t)

// ─────────────────────────────────────────────────────────────────────────────
// /m/alerts — THE SIGNAL FEED, phone edition.
//
// WHY THIS ONE IS A PHONE SCREEN AND NOT A CARD. Every other tab in
// src/mobile/mobileNav.ts is a home-board card mounted full-bleed, and that rule
// stands. The alerts feed has no card: on the desktop it is TOOLBAR CHROME — a
// pill in src/shell/Shell.tsx that opens a 28rem dropdown
// (src/shell/AlertsPanel.tsx, `absolute` under its trigger). Shell.tsx drops the
// whole toolbar on /m/*, so on a phone that surface is not merely cramped, it is
// unreachable. A tab is the only door.
//
// NOTHING IS RE-IMPLEMENTED. The three things that could drift are all imported:
//   • the POLL   — `useAlertsFeed` from AlertsFeed.tsx (GET /proxy/signals, 20s,
//                  visibility-gated, same row→AlertItem mapping)
//   • the CATALOGUE — ALERT_TYPES / TYPE_BY_ID, so a new detector added to
//                  alertTypes.ts appears here the same build it appears there
//   • the STATE  — readShown/writeShown (`alerts:shown`) and
//                  fetchMasterEnabled (GET /proxy/signal-alerts), so a filter
//                  set on the desktop is the filter this screen opens with.
// What is local is LAYOUT ONLY: a dropdown anchored to a toolbar button cannot
// be a full-height screen, and a 390px column wants bigger rows than a menu.
//
// NOT `fill`: this is a list, it owns no drag gesture, and it scrolls.
// ─────────────────────────────────────────────────────────────────────────────

// 28px tall, which clears the 44px tap floor once the row's padding is counted.
// The chips WRAP onto a second line rather than scrolling sideways — nothing on
// this screen scrolls horizontally.
const CHIP =
  'shrink-0 cursor-pointer select-none whitespace-nowrap rounded-full border px-2 py-[3px] text-3xs font-bold uppercase tracking-wide outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed'

export default function MAlerts() {
  const items = useAlertsFeed()
  const [shown, setShown] = useState<AlertKind[]>(() => readShown())
  // null until the ask returns, and null means "assume armed" — a dropped
  // connection must never read as "CB Edge turned everything off".
  const [master, setMaster] = useState<Record<string, boolean> | null>(null)

  useEffect(() => {
    let alive = true
    void fetchMasterEnabled().then((m) => {
      if (alive && m) setMaster(m)
    })
    return () => {
      alive = false
    }
  }, [])

  const isLive = (id: AlertKind) => master?.[TYPE_BY_ID[id].serverKey] ?? true

  const toggleShown = (id: AlertKind) => {
    setShown((prev) => {
      const next = prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]
      writeShown(next)
      return next
    })
  }

  const liveTypes = ALERT_TYPES.filter((t) => isLive(t.id))
  const allShown = liveTypes.every((t) => shown.includes(t.id))
  const setAll = () => {
    const next = allShown ? [] : ALERT_TYPES.map((t) => t.id)
    writeShown(next)
    setShown(next)
  }

  const visible = useMemo(
    () => items.filter((a) => shown.includes(a.kind) && isLive(a.kind)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, shown, master],
  )

  // Three different empty screens, and saying WHICH is the whole job of the line.
  const emptyNote =
    items.length === 0
      ? 'No signals yet today.'
      : liveTypes.length === 0
        ? 'Every signal is switched off by CB Edge right now.'
        : 'Nothing matches those filters.'

  const chips = (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={setAll}
        className={CHIP}
        style={
          allShown
            ? { borderColor: T.cyan, color: T.cyan, background: alpha(T.cyan, 0.11) }
            : { borderColor: T.border, color: T.text }
        }
      >
        All
      </button>
      {ALERT_TYPES.map((t) => {
        const live = isLive(t.id)
        const on = live && shown.includes(t.id)
        return (
          <button
            key={t.id}
            type="button"
            disabled={!live}
            title={live ? undefined : 'Switched off by CB Edge'}
            onClick={() => toggleShown(t.id)}
            className={CHIP}
            style={
              on
                ? { borderColor: colorOf(t), color: colorOf(t), background: alpha(colorOf(t), 0.11) }
                : {
                    borderColor: T.border,
                    color: T.text,
                    opacity: live ? 1 : 0.5,
                    textDecoration: 'line-through',
                  }
            }
          >
            {t.short}
          </button>
        )
      })}
    </div>
  )

  const count =
    visible.length > 0 ? (
      <span className="rounded-full bg-warn px-1.5 text-3xs font-bold leading-[15px] text-bg">
        {visible.length}
      </span>
    ) : undefined

  return (
    <MobileShell title="Signal Alerts" right={count} sticky={chips}>
      {visible.length === 0 ? (
        <p className="px-4 py-10 text-center text-xs text-fg opacity-80">{emptyNote}</p>
      ) : (
        <ul className="min-h-0 overflow-x-hidden">
          {visible.map((a) => {
            const t = TYPE_BY_ID[a.kind]
            return (
              <li
                key={a.id}
                // A phone row is read, not hovered. More vertical padding than
                // the desktop menu gets, and the type's colour carried on a left
                // edge rather than a 6px dot — at arm's length the bar is the
                // thing you sort the list by.
                className="flex gap-2.5 border-b border-line px-3 py-2.5"
                style={{ boxShadow: `inset 3px 0 0 0 ${colorOf(t)}` }}
              >
                <div className="min-w-0 flex-1">
                  {/* Same order as the desktop panel, and for the same
                      reason: ticker first, title biggest, the detector's
                      sentence underneath it. At arm's length the symbol and the
                      colour bar are the two things that survive. */}
                  {/* Ticker + time on one line, the title on its own line
                      beneath — nothing competes for the row's width, so
                      nothing overlaps or runs off the side. */}
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className="shrink-0 text-base font-bold tracking-tight"
                      style={{ color: tickerInk(a.bias, t) }}
                    >
                      {a.bias === 'bullish' ? '▲ ' : a.bias === 'bearish' ? '▼ ' : ''}
                      {a.ticker}
                    </span>
                    <span
                      className="shrink-0 rounded-sm border px-1 text-3xs font-bold uppercase tracking-wide"
                      style={{ borderColor: alpha(colorOf(t), 0.5), color: colorOf(t) }}
                    >
                      {t.tag}
                    </span>
                    <span className="ml-auto shrink-0 text-3xs tabular-nums text-fg opacity-80">
                      {a.at}
                    </span>
                  </div>
                  <p className="mt-0.5 break-words text-sm font-semibold leading-tight text-fg">
                    {a.title}
                  </p>
                  <p className="mt-0.5 break-words text-xs leading-snug text-fg opacity-90">{a.text}</p>
                  {a.meta && (
                    <p className="mt-0.5 break-words text-2xs tabular-nums text-fg opacity-70">{a.meta}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Same footer line the desktop panel carries, for the same reason: it
          says whether the filter row is a local preference or the engine's own
          state talking. */}
      <div className="mt-auto flex items-center border-t border-line bg-surface2 px-3 py-2 text-3xs uppercase tracking-wide text-fg opacity-80">
        <span>Polls every 20s</span>
        <span className="ml-auto">{master ? 'Synced with CB Edge' : 'Saved in this browser'}</span>
      </div>
    </MobileShell>
  )
}
