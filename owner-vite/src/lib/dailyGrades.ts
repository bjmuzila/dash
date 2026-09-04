// ─────────────────────────────────────────────────────────────────────────────
// Daily Grades — data contract + derivations for /owner/daily-grades.
//
// THE SHAPE IS THE CONTRACT. A sealed board is one row per ticker:
//
//   { apex, cap, flip, floor, spot, …, scorecard }
//
//   floor — 20th percentile of the cumulative PUT gamma ladder
//   cap   — 80th percentile of the cumulative CALL gamma ladder
//           (server-v2/daily-grades-levels.js owns the math; the payload also
//            carries the moment-matched bell pair for comparison)
//   apex  — CB (the wire name is `apex`; the level is CB and the UI says CB)
//   flip  — gamma flip; spot above it is the calmer regime, below is the choppy one
//   spot  — last price at seal time
//
// floor and cap name the two ends of the GEX board, NOT support and resistance,
// and nothing here assumes floor sits below cap in price — the put mass can sit
// entirely above the call mass. That case is flagged (`cap < floor`) and the
// floor→cap bar goes blank rather than drawing itself backwards.
//
// Any of the four levels may be null (not every board has a flip, and a name
// that hasn't been graded yet has none at all). Everything below is null-safe.
//
// AND THE SEALED READ, since v2: every board also carries a `scorecard` — the
// gamma regime, each wall's quality and overnight stability, the expected move,
// and ONE published call for the session (fade the first test, expect the break,
// or stand down). It is computed once at 09:26 and frozen; nothing on this page
// recomputes any of it, because a call that can move after the open is not a
// call. A board sealed before v2 simply has `scorecard: null` and every consumer
// here treats that as "not scored" rather than as zeros. The math is server-side
// in server-v2/daily-grades-scorecard.js and that file's header is the rubric.
//
// THE ROSTER IS THE WATCHLIST, NOT THE PAYLOAD. The page grades the scanner
// watchlist — the same universe the ΔGEX Board runs over, served by
// GET /proxy/scanner-tickers and read through lib/tickers.ts. A payload is
// matched INTO that roster: a watchlist name with no board shows as "not
// graded" rather than silently vanishing, and a board for a name that isn't on
// the watchlist is off-roster (the page has a scope toggle for it) rather than
// silently appearing. Do not re-key this off `Object.keys(payload.boards)`.
//
// WHERE THE DATA COMES FROM
// -------------------------
// `/proxy/daily-grades` → server-v2/daily-grades-recorder.js. The board is built
// and sealed at 09:26 ET from the settled-OI gamma ladder (`eod_strike_gex`) and
// the last scanner sweep, then graded after the close. `loadGrades()` is the one
// seam: it is the only thing in this file that touches the network, and the
// bundled sample is its fallback for a session with no seal. For a streaming
// spot, feed `applySpots()` from the quote handler — the four levels stay frozen
// at their sealed values and every delta, bar and flag recomputes off spot.
// ─────────────────────────────────────────────────────────────────────────────

/** Which way dealer hedging pressure runs — see the scorecard block below. */
export type DgGammaRegime = "positive" | "negative" | "transition" | "unknown";
/** The one call the seal publishes per ticker. */
export type DgCall = "fade_first_test" | "expect_break" | "low_conviction" | "none";
/** What a level did between yesterday's seal and this one. */
export type DgStability = "held" | "firming" | "chasing" | "drift" | null;

/**
 * One wall, scored at seal time. Every field is 0..1 except the price and the
 * two percentages, and `quality` is the weighted blend of the six that decides
 * how much this level's outcome is allowed to move the grade.
 */
export type DgWallScore = {
  level: number | null;
  gex: number | null;
  dist_pct: number | null;
  /** Standout bar against its ladder. */
  size: number | null;
  /** Isolated peak (1) vs smeared across neighbours (0). */
  conc: number | null;
  /** Distance quality — best in the 0.3–1.0% band. */
  dist: number | null;
  /** Sits inside the expected-move band. */
  em: number | null;
  /** Round-number / index-increment confluence. */
  conf: number | null;
  /** Overnight stability as a score. */
  stab: number | null;
  stability: DgStability;
  drift_pct: number | null;
  shift: "up" | "down" | "flat" | null;
  quality: number | null;
};

