/**
 * Spread Desk · small shared pieces. Every color comes from ../../theme.
 *
 * Status tones: GOOD and BAD are data colors and only ever describe the data
 * (a passed rule, a loss, a level reached). "watch" is Bolt Sky, a highlight,
 * because amber is the Volt's and means nothing else on a Voltick screen.
 */
import type { CSSProperties, ReactNode } from "react";
import {
  ACCENT, ACCENT_TEXT, BAD, ELEV, GOOD, INK, LINE, MONO, PANEL, PAPER, PAPER_QUIET,
  R_LG, R_MD, R_PILL, R_SM, SANS, SKY, W_BOLD, W_DATA, W_MED, labelStyle, numStyle, rgba,
} from "../../theme";
import type { Lvl } from "./model";

export const TONE: Record<Lvl | "accent" | "plain", string> = {
  ok: GOOD, good: GOOD, watch: SKY, alert: BAD, accent: ACCENT_TEXT, plain: PAPER_QUIET,
};
export const MARK: Record<Lvl, string> = { ok: "✓", good: "✓", watch: "!", alert: "×" };

export function Pill({ tone = "plain", children, dot, wrap }: { tone?: keyof typeof TONE; children: ReactNode; dot?: boolean; wrap?: boolean }) {
  const c = TONE[tone];
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%",
        padding: "3px 9px", borderRadius: R_PILL,
        border: `1px solid ${tone === "plain" ? LINE : rgba(c, 0.45)}`,
        background: tone === "plain" ? "transparent" : rgba(c, 0.1),
        fontFamily: MONO, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em",
        textTransform: "uppercase", color: c, whiteSpace: wrap ? "normal" : "nowrap", lineHeight: 1.35,
      }}
    >
      {dot && <span aria-hidden style={{ width: 7, height: 7, borderRadius: 7, background: c, flex: "none" }} />}
      {children}
    </span>
  );
}

export function Mark({ lvl }: { lvl: Lvl }) {
  const c = TONE[lvl];
  return (
    <span
      aria-hidden
      style={{
        width: 16, height: 16, borderRadius: 16, flex: "none", display: "inline-grid", placeItems: "center",
        background: rgba(c, 0.14), color: c, fontSize: 10, fontWeight: 800, marginTop: 1,
      }}
    >
      {MARK[lvl]}
    </span>
  );
}

export function CheckRow({ lvl, children }: { lvl: Lvl; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: 8, fontSize: 12.5, color: PAPER, alignItems: "start" }}>
      <Mark lvl={lvl} />
      <span>{children}</span>
    </div>
  );
}

export function Stat({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...labelStyle, fontSize: 9.5 }}>{label}</div>
      <div style={{ ...numStyle, fontWeight: 700, fontSize: 14, color: color ?? PAPER, marginTop: 2 }}>{value}</div>
    </div>
  );
}

export function Bar({ value, color, marker }: { value: number; color: string; marker?: number }) {
  return (
    <div style={{ position: "relative", height: 6, borderRadius: R_PILL, background: INK, border: `1px solid ${LINE}` }}>
      <i style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color, borderRadius: R_PILL, transition: "width 200ms" }} />
      {marker != null && (
        <u style={{ position: "absolute", top: -4, bottom: -4, width: 2, left: `${Math.min(100, marker * 100)}%`, background: PAPER }} />
      )}
    </div>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "1fr", gap: 3, padding: 3, background: INK, border: `1px solid ${LINE}`, borderRadius: R_MD }}>
      {options.map(([v, l]) => {
        const on = v === value;
        return (
          <button
            key={String(v)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(v)}
            style={{
              border: 0, borderRadius: 7, padding: "7px 2px", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: W_BOLD,
              background: on ? ELEV : "transparent", color: on ? PAPER : PAPER_QUIET,
              boxShadow: on ? `inset 0 0 0 1px ${rgba(ACCENT, 0.5)}` : "none",
            }}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

export const inputStyle: CSSProperties = {
  width: "100%", minWidth: 0, background: INK, color: PAPER, border: `1px solid ${LINE}`, borderRadius: R_MD,
  padding: "8px 10px", fontFamily: MONO, fontSize: 13,
};

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <label htmlFor={htmlFor} style={{ fontSize: 12, fontWeight: W_MED, color: PAPER_QUIET }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: PAPER_QUIET, lineHeight: 1.45 }}>{hint}</div>}
    </div>
  );
}

export function Btn({ children, onClick, kind = "solid", small, disabled, type = "button", done }: {
  children: ReactNode; onClick?: () => void; kind?: "solid" | "ghost"; small?: boolean; disabled?: boolean; type?: "button" | "submit"; done?: boolean;
}) {
  const solid = kind === "solid" && !done;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        font: "inherit", fontFamily: SANS, fontWeight: W_BOLD, fontSize: small ? 12 : 13,
        padding: small ? "5px 10px" : "8px 12px", borderRadius: R_MD, whiteSpace: "nowrap",
        cursor: disabled ? "default" : "pointer", opacity: disabled && !done ? 0.55 : 1,
        border: `1px solid ${done ? rgba(GOOD, 0.45) : rgba(ACCENT, 0.6)}`,
        background: done ? rgba(GOOD, 0.1) : solid ? ACCENT : "transparent",
        color: done ? GOOD : solid ? PAPER : ACCENT_TEXT,
        boxShadow: solid ? `inset 0 -1px 0 ${rgba(PAPER, 0.45)}, 0 0 20px -6px ${ACCENT}` : "none",
      }}
    >
      {children}
    </button>
  );
}

/** A panel with a header row, the way the Voltick app frames a tool. */
export function Panel({ title, aside, children, pad = 0, style }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; pad?: number | string; style?: CSSProperties }) {
  return (
    <section style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_LG, minWidth: 0, ...style }}>
      {(title != null || aside != null) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "12px 14px", borderBottom: `1px solid ${LINE}` }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: W_BOLD, color: PAPER }}>{title}</h3>
          {aside != null && <div style={{ ...labelStyle }}>{aside}</div>}
        </div>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </section>
  );
}

export function Chips({ checks }: { checks: { ok: boolean; t: string }[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
      {checks.map((c) => (
        <span
          key={c.t}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "2px 7px", borderRadius: R_SM, background: INK,
            border: `1px solid ${c.ok ? rgba(GOOD, 0.3) : LINE}`, color: c.ok ? GOOD : PAPER_QUIET,
            textDecoration: c.ok ? "none" : "line-through", textDecorationColor: rgba(BAD, 0.7),
          }}
        >
          {c.ok ? "✓" : "×"} {c.t}
        </span>
      ))}
    </div>
  );
}

export const bigNum: CSSProperties = { ...numStyle, fontWeight: W_DATA, fontSize: 20, letterSpacing: "-0.02em" };

/** Try/catch around storage: a private window or blocked storage must never break the page. */
export function load<T>(key: string): T | null {
  try {
    const r = localStorage.getItem(key);
    return r ? (JSON.parse(r) as T) : null;
  } catch {
    return null;
  }
}
export function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* blocked storage: the page still works for this visit */
  }
}
