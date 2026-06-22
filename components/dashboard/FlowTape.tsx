"use client";

import { useMemo, useState } from "react";
import type { FlowOrder } from "@/hooks/useSpxFlow";

interface FlowTapeProps {
  orders: FlowOrder[];
  connected: boolean;
}

const FILTER_OPTIONS = [100000, 200000, 300000, 400000, 500000, "all"] as const;
const MONEYNESS_OPTIONS = ["otm", "all"] as const;

const ACTION_COLORS: Record<string, string> = {
  "BUY CALL": "#22c55e",
  "SELL CALL": "#f97316",
  "BUY PUT": "#f97316",
  "SELL PUT": "#22c55e",
};

function fmtAction(action: string): string {
  return action
    .replace(/^BUY/, "ASK")
    .replace(/^SELL/, "BID");
}

// Aggressor side: "buy" = lifted the ask (aggressive buyer), "sell" = hit the bid (aggressive seller).
const SIDE_COLORS: Record<string, string> = { buy: "#22c55e", sell: "#ef4444" };

// Trader rule-of-thumb sentiment from action (side + call/put).
function sideTitle(side: string, type: string): string {
  if (side === "buy" && type === "C") return "Call buying at ASK → Strong bullish";
  if (side === "buy" && type === "P") return "Put buying at ASK → Strong bearish";
  if (side === "sell" && type === "C") return "Call selling at BID → Bearish / profit-taking";
  if (side === "sell" && type === "P") return "Put selling at BID → Bullish";
  return "";
}

function fmtPremium(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function FlowTape({ orders, connected }: FlowTapeProps) {
  const [minPremium, setMinPremium] = useState<(typeof FILTER_OPTIONS)[number]>(100000);
  const [moneyness, setMoneyness] = useState<(typeof MONEYNESS_OPTIONS)[number]>("otm");

  const recent = useMemo(() => {
    const filtered = orders.filter((order) => {
      if (moneyness === "otm" && !order.isOtm) return false;
      if (minPremium !== "all" && Number(order.premium || 0) < minPremium) return false;
      return true;
    });
    return [...filtered].reverse();
  }, [minPremium, moneyness, orders]);

  return (
    <div
      className="flex flex-col rounded overflow-hidden"
      style={{
        border: "1px solid var(--border)",
        borderTop: "2px solid rgba(0,240,255,0.55)",
        background: "radial-gradient(circle at 50% 0%, rgba(0,240,255,0.06) 0%, transparent 55%), transparent",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-widest" style={{ color: "var(--accent)" }}>
            SPX Flow Tape
          </span>
          <div
            className="flex items-center rounded border p-0.5"
            style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.4)" }}
            title="Show all flow or only contracts that were out of the money when the order printed"
          >
            {MONEYNESS_OPTIONS.map((option) => {
              const active = moneyness === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMoneyness(option)}
                  className="px-2 py-1 text-[10px] uppercase tracking-wider rounded transition-colors"
                  style={{
                    background: active ? "var(--accent)" : "transparent",
                    color: active ? "#041016" : "var(--muted)",
                    fontWeight: 700,
                  }}
                >
                  {option === "otm" ? "OTM" : "All"}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Min Premium
            </span>
            <select
              value={String(minPremium)}
              onChange={(e) => {
                const value = e.target.value;
                setMinPremium(value === "all" ? "all" : Number(value) as Exclude<(typeof FILTER_OPTIONS)[number], "all">);
              }}
              style={{
                background: "rgba(0,0,0,0.4)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "2px 6px",
                fontSize: 11,
                fontFamily: "monospace",
                outline: "none",
              }}
              title="Minimum premium required to appear in the feed"
            >
              {FILTER_OPTIONS.map((option) => (
                <option key={String(option)} value={String(option)}>
                  {option === "all" ? "All" : `${Math.round(option / 1000)}K`}
                </option>
              ))}
            </select>
          </div>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded font-mono"
          style={{
            background: connected ? "rgba(0,230,118,0.12)" : "rgba(239,68,68,0.12)",
            color: connected ? "var(--accent)" : "var(--red)",
          }}
        >
          {connected ? "LIVE" : "WAITING"}
        </span>
      </div>

      <div
        className="grid text-xs px-3 py-1 border-b flex-shrink-0"
        style={{
          gridTemplateColumns: "55px 48px 1fr 60px 70px 65px",
          borderColor: "var(--border)",
          color: "var(--muted)",
        }}
      >
        <span>Time</span>
        <span>Side</span>
        <span>Action</span>
        <span className="text-right">Strike</span>
        <span className="text-right">Size</span>
        <span className="text-right">Premium</span>
      </div>

      <div className="overflow-auto flex-1 min-h-0" style={{ maxHeight: 420 }}>
        {recent.length === 0 ? (
          <p className="text-xs p-4" style={{ color: "var(--muted)" }}>
            {connected ? "No flow matches the current filters..." : "Connecting to proxy..."}
          </p>
        ) : (
          recent.map((o, i) => (
            <div
              key={i}
              className="grid text-xs px-3 py-1 font-mono border-b hover:bg-[var(--border)] transition-colors"
              style={{
                gridTemplateColumns: "55px 48px 1fr 60px 70px 65px",
                borderColor: "var(--border)",
              }}
            >
              <span style={{ color: "var(--muted)" }}>{fmtTime(o.ts)}</span>
              <span
                title={sideTitle(o.side, o.type)}
                style={{ color: SIDE_COLORS[o.side] ?? "var(--text)", fontWeight: 700 }}
              >
                {o.side === "buy" ? "BUY" : "SELL"}
              </span>
              <span style={{ color: ACTION_COLORS[o.action] ?? "var(--text)" }}>{fmtAction(o.action)}</span>
              <span className="text-right" style={{ color: "var(--text)" }}>{o.strike.toLocaleString()}</span>
              <span className="text-right" style={{ color: "var(--text)" }}>{o.size.toLocaleString()}</span>
              <span className="text-right" style={{ color: ACTION_COLORS[o.action] ?? "var(--text)" }}>
                {fmtPremium(o.premium)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
