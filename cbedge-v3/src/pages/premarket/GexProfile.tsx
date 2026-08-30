/**
 * GEX PROFILE BY STRIKE — the scrolling per-strike ladder on /premarket.
 *
 * Extracted from Premarket.tsx the moment the page needed TWO of them side by
 * side: the front expiry (0DTE on SPX) and the whole board EXCLUDING it. They
 * are the same picture of two different books, and the read is the comparison —
 * where today's pin sits against where the standing book sits — so they have to
 * be pixel-identical or the comparison is between the charts rather than
 * between the boards. One component, mounted twice, is the only way to
 * guarantee that.
 *
 * Everything about how the ladder BEHAVES lives here: the windowing, the bar
 * scale, the spot / flip rules, the pan-free scroll and the centring. The page
 * supplies the numbers and what to label.
 *
 * ── THE TWO WINDOWS ─────────────────────────────────────────────────────────
 * `NEAR_HALF` (±12) is the ~25 strikes that decide the open, and the bar scale
 * is normalised over THOSE — a single monster strike 200 points out would
 * otherwise flatten every bar near the money. `VIEW_HALF` (±60) is what
 * actually renders; the panel scrolls, so the extra rows cost nothing until you
 * go looking for a wall, which is exactly when you want them.
 *
 * ── CENTRING, AND WHY THE PADDING IS NOT DECORATION ─────────────────────────
 * Centring is `scrollTop = rowTop - (view - row) / 2`, and scrollTop cannot go
 * below 0 or above `scrollHeight - clientHeight`. Without room past the ends of
 * the ladder, a spot within ~11 rows of either END has NO scroll position that
 * centres it, so the write is clamped and spot renders high or low in the card.
 * That is not an edge case: the window is spot ±60 STRIKES of whatever the
 * chain lists, clamped to the ends of that chain, so a board that thins out a
 * few strikes above the money opens with spot near the top and nothing to
 * scroll. Sizing the box to its content did the same from the other side — a
 * short ladder is a short card and spot lands wherever it lands in it.
 *
 * So the box is a FIXED height with HALF A VIEWPORT of padding at each end. The
 * first and last rows can both reach the middle, the centring target is exactly
 * `i * ROW_H` for every row on every ticker, and the clamp is unreachable.
 *
 * Colours and classes come from the page's `.pmk` block — nothing hardcoded.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/** One bar. `net` is signed dollars of gamma at that strike. */
export type ProfileBar = { strike: number; net: number };

/**
 * Row pitch, in px. Interpolated into the page's stylesheet (`.pmk .row`) AND
 * used by the scroll maths here, so the CSS and the arithmetic cannot drift.
 */
export const PROFILE_ROW_H = 19;
/** The viewport height. FIXED, not a max — see PROFILE_PAD. */
export const PROFILE_VIEW_H = 440;
/** Half a viewport of room above the first strike and below the last. */
export const PROFILE_PAD = (PROFILE_VIEW_H - PROFILE_ROW_H) / 2;

/** ±12 strikes: the window the bar scale is normalised over. */
const NEAR_HALF = 12;
/** ±60 strikes: the window that renders. */
const VIEW_HALF = 60;

/** Nearest listed strike to a price, or null when there is nothing to pick. */
function nearestStrike(strikes: number[], px: number): number | null {
  if (!strikes.length || !(px > 0)) return null;
  // length checked above, so strikes[0] is in range.
  return strikes.reduce((b, k) => (Math.abs(k - px) < Math.abs(b - px) ? k : b), strikes[0]!);
}

