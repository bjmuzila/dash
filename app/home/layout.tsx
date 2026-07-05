import { redirect } from "next/navigation";
import { getAccess } from "@/lib/subscription";

// Server gate for the paid product. Middleware already guarantees a signed-in
// user reaches here. Signed-out visitors are bounced to "/".
//
// Unpaid-but-signed-in users are NOT redirected to /pricing anymore — /home
// itself renders a delayed/static snapshot for them (see app/home/page.tsx,
// getAccess().ok branch). Redirecting here used to send unpaid users to
// /pricing, but /pricing's own "check out the dashboard" link points at
// /home — that created a /pricing <-> /home redirect loop unpaid signed-in
// users couldn't escape. Middleware's PAID_EXEMPT already allows /home for
// unpaid users; this layout must not re-add the gate it deliberately removed.
export const dynamic = "force-dynamic";

export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const access = await getAccess();
  if (!access.ok && access.reason === "unauthenticated") redirect("/");
  return <>{children}</>;
}
