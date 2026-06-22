"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSpxFlow, type FlowOrder } from "@/hooks/useSpxFlow";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { saveBzilaLiveSnapshot, getLatestBzilaSnapshotToday, savePremiumFlowSnapshot, currentSession, type BzilaLiveSnapshotOrder } from "@/lib/snapdb";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";
import { HOME_THEME as HT, homeShellStyle, homeButtonStyle } from "@/components/shared/homeTheme";

function fmtVol(v = 0) {
  if (!Number.isFinite(v) || v <= 0) return "0";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(0);
}

function fmtPrem(v = 0) {
  const a = Math.abs(v);
  const s = v >= 0 ? "+" : "-";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}

/**
 * Returns a stable session key that changes only when crossing a session boundary.
 * RTH:  09:30–17:00 ET  → key = "YYYY-MM-DD:rth"
 * EXT:  17:00–09:30 ET  → key = "YYYY-MM-DD:ext" where date is the *start* date of the ext session
 *        (i.e. the date when 17:00 was crossed, so pre-midnight and post-midnight share the same key)
 */
function getSnapshotSessionKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  const year  = read("year");
  const month = read("month");
  const day   = read("day");
  const mins  = read("hour") * 60 + read("minute");
  const session = currentSession(date);
  // For ext session that crosses midnight, subtract 1 day if we're in the 00:00–09:30 window
  // so the key stays consistent with the prior evening's session start
  let keyDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (session === "ext" && mins < 570) {
    // We're in the post-midnight portion of ext — use yesterday's date as the key
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    const pp = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(prev).reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);
    keyDate = `${pp.year}-${pp.month}-${pp.day}`;
  }
  return `${keyDate}:${session}`;
}

function strikeLabel(orders: FlowOrder[], bucket: "bull" | "bear") {
  const map = new Map<number, number>();
  for (const order of orders) {
    if (order.bucket !== bucket) continue;
    map.set(order.strike, (map.get(order.strike) ?? 0) + order.premium);
  }
  if (!map.size) return "Top strike -";
  const [strike] = [...map.entries()].sort((a, b) => b[1] - a[1])[0];
  return `Top strike ${strike.toLocaleString()}`;
}

type HistPoint = { ts: number; value: number; _i?: number };

/** Minutes-since-ET-midnight for an instant. */
function etMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

/** ET YYYY-MM-DD key for an instant. */
function etDateKey(d: Date): string {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d).reduce((a, x) => ({ ...a, [x.type]: x.value }), {} as Record<string, string>);
  return `${p.year}-${p.month}-${p.day}`;
}

const RTH_OPEN_MIN = 9 * 60 + 30;   // 09:30 ET
const RTH_CLOSE_MIN = 16 * 60;      // 16:00 ET
const EXT_OPEN_MIN = 18 * 60;       // 18:00 ET

/** Start of the currently-active session as an epoch-ms instant.
 *  Sessions break only at the two opens (matches SPX):
 *    RTH opens 09:30 → window is 09:30 of today
 *    EXT opens 18:00 → window is the most recent 18:00 (yesterday if before 09:30)
 *  09:30–18:00 belongs to today's RTH; 18:00→next 09:30 is one continuous EXT line. */
function sessionStartMs(now = new Date()): number {
  const mins = etMinutes(now);
  // Build an ET wall-clock instant at hh:mm today, returned as epoch ms.
  const atEt = (h: number, m: number, dayShift = 0): number => {
    const base = new Date(now.getTime() + dayShift * 86_400_000);
    const key = etDateKey(base);
    // Parse "YYYY-MM-DD" + offset by computing the ET-vs-local skew at `now`.
    const [Y, Mo, D] = key.split("-").map(Number);
    const guessLocal = new Date(Y, Mo - 1, D, h, m, 0, 0);
    const etShown = etMinutes(guessLocal);
    const skewMin = (h * 60 + m) - etShown;       // how far local clock is from ET for this wall time
    return guessLocal.getTime() + skewMin * 60_000;
  };
  if (mins >= RTH_OPEN_MIN && mins < EXT_OPEN_MIN) {
    return atEt(9, 30);                            // today's RTH open
  }
  // EXT: either after 18:00 today, or before 09:30 (yesterday's 18:00 open)
  return mins >= EXT_OPEN_MIN ? atEt(18, 0) : atEt(18, 0, -1);
}

