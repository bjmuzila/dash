"use client";

/**
 * Per-card persistence for the ES Candles page.
 *
 * The page used to be one chart, so its settings lived in module-level keys:
 * `es-candles-symbol-v1` and the `es-candles-bubble-cfg-v1` blob. With three
 * independent cards on screen those become a shared mutable global — card 3
 * picks SPY and cards 1 and 2 forget what they were showing on the next reload.
 *
 * So each card owns ONE namespaced blob, `es-candles-slot-v2:{slot}`. Two things
 * stay global on purpose:
 *   • `es-candles-fav-symbols-v1` (see symbols.tsx) — a watchlist, not a view.
 *   • `es-candles-bubble-default-v1` — the default you deliberately PINNED.
 *     Reset in any card restores that one preset; it would be strange for
 *     "Save default" in card 2 to leave card 1 on the factory values.
 *
 * Every read is a read-modify-write merge, never a bare setItem. A blind write
 * drops whichever keys the caller didn't know about — that is exactly how the
 * old slider write used to clobber the saved `mins`.
 *
 * NOTHING here may run during render. `window.localStorage` on the server is a
 * ReferenceError and a localStorage read during the first client render is a
 * hydration mismatch — the /es-candles route is still server-rendered by Next
 * before the Vite SPA takes over. Call these from an effect.
 */

