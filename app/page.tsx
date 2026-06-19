import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import LandingClient from "@/components/landing/LandingClient";

// Public landing page. Signed-in users skip straight to the dashboard.
export default async function RootPage() {
  const { userId } = await auth();
  if (userId) redirect("/home");
  return <LandingClient />;
}
