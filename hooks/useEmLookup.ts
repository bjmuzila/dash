"use client";

import { useCallback, useState } from "react";
import { trackTickerClick } from "@/lib/trackTicker";

/**
 * useEmLookup — the Estimated Moves data layer.
 *
 * Lifted out of components/dashboard/EmCustomer.tsx when the phone got its own
 * EM view. The view is easy to rewrite for a 390px screen; the data layer is
 * not, and it holds several pieces of non-obvious business logic that must NOT
 * be reimplemented per surface:
 *
 *   - the ESU/ESM + NQU/NQM alias fan-out (futures live under their internal
 *     month codes but display under the front code)
 *   - the win-rate merge of the static verified history JSON with the live
 *     em_tracker table
 *   - the zones fallback chain: a published row with no zones, or no published
 *     row at all, still gets on-demand zones from /api/em-zones
 *   - EM values arrive as comma-formatted STRINGS ("6,152.50"); every consumer
 *     has to strip the commas before parseFloat, which `emNumber` below does
 *
 * Every enrichment call is inside Promise.allSettled, so no single failing
 * endpoint can take the page down — the core /api/levels row still renders.
 *
 * REMOVED — /api/confidence. It used to be the second of four parallel
 * enrichment calls here, and it never worked: the route returns
 * `score: ConfidenceResult` (an object with fields hit/pivot/chop/break/…),
 * while this code read `score.score ?? score`. The first is undefined, the
 * second is the object, `Number(object)` is NaN, `Number.isFinite` is false —
 * so `confidenceScore` never left null and the "CB Confidence" tile never
 * rendered, on any surface, ever.
 *
 * It was also by far the most expensive request in the set: the route scans up
 * to ANALOG_MAX = 120 prior sessions server-side (see app/api/confidence/
 * route.ts) to build a score that was then discarded. Every EM lookup paid for
 * it. Dropping it takes the per-lookup request count from 8 to 7 and removes
 * that scan, with zero visible change — there was nothing to see.
 *
 * If the tile is wanted, fix the ROUTE to return a scalar (or fix the reader to
 * pull a named field off ConfidenceResult), then re-add the call here — one
 * place, both surfaces.
 */

export interface TickerEmStats {
  recentAvg: number | null;
  midAvg: number | null;
  sampleSize: number;
}

export interface Levels {
  ticker: string;
  label?: string | null;
  close?: string | null;
  em?: string | null;
  up?: string | null;
  down?: string | null;
  buy_near?: string | null;
  buy_far?: string | null;
  sell_near?: string | null;
  sell_far?: string | null;
  pivot?: string | null;
  exp_label?: string | null;
  updated_at?: string | null;
}

export const POPULAR = ["SPX", "NDX", "ESU", "NQU", "SPY", "QQQ", "AAPL", "NVDA", "TSLA", "MSFT"];

export function val(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "--";
  return v;
}

