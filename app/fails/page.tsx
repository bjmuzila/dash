"use client";

import { useEffect, useMemo, useState } from "react";
import { usePageLoadStatus } from "@/lib/pageStatus";
import { useEsCandles } from "@/hooks/useEsCandles";
import {
  HOME_THEME,
  homeButtonStyle,
  homeContentStyle,
  homeHeaderStyle,
  homePanelStyle,
  homeSecondaryButtonStyle,
  homeShellStyle,
} from "@/components/shared/homeTheme";
import {
  computeRefLevels,
  scanToday,
  computeStats,
  type FailEvent,
  type LevelStatus,
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
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit",
  });
}

const STATE_META: Record<LevelStatus["state"], { label: string; color: string }> = {
  idle:    { label: "Idle",    color: HOME_THEME.muted },
  testing: { label: "Testing", color: HOME_THEME.orange },
  above:   { label: "Broke ↑", color: HOME_THEME.green },
  below:   { label: "Broke ↓", color: HOME_THEME.red },
  failed:  { label: "Failed",  color: HOME_THEME.red },
};

function SectionTitle({ text, accent }: { text: string; accent: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: accent }}>
      {text}
    </span>
  );
}

export default function FailsPage() {
  usePageLoadStatus({ pageKey: "fails", pageLabel: "Fails", path: "/fails" });

  const { candles, connected, refresh } = useEsCandles();

  // Live ES/SPX basis (esFut - spx) for SPX-equivalent display, from /ws/gex.
  const [basis, setBasis] = useState(0);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let dead = false;

    const handle = (raw: string) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw); } catch { return; }
      const d = (msg.data && typeof msg.data === "object" ? msg.data : msg) as Record<string, unknown>;
      const spx = Number(d.spot ?? 0);
      const es = Number(d.esFut ?? 0);
      if (spx > 0 && es > 0) setBasis(es - spx);
    };
    const connect = () => {
      if (dead) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      try { ws = new WebSocket(`${proto}//${window.location.host}/ws/gex`); }
      catch { schedule(); return; }
      ws.onmessage = (e) => handle(String(e.data));
      ws.onerror = () => { try { ws?.close(); } catch {} };
      ws.onclose = () => { if (!dead) schedule(); };
    };
    const schedule = () => {
      if (dead) return;
      if (retry) clearTimeout(retry);
      retry = setTimeout(connect, 2500);
    };
    connect();
    return () => {
      dead = true;
      if (retry) clearTimeout(retry);
      if (ws) { ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(); } catch {} }
    };
  }, []);

  // SPX-equivalent display: subtract basis from ES level. Toggle to show raw ES.
  const [showSpx, setShowSpx] = useState(true);
  const px = (esVal: number) => (showSpx ? esVal - basis : esVal);
  const fmt = (esVal: number) => px(esVal).toFixed(2);
  const unit = showSpx ? "SPX" : "ES";

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
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: HOME_THEME.cyan }}>Fails</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, color: HOME_THEME.text, opacity: 0.85 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%",
              background: connected ? HOME_THEME.green : HOME_THEME.muted,
              boxShadow: connected ? `0 0 8px ${rgba(HOME_THEME.green, 0.8)}` : "none" }} />
            {connected ? "LIVE" : "OFFLINE"}
          </span>
          <span className="text-xs font-mono" style={{ color: HOME_THEME.text }}>
            {lastClose != null ? `${unit} ${fmt(lastClose)}` : "—"}
            {basis ? <span style={{ opacity: 0.55 }}> · basis {basis > 0 ? "+" : ""}{basis.toFixed(2)}</span> : null}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSpx((s) => !s)}
            style={{ ...homeSecondaryButtonStyle, borderColor: HOME_THEME.cyan, color: HOME_THEME.cyan }}>
            {unit}
          </button>
          <button onClick={() => void refresh()} style={homeButtonStyle}>Refresh</button>
        </div>
      </div>

      <div style={{ ...homeContentStyle, overflow: "auto" }}>
        {/* live status panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <SectionTitle text="Live Status" accent={HOME_THEME.cyan} />
            <span style={{ fontSize: 11, color: HOME_THEME.muted }}>
              Overnight · Prev-day · Prev-week highs & lows
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            {statuses.length === 0 ? (
              <div style={{ ...homePanelStyle, gridColumn: "1 / -1", padding: 24, textAlign: "center", fontSize: 13, color: HOME_THEME.muted }}>
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
                    <span style={{ color: HOME_THEME.muted }}>
                      {dist != null ? (
                        <>dist <span style={{ fontFamily: "monospace", color: dist >= 0 ? HOME_THEME.green : HOME_THEME.red }}>{dist >= 0 ? "+" : ""}{dist.toFixed(2)}</span></>
                      ) : "—"}
                    </span>
                    <span style={{ color: HOME_THEME.muted, opacity: 0.8 }}>
                      {s.lastEvent ? `fail ${etClock(s.lastEvent.failTs)} · poke ${s.lastEvent.pokePts.toFixed(2)}` : "no fail today"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* today's fail log */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionTitle text={`Today's Fails${todayEvents.length ? ` (${todayEvents.length})` : ""}`} accent={HOME_THEME.orange} />
          {todayEvents.length === 0 ? (
            <div style={{ ...homePanelStyle, padding: 16, fontSize: 13, color: HOME_THEME.muted }}>No fails logged today yet.</div>
          ) : (
            <FailTable rows={[...todayEvents].reverse()} fmt={fmt} unit={unit} />
          )}
        </div>

        {/* hit-rate stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <SectionTitle text="Fail Rate" accent={HOME_THEME.purple} />
            <span style={{ fontSize: 10, color: HOME_THEME.muted }}>last ~20 sessions</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            {stats.length === 0 ? (
              <div style={{ ...homePanelStyle, gridColumn: "1 / -1", padding: 24, textAlign: "center", fontSize: 13, color: HOME_THEME.muted }}>
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
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: HOME_THEME.muted }}>
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
            <div style={{ ...homePanelStyle, padding: 16, fontSize: 13, color: HOME_THEME.muted }}>No historical fails in window.</div>
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
            <tr style={{ color: HOME_THEME.muted }}>
              {showDate && <Th>Date</Th>}
              <Th>Time</Th>
              <Th>Level</Th>
              <Th>Type</Th>
              <Th right>Level ({unit})</Th>
              <Th right>Poke</Th>
              <Th right>Close Back</Th>
              <Th right>Follow-thru</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => {
              const above = e.direction === "above";
              const tag = above ? "Look Above & Fail" : "Look Below & Fail";
              const color = above ? HOME_THEME.red : HOME_THEME.green;
              return (
                <tr key={`${e.kind}-${e.failTs}-${i}`} style={{ borderTop: `1px solid ${HOME_THEME.border}` }}>
                  {showDate && <Td color={HOME_THEME.muted}>{new Date(e.failTs).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}</Td>}
                  <Td color={HOME_THEME.muted}>{etClock(e.failTs)}</Td>
                  <Td><span style={{ color: HOME_THEME.text, fontWeight: 700 }}>{e.short}</span></Td>
                  <Td><span style={{ color }}>{tag}</span></Td>
                  <Td right mono color={HOME_THEME.text}>{fmt(e.level)}</Td>
                  <Td right mono color={HOME_THEME.orange}>{e.pokePts.toFixed(2)}</Td>
                  <Td right mono color={HOME_THEME.muted}>{fmt(e.closeBack)}</Td>
                  <Td right mono color={e.followThruPts > 0 ? HOME_THEME.green : HOME_THEME.muted}>{e.followThruPts.toFixed(2)}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
