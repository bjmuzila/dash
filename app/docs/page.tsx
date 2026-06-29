"use client";

/**
 * Knowledge Base / Help Center  —  /docs
 *
 * In-app, end-user-facing documentation styled to the dashboard design system
 * (see md files/HOME_PAGE_DESIGN_SYSTEM.md). Self-contained: a left rail of
 * articles + a scrollable content pane. Renders inside the standard <main>
 * shell (sidebar + chrome are provided by LayoutShell), so this file only owns
 * the page body.
 *
 * First complete articles: GEX Chart, GEX Heatmap. Concept pages + glossary are
 * scaffolded so the KB can grow to cover the whole dashboard.
 *
 * Colors are pulled inline rather than from HOME_THEME so the swatches in the
 * articles exactly match the hard-coded values in GexChart.tsx / GexHeatmap.tsx.
 */

import { useMemo, useState } from "react";
import { HOME_THEME, homeShellStyle } from "@/components/shared/homeTheme";
import { Card as ThemeCard } from "@/components/shared/PageCard";

// ─── Palette (mirrors the values used by the GEX components) ──────────────────
const C = {
  bg: "#05060A",
  panel: "rgba(13,17,25,0.45)",
  panelStrong: "rgba(13,17,25,0.72)",
  cyan: "#219EBC",
  posBar: "#29b6f6", // +GEX / Call bars + heatmap positive cells
  negBar: "#ffb300", // −GEX / Put bars (chart)
  heatNeg: "#ff4757", // heatmap negative cells (red)
  purple: "#126783", // DEX line
  orange: "#FB8501", // GEX flip line + curve
  green: "#8ECAE6", // call OI overlay
  red: "#EF4444", // put OI overlay
  muted: "#FFFFFF",
  text: "#FFFFFF",
  border: "rgba(255,255,255,0.10)",
  borderSoft: "rgba(33,158,188,0.16)",
};

// ─── Small presentational helpers (shared across every article) ───────────────

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 18,
        fontWeight: 800,
        margin: "30px 0 10px",
        color: C.text,
        letterSpacing: "0.01em",
        scrollMarginTop: 16,
      }}
    >
      {children}
    </h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 14, fontWeight: 800, margin: "20px 0 6px", color: C.cyan, letterSpacing: "0.02em" }}>
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 14, lineHeight: 1.7, color: C.text, margin: "0 0 12px" }}>{children}</p>;
}

function Lead({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 15, lineHeight: 1.65, color: C.text, margin: "0 0 18px" }}>{children}</p>;
}

/** Inline emphasis for a UI label or value the user will actually see on screen. */
function UI({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "monospace",
        fontSize: 12.5,
        fontWeight: 700,
        color: C.cyan,
        background: "rgba(33,158,188,0.08)",
        border: "1px solid rgba(33,158,188,0.18)",
        borderRadius: 4,
        padding: "1px 5px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Term({ children }: { children: React.ReactNode }) {
  return <strong style={{ color: C.text, fontWeight: 700 }}>{children}</strong>;
}

function Swatch({ color, soft }: { color: string; soft?: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 13,
        height: 13,
        borderRadius: 3,
        background: soft ? `${color}55` : color,
        border: `1px solid ${color}`,
        flexShrink: 0,
        verticalAlign: "middle",
      }}
    />
  );
}

/** A labelled legend row: swatch + name + meaning. Used for color keys. */
function LegendRow({ color, name, children, soft }: { color: string; name: string; children: React.ReactNode; soft?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 150, flexShrink: 0 }}>
        <Swatch color={color} soft={soft} />
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{name}</span>
      </span>
      <span style={{ fontSize: 13, lineHeight: 1.55, color: C.text }}>{children}</span>
    </div>
  );
}

/** Definition row: term on the left, explanation on the right. */
function DefRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ minWidth: 150, flexShrink: 0, fontSize: 13, fontWeight: 800, color: C.cyan, fontFamily: "monospace" }}>{term}</span>
      <span style={{ fontSize: 13, lineHeight: 1.6, color: C.text }}>{children}</span>
    </div>
  );
}

type CalloutKind = "tip" | "note" | "warn";
function Callout({ kind = "note", title, children }: { kind?: CalloutKind; title?: string; children: React.ReactNode }) {
  const map: Record<CalloutKind, { c: string; label: string }> = {
    tip: { c: C.green, label: title ?? "Tip" },
    note: { c: C.cyan, label: title ?? "Note" },
    warn: { c: C.orange, label: title ?? "Heads up" },
  };
  const m = map[kind];
  // Themed-card chrome (radial glow + 2px top accent strip) so callouts match
  // the Card look used across the articles. The kind drives the accent color +
  // the uppercase label.
  return (
    <div
      style={{
        margin: "12px 0",
        background: `radial-gradient(circle at 50% 0%, ${m.c}14 0%, transparent 60%), ${C.panel}`,
        border: `1px solid ${C.border}`,
        borderTop: `2px solid ${m.c}d9`,
        borderRadius: 12,
        padding: "12px 16px",
        backdropFilter: "blur(16px)",
      }}
    >
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: m.c, marginBottom: 5 }}>
        {m.label}
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.6, color: C.text }}>{children}</div>
    </div>
  );
}

/** Numbered step list for "how to read it" walkthroughs. */
function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol style={{ margin: "8px 0 14px", padding: 0, listStyle: "none", counterReset: "step" }}>
      {items.map((it, i) => (
        <li
          key={i}
          style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "8px 0", borderBottom: i < items.length - 1 ? `1px solid ${C.border}` : "none" }}
        >
          <span
            style={{
              flexShrink: 0,
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "rgba(33,158,188,0.12)",
              border: "1px solid rgba(33,158,188,0.4)",
              color: C.cyan,
              fontSize: 12,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {i + 1}
          </span>
          <span style={{ fontSize: 13.5, lineHeight: 1.6, color: C.text, paddingTop: 1 }}>{it}</span>
        </li>
      ))}
    </ol>
  );
}

function Card({ children, accent = C.cyan }: { children: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      background: `radial-gradient(circle at 50% 0%, ${accent}14 0%, transparent 60%), ${C.panel}`,
      border: `1px solid ${C.border}`,
      borderTop: `2px solid ${accent}d9`,
      borderRadius: 12,
      padding: "4px 16px",
      margin: "12px 0",
      backdropFilter: "blur(16px)",
    }}>
      {children}
    </div>
  );
}

// ─── Inline SVG example charts (sample data — illustrative, not live) ─────────
// These mirror the real components' colors/orientation so the docs show what the
// page actually looks like. All data here is hand-picked sample data.

/** Frame + caption around any example diagram. Capped width so examples stay
 *  compact rather than stretching the full content pane. */
function Figure({ caption, maxWidth = 420, children }: { caption: React.ReactNode; maxWidth?: number; children: React.ReactNode }) {
  return (
    <figure style={{ margin: "18px auto 6px", maxWidth, width: "100%" }}>
      <div
        style={{
          background: `radial-gradient(circle at 50% 0%, ${C.cyan}12 0%, transparent 60%), ${C.panelStrong}`,
          border: `1px solid ${C.border}`,
          borderTop: `2px solid ${C.cyan}d9`,
          borderRadius: 12,
          padding: 14,
          position: "relative",
        }}
      >
        <span
          style={{
            position: "absolute", top: 8, right: 10,
            fontSize: 8.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase",
            color: C.muted, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px",
          }}
        >
          Example
        </span>
        {children}
      </div>
      <figcaption style={{ fontSize: 12, color: C.muted, lineHeight: 1.55, margin: "8px 4px 0", textAlign: "center" }}>
        {caption}
      </figcaption>
    </figure>
  );
}

/** Annotated GEX bar chart: net gamma by strike, zero line, SPX spot, flip, MVC tag. */
function GexChartExample() {
  // [strike offset label, value] — positive = up (blue), negative = down (gold)
  const bars = [
    { x: "-60", v: -0.35 }, { x: "-50", v: -0.55 }, { x: "-40", v: -0.30 },
    { x: "-30", v: 0.20 }, { x: "-20", v: 0.45 }, { x: "-10", v: 0.30 },
    { x: "ATM", v: 0.62 }, { x: "+10", v: 1.00 }, { x: "+20", v: 0.50 },
    { x: "+30", v: 0.40 }, { x: "+40", v: 0.22 }, { x: "+50", v: 0.15 },
  ];
  const W = 560, H = 240, padL = 30, padR = 16, padT = 26, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const zeroY = padT + innerH * 0.52;
  const bw = innerW / bars.length;
  const maxV = 1.05;
  const upH = (zeroY - padT) / maxV;       // px per unit upward
  const dnH = (padT + innerH - zeroY) / maxV; // px per unit downward
  const mvcIdx = bars.findIndex((b) => Math.abs(b.v) === Math.max(...bars.map((b2) => Math.abs(b2.v))));
  const spotX = padL + bw * 6.5; // between ATM and +10
  const flipX = padL + bw * 5.7;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Example GEX bar chart">
      {/* zero line */}
      <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="rgba(255,255,255,0.28)" strokeWidth="1" />
      <text x={padL - 4} y={zeroY + 3} textAnchor="end" fontSize="8" fill={C.muted}>0</text>
      {/* bars */}
      {bars.map((b, i) => {
        const up = b.v >= 0;
        const h = Math.abs(b.v) * (up ? upH : dnH);
        const x = padL + i * bw + bw * 0.16;
        const y = up ? zeroY - h : zeroY;
        const w = bw * 0.68;
        const isMvc = i === mvcIdx;
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={h} rx="1.5"
              fill={up ? C.posBar : C.negBar} opacity={isMvc ? 1 : 0.82}
              stroke={isMvc ? C.text : "none"} strokeWidth={isMvc ? 1 : 0} />
            <text x={x + w / 2} y={padT + innerH + 14} textAnchor="middle" fontSize="7.5"
              fill={b.x === "ATM" ? C.cyan : C.muted} fontWeight={b.x === "ATM" ? 700 : 400}>{b.x}</text>
          </g>
        );
      })}
      {/* MVC tag */}
      <g>
        <rect x={padL + mvcIdx * bw - 6} y={padT - 4} width="48" height="15" rx="3" fill="rgba(33,158,188,0.14)" stroke={C.cyan} strokeWidth="0.8" />
        <text x={padL + mvcIdx * bw + 18} y={padT + 6.5} textAnchor="middle" fontSize="8.5" fontWeight="800" fill={C.cyan}>CB</text>
      </g>
      {/* SPX spot dashed line */}
      <line x1={spotX} y1={padT - 6} x2={spotX} y2={padT + innerH} stroke="#dcdcdc" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.85" />
      <text x={spotX + 3} y={padT + innerH - 2} fontSize="8" fontWeight="700" fill="#e8edf5">SPX</text>
      {/* Flip line */}
      <line x1={flipX} y1={padT} x2={flipX} y2={padT + innerH} stroke={C.orange} strokeWidth="1.2" strokeDasharray="2 2" opacity="0.9" />
      <text x={flipX - 3} y={padT + 8} textAnchor="end" fontSize="8" fontWeight="700" fill={C.orange}>FLIP</text>
      {/* side labels */}
      <text x={W - padR} y={padT + 4} textAnchor="end" fontSize="8" fill={C.posBar} fontWeight="700">+ gamma (dampens)</text>
      <text x={W - padR} y={padT + innerH} textAnchor="end" fontSize="8" fill={C.negBar} fontWeight="700">− gamma (amplifies)</text>
    </svg>
  );
}

