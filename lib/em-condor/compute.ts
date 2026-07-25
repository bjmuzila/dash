// Iron condor math for the EM tracker.
//
// One condor per (ticker, week). Structure, as written on the Monday board:
//   • Bull put spread  (lower side): SELL put_short  / BUY put_long   (put_long  < put_short)
//   • Bear call spread (upper side): SELL call_short / BUY call_long  (call_long > call_short)
//
// The short strikes are seeded from that week's Estimated Move band
// (down = ref − EM, up = ref + EM), rounded to the ticker's strike increment;
// the longs sit one wing width beyond each short.
//
// Everything here is pure — no DB, no fetch — so it can be unit-tested and
// reused by the API routes and the owner UI.

export interface CondorLegs {
  put_long: number;
  put_short: number;
  call_short: number;
  call_long: number;
}

/** Legs as they come off the DB / a form: any of them may be null or absent. */
export type LooseLegs = { [K in keyof CondorLegs]?: number | null };

export interface CondorInput extends LooseLegs {
  net_credit?: number | null;
  put_credit?: number | null;
  call_credit?: number | null;
  contracts?: number | null;
  multiplier?: number | null;
}

// ── Week keys ───────────────────────────────────────────────────────────────

/** Normalize any date in a week to that week's MONDAY (the canonical key both
 *  em_tracker and em_condors use). Accepts "YYYY-MM-DD" or a full timestamp. */
