"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  groupEarningsByDate,
  pickAnticipated,
  ANTICIPATED_PER_DAY,
  type CalEvent,
  type EarnBucket,
  type EarnRow,
} from "@/lib/econCalendar";
import { useRefreshSource } from "@/lib/refreshBus";

/**
 * useEconCalendar — the calendar feed, fetched once and shaped for rendering.
 *
 * Three endpoints in parallel, same as both desktop copies:
 *   /api/calendar        economic events (ForexFactory + the presidential feed)
 *   /api/calendar-quote  the decorative quote of the day
 *   /proxy/earnings-week  Mon–Fri of this week AND next, EVERY name Nasdaq lists
 *
 * That last one used to be pre-filtered server-side to mcap ≥ $25B, which threw
 * away most of a "most anticipated" week. It now returns the lot (~2,500 rows
 * across two weeks) and the narrowing happens here via `pickAnticipated`, so
 * `earnings` / `earnByDate` stay board-sized while `earningsAll` keeps the raw
 * feed available for a surface that wants to widen without another fetch.
 *
 * FAILURE SEMANTICS WORTH KNOWING: /api/calendar answers HTTP 200 with an empty
 * events array when the upstream is down, so `res.ok` tells you nothing. The
 * real signal is `source` ("forexfactory" | "cache" | "saved" | "unavailable")
 * and `warning`, both surfaced here so a view can say "feed is stale" instead
 * of "no events this week".
 *
 * The data itself does not poll — economic events are scheduled days ahead and
 * the server caches for 30 minutes. What ticks is `now`, once a minute, purely
 * so the 30-minute staleness cutoff re-evaluates and events fade as they pass.
 * `earnByDate` is memoised on `earnings`, not rebuilt on that tick (both
 * desktop copies rebuild the whole Map every 60s for no reason).
 */

const CLOCK_MS = 60_000;

export type EconCalendarState = {
  events: CalEvent[];
  /** Anticipated names only (see perDay). This is what a view should render. */
  earnings: EarnRow[];
  /** The unnarrowed feed — every name Nasdaq listed for both weeks. */
  earningsAll: EarnRow[];
  /** pre / after / tbd — see EarnBucket. `tbd` is the unconfirmed-time bucket. */
  earnByDate: Map<string, EarnBucket>;
  quote: string | null;
  /** Where /api/calendar got its data. "unavailable" means the feed is down. */
  source: string | null;
  warning: string | null;
  error: string | null;
  loading: boolean;
  /** Ticks once a minute; feed it to isStale(). */
  now: number;
  reload: () => Promise<void>;
};

export function useEconCalendar(
  opts: {
    withQuote?: boolean;
    /** 'this' | 'next' | 'both' — Mon–Fri range asked of the server. */
    week?: "this" | "next" | "both";
    /** Anticipated names per day. 0 = no narrowing (see pickAnticipated). */
    perDay?: number;
  } = {},
): EconCalendarState {
  const { withQuote = true, week = "both", perDay = ANTICIPATED_PER_DAY } = opts;
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [earnings, setEarnings] = useState<EarnRow[]>([]);
  const [quote, setQuote] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    setError(null);
    setWarning(null);
    setSource(null);
    try {
      const [econRes, qRes, earnRes] = await Promise.all([
        fetch("/api/calendar", { cache: "no-store" }),
        withQuote
          ? fetch("/api/calendar-quote", { cache: "no-store" })
          : Promise.resolve(null as unknown as Response),
        fetch(`/proxy/earnings-week?week=${week}`, { cache: "no-store" }),
      ]);

      const econJson = await econRes.json().catch(() => null);
      if (!econRes.ok) {
        setError(econJson?.error ?? `HTTP ${econRes.status}`);
        setEvents([]);
      } else {
        setSource(econJson?.source ?? null);
        setWarning(econJson?.warning ?? null);
        const list: CalEvent[] = Array.isArray(econJson?.events)
          ? econJson.events
          : Array.isArray(econJson)
            ? econJson
            : [];
        setEvents(
          [...list].sort((a, b) =>
            a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time),
          ),
        );
      }

      if (qRes && qRes.ok) {
        const qj = await qRes.json().catch(() => null);
        if (qj?.quote) setQuote(qj.quote);
      }
      if (earnRes.ok) {
        const ej = await earnRes.json().catch(() => null);
        setEarnings(Array.isArray(ej?.rows) ? ej.rows : []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Calendar request failed");
    }
  }, [withQuote, week]);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  // Toolbar refresh. This feed does not poll (see the header), so the button
  // is the ONLY way to re-pull it inside a session — which is most of why the
  // button exists on the calendar page at all.
  useRefreshSource(reload, "useEconCalendar");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  // Narrow ONCE, here, so every consumer of this hook shows the same names and
  // nobody re-derives "which of these matter" per surface.
  const shown = useMemo(() => pickAnticipated(earnings, perDay), [earnings, perDay]);
  const earnByDate = useMemo(() => groupEarningsByDate(shown), [shown]);

  return {
    events,
    earnings: shown,
    earningsAll: earnings,
    earnByDate,
    quote, source, warning, error, loading, now, reload,
  };
}
