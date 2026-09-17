import { useAuth } from '@/data/auth'
import { useIsPhone } from '@/design/useIsPhone'
import { NotesBody, useNotes } from '@/shell/notes'
import { useNotesPanel } from '@/shell/NotesPanelContext'
import QuickProbe from '@/shell/QuickProbe'

// ─────────────────────────────────────────────────────────────────────────────
// NOTES DOCK — the right-side companion panel.
//
// v2's components/shared/NotesDock.tsx, rebuilt on v3 tokens. Like the left
// rail it is a flex SIBLING of the page column, so it pushes content rather than
// floating over it: open = PANEL_WIDTH, closed = 0 (fully gone). No backdrop, no
// blur over the page. Toggled by the pencil NOTES button in the toolbar.
//
// The Quick Probe card at the top is owner-only and renders nothing at all for
// anyone else — see shell/QuickProbe.tsx.
// ─────────────────────────────────────────────────────────────────────────────

const PANEL_WIDTH = 320

export default function NotesDock() {
  const { isSignedIn, userId } = useAuth()
  const { open, closePanel } = useNotesPanel()
  const { notes, addNote, editNote, deleteNote } = useNotes(userId)
  const isPhone = useIsPhone()

  // Desktop-only, exactly as in v2: a 320px drawer on a 390px viewport is the
  // screen with a margin. Disabled on a phone even if a prior desktop session
  // left it open in persisted state.
  if (!isSignedIn || isPhone) return null

  return (
    <aside
      aria-label="Notes"
      aria-hidden={!open}
      // Marks the dock as off-limits to any right-click "Add to Notes" menu —
      // inside the panel the native menu is the useful one.
      data-notes-dock
      style={{ width: open ? PANEL_WIDTH : 0 }}
      className={[
        'relative h-full max-w-[92vw] shrink-0 overflow-hidden bg-surface transition-[width,border-color] duration-200',
        open ? 'border-l border-line' : 'border-l border-transparent',
      ].join(' ')}
    >
      {/* Fixed-width inner so content doesn't reflow while the width animates. */}
      <div
        style={{ width: PANEL_WIDTH }}
        className="flex h-full max-w-[92vw] flex-col gap-0 px-4 pb-5 pt-4"
      >
        {/* header */}
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-base leading-none">
              🖍️
            </span>
            <span className="text-sm font-bold uppercase tracking-[0.14em] text-fg">Notes</span>
            {notes.length > 0 && <span className="tabular text-xs font-bold text-faint opacity-60">{notes.length}</span>}
          </div>
          <button
            type="button"
            onClick={closePanel}
            aria-label="Close notes"
            className="flex h-6 w-6 items-center justify-center rounded-sm border border-line bg-raised text-muted"
          >
            <svg
              width="13"
              height="13"
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
          </button>
        </div>

        {/* quick probe — owner only; renders nothing for everyone else.
            Capped + scrollable so an open probe can't push the notes list out
            of the dock on a short window. */}
        <div className="max-h-[62%] shrink-0 overflow-y-auto">
          <QuickProbe />
        </div>

        {/* notes body — scrolls within its own space */}
        <div className="flex min-h-0 flex-1 flex-col">
          <NotesBody notes={notes} addNote={addNote} editNote={editNote} deleteNote={deleteNote} />
        </div>
      </div>
    </aside>
  )
}
