"use client";

import { useMemo } from "react";
import { usePageLoadStatus } from "@/lib/pageStatus";
import { useEsCandles } from "@/hooks/useEsCandles";
import { LiveIb } from "@/components/insights/IbLogic";
import {
  HOME_THEME,
  homeButtonStyle,
  homeContentStyle,
  homeHeaderStyle,
  homePanelStyle,
  homeShellStyle,
} from "@/components/shared/homeTheme";
import {
  computeRefLevels,
  scanToday,
  computeStats,
  computeAmt,
  detectTriggers,
  type FailEvent,
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

function SectionTitle({ text, accent }: { text: string; accent: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: accent }}>
      {text}
    </span>
  );
}

export default function FailsPage() {
  usePageLoadStatus({ pageKey: "fails", pageLabel: "Fails", path: "/fails" });

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
  const levels = useMemo(() => computeRefLevels(candles, today), [candles, today]);
  const todayBars = useMemo(
    () => candles.filter((c) => c.date === today).sort((a, b) => a.timestamp - b.timestamp),
    [candles, today],
  );
  const { events: todayEvents, statuses } = useMemo(
    () => scanToday(levels, todayBars),
    [levels, todayBars],
  );
  const { stats, log } = useMemo(() => computeStats(candles, 20), [candles]);

  const amt = useMemo(() => computeAmt(candles, today), [candles, today]);
  const triggers = useMemo(() => detectTriggers(candles, today, amt), [candles, today, amt]);
  const amtReadByKind = useMemo(
    () => new Map(amt.levelReads.map((r) => [r.kind, r])),
    [amt],
  );

  const lastClose = todayBars[todayBars.length - 1]?.close ?? null;

  return (
    <div style={homeShellStyle}>
      <style>{`
        .fail-hover{transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease;}
        .fail-hover:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.35);border-color:${rgba(HOME_THEME.cyan, 0.35)};}
      `}</style>

      {/* header */}
      <div style={homeHeaderStyle}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: HOME_THEME.cyan }}>ESU Fails</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, color: HOME_THEME.text, opacity: 0.85 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%",
              background: connected ? HOME_THEME.green : HOME_THEME.muted,
              boxShadow: connected ? `0 0 8px ${rgba(HOME_THEME.green, 0.8)}` : "none" }} />
            {connected ? "LIVE" : "OFFLINE"}
          </span>
          <span className="text-xs font-mono" style={{ color: HOME_THEME.text }}>
            {lastClose != null ? `${unit} ${fmt(lastClose)}` : "—"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void refresh()} style={homeButtonStyle}>Refresh</button>
        </div>
      </div>

      <div style={{ ...homeContentStyle, overflow: "auto" }}>
        {/* AMT day-type + bias banner */}
        {(() => {
          const dtCol = dayTypeColor(amt.dayType);
          const blCol = biasColor(amt.bias.lean);
          return (
            <div className="fail-hover" style={{ ...homePanelStyle, padding: "16px 20px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16,
              borderLeft: `3px solid ${dtCol}`,
              background: `radial-gradient(circle at 0% 0%, ${rgba(dtCol, 0.1)} 0%, transparent 55%), ${HOME_THEME.panelBg}` }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 160 }}>
                <SectionTitle text="Day Type · AMT" accent={HOME_THEME.text} />
                <span style={{ fontSize: 22, fontWeight: 800, color: dtCol, lineHeight: 1 }}>{amt.dayTypeLabel}</span>
              </div>
              <div style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.85, lineHeight: 1.45 }}>{amt.dayTypeDetail}</span>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
                    color: blCol, background: "rgba(255,255,255,0.05)", border: `1px solid ${rgba(blCol, 0.35)}`, flexShrink: 0 }}>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <SectionTitle text="Active Setups" accent={HOME_THEME.cyan} />
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
        </div>

        {/* live status panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <SectionTitle text="Live Status" accent={HOME_THEME.cyan} />
            <span style={{ fontSize: 11, color: HOME_THEME.text }}>
              Overnight · Prev-day · Prev-week highs & lows
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            {statuses.length === 0 ? (
              <div style={{ ...homePanelStyle, gridColumn: "1 / -1", padding: 24, textAlign: "center", fontSize: 13, color: HOME_THEME.text }}>
                {connected ? "Waiting for ES candles to build levels…" : "Loading candles…"}
              </div>
            ) : statuses.map((s) => {
              const meta = STATE_META[s.state];
              const accent = s.level.side === "above" ? HOME_THEME.green : HOME_THEME.red;
              const dist = s.distancePts;
              return (
                <div key={s.level.kind} className="fail-hover" style={{ ...homePanelStyle, padding: 16, display: "flex", flexDirection: "column", gap: 8,
                  borderLeft: `2px solid ${rgba(accent, 0.5)}`,
                  background: `radial-gradient(circle at 0% 0%, ${rgba(accent, 0.08)} 0%, transparent 55%), ${HOME_THEME.panelBg}` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: accent }}>{s.level.short}</span>
                    <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
                      color: meta.color, background: "rgba(255,255,255,0.05)", border: `1px solid ${rgba(meta.color, 0.3)}` }}>
                      {meta.label}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: HOME_THEME.text, opacity: 0.7 }}>{s.level.label}</span>
                  <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, fontFamily: "monospace", color: HOME_THEME.text }}>{fmt(s.level.price)}</span>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, marginTop: 2 }}>
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
        </div>

        {/* today's fail log */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionTitle text={`Today's Fails${todayEvents.length ? ` (${todayEvents.length})` : ""}`} accent={HOME_THEME.orange} />
          {todayEvents.length === 0 ? (
            <div style={{ ...homePanelStyle, padding: 16, fontSize: 13, color: HOME_THEME.text }}>No fails logged today yet.</div>
          ) : (
            <FailTable rows={[...todayEvents].reverse()} fmt={fmt} unit={unit} />
          )}
        </div>

        {/* hit-rate stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <SectionTitle text="Fail Rate" accent={HOME_THEME.purple} />
            <span style={{ fontSize: 10, color: HOME_THEME.text }}>last ~20 sessions</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            {stats.length === 0 ? (
              <div style={{ ...homePanelStyle, gridColumn: "1 / -1", padding: 24, textAlign: "center", fontSize: 13, color: HOME_THEME.text }}>
                Building history…
              </div>
            ) : stats.map((st) => {
              const pct = Math.round(st.failRate * 100);
              const accent = st.kind.endsWith("High") ? HOME_THEME.green : HOME_THEME.red;
              return (
                <div key={st.kind} className="fail-hover" style={{ ...homePanelStyle, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: HOME_THEME.text }}>{st.label}</span>
                    <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: accent }}>{st.tests ? `${pct}%` : "—"}</span>
                  </div>
                  <div style={{ height: 6, width: "100%", borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.08)" }}>
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
        </div>

        {/* historical fail log */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionTitle text={`Recent Fail Log${log.length ? ` (${log.length})` : ""}`} accent={HOME_THEME.cyan} />
          {log.length === 0 ? (
            <div style={{ ...homePanelStyle, padding: 16, fontSize: 13, color: HOME_THEME.text }}>No historical fails in window.</div>
          ) : (
            <FailTable rows={log.slice(0, 60)} fmt={fmt} unit={unit} showDate />
          )}
        </div>
      </div>
    </div>
  );
}

