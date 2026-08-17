"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { HOME_THEME } from "./homeTheme";
import { useNotes } from "./notes";
import { useNotesPanel } from "./NotesPanelContext";
import { useMobileNav } from "./MobileNavContext";

/**
 * NoteClipMenu — the app-wide right-click → "Add to Notes" menu.
 *
 * Mounted ONCE by LayoutShell (inside NotesPanelProvider), so it works on every
 * dashboard route without a page opting in. Two things can be clipped:
 *
 *   • HIGHLIGHTED TEXT — right-click with a selection and the selected string
 *     becomes the note's text.
 *   • A CHART OR PANEL — right-click anywhere inside one with nothing selected
 *     and the panel is rendered to a small JPEG (lib/snapshot's captureToCanvas,
 *     the same path the 📸 Snapshot buttons use) and stored on the note.
 *
 * Both land in the same per-user notes list the Notes dock reads
 * (`useNotes` → localStorage), so they show up in the panel immediately — that
 * cross-instance update is what the NOTES_EVENT broadcast in notes.tsx exists for.
 *
 * Deliberate behaviours:
 *   • The NATIVE context menu is never taken away silently. We only
 *     `preventDefault()` when we actually have something to offer, `shift`+right-
 *     click always yields the browser menu, and inputs / links / the notes dock
 *     itself are left alone (that's where Paste / Copy link live).
 *   • A page that has its OWN context menu wins: if the event is already
 *     `defaultPrevented` by the time it reaches window, we stay out of the way.
 *
 * Opting in / labelling (both optional):
 *   • `data-note-clip`  — mark the element that should be photographed for
 *     right-clicks inside it. Without it we walk up to the nearest `.card-hover`
 *     Card, then to a chart's container.
 *   • `data-note-label` — the name to file the clip under. Without it we use the
 *     nearest card heading, then the page name.
 */

// Clip images live in localStorage next to the note text, so they are kept small:
// downscaled to this width and encoded as JPEG. ~40-80KB for a typical panel.
const CLIP_MAX_W = 720;
const CLIP_QUALITY = 0.72;
/** Longest selection stored verbatim; longer runs are trimmed with an ellipsis. */
const MAX_SEL_CHARS = 1200;

type MenuState = {
  x: number;
  y: number;
  /** Selected text, if the right-click happened with a live selection. */
  sel: string;
  /** Element to photograph, if one was resolvable under the cursor. */
  clip: HTMLElement | null;
  /** Human label for the clip target. */
  label: string;
};

