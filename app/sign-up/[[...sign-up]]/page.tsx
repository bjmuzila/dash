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
      <AuthForm mode="signup" />
    </div>
  );
}
