// ─────────────────────────────────────────────────────────────────────────────
// The current year, STATIC.
//
// On cbedge.net this hook asks /api/public-seasonality for the sessions after
// YTD_LAST_DATE and extends the current-year line in place, so the orange
// series keeps moving between data regens. THIS BUILD DOES NOT. It is the
// compiled snapshot and nothing else: every number on the page comes out of
// seasonalityData.ts, the page makes no request of its own, and what it shows
// today is what it will show next month.
//
// That is the point of the copy, not a limitation of it. It is here to be a
// fixed reference of the almanac in Voltick's palette, so it renders the same
// on every visit and needs no backend to do it. The freshness machinery is the
// one thing the port deliberately drops.
//
// The shape is kept exactly as the CB Edge original, hook and all, so both
// components mount unchanged and the freshness call is one file away if this
// ever wants it back: restore the effect, nothing else moves.
//
//   `live` is false forever, which is already what the components read to mean
//   "this is the build-time series". `extraVixEvents` is empty, so the VIX
//   spike list renders exactly the events compiled into the data file.
// ─────────────────────────────────────────────────────────────────────────────

import {
  YTD_2026_PCT,
  YTD_2026_PX,
  YTD_LAST_DATE,
} from "./seasonalityData";

/** One VIX spike event, in the shape EXTRAS.vix.events already uses. */
export type LiveVixEvent = {
  date: string;
  vix_pop: number;
  vix_open: number;
  vix_high: number;
  spx_low: number;
  next_high: number;
  low_to_next_high: number;
  next_open_close: number;
};

export type LiveYear = {
  /** Cumulative % from the prior year-end, 365-day axis. */
  pct: number[];
  /** The same series as an index level. */
  px: number[];
  /** Last session represented, ISO. */
  lastDate: string;
  /** Always false here: this build never extends the compiled series. */
  live: boolean;
  /** Always empty here. */
  extraVixEvents: LiveVixEvent[];
};

const STATIC: LiveYear = {
  pct: YTD_2026_PCT,
  px: YTD_2026_PX,
  lastDate: YTD_LAST_DATE,
  live: false,
  extraVixEvents: [],
};

/**
 * The compiled year. A constant, returned identically on every render.
 *
 * Still a hook rather than a plain export so the two call sites are untouched
 * from the CB Edge original, and so restoring the live extension is a change to
 * this file alone.
 */
export function useLiveYear(): LiveYear {
  return STATIC;
}
