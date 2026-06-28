"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEsCandles } from "@/hooks/useEsCandles";
import { LiveIb } from "@/components/insights/IbLogic";
import { NqIbLive } from "@/components/insights/NqIbLive";
import {
  HOME_THEME,
  homeGlossPanelStyle,
  homeHeaderStyle,
  homePanelStyle,
} from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { SegGroup, DockButton } from "@/components/shared/DockToolbar";
import {
  computeRefLevels,
  scanToday,
  computeStats,
  computeAmt,
  detectTriggers,
  type FailEvent,
  type FailStat,
  type LevelStatus,
  type AmtResult,
  type Trigger,
} from "@/lib/failLevels";

// rgba helper matching the convention used across pages.
function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function todayETStr(): string {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const m: Record<string, string> = {};
  p.forEach((x) => { m[x.type] = x.value; });
  return `${m.year}-${m.month}-${m.day}`;
}

function etClock(ts: number) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—"; // guard invalid/missing ts
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit",
  });
}

function etDate(ts: number) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—"; // guard invalid/missing ts
  return d.toLocaleDateString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric",
  });
}

const STATE_META: Record<LevelStatus["state"], { label: string; color: string }> = {
  idle:    { label: "Idle",    color: HOME_THEME.text },
  testing: { label: "Testing", color: HOME_THEME.orange },
  above:   { label: "Broke ↑", color: HOME_THEME.green },
  below:   { label: "Broke ↓", color: HOME_THEME.red },
  failed:  { label: "Failed",  color: HOME_THEME.red },
};

function dayTypeColor(dt: AmtResult["dayType"]): string {
  if (dt === "trend-up" || dt === "reversal-up") return HOME_THEME.green;
  if (dt === "trend-down" || dt === "reversal-down") return HOME_THEME.red;
  if (dt === "balance") return HOME_THEME.orange;
  return HOME_THEME.text;
}

function biasColor(b: "long" | "short" | "neutral"): string {
  return b === "long" ? HOME_THEME.green : b === "short" ? HOME_THEME.red : HOME_THEME.text;
}

function SectionTitle({ text, accent, big }: { text: string; accent: string; big?: boolean }) {
  return (
    <span style={{ fontSize: big ? 18 : 13, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: accent }}>
      {text}
    </span>
  );
}

