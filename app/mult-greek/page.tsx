/**
 * /mult-greek — server component.
 *
 * Paid/owner users get the existing client-only experience (live /api/chains
 * fetch loop). Unpaid signed-in users get the SAME MultGreekClient rendered in
 * "delayed" mode: seeded from the last frozen SPX/SPY/QQQ snapshot
 * (server-v2/mult-greek-snapshot-recorder.js, ~30m cadence) instead of hitting
 * live TT chains — mirrors the app/home split (page.tsx decides live vs
 * static, HomeClient/MultGreekClient renders either the same way).
 */
import { MultGreekClient, type MultGreekSnapshot } from "./MultGreekClient";
import { getAccess } from "@/lib/subscription";
import { getLatestMultGreekStaticSnapshot } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function MultGreekPage() {
  const access = await getAccess();

  if (!access.ok) {
    const row = await getLatestMultGreekStaticSnapshot();
    return (
      <MultGreekClient
        isStatic
        initialSnapshot={(row?.payload as MultGreekSnapshot | undefined) ?? null}
        snapshotTs={row?.ts ?? null}
      />
    );
  }

  return <MultGreekClient />;
}
