"use client";

/**
 * useChainGex — the SECOND source for /premarket, and the reason every symbol
 * on the picker now renders the SAME page.
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 * The premarket page is built on ONE destructuring:
 *
 *     const { chain, spot, flip, callWall, putWall, totalNetGex, … } = gex;
 *
 * Everything below that line — every memo, every panel, both tabs — reads those
 * values and cannot tell where they came from. That is what already lets a
 * FROZEN past session be the real page rather than a second implementation of
 * it (see Premarket.tsx's header).
 *
 * Until 2026-08-27 there were two sources feeding it: the live socket
 * (useMobileGex, SPX only) and a frozen capture (SPX only). Every other symbol
 * was routed to components/pages/premarket/TickerBoard.tsx instead — a SECOND,
 * much smaller board that carried about a third of the panels. So SPY and QQQ
 * were missing the regime strip, the level rail, the six Key Levels tiles with
 * their prior-close migration lines, the scrolling GEX profile, DEX/vanna, the
 * expected-range track, the gamma bell curve, the catalysts and the whole
 * Post-Market recap.
 *
 * This hook is the third source. It returns the SAME SHAPE off a plain REST
 * poll, so the page renders identically for any ticker with a listed chain and
 * TickerBoard is no longer mounted at all.
 *
 * ── WHY REST AND NOT THE SOCKET ─────────────────────────────────────────────
 * lib/gexSocket carries ONE symbol's frames — the server publishes SPX and
 * nothing else on /ws/gex. Putting a second symbol on it is a server change
 * (a second subscription, a second calculator, a second set of frames), not a
 * page change. /api/expirations + /api/chains are per-ticker already and are
 * the same path the home heatmap's SPY/QQQ columns and the old TickerBoard
 * used, so this is a poll: accurate, one cycle behind, and labelled as such in
 * the page head ("CHAIN POLL · 1m") rather than dressed up as live.
 *
 * ── RAW LEGS, NOT PRE-SUMMED ROWS ───────────────────────────────────────────
 * The rows built here carry callGamma/putGamma, callDelta/putDelta, OI, volume,
 * marks and IV — the same raw legs the socket's `gexRows` carry — NOT a
 * pre-summed `netGEX`. That is deliberate and it is what makes the page's
 * three-way basis switch (OI / OI+VOL / VOL) mean the same thing here as it
 * does on SPX: lib/calculations recomputes every leg from gamma × contracts ×
 * spot², and a pre-summed row would have frozen one basis in and silently
 * ignored the switch (see netGEXOf's fallback branch for why).
 *
 * Scale and sign match the server calculator and lib/calculations exactly —
 * γ × (OI + Vol) × S², calls +, puts −. No ×100, no put-side flip. The same
 * warning parseTickerBoard carries applies: do not "simplify" one side of that
 * constant away without the other.
 *
 * ── WHAT IT CANNOT PRODUCE ──────────────────────────────────────────────────
 * `esFut` and `basis` are 0 / null and always will be. There is no ES future
 * behind AAPL, and inventing one would put a price on screen that never traded
 * — the exact failure PostMarketTab's header documents at length. The page
 * hides every ES-derived line when `basis` is null, which is already how it
 * behaves whenever the live pair cannot be trusted.
 *
 * VANNA is the one greek that is carried through only if the payload actually
 * has it. The server publishes `netVanna` / `netVolVanna` per strike from
 * server-v2/computation/vex-chex.js, and the rows below reproduce that formula
 * EXACTLY — vanna × OI × spot × 100, calls +, puts − — but only when a per-side
 * `vanna` comes back on the chain. It is deliberately NOT reconstructed from
 * Black-Scholes here: the server's own bsGreeks returns zero for T = 0, so a
 * client-side rebuild would print a vanna on a 0DTE board that the SPX board
 * beside it does not, and the two tiles would be on different scales while
 * looking like the same number. Where it is absent the page prints "—", which
 * is what it does for every other underivable number.
 */

import { useEffect, useRef, useState } from "react";
import { findGEXFlip, netGEXOf, type ChainRow } from "@/lib/calculations/calculations";

/** Mirrors the fields Premarket.tsx destructures off useMobileGex. */
export type ChainGexState = {
  chain: ChainRow[];
  spot: number;
  prevClose: number;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  totalNetGex: number | null;
  expiry: string;
  isZeroDte: boolean;
  /** Always 0 — no future stands behind an arbitrary ticker. */
  esFut: number;
  /** Always null — see the header. */
  basis: null;
  connected: boolean;
  hasData: boolean;
  updatedAt: number | null;
  source: "live" | "rest" | "off";
};

