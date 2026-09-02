import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useIsOwner } from '@/data/auth'
import { Popover } from '@/design/primitives/Controls'

// ─────────────────────────────────────────────────────────────────────────────
// COPYSHOT — one camera in the toolbar, and a menu of whatever is worth
// photographing right now.
//
// v2 solved this by putting a 📸 on every panel that wanted one. Twelve buttons,
// twelve slightly different implementations, and a row of chrome on every card
// that is only ever used by one person. v3 inverts it: the BUTTON is in one
// place (owner-gated, in the toolbar) and the TARGETS come to it.
//
// A surface that can be photographed publishes itself:
//
//   const targets = useMemo(() => ready ? [{ … }] : NO_TARGETS, [ready])
//   useCopyShotTargets(targets)
//
// …and it appears in the menu for exactly as long as it is worth capturing —
// the sector wheel only while it is popped out, the EM block only once a
// ticker has actually been looked up. Nothing has to be registered centrally,
// and a card that never registers simply is not offered.
//
// MEMOISE THE ARRAY. The list identity is the effect's dependency; a fresh
// array literal every render republishes on every render. `NO_TARGETS` is
// exported so "nothing right now" is a constant rather than a new `[]`.
//
// ── Owner-gated, and that is chrome ──────────────────────────────────────────
// `useIsOwner` decides what is DRAWN, exactly as everywhere else in v3 (see
// data/auth.tsx). It is not a permission: the capture runs entirely in the
// browser against pixels the viewer can already see, so there is nothing here
// for a gate to protect. It is hidden because it is a tool for one person.
// ─────────────────────────────────────────────────────────────────────────────

export interface CopyShotTarget {
  /** Unique for as long as it is published. Doubles as the menu row key. */
  id: string
  /** The menu row, and the title band printed into the PNG. */
  label: string
  /** Menu heading. See GROUP_ORDER. */
  group?: string
  /** Download name stem, used only when the clipboard write is refused. */
  file?: string
  /**
   * The element to photograph, resolved AT CLICK TIME rather than held as a
   * ref: a board card is re-created on every drag and a popped-out overlay is
   * portalled in and out, so a ref captured at publish time is stale about as
   * often as it is right.
   */
  resolve: () => HTMLElement | null
}

/** The stable empty list. See the note about memoising, above. */
export const NO_TARGETS: CopyShotTarget[] = []

/**
 * Menu headings, top to bottom. Anything unlisted sorts after these, keeping
 * whatever order it was published in.
 */
const GROUP_ORDER = ['This page', 'Home board']
const DEFAULT_GROUP = 'This page'

const rankOf = (g: string) => {
  const i = GROUP_ORDER.indexOf(g)
  return i === -1 ? GROUP_ORDER.length : i
}

interface CopyShotApi {
  targets: CopyShotTarget[]
  publish: (key: string, list: CopyShotTarget[]) => void
}

const Ctx = createContext<CopyShotApi | null>(null)

