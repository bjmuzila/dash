"use client";

// ─────────────────────────────────────────────────────────────────────────────
// GEX% — positive vs negative gamma split, per ticker, per expiration
//
// One row per ticker; for each of the front 3 expiries a gauge-rail meter (the
// /home SegMeter, pct fill) showing what share of that expiry's |net GEX| sits
// on the positive (call / dealers-long-gamma) side vs the negative (put /
// dealers-short-gamma) side. The bar fills from the left to the call share and
// takes the color of whichever side leads; the tick marks an even split.
//
//   net      = gex_now + gex_open   (today's volume gamma + carried OI gamma —
//              the same "net" the replay frames and day-over-day rollups use)
//   pos_pct  = Σ net>0 / (Σ net>0 + |Σ net<0|) · 100
//   neg_pct  = 100 − pos_pct
//
// Reads GET /proxy/strike-growth/gex-pct?expiries=3, which aggregates the
// latest snapshot per (symbol, expiry) in ONE query. Note the recorder only
// stores the top STRIKE_GROWTH_TOP_N strikes per side, so this is the split
// across the strikes that actually carry the exposure — not a whole-chain
// figure. The card footer says so.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, homeButtonStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { SegMeter, GEX_POS, GEX_NEG } from "@/components/shared/SegMeter";

const N_EXP = 3;
/** Under this many tickers an expiry's lean is one or two names, not a read —
 *  those cells render dimmed so an n=1 expiry stops shouting as loud as n=160. */
const THIN_N = 5;
/** The meter is drawn at SegMeter's native proportions, so a full-width table
 *  column stretches its segments into slabs. The block is pinned to this width
 *  and centered; the three expiry columns share the table's slack around it. */
const METER_W = 152;
const EXP_COL_W = "22%";

// Meter colors: the /home gauge-rail palette — positive/calls blue,
// negative/puts red. Sourced from SegMeter so the scanner bars and the home
// bars can never drift apart.
const POS = GEX_POS;
const NEG = GEX_NEG;
// All body text on this tab is full white (no muted greys).
const DIM = HOME_THEME.text;

type ApiRow = {
  symbol: string;
  expiry: string;
  exp_idx: number;
  spot: number;
  ts: string;
  pos_gex: number;
  neg_gex: number; // negative number
  n_pos: number;
  n_neg: number;
  // Volume-only basis — today's traded gamma alone (gex_now), carried OI book
  // excluded. Optional so a proxy that predates these columns still renders:
  // the switcher falls back to the net basis when they're absent.
  pos_vol?: number;
  neg_vol?: number; // negative number
  n_pos_vol?: number;
  n_neg_vol?: number;
};

/** Which gamma book the split is measured over.
 *  net = carried OI gamma + today's volume gamma (the canonical basis)
 *  vol = today's traded volume gamma only */
type Basis = "net" | "vol";

type Leg = {
  expiry: string;
  pos: number;      // $ gamma on the positive side
  neg: number;      // $ gamma on the negative side (absolute value)
  posPct: number | null;
  n: number;
};

type TickerRow = {
  symbol: string;
  spot: number;
  legs: (Leg | null)[]; // length N_EXP, index 0 = front
  total: number;        // Σ |net| across the shown expiries — the size ranker
  skew: number | null;  // E3 posPct − E1 posPct, in points
};

const INDICES = new Set(["SPX", "NDX", "RUT", "VIX", "XSP", "SPY", "QQQ", "IWM", "DIA"]);

