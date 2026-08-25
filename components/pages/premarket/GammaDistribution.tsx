/**
 * REMOVED 2026-08-25 — this card is gone. Nothing imports it.
 *
 * It drew net GEX per strike on the main axis with the gamma-mass curve as an
 * overlay, and for one afternoon it sat to the LEFT of `GammaBellCurve.tsx` as
 * half of a pair. Two cards of the same board at half width each read worse
 * than one at full width, and the bell card's lower pane already draws net GEX
 * per strike — so this one was dropped and its three KPI tiles (center of mass,
 * net GEX over the window, total gamma mass) were folded into the bell card's
 * strip.
 *
 * Nothing was lost with it: every piece of shared machinery it introduced —
 * the OI/VOL row math, gamma mass, the ±3% board, bin folding, the AUTO window,
 * the level-label fan/pack, the GexChart-style pan/zoom hook — was extracted to
 * `gammaChartKit.ts` before the removal and is what the bell card runs on. A
 * second view of the board should be built from the kit, not from a copy of
 * this file.
 *
 * The `.gdist` stylesheet that used to be exported from here (as
 * GAMMA_DIST_CSS) now lives in GammaBellCurve.tsx as GAMMA_BELL_CSS.
 *
 * This file is a tombstone so the removal is discoverable from the import path
 * someone might still search for. It is safe to delete outright.
 */

export {};
