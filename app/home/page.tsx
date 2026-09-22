/**
 * /home — a thin redirect into the dashboard.
 *
 * The home board is v3's, and it is v3's ROOT: /v3. This route used to render
 * HomeClient via Next SSR (with an unpaid "delayed" snapshot path); that was
 * retired when new users started getting a trial, and it then forwarded to the
 * v2 SPA at /app/home. /app/home itself was retired 2026-09-06 — see the
 * "/home" entry in lib/v3Routes.ts — so this goes straight to /v3 now.
 * Forwarding to /app/home would still work (middleware would bounce it on to
 * /v3), but it would spend a hop and flash the v2 shell to do it.
 *
 * Note on the loop guard: middleware redirects non-paid users TO /home, so we
 * must NOT blindly forward everyone to /v3, which is paid-gated — that would
 * ping-pong. Gate the forward on access; unpaid go elsewhere.
 *
 * WHERE "ELSEWHERE" IS (2026-09-22). This is where every sign-in lands
 * (AuthForm's default `next`), so it decides what an unpaid account sees first.
 * While sales are closed that is the landing page, not /pricing · Brandon:
 * "everyone but paid or comped users should be redirected to the home page if
 * they sign in." With sales open it is /pricing again, because there is
 * something to buy. app/page.tsx is the other half: it no longer forwards an
 * unpaid session to /v3, which is what keeps "/" → /home → "/" from looping.
 *
 * ACCESS COMES FROM THE SESSION, NOT getAccess(). getAccess() (lib/subscription.ts)
 * reads the subscriptions table only and never sees a comp_access grant, so a
 * comped member reaching /home was sent to /pricing · the paid gate let them in
 * and this page threw them back out. getServerSession() resolves through
 * getSessionWithUser, the same "Stripe OR comp" is_paid the middleware gate uses.
 */
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/supabase/server";
import { SALES_CLOSED } from "@/lib/salesClosed";

export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

export default async function HomePage() {
  const session = await getServerSession();
  const hasAccess =
    !!session &&
    (session.isPaid ||
      session.isOwner ||
      (OWNER_USER_ID !== "" && session.userId === OWNER_USER_ID));
  if (hasAccess) redirect("/v3");
  redirect(SALES_CLOSED ? "/" : "/pricing");
}
