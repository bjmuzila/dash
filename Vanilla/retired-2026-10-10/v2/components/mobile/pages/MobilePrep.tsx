"use client";

/**
 * MobilePrep — Premarket Prep + Post-Market Recap, phone edition.
 *
 * Replaces the Estimated Moves tab in the bottom bar (see components/mobile/
 * mobileNav.ts). EM was one number a day and it is still on the desktop /em
 * page; this is the screen you actually open before the bell and again after
 * the close.
 *
 * NOT a restyled desktop page. components/pages/Premarket.tsx lays out three
 * columns of inline-styled cards and could never be squeezed into 390px — what
 * is shared is the DATA, not the markup:
 *
 *   useMobileGex          the one live-GEX layer, same socket, same 0DTE pin.
 *   useEsCandles          overnight high/low, prior close, prior day range,
 *                         today's open and RTH range — the gap block's inputs.
 *   /api/quotes-batch     ES / NQ / VIX, same endpoint and 30s cadence as the
 *                         desktop page's Overnight column.
 *   /api/premarket-baseline
 *                         the prior close's per-strike board for the expiry on
 *                         screen, which drives Biggest GEX Changes. Recorded at
 *                         16:05 ET by server-v2/premarket-baseline.js.
 *   postMarketData.ts     the recorded ladder, the SAVED wall grades from
 *                         server-v2/walls-recorder.js, and the next expiry's
 *                         structure — the exact hooks the desktop tab uses, so
 *                         the phone can never disagree with the laptop about
 *                         how the day went.
 *
 * Phone-specific decisions:
 *   - The desktop's horizontal level rail becomes a VERTICAL ladder. Five labels
 *     across 358px overlap; the same five as rows, sorted high to low with spot
 *     inline, read at a glance and need no legend. It also REPLACES the shared
 *     LevelsBar on this page rather than sitting under it: the two showed the
 *     same four numbers, and LevelsBar paints the walls on the CHART's blue/red
 *     pole ramp, which would have put two different wall colours on one screen.
 *   - PRE / POST is a segmented control that picks itself by the clock and then
 *     stays where you put it (sessionStorage), same rule as the desktop tab.
 *   - Every grid goes through gridCols() — see mobileTheme, the app-wide GLOBAL
 *     GRID COLLAPSE in globals.css would otherwise flatten these.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMobileGex } from "@/hooks/useMobileGex";
import { useEsCandles } from "@/hooks/useEsCandles";
import { netGEXOf, type ChainRow } from "@/lib/calculations/calculations";
import MobileShell from "../MobileShell";
import ExpiryBadge from "../ExpiryBadge";
import { MCard, MEmpty, MSegmented, MStat, MStatGrid, MStatusDot } from "../MobileUI";
import {
  M_COLOR, MONO, RADIUS, TYPE, fmtMoney, fmtPrice, gridCols, mTile, rgba,
} from "../mobileTheme";
import {
  RTH_CLOSE_MIN,
  RTH_OPEN_MIN,
  etHm,
  etMinutes,
  useIntradayLadder,
  useNextExpiryStructure,
  useRecordedWalls,
  REACTION_LABEL,
  REACTION_TONE,
  type WallLevel,
} from "@/components/pages/premarket/postMarketData";

const TAB_KEY = "cb-mprep-tab-v1";

/** ES ticks — below this there is no gap worth naming. Same as the desktop. */
const GAP_EPS = 0.25;

/** Evening (Globex) session start, ET minutes. */
const EVENING_MIN = 18 * 60;

/**
 * The OI leg of a chain row: γ × OI × S², i.e. the printed OI+Vol number minus
 * the volume leg. Copied deliberately from Premarket.tsx rather than shared,
 * because it is two calls to an already-imported function and a shared helper
 * would put a `lib/` dependency between the phone build and the desktop page
 * for no other reason.
 *
 * It is the live side of the baseline diff, and the printed OI+Vol number is
 * the WRONG one to use there: premarket the live chain has ~no volume while a
 * prior-close baseline carries yesterday's whole session, so every strike would
 * print a large negative Δ that is just the volume leg falling off. On the OI
 * basis both sides carry the same settled OI and the Δ is what actually moved.
 */
function oiLeg(row: ChainRow, spot: number): number {
  return netGEXOf(row, "net", spot) - netGEXOf(row, "vol", spot);
}

/** The /api/premarket-baseline body, as much of it as the phone reads. */
type Baseline = {
  date: string;
  expiry: string;
  byStrike: Record<string, number>;
};

type Quote = { last: number | null; change: number | null; pct: number | null };

type View = "pre" | "post";
const VIEWS: { id: View; label: string }[] = [
  { id: "pre", label: "Premarket" },
  { id: "post", label: "Post-Market" },
];

/**
 * WALL COLOURS — call wall GREEN, put wall RED, on every ticker and every
 * surface. Deliberately not M_COLOR.pos / .neg: those two mean "positive or
 * negative gamma" and belong to the bars and the heat ramp. Flipping the wall
 * convention must not re-colour a single bar, so the levels get their own pair.
 * The desktop board carries the same split as --cw / --pw.
 */
const CW_COLOR = M_COLOR.up;
const PW_COLOR = M_COLOR.down;

const TONE_COLOR: Record<"ok" | "bad" | "warn" | "vio", string> = {
  ok: M_COLOR.up, bad: M_COLOR.neg, warn: M_COLOR.orange, vio: M_COLOR.cb,
};

/** ET wall clock for "now", as { date, minutes }. */
function etNow(ts: number) {
  const date = new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return { date, minutes: etMinutes(ts) };
}