export default function FailsPage() {
  const [tab, setTab] = useState<"ESU" | "NQU">("ESU");
  const { candles: liveCandles, historical, connected, refresh } = useEsCandles();

  // useEsCandles returns ONLY today's bars in `candles`; `historical` holds the
  // prior ~20 trading days. The fail-rate stats and historical fail log need
  // that history, so merge both (dedup by slotKey, today's live bar wins).
  const allCandles = useMemo(() => {
    const map = new Map<string, (typeof liveCandles)[number]>();
    for (const c of historical) map.set(c.slotKey, c as (typeof liveCandles)[number]);
    for (const c of liveCandles) map.set(c.slotKey, c); // live/today overrides
    return [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
  }, [liveCandles, historical]);

  // This page is ESU-specific (Sept ES). Candle symbols come through as /ESU6,
  // /ESU26, /ESU26:XCME, etc. — keep only those. If the feed tags candles
  // generically (e.g. "/ES") and nothing matches, fall back to all so the page
  // never goes blank during a contract rollover.
  const candles = useMemo(() => {
    const esu = allCandles.filter((c) => (c.symbol ?? "").toUpperCase().includes("ESU"));
    return esu.length ? esu : allCandles;
  }, [allCandles]);

  // ESU-only page — prices shown as raw ESU futures points (no SPX conversion).
  const fmt = (esVal: number) => esVal.toFixed(2);
  const unit = "ESU";

  const today = todayETStr();

  // Coarse cache keys so the heavy scans don't re-run on every WS tick.
  // `candles` is a brand-new array on each live bar update; without keying,
  // computeStats (20-day rebuild) + ref-level + AMT scans all fire every ~2s
  // and stall scroll. We only need to recompute when the *bar set* changes
  // (a bar added/removed) or the latest bar's OHLC moves a meaningful amount.
  const candlesKey = useMemo(() => {
    const n = candles.length;
    const last = candles[n - 1];
    // round close to 0.25 (one ES tick) so micro quote jitter doesn't rescan
    const lc = last ? Math.round(last.close * 4) : 0;
    const lh = last ? Math.round(last.high * 4) : 0;
    const ll = last ? Math.round(last.low * 4) : 0;
    return `${n}:${last?.slotKey ?? ""}:${lc}:${lh}:${ll}`;
  }, [candles]);

  // Historical-only key: changes when prior-day/week history changes, NOT when
  // today's forming bar ticks. Drives the 20-day stats so they stay stable.
  const historyKey = useMemo(() => {
    const hist = candles.filter((c) => c.date !== today);
    return `${hist.length}:${hist[hist.length - 1]?.slotKey ?? ""}`;
  }, [candles, today]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const levels = useMemo(() => computeRefLevels(candles, today), [candlesKey, today]);
  const todayBars = useMemo(
    () => candles.filter((c) => c.date === today).sort((a, b) => a.timestamp - b.timestamp),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candlesKey, today],
  );
  const { events: todayEvents, statuses } = useMemo(
    () => scanToday(levels, todayBars),
    [levels, todayBars],
  );
  // Defer the heavy 20-day history build off the initial paint so the page
  // loads and scrolls immediately. Recompute only when historyKey changes
  // (i.e. when prior-day/week history actually changes — not on live ticks),
  // and run it in an idle callback so it never blocks scroll.
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const [statsState, setStatsState] = useState<{ stats: FailStat[]; log: FailEvent[] }>({ stats: [], log: [] });
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const result = computeStats(candlesRef.current, 20);
      if (!cancelled) setStatsState(result);
    };
    // Prefer requestIdleCallback; fall back to a short timeout.
    const ric = (typeof window !== "undefined" && (window as any).requestIdleCallback) as
      | ((cb: () => void, opts?: { timeout: number }) => number) | undefined;
    const id = ric ? ric(run, { timeout: 1500 }) : (setTimeout(run, 200) as unknown as number);
    return () => {
      cancelled = true;
      const cic = (typeof window !== "undefined" && (window as any).cancelIdleCallback) as
        | ((id: number) => void) | undefined;
      if (ric && cic) cic(id); else clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey]);
  const { stats, log } = statsState;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const amt = useMemo(() => computeAmt(candles, today), [candlesKey, today]);
  const triggers = useMemo(() => detectTriggers(candles, today, amt), [candlesKey, today, amt]);
  const amtReadByKind = useMemo(
    () => new Map(amt.levelReads.map((r) => [r.kind, r])),
    [amt],
  );

  const lastClose = todayBars[todayBars.length - 1]?.close ?? null;

  // Today's fail tally: WIN = the fade ran ≥ 1R (maxR), independent of how far
  // the opposite reference sat. tiersHit is kept only as a "how far it ran" stat.
  const todayTotals = useMemo(() => {
    let wins = 0, losses = 0, netR = 0;
    const byLevel = new Map<string, number>();
    for (const e of todayEvents) {
      if ((e.maxR ?? 0) >= 1) wins++; else losses++;
      netR += e.maxR ?? 0;
      byLevel.set(e.short, (byLevel.get(e.short) ?? 0) + 1);
    }
    const total = wins + losses;
    return {
      wins, losses, netR,
      winRate: total ? Math.round((wins / total) * 100) : 0,
      byLevel: [...byLevel.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [todayEvents]);

  return (
    <PageShell>
      <style>{`
        .fail-hover{transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease;}
        .fail-hover:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.35);border-color:${rgba(HOME_THEME.cyan, 0.35)};}
      `}</style>

      {/* header — sticky bar pinned to top of the scrollable content column */}
      <div style={{ ...homeHeaderStyle, position: "sticky", top: 0, zIndex: 10, borderRadius: 12 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: HOME_THEME.cyan }}>Fails</span>
          <SegGroup
            options={[{ label: "ESU", value: "ESU" }, { label: "NQU", value: "NQU" }]}
            active={tab}
            onChange={(v) => setTab(v as "ESU" | "NQU")}
          />
          {tab === "ESU" && (
            <>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, color: HOME_THEME.text, opacity: 0.85 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%",
                  background: connected ? HOME_THEME.green : HOME_THEME.muted,
                  boxShadow: connected ? `0 0 8px ${rgba(HOME_THEME.green, 0.8)}` : "none" }} />
                {connected ? "LIVE" : "OFFLINE"}
              </span>
              <span className="text-xs font-mono" style={{ color: HOME_THEME.text }}>
                {lastClose != null ? `${unit} ${fmt(lastClose)}` : "—"}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DockButton onClick={() => void refresh()} title="Refresh" style={{ color: HOME_THEME.cyan }}>↻ Refresh</DockButton>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "clamp(16px, 2vw, 32px)" }}>
        {tab === "NQU" ? (
          <NqIbLive />
        ) : (
        <>
        {/* AMT day-type + bias banner */}
        {(() => {
          const dtCol = dayTypeColor(amt.dayType);
          const blCol = biasColor(amt.bias.lean);
          return (
            <div className="card-hover" style={{ ...homeGlossPanelStyle(dtCol), padding: "16px 20px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 160 }}>
                <SectionTitle text="Day Type · AMT" accent={HOME_THEME.text} />
                <span style={{ fontSize: 22, fontWeight: 800, color: dtCol, lineHeight: 1 }}>{amt.dayTypeLabel}</span>
              </div>
              <div style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.85, lineHeight: 1.45 }}>{amt.dayTypeDetail}</span>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
                    color: blCol, background: rgba(HOME_THEME.text, 0.05), border: `1px solid ${rgba(blCol, 0.35)}`, flexShrink: 0 }}>
                    {amt.bias.lean}
                  </span>
                  <span style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.9, lineHeight: 1.45 }}>{amt.bias.text}</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Live Initial Balance (merged from Insights) — full IB tracker:
            locked-DB persistence, break alerts, formed-first/vs-mid stats,
            and the rules-in-play probability engine. */}
        <LiveIb />

        {/* Active AMT setups */}
        <Card accent="cyan" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <SectionTitle text="Active Setups" accent={HOME_THEME.cyan} big />
            <span style={{ fontSize: 10, color: HOME_THEME.text }}>AMT entry triggers · first 2h strongest</span>
          </div>
          {(() => {
            const active = triggers.filter((t) => t.active);
            const recent = triggers.filter((t) => !t.active).slice(0, 6);
            if (!triggers.length) {
              return <div style={{ ...homePanelStyle, padding: 16, fontSize: 13, color: HOME_THEME.text }}>No triggers detected yet today.</div>;
            }
            return (
              <>
                {active.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
                    {active.map((t, i) => <TriggerCard key={`a-${t.kind}-${t.ts}-${i}`} t={t} fmt={fmt} live />)}
                  </div>
                )}
                {recent.length > 0 && (
                  <details>
                    <summary style={{ cursor: "pointer", fontSize: 11, color: HOME_THEME.text, padding: "4px 0" }}>
                      Earlier triggers today ({recent.length})
                    </summary>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 8 }}>
                      {recent.map((t, i) => <TriggerCard key={`r-${t.kind}-${t.ts}-${i}`} t={t} fmt={fmt} />)}
                    </div>
                  </details>
                )}
              </>
            );
          })()}
        </Card>

        {/* live status panel */}
        <Card accent="cyan" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <SectionTitle text="Live Status" accent={HOME_THEME.cyan} big />
            <span style={{ fontSize: 11, color: HOME_THEME.text }}>
              Overnight · Prev-day · Prev-week highs & lows
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            {statuses.length === 0 ? (
              <div style={{ ...homeGlossPanelStyle(), gridColumn: "1 / -1", padding: 24, textAlign: "center", fontSize: 13, color: HOME_THEME.text }}>
                {connected ? "Waiting for ES candles to build levels…" : "Loading candles…"}
              </div>
            ) : statuses.map((s) => {
              const meta = STATE_META[s.state];
              const accent = s.level.side === "above" ? HOME_THEME.green : HOME_THEME.red;
              const dist = s.distancePts;
              return (
                <div key={s.level.kind} className="card-hover" style={{ ...homeGlossPanelStyle(accent), padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: accent }}>{s.level.short}</span>
                    <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
                      color: meta.color, background: rgba(HOME_THEME.text, 0.05), border: `1px solid ${rgba(meta.color, 0.3)}` }}>
                      {meta.label}
                    </span>
                  </div>
                  <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.7 }}>{s.level.label}</span>
                  <span style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, fontFamily: "monospace", color: HOME_THEME.text }}>{fmt(s.level.price)}</span>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, marginTop: 2 }}>
                    <span style={{ color: HOME_THEME.text }}>
                      {dist != null ? (
                        <>dist <span style={{ fontFamily: "monospace", color: dist >= 0 ? HOME_THEME.green : HOME_THEME.red }}>{dist >= 0 ? "+" : ""}{dist.toFixed(2)}</span></>
                      ) : "—"}
                    </span>
                    <span style={{ color: HOME_THEME.text, opacity: 0.8 }}>
                      {s.lastEvent ? `fail ${etClock(s.lastEvent.failTs)} · dd ${s.lastEvent.pokePts.toFixed(2)}` : "no fail today"}
                    </span>
                  </div>
                  {(() => {
                    const r = amtReadByKind.get(s.level.kind);
                    if (!r) return null;
                    const bc = biasColor(r.bias);
                    return (
                      <div style={{ marginTop: 4, paddingTop: 8, borderTop: `1px solid ${HOME_THEME.border}`, display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <Tag color={r.acceptance === "strong" ? HOME_THEME.cyan : HOME_THEME.text}>{r.acceptance} acceptance</Tag>
                          {r.bias !== "neutral" ? <Tag color={bc}>{r.bias}</Tag> : null}
                        </div>
                        <span style={{ fontSize: 11, color: HOME_THEME.text, opacity: 0.8, lineHeight: 1.4 }}>{r.read}</span>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </Card>

        {/* today's fail log */}
        <Card accent="orange" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionTitle text={`Today's Fails${todayEvents.length ? ` (${todayEvents.length})` : ""}`} accent={HOME_THEME.orange} big />
          {todayEvents.length === 0 ? (
            <div style={{ ...homePanelStyle, padding: 16, fontSize: 13, color: HOME_THEME.text }}>No fails logged today yet.</div>
          ) : (
            <>
              <div style={{ ...homeGlossPanelStyle(HOME_THEME.orange), padding: 16, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 24 }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.7 }}>Wins</span>
                  <span style={{ fontSize: 24, fontWeight: 900, fontFamily: "monospace", color: HOME_THEME.green }}>{todayTotals.wins}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.7 }}>Losses</span>
                  <span style={{ fontSize: 24, fontWeight: 900, fontFamily: "monospace", color: HOME_THEME.red }}>{todayTotals.losses}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.7 }}>Win Rate</span>
                  <span style={{ fontSize: 24, fontWeight: 900, fontFamily: "monospace", color: HOME_THEME.text }}>{todayTotals.winRate}%</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.7 }}>Net R</span>
                  <span style={{ fontSize: 24, fontWeight: 900, fontFamily: "monospace", color: todayTotals.netR >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                    {todayTotals.netR >= 0 ? "+" : ""}{todayTotals.netR.toFixed(2)}R
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginLeft: "auto" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.7 }}>Fails by Level</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {todayTotals.byLevel.map(([short, n]) => (
                      <span key={short} style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: HOME_THEME.text,
                        padding: "4px 10px", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: `1px solid ${HOME_THEME.border}` }}>
                        {short} <span style={{ color: HOME_THEME.orange, fontWeight: 900 }}>{n}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <FailTable rows={[...todayEvents].reverse()} fmt={fmt} unit={unit} />
            </>
          )}
        </Card>

        {/* hit-rate stats */}
        <Card accent="purple" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <SectionTitle text="Fail Rate" accent={HOME_THEME.purple} />
            <span style={{ fontSize: 10, color: HOME_THEME.text }}>last ~20 sessions</span>
            {stats.length > 0 && (() => {
              const tot = stats.reduce((a, s) => ({ fails: a.fails + s.fails, tests: a.tests + s.tests }), { fails: 0, tests: 0 });
              const pct = tot.tests ? Math.round((tot.fails / tot.tests) * 100) : 0;
              return (
                <span style={{ marginLeft: "auto", fontSize: 15, fontWeight: 800, fontFamily: "monospace", color: HOME_THEME.purple }}>
                  {tot.fails} fails / {tot.tests} tests · {tot.tests ? `${pct}%` : "—"}
                </span>
              );
            })()}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16 }}>
            {stats.length === 0 ? (
              <div style={{ ...homeGlossPanelStyle(HOME_THEME.purple), gridColumn: "1 / -1", padding: 24, textAlign: "center", fontSize: 13, color: HOME_THEME.text }}>
                Building history…
              </div>
            ) : stats.map((st) => {
              const pct = Math.round(st.failRate * 100);
              const accent = st.kind.endsWith("High") ? HOME_THEME.green : HOME_THEME.red;
              return (
                <div key={st.kind} className="card-hover" style={{ ...homeGlossPanelStyle(accent), padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: HOME_THEME.text }}>{st.label}</span>
                    <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: accent }}>{st.tests ? `${pct}%` : "—"}</span>
                  </div>
                  <div style={{ height: 6, width: "100%", borderRadius: 999, overflow: "hidden", background: rgba(HOME_THEME.text, 0.08) }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: accent }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: HOME_THEME.text }}>
                    <span>{st.fails} fails</span>
                    <span>{st.breaks} breaks</span>
                    <span>{st.tests} tests</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* historical fail log */}
        <Card accent="cyan" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionTitle text={`Recent Fail Log${log.length ? ` (${log.length})` : ""}`} accent={HOME_THEME.cyan} />
          {log.length === 0 ? (
            <div style={{ ...homePanelStyle, padding: 16, fontSize: 13, color: HOME_THEME.text }}>No historical fails in window.</div>
          ) : (
            <FailTable rows={log.slice(0, 60)} fmt={fmt} unit={unit} showDate />
          )}
        </Card>
        </>
        )}
      </div>
    </PageShell>
  );
}

