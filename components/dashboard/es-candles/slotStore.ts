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

/**
 * ── THE BUBBLE LAYER ─────────────────────────────────────────────────────────
 *
 * Transcribed from cbedge-v3/src/board/gexCandles/settings.ts, where this layer
 * was rebuilt and where the reasoning lives. The two apps are separate builds
 * and neither imports the other, so this is a COPY and it has to be kept one:
 * change a number here and change it there, or ES Candles and GEX Candles stop
 * being the same chart.
 *
 * There are no bubble settings any more. Bubbles are on or off, plus the bucket
 * picker. The rules:
 *
 *   1 bubble per bucket        the trail is a SAMPLE, not a line. The rung comes
 *                              from the zoom, and the last print in the bucket
 *                              wins.
 *   4 strikes, 1 a side        rank by |netGex|, FORCE one above spot and one
 *                              below, then fill from the ranking.
 *   grow with net GEX          r = floor + ratio**sizeCurve x (cap - floor)
 *   the top strike stands out  the bucket's largest gets the boost, a white ring
 *                              and a bright core
 *   old dots survive           never below minPx; age fades opacity only to
 *                              `ageKeep`
 *   no overlap if possible     same-bucket neighbours shrink toward the floor,
 *                              then take a few px of X jitter
 *   history stays the day      nothing spliced; 'per-bar' keeps each bucket's
 *                              own strikes, 'latest' locks the Y set to the
 *                              current picks and plots those backward
 */
export const BUBBLES = {
  /**
   * The bucket ladder, in minutes. The layer picks the SMALLEST rung whose dots
   * land far enough apart to be told apart — see `bucketPxPerDot`.
   *
   * CAPPED AT 5m. 15m and coarser were reachable on a wide view and drew a
   * scatter of lonely dots with the session's shape missing between them. Past
   * 5m the answer is not a coarser BUCKET (which throws away the prints) but the
   * stride (which keeps the bucketing honest and draws every Nth). The
   * 15/30/60 entries in `profiles` stay — a strided 5m trail is SIZED by its
   * effective spacing, so they are still reached as sizes, never as buckets.
   */
  bucketRungsMin: [1, 5],
  /**
   * Pixels a bucket must own before its rung is allowed. Set from the SMALLEST
   * legible mark, not a full-size one: at a full-size threshold a 1m rung needs
   * a whole screen of chart to earn its place, so zooming in makes the dots
   * bigger instead of adding more of them. At ~11px the finer rung is allowed as
   * soon as its dots separate, and `capOfSpacing` shrinks the marks to fit.
   */
  bucketPxPerDot: 11,
  /** The smallest radius a mark can have and still read as a mark. */
  minLegiblePx: 3.5,

  /** Rows per bucket, and how many must sit each side of that bucket's spot. */
  levels: 4,
  minPerSide: 1,
  /**
   * 'per-bar'  each bucket keeps the strikes IT chose, so a level stays on the
   *            axis where it happened even after spot walks away.
   * 'latest'   the Y set is locked to the current picks and those same strikes
   *            are plotted backward through the session.
   */
  strikeMode: "per-bar" as "per-bar" | "latest",

  /**
   * Size, PER RUNG. A 13px cap is right at 5m and absurd at 1m — five times the
   * dots in the same width — so the numbers are per rung rather than one set
   * asked two different questions. A bucket between two listed rungs takes the
   * nearest profile BELOW.
   */
  profiles: {
    1: { capPx: 9, floorPx: 1.6, topBoost: 1.6, ringPx: 1.1 },
    5: { capPx: 13, floorPx: 2.5, topBoost: 1.55, ringPx: 1.4 },
    15: { capPx: 16, floorPx: 3, topBoost: 1.5, ringPx: 1.6 },
    30: { capPx: 18, floorPx: 3.5, topBoost: 1.46, ringPx: 1.8 },
    60: { capPx: 20, floorPx: 4, topBoost: 1.42, ringPx: 2 },
  } as Record<number, { capPx: number; floorPx: number; topBoost: number; ringPx: number }>,
  /**
   * The exponent on `|gex| / windowMax`. Was a plain square root (0.5), which
   * put a 5%-of-max strike at 22% of the range and a 30% strike at 55% — most of
   * the ladder bunched in the top half of the budget, every mark the same dot.
   * Steeper spreads the middle back out: 5% -> 16%, 30% -> 48%, and the day's
   * biggest wall reads as bigger from across the room. Do not go past ~0.75.
   */
  sizeCurve: 0.62,
  /** The floor, as a fraction of whatever cap survived the spacing shrink. */
  floorOfCap: 0.25,
  /**
   * …and the profile is then SHRUNK to the room that actually exists. A profile
   * is right at the zoom its rung was chosen for; force a rung the auto rule
   * would not have picked and the dots land closer than it assumes. Only ever
   * shrinks.
   *
   * This bounds the PEERS ONLY. It used to be divided by `topBoost` so the
   * boosted leader fit inside it too, which meant one dot per bucket dictated
   * the size of every other dot in it.
   */
  capOfSpacing: 0.28,
  /**
   * The leader's own, larger share of the spacing — so it stands apart, and
   * still a bound, so a row of leaders on one strike stays a row of dots rather
   * than fusing into one continuous bar.
   */
  topOfSpacing: 0.34,
  /** Absolute floor. Old dots never shrink past this, whatever the fit does. */
  minPx: 1.2,

  /** Hairline kept between two marks in the same bucket. */
  gapPx: 0.8,
  /** Passes of the pairwise vertical shrink before jitter is used. */
  fitPasses: 6,
  /** Max horizontal nudge, px, for a pair that still does not fit after that. */
  jitterPx: 3,

  /** The weakest mark fades to 1 - fade. */
  fade: 0.45,
  /** The oldest bucket keeps this much of its opacity. */
  ageKeep: 0.75,
  /**
   * Both are CEILINGS, not amounts: the blur actually drawn is also held to the
   * room left beside the mark once its radius is taken out of the spacing, and
   * at a tight zoom that room is zero and the glow does not draw. A 7px halo
   * painted across a 2px gap is what turned the leader's row into a sausage.
   */
  glowFactor: 0.6,
  glowMaxPx: 7,
} as const;