// ── Bubble style ─────────────────────────────────────────────────────────────
// This used to be a seven-slider config blob (Top / Highlight / Contrast / Size
// / Max / Curve / Brightness) persisted per card. Five of the seven are GONE —
// see CHANGELOG 2026-08-16. They existed because the size scale was
// self-normalising and therefore never looked right two days running, so the
// numbers had to be hand-tuned to whatever was on screen. The scale is absolute
// now (a time-of-day detrended session reference, `gexTodScale` in chartMath),
// which is the thing they were compensating for.
//
// The test for whether a control belongs here: is it a QUESTION or a
// CORRECTION? Contrast / Size / Max / Curve / Brightness were all corrections —
// you moved them because the chart was wrong, and a chart that needs five knobs
// to look right is just wrong five ways. "How many levels" and "how loud" are
// questions, they have no correct answer, and they stay — along with "how big",
// which is a question about how much of the chart the marks may take rather than
// a patch on a broken scale (BUBBLE_LEVELS_RANGE / BUBBLE_INTENSITY_RANGE /
// BUBBLE_SIZE_RANGE below).
//
// Everything else is a frozen style, calibrated once against real data rather
// than nudged by feel. Source: `gex_strike_history.csv` — 1.25M per-strike $SPX
// rows over the six sessions 2026-07-10 … 2026-07-17.
//
// ── The design laws these obey ──────────────────────────────────────────────
// Bullflow, SpotGamma and the SPY GEX overlay were put side by side, and they
// agree on things this chart had been fighting:
//
//   • FEW LEVELS by default. Three to six rows; the sparsity is the design, and
//     it is what the "levels" control opens at. It goes to 15 for a board read.
//   • EVERY LEVEL IS A FULL ROW across the session. The row IS the level.
//   • COLOUR AND GLOW mark the dominant level; they never touch its radius.
//
// One law from that list has been walked back deliberately: "size is the junior
// channel, sizes differ only mildly." That was read off platforms whose marks are
// a fixed size, and following it here produced five rows a pixel apart that no
// one could rank by eye. Size is a PRIMARY channel on this chart and it is
// proportional — see the size law below.
// ── The size law ────────────────────────────────────────────────────────────
//     budget = size × min(maxPx, rowPitch × maxPxRowFrac, colPitch × maxPxColFrac)
//     r      = budget × (|net GEX| / reference)
//
// STRAIGHT PROPORTIONAL. Twice the gamma is twice the radius, four times the
// area. No exponent, no log, nothing to interpret — the mark is the number.
//
// It was briefly a log scale with an exponent on top, on the theory that gamma
// spans four orders of magnitude across a chain and a linear scale would hand
// the whole pixel budget to the peak. That is true of the WHOLE chain and false
// of what is drawn: only the top five strikes render, and those sit within about
// 2.3x of each other. Log compressed that 2.3x into a 1.5x spread in pixels and
// every row looked the same, which was the complaint. On the straight mapping
// the top strike runs a median 1.9x the third and 2.4x the fifth — which is what
// their gamma actually is.
export type BubbleStyle = {
  /**
   * DEFAULT number of strikes drawn per column, ranked by peak |GEX| so far.
   * This one is a live control again (Overlays → Bubbles → "levels") because it
   * is a question about how much of the board you want to see, not a correction
   * to a scale that was coming out wrong — which is what every retired slider
   * was. See BUBBLE_LEVELS_RANGE.
   */
  topStrikes: number;
  /** How many of those render as walls — white-hot with a glow. Colour only. */
  highlight: number;
  /** Radius in px of a strike sitting AT the session reference. */
  maxPx: number;
  /**
   * Ceiling on `maxPx` as a fraction of the STRIKE PITCH in px.
   *
   * Rows sit at fixed prices, so on a zoomed-out chart the strikes can be a few
   * pixels apart and a 20px mark would swallow its neighbours. This scales the
   * whole ladder down with the available room instead — the RATIOS between the
   * ranks, which are the actual encoding, are untouched. At 0.42 two full-size
   * neighbours still clear each other by ~16% of the pitch.
   *
   * Note this is the ONLY thing bounding the mark vertically now. The old hard
   * clip at half the strike pitch was applied AFTER the size was computed, so
   * the top of the ladder sat on the clip and the encoding was silently thrown
   * away — the same bug in two places, and the reason every rework of the size
   * curve was invisible.
   */
  maxPxRowFrac: number;
  /**
   * Ceiling on `maxPx` as a fraction of the COLUMN pitch in px — the distance
   * between two adjacent bubble columns.
   *
   * MARKS MUST NEVER TOUCH, horizontally or vertically. At 0.45 two full-size
   * neighbours in a row are separated by 10% of the pitch.
   *
   * This is why the column decimation could be deleted. The old code kept one
   * bubble per N columns so a full-size mark would always have room; that made
   * the bucket picker lie ("1m" drew a bubble every third minute). Bounding the
   * BUDGET instead keeps one mark per bucket exactly as the picker says, and
   * scales the whole ladder — every rank together, ratios intact — down to
   * whatever room the current zoom actually has. Zoom in and the marks grow.
   */
  maxPxColFrac: number;
  /** Hard floor so a wing strike stays a visible speck instead of vanishing. */
  minPx: number;
  /**
   * Floor (px) under the COLUMN-pitch term of the size budget.
   *
   * Horizontal overlap is allowed by design — a fused row is a thick tube and
   * thickness is exactly what the size law encodes — so the column pitch is a
   * taste bound, not a correctness one. Only the ROW pitch is a guarantee (two
   * rows must never merge into one band).
   *
   * Without this floor the column term still strangled everything: at a
   * 1-minute bucket adjacent columns can be 2-3px apart, so `colPitch * 0.45`
   * drove the whole budget under a pixel and the marks vanished no matter what
   * the size slider said. The floor is inert whenever there is real room
   * (colPitch beyond ~15px) and only bites where the grid is too dense to
   * respect anyway.
   */
  colBoundFloorPx: number;
  /**
   * The highlighted wall's glow, as a multiple of its own radius (blur px).
   * Tapers to `glowMinFactor` at the last highlighted rank. Proportional rather
   * than a fixed 24px, which at small marks was a bloom several times the size
   * of the thing it was highlighting and fused a row into one lit bar.
   */
  glowTopFactor: number;
  glowMinFactor: number;
  /** Absolute cap on that blur, px. */
  glowMaxPx: number;
  /** Opacity gradient steepness, 0..1. The weakest row fades to 1 − this. */
  fade: number;
  /** DEFAULT overall opacity multiplier — the "intensity" control. */
  intensity: number;
  /** DEFAULT multiplier on the whole size budget — the "size" control. */
  size: number;
};

