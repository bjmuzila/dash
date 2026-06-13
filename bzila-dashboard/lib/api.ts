// Client-side API helpers (calls Next.js API routes)
// Server-side: import directly from lib/math/ or lib/db.ts

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store", ...options });
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  /** GET /api/gex */
  getGex: () => fetchJson("/api/gex"),

  /** GET /api/flow */
  getFlow: () => fetchJson("/api/flow"),

  /** GET /api/db?query=... */
  queryDb: (query: string) =>
    fetchJson(`/api/db?query=${encodeURIComponent(query)}`),

  /** Tastytrade streamer — returns session token */
  getTastySession: () => fetchJson("/api/tastytrade"),
};
