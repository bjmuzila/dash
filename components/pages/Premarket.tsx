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
 *   /api/premarket-baseline
 *                       PRIOR-CLOSE BASELINE — the prior trading session's
 *                       settled per-strike GEX for the SAME expiry this page is
 *                       showing. Feeds the Net GEX "vs prior close" chip and the
 *                       "Biggest GEX Changes" card.
 *
 * ── ABOUT THAT BASELINE (2026-08-21) ────────────────────────────────────────
 * It used to be local. This page wrote its own end-of-day snapshot into
 * localStorage ("cb-premarket-eod-v1"), once per session, but ONLY while it was
 * mounted between 15:40 and 16:10 ET — and nobody has the PREMARKET page open
 * at 3:40pm. The only writer was the one page that never ran in the write
 * window, so the snapshot was never written and the card showed "no prior-close
 * snapshot yet" permanently. It was a deadlock, not a warm-up. (It was also
 * per-browser, and it required a snapshot from a STRICTLY EARLIER date, so even
 * a fixed version had a two-session cold start.)
 *
 * server-v2/premarket-baseline.js now computes it from settled ThetaData
 * history for the prior session — no window to miss, no cold start, one answer
 * every device shares.
 *
 * THE BASIS MATTERS. The baseline is read on the OI basis, and the live side of
 * every comparison below is the OI leg too (`oiLeg()`), not the OI+Vol number
 * printed in the KPI. On OI+Vol, a premarket comparison drags yesterday's whole
 * session volume into the baseline against a live side that has ~none yet, so
 * every strike prints a large negative Δ that is pure artifact. On OI both
 * sides carry the same settled OI and the difference is what actually changed
 * overnight: how each strike's gamma re-priced as spot moved. The card says
 * "OI basis" out loud so the two numbers are never silently mismatched.
 * The full argument is in premarket-baseline.js's header.
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
import PostMarketTab, { POSTMARKET_CSS } from "@/components/pages/premarket/PostMarketTab";
import HistoricalRecap, { HISTORICAL_CSS } from "@/components/pages/premarket/HistoricalRecap";
import TickerBoard from "@/components/pages/premarket/TickerBoard";
import {
  GEX_HISTORY_LIMIT,
  recentSessions,
  sessionLabel,
  useGexLevelsHistory,
} from "@/components/pages/premarket/postMarketData";
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
  /* WALL COLOURS, kept separate from the +/− gamma pair on purpose.
     --pos / --neg say "positive or negative gamma" and belong to the bars.
     --cw / --pw say "call wall / put wall" and belong to the LEVELS. They were
     the same tokens until 2026-08-20, which meant flipping the wall convention
     would have re-coloured every bar on the page. Call wall reads GREEN and put
     wall RED on every ticker and every surface — change it here, once. */
  --cw:#2ecc8f; --pw:#ff5c6c;
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

/* SESSION PICKER — the same shell as .tabs so the head reads as one control
   strip: 1px var(--line2) border, 9px radius, 11.5px type. A native select is
   used (it is a one-of-many choice and the OS list is the right affordance on
   a phone) but its chrome is stripped and the caret is redrawn from theme
   tokens, because the platform caret is the one part that cannot be themed.
   The caret is on the WRAPPER, so it stays put whatever the label's width. */
.pmk .dsel{position:relative;display:inline-flex;align-items:center;align-self:center}
.pmk .dsel::after{content:"";position:absolute;right:11px;top:50%;width:5px;height:5px;
  border-right:1.5px solid var(--dim);border-bottom:1.5px solid var(--dim);
  transform:translateY(-70%) rotate(45deg);pointer-events:none}
.pmk .dsel select{appearance:none;-webkit-appearance:none;-moz-appearance:none;
  background:transparent;color:var(--txt);border:1px solid var(--line2);border-radius:9px;
  font:inherit;font-size:11.5px;letter-spacing:.04em;padding:5px 27px 5px 12px;cursor:pointer;
  font-variant-numeric:tabular-nums}