const fmtB = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${(a / 1e3).toFixed(0)}K`;
  return a.toFixed(0);
};
const fmtSpot = (v: number): string =>
  !(v > 0) ? "—" : v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v.toFixed(2);
// "2026-07-28" → "Jul 28"
const fmtExpiry = (e: string): string => {
  const [, m, d] = e.split("-");
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return m && d ? `${MON[Number(m) - 1]} ${Number(d)}` : e;
};

const th: CSSProperties = {
  padding: "6px 10px", textAlign: "right", fontWeight: 700, fontSize: 12,
  letterSpacing: "0.05em", color: HOME_THEME.text, whiteSpace: "nowrap",
  borderBottom: `1px solid rgba(255,255,255,0.14)`, cursor: "pointer", userSelect: "none",
};
const td: CSSProperties = {
  padding: "8px 10px", textAlign: "right", color: HOME_THEME.text,
  fontVariantNumeric: "tabular-nums", borderBottom: "1px solid rgba(255,255,255,0.05)",
};
const seg = (active: boolean): CSSProperties => ({
  padding: "6px 12px", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: 700,
  border: `1px solid ${active ? HOME_THEME.cyan : "rgba(255,255,255,0.15)"}`,
  background: active ? "rgba(33,158,188,0.15)" : "transparent",
  color: HOME_THEME.text,
});

// One expiry cell, in the same gauge-rail language as the lean strip above:
// the bar fills from the left to the call share, colored by whichever side is
// leading, with a tick at an even split. Same meter, same reading, everywhere
// on this tab — the two-tone split bar is gone.
function SplitCell({ leg }: { leg: Leg | null }) {
  if (!leg || leg.posPct == null) {
    return <td style={{ ...td, color: DIM, borderLeft: "1px solid rgba(255,255,255,0.08)" }}>—</td>;
  }
  const p = leg.posPct;
  const n = 100 - p;
  const lead = p >= 50 ? POS : NEG;
  return (
    <td style={{ ...td, width: EXP_COL_W, padding: "7px 10px", borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
      {/* Fixed-width, centered block — see METER_W. */}
      <div style={{ width: METER_W, margin: "0 auto", display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          {/* Each ticker's OWN expiry — tickers without a 0DTE have a different
              front three, so the date belongs per-cell, not in a shared header. */}
          <span style={{ fontSize: 11, fontWeight: 600, color: HOME_THEME.text, opacity: 0.7 }}>
            {fmtExpiry(leg.expiry)}
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, color: lead }}>
            {p.toFixed(0)}% / {n.toFixed(0)}%
          </span>
        </div>
        <SegMeter t={p / 100} midT={0.5} tick={0.5} color={lead} kind="pct" fill />
        <div style={{ fontSize: 11, color: HOME_THEME.text, opacity: 0.7, textAlign: "right" }}>
          +{fmtB(leg.pos)} / −{fmtB(leg.neg)}
        </div>
      </div>
    </td>
  );
}

function Tile({ label, value, note, color }: { label: string; value: string; note: string; color?: string }) {
  return (
    <div style={{
      border: `1px solid ${HOME_THEME.border}`, borderRadius: 12, padding: "12px 14px",
      background: "rgba(13,17,25,0.72)",
    }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.text, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6, fontVariantNumeric: "tabular-nums", color: color || HOME_THEME.text }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: HOME_THEME.text, marginTop: 2 }}>{note}</div>
    </div>
  );
}

type SortCol = "symbol" | "size" | "skew" | 0 | 1 | 2;

export default function GexPctTab() {
  const [rows, setRows] = useState<ApiRow[]>([]);
  const [date, setDate] = useState("");
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "stocks" | "index">("all");
  const [basis, setBasis] = useState<Basis>("net");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ col: SortCol; dir: "desc" | "asc" }>({ col: "size", dir: "desc" });

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    const u = new URL("/proxy/strike-growth/gex-pct", window.location.origin);
    u.searchParams.set("expiries", String(N_EXP));
    fetch(u.toString(), { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) { setErr(j?.error || "load failed"); setRows([]); return; }
        setRows(j.rows || []);
        setDate(j.date || "");
        setStale(Boolean(j.stale));
      })
      .catch((e) => setErr(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  // Same 5-minute cadence as the other recorded-history tabs.
  useEffect(() => {
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  // Does the proxy actually serve the volume-only columns? An older build
  // doesn't, and silently showing an all-zero table would read as "no gamma
  // traded" rather than "your server is behind" — so the switcher is disabled
  // instead, with the reason in its tooltip.
  const hasVol = useMemo(() => rows.some((r) => r.pos_vol != null || r.neg_vol != null), [rows]);
  const volBasis = basis === "vol" && hasVol;

  // API rows (symbol × expiry) → one row per ticker with N_EXP leg slots.
  const tickers = useMemo<TickerRow[]>(() => {
    const by = new Map<string, TickerRow>();
    for (const r of rows) {
      const idx = r.exp_idx - 1;
      if (idx < 0 || idx >= N_EXP) continue;
      let t = by.get(r.symbol);
      if (!t) {
        t = { symbol: r.symbol, spot: 0, legs: Array(N_EXP).fill(null), total: 0, skew: null };
        by.set(r.symbol, t);
      }
      const pos = Math.max(0, Number(volBasis ? r.pos_vol : r.pos_gex) || 0);
      const neg = Math.abs(Number(volBasis ? r.neg_vol : r.neg_gex) || 0);
      const denom = pos + neg;
      t.legs[idx] = {
        expiry: r.expiry,
        pos, neg,
        posPct: denom > 0 ? (pos / denom) * 100 : null,
        n: volBasis
          ? (Number(r.n_pos_vol) || 0) + (Number(r.n_neg_vol) || 0)
          : (Number(r.n_pos) || 0) + (Number(r.n_neg) || 0),
      };
      t.total += denom;
      if (r.spot > 0) t.spot = r.spot;
    }
    for (const t of by.values()) {
      const a = t.legs[0]?.posPct;
      const b = t.legs[N_EXP - 1]?.posPct;
      t.skew = a != null && b != null ? b - a : null;
    }
    return [...by.values()];
  }, [rows, volBasis]);

  const filtered = useMemo(() => {
    const needle = q.trim().toUpperCase();
    let f = tickers;
    if (scope === "stocks") f = f.filter((t) => !INDICES.has(t.symbol));
    if (scope === "index") f = f.filter((t) => INDICES.has(t.symbol));
    if (needle) f = f.filter((t) => t.symbol.includes(needle));
    const val = (t: TickerRow): number | string => {
      if (sort.col === "symbol") return t.symbol;
      if (sort.col === "size") return t.total;
      if (sort.col === "skew") return t.skew ?? -Infinity;
      return t.legs[sort.col]?.posPct ?? -Infinity;
    };
    return [...f].sort((a, b) => {
      const av = val(a), bv = val(b);
      const cmp = typeof av === "string" ? String(bv).localeCompare(av) : (bv as number) - (av as number);
      return sort.dir === "desc" ? cmp : -cmp;
    });
  }, [tickers, scope, q, sort]);

  const toggle = (col: SortCol) =>
    setSort((p) => (p.col === col ? { col, dir: p.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }));
  const arrow = (col: SortCol) => (sort.col === col ? (sort.dir === "desc" ? " ▼" : " ▲") : "");

  // Headline stats, front expiry only, over the currently filtered universe.
  const stats = useMemo(() => {
    const front = filtered.filter((t) => t.legs[0]?.posPct != null);
    if (!front.length) return null;
    const byPos = [...front].sort((a, b) => (b.legs[0]!.posPct! - a.legs[0]!.posPct!));
    const mostCall = byPos[0];
    const mostPut = byPos[byPos.length - 1];
    const avg = front.reduce((s, t) => s + t.legs[0]!.posPct!, 0) / front.length;
    const flips = filtered.filter((t) => t.skew != null).sort((a, b) => Math.abs(b.skew!) - Math.abs(a.skew!));
    return { mostCall, mostPut, avg, flip: flips[0] || null, n: front.length };
  }, [filtered]);

  // Call-side lean per ACTUAL expiration date. Tickers don't share a front
  // three — one name's E1 is a 0DTE, another's is next Friday — so slot index
  // is meaningless to average across. Group by the real date instead.
  //
  // Two averages, because they answer different questions:
  //   avgPct    — mean of each ticker's call%, every ticker weighted equally
  //   dollarPct — Σpos / Σ(pos+neg), weighted by size (SPX dominates this one)
  const byExpiry = useMemo(() => {
    const m = new Map<string, { pos: number; neg: number; sum: number; n: number }>();
    for (const t of filtered) {
      for (const leg of t.legs) {
        if (!leg || leg.posPct == null) continue;
        let e = m.get(leg.expiry);
        if (!e) { e = { pos: 0, neg: 0, sum: 0, n: 0 }; m.set(leg.expiry, e); }
        e.pos += leg.pos; e.neg += leg.neg; e.sum += leg.posPct; e.n += 1;
      }
    }
    return [...m.entries()]
      .map(([expiry, v]) => ({
        expiry,
        n: v.n,
        avgPct: v.sum / v.n,
        dollarPct: v.pos + v.neg > 0 ? (v.pos / (v.pos + v.neg)) * 100 : null,
      }))
      .sort((a, b) => a.expiry.localeCompare(b.expiry));
  }, [filtered]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Headline split */}
      <Card variant="classic" padding={0}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
          padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.14)",
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: HOME_THEME.cyan }}>
              Positioning Split
            </div>
            <div style={{ fontSize: 12, color: HOME_THEME.text }}>
              front expiry · {stats?.n ?? 0} tickers{date ? ` · ${date}` : ""}
              {stale ? <span style={{ color: HOME_THEME.orange }}> · last recorded session</span> : null}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {/* Basis switcher — governs the whole tab (tiles, expiry strip and
                table all read it). Both bases ship in one response, so this is
                a pure re-render, no refetch. */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.6 }}>
                Basis
              </span>
              <button
                type="button"
                onClick={() => setBasis("net")}
                style={seg(basis === "net")}
                title="Carried OI gamma + today's traded volume gamma — the canonical net book."
              >
                OI+Vol
              </button>
              <button
                type="button"
                onClick={() => hasVol && setBasis("vol")}
                disabled={!hasVol}
                style={{ ...seg(volBasis), opacity: hasVol ? 1 : 0.4, cursor: hasVol ? "pointer" : "not-allowed" }}
                title={
                  hasVol
                    ? "Today's traded volume gamma only — the carried OI book is excluded, so this is what flow put on today."
                    : "This proxy build doesn't serve the volume-only columns yet."
                }
              >
                Vol only
              </button>
            </div>
            <button type="button" onClick={load} style={homeButtonStyle} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        <div style={{ padding: "14px 16px" }}>
          {stats ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
              <Tile
                label="Most call-heavy"
                value={`${stats.mostCall.symbol} ${stats.mostCall.legs[0]!.posPct!.toFixed(0)}%`}
                note={`+${fmtB(stats.mostCall.legs[0]!.pos)} vs −${fmtB(stats.mostCall.legs[0]!.neg)}`}
                color={POS}
              />
              <Tile
                label="Most put-heavy"
                value={`${stats.mostPut.symbol} ${(100 - stats.mostPut.legs[0]!.posPct!).toFixed(0)}%`}
                note={`−${fmtB(stats.mostPut.legs[0]!.neg)} vs +${fmtB(stats.mostPut.legs[0]!.pos)}`}
                color={NEG}
              />
              <Tile
                label="Universe avg"
                value={`${stats.avg.toFixed(0)}% / ${(100 - stats.avg).toFixed(0)}%`}
                note="call-side lean, front expiry"
              />
              <Tile
                label="Biggest E1→E3 shift"
                value={stats.flip?.skew != null ? `${stats.flip.symbol} ${stats.flip.skew > 0 ? "+" : ""}${stats.flip.skew.toFixed(0)}pt` : "—"}
                note={
                  stats.flip?.skew != null
                    ? `${stats.flip.legs[0]!.posPct!.toFixed(0)}% call → ${stats.flip.legs[N_EXP - 1]!.posPct!.toFixed(0)}% call`
                    : "needs both E1 and E3"
                }
                color={stats.flip?.skew != null ? (stats.flip.skew > 0 ? POS : NEG) : undefined}
              />
            </div>
          ) : (
            <div style={{ color: HOME_THEME.text, fontSize: 13 }}>
              {loading ? "Loading…" : err ? `Error: ${err}` : "No recorded snapshots yet."}
            </div>
          )}

          {byExpiry.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{
                fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase",
                color: HOME_THEME.cyan, marginBottom: 8,
              }}>
                Call-side lean by expiration
              </div>
              <div style={{ fontSize: 11, color: HOME_THEME.text, opacity: 0.55, marginBottom: 8 }}>
                bar fills to the call share · tick marks an even split · $-wtd weights by size ·
                fewer than {THIN_N} tickers renders dimmed
              </div>
              {/* One strip in the /home gauge-rail chrome: uppercase label, the
                  same SegMeter the rail uses (pct fill from the left, faint tick
                  at an even split), value underneath in the leading side's color.
                  The 1px grid gap over a light background IS the divider — with
                  auto-fit columns there's no way to know which cell starts a row,
                  so borders can't be placed per-cell. */}
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(132px,1fr))", gap: 1,
                background: "rgba(255,255,255,0.07)", border: `1px solid ${HOME_THEME.border}`,
                borderRadius: 14, overflow: "hidden",
              }}>
                {byExpiry.map((e) => {
                  const lead = e.avgPct >= 50 ? POS : NEG;
                  const thin = e.n < THIN_N;
                  return (
                    <div
                      key={e.expiry}
                      title={
                        `${fmtExpiry(e.expiry)} — ${e.n} ticker${e.n === 1 ? "" : "s"}. ` +
                        `${e.avgPct.toFixed(0)}% of gamma on the call side, every ticker weighted equally` +
                        (e.dollarPct != null ? `; ${e.dollarPct.toFixed(0)}% weighted by size.` : ".") +
                        (thin ? " Thin sample — treat as noise." : "")
                      }
                      style={{
                        padding: "11px 12px 12px", background: "rgba(13,17,25,0.86)",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                        opacity: thin ? 0.45 : 1,
                      }}
                    >
                      <div style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                        color: HOME_THEME.text, opacity: 0.6, whiteSpace: "nowrap",
                      }}>
                        {fmtExpiry(e.expiry)} · n={e.n}
                      </div>
                      <div style={{ width: "100%", maxWidth: 132 }}>
                        <SegMeter t={e.avgPct / 100} midT={0.5} tick={0.5} color={lead} kind="pct" fill />
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: lead, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                        {e.avgPct.toFixed(0)}% / {(100 - e.avgPct).toFixed(0)}%
                      </div>
                      <div style={{ fontSize: 10, color: HOME_THEME.text, opacity: 0.45, marginTop: -2, whiteSpace: "nowrap" }}>
                        {e.dollarPct != null ? `$-wtd ${e.dollarPct.toFixed(0)}%` : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* The table */}
      <Card variant="classic" padding={0}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
          padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.14)",
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: HOME_THEME.cyan }}>
              GEX% by ticker &amp; expiration
            </div>
            <div style={{ fontSize: 12, color: HOME_THEME.text }}>
              share of{" "}
              <b style={{ color: HOME_THEME.cyan }}>{volBasis ? "today's volume gamma" : "net gamma"}</b>{" "}
              on the call side (+) vs the put side (−) · bar fills to the call share, tick marks an
              even split
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="filter ticker…"
              style={{ ...homeInputStyle, fontSize: 13, padding: "6px 10px", width: 140 }}
            />
            <button type="button" onClick={() => setScope("all")} style={seg(scope === "all")}>All</button>
            <button type="button" onClick={() => setScope("stocks")} style={seg(scope === "stocks")}>Stocks</button>
            <button type="button" onClick={() => setScope("index")} style={seg(scope === "index")}>Index / ETF</button>
          </div>
        </div>

        <div style={{ overflowX: "auto", padding: "0 6px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }} onClick={() => toggle("symbol")}>
                  Ticker{arrow("symbol")}
                </th>
                <th style={{ ...th, cursor: "default" }}>Spot</th>
                <th style={{ ...th }} onClick={() => toggle("size")}>
                  Size{arrow("size")}
                </th>
                {Array.from({ length: N_EXP }, (_, i) => (
                  <th
                    key={`h${i}`}
                    style={{ ...th, textAlign: "center", width: EXP_COL_W, color: HOME_THEME.cyan, borderLeft: "1px solid rgba(255,255,255,0.08)" }}
                    onClick={() => toggle(i as SortCol)}
                  >
                    E{i + 1}{arrow(i as SortCol)}
                  </th>
                ))}
                <th style={{ ...th }} onClick={() => toggle("skew")}>
                  Skew{arrow("skew")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.symbol}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 800, color: INDICES.has(t.symbol) ? HOME_THEME.green : HOME_THEME.text }}>
                    {t.symbol}
                  </td>
                  <td style={td}>{fmtSpot(t.spot)}</td>
                  <td style={{ ...td, color: HOME_THEME.text }}>{fmtB(t.total)}</td>
                  {t.legs.map((leg, i) => <SplitCell key={i} leg={leg} />)}
                  <td style={{
                    ...td, fontWeight: 800, fontSize: 13,
                    color: t.skew == null ? DIM : t.skew > 4 ? POS : t.skew < -4 ? NEG : DIM,
                  }}>
                    {t.skew == null ? "—" : `${t.skew > 0 ? "+" : ""}${t.skew.toFixed(0)}pt`}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={N_EXP + 4} style={{ ...td, textAlign: "center", color: HOME_THEME.text, padding: 20 }}>
                    {loading ? "Loading…" : err ? `Error: ${err}` : "No tickers match."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ fontSize: 12, color: HOME_THEME.text, padding: "10px 16px", borderTop: "1px solid rgba(255,255,255,0.14)", lineHeight: 1.6 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <i style={{ width: 10, height: 10, borderRadius: 3, background: POS, display: "inline-block" }} />
              positive GEX (call side / dealers long gamma)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <i style={{ width: 10, height: 10, borderRadius: 3, background: NEG, display: "inline-block" }} />
              negative GEX (put side / dealers short gamma)
            </span>
          </div>
          {volBasis ? (
            <>
              GEX% = share of <b>|volume GEX|</b> at each expiry — today&apos;s traded gamma only
              (<code>gex_now</code>), with the carried OI book excluded. This is what today&apos;s flow put on,
              not where the standing exposure sits.{" "}
              <span style={{ color: HOME_THEME.orange }}>Not a whole-chain figure</span> — and the strike set is
              still the top strikes per side ranked by <i>net</i> GEX, so a strike with heavy volume but little net
              exposure can fall outside it.
            </>
          ) : (
            <>
              GEX% = share of <b>|net GEX|</b> at each expiry, where net = carried OI gamma + today&apos;s volume gamma,
              summed over the top strikes per side the recorder tracks.{" "}
              <span style={{ color: HOME_THEME.orange }}>Not a whole-chain figure</span> — it&apos;s the split across the
              strikes that actually carry the exposure.
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
