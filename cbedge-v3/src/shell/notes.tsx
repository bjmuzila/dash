import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// ─────────────────────────────────────────────────────────────────────────────
// QUICK-JOT NOTES — the store, and the body the dock renders.
//
// Ported from v2's components/shared/notes.tsx. Same storage key, same event,
// same quota-shedding write path; what changed is the styling, which is now
// token utilities rather than inline HOME_THEME values (non-negotiable 1).
//
// The STORAGE KEY PREFIX is identical to v2's on purpose: both builds are served
// from the same origin, so the notes written on /app/* are the notes read on
// /v3/* — one list, not two that quietly diverge.
//
// Notes are stored per user id: `${NOTES_STORAGE_PREFIX}${userId}`, so two
// logins in one browser never see each other's notes.
// ─────────────────────────────────────────────────────────────────────────────

const NOTES_STORAGE_PREFIX = 'sidebar-notes-v1:'

/**
 * Cross-instance sync event.
 *
 * `useNotes` is called in more than one place at once (the toolbar button for
 * the count badge, the dock for the list) and each call is its own `useState`.
 * Without a broadcast, a note added in the dock would sit in localStorage while
 * the badge kept showing the old count until a remount. Every mutation
 * dispatches this event with the new array and every other instance on the same
 * storage key adopts it.
 */
const NOTES_EVENT = 'cb-notes-changed'
interface NotesEventDetail {
  key: string
  notes: Note[]
  from: string
}

export interface Note {
  id: string
  text: string
  ts: number
  /** JPEG/PNG data URL — set for clips captured from a chart/panel. */
  img?: string
  /** Where the note came from, e.g. "Traders Dash — GEX Chart". */
  src?: string
}

/** Extra fields a caller can attach when adding a note. */
export interface NoteExtra {
  img?: string
  src?: string
}

// ─── icons ───────────────────────────────────────────────────────────────────

export function NoteIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4h16v12l-4 4H4z" />
      <path d="M16 20v-4h4" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="13" x2="12" y2="13" />
    </svg>
  )
}

/** Pencil — the toolbar button's glyph, matching v2's NOTES button. */
export function PencilIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  )
}

function CloseIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

/** Four corner arrows — "pop this clip out over the page". */
function ExpandIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
}

/**
 * Write the list to localStorage, shedding weight until it fits.
 *
 * Clip notes carry a base64 image, so this key can realistically reach the ~5MB
 * origin quota — and a `setItem` that throws used to leave the in-memory list
 * and storage silently out of sync (the note vanished on reload). On
 * QuotaExceeded we drop the OLDEST image first (that note's text survives), then
 * whole oldest notes as a last resort, and return the list that actually landed
 * so state can be set to it.
 */
function writeStore(key: string, wanted: Note[]): Note[] {
  let list = wanted
  for (let guard = 0; guard < 200; guard++) {
    try {
      localStorage.setItem(key, JSON.stringify(list))
      return list
    } catch {
      // Oldest note carrying an image (list is newest-first).
      let victim = -1
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i]?.img) {
          victim = i
          break
        }
      }
      if (victim >= 0) {
        list = list.map((n, i) => (i === victim ? { ...n, img: undefined } : n))
        continue
      }
      if (list.length > 1) {
        list = list.slice(0, -1)
        continue
      }
      return list // one note and still failing — storage is unusable
    }
  }
  return list
}

export interface NotesApi {
  notes: Note[]
  addNote: (text: string, extra?: NoteExtra) => void
  editNote: (id: string, text: string) => void
  deleteNote: (id: string) => void
}

