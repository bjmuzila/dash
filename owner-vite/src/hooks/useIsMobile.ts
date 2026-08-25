import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Phone-width detection + the two helpers that go with it.
 *
 * owner-vite is laid out with INLINE styles end to end, which means a
 * stylesheet cannot reach any of it — there are no class names to hang a media
 * query on, and an inline `grid-template-columns` beats everything short of
 * `!important`. So the breakpoint has to exist in JS, and every layout that
 * needs to change at that breakpoint has to ask for it.
 *
 * 820px, not 768: the owner pages are dense multi-column dashboards, and the
 * small-tablet range (768–820, and landscape phones) reads much better stacked
 * than squeezed into three columns of 90px.
 *
 * COST. Each caller registers one matchMedia listener. That is deliberately
 * cheaper than threading an `isMobile` prop down through a page like Budget,
 * where the grids live in fifteen sibling components that share no parent state
 * — and matchMedia fires only on an actual breakpoint crossing, not on resize.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function useIsMobile(breakpoint = 820): boolean {
  // Starts false so the desktop layout is what renders first. The alternative —
  // reading innerWidth during the initial render — makes this hook impossible
  // to reason about under StrictMode's double-invoke, and the effect below
  // corrects it in the same commit.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);
  return isMobile;
}

/**
 * Pick a grid template by width.
 *
 *   gridTemplateColumns: gridCols(isMobile, "1.4fr 1fr 1fr 26px")
 *
 * The mobile default is one full-width column, which is right for the common
 * case: a row of cards, or a form whose fields should stack. Pass a third
 * argument when the columns mean something a phone still needs side by side —
 * a date next to an amount, a colour swatch next to a name.
 *
 * `minmax(0, 1fr)` rather than `1fr`: a bare `1fr` is `minmax(auto, 1fr)`, and
 * `auto` refuses to shrink below its content, so one long unbroken string (a
 * merchant name, a URL) pushes the column wider than the screen and takes the
 * whole page's horizontal scroll with it. This is the single most common way a
 * "responsive" grid still overflows on a phone.
 */
export function gridCols(isMobile: boolean, desktop: string, mobile = "minmax(0, 1fr)"): string {
  return isMobile ? mobile : desktop;
}

/**
 * Wrapper style for something that genuinely cannot stack — a table with six
 * meaningful numeric columns, a calendar week. Scrolls INSIDE its own card
 * instead of widening the page.
 *
 * `WebkitOverflowScrolling` keeps the momentum flick on iOS Safari; without it
 * the pan feels dead compared with the rest of the page.
 */
export const scrollX: CSSProperties = {
  overflowX: "auto",
  WebkitOverflowScrolling: "touch",
  // Without this a grid/table child sized in `fr` measures itself against the
  // scroller's own width and never overflows — it just squashes, which is the
  // thing the scroller exists to prevent.
  maxWidth: "100%",
};
