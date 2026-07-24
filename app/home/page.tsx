/**
 * /home — now a thin redirect into the Vite SPA.
 *
 * The home dashboard is served by the app-vite SPA at /app/home. This route
 * used to render HomeClient via Next SSR (with an unpaid "delayed" snapshot
 * path); that's retired now that new users get a trial. Paid/trialing users are
 * sent to the SPA home; anyone without access lands on pricing.
 *
 * Note on the loop guard: middleware redirects non-paid users TO /home, so we
 * must NOT blindly forward everyone to /app/home (which is paid-gated) — that
 * would ping-pong. Gate the forward on access; unpaid → /pricing instead.
 */
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/subscription";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const access = await getAccess();
  if (!access.ok) redirect("/pricing");
  redirect("/app/home");
}
