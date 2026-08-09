import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { useNotes, useCreateNote, useDeleteNote } from '../hooks'
import { ApiError, type Note } from '../api'
import { T, sectionTitle, label, body, quote, section, input, button } from '../theme'

/**
 * Journal — everything captured, newest first.
 *
 * Today's journal card is the CAPTURE half of this screen; this is the archive.
 * Both write the same `hh_notes` rows through the same endpoint, so there is no
 * second store to keep in sync.
 *
 * Entries are grouped by day rather than listed flat. A journal read back is
 * read by date ("what was going on that week"), and an undivided list of
 * timestamps makes that a scanning exercise.
 */
export default function Journal() {
  const { user } = useAuth()
  const { data, isLoading } = useNotes()
  const del = useDeleteNote()
  const [filter, setFilter] = useState<'journal' | 'all'>('journal')

  const all = data?.notes ?? []
  // 'journal' is what this screen writes; 'note' and 'quote' are the older
  // Saved-notes kinds. Defaulting to journal-only keeps a years-old quote pool
  // from burying this week's entries, and the toggle is there when you want it.
  const shown = filter === 'journal' ? all.filter((n) => n.kind === 'journal') : all
  const days = groupByDay(shown)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Capture />

      <div style={section()}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <span style={sectionTitle()}>Entries</span>
          <button
            onClick={() => setFilter((f) => (f === 'journal' ? 'all' : 'journal'))}
            style={{ ...label({ color: T.accent }), background: 'none', border: 'none',
                     cursor: 'pointer', padding: '6px 0', minHeight: 34 }}
          >
            {filter === 'journal' ? 'Show saved notes too' : 'Journal only'}
          </button>
        </div>

        {isLoading && <Muted>Loading…</Muted>}
        {!isLoading && shown.length === 0 && (
          <Muted>
            {filter === 'journal'
              ? 'Nothing yet. The box above is the whole feature.'
              : 'Nothing saved yet.'}
          </Muted>
        )}

        {days.map(([day, notes]) => (
          <div key={day} style={{ marginTop: 18 }}>
            <div style={label({ letterSpacing: '0.1em' })}>{dayLabel(day)}</div>
            {notes.map((n) => (
              <Entry key={n.id} note={n} mine={n.owner_id === user?.id}
                     onDelete={() => del.mutate(n.id)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Capture ──────────────────────────────────────────────────────────────────

/** The same box as Today's card, so the muscle memory carries between them. */
function Capture() {
  const create = useCreateNote()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || create.isPending) return
    setError(null)
    // Cleared before the request resolves — on a phone the keyboard is still up
    // and the next sentence is already coming.
    setText('')
    try {
      await create.mutateAsync({ body: t, kind: 'journal' })
    } catch (err) {
      setText(t)
      setError(err instanceof ApiError ? err.message : 'Could not save that.')
    }
  }

  return (
    <form onSubmit={submit} style={section()}>
      <div style={sectionTitle()}>New entry</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What's on your mind today?"
        rows={4}
        style={{ ...input(), marginTop: 11, minHeight: 110, resize: 'vertical', lineHeight: 1.5 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 12, marginTop: 10 }}>
        <span style={label({ letterSpacing: '0.06em' })}>
          {text.trim() ? `${text.trim().length} characters` : 'Shared with the household'}
        </span>
        <button type="submit" disabled={!text.trim() || create.isPending}
                style={button(text.trim() ? 'primary' : 'ghost')}>
          {create.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <div style={label({ color: T.bad, marginTop: 9, letterSpacing: '0.06em' })}>{error}</div>}
    </form>
  )
}

// ── Entry ────────────────────────────────────────────────────────────────────

/**
 * One entry. Delete is behind a confirm step rather than a single tap: this is
 * the one screen where the content is unrecoverable — a task can be retyped, a
 * thought from a Tuesday in March cannot.
 */
function Entry({ note, mine, onDelete }: { note: Note; mine: boolean; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div style={{ padding: '13px 0', borderTop: `1px solid ${T.rule}` }}>
      <div style={note.kind === 'quote' ? quote() : { ...body(15), whiteSpace: 'pre-wrap' }}>
        {note.body}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <span style={label({ letterSpacing: '0.08em' })}>
          {timeOf(note.created_at)}
          {note.kind !== 'journal' ? ` · ${note.kind}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {/* Only the person who wrote it can delete it — the server enforces
            this too; hiding the control just stops the pointless 403. */}
        {mine && (confirming ? (
          <>
            <button onClick={onDelete}
                    style={{ ...label({ color: T.bad }), background: 'none', border: 'none',
                             cursor: 'pointer', padding: '8px 0', minHeight: 34 }}>
              Delete
            </button>
            <button onClick={() => setConfirming(false)}
                    style={{ ...label(), background: 'none', border: 'none',
                             cursor: 'pointer', padding: '8px 0', minHeight: 34 }}>
              Keep
            </button>
          </>
        ) : (
          <button onClick={() => setConfirming(true)}
                  style={{ ...label({ color: T.faint }), background: 'none', border: 'none',
                           cursor: 'pointer', padding: '8px 0', minHeight: 34 }}>
            ×
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Bits ─────────────────────────────────────────────────────────────────────

/** Newest day first, and newest entry first within a day. */
function groupByDay(notes: Note[]): [string, Note[]][] {
  const map = new Map<string, Note[]>()
  for (const n of [...notes].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const d = new Date(n.created_at)
    if (Number.isNaN(d.getTime())) continue
    // Keyed on the LOCAL date, not the ISO string's UTC date — an entry written
    // at 9pm ET otherwise files itself under tomorrow.
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const list = map.get(key)
    if (list) list.push(n)
    else map.set(key, [n])
  }
  return [...map.entries()]
}

function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date()
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (same(date, today)) return 'Today'
  if (same(date, yesterday)) return 'Yesterday'
  return date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    // The year only when it isn't this one — "Mar 4, 2025" reads as history,
    // "Mar 4, 2026" reads as clutter.
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  })
}

function timeOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ ...body(14), color: T.muted, marginTop: 10 }}>{children}</div>
}