export function mondayOf(iso: string): string {
  const ymd = String(iso || "").slice(0, 10);
  const d = new Date(ymd + "T00:00:00");
  if (Number.isNaN(d.getTime())) return ymd;
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Mon = 0
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Label a week by its FRIDAY expiration ("7/24"), matching the EM boards. */
export function weekLabel(iso: string): string {
  const mon = mondayOf(iso);
  const d = new Date(mon + "T00:00:00");
  if (Number.isNaN(d.getTime())) return String(iso || "").slice(0, 10);
  d.setDate(d.getDate() + 4);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── Strike geometry ─────────────────────────────────────────────────────────

/** Strike increment the chain actually lists for a ticker. Used to snap the raw
 *  EM band onto tradeable strikes. Anything unlisted falls back to 1. */
export const STRIKE_INCREMENT: Record<string, number> = {
  SPX: 5, NDX: 10, XSP: 1,
  ESM: 5, ESU: 5, ESZ: 5, ESH: 5,
  NQM: 10, NQU: 10, NQZ: 10, NQH: 10,
  SPY: 1, QQQ: 1, IWM: 1, SMH: 1,
  AAPL: 1, AMD: 1, AMZN: 1, GOOGL: 1, META: 5, MSFT: 5,
  NVDA: 1, TSLA: 5, COIN: 5, HOOD: 1, NFLX: 5, PLTR: 1,
};

/** Default wing width (distance from short to long) in strike POINTS. Chosen to
 *  be a sane, liquid default per name; every value is overridable per-week from
 *  the UI. Falls back to 5× the strike increment. */
export const DEFAULT_WING: Record<string, number> = {
  SPX: 25, NDX: 100, XSP: 5,
  ESM: 25, ESU: 25, ESZ: 25, ESH: 25,
  NQM: 100, NQU: 100, NQZ: 100, NQH: 100,
  SPY: 5, QQQ: 5, IWM: 3, SMH: 5,
  AAPL: 5, AMD: 5, AMZN: 5, GOOGL: 5, META: 20, MSFT: 15,
  NVDA: 5, TSLA: 15, COIN: 20, HOOD: 5, NFLX: 25, PLTR: 3,
};

export function strikeIncrement(ticker: string): number {
  return STRIKE_INCREMENT[String(ticker || "").toUpperCase()] ?? 1;
}

export function defaultWing(ticker: string): number {
  const t = String(ticker || "").toUpperCase();
  return DEFAULT_WING[t] ?? strikeIncrement(t) * 5;
}

function roundTo(v: number, step: number, mode: "down" | "up" | "near"): number {
  if (!Number.isFinite(v) || !(step > 0)) return v;
  const q = v / step;
  const n = mode === "down" ? Math.floor(q) : mode === "up" ? Math.ceil(q) : Math.round(q);
  // keep 2dp so 0.01-increment names don't accumulate float dust
  return Math.round(n * step * 100) / 100;
}

/**
 * Derive the four strikes from an EM band.
 *
 * Short strikes are pulled just INSIDE the band (put short rounded DOWN, call
 * short rounded UP) so the sold strikes sit at or outside the expected move —
 * i.e. the condor only loses if price exceeds the EM, which is exactly the stat
 * the EM tracker measures. Longs are one wing beyond, snapped to the increment.
 */
export function deriveLegs(opts: {
  ticker: string;
  down: number;
  up: number;
  wing?: number | null;
}): CondorLegs | null {
  const { ticker, down, up } = opts;
  if (!Number.isFinite(down) || !Number.isFinite(up) || up <= down) return null;
  const inc = strikeIncrement(ticker);
  const wing = Number.isFinite(Number(opts.wing)) && Number(opts.wing) > 0
    ? Number(opts.wing)
    : defaultWing(ticker);

  const put_short = roundTo(down, inc, "down");
  const call_short = roundTo(up, inc, "up");
  const put_long = roundTo(put_short - wing, inc, "down");
  const call_long = roundTo(call_short + wing, inc, "up");
  if (!(put_long < put_short && put_short < call_short && call_short < call_long)) return null;
  return { put_long, put_short, call_short, call_long };
}

// ── Validation ──────────────────────────────────────────────────────────────

/** Structural problems that make a condor un-scoreable. Empty array = valid. */
export function validateLegs(l: LooseLegs): string[] {
  const bad: string[] = [];
  const nums = ["put_long", "put_short", "call_short", "call_long"] as const;
  for (const k of nums) {
    const v = Number(l[k]);
    if (!Number.isFinite(v) || v <= 0) bad.push(`${k} missing`);
  }
  if (bad.length) return bad;
  const { put_long, put_short, call_short, call_long } = l as CondorLegs;
  if (put_long >= put_short) bad.push("long put must be BELOW short put");
  if (call_long <= call_short) bad.push("long call must be ABOVE short call");
  if (put_short >= call_short) bad.push("short put must be BELOW short call");
  return bad;
}

// ── Economics ───────────────────────────────────────────────────────────────

export interface CondorEconomics {
  put_width: number;
  call_width: number;
  net_credit: number;
  /** Dollars, scaled by multiplier AND contracts. */
  max_profit: number;
  max_loss: number;
  /** Credit / widest wing — the classic "% of width collected". */
  credit_pct: number | null;
  /** Return on capital at max profit (credit / (width − credit)). */
  roc: number | null;
  breakeven_low: number;
  breakeven_high: number;
}

/** Net credit, preferring the explicit net if supplied, else put + call legs. */
export function netCredit(c: CondorInput): number {
  const net = Number(c.net_credit);
  if (Number.isFinite(net) && net !== 0) return net;
  const p = Number(c.put_credit), k = Number(c.call_credit);
  const sum = (Number.isFinite(p) ? p : 0) + (Number.isFinite(k) ? k : 0);
  return sum;
}

export function economics(c: CondorInput): CondorEconomics | null {
  if (validateLegs(c).length) return null;
  const { put_long, put_short, call_short, call_long } = c as CondorLegs;
  const mult = Number(c.multiplier) > 0 ? Number(c.multiplier) : 100;
  const qty = Number(c.contracts) > 0 ? Number(c.contracts) : 1;
  const put_width = put_short - put_long;
  const call_width = call_long - call_short;
  const credit = netCredit(c);
  const widest = Math.max(put_width, call_width);
  return {
    put_width,
    call_width,
    net_credit: credit,
    max_profit: credit * mult * qty,
    max_loss: (widest - credit) * mult * qty,
    credit_pct: widest > 0 ? credit / widest : null,
    roc: widest - credit > 0 ? credit / (widest - credit) : null,
    breakeven_low: put_short - credit,
    breakeven_high: call_short + credit,
  };
}

// ── Settlement ──────────────────────────────────────────────────────────────

export type CondorOutcome = "max_win" | "partial_win" | "partial_loss" | "max_loss";

export interface CondorSettlement {
  /** Value you must pay back at expiration, per condor, in strike points. */
  intrinsic: number;
  /** Dollars, net of credit, scaled by contracts × multiplier. */
  pnl: number;
  /** Same as pnl but per single condor — handy for averaging across tickers. */
  pnl_per_condor: number;
  result: "win" | "loss";
  outcome: CondorOutcome;
  /** Which short strike settlement finished beyond, if any. */
  breached_side: "put" | "call" | null;
  /** Distance from settlement to the nearer SHORT strike. + = inside cushion. */
  cushion: number;
}

/**
 * Settle a condor against the expiring underlying print.
 *
 * European cash-settled (SPX/NDX) and American equity condors settle the same
 * way for tracking purposes: only the terminal price matters.
 *   loss = min(put_width,  max(0, put_short  − settle))
 *        + min(call_width, max(0, settle − call_short))
 */
export function settle(c: CondorInput, settlePrice: number): CondorSettlement | null {
  if (validateLegs(c).length) return null;
  if (!Number.isFinite(settlePrice)) return null;
  const { put_long, put_short, call_short, call_long } = c as CondorLegs;
  const mult = Number(c.multiplier) > 0 ? Number(c.multiplier) : 100;
  const qty = Number(c.contracts) > 0 ? Number(c.contracts) : 1;
  const credit = netCredit(c);

  const putLoss = Math.min(put_short - put_long, Math.max(0, put_short - settlePrice));
  const callLoss = Math.min(call_long - call_short, Math.max(0, settlePrice - call_short));
  const intrinsic = putLoss + callLoss;

  const perCondor = (credit - intrinsic) * mult;
  const pnl = perCondor * qty;

  const breached_side = putLoss > 0 ? "put" : callLoss > 0 ? "call" : null;
  const atMaxLoss =
    (putLoss > 0 && putLoss >= put_short - put_long) ||
    (callLoss > 0 && callLoss >= call_long - call_short);

  const outcome: CondorOutcome = intrinsic === 0
    ? "max_win"
    : atMaxLoss
      ? "max_loss"
      : perCondor >= 0
        ? "partial_win"
        : "partial_loss";

  return {
    intrinsic,
    pnl,
    pnl_per_condor: perCondor,
    result: perCondor >= 0 ? "win" : "loss",
    outcome,
    breached_side,
    cushion: Math.min(call_short - settlePrice, settlePrice - put_short),
  };
}

/** Did the week's realized range poke past either SHORT strike at any point?
 *  Uses the weekly high/low the EM tracker already stores. */
export function touchedShort(
  c: LooseLegs, h?: number | null, l?: number | null
): { touched: boolean; side: "put" | "call" | "both" | null } {
  const ps = Number(c.put_short), cs = Number(c.call_short);
  const hi = Number(h), lo = Number(l);
  if (!Number.isFinite(ps) || !Number.isFinite(cs) || !Number.isFinite(hi) || !Number.isFinite(lo)) {
    return { touched: false, side: null };
  }
  const put = lo <= ps;
  const call = hi >= cs;
  return { touched: put || call, side: put && call ? "both" : put ? "put" : call ? "call" : null };
}
