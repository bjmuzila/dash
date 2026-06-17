import { NextRequest, NextResponse } from 'next/server';

/**
 * API route: /api/tt/*
 * Proxy all TastyTrade/dashboard calls through the local live proxy.
 * Examples:
 *   GET /api/tt/quotes-batch?symbols=SPX,VIX
 *   GET /api/tt/chains/SPX?expiration=2025-01-17
 *   GET /api/tt/option-marks?symbols=.SPX250117C5900
 */

const PROXY = process.env.PROXY_URL ?? 'http://127.0.0.1:3001';

async function forwardToProxy(path: string, init?: RequestInit) {
  const response = await fetch(`${PROXY}/proxy/api/tt${path}`, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { text };
  }
  return NextResponse.json(data, { status: response.status });
}

export async function GET(request: NextRequest) {
  try {
    // Extract path from URL
    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/^\/api\/tt\/(.*)$/);
    const path = pathMatch ? '/' + pathMatch[1] : '/';

    return await forwardToProxy(path + url.search, { method: 'GET', cache: 'no-store' });
  } catch (error) {
    console.error('[API/tt] Error:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Extract path from URL
    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/^\/api\/tt\/(.*)$/);
    const path = pathMatch ? '/' + pathMatch[1] : '/';

    const body = await request.json();

    return await forwardToProxy(path + url.search, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('[API/tt] Error:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
