import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/data/auth'
import { useIsPhone } from '@/design/useIsPhone'
import { useNotes } from '@/shell/notes'
import { useNotesPanel } from '@/shell/NotesPanelContext'

// ─────────────────────────────────────────────────────────────────────────────
// ADD TO NOTES — the app-wide selection chip and right-click menu.
//
// v2's components/shared/NoteClipMenu.tsx, rebuilt on v3 (react-router instead
// of next/navigation, token utilities instead of HOME_THEME literals, v3's own
// auth read and snapshot engine). No v2 import — clean-slate rule, AGENTS.md.
//
// Two gestures, both anywhere in the app, neither of which a page has to opt
// into:
//
//   • DRAG OVER TEXT — highlight anything and a small "＋ Notes" chip appears
//     at the end of the selection. One click files it. (v2 only had the
//     right-click route; the chip is the gesture Brandon actually described.)
//   • RIGHT-CLICK — with a selection, offer to file it. Inside a card or a
//     chart, offer to COPY THE IMAGE to the clipboard and to file a snapshot
//     of it as a clip note.
//
// COPY IMAGE is the fix for "right click copy image doesn't work": Chrome's own
// context menu offers Copy image for an <img> and for nothing else, so on a
// <canvas> chart — which is every chart in this app — the native menu has no
// such item and never did. This one photographs the card through
// shell/snapshot.ts (the same engine the toolbar camera uses) and writes a PNG
// to the clipboard.
//
// Deliberate behaviours, carried over from v2:
//   • The NATIVE menu is never taken away silently. `preventDefault()` only
//     when there is actually something to offer; `shift`+right-click always
//     yields the browser's menu; inputs, links and the notes dock are left
//     alone (that is where Paste / Copy link / spellcheck live).
//   • A page with its OWN context menu wins: an event that is already
//     `defaultPrevented` by the time it reaches window is left alone.
//
// Opting in / labelling, both optional:
//   • `data-note-clip`  — the element to photograph for right-clicks inside it.
//     Without it we walk up to the nearest `[data-card]` Card, then to a
//     chart's own container.
//   • `data-note-label` — the name to file the clip under. Without it we use
//     the card's heading, then the page name.
//   • `data-no-note-clip` — stay out of this subtree entirely.
// ─────────────────────────────────────────────────────────────────────────────

/** Clip images live in localStorage beside the note text, so they stay small. */
const CLIP_MAX_W = 720
const CLIP_QUALITY = 0.72
/** Longest selection stored verbatim; longer runs are trimmed with an ellipsis. */
const MAX_SEL_CHARS = 1200
/** Below this a "selection" is a stray double-click, not something to file. */
const MIN_SEL_CHARS = 2

/**
 * Above the popovers (Controls.tsx's POP_Z is 250) and below nothing else —
 * both of these are portalled to <body>, so the number means what it says.
 */
const CHIP_Z = 300
const MENU_Z = 310

/** Places where the browser's own menu is the useful one. */
const NATIVE_ZONES =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], a[href], [data-no-note-clip], [data-notes-dock]"

interface Clip {
  /** Selected text, if the gesture happened with a live selection. */
  sel: string
  /** Element to photograph, if one was resolvable under the cursor. */
  el: HTMLElement | null
  /** Human label for the target. */
  label: string
}

interface Anchored extends Clip {
  x: number
  y: number
}

