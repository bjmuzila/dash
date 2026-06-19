import { redirect } from "next/navigation";

// Public sign-up is disabled pre-launch. Anyone hitting /sign-up is sent to
// the landing page (waitlist + sign-in only).
export default function SignUpPage() {
  redirect("/");
}
