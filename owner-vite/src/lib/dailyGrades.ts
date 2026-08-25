// ─────────────────────────────────────────────────────────────────────────────
// Daily Grades — data contract + derivations for /owner/daily-grades.
//
// THE SHAPE IS THE CONTRACT. A sealed board is one row per ticker:
//
//   { apex, cap, flip, floor, spot }
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

export type DgBoard = {
  apex: number | null;
  cap: number | null;
  flip: number | null;
  floor: number | null;
  spot: number | null;
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
};

// ── the graded half ──────────────────────────────────────────────────────────
//
// These mirror `daily_grades` / `daily_grade_days` column-for-column, snake_case
// included, because they are handed straight through from Postgres and renaming
// them here would only hide where they came from. Everything is nullable: a row
// exists for every sealed ticker, graded or not.

/** Per-level outcome strings the recorder writes. */
export type DgOutcome =
  | "tagged_held" | "untested_held" | "tagged_broke" | "gapped_through"
  | "held_clean" | "held_after_test" | "flipped"
  | "pinned" | "close" | "near" | "loose" | "far"
  | "contained" | "one_side_out" | "both_out";

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
  return {
    total: rows.length,
    graded: rows.filter((r) => !r.ungraded).length,
    ungraded: rows.filter((r) => r.ungraded).length,
    above: rows.filter((r) => r.regime === "above").length,
    below: rows.filter((r) => r.regime === "below").length,
    noFlip: rows.filter((r) => r.regime === "none" && !r.ungraded).length,
    near: rows.filter((r) => r.near).length,
    breach: rows.filter((r) => r.breach).length,
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
