/**
 * /home — server component.
 *
 * Reads the live GEX snapshot the server-v2 feed already holds in memory (hot
 * /proxy/gex, a sub-millisecond localhost hop) and bakes it into the HTML, then
 * hands off to the HomeClient island which opens /ws/gex and keeps everything
 * live. This means the GEX chart paints from the FIRST HTML frame instead of
 * waiting for the client to hydrate → open the socket → await the first message.
 *
 * Previously this whole page was a client component (the waterfall). The brakes
 * (readiness gate, throttles) existed to ration the old free dxLink/TT feed; on
 * paid Theta Pro we render straight from the hot snapshot.
 */
import { HomeClient, type HomeInitial } from "./HomeClient";
import type { ChainRow } from "@/lib/calculations/calculations";
import { getAccess } from "@/lib/subscription";
import { getLatestHomeStaticSnapshot } from "@/lib/db";

// Always render fresh from the hot feed; never serve a cached snapshot.
export const dynamic = "force-dynamic";

function proxyBase(): string {
  return (
    process.env.PROXY_V2_URL ||
    `http://127.0.0.1:${process.env.PORT || "3002"}`
  ).replace(/\/$/, "");
}

/** Read the hot in-memory snapshot the server already holds (runs server-side). */
async function readInitial(): Promise<HomeInitial> {
  try {
    const res = await fetch(`${proxyBase()}/proxy/gex`, { cache: "no-store" });
    if (!res.ok) return null;
    const v2 = await res.json();
    const rows = Array.isArray(v2.gexRows) ? (v2.gexRows as ChainRow[]) : [];
    if (!rows.length) return null; // nothing hot yet — let the client warm it
    const spot = Number(v2.spot ?? 0);
    return {
      gexRows: rows,
      spot,
      spotDisplay: Number(v2.spotDisplay ?? spot ?? 0),
      prevClose: Number(v2.prevClose ?? 0),
      expiry: String(v2.expiry ?? ""),
      expirations: Array.isArray(v2.expirations) ? (v2.expirations as string[]) : [],
      callWall: v2.callWall ?? null,
      putWall: v2.putWall ?? null,
      chartReady: true, // we only seed when rows exist, so the chart is ready
    };
  } catch {
    return null;
  }
}

/**
 * Unpaid signed-in users: reconstruct the SAME HomeInitial shape from the last
 * frozen full-chain snapshot (server-v2/home-snapshot-recorder.js, ~30m
 * cadence) instead of the hot feed. HomeClient renders it through the exact
 * same GexChart/toolbar — the only difference is `isStatic`, which keeps it
 * from opening the live /ws/gex connection (paid-gated anyway; see ws-auth.js).
 */
async function readStaticInitial(): Promise<{ initial: HomeInitial; snapshotTs: number | null }> {
  try {
    const row = await getLatestHomeStaticSnapshot();
    if (!row) return { initial: null, snapshotTs: null };
    const p = row.payload as Record<string, unknown> | null;
    const rows = Array.isArray(p?.gexRows) ? (p!.gexRows as ChainRow[]) : [];
    if (!rows.length) return { initial: null, snapshotTs: null };
    const spot = Number(p?.spot ?? 0);
    return {
      initial: {
        gexRows: rows,
        spot,
        spotDisplay: Number(p?.spotDisplay ?? spot ?? 0),
        prevClose: Number(p?.prevClose ?? 0),
        expiry: String(p?.expiry ?? ""),
        expirations: Array.isArray(p?.expirations) ? (p!.expirations as string[]) : [],
        callWall: (p?.callWall as number | null) ?? null,
        putWall: (p?.putWall as number | null) ?? null,
        chartReady: true,
      },
      snapshotTs: row.ts,
    };
  } catch {
    return { initial: null, snapshotTs: null };
  }
}

export default async function HomePage() {
  const access = await getAccess();

  if (!access.ok) {
    const { initial, snapshotTs } = await readStaticInitial();
    return <HomeClient initial={initial} isStatic snapshotTs={snapshotTs} />;
  }

  const initial = await readInitial();
  return <HomeClient initial={initial} />;
}
