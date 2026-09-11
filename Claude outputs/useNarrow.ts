// ─────────────────────────────────────────────────────────────────────────────
// "Is this a phone-width viewport?"
//
// Used by the seasonality charts to redraw themselves for a 390px screen: axis
// gutters shrink, a right-hand axis is dropped, a label moves inside the plot.
// Layout that CSS can express does not come through here — the shell's rail,
// the stat tiles, the tables and the heat grid are all handled by media queries
// in SeasonalityView's SHELL_CSS, which cost no JS and cannot desync. This hook
// exists only for the things drawn in SVG, where the geometry is computed in
// JS and a stylesheet cannot reach it.
//
// FALSE ON THE SERVER AND ON THE FIRST CLIENT PAINT, always. Reading
// matchMedia during render is the classic hydration mismatch: the server has no
// viewport, renders the desktop geometry, and a phone client renders the narrow
// one — React #418, and the whole page remounts. The effect runs after
// hydration and flips it, which is one extra paint on a phone and correct on
// both sides. Same rule as every other wall-clock / viewport read on this page.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";

/** Matches SHELL_CSS's phone breakpoint. Keep the two in step. */
export const NARROW_PX = 560;

export function useNarrow(maxPx: number = NARROW_PX): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width:${maxPx}px)`);
    const apply = () => setNarrow(mq.matches);
    apply();
    // addEventListener on a MediaQueryList is Safari 14+; the app targets
    // nothing older, and there is no fallback path worth carrying for it.
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [maxPx]);
  return narrow;
}
