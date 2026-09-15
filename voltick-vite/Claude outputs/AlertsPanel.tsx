import { useEffect, useMemo, useState } from 'react'
import { T, alpha } from '@/design/theme'
import type { AlertItem, AlertKind } from '@/shell/alertTypes'
import { ALERT_TYPES, TYPE_BY_ID, fetchMasterEnabled, readShown, writeShown } from '@/shell/alertTypes'

// ─────────────────────────────────────────────────────────────────────────────
// THE ALERTS DROPDOWN — the rest of the feed.
//
// ONE TAB, deliberately. This panel used to carry a Settings tab with a switch
// per signal. It is gone: whether a kind fires at all is decided by the signals
// engine's own switchboard on owner.cbedge.net → Admin → Signal Alerts, which is
// owner-only at the server (proxy-auth gates POST /proxy/signal-alerts), so a
// customer-facing switch could never have changed the outcome. A control that
// cannot change anything is worse than no control.
//
// What is left is a VIEW control: the chips hide a type from THIS list and
// nothing else. They are per-browser (`alerts:shown`, alertTypes.ts) and the
// panel never POSTs anything.
//
// THE MASTER STILL SHOWS THROUGH. The engine's per-kind state is read once per
// open from GET /proxy/signal-alerts. A kind CB Edge has switched off is not in
// this feed and its chip is drawn off and disabled — so an empty list says
// which of the two reasons it is empty for.
//
// ── NO FEED DATA YET ────────────────────────────────────────────────────────
// `SAMPLE` below is placeholder copy. Wiring the rows means replacing the body
// of `useAlertsFeed` in AlertsFeed.tsx with a read of /proxy/signals.
// ─────────────────────────────────────────────────────────────────────────────

/** PLACEHOLDER. Delete when the signals engine feeds this. */
export const SAMPLE: AlertItem[] = [
  { id: 8, kind: 'gexChangeTop', variant: 'Live trigger', text: 'NVDA 180 — Δ GEX +$740M, +62% vs open', meta: '10:37 · exp 2026-09-19 · grade B', at: '10:37' },
  { id: 7, kind: 'coreTouch', text: 'Price is at the core level (SPX 6 600), arriving from below', meta: 'core 6 600 · 3.4B', at: '10:22' },
  { id: 6, kind: 'coreChange', variant: '↑', text: 'Core moved up 25 pts — 6 575 → 6 600', meta: '3.4B', at: '10:14' },
  { id: 5, kind: 'flip', text: 'Crossed the flip at 6 600 — positive gamma', meta: 'flip 6 600 · spot 6 603.8', at: '10:06' },
  { id: 4, kind: 'whale', text: '$4.1M SPX 6650C swept at ask', meta: '2 400 × $17.10 · OTM · 3 DTE', at: '09:58' },
  { id: 3, kind: 'gexChangeTop', variant: 'Scanner pick', text: 'SPY 660 — Δ GEX −$510M, −41% vs open', meta: '09:30 slot · rank 1', at: '09:52' },
  { id: 2, kind: 'ibBreak', text: 'IB high 6 596 broken — extension up', meta: 'IB 6 572 / 6 596 · range 24.0', at: '09:47' },
  { id: 1, kind: 'ibFormed', text: 'Initial balance 6 572 / 6 596', at: '09:30' },
]

// ONE ROW, ALWAYS. Nine chips will not fit a 24rem panel, and wrapping them
// pushed the feed down a line and made the panel's height jump as types were
// filtered. They scroll sideways instead — `shrink-0` on each chip is what stops
// flex from compressing them into unreadable slivers rather than overflowing.
const CHIP =
  'shrink-0 cursor-pointer select-none whitespace-nowrap rounded-full border px-2 py-[2px] text-3xs font-bold uppercase tracking-wide transition-colors disabled:cursor-not-allowed'

export function AlertsPanel({ items, close }: { items: AlertItem[]; close: () => void }) {
  const [shown, setShown] = useState<AlertKind[]>(() => readShown())
  // null until the ask returns — and null means "assume armed", so a dropped
  // connection never reads as "CB Edge turned everything off".
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

  // Three different empty panels, and saying which is the whole job of the line.
  const emptyNote =
    items.length === 0
      ? 'No signals yet today.'
      : liveTypes.length === 0
        ? 'Every signal is switched off by CB Edge right now.'
        : 'Nothing matches those filters.'

  return (
    <div
      role="menu"
      className="absolute left-0 top-[calc(100%+6px)] z-40 w-[24rem] overflow-hidden rounded-md border border-line bg-surface shadow-2xl"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-line bg-surface2 px-2.5 py-2">
        <span className="text-3xs font-bold uppercase tracking-widest opacity-85">Alerts</span>
        {visible.length > 0 && (
          <span className="rounded-full bg-warn px-1.5 text-3xs font-bold text-bg">{visible.length}</span>
        )}
        <button
          type="button"
          onClick={close}
          className="ml-auto text-3xs uppercase tracking-wide opacity-65 transition-opacity hover:opacity-90"
        >
          Close
        </button>
      </div>

      {/* ── Filter chips — ONE ROW, scrolls sideways ────────────────────────── */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line bg-bg px-2.5 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={setAll}
          className={CHIP}
          style={
            allShown
              ? { borderColor: T.cyan, color: T.cyan, background: alpha(T.cyan, 0.11) }
              : { borderColor: T.border, color: T.text, opacity: 0.7 }
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
                  ? { borderColor: t.color, color: t.color, background: alpha(t.color, 0.11) }
                  : {
                      borderColor: T.border,
                      color: T.text,
                      opacity: live ? 0.7 : 0.35,
                      textDecoration: 'line-through',
                    }
              }
            >
              {t.short}
            </button>
          )
        })}
      </div>

      {/* ── The scrollable feed ─────────────────────────────────────────────── */}
      <div className="max-h-60 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="py-8 text-center text-xs text-fg opacity-60">{emptyNote}</p>
        ) : (
          visible.map((a) => {
            const t = TYPE_BY_ID[a.kind]
            return (
              <div
                key={a.id}
                className="flex cursor-pointer gap-2 border-b border-line px-2.5 py-1.5 transition-colors hover:bg-raised"
              >
                <span
                  aria-hidden
                  className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: t.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="truncate text-3xs font-bold uppercase tracking-wide"
                      style={{ color: t.color }}
                    >
                      {a.variant ? `${t.tag} · ${a.variant}` : t.name}
                    </span>
                    <span className="ml-auto shrink-0 text-3xs tabular-nums opacity-60">{a.at}</span>
                  </div>
                  <p className="mt-px text-xs opacity-95">{a.text}</p>
                  {a.meta && <p className="mt-px text-3xs tabular-nums opacity-60">{a.meta}</p>}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="flex items-center border-t border-line bg-surface2 px-2.5 py-1.5 text-3xs uppercase tracking-wide opacity-70">
        <span>Esc to close</span>
        <span className="ml-auto">{master ? 'Synced with CB Edge' : 'Saved in this browser'}</span>
      </div>
    </div>
  )
}

export default AlertsPanel