/**
 * THE PREMARKET SCORECARD, computed once at 09:26 and frozen into the seal.
 *
 * Regime first, because net GEX sign and spot vs the flip decide how every level
 * under them is expected to behave: in positive gamma dealers hedge AGAINST the
 * move and walls absorb, in negative gamma hedging is pro-cyclical and breaks
 * accelerate, and sitting on the flip is its own answer — chop. Then wall
 * quality, then overnight stability, then one expected-reaction call. The grader
 * scores each level against the table its own regime implies and weights it by
 * `quality`, so a wall nobody could have traded barely counts either way.
 *
 * The math lives in server-v2/daily-grades-scorecard.js. Nothing here recomputes
 * it — a scorecard that could move after the open would not be a sealed call.
 */
export type DgScorecard = {
  /** Rubric version. 2 is the structured scorecard; a seal with none is v1. */
  v: number;
  regime: DgGammaRegime;
  regime_conf: number | null;
  /** Whether the net-GEX sign and the flip side agreed. */
  regime_agree: boolean | null;
  net_gex: number | null;
  flip_dist_pct: number | null;
  /** Expected move for the session, percent of spot. REALIZED, not implied. */
  em_pct: number | null;
  walls: { cap: DgWallScore | null; floor: DgWallScore | null };
  apex: DgWallScore | null;
  flip: { level: number | null; quality: number | null } | null;
  call: DgCall;
  call_side: "cap" | "floor" | null;
  call_conf: number | null;
  /** The sentence the premarket routine ends on. */
  note: string | null;
  /** What the MAP was worth before the session touched it, 0–100. */
  setup: number | null;
  setup_grade: string | null;
};

export type DgBoard = {
  apex: number | null;
  cap: number | null;
  flip: number | null;
  floor: number | null;
  spot: number | null;
  /** v2 additions. All optional — a v1 seal simply has none of them. */
  net_gex?: number | null;
  em_pct?: number | null;
  /** The TRUE peaks from the scanner sweep, alongside (not instead of) the
   *  percentile cap/floor. Two readings of the same board; the page shows both. */
  call_wall?: number | null;
  put_wall?: number | null;
  call_wall_gex?: number | null;
  put_wall_gex?: number | null;
  cb_gex?: number | null;
  /** The seal the overnight-stability read compared against. */
  prev_session?: string | null;
  scorecard?: DgScorecard | null;
};

export type DgPayload = {
  boards: Record<string, DgBoard>;
  /** Free-text provenance note carried with the seal. */
  note?: string | null;
  /** ISO timestamp the board was sealed. */
  sealed_at?: string | null;
  /** Session the board is good for, YYYY-MM-DD. */
  sealed_for_session?: string | null;
};

/** Where the payload on screen came from — drives the badge in the header. */
export type DgSource = "live" | "sample" | "import";

export type DgRegime = "above" | "below" | "none";
export type DgFlagKind = "near" | "breach" | "inverted" | "ungraded" | "offroster";
export type DgFlag = { kind: DgFlagKind; label: string };

/**
 * A row on the Levels board.
 *
 * `regime` here is the FLIP SIDE — where spot sits relative to the gamma flip —
 * and it is deliberately not the same field as `scorecard.regime`, which is the
 * full gamma-regime read (sign AND side, with "transition" for the cases where
 * those two disagree or price is sitting on the flip). Both are on screen; a row
 * whose flip side says "above" while the scorecard says "transition" is exactly
 * the disagreement worth seeing.
 */
export type DgRow = DgBoard & {
  ticker: string;
  /** Percent move from spot to each level. Positive = the level sits above spot. */
  dFloor: number | null;
  dCap: number | null;
  dFlip: number | null;
  dApex: number | null;
  regime: DgRegime;
  /** 0..1 position of spot inside the floor→cap band; null when the band is unusable. */
  pos: number | null;
  /** 0..1 position of flip inside the same band. */
  flipPos: number | null;
  flags: DgFlag[];
  near: boolean;
  breach: boolean;
  /** On the watchlist but the seal carries no board for it. */
  ungraded: boolean;
  /** Has a board but isn't on the watchlist. */
  offRoster: boolean;
};

