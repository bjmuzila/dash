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

/**
 * The session journal's storage key. Lives here rather than in PostMarketTab
 * because the historical recap writes the SAME per-date notes: two keys would
 * mean a note typed on the live tab vanished the moment you looked the day up
 * again tomorrow.
 */
export const NOTES_KEY = "cb-postmarket-notes-v1";

/**
 * The last `n` trading sessions ending at `today` (ET, "YYYY-MM-DD"), newest
 * first, for the session picker.
 *
 * Weekends only — there is no market-holiday calendar in the client, and
 * inventing one would be worse than listing a holiday: a wrong holiday HIDES a
 * session that has data. A listed holiday just answers "nothing recorded", which
 * is the truth. `today` is always the first entry even on a weekend, because it
 * is the live option and the picker must be able to get back to it.
 *
 * Dates are walked at 12:00Z so a DST shift can never roll the arithmetic onto
 * the wrong calendar day.
 */
export function recentSessions(today: string, n = 15): string[] {
  const out: string[] = [today];
  let t = Date.parse(`${today}T12:00:00Z`);
  if (!Number.isFinite(t)) return out;
  while (out.length < n) {
    t -= 86_400_000;
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * The trading session before `date` — weekends skipped, holidays not (see
 * recentSessions for why the client does not carry a holiday calendar). Used to
 * pull the prior day's ES bars, which is what the overnight window is made of.
 */
export function prevSessionOf(date: string): string {
  let t = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(t)) return date;
  for (let i = 0; i < 7; i++) {
    t -= 86_400_000;
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    return d.toISOString().slice(0, 10);
  }
  return date;
}

/** "Fri Aug 21" for a session date — the picker's label. Parsed at 12:00Z. */
export function sessionLabel(date: string): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(t)) return date;
  return new Date(t).toLocaleDateString("en-US", {
    timeZone: "UTC", weekday: "short", month: "short", day: "numeric",
  });
}
// ─────────────────────────────────────────────────────────────────────────────
//  intraday ladder history — the thing that makes a real recap possible
// ─────────────────────────────────────────────────────────────────────────────

export type Col = { ts: number; spot: number; cells: { strike: number; net: number }[] };
export type RawCol = { slotTs: number; spot?: number; cells: Array<{ strike: number; net: number }> };
export type HistState = "loading" | "ok" | "empty" | "error";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ─────────────────────────────────────────────────────────────────────────────
//  THE SESSION FREEZE — a past date rendering the REAL tabs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * server-v2/premarket-freeze-recorder.js captures the page's INPUTS twice a
 * trading day — 'pre' at 09:10-09:29 and 'post' at 16:05-16:25 ET — into
 * premarket_freeze. A frozen date therefore renders the real Premarket and
 * Post-Market tabs off the real chain from that session: same components, same
 * math, just not live.
 *
 * INPUTS, not outputs. The payload is the /proxy/snapshot the socket would have
 * delivered, so every derived value on the page (walls, CORE, max pain,
 * expected move, DEX/vanna, premium, written-vs-traded) is recomputed in the
 * browser by the SAME memos the live path runs. Nothing is stored twice and
 * nothing can drift.
 *
 * It cannot be back-filled: no per-strike marks/volume history exists to
 * rebuild an older session's chain from, so this only covers dates from the day
 * the recorder shipped. HistoricalRecap is what a date without a freeze gets,
 * and the picker chooses between them by whether a row exists.
 */
export type FreezeSlot = "pre" | "post";

export type FreezePayload = {
  symbol: string;
  spot: number;
  prevClose: number | null;
  vix: number | null;
  esFut: number;
  basis: number | null;
  expiry: string;
  expirations: string[];
  updatedAt: number;
  gexRows: ChainRow[];
  callWall: number | null;
  putWall: number | null;
  gexFlip: number | null;
  totalNetGex: number | null;
  totalFlowGex: number;
};

/**
 * The shape Premarket.tsx destructures off useMobileGex. A frozen session is
 * swapped in HERE, at the one place the live data enters the page, so every
 * memo downstream is untouched — that is the whole trick.
 */
