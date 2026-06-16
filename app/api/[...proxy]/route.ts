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

  // Handle proxy/api/tt/* paths - route to TastyTrade
  if (path.startsWith('/proxy/api/tt/')) {
    try {
      const ttPath = path.replace('/proxy', ''); // /api/tt/...
      const hasToken = await ensureToken();
      if (!hasToken) {
        return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
      }

      const ttResponse = await ttFetch(ttPath + request.nextUrl.search);
      const data = await ttResponse.json();
      return NextResponse.json(data, { status: ttResponse.status });
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

      let proxyResponse: Response;
      try {
        proxyResponse = await Promise.race([
          fetch(localProxyUrl, { method: 'GET' }),
          new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
      } catch (localErr) {
        if (remoteProxyUrl) {
          console.log('[PROXY] Local failed, trying remote:', remoteProxyUrl);
          proxyResponse = await fetch(remoteProxyUrl, { method: 'GET' });
        } else {
          throw localErr;
        }
      }

      const data = await proxyResponse.json().catch(() => proxyResponse.text());
      return NextResponse.json(data, { status: proxyResponse.status });
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

      const ttResponse = await ttFetch(ttPath + request.nextUrl.search, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = await ttResponse.json();
      return NextResponse.json(data, { status: ttResponse.status });
    }

    // Forward to proxy server on 3001
    if (path.startsWith('/proxy/')) {
      const proxyUrl = `http://127.0.0.1:3001${path}${request.nextUrl.search}`;
      console.log('[PROXY] POST', proxyUrl);
      const proxyResponse = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await proxyResponse.json().catch(() => proxyResponse.text());
      return NextResponse.json(data, { status: proxyResponse.status });
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
      const proxyUrl = `http://127.0.0.1:3001${path}${request.nextUrl.search}`;
      console.log('[PROXY] DELETE', proxyUrl);
      const proxyResponse = await fetch(proxyUrl, { method: 'DELETE' });
      const data = await proxyResponse.json().catch(() => proxyResponse.text());
      return NextResponse.json(data, { status: proxyResponse.status });
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    console.error('[PROXY] DELETE error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
