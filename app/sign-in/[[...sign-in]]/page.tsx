import AuthForm from "@/components/auth/AuthForm";

export const dynamic = "force-dynamic";

// Defaults to /home after sign-in; callers that know the user should return to
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
        background: "#05060A",
        padding: 20,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <img src="/cb-edge-logo.png" alt="CB Edge" style={{ height: 128, width: "auto" }} />
        <AuthForm mode="signin" next={next} />
      </div>
    </div>
  );
}
