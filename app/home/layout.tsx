import { redirect } from "next/navigation";
import { getAccess } from "@/lib/subscription";

// Server gate for the paid product. Middleware already guarantees a signed-in
// user reaches here; this adds the subscription check. Unpaid users are sent to
// /pricing. The owner and any active/trialing subscriber pass through.
export const dynamic = "force-dynamic";

export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const access = await getAccess();
  if (!access.ok) {
    if (access.reason === "unauthenticated") redirect("/");
    redirect("/pricing");
  }
  return <>{children}</>;
}
