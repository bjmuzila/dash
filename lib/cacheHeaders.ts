/**
 * Set cache headers for API responses.
 * Use in NextResponse: return NextResponse.json(data, { headers: cacheHeaders(30) })
 */
export function cacheHeaders(maxAgeSeconds: number = 30) {
  return {
    'Cache-Control': `public, max-age=${maxAgeSeconds}`,
  };
}

/**
 * TTL presets for common endpoints
 */
export const CACHE_TTL = {
  quotes: 30,        // Live quote data
  gex: 30,           // GEX calculations
  chains: 30,        // Option chains
  snapshots: 60,     // Historical snapshots
  levels: 300,       // Reference levels
  calendar: 3600,    // Calendar data
};