export function useNotes(userId: string | null | undefined): NotesApi {
  const [notes, setNotes] = useState<Note[]>([])
  const storageKey = userId ? `${NOTES_STORAGE_PREFIX}${userId}` : null

  // Identity for this hook instance, so it can ignore its own broadcast.
  const selfId = useRef<string>('')
  if (!selfId.current) selfId.current = Math.random().toString(36).slice(2)

  // Latest list without re-creating the mutators on every change.
  const listRef = useRef<Note[]>([])
  useEffect(() => {
    listRef.current = notes
  }, [notes])

  // Load whenever the signed-in user changes (and clear when signed out).
  useEffect(() => {
    if (!storageKey) {
      setNotes([])
      listRef.current = []
      return
    }
    try {
      const raw = localStorage.getItem(storageKey)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      const next: Note[] = Array.isArray(parsed)
        ? (parsed as Note[]).filter((n) => n && typeof n.text === 'string')
        : []
      setNotes(next)
      listRef.current = next
    } catch {
      setNotes([])
      listRef.current = []
    }
  }, [storageKey])

  // Adopt mutations made by any other useNotes instance on this key.
  useEffect(() => {
    if (!storageKey) return
    const onChanged = (e: Event) => {
      const d = (e as CustomEvent<NotesEventDetail>).detail
      if (!d || d.key !== storageKey || d.from === selfId.current) return
      setNotes(d.notes)
      listRef.current = d.notes
    }
    window.addEventListener(NOTES_EVENT, onChanged as EventListener)
    return () => window.removeEventListener(NOTES_EVENT, onChanged as EventListener)
  }, [storageKey])

  // Single write path: persist (shedding images if over quota), set state to
  // whatever actually landed, then tell the other instances.
  const apply = useCallback(
    (next: Note[]) => {
      const landed = storageKey ? writeStore(storageKey, next) : next
      listRef.current = landed
      setNotes(landed)
      if (storageKey) {
        try {
          window.dispatchEvent(
            new CustomEvent<NotesEventDetail>(NOTES_EVENT, {
              detail: { key: storageKey, notes: landed, from: selfId.current },
            }),
          )
        } catch {
          /* ignore */
        }
      }
    },
    [storageKey],
  )

  /** Add a note. `text` may be empty when `extra.img` is set (an image-only clip). */
  const addNote = useCallback(
    (text: string, extra?: NoteExtra) => {
      const t = (text || '').trim()
      if (!t && !extra?.img) return
      const note: Note = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: t,
        ts: Date.now(),
        ...(extra?.img ? { img: extra.img } : {}),
        ...(extra?.src ? { src: extra.src } : {}),
      }
      apply([note, ...listRef.current])
    },
    [apply],
  )

  const editNote = useCallback(
    (id: string, text: string) => {
      const t = text.trim()
      const cur = listRef.current
      const target = cur.find((n) => n.id === id)
      // Emptied → delete, UNLESS the note is a clip (the image is the content).
      if (!t && !target?.img) {
        apply(cur.filter((n) => n.id !== id))
        return
      }
      apply(cur.map((n) => (n.id === id ? { ...n, text: t } : n)))
    },
    [apply],
  )

  const deleteNote = useCallback(
    (id: string) => {
      apply(listRef.current.filter((n) => n.id !== id))
    },
    [apply],
  )

  return { notes, addNote, editNote, deleteNote }
}

