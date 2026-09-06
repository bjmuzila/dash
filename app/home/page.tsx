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
 * ping-pong. Gate the forward on access; unpaid → /pricing instead.
 */
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/subscription";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const access = await getAccess();
  if (!access.ok) redirect("/pricing");
  redirect("/v3");
}
