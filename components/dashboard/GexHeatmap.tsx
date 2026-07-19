"use client";

import { useEffect, useRef } from "react";
import { densifyChainRows, netGEXOf, type ChainRow, type CalcMode } from "@/lib/calculations/calculations";
import { useVolGexSpeed, type SpeedWindow } from "@/hooks/useVolGexSpeed";

interface HeatmapRow {
  strike: number;
  netGEX: number;
  netVolGEX: number;
  netDEX: number;
  gexPlusVex: number;
  rollingNetGEX: number | null;
  /** Δ|vol-only GEX| over the speed window — + = wall building, − = bleeding. */
  volSpeed: number | null;
  volSpeedPct: number | null;
}

const BASE_COLS = [
  { key: "netGEX", label: "NET GEX" },
  { key: "netVolGEX", label: "VOL ONLY GEX" },
  { key: "netDEX", label: "DEX" },
  { key: "gexPlusVex", label: "GEX + VEX" },
  { key: "rollingNetGEX", label: "30 MIN ROLLING NET GEX" },
] as const;

const SPEED_COL = { key: "volSpeed", label: "VOL GEX SPEED" } as const;

type ColKey = (typeof BASE_COLS)[number]["key"] | "volSpeed";

// All cells render in millions, whole numbers only — keeps column widths stable
// and stops digit-churn on every tick.
function fmtG(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const m = Math.round(v / 1e6);
  const s = m < 0 ? "-" : "";
  return s + "$" + Math.abs(m).toLocaleString() + "M";
}

function robustMax(vals: number[], pct = 0.95): number {
  const abs = vals.map(v => Math.abs(v)).filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!abs.length) return 1;
  const idx = Math.min(abs.length - 1, Math.floor(abs.length * pct));
  return Math.max(1, abs[idx]);
}

interface Props {
  chain: ChainRow[];
  spotPrice: number;
  expiry?: string;
  dataMode?: "oi-vol" | "vol-only";
  intensity?: number;
  window?: number;
  rollingNetGexByStrike?: Record<number, number>;
  /** Adds the VOL GEX SPEED column (Δ|vol-only GEX| over a rolling window). */
  showSpeed?: boolean;
  speedWindow?: SpeedWindow;
  /** Fired when a strike row/cell is clicked. Carries the full ChainRow + click pos. */
  onStrikeClick?: (row: ChainRow, pos: { x: number; y: number }) => void;
}