export type DgSummary = {
  total: number;
  graded: number;
  ungraded: number;
  above: number;
  below: number;
  noFlip: number;
  near: number;
  breach: number;
  // ── v2 ────────────────────────────────────────────────────────────────────
  /** Gamma regime across the roster — the FIRST thing a premarket read wants. */
  posGamma: number;
  negGamma: number;
  chopGamma: number;
  /** How the board is calling the session. */
  fades: number;
  breaks: number;
  standDowns: number;
  /** Walls that moved with price overnight — the weakest fades on the board. */
  chasing: number;
  /** Mean seal-time setup score across the scored names. */
  setup: number | null;
};

// ── the graded half ──────────────────────────────────────────────────────────
//
// These mirror `daily_grades` / `daily_grade_days` column-for-column, snake_case
// included, because they are handed straight through from Postgres and renaming
// them here would only hide where they came from. Everything is nullable: a row
// exists for every sealed ticker, graded or not.

/**
 * Per-level outcome strings the recorder writes.
 *
 * The wall vocabulary is THREE tables, one per regime, because the same event
 * means different things under different hedging pressure: a wall reached and
 * rejected is `tagged_held` in positive gamma (the model working), `absorbed` in
 * negative gamma (a real level, wrong mechanism) and `chop_held` on the flip.
 * The names stay distinct so the record says which table scored it.
 */
export type DgOutcome =
  // walls, positive gamma — and the v1 fallback for a seal with no scorecard
  | "tagged_held" | "untested_held" | "tagged_broke" | "gapped_through"
  // walls, negative gamma
  | "broke_accelerated" | "gapped_ran" | "absorbed" | "broke_reverted" | "untested_quiet"
  // walls, sitting on the flip
  | "chop_held" | "chop_broke" | "chop_gapped"
  // flip
  | "held_clean" | "held_after_test" | "flipped"
  // CB
  | "pinned" | "close" | "near" | "loose" | "far"
  // range
  | "contained" | "one_side_out" | "both_out"
  // the regime read itself
  | "regime_held" | "regime_partial" | "regime_failed"
  // the published call
  | "call_hit" | "call_partial" | "call_untested" | "call_missed";

export type DgStatus = "graded" | "no_candles" | "no_levels";

export type DgGradeRow = {
  symbol: string;
  sealed_spot: number | null;
  floor_lvl: number | null;
  cap_lvl: number | null;
  apex_lvl: number | null;
  flip_lvl: number | null;
  o: number | null;
  h: number | null;
  l: number | null;
  c: number | null;
  bars: number | null;
  cap_outcome: DgOutcome | null;
  floor_outcome: DgOutcome | null;
  flip_outcome: DgOutcome | null;
  apex_outcome: DgOutcome | null;
  range_outcome: DgOutcome | null;
  cap_pts: number | null;
  floor_pts: number | null;
  flip_pts: number | null;
  apex_pts: number | null;
  range_pts: number | null;
  pts: number | null;
  max_pts: number | null;
  score: number | null;
  grade: string | null;
  reached_cap: boolean | null;
  reached_floor: boolean | null;
  reached_apex: boolean | null;
  crossed_flip: boolean | null;
  status: DgStatus;
  graded_at: string | null;
  // ── v2 ────────────────────────────────────────────────────────────────────
  // Nullable throughout: a row graded before the scorecard existed carries none
  // of it, and the page renders those cells as "—" rather than as a zero.
  /** The whole seal-time read, as it was frozen. A regrade re-scores off THIS. */
  scorecard: DgScorecard | null;
  regime: DgGammaRegime | null;
  regime_conf: number | null;
  regime_outcome: DgOutcome | null;
  regime_pts: number | null;
  reaction_call: DgCall | null;
  reaction_outcome: DgOutcome | null;
  reaction_pts: number | null;
  /** What the map was worth before the session, 0–100, and its letter. */
  setup_score: number | null;
  setup_grade: string | null;
  em_pct: number | null;
  cap_quality: number | null;
  floor_quality: number | null;
  /** Which rubric scored this row — 1 or 2. */
  rubric: number | null;
};

