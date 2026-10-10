"use client";

// Shared cursor-anchored hover card — the same floating stats card the
// options-chain matrix pops on hover. Used by the options-chain, the multi-greek
// panels, and the home GEX heatmap so all three read identically.
//
// Portals to <body> so it escapes any panel's overflow/clip. Pure — no repo
// imports beyond react/react-dom — so any page can drop it in.

import { createPortal } from "react-dom";

export interface HoverSide {
  vol: number;
  oi: number;
  /** Net premium traded = mark × volume × 100. */
  prem: number;
}

export interface StrikeHoverCardProps {
  ticker: string;
  strike: number;
  expiration?: string | null;
  calls: HoverSide;
  puts: HoverSide;
  /** Cursor position (px, viewport-relative). */
  x: number;
  y: number;
}

function fmtUsd(n: number): string {
  const a = Math.abs(n || 0);
  const s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}
function fmtInt(n: number): string {
  return Math.round(n || 0).toLocaleString();
}
function fmtExp(exp?: string | null): string {
  if (!exp) return "";
  const d = new Date(exp + "T12:00:00");
  if (Number.isNaN(d.getTime())) return exp;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, lineHeight: 1.6 }}>
      <span style={{ color: "#8B94A7" }}>{k}</span>
      <span style={{ color: strong ? "#fff" : "#cfe", fontWeight: strong ? 800 : 600 }}>{v}</span>
    </div>
  );
}

function SideBlock({ label, color, side }: { label: string; color: string; side: HoverSide }) {
  return (
    <div style={{ background: rgba(color, 0.06), border: `1px solid ${rgba(color, 0.28)}`, borderRadius: 8, padding: "7px 9px" }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", color, marginBottom: 5 }}>{label}</div>
      <Row k="Volume" v={fmtInt(side.vol)} />
      <Row k="OI" v={fmtInt(side.oi)} />
      <Row k="Net Prem" v={fmtUsd(side.prem)} strong />
    </div>
  );
}

export default function StrikeHoverCard({ ticker, strike, expiration, calls, puts, x, y }: StrikeHoverCardProps) {
  if (typeof document === "undefined") return null;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.min(Math.max(8, x + 16), vw - 262);
  const top = Math.min(Math.max(8, y + 16), vh - 232);
  const netPrem = (calls.prem || 0) - (puts.prem || 0);

  return createPortal(
    <div style={{
      position: "fixed", left, top, zIndex: 1000, width: 246, pointerEvents: "none",
      background: "rgba(13,17,25,0.96)", border: "1px solid rgba(33,158,188,0.30)", borderRadius: 12,
      padding: 13, boxShadow: "0 12px 40px rgba(0,0,0,0.6)", backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)", fontFamily: "var(--font-mono)", color: "#fff",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 15, fontWeight: 800 }}>{ticker} {strike.toLocaleString()}</span>
        {expiration && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "#8B94A7" }}>{fmtExp(expiration)}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <SideBlock label="CALLS" color="#29b6f6" side={calls} />
        <SideBlock label="PUTS" color="#ff4757" side={puts} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 9, paddingTop: 7, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 12 }}>
        <span style={{ color: "#8B94A7" }}>Net Prem (C−P)</span>
        <span style={{ fontWeight: 800, color: netPrem >= 0 ? "#29b6f6" : "#ff4757" }}>{fmtUsd(netPrem)}</span>
      </div>
    </div>,
    document.body,
  );
}