/** "/app/es-candles" → "ES Candles" */
function pageLabel(pathname: string): string {
  const trimmed = (pathname || "/")
    .replace(/^\/(app|m)(?=\/)/, "")
    .replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "Home";
  const last = trimmed.split("/").pop() || "Home";
  return last.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The element to photograph for a right-click on `el`, in priority order:
 * an explicit `[data-note-clip]`, the enclosing Card, or a chart's own container.
 * Returns null when there is nothing panel-shaped under the cursor.
 */
function resolveClipTarget(el: HTMLElement): HTMLElement | null {
  const explicit = el.closest<HTMLElement>("[data-note-clip]");
  if (explicit) return explicit;

  const card = el.closest<HTMLElement>(".card-hover");
  if (card) return card;

  // A bare chart (canvas / svg) with no Card around it: photograph the block
  // that contains it, so axes and legends drawn as siblings come along.
  const chart = el.closest("canvas, svg");
  if (chart) {
    const holder = chart.parentElement?.closest<HTMLElement>("div, section, figure");
    if (holder) return holder;
  }
  return null;
}

/** A name to file the clip under. */
function resolveLabel(target: HTMLElement | null, pathname: string): string {
  const page = pageLabel(pathname);
  if (!target) return page;

  const explicit = target.closest<HTMLElement>("[data-note-label]")?.getAttribute("data-note-label");
  if (explicit?.trim()) return `${page} — ${explicit.trim()}`;

  // Card renders its title as the first uppercase header row; any heading works.
  const heading = target.querySelector("h1, h2, h3, h4, [data-card-title]");
  const text = heading?.textContent?.trim().replace(/\s+/g, " ");
  if (text && text.length <= 60) return `${page} — ${text}`;

  return page;
}

/** Render `el` to a small JPEG data URL, or null if the capture fails. */
async function clipToDataUrl(el: HTMLElement): Promise<string | null> {
  try {
    const { captureToCanvas } = await import("@/lib/snapshot");
    const shot = await captureToCanvas(el, {
      background: HOME_THEME.bg,
      // A note thumbnail does not need devicePixelRatio detail, and scale 1 keeps
      // both the capture and the base64 payload small.
      scale: 1,
      // The subtree can hold proxied ticker logos from hosts that send no CORS
      // headers; a tainted canvas would make toDataURL throw and lose the clip.
      allowTaint: false,
      imageTimeout: 2500,
      timeoutMs: 12000,
    });
    const ratio = Math.min(1, CLIP_MAX_W / Math.max(1, shot.width));
    if (ratio === 1) return shot.toDataURL("image/jpeg", CLIP_QUALITY);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(shot.width * ratio));
    out.height = Math.max(1, Math.round(shot.height * ratio));
    const ctx = out.getContext("2d");
    if (!ctx) return shot.toDataURL("image/jpeg", CLIP_QUALITY);
    ctx.fillStyle = HOME_THEME.bg;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(shot, 0, 0, out.width, out.height);
    return out.toDataURL("image/jpeg", CLIP_QUALITY);
  } catch (e) {
    console.error("[NoteClipMenu] clip capture failed", e);
    return null;
  }
}

