// ─── AMT: Auction Market Theory read + live signals over the TPO profile ──────
//
// Steidlmayer/Dalton auction logic layered on top of the TPO engine in lib/tpo.ts.
// buildTpoStructures() already gives us, per RTH session: IB high/low/range,
// POC/VAH/VAL, the day open, single prints, and the excess/tail/poor/hole
// structures. AMT is the *read* on top of that skeleton — it answers the four
// questions Dalton front-loads into the first 60–90 minutes:
//
//   1. IB width vs its own recent average  → which day type is in play?
//   2. Where did we open vs prior value?    → opening type / conviction
//   3. Is value building inside, above, or below prior value? → balance vs imbalance
//   4. At the extremes, is activity responsive (fade) or initiative (follow)?
//
// The output is an AmtRead: a headline bias plus a list of AmtSignals, each with
// a concrete trigger price and target so the UI can light one up "LIVE" the
// moment spot reaches it. Everything here is PURE and cheap — it derives only
// from the already-memoized TpoResult, so it never re-runs the heavy multi-day
// structure scan. Liveness (spot vs trigger) is computed in the component per
// tick, not here.
//
// Approximations (5m OHLC, no tick tape): opening type is inferred from where
// the open sits within the day's realized range rather than from the literal
// first-15-minute tape, so it is labelled "approx". Everything else is exact
// given the profile.

import type { TpoResult, TpoSession, StructureKind } from "@/lib/tpo";

export type AmtState =
  | "balance"
  | "imbalance_up" | "imbalance_down"
  | "shift_up" | "shift_down";

export type SignalLevel = "action" | "watch" | "info";

export interface AmtSignal {
  id: string;
  level: SignalLevel;      // inherent priority; the UI upgrades to "LIVE" near spot
  title: string;
  detail: string;
  dir: "up" | "down" | "flat";
  trigger: number | null;  // price to watch — where this signal becomes actionable
  target: number | null;   // where the play is aiming
}

export interface AmtRead {
  ok: boolean;
  reason?: string;

  today: TpoSession | null;
  prior: TpoSession | null;

  avgIbRange: number | null;
  ibRatio: number | null;                 // today IB / recent median IB
  ibClass: "narrow" | "average" | "wide" | null;

  dayType: { label: string; note: string };
  opening: { label: string; note: string } | null;

  rangeExt: "none" | "up" | "down" | "both";
  state: AmtState;
  stateLabel: string;

  location: string;                        // where spot sits vs today + prior value
  bias: string;                            // one-line actionable headline
  playbook: string[];                      // pre-market → intraday process lines

