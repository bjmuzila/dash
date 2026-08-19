"use client";

/**
 * /premarket — Premarket Prep. LIVE.
 *
 * SPA-ONLY, like every other feed-consuming page in this repo. It rides
 * lib/gexSocket (useMobileGex / useEsCandles), which only exists in a browser,
 * so it lives here in components/pages/ and is mounted by the Vite SPA
 * (app-vite/src/App.tsx) — NOT as an app/premarket/page.tsx. Next prerenders
 * anything under app/, and prerendering this tree is what failed the Docker
 * build on 2026-08-19. app/premarket/page.tsx is now a force-dynamic redirect
 * to /app/premarket and nothing else.
 *
 * Answers three questions before the open: what regime am I in, where are the
 * walls, what happened overnight.
 *
 * DATA SOURCES — all shared, none duplicated:
 *   useMobileGex        the one live-GEX layer (rides lib/gexSocket, refcounted,
 *                       pinned to today's 0DTE). Gives spot, prevClose, flip,
 *                       call/put wall, totalNetGex, esFut, basis and the chain.
 *   useEsCandles        5m ES bars incl. the overnight session → ON high/low and
 *                       the prior RTH close. Same socket.
 *   useEconCalendar     /api/calendar + /proxy/earnings-week → today's catalysts.
 *   /api/quotes-batch   ES / NQ / VIX day change.
 *   /api/scanner/market-quality
 *                       SECTOR HEAT (its `sectorBars`, 5-day sector change) plus
 *                       the global market-quality score. Sector heat is NOT
 *                       recomputed here — Market Quality already owns it.
 *
 * Everything else (per-strike bars, max pain, expected move, the 0DTE magnet,
 * DEX / vanna totals, the playbook) is derived client-side from that one chain
 * through lib/calculations, so this page can never disagree with the GEX chart.
 *
 * THE ONE THING THAT NEEDS TIME TO WORK: "vs prior close" comparisons. Nothing
 * in the app persists an end-of-day GEX snapshot, so this page takes its own —
 * once per session, between 15:40 and 16:10 ET, into localStorage (EOD_KEY).
 * Until a snapshot from a PREVIOUS date exists, the net-GEX change, the strike
 * deltas and "yesterday's flip" render as "—" rather than as a made-up number.
 *
 * Styling: the approved mockup's CSS, scoped under `.pmk` (custom properties on
 * `.pmk`, not `:root`) so its generic class names cannot leak into the app.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useMobileGex } from "@/hooks/useMobileGex";
import { useEsCandles } from "@/hooks/useEsCandles";
import { useEconCalendar } from "@/hooks/useEconCalendar";
import { isStale } from "@/lib/econCalendar";
import {
  netGEXOf,
  callGEXOf,
  putGEXOf,
  netDEXOf,
  type ChainRow,
} from "@/lib/calculations/calculations";

// ─────────────────────────────────────────────────────────────────────────────
//  CSS (mockup, scoped)
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
.pmk{
  --bg:#0a0d12; --panel:#11161f; --panel2:#151b26;
  --line:#242e3b; --line2:#33404f;
  /* Card outline. Deliberately a white alpha, not a slate hex: the cards sit on
     three different backgrounds (panel, panel2, the green/red regime wash) and
     a fixed hex reads as a different weight on each. */
  --card:rgba(255,255,255,.20);
  --txt:#e6edf6; --dim:#ffffff; --dim2:#ffffff;
  --pos:#2ecc8f; --posDim:#1b7a56; --neg:#ff5c6c; --negDim:#8c2f3a;
  --amber:#f5b942; --blue:#4da3ff; --violet:#a78bfa; --r:10px;
  background:var(--bg);color:var(--txt);
  font:13px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Inter,Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;height:100%;overflow:auto;
}
.pmk *{box-sizing:border-box}
.pmk .wrap{max-width:1560px;margin:0 auto;padding:18px 20px 60px}
.pmk .mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.pmk .muted{color:var(--dim)}
.pmk .tiny{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2)}

.pmk .pagehead{display:flex;align-items:baseline;gap:14px;margin-bottom:14px;flex-wrap:wrap}
.pmk .pagehead h1{font-size:17px;margin:0;font-weight:650;letter-spacing:-.01em}
.pmk .badge-concept{font-size:10px;padding:3px 8px;border:1px solid var(--line2);border-radius:999px;color:var(--dim);letter-spacing:.06em}

.pmk .prep{
  border:1px solid var(--card);border-radius:14px;overflow:hidden;
  background:linear-gradient(180deg,rgba(46,204,143,.07),rgba(46,204,143,0) 190px), var(--panel);
  box-shadow:0 0 0 1px rgba(46,204,143,.09), 0 18px 50px -30px #000;
}
.pmk .prep.is-neg{
  background:linear-gradient(180deg,rgba(255,92,108,.08),rgba(255,92,108,0) 190px), var(--panel);
  box-shadow:0 0 0 1px rgba(255,92,108,.10), 0 18px 50px -30px #000;
}

.pmk .regime{
  display:grid;grid-template-columns:minmax(230px,auto) 1px 1fr 1px 1fr 1px 1fr auto;
  gap:0;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line);
}
.pmk .vr{background:var(--line);height:44px;width:1px;margin:0 18px}
.pmk .regbadge{display:flex;align-items:center;gap:11px}
.pmk .dot{width:9px;height:9px;border-radius:50%;background:var(--pos);box-shadow:0 0 0 4px rgba(46,204,143,.16);animation:pmkpulse 2.6s infinite}
.pmk .dot.neg{background:var(--neg);box-shadow:0 0 0 4px rgba(255,92,108,.16)}
.pmk .dot.off{background:#55606e;box-shadow:none;animation:none}
@keyframes pmkpulse{0%,100%{box-shadow:0 0 0 4px rgba(46,204,143,.16)}50%{box-shadow:0 0 0 8px rgba(46,204,143,.05)}}
.pmk .regbadge .lbl{font-size:19px;font-weight:700;letter-spacing:-.02em;color:var(--pos)}
.pmk .regbadge .lbl.neg{color:var(--neg)}
.pmk .regbadge .sub{font-size:10.5px;color:var(--dim)}
.pmk .kpi .k{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2);margin-bottom:3px}
.pmk .kpi .v{font-size:19px;font-weight:640;letter-spacing:-.02em}
.pmk .kpi .v small{font-size:11px;font-weight:500;color:var(--dim)}
.pmk .chg-pos{color:var(--pos)}
.pmk .chg-neg{color:var(--neg)}
.pmk .bias{
  justify-self:end;text-align:right;max-width:300px;padding:8px 12px;border-radius:var(--r);
  background:rgba(46,204,143,.07);border:1px solid rgba(46,204,143,.22);
}
.pmk .bias.neg{background:rgba(255,92,108,.07);border-color:rgba(255,92,108,.22)}
.pmk .bias .t{font-size:12.5px;font-weight:600;color:var(--pos)}
.pmk .bias.neg .t{color:var(--neg)}
.pmk .bias .d{font-size:11px;color:var(--dim);margin-top:2px}