export default function GexProfile({
  title,
  sub,
  rows,
  spot,
  flip,
  kDp,
  pxDp,
  tagFor,
  resetKey,
  empty = "Waiting for the chain…",
  fmtUsd,
  nf,
  fmtPx,
  children,
}: {
  title: string;
  /** The line beside the title — basis, expiry scope, strike count. */
  sub: ReactNode;
  /** Every strike on this board, any order. Windowed here, not by the caller. */
  rows: ProfileBar[];
  spot: number;
  flip?: number | null;
  /** Strike decimals, and price decimals — the page owns both. */
  kDp: number;
  pxDp: number;
  /** What to badge a strike with, if anything. Called per rendered row. */
  tagFor?: (strike: number) => { text: string; color: string } | null;
  /**
   * Changing this re-pins the ladder to spot. The page passes the SYMBOL:
   * scrolling away on SPX and then picking NVDA must not leave the new board
   * parked at the old one's offset.
   */
  resetKey?: string;
  empty?: ReactNode;
  /** Formatters, passed in so both ladders print exactly what the page does. */
  fmtUsd: (v: number | null | undefined, sign?: boolean) => string;
  nf: (v: number, dp?: number) => string;
  fmtPx: (v: number | null | undefined, dp?: number) => string;
  /** Rendered under the axis — the greeks strip on the front-expiry ladder. */
  children?: ReactNode;
}) {
  // ── the two windows ────────────────────────────────────────────────────────
  const sorted = useMemo(
    () => rows.filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.net))
      .slice()
      .sort((a, b) => a.strike - b.strike),
    [rows],
  );

  const spotIdx = useMemo(() => {
    if (!sorted.length || !(spot > 0)) return -1;
    // b is always an index produced by this same reduce, so it's in range.
    return sorted.reduce(
      (b, r, i) => (Math.abs(r.strike - spot) < Math.abs(sorted[b]!.strike - spot) ? i : b), 0);
  }, [sorted, spot]);

  const windowAt = useCallback((half: number) => {
    if (spotIdx < 0) return [];
    const lo = Math.max(0, spotIdx - half);
    const hi = Math.min(sorted.length, spotIdx + half + 1);
    return sorted.slice(lo, hi).slice().reverse();   // high strike at the top
  }, [sorted, spotIdx]);

  const nearBars = useMemo(() => windowAt(NEAR_HALF), [windowAt]);
  const bars = useMemo(() => windowAt(VIEW_HALF), [windowAt]);

  // Scaled on the NEAR window, not the scrolled one — see the header.
  const maxP = Math.max(1, ...nearBars.filter((b) => b.net > 0).map((b) => b.net));
  const maxN = Math.max(1, ...nearBars.filter((b) => b.net < 0).map((b) => -b.net));
  const bigCut = Math.max(maxP, maxN) * 0.55;

  const spotStrike = nearestStrike(bars.map((b) => b.strike), spot);
  const flipStrike = flip ? nearestStrike(bars.map((b) => b.strike), flip) : null;

  // ── scroll + centring ──────────────────────────────────────────────────────
  const chartRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  /**
   * When a real INPUT GESTURE last touched this panel.
   *
   * The panel un-pins on a scroll the reader performed and must NOT un-pin on
   * one the browser performed — and a scroll event says nothing about which it
   * was. It used to try to tell them apart by remembering the scrollTop it had
   * written, and that broke on the case that matters most:
   *
   *   switch symbol → the old ladder's 121 rows are replaced by an empty one
   *   → the browser CLAMPS scrollTop from 1,140 to 0 and fires a scroll event
   *   → that event matches neither guard, so the panel un-pinned itself
   *   → the new symbol's board then loaded and was never centred, opening
   *     sixty strikes above the money with "back to spot" already showing.
   *
   * Which is exactly what AMD did. Content collapsing, a resize, a zoom and our
   * own centring write all produce that same "unexplained" scroll event.
   *
   * So the question is asked the other way round: a scroll only counts as the
   * reader's if a wheel, a drag, a touch or a key happened just before it.
   * Nothing else can un-pin the panel, which makes every one of those cases
   * safe by construction rather than by a guard per case.
   */
  const gestureAtRef = useRef(0);
  const [pinned, setPinned] = useState(true);

  /**
   * Put the spot row in the middle of the panel. Returns FALSE when the layout
   * is not ready to be measured yet, so the caller can try again next frame.
   *
   * MEASURED, not arithmetic: `el.clientHeight` is 0 until the panel has been
   * laid out, and a 0 there makes the target the row's own offset, which the
   * browser clamps to the maximum scroll — the card then opens scrolled to the
   * BOTTOM of the ladder and stays there. On the live SPX socket that was
   * survivable (a new frame a second later re-ran it); on a chain-poll symbol
   * the next attempt is SIXTY SECONDS away, so the first bad centre is what you
   * look at. Reporting "not ready" instead of writing a nonsense scrollTop is
   * what makes the retry loop below work.
   */
  const centerOnSpot = useCallback((): boolean => {
    const el = chartRef.current;
    if (!el) return false;
    const i = bars.findIndex((b) => b.strike === spotStrike);
    if (i < 0) return false;
    const row = el.querySelectorAll<HTMLElement>(".row")[i];
    if (!row || el.clientHeight <= 0 || el.scrollHeight <= 0) return false;
    // With PROFILE_PAD at both ends this is exactly i * PROFILE_ROW_H and can
    // never hit either bound. The clamp stays as a guard; nothing reaches it.
    const target = Math.max(
      0,
      Math.min(
        row.offsetTop - (el.clientHeight - row.offsetHeight) / 2,
        el.scrollHeight - el.clientHeight,
      ),
    );
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
    return true;
  }, [bars, spotStrike]);

  /**
   * Centre while pinned — and keep trying until the panel can actually be
   * measured, rather than assuming the first attempt lands after layout.
   *
   * ~90 frames, not 20: a tab that mounts in the background, a font that
   * settles late or a slow first paint can all push the first measurable frame
   * past a third of a second, and on a chain-poll symbol giving up means
   * sixty seconds of a ladder scrolled to the wrong place.
   *
   * A ResizeObserver re-centres on every box change too: the panel is inside a
   * responsive grid, so a window resize (or the first paint settling) moves the
   * middle without changing `bars` at all.
   */
  useEffect(() => {
    let raf = 0;
    let tries = 0;
    const tick: () => void = () => {
      raf = 0;
      if (!pinnedRef.current) return;
      if (!centerOnSpot() && tries++ < 90) raf = requestAnimationFrame(tick);
    };
    if (pinnedRef.current) tick();

    // The observer is attached UNCONDITIONALLY — outside the pinned check. It
    // used to sit behind it, so a panel that happened to be un-pinned when the
    // effect ran got no observer at all and then never re-centred once it was
    // re-pinned, because nothing was watching the box any more.
    const el = chartRef.current;
    const ro = el && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => { if (pinnedRef.current) centerOnSpot(); })
      : null;
    if (el && ro) ro.observe(el);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [centerOnSpot]);

  /** A wheel, a drag, a touch or a key — see gestureAtRef. */
  const markGesture = useCallback(() => { gestureAtRef.current = Date.now(); }, []);

  const onChartScroll = useCallback(() => {
    // Only a scroll the READER caused un-pins the panel. 700ms is comfortably
    // longer than the smooth-scroll a single wheel notch produces and far
    // shorter than any gap between a gesture and an unrelated reflow.
    if (Date.now() - gestureAtRef.current > 700) return;
    if (pinnedRef.current) { pinnedRef.current = false; setPinned(false); }
  }, []);

  const repin = useCallback(() => {
    pinnedRef.current = true;
    setPinned(true);
    centerOnSpot();
  }, [centerOnSpot]);

  /** A new board is a new ladder, so the panel goes back to centred on spot. */
  useEffect(() => {
    pinnedRef.current = true;
    setPinned(true);
    gestureAtRef.current = 0;
  }, [resetKey]);

  /**
   * Vertical centre of a strike's row, in the .chart box's own coordinates —
   * what the spot and flip rules are pinned to.
   *
   * PROFILE_PAD is added because the rules are absolutely positioned, and an
   * absolutely positioned child is placed from the PADDING edge while the rows
   * begin after the padding. Without it both rules sit half a viewport above
   * the row they name.
   */
  const rowTop = (strike: number | null) => {
    if (strike == null) return null;
    const i = bars.findIndex((b) => b.strike === strike);
    return i < 0 ? null : PROFILE_PAD + i * PROFILE_ROW_H + PROFILE_ROW_H / 2;
  };

  return (
    <div className="col">
      <div className="colhead">
        <h3>{title}</h3>
        <span className="tiny">{sub}</span>
      </div>

      <div style={{ position: "relative" }}>
        {/* Fixed height + half a viewport of padding at each end, so the
            centring write is never clamped and SPOT lands dead centre on every
            ticker. Skipped while the ladder is empty — 210px of padding over
            "Waiting for the chain" is just a hole. */}
        <div
          className="chart"
          ref={chartRef}
          onScroll={onChartScroll}
          onWheel={markGesture}
          onTouchMove={markGesture}
          onPointerDown={markGesture}
          onKeyDown={markGesture}
          style={bars.length
            ? { height: PROFILE_VIEW_H, paddingTop: PROFILE_PAD, paddingBottom: PROFILE_PAD }
            : undefined}
        >
          {bars.length === 0 && (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--dim)", fontSize: 12 }}>
              {empty}
            </div>
          )}
          {bars.map((b) => {
            const pos = b.net >= 0;
            const w = (Math.abs(b.net) / (pos ? maxP : maxN)) * 50;
            const tag = tagFor?.(b.strike) ?? null;
            return (
              <div className={`row${tag ? " key" : ""}`} key={b.strike}>
                <div className="k mono">{nf(b.strike, kDp)}</div>
                <div className="track">
                  <div
                    className={`bar ${pos ? "p" : "n"}${Math.abs(b.net) > bigCut ? "" : " dimmed"}`}
                    style={{ width: `${w}%` }}
                  />
                  {tag && (() => {
                    // A tagged strike is usually the widest bar in the window,
                    // so hanging the label off its end pushes it out of the
                    // track — over the next column on the call side, over the
                    // strike gutter on the put side. Wide bars take the label
                    // INSIDE, flush to the bar's end.
                    //
                    // Anchored with left/right only (no transform): the bar's
                    // outer edge sits (50 − w)% from the far side, so pinning
                    // the tag's matching edge there right-aligns it inside the
                    // bar and can never exceed the track, whatever w is.
                    const inside = w >= 22;
                    const style: CSSProperties = inside
                      ? pos
                        ? { right: `calc(50% - ${w}% + 4px)` }
                        : { left: `calc(50% - ${w}% + 4px)` }
                      : pos
                        ? { left: `calc(50% + ${w}% + 6px)` }
                        : { right: `calc(50% + ${w}% + 6px)` };
                    return (
                      <span
                        className={`tag${inside ? " inside" : ""}`}
                        style={{ ...style, color: tag.color, border: `1px solid ${tag.color}` }}
                      >
                        {tag.text}
                      </span>
                    );
                  })()}
                </div>
              </div>
            );
          })}
          {rowTop(spotStrike) != null && (
            <div className="spotline" style={{ top: rowTop(spotStrike) as number }}>
              <span>SPOT {fmtPx(spot, pxDp)}</span>
            </div>
          )}
          {rowTop(flipStrike) != null && (
            <div className="flipline" style={{ top: rowTop(flipStrike) as number }}>
              <span>FLIP {fmtPx(flip, kDp)}</span>
            </div>
          )}
        </div>
        {!pinned && bars.length > 0 && (
          <button type="button" className="recenter" onClick={repin}>⤒ back to spot</button>
        )}
      </div>
      <div className="axis">
        <span>{fmtUsd(-maxN, false)}</span><span>0</span><span>{fmtUsd(maxP, false)}</span>
      </div>

      {children}
    </div>
  );
}
