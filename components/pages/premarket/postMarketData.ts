"use client";

/**
 * postMarketData — the fetching and grading layer behind the post-market recap.
 *
 * Split out of PostMarketTab.tsx the moment a SECOND surface needed it: the
 * phone build's Prep tab (components/mobile/pages/MobilePrep.tsx) shows the same
 * recap on a 390px screen. Both must read the same recorded ladder, the same
 * saved wall grades and the same next-expiry structure, or the two screens will
 * quietly disagree about how the day went.
 *
 * Nothing in here renders. It is hooks, types and pure math, so the phone does
 * not pull the desktop tab's markup into its chunk to get at them.
 *
 * The hard-won details (why no `anyExpiry`, why "today" is the newest
 * non-weekend day, why the walls recorder's verdict wins) are documented at
 * each function — they are the reason this file exists rather than being
 * re-derived per surface.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { dedupeFetch } from "@/lib/dedupeFetch";
import { findGEXFlip, type ChainRow } from "@/lib/calculations/calculations";

// ─────────────────────────────────────────────────────────────────────────────
//  ET clock helpers — shared by every consumer of the recorded series
// ─────────────────────────────────────────────────────────────────────────────

/** ET calendar day of a timestamp, as YYYY-MM-DD. */
export const etDay = (ts: number) =>
  new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** ET wall-clock HH:MM of a timestamp. */
export const etHm = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  });

export const etMinutes = (ts: number) => {
  const [h, m] = etHm(ts).split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : -1;
};

export const isEtWeekend = (ts: number) => {
  const d = new Date(new Date(ts).toLocaleString("en-US", { timeZone: "America/New_York" }));
  return d.getDay() === 0 || d.getDay() === 6;
};

export const RTH_OPEN_MIN = 9 * 60 + 30;
export const RTH_CLOSE_MIN = 16 * 60;
// ─────────────────────────────────────────────────────────────────────────────
//  intraday ladder history — the thing that makes a real recap possible
// ─────────────────────────────────────────────────────────────────────────────

export type Col = { ts: number; spot: number; cells: { strike: number; net: number }[] };
export type RawCol = { slotTs: number; spot?: number; cells: Array<{ strike: number; net: number }> };
export type HistState = "loading" | "ok" | "empty" | "error";

/**
 * Today's per-minute ladder, RTH only. Mirrors hooks/useGexBubbleHistory's two
 * hard-won guards — the route answers 200 even when it threw, and "today" is the
 * newest NON-WEEKEND day present — but differs from it in one critical way:
 *
 *   NO `anyExpiry=1`.
 *
 * That flag drops the expiry filter so a multi-DAY backfill can span expiries
 * (each trading day is written under its own front expiry). Here it silently
 * merged EVERY expiry recorded in the window into one slot bucket, so the "09:30
 * profile" came back as the whole SPX board while the live side is today's 0DTE
 * alone. The two are ~100x apart: the change hatch ran the full width of every
 * row and the biggest-strike list printed +$65B deltas. This tab compares one
 * expiry with itself, so it asks for that expiry by name.
 *
 * `top` is not a parameter this route understands (the bubble hook passes one
 * anyway) — heatmap mode always returns the full ladder. It is not sent here.
 */
export function useIntradayLadder(enabled: boolean, expiry: string) {
  const [cols, setCols] = useState<Col[]>([]);
  const [state, setState] = useState<HistState>("loading");

  useEffect(() => {
    if (!enabled || !expiry) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await dedupeFetch(
          `/api/snapshots/option-strike-gex-history?mode=heatmap&minutes=480` +
            `&expiry=${encodeURIComponent(expiry)}`,
          { cache: "no-store" },
          20_000,
        );
        if (!res.ok) { if (!cancelled) setState("error"); return; }
        const json = await res.json();
        // The route answers 200 even when it threw — `res.ok` proves nothing.
        if (json?.error || !Array.isArray(json?.columns)) { if (!cancelled) setState("error"); return; }

        const raw = (json.columns as RawCol[]).filter((c) => Array.isArray(c.cells) && c.cells.length);
        if (!raw.length) { if (!cancelled) { setCols([]); setState("empty"); } return; }

        // Newest NON-WEEKEND day present. The recorder has no market-hours gate,
        // so on a Saturday "today" is empty and the newest day is a frozen copy
        // of Friday stamped Saturday.
        let target = "";
        for (const c of [...raw].sort((a, b) => b.slotTs - a.slotTs)) {
          if (isEtWeekend(c.slotTs)) continue;
          target = etDay(c.slotTs);
          break;
        }
        if (!target) { if (!cancelled) { setCols([]); setState("empty"); } return; }

        const day = raw
          .filter((c) => etDay(c.slotTs) === target)
          .filter((c) => {
            const m = etMinutes(c.slotTs);
            return m >= RTH_OPEN_MIN && m <= RTH_CLOSE_MIN;
          })
          .sort((a, b) => a.slotTs - b.slotTs)
          .map((c) => {
            // One reading per strike per slot. The recorder writes ~once a
            // minute and the route buckets to 5-minute slots, so a strike can
            // appear more than once in a column; summing the duplicates would
            // double-count that strike's gamma.
            const byStrike = new Map<number, number>();
            for (const x of c.cells) {
              if (!Number.isFinite(x.strike) || !Number.isFinite(x.net)) continue;
              byStrike.set(x.strike, x.net);
            }
            return {
              ts: c.slotTs,
              spot: Number(c.spot ?? 0),
              cells: [...byStrike.entries()].map(([strike, net]) => ({ strike, net })),
            };
          });

        if (cancelled) return;
        setCols(day);
        setState(day.length ? "ok" : "empty");
      } catch {
        if (!cancelled) setState("error");
      }
    };

    void load();
    const id = setInterval(load, 120_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled, expiry]);

  return { cols, state };
}

