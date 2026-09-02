import { useCallback, useEffect, useRef, useState } from 'react'

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

// ─── notes body (add box + list) ─────────────────────────────────────────────

const INPUT =
  'w-full rounded-md border border-line bg-surface2 px-2.5 py-2 text-sm text-fg outline-none placeholder:text-faint placeholder:opacity-50'

export function NotesBody({ notes, addNote, editNote, deleteNote }: NotesApi) {
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  // Clip whose image is expanded to full panel width (thumbnails otherwise).
  const [zoomId, setZoomId] = useState<string | null>(null)

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
          const zoomed = zoomId === n.id
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

                  {/* clip image — thumbnail, click to expand in place */}
                  {n.img && (
                    <img
                      src={n.img}
                      alt={n.text || 'Clip'}
                      onClick={() => setZoomId((z) => (z === n.id ? null : n.id))}
                      title={zoomed ? 'Shrink' : 'Expand'}
                      style={{ maxHeight: zoomed ? 'none' : 120 }}
                      className={[
                        'mt-2 block w-full rounded-sm border border-line object-top',
                        zoomed ? 'cursor-zoom-out object-contain' : 'cursor-zoom-in object-cover',
                      ].join(' ')}
                    />
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
    </div>
  )
}
