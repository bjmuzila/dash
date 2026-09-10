import AuthForm from "@/components/auth/AuthForm";
import { BRAND_LOGO_SRC, BRAND_LOGO_ALT } from "@/lib/brand";
import { V3 } from "@/components/landing/v3Theme";

export const dynamic = "force-dynamic";

// Defaults to /home after sign-in (it routes paid → /v3, unpaid → /pricing); callers that know the user should return to
// a specific step (e.g. pricing's "Join now" / "I already have an account")
// pass ?next=/pricing so they land back there instead of the dashboard.
export default async function SignInPage({
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
        {/* The 3.0 lockup from lib/brand.ts — this page was the last one still
            pointing at the retired /cb-edge-logo.png. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BRAND_LOGO_SRC} alt={BRAND_LOGO_ALT} style={{ width: 300, maxWidth: "80%", height: "auto" }} />
        <AuthForm mode="signin" next={next} />
      </div>
    </div>
  );
}