const pts = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}`;

const px0 = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) || v <= 0 ? "—" : Math.round(v).toLocaleString("en-US");

// ─────────────────────────────────────────────────────────────────────────────
//  the vertical level ladder — the phone's answer to the desktop rail
// ─────────────────────────────────────────────────────────────────────────────

function LevelLadder({
  rows,
}: {
  rows: { code: string; name: string; px: number; color: string; dist: number | null; isSpot?: boolean }[];
}) {
  if (rows.length < 2) return <MEmpty>Waiting for the chain…</MEmpty>;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map((r, i) => (
        <div
          key={r.code}
          style={{
            display: "grid",
            ...gridCols("64px 1fr auto"),
            alignItems: "center",
            gap: 10,
            padding: "7px 0",
            borderTop: i === 0 ? "none" : `1px solid ${rgba("#ffffff", 0.06)}`,
            // Spot is the row everything else is measured from, so it gets the
            // only filled background on the ladder.
            background: r.isSpot ? rgba("#ffffff", 0.05) : "transparent",
            borderRadius: r.isSpot ? RADIUS.sm : 0,
            paddingLeft: r.isSpot ? 8 : 0,
            paddingRight: r.isSpot ? 8 : 0,
          }}
        >
          <span
            style={{
              fontSize: TYPE.micro - 1, fontWeight: 800, letterSpacing: "0.08em",
              color: r.color, whiteSpace: "nowrap",
            }}
          >
            {r.code}
          </span>
          <span style={{ fontSize: TYPE.micro, color: M_COLOR.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {r.name}
          </span>
          <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ ...MONO, fontSize: TYPE.value + 1, fontWeight: 700, color: r.isSpot ? M_COLOR.text : r.color }}>
              {px0(r.px)}
            </span>
            <span style={{ ...MONO, fontSize: TYPE.micro, fontWeight: 700, width: 42, textAlign: "right",
              color: r.dist == null ? "transparent" : r.dist >= 0 ? M_COLOR.up : M_COLOR.down }}>
              {r.dist == null ? "—" : pts(r.dist)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function MobilePrep() {
  const g = useMobileGex("oi-vol");
  /**
   * 8 history days, and `historical` alongside `sessionCandles`.
   *
   * `sessionCandles` is a rolling 30 HOUR window. On a Monday premarket the
   * Friday 16:00 bar is ~64h old and is simply not in it, so the prior-session
   * scan below used to land on SUNDAY — Globex reopen, no RTH bars at all — and
   * "Prior close" and "Gap" printed "—" every Monday, and every day after a
   * holiday. `historical` is the same hook's un-clipped DB read; `daysBack` is
   * CALENDAR days, and the prior TRADING session is three of them back on a
   * Monday and four after a holiday, so 8 covers both with room.
   *
   * This is the same fix the desktop page carries — see the `candlePool` note
   * in components/pages/Premarket.tsx.
   */
  const { sessionCandles, historical: esHistory } = useEsCandles(true, 8, 5, false);

  /**
   * Not de-duplicated and not sorted, on purpose: everything the memo below
   * does with this is a min / max / latest-timestamp scan, and all three are
   * idempotent under duplicates. A Map + sort here would run over eight
   * sessions of bars on every feed tick to change nothing.
   */
  const candlePool = useMemo(
    () => (esHistory.length ? [...esHistory, ...sessionCandles] : sessionCandles),
    [esHistory, sessionCandles]);

  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const { date: etDate, minutes: etMin } = etNow(clock);
  const afterClose = etMin >= RTH_CLOSE_MIN + 5;

  // PRE before the bell, POST after the settle — until you pick, then your pick
  // holds for the session. Same rule as the desktop tab.
  const [view, setView] = useState<View>("pre");
  const pinned = useRef(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(TAB_KEY);
      if (saved === "pre" || saved === "post") { pinned.current = true; setView(saved); }
    } catch { /* private mode */ }
  }, []);
  useEffect(() => {
    if (pinned.current) return;
    setView(afterClose ? "post" : "pre");
  }, [afterClose]);
  const pick = useCallback((v: View) => {
    pinned.current = true;
    setView(v);
    try { sessionStorage.setItem(TAB_KEY, v); } catch { /* nothing to do */ }
  }, []);

  const isPost = view === "post";

  // ── derived, off the same chain the desktop uses ───────────────────────────
  const perStrike = useMemo(() => {
    if (!g.chain.length || !(g.spot > 0)) return [];
    return g.chain
      .map((r) => ({ strike: r.strike, net: netGEXOf(r, "net", g.spot) }))
      .filter((r) => Number.isFinite(r.net))
      .sort((a, b) => a.strike - b.strike);
  }, [g.chain, g.spot]);

  /** CORE (CB) — the strike carrying the most absolute gamma. */
  const cb = useMemo(() => {
    if (!perStrike.length) return null;
    return perStrike.reduce((b, r) => (Math.abs(r.net) > Math.abs(b.net) ? r : b), perStrike[0]);
  }, [perStrike]);

  /** ATM straddle × 0.85, else ATM IV × √(1 day) — the desktop's formula. */
  const em = useMemo(() => {
    if (!g.chain.length || !(g.spot > 0)) return null;
    const atm = g.chain.reduce((b, r) => (Math.abs(r.strike - g.spot) < Math.abs(b.strike - g.spot) ? r : b), g.chain[0]);
    const cm = atm.callMark ?? ((atm.bid ?? 0) + (atm.ask ?? 0)) / 2;
    const pm = atm.putMark ?? 0;
    if (cm > 0 && pm > 0) return (cm + pm) * 0.85;
    const iv = ((atm.callIV ?? 0) + (atm.putIV ?? 0)) / 2;
    return iv > 0 ? g.spot * iv * Math.sqrt(1 / 252) : null;
  }, [g.chain, g.spot]);

  const basis = g.basis;
  const toSpx = useCallback((esPx: number | null | undefined) =>
    esPx == null || basis == null ? null : esPx - basis, [basis]);

  /** Overnight window + prior session + today's RTH, off the ES bars (ES prices). */
  const session = useMemo(() => {
    if (!candlePool.length) return null;
    const minOf = (slotKey: string) => {
      const hm = slotKey.slice(11, 16).split(":").map(Number);
      return Number.isFinite(hm[0]) ? hm[0] * 60 + (hm[1] || 0) : -1;
    };

    /**
     * TWO prior dates, because over a weekend they are not the same day.
     *
     *   pdDate  the last session before today that actually TRADED RTH — Friday
     *           on a Monday. "Prior close" and "prior day range" mean this one.
     *   evDate  the last date before today with a Globex evening (>=18:00) bar —
     *           SUNDAY on a Monday. That is where tonight's tape began.
     *
     * This used to be a single "latest date before today with any bar". Inside a
     * 30-hour window the two collapse and it worked; over the weekend they do
     * not, and the one date landed on Sunday, which has no RTH bars — so `pdc`
     * stayed null and the gap rows went blank.
     */
    let pdDate = "", evDate = "";
    for (const c of candlePool) {
      const d = c.date ?? c.slotKey.slice(0, 10);
      if (!d || d >= etDate) continue;
      const mins = minOf(c.slotKey);
      if (mins < 0) continue;
      if (mins >= RTH_OPEN_MIN && mins < RTH_CLOSE_MIN && d > pdDate) pdDate = d;
      if (mins >= EVENING_MIN && d > evDate) evDate = d;
    }

    let hi = -Infinity, lo = Infinity, rthHi = -Infinity, rthLo = Infinity;
    let pdHi = -Infinity, pdLo = Infinity;
    let pdc: number | null = null, pdcTs = -1;
    let openPx: number | null = null;
    for (const c of candlePool) {
      const d = c.date ?? c.slotKey.slice(0, 10);
      const mins = minOf(c.slotKey);
      if (mins < 0) continue;
      // Pinned to evDate, not "any earlier date": with eight sessions in the
      // pool an unpinned test would fold last Thursday evening into tonight.
      if ((d === etDate && mins < RTH_OPEN_MIN) || (!!evDate && d === evDate && mins >= EVENING_MIN)) {
        if (c.high > hi) hi = c.high;
        if (c.low < lo) lo = c.low;
      }
      if (!!pdDate && d === pdDate && mins >= RTH_OPEN_MIN && mins < RTH_CLOSE_MIN) {
        if (c.high > pdHi) pdHi = c.high;
        if (c.low < pdLo) pdLo = c.low;
        // The prior session's LAST RTH bar is the 16:00 close the gap is
        // measured from — deliberately not the last overnight print.
        if (c.timestamp > pdcTs) { pdcTs = c.timestamp; pdc = c.close; }
      }
      if (d === etDate && mins >= RTH_OPEN_MIN && mins < RTH_CLOSE_MIN) {
        if (mins === RTH_OPEN_MIN) openPx = c.open;
        if (c.high > rthHi) rthHi = c.high;
        if (c.low < rthLo) rthLo = c.low;
      }
    }
    return {
      onHi: Number.isFinite(hi) ? hi : null,
      onLo: Number.isFinite(lo) ? lo : null,
      pdc,
      pdDate: pdDate || null,
      pd: Number.isFinite(pdHi) && Number.isFinite(pdLo) ? { hi: pdHi, lo: pdLo } : null,
      openPx,
      rthHi: Number.isFinite(rthHi) ? rthHi : null,
      rthLo: Number.isFinite(rthLo) ? rthLo : null,
    };
  }, [candlePool, etDate]);

  /**
   * The gap: prior 16:00 ET close → today's 09:30 ET open, always that pair.
   * Computed in ES space (every input here is an ES bar and `esFut` is ES), so
   * the basis never enters the arithmetic; only the DISPLAYED target price is
   * converted to SPX, which is a constant offset and leaves the points alone.
   *
   * Before the bell there is no open, so the front ES stands in and the row is
   * marked PROJECTED — it moves until 09:30 and is not a fact yet. From the
   * open the gap is fixed and never moves again.
   *
   * FILLED = price traded back through the prior close AFTER the open. `retrace`
   * uses the extreme in the fill direction rather than the last price, so a fill
   * that already reversed still reads as filled.
   */
  const gap = useMemo(() => {
    const pdc = session?.pdc;
    if (pdc == null || !(pdc > 0)) return null;
    const openPx = session?.openPx ?? null;
    const projected = openPx == null;
    const ref = openPx ?? (g.esFut > 0 ? g.esFut : null);
    if (ref == null) return null;

    const ptsAway = ref - pdc;
    const pct = (ptsAway / pdc) * 100;
    const flat = Math.abs(ptsAway) < GAP_EPS;
    const up = ptsAway > 0;

    const filled = projected || flat
      ? false
      : up
        ? session?.rthLo != null && session.rthLo <= pdc
        : session?.rthHi != null && session.rthHi >= pdc;

    const extreme = up ? session?.rthLo : session?.rthHi;
    const retrace = projected || flat || extreme == null
      ? null
      : Math.max(0, Math.min(100, ((ref - extreme) / (ref - pdc)) * 100));

    const last = g.esFut > 0 ? g.esFut : ref;
    const pd = session?.pd ?? null;
    return {
      pts: ptsAway, pct, projected, flat, up, filled, retrace,
      remaining: filled ? 0 : pdc - last,
      // The read that changes how you trade it: a gap opening beyond
      // yesterday's range has no reference above or below it.
      outside: pd ? ref > pd.hi || ref < pd.lo : null,
      pdc,
    };
  }, [session, g.esFut]);

  // ── ES / NQ / VIX ──────────────────────────────────────────────────────────
  //
  // The phone had no futures or vol context at all, which is most of what
  // "how did we get here" means before the bell. Same endpoint and same 30s
  // cadence as the desktop page's Overnight column, so the two never disagree.
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/quotes-batch?symbols=/ES,/NQ,VIX", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        const items: unknown[] = j?.data?.items ?? [];
        if (!alive || !Array.isArray(items)) return;
        const next: Record<string, Quote> = {};
        for (const it of items as Record<string, unknown>[]) {
          const sym = String(it?.symbol ?? "");
          if (!sym) continue;
          const n = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
          // `percent-change`, hyphenated — that is the TastyTrade field name and
          // the key the desktop page reads. `it.pct` is silently undefined.
          next[sym] = { last: n(it?.last), change: n(it?.change), pct: n(it?.["percent-change"]) };
        }
        setQuotes(next);
      } catch { /* keep the last good read */ }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // ── prior-close baseline → Biggest GEX Changes ─────────────────────────────
  //
  // Keyed on the expiry ON SCREEN; the server answers with the PRIOR session's
  // board for that same expiry, which is the only thing the live chain can
  // honestly be diffed against. `basis=oi` for the reason in oiLeg() above.
  //
  // Same endpoint the desktop reads. It is only ever non-empty because
  // server-v2/premarket-baseline.js RECORDS that board at the 16:05 close — the
  // settled-history source it was originally built on has returned nothing
  // since ThetaData came out on 2026-08-18.
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [baseState, setBaseState] = useState<"idle" | "loading" | "ok" | "empty">("idle");
  const baseGen = useRef(0);
  useEffect(() => {
    const exp = g.expiry;
    if (!exp) return;
    // Clear first: a stale board for the PREVIOUS expiry would silently diff
    // today's chain against another session's strikes — same symbol,
    // overlapping strikes, every number plausible, nothing on screen saying so.
    setBaseline(null);
    const gen = ++baseGen.current;
    setBaseState("loading");
    (async () => {
      try {
        const r = await fetch(
          `/api/premarket-baseline?expiry=${encodeURIComponent(exp)}&basis=oi`,
          { cache: "no-store" });
        if (gen !== baseGen.current) return;
        if (!r.ok) { setBaseState("empty"); return; }
        const j = await r.json();
        if (gen !== baseGen.current) return;
        // The server echoes what it answered for — belt and braces.
        if (!j?.ok || !j?.byStrike || j?.expiry !== exp) { setBaseState("empty"); return; }
        setBaseline(j as Baseline);
        setBaseState("ok");
      } catch {
        if (gen === baseGen.current) setBaseState("empty");
      }
    })();
  }, [g.expiry]);

  /** Top strike moves vs the prior close, biggest absolute Δ first. */
  const strikeDeltas = useMemo(() => {
    if (!baseline || !g.chain.length || !(g.spot > 0)) return [];
    return g.chain
      .map((r) => ({ strike: r.strike, oi: oiLeg(r, g.spot) }))
      .filter((r) => Number.isFinite(r.oi) && baseline.byStrike[String(r.strike)] != null)
      .map((r) => ({ strike: r.strike, delta: r.oi - baseline.byStrike[String(r.strike)] }))
      .filter((r) => Number.isFinite(r.delta) && r.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 5);
  }, [baseline, g.chain, g.spot]);

  const posGamma = (g.totalNetGex ?? 0) >= 0;
  const distFlip = g.spot > 0 && g.flip ? g.spot - g.flip : null;

  const ladderRows = useMemo(() => {
    const out: { code: string; name: string; px: number; color: string; dist: number | null; isSpot?: boolean }[] = [];
    const add = (code: string, name: string, v: number | null | undefined, color: string, isSpot = false) => {
      if (v != null && Number.isFinite(v) && v > 0) {
        out.push({ code, name, px: v, color, dist: isSpot || !(g.spot > 0) ? null : v - g.spot, isSpot });
      }
    };
    add("CW", "call wall", g.callWall, CW_COLOR);
    add("CORE", "max γ strike", cb?.strike, M_COLOR.cb);
    add("SPOT", g.esFut > 0 ? `ES ${fmtPrice(g.esFut, 2)}` : "live", g.spot > 0 ? g.spot : null, M_COLOR.text, true);
    add("FLIP", "gamma flip", g.flip, M_COLOR.orange);
    add("PW", "put wall", g.putWall, PW_COLOR);
    return out.sort((a, b) => b.px - a.px);
  }, [g.callWall, g.putWall, g.flip, g.spot, g.esFut, cb]);

  // ── POST-only data. The hooks are only mounted on that view, so the phone
  //    does not spend a request on the recap while you are reading the map. ──
  return (
    <MobileShell
      title={isPost ? "Post-Market Recap" : "Premarket Prep"}
      right={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {g.totalNetGex != null && (
            <span style={{ ...MONO, fontSize: TYPE.label, fontWeight: 800, color: posGamma ? M_COLOR.pos : M_COLOR.neg }}>
              {fmtMoney(g.totalNetGex)}
            </span>
          )}
          <MStatusDot live={g.source === "live" && g.connected} label={g.source === "rest" ? "DELAYED" : undefined} />
        </div>
      }
      sticky={
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <MSegmented options={VIEWS} value={view} onChange={pick} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ExpiryBadge expiry={g.expiry} isZeroDte={g.isZeroDte} dte={g.dte} />
            <span style={{ fontSize: TYPE.micro, color: M_COLOR.faint, marginLeft: "auto" }}>
              {isPost ? etDate : etMin < RTH_OPEN_MIN
                ? `open in ${Math.floor((RTH_OPEN_MIN - etMin) / 60)}h ${String((RTH_OPEN_MIN - etMin) % 60).padStart(2, "0")}m`
                : etMin < RTH_CLOSE_MIN ? "RTH open" : "after the close"}
            </span>
          </div>
        </div>
      }
    >
      {!g.hasData && <MEmpty tall>{g.connected ? "Loading the SPX chain…" : "Connecting to the live feed…"}</MEmpty>}

      {g.hasData && !isPost && (
        <PreView
          g={g}
          em={em}
          cb={cb}
          posGamma={posGamma}
          distFlip={distFlip}
          ladderRows={ladderRows}
          session={session}
          gap={gap}
          quotes={quotes}
          strikeDeltas={strikeDeltas}
          baseline={baseline}
          baseState={baseState}
          toSpx={toSpx}
        />
      )}

      {g.hasData && isPost && (
        <PostView
          g={g}
          etDate={etDate}
          cb={cb}
          session={session}
          toSpx={toSpx}
          perStrike={perStrike}
        />
      )}
    </MobileShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  PRE
// ─────────────────────────────────────────────────────────────────────────────

type Gex = ReturnType<typeof useMobileGex>;
type Session = {
  onHi: number | null; onLo: number | null;
  pdc: number | null; pdDate: string | null;
  pd: { hi: number; lo: number } | null;
  openPx: number | null;
  rthHi: number | null; rthLo: number | null;
} | null;
type Gap = {
  pts: number; pct: number; projected: boolean; flat: boolean; up: boolean;
  filled: boolean; retrace: number | null; remaining: number;
  outside: boolean | null; pdc: number;
} | null;

/** "Fri" / "Thu" for a YYYY-MM-DD, so "prior close" names the day it means. */
function shortDay(date: string | null | undefined): string {
  if (!date) return "";
  const t = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" });
}

/**
 * ES / NQ / VIX in one 3-up row.
 *
 * VIX is coloured INVERTED on purpose — a green VIX print would read as "good"
 * while meaning the exact opposite for an equity book. Up is risk-off here, and
 * it is the one instrument on this screen where that flip is correct.
 */
function QuoteStrip({ quotes }: { quotes: Record<string, Quote> }) {
  const ROWS: { sym: string; label: string; dp: number; invert?: boolean }[] = [
    { sym: "/ES", label: "ES", dp: 2 },
    { sym: "/NQ", label: "NQ", dp: 2 },
    { sym: "VIX", label: "VIX", dp: 2, invert: true },
  ];
  const any = ROWS.some((r) => quotes[r.sym]?.last != null);
  if (!any) return null;
  return (
    <div style={{ display: "grid", ...gridCols("repeat(3, minmax(0, 1fr))"), gap: 8 }}>
      {ROWS.map(({ sym, label, dp, invert }) => {
        const q = quotes[sym];
        const chg = q?.change ?? null;
        const good = chg == null ? null : invert ? chg < 0 : chg > 0;
        const c = good == null ? M_COLOR.faint : good ? M_COLOR.up : M_COLOR.down;
        return (
          <div key={sym} style={{ ...mTile, padding: "8px 9px" }}>
            <div style={{ fontSize: TYPE.micro - 1, fontWeight: 800, letterSpacing: "0.09em", color: M_COLOR.faint }}>
              {label}
            </div>
            <div style={{ ...MONO, fontSize: TYPE.value, fontWeight: 700, lineHeight: 1.15, marginTop: 2 }}>
              {q?.last == null ? "—" : fmtPrice(q.last, dp)}
            </div>
            <div style={{ ...MONO, fontSize: TYPE.micro - 1, fontWeight: 700, color: c, marginTop: 1, whiteSpace: "nowrap" }}>
              {chg == null
                ? "—"
                : `${chg >= 0 ? "+" : "−"}${Math.abs(chg).toFixed(2)}${
                    q?.pct == null ? "" : ` ${q.pct >= 0 ? "+" : "−"}${Math.abs(q.pct).toFixed(2)}%`}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A small status pill — the phone's answer to the desktop card's inline chips. */
