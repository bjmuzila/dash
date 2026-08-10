"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { HOME_THEME, LIGHT_BLUE, SOFT_RED, homeButtonStyle, statTileStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";

// ─────────────────────────────────────────────────────────────────────────────
// /test?tab=premdiff — ATM PREMIUM DIFFERENCE, calls vs puts.
//
// Underlying daily bars on top, a premium histogram underneath, sharing one
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
// Colors and surfaces come from homeTheme / PageCard. No hardcoded hex.
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

const SYMBOLS = ["SPY", "QQQ", "SPX", "NVDA"];
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

        {rows.map((r, i) => {
          const hi = r.high ?? r.close ?? r.spot;
          const lo = r.low ?? r.close ?? r.spot;
          const op = r.open;
          const cl = r.close ?? r.spot;
          const cx = geom.x(i);
          const up = op != null ? cl >= op : true;
          const col = up ? LIGHT_BLUE : SOFT_RED;
          return (
            <g key={`b${r.date}`} opacity={hover == null || hover === i ? 1 : 0.55}>
              <line x1={cx} x2={cx} y1={geom.yP(hi as number)} y2={geom.yP(lo as number)} stroke={col} strokeWidth={1.2} />
              {op != null && (
                <line x1={cx - geom.barW / 2} x2={cx} y1={geom.yP(op)} y2={geom.yP(op)} stroke={col} strokeWidth={1.2} />
              )}
              <line x1={cx} x2={cx + geom.barW / 2} y1={geom.yP(cl)} y2={geom.yP(cl)} stroke={col} strokeWidth={1.2} />
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

// ── Tab ──────────────────────────────────────────────────────────────────────

export default function PremDiffTab() {
  const [symbol, setSymbol] = useState("SPY");
  const [band, setBand] = useState("5");
  const [range, setRange] = useState("260");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/atm-prem-diff?symbol=${encodeURIComponent(symbol)}&band=${band}&days=${range}`, {
        credentials: "include",
      });
      const j = (await r.json()) as Payload;
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j);
      if (j.error) setErr(j.error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [symbol, band, range]);

  useEffect(() => { void load(); }, [load]);

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
  // The series cannot be pushed back past its first session by any amount of
  // re-running: dxFeed drops delisted option symbols, so once a monthly expires
  // its volume history is gone. Say that on the panel rather than leaving a
  // short chart looking like a loading failure.
  const firstDate = rows[0]?.date ?? null;
  const wantedSessions = Number(range);
  const short = firstDate != null && rows.length < wantedSessions * 0.8;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {/* Explicit widths: ThemedSelect defaults to width:"100%", which in a
            flex row makes each control fight for the whole strip. */}
        <ThemedSelect
          value={symbol}
          onChange={setSymbol}
          options={SYMBOLS.map((s) => ({ value: s, label: s }))}
          ariaLabel="Symbol"
          width={110}
        />
        <ThemedSelect value={band} onChange={setBand} options={BAND_OPTIONS} ariaLabel="ATM band" width={160} />
        <ThemedSelect value={range} onChange={setRange} options={RANGE_OPTIONS} ariaLabel="Lookback" width={150} />
        <button type="button" onClick={() => void load()} style={homeButtonStyle}>Refresh</button>
        <div style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.6 }}>
          {loading ? "Loading…" : `${rows.length} sessions`}
        </div>
        {err && <div style={{ fontSize: 13, color: HOME_THEME.red }}>{err}</div>}
      </div>

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
              {" "}History starts <strong>{firstDate}</strong> and cannot be extended backwards: dxFeed drops delisted
              option symbols, so once a monthly expires its volume history is unreachable. Only the window where a
              still-listed monthly was already the front or back month could be recovered — the rest accumulates forward,
              one session per day, from the EOD recorder.
            </>
          )}
        </div>
      </Card>
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
