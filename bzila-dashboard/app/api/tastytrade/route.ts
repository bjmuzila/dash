import { NextResponse } from "next/server";

const TT_BASE = process.env.TT_BASE_URL ?? "https://api.tastytrade.com";

// In-memory session cache — avoids re-authing on every request
let cachedSession: { sessionToken: string; streamerToken: string; dxfeedUrl: string; expiresAt: number } | null = null;

async function getSession() {
  // Return cached session if still valid (expire 10 min early to be safe)
  if (cachedSession && Date.now() < cachedSession.expiresAt) {
    return cachedSession;
  }

  const clientSecret = process.env.TT_CLIENT_SECRET;
  const refreshToken = process.env.TT_REFRESH_TOKEN;

  if (!clientSecret || !refreshToken) {
    throw new Error("TT_CLIENT_SECRET or TT_REFRESH_TOKEN not configured");
  }

  // Exchange refresh token for a new session token
  const tokenRes = await fetch(`${TT_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`TT OAuth failed (${tokenRes.status}): ${text}`);
  }

  const tokenData = await tokenRes.json();
  const sessionToken: string =
    tokenData?.["session-token"] ?? tokenData?.data?.["session-token"] ?? tokenData?.access_token;

  if (!sessionToken) {
    throw new Error(`No session token in response: ${JSON.stringify(tokenData)}`);
  }

  // Fetch DXFeed streamer token
  const streamerRes = await fetch(`${TT_BASE}/quote-streamer-tokens`, {
    headers: { Authorization: sessionToken },
  });

  if (!streamerRes.ok) {
    throw new Error(`Failed to fetch streamer token (${streamerRes.status})`);
  }

  const streamerData = await streamerRes.json();
  const streamerToken: string = streamerData?.data?.token;
  const dxfeedUrl: string =
    streamerData?.data?.["websocket-url"] ?? (process.env.DXFEED_WS_URL as string);

  cachedSession = {
    sessionToken,
    streamerToken,
    dxfeedUrl,
    expiresAt: Date.now() + 50 * 60 * 1000, // cache 50 minutes
  };

  return cachedSession;
}

// POST /api/tastytrade  →  { session_token, streamer_token, dxfeed_url }
export async function POST() {
  try {
    const session = await getSession();
    return NextResponse.json({
      session_token: session.sessionToken,
      streamer_token: session.streamerToken,
      dxfeed_url: session.dxfeedUrl,
    });
  } catch (err) {
    console.error("[/api/tastytrade]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// GET /api/tastytrade  →  health check + session validity
export async function GET() {
  try {
    const session = await getSession();
    return NextResponse.json({
      status: "ok",
      base: TT_BASE,
      dxfeed_url: session.dxfeedUrl,
      expires_in_ms: session.expiresAt - Date.now(),
    });
  } catch (err) {
    return NextResponse.json({ status: "error", error: String(err) }, { status: 500 });
  }
}