/** Load the persisted net-premium series for the currently-active session,
 *  bounded to the session-start instant. Spans both ET date partitions so the
 *  EXT line that crosses midnight is reconstructed whole. Sorted ascending. */
async function fetchSessionPremHistory(): Promise<HistPoint[]> {
  const now = new Date();
  const startMs = sessionStartMs(now);
  const keys = Array.from(new Set([etDateKey(new Date(startMs)), etDateKey(now)]));
  const results = await Promise.all(
    keys.map(date =>
      fetch(`/api/snapshots/premium?date=${date}&limit=2000`)
        .then(r => (r.ok ? r.json() : { rows: [] }))
        .catch(() => ({ rows: [] }))
    )
  );
  const rows = results.flatMap(r => (Array.isArray(r?.rows) ? r.rows : []));
  return rows
    .map((row: { timestamp?: number; netPremium?: number }) => ({
      ts: Number(row.timestamp ?? 0),
      value: Number(row.netPremium ?? 0),
    }))
    .filter(p => p.ts >= startMs)
    .sort((a, b) => a.ts - b.ts);
}

function buildHistory(orders: FlowOrder[]): HistPoint[] {
  if (!orders.length) return [];
  const sorted = [...orders].sort((a, b) => a.ts - b.ts);
  const step = Math.max(1, Math.floor(sorted.length / 60));
  let running = 0;
  const points: HistPoint[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const order = sorted[i];
    running += order.premium * (order.bucket === "bull" ? 1 : -1);
    if (i % step === 0 || i === sorted.length - 1) points.push({ ts: order.ts, value: running });
  }
  return points;
}

function fmtClock(ts: number) {
  if (!ts) return "--:--";
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function Sparkline({ data, color }: { data: HistPoint[]; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; pt: HistPoint } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const W = canvas.offsetWidth || 220;
    const H = canvas.offsetHeight || 48;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    if (data.length < 2) {
      ctx.fillStyle = "#1e3050";
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Accumulating...", W / 2, H / 2 + 3);
      return;
    }

    const vals = data.map(d => d.value);
    // Clamp the Y-scale to the 2nd–98th percentile so a couple of outlier points
    // (e.g. stale/corrupt persisted rows) can't compress the real signal into a
    // flat rail and produce a square-wave look. The line itself still draws the
    // true values; only the autoscale ignores the extremes.
    const sorted = [...vals].sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))];
    let min = pct(0.02);
    let max = pct(0.98);
    if (!(max > min)) { min = Math.min(...vals); max = Math.max(...vals); }
    const range = max - min || 1;
    const x = (i: number) => (i / (data.length - 1)) * W;
    const y = (v: number) => {
      const c = v < min ? min : v > max ? max : v; // clamp outliers into view
      return H - ((c - min) / range) * (H - 6) - 3;
    };

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color === "#ff9f40" ? "rgba(255,159,64,.28)" : "rgba(0,230,118,.28)");
    grad.addColorStop(1, "rgba(0,0,0,0)");

    ctx.beginPath();
    data.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p.value)) : ctx.lineTo(x(i), y(p.value))));
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    data.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p.value)) : ctx.lineTo(x(i), y(p.value))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Hover crosshair + marker
    if (hover) {
      const i = hover.pt._i ?? 0;
      const px = x(i);
      const py = y(hover.pt.value);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }, [color, data, hover]);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    if (data.length < 2) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const i = Math.max(0, Math.min(data.length - 1, Math.round((relX / rect.width) * (data.length - 1))));
    setHover({ x: relX, pt: { ...data[i], _i: i } });
  }

  return (
    <div ref={wrapRef} style={{ width: "100%", height: "100%", position: "relative" }}
      onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} />
      {hover && (
        <div style={{
          position: "absolute", top: 2,
          left: Math.min(Math.max(hover.x - 48, 0), (wrapRef.current?.offsetWidth ?? 220) - 96),
          pointerEvents: "none", background: "rgba(8,16,26,0.95)", border: "1px solid #2a3f55",
          borderRadius: 4, padding: "3px 6px", fontSize: 9, lineHeight: 1.35, whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums", zIndex: 5, boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
        }}>
          <div style={{ color: "#8aa4be" }}>{fmtClock(hover.pt.ts)} ET</div>
          <div style={{ color: hover.pt.value >= 0 ? "#00e676" : "#ff4757", fontWeight: 700 }}>{fmtPrem(hover.pt.value)}</div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  color,
}: {
  label: string;
  value: string;
  detail: string;
  color: string;
}) {
  return (
    <div style={{
      background: `radial-gradient(circle at 50% 0%, ${color}14 0%, transparent 65%), ${HT.panelBg}`,
      backdropFilter: "blur(8px)",
      border: `1px solid ${HT.border}`,
      borderTop: `2px solid ${color}99`,
      borderRadius: 6,
      padding: "8px 6px",
      textAlign: "center",
    }}>
      <div style={{ fontSize: 9, color: HT.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, fontVariantNumeric: "tabular-nums", textShadow: `0 0 16px ${color}55` }}>{value}</div>
      <div style={{ fontSize: 9, color: HT.muted, marginTop: 3 }}>{detail}</div>
    </div>
  );
}

