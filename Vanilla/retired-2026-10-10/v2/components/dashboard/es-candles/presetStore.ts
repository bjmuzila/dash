"use client";

/**
 * Capture and restore the ENTIRE /es-candles page state as one portable blob.
 *
 * slotStore already persists everything to localStorage as you touch it, so the
 * page always comes back the way you left it. What it can't do is hold more
 * than ONE arrangement, or follow you to another machine. This is the layer on
 * top: named presets, stored server-side, one of them marked default.
 *
 * WHAT IS AND ISN'T IN A PRESET
 * ─────────────────────────────
 * In: chart count, side panel, chain greek, indicators, the bubble default, and
 * every per-slot blob — which is where symbol, timeframe, overlays, expiry
 * pick, heatmap range and bubble config live.
 *
 * Out: replay state. Replay is a command, not a setting (see toggleReplay in
 * the page) — restoring "replay was on, cursor at bar 143" would reopen a
 * frozen chart with no obvious way back, which is exactly the state the page
 * goes out of its way to avoid.
 *
 * WHY IT READS localStorage RATHER THAN REACT STATE
 * ─────────────────────────────────────────────────
 * The state is spread across the page component, three EsChartCards, and their
 * ChainRails, and slotStore is the only place all of it meets. Lifting it into
 * React to snapshot it would mean threading refs through every card for a
 * feature used once a week. Reading the store is one function with no coupling.
 *
 * The corollary: capture() is only accurate AFTER the page has settled, because
 * every setter writes through to the store on change. That is true from first
 * paint onward, so in practice it just works — but it is why this cannot be
 * called during the restore effect.
 */

import {
  MAX_CARDS, SHARED_SLOT,
  readSlot, writeSlot,
  readCardCount, writeCardCount,
  readSidePanel, writeSidePanel,
  readChainGreek, writeChainGreek,
  readIndicators, writeIndicators,
  readBubbleDefault, writeBubbleDefault,
  type SlotBlob, type SidePanelKind, type IndicatorCfg,
} from "@/components/dashboard/es-candles/slotStore";

/** Page key for /api/page-preset. Namespaced so it can't collide with a grid page. */
export const ES_CANDLES_PRESET_PAGE = "es-candles-preset";

/**
 * Bump ONLY for a change no older blob can survive. Unknown keys are ignored on
 * apply and missing ones fall back to defaults, so adding a setting needs no
 * bump — a v1 preset saved today stays valid after you add an indicator.
 */
export const PRESET_VERSION = 1;

export type EsCandlesPreset = {
  v: number;
  page: {
    cards: number;
    sidePanel: SidePanelKind;
    chainGreek: string | null;
    indicators: IndicatorCfg;
    bubbleDefault: Record<string, unknown> | null;
  };
  /** Slot id → blob. Keys are "0".."2" plus "shared". */
  slots: Record<string, SlotBlob>;
};

const slotIds = (): Array<string> => [
  ...Array.from({ length: MAX_CARDS }, (_, i) => String(i)),
  SHARED_SLOT,
];

/** Snapshot the current page. Safe to call any time after mount. */
export function capturePreset(): EsCandlesPreset {
  const slots: Record<string, SlotBlob> = {};
  for (const id of slotIds()) {
    const blob = readSlot(id);
    // Skip empties so a 1-card preset doesn't carry two slots of stale settings
    // it will never use — and so the payload stays well inside the 64KB cap.
    if (blob && Object.keys(blob).length) slots[id] = blob;
  }
  return {
    v: PRESET_VERSION,
    page: {
      cards: readCardCount(),
      sidePanel: readSidePanel(),
      chainGreek: readChainGreek(),
      indicators: readIndicators(),
      bubbleDefault: readBubbleDefault(),
    },
    slots,
  };
}

/** Shape guard. Rejects anything that isn't ours rather than half-applying it. */
export function isPreset(v: unknown): v is EsCandlesPreset {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const p = v as Partial<EsCandlesPreset>;
  return typeof p.v === "number"
    && !!p.page && typeof p.page === "object"
    && !!p.slots && typeof p.slots === "object" && !Array.isArray(p.slots);
}

/**
 * Write a preset back into slotStore.
 *
 * Every field is guarded individually, so a preset saved before a setting
 * existed still applies cleanly and simply leaves that setting alone.
 *
 * Does NOT re-render anything by itself. writeSlot broadcasts, so a mounted
 * card picks up its shared-toolbar settings live — but `symbol` is per-slot and
 * is only read in the card's mount restore, so a card already on screen keeps
 * its ticker. The caller is responsible for the reload; see applyPresetAndReload.
 */
export function applyPreset(preset: EsCandlesPreset): void {
  const { page, slots } = preset;

  // Slots first: the card count change below is what decides how many of these
  // get mounted, so having the blobs already in place avoids a card rendering
  // once with stale settings before its own restore runs.
  if (slots && typeof slots === "object") {
    for (const [id, blob] of Object.entries(slots)) {
      if (blob && typeof blob === "object" && !Array.isArray(blob)) writeSlot(id, blob);
    }
  }

  if (page && typeof page === "object") {
    if (typeof page.cards === "number") writeCardCount(page.cards);       // clamped inside
    if (page.sidePanel) writeSidePanel(page.sidePanel);
    if (typeof page.chainGreek === "string") writeChainGreek(page.chainGreek);
    if (page.indicators && typeof page.indicators === "object") writeIndicators(page.indicators);
    if (page.bubbleDefault && typeof page.bubbleDefault === "object") writeBubbleDefault(page.bubbleDefault);
  }
}

/**
 * Apply, then reload.
 *
 * A reload rather than a live remount, deliberately. Restoring per-card symbols
 * in place would mean either re-keying the whole row (throwing away the chart
 * instances and the websocket anyway) or adding a symbol channel to slotStore
 * that exists solely for this. A preset switch is a rare, explicit action and
 * "the page comes back as that preset" is exactly what the user asked for — the
 * reload is honest about what happened and has no partial-restore failure mode.
 *
 * Upgrade path if it ever feels heavy: give the page a `presetEpoch` state, bump
 * it here, and key the card row on it.
 */
export function applyPresetAndReload(preset: EsCandlesPreset): void {
  applyPreset(preset);
  if (typeof window !== "undefined") window.location.reload();
}
