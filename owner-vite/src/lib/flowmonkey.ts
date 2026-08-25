// ─────────────────────────────────────────────────────────────────────────────
// FlowMonkey levels — data contract + derivations for /owner/flowmonkey.
//
// THE SHAPE IS THE CONTRACT. A sealed FlowMonkey board is one row per ticker:
//
//   { apex, cap, flip, floor, spot }
//
//   floor — lower level on the board (support / put wall)
//   cap   — upper level (resistance / call wall)
//   apex  — the single biggest level on the board
//   flip  — gamma flip; spot above it is the calmer regime, below is the choppy one
//   spot  — last price at seal time
//
// Any of the four levels may be null (not every board has a flip, and a fresh
// roster entry can have none at all). Everything below is null-safe.
//
// WHERE THE DATA COMES FROM
// -------------------------
// Today this reads a sealed JSON payload. The page is the template; the live
// wiring lands later and there is exactly ONE seam for it: `loadLevels()`.
// When TT / dxLink is ready, `spot` becomes a streaming quote and the four
// levels come off the levels engine — swap the body of `loadLevels()` (and,
// for streaming spot, feed `applySpots()` from the quote handler). Nothing in
// the page component needs to change: it renders whatever `FmPayload` it gets.
// ─────────────────────────────────────────────────────────────────────────────

export type FmBoard = {
  apex: number | null;
  cap: number | null;
  flip: number | null;
  floor: number | null;
  spot: number | null;
};

export type FmPayload = {
  boards: Record<string, FmBoard>;
  /** Free-text provenance note carried with the seal. */
  note?: string | null;
  /** ISO timestamp the board was sealed. */
  sealed_at?: string | null;
  /** Session the board is good for, YYYY-MM-DD. */
  sealed_for_session?: string | null;
};

/** Where the payload on screen came from — drives the badge in the header. */
export type FmSource = "live" | "sample" | "import";

export type FmRegime = "above" | "below" | "none";
export type FmFlagKind = "near" | "breach" | "inverted" | "nodata";
export type FmFlag = { kind: FmFlagKind; label: string };

export type FmRow = FmBoard & {
  ticker: string;
  /** Percent move from spot to each level. Positive = the level sits above spot. */
  dFloor: number | null;
  dCap: number | null;
  dFlip: number | null;
  dApex: number | null;
  regime: FmRegime;
  /** 0..1 position of spot inside the floor→cap band; null when the band is unusable. */
  pos: number | null;
  /** 0..1 position of flip inside the same band. */
  flipPos: number | null;
  flags: FmFlag[];
  near: boolean;
  breach: boolean;
};

export type FmSummary = {
  total: number;
  above: number;
  below: number;
  noFlip: number;
  near: number;
  breach: number;
};

/** A level is "near" once spot is within this much of it, in percent. */
export const NEAR_PCT = 1.0;

// ── derivations ──────────────────────────────────────────────────────────────

function pctTo(spot: number | null, level: number | null): number | null {
  if (spot == null || level == null || !isFinite(spot) || spot === 0) return null;
  return ((level - spot) / spot) * 100;
}

export function deriveRow(ticker: string, b: FmBoard): FmRow {
  const { spot, apex, cap, floor, flip } = b;

  const dFloor = pctTo(spot, floor);
  const dCap = pctTo(spot, cap);
  const dFlip = pctTo(spot, flip);
  const dApex = pctTo(spot, apex);

  const regime: FmRegime =
    flip == null || spot == null ? "none" : spot > flip ? "above" : "below";

  // The band only means anything when cap actually sits above floor.
  const bandOk = floor != null && cap != null && cap > floor && spot != null;
  const pos = bandOk ? (spot! - floor!) / (cap! - floor!) : null;
  const flipPos = bandOk && flip != null ? (flip - floor!) / (cap! - floor!) : null;

  const flags: FmFlag[] = [];
  if (apex == null && cap == null && floor == null && flip == null) {
    flags.push({ kind: "nodata", label: "no levels" });
  }
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
  };
}

export function deriveRows(payload: FmPayload | null): FmRow[] {
  if (!payload?.boards) return [];
  return Object.keys(payload.boards)
    .sort()
    .map((t) => deriveRow(t, payload.boards[t]));
}

export function summarize(rows: FmRow[]): FmSummary {
  return {
    total: rows.length,
    above: rows.filter((r) => r.regime === "above").length,
    below: rows.filter((r) => r.regime === "below").length,
    noFlip: rows.filter((r) => r.regime === "none").length,
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
  payload: FmPayload,
  spots: Record<string, number | null | undefined>,
): FmPayload {
  const boards: Record<string, FmBoard> = {};
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

/** "Aug 25, 2026 · 5:12:01 AM ET" for the seal stamp. */
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
 * Coerce anything claiming to be a FlowMonkey seal into a FmPayload.
 * Throws with a readable message rather than rendering half a board.
 */
export function parsePayload(raw: unknown): FmPayload {
  if (!raw || typeof raw !== "object") throw new Error("Not a JSON object.");
  const o = raw as Record<string, unknown>;
  const boardsIn = o.boards;
  if (!boardsIn || typeof boardsIn !== "object") {
    throw new Error('Missing a "boards" object.');
  }
  const boards: Record<string, FmBoard> = {};
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

/** Endpoint the page probes for a sealed board. Not wired server-side yet. */
export const FM_ENDPOINT = "/api/flowmonkey/levels";

/**
 * Load the board for the page.
 *
 * Order: real endpoint first, bundled sample second. The sample keeps the
 * template renderable while the TT / dxLink feed is being built — swap this
 * body (or just delete the fallback) once the endpoint is live.
 */
export async function loadLevels(): Promise<{ payload: FmPayload; source: FmSource }> {
  try {
    const r = await fetch(FM_ENDPOINT, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      return { payload: parsePayload(j), source: "live" };
    }
  } catch {
    /* endpoint not up yet — fall through to the sample */
  }
  const { SAMPLE_PAYLOAD } = await import("../pages/flowmonkey/sample");
  return { payload: SAMPLE_PAYLOAD, source: "sample" };
}
