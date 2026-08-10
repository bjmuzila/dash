"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Test Lab → Seasonality.
//
// Two lines on one calendar-day axis:
//   • the average cumulative % path of the E-mini S&P 500 across 2018-2025
//     (the "seasonal" curve — same construction as the published EquityClock
//     chart, computed here from the ES continuous series), and
//   • 2026 so far, re-based to the same 31-Dec-2025 close.
//
// The point of putting them on one axis is the SPREAD: how far ahead of, or
// behind, its own seasonal script this year is running. That number is the
// headline tile, not the two levels.
//
// TWO AXES, ONE SCALE. The left axis and the right axis are the SAME axis in
// two units — right = YTD_BASE_PX × (1 + left/100). Both are drawn off the same
// tick positions, so the ES price on the right is always the literal price that
// corresponds to the % on the left. That is the only honest way to overlay this
// year's PRICE on a seasonal % curve: an independently auto-scaled second axis
// would let the two lines cross wherever the scaling happened to put them and
// the crossings would mean nothing.
//
// The mode toggle only picks which unit is primary — % on the left with price
// on the right, or price on the left with % on the right. The lines do not move
// between modes; only the labels swap. In price mode the seasonal curve reads
// as the path projected forward off the 2025 close.
//
// Everything is drawn as hand-rolled SVG. No chart dependency, no canvas, and
// no color that is not from HOME_THEME.
//
// HYDRATION: chart width starts at 0 on BOTH sides and is filled in by a
// ResizeObserver after mount, so the server and the first client paint agree.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import {
  SEASONAL_AVG,
  SEASONAL_BASE_YEARS,
  SEASONAL_YEAR_COUNT,
  SEASONAL_YEAR_RETURNS,
  YTD_2026_PCT,
  YTD_2026_PX,
  YTD_BASE_PX,
  YTD_LAST_DATE,
} from "./seasonalityData";

type Mode = "pct" | "price";

const SEASON_COLOR = HOME_THEME.green;   // #8ECAE6 — the average, the backdrop
const YEAR_COLOR = HOME_THEME.orange;    // #FB8501 — this year, the subject

// Day-of-year index (0-based) of the 1st of each month, non-leap. 2026 is not a
// leap year, so this doubles as the calendar map for the live series.
const MONTHS = [
  { label: "Jan", day: 0 },
  { label: "Feb", day: 31 },
  { label: "Mar", day: 59 },
  { label: "Apr", day: 90 },
  { label: "May", day: 120 },
  { label: "Jun", day: 151 },
  { label: "Jul", day: 181 },
  { label: "Aug", day: 212 },
  { label: "Sep", day: 243 },
  { label: "Oct", day: 273 },
  { label: "Nov", day: 304 },
  { label: "Dec", day: 334 },
];

const N = SEASONAL_AVG.length;          // 365
const LIVE = YTD_2026_PCT.length;       // days of 2026 we actually have

const PAD = { top: 18, right: 82, bottom: 30, left: 62 };
const CHART_H = 430;

const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const fmtPx = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The two units of the one axis. Right = base × (1 + left/100), and back. */
const pctToPx = (p: number) => YTD_BASE_PX * (1 + p / 100);
const pxToPct = (v: number) => (v / YTD_BASE_PX - 1) * 100;

function dayLabel(idx: number) {
  const d = new Date(Date.UTC(2026, 0, idx + 1));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Nice" axis ticks — at most `count`, on a 1/2/2.5/5 × 10ⁿ step. */
function niceTicks(min: number, max: number, count = 6): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm > 5 ? 10 : norm > 2.5 ? 5 : norm > 2 ? 2.5 : norm > 1 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-6; t += step) {
    out.push(Math.abs(t) < step * 1e-6 ? 0 : t);
  }
  return out;
}

function StatTile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        flex: "1 1 150px",
        minWidth: 140,
        padding: "12px 14px",
        borderRadius: 10,
        border: `1px solid ${HOME_THEME.border}`,
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          opacity: 0.55,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          marginTop: 4,
          fontVariantNumeric: "tabular-nums",
          color: color ?? HOME_THEME.text,
        }}
      >
        {value}
      </div>
      {sub ? (
        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{sub}</div>
      ) : null}
    </div>
  );
}

