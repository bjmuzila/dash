import Link from "next/link";
import AuthForm from "@/components/auth/AuthForm";
// Tracked outbound link — see components/analytics/VoltickLink.tsx. Someone
// who reached the sign-up page and then clicked through to Voltick is the
// highest-intent referral on the site; it should not be the untracked one.
import VoltickLink from "@/components/analytics/VoltickLink";
import { BRAND_LOGO_SRC, BRAND_LOGO_ALT } from "@/lib/brand";
import { V3, V3_RADIUS, V3_TEXT, v3PrimaryButton } from "@/components/landing/v3Theme";
import {
  SALES_CLOSED,
  SALES_CLOSED_BODY,
  VOLTICK_PUBLIC_PITCH,
} from "@/lib/salesClosed";

export const dynamic = "force-dynamic";

// Public sign-up. Defaults to landing on /home after sign-up (paid → /v3, unpaid → /pricing), but callers that
// know where the user should end up (e.g. the pricing page's "Join now" CTA)
// can pass ?next=/pricing so users who came to subscribe land back on the
// plan/checkout step instead of the general dashboard preview.
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // v3 canvas (2026-09-10). Was a hardcoded #05060A.
        background: V3.bg,
        padding: 20,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BRAND_LOGO_SRC} alt={BRAND_LOGO_ALT} style={{ width: 300, maxWidth: "80%", height: "auto" }} />
        {SALES_CLOSED ? (
          // Sales closed (lib/salesClosed.ts). The form is not rendered at all
          // here rather than disabled: an account with nothing to buy is a dead
          // row in the users table and a person who thinks they signed up for
          // something. Sign-IN is untouched and is offered right below.
          <div
            style={{
              maxWidth: 420,
              padding: "22px 24px",
              borderRadius: V3_RADIUS.lg,
              border: `1px solid ${V3.cyan}`,
              background: V3.surface,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: V3_TEXT.lg, fontWeight: 700, color: V3.fg, marginBottom: 10 }}>
              Sign-ups are closed
            </div>
            <p style={{ fontSize: V3_TEXT.base, color: V3.fg, lineHeight: 1.6, margin: "0 0 16px" }}>
              {SALES_CLOSED_BODY}
            </p>
            <Link href="/sign-in" style={{ ...v3PrimaryButton, width: "100%", boxSizing: "border-box" }}>
              Already a member? Sign in
            </Link>
            <p style={{ fontSize: V3_TEXT.xs, color: V3.fg, lineHeight: 1.5, margin: "14px 0 0" }}>
              Looking for a GEX platform?{" "}
              <VoltickLink placement="sign-up-notice" style={{ color: V3.cyan, fontWeight: 700 }}>Voltick</VoltickLink>.{" "}
              {/* No discount code — this page is for people who are not members,
                  and the code is members-only (lib/salesClosed.ts). */}
              {VOLTICK_PUBLIC_PITCH}
            </p>
          </div>
        ) : (
          <AuthForm mode="signup" next={next} />
        )}
      </div>
    </div>
  );
}
