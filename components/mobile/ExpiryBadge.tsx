"use client";

import { M_COLOR, MONO, RADIUS, TYPE, rgba } from "./mobileTheme";

/**
 * ExpiryBadge — the phone build's read-only expiry indicator.
 *
 * There is no expiry picker on mobile: every GEX surface is pinned to the front
 * expiry of the session you are trading (see useMobileGex — it rolls to the
 * next day at 6pm ET). This is what replaced the picker — a badge that states
 * which expiry you are looking at, in one chip instead of a scrolling row.
 *
 * It says "0DTE" only when the expiry really is today. After the 6pm roll it
 * says "1DTE", and over a weekend or holiday whatever the gap actually is — a
 * badge reading "0DTE" over next Friday's book would be worse than no badge at
 * all. Only 0DTE gets the orange treatment; that is the one that decays today.
 *
 * THE DATE IS ALWAYS SHOWN, 0DTE or not. "0DTE" on its own states the
 * relationship to today but not WHICH book is on screen, and that is the thing
 * you need when the phone has been open since before midnight, or when the
 * screenshot gets read hours later. So the chip is two parts: the DTE tag when
 * it applies, and the MM/DD it resolves to, always.
 */
export default function ExpiryBadge({
  expiry,
  isZeroDte,
  dte = null,
}: {
  expiry: string;
  isZeroDte: boolean;
  /** Whole days to expiry, from useMobileGex. Omit and the chip shows 0DTE-or-nothing. */
  dte?: number | null;
}) {
  if (!expiry) return null;
  // Past 9DTE the number stops being useful on a 26px chip and the date says it.
  const tag = isZeroDte ? "0DTE" : dte != null && dte > 0 && dte <= 9 ? `${dte}DTE` : null;
  const color = isZeroDte ? M_COLOR.orange : M_COLOR.dim;
  // Noon avoids the UTC-parse-then-render-local off-by-one that makes a bare
  // "YYYY-MM-DD" show as the previous day west of Greenwich.
  const dt = new Date(expiry + "T12:00:00");
  const date = Number.isNaN(dt.getTime())
    ? expiry
    : `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
  return (
    <span
      title={
        isZeroDte
          ? `Today's expiry — ${expiry}`
          : `Front expiry for the current session — ${expiry}${dte != null ? ` (${dte}DTE)` : ""}`
      }
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
      {tag && <span>{tag}</span>}
      <span
        style={{
          ...MONO,
          letterSpacing: "0.02em",
          fontWeight: tag ? 700 : 800,
          opacity: tag ? 0.8 : 1,
        }}
      >
        {date}
      </span>
    </span>
  );
}
