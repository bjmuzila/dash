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
import { ALMANAC, ERA_KEYS, EXTRAS, YTD_LAST_DATE, yearCurve, type Stat } from "./seasonalityData";
import { SeaCard } from "./Watermark";
import { SEA } from "./seaTheme";
import type { SectionKey } from "./sections";
import {
  APPLE_EVENTS,
  APPLE_EVENT_KINDS,
  EARNINGS_TICKERS,
  FOMC_UPCOMING,
  JACKSON_HOLE,
  fomcDecisions,
  type AppleEventKind,
  type FomcDecision,
} from "./eventDates";
import {
  calIndex,
  dowOf,
  fmtLongDate,
  fmtSpan,
  isLastTradingDayOfMonth,
  nyTodayISO,
} from "./calendar";
import { useLiveYear, type LiveVixEvent } from "./useLiveYear";

const UP = ES_CANDLE_UP;
const DOWN = ES_CANDLE_DOWN;
const A1 = HOME_THEME.cyan;    // "all history" series
const A2 = HOME_THEME.orange;  // "modern era" series
// A third series hue, for the one chart that needs three (FOMC: before, during,
// after). Deliberately outside HOME_THEME, which carries no third categorical
// colour — its remaining slots are the up/down status pair and reusing either
// would put a sign meaning on a bar that has none. Same argument, and the same
// exception, as the overlay slots in SeasonalityView.
const A3 = "#8b6fe0";
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

/**
 * The toggle used by the event studies.
 *
 * Same visual language as <Pills>, but not that component: Pills owns a whole
 * labelled row and one value, and these sections need several independent
 * toggles sitting on ONE row (count, measure, ticker, event kind). Sharing the
 * style and not the layout is the smaller duplication.
 */
