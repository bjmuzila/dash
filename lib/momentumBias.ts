// Typed re-export of the canonical pure math in lib/momentumBias.js. The .js
// file is the single source of truth (the server-v2 feed require()s it directly
// to record signals); this wrapper gives the TS UI proper types. No logic here.
//
// eslint-disable-next-line @typescript-eslint/no-var-requires
import * as impl from "./momentumBias.js";

export interface MomentumBiasBar {
  momentumUpBias: number | null;
  momentumDownBias: number | null;
  boundary: number | null;
  /** TP for shorts / bullish reversal (down-bias crossunder above the boundary). */
  bullishTp: boolean;
  /** TP for longs / bearish reversal (up-bias crossunder above the boundary). */
  bearishTp: boolean;
}

export interface MomentumBiasOptions {
  momentumLength?: number;
  biasLength?: number;
  smoothLength?: number;
  impulseBoundaryLength?: number;
  stdDevMultiplier?: number;
  smoothIndicator?: boolean;
}

export const getMomentumBiasIndex: (
  bars: Array<{ high: number; low: number; close: number }>,
  opts?: MomentumBiasOptions
) => MomentumBiasBar[] = impl.getMomentumBiasIndex;

export const wma: (series: number[], length: number) => number[] = impl.wma;
export const hma: (series: number[], length: number) => number[] = impl.hma;
