"use client";

import { topSpeedMovers, type SpeedWindow, type VolGexSpeedMap } from "@/hooks/useVolGexSpeed";

/**
 * Right-hand rail for the GEX heatmap: the 5 strikes where VOL-ONLY GEX is
 * building fastest and the 5 where it is bleeding fastest, over the selected
 * window. Ranked by |Δ|GEX|| (see useVolGexSpeed for the sign convention).
 *
 * Reading it: a strike whose vol gamma is BUILDING while price approaches it is a
 * wall going up in real time (pin / rejection). BLEEDING = the wall is being torn
 * down (breakout fuel). Absolute values skew positive early in RTH — rank, don't
 * read the level.
 */

export const SPEED_BUILD = "#3ddc84";
export const SPEED_BLEED = "#ff566e";

const WINDOWS: { v: SpeedWindow; label: string }[] = [
  { v: 30, label: "30s" },
  { v: 60, label: "1m" },
  { v: 300, label: "5m" },
];

export function fmtSpeed(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = v >= 0 ? "+" : "−";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}

export function fmtSpeedPct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const s = v >= 0 ? "+" : "−";
  return `${s}${Math.abs(v).toFixed(1)}%`;
}

interface Props {
  speed: VolGexSpeedMap;
  windowSec: SpeedWindow;
  onWindowChange?: (w: SpeedWindow) => void;
  /** true while the window is still being served by the Postgres seed */
  usingSeed?: boolean;
  width?: number;
}

export default function VolGexSpeedRail({
  speed,
  windowSec,
  onWindowChange,
  usingSeed = false,
  width = 176,
}: Props) {
  const { builders, bleeders } = topSpeedMovers(speed, 5);
  const empty = !builders.length && !bleeders.length;

  const section = (
    title: string,
    color: string,
    items: ReturnType<typeof topSpeedMovers>["builders"]
  ) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", color, textTransform: "uppercase", opacity: 0.85 }}>
        {title}
      </div>
      {items.length === 0 && (
        <div style={{ fontSize: 10, color: "#3a5570", padding: "2px 0" }}>—</div>
      )}
      {items.map((s) => (
        <div
          key={s.strike}
          title={`Δ|GEX| ${fmtSpeed(s.magDelta)} over ${windowSec}s · raw Δ ${fmtSpeed(s.delta)} · ${fmtSpeed(s.prev)} → ${fmtSpeed(s.cur)}`}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            alignItems: "center",
            gap: 4,
            padding: "2px 5px",
            borderRadius: 3,
            background: `${color}14`,
            border: `1px solid ${color}2e`,
            cursor: "help",
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", fontFamily: "var(--font-mono)" }}>
            {s.strike.toLocaleString()}
          </span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.15 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color, fontFamily: "var(--font-mono)" }}>{fmtSpeed(s.magDelta)}</span>
            <span style={{ fontSize: 10, color: "#8da8c2", fontFamily: "var(--font-mono)" }}>{fmtSpeedPct(s.pct)}</span>
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div
      style={{
        width,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "8px 8px 10px",
        borderLeft: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(13,17,25,0.55)",
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: "#fff", textTransform: "uppercase" }}>
          Vol GEX Speed
        </span>
        {usingSeed && (
          <span title="Live buffer is still filling — using the recorded 1-min/5-min baseline from Postgres." style={{ fontSize: 10, fontWeight: 800, color: "#FB8501", border: "1px solid #FB850155", background: "#FB850118", borderRadius: 2, padding: "0 3px", cursor: "help" }}>
            SEED
          </span>
        )}
      </div>

      {onWindowChange && (
        <div style={{ display: "flex", gap: 2, border: "1px solid rgba(33,158,188,0.18)", borderRadius: 4, overflow: "hidden" }}>
          {WINDOWS.map((w) => (
            <button
              key={w.v}
              onClick={() => onWindowChange(w.v)}
              style={{
                flex: 1,
                padding: "2px 0",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.06em",
                cursor: "pointer",
                border: "none",
                fontFamily: "inherit",
                background: windowSec === w.v ? "rgba(33,158,188,0.16)" : "transparent",
                color: windowSec === w.v ? "#219EBC" : "#5a7a98",
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
      )}

      {empty ? (
        <div style={{ fontSize: 10, color: "#3a5570", lineHeight: 1.4 }}>
          Collecting… speed appears once the window fills.
        </div>
      ) : (
        <>
          {section("Building", SPEED_BUILD, builders)}
          {section("Bleeding", SPEED_BLEED, bleeders)}
        </>
      )}
    </div>
  );
}
