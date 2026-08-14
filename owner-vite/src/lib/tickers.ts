// ─────────────────────────────────────────────────────────────────────────────
// owner-vite/src/lib/tickers.ts — the scanner universe, for owner-side pickers.
//
// owner-vite is a standalone Vite app: its `@` alias points at owner-vite/src,
// so it CANNOT import lib/scannerTickers.ts from the repo root the way the Next
// pages do. Instead it reads the same source of truth over HTTP —
// GET /proxy/scanner-tickers, which serves server-v2/scanner-tickers.js, the
// exact list /levels and /scanner drive off. The result is memoised at module
// scope and mirrored into localStorage, so the picker is populated instantly on
// the second visit and still usable if the proxy is down.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";

const CACHE_KEY = "cb-owner-scanner-universe-v1";

/** Last-resort list so the picker is never empty on a cold, offline first load. */
export const FALLBACK_TICKERS: string[] = [
  "SPX", "SPY", "QQQ", "NDX", "IWM", "DIA", "VIX", "ES", "NQ",
  "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AVGO", "AMD",
  "NFLX", "COIN", "MSTR", "PLTR", "SMCI", "GLD", "SLV", "TLT", "USO", "XLE",
  "XLF", "XLK", "SMH", "ARKK", "HYG", "EEM", "FXI", "BABA",
];

/**
 * Normalise a typed symbol the same way the server does: strip `$` and a
 * leading `/`, uppercase, and reject anything that isn't a plausible root.
 * Returns "" when the input can't be a ticker, so callers can ignore it.
 */
export function normalizeTicker(raw: string): string {
  const cleaned = String(raw ?? "").trim().toUpperCase().replace(/[$]/g, "").replace(/^\//, "");
  return /^[A-Z0-9.\-]{1,12}$/.test(cleaned) ? cleaned : "";
}

let memo: string[] | null = null;
let inflight: Promise<string[]> | null = null;

function readCache(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(list) && list.length) return list.map(String);
  } catch { /* corrupt / blocked storage */ }
  return null;
}

async function loadUniverse(): Promise<string[]> {
  if (memo) return memo;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch("/proxy/scanner-tickers", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const list = Array.isArray(j?.tickers) ? j.tickers : [];
      const clean = [...new Set(
        list.map((t: unknown) => normalizeTicker(String(t))).filter(Boolean) as string[],
      )];
      if (!clean.length) throw new Error("empty universe");
      memo = clean;
      try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(clean)); } catch { /* full */ }
      return clean;
    } catch {
      memo = readCache() ?? FALLBACK_TICKERS;
      return memo;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * The scanner universe (~169 symbols). `live` is false while showing the cached
 * or fallback list, so a caller can badge the picker as stale if it cares.
 */
export function useTickerUniverse(): { tickers: string[]; loading: boolean; live: boolean } {
  const [tickers, setTickers] = useState<string[]>(() => memo ?? readCache() ?? FALLBACK_TICKERS);
  const [loading, setLoading] = useState(!memo);
  const [live, setLive] = useState(!!memo);

  useEffect(() => {
    let cancelled = false;
    void loadUniverse().then((list) => {
      if (cancelled) return;
      setTickers(list);
      setLive(list !== FALLBACK_TICKERS);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return { tickers, loading, live };
}

/** Tickers whose GEX read comes from the live in-memory feed rather than a chain pull. */
export const LIVE_FEED_TICKER = "SPX";
