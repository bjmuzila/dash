import { NextRequest, NextResponse } from "next/server";

const PROXY_BASE = process.env.EM_PROXY_BASE ?? "http://localhost:3001";

// Catch-all proxy: /api/em/[...path] → http://localhost:3001/proxy/api/tt/[...path]
// Also handles: /api/em/subscription-ready, /api/em/discord-webhook
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(req, path, "GET");
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(req, path, "POST");
}

async function proxyRequest(
  req: NextRequest,
  pathSegments: string[],
  method: string
): Promise<NextResponse> {
  // Map /api/em/subscription-ready → /proxy/api/subscription-ready
  // Map /api/em/discord-webhook   → /proxy/api/discord-webhook
  // Map /api/em/tt/...            → /proxy/api/tt/...
  // Map /api/em/...               → /proxy/api/tt/...  (default: tt namespace)
  const joined = pathSegments.join("/");
  let upstreamPath: string;
  if (joined.startsWith("subscription-ready") || joined.startsWith("discord-webhook")) {
    upstreamPath = `/proxy/api/${joined}`;
  } else {
    upstreamPath = `/proxy/api/tt/${joined}`;
  }

  const search = req.nextUrl.search;
  const upstreamUrl = `${PROXY_BASE}${upstreamPath}${search}`;

  try {
    const body = method === "POST" ? await req.arrayBuffer() : undefined;
    const headers: Record<string, string> = {};
    req.headers.forEach((val, key) => {
      if (!["host", "connection", "content-length"].includes(key)) {
        headers[key] = val;
      }
    });

    const res = await fetch(upstreamUrl, {
      method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      signal: AbortSignal.timeout(15000),
    });

    const responseBody = await res.arrayBuffer();
    const responseHeaders = new Headers();
    res.headers.forEach((val, key) => {
      if (!["transfer-encoding", "connection"].includes(key)) {
        responseHeaders.set(key, val);
      }
    });
    responseHeaders.set("Access-Control-Allow-Origin", "*");

    return new NextResponse(responseBody, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error(`[/api/em] proxy error → ${upstreamUrl}:`, err);
    return NextResponse.json(
      { error: "Proxy request failed", detail: String(err) },
      { status: 502 }
    );
  }
}
