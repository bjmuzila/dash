"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { HOME_THEME, LIGHT_BLUE, ES_CANDLE_UP, ES_CANDLE_DOWN, homeButtonStyle, statTileStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";

// ─────────────────────────────────────────────────────────────────────────────
// /test?tab=premdiff — ATM PREMIUM DIFFERENCE, calls vs puts.
//
// Underlying daily CANDLES on top, a premium histogram underneath, sharing one
// x-axis and one crosshair. Each histogram bar is
//
//     put premium traded  −  call premium traded
//
// summed across the strikes within ±band% of that session's close, for the
// FRONT monthly expiry (the wide bar) with the BACK monthly drawn behind it.
//
// SIGN CONVENTION — the whole reason the panel exists:
//   BELOW zero, drawn in blue  → call premium dominated the tape.
//   ABOVE zero, drawn in red   → put premium dominated.
// So a deep blue bar at a high is calls being written into strength, and a red
// spike at a low is puts being paid for at the bottom. What that means about
// direction is a judgement the chart deliberately does not make for you: the
// same shape is an overwrite by a hedger and a bet by a speculator, and this
// data cannot tell those apart. It shows where the dollars went.
//
// WHAT THE NUMBERS ARE NOT:
//   · Not open interest. This is DAY VOLUME priced out — flow, not position.
//   · Not signed by aggressor. A dollar of premium is counted the same whether
//     it was bought or sold; nothing here knows which side lifted. The /flow
//     page's inventory board is the one that classifies buy vs sell.
//   · Not gamma-weighted. A 5-delta wing and the ATM straddle both count at
//     face value.
//
// Data: GET /api/atm-prem-diff?symbol=&band=&days= → server-v2/atm-prem-recorder.
// Bars sourced from the backfill (src='dxlink') are priced at the daily CLOSE
// rather than the 16:05 mark; the footer says so when any are present.
//
// Colors and surfaces come from homeTheme / PageCard. No hardcoded hex. The
// candles use ES_CANDLE_UP / ES_CANDLE_DOWN — the same pair the ES Candles page
// draws with, imported rather than re-typed so the two cannot drift apart.
// ─────────────────────────────────────────────────────────────────────────────

type Leg = {
  expiry: string;
  callPrem: number;
  putPrem: number;
  callVol: number;
  putVol: number;
  strikes: number;
  diff: number;
};

type Bar = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  spot: number;
  src: string;
  front: Leg | null;
  back: Leg | null;
};

type Payload = { symbol: string; bandPct: number; bands: number[]; rows: Bar[]; error?: string };

type IntradayLeg = Leg & { cumDiff: number; cumCallPrem: number; cumPutPrem: number };
type IntradayBucket = {
  minute: string;
  spot: number;
  baseline: boolean;
  src?: string;
  front: IntradayLeg | null;
  back: IntradayLeg | null;
};
type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type IntradayPayload = {
  symbol: string;
  bandPct: number;
  date: string;
  rows: IntradayBucket[];
  candles: Candle[];
  error?: string;
};

// SPX is deliberately absent. Its front MONTHLY is root "SPX" and AM-settled,
// and measured 2026-08-10 it carried 6,025 call + 1,749 put contracts within ±2%
// of spot against 564,751 + 499,020 in that day's SPXW 0DTE — about 1.4% of
// near-money SPX volume. The panel is built on front/back MONTHLY, so for SPX it
// was faithfully charting a contract almost nobody trades. Adding it back means
// first deciding what "front month" should mean for a root whose liquidity lives
// in dailies, not re-adding the string.
const SYMBOLS = ["SPY", "QQQ", "NVDA"];
// Intraday is recorded for the three index products only — the 1-minute
// recorder polls two chains per symbol per minute, and widening it is a cost
// decision rather than a UI one. Keep the two lists separate so the picker
// cannot offer a symbol with no intraday rows behind it.
const INTRADAY_SYMBOLS = ["SPY", "QQQ"];
const BAND_OPTIONS = [
  { value: "1", label: "±1% of spot" },
  { value: "2", label: "±2% of spot" },
  { value: "5", label: "±5% of spot" },
];
const RANGE_OPTIONS = [
  { value: "60", label: "3 months" },
  { value: "125", label: "6 months" },
  { value: "260", label: "1 year" },
];

// ── Formatting ───────────────────────────────────────────────────────────────

