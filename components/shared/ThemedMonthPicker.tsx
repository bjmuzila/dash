"use client";

/**
 * ThemedMonthPicker — dock-themed replacement for <input type="month">.
 *
 * Frosted-glass panel, 2px cyan top accent, year stepper + 12-month grid, with
 * click-outside / Esc to close. Matches toolbar-preview's CalendarDropdown
 * language. Value/onChange use the same "YYYY-MM" string a native month input
 * emits, so it's a drop-in swap.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { HOME_THEME, DOCK_THEME } from "./homeTheme";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function ThemedMonthPicker({
  value,
  onChange,
  width = 170,
  onOpenChange,
}: {
  value: string;            // "YYYY-MM"
  onChange: (v: string) => void;
  width?: number | string;
  /** Notified when the panel opens/closes so a parent can raise its stacking context. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (v: boolean | ((p: boolean) => boolean)) => {
    setOpenState((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      if (next !== prev) onOpenChange?.(next);
      return next;
    });
  };
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  const [selY, selM] = value.split("-").map(Number); // selM is 1-based
  const [viewYear, setViewYear] = useState(selY || new Date().getFullYear());

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 6, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  // Re-sync the viewed year whenever the menu opens.
  useEffect(() => {
    if (open && selY) setViewYear(selY);
  }, [open, selY]);

  const label = selY && selM ? `${MONTHS_LONG[selM - 1]} ${selY}` : "Select month";

  const navBtn: CSSProperties = {
    width: 28, height: 28, borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(255,255,255,0.05)", border: `1px solid ${HOME_THEME.border}`, color: HOME_THEME.text,
  };

  return (
    <div ref={ref} style={{ position: "relative", width }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%",
          padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
          fontSize: 13, fontWeight: 700, color: HOME_THEME.text, background: "rgba(0,0,0,0.30)",
          border: open ? `1px solid ${DOCK_THEME.activeBorder}` : `1px solid ${HOME_THEME.border}`,
          boxShadow: open ? DOCK_THEME.activeGlow : "none",
          transition: "border-color .14s, box-shadow .14s",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: HOME_THEME.cyan, display: "flex" }}>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v3M16 2v3M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
            </svg>
          </span>
          {label}
        </span>
        <span style={{ display: "flex", color: HOME_THEME.muted, transition: "transform .18s", transform: open ? "rotate(180deg)" : "none" }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {open && rect && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed", top: rect.top, left: rect.left, width: Math.max(rect.width, 240), minWidth: 240, zIndex: 9999, padding: 12,
            background: DOCK_THEME.bg,
            backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
            borderRadius: 14, border: `1px solid ${HOME_THEME.border}`,
            borderTop: `2px solid ${DOCK_THEME.cyanTop}`, boxShadow: DOCK_THEME.shadow,
          }}
        >
          {/* year stepper */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button type="button" style={navBtn} onClick={() => setViewYear((y) => y - 1)}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <span style={{ fontSize: 14, fontWeight: 800 }}>{viewYear}</span>
            <button type="button" style={navBtn} onClick={() => setViewYear((y) => y + 1)}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>

          {/* month grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {MONTHS.map((mLabel, i) => {
              const on = viewYear === selY && i + 1 === selM;
              return (
                <button
                  key={mLabel}
                  type="button"
                  onClick={() => { onChange(`${viewYear}-${String(i + 1).padStart(2, "0")}`); setOpen(false); }}
                  style={{
                    padding: "9px 0", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                    fontSize: 13, fontWeight: on ? 800 : 600,
                    color: on ? HOME_THEME.cyan : HOME_THEME.text,
                    background: on ? DOCK_THEME.activeTile : "transparent",
                    border: on ? `1px solid ${DOCK_THEME.activeBorder}` : "1px solid transparent",
                  }}
                  onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = DOCK_THEME.hoverTile; }}
                  onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
                >
                  {mLabel}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default ThemedMonthPicker;