// ─────────────────────────────────────────────────────────────────────────────
//  tomorrow's structure — the one panel that needs a second chain
// ─────────────────────────────────────────────────────────────────────────────

export type NextStructure = {
  expiry: string;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  cb: number | null;
  netGex: number | null;
};

/**
 * Per-strike call/put gamma exposure for ONE expiry, straight off /api/chains.
 *
 * The formula is copied from lib/calculations/optionChain.parseExpiration —
 * gamma × (OI + volume) × S² × 0.01 × 100, put side negated — rather than
 * reused, because that helper returns only the NET per strike and the walls are
 * per-side by definition. Same constants, same basis, so tomorrow's walls are
 * computed exactly the way today's are.
 */
export function structureFromChain(items: unknown[], expDate: string, spot: number): NextStructure | null {
  const groups = (items as { "expiration-date"?: string; strikes?: unknown[] }[]).filter(
    (i) => String(i["expiration-date"] ?? "").slice(0, 10) === expDate.slice(0, 10),
  );
  if (!groups.length || !(spot > 0)) return null;

  const rows: { strike: number; call: number; put: number; net: number }[] = [];
  const S = spot;
  for (const g of groups) {
    for (const item of g.strikes || []) {
      const it = item as Record<string, unknown>;
      const strike = parseFloat(String(it["strike-price"] ?? 0));
      if (!strike) continue;
      const side = (o: Record<string, unknown> | undefined) => {
        if (!o) return { gamma: 0, n: 0 };
        const gamma = parseFloat(String(o.gamma)) || 0;
        const oi = parseInt(String(o["open-interest"] ?? o.openInterest ?? 0), 10) || 0;
        const vol = parseInt(String(o.volume ?? 0), 10) || 0;
        return { gamma, n: oi + vol };
      };
      const c = side(it.call as Record<string, unknown> | undefined);
      const p = side(it.put as Record<string, unknown> | undefined);
      const k = S * S * 0.01 * 100;
      const call = c.gamma * c.n * k;
      const put = -(p.gamma * p.n * k);
      if (!Number.isFinite(call) || !Number.isFinite(put)) continue;
      rows.push({ strike, call, put, net: call + put });
    }
  }
  if (rows.length < 5) return null;
  rows.sort((a, b) => a.strike - b.strike);

  const chainRows: ChainRow[] = rows.map((r) => ({ strike: r.strike, netGEX: r.net, netVolGEX: 0 }));
  const cw = rows.reduce((b, r) => (r.call > b.call ? r : b), rows[0]);
  const pw = rows.reduce((b, r) => (Math.abs(r.put) > Math.abs(b.put) ? r : b), rows[0]);
  const cb = rows.reduce((b, r) => (Math.abs(r.net) > Math.abs(b.net) ? r : b), rows[0]);

  return {
    expiry: expDate,
    flip: findGEXFlip(chainRows, spot),
    callWall: cw.call > 0 ? cw.strike : null,
    putWall: pw.put < 0 ? pw.strike : null,
    cb: cb.strike,
    netGex: rows.reduce((s, r) => s + r.net, 0),
  };
}

