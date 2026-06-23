"use client";

import { useEffect, useRef, useState } from "react";

/** Per-strike net GEX baselines keyed by age bucket ("open" | "5" | "15" | "30"). */
export type GexBaselines = Record<number, Record<string, number>>;

interface PointResponse {
  mode?: string;
  ages?: number[];
  baselines?: GexBaselines;
}

/**
 * Polls the point-in-time net GEX history for the active expiry and returns
 * per-strike baselines at the open and each requested age. The strike-detail
 * popup subtracts these from the live OI-based netGEX to get rolling differences.
 *
 * NOTE: baselines are OI-based net GEX (that's all the history writer stores),
 * so compare against the live row's `netGEX`, not the OI+Vol composite.
 */
export function useStrikeGexHistory(
  expiry: string,
  ages: number[] = [5, 15, 30],
  pollMs = 30_000,
  tolerant = false
): GexBaselines {
  const [baselines, setBaselines] = useState<GexBaselines>({});
  const agesKey = ages.join(",");

  useEffect(() => {
    if (!expiry) {
      setBaselines({});
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(
          `/api/snapshots/option-strike-gex-history?expiry=${encodeURIComponent(
            expiry
          )}&mode=point&ages=${encodeURIComponent(agesKey)}${
            tolerant ? "&tolerant=1" : ""
          }`,
          { cache: "no-store" }
        );
        if (!r.ok) return;
        const json: PointResponse = await r.json();
        if (cancelled) return;
        setBaselines(json?.baselines ?? {});
      } catch {
        /* ignore — popup falls back to "—" when a baseline is missing */
      }
    };
    load();
    const id = setInterval(load, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [expiry, agesKey, pollMs, tolerant]);

  return baselines;
}