function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        fontSize: TYPE.micro - 1, fontWeight: 800, letterSpacing: "0.05em",
        color, background: rgba(color, 0.12), border: `1px solid ${rgba(color, 0.35)}`,
        borderRadius: RADIUS.sm - 2, padding: "2px 6px", whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

/**
 * The gap block: where it opened relative to the prior close, where the fill
 * sits, and how much of it has come back.
 *
 * The bar is the point of this — "42% retraced" is a number you have to hold in
 * your head, and a bar is a glance. It is only drawn once the open is PRINTED:
 * before 09:30 the whole thing is a projection off the front ES and a progress
 * bar would imply a measurement that has not been taken yet.
 */
function GapBlock({ gap, target }: { gap: Gap; target: number | null }) {
  if (!gap) return <MEmpty>Waiting on the prior session&rsquo;s bars…</MEmpty>;
  const dirColor = gap.flat ? M_COLOR.faint : gap.up ? M_COLOR.up : M_COLOR.down;
  const showBar = !gap.projected && !gap.flat;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ ...MONO, fontSize: TYPE.lead - 3, fontWeight: 800, color: dirColor }}>
          {gap.flat ? "flat" : `${gap.up ? "+" : "−"}${Math.abs(gap.pts).toFixed(2)}`}
        </span>
        {!gap.flat && (
          <span style={{ ...MONO, fontSize: TYPE.micro, color: M_COLOR.faint }}>
            {gap.pct >= 0 ? "+" : "−"}{Math.abs(gap.pct).toFixed(2)}%
          </span>
        )}
        <span style={{ flex: 1 }} />
        {gap.filled
          ? <Pill text="✓ FILLED" color={M_COLOR.cyan} />
          : gap.projected
            ? <Pill text="PROJECTED" color={M_COLOR.faint} />
            : gap.outside == null
              ? <Pill text={gap.up ? "GAP UP" : "GAP DOWN"} color={dirColor} />
              : <Pill text={gap.outside ? "OUTSIDE PD RANGE" : "INSIDE PD RANGE"}
                      color={gap.outside ? M_COLOR.orange : M_COLOR.faint} />}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: TYPE.micro, color: M_COLOR.faint }}>Fill target</span>
        <span style={{ ...MONO, fontSize: TYPE.value, fontWeight: 700 }}>
          {gap.flat ? "—" : px0(target)}
        </span>
        {!gap.flat && !gap.filled && (
          <span style={{ ...MONO, fontSize: TYPE.micro, color: M_COLOR.faint }}>
            {Math.abs(gap.remaining).toFixed(0)} pts {gap.remaining >= 0 ? "up" : "down"}
          </span>
        )}
      </div>

      {showBar && (
        <div>
          <div style={{ height: 5, borderRadius: RADIUS.pill, background: rgba("#ffffff", 0.08), overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${Math.max(2, Math.min(100, gap.filled ? 100 : gap.retrace ?? 0))}%`,
                background: gap.filled ? M_COLOR.up : M_COLOR.blue,
                borderRadius: RADIUS.pill,
              }}
            />
          </div>
          <div style={{ fontSize: TYPE.micro - 1, color: M_COLOR.faint, marginTop: 3 }}>
            {gap.filled ? "gap closed" : `${(gap.retrace ?? 0).toFixed(0)}% of the gap retraced`}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Biggest GEX changes vs the prior close — a diverging bar list centred on the
 * strike column, so "gamma built above spot / drained below" is one look rather
 * than five signed numbers to compare.
 */
function DeltaList({
  rows, spot,
}: {
  rows: { strike: number; delta: number }[];
  spot: number;
}) {
  const mx = Math.max(...rows.map((r) => Math.abs(r.delta)));
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map((r, i) => {
        const pos = r.delta >= 0;
        const w = mx > 0 ? (Math.abs(r.delta) / mx) * 50 : 0;
        return (
          <div
            key={r.strike}
            style={{
              display: "grid", ...gridCols("58px 1fr 62px"), alignItems: "center", gap: 8,
              padding: "6px 0",
              borderTop: i === 0 ? "none" : `1px solid ${rgba("#ffffff", 0.06)}`,
            }}
          >
            <span style={{ ...MONO, fontSize: TYPE.micro + 1, fontWeight: 700,
              color: spot > 0 && r.strike >= spot ? M_COLOR.text : M_COLOR.dim }}>
              {px0(r.strike)}
            </span>
            {/* The 1px centre rule is the zero line; bars grow out from it. */}
            <span style={{ position: "relative", height: 12 }}>
              <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: rgba("#ffffff", 0.14) }} />
              <span
                style={{
                  position: "absolute", top: 2, bottom: 2, borderRadius: 2,
                  background: pos ? M_COLOR.pos : M_COLOR.neg,
                  ...(pos ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }),
                }}
              />
            </span>
            <span style={{ ...MONO, fontSize: TYPE.micro, fontWeight: 700, textAlign: "right",
              color: pos ? M_COLOR.up : M_COLOR.down }}>
              {fmtMoney(r.delta)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PreView({
  g, em, cb, posGamma, distFlip, ladderRows, session, gap, quotes,
  strikeDeltas, baseline, baseState, toSpx,
}: {
  g: Gex;
  em: number | null;
  cb: { strike: number; net: number } | null;
  posGamma: boolean;
  distFlip: number | null;
  ladderRows: { code: string; name: string; px: number; color: string; dist: number | null; isSpot?: boolean }[];
  session: Session;
  gap: Gap;
  quotes: Record<string, Quote>;
  strikeDeltas: { strike: number; delta: number }[];
  baseline: Baseline | null;
  baseState: "idle" | "loading" | "ok" | "empty";
  toSpx: (v: number | null | undefined) => number | null;
}) {
  const band = g.callWall != null && g.putWall != null ? Math.abs(g.callWall - g.putWall) : null;
  const onHi = toSpx(session?.onHi);
  const onLo = toSpx(session?.onLo);
  const pdc = toSpx(session?.pdc);
  const pdHi = toSpx(session?.pd?.hi);
  const pdLo = toSpx(session?.pd?.lo);

  return (
    <>
      <div
        style={{
          ...mTile,
          padding: "11px 12px",
          background: posGamma ? rgba(M_COLOR.up, 0.09) : rgba(M_COLOR.neg, 0.09),
          border: `1px solid ${posGamma ? rgba(M_COLOR.up, 0.28) : rgba(M_COLOR.neg, 0.28)}`,
        }}
      >
        <div style={{ fontSize: TYPE.lead - 2, fontWeight: 800, letterSpacing: "-0.01em", color: posGamma ? M_COLOR.up : M_COLOR.neg }}>
          {posGamma ? "POSITIVE GAMMA" : "NEGATIVE GAMMA"}
        </div>
        <div style={{ fontSize: TYPE.micro + 1, color: M_COLOR.dim, marginTop: 2 }}>
          {distFlip == null
            ? "No flip in the current chain."
            : `${distFlip >= 0 ? "Above" : "Below"} flip by ${Math.abs(distFlip).toFixed(0)} pts · ${posGamma ? "fade the walls" : "follow the breaks"}`}
        </div>
      </div>

      <QuoteStrip quotes={quotes} />

      <MCard title="Levels · high to low">
        <LevelLadder rows={ladderRows} />
      </MCard>

      <MCard title="Expected range" padded>
        <MStatGrid cols={3}>
          <MStat label="EM" value={em == null ? "—" : `±${em.toFixed(0)}`} sub={em && g.spot > 0 ? `±${((em / g.spot) * 100).toFixed(2)}%` : undefined} accent={M_COLOR.blue} />
          <MStat label="Wall band" value={band == null ? "—" : `${band.toFixed(0)} pts`} sub={g.putWall != null && g.callWall != null ? `${px0(g.putWall)}–${px0(g.callWall)}` : undefined} />
          <MStat label="CORE" value={px0(cb?.strike)} sub={cb && g.spot > 0 ? `${pts(cb.strike - g.spot)} pts` : undefined} accent={M_COLOR.cb} />
        </MStatGrid>
      </MCard>

      <MCard title="Overnight">
        <MStatGrid cols={2}>
          <MStat label="ON high" value={px0(onHi)} sub={onHi != null && g.spot > 0 ? `${pts(onHi - g.spot)} from spot` : undefined} accent={M_COLOR.up} />
          <MStat label="ON low" value={px0(onLo)} sub={onLo != null && g.spot > 0 ? `${pts(onLo - g.spot)} from spot` : undefined} accent={M_COLOR.down} />
          {/* The DATE is part of this number: on a Monday "prior close" is
              Friday's, and after a holiday it is neither yesterday nor the
              obvious guess. Naming the day is the difference between a figure
              you can check and one you have to trust. */}
          <MStat
            label={`Prior close${session?.pdDate ? ` · ${shortDay(session.pdDate)}` : ""}`}
            value={px0(pdc)}
            sub="SPX-equivalent"
          />
          <MStat
            label="Prior day range"
            value={pdHi != null && pdLo != null ? `${(pdHi - pdLo).toFixed(0)} pts` : "—"}
            sub={pdHi != null && pdLo != null ? `${px0(pdLo)}–${px0(pdHi)}` : undefined}
          />
        </MStatGrid>
      </MCard>

      <MCard
        title="Gap · 4pm → 9:30"
        right={
          onHi != null && onLo != null
            ? <span style={{ ...MONO, fontSize: TYPE.micro, color: M_COLOR.faint }}>
                ON range {(onHi - onLo).toFixed(0)}
              </span>
            : undefined
        }
      >
        <GapBlock gap={gap} target={pdc} />
      </MCard>

      {/* Biggest GEX changes. Fed by the board captured at the prior 16:05
          close (server-v2/premarket-baseline.js) — so a session with no
          capture has nothing to diff against and says so, rather than
          rendering an empty card that looks like "no change". */}
      <MCard
        title="Biggest GEX changes"
        right={
          <span style={{ fontSize: TYPE.micro, color: M_COLOR.faint }}>
            {baseline ? `vs ${shortDay(baseline.date) || baseline.date} close` : "vs prior close"}
          </span>
        }
      >
        {strikeDeltas.length ? (
          <DeltaList rows={strikeDeltas} spot={g.spot} />
        ) : (
          <MEmpty>
            {baseState === "loading" || baseState === "idle"
              ? "Loading the prior-close board…"
              : baseState === "empty"
                ? `No prior-close board for ${g.expiry || "this expiry"} — it is captured at 16:05 ET, so this fills in after the next close.`
                : "No strike moved against the prior close."}
          </MEmpty>
        )}
      </MCard>

      <div style={{ ...mTile, padding: "10px 12px", background: rgba(M_COLOR.blue, 0.06), border: `1px solid ${rgba(M_COLOR.blue, 0.22)}` }}>
        <div style={{ fontSize: TYPE.micro, color: M_COLOR.dim, lineHeight: 1.45 }}>
          {g.callWall != null && g.putWall != null ? (
            <>
              <b style={{ color: M_COLOR.text }}>Base case</b> {px0(g.putWall)}–{px0(g.callWall)}.{" "}
              {posGamma
                ? `Fade the edges toward ${px0(cb?.strike)}.`
                : "Two-sided and fast — size down and trade the breaks."}{" "}
              {g.flip != null && <>Below <b style={{ color: M_COLOR.orange }}>{px0(g.flip)}</b> the regime turns.</>}
            </>
          ) : (
            "Waiting for both walls before calling a base case."
          )}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST
// ─────────────────────────────────────────────────────────────────────────────

function PostView({
  g, etDate, cb, session, toSpx, perStrike,
}: {
  g: Gex;
  etDate: string;
  cb: { strike: number; net: number } | null;
  session: Session;
  toSpx: (v: number | null | undefined) => number | null;
  perStrike: { strike: number; net: number }[];
}) {
  const { cols, state: histState } = useIntradayLadder(true, g.expiry || "");
  const { next, state: nextState } = useNextExpiryStructure(true, g.expiry || "", g.spot);
  const { byLevel: recorded, state: wallState } = useRecordedWalls(etDate, "SPX");

  const rthHi = toSpx(session?.rthHi);
  const rthLo = toSpx(session?.rthLo);
  const pdc = toSpx(session?.pdc);
  const dayChg = pdc != null && g.spot > 0 ? g.spot - pdc : null;

  const openNetGex = cols.length ? cols[0].cells.reduce((s, x) => s + x.net, 0) : null;
  const netGexChg = openNetGex != null && g.totalNetGex != null ? g.totalNetGex - openNetGex : null;

  const verdict = useMemo(() => {
    if (!(g.spot > 0) || rthHi == null || rthLo == null || g.callWall == null || g.putWall == null) {
      return { t: "NOT ENOUGH OF THE DAY YET", c: M_COLOR.faint };
    }
    if (rthHi > g.callWall && rthLo < g.putWall) return { t: "BOTH WALLS GAVE", c: M_COLOR.neg };
    if (rthHi > g.callWall) return { t: "BROKE THE CALL WALL", c: M_COLOR.neg };
    if (rthLo < g.putWall) return { t: "BROKE THE PUT WALL", c: M_COLOR.neg };
    if (cb && Math.abs(g.spot - cb.strike) <= Math.max(5, g.spot * 0.0008)) return { t: "PINNED TO CORE", c: M_COLOR.cb };
    return { t: "HELD THE RANGE", c: M_COLOR.up };
  }, [g.spot, g.callWall, g.putWall, rthHi, rthLo, cb]);

  const GRADE_ROWS: { lvl: WallLevel; label: string; color: string; live: number | null }[] = [
    { lvl: "call_wall", label: "Call Wall", color: CW_COLOR, live: g.callWall },
    { lvl: "cb", label: "CORE", color: M_COLOR.cb, live: cb?.strike ?? null },
    { lvl: "put_wall", label: "Put Wall", color: PW_COLOR, live: g.putWall },
  ];

  const nextBand = next?.callWall != null && next?.putWall != null ? Math.abs(next.callWall - next.putWall) : null;
  const todayBand = g.callWall != null && g.putWall != null ? Math.abs(g.callWall - g.putWall) : null;

  return (
    <>
      <div style={{ ...mTile, padding: "11px 12px", background: rgba(verdict.c, 0.09), border: `1px solid ${rgba(verdict.c, 0.28)}` }}>
        <div style={{ fontSize: TYPE.lead - 3, fontWeight: 800, color: verdict.c }}>{verdict.t}</div>
        <div style={{ ...MONO, fontSize: TYPE.micro + 1, color: M_COLOR.dim, marginTop: 3 }}>
          {px0(g.spot)}
          {dayChg != null && (
            <span style={{ color: dayChg >= 0 ? M_COLOR.up : M_COLOR.down }}>{"  "}{pts(dayChg)} pts</span>
          )}
          {rthHi != null && rthLo != null && `  ·  H ${px0(rthHi)} / L ${px0(rthLo)}`}
        </div>
      </div>

      <MCard title="Net GEX · open → now">
        <MStatGrid cols={2}>
          <MStat label="At 09:30" value={openNetGex == null ? "—" : fmtMoney(openNetGex)} sub={histState === "ok" ? "recorded" : "not recorded"} />
          <MStat
            label="Now"
            value={g.totalNetGex == null ? "—" : fmtMoney(g.totalNetGex)}
            accent={(g.totalNetGex ?? 0) >= 0 ? M_COLOR.pos : M_COLOR.neg}
            sub={netGexChg == null ? undefined : `${fmtMoney(netGexChg)} on the day`}
          />
        </MStatGrid>
      </MCard>

      <MCard title={`Level grades${wallState === "ok" ? " · wall log" : ""}`}>
        {wallState !== "ok" ? (
          <MEmpty>
            {wallState === "loading" ? "Loading the SPX wall log…" : `Nothing recorded for ${etDate}.`}
          </MEmpty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {GRADE_ROWS.map(({ lvl, label, color, live }) => {
              const rec = recorded.get(lvl);
              const last = rec?.events.length ? rec.events[rec.events.length - 1] : null;
              const rx = last?.reaction ?? null;
              const tone = rx ? REACTION_TONE[rx] : null;
              const status = rx ? REACTION_LABEL[rx] : rec ? "UNTESTED" : "—";
              const tone_c = tone ? TONE_COLOR[tone] : M_COLOR.faint;
              return (
                <div key={lvl} style={{ ...mTile, padding: "9px 10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: TYPE.micro, fontWeight: 800, letterSpacing: "0.08em", color, textTransform: "uppercase" }}>
                      {label}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span
                      style={{
                        fontSize: TYPE.micro - 1, fontWeight: 800, letterSpacing: "0.05em",
                        color: tone_c, background: rgba(tone_c, 0.12),
                        border: `1px solid ${rgba(tone_c, 0.35)}`, borderRadius: RADIUS.sm - 2, padding: "2px 6px",
                      }}
                    >
                      {status}
                    </span>
                  </div>
                  <div style={{ ...MONO, fontSize: TYPE.value + 1, fontWeight: 700, marginTop: 3 }}>
                    {px0(rec?.last ?? live)}
                  </div>
                  <div style={{ fontSize: TYPE.micro, color: M_COLOR.faint, marginTop: 1 }}>
                    {rec
                      ? [
                          rec.open != null && rec.last != null && rec.open !== rec.last
                            ? `${px0(rec.open)} → ${px0(rec.last)}`
                            : "never moved",
                          rec.moves ? `${rec.moves} rewrites` : null,
                          rec.events.length ? `${rec.events.length} events` : "no touches",
                          last?.reclaim_min != null ? `reclaimed ${last.reclaim_min}m` : null,
                        ].filter(Boolean).join(" · ")
                      : "not in today's log"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </MCard>

      <MCard title="Tomorrow · after 0DTE rolls off">
        {nextState !== "ok" || !next ? (
          <MEmpty>{nextState === "loading" ? "Pulling the next expiry…" : "Next expiry unavailable."}</MEmpty>
        ) : (
          <>
            <MStatGrid cols={2}>
              <MStat label="Call wall" value={px0(next.callWall)} accent={CW_COLOR}
                sub={next.callWall != null && g.spot > 0 ? `${pts(next.callWall - g.spot)} from close` : undefined} />
              <MStat label="Put wall" value={px0(next.putWall)} accent={PW_COLOR}
                sub={next.putWall != null && g.spot > 0 ? `${pts(next.putWall - g.spot)} from close` : undefined} />
              <MStat label="Flip" value={px0(next.flip)} accent={M_COLOR.orange}
                sub={next.flip != null && g.spot > 0 ? `${pts(next.flip - g.spot)} from close` : undefined} />
              <MStat label="CORE" value={px0(next.cb)} accent={M_COLOR.cb}
                sub={next.netGex != null ? fmtMoney(next.netGex) : undefined} />
            </MStatGrid>
            <div style={{ fontSize: TYPE.micro, color: M_COLOR.dim, marginTop: 9, lineHeight: 1.45 }}>
              {(next.netGex ?? 0) >= 0 ? "Positive gamma into tomorrow" : "Negative gamma into tomorrow"}
              {nextBand != null && todayBand != null
                ? nextBand > todayBand
                  ? ` — ${nextBand.toFixed(0)} pts of room vs ${todayBand.toFixed(0)} today, so the fade needs the edges.`
                  : ` — tighter than today (${nextBand.toFixed(0)} vs ${todayBand.toFixed(0)} pts), the walls bind sooner.`
                : "."}
            </div>
          </>
        )}
      </MCard>

      <div style={{ fontSize: TYPE.micro - 1, color: M_COLOR.faint, textAlign: "center", paddingBottom: 4 }}>
        {cols.length
          ? `${cols.length} minutes recorded · ${etHm(cols[0].ts)}–${etHm(cols[cols.length - 1].ts)} ET`
          : "no per-minute ladder recorded today"}
        {perStrike.length ? ` · ${perStrike.length} strikes live` : ""}
      </div>
    </>
  );
}