const EMPTY_CHAIN: ChainRow[] = [];

/** Idle state. A stable object so the destructuring downstream never churns. */
const IDLE: ChainGexState = {
  chain: EMPTY_CHAIN, spot: 0, prevClose: 0, flip: null, callWall: null, putWall: null,
  totalNetGex: null, expiry: "", isZeroDte: false, esFut: 0, basis: null,
  connected: false, hasData: false, updatedAt: null, source: "off",
};

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

const int = (v: unknown): number => {
  const n = parseInt(String(v ?? 0), 10);
  return Number.isFinite(n) ? n : 0;
};

/** ET calendar date — a trader in London must still get New York's 0DTE. */
function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

/**
 * Mark, else bid/ask mid, else last/close. The chain payload is inconsistent
 * about which of these it carries per side, and the expected-move estimate
 * (ATM straddle × 0.85) is the one number on the page that depends on it.
 * Same ladder parseTickerBoard uses, so the two can never disagree.
 */
function markOf(o: Record<string, unknown> | undefined): number {
  if (!o) return 0;
  const m = num(o.mark) || num(o["mark-price"]);
  if (m > 0) return m;
  const b = num(o.bid) || num(o["bid-price"]);
  const a = num(o.ask) || num(o["ask-price"]);
  if (b > 0 || a > 0) return (b + a) / 2;
  return num(o.last) || num(o["last-price"]) || num(o.close);
}

/**
 * IV as a DECIMAL. The payload has been seen carrying this under three names
 * and occasionally as a percentage; ChainRow documents the field as a decimal
 * (0.20 = 20%) and the EM fallback multiplies by spot, so a 20 landing here
 * instead of 0.20 would print an expected move 100× too wide. Anything above 5
 * is therefore treated as percent.
 */
function ivOf(o: Record<string, unknown> | undefined): number {
  if (!o) return 0;
  const v = num(o["implied-volatility"]) || num(o.iv) || num(o.impliedVolatility);
  if (!(v > 0)) return 0;
  return v > 5 ? v / 100 : v;
}

/** One expiry's chain payload → the raw-leg rows lib/calculations expects. */
export function chainRowsOf(items: unknown[], expDate: string, spot: number): ChainRow[] {
  const all = items as { "expiration-date"?: string; strikes?: unknown[] }[];
  const groups = all.filter(
    (g) => String(g["expiration-date"] ?? "").slice(0, 10) === expDate.slice(0, 10),
  );
  // range=all can return neighbours; keep the target date when it is there and
  // fall back to whatever came back when the payload is not grouped by date.
  const use = groups.length ? groups : all;

  const rows: ChainRow[] = [];
  for (const g of use) {
    for (const item of g.strikes ?? []) {
      const it = item as Record<string, unknown>;
      const strike = num(it["strike-price"]);
      if (!strike) continue;
      const c = it.call as Record<string, unknown> | undefined;
      const p = it.put as Record<string, unknown> | undefined;

      const callOI = int(c?.["open-interest"] ?? c?.openInterest);
      const putOI = int(p?.["open-interest"] ?? p?.openInterest);
      const callVolume = int(c?.volume);
      const putVolume = int(p?.volume);
      // A strike with nothing on either side is not a data point — it is a
      // listing. Dropping it here keeps it out of the ATM search, the max-pain
      // scan and the bar window.
      if (!callOI && !putOI && !callVolume && !putVolume) continue;

      // VANNA EXPOSURE, verbatim from server-v2/computation/vex-chex.js
      // (computeVexChexRow): vanna × contracts × spot × 100, calls +, puts −.
      // Left undefined — not zero — when the payload carries no vanna, so the
      // page can tell "no vanna in this feed" from "vanna nets to zero".
      const cVanna = num(c?.vanna);
      const pVanna = num(p?.vanna);
      const hasVanna = cVanna !== 0 || pVanna !== 0;
      const vMult = spot * 100;

      rows.push({
        strike,
        spot,
        // abs() on gamma: a stray negative quote must never flip a side's sign.
        // callGEXOf/putGEXOf take the absolute value too, so this only makes the
        // stored leg agree with what the page computes from it.
        callGamma: Math.abs(num(c?.gamma)),
        putGamma: Math.abs(num(p?.gamma)),
        callDelta: num(c?.delta),
        putDelta: num(p?.delta),
        callOI, putOI, callVolume, putVolume,
        callMark: markOf(c),
        putMark: markOf(p),
        callIV: ivOf(c),
        putIV: ivOf(p),
        ...(hasVanna ? {
          netVanna: cVanna * callOI * vMult - pVanna * putOI * vMult,
          netVolVanna: cVanna * callVolume * vMult - pVanna * putVolume * vMult,
        } : {}),
      });
    }
  }
  rows.sort((a, b) => a.strike - b.strike);
  return rows;
}

