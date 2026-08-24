"use client";

// ─────────────────────────────────────────────────────────────────────────────
// S&P 500 seasonality → the almanac half.
//
// Everything below the seasonal-overlay chart in SeasonalityView. Rendered both
// signed in (Test Lab) and signed OUT (the public /explore/seasonality page).
//
// All of it is precomputed at build time into ALMANAC / EXTRAS (see
// seasonalityData.ts) from the ^GSPC daily closes back to 1927-12-30, plus
// ^VIX + ^GSPC daily OHLC from 1990 for the volatility-spike study — no fetch,
// no API route, no socket subscription. Pure static data plus SVG, which is why
// it renders instantly, works with the backend down, and can prerender for a
// cold visitor off a social link.
//
// ONE SECTION AT A TIME. This component no longer renders the whole almanac —
// SeasonalityView owns a rail and passes the `active` section key, and only
// that section is mounted. Everything else is unmounted, not hidden: a display
// toggle would keep 13 charts' worth of SVG and ResizeObservers alive for a
// reader looking at one of them.
//
// EVERY TABLE IS COLLAPSED BY DEFAULT, as a native <details>. Native, not React
// state, for three reasons: it needs no client state to seed (so it cannot
// desync between the server and the first client paint), it is keyboard- and
// screen-reader-correct for free, and Ctrl+F still finds text inside a closed
// <details> in current Chrome. The charts and the stat tiles stay open — those
// are the scan layer; the tables are the drill-down.
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
// TEXT IS WHITE. Hierarchy comes from size, weight and letter-spacing, never
// from dimming the ink. Translucency is reserved for chrome — gridlines, hairline
// borders, card fills.
//
// HYDRATION: every chart's width starts at 0 on BOTH sides and is filled in by a
// ResizeObserver after mount, so the server and the first client paint agree.
// Same rule as the overlay chart above it.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { HOME_THEME, ES_CANDLE_UP, ES_CANDLE_DOWN } from "@/components/shared/homeTheme";
import { ALMANAC, ERA_KEYS, EXTRAS, type Stat } from "./seasonalityData";
import { SeaCard } from "./Watermark";
import { SEA } from "./seaTheme";
import type { SectionKey } from "./sections";

const UP = ES_CANDLE_UP;
const DOWN = ES_CANDLE_DOWN;
const A1 = HOME_THEME.cyan;    // "all history" series
const A2 = HOME_THEME.orange;  // "modern era" series
const INK = HOME_THEME.text;   // #FFFFFF — the only text color on this page

const pct = (v: number | null | undefined, d = 2) =>
  v == null ? "—" : `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 100).toFixed(d)}%`;
const pctp = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const bp = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 10000).toFixed(d)} bp`;
const signColor = (v: number | null | undefined) => (v == null ? INK : v >= 0 ? UP : DOWN);
const n0 = (v: number) => v.toLocaleString("en-US");
/** M/D/YYYY, parsed as UTC so a YYYY-MM-DD string never slips a day westward. */
const fmtUS = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${y}`;
};

/**
 * Width of a chart box, measured after mount. 0 until then.
 *
 * CALLBACK REF, not useRef + useEffect([]). Only one section is mounted at a
 * time now, so a chart is destroyed and rebuilt every time you move around the
 * rail. An effect with an empty dep array runs once against the FIRST node and
 * never re-attaches, so every chart after the first navigation would sit at
 * width 0 and render nothing — silently, with no error. Attaching the observer
 * in the ref callback ties it to the node's lifetime instead of the
 * component's first paint.
 */
function useMeasuredWidth() {
  const [w, setW] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!node) return;
    const obs = new ResizeObserver(([e]) => setW(e.contentRect.width));
    obs.observe(node);
    ro.current = obs;
    setW(node.clientWidth);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
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

const NOTE: CSSProperties = { marginTop: 14, fontSize: 12.5, lineHeight: 1.65, color: INK, maxWidth: 900 };

const capLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: INK,
};

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
      {label ? <span style={{ ...capLabel, marginRight: 2 }}>{label}</span> : null}
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
              color: on ? HOME_THEME.cyan : INK,
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
    <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, fontWeight: 700, color: INK, marginBottom: 12 }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: i.color, display: "inline-block" }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Collapsed-by-default disclosure for one table. Native <details> — see the
 * file header for why this is not React state.
 */
