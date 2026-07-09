"use client";

// /new-home — UI-only mock of the redesigned homepage layout (no data wiring).
// Styled to the /gex2 · /budget "dissolve card" visual language (see
// md files/BUDGET_UI_STYLE.md): one accent only (LIGHT_BLUE), no top-bar
// strips, borderless feathered cards. GlobalToolbar already renders above
// this page via LayoutShell (the "TOP UNIVERSAL TOOLBAR" from the sketch);
// this page's own pill row sits just below it and owns the new ticker/tab
// switchers + FAB.

import type { CSSProperties, ReactNode } from "react";
import { PageShell } from "@/components/shared/PageCard";
import { HOME_THEME, LIGHT_BLUE, dissolveCardStyle, statTileStyle } from "@/components/shared/homeTheme";
import EsCandlesCard from "@/components/dashboard/EsCandlesCard";

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

const labelCap: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: rgba(HOME_THEME.text, 0.75),
};

// ── shared dissolve card (single accent, no top bar) ────────────────────────
function DCard({
  title,
  style,
  className,
  children,
}: {
  title?: string;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className} style={{ ...dissolveCardStyle, padding: 20, ...style }}>
      {title && <div style={{ ...labelCap, marginBottom: 14 }}>{title}</div>}
      {children}
    </div>
  );
}

// ── static placeholder data (UI only) ───────────────────────────────────────
const STAT_CARDS = ["SPX", "GEX", "DEX", "FLIP", "IV"];
const GAUGES = ["GEX", "DEX", "CHEX", "VEX"];

// Option chain placeholder shape — mirrors the real /options-chain matrix:
// one strike column + N expiry columns (each expiry showing GEX only, like
// the carded matrix view). Real page defaults to 14 expirations; the
// new-home panel is capped smaller since it's a secondary summary view.
const CHAIN_EXPIRY_COUNT = 5;
const CHAIN_EXPIRY_LABELS = Array.from({ length: CHAIN_EXPIRY_COUNT }, (_, i) => `EXP ${i + 1}`);
const CHAIN_STRIKE_ROWS = 9;

// ── pill top row: new ticker switcher (left) + new tab switcher/FAB (right) ─
function NewHomeTopPill() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        borderRadius: 999,
        border: "none",
        background: `radial-gradient(circle at 50% 0%, ${rgba(LIGHT_BLUE, 0.08)} 0%, transparent 60%), rgba(13,17,25,0.35)`,
        backdropFilter: "blur(24px)",
        padding: "10px 18px",
        flexShrink: 0,
      }}
    >
      {/* New ticker switcher */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, letterSpacing: "0.08em" }}>
        <span
          style={{
            padding: "4px 12px",
            borderRadius: 999,
            border: `1px solid ${rgba(LIGHT_BLUE, 0.35)}`,
            background: rgba(LIGHT_BLUE, 0.12),
            color: LIGHT_BLUE,
          }}
        >
          SPX
        </span>
        <span style={{ opacity: 0.4, fontSize: 11 }}>▾ ticker switcher</span>
      </div>

      <div style={{ fontSize: 10, letterSpacing: "0.16em", color: "#5c6b7a", textTransform: "uppercase" }}>
        new-home
      </div>

      {/* New tab switcher + floating FAB menu */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", borderRadius: 999, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
          {["Overview", "Chain", "Flow"].map((tab, i) => (
            <span
              key={tab}
              style={{
                padding: "5px 12px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                color: i === 0 ? LIGHT_BLUE : "#8a99a8",
                background: i === 0 ? rgba(LIGHT_BLUE, 0.14) : "transparent",
              }}
            >
              {tab}
            </span>
          ))}
        </div>
        <div
          title="Floating FAB menu"
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: `1px solid ${rgba(LIGHT_BLUE, 0.4)}`,
            background: `linear-gradient(180deg, ${rgba(LIGHT_BLUE, 0.20)}, ${rgba(LIGHT_BLUE, 0.06)})`,
            color: LIGHT_BLUE,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          +
        </div>
      </div>
    </div>
  );
}