// Removed 2026-08-29 with the v3 engine port: BUBBLE_REF_FLOOR_FRAC and the
// BUBBLE_REF_START_MIN / BUBBLE_REF_CUTOFF_MIN window. They floored and windowed
// an EXPANDING, time-of-day detrended session reference, which the size law no
// longer has — a mark is sqrt(|gex| / windowMax) over the window on screen, one
// denominator, no running maximum to protect. gexTodScale in chartMath is now
// unused by this layer.

/**
 * Bubble time bucket. Storage is always 1-minute; this aggregates at DRAW time.
 *
 * ── "auto" is the default ───────────────────────────────────────────────────
 * A bubble's time IS its candle's time: the bucket follows the chart's own bar,
 * so switching the timeframe re-formats the trail with it and there is nothing
 * to keep in sync by hand. A FIXED bucket cannot do that — 5m puts twelve
 * columns inside a single 1h candle and merges them back into the solid rail the
 * bucket exists to prevent, while on a 1m chart it throws four minutes out of
 * every five.
 *
 * `1` / `5` remain as MANUAL overrides for sub-bar detail on a 15m+ chart, where
 * one column per candle is deliberately coarser than the data underneath it.
 *
 * "bar" is the pre-auto spelling of the same behaviour. It is still accepted, and
 * still resolves to the containing candle, so a saved blob written before this
 * change keeps working and reads as "Auto" in the picker; nothing writes it any
 * more. Do not delete it — a rollback should still find a blob it understands.
 */
export type BubbleBucket = 1 | 5 | "bar" | "auto";
export const isBubbleBucket = (v: unknown): v is BubbleBucket =>
  v === 1 || v === 5 || v === "bar" || v === "auto";
/** Does this bucket track the chart's own bar? ("auto", and its legacy spelling.) */
export const isAutoBucket = (v: BubbleBucket): boolean => v === "auto" || v === "bar";
/** What a fresh card starts on. */
export const BUBBLE_BUCKET_DEFAULT: BubbleBucket = "auto";

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

/**
 * ── Bubble DEFAULTS version ─────────────────────────────────────────────────
 *
 * A default only reaches anyone who has never touched the control. `bLevels` is
 * persisted per slot, so every existing card was pinned to whatever it had —
 * changing `BUBBLE_STYLE.topStrikes` did nothing on a browser that had opened
 * the chart even once, which is every browser that matters. The new value has
 * to be pushed, not just declared.
 *
 * So: a stamp. When it moves, the keys listed in `BUBBLE_DEFAULT_KEYS` are
 * DELETED from every slot blob, once, and the card falls back to the constant.
 * Deleting rather than overwriting is what keeps this honest — the blob goes
 * back to "never set", so the next default change reaches it too.
 *
 * Bump this ONLY when a bubble default is meant to override what people already
 * have. Everything else about a slot blob (symbol, overlays, timeframe) is
 * untouched: this is not a settings reset, and it must never become one.
 */
export const BUBBLE_DEFAULTS_V = 2;
const BUBBLE_DEFAULTS_V_KEY = "es-candles-bubble-defaults-v";
/** Only `bLevels` so far — the 5 -> 4 top-strikes change on 2026-08-28. */
const BUBBLE_DEFAULT_KEYS = ["bLevels"] as const;

let sharedSeeded = false;
let bubbleDefaultsChecked = false;

/**
 * Apply the pending bubble-default bump, once per tab. Self-healing like
 * ensureMigrated and for the same reason: child effects run before parent ones,
 * so nothing can be relied on to call it first.
 */
function ensureBubbleDefaults(): void {
  if (typeof window === "undefined" || bubbleDefaultsChecked) return;
  bubbleDefaultsChecked = true;
  let stored = 0;
  try { stored = Number(window.localStorage.getItem(BUBBLE_DEFAULTS_V_KEY)) || 0; } catch { return; }
  if (stored >= BUBBLE_DEFAULTS_V) return;
  const slots: SlotId[] = [...Array.from({ length: MAX_CARDS }, (_, i) => i), SHARED_SLOT, "embed"];
  for (const slot of slots) {
    const blob = readJson(slotStorageKey(slot));
    if (!blob) continue;
    let touched = false;
    for (const k of BUBBLE_DEFAULT_KEYS) {
      if (k in blob) { delete blob[k]; touched = true; }
    }
    if (!touched) continue;
    try { window.localStorage.setItem(slotStorageKey(slot), JSON.stringify(blob)); } catch { /* ignore */ }
  }
  // Stamped even when nothing was touched, so this walk happens once and not on
  // every readSlot of every card for the rest of time.
  try { window.localStorage.setItem(BUBBLE_DEFAULTS_V_KEY, String(BUBBLE_DEFAULTS_V)); } catch { /* ignore */ }
}

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
  // AFTER the migration (which may have just written these blobs) and BEFORE
  // the shared seed, or slot 0's stale key would be copied into the shared blob
  // a moment after being deleted from slot 0.
  ensureBubbleDefaults();
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
