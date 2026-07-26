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
 * Data-viz color note: the red/down and green/up cell intensities are
 * derived from HOME_THEME.red / HOME_THEME.green with alpha modulated by
 * the size of the move — this is a data encoding (not page chrome), so per
 * the theme guidance it's the one place colors aren't a flat HOME_THEME
 * token, but it's still sourced from the theme's own red/green rather than
 * an arbitrary hex scale.
 */

import { useMemo, useState, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { SPX_2Y_DAILY, SPX_2Y_AVERAGE_CLOSE, type SpxDailyClose } from "./spxHeatmapData";

const CELL = 13;
const GAP = 3;
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

export default function SpxHeatmap() {
  const uid = useId().replace(/[:]/g, "");
  const [mode, setMode] = useState<Mode>("daily");
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  const data = SPX_2Y_DAILY;

  const first = useMemo(() => new Date(`${data[0].date}T00:00:00`), [data]);
  const last = useMemo(() => new Date(`${data[data.length - 1].date}T00:00:00`), [data]);
  const weeks = useMemo(() => buildWeeks(first, last), [first, last]);

  const stats = useMemo(() => {
    const closes = data.map((d) => d.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const totalRet = ((data[data.length - 1].close - data[0].close) / data[0].close) * 100;
    const best = data.reduce((a, b) => (b.ret > a.ret ? b : a), data[0]);
    const worst = data.reduce((a, b) => (b.ret < a.ret ? b : a), data[0]);
    return { min, max, totalRet, best, worst, start: data[0].close, end: data[data.length - 1].close };
  }, [data]);

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

  // ---- Monthly stats: average return/close per calendar month across all years. ----
  const monthStats = useMemo(() => {
    const byMonth: SpxDailyClose[][] = Array.from({ length: 12 }, () => []);
    data.forEach((rec) => byMonth[parseInt(rec.date.slice(5, 7), 10) - 1].push(rec));
    return byMonth.map((recs, i) => {
      if (!recs.length) return null;
      const avgRet = recs.reduce((s, r) => s + r.ret, 0) / recs.length;
      const avgClose = recs.reduce((s, r) => s + r.close, 0) / recs.length;
      const years = [...new Set(recs.map((r) => r.date.slice(0, 4)))].join(", ");
      return { name: MONTH_NAMES[i], avgRet, avgClose, years };
    });
  }, [data]);

  // ---- Monthly overlay blocks: merge consecutive weeks sharing a month. ----
  const monthBlocks = useMemo(() => {
    const blocks: { left: number; width: number; ret: number | null; tip: string }[] = [];
    let i = 0;
    while (i < weeks.length) {
      const { month, year } = weeks[i];
      let j = i;
      while (j < weeks.length && weeks[j].month === month && weeks[j].year === year) j++;
      const count = j - i;
      const left = i * (CELL + GAP);
      const width = count * CELL + (count - 1) * GAP;
      const stat = monthStats[month];
      blocks.push({
        left,
        width,
        ret: stat ? stat.avgRet : null,
        tip: stat
          ? `${stat.name}\nYears merged: ${stat.years}\nAvg close: ${stat.avgClose.toFixed(2)}\nAvg daily change: ${fmtPct(stat.avgRet)}`
          : `${MONTH_NAMES[month]}\nNo data`,
      });
      i = j;
    }
    return blocks;
  }, [weeks, monthStats]);

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

      {/* Stat row */}
      <div style={{ display: "flex", gap: 28, marginBottom: 20, flexWrap: "wrap" }}>
        <Stat label="2-year average close" value={SPX_2Y_AVERAGE_CLOSE.toFixed(2)} />
        <Stat label="Range" value={`${stats.min.toFixed(2)} – ${stats.max.toFixed(2)}`} />
        <Stat label="Start → End" value={`${stats.start.toFixed(2)} → ${stats.end.toFixed(2)}`} />
        <Stat
          label="2-year change"
          value={`${stats.totalRet >= 0 ? "+" : ""}${stats.totalRet.toFixed(1)}%`}
          color={stats.totalRet >= 0 ? HOME_THEME.green : HOME_THEME.red}
        />
        <Stat label="Best day" value={`${stats.best.date} ${fmtPct(stats.best.ret)}`} color={HOME_THEME.green} />
        <Stat label="Worst day" value={`${stats.worst.date} ${fmtPct(stats.worst.ret)}`} color={HOME_THEME.red} />
      </div>

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

      {/* Grid */}
      <div className={scrollClass}>
        <div style={{ display: "flex", gap: 10, width: "max-content" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: GAP,
              paddingTop: 20,
              position: "sticky",
              left: 0,
              zIndex: 6,
              background: HOME_THEME.panel,
              paddingRight: 8,
            }}
          >
            {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => (
              <span key={d} style={{ height: CELL, display: "flex", alignItems: "center", fontSize: 9.5, color: HOME_THEME.text, opacity: 0.55, lineHeight: `${CELL}px` }}>
                {d}
              </span>
            ))}
          </div>

          <div>
            {/* Month header row */}
            <div style={{ display: "flex", gap: GAP, marginBottom: 4, height: 14 }}>
              {weeks.map((w, i) => {
                const showLabel = i === 0 || weeks[i - 1].month !== w.month;
                return (
                  <div key={i} style={{ minWidth: CELL, flex: `0 0 ${CELL}px`, fontSize: 10, color: HOME_THEME.text, opacity: 0.55, whiteSpace: "nowrap" }}>
                    {showLabel ? `${MONTH_NAMES[w.month]}${w.month === 0 ? ` '${String(w.year).slice(2)}` : ""}` : ""}
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
                      const tip = entry ? entry.tip : `${iso}\nMarket closed`;
                      return (
                        <div
                          key={di}
                          onMouseEnter={(e) => showTooltip(e, tip)}
                          onMouseMove={moveTooltip}
                          onMouseLeave={hideTooltip}
                          style={{
                            width: CELL,
                            height: CELL,
                            borderRadius: 3,
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
      </div>

      {/* Legend */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20, fontSize: 11, color: HOME_THEME.text, opacity: 0.7 }}>
        <span>Less</span>
        <div style={{ display: "flex", gap: 3 }}>
          {[0.9, 0.4, 0, -0.4, -0.9].map((v, i) => (
            <div
              key={i}
              style={{
                width: CELL,
                height: CELL,
                borderRadius: 3,
                border: "1px solid rgba(255,255,255,0.04)",
                background: v === 0 ? FLAT_CELL : hexToRgba(v > 0 ? HOME_THEME.green : HOME_THEME.red, Math.abs(v)),
              }}
            />
          ))}
        </div>
        <span>More</span>
        <span style={{ marginLeft: 10 }}>
          {mode === "monthly"
            ? "(one solid block = average of that calendar month across all years)"
            : "(red = down day, green = up day, intensity = magnitude)"}
        </span>
      </div>

      {/* Provenance note */}
      <div style={{ marginTop: 18, fontSize: 11.5, color: HOME_THEME.text, opacity: 0.6, lineHeight: 1.5, borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 14 }}>
        Pulled live from Yahoo Finance&apos;s historical data table for ^GSPC (Jul 25, 2024 → Jul 24, 2026), read directly in-browser since Yahoo&apos;s API/CSV endpoints block automated fetches. All 501 trading days, real closes. &quot;Merge Years → 1 Day&quot; averages every occurrence of the same calendar day into one cell without changing the grid size. &quot;Merge Into Monthly Avg&quot; collapses each month into one solid block, averaged across every year in range.
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

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.7 }}>
      {label}
      <div style={{ fontSize: 17, fontWeight: 600, color: color ?? HOME_THEME.text, opacity: 1, marginTop: 2 }}>{value}</div>
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
