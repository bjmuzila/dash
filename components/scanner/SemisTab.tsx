"use client";

/**
 * SemisTab — Semiconductor Strength Index (SSI).
 *
 * One 0–100 read on how strong semis are right now, on two baselines:
 *   • vs RTH Open   — the cash-session move (09:30 ET → now). The read that
 *                     shows semis are hot intraday even after an overnight gap.
 *   • vs Prior Close— the full move including the overnight session.
 * Plus the reads that keep it honest: breadth (broad or just NVDA), relative
 * strength vs SPX/NQ, and SOXL 3× confirmation. Data: /api/semi-strength →
 * ThetaData stock snapshots. Auto-refreshes 30s.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";

const UP = "#1FD98A";
const DOWN = HOME_THEME.red;

type NameRow = {
  symbol: string;
  weight: number;
  price: number | null;
  baseline: number | null;
  pct: number | null;
  contribution: number | null;
  up: boolean | null;
};

type View = {
  available: boolean;
  ssi: number;
  ssiLabel: string;
  compositePct: number;
  breadthUp: number;
  breadthTotal: number;
  breadthPct: number | null;
  divergence: "narrow-up" | "narrow-down" | "aligned";
  smhPct: number | null;
  soxlPct: number | null;
  spyPct: number | null;
  qqqPct: number | null;
  rsSpx: number | null;
  rsNq: number | null;
  soxlConfirm: { expected: number; actual: number; ratio: number | null; status: string } | null;
  names: NameRow[];
};

type Ssi = {
  source: string;
  updatedAt: string;
  rthOpenAvailable: boolean;
  prevClose: View;
  rthOpen: View;
};

type Basis = "rthOpen" | "prevClose";

const ssiColor = (label: string) =>
  label === "STRONG" ? UP :
  label === "FIRM" ? HOME_THEME.green :
  label === "NEUTRAL" ? "rgba(255,255,255,0.7)" :
  label === "SOFT" ? HOME_THEME.orange :
  DOWN;

const signColor = (n: number | null) => (n == null ? "rgba(255,255,255,0.4)" : n > 0 ? UP : n < 0 ? DOWN : "rgba(255,255,255,0.6)");
const fmtPct = (n: number | null, d = 2) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`);
const fmtNum = (n: number | null) => (n == null ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const th: React.CSSProperties = { padding: "6px 10px", textAlign: "right", fontWeight: 700, letterSpacing: "0.05em", color: "rgba(255,255,255,0.55)", fontSize: 12, textTransform: "uppercase" };
const td: React.CSSProperties = { padding: "7px 10px", textAlign: "right", color: HOME_THEME.text, fontVariantNumeric: "tabular-nums" };

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ flex: "1 1 150px", padding: "12px 16px", borderRadius: 14, background: "rgba(13,17,25,0.35)", border: `1px solid ${HOME_THEME.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: color ?? HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, marginTop: 2, color: "rgba(255,255,255,0.55)" }}>{sub}</div>}
    </div>
  );
}

export default function SemisTab() {
  const [data, setData] = useState<Ssi | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [basis, setBasis] = useState<Basis>("rthOpen");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/semi-strength", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setErr(null);
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 30_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  // RTH-open basis falls back to prior-close before the cash session opens.
  const effBasis: Basis = basis === "rthOpen" && !data?.rthOpenAvailable ? "prevClose" : basis;
  const view = data ? data[effBasis] : null;
  const baseLabel = effBasis === "rthOpen" ? "RTH Open" : "Prev Close";

  const maxContrib = view ? Math.max(0.01, ...view.names.map((n) => Math.abs(n.contribution ?? 0))) : 1;

  const divNote =
    view?.divergence === "narrow-up" ? `Narrow — index up vs ${baseLabel.toLowerCase()} but under half the names are green (few carrying it).` :
    view?.divergence === "narrow-down" ? `Narrow — index down vs ${baseLabel.toLowerCase()} while most names are green (heavyweight drag).` :
    "Broad — breadth agrees with the index move.";

  const segBtn = (b: Basis, label: string, disabled?: boolean): React.CSSProperties => ({
    padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
    border: `1px solid ${effBasis === b ? HOME_THEME.cyan : "rgba(255,255,255,0.15)"}`,
    background: effBasis === b ? "rgba(33,158,188,0.15)" : "transparent",
    color: disabled ? "rgba(255,255,255,0.3)" : effBasis === b ? HOME_THEME.text : "rgba(255,255,255,0.65)",
    opacity: disabled ? 0.6 : 1,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: HOME_THEME.text }}>
              Semiconductor Strength Index
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", marginTop: 4 }}>
              SMH-weighted composite of the top 10 holdings vs {baseLabel.toLowerCase()} · ThetaData
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {data && (
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                {new Date(data.updatedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" })} ET
              </span>
            )}
            <button onClick={load} disabled={loading}
              style={{ padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: loading ? "default" : "pointer",
                border: `1px solid ${HOME_THEME.cyan}`, background: "rgba(33,158,188,0.12)", color: HOME_THEME.cyan, opacity: loading ? 0.5 : 1 }}>
              {loading ? "…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Basis toggle */}
        <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
          <button style={segBtn("rthOpen", "vs RTH Open", !data?.rthOpenAvailable)}
            onClick={() => data?.rthOpenAvailable && setBasis("rthOpen")}
            disabled={!data?.rthOpenAvailable}>vs RTH Open</button>
          <button style={segBtn("prevClose", "vs Prior Close")} onClick={() => setBasis("prevClose")}>vs Prior Close</button>
          {data && !data.rthOpenAvailable && (
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>RTH open pending — showing prior close until 9:30 ET.</span>
          )}
        </div>

        {err && <div style={{ marginTop: 14, color: DOWN, fontSize: 13 }}>Failed to load: {err}</div>}

        {view && (
          <>
            {/* Hero: big SSI + the composite move */}
            <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap", marginTop: 20, marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span style={{ fontSize: 64, fontWeight: 900, lineHeight: 1, color: ssiColor(view.ssiLabel), fontVariantNumeric: "tabular-nums" }}>
                  {view.ssi.toFixed(0)}
                </span>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "0.06em", color: ssiColor(view.ssiLabel) }}>{view.ssiLabel}</div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>0–100 · 50 = flat · vs {baseLabel.toLowerCase()}</div>
                </div>
              </div>
              <div style={{ fontSize: 15 }}>
                <span style={{ color: "rgba(255,255,255,0.55)" }}>Composite move </span>
                <span style={{ color: signColor(view.compositePct), fontWeight: 800 }}>{fmtPct(view.compositePct)}</span>
              </div>
            </div>

            {/* Sub-reads */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Tile label="Breadth" value={`${view.breadthUp}/${view.breadthTotal}`} sub={view.breadthPct == null ? `green vs ${baseLabel.toLowerCase()}` : `${view.breadthPct}% green`}
                color={view.breadthPct == null ? undefined : view.breadthPct >= 50 ? UP : DOWN} />
              <Tile label="RS vs SPX" value={fmtPct(view.rsSpx)} sub="SMH − SPY" color={signColor(view.rsSpx)} />
              <Tile label="RS vs NQ" value={fmtPct(view.rsNq)} sub="SMH − QQQ" color={signColor(view.rsNq)} />
              <Tile label="SOXL confirm"
                value={view.soxlConfirm?.ratio == null ? "—" : `${(view.soxlConfirm.ratio * 100).toFixed(0)}%`}
                sub={view.soxlConfirm ? `${view.soxlConfirm.status} · ${fmtPct(view.soxlPct)} vs ${fmtPct(view.soxlConfirm.expected)} exp` : "3× SMH"}
                color={view.soxlConfirm?.status === "confirming" ? UP : view.soxlConfirm?.status === "lagging" ? DOWN : HOME_THEME.orange} />
            </div>

            <div style={{ marginTop: 12, fontSize: 12.5, color: "rgba(255,255,255,0.55)" }}>{divNote}</div>
          </>
        )}
      </Card>

      {view && (
        <Card title={`Top 10 Holdings — contribution to the move (vs ${baseLabel})`} variant="classic">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${HOME_THEME.border}` }}>
                  <th style={{ ...th, textAlign: "left" }}>Symbol</th>
                  <th style={th}>SMH Wt</th>
                  <th style={th}>Last</th>
                  <th style={th}>% vs {effBasis === "rthOpen" ? "Open" : "Prev"}</th>
                  <th style={{ ...th, textAlign: "left", paddingLeft: 24 }}>Contribution</th>
                </tr>
              </thead>
              <tbody>
                {view.names.map((n) => {
                  const c = n.contribution ?? 0;
                  const w = Math.min(100, (Math.abs(c) / maxContrib) * 100);
                  return (
                    <tr key={n.symbol} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ ...td, textAlign: "left", fontWeight: 800 }}>{n.symbol}</td>
                      <td style={{ ...td, color: "rgba(255,255,255,0.6)" }}>{n.weight.toFixed(2)}%</td>
                      <td style={td}>{fmtNum(n.price)}</td>
                      <td style={{ ...td, color: signColor(n.pct), fontWeight: 700 }}>{fmtPct(n.pct)}</td>
                      <td style={{ ...td, textAlign: "left", paddingLeft: 24 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ position: "relative", flex: 1, height: 8, minWidth: 80 }}>
                            <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.15)" }} />
                            <div style={{ position: "absolute", top: 0, bottom: 0, height: 8, borderRadius: 3,
                              background: c >= 0 ? UP : DOWN,
                              left: c >= 0 ? "50%" : `calc(50% - ${w / 2}%)`,
                              width: `${w / 2}%` }} />
                          </div>
                          <span style={{ minWidth: 52, textAlign: "right", color: signColor(n.contribution), fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
                            {n.contribution == null ? "—" : `${c >= 0 ? "+" : ""}${c.toFixed(2)}`}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
            Contribution = renormalised SMH weight × % move vs {baseLabel.toLowerCase()} — the points each name adds to (or subtracts from) the composite.
            SSI squashes the composite through tanh (±1.5% ≈ 88/12). Breadth is equal-weight so a lone mega-cap can&apos;t fake a broad move.
            RTH-open basis = today&apos;s 09:30 ET open (strips the overnight gap); prior-close basis includes it.
            Source: ThetaData stock snapshots via <span style={{ color: LIGHT_BLUE }}>/api/semi-strength</span>.
          </div>
        </Card>
      )}
    </div>
  );
}