// ── stat cards row (left column, top) — statTileStyle, no border ───────────
function StatCardsRow() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAT_CARDS.length}, minmax(0,1fr))`, gap: 8 }}>
      {STAT_CARDS.map((label) => (
        <div
          key={label}
          style={{
            ...statTileStyle,
            padding: "12px 8px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 5,
          }}
        >
          <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#8a99a8", textTransform: "uppercase" }}>{label}</div>
          <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "var(--font-mono, monospace)" }}>--</div>
        </div>
      ))}
    </div>
  );
}

// ── option chain placeholder (left column, main) ────────────────────────────
// Static shape only — strike column + CHAIN_EXPIRY_COUNT expiry columns, each
// row a placeholder strike. No fetch, no state; wire to /options-chain's
// matrix (capped to this column count) once the layout is approved.
function OptionChainPlaceholder() {
  return (
    <DCard title="Option chain" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `56px repeat(${CHAIN_EXPIRY_COUNT}, minmax(0,1fr))`,
          fontSize: 10,
          letterSpacing: "0.06em",
          color: "#8a99a8",
          textTransform: "uppercase",
          borderBottom: `1px solid ${HOME_THEME.border}`,
          paddingBottom: 8,
          marginBottom: 6,
        }}
      >
        <div />
        {CHAIN_EXPIRY_LABELS.map((label) => (
          <div key={label} style={{ textAlign: "center" }}>{label}</div>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, overflow: "hidden" }}>
        {Array.from({ length: CHAIN_STRIKE_ROWS }).map((_, r) => {
          const isAtm = r === Math.floor(CHAIN_STRIKE_ROWS / 2);
          return (
            <div
              key={r}
              style={{
                display: "grid",
                gridTemplateColumns: `56px repeat(${CHAIN_EXPIRY_COUNT}, minmax(0,1fr))`,
                alignItems: "center",
                borderRadius: 6,
                background: isAtm ? rgba(LIGHT_BLUE, 0.08) : "transparent",
                padding: "4px 0",
              }}
            >
              <div style={{ fontSize: 10, textAlign: "center", color: isAtm ? LIGHT_BLUE : "#8a99a8", fontFamily: "var(--font-mono, monospace)" }}>
                {isAtm ? "ATM" : "----"}
              </div>
              {CHAIN_EXPIRY_LABELS.map((label) => (
                <div key={label} style={{ textAlign: "center", fontSize: 10, color: "#5c6b7a", fontFamily: "var(--font-mono, monospace)" }}>
                  --
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </DCard>
  );
}

// ── static greeks gauge (visual only, no live value) — compact size ────────
function StaticGauge({ label }: { label: string }) {
  const cx = 44, cy = 46, r = 32;
  const pt = (deg: number) => ({
    x: cx + r * Math.sin((deg * Math.PI) / 180),
    y: cy - r * Math.cos((deg * Math.PI) / 180),
  });
  const arc = (d0: number, d1: number) => {
    const a = pt(d0), b = pt(d1);
    const large = Math.abs(d1 - d0) > 180 ? 1 : 0;
    const sweep = d1 > d0 ? 1 : 0;
    return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  };
  return (
    <div
      className="card-hover"
      style={{
        ...statTileStyle,
        padding: "8px 4px 6px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <svg viewBox="0 0 88 72" width="100%" style={{ display: "block", maxWidth: 84 }}>
        <path d={arc(-135, 0)} fill="none" stroke="#2a1a20" strokeWidth={6} strokeLinecap="round" />
        <path d={arc(0, 135)} fill="none" stroke="#15242b" strokeWidth={6} strokeLinecap="round" />
        <line x1={cx} y1={cy - r - 6} x2={cx} y2={cy - r + 1} stroke="#fff" strokeWidth={1.2} />
        <circle cx={cx} cy={cy - r} r={1.8} fill="#fff" />
        <text x={cx} y={cy + 1} textAnchor="middle" fontSize={13} fontWeight={800} fill="#fff" fontFamily="monospace">
          --
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize={7.5} letterSpacing="1.5" fill="#9fb3c8">
          {label}
        </text>
      </svg>
    </div>
  );
}

function GreeksGaugesPanel() {
  return (
    <DCard title="Greeks gauges">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 6 }}>
        {GAUGES.map((label) => (
          <StaticGauge key={label} label={label} />
        ))}
      </div>
    </DCard>
  );
}

function StatsPlaceholderPanel() {
  const rows = ["Net prem", "Call vol", "Put vol", "OI total"];
  return (
    <DCard title="Stats">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <div key={r} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: "#8a99a8" }}>{r}</span>
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}>--</span>
          </div>
        ))}
      </div>
    </DCard>
  );
}

function EsCandlesPanel() {
  return (
    <DCard title="ES candles" style={{ flex: 1, minHeight: 240, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <EsCandlesCard />
      </div>
    </DCard>
  );
}

export default function NewHomePage() {
  return (
    <PageShell>
      <NewHomeTopPill />
      <div style={{ display: "grid", gridTemplateColumns: "1.65fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
        {/* left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          <StatCardsRow />
          <OptionChainPlaceholder />
        </div>

        {/* right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          <GreeksGaugesPanel />
          <StatsPlaceholderPanel />
          <EsCandlesPanel />
        </div>
      </div>
    </PageShell>
  );
}
