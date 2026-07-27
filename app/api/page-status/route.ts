import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { getPageLoadStatus, upsertPageLoadStatus, insertPageVisit } from "@/lib/db";
import { buildAttribution, SELF_HOSTS } from "@/lib/visitorAttribution";

// Pull the client IP from the proxy headers (Cloudflare / VPS set these). The
// browser never sends its own IP, so this is the trustworthy source. Takes the
// FIRST entry of x-forwarded-for (the original client), falling back to other
// common headers.
function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    null
  );
}

// Visitor geo from Cloudflare's "Add visitor location headers" managed transform
// (Rules → Transform Rules → Managed Transforms). Everything here stays NULL
// until that toggle is on, and for requests that never crossed the edge (local
// dev, container health checks) — so treat it as best-effort, never required.
//
// cf-ipcountry has two sentinels worth knowing: "XX" (Cloudflare couldn't place
// the IP) and "T1" (Tor exit node). Both are stored verbatim; the owner map
// groups them under "Unknown" rather than pretending they're real countries.
function trimmed(v: string | null, max: number): string | null {
  if (!v) return null;
  const s = v.trim().slice(0, max);
  return s.length ? s : null;
}

/**
 * Parse a coordinate header. Cloudflare sends these as decimal strings; reject
 * anything non-finite or out of range so a malformed header can't poison the map
 * with a bubble in the middle of nowhere.
 */
function coord(v: string | null, max: number): number | null {
  if (!v) return null;
  const n = Number(v.trim());
  if (!Number.isFinite(n) || Math.abs(n) > max) return null;
  // 0,0 is Null Island — Cloudflare's "no idea" answer, not the Gulf of Guinea.
  return n;
}

function clientGeo(req: NextRequest): {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
} {
  const country = trimmed(req.headers.get("cf-ipcountry"), 2);
  const latitude = coord(req.headers.get("cf-iplatitude"), 90);
  const longitude = coord(req.headers.get("cf-iplongitude"), 180);
  // Drop the pair if either half is missing or it's exactly Null Island.
  const usable = latitude != null && longitude != null && !(latitude === 0 && longitude === 0);
  return {
    country: country ? country.toUpperCase() : null,
    region: trimmed(req.headers.get("cf-region"), 80),
    city: trimmed(req.headers.get("cf-ipcity"), 80),
    latitude: usable ? latitude : null,
    longitude: usable ? longitude : null,
  };
}

/**
 * Acquisition + device for one beacon.
 *
 * referrer/query come from the BODY (document.referrer, window.location.search
 * — sent by lib/pageStatus.ts), never from req.headers.referer: on a beacon that
 * header is the page firing it, so reading it would attribute every visit to us.
 *
 * Attribution is written only on the session's first beacon (body.isEntry);
 * device fields come from the UA header and are written on every row.
 */
function visitAttribution(req: NextRequest, body: Record<string, unknown>) {
  const isEntry = Boolean(body.isEntry ?? body.is_entry);
  // The host this request arrived on counts as "us" too, so staging hostnames
  // and preview domains don't show up as external referrers.
  const selfHosts = new Set(SELF_HOSTS);
  const host = (req.headers.get("host") || "").split(":")[0].toLowerCase().replace(/^www\./, "");
  if (host) selfHosts.add(host);

  const a = buildAttribution({
    referrer: isEntry ? body.referrer : null,
    query: isEntry ? body.query : null,
    userAgent: req.headers.get("user-agent"),
    selfHosts,
  });
  return {
    is_entry: isEntry,
    referrer: a.referrer,
    referrer_host: a.referrerHost,
    utm_source: a.utmSource,
    utm_medium: a.utmMedium,
    utm_campaign: a.utmCampaign,
    utm_term: a.utmTerm,
    utm_content: a.utmContent,
    // Only meaningful for an arrival — a mid-session row would always read
    // "direct" and drag every report toward it.
    channel: isEntry ? a.channel : null,
    browser: a.browser,
    os: a.os,
    device_type: a.deviceType,
    is_bot: a.isBot,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const isLoaded = Boolean(body.isLoaded ?? body.is_loaded);

    await upsertPageLoadStatus({
      page_key: String(body.pageKey ?? body.page_key ?? ""),
      page_label: body.pageLabel == null ? null : String(body.pageLabel),
      path: body.path == null ? null : String(body.path),
      is_loaded: isLoaded,
      last_loaded_at: body.lastLoadedAt == null ? null : String(body.lastLoadedAt),
      last_unloaded_at: body.lastUnloadedAt == null ? null : String(body.lastUnloadedAt),
    });

    // Log a visit row ONLY on real loads (not the unload beacon), mirroring the
    // total_loads counter. Best-effort userId (route is public — guests are fine).
    // Non-fatal: a visit-log failure must never break page-status reporting.
    if (isLoaded) {
      try {
        let userId: string | null = null;
        try { userId = await getServerUserId(); } catch { /* unauthenticated */ }
        const geo = clientGeo(req);
        await insertPageVisit({
          page_key: String(body.pageKey ?? body.page_key ?? ""),
          page_label: body.pageLabel == null ? null : String(body.pageLabel),
          path: body.path == null ? null : String(body.path),
          user_id: userId,
          ip: clientIp(req),
          country: geo.country,
          region: geo.region,
          city: geo.city,
          latitude: geo.latitude,
          longitude: geo.longitude,
          // Referrer / UTM (entry rows only) + browser/OS/device (every row).
          ...visitAttribution(req, body),
        });
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? 200), 1000);
    const rows = await getPageLoadStatus(limit);
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
