"use client";

import { useEffect, useRef, useState } from "react";
import { dedupeFetch } from "@/lib/dedupeFetch";
import { useRefreshSource } from "@/lib/refreshBus";
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
 *
 *    `days` extends that to the newest N such days instead of exactly one. The
 *    rule is unchanged — it just does not stop at the first match.
 */

/**
 * Poll cadence.
 *
 * The route returns ONE COLUMN PER MINUTE, so the payload is linear in
 * `minutes`: a two-day window is roughly 4× a one-day one, over what is usually
 * a cellular link. It is also almost entirely IMMUTABLE — yesterday's columns
 * cannot change and only the newest minute is ever new — so re-pulling all of it
 * every 60s to learn one minute is the wrong trade at that size. A wide window
 * polls at half the rate; a today-only window keeps the cadence it had.
 */
const REFRESH_MS = 60_000;
const REFRESH_MS_WIDE = 120_000;
/** Reach above which the slower cadence kicks in — about a session and a half. */
const WIDE_MINUTES = 700;

/**
 * Retry cadence for a load that came back with NOTHING TO DRAW.
 *
 * Every failure path below returns without calling `setCols`, which is the
 * right call — a blip must not wipe a trail that is already on screen — but it
 * left a FIRST load that failed with no trail at all until the next poll, i.e.
 * a blank chart for a full minute or two. On a phone that is most of the time
 * anyone is looking at it, and it is the larger half of "the bubbles only show
 * up sometimes": the route answers HTTP 200 with an `error` key when it threw
 * (note 1 in the header), so a cold cache on the server is a silent minute of
 * nothing.
 *
 * So while `cols` is still EMPTY, an unproductive load retries on this much
 * shorter clock, up to RETRY_MAX times. Once anything has been drawn the retry
 * stops arming and the normal poll takes over — a later failure is then exactly
 * as harmless as it always was.
 */
const RETRY_MS = 6_000;
const RETRY_MAX = 5;

/**
 * Granularity of the `minutes` window, in minutes.
 *
 * `minutes` is a dependency of the effect below, and callers compute it as
 * "now minus the oldest bar day", which means its VALUE CHANGES EVERY MINUTE —
 * so the effect tore itself down and rebuilt once a minute, cancelling any
 * in-flight load as it went (`cancelled` is checked after the parse, before
 * `setCols`). A load that took longer than the time left in the minute could
 * therefore be discarded, re-issued, and discarded again.
 *
 * Rounding UP to a 30-minute step makes the value stable for half an hour at a
 * time. It only ever asks for MORE reach than requested, never less, so no
 * caller loses a column to it.
 */