export const BUBBLE_STYLE: BubbleStyle = {
  topStrikes: 5,
  highlight: 1,
  maxPx: 20,
  maxPxRowFrac: 0.42,
  maxPxColFrac: 0.45,
  colBoundFloorPx: 7,
  minPx: 0.8,
  glowTopFactor: 0.75,
  glowMinFactor: 0.35,
  glowMaxPx: 9,
  fade: 0.55,
  intensity: 1,
  size: 1,
};

/**
 * The three bubble controls that ARE live, and their bounds.
 *
 * Everything else about the layer is frozen (see the size law above). These
 * three survive because none of them is a correction: "how many levels" is a
 * question about how much of the board you want on screen, "intensity" is a
 * question about how loud the overlay sits against the candles, and "size" is a
 * question about how much of the chart the marks are allowed to take. All three
 * are per card and persist into the slot blob (`bLevels` / `bInt` / `bSize`).
 *
 * The ladder request to the server is a constant 30 (see BUBBLE_LADDER_REQUEST
 * in EsChartCard), so the level cap has to stay under it — the strike ranking is
 * session-wide and a strike can only enter it if it survived the server-side
 * truncation in at least one column.
 *
 * ── What `size` does, and where the no-overlap guarantee ends ────────────────
 * It multiplies the FINAL budget — the one already capped against both pitches —
 * rather than just `maxPx`. That ordering matters: capping after the multiply
 * would mean dragging the slider up did nothing at all whenever a pitch cap was
 * binding, which is most of the time on a zoomed-out chart, and a slider that
 * silently does nothing is the exact failure this layer keeps being rebuilt to
 * escape.
 *
 * The consequence is the honest one: **at or below 1.00x marks are guaranteed
 * never to touch; above it they may.** That is the user asking for bigger marks
 * and accepting fused rows, which is a legitimate thing to want on a zoomed-in
 * chart where the pitch caps are over-conservative. The ceiling is 2x, not 5x,
 * so the ask stays a nudge rather than a way to paint the canvas.
 */
export const BUBBLE_LEVELS_RANGE = { min: 1, max: 15 } as const;
export const BUBBLE_INTENSITY_RANGE = { min: 0.2, max: 1 } as const;
/**
 * Ceiling raised 2 -> 4.
 *
 * 2x was picked when the column pitch still hard-bounded the budget, so the top
 * of the travel was mostly theoretical — on a dense bucket the pitch cap bound
 * first and the last of the slider did nothing. With `colBoundFloorPx` stopping
 * that strangle there is real room up there now, and a zoomed-in 1-minute chart
 * is exactly where someone wants it.
 */
export const BUBBLE_SIZE_RANGE = { min: 0.4, max: 4 } as const;
/**
 * Exponent on the size law: r = maxPx * (|net GEX| / reference) ^ curve.
 *
 * 1.00 is the straight-proportional law and stays the default — twice the gamma
 * is twice the radius, which is what makes the ladder rankable by eye.
 *
 * Above 1 the TOP of the ladder keeps the full budget while everything under it
 * shrinks, so the dominant strikes stand out further without the wings bloating
 * with them. This is deliberately the ONLY way to make the top bigger relative
 * to the rest, and it is not the same thing as the rank bonus this layer keeps
 * being rescued from: a bonus made a mark bigger for a reason unrelated to its
 * gamma and broke the encoding, whereas an exponent is monotonic — more gamma is
 * still strictly more radius at every setting, the scale just gets steeper.
 */
export const BUBBLE_CURVE_RANGE = { min: 1, max: 3 } as const;

