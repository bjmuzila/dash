"use client";

import { useState, useEffect, useCallback } from "react";

interface LadderRow {
  key: string;
  label: string;
  dotColor: string;
  valueKey: string;
}

const ROWS: LadderRow[] = [
  { key: "NO LONG",  label: "NO LONG",  dotColor: "#ff6b6b", valueKey: "no_long" },
  { key: "UP",       label: "UP EST",   dotColor: "#22c55e", valueKey: "up" },
  { key: "MID",      label: "MID",      dotColor: "#faad14", valueKey: "mid" },
  { key: "DOWN",     label: "DOWN EST", dotColor: "#FB8501", valueKey: "down" },
  { key: "NO SHORT", label: "NO SHORT", dotColor: "#ff6b6b", valueKey: "no_short" },
];

function fmtDist(v: number, spot: number): string {
  const d = v - spot;
  const pct = ((d / spot) * 100).toFixed(1);
  return (d > 0 ? "+" : "") + d.toFixed(0) + " (" + pct + "%)";
}

function fmtPrice(val: number): string {
  const whole = Math.floor(val);
  const frac = val - whole;
  let decimals = ".00";
  if (frac < 0.125) decimals = ".00";
  else if (frac < 0.375) decimals = ".25";
  else if (frac < 0.625) decimals = ".50";
  else decimals = ".75";
  return (whole + Number(decimals)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  esSpot?: number; // current ES price for distance calc
}

export default function EsStatsLadder({ esSpot }: Props) {
  const [stats, setStats] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch("/api/es-stats", { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const row = await res.json();
        if (!row) {
          setStats({});
          return;
        }
        setStats(row);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg.includes("abort") ? "Request timeout" : msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    const t = setInterval(fetch_, 5 * 60_000);
    return () => clearInterval(t);
  }, [fetch_]);

  const spot = esSpot ?? 0;

  // Build sorted ladder entries: level rows + current price row, sorted descending by value
  type LadderEntry =
    | { type: "level"; row: LadderRow; val: number; hasVal: boolean }
    | { type: "spot"; val: number };

  const entries: LadderEntry[] = ROWS.map((row) => {
    const rawVal = stats[row.valueKey];
    const val = rawVal != null ? parseFloat(String(rawVal).replace(/[^0-9.-]/g, "")) : NaN;
    return { type: "level" as const, row, val, hasVal: Number.isFinite(val) };
  });

  if (spot > 0) {
    entries.push({ type: "spot" as const, val: spot });
  }

  // Sort descending (highest price at top)
  entries.sort((a, b) => {
    const av = Number.isFinite(a.val) ? a.val : -Infinity;
    const bv = Number.isFinite(b.val) ? b.val : -Infinity;
    return bv - av;
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--overview-bg, #05080d)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "5px 10px",
          background: "var(--overview-header-bg, #070c14)",
          borderBottom: "1px solid var(--overview-border-soft, #0d1f30)",
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 8,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "#fff",
            fontWeight: 700,
          }}
        >
          ⊞ ES STATS LADDER
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
        {/* vertical spine */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 1,
            background: "#0d1f30",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />

        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "flex-start",
              padding: "6px 10px",
              background: "var(--overview-bg, #05080d)",
              color: "#1e3050",
              fontSize: 11,
              zIndex: 5,
            }}
          >
            Loading…
          </div>
        )}
        {err && !loading && (
          <div style={{ padding: 8, fontSize: 10, color: "#ef4444", whiteSpace: "pre-wrap", overflowWrap: "break-word" }}>⚠ {err}</div>
        )}

        {entries.map((entry, i) => {
          if (entry.type === "spot") {
            return (
              <div
                key="__spot__"
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  minHeight: 0,
                  borderBottom: "1px solid #0a1420",
                  position: "relative",
                  zIndex: 1,
                  background: "linear-gradient(90deg, rgba(33,158,188,0.12) 0%, rgba(0,180,255,0.07) 50%, rgba(33,158,188,0.12) 100%)",
                }}
              >
                {/* Label side */}
                <div style={{ flex: 1, textAlign: "right", paddingRight: 10, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 700, letterSpacing: "0.1em",
                    textTransform: "uppercase", color: "#219EBC", whiteSpace: "nowrap",
                  }}>
                    ES NOW
                  </div>
                </div>

                {/* Dot — filled cyan */}
                <div
                  style={{
                    width: 10, height: 10, borderRadius: "50%",
                    border: "2px solid #219EBC",
                    background: "#219EBC",
                    boxShadow: "0 0 6px #219EBC88",
                    flexShrink: 0, position: "relative", zIndex: 2,
                  }}
                />

                {/* Value side */}
                <div style={{ flex: 1, paddingLeft: 8, minWidth: 0 }}>
                  <div style={{
                    fontSize: 16, fontWeight: 700, color: "#219EBC",
                    fontVariantNumeric: "tabular-nums", lineHeight: 1, whiteSpace: "nowrap",
                  }}>
                    {fmtPrice(entry.val)}
                  </div>
                </div>
              </div>
            );
          }

          // level row
          const { row, val, hasVal } = entry;
          const distStr = hasVal && spot > 0 ? fmtDist(val, spot) : "";
          const distPos = hasVal && spot > 0 ? val > spot : null;

          return (
            <div
              key={row.key}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                minHeight: 0,
                borderBottom: "1px solid #0a1420",
                position: "relative",
                zIndex: 1,
              }}
            >
              {/* Label side */}
              <div style={{ flex: 1, textAlign: "right", paddingRight: 10, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 700, letterSpacing: "0.1em",
                  textTransform: "uppercase", color: "#fff", whiteSpace: "nowrap",
                }}>
                  {row.label}
                </div>
              </div>

              {/* Dot */}
              <div
                style={{
                  width: 10, height: 10, borderRadius: "50%",
                  border: `2px solid ${row.dotColor}`,
                  background: "var(--overview-bg, #05080d)",
                  flexShrink: 0, position: "relative", zIndex: 2,
                }}
              />

              {/* Value side */}
              <div style={{ flex: 1, paddingLeft: 8, minWidth: 0 }}>
                <div style={{
                  fontSize: 16, fontWeight: 700, color: "#fff",
                  fontVariantNumeric: "tabular-nums", lineHeight: 1, whiteSpace: "nowrap",
                }}>
                  {hasVal ? fmtPrice(val) : "—"}
                </div>
                {distStr && (
                  <div style={{
                    fontSize: 11, color: distPos ? "#22c55e" : "#FB8501",
                    marginTop: 1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                  }}>
                    {distStr}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
