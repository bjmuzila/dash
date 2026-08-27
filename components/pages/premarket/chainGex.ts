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
      });
    }
  }
  rows.sort((a, b) => a.strike - b.strike);
  return rows;
}

/**
 * Walls, on the same definition every other surface in this app uses:
 *   call wall = the strike carrying the most POSITIVE call gamma
 *   put wall  = the strike carrying the most NEGATIVE put gamma (by magnitude)
 * Deliberately identical to parseTickerBoard's, so the number cannot depend on
 * which board you happen to be looking at.
 */
function wallsOf(rows: ChainRow[], spot: number): { callWall: number | null; putWall: number | null } {
  if (!rows.length || !(spot > 0)) return { callWall: null, putWall: null };
  let cw: { k: number; v: number } | null = null;
  let pw: { k: number; v: number } | null = null;
  for (const r of rows) {
    const call = Math.abs(r.callGamma ?? 0) * ((r.callOI ?? 0) + (r.callVolume ?? 0)) * spot * spot;
    const put = Math.abs(r.putGamma ?? 0) * ((r.putOI ?? 0) + (r.putVolume ?? 0)) * spot * spot;
    if (call > 0 && (cw == null || call > cw.v)) cw = { k: r.strike, v: call };
    if (put > 0 && (pw == null || put > pw.v)) pw = { k: r.strike, v: put };
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