export default function NoteClipMenu() {
  const { isSignedIn, user } = useAuth();
  const { addNote } = useNotes(user?.id);
  const { openPanel } = useNotesPanel();
  const { isMobile } = useMobileNav();
  const pathname = usePathname();

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The notes dock is desktop-only, so the clip menu is too: on a phone a
  // long-press producing a custom menu would just fight the native one.
  const active = isSignedIn && !isMobile;

  const flash = useCallback((msg: string, ms = 2200) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // ── open on right-click ────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;

    const onContextMenu = (e: MouseEvent) => {
      // Escape hatches: the browser's own menu must stay reachable.
      if (e.shiftKey || e.defaultPrevented) return;

      const el = e.target as HTMLElement | null;
      if (!el || typeof el.closest !== "function") return;

      // Places where the native menu is the useful one (Paste, Copy link,
      // spellcheck) or where a note-of-a-note makes no sense.
      if (el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], a[href], [data-no-note-clip]")) return;
      if (el.closest("[data-notes-dock]")) return;

      const selection = window.getSelection();
      const raw = selection && !selection.isCollapsed ? selection.toString() : "";
      const sel = raw.trim().replace(/[ \t]+\n/g, "\n");
      const clip = resolveClipTarget(el);

      // Nothing to offer → let the browser have the click.
      if (!sel && !clip) return;

      e.preventDefault();
      setMenu({
        x: e.clientX,
        y: e.clientY,
        sel: sel.length > MAX_SEL_CHARS ? `${sel.slice(0, MAX_SEL_CHARS)}…` : sel,
        clip,
        label: resolveLabel(clip, pathname),
      });
    };

    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, [active, pathname]);

  // ── close on anything else ─────────────────────────────────────────────────
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("wheel", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  // Keep the menu on screen (it opens at the cursor, which can be at the edge).
  useEffect(() => {
    if (!menu || !menuRef.current) return;
    const box = menuRef.current;
    // The node is reused between openings, so clear the previous nudge before
    // measuring or the second menu inherits the first one's offset.
    box.style.transform = "none";
    const r = box.getBoundingClientRect();
    const pad = 8;
    let dx = 0;
    let dy = 0;
    if (r.right > window.innerWidth - pad) dx = window.innerWidth - pad - r.right;
    if (r.bottom > window.innerHeight - pad) dy = window.innerHeight - pad - r.bottom;
    if (dx || dy) box.style.transform = `translate(${dx}px, ${dy}px)`;
  }, [menu]);

  // ── actions ────────────────────────────────────────────────────────────────
  const addSelection = useCallback((m: MenuState) => {
    setMenu(null);
    addNote(m.sel, { src: m.label });
    // The dock pushes page content when it opens, so opening it on every clip
    // would shove the chart you are reading sideways. The toast is the receipt;
    // click it to open the panel.
    flash("Added to Notes");
  }, [addNote, flash]);

  const addClip = useCallback(async (m: MenuState) => {
    setMenu(null);
    if (!m.clip) return;
    flash("Capturing…", 20000);
    const img = await clipToDataUrl(m.clip);
    if (!img) {
      // Capture failed — still file the note so the reference isn't lost.
      addNote(m.label, { src: m.label });
      flash("Snapshot failed — filed the note without the image", 3200);
      return;
    }
    addNote(m.label, { img, src: m.label });
    flash("Clip added to Notes");
  }, [addNote, flash]);

  if (!active) return null;

  const itemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: "100%",
    padding: "8px 11px",
    borderRadius: 9,
    border: "1px solid transparent",
    background: "transparent",
    color: HOME_THEME.text,
    font: "inherit",
    fontSize: 13,
    fontWeight: 600,
    textAlign: "left",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
  const hoverOn = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = "rgba(33,158,188,0.14)";
    e.currentTarget.style.borderColor = "rgba(33,158,188,0.45)";
  };
  const hoverOff = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = "transparent";
    e.currentTarget.style.borderColor = "transparent";
  };

  return (
    <>
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Add to notes"
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: "fixed",
            left: menu.x + 2,
            top: menu.y + 2,
            zIndex: 9999,
            minWidth: 216,
            maxWidth: 320,
            padding: 6,
            borderRadius: 14,
            border: `1px solid rgba(33,158,188,0.35)`,
            background: "rgba(10,13,20,0.97)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            boxShadow: "0 18px 40px -14px rgba(0,0,0,0.85), 0 0 16px -6px rgba(33,158,188,0.4)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {menu.sel && (
            <button type="button" role="menuitem" style={itemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={() => addSelection(menu)}>
              <span aria-hidden style={{ color: HOME_THEME.cyan, fontWeight: 800 }}>＋</span>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span>Add selection to Notes</span>
                <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis" }}>
                  “{menu.sel.replace(/\s+/g, " ").slice(0, 42)}{menu.sel.length > 42 ? "…" : ""}”
                </span>
              </span>
            </button>
          )}

          {menu.clip && (
            <button type="button" role="menuitem" style={itemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={() => void addClip(menu)}>
              <span aria-hidden style={{ color: HOME_THEME.cyan, fontWeight: 800 }}>📸</span>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span>Add snapshot to Notes</span>
                <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis" }}>{menu.label}</span>
              </span>
            </button>
          )}

          <span aria-hidden style={{ height: 1, margin: "3px 6px", background: HOME_THEME.border }} />

          <button type="button" role="menuitem" style={{ ...itemStyle, fontWeight: 500, opacity: 0.85 }} onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={() => { setMenu(null); openPanel(); }}>
            <span aria-hidden>🖍️</span>
            <span>Open Notes panel</span>
          </button>
        </div>
      )}

      {toast && (
        <button
          type="button"
          onClick={() => { setToast(null); openPanel(); }}
          title="Open the Notes panel"
          style={{
            position: "fixed",
            right: 18,
            bottom: 18,
            zIndex: 9999,
            padding: "9px 14px",
            borderRadius: 999,
            border: `1px solid rgba(33,158,188,0.45)`,
            background: "rgba(10,13,20,0.96)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            color: HOME_THEME.text,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.04em",
            cursor: "pointer",
            boxShadow: "0 14px 30px -12px rgba(0,0,0,0.8)",
          }}
        >
          <span aria-hidden style={{ marginRight: 7 }}>🖍️</span>
          {toast}
        </button>
      )}
    </>
  );
}
