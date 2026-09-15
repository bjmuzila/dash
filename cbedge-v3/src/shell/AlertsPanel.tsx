import { useEffect, useMemo, useState } from 'react'
import { T, alpha } from '@/design/theme'
import type { AlertItem, AlertKind } from '@/shell/alertTypes'
import {
  ALERT_TYPES,
  TYPE_BY_ID,
  fetchMasterEnabled,
  readArmed,
  readShown,
  writeArmed,
  writeShown,
} from '@/shell/alertTypes'

// ─────────────────────────────────────────────────────────────────────────────
// THE ALERTS DROPDOWN — the rest of the feed, and the switchboard.
//
// Two tabs, because they answer two different questions and merging them is how
// a mute becomes an accidental disarm:
//
//   FEED      what has fired today. Filter CHIPS across the top hide a type
//             from THIS list and nothing else — a view control.
//   SETTINGS  one switch per signal: does THIS BROWSER want it. The same rows,
//             in the same order and under the same names, as the owner console's
//             Signal Alerts switchboard.
//
// ── THE MASTER WINS ─────────────────────────────────────────────────────────
// Each row also carries the engine's own state, read once per open from
// GET /proxy/signal-alerts. A kind the owner has turned OFF there never fires
// for anybody, so its row is drawn LOCKED and labelled rather than left
// switchable — a switch that cannot change the outcome is worse than no switch.
// The local preference under it is remembered, so re-arming on the owner site
// restores whatever the customer had chosen.
//
// Nothing here ever POSTs: the master is owner-only by proxy-auth, and the
// customer's own choice is a browser preference (localStorage, alertTypes.ts).
//
// ── NO DATA YET (2026-09-14) ────────────────────────────────────────────────
// `SAMPLE` below is placeholder copy so the panel can be looked at and reviewed.
// Deleting it and passing a real list through `items` is the whole of the
// wiring job — no component here reads a URL or a socket.
// ─────────────────────────────────────────────────────────────────────────────

/** PLACEHOLDER. Delete when the signals engine feeds this. */
export const SAMPLE: AlertItem[] = [
  { id: 8, kind: 'gexA', variant: 'Cross up', text: 'Reclaimed 6 612 — gamma supportive above', meta: 'A 6 612 · spot 6 613.4', at: '10:41' },
  { id: 7, kind: 'gexB', variant: 'Rejection', text: 'Third rejection at 6 585', meta: 'B 6 585 · low 6 584.1 · 3 touches', at: '10:28' },
  { id: 6, kind: 'flip', text: 'Crossed the flip at 6 600 — positive gamma', meta: 'flip 6 600 · spot 6 603.8', at: '10:06' },
  { id: 5, kind: 'whale', text: '$4.1M SPX 6650C 0DTE swept at ask', meta: '2 400 × $17.10 · above OI', at: '09:58' },
  { id: 4, kind: 'divergence', text: 'Call premium up, net GEX down', meta: '12m window', at: '09:52' },
  { id: 3, kind: 'ibBreak', text: 'IB high 6 596 broken — extension up', meta: 'IB 6 572 / 6 596 · range 24.0', at: '09:47' },
  { id: 2, kind: 'bzila', text: 'Setup 3 — flip reclaim + IB break + call sweep', meta: '3 of 3 · score 8.4', at: '09:41' },
  { id: 1, kind: 'ibFormed', text: 'Initial balance 6 572 / 6 596', at: '09:30' },
]

const CHIP =
  'cursor-pointer select-none rounded-full border px-2 py-[2px] text-3xs font-bold uppercase tracking-wide transition-colors'
const TAB =
  'flex-1 cursor-pointer border-b-2 py-2 text-center text-3xs font-bold uppercase tracking-widest transition-colors'

function Switch({
  on,
  color,
  onClick,
  locked = false,
}: {
  on: boolean
  color: string
  onClick: () => void
  locked?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled={locked}
      disabled={locked}
      onClick={onClick}
      title={locked ? 'Switched off by CB Edge' : undefined}
      className="relative h-[14px] w-[26px] shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        borderColor: on ? color : T.border,
        background: on ? alpha(color, 0.26) : T.panelBg,
      }}
    >
      <span
        aria-hidden
        className="absolute left-[1px] top-[1px] h-2.5 w-2.5 rounded-full transition-transform"
        style={{
          background: on ? color : T.text,
          opacity: on ? 1 : 0.4,
          transform: on ? 'translateX(12px)' : 'none',
        }}
      />
    </button>
  )
}

