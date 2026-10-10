// Typed re-export of the canonical pure math in lib/esGapMath.js. The .js file
// is the single source of truth (the server-v2 cron require()s it directly);
// this wrapper gives the TS UI + unit test proper types. No logic lives here.
//
// eslint-disable-next-line @typescript-eslint/no-var-requires
import * as impl from "./esGapMath.js";

export type GapDir = "up" | "down" | "flat";

export const gapDir: (gapPts: number) => GapDir = impl.gapDir;

export const computeGapFill: (
  priorClose: number,
  open0930: number,
  extreme: number
) => { pct: number; filled: boolean } = impl.computeGapFill;

export const extremeToward: (
  open0930: number,
  priorClose: number,
  sessionLow: number,
  sessionHigh: number
) => number = impl.extremeToward;
