// ─────────────────────────────────────────────────────────────────────────────
// lib/useScannerTickers.ts — client hook over GET /proxy/scanner-tickers.
// Split from lib/scannerTickers.ts so that server code can import the static
// constants without pulling in a "use client" boundary.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";
import { SCANNER_TICKERS } from "@/lib/scannerTickers";

/**
 * Live scanner universe from GET /proxy/scanner-tickers, which reads
 * server-v2/scanner-tickers.js. Falls back to the static list above on any
 * failure, so a dead proxy degrades to a stale picker rather than an empty one.
 *
 * `loading` is exposed for callers that want a spinner; ignoring it is safe
 * because `tickers` is always a usable array.
 */
export function useScannerTickers(fallback: string[] = SCANNER_TICKERS): {
  tickers: string[];
  loading: boolean;
  live: boolean;
} {
  const [tickers, setTickers] = useState<string[]>(fallback);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/proxy/scanner-tickers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (cancelled) return;
        const list = Array.isArray(j?.tickers) ? j.tickers : [];
        const clean = list
          .map((t: unknown) => String(t).trim().toUpperCase())
          .filter(Boolean);
        if (clean.length) {
          setTickers([...new Set<string>(clean)]);
          setLive(true);
        }
      })
      .catch(() => { /* keep fallback */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { tickers, loading, live };
}
