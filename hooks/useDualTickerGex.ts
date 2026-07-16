"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Per-strike 0DTE net GEX for arbitrary tickers (SPY / QQQ), keyed by MONEYNESS
 * OFFSET rather than by strike.
 *
 * WHY OFFSET AND NOT STRIKE (see [[home-heatmap-spy-qqq-columns]]):
 * The home heatmap's rows are SPX strikes. SPY trades a ~1/10 ladder and QQQ
 * tracks NDX, not SPX — neither shares SPX's strike grid, so there is no honest
 * strike→strike join. Instead each ticker's own chain is indexed relative to its
 * own ATM strike: offset 0 = that ticker's ATM, +1 = one strike above, −1 = one
 * below. The SPX row at ATM+2 therefore lines up with SPY's ATM+2 and QQQ's
 * ATM+2. The columns compare the SHAPE of the gamma structure across the three
 * chains, not absolute price levels. The rendered strike is carried alongside
 * the value so the UI can show which contract each number actually came from.
 *
 * BASIS: matches the rest of the app ([[gex-basis-convention]]).
 *   "oi-vol"   → position = OI + volume   (default everywhere)
 *   "vol-only" → position = volume only   (intraday flow, resets daily)
 *
 * SCALE / SIGN: gamma · position · spot², calls +, puts −. This is the SAME
 * convention as the server calculator (server-v2/computation/gex-calculator.js)
 * and lib/calculations netGEXOf — no ×100, no put-side flip. Do NOT "fix" the
 * missing ×100; see [[flow-gex-sign-scaling]].
 */

export type GexBasis = "oi-vol" | "vol-only";

/**
 * Strikes kept each side of ATM. Matches the home heatmap's own ±20 window
 * (pickCenterRows in app/home/HomeClient.tsx) — offsets beyond this can't be
 * rendered, so they're dropped rather than computed.
 */
const SIDE_STRIKES = 20;

export interface OffsetGex {
  /** The ticker's own strike this value came from. */
  strike: number;
  /** gamma · pos · spot², calls +, puts −. */
  netGEX: number;
}

/** offset (…−2, −1, 0 = ATM, +1, +2 …) → value at that strike. */
export type OffsetGexMap = Record<number, OffsetGex>;

export interface TickerGex {
  map: OffsetGexMap;
  spot: number;
  atmStrike: number;
  expiration: string;
}

export type DualTickerGex = Record<string, TickerGex>;

interface RawSide {
  gamma?: unknown;
  volume?: unknown;
  "open-interest"?: unknown;
  openInterest?: unknown;
}

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

/** Today's date in America/New_York as YYYY-MM-DD. 0DTE is an ET concept. */
function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * The 0DTE listing for a ticker: today's expiration when it exists, else the
 * nearest future listing. On a weekend / holiday there is no true 0DTE, so
 * falling back to the front listing keeps the column populated instead of blank.
 */
async function resolveZeroDte(ticker: string, signal: AbortSignal): Promise<string | null> {
  const json = await fetch(`/api/expirations?ticker=${encodeURIComponent(ticker)}`, { signal })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const items: Array<Record<string, unknown>> = json?.data?.items ?? [];
  if (!items.length) return null;

  const dates = [
    ...new Set(items.map((it) => String(it["expiration-date"] ?? "").slice(0, 10)).filter(Boolean)),
  ].sort();
  const today = etToday();
  return dates.find((d) => d === today) ?? dates.find((d) => d >= today) ?? dates[dates.length - 1] ?? null;
}

/**
 * Fetch one ticker's chain for `expiration` and reduce it to an offset→GEX map.
 * Strikes with no gamma AND no position on either side are dropped before the
 * ATM index is computed, so a sparse far-OTM tail can't shift the ladder.
 */