export default function SeasonalityTab() {
  const [mode, setMode] = useState<Mode>("pct");
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // The seasonal curve, in whichever unit the chart is currently showing.
  const seasonSeries = useMemo(
    () => (mode === "pct" ? SEASONAL_AVG : SEASONAL_AVG.map((p) => YTD_BASE_PX * (1 + p / 100))),
    [mode],
  );
  const yearSeries = mode === "pct" ? YTD_2026_PCT : YTD_2026_PX;

  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = CHART_H - PAD.top - PAD.bottom;

  const { yMin, yMax } = useMemo(() => {
    const all = [...seasonSeries, ...yearSeries];
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad;
    hi += pad;
    if (mode === "pct") {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    return { yMin: lo, yMax: hi };
  }, [seasonSeries, yearSeries, mode]);

  const x = (i: number) => PAD.left + (innerW * i) / (N - 1);
  const y = (v: number) => PAD.top + innerH - (innerH * (v - yMin)) / (yMax - yMin);

  const path = (arr: number[]) =>
    arr.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");

  const seasonPath = useMemo(
    () => (innerW > 0 ? path(seasonSeries) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seasonSeries, innerW, yMin, yMax],
  );
  const yearPath = useMemo(
    () => (innerW > 0 ? path(yearSeries) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [yearSeries, innerW, yMin, yMax],
  );

  const ticks = useMemo(() => niceTicks(yMin, yMax, 6), [yMin, yMax]);

  // Headline numbers, all measured at the last session we have.
  const last = LIVE - 1;
  const ytdPct = YTD_2026_PCT[last];
  const seasonToDate = SEASONAL_AVG[last];
  const spread = ytdPct - seasonToDate;
  const seasonFull = SEASONAL_AVG[N - 1];
  const seasonRemaining = seasonFull - seasonToDate;

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (innerW <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.left;
    const i = Math.round((px / innerW) * (N - 1));
    setHover(i < 0 ? 0 : i > N - 1 ? N - 1 : i);
  };

  const hYear = hover != null && hover < LIVE ? yearSeries[hover] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card
        title="S&P 500 Seasonality vs 2026"
        subtitle={`E-mini futures · ${SEASONAL_YEAR_COUNT}-year average (${SEASONAL_BASE_YEARS}) · 2026 through ${dayLabel(last)}`}
        padding={20}
      >
        {/* Controls + legend */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            {([
              { k: "pct" as Mode, label: "% Return" },
              { k: "price" as Mode, label: "ES Price" },
            ]).map((m) => {
              const on = mode === m.k;
              return (
                <button
                  key={m.k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setMode(m.k)}
                  style={{
                    padding: "7px 16px",
                    borderRadius: 8,
                    border: `1px solid ${on ? HOME_THEME.cyan : HOME_THEME.border}`,
                    background: on
                      ? `linear-gradient(180deg, ${HOME_THEME.cyan}33, ${HOME_THEME.cyan}0D)`
                      : "rgba(255,255,255,0.04)",
                    color: on ? HOME_THEME.cyan : HOME_THEME.text,
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 18, fontSize: 12, fontWeight: 700 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 22, height: 2, background: SEASON_COLOR, display: "inline-block" }} />
              Seasonal avg ({SEASONAL_BASE_YEARS})
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 22, height: 2, background: YEAR_COLOR, display: "inline-block" }} />
              2026 {mode === "pct" ? "(ES price on right axis)" : "(% on right axis)"}
            </span>
          </div>
        </div>

        {/* Chart */}
        <div ref={wrapRef} style={{ width: "100%" }}>
          {innerW > 0 ? (
            <svg
              width={width}
              height={CHART_H}
              role="img"
              aria-label="E-mini S&P 500 seasonality versus 2026 year to date"
              style={{ display: "block", touchAction: "none" }}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            >
              {/* horizontal grid + y labels */}
              {ticks.map((t) => (
                <g key={`y${t}`}>
                  <line
                    x1={PAD.left}
                    x2={PAD.left + innerW}
                    y1={y(t)}
                    y2={y(t)}
                    stroke={t === 0 && mode === "pct" ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.07)"}
                    strokeWidth={1}
                  />
                  <text
                    x={PAD.left - 8}
                    y={y(t) + 4}
                    textAnchor="end"
                    fontSize={11}
                    fill={HOME_THEME.text}
                    opacity={0.55}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {mode === "pct" ? `${t.toFixed(1)}%` : Math.round(t).toLocaleString("en-US")}
                  </text>
                  {/* Same tick, the other unit. This is what makes the 2026
                      PRICE readable straight off a seasonal % chart. */}
                  <text
                    x={PAD.left + innerW + 8}
                    y={y(t) + 4}
                    textAnchor="start"
                    fontSize={11}
                    fill={YEAR_COLOR}
                    opacity={0.7}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {mode === "pct"
                      ? Math.round(pctToPx(t)).toLocaleString("en-US")
                      : `${pxToPct(t).toFixed(1)}%`}
                  </text>
                </g>
              ))}

              {/* month gridlines + labels */}
              {MONTHS.map((m) => (
                <g key={m.label}>
                  <line
                    x1={x(m.day)}
                    x2={x(m.day)}
                    y1={PAD.top}
                    y2={PAD.top + innerH}
                    stroke="rgba(255,255,255,0.07)"
                    strokeDasharray="3 4"
                  />
                  <text
                    x={x(m.day) + 4}
                    y={CHART_H - 10}
                    fontSize={11}
                    fontWeight={700}
                    fill={HOME_THEME.text}
                    opacity={0.5}
                  >
                    {m.label}
                  </text>
                </g>
              ))}

              {/* the part of the year 2026 has not reached yet */}
              <rect
                x={x(LIVE - 1)}
                y={PAD.top}
                width={Math.max(0, PAD.left + innerW - x(LIVE - 1))}
                height={innerH}
                fill="rgba(255,255,255,0.025)"
              />

              <path d={seasonPath} fill="none" stroke={SEASON_COLOR} strokeWidth={2} opacity={0.85} />
              <path
                d={yearPath}
                fill="none"
                stroke={YEAR_COLOR}
                strokeWidth={2.4}
                strokeLinejoin="round"
              />

              {/* end-of-2026 marker */}
              <circle cx={x(last)} cy={y(yearSeries[last])} r={4} fill={YEAR_COLOR} />

              {/* crosshair */}
              {hover != null ? (
                <g>
                  <line
                    x1={x(hover)}
                    x2={x(hover)}
                    y1={PAD.top}
                    y2={PAD.top + innerH}
                    stroke="rgba(255,255,255,0.35)"
                  />
                  <circle cx={x(hover)} cy={y(seasonSeries[hover])} r={3.5} fill={SEASON_COLOR} />
                  {hYear != null ? (
                    <circle cx={x(hover)} cy={y(hYear)} r={3.5} fill={YEAR_COLOR} />
                  ) : null}
                </g>
              ) : null}
            </svg>
          ) : (
            <div style={{ height: CHART_H }} />
          )}
        </div>

        {/* Readout — fixed height so the chart does not jump on hover */}
        <div
          style={{
            marginTop: 10,
            minHeight: 22,
            display: "flex",
            gap: 20,
            flexWrap: "wrap",
            fontSize: 12,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {hover != null ? (
            <>
              <span style={{ fontWeight: 800, opacity: 0.75 }}>{dayLabel(hover)}</span>
              <span style={{ color: SEASON_COLOR }}>
                Seasonal {fmtPct(SEASONAL_AVG[hover])} · {fmtPx(pctToPx(SEASONAL_AVG[hover]))}
              </span>
              <span style={{ color: YEAR_COLOR }}>
                2026{" "}
                {hover < LIVE
                  ? `${fmtPct(YTD_2026_PCT[hover])} · ES ${fmtPx(YTD_2026_PX[hover])}`
                  : "—"}
              </span>
              {hover < LIVE ? (
                <span style={{ opacity: 0.75 }}>
                  Spread {fmtPct(YTD_2026_PCT[hover] - SEASONAL_AVG[hover])} ·{" "}
                  {`${YTD_2026_PCT[hover] - SEASONAL_AVG[hover] >= 0 ? "+" : ""}${Math.round(
                    ((YTD_2026_PCT[hover] - SEASONAL_AVG[hover]) / 100) * YTD_BASE_PX,
                  )} pts`}
                </span>
              ) : null}
            </>
          ) : (
            <span style={{ opacity: 0.35 }}>Hover the chart for any calendar day.</span>
          )}
        </div>
      </Card>

      <Card title="Where 2026 Stands" padding={20}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <StatTile
            label="2026 YTD"
            value={fmtPct(ytdPct)}
            sub={`ES ${fmtPx(YTD_2026_PX[last])}`}
            color={YEAR_COLOR}
          />
          <StatTile
            label="Seasonal to date"
            value={fmtPct(seasonToDate)}
            sub={`avg of ${SEASONAL_YEAR_COUNT} years`}
            color={SEASON_COLOR}
          />
          <StatTile
            label={spread >= 0 ? "Ahead of season" : "Behind season"}
            value={fmtPct(spread)}
            sub={`${spread >= 0 ? "+" : ""}${Math.round((spread / 100) * YTD_BASE_PX)} ES pts`}
            color={spread >= 0 ? HOME_THEME.cyan : HOME_THEME.red}
          />
          <StatTile
            label="Seasonal left in year"
            value={fmtPct(seasonRemaining)}
            sub={`full year avg ${fmtPct(seasonFull)}`}
          />
          <StatTile
            label="Base"
            value={fmtPx(YTD_BASE_PX)}
            sub="2025 year-end ES close"
          />
        </div>

        <div
          style={{
            marginTop: 18,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {Object.entries(SEASONAL_YEAR_RETURNS).map(([yr, ret]) => (
            <div
              key={yr}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: `1px solid ${HOME_THEME.border}`,
                background: "rgba(255,255,255,0.03)",
                fontSize: 12,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ opacity: 0.55, marginRight: 8 }}>{yr}</span>
              <span style={{ color: ret >= 0 ? HOME_THEME.cyan : HOME_THEME.red }}>{fmtPct(ret)}</span>
            </div>
          ))}
        </div>

        <p style={{ marginTop: 16, fontSize: 12, lineHeight: 1.6, opacity: 0.55, maxWidth: 900 }}>
          Each of the {SEASONAL_YEAR_COUNT} sample years is re-based to its prior 31-Dec close, laid on a
          calendar-day axis and averaged — the same construction as the published 20-year
          seasonality curve, run on the ES continuous series instead of the cash index. The
          average full year here finishes at {fmtPct(seasonFull)} against +10.4% for the
          20-year study, so the amplitude is in the right place; the turning points (the
          February push, the March give-back, the September fade into an October low, the
          November–December run) are what the chart is for. 2026 data runs through{" "}
          {YTD_LAST_DATE}; the shaded band is the part of the year still ahead.
        </p>
      </Card>
    </div>
  );
}