export type FrozenGex = {
  chain: ChainRow[];
  spot: number;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  totalNetGex: number | null;
  esFut: number;
  basis: number | null;
  expiry: string;
  isZeroDte: boolean;
  connected: boolean;
  hasData: boolean;
  updatedAt: number | null;
  source: "live" | "rest" | "off";
};

/**
 * Freeze payload → the live hook's shape.
 *
 * `flip` is recomputed with findGEXFlip exactly as useMobileGex does, falling
 * back to the server's own value the same way, so the frozen page cannot show a
 * different flip than the live page showed that day for the same chain.
 *
 * `basis` is the pair captured WITH the chain, which is the only honest basis
 * for a past session — today's ES−SPX difference says nothing about last
 * Friday's.
 */
export function frozenGexOf(p: FreezePayload | null, date: string): FrozenGex | null {
  if (!p || !Array.isArray(p.gexRows) || !p.gexRows.length) return null;
  const chain = p.gexRows;
  return {
    chain,
    spot: p.spot,
    flip: findGEXFlip(chain, p.spot) ?? p.gexFlip,
    callWall: p.callWall,
    putWall: p.putWall,
    totalNetGex: p.totalNetGex,
    esFut: p.esFut,
    basis: p.basis,
    expiry: p.expiry,
    isZeroDte: !!p.expiry && p.expiry.slice(0, 10) === date,
    // FROZEN, so: not connected, and source 'off'. The page's own status chip
    // reads these — it must say the feed is not live rather than inheriting a
    // green LIVE badge from a day that ended a week ago.
    connected: false,
    hasData: true,
    updatedAt: p.updatedAt,
    source: "off",
  };
}

/** Both captures for one session, in one request. */
export function useSessionFreeze(date: string, enabled: boolean) {
  const [pre, setPre] = useState<FreezePayload | null>(null);
  const [post, setPost] = useState<FreezePayload | null>(null);
  const [state, setState] = useState<HistState>("loading");

  useEffect(() => {
    if (!enabled || !date) { setState("empty"); setPre(null); setPost(null); return; }
    let alive = true;
    setState("loading"); setPre(null); setPost(null);
    (async () => {
      try {
        const r = await dedupeFetch(
          `/proxy/premarket-freeze?date=${encodeURIComponent(date)}&symbol=SPX`,
          { cache: "no-store" },
          30_000,
        );
        const j = await r.json();
        if (!alive) return;
        if (!j?.ok || !Array.isArray(j.rows)) { setState("error"); return; }
        const rows = j.rows as { slot?: string; payload?: FreezePayload }[];
        const pick = (s: FreezeSlot) => rows.find((x) => x.slot === s)?.payload ?? null;
        const p = pick("pre"), q = pick("post");
        setPre(p); setPost(q);
        setState(p || q ? "ok" : "empty");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; };
  }, [date, enabled]);

  return { pre, post, state };
}

/**
 * Which sessions have a capture, and which slots. The picker needs this to know
 * whether a date opens the real tabs or the recorded-stores recap — and it is
 * one small request (no payloads, just flags), unlike asking for each date.
 */
export type FreezeDay = { date: string; pre: boolean; post: boolean };

export function useFreezeDates(limit = 120) {
  const [rows, setRows] = useState<FreezeDay[]>([]);
  const [state, setState] = useState<HistState>("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await dedupeFetch(
          `/proxy/premarket-freeze?dates=1&limit=${limit}&symbol=SPX`,
          { cache: "no-store" },
          60_000,
        );
        const j = await r.json();
        if (!alive) return;
        if (!j?.ok || !Array.isArray(j.rows)) { setState("error"); return; }
        const out: FreezeDay[] = (j.rows as Record<string, unknown>[])
          .map((x) => ({
            date: String(x.date ?? "").slice(0, 10),
            pre: !!x.has_pre,
            post: !!x.has_post,
          }))
          .filter((x) => x.date);
        setRows(out);
        setState(out.length ? "ok" : "empty");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; };
  }, [limit]);

  const byDate = useMemo(() => new Map(rows.map((r) => [r.date, r])), [rows]);
  return { rows, byDate, state };
}

