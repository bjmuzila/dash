"use client";

import Link from "next/link";
import { V3, V3_TEXT, v3DisabledButton, v3GhostButton, v3PrimaryButton } from "@/components/landing/v3Theme";
import {
  SALES_CLOSED,
  SALES_CLOSED_LABEL,
  VOLTICK_CODE,
  VOLTICK_URL,
} from "@/lib/salesClosed";

// Signed-out CTA for the pricing page. Beta/prelaunch gating removed now that
// the full launch has shipped — signups are open, so this is just the
// join-vs-sign-in choice (plan is picked right after account creation).
//
// 2026-09-10: v3 controls (v3Theme) instead of the v2 gradient pill. The name
// is historical; it is the signed-out join block.
export default function BetaGate() {
  // Sales closed (lib/salesClosed.ts): "Join now" becomes a dead plate and
  // "I already have an account" is promoted to the live action, because that is
  // the only thing a visitor here can still usefully do.
  if (SALES_CLOSED) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span
          style={{ ...v3DisabledButton, width: "100%", boxSizing: "border-box", fontSize: V3_TEXT.body }}
          aria-disabled="true"
        >
          {SALES_CLOSED_LABEL}
        </span>
        <Link href="/sign-in?next=/v3" style={{ ...v3PrimaryButton, width: "100%", boxSizing: "border-box", fontSize: V3_TEXT.body }}>
          I already have an account
        </Link>
        <p style={{ color: V3.fg, fontSize: V3_TEXT.xs, margin: "4px 0 0", lineHeight: 1.45, textAlign: "center" }}>
          Looking for a GEX platform?{" "}
          <a href={VOLTICK_URL} style={{ color: V3.cyan, fontWeight: 700 }}>Voltick</a>{" "}
          covers 1,000+ tickers. CB Edge members get 75% off with code{" "}
          <b style={{ color: V3.cyan, fontWeight: 700 }}>{VOLTICK_CODE}</b>.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Link href="/sign-up?next=/pricing" style={{ ...v3PrimaryButton, width: "100%", boxSizing: "border-box", fontSize: V3_TEXT.body }}>
        Join now — create account
      </Link>
      <Link href="/sign-in?next=/pricing" style={{ ...v3GhostButton, width: "100%", boxSizing: "border-box" }}>
        I already have an account
      </Link>
      <p style={{ color: V3.fg, fontSize: V3_TEXT.xs, margin: "4px 0 0", lineHeight: 1.45, textAlign: "center" }}>
        You&apos;ll choose your plan right after creating your account.
      </p>
    </div>
  );
}
