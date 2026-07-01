import { redirect } from "next/navigation";
import { getServerUserId } from "@/lib/supabase/server";
import LandingClient from "@/components/landing/LandingClient";

export const dynamic = "force-dynamic";

// Public landing page. Signed-in users skip straight to the dashboard.
export default async function RootPage() {
  const userId = await getServerUserId();
  if (userId) redirect("/traders-dashboard");
  return <LandingClient />;
}
