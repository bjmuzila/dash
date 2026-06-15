import { NextRequest, NextResponse } from 'next/server';
import { ensureToken, ttFetch } from '@/lib/proxy/auth';

/**
 * API route: /api/tt/*
 * Proxy all TastyTrade API calls through here
 * Examples:
 *   GET /api/tt/quotes-batch?symbols=SPX,VIX
 *   GET /api/tt/chains/SPX?expiration=2025-01-17
 *   GET /api/tt/option-marks?symbols=.SPX250117C5900
 */

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ params: string[] }> }
) {
  const { params } = await props;
  try {
    const path = '/' + params.params.join('/');
    const url = new URL(request.nextUrl.search, `http://api.tastyworks.com${path}`);

    // Ensure we have a valid token
    const hasToken = await ensureToken();
    if (!hasToken) {
      return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
    }

    // Forward the request to TastyTrade API
    const response = await ttFetch(path + url.search);
    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API/tt] Error:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ params: string[] }> }
) {
  const { params } = await props;
  try {
    const path = '/' + params.params.join('/');
    const body = await request.json();

    // Ensure we have a valid token
    const hasToken = await ensureToken();
    if (!hasToken) {
      return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
    }

    // Forward the request to TastyTrade API
    const response = await ttFetch(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API/tt] Error:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
