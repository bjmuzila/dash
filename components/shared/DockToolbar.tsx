"use client";

/**
 * DockToolbar — shared "floating glass dock" toolbar primitives.
 *
 * Glossy treatment matches homeTheme.ts: translucent panel + backdrop blur +
 * cyan top-glow + 2px cyan top border. Tiles are flat horizontal rectangles.
 *
 * Primitives:
 *   <Dock>          container bar (frosted glass)
 *   <SegGroup>      segmented control (mutually-exclusive options as tiles)
 *   <ToggleTile>    on/off pill with status dot
 *   <DockButton>    action button (refresh / icon / etc.)
 *   <DockSep>       subtle vertical divider
 *
 * Designed in /toolbar-preview.
 */

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const ACCENT = "#219EBC";

const T = {
  accent: ACCENT,
  text: "#FFFFFF",
  border: "rgba(255,255,255,0.10)",
  panelBg: "rgba(13,17,25,0.45)",
  panelBgStrong: "rgba(13,17,25,0.72)",
  tile: "rgba(255,255,255,0.04)",
};

export function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

const dockBg = `radial-gradient(circle at 50% 0%, ${rgba(ACCENT, 0.08)} 0%, transparent 60%), ${T.panelBg}`;
const dockShadow =
  "0 1px 0 rgba(255,255,255,0.06) inset, 0 20px 44px -14px rgba(0,0,0,0.75), 0 6px 16px rgba(0,0,0,0.45)";

