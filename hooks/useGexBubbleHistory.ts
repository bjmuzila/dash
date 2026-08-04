"use client";

import { useEffect, useRef, useState } from "react";
import { dedupeFetch } from "@/lib/dedupeFetch";
import { etDayKey } from "@/components/dashboard/es-candles/chartMath";

/**
 * useGexBubbleHistory — today's per-minute GEX columns, for the bubble trail.
 *
 * Same endpoint the desktop ES chart backfills from, requested small: `top=N`
 * truncates the ladder server-side to the N strongest strikes, which is all the
 * bubbles ever draw anyway, and on a phone the difference between the full
 * ladder and 8 strikes is most of the payload.
 *
 * TWO NON-OBVIOUS THINGS, both learned the hard way on the desktop chart and
 * both reproduced here rather than rediscovered:
 *
 * 1. The route answers HTTP 200 even when it threw — an `error` key and no
 *    `columns`. `res.ok` tells you nothing, so an empty trail is otherwise
 *    indistinguishable from "nothing recorded yet". It is logged.
 *
 * 2. Picking the day to draw is NOT `etDayKey(Date.now())`, and it is NOT "the
 *    newest day in the response". The recorder has no market-hours gate: all
 *    weekend it rewrites a frozen copy of Friday's book once a minute, stamped
 *    Saturday. "Today" is empty on a Saturday; "newest day present" is Saturday,
 *    a day with no candles, whose every minute collapses onto the final bar as
 *    one meaningless stack. The answer is the newest non-weekend day that the
 *    CHART ALSO HAS BARS FOR, which additionally handles holidays.
 */

const REFRESH_MS = 60_000;

export type BubbleColumn = {
  /** Minute-floored timestamp, ms. */
  ts: number;
  cells: { strike: number; net: number }[];
  /** SPX spot when the snapshot was taken. 0 when the row predates the column. */
  spot: number;
};

type RawCol = { slotTs: number; cells: Array<{ strike: number; net: number; netVol?: number }>; spot?: number };

const isEtWeekend = (ts: number) => {
  const d = new Date(new Date(ts).toLocaleString("en-US", { timeZone: "America/New_York" }));
  return d.getDay() === 0 || d.getDay() === 6;
};

export function useGexBubbleHistory({
  enabled,
  expiry,
  minutes = 420,
  top = 8,
  /** ET day keys the chart has candles for — used to pick the day to draw. */
  barDayKeys,
}: {
  enabled: boolean;
  expiry: string;
  minutes?: number;
  top?: number;
  barDayKeys: string[];
}): BubbleColumn[] {
  const [cols, setCols] = useState<BubbleColumn[]>([]);
  const barDaysKey = barDayKeys.join(",");
  const barDaysRef = useRef<string[]>(barDayKeys);
  barDaysRef.current = barDayKeys;

  useEffect(() => {
    if (!enabled || !expiry) {
      setCols([]);
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const res = await dedupeFetch(
          `/api/snapshots/option-strike-gex-history?mode=heatmap&minutes=${minutes}` +
            `&expiry=${encodeURIComponent(expiry)}&anyExpiry=1&symbol=${encodeURIComponent("$SPX")}&top=${top}`,
          { cache: "no-store" },
          20_000,
        );
        if (!res.ok) {
          console.warn("[bubbles] HTTP", res.status, "— trail will be empty");
          return;
        }
        const json = await res.json();
        if (json?.error) {
          console.warn("[bubbles] server returned an error — trail will be empty:", json.error);
          return;
        }
        if (!Array.isArray(json?.columns)) {
          console.warn("[bubbles] response has no `columns` array — keys:", Object.keys(json ?? {}));
          return;
        }
        if (cancelled) return;

        const raw = (json.columns as RawCol[]).filter((c) => Array.isArray(c.cells) && c.cells.length);
        if (!raw.length) {
          setCols([]);
          return;
        }
        const newestFirst = [...raw].sort((a, b) => b.slotTs - a.slotTs);

        // See note 2 in the header.
        const barDays = new Set(barDaysRef.current);
        let picked = "";
        let traded = "";
        for (const col of newestFirst) {
          if (isEtWeekend(col.slotTs)) continue;
          const k = etDayKey(col.slotTs);
          if (!traded) traded = k;
          if (!barDays.size || barDays.has(k)) {
            picked = k;
            break;
          }
        }
        const target = picked || traded;
        if (!target) {
          setCols([]);
          return;
        }

        // One column per minute; newest snapshot in a minute wins.
        const byMinute = new Map<number, BubbleColumn>();
        for (const col of newestFirst) {
          if (etDayKey(col.slotTs) !== target) continue;
          const ts = Math.floor(col.slotTs / 60_000) * 60_000;
          if (byMinute.has(ts)) continue;
          const cells = col.cells
            .filter((c) => c.strike > 0 && Number.isFinite(c.net))
            .map((c) => ({ strike: c.strike, net: c.net }));
          if (!cells.length) continue;
          byMinute.set(ts, { ts, cells, spot: Number(col.spot ?? 0) });
        }
        setCols([...byMinute.values()].sort((a, b) => a.ts - b.ts));
      } catch {
        /* offline — keep whatever trail is already drawn */
      }
    };

    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // barDaysKey (not the array) so a re-render with an equal list is inert.
  }, [enabled, expiry, minutes, top, barDaysKey]);

  return cols;
}
