import { NextRequest, NextResponse } from 'next/server';
import { ensureToken, ttFetch } from '@/lib/proxy/auth';

/**
 * Catch-all proxy route for all /api/* requests
 * Routes:
 *   /api/proxy/* -> forwards to TastyTrade/external APIs
 *   /api/snapshots -> Next.js native routes
 *   /api/tt/* -> TastyTrade API proxy
 */

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '');

  // Handle proxy/api/tt/* paths - route to TastyTrade with timeout
  if (path.startsWith('/proxy/api/tt/')) {
    try {
      const ttPath = path.replace('/proxy', ''); // /api/tt/...
      const hasToken = await ensureToken();
      if (!hasToken) {
        return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await ttFetch(ttPath + request.nextUrl.search);
      clearTimeout(timeout);
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    } catch (error) {
      console.error('[API] TastyTrade proxy error:', error);
      return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
    }
  }

  // Handle proxy/api/* paths - forward to proxy server
  if (path.startsWith('/proxy/')) {
    try {
      // Try local first, fall back to remote if needed
      const localProxyUrl = `http://127.0.0.1:3001${path}${request.nextUrl.search}`;
      const remoteProxyUrl = process.env.REMOTE_PROXY_URL
        ? `${process.env.REMOTE_PROXY_URL}${path}${request.nextUrl.search}`
        : null;

      let response;
      try {
        response = await Promise.race([
          fetch(localProxyUrl, { method: 'GET' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
      } catch (localErr) {
        if (remoteProxyUrl) {
          console.log('[PROXY] Local failed, trying remote:', remoteProxyUrl);
          response = await fetch(remoteProxyUrl, { method: 'GET' });
        } else {
          throw localErr;
        }
      }

      const data = await response.json().catch(() => response.text());
      return NextResponse.json(data, { status: response.status });
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

    // Handle proxy/api/tt/* paths
    if (path.startsWith('/proxy/api/tt/')) {
      const ttPath = path.replace('/proxy', '');
      const hasToken = await ensureToken();
      if (!hasToken) {
        return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
      }

      const response = await ttFetch(ttPath + request.nextUrl.search, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    }

    // Forward to proxy server on 3001
    if (path.startsWith('/proxy/')) {
      const proxyUrl = `http://127.0.0.1:3001${path}${request.nextUrl.search}`;
      console.log('[PROXY] POST', proxyUrl);
      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => response.text());
      return NextResponse.json(data, { status: response.status });
    }
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
      const proxyUrl = `http://127.0.0.1:3001${path}${request.nextUrl.search}`;
      console.log('[PROXY] DELETE', proxyUrl);
      const response = await fetch(proxyUrl, { method: 'DELETE' });
      const data = await response.json().catch(() => response.text());
      return NextResponse.json(data, { status: response.status });
    }
  } catch (error) {
    console.error('[PROXY] DELETE error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
