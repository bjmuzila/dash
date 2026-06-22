"use client";

import { useEffect, useMemo, useState } from "react";
import { usePageLoadStatus } from "@/lib/pageStatus";
import { useEsCandles } from "@/hooks/useEsCandles";
import {
  computeRefLevels,
  scanToday,
  computeStats,
  type FailEvent,
  type LevelStatus,
} from "@/lib/failLevels";

// ── colors ────────────────────────────────────────────────────────────────────
const C = {
  green: "#30d158",
  red: "#ff5b5b",
  amber: "#f5c518",
  blue: "#4aa3ff",
  cyan: "#00F0FF",
  text: "rgba(255,255,255,.92)",
  muted: "rgba(255,255,255,.55)",
  faint: "rgba(255,255,255,.35)",
  border: "rgba(255,255,255,.08)",
};

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
  idle:    { label: "Idle",    color: C.faint },
  testing: { label: "Testing", color: C.amber },
  above:   { label: "Broke ↑", color: C.green },
  below:   { label: "Broke ↓", color: C.red },
  failed:  { label: "Failed",  color: C.red },
};

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
  const status = connected ? "LIVE" : "OFFLINE";

  return (
    <div className="flex h-full flex-col overflow-auto" style={{ background: "linear-gradient(180deg,#06080d,#0b1018)" }}>
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: C.border }}>
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: C.amber }}>Fails</div>
          <div className="mt-1 text-xs" style={{ color: C.muted }}>
            Look-above & look-below fails of overnight, prior-day, and prior-week highs/lows — from 5m ES.
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded border px-2 py-1" style={{ borderColor: C.border, color: connected ? C.green : C.faint }}>{status}</span>
          <button
            onClick={() => setShowSpx((s) => !s)}
            className="rounded border px-3 py-1"
            style={{ borderColor: C.border, color: C.cyan }}
          >
            {showSpx ? "SPX" : "ES"}
          </button>
          <button onClick={() => void refresh()} className="rounded border px-3 py-1" style={{ borderColor: C.border, color: "#ffb4b4" }}>
            Refresh
          </button>
        </div>
      </div>

      {/* live status panel */}
      <section className="px-4 pt-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: C.faint }}>Live Status</h2>
          <span className="text-xs" style={{ color: C.muted }}>
            Last close {lastClose != null ? fmt(lastClose) : "—"} {showSpx ? "SPX" : "ES"}
            {basis ? <span style={{ color: C.faint }}> · basis {basis > 0 ? "+" : ""}{basis.toFixed(2)}</span> : null}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {statuses.length === 0 ? (
            <div className="col-span-full rounded-xl border p-6 text-center text-sm" style={{ borderColor: C.border, color: C.muted }}>
              {connected ? "Waiting for ES candles to build levels…" : "Loading candles…"}
            </div>
          ) : statuses.map((s) => {
            const meta = STATE_META[s.state];
            const isHigh = s.level.side === "above";
            const accent = isHigh ? C.green : C.red;
            const dist = s.distancePts;
            return (
              <div key={s.level.kind} className="rounded-xl border p-4" style={{ borderColor: C.border, background: "rgba(255,255,255,.03)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>{s.level.short}</span>
                  <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: meta.color, border: `1px solid ${meta.color}55`, background: `${meta.color}14` }}>
                    {meta.label}
                  </span>
                </div>
                <div className="mt-1 text-xs" style={{ color: C.muted }}>{s.level.label}</div>
                <div className="mt-2 font-mono text-2xl font-black" style={{ color: C.text }}>{fmt(s.level.price)}</div>
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span style={{ color: C.faint }}>
                    {dist != null ? (
                      <>dist <span className="font-mono" style={{ color: dist >= 0 ? C.green : C.red }}>{dist >= 0 ? "+" : ""}{dist.toFixed(2)}</span></>
                    ) : "—"}
                  </span>
                  {s.lastEvent ? (
                    <span style={{ color: C.muted }}>
                      last fail {etClock(s.lastEvent.failTs)} · poke {s.lastEvent.pokePts.toFixed(2)}
                    </span>
                  ) : <span style={{ color: C.faint }}>no fail today</span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* today's fail log */}
      <section className="px-4 pt-6">
        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: C.faint }}>
          Today&apos;s Fails {todayEvents.length ? `(${todayEvents.length})` : ""}
        </h2>
        {todayEvents.length === 0 ? (
          <div className="rounded-xl border p-4 text-sm" style={{ borderColor: C.border, color: C.muted }}>No fails logged today yet.</div>
        ) : (
          <FailTable rows={[...todayEvents].reverse()} fmt={fmt} unit={showSpx ? "SPX" : "ES"} />
        )}
      </section>

      {/* hit-rate stats */}
      <section className="px-4 pt-6">
        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: C.faint }}>
          Fail Rate <span style={{ color: C.faint }}>· last ~20 sessions</span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stats.length === 0 ? (
            <div className="col-span-full rounded-xl border p-6 text-center text-sm" style={{ borderColor: C.border, color: C.muted }}>
              Building history…
            </div>
          ) : stats.map((st) => {
            const pct = Math.round(st.failRate * 100);
            const isHigh = st.kind.endsWith("High");
            const accent = isHigh ? C.green : C.red;
            return (
              <div key={st.kind} className="rounded-xl border p-4" style={{ borderColor: C.border, background: "rgba(255,255,255,.03)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold" style={{ color: C.text }}>{st.label}</span>
                  <span className="font-mono text-lg font-black" style={{ color: accent }}>{st.tests ? `${pct}%` : "—"}</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.08)" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: accent }} />
                </div>
                <div className="mt-2 flex justify-between text-[11px]" style={{ color: C.faint }}>
                  <span>{st.fails} fails</span>
                  <span>{st.breaks} breaks</span>
                  <span>{st.tests} tests</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* historical fail log */}
      <section className="px-4 py-6">
        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: C.faint }}>
          Recent Fail Log {log.length ? `(${log.length})` : ""}
        </h2>
        {log.length === 0 ? (
          <div className="rounded-xl border p-4 text-sm" style={{ borderColor: C.border, color: C.muted }}>No historical fails in window.</div>
        ) : (
          <FailTable rows={log.slice(0, 60)} fmt={fmt} unit={showSpx ? "SPX" : "ES"} showDate />
        )}
      </section>
    </div>
  );
}

