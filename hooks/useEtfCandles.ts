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
import { useRefreshSource } from "@/lib/refreshBus";

/**
 * 60s, was 30.
 *
 * The header already says it: the underlying rows are written ONCE A MINUTE by
 * etf-candle-recorder.js. A 30s poll therefore made every other request a
 * provable no-op, and the responses are not small — this endpoint is the one
 * candle route that never got the `lite=1` treatment, so each one ships the
 * verbose shape for the full history window. Three ETF cards were pulling
 * ~1.5MB/min between them to learn about one new bar.
 */
const REFRESH_MS = 60_000;

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
      // Identity-guarded.
      //
      // The poll returns the whole history window every time and at most one row
      // of it is new, but `setRows(next)` handed the consumer a fresh array
      // regardless — and on /es-candles that array's identity is what drives the
      // chart's `rows`, which drives the big overlay effect. So a poll that
      // learned nothing still cost a full re-render and a full redraw.
      setRows((prev) => {
        if (prev.length !== next.length) return next;
        // FULL compare, not just the newest bar: the recorder revises earlier
        // bars (late prints, a corrected volume), and this response is the whole
        // history window every time — so a last-bar-only check would drop any
        // mid-array correction for good.
        for (let i = 0; i < next.length; i++) {
          const a = prev[i], b = next[i];
          if (a.slotKey !== b.slotKey || a.open !== b.open || a.high !== b.high
            || a.low !== b.low || a.close !== b.close || a.volume !== b.volume) return next;
        }
        return prev;
      });
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

  // The toolbar's refresh button re-pulls this while the hook is mounted.
  // `load` already carries a monotonic seq token, so a manual press racing the
  // 60s poll cannot land the loser's bars.
  useRefreshSource(load, "useEtfCandles");

  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey)),
    [rows],
  );

  return { rows: sorted, loaded, connected: ok, refresh: load };
}