export type DgDay = {
  tickers: number | null;
  graded: number | null;
  ungraded: number | null;
  pts: number | null;
  max_pts: number | null;
  score: number | null;
  grade: string | null;
  a_plus: number | null;
  a: number | null;
  b: number | null;
  c: number | null;
  d: number | null;
  f: number | null;
  cap_tested: number | null;
  cap_held: number | null;
  floor_tested: number | null;
  floor_held: number | null;
  flip_held: number | null;
  apex_pinned: number | null;
  range_contained: number | null;
  graded_at: string | null;
  // ── v2 ────────────────────────────────────────────────────────────────────
  /** Mean seal-time setup score across the names that HAVE one. */
  setup_score: number | null;
  /** How many tickers behaved the way their regime said they would. */
  regime_held: number | null;
  /** How many published calls actually happened. */
  reaction_hit: number | null;
  pos_regime: number | null;
  neg_regime: number | null;
  chop_regime: number | null;
};

/** A level is "near" once spot is within this much of it, in percent. */
export const NEAR_PCT = 1.0;

const EMPTY_BOARD: DgBoard = { apex: null, cap: null, flip: null, floor: null, spot: null };

// ── derivations ──────────────────────────────────────────────────────────────

function pctTo(spot: number | null, level: number | null): number | null {
  if (spot == null || level == null || !isFinite(spot) || spot === 0) return null;
  return ((level - spot) / spot) * 100;
}

export function deriveRow(
  ticker: string,
  b: DgBoard,
  opts: { ungraded?: boolean; offRoster?: boolean } = {},
): DgRow {
  const { spot, apex, cap, floor, flip } = b;

  const dFloor = pctTo(spot, floor);
  const dCap = pctTo(spot, cap);
  const dFlip = pctTo(spot, flip);
  const dApex = pctTo(spot, apex);

  const regime: DgRegime =
    flip == null || spot == null ? "none" : spot > flip ? "above" : "below";

  // The band only means anything when cap actually sits above floor.
  const bandOk = floor != null && cap != null && cap > floor && spot != null;
  const pos = bandOk ? (spot - floor) / (cap - floor) : null;
  const flipPos = bandOk && flip != null ? (flip - floor) / (cap - floor) : null;

  const noLevels = apex == null && cap == null && floor == null && flip == null;
  const ungraded = !!opts.ungraded || noLevels;
  const offRoster = !!opts.offRoster;

  const flags: DgFlag[] = [];
  if (ungraded) flags.push({ kind: "ungraded", label: "not graded" });
  if (offRoster) flags.push({ kind: "offroster", label: "off roster" });
  if (floor != null && cap != null && cap < floor) {
    flags.push({ kind: "inverted", label: "cap < floor" });
  }
  if (spot != null) {
    if (floor != null && spot < floor) flags.push({ kind: "breach", label: "below floor" });
    if (cap != null && spot > cap) flags.push({ kind: "breach", label: "above cap" });
  }
  const nearNames: string[] = [];
  if (dFloor != null && Math.abs(dFloor) <= NEAR_PCT) nearNames.push("floor");
  if (dCap != null && Math.abs(dCap) <= NEAR_PCT) nearNames.push("cap");
  if (dFlip != null && Math.abs(dFlip) <= NEAR_PCT) nearNames.push("flip");
  if (nearNames.length) flags.push({ kind: "near", label: `at ${nearNames.join("/")}` });

  return {
    // Spread the board first so every v2 field it carries — the scorecard, the
    // true walls, the expected move — reaches the row instead of being dropped
    // by a hand-written field list that predates them.
    ...b,
    ticker,
    apex, cap, flip, floor, spot,
    dFloor, dCap, dFlip, dApex,
    regime,
    pos,
    flipPos,
    flags,
    near: nearNames.length > 0,
    breach: flags.some((f) => f.kind === "breach"),
    ungraded,
    offRoster,
  };
}