function Collapse({
  label,
  hint,
  note,
  children,
}: {
  label: string;
  hint?: string;
  /** The prose that explains this table. Lives INSIDE the disclosure — a card
   *  shows numbers, and the words about them are one click away, not stacked
   *  under every chart. */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details style={{ marginTop: 14, border: `1px solid ${SEA.line}`, borderRadius: 12, background: SEA.card2 }}>
      <summary
        style={{
          listStyle: "none",
          cursor: "pointer",
          padding: "11px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: INK,
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        <span aria-hidden style={{ color: HOME_THEME.cyan, fontSize: 10 }}>▶</span>
        <span>{label}</span>
        {hint ? (
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.02em", textTransform: "none", color: INK }}>
            {hint}
          </span>
        ) : null}
      </summary>
      <div style={{ padding: "0 14px 14px" }}>
        {children}
        {note ? <div style={NOTE}>{note}</div> : null}
      </div>
    </details>
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
    const l = Math.min(0, ...values);
    const h = Math.max(0, ...values);
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
          <svg width={width} height={height} role="img" style={{ display: "block", touchAction: "none" }} onPointerLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={`t${t}`}>
                <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.08)"} />
                <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={10} fill={INK} style={{ fontVariantNumeric: "tabular-nums" }}>
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
                  <path d={barPath(x, w, up ? y(v) : y(0), Math.abs(y(v) - y(0)), up)} fill={up ? UP : DOWN} opacity={hover == null || hover === i ? 1 : 0.55} />
                  {showValues ? (
                    <text x={x + w / 2} y={up ? y(v) - 6 : y(v) + 13} textAnchor="middle" fontSize={9.5} fill={INK} style={{ fontVariantNumeric: "tabular-nums" }}>
                      {fmt(v)}
                    </text>
                  ) : null}
                  <text x={x + w / 2} y={height - 9} textAnchor="middle" fontSize={10} fontWeight={700} fill={INK}>
                    {labels[i]}
                  </text>
                </g>
              );
            })}
          </svg>
          <div style={{ minHeight: 20, fontSize: 12, color: INK, fontVariantNumeric: "tabular-nums" }}>
            {hover != null ? readout(hover) : "Hover a bar for the detail."}
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
    const l = Math.min(0, ...all);
    const h = Math.max(0, ...all);
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
          <svg width={width} height={height} role="img" style={{ display: "block", touchAction: "none" }} onPointerLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={`t${t}`}>
                <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.08)"} />
                <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={10} fill={INK} style={{ fontVariantNumeric: "tabular-nums" }}>
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
                  return <path key={k} d={barPath(x, bw, up ? y(v) : y(0), Math.abs(y(v) - y(0)), up)} fill={colors[k]} opacity={hover == null || hover === i ? 1 : 0.5} />;
                })}
                {i % labelEvery === 0 ? (
                  <text x={PAD.left + i * gw + gw / 2} y={height - 9} textAnchor="middle" fontSize={10} fontWeight={700} fill={INK}>
                    {lab}
                  </text>
                ) : null}
              </g>
            ))}
          </svg>
          <div style={{ minHeight: 20, fontSize: 12, color: INK, fontVariantNumeric: "tabular-nums" }}>
            {hover != null ? readout(hover) : "Hover a group for the detail."}
          </div>
        </>
      ) : (
        <div style={{ height: height + 20 }} />
      )}
    </div>
  );
}

// ── tables ──────────────────────────────────────────────────────────────────

/**
 * A table cell. `bar` draws a proportional bar behind/next to the value —
 * `bar` is the value's share of the column max, 0..1, computed by the caller
 * because only the caller knows what the column is scaled against.
 */
type Cell = { t: string; c?: string; bar?: number } | string | number;