/** "/v3/es-candles" → "ES Candles" */
function pageLabel(pathname: string): string {
  const trimmed = (pathname || '/').replace(/^\/(v3|app|m)(?=\/|$)/, '').replace(/^\/+|\/+$/g, '')
  if (!trimmed) return 'Home'
  const last = trimmed.split('/').pop() || 'Home'
  return last.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * The element to photograph for a gesture on `el`, in priority order: an
 * explicit `[data-note-clip]`, the enclosing Card, or a bare chart's own
 * container. Null when there is nothing panel-shaped under the cursor.
 */
function resolveClipTarget(el: HTMLElement): HTMLElement | null {
  const explicit = el.closest<HTMLElement>('[data-note-clip]')
  if (explicit) return explicit

  const card = el.closest<HTMLElement>('[data-card]')
  if (card) return card

  // A chart with no Card around it: photograph the block that contains it, so
  // axes and legends drawn as siblings come along.
  const chart = el.closest('canvas, svg')
  if (chart) {
    const holder = chart.parentElement?.closest<HTMLElement>('div, section, figure')
    if (holder) return holder
  }
  return null
}

/** A name to file the clip under. */
function resolveLabel(target: HTMLElement | null, pathname: string): string {
  const page = pageLabel(pathname)
  if (!target) return page

  const explicit = target.closest<HTMLElement>('[data-note-label]')?.getAttribute('data-note-label')
  if (explicit?.trim()) return `${page} — ${explicit.trim()}`

  // Card renders its title as an <h2> in the header row; any heading works.
  const heading = target.querySelector('h1, h2, h3, h4, [data-card-title]')
  const text = heading?.textContent?.trim().replace(/\s+/g, ' ')
  if (text && text.length <= 60) return `${page} — ${text}`

  return page
}

/** The live selection, trimmed and capped — empty string when there isn't one. */
function readSelection(): string {
  const s = window.getSelection()
  if (!s || s.isCollapsed) return ''
  const raw = s.toString().trim().replace(/[ \t]+\n/g, '\n')
  if (raw.length < MIN_SEL_CHARS) return ''
  return raw.length > MAX_SEL_CHARS ? `${raw.slice(0, MAX_SEL_CHARS)}…` : raw
}

/** Is this node inside somewhere we deliberately keep our hands off? */
function inNativeZone(node: Node | null | undefined): boolean {
  const el = node instanceof HTMLElement ? node : (node?.parentElement ?? null)
  return !!el?.closest(NATIVE_ZONES)
}

export default function NoteClipMenu() {
  const { isSignedIn, userId } = useAuth()
  const { addNote } = useNotes(userId)
  const { openPanel } = useNotesPanel()
  const isPhone = useIsPhone()
  const { pathname } = useLocation()

  const [menu, setMenu] = useState<Anchored | null>(null)
  const [chip, setChip] = useState<Anchored | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const menuRef = useRef<HTMLDivElement | null>(null)
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The notes dock is desktop-only, so this is too: on a phone a long-press
  // producing a custom menu would only fight the native one.
  const active = isSignedIn && !isPhone

  const flash = useCallback((msg: string, ms = 2200) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }, [])

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )

  // ── the selection chip ─────────────────────────────────────────────────────
  // Offered on mouseup, which is the end of the drag. Read on the next tick:
  // at mouseup time the selection the browser reports is still the one from
  // before the gesture in some engines.
  useEffect(() => {
    if (!active) return

    let raf = 0
    const onUp = (e: MouseEvent) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement | null
      if (chipRef.current?.contains(target)) return
      if (inNativeZone(target)) return

      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const sel = readSelection()
        if (!sel) {
          setChip(null)
          return
        }
        const range = window.getSelection()?.getRangeAt(0)
        const r = range?.getBoundingClientRect()
        if (!r || (!r.width && !r.height)) {
          setChip(null)
          return
        }
        const el = target ? resolveClipTarget(target) : null
        setChip({
          // Just past the end of the highlight, so it never covers the words
          // that were just read.
          x: Math.min(r.right + 6, window.innerWidth - 120),
          y: Math.max(r.bottom + 6, 8),
          sel,
          el,
          label: resolveLabel(el, pathname),
        })
      })
    }

    window.addEventListener('mouseup', onUp)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mouseup', onUp)
    }
  }, [active, pathname])

  // The chip goes away the moment the selection does, or on the next gesture
  // that is not the chip itself.
  useEffect(() => {
    if (!chip) return
    const drop = () => setChip(null)
    const onDown = (e: MouseEvent) => {
      if (chipRef.current?.contains(e.target as Node)) return
      drop()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') drop()
    }
    const onSelChange = () => {
      if (!readSelection()) drop()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', drop, { passive: true })
    window.addEventListener('blur', drop)
    document.addEventListener('selectionchange', onSelChange)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', drop)
      window.removeEventListener('blur', drop)
      document.removeEventListener('selectionchange', onSelChange)
    }
  }, [chip])

  // ── the right-click menu ───────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return

    const onContextMenu = (e: MouseEvent) => {
      // Escape hatches: the browser's own menu must stay reachable.
      if (e.shiftKey || e.defaultPrevented) return

      const el = e.target as HTMLElement | null
      if (!el || typeof el.closest !== 'function') return
      if (el.closest(NATIVE_ZONES)) return

      const sel = readSelection()
      const clip = resolveClipTarget(el)
      // Nothing to offer → let the browser have the click.
      if (!sel && !clip) return

      e.preventDefault()
      setChip(null)
      setMenu({
        x: e.clientX,
        y: e.clientY,
        sel,
        el: clip,
        label: resolveLabel(clip, pathname),
      })
    }

    window.addEventListener('contextmenu', onContextMenu)
    return () => window.removeEventListener('contextmenu', onContextMenu)
  }, [active, pathname])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('wheel', close, { passive: true })
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('wheel', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  // Keep the menu on screen — it opens at the cursor, which can be at an edge.
  useEffect(() => {
    if (!menu || !menuRef.current) return
    const box = menuRef.current
    // The node is reused between openings, so clear the previous nudge before
    // measuring or the second menu inherits the first one's offset.
    box.style.transform = 'none'
    const r = box.getBoundingClientRect()
    const pad = 8
    let dx = 0
    let dy = 0
    if (r.right > window.innerWidth - pad) dx = window.innerWidth - pad - r.right
    if (r.bottom > window.innerHeight - pad) dy = window.innerHeight - pad - r.bottom
    if (dx || dy) box.style.transform = `translate(${dx}px, ${dy}px)`
  }, [menu])

  // ── actions ────────────────────────────────────────────────────────────────

  const addSelection = useCallback(
    (c: Clip) => {
      setMenu(null)
      setChip(null)
      addNote(c.sel, { src: c.label })
      // The dock PUSHES page content when it opens, so opening it on every clip
      // would shove the chart being read sideways. The toast is the receipt —
      // click it to open the panel.
      flash('Added to Notes')
      try {
        window.getSelection()?.removeAllRanges()
      } catch {
        /* ignore */
      }
    },
    [addNote, flash],
  )

  const addSnapshot = useCallback(
    async (c: Clip) => {
      setMenu(null)
      setChip(null)
      if (!c.el) return
      flash('Capturing…', 20000)
      try {
        // The capture engine is a few hundred lines and arrives with the first
        // clip, not with the app. See CopyShot.tsx for the same reasoning.
        const { captureThumb } = await import('@/shell/snapshot')
        const img = await captureThumb(c.el, CLIP_MAX_W, CLIP_QUALITY)
        addNote(c.label, { img, src: c.label })
        flash('Clip added to Notes')
      } catch (err) {
        console.error('[noteclip] snapshot failed', err)
        // Capture failed — still file the note so the reference is not lost.
        addNote(c.label, { src: c.label })
        flash('Snapshot failed — filed the note without the image', 3200)
      }
    },
    [addNote, flash],
  )

  const copyImage = useCallback(
    async (c: Clip) => {
      setMenu(null)
      setChip(null)
      if (!c.el) return
      flash('Copying…', 20000)
      try {
        const { captureAndCopy } = await import('@/shell/snapshot')
        const result = await captureAndCopy(c.el, {
          title: c.label,
          filename: `${c.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'snapshot'}.png`,
        })
        flash(result === 'copied' ? 'Image copied' : 'Clipboard refused it — downloaded instead', 2600)
      } catch (err) {
        console.error('[noteclip] copy image failed', err)
        flash('Copy failed — see the console', 3200)
      }
    },
    [flash],
  )

  if (!active) return null

  const ROW =
    'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-sm font-medium text-fg transition-colors hover:bg-raised'

  return createPortal(
    <>
      {/* ── the drag-over chip ───────────────────────────────────────────── */}
      {chip && (
        <button
          ref={chipRef}
          type="button"
          data-no-note-clip
          // mousedown would collapse the selection before the click lands, and
          // the browser would also treat this as "click outside" for the chip.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => addSelection(chip)}
          title={`Add the highlighted text to Notes — ${chip.label}`}
          style={{ left: chip.x, top: chip.y, zIndex: CHIP_Z }}
          className="fixed flex items-center gap-1.5 rounded-md border border-accent bg-surface px-2 py-1 text-xs font-bold uppercase tracking-[0.08em] text-fg shadow-lg"
        >
          <span aria-hidden className="text-accent">
            ＋
          </span>
          Notes
        </button>
      )}

      {/* ── the right-click menu ─────────────────────────────────────────── */}
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Add to notes"
          data-no-note-clip
          onContextMenu={(e) => e.preventDefault()}
          style={{ left: menu.x + 2, top: menu.y + 2, zIndex: MENU_Z, minWidth: 224, maxWidth: 320 }}
          className="fixed flex flex-col gap-0.5 rounded-md border border-line bg-surface p-1.5 shadow-lg"
        >
          {menu.sel && (
            <button type="button" role="menuitem" className={ROW} onClick={() => addSelection(menu)}>
              <span aria-hidden className="w-4 shrink-0 text-center leading-none text-accent">
                ＋
              </span>
              <span className="flex min-w-0 flex-col">
                <span>Add selection to Notes</span>
                <span className="truncate text-2xs font-normal text-faint opacity-70">
                  “{menu.sel.replace(/\s+/g, ' ').slice(0, 42)}
                  {menu.sel.length > 42 ? '…' : ''}”
                </span>
              </span>
            </button>
          )}

          {menu.el && (
            <>
              {/* THE ONE CHROME CANNOT DO. Its native "Copy image" exists for
                  <img> only, so on a canvas chart there has never been one. */}
              <button
                type="button"
                role="menuitem"
                className={ROW}
                onClick={() => void copyImage(menu)}
              >
                <span aria-hidden className="w-4 shrink-0 text-center leading-none">
                  🖼️
                </span>
                <span className="flex min-w-0 flex-col">
                  <span>Copy image</span>
                  <span className="truncate text-2xs font-normal text-faint opacity-70">{menu.label}</span>
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                className={ROW}
                onClick={() => void addSnapshot(menu)}
              >
                <span aria-hidden className="w-4 shrink-0 text-center leading-none">
                  📸
                </span>
                <span className="flex min-w-0 flex-col">
                  <span>Add snapshot to Notes</span>
                  <span className="truncate text-2xs font-normal text-faint opacity-70">{menu.label}</span>
                </span>
              </button>
            </>
          )}

          <span aria-hidden className="my-1 block h-0 w-full border-b border-line" />

          <button
            type="button"
            role="menuitem"
            className={`${ROW} font-normal text-muted`}
            onClick={() => {
              setMenu(null)
              openPanel()
            }}
          >
            <span aria-hidden className="w-4 shrink-0 text-center leading-none">
              🖍️
            </span>
            <span>Open Notes panel</span>
          </button>
        </div>
      )}

      {/* ── the receipt ──────────────────────────────────────────────────── */}
      {toast && (
        <button
          type="button"
          data-no-note-clip
          onClick={() => {
            setToast(null)
            openPanel()
          }}
          title="Open the Notes panel"
          style={{ zIndex: MENU_Z }}
          className="fixed bottom-4 right-4 flex items-center gap-2 rounded-md border border-accent bg-surface px-3 py-2 text-xs font-bold tracking-[0.04em] text-fg shadow-lg"
        >
          <span aria-hidden>🖍️</span>
          {toast}
        </button>
      )}
    </>,
    document.body,
  )
}