function FailTable({
  rows, fmt, unit, showDate = false,
}: { rows: FailEvent[]; fmt: (es: number) => string; unit: string; showDate?: boolean }) {
  return (
    <div style={{ ...homePanelStyle, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 15 }}>
          <thead>
            <tr style={{ color: HOME_THEME.text }}>
              {showDate && <Th>Date</Th>}
              <Th>Time</Th>
              <Th>Level</Th>
              <Th>Trade</Th>
              <Th right>Entry ({unit})</Th>
              <Th right>Risk</Th>
              <Th>Targets</Th>
              <Th right>Max R</Th>
              <Th right>Result</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => {
              const above = e.direction === "above";
              // A look-above-and-fail is a SHORT the rejection; look-below is a LONG.
              const trade = above ? "Fade Short" : "Fade Long";
              const tradeColor = above ? HOME_THEME.red : HOME_THEME.green;
              // Scaled targets: T1 = 50% to opposite ref, T2 = full opposite ref,
              // T3 = 2× measured move. Result = furthest tier the actual move hit.
              // WIN = fade ran ≥ 1R (MFE / risk). tiersHit shown separately as
              // how far toward the opposite reference the move actually reached.
              const tiers = e.tiersHit;
              const maxR = e.maxR;
              const win = (maxR ?? 0) >= 1;
              const resultColor = win ? HOME_THEME.green : HOME_THEME.red;
              const tierColor = (n: number) => tiers >= n ? HOME_THEME.green : rgba(HOME_THEME.text, 0.3);
              return (
                <tr key={`${e.kind}-${e.failTs}-${i}`} style={{ borderTop: `1px solid ${HOME_THEME.border}`,
                  background: win ? rgba(HOME_THEME.green, 0.06) : "transparent" }}>
                  {showDate && <Td color={HOME_THEME.text}>{etDate(e.failTs)}</Td>}
                  <Td color={HOME_THEME.text}>{etClock(e.failTs)}</Td>
                  <Td><span style={{ color: HOME_THEME.text, fontWeight: 700 }}>{e.short}</span></Td>
                  <Td><span style={{ color: tradeColor, fontWeight: 700 }}>{trade}</span></Td>
                  <Td right mono color={HOME_THEME.text}>{fmt(e.level)}</Td>
                  <Td right mono color={HOME_THEME.orange}>{e.riskPts.toFixed(2)}</Td>
                  <Td>
                    {e.oppositeLevel == null ? <span style={{ color: rgba(HOME_THEME.text, 0.4) }}>—</span> : (
                      <span style={{ display: "inline-flex", gap: 5 }}>
                        {[1, 2, 3].map((n) => (
                          <span key={n} style={{ fontSize: 11, fontWeight: 800, fontFamily: "monospace",
                            padding: "2px 6px", borderRadius: 4, color: tierColor(n),
                            border: `1px solid ${tiers >= n ? rgba(HOME_THEME.green, 0.4) : rgba(HOME_THEME.text, 0.15)}`,
                            background: tiers >= n ? rgba(HOME_THEME.green, 0.1) : "transparent" }}>
                            T{n}
                          </span>
                        ))}
                      </span>
                    )}
                  </Td>
                  <Td right mono color={maxR == null ? HOME_THEME.text : maxR >= 2 ? HOME_THEME.green : maxR >= 1 ? HOME_THEME.orange : HOME_THEME.red}>
                    {maxR == null ? "—" : `${maxR.toFixed(2)}R`}
                  </Td>
                  <Td right>
                    <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".05em", padding: "3px 8px", borderRadius: 4,
                      color: resultColor, background: rgba(resultColor, 0.12), border: `1px solid ${rgba(resultColor, 0.35)}` }}>
                      {win ? `WIN T${tiers}` : "LOSS"}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase",
      color, background: "rgba(255,255,255,0.05)", border: `1px solid ${rgba(color, 0.3)}` }}>
      {children}
    </span>
  );
}