function DataTable({ head, rows }: { head: string[]; rows: Cell[][] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, color: INK, fontVariantNumeric: "tabular-nums" }}>
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
                  color: INK,
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
                const cell = isObj ? (c as { t: string; c?: string; bar?: number }) : null;
                return (
                  <td
                    key={ci}
                    style={{
                      textAlign: ci === 0 ? "left" : "right",
                      padding: "7px 12px",
                      whiteSpace: "nowrap",
                      color: cell?.c ? cell.c : INK,
                      borderBottom: ri === rows.length - 1 ? "none" : "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    {cell?.bar != null ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                        <span>{cell.t}</span>
                        <span
                          aria-hidden
                          style={{
                            display: "inline-block",
                            width: 70,
                            height: 9,
                            flex: "none",
                            background: "rgba(255,255,255,0.05)",
                            borderRadius: 2,
                            overflow: "hidden",
                          }}
                        >
                          <span
                            style={{
                              display: "block",
                              height: "100%",
                              width: `${Math.max(2, Math.min(100, cell.bar * 100))}%`,
                              background: cell.c ?? UP,
                              borderRadius: 2,
                            }}
                          />
                        </span>
                      </span>
                    ) : (
                      cell ? cell.t : String(c)
                    )}
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

/** Blend two #rrggbb values — the heatmap ramp runs a neutral cell color toward
 *  the up/down hue, so a zero cell reads as "no signal" rather than as a washed
 *  out version of one of the two directions. */
function mixHex(from: string, to: string, t: number) {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = parse(from);
  const b = parse(to);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}

/**
 * Heatmap. `width:100%` with `tableLayout:fixed` so the twelve month columns
 * divide the FULL card width instead of sitting in a narrow 42px-per-cell block
 * with dead space beside it. minWidth on the wrapper keeps it readable when the
 * card itself is narrow (phone) — it scrolls there instead of crushing.
 */
function HeatTable({
  cols,
  rows,
  data,
  scale,
  rowLabel,
  maxHeight,
  newestFirst = false,
}: {
  cols: string[];
  rows: (string | number)[];
  data: (number | null)[][];
  scale: number;
  rowLabel: (r: string | number) => string;
  maxHeight?: number;
  /** Flip to newest-at-top. Reverses labels AND data together — doing it at the
   *  call site means two reverses that can silently drift out of sync and
   *  mislabel every row, which is a bug nobody spots by eye. */
  newestFirst?: boolean;
}) {
  if (newestFirst) {
    rows = [...rows].reverse();
    data = [...data].reverse();
  }
  return (
    <div style={{ overflow: "auto", maxHeight, width: "100%" }}>
      <table
        style={{
          borderCollapse: "separate",
          borderSpacing: 2,
          fontSize: 11,
          color: INK,
          fontVariantNumeric: "tabular-nums",
          width: "100%",
          minWidth: 620,
          tableLayout: "fixed",
        }}
      >
        <colgroup>
          <col style={{ width: 62 }} />
          {cols.map((c) => (
            <col key={c} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th />
            {cols.map((c) => (
              <th
                key={c}
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: INK,
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
              <th style={{ textAlign: "right", paddingRight: 8, fontSize: 10.5, fontWeight: 700, color: INK, whiteSpace: "nowrap" }}>
                {rowLabel(r)}
              </th>
              {data[i].map((v, j) => (
                <td
                  key={j}
                  title={v == null ? "" : `${cols[j]} ${rowLabel(r)} · ${pct(v)}`}
                  style={{
                    height: 24,
                    textAlign: "center",
                    borderRadius: 3,
                    background: v == null ? "transparent" : mixHex("#1b2028", v >= 0 ? UP : DOWN, Math.pow(Math.min(1, Math.abs(v) / scale), 0.72)),
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
        flex: "1 1 160px",
        minWidth: 148,
        padding: "12px 14px",
        borderRadius: 10,
        border: `1px solid ${HOME_THEME.border}`,
        background: SEA.card2,
      }}
    >
      <div style={capLabel}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, fontVariantNumeric: "tabular-nums", color: color ?? INK }}>{value}</div>
      {sub ? <div style={{ fontSize: 11.5, color: INK, marginTop: 3 }}>{sub}</div> : null}
    </div>
  );
}

const TILES: CSSProperties = { display: "flex", gap: 12, flexWrap: "wrap" };

/** The seven columns every Stat renders as. */
const STAT_HEAD = ["", "n", "Mean", "Median", "Positive", "Best", "Worst"];
const statRow = (label: string, s: Stat): Cell[] => [
  label,
  n0(s.n),
  { t: pct(s.avg), c: signColor(s.avg) },
  { t: pct(s.median), c: signColor(s.median) },
  pctp(s.pos_pct, 1),
  { t: pct(s.best), c: UP },
  { t: pct(s.worst), c: DOWN },
];

// ── the almanac ─────────────────────────────────────────────────────────────

export default function SeasonalityAlmanac({ active }: { active: SectionKey }) {
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

  const vix = EXTRAS.vix;
  const v20 = vix.buckets.find((b) => b.threshold === 0.2) ?? vix.buckets[0];
  // Bar scale for the events table — the largest move in the list, so the
  // longest bar is full width and every other bar is read against it.
  const maxLowNextHigh = Math.max(...vix.events.map((e) => Math.abs(e.low_to_next_high)), 0.0001);
  const eom = EXTRAS.eom;
  const opex = EXTRAS.opex;

  const SECTIONS: Partial<Record<SectionKey, ReactNode>> = {
    now: (
      <SeaCard title="Where the Calendar Stands" subtitle={`Last close ${now.as_of} · session ${now.trading_day_of_year} of the trading year`} padding={20}>
        <div style={TILES}>
          <Tile label="Rest of year · mean" value={pct(royMod.avg)} sub={`since 1985 · n=${royMod.n}`} color={signColor(royMod.avg)} />
          <Tile label="Rest of year · positive" value={pctp(royMod.pos_pct, 0)} sub={`${Math.round(royMod.pos_pct * royMod.n)} of ${royMod.n} years`} />
          <Tile label={win.window} value={pct(win.avg)} sub={`all history · n=${win.n} · ${pctp(win.pos_pct, 0)} positive`} color={signColor(win.avg)} />
          <Tile label="Worst rest-of-year" value={pct(royAll.worst)} sub={`all history · n=${royAll.n}`} color={DOWN} />
        </div>

        <Collapse
          label="Rest-of-year detail"
          hint="by sample window"
          note={
            <>
              Rest-of-year is measured by trading-day count, not calendar date: each past year is cut at its own{" "}
            {now.trading_day_of_year}th session and the remainder compounded. That keeps the comparison honest across
            years with different holiday calendars.
            </>
          }
        >
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
        </Collapse>

        <Collapse label="September, split in half" hint="1st–15th vs 16th–30th">
          <DataTable
            head={["Window", "Years", "Mean", "Median", "Positive"]}
            rows={now.sep_halves.index.map((lab, i) => [
              lab,
              now.sep_halves.n[i],
              { t: pct(now.sep_halves.avg[i]), c: signColor(now.sep_halves.avg[i]) },
              { t: pct(now.sep_halves.median[i]), c: signColor(now.sep_halves.median[i]) },
              pctp(now.sep_halves.pos_pct[i], 0),
            ])}
          />
        </Collapse>

      </SeaCard>
    ),
    vix: (
      <SeaCard
        title="After a VIX Spike"
        subtitle={`VIX prior close → high ≥ +20% · ${vix.meta.start} – ${vix.meta.end} · ${n0(vix.meta.sessions)} sessions`}
        padding={20}
      >
        <div style={TILES}>
          <Tile label="Spike sessions" value={n0(v20.n)} sub={`${((v20.n / vix.baseline.n) * 100).toFixed(1)}% of all sessions since 1990`} />
          <Tile
            label="SPX low → next high"
            value={pct(v20.low_to_next_high.avg)}
            sub={`median ${pct(v20.low_to_next_high.median)} · baseline ${pct(vix.baseline.low_to_next_high.avg)}`}
            color={signColor(v20.low_to_next_high.avg)}
          />
          <Tile
            label="Next day open → close"
            value={pct(v20.next_open_close.avg)}
            sub={`${pctp(v20.next_open_close.pos_pct, 1)} positive · baseline ${pct(vix.baseline.next_open_close.avg)} / ${pctp(vix.baseline.next_open_close.pos_pct, 1)}`}
            color={signColor(v20.next_open_close.avg)}
          />
          <Tile
            label="Spike day open → close"
            value={pct(v20.same_open_close.avg)}
            sub="what it took to get the spike"
            color={signColor(v20.same_open_close.avg)}
          />
        </div>

        <Collapse
          label="Threshold ladder"
          hint="does the effect scale with the size of the pop?"
          note={
            <>
              Read every row against the <strong>Every session</strong> baseline, not on its own. &ldquo;Low → next
            high&rdquo; is a rally measured from the worst tick of the panic to the best tick of the following session —
            it is flattering by construction, and the baseline is already {pct(vix.baseline.low_to_next_high.avg)}. The
            number that is actually tradeable is the next session&apos;s open-to-close, and there the ladder does what a
            real effect does: it gets stronger the bigger the pop, from {pct(vix.buckets[0].next_open_close.avg)} at
            ≥+{(vix.buckets[0].threshold * 100).toFixed(0)}% to {pct(v20.next_open_close.avg)} at ≥+20%, against{" "}
            {pct(vix.baseline.next_open_close.avg)} unconditionally. Note the sample thins fast: n={v20.n} at +20% and
            only {vix.buckets[vix.buckets.length - 1].n} at the far end.
            </>
          }
        >
          <DataTable
            head={["VIX pop", "n", "Low → next high", "median", "Next open → close", "median", "positive", "Spike day O→C"]}
            rows={[
              [
                "Every session",
                n0(vix.baseline.n),
                { t: pct(vix.baseline.low_to_next_high.avg), c: signColor(vix.baseline.low_to_next_high.avg) },
                { t: pct(vix.baseline.low_to_next_high.median), c: signColor(vix.baseline.low_to_next_high.median) },
                { t: pct(vix.baseline.next_open_close.avg), c: signColor(vix.baseline.next_open_close.avg) },
                { t: pct(vix.baseline.next_open_close.median), c: signColor(vix.baseline.next_open_close.median) },
                pctp(vix.baseline.next_open_close.pos_pct, 1),
                { t: pct(vix.baseline.same_open_close.avg), c: signColor(vix.baseline.same_open_close.avg) },
              ],
              ...vix.buckets.map((b) => [
                `≥ +${(b.threshold * 100).toFixed(0)}%`,
                n0(b.n),
                { t: pct(b.low_to_next_high.avg), c: signColor(b.low_to_next_high.avg) },
                { t: pct(b.low_to_next_high.median), c: signColor(b.low_to_next_high.median) },
                { t: pct(b.next_open_close.avg), c: signColor(b.next_open_close.avg) },
                { t: pct(b.next_open_close.median), c: signColor(b.next_open_close.median) },
                pctp(b.next_open_close.pos_pct, 1),
                { t: pct(b.same_open_close.avg), c: signColor(b.same_open_close.avg) },
              ]),
            ]}
          />
        </Collapse>

        <Collapse
          label="Every +20% session"
          hint={`${n0(vix.events.length)} events, newest first`}
          note={
            <>
              <strong>VIX up</strong> is the PRIOR session&apos;s close → this session&apos;s high, so an overnight gap counts. <strong>SPX next day</strong> is the
              session low → the following session&apos;s high, the same window the tiles above use; the bar scales it
              against the biggest move in the list ({pct(maxLowNextHigh, 1)}). <strong>Next O→C</strong> is the
              following session&apos;s open to close — the one you could actually have traded, since the low and the
              next high are both ticks you only know afterwards.
            </>
          }
        >
          <DataTable
            head={["VIX date", "VIX up", "SPX next day", "Next O→C"]}
            rows={vix.events.map((e) => [
              fmtUS(e.date),
              pctp(e.vix_pop, 2),
              { t: pct(e.low_to_next_high, 2), c: signColor(e.low_to_next_high), bar: Math.abs(e.low_to_next_high) / maxLowNextHigh },
              { t: pct(e.next_open_close, 2), c: signColor(e.next_open_close) },
            ])}
          />
        </Collapse>

      </SeaCard>
    ),
    eom: (
      <SeaCard title="Last Day of the Month" subtitle="Return of the final session of a month, close-to-close" padding={20}>
        <div style={TILES}>
          <Tile label="Every month end" value={bp(eom.all.avg, 1)} sub={`n=${n0(eom.all.n)} · ${pctp(eom.all.pos_pct, 1)} positive`} color={signColor(eom.all.avg)} />
          <Tile label="Quarter ends" value={bp(eom.quarter.avg, 1)} sub={`Mar/Jun/Sep/Dec · n=${eom.quarter.n} · ${pctp(eom.quarter.pos_pct, 1)} positive`} color={signColor(eom.quarter.avg)} />
          <Tile label="Non-quarter ends" value={bp(eom.nonquarter.avg, 1)} sub={`n=${eom.nonquarter.n} · ${pctp(eom.nonquarter.pos_pct, 1)} positive`} color={signColor(eom.nonquarter.avg)} />
          <Tile label="Since 1985" value={bp(eom.modern.avg, 1)} sub={`n=${eom.modern.n} · ${pctp(eom.modern.pos_pct, 1)} positive`} color={signColor(eom.modern.avg)} />
        </div>

        <Collapse
          label="Month-end summary"
          hint="all history vs quarter ends vs modern era"
          note={
            <>
              The last session of a month is worth about {bp(eom.all.avg, 1)} against roughly +3 bp for an average session,
            and it is the NON-quarter ends doing it — quarter ends run {bp(eom.quarter.avg, 1)} and are barely better
            than a coin flip. Since 1985 the whole effect is close to gone ({bp(eom.modern.avg, 1)},{" "}
            {pctp(eom.modern.pos_pct, 1)} positive), which is the same arc the Monday effect took.
            </>
          }
        >
          <DataTable
            head={STAT_HEAD}
            rows={[
              statRow("Every month end", eom.all),
              statRow("Quarter ends", eom.quarter),
              statRow("Non-quarter ends", eom.nonquarter),
              statRow("Every month end · since 1985", eom.modern),
              statRow("Quarter ends · since 1985", eom.quarter_modern),
            ]}
          />
        </Collapse>

        <Collapse label="Month-end by calendar month" hint="which month ends carry it">
          <DataTable head={STAT_HEAD} rows={eom.by_month.map((m) => statRow(m.label, m))} />
        </Collapse>

      </SeaCard>
    ),
    opex: (
      <SeaCard title="Opex Week &amp; the Week After" subtitle="Third-Friday expiration, monthly and quarterly" padding={20}>
        <div style={TILES}>
          <Tile label="Opex week" value={bp(opex.monthly.week.avg, 1)} sub={`n=${n0(opex.monthly.week.n)} · ${pctp(opex.monthly.week.pos_pct, 1)} positive`} color={signColor(opex.monthly.week.avg)} />
          <Tile label="Week after opex" value={bp(opex.monthly.after.avg, 1)} sub={`n=${n0(opex.monthly.after.n)} · ${pctp(opex.monthly.after.pos_pct, 1)} positive`} color={signColor(opex.monthly.after.avg)} />
          <Tile label="Quarterly opex week" value={bp(opex.quarterly.week.avg, 1)} sub={`Mar/Jun/Sep/Dec · n=${opex.quarterly.week.n} · ${pctp(opex.quarterly.week.pos_pct, 1)} positive`} color={signColor(opex.quarterly.week.avg)} />
          <Tile
            label="Week after quarterly"
            value={bp(opex.quarterly.after.avg, 1)}
            sub={`n=${opex.quarterly.after.n} · ${pctp(opex.quarterly.after.pos_pct, 1)} positive`}
            color={signColor(opex.quarterly.after.avg)}
          />
        </div>

        <Legend items={[{ color: A1, label: "Opex week" }, { color: A2, label: "Week after" }]} />
        <PairBars
          labels={opex.by_month.map((m) => m.label)}
          a={opex.by_month.map((m) => m.week.avg)}
          b={opex.by_month.map((m) => m.after.avg)}
          colors={[A1, A2]}
          fmt={(v) => bp(v, 0)}
          height={260}
          readout={(i) => {
            const m = opex.by_month[i];
            return `${m.label} · opex week ${pct(m.week.avg)} (${pctp(m.week.pos_pct, 1)} positive, n=${m.week.n}) · week after ${pct(m.after.avg)} (${pctp(m.after.pos_pct, 1)} positive)`;
          }}
        />

        <Collapse
          label="Opex summary"
          hint="monthly, quarterly, and the modern era"
          note={
            <>
              Opex is the third Friday, or the last session on or before it when that Friday is a holiday. <em>Opex week</em>{" "}
            is the prior Friday&apos;s close to the opex Friday&apos;s close; <em>week after</em> is the opex close to the
            following Friday&apos;s close. Two things stand out: opex week itself is firmly positive and much more so
            since 1985 ({bp(opex.monthly_modern.week.avg, 1)}, {pctp(opex.monthly_modern.week.pos_pct, 1)} positive), and
            the give-back concentrates in the week after a QUARTERLY expiration — {bp(opex.quarterly.after.avg, 1)} all
            history, {bp(opex.quarterly_modern.after.avg, 1)} and only {pctp(opex.quarterly_modern.after.pos_pct, 1)}{" "}
            positive since 1985, on n={opex.quarterly_modern.after.n}.
            </>
          }
        >
          <DataTable
            head={STAT_HEAD}
            rows={[
              statRow("Opex week · all monthly", opex.monthly.week),
              statRow("Week after · all monthly", opex.monthly.after),
              statRow("Opex week · quarterly", opex.quarterly.week),
              statRow("Week after · quarterly", opex.quarterly.after),
              statRow("Opex week · non-quarterly", opex.nonquarterly.week),
              statRow("Week after · non-quarterly", opex.nonquarterly.after),
              statRow("Opex week · monthly, since 1985", opex.monthly_modern.week),
              statRow("Week after · monthly, since 1985", opex.monthly_modern.after),
              statRow("Opex week · quarterly, since 1985", opex.quarterly_modern.week),
              statRow("Week after · quarterly, since 1985", opex.quarterly_modern.after),
            ]}
          />
        </Collapse>

        <Collapse label="Opex by calendar month" hint="both windows, all 12 months">
          <DataTable
            head={["Month", "n", "Opex week", "positive", "Week after", "positive"]}
            rows={opex.by_month.map((m) => [
              m.label,
              m.week.n,
              { t: pct(m.week.avg), c: signColor(m.week.avg) },
              pctp(m.week.pos_pct, 1),
              { t: pct(m.after.avg), c: signColor(m.after.avg) },
              pctp(m.after.pos_pct, 1),
            ])}
          />
        </Collapse>

        <Collapse label="Last 24 expirations" hint="newest first">
          <DataTable
            head={["Expiration", "Opex Friday", "Opex week", "Week after", "Type"]}
            rows={opex.recent.map((r) => [
              r.label,
              r.opex,
              { t: pct(r.week), c: signColor(r.week) },
              { t: pct(r.after), c: signColor(r.after) },
              r.is_q ? "Quarterly" : "Monthly",
            ])}
          />
        </Collapse>

      </SeaCard>
    ),
    month: (
      <SeaCard title="Month by Month" subtitle={`${A.meta.symbol} monthly returns · ${A.meta.start.slice(0, 4)}–${A.meta.end.slice(0, 4)}`} padding={20}>
        <Pills options={eraOptions} value={era} onChange={setEra} label="Sample" />
        <Legend items={[{ color: UP, label: "Positive mean" }, { color: DOWN, label: "Negative mean" }]} />
        <DivBars
          labels={M}
          values={mt.avg}
          fmt={(v) => pct(v, 1)}
          height={280}
          readout={(i) => `${M[i]} · mean ${pct(mt.avg[i])} · median ${pct(mt.median[i])} · ${pctp(mt.pos_pct[i], 1)} positive · n=${mt.n[i]} years`}
        />
        <Collapse
          label="Monthly table"
          hint={`${era} · mean, median, hit rate, extremes`}
          note={
            <>
              September is the only month with a negative mean and a losing hit rate across the whole record, and it stays
            negative in every sample window above. December has the highest hit rate. Bars run from a zero baseline, so
            direction carries the sign independently of the color.
            </>
          }
        >
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
        </Collapse>
      </SeaCard>
    ),
    six: (
      <SeaCard title="The Two Half-Years" subtitle="Nov–Apr against May–Oct, compounded within each season" padding={20}>
        <div style={TILES}>
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
                  <span> / </span>
                  <span style={{ color: DOWN }}>{pct(sm.worst[i], 1)}</span>
                </span>
              }
              sub="best / worst season since 1928"
            />
          ))}
        </div>
      </SeaCard>
    ),
    tdom: (
      <SeaCard title="Turn of the Month" subtitle="Mean session return by trading day of month" padding={20}>
        <Legend items={[{ color: A1, label: "All history" }, { color: A2, label: "Since 1985" }]} />
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
        <div style={{ ...TILES, marginTop: 14 }}>
          {A.tom.map((t) => (
            <Tile
              key={t.window}
              label={t.window}
              value={bp(t.avg_daily, 1)}
              sub={`${n0(t.n)} sessions · ${pctp(t.pos_pct, 1)} positive · ${pct(t.annualized, 1)} annualized`}
              color={signColor(t.avg_daily)}
            />
          ))}
        </div>
      </SeaCard>
    ),
    dow: (
      <SeaCard title="Day of Week" subtitle="Mean session return by weekday" padding={20}>
        <Pills options={eraOptions} value={dowEra} onChange={setDowEra} label="Sample" />
        <DivBars
          labels={dw.index}
          values={dw.avg}
          fmt={(v) => bp(v, 0)}
          height={230}
          readout={(i) =>
            `${dw.index[i]} · mean ${bp(dw.avg[i], 2)} · ${pctp(dw.pos_pct[i], 1)} positive · std dev ${pctp(dw.stdev[i], 2)} · n=${n0(dw.n[i])} sessions`
          }
        />
        <Collapse
          label="Day-of-week table"
          hint={dowEra}
          note={
            <>
              Switch the sample to &ldquo;Since 1985&rdquo; and the Monday effect largely disappears — the clearest example
            on this page of a documented seasonal edge being arbitraged away after publication.
            </>
          }
        >
          <DataTable
            head={["Day", "Sessions", "Mean", "Positive", "Std dev"]}
            rows={dw.index.map((d, i) => [d, n0(dw.n[i]), { t: bp(dw.avg[i], 2), c: signColor(dw.avg[i]) }, pctp(dw.pos_pct[i], 1), pctp(dw.stdev[i], 2)])}
          />
        </Collapse>
      </SeaCard>
    ),
    cycles: (
      <SeaCard title="Presidential &amp; Decennial Cycles" subtitle="Mean calendar-year return, price only" padding={20}>
        <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(min(320px,100%), 1fr))" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: INK, marginBottom: 8 }}>Four-year political cycle</div>
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
            <div style={{ fontSize: 12, fontWeight: 800, color: INK, marginBottom: 8 }}>Decade digit</div>
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
        <Collapse
          label="Cycle year × month"
          hint="mean monthly return, %"
          note={
            <>
              Twenty-five observations for the four-year cycle, ten for each decade digit. At those sample sizes a single
            outlier year moves a bar several points, so read both as folklore with a sample size attached rather than as
            evidence. They are here because they get quoted, and quoting them without the <i>n</i> is how they survive.
            </>
          }
        >
          <HeatTable
            cols={M}
            rows={A.presidentialMonth.index}
            data={A.presidentialMonth.data}
            scale={0.03}
            rowLabel={(r) => String(r).replace(/^\d\s/, "")}
          />
        </Collapse>
      </SeaCard>
    ),
    vol: (
      <SeaCard title="Volatility by Month" subtitle="Annualized standard deviation of daily returns" padding={20}>
        <Legend items={[{ color: A1, label: "All history" }, { color: A2, label: "Since 1985" }]} />
        <PairBars
          labels={A.vol.index}
          a={A.vol.all}
          b={A.vol.modern}
          colors={[A1, A2]}
          fmt={(x) => pctp(x, 0)}
          height={260}
          readout={(i) =>
            `${A.vol.index[i]} · all history ${pctp(A.vol.all[i], 1)} vol, mean daily move ${pctp(A.vol.avg_abs_all[i], 2)} · since 1985 ${pctp(A.vol.modern[i], 1)} vol, ${pctp(A.vol.avg_abs_modern[i], 2)}`
          }
        />
      </SeaCard>
    ),
    decade: (
      <SeaCard title="Has the Seasonal Shape Moved?" subtitle="Mean monthly return by decade, % · newest first" padding={20}>
        <HeatTable cols={M} rows={A.decadeMonth.index} data={A.decadeMonth.data} scale={0.035} rowLabel={(r) => `${r}s`} newestFirst />
      </SeaCard>
    ),
    matrix: (
      <SeaCard title="Every Month, Every Year" subtitle={`${A.matrix.years.length} years of monthly returns, % · newest first`} padding={20}>
        <HeatTable cols={M} rows={A.matrix.years} data={A.matrix.data} scale={0.1} rowLabel={(r) => String(r)} maxHeight={520} newestFirst />
      </SeaCard>
    ),
    baro: (
      <SeaCard title="Early-Year Barometers" subtitle="What the full year did after each signal window" padding={20}>
        <Collapse
          label="Santa · First Five Days · January Barometer"
          hint="split by whether the signal window was up or down"
          note={
            <>
              Santa Claus rally = the last five sessions of December plus the first two of January. First Five Days =
            sessions 1–5. January = the full calendar month. All three are contaminated by the fact that the signal window
            is itself part of the year being predicted — the January Barometer&apos;s apparent power is partly just
            January being 1/12th of the answer.
            </>
          }
        >
          <DataTable
            head={["Signal", "Up years", "Mean year after", "Positive", "Down years", "Mean year after", "Positive"]}
            rows={A.barometers.map((b) => [
              ({ santa: "Santa Claus rally", first5: "First Five Days", january: "January Barometer" } as Record<string, string>)[b.signal] ?? b.signal,
              b.up_n,
              { t: pct(b.up_avg_full), c: signColor(b.up_avg_full) },
              pctp(b.up_hit, 0),
              b.dn_n,
              { t: pct(b.dn_avg_full), c: signColor(b.dn_avg_full) },
              pctp(b.dn_hit, 0),
            ])}
          />
        </Collapse>
      </SeaCard>
    ),
  };

  return <>{SECTIONS[active] ?? null}</>;
}
