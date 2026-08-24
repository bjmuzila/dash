"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Test Lab → Seasonality → the almanac half.
//
// Everything below the seasonal-overlay chart. All of it is precomputed at build
// time into ALMANAC (see seasonalityData.ts) from the ^GSPC daily closes back to
// 1927-12-30 — there is no fetch, no API route and no socket subscription here.
// The tab is pure static data plus SVG, which is why it renders instantly and
// works with the backend down.
//
// WHY EVERY TABLE PRINTS ITS SAMPLE SIZE. A monthly mean built from 98
// observations carries a standard error near 0.6pp, so most month-to-month
// differences on this page are not distinguishable from each other. The `n`
// column is the honest part of a seasonality table and it is never optional.
//
// COLOR. Return sign uses the app's candle pair (ES_CANDLE_UP / ES_CANDLE_DOWN),
// not HOME_THEME.green/red — those are the UI status palette. Every bar is drawn
// from a zero baseline, so direction carries the sign as well as the hue; no
// reading here depends on telling green from red.
//
// HYDRATION: every chart's width starts at 0 on BOTH sides and is filled in by a
// ResizeObserver after mount, so the server and the first client paint agree.
// Same rule as the overlay chart above it.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { HOME_THEME, ES_CANDLE_UP, ES_CANDLE_DOWN } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { ALMANAC, ERA_KEYS } from "./seasonalityData";

const UP = ES_CANDLE_UP;
const DOWN = ES_CANDLE_DOWN;
const A1 = HOME_THEME.cyan;    // "all history" series
const A2 = HOME_THEME.orange;  // "modern era" series

const pct = (v: number | null | undefined, d = 2) =>
  v == null ? "—" : `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 100).toFixed(d)}%`;
