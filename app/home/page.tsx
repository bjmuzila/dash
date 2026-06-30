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

export default async function HomePage() {
  const initial = await readInitial();
  return <HomeClient initial={initial} />;
}
