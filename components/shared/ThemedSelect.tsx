"use client";

/**
 * ThemedSelect — the dock-themed replacement for native <select>.
 *
 * Matches the toolbar-preview dropdown language (DteDropdown / CalendarDropdown):
 * a frosted-glass panel with a 2px cyan top accent, custom option rows with a
 * cyan active/hover state, and click-outside / Esc to close. Use this anywhere a
 * native <select> would otherwise render an off-theme OS menu.
 *
 * All colors come from HOME_THEME / DOCK_THEME — no hardcoded literals.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HOME_THEME, DOCK_THEME } from "./homeTheme";

export interface ThemedOption {
  value: string;
  label: ReactNode;
}

export function ThemedSelect({
  value,
  options,
  onChange,
  width = "100%",
  placeholder = "—",
  disabled = false,
  ariaLabel,
  maxMenuHeight = 320,
  onOpenChange,
}: {
  value: string;
  options: ThemedOption[];
  onChange: (v: string) => void;
  width?: number | string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  maxMenuHeight?: number;
  /** Notified whenever the menu opens/closes — lets a parent raise its stacking context. */
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

  // Anchor the portal'd menu under the trigger; reposition on scroll/resize.
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

  const selected = options.find((o) => o.value === value);

  const trigger: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
    padding: "8px 12px",
    borderRadius: 8,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 700,
    color: HOME_THEME.text,
    background: "rgba(0,0,0,0.4)",
    border: open ? `1px solid ${DOCK_THEME.activeBorder}` : `1px solid ${HOME_THEME.border}`,
    boxShadow: open ? DOCK_THEME.activeGlow : "none",
    opacity: disabled ? 0.5 : 1,
    transition: "border-color .14s, box-shadow .14s",
  };

  return (
    <div ref={ref} style={{ position: "relative", width }}>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={trigger}
      >
        <span style={{ color: selected ? HOME_THEME.cyan : HOME_THEME.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.label : placeholder}
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
          role="listbox"
          style={{
            position: "fixed",
            top: rect.top,
            left: rect.left,
            width: rect.width,
            maxHeight: maxMenuHeight,
            overflowY: "auto",
            zIndex: 9999,
            padding: 6,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            background: DOCK_THEME.bg,
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            borderRadius: 14,
            border: `1px solid ${HOME_THEME.border}`,
            borderTop: `2px solid ${DOCK_THEME.cyanTop}`,
            boxShadow: DOCK_THEME.shadow,
          }}
        >
          {options.length === 0 && (
            <div style={{ padding: "8px 10px", fontSize: 12, color: HOME_THEME.muted, opacity: 0.6, fontStyle: "italic" }}>
              {placeholder}
            </div>
          )}
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                  fontSize: 13,
                  fontWeight: on ? 800 : 600,
                  color: on ? HOME_THEME.cyan : HOME_THEME.text,
                  background: on ? DOCK_THEME.activeTile : "transparent",
                  border: on ? `1px solid ${DOCK_THEME.activeBorder}` : "1px solid transparent",
                }}
                onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = DOCK_THEME.hoverTile; }}
                onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
              >
                {o.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

export default ThemedSelect;