const pctp = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const bp = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 10000).toFixed(d)} bp`;
const signColor = (v: number | null | undefined) =>
  v == null ? HOME_THEME.text : v >= 0 ? UP : DOWN;

/** Width of a chart box, measured after mount. 0 until then. */
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** "Nice" axis ticks — at most `count`, on a 1/2/2.5/5 × 10ⁿ step. */
function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm > 5 ? 10 : norm > 2.5 ? 5 : norm > 2 ? 2.5 : norm > 1 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) {
    out.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  }
  return out;
}

/**
 * A bar anchored to the zero baseline, rounded only on the data end.
 * `up` decides which pair of corners is rounded — that is the whole point of
 * hand-rolling this instead of using <rect rx>: a rounded bottom on a positive
 * bar detaches it from the axis it is measured against.
 */
function barPath(x: number, w: number, yTop: number, h: number, up: boolean) {
  const hh = Math.max(h, 0.6);
  const r = Math.min(4, w / 2, hh);
  const yb = yTop + hh;
  return up
    ? `M${x},${yb} L${x},${yTop + r} Q${x},${yTop} ${x + r},${yTop} L${x + w - r},${yTop} Q${x + w},${yTop} ${x + w},${yTop + r} L${x + w},${yb} Z`
    : `M${x},${yTop} L${x},${yb - r} Q${x},${yb} ${x + r},${yb} L${x + w - r},${yb} Q${x + w},${yb} ${x + w},${yb - r} L${x + w},${yTop} Z`;
}

// ── controls ────────────────────────────────────────────────────────────────

function Pills<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { k: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
      {label ? (
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            opacity: 0.5,
            marginRight: 2,
          }}
        >
          {label}
        </span>
      ) : null}
      {options.map((o) => {
        const on = o.k === value;
        return (
          <button
            key={o.k}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.k)}
            style={{
              padding: "6px 13px",
              borderRadius: 8,
              border: `1px solid ${on ? HOME_THEME.cyan : HOME_THEME.border}`,
              background: on
                ? `linear-gradient(180deg, ${HOME_THEME.cyan}33, ${HOME_THEME.cyan}0D)`
                : "rgba(255,255,255,0.04)",
              color: on ? HOME_THEME.cyan : HOME_THEME.text,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, fontWeight: 700, marginBottom: 12 }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: i.color, display: "inline-block" }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ── charts ──────────────────────────────────────────────────────────────────

/** One series, colored by sign, drawn off a zero baseline. */
function DivBars({
  labels,
  values,
  fmt,
  readout,
  height = 240,
  showValues = true,
}: {
  labels: string[];
  values: number[];
  fmt: (v: number) => string;
  readout: (i: number) => string;
  height?: number;
  showValues?: boolean;
}) {
  const [ref, width] = useMeasuredWidth();
  const [hover, setHover] = useState<number | null>(null);
  const PAD = { top: 20, right: 10, bottom: 28, left: 58 };
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;

  const { lo, hi } = useMemo(() => {
    let l = Math.min(0, ...values);
    let h = Math.max(0, ...values);
    const p = (h - l) * 0.16 || 1;
    return { lo: l - p, hi: h + p };
  }, [values]);

  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH;
  const ticks = niceTicks(lo, hi, 5);
  const bw = values.length ? innerW / values.length : 0;
  const gap = Math.min(10, bw * 0.3);

  return (
    <div ref={ref} style={{ width: "100%" }}>
      {innerW > 0 ? (
        <>
          <svg
            width={width}
            height={height}
            role="img"
            style={{ display: "block", touchAction: "none" }}
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={`t${t}`}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + innerW}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 0 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.07)"}
                />
                <text
                  x={PAD.left - 8}
                  y={y(t) + 4}
                  textAnchor="end"
                  fontSize={10}
                  fill={HOME_THEME.text}
                  opacity={0.5}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {fmt(t)}
                </text>
              </g>
            ))}
            {values.map((v, i) => {
              const x = PAD.left + i * bw + gap / 2;
              const w = bw - gap;
              const up = v >= 0;
              return (
                <g key={labels[i]} onPointerEnter={() => setHover(i)}>
                  <rect x={PAD.left + i * bw} y={PAD.top} width={bw} height={innerH} fill="transparent" />
                  <path
                    d={barPath(x, w, up ? y(v) : y(0), Math.abs(y(v) - y(0)), up)}
                    fill={up ? UP : DOWN}
                    opacity={hover == null || hover === i ? 1 : 0.55}
                  />
                  {showValues ? (
                    <text
                      x={x + w / 2}
                      y={up ? y(v) - 6 : y(v) + 13}
                      textAnchor="middle"
                      fontSize={9.5}
                      fill={HOME_THEME.text}
                      opacity={0.7}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {fmt(v)}
                    </text>
                  ) : null}
                  <text
                    x={x + w / 2}
                    y={height - 9}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill={HOME_THEME.text}
                    opacity={0.5}
                  >
                    {labels[i]}
                  </text>
                </g>
              );
            })}
          </svg>
          <div style={{ minHeight: 20, fontSize: 12, fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>
            {hover != null ? readout(hover) : <span style={{ opacity: 0.4 }}>Hover a bar for the detail.</span>}
          </div>
        </>
      ) : (
        <div style={{ height: height + 20 }} />
      )}
    </div>
  );
}

/** Two series side by side, one color each (identity, not sign). */
function PairBars({
  labels,
  a,
  b,
  colors,
  fmt,
  readout,
  height = 260,
  labelEvery = 1,
}: {
  labels: string[];
  a: number[];
  b: number[];
  colors: [string, string];
  fmt: (v: number) => string;
  readout: (i: number) => string;
  height?: number;
  labelEvery?: number;
}) {
  const [ref, width] = useMeasuredWidth();
  const [hover, setHover] = useState<number | null>(null);
  const PAD = { top: 18, right: 10, bottom: 28, left: 58 };
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;

  const { lo, hi } = useMemo(() => {
    const all = [...a, ...b];
    let l = Math.min(0, ...all);
    let h = Math.max(0, ...all);
    const p = (h - l) * 0.14 || 1;
    return { lo: l - p, hi: h + p };
  }, [a, b]);

  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH;
  const ticks = niceTicks(lo, hi, 5);
  const gw = labels.length ? innerW / labels.length : 0;
  const inner = gw * 0.78;
  const bw = Math.max(1, (inner - 2) / 2);

  return (
    <div ref={ref} style={{ width: "100%" }}>
      {innerW > 0 ? (
        <>
          <svg
            width={width}
            height={height}
            role="img"
            style={{ display: "block", touchAction: "none" }}
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={`t${t}`}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + innerW}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 0 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.07)"}
                />
                <text
                  x={PAD.left - 8}
                  y={y(t) + 4}
                  textAnchor="end"
                  fontSize={10}
                  fill={HOME_THEME.text}
                  opacity={0.5}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {fmt(t)}
                </text>
              </g>
            ))}
            {labels.map((lab, i) => (
              <g key={lab} onPointerEnter={() => setHover(i)}>
                <rect x={PAD.left + i * gw} y={PAD.top} width={gw} height={innerH} fill="transparent" />
                {[a[i], b[i]].map((v, k) => {
                  const x = PAD.left + i * gw + (gw - inner) / 2 + k * (bw + 2);
                  const up = v >= 0;
                  return (
                    <path
                      key={k}
                      d={barPath(x, bw, up ? y(v) : y(0), Math.abs(y(v) - y(0)), up)}
                      fill={colors[k]}
                      opacity={hover == null || hover === i ? 1 : 0.5}
                    />
                  );
                })}
                {i % labelEvery === 0 ? (
                  <text
                    x={PAD.left + i * gw + gw / 2}
                    y={height - 9}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill={HOME_THEME.text}
                    opacity={0.5}
                  >
                    {lab}
                  </text>
                ) : null}
              </g>
            ))}
          </svg>
          <div style={{ minHeight: 20, fontSize: 12, fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>
            {hover != null ? readout(hover) : <span style={{ opacity: 0.4 }}>Hover a group for the detail.</span>}
          </div>
        </>
      ) : (
        <div style={{ height: height + 20 }} />
      )}
    </div>
  );
}

// ── tables ──────────────────────────────────────────────────────────────────

type Cell = { t: string; c?: string } | string | number;

function DataTable({ head, rows }: { head: string[]; rows: Cell[][] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          fontSize: 12.5,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <thead>
          <tr>
            {/* keyed by position, not label — the barometer table repeats
                "Mean year after" / "Positive" for the up and down halves. */}
            {head.map((h, i) => (
              <th
                key={`${i}-${h}`}
                style={{
                  textAlign: i === 0 ? "left" : "right",
                  padding: "9px 12px",
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  opacity: 0.5,
                  whiteSpace: "nowrap",
                  borderBottom: `1px solid ${HOME_THEME.border}`,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => {
                const isObj = typeof c === "object" && c !== null;
                return (
                  <td
                    key={ci}
                    style={{
                      textAlign: ci === 0 ? "left" : "right",
                      padding: "7px 12px",
                      whiteSpace: "nowrap",
                      opacity: ci === 0 ? 0.75 : 1,
                      color: isObj && (c as { c?: string }).c ? (c as { c?: string }).c : HOME_THEME.text,
                      borderBottom: ri === rows.length - 1 ? "none" : "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    {isObj ? (c as { t: string }).t : String(c)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Blend two #rrggbb values. Used for the heatmap ramp: a neutral cell color
 *  toward the up/down hue, so a zero cell reads as "no signal" rather than as a
 *  washed-out version of one of the two directions. */
function mixHex(from: string, to: string, t: number) {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = parse(from);
  const b = parse(to);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}

function HeatTable({
  cols,
  rows,
  data,
  scale,
  rowLabel,
  maxHeight,
}: {
  cols: string[];
  rows: (string | number)[];
  data: (number | null)[][];
  scale: number;
  rowLabel: (r: string | number) => string;
  maxHeight?: number;
}) {
  return (
    <div style={{ overflow: "auto", maxHeight }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 2, fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr>
            <th />
            {cols.map((c) => (
              <th
                key={c}
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  opacity: 0.5,
                  padding: "3px 4px",
                  position: "sticky",
                  top: 0,
                  background: HOME_THEME.panel,
                  zIndex: 1,
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r)}>
              <th
                style={{
                  textAlign: "right",
                  paddingRight: 8,
                  fontSize: 10,
                  fontWeight: 700,
                  opacity: 0.5,
                  whiteSpace: "nowrap",
                }}
              >
                {rowLabel(r)}
              </th>
              {data[i].map((v, j) => (
                <td
                  key={j}
                  title={v == null ? "" : `${cols[j]} ${rowLabel(r)} · ${pct(v)}`}
                  style={{
                    width: 42,
                    height: 21,
                    textAlign: "center",
                    borderRadius: 3,
                    background:
                      v == null
                        ? "transparent"
                        : mixHex("#1b2028", v >= 0 ? UP : DOWN, Math.pow(Math.min(1, Math.abs(v) / scale), 0.72)),
                  }}
                >
                  {v == null ? "" : (v * 100).toFixed(1)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tile({ label, value, sub, color }: { label: string; value: ReactNode; sub?: string; color?: string }) {
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
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.55 }}>
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
      {sub ? <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

const NOTE: CSSProperties = {
  marginTop: 14,
  fontSize: 12,
  lineHeight: 1.6,
  opacity: 0.55,
  maxWidth: 900,
};

// ── the almanac ─────────────────────────────────────────────────────────────

export default function SeasonalityAlmanac() {
  const A = ALMANAC;
  const M = A.months;
  const [era, setEra] = useState<string>(ERA_KEYS[0]);
  const [dowEra, setDowEra] = useState<string>(ERA_KEYS[0]);

  const eraOptions = ERA_KEYS.map((k) => ({ k, label: k }));
  const mt = A.monthTables[era] ?? A.monthTables[ERA_KEYS[0]];
  const dw = A.dow[dowEra] ?? A.dow[ERA_KEYS[0]];

  const now = A.now;
  const royAll = now.rest_of_year[0];
  const royMod = now.rest_of_year[1];
  const win = now.window[0];

  const sm = A.sixMonth;
  const smOrder = [sm.index.indexOf("Nov-Apr"), sm.index.indexOf("May-Oct")].filter((i) => i >= 0);

  return (
    <>
      {/* ── where the calendar stands ─────────────────────────────────────── */}
      <Card
        title="Where the Calendar Stands"
        subtitle={`Last close ${now.as_of} · session ${now.trading_day_of_year} of the trading year`}
        padding={20}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Tile
            label="Rest of year · mean"
            value={pct(royMod.avg)}
            sub={`since 1985 · n=${royMod.n}`}
            color={signColor(royMod.avg)}
          />
          <Tile
            label="Rest of year · positive"
            value={pctp(royMod.pos_pct, 0)}
            sub={`${Math.round(royMod.pos_pct * royMod.n)} of ${royMod.n} years`}
          />
          <Tile
            label={win.window}
            value={pct(win.avg)}
            sub={`all history · n=${win.n} · ${pctp(win.pos_pct, 0)} positive`}
            color={signColor(win.avg)}
          />
          <Tile label="Worst rest-of-year" value={pct(royAll.worst)} sub={`all history · n=${royAll.n}`} color={DOWN} />
        </div>

        <div style={{ marginTop: 16 }}>
          <DataTable
            head={["Sample", "Years", "Mean", "Median", "Positive", "Best", "Worst"]}
            rows={now.rest_of_year.map((r) => [
              r.era,
              r.n,
              { t: pct(r.avg), c: signColor(r.avg) },
              { t: pct(r.median), c: signColor(r.median) },
              pctp(r.pos_pct, 0),
              { t: pct(r.best), c: UP },
              { t: pct(r.worst), c: DOWN },
            ])}
          />
        </div>

        <div style={{ marginTop: 16 }}>
          <DataTable
            head={["September half", "Years", "Mean", "Median", "Positive"]}
            rows={now.sep_halves.index.map((lab, i) => [
              lab,
              now.sep_halves.n[i],
              { t: pct(now.sep_halves.avg[i]), c: signColor(now.sep_halves.avg[i]) },
              { t: pct(now.sep_halves.median[i]), c: signColor(now.sep_halves.median[i]) },
              pctp(now.sep_halves.pos_pct[i], 0),
            ])}
          />
        </div>

        <p style={NOTE}>
          Rest-of-year is measured by trading-day count, not calendar date: each past year is cut at its own{" "}
          {now.trading_day_of_year}th session and the remainder compounded. That keeps the comparison honest across
          years with different holiday calendars.
        </p>
      </Card>

      {/* ── month by month ────────────────────────────────────────────────── */}
      <Card
        title="Month by Month"
        subtitle={`${A.meta.symbol} monthly returns · ${A.meta.start.slice(0, 4)}–${A.meta.end.slice(0, 4)}`}
        padding={20}
      >
        <Pills options={eraOptions} value={era} onChange={setEra} label="Sample" />
        <Legend
          items={[
            { color: UP, label: "Positive mean" },
            { color: DOWN, label: "Negative mean" },
          ]}
        />
        <DivBars
          labels={M}
          values={mt.avg}
          fmt={(v) => pct(v, 1)}
          height={280}
          readout={(i) =>
            `${M[i]} · mean ${pct(mt.avg[i])} · median ${pct(mt.median[i])} · ${pctp(mt.pos_pct[i], 1)} positive · n=${mt.n[i]} years`
          }
        />
        <div style={{ marginTop: 14 }}>
          <DataTable
            head={["Month", "Years", "Mean", "Median", "Positive", "Std dev", "Best", "Worst"]}
            rows={M.map((m, i) => [
              m,
              mt.n[i],
              { t: pct(mt.avg[i]), c: signColor(mt.avg[i]) },
              { t: pct(mt.median[i]), c: signColor(mt.median[i]) },
              pctp(mt.pos_pct[i], 1),
              pctp(mt.stdev[i], 2),
              { t: pct(mt.best[i]), c: UP },
              { t: pct(mt.worst[i]), c: DOWN },
            ])}
          />
        </div>
        <p style={NOTE}>
          September is the only month with a negative mean and a losing hit rate across the whole record, and it stays
          negative in every sample window above. December has the highest hit rate. Bars run from a zero baseline, so
          direction carries the sign independently of the color.
        </p>
      </Card>

      {/* ── sell in may ───────────────────────────────────────────────────── */}
      <Card title="The Two Half-Years" subtitle="Nov–Apr against May–Oct, compounded within each season" padding={20}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {smOrder.map((i) => (
            <Tile
              key={sm.index[i]}
              label={sm.index[i]}
              value={pct(sm.avg[i])}
              sub={`median ${pct(sm.median[i])} · ${pctp(sm.pos_pct[i], 0)} positive · n=${sm.n[i]}`}
              color={signColor(sm.avg[i])}
            />
          ))}
          {smOrder.map((i) => (
            <Tile
              key={`${sm.index[i]}-x`}
              label={`${sm.index[i]} extremes`}
              value={
                <span>
                  <span style={{ color: UP }}>{pct(sm.best[i], 1)}</span>
                  <span style={{ opacity: 0.4 }}> / </span>
                  <span style={{ color: DOWN }}>{pct(sm.worst[i], 1)}</span>
                </span>
              }
              sub="best / worst season since 1928"
            />
          ))}
        </div>
        <p style={NOTE}>
          A season-year runs Nov of year <i>t−1</i> through Oct of year <i>t</i>, so both halves belong to the same
          cycle. The winter half wins on average, but the summer half is still positive two years in three — the effect
          is a difference in size, not in direction, and "sell in May" as a rule has you flat through a period with a
          positive expectancy.
        </p>
      </Card>

      {/* ── turn of month ─────────────────────────────────────────────────── */}
      <Card title="Turn of the Month" subtitle="Mean session return by trading day of month" padding={20}>
        <Legend
          items={[
            { color: A1, label: "All history" },
            { color: A2, label: "Since 1985" },
          ]}
        />
        <PairBars
          labels={A.tdom.index}
          a={A.tdom.all}
          b={A.tdom.modern}
          colors={[A1, A2]}
          fmt={(v) => bp(v, 0)}
          height={270}
          readout={(i) =>
            `${A.tdom.index[i]} · all ${bp(A.tdom.all[i], 1)} (${pctp(A.tdom.pos_all[i], 1)} positive) · since 1985 ${bp(A.tdom.modern[i], 1)} (${pctp(A.tdom.pos_modern[i], 1)})`
          }
        />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
          {A.tom.map((t) => (
            <Tile
              key={t.window}
              label={t.window}
              value={bp(t.avg_daily, 1)}
              sub={`${t.n.toLocaleString("en-US")} sessions · ${pctp(t.pos_pct, 1)} positive · ${pct(t.annualized, 1)} annualized`}
              color={signColor(t.avg_daily)}
            />
          ))}
        </div>
        <p style={NOTE}>
          T−5…T−1 are the last five sessions of a month; T1…T15 count forward from the first. The cluster around the
          turn does effectively all of the index's work — the rest of the month, taken together, has compounded at close
          to nothing.
        </p>
      </Card>

      {/* ── day of week ───────────────────────────────────────────────────── */}
      <Card title="Day of Week" subtitle="Mean session return by weekday" padding={20}>
        <Pills options={eraOptions} value={dowEra} onChange={setDowEra} label="Sample" />
        <DivBars
          labels={dw.index}
          values={dw.avg}
          fmt={(v) => bp(v, 0)}
          height={230}
          readout={(i) =>
            `${dw.index[i]} · mean ${bp(dw.avg[i], 2)} · ${pctp(dw.pos_pct[i], 1)} positive · std dev ${pctp(dw.stdev[i], 2)} · n=${dw.n[i].toLocaleString("en-US")} sessions`
          }
        />
        <div style={{ marginTop: 14 }}>
          <DataTable
            head={["Day", "Sessions", "Mean", "Positive", "Std dev"]}
            rows={dw.index.map((d, i) => [
              d,
              dw.n[i].toLocaleString("en-US"),
              { t: bp(dw.avg[i], 2), c: signColor(dw.avg[i]) },
              pctp(dw.pos_pct[i], 1),
              pctp(dw.stdev[i], 2),
            ])}
          />
        </div>
        <p style={NOTE}>
          Switch the sample to "Since 1985" and the Monday effect largely disappears — the clearest example on this tab
          of a documented seasonal edge being arbitraged away after publication.
        </p>
      </Card>

      {/* ── cycles ────────────────────────────────────────────────────────── */}
      <Card title="Presidential &amp; Decennial Cycles" subtitle="Mean calendar-year return, price only" padding={20}>
        <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(min(320px,100%), 1fr))" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.6, marginBottom: 8 }}>Four-year political cycle</div>
            <DivBars
              labels={A.presidential.index.map((s) => s.replace(/^\d\s/, ""))}
              values={A.presidential.avg}
              fmt={(v) => pct(v, 0)}
              height={220}
              readout={(i) =>
                `${A.presidential.index[i].replace(/^\d\s/, "")} · mean ${pct(A.presidential.avg[i])} · median ${pct(A.presidential.median[i])} · ${pctp(A.presidential.pos_pct[i], 0)} positive · n=${A.presidential.n[i]}`
              }
            />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.6, marginBottom: 8 }}>Decade digit</div>
            <DivBars
              labels={A.decennial.index.map((v) => `…${v}`)}
              values={A.decennial.avg}
              fmt={(v) => pct(v, 0)}
              height={220}
              readout={(i) =>
                `Years ending in ${A.decennial.index[i]} · mean ${pct(A.decennial.avg[i])} · median ${pct(A.decennial.median[i])} · ${pctp(A.decennial.pos_pct[i], 0)} positive · n=${A.decennial.n[i]}`
              }
            />
          </div>
        </div>
        <p style={NOTE}>
          Twenty-five observations for the four-year cycle, ten for each decade digit. At those sample sizes a single
          outlier year moves a bar several points, so read both as folklore with a sample size attached rather than as
          evidence. They are here because they get quoted, and quoting them without the <i>n</i> is how they survive.
        </p>
      </Card>

      {/* ── volatility ────────────────────────────────────────────────────── */}
      <Card title="Volatility by Month" subtitle="Annualized standard deviation of daily returns" padding={20}>
        <Legend
          items={[
            { color: A1, label: "All history" },
            { color: A2, label: "Since 1985" },
          ]}
        />
        <PairBars
          labels={A.vol.index}
          a={A.vol.all}
          b={A.vol.modern}
          colors={[A1, A2]}
          fmt={(v) => pctp(v, 0)}
          height={260}
          readout={(i) =>
            `${A.vol.index[i]} · all history ${pctp(A.vol.all[i], 1)} vol, mean daily move ${pctp(A.vol.avg_abs_all[i], 2)} · since 1985 ${pctp(A.vol.modern[i], 1)} vol, ${pctp(A.vol.avg_abs_modern[i], 2)}`
          }
        />
        <p style={NOTE}>
          The October peak is the most durable seasonal fact on this tab — it survives every sample window and every
          decade. For an options book that matters more than the return table above it: the calendar says far more about
          what to pay for premium than about which way to lean.
        </p>
      </Card>

      {/* ── heatmaps ──────────────────────────────────────────────────────── */}
      <Card title="Has the Seasonal Shape Moved?" subtitle="Mean monthly return by decade" padding={20}>
        <HeatTable
          cols={M}
          rows={A.decadeMonth.index}
          data={A.decadeMonth.data}
          scale={0.035}
          rowLabel={(r) => `${r}s`}
        />
        <p style={NOTE}>
          Read down a column to see whether a month's reputation holds decade to decade. Most do not hold up nearly as
          well as the pooled average implies — September is the notable exception.
        </p>
      </Card>

      <Card
        title="Every Month, Every Year"
        subtitle={`${A.matrix.years.length} years of monthly returns, %`}
        padding={20}
      >
        <HeatTable
          cols={M}
          rows={A.matrix.years}
          data={A.matrix.data}
          scale={0.1}
          rowLabel={(r) => String(r)}
          maxHeight={460}
        />
      </Card>

      {/* ── barometers ────────────────────────────────────────────────────── */}
      <Card title="Early-Year Barometers" subtitle="What the full year did after each signal window" padding={20}>
        <DataTable
          head={["Signal", "Up years", "Mean year after", "Positive", "Down years", "Mean year after", "Positive"]}
          rows={A.barometers.map((b) => [
            { santa: "Santa Claus rally", first5: "First Five Days", january: "January Barometer" }[b.signal] ??
              b.signal,
            b.up_n,
            { t: pct(b.up_avg_full), c: signColor(b.up_avg_full) },
            pctp(b.up_hit, 0),
            b.dn_n,
            { t: pct(b.dn_avg_full), c: signColor(b.dn_avg_full) },
            pctp(b.dn_hit, 0),
          ])}
        />
        <p style={NOTE}>
          Santa Claus rally = the last five sessions of December plus the first two of January. First Five Days =
          sessions 1–5. January = the full calendar month. All three are contaminated by the fact that the signal window
          is itself part of the year being predicted — the January Barometer's apparent power is partly just January
          being 1/12th of the answer.
        </p>
      </Card>

      {/* ── method ────────────────────────────────────────────────────────── */}
      <Card title="Method" padding={20}>
        <p style={{ ...NOTE, marginTop: 0 }}>
          <b style={{ opacity: 0.85 }}>Data.</b> {A.meta.symbol} daily closes, {A.meta.start} through {A.meta.end},{" "}
          {A.meta.trading_days.toLocaleString("en-US")} sessions. Returns are close-to-close and price-only — dividends
          are excluded, which understates long-run totals by roughly 2–4 percentage points a year depending on era. The
          current partial year and the final partial month are excluded from every monthly and annual aggregate, so no
          table is contaminated by a stub period.
        </p>
        <p style={NOTE}>
          <b style={{ opacity: 0.85 }}>How to read it.</b> Sample sizes are printed everywhere for a reason. A monthly
          mean built from 98 observations carries a standard error near 0.6 percentage points, so most of the
          differences between adjacent months here are not statistically distinguishable. Seasonality is a weak prior
          about the distribution of outcomes, not a trade — it belongs on the same shelf as knowing October is a
          high-vol month, not on the shelf with a level.
        </p>
      </Card>
    </>
  );
}
