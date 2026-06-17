import { NextRequest, NextResponse } from "next/server";

// Proxies /api/personal-logs[/...] → http://localhost:3001/proxy/api/personal-logs[/...]
const PROXY = `${process.env.PROXY_URL ?? "http://localhost:3001"}/proxy/api/personal-logs`;

function targetUrl(params: { path?: string[] }): string {
  const suffix = params.path?.length ? "/" + params.path.join("/") : "";
  return PROXY + suffix;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  try {
    const res = await fetch(targetUrl(await ctx.params), { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  try {
    const body = await req.text();
    const res = await fetch(targetUrl(await ctx.params), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  try {
    const res = await fetch(targetUrl(await ctx.params), { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