function fmtUsd(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

const fmtDate = (ymd: string) => {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
};

// ── Chart ────────────────────────────────────────────────────────────────────

const PRICE_H = 300;
const HIST_H = 190;
const PAD_L = 8;
const PAD_R = 74;
const GAP = 14;

function PremDiffChart({ rows, band, symbol }: { rows: Bar[]; band: number; symbol: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1100);
  const [hover, setHover] = useState<number | null>(null);

  // Width from the container, not a fixed viewBox: the card is fluid and a
  // stretched viewBox would smear the 1px hairlines.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w && w > 200) setWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geom = useMemo(() => {
    const n = rows.length;
    const innerW = Math.max(120, width - PAD_L - PAD_R);
    const step = n > 0 ? innerW / n : 1;
    const barW = Math.max(1, Math.min(9, step * 0.62));

    let pHi = -Infinity;
    let pLo = Infinity;
    for (const r of rows) {
      const hi = r.high ?? r.close ?? r.spot;
      const lo = r.low ?? r.close ?? r.spot;
      if (Number.isFinite(hi)) pHi = Math.max(pHi, hi as number);
      if (Number.isFinite(lo)) pLo = Math.min(pLo, lo as number);
    }
    if (!Number.isFinite(pHi) || !Number.isFinite(pLo)) { pHi = 1; pLo = 0; }
    const padP = (pHi - pLo) * 0.06 || 1;
    pHi += padP; pLo -= padP;

    let mag = 0;
    for (const r of rows) {
      mag = Math.max(mag, Math.abs(r.front?.diff ?? 0), Math.abs(r.back?.diff ?? 0));
    }
    if (!(mag > 0)) mag = 1;

    const x = (i: number) => PAD_L + i * step + step / 2;
    const yP = (v: number) => ((pHi - v) / (pHi - pLo)) * PRICE_H;
    const zero = PRICE_H + GAP + HIST_H / 2;
    const yH = (v: number) => zero - (v / mag) * (HIST_H / 2 - 6);

    return { step, barW, pHi, pLo, mag, x, yP, yH, zero, innerW };
  }, [rows, width]);

  const totalH = PRICE_H + GAP + HIST_H + 22;

  const onMove = useCallback((e: ReactMouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const i = Math.floor((px - PAD_L) / geom.step);
    setHover(i >= 0 && i < rows.length ? i : null);
  }, [geom.step, rows.length]);

  if (!rows.length) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: HOME_THEME.text, opacity: 0.55, fontSize: 14 }}>
        No sessions recorded for {symbol} at ±{band}% yet.
      </div>
    );
  }

  const hovered = hover != null ? rows[hover] : null;

  // Price y-axis ticks: 5 evenly spaced levels, labelled on the right like the
  // rest of the dashboard's charts.
  const priceTicks = Array.from({ length: 5 }, (_, i) => geom.pLo + ((geom.pHi - geom.pLo) * i) / 4);
  // Histogram ticks: zero plus ±half and ±full magnitude.
  const histTicks = [geom.mag, geom.mag / 2, 0, -geom.mag / 2, -geom.mag];

  // x labels: about one per 90px, snapped to actual sessions.
  const labelEvery = Math.max(1, Math.round(rows.length / Math.max(2, Math.floor(geom.innerW / 90))));

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <svg
        width={width}
        height={totalH}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: "block", cursor: "crosshair" }}
      >
        {/* ── price pane ── */}
        {priceTicks.map((v, i) => (
          <g key={`pt${i}`}>
            <line x1={PAD_L} x2={width - PAD_R} y1={geom.yP(v)} y2={geom.yP(v)} stroke={HOME_THEME.border} strokeWidth={1} />
            <text x={width - PAD_R + 6} y={geom.yP(v) + 4} fill={HOME_THEME.text} opacity={0.5} fontSize={11}>
              {v.toFixed(v >= 1000 ? 0 : 2)}
            </text>
          </g>
        ))}

        {/* Candlesticks in the ES Candles pair (ES_CANDLE_UP / ES_CANDLE_DOWN,
            imported rather than re-typed so the two charts cannot drift). Wick
            first, body over it. */}
        {rows.map((r, i) => {
          const hi = r.high ?? r.close ?? r.spot;
          const lo = r.low ?? r.close ?? r.spot;
          const cl = r.close ?? r.spot;
          // No open recorded (an older row, or a session whose daily bar was
          // unavailable) → treat it as flat rather than inventing a direction.
          const op = r.open ?? cl;
          const cx = geom.x(i);
          const col = cl >= op ? ES_CANDLE_UP : ES_CANDLE_DOWN;
          const yOpen = geom.yP(op);
          const yClose = geom.yP(cl);
          const bodyTop = Math.min(yOpen, yClose);
          // A doji would round to a zero-height rect and vanish, so the body
          // floors at 1px — the same thing every candle library does.
          const bodyH = Math.max(1, Math.abs(yClose - yOpen));
          const bodyW = Math.max(1, geom.barW);
          return (
            <g key={`b${r.date}`} opacity={hover == null || hover === i ? 1 : 0.55}>
              <line
                x1={cx} x2={cx}
                y1={geom.yP(hi as number)} y2={geom.yP(lo as number)}
                stroke={col} strokeWidth={1}
              />
              <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={col} />
            </g>
          );
        })}

        {/* ── histogram pane ── */}
        {histTicks.map((v, i) => (
          <g key={`ht${i}`}>
            <line
              x1={PAD_L} x2={width - PAD_R} y1={geom.yH(v)} y2={geom.yH(v)}
              stroke={HOME_THEME.border} strokeWidth={v === 0 ? 1.4 : 1}
              opacity={v === 0 ? 1 : 0.7}
            />
            <text x={width - PAD_R + 6} y={geom.yH(v) + 4} fill={HOME_THEME.text} opacity={0.5} fontSize={11}>
              {v === 0 ? "0" : fmtUsd(v)}
            </text>
          </g>
        ))}

        {rows.map((r, i) => {
          const cx = geom.x(i);
          const dim = hover == null || hover === i ? 1 : 0.5;
          const bars: ReactNode[] = [];
          // Back month first (wider, behind) then front month on top — the
          // screenshot's layering, and it keeps the front month legible when
          // the two have the same sign.
          if (r.back) {
            const v = r.back.diff;
            const y = geom.yH(v);
            const w = geom.barW * 1.5;
            bars.push(
              <rect
                key="bk" x={cx - w / 2} width={w}
                y={Math.min(y, geom.zero)} height={Math.max(1, Math.abs(geom.zero - y))}
                fill={HOME_THEME.purple} opacity={0.55 * dim}
              />,
            );
          }
          if (r.front) {
            const v = r.front.diff;
            const y = geom.yH(v);
            bars.push(
              <rect
                key="fr" x={cx - geom.barW / 2} width={geom.barW}
                y={Math.min(y, geom.zero)} height={Math.max(1, Math.abs(geom.zero - y))}
                fill={v >= 0 ? HOME_THEME.red : HOME_THEME.cyan} opacity={dim}
              />,
            );
          }
          return <g key={`h${r.date}`}>{bars}</g>;
        })}

        {/* ── x labels ── */}
        {rows.map((r, i) => (i % labelEvery === 0 ? (
          <text
            key={`x${r.date}`} x={geom.x(i)} y={totalH - 5}
            fill={HOME_THEME.text} opacity={0.45} fontSize={11} textAnchor="middle"
          >
            {fmtDate(r.date)}
          </text>
        ) : null))}

        {/* ── crosshair ── */}
        {hover != null && (
          <line
            x1={geom.x(hover)} x2={geom.x(hover)} y1={0} y2={PRICE_H + GAP + HIST_H}
            stroke={HOME_THEME.orange} strokeWidth={1} strokeDasharray="3 3" opacity={0.8}
          />
        )}
      </svg>

      <HoverReadout bar={hovered} band={band} symbol={symbol} />
    </div>
  );
}