/**
 * Build the board.
 *
 * `roster` is the watchlist and it drives the row set: every name on it gets a
 * row whether or not the seal graded it. Pass `includeOffRoster` to also append
 * graded names the watchlist doesn't carry. Pass a null roster to fall back to
 * "whatever the payload holds" (used while the universe is still loading).
 */
export function deriveRows(
  payload: DgPayload | null,
  roster: string[] | null,
  includeOffRoster = false,
): DgRow[] {
  const boards = payload?.boards ?? {};

  if (!roster || !roster.length) {
    return Object.keys(boards).sort().map((t) => deriveRow(t, boards[t]));
  }

  const onRoster = new Set(roster.map((t) => t.toUpperCase()));
  const rows = [...onRoster].sort().map((t) =>
    deriveRow(t, boards[t] ?? EMPTY_BOARD, { ungraded: !boards[t] }),
  );

  if (includeOffRoster) {
    const extra = Object.keys(boards).filter((t) => !onRoster.has(t)).sort();
    rows.push(...extra.map((t) => deriveRow(t, boards[t], { offRoster: true })));
  }
  return rows;
}

export function summarize(rows: DgRow[]): DgSummary {
  const sc = (r: DgRow) => r.scorecard ?? null;
  const setups = rows
    .map((r) => sc(r)?.setup)
    .filter((v): v is number => typeof v === "number" && isFinite(v));
  return {
    total: rows.length,
    graded: rows.filter((r) => !r.ungraded).length,
    ungraded: rows.filter((r) => r.ungraded).length,
    above: rows.filter((r) => r.regime === "above").length,
    below: rows.filter((r) => r.regime === "below").length,
    noFlip: rows.filter((r) => r.regime === "none" && !r.ungraded).length,
    near: rows.filter((r) => r.near).length,
    breach: rows.filter((r) => r.breach).length,
    posGamma: rows.filter((r) => sc(r)?.regime === "positive").length,
    negGamma: rows.filter((r) => sc(r)?.regime === "negative").length,
    chopGamma: rows.filter((r) => sc(r)?.regime === "transition").length,
    fades: rows.filter((r) => sc(r)?.call === "fade_first_test").length,
    breaks: rows.filter((r) => sc(r)?.call === "expect_break").length,
    standDowns: rows.filter((r) => sc(r)?.call === "low_conviction").length,
    chasing: rows.filter((r) => {
      const s = sc(r);
      return s?.walls?.cap?.stability === "chasing" || s?.walls?.floor?.stability === "chasing";
    }).length,
    // Mean over the names that HAVE a setup score. A v1 board has none, and an
    // unscored map is not a zero-quality map.
    setup: setups.length
      ? Number((setups.reduce((a, b) => a + b, 0) / setups.length).toFixed(1))
      : null,
  };
}

/**
 * Overlay live spots onto a sealed board without touching the levels.
 * This is the hook the TT / dxLink quote stream plugs into: the four levels stay
 * frozen at their sealed values, `spot` moves, and every Δ / bar / flag above
 * recomputes off it.
 */
export function applySpots(
  payload: DgPayload,
  spots: Record<string, number | null | undefined>,
): DgPayload {
  const boards: Record<string, DgBoard> = {};
  for (const [t, b] of Object.entries(payload.boards)) {
    const live = spots[t];
    boards[t] = live == null || !isFinite(live) ? b : { ...b, spot: live };
  }
  return { ...payload, boards };
}

// ── formatting ───────────────────────────────────────────────────────────────

/** Price: thousands separators, at most 2 decimals, trailing zeros trimmed. */
export function fmtPrice(v: number | null): string {
  if (v == null || !isFinite(v)) return "—";
  let s = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (s.endsWith(".00")) s = s.slice(0, -3);
  else if (s.endsWith("0")) s = s.slice(0, -1);
  return s;
}

