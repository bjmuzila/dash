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
 * ── TWO CADENCES ────────────────────────────────────────────────────────────
 * HISTORY, once a minute: the whole window out of `etf_candles`, which the
 * recorder writes once a minute. This is the system of record and the only
 * thing that can fill a gap, correct a late print, or reach back days.
 *
 * LIVE, every two seconds: just the newest bucket or two, off
 * /api/snapshots/etf-candles/live — a memory read against a persistent dxLink
 * candle subscription (server-v2/etf-live-candles.js). This is what makes the
 * forming candle actually move; without it the chart stepped once a minute and
 * a bar could be ~2 minutes stale (recorder minute + poll minute).
 *
 * The live rows are the SAME row shape and merge by slotKey, so nothing
 * downstream knows there are two sources. The minute poll is authoritative:
 * when it lands it overwrites whatever the live overlay had put there.
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

/**
 * 2s for the live overlay.
 *
 * This one is safe to run fast for the reason the history poll is not: the
 * response is two rows (~200 bytes), the server answers it out of memory, and
 * the merge below is value-guarded — a tick that didn't move the bar returns
 * the SAME array and re-renders nothing. The chart only repaints when the price
 * actually changed, which is the whole point.
 *
 * It also stops while the tab is hidden. A background tab has nothing to
 * animate, and the interest the request registers server-side would keep a
 * dxLink subscription alive for a chart nobody is looking at.
 */
const LIVE_MS = 2_000;

/** Buckets requested per live poll. Two: the forming one, and the one it just left. */
const LIVE_BARS = 2;

/**
 * Overlay `live` onto `prev`, by slotKey, WITHOUT changing identity when nothing
 * moved.
 *
 * Identity is load-bearing here — on /es-candles the rows array drives the big
 * overlay effect, so a new array every 2s would mean a full chart redraw every
 * 2s whether or not a single price changed. Returning `prev` unchanged is what
 * keeps an idle symbol (or a closed market) free.
 */
function mergeLive(prev: EsCandleRecord[], live: EsCandleRecord[]): EsCandleRecord[] {
  if (!live.length) return prev;
  const byKey = new Map(prev.map((r) => [r.slotKey, r] as const));
  let changed = false;
  for (const b of live) {
    const old = byKey.get(b.slotKey);
    if (!old) { byKey.set(b.slotKey, b); changed = true; continue; }
    if (old.open !== b.open || old.high !== b.high || old.low !== b.low
      || old.close !== b.close || old.volume !== b.volume) {
      // Spread `old` first so any field the recorded row carries and the live
      // row doesn't (id, avgVolume) survives the overlay.
      byKey.set(b.slotKey, { ...old, ...b });
      changed = true;
    }
  }
  if (!changed) return prev;
  return [...byKey.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export interface UseEtfCandlesResult {
  /** Bars oldest-first, same field names as the ES candle records. */
  rows: EsCandleRecord[];
  /** True once a request has come back (success or empty). */
  loaded: boolean;
  /** Mirrors useEsCandles' `connected` so the page's status badge is generic. */
  connected: boolean;
  /** True while the 2s dxLink overlay is actually returning bars. */
  live: boolean;
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
  const [live, setLive] = useState(false);
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

  /**
   * The live overlay. Deliberately NOT part of `load`:
   *
   *   • It must not touch `loaded`/`connected`. Those describe the recorded
   *     series, and a live miss (off-hours, first call after a subscribe) is
   *     normal — flipping the card's status badge on it would be a lie.
   *   • It shares `seqRef` so a response for the symbol the user just switched
   *     away from is dropped exactly like a slow history response is.
   *   • It never clears. An empty answer leaves the recorded bars alone; the
   *     overlay can only ever add or sharpen, never blank the chart.
   */
  const loadLive = useCallback(async () => {
    if (!sym) return;
    const seq = seqRef.current;
    try {
      const res = await fetch(
        `/api/snapshots/etf-candles/live?symbol=${encodeURIComponent(sym)}&interval=${interval}&bars=${LIVE_BARS}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = await res.json();
      if (unmountedRef.current || seq !== seqRef.current) return;
      const next = (json?.rows?.[sym] ?? []) as EsCandleRecord[];
      if (!Array.isArray(next) || !next.length) { setLive(false); return; }
      setRows((prev) => mergeLive(prev, next));
      setLive(true);
    } catch {
      /* a dropped overlay poll is not an error — the next one is 2s away */
    }
  }, [sym, interval]);

  // Switching symbol must CLEAR first. Otherwise the chart shows QQQ's title
  // over SPY's bars for one refresh cycle, and (worse) the price scale keeps
  // the old instrument's range while the new bars stream in.
  useEffect(() => {
    setRows([]);
    setLoaded(false);
    setOk(false);
    setLive(false);
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

  // Live overlay loop. Runs only while the tab is visible — see LIVE_MS.
  useEffect(() => {
    if (!sym) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (id) { clearInterval(id); id = null; } };
    const start = () => {
      if (id) return;
      void loadLive();
      id = setInterval(() => { void loadLive(); }, LIVE_MS);
    };
    const onVis = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") stop();
      else start();
    };
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [sym, loadLive]);

  // The toolbar's refresh button re-pulls this while the hook is mounted.
  // `load` already carries a monotonic seq token, so a manual press racing the
  // 60s poll cannot land the loser's bars.
  useRefreshSource(load, "useEtfCandles");

  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey)),
    [rows],
  );

  return { rows: sorted, loaded, connected: ok, live, refresh: load };
}