export function formatNoteTime(ts: number): string {
  try {
    const d = new Date(ts)
    const now = new Date()
    const sameDay = d.toDateString() === now.toDateString()
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    if (sameDay) return time
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`
  } catch {
    return ''
  }
}

// ─── clip pop-out ────────────────────────────────────────────────────────────

/**
 * Full-viewport viewer for a clip image.
 *
 * NOT the Card `ExpandStageHost` (design/primitives/Expand.tsx): that stage is
 * an `absolute inset-0` layer inside the PAGE COLUMN, and the notes dock is not
 * in the page column — a clip expanded onto it would be clipped by the dock's
 * own 320px `overflow-hidden` box, which is the whole problem. A clip is also a
 * read-and-dismiss thing, not a card you keep working in, so covering the rail
 * and toolbar for the few seconds it is up costs nothing.
 *
 * Portalled to `document.body` for the same reason LadderModal is: every
 * ancestor here (the dock, the note card) clips or stacks.
 *
 * Escape or a click on the backdrop closes. Clicking the image toggles fit ↔
 * actual size — a dense chart clip captured on a wide monitor is unreadable
 * shrunk to fit a laptop screen, so 1:1 with scroll is the second gear.
 */
function ClipLightbox({ note, onClose }: { note: Note; onClose: () => void }) {
  const [actual, setActual] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    // The page behind must not scroll under the overlay.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={note.text || note.src || 'Clip'}
      onClick={onClose}
      // The four properties that decide whether this is visible AT ALL — fixed,
      // full-viewport, above everything, opaque ground — are inline rather than
      // utilities. The overlay is portalled onto <body>, outside the app root and
      // therefore outside anything the page's own stacking contexts can help
      // with: if one of these classes were ever purged or shadowed, the clip
      // would open into a 0×0 transparent box and read as a dead button.
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '56px 32px 32px',
        background: 'color-mix(in srgb, var(--color-bg) 90%, transparent)',
      }}
    >
      {/* caption — source, text, time */}
      {(note.src || note.text) && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-6 right-16 top-4 flex min-w-0 items-baseline gap-2.5"
        >
          {note.src && (
            <span className="shrink-0 text-3xs font-bold uppercase tracking-[0.06em] text-accent">
              {note.src}
            </span>
          )}
          {note.text && <span className="truncate text-xs text-muted">{note.text}</span>}
          <span className="tabular ml-auto shrink-0 whitespace-nowrap text-2xs text-faint opacity-60">
            {formatNoteTime(note.ts)}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        aria-label="Close clip"
        className="absolute right-4 top-3 flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface2 text-fg"
      >
        <CloseIcon size={15} />
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        // min-height:0 is what lets `max-height:100%` on the image mean anything:
        // without it this flex child refuses to shrink and the image renders at
        // its natural size, half of it under the edge of the screen.
        style={{
          display: 'flex',
          minHeight: 0,
          maxWidth: '100%',
          maxHeight: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: actual ? 'auto' : 'hidden',
        }}
      >
        <img
          src={note.img}
          alt={note.text || 'Clip'}
          onClick={() => setActual((a) => !a)}
          title={actual ? 'Fit to screen' : 'Actual size'}
          className="block rounded-md border border-line"
          style={
            actual
              ? { maxWidth: 'none', maxHeight: 'none', cursor: 'zoom-out' }
              : { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'zoom-in' }
          }
        />
      </div>
    </div>,
    document.body,
  )
}

// ─── notes body (add box + list) ─────────────────────────────────────────────

const INPUT =
  'w-full rounded-md border border-line bg-surface2 px-2.5 py-2 text-sm text-fg outline-none placeholder:text-faint placeholder:opacity-50'

export function NotesBody({ notes, addNote, editNote, deleteNote }: NotesApi) {
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  // Clip popped out over the page — see ClipLightbox.
  const [lightboxId, setLightboxId] = useState<string | null>(null)
  const lightboxNote = lightboxId ? notes.find((n) => n.id === lightboxId && n.img) : undefined
  // Deleting the clip that is popped out must not leave a dangling overlay.
  useEffect(() => {
    if (lightboxId && !lightboxNote) setLightboxId(null)
  }, [lightboxId, lightboxNote])

  const submitDraft = () => {
    addNote(draft)
    setDraft('')
  }
  const startEdit = (n: Note) => {
    setEditingId(n.id)
    setEditText(n.text)
  }
  const commitEdit = () => {
    if (editingId) editNote(editingId, editText)
    setEditingId(null)
    setEditText('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* add box */}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submitDraft()
          }
        }}
        placeholder="Add a note…"
        className={`${INPUT} shrink-0`}
      />

      {/* list (newest first) — scrolls if it grows */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {notes.length === 0 && (
          <div className="px-0.5 py-2 text-sm leading-relaxed text-muted opacity-60">
            No notes yet. Type above and press Enter.
          </div>
        )}
        {notes.map((n) => {
          const editing = editingId === n.id
          const hot = hoveredId === n.id
          return (
            <div
              key={n.id}
              onMouseEnter={() => setHoveredId(n.id)}
              onMouseLeave={() => setHoveredId((h) => (h === n.id ? null : h))}
              className={[
                'rounded-md border p-2.5 transition-colors',
                hot ? 'border-accent bg-raised' : 'border-line bg-surface2',
              ].join(' ')}
            >
              {editing ? (
                <textarea
                  value={editText}
                  autoFocus
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      commitEdit()
                    }
                    if (e.key === 'Escape') {
                      setEditingId(null)
                      setEditText('')
                    }
                  }}
                  onBlur={commitEdit}
                  rows={2}
                  className={`${INPUT} resize-none`}
                />
              ) : (
                <>
                  {/* text + timestamp on the same first row */}
                  <div className="flex items-baseline gap-2">
                    <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-snug text-fg">
                      {n.text}
                    </div>
                    <span className="tabular shrink-0 whitespace-nowrap text-2xs font-semibold text-faint opacity-60">
                      {formatNoteTime(n.ts)}
                    </span>
                  </div>

                  {/* where it came from */}
                  {n.src && (
                    <div className="mt-1 truncate text-3xs font-bold uppercase tracking-[0.06em] text-accent opacity-80">
                      {n.src}
                    </div>
                  )}

                  {/* Clip image. CLICKING THE PICTURE POPS IT OUT — that is the
                      thing the zoom-in cursor promises, and the only thing it
                      can honestly promise: the previous behaviour grew the
                      thumbnail in place, which inside a 320px dock is a change
                      you can barely see and reads as a dead click. The corner
                      button does the same thing, for anyone who looks for a
                      control rather than clicking the image. */}
                  {n.img && (
                    <div className="relative mt-2">
                      <img
                        src={n.img}
                        alt={n.text || 'Clip'}
                        onClick={() => setLightboxId(n.id)}
                        title="Expand"
                        style={{ maxHeight: 260 }}
                        className="block w-full cursor-zoom-in rounded-sm border border-line object-cover object-top"
                      />
                      <button
                        type="button"
                        aria-label="Expand clip"
                        title="Expand"
                        onClick={(e) => {
                          e.stopPropagation()
                          setLightboxId(n.id)
                        }}
                        className={[
                          'absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center',
                          'rounded-sm border border-line bg-bg/80 text-fg transition-opacity',
                          hot ? 'opacity-100' : 'opacity-50',
                        ].join(' ')}
                      >
                        <ExpandIcon size={13} />
                      </button>
                    </div>
                  )}

                  {/* edit/delete reveal on hover */}
                  <div
                    className={[
                      'flex items-center justify-end gap-1 overflow-hidden transition-all',
                      hot ? 'mt-1 h-5 opacity-100' : 'h-0 opacity-0',
                    ].join(' ')}
                  >
                    <button
                      type="button"
                      aria-label="Edit note"
                      onClick={() => startEdit(n)}
                      className="flex h-5 w-5 items-center justify-center rounded-sm text-accent"
                    >
                      <PencilIcon size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete note"
                      onClick={() => deleteNote(n.id)}
                      className="flex h-5 w-5 items-center justify-center rounded-sm text-down"
                    >
                      <CloseIcon size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {lightboxNote && <ClipLightbox note={lightboxNote} onClose={() => setLightboxId(null)} />}
    </div>
  )
}
