import { redirect } from "next/navigation";
import { getAccess } from "@/lib/subscription";

// Server gate for /home. Signed-out visitors are bounced to "/". Signed-in
// users fall through to app/home/page.tsx, which forwards paid users to /v3
// and unpaid users to /pricing. This layout must NOT redirect unpaid users to
// /pricing itself: middleware sends unpaid users TO /home, so a gate here would
// be a second copy of the paywall to keep in sync (and it once created a
// /pricing <-> /home loop). The "delayed snapshot" mode this comment used to
// describe was retired in 2026-09.
export const dynamic = "force-dynamic";

export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const access = await getAccess();
  if (!access.ok && access.reason === "unauthenticated") redirect("/");
  return <>{children}</>;
}
