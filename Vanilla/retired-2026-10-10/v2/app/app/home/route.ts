import { serveSpaShell } from "@/lib/serveSpaShell";
import { getLatestHomeStaticSnapshot } from "@/lib/db";

export const dynamic = "force-dynamic";

// Guard rail: the seed is an optimisation, never a dependency. If the snapshot
// query is slow or the DB is down we ship the shell immediately and HomeRoute
// falls back to its /api/home-snapshot fetch, exactly as before.
const SEED_TIMEOUT_MS = 250;

async function readSeed() {
  try {
    const row = await Promise.race([
      getLatestHomeStaticSnapshot(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SEED_TIMEOUT_MS)),
    ]);
    if (!row?.payload) return null;
    return { homeSnapshot: { ts: row.ts ?? null, snapshot: row.payload } };
  } catch {
    return null;
  }
}

// Inlining the snapshot into the document removes a fully serialised round trip
// from first paint: HomeRoute used to render `null` until its own fetch of
// /api/home-snapshot resolved, and that fetch could not even START until the
// entry chunk and the route chunk had both downloaded and executed.
export const GET = async () => serveSpaShell("app", await readSeed());