/** Annotated heatmap grid: strikes down the side, 5 exposure columns, ATM row, rank badges. */
function HeatmapExample() {
  const cols = ["NET GEX", "VOL GEX", "DEX", "GEX+VEX", "30M ROLL"];
  // rows top→bottom (highest strike first). v in [-1,1] per cell drives color.
  const rows = [
    { k: "5320", atm: false, badge: "#2", v: [0.55, 0.30, 0.20, 0.5, 0.6] },
    { k: "5310", atm: false, badge: "#1", v: [0.95, 0.70, 0.35, 0.9, 0.85] },
    { k: "5300", atm: false, badge: "#3", v: [0.45, 0.25, -0.10, 0.4, 0.5] },
    { k: "5290", atm: true,  badge: "",   v: [0.30, 0.40, 0.15, 0.2, 0.35] },
    { k: "5280", atm: false, badge: "",   v: [-0.40, -0.20, -0.30, -0.45, -0.35] },
    { k: "5270", atm: false, badge: "",   v: [-0.75, -0.55, -0.25, -0.7, -0.6] },
  ];
  const cellColor = (v: number) => {
    const a = Math.min(1, Math.abs(v));
    return v >= 0 ? `rgba(41,182,246,${0.12 + a * 0.7})` : `rgba(255,71,87,${0.12 + a * 0.7})`;
  };
  const badgeColor: Record<string, string> = { "#1": "#ffd700", "#2": "#c0c0c0", "#3": "#cd7f32" };
  const W = 560, rowH = 26, headH = 22, labelW = 64, gridX = labelW;
  const colW = (W - gridX) / cols.length;
  const H = headH + rows.length * rowH + 6;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Example GEX heatmap grid">
      {/* column headers */}
      {cols.map((c, i) => (
        <text key={c} x={gridX + i * colW + colW / 2} y={14} textAnchor="middle" fontSize="8" fontWeight="800" fill={C.muted} letterSpacing="0.04em">{c}</text>
      ))}
      {rows.map((r, ri) => {
        const y = headH + ri * rowH;
        return (
          <g key={r.k}>
            {/* strike label + badge */}
            <rect x="0" y={y} width={labelW} height={rowH - 2} rx="3"
              fill={r.atm ? "rgba(33,158,188,0.10)" : "transparent"}
              stroke={r.atm ? C.cyan : "transparent"} strokeWidth={r.atm ? 1 : 0} />
            <text x="8" y={y + rowH / 2 + 1} fontSize="9" fontWeight={r.atm ? 800 : 600} fill={r.atm ? C.cyan : "#cdd8e6"} fontFamily="monospace">{r.k}</text>
            {r.badge && (
              <>
                <circle cx={labelW - 11} cy={y + rowH / 2 - 1} r="6.5" fill={`${badgeColor[r.badge]}22`} stroke={badgeColor[r.badge]} strokeWidth="0.8" />
                <text x={labelW - 11} y={y + rowH / 2 + 1.5} textAnchor="middle" fontSize="6.5" fontWeight="800" fill={badgeColor[r.badge]}>{r.badge}</text>
              </>
            )}
            {r.atm && <text x={labelW + 2} y={y + 7} fontSize="6" fontWeight="800" fill={C.cyan}>ATM</text>}
            {/* cells */}
            {r.v.map((v, ci) => (
              <rect key={ci} x={gridX + ci * colW + 1} y={y + 1} width={colW - 2} height={rowH - 4} rx="2" fill={cellColor(v)} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** Smooth gamma profile curve crossing zero = the flip price. */
function GammaFlipExample() {
  const W = 560, H = 180, padL = 24, padR = 16, padT = 16, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const zeroY = padT + innerH / 2;
  // profile rises left→right, crossing zero ~40% across
  const pts = Array.from({ length: 40 }, (_, i) => {
    const t = i / 39;
    const val = Math.tanh((t - 0.4) * 5); // -1..1
    return [padL + t * innerW, zeroY - val * (innerH / 2) * 0.9] as const;
  });
  const flipT = 0.4;
  const flipX = padL + flipT * innerW;
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Example gamma flip profile curve">
      {/* shaded regions */}
      <rect x={padL} y={padT} width={flipX - padL} height={innerH} fill="rgba(255,71,87,0.06)" />
      <rect x={flipX} y={padT} width={W - padR - flipX} height={innerH} fill="rgba(41,182,246,0.06)" />
      <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
      {/* flip line */}
      <line x1={flipX} y1={padT} x2={flipX} y2={padT + innerH} stroke={C.orange} strokeWidth="1.4" strokeDasharray="3 2" />
      <text x={flipX} y={padT - 4} textAnchor="middle" fontSize="8.5" fontWeight="800" fill={C.orange}>GAMMA FLIP</text>
      {/* profile curve */}
      <path d={path} fill="none" stroke={C.orange} strokeWidth="2" />
      {/* region labels */}
      <text x={padL + (flipX - padL) / 2} y={padT + innerH - 6} textAnchor="middle" fontSize="8" fill={C.heatNeg} fontWeight="700">below: short γ → trend / vol</text>
      <text x={flipX + (W - padR - flipX) / 2} y={padT + 12} textAnchor="middle" fontSize="8" fill={C.posBar} fontWeight="700">above: long γ → chop / pin</text>
      <text x={padL + 2} y={padT + 10} fontSize="7.5" fill={C.muted}>+GEX</text>
      <text x={padL + 2} y={padT + innerH - 2} fontSize="7.5" fill={C.muted}>−GEX</text>
    </svg>
  );
}

/** One Greeks-page card: accent border + tint, icon, value, sign badge, mini area graph.
 *  Mirrors GreekCard in app/greeks/page.tsx. */
function GreekMiniCard({ icon, label, sub, accent, value, sign }: {
  icon: string; label: string; sub: string; accent: string; value: string; sign: "POSITIVE" | "NEGATIVE";
}) {
  const signColor = sign === "POSITIVE" ? "#00e676" : "#ff5252";
  // little zero-cross area path
  const pts = [0.1, 0.35, 0.2, 0.55, 0.7, 0.5, 0.85];
  const w = 150, h = 30, base = h - 3;
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${(i / (pts.length - 1) * w).toFixed(1)},${(base - p * (h - 6)).toFixed(1)}`).join(" ");
  return (
    <div style={{ border: `1px solid ${accent}59`, background: `linear-gradient(180deg,${accent}14,rgba(0,0,0,.28))`, borderRadius: 10, padding: 11 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${accent}59`, display: "flex", alignItems: "center", justifyContent: "center", color: accent, fontWeight: 800, fontSize: 12 }}>{icon}</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#eef7ff", lineHeight: 1.1 }}>{label}</div>
            <div style={{ fontSize: 7.5, color: accent, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase" }}>{sub}</div>
          </div>
        </div>
        <span style={{ fontSize: 7.5, color: signColor, border: `1px solid ${signColor}59`, padding: "2px 5px", borderRadius: 4, fontWeight: 800 }}>{sign}</span>
      </div>
      <div style={{ fontSize: 7.5, color: "#c9d7db", textTransform: "uppercase", letterSpacing: ".08em" }}>Current Value</div>
      <div style={{ fontSize: 20, fontWeight: 900, color: accent, fontFamily: "monospace", lineHeight: 1.15 }}>{value}</div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="30" style={{ marginTop: 6, display: "block" }} preserveAspectRatio="none">
        <line x1="0" y1={base - 0.4 * (h - 6)} x2={w} y2={base - 0.4 * (h - 6)} stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="3 3" />
        <path d={`${d} L${w},${base} L0,${base} Z`} fill={`${accent}22`} />
        <path d={d} fill="none" stroke={accent} strokeWidth="1.6" />
      </svg>
    </div>
  );
}

/** The Greeks page: a 2x2 grid of greek cards. */
function GreeksPageExample() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <GreekMiniCard icon="■" label="GEX" sub="Gamma Exposure" accent="#22d3ee" value="+$94.5B" sign="POSITIVE" />
      <GreekMiniCard icon="▲" label="DEX" sub="Delta Exposure" accent="#a78bfa" value="−$12.3B" sign="NEGATIVE" />
      <GreekMiniCard icon="◆" label="CHEX" sub="Charm Exposure" accent="#2dd4bf" value="+$420M" sign="POSITIVE" />
      <GreekMiniCard icon="◈" label="VEX" sub="Vanna Exposure" accent="#e879f9" value="−$85M" sign="NEGATIVE" />
    </div>
  );
}

/** The Multi-Greek grid: strike column + NET GEX/DEX/CHEX/VEX, gold ATM row, signed totals.
 *  Mirrors app/mult-greek/page.tsx (metricBg blue/red, ATM gold). */
function MultiGreekExample() {
  const cols = ["NET GEX", "NET DEX", "NET CHEX", "NET VEX"];
  // each cell: value in [-1,1] drives blue(+)/red(−) intensity; rank 1 = brightest
  const rows = [
    { k: "5310", atm: false, v: [0.95, 0.40, 0.30, -0.20] },
    { k: "5300", atm: false, v: [0.55, 0.25, 0.45, 0.35] },
    { k: "5290", atm: true,  v: [0.30, -0.15, 0.20, 0.15] },
    { k: "5280", atm: false, v: [-0.45, -0.55, -0.25, 0.20] },
    { k: "5270", atm: false, v: [-0.80, -0.30, 0.35, -0.40] },
  ];
  const cell = (v: number) => {
    const a = Math.min(1, Math.abs(v));
    return v >= 0 ? `rgba(41,182,246,${(0.12 + a * 0.7).toFixed(2)})` : `rgba(255,71,87,${(0.12 + a * 0.7).toFixed(2)})`;
  };
  const grid = "64px 1fr 1fr 1fr 1fr";
  const totals = ["+$94.5B", "−$12.3B", "+$420M", "−$85M"];
  const totalPos = [true, false, true, false];
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", fontFamily: "monospace" }}>
      {/* header */}
      <div style={{ display: "grid", gridTemplateColumns: grid, background: "rgba(13,17,25,0.9)", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ padding: "5px 4px", fontSize: 8, color: "#94a3b8", textAlign: "center", fontWeight: 800 }}>STRIKE</div>
        {cols.map((c) => <div key={c} style={{ padding: "5px 4px", fontSize: 8, color: "#94a3b8", textAlign: "center", fontWeight: 800 }}>{c}</div>)}
      </div>
      {/* totals row */}
      <div style={{ display: "grid", gridTemplateColumns: grid, background: "rgba(33,158,188,0.03)", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ padding: "4px", fontSize: 8.5, color: "#cbd5e1", textAlign: "center", fontWeight: 700 }}>TOTAL</div>
        {totals.map((t, i) => (
          <div key={i} style={{ padding: "4px", fontSize: 9, textAlign: "center", fontWeight: 800, color: totalPos[i] ? "#29b6f6" : "#ff4757" }}>
            <span style={{ color: totalPos[i] ? "#22c55e" : "#ef4444" }}>{totalPos[i] ? "+" : "−"}</span>{t.replace(/[+−-]/, "")}
          </div>
        ))}
      </div>
      {/* rows */}
      {rows.map((r) => (
        <div key={r.k} style={{ display: "grid", gridTemplateColumns: grid, background: r.atm ? "rgba(255,179,0,.07)" : "transparent", outline: r.atm ? "1px solid rgba(255,255,255,.5)" : "none", outlineOffset: -1, borderBottom: r.atm ? "none" : "1px solid rgba(30,48,80,.35)" }}>
          <div style={{ padding: "6px 4px", fontSize: 9.5, textAlign: "center", fontWeight: 700, color: r.atm ? "#ffb300" : "#94a3b8", background: r.atm ? "rgba(255,179,0,.12)" : "transparent", borderRight: "1px solid rgba(255,255,255,.06)" }}>{r.k}</div>
          {r.v.map((v, ci) => (
            <div key={ci} style={{ padding: "6px 4px", fontSize: 9, textAlign: "center", color: "#fff", background: cell(v) }}>
              {v >= 0 ? "+" : "−"}{(Math.abs(v) * 9.9).toFixed(1)}B
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The Estimated Moves page: a Ticker/Close/Exp/EM/Up/Down table.
 *  Mirrors EstimatedMoves.tsx (EM gold, Up green, Down red, cyan header). */
function EstimatedMovesTableExample() {
  const head = ["Ticker", "Close", "Exp", "EM", "Up", "Down"];
  const rows = [
    ["SPX", "5290.10", "6/27", "±63.2", "5353.3", "5226.9"],
    ["SPY", "527.40", "6/27", "±6.3", "533.7", "521.1"],
    ["QQQ", "468.20", "6/27", "±7.1", "475.3", "461.1"],
    ["NDX", "18 940", "6/27", "±310", "19 250", "18 630"],
  ];
  // column text colors: Ticker, Close, Exp, EM(gold), Up(green), Down(red)
  const colColor = ["#e8edf5", "#eef7ff", "#eef7ff", "#e8c060", "#00e676", "#ff4757"];
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ background: "rgba(33,158,188,0.04)", borderBottom: `1px solid ${C.border}`, padding: "7px 10px", textAlign: "center" }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#eef7ff", letterSpacing: ".16em", textTransform: "uppercase" }}>
          Weekly Estimated Move For <span style={{ color: "#219EBC" }}>Fri 6/27</span>
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Consolas, Monaco, monospace" }}>
        <thead>
          <tr style={{ background: "rgba(13,17,25,0.9)", color: "#219EBC", textAlign: "center" }}>
            {head.map((h, i) => (
              <th key={h} style={{ padding: "6px 4px", fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase", borderRight: i < head.length - 1 ? `1px solid ${C.border}` : undefined, borderBottom: `1px solid ${C.border}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} style={{ textAlign: "center", borderBottom: `1px solid ${C.border}` }}>
              {r.map((cellv, ci) => (
                <td key={ci} style={{ padding: "5px 4px", fontSize: 10, color: colColor[ci], fontWeight: ci === 0 ? 700 : 400, borderRight: ci < r.length - 1 ? `1px solid ${C.border}` : undefined }}>{cellv}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** ES Candles page: 5m candles + GEX heatmap columns behind them, call/put/flip
 *  level lines, and a volume profile (POC/VAH/VAL) down the right. */
function EsCandlesExample() {
  const W = 560, H = 250, padL = 6, padR = 92, padT = 14, padB = 18;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  // 12 candles, gently trending up then pulling back
  const candles = [
    { o: 40, c: 52, h: 56, l: 36 }, { o: 52, c: 48, h: 58, l: 44 },
    { o: 48, c: 63, h: 66, l: 46 }, { o: 63, c: 70, h: 74, l: 60 },
    { o: 70, c: 66, h: 73, l: 62 }, { o: 66, c: 80, h: 84, l: 64 },
    { o: 80, c: 88, h: 92, l: 78 }, { o: 88, c: 84, h: 91, l: 80 },
    { o: 84, c: 76, h: 87, l: 72 }, { o: 76, c: 82, h: 85, l: 70 },
    { o: 82, c: 94, h: 98, l: 80 }, { o: 94, c: 90, h: 99, l: 86 },
  ];
  const vMin = 30, vMax = 104;
  const yOf = (v: number) => padT + innerH - ((v - vMin) / (vMax - vMin)) * innerH;
  const bw = innerW / candles.length;
  // heatmap columns: per slot, a few strike cells of varying gamma intensity
  const heatRows = [96, 86, 76, 66, 56, 46, 38];
  const heatColor = (i: number, ci: number) => {
    const pos = i < 5;
    const a = 0.06 + Math.abs(Math.sin(ci * 1.3 + i)) * 0.28;
    return pos ? `rgba(41,182,246,${a.toFixed(2)})` : `rgba(255,71,87,${a.toFixed(2)})`;
  };
  // profile (right gutter)
  const prof = [0.3, 0.5, 0.9, 1.0, 0.7, 0.45, 0.25];
  const pocIdx = 3;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Example ES candles with GEX heatmap overlay">
      {/* heatmap columns behind candles */}
      {candles.map((_, ci) => (
        <g key={ci}>
          {heatRows.map((hv, i) => (
            <rect key={i} x={padL + ci * bw} y={yOf(hv) - 7} width={bw - 1} height={14} fill={heatColor(i, ci)} />
          ))}
        </g>
      ))}
      {/* level lines */}
      <line x1={padL} y1={yOf(90)} x2={padL + innerW} y2={yOf(90)} stroke={C.posBar} strokeWidth="1" strokeDasharray="4 3" opacity="0.9" />
      <text x={padL + 3} y={yOf(90) - 3} fontSize="7.5" fill={C.posBar} fontWeight="700">CALL WALL</text>
      <line x1={padL} y1={yOf(44)} x2={padL + innerW} y2={yOf(44)} stroke={C.heatNeg} strokeWidth="1" strokeDasharray="4 3" opacity="0.9" />
      <text x={padL + 3} y={yOf(44) + 9} fontSize="7.5" fill={C.heatNeg} fontWeight="700">PUT WALL</text>
      <line x1={padL} y1={yOf(67)} x2={padL + innerW} y2={yOf(67)} stroke={C.orange} strokeWidth="1.1" strokeDasharray="2 2" opacity="0.95" />
      <text x={padL + 3} y={yOf(67) - 3} fontSize="7.5" fill={C.orange} fontWeight="700">FLIP</text>
      {/* candles */}
      {candles.map((cd, i) => {
        const up = cd.c >= cd.o;
        const col = up ? "#26a69a" : "#ef5350";
        const x = padL + i * bw + bw / 2;
        const bodyW = bw * 0.52;
        return (
          <g key={i}>
            <line x1={x} y1={yOf(cd.h)} x2={x} y2={yOf(cd.l)} stroke={col} strokeWidth="1" />
            <rect x={x - bodyW / 2} y={yOf(Math.max(cd.o, cd.c))} width={bodyW} height={Math.max(1, Math.abs(yOf(cd.o) - yOf(cd.c)))} fill={col} />
          </g>
        );
      })}
      {/* volume profile gutter */}
      {heatRows.map((hv, i) => {
        const w = prof[i] * (padR - 16);
        return (
          <g key={i}>
            <rect x={W - padR + 6} y={yOf(hv) - 6} width={w} height={12} rx="1.5" fill={i === pocIdx ? C.cyan : "rgba(120,170,220,0.35)"} opacity={i === pocIdx ? 0.9 : 0.7} />
            {i === pocIdx && <text x={W - padR + 8} y={yOf(hv) + 3} fontSize="7" fontWeight="800" fill="#06121d">POC</text>}
          </g>
        );
      })}
      <text x={W - padR + 6} y={padT + 6} fontSize="7.5" fill={C.muted} fontWeight="700">VOL PROFILE</text>
    </svg>
  );
}

/** ICT page: candles with a Fair Value Gap box, a bullish Order Block, a swept
 *  liquidity level (BSL) and a CHOCH structure-break tag. */
function IctExample() {
  const W = 560, H = 220, padL = 8, padR = 8, padT = 14, padB = 16;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const candles = [
    { o: 60, c: 52, h: 64, l: 48 }, { o: 52, c: 58, h: 62, l: 50 },
    { o: 58, c: 46, h: 60, l: 42 }, { o: 46, c: 40, h: 48, l: 34 }, // OB = last down candle
    { o: 40, c: 64, h: 66, l: 39 }, // displacement up (leaves FVG)
    { o: 64, c: 78, h: 82, l: 62 },
    { o: 78, c: 74, h: 84, l: 71 }, { o: 74, c: 88, h: 92, l: 72 }, // sweeps BSL
    { o: 88, c: 80, h: 90, l: 76 }, { o: 80, c: 70, h: 83, l: 66 }, // CHOCH down
    { o: 70, c: 74, h: 77, l: 66 }, { o: 74, c: 68, h: 78, l: 64 },
  ];
  const vMin = 30, vMax = 98;
  const yOf = (v: number) => padT + innerH - ((v - vMin) / (vMax - vMin)) * innerH;
  const bw = innerW / candles.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Example ICT chart with FVG, order block, liquidity sweep and CHOCH">
      {/* BSL liquidity line (swept) */}
      <line x1={padL} y1={yOf(84)} x2={padL + innerW} y2={yOf(84)} stroke={C.green} strokeWidth="1" strokeDasharray="3 2" opacity="0.8" />
      <text x={padL + 2} y={yOf(84) - 3} fontSize="7.5" fill={C.green} fontWeight="700">BSL (equal highs)</text>
      {/* FVG box between candle 3 high and candle 5 low region */}
      <rect x={padL + 3.5 * bw} y={yOf(64)} width={bw * 3} height={yOf(48) - yOf(64)} fill="rgba(33,158,188,0.16)" stroke={C.cyan} strokeWidth="0.7" strokeDasharray="2 2" />
      <text x={padL + 3.6 * bw} y={yOf(64) + 9} fontSize="7" fill={C.cyan} fontWeight="800">FVG</text>
      {/* Order block on candle 4 */}
      <rect x={padL + 3 * bw - 1} y={yOf(48)} width={bw} height={yOf(34) - yOf(48)} fill="rgba(142,202,230,0.18)" stroke={C.green} strokeWidth="0.8" />
      <text x={padL + 3 * bw - 1} y={yOf(34) + 8} fontSize="6.5" fill={C.green} fontWeight="800">OB</text>
      {/* CHOCH tag */}
      <line x1={padL + 8.5 * bw} y1={yOf(76)} x2={padL + 9.7 * bw} y2={yOf(76)} stroke={C.orange} strokeWidth="1" />
      <rect x={padL + 8.6 * bw} y={yOf(76) - 14} width="40" height="12" rx="2" fill="rgba(251,133,1,0.16)" stroke={C.orange} strokeWidth="0.7" />
      <text x={padL + 8.6 * bw + 20} y={yOf(76) - 5} textAnchor="middle" fontSize="7.5" fontWeight="800" fill={C.orange}>CHOCH</text>
      {/* candles */}
      {candles.map((cd, i) => {
        const up = cd.c >= cd.o;
        const col = up ? "#26a69a" : "#ef5350";
        const x = padL + i * bw + bw / 2;
        const bodyW = bw * 0.5;
        return (
          <g key={i}>
            <line x1={x} y1={yOf(cd.h)} x2={x} y2={yOf(cd.l)} stroke={col} strokeWidth="1" />
            <rect x={x - bodyW / 2} y={yOf(Math.max(cd.o, cd.c))} width={bodyW} height={Math.max(1, Math.abs(yOf(cd.o) - yOf(cd.c)))} fill={col} />
          </g>
        );
      })}
    </svg>
  );
}

/** Options Chain page: calls on the left, strikes in the center, puts on the
 *  right, ATM row highlighted. Mirrors the by-strike layout. */
function OptionsChainExample() {
  const rows = [
    { k: "5320", atm: false, cBid: "2.10", cMid: "2.35", pBid: "61.4", pMid: "62.0" },
    { k: "5310", atm: false, cBid: "4.05", cMid: "4.30", pBid: "53.2", pMid: "53.9" },
    { k: "5300", atm: false, cBid: "7.80", cMid: "8.10", pBid: "46.0", pMid: "46.7" },
    { k: "5290", atm: true,  cBid: "14.2", cMid: "14.6", pBid: "38.1", pMid: "38.8" },
    { k: "5280", atm: false, cBid: "23.5", cMid: "24.0", pBid: "27.4", pMid: "28.0" },
    { k: "5270", atm: false, cBid: "35.1", cMid: "35.7", pBid: "19.0", pMid: "19.6" },
  ];
  const cell = (v: string, color: string, bold = false) => (
    <td style={{ padding: "5px 6px", fontSize: 10, color, textAlign: "center", fontWeight: bold ? 700 : 400, fontFamily: "monospace" }}>{v}</td>
  );
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: "rgba(13,17,25,0.9)", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ padding: "5px", fontSize: 8.5, fontWeight: 800, letterSpacing: ".1em", textAlign: "center", color: C.green }}>CALLS</div>
        <div style={{ padding: "5px", fontSize: 8.5, fontWeight: 800, letterSpacing: ".1em", textAlign: "center", color: C.cyan }}>STRIKE</div>
        <div style={{ padding: "5px", fontSize: 8.5, fontWeight: 800, letterSpacing: ".1em", textAlign: "center", color: C.red }}>PUTS</div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: C.muted, fontSize: 8, textAlign: "center" }}>
            {cellHead("Bid")}{cellHead("Mid")}{cellHead("")}{cellHead("Bid")}{cellHead("Mid")}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} style={{ background: r.atm ? "rgba(33,158,188,0.10)" : "transparent", outline: r.atm ? `1px solid ${C.cyan}` : "none", outlineOffset: -1, borderBottom: `1px solid ${C.border}` }}>
              {cell(r.cBid, "#cdd8e6")}{cell(r.cMid, C.green)}
              {cell(r.k, r.atm ? C.cyan : "#cdd8e6", true)}
              {cell(r.pBid, "#cdd8e6")}{cell(r.pMid, C.red)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function cellHead(v: string) {
  return <th style={{ padding: "3px 6px", fontSize: 7.5, fontWeight: 700, color: "#7e93ab", textAlign: "center" }}>{v}</th>;
}

/** Traders Dashboard: a 2x2 mini layout — schedule, futures, key drivers, AI overview. */
function TradersDashboardExample() {
  const panel = (title: string, accent: string, children: React.ReactNode) => (
    <div style={{ border: `1px solid ${accent}40`, background: `linear-gradient(180deg,${accent}10,rgba(0,0,0,.2))`, borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: accent, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
  const line = (a: string, b: string, bc: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, padding: "2px 0", color: "#cdd8e6", fontFamily: "monospace" }}>
      <span>{a}</span><span style={{ color: bc, fontWeight: 700 }}>{b}</span>
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {panel("Schedule & Tasks", C.cyan, <>
        {line("06:30  Premarket prep", "✓", C.green)}
        {line("09:30  Open / GEX check", "•", C.cyan)}
        {line("15:00  Power hour", "", C.muted)}
      </>)}
      {panel("Live Futures", C.posBar, <>
        {line("ES", "+0.42%", C.green)}
        {line("NQ", "+0.61%", C.green)}
        {line("YM", "−0.08%", C.heatNeg)}
      </>)}
      {panel("Key Drivers", C.orange, <>
        {line("08:30  CPI (USD)", "HIGH", C.orange)}
        {line("10:00  Fed speak", "MED", C.muted)}
      </>)}
      {panel("AI Overview", C.green, (
        <div style={{ fontSize: 8.5, lineHeight: 1.5, color: "#cdd8e6" }}>
          Risk-on bias into CPI; ES holding above flip with the call wall overhead as the magnet…
        </div>
      ))}
    </div>
  );
}

// ─── Article registry ─────────────────────────────────────────────────────────

interface Article {
  id: string;
  title: string;
  group: string;
  blurb: string;
  status?: "complete" | "draft";
  body: () => React.ReactNode;
}

const ARTICLES: Article[] = [
  // ── Getting Started ─────────────────────────────────────────────────────────
  {
    id: "overview",
    title: "Welcome",
    group: "Getting Started",
    blurb: "What this dashboard is and how the docs are organized.",
    status: "complete",
    body: () => (
      <>
        <ThemeCard accent="cyan" title="CB Edge Knowledge Base" style={{ margin: "4px 0 18px" }}>
          <Lead>
            Short, practical guides to reading the dashboard and turning what you see into decisions. Start with the two
            flagship tools below; the concept pages explain the &ldquo;why&rdquo; behind them.
          </Lead>
        </ThemeCard>

        <ThemeCard accent="purple" title="Where to begin" style={{ margin: "0 0 18px" }}>
          <Steps
            items={[
              <>New to gamma exposure? Read <Term>What is GEX?</Term> first — it&rsquo;s the foundation for everything else.</>,
              <>Then work through the <Term>GEX Chart</Term> guide — the main visual on the home page.</>,
              <>Pair it with the <Term>GEX Heatmap</Term> guide — the same data as a strike-by-strike grid.</>,
              <>Keep the <Term>Glossary</Term> open in another tab the first few sessions.</>,
            ]}
          />
        </ThemeCard>

        <ThemeCard accent="green" title="How to read these guides" style={{ margin: 0 }}>
          <P>
            Anything shown like <UI>Net GEX</UI> is a button or label you&rsquo;ll find on screen. Color chips like{" "}
            <Swatch color={C.posBar} /> match the exact colors used in the app.
          </P>
        </ThemeCard>
      </>
    ),
  },

  // ── Core Tools ──────────────────────────────────────────────────────────────
  {
    id: "gex-chart",
    title: "GEX Chart",
    group: "Core Tools",
    blurb: "The main bar chart: net gamma by strike, overlays, and how to read the levels.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          The GEX chart is the centerpiece of the dashboard. Each vertical bar is one SPX strike, and the bar&rsquo;s height
          and color tell you how much dealer gamma sits there — and which way it pushes price. It updates live as orderflow
          comes in.
        </Lead>

        <Figure caption={<>Blue bars = positive gamma (above the zero line), gold = negative (below). The <strong style={{ color: C.text }}>CB</strong> tag marks the biggest wall, the dashed white line is live <strong style={{ color: C.text }}>SPX</strong>, and the orange <strong style={{ color: C.orange }}>FLIP</strong> line is where gamma crosses zero.</>}>
          <GexChartExample />
        </Figure>

        <H2>What you&rsquo;re looking at</H2>
        <P>
          The horizontal axis is <Term>strike price</Term> (labelled every 50 points), centered on the at-the-money strike.
          The vertical axis is <Term>gamma exposure (GEX)</Term> — bars go <em>up</em> for positive gamma and <em>down</em>{" "}
          for negative gamma, measured from the center zero line.
        </P>
        <Card accent={C.green}>
          <LegendRow color={C.posBar} name="Positive GEX (up)">
            Dealers are long gamma here. They trade <em>against</em> moves — selling rallies, buying dips — which{" "}
            <Term>dampens</Term> volatility and tends to pin price. Bars brighten slightly as magnitude grows.
          </LegendRow>
          <LegendRow color={C.negBar} name="Negative GEX (down)">
            Dealers are short gamma here. They trade <em>with</em> moves — selling weakness, buying strength — which{" "}
            <Term>amplifies</Term> volatility and accelerates trends.
          </LegendRow>
        </Card>

        <H3>The labels on the chart</H3>
        <Card accent={C.orange}>
          <LegendRow color={C.text} name="CB tag">
            Sits over the single largest bar by absolute net GEX — the <Term>Most Valuable Contract</Term>, the strike with
            the most dealer gamma. This is your headline magnet / wall level. Colored cyan if positive, gold if negative.
          </LegendRow>
          <LegendRow color="#dcdcdc" name="SPX spot line" soft>
            The dashed white vertical line is the live SPX price, interpolated between strikes. Where price sits relative to
            the bars tells you whether you&rsquo;re above or below the big gamma.
          </LegendRow>
          <LegendRow color={C.orange} name="+GEX FLIP line">
            Appears with the <UI>GEX Flip</UI> overlay (0DTE only): the dashed orange line marks the <Term>gamma flip</Term>{" "}
            — the price where total gamma crosses from negative to positive. Above it, expect dampening; below it, expect
            acceleration.
          </LegendRow>
        </Card>

        <H2>The toolbar, control by control</H2>
        <P>Across the top of the chart panel:</P>

        <H3>Expiry picker</H3>
        <P>
          The two date buttons on the far left switch between <UI>0DTE</UI> (today&rsquo;s expiration) and{" "}
          <UI>1DTE</UI> (the next session). 0DTE gamma is the most reactive intraday; 1DTE adds the next day&rsquo;s
          positioning.
        </P>

        <H3>
          <UI>Net GEX</UI> vs <UI>Call - Put</UI>
        </H3>
        <Card accent={C.purple}>
          <LegendRow color={C.posBar} name="Net GEX">
            Each bar is call gamma minus put gamma — one net value per strike. The default, and the cleanest read of where
            price gets pinned or pushed.
          </LegendRow>
          <LegendRow color={C.negBar} name="Call - Put">
            Splits each strike into two bars: call gamma up (<Swatch color={C.posBar} />) and put gamma down (
            <Swatch color={C.negBar} />). Use it to see whether a level is driven by call or put positioning.
          </LegendRow>
        </Card>

        <H3>
          <UI>OI + Vol</UI> vs <UI>Vol Only</UI>
        </H3>
        <Card>
          <LegendRow color={C.cyan} name="OI + Vol">
            Uses open interest plus the day&rsquo;s volume — the full standing book. Best for the structural picture.
          </LegendRow>
          <LegendRow color={C.cyan} name="Vol Only">
            Uses only today&rsquo;s traded volume — strips out yesterday&rsquo;s open interest to show <em>fresh</em>{" "}
            positioning building right now.
          </LegendRow>
        </Card>

        <H3>Overlay toggles</H3>
        <Card>
          <LegendRow color={C.green} name="OI Overlay">
            Adds shaded curves for raw open interest — green (<Swatch color={C.green} />) for call OI, red (
            <Swatch color={C.red} />) for put OI — so you can see where contracts are stacked independent of gamma.
          </LegendRow>
          <LegendRow color={C.purple} name="Net DEX">
            Draws the <Term>delta exposure</Term> line in purple. Where it crosses zero and which way it leans hints at
            directional dealer hedging pressure, separate from gamma.
          </LegendRow>
          <LegendRow color={C.orange} name="GEX Flip">
            Draws the smooth gamma <Term>profile curve</Term> and the flip line (0DTE only). The curve&rsquo;s zero-crossing
            is the flip price.
          </LegendRow>
        </Card>

        <H3>Time-decay &ldquo;ghost&rdquo; overlays — 5m / 15m / 30m</H3>
        <P>
          These appear only in <UI>Net GEX</UI> + <UI>OI + Vol</UI> mode. Each one overlays where net GEX sat at that strike{" "}
          <Term>that many minutes ago</Term>, so you can see gamma building or bleeding in real time.
        </P>
        <Card>
          <LegendRow color={C.posBar} name="Rose (↑)">
            A blue outline/cap means gamma <Term>grew</Term> at that strike over the window — positioning is being added.
          </LegendRow>
          <LegendRow color={C.negBar} name="Fell (↓)">
            A gold halo behind the live bar means gamma <Term>shrank</Term> — the prior, taller level is drawn faded behind
            the current one.
          </LegendRow>
        </Card>
        <Callout kind="note">
          History builds up over the session, so right after open the ghosts may read &ldquo;No prior GEX history yet for
          this expiry&rdquo; until enough snapshots exist.
        </Callout>

        <H3>Refresh, Snap & Discord</H3>
        <P>
          On the right: a manual <UI>Refresh</UI>, a <UI>Snap</UI> button that captures the chart as an image, and a Discord
          button that posts that snapshot to your channel.
        </P>

        <H2>Reading it in practice</H2>
        <Steps
          items={[
            <>Find the <Term>CB</Term> tag — that&rsquo;s the dominant level for the day.</>,
            <>Check where the dashed <Term>SPX</Term> line sits relative to the big bars and the flip line.</>,
            <>Above the flip with tall positive bars overhead → expect chop / pinning into that strike.</>,
            <>Below the flip in negative gamma → expect faster, trendier moves; levels are weaker.</>,
            <>Turn on <UI>5m</UI> / <UI>15m</UI> to see whether the wall ahead of price is <em>growing</em> (gaining strength) or <em>melting</em> (about to give way).</>,
          ]}
        />

        <H2>Mouse & touch controls</H2>
        <Card>
          <DefRow term="Scroll">Zoom in/out, anchored on the cursor.</DefRow>
          <DefRow term="Drag">Pan left/right across strikes.</DefRow>
          <DefRow term="Drag (left edge)">Stretch/compress the vertical (GEX) scale.</DefRow>
          <DefRow term="Double-click">Recenter on at-the-money and reset zoom.</DefRow>
          <DefRow term="Hover">Tooltip with the exact strike and GEX value.</DefRow>
          <DefRow term="Click a bar">Opens the strike detail popup for that strike.</DefRow>
        </Card>

        <Callout kind="warn" title="Gamma is positioning, not a signal">
          GEX tells you the <em>terrain</em> — where volatility is likely to be dampened or amplified — not a buy/sell call.
          Use it to frame how price is likely to behave around levels, alongside your own setup.
        </Callout>
      </>
    ),
  },
  {
    id: "gex-heatmap",
    title: "GEX Heatmap",
    group: "Core Tools",
    blurb: "The strike-by-strike grid: five exposure columns, ATM anchoring, and rank highlights.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          The heatmap is the same gamma data as the chart, laid out as a table — one row per strike, brightest cells where
          exposure concentrates. It&rsquo;s the fastest way to scan exact values and compare five different exposure measures
          side by side.
        </Lead>

        <Figure caption={<>Strikes run down the side (highest on top); the cyan-outlined <strong style={{ color: C.cyan }}>ATM</strong> row tracks price. Blue = positive exposure, red = negative, brighter = bigger. Gold/silver/bronze <strong style={{ color: C.text }}>#1–#3</strong> badges rank the largest Net GEX walls on each side.</>}>
          <HeatmapExample />
        </Figure>

        <H2>Layout</H2>
        <P>
          Strikes run down the left, <Term>highest at the top</Term>, and the grid auto-scrolls to keep the at-the-money
          strike centered. The <UI>ATM</UI> row is outlined in cyan with an <UI>ATM</UI> tag so you always know where price
          is. The window holds roughly 20 strikes either side of the money and re-centers only after price moves more than a
          strike (so it doesn&rsquo;t flicker on every tick).
        </P>

        <H2>The five columns</H2>
        <Card>
          <LegendRow color={C.posBar} name="NET GEX">
            Net gamma per strike (calls minus puts) using open interest + volume. The core column — your gamma walls.
          </LegendRow>
          <LegendRow color={C.posBar} name="VOL ONLY GEX">
            Net gamma from <Term>today&rsquo;s volume only</Term>. Shows fresh intraday positioning, ignoring standing OI.
          </LegendRow>
          <LegendRow color={C.posBar} name="DEX">
            <Term>Delta exposure</Term> per strike — directional dealer hedging pressure rather than volatility damping.
          </LegendRow>
          <LegendRow color={C.posBar} name="GEX + VEX">
            Gamma plus <Term>vanna</Term> exposure — adds sensitivity to volatility shifts on top of raw gamma. Useful on
            days when IV is moving.
          </LegendRow>
          <LegendRow color={C.posBar} name="30 MIN ROLLING NET GEX">
            Net GEX averaged/accumulated over the last 30 minutes, smoothing out single-tick noise to show the persistent
            level.
          </LegendRow>
        </Card>

        <H2>Reading the colors</H2>
        <P>Every cell is colored by sign and magnitude:</P>
        <Card>
          <LegendRow color={C.posBar} name="Blue cells">
            Positive exposure (long-gamma / dampening). The brighter the blue, the larger the value.
          </LegendRow>
          <LegendRow color={C.heatNeg} name="Red cells">
            Negative exposure (short-gamma / amplifying). Brighter red = larger magnitude.
          </LegendRow>
        </Card>
        <P>
          Within each column the <Term>top three strikes</Term> by magnitude are boldened and fully saturated, so the
          dominant levels jump out even when nearby cells are faint.
        </P>

        <H3>The #1–#5 rank badges</H3>
        <P>
          Next to the strike number you&rsquo;ll see colored rank chips. These rank the <Term>five biggest Net GEX strikes</Term>{" "}
          on each side of the money separately (above ATM and below ATM), so you instantly see the key walls overhead and
          underneath:
        </P>
        <Card>
          <LegendRow color="#ffd700" name="#1 — gold">Largest gamma wall on that side.</LegendRow>
          <LegendRow color="#c0c0c0" name="#2 — silver">Second largest.</LegendRow>
          <LegendRow color="#cd7f32" name="#3 — bronze">Third largest.</LegendRow>
          <LegendRow color="#4a7a99" name="#4 / #5" soft>Next two, in muted blue.</LegendRow>
        </Card>

        <H2>Using it alongside the chart</H2>
        <Steps
          items={[
            <>Glance at the <UI>NET GEX</UI> column and the <Term>#1 gold</Term> badges — these are the same walls the chart&rsquo;s MVC and tall bars show, but with exact numbers.</>,
            <>Compare <UI>NET GEX</UI> to <UI>VOL ONLY GEX</UI>: if a level is huge in OI but small in volume, it&rsquo;s legacy positioning; big in volume means it&rsquo;s being built today.</>,
            <>Watch the <UI>30 MIN ROLLING</UI> column to confirm a wall is persistent rather than a one-print blip.</>,
            <>Check <UI>DEX</UI> for directional lean and <UI>GEX + VEX</UI> on high-IV days.</>,
            <>Click any row to open the full strike detail popup.</>,
          ]}
        />

        <Callout kind="tip" title="Chart for shape, heatmap for numbers">
          The chart is best for seeing the <em>terrain</em> at a glance; the heatmap is best when you need the precise value
          at a specific strike or want to compare exposure types. They&rsquo;re driven by the same live feed.
        </Callout>
        <Callout kind="note">
          The <UI>OI + Vol</UI> / <UI>Vol Only</UI> mode you pick on the chart toolbar also drives which figures populate the
          heatmap&rsquo;s OI-based columns.
        </Callout>
      </>
    ),
  },

  // ── Concepts ────────────────────────────────────────────────────────────────
  {
    id: "what-is-gex",
    title: "What is GEX?",
    group: "Concepts",
    blurb: "Gamma exposure in plain English — why dealer hedging moves the market.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          GEX — <Term>gamma exposure</Term> — estimates how much index-level buying or selling options dealers must do to
          stay hedged as price moves. It&rsquo;s the engine behind almost everything on this dashboard.
        </Lead>
        <H2>The short version</H2>
        <P>
          When you buy or sell an option, a market maker takes the other side and hedges it. As the underlying moves, the
          option&rsquo;s delta changes (that rate of change is <Term>gamma</Term>), so the dealer must keep re-hedging by
          trading the underlying. GEX aggregates that forced hedging across every strike.
        </P>
        <H2>Why the sign matters</H2>
        <Card>
          <LegendRow color={C.posBar} name="Positive / long gamma">
            Dealers buy dips and sell rips to stay flat. This <Term>absorbs</Term> moves — markets chop and pin. Tall
            positive walls act like magnets and ceilings/floors.
          </LegendRow>
          <LegendRow color={C.negBar} name="Negative / short gamma">
            Dealers sell weakness and buy strength — they hedge <Term>in the direction</Term> of the move, which feeds
            trends and bursts of volatility.
          </LegendRow>
        </Card>
        <P>
          The price where the total flips from negative to positive is the <Term>gamma flip</Term> — see its own page. Above
          it, conditions are typically calm; below it, fast.
        </P>
        <Callout kind="note">
          GEX is a <em>model estimate</em> built from the options chain, not a published number. Treat it as a high-quality
          map of likely dealer behavior, not a guarantee.
        </Callout>
      </>
    ),
  },
  {
    id: "gamma-flip",
    title: "The Gamma Flip",
    group: "Concepts",
    blurb: "The price where dealer gamma crosses zero — and why it's a regime line.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          The gamma flip is the price level where aggregate dealer gamma changes sign. It&rsquo;s shown as the dashed orange{" "}
          <UI>+GEX FLIP</UI> line on the chart (0DTE).
        </Lead>

        <Figure caption={<>The orange curve is the gamma profile as price moves. Where it crosses zero is the <strong style={{ color: C.orange }}>flip</strong>: red zone (left) is short-gamma / trend; blue zone (right) is long-gamma / chop.</>}>
          <GammaFlipExample />
        </Figure>

        <P>
          Above the flip, dealers are net long gamma → dampened, mean-reverting tape. Below it, net short gamma →
          accelerant, trend-prone tape. Crossing the flip intraday often marks a change in character, which is why traders
          watch it as a regime line rather than a simple support/resistance level.
        </P>
        <H2>How it&rsquo;s computed</H2>
        <P>
          The dashboard sweeps spot across a range and rebuilds the Black-Scholes gamma profile of the whole chain at each
          price, then finds the zero-crossing of total dealer gamma. That crossing is the flip level drawn on the chart.
        </P>
        <Callout kind="tip" title="Watch flip retests">
          A reclaim of the flip from below (into positive gamma) often cools volatility quickly; losing it from above can
          open up a faster, trendier move. Treat it as a regime line, not a precise support/resistance price.
        </Callout>
      </>
    ),
  },
  {
    id: "mvc",
    title: "CB — Core Bullseye",
    group: "Concepts",
    blurb: "The single biggest gamma strike, and how it's used across the app.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          The <Term>CB — Core Bullseye</Term> is the strike carrying the largest absolute net GEX: the single
          heaviest concentration of dealer gamma on the board. It&rsquo;s the headline level for the day, tagged right on the
          chart and threaded through the top bar, snapshots, and the Confidence score.
        </Lead>

        <H2>How it&rsquo;s chosen</H2>
        <P>
          The dashboard computes net GEX at every strike across the active chain, takes the <Term>absolute value</Term> of
          each (so a huge negative wall counts just as much as a huge positive one), and picks the single largest. That winner
          is the MVC. Because it&rsquo;s based on magnitude, the MVC can sit above or below price, and it can be a positive
          (long-gamma) wall or a negative (short-gamma) wall — the tag is colored cyan when positive, gold when negative.
        </P>
        <Card accent={C.cyan}>
          <LegendRow color={C.cyan} name="Follows the chart mode">
            The MVC follows the mode you pick on the chart toolbar. In <UI>OI + Vol</UI> it reflects the full standing book; in{" "}
            <UI>Vol Only</UI> it tracks the largest wall being built from <em>today&rsquo;s</em> volume, which can sit at a
            different strike than the OI-based one.
          </LegendRow>
        </Card>

        <H2>Why it matters</H2>
        <Card accent={C.orange}>
          <LegendRow color={C.posBar} name="Positive MVC → magnet">
            When the MVC is a long-gamma wall, dealers trade against moves around it — selling into rallies toward it and
            buying dips. Price tends to gravitate to and <Term>pin</Term> near that strike, especially into the close on 0DTE.
          </LegendRow>
          <LegendRow color={C.negBar} name="Negative MVC → pivot">
            When the MVC is a short-gamma wall, dealer hedging reinforces moves through it. Rather than a magnet, it behaves
            like a <Term>breakdown / breakout pivot</Term> — losing it can accelerate a trend.
          </LegendRow>
        </Card>

        <H2>Where it shows up</H2>
        <Card>
          <DefRow term="GEX Chart">The <UI>CB</UI> tag sits over the tallest bar by absolute net GEX.</DefRow>
          <DefRow term="Top bar">The MVC strike is surfaced in the header stat row as the day&rsquo;s key level.</DefRow>
          <DefRow term="Confidence">The Confidence score grades the MVC live as Hit / Pivot / Chop (see below).</DefRow>
        </Card>

        <H2>CB - Core Bullseye and the Confidence score</H2>
        <P>
          The Confidence page scores how the MVC is behaving in real time and classifies the session&rsquo;s likely outcome
          relative to that level:
        </P>
        <Card accent={C.green}>
          <LegendRow color={C.posBar} name="Hit">
            Price reaches and respects the CB - Core Bullseye — the magnet read played out. Most common when the CB - Core Bullseye is a strong positive
            wall and price is in positive gamma.
          </LegendRow>
          <LegendRow color={C.cyan} name="Pivot">
            Price uses the MVC as a turning point — tags it and reverses, or breaks it and the level flips role.
          </LegendRow>
          <LegendRow color={C.negBar} name="Chop">
            Price oscillates around the MVC without committing — typical of balanced, low-conviction tape.
          </LegendRow>
        </Card>

        <H2>When the MVC shifts mid-session</H2>
        <P>
          The CB - Core Bullseye isn&rsquo;t fixed — as volume builds and positioning changes, a different strike can overtake it. A{" "}
          <Term>migrating CB</Term> is information: if it climbs toward higher strikes through the morning, the dominant wall
          (and likely magnet) is moving up; if it jumps to a brand-new strike on heavy volume, fresh positioning is being laid
          down right where you should expect price to react.
        </P>
        <Steps
          items={[
            <>Find the <UI>CB</UI> tag — that&rsquo;s the day&rsquo;s primary level.</>,
            <>Note its sign: positive = magnet, negative = pivot.</>,
            <>Check where <Term>SPX</Term> sits relative to it and to the flip line.</>,
            <>Watch whether it holds the same strike or migrates as volume comes in.</>,
            <>Cross-reference the Confidence Hit / Pivot / Chop read for context.</>,
          ]}
        />
        <Card accent={C.orange}>
          <LegendRow color={C.orange} name="One level, not a system">
            The MVC is the loudest level on the board, but it&rsquo;s still just positioning. Use it to frame where price is
            likely to react — pair it with the flip line, the heatmap ranks, and your own setup rather than trading it blind.
          </LegendRow>
        </Card>
      </>
    ),
  },
  {
    id: "dex-vex",
    title: "DEX & VEX",
    group: "Concepts",
    blurb: "Delta and vanna exposure — the directional and volatility cousins of gamma.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          Gamma is the headline greek, but it isn&rsquo;t the only one dealers hedge. <Term>DEX</Term> (delta exposure)
          measures their <em>directional</em> pressure, and <Term>VEX / vanna</Term> measures how that hedging shifts as
          implied volatility moves. Together they tell you not just where the walls are, but which way dealers are leaning and
          how fragile that lean is.
        </Lead>

        <H2>DEX — delta exposure</H2>
        <P>
          Where GEX answers &ldquo;how hard do dealers fight a move,&rdquo; DEX answers &ldquo;which way are they already
          tilted.&rdquo; It aggregates the net delta dealers must carry across the chain — the directional inventory they&rsquo;ll
          hedge as price drifts. On the chart it&rsquo;s the <UI>Net DEX</UI> purple line; it also has its own heatmap column.
        </P>
        <Card accent={C.purple}>
          <LegendRow color={C.purple} name="Positive DEX">
            Dealers are net <Term>long delta</Term> — leaning bullish in their hedges. To stay flat they tend to sell into
            strength, which can cap upside.
          </LegendRow>
          <LegendRow color={C.purple} name="Negative DEX">
            Dealers are net <Term>short delta</Term> — leaning bearish. They tend to buy weakness to flatten, which can cushion
            downside.
          </LegendRow>
          <LegendRow color="#dcdcdc" name="DEX zero-crossing" soft>
            Where the purple line crosses zero marks the price at which dealer directional lean flips sign — a secondary
            regime line alongside the gamma flip.
          </LegendRow>
        </Card>

        <H3>Using DEX to confirm or fade a gamma read</H3>
        <Steps
          items={[
            <>Read the gamma picture first — walls, MVC, and the flip line.</>,
            <>Check whether <UI>Net DEX</UI> leans the <em>same</em> way the gamma terrain implies. Agreement = higher conviction.</>,
            <>A big gamma wall that also coincides with a strong DEX lean is a sturdier level than gamma alone.</>,
            <>When DEX leans <em>against</em> the gamma read, expect a choppier, less reliable level — the two forces are pulling apart.</>,
          ]}
        />

        <H2>VEX / vanna — volatility exposure</H2>
        <P>
          <Term>Vanna</Term> is the cross-greek between delta and volatility: it measures how a position&rsquo;s delta changes
          when implied vol moves. VEX aggregates that across the chain. The practical effect is that on days when IV is
          shifting, dealer deltas move <em>even if price doesn&rsquo;t</em> — forcing extra hedging flow that pure gamma
          models miss.
        </P>
        <Card accent={C.cyan}>
          <LegendRow color={C.posBar} name="Falling IV (vol crush)">
            Vanna flow typically adds a tailwind — as fear bleeds out, dealer hedging often supports a drift higher. This is
            the classic post-event &ldquo;vol crush melt-up.&rdquo;
          </LegendRow>
          <LegendRow color={C.heatNeg} name="Rising IV (vol spike)">
            Vanna flow turns into a headwind — climbing IV pushes dealer hedging in the selling direction, amplifying
            downside.
          </LegendRow>
        </Card>
        <P>
          On the heatmap, the <UI>GEX + VEX</UI> column blends gamma and vanna into one read. It matters most on{" "}
          <Term>high-IV or event days</Term> — CPI, FOMC, opex — when a vol move can force more re-hedging than the price move
          itself.
        </P>

        <H2>When vanna dominates</H2>
        <Card>
          <DefRow term="Event days">Around CPI / FOMC, IV swings are large — VEX can outweigh raw GEX.</DefRow>
          <DefRow term="High VIX regimes">Elevated, moving IV makes vanna flow a persistent background force.</DefRow>
          <DefRow term="Opex week">Large IV/positioning shifts into expiration amplify both DEX and VEX effects.</DefRow>
          <DefRow term="Quiet, low-IV tape">Vanna is small; gamma and DEX carry the read. Lean on GEX.</DefRow>
        </Card>

        <Card accent={C.green}>
          <LegendRow color={C.green} name="Stack the greeks">
            The strongest levels are where GEX, DEX, and VEX <em>agree</em> at the same strike. The Multi-Greek grid lays all
            four net greeks side by side precisely so you can spot that confluence at a glance.
          </LegendRow>
        </Card>
        <Card accent={C.cyan}>
          <LegendRow color={C.cyan} name="Units & caveat">
            GEX and DEX are reported in billions; CHEX and VEX in millions. All are model estimates from the options chain, not
            published figures — treat them as a map of likely dealer behavior.
          </LegendRow>
        </Card>
      </>
    ),
  },
  {
    id: "zero-dte",
    title: "0DTE vs 1DTE",
    group: "Concepts",
    blurb: "Why same-day expiration gamma behaves differently, and when to look at each.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          The expiry you pick on the chart toolbar changes the whole picture. <UI>0DTE</UI> is today&rsquo;s expiration — the
          most reactive gamma force intraday — while <UI>1DTE</UI> is the next session, showing tomorrow&rsquo;s setup
          building today. They behave very differently, and knowing which to watch (and when) is half the skill.
        </Lead>

        <H2>What changes between them</H2>
        <Card>
          <LegendRow color={C.posBar} name="0DTE — expires today">
            Gamma is at its most concentrated and sensitive. Tiny price moves force large hedging adjustments, so 0DTE walls
            pin and repel hard — but the levels also shift fast as the day&rsquo;s volume rewrites the book.
          </LegendRow>
          <LegendRow color={C.negBar} name="1DTE — expires next session">
            Gamma is more spread out and slower-moving. Less intraday whip, but it previews where the <em>next</em>{" "}
            day&rsquo;s magnets and pivots are forming, and it carries overnight positioning the 0DTE book doesn&rsquo;t.
          </LegendRow>
        </Card>

        <H2>Why 0DTE gamma accelerates into the close</H2>
        <P>
          As expiration approaches, gamma per contract <Term>spikes</Term> for strikes near the money — an option that&rsquo;s
          a coin-flip with hours left has enormous gamma. That means dealer hedging gets more violent and more localized as
          the afternoon wears on, which is why 0DTE levels tend to <Term>harden</Term> late: price gets increasingly snapped
          toward the dominant strike (often the MVC) into the final hour.
        </P>
        <Card accent={C.cyan}>
          <LegendRow color={C.cyan} name="Early-session softness">
            Early in the session the 0DTE book is still thin and shifting, so levels are softer and the time-decay ghost
            overlays may read &ldquo;no prior history yet.&rdquo; The picture sharpens as volume accumulates.
          </LegendRow>
        </Card>

        <H2>When to look at each</H2>
        <Card accent={C.orange}>
          <DefRow term="Intraday scalping">0DTE — it&rsquo;s the dominant force on same-day moves.</DefRow>
          <DefRow term="Into the close">0DTE — pinning and acceleration peak in the last hour.</DefRow>
          <DefRow term="Overnight / gap risk">1DTE — it carries the positioning that survives the bell.</DefRow>
          <DefRow term="Planning tomorrow">1DTE — preview the next session&rsquo;s walls before they go live.</DefRow>
          <DefRow term="Friday / opex">Watch both — weekly expiration concentrates gamma even further.</DefRow>
        </Card>

        <H2>Blending the two</H2>
        <Steps
          items={[
            <>Start on <UI>0DTE</UI> for the live intraday terrain — walls, MVC, flip.</>,
            <>Flip to <UI>1DTE</UI> to see whether tomorrow&rsquo;s levels line up with or pull away from today&rsquo;s.</>,
            <>When a strike is a big wall on <em>both</em> expiries, it&rsquo;s a higher-conviction level — positioning agrees across days.</>,
            <>Late in the session, lean on 0DTE for the close; before the open, lean on 1DTE for the gap and early read.</>,
          ]}
        />
        <Card accent={C.orange}>
          <LegendRow color={C.orange} name="0DTE is fast — respect it">
            The same concentration that makes 0DTE levels precise also makes losing one violent. Below the flip in negative
            0DTE gamma, moves can be abrupt — size and stops should account for the faster tape.
          </LegendRow>
        </Card>
      </>
    ),
  },

  // ── Reference ───────────────────────────────────────────────────────────────
  {
    id: "glossary",
    title: "Glossary",
    group: "Reference",
    blurb: "Quick definitions for every term and label in the app.",
    status: "complete",
    body: () => (
      <>
        <Lead>Fast definitions for the terms you&rsquo;ll meet across the dashboard.</Lead>
        <Card>
          <DefRow term="GEX">Gamma exposure — modeled dealer hedging flow from the options chain.</DefRow>
          <DefRow term="DEX">Delta exposure — directional hedging pressure.</DefRow>
          <DefRow term="VEX / Vanna">Sensitivity of hedging to changes in implied volatility.</DefRow>
          <DefRow term="Net GEX">Call gamma minus put gamma at a strike (one value).</DefRow>
          <DefRow term="Call - Put">Mode that splits each strike into separate call and put bars.</DefRow>
          <DefRow term="OI">Open interest — contracts currently outstanding.</DefRow>
          <DefRow term="Vol Only">Uses just today&rsquo;s traded volume, ignoring standing OI.</DefRow>
          <DefRow term="ATM">At-the-money — the strike nearest current price.</DefRow>
          <DefRow term="CB">Core Bullseye — the strike with the largest absolute net GEX.</DefRow>
          <DefRow term="Gamma Flip">Price where total dealer gamma crosses from negative to positive.</DefRow>
          <DefRow term="Long gamma">Dealers dampen moves (chop / pin). Positive GEX.</DefRow>
          <DefRow term="Short gamma">Dealers amplify moves (trend / vol). Negative GEX.</DefRow>
          <DefRow term="0DTE / 1DTE">Options expiring today / the next session.</DefRow>
          <DefRow term="Rolling Net GEX">Net GEX smoothed over the last 30 minutes.</DefRow>
        </Card>
      </>
    ),
  },

  // ── Pages (walkthroughs of specific dashboard pages) ─────────────────────────
  {
    id: "home-page",
    title: "Home",
    group: "Pages",
    blurb: "The main landing page: the live GEX chart, heatmap, and the key-level stat bar.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          Home is the command center — the live GEX chart and heatmap side by side, topped by a stat bar of the
          day&rsquo;s key numbers. It&rsquo;s the page you&rsquo;ll keep open all session; almost everything else in the docs
          explains a piece of what you see here.
        </Lead>
        <H2>What&rsquo;s on the page</H2>
        <Card>
          <LegendRow color={C.cyan} name="Stat bar">
            The top row surfaces the headline numbers — VIX, SPX, Net GEX, the gamma walls, and the MVC level — so you get the
            regime at a glance before reading the chart.
          </LegendRow>
          <LegendRow color={C.posBar} name="GEX chart">
            The centerpiece bar chart of net gamma by strike. See the <Term>GEX Chart</Term> guide for the full breakdown of
            bars, overlays, and the toolbar.
          </LegendRow>
          <LegendRow color={C.heatNeg} name="GEX heatmap">
            The same data as a strike-by-strike grid with five exposure columns and rank badges. Covered in the{" "}
            <Term>GEX Heatmap</Term> guide.
          </LegendRow>
        </Card>
        <Callout kind="tip" title="Chart for shape, heatmap for numbers">
          Read the chart for the terrain at a glance, then drop to the heatmap when you need the exact value at a strike.
          They&rsquo;re driven by the same live feed.
        </Callout>
      </>
    ),
  },
  {
    id: "traders-dashboard-page",
    title: "Traders Dashboard",
    group: "Pages",
    blurb: "Your morning prep page: schedule, tasks, weather, live futures, key drivers, and an AI overview.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          The Traders Dashboard is the page to open before the bell. It pulls your day together in one view — an editable
          schedule and task list, weather, live futures, the session&rsquo;s key drivers, and a fresh AI market overview each
          morning — so you start the session oriented.
        </Lead>

        <Figure maxWidth={460} caption={<>The morning layout: an editable <strong style={{ color: C.cyan }}>schedule</strong>, live <strong style={{ color: C.posBar }}>futures</strong>, the day&rsquo;s <strong style={{ color: C.orange }}>key drivers</strong>, and an auto-generated <strong style={{ color: C.green }}>AI overview</strong>.</>}>
          <TradersDashboardExample />
        </Figure>

        <H2>The panels</H2>
        <Card>
          <LegendRow color={C.cyan} name="Schedule & tasks">
            An editable daily schedule and to-do list, saved to your own preferences so they persist between sessions.
          </LegendRow>
          <LegendRow color={C.green} name="Weather">
            Your local conditions for the day, configured per user.
          </LegendRow>
          <LegendRow color={C.posBar} name="Live futures">
            Real-time index futures with the day-change measured against the prior regular-session close, not the overnight
            print.
          </LegendRow>
          <LegendRow color={C.orange} name="Key drivers">
            The day&rsquo;s scheduled economic events and catalysts pulled from the calendar.
          </LegendRow>
        </Card>
        <H2>The morning AI overview</H2>
        <P>
          Each morning an automated job writes a fresh market overview — a short, web-informed read on what&rsquo;s setting up
          for the session — so the page is already current when you arrive.
        </P>
        <Callout kind="note">
          The schedule, tasks, and weather are saved to your personal preferences, so what you set here is yours and follows
          you between sessions.
        </Callout>
      </>
    ),
  },
  {
    id: "options-chain-page",
    title: "Options Chain",
    group: "Pages",
    blurb: "The full options chain by strike — calls and puts, pricing, and the greeks behind the GEX read.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          The Options Chain page is the raw source the rest of the dashboard is built on: every strike, calls on one side and
          puts on the other, with live pricing and the per-contract data the GEX and greek models aggregate.
        </Lead>

        <Figure caption={<>Calls on the left, <strong style={{ color: C.cyan }}>strikes</strong> down the center, puts on the right. The cyan-outlined row is <strong style={{ color: C.cyan }}>ATM</strong> — the strike nearest spot that everything else is measured from.</>}>
          <OptionsChainExample />
        </Figure>

        <H2>Reading the chain</H2>
        <Card>
          <LegendRow color={C.green} name="Calls / Puts">
            Calls and puts are laid out around the at-the-money strike so you can compare the two sides at each level.
          </LegendRow>
          <LegendRow color={C.cyan} name="Strikes & ATM">
            Strikes run down the center; the cyan-outlined row nearest spot is the ATM reference. It&rsquo;s the pivot the GEX
            chart centers on and the anchor for the expected-move math.
          </LegendRow>
          <LegendRow color={C.orange} name="Expiry">
            Pick the expiration to inspect — the same 0DTE / 1DTE choice that drives the chart applies here.
          </LegendRow>
        </Card>

        <H2>Why it&rsquo;s the source of truth</H2>
        <P>
          Every gamma wall, DEX lean, and expected-move band on the dashboard is computed <em>from</em> these rows. The bid /
          mid pricing and the implied volatility behind each contract are what feed the Black-Scholes greeks that the GEX
          chart and heatmap aggregate. When a level on another page looks surprising, the chain is where you confirm it.
        </P>
        <Steps
          items={[
            <>Find the <Term>ATM</Term> row to orient — that&rsquo;s where price is.</>,
            <>Scan call vs put pricing around a strike to see which side the market is paying up for.</>,
            <>Switch <Term>expiry</Term> to compare today&rsquo;s 0DTE book against the 1DTE setup.</>,
            <>Cross-check a strike here against its bar on the GEX chart to see the positioning behind the price.</>,
          ]}
        />

        <Callout kind="tip" title="From chain to read">
          The chain is the ground truth; the GEX chart, heatmap, and greek pages are summaries of it. Drop here when you want
          to verify exactly what&rsquo;s priced at a specific strike.
        </Callout>
      </>
    ),
  },
  {
    id: "analytics-page",
    title: "Analytics",
    group: "Pages",
    blurb: "Aggregated stats and historical context for the dashboard's signals and levels.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          The Analytics page steps back from the live tape to show aggregated stats and historical context — how the
          dashboard&rsquo;s levels and signals have behaved over time, so today&rsquo;s read sits against a track record rather
          than in isolation.
        </Lead>
        <H2>What it&rsquo;s for</H2>
        <Card>
          <LegendRow color={C.cyan} name="Historical context">
            Compare the current session&rsquo;s setup against how similar setups resolved in the past.
          </LegendRow>
          <LegendRow color={C.green} name="Aggregated stats">
            Roll-ups of the signals scattered across the live pages into a few summary views.
          </LegendRow>
        </Card>
        <Callout kind="note">
          Analytics is best read alongside the live pages — it tells you how much weight a given signal has earned, not what to
          do this minute.
        </Callout>
      </>
    ),
  },
  {
    id: "es-candles-page",
    title: "ES Candles",
    group: "Pages",
    blurb: "Live 5-minute ES futures candles with a GEX heatmap overlay, key levels, and a volume profile.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          The ES Candles page is a live 5-minute candlestick chart of ES futures with the gamma picture painted right onto it
          — a GEX heatmap overlay, the call/put/flip levels mapped from SPX onto ES, and a volume-by-price profile down the
          side. It&rsquo;s where price action and dealer positioning meet on one chart.
        </Lead>

        <Figure caption={<>5-minute ES candles over a <strong style={{ color: C.posBar }}>GEX heatmap</strong>, with the <strong style={{ color: C.posBar }}>call</strong> / <strong style={{ color: C.heatNeg }}>put</strong> walls and orange <strong style={{ color: C.orange }}>flip</strong> drawn on the futures price. The <strong style={{ color: C.cyan }}>volume profile</strong> and its POC sit in the right gutter.</>}>
          <EsCandlesExample />
        </Figure>

        <H2>The layers</H2>
        <Card>
          <LegendRow color={C.posBar} name="5-minute candles">
            Live ES OHLC candles, the same feed the ICT page uses, so the tape is right where the levels are.
          </LegendRow>
          <LegendRow color={C.heatNeg} name="GEX heatmap overlay">
            Each 5-minute slot paints a column of gamma-by-strike behind the candles — you watch walls build and bleed in real
            time. Toggle between OI+Vol and Vol-only.
          </LegendRow>
          <LegendRow color={C.orange} name="Call / Put / Flip levels">
            The key gamma levels drawn as horizontal lines, converted from SPX to the ES basis so they line up with the
            futures price.
          </LegendRow>
          <LegendRow color={C.cyan} name="Volume profile">
            A volume-by-price histogram with value-area levels, derived from the candle volume.
          </LegendRow>
        </Card>

        <H2>Reading the volume profile</H2>
        <P>
          The right-gutter histogram spreads each candle&rsquo;s volume across the price range it touched, building a session
          map of where trade actually happened:
        </P>
        <Card>
          <DefRow term="POC">Point of control — the single most-traded price. Acts as a magnet / fair-value pivot.</DefRow>
          <DefRow term="VAH / VAL">Value-area high and low — the band holding ~70% of the session&rsquo;s volume.</DefRow>
          <DefRow term="LVN">Low-volume node — a thin price level inside the range that price tends to move through quickly.</DefRow>
        </Card>
        <Callout kind="note">
          When the <Term>POC</Term> or a value-area edge lines up with a gamma <Term>wall</Term>, that confluence is a
          stronger level than either the profile or the gamma read alone.
        </Callout>

        <H2>Reading it in practice</H2>
        <Steps
          items={[
            <>Note where price sits between the <Term>call wall</Term> and <Term>put wall</Term> — those bracket the expected range.</>,
            <>Watch the heatmap columns: a wall <em>brightening</em> over recent slots is positioning being added at that strike.</>,
            <>Use the <Term>flip</Term> line as the regime divider — above it expect chop, below it expect faster moves.</>,
            <>Lean on the <Term>POC</Term> and value area for where price is likely to balance when it&rsquo;s between walls.</>,
          ]}
        />

        <Callout kind="tip" title="Levels you can trade against">
          Because the gamma walls are drawn on the actual futures price, this is the cleanest place to see price reacting to a
          level as it happens, rather than translating SPX levels in your head.
        </Callout>
      </>
    ),
  },
  {
    id: "ict-page",
    title: "ICT",
    group: "Pages",
    blurb: "Live ICT concept detection on the 5-minute ES feed, plus a glossary of every concept.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          The ICT page runs Inner Circle Trader concepts live over the 5-minute ES feed and lists what it finds beside a
          glossary of every concept. If you trade ICT, it&rsquo;s an automated second set of eyes; if you&rsquo;re learning it,
          the live reads sit right next to their definitions.
        </Lead>

        <Figure caption={<>The detector marks structure as it forms: a <strong style={{ color: C.cyan }}>Fair Value Gap</strong>, the <strong style={{ color: C.green }}>order block</strong> and swept <strong style={{ color: C.green }}>BSL</strong> liquidity, and a <strong style={{ color: C.orange }}>CHOCH</strong> when character changes.</>}>
          <IctExample />
        </Figure>

        <H2>Live detection</H2>
        <P>
          A candlestick chart is overlaid with the ICT primitives the page computes in real time — so the structure is marked
          on the chart as it forms, and a side panel lists the current reads.
        </P>
        <Card>
          <LegendRow color={C.cyan} name="Fair Value Gaps & Order Blocks">
            Three-candle imbalances and the last opposing candle before an impulse — the re-entry / defense zones price tends
            to return to.
          </LegendRow>
          <LegendRow color={C.green} name="Liquidity pools (BSL / SSL)">
            Resting liquidity above highs and below lows that price often sweeps before reversing.
          </LegendRow>
          <LegendRow color={C.orange} name="Structure events (BOS / CHOCH / MSS)">
            Breaks of structure, changes of character, and market-structure shifts that flag continuation vs reversal.
          </LegendRow>
          <LegendRow color={C.purple} name="Kill zones & premium/discount">
            Session kill zones, Silver Bullet / macro windows, and the premium/discount + OTE dealing range.
          </LegendRow>
        </Card>

        <H2>How the pieces fit a setup</H2>
        <P>
          The concepts aren&rsquo;t independent signals — they chain into a sequence. A textbook ICT setup reads in order:
        </P>
        <Steps
          items={[
            <>Price sweeps a <Term>liquidity pool</Term> (BSL / SSL) — stops are taken above a high or below a low.</>,
            <>A <Term>displacement</Term> leg leaves a <Term>Fair Value Gap</Term> and breaks structure (<Term>CHOCH / MSS</Term>).</>,
            <>Price retraces into the <Term>order block</Term> or FVG within the <Term>OTE</Term> (62–79%) band.</>,
            <>The real move delivers toward the opposing liquidity — ideally inside a <Term>kill zone</Term>.</>,
          ]}
        />

        <H2>The glossary</H2>
        <P>
          Every concept the page detects is defined alongside the live signals, so a read you don&rsquo;t recognize is one
          click from its explanation.
        </P>
        <Callout kind="warn" title="A tool, not a trigger">
          The page marks where ICT structure exists — it doesn&rsquo;t place trades. Use the live reads to frame your own
          entries within your plan.
        </Callout>
      </>
    ),
  },
  {
    id: "journal-page",
    title: "Journal",
    group: "Pages",
    blurb: "Log your trades and review them over time to find what's working.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          The Journal is where you record your trades and review them. Logging entries, exits, and notes turns a string of
          individual trades into a record you can actually learn from.
        </Lead>
        <H2>Using it</H2>
        <Card>
          <LegendRow color={C.cyan} name="Log trades">
            Capture each trade as you take it — the setup, the levels, and how it resolved.
          </LegendRow>
          <LegendRow color={C.green} name="Review over time">
            Look back across entries to see which setups and levels are carrying your results.
          </LegendRow>
        </Card>
        <Callout kind="tip" title="Tie it back to the levels">
          Note which GEX levels or ICT reads were in play on each trade — over time the journal shows you which of the
          dashboard&rsquo;s signals you actually trade well.
        </Callout>
      </>
    ),
  },
  {
    id: "feedback-page",
    title: "Feedback",
    group: "Pages",
    blurb: "Send suggestions, bug reports, and requests straight to the team.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          The Feedback page is the direct line to the team — suggestions, bug reports, and feature requests all go here. If
          something&rsquo;s off or missing, this is the fastest way to flag it.
        </Lead>
        <H2>What to send</H2>
        <Card>
          <LegendRow color={C.cyan} name="Suggestions & requests">
            Ideas for new features or changes to existing ones.
          </LegendRow>
          <LegendRow color={C.orange} name="Bug reports">
            Anything that looks wrong or broken — the more specific (page, time, what you saw), the faster it gets fixed.
          </LegendRow>
        </Card>
        <Callout kind="note">
          Concrete details — which page, what you expected, what happened — make a report far easier to act on.
        </Callout>
      </>
    ),
  },
  {
    id: "greeks-page",
    title: "Greeks Dashboard",
    group: "Pages",
    blurb: "One card each for GEX, DEX, CHEX and VEX, with live value + session graph.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          The Greeks page is a grid of cards — one per aggregate dealer greek. Each card shows the current value, whether
          it&rsquo;s positive or negative, and a small graph of how it has moved across the session, so you can see
          positioning build, drain, and flip in real time.
        </Lead>

        <Figure maxWidth={460} caption={<>One card per greek, each in its own accent color: <strong style={{ color: "#22d3ee" }}>GEX</strong>, <strong style={{ color: "#a78bfa" }}>DEX</strong>, <strong style={{ color: "#2dd4bf" }}>CHEX</strong>, <strong style={{ color: "#e879f9" }}>VEX</strong>. A green/red badge marks the sign; the mini graph is its session history.</>}>
          <GreeksPageExample />
        </Figure>

        <H2>The four cards</H2>
        <Card>
          <LegendRow color="#22d3ee" name="GEX — gamma">
            Aggregate gamma exposure. Rising into positive territory = a more dampened, pin-prone tape; sliding negative =
            more volatile and trendy.
          </LegendRow>
          <LegendRow color="#a78bfa" name="DEX — delta">
            Directional hedging pressure. Persistent lean one way hints at which direction dealers are leaning their hedges.
          </LegendRow>
          <LegendRow color="#2dd4bf" name="CHEX — charm">
            Delta&rsquo;s decay through time (charm). Matters most into the afternoon as 0DTE contracts bleed delta toward
            expiry.
          </LegendRow>
          <LegendRow color="#e879f9" name="VEX — vanna">
            Sensitivity of hedging to IV. Becomes important on days when implied vol is moving meaningfully.
          </LegendRow>
        </Card>
        <Callout kind="tip" title="Read the trend, not the tick">
          Each card&rsquo;s graph matters more than its instantaneous number — a steady drift of GEX from negative to
          positive through the morning is a regime shift, even if any single reading looks noisy.
        </Callout>
        <Callout kind="note">
          GEX/DEX are shown in billions, CHEX/VEX in millions. See <Term>DEX &amp; VEX</Term> in Concepts for the underlying
          definitions.
        </Callout>
      </>
    ),
  },
  {
    id: "multi-greek-page",
    title: "Multi-Greek Grid",
    group: "Pages",
    blurb: "Four exposure columns per strike — GEX, DEX, CHEX, VEX side by side.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          The Multi-Greek page is a strike-by-strike grid that shows all four net greeks at once, so you can see not just
          where gamma sits but whether delta, charm and vanna agree at the same levels.
        </Lead>

        <Figure caption={<>A strike grid with the four net greeks as columns. Blue = positive, red = negative, brighter = bigger; the <strong style={{ color: "#ffb300" }}>ATM</strong> row is gold-outlined and the top row totals each column. Look for strikes that light up across multiple columns.</>}>
          <MultiGreekExample />
        </Figure>

        <H2>How to use it</H2>
        <Steps
          items={[
            <>Start with the <UI>NET GEX</UI> column to find the gamma walls, exactly as on the heatmap.</>,
            <>Scan across to <UI>NET DEX</UI>: a strike that&rsquo;s a big gamma wall <em>and</em> a big delta level is a
              higher-conviction pivot.</>,
            <>Check <UI>NET CHEX</UI> in the afternoon — charm concentration shows where 0DTE decay is pulling delta.</>,
            <>Use <UI>NET VEX</UI> on high-IV days to spot where a vol move would force the most re-hedging.</>,
          ]}
        />
        <Callout kind="tip" title="Agreement is the signal">
          One column lighting up is a level; several columns lighting up at the same strike is a level worth respecting.
        </Callout>
      </>
    ),
  },
  {
    id: "estimated-moves-page",
    title: "Estimated Moves",
    group: "Pages",
    blurb: "The market's own expected move — ±1σ / ±2σ bands from option pricing.",
    status: "complete",
    body: () => (
      <>
        <Lead>
          The Estimated Moves page reads the market&rsquo;s <Term>implied</Term> expected move straight from option prices —
          how far the underlying is priced to travel by a given expiration — and turns it into concrete upper and lower
          levels.
        </Lead>

        <Figure caption={<>One row per ticker: the <strong style={{ color: "#e8c060" }}>EM</strong> column is the expected move for the week, and <strong style={{ color: "#00e676" }}>Up</strong> / <strong style={{ color: "#ff4757" }}>Down</strong> are the resulting upper and lower price levels around the close.</>}>
          <EstimatedMovesTableExample />
        </Figure>

        <H2>Reading the columns</H2>
        <Card>
          <DefRow term="Ticker">The symbol (SPX, SPY, QQQ, NDX, …).</DefRow>
          <DefRow term="Close">The reference close the move is measured from.</DefRow>
          <DefRow term="Exp">The expiration the move is priced to (usually the Friday weekly).</DefRow>
          <DefRow term="EM">The <Term>expected move</Term> — a ± dollar amount derived from option pricing.</DefRow>
          <DefRow term="Up / Down">Close ± EM: the upper and lower expected-move boundaries for the period.</DefRow>
        </Card>
        <H2>Where the number comes from</H2>
        <P>
          For each ticker the page prices the <Term>at-the-money straddle</Term> (and the chain&rsquo;s implied volatility)
          for the target expiration and converts it into a one-standard-deviation move — roughly a <Term>68%</Term> chance
          price finishes inside the Up/Down band by expiry. Those levels often act as magnets or boundaries for the week.
        </P>
        <Callout kind="note" title="Backed by ~2 years of history">
          The page is backed by roughly <Term>two years</Term> of historical estimated-move data, so each week&rsquo;s
          expected move can be compared against how prior weeks actually played out.
        </Callout>
        <Callout kind="tip" title="Pair it with gamma">
          When the Up or Down level lines up with a big gamma wall from the GEX chart, that confluence tends to be a
          stronger level than either reading alone.
        </Callout>
        <Callout kind="warn" title="It's a probability, not a ceiling">
          The expected move describes the <em>distribution</em> the market is pricing — price can and does close outside the
          band. Use it to size expectations, not as a hard barrier.
        </Callout>
      </>
    ),
  },
];

