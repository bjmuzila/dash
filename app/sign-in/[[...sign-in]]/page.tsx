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
      <AuthForm mode="signin" />
    </div>
  );
}
