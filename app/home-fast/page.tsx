/**
 * /home-fast — PROOF OF CONCEPT for server-rendering a live card from the hot
 * in-memory feed, instead of the client-fetch waterfall used on /home.
 *
 * How it differs from /home:
 *   • This page is a SERVER component (no "use client"). It runs on the server
 *     at request time, reads the live GEX snapshot the server-v2 feed already
 *     holds in memory (via the in-process /proxy/gex endpoint), and bakes the
 *     numbers straight into the HTML.
 *   • The user therefore sees REAL GEX data in the very first paint — no blank
 *     card, no "Fetching SPX chain…", no client round-trip before content.
 *   • A small client island then connects the WebSocket to keep it live.
 *
 * This is intentionally isolated: it does not touch /home, the shell, or any
 * shared component, so it's safe to ship alongside the launch and compare.
 */

import HomeFastLive from "./HomeFastLive";

// Always render fresh from the hot feed; never serve a cached snapshot (stale
// GEX is worse than a fast re-render from memory).
export const dynamic = "force-dynamic";

type GexSnapshot = {
  spotPrice: number;
  expiration: string | null;
  callWall: number | null;
  putWall: number | null;
  gexFlip: number | null;
  totalNetGex: number | null;
  updatedAt: string | null;
  rowCount: number;
};

function proxyBase(): string {
  return (
    process.env.PROXY_V2_URL ||
    `http://127.0.0.1:${process.env.PORT || "3002"}`
  ).replace(/\/$/, "");
}

/**
 * Read the live snapshot the server already holds. This runs on the server, so
 * the localhost hop is sub-millisecond and the result is embedded in the HTML
 * the browser receives — the data arrives WITH the page, not after it.
 */
async function readLiveGex(): Promise<GexSnapshot | null> {
  try {
    const res = await fetch(`${proxyBase()}/proxy/gex`, { cache: "no-store" });
    if (!res.ok) return null;
    const v2 = await res.json();
    return {
      spotPrice: Number(v2.spot ?? 0),
      expiration: v2.expiry ?? null,
      callWall: v2.callWall ?? null,
      putWall: v2.putWall ?? null,
      gexFlip: v2.gexFlip ?? null,
      totalNetGex: v2.totalNetGex ?? null,
      updatedAt: v2.updatedAt ?? null,
      rowCount: Array.isArray(v2.gexRows) ? v2.gexRows.length : 0,
    };
  } catch {
    return null;
  }
}

function fmtGex(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = v >= 0 ? "+" : "-";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(2)}K`;
  return `${s}$${a.toFixed(0)}`;
}

function fmtNum(v: number | null): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  return Math.round(v).toLocaleString();
}

export default async function HomeFastPage() {
  // This await happens ON THE SERVER before HTML is sent — the page ships with
  // data already in it.
  const snap = await readLiveGex();

  const stat = (label: string, value: string, accent?: string) => (
    <div
      style={{
        flex: "1 1 140px",
        background: "rgba(13,17,25,0.6)",
        border: "1px solid rgba(33,158,188,0.12)",
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: 0.5, color: "#8B94A7", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ?? "#E6EDF5", marginTop: 4, fontFamily: "monospace" }}>
        {value}
      </div>
    </div>
  );

  return (
    <div style={{ padding: 24, color: "#E6EDF5", minHeight: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Home (server-rendered)</h1>
        <span style={{ fontSize: 12, color: "#6b7689" }}>
          live snapshot baked into HTML at request time
        </span>
      </div>

      {snap == null ? (
        <p style={{ color: "#EAB308", marginTop: 16 }}>
          Feed not reachable right now — the server-v2 proxy didn&apos;t answer. (This
          is the only failure mode; when the feed is up, data is always present on
          first paint.)
        </p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "#6b7689", margin: "8px 0 16px" }}>
            SPX {snap.spotPrice ? snap.spotPrice.toFixed(2) : "—"} · {snap.rowCount} strikes ·
            exp {snap.expiration ?? "—"} · server time {snap.updatedAt ?? "—"}
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, maxWidth: 760 }}>
            {stat("Net GEX", fmtGex(snap.totalNetGex), (snap.totalNetGex ?? 0) >= 0 ? "#219EBC" : "#EAB308")}
            {stat("Call Wall", fmtNum(snap.callWall), "#29b6f6")}
            {stat("Put Wall", fmtNum(snap.putWall), "#ffb300")}
            {stat("GEX Flip", fmtNum(snap.gexFlip), "#FB8501")}
          </div>

          {/* Client island: keeps the numbers live via WebSocket after the
              instant server-rendered first paint. */}
          <HomeFastLive initial={snap} />
        </>
      )}
    </div>
  );
}
