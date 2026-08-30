"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The live year — what keeps this page from going stale between data regens.
//
// THE BUG THIS EXISTS TO FIX. Everything on /explore/seasonality is compiled
// into seasonalityData.ts at build time, including the orange "this year" line.
// That was fine for the 98 years of history and wrong for the current one: the
// line stopped at YTD_LAST_DATE and only moved when somebody regenerated the
// data file, so the headline "ahead of / behind season" number could be a week
// or a month old while the page looked live. A visitor has no way to tell.
//
// So the static arrays are now a FLOOR, not the answer. On mount this hook
// asks /api/public-seasonality for the sessions after YTD_LAST_DATE and
// extends the year in place. Nothing else about the page changes: the static
// data still renders instantly and prerenders for a cold visitor off a social
// link, and the extension arrives a moment later.
//
// HYDRATION. The returned arrays are the STATIC ones on the first render, on
// both sides. The fetch runs in an effect and the extension lands in a state
// update afterwards — never seeded during render, which is how this page would
// otherwise render one line on the server and another on the client (React
// #418). Same rule the section routing and the overlay picker follow.
//
// FAILURE IS SILENT AND CORRECT. No endpoint, no network, an error, a bad
// payload — the hook keeps the static arrays and `live` stays false. The page
// then behaves exactly as it did before this file existed. A public page whose
// whole job is to render for an anonymous visitor must never show an error
// because an optional freshness call did not land.
//
// The same response carries any VIX spike events after the static cutoff, so
// the "After a VIX Spike" event list picks up a spike that happened this week
// off the same request rather than a second one.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { calIndex } from "./calendar";
import {
  YTD_2026_PCT,
  YTD_2026_PX,
  YTD_BASE_PX,
  YTD_LAST_DATE,
} from "./seasonalityData";

/** One VIX spike event, in the shape EXTRAS.vix.events already uses. */
export type LiveVixEvent = {
  date: string;
  vix_pop: number;
  vix_open: number;
  vix_high: number;
  spx_low: number;
  next_high: number;
  low_to_next_high: number;
  next_open_close: number;
};

export type LiveYear = {
  /** Cumulative % from the prior year-end, 365-day axis. */
  pct: number[];
  /** The same series as an index level. */
  px: number[];
  /** Last session represented, ISO. */
  lastDate: string;
  /** True once the extension landed AND it actually added a session. */
  live: boolean;
  /** VIX +20% spikes after the static cutoff, newest first. */
  extraVixEvents: LiveVixEvent[];
};

const STATIC: LiveYear = {
  pct: YTD_2026_PCT,
  px: YTD_2026_PX,
  lastDate: YTD_LAST_DATE,
  live: false,
  extraVixEvents: [],
};

/** Sessions must be finite, positive and inside a sane band for an index. */
const okClose = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * Extend the static year with the sessions after it.
 *
 * Forward-fills the calendar slots between sessions exactly the way the data
 * generator does — a Monday close occupies Saturday and Sunday too — so the
 * extended tail is drawn on the same axis as the 98 years behind it and a
 * hover on a weekend reads the last close rather than a gap.
 */
function extend(rows: [string, number][]): LiveYear | null {
  const pct = [...YTD_2026_PCT];
  const px = [...YTD_2026_PX];
  let lastDate = YTD_LAST_DATE;
  let added = 0;

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const [date, close] = row;
    if (typeof date !== "string" || !okClose(close)) continue;
    if (date <= lastDate) continue;
    const idx = calIndex(date);
    // Guard the axis: a bad date must never write past slot 364 or backwards
    // into a session already recorded.
    if (!Number.isFinite(idx) || idx < px.length - 1 || idx > 364) continue;
    const value = (close / YTD_BASE_PX - 1) * 100;
    while (px.length <= idx) {
      // Fill the intervening weekend/holiday slots with the PREVIOUS close,
      // then overwrite the last one with this session.
      px.push(px[px.length - 1]);
      pct.push(pct[pct.length - 1]);
    }
    px[idx] = close;
    pct[idx] = value;
    lastDate = date;
    added += 1;
  }

  if (!added) return null;
  return { pct, px, lastDate, live: true, extraVixEvents: [] };
}

/**
 * The live year, static until the extension lands.
 *
 * Mounted by BOTH SeasonalityView (the overlay chart) and SeasonalityAlmanac
 * (the Jackson Hole row for the current year), and each mount fires its own
 * request. That is one extra call on one route, against a response the server
 * caches for ten minutes — cheaper than threading the state through a context
 * for two consumers, and it keeps either component mountable on its own.
 */
export function useLiveYear(): LiveYear {
  const [state, setState] = useState<LiveYear>(STATIC);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const r = await fetch(
          `/api/public-seasonality?since=${encodeURIComponent(YTD_LAST_DATE)}`,
          { signal: ac.signal, headers: { Accept: "application/json" } },
        );
        if (!r.ok) return;
        const j = (await r.json()) as {
          spx?: [string, number][];
          vix?: LiveVixEvent[];
        };
        const rows = Array.isArray(j?.spx) ? j.spx : [];
        const next = extend(rows);
        const vix = Array.isArray(j?.vix)
          ? j.vix.filter((e) => e && typeof e.date === "string" && e.date > YTD_LAST_DATE)
          : [];
        if (!next && !vix.length) return;
        setState({ ...(next ?? STATIC), extraVixEvents: vix, live: next != null });
      } catch {
        // Silent by design — see the file header.
      }
    })();
    return () => ac.abort();
  }, []);

  return state;
}
