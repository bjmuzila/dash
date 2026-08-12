"use client";

import { M_COLOR, MONO, RADIUS, TYPE, rgba } from "./mobileTheme";

/**
 * ExpiryBadge — the phone build's read-only expiry indicator.
 *
 * There is no expiry picker on mobile: every GEX surface is pinned to today's
 * SPX expiry (see useMobileGex). This is what replaced the picker — a badge
 * that states which expiry you are looking at, in one chip instead of a
 * scrolling row.
 *
 * It says "0DTE" only when the expiry really is today. On a weekend, a holiday,
 * or any session where no daily series is listed, the feed's front expiry is
 * shown instead — a badge reading "0DTE" over next Friday's book would be worse
 * than no badge at all.
 *
 * THE DATE IS ALWAYS SHOWN, 0DTE or not. "0DTE" on its own states the
 * relationship to today but not WHICH book is on screen, and that is the thing
 * you need when the phone has been open since before midnight, or when the
 * screenshot gets read hours later. So the chip is two parts: the DTE tag when
 * it applies, and the MM/DD it resolves to, always.
 */
export default function ExpiryBadge({ expiry, isZeroDte }: { expiry: string; isZeroDte: boolean }) {
  if (!expiry) return null;
  const color = isZeroDte ? M_COLOR.orange : M_COLOR.dim;
  // Noon avoids the UTC-parse-then-render-local off-by-one that makes a bare
  // "YYYY-MM-DD" show as the previous day west of Greenwich.
  const dt = new Date(expiry + "T12:00:00");
  const date = Number.isNaN(dt.getTime())
    ? expiry
    : `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
  return (
    <span
      title={isZeroDte ? `Today's expiry — ${expiry}` : `No 0DTE listed; showing front expiry ${expiry}`}
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 26,
        padding: "0 9px",
        borderRadius: RADIUS.pill,
        border: `1px solid ${rgba(isZeroDte ? M_COLOR.orange : "#ffffff", isZeroDte ? 0.4 : 0.14)}`,
        background: isZeroDte ? rgba(M_COLOR.orange, 0.14) : "rgba(255,255,255,0.04)",
        color,
        fontSize: TYPE.micro,
        fontWeight: 800,
        letterSpacing: "0.07em",
        whiteSpace: "nowrap",
      }}
    >
      {isZeroDte && <span>0DTE</span>}
      <span
        style={{
          ...MONO,
          letterSpacing: "0.02em",
          fontWeight: isZeroDte ? 700 : 800,
          opacity: isZeroDte ? 0.8 : 1,
        }}
      >
        {date}
      </span>
    </span>
  );
}