function HoverReadout({ bar, band, symbol }: { bar: Bar | null; band: number; symbol: string }) {
  const cell: CSSProperties = { fontSize: 13, color: HOME_THEME.text, opacity: 0.85, whiteSpace: "nowrap" };
  if (!bar) {
    return (
      <div style={{ ...cell, opacity: 0.45, marginTop: 8, minHeight: 22 }}>
        Hover a session for the {symbol} ±{band}% breakdown.
      </div>
    );
  }
  const f = bar.front;
  const b = bar.back;
  return (
    <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 8, minHeight: 22, alignItems: "baseline" }}>
      <span style={{ ...cell, fontWeight: 800, opacity: 1 }}>{bar.date}</span>
      <span style={cell}>close {bar.close != null ? bar.close.toFixed(2) : "—"}</span>
      {f && (
        <>
          <span style={{ ...cell, color: HOME_THEME.orange, fontWeight: 700 }}>front {f.expiry}</span>
          <span style={{ ...cell, color: HOME_THEME.cyan }}>calls {fmtUsd(f.callPrem)}</span>
          <span style={{ ...cell, color: HOME_THEME.red }}>puts {fmtUsd(f.putPrem)}</span>
          <span style={{ ...cell, fontWeight: 800, opacity: 1 }}>diff {fmtUsd(f.diff)}</span>
          <span style={{ ...cell, opacity: 0.5 }}>{f.strikes} strikes</span>
        </>
      )}
      {b && <span style={{ ...cell, color: HOME_THEME.purple }}>back {b.expiry} · {fmtUsd(b.diff)}</span>}
    </div>
  );
}

// ── Intraday chart ───────────────────────────────────────────────────────────

const ET_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/**
 * Minute buckets for one session. Two readings of the same data:
 *
 *   "bars"       — premium traded IN that minute. The direct intraday analog of
 *                  the daily panel; answers "when did it happen".
 *   "cumulative" — the running total from the session's first bucket. Answers
 *                  "when was the day's tilt established", which a row of bars
 *                  makes you integrate by eye.
 *
 * Price is the underlying's own 1-minute candles, not the stored per-minute
 * spot: one sample a minute has open=high=low=close and renders as dashes.
 */
/** Minutes in a regular session: 09:30 through 15:59 inclusive. */
const RTH_MINUTES = 390;

/**
 * Epoch ms of 09:30 ET on `dateYmd`.
 *
 * Done by probing the zone rather than hardcoding -4/-5, because the offset
 * changes twice a year and a chart that silently shifts an hour every March is
 * worse than one that never worked. 12:00 UTC is safe to probe with: US DST
 * transitions happen at 02:00 local (06/07 UTC), so noon UTC is always on the
 * same side of the switch as 09:30 ET that day.
 */
function sessionStartMs(dateYmd: string): number {
  const probe = Date.parse(`${dateYmd}T12:00:00Z`);
  if (!Number.isFinite(probe)) return NaN;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(probe));
  const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? "0");
  const offsetMin = 12 * 60 - (get("hour") * 60 + get("minute"));
  return Date.parse(`${dateYmd}T09:30:00Z`) + offsetMin * 60_000;
}