/** Signed percent, 2dp. */
export function fmtPct(v: number | null): string {
  if (v == null || !isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/** A 0..1 quality as a percent with no decimals: 0.82 → "82". */
export function fmtQuality(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return String(Math.round(v * 100));
}

/** Net GEX, abbreviated and signed: 4.2e9 → "+4.2B". */
export function fmtGex(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  const [d, unit] = a >= 1e12 ? [a / 1e12, "T"]
    : a >= 1e9 ? [a / 1e9, "B"]
      : a >= 1e6 ? [a / 1e6, "M"]
        : a >= 1e3 ? [a / 1e3, "K"] : [a, ""];
  return `${v < 0 ? "−" : "+"}${d.toFixed(d >= 100 ? 0 : 1)}${unit}`;
}

/** Unsigned percent, 2dp — for the expected move and other magnitudes. */
export function fmtPctAbs(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return `${Math.abs(v).toFixed(2)}%`;
}

/** "Aug 25, 2026, 5:12:01 AM ET" for the seal stamp. */
export function fmtSealed(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit",
    timeZone: "America/New_York",
  })} ET`;
}

// ── validation / parsing ─────────────────────────────────────────────────────

const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && isFinite(v) ? v : null;

/**
 * Coerce anything claiming to be a sealed board into a DgPayload.
 * Throws with a readable message rather than rendering half a board.
 */
export function parsePayload(raw: unknown): DgPayload {
  if (!raw || typeof raw !== "object") throw new Error("Not a JSON object.");
  const o = raw as Record<string, unknown>;
  const boardsIn = o.boards;
  if (!boardsIn || typeof boardsIn !== "object") {
    throw new Error('Missing a "boards" object.');
  }
  const boards: Record<string, DgBoard> = {};
  for (const [t, v] of Object.entries(boardsIn as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const b = v as Record<string, unknown>;
    boards[t.toUpperCase()] = {
      // Carry the whole board through, then coerce the five levels the contract
      // says are numeric. A pasted v2 board keeps its scorecard; a v1 one simply
      // has nothing extra to keep.
      ...(b as object),
      apex: numOrNull(b.apex),
      cap: numOrNull(b.cap),
      flip: numOrNull(b.flip),
      floor: numOrNull(b.floor),
      spot: numOrNull(b.spot),
    };
  }
  if (!Object.keys(boards).length) throw new Error('"boards" has no tickers.');
  return {
    boards,
    note: typeof o.note === "string" ? o.note : null,
    sealed_at: typeof o.sealed_at === "string" ? o.sealed_at : null,
    sealed_for_session: typeof o.sealed_for_session === "string" ? o.sealed_for_session : null,
  };
}

// ── the one live seam ────────────────────────────────────────────────────────

/**
 * Endpoint the page probes for a sealed board — served by
 * server-v2/daily-grades-recorder.js via `/proxy/daily-grades` in
 * server-with-proxy.js. `?date=YYYY-MM-DD` picks a past session; no date is the
 * most recent seal. The response also carries `grades` (one row per ticker) and
 * `day` (the summed session), which this page ignores for now — the shape below
 * only reads what it renders.
 */
export const DG_ENDPOINT = "/proxy/daily-grades";

/**
 * Load the board for the page.
 *
 * Order: real endpoint first, bundled sample second. The sample keeps the
 * template renderable while the TT / dxLink feed is being built — swap this
 * body (or just delete the fallback) once the endpoint is live.
 */
export async function loadGrades(): Promise<{
  payload: DgPayload;
  source: DgSource;
  grades: DgGradeRow[];
  day: DgDay | null;
}> {
  try {
    const r = await fetch(DG_ENDPOINT, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      return {
        payload: parsePayload(j),
        source: "live",
        // The grades ride along with the seal. They are absent until the
        // session closes and the 16:20 run writes them, which is a normal
        // state for most of the day — not an error, just an empty tab.
        grades: Array.isArray(j?.grades) ? (j.grades as DgGradeRow[]) : [],
        day: (j?.day as DgDay | null) ?? null,
      };
    }
  } catch {
    /* endpoint not up yet — fall through to the sample */
  }
  const { SAMPLE_PAYLOAD } = await import("../pages/daily-grades/sample");
  return { payload: SAMPLE_PAYLOAD, source: "sample", grades: [], day: null };
}

// ── history ──────────────────────────────────────────────────────────────────
//
// The grades have always been stored per session — `daily_grades` keyed on
// (date, symbol), `daily_grade_days` on date — so the back catalogue was there
// long before anything read it. These are the two read paths: one ticker across
// sessions, and the running day table.
//
// Neither has a sample fallback, deliberately. A history that can't be served is
// an empty history and says so on screen; bundling a placeholder here would put
// invented sessions in a table whose whole job is to be the record.

/** One session of one ticker: its grade row plus how the whole board did that day. */
export type DgHistoryRow = DgGradeRow & {
  date: string;
  day_score: number | null;
  day_grade: string | null;
};

export type DgHistorySummary = {
  sessions: number;
  graded: number;
  ungraded: number;
  pts: number;
  max_pts: number;
  /** Summed points ÷ summed points-available × 100 — not the mean of the rows. */
  score: number | null;
  grade: string | null;
  best: number | null;
  worst: number | null;
  counts: Record<string, number>;
};

export type DgTickerHistory = {
  symbol: string;
  days: number;
  rows: DgHistoryRow[];
  summary: DgHistorySummary;
};

/** One graded session, board-wide — the day roll-up with the date it belongs to. */
export type DgDayRow = DgDay & { date: string };

export type DgDayHistory = {
  days: number;
  rows: DgDayRow[];
  summary: Omit<DgHistorySummary, "graded" | "ungraded" | "counts">;
};

export const DG_HISTORY_ENDPOINT = "/proxy/daily-grades-history";
export const DG_DAYS_ENDPOINT = "/proxy/daily-grades-days";

const emptyTickerHistory = (symbol: string): DgTickerHistory => ({
  symbol,
  days: 0,
  rows: [],
  summary: {
    sessions: 0, graded: 0, ungraded: 0, pts: 0, max_pts: 0,
    score: null, grade: null, best: null, worst: null, counts: {},
  },
});

/** Every stored session for one ticker, newest first. Ungraded sessions included. */
export async function loadTickerHistory(
  symbol: string,
  days = 60,
): Promise<DgTickerHistory> {
  const sym = symbol.trim().toUpperCase();
  const r = await fetch(
    `${DG_HISTORY_ENDPOINT}?symbol=${encodeURIComponent(sym)}&days=${days}`,
    { cache: "no-store" },
  );
  // 404 is "no database / nothing recorded" — an empty history, not a failure.
  if (r.status === 404) return emptyTickerHistory(sym);
  if (!r.ok) throw new Error(`History unavailable (${r.status}).`);
  const j = await r.json();
  if (!j || !Array.isArray(j.rows)) throw new Error("Malformed history payload.");
  return { ...emptyTickerHistory(sym), ...j } as DgTickerHistory;
}

/** The running day table — one row per graded session, newest first. */
export async function loadDayHistory(days = 90): Promise<DgDayHistory> {
  const empty: DgDayHistory = {
    days: 0,
    rows: [],
    summary: { sessions: 0, pts: 0, max_pts: 0, score: null, grade: null, best: null, worst: null },
  };
  const r = await fetch(`${DG_DAYS_ENDPOINT}?days=${days}`, { cache: "no-store" });
  if (r.status === 404) return empty;
  if (!r.ok) throw new Error(`Session history unavailable (${r.status}).`);
  const j = await r.json();
  if (!j || !Array.isArray(j.rows)) throw new Error("Malformed session history payload.");
  return { ...empty, ...j } as DgDayHistory;
}

/**
 * "Aug 25" for this year, "Aug 25 '25" for any other. Parsed as UTC on purpose:
 * the string is already an ET session date and must not be shifted by the
 * viewer's zone.
 */
export function fmtDay(date: string | null | undefined): string {
  if (!date) return "—";
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return String(date);
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
  return y === new Date().getUTCFullYear() ? label : `${label} '${String(y).slice(2)}`;
}

/** Weekday for a session date — "Mon". Same UTC-parse reasoning as fmtDay. */
export function fmtWeekday(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short", timeZone: "UTC",
  });
}
