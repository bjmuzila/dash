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

// ─── Palette (mirrors the values used by the GEX components) ──────────────────
const C = {
  bg: "#05060A",
  panel: "rgba(13,17,25,0.45)",
  panelStrong: "rgba(13,17,25,0.72)",
  cyan: "#00F0FF",
  posBar: "#29b6f6", // +GEX / Call bars + heatmap positive cells
  negBar: "#ffb300", // −GEX / Put bars (chart)
  heatNeg: "#ff4757", // heatmap negative cells (red)
  purple: "#8B5CF6", // DEX line
  orange: "#F97316", // GEX flip line + curve
  green: "#10B981", // call OI overlay
  red: "#EF4444", // put OI overlay
  muted: "#8B94A7",
  text: "#FFFFFF",
  border: "rgba(255,255,255,0.10)",
  borderSoft: "rgba(0,229,255,0.16)",
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
        background: "rgba(0,240,255,0.08)",
        border: "1px solid rgba(0,240,255,0.18)",
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
  const map: Record<CalloutKind, { c: string; bg: string; label: string }> = {
    tip: { c: C.green, bg: "rgba(16,185,129,0.08)", label: title ?? "Tip" },
    note: { c: C.cyan, bg: "rgba(0,240,255,0.06)", label: title ?? "Note" },
    warn: { c: C.orange, bg: "rgba(249,115,22,0.08)", label: title ?? "Heads up" },
  };
  const m = map[kind];
  return (
    <div style={{ margin: "14px 0", borderLeft: `3px solid ${m.c}`, background: m.bg, borderRadius: 8, padding: "11px 14px" }}>
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
              background: "rgba(0,240,255,0.12)",
              border: "1px solid rgba(0,240,255,0.4)",
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

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "rgba(0,0,0,0.25)", border: `1px solid ${C.border}`, borderRadius: 12, padding: "4px 16px", margin: "10px 0" }}>
      {children}
    </div>
  );
}