/**
 * Minute buckets for one session, on a FIXED 09:30–16:00 axis.
 *
 * The axis is always the whole session, whether it is 09:35 or after the close.
 * A chart that stretches 20 minutes of data across the full width and then
 * re-scales every 60 seconds gives no sense of where you are in the day, and
 * makes a quiet open look like a full session of nothing happening. Minutes
 * with no data are simply not drawn — the space is left empty, which is the
 * honest rendering of "the day has not got there yet".
 *
 * Two readings of the same data:
 *
 *   "bars"       — premium traded IN that minute. The direct intraday analog of
 *                  the daily panel; answers "when did it happen".
 *   "cumulative" — the running total from the session's first bucket. Answers
 *                  "when was the day's tilt established", which a row of bars
 *                  makes you integrate by eye. The line stops at the last minute
 *                  that has data rather than being dragged flat to 16:00.
 *
 * Price is the underlying's own 1-minute candles, not the stored per-minute
 * spot: one sample a minute has open=high=low=close and renders as dashes.
 */
function IntradayChart({
  rows, candles, band, symbol, view, date,
}: {
  rows: IntradayBucket[];
  candles: Candle[];
  band: number;
  symbol: string;
  view: "bars" | "cumulative";
  date: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1100);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w && w > 200) setWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const candleAt = useMemo(() => {
    const m = new Map<number, Candle>();
    for (const c of candles) m.set(Math.floor(c.time / 60_000) * 60_000, c);
    return m;
  }, [candles]);

  const rowAt = useMemo(() => {
    const m = new Map<number, IntradayBucket>();
    for (const r of rows) m.set(Math.floor(Date.parse(r.minute) / 60_000) * 60_000, r);
    return m;
  }, [rows]);

  // The fixed axis. Anchored to the session date when we have one; otherwise to
  // the first bucket we were given, so the chart still draws for a session whose
  // date the API could not name.
  const start = useMemo(() => {
    const fromDate = sessionStartMs(date);
    if (Number.isFinite(fromDate)) return fromDate;
    const first = rows[0] ? Date.parse(rows[0].minute) : NaN;
    return Number.isFinite(first) ? Math.floor(first / 60_000) * 60_000 : NaN;
  }, [date, rows]);

  const slots = useMemo(() => Array.from({ length: RTH_MINUTES }, (_, i) => {
    const t = start + i * 60_000;
    const row = rowAt.get(t) ?? null;
    const c = candleAt.get(t) ?? null;
    const close = c?.close ?? row?.spot ?? null;
    return {
      t,
      row,
      open: c?.open ?? close,
      high: c?.high ?? close,
      low: c?.low ?? close,
      close,
      value: row ? (view === "bars" ? (row.front?.diff ?? 0) : (row.front?.cumDiff ?? 0)) : null,
      backValue: row ? (view === "bars" ? (row.back?.diff ?? 0) : (row.back?.cumDiff ?? 0)) : null,
    };
  }), [start, rowAt, candleAt, view]);

  const geom = useMemo(() => {
    const innerW = Math.max(120, width - PAD_L - PAD_R);
    const step = innerW / RTH_MINUTES;
    const barW = Math.max(1, Math.min(6, step * 0.7));

    let pHi = -Infinity; let pLo = Infinity;
    for (const p of slots) {
      if (p.high != null && p.high > 0) pHi = Math.max(pHi, p.high);
      if (p.low != null && p.low > 0) pLo = Math.min(pLo, p.low);
    }
    if (!Number.isFinite(pHi) || !Number.isFinite(pLo)) { pHi = 1; pLo = 0; }
    const padP = (pHi - pLo) * 0.08 || 1;
    pHi += padP; pLo -= padP;

    let mag = 0;
    for (const p of slots) {
      if (p.value != null) mag = Math.max(mag, Math.abs(p.value));
      if (p.backValue != null) mag = Math.max(mag, Math.abs(p.backValue));
    }
    if (!(mag > 0)) mag = 1;

    const x = (i: number) => PAD_L + i * step + step / 2;
    const yP = (v: number) => ((pHi - v) / (pHi - pLo)) * PRICE_H;
    const zero = PRICE_H + GAP + HIST_H / 2;
    const yH = (v: number) => zero - (v / mag) * (HIST_H / 2 - 6);
    return { step, barW, pHi, pLo, mag, x, yP, yH, zero, innerW };
  }, [slots, width]);

  const totalH = PRICE_H + GAP + HIST_H + 22;

  const onMove = useCallback((e: ReactMouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - box.left - PAD_L) / geom.step);
    setHover(i >= 0 && i < RTH_MINUTES ? i : null);
  }, [geom.step]);

  if (!Number.isFinite(start)) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: HOME_THEME.text, opacity: 0.55, fontSize: 14 }}>
        No intraday buckets recorded for {symbol} at ±{band}% yet. The 1-minute recorder writes during RTH only.
      </div>
    );
  }

  const priceTicks = Array.from({ length: 5 }, (_, i) => geom.pLo + ((geom.pHi - geom.pLo) * i) / 4);
  const histTicks = [geom.mag, geom.mag / 2, 0, -geom.mag / 2, -geom.mag];
  const hovered = hover != null ? slots[hover] : null;

  // Half-hourly gridlines and labels — a fixed session axis should read like a
  // clock, not like "every Nth sample", so the ticks are on the half hour rather
  // than spaced to fit whatever the data length happens to be.
  const tickEvery = geom.step * 30 < 34 ? 60 : 30;
  const ticks: number[] = [];
  for (let i = 0; i <= RTH_MINUTES; i += tickEvery) ticks.push(i);
  if (ticks[ticks.length - 1] !== RTH_MINUTES) ticks.push(RTH_MINUTES);

  // The cumulative line stops at the last minute that has data. Carrying it flat
  // to 16:00 would draw a session that finished quiet when really it has not
  // happened yet.
  const lastIdx = (() => {
    for (let i = slots.length - 1; i >= 0; i--) if (slots[i].row) return i;
    return -1;
  })();
  // Carry the index alongside: the path builders need x(i), and looking each
  // point back up with indexOf would be a quadratic scan per render.
  const drawn = lastIdx >= 0
    ? slots.slice(0, lastIdx + 1).map((p, i) => ({ p, i })).filter((e) => e.p.value != null)
    : [];

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <svg
        width={width} height={totalH}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        style={{ display: "block", cursor: "crosshair" }}
      >
        {priceTicks.map((v, i) => (
          <g key={`ipt${i}`}>
            <line x1={PAD_L} x2={width - PAD_R} y1={geom.yP(v)} y2={geom.yP(v)} stroke={HOME_THEME.border} strokeWidth={1} />
            <text x={width - PAD_R + 6} y={geom.yP(v) + 4} fill={HOME_THEME.text} opacity={0.5} fontSize={11}>
              {v.toFixed(v >= 1000 ? 0 : 2)}
            </text>
          </g>
        ))}

        {/* Half-hour rules, spanning both panes so the eye can carry a time
            across from price to premium. */}
        {ticks.map((i) => (
          <line
            key={`ivr${i}`}
            x1={PAD_L + i * geom.step} x2={PAD_L + i * geom.step}
            y1={0} y2={PRICE_H + GAP + HIST_H}
            stroke={HOME_THEME.border} strokeWidth={1} opacity={0.5}
          />
        ))}

        {slots.map((p, i) => {
          if (p.close == null || p.open == null || p.high == null || p.low == null) return null;
          const cx = geom.x(i);
          const col = p.close >= p.open ? ES_CANDLE_UP : ES_CANDLE_DOWN;
          const yO = geom.yP(p.open);
          const yC = geom.yP(p.close);
          const bodyW = Math.max(1, geom.barW);
          return (
            <g key={`ic${p.t}`} opacity={hover == null || hover === i ? 1 : 0.55}>
              <line x1={cx} x2={cx} y1={geom.yP(p.high)} y2={geom.yP(p.low)} stroke={col} strokeWidth={1} />
              <rect
                x={cx - bodyW / 2} y={Math.min(yO, yC)}
                width={bodyW} height={Math.max(1, Math.abs(yC - yO))} fill={col}
              />
            </g>
          );
        })}

        {histTicks.map((v, i) => (
          <g key={`iht${i}`}>
            <line
              x1={PAD_L} x2={width - PAD_R} y1={geom.yH(v)} y2={geom.yH(v)}
              stroke={HOME_THEME.border} strokeWidth={v === 0 ? 1.4 : 1} opacity={v === 0 ? 1 : 0.7}
            />
            <text x={width - PAD_R + 6} y={geom.yH(v) + 4} fill={HOME_THEME.text} opacity={0.5} fontSize={11}>
              {v === 0 ? "0" : fmtUsd(v)}
            </text>
          </g>
        ))}

        {view === "cumulative" ? (
          drawn.length > 1 ? (
            <>
              <path
                d={`M ${geom.x(drawn[0].i)} ${geom.zero} ${drawn.map((e) => `L ${geom.x(e.i)} ${geom.yH(e.p.backValue ?? 0)}`).join(" ")} L ${geom.x(drawn[drawn.length - 1].i)} ${geom.zero} Z`}
                fill={HOME_THEME.purple} opacity={0.28}
              />
              <path
                d={drawn.map((e, k) => `${k ? "L" : "M"} ${geom.x(e.i)} ${geom.yH(e.p.value ?? 0)}`).join(" ")}
                fill="none" stroke={HOME_THEME.orange} strokeWidth={1.8}
              />
            </>
          ) : null
        ) : (
          slots.map((p, i) => {
            if (p.value == null && p.backValue == null) return null;
            const cx = geom.x(i);
            const dim = hover == null || hover === i ? 1 : 0.5;
            const y = geom.yH(p.value ?? 0);
            const yb = geom.yH(p.backValue ?? 0);
            return (
              <g key={`ih${p.t}`}>
                {p.backValue != null && (
                  <rect
                    x={cx - (geom.barW * 1.5) / 2} width={geom.barW * 1.5}
                    y={Math.min(yb, geom.zero)} height={Math.max(1, Math.abs(geom.zero - yb))}
                    fill={HOME_THEME.purple} opacity={0.5 * dim}
                  />
                )}
                {p.value != null && (
                  <rect
                    x={cx - geom.barW / 2} width={geom.barW}
                    y={Math.min(y, geom.zero)} height={Math.max(1, Math.abs(geom.zero - y))}
                    fill={p.value >= 0 ? HOME_THEME.red : HOME_THEME.cyan} opacity={dim}
                  />
                )}
              </g>
            );
          })
        )}

        {ticks.map((i) => (
          <text
            key={`ix${i}`} x={PAD_L + i * geom.step} y={totalH - 5}
            fill={HOME_THEME.text} opacity={0.45} fontSize={11} textAnchor="middle"
          >
            {ET_TIME.format(new Date(start + i * 60_000))}
          </text>
        ))}

        {hover != null && (
          <line
            x1={geom.x(hover)} x2={geom.x(hover)} y1={0} y2={PRICE_H + GAP + HIST_H}
            stroke={HOME_THEME.orange} strokeWidth={1} strokeDasharray="3 3" opacity={0.8}
          />
        )}
      </svg>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 8, minHeight: 22, alignItems: "baseline", fontSize: 13 }}>
        {hovered ? (
          <>
            <span style={{ fontWeight: 800, color: HOME_THEME.text }}>{ET_TIME.format(new Date(hovered.t))} ET</span>
            {hovered.close != null && (
              <span style={{ color: HOME_THEME.text, opacity: 0.85 }}>px {hovered.close.toFixed(2)}</span>
            )}
            {hovered.row?.front ? (
              <>
                <span style={{ color: HOME_THEME.cyan }}>calls {fmtUsd(hovered.row.front.callPrem)}</span>
                <span style={{ color: HOME_THEME.red }}>puts {fmtUsd(hovered.row.front.putPrem)}</span>
                <span style={{ fontWeight: 800, color: HOME_THEME.text }}>
                  {view === "bars" ? "minute" : "session"} diff {fmtUsd(hovered.value ?? 0)}
                </span>
              </>
            ) : (
              <span style={{ color: HOME_THEME.text, opacity: 0.45 }}>no bucket recorded</span>
            )}
            {hovered.row?.baseline && (
              <span style={{ color: HOME_THEME.orange }}>baseline bucket — no interval flow</span>
            )}
          </>
        ) : (
          <span style={{ color: HOME_THEME.text, opacity: 0.45 }}>
            Hover a minute for the {symbol} ±{band}% breakdown. Axis is the full 09:30–16:00 session.
          </span>
        )}
      </div>
    </div>
  );
}