  signals: AmtSignal[];
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const STRUCT_DIR: Partial<Record<StructureKind, "up" | "down">> = {
  excess_high: "down", tail_high: "up", poor_high: "up",
  excess_low: "up", tail_low: "down", poor_low: "down",
};

/**
 * Build the AMT read for the most recent session in `res`. `binSize` is used
 * only as the tick pad for range-extension detection.
 */
export function amtRead(res: TpoResult): AmtRead {
  const sessions = res.sessions;
  const today = sessions[sessions.length - 1] ?? null;
  const prior = sessions[sessions.length - 2] ?? null;

  const empty = (reason: string): AmtRead => ({
    ok: false, reason, today, prior,
    avgIbRange: null, ibRatio: null, ibClass: null,
    dayType: { label: "—", note: "" }, opening: null,
    rangeExt: "none", state: "balance", stateLabel: "—",
    location: "", bias: "", playbook: [], signals: [],
  });

  if (!today) return empty("No RTH session yet.");
  if (!prior) return empty("Needs a prior completed session for value context.");

  const pad = res.binSize;

  // ── 1. IB width vs recent average (Dalton's day-type tell) ──────────────────
  const priorIbs = sessions
    .slice(0, -1)
    .map((s) => s.ibRange)
    .filter((r): r is number => r != null && r > 0)
    .slice(-20);
  const avgIbRange = median(priorIbs);
  const ibRange = today.ibRange;
  const ibRatio = avgIbRange && ibRange != null ? ibRange / avgIbRange : null;
  const ibClass: AmtRead["ibClass"] =
    ibRatio == null ? null : ibRatio < 0.75 ? "narrow" : ibRatio > 1.25 ? "wide" : "average";

  // ── 2. Range extension beyond IB ────────────────────────────────────────────
  const reUp = today.ibHigh != null && today.high > today.ibHigh + pad;
  const reDn = today.ibLow != null && today.low < today.ibLow - pad;
  const rangeExt: AmtRead["rangeExt"] =
    reUp && reDn ? "both" : reUp ? "up" : reDn ? "down" : "none";

  // ── 3. Day-type projection (IB width + realized RE) ─────────────────────────
  const dayType = ((): { label: string; note: string } => {
    if (ibClass === "narrow") {
      if (rangeExt === "up" || rangeExt === "down")
        return { label: "Trend / range-extension", note: `Narrow IB, one-sided extension ${rangeExt}. Do NOT fade — position with the move on pullbacks.` };
      return { label: "Coiled — expect extension", note: "Narrow IB, no extension yet. Odds favor a range-extension break; trade the break, not the middle." };
    }
    if (ibClass === "wide") {
      if (rangeExt === "both")
        return { label: "Neutral — two-sided", note: "Wide IB, extension both ways. Rotational and noisy — fade extremes or stand aside." };
      if (rangeExt === "none")
        return { label: "Normal — rotational", note: "Wide IB, minimal extension. Bell-shaped rotation likely — fade value-area extremes toward POC." };
      return { label: "Normal — modest extension", note: `Wide IB with ${rangeExt} extension. Lean with the extension but respect rotation risk.` };
    }
    // average
    if (rangeExt === "up" || rangeExt === "down")
      return { label: "Normal variation", note: `Average IB, ${rangeExt}-side extension — the most common day. Trade with the extension.` };
    if (rangeExt === "both")
      return { label: "Neutral — two-sided", note: "Average IB, both-sided extension. Fade extremes or stand aside." };
    return { label: "Balancing", note: "Average IB, no extension. Two-sided so far — let the auction tip its hand." };
  })();

  // ── 4. State vs prior day's value area ──────────────────────────────────────
  let state: AmtState = "balance";
  if (today.val > prior.vah + pad) state = "imbalance_up";
  else if (today.vah < prior.val - pad) state = "imbalance_down";
  else if (today.poc > prior.vah) state = "shift_up";
  else if (today.poc < prior.val) state = "shift_down";

  const stateLabel = {
    balance: "Balance — value overlaps prior; two-sided",
    imbalance_up: "Imbalance ↑ — value entirely above prior; repricing higher",
    imbalance_down: "Imbalance ↓ — value entirely below prior; repricing lower",
    shift_up: "Shift ↑ — POC pushed above prior value",
    shift_down: "Shift ↓ — POC pushed below prior value",
  }[state];

  // ── 2b. Opening type (approx, from open's location in the realized range) ────
  const opening = ((): { label: string; note: string } => {
    const rng = today.high - today.low;
    const openVsPriorVA =
      today.open > prior.vah ? "above prior value"
      : today.open < prior.val ? "below prior value"
      : "inside prior value";
    if (rng <= 0) return { label: "Open-Auction (approx)", note: `Opened ${openVsPriorVA}.` };
    const fromLow = (today.open - today.low) / rng;   // 0 = drove up off the open, 1 = drove down
    if (fromLow <= 0.15)
      return { label: "Open-Drive ↑ (approx)", note: `Opened near the low ${openVsPriorVA} and drove up — highest trend odds. Trade with the drive.` };
    if (fromLow >= 0.85)
      return { label: "Open-Drive ↓ (approx)", note: `Opened near the high ${openVsPriorVA} and drove down — highest trend odds. Trade with the drive.` };
    return { label: "Open-Auction / rotational (approx)", note: `Opened mid-range ${openVsPriorVA} — two-sided, low conviction. Wait for clearer information.` };
  })();

  // ── location + bias ─────────────────────────────────────────────────────────
  const location =
    `Today value ${today.val.toFixed(2)}–${today.vah.toFixed(2)} (POC ${today.poc.toFixed(2)}) · ` +
    `prior value ${prior.val.toFixed(2)}–${prior.vah.toFixed(2)}.`;

  const bias =
    state === "imbalance_up" || state === "shift_up"
      ? "Bias HIGHER — initiative buyers in control. Buy pullbacks into developing value; do not fade the highs."
      : state === "imbalance_down" || state === "shift_down"
      ? "Bias LOWER — initiative sellers in control. Sell rallies into developing value; do not fade the lows."
      : "TWO-SIDED — value overlaps prior. Fade value-area extremes toward POC; trade the range until acceptance breaks it.";

  const playbook: string[] = [
    `Mark prior value: VAH ${prior.vah.toFixed(2)} · POC ${prior.poc.toFixed(2)} · VAL ${prior.val.toFixed(2)}.`,
    ibRatio != null
      ? `IB ${ibClass} (${ibRatio.toFixed(2)}× recent median) → ${dayType.label}.`
      : `IB baseline still building — need more sessions to grade IB width.`,
    `Open: ${opening.label}. ${opening.note}`,
    `State: ${stateLabel}. ${bias}`,
    `Confirm with acceptance: value building outside prior VA = follow; a probe that snaps back = fade.`,
  ];

  // ── signals (each carries a trigger + target so the UI can fire it LIVE) ─────
  const signals: AmtSignal[] = [];
  const trend = state === "imbalance_up" || state === "shift_up" ? "up"
    : state === "imbalance_down" || state === "shift_down" ? "down" : "flat";

  // Value-area edges — the bread-and-butter balance trade.
  if (state === "balance") {
    signals.push({
      id: "vah-fade", level: "watch", dir: "down",
      title: "Fade today's VAH", trigger: today.vah, target: today.poc,
      detail: `Responsive sell at value-area high ${today.vah.toFixed(2)} → target POC ${today.poc.toFixed(2)}. Balance-day mean reversion; tight risk above VAH.`,
    });
    signals.push({
      id: "val-fade", level: "watch", dir: "up",
      title: "Fade today's VAL", trigger: today.val, target: today.poc,
      detail: `Responsive buy at value-area low ${today.val.toFixed(2)} → target POC ${today.poc.toFixed(2)}. Balance-day mean reversion; tight risk below VAL.`,
    });
  } else {
    // In imbalance, the value edge on the trend side is a pullback ENTRY, not a fade.
    const edge = trend === "up" ? today.val : today.vah;
    const edgeName = trend === "up" ? "VAL" : "VAH";
    if (trend !== "flat")
      signals.push({
        id: "trend-pullback", level: "action", dir: trend,
        title: `Buy/sell the pullback to ${edgeName}`,
        trigger: edge, target: trend === "up" ? today.vah : today.val,
        detail: `Initiative ${trend === "up" ? "buyers" : "sellers"} — enter pullbacks into developing value near ${edge.toFixed(2)}, trail behind structure. Do not fade the ${trend === "up" ? "highs" : "lows"}.`,
      });
  }

  // Range-extension follow (narrow/average IB breaking IB).
  if (rangeExt === "up" && today.ibHigh != null && ibClass !== "wide")
    signals.push({
      id: "re-up", level: "action", dir: "up",
      title: "Range extension ↑ — follow", trigger: today.ibHigh, target: null,
      detail: `Broke IB high ${today.ibHigh.toFixed(2)} on a ${ibClass ?? "?"} IB — initiative up. Buy the pullback to IB high, don't fade.`,
    });
  if (rangeExt === "down" && today.ibLow != null && ibClass !== "wide")
    signals.push({
      id: "re-dn", level: "action", dir: "down",
      title: "Range extension ↓ — follow", trigger: today.ibLow, target: null,
      detail: `Broke IB low ${today.ibLow.toFixed(2)} on a ${ibClass ?? "?"} IB — initiative down. Sell the pullback to IB low, don't fade.`,
    });
  // Wide-IB responsive fade at the untested IB extreme.
  if (ibClass === "wide" && rangeExt === "none") {
    if (today.ibHigh != null)
      signals.push({
        id: "ib-fade-hi", level: "watch", dir: "down",
        title: "Responsive fade at IB high", trigger: today.ibHigh, target: today.poc,
        detail: `Wide IB, no extension — rotational. Fade IB high ${today.ibHigh.toFixed(2)} back toward POC ${today.poc.toFixed(2)}.`,
      });
    if (today.ibLow != null)
      signals.push({
        id: "ib-fade-lo", level: "watch", dir: "up",
        title: "Responsive fade at IB low", trigger: today.ibLow, target: today.poc,
        detail: `Wide IB, no extension — rotational. Fade IB low ${today.ibLow.toFixed(2)} back toward POC ${today.poc.toFixed(2)}.`,
      });
  }

  // Today's structures → responsive vs initiative, with concrete levels.
  for (const s of today.structures) {
    const dir = STRUCT_DIR[s.kind];
    if (s.kind === "excess_high")
      signals.push({ id: s.id, level: "watch", dir: "down", title: "Fade the excess high",
        trigger: s.priceLo, target: today.poc,
        detail: `Rejection tail at ${s.priceLo.toFixed(2)} — auction ended properly, level holds. Fade back toward POC ${today.poc.toFixed(2)}.` });
    else if (s.kind === "excess_low")
      signals.push({ id: s.id, level: "watch", dir: "up", title: "Fade the excess low",
        trigger: s.priceHi, target: today.poc,
        detail: `Rejection tail at ${s.priceHi.toFixed(2)} — level holds. Fade back toward POC ${today.poc.toFixed(2)}.` });
    else if (s.kind === "tail_high")
      signals.push({ id: s.id, level: "info", dir: "up", title: "Tail high — trend leg, don't fade",
        trigger: s.priceLo, target: null,
        detail: `Singles left by a trend leg that closed at the high — continuation, not rejection. Buy pullbacks; do NOT short it.` });
    else if (s.kind === "tail_low")
      signals.push({ id: s.id, level: "info", dir: "down", title: "Tail low — trend leg, don't fade",
        trigger: s.priceHi, target: null,
        detail: `Singles left by a trend leg that closed at the low — continuation, not rejection. Sell rallies; do NOT buy it.` });
    else if (s.kind === "poor_high")
      signals.push({ id: s.id, level: "action", dir: "up", title: "Poor high — unfinished, expect a take-out",
        trigger: s.priceLo, target: s.priceLo,
        detail: `Flat stack at ${s.priceLo.toFixed(2)}, no tail — ran out of time, not sellers. Expect price to return and take it out. Trade toward it.` });
    else if (s.kind === "poor_low")
      signals.push({ id: s.id, level: "action", dir: "down", title: "Poor low — unfinished, expect a take-out",
        trigger: s.priceHi, target: s.priceHi,
        detail: `Flat stack at ${s.priceHi.toFixed(2)}, no tail — ran out of time, not buyers. Expect price to return and take it out. Trade toward it.` });
    else if (s.kind === "hole")
      signals.push({ id: s.id, level: "info", dir: (dir ?? "flat"), title: "Hole — thin zone, price accelerates through",
        trigger: (s.priceLo + s.priceHi) / 2, target: null,
        detail: `Mid-profile singles ${s.priceLo.toFixed(2)}–${s.priceHi.toFixed(2)}. No acceptance — price rips through. Never target inside; put targets on the far side.` });
  }

  // Nearest naked POC from the forward-filled open rail — a magnet level.
  const nakedPocs = res.open.filter((s) => s.kind === "naked_poc");
  if (nakedPocs.length) {
    const np = nakedPocs[0];
    signals.push({
      id: `np-${np.id}`, level: "watch", dir: "flat",
      title: "Naked POC — magnet", trigger: np.priceLo, target: np.priceLo,
      detail: `Untested fair value at ${np.priceLo.toFixed(2)} from ${np.date} — a strong magnet. Price is drawn to it; use it as a target, not a fade.`,
    });
  }

  return {
    ok: true, today, prior,
    avgIbRange, ibRatio, ibClass,
    dayType, opening, rangeExt, state, stateLabel,
    location, bias, playbook, signals,
  };
}
