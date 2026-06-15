import { NextRequest, NextResponse } from 'next/server';
import { ensureToken, ttFetch } from '@/lib/proxy/auth';

/**
 * Catch-all proxy route for all /api/* requests
 * Routes:
 *   /api/proxy/* -> forwards to TastyTrade/external APIs
 *   /api/snapshots -> Next.js native routes
 *   /api/tt/* -> TastyTrade API proxy
 */

export async function GET(request: NextRequest, { params }: { params: { proxy: string[] } }) {
  const pathArray = params.proxy || [];
  const path = '/' + pathArray.join('/');

  // Handle proxy/api/tt/* paths - route to TastyTrade
  if (path.startsWith('/proxy/api/tt/')) {
    try {
      const ttPath = path.replace('/proxy', ''); // /api/tt/...
      const hasToken = await ensureToken();
      if (!hasToken) {
        return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
      }

      const response = await ttFetch(ttPath + request.nextUrl.search);
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    } catch (error) {
      console.error('[API] TastyTrade proxy error:', error);
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  // Handle proxy/api/* paths - forward to proxy base
  if (path.startsWith('/proxy/')) {
    try {
      const proxyPath = path.replace('/proxy', '');
      const url = `http://localhost:3001${proxyPath}${request.nextUrl.search}`;
      const response = await fetch(url, { method: 'GET' });
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    } catch (error) {
      console.error('[API] Proxy error:', error);
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function POST(request: NextRequest, { params }: { params: { proxy: string[] } }) {
  const pathArray = params.proxy || [];
  const path = '/' + pathArray.join('/');

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

    // Forward to proxy
    if (path.startsWith('/proxy/')) {
      const proxyPath = path.replace('/proxy', '');
      const url = `http://localhost:3001${proxyPath}${request.nextUrl.search}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    }
  } catch (error) {
    console.error('[API] POST error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { proxy: string[] } }) {
  const pathArray = params.proxy || [];
  const path = '/' + pathArray.join('/');

  try {
    if (path.startsWith('/proxy/')) {
      const proxyPath = path.replace('/proxy', '');
      const url = `http://localhost:3001${proxyPath}${request.nextUrl.search}`;
      const response = await fetch(url, { method: 'DELETE' });
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    }
  } catch (error) {
    console.error('[API] DELETE error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
