"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HOME_THEME } from "./homeTheme";

// Notes are stored per Clerk user: `${NOTES_STORAGE_PREFIX}${userId}`.
// Key kept identical to the old sidebar implementation so existing notes carry over.
const NOTES_STORAGE_PREFIX = "sidebar-notes-v1:";

/**
 * Cross-instance sync event.
 *
 * `useNotes` is called in several places at once (GlobalToolbar for the count
 * badge, NotesDock for the list, NoteClipMenu for the right-click "+ Notes"
 * action) and each call is its own `useState`. Without a broadcast, a note added
 * from the clip menu would sit in localStorage while the open dock and the count
 * badge kept showing the old list until a remount. Every mutation now dispatches
 * this event with the new array and every other instance on the same storage key
 * adopts it.
 */
const NOTES_EVENT = "cb-notes-changed";
type NotesEventDetail = { key: string; notes: Note[]; from: string };

export type Note = {
  id: string;
  text: string;
  ts: number;
  /** JPEG/PNG data URL — set for clips captured from a chart/panel (see NoteClipMenu). */
  img?: string;
  /** Where the note came from, e.g. "ES Candles — GEX Chart". */
  src?: string;
};

/** Extra fields a caller can attach when adding a note. */
export type NoteExtra = { img?: string; src?: string };

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

/**
 * Write the list to localStorage, shedding weight until it fits.
 *
 * Clip notes carry a base64 image, so the notes key can now realistically reach
 * the ~5MB origin quota — and a `setItem` that throws used to leave the in-memory
 * list and storage silently out of sync (the note vanished on reload). On
 * QuotaExceeded we drop the OLDEST image first (that note's text survives), then
 * whole oldest notes as a last resort, and return the list that actually landed
 * so state can be set to it.
 */
function writeStore(key: string, wanted: Note[]): Note[] {
  let list = wanted;
  for (let guard = 0; guard < 200; guard++) {
    try {
      localStorage.setItem(key, JSON.stringify(list));
      return list;
    } catch {
      // Oldest note carrying an image (list is newest-first).
      let victim = -1;
      for (let i = list.length - 1; i >= 0; i--) if (list[i].img) { victim = i; break; }
      if (victim >= 0) {
        list = list.map((n, i) => (i === victim ? { ...n, img: undefined } : n));
        continue;
      }
      if (list.length > 1) { list = list.slice(0, -1); continue; }
      return list; // one note and still failing — storage is unusable
    }
  }
  return list;
}

// ─── hook (per-user, localStorage) ────────────────────────────────────────────
// Quick-jot notes. Stored per Clerk user so different logins on the same browser
// don't share notes. Persists across resets/reloads.
export function useNotes(userId: string | null | undefined) {
  const [notes, setNotes] = useState<Note[]>([]);
  const storageKey = userId ? `${NOTES_STORAGE_PREFIX}${userId}` : null;

  // Identity for this hook instance, so it can ignore its own broadcast.
  const selfId = useRef<string>("");
  if (!selfId.current) selfId.current = Math.random().toString(36).slice(2);

  // Latest list without re-creating the mutators on every change (the clip menu
  // holds onto `addNote` across a long async capture).
  const listRef = useRef<Note[]>([]);
  useEffect(() => { listRef.current = notes; }, [notes]);

  // Load whenever the signed-in user changes (and clear when signed out).
  useEffect(() => {
    if (!storageKey) { setNotes([]); listRef.current = []; return; }
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      const next: Note[] = Array.isArray(parsed) ? parsed.filter((n) => n && typeof n.text === "string") : [];
      setNotes(next);
      listRef.current = next;
    } catch {
      setNotes([]);
      listRef.current = [];
    }
  }, [storageKey]);

  // Adopt mutations made by any other useNotes instance on this key.
  useEffect(() => {
    if (!storageKey) return;
    const onChanged = (e: Event) => {
      const d = (e as CustomEvent<NotesEventDetail>).detail;
      if (!d || d.key !== storageKey || d.from === selfId.current) return;
      setNotes(d.notes);
      listRef.current = d.notes;
    };
    window.addEventListener(NOTES_EVENT, onChanged as EventListener);
    return () => window.removeEventListener(NOTES_EVENT, onChanged as EventListener);
  }, [storageKey]);

  // Single write path: persist (shedding images if over quota), set state to
  // whatever actually landed, then tell the other instances.
  const apply = useCallback((next: Note[]) => {
    const landed = storageKey ? writeStore(storageKey, next) : next;
    listRef.current = landed;
    setNotes(landed);
    if (storageKey) {
      try {
        window.dispatchEvent(new CustomEvent<NotesEventDetail>(NOTES_EVENT, {
          detail: { key: storageKey, notes: landed, from: selfId.current },
        }));
      } catch { /* ignore */ }
    }
  }, [storageKey]);

  /** Add a note. `text` may be empty when `extra.img` is set (an image-only clip). */
  const addNote = useCallback((text: string, extra?: NoteExtra) => {
    const t = (text || "").trim();
    if (!t && !extra?.img) return;
    const note: Note = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: t,
      ts: Date.now(),
      ...(extra?.img ? { img: extra.img } : {}),
      ...(extra?.src ? { src: extra.src } : {}),
    };
    apply([note, ...listRef.current]);
  }, [apply]);

  const editNote = useCallback((id: string, text: string) => {
    const t = text.trim();
    const cur = listRef.current;
    const target = cur.find((n) => n.id === id);
    // Emptied → delete, UNLESS the note is a clip (the image is the content).
    if (!t && !target?.img) { apply(cur.filter((n) => n.id !== id)); return; }
    apply(cur.map((n) => (n.id === id ? { ...n, text: t } : n)));
  }, [apply]);

  const deleteNote = useCallback((id: string) => {
    apply(listRef.current.filter((n) => n.id !== id));
  }, [apply]);

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
  addNote: (text: string, extra?: NoteExtra) => void;
  editNote: (id: string, text: string) => void;
  deleteNote: (id: string) => void;
  maxListHeight?: number | string;
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Clip whose image is expanded to full panel width (thumbnails otherwise).
  const [zoomId, setZoomId] = useState<string | null>(null);

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
    fontSize: 14,
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
          <div style={{ fontSize: 14, color: HOME_THEME.muted, padding: "8px 2px", lineHeight: 1.5 }}>
            No notes yet. Type above and press Enter — or right-click highlighted
            text or any chart on a page and choose “Add to Notes”.
          </div>
        )}
        {notes.map((n) => {
          const editing = editingId === n.id;
          const zoomed = zoomId === n.id;
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
                    <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: HOME_THEME.text, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.45 }}>{n.text}</div>
                    <span style={{ flexShrink: 0, fontSize: 14, color: HOME_THEME.muted, fontWeight: 600, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>{formatNoteTime(n.ts)}</span>
                  </div>

                  {/* where it came from (right-click captures) */}
                  {n.src && (
                    <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: HOME_THEME.cyan, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {n.src}
                    </div>
                  )}

                  {/* clip image — thumbnail, click to expand in place */}
                  {n.img && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={n.img}
                      alt={n.text || "Clip"}
                      onClick={() => setZoomId((z) => (z === n.id ? null : n.id))}
                      title={zoomed ? "Shrink" : "Expand"}
                      style={{
                        display: "block",
                        marginTop: 8,
                        width: "100%",
                        maxHeight: zoomed ? "none" : 120,
                        objectFit: zoomed ? "contain" : "cover",
                        objectPosition: "top left",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.08)",
                        cursor: zoomed ? "zoom-out" : "zoom-in",
                      }}
                    />
                  )}

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
