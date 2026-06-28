"use client";

import { useUser } from "@clerk/nextjs";
import { HOME_THEME } from "./homeTheme";
import { useNotes, NotesBody } from "./notes";
import { useNotesPanel } from "./NotesPanelContext";
import ChatPanel from "./ChatPanel";

const PANEL_WIDTH = 320;

/**
 * NotesDock — right-side companion panel, a flex sibling of <main> (see
 * LayoutShell). Like the left sidebar, it pushes page content rather than
 * floating over it: open = `PANEL_WIDTH`, closed = 0 (fully gone). No backdrop
 * and no blur over the page. Toggled by the 🖍️ NOTES button in GlobalToolbar.
 */
export default function NotesDock() {
  const { isSignedIn, user } = useUser();
  const { open, closePanel } = useNotesPanel();
  const { notes, addNote, editNote, deleteNote } = useNotes(user?.id);

  if (!isSignedIn) return null;

  return (
    <aside
      aria-label="Notes"
      aria-hidden={!open}
      style={{
        flexShrink: 0,
        width: open ? PANEL_WIDTH : 0,
        maxWidth: "92vw",
        height: "100%",
        overflow: "hidden",
        borderLeft: open ? `1px solid ${HOME_THEME.border}` : "1px solid transparent",
        background: HOME_THEME.panel,
        transition: "width 0.24s ease, border-color 0.24s ease",
        position: "relative",
        zIndex: 2,
      }}
    >
      {/* Fixed-width inner so content doesn't reflow/squish while width animates. */}
      <div
        style={{
          width: PANEL_WIDTH,
          maxWidth: "92vw",
          height: "100%",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          padding: "16px 16px 20px",
        }}
      >
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexShrink: 0, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>🖍️</span>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.text }}>Notes</span>
            {notes.length > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, color: HOME_THEME.muted }}>{notes.length}</span>
            )}
          </div>
          <button
            onClick={closePanel}
            aria-label="Close notes"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, background: "rgba(255,255,255,0.05)", border: `1px solid ${HOME_THEME.border}`, color: HOME_THEME.muted, cursor: "pointer" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* notes body — top region, scrolls within its own space */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <NotesBody notes={notes} addNote={addNote} editNote={editNote} deleteNote={deleteNote} />
        </div>

        {/* chat — pinned to the bottom of the dock, below a divider */}
        <div
          style={{
            flexShrink: 0,
            marginTop: 14,
            paddingTop: 14,
            borderTop: `1px solid ${HOME_THEME.border}`,
            display: "flex",
            flexDirection: "column",
            maxHeight: "45%",
          }}
        >
          <ChatPanel />
        </div>
      </div>
    </aside>
  );
}
