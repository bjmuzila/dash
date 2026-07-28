"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Forward Build — STRUCTURE view ("where is the GEX flow going?")
//
// Full roster as a 5-across CARD grid. Each card carries the essentials — spot,
// day % change, the front expiry's +GEX/−GEX share and its biggest wall (with
// how far OTM that strike sits), net GEX per DTE (0d/1d/2d), call/put wall
// migration, and a tiny 0→1→2 net sparkline — so the whole roster is scannable
// at a glance. Cards start COLLAPSED; click one to open that ticker's front
// 0DTE / 1DTE / 2DTE GEX walls in a full-width panel below, on a shared strike
// ladder, with each strike's net-$ and its day-over-day Δ (is gamma building
// here or leaving?). The bars are styled to match the Logic & Order page's
// GexStructure (solid centre-anchored fill in a subtle track, spot row outlined
// in orange with a ◄ marker).
//
// The grid re-orders on the fly: default (server roster order), alphabetical,
// % change on the day, or the front wall's OTM % — see SORTS below.
//
// Reads GET /proxy/forward-build-structure (getForwardBuildStructure in
// server-v2/strike-growth-recorder.js) — one query over rows the strike-growth
// sweep already wrote, grouped in Node. No live network call per request.
// dayPct rides along from the REST spot backstop's `prev-close`.
// ─────────────────────────────────────────────────────────────────────────────

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, homeButtonStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";

type StrikeRow = {
  strike: number;
  /** Sign of this strike's NET (calls minus puts) — NOT "this is a put". */
  side: "call" | "put";
  net: number;
  delta: number | null;
  /** Minutes since this strike last made the top-N, relative to the newest
   *  reading in its expiry. 0 = current, >0 = rotated out that long ago. */
  ageMin?: number | null;
};
type Dte = {
  dte: number; expiry: string; netTotal: number;
  strikes: StrikeRow[];
  callWall: { strike: number; net: number } | null;
  putWall: { strike: number; net: number } | null;
  /** True CALL-side / PUT-side GEX totals over the full ±20-strike subscribed
   *  window (strike_growth_expiry). callGex >= 0, putGex <= 0. null on expiries
   *  recorded before that table existed — see gexSplitOf's fallback. */
  callGex?: number | null;
  putGex?: number | null;
  /** How many strikes went into callGex/putGex. */
  coverage?: number | null;
  latestTs?: string | null;
};
type Ticker = {
  symbol: string; spot: number; dtes: Dte[];
  /** Prior-session close + % change on the day. null until the REST spot
   *  backstop has a `prev-close` for this root (fresh process / odd symbol). */
  prevClose?: number | null;
  dayPct?: number | null;
};

const GREEN = HOME_THEME.green;
const RED = HOME_THEME.red;
const SPOT = HOME_THEME.orange;
// Secondary label text — near-white instead of the faint border gray.
const DIM = "rgba(255,255,255,0.82)";
const MONO = "var(--font-mono, monospace)";