/**
 * Floor under the EXPANDING session reference, as a fraction of the reference
 * over the whole loaded buffer.
 *
 * The reference is a running maximum, so at the very first bucket of a session
 * it is simply that bucket's own biggest strike — and the ladder renders at full
 * size before there is anything to compare it against. This holds the divisor up
 * until the session has actually produced some gamma. 0.30 is where the morning
 * stops rendering as the day's peak without flattening the ladder's contrast
 * (measured across the six calibration sessions: the median top-strike mark goes
 * 12.1px at 0.20 → 9.8px at 0.30 → 7.8px at 0.40, and the top-to-third ratio
 * 2.16 → 1.92 → 1.59; 0.30 is the knee).
 */
export const BUBBLE_REF_FLOOR_FRAC = 0.3;

/**
 * ── The REFERENCE WINDOW (ET minutes) ────────────────────────────────────────
 * Which buckets are allowed to SET the bubble size reference. Everything still
 * DRAWS — this only says whose gamma gets to define "full size".
 *
 * This is the old `BUBBLE_SCALE_CUTOFF_MIN` brought back, and it is back for a
 * reason that the time-of-day detrend (gexTodScale, chartMath) does not cover:
 *
 *  1. The reference is a RUNNING MAXIMUM, so any bucket that sets a new max
 *     draws at ratio 1 — full size — BY CONSTRUCTION. Through the closing
 *     auction gamma routinely climbs faster than the six-session median profile
 *     the detrend divides out, so every minute after ~15:30 set a new detrended
 *     max and every one of them printed at the cap: an hour of identical
 *     maximum-size marks carrying no information.
 *  2. That inflated max also feeds `BUBBLE_REF_FLOOR_FRAC`, which is applied to
 *     the WHOLE session — so a runaway close pushed the floor under the divisor
 *     up and faded the entire morning out from under it.
 *  3. Out of cash hours the history writer has no market-hours gate: it
 *     republishes the last cash book once a minute, frozen. Those are real rows
 *     with real (large) gamma and a 03:00 timestamp, and letting them define the
 *     scale is the overnight version of the same problem.
 *
 * Why this is NOT the old cliff's mistake: the cliff also stopped MEASURING the
 * last half hour, so every late wall clamped to one size. The detrend is still
 * in force here — a 15:50 bucket is judged against `reference x 3.10`, so it
 * varies normally and only clamps if it is genuinely running ~3x above the day's
 * detrended peak. The window governs the divisor, not the encoding.
 */
export const BUBBLE_REF_START_MIN = 9 * 60 + 30;   // 09:30 ET — cash open
export const BUBBLE_REF_CUTOFF_MIN = 15 * 60 + 30; // 15:30 ET — closing auction

/**
 * Bubble time bucket. Storage is always 1-minute; this aggregates at DRAW time.
 *
 * "bar" is the default now that the card has a timeframe switcher: a fixed 5m
 * bucket puts twelve bubble columns inside a single 1h candle, which merges them
 * back into the solid rail the bucket exists to prevent. One column per bar
 * holds at every interval.
 */
export type BubbleBucket = 1 | 5 | "bar";
export const isBubbleBucket = (v: unknown): v is BubbleBucket => v === 1 || v === 5 || v === "bar";

export type SlotBlob = Record<string, unknown>;

/** Slot ids: 0 | 1 | 2 for the page's three cards, "embed" for the home card. */
export type SlotId = number | string;

/**
 * The namespace every card's settings live in once there is more than one chart
 * on screen. With a shared toolbar the controls drive all the charts at once, so
 * they must all be reading and writing ONE blob — the per-card slots are then
 * only used for the symbol, which stays independent.
 */
export const SHARED_SLOT = "shared";

const SLOT_PREFIX = "es-candles-slot-v2:";
const slotStorageKey = (slot: SlotId) => `${SLOT_PREFIX}${slot}`;

// ── Legacy (pre-multi-card) keys. Read for migration; never deleted, so a
//    rollback still finds the user's settings sitting where it expects them.
const LEGACY_SYMBOL_KEY = "es-candles-symbol-v1";
const LEGACY_BUBBLE_KEY = "es-candles-bubble-cfg-v1";
// The pinned preset. Global. The card's own "Save default" / "Reset" buttons are
// gone with the sliders, so nothing in the ES Candles dock writes this any more;
// it survives only because the page-preset snapshot (presetStore) still carries
// it, and a preset saved before 2026-08-16 has one in it.
export const BUBBLE_DEF_KEY = "es-candles-bubble-default-v1";

