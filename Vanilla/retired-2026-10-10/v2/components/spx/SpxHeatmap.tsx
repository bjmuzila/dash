"use client";

/**
 * SPX 2-year daily-close heatmap — GitHub-contribution-style calendar for
 * ^GSPC, with three view modes:
 *   - "Daily (2Y)"            full 2-year grid, one cell per trading day
 *   - "Merge Years → 1 Day"   same grid footprint, cells recolored to the
 *                             average of every occurrence of that calendar
 *                             day across all years (nothing reflows)
 *   - "Merge Into Monthly Avg" same grid footprint, each calendar month
 *                             drawn as one solid block (full column height,
 *                             full month width) averaged across all years
 *
 * Data: /api/spx-heatmap, which re-pulls ^GSPC's 2-year daily closes from
 * Yahoo and caches them server-side (see that route). The grid therefore rolls
 * forward on its own every trading day — the bundled SPX_2Y_DAILY snapshot is
 * only the first paint and the fallback for when the route is down. Refetched
 * hourly and whenever the tab returns to the foreground, so a dashboard left
 * open overnight picks up the new session's cell without a reload.
 *
 * Chrome is deliberately minimal: the card is the map. No stat row, no legend,
 * no provenance paragraph — just the view switcher, the grid and the tooltip.
 *
 * Data-viz color note: the red/down and green/up cell intensities are
 * derived from HOME_THEME.red / HOME_THEME.green with alpha modulated by
 * the size of the move — this is a data encoding (not page chrome), so per
 * the theme guidance it's the one place colors aren't a flat HOME_THEME
 * token, but it's still sourced from the theme's own red/green rather than
 * an arbitrary hex scale.
 */