function Stub({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 18,
        padding: "14px 16px",
        borderRadius: 10,
        border: `1px dashed ${C.border}`,
        background: "rgba(255,255,255,0.02)",
        fontSize: 12.5,
        color: C.muted,
        lineHeight: 1.6,
      }}
    >
      <span style={{ color: C.cyan, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: 10.5 }}>Draft</span>
      <span style={{ marginLeft: 8 }}>{children}</span>
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
          background: "linear-gradient(180deg, rgba(13,17,25,0.72) 0%, rgba(5,6,10,0.72) 100%)",
          border: `1px solid ${C.borderSoft}`,
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
        <rect x={padL + mvcIdx * bw - 6} y={padT - 4} width="48" height="15" rx="3" fill="rgba(0,240,255,0.14)" stroke={C.cyan} strokeWidth="0.8" />
        <text x={padL + mvcIdx * bw + 18} y={padT + 6.5} textAnchor="middle" fontSize="8.5" fontWeight="800" fill={C.cyan}>MVC</text>
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
              fill={r.atm ? "rgba(0,240,255,0.10)" : "transparent"}
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
      <div style={{ display: "grid", gridTemplateColumns: grid, background: "rgba(0,240,255,0.03)", borderBottom: `1px solid ${C.border}` }}>
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
      <div style={{ background: "rgba(0,240,255,0.04)", borderBottom: `1px solid ${C.border}`, padding: "7px 10px", textAlign: "center" }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#eef7ff", letterSpacing: ".16em", textTransform: "uppercase" }}>
          Weekly Estimated Move For <span style={{ color: "#00e5ff" }}>Fri 6/27</span>
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Consolas, Monaco, monospace" }}>
        <thead>
          <tr style={{ background: "rgba(13,17,25,0.9)", color: "#00e5ff", textAlign: "center" }}>
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
        <Lead>
          This is the CB Edge knowledge base — short, practical guides to reading the dashboard and turning what you see
          into decisions. Start with the two flagship tools below; the concept pages explain the &ldquo;why&rdquo; behind them.
        </Lead>
        <H2>Where to begin</H2>
        <Steps
          items={[
            <>New to gamma exposure? Read <Term>What is GEX?</Term> first — it&rsquo;s the foundation for everything else.</>,
            <>Then work through the <Term>GEX Chart</Term> guide — the main visual on the home page.</>,
            <>Pair it with the <Term>GEX Heatmap</Term> guide — the same data as a strike-by-strike grid.</>,
            <>Keep the <Term>Glossary</Term> open in another tab the first few sessions.</>,
          ]}
        />
        <Callout kind="note" title="How to read these guides">
          Anything shown like <UI>Net GEX</UI> is a button or label you&rsquo;ll find on screen. Color chips like{" "}
          <Swatch color={C.posBar} /> match the exact colors used in the app.
        </Callout>
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

        <Figure caption={<>Blue bars = positive gamma (above the zero line), gold = negative (below). The <strong style={{ color: C.text }}>MVC</strong> tag marks the biggest wall, the dashed white line is live <strong style={{ color: C.text }}>SPX</strong>, and the orange <strong style={{ color: C.orange }}>FLIP</strong> line is where gamma crosses zero.</>}>
          <GexChartExample />
        </Figure>

        <H2>What you&rsquo;re looking at</H2>
        <P>
          The horizontal axis is <Term>strike price</Term> (labelled every 50 points), centered on the at-the-money strike.
          The vertical axis is <Term>gamma exposure (GEX)</Term> — bars go <em>up</em> for positive gamma and <em>down</em>{" "}
          for negative gamma, measured from the center zero line.
        </P>
        <Card>
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
        <Card>
          <LegendRow color={C.text} name="MVC tag">
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
        <Card>
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
            <>Find the <Term>MVC</Term> tag — that&rsquo;s the dominant level for the day.</>,
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
    title: "MVC — Most Valuable Contract",
    group: "Concepts",
    blurb: "The single biggest gamma strike, and how it's used across the app.",
    status: "draft",
    body: () => (
      <>
        <Lead>
          The MVC is the strike carrying the largest absolute net GEX — the dominant gamma wall. It&rsquo;s tagged on the
          chart and feeds the top bar, snapshots, and the Confidence score.
        </Lead>
        <P>
          Because it&rsquo;s the heaviest concentration of dealer gamma, the MVC tends to act as the day&rsquo;s primary
          magnet (in positive gamma) or breakdown pivot (in negative gamma).
        </P>
        <Stub>
          Expand with: how MVC is selected across the full chain, how it relates to the Confidence score&rsquo;s Hit / Pivot
          / Chop outcomes, and what it means when the MVC shifts strikes mid-session.
        </Stub>
      </>
    ),
  },
  {
    id: "dex-vex",
    title: "DEX & VEX",
    group: "Concepts",
    blurb: "Delta and vanna exposure — the directional and volatility cousins of gamma.",
    status: "draft",
    body: () => (
      <>
        <Lead>
          Gamma isn&rsquo;t the only greek dealers hedge. <Term>DEX</Term> (delta exposure) captures directional pressure;{" "}
          <Term>VEX/vanna</Term> captures how hedging shifts as implied volatility changes.
        </Lead>
        <P>
          DEX appears as the purple line on the chart and its own heatmap column. GEX + VEX is the combined column that
          matters most on days when IV is moving meaningfully.
        </P>
        <Stub>Expand with: sign conventions, how DEX lean confirms or fades a gamma read, and when vanna dominates.</Stub>
      </>
    ),
  },
  {
    id: "zero-dte",
    title: "0DTE vs 1DTE",
    group: "Concepts",
    blurb: "Why same-day expiration gamma behaves differently, and when to look at each.",
    status: "draft",
    body: () => (
      <>
        <Lead>
          The expiry you select changes the whole picture. 0DTE gamma is the most reactive force intraday; 1DTE shows the
          next session&rsquo;s setup.
        </Lead>
        <Stub>
          Expand with: gamma&rsquo;s acceleration into the close on 0DTE, why levels &ldquo;harden&rdquo; late in the day,
          and how to blend the two expiries.
        </Stub>
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
          <DefRow term="MVC">Most Valuable Contract — the strike with the largest absolute net GEX.</DefRow>
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
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        background: C.bg,
        backgroundImage:
          "radial-gradient(circle at 15% 50%, rgba(0,240,255,0.02) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(139,92,246,0.03) 0%, transparent 50%)",
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
        color: C.text,
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
          background: C.panel,
          backdropFilter: "blur(16px)",
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 10, color: C.muted, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 800 }}>
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
                      background: on ? "rgba(0,240,255,0.12)" : "transparent",
                      borderColor: on ? "rgba(0,240,255,0.3)" : "transparent",
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
