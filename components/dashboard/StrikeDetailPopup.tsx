"use client";

import { useEffect, type CSSProperties } from "react";
import { type ChainRow } from "@/lib/calculations/calculations";
import type { GexBaselines } from "@/hooks/useStrikeGexHistory";

export type PopupStyle = "card" | "drawer" | "modal";

interface Props {
  row: ChainRow;
  spotPrice: number;
  baselines: GexBaselines;
  popupStyle: PopupStyle;
  /** Anchor point (px, relative to viewport) for the floating-card style. */
  anchor?: { x: number; y: number } | null;
  onClose: () => void;
}

// ─── Formatting ──────────────────────────────────────────────────────────────
function fmtGex(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = v >= 0 ? (signed ? "+" : "") : "-";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(2)}K`;
  return `${s}$${a.toFixed(0)}`;
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—";
  return `$${v.toFixed(2)}`;
}

// Raw number, full precision (for greeks/OI/spot inputs — match the dev probe).
function fmtRaw(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Number.isInteger(v)) return v.toLocaleString();
  return String(+v.toFixed(6));
}

const C = {
  bg: "rgba(13,17,25,0.96)",
  border: "rgba(0,240,255,0.30)",
  cyan: "#00F0FF",
  pos: "#29b6f6",
  neg: "#ff4757",
  dim: "#8B94A7",
};

// ─── Inner content: strike header + 2x2 rolling-diff + OTM contract price ──────
function PopupBody({ row, spotPrice, baselines }: Pick<Props, "row" | "spotPrice" | "baselines">) {
  // Live OI-based net GEX (history baselines are OI-based, so the diff is
  // apples-to-apples). The composite OI+Vol value is shown as the headline.
  const liveNetGex = row.netGEX ?? 0;
  const compositeNetGex = (row.netGEX ?? 0) + (row.netVolGEX ?? 0);

  const base = baselines[row.strike] ?? {};
  // Rolling DIFFERENCE = current − reading at that age. null when no baseline yet.
  const diff = (key: string): number | null => {
    const b = base[key];
    return b == null || !Number.isFinite(b) ? null : liveNetGex - b;
  };

  const boxes: { label: string; key: string }[] = [
    { label: "FROM OPEN", key: "open" },
    { label: "5 MIN", key: "5" },
    { label: "15 MIN", key: "15" },
    { label: "30 MIN", key: "30" },
  ];

  // OTM contract: call above spot, put below spot.
  const isOtmCall = row.strike > spotPrice;
  const otmSide = isOtmCall ? "CALL" : "PUT";
  const otmPrice = isOtmCall ? row.callMark : row.putMark;

  return (
    <div style={{ fontFamily: "monospace", color: "#fff" }}>
      {/* Header: strike + live composite */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "0.02em" }}>
          SPX {row.strike.toLocaleString()}
        </span>
        <span style={{ marginLeft: "auto", textAlign: "right" }}>
          <span style={{ display: "block", fontSize: 8, color: C.dim, letterSpacing: "0.1em" }}>NET GEX (OI+VOL)</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: compositeNetGex >= 0 ? C.pos : C.neg }}>
            {fmtGex(compositeNetGex)}
          </span>
        </span>
      </div>

      {/* Component breakdown: the bar plots the OI term, so a negative bar with a
          positive composite means volume-GEX outweighs OI-GEX. Show both. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: "6px 9px" }}>
          <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.1em" }}>OI GEX</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: (row.netGEX ?? 0) >= 0 ? C.pos : C.neg }}>{fmtGex(row.netGEX)}</div>
        </div>
        <div style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: "6px 9px" }}>
          <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.1em" }}>VOL GEX</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: (row.netVolGEX ?? 0) >= 0 ? C.pos : C.neg }}>{fmtGex(row.netVolGEX)}</div>
        </div>
      </div>

      {/* 2x2 rolling-difference boxes */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
        {boxes.map(({ label, key }) => {
          const d = diff(key);
          const col = d == null ? C.dim : d >= 0 ? C.pos : C.neg;
          return (
            <div
              key={key}
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 6,
                padding: "8px 10px",
              }}
            >
              <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.1em", marginBottom: 3 }}>
                Δ {label}
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: col }}>{fmtGex(d)}</div>
            </div>
          );
        })}
      </div>

      {/* OTM contract price */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "rgba(0,240,255,0.05)",
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          padding: "8px 12px",
        }}
      >
        <span style={{ fontSize: 9, color: C.dim, letterSpacing: "0.1em" }}>
          OTM {otmSide} CONTRACT
        </span>
        <span style={{ fontSize: 16, fontWeight: 800, color: C.cyan }}>{fmtPrice(otmPrice)}</span>
      </div>

      {/* Raw GEX inputs actually used to draw this bar — for cross-checking
          against the /dev probe (same formula: |γ| × OI × spot²). */}
      <details style={{ marginTop: 12 }}>
        <summary style={{ fontSize: 9, color: C.dim, letterSpacing: "0.1em", cursor: "pointer" }}>
          GEX INPUTS (LIVE — VERIFY VS /DEV)
        </summary>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          {/* spot */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: C.dim }}>spot (S)</span>
            <span style={{ color: "#fff", fontWeight: 700 }}>{fmtRaw(row.spotPrice ?? spotPrice)}</span>
          </div>
          {/* call side */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 6 }}>
            <div style={{ fontSize: 9, color: C.pos, letterSpacing: "0.08em", marginBottom: 3 }}>CALL</div>
            <InputRow label="gamma" value={fmtRaw(row.callGamma)} />
            <InputRow label="OI" value={fmtRaw(row.callOI)} />
            <InputRow label="callGEX = |γ|·OI·S²" value={fmtGex(row.callGEX)} strong />
          </div>
          {/* put side */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 6 }}>
            <div style={{ fontSize: 9, color: C.neg, letterSpacing: "0.08em", marginBottom: 3 }}>PUT</div>
            <InputRow label="gamma" value={fmtRaw(row.putGamma)} />
            <InputRow label="OI" value={fmtRaw(row.putOI)} />
            <InputRow label="putGEX = −|γ|·OI·S²" value={fmtGex(row.putGEX)} strong />
          </div>
          {/* net */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 6 }}>
            <InputRow label="netGEX = call + put" value={fmtGex(row.netGEX)} strong />
          </div>
        </div>
      </details>
    </div>
  );
}

function InputRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, lineHeight: 1.7 }}>
      <span style={{ color: C.dim }}>{label}</span>
      <span style={{ color: strong ? "#fff" : "#cfe", fontWeight: strong ? 800 : 600 }}>{value}</span>
    </div>
  );
}

// ─── Shell — picks card / drawer / modal ───────────────────────────────────────
export default function StrikeDetailPopup({
  row,
  spotPrice,
  baselines,
  popupStyle,
  anchor,
  onClose,
}: Props) {
  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const body = <PopupBody row={row} spotPrice={spotPrice} baselines={baselines} />;

  const panel = (extra: CSSProperties): CSSProperties => ({
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 16,
    width: 280,
    boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,240,255,0.08)",
    backdropFilter: "blur(12px)",
    ...extra,
  });

  // ── Floating card: anchored near the click ──
  if (popupStyle === "card") {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const x = anchor?.x ?? vw / 2;
    const y = anchor?.y ?? vh / 2;
    // Keep on-screen.
    const left = Math.min(Math.max(8, x + 12), vw - 296);
    const top = Math.min(Math.max(8, y + 12), vh - 240);
    return (
      <>
        <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 998 }} />
        <div style={panel({ position: "fixed", left, top, zIndex: 999 })}>
          <CloseBtn onClose={onClose} />
          {body}
        </div>
      </>
    );
  }

  // ── Side drawer: docked to the right edge ──
  if (popupStyle === "drawer") {
    return (
      <>
        <div
          onClick={onClose}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 998 }}
        />
        <div
          style={panel({
            position: "fixed",
            top: 0,
            right: 0,
            height: "100%",
            width: 320,
            borderRadius: 0,
            borderLeft: `1px solid ${C.border}`,
            zIndex: 999,
            display: "flex",
            flexDirection: "column",
          })}
        >
          <CloseBtn onClose={onClose} />
          <div style={{ marginTop: 8 }}>{body}</div>
        </div>
      </>
    );
  }

  // ── Centered modal ──
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(2px)",
        zIndex: 998,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={panel({ position: "relative", width: 320, zIndex: 999 })}>
        <CloseBtn onClose={onClose} />
        {body}
      </div>
    </div>
  );
}

function CloseBtn({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      aria-label="Close"
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        width: 22,
        height: 22,
        borderRadius: 5,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.04)",
        color: "#8B94A7",
        cursor: "pointer",
        fontSize: 12,
        lineHeight: "1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      ×
    </button>
  );
}
