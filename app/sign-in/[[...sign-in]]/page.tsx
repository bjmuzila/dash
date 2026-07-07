import AuthForm from "@/components/auth/AuthForm";

export const dynamic = "force-dynamic";

export default function SignInPage() {
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
        <AuthForm mode="signin" />
      </div>
    </div>
  );
}
