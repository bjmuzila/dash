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
// THE ROWS ARE REAL. `useAlertsFeed` (AlertsFeed.tsx) polls GET /proxy/signals
// every 20s and maps `trade_signals` rows onto AlertItem. The placeholder
// SAMPLE list that used to live in this file is gone.
// ─────────────────────────────────────────────────────────────────────────────

// ONE ROW, AND IT FITS. Wrapping made the panel's height jump as types were
// filtered, and scrolling sideways just moved the problem — the last chip sat
// half-cut at the right edge and read as broken rather than as scrollable.
// So the row is sized to hold every chip: the panel is 28rem, the chips carry
// `px-1.5`, and the labels in ALERT_TYPES are short. `overflow-x-auto` stays as
// a safety net for a future ninth type, with `shrink-0` keeping chips legible
// rather than squeezed, but nothing should reach it.
const CHIP =
  'shrink-0 cursor-pointer select-none whitespace-nowrap rounded-full border px-1.5 py-[2px] text-3xs font-bold uppercase tracking-wide outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed'

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
      // The panel is wider than its trigger, and the trigger shrinks. `w-[24rem]`
      // with a `max-w` tied to the viewport keeps it from hanging off either
      // edge on a narrow window, where the pill itself is only ~9rem wide.
      className="absolute left-0 top-[calc(100%+6px)] z-40 w-[28rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border border-line bg-surface shadow-2xl"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-line bg-surface2 px-2.5 py-2">
        <span className="text-3xs font-bold uppercase tracking-widest text-fg">Alerts</span>
        {visible.length > 0 && (
          <span className="rounded-full bg-warn px-1.5 text-3xs font-bold text-bg">{visible.length}</span>
        )}
        <button
          type="button"
          onClick={close}
          className="ml-auto text-3xs uppercase tracking-wide text-fg opacity-80 outline-none transition-opacity hover:opacity-100 focus-visible:ring-1 focus-visible:ring-accent"
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
                  ? { borderColor: t.color, color: t.color, background: alpha(t.color, 0.11) }
                  : {
                      borderColor: T.border,
                      color: T.text,
                      // An unavailable kind is dimmed; a merely-unchecked one is
                      // full white with a strike through it. Both are readable.
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

      {/* ── The scrollable feed ─────────────────────────────────────────────── */}
      <div className="max-h-60 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="py-8 text-center text-xs text-fg">{emptyNote}</p>
        ) : (
          visible.map((a) => {
            const t = TYPE_BY_ID[a.kind]
            // Bullish/bearish is a whale-print idea: the engine gives every
            // other detector direction 'neutral', and painting those green or
            // red would invent a call the detector never made.
            const bias = a.bias
            const biasColor = bias ? (bias === 'bullish' ? T.green : T.red) : null
            return (
              <div
                key={a.id}
                className="flex cursor-pointer gap-2 border-b border-line px-2.5 py-1.5 transition-colors hover:bg-raised"
              >
                <span
                  aria-hidden
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: t.color }}
                />
                <div className="min-w-0 flex-1">
                  {/* ── THE TITLE ────────────────────────────────────────────
                      The biggest type in the row, and the row's whole first
                      impression. It used to be the SMALLEST — a 3xs uppercase
                      tag line over a larger sentence — so the eye landed on the
                      explanation and had to work back up for the subject.

                      TICKER FIRST, in the type's colour. Scanning this list is
                      asking "what is this about", and the answer is a symbol,
                      not a verb. The type's tag is gone from the line: `setup`
                      already names the detector, and "WHALE · WHALE PUT BUY"
                      was the same word twice. Colour, dot and chip still say
                      which kind it is. */}
                  <div className="flex items-baseline gap-1.5">
                    {/* ── THE SIDE, IN FRONT OF THE SYMBOL ──────────────────
                        A whale print is only worth a glance once you know which
                        way it leans, and "call buy" is three words deeper into
                        the line than the eye gets. The arrow carries it: green
                        ▲ for a call buy, red ▼ for a put buy, and the ticker
                        itself takes the same colour so the pair reads as one
                        object. `bias` is the engine's own `direction` column
                        (AlertsFeed.toItem), so this can never disagree with the
                        sentence underneath.

                        Detectors with no side — the flip, the core, the IB —
                        have no `bias` and keep the type's colour with no arrow,
                        which is why this is a conditional and not a default. */}
                    {bias && (
                      <span
                        aria-hidden
                        className="shrink-0 text-2xs font-bold leading-none"
                        style={{ color: biasColor }}
                      >
                        {bias === 'bullish' ? '▲' : '▼'}
                      </span>
                    )}
                    <span
                      className="shrink-0 text-sm font-bold tracking-tight"
                      style={{ color: biasColor ?? t.color }}
                    >
                      {a.ticker}
                    </span>
                    {bias && <span className="sr-only">{bias}</span>}
                    <span className="truncate text-sm font-semibold leading-tight text-fg">
                      {a.title}
                    </span>
                    <span className="ml-auto shrink-0 text-3xs tabular-nums text-fg opacity-80">
                      {a.at}
                    </span>
                  </div>
                  {/* The detector's sentence — the WHY, one step down. */}
                  <p className="mt-0.5 text-2xs leading-snug text-fg opacity-90">{a.text}</p>
                  {a.meta && (
                    <p className="mt-px text-3xs tabular-nums text-fg opacity-70">{a.meta}</p>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="flex items-center border-t border-line bg-surface2 px-2.5 py-1.5 text-3xs uppercase tracking-wide text-fg opacity-80">
        <span>Esc to close</span>
        <span className="ml-auto">{master ? 'Synced with CB Edge' : 'Saved in this browser'}</span>
      </div>
    </div>
  )
}

export default AlertsPanel
