import AuthForm from "@/components/auth/AuthForm";
import { BRAND_LOGO_SRC, BRAND_LOGO_ALT } from "@/lib/brand";
import { V3 } from "@/components/landing/v3Theme";

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
        <AuthForm mode="signup" next={next} />
      </div>
    </div>
  );
}