const MINUTES_QUANTUM = 30;

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
  /**
   * How many trading days of trail to keep, newest first. A MINIMUM in intent
   * and a maximum in effect: you get this many if the response and the chart
   * both have them, fewer if they do not.
   *
   * `minutes` still has to REACH those days — this only decides how much of
   * what came back is kept. Asking for 2 days over a 420-minute window returns
   * one, because that is all the server was asked for.
   */
  days = 1,
  /** ET day keys the chart has candles for — used to pick the days to draw. */
  barDayKeys,
}: {
  enabled: boolean;
  expiry: string;
  minutes?: number;
  top?: number;
  days?: number;
  barDayKeys: string[];
}): BubbleColumn[] {
  const [cols, setCols] = useState<BubbleColumn[]>([]);
  const barDaysKey = barDayKeys.join(",");
  const barDaysRef = useRef<string[]>(barDayKeys);
  barDaysRef.current = barDayKeys;

  // Rounded UP, and only here — the caller keeps computing the honest reach.
  // See MINUTES_QUANTUM.
  const windowMinutes = Math.ceil(minutes / MINUTES_QUANTUM) * MINUTES_QUANTUM;

  // Whether anything has ever been drawn. Read by the retry arm below, and a
  // ref rather than `cols.length` so the effect does not re-run on its own
  // result.
  const hasDrawnRef = useRef(false);
  // The live load, published for the toolbar's refresh button.
  const loadRef = useRef<() => Promise<void>>(async () => {});
  useRefreshSource(() => loadRef.current(), "useGexBubbleHistory");

  useEffect(() => {
    if (!enabled || !expiry) {
      hasDrawnRef.current = false;
      setCols([]);
      return;
    }
    let cancelled = false;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Arm the short retry, but only while there is still nothing on screen.
     * `unproductive` is every path that returned without a `setCols` — an HTTP
     * failure, the 200-with-`error` case, a malformed body, or a throw.
     */
    const armRetry = () => {
      if (cancelled || hasDrawnRef.current) return;
      if (retries >= RETRY_MAX) return;
      retries += 1;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void load();
      }, RETRY_MS);
    };

    const load = async () => {
      try {
        const res = await dedupeFetch(
          `/api/snapshots/option-strike-gex-history?mode=heatmap&minutes=${windowMinutes}` +
            `&expiry=${encodeURIComponent(expiry)}&anyExpiry=1&symbol=${encodeURIComponent("$SPX")}&top=${top}`,
          { cache: "no-store" },
          20_000,
        );
        if (!res.ok) {
          console.warn("[bubbles] HTTP", res.status, "— trail will be empty");
          armRetry();
          return;
        }
        const json = await res.json();
        if (json?.error) {
          console.warn("[bubbles] server returned an error — trail will be empty:", json.error);
          armRetry();
          return;
        }
        if (!Array.isArray(json?.columns)) {
          console.warn("[bubbles] response has no `columns` array — keys:", Object.keys(json ?? {}));
          armRetry();
          return;
        }
        if (cancelled) return;

        const raw = (json.columns as RawCol[]).filter((c) => Array.isArray(c.cells) && c.cells.length);
        if (!raw.length) {
          setCols([]);
          armRetry();
          return;
        }
        const newestFirst = [...raw].sort((a, b) => b.slotTs - a.slotTs);

        // See note 2 in the header. Same rule, N days deep instead of one.
        const want = Math.max(1, Math.floor(days));
        const barDays = new Set(barDaysRef.current);
        const picked: string[] = [];
        const traded: string[] = [];
        for (const col of newestFirst) {
          if (isEtWeekend(col.slotTs)) continue;
          const k = etDayKey(col.slotTs);
          if (!traded.includes(k)) traded.push(k);
          if ((!barDays.size || barDays.has(k)) && !picked.includes(k)) {
            picked.push(k);
            if (picked.length >= want) break;
          }
        }
        // `traded` is the fallback for the case the original comment describes:
        // columns exist but the chart has no bars on any of those days yet.
        const targets = new Set((picked.length ? picked : traded).slice(0, want));
        if (!targets.size) {
          setCols([]);
          armRetry();
          return;
        }

        // One column per minute; newest snapshot in a minute wins. Keyed on the
        // absolute minute, so spanning days needs nothing extra.
        const byMinute = new Map<number, BubbleColumn>();
        for (const col of newestFirst) {
          if (!targets.has(etDayKey(col.slotTs))) continue;
          const ts = Math.floor(col.slotTs / 60_000) * 60_000;
          if (byMinute.has(ts)) continue;
          const cells = col.cells
            .filter((c) => c.strike > 0 && Number.isFinite(c.net))
            .map((c) => ({ strike: c.strike, net: c.net }));
          if (!cells.length) continue;
          byMinute.set(ts, { ts, cells, spot: Number(col.spot ?? 0) });
        }
        const next = [...byMinute.values()].sort((a, b) => a.ts - b.ts);
        if (next.length) hasDrawnRef.current = true;
        else armRetry();
        setCols(next);
      } catch {
        /* offline — keep whatever trail is already drawn */
        armRetry();
      }
    };

    loadRef.current = load;
    void load();
    const id = setInterval(load, windowMinutes > WIDE_MINUTES ? REFRESH_MS_WIDE : REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (retryTimer) clearTimeout(retryTimer);
    };
    // barDaysKey (not the array) so a re-render with an equal list is inert.
    // windowMinutes, not `minutes`: the quantised value is the one the request
    // and the cadence are built from, and it is the whole point that a caller's
    // per-minute recomputation of `minutes` no longer restarts this effect.
  }, [enabled, expiry, windowMinutes, top, days, barDaysKey]);

  return cols;
}
