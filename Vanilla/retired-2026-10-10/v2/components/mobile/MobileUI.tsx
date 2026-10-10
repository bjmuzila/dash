"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { CloseIcon } from "./MobileIcons";
import {
  M_COLOR,
  MONO,
  RADIUS,
  SAFE_BOTTOM,
  SPACE,
  TAP,
  TYPE,
  gridCols,
  mCard,
  mSectionLabel,
  mTile,
  noTapHighlight,
  rgba,
} from "./mobileTheme";

/**
 * MobileUI — the phone component kit.
 *
 * Every mobile page is built from these five primitives so the six pages read
 * as one app rather than six ports. Nothing here hardcodes a color: all of it
 * comes through mobileTheme, which comes through homeTheme.
 */

// ── Card ─────────────────────────────────────────────────────────────────────

export function MCard({
  title,
  right,
  children,
  padded = true,
  style,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  style?: CSSProperties;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
      {(title || right) && (
        <header style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 18 }}>
          {title && <span style={mSectionLabel}>{title}</span>}
          <span style={{ flex: 1 }} />
          {right}
        </header>
      )}
      <div style={{ ...mCard, padding: padded ? SPACE.md : 0, ...style }}>{children}</div>
    </section>
  );
}

// ── Stat tile ────────────────────────────────────────────────────────────────

