import { NextRequest, NextResponse } from "next/server";

/**
 * TEMPORARY debug endpoint — dumps every header the Next app actually
 * receives, so we can see whether Cloudflare's cf-ipcountry / cf-ipcity /
 * cf-region headers (from the "Add visitor location headers" managed
 * transform) survive the cloudflared tunnel hop, or get dropped somewhere
 * before they reach this process.
 *
 * Hit GET /api/debug-headers from a real browser (not curl on the VPS —
 * that request never crosses the Cloudflare edge, so it'll never show these
 * headers even if everything is wired correctly). Delete this route once
 * the geo-header issue is diagnosed — it's not meant to ship long-term.
 */
export async function GET(req: NextRequest) {
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return NextResponse.json({
    headers,
    cf: {
      "cf-ipcountry": req.headers.get("cf-ipcountry"),
      "cf-ipcity": req.headers.get("cf-ipcity"),
      "cf-region": req.headers.get("cf-region"),
      "cf-connecting-ip": req.headers.get("cf-connecting-ip"),
      "cf-ray": req.headers.get("cf-ray"),
      "x-forwarded-for": req.headers.get("x-forwarded-for"),
    },
  });
}
