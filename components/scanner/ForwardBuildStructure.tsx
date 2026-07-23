"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Forward Build — STRUCTURE view ("where is the GEX flow going?")
//
// Grouped by ticker (all collapsed by default). Expand a ticker to see its front
// 0DTE / 1DTE / 2DTE GEX wall structure side-by-side on a SHARED strike ladder,
// with each strike's day-over-day Δ (is gamma building here or leaving?). The
// collapsed row already carries the essentials — spot, net GEX per DTE, and
// call/put wall migration across the three days — so the whole roster is
// scannable without opening anything.
//
// Reads GET /proxy/forward-build-structure (getForwardBuildStructure in
// server-v2/strike-growth-recorder.js) — one query over rows the strike-growth
// sweep already wrote, grouped in Node. No live network call per request.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
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

// Adaptive $ formatting — SPX nets run to billions, single names to millions.
const fmtGex = (v: number): string => {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  return `${s}$${(a / 1e6).toFixed(0)}M`;
};
const fmtSigned = (v: number): string => (v >= 0 ? "+" : "") + fmtGex(v);
const fmtStrike = (v: number): string =>
  Number.isInteger(v) ? v.toLocaleString("en-US") : String(v);

const DTE_LABEL = (d: number) => (d === 0 ? "0DTE" : `${d}DTE`);
const dteColor = (d: number) =>
  d === 0 ? HOME_THEME.orange : d === 1 ? HOME_THEME.cyan : HOME_THEME.purple;

// One strike ladder cell for a single DTE column: a centred bar (call grows
// right, put grows left) + the day-over-day Δ chip.
function LadderCell({ row, maxAbs }: { row: StrikeRow | null; maxAbs: number }) {
  if (!row) {
    return (
      <div className="fb-cell">
        <div className="fb-bar" />
        <span className="fb-delta" style={{ color: HOME_THEME.border }}>·</span>
      </div>
    );
  }
  const w = maxAbs > 0 ? Math.max(3, (Math.abs(row.net) / maxAbs) * 47) : 0;
  const call = row.net >= 0;
  const barColor = call ? HOME_THEME.green : HOME_THEME.red;
  const fillStyle: CSSProperties = call
    ? { left: "50%", width: `${w}%`, background: `linear-gradient(90deg, ${barColor}, transparent)` }
    : { right: "50%", width: `${w}%`, background: `linear-gradient(270deg, ${barColor}, transparent)` };
  const d = row.delta;
  const dColor = d == null ? HOME_THEME.text : d > 0 ? HOME_THEME.green : d < 0 ? HOME_THEME.red : HOME_THEME.text;
  const arrow = d == null ? "—" : d > 0 ? "▲" : d < 0 ? "▼" : "—";
  return (
    <div className="fb-cell" title={`net ${fmtSigned(row.net)}${d != null ? ` · Δ ${fmtSigned(d)}` : ""}`}>
      <div className="fb-bar">
        <div className="fb-mid" />
        <div className="fb-fill" style={fillStyle} />
      </div>
      <span className="fb-delta" style={{ color: dColor }}>
        {d == null ? "—" : `${arrow} ${fmtGex(Math.abs(d))}`}
      </span>
    </div>
  );
}

