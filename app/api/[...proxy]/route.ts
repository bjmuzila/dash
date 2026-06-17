import { NextRequest, NextResponse } from 'next/server';
/**
 * Catch-all proxy route for all /api/* requests
 * Routes:
 *   /api/proxy/* -> forwards to the local market-data proxy
 *   /api/snapshots -> Next.js native routes
 */

const PROXY = process.env.PROXY_URL ?? 'http://127.0.0.1:3001';

async function proxyJson(path: string, init?: RequestInit) {
  const response = await fetch(`${PROXY}${path}`, {
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
  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '');

  // Handle keepalive - proxy health check
  if (path === '/keepalive') {
    try {
      const res = await fetch('http://127.0.0.1:3001/health', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return NextResponse.json({ ok: false }, { status: 500 });
      const data = await res.json();
      return NextResponse.json(data);
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  }

  // Handle /api/proxy/* paths - forward to the live proxy server.
  if (path.startsWith('/proxy/')) {
    try {
      return await proxyJson(`${path}${request.nextUrl.search}`, { method: 'GET', cache: 'no-store' });
    } catch (error) {
      console.error('[PROXY] GET error:', error);
      return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
    }
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '');

  try {
    const body = await request.json();

    // Forward to proxy server on 3001
    if (path.startsWith('/proxy/')) {
      return await proxyJson(`${path}${request.nextUrl.search}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    console.error('[API] POST error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '');

  try {
    if (path.startsWith('/proxy/')) {
      return await proxyJson(`${path}${request.nextUrl.search}`, { method: 'DELETE' });
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    console.error('[PROXY] DELETE error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