export function CopyShotProvider({ children }: { children: ReactNode }) {
  const [byKey, setByKey] = useState<Record<string, CopyShotTarget[]>>({})

  const publish = useCallback((key: string, list: CopyShotTarget[]) => {
    setByKey((prev) => {
      const had = prev[key]
      if (!list.length) {
        if (!had) return prev
        const next = { ...prev }
        delete next[key]
        return next
      }
      if (had === list) return prev
      return { ...prev, [key]: list }
    })
  }, [])

  const targets = useMemo(() => {
    // Object key order is publisher insertion order, which is the order the
    // page mounted its surfaces in — a sane secondary sort, and the reason the
    // group sort below has to be STABLE.
    const flat = Object.values(byKey).flat()
    return flat
      .map((t, i) => ({ t, i }))
      .sort((a, b) => rankOf(a.t.group ?? DEFAULT_GROUP) - rankOf(b.t.group ?? DEFAULT_GROUP) || a.i - b.i)
      .map(({ t }) => t)
  }, [byKey])

  const value = useMemo<CopyShotApi>(() => ({ targets, publish }), [targets, publish])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Offer `list` to the toolbar's camera menu for as long as this component is
 * mounted and the array is non-empty. MEMOISE `list`.
 */
export function useCopyShotTargets(list: CopyShotTarget[]): void {
  const key = useId()
  const api = useContext(Ctx)
  const publish = api?.publish
  useEffect(() => {
    if (!publish) return
    publish(key, list)
    return () => publish(key, NO_TARGETS)
  }, [key, publish, list])
}

// ── Taking the shot ──────────────────────────────────────────────────────────

type ShotState = 'idle' | 'working' | 'copied' | 'saved' | 'err'

const GLYPH: Record<ShotState, string> = {
  idle: '📸',
  working: '⏳',
  copied: '✓',
  saved: '⬇',
  err: '✕',
}

const TONE: Record<ShotState, string> = {
  idle: 'text-muted',
  working: 'text-muted',
  copied: 'text-up',
  saved: 'text-up',
  err: 'text-down',
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'snapshot'
}

/** The capture itself, plus the two seconds of feedback that follow it. */
function useShot() {
  const [state, setState] = useState<ShotState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const take = useCallback(async (target: CopyShotTarget) => {
    if (timer.current) clearTimeout(timer.current)
    setState('working')
    try {
      const el = target.resolve()
      if (!el) throw new Error(`nothing on screen for "${target.label}"`)
      // The engine arrives with the first click, not with the app. This module
      // is in the ENTRY chunk (the toolbar mounts it on every route) and the
      // capture is a few hundred lines nobody who is not the owner will ever
      // run — see budgets.json, where `entry` is the tightest number there is.
      const { captureAndCopy } = await import('@/shell/snapshot')
      const result = await captureAndCopy(el, {
        title: target.label,
        filename: `${slug(target.file ?? target.label)}.png`,
      })
      setState(result)
    } catch (e) {
      console.error('[copyshot]', e)
      setState('err')
    }
    timer.current = setTimeout(() => setState('idle'), 2200)
  }, [])

  return { state, take }
}

// ── The toolbar menu ─────────────────────────────────────────────────────────

export function CopyShotMenu() {
  const { isOwner } = useIsOwner()
  const api = useContext(Ctx)
  const { state, take } = useShot()
  const [open, setOpen] = useState(false)

  const targets = api?.targets ?? NO_TARGETS
  const close = useCallback(() => setOpen(false), [])

  // Grouped for rendering, in the order the provider already sorted them into.
  const groups = useMemo(() => {
    const out: Array<{ name: string; rows: CopyShotTarget[] }> = []
    for (const t of targets) {
      const name = t.group ?? DEFAULT_GROUP
      const last = out[out.length - 1]
      if (last && last.name === name) last.rows.push(t)
      else out.push({ name, rows: [t] })
    }
    return out
  }, [targets])

  if (!isOwner) return null

  const pick = (t: CopyShotTarget) => {
    // Close FIRST. The panel is portalled over the page, and a full-page shot
    // taken with it open would photograph the menu on top of its own subject.
    setOpen(false)
    void take(t)
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          state === 'err'
            ? 'Capture failed — see the console'
            : state === 'saved'
              ? 'Clipboard refused it — downloaded instead'
              : state === 'copied'
                ? 'Copied to the clipboard'
                : 'Copy a PNG of a card to the clipboard'
        }
        className={[
          'rounded-sm border border-line px-2 py-0.5 text-sm leading-none transition-colors',
          open ? 'bg-raised' : '',
          TONE[state],
          state === 'working' ? 'opacity-60' : 'hover:text-fg',
        ].join(' ')}
      >
        {GLYPH[state]}
      </button>
      <Popover open={open} onClose={close}>
        <div className="flex w-64 flex-col gap-2">
          {groups.length === 0 && (
            <span className="px-1 py-1.5 text-xs text-faint">
              Nothing to capture on this page yet.
            </span>
          )}
          {groups.map((g) => (
            <div key={g.name} className="flex flex-col gap-0.5 border-t border-line pt-2 first:border-t-0 first:pt-0">
              <span className="px-1 text-3xs font-bold uppercase tracking-[0.12em] text-faint opacity-60">
                {g.name}
              </span>
              {g.rows.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pick(t)}
                  title={`Copy a PNG of ${t.label}`}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm text-fg hover:bg-raised"
                >
                  <span className="min-w-0 flex-1 truncate">{t.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </Popover>
    </div>
  )
}

// ── The in-place camera ──────────────────────────────────────────────────────

/**
 * A single-target camera for a surface the TOOLBAR CANNOT BE REACHED FROM.
 *
 * There is exactly one of those today and it is not an exception worth
 * regretting: the sector wheel's pop-out is a `fixed inset-0` overlay above
 * everything, so while it is open the toolbar is behind it and its camera
 * cannot be clicked at all. The wheel publishes itself to the menu anyway (for
 * the case where it is not the thing covering the screen) and carries this
 * button in its own header for the case where it is.
 *
 * Wear `data-capture-hide` on this button — it must not appear in its own PNG.
 */
export function CopyShotButton({
  target,
  className = '',
  label,
}: {
  target: CopyShotTarget
  className?: string
  /** Text beside the glyph. Omit for the bare camera. */
  label?: string
}) {
  const { isOwner } = useIsOwner()
  const { state, take } = useShot()
  if (!isOwner) return null
  return (
    <button
      type="button"
      data-capture-hide
      onClick={() => void take(target)}
      title="Copy a PNG of this to the clipboard"
      className={[className, TONE[state], state === 'working' ? 'opacity-60' : ''].join(' ')}
    >
      {GLYPH[state]}
      {label ? ` ${label}` : ''}
    </button>
  )
}