/**
 * A named session's ES 5m bars PLUS the prior session's, in the shape
 * useEsCandles' `sessionCandles` returns.
 *
 * Two dates, not one, because the page's overnight window is built from them:
 * the 18:00→09:30 range, the prior RTH high/low and the prior 16:00 close all
 * live in the day BEFORE the session on screen. One date would leave the
 * overnight panel permanently blank on a frozen page.
 */
export type DatedBar = {
  timestamp: number; date: string; slotKey: string;
  open: number; high: number; low: number; close: number; volume: number;
};

async function fetchDatedBars(date: string): Promise<DatedBar[]> {
  const r = await dedupeFetch(
    `/api/snapshots/candles?date=${encodeURIComponent(date)}&interval=5&limit=600&lite=1`,
    { cache: "no-store" },
    30_000,
  );
  const j = await r.json();
  const cols: string[] = Array.isArray(j?.cols) ? j.cols : [];
  const raw: unknown[][] = Array.isArray(j?.rows) ? j.rows : [];
  if (!cols.length || !raw.length) return [];
  const ix = (n: string) => cols.indexOf(n);
  const iT = ix("timestamp"), iD = ix("date"), iK = ix("slotKey");
  const iO = ix("open"), iH = ix("high"), iL = ix("low"), iC = ix("close"), iV = ix("volume");
  return raw
    .map((t) => ({
      timestamp: num(t[iT]),
      date: String(t[iD] ?? date),
      slotKey: String(t[iK] ?? ""),
      open: num(t[iO]), high: num(t[iH]), low: num(t[iL]), close: num(t[iC]),
      volume: num(t[iV]),
    }))
    .filter((b) => b.timestamp > 0 && b.close > 0 && b.slotKey);
}

export function useDatedEsCandles(date: string, enabled: boolean) {
  const [rows, setRows] = useState<DatedBar[]>([]);
  const [state, setState] = useState<HistState>("loading");

  useEffect(() => {
    if (!enabled || !date) { setRows([]); setState("empty"); return; }
    let alive = true;
    setState("loading"); setRows([]);
    (async () => {
      try {
        const [prior, day] = await Promise.all([
          fetchDatedBars(prevSessionOf(date)),
          fetchDatedBars(date),
        ]);
        if (!alive) return;
        const merged = [...prior, ...day]
          .sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey));
        setRows(merged);
        setState(merged.length ? "ok" : "empty");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; };
  }, [date, enabled]);

  return { rows, state };
}

// ─────────────────────────────────────────────────────────────────────────────
//  THE DEEP HISTORY — one settled row per session, kept forever
// ─────────────────────────────────────────────────────────────────────────────

/**
 * server-v2/gex-levels-history-recorder.js writes ONE row per (date, SPX) and
 * upserts it all session, so after the close it holds that day's settled
 * picture: spot, the call wall (`resistance`), the put wall (`support`), the
 * gamma flip (`neutral`), total dollar gamma, the call/put gamma ratio, the
 * second wall each side, total OI, and a 48-point cumulative GEX curve.
 *
 * It is the ONLY per-day store here that is not on a retention clock, and it
 * back-fills its own gaps from settled ThetaData OI on boot (source='theta'),
 * so a session the live recorder missed still has a row. That is what makes a
 * recap of an ARBITRARY past date possible at all — the per-minute ladder below
 * is pruned to about two sessions, and /proxy/walls only starts at 09:29 on
 * days the recorder was up.
 *
 * Read: GET /proxy/gex-levels-history?symbol=SPX&limit=N (subscriber).
 *
 * NOTE the symbol key is 'SPX', not '$SPX'. The recorder stores under whatever
 * /proxy/gex reports (no dollar sign) and only its Theta back-fill uses '$SPX'
 * — see STORE_SYMBOL / THETA_SYMBOL in its header. eod_gex, below, is keyed the
 * OTHER way; that asymmetry is real and neither should be "tidied".
 */
