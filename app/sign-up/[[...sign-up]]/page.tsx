import AuthForm from "@/components/auth/AuthForm";

export const dynamic = "force-dynamic";

// Public sign-up. New users land on /home after sign-up; the /home gate sends
// them to /pricing until they have an active subscription.
export default function SignUpPage() {
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
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
        <img src="/cb-edge-logo.png" alt="CB Edge" style={{ height: 64, width: "auto" }} />
        <AuthForm mode="signup" />
      </div>
    </div>
  );
}
