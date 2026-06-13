// Flow analysis helpers

export interface FlowEntry {
  timestamp: number;
  ticker: string;
  side: "call" | "put";
  premium: number;
  size: number;
  strike: number;
  expiration: string;
  sentiment?: "bullish" | "bearish" | "neutral";
}

export interface FlowSummary {
  totalCallPremium: number;
  totalPutPremium: number;
  ratio: number; // call/put premium ratio
  dominantSide: "calls" | "puts" | "neutral";
}

export function computeFlowSummary(entries: FlowEntry[]): FlowSummary {
  const totalCallPremium = entries
    .filter((e) => e.side === "call")
    .reduce((s, e) => s + e.premium, 0);
  const totalPutPremium = entries
    .filter((e) => e.side === "put")
    .reduce((s, e) => s + e.premium, 0);

  const ratio =
    totalPutPremium > 0 ? totalCallPremium / totalPutPremium : Infinity;

  const dominantSide =
    ratio > 1.1 ? "calls" : ratio < 0.9 ? "puts" : "neutral";

  return { totalCallPremium, totalPutPremium, ratio, dominantSide };
}

export function filterRecentFlow(
  entries: FlowEntry[],
  windowMs = 5 * 60 * 1000
): FlowEntry[] {
  const cutoff = Date.now() - windowMs;
  return entries.filter((e) => e.timestamp >= cutoff);
}
