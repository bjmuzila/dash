"use client";

// ─────────────────────────────────────────────────────────────────────────────
// useContractStats — live Vol / OI / IV per contract for the /flow tape.
//
// FlowOrder carries only what was true at PRINT time (price, size, premium,
// spot). The tape's Vol / OI / IV columns are "what is this contract doing
// right now", which needs a live chain lookup.
//
// Doing that per row would be hundreds of calls. Instead we send GROUPS —
// one (ticker, expiry) pair per distinct expiry on screen — to
// /proxy/contract-stats, which pulls each Theta snapshot once and returns every
// strike|type in it. Most tapes collapse to a handful of groups.
//
// useLiveSpots is the companion for the % OTM column: FlowOrder.spot is frozen
// at print time, so a strike that has since gone ITM would still read as OTM.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";

export interface ContractStat {
  vol: number | null;
  oi: number | null;
  /** Decimal from the API (0.184) — callers own the ×100 for display. */
  iv: number | null;
  mark: number | null;
}

type StatsMap = Record<string, Record<string, ContractStat>>;

// Streamer roots carry suffixes chips don't (SPX streams as "SPXW", etc.).
// Must match the server's chainTicker() folding or the group keys won't line up.
const ROOT_TO_TICKER: Record<string, string> = { SPXW: "SPX", NDXP: "NDX", RUTW: "RUT", XSPW: "XSP" };
export function normRoot(u: string | null | undefined): string {
  const up = (u ?? "").toUpperCase();
  return ROOT_TO_TICKER[up] ?? up;
}

const POLL_MS = 20_000;
// Mirrors CONTRACT_STATS_MAX_GROUPS server-side. Asking for more just gets
// truncated, so cap here too and keep the most common expiries.
const MAX_GROUPS = 16;

export interface StatsInput {
  underlying?: string;
  expiration?: string;
  strike: number;
  type: "C" | "P";
}

/**
 * @param rows   visible tape rows (drives which groups get fetched)
 * @param enabled gate (e.g. useWsLifecycle) — false stops polling entirely
 * @returns lookup(row) -> ContractStat | null
 */
export function useContractStats(rows: StatsInput[], enabled = true) {
  const [stats, setStats] = useState<StatsMap>({});

  // Group key set, ranked by how many rows want each group so the MAX_GROUPS
  // cap drops the long tail of one-off expiries rather than an arbitrary slice.
  const groupKey = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const root = normRoot(r.underlying);
      if (!root || !r.expiration) continue;
      const k = `${root}:${r.expiration}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_GROUPS)
      .map(([k]) => k)
      .sort()
      .join(",");
  }, [rows]);

  useEffect(() => {
    if (!enabled || !groupKey) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`/proxy/contract-stats?groups=${encodeURIComponent(groupKey)}`);
        if (!r.ok) return;
        const j = await r.json();
        // Merge rather than replace: a group that drops off screen keeps its
        // last-known values, so scrolling back doesn't flash "—".
        if (!cancelled && j?.stats) setStats((prev) => ({ ...prev, ...j.stats }));
      } catch {
        /* leave prior stats in place — a failed poll must not blank the tape */
      }
    };
    const kick = setTimeout(load, 200);
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearTimeout(kick); clearInterval(id); };
  }, [groupKey, enabled]);

  return useMemo(() => {
    return (row: StatsInput): ContractStat | null => {
      const root = normRoot(row.underlying);
      if (!root || !row.expiration) return null;
      const group = stats[`${root}|${row.expiration}`];
      if (!group) return null;
      return group[`${row.strike}|${row.type}`] ?? null;
    };
  }, [stats]);
}

/**
 * Live underlying spot per ticker, for the % OTM column. Theta /proxy/quotes
 * first, Yahoo /api/quotes-batch as the fallback.
 */
export function useLiveSpots(tickers: string[], enabled = true) {
  const [spots, setSpots] = useState<Record<string, number>>({});
  const key = useMemo(() => [...new Set(tickers.filter(Boolean))].sort().join(","), [tickers]);

  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;
    const parse = (items: Array<Record<string, unknown>>) => {
      const map: Record<string, number> = {};
      for (const q of items) {
        const last = Number(q.last);
        const sym = String(q.symbol ?? "").toUpperCase();
        if (sym && last > 0) map[sym] = last;
      }
      return map;
    };
    const apply = (map: Record<string, number>) => {
      if (!cancelled && Object.keys(map).length) setSpots((prev) => ({ ...prev, ...map }));
    };
    const load = async () => {
      try {
        const r = await fetch(`/proxy/quotes?symbols=${encodeURIComponent(key)}`);
        if (!r.ok) throw new Error("proxy/quotes failed");
        const d = await r.json();
        apply(parse(d?.data?.items ?? []));
      } catch {
        try {
          const r = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(key)}`);
          if (!r.ok) return;
          const d = await r.json();
          apply(parse(d?.data?.items ?? []));
        } catch { /* keep prior spots */ }
      }
    };
    const kick = setTimeout(load, 200);
    const id = setInterval(load, 15_000);
    return () => { cancelled = true; clearTimeout(kick); clearInterval(id); };
  }, [key, enabled]);

  return spots;
}
