import AuthForm from "@/components/auth/AuthForm";

export const dynamic = "force-dynamic";

// Public sign-up. Defaults to landing on /home after sign-up, but callers that
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
        background: "#05060A",
        padding: 20,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <img src="/cb-edge-logo.png" alt="CB Edge" style={{ height: 128, width: "auto" }} />
        <AuthForm mode="signup" next={next} />
      </div>
    </div>
  );
}
