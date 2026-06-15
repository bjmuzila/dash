"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSpxFlow, type FlowOrder } from "@/hooks/useSpxFlow";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { saveBzilaLiveSnapshot, getLatestBzilaSnapshotToday, type BzilaLiveSnapshotOrder } from "@/lib/snapdb";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";

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

function getSnapshotSessionKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  const year = read("year");
  const month = read("month");
  const day = read("day");
  const mins = read("hour") * 60 + read("minute");
  const bucket = mins < 570 ? "pre" : mins < 1080 ? "rth" : "eve";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}:${bucket}`;
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

function buildHistory(orders: FlowOrder[]) {
  if (!orders.length) return [];
  const sorted = [...orders].sort((a, b) => a.ts - b.ts);
  const step = Math.max(1, Math.floor(sorted.length / 60));
  let running = 0;
  const points: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const order = sorted[i];
    running += order.premium * (order.bucket === "bull" ? 1 : -1);
    if (i % step === 0 || i === sorted.length - 1) points.push(running);
  }
  return points;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

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

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const x = (i: number) => (i / (data.length - 1)) * W;
    const y = (v: number) => H - ((v - min) / range) * (H - 6) - 3;

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color === "#ff9f40" ? "rgba(255,159,64,.28)" : "rgba(0,230,118,.28)");
    grad.addColorStop(1, "rgba(0,0,0,0)");

    ctx.beginPath();
    data.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    data.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [color, data]);

  return <canvas ref={ref} style={{ width: "100%", height: 48, display: "block", background: "var(--overview-card-bg, #05080d)", border: "1px solid var(--overview-border-soft, #0d1f30)", borderRadius: 2 }} />;
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
    <div style={{ background: "var(--overview-card-bg, #05080d)", border: "1px solid var(--overview-border, #1a2a3a)", borderRadius: 3, padding: "5px 6px", textAlign: "center" }}>
      <div style={{ fontSize: 9, color: "#fff", fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 9, color: "#fff", marginTop: 1 }}>{detail}</div>
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
    <div style={{ background: "var(--overview-card-bg, #05080d)", border: "1px solid var(--overview-border, #1a2a3a)", borderRadius: 3, padding: "5px 7px", display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: "#fff", textTransform: "uppercase" }}>{label}</div>
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

export default function SnapshotPanel() {
  const { flow, reset, seed } = useSpxFlow(true);
  const accumRef = useRef<Record<string, number>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const sessionRef = useRef<string>(getSnapshotSessionKey());
  const lastPersistRef = useRef(0);
  const seededRef = useRef(false);

  // ── On mount: seed cumulative state from today's last saved snapshot ──────
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    getLatestBzilaSnapshotToday().then(snap => {
      if (!snap) return;
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

  const doRefresh = useCallback(async () => {
    accumRef.current = {};
    seenRef.current = new Set();
    sessionRef.current = getSnapshotSessionKey();
    reset();
    await new Promise((resolve) => setTimeout(resolve, 400));
  }, [reset]);

  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(doRefresh);

  useEffect(() => {
    const sessionKey = getSnapshotSessionKey();
    if (sessionRef.current !== sessionKey) {
      sessionRef.current = sessionKey;
      accumRef.current = {};
      seenRef.current = new Set();
    }

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
    }
  }, [flow.esPrice, flow.orders, flow.spxPrice]);

  const pcr = flow.pcr;
  const bbr = flow.bbr;
  const bullVol = flow.cumulativeBullVol;
  const bearVol = flow.cumulativeBearVol;
  const bullDetail = `BC + SP premium flow${flow.orders.length ? ` - ${strikeLabel(flow.orders, "bull")}` : ""}`;
  const bearDetail = `SC + BP premium flow${flow.orders.length ? ` - ${strikeLabel(flow.orders, "bear")}` : ""}`;
  const premHistory = useMemo(() => buildHistory(flow.orders), [flow.orders]);
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
  }, [flow.orders.length, flow.spxPrice, flow.esPrice]);

  const histMin = premHistory.length ? Math.min(...premHistory) : 0;
  const histMax = premHistory.length ? Math.max(...premHistory) : 0;
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
      if (!persistedPayload.orders.length) return;
      const now = Date.now();
      if (now - lastPersistRef.current < 5000) return;
      try {
        await saveBzilaLiveSnapshot(persistedPayload);
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
    <div ref={panelRef} style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--overview-bg, #05080d)", overflow: "hidden" }}>
      <div style={{ padding: "5px 10px", background: "var(--overview-header-bg, #070c14)", borderBottom: "1px solid var(--overview-border, #1a2a3a)", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, display: "inline-block", background: flow.connected ? "#00e676" : "#ef4444" }} />
        <span style={{ fontSize: 8, fontWeight: 800, color: "#00e5ff", textTransform: "uppercase", letterSpacing: "0.14em" }}>Snapshot</span>
        {flow.spxPrice > 0 && <span style={{ fontSize: 9, fontFamily: "inherit", color: "#3a5570", marginLeft: 4 }}>SPX {flow.spxPrice.toFixed(2)}</span>}
        <button onClick={trigger} style={{ marginLeft: "auto", ...btnStyle }}>
          {btnLabel}
        </button>
        <BoxSnapBtn targetRef={panelRef} label="📷" />
        <BoxDiscordBtn targetRef={panelRef} message={`📊 Flow Snapshot — ${new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false})} ET`} />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
          <MetricCard label="P/C Vol Ratio" value={pcr > 0 ? pcr.toFixed(2) : "0.00"} detail={`Put ${fmtVol(flow.cumulativePutVol)} / Call ${fmtVol(flow.cumulativeCallVol)}`} color={pcr >= 1 ? "#ff4757" : "#00e676"} />
          <MetricCard label="B/B Ratio" value={bbr > 0 ? bbr.toFixed(2) : "0.00"} detail={`Buy ${fmtVol(flow.cumulativeBuyVol)} / Sell ${fmtVol(flow.cumulativeSellVol)}`} color={bbr >= 1 ? "#00e676" : "#ff4757"} />
          <MetricCard label="Bull Vol" value={fmtVol(bullVol)} detail={bullDetail} color="#00e676" />
          <MetricCard label="Bear Vol" value={fmtVol(bearVol)} detail={bearDetail} color="#ff4757" />
        </div>

        <div style={{ background: "var(--overview-card-bg, #05080d)", border: "1px solid var(--overview-border, #1a2a3a)", borderRadius: 3, padding: "5px 7px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div style={{ fontSize: 9, color: "#fff", fontWeight: 700, textTransform: "uppercase" }}>Net Premium</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: netPrem >= 0 ? "#00e676" : "#ff4757", fontVariantNumeric: "tabular-nums" }}>{fmtPrem(netPrem)}</div>
          </div>
          <Sparkline data={premHistory} color="#ff9f40" />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 9, color: "#5a7a99", fontVariantNumeric: "tabular-nums" }}>
            <span>{premHistory.length ? fmtPrem(histMin) : "-"}</span>
            <span>{premHistory.length ? fmtPrem(histMax) : "-"}</span>
          </div>
        </div>

        <div style={{ background: "var(--overview-card-bg, #05080d)", border: "1px solid var(--overview-border, #1a2a3a)", borderRadius: 3, padding: "6px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#00e676" }}>{fmtVol(tops.bullTotal)} Net Bullish</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#ff4757", textAlign: "right" }}>{fmtVol(tops.bearTotal)} Net Bearish</div>
          </div>
          <div style={{ position: "relative", height: 10, background: "#1a2a3a", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", background: "linear-gradient(90deg,#00e67655 0%,#00e676cc 60%,#00e676 100%)", width: `${tops.bullPct}%`, transition: "width .4s ease", borderRadius: "3px 0 0 3px" }} />
            <div style={{ position: "absolute", right: 0, top: 0, height: "100%", background: "linear-gradient(270deg,#ff475755 0%,#ff4757cc 60%,#ff4757 100%)", width: `${tops.bearPct}%`, transition: "width .4s ease", borderRadius: "0 3px 3px 0" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 9, color: "#fff" }}>{tops.bullBreakdown}</div>
            <div style={{ fontSize: 9, color: "#fff", textAlign: "right" }}>{tops.bearBreakdown}</div>
          </div>
        </div>

        <div style={{ fontSize: 9, fontWeight: 700, color: "#00e5ff", textTransform: "uppercase", letterSpacing: "0.12em" }}>Option Flow Tops</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
          <TopFlowList label="Buy Call Vol" items={tops.buyCalls} barColor="#00e676" />
          <TopFlowList label="Sell Call Vol" items={tops.sellCalls} barColor="#ff4757" />
          <TopFlowList label="Buy Put Vol" items={tops.buyPuts} barColor="#00e676" />
          <TopFlowList label="Sell Put Vol" items={tops.sellPuts} barColor="#ff4757" />
        </div>
      </div>
    </div>
  );
}