import { useMemo, useState, useCallback, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { SPX_2Y_DAILY, type SpxDailyClose } from "./spxHeatmapData";

/** The series only moves once a trading day; this just guarantees a long-lived
 *  tab rolls over on its own. The route caches upstream, so a miss is cheap. */
const REFRESH_MS = 60 * 60_000;

// Cell/gap are the only size knobs — every other dimension (column height,
// month-block widths, the sticky year gutter) is derived from them, so scaling
// the whole grid is a two-number change. ~1/3 down from the original 13/3.
//
// These are now the DEFAULTS: the component takes a `cell` prop so a caller
// that owns a resizable box (the Options dashboard tile) can redraw the grid at
// whatever size fits, crisply, instead of CSS-scaling a fixed-size render.
const CELL_DEFAULT = 9;
const GAP_DEFAULT = 2;
const DAY_OFFSETS = [1, 2, 3, 4, 5]; // Mon..Fri, relative to each week's Sunday
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Mode = "daily" | "overlay" | "monthly";

type CellEntry = { ret: number; tip: string };

type Week = {
  sunday: Date;
  month: number;
  year: number;
  days: (Date | null)[]; // Mon..Fri, null if outside the data range
};

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildWeeks(first: Date, last: Date): Week[] {
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const weeks: Week[] = [];
  const cursor = new Date(gridStart);
  while (cursor <= last) {
    const days = DAY_OFFSETS.map((dow) => {
      const d = new Date(cursor);
      d.setDate(cursor.getDate() + dow);
      return d > last || d < first ? null : d;
    });
    weeks.push({ sunday: new Date(cursor), month: cursor.getMonth(), year: cursor.getFullYear(), days });
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

// rgba() from a #hex HOME_THEME token — up/down intensity is alpha, not a
// separate hardcoded palette, so it still traces back to HOME_THEME.red/green.
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const FLAT_CELL = "rgba(255,255,255,0.06)";

function levelColor(ret: number, scale = 0.02): string {
  if (Math.abs(ret) < scale * 0.04) return FLAT_CELL;
  const mag = Math.min(Math.abs(ret) / scale, 1);
  const alpha = 0.22 + mag * 0.68;
  return hexToRgba(ret > 0 ? HOME_THEME.green : HOME_THEME.red, alpha);
}

function fmtPct(ret: number): string {
  const sign = ret > 0 ? "+" : "";
  return `${sign}${(ret * 100).toFixed(2)}%`;
}

export default function SpxHeatmap({ cell }: { cell?: number } = {}) {
  // Everything downstream reads CELL/GAP/MONTH_ROW_H, so overriding them here
  // rescales the entire grid — column height, month blocks, the year gutter —
  // with no other change. Gap tightens on small cells so the grid stays a grid
  // rather than dissolving into gaps; the month strip tracks the cell so its
  // labels never crowd the squares.
  const CELL = Math.max(3, Math.round(cell ?? CELL_DEFAULT));
  const GAP = CELL >= 7 ? GAP_DEFAULT : 1;
  const MONTH_ROW_H = Math.max(8, Math.round(CELL * 1.34));
  const uid = useId().replace(/[:]/g, "");
  const [mode, setMode] = useState<Mode>("daily");
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  // null until the route answers — the bundled snapshot paints in the meantime
  // and stays put if the route is unreachable, so the card is never empty.
  const [live, setLive] = useState<SpxDailyClose[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/spx-heatmap", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        const days = Array.isArray(j?.days) ? (j.days as SpxDailyClose[]) : null;
        // Two rows is the minimum the grid math needs (it indexes first/last).
        if (!cancelled && days && days.length > 1) setLive(days);
      } catch {
        /* keep whatever is already on screen */
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    // A tab parked overnight fires no interval the user waits on — refresh the
    // moment it comes back so the newest session's cell is there immediately.
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const data = live ?? SPX_2Y_DAILY;

  // ---- Split into one row per calendar year — a new year automatically
  // gets its own row the moment data for it starts appearing. ----
  const years = useMemo(() => {
    const set = new Set(data.map((d) => d.date.slice(0, 4)));
    return Array.from(set).sort(); // ascending — oldest row on top, newest at bottom
  }, [data]);

  const yearWeeks = useMemo(() => {
    const map = new Map<string, Week[]>();
    years.forEach((y) => {
      const yFirst = new Date(`${y}-01-01T00:00:00`);
      const yLast = new Date(`${y}-12-31T00:00:00`);
      map.set(y, buildWeeks(yFirst, yLast));
    });
    return map;
  }, [years]);

  // ---- Daily entries: one per trading day, unmodified. ----
  const dailyEntries = useMemo(() => {
    const map = new Map<string, CellEntry>();
    data.forEach((rec) => {
      map.set(rec.date, {
        ret: rec.ret,
        tip: `${rec.date}\nClose: ${rec.close.toFixed(2)}\nChange: ${fmtPct(rec.ret)}`,
      });
    });
    return map;
  }, [data]);

  // ---- Overlay entries: same [first,last] footprint, but every date is
  // recolored to the average of all its same month/day occurrences. ----
  const overlayEntries = useMemo(() => {
    const byMD = new Map<string, SpxDailyClose[]>();
    data.forEach((rec) => {
      const md = rec.date.slice(5);
      const arr = byMD.get(md) ?? [];
      arr.push(rec);
      byMD.set(md, arr);
    });
    const map = new Map<string, CellEntry>();
    data.forEach((rec) => {
      const md = rec.date.slice(5);
      const recs = byMD.get(md)!;
      const avgRet = recs.reduce((s, r) => s + r.ret, 0) / recs.length;
      const avgClose = recs.reduce((s, r) => s + r.close, 0) / recs.length;
      const years = recs.map((r) => r.date.slice(0, 4)).join(", ");
      map.set(rec.date, {
        ret: avgRet,
        tip: `${md}\nYears merged: ${years}\nAvg close: ${avgClose.toFixed(2)}\nAvg change: ${fmtPct(avgRet)}`,
      });
    });
    return map;
  }, [data]);

  // ---- Monthly stats: average return/close per calendar month WITHIN each
  // year — keyed "YYYY-MM" so Dec 2024 and Dec 2025 are computed separately. ----
  const monthStats = useMemo(() => {
    const byYearMonth = new Map<string, SpxDailyClose[]>();
    data.forEach((rec) => {
      const key = rec.date.slice(0, 7); // "YYYY-MM"
      const arr = byYearMonth.get(key) ?? [];
      arr.push(rec);
      byYearMonth.set(key, arr);
    });
    const map = new Map<string, { name: string; avgRet: number; avgClose: number }>();
    byYearMonth.forEach((recs, key) => {
      const avgRet = recs.reduce((s, r) => s + r.ret, 0) / recs.length;
      const avgClose = recs.reduce((s, r) => s + r.close, 0) / recs.length;
      const monthIdx = parseInt(key.slice(5, 7), 10) - 1;
      map.set(key, { name: `${MONTH_NAMES[monthIdx]} ${key.slice(0, 4)}`, avgRet, avgClose });
    });
    return map;
  }, [data]);

  // ---- Monthly overlay blocks: merge consecutive weeks sharing a month,
  // computed separately for each year's row. ----
  function buildMonthBlocks(weeks: Week[]) {
    const blocks: { left: number; width: number; ret: number | null; tip: string }[] = [];
    let i = 0;
    while (i < weeks.length) {
      const { month, year } = weeks[i];
      let j = i;
      while (j < weeks.length && weeks[j].month === month && weeks[j].year === year) j++;
      const count = j - i;
      const left = i * (CELL + GAP);
      const width = count * CELL + (count - 1) * GAP;
      const key = `${year}-${String(month + 1).padStart(2, "0")}`;
      const stat = monthStats.get(key);
      blocks.push({
        left,
        width,
        ret: stat ? stat.avgRet : null,
        tip: stat
          ? `${stat.name}\nAvg close: ${stat.avgClose.toFixed(2)}\nAvg daily change: ${fmtPct(stat.avgRet)}`
          : `${MONTH_NAMES[month]} ${year}\nNo data`,
      });
      i = j;
    }
    return blocks;
  }
  // CELL/GAP are in the deps because buildMonthBlocks bakes PIXEL offsets
  // (left/width) into every block. Without them a resize recomputes the cells
  // but reuses stale month-block geometry, and the monthly overlay drifts out
  // of alignment with the grid underneath it.
  const yearMonthBlocks = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildMonthBlocks>>();
    years.forEach((y) => map.set(y, buildMonthBlocks(yearWeeks.get(y)!)));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years, yearWeeks, monthStats, CELL, GAP]);

  const showTooltip = useCallback((e: React.MouseEvent, text: string) => {
    setTooltip({ x: e.clientX, y: e.clientY, text });
  }, []);
  const moveTooltip = useCallback((e: React.MouseEvent) => {
    setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t));
  }, []);
  const hideTooltip = useCallback(() => setTooltip(null), []);

  const entries = mode === "overlay" ? overlayEntries : dailyEntries;
  const colHeight = 5 * CELL + 4 * GAP;

  const scrollClass = `spx-hm-scroll-${uid}`;

  return (
    <div>
      <style>{`
        .${scrollClass} {
          overflow-x: auto;
          overflow-y: hidden;
          padding-bottom: 10px;
          scrollbar-color: rgba(255,255,255,0.18) transparent;
          scrollbar-width: thin;
        }
        .${scrollClass}::-webkit-scrollbar { height: 10px; }
        .${scrollClass}::-webkit-scrollbar-track { background: rgba(255,255,255,0.03); border-radius: 6px; }
        .${scrollClass}::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 6px; border: 2px solid transparent; background-clip: padding-box; }
        .${scrollClass}::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.28); background-clip: padding-box; }
      `}</style>

      {/* Mode switcher */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <ModeButton active={mode === "daily"} onClick={() => setMode("daily")}>
          Daily (2Y)
        </ModeButton>
        <ModeButton active={mode === "overlay"} onClick={() => setMode("overlay")}>
          Merge Years → 1 Day
        </ModeButton>
        <ModeButton active={mode === "monthly"} onClick={() => setMode("monthly")}>
          Merge Into Monthly Avg
        </ModeButton>
      </div>

      {/* Grid — one row per calendar year; a new year automatically gets its own row */}
      <div className={scrollClass}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "max-content" }}>
          {years.map((y) => {
            const weeks = yearWeeks.get(y)!;
            const monthBlocks = yearMonthBlocks.get(y)!;
            return (
              <div key={y} style={{ display: "flex", gap: 8 }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    position: "sticky",
                    left: 0,
                    zIndex: 6,
                    background: HOME_THEME.panel,
                    paddingRight: 8,
                    minWidth: 34,
                  }}
                >
                  <span style={{ height: MONTH_ROW_H, marginBottom: 3 }} />
                  <span
                    style={{
                      height: colHeight,
                      display: "flex",
                      alignItems: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      color: HOME_THEME.text,
                      opacity: 0.75,
                    }}
                  >
                    {y}
                  </span>
                </div>

                <div>
                  {/* Month header row (per-year, since each year's Jan 1 falls on a different weekday) */}
                  <div style={{ display: "flex", gap: GAP, marginBottom: 3, height: MONTH_ROW_H }}>
                    {weeks.map((w, i) => {
                      const showLabel = i === 0 || weeks[i - 1].month !== w.month;
                      return (
                        <div key={i} style={{ minWidth: CELL, flex: `0 0 ${CELL}px`, fontSize: 9, color: HOME_THEME.text, opacity: 0.55, whiteSpace: "nowrap" }}>
                          {showLabel ? MONTH_NAMES[w.month] : ""}
                        </div>
                      );
                    })}
                  </div>

                  {/* Day cells (Daily / Overlay) or invisible spacer + blocks (Monthly) */}
                  <div style={{ position: "relative" }}>
                    <div style={{ display: "flex", gap: GAP, visibility: mode === "monthly" ? "hidden" : "visible" }}>
                      {weeks.map((w, wi) => (
                        <div key={wi} style={{ display: "flex", flexDirection: "column", gap: GAP }}>
                          {w.days.map((d, di) => {
                            if (!d) {
                              return <div key={di} style={{ width: CELL, height: CELL }} />;
                            }
                            const iso = toISO(d);
                            const entry = entries.get(iso);
                            const bg = entry ? levelColor(entry.ret) : "rgba(255,255,255,0.03)";
                            const tip = entry ? entry.tip : `${iso}\nNo data`;
                            return (
                              <div
                                key={di}
                                onMouseEnter={(e) => showTooltip(e, tip)}
                                onMouseMove={moveTooltip}
                                onMouseLeave={hideTooltip}
                                style={{
                                  width: CELL,
                                  height: CELL,
                                  borderRadius: 2,
                                  background: bg,
                                  border: "1px solid rgba(255,255,255,0.03)",
                                  opacity: entry ? 1 : 0.5,
                                }}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>

                    {mode === "monthly" && (
                      <div style={{ position: "absolute", inset: 0 }}>
                        {monthBlocks.map((b, i) => (
                          <div
                            key={i}
                            onMouseEnter={(e) => showTooltip(e, b.tip)}
                            onMouseMove={moveTooltip}
                            onMouseLeave={hideTooltip}
                            style={{
                              position: "absolute",
                              left: b.left,
                              top: 0,
                              width: b.width,
                              height: colHeight,
                              borderRadius: 4,
                              border: "1px solid rgba(255,255,255,0.06)",
                              background: b.ret != null ? levelColor(b.ret, 0.003) : "rgba(255,255,255,0.03)",
                              opacity: b.ret != null ? 1 : 0.5,
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {tooltip && typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: tooltip.x,
              top: tooltip.y,
              transform: "translate(-50%, calc(-100% - 16px))",
              zIndex: 10000,
              background: "#1c2027",
              border: `1px solid ${HOME_THEME.border}`,
              color: HOME_THEME.text,
              padding: "7px 9px",
              borderRadius: 8,
              fontSize: 11,
              whiteSpace: "pre",
              boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
              pointerEvents: "none",
            }}
          >
            {tooltip.text}
          </div>,
          document.body
        )}
    </div>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${active ? "rgba(255,255,255,0.22)" : HOME_THEME.border}`,
        color: active ? HOME_THEME.text : "rgba(255,255,255,0.55)",
        fontSize: 12,
        fontWeight: 500,
        padding: "7px 14px",
        borderRadius: 8,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