/** Small segmented switch, styled off the theme (no hardcoded hex). */
function Seg<T extends string>({
  value, options, onChange,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${HOME_THEME.border}`, borderRadius: 8, overflow: "hidden" }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            style={{
              padding: "8px 16px",
              border: "none",
              background: active ? `linear-gradient(180deg, ${HOME_THEME.cyan}33, ${HOME_THEME.cyan}0D)` : "transparent",
              color: active ? HOME_THEME.cyan : HOME_THEME.text,
              fontSize: 13,
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

// ── Tab ──────────────────────────────────────────────────────────────────────

export default function PremDiffTab() {
  const [mode, setMode] = useState<"daily" | "intraday">("daily");
  const [view, setView] = useState<"bars" | "cumulative">("bars");
  const [symbol, setSymbol] = useState("SPY");
  const [band, setBand] = useState("5");
  const [range, setRange] = useState("260");
  const [data, setData] = useState<Payload | null>(null);
  const [intra, setIntra] = useState<IntradayPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Switching to intraday with a symbol that has no intraday recorder behind it
  // would show an empty chart that looks broken. Snap to SPY instead.
  useEffect(() => {
    if (mode === "intraday" && !INTRADAY_SYMBOLS.includes(symbol)) setSymbol("SPY");
  }, [mode, symbol]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const url = mode === "intraday"
        ? `/api/atm-prem-intraday?symbol=${encodeURIComponent(symbol)}&band=${band}`
        : `/api/atm-prem-diff?symbol=${encodeURIComponent(symbol)}&band=${band}&days=${range}`;
      const r = await fetch(url, { credentials: "include" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      if (mode === "intraday") { setIntra(j as IntradayPayload); } else { setData(j as Payload); }
      if (j.error) setErr(j.error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      if (mode === "intraday") setIntra(null); else setData(null);
    } finally {
      setLoading(false);
    }
  }, [mode, symbol, band, range]);

  useEffect(() => { void load(); }, [load]);

  // Intraday refreshes on its own — the recorder writes a bucket a minute and a
  // panel you have to hit Refresh on to see the current session is a panel you
  // stop trusting. Daily changes once a day and is left manual.
  useEffect(() => {
    if (mode !== "intraday") return;
    const id = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(id);
  }, [mode, load]);

  const rows = data?.rows ?? [];

  const stats = useMemo(() => {
    const fronts = rows.map((r) => r.front?.diff ?? 0);
    const last = rows[rows.length - 1];
    const n = fronts.length;
    const mean = n ? fronts.reduce((a, b) => a + b, 0) / n : 0;
    const sd = n > 1 ? Math.sqrt(fronts.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
    const z = sd > 0 && last?.front ? (last.front.diff - mean) / sd : 0;
    const callDays = fronts.filter((v) => v < 0).length;
    return { last, mean, sd, z, callDays, n };
  }, [rows]);

  const backfilled = useMemo(() => rows.some((r) => r.src === "dxlink"), [rows]);
  // A short series is usually the data's limit, not a fetch problem: dxFeed's
  // per-contract candle retention thins out going back, so the recovered window
  // ends where the replay ran dry. Name the first session rather than leaving a
  // stubby chart looking like a loading failure.
  const firstDate = rows[0]?.date ?? null;
  const wantedSessions = Number(range);
  const short = firstDate != null && rows.length < wantedSessions * 0.8;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Seg
          value={mode}
          onChange={setMode}
          options={[{ value: "daily" as const, label: "Daily" }, { value: "intraday" as const, label: "Intraday" }]}
        />
        {mode === "intraday" && (
          <Seg
            value={view}
            onChange={setView}
            options={[{ value: "bars" as const, label: "Per minute" }, { value: "cumulative" as const, label: "Cumulative" }]}
          />
        )}
        {/* Explicit widths: ThemedSelect defaults to width:"100%", which in a
            flex row makes each control fight for the whole strip. */}
        <ThemedSelect
          value={symbol}
          onChange={setSymbol}
          options={(mode === "intraday" ? INTRADAY_SYMBOLS : SYMBOLS).map((s) => ({ value: s, label: s }))}
          ariaLabel="Symbol"
          width={110}
        />
        <ThemedSelect value={band} onChange={setBand} options={BAND_OPTIONS} ariaLabel="ATM band" width={160} />
        {mode === "daily" && (
          <ThemedSelect value={range} onChange={setRange} options={RANGE_OPTIONS} ariaLabel="Lookback" width={150} />
        )}
        <button type="button" onClick={() => void load()} style={homeButtonStyle}>Refresh</button>
        <div style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.6 }}>
          {loading
            ? "Loading…"
            : mode === "intraday"
              ? `${intra?.rows.length ?? 0} minutes · ${intra?.date ?? "—"} · auto-refresh 60s`
              : `${rows.length} sessions`}
        </div>
        {err && <div style={{ fontSize: 13, color: HOME_THEME.red }}>{err}</div>}
      </div>

      {mode === "daily" ? (
        <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
        <div style={statTileStyle}>
          <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Latest front diff</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: (stats.last?.front?.diff ?? 0) >= 0 ? HOME_THEME.red : HOME_THEME.cyan }}>
            {stats.last?.front ? fmtUsd(stats.last.front.diff) : "—"}
          </div>
          <div style={{ fontSize: 12, opacity: 0.55 }}>{stats.last?.date ?? ""}</div>
        </div>
        <div style={statTileStyle}>
          <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.06em" }}>vs its own history</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: Math.abs(stats.z) >= 2 ? HOME_THEME.orange : HOME_THEME.text }}>
            {stats.n > 1 ? `${stats.z >= 0 ? "+" : ""}${stats.z.toFixed(2)}σ` : "—"}
          </div>
          <div style={{ fontSize: 12, opacity: 0.55 }}>z-score of today&apos;s bar</div>
        </div>
        <div style={statTileStyle}>
          <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Call-heavy sessions</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: HOME_THEME.cyan }}>
            {stats.n ? `${Math.round((stats.callDays / stats.n) * 100)}%` : "—"}
          </div>
          <div style={{ fontSize: 12, opacity: 0.55 }}>{stats.callDays} of {stats.n} in window</div>
        </div>
        <div style={statTileStyle}>
          <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Front expiry</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: HOME_THEME.orange }}>
            {stats.last?.front?.expiry ?? "—"}
          </div>
          <div style={{ fontSize: 12, opacity: 0.55 }}>third Friday, ±{band}% of spot</div>
        </div>
      </div>

      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title={`${symbol} — ATM premium traded, puts minus calls`}
        subtitle={
          `Daily bars on top; below, put premium minus call premium (price × day volume × 100) summed across strikes within ±${band}% of the close. ` +
          "Front monthly is the solid bar — blue below zero = call premium dominated, red above = put premium dominated. Back monthly is the wide purple bar behind it."
        }
      >
        <PremDiffChart rows={rows} band={Number(band)} symbol={symbol} />

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 14, fontSize: 13 }}>
          <LegendDot color={HOME_THEME.cyan} label="Calls dominant (below zero)" />
          <LegendDot color={HOME_THEME.red} label="Puts dominant (above zero)" />
          <LegendDot color={HOME_THEME.purple} label="Back month" />
        </div>

        <div style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.55, marginTop: 12, lineHeight: 1.65 }}>
          Premium traded is <strong>flow, not position</strong> — day volume priced out, with no aggressor side attached, so a
          dollar counts the same whether it was bought or sold. Reading a single bar as bullish or bearish is a guess; the
          series is only informative against its own history, which is what the σ tile measures.
          {backfilled && (
            <>
              {" "}Bars recovered by the dxLink pull are priced at the daily <strong>close</strong> rather than the 16:05
              mark, so wing strikes in that window sit at last trade rather than mid.
            </>
          )}
          {short && firstDate && (
            <>
              {" "}History starts <strong>{firstDate}</strong> — that is where dxFeed&apos;s candle replay ran dry for the
              contracts involved, not a fetch that failed. Per-contract retention thins going back, so re-running the pull
              will not reach much further; the series grows forward from the EOD recorder, one session per day.
            </>
          )}
        </div>
      </Card>
        </>
      ) : (
        (() => {
        const irows = intra?.rows ?? [];
        const lastWith = [...irows].reverse().find((r) => r.front);
        const sessionDiff = lastWith?.front?.cumDiff ?? 0;
        const biggest = irows.reduce((best, r) => (
          Math.abs(r.front?.diff ?? 0) > Math.abs(best?.front?.diff ?? 0) ? r : best
        ), irows[0]);
        const totalPrem = (lastWith?.front?.cumCallPrem ?? 0) + (lastWith?.front?.cumPutPrem ?? 0);
        const hasBaseline = irows.some((r) => r.baseline);
        const isBackfilled = irows.some((r) => r.src === "dxlink");
        return (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
              <div style={statTileStyle}>
                <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Session tilt so far</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: sessionDiff >= 0 ? HOME_THEME.red : HOME_THEME.cyan }}>
                  {lastWith ? fmtUsd(sessionDiff) : "\u2014"}
                </div>
                <div style={{ fontSize: 12, opacity: 0.55 }}>puts minus calls, cumulative</div>
              </div>
              <div style={statTileStyle}>
                <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Total premium</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: HOME_THEME.text }}>
                  {totalPrem > 0 ? fmtUsd(totalPrem) : "\u2014"}
                </div>
                <div style={{ fontSize: 12, opacity: 0.55 }}>both sides, front month</div>
              </div>
              <div style={statTileStyle}>
                <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Biggest minute</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: (biggest?.front?.diff ?? 0) >= 0 ? HOME_THEME.red : HOME_THEME.cyan }}>
                  {biggest?.front ? fmtUsd(biggest.front.diff) : "\u2014"}
                </div>
                <div style={{ fontSize: 12, opacity: 0.55 }}>
                  {biggest ? `${ET_TIME.format(new Date(biggest.minute))} ET` : ""}
                </div>
              </div>
              <div style={statTileStyle}>
                <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Front expiry</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: HOME_THEME.orange }}>
                  {lastWith?.front?.expiry ?? "\u2014"}
                </div>
                <div style={{ fontSize: 12, opacity: 0.55 }}>third Friday, \u00b1{band}% of spot</div>
              </div>
            </div>

            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              title={`${symbol} \u2014 intraday ATM premium traded, puts minus calls`}
              subtitle={
                view === "bars"
                  ? `Each bar is the premium that traded in that MINUTE \u2014 the change in each strike's day volume since the previous snapshot, priced at that minute's mark, summed within \u00b1${band}% of spot. Blue below zero = calls dominated the minute, red above = puts did.`
                  : `The session's running total from the first bucket. The line is the front month, the purple fill the back month. Where it climbs is where the day's tilt was actually established \u2014 which a row of bars makes you integrate by eye.`
              }
            >
              <IntradayChart
                rows={irows}
                candles={intra?.candles ?? []}
                band={Number(band)}
                symbol={symbol}
                view={view}
                date={intra?.date ?? ""}
              />

              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 14, fontSize: 13 }}>
                <LegendDot color={HOME_THEME.cyan} label="Calls dominant" />
                <LegendDot color={HOME_THEME.red} label="Puts dominant" />
                <LegendDot color={HOME_THEME.purple} label="Back month" />
                {view === "cumulative" && <LegendDot color={HOME_THEME.orange} label="Front month, cumulative" />}
              </div>

              <div style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.55, marginTop: 12, lineHeight: 1.65 }}>
                Minute premium is the <strong>difference</strong> between consecutive chain snapshots, taken per strike and
                then summed \u2014 the chain reports cumulative day volume, so multiplying it directly would re-count the whole
                session every minute. Band membership is recomputed each minute against that minute&apos;s spot, so a strike
                can enter or leave the window intraday. Recorded during RTH only.
                {isBackfilled && (
                  <>
                    {" "}This session was <strong>reconstructed</strong> from 1-minute option candles rather than recorded
                    live, so each minute is priced at that bar&apos;s close instead of the mark. The upside is that it has no
                    restart seam: one pricing basis throughout and a cumulative that genuinely starts at the open.
                  </>
                )}
                {hasBaseline && (
                  <>
                    {" "}This session contains a <strong>baseline</strong> bucket \u2014 the recorder started or restarted, so it
                    had nothing to difference against. Volume traded during that gap is attributed to no minute rather than
                    landing as one false spike, and the cumulative line starts from the restart, not from the open.
                  </>
                )}
              </div>
            </Card>
          </>
        );
        })()
      )}
    </>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: HOME_THEME.text, opacity: 0.8 }}>
      <span style={{ width: 11, height: 11, borderRadius: 3, background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}