.pmk .dsel select:hover{background:#1e2836}
.pmk .dsel select:focus{outline:none;border-color:var(--dim2)}
/* The popup list is drawn by the OS and inherits nothing — these two are the
   only properties it honours, and without them a dark page opens a white menu. */
.pmk .dsel option{background:var(--panel2);color:var(--txt)}
.pmk .dsel.past select{border-color:rgba(245,185,66,.45);color:var(--amber)}
.pmk .dsel.past::after{border-color:var(--amber)}

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

/* ── GEX LEVEL RAIL ──────────────────────────────────────────────────────────
   ONE price axis carrying every level the page cares about — put wall, gamma
   flip, CORE, spot, call wall — so their ORDER and SPACING is readable
   before any of the six cards below are read. It replaces nothing; it is the
   index to the cards.
   Two levels can print a handful of points apart, so the captions alternate
   above / below the rail in PRICE order (not by code) instead of overprinting.
   Captions are absolutely positioned with translateX(-50%) and clamped to
   4%..96%, and the outer domain carries 14% padding, so a cap can never run off
   the card. */
.pmk .gexrail{padding:15px 18px 12px;border-bottom:1px solid var(--line)}
.pmk .gexrail .rh{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.pmk .gexrail .rh h3{margin:0;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);font-weight:600}
.pmk .rail{position:relative;height:120px;margin-top:2px}
.pmk .rail .track2{position:absolute;left:0;right:0;top:54px;height:10px;border-radius:6px;background:#1a2230;border:1px solid var(--line)}
.pmk .rail .band{position:absolute;top:-1px;bottom:-1px;border-radius:6px;background:linear-gradient(90deg,rgba(255,92,108,.28),rgba(77,163,255,.14),rgba(46,204,143,.28))}
.pmk .rail .mk2{position:absolute;top:44px;width:2px;height:30px;border-radius:2px;transform:translateX(-50%)}
.pmk .rail .mk2.spot{width:3px;height:34px;top:42px;box-shadow:0 0 0 3px rgba(255,255,255,.10)}
.pmk .rail .cap2{position:absolute;transform:translateX(-50%);text-align:center;white-space:nowrap;line-height:1.25}
.pmk .rail .cap2.up{top:4px}
.pmk .rail .cap2.dn{top:78px}
.pmk .rail .cap2 .n2{font-size:9px;letter-spacing:.07em;text-transform:uppercase}
.pmk .rail .cap2 .v2{font-size:14px;font-weight:660;letter-spacing:-.02em;color:var(--txt)}
.pmk .rail .cap2 .d2{font-size:9.5px;color:var(--dim)}
.pmk .rail-empty{height:120px;display:grid;place-items:center;font-size:12px;color:var(--dim)}

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

/* SCROLLING PROFILE.
   The ladder renders ±60 strikes but only ~22 rows are ever in view, so the
   panel is the scroll container. Two consequences worth knowing:
   - .spotline / .flipline are absolutely positioned INSIDE this box, so they
     scroll with their rows, which is what makes them mean anything.
   - overscroll-behavior:contain stops a flick at the end of the ladder from
     scrolling the whole page behind it. */
.pmk .chart{position:relative;max-height:440px;overflow-y:auto;overscroll-behavior:contain;
  scrollbar-width:thin;scrollbar-color:#33404f transparent;padding-right:2px}
.pmk .chart::-webkit-scrollbar{width:8px}
.pmk .chart::-webkit-scrollbar-thumb{background:#2b3745;border-radius:4px}
.pmk .chart::-webkit-scrollbar-thumb:hover{background:#3b4a5c}
.pmk .chart::-webkit-scrollbar-track{background:transparent}
.pmk .recenter{position:absolute;right:10px;bottom:8px;z-index:3;font:inherit;font-size:10px;
  letter-spacing:.06em;text-transform:uppercase;color:var(--dim);cursor:pointer;
  background:rgba(13,17,23,.92);border:1px solid var(--line2);border-radius:6px;padding:3px 8px}
.pmk .recenter:hover{color:var(--txt);border-color:#4a5b70}
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
   there is room by definition. The .inside variant also drops the dark plate
   so the tag reads on the bar's own colour.

   NOTE: no backticks anywhere in this string — it is a template literal, and a
   stray backtick in a CSS comment ends it and turns the rest into a tagged
   template call. That shipped once and blew up the page at runtime. */
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

/* Gap fill. The bar is the only place a PARTIAL fill is visible — the two rows
   above can only say filled or not. */
.pmk .stat.gap-filled .l{color:var(--pos)}
.pmk .gapbar{display:flex;align-items:center;gap:8px;padding:6px 0 2px}
.pmk .gapbar .t{flex:1;height:5px;border-radius:3px;background:#1a2230;overflow:hidden}
.pmk .gapbar .t .f{height:100%;border-radius:3px;transition:width .3s}
.pmk .gapbar .lbl{font-size:10px;color:var(--dim2);white-space:nowrap}

.pmk .deltas .d{display:grid;grid-template-columns:54px 1fr 66px;align-items:center;gap:8px;padding:4px 0}
.pmk .deltas .d .s{font-size:11px;color:var(--dim)}
.pmk .deltas .d .t{height:6px;background:#1a2230;border-radius:4px;position:relative;overflow:hidden}
.pmk .deltas .d .t i{position:absolute;top:0;bottom:0;border-radius:4px}
.pmk .deltas .d .v{font-size:11px;text-align:right}

.pmk .sect{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:4px}
.pmk .sect .s{display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:7px;font-size:11.5px;border:1px solid var(--card);gap:8px;min-width:0}
.pmk .sect .s > span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pmk .sect .s b{font-weight:600;font-size:11.5px}

.pmk .play{border:1px solid var(--card);border-radius:var(--r);background:var(--panel2);padding:11px 12px;margin-top:10px}
.pmk .play .h{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2);margin-bottom:6px}
.pmk .play p{margin:0;font-size:12.5px;line-height:1.5}
.pmk .play .k{color:var(--amber);font-weight:600}
.pmk .play .g{color:var(--pos);font-weight:600}
.pmk .play .r{color:var(--neg);font-weight:600}
.pmk .scen{display:grid;gap:6px;margin-top:9px}
.pmk .scen > div{display:grid;grid-template-columns:16px 1fr;gap:8px;font-size:11.5px;color:var(--dim)}
.pmk .scen b{color:var(--txt);font-weight:600}

/* SCOPED TO .greeks ON PURPOSE. As a bare .pmk .g this also matched the
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
  .pmk .levels{grid-template-columns:repeat(3,1fr)} .pmk .regime{grid-template-columns:1fr;gap:12px} .pmk .vr{display:none} .pmk .bias{justify-self:start;text-align:left;max-width:none}
  /* Five caps on a narrow rail: keep the code, drop the long name. */
  .pmk .rail .cap2 .ln{display:none} }
`;

// ─────────────────────────────────────────────────────────────────────────────
//  helpers
// ─────────────────────────────────────────────────────────────────────────────

const RTH_OPEN_MIN = 9 * 60 + 30;
const RTH_CLOSE_MIN = 16 * 60;
/**
 * Dead key. The page used to write its own EOD snapshot here; the baseline is a
 * server read now (see the header). Kept only to evict the stale copy from
 * browsers that ran the old build — remove once a few weeks have passed.
 */
const LEGACY_EOD_KEY = "cb-premarket-eod-v1";
/** Which tab the user last chose, for this browser session only. */
const TAB_KEY = "cb-premarket-tab-v1";
/** Which SYMBOL the user last chose, same session-only scope. */
const SYM_KEY = "cb-premarket-sym-v1";
/**
 * Which SESSION the user last chose. Session-only like the other two, and
 * deliberately NOT localStorage: a date is a look-up, not a setting, and a page
 * that reopens tomorrow still stuck on last Tuesday reads as broken data rather
 * than as a remembered choice. A stored date that is no longer in the picker's
 * window (it aged out, or the tab was left open across a session boundary) is
 * dropped on read and the page falls back to today.
 */
const DATE_KEY = "cb-premarket-date-v1";
/**
 * How many sessions back the picker offers. It is the settled-history request's
 * row limit, defined once in postMarketData so the picker and the recap issue
 * the SAME URL and dedupeFetch collapses them into one request.
 */
const SESSION_COUNT = GEX_HISTORY_LIMIT;

/**
 * SPX is the live board — it owns the socket, the ES basis, the overnight
 * window and the per-minute recorded ladder. SPY and QQQ ride /api/chains on a
 * poll and render through TickerBoard, which carries only the panels that path
 * can honestly fill. Adding a symbol here is one line plus whatever the chain
 * supports; it is NOT a way to give a new symbol the SPX panels.
 */
const SYMBOLS = ["SPX", "SPY", "QQQ"] as const;
type Symbol_ = (typeof SYMBOLS)[number];

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

/**
 * /api/premarket-baseline's payload. `date` is the session the snapshot
 * DESCRIBES (the prior close), not the day it was computed. `netGex` and the
 * `byStrike` values are on the requested basis — `oi` here.
 */
type Baseline = {
  date: string;
  expiry: string;
  basis: string;
  spot: number | null;
  netGex: number | null;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  strikes: number;
  byStrike: Record<string, number>;
};

/**
 * The OI leg of a chain row: γ × OI × S², i.e. the OI+Vol number the app prints
 * minus the volume leg. This is the live side of every baseline comparison —
 * see the header for why the printed OI+Vol number is the wrong one to diff.
 */
function oiLeg(row: ChainRow, spot: number): number {
  return netGEXOf(row, "net", spot) - netGEXOf(row, "vol", spot);
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

  // ── prior-close baseline (server) ──────────────────────────────────────────
  //
  // Keyed on the expiry the page is showing: the server returns the PRIOR
  // SESSION's settled snapshot OF THAT EXPIRY, which is the only thing the live
  // chain can honestly be diffed against. Nothing is written from the browser
  // any more — see the header.
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [baselineState, setBaselineState] = useState<"idle" | "loading" | "ok" | "empty">("idle");

  // One-time eviction of the snapshot the old build left behind.
  useEffect(() => {
    try { localStorage.removeItem(LEGACY_EOD_KEY); } catch { /* private mode */ }
  }, []);

  /**
   * Generation guard. `expiry` changes at least twice on a cold mount —
   * useMobileGex takes the SHARED socket's current expiry first and only pins
   * today's 0DTE on a later commit — so two fetches are always in flight, and
   * the second one is usually the WARM one (already in the baseline table)
   * while the first needs a full settled-chain sweep. Without this the slow,
   * wrong-expiry response lands last and wins, and the card silently diffs
   * today's chain against another expiry's board — same symbol, overlapping
   * strikes, every number plausible, nothing on screen naming the expiry.
   */
  const baselineGen = useRef(0);

  const loadBaseline = useCallback(async (exp: string) => {
    const gen = ++baselineGen.current;
    setBaselineState("loading");
    try {
      const r = await fetch(`/api/premarket-baseline?expiry=${encodeURIComponent(exp)}&basis=oi`,
        { cache: "no-store" });
      if (gen !== baselineGen.current) return;
      if (!r.ok) { setBaseline(null); setBaselineState("empty"); return; }
      const j = await r.json();
      if (gen !== baselineGen.current) return;
      // Belt and braces: the server echoes what it answered for.
      if (!j?.ok || !j?.byStrike || j?.expiry !== exp) {
        setBaseline(null); setBaselineState("empty"); return;
      }
      setBaseline(j as Baseline);
      setBaselineState("ok");
    } catch {
      if (gen !== baselineGen.current) return;
      setBaseline(null);
      setBaselineState("empty");
    }
  }, []);

  useEffect(() => {
    if (!expiry) return;
    // Clear first: a stale baseline for the PREVIOUS expiry would silently
    // diff today's chain against the wrong session's board.
    setBaseline(null);
    void loadBaseline(expiry);
  }, [expiry, loadBaseline]);

  // ── derived from the chain ─────────────────────────────────────────────────
  const perStrike = useMemo(() => {
    if (!chain.length || !(spot > 0)) return [];
    return chain
      .map((r) => ({ strike: r.strike, net: netGEXOf(r, "net", spot) }))
      .filter((r) => Number.isFinite(r.net))
      .sort((a, b) => a.strike - b.strike);
  }, [chain, spot]);

  /**
   * TWO windows around spot, deliberately different sizes.
   *
   * `nearBars` (±12) is the ~25 strikes that decide the open. It is what the bar
   * WIDTHS are scaled against and where the 0DTE magnet is looked for — both of
   * those must keep meaning what they meant when the chart showed 25 rows, or a
   * single monster strike 200 points out would flatten every bar near the money
   * and steal the magnet tag.
   *
   * `bars` (±60) is what actually RENDERS. The panel scrolls, so the extra rows
   * cost nothing until you go looking for them, and the walls almost always sit
   * outside ±12 — which is exactly when you want to scroll to one.
   */
  const NEAR_HALF = 12;
  const VIEW_HALF = 60;

  const spotIdx = useMemo(() => {
    if (!perStrike.length) return -1;
    return perStrike.reduce(
      (b, r, i) => (Math.abs(r.strike - spot) < Math.abs(perStrike[b].strike - spot) ? i : b), 0);
  }, [perStrike, spot]);

  const windowAt = useCallback((half: number) => {
    if (spotIdx < 0) return [];
    const lo = Math.max(0, spotIdx - half);
    const hi = Math.min(perStrike.length, spotIdx + half + 1);
    return perStrike.slice(lo, hi).slice().reverse();   // high strike at the top
  }, [perStrike, spotIdx]);

  const nearBars = useMemo(() => windowAt(NEAR_HALF), [windowAt]);
  const bars = useMemo(() => windowAt(VIEW_HALF), [windowAt]);

  const maxPain = useMemo(() => computeMaxPain(chain), [chain]);

  /** 0DTE magnet = the biggest absolute per-strike GEX in the NEAR window. */
  const magnet = useMemo(() => {
    if (!nearBars.length) return null;
    return nearBars.reduce((b, r) => (Math.abs(r.net) > Math.abs(b.net) ? r : b), nearBars[0]);
  }, [nearBars]);

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

  /** Live per-strike OI leg — the side of the baseline comparison, not the bars. */
  const perStrikeOi = useMemo(() => {
    if (!chain.length || !(spot > 0)) return [];
    return chain
      .map((r) => ({ strike: r.strike, oi: oiLeg(r, spot) }))
      .filter((r) => Number.isFinite(r.oi));
  }, [chain, spot]);

  /**
   * Live vs baseline totals summed over the SAME strikes — the intersection,
   * not each side's own universe. They are not the same universe: the live
   * chain is a ±8% band around live spot, the settled baseline a ±500-point
   * band around yesterday's settle, and the deep-OTM strikes at either edge
   * carry the biggest OI on the board. Summing each side whole injects a large
   * one-sided term and the KPI chip prints an arbitrary ▲/▼ — the same class of
   * artifact the OI basis was chosen to avoid.
   */
  const oiVsBaseline = useMemo(() => {
    if (!baseline || !perStrikeOi.length) return null;
    let live = 0, base = 0, n = 0;
    for (const r of perStrikeOi) {
      const b = baseline.byStrike[String(r.strike)];
      if (b == null) continue;
      live += r.oi; base += b; n++;
    }
    return n ? { live, base, n } : null;
  }, [baseline, perStrikeOi]);

  /**
   * Biggest movers vs the prior close, OI basis. A strike the baseline never
   * listed is SKIPPED rather than treated as zero — a new strike would
   * otherwise print its whole gamma as "change", which it isn't.
   */
  const strikeDeltas = useMemo(() => {
    if (!baseline || !perStrikeOi.length) return [];
    return perStrikeOi
      .filter((r) => baseline.byStrike[String(r.strike)] != null)
      .map((r) => ({ strike: r.strike, delta: r.oi - baseline.byStrike[String(r.strike)] }))
      .filter((r) => Number.isFinite(r.delta) && r.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 4);
  }, [baseline, perStrikeOi]);

  // ── overnight window off the ES bars ───────────────────────────────────────
  const overnight = useMemo(() => {
    if (!sessionCandles.length) return null;
    const today = etWall(clock).date;
    const minOf = (slotKey: string) => {
      const hm = slotKey.slice(11, 16);
      const [h, m] = hm.split(":").map(Number);
      return Number.isFinite(h) ? h * 60 + (m || 0) : -1;
    };

    // The last dated session before today — what "prior close" and "prior day
    // range" mean.
    let pdDate = "";
    for (const c of sessionCandles) {
      const d = c.date ?? c.slotKey.slice(0, 10);
      if (d < today && d > pdDate) pdDate = d;
    }

    let hi = -Infinity, lo = Infinity;          // overnight (18:00 -> 09:30)
    let pdHi = -Infinity, pdLo = Infinity;      // prior RTH range
    let pdc: number | null = null, pdcTs = -1;  // prior 16:00 close
    let openPx: number | null = null;           // today's 09:30 open
    let rthHi = -Infinity, rthLo = Infinity;    // today's RTH so far

    for (const c of sessionCandles) {
      const d = c.date ?? c.slotKey.slice(0, 10);
      const mins = minOf(c.slotKey);
      if (mins < 0) continue;

      if ((d === today && mins < RTH_OPEN_MIN) || (d < today && mins >= 18 * 60)) {
        if (c.high > hi) hi = c.high;
        if (c.low < lo) lo = c.low;
      }
      if (d === pdDate && mins >= RTH_OPEN_MIN && mins < RTH_CLOSE_MIN) {
        if (c.high > pdHi) pdHi = c.high;
        if (c.low < pdLo) pdLo = c.low;
        // The prior session's LAST RTH bar is the 16:00 close the gap is
        // measured from. Deliberately not the last overnight print.
        if (c.timestamp > pdcTs) { pdcTs = c.timestamp; pdc = c.close; }
      }
      if (d === today && mins >= RTH_OPEN_MIN && mins < RTH_CLOSE_MIN) {
        if (mins === RTH_OPEN_MIN) openPx = c.open;
        if (c.high > rthHi) rthHi = c.high;
        if (c.low < rthLo) rthLo = c.low;
      }
    }

    return {
      hi: Number.isFinite(hi) ? hi : null,
      lo: Number.isFinite(lo) ? lo : null,
      pdc,
      pd: Number.isFinite(pdHi) && Number.isFinite(pdLo) ? { hi: pdHi, lo: pdLo } : null,
      openPx,
      rthHi: Number.isFinite(rthHi) ? rthHi : null,
      rthLo: Number.isFinite(rthLo) ? rthLo : null,
    };
  }, [sessionCandles, clock]);

  /**
   * The gap: prior 16:00 ET close -> today's 09:30 ET open. That pair, always.
   *
   * BEFORE 09:30 there is no open yet, so the front ES stands in for it and the
   * row is marked PROJECTED — it moves until the bell and should not be read as
   * a fact. From 09:30 the gap is FIXED at the printed open and never moves
   * again for the rest of the day.
   *
   * FILLED = price traded back through the prior close after the open. A gap up
   * fills when today's RTH low reaches the close; a gap down when the RTH high
   * does. `retrace` is how far back it has come as a share of the gap, so a
   * partial fill is visible before it completes.
   *
   * `outside` is the read that changes how you trade it: a gap opening beyond
   * yesterday's range has no reference above or below it, so it runs or fails
   * hard, while a gap inside the range is in known territory and fills far more
   * often.
   */
  const GAP_EPS = 0.25; // ES ticks — below this there is no gap to talk about

  const gap = useMemo(() => {
    const pdc = overnight?.pdc;
    if (pdc == null || !(pdc > 0)) return null;
    const openPx = overnight?.openPx ?? null;
    const projected = openPx == null;
    const ref = openPx ?? (esFut > 0 ? esFut : null);
    if (ref == null) return null;

    const pts = ref - pdc;
    const pct = (pts / pdc) * 100;
    const flat = Math.abs(pts) < GAP_EPS;
    const up = pts > 0;

    // Fill only counts from the RTH bars, and only once there is an open.
    const filled = projected || flat
      ? false
      : up
        ? overnight?.rthLo != null && overnight.rthLo <= pdc
        : overnight?.rthHi != null && overnight.rthHi >= pdc;

    // How far back toward the close it has come. Uses the extreme in the fill
    // direction, not the last price, so a fill that already reversed still reads
    // as filled/near-filled.
    const extreme = up ? overnight?.rthLo : overnight?.rthHi;
    const retrace = projected || flat || extreme == null
      ? null
      : Math.max(0, Math.min(100, ((ref - extreme) / (ref - pdc)) * 100));

    // Distance from the LIVE price back to the close.
    const last = esFut > 0 ? esFut : ref;
    const remaining = filled ? 0 : pdc - last;

    const pd = overnight?.pd ?? null;
    const outside = pd ? ref > pd.hi || ref < pd.lo : null;

    return { pts, pct, projected, flat, up, filled, retrace, remaining, outside, openPx, pdc, pd };
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
  // OI leg on BOTH sides, over the shared strikes only. The KPI prints the
  // OI+Vol total next to this chip, so the chip is labelled "OI" — mixing the
  // bases silently is how you get a permanent premarket ▼ that is really just
  // yesterday's volume falling off.
  const netGexChangePct =
    oiVsBaseline && oiVsBaseline.base !== 0
      ? ((oiVsBaseline.live - oiVsBaseline.base) / Math.abs(oiVsBaseline.base)) * 100
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

  // Scaled on the NEAR window, not the scrolled one — see the bars comment.
  const maxP = Math.max(1, ...nearBars.filter((b) => b.net > 0).map((b) => b.net));
  const maxN = Math.max(1, ...nearBars.filter((b) => b.net < 0).map((b) => -b.net));
  const bigCut = Math.max(maxP, maxN) * 0.55;

  const spotStrike = nearestStrike(bars.map((b) => b.strike), spot);
  const flipStrike = flip ? nearestStrike(bars.map((b) => b.strike), flip) : null;
  /**
   * Keep spot in view without fighting the user. The panel centres on the spot
   * row while it is "pinned" — the state it loads in and returns to via the
   * button — and un-pins the moment the user scrolls it themselves, so reading
   * the 7,900 wall is never yanked back to the money by the next frame.
   * `progScrollRef` marks our own scrollTo writes so the onScroll they fire is
   * not mistaken for the user's hand.
   */
  const chartRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const progScrollRef = useRef(false);
  const [pinned, setPinned] = useState(true);

  const centerOnSpot = useCallback(() => {
    const el = chartRef.current;
    if (!el) return;
    const i = bars.findIndex((b) => b.strike === spotStrike);
    if (i < 0) return;
    progScrollRef.current = true;
    el.scrollTop = Math.max(0, i * 19 + 9.5 - el.clientHeight / 2);
    // The scroll event lands on the next frame, so the flag is cleared there.
    requestAnimationFrame(() => { progScrollRef.current = false; });
  }, [bars, spotStrike]);

  useEffect(() => {
    if (!pinnedRef.current) return;
    centerOnSpot();
  }, [centerOnSpot]);

  const onChartScroll = useCallback(() => {
    if (progScrollRef.current) return;
    if (pinnedRef.current) { pinnedRef.current = false; setPinned(false); }
  }, []);

  const repin = useCallback(() => {
    pinnedRef.current = true;
    setPinned(true);
    centerOnSpot();
  }, [centerOnSpot]);

  const rowTop = (strike: number | null) => {
    if (strike == null) return null;
    const i = bars.findIndex((b) => b.strike === strike);
    return i < 0 ? null : i * 19 + 9.5;
  };

  const tagFor = (strike: number): { text: string; color: string } | null => {
    if (callWall != null && strike === callWall) return { text: "CALL WALL", color: "var(--cw)" };
    if (putWall != null && strike === putWall) return { text: "PUT WALL", color: "var(--pw)" };
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

  // ── GEX LEVEL RAIL ─────────────────────────────────────────────────────────
  /** CORE (CB) — the single strike carrying the most ABSOLUTE gamma in
   *  the whole chain. Same definition the Board's levels panel uses, so the two
   *  surfaces can never print a different CORE. Deliberately NOT the "0DTE magnet"
   *  card below: that one is capped to the ±12-strike window the profile draws,
   *  which can miss a bigger strike further out. */
  const coreBullseye = useMemo(() => {
    if (!perStrike.length) return null;
    return perStrike.reduce((b, r) => (Math.abs(r.net) > Math.abs(b.net) ? r : b), perStrike[0]);
  }, [perStrike]);

  /** Everything the rail needs: the five levels on ONE shared price domain. */
  const rail = useMemo(() => {
    const marks: { code: string; name: string; px: number; color: string }[] = [];
    const add = (code: string, name: string, px: number | null | undefined, color: string) => {
      if (px != null && Number.isFinite(px) && px > 0) marks.push({ code, name, px, color });
    };
    add("PW", "Put Wall", putWall, "var(--pw)");
    add("FLIP", "Gamma Flip", flip, "var(--amber)");
    add("CORE", "max γ strike", coreBullseye?.strike, "var(--violet)");
    add("SPOT", "Spot", spot > 0 ? spot : null, "#ffffff");
    add("CW", "Call Wall", callWall, "var(--cw)");
    if (marks.length < 2) return null;

    const lo = Math.min(...marks.map((m) => m.px));
    const hi = Math.max(...marks.map((m) => m.px));
    const span = hi - lo;
    if (!(span > 0)) return null;
    const pad = span * 0.14;                       // room for the outermost caps
    const dLo = lo - pad, dHi = hi + pad;
    const pos = (px: number) => ((px - dLo) / (dHi - dLo)) * 100;

    const placed = marks
      .slice()
      .sort((a, b) => a.px - b.px)
      .map((m, i) => ({
        ...m,
        pos: pos(m.px),
        side: i % 2 === 0 ? "dn" : "up",           // alternate in PRICE order
        dist: spot > 0 && m.code !== "SPOT" ? m.px - spot : null,
      }));

    const band =
      putWall != null && callWall != null && putWall > 0 && callWall > 0 && callWall !== putWall
        ? { left: Math.min(pos(putWall), pos(callWall)), width: Math.abs(pos(callWall) - pos(putWall)) }
        : null;

    return { marks: placed, band, lo, hi, span };
  }, [putWall, callWall, flip, coreBullseye, spot]);

  const feedLabel = source === "live" ? (connected ? "LIVE" : "RECONNECTING") : source === "rest" ? "REST FALLBACK" : "PAUSED";

  // ── PRE / POST tab ─────────────────────────────────────────────────────────
  // The page answers a different question before the open than it does after the
  // close, so it carries both and picks the one that matches the clock: Premarket
  // until 09:30, Post-Market from 16:05 (the settle, not the bell — the last
  // frames still land in those five minutes). Between them either is defensible,
  // so the last manual choice wins and is remembered for the session; once the
  // user picks a tab, the clock never moves it again.
  const afterClose = etMin >= RTH_CLOSE_MIN + 5;
  const [tab, setTab] = useState<"pre" | "post">("pre");
  const tabPinned = useRef(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(TAB_KEY);
      if (saved === "pre" || saved === "post") { tabPinned.current = true; setTab(saved); }
    } catch { /* private mode — fall through to the clock */ }
  }, []);
  useEffect(() => {
    if (tabPinned.current) return;
    setTab(afterClose ? "post" : "pre");
  }, [afterClose]);
  const pickTab = useCallback((t: "pre" | "post") => {
    tabPinned.current = true;
    setTab(t);
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* nothing to do */ }
  }, []);

  // ── SYMBOL ─────────────────────────────────────────────────────────────────
  // Remembered for the session like the tab. Only the MARKUP switches: this
  // component's hooks (useMobileGex / useEsCandles) run whatever symbol is
  // selected, so the SPX feed keeps flowing while you read SPY and switching
  // back is instant with no reconnect. That costs nothing extra — gexSocket is
  // one refcounted connection shared with the toolbar and every other consumer,
  // and it would stay open for them anyway. TickerBoard's own poll only starts
  // when it mounts, so at most one chain is being polled at a time.
  const [sym, setSym] = useState<Symbol_>("SPX");
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SYM_KEY) as Symbol_ | null;
      if (saved && (SYMBOLS as readonly string[]).includes(saved)) setSym(saved);
    } catch { /* private mode — SPX it is */ }
  }, []);
  const pickSym = useCallback((v: Symbol_) => {
    setSym(v);
    try { sessionStorage.setItem(SYM_KEY, v); } catch { /* nothing to do */ }
  }, []);

  // ── SESSION DATE ───────────────────────────────────────────────────────────
  // Today is the live page and the default; any earlier entry is a look-up of
  // what was RECORDED that day, which is a different surface entirely — see
  // HistoricalRecap's header for why a past date does not just get piped into
  // PostMarketTab.
  //
  // The list is the sessions that ACTUALLY HAVE a settled row, straight off
  // /proxy/gex-levels-history (one row per session, kept indefinitely, gaps
  // back-filled from settled OI). Offering the recorded dates rather than a
  // computed run of weekdays is the difference between a picker that always
  // lands on data and one that offers Thanksgiving. The weekday walk stays as
  // the fallback for the moment before that request lands, and for the case
  // where it fails — a picker with only "Today" in it would read as breakage.
  //
  // This is the SAME request HistoricalRecap makes; dedupeFetch collapses the
  // two into one, so the picker costs nothing extra once the recap mounts.
  const { dates: recordedDates, state: recordedState } = useGexLevelsHistory(SESSION_COUNT);
  const sessions = useMemo(() => {
    const fallback = recentSessions(etDate, SESSION_COUNT);
    if (recordedState !== "ok" || !recordedDates.length) return fallback;
    // Today is always first even before it has a settled row of its own — it is
    // the live option and the picker must be able to get back to it.
    const past = recordedDates.filter((d) => d < etDate).slice(0, SESSION_COUNT - 1);
    return [etDate, ...past];
  }, [etDate, recordedDates, recordedState]);

  const [sessionDate, setSessionDate] = useState(etDate);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(DATE_KEY);
      if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) && saved <= etDate) setSessionDate(saved);
    } catch { /* private mode — today it is */ }
    // Deliberately once, on mount. Re-running it whenever `sessions` changes
    // would drag the user back to a stored date every time the clock ticked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A selection outside the offered window snaps back to today rather than
  // querying a date the picker no longer shows. Waits for the recorded list to
  // settle: while it is still loading `sessions` is the weekday fallback, and
  // bouncing a valid stored date off that would undo the restore above.
  useEffect(() => {
    if (recordedState === "loading") return;
    if (!sessions.includes(sessionDate)) setSessionDate(etDate);
  }, [sessions, sessionDate, etDate, recordedState]);
  const pickDate = useCallback((v: string) => {
    setSessionDate(v);
    try { sessionStorage.setItem(DATE_KEY, v); } catch { /* nothing to do */ }
  }, []);
  const isHistorical = sessionDate !== etDate;

  return (
    <div className="pmk" style={{ flex: 1, minHeight: 0 }}>
      <style dangerouslySetInnerHTML={{ __html: CSS + POSTMARKET_CSS + HISTORICAL_CSS }} />
      <div className="wrap">

        <div className="pagehead">
          <h1>
            {isHistorical ? "Session Recap" : tab === "post" ? "Post-Market Recap" : "Premarket Prep"}
          </h1>
          <div className="tabs">
            {SYMBOLS.map((s2) => (
              <button key={s2} className={sym === s2 ? "on" : ""} onClick={() => pickSym(s2)}>{s2}</button>
            ))}
          </div>
          <span className="badge-concept">
            {isHistorical
              ? `${sym} · RECORDED · ${sessionLabel(sessionDate)}`
              : sym === "SPX"
                ? `${isZeroDte ? "0DTE" : "FRONT"} ${expiry || "—"} · ${feedLabel} · ${openLabel}`
                : `${sym} · CHAIN POLL · ${openLabel}`}
          </span>
          <span className={`dsel${isHistorical ? " past" : ""}`} style={{ marginLeft: "auto" }}>
            <select
              value={sessionDate}
              onChange={(e) => pickDate(e.target.value)}
              title="Which session to show. Today is the live page; earlier dates show what was recorded that day."
              aria-label="Session date"
            >
              {sessions.map((d) => (
                <option key={d} value={d}>
                  {d === etDate ? `Today · ${sessionLabel(d)}` : sessionLabel(d)}
                </option>
              ))}
            </select>
          </span>
          <div className="tabs">
            <button
              className={!isHistorical && tab === "pre" ? "on" : ""}
              disabled={isHistorical}
              title={isHistorical ? "A premarket map only exists for the live session" : undefined}
              style={isHistorical ? { opacity: .4, cursor: "not-allowed" } : undefined}
              onClick={() => pickTab("pre")}
            >
              Premarket
            </button>
            <button
              className={!isHistorical && tab === "post" ? "on" : ""}
              disabled={isHistorical}
              title={isHistorical ? "Showing the recorded recap for the chosen session" : undefined}
              style={isHistorical ? { opacity: .4, cursor: "not-allowed" } : undefined}
              onClick={() => pickTab("post")}
            >
              <span className="tdot" style={{ background: afterClose ? "var(--blue)" : "#55606e" }} />
              Post-Market
            </button>
          </div>
        </div>

        {isHistorical ? (
          /* A past session is recorded history, not a live board — TickerBoard
             and PostMarketTab both read the CURRENT chain, so neither can be
             pointed at it. HistoricalRecap renders only the per-date stores. */
          <HistoricalRecap date={sessionDate} symbol={sym} />
        ) : sym !== "SPX" ? (
          <TickerBoard ticker={sym} view={tab} etDate={etDate} />
        ) : tab === "post" ? (
          <PostMarketTab
            spot={spot}
            esFut={esFut}
            basis={basis}
            flip={flip}
            callWall={callWall}
            putWall={putWall}
            totalNetGex={totalNetGex ?? null}
            perStrike={perStrike}
            chain={chain}
            coreBullseye={coreBullseye}
            maxPain={maxPain}
            em={em}
            totals={totals}
            overnight={overnight}
            candles={sessionCandles}
            expiry={expiry || ""}
            etDate={etDate}
            etMin={etMin}
            hasData={hasData}
          />
        ) : (
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
                  <span className={netGexChangePct >= 0 ? "chg-pos" : "chg-neg"} style={{ fontSize: 11 }}
                    title={`OI-basis change vs the ${baseline?.date ?? "prior"} close`}>
                    {netGexChangePct >= 0 ? "▲" : "▼"} {Math.abs(netGexChangePct).toFixed(0)}% <small>OI</small>
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

          {/* ── 1b. GEX LEVEL RAIL — every level on one axis ───────────────── */}
          <div className="gexrail">
            <div className="rh">
              <h3>GEX Levels · one axis</h3>
              <span className="tiny">
                {rail
                  ? `${fmtPx(rail.lo, 0)} – ${fmtPx(rail.hi, 0)} · ${nf(rail.span, 0)} pts`
                  : "waiting for the chain"}
              </span>
            </div>

            {rail ? (
              <div className="rail">
                <div className="track2">
                  {rail.band && (
                    <div className="band" style={{ left: `${rail.band.left}%`, width: `${rail.band.width}%` }} />
                  )}
                </div>

                {rail.marks.map((m) => (
                  <div key={m.code}>
                    <div
                      className={`mk2${m.code === "SPOT" ? " spot" : ""}`}
                      style={{ left: `${m.pos}%`, background: m.color }}
                    />
                    <div
                      className={`cap2 ${m.side}`}
                      style={{ left: `${Math.max(4, Math.min(96, m.pos))}%` }}
                    >
                      <div className="n2" style={{ color: m.color }}>
                        {m.code}<span className="ln"> · {m.name}</span>
                      </div>
                      <div className="v2 mono">{fmtPx(m.px, 0)}</div>
                      <div className="d2 mono">
                        {m.code === "SPOT"
                          ? (es(m.px) != null ? `ES ${fmtPx(es(m.px), 0)}` : "live")
                          : fmtPts(m.dist)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rail-empty">Waiting for the chain…</div>
            )}
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
                <span className="tiny">
                  {isZeroDte ? "0DTE" : "front"} · OI + Vol · {bars.length} strikes · scroll
                </span>
              </div>

              <div style={{ position: "relative" }}>
              <div className="chart" ref={chartRef} onScroll={onChartScroll}>
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
              {!pinned && bars.length > 0 && (
                <button type="button" className="recenter" onClick={repin}>⤒ back to spot</button>
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
                    <div className="mk" style={{ left: "12%", background: "var(--pw)" }} />
                    <div className="mk" style={{ left: "88%", background: "var(--cw)" }} />
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
              <div className={`stat${gap?.filled ? " gap-filled" : ""}`}>
                <span className="l">Gap {gap?.projected ? "(projected)" : "(4pm → 9:30)"}</span>
                <span className="r mono">
                  {gap ? (
                    <>
                      <span className={gap.flat ? "muted" : gap.up ? "chg-pos" : "chg-neg"}>
                        {gap.flat ? "flat" : `${gap.up ? "+" : "−"}${Math.abs(gap.pts).toFixed(2)} (${fmtPct(gap.pct)})`}
                      </span>{" "}
                      {gap.filled
                        ? <span className="pill cool">✓ FILLED</span>
                        : gap.projected
                          ? <span className="pill">projected · pre-open</span>
                          : <span className={`pill ${gap.outside ? "warn" : ""}`}>
                              {gap.outside == null ? (gap.up ? "gap up" : "gap down")
                                : gap.outside ? "outside PD range" : "inside PD range"}
                            </span>}
                    </>
                  ) : "—"}
                </span>
              </div>
              <div className={`stat${gap?.filled ? " gap-filled" : ""}`}>
                <span className="l">Gap fill target</span>
                <span className="r mono">
                  {!gap || gap.flat ? "—"
                    : gap.filled
                      ? <span className="chg-pos">✓ filled at {fmtPx(gap.pdc, 2)}</span>
                      : <>
                          {fmtPx(gap.pdc, 2)}{" "}
                          <span className="muted">
                            ({nf(Math.abs(gap.remaining), 0)} pts {gap.remaining >= 0 ? "up" : "down"}
                            {gap.retrace != null ? ` · ${gap.retrace.toFixed(0)}% retraced` : ""})
                          </span>
                        </>}
                </span>
              </div>
              {gap && !gap.flat && !gap.projected && (
                <div className="gapbar">
                  <div className="t"><div className="f" style={{ width: `${Math.max(2, Math.min(100, gap.filled ? 100 : gap.retrace ?? 0))}%`, background: gap.filled ? "var(--pos)" : "var(--blue)" }} /></div>
                  <span className="lbl">
                    {gap.filled ? "gap closed" : `${(gap.retrace ?? 0).toFixed(0)}% of the gap retraced`}
                  </span>
                </div>
              )}
              <div className="stat"><span className="l">Prior day range (ES)</span><span className="r mono">
                {overnight?.pd
                  ? <>{fmtPx(overnight.pd.lo, 0)} – {fmtPx(overnight.pd.hi, 0)} <span className="muted">({nf(overnight.pd.hi - overnight.pd.lo, 0)})</span></>
                  : "—"}
              </span></div>

              <div className="colhead" style={{ margin: "16px 0 6px" }}>
                <h3>Biggest GEX Changes</h3>
                <span className="tiny">
                  {baseline ? `vs ${baseline.date} close · OI basis` : "vs prior close"}
                </span>
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
                  {baselineState === "loading" || baselineState === "idle"
                    ? "Loading the prior-close board…"
                    : baselineState === "empty"
                      ? `No settled prior-session board for ${expiry || "this expiry"} yet — it is published overnight and backfills on its own.`
                      : "No strike moved against the prior close."}
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
                        <div className="mk" style={{ left: `${emPos(putWall)}%`, background: "var(--pw)", top: 18, height: 24 }} />
                        <div className="cap bot" style={{ left: `${emPos(putWall)}%`, top: 46, color: "var(--pw)" }}>Put Wall</div>
                      </>
                    )}
                    {emPos(callWall) != null && (
                      <>
                        <div className="mk" style={{ left: `${emPos(callWall)}%`, background: "var(--cw)", top: 18, height: 24 }} />
                        <div className="cap bot" style={{ left: `${emPos(callWall)}%`, top: 46, color: "var(--cw)" }}>Call Wall</div>
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
              {baseline
                ? <span className="chip">baseline {baseline.date} · {baseline.strikes} strikes · OI</span>
                : <span className="chip">{baselineState === "empty" ? "no baseline" : "baseline loading…"}</span>}
            </div>
          </div>
        </section>
        )}
      </div>
    </div>
  );
}
