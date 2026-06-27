"use client";

import { useEffect, useRef, useState } from "react";
import type { FlowOrder } from "@/hooks/useSpxFlow";
import { HOME_THEME as HT } from "@/components/shared/homeTheme";
import { computeGapFill } from "@/lib/esGapMath";

interface EsGapRow {
  date: string;
  prior_close: number | null;
  open_0930: number | null;
  gap_pts: number | null;
  gap_dir: "up" | "down" | "flat" | null;
  locked: number;
  filled: number;
  pct_filled: number;
  fill_ts: number | null;
  extreme_after: number | null;
  open_ts: number | null;
}

interface SignalsPanelProps {
  orders?: FlowOrder[];
  bucket?: Record<string, unknown> | null;
  /** Live ES futures price (esFut on the home page) — drives the fill meter live. */
  esPrice?: number;
}

function fmt(v: number | null | undefined, d = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtTime(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }) + " ET";
}

/**
 * Live fill % from the current ES price, clamped 0..100. The server row is the
 * source of truth for FILLED (it ratchets + can't reverse); this just animates
 * the meter between the 5-minute server writes using the live quote.
 */
function livePct(row: EsGapRow, esPrice: number | undefined): number {
  if (row.open_0930 == null || row.prior_close == null) return row.pct_filled ?? 0;
  const serverPct = row.pct_filled ?? 0;
  if (!esPrice || !isFinite(esPrice) || esPrice <= 0) return serverPct;
  // Treat the live ES quote as the current "extreme" — same pure math the cron
  // uses on candle lows/highs. Never show less than the server-locked ratchet.
  const { pct } = computeGapFill(row.prior_close, row.open_0930, esPrice);
  return Math.max(serverPct, pct);
}

export default function SignalsPanel({ esPrice }: SignalsPanelProps = {}) {
  const [row, setRow] = useState<EsGapRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/es-gap?_=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) { setRow(j.gap ?? null); setLoaded(true); }
      } catch { /* ignore */ }
    };
    load();
    timer.current = setInterval(load, 30_000);
    return () => { cancelled = true; if (timer.current) clearInterval(timer.current); };
  }, []);

  const wrap: React.CSSProperties = {
    height: "100%", display: "flex", flexDirection: "column",
    padding: 16, gap: 14, overflow: "auto",
  };

  // ── Empty / pre-9:30 states ──────────────────────────────────────────────
  if (!loaded || !row || !row.locked) {
    return (
      <div style={{ ...wrap, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <div style={{
          width: 44, height: 44, borderRadius: "50%", display: "flex",
          alignItems: "center", justifyContent: "center",
          border: "1px solid rgba(33,158,188,0.25)", background: "rgba(33,158,188,0.06)",
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#219EBC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        </div>
        <div style={{ color: HT.cyan, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em" }}>
          Overnight ES Gap
        </div>
        <div style={{ color: "#5a6b85", fontSize: 11, letterSpacing: "0.06em", maxWidth: 360 }}>
          {loaded ? "Waiting for the 9:30 ET open — the gap posts on the bell." : "Loading…"}
        </div>
      </div>
    );
  }

  const dir = row.gap_dir;
  const dirColor = dir === "up" ? HT.green : dir === "down" ? HT.red : HT.muted;
  const gapPts = row.gap_pts ?? 0;
  const gapPctOfClose = row.prior_close ? (gapPts / row.prior_close) * 100 : null;
  const pct = livePct(row, esPrice);
  const isFilled = row.filled === 1 || pct >= 100 - 1e-9;
  const barColor = isFilled ? HT.green : dirColor;

  return (
    <div style={wrap}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: HT.cyan, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em" }}>
          Overnight ES Gap
        </span>
        <span style={{
          fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 4, letterSpacing: ".08em",
          background: isFilled ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)",
          color: isFilled ? HT.green : HT.muted,
          border: `1px solid ${isFilled ? "rgba(16,185,129,0.4)" : HT.border}`,
        }}>
          {isFilled ? "✓ FILLED" : "OPEN"}
        </span>
      </div>

      {/* Big gap number */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 34, fontWeight: 800, color: dirColor, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
          {gapPts >= 0 ? "+" : ""}{fmt(gapPts)}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: dirColor, textTransform: "uppercase", letterSpacing: ".1em" }}>
          {dir === "up" ? "▲ Gap Up" : dir === "down" ? "▼ Gap Down" : "Flat"}
        </span>
        {gapPctOfClose != null && (
          <span style={{ fontSize: 12, color: HT.muted, fontVariantNumeric: "tabular-nums" }}>
            ({gapPctOfClose >= 0 ? "+" : ""}{gapPctOfClose.toFixed(2)}%)
          </span>
        )}
      </div>

      {/* Prior close / open prints */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Stat label="Prior Close (4:00 PM)" value={fmt(row.prior_close)} />
        <Stat label="Open (9:30 AM)" value={fmt(row.open_0930)} />
      </div>

      {/* Fill meter */}
      <div style={{ marginTop: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <span style={{ fontSize: 10, color: HT.muted, letterSpacing: ".08em", textTransform: "uppercase" }}>
            Gap Fill
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: barColor, fontVariantNumeric: "tabular-nums" }}>
            {pct.toFixed(0)}%
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${pct}%`, borderRadius: 4,
            background: barColor, transition: "width 0.6s ease",
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 9, color: "#5a6b85" }}>Open</span>
          <span style={{ fontSize: 9, color: "#5a6b85" }}>Prior close ({fmt(row.prior_close)})</span>
        </div>
      </div>

      {/* Status line */}
      <div style={{ fontSize: 11, color: isFilled ? HT.green : HT.muted, marginTop: 2 }}>
        {isFilled
          ? `Gap filled${row.fill_ts ? ` at ${fmtTime(row.fill_ts)}` : ""}.`
          : `Live ES ${fmt(esPrice && esPrice > 0 ? esPrice : null)} · ${fmt(Math.abs((row.prior_close ?? 0) - (esPrice && esPrice > 0 ? esPrice : row.open_0930 ?? 0)))} pts to fill.`}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: "rgba(0,0,0,0.25)", border: `1px solid ${HT.border}`,
      borderRadius: 8, padding: "8px 10px",
    }}>
      <div style={{ fontSize: 9, color: HT.muted, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: HT.text, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}
