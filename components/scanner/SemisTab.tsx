"use client";

/**
 * SemisTab — Semiconductor Strength Index (SSI).
 *
 * One 0–100 read on how strong semis are right now, plus the reads that keep it
 * honest: breadth (is it broad or just NVDA), relative strength vs SPX/NQ
 * (are semis leading), and SOXL confirmation (is the 3× ETF pulling its weight).
 * Data: /api/semi-strength → ThetaData stock snapshots. Auto-refreshes 30s.
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
  prevClose: number | null;
  pct: number | null;
  contribution: number | null;
  up: boolean | null;
};

type Ssi = {
  source: string;
  updatedAt: string;
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

  const maxContrib = data ? Math.max(0.01, ...data.names.map((n) => Math.abs(n.contribution ?? 0))) : 1;

  const divNote =
    data?.divergence === "narrow-up" ? "Narrow — index up but under half the names are green (few carrying it)." :
    data?.divergence === "narrow-down" ? "Narrow — index down while most names are green (heavyweight drag)." :
    "Broad — breadth agrees with the index move.";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: HOME_THEME.text }}>
              Semiconductor Strength Index
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", marginTop: 4 }}>
              SMH-weighted composite of the top 10 holdings vs prior close · ThetaData
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

        {err && <div style={{ marginTop: 14, color: DOWN, fontSize: 13 }}>Failed to load: {err}</div>}

        {data && (
          <>
            {/* Hero: big SSI + the composite move */}
            <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap", marginTop: 20, marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span style={{ fontSize: 64, fontWeight: 900, lineHeight: 1, color: ssiColor(data.ssiLabel), fontVariantNumeric: "tabular-nums" }}>
                  {data.ssi.toFixed(0)}
                </span>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "0.06em", color: ssiColor(data.ssiLabel) }}>{data.ssiLabel}</div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>0–100 · 50 = flat</div>
                </div>
              </div>
              <div style={{ fontSize: 15 }}>
                <span style={{ color: "rgba(255,255,255,0.55)" }}>Composite move </span>
                <span style={{ color: signColor(data.compositePct), fontWeight: 800 }}>{fmtPct(data.compositePct)}</span>
              </div>
            </div>

            {/* Sub-reads */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Tile label="Breadth" value={`${data.breadthUp}/${data.breadthTotal}`} sub={data.breadthPct == null ? "green vs prior close" : `${data.breadthPct}% green`}
                color={data.breadthPct == null ? undefined : data.breadthPct >= 50 ? UP : DOWN} />
              <Tile label="RS vs SPX" value={fmtPct(data.rsSpx)} sub="SMH − SPY" color={signColor(data.rsSpx)} />
              <Tile label="RS vs NQ" value={fmtPct(data.rsNq)} sub="SMH − QQQ" color={signColor(data.rsNq)} />
              <Tile label="SOXL confirm"
                value={data.soxlConfirm?.ratio == null ? "—" : `${(data.soxlConfirm.ratio * 100).toFixed(0)}%`}
                sub={data.soxlConfirm ? `${data.soxlConfirm.status} · ${fmtPct(data.soxlPct)} vs ${fmtPct(data.soxlConfirm.expected)} exp` : "3× SMH"}
                color={data.soxlConfirm?.status === "confirming" ? UP : data.soxlConfirm?.status === "lagging" ? DOWN : HOME_THEME.orange} />
            </div>

            <div style={{ marginTop: 12, fontSize: 12.5, color: "rgba(255,255,255,0.55)" }}>{divNote}</div>
          </>
        )}
      </Card>

      {data && (
        <Card title="Top 10 Holdings — contribution to the move" variant="classic">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${HOME_THEME.border}` }}>
                  <th style={{ ...th, textAlign: "left" }}>Symbol</th>
                  <th style={th}>SMH Wt</th>
                  <th style={th}>Last</th>
                  <th style={th}>% vs Prev</th>
                  <th style={{ ...th, textAlign: "left", paddingLeft: 24 }}>Contribution</th>
                </tr>
              </thead>
              <tbody>
                {data.names.map((n) => {
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
            Contribution = renormalised SMH weight × % move vs prior close — the points each name adds to (or subtracts from) the composite.
            SSI squashes the composite through tanh (±1.5% ≈ 88/12). Breadth is equal-weight so a lone mega-cap can't fake a broad move.
            Source: ThetaData stock snapshots via <span style={{ color: LIGHT_BLUE }}>/api/semi-strength</span>.
          </div>
        </Card>
      )}
    </div>
  );
}
