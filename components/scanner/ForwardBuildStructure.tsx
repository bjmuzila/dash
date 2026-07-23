"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Forward Build — STRUCTURE view ("where is the GEX flow going?")
//
// Full roster as a 5-across CARD grid. Each card carries the essentials — spot,
// net GEX per DTE (0d/1d/2d), call/put wall migration, and a tiny 0→1→2 net
// sparkline — so the whole roster is scannable at a glance. Click a card to open
// that ticker's front 0DTE / 1DTE / 2DTE GEX walls in a full-width panel below,
// on a shared strike ladder, with each strike's net-$ and its day-over-day Δ
// (is gamma building here or leaving?). The bars are styled to match the
// Logic & Order page's GexStructure (solid centre-anchored fill in a subtle
// track, spot row outlined in orange with a ◄ marker).
//
// Reads GET /proxy/forward-build-structure (getForwardBuildStructure in
// server-v2/strike-growth-recorder.js) — one query over rows the strike-growth
// sweep already wrote, grouped in Node. No live network call per request.
// ─────────────────────────────────────────────────────────────────────────────

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, homeButtonStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";

type StrikeRow = { strike: number; side: "call" | "put"; net: number; delta: number | null };
type Dte = {
  dte: number; expiry: string; netTotal: number;
  strikes: StrikeRow[];
  callWall: { strike: number; net: number } | null;
  putWall: { strike: number; net: number } | null;
};
type Ticker = { symbol: string; spot: number; dtes: Dte[] };

const GREEN = HOME_THEME.green;
const RED = HOME_THEME.red;
const SPOT = HOME_THEME.orange;
// Secondary label text — near-white instead of the faint border gray.
const DIM = "rgba(255,255,255,0.82)";

// Adaptive $ formatting — SPX nets run to billions, single names to millions.
const fmtGex = (v: number): string => {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  return `${s}$${(a / 1e6).toFixed(0)}M`;
};
const fmtSigned = (v: number): string => (v >= 0 ? "+" : "") + fmtGex(v);
const fmtStrike = (v: number): string =>
  Number.isInteger(v) ? v.toLocaleString("en-US") : String(v);
const fmtSpot = (v: number): string =>
  v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2);

const DTE_LABEL = (d: number) => (d === 0 ? "0DTE" : `${d}DTE`);
const dteColor = (d: number) => (d === 0 ? SPOT : d === 1 ? HOME_THEME.cyan : HOME_THEME.purple);