export function fmtUpdated(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** On-demand Buy/Sell zones for any ticker (static for the week, server-cached). */
async function fetchZones(sym: string): Promise<Partial<Levels> | null> {
  try {
    const r = await fetch(`/api/em-zones?ticker=${encodeURIComponent(sym)}`, { cache: "no-store" });
    if (!r.ok) return null;
    const z = (await r.json()) as Partial<Levels> | { error?: string } | null;
    if (!z || (z as { error?: string }).error) return null;
    return z as Partial<Levels>;
  } catch {
    return null;
  }
}

export interface TrackerWeekRow {
  week_label?: string | null;
  week_start?: string | null;
  result?: "hit" | "miss" | null;
}

/** Per-ticker weekly hit/miss rows (newest first). ES/NQ futures live under
 *  their internal month codes, so fold the alias in. */
async function fetchTrackerRows(sym: string): Promise<TrackerWeekRow[]> {
  const aliases: Record<string, string[]> = { ESU: ["ESU", "ESM"], NQU: ["NQU", "NQM"] };
  const candidates = aliases[sym] ?? [sym];
  const sets = await Promise.all(
    candidates.map((c) =>
      fetch(`/api/em-tracker?ticker=${encodeURIComponent(c)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    )
  );
  const rows: TrackerWeekRow[] = [];
  for (const s of sets) if (s?.rows) rows.push(...s.rows);
  rows.sort((a, b) =>
    String(b.week_start ?? b.week_label ?? "").localeCompare(String(a.week_start ?? a.week_label ?? ""))
  );
  return rows;
}

export type EmLookupState = {
  ticker: string;
  data: Partial<Levels> | null;
  loading: boolean;
  error: string;
  emStats: TickerEmStats | null;
  winRate: { hits: number; evaluated: number; hit_rate: number } | null;
  recentRec: { lastResult: "hit" | "miss" | null; lastLabel: string | null; last5Hits: number; last5Total: number } | null;
  lookup: (raw: string) => Promise<void>;
};

/** Parse a DB-formatted level string ("6,152.50") into a number. */
export function emNumber(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function useEmLookup(): EmLookupState {
  const [input, setInput] = useState("");
  const [ticker, setTicker] = useState("");
  // Holds either a full published Levels row or a zones-only Partial<Levels>
  // (the on-demand /api/em-zones fallback for not-yet-published tickers).
  const [data, setData] = useState<Partial<Levels> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emStats, setEmStats] = useState<TickerEmStats | null>(null);
  const [winRate, setWinRate] = useState<{ hits: number; evaluated: number; hit_rate: number } | null>(null);
  const [recentRec, setRecentRec] = useState<{ lastResult: "hit" | "miss" | null; lastLabel: string | null; last5Hits: number; last5Total: number } | null>(null);

  const lookup = useCallback(async (raw: string) => {
    const sym = raw.trim().toUpperCase();
    if (!sym) return;
    setTicker(sym);
    setLoading(true);
    setError("");
    setData(null);
    setEmStats(null);
    setWinRate(null);
    setRecentRec(null);
    try {
      const r = await fetch(`/api/levels?ticker=${encodeURIComponent(sym)}`, { cache: "no-store" });
      if (!r.ok) throw new Error("Lookup failed");
      const json = (await r.json()) as Levels | null;
      let fetchedData = false;
      if (!json) {
        // No published row at all — still try on-demand zones (static for the
        // week). EM only exists if the weekly publisher computed it, so a brand
        // new ticker shows zones now and EM after the next weekend run.
        const zones = await fetchZones(sym);
        if (zones) { setData(zones); fetchedData = true; }
        else setError(`No levels published for ${sym} yet.`);
      } else {
        setData(json);
        fetchedData = true;
        // Fill in zones on demand when the published row has EM but no zones
        // (the long-tail names aren't pre-published with zones).
        const hasZones = json.buy_near || json.sell_near || json.pivot;
        if (!hasZones) {
          const zones = await fetchZones(sym);
          if (zones) setData((prev) => (prev ? { ...prev, ...zones } : zones));
        }
      }
      // Only log a "visit" once data actually came back for this ticker (mirrors
      // the flow-ticker click tracker), so lookups that 404 don't skew counts.
      if (fetchedData) trackTickerClick(sym, "em");
      // EM history stats + win/loss record, in parallel. (/api/confidence used to
      // be here — see the header note; it was removed, not forgotten.)
      const [statsRes, trackerRes, weeksRes] = await Promise.allSettled([
        fetch(`/api/em/ticker-em-stats?ticker=${encodeURIComponent(sym)}`).then((r) => r.ok ? r.json() : null),
        Promise.all([
          fetch("/api/em-tracker").then((r) => r.ok ? r.json() : null),
          fetch("/api/em-tracker/history").then((r) => r.ok ? r.json() : null),
        ]).then(([live, hist]) => live ? { summary: live.summary, history: hist } : null),
        fetchTrackerRows(sym),
      ]);
      if (statsRes.status === "fulfilled" && statsRes.value) {
        setEmStats({ recentAvg: statsRes.value.recentAvg ?? null, midAvg: statsRes.value.midAvg ?? null, sampleSize: statsRes.value.sampleSize ?? 0 });
      }
      if (trackerRes.status === "fulfilled" && trackerRes.value) {
        const { summary: liveSummary, history: histData } = trackerRes.value as {
          summary: Array<{ ticker: string; hits: number; evaluated: number }>;
          history: { tallies: Record<string, { hits: number; total: number }> };
        };
        // Tracker uses ESM/NQM internally but displays as ESU/NQU; also check both
        const aliases: Record<string, string[]> = { ESU: ["ESU", "ESM"], NQU: ["NQU", "NQM"] };
        const candidates = aliases[sym] ?? [sym];
        const liveRow = (liveSummary || []).find((r) => candidates.includes(r.ticker));
        const histTicker = candidates.find((c) => histData?.tallies?.[c]);
        const hist = histTicker ? histData.tallies[histTicker] : null;
        const liveHits = liveRow?.hits ?? 0;
        const liveEval = liveRow?.evaluated ?? 0;
        const histHits = hist?.hits ?? 0;
        const histTotal = hist?.total ?? 0;
        const totalHits = histHits + liveHits;
        const totalEval = histTotal + liveEval;
        if (totalEval > 0) {
          setWinRate({ hits: totalHits, evaluated: totalEval, hit_rate: totalHits / totalEval });
        }
      }
      // Recent record: most-recent finalized week + trailing-5 hit rate.
      if (weeksRes.status === "fulfilled" && Array.isArray(weeksRes.value)) {
        const evaluated = weeksRes.value.filter((r) => r.result === "hit" || r.result === "miss");
        if (evaluated.length > 0) {
          const last5 = evaluated.slice(0, 5);
          setRecentRec({
            lastResult: evaluated[0].result ?? null,
            lastLabel: evaluated[0].week_label ?? null,
            last5Hits: last5.filter((r) => r.result === "hit").length,
            last5Total: last5.length,
          });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, []);

  return { ticker, data, loading, error, emStats, winRate, recentRec, lookup };
}
