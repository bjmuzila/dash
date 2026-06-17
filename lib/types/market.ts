import type { ChainRow } from "@/lib/calculations/calculations";
import type { FlowEntry } from "@/lib/calculations/flow";

export type OptionSide = "call" | "put";
export type TradeSentiment = "bullish" | "bearish" | "neutral";

export type GexChainRow = ChainRow;
export type FlowTapeEntry = FlowEntry;

export interface DxLinkQuote {
  eventSymbol: string;
  bidPrice?: number;
  askPrice?: number;
  lastPrice?: number;
  mark?: number;
  timestamp?: number;
}

export interface SnapshotState<TPayload = unknown> {
  id?: number;
  timestamp: number;
  date: string;
  payload: TPayload;
}