/**
 * Walls, on the SERVER's definition — findCallWall / findPutWall in
 * server-v2/computation/gex-calculator.js, reproduced here so SPX (socket) and
 * every other symbol (this hook) can never mean different things by the word:
 *
 *   call wall = the strike ABOVE spot with the most POSITIVE net OI+Vol GEX
 *   put wall  = the strike BELOW spot with the most NEGATIVE net OI+Vol GEX
 *
 * ── WHY THIS CHANGED (2026-08-28) ───────────────────────────────────────────
 * It used to rank the two sides by RAW PER-SIDE GAMMA MAGNITUDE — most call
 * gamma, most put gamma — with no sign and no side-of-spot test. Both of those
 * are wrong in the same way, and the failure is not subtle: on a 0DTE board the
 * ATM strike carries the most call gamma AND the most put gamma, so the panel
 * printed "Call wall 770.00 / Put wall 770.00" on a strike whose NET gamma was
 * strongly POSITIVE. A put wall is a floor — it is the strike where dealers are
 * short gamma — so a put wall on positive net GEX is not a wall at all, and one
 * sitting on top of the call wall says nothing.
 *
 * Net, not per-side magnitude, is what makes the sign meaningful: netGEXOf
 * returns calls positive and puts negative on the OI+Vol leg, so "most
 * negative" IS "heaviest put gamma net of the calls written against it". The
 * side-of-spot filter is the server's too and is what stops the two walls
 * collapsing onto one strike.
 *
 * Returns null for a side with no qualifying strike — which is the honest
 * answer on a board that is one-sided, and is what the server returns too. The
 * page already renders every level as "—" when it is null.
 */
function wallsOf(rows: ChainRow[], spot: number): { callWall: number | null; putWall: number | null } {
  if (!rows.length || !(spot > 0)) return { callWall: null, putWall: null };
  let cw: { k: number; v: number } | null = null;
  let pw: { k: number; v: number } | null = null;
  for (const r of rows) {
    const net = netGEXOf(r, "net", spot);
    if (!Number.isFinite(net)) continue;
    if (r.strike > spot && net > 0 && (cw == null || net > cw.v)) cw = { k: r.strike, v: net };
    if (r.strike < spot && net < 0 && (pw == null || net < pw.v)) pw = { k: r.strike, v: net };
  }
  return { callWall: cw?.k ?? null, putWall: pw?.k ?? null };
}

/**
 * One ticker's front-expiry board on a poll, in useMobileGex's shape.
 *
 * @param symbol  the ticker. "" or `enabled === false` disables the hook
 *                completely — no fetch, no interval — which is how the page
 *                turns it off while SPX (the socket board) is on screen.
 */