function readJson(key: string): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
  } catch { return null; } // private mode / bad blob
}

let sharedSeeded = false;

/**
 * First time the row goes multi-chart, the shared blob doesn't exist yet — and
 * falling back to factory defaults would silently throw away the setup the user
 * had on their single chart. Seed it from slot 0 (minus the symbol, which stays
 * per card) so going from one chart to three keeps everything you had and just
 * repeats it.
 *
 * Self-healing like ensureMigrated, for the same reason: React flushes child
 * effects before parent effects, so the page cannot be relied on to run first.
 */
function ensureSharedSeeded(): void {
  if (typeof window === "undefined" || sharedSeeded) return;
  sharedSeeded = true;
  if (readJson(slotStorageKey(SHARED_SLOT))) return;
  const seed = { ...(readJson(slotStorageKey(0)) ?? {}) };
  delete seed.symbol;
  try { window.localStorage.setItem(slotStorageKey(SHARED_SLOT), JSON.stringify(seed)); } catch { /* ignore */ }
}

export function readSlot(slot: SlotId): SlotBlob {
  // Self-healing rather than order-dependent. React flushes CHILD effects before
  // parent effects, so a card's restore effect runs BEFORE the page's
  // ensureMigrated() — relying on the page to migrate first would hand the first
  // card an empty blob and silently drop the user's pre-multi-card settings on
  // the one load where it matters. ensureMigrated is idempotent and returns
  // immediately once slot 0 exists, so paying for it here costs one getItem.
  ensureMigrated();
  if (String(slot) === SHARED_SLOT) ensureSharedSeeded();
  return readJson(slotStorageKey(slot)) ?? {};
}

// ── Same-tab broadcast ───────────────────────────────────────────────────────
// localStorage's `storage` event fires in OTHER tabs, never the one that wrote —
// so it is exactly no use for keeping three cards in the same tab in sync. This
// is the missing half: writeSlot notifies every subscriber on that slot, so the
// shared toolbar's write lands in all three cards on the same tick.
type SlotListener = (patch: SlotBlob) => void;
const slotListeners = new Map<string, Set<SlotListener>>();

export function subscribeSlot(slot: SlotId, cb: SlotListener): () => void {
  const key = String(slot);
  let set = slotListeners.get(key);
  if (!set) { set = new Set(); slotListeners.set(key, set); }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (!set!.size) slotListeners.delete(key);
  };
}

function notifySlot(slot: SlotId, patch: SlotBlob): void {
  const set = slotListeners.get(String(slot));
  if (!set) return;
  // Copy first: a listener that unsubscribes itself mid-notify would otherwise
  // mutate the set being iterated.
  for (const cb of [...set]) { try { cb(patch); } catch { /* one bad listener must not stop the rest */ } }
}

/** Read-modify-write, then broadcast. Merges `patch` over whatever is stored. */
export function writeSlot(slot: SlotId, patch: SlotBlob): void {
  persistSlot(slot, patch);
  notifySlot(slot, patch);
}

/**
 * Persist without broadcasting.
 *
 * For the mirror write in EsChartCard's saveSetting: the card keeps BOTH its own
 * blob and SHARED_SLOT current, so it stops mattering which one the current
 * chart count reads. Only the active namespace should raise an event — every
 * subscriber is listening on that one, and notifying the mirror as well would
 * deliver each change twice, and in the shared case would feed cards a patch on
 * a slot they do not own.
 */
export function writeSlotQuiet(slot: SlotId, patch: SlotBlob): void {
  persistSlot(slot, patch);
}

function persistSlot(slot: SlotId, patch: SlotBlob): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(slotStorageKey(slot), JSON.stringify({ ...readSlot(slot), ...patch }));
  } catch { /* ignore */ }
}