/* ---------- Dock container ---------- */
export function Dock({
  children,
  accent = ACCENT,
  style,
  className,
  flat = false,
  fullWidth = false,
  noScroll = false,
}: {
  children: ReactNode;
  accent?: string;
  style?: CSSProperties;
  className?: string;
  /** Drop the glow/shadow + use a plain translucent fill (for inline, full-width bars). */
  flat?: boolean;
  /** Stretch to fill its container instead of hugging content. */
  fullWidth?: boolean;
  /** Disable horizontal scroll so the bar lays out at full content width (for scale-to-fit wrappers). */
  noScroll?: boolean;
}) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        position: "relative",
        padding: flat ? "6px 10px" : "8px 12px",
        background: flat
          // Top: accent glow + panel tint; vertical fade so the fill dissolves
          // toward the bottom and the bar melts into the chart below.
          ? `radial-gradient(ellipse 80% 120% at 50% -20%, ${rgba(accent, 0.07)} 0%, transparent 70%), linear-gradient(180deg, ${T.panelBg} 0%, ${rgba("#0d1119", 0.25)} 55%, transparent 100%)`
          : `radial-gradient(circle at 50% 0%, ${rgba(accent, 0.08)} 0%, transparent 60%), ${T.panelBg}`,
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderRadius: flat ? "12px 12px 0 0" : 18,
        // Sides: only the top portion is bordered (via top + faint sides); the
        // structural border is removed in flat mode so there's no bottom line.
        border: flat ? "none" : `1px solid ${T.border}`,
        borderTop: flat ? `1px solid ${rgba(accent, 0.12)}` : `1px solid ${rgba(accent, 0.12)}`,
        boxShadow: flat ? "0 1px 0 rgba(255,255,255,0.04) inset" : dockShadow,
        flexShrink: 0,
        flexWrap: "nowrap",
        overflowX: noScroll ? "visible" : "auto",
        overflowY: noScroll ? "visible" : "hidden",
        scrollbarWidth: "none",
        msOverflowStyle: "none" as const,
        ...style,
      }}
    >
      <style>{`.dock-noscroll::-webkit-scrollbar{display:none;height:0}`}</style>
      {/* Gradient top accent — bright in the center, fading to dark at edges. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: -1,
          left: 0,
          right: 0,
          height: 2,
          borderTopLeftRadius: flat ? 12 : 18,
          borderTopRightRadius: flat ? 12 : 18,
          pointerEvents: "none",
          background: `linear-gradient(90deg, transparent 0%, ${rgba(accent, 0.12)} 18%, ${rgba(accent, 0.9)} 50%, ${rgba(accent, 0.12)} 82%, transparent 100%)`,
          boxShadow: `0 0 8px ${rgba(accent, 0.35)}`,
        }}
      />
      {children}
    </div>
  );
}

/* ---------- Segmented control ---------- */
export interface SegOption {
  label: string;
  sub?: string;
  value: string;
}

export function SegGroup({
  options,
  active,
  onChange,
  accent = ACCENT,
}: {
  options: SegOption[];
  active: string;
  onChange: (value: string) => void;
  accent?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "clamp(2px, 0.4vw, 5px)",
        height: 34,
        padding: 4,
        background: "rgba(0,0,0,0.22)",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.04)",
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      {options.map((o) => {
        const on = o.value === active;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: "clamp(3px, 0.4vw, 5px)",
              flexShrink: 0,
              height: "100%",
              padding: "0 clamp(7px, 1vw, 14px)",
              fontSize: "clamp(10px, 0.85vw, 12px)",
              border: on ? `1px solid ${rgba(accent, 0.35)}` : "1px solid transparent",
              borderRadius: 8,
              whiteSpace: "nowrap",
              background: on
                ? `linear-gradient(180deg,${rgba(accent, 0.18)},${rgba(accent, 0.05)})`
                : T.tile,
              color: on ? accent : T.text,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "background .14s, color .14s, border-color .14s",
              boxShadow: on ? `0 0 14px ${rgba(accent, 0.25)}, 0 2px 8px rgba(0,0,0,0.35)` : "none",
            }}
          >
            <span>{o.label}</span>
            {o.sub && <span style={{ fontSize: "clamp(9px, 0.7vw, 10.5px)", opacity: 0.7, fontWeight: 600 }}>{o.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Toggle pill ---------- */
export function ToggleTile({
  label,
  on,
  onClick,
  accent = ACCENT,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  accent?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "clamp(4px, 0.5vw, 6px)",
        height: 34,
        padding: "0 clamp(7px, 0.9vw, 13px)",
        borderRadius: 9,
        boxSizing: "border-box",
        border: on ? `1px solid ${rgba(accent, 0.3)}` : "1px solid rgba(255,255,255,0.05)",
        background: on ? `linear-gradient(180deg,${rgba(accent, 0.16)},${rgba(accent, 0.04)})` : T.tile,
        color: on ? accent : T.text,
        fontWeight: 700,
        fontSize: "clamp(10px, 0.85vw, 12px)",
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        flexShrink: 0,
        transition: "background .14s, color .14s, border-color .14s",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 99,
          background: on ? accent : "rgba(255,255,255,0.2)",
          boxShadow: on ? `0 0 8px ${accent}` : "none",
          flexShrink: 0,
        }}
      />
      {label}
    </button>
  );
}

/* ---------- Action button ---------- */
export function DockButton({
  children,
  onClick,
  title,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        minWidth: 34,
        height: 34,
        padding: "0 clamp(7px, 0.9vw, 11px)",
        borderRadius: 9,
        boxSizing: "border-box",
        border: "1px solid rgba(255,255,255,0.06)",
        background: "linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))",
        color: T.text,
        fontSize: "clamp(11px, 0.9vw, 13px)",
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "inherit",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/* ---------- Spacer / separator ---------- */
export function DockSpacer() {
  return <div style={{ marginLeft: "auto" }} />;
}

/** Breathing room between groups — shrinks on narrow viewports. */
export function DockGap() {
  return <span style={{ width: "clamp(4px, 1vw, 14px)", flexShrink: 1, minWidth: 4 }} />;
}

/** Themed range slider — cyan glossy thumb, dark track, optional label + value. */
export function DockSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format = (v) => v.toFixed(2),
  width = 90,
  accent = ACCENT,
  title,
}: {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  width?: number;
  accent?: string;
  title?: string;
}) {
  return (
    <label
      title={title}
      style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10.5, color: "rgba(255,255,255,.55)", fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}
    >
      <style>{`
        input.dock-slider{-webkit-appearance:none;appearance:none;height:4px;border-radius:99px;background:rgba(255,255,255,.12);outline:none;cursor:pointer}
        input.dock-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:13px;height:13px;border-radius:99px;background:linear-gradient(180deg,#bfffff,${ACCENT});border:1px solid rgba(255,255,255,.5);box-shadow:0 0 8px ${rgba(ACCENT,0.6)},0 1px 3px rgba(0,0,0,.5);cursor:pointer}
        input.dock-slider::-moz-range-thumb{width:13px;height:13px;border-radius:99px;background:linear-gradient(180deg,#bfffff,${ACCENT});border:1px solid rgba(255,255,255,.5);box-shadow:0 0 8px ${rgba(ACCENT,0.6)};cursor:pointer}
        input.dock-slider::-moz-range-track{height:4px;border-radius:99px;background:rgba(255,255,255,.12)}
      `}</style>
      {label && <span>{label}</span>}
      <input
        className="dock-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width, accentColor: accent }}
      />
      <span style={{ minWidth: 34, fontVariantNumeric: "tabular-nums", fontSize: 10, color: accent }}>{format(value)}</span>
    </label>
  );
}

export function DockSep() {
  return (
    <span
      style={{
        width: 1,
        alignSelf: "stretch",
        margin: "2px 2px",
        background: "rgba(255,255,255,0.08)",
        flexShrink: 0,
      }}
    />
  );
}

/* ---------- shared chevron icon ---------- */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ opacity: 0.55, transition: "transform .18s", transform: open ? "rotate(180deg)" : "none", flexShrink: 0 }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dteFromTodayISO(iso: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso + "T00:00:00");
  return Math.max(0, Math.round((d.getTime() - today.getTime()) / 86400000));
}

// Hook: portal-anchored popover position + outside-click close.
function usePopover() {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggle = () => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.bottom + 6, width: r.width });
    setOpen((v) => !v);
  };
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return { open, setOpen, rect, anchorRef, menuRef, toggle };
}

