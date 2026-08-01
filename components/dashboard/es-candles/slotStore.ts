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

// ── Bubble config ────────────────────────────────────────────────────────────
// Sizing/filtering is pure taste, so it shouldn't reset every visit.
//   topStrikes  — Show Top Strikes: draw only the N strongest strikes per column
//   highlight   — Highlight Top N Walls: top X of the shown set render dominant (X ≤ N)
//   minSize/maxSize — d3.scaleSqrt radius range in px (area ∝ |GEX|)
//   brightness  — 0..100 opacity gradient steepness for smaller strikes
export type BubbleCfg = { topStrikes: number; highlight: number; minSize: number; maxSize: number; brightness: number };
export const BUBBLE_CFG_DEFAULT: BubbleCfg = { topStrikes: 10, highlight: 3, minSize: 0.5, maxSize: 4, brightness: 84 };
export const BUBBLE_CFG_KEYS: Array<keyof BubbleCfg> = ["topStrikes", "highlight", "minSize", "maxSize", "brightness"];

// Slider bounds, single-sourced so the UI and the restore clamp can't drift.
// The size ranges are deliberately CENTERED on the defaults (min 0.5 sits mid
// of 0..1, max 4.0 sits mid of 1..7): the useful sizes are all small, so a
// 0..20 / 1..40 range wasted 90% of the travel and made fine tuning at the low
// end impossible. Half a slider of headroom above the default is plenty.
export const BUBBLE_CFG_RANGE: Record<keyof BubbleCfg, { min: number; max: number }> = {
  topStrikes: { min: 1, max: 30 },
  highlight: { min: 0, max: 30 },
  minSize: { min: 0, max: 1 },
  maxSize: { min: 1, max: 7 },
  brightness: { min: 0, max: 100 },
};
export const clampBubbleVal = (k: keyof BubbleCfg, v: number) =>
  Math.min(BUBBLE_CFG_RANGE[k].max, Math.max(BUBBLE_CFG_RANGE[k].min, v));

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
// The pinned preset. Global, unchanged, and deliberately separate from working
// state: every slider nudge overwrites the slot blob, but only "Save default"
// writes this one, so nothing can trample it.
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

/** Pull a clean BubbleCfg out of any blob, clamped and merged over defaults. */
export function bubbleCfgFrom(blob: Record<string, unknown> | null): Partial<BubbleCfg> {
  const patch: Partial<BubbleCfg> = {};
  if (!blob) return patch;
  for (const k of BUBBLE_CFG_KEYS) {
    const v = blob[k];
    // Clamp on read: a blob saved under the older, much wider size ranges can
    // hold values (e.g. maxSize 20) that no longer exist on the slider, which
    // would render as a pinned handle you couldn't explain.
    if (typeof v === "number" && Number.isFinite(v)) patch[k] = clampBubbleVal(k, v);
  }
  return patch;
}

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

  const seed: SlotBlob = { ...bubbleCfgFrom(legacyBubble) };
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