function TopFlowList({
  label,
  items,
  barColor,
}: {
  label: string;
  items: { strike: string; gex: number }[];
  barColor: string;
}) {
  const maxGex = Math.max(1, ...items.map((item) => item.gex));

  return (
    <div style={{
      background: `radial-gradient(circle at 50% 0%, ${barColor}10 0%, transparent 60%), ${HT.panelBg}`,
      backdropFilter: "blur(8px)",
      border: `1px solid ${HT.border}`,
      borderTop: `2px solid ${barColor}88`,
      borderRadius: 6,
      padding: "6px 8px",
      display: "flex", flexDirection: "column", gap: 3,
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: barColor, textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</div>
      {!items.length ? (
        <div style={{ color: "#fff", fontSize: 9 }}>Waiting...</div>
      ) : (
        items.map((item, index) => {
          const width = Math.max((item.gex / maxGex) * 100, 4);
          return (
            <div key={`${label}-${item.strike}-${index}`} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, flex: "0 0 auto", padding: "1px 0" }}>
              <span style={{ width: 12, color: "#fff", fontWeight: 700, flexShrink: 0 }}>{index + 1}</span>
              <span style={{ width: 40, fontWeight: 700, color: "#e0e8f0", fontVariantNumeric: "tabular-nums", flexShrink: 0, fontSize: 11 }}>{item.strike}</span>
              <div style={{ flex: 1, height: 8, background: "#0d1a26", borderRadius: 3, overflow: "hidden", minWidth: 0 }}>
                <div
                  style={{
                    height: "100%",
                    background: `linear-gradient(90deg, ${barColor}55 0%, ${barColor}cc 60%, ${barColor} 100%)`,
                    width: `${width}%`,
                    transition: "width 0.3s ease",
                    borderRadius: 3,
                    boxShadow: `0 0 6px ${barColor}66`,
                  }}
                />
              </div>
              <span style={{ width: 38, textAlign: "right", color: "#c0d4e0", fontSize: 10, fontWeight: 600, flexShrink: 0 }}>{fmtVol(item.gex)}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

function serializeOrder(order: FlowOrder): BzilaLiveSnapshotOrder {
  return {
    ts: Number(order.ts || Date.now()),
    symbol: String(order.symbol || ""),
    strike: Number(order.strike || 0),
    type: String(order.type || ""),
    side: String(order.side || ""),
    action: String(order.action || ""),
    bucket: String(order.bucket || ""),
    price: Number(order.price || 0),
    size: Number(order.size || 0),
    premium: Number(order.premium || 0),
  };
}

function hydrateOrder(order: BzilaLiveSnapshotOrder): FlowOrder | null {
  const type = String(order.type || "").toUpperCase();
  const side = String(order.side || "").toLowerCase();
  const bucket = String(order.bucket || "").toLowerCase();
  const action = String(order.action || "").toUpperCase();
  if ((type !== "C" && type !== "P") || (side !== "buy" && side !== "sell")) return null;
  if (bucket !== "bull" && bucket !== "bear" && bucket !== "neutral") return null;
  if (
    action !== "BUY CALL" &&
    action !== "SELL CALL" &&
    action !== "BUY PUT" &&
    action !== "SELL PUT" &&
    action !== "FLOW"
  ) return null;
  return {
    ts: Number(order.ts || Date.now()),
    symbol: String(order.symbol || ""),
    strike: Number(order.strike || 0),
    type,
    side,
    action,
    bucket,
    price: Number(order.price || 0),
    size: Number(order.size || 0),
    premium: Number(order.premium || 0),
    isOtm: true,
  };
}

interface SnapshotPanelProps {
  /** Per-order tape from the server `flow` WS message (oldest-first). */
  orders?: FlowOrder[];
  /** Full server flow bucket (vols/premium) from the `flow` WS message. */
  bucket?: Record<string, unknown> | null;
}

export default function SnapshotPanel({ orders: serverOrders, bucket: serverBucket }: SnapshotPanelProps = {}) {
  const { flow, seed } = useSpxFlow(true);
  const [, setNow] = useState(0);
  // Bumped whenever the accum effect ingests new trades, so the `tops` memo
  // recomputes even after the server tape hits its length cap (length stops
  // changing but the underlying accumRef keeps moving).
  const [accumTick, setAccumTick] = useState(0);

  // Drive the panel from the server-pushed flow (new proxy) when provided.
  // useSpxFlow has no socket of its own, so without this the panel stays empty.
  useEffect(() => {
    if (!serverOrders && !serverBucket) return;
    const b = (serverBucket ?? {}) as Record<string, number>;
    const callBuyVol = Number(b.callBuyVol ?? 0);
    const callSellVol = Number(b.callSellVol ?? 0);
    const putBuyVol = Number(b.putBuyVol ?? 0);
    const putSellVol = Number(b.putSellVol ?? 0);
    // Bull = buy calls + sell puts; Bear = sell calls + buy puts.
    const bullVol = callBuyVol + putSellVol;
    const bearVol = callSellVol + putBuyVol;
    seed({
      orders: serverOrders ?? [],
      callVol: callBuyVol + callSellVol,
      putVol: putBuyVol + putSellVol,
      buyVol: callBuyVol + putBuyVol,
      sellVol: callSellVol + putSellVol,
      bullVol,
      bearVol,
      netPremium: Number(b.netPremium ?? 0),
    });
  }, [serverOrders, serverBucket, seed]);
  const accumRef = useRef<Record<string, number>>({});

  // Live in-memory net-premium series. We sample the corrected signed
  // netPremiumFlow each time it moves. This is the authoritative line for the
  // current session — the persisted premium_flow rows are only a cold-start
  // fallback (and historically were corrupted by a max-magnitude latch bug,
  // which squared off the sparkline). One sample per ~3s, capped at 600 points.
  const liveSeriesRef = useRef<HistPoint[]>([]);
  const [liveSeries, setLiveSeries] = useState<HistPoint[]>([]);
  useEffect(() => {
    const v = flow.netPremiumFlow;
    if (v == null || !Number.isFinite(v)) return;
    const arr = liveSeriesRef.current;
    const now = Date.now();
    const last = arr[arr.length - 1];
    if (last && now - last.ts < 3000) {
      last.value = v; // coalesce sub-3s updates into the latest sample
    } else {
      arr.push({ ts: now, value: v });
      if (arr.length > 600) arr.shift();
    }
    setLiveSeries([...arr]);
  }, [flow.netPremiumFlow]);

  // Persisted whole-night net-premium series (from premium_flow table), so the
  // sparkline spans the full session instead of just the live ~200-print tape.
  const [dbPremHistory, setDbPremHistory] = useState<HistPoint[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const sessionRef = useRef<string>(getSnapshotSessionKey());
  const lastPersistRef = useRef(0);
  const seededRef = useRef(false);

  // ── On mount: seed cumulative state from current session's last saved snapshot ──────
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    getLatestBzilaSnapshotToday().then(snap => {
      if (!snap) return;
      // Only seed if the snapshot belongs to the current session
      if (snap.session && snap.session !== currentSession()) return;
      const { stats, orders } = snap;
      const hydratedOrders = orders
        .map(hydrateOrder)
        .filter((order): order is FlowOrder => Boolean(order));
      // Seed flow hook counters
      seed({
        callVol: stats.callVol,
        putVol: stats.putVol,
        buyVol: stats.buyVol,
        sellVol: stats.sellVol,
        bullVol: stats.bullVol,
        bearVol: stats.bearVol,
        netPremium: stats.netPremium,
        callPremium: stats.callPremium,
        putPremium: stats.putPremium,
        orders: hydratedOrders,
      });
      // Seed accumRef from saved orders
      for (const order of hydratedOrders) {
        if (!order.strike) continue;
        const strike = String(order.strike);
        const type = order.type.toLowerCase();
        const side = order.side.toLowerCase();
        const accumKey = `${strike}:${side}:${type}`;
        const spotPrice = stats.spxPrice || 5500;
        const gexDelta = order.size * spotPrice * (side === "buy" ? 1 : -1) * (type === "c" ? 1 : -1);
        accumRef.current[accumKey] = (accumRef.current[accumKey] ?? 0) + gexDelta;
        seenRef.current.add(`${order.symbol}|${order.ts}|${order.price}|${order.size}|${order.side}`);
      }
    }).catch(() => {});
  }, [seed]);

  // ── Hydrate the whole-night net-premium series and keep it fresh ───────────
  useEffect(() => {
    let alive = true;
    const load = () => fetchSessionPremHistory().then(h => {
      // Never let a sparse/empty fetch shrink an already-populated series.
      if (alive) setDbPremHistory(prev => (h.length >= prev.length ? h : prev));
    }).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Refresh just triggers a re-render — does NOT clear accumulated data.
  // Only (re)fetch the night history if it never loaded; never replace a
  // populated series (a sparse fetch must not collapse the sparkline).
  const doRefresh = useCallback(async () => {
    setNow(Date.now());
    setDbPremHistory(prev => {
      if (prev.length) return prev;
      fetchSessionPremHistory().then(h => { if (h.length) setDbPremHistory(h); }).catch(() => {});
      return prev;
    });
  }, []);

  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(doRefresh);

  useEffect(() => {
    const sessionKey = getSnapshotSessionKey();
    if (sessionRef.current !== sessionKey) {
      sessionRef.current = sessionKey;
      accumRef.current = {};
      seenRef.current = new Set();
    }

    let ingested = 0;
    for (const trade of flow.orders) {
      const key = `${trade.symbol}|${trade.ts}|${trade.price}|${trade.size}|${trade.side}`;
      if (seenRef.current.has(key) || !trade.strike) continue;
      seenRef.current.add(key);
      const strike = String(trade.strike);
      const type = trade.type.toLowerCase();
      const side = trade.side.toLowerCase();
      const accumKey = `${strike}:${side}:${type}`;
      const spotPrice = flow.spxPrice || flow.esPrice || 5500;
      const gexDelta = trade.size * spotPrice * (side === "buy" ? 1 : -1) * (type === "c" ? 1 : -1);
      accumRef.current[accumKey] = (accumRef.current[accumKey] ?? 0) + gexDelta;
      ingested++;
    }
    if (ingested) setAccumTick((t) => t + 1);
  }, [flow.esPrice, flow.orders, flow.spxPrice]);

  const pcr = flow.pcr;
  const bbr = flow.bbr;
  const bullVol = flow.cumulativeBullVol;
  const bearVol = flow.cumulativeBearVol;
  const bullDetail = `BC + SP premium flow${flow.orders.length ? ` - ${strikeLabel(flow.orders, "bull")}` : ""}`;
  const bearDetail = `SC + BP premium flow${flow.orders.length ? ` - ${strikeLabel(flow.orders, "bear")}` : ""}`;
  // Whole-night series: persisted history (full session) + the live tail that
  // hasn't been flushed to the DB yet. The live tape is a running net-premium
  // accumulator (only ~200 prints), so offset it onto the DB's last value so
  // the joined line stays continuous instead of restarting from zero.
  const premHistory = useMemo(() => {
    // The live in-memory series (sampled from the corrected signed netPremiumFlow)
    // is the source of truth for the current session. The persisted premium_flow
    // rows are only a prefix to extend the line back to session start, and only
    // for points OLDER than the live series — never overlapping it. This avoids
    // the old square-wave: corrupt/latched DB rows can't override live values.
    if (liveSeries.length >= 2) {
      const firstLiveTs = liveSeries[0].ts;
      const prefix = dbPremHistory.filter(p => p.ts < firstLiveTs);
      return [...prefix, ...liveSeries];
    }
    // Cold start (no live samples yet): show whatever persisted history exists.
    if (dbPremHistory.length) return dbPremHistory;
    return buildHistory(flow.orders);
  }, [liveSeries, dbPremHistory, flow.orders]);
  const netPrem = flow.netPremiumFlow;

  const tops = useMemo(() => {
    const getTop3 = (side: "buy" | "sell", type: "c" | "p") =>
      Object.entries(accumRef.current)
        .filter(([key]) => {
          const [, sideKey, typeKey] = key.split(":");
          return sideKey === side && typeKey === type;
        })
        .map(([key, value]) => ({ strike: key.split(":")[0], gex: Math.abs(value) }))
        .sort((a, b) => b.gex - a.gex)
        .slice(0, 3);

    const buyCalls = getTop3("buy", "c");
    const sellCalls = getTop3("sell", "c");
    const buyPuts = getTop3("buy", "p");
    const sellPuts = getTop3("sell", "p");

    const totalGex = (items: { strike: string; gex: number }[]) => items.reduce((sum, item) => sum + item.gex, 0);
    const bullTotal = totalGex(buyCalls) + totalGex(sellPuts);
    const bearTotal = totalGex(sellCalls) + totalGex(buyPuts);
    const total = bullTotal + bearTotal || 1;

    return {
      buyCalls,
      sellCalls,
      buyPuts,
      sellPuts,
      bullTotal,
      bearTotal,
      bullPct: (bullTotal / total) * 100,
      bearPct: (bearTotal / total) * 100,
      bullBreakdown: `$${fmtVol(bullTotal)} = ${fmtVol(totalGex(buyCalls))} (BC) + ${fmtVol(totalGex(sellPuts))} (SP)`,
      bearBreakdown: `$${fmtVol(bearTotal)} = ${fmtVol(totalGex(sellCalls))} (SC) + ${fmtVol(totalGex(buyPuts))} (BP)`,
    };
  }, [accumTick, flow.orders.length, flow.spxPrice, flow.esPrice]);

  const histMin = premHistory.length ? Math.min(...premHistory.map(p => p.value)) : 0;
  const histMax = premHistory.length ? Math.max(...premHistory.map(p => p.value)) : 0;
  const persistedPayload = useMemo(() => ({
    orders: flow.orders.map(serializeOrder),
    stats: {
      callVol: Number(flow.cumulativeCallVol || 0),
      putVol: Number(flow.cumulativePutVol || 0),
      buyVol: Number(flow.cumulativeBuyVol || 0),
      sellVol: Number(flow.cumulativeSellVol || 0),
      bullVol: Number(flow.cumulativeBullVol || 0),
      bearVol: Number(flow.cumulativeBearVol || 0),
      totalVol: Number((flow.cumulativeBullVol || 0) + (flow.cumulativeBearVol || 0)),
      bullPct: Number(tops.bullPct || 0),
      bearPct: Number(tops.bearPct || 0),
      pcr: Number(flow.pcr || 0),
      bbr: Number(flow.bbr || 0),
      latestTs: Number(flow.orders[flow.orders.length - 1]?.ts || 0),
      latestAction: String(flow.orders[flow.orders.length - 1]?.action || ""),
      netPremium: Number(flow.netPremiumFlow || 0),
      callPremium: Number(flow.callPremiumFlow || 0),
      putPremium: Number(flow.putPremiumFlow || 0),
      spxPrice: Number(flow.spxPrice || flow.esPrice || 0),
    },
  }), [flow.bbr, flow.cumulativeBearVol, flow.cumulativeBullVol, flow.cumulativeBuyVol, flow.cumulativeCallVol, flow.cumulativePutVol, flow.cumulativeSellVol, flow.esPrice, flow.netPremiumFlow, flow.orders, flow.pcr, flow.spxPrice, tops.bearPct, tops.bullPct]);

  useEffect(() => {
    let cancelled = false;

    async function persist() {
      if (cancelled) return;
      if (!persistedPayload.stats.bullVol && !persistedPayload.stats.bearVol && !persistedPayload.orders.length) return;
      const now = Date.now();
      if (now - lastPersistRef.current < 5000) return;
      try {
        await saveBzilaLiveSnapshot(persistedPayload);
        // Persist a net-premium time-series point so the sparkline can render the
        // whole session (the premium_flow table had no writer on server-v2).
        void savePremiumFlowSnapshot(
          persistedPayload.stats.callPremium,
          persistedPayload.stats.putPremium,
          persistedPayload.stats.netPremium,
          persistedPayload.stats.spxPrice,
        ).catch(() => {});
        lastPersistRef.current = now;
        window.dispatchEvent(new CustomEvent("db-mvc-updated", { detail: { triggerType: "bzila-live-snapshot" } }));
      } catch (err) {
        console.error("[SnapshotPanel] autosave failed", err);
      }
    }

    void persist();
    const id = window.setInterval(() => { void persist(); }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [persistedPayload]);

  return (
    <div ref={panelRef} style={{ ...homeShellStyle, background: "transparent", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "5px 10px", background: HT.panelBgStrong, backdropFilter: "blur(16px)", borderBottom: `1px solid ${HT.border}`, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, display: "inline-block", background: flow.connected ? "#00e676" : "#ef4444" }} />
        <span style={{ fontSize: 8, fontWeight: 800, color: "#00e5ff", textTransform: "uppercase", letterSpacing: "0.14em" }}>Snapshot</span>
        <button onClick={trigger} style={{ marginLeft: "auto", ...homeButtonStyle }}>
          {btnLabel}
        </button>
        <BoxSnapBtn targetRef={panelRef} label="📷" />
        <BoxDiscordBtn targetRef={panelRef} message={`📊 Flow Snapshot — ${new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false})} ET`} />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5, flexShrink: 0 }}>
          <MetricCard label="P/C Vol Ratio" value={pcr > 0 ? pcr.toFixed(2) : "0.00"} detail={`Put ${fmtVol(flow.cumulativePutVol)} / Call ${fmtVol(flow.cumulativeCallVol)}`} color={pcr >= 1 ? "#ff4757" : "#00e676"} />
          <MetricCard label="B/B Ratio" value={bbr > 0 ? bbr.toFixed(2) : "0.00"} detail={`Buy ${fmtVol(flow.cumulativeBuyVol)} / Sell ${fmtVol(flow.cumulativeSellVol)}`} color={bbr >= 1 ? "#00e676" : "#ff4757"} />
          <MetricCard label="Bull Vol" value={fmtVol(bullVol)} detail={bullDetail} color="#00e676" />
          <MetricCard label="Bear Vol" value={fmtVol(bearVol)} detail={bearDetail} color="#ff4757" />
        </div>

        <div style={{ flex: "1 1 90px", minHeight: 90, background: HT.panelBg, backdropFilter: "blur(8px)", border: `1px solid ${HT.border}`, borderRadius: 4, padding: "5px 7px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexShrink: 0 }}>
            <div style={{ fontSize: 9, color: "#fff", fontWeight: 700, textTransform: "uppercase" }}>Net Premium</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: netPrem >= 0 ? "#00e676" : "#ff4757", fontVariantNumeric: "tabular-nums" }}>{fmtPrem(netPrem)}</div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Sparkline data={premHistory} color="#ff9f40" />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 9, color: "#5a7a99", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
            <span>{premHistory.length ? fmtPrem(histMin) : "-"}</span>
            <span>{premHistory.length ? fmtPrem(histMax) : "-"}</span>
          </div>
        </div>

        <div style={{ flexShrink: 0, background: HT.panelBg, backdropFilter: "blur(8px)", border: `1px solid ${HT.border}`, borderRadius: 4, padding: "6px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#00e676" }}>{fmtVol(tops.bullTotal)} Net Bullish</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#ff4757", textAlign: "right" }}>{fmtVol(tops.bearTotal)} Net Bearish</div>
          </div>
          <div style={{ position: "relative", height: 10, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", background: "linear-gradient(90deg,#00e67655 0%,#00e676cc 60%,#00e676 100%)", width: `${tops.bullPct}%`, transition: "width .4s ease", borderRadius: "3px 0 0 3px" }} />
            <div style={{ position: "absolute", right: 0, top: 0, height: "100%", background: "linear-gradient(270deg,#ff475755 0%,#ff4757cc 60%,#ff4757 100%)", width: `${tops.bearPct}%`, transition: "width .4s ease", borderRadius: "0 3px 3px 0" }} />
          </div>
        </div>

        <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5 }}>
          <TopFlowList label="Buy Call Vol" items={tops.buyCalls} barColor="#00e676" />
          <TopFlowList label="Sell Call Vol" items={tops.sellCalls} barColor="#ff4757" />
          <TopFlowList label="Buy Put Vol" items={tops.buyPuts} barColor="#00e676" />
          <TopFlowList label="Sell Put Vol" items={tops.sellPuts} barColor="#ff4757" />
        </div>
      </div>
    </div>
  );
}