/**
 * Broadcast WITHOUT persisting. For state that must stay in step across the
 * cards but has no business in localStorage — the replay cursor, which moves a
 * couple of times a second during playback and is meaningless next session.
 */
export function broadcastSlot(slot: SlotId, patch: SlotBlob): void {
  notifySlot(slot, patch);
}

export function readBubbleDefault(): Record<string, unknown> | null {
  return readJson(BUBBLE_DEF_KEY);
}
export function writeBubbleDefault(v: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(BUBBLE_DEF_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}

// (`bubbleCfgFrom` lived here. It pulled the seven slider values out of a saved
// blob and clamped them. The sliders are gone and the style is frozen in
// BUBBLE_STYLE, so any leftover numeric keys in an old slot blob are now inert —
// they are simply never read. Nothing deletes them: a rollback should still find
// the user's old setup sitting where it expects it.)

// ── Page-level keys ──────────────────────────────────────────────────────────
export const MAX_CARDS = 3;
const CARDS_KEY = "es-candles-cards-v1";
const SIDE_PANEL_KEY = "es-candles-side-panel-v1";

export type SidePanelKind = "none" | "rail" | "chain";
const isSidePanel = (v: unknown): v is SidePanelKind => v === "none" || v === "rail" || v === "chain";

export function readCardCount(): number {
  if (typeof window === "undefined") return 1;
  try {
    const n = Number(window.localStorage.getItem(CARDS_KEY));
    return Number.isFinite(n) && n >= 1 && n <= MAX_CARDS ? Math.floor(n) : 1;
  } catch { return 1; }
}
export function writeCardCount(n: number): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(CARDS_KEY, String(n)); } catch { /* ignore */ }
}

export function readSidePanel(): SidePanelKind {
  if (typeof window === "undefined") return "rail";
  try {
    const v = window.localStorage.getItem(SIDE_PANEL_KEY);
    return isSidePanel(v) ? v : "rail";
  } catch { return "rail"; }
}
// Which greek the 0DTE chain panel shows. Page-level like the panel itself —
// typed loosely here so slotStore stays React-free and ChainRail owns the union
// (importing it back would be a cycle).
const CHAIN_GREEK_KEY = "es-candles-chain-greek-v1";
export function readChainGreek(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(CHAIN_GREEK_KEY); } catch { return null; }
}
export function writeChainGreek(v: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(CHAIN_GREEK_KEY, v); } catch { /* ignore */ }
}

export function writeSidePanel(v: SidePanelKind): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(SIDE_PANEL_KEY, v); } catch { /* ignore */ }
}

// ── Keep live ────────────────────────────────────────────────────────────────
// Suspend the 15-minute inactivity socket drop (hooks/useWsLifecycle.ts) while
// this route is up. This is the page people leave on a second monitor or on a
// stream for hours, and the idle timer cannot tell "abandoned" from "being
// watched without touching the mouse" — so on THIS route the benefit of the
// doubt goes to the chart. A hidden tab still disconnects either way.
//
// Defaults to ON. The stored value is the string "0"/"1" so that "never set"
// (null) and "deliberately off" ("0") stay distinguishable.
const KEEP_LIVE_KEY = "es-candles-keep-live-v1";

export function readKeepLive(): boolean {
  if (typeof window === "undefined") return true;
  try { return window.localStorage.getItem(KEEP_LIVE_KEY) !== "0"; } catch { return true; }
}
export function writeKeepLive(on: boolean): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEEP_LIVE_KEY, on ? "1" : "0"); } catch { /* ignore */ }
}

// ── The EMBEDDED card's side panel ───────────────────────────────────────────
// `EsCandlesPage embedded` (the /home GEX card's ES view, and the /board ES
// tile) used to hardcode "rail". It is now a toggle in that card's own dock,
// stored under its OWN key rather than sharing SIDE_PANEL_KEY above.
//
// Separate on purpose: the embed sits inches away from a full GEX chart, so
// turning the rail off there is a layout decision about THAT tile. Sharing the
// key would mean hiding the rail in a 6-column tile silently strips it from the
// full /es-candles route as well, which is not what anyone pressing that button
// is asking for.
//
// Defaults to "rail" so nothing changes for anyone who never touches it.
const EMBED_SIDE_PANEL_KEY = "es-candles-side-panel-embed-v1";