function FailTable({
  rows, fmt, unit, showDate = false,
}: { rows: FailEvent[]; fmt: (es: number) => string; unit: string; showDate?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: C.border }}>
      <table className="w-full text-left text-xs">
        <thead>
          <tr style={{ color: C.faint }}>
            {showDate && <Th>Date</Th>}
            <Th>Time</Th>
            <Th>Level</Th>
            <Th>Type</Th>
            <Th className="text-right">Level ({unit})</Th>
            <Th className="text-right">Poke</Th>
            <Th className="text-right">Close Back</Th>
            <Th className="text-right">Follow-thru</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => {
            const above = e.direction === "above";
            const tag = above ? "Look Above & Fail" : "Look Below & Fail";
            const color = above ? C.red : C.green;
            return (
              <tr key={`${e.kind}-${e.failTs}-${i}`} style={{ borderTop: `1px solid ${C.border}` }}>
                {showDate && <Td style={{ color: C.muted }}>{new Date(e.failTs).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}</Td>}
                <Td style={{ color: C.muted }}>{etClock(e.failTs)}</Td>
                <Td><span style={{ color: C.text, fontWeight: 600 }}>{e.short}</span></Td>
                <Td><span style={{ color }}>{tag}</span></Td>
                <Td className="text-right font-mono" style={{ color: C.text }}>{fmt(e.level)}</Td>
                <Td className="text-right font-mono" style={{ color: C.amber }}>{e.pokePts.toFixed(2)}</Td>
                <Td className="text-right font-mono" style={{ color: C.muted }}>{fmt(e.closeBack)}</Td>
                <Td className="text-right font-mono" style={{ color: e.followThruPts > 0 ? C.green : C.faint }}>{e.followThruPts.toFixed(2)}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-semibold uppercase tracking-wide ${className ?? ""}`} style={{ fontSize: 10 }}>{children}</th>;
}
function Td({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <td className={`px-3 py-2 ${className ?? ""}`} style={style}>{children}</td>;
}
