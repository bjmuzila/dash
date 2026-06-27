"use client";

import { useEffect, useState } from "react";
import { HOME_THEME } from "./homeTheme";

// Notes are stored per Clerk user: `${NOTES_STORAGE_PREFIX}${userId}`.
// Key kept identical to the old sidebar implementation so existing notes carry over.
const NOTES_STORAGE_PREFIX = "sidebar-notes-v1:";

export type Note = { id: string; text: string; ts: number };

// ─── icon ────────────────────────────────────────────────────────────────────
type IconProps = { size?: number };
export const NoteIcon = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16v12l-4 4H4z" /><path d="M16 20v-4h4" /><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="13" x2="12" y2="13" />
  </svg>
);
const PencilIcon = ({ size = 12 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
);
const CloseIcon = ({ size = 12 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);

// ─── hook (per-user, localStorage) ────────────────────────────────────────────
// Quick-jot notes. Stored per Clerk user so different logins on the same browser
// don't share notes. Persists across resets/reloads.
export function useNotes(userId: string | null | undefined) {
  const [notes, setNotes] = useState<Note[]>([]);
  const storageKey = userId ? `${NOTES_STORAGE_PREFIX}${userId}` : null;

  // Load whenever the signed-in user changes (and clear when signed out).
  useEffect(() => {
    if (!storageKey) { setNotes([]); return; }
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setNotes(Array.isArray(parsed) ? parsed.filter((n) => n && typeof n.text === "string") : []);
    } catch {
      setNotes([]);
    }
  }, [storageKey]);

  const persist = (next: Note[]) => {
    if (storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
    }
    return next;
  };

  const addNote = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setNotes((prev) => persist([{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: t, ts: Date.now() }, ...prev]));
  };
  const editNote = (id: string, text: string) => {
    const t = text.trim();
    setNotes((prev) => {
      if (!t) return persist(prev.filter((n) => n.id !== id)); // emptied → delete
      return persist(prev.map((n) => (n.id === id ? { ...n, text: t } : n)));
    });
  };
  const deleteNote = (id: string) =>
    setNotes((prev) => persist(prev.filter((n) => n.id !== id)));

  return { notes, addNote, editNote, deleteNote };
}

export function formatNoteTime(ts: number): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (sameDay) return time;
    return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
  } catch {
    return "";
  }
}

// ─── notes body (add box + list) — used by the toolbar slide-out panel ─────────
export function NotesBody({
  notes,
  addNote,
  editNote,
  deleteNote,
  maxListHeight,
}: {
  notes: Note[];
  addNote: (text: string) => void;
  editNote: (id: string, text: string) => void;
  deleteNote: (id: string) => void;
  maxListHeight?: number | string;
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const submitDraft = () => { addNote(draft); setDraft(""); };
  const startEdit = (n: Note) => { setEditingId(n.id); setEditText(n.text); };
  const commitEdit = () => { if (editingId) editNote(editingId, editText); setEditingId(null); setEditText(""); };

  // Glass input matching the app's card system: translucent panel bg, blur,
  // rounded, near-invisible hairline border.
  const inputBase: React.CSSProperties = {
    width: "100%",
    resize: "none",
    background: "rgba(13,17,25,0.45)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 12,
    color: HOME_THEME.text,
    fontSize: 13,
    fontFamily: "inherit",
    padding: "8px 10px",
    outline: "none",
    lineHeight: 1.4,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      {/* add box */}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitDraft(); } }}
        placeholder="Add a note…"
        style={{ ...inputBase, padding: "9px 11px", flexShrink: 0 }}
      />

      {/* list (newest first) — scrolls if it grows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, overflowY: "auto", maxHeight: maxListHeight, flex: 1, minHeight: 0, scrollbarWidth: "thin" }}>
        {notes.length === 0 && (
          <div style={{ fontSize: 12, color: HOME_THEME.muted, padding: "8px 2px", lineHeight: 1.5 }}>
            No notes yet. Type above and press Enter.
          </div>
        )}
        {notes.map((n) => {
          const editing = editingId === n.id;
          return (
            <div
              key={n.id}
              onMouseEnter={() => setHoveredId(n.id)}
              onMouseLeave={() => setHoveredId((h) => (h === n.id ? null : h))}
              style={{
                // Glass card: faint cyan-tinted translucent fill, blur, almost
                // borderless. Matches the app's panel/card system.
                background: hoveredId === n.id
                  ? "linear-gradient(180deg, rgba(33,158,188,0.07), rgba(13,17,25,0.5))"
                  : "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(13,17,25,0.45))",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                border: `1px solid ${hoveredId === n.id ? "rgba(33,158,188,0.18)" : "rgba(255,255,255,0.05)"}`,
                borderRadius: 14,
                padding: "10px 12px",
                boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
                transition: "background 0.15s, border-color 0.15s",
              }}
            >
              {editing ? (
                <textarea
                  value={editText}
                  autoFocus
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(); }
                    if (e.key === "Escape") { setEditingId(null); setEditText(""); }
                  }}
                  onBlur={commitEdit}
                  rows={2}
                  style={inputBase}
                />
              ) : (
                <>
                  {/* text + timestamp on the same first row */}
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: HOME_THEME.text, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.45 }}>{n.text}</div>
                    <span style={{ flexShrink: 0, fontSize: 9, color: HOME_THEME.muted, fontWeight: 600, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>{formatNoteTime(n.ts)}</span>
                  </div>
                  {/* edit/delete reveal on hover */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, height: hoveredId === n.id ? 22 : 0, marginTop: hoveredId === n.id ? 4 : 0, overflow: "hidden", transition: "height 0.15s, margin-top 0.15s" }}>
                    <button
                      aria-label="Edit note"
                      onClick={() => startEdit(n)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 7, background: "transparent", border: "none", color: HOME_THEME.cyan, cursor: "pointer", padding: 0, opacity: hoveredId === n.id ? 0.85 : 0, transition: "opacity 0.15s" }}
                    >
                      <PencilIcon size={13} />
                    </button>
                    <button
                      aria-label="Delete note"
                      onClick={() => deleteNote(n.id)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 7, background: "transparent", border: "none", color: HOME_THEME.red, cursor: "pointer", padding: 0, opacity: hoveredId === n.id ? 0.85 : 0, transition: "opacity 0.15s" }}
                    >
                      <CloseIcon size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