export function readEmbedSidePanel(): SidePanelKind {
  if (typeof window === "undefined") return "rail";
  try {
    const v = window.localStorage.getItem(EMBED_SIDE_PANEL_KEY);
    return isSidePanel(v) ? v : "rail";
  } catch { return "rail"; }
}

export function writeEmbedSidePanel(v: SidePanelKind): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(EMBED_SIDE_PANEL_KEY, v); } catch { /* ignore */ }
}

// ── Indicators ───────────────────────────────────────────────────────────────
// PAGE-LEVEL, not per slot, and deliberately so: the point of two or three
// charts side by side is comparison, and comparing ES against SPY with a 21 EMA
// on one and a 50 on the other compares nothing. Same reasoning that put the
// timeframe and the overlays on the shared blob when the dock was hoisted.
//
// Every flag defaults OFF. The chart has to look exactly as it does today until
// someone deliberately turns something on.
export type EmaLine = { on: boolean; len: number };
export type IndicatorCfg = {
  /** Up to three, each with its own length. */
  emas: EmaLine[];
  bb: boolean;
  bbPeriod: number;
  /** Inner and outer cloud edges, in standard deviations. */
  bbInner: number;
  bbOuter: number;
  weeklyEm: boolean;
  volume: boolean;
  rsi: boolean;
  rsiPeriod: number;
  countdown: boolean;
};

export const MAX_EMAS = 3;
export const INDICATORS_DEFAULT: IndicatorCfg = {
  emas: [{ on: false, len: 9 }, { on: false, len: 21 }, { on: false, len: 50 }],
  bb: false,
  bbPeriod: 20,
  bbInner: 2.3,
  bbOuter: 3.0,
  weeklyEm: false,
  volume: false,
  rsi: false,
  rsiPeriod: 14,
  countdown: false,
};

const INDICATORS_KEY = "es-candles-indicators-v1";

/**
 * Field-by-field, over the defaults — never a spread of the stored blob.
 *
 * A blob written by an older build is missing keys a newer one needs, and a
 * blob written by a newer build carries keys this one has never heard of.
 * Merging over the defaults survives both; spreading yields `undefined` where a
 * number belongs and puts NaN into a moving average.
 */