function FailTable({
  rows, fmt, unit, showDate = false,
}: { rows: FailEvent[]; fmt: (es: number) => string; unit: string; showDate?: boolean }) {
  return (
    <div style={{ ...homePanelStyle, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 12 }}>
          <thead>
            <tr style={{ color: HOME_THEME.text }}>
              {showDate && <Th>Date</Th>}
              <Th>Time</Th>
              <Th>Level</Th>
              <Th>Trade</Th>
              <Th right>Entry ({unit})</Th>
              <Th right>Risk</Th>
              <Th right>Reward</Th>
              <Th right>R/R</Th>
              <Th right>Result</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => {
              const above = e.direction === "above";
              // A look-above-and-fail is a SHORT the rejection; look-below is a LONG.
              const trade = above ? "Fade Short" : "Fade Long";
              const tradeColor = above ? HOME_THEME.red : HOME_THEME.green;
              // Risk = how far it poked past the level (to the stop above/below the
              // wick). Reward = follow-through the trade's direction. WIN = R/R ≥ 2.
              const rr = e.pokePts > 0 ? e.followThruPts / e.pokePts : null;
              const win = rr != null && rr >= 2;
              const resultColor = win ? HOME_THEME.green : HOME_THEME.red;
              return (
                <tr key={`${e.kind}-${e.failTs}-${i}`} style={{ borderTop: `1px solid ${HOME_THEME.border}`,
                  background: win ? rgba(HOME_THEME.green, 0.06) : "transparent" }}>
                  {showDate && <Td color={HOME_THEME.text}>{etDate(e.failTs)}</Td>}
                  <Td color={HOME_THEME.text}>{etClock(e.failTs)}</Td>
                  <Td><span style={{ color: HOME_THEME.text, fontWeight: 700 }}>{e.short}</span></Td>
                  <Td><span style={{ color: tradeColor, fontWeight: 700 }}>{trade}</span></Td>
                  <Td right mono color={HOME_THEME.text}>{fmt(e.level)}</Td>
                  <Td right mono color={HOME_THEME.orange}>{e.pokePts.toFixed(2)}</Td>
                  <Td right mono color={e.followThruPts > 0 ? HOME_THEME.green : HOME_THEME.text}>{e.followThruPts.toFixed(2)}</Td>
                  <Td right mono color={rr == null ? HOME_THEME.text : rr >= 2 ? HOME_THEME.green : HOME_THEME.red}>
                    {rr == null ? "—" : `${rr.toFixed(2)}R`}
                  </Td>
                  <Td right>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".05em", padding: "3px 8px", borderRadius: 4,
                      color: resultColor, background: rgba(resultColor, 0.12), border: `1px solid ${rgba(resultColor, 0.35)}` }}>
                      {rr == null ? "—" : win ? "WIN" : "LOSS"}
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