const GROUP_ORDER = ["Getting Started", "Core Tools", "Pages", "Concepts", "Reference"];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [activeId, setActiveId] = useState<string>("overview");
  const [query, setQuery] = useState("");

  const active = ARTICLES.find((a) => a.id === activeId) ?? ARTICLES[0];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ARTICLES;
    return ARTICLES.filter((a) => `${a.title} ${a.blurb} ${a.group}`.toLowerCase().includes(q));
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Article[]>();
    for (const a of filtered) {
      if (!map.has(a.group)) map.set(a.group, []);
      map.get(a.group)!.push(a);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => [g, map.get(g)!] as const);
  }, [filtered]);

  return (
    <div
      style={{
        ...homeShellStyle,
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 22px",
          background: HOME_THEME.panelBgStrong,
          backdropFilter: "blur(16px)",
          borderBottom: `1px solid ${HOME_THEME.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 10, color: HOME_THEME.cyan, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 800 }}>
            Knowledge Base
          </span>
          <span style={{ fontSize: 19, fontWeight: 800, lineHeight: 1 }}>Help &amp; Docs</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs…"
            style={{
              fontSize: 13,
              padding: "7px 12px",
              width: 220,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              background: "rgba(0,0,0,0.4)",
              color: C.text,
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* ── Body: rail + content ── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Article rail */}
        <nav
          style={{
            width: 268,
            flexShrink: 0,
            borderRight: `1px solid ${C.border}`,
            background: "rgba(13,17,25,0.35)",
            overflowY: "auto",
            padding: "14px 12px 24px",
          }}
        >
          {grouped.length === 0 && (
            <div style={{ fontSize: 12, color: C.muted, padding: "10px 8px" }}>No matching articles.</div>
          )}
          {grouped.map(([group, items]) => (
            <div key={group} style={{ marginBottom: 18 }}>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: C.muted,
                  padding: "0 8px 6px",
                }}
              >
                {group}
              </div>
              {items.map((a) => {
                const on = a.id === active.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => setActiveId(a.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 10px",
                      marginBottom: 2,
                      borderRadius: 8,
                      border: "1px solid transparent",
                      cursor: "pointer",
                      background: on ? "rgba(33,158,188,0.12)" : "transparent",
                      borderColor: on ? "rgba(33,158,188,0.3)" : "transparent",
                      color: on ? C.cyan : "#c3d0e0",
                      fontSize: 13.5,
                      fontWeight: on ? 700 : 500,
                      transition: "background 0.12s, color 0.12s",
                    }}
                  >
                    <span style={{ flex: 1 }}>{a.title}</span>
                    {a.status === "draft" && (
                      <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 4px" }}>
                        WIP
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Content pane */}
        <article
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "26px clamp(22px, 4vw, 60px) 80px",
            minWidth: 0,
          }}
        >
          <div style={{ maxWidth: 820, margin: "0 auto" }}>
            <div style={{ fontSize: 10.5, color: C.muted, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 800, marginBottom: 6 }}>
              {active.group}
            </div>
            <h1 style={{ fontSize: 30, lineHeight: 1.1, margin: "0 0 18px", fontWeight: 800 }}>{active.title}</h1>
            {active.body()}
          </div>
        </article>
      </div>
    </div>
  );
}
