"use client";

// ─────────────────────────────────────────────────────────────────────────────
// GEX% — positive vs negative gamma split, per ticker, per expiration
//
// One row per ticker; for each of the front 3 expiries a split bar showing what
// share of that expiry's |net GEX| sits on the positive (call / dealers-long-
// gamma) side vs the negative (put / dealers-short-gamma) side.
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
import { SegSplitMeter, GEX_POS, GEX_NEG } from "@/components/shared/SegMeter";

const N_EXP = 3;

// Split-bar colors: the /home gauge-rail palette — positive/calls blue,
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
};

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

// One expiry cell: split bar + the two percentages + the two dollar figures.
function SplitCell({ leg }: { leg: Leg | null }) {
  if (!leg || leg.posPct == null) {
    return <td style={{ ...td, color: DIM, borderLeft: "1px solid rgba(255,255,255,0.08)" }}>—</td>;
  }
  const p = leg.posPct;
  const n = 100 - p;
  return (
    <td style={{ ...td, borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", minWidth: 118 }}>
        {/* Each ticker's OWN expiry — tickers without a 0DTE have a different
            front three, so the date belongs per-cell, not in a shared header. */}
        <div style={{ fontSize: 11, fontWeight: 600, color: HOME_THEME.text, opacity: 0.75, alignSelf: "flex-start" }}>
          {fmtExpiry(leg.expiry)}
        </div>
        <div style={{ width: "100%" }}>
          <SegSplitMeter posPct={p} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: 12, fontWeight: 700 }}>
          <span style={{ color: POS }}>{p.toFixed(0)}%</span>
          <span style={{ color: NEG }}>{n.toFixed(0)}%</span>
        </div>
        <div style={{ fontSize: 11, color: HOME_THEME.text }}>
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
      const pos = Math.max(0, Number(r.pos_gex) || 0);
      const neg = Math.abs(Number(r.neg_gex) || 0);
      const denom = pos + neg;
      t.legs[idx] = {
        expiry: r.expiry,
        pos, neg,
        posPct: denom > 0 ? (pos / denom) * 100 : null,
        n: (Number(r.n_pos) || 0) + (Number(r.n_neg) || 0),
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
  }, [rows]);

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
          <button type="button" onClick={load} style={homeButtonStyle} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
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
              share of net gamma on the call side (+) vs the put side (−)
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
                    style={{ ...th, textAlign: "center", color: HOME_THEME.cyan, borderLeft: "1px solid rgba(255,255,255,0.08)" }}
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
          GEX% = share of <b>|net GEX|</b> at each expiry, where net = carried OI gamma + today&apos;s volume gamma,
          summed over the top strikes per side the recorder tracks.{" "}
          <span style={{ color: HOME_THEME.orange }}>Not a whole-chain figure</span> — it&apos;s the split across the
          strikes that actually carry the exposure.
        </div>
      </Card>
    </div>
  );
}
