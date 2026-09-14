/**
 * /mult-greek — a thin redirect into the dashboard. RETIRED 2026-09-14.
 *
 * This route used to render MultGreekClient directly (live chains for paid
 * users, the frozen snapshot for unpaid). It was the last v2 PAGE still
 * rendering its own client to customers: bare /mult-greek is a Next route, so
 * it is not in next.config.js's SPA aliases and never passed through
 * lib/v3Routes.ts, and it is in middleware's PAID_EXEMPT — three separate
 * reasons nothing ever redirected it. The result was a page that quietly
 * stayed alive after v3 became the dashboard.
 *
 * What that cost: in the 30 days to 2026-09-14, 18 distinct visitors landed
 * here, and one of them spent the bulk of his only real session on it before
 * asking for a refund because the product "wasn't working". He was right — he
 * was looking at the retired dashboard.
 *
 * The numbers did not go anywhere. Multi Greek is a BOARD CARD in v3
 * (cbedge-v3/src/board — see the "/mult-greek" entry in lib/v3Routes.ts, which
 * maps it to v3's root for exactly this reason) and the phone Heat tab at
 * /v3/m/heat. A card is not the page; that trade was made deliberately on
 * 2026-09-06 and this route existing did not un-make it, it just gave a few
 * customers a worse copy of it.
 *
 * Mirrors app/home/page.tsx exactly, including the loop guard: middleware
 * sends non-paid users TO /home, and /mult-greek is in the same PAID_EXEMPT
 * list, so forwarding everyone to the paid-gated /v3 would ping-pong. Gate the
 * forward on access; unpaid → /pricing.
 *
 * STILL HERE ON PURPOSE: ./MultGreekClient.tsx and the snapshot plumbing
 * (server-v2/mult-greek-snapshot-recorder.js, /api/mult-greek-snapshot,
 * lib/db getLatestMultGreekStaticSnapshot). Nothing renders the client now,
 * but deleting 178KB of it plus a live recorder is a separate decision from
 * closing the door.
 */
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/subscription";

export const dynamic = "force-dynamic";

export default async function MultGreekPage() {
  const access = await getAccess();
  if (!access.ok) redirect("/pricing");
  redirect("/v3");
}