export default function GexHeatmap({
  chain,
  spotPrice,
  expiry,
  dataMode = "oi-vol",
  intensity = 1.4,
  window: win = 20,
  rollingNetGexByStrike = {},
  showSpeed = false,
  speedWindow = 60,
  onStrikeClick,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const anchorStrikeRef = useRef<number | null>(null);
  const useVol = dataMode === "vol-only";

  const denseChain = densifyChainRows(chain);
  const rowByStrike = new Map(denseChain.map(r => [r.strike, r]));
  const allStrikes = [...new Set(denseChain.map(r => r.strike))].sort((a, b) => b - a);
  const nearestStrike = spotPrice > 0
    ? allStrikes.reduce((best, s) => Math.abs(s - spotPrice) < Math.abs(best - spotPrice) ? s : best, allStrikes[0] ?? spotPrice)
    : (allStrikes[0] ?? 0);

  // Quantized anchor: the visible window only re-centers in whole 5-strike jumps.
  // Snapping to a fixed 5-strike lattice (rather than re-anchoring to nearestStrike)
  // means the row set is a pure function of the bucket, so a tick that crosses the
  // threshold and ticks back lands on the same rows instead of flashing.
  const strikeStep = allStrikes.length > 1 ? Math.abs(allStrikes[0] - allStrikes[1]) : 1;
  const bucket = strikeStep * 5;
  const snapped = allStrikes.length
    ? allStrikes.reduce((best, s) =>
        Math.abs(s - Math.round(nearestStrike / bucket) * bucket) <
        Math.abs(best - Math.round(nearestStrike / bucket) * bucket) ? s : best, allStrikes[0])
    : nearestStrike;
  if (
    anchorStrikeRef.current == null ||
    !allStrikes.includes(anchorStrikeRef.current) ||
    Math.abs(nearestStrike - anchorStrikeRef.current) >= bucket
  ) {
    anchorStrikeRef.current = snapped;
  }
  const atmStrike = anchorStrikeRef.current;
  const atmIdx = allStrikes.indexOf(atmStrike);
  const lo = Math.max(0, atmIdx - win);
  const hi = Math.min(allStrikes.length - 1, atmIdx + win);
  const visibleStrikes = new Set(allStrikes.slice(lo, hi + 1));

  // Vol-only GEX speed. Sourced from the SAME netVolGEX the VOL ONLY GEX column
  // renders (server value when present), so column and speed can never disagree.
  const speedSource = denseChain.map(r => ({
    strike: r.strike,
    netVolGEX: r.netVolGEX ?? netGEXOf(r, "vol", spotPrice || Number(r.spotPrice ?? r.spot ?? 0)),
  }));
  const { speed } = useVolGexSpeed(speedSource, expiry ?? "", speedWindow, { seed: showSpeed });

  const COLS: readonly { key: ColKey; label: string }[] = showSpeed
    ? [...BASE_COLS, SPEED_COL]
    : BASE_COLS;

  const rows: HeatmapRow[] = denseChain
    .filter(r => visibleStrikes.has(r.strike))
    .map(r => {
      const mode: CalcMode = useVol ? "vol" : "net";
      const callPos = useVol ? (r.callVolume ?? 0) : (r.callOI ?? 0) + (r.callVolume ?? 0);
      const putPos = useVol ? (r.putVolume ?? 0) : (r.putOI ?? 0) + (r.putVolume ?? 0);
      const spot = spotPrice || Number(r.spotPrice ?? r.spot ?? 0);
      const callDelta = r.callDelta ?? 0;
      const putDelta = r.putDelta ?? 0;
      // netVolGEX = net under vol-only basis; prefer the server value when present.
      const netVolGEX = r.netVolGEX ?? netGEXOf(r, "vol", spot);
      const vannaValue = useVol ? (r.netVolVanna ?? r.netVanna ?? 0) : (r.netVanna ?? r.netVolVanna ?? 0);
      // Single source of truth: shared helper (calls +, puts −, abs gamma) under the
      // active basis. Do NOT fall back to a precomputed r.netGEX (may be a different basis).
      const netGEX = netGEXOf(r, mode, spot);

      const sp = speed[r.strike];

      return {
        strike: r.strike,
        netGEX,
        netVolGEX,
        netDEX: (callDelta * callPos - Math.abs(putDelta) * putPos) * spot * 100,
        gexPlusVex: netGEX + vannaValue,
        rollingNetGEX: rollingNetGexByStrike[r.strike] ?? null,
        volSpeed: sp ? sp.magDelta : null,
        volSpeedPct: sp ? sp.pct : null,
      };
    })
    .sort((a, b) => b.strike - a.strike);

  const atm = rows.length
    ? rows.reduce((best, r) => Math.abs(r.strike - spotPrice) < Math.abs(best.strike - spotPrice) ? r : best, rows[0])
    : null;

  const maxMap: Record<ColKey, number> = {
    netGEX: robustMax(rows.map(r => r.netGEX)),
    netVolGEX: robustMax(rows.map(r => r.netVolGEX)),
    netDEX: robustMax(rows.map(r => r.netDEX)),
    gexPlusVex: robustMax(rows.map(r => r.gexPlusVex)),
    rollingNetGEX: 1,
    // Speed gets its own scale — Δ$ is orders of magnitude smaller than the level,
    // so sharing the netVolGEX max would leave every speed cell colorless.
    volSpeed: robustMax(rows.map(r => r.volSpeed ?? 0)),
  };

  const topRanksByCol = Object.fromEntries(
    COLS.map(({ key }) => [
      key,
      new Map(
        [...rows]
          .sort((a, b) => Math.abs((b[key] ?? 0) as number) - Math.abs((a[key] ?? 0) as number))
          .slice(0, 3)
          .map((row, idx) => [row.strike, idx + 1] as const)
      ),
    ])
  ) as Record<ColKey, Map<number, number>>;

  function cellBg(key: ColKey, val: number | null, topRank: number): string {
    const n = val == null || !Number.isFinite(val) ? 0 : val;
    const m = maxMap[key] || 0;
    if (m === 0 || !n) return "transparent";
    const pos = n >= 0;
    if (topRank === 1) return pos ? "rgba(41,182,246,0.90)" : "rgba(255,71,87,0.90)";
    if (topRank === 2) return pos ? "rgba(41,182,246,0.45)" : "rgba(255,71,87,0.45)";
    if (topRank === 3) return pos ? "rgba(41,182,246,0.25)" : "rgba(255,71,87,0.25)";
    const ratio = Math.min(Math.abs(n) / m, 1);
    const eased = Math.pow(ratio * Math.max(intensity || 0.1, 1), 1.4);
    const alpha = Math.min(0.18, 0.02 + eased * 0.16);
    return pos ? `rgba(41,182,246,${alpha.toFixed(2)})` : `rgba(255,71,87,${alpha.toFixed(2)})`;
  }

  const aboveATM = rows.filter(r => r.strike > (atm?.strike ?? 0));
  const belowATM = rows.filter(r => r.strike <= (atm?.strike ?? 0));
  const rankSide = (arr: HeatmapRow[]) => {
    const m = new Map<number, number>();
    [...arr].sort((a, b) => Math.abs(b.netGEX) - Math.abs(a.netGEX)).slice(0, 5).forEach((r, i) => m.set(r.strike, i + 1));
    return m;
  };
  // Single strike with the highest |NET GEX| — gets a golden box (NET GEX cell only).
  const peakNetGexStrike = rows.length
    ? rows.reduce((best, r) => (Math.abs(r.netGEX) > Math.abs(best.netGEX) ? r : best), rows[0]).strike
    : null;
  const rankAbove = rankSide(aboveATM);
  const rankBelow = rankSide(belowATM);
  // Highest |NET GEX| strike on each side of spot → 📍 pin (possible pin/explosive level).
  const pinAbove = aboveATM.length ? aboveATM.reduce((b, r) => (Math.abs(r.netGEX) > Math.abs(b.netGEX) ? r : b)).strike : null;
  const pinBelow = belowATM.length ? belowATM.reduce((b, r) => (Math.abs(r.netGEX) > Math.abs(b.netGEX) ? r : b)).strike : null;
  const rankColors: Record<number, string> = { 1: "#ffd700", 2: "#c0c0c0", 3: "#cd7f32", 4: "#4a7a99", 5: "#3a5570" };

  useEffect(() => {
    if (!bodyRef.current || !atm || initializedRef.current) return;
    const el = bodyRef.current.querySelector(`[data-strike="${atm.strike}"]`) as HTMLElement | null;
    if (el) {
      const target = el.offsetTop - bodyRef.current.clientHeight / 2 + el.offsetHeight / 2;
      bodyRef.current.scrollTop = Math.max(0, target);
      initializedRef.current = true;
    }
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      initializedRef.current = false;
    };
  }, []);

  if (!rows.length) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 12, color: "#3a5570" }}>
        No chain data
      </div>
    );
  }

  const gridCols = `68px repeat(${COLS.length}, 1fr)`;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--overview-bg, #05080d)", overflow: "hidden" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: gridCols,
        background: "var(--overview-header-bg, #070c14)",
        borderBottom: "1px solid var(--overview-border-soft, #0d1f30)",
        flexShrink: 0,
        position: "sticky",
        top: 0,
        zIndex: 2,
      }}>
        <div style={{ padding: "5px 8px", fontSize: 10, fontWeight: 700, color: "#ffffff", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          STRIKE
        </div>
        {COLS.map(c => (
          <div key={c.key} style={{ padding: "5px 6px", fontSize: 10, fontWeight: 700, color: "#ffffff", textTransform: "uppercase", letterSpacing: "0.08em", textAlign: "center" }}>
            {c.label}
          </div>
        ))}
      </div>

      <div ref={bodyRef} style={{ flex: 1, overflowY: "auto" }}>
        {rows.map(row => {
          const isATM = row.strike === atm?.strike;
          const rank = rankAbove.get(row.strike) ?? rankBelow.get(row.strike);
          const vals: Record<ColKey, number | null> = {
            netGEX: row.netGEX,
            netVolGEX: row.netVolGEX,
            netDEX: row.netDEX,
            gexPlusVex: row.gexPlusVex,
            rollingNetGEX: row.rollingNetGEX,
            volSpeed: row.volSpeed,
          };

          return (
            <div
              key={row.strike}
              data-strike={row.strike}
              onClick={onStrikeClick ? (e) => {
                const full = rowByStrike.get(row.strike);
                if (full) onStrikeClick(full, { x: e.clientX, y: e.clientY });
              } : undefined}
              style={{
                display: "grid",
                gridTemplateColumns: gridCols,
                borderBottom: "1px solid #0a1420",
                outline: isATM ? "1.5px solid rgba(33,158,188,0.7)" : "none",
                outlineOffset: isATM ? "-1px" : "0",
                position: "relative",
                zIndex: isATM ? 1 : 0,
                cursor: onStrikeClick ? "pointer" : "default",
              }}
            >
              <div style={{
                padding: "4px 8px",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "inherit",
                color: isATM ? "#219EBC" : "#7a9ab8",
                background: isATM ? "#0a2030" : "transparent",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}>
                {row.strike.toLocaleString()}
                {isATM && (
                  <span style={{ fontSize: 10, color: "#219EBC", background: "#062030", padding: "1px 3px", borderRadius: 2 }}>ATM</span>
                )}
                {rank && (
                  <span style={{ fontSize: 10, fontWeight: 800, color: rankColors[rank], background: `${rankColors[rank]}22`, padding: "0 3px", borderRadius: 2, border: `1px solid ${rankColors[rank]}44` }}>
                    #{rank}
                  </span>
                )}
              </div>

              {COLS.map(c => {
                const v = vals[c.key];
                const topRank = topRanksByCol[c.key].get(row.strike) ?? 0;
                const isGexPeak = c.key === "netGEX" && row.strike === peakNetGexStrike;
                const isPin = c.key === "netGEX" && (row.strike === pinAbove || row.strike === pinBelow);
                return (
                  <div key={c.key} style={{
                    padding: "4px 6px",
                    fontSize: 10,
                    fontFamily: "inherit",
                    textAlign: "center",
                    background: cellBg(c.key, v, topRank),
                    color: "#ffffff",
                    fontWeight: topRank > 0 ? 800 : 400,
                    outline: isGexPeak ? "2px solid #ffd700" : undefined,
                    outlineOffset: isGexPeak ? "-2px" : undefined,
                    boxShadow: isGexPeak ? "0 0 6px rgba(255,215,0,0.6)" : undefined,
                    position: (isGexPeak || isPin) ? "relative" : undefined,
                    zIndex: isGexPeak ? 1 : undefined,
                  }}>
                    {isPin && (
                      <span title="Possible pin or explosive level" style={{ marginRight: 3, cursor: "help", display: "inline-flex", verticalAlign: "middle" }}>
                        <svg width="14" height="17" viewBox="0 0 24 24" fill="#ffffff" stroke="rgba(0,0,0,.55)" strokeWidth={1.5}>
                          <path d="M12 21s7-6.5 7-12A7 7 0 0 0 5 9c0 5.5 7 12 7 12z" />
                          <circle cx="12" cy="9" r="2.3" fill="rgba(0,0,0,.55)" stroke="none" />
                        </svg>
                      </span>
                    )}
                    {fmtG(v)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
