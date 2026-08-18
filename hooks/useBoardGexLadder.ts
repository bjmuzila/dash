"use client";

/**
 * The whole-board per-strike GEX/DEX ladder — every listed expiration, and the
 * same thing with today's expiry removed.
 *
 * WHY A FETCH AND NOT THE SOCKET
 * ------------------------------
 * /ws/gex is single-expiry BY CONSTRUCTION, not by omission: the proxy's
 * `_activeContracts()` filters `c.expiration !== this.expiry`, so the live feed
 * only ever subscribes the ONE selected expiry, and `computeGexRows()` carries a
 * scope warning saying multi-expiry input keeps only the last expiry per
 * (strike, side). There is no frame to ask for. Anything spanning expiries has
 * to come from the board sweep.
 *
 * `/proxy/gex-by-strike-multi` is that sweep, and it already existed for the
 * /test page's two "Net gamma exposure by strike" cards. It returns BOTH ladders
 * in one payload:
 *
 *   all     every listed expiration, 0DTE included
 *   ex0dte  every listed expiration except the 0DTE one
 *
 * Both OI+Vol, summed per strike by `computeGexRowsMultiExpiry`, so they line up
 * with eod_gex.total_gex_0dte / total_gex_ex0dte.
 *
 * COST — READ THIS BEFORE POLLING IT FASTER
 * -----------------------------------------
 * The sweep is ONE UPSTREAM FETCH PER EXPIRATION on the server. It is cached
 * ~60s server-side (GEX_MULTI_TTL_MS), which is why the default poll here is
 * 60s and not the 15s a live panel would want: a faster poll buys nothing but
 * bandwidth, because it just re-reads the same cache entry.
 *
 * THE ROWS ARE SLIM
 * -----------------
 * `{ strike, netGEX, netVolGEX, netDEX, volNetDEX }` — no gamma, no delta, no
 * OI, no volume. A full SPX board is ~1500 strikes and shipping every greek
 * would bloat the payload for nothing. Consequences at the call site:
 *   · `netGEXOf` / `netDEXOf` read the precomputed fields (they fall back to
 *     these exactly when the gamma legs are absent — see calculations.ts).
 *   · Call−Put bars, the OI overlay, the flip curve and the prior-state ghosts
 *     have no data here. GexChart already degrades to net bars when the rows
 *     carry no per-side legs; the rest the caller should simply not ask for.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChainRow } from "@/lib/calculations/calculations";

/** One ladder, as the endpoint returns it. */
export interface GexLadder {
  rows: ChainRow[];
  totalNetGex: number | null;
  gexFlip: number | null;
  /**
   * THIS ladder's own walls — highest +GEX above spot, most −GEX below, OI+Vol,
   * same definitions as everywhere else. Added server-side 2026-08; a server
   * that predates it omits them and they arrive null, which callers must render
   * as "no walls from this build" rather than falling back to /proxy/gex's.
   * Those are 0DTE and clipped to ±8% of spot — a different measurement.
   */
  callWall: number | null;
  putWall: number | null;
}

export interface BoardGexLadder {
  /** Every listed expiration, 0DTE included. */
  all: GexLadder | null;
  /** Every listed expiration EXCEPT today's. */
  ex0dte: GexLadder | null;
  /** How many expirations the sweep covered. */
  expiryCount: number;
  /** Underlying price the ladders were computed on. */
  spot: number;
  /** A sweep is in flight (true on the first load AND on every refresh). */
  loading: boolean;
  /** Last failure, or null. Kept across a retry so the UI can keep saying so. */
  error: string | null;
  /** Force a re-fetch now, ignoring the poll clock (not the server's 60s cache). */
  refresh: () => void;
}

const EMPTY: BoardGexLadder = {
  all: null, ex0dte: null, expiryCount: 0, spot: 0,
  loading: false, error: null, refresh: () => {},
};

interface RawLadder {
  rows?: Array<{ strike?: number; netGEX?: number; netVolGEX?: number; netDEX?: number; volNetDEX?: number }>;
  totalNetGex?: number | null;
  gexFlip?: number | null;
  callWall?: number | null;
  putWall?: number | null;
}

function toLadder(raw: RawLadder | undefined): GexLadder | null {
  if (!raw?.rows?.length) return null;
  const rows: ChainRow[] = raw.rows
    .filter((r) => Number(r.strike) > 0)
    .map((r) => ({
      strike: Number(r.strike),
      netGEX: Number(r.netGEX ?? 0),
      netVolGEX: Number(r.netVolGEX ?? 0),
      netDEX: Number(r.netDEX ?? 0),
      volNetDEX: Number(r.volNetDEX ?? 0),
      // Deliberately NOT defaulting callGamma/putGamma to 0. `netGEXOf` uses
      // "both gamma legs are null" as the signal that a row is pre-summed and
      // its precomputed totals should be read instead; writing zeros here would
      // send it down the recompute path and every bar would be 0.
    }))
    .sort((a, b) => a.strike - b.strike);
  return {
    rows,
    totalNetGex: raw.totalNetGex ?? null,
    gexFlip: raw.gexFlip ?? null,
    callWall: raw.callWall ?? null,
    putWall: raw.putWall ?? null,
  };
}

/**
 * @param symbol   underlying as the endpoint names it — "$SPX", not "SPX".
 * @param enabled  false = don't fetch and don't poll. Pass the caller's own
 *                 gate (is the ex-0DTE view even switched on?), so a board that
 *                 never opens it never runs a board sweep.
 * @param pollMs   defaults to the server's own cache TTL; see the note above.
 */
export function useBoardGexLadder(
  symbol = "$SPX",
  enabled = true,
  pollMs = 60_000,
): BoardGexLadder {
  const [all, setAll] = useState<GexLadder | null>(null);
  const [ex0dte, setEx0dte] = useState<GexLadder | null>(null);
  const [expiryCount, setExpiryCount] = useState(0);
  const [spot, setSpot] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by refresh() to re-run the effect without changing its real inputs.
  const [nonce, setNonce] = useState(0);
  // Guards a late response from a previous symbol/enable cycle overwriting a
  // newer one — the sweep can take seconds, which is long enough to matter.
  const runRef = useRef(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const run = ++runRef.current;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/proxy/gex-by-strike-multi?symbol=${encodeURIComponent(symbol)}`,
          { cache: "no-store" },
        );
        const json = await res.json().catch(() => null);
        if (cancelled || run !== runRef.current) return;
        if (!res.ok || !json?.ok) {
          // 503 "no spot yet" before the open is normal, not a bug — surface the
          // server's own words rather than inventing a message.
          setError(String(json?.error || `HTTP ${res.status}`));
          return;
        }
        setAll(toLadder(json.all));
        setEx0dte(toLadder(json.ex0dte));
        setExpiryCount(Number(json.expiryCount) || 0);
        setSpot(Number(json.spot) || 0);
        setError(null);
      } catch (e) {
        if (cancelled || run !== runRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled && run === runRef.current) setLoading(false);
      }
    };

    load();
    const id = setInterval(load, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol, enabled, pollMs, nonce]);

  return enabled
    ? { all, ex0dte, expiryCount, spot, loading, error, refresh }
    : { ...EMPTY, refresh };
}

export default useBoardGexLadder;