// Tiny 0→1→2 net sparkline for the card face (3 points, self-normalized).
function CardSpark({ pts }: { pts: number[] }) {
  const w = 46, h = 16;
  if (pts.length < 2) return null;
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const d = pts.map((v, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(h - ((v - lo) / span) * h).toFixed(1)}`).join(" ");
  const up = pts[pts.length - 1] >= pts[0];
  return (
    <svg width={w} height={h} style={{ display: "block", opacity: 0.6 }}>
      <polyline points={d} fill="none" stroke={up ? GREEN : RED} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// One DTE column's ladder, Logic & Order GexStructure style. `rows` is the
// shared ladder (union of strikes across the 3 columns, with spot markers);
// `col` maps strike→this DTE's row; maxAbs scales bars across the whole ticker.
function LadderColumn({ dte, info, rows, col, maxAbs, spot }: {
  dte: number; info: Dte | null; rows: Array<{ spot: true } | { strike: number }>;
  col: Map<number, StrikeRow>; maxAbs: number; spot: number;
}) {
  const cell: CSSProperties = {
    display: "grid", gridTemplateColumns: "44px 1fr 56px 48px", alignItems: "center",
    gap: 6, padding: "1px 5px", borderRadius: 3,
  };
  return (
    <div style={{ background: HOME_THEME.panel, padding: "8px 10px 9px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 11.5, color: dteColor(dte) }}>{DTE_LABEL(dte)}</span>
        <span style={{ color: DIM, fontSize: 9.5, fontFamily: "var(--font-mono, monospace)" }}>{info ? info.expiry.slice(5) : ""}</span>
        <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: info ? (info.netTotal >= 0 ? GREEN : RED) : DIM }}>
          {info ? fmtSigned(info.netTotal) : "no data"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {rows.map((r, i) => {
          if ("spot" in r) {
            return (
              <div key={`s${i}`} style={{ ...cell, background: "rgba(255,255,255,0.06)", outline: `1px solid ${SPOT}66` }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: SPOT, fontFamily: "var(--font-mono, monospace)" }}>{fmtSpot(spot)}<span style={{ fontSize: 8, marginLeft: 2 }}>◄</span></span>
                <div /><div /><div />
              </div>
            );
          }
          const s = col.get(r.strike) ?? null;
          const pos = !!s && s.net >= 0;
          const frac = s && maxAbs > 0 ? Math.abs(s.net) / maxAbs : 0;
          const dTone = s?.delta == null ? HOME_THEME.text : s.delta > 0 ? GREEN : s.delta < 0 ? RED : HOME_THEME.text;
          const arrow = s?.delta == null ? "" : s.delta > 0 ? "▲ " : s.delta < 0 ? "▼ " : "";
          return (
            <div key={r.strike} style={cell}>
              <span style={{ fontSize: 11, fontWeight: 700, color: HOME_THEME.text, fontFamily: "var(--font-mono, monospace)" }}>{fmtStrike(r.strike)}</span>
              <div style={{ position: "relative", height: 10, background: "rgba(255,255,255,0.04)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: HOME_THEME.border }} />
                {s && (
                  <div style={{ position: "absolute", top: 1, bottom: 1, [pos ? "left" : "right"]: "50%", width: `${Math.max(2, frac * 50)}%`, background: pos ? GREEN : RED, borderRadius: 2 } as CSSProperties} />
                )}
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, textAlign: "right", fontFamily: "var(--font-mono, monospace)", color: s ? (pos ? GREEN : RED) : DIM }}>
                {s ? fmtSigned(s.net) : "—"}
              </span>
              <span style={{ fontSize: 9.5, fontWeight: 700, textAlign: "right", fontFamily: "var(--font-mono, monospace)", color: dTone }}>
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
  const maxAbs = useMemo(() => {
    let m = 0; t.dtes.forEach((d) => d.strikes.forEach((s) => { if (Math.abs(s.net) > m) m = Math.abs(s.net); })); return m;
  }, [t]);
  const cw = [0, 1, 2].map((d) => t.dtes.find((x) => x.dte === d)?.callWall?.strike).filter((x) => x != null) as number[];
  const pw = [0, 1, 2].map((d) => t.dtes.find((x) => x.dte === d)?.putWall?.strike).filter((x) => x != null) as number[];

  return (
    <div style={{ marginTop: 10, maxWidth: 620, background: HOME_THEME.panel, border: `1px solid ${HOME_THEME.cyan}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: `1px solid ${HOME_THEME.border}` }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: HOME_THEME.cyan, letterSpacing: "0.03em" }}>{t.symbol}</span>
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono, monospace)", color: SPOT }}>spot {fmtSpot(t.spot)}</span>
        <span style={{ marginLeft: "auto", cursor: "pointer", color: HOME_THEME.text, fontSize: 15, lineHeight: 1 }} onClick={onClose}>✕</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: HOME_THEME.border }}>
        {[0, 1, 2].map((d) => (
          <LadderColumn key={d} dte={d} info={t.dtes.find((x) => x.dte === d) ?? null} rows={ladder} col={byDte.get(d) ?? new Map()} maxAbs={maxAbs} spot={t.spot} />
        ))}
      </div>
      {(cw.length > 1 || pw.length > 1) && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", padding: "7px 12px", borderTop: `1px solid ${HOME_THEME.border}`, fontSize: 10.5, color: HOME_THEME.text }}>
          {cw.length > 1 && <span><b>Call wall:</b> <span style={{ color: GREEN, fontFamily: "var(--font-mono, monospace)" }}>{cw.map(fmtStrike).join(" → ")}</span></span>}
          {pw.length > 1 && <span><b>Put wall:</b> <span style={{ color: RED, fontFamily: "var(--font-mono, monospace)" }}>{pw.map(fmtStrike).join(" → ")}</span></span>}
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
  const [sel, setSel] = useState<string | null>(null);

  const load = () => {
    setLoading(true); setErr(null);
    fetch("/proxy/forward-build-structure?limit=400", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "load failed");
        const rows: Ticker[] = Array.isArray(j.tickers) ? j.tickers : [];
        setTickers(rows); setAsOf(j.asOf || "");
        setSel(rows.length ? rows[0].symbol : null);
      })
      .catch((e) => setErr(String((e as Error)?.message || e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const view = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return needle ? tickers.filter((t) => t.symbol.includes(needle)) : tickers;
  }, [tickers, q]);
  // Scroll the open accordion panel into view on click (skip the initial auto-open).
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (sel && panelRef.current) panelRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [sel]);

  const inputStyle: CSSProperties = {
    minWidth: 160, padding: "7px 10px", borderRadius: 8, fontSize: 13,
    border: `1px solid ${HOME_THEME.border}`, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text,
  };
  const net = (t: Ticker, d: number) => t.dtes.find((x) => x.dte === d)?.netTotal;

  return (
    <>
      <style>{`
        .fb-grid{ display:grid; grid-template-columns:repeat(5,1fr); gap:12px; }
        @media (max-width:1400px){ .fb-grid{ grid-template-columns:repeat(4,1fr); } }
        @media (max-width:1100px){ .fb-grid{ grid-template-columns:repeat(3,1fr); } }
        @media (max-width:820px){ .fb-grid{ grid-template-columns:repeat(2,1fr); } }
        .fb-card{ background:${HOME_THEME.panel}; border:1px solid ${HOME_THEME.border}; border-radius:11px;
          padding:13px 14px; cursor:pointer; transition:border-color .12s, transform .12s; position:relative; }
        .fb-card:hover{ border-color:#2b3a4d; transform:translateY(-1px); }
        .fb-card.sel{ border-color:${HOME_THEME.cyan}; box-shadow:0 0 0 1px ${HOME_THEME.cyan} inset; }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ fontSize: 14, color: HOME_THEME.text }}>
          {loading ? "Loading forward build…"
            : asOf ? `0/1/2-DTE GEX structure by ticker · as of ${asOf} · ${tickers.length} tickers`
            : "No structure yet (needs live dxLink data + a session or two of history)."}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter ticker…" style={inputStyle} />
        <button onClick={load} style={homeButtonStyle}>Refresh</button>
      </div>
      {err && <div style={{ fontSize: 14, color: RED, marginBottom: 8 }}>Error: {err}</div>}

      <Card variant="budget" accent={SPOT} title="Forward Build — GEX structure & day-over-day flow">
        <div className="fb-grid">
          {view.map((t) => {
            const chips = [0, 1, 2].map((d) => ({ d, v: net(t, d) })).filter((x) => x.v != null) as { d: number; v: number }[];
            const cw = [0, 1, 2].map((d) => t.dtes.find((x) => x.dte === d)?.callWall?.strike).filter((x) => x != null) as number[];
            const pw = [0, 1, 2].map((d) => t.dtes.find((x) => x.dte === d)?.putWall?.strike).filter((x) => x != null) as number[];
            const isOpen = sel === t.symbol;
            return (
              <Fragment key={t.symbol}>
              <div className={`fb-card${isOpen ? " sel" : ""}`} onClick={() => setSel(isOpen ? null : t.symbol)}>
                <div style={{ position: "absolute", top: 12, right: 12 }}><CardSpark pts={chips.map((c) => c.v)} /></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "0.03em", color: "#cfe0ff" }}>{t.symbol}</span>
                  <span style={{ fontSize: 12.5, fontFamily: "var(--font-mono, monospace)", color: SPOT, background: "rgba(233,185,73,0.08)", border: `1px solid ${SPOT}44`, borderRadius: 5, padding: "3px 7px" }}>{fmtSpot(t.spot)}</span>
                </div>
                <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
                  {chips.map(({ d, v }) => (
                    <span key={d} style={{ flex: 1, textAlign: "center", fontSize: 12, fontFamily: "var(--font-mono, monospace)", padding: "6px 3px", borderRadius: 5, border: `1px solid ${HOME_THEME.border}` }}>
                      <span style={{ display: "block", color: DIM, fontSize: 10, marginBottom: 3 }}>{d}D</span>
                      <span style={{ color: v >= 0 ? GREEN : RED }}>{fmtSigned(v)}</span>
                    </span>
                  ))}
                </div>
                <div style={{ borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 8, fontSize: 11.5, color: HOME_THEME.text, lineHeight: 1.5 }}>
                  {cw.length > 1 && <div>calls <span style={{ color: GREEN, fontFamily: "var(--font-mono, monospace)" }}>{cw.map(fmtStrike).join(" → ")}</span></div>}
                  {pw.length > 1 && <div>puts <span style={{ color: RED, fontFamily: "var(--font-mono, monospace)" }}>{pw.map(fmtStrike).join(" → ")}</span></div>}
                  {cw.length <= 1 && pw.length <= 1 && <span style={{ color: DIM }}>walls forming…</span>}
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

        <div style={{ fontSize: 12, color: HOME_THEME.text, marginTop: 12, lineHeight: 1.6 }}>
          Each card is a ticker — spot, net GEX for the front <b>0/1/2-DTE</b> expiries, and where the call/put walls are
          migrating across the three days. Click a card to open its ladder: bars are net GEX per strike
          (<span style={{ color: GREEN }}>green</span> = support, <span style={{ color: RED }}>red</span> = resistance),
          the right numbers are the strike&rsquo;s net-$ and its <b>day-over-day Δ</b> vs the same expiry&rsquo;s prior
          session (<span style={{ color: GREEN }}>▲</span> building, <span style={{ color: RED }}>▼</span> leaving). A 2DTE
          strike that just entered the window shows &ldquo;—&rdquo; until it has a prior session to compare.
        </div>
      </Card>
    </>
  );
}
