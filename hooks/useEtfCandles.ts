"use client";

/**
 * useEtfCandles — SPY / QQQ OHLC bars in the SAME record shape useEsCandles
 * returns, so a chart can swap between an index future and an ETF without
 * knowing which one it's holding.
 *
 * Why this is a separate hook and not a symbol argument on useEsCandles:
 * useEsCandles is a WEBSOCKET hook. It reads /ws/gex, whose `esCandles` /
 * `es1mCandles` frames exist only for the futures the live feed subscribes.
 * SPY/QQQ have no such stream — they're recorded server-side into `etf_candles`
 * (server-v2/etf-candle-recorder.js) and read back over HTTP. Bolting a poll
 * onto a socket hook would mean two lifecycles fighting inside one effect, so
 * the transports stay separate and only the OUTPUT shape is shared.
 *
 * Refresh cadence is a plain interval because the underlying rows are written
 * once a minute — polling faster only re-fetches the same bars.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EsCandleRecord } from "@/lib/snapdb";

const REFRESH_MS = 30_000;

export interface UseEtfCandlesResult {
  /** Bars oldest-first, same field names as the ES candle records. */
  rows: EsCandleRecord[];
  /** True once a request has come back (success or empty). */
  loaded: boolean;
  /** Mirrors useEsCandles' `connected` so the page's status badge is generic. */
  connected: boolean;
  refresh: () => Promise<void>;
}

/**
 * @param symbol  "SPY" | "QQQ" | "" — empty disables the hook entirely (no
 *   fetch, no interval), which is how the ES-Candles page turns it off when the
 *   user is back on the futures chart.
 * @param days    Calendar days of history to request.
 * @param interval Bar size in minutes. The server aggregates from stored 1m.
 */
export function useEtfCandles(
  symbol: string,
  days: number = 5,
  interval: 1 | 5 = 5,
): UseEtfCandlesResult {
  const [rows, setRows] = useState<EsCandleRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [ok, setOk] = useState(false);
  const unmountedRef = useRef(false);
  // Monotonic token: a slow SPY request must not land after the user has
  // already switched to QQQ and overwrite its bars with the wrong instrument.
  const seqRef = useRef(0);

  const sym = (symbol || "").trim().toUpperCase();

  const load = useCallback(async () => {
    if (!sym) return;
    const seq = ++seqRef.current;
    try {
      const res = await fetch(
        `/api/snapshots/etf-candles?symbol=${encodeURIComponent(sym)}&days=${days}&interval=${interval}`,
        { cache: "no-store" },
      );
      if (!res.ok) { if (seq === seqRef.current && !unmountedRef.current) setOk(false); return; }
      const json = await res.json();
      if (unmountedRef.current || seq !== seqRef.current) return;
      const next = Array.isArray(json?.rows) ? (json.rows as EsCandleRecord[]) : [];
      setRows(next);
      setOk(next.length > 0);
    } catch {
      if (seq === seqRef.current && !unmountedRef.current) setOk(false);
    } finally {
      if (seq === seqRef.current && !unmountedRef.current) setLoaded(true);
    }
  }, [sym, days, interval]);

  // Switching symbol must CLEAR first. Otherwise the chart shows QQQ's title
  // over SPY's bars for one refresh cycle, and (worse) the price scale keeps
  // the old instrument's range while the new bars stream in.
  useEffect(() => {
    setRows([]);
    setLoaded(false);
    setOk(false);
  }, [sym, interval]);

  useEffect(() => {
    unmountedRef.current = false;
    if (!sym) return () => { unmountedRef.current = true; };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      unmountedRef.current = true;
      clearInterval(id);
    };
  }, [sym, load]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey)),
    [rows],
  );

  return { rows: sorted, loaded, connected: ok, refresh: load };
}