export function readIndicators(): IndicatorCfg {
  if (typeof window === "undefined") return INDICATORS_DEFAULT;
  const raw = readJson(INDICATORS_KEY);
  if (!raw) return INDICATORS_DEFAULT;
  const num = (v: unknown, d: number, lo: number, hi: number) =>
    (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const emasRaw = Array.isArray(raw.emas) ? raw.emas : [];
  const emas = INDICATORS_DEFAULT.emas.map((d, i) => {
    const e = emasRaw[i] as Record<string, unknown> | undefined;
    return e && typeof e === "object"
      ? { on: bool(e.on, d.on), len: Math.round(num(e.len, d.len, 1, 400)) }
      : { ...d };
  });
  return {
    emas,
    bb: bool(raw.bb, INDICATORS_DEFAULT.bb),
    bbPeriod: Math.round(num(raw.bbPeriod, INDICATORS_DEFAULT.bbPeriod, 2, 400)),
    bbInner: num(raw.bbInner, INDICATORS_DEFAULT.bbInner, 0.1, 10),
    bbOuter: num(raw.bbOuter, INDICATORS_DEFAULT.bbOuter, 0.1, 10),
    weeklyEm: bool(raw.weeklyEm, INDICATORS_DEFAULT.weeklyEm),
    volume: bool(raw.volume, INDICATORS_DEFAULT.volume),
    rsi: bool(raw.rsi, INDICATORS_DEFAULT.rsi),
    rsiPeriod: Math.round(num(raw.rsiPeriod, INDICATORS_DEFAULT.rsiPeriod, 2, 100)),
    countdown: bool(raw.countdown, INDICATORS_DEFAULT.countdown),
  };
}

export function writeIndicators(v: IndicatorCfg): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(INDICATORS_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}

// ── Replay command channel ───────────────────────────────────────────────────
// The page's toolbar owns the Replay BUTTON; the card owns replay STATE, because
// the frames are the card's own bars and nothing above it knows how many there
// are. This is the one-way wire between them.
//
// Deliberately NOT the settings slot. In single-chart mode a card's cfgSlot is
// its own slot, so routing a replay command through writeSlot/subscribeSlot
// would make every card echo its own persisted writes back into its own state —
// idempotent today, and a trap the first time a setter isn't. A separate
// channel costs eight lines and can't do that.
type ReplayCmd = { on: boolean };
const replayListeners = new Set<(cmd: ReplayCmd) => void>();

export function subscribeReplayCmd(cb: (cmd: ReplayCmd) => void): () => void {
  replayListeners.add(cb);
  return () => { replayListeners.delete(cb); };
}

export function broadcastReplayCmd(cmd: ReplayCmd): void {
  for (const cb of [...replayListeners]) { try { cb(cmd); } catch { /* one bad listener must not stop the rest */ } }
}

// ── Migration ────────────────────────────────────────────────────────────────
/**
 * Fold the pre-multi-card keys into slot blobs. Idempotent, and safe to call on
 * every mount — it no-ops once slot 0 exists.
 *
 * Slots 1 and 2 are seeded from the SAME legacy values, not from factory
 * defaults. Asking for three charts and getting your tuned chart plus two bare
 * ES/5m ones reads as a bug; three identical charts you then diverge is what
 * people mean by "give me three of these".
 *
 * The legacy keys are left in place. Nothing else reads them, they're a few
 * hundred bytes, and leaving them means a rollback to the single-chart page
 * still finds the user's symbol and sliders.
 */
let migrationChecked = false;

export function ensureMigrated(): void {
  if (typeof window === "undefined") return;
  // readSlot calls this, and writeSlot calls readSlot — which puts it on the
  // path of every slider drag. One process-lifetime flag keeps that from
  // becoming a getItem per frame.
  if (migrationChecked) return;
  migrationChecked = true;
  try {
    if (window.localStorage.getItem(slotStorageKey(0))) return;
  } catch { return; } // storage unavailable (private mode) — run on defaults

  const legacyBubble = readJson(LEGACY_BUBBLE_KEY) ?? {};
  let legacySymbol: string | null = null;
  try { legacySymbol = window.localStorage.getItem(LEGACY_SYMBOL_KEY); } catch { /* ignore */ }

  // Only the keys that still MEAN something get carried across. The legacy blob
  // also held the seven bubble sliders; those are retired (see BUBBLE_STYLE) and
  // seeding them would just plant dead numbers in every fresh slot.
  const seed: SlotBlob = {};
  if (legacySymbol) seed.symbol = legacySymbol;
  if (isBubbleBucket(legacyBubble.mins)) seed.mins = legacyBubble.mins;
  if (typeof legacyBubble.on === "boolean") seed.on = legacyBubble.on;
  if (typeof legacyBubble.cb === "boolean") seed.cb = legacyBubble.cb;

  // "embed" is seeded too. Before the split, the home dashboard's card read the
  // same global keys as the page, so it already showed the user's symbol and
  // bubble setup; dropping it back to factory defaults would read as the home
  // card breaking, in a page nobody touched.
  const slots: SlotId[] = [...Array.from({ length: MAX_CARDS }, (_, i) => i), "embed"];
  for (const id of slots) {
    if (readJson(slotStorageKey(id))) continue;
    try { window.localStorage.setItem(slotStorageKey(id), JSON.stringify(seed)); } catch { /* ignore */ }
  }
}
