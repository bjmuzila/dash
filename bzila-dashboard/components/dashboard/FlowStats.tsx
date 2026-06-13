"use client";

import type { SpxFlowState } from "@/hooks/useSpxFlow";

interface FlowStatsProps {
  flow: SpxFlowState;
}

function fmtPremium(val: number): string {
  const abs = Math.abs(val);
  const sign = val >= 0 ? "+" : "-";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtVol(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000)     return `${(val / 1_000).toFixed(1)}K`;
  return String(val);
}

interface StatRowProps {
  label: string;
  value: string;
  color?: string;
}
function StatRow({ label, value, color }: StatRowProps) {
  return (
    <div className="flex justify-between items-center py-1 border-b" style={{ borderColor: "var(--border)" }}>
      <span className="text-xs" style={{ color: "var(--muted)" }}>{label}</span>
      <span className="text-xs font-mono" style={{ color: color ?? "var(--text)" }}>{value}</span>
    </div>
  );
}

export default function FlowStats({ flow }: FlowStatsProps) {
  const bullPct = (flow.bullPct * 100).toFixed(1);
  const bearPct = (flow.bearPct * 100).toFixed(1);
  const netColor = flow.netPremiumFlow >= 0 ? "#22c55e" : "#f97316";

  return (
    <div
      className="rounded border p-3"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--accent)" }}>
        Flow Stats
      </h2>

      {/* Bull/Bear bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span style={{ color: "#22c55e" }}>BULL {bullPct}%</span>
          <span style={{ color: "#f97316" }}>BEAR {bearPct}%</span>
        </div>
        <div className="h-2 rounded overflow-hidden" style={{ background: "var(--border)" }}>
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${flow.bullPct * 100}%`, background: "#22c55e" }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-0">
        <StatRow label="Net Premium"  value={fmtPremium(flow.netPremiumFlow)} color={netColor} />
        <StatRow label="Call Premium" value={fmtPremium(flow.callPremiumFlow)} color="#22c55e" />
        <StatRow label="Put Premium"  value={fmtPremium(flow.putPremiumFlow)} color="#f97316" />
        <StatRow label="PCR (vol)"    value={flow.pcr.toFixed(2)} />
        <StatRow label="B/S Ratio"    value={flow.bbr.toFixed(2)} />
        <StatRow label="Bull Vol"     value={fmtVol(flow.cumulativeBullVol)} color="#22c55e" />
        <StatRow label="Bear Vol"     value={fmtVol(flow.cumulativeBearVol)} color="#f97316" />
        <StatRow label="Call Vol"     value={fmtVol(flow.cumulativeCallVol)} />
        <StatRow label="Put Vol"      value={fmtVol(flow.cumulativePutVol)} />
        <StatRow label="Orders"       value={String(flow.orders.length)} />
        <StatRow label="ES"           value={flow.esPrice.toFixed(2)} />
        <StatRow label="NQ"           value={flow.nqPrice.toFixed(2)} />
      </div>
    </div>
  );
}