export function MStat({
  label,
  value,
  accent,
  sub,
  onClick,
}: {
  label: string;
  value: string;
  accent?: string;
  sub?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div
        style={{
          fontSize: TYPE.micro - 1,
          fontWeight: 700,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: M_COLOR.faint,
          marginBottom: 3,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      <div
        style={{
          ...MONO,
          // 17px is the largest size at which an 8-character price ("6,152.50")
          // still fits a 3-up tile on a 390px screen. The desktop EM page uses
          // 21px here and overflows every cell.
          fontSize: TYPE.value + 2,
          fontWeight: 700,
          lineHeight: 1.15,
          color: accent ?? M_COLOR.text,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ ...MONO, fontSize: TYPE.micro - 1, color: M_COLOR.faint, marginTop: 2, whiteSpace: "nowrap" }}>
          {sub}
        </div>
      )}
    </>
  );

  if (!onClick) return <div style={mTile}>{body}</div>;
  return (
    <button type="button" onClick={onClick} style={{ ...mTile, ...noTapHighlight, textAlign: "left", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
      {body}
    </button>
  );
}

export function MStatGrid({ cols = 2, children }: { cols?: number; children: ReactNode }) {
  return (
    <div style={{ display: "grid", ...gridCols(`repeat(${cols}, minmax(0, 1fr))`), gap: 8 }}>
      {children}
    </div>
  );
}

// ── Horizontal chip row ──────────────────────────────────────────────────────

export type ChipItem = { id: string; label: string; sub?: string; accent?: string };

/**
 * MChipRow — a horizontally scrolling row of pills. This is the mobile answer
 * to every desktop dropdown on these pages: a portal-positioned `<select>`-alike
 * cannot be made to behave on iOS (it doesn't reposition on scroll, and its
 * 26px rows are half the minimum tap target), whereas a scrolling chip row is
 * one gesture and every target is 44px.
 */
export function MChipRow({
  items,
  activeId,
  onSelect,
  multi = false,
  activeIds,
}: {
  items: ChipItem[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  multi?: boolean;
  activeIds?: Set<string>;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Keep the selected chip in view when it changes from outside (e.g. the
  // expiry snapping forward at the open).
  useEffect(() => {
    if (multi || !activeId) return;
    const el = rowRef.current?.querySelector<HTMLElement>(`[data-chip="${CSS.escape(activeId)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeId, multi]);

  return (
    <div
      ref={rowRef}
      className="cbm-hscroll"
      style={{
        display: "flex",
        gap: 6,
        overflowX: "auto",
        overflowY: "hidden",
        padding: "1px 0 2px",
        WebkitOverflowScrolling: "touch",
        overscrollBehaviorX: "contain",
        scrollSnapType: "x proximity",
      }}
    >
      {items.map((it) => {
        const on = multi ? !!activeIds?.has(it.id) : it.id === activeId;
        const accent = it.accent ?? M_COLOR.cyan;
        return (
          <button
            key={it.id}
            data-chip={it.id}
            type="button"
            onClick={() => onSelect(it.id)}
            aria-pressed={on}
            style={{
              ...noTapHighlight,
              flexShrink: 0,
              scrollSnapAlign: "center",
              minHeight: TAP.chip,
              padding: it.sub ? "4px 12px" : "0 13px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
              borderRadius: RADIUS.pill,
              border: `1px solid ${on ? rgba(accent, 0.55) : M_COLOR.border}`,
              background: on ? rgba(accent, 0.16) : "rgba(255,255,255,0.04)",
              color: on ? accent : M_COLOR.dim,
              fontSize: TYPE.label,
              fontWeight: on ? 800 : 600,
              lineHeight: 1.2,
              cursor: "pointer",
              transition: "background 0.14s, border-color 0.14s, color 0.14s",
            }}
          >
            <span style={{ whiteSpace: "nowrap" }}>{it.label}</span>
            {it.sub && (
              <span style={{ fontSize: TYPE.micro - 2, fontWeight: 600, opacity: 0.72, whiteSpace: "nowrap" }}>
                {it.sub}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Segmented control ────────────────────────────────────────────────────────

/** Equal-width segments for 2-4 mutually exclusive options. iOS segmented look. */
export function MSegmented<T extends string>({
  options,
  value,
  onChange,
  accent = M_COLOR.cyan,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accent?: string;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "grid",
        ...gridCols(`repeat(${options.length}, minmax(0, 1fr))`),
        gap: 2,
        padding: 2,
        borderRadius: RADIUS.sm + 2,
        background: "rgba(255,255,255,0.05)",
        border: `1px solid ${M_COLOR.border}`,
      }}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            role="tab"
            aria-selected={on}
            type="button"
            onClick={() => onChange(o.id)}
            style={{
              ...noTapHighlight,
              minHeight: 30,
              padding: "0 6px",
              border: "none",
              borderRadius: RADIUS.sm,
              background: on ? rgba(accent, 0.2) : "transparent",
              boxShadow: on ? `inset 0 0 0 1px ${rgba(accent, 0.4)}` : "none",
              color: on ? accent : M_COLOR.dim,
              fontSize: TYPE.label,
              fontWeight: on ? 800 : 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              transition: "background 0.14s, color 0.14s",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Slider ───────────────────────────────────────────────────────────────────

/**
 * MSlider — a labelled range control for the continuous overlay settings.
 *
 * A native `<input type="range">` rather than a hand-rolled drag surface: iOS
 * gives it the right touch slop, the right momentum and VoiceOver support for
 * free, and a custom pointer handler inside a bottom sheet spends its life
 * fighting the sheet's own scroll. The thumb is sized up to 22px in
 * MobileShell's `.cbm-range` block (Safari's default 16px is under the tap
 * floor); the FILL is an inline background-image so React can move it with the
 * value, which a pseudo-element track cannot read.
 *
 * Fully controlled — the parent owns `value`, so the setting survives the sheet
 * closing and reopening.
 */
export function MSlider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
  onReset,
  accent = M_COLOR.cyan,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  onReset?: () => void;
  accent?: string;
}) {
  const pct = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 7,
        padding: "10px 12px 12px",
        borderRadius: RADIUS.md,
        border: `1px solid ${M_COLOR.border}`,
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: TYPE.body, fontWeight: 700, color: M_COLOR.text }}>{label}</span>
        <span style={{ flex: 1 }} />
        <span style={{ ...MONO, fontSize: TYPE.body, fontWeight: 800, color: accent }}>
          {format ? format(value) : String(value)}
        </span>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            style={{
              ...noTapHighlight,
              border: "none",
              background: "transparent",
              color: M_COLOR.faint,
              fontSize: TYPE.micro,
              fontWeight: 800,
              letterSpacing: "0.06em",
              padding: "0 0 0 8px",
              cursor: "pointer",
            }}
          >
            RESET
          </button>
        )}
      </div>
      {hint && (
        <span style={{ fontSize: TYPE.micro, color: M_COLOR.faint, lineHeight: 1.35 }}>{hint}</span>
      )}
      <input
        className="cbm-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          ...noTapHighlight,
          width: "100%",
          height: 22,
          margin: 0,
          appearance: "none",
          WebkitAppearance: "none",
          background: "transparent",
          backgroundImage: `linear-gradient(90deg, ${rgba(accent, 0.85)} ${pct}%, rgba(255,255,255,0.14) ${pct}%)`,
          backgroundSize: "100% 4px",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          borderRadius: 999,
          cursor: "pointer",
        }}
      />
    </div>
  );
}

// ── Bottom sheet ─────────────────────────────────────────────────────────────

/**
 * MSheet — the detail surface. Replaces every desktop hover card, because a
 * hover card is unreachable on touch. Slides up from the bottom, dismisses on
 * backdrop tap or the close button, and clears the home indicator.
 */
export function MSheet({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Escape closes it (desktop testing) and body scroll locks while it's up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
    >
      <div
        onClick={onClose}
        aria-hidden
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="cbm-sheet-in"
        style={{
          position: "relative",
          maxHeight: "78vh",
          display: "flex",
          flexDirection: "column",
          background: "rgba(11,15,22,0.98)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          borderTop: `1px solid ${rgba(M_COLOR.cyan, 0.35)}`,
          boxShadow: "0 -22px 60px -20px rgba(0,0,0,0.9)",
          paddingBottom: `calc(${SAFE_BOTTOM} + 10px)`,
        }}
      >
        {/* Grabber */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
          <span aria-hidden style={{ width: 38, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.22)" }} />
        </div>
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 14px 10px 16px",
            borderBottom: `1px solid ${M_COLOR.border}`,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ ...MONO, fontSize: TYPE.lead, fontWeight: 800, lineHeight: 1.15 }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: TYPE.label, color: M_COLOR.faint, marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              ...noTapHighlight,
              width: TAP.min - 6,
              height: TAP.min - 6,
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
              border: `1px solid ${M_COLOR.border}`,
              background: "rgba(255,255,255,0.05)",
              color: M_COLOR.dim,
              cursor: "pointer",
            }}
          >
            <CloseIcon size={18} />
          </button>
        </header>
        <div style={{ overflowY: "auto", WebkitOverflowScrolling: "touch", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Key/value row (sheet content) ────────────────────────────────────────────

export function MRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
      <span style={{ fontSize: TYPE.body, color: M_COLOR.dim, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, borderBottom: `1px dotted ${M_COLOR.border}`, transform: "translateY(-3px)" }} />
      <span style={{ ...MONO, fontSize: TYPE.body + 1, fontWeight: 700, color: accent ?? M_COLOR.text, whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}

// ── Status / empty states ────────────────────────────────────────────────────

export function MStatusDot({ live, label }: { live: boolean; label?: string }) {
  const c = live ? M_COLOR.up : M_COLOR.orange;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
      <span
        aria-hidden
        className={live ? "cbm-pulse" : undefined}
        style={{ width: 7, height: 7, borderRadius: "50%", background: c, boxShadow: `0 0 8px ${rgba(c, 0.7)}` }}
      />
      <span style={{ fontSize: TYPE.micro - 1, fontWeight: 700, letterSpacing: "0.08em", color: c }}>
        {label ?? (live ? "LIVE" : "…")}
      </span>
    </span>
  );
}

export function MEmpty({ children, tall = false }: { children: ReactNode; tall?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: tall ? "56px 20px" : "26px 20px",
        color: M_COLOR.faint,
        fontSize: TYPE.body,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