const popoverPanel: CSSProperties = {
  position: "fixed",
  zIndex: 100000,
  padding: 6,
  background: `radial-gradient(circle at 50% 0%, ${rgba(ACCENT, 0.07)} 0%, transparent 55%), ${T.panelBgStrong}`,
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
  borderRadius: 14,
  border: `1px solid ${T.border}`,
  borderTop: `2px solid ${rgba(ACCENT, 0.5)}`,
  boxShadow: dockShadow,
};

const triggerBtn = (open: boolean): CSSProperties => ({
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  padding: "6px 11px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
  color: T.text, fontSize: "clamp(11px, 0.9vw, 13px)", fontWeight: 700, whiteSpace: "nowrap",
  background: T.tile,
  border: open ? `1px solid ${rgba(ACCENT, 0.45)}` : "1px solid rgba(255,255,255,0.08)",
  boxShadow: open ? `0 0 14px ${rgba(ACCENT, 0.25)}` : "none",
  transition: "border-color .14s, box-shadow .14s",
  flexShrink: 0,
});

/* ---------- Expiry / DTE dropdown (portal'd, dock-themed) ---------- */
export function DockExpiryPicker({
  expirations,
  value,
  onChange,
  includeFront = false,
  frontLabel = "Front",
}: {
  expirations: string[];     // ISO date strings (YYYY-MM-DD)
  value: string;             // "" = front, else an ISO from expirations
  onChange: (v: string) => void;
  includeFront?: boolean;
  frontLabel?: string;
}) {
  const { open, setOpen, rect, anchorRef, menuRef, toggle } = usePopover();
  const dd = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return `${DOW[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
  };
  const opts = [
    ...(includeFront ? [{ value: "", label: frontLabel, sub: "" }] : []),
    ...expirations.map((e) => ({ value: e, label: dd(e), sub: `${dteFromTodayISO(e)}DTE` })),
  ];
  const current = value ? dd(value) : frontLabel;

  return (
    <div ref={anchorRef} style={{ flexShrink: 0 }}>
      <button onClick={toggle} title="Expiry / DTE" style={triggerBtn(open)}>
        <span style={{ color: T.accent }}>{current}</span>
        <Chevron open={open} />
      </button>
      {open && rect && createPortal(
        <div ref={menuRef} style={{ ...popoverPanel, left: rect.left, top: rect.top, width: Math.max(rect.width, 150), maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {opts.map((o) => {
            const on = o.value === value;
            return (
              <button key={o.value || "front"} onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%",
                  padding: "7px 10px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                  fontSize: 12.5, fontWeight: 700,
                  border: on ? `1px solid ${rgba(ACCENT, 0.35)}` : "1px solid transparent",
                  background: on ? `linear-gradient(180deg,${rgba(ACCENT, 0.16)},${rgba(ACCENT, 0.03)})` : "transparent",
                  color: on ? T.accent : T.text,
                }}>
                <span>{o.label}</span>
                <span style={{ opacity: 0.5, fontWeight: 600, fontSize: 11 }}>{o.sub}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

/* ---------- Calendar date picker (portal'd, dock-themed) ---------- */
export function DockCalendar({
  value,
  onChange,
}: {
  value: string;             // ISO date string
  onChange: (iso: string) => void;
}) {
  const { open, rect, anchorRef, menuRef, toggle, setOpen } = usePopover();
  const sel = value ? new Date(value + "T00:00:00") : new Date();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [view, setView] = useState(() => new Date(sel.getFullYear(), sel.getMonth(), 1));
  const year = view.getFullYear(), month = view.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const fmt = `${MONTHS[sel.getMonth()]} ${sel.getDate()}`;
  const navBtn: CSSProperties = { width: 26, height: 26, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: T.text };
  const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return (
    <div ref={anchorRef} style={{ flexShrink: 0 }}>
      <button onClick={toggle} title="Pick date" style={triggerBtn(open)}>
        <span style={{ display: "flex", alignItems: "center", gap: 7, color: T.accent }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2v3M16 2v3M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
          </svg>
          {fmt}
        </span>
        <Chevron open={open} />
      </button>
      {open && rect && createPortal(
        <div ref={menuRef} style={{ ...popoverPanel, left: rect.left, top: rect.top, width: 264, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button style={navBtn} onClick={() => setView(new Date(year, month - 1, 1))}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>{MONTHS[month]} {year}</span>
            <button style={navBtn} onClick={() => setView(new Date(year, month + 1, 1))}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 4 }}>
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.45)", padding: "2px 0" }}>{d}</div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const on = same(d, sel);
              const isToday = same(d, today);
              return (
                <button key={i} onClick={() => { onChange(toISO(d)); setOpen(false); }}
                  style={{
                    height: 30, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 800 : 600,
                    color: on ? T.accent : T.text,
                    background: on ? `linear-gradient(180deg,${rgba(ACCENT, 0.18)},${rgba(ACCENT, 0.04)})` : "transparent",
                    border: on ? `1px solid ${rgba(ACCENT, 0.4)}` : isToday ? `1px solid ${rgba(ACCENT, 0.2)}` : "1px solid transparent",
                  }}>
                  {d.getDate()}
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
