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
// / Max / Curve / Brightness) persisted per card. The sliders are GONE — see
// CHANGELOG 2026-08-16. They existed because the size scale was self-normalising
// and therefore never looked right two days running, so the numbers had to be
// hand-tuned to whatever was on screen. The scale is absolute now (a time-of-day
// detrended session reference, `gexTodScale` in chartMath), which is the thing
// the sliders were compensating for, so the knobs have nothing left to do.
//
// What is left is a frozen style, calibrated once against real data rather than
// nudged by feel. Source: `gex_strike_history.csv` — 1.25M per-strike $SPX rows
// over the six sessions 2026-07-10 … 2026-07-17.
//
// ── The design laws these obey ──────────────────────────────────────────────
// Bullflow, SpotGamma and the SPY GEX overlay were put side by side, and they
// agree on things this chart had been fighting:
//
//   • FEW LEVELS. Three to six rows, never sixteen. The sparsity is the design.
//   • THIN ROWS. 4-8px dots. None of them use a fat mark for a big wall.
//   • SIZE IS THE JUNIOR CHANNEL. Sizes differ between rows, but only mildly —
//     what separates the dominant level is COLOUR and GLOW, not radius.
//   • EVERY LEVEL IS A FULL ROW across the session. The row IS the level.
// ── The size law ────────────────────────────────────────────────────────────
//     r = clamp(maxPx, rowPitch × maxPxRowFrac) × ratio^curve,  floored at minPx
//
// where `ratio` is the strike's |net GEX| on a log scale whose top is the
// session reference and whose bottom is `decades` under it. Read the comment on
// `curve` — it is the number that decides whether the ladder is rankable by eye.
export type BubbleStyle = {
  /** How many strikes draw per column, ranked by peak |GEX| so far. */
  topStrikes: number;
  /** How many of those render as walls — white-hot with a glow. Colour only. */
  highlight: number;
  /** Radius in px of a strike sitting AT the session reference. */
  maxPx: number;
  /**
   * Ceiling on `maxPx` as a fraction of the STRIKE PITCH in px.
   *
   * Rows sit at fixed prices, so on a zoomed-out chart the strikes can be ten
   * pixels apart and a 12px mark would swallow its neighbours. This scales the
   * whole ladder down with the available room instead — the RATIOS between the
   * ranks, which are the actual encoding, are untouched. On any normally-zoomed
   * chart the pitch is far wider than this and `maxPx` simply wins.
   */
  maxPxRowFrac: number;
  /** Hard floor so a wing strike stays a visible speck instead of vanishing. */
  minPx: number;
  /**
   * Size-response exponent on the log ratio. THIS is the separation knob.
   *
   * At 1 (a straight log mapping) the top five strikes drew 6.0 / 5.1 / 4.4 /
   * 4.2 / 4.0 px — a 1.5:1 spread across the whole visible ladder, which is
   * "they all look the same" and was the complaint. That is not a bug in the
   * scale; a real chain's top five genuinely sit within ~2.3x of each other, so
   * ANY faithful mapping compresses them. Reading the hierarchy needs the
   * mapping to stretch deliberately.
   *
   * At 2 the same five draw 8.7 / 6.4 / 4.8 / 4.3 / 3.9 px — 2.2:1 on radius,
   * ~5:1 on area, which is what the eye actually compares. Still strictly
   * monotone in |net GEX|, so a bigger dot is still always more gamma; only the
   * contrast changes.
   */
  curve: number;
  /**
   * Width of the log size domain, in decades below the reference.
   *
   * 1.5 (≈32:1) is measured, not picked: in the six-session sample the 5th
   * ranked strike of a column runs a median 0.44 of that column's top (p10
   * 0.27) and the column top itself runs a median 0.345 of the session
   * reference — so the visible ladder spans roughly 1.5 decades end to end.
   * Narrower and the wings clip onto the floor; wider and the top five bunch
   * back together no matter what `curve` does.
   */
  decades: number;
  /** Opacity gradient steepness, 0..1. The weakest row fades to 1 − this. */
  fade: number;
};

export const BUBBLE_STYLE: BubbleStyle = {
  topStrikes: 5,
  highlight: 1,
  maxPx: 12,
  maxPxRowFrac: 0.55,
  minPx: 0.6,
  curve: 2,
  decades: 1.5,
  fade: 0.55,
};

/**
 * Floor under the EXPANDING session reference, as a fraction of the reference
 * over the whole loaded buffer.
 *
 * Without it the first few buckets of a session — where the running maximum is
 * one or two prints — normalise everything on screen to full size, so the open
 * paints a row of identical fat dots before there is anything to compare them
 * against. It stops binding within the first few minutes and is inert after.
 */
export const BUBBLE_REF_FLOOR_FRAC = 0.2;

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
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(slotStorageKey(slot), JSON.stringify({ ...readSlot(slot), ...patch }));
  } catch { /* ignore */ }
  notifySlot(slot, patch);
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