export function useNextExpiryStructure(enabled: boolean, todayExpiry: string, spot: number) {
  const [next, setNext] = useState<NextStructure | null>(null);
  const [state, setState] = useState<HistState>("loading");
  const doneRef = useRef("");

  useEffect(() => {
    if (!enabled || !todayExpiry || !(spot > 0)) return;
    // One fetch per (expiry, tab-open). The next expiry's book does not move
    // fast enough after the close to justify polling it.
    const key = `${todayExpiry}|${Math.round(spot)}`;
    if (doneRef.current === key) return;
    doneRef.current = key;
    let cancelled = false;

    const load = async () => {
      try {
        const er = await dedupeFetch("/api/expirations?ticker=SPX", { cache: "no-store" }, 15_000);
        if (!er.ok) { if (!cancelled) setState("error"); return; }
        const ej = await er.json();
        const dates: string[] = (ej?.data?.items ?? [])
          .map((i: Record<string, unknown>) => String(i["expiration-date"] ?? "").slice(0, 10))
          .filter(Boolean)
          .sort();
        const nextDate = dates.find((d) => d > todayExpiry.slice(0, 10));
        if (!nextDate) { if (!cancelled) setState("empty"); return; }

        const cr = await dedupeFetch(
          `/api/chains?ticker=SPX&expiration=${encodeURIComponent(nextDate)}&range=all`,
          { cache: "no-store" },
          25_000,
        );
        if (!cr.ok) { if (!cancelled) setState("error"); return; }
        const cj = await cr.json();
        const items: unknown[] = cj?.data?.items ?? [];
        const built = structureFromChain(items, nextDate, spot);
        if (cancelled) return;
        if (!built) { setState("empty"); return; }
        setNext(built);
        setState("ok");
      } catch {
        if (!cancelled) setState("error");
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [enabled, todayExpiry, spot]);

  return { next, state };
}

// ─────────────────────────────────────────────────────────────────────────────
//  the SAVED level grades — server-v2/walls-recorder.js, via /proxy/walls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The recorder captures SPX's call wall / put wall / CORE at 09:29 ET and then
 * every 15 minutes to 16:00, writing only when a level MOVES, and it opens a
 * wall_event whenever spot trades into a live level — classified four slots
 * later as reject / break / broke-and-consolidated / new wall / pin / rolled
 * over. That is a real, server-side grade of the day, already stored.
 *
 * So this tab does not invent its own verdict for those three levels: it reads
 * the recorded one, exactly as /level-log does, and only falls back to grading
 * the price path itself when nothing was recorded for the day. Gamma flip and
 * max pain are not recorded, so those two are always path-derived.
 *
 * Same endpoint and same response shape as components/pages/LevelLog.tsx —
 * { ok, symbol, log[], events[] } for a symbol query.
 */
export type WallLevel = "call_wall" | "put_wall" | "cb";
export type WallReaction =
  | "reject" | "break_lt5" | "break_5" | "consolidated" | "new_wall" | "pin"
  | "rolled_over" | "reached" | "stalled";

export type WallLogRow = {
  slot: number; at: string; ts: string; level_type: WallLevel;
  strike: number; prev_strike: number | null; delta: number | null;
  spot: number; reason: "open" | "change"; level_gex: number | null;
};
export type WallEventRow = {
  hit_slot: number; at: string; level_type: WallLevel; strike: number;
  spot_at_hit: number; reaction: WallReaction | null; excursion_pts: number | null;
  reclaim_min: number | null; kind: "touch" | "approach"; attempts: number;
};

export const REACTION_LABEL: Record<WallReaction, string> = {
  reject: "REJECTED", break_lt5: "BROKE <5", break_5: "BROKEN",
  consolidated: "BROKE & HELD", new_wall: "WALL ROLLED", pin: "PINNED",
  rolled_over: "HELD AT DISTANCE", reached: "TAGGED", stalled: "STALLED NEAR",
};
/** Verdict → the tone the card reads in. Green = the level did its job. */
export const REACTION_TONE: Record<WallReaction, "ok" | "bad" | "warn" | "vio"> = {
  reject: "ok", rolled_over: "ok",
  break_lt5: "warn", break_5: "bad", consolidated: "bad", new_wall: "bad",
  pin: "vio", reached: "warn", stalled: "warn",
};
export const LEVEL_LABEL: Record<WallLevel, string> = { call_wall: "Call Wall", put_wall: "Put Wall", cb: "CORE" };

export type RecordedLevel = {
  open: number | null;      // the 09:29 capture
  last: number | null;      // where it ended the day
  moves: number;            // how many times it was rewritten
  events: WallEventRow[];   // every classified touch, oldest first
};

export function useRecordedWalls(date: string, symbol = "SPX") {
  const [log, setLog] = useState<WallLogRow[]>([]);
  const [events, setEvents] = useState<WallEventRow[]>([]);
  const [state, setState] = useState<HistState>("loading");

  useEffect(() => {
    if (!date) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(
          `/proxy/walls?date=${encodeURIComponent(date)}&symbol=${encodeURIComponent(symbol)}`,
          { cache: "no-store" },
        );
        const j = await r.json();
        if (!alive) return;
        if (!j?.ok) { setState("error"); return; }
        const l: WallLogRow[] = Array.isArray(j.log) ? j.log : [];
        const e: WallEventRow[] = Array.isArray(j.events) ? j.events : [];
        setLog(l); setEvents(e);
        setState(l.length || e.length ? "ok" : "empty");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; };
  }, [date, symbol]);

  const byLevel = useMemo(() => {
    const out = new Map<WallLevel, RecordedLevel>();
    for (const lvl of ["call_wall", "put_wall", "cb"] as WallLevel[]) {
      const rows = log.filter((r) => r.level_type === lvl).sort((a, b) => a.slot - b.slot);
      if (!rows.length) continue;
      out.set(lvl, {
        // `open` is the 09:29 baseline the recorder writes with reason="open";
        // if it is missing (a late start), the first row of the day stands in.
        open: (rows.find((r) => r.reason === "open") ?? rows[0]).strike ?? null,
        last: rows[rows.length - 1].strike ?? null,
        moves: rows.filter((r) => r.reason === "change").length,
        events: events.filter((x) => x.level_type === lvl).sort((a, b) => a.hit_slot - b.hit_slot),
      });
    }
    return out;
  }, [log, events]);

  return { log, events, byLevel, state };
}