export function AlertsPanel({ items, close }: { items: AlertItem[]; close: () => void }) {
  const [tab, setTab] = useState<'feed' | 'settings'>('feed')
  const [shown, setShown] = useState<AlertKind[]>(() => readShown())
  const [armed, setArmed] = useState<AlertKind[]>(() => readArmed())
  // null until the ask returns — and null means "assume armed", so a free
  // account or a dropped connection never reads as "everything is off".
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

  const toggleArmed = (id: AlertKind) => {
    setArmed((prev) => {
      const next = prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]
      writeArmed(next)
      return next
    })
  }

  const allShown = shown.length === ALERT_TYPES.length
  const setAll = () => {
    const next = allShown ? [] : ALERT_TYPES.map((t) => t.id)
    writeShown(next)
    setShown(next)
  }

  // A kind the owner disarmed is not in the feed either, whatever the chips or
  // the local switches say: it is not firing, so showing yesterday's rows for
  // it under a live-looking list would be the feed lying about the engine.
  const visible = useMemo(
    () => items.filter((a) => shown.includes(a.kind) && armed.includes(a.kind) && isLive(a.kind)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, shown, armed, master],
  )

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

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-line bg-surface2">
        <button
          type="button"
          onClick={() => setTab('feed')}
          className={[TAB, tab === 'feed' ? 'border-accent text-accent' : 'border-transparent opacity-70'].join(' ')}
        >
          Feed
        </button>
        <button
          type="button"
          onClick={() => setTab('settings')}
          className={[TAB, tab === 'settings' ? 'border-accent text-accent' : 'border-transparent opacity-70'].join(' ')}
        >
          Settings
        </button>
      </div>

      {tab === 'feed' ? (
        <>
          {/* ── Filter chips — a VIEW control, not an arm/disarm ──────────── */}
          <div className="flex flex-wrap items-center gap-1 border-b border-line bg-bg px-2.5 py-1.5">
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
              const on = shown.includes(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleShown(t.id)}
                  className={CHIP}
                  style={
                    on
                      ? { borderColor: t.color, color: t.color, background: alpha(t.color, 0.11) }
                      : { borderColor: T.border, color: T.text, opacity: 0.7, textDecoration: 'line-through' }
                  }
                >
                  {t.short}
                </button>
              )
            })}
          </div>

          {/* ── The scrollable feed ───────────────────────────────────────── */}
          <div className="max-h-60 overflow-y-auto">
            {visible.length === 0 ? (
              <p className="py-8 text-center text-xs text-fg opacity-60">
                {items.length === 0 ? 'No signals yet today.' : 'Nothing matches those filters.'}
              </p>
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
        </>
      ) : (
        /* ── Settings — one switch per signal ──────────────────────────────── */
        <div className="max-h-[17.5rem] overflow-y-auto">
          {(['primary', 'bzila'] as const).map((group) => (
            <div key={group}>
              <p className="bg-bg px-2.5 pb-1 pt-2 text-3xs font-bold uppercase tracking-widest opacity-60">
                {group === 'primary' ? 'Primary' : 'Bzila'}
              </p>
              {ALERT_TYPES.filter((t) => t.group === group).map((t) => {
                const live = isLive(t.id)
                const on = live && armed.includes(t.id)
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 border-b border-line px-2.5 py-1.5 transition-colors hover:bg-raised"
                  >
                    <Switch
                      on={on}
                      color={t.color}
                      locked={!live}
                      onClick={() => live && toggleArmed(t.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={['truncate text-xs', on ? 'opacity-95' : 'opacity-70'].join(' ')}>{t.name}</p>
                      {/* When CB Edge has the kind switched off there is nothing
                          a local switch can do, so the row says why instead of
                          pretending. The browser's own choice is still kept. */}
                      <p className="truncate text-3xs opacity-60">
                        {live ? t.hint : 'Off — switched off by CB Edge'}
                      </p>
                    </div>
                    <span
                      className="shrink-0 rounded-[2px] border px-1 text-3xs font-bold uppercase leading-[13px] tracking-wide"
                      style={{ borderColor: t.color, color: t.color, opacity: on ? 1 : 0.55 }}
                    >
                      {t.tag}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center border-t border-line bg-surface2 px-2.5 py-1.5 text-3xs uppercase tracking-wide opacity-70">
        <span>Esc to close</span>
        <span className="ml-auto">{master ? 'Synced with CB Edge' : 'Saved in this browser'}</span>
      </div>
    </div>
  )
}

export default AlertsPanel