const pillBtn = (on: boolean): CSSProperties => ({
  padding: "5px 12px",
  borderRadius: 8,
  border: `1px solid ${on ? HOME_THEME.cyan : HOME_THEME.border}`,
  background: on
    ? `linear-gradient(180deg, ${HOME_THEME.cyan}33, ${HOME_THEME.cyan}0D)`
    : "rgba(255,255,255,0.04)",
  color: on ? HOME_THEME.cyan : INK,
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.04em",
  cursor: "pointer",
  fontVariantNumeric: "tabular-nums",
});

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
  open,
  autoOpen,
  children,
}: {
  label: string;
  hint?: string;
  /** Start expanded. For a card whose ONLY content is this disclosure — it
   *  would otherwise render as a title and a closed bar with nothing under it.
   *  A literal, never client state: `open` derived at runtime would hydrate
   *  differently on the server and the client. */
  open?: boolean;
  /**
   * Open AFTER mount, from something only the client can know — today's date,
   * a fetched result.
   *
   * This is deliberately NOT `open`. `open` is baked into the server-rendered
   * markup and must therefore be a literal; anything clock-dependent renders
   * closed on the server (which built the page hours or days ago) and open on
   * the client, which is React #418 and a hydration mismatch on a page that
   * prerenders. So the element ships CLOSED in the HTML and is opened by
   * touching the DOM property in an effect, which React does not diff against.
   *
   * One-way on purpose: it opens the disclosure once and never closes it, so a
   * reader who shuts it does not have it reopened underneath them on the next
   * render.
   */
  autoOpen?: boolean;
  /** The prose that explains this table. Lives INSIDE the disclosure — a card
   *  shows numbers, and the words about them are one click away, not stacked
   *  under every chart. */
  note?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || opened.current) return;
    opened.current = true;
    if (ref.current) ref.current.open = true;
  }, [autoOpen]);

  return (
    <details ref={ref} className="sea-disc" open={open} style={{ marginTop: 14, border: `1px solid ${SEA.line}`, borderRadius: 12, background: SEA.card2 }}>
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
        {/* Rotated by .sea-disc[open] .sea-disccaret in SeasonalityView's
            SHELL_CSS — a static ▶ on an already-open section reads as "closed". */}
        <span aria-hidden className="sea-disccaret" style={{ color: HOME_THEME.cyan, fontSize: 10, display: "inline-block" }}>▶</span>
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

/**
 * N series side by side within each group — the three windows of an event
 * study, per outcome.
 *
 * PairBars does two. This does three, and the reason it is a separate component
 * rather than a generalisation of that one is that PairBars is used by four
 * cards whose layout is tuned to two bars; widening it to N would change the
 * bar width on every one of them to buy nothing.
 *
 * IDENTITY IS CARRIED BY POSITION FIRST. Within every group the bars are always
 * in the same order — before, during, after — so the chart reads correctly in
 * greyscale and for a colourblind reader. Hue is the secondary cue and the
 * printed value is the third. That is what makes three series acceptable here
 * when the overlay chart caps itself at four lines: bars in a fixed order are a
 * far weaker demand on colour than lines crossing each other.
 */
function MultiBars({
  groups,
  series,
  fmt,
  readout,
  height = 280,
}: {
  groups: string[];
  series: { label: string; color: string; values: (number | null)[] }[];
  fmt: (v: number) => string;
  readout: (i: number) => string;
  height?: number;
}) {
  const [ref, width] = useMeasuredWidth();
  const [hover, setHover] = useState<number | null>(null);
  const PAD = { top: 22, right: 10, bottom: 28, left: 62 };
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;

  const { lo, hi } = useMemo(() => {
    const all = series.flatMap((s) => s.values).filter((v): v is number => v != null && Number.isFinite(v));
    const l = Math.min(0, ...all);
    const h = Math.max(0, ...all);
    const p = (h - l) * 0.18 || 1;
    return { lo: l - p, hi: h + p };
  }, [series]);

  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH;
  const ticks = niceTicks(lo, hi, 5);
  const gw = groups.length ? innerW / groups.length : 0;
  const inner = gw * 0.74;
  const bw = Math.max(1, (inner - (series.length - 1) * 3) / series.length);

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
            {groups.map((g, i) => (
              <g key={g} onPointerEnter={() => setHover(i)}>
                <rect x={PAD.left + i * gw} y={PAD.top} width={gw} height={innerH} fill="transparent" />
                {series.map((s, k) => {
                  const v = s.values[i];
                  if (v == null || !Number.isFinite(v)) return null;
                  const x = PAD.left + i * gw + (gw - inner) / 2 + k * (bw + 3);
                  const up = v >= 0;
                  return (
                    <g key={s.label}>
                      <path d={barPath(x, bw, up ? y(v) : y(0), Math.abs(y(v) - y(0)), up)} fill={s.color} opacity={hover == null || hover === i ? 1 : 0.45} />
                      <text x={x + bw / 2} y={up ? y(v) - 6 : y(v) + 13} textAnchor="middle" fontSize={9.5} fill={INK} style={{ fontVariantNumeric: "tabular-nums" }}>
                        {fmt(v)}
                      </text>
                    </g>
                  );
                })}
                <text x={PAD.left + i * gw + gw / 2} y={height - 9} textAnchor="middle" fontSize={11} fontWeight={800} fill={INK}>
                  {g}
                </text>
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

/**
 * Two horizontal bar panels sharing one row label — an EVENT LIST, not a
 * distribution.
 *
 * The vertical bar charts above answer "which month / which weekday". This
 * answers a different question: "what happened at each of the last N events,
 * in order". Rows are events, newest at the top, and the whole point is that
 * the trigger and the reaction sit on the SAME ROW so you can read one against
 * the other — a +40% VIX pop next to the SPX session that followed it, an
 * earnings gap next to the day's close.
 *
 * TWO PANELS, TWO SCALES, and that is not a mistake to be fixed. A VIX pop
 * runs +20% to +180%; the SPX session after it runs ±5%. Forcing them onto one
 * axis would render every SPX bar as a hairline. They are different quantities
 * measured in the same unit, so each panel carries its own axis and prints its
 * own range in the header — the comparison the chart supports is rank and
 * sign, not length across the gutter.
 *
 * A panel whose values are all one sign puts zero at its left edge and grows
 * one way; a panel with both signs puts zero in the middle. That is decided
 * from the data, so a filtered view of only-positive events does not waste half
 * its width on an empty negative half.
 */
function HBars({
  rows,
  aTitle,
  bTitle,
  fmtA,
  fmtB,
  aColor,
  bColor,
  maxHeight = 520,
  rowH = 20,
}: {
  rows: { key: string; label: string; sub?: string; a: number | null; b: number | null }[];
  aTitle: string;
  bTitle: string;
  fmtA: (v: number) => string;
  fmtB: (v: number) => string;
  /** Fixed hue for panel A. Omit to colour by sign. */
  aColor?: string;
  /** Fixed hue for panel B. Omit to colour by sign. */
  bColor?: string;
  maxHeight?: number;
  rowH?: number;
}) {
  const [ref, width] = useMeasuredWidth();
  const [hover, setHover] = useState<number | null>(null);

  const LABEL_W = 104;
  const GAP = 16;
  const panelW = Math.max(60, (width - LABEL_W - GAP) / 2);

  /** lo/hi for one panel, with zero always inside the domain. */
  const domain = (vals: (number | null)[]) => {
    const ok = vals.filter((v): v is number => v != null && Number.isFinite(v));
    const lo = Math.min(0, ...ok);
    const hi = Math.max(0, ...ok);
    const pad = (hi - lo) * 0.06 || 0.0001;
    return { lo: lo - (lo < 0 ? pad : 0), hi: hi + (hi > 0 ? pad : 0) };
  };
  const dA = useMemo(() => domain(rows.map((r) => r.a)), [rows]);
  const dB = useMemo(() => domain(rows.map((r) => r.b)), [rows]);

  const scale = (v: number, d: { lo: number; hi: number }, x0: number) =>
    x0 + ((v - d.lo) / (d.hi - d.lo || 1)) * panelW;

  const H = rows.length * rowH;

  const panelHead = (title: string, d: { lo: number; hi: number }, fmt: (v: number) => string) => (
    <div style={{ width: panelW, minWidth: 0 }}>
      <div style={{ ...capLabel, fontSize: 9.5, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 10, color: INK, opacity: 0.8, display: "flex", justifyContent: "space-between", fontVariantNumeric: "tabular-nums" }}>
        <span>{fmt(d.lo)}</span>
        <span>{fmt(d.hi)}</span>
      </div>
    </div>
  );

  return (
    <div ref={ref} style={{ width: "100%" }}>
      {width > 0 && rows.length ? (
        <>
          {/* Panel headings live in HTML above the SVG rather than as <text>
              inside it: they are the axis labels, they never need to scroll
              with the rows, and this way the row area can be a plain
              overflow:auto box without a sticky-SVG trick. */}
          <div style={{ display: "flex", gap: GAP, marginBottom: 6 }}>
            <div style={{ width: LABEL_W, flex: "none" }} />
            {panelHead(aTitle, dA, fmtA)}
            {panelHead(bTitle, dB, fmtB)}
          </div>

          <div style={{ maxHeight, overflowY: "auto", overflowX: "hidden" }}>
            <svg
              width={width}
              height={H}
              role="img"
              aria-label={`${aTitle} and ${bTitle} for the last ${rows.length} events`}
              style={{ display: "block", touchAction: "none" }}
              onPointerLeave={() => setHover(null)}
            >
              {/* zero baselines, drawn once behind everything */}
              <line x1={scale(0, dA, LABEL_W)} x2={scale(0, dA, LABEL_W)} y1={0} y2={H} stroke="rgba(255,255,255,0.32)" />
              <line
                x1={scale(0, dB, LABEL_W + panelW + GAP)}
                x2={scale(0, dB, LABEL_W + panelW + GAP)}
                y1={0}
                y2={H}
                stroke="rgba(255,255,255,0.32)"
              />

              {rows.map((r, i) => {
                const yTop = i * rowH;
                const on = hover == null || hover === i;
                const bar = (v: number | null, d: { lo: number; hi: number }, x0: number, fixed?: string, fmt?: (n: number) => string) => {
                  if (v == null || !Number.isFinite(v)) return null;
                  const xz = scale(0, d, x0);
                  const xv = scale(v, d, x0);
                  const x = Math.min(xz, xv);
                  const w = Math.max(1.2, Math.abs(xv - xz));
                  const col = fixed ?? (v >= 0 ? UP : DOWN);
                  // Value text goes on the far side of the bar's own end, and
                  // only when there is room for it inside the panel.
                  const right = xv >= xz;
                  const tx = right ? xv + 4 : xv - 4;
                  const room = right ? x0 + panelW - xv > 46 : xv - x0 > 46;
                  return (
                    <>
                      <rect x={x} y={yTop + 3} width={w} height={rowH - 7} rx={2} fill={col} opacity={on ? 1 : 0.45} />
                      {room && fmt ? (
                        <text
                          x={tx}
                          y={yTop + rowH / 2 + 3}
                          textAnchor={right ? "start" : "end"}
                          fontSize={9.5}
                          fill={INK}
                          opacity={on ? 0.95 : 0.4}
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {fmt(v)}
                        </text>
                      ) : null}
                    </>
                  );
                };
                return (
                  <g key={r.key} onPointerEnter={() => setHover(i)}>
                    <rect x={0} y={yTop} width={width} height={rowH} fill={hover === i ? "rgba(255,255,255,0.05)" : "transparent"} />
                    <text x={0} y={yTop + rowH / 2 + 4} fontSize={10.5} fontWeight={700} fill={INK} opacity={on ? 1 : 0.5} style={{ fontVariantNumeric: "tabular-nums" }}>
                      {r.label}
                    </text>
                    {bar(r.a, dA, LABEL_W, aColor, fmtA)}
                    {bar(r.b, dB, LABEL_W + panelW + GAP, bColor, fmtB)}
                  </g>
                );
              })}
            </svg>
          </div>

          <div style={{ minHeight: 20, marginTop: 6, fontSize: 12, color: INK, fontVariantNumeric: "tabular-nums" }}>
            {hover != null && rows[hover]
              ? `${rows[hover].label}${rows[hover].sub ? ` · ${rows[hover].sub}` : ""} · ${aTitle} ${rows[hover].a == null ? "—" : fmtA(rows[hover].a as number)} · ${bTitle} ${rows[hover].b == null ? "—" : fmtB(rows[hover].b as number)}`
              : "Hover a row for the detail."}
          </div>
        </>
      ) : (
        <div style={{ height: Math.min(maxHeight, rows.length * rowH) + 44 }} />
      )}
    </div>
  );
}

// ── event studies ───────────────────────────────────────────────────────────

/**
 * A window return off a cumulative-% curve.
 *
 * The curves in seasonalityData are cumulative percent from the prior
 * year-end, so a return between two days is the RATIO of the two wealth
 * factors — (100+b)/(100+a) − 1 — and not the difference of the two
 * percentages. Subtracting them is the classic error here and it is wrong by
 * the compounding, which on a 30%-up year is a fifth of the answer.
 */
function curveWindow(curve: number[] | null, from: number, to: number): number | null {
  if (!curve) return null;
  if (from < 0 || to < 0 || from >= curve.length || to >= curve.length) return null;
  const a = 100 + curve[from];
  const b = 100 + curve[to];
  if (!(a > 0) || !(b > 0)) return null;
  return b / a - 1;
}

/** Mean of the non-null values, or null when there are none. */
const mean = (vals: (number | null)[]): number | null => {
  const ok = vals.filter((v): v is number => v != null && Number.isFinite(v));
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
};
/** Share of non-null values that are positive. */
const hitRate = (vals: (number | null)[]): number | null => {
  const ok = vals.filter((v): v is number => v != null && Number.isFinite(v));
  return ok.length ? ok.filter((v) => v > 0).length / ok.length : null;
};
const countOf = (vals: (number | null)[]) =>
  vals.filter((v): v is number => v != null && Number.isFinite(v)).length;
/**
 * Largest / smallest non-null value, or null.
 *
 * Math.max(...[]) is −Infinity and Math.max over an array whose nulls were
 * coalesced to a sentinel returns the sentinel — both render as a confident,
 * wrong number rather than as a dash. Hence the explicit filter.
 */
const extremeOf = (vals: (number | null)[], which: "max" | "min"): number | null => {
  const ok = vals.filter((v): v is number => v != null && Number.isFinite(v));
  if (!ok.length) return null;
  return which === "max" ? Math.max(...ok) : Math.min(...ok);
};

/**
 * One daily price series fetched once per mount, for the client-side event
 * studies.
 *
 * SPLIT-ADJUSTED closes. AAPL split 7:1 in 2014 and 4:1 in 2020, so a study
 * that reached back past either on raw closes would print a −85% "day of
 * event" and look like a data bug — because it would be one.
 *
 * Returns [] on any failure. The section renders its own empty state; it must
 * never throw on a page built to serve signed-out visitors.
 */
function useDailySeries(symbol: string | null) {
  const [rows, setRows] = useState<[string, number][]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (!symbol) return;
    const ac = new AbortController();
    setState("loading");
    (async () => {
      try {
        const r = await fetch(`/api/public-daily?symbol=${encodeURIComponent(symbol)}`, {
          signal: ac.signal,
          headers: { Accept: "application/json" },
        });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { rows?: [string, number][] };
        const out = Array.isArray(j?.rows)
          ? j.rows.filter(
              (x) => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "number" && Number.isFinite(x[1]) && x[1] > 0,
            )
          : [];
        if (!out.length) throw new Error("empty");
        setRows(out);
        setState("ready");
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setState("error");
      }
    })();
    return () => ac.abort();
  }, [symbol]);

  return { rows, state } as const;
}

/** One earnings print and what the stock did on the session that absorbed it. */
export type EarningsMove = {
  /** Report date as Yahoo carries it. */
  date: string;
  /** The session the market reacted on — the same day for a BMO print, the next for an AMC one. */
  session: string;
  /** "BMO" | "AMC" | "" */
  when: string;
  /** Reaction session close vs the prior close. */
  day: number | null;
  /** Reaction session open vs the prior close — the gap the print produced. */
  gap: number | null;
  /** Reaction session open to close — what was left to trade after the gap. */
  oc: number | null;
};

/** The whole earnings study, one cached call. */
function useEarnings(enabled: boolean) {
  const [data, setData] = useState<Record<string, EarningsMove[]>>({});
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    setState("loading");
    (async () => {
      try {
        const r = await fetch("/api/public-earnings", { signal: ac.signal, headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { tickers?: Record<string, EarningsMove[]> };
        const t = j?.tickers && typeof j.tickers === "object" ? j.tickers : null;
        if (!t || !Object.keys(t).length) throw new Error("empty");
        setData(t);
        setState("ready");
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setState("error");
      }
    })();
    return () => ac.abort();
  }, [enabled]);

  return { data, state } as const;
}

/**
 * The one place a section is allowed to say "no numbers".
 *
 * Every other card on this page renders from static data and therefore cannot
 * fail. The three event studies fetch, so they can — and a blank card is
 * indistinguishable from a broken page. This says which of the two it is.
 */
function DataState({ state, what }: { state: "idle" | "loading" | "ready" | "error"; what: string }) {
  if (state === "ready") return null;
  return (
    <div
      style={{
        padding: "26px 16px",
        borderRadius: 12,
        border: `1px dashed ${SEA.line}`,
        background: SEA.card2,
        color: INK,
        fontSize: 13,
        textAlign: "center",
      }}
    >
      {state === "error"
        ? `${what} could not be loaded right now. Everything else on this page is static and unaffected — reload to try again.`
        : `Loading ${what}…`}
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

/**
 * Which decisions the FOMC study counts.
 *
 * "wed" is the default because it is the only sample where the Mon-Tue /
 * Wednesday / Thu-Fri framing is literally true. The other two are there so a
 * reader can see what the restriction costs — and it costs a lot of the 1990s.
 */
type FomcSample = "wed" | "scheduled" | "all";

// ── the almanac ─────────────────────────────────────────────────────────────

export default function SeasonalityAlmanac({ active }: { active: SectionKey }) {
  const A = ALMANAC;
  const M = A.months;
  const [era, setEra] = useState<string>(ERA_KEYS[0]);
  const [dowEra, setDowEra] = useState<string>(ERA_KEYS[0]);

  // The live year. Used here for ONE thing — the current year's Jackson Hole
  // row, which sits days past the static data's cutoff every August — and for
  // the VIX spikes that happened after that cutoff.
  const live = useLiveYear();

  /**
   * Is today the last session of its month?
   *
   * EFFECT, not a render-time call: it reads the wall clock, and this page
   * prerenders. Starts false so the server's HTML and the first client paint
   * agree, then flips after mount. See Collapse's `autoOpen`.
   */
  const [isMonthEnd, setIsMonthEnd] = useState(false);
  // Empty until mount, and that is the correct server value: FOMC_UPCOMING
  // holds only future meetings, so "the first one after ''" is the first one,
  // which is what the server should render anyway. The effect only narrows it.
  const [todayISO, setTodayISO] = useState("");
  useEffect(() => {
    try {
      const t = nyTodayISO();
      setTodayISO(t);
      setIsMonthEnd(isLastTradingDayOfMonth(t));
    } catch {
      /* Intl unavailable — leave the section as it was. */
    }
  }, []);

  // Event-study controls. All start from constants; none is seeded from the
  // URL or storage, for the hydration reason documented in the file header.
  const [vixCount, setVixCount] = useState<number>(20);
  const [vixMeasure, setVixMeasure] = useState<"oc" | "lnh">("oc");
  const [earnTicker, setEarnTicker] = useState<string>(EARNINGS_TICKERS[0]);
  const [fomcSample, setFomcSample] = useState<FomcSample>("wed");
  const [fomcCount, setFomcCount] = useState<number>(20);
  const [appleKind, setAppleKind] = useState<AppleEventKind | "all">("all");
  const [appleCount, setAppleCount] = useState<number>(20);

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
  const eom = EXTRAS.eom;
  const opex = EXTRAS.opex;

  /**
   * The +20% spike list, with anything that fired after the static cutoff
   * prepended.
   *
   * The TILES and the LADDER above the list stay static: those are aggregates
   * over 9,000 sessions and a handful of new events cannot move them by a
   * figure this page prints. The LIST is different — a reader who came here
   * the week after a spike is looking for that spike, and a list that stops
   * three weeks ago reads as a broken page rather than a stale one.
   */
  const vixEvents = useMemo(() => {
    if (!live.extraVixEvents.length) return vix.events;
    const seen = new Set(vix.events.map((e) => e.date));
    const extra: LiveVixEvent[] = live.extraVixEvents
      .filter((e) => !seen.has(e.date))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return [...extra, ...vix.events];
  }, [vix.events, live.extraVixEvents]);

  // Bar scale for the events table — the largest move in the list, so the
  // longest bar is full width and every other bar is read against it.
  const maxLowNextHigh = Math.max(...vixEvents.map((e) => Math.abs(e.low_to_next_high)), 0.0001);

  /** The rows the horizontal spike chart draws: newest N, VIX pop vs SPX. */
  const vixBarRows = useMemo(
    () =>
      vixEvents.slice(0, vixCount).map((e) => ({
        key: e.date,
        label: fmtUS(e.date),
        sub: `VIX ${e.vix_open.toFixed(2)} → ${e.vix_high.toFixed(2)}`,
        a: e.vix_pop,
        b: vixMeasure === "oc" ? e.next_open_close : e.low_to_next_high,
      })),
    [vixEvents, vixCount, vixMeasure],
  );

  // ── Jackson Hole ─────────────────────────────────────────────────────────
  //
  // Computed here rather than baked into seasonalityData, because the only
  // input that is not already in the bundle is the CALENDAR — the price data
  // is the same YEAR_CURVES the overlay picker reads. Anchoring on the Friday
  // keynote (the Chair's speech), the three windows are:
  //   into  = the week ENDING the session before the speech   (T−8 → T−1)
  //   day   = the speech session itself                       (T−1 → T)
  //   after = the week from the speech                        (T   → T+7)
  // All three are calendar-week offsets on the forward-filled 365-day axis, so
  // T−8 and T+7 are the same weekday as T and land on real closes.
  const liveYearNum = Number(YTD_LAST_DATE.slice(0, 4));
  const jhRows = useMemo(
    () =>
      JACKSON_HOLE.map((e) => {
        const curve = e.year === liveYearNum ? live.pct : yearCurve(e.year);
        const t = calIndex(e.keynote);
        return {
          ...e,
          into: curveWindow(curve, t - 8, t - 1),
          day: curveWindow(curve, t - 1, t),
          after: curveWindow(curve, t, t + 7),
        };
      }),
    // live.pct is a new array only when the extension lands, which is exactly
    // when this needs recomputing.
    [live.pct, liveYearNum],
  );

  // ── FOMC ─────────────────────────────────────────────────────────────────
  //
  // Same machinery as Jackson Hole — an anchor date and three calendar windows
  // off the forward-filled 365-day axis — over 269 announced decisions.
  //
  //   into  = D-5 -> D-1   the two sessions before the statement
  //   day   = D-1 -> D     the statement session itself
  //   after = D   -> D+2   the two sessions after
  //
  // For a WEDNESDAY decision those are exactly Mon+Tue, the Wednesday, and
  // Thu+Fri, which is why the default sample is Wednesdays only. Widen the
  // sample and the windows are still right — they are just no longer those
  // weekdays, so the column headers change with the toggle rather than lying.
  const fomcRows = useMemo(
    () =>
      fomcDecisions()
        .map((d) => {
          const y = Number(d.date.slice(0, 4));
          const curve = y === liveYearNum ? live.pct : yearCurve(y);
          const t = calIndex(d.date);
          return {
            ...d,
            dow: dowOf(d.date),
            action: d.bps > 0 ? "Hike" : d.bps < 0 ? "Cut" : ("Hold" as const),
            into: curveWindow(curve, t - 5, t - 1),
            day: curveWindow(curve, t - 1, t),
            after: curveWindow(curve, t, t + 2),
          };
        })
        // Newest first, to match every other event list on this page.
        .reverse(),
    [live.pct, liveYearNum],
  );

  const fomcWedOnly = fomcSample === "wed";
  const fomcFiltered = useMemo(
    () =>
      fomcRows.filter((r) =>
        fomcSample === "all" ? true : fomcSample === "scheduled" ? r.scheduled : r.scheduled && r.dow === "Wed",
      ),
    [fomcRows, fomcSample],
  );

  /** Column headings. They MUST follow the sample — see the note above. */
  const L_INTO = fomcWedOnly ? "Mon\u2013Tue" : "Two sessions before";
  const L_DAY = fomcWedOnly ? "Wednesday" : "Decision day";
  const L_AFTER = fomcWedOnly ? "Thu\u2013Fri" : "Two sessions after";

  const fomcByAction = useMemo(
    () =>
      (["Hike", "Hold", "Cut"] as const).map((a) => {
        const rows = fomcFiltered.filter((r) => r.action === a);
        return {
          label: a,
          n: rows.length,
          into: mean(rows.map((r) => r.into)),
          day: mean(rows.map((r) => r.day)),
          after: mean(rows.map((r) => r.after)),
          hitDay: hitRate(rows.map((r) => r.day)),
          hitAfter: hitRate(rows.map((r) => r.after)),
        };
      }),
    [fomcFiltered],
  );

  /** Does the SIZE of the move matter, or only its direction? */
  const fomcBySize = useMemo(() => {
    const buckets: { label: string; test: (b: number) => boolean }[] = [
      { label: "Hike 50bp or more", test: (b) => b >= 50 },
      { label: "Hike 25bp", test: (b) => b > 0 && b < 50 },
      { label: "Hold", test: (b) => b === 0 },
      { label: "Cut 25bp", test: (b) => b < 0 && b > -50 },
      { label: "Cut 50bp or more", test: (b) => b <= -50 },
    ];
    return buckets.map((k) => {
      const rows = fomcFiltered.filter((r) => k.test(r.bps));
      return {
        label: k.label,
        n: rows.length,
        into: mean(rows.map((r) => r.into)),
        day: mean(rows.map((r) => r.day)),
        after: mean(rows.map((r) => r.after)),
        hitDay: hitRate(rows.map((r) => r.day)),
      };
    });
  }, [fomcFiltered]);

  /** The next scheduled meeting, for the tile. */
  const fomcNext = FOMC_UPCOMING.find((m) => m.date > todayISO) ?? null;
  /** Where the target sits now — read from the last decision, never typed in. */
  const fomcLast = fomcRows[0];

  // ── Apple product events ─────────────────────────────────────────────────
  const aapl = useDailySeries(active === "aapl" ? "AAPL" : null);
  const appleRows = useMemo(() => {
    if (!aapl.rows.length) return [];
    const dates = aapl.rows.map((r) => r[0]);
    const px = aapl.rows.map((r) => r[1]);
    /** Index of the session the market first reacts on. */
    const sessionFor = (iso: string): number => {
      let lo = 0;
      let hi = dates.length - 1;
      let ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (dates[mid] <= iso) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      if (ans < 0) return -1;
      // Exact hit = the keynote fell on a session, which is the normal case
      // (Apple runs these at 10:00 PT, mid-session). Otherwise the reaction is
      // the NEXT session, not the previous one.
      return dates[ans] === iso ? ans : ans + 1;
    };
    const ret = (a: number, b: number): number | null =>
      a < 0 || b < 0 || a >= px.length || b >= px.length ? null : px[b] / px[a] - 1;

    return APPLE_EVENTS.map((ev) => {
      const i = sessionFor(ev.date);
      if (i < 0 || i >= px.length) {
        return { ...ev, session: null, into: null, day: null, next: null, week: null, month: null };
      }
      return {
        ...ev,
        session: dates[i],
        into: ret(i - 6, i - 1),   // the five sessions before the keynote
        day: ret(i - 1, i),        // the keynote session
        next: ret(i, i + 1),       // the morning after
        week: ret(i, i + 5),       // the week from the keynote
        month: ret(i, i + 21),     // ~one month from the keynote
      };
    });
  }, [aapl.rows]);

  const appleFiltered = useMemo(
    () => (appleKind === "all" ? appleRows : appleRows.filter((r) => r.kind === appleKind)),
    [appleRows, appleKind],
  );

  /** Averages by event kind — the summary the table is too long to give. */
  const appleByKind = useMemo(() => {
    const kinds = APPLE_EVENT_KINDS.filter((k) => k.k !== "all") as { k: AppleEventKind; label: string }[];
    return kinds.map((k) => {
      const rows = appleRows.filter((r) => r.kind === k.k);
      return {
        key: k.k,
        label: k.label,
        n: rows.length,
        day: mean(rows.map((r) => r.day)) ?? 0,
        week: mean(rows.map((r) => r.week)) ?? 0,
        into: mean(rows.map((r) => r.into)) ?? 0,
        hit: hitRate(rows.map((r) => r.day)),
      };
    });
  }, [appleRows]);

  // ── Earnings ─────────────────────────────────────────────────────────────
  const earn = useEarnings(active === "earn");
  const earnRows = earn.data[earnTicker] ?? [];

  const SECTIONS: Partial<Record<SectionKey, ReactNode>> = {
    now: (
      <SeaCard title="Where the Calendar Stands" subtitle={`Last close ${now.as_of} · session ${now.trading_day_of_year} of the trading year`} padding={20}>
        <div style={TILES}>
          <Tile label="Rest of year · mean" value={pct(royMod.avg)} sub={`since 1985 · ${royMod.n} years`} color={signColor(royMod.avg)} />
          <Tile label="Rest of year · positive" value={pctp(royMod.pos_pct, 0)} sub={`${Math.round(royMod.pos_pct * royMod.n)} of ${royMod.n} years`} />
          <Tile label={win.window} value={pct(win.avg)} sub={`all history · ${pctp(win.pos_pct, 0)} positive`} color={signColor(win.avg)} />
          <Tile label="Worst rest-of-year" value={pct(royAll.worst)} sub={`all history · ${royAll.n} years`} color={DOWN} />
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

        {/* ── The event chart ──────────────────────────────────────────────
            The tiles above are averages over 284 events, which is the right
            number and the wrong picture: an average of +0.35% hides that the
            distribution runs from −6% to +7%. This draws the last N events
            individually, the pop beside the session it produced, so the
            dispersion is the first thing you see and the mean is something you
            read INTO it rather than instead of it. */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "18px 0 10px" }}>
          <span style={capLabel}>Last</span>
          {[20, 50].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={vixCount === n}
              onClick={() => setVixCount(n)}
              style={pillBtn(vixCount === n)}
            >
              {n} events
            </button>
          ))}
          <span style={{ ...capLabel, marginLeft: 8 }}>SPX measure</span>
          {([
            { k: "oc" as const, label: "Next open → close" },
            { k: "lnh" as const, label: "Low → next high" },
          ]).map((m) => (
            <button
              key={m.k}
              type="button"
              aria-pressed={vixMeasure === m.k}
              onClick={() => setVixMeasure(m.k)}
              style={pillBtn(vixMeasure === m.k)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <HBars
          rows={vixBarRows}
          aTitle="VIX pop (prev close → high)"
          bTitle={vixMeasure === "oc" ? "SPX next session, open → close" : "SPX low → next session high"}
          fmtA={(v) => pctp(v, 0)}
          fmtB={(v) => pct(v, 1)}
          aColor={A1}
          maxHeight={vixCount > 20 ? 520 : 460}
        />

        <div style={{ ...NOTE, marginTop: 8 }}>
          Left is the trigger, right is what followed — same row, two scales,
          because a VIX pop is measured in tens of percent and the SPX session
          after it in tenths. Read the right column for its <em>sign and
          spread</em>, not its length against the left one. On{" "}
          <b>next open → close</b> the reaction is tradeable: you know a spike
          happened before that open. On <b>low → next high</b> it is not — both
          ends are ticks you can only identify afterwards, which is why that
          version looks so much better.
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
          hint={`${n0(vixEvents.length)} events, newest first`}
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
            rows={vixEvents.map((e) => [
              fmtUS(e.date),
              pctp(e.vix_pop, 2),
              { t: pct(e.low_to_next_high, 2), c: signColor(e.low_to_next_high), bar: Math.abs(e.low_to_next_high) / maxLowNextHigh },
              { t: pct(e.next_open_close, 2), c: signColor(e.next_open_close) },
            ])}
          />
        </Collapse>

      </SeaCard>
    ),
    // ── FOMC ───────────────────────────────────────────────────────────────
    fomc: (
      <SeaCard
        title="FOMC Decisions"
        subtitle={`${n0(fomcRows.length)} announced decisions since ${fomcRows[fomcRows.length - 1].date.slice(0, 4)} · SPX around the statement`}
        padding={20}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <span style={{ ...capLabel, marginRight: 2 }}>Sample</span>
          {([
            { k: "wed" as FomcSample, label: "Wednesday decisions" },
            { k: "scheduled" as FomcSample, label: "All scheduled meetings" },
            { k: "all" as FomcSample, label: "Incl. emergency cuts" },
          ]).map((o) => (
            <button key={o.k} type="button" aria-pressed={fomcSample === o.k} onClick={() => setFomcSample(o.k)} style={pillBtn(fomcSample === o.k)}>
              {o.label}
            </button>
          ))}
        </div>

        <div style={TILES}>
          <Tile
            label="Decisions"
            value={n0(fomcFiltered.length)}
            sub={fomcWedOnly ? "statement landed on a Wednesday" : fomcSample === "scheduled" ? "scheduled meetings only" : "every announced decision"}
          />
          <Tile
            label={L_INTO}
            value={pct(mean(fomcFiltered.map((r) => r.into)))}
            sub={`${pctp(hitRate(fomcFiltered.map((r) => r.into)), 0)} positive`}
            color={signColor(mean(fomcFiltered.map((r) => r.into)))}
          />
          <Tile
            label={L_DAY}
            value={pct(mean(fomcFiltered.map((r) => r.day)))}
            sub={`${pctp(hitRate(fomcFiltered.map((r) => r.day)), 0)} positive`}
            color={signColor(mean(fomcFiltered.map((r) => r.day)))}
          />
          <Tile
            label={L_AFTER}
            value={pct(mean(fomcFiltered.map((r) => r.after)))}
            sub={`${pctp(hitRate(fomcFiltered.map((r) => r.after)), 0)} positive`}
            color={signColor(mean(fomcFiltered.map((r) => r.after)))}
          />
          <Tile
            label="Next meeting"
            value={fomcNext ? fmtSpan(fomcNext.start, fomcNext.date) : "TBA"}
            sub={fomcNext ? `decision ${fmtLongDate(fomcNext.date)}${fomcNext.sep ? " · with projections" : ""}` : "calendar not yet published"}
          />
          <Tile
            label="Target now"
            value={`${fomcLast.level.toFixed(2)}%`}
            sub={`upper bound · set ${fmtUS(fomcLast.date)}`}
          />
        </div>

        {/* THE headline chart: the three windows, whole sample, three bars.
            Deliberately the first thing under the tiles and deliberately dumber
            than the grouped chart below it — "what does SPX do into, on, and
            after an FOMC" is the question people actually arrive with, and it
            should not require reading a nine-bar chart to answer. The split by
            what the Fed did is the follow-up question, so it comes second. */}
        <div style={{ marginTop: 20 }}>
          <div style={{ ...capLabel, marginBottom: 8 }}>
            Every decision in this sample &middot; n={n0(fomcFiltered.length)}
          </div>
          <DivBars
            labels={[L_INTO, L_DAY, L_AFTER]}
            values={[
              mean(fomcFiltered.map((r) => r.into)) ?? 0,
              mean(fomcFiltered.map((r) => r.day)) ?? 0,
              mean(fomcFiltered.map((r) => r.after)) ?? 0,
            ]}
            fmt={(v) => bp(v, 0)}
            height={230}
            readout={(i) => {
              const key = (["into", "day", "after"] as const)[i];
              const label = [L_INTO, L_DAY, L_AFTER][i];
              const vals = fomcFiltered.map((r) => r[key]);
              return `${label} · mean ${pct(mean(vals))} · ${pctp(hitRate(vals), 1)} positive · best ${pct(extremeOf(vals, "max"), 1)} · worst ${pct(extremeOf(vals, "min"), 1)} · n=${countOf(vals)}`;
            }}
          />
        </div>

        {/* The follow-up question: does what the Fed DID change what the tape
            did around it? */}
        <div style={{ marginTop: 20 }}>
          <Legend
            items={[
              { color: A1, label: L_INTO },
              { color: A2, label: L_DAY },
              { color: A3, label: L_AFTER },
            ]}
          />
          <MultiBars
            groups={fomcByAction.map((a) => `${a.label} (n=${a.n})`)}
            series={[
              { label: L_INTO, color: A1, values: fomcByAction.map((a) => a.into) },
              { label: L_DAY, color: A2, values: fomcByAction.map((a) => a.day) },
              { label: L_AFTER, color: A3, values: fomcByAction.map((a) => a.after) },
            ]}
            fmt={(v) => bp(v, 0)}
            height={280}
            readout={(i) => {
              const a = fomcByAction[i];
              return `${a.label} · n=${a.n} · ${L_INTO} ${pct(a.into)} · ${L_DAY} ${pct(a.day)} (${pctp(a.hitDay, 0)} positive) · ${L_AFTER} ${pct(a.after)} (${pctp(a.hitAfter, 0)})`;
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "18px 0 10px" }}>
          <span style={capLabel}>Last</span>
          {[20, 50].map((n) => (
            <button key={n} type="button" aria-pressed={fomcCount === n} onClick={() => setFomcCount(n)} style={pillBtn(fomcCount === n)}>
              {n} decisions
            </button>
          ))}
        </div>

        <HBars
          rows={fomcFiltered.slice(0, fomcCount).map((r) => ({
            key: r.date,
            label: fmtUS(r.date),
            sub: `${r.bps === 0 ? "hold" : `${r.bps > 0 ? "+" : ""}${r.bps}bp`} to ${r.level.toFixed(2)}%`,
            a: r.day,
            b: r.after,
          }))}
          aTitle={L_DAY}
          bTitle={L_AFTER}
          fmtA={(v) => pct(v, 1)}
          fmtB={(v) => pct(v, 1)}
          maxHeight={fomcCount > 20 ? 520 : 460}
        />

        <Collapse
          open
          label="By what the Fed did"
          hint="direction of the decision"
          note={
            <>
              <strong>The windows.</strong> {L_INTO} is the two sessions before the statement, {L_DAY} is
            the statement session itself, {L_AFTER} is the two sessions after. With the sample set to
              <em> Wednesday decisions</em> those are literally Monday–Tuesday, the Wednesday and
            Thursday–Friday; widen the sample and the headings change with it, because the one-day
            meetings of the 1990s and mid-2000s were routinely TUESDAYS — {n0(fomcRows.filter((r) => r.dow === "Tue").length)}{" "}
              of the {n0(fomcRows.length)} decisions here, against {n0(fomcRows.filter((r) => r.dow === "Wed").length)}{" "}
            Wednesdays.
              <br />
              <br />
              <strong>What it says.</strong> Nothing dramatic, which is the honest answer. The statement
            session is the loudest of the three by dispersion, not by mean — the averages here are
            tens of basis points and the individual days run from −4.9% (17 Sep 2001, the session
            equities reopened after 9/11) to +5.1% (16 Dec 2008, the cut to zero). And the sign of the decision is
            not the sign of the tape: the market has fallen on cuts and rallied on hikes often enough
            that the split below is a description of what happened, not a rule. Read the <i>n</i>
            column on every row before you read the mean.
              <br />
              <br />
              A decision is dated by the day the STATEMENT was released. The Fed&apos;s own rate-change
            table is dated by the day the new target takes EFFECT, which is the day after — anchoring
            on that column puts every window one session late.
            </>
          }
        >
          <DataTable
            head={["Decision", "n", L_INTO, L_DAY, "positive", L_AFTER, "positive"]}
            rows={fomcByAction.map((a) => [
              a.label,
              a.n,
              { t: pct(a.into), c: signColor(a.into) },
              { t: pct(a.day), c: signColor(a.day) },
              pctp(a.hitDay, 0),
              { t: pct(a.after), c: signColor(a.after) },
              pctp(a.hitAfter, 0),
            ])}
          />
        </Collapse>

        <Collapse
          label="By size of the move"
          hint="does 50bp land differently from 25bp?"
          note={
            <>
              Splitting the cuts is where the sample thins fastest, and it is also where the selection
            problem bites: a 50bp+ cut is not a bigger version of a 25bp cut, it is what the Fed does
            when something is already breaking. 2008 and March 2020 are most of that row, so
            whatever sign it carries is the crisis talking and not the cut — which is also why it
            flips when you change the sample.
            </>
          }
        >
          <DataTable
            head={["Move", "n", L_INTO, L_DAY, "positive", L_AFTER]}
            rows={fomcBySize.map((k) => [
              k.label,
              k.n,
              { t: pct(k.into), c: signColor(k.into) },
              { t: pct(k.day), c: signColor(k.day) },
              pctp(k.hitDay, 0),
              { t: pct(k.after), c: signColor(k.after) },
            ])}
          />
        </Collapse>

        <Collapse
          label="Every decision"
          hint={`${n0(fomcFiltered.length)} in this sample, newest first`}
          note={
            <>
              Holds are rows. {n0(fomcRows.filter((r) => r.bps === 0).length)} of the{" "}
              {n0(fomcRows.length)} decisions changed nothing, and dropping them would turn this from
            &ldquo;what does SPX do around an FOMC&rdquo; into &ldquo;what does it do around a rate
            change&rdquo; — a different, much smaller and much more selected study.
              <br />
              <br />
              The record starts at <strong>4 February 1994</strong>, the first decision the Fed ever
            announced. Before that a change had to be inferred from open-market operations days
            later, so there is no honest event date to anchor on. Rate levels are the target through
            2008 and the upper bound of the range after it.
            </>
          }
        >
          <DataTable
            head={["Statement", "Day", "Meeting", "Move", "Target", L_INTO, L_DAY, L_AFTER]}
            rows={fomcFiltered.map((r) => [
              fmtUS(r.date) + (r.scheduled ? "" : " *"),
              r.dow,
              r.start === r.date ? "one day" : fmtSpan(r.start, r.date),
              {
                t: r.bps === 0 ? "hold" : `${r.bps > 0 ? "+" : ""}${r.bps} bp`,
                c: r.bps > 0 ? DOWN : r.bps < 0 ? UP : INK,
              },
              `${r.level.toFixed(2)}%`,
              { t: pct(r.into, 2), c: signColor(r.into) },
              { t: pct(r.day, 2), c: signColor(r.day) },
              { t: pct(r.after, 2), c: signColor(r.after) },
            ])}
          />
          <div style={{ ...NOTE, fontSize: 11.5 }}>
            * an intermeeting action — a conference call, not a scheduled meeting. There are{" "}
            {n0(fomcRows.filter((r) => !r.scheduled).length)} of them, and the emergency cut of
            15 March 2020 fell on a <b>Sunday</b>, so its one-session window is empty by
            construction.
          </div>
        </Collapse>
      </SeaCard>
    ),

    // ── Jackson Hole ───────────────────────────────────────────────────────
    jh: (
      <SeaCard
        title="Jackson Hole"
        subtitle={`Kansas City Fed symposium · ${JACKSON_HOLE[JACKSON_HOLE.length - 1].year}–${JACKSON_HOLE[0].year} · SPX around the Friday keynote`}
        padding={20}
      >
        <div style={TILES}>
          <Tile
            label="Week into it"
            value={pct(mean(jhRows.map((r) => r.into)))}
            sub={`${countOf(jhRows.map((r) => r.into))} symposia · ${pctp(hitRate(jhRows.map((r) => r.into)), 0)} positive`}
            color={signColor(mean(jhRows.map((r) => r.into)))}
          />
          <Tile
            label="Keynote session"
            value={pct(mean(jhRows.map((r) => r.day)))}
            sub={`${pctp(hitRate(jhRows.map((r) => r.day)), 0)} positive · median day ±1%`}
            color={signColor(mean(jhRows.map((r) => r.day)))}
          />
          <Tile
            label="Week after"
            value={pct(mean(jhRows.map((r) => r.after)))}
            sub={`${pctp(hitRate(jhRows.map((r) => r.after)), 0)} positive · ${countOf(jhRows.map((r) => r.after))} years`}
            color={signColor(mean(jhRows.map((r) => r.after)))}
          />
          <Tile
            label="Next symposium"
            value={fmtSpan(JACKSON_HOLE[0].start, JACKSON_HOLE[0].end)}
            sub={`${JACKSON_HOLE[0].year} · keynote ${fmtLongDate(JACKSON_HOLE[0].keynote)}`}
          />
        </div>

        <div style={{ marginTop: 18 }}>
          <HBars
            rows={jhRows.map((r) => ({
              key: String(r.year),
              label: `${r.year}`,
              sub: fmtSpan(r.start, r.end),
              a: r.day,
              b: r.after,
            }))}
            aTitle="Keynote session"
            bTitle="Week after the keynote"
            fmtA={(v) => pct(v, 1)}
            fmtB={(v) => pct(v, 1)}
            maxHeight={520}
          />
        </div>

        <Collapse
          open
          label="Every symposium"
          hint="newest first · SPX, price only"
          note={
            <>
              The anchor is the <strong>Friday keynote</strong> — the Chair&apos;s speech — not the
            opening day, because that is the session the event actually lands in.{" "}
              <em>Week into it</em> is the calendar week ending the session before the speech;{" "}
              <em>keynote</em> is that session alone; <em>week after</em> is the speech close to the
            following Friday&apos;s close. Two years break the pattern and are marked in the table:
            2020 was virtual with the speech on the Thursday, and 2021 was compressed to one day.
              <br />
              <br />
              What the numbers say is mostly &ldquo;not much&rdquo;. Thirty-seven observations is a
            small sample for a one-day event, and the standard deviation of the keynote session is
            several times its mean — which is the honest reading of every &ldquo;Jackson Hole
            effect&rdquo; you will see quoted. The years that make the average are the ones where
            the speech carried a policy turn (2010, 2012, 2022); the rest are noise around zero.
            </>
          }
        >
          <DataTable
            head={["Year", "Symposium", "Keynote", "Week into", "Keynote day", "Week after", "Theme"]}
            rows={jhRows.map((r) => [
              { t: String(r.year) + (r.note ? " *" : ""), c: INK },
              fmtSpan(r.start, r.end),
              fmtLongDate(r.keynote),
              { t: pct(r.into), c: signColor(r.into) },
              { t: pct(r.day), c: signColor(r.day) },
              { t: pct(r.after), c: signColor(r.after) },
              r.theme,
            ])}
          />
          <div style={{ ...NOTE, fontSize: 11.5 }}>
            * {jhRows.filter((r) => r.note).map((r) => `${r.year}: ${r.note}`).join(" · ")}
            {live.live ? ` · ${liveYearNum} windows use sessions through ${live.lastDate}.` : ""}
          </div>
        </Collapse>
      </SeaCard>
    ),

    // ── Earnings ───────────────────────────────────────────────────────────
    earn: (
      <SeaCard
        title="Earnings Reactions"
        subtitle={`Last ${earnRows.length || 20} prints per name · the session that absorbed the report`}
        padding={20}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <span style={{ ...capLabel, marginRight: 2 }}>Ticker</span>
          {EARNINGS_TICKERS.map((t) => (
            <button key={t} type="button" aria-pressed={t === earnTicker} onClick={() => setEarnTicker(t)} style={pillBtn(t === earnTicker)}>
              {t}
            </button>
          ))}
        </div>

        {earn.state !== "ready" ? (
          <DataState state={earn.state} what="the earnings calendar" />
        ) : !earnRows.length ? (
          <DataState state="error" what={`${earnTicker}'s earnings history`} />
        ) : (
          <>
            <div style={TILES}>
              <Tile label="Prints" value={n0(earnRows.length)} sub={`${earnTicker} · most recent first`} />
              <Tile
                label="Average move"
                value={pct(mean(earnRows.map((r) => (r.day == null ? null : Math.abs(r.day)))), 1)}
                sub="absolute, reaction session close-to-close"
              />
              <Tile
                label="Up on the print"
                value={pctp(hitRate(earnRows.map((r) => r.day)), 0)}
                sub={`${earnRows.filter((r) => (r.day ?? 0) > 0).length} of ${countOf(earnRows.map((r) => r.day))}`}
              />
              <Tile
                label="Biggest / worst"
                value={
                  <span>
                    <span style={{ color: UP }}>{pct(extremeOf(earnRows.map((r) => r.day), "max"), 1)}</span>
                    <span> / </span>
                    <span style={{ color: DOWN }}>{pct(extremeOf(earnRows.map((r) => r.day), "min"), 1)}</span>
                  </span>
                }
                sub="in this window"
              />
            </div>

            <div style={{ marginTop: 18 }}>
              <HBars
                rows={earnRows.map((r) => ({
                  key: r.session || r.date,
                  label: fmtUS(r.session || r.date),
                  sub: r.when || "timing unknown",
                  a: r.gap,
                  b: r.day,
                }))}
                aTitle="Gap on the open"
                bTitle="Reaction session, close-to-close"
                fmtA={(v) => pct(v, 1)}
                fmtB={(v) => pct(v, 1)}
                maxHeight={460}
              />
            </div>

            <Collapse
              open
              label={`${earnTicker} — every print in the window`}
              hint="newest first"
              note={
                <>
                  <strong>Which session counts.</strong> A company that reports <em>after</em> the
                close (AMC) is absorbed by the NEXT session; one that reports <em>before</em> the
                open (BMO) by the same session. The rows below are anchored on that reaction
                session, not on the report date, which is why the two dates differ for most of
                these names — the mega-caps almost all report AMC.
                  <br />
                  <br />
                  <strong>Gap vs day.</strong> The gap is the open against the prior close: the part
                you cannot trade, because it happens while the market is shut. The close-to-close
                move is the whole reaction. When those two numbers disagree in sign, the session
                spent the day taking back the print — which is the pattern worth looking for here,
                and it is far more common than the headline number suggests.
                  <br />
                  <br />
                  Report dates come from the public earnings calendar and prices are split-adjusted.
                A date the calendar has wrong will put the reaction on the wrong session; cross-check
                any row that looks extraordinary before you build anything on it.
                </>
              }
            >
              <DataTable
                head={["Reaction session", "Reported", "When", "Gap", "Open → close", "Close-to-close"]}
                rows={earnRows.map((r) => [
                  fmtUS(r.session || r.date),
                  fmtUS(r.date),
                  r.when || "—",
                  { t: pct(r.gap, 2), c: signColor(r.gap) },
                  { t: pct(r.oc, 2), c: signColor(r.oc) },
                  { t: pct(r.day, 2), c: signColor(r.day) },
                ])}
              />
            </Collapse>
          </>
        )}
      </SeaCard>
    ),

    // ── Apple product events ───────────────────────────────────────────────
    aapl: (
      <SeaCard
        title="Apple Product Events"
        subtitle={`${APPLE_EVENTS.length} keynotes, ${APPLE_EVENTS[APPLE_EVENTS.length - 1].date.slice(0, 4)}–${APPLE_EVENTS[0].date.slice(0, 4)} · AAPL, split-adjusted`}
        padding={20}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <span style={{ ...capLabel, marginRight: 2 }}>Event</span>
          {APPLE_EVENT_KINDS.map((k) => (
            <button key={k.k} type="button" aria-pressed={appleKind === k.k} onClick={() => setAppleKind(k.k)} style={pillBtn(appleKind === k.k)}>
              {k.label}
            </button>
          ))}
          <span style={{ ...capLabel, marginLeft: 8 }}>Chart</span>
          {[20, 50].map((n) => (
            <button key={n} type="button" aria-pressed={appleCount === n} onClick={() => setAppleCount(n)} style={pillBtn(appleCount === n)}>
              last {n}
            </button>
          ))}
        </div>

        {aapl.state !== "ready" ? (
          <DataState state={aapl.state} what="AAPL price history" />
        ) : (
          <>
            <div style={TILES}>
              <Tile label="Events" value={n0(appleFiltered.length)} sub={appleKind === "all" ? "all keynotes" : APPLE_EVENT_KINDS.find((k) => k.k === appleKind)?.label} />
              <Tile
                label="Week into it"
                value={pct(mean(appleFiltered.map((r) => r.into)), 1)}
                sub={`${pctp(hitRate(appleFiltered.map((r) => r.into)), 0)} positive`}
                color={signColor(mean(appleFiltered.map((r) => r.into)))}
              />
              <Tile
                label="Day of the event"
                value={pct(mean(appleFiltered.map((r) => r.day)), 1)}
                sub={`${pctp(hitRate(appleFiltered.map((r) => r.day)), 0)} positive`}
                color={signColor(mean(appleFiltered.map((r) => r.day)))}
              />
              <Tile
                label="Week after"
                value={pct(mean(appleFiltered.map((r) => r.week)), 1)}
                sub={`month after ${pct(mean(appleFiltered.map((r) => r.month)), 1)}`}
                color={signColor(mean(appleFiltered.map((r) => r.week)))}
              />
            </div>

            <div style={{ marginTop: 18 }}>
              <HBars
                rows={appleFiltered.slice(0, appleCount).map((r) => ({
                  key: r.date,
                  label: fmtUS(r.date),
                  sub: `${r.name} · ${r.headline}`,
                  a: r.day,
                  b: r.week,
                }))}
                aTitle="Day of the keynote"
                bTitle="Week after"
                fmtA={(v) => pct(v, 1)}
                fmtB={(v) => pct(v, 1)}
                maxHeight={520}
              />
            </div>

            <Collapse
              label="By event type"
              hint="which kind of keynote actually moves it"
              note={
                <>
                  The September iPhone keynote is the one that gets written about and it is not
                obviously the one that moves the stock. WWDC is a developer conference — no hardware
                to price in most years — and the spring and fall Mac events are small enough that
                the market has usually seen the leaks. Sample sizes here are in the teens, so treat
                the ordering as a description of what happened rather than a prediction.
                </>
              }
            >
              <DataTable
                head={["Event type", "n", "Week into", "Day of", "Up on the day", "Week after"]}
                rows={appleByKind.map((k) => [
                  k.label,
                  k.n,
                  { t: pct(k.into, 1), c: signColor(k.into) },
                  { t: pct(k.day, 1), c: signColor(k.day) },
                  pctp(k.hit, 0),
                  { t: pct(k.week, 1), c: signColor(k.week) },
                ])}
              />
            </Collapse>

            <Collapse
              label="Every keynote"
              hint={`${appleFiltered.length} events, newest first`}
              note={
                <>
                  Apple runs these at 10:00 Pacific, so the keynote is <em>inside</em> the cash
                session — the &ldquo;day of&rdquo; column is a live reaction, not an overnight gap,
                which is what makes this event different from an earnings print. Where a keynote
                fell on a market holiday the reaction is measured on the next session.
                  <br />
                  <br />
                  Closes are split-adjusted (7:1 in 2014, 4:1 in 2020); on raw prices those two days
                would read as −85% and −75% and the whole table would be nonsense. Product events
                only — no earnings, no shareholder meetings, and no press-release launches, because
                a study of &ldquo;how does the stock react to a keynote&rdquo; is worthless if half
                the rows are not keynotes.
                </>
              }
            >
              <DataTable
                head={["Date", "Event", "Announced", "Week into", "Day of", "Next day", "Week after", "Month after"]}
                rows={appleFiltered.map((r) => [
                  fmtUS(r.date),
                  r.name,
                  r.headline,
                  { t: pct(r.into, 1), c: signColor(r.into) },
                  { t: pct(r.day, 1), c: signColor(r.day) },
                  { t: pct(r.next, 1), c: signColor(r.next) },
                  { t: pct(r.week, 1), c: signColor(r.week) },
                  { t: pct(r.month, 1), c: signColor(r.month) },
                ])}
              />
            </Collapse>
          </>
        )}
      </SeaCard>
    ),

    eom: (
      <SeaCard
        title="Last Day of the Month"
        subtitle={
          isMonthEnd
            ? "Return of the final session of a month, close-to-close · TODAY is one"
            : "Return of the final session of a month, close-to-close"
        }
        padding={20}
      >
        {/* On the day the study is actually about, say so and open the tables.
            The rest of the year this card is reference; on a month-end close it
            is the thing you came for, and making a reader click twice to reach
            it on the one day it matters is the wrong default. */}
        {isMonthEnd ? (
          <div
            style={{
              marginBottom: 14,
              padding: "10px 14px",
              borderRadius: 10,
              border: `1px solid ${HOME_THEME.cyan}66`,
              background: `linear-gradient(180deg, ${HOME_THEME.cyan}1F, ${SEA.card2})`,
              fontSize: 13,
              lineHeight: 1.55,
              color: INK,
            }}
          >
            <b>Today is the last session of the month.</b> Both tables below are open by
            default today. The base rate for this session is {bp(eom.all.avg, 1)} against
            roughly +3 bp for an average one, {pctp(eom.all.pos_pct, 1)} positive — and
            since 1985 that edge is {bp(eom.modern.avg, 1)}, which is most of the way to
            nothing.
          </div>
        ) : null}

        <div style={TILES}>
          <Tile label="Every month end" value={bp(eom.all.avg, 1)} sub={`${pctp(eom.all.pos_pct, 1)} positive`} color={signColor(eom.all.avg)} />
          <Tile label="Quarter ends" value={bp(eom.quarter.avg, 1)} sub={`Mar/Jun/Sep/Dec · ${pctp(eom.quarter.pos_pct, 1)} positive`} color={signColor(eom.quarter.avg)} />
          <Tile label="Non-quarter ends" value={bp(eom.nonquarter.avg, 1)} sub={`${pctp(eom.nonquarter.pos_pct, 1)} positive`} color={signColor(eom.nonquarter.avg)} />
          <Tile label="Since 1985" value={bp(eom.modern.avg, 1)} sub={`${pctp(eom.modern.pos_pct, 1)} positive`} color={signColor(eom.modern.avg)} />
        </div>

        <Collapse
          autoOpen={isMonthEnd}
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

        {/* A BAR chart, not a line. Twelve month-ends are twelve independent
            samples, not a series — a line between the January bar and the
            February bar would draw a trend through two numbers that have
            nothing to do with each other. Bars off a zero baseline also carry
            the sign in the direction, which matters because half of these are
            negative. */}
        <div style={{ marginTop: 20 }}>
          <div style={{ ...capLabel, marginBottom: 8 }}>
            The month-end session, by calendar month &middot; mean return
          </div>
          <Legend items={[{ color: UP, label: "Positive mean" }, { color: DOWN, label: "Negative mean" }]} />
          <DivBars
            labels={eom.by_month.map((m) => m.label)}
            values={eom.by_month.map((m) => m.avg)}
            fmt={(v) => bp(v, 0)}
            height={260}
            readout={(i) => {
              const m = eom.by_month[i];
              return `${m.label} month-end · mean ${pct(m.avg)} · median ${pct(m.median)} · ${pctp(m.pos_pct, 1)} positive · best ${pct(m.best, 1)} · worst ${pct(m.worst, 1)} · n=${m.n}`;
            }}
          />
          <div style={{ ...NOTE, marginTop: 6 }}>
            Each bar is one calendar month&apos;s final session, averaged across
            every year on record — around {n0(Math.round(eom.by_month.reduce((a, m) => a + m.n, 0) / 12))}{" "}
            observations apiece. At that sample size the standard error is wide
            enough that most of the differences between these bars are not
            distinguishable from each other; the honest reading is the SIGN and
            the rough size, not the ranking. Hover any bar for its <i>n</i> and
            its hit rate.
          </div>
        </div>

        <Collapse autoOpen={isMonthEnd} label="Month-end by calendar month" hint="which month ends carry it">
          <DataTable head={STAT_HEAD} rows={eom.by_month.map((m) => statRow(m.label, m))} />
        </Collapse>

      </SeaCard>
    ),
    opex: (
      <SeaCard title="Opex Week &amp; the Week After" subtitle="Third-Friday expiration, monthly and quarterly" padding={20}>
        <div style={TILES}>
          <Tile label="Opex week" value={bp(opex.monthly.week.avg, 1)} sub={`${pctp(opex.monthly.week.pos_pct, 1)} positive`} color={signColor(opex.monthly.week.avg)} />
          <Tile label="Week after opex" value={bp(opex.monthly.after.avg, 1)} sub={`${pctp(opex.monthly.after.pos_pct, 1)} positive`} color={signColor(opex.monthly.after.avg)} />
          <Tile label="Quarterly opex week" value={bp(opex.quarterly.week.avg, 1)} sub={`Mar/Jun/Sep/Dec · ${pctp(opex.quarterly.week.pos_pct, 1)} positive`} color={signColor(opex.quarterly.week.avg)} />
          <Tile
            label="Week after quarterly"
            value={bp(opex.quarterly.after.avg, 1)}
            sub={`${pctp(opex.quarterly.after.pos_pct, 1)} positive`}
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
              sub={`median ${pct(sm.median[i])} · ${pctp(sm.pos_pct[i], 0)} positive`}
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
          open
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