export function useChainGex(
  symbol: string,
  enabled: boolean,
  refreshMs = 60_000,
): ChainGexState {
  const sym = (symbol || "").trim().toUpperCase();
  const [state, setState] = useState<ChainGexState>(IDLE);
  // Monotonic token: a slow AAPL response must not land after the user has
  // switched to TSLA and paint AAPL's board under a TSLA heading.
  const seqRef = useRef(0);

  // Switching symbol CLEARS first. Otherwise the new symbol's title sits over
  // the old symbol's walls for a whole poll cycle — and on this page that is
  // not a cosmetic glitch, it is six wrong levels presented as levels.
  useEffect(() => { setState(IDLE); }, [sym, enabled]);

  useEffect(() => {
    if (!enabled || !sym) return;
    let cancelled = false;
    const ctrl = new AbortController();

    const load = async () => {
      const seq = ++seqRef.current;
      const stale = () => cancelled || seq !== seqRef.current;
      try {
        const today = todayEt();
        const er = await fetch(`/api/expirations?ticker=${encodeURIComponent(sym)}`,
          { cache: "no-store", signal: ctrl.signal });
        if (!er.ok || stale()) return;
        const ej = await er.json();
        const dates: string[] = [...new Set(
          ((ej?.data?.items ?? []) as Record<string, unknown>[])
            .map((i) => String(i["expiration-date"] ?? "").slice(0, 10))
            .filter(Boolean),
        )].sort() as string[];
        // FRONT = the nearest listing on or after today. On a 0DTE name that is
        // today; on a name with no daily series it is the next one out, and the
        // page's badge says FRONT rather than lying with a 0DTE label.
        const front = dates.find((d) => d >= today);
        if (!front || stale()) return;

        const cr = await fetch(
          `/api/chains?ticker=${encodeURIComponent(sym)}&expiration=${encodeURIComponent(front)}&range=all`,
          { cache: "no-store", signal: ctrl.signal },
        );
        if (!cr.ok || stale()) return;
        const cj = await cr.json();
        const spot = num(cj?.data?.underlyingPrice);
        const rows = spot > 0 ? chainRowsOf(cj?.data?.items ?? [], front, spot) : [];
        if (stale()) return;
        if (!rows.length || !(spot > 0)) {
          // Keep whatever is on screen rather than blanking a good board over
          // one empty response; the page's own "waiting for the chain" states
          // cover a cold start.
          setState((prev) => (prev.hasData ? prev : { ...IDLE, source: "rest" }));
          return;
        }

        const total = rows.reduce((s, r) => s + netGEXOf(r, "net", spot), 0);
        const { callWall, putWall } = wallsOf(rows, spot);

        setState({
          chain: rows,
          spot,
          prevClose: 0,
          flip: findGEXFlip(rows, spot),
          callWall,
          putWall,
          totalNetGex: Number.isFinite(total) ? total : null,
          expiry: front,
          isZeroDte: front === today,
          esFut: 0,
          basis: null,
          connected: true,
          hasData: true,
          updatedAt: Date.now(),
          source: "rest",
        });
      } catch {
        // An abort on unmount lands here too. Either way the last good board
        // stays on screen — a poll that failed is not new information.
        if (!cancelled && !ctrl.signal.aborted) {
          setState((prev) => (prev.hasData ? { ...prev, connected: false } : prev));
        }
      }
    };

    void load();
    const id = setInterval(load, refreshMs);
    return () => { cancelled = true; ctrl.abort(); clearInterval(id); };
  }, [sym, enabled, refreshMs]);

  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
//  THE WHOLE BOARD, AND THE BOARD WITHOUT 0DTE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useMultiExpiryGex — the per-strike ladder summed across EVERY listed
 * expiration, and the same ladder with the 0DTE tranche removed.
 *
 * ── WHY THE PAGE NEEDS IT ───────────────────────────────────────────────────
 * Everything else on /premarket is the FRONT expiry. That is the right board
 * for the open and the wrong one for the week: on an expiry session the front
 * tranche is most of the gamma on screen and all of it disappears at the bell,
 * so a wall that looks like the level of the day can be gone tomorrow. The
 * ex-0DTE ladder is the standing book underneath it — the levels that are still
 * there on Monday — and the READ is the comparison between the two, which is
 * why the page mounts them side by side.
 *
 * ── WHY THE SERVER COMPUTES IT ──────────────────────────────────────────────
 * It is one upstream chain fetch PER EXPIRATION (~50 on SPX). That is a sweep,
 * not a page load, so it lives behind /proxy/gex-by-strike-multi, which caches
 * it per (symbol, session) for a minute — the same endpoint and the same cache
 * every other surface reading a whole-board ladder uses. This hook is a poll on
 * top of that cache, so N readers cost one sweep.
 *
 * ── PRE-SUMMED ROWS, AND WHY THAT IS FINE HERE ──────────────────────────────
 * The route returns `{ strike, netGEX, netVolGEX, ... }` per strike — already
 * summed across expiries, no raw legs. That would be wrong for the page's basis
 * switch (see chainRowsOf's header) but it is exactly right for a LADDER, which
 * only ever draws one number per strike: OI + Vol net, `netGEX + netVolGEX`,
 * the same leg the front-expiry ladder beside it draws.
 *
 * LIVE ONLY. The sweep reads the live chain, so there is no per-date form of
 * it — a frozen or replayed session must pass `enabled: false` rather than
 * showing today's standing book under a past date's headline.
 */
export type MultiLadder = {
  rows: { strike: number; net: number }[];
  totalNetGex: number | null;
  gexFlip: number | null;
  callWall: number | null;
  putWall: number | null;
};

export type MultiGexState = {
  all: MultiLadder | null;
  ex0dte: MultiLadder | null;
  expiryCount: number;
  updatedAt: number | null;
  state: "idle" | "loading" | "ok" | "empty" | "error";
};

const MULTI_IDLE: MultiGexState = {
  all: null, ex0dte: null, expiryCount: 0, updatedAt: null, state: "idle",
};

type RawMultiRow = { strike?: unknown; netGEX?: unknown; netVolGEX?: unknown };

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};


function ladderOf(raw: unknown): MultiLadder | null {
  const o = raw as {
    rows?: RawMultiRow[]; totalNetGex?: unknown; gexFlip?: unknown;
    callWall?: unknown; putWall?: unknown;
  } | null;
  if (!o || !Array.isArray(o.rows)) return null;
  const rows = o.rows
    .map((r) => ({
      strike: num(r.strike),
      // OI + Vol, the leg the front-expiry ladder beside this one draws.
      net: num(r.netGEX) + num(r.netVolGEX),
    }))
    .filter((r) => Number.isFinite(r.strike) && r.strike > 0 && Number.isFinite(r.net));
  return {
    rows,
    totalNetGex: numOrNull(o.totalNetGex),
    gexFlip: numOrNull(o.gexFlip),
    callWall: numOrNull(o.callWall),
    putWall: numOrNull(o.putWall),
  };
}

export function useMultiExpiryGex(
  symbol: string,
  spot: number,
  enabled: boolean,
  refreshMs = 60_000,
): MultiGexState {
  const sym = (symbol || "").trim().toUpperCase();
  const [state, setState] = useState<MultiGexState>(MULTI_IDLE);
  const seqRef = useRef(0);
  /**
   * Spot rides a REF, not the effect's deps. It ticks several times a second on
   * the socket board, and re-running the effect on each tick would restart the
   * poll (and defeat the server's per-minute cache) for a number the sweep
   * barely uses. `ready` below is what actually gates the first fetch.
   */
  const spotRef = useRef(spot);
  spotRef.current = spot;
  const ready = spot > 0;

  useEffect(() => { setState(MULTI_IDLE); }, [sym, enabled]);

  useEffect(() => {
    if (!enabled || !sym || !ready) return;
    let cancelled = false;
    const ctrl = new AbortController();

    const load = async () => {
      const seq = ++seqRef.current;
      const stale = () => cancelled || seq !== seqRef.current;
      const s = spotRef.current;
      if (!(s > 0)) return;
      try {
        // SPX is '$SPX' upstream and everything else passes straight through —
        // chainUnderlying() in the recorder maps it back. Spot is explicit so a
        // non-SPX board is not swept against the live SPX price.
        const q = sym === "SPX" ? "$SPX" : sym;
        const r = await fetch(
          `/proxy/gex-by-strike-multi?symbol=${encodeURIComponent(q)}&spot=${s.toFixed(2)}`,
          { cache: "no-store", signal: ctrl.signal },
        );
        if (stale()) return;
        const j = await r.json();
        if (stale()) return;
        if (!j?.ok) { setState((p) => ({ ...p, state: p.all ? p.state : "error" })); return; }
        const all = ladderOf(j.all);
        const ex0dte = ladderOf(j.ex0dte);
        setState({
          all,
          ex0dte,
          expiryCount: num(j.expiryCount),
          updatedAt: num(j.updatedAt) || Date.now(),
          state: ex0dte?.rows.length || all?.rows.length ? "ok" : "empty",
        });
      } catch {
        // An abort on unmount lands here too. Either way the last good board
        // stays on screen — a poll that failed is not new information.
        if (!cancelled && !ctrl.signal.aborted) {
          setState((p) => (p.all ? p : { ...MULTI_IDLE, state: "error" }));
        }
      }
    };

    setState((p) => (p.all ? p : { ...MULTI_IDLE, state: "loading" }));
    /**
     * The first fetch is DELAYED, and that is not a nicety.
     *
     * On a symbol switch this effect re-runs on the very render where `sym`
     * became AMD but `spot` is still the OLD symbol's price — useChainGex has
     * not cleared its state yet. Firing immediately kicked off a full
     * multi-expiry SWEEP for AMD against a 771.43 spot, which the next render
     * then aborted and re-issued at 469.35. Two sweeps, one of them nonsense,
     * every time the picker moved (it is visible as a cancelled request in the
     * network waterfall).
     *
     * The stale render is followed within a frame or two by the one where spot
     * is 0 — which flips `ready` and tears this effect down before the timer
     * fires — so a short delay costs nothing and spends one sweep instead of
     * two.
     */
    const first = setTimeout(() => { void load(); }, 400);
    const id = setInterval(load, refreshMs);
    return () => { cancelled = true; ctrl.abort(); clearTimeout(first); clearInterval(id); };
  }, [sym, enabled, ready, refreshMs]);

  return state;
}
