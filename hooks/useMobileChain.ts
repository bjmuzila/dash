"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dedupeFetch } from "@/lib/dedupeFetch";
import { parseExpiration, type GreekCell } from "@/lib/calculations/optionChain";
import { etDateKey, etToday, isSessionLive, isSpxFeedLive } from "@/lib/marketSession";
import { useRefreshSource } from "@/lib/refreshBus";

/**
 * useMobileChain — one expiry of the option chain, for the phone chain page.
 *
 * The desktop /options-chain page fires up to FOURTEEN parallel /api/chains
 * requests (one per expiry column of its strikes × expirations matrix). That is
 * the right call for a 27" monitor and completely wrong for a phone on LTE, so
 * this hook fetches exactly the expiry on screen.
 *
 * It shares the desktop's math rather than reimplementing it: `parseExpiration`
 * from lib/calculations/optionChain produces the same GreekCell the desktop
 * renders, so a strike cannot read one GEX number on the chain page and a
 * different one here. Requests go through `dedupeFetch`, so if the desktop
 * chain is mounted in the same tab the two collapse to one GET.
 *
 * Polling is gated exactly like the desktop's: SPX tracks the extended feed
 * (Sun 20:00 → Fri 16:00 ET, minus the daily 16:00–18:00 maintenance break),
 * everything else only during RTH. Outside those windows the numbers cannot
 * change, so we don't spend the user's battery asking.
 */

const POLL_MS = 60_000;
/** Guard against a burst of manual refreshes hammering the upstream. */
const MIN_INTERVAL_MS = 5_000;

export type ChainStrike = {
  strike: number;
  cell: GreekCell;
};

export type MobileChainState = {
  ticker: string;
  setTicker: (t: string) => void;
  expiries: { value: string; label: string; dte: number }[];
  expiry: string;
  setExpiry: (e: string) => void;
  /** Strikes ascending, every strike the upstream returned for this expiry. */
  strikes: ChainStrike[];
  spot: number;
  /** Listed strike nearest spot. */
  atm: number;
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
  refresh: () => void;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dteOf(ymd: string): number {
  const today = etDateKey(etToday());
  const a = Date.parse(today + "T00:00:00Z");
  const b = Date.parse(ymd.slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function labelOf(ymd: string): string {
  const dt = new Date(ymd + "T12:00:00");
  if (Number.isNaN(dt.getTime())) return ymd;
  return `${DAY_NAMES[dt.getDay()]} ${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
}

export function useMobileChain(initialTicker = "SPX"): MobileChainState {
  const [ticker, setTickerState] = useState(initialTicker);
  const [expiries, setExpiries] = useState<{ value: string; label: string; dte: number }[]>([]);
  const [expiry, setExpiryState] = useState("");
  const [strikes, setStrikes] = useState<ChainStrike[]>([]);
  const [spot, setSpot] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const inFlightRef = useRef(false);
  const lastLoadRef = useRef(0);
  const expiryRef = useRef("");
  expiryRef.current = expiry;
  const tickerRef = useRef(ticker);
  tickerRef.current = ticker;

  // ── expirations ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setExpiries([]);
    setStrikes([]);
    setExpiryState("");
    setLoading(true);
    (async () => {
      try {
        const json = await fetch(`/api/expirations?ticker=${encodeURIComponent(ticker)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (cancelled) return;
        const items: Array<Record<string, unknown>> = json?.data?.items ?? [];
        const seen = new Set<string>();
        const list = items
          .map((it) => String(it["expiration-date"] ?? "").slice(0, 10))
          .filter((d) => d && !seen.has(d) && (seen.add(d), true))
          .sort()
          .map((value) => ({ value, label: labelOf(value), dte: dteOf(value) }));
        if (!list.length) {
          setError("No expirations listed for this symbol.");
          setLoading(false);
          return;
        }
        setError(null);
        setExpiries(list);
        // Prefer today (0DTE) when it's listed; the upstream already filters to
        // today-or-later, so list[0] is the nearest otherwise.
        const today = etDateKey(etToday());
        setExpiryState(list.find((e) => e.value === today)?.value ?? list[0].value);
      } catch {
        if (!cancelled) {
          setError("Couldn't load expirations.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  // ── one expiry's chain ─────────────────────────────────────────────────────
  const load = useCallback(async (force = false) => {
    const exp = expiryRef.current;
    const sym = tickerRef.current;
    if (!exp || !sym) return;
    if (inFlightRef.current) return;
    const now = Date.now();
    if (!force && now - lastLoadRef.current < MIN_INTERVAL_MS) return;
    inFlightRef.current = true;
    lastLoadRef.current = now;
    try {
      const res = await dedupeFetch(
        `/api/chains?ticker=${encodeURIComponent(sym)}&expiration=${encodeURIComponent(exp)}&range=all`,
      );
      const json = await res.json().catch(() => null);
      const data = (json?.data as Record<string, unknown> | undefined) ?? undefined;
      const items = (data?.items as unknown[]) ?? [];
      const underlying = parseFloat(String(data?.underlyingPrice ?? 0)) || 0;
      const cells = parseExpiration(items, exp, underlying, "oi-vol");
      // Ignore a response that arrived after the user moved on.
      if (expiryRef.current !== exp || tickerRef.current !== sym) return;
      const rows: ChainStrike[] = [...cells.entries()]
        .map(([strike, cell]) => ({ strike, cell }))
        .sort((a, b) => a.strike - b.strike);
      setStrikes(rows);
      if (underlying > 0) setSpot(underlying);
      setUpdatedAt(Date.now());
      setError(rows.length ? null : "No strikes returned for this expiry.");
    } catch {
      setError("Chain request failed.");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!expiry) return;
    setLoading(true);
    void load(true);
  }, [expiry, ticker, load]);

  useEffect(() => {
    const id = setInterval(() => {
      const sym = tickerRef.current.toUpperCase();
      const live = sym === "SPX" || sym === "$SPX" ? isSpxFeedLive() : isSessionLive();
      if (live) void load(false);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Toolbar refresh. `force` skips MIN_INTERVAL_MS — a deliberate press is
  // exactly the case that guard was not written for — but `inFlightRef` still
  // collapses a double-tap into one request.
  useRefreshSource(() => load(true), "useMobileChain");

  const atm = useMemo(() => {
    if (!strikes.length) return 0;
    const ref = spot > 0 ? spot : strikes[Math.floor(strikes.length / 2)].strike;
    return strikes.reduce(
      (best, s) => (Math.abs(s.strike - ref) < Math.abs(best - ref) ? s.strike : best),
      strikes[0].strike,
    );
  }, [strikes, spot]);

  const setTicker = useCallback((t: string) => {
    const clean = t.trim().toUpperCase();
    if (clean) setTickerState(clean);
  }, []);

  const setExpiry = useCallback((e: string) => setExpiryState(e), []);

  return {
    ticker,
    setTicker,
    expiries,
    expiry,
    setExpiry,
    strikes,
    spot,
    atm,
    loading,
    error,
    updatedAt,
    refresh: () => void load(true),
  };
}