// Adaptive $ formatting — SPX nets run to billions, single names to thousands.
// Everything under $1M used to collapse to "$0M", which made a $12K strike and a
// $480K strike look identical (and look like exactly zero, which they aren't —
// a genuinely absent strike renders "—"). Step down through M/K so small single
// -name strikes stay readable.
const fmtGex = (v: number): string => {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e7) return `${s}$${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  if (a >= 1) return `${s}$${Math.round(a)}`;
  return "$0";
};
const fmtSigned = (v: number): string => (v >= 0 ? "+" : "") + fmtGex(v);
const fmtStrike = (v: number): string =>
  Number.isInteger(v) ? v.toLocaleString("en-US") : String(v);
const fmtSpot = (v: number): string =>
  v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (v: number): string => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;

const DTE_LABEL = (d: number) => (d === 0 ? "0DTE" : `${d}DTE`);
const dteColor = (d: number) => (d === 0 ? SPOT : d === 1 ? HOME_THEME.cyan : HOME_THEME.purple);

// ── Front-expiry derivations (every card-face metric below comes from here) ──

/** The FRONT / closest expiry we have for this ticker — slot 0 when present,
 *  otherwise the nearest slot that survived the "still in the current
 *  structure" filter applied server-side. */
const frontOf = (t: Ticker): Dte | null =>
  t.dtes.length ? t.dtes.reduce((m, d) => (d.dte < m.dte ? d : m)) : null;

type Split = { pos: number; neg: number; basis: "sides" | "net"; coverage: number | null };

/**
 * +GEX / −GEX share for the front expiry.
 *
 * PREFERRED BASIS ("sides"): true CALL-side vs PUT-side gamma, summed over the
 * full ±20-strike subscribed window and never netted call-against-put within a
 * strike. That's the question the card is actually asking — how much of this
 * expiry's gamma is calls vs puts.
 *
 * FALLBACK BASIS ("net"), used only for expiries recorded before the backend
 * started writing side totals: the share of total |net GEX| sitting on positive
 * strikes, over the stored top-N strikes. It answers a DIFFERENT question and
 * skews hard — a couple of ATM strikes where puts happen to outweigh calls can
 * read as "90% negative" even on a balanced chain — so the card marks it with a
 * ˜ and says so on hover.
 */
function gexSplitOf(t: Ticker): Split | null {
  const f = frontOf(t);
  if (!f) return null;
  if (f.callGex != null && f.putGex != null) {
    const c = Math.abs(f.callGex), p = Math.abs(f.putGex);
    if (c + p > 0) {
      return { pos: (c / (c + p)) * 100, neg: (p / (c + p)) * 100, basis: "sides", coverage: f.coverage ?? null };
    }
  }
  if (!f.strikes.length) return null;
  let pos = 0, abs = 0;
  for (const s of f.strikes) { if (s.net > 0) pos += s.net; abs += Math.abs(s.net); }
  if (!(abs > 0)) return null;
  const v = (pos / abs) * 100;
  return { pos: v, neg: 100 - v, basis: "net", coverage: null };
}

/** A strike this many minutes behind its expiry's newest reading is drawn dim —
 *  it rotated out of the top-N walls and its net/Δ are frozen at that time. */
const STALE_MIN = 30;

/**
 * The front expiry's BIGGEST wall — largest |net GEX| on either side — and how
 * far that strike sits from spot, signed: + above spot, − below. This is the
 * "front expiration highest GEX OTM%" shown on each card, and the key behind
 * the OTM sort.
 */
function topWallOf(t: Ticker): { strike: number; net: number; otmPct: number; dte: number } | null {
  const f = frontOf(t);
  if (!f || !f.strikes.length || !(t.spot > 0)) return null;
  const w = f.strikes.reduce((m, s) => (Math.abs(s.net) > Math.abs(m.net) ? s : m));
  return { strike: w.strike, net: w.net, otmPct: ((w.strike - t.spot) / t.spot) * 100, dte: f.dte };
}

// ── Sorting ─────────────────────────────────────────────────────────────────

type SortKey = "default" | "alpha" | "day" | "otm";
// `dir` is the direction a key SNAPS TO when it's picked (A→Z for alpha,
// biggest-first for the numerics); the ▲/▼ button flips it from there.
const SORTS: { key: SortKey; label: string; dir: 1 | -1 }[] = [
  { key: "default", label: "Default (roster order)", dir: 1 },
  { key: "alpha", label: "Alphabetical", dir: 1 },
  { key: "day", label: "% change on day", dir: -1 },
  { key: "otm", label: "Front wall OTM %", dir: -1 },
];

// Tiny 0→1→2 net sparkline for the card face (3 points, self-normalized).
function CardSpark({ pts }: { pts: number[] }) {
  const w = 56, h = 19;
  if (pts.length < 2) return null;
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const d = pts.map((v, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(h - ((v - lo) / span) * h).toFixed(1)}`).join(" ");
  const up = pts[pts.length - 1] >= pts[0];
  return (
    <svg width={w} height={h} style={{ display: "block", opacity: 0.6 }}>
      <polyline points={d} fill="none" stroke={up ? GREEN : RED} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// One DTE column's ladder, Logic & Order GexStructure style. `rows` is the
// shared ladder (union of strikes across the 3 columns, with spot markers);
// `col` maps strike→this DTE's row. Bars scale to THIS column's own max net GEX
// (per-profile): the biggest wall in each expiry fills the bar. Scaling across the
// whole ticker instead flattened 1DTE/2DTE to slivers next to 0DTE's huge walls.
function LadderColumn({ dte, info, rows, col, spot }: {
  dte: number; info: Dte | null; rows: Array<{ spot: true } | { strike: number }>;
  col: Map<number, StrikeRow>; spot: number;
}) {
  // Bars encode the DAY-OVER-DAY FLOW, not the static net: length = |Δ| scaled to
  // this column's biggest move; a wall "building" (|net| grew vs yesterday) points
  // right/green, "fading" (|net| shrank) points left/red. That's the whole point —
  // see which walls are gaining/losing GEX day to day, i.e. where gamma is flowing.
  const colMaxD = useMemo(() => {
    let m = 0; col.forEach((s) => { if (s.delta != null && Math.abs(s.delta) > m) m = Math.abs(s.delta); }); return m;
  }, [col]);
  const cell: CSSProperties = {
    display: "grid", gridTemplateColumns: "56px 1fr 68px 60px", alignItems: "center",
    gap: 7, padding: "1px 5px", borderRadius: 3,
  };
  return (
    <div style={{ background: HOME_THEME.panel, padding: "9px 11px 11px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 7 }}>
        <span style={{ fontWeight: 800, fontSize: 14, color: dteColor(dte) }}>{DTE_LABEL(dte)}</span>
        <span style={{ color: DIM, fontSize: 11.5, fontFamily: MONO }}>{info ? info.expiry.slice(5) : ""}</span>
        <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 700, fontFamily: MONO, color: info ? (info.netTotal >= 0 ? GREEN : RED) : DIM }}>
          {info ? fmtSigned(info.netTotal) : "no data"}
        </span>
      </div>
      <div style={{ ...cell, padding: "0 5px 4px", borderBottom: `1px solid ${HOME_THEME.border}`, marginBottom: 5 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: DIM }}>Strike</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.03em", textAlign: "center", color: DIM }}>◄ fading · building ►</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", textAlign: "right", color: DIM }}>Net GEX</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", textAlign: "right", color: DIM }}>Δ DoD</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {rows.map((r, i) => {
          if ("spot" in r) {
            return (
              <div key={`s${i}`} style={{ position: "relative", height: 10 }}>
                <div style={{ position: "absolute", left: 0, right: 0, top: 4, height: 2, background: "#fff", boxShadow: "0 0 5px rgba(255,255,255,0.4)", borderRadius: 1 }} />
                <span style={{ position: "absolute", left: 0, top: -3, fontSize: 10, fontWeight: 800, color: "#fff", fontFamily: MONO, background: HOME_THEME.panel, paddingRight: 4 }}>{fmtSpot(spot)}</span>
              </div>
            );
          }
          const s = col.get(r.strike) ?? null;
          const pos = !!s && s.net >= 0;
          // Wall building = |net| grew vs yesterday (net & Δ share a sign); fading =
          // |net| shrank. Bar length = |Δ| scaled to this column's biggest move.
          const build = !!s && s.delta != null && s.net * s.delta > 0;
          const fade = !!s && s.delta != null && s.net * s.delta < 0;
          const frac = s && s.delta != null && colMaxD > 0 ? Math.abs(s.delta) / colMaxD : 0;
          // Δ arrow/color mean BUILDING vs FADING (wall growth), matching the bar —
          // NOT the raw net sign. A put wall building has net going more negative,
          // so raw Δ would show ▼ even though the wall grew; that mismatch confused.
          const dTone = build ? GREEN : fade ? RED : HOME_THEME.text;
          const arrow = build ? "▲ " : fade ? "▼ " : "";
          // Rotated out of the walls a while ago → its numbers are frozen at that
          // sweep. Dim the whole row instead of dropping it, so the day's strike
          // list stays intact but you can see at a glance what's actually live.
          const stale = s?.ageMin != null && s.ageMin >= STALE_MIN;
          return (
            <div
              key={r.strike}
              style={{ ...cell, opacity: stale ? 0.42 : 1 }}
              title={stale ? `Last recorded ${s?.ageMin}m before this expiry's latest sweep — rotated out of the top walls, values frozen at that time.` : undefined}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: HOME_THEME.text, fontFamily: MONO }}>{fmtStrike(r.strike)}</span>
              <div style={{ position: "relative", height: 12, background: "rgba(255,255,255,0.04)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: HOME_THEME.border }} />
                {(build || fade) && (
                  <div style={{ position: "absolute", top: 1, bottom: 1, [build ? "left" : "right"]: "50%", width: `${Math.max(2, frac * 50)}%`, background: build ? GREEN : RED, borderRadius: 2 } as CSSProperties} />
                )}
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, textAlign: "right", fontFamily: MONO, color: s ? (pos ? GREEN : RED) : DIM }}>
                {s ? fmtSigned(s.net) : "—"}
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 700, textAlign: "right", fontFamily: MONO, color: dTone }}>
                {s && s.delta != null ? `${arrow}${fmtGex(Math.abs(s.delta))}` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailPanel({ t, onClose }: { t: Ticker; onClose: () => void }) {
  const byDte = useMemo(() => {
    const m = new Map<number, Map<number, StrikeRow>>();
    for (const d of t.dtes) { const sm = new Map<number, StrikeRow>(); d.strikes.forEach((s) => sm.set(s.strike, s)); m.set(d.dte, sm); }
    return m;
  }, [t]);
  const ladder = useMemo(() => {
    const set = new Set<number>();
    t.dtes.forEach((d) => d.strikes.forEach((s) => set.add(s.strike)));
    const strikes = [...set].sort((a, b) => b - a);
    const rows: Array<{ spot: true } | { strike: number }> = [];
    let placed = false;
    for (const k of strikes) { if (!placed && k < t.spot) { rows.push({ spot: true }); placed = true; } rows.push({ strike: k }); }
    if (!placed) rows.push({ spot: true });
    return rows;
  }, [t]);
  const cw = [0, 1, 2].map((d) => t.dtes.find((x) => x.dte === d)?.callWall?.strike ?? null);
  const pw = [0, 1, 2].map((d) => t.dtes.find((x) => x.dte === d)?.putWall?.strike ?? null);
  const hasWalls = cw.filter((x) => x != null).length + pw.filter((x) => x != null).length > 1;

  return (
    <div style={{ marginTop: 10, maxWidth: 980, background: HOME_THEME.panel, border: `1px solid ${HOME_THEME.cyan}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 14px", borderBottom: `1px solid ${HOME_THEME.border}` }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: HOME_THEME.cyan, letterSpacing: "0.03em" }}>{t.symbol}</span>
        <span style={{ fontSize: 14, fontFamily: MONO, color: SPOT }}>spot {fmtSpot(t.spot)}</span>
        {t.dayPct != null && (
          <span style={{ fontSize: 14, fontWeight: 700, fontFamily: MONO, color: t.dayPct >= 0 ? GREEN : RED }}>{fmtPct(t.dayPct)}</span>
        )}
        <span style={{ marginLeft: "auto", cursor: "pointer", color: HOME_THEME.text, fontSize: 18, lineHeight: 1 }} onClick={onClose}>✕</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: HOME_THEME.border }}>
        {[0, 1, 2].map((d) => (
          <LadderColumn key={d} dte={d} info={t.dtes.find((x) => x.dte === d) ?? null} rows={ladder} col={byDte.get(d) ?? new Map()} spot={t.spot} />
        ))}
      </div>
      {hasWalls && (
        <div style={{ padding: "8px 14px", borderTop: `1px solid ${HOME_THEME.border}` }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, fontFamily: MONO }}>
            <tbody>
              <tr>
                <th style={{ textAlign: "left", fontWeight: 600, fontSize: 11, letterSpacing: "0.04em", color: DIM, padding: "1px 10px 1px 0" }}></th>
                {[0, 1, 2].map((d) => (
                  <th key={d} style={{ textAlign: "right", fontWeight: 600, fontSize: 11, letterSpacing: "0.04em", color: DIM, padding: "1px 8px" }}>{d}D</th>
                ))}
              </tr>
              <tr>
                <td style={{ textAlign: "left", color: GREEN, padding: "1px 10px 1px 0" }}>Call wall</td>
                {cw.map((s, i) => (
                  <td key={i} style={{ textAlign: "right", color: s != null ? GREEN : DIM, padding: "1px 8px" }}>{s != null ? fmtStrike(s) : "—"}</td>
                ))}
              </tr>
              <tr>
                <td style={{ textAlign: "left", color: RED, padding: "1px 10px 1px 0" }}>Put wall</td>
                {pw.map((s, i) => (
                  <td key={i} style={{ textAlign: "right", color: s != null ? RED : DIM, padding: "1px 8px" }}>{s != null ? fmtStrike(s) : "—"}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ForwardBuildStructure() {
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [asOf, setAsOf] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // Nothing is expanded on arrival — the grid IS the view; a card opens only on
  // click. (It used to auto-open the first ticker, which shoved the roster down
  // the page and made it look like only one thing had loaded.)
  const [sel, setSel] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const load = () => {
    setLoading(true); setErr(null);
    fetch("/proxy/forward-build-structure?limit=400", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "load failed");
        const rows: Ticker[] = Array.isArray(j.tickers) ? j.tickers : [];
        setTickers(rows); setAsOf(j.asOf || "");
      })
      .catch((e) => setErr(String((e as Error)?.message || e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // Auto-refresh: silently re-pull every 60s so spot/walls stay live without
  // clicking Refresh. Unlike load(), this does NOT toggle loading or reset the
  // open panel (sel) — it only swaps in fresh data. Pauses while the tab is hidden,
  // and SKIPS if a previous fetch is still in flight so a slow response can't pile
  // up overlapping heavy queries (that stacked pending requests and hammered the DB).
  const refreshing = useRef(false);
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (refreshing.current) return;
      refreshing.current = true;
      fetch("/proxy/forward-build-structure?limit=400", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (!j.ok) return;
          setTickers(Array.isArray(j.tickers) ? j.tickers : []);
          setAsOf(j.asOf || "");
        })
        .catch(() => {})
        .finally(() => { refreshing.current = false; });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Front-expiry derivations, computed once per data refresh and shared by the
  // card faces AND the sort comparators — topWallOf walks every strike, so
  // deriving it inside a comparator would redo that work O(n log n) times.
  const derived = useMemo(() => {
    const m = new Map<string, { split: ReturnType<typeof gexSplitOf>; wall: ReturnType<typeof topWallOf> }>();
    for (const t of tickers) m.set(t.symbol, { split: gexSplitOf(t), wall: topWallOf(t) });
    return m;
  }, [tickers]);

  const view = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const filtered = needle ? tickers.filter((t) => t.symbol.includes(needle)) : tickers;
    if (sortKey === "default") return filtered; // server roster order (hot/majors first)
    const arr = [...filtered];
    // Missing values always sink to the bottom, whichever direction is active —
    // a ticker with no prior close shouldn't win "biggest gainer" by being null.
    const byNum = (get: (t: Ticker) => number | null | undefined) => (a: Ticker, b: Ticker) => {
      const x = get(a), y = get(b);
      const xn = x == null || !Number.isFinite(x), yn = y == null || !Number.isFinite(y);
      if (xn && yn) return a.symbol.localeCompare(b.symbol);
      if (xn) return 1;
      if (yn) return -1;
      return ((x as number) - (y as number)) * sortDir;
    };
    if (sortKey === "alpha") arr.sort((a, b) => a.symbol.localeCompare(b.symbol) * sortDir);
    else if (sortKey === "day") arr.sort(byNum((t) => t.dayPct));
    else if (sortKey === "otm") arr.sort(byNum((t) => derived.get(t.symbol)?.wall?.otmPct));
    return arr;
  }, [tickers, q, sortKey, sortDir, derived]);

  // Scroll the open accordion panel into view on click.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (sel && panelRef.current) panelRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [sel]);

  const inputStyle: CSSProperties = {
    minWidth: 180, padding: "8px 11px", borderRadius: 8, fontSize: 15,
    border: `1px solid ${HOME_THEME.border}`, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text,
  };
  const net = (t: Ticker, d: number) => t.dtes.find((x) => x.dte === d)?.netTotal;
  // Top mover per expiry: the strike whose wall grew most (build) and shrank most
  // (fade) vs yesterday. "Growing" = |net| increasing (net & Δ share a sign).
  const flowOf = (t: Ticker, d: number): { build: StrikeRow | null; fade: StrikeRow | null } | null => {
    const e = t.dtes.find((x) => x.dte === d);
    if (!e) return null;
    let build: StrikeRow | null = null, fade: StrikeRow | null = null;
    for (const s of e.strikes) {
      if (s.delta == null) continue;
      const g = s.net * s.delta;
      if (g > 0) { if (!build || Math.abs(s.delta) > Math.abs(build.delta as number)) build = s; }
      else if (g < 0) { if (!fade || Math.abs(s.delta) > Math.abs(fade.delta as number)) fade = s; }
    }
    return { build, fade };
  };

  return (
    <>
      <style>{`
        .fb-grid{ display:grid; grid-template-columns:repeat(5,1fr); gap:12px; }
        @media (max-width:1600px){ .fb-grid{ grid-template-columns:repeat(4,1fr); } }
        @media (max-width:1250px){ .fb-grid{ grid-template-columns:repeat(3,1fr); } }
        @media (max-width:900px){ .fb-grid{ grid-template-columns:repeat(2,1fr); } }
        @media (max-width:620px){ .fb-grid{ grid-template-columns:1fr; } }
        .fb-card{ background:${HOME_THEME.panel}; border:1px solid ${HOME_THEME.border}; border-radius:11px;
          padding:14px 15px; cursor:pointer; transition:border-color .12s, transform .12s; position:relative; }
        .fb-card:hover{ border-color:#2b3a4d; transform:translateY(-1px); }
        .fb-card.sel{ border-color:${HOME_THEME.cyan}; box-shadow:0 0 0 1px ${HOME_THEME.cyan} inset; }
        .fb-select{ padding:8px 11px; border-radius:8px; font-size:15px; border:1px solid ${HOME_THEME.border};
          background:rgba(0,0,0,0.4); color:${HOME_THEME.text}; }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ fontSize: 16, color: HOME_THEME.text }}>
          {loading ? "Loading forward build…"
            : asOf ? `0/1/2-DTE GEX structure by ticker · as of ${asOf} · ${tickers.length} tickers`
            : "No structure yet (needs live dxLink data + a session or two of history)."}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter ticker…" style={inputStyle} />
        {/* Card ordering. Picking a key snaps the direction to that key's natural
            default (A→Z for alpha, biggest-first for the numerics); ▲/▼ flips it. */}
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 15, color: DIM }}>
          Sort
          <select
            className="fb-select"
            value={sortKey}
            onChange={(e) => {
              const k = e.target.value as SortKey;
              setSortKey(k);
              setSortDir(SORTS.find((s) => s.key === k)?.dir ?? 1);
            }}
          >
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        {sortKey !== "default" && (
          <button
            onClick={() => setSortDir((d) => (d === 1 ? -1 : 1))}
            style={{ ...homeButtonStyle, fontSize: 15, minWidth: 44 }}
            title={sortDir === 1 ? "Ascending — click for descending" : "Descending — click for ascending"}
          >
            {sortDir === 1 ? "▲" : "▼"}
          </button>
        )}
        <button onClick={load} style={{ ...homeButtonStyle, fontSize: 15 }}>Refresh</button>
      </div>
      {err && <div style={{ fontSize: 16, color: RED, marginBottom: 8 }}>Error: {err}</div>}

      <Card variant="budget" accent={SPOT} title="Forward Build — GEX structure & day-over-day flow">
        <div className="fb-grid">
          {view.map((t) => {
            const chips = [0, 1, 2].map((d) => ({ d, v: net(t, d) })).filter((x) => x.v != null) as { d: number; v: number }[];
            const isOpen = sel === t.symbol;
            const der = derived.get(t.symbol);
            const split = der?.split ?? null;
            const wall = der?.wall ?? null;
            return (
              <Fragment key={t.symbol}>
              <div className={`fb-card${isOpen ? " sel" : ""}`} onClick={() => setSel(isOpen ? null : t.symbol)}>
                {/* Identity row: ticker · spot · day % · front-expiry +/−GEX share. */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, rowGap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{ fontSize: 25, fontWeight: 800, letterSpacing: "0.03em", color: "#cfe0ff" }}>{t.symbol}</span>
                  <span style={{ fontSize: 17, fontFamily: MONO, color: SPOT, background: "rgba(233,185,73,0.08)", border: `1px solid ${SPOT}44`, borderRadius: 5, padding: "3px 8px" }}>{fmtSpot(t.spot)}</span>
                  {t.dayPct != null && (
                    <span style={{ fontSize: 15, fontWeight: 800, fontFamily: MONO, color: t.dayPct >= 0 ? GREEN : RED }}>{fmtPct(t.dayPct)}</span>
                  )}
                  {split && (
                    <span
                      style={{ marginLeft: "auto", fontSize: 15, fontWeight: 800, fontFamily: MONO, whiteSpace: "nowrap" }}
                      title={split.basis === "sides"
                        ? `Front expiry — call-side vs put-side GEX across ${split.coverage ?? "all"} strikes (±20 around spot). Calls and puts summed separately, not netted per strike.`
                        : "Approximate — no side totals recorded for this expiry yet, so this is the share of |net GEX| on positive strikes over the stored top-N walls. It over-reads the dominant side."}
                    >
                      <span style={{ color: GREEN }}>+{split.pos.toFixed(0)}%</span>
                      <span style={{ color: DIM, opacity: 0.55 }}> / </span>
                      <span style={{ color: RED }}>−{split.neg.toFixed(0)}%</span>
                      {split.basis === "net" && <span style={{ color: DIM, opacity: 0.6, fontSize: 12 }}> ˜</span>}
                    </span>
                  )}
                </div>
                {/* Front expiry's biggest wall + how far OTM that strike sits. */}
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9, fontSize: 12.5 }}>
                  <span style={{ color: DIM, letterSpacing: "0.03em", flexShrink: 0 }}>{`${wall ? DTE_LABEL(wall.dte) : "front"} top wall`}</span>
                  {wall ? (
                    <>
                      <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 15, color: wall.net >= 0 ? GREEN : RED }}>{fmtStrike(wall.strike)}</span>
                      <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 15, color: SPOT }} title="Distance from spot — + above, − below">{fmtPct(wall.otmPct)}</span>
                    </>
                  ) : <span style={{ color: DIM }}>—</span>}
                  <span style={{ marginLeft: "auto" }}><CardSpark pts={chips.map((c) => c.v)} /></span>
                </div>
                {/* Flow-first: the day-over-day movers are the hero. Per expiry, the
                    strike whose wall grew most (▲ green) and shrank most (▼ red). */}
                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  {[0, 1, 2].map((d) => {
                    const has = t.dtes.some((x) => x.dte === d);
                    const f = flowOf(t, d);
                    return (
                      <div key={d} style={{ flex: 1, border: `1px solid ${HOME_THEME.border}`, borderRadius: 7, padding: "7px 4px", background: "rgba(255,255,255,0.02)" }}>
                        <div style={{ fontSize: 11.5, color: DIM, textAlign: "center", letterSpacing: "0.04em", marginBottom: 5 }}>{d}D</div>
                        {has ? (
                          <>
                            <div style={{ textAlign: "center", fontFamily: MONO, fontSize: 15.5, fontWeight: 800, color: GREEN, lineHeight: 1.15 }}>
                              {f?.build ? `▲ ${fmtStrike(f.build.strike)}` : "▲ —"}
                            </div>
                            <div style={{ textAlign: "center", fontFamily: MONO, fontSize: 11, color: GREEN, opacity: 0.85, marginBottom: 5 }}>
                              {f?.build ? `+${fmtGex(Math.abs(f.build.delta as number))}` : " "}
                            </div>
                            <div style={{ textAlign: "center", fontFamily: MONO, fontSize: 15.5, fontWeight: 800, color: RED, lineHeight: 1.15 }}>
                              {f?.fade ? `▼ ${fmtStrike(f.fade.strike)}` : "▼ —"}
                            </div>
                            <div style={{ textAlign: "center", fontFamily: MONO, fontSize: 11, color: RED, opacity: 0.85 }}>
                              {f?.fade ? `-${fmtGex(Math.abs(f.fade.delta as number))}` : " "}
                            </div>
                          </>
                        ) : <div style={{ textAlign: "center", color: DIM, fontSize: 13, padding: "8px 0" }}>—</div>}
                      </div>
                    );
                  })}
                </div>
                {/* Walls, demoted to a compact secondary row: put · call per expiry. */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 7, borderTop: `1px solid ${HOME_THEME.border}` }}>
                  <span style={{ fontSize: 11, color: DIM, letterSpacing: "0.03em", flexShrink: 0 }}>walls</span>
                  {[0, 1, 2].map((d) => {
                    const cwS = t.dtes.find((x) => x.dte === d)?.callWall?.strike ?? null;
                    const pwS = t.dtes.find((x) => x.dte === d)?.putWall?.strike ?? null;
                    return (
                      <div key={d} style={{ flex: 1, textAlign: "center", fontSize: 11.5, fontFamily: MONO }}>
                        <span style={{ color: "rgba(255,92,102,0.7)" }}>{pwS != null ? fmtStrike(pwS) : "—"}</span>
                        <span style={{ color: DIM, opacity: 0.6 }}> · </span>
                        <span style={{ color: "rgba(38,222,129,0.7)" }}>{cwS != null ? fmtStrike(cwS) : "—"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {isOpen && (
                <div ref={panelRef} style={{ gridColumn: "1 / -1" }}>
                  <DetailPanel t={t} onClose={() => setSel(null)} />
                </div>
              )}
              </Fragment>
            );
          })}
          {!loading && !view.length && (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", color: HOME_THEME.text, padding: 24 }}>No tickers to show.</div>
          )}
        </div>

        <div style={{ fontSize: 14, color: HOME_THEME.text, marginTop: 12, lineHeight: 1.6 }}>
          Each card is a ticker — spot, % change on the day, and for the <b>front (closest) expiry</b> the
          <span style={{ color: GREEN }}> +GEX</span> / <span style={{ color: RED }}>−GEX</span> share: call-side vs
          put-side gamma summed <b>separately</b> across the ±20 strikes around spot, not netted against each other
          per strike. (A <span style={{ color: DIM }}>˜</span> means that expiry predates the side totals and is
          falling back to the older net-based estimate, which over-reads the dominant side.) Next to it: that
          expiry&rsquo;s biggest wall and how far the strike sits from spot (<b>+</b> above, <b>−</b> below).
          Under it: net GEX for the front
          <b> 0/1/2-DTE</b> expiries and where the call/put walls are migrating across the three days. Use <b>Sort</b> to
          reorder the grid by name, day move, or that OTM distance. Click a card to open its ladder: bars are net GEX
          per strike (<span style={{ color: GREEN }}>green</span> = support, <span style={{ color: RED }}>red</span> =
          resistance), the right numbers are the strike&rsquo;s net-$ and its <b>day-over-day Δ</b> vs the same
          expiry&rsquo;s prior session (<span style={{ color: GREEN }}>▲</span> building,
          <span style={{ color: RED }}> ▼</span> leaving). A 2DTE strike that just entered the window shows
          &ldquo;—&rdquo; until it has a prior session to compare. <b>Dimmed ladder rows</b> are strikes that dropped
          out of the top walls more than {STALE_MIN} minutes ago — still shown for context, but their numbers are
          frozen at that sweep.
        </div>
      </Card>
    </>
  );
}
