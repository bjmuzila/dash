"use client";

/**
 * useFitUnit — fit content to a box by RE-RENDERING it smaller, not by scaling it.
 *
 * For widgets built from one size knob (SpxHeatmap's cell px, a row height, a
 * font step): measure what the current knob produced, compare against the space
 * available, and hand back the knob value that fills it. The widget redraws at
 * the new size, so text and borders stay crisp — the difference between a
 * heatmap drawn at 14px cells and one drawn at 9px and then CSS-scaled to 1.5x.
 *
 *   const [boxRef, contentRef, cell] = useFitUnit(9, { min: 4, max: 26 });
 *   <div ref={boxRef} style={{ flex: 1, minHeight: 0 }}>
 *     <div ref={contentRef}><SpxHeatmap cell={cell} /></div>
 *   </div>
 *
 * Convergence: content size is ~linear in the knob, so scaling the knob by the
 * shortfall lands within a step or two. The hysteresis band is what stops the
 * classic resize-observer oscillation — a knob that grows the content just past
 * the box, shrinks, fits, grows again, forever. Growing needs real headroom
 * (GROW_AT), shrinking triggers as soon as it overflows, and a knob value that
 * has already been tried and rejected is never re-applied.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Only grow when there's this much slack — the anti-oscillation margin. */
const GROW_AT = 1.08;
/** Shrink as soon as the content is over the box by more than a hair. */
const SHRINK_AT = 0.995;

export function useFitUnit(
  initial: number,
  { min = 1, max = 64, deps = [] as unknown[] } = {},
) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [unit, setUnit] = useState(initial);
  const unitRef = useRef(initial);
  // Knob values that overflowed at the current box size. Cleared whenever the
  // box itself changes, because a bigger box makes them viable again.
  const rejected = useRef(new Set<number>());
  const lastBox = useRef("");

  const measure = useCallback(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;

    const availW = box.clientWidth;
    const availH = box.clientHeight;
    if (availW <= 0 || availH <= 0) return;

    const key = `${availW}x${availH}`;
    if (key !== lastBox.current) {
      lastBox.current = key;
      rejected.current.clear();
    }

    const natW = content.scrollWidth;
    const natH = content.scrollHeight;
    if (natW <= 0 || natH <= 0) return;

    const factor = Math.min(availW / natW, availH / natH);
    const cur = unitRef.current;
    if (factor < SHRINK_AT) rejected.current.add(cur);
    if (factor >= SHRINK_AT && factor < GROW_AT) return; // close enough — hold

    let next = Math.round(cur * factor);
    next = Math.max(min, Math.min(max, next));
    // Never step onto a value already known to overflow this box, and always
    // move by at least one step so a rounded no-op doesn't stall the fit.
    if (factor > 1) while (next > cur && rejected.current.has(next)) next--;
    else if (next >= cur) next = cur - 1;
    next = Math.max(min, Math.min(max, next));

    if (next !== cur) {
      unitRef.current = next;
      setUnit(next);
    }
  }, [max, min]);

  useIsoLayoutEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(box);
    ro.observe(content);
    measure();
    // Content that lands after mount (a fetch resolving) changes the natural
    // size without resizing either observed box.
    const raf = requestAnimationFrame(() => measure());
    const t = setTimeout(measure, 300);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  return [boxRef, contentRef, unit] as const;
}

export default useFitUnit;
