"use client";

import { useEffect, useRef, useState } from "react";
import { densifyChainRows, type ChainRow } from "@/lib/calculations/calculations";

interface HeatmapRow {
  strike: number;
  netGEX: number;
  netVolGEX: number;
  netDEX: number;
  gexPlusVex: number;
  rollingNetGEX: number | null;
}

const COLS = [
  { key: "netGEX", label: "NET GEX" },
  { key: "netVolGEX", label: "VOL ONLY GEX" },
  { key: "netDEX", label: "DEX" },
  { key: "gexPlusVex", label: "GEX + VEX" },
  { key: "rollingNetGEX", label: "30 MIN ROLLING NET GEX" },
] as const;

function fmtG(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = v >= 0 ? "" : "-";
  if (a >= 1e9) return s + "$" + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(2) + "K";
  return s + "$" + a.toFixed(2);
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
  onStrikeClick,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const anchorStrikeRef = useRef<number | null>(null);
  const [view, setView] = useState<"heatmap" | "table">("heatmap");
  const useVol = dataMode === "vol-only";

  const denseChain = densifyChainRows(chain);
  const rowByStrike = new Map(denseChain.map(r => [r.strike, r]));
  const allStrikes = [...new Set(denseChain.map(r => r.strike))].sort((a, b) => b - a);
  const nearestStrike = spotPrice > 0
    ? allStrikes.reduce((best, s) => Math.abs(s - spotPrice) < Math.abs(best - spotPrice) ? s : best, allStrikes[0] ?? spotPrice)
    : (allStrikes[0] ?? 0);

  // Hysteresis anchor: only re-center the window once spot moves >1 strike from the
  // current anchor. Prevents add-one/drop-one window flashing on every tick. (See [[heatmap]] note.)
  const strikeStep = allStrikes.length > 1 ? Math.abs(allStrikes[0] - allStrikes[1]) : 1;
  if (
    anchorStrikeRef.current == null ||
    !allStrikes.includes(anchorStrikeRef.current) ||
    Math.abs(nearestStrike - anchorStrikeRef.current) > strikeStep * 1.5
  ) {
    anchorStrikeRef.current = nearestStrike;
  }
  const atmStrike = anchorStrikeRef.current;
  const atmIdx = allStrikes.indexOf(atmStrike);
  const lo = Math.max(0, atmIdx - win);
  const hi = Math.min(allStrikes.length - 1, atmIdx + win);
  const visibleStrikes = new Set(allStrikes.slice(lo, hi + 1));

  const rows: HeatmapRow[] = denseChain
    .filter(r => visibleStrikes.has(r.strike))
    .map(r => {
      const callPos = useVol ? (r.callVolume ?? 0) : (r.callOI ?? 0) + (r.callVolume ?? 0);
      const putPos = useVol ? (r.putVolume ?? 0) : (r.putOI ?? 0) + (r.putVolume ?? 0);
      const spot = spotPrice || Number(r.spotPrice ?? r.spot ?? 0);
      const spotSq = spot * spot;
      const callGamma = r.callGamma ?? 0;
      const putGamma = r.putGamma ?? 0;
      const callDelta = r.callDelta ?? 0;
      const putDelta = r.putDelta ?? 0;
      const netVolGEX = r.netVolGEX ?? ((callGamma * (r.callVolume ?? 0) - putGamma * (r.putVolume ?? 0)) * spotSq);
      const vannaValue = useVol ? (r.netVolVanna ?? r.netVanna ?? 0) : (r.netVanna ?? r.netVolVanna ?? 0);
      const netGEX = r.netGEX ?? (callGamma * callPos * spotSq - putGamma * putPos * spotSq);

      return {
        strike: r.strike,
        netGEX,
        netVolGEX,
        netDEX: (callDelta * callPos - Math.abs(putDelta) * putPos) * spot * 100,
        gexPlusVex: netGEX + vannaValue,
        rollingNetGEX: rollingNetGexByStrike[r.strike] ?? null,
      };
    })
    .sort((a, b) => b.strike - a.strike);

  const atm = rows.length
    ? rows.reduce((best, r) => Math.abs(r.strike - spotPrice) < Math.abs(best.strike - spotPrice) ? r : best, rows[0])
    : null;

  const maxMap: Record<(typeof COLS)[number]["key"], number> = {
    netGEX: robustMax(rows.map(r => r.netGEX)),
    netVolGEX: robustMax(rows.map(r => r.netVolGEX)),
    netDEX: robustMax(rows.map(r => r.netDEX)),
    gexPlusVex: robustMax(rows.map(r => r.gexPlusVex)),
    rollingNetGEX: 1,
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
  ) as Record<(typeof COLS)[number]["key"], Map<number, number>>;

  function cellBg(key: keyof typeof maxMap, val: number | null, topRank: number): string {
    const n = val == null || !Number.isFinite(val) ? 0 : val;
    const m = maxMap[key] || 0;
    if (m === 0 || !n) return "transparent";
    const pos = n >= 0;
    if (topRank === 1) return pos ? "rgba(41,182,246,0.90)" : "rgba(255,71,87,0.90)";
    if (topRank === 2) return pos ? "rgba(41,182,246,0.45)" : "rgba(255,71,87,0.45)";
    if (topRank === 3) return pos ? "rgba(41,182,246,0.25)" : "rgba(255,71,87,0.25)";
    const ratio = Math.min(Math.abs(n) / m, 1);
    const eased = Math.pow(ratio * (intensity || 0.1), 1.4);
    const alpha = Math.min(0.18, 0.02 + eased * 0.16);
    return pos ? `rgba(41,182,246,${alpha.toFixed(2)})` : `rgba(255,71,87,${alpha.toFixed(2)})`;
  }

  // Divergent bar width (0–50%) for the table view: scaled against the column's robust max.
  function barPct(key: keyof typeof maxMap, val: number | null): number {
    const n = val == null || !Number.isFinite(val) ? 0 : val;
    const m = maxMap[key] || 0;
    if (m === 0 || !n) return 0;
    return Math.min(Math.abs(n) / m, 1) * 50;
  }

  const aboveATM = rows.filter(r => r.strike > (atm?.strike ?? 0));
  const belowATM = rows.filter(r => r.strike <= (atm?.strike ?? 0));
  const rankSide = (arr: HeatmapRow[]) => {
    const m = new Map<number, number>();
    [...arr].sort((a, b) => Math.abs(b.netGEX) - Math.abs(a.netGEX)).slice(0, 5).forEach((r, i) => m.set(r.strike, i + 1));
    return m;
  };
  const rankAbove = rankSide(aboveATM);
  const rankBelow = rankSide(belowATM);
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

  const tabBtn = (id: "heatmap" | "table", label: string) => (
    <button
      onClick={() => setView(id)}
      style={{
        padding: "3px 12px",
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        cursor: "pointer",
        border: "1px solid",
        borderColor: view === id ? "rgba(0,229,255,0.5)" : "#13283c",
        borderRadius: 4,
        background: view === id ? "rgba(0,229,255,0.12)" : "transparent",
        color: view === id ? "#00e5ff" : "#5a7a98",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--overview-bg, #05080d)", overflow: "hidden" }}>
      <div style={{
        display: "flex",
        gap: 6,
        padding: "5px 8px",
        background: "var(--overview-header-bg, #070c14)",
        borderBottom: "1px solid var(--overview-border-soft, #0d1f30)",
        flexShrink: 0,
      }}>
        {tabBtn("heatmap", "Heatmap")}
        {tabBtn("table", "Table")}
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "68px repeat(5, 1fr)",
        background: "var(--overview-header-bg, #070c14)",
        borderBottom: "1px solid var(--overview-border-soft, #0d1f30)",
        flexShrink: 0,
        position: "sticky",
        top: 0,
        zIndex: 2,
      }}>
        <div style={{ padding: "5px 8px", fontSize: 9, fontWeight: 700, color: "#ffffff", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          STRIKE
        </div>
        {COLS.map(c => (
          <div key={c.key} style={{ padding: "5px 6px", fontSize: 9, fontWeight: 700, color: "#ffffff", textTransform: "uppercase", letterSpacing: "0.08em", textAlign: "center" }}>
            {c.label}
          </div>
        ))}
      </div>

      <div ref={bodyRef} style={{ flex: 1, overflowY: "auto" }}>
        {rows.map(row => {
          const isATM = row.strike === atm?.strike;
          const rank = rankAbove.get(row.strike) ?? rankBelow.get(row.strike);
          const vals: Record<(typeof COLS)[number]["key"], number | null> = {
            netGEX: row.netGEX,
            netVolGEX: row.netVolGEX,
            netDEX: row.netDEX,
            gexPlusVex: row.gexPlusVex,
            rollingNetGEX: row.rollingNetGEX,
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
                gridTemplateColumns: "68px repeat(5, 1fr)",
                borderBottom: "1px solid #0a1420",
                outline: isATM ? "1.5px solid rgba(0,229,255,0.7)" : "none",
                outlineOffset: isATM ? "-1px" : "0",
                position: "relative",
                zIndex: isATM ? 1 : 0,
                cursor: onStrikeClick ? "pointer" : "default",
              }}
            >
              <div style={{
                padding: "4px 8px",
                fontSize: 11,
                fontWeight: 700,
                fontFamily: "inherit",
                color: isATM ? "#00e5ff" : "#7a9ab8",
                background: isATM ? "#0a2030" : "transparent",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}>
                {row.strike.toLocaleString()}
                {isATM && (
                  <span style={{ fontSize: 7, color: "#00e5ff", background: "#062030", padding: "1px 3px", borderRadius: 2 }}>ATM</span>
                )}
                {rank && (
                  <span style={{ fontSize: 8, fontWeight: 800, color: rankColors[rank], background: `${rankColors[rank]}22`, padding: "0 3px", borderRadius: 2, border: `1px solid ${rankColors[rank]}44` }}>
                    #{rank}
                  </span>
                )}
              </div>

              {COLS.map(c => {
                const v = vals[c.key];
                if (view === "table") {
                  const n = v == null || !Number.isFinite(v) ? 0 : v;
                  const pos = n >= 0;
                  const pct = barPct(c.key, v);
                  return (
                    <div key={c.key} style={{
                      position: "relative",
                      padding: "4px 6px",
                      fontSize: 10,
                      fontFamily: "inherit",
                      textAlign: "center",
                      color: "#ffffff",
                      borderLeft: "1px solid #0a1420",
                      overflow: "hidden",
                    }}>
                      {/* divergent bar grows from the center toward the value's sign */}
                      <div style={{
                        position: "absolute",
                        top: 2,
                        bottom: 2,
                        left: pos ? "50%" : `${50 - pct}%`,
                        width: `${pct}%`,
                        background: pos ? "rgba(38,166,91,0.55)" : "rgba(214,48,49,0.55)",
                        borderRadius: 2,
                      }} />
                      <span style={{ position: "relative", zIndex: 1 }}>{fmtG(v)}</span>
                    </div>
                  );
                }
                const topRank = topRanksByCol[c.key].get(row.strike) ?? 0;
                return (
                  <div key={c.key} style={{
                    padding: "4px 6px",
                    fontSize: 10,
                    fontFamily: "inherit",
                    textAlign: "center",
                    background: cellBg(c.key, v, topRank),
                    color: "#ffffff",
                    fontWeight: topRank > 0 ? 800 : 400,
                  }}>
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