async function loadTicker(
  ticker: string,
  basis: GexBasis,
  signal: AbortSignal
): Promise<TickerGex | null> {
  const expiration = await resolveZeroDte(ticker, signal);
  if (!expiration) return null;

  const json = await fetch(
    `/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(expiration)}&range=all`,
    { signal }
  )
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  const data = json?.data as Record<string, unknown> | undefined;
  const items = (data?.items as unknown[]) ?? [];
  const spot = num(data?.underlyingPrice);
  if (!items.length || !(spot > 0)) return null;

  // The payload nests strikes under expiration groups; keep only the target date
  // (range=all can return neighbours).
  const groups = (items as { "expiration-date"?: string; strikes?: unknown[] }[]).filter(
    (g) => String(g["expiration-date"] ?? "").slice(0, 10) === expiration.slice(0, 10)
  );
  const useGroups = groups.length ? groups : (items as { strikes?: unknown[] }[]);

  const acc = new Map<number, OffsetGex>();
  for (const group of useGroups) {
    for (const item of group.strikes ?? []) {
      const it = item as Record<string, unknown>;
      const strike = num(it["strike-price"]);
      if (!strike) continue;

      const c = it.call as RawSide | undefined;
      const p = it.put as RawSide | undefined;
      const posOf = (o: RawSide | undefined): number => {
        if (!o) return 0;
        const oi = basis === "vol-only" ? 0 : num(o["open-interest"] ?? o.openInterest);
        return oi + num(o.volume);
      };

      const callPos = posOf(c);
      const putPos = posOf(p);
      if (callPos === 0 && putPos === 0) continue;

      // abs(gamma) so a stray negative quote can never flip a side's sign.
      const netGEX =
        Math.abs(num(c?.gamma)) * callPos * spot * spot -
        Math.abs(num(p?.gamma)) * putPos * spot * spot;

      acc.set(strike, { strike, netGEX });
    }
  }
  if (!acc.size) return null;

  const sorted = [...acc.values()].sort((a, b) => a.strike - b.strike);
  let atmIdx = 0;
  let best = Infinity;
  sorted.forEach((r, i) => {
    const d = Math.abs(r.strike - spot);
    if (d < best) {
      best = d;
      atmIdx = i;
    }
  });

  // Keep only ±SIDE_STRIKES around ATM. The home heatmap windows SPX to the same
  // ±20 (pickCenterRows), so any offset outside this range can never be rendered
  // — building it would just be wasted work on every poll. Trimmed AFTER atmIdx
  // is resolved so a sparse far-OTM tail can't drag the ATM off its real strike.
  const map: OffsetGexMap = {};
  const lo = Math.max(0, atmIdx - SIDE_STRIKES);
  const hi = Math.min(sorted.length - 1, atmIdx + SIDE_STRIKES);
  for (let i = lo; i <= hi; i++) {
    map[i - atmIdx] = sorted[i];
  }

  return { map, spot, atmStrike: sorted[atmIdx].strike, expiration };
}

/**
 * Loads 0DTE per-strike net GEX for each ticker and re-fetches on `refreshMs`.
 * Errors are swallowed per-ticker: one dead chain leaves that column showing "—"
 * rather than blanking the other.
 */
export function useDualTickerGex(
  tickers: readonly string[],
  basis: GexBasis,
  refreshMs = 60_000,
  enabled = true
): { data: DualTickerGex; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<DualTickerGex>({});
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const key = useMemo(() => tickers.join(","), [tickers]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const list = key.split(",").filter(Boolean);
    if (!list.length) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const results = await Promise.allSettled(
          list.map((t) => loadTicker(t.toUpperCase(), basis, ctrl.signal))
        );
        if (cancelled || ctrl.signal.aborted) return;

        // Merge rather than replace: a ticker that failed this cycle keeps its
        // last good values instead of flickering to "—".
        setData((prev) => {
          const next: DualTickerGex = { ...prev };
          results.forEach((res, i) => {
            const t = list[i].toUpperCase();
            if (res.status === "fulfilled" && res.value) next[t] = res.value;
          });
          return next;
        });
      } finally {
        // Guarded: an aborted cycle must not clear the spinner for the cycle
        // that superseded it.
        if (!cancelled && !ctrl.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [key, basis, tick, enabled]);

  useEffect(() => {
    if (!enabled || refreshMs <= 0) return;
    const id = setInterval(() => setTick((t) => t + 1), refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, enabled]);

  return { data, loading, refresh };
}