.pmk .levels{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}
.pmk .lvl{position:relative;border:1px solid var(--card);border-radius:var(--r);background:var(--panel2);padding:10px 11px 11px;overflow:hidden}
.pmk .lvl .name{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim2);display:flex;justify-content:space-between;align-items:center;gap:6px}
.pmk .lvl .name em{font-style:normal;font-size:9px;padding:1px 5px;border-radius:4px;background:#0d1117;border:1px solid var(--line2);color:var(--dim);white-space:nowrap}
.pmk .lvl .px{font-size:21px;font-weight:660;letter-spacing:-.03em;margin:4px 0 1px}
.pmk .lvl .es{font-size:10.5px;color:var(--dim)}
.pmk .lvl .dist{font-size:11px;margin-top:6px;display:flex;justify-content:space-between;align-items:center;gap:6px}
.pmk .pill{font-size:10px;padding:2px 6px;border-radius:5px;border:1px solid var(--line2);color:var(--dim);white-space:nowrap}
.pmk .pill.hot{border-color:rgba(255,92,108,.4);color:var(--neg);background:rgba(255,92,108,.08)}
.pmk .pill.cool{border-color:rgba(46,204,143,.4);color:var(--pos);background:rgba(46,204,143,.08)}
.pmk .pill.warn{border-color:rgba(245,185,66,.4);color:var(--amber);background:rgba(245,185,66,.08)}

.pmk .body{display:grid;grid-template-columns:1.55fr 1fr 1fr;gap:0}
.pmk .col{padding:14px 18px;border-right:1px solid var(--line);min-width:0}
.pmk .col:last-child{border-right:0}
.pmk .colhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px}
.pmk .colhead h3{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin:0;font-weight:600}
.pmk .seg{display:inline-flex;border:1px solid var(--line2);border-radius:7px;overflow:hidden}
.pmk .seg button{background:transparent;border:0;color:var(--dim);font:inherit;font-size:10.5px;padding:3px 9px;cursor:pointer;border-right:1px solid var(--line2)}
.pmk .seg button:last-child{border-right:0}
.pmk .seg button.on{background:#1e2836;color:var(--txt)}

.pmk .chart{position:relative}
.pmk .row{display:grid;grid-template-columns:52px 1fr;align-items:center;height:19px;gap:8px}
.pmk .row .k{font-size:10.5px;text-align:right;color:var(--dim)}
.pmk .row.key .k{color:var(--txt);font-weight:600}
.pmk .track{position:relative;height:13px;background:linear-gradient(90deg,transparent calc(50% - .5px),var(--line2) calc(50% - .5px),var(--line2) calc(50% + .5px),transparent calc(50% + .5px))}
.pmk .bar{position:absolute;top:1px;bottom:1px;border-radius:2px}
.pmk .bar.p{left:50%;background:linear-gradient(90deg,var(--posDim),var(--pos))}
.pmk .bar.n{right:50%;background:linear-gradient(270deg,var(--negDim),var(--neg))}
.pmk .bar.dimmed{opacity:.45}
/* Strike labels. A tagged strike is usually the LARGEST bar in the window, so a
   tag hung off the end of the bar ran past the track and over the neighbouring
   column (call wall) or over the strike gutter (put wall). Wide bars carry the
   tag INSIDE, flush to the bar's end; only short bars hang it outside, where
   there is room by definition. `.inside` also drops the dark plate so the tag
   reads on the bar's own colour. */
.pmk .row .tag{position:absolute;top:-1px;font-size:9.5px;padding:1px 5px;border-radius:4px;white-space:nowrap;letter-spacing:.03em;background:#0d1117;max-width:calc(50% - 8px);overflow:hidden;text-overflow:ellipsis}
.pmk .row .tag.inside{background:rgba(6,10,16,.55);border-color:transparent!important;color:#fff!important}
.pmk .spotline,.pmk .flipline{position:absolute;left:60px;right:0;border-top:1px dashed;display:flex;justify-content:flex-end;pointer-events:none}
.pmk .spotline{border-color:#fff9}
.pmk .flipline{border-color:var(--amber)}
.pmk .spotline span,.pmk .flipline span{transform:translateY(-50%);font-size:9.5px;padding:1px 6px;border-radius:4px;background:#0d1117}
.pmk .spotline span{color:#fff;border:1px solid #ffffff40}
.pmk .flipline span{color:var(--amber);border:1px solid rgba(245,185,66,.45)}
.pmk .axis{display:flex;justify-content:space-between;font-size:9.5px;color:var(--dim2);margin-top:6px;padding-left:60px}

.pmk .stat{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px dashed var(--line);gap:10px}
.pmk .stat:last-child{border-bottom:0}
.pmk .stat .l{font-size:11.5px;color:var(--dim)}
.pmk .stat .r{font-size:12.5px;font-weight:600;white-space:nowrap}
.pmk .onrange{margin:12px 0 4px;position:relative;height:52px}
.pmk .onrange .bar2{position:absolute;left:0;right:0;top:22px;height:8px;border-radius:5px;background:#1a2230;overflow:hidden}
.pmk .onrange .fill{position:absolute;top:0;bottom:0;background:linear-gradient(90deg,rgba(77,163,255,.35),rgba(77,163,255,.65));border-radius:5px}
.pmk .onrange .mk{position:absolute;top:12px;width:2px;height:28px;border-radius:2px}
.pmk .onrange .cap{position:absolute;font-size:9.5px;white-space:nowrap;transform:translateX(-50%)}
.pmk .onrange .cap.top{top:0}
.pmk .onrange .cap.bot{top:40px;color:var(--dim)}

.pmk .deltas .d{display:grid;grid-template-columns:54px 1fr 66px;align-items:center;gap:8px;padding:4px 0}
.pmk .deltas .d .s{font-size:11px;color:var(--dim)}
.pmk .deltas .d .t{height:6px;background:#1a2230;border-radius:4px;position:relative;overflow:hidden}
.pmk .deltas .d .t i{position:absolute;top:0;bottom:0;border-radius:4px}
.pmk .deltas .d .v{font-size:11px;text-align:right}

.pmk .sect{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:4px}
.pmk .sect .s{display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:7px;font-size:11.5px;border:1px solid var(--card);gap:8px;min-width:0}
.pmk .sect .s > span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pmk .s b{font-weight:600;font-size:11.5px}

.pmk .play{border:1px solid var(--card);border-radius:var(--r);background:var(--panel2);padding:11px 12px;margin-top:10px}
.pmk .play .h{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2);margin-bottom:6px}
.pmk .play p{margin:0;font-size:12.5px;line-height:1.5}
.pmk .play .k{color:var(--amber);font-weight:600}
.pmk .play .g{color:var(--pos);font-weight:600}
.pmk .play .r{color:var(--neg);font-weight:600}
.pmk .scen{display:grid;gap:6px;margin-top:9px}
.pmk .scen > div{display:grid;grid-template-columns:16px 1fr;gap:8px;font-size:11.5px;color:var(--dim)}
.pmk .scen b{color:var(--txt);font-weight:600}

/* SCOPED TO .greeks ON PURPOSE. As a bare `.pmk .g` this also matched the
   <span class="g"> the one-liner uses for its green highlight, which then
   inherited the tile's panel background, border and padding — that is what put
   a black box through the middle of the sentence. */
.pmk .greeks{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
.pmk .greeks .g{border:1px solid var(--card);border-radius:8px;padding:8px 9px;background:var(--panel2)}
.pmk .greeks .g .n{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2)}
.pmk .greeks .g .v{font-size:15px;font-weight:640;margin-top:2px;letter-spacing:-.02em}
.pmk .greeks .g .m{font-size:10px;color:var(--dim)}

.pmk .footbar{display:flex;justify-content:space-between;align-items:center;padding:9px 18px;border-top:1px solid var(--line);background:#0d1117;gap:10px;flex-wrap:wrap}
.pmk .footbar .l{font-size:10.5px;color:var(--dim2)}
.pmk .chips{display:flex;gap:6px;flex-wrap:wrap}
.pmk .chip{font-size:10px;padding:3px 8px;border-radius:6px;border:1px solid var(--line2);color:var(--dim);cursor:pointer;background:transparent;font:inherit;font-size:10px}
.pmk .chip.on{background:#1e2836;color:var(--txt);border-color:#33404f}

@media (max-width:1180px){ .pmk .body{grid-template-columns:1fr} .pmk .col{border-right:0;border-bottom:1px solid var(--line)}
  .pmk .levels{grid-template-columns:repeat(3,1fr)} .pmk .regime{grid-template-columns:1fr;gap:12px} .pmk .vr{display:none} .pmk .bias{justify-self:start;text-align:left;max-width:none} }
`;

// ─────────────────────────────────────────────────────────────────────────────
//  helpers
// ─────────────────────────────────────────────────────────────────────────────

const RTH_OPEN_MIN = 9 * 60 + 30;
const RTH_CLOSE_MIN = 16 * 60;
const EOD_KEY = "cb-premarket-eod-v1";

/** ET wall clock: calendar date + minutes since midnight. */
function etWall(now = Date.now()): { date: string; minutes: number } {
  const d = new Date(now);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  const [h, m] = hm.split(":").map(Number);
  return { date, minutes: h * 60 + m };
}

const nf = (v: number, dp = 0) =>
  v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** $1.92B / $840M / $12.4K, signed. */
function fmtUsd(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : signed ? "+" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

const fmtPts = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${nf(Math.abs(v), 0)} pts`;

const fmtPx = (v: number | null | undefined, dp = 0) =>
  v == null || !Number.isFinite(v) || v <= 0 ? "—" : nf(v, dp);

const fmtPct = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dp)}%`;

/** Strike in `chain` nearest to `px`. */
function nearestStrike(strikes: number[], px: number): number | null {
  if (!strikes.length || !(px > 0)) return null;
  return strikes.reduce((b, s) => (Math.abs(s - px) < Math.abs(b - px) ? s : b), strikes[0]);
}

/** Classic max pain: the strike where total in-the-money OI value is smallest. */
function computeMaxPain(chain: ChainRow[]): number | null {
  const rows = chain.filter((r) => (r.callOI ?? 0) > 0 || (r.putOI ?? 0) > 0);
  if (rows.length < 5) return null;
  let best: number | null = null;
  let bestVal = Infinity;
  for (const cand of rows) {
    const S = cand.strike;
    let total = 0;
    for (const r of rows) {
      if (S > r.strike) total += (r.callOI ?? 0) * (S - r.strike);
      else if (S < r.strike) total += (r.putOI ?? 0) * (r.strike - S);
    }
    if (total < bestVal) { bestVal = total; best = S; }
  }
  return best;
}

type EodSnap = {
  date: string;
  netGex: number | null;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  byStrike: Record<string, number>;
};

function readEod(): EodSnap | null {
  try {
    const raw = localStorage.getItem(EOD_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as EodSnap;
    return j && typeof j.date === "string" ? j : null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  page
// ─────────────────────────────────────────────────────────────────────────────

type Quote = { symbol: string; last: number | null; change: number | null; pct: number | null };
type SectorBar = { symbol: string; name: string; chg5d: number | null };

export default function Premarket() {
  // ── live GEX (shared socket, pinned to today's 0DTE) ───────────────────────
  const gex = useMobileGex("oi-vol");
  const {
    chain, spot, flip, callWall, putWall, totalNetGex,
    esFut, basis, expiry, isZeroDte, connected, hasData, updatedAt, source,
  } = gex;

  // ── overnight session (same socket; 3 days of history is plenty) ───────────
  const { sessionCandles } = useEsCandles(true, 3, 5, false);

  // ── catalysts ──────────────────────────────────────────────────────────────
  const { events, earnByDate, now: calNow } = useEconCalendar({ withQuote: false });

  // ── quotes + market quality ────────────────────────────────────────────────
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [sectors, setSectors] = useState<SectorBar[] | null>(null);
  const [mqScore, setMqScore] = useState<{ score: number; decision: string } | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const loadQuotes = useCallback(async () => {
    try {
      const r = await fetch("/api/quotes-batch?symbols=/ES,/NQ,VIX", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      const items: any[] = j?.data?.items ?? [];
      const map: Record<string, Quote> = {};
      for (const it of items) {
        map[it.symbol] = {
          symbol: it.symbol,
          last: it.last ?? null,
          change: it.change ?? null,
          pct: it["percent-change"] ?? null,
        };
      }
      setQuotes(map);
    } catch { /* keep last good */ }
  }, []);

  const loadMq = useCallback(async () => {
    try {
      const r = await fetch("/api/scanner/market-quality", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      const d = j?.data;
      if (!d) return;
      if (Array.isArray(d.sectorBars)) setSectors(d.sectorBars as SectorBar[]);
      if (Number.isFinite(d.globalScore)) setMqScore({ score: d.globalScore, decision: String(d.decision ?? "") });
    } catch { /* keep last good */ }
  }, []);

  useEffect(() => {
    void loadQuotes(); void loadMq();
    const a = setInterval(loadQuotes, 30_000);
    const b = setInterval(loadMq, 60_000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [loadQuotes, loadMq]);

  // ── EOD baseline (this page's own 15:40–16:10 ET snapshot) ─────────────────
  const [eod, setEod] = useState<EodSnap | null>(null);
  useEffect(() => { setEod(readEod()); }, []);

  const wroteEodRef = useRef(false);
  useEffect(() => {
    if (wroteEodRef.current || !chain.length) return;
    const { date, minutes } = etWall();
    if (minutes < RTH_CLOSE_MIN - 20 || minutes >= RTH_CLOSE_MIN + 10) return;
    const existing = readEod();
    if (existing?.date === date) { wroteEodRef.current = true; return; }
    const byStrike: Record<string, number> = {};
    for (const r of chain) byStrike[String(r.strike)] = netGEXOf(r, "net", spot);
    const snap: EodSnap = {
      date, netGex: totalNetGex ?? null, flip: flip ?? null,
      callWall: callWall ?? null, putWall: putWall ?? null, byStrike,
    };
    try { localStorage.setItem(EOD_KEY, JSON.stringify(snap)); } catch { /* quota */ }
    wroteEodRef.current = true;
  }, [chain, spot, totalNetGex, flip, callWall, putWall]);

  /** Only a snapshot from a PREVIOUS session is a valid baseline. */
  const baseline = useMemo(() => {
    const today = etWall(clock).date;
    return eod && eod.date < today ? eod : null;
  }, [eod, clock]);

  // ── derived from the chain ─────────────────────────────────────────────────
  const perStrike = useMemo(() => {
    if (!chain.length || !(spot > 0)) return [];
    return chain
      .map((r) => ({ strike: r.strike, net: netGEXOf(r, "net", spot) }))
      .filter((r) => Number.isFinite(r.net))
      .sort((a, b) => a.strike - b.strike);
  }, [chain, spot]);

  /** The ~25 strikes around spot — what actually matters for the open. */
  const bars = useMemo(() => {
    if (!perStrike.length) return [];
    const idx = perStrike.reduce(
      (b, r, i) => (Math.abs(r.strike - spot) < Math.abs(perStrike[b].strike - spot) ? i : b), 0);
    const half = 12;
    const lo = Math.max(0, idx - half);
    const hi = Math.min(perStrike.length, idx + half + 1);
    return perStrike.slice(lo, hi).slice().reverse(); // high strike at the top
  }, [perStrike, spot]);

  const maxPain = useMemo(() => computeMaxPain(chain), [chain]);

  /** 0DTE magnet = the biggest absolute per-strike GEX in the window. */
  const magnet = useMemo(() => {
    if (!bars.length) return null;
    return bars.reduce((b, r) => (Math.abs(r.net) > Math.abs(b.net) ? r : b), bars[0]);
  }, [bars]);

  const wallGex = useMemo(() => {
    const at = (k: number | null | undefined) =>
      k == null ? null : perStrike.find((r) => r.strike === k)?.net ?? null;
    return { call: at(callWall), put: at(putWall) };
  }, [perStrike, callWall, putWall]);

  const totals = useMemo(() => {
    let dex = 0, vanna = 0, cg = 0, pg = 0;
    for (const r of chain) {
      dex += netDEXOf(r, "net", spot);
      vanna += (r.netVanna ?? 0) + (r.netVolVanna ?? 0);
      cg += callGEXOf(r, "net", spot);
      pg += putGEXOf(r, "net", spot);
    }
    return { dex, vanna, callGex: cg, putGex: pg };
  }, [chain, spot]);

  /** Expected move: ATM straddle × 0.85, else ATM IV × √(1 trading day). */
  const em = useMemo(() => {
    if (!chain.length || !(spot > 0)) return null;
    const atm = chain.reduce((b, r) => (Math.abs(r.strike - spot) < Math.abs(b.strike - spot) ? r : b), chain[0]);
    const cm = atm.callMark ?? ((atm.bid ?? 0) + (atm.ask ?? 0)) / 2;
    const pm = atm.putMark ?? 0;
    if (cm > 0 && pm > 0) return (cm + pm) * 0.85;
    const iv = ((atm.callIV ?? 0) + (atm.putIV ?? 0)) / 2;
    if (iv > 0) return spot * iv * Math.sqrt(1 / 252);
    return null;
  }, [chain, spot]);

  const strikeDeltas = useMemo(() => {
    if (!baseline || !perStrike.length) return [];
    return perStrike
      .map((r) => ({ strike: r.strike, delta: r.net - (baseline.byStrike[String(r.strike)] ?? 0) }))
      .filter((r) => Number.isFinite(r.delta) && r.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 4);
  }, [baseline, perStrike]);

  // ── overnight window off the ES bars ───────────────────────────────────────
  const overnight = useMemo(() => {
    if (!sessionCandles.length) return null;
    const today = etWall(clock).date;
    const minOf = (slotKey: string) => {
      const hm = slotKey.slice(11, 16);
      const [h, m] = hm.split(":").map(Number);
      return Number.isFinite(h) ? h * 60 + (m || 0) : -1;
    };
    let hi = -Infinity, lo = Infinity, pdc: number | null = null, pdcTs = -1;
    // Prior RTH session (09:30–16:00 on the last dated day before today) — the
    // range the gap is measured against.
    let pdHi = -Infinity, pdLo = Infinity, pdDate = "";
    for (const c of sessionCandles) {
      const d = c.date ?? c.slotKey.slice(0, 10);
      if (d < today && d > pdDate) pdDate = d;
    }
    for (const c of sessionCandles) {
      const d = c.date ?? c.slotKey.slice(0, 10);
      const mins = minOf(c.slotKey);
      if (mins < 0) continue;
      const isOvernight = (d === today && mins < RTH_OPEN_MIN) || (d < today && mins >= 18 * 60);
      if (isOvernight) {
        if (c.high > hi) hi = c.high;
        if (c.low < lo) lo = c.low;
      }
      if (d === pdDate && mins >= RTH_OPEN_MIN && mins < RTH_CLOSE_MIN) {
        if (c.high > pdHi) pdHi = c.high;
        if (c.low < pdLo) pdLo = c.low;
      }
      // prior RTH close
      if (d < today && mins < RTH_CLOSE_MIN && c.timestamp > pdcTs) { pdcTs = c.timestamp; pdc = c.close; }
    }
    const pd = Number.isFinite(pdHi) && Number.isFinite(pdLo) ? { hi: pdHi, lo: pdLo } : null;
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
      return pdc != null ? { hi: null, lo: null, pdc, pd } : null;
    }
    return { hi, lo, pdc, pd };
  }, [sessionCandles, clock]);

  /**
   * The gap: front ES against the prior RTH close.
   *
   * `outside` is the one that changes how you trade it — a gap that opens beyond
   * yesterday's range has no reference above/below it, so it runs or fails hard;
   * a gap inside the range is sitting in known territory and fills far more
   * often. `fillPts` is the distance back to the prior close.
   */
  const gap = useMemo(() => {
    const pdc = overnight?.pdc;
    if (pdc == null || !(esFut > 0)) return null;
    const pts = esFut - pdc;
    const pct = (pts / pdc) * 100;
    const pd = overnight?.pd ?? null;
    const outside = pd ? esFut > pd.hi || esFut < pd.lo : null;
    return { pts, pct, outside, fillPts: -pts, pd };
  }, [overnight, esFut]);

  // ── catalysts for today ────────────────────────────────────────────────────
  const todayEvents = useMemo(() => {
    const today = etWall(clock).date;
    return events
      .filter((e) => e.date === today && e.country === "USD" && (e.impact === "High" || e.impact === "Medium" || e.impact === "President"))
      .slice(0, 4);
  }, [events, clock]);

  const todayEarnings = useMemo(() => {
    const today = etWall(clock).date;
    const b = earnByDate.get(today);
    if (!b) return [];
    return [...b.pre, ...b.after]
      .sort((a, z) => (z.market_cap ?? 0) - (a.market_cap ?? 0))
      .slice(0, 2);
  }, [earnByDate, clock]);

  // ── regime / bias ──────────────────────────────────────────────────────────
  const posGamma = (totalNetGex ?? 0) >= 0;
  const distFlip = spot > 0 && flip ? spot - flip : null;
  const distCall = spot > 0 && callWall ? callWall - spot : null;
  const distPut = spot > 0 && putWall ? putWall - spot : null;
  const netGexChangePct =
    baseline?.netGex && totalNetGex != null && baseline.netGex !== 0
      ? ((totalNetGex - baseline.netGex) / Math.abs(baseline.netGex)) * 100
      : null;

  const { date: etDate, minutes: etMin } = etWall(clock);
  const toOpen = RTH_OPEN_MIN - etMin;
  const openLabel =
    toOpen > 0 ? `RTH open in ${Math.floor(toOpen / 60)}h ${String(toOpen % 60).padStart(2, "0")}m`
      : etMin < RTH_CLOSE_MIN ? "RTH open" : "after the close";

  const esQ = quotes["/ES"], nqQ = quotes["/NQ"], vixQ = quotes["VIX"];

  const onRange = overnight?.hi != null && overnight?.lo != null ? overnight.hi - overnight.lo : null;

  // % position of a price inside the overnight band, for the ON bar markers.
  const onPos = (px: number | null | undefined) => {
    if (px == null || overnight?.hi == null || overnight?.lo == null) return null;
    const span = overnight.hi - overnight.lo;
    if (!(span > 0)) return null;
    const pad = span * 0.18; // 12%..88% of the track, matching the mockup
    return Math.max(0, Math.min(100, ((px - (overnight.lo - pad)) / (span + pad * 2)) * 100));
  };

  // Expected-range track: EM band with the walls plotted inside it.
  const emLo = em != null && spot > 0 ? spot - em : null;
  const emHi = em != null && spot > 0 ? spot + em : null;
  const emPos = (px: number | null | undefined) => {
    if (px == null || emLo == null || emHi == null) return null;
    const span = emHi - emLo;
    if (!(span > 0)) return null;
    const pad = span * 0.1;
    return Math.max(0, Math.min(100, ((px - (emLo - pad)) / (span + pad * 2)) * 100));
  };

  /** Overlap between the IV band and the wall-to-wall band, as % of the IV band. */
  const conviction = useMemo(() => {
    if (emLo == null || emHi == null || callWall == null || putWall == null) return null;
    const lo = Math.max(emLo, Math.min(putWall, callWall));
    const hi = Math.min(emHi, Math.max(putWall, callWall));
    const ov = Math.max(0, hi - lo);
    return (ov / (emHi - emLo)) * 100;
  }, [emLo, emHi, callWall, putWall]);

  const maxP = Math.max(1, ...bars.filter((b) => b.net > 0).map((b) => b.net));
  const maxN = Math.max(1, ...bars.filter((b) => b.net < 0).map((b) => -b.net));
  const bigCut = Math.max(maxP, maxN) * 0.55;

  const spotStrike = nearestStrike(bars.map((b) => b.strike), spot);
  const flipStrike = flip ? nearestStrike(bars.map((b) => b.strike), flip) : null;
  const rowTop = (strike: number | null) => {
    if (strike == null) return null;
    const i = bars.findIndex((b) => b.strike === strike);
    return i < 0 ? null : i * 19 + 9.5;
  };

  const tagFor = (strike: number): { text: string; color: string } | null => {
    if (callWall != null && strike === callWall) return { text: "CALL WALL", color: "var(--neg)" };
    if (putWall != null && strike === putWall) return { text: "PUT WALL", color: "var(--pos)" };
    if (magnet && strike === magnet.strike) return { text: "0DTE MAGNET", color: "var(--violet)" };
    if (maxPain != null && strike === maxPain) return { text: "MAX PAIN", color: "var(--blue)" };
    if (flipStrike != null && strike === flipStrike) return { text: "GAMMA FLIP", color: "var(--amber)" };
    return null;
  };

  const sectorRows = useMemo(() => {
    if (!sectors?.length) return [];
    const withVal = sectors.filter((s) => Number.isFinite(s.chg5d as number)) as Required<SectorBar>[];
    const sorted = [...withVal].sort((a, z) => (z.chg5d ?? 0) - (a.chg5d ?? 0));
    return [...sorted.slice(0, 3), ...sorted.slice(-3)].filter((v, i, a) => a.indexOf(v) === i);
  }, [sectors]);

  const es = (px: number | null | undefined) =>
    px == null || basis == null ? null : px + basis;

  const feedLabel = source === "live" ? (connected ? "LIVE" : "RECONNECTING") : source === "rest" ? "REST FALLBACK" : "PAUSED";

  return (
    <div className="pmk" style={{ flex: 1, minHeight: 0 }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap">

        <div className="pagehead">
          <h1>Premarket Prep</h1>
          <span className="badge-concept">
            {isZeroDte ? "0DTE" : "FRONT"} {expiry || "—"} · {feedLabel} · {openLabel}
          </span>
        </div>

        <section className={`prep${posGamma ? "" : " is-neg"}`}>

          {/* ── 1. REGIME ─────────────────────────────────────────────────── */}
          <div className="regime">
            <div className="regbadge">
              <span className={`dot${hasData ? (posGamma ? "" : " neg") : " off"}`} />
              <div>
                <div className={`lbl${posGamma ? "" : " neg"}`}>
                  {!hasData ? "WAITING FOR FEED" : posGamma ? "POSITIVE GAMMA" : "NEGATIVE GAMMA"}
                </div>
                <div className="sub">
                  {!hasData ? "no chain frame yet"
                    : posGamma ? "Dealers long gamma · mean-reverting tape"
                      : "Dealers short gamma · moves get amplified"}
                </div>
              </div>
            </div>
            <div className="vr" />
            <div className="kpi">
              <div className="k">Net GEX</div>
              <div className="v mono">
                {fmtUsd(totalNetGex)}{" "}
                {netGexChangePct != null && (
                  <span className={netGexChangePct >= 0 ? "chg-pos" : "chg-neg"} style={{ fontSize: 11 }}>
                    {netGexChangePct >= 0 ? "▲" : "▼"} {Math.abs(netGexChangePct).toFixed(0)}%
                  </span>
                )}
                {netGexChangePct == null && <small>vs prior close —</small>}
              </div>
            </div>
            <div className="vr" />
            <div className="kpi">
              <div className="k">Gamma Flip</div>
              <div className="v mono">
                {fmtPx(flip, 0)}{" "}
                <small className={distFlip == null ? undefined : distFlip >= 0 ? "chg-pos" : "chg-neg"}>
                  {distFlip == null ? "" : `${fmtPts(distFlip)} / ${fmtPct((distFlip / spot) * 100)}`}
                </small>
              </div>
            </div>
            <div className="vr" />
            <div className="kpi">
              <div className="k">SPX / ES</div>
              <div className="v mono">
                {fmtPx(spot, 0)} <small>· ES {fmtPx(esFut, 2)}</small>
              </div>
            </div>
            <div className={`bias${posGamma ? "" : " neg"}`}>
              <div className="t">{posGamma ? "Range day — fade the walls" : "Trend day — follow the breaks"}</div>
              <div className="d">
                {distFlip == null ? "Flip unavailable — no crossing in the current chain."
                  : `${distFlip >= 0 ? "Above" : "Below"} flip by ${nf(Math.abs(distFlip), 0)} pts. ${posGamma
                    ? `Suppression regime until ${fmtPx(flip, 0)} breaks.`
                    : `Acceleration regime until ${fmtPx(flip, 0)} is reclaimed.`}`}
              </div>
            </div>
          </div>

          {/* ── 2. KEY LEVELS ─────────────────────────────────────────────── */}
          <div className="levels">
            <div className="lvl call">
              <div className="name">Call Wall <em>resistance</em></div>
              <div className="px mono">{fmtPx(callWall, 0)}</div>
              <div className="es mono">
                {es(callWall) != null ? `ES ${fmtPx(es(callWall), 0)} · ` : ""}{fmtUsd(wallGex.call, false)}
              </div>
              <div className="dist">
                <span className={`mono ${distCall != null && distCall >= 0 ? "chg-pos" : "chg-neg"}`}>{fmtPts(distCall)}</span>
                {overnight?.hi != null && callWall != null && basis != null && overnight.hi >= callWall + basis
                  ? <span className="pill hot">ON high tagged</span>
                  : <span className="pill">untested o/n</span>}
              </div>
            </div>

            <div className="lvl magnet">
              <div className="name">0DTE Magnet <em>max γ</em></div>
              <div className="px mono">{magnet ? fmtPx(magnet.strike, 0) : "—"}</div>
              <div className="es mono">
                {magnet && es(magnet.strike) != null ? `ES ${fmtPx(es(magnet.strike), 0)} · ` : ""}
                {magnet ? fmtUsd(magnet.net, false) : "—"}
              </div>
              <div className="dist">
                <span className="mono">{magnet ? fmtPts(magnet.strike - spot) : "—"}</span>
                <span className="pill">{magnet && Math.abs(magnet.strike - spot) <= 10 ? "pinning" : "magnet"}</span>
              </div>
            </div>

            <div className="lvl spot">
              <div className="name">Spot <em>live</em></div>
              <div className="px mono">{fmtPx(spot, 0)}</div>
              <div className="es mono">
                ES {fmtPx(esFut, 2)}{esQ?.pct != null ? ` · ${fmtPct(esQ.pct)}` : ""}
              </div>
              <div className="dist"><span className="mono muted">{openLabel}</span></div>
            </div>

            <div className="lvl pain">
              <div className="name">Max Pain <em>{isZeroDte ? "0DTE" : "front"}</em></div>
              <div className="px mono">{fmtPx(maxPain, 0)}</div>
              <div className="es mono">{es(maxPain) != null ? `ES ${fmtPx(es(maxPain), 0)}` : "OI-weighted"}</div>
              <div className="dist">
                <span className={`mono ${maxPain != null && maxPain - spot >= 0 ? "chg-pos" : "chg-neg"}`}>
                  {maxPain != null ? fmtPts(maxPain - spot) : "—"}
                </span>
                <span className="pill">{maxPain != null ? (maxPain > spot ? "drift ↑" : "drift ↓") : "—"}</span>
              </div>
            </div>

            <div className="lvl flip">
              <div className="name">Gamma Flip <em>regime</em></div>
              <div className="px mono">{fmtPx(flip, 0)}</div>
              <div className="es mono">{es(flip) != null ? `ES ${fmtPx(es(flip), 0)} · zero γ` : "zero γ"}</div>
              <div className="dist">
                <span className={`mono ${distFlip != null && distFlip >= 0 ? "chg-pos" : "chg-neg"}`}>{fmtPts(distFlip)}</span>
                {em != null && distFlip != null && em > 0 && (
                  <span className={`pill ${Math.abs(distFlip) / em < 0.5 ? "warn" : ""}`}>
                    {(Math.abs(distFlip) / em).toFixed(1)}× EM away
                  </span>
                )}
              </div>
            </div>

            <div className="lvl put">
              <div className="name">Put Wall <em>support</em></div>
              <div className="px mono">{fmtPx(putWall, 0)}</div>
              <div className="es mono">
                {es(putWall) != null ? `ES ${fmtPx(es(putWall), 0)} · ` : ""}{fmtUsd(wallGex.put, false)}
              </div>
              <div className="dist">
                <span className={`mono ${distPut != null && distPut >= 0 ? "chg-pos" : "chg-neg"}`}>{fmtPts(distPut)}</span>
                {overnight?.lo != null && putWall != null && basis != null && overnight.lo <= putWall + basis
                  ? <span className="pill hot">ON low tagged</span>
                  : <span className="pill cool">untested</span>}
              </div>
            </div>
          </div>

          {/* ── 3 / 4 / 5 ─────────────────────────────────────────────────── */}
          <div className="body">

            {/* GEX PROFILE */}
            <div className="col">
              <div className="colhead">
                <h3>GEX Profile by Strike</h3>
                <span className="tiny">{isZeroDte ? "0DTE" : "front"} · OI + Vol · {bars.length} strikes</span>
              </div>

              <div className="chart" style={{ position: "relative" }}>
                {bars.length === 0 && (
                  <div style={{ padding: "40px 0", textAlign: "center", color: "var(--dim)", fontSize: 12 }}>
                    Waiting for the chain…
                  </div>
                )}
                {bars.map((b) => {
                  const pos = b.net >= 0;
                  const w = (Math.abs(b.net) / (pos ? maxP : maxN)) * 50;
                  const tag = tagFor(b.strike);
                  return (
                    <div className={`row${tag ? " key" : ""}`} key={b.strike}>
                      <div className="k mono">{nf(b.strike, 0)}</div>
                      <div className="track">
                        <div
                          className={`bar ${pos ? "p" : "n"}${Math.abs(b.net) > bigCut ? "" : " dimmed"}`}
                          style={{ width: `${w}%` }}
                        />
                        {tag && (() => {
                          // A tagged strike is usually the widest bar in the
                          // window, so hanging the label off its end pushes it
                          // out of the track — over the next column on the call
                          // side, over the strike gutter on the put side. Wide
                          // bars take the label INSIDE, flush to the bar's end.
                          //
                          // Anchored with left/right only (no transform): the
                          // bar's outer edge sits (50 − w)% from the far side,
                          // so pinning the tag's matching edge there right-
                          // aligns it inside the bar and can never exceed the
                          // track, whatever w is.
                          const inside = w >= 22;
                          const style: CSSProperties = inside
                            ? pos
                              ? { right: `calc(50% - ${w}% + 4px)` }
                              : { left: `calc(50% - ${w}% + 4px)` }
                            : pos
                              ? { left: `calc(50% + ${w}% + 6px)` }
                              : { right: `calc(50% + ${w}% + 6px)` };
                          return (
                            <span
                              className={`tag${inside ? " inside" : ""}`}
                              style={{ ...style, color: tag.color, border: `1px solid ${tag.color}` }}
                            >
                              {tag.text}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
                {rowTop(spotStrike) != null && (
                  <div className="spotline" style={{ top: rowTop(spotStrike) as number }}>
                    <span>SPOT {fmtPx(spot, 0)}</span>
                  </div>
                )}
                {rowTop(flipStrike) != null && (
                  <div className="flipline" style={{ top: rowTop(flipStrike) as number }}>
                    <span>FLIP {fmtPx(flip, 0)}</span>
                  </div>
                )}
              </div>
              <div className="axis">
                <span>{fmtUsd(-maxN, false)}</span><span>0</span><span>{fmtUsd(maxP, false)}</span>
              </div>

              <div className="greeks">
                <div className="g">
                  <div className="n">DEX</div>
                  <div className={`v mono ${totals.dex >= 0 ? "chg-pos" : "chg-neg"}`}>{fmtUsd(totals.dex)}</div>
                  <div className="m">{totals.dex >= 0 ? "calls leading · tilt ↑" : "puts leading · tilt ↓"}</div>
                </div>
                <div className="g">
                  <div className="n">Vanna</div>
                  <div className={`v mono ${totals.vanna >= 0 ? "chg-pos" : "chg-neg"}`}>{fmtUsd(totals.vanna)}</div>
                  <div className="m">{totals.vanna >= 0 ? "vol down helps ↑" : "vol down helps ↓"}</div>
                </div>
                <div className="g">
                  <div className="n">Call / Put γ</div>
                  <div className="v mono">
                    <span className="chg-pos">{fmtUsd(totals.callGex, false)}</span>
                    <span style={{ color: "var(--dim2)" }}> / </span>
                    <span className="chg-neg">{fmtUsd(Math.abs(totals.putGex), false)}</span>
                  </div>
                  <div className="m">
                    {Math.abs(totals.callGex) >= Math.abs(totals.putGex) ? "call side heavier" : "put side heavier"}
                  </div>
                </div>
              </div>
            </div>

            {/* OVERNIGHT */}
            <div className="col">
              <div className="colhead"><h3>Overnight Context</h3><span className="tiny">ES · 18:00 → {String(Math.floor(etMin / 60)).padStart(2, "0")}:{String(etMin % 60).padStart(2, "0")} ET</span></div>

              <div className="onrange">
                {overnight?.lo != null && overnight?.hi != null ? (
                  <>
                    <div className="cap top" style={{ left: "12%", color: "var(--pos)" }}>ON low {fmtPx(overnight.lo, 0)}</div>
                    <div className="cap top" style={{ left: "88%", color: "var(--neg)" }}>ON high {fmtPx(overnight.hi, 0)}</div>
                    <div className="bar2"><div className="fill" style={{ left: "12%", right: "12%" }} /></div>
                    <div className="mk" style={{ left: "12%", background: "var(--pos)" }} />
                    <div className="mk" style={{ left: "88%", background: "var(--neg)" }} />
                    {onPos(esFut) != null && (
                      <>
                        <div className="mk" style={{ left: `${onPos(esFut)}%`, background: "#fff", height: 34, top: 9 }} />
                        <div className="cap bot" style={{ left: `${onPos(esFut)}%`, color: "#fff" }}>ES {fmtPx(esFut, 0)}</div>
                      </>
                    )}
                    {onPos(overnight.pdc) != null && (
                      <>
                        <div className="mk" style={{ left: `${onPos(overnight.pdc)}%`, background: "var(--dim2)" }} />
                        <div className="cap bot" style={{ left: `${onPos(overnight.pdc)}%` }}>PDC {fmtPx(overnight.pdc, 0)}</div>
                      </>
                    )}
                  </>
                ) : (
                  <div style={{ paddingTop: 18, fontSize: 11.5, color: "var(--dim)" }}>No overnight bars yet.</div>
                )}
              </div>

              <div className="stat"><span className="l">ES change</span><span className={`r mono ${(esQ?.change ?? 0) >= 0 ? "chg-pos" : "chg-neg"}`}>
                {esQ?.change != null ? `${esQ.change >= 0 ? "+" : "−"}${Math.abs(esQ.change).toFixed(2)} (${fmtPct(esQ.pct)})` : "—"}
              </span></div>
              <div className="stat"><span className="l">NQ change</span><span className={`r mono ${(nqQ?.change ?? 0) >= 0 ? "chg-pos" : "chg-neg"}`}>
                {nqQ?.change != null ? `${nqQ.change >= 0 ? "+" : "−"}${Math.abs(nqQ.change).toFixed(2)} (${fmtPct(nqQ.pct)})` : "—"}
              </span></div>
              <div className="stat"><span className="l">ON range</span><span className="r mono">
                {onRange != null ? `${nf(onRange, 0)} pts` : "—"}
              </span></div>
              <div className="stat"><span className="l">Prior RTH close (ES)</span><span className="r mono">{fmtPx(overnight?.pdc, 2)}</span></div>
              <div className="stat"><span className="l">VIX</span><span className="r mono">
                {vixQ?.last != null ? vixQ.last.toFixed(2) : "—"}{" "}
                {vixQ?.change != null && (
                  <span className={vixQ.change >= 0 ? "chg-neg" : "chg-pos"}>
                    {vixQ.change >= 0 ? "+" : "−"}{Math.abs(vixQ.change).toFixed(2)}
                  </span>
                )}
              </span></div>
              <div className="stat"><span className="l">Gap vs prior close</span><span className="r mono">
                {gap ? (
                  <>
                    <span className={gap.pts >= 0 ? "chg-pos" : "chg-neg"}>
                      {gap.pts >= 0 ? "+" : "−"}{Math.abs(gap.pts).toFixed(2)} ({fmtPct(gap.pct)})
                    </span>{" "}
                    <span className={`pill ${gap.outside ? "warn" : ""}`}>
                      {gap.outside == null ? (gap.pts >= 0 ? "gap up" : "gap down")
                        : gap.outside ? "outside PD range" : "inside PD range"}
                    </span>
                  </>
                ) : "—"}
              </span></div>
              <div className="stat"><span className="l">Gap fill target</span><span className="r mono">
                {gap && overnight?.pdc != null
                  ? <>{fmtPx(overnight.pdc, 2)} <span className="muted">({nf(Math.abs(gap.fillPts), 0)} pts {gap.fillPts >= 0 ? "up" : "down"})</span></>
                  : "—"}
              </span></div>
              <div className="stat"><span className="l">Prior day range (ES)</span><span className="r mono">
                {overnight?.pd
                  ? <>{fmtPx(overnight.pd.lo, 0)} – {fmtPx(overnight.pd.hi, 0)} <span className="muted">({nf(overnight.pd.hi - overnight.pd.lo, 0)})</span></>
                  : "—"}
              </span></div>

              <div className="colhead" style={{ margin: "16px 0 6px" }}>
                <h3>Biggest GEX Changes</h3><span className="tiny">vs prior close</span>
              </div>
              {strikeDeltas.length ? (
                <div className="deltas">
                  {strikeDeltas.map((d) => {
                    const mx = Math.max(...strikeDeltas.map((x) => Math.abs(x.delta)));
                    const w = (Math.abs(d.delta) / mx) * 50;
                    const pos = d.delta >= 0;
                    return (
                      <div className="d" key={d.strike}>
                        <span className="s mono">{nf(d.strike, 0)}</span>
                        <span className="t">
                          <i style={pos
                            ? { left: "50%", width: `${w}%`, background: "var(--pos)" }
                            : { right: "50%", width: `${w}%`, background: "var(--neg)" }} />
                        </span>
                        <span className={`v mono ${pos ? "chg-pos" : "chg-neg"}`}>{fmtUsd(d.delta)}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--dim)" }}>
                  No prior-close snapshot yet — this page captures one automatically between 15:40 and 16:10 ET.
                </div>
              )}

              <div className="colhead" style={{ margin: "16px 0 6px" }}>
                <h3>Sector Heat</h3><span className="tiny">Market Quality · 5d %</span>
              </div>
              {sectorRows.length ? (
                <div className="sect">
                  {sectorRows.map((s) => {
                    const v = s.chg5d ?? 0;
                    const a = Math.min(0.35, Math.abs(v) / 12);
                    const c = v >= 0 ? "46,204,143" : "255,92,108";
                    return (
                      <div className="s" key={s.symbol}
                        style={{ borderColor: `rgba(${c},${0.15 + a})`, background: `rgba(${c},${a * 0.25})` }}>
                        <span>{s.name} <span className="muted">{s.symbol}</span></span>
                        <b className={v >= 0 ? "chg-pos" : "chg-neg"}>{fmtPct(v)}</b>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--dim)" }}>Loading sector data…</div>
              )}
            </div>

            {/* EXPECTED RANGE + PLAYBOOK */}
            <div className="col">
              <div className="colhead"><h3>Expected Range</h3><span className="tiny">{isZeroDte ? "0DTE" : "front"}</span></div>

              <div className="onrange" style={{ height: 58 }}>
                {em != null && emLo != null && emHi != null ? (
                  <>
                    <div className="cap top" style={{ left: "8%", color: "var(--dim)" }}>{fmtPx(emLo, 0)}</div>
                    <div className="cap top" style={{ left: "50%", color: "#fff" }}>
                      EM ±{((em / spot) * 100).toFixed(2)}% / ±{nf(em, 0)} pts
                    </div>
                    <div className="cap top" style={{ left: "92%", color: "var(--dim)" }}>{fmtPx(emHi, 0)}</div>
                    <div className="bar2" style={{ top: 26 }}>
                      <div className="fill" style={{
                        left: "8%", right: "8%",
                        background: "linear-gradient(90deg,rgba(167,139,250,.25),rgba(167,139,250,.5),rgba(167,139,250,.25))",
                      }} />
                    </div>
                    {emPos(putWall) != null && (
                      <>
                        <div className="mk" style={{ left: `${emPos(putWall)}%`, background: "var(--pos)", top: 18, height: 24 }} />
                        <div className="cap bot" style={{ left: `${emPos(putWall)}%`, top: 46, color: "var(--pos)" }}>Put Wall</div>
                      </>
                    )}
                    {emPos(callWall) != null && (
                      <>
                        <div className="mk" style={{ left: `${emPos(callWall)}%`, background: "var(--neg)", top: 18, height: 24 }} />
                        <div className="cap bot" style={{ left: `${emPos(callWall)}%`, top: 46, color: "var(--neg)" }}>Call Wall</div>
                      </>
                    )}
                    {emPos(spot) != null && (
                      <div className="mk" style={{ left: `${emPos(spot)}%`, background: "#fff", top: 14, height: 32 }} />
                    )}
                  </>
                ) : (
                  <div style={{ paddingTop: 18, fontSize: 11.5, color: "var(--dim)" }}>
                    No ATM straddle yet — expected move unavailable.
                  </div>
                )}
              </div>

              <div className="stat"><span className="l">IV-implied move</span><span className="r mono">
                {em != null ? `±${nf(em, 0)} pts (${((em / spot) * 100).toFixed(2)}%)` : "—"}
              </span></div>
              <div className="stat"><span className="l">GEX-implied range</span><span className="r mono">
                {putWall != null && callWall != null
                  ? `${fmtPx(putWall, 0)} – ${fmtPx(callWall, 0)} (${nf(Math.abs(callWall - putWall), 0)})`
                  : "—"}
              </span></div>
              <div className="stat"><span className="l">Overlap / conviction</span><span className="r mono">
                {conviction == null ? "—" : (
                  <span className={conviction >= 60 ? "chg-pos" : conviction >= 35 ? "" : "chg-neg"}>
                    {conviction >= 60 ? "HIGH" : conviction >= 35 ? "MEDIUM" : "LOW"} <span className="muted">{conviction.toFixed(0)}%</span>
                  </span>
                )}
              </span></div>
              <div className="stat"><span className="l">Overnight range</span><span className="r mono">
                {overnight?.lo != null && overnight?.hi != null
                  ? `${fmtPx(overnight.lo, 0)} – ${fmtPx(overnight.hi, 0)}`
                  : "—"}
              </span></div>
              <div className="stat"><span className="l">Market quality</span><span className="r mono">
                {mqScore ? (
                  <span className={mqScore.score >= 60 ? "chg-pos" : mqScore.score >= 40 ? "" : "chg-neg"}>
                    {Math.round(mqScore.score)} / 100 <span className="muted">{mqScore.decision}</span>
                  </span>
                ) : "—"}
              </span></div>

              <div className="play">
                <div className="h">Today&apos;s one-liner</div>
                <p>
                  {hasData ? (
                    <>
                      {posGamma ? "Positive gamma" : "Negative gamma"}, flip{" "}
                      <span className="k">
                        {distFlip == null ? "n/a" : `${nf(Math.abs(distFlip), 0)} pts ${distFlip >= 0 ? "below" : "above"}`}
                      </span>, Call Wall <span className="r">{distCall == null ? "n/a" : `${nf(Math.abs(distCall), 0)} ${distCall >= 0 ? "above" : "below"}`}</span>,
                      {" "}Put Wall <span className="g">{distPut == null ? "n/a" : `${nf(Math.abs(distPut), 0)} ${distPut >= 0 ? "above" : "below"}`}</span> —{" "}
                      <b>
                        {posGamma
                          ? `fade extremes, scalp toward the ${magnet ? nf(magnet.strike, 0) : "magnet"} magnet.`
                          : "stand aside at the edges, trade continuation through the walls."}
                      </b>
                    </>
                  ) : "Waiting for the first chain frame."}
                </p>
                <div className="scen">
                  <div><span className="g">▲</span><span>
                    <b>Above {fmtPx(callWall, 0)}</b> — call wall break. Chase only with DEX confirming; gamma thins out above.
                  </span></div>
                  <div><span className="k">◆</span><span>
                    <b>{fmtPx(putWall, 0)}–{fmtPx(callWall, 0)}</b> — base case. {posGamma ? `Fade the edges, target ${magnet ? nf(magnet.strike, 0) : "the magnet"}.` : "Two-sided and fast; size down."}
                  </span></div>
                  <div><span className="r">▼</span><span>
                    <b>Below {fmtPx(flip, 0)}</b> — flip breached, regime turns negative. Stop fading; trend short toward {fmtPx(putWall, 0)}.
                  </span></div>
                </div>
              </div>

              <div className="colhead" style={{ margin: "16px 0 6px" }}><h3>Catalysts</h3><span className="tiny">today</span></div>
              {todayEvents.length === 0 && todayEarnings.length === 0 && (
                <div style={{ fontSize: 11, color: "var(--dim)" }}>Nothing scheduled on the US calendar today.</div>
              )}
              {todayEvents.map((e, i) => (
                <div className="stat" key={`${e.time}-${e.title}-${i}`} style={{ opacity: isStale(e, calNow) ? 0.5 : 1 }}>
                  <span className="l">
                    <span className={`pill ${e.impact === "High" ? "hot" : e.impact === "Medium" ? "warn" : ""}`}>
                      {e.time_formatted || e.time}
                    </span>{" "}{e.title}
                  </span>
                  <span className="r mono muted">
                    {e.actual ? `act ${e.actual}` : e.forecast ? `exp ${e.forecast}` : "—"}
                  </span>
                </div>
              ))}
              {todayEarnings.map((r) => (
                <div className="stat" key={r.symbol}>
                  <span className="l">
                    <span className="pill">{r.session === "pre" ? "PRE" : "AMC"}</span> {r.symbol} earnings
                  </span>
                  <span className="r mono muted">{r.eps_est ? `EPS ${r.eps_est}` : "—"}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="footbar">
            <span className="l mono">
              {etDate} · {feedLabel} · spot {fmtPx(spot, 2)} · ES {fmtPx(esFut, 2)}
              {basis != null ? ` · basis ${basis >= 0 ? "+" : "−"}${Math.abs(basis).toFixed(2)}` : ""}
              {" · "}{chain.length} strikes
              {updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })} ET` : ""}
            </span>
            <div className="chips">
              <span className="chip on">{isZeroDte ? "0DTE" : "FRONT"} {expiry || ""}</span>
              {baseline ? <span className="chip">baseline {baseline.date}</span> : <span className="chip">no baseline yet</span>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