function TickerBlock({ t }: { t: Ticker }) {
  const byDte = useMemo(() => {
    const m = new Map<number, Map<number, StrikeRow>>();
    for (const d of t.dtes) {
      const sm = new Map<number, StrikeRow>();
      d.strikes.forEach((s) => sm.set(s.strike, s));
      m.set(d.dte, sm);
    }
    return m;
  }, [t]);

  // Shared ladder = union of every strike across the 3 columns, high→low, with a
  // spot marker inserted so each column's rows line up (read migration vertically).
  const ladder = useMemo(() => {
    const set = new Set<number>();
    t.dtes.forEach((d) => d.strikes.forEach((s) => set.add(s.strike)));
    const strikes = [...set].sort((a, b) => b - a);
    const rows: Array<{ spot: true } | { strike: number }> = [];
    let placed = false;
    for (const k of strikes) {
      if (!placed && k < t.spot) { rows.push({ spot: true }); placed = true; }
      rows.push({ strike: k });
    }
    if (!placed) rows.push({ spot: true });
    return rows;
  }, [t]);

  const maxAbs = useMemo(() => {
    let m = 0;
    t.dtes.forEach((d) => d.strikes.forEach((s) => { if (Math.abs(s.net) > m) m = Math.abs(s.net); }));
    return m;
  }, [t]);

  const dtesShown = [0, 1, 2].filter((d) => byDte.has(d));
  const callMig = dtesShown.map((d) => t.dtes.find((x) => x.dte === d)?.callWall?.strike).filter((x) => x != null);
  const putMig = dtesShown.map((d) => t.dtes.find((x) => x.dte === d)?.putWall?.strike).filter((x) => x != null);

  return (
    <div className="fb-body">
      <div className="fb-cols" style={{ gridTemplateColumns: `repeat(${dtesShown.length}, 1fr)` }}>
        {dtesShown.map((d) => {
          const info = t.dtes.find((x) => x.dte === d)!;
          const col = byDte.get(d)!;
          return (
            <div key={d} className="fb-col">
              <div className="fb-chead">
                <span style={{ fontWeight: 800, fontSize: 12.5, color: dteColor(d) }}>{DTE_LABEL(d)}</span>
                <span style={{ color: HOME_THEME.border, fontSize: 11, fontFamily: "var(--fb-mono)" }}>{info.expiry.slice(5)}</span>
                <span
                  className="fb-netchip"
                  style={{ color: info.netTotal >= 0 ? HOME_THEME.green : HOME_THEME.red, marginLeft: "auto" }}
                >
                  {fmtSigned(info.netTotal)}
                </span>
              </div>
              <div className="fb-ladder">
                {ladder.map((r, i) =>
                  "spot" in r ? (
                    <div key={`s${i}`} className="fb-row fb-spotrow">
                      <span className="fb-strike">{fmtStrike(Math.round(t.spot))}</span>
                      <div className="fb-bar"><div className="fb-mid" /></div>
                      <span className="fb-delta" style={{ color: HOME_THEME.orange }}>spot</span>
                    </div>
                  ) : (
                    <div key={r.strike} className="fb-row">
                      <span className="fb-strike">{fmtStrike(r.strike)}</span>
                      <LadderCell row={col.get(r.strike) ?? null} maxAbs={maxAbs} />
                    </div>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="fb-foot">
        {callMig.length > 1 && (
          <span><b style={{ color: HOME_THEME.text }}>Call wall:</b>{" "}
            <span style={{ color: HOME_THEME.green, fontFamily: "var(--fb-mono)" }}>{callMig.map(fmtStrike).join(" → ")}</span></span>
        )}
        {putMig.length > 1 && (
          <span><b style={{ color: HOME_THEME.text }}>Put wall:</b>{" "}
            <span style={{ color: HOME_THEME.red, fontFamily: "var(--fb-mono)" }}>{putMig.map(fmtStrike).join(" → ")}</span></span>
        )}
      </div>
    </div>
  );
}

export default function ForwardBuildStructure() {
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [asOf, setAsOf] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = () => {
    setLoading(true); setErr(null);
    fetch("/proxy/forward-build-structure?limit=400", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "load failed");
        const rows: Ticker[] = Array.isArray(j.tickers) ? j.tickers : [];
        setTickers(rows);
        setAsOf(j.asOf || "");
        // Expand the first ticker so the layout is visible on load.
        setOpen(new Set(rows.length ? [rows[0].symbol] : []));
      })
      .catch((e) => setErr(String((e as Error)?.message || e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const view = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return needle ? tickers.filter((t) => t.symbol.includes(needle)) : tickers;
  }, [tickers, q]);

  const toggle = (sym: string) =>
    setOpen((prev) => { const n = new Set(prev); n.has(sym) ? n.delete(sym) : n.add(sym); return n; });
  const expandAll = () => setOpen(new Set(view.map((t) => t.symbol)));
  const collapseAll = () => setOpen(new Set());

  const inputStyle: CSSProperties = {
    minWidth: 160, padding: "7px 10px", borderRadius: 8, fontSize: 13,
    border: `1px solid ${HOME_THEME.border}`, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text,
  };

  return (
    <>
      <style>{`
        .fb-scope{ --fb-mono: ui-monospace, 'SF Mono', Menlo, monospace; }
        .fb-tk{ background:${HOME_THEME.panel}; border:1px solid ${HOME_THEME.border};
          border-radius:11px; margin-bottom:9px; overflow:hidden; }
        .fb-head{ display:grid; grid-template-columns:20px 74px 92px 1fr auto; align-items:center;
          gap:14px; padding:11px 15px; cursor:pointer; user-select:none; }
        .fb-head:hover{ background:rgba(255,255,255,0.03); }
        .fb-caret{ color:${HOME_THEME.border}; font-size:11px; transition:transform .15s; justify-self:center; }
        .fb-tk.open .fb-caret{ transform:rotate(90deg); }
        .fb-sym{ font-size:15px; font-weight:800; letter-spacing:.03em; color:${HOME_THEME.cyan}; }
        .fb-spot{ font:11.5px/1 var(--fb-mono); color:${HOME_THEME.orange};
          background:rgba(255,170,40,0.08); border:1px solid rgba(255,170,40,0.25);
          border-radius:6px; padding:5px 8px; justify-self:start; }
        .fb-nets{ display:flex; gap:7px; }
        .fb-mini{ font:11px/1 var(--fb-mono); padding:4px 7px; border-radius:5px; white-space:nowrap;
          border:1px solid ${HOME_THEME.border}; }
        .fb-mini .l{ color:${HOME_THEME.border}; margin-right:4px; }
        .fb-mig{ color:${HOME_THEME.text}; font-size:11px; justify-self:end; text-align:right; font-family:var(--fb-mono); }
        .fb-body{ display:none; border-top:1px solid ${HOME_THEME.border}; }
        .fb-tk.open .fb-body{ display:block; }
        .fb-cols{ display:grid; gap:1px; background:${HOME_THEME.border}; }
        .fb-col{ background:${HOME_THEME.panel}; padding:12px 14px 14px; }
        .fb-chead{ display:flex; align-items:baseline; gap:8px; margin-bottom:9px; }
        .fb-netchip{ font:11px/1 var(--fb-mono); }
        .fb-ladder{ display:flex; flex-direction:column; gap:3px; }
        .fb-row{ display:grid; grid-template-columns:54px 1fr; align-items:center; gap:8px; height:24px; }
        .fb-spotrow{ background:rgba(255,170,40,0.06); border-radius:5px; }
        .fb-strike{ font:12px/1 var(--fb-mono); color:${HOME_THEME.text}; text-align:right; }
        .fb-spotrow .fb-strike{ color:${HOME_THEME.orange}; font-weight:800; }
        .fb-cell{ display:grid; grid-template-columns:1fr 58px; align-items:center; gap:6px; }
        .fb-bar{ position:relative; height:15px; }
        .fb-fill{ position:absolute; top:2px; bottom:2px; border-radius:3px; }
        .fb-mid{ position:absolute; left:50%; top:-4px; bottom:-4px; width:1px; background:${HOME_THEME.border}; }
        .fb-delta{ font:11px/1 var(--fb-mono); text-align:left; }
        .fb-foot{ display:flex; gap:16px; flex-wrap:wrap; padding:9px 15px;
          border-top:1px solid ${HOME_THEME.border}; font-size:11.5px; color:${HOME_THEME.text}; }
        .scanner-mobile .fb-head{ grid-template-columns:18px 1fr auto; }
        .scanner-mobile .fb-spot, .scanner-mobile .fb-mig{ display:none; }
      `}</style>

      <div className="fb-scope">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          <div style={{ fontSize: 14, color: HOME_THEME.text }}>
            {loading ? "Loading forward build…"
              : asOf ? `0/1/2-DTE GEX structure by ticker · as of ${asOf} · ${tickers.length} tickers`
              : "No structure yet (needs live dxLink data + a session or two of history)."}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter ticker…" style={inputStyle} />
          <button onClick={expandAll} style={homeButtonStyle}>Expand all</button>
          <button onClick={collapseAll} style={homeButtonStyle}>Collapse all</button>
          <button onClick={load} style={homeButtonStyle}>Refresh</button>
        </div>
        {err && <div style={{ fontSize: 14, color: HOME_THEME.red, marginBottom: 8 }}>Error: {err}</div>}

        <Card variant="budget" accent={HOME_THEME.orange} title="Forward Build — GEX structure & day-over-day flow">
          {view.map((t) => {
            const isOpen = open.has(t.symbol);
            const net = (d: number) => t.dtes.find((x) => x.dte === d)?.netTotal;
            const chip = (d: number) => {
              const v = net(d);
              if (v == null) return null;
              return (
                <span key={d} className="fb-mini" style={{ color: v >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                  <span className="l">{d}d</span>{fmtSigned(v)}
                </span>
              );
            };
            const cw = [0, 1, 2].map((d) => t.dtes.find((x) => x.dte === d)?.callWall?.strike).filter((x) => x != null);
            const pw = [0, 1, 2].map((d) => t.dtes.find((x) => x.dte === d)?.putWall?.strike).filter((x) => x != null);
            return (
              <div key={t.symbol} className={`fb-tk${isOpen ? " open" : ""}`}>
                <div className="fb-head" onClick={() => toggle(t.symbol)}>
                  <span className="fb-caret">▶</span>
                  <span className="fb-sym">{t.symbol}</span>
                  <span className="fb-spot">{fmtStrike(t.spot >= 100 ? Math.round(t.spot) : Number(t.spot.toFixed(2)))}</span>
                  <span className="fb-nets">{[0, 1, 2].map(chip)}</span>
                  <span className="fb-mig">
                    {cw.length > 1 && <>calls {cw.map(fmtStrike).join("→")}</>}
                    {cw.length > 1 && pw.length > 1 && <span style={{ color: HOME_THEME.border }}> · </span>}
                    {pw.length > 1 && <>puts {pw.map(fmtStrike).join("→")}</>}
                  </span>
                </div>
                {isOpen && <TickerBlock t={t} />}
              </div>
            );
          })}
          {!loading && !view.length && (
            <div style={{ textAlign: "center", color: HOME_THEME.text, padding: 24 }}>No tickers to show.</div>
          )}
          <div style={{ fontSize: 12, color: HOME_THEME.text, marginTop: 10, lineHeight: 1.6 }}>
            Each ticker shows its front <b>0/1/2-DTE</b> GEX walls on a shared strike ladder (spot in the middle).
            Bars: <span style={{ color: HOME_THEME.green }}>green</span> = positive GEX (support),{" "}
            <span style={{ color: HOME_THEME.red }}>red</span> = negative (resistance). The Δ next to each strike is its
            net-GEX change vs the <b>same expiry&rsquo;s prior session</b> — <span style={{ color: HOME_THEME.green }}>▲</span> gamma
            building here, <span style={{ color: HOME_THEME.red }}>▼</span> leaving. A 2DTE strike that just entered the window
            shows &ldquo;—&rdquo; until it has a prior session to compare. The collapsed row&rsquo;s wall-migration line (e.g.
            calls 6400→6410→6425) is where the walls are drifting across the three days — often where price is headed next.
          </div>
        </Card>
      </div>
    </>
  );
}
