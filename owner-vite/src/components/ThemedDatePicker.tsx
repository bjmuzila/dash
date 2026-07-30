/**
 * ThemedDatePicker (owner-vite port) — dock-themed replacement for <input type="date">.
 *
 * Frosted-glass panel, 2px cyan top accent, month stepper + day grid, with
 * click-outside / Esc to close. Same visual language as ThemedMonthPicker /
 * toolbar-preview's CalendarDropdown. Value/onChange use the same "YYYY-MM-DD"
 * string a native date input emits, so it's a drop-in swap.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { HOME_THEME, DOCK_THEME } from "../lib/theme";

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function pad2(n: number) { return String(n).padStart(2, "0"); }
function toStr(y: number, m: number, d: number) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }
function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }

export function ThemedDatePicker({
  value,
  onChange,
  width = 170,
  placeholder = "Select date",
  onOpenChange,
}: {
  value: string;            // "YYYY-MM-DD"
  onChange: (v: string) => void;
  width?: number | string;
  placeholder?: string;
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

  const [selY, selM, selD] = value ? value.split("-").map(Number) : [NaN, NaN, NaN]; // selM is 1-based
  const today = new Date();
  const [viewYear, setViewYear] = useState(selY || today.getFullYear());
  const [viewMonth, setViewMonth] = useState((selM ? selM - 1 : today.getMonth()));

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

  // Re-sync the viewed month whenever the menu opens.
  useEffect(() => {
    if (open && selY && selM) { setViewYear(selY); setViewMonth(selM - 1); }
  }, [open, selY, selM]);

  const label = selY && selM && selD
    ? `${MONTHS_LONG[selM - 1].slice(0, 3)} ${selD}, ${selY}`
    : placeholder;

  const navBtn: CSSProperties = {
    width: 28, height: 28, borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(255,255,255,0.05)", border: `1px solid ${HOME_THEME.border}`, color: HOME_THEME.text,
  };

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const numDays = daysInMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: numDays }, (_, i) => i + 1),
  ];

  return (
    <div ref={ref} style={{ position: "relative", width }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%",
          padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
          fontSize: 14, fontWeight: 700, color: HOME_THEME.text, background: "rgba(0,0,0,0.30)",
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
            position: "fixed", top: rect.top, left: rect.left, width: Math.max(rect.width, 260), minWidth: 260, zIndex: 9999, padding: 12,
            background: DOCK_THEME.bg,
            backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
            borderRadius: 14, border: `1px solid ${HOME_THEME.border}`,
            borderTop: `2px solid ${DOCK_THEME.cyanTop}`, boxShadow: DOCK_THEME.shadow,
          }}
        >
          {/* month/year stepper */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button
              type="button"
              style={navBtn}
              onClick={() => setViewMonth((m) => {
                if (m === 0) { setViewYear((y) => y - 1); return 11; }
                return m - 1;
              })}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <span style={{ fontSize: 14, fontWeight: 800 }}>{MONTHS_LONG[viewMonth]} {viewYear}</span>
            <button
              type="button"
              style={navBtn}
              onClick={() => setViewMonth((m) => {
                if (m === 11) { setViewYear((y) => y + 1); return 0; }
                return m + 1;
              })}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>

          {/* weekday header */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
            {WEEKDAYS.map((w, i) => (
              <div key={i} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: HOME_THEME.muted, padding: "2px 0" }}>{w}</div>
            ))}
          </div>

          {/* day grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {cells.map((d, i) => {
              if (d == null) return <div key={i} />;
              const on = viewYear === selY && viewMonth === (selM - 1) && d === selD;
              const isToday = viewYear === today.getFullYear() && viewMonth === today.getMonth() && d === today.getDate();
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => { onChange(toStr(viewYear, viewMonth, d)); setOpen(false); }}
                  style={{
                    aspectRatio: "1", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                    fontSize: 12, fontWeight: on ? 800 : 600,
                    color: on ? HOME_THEME.cyan : HOME_THEME.text,
                    background: on ? DOCK_THEME.activeTile : "transparent",
                    border: on ? `1px solid ${DOCK_THEME.activeBorder}` : isToday ? `1px solid ${HOME_THEME.border}` : "1px solid transparent",
                  }}
                  onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = DOCK_THEME.hoverTile; }}
                  onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
                >
                  {d}
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

export default ThemedDatePicker;
