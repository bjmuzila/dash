"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSpxFlow } from "@/hooks/useSpxFlow";
import { savePremiumFlowSnapshot } from "@/lib/snapdb";
import FlowTape from "@/components/dashboard/FlowTape";

function fmtPrice(val: number) {
  return val > 0 ? val.toFixed(2) : "—";
}

function fmtPremium(val: number): string {
  const abs = Math.abs(val);
  const sign = val >= 0 ? "+" : "-";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

const REST_THRESHOLDS = [100000, 200000, 300000, 400000, 500000] as const;

function fmtRestPremium(val: number): string {
  const abs = Math.abs(val);
  const sign = val >= 0 ? "+" : "-";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function RestTape({ orders, connected }: { orders: { ts: number; symbol: string; underlying?: string; expiration?: string; strike: number; type: "C" | "P"; side: string; size: number; premium: number }[]; connected: boolean }) {
  const [minAgg, setMinAgg] = useState<(typeof REST_THRESHOLDS)[number]>(500000);
  const recent = useMemo(
    () => [...orders].filter((order) => Number(order.premium || 0) >= minAgg).sort((a, b) => b.ts - a.ts),
    [orders, minAgg],
  );

  return (
    <div className="flex flex-col gap-3 h-full min-h-0 rounded border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex items-center justify-between flex-shrink-0 px-3 py-2 border-b" style={{ borderColor: "var(--border)" }}>
        <div>
          <div className="text-xs uppercase tracking-widest" style={{ color: "var(--accent)" }}>Rest Tape</div>
          <div className="text-[11px]" style={{ color: "var(--text)" }}>500 ms aggregated watchlist options</div>
        </div>
        <label className="flex items-center gap-2 text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
          Min
          <select
            value={String(minAgg)}
            onChange={(e) => setMinAgg(Number(e.target.value) as (typeof REST_THRESHOLDS)[number])}
            style={{ background: "#0b1320", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", fontSize: 11, fontFamily: "monospace" }}
          >
            {REST_THRESHOLDS.map((n) => <option key={n} value={n}>{`${Math.round(n / 1000)}K`}</option>)}
          </select>
        </label>
      </div>
      <div className="px-3 py-1 border-b text-xs grid flex-shrink-0" style={{ borderColor: "var(--border)", color: "var(--muted)", gridTemplateColumns: "64px 72px 70px 1fr 54px 70px 70px" }}>
        <span>Time</span><span>Symbol</span><span>Exp</span><span>Strike</span><span className="text-right">Side</span><span className="text-right">Size</span><span className="text-right">Premium</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-2 pb-2">
        {recent.length === 0 ? (
          <div className="text-xs p-3" style={{ color: "var(--muted)" }}>{connected ? "Waiting for aggregated watchlist option flow..." : "Connecting to proxy..."}</div>
        ) : recent.map((o, i) => (
          <div
            key={`${o.symbol}-${o.ts}-${i}`}
            className="grid text-xs font-mono border-b"
            style={{ gridTemplateColumns: "64px 72px 70px 1fr 54px 70px 70px", borderColor: "var(--border)", padding: "8px 8px" }}
          >
            <span style={{ color: "var(--muted)" }}>{new Date(o.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            <span style={{ color: "var(--text)", fontWeight: 700 }}>{o.underlying ?? o.symbol}</span>
            <span style={{ color: "var(--muted)" }}>{o.expiration ? o.expiration.slice(5) : "--"}</span>
            <span style={{ color: "var(--text)", fontWeight: 700 }}>{o.strike ? `${Number(o.strike).toLocaleString()}${o.type}` : "--"}</span>
            <span className="text-right" style={{ color: o.side === "buy" ? "#22c55e" : "#f97316", fontWeight: 700 }}>{String(o.side || "").toUpperCase()}</span>
            <span className="text-right" style={{ color: "var(--text)", fontWeight: 700 }}>{Number(o.size || 0).toLocaleString()}</span>
            <span className="text-right" style={{ color: "var(--text)", fontWeight: 700 }}>{fmtRestPremium(o.premium)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function toEtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export default function DashboardPage() {
  const { flow, reset: resetFlow } = useSpxFlow(true);
  const lastPremiumSaveRef = useRef(0);
  const tapeSavedRef = useRef(0);
  const restSavedRef = useRef(0);

  const reset = useCallback(() => {
    tapeSavedRef.current = 0;
    restSavedRef.current = 0;
    resetFlow();
  }, [resetFlow]);

  // ── Save premium flow to SQLite every 30s when connected ─────────────────
  useEffect(() => {
    if (!flow.connected) return;
    const now = Date.now();
    if (now - lastPremiumSaveRef.current < 30_000) return;
    lastPremiumSaveRef.current = now;
    savePremiumFlowSnapshot(
      flow.callPremiumFlow,
      flow.putPremiumFlow,
      flow.netPremiumFlow,
      flow.spxPrice || flow.esPrice,
    ).catch(() => {});
  }, [flow.connected, flow.callPremiumFlow, flow.putPremiumFlow, flow.netPremiumFlow, flow.spxPrice, flow.esPrice]);

  // ── Persist new individual flow calls to SQLite ───────────────────────────
  useEffect(() => {
    const newTape = flow.tapeOrders.slice(tapeSavedRef.current);
    const newRest = flow.restOrders.slice(restSavedRef.current);
    if (!newTape.length && !newRest.length) return;

    const payload = [
      ...newTape.map((o) => ({
        ts: o.ts,
        date: toEtDate(o.ts),
        source: "tape" as const,
        symbol: o.symbol,
        underlying: o.underlying,
        expiration: o.expiration,
        strike: o.strike,
        option_type: o.type,
        side: o.side,
        action: o.action,
        price: o.price,
        size: o.size,
        premium: o.premium,
        is_otm: o.isOtm ? 1 : 0,
      })),
      ...newRest.map((o) => ({
        ts: o.ts,
        date: toEtDate(o.ts),
        source: "rest" as const,
        symbol: o.symbol,
        underlying: o.underlying,
        expiration: o.expiration,
        strike: o.strike,
        option_type: o.type,
        side: o.side,
        action: o.action,
        price: o.price,
        size: o.size,
        premium: o.premium,
        is_otm: o.isOtm ? 1 : 0,
      })),
    ];

    tapeSavedRef.current = flow.tapeOrders.length;
    restSavedRef.current = flow.restOrders.length;

    fetch("/api/flow/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, [flow.tapeOrders, flow.restOrders]);

  const netColor = flow.netPremiumFlow >= 0 ? "var(--accent)" : "var(--red)";

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xs uppercase tracking-widest" style={{ color: "var(--accent)" }}>
            SPX 0DTE Flow
          </h1>
          <span
            className="text-xs px-2 py-0.5 rounded"
            style={{
              background: flow.connected ? "#0c2a1e" : "#1a0a0a",
              color: flow.connected ? "var(--accent)" : "var(--red)",
            }}
          >
            {flow.connected ? "● LIVE" : "● CONNECTING"}
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* ES / SPX price */}
          <div className="flex items-center gap-2 text-xs font-mono">
            <span style={{ color: "var(--muted)" }}>ES</span>
            <span style={{ color: "var(--text)" }}>{fmtPrice(flow.esPrice)}</span>
            <span style={{ color: "var(--muted)" }}>SPX~</span>
            <span style={{ color: "var(--text)" }}>{fmtPrice(flow.spxPrice)}</span>
          </div>

          {/* Net premium badge */}
          <div className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: "var(--border)", color: netColor }}>
            NET {fmtPremium(flow.netPremiumFlow)}
          </div>

          <button
            onClick={reset}
            className="text-xs px-3 py-1 rounded border transition-colors hover:bg-[var(--border)]"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            ↺ Reset
          </button>
        </div>
      </div>

      {/* ── Δ-GEX stat row ── */}
      <div
        className="grid grid-cols-3 rounded border flex-shrink-0"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="px-4 py-3 border-r" style={{ borderColor: "var(--border)" }}>
          <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>CALL Premium</div>
          <div className="text-base font-mono font-bold" style={{ color: "#22c55e" }}>
            {fmtPremium(flow.callPremiumFlow)}
          </div>
        </div>
        <div className="px-4 py-3 border-r" style={{ borderColor: "var(--border)" }}>
          <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>PUT Premium</div>
          <div className="text-base font-mono font-bold" style={{ color: "#f97316" }}>
            {fmtPremium(flow.putPremiumFlow)}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>NET Premium</div>
          <div className="text-base font-mono font-bold" style={{ color: netColor }}>
            {fmtPremium(flow.netPremiumFlow)}
          </div>
        </div>
      </div>

      {/* ── Bull / Bear bar ── */}
      <div className="flex-shrink-0">
        <div className="flex justify-between text-xs mb-1">
          <span style={{ color: "#22c55e" }}>BULL {(flow.bullPct * 100).toFixed(1)}%</span>
          <span style={{ color: "var(--muted)" }}>PCR {flow.pcr.toFixed(2)} · B/S {flow.bbr.toFixed(2)}</span>
          <span style={{ color: "#f97316" }}>BEAR {(flow.bearPct * 100).toFixed(1)}%</span>
        </div>
        <div className="h-2 rounded overflow-hidden" style={{ background: "var(--border)" }}>
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${flow.bullPct * 100}%`, background: "#22c55e" }}
          />
        </div>
      </div>

      {/* ── Main grid: tape + stats ── */}
      <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
        <div className="min-h-0">
          <FlowTape orders={flow.tapeOrders} connected={flow.connected} />
        </div>
        <div className="min-h-0 overflow-auto">
          <RestTape orders={flow.restOrders} connected={flow.connected} />
        </div>
      </div>
    </div>
  );
}
