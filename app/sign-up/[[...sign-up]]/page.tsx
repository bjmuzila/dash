import { SignUp } from "@clerk/nextjs";

// Public sign-up. Re-enabled for paid launch (was redirect-to-landing pre-launch).
// New users land on /home after sign-up; the /home gate sends them to /pricing
// until they have an active subscription.
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
      }}
    >
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/home" />
    </div>
  );
}