export type CurvePt = { k: number; c: number };
export type GexLevelDay = {
  date: string;
  spot: number;
  /** Call wall. */
  resistance: number | null;
  /** Put wall. */
  support: number | null;
  /** Gamma flip. */
  neutral: number | null;
  dollarGamma: number;
  cpgRatio: number;
  r2: number | null;
  s2: number | null;
  openInt: number;
  curve: CurvePt[] | null;
  source: string;
};

/**
 * How many settled sessions to pull. It bounds BOTH the picker's window and the
 * payload — each row carries a 48-point curve, so this is not a "just ask for
 * everything" endpoint. 40 sessions is about two months and lands around 35KB.
 *
 * ONE constant, because the picker (Premarket.tsx) and the recap
 * (HistoricalRecap.tsx) both call the hook and dedupeFetch only collapses them
 * into a single request if the URL matches — a different limit on either side
 * silently doubles the fetch.
 */
export const GEX_HISTORY_LIMIT = 40;

export function useGexLevelsHistory(limit = GEX_HISTORY_LIMIT, symbol = "SPX") {
  const [rows, setRows] = useState<GexLevelDay[]>([]);
  const [state, setState] = useState<HistState>("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await dedupeFetch(
          `/proxy/gex-levels-history?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
          { cache: "no-store" },
          20_000,
        );
        const j = await r.json();
        if (!alive) return;
        if (!j?.ok || !Array.isArray(j.rows)) { setState("error"); return; }
        const out: GexLevelDay[] = (j.rows as Record<string, unknown>[])
          .map((x) => ({
            date: String(x.date ?? "").slice(0, 10),
            spot: num(x.spot),
            resistance: numOrNull(x.resistance),
            support: numOrNull(x.support),
            neutral: numOrNull(x.neutral),
            dollarGamma: num(x.dollar_gamma),
            cpgRatio: num(x.cpg_ratio),
            r2: numOrNull(x.r2),
            s2: numOrNull(x.s2),
            openInt: num(x.open_int),
            curve: Array.isArray(x.curve)
              ? (x.curve as Record<string, unknown>[])
                .map((p) => ({ k: num(p.k), c: num(p.c) }))
                .filter((p) => p.k > 0)
              : null,
            source: String(x.source ?? ""),
          }))
          .filter((x) => x.date && x.spot > 0)
          .sort((a, b) => (a.date < b.date ? 1 : -1));   // newest first
        setRows(out);
        setState(out.length ? "ok" : "empty");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; };
  }, [limit, symbol]);

  const byDate = useMemo(() => new Map(rows.map((r) => [r.date, r])), [rows]);
  const dates = useMemo(() => rows.map((r) => r.date), [rows]);

  return { rows, byDate, dates, state };
}

/**
 * eod_gex — the OTHER settled per-day row, from server-v2/eod-gex-recorder.js.
 * Overlaps gex_levels_history on total gamma and spot but carries three things
 * that store does not: the 0DTE / ex-0DTE split, and the recorder's own pin
 * (strike, and what share of the board's gamma sat on it).
 *
 * Keyed '$SPX' here (Theta's index key) where the levels store uses 'SPX'. The
 * date is queried WITHOUT a symbol and the SPX row picked out of the answer, so
 * a future key change cannot silently return nothing.
 */
export type EodGexDay = {
  date: string;
  totalGex: number;
  spot: number;
  gex0dte: number | null;
  gexEx0dte: number | null;
  pinStrike: number | null;
  pinShare: number | null;
  source: string;
};

export function useEodGex(date: string) {
  const [row, setRow] = useState<EodGexDay | null>(null);
  const [state, setState] = useState<HistState>("loading");

  useEffect(() => {
    if (!date) return;
    let alive = true;
    setState("loading");
    setRow(null);
    (async () => {
      try {
        const r = await dedupeFetch(
          `/api/eod-gex?date=${encodeURIComponent(date)}&limit=50`,
          { cache: "no-store" },
          15_000,
        );
        const j = await r.json();
        if (!alive) return;
        const all = (Array.isArray(j?.rows) ? j.rows : []) as Record<string, unknown>[];
        const hit = all.find((x) => {
          const s = String(x.symbol ?? "").toUpperCase();
          return s === "$SPX" || s === "SPX";
        });
        if (!hit) { setState("empty"); return; }
        setRow({
          date: String(hit.date ?? date).slice(0, 10),
          totalGex: num(hit.total_gex),
          spot: num(hit.spot),
          gex0dte: numOrNull(hit.total_gex_0dte),
          gexEx0dte: numOrNull(hit.total_gex_ex0dte),
          pinStrike: numOrNull(hit.pin_strike),
          pinShare: numOrNull(hit.pin_share),
          source: String(hit.source ?? ""),
        });
        setState("ok");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; };
  }, [date]);

  return { row, state };
}

/**
 * The session's ES 5-minute bars, straight out of es_candles for ONE date.
 *
 * `?lite=1` is the columnar encoding — same rows, numbers as numbers instead of
 * pg's quoted strings, roughly a tenth of the bytes. The verbose form is left
 * untouched for its other callers.
 *
 * These are ES, not SPX. Nothing here converts them: the basis on a past
 * session is not knowable from a live quote, and shifting a whole day by
 * today's basis is exactly the kind of plausible-but-wrong number this page
 * refuses to print. The recap labels the range ES and lets the SPX side come
 * from the SPX stores above.
 */
export type SessionBar = { ts: number; open: number; high: number; low: number; close: number };

export function useSessionEsBars(date: string) {
  const [bars, setBars] = useState<SessionBar[]>([]);
  const [state, setState] = useState<HistState>("loading");

  useEffect(() => {
    if (!date) return;
    let alive = true;
    setState("loading");
    setBars([]);
    (async () => {
      try {
        const r = await dedupeFetch(
          `/api/snapshots/candles?date=${encodeURIComponent(date)}&interval=5&limit=600&lite=1`,
          { cache: "no-store" },
          20_000,
        );
        const j = await r.json();
        if (!alive) return;
        const cols: string[] = Array.isArray(j?.cols) ? j.cols : [];
        const raw: unknown[][] = Array.isArray(j?.rows) ? j.rows : [];
        if (!cols.length || !raw.length) { setState("empty"); return; }
        const ix = (name: string) => cols.indexOf(name);
        const iT = ix("timestamp"), iO = ix("open"), iH = ix("high"), iL = ix("low"), iC = ix("close");
        if (iT < 0 || iC < 0) { setState("error"); return; }
        const out = raw
          .map((t) => ({
            ts: num(t[iT]), open: num(t[iO]), high: num(t[iH]), low: num(t[iL]), close: num(t[iC]),
          }))
          .filter((b) => b.ts > 0 && b.close > 0)
          .sort((a, b) => a.ts - b.ts);
        setBars(out);
        setState(out.length ? "ok" : "empty");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; };
  }, [date]);

  /** RTH only — the overnight session is a different question. */
  const rth = useMemo(
    () => bars.filter((b) => {
      const m = etMinutes(b.ts);
      return m >= RTH_OPEN_MIN && m <= RTH_CLOSE_MIN;
    }),
    [bars],
  );

  return { bars, rth, state };
}

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
 *
 * ── ALWAYS ONE NAMED SESSION (2026-08-24) ───────────────────────────────────
 * This used to have two paths: an explicit `date` asked the route for one exact
 * day (`minutes=0`), and omitting it asked for a rolling **480-minute window**
 * and then picked the newest non-weekend day out of whatever came back.
 *
 * The rolling window was wrong for every caller here, and it failed silently.
 * The window is measured from `Date.now()`, so at 19:57 ET it starts at 11:57
 * ET and the morning is simply not in the response — on a recap of a session
 * that recorded perfectly from 09:30. The consumer has no way to tell that from
 * a recorder that started late, so PostMarketTab dropped its AM bucket and
 * announced "the ladder recorder only covers 11:57-16:00 today", blaming the
 * recorder for the caller's own clock. The later you opened the tab, the more
 * of the session disappeared.
 *
 * There is no version of "a recap of one session" that wants a window anchored
 * to the wall clock, so the window is gone. The date is resolved here — the
 * caller's, or today in ET — and the request is always `minutes=0&date=`, which
 * is the route's switch to getOptionStrikeGexSlots(date, expiry, symbol).
 *
 * Two details that survive from the old path:
 *   · WEEKENDS. The recorder has no market-hours gate, so on a Saturday "today"
 *     is a frozen copy of Friday stamped Saturday. The old code found Friday by
 *     scanning the payload; there is nothing to scan now, so a weekend date is
 *     walked back to the previous session before the request goes out.
 *   · POLLING, but only while the session is still running. A settled day does
 *     not change, and re-fetching a whole finished session every two minutes is
 *     pure waste.
 *
 * Payload cost is a wash: both queries bucket to ONE MINUTE (see
 * getOptionStrikeGexSlots / …Window in _lib-db.cjs), and the window was already
 * unbounded by date — 480 minutes late in the day covers more wall-clock time
 * than a single RTH session does.
 *
 * NOTE the retention floor. pruneOptionStrikeGexHistory keeps ~2 SESSIONS of
 * the per-minute ladder, so a date older than that legitimately answers empty.
 * That is a real "not recorded", not a failure, and the caller renders it as
 * one rather than filling the gap in.
 */
export function useIntradayLadder(enabled: boolean, expiry: string, date?: string) {
  const [cols, setCols] = useState<Col[]>([]);
  const [state, setState] = useState<HistState>("loading");

  /**
   * The session actually requested. Weekend dates walk back to the previous
   * weekday — see WEEKENDS above. Resolved outside the effect so it keys the
   * effect by value and a re-render cannot re-fire the fetch.
   */
  const target = useMemo(() => {
    const wanted = date || etDay(Date.now());
    return isEtWeekend(Date.parse(`${wanted}T12:00:00Z`)) ? prevSessionOf(wanted) : wanted;
  }, [date]);

  useEffect(() => {
    if (!enabled || !expiry || !target) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await dedupeFetch(
          `/api/snapshots/option-strike-gex-history?mode=heatmap&minutes=0` +
            `&date=${encodeURIComponent(target)}&expiry=${encodeURIComponent(expiry)}`,
          { cache: "no-store" },
          20_000,
        );
        if (!res.ok) { if (!cancelled) setState("error"); return; }
        const json = await res.json();
        // The route answers 200 even when it threw — `res.ok` proves nothing.
        if (json?.error || !Array.isArray(json?.columns)) { if (!cancelled) setState("error"); return; }

        const raw = (json.columns as RawCol[]).filter((c) => Array.isArray(c.cells) && c.cells.length);
        if (!raw.length) { if (!cancelled) { setCols([]); setState("empty"); } return; }

        const day = raw
          .filter((c) => etDay(c.slotTs) === target)
          .filter((c) => {
            const m = etMinutes(c.slotTs);
            return m >= RTH_OPEN_MIN && m <= RTH_CLOSE_MIN;
          })
          .sort((a, b) => a.slotTs - b.slotTs)
          .map((c) => {
            // One reading per strike per slot. The recorder can write more than
            // once inside a bucket, so a strike may appear twice in a column;
            // summing the duplicates would double-count that strike's gamma.
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
    // A settled session is settled. Poll only while the day being shown is the
    // day in progress — which is now a property of the DATE, not of whether the
    // caller happened to pass one.
    if (target !== etDay(Date.now())) return () => { cancelled = true; };
    const id = setInterval(load, 120_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled, expiry, target]);

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

// ─────────────────────────────────────────────────────────────────────────────
//  SPY / QQQ — the same board, off REST instead of the socket
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The live socket is SPX-only: lib/gexSocket carries one symbol's frames and
 * useMobileGex pins them to SPX's front expiry. SPY and QQQ therefore cannot
 * ride it, and pushing two more symbols through it is a server change, not a
 * page change.
 *
 * What they CAN ride is the path the home heatmap's SPY/QQQ columns already use
 * (hooks/useDualTickerGex): /api/expirations to find the front contract, then
 * /api/chains for that contract, then the same gamma math on the raw legs. That
 * is a 60-second poll rather than a live tape — accurate, one cycle behind, and
 * clearly labelled as such in the UI.
 *
 * Scale note: this uses gamma × (OI + volume) × S² × 0.01 × 100, which is the
 * optionChain.parseExpiration convention. 0.01 × 100 = 1, so it lands on exactly
 * the same number as lib/calculations netGEXOf (gamma × pos × S²) — the SPX
 * board and these two are directly comparable. Do NOT "simplify" one side of
 * that constant away without the other.
 */

export type TickerRow = {
  strike: number;
  call: number;   // +gamma exposure, call side
  put: number;    // −gamma exposure, put side
  net: number;
  callOI: number;
  putOI: number;
};

export type TickerBoard = {
  ticker: string;
  expiry: string;
  spot: number;
  rows: TickerRow[];
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  cb: number | null;
  maxPain: number | null;
  /** ATM straddle × 0.85 — the same estimate the SPX page uses. */
  em: number | null;
  netGex: number;
  callGex: number;
  putGex: number;
  updatedAt: number;
};

const numOf = (v: unknown) => {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

/** Mark, else bid/ask mid, else last/close — the chain payload is inconsistent. */
function markOf(o: Record<string, unknown> | undefined): number {
  if (!o) return 0;
  const m = numOf(o.mark) || numOf(o["mark-price"]);
  if (m > 0) return m;
  const b = numOf(o.bid) || numOf(o["bid-price"]);
  const a = numOf(o.ask) || numOf(o["ask-price"]);
  if (b > 0 || a > 0) return (b + a) / 2;
  return numOf(o.last) || numOf(o["last-price"]) || numOf(o.close);
}

export function parseTickerBoard(
  ticker: string, items: unknown[], expDate: string, spot: number,
): TickerBoard | null {
  const all = items as { "expiration-date"?: string; strikes?: unknown[] }[];
  const groups = all.filter((g) => String(g["expiration-date"] ?? "").slice(0, 10) === expDate.slice(0, 10));
  const use = groups.length ? groups : all;
  if (!use.length || !(spot > 0)) return null;

  const rows: TickerRow[] = [];
  let atm: { d: number; straddle: number } | null = null;
  const K = spot * spot * 0.01 * 100;

  for (const g of use) {
    for (const item of g.strikes ?? []) {
      const it = item as Record<string, unknown>;
      const strike = numOf(it["strike-price"]);
      if (!strike) continue;
      const c = it.call as Record<string, unknown> | undefined;
      const p = it.put as Record<string, unknown> | undefined;
      const pos = (o: Record<string, unknown> | undefined) =>
        !o ? 0 : (parseInt(String(o["open-interest"] ?? o.openInterest ?? 0), 10) || 0)
                 + (parseInt(String(o.volume ?? 0), 10) || 0);
      const oi = (o: Record<string, unknown> | undefined) =>
        !o ? 0 : parseInt(String(o["open-interest"] ?? o.openInterest ?? 0), 10) || 0;

      const call = Math.abs(numOf(c?.gamma)) * pos(c) * K;
      const put = -(Math.abs(numOf(p?.gamma)) * pos(p) * K);
      if (!Number.isFinite(call) || !Number.isFinite(put)) continue;
      rows.push({ strike, call, put, net: call + put, callOI: oi(c), putOI: oi(p) });

      const d = Math.abs(strike - spot);
      const straddle = markOf(c) + markOf(p);
      if (straddle > 0 && (atm == null || d < atm.d)) atm = { d, straddle };
    }
  }
  if (rows.length < 5) return null;
  rows.sort((a, b) => a.strike - b.strike);

  const cw = rows.reduce((b, r) => (r.call > b.call ? r : b), rows[0]);
  const pw = rows.reduce((b, r) => (Math.abs(r.put) > Math.abs(b.put) ? r : b), rows[0]);
  const cb = rows.reduce((b, r) => (Math.abs(r.net) > Math.abs(b.net) ? r : b), rows[0]);

  // Classic max pain: the strike where total in-the-money OI value is smallest.
  let maxPain: number | null = null;
  const withOi = rows.filter((r) => r.callOI > 0 || r.putOI > 0);
  if (withOi.length >= 5) {
    let bestVal = Infinity;
    for (const t of withOi) {
      let v = 0;
      for (const r of withOi) {
        if (t.strike > r.strike) v += (t.strike - r.strike) * r.callOI;
        if (t.strike < r.strike) v += (r.strike - t.strike) * r.putOI;
      }
      if (v < bestVal) { bestVal = v; maxPain = t.strike; }
    }
  }

  return {
    ticker,
    expiry: expDate,
    spot,
    rows,
    flip: findGEXFlip(rows.map((r) => ({ strike: r.strike, netGEX: r.net, netVolGEX: 0 } as ChainRow)), spot),
    callWall: cw.call > 0 ? cw.strike : null,
    putWall: pw.put < 0 ? pw.strike : null,
    cb: cb.strike,
    maxPain,
    em: atm ? atm.straddle * 0.85 : null,
    netGex: rows.reduce((s, r) => s + r.net, 0),
    callGex: rows.reduce((s, r) => s + r.call, 0),
    putGex: rows.reduce((s, r) => s + r.put, 0),
    updatedAt: Date.now(),
  };
}

/**
 * One ticker's front-expiry board, polled. `enabled` is false while the tab is
 * showing a different symbol, so switching away stops the poll rather than
 * leaving three chains refreshing behind one visible board.
 */
export function useTickerBoard(ticker: string, enabled: boolean, refreshMs = 60_000) {
  const [board, setBoard] = useState<TickerBoard | null>(null);
  const [state, setState] = useState<HistState>("loading");

  useEffect(() => {
    if (!enabled || !ticker) return;
    let cancelled = false;
    const ctrl = new AbortController();

    const load = async () => {
      try {
        const today = etDay(Date.now());
        const er = await fetch(`/api/expirations?ticker=${encodeURIComponent(ticker)}`,
          { cache: "no-store", signal: ctrl.signal });
        if (!er.ok) { if (!cancelled) setState("error"); return; }
        const ej = await er.json();
        const dates: string[] = [...new Set(
          (ej?.data?.items ?? []).map((i: Record<string, unknown>) =>
            String(i["expiration-date"] ?? "").slice(0, 10)).filter(Boolean),
        )].sort() as string[];
        // FRONT = the nearest listing on or after today. On a 0DTE name that is
        // today; on a name that does not list today it is the next one out, and
        // the UI says which date it actually got.
        const front = dates.find((d) => d >= today);
        if (!front) { if (!cancelled) setState("empty"); return; }

        const cr = await fetch(
          `/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(front)}&range=all`,
          { cache: "no-store", signal: ctrl.signal },
        );
        if (!cr.ok) { if (!cancelled) setState("error"); return; }
        const cj = await cr.json();
        const spot = numOf(cj?.data?.underlyingPrice);
        const built = parseTickerBoard(ticker, cj?.data?.items ?? [], front, spot);
        if (cancelled) return;
        if (!built) { setState("empty"); return; }
        setBoard(built);
        setState("ok");
      } catch {
        // An abort on unmount lands here too — nothing to report either way.
        if (!cancelled && !ctrl.signal.aborted) setState("error");
      }
    };

    void load();
    const id = setInterval(load, refreshMs);
    return () => { cancelled = true; ctrl.abort(); clearInterval(id); };
  }, [ticker, enabled, refreshMs]);

  return { board, state };
}