function TriggerCard({ t, fmt, live = false }: { t: Trigger; fmt: (es: number) => string; live?: boolean }) {
  const col = t.direction === "long" ? HOME_THEME.green : HOME_THEME.red;
  return (
    <div className="fail-hover" style={{ ...homePanelStyle, padding: 16, display: "flex", flexDirection: "column", gap: 10,
      opacity: live ? 1 : 0.72,
      borderLeft: `2px solid ${rgba(col, 0.6)}`,
      background: `radial-gradient(circle at 0% 0%, ${rgba(col, live ? 0.1 : 0.05)} 0%, transparent 55%), ${HOME_THEME.panelBg}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 800, width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 4, color: col, border: `1px solid ${rgba(col, 0.4)}`, background: "rgba(255,255,255,0.04)" }}>{t.code}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: HOME_THEME.text }}>{t.title}</span>
        </div>
        <Tag color={col}>{t.direction}</Tag>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <Stat label="Entry" val={fmt(t.entry)} color={HOME_THEME.text} />
        <Stat label="Stop" val={fmt(t.stop)} color={HOME_THEME.red} />
        <Stat label="Target" val={fmt(t.target)} color={HOME_THEME.green} />
      </div>
      <span style={{ fontSize: 11, color: HOME_THEME.text, opacity: 0.8, lineHeight: 1.4 }}>{t.confluence}</span>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: HOME_THEME.text }}>
        <span>{t.ref}</span>
        <span>{t.barsAgo === 0 ? "just now" : `${t.barsAgo * 5}m ago`}{live ? " · active" : ""}</span>
      </div>
    </div>
  );
}

function Stat({ label, val, color }: { label: string; val: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: HOME_THEME.text }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 800, fontFamily: "monospace", color }}>{val}</span>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th style={{ padding: "10px 12px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", textAlign: right ? "right" : "left" }}>
      {children}
    </th>
  );
}
function Td({ children, right, mono, color }: { children: React.ReactNode; right?: boolean; mono?: boolean; color?: string }) {
  return (
    <td style={{ padding: "9px 12px", textAlign: right ? "right" : "left", fontFamily: mono ? "monospace" : undefined, color }}>
      {children}
    </td>
  );
}
