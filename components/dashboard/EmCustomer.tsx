"use client";

import { useCallback, useEffect, useState } from "react";

interface TickerEmStats {
  recentAvg: number | null;
  midAvg: number | null;
  sampleSize: number;
}

interface Levels {
  ticker: string;
  label?: string | null;
  close?: string | null;
  em?: string | null;
  up?: string | null;
  down?: string | null;
  buy_near?: string | null;
  buy_far?: string | null;
  sell_near?: string | null;
  sell_far?: string | null;
  pivot?: string | null;
  exp_label?: string | null;
  updated_at?: string | null;
}

const POPULAR = ["SPX", "NDX", "ESU", "NQU", "SPY", "QQQ", "AAPL", "NVDA", "TSLA", "MSFT"];

function val(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "--";
  return v;
}

function fmtUpdated(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** On-demand Buy/Sell zones for any ticker (static for the week, server-cached). */
async function fetchZones(sym: string): Promise<Partial<Levels> | null> {
  try {
    const r = await fetch(`/api/em-zones?ticker=${encodeURIComponent(sym)}`, { cache: "no-store" });
    if (!r.ok) return null;
    const z = (await r.json()) as Partial<Levels> | { error?: string } | null;
    if (!z || (z as { error?: string }).error) return null;
    return z as Partial<Levels>;
  } catch {
    return null;
  }
}

export default function EmCustomer() {
  const [input, setInput] = useState("");
  const [ticker, setTicker] = useState("");
  // Holds either a full published Levels row or a zones-only Partial<Levels>
  // (the on-demand /api/em-zones fallback for not-yet-published tickers).
  const [data, setData] = useState<Partial<Levels> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emStats, setEmStats] = useState<TickerEmStats | null>(null);
  const [confidenceScore, setConfidenceScore] = useState<number | null>(null);
  const [winRate, setWinRate] = useState<{ hits: number; evaluated: number; hit_rate: number } | null>(null);

  const lookup = useCallback(async (raw: string) => {
    const sym = raw.trim().toUpperCase();
    if (!sym) return;
    setTicker(sym);
    setLoading(true);
    setError("");
    setData(null);
    setEmStats(null);
    setConfidenceScore(null);
    setWinRate(null);
    try {
      const r = await fetch(`/api/levels?ticker=${encodeURIComponent(sym)}`, { cache: "no-store" });
      if (!r.ok) throw new Error("Lookup failed");
      const json = (await r.json()) as Levels | null;
      if (!json) {
        // No published row at all — still try on-demand zones (static for the
        // week). EM only exists if the weekly publisher computed it, so a brand
        // new ticker shows zones now and EM after the next weekend run.
        const zones = await fetchZones(sym);
        if (zones) setData(zones);
        else setError(`No levels published for ${sym} yet.`);
      } else {
        setData(json);
        // Fill in zones on demand when the published row has EM but no zones
        // (the long-tail names aren't pre-published with zones).
        const hasZones = json.buy_near || json.sell_near || json.pivot;
        if (!hasZones) {
          const zones = await fetchZones(sym);
          if (zones) setData((prev) => (prev ? { ...prev, ...zones } : zones));
        }
      }
      // Fetch EM history stats, confidence, and win/loss record in parallel
      const [statsRes, confRes, trackerRes] = await Promise.allSettled([
        fetch(`/api/em/ticker-em-stats?ticker=${encodeURIComponent(sym)}`).then((r) => r.ok ? r.json() : null),
        fetch("/api/confidence").then((r) => r.ok ? r.json() : null),
        Promise.all([
          fetch("/api/em-tracker").then((r) => r.ok ? r.json() : null),
          fetch("/api/em-tracker/history").then((r) => r.ok ? r.json() : null),
        ]).then(([live, hist]) => live ? { summary: live.summary, history: hist } : null),
      ]);
      if (statsRes.status === "fulfilled" && statsRes.value) {
        setEmStats({ recentAvg: statsRes.value.recentAvg ?? null, midAvg: statsRes.value.midAvg ?? null, sampleSize: statsRes.value.sampleSize ?? 0 });
      }
      if (confRes.status === "fulfilled" && confRes.value) {
        const s = confRes.value?.score?.score ?? confRes.value?.score ?? null;
        if (s != null && Number.isFinite(Number(s))) setConfidenceScore(Math.round(Number(s)));
      }
      if (trackerRes.status === "fulfilled" && trackerRes.value) {
        const { summary: liveSummary, history: histData } = trackerRes.value as {
          summary: Array<{ ticker: string; hits: number; evaluated: number }>;
          history: { tallies: Record<string, { hits: number; total: number }> };
        };
        // Tracker uses ESM/NQM internally but displays as ESU/NQU; also check both
        const aliases: Record<string, string[]> = { ESU: ["ESU", "ESM"], NQU: ["NQU", "NQM"] };
        const candidates = aliases[sym] ?? [sym];
        const liveRow = (liveSummary || []).find((r) => candidates.includes(r.ticker));
        const histTicker = candidates.find((c) => histData?.tallies?.[c]);
        const hist = histTicker ? histData.tallies[histTicker] : null;
        const liveHits = liveRow?.hits ?? 0;
        const liveEval = liveRow?.evaluated ?? 0;
        const histHits = hist?.hits ?? 0;
        const histTotal = hist?.total ?? 0;
        const totalHits = histHits + liveHits;
        const totalEval = histTotal + liveEval;
        if (totalEval > 0) {
          setWinRate({ hits: totalHits, evaluated: totalEval, hit_rate: totalHits / totalEval });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, []);

  // Allow deep-linking via ?ticker=SPX
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("ticker");
    if (t) {
      setInput(t.toUpperCase());
      lookup(t);
    }
  }, [lookup]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    lookup(input);
  };

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={S.header}>
          <div style={S.kicker}>CB Edge</div>
          <h1 style={S.title}>Weekly Estimated Move & Zones</h1>
          <p style={S.sub}>
            Enter a ticker to see this week&apos;s estimated move and the buy / sell zones.
          </p>
        </div>

        <form onSubmit={onSubmit} style={S.form}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter ticker  (e.g. SPX, NDX, AAPL)"
            spellCheck={false}
            autoCapitalize="characters"
            style={S.input}
          />
          <button type="submit" disabled={loading || !input.trim()} style={S.btn(loading || !input.trim())}>
            {loading ? "Loading…" : "Get Levels"}
          </button>
        </form>

        <div style={S.chips}>
          {POPULAR.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setInput(s);
                lookup(s);
              }}
              style={S.chip(ticker === s)}
            >
              {s}
            </button>
          ))}
        </div>

        {error && <div style={S.error}>{error}</div>}

        {data && !loading && (
          <>
            <div style={S.resultHead}>
              <span style={S.resultTicker}>{data.label || data.ticker}</span>
              {data.exp_label && <span style={S.resultExp}>Week of {data.exp_label}</span>}
              {data.updated_at && <span style={S.resultUpdated}>Updated {fmtUpdated(data.updated_at)}</span>}
            </div>

            {/* Estimated Move */}
            <section style={S.card}>
              <div style={S.cardTitle}>Estimated Move</div>
              <div style={S.emGrid}>
                <Stat label="Close" value={val(data.close)} color="#cbd5e1" />
                <Stat label="EM" value={val(data.em)} color="#e8c060" />
                <Stat label="Up" value={val(data.up)} color="#00e676" />
                <Stat label="Down" value={val(data.down)} color="#ff5a6a" />
              </div>
              {(confidenceScore != null || winRate != null) && (
                <div style={{ display: "grid", gridTemplateColumns: winRate != null && confidenceScore != null ? "1fr 1fr" : "1fr", gap: 10, marginTop: 10 }}>
                  {confidenceScore != null && (
                    <div style={{ ...S.avgStat, border: `1px solid ${confidenceScore >= 70 ? "rgba(0,230,118,.3)" : confidenceScore >= 45 ? "rgba(255,193,7,.3)" : "rgba(255,71,87,.3)"}` }}>
                      <div style={S.statLabel}>MVC Confidence</div>
                      <div style={{ ...S.statValue, fontSize: 20, color: confidenceScore >= 70 ? "#00e676" : confidenceScore >= 45 ? "#ffc107" : "#ff4757" }}>
                        {confidenceScore}%
                      </div>
                    </div>
                  )}
                  {winRate != null && (() => {
                    const winPct = Math.round(winRate.hit_rate * 100);
                    const lossPct = 100 - winPct;
                    const losses = winRate.evaluated - winRate.hits;
                    return (
                      <div style={{ ...S.avgStat, border: "1px solid rgba(255,255,255,.1)", padding: "12px 12px 10px" }}>
                        <div style={S.statLabel}>EM Hit Rate</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: winPct >= 65 ? "#00e676" : winPct >= 50 ? "#ffc107" : "#ff4757", marginBottom: 8 }}>
                          {winPct}% Hit
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#eef7ff", marginBottom: 4 }}>
                          <span>Miss ({losses})</span>
                          <span>{winPct}%</span>
                          <span>Hit ({winRate.hits})</span>
                        </div>
                        <div style={{ height: 4, background: "rgba(255,255,255,.1)", borderRadius: 999, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${winPct}%`, background: "linear-gradient(90deg,#ff4757,#ff4757,#00e676)", transition: "width .4s" }} />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </section>

            {/* Zones */}
            <div style={S.zoneRow}>
              <section style={{ ...S.card, ...S.zoneCard, borderColor: "#15402a" }}>
                <div style={{ ...S.cardTitle, color: "#00e676" }}>Buy Zone</div>
                <p style={S.zoneHint}>Support area — bias long while price holds above.</p>
                <ZoneLine label="Near" value={val(data.buy_near)} color="#00e676" />
                <ZoneLine label="Far" value={val(data.buy_far)} color="#00e676" dim />
              </section>

              <section style={{ ...S.card, ...S.zoneCard, borderColor: "#42171c" }}>
                <div style={{ ...S.cardTitle, color: "#ff5a6a" }}>Sell Zone</div>
                <p style={S.zoneHint}>Resistance area — bias short while price stays below.</p>
                <ZoneLine label="Near" value={val(data.sell_near)} color="#ff5a6a" />
                <ZoneLine label="Far" value={val(data.sell_far)} color="#ff5a6a" dim />
              </section>
            </div>

            {/* EM vs Historical Averages */}
            {emStats && (emStats.recentAvg != null || emStats.midAvg != null) && (() => {
              const emVal = data.em ? parseFloat(data.em.replace(/,/g, "")) : null;
              const renderAvg = (avg: number | null, label: string) => {
                if (!avg || !emVal || !Number.isFinite(avg) || !Number.isFinite(emVal)) {
                  return (
                    <div style={S.avgStat}>
                      <div style={S.statLabel}>{label}</div>
                      <div style={{ ...S.statValue, color: "#eef7ff", fontSize: 14 }}>--</div>
                    </div>
                  );
                }
                const diff = emVal - avg;
                const pct = (diff / avg) * 100;
                const isHigher = diff > 0;
                return (
                  <div style={S.avgStat}>
                    <div style={S.statLabel}>{label} ({avg.toLocaleString("en-US", { maximumFractionDigits: 2 })})</div>
                    <div style={{ ...S.statValue, color: isHigher ? "#00e676" : "#ff5a6a", fontSize: 18 }}>
                      {isHigher ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
                    </div>
                  </div>
                );
              };
              return (
                <section style={{ ...S.card, marginBottom: 14 }}>
                  <div style={S.cardTitle}>vs Historical EM Average</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {renderAvg(emStats.recentAvg, "vs 4-Wk Avg")}
                    {renderAvg(emStats.midAvg, "vs 12-Wk Avg")}
                  </div>
                  {emStats.sampleSize > 0 && (
                    <div style={{ fontSize: 10, color: "#eef7ff", marginTop: 10, letterSpacing: ".08em", textTransform: "uppercase" as const }}>
                      Based on {emStats.sampleSize} week{emStats.sampleSize !== 1 ? "s" : ""} of recorded data
                    </div>
                  )}
                </section>
              );
            })()}

            <p style={S.disclaimer}>
              Levels are published weekly and are informational only — not financial advice.
            </p>
          </>
        )}

        {!data && !error && !loading && (
          <div style={S.empty}>Enter a ticker above to view its weekly levels.</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={S.stat}>
      <div style={S.statLabel}>{label}</div>
      <div style={{ ...S.statValue, color }}>{value}</div>
    </div>
  );
}

function ZoneLine({ label, value, color, dim }: { label: string; value: string; color: string; dim?: boolean }) {
  return (
    <div style={S.zoneLine}>
      <span style={S.zoneLineLabel}>{label}</span>
      <span style={{ ...S.zoneLineVal, color, opacity: dim ? 0.7 : 1 }}>{value}</span>
    </div>
  );
}

const mono = "Consolas, Monaco, 'Courier New', monospace";

const S = {
  page: {
    flex: 1,
    overflow: "auto",
    background: "#080c14",
    height: "100%",
    padding: "32px 20px 60px",
    boxSizing: "border-box" as const,
  },
  wrap: { width: "100%", maxWidth: 720, margin: "0 auto" },
  header: { textAlign: "center" as const, marginBottom: 22 },
  kicker: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: ".26em",
    textTransform: "uppercase" as const,
    color: "#00e5ff",
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: 800,
    color: "#eef7ff",
    margin: 0,
    letterSpacing: ".01em",
  },
  sub: { fontSize: 14, color: "#eef7ff", marginTop: 8 },
  form: { display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" as const },
  input: {
    flex: 1,
    minWidth: 200,
    background: "#04070c",
    border: "1px solid #1e3a5f",
    color: "#eef7ff",
    fontSize: 16,
    padding: "12px 14px",
    borderRadius: 8,
    outline: "none",
    textTransform: "uppercase" as const,
    letterSpacing: ".04em",
  },
  btn: (disabled: boolean) => ({
    background: disabled ? "#0a1628" : "#0d2b46",
    border: `1px solid ${disabled ? "#1e3a5f" : "#2d6da3"}`,
    color: disabled ? "#456" : "#eef7ff",
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: ".08em",
    textTransform: "uppercase" as const,
    padding: "12px 20px",
    borderRadius: 8,
    cursor: disabled ? "not-allowed" : "pointer",
  }),
  chips: { display: "flex", flexWrap: "wrap" as const, gap: 6, marginBottom: 22 },
  chip: (active: boolean) => ({
    background: active ? "#0d2b46" : "#07111d",
    border: `1px solid ${active ? "#2d6da3" : "#13253a"}`,
    color: active ? "#eef7ff" : "#7ab8ff",
    fontSize: 12,
    fontWeight: 700,
    padding: "6px 11px",
    borderRadius: 20,
    cursor: "pointer",
    letterSpacing: ".04em",
  }),
  error: {
    background: "#1a0e12",
    border: "1px solid #42171c",
    color: "#ff8a96",
    fontSize: 14,
    padding: "14px 16px",
    borderRadius: 8,
    textAlign: "center" as const,
  },
  empty: {
    textAlign: "center" as const,
    color: "#eef7ff",
    fontSize: 14,
    padding: "40px 0",
  },
  resultHead: {
    display: "flex",
    alignItems: "baseline" as const,
    gap: 12,
    flexWrap: "wrap" as const,
    marginBottom: 14,
  },
  resultTicker: { fontSize: 30, fontWeight: 800, color: "#eef7ff", letterSpacing: ".02em" },
  resultExp: {
    fontSize: 12,
    color: "#eef7ff",
    textTransform: "uppercase" as const,
    letterSpacing: ".1em",
    fontWeight: 700,
  },
  resultUpdated: { fontSize: 11, color: "#eef7ff", marginLeft: "auto" },
  card: {
    background: "#0b111b",
    border: "1px solid #1a2a3a",
    borderRadius: 12,
    padding: "16px 18px",
    marginBottom: 14,
    boxShadow: "0 14px 40px rgba(0,0,0,.3)",
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: ".14em",
    textTransform: "uppercase" as const,
    color: "#00e5ff",
    marginBottom: 14,
  },
  emGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 10,
  },
  stat: {
    background: "#04070c",
    border: "1px solid #13253a",
    borderRadius: 8,
    padding: "12px 8px",
    textAlign: "center" as const,
  },
  avgStat: {
    background: "#04070c",
    border: "1px solid #13253a",
    borderRadius: 8,
    padding: "12px 8px",
    textAlign: "center" as const,
  },
  statLabel: {
    fontSize: 10,
    color: "#eef7ff",
    letterSpacing: ".12em",
    textTransform: "uppercase" as const,
    fontWeight: 700,
    marginBottom: 6,
  },
  statValue: { fontSize: 21, fontWeight: 700, fontFamily: mono },
  zoneRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
  },
  zoneCard: { marginBottom: 14 },
  zoneHint: { fontSize: 11, color: "#eef7ff", margin: "0 0 14px", lineHeight: 1.45 },
  zoneLine: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline" as const,
    padding: "9px 0",
    borderTop: "1px solid #0f1a28",
  },
  zoneLineLabel: {
    fontSize: 11,
    color: "#eef7ff",
    letterSpacing: ".1em",
    textTransform: "uppercase" as const,
    fontWeight: 700,
  },
  zoneLineVal: { fontSize: 22, fontWeight: 700, fontFamily: mono },
  pivot: {
    textAlign: "center" as const,
    fontSize: 13,
    color: "#7a92ad",
    letterSpacing: ".1em",
    textTransform: "uppercase" as const,
    fontWeight: 700,
    margin: "4px 0 10px",
  },
  pivotVal: { color: "#eef7ff", fontFamily: mono, marginLeft: 8, fontSize: 16 },
  disclaimer: {
    textAlign: "center" as const,
    fontSize: 11,
    color: "#eef7ff",
    marginTop: 18,
    lineHeight: 1.5,
  },
} as const;
