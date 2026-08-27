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
 * ── ONE PAGE, EVERY SYMBOL (2026-08-27) ─────────────────────────────────────
 * Every name on the picker — SPX plus the MAIN watchlist — renders THIS page,
 * both tabs, all panels. There is no longer a reduced board for the non-socket
 * symbols: components/pages/premarket/TickerBoard.tsx used to catch them and
 * carried about a third of what is below, so SPY and QQQ silently lacked the
 * regime strip, the level rail, the six Key Levels tiles and their prior-close
 * migration lines, the scrolling profile, DEX/vanna, the expected-range track,
 * the bell curve, the catalysts and the entire Post-Market recap. It is not
 * mounted any more.
 *
 * What made that possible is that the swap below already existed for frozen
 * sessions. A THIRD source now feeds the same destructuring:
 *
 *   useMobileGex   SPX, live socket.                      (sym === "SPX")
 *   frozenGexOf    SPX, a captured past session.          (frozen)
 *   useChainGex    any ticker, /api/chains on a 1m poll.  (everything else)
 *
 * All three hand over `{ chain, spot, flip, callWall, putWall, totalNetGex, … }`
 * with RAW per-strike legs, and every memo and panel below reads only that. So
 * a NVDA board is this page's own code computing NVDA's walls, CORE, max pain,
 * expected move, DEX and playbook from NVDA's own chain — not a second
 * implementation that can drift.
 *
 * The three things that are genuinely SPX-only are named as such on screen
 * rather than faked: the ES basis and every "ES 6,812" sub-line (no future
 * stands behind AAPL), frozen past sessions (the freeze captures the one symbol
 * the socket carries), and the ES overnight window — for the other symbols the
 * overnight panel reads that ticker's OWN recorded candles instead.
 *
 * DATA SOURCES — all shared, none duplicated:
 *   useMobileGex        the one live-GEX layer (rides lib/gexSocket, refcounted,
 *                       pinned to today's 0DTE). Gives spot, prevClose, flip,
 *                       call/put wall, totalNetGex, esFut, basis and the chain.
 *                       SPX only — the socket carries one symbol.
 *   useChainGex         the same shape for any other ticker, off /api/chains on
 *                       a 1-minute poll. See chainGex.ts.
 *   useEsCandles        5m ES bars incl. the overnight session → ON high/low and
 *                       the prior RTH close. Same socket.
 *   useEconCalendar     /api/calendar + /proxy/earnings-week → today's catalysts.
 *   /api/quotes-batch   SPX / ES / NQ / VIX day change. SPX is there for its
 *                       PRIOR CLOSE, which the Post-Market recap needs and must
 *                       not synthesise from ES.
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
 * ── LOOKING AT A PAST SESSION (2026-08-22) ──────────────────────────────────
 * The page head carries a SESSION PICKER. Today is the live page; an earlier
 * date is served one of two ways, and which one depends only on what was
 * stored:
 *
 *   FROZEN — server-v2/premarket-freeze-recorder.js captured that session's
 *     chain twice (09:10-09:29 and 16:05-16:25 ET). The captured snapshot is
 *     swapped in at ONE place, where useMobileGex's values are destructured,
 *     and every memo and both tabs below that line run unchanged. A frozen date
 *     is therefore the REAL page — same walls, same CORE, same max pain, same
 *     expected move, same premium and written-vs-traded — recomputed here and
 *     now from that day's own book. There is no second rendering path to drift.
 *
 *   OLDER — no capture exists, and none can be manufactured: nothing in this
 *     repo stores per-strike marks and volume for a past session. Those dates
 *     fall back to components/pages/premarket/HistoricalRecap.tsx, which shows
 *     the per-date stores that DO go back indefinitely (the settled levels row,
 *     eod_gex, the wall log, that session's ES bars).
 *
 * Three things follow the session rather than the clock once a date is picked:
 * `viewDate` (what the overnight window, the wall log, the journal and the
 * baseline's `today=` all key off), `viewMin` (a frozen day reads as just past
 * the settle) and the ES bars, which come from the dated pair rather than the
 * live rolling window. Everything else needed no change at all, which is the
 * clearest sign the swap is in the right place.
 *
 * Styling: the approved mockup's CSS, scoped under `.pmk` (custom properties on
 * `.pmk`, not `:root`) so its generic class names cannot leak into the app.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useMobileGex } from "@/hooks/useMobileGex";
import { useEsCandles } from "@/hooks/useEsCandles";
import { useEtfCandles } from "@/hooks/useEtfCandles";
import { useEconCalendar } from "@/hooks/useEconCalendar";
import { isStale } from "@/lib/econCalendar";
import { SCANNER_MAIN } from "@/lib/scannerTickers";
import PostMarketTab, { POSTMARKET_CSS } from "@/components/pages/premarket/PostMarketTab";
import HistoricalRecap, { HISTORICAL_CSS } from "@/components/pages/premarket/HistoricalRecap";
import GexWatchFeed, { GEX_WATCH_CSS } from "@/components/pages/premarket/GexWatchFeed";
import GammaBellCurve, { GAMMA_BELL_CSS } from "@/components/pages/premarket/GammaBellCurve";
import { useChainGex } from "@/components/pages/premarket/chainGex";
import {
  GEX_HISTORY_LIMIT,
  frozenGexOf,
  recentSessions,
  sessionLabel,
  useDatedEsCandles,
  useFreezeDates,
  useGexLevelsHistory,
  useSessionFreeze,
} from "@/components/pages/premarket/postMarketData";
import {
  netGEXOf,
  callGEXOf,
  putGEXOf,
  netDEXOf,
  type ChainRow,
} from "@/lib/calculations/calculations";
import {
  HOME_THEME as HT,
  LIGHT_BLUE,
  ES_CANDLE_UP,
  ES_CANDLE_DOWN,
} from "@/components/shared/homeTheme";

// ─────────────────────────────────────────────────────────────────────────────
//  CSS (mockup, scoped)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `#rrggbb` → `rgba(r,g,b,a)`.
 *
 * The theme exports flat hexes; this page needs alpha versions of them for
 * washes, rings and dimmed bar ends. Deriving them here is the whole point —
 * a hand-typed rgba() in the stylesheet is a hardcoded colour that stops
 * tracking the theme the moment the theme moves (AGENTS.md).
 */
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** White alpha — the app's neutral surface rung (borders, sunken tracks, hover). */
const ink = (a: number) => `rgba(255,255,255,${a})`;

const CSS = `
.pmk{
  /* SURFACE TOKENS — interpolated from components/shared/homeTheme, never typed
     as hex here (AGENTS.md). This block used to be the mockup's own slate ramp
     (#0a0d12 / #11161f / #151b26 / #242e3b), which is why the page read as a
     different product from the rest of the app: the cards sat a full step
     lighter than every other card in the dashboard and their edges were a solid
     slate line rather than the app's white hairline.
     Everything below is now the SAME surface language as the shared Card and
     the earnings week board: HT.panelBg fill, HT.border hairline, one radius. */
  --bg:${HT.bg}; --panel:${HT.panel}; --panel2:${HT.panelBg};
  --line:${HT.border}; --line2:${ink(0.2)};
  /* Card outline. Still a white alpha, and now literally the app's border token:
     the cards sit on three different backgrounds (panel, panel2, the green/red
     regime wash) and a fixed hex reads as a different weight on each. */
  --card:${HT.border};
  /* Card interior + the hover/active fill controls use. Both are white alphas
     over --bg for the same reason the border is. */
  --sunken:${ink(0.05)}; --active:${ink(0.08)};
  --line3:${ink(0.3)}; --off:${ink(0.28)};
  /* The one SOLID plate on the page. Bar tags, the ladder's spot/flip labels and
     the footer sit ON TOP of coloured bars, so they cannot use a white alpha —
     it would let the bar read straight through the text. HT.panel is the app's
     opaque panel colour, which is what the old var(--plate) was approximating. */
  --plate:${HT.panel};
  --cyan:${HT.cyan}; --cyanEdge:${hexA(HT.cyan, 0.45)}; --cyanWash:${hexA(HT.cyan, 0.1)};
  --txt:${HT.text}; --dim:${HT.text}; --dim2:${HT.muted};
  /* The +/- gamma pair is the app's CANDLE pair now (homeTheme ES_CANDLE_UP /
     ES_CANDLE_DOWN), not this page's private green/red — so a bar on the
     premarket ladder is the same green as an up-candle two tabs over. */
  --pos:${ES_CANDLE_UP}; --posDim:${hexA(ES_CANDLE_UP, 0.45)};
  --neg:${ES_CANDLE_DOWN}; --negDim:${hexA(ES_CANDLE_DOWN, 0.45)};
  /* WALL COLOURS, kept separate from the +/− gamma pair on purpose.
     --pos / --neg say "positive or negative gamma" and belong to the bars.
     --cw / --pw say "call wall / put wall" and belong to the LEVELS. They were
     the same tokens until 2026-08-20, which meant flipping the wall convention
     would have re-coloured every bar on the page. Call wall reads GREEN and put
     wall RED on every ticker and every surface — change it here, once.
     NOT re-pointed at LEVEL_COLORS.cw/.pw (blue/red): that would silently undo
     the 2026-08-20 green/red decision as a side effect of a re-theme. */
  --cw:${ES_CANDLE_UP}; --pw:${ES_CANDLE_DOWN};
  --amber:${HT.orange}; --blue:${LIGHT_BLUE}; --violet:#a78bfa;
  /* ALPHA RUNGS. Every wash, edge, glow and bar-fill on this page is derived
     from the five accent tokens above instead of being typed as a literal
     rgba(). That is not tidiness: PostMarketTab.tsx and HistoricalRecap.tsx are
     separate template literals with no access to the JS side, so a hand-typed
     green in one of them silently keeps the OLD hue after this block moves —
     which is exactly how a "pill.cool" ends up with a border one shade off its
     own text. Change an accent above and every rung follows, in all four
     files. */
  --posWash:${hexA(ES_CANDLE_UP, 0.08)}; --posEdge:${hexA(ES_CANDLE_UP, 0.22)};
  --posEdgeUp:${hexA(ES_CANDLE_UP, 0.4)}; --posBand:${hexA(ES_CANDLE_UP, 0.28)};
  --posGlow:${hexA(ES_CANDLE_UP, 0.16)}; --posGlow2:${hexA(ES_CANDLE_UP, 0.05)};
  --negWash:${hexA(ES_CANDLE_DOWN, 0.08)}; --negEdge:${hexA(ES_CANDLE_DOWN, 0.22)};
  --negEdgeUp:${hexA(ES_CANDLE_DOWN, 0.4)}; --negBand:${hexA(ES_CANDLE_DOWN, 0.28)};
  --negGlow:${hexA(ES_CANDLE_DOWN, 0.16)};
  --blueWash:${hexA(LIGHT_BLUE, 0.06)}; --blueBand:${hexA(LIGHT_BLUE, 0.14)};
  --blueEdge:${hexA(LIGHT_BLUE, 0.22)}; --blueSoft:${hexA(LIGHT_BLUE, 0.3)};
  --blueFill1:${hexA(LIGHT_BLUE, 0.4)}; --blueFill2:${hexA(LIGHT_BLUE, 0.6)};
  --blueFill3:${hexA(LIGHT_BLUE, 0.85)};
  --amberWash:${hexA(HT.orange, 0.07)}; --amberEdge:${hexA(HT.orange, 0.4)};
  --amberSoft:${hexA(HT.orange, 0.5)};
  /* Two radii for the whole page — the week board's card (12) and its inner
     tile (9). Every rounded surface picks one; nothing types its own. */
  --r:12px; --r2:9px;
  background:var(--bg);color:var(--txt);
  font:13px/1.45 var(--font-inter),'Inter',ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
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
.pmk .dsel select:hover{background:var(--active)}
.pmk .dsel select:focus{outline:none;border-color:var(--cyanEdge)}
/* The popup list is drawn by the OS and inherits nothing — these two are the
   only properties it honours, and without them a dark page opens a white menu. */
.pmk .dsel option{background:var(--plate);color:var(--txt)}
.pmk .dsel.past select{border-color:var(--amberEdge);color:var(--amber)}
.pmk .dsel.past::after{border-color:var(--amber)}

/* FROZEN banner. Violet, not amber: amber on this page means "caution, check
   this" (the warnbars, the stale-calendar chip) and a frozen session is not a
   warning — it is a correct, complete render of a day that has ended. It sits
   above the section so it cannot read as one panel's caveat. */
.pmk .frozenbar{margin-bottom:12px;padding:9px 13px;border-radius:var(--r);
  border:1px solid rgba(167,139,250,.3);background:rgba(167,139,250,.07);
  font-size:12px;color:var(--dim)}
.pmk .frozenbar b{color:var(--violet)}

/* OUTER SHELL — the app's card, with a regime tint on top.
   The tint is semantic (green = positive gamma, red = negative) so it stays,
   but the SURFACE underneath is now the shared card: the app's panel colour,
   one hairline border, the app's drop shadow, and the cyan top edge every other
   glossy panel in the dashboard carries. The old coloured 1px ring is gone — it
   read as a second border in a UI where no other card has one, and 190px of
   gradient already makes the regime unmistakable. */
.pmk .prep{
  border:1px solid var(--card);border-top:2px solid var(--cyanEdge);
  border-radius:16px;overflow:hidden;
  background:linear-gradient(180deg,${hexA(ES_CANDLE_UP, 0.07)},${hexA(ES_CANDLE_UP, 0)} 190px), var(--panel);
  box-shadow:0 18px 40px rgba(0,0,0,0.22);
}
.pmk .prep.is-neg{
  border-top-color:${hexA(ES_CANDLE_DOWN, 0.45)};
  background:linear-gradient(180deg,${hexA(ES_CANDLE_DOWN, 0.08)},${hexA(ES_CANDLE_DOWN, 0)} 190px), var(--panel);
}

.pmk .regime{
  display:grid;grid-template-columns:minmax(230px,auto) 1px 1fr 1px 1fr 1px 1fr auto;
  gap:0;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line);
}
.pmk .vr{background:var(--line);height:44px;width:1px;margin:0 18px}
.pmk .regbadge{display:flex;align-items:center;gap:11px}
.pmk .dot{width:9px;height:9px;border-radius:50%;background:var(--pos);box-shadow:0 0 0 4px var(--posGlow);animation:pmkpulse 2.6s infinite}
.pmk .dot.neg{background:var(--neg);box-shadow:0 0 0 4px var(--negGlow)}
.pmk .dot.off{background:var(--off);box-shadow:none;animation:none}
@keyframes pmkpulse{0%,100%{box-shadow:0 0 0 4px var(--posGlow)}50%{box-shadow:0 0 0 8px var(--posGlow2)}}
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
  background:var(--posWash);border:1px solid var(--posEdge);
}
.pmk .bias.neg{background:var(--negWash);border-color:var(--negEdge)}
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
.pmk .rail .track2{position:absolute;left:0;right:0;top:54px;height:10px;border-radius:6px;background:var(--sunken);border:1px solid var(--line)}
.pmk .rail .band{position:absolute;top:-1px;bottom:-1px;border-radius:6px;background:linear-gradient(90deg,var(--negBand),var(--blueBand),var(--posBand))}
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
.pmk .lvl .name em{font-style:normal;font-size:9px;padding:1px 5px;border-radius:4px;background:var(--plate);border:1px solid var(--line2);color:var(--dim);white-space:nowrap}
.pmk .lvl .px{font-size:21px;font-weight:660;letter-spacing:-.03em;margin:4px 0 1px}
.pmk .lvl .es{font-size:10.5px;color:var(--dim)}
.pmk .lvl .dist{font-size:11px;margin-top:6px;display:flex;justify-content:space-between;align-items:center;gap:6px}

/* KEY LEVELS HEAD — the basis switch plus what the Δ below is measured against.
   The grid used to start straight after the rail with no header at all, which
   was fine while every tile printed one basis. It does not survive a SWITCH:
   the tiles would silently change meaning with nothing on screen naming the
   leg they are on. The head is the label, and the switch lives in it so the
   two can never drift apart. */
.pmk .lvlhead{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 18px 0}
.pmk .lvlhead .lh{display:flex;align-items:baseline;gap:10px;min-width:0}
.pmk .lvlhead h3{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);
  margin:0;font-weight:600;white-space:nowrap}
.pmk .lvlhead .vs{font-size:10px;color:var(--dim2);letter-spacing:.04em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pmk .lvlhead .vs b{color:var(--dim);font-weight:600}
.pmk .lvlhead .vs.warn{color:var(--amber)}

/* MIGRATION LINE — the "was" row Option B folds into each tile.
   Sits below .dist behind its own hairline so a tile with no baseline (max
   pain, or any tile before the fetch lands) simply ends where it always did
   instead of leaving a gap where a rule used to be. */
.pmk .lvl .mig{margin-top:7px;padding-top:6px;border-top:1px dashed var(--line);
  display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:10.5px;color:var(--dim2)}
.pmk .lvl .mig .arw{color:var(--line3)}
.pmk .lvl .mig .now{color:var(--dim)}
/* Tag = the STATE of the move, one word. Neutral by default; only a move that
   actually means something takes a colour, so a screen of grey tags reads
   correctly as "nothing migrated overnight". */
.pmk .mtag{font-size:9px;letter-spacing:.06em;text-transform:uppercase;padding:1px 5px;
  border-radius:999px;border:1px solid var(--line2);color:var(--dim);white-space:nowrap}
.pmk .mtag.up{color:var(--pos);border-color:var(--posEdge);background:var(--posWash)}
.pmk .mtag.down{color:var(--neg);border-color:var(--negEdge);background:var(--negWash)}
.pmk .mtag.warnt{color:var(--amber);border-color:var(--amberEdge);background:var(--amberWash)}
.pmk .mtag.flipt{color:var(--violet);border-color:rgba(167,139,250,.35);background:rgba(167,139,250,.08)}

.pmk .pill{font-size:10px;padding:2px 6px;border-radius:5px;border:1px solid var(--line2);color:var(--dim);white-space:nowrap}
.pmk .pill.hot{border-color:var(--negEdgeUp);color:var(--neg);background:var(--negWash)}
.pmk .pill.cool{border-color:var(--posEdgeUp);color:var(--pos);background:var(--posWash)}
.pmk .pill.warn{border-color:var(--amberEdge);color:var(--amber);background:var(--amberWash)}

.pmk .body{display:grid;grid-template-columns:1.55fr 1fr 1fr;gap:0}
.pmk .col{padding:14px 18px;border-right:1px solid var(--line);min-width:0}
.pmk .col:last-child{border-right:0}
.pmk .colhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px}
.pmk .colhead h3{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin:0;font-weight:600}
.pmk .seg{display:inline-flex;border:1px solid var(--line2);border-radius:var(--r2);overflow:hidden}
.pmk .seg button{background:transparent;border:0;color:var(--dim);font:inherit;font-size:10.5px;padding:3px 9px;cursor:pointer;border-right:1px solid var(--line2)}
.pmk .seg button:last-child{border-right:0}
/* Active states are CYAN across the page — the app's selection colour, the
   same one the earnings week board and the toolbars use. They were a flat
   slate fill, which is why a selected tab here did not look selected next to
   any other page. */
.pmk .seg button.on{background:var(--cyanWash);color:var(--cyan);font-weight:600}

/* SCROLLING PROFILE.
   The ladder renders ±60 strikes but only ~22 rows are ever in view, so the
   panel is the scroll container. Two consequences worth knowing:
   - .spotline / .flipline are absolutely positioned INSIDE this box, so they
     scroll with their rows, which is what makes them mean anything.
   - overscroll-behavior:contain stops a flick at the end of the ladder from
     scrolling the whole page behind it. */
.pmk .chart{position:relative;max-height:440px;overflow-y:auto;overscroll-behavior:contain;
  scrollbar-width:thin;scrollbar-color:var(--line2) transparent;padding-right:2px}
.pmk .chart::-webkit-scrollbar{width:8px}
.pmk .chart::-webkit-scrollbar-thumb{background:var(--line2);border-radius:4px}
.pmk .chart::-webkit-scrollbar-thumb:hover{background:var(--line3)}
.pmk .chart::-webkit-scrollbar-track{background:transparent}
.pmk .recenter{position:absolute;right:10px;bottom:8px;z-index:3;font:inherit;font-size:10px;
  letter-spacing:.06em;text-transform:uppercase;color:var(--dim);cursor:pointer;
  background:rgba(13,17,23,.92);border:1px solid var(--line2);border-radius:6px;padding:3px 8px}
.pmk .recenter:hover{color:var(--txt);border-color:var(--cyanEdge)}
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
.pmk .row .tag{position:absolute;top:-1px;font-size:9.5px;padding:1px 5px;border-radius:4px;white-space:nowrap;letter-spacing:.03em;background:var(--plate);max-width:calc(50% - 8px);overflow:hidden;text-overflow:ellipsis}
.pmk .row .tag.inside{background:rgba(6,10,16,.55);border-color:transparent!important;color:#fff!important}
.pmk .spotline,.pmk .flipline{position:absolute;left:60px;right:0;border-top:1px dashed;display:flex;justify-content:flex-end;pointer-events:none}
.pmk .spotline{border-color:#fff9}
.pmk .flipline{border-color:var(--amber)}
.pmk .spotline span,.pmk .flipline span{transform:translateY(-50%);font-size:9.5px;padding:1px 6px;border-radius:4px;background:var(--plate)}
.pmk .spotline span{color:#fff;border:1px solid #ffffff40}
.pmk .flipline span{color:var(--amber);border:1px solid var(--amberEdge)}
.pmk .axis{display:flex;justify-content:space-between;font-size:9.5px;color:var(--dim2);margin-top:6px;padding-left:60px}

.pmk .stat{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px dashed var(--line);gap:10px}
.pmk .stat:last-child{border-bottom:0}
.pmk .stat .l{font-size:11.5px;color:var(--dim)}
.pmk .stat .r{font-size:12.5px;font-weight:600;white-space:nowrap}
.pmk .onrange{margin:12px 0 4px;position:relative;height:52px}
.pmk .onrange .bar2{position:absolute;left:0;right:0;top:22px;height:8px;border-radius:5px;background:var(--sunken);overflow:hidden}
.pmk .onrange .fill{position:absolute;top:0;bottom:0;background:linear-gradient(90deg,var(--blueFill1),var(--blueFill2));border-radius:5px}
.pmk .onrange .mk{position:absolute;top:12px;width:2px;height:28px;border-radius:2px}
.pmk .onrange .cap{position:absolute;font-size:9.5px;white-space:nowrap;transform:translateX(-50%)}
.pmk .onrange .cap.top{top:0}
.pmk .onrange .cap.bot{top:40px;color:var(--dim)}

/* Gap fill. The bar is the only place a PARTIAL fill is visible — the two rows
   above can only say filled or not. */
.pmk .stat.gap-filled .l{color:var(--pos)}
.pmk .gapbar{display:flex;align-items:center;gap:8px;padding:6px 0 2px}
.pmk .gapbar .t{flex:1;height:5px;border-radius:3px;background:var(--sunken);overflow:hidden}
.pmk .gapbar .t .f{height:100%;border-radius:3px;transition:width .3s}
.pmk .gapbar .lbl{font-size:10px;color:var(--dim2);white-space:nowrap}

.pmk .deltas .d{display:grid;grid-template-columns:54px 1fr 66px;align-items:center;gap:8px;padding:4px 0}
.pmk .deltas .d .s{font-size:11px;color:var(--dim)}
.pmk .deltas .d .t{height:6px;background:var(--sunken);border-radius:4px;position:relative;overflow:hidden}
.pmk .deltas .d .t i{position:absolute;top:0;bottom:0;border-radius:4px}
.pmk .deltas .d .v{font-size:11px;text-align:right}

.pmk .sect{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:4px}
.pmk .sect .s{display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:var(--r2);font-size:11.5px;border:1px solid var(--card);gap:8px;min-width:0}
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
.pmk .greeks .g{border:1px solid var(--card);border-radius:var(--r2);padding:8px 9px;background:var(--panel2)}
.pmk .greeks .g .n{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2)}
.pmk .greeks .g .v{font-size:15px;font-weight:640;margin-top:2px;letter-spacing:-.02em}
.pmk .greeks .g .m{font-size:10px;color:var(--dim)}

.pmk .footbar{display:flex;justify-content:space-between;align-items:center;padding:9px 18px;border-top:1px solid var(--line);background:var(--plate);gap:10px;flex-wrap:wrap}
.pmk .footbar .l{font-size:10.5px;color:var(--dim2)}
.pmk .chips{display:flex;gap:6px;flex-wrap:wrap}
.pmk .chip{font-size:10px;padding:3px 8px;border-radius:6px;border:1px solid var(--line2);color:var(--dim);cursor:pointer;background:transparent;font:inherit;font-size:10px}
.pmk .chip.on{background:var(--cyanWash);color:var(--cyan);border-color:var(--cyanEdge)}

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
 * SPX is the live board — it owns the socket, the ES basis and the ES overnight
 * window. Every other symbol rides /api/chains on a one-minute poll
 * (useChainGex) and renders THIS SAME PAGE off it: same memos, same panels,
 * both tabs. What a non-SPX board does not get is the handful of things that
 * are physically SPX's, and those are named on screen rather than faked — the
 * ES basis, the "ES 6,812" sub-lines, and frozen past sessions.
 *
 * ── 2026-08-27: the MAIN watchlist, not three hand-typed names ─────────────
 * This used to be ["SPX", "SPY", "QQQ"]. It is now SPX plus the MAIN group of
 * the scanner universe (lib/scannerTickers → server-v2/scanner-tickers.js):
 * SPY QQQ SPX NDX VIX AAPL AMD AMZN GOOGL META MSFT NVDA SPCX TSLA.
 *
 * MAIN rather than an arbitrary list, because MAIN is exactly the roster the
 * rest of the stack already treats as first-class, and both of the boards'
 * data sources follow it:
 *   • the scanner sweeps MAIN on the 2-minute HOT cadence, and
 *     server-v2/walls-recorder.js samples the latest scanner row PER SYMBOL —
 *     so the Post-Market "Level grades" card reads a real recorded,
 *     server-classified verdict for every name offered here, not just for the
 *     three that used to be listed.
 *   • /api/expirations + /api/chains are per-ticker already — that is what
 *     useChainGex rides.
 * A name outside MAIN would still render, but its wall log would be empty and
 * its chain unswept — which is the reason this is a fixed list and not a free
 * text box.
 *
 * The STATIC import is deliberate. The live roster (with the owner page's
 * `roster_overrides` on top) comes from GET /proxy/scanner-tickers, but that
 * endpoint returns one flat de-duped array with no group labels — there is no
 * runtime way to ask it "which of these are MAIN". useScannerTickers() would
 * therefore hand back 169 tickers, not 14. If the picker should ever follow
 * live overrides, the endpoint has to expose the buckets first.
 *
 * SPX is pinned first because it is the only live-socket board; the rest keep
 * MAIN's own order.
 */
const SYMBOLS: readonly string[] = [
  "SPX",
  ...SCANNER_MAIN.filter((t) => t !== "SPX"),
];
type Symbol_ = string;

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
  /**
   * Both legs, per strike, on every response regardless of `basis` — added
   * 2026-08-24 so the Key Levels basis switch never refetches. OPTIONAL on
   * purpose: a VPS running a build that predates the server change returns
   * neither, and `basisMaps()` below degrades to "OI only has a baseline"
   * rather than silently diffing one basis against another.
   */
  byStrikeOi?: Record<string, number>;
  byStrikeVol?: Record<string, number>;
};

/**
 * Which leg of the chain the Key Levels tiles are read on.
 *
 *   oi     γ × OI       × S²   — the premarket-honest basis (see the header)
 *   oivol  γ × (OI+Vol) × S²   — what the bars and the KPI print
 *   vol    γ × Volume    × S²  — today's trading only; ~0 before 09:30
 *
 * This is deliberately NOT the page-wide basis: the profile bars, the rail and
 * Biggest Changes keep their own (documented) bases. The switch exists because
 * the same six levels answer different questions on each leg, and reading them
 * on one leg while the Δ beside them is computed on another is the exact
 * mismatch the OI default was chosen to avoid.
 */
type LvlBasis = "oi" | "oivol" | "vol";

const LVL_BASIS_KEY = "cb-premarket-lvlbasis-v1";

const LVL_BASIS_META: Record<LvlBasis, { tab: string; long: string; hint: string }> = {
  oi:    { tab: "OI",     long: "OI only",
           hint: "γ × OI × S². Both sides of the overnight Δ carry the same settled OI, so the change is pure gamma re-pricing. The honest premarket basis." },
  oivol: { tab: "OI+VOL", long: "OI + Vol",
           hint: "γ × (OI+Vol) × S² — what the profile bars and the Net GEX KPI print. Premarket the Δ drags yesterday's whole session volume in; read the levels, not the change." },
  vol:   { tab: "VOL",    long: "Vol only",
           hint: "γ × Volume × S². Today's trading only — near zero before 09:30, and the cleanest read on what is actually being traded once the session is running." },
};

/**
 * The OI leg of a chain row: γ × OI × S², i.e. the OI+Vol number the app prints
 * minus the volume leg. This is the live side of every baseline comparison —
 * see the header for why the printed OI+Vol number is the wrong one to diff.
 */
function oiLeg(row: ChainRow, spot: number): number {
  return netGEXOf(row, "net", spot) - netGEXOf(row, "vol", spot);
}

/** One gamma Δ at one strike, as the migration memo shapes it. */
type GexDelta = { was: number; now: number; delta: number; pct: number | null; flipped: boolean };
/** One level move, in points. */
type PxMove = { was: number; now: number; move: number };

/**
 * The migration line on a Key Levels tile: `[TAG] was <x> → <y> · <pct>`.
 *
 * Renders NOTHING when it has nothing to say. That is the whole contract — a
 * tile with no baseline for the selected basis must look like the tile always
 * did, not like a tile reporting no change. `null` in, null out.
 */
function MigLine({ tag, tagClass, was, now, pct, note }: {
  tag?: string | null;
  tagClass?: string;
  was?: string | null;
  now?: string | null;
  pct?: string | null;
  note?: string | null;
}) {
  if (!tag && !was && !note) return null;
  return (
    <div className="mig">
      {tag && <span className={`mtag ${tagClass ?? ""}`}>{tag}</span>}
      {was && (
        <span className="mono">
          was {was}
          {now && <><span className="arw"> → </span><span className="now">{now}</span></>}
          {pct && <> · {pct}</>}
        </span>
      )}
      {note && <span className="mono">{note}</span>}
    </div>
  );
}

/**
 * State word for a WALL's gamma change.
 *
 * Read on magnitude, not sign, because a put wall's gamma is negative: −39.2M
 * from −37.0M is the wall getting HEAVIER, and calling that "down" because the
 * number fell would invert the only thing the tag is for. `strong`/`weak` are
 * the caller's words for "more of what this wall is" / "less".
 */
function wallState(d: GexDelta | null | undefined, strong: string, weak: string):
  { text: string; cls: string } | null {
  if (!d) return null;
  if (d.flipped) return { text: "flipped sign", cls: "flipt" };
  const grew = Math.abs(d.now) - Math.abs(d.was);
  // Under 2% either way is noise on a re-priced chain, not a migration.
  if (d.pct != null && Math.abs(d.pct) < 2) return { text: "unchanged", cls: "" };
  return grew >= 0
    ? { text: strong, cls: strong === "deepening" ? "down" : "up" }
    : { text: weak, cls: "warnt" };
}

/** The live per-strike number on a given Key Levels basis. */
function liveLeg(row: ChainRow, basis: LvlBasis, spot: number): number {
  if (basis === "vol") return netGEXOf(row, "vol", spot);
  if (basis === "oivol") return netGEXOf(row, "net", spot);
  return oiLeg(row, spot);
}

/**
 * The prior-close per-strike map on a given basis, or null when this baseline
 * cannot honestly answer for that basis.
 *
 * Null is the important case. `byStrike` is on whatever basis the fetch asked
 * for (`oi`), so on the VOL and OI+VOL tabs it is the WRONG map — using it
 * would print a Δ that is entirely basis mismatch. When the server predates
 * the per-strike legs, those two tabs get null and the tiles say "no baseline
 * on this basis" instead of a plausible wrong number.
 */
function basisMap(b: Baseline | null, basis: LvlBasis): Record<string, number> | null {
  if (!b) return null;
  const oi = b.byStrikeOi;
  const vol = b.byStrikeVol;
  if (basis === "oi") return oi ?? (b.basis === "oi" ? b.byStrike : null);
  if (!oi || !vol) return null;
  if (basis === "vol") return vol;
  const sum: Record<string, number> = {};
  for (const k of Object.keys(oi)) sum[k] = (oi[k] ?? 0) + (vol[k] ?? 0);
  return sum;
}

// ─────────────────────────────────────────────────────────────────────────────
//  page
// ─────────────────────────────────────────────────────────────────────────────

type Quote = {
  symbol: string; last: number | null; change: number | null; pct: number | null;
  /** Yahoo's `prev-close`. SPX carries it so the recap never has to shift ES. */
  prevClose: number | null;
};
type SectorBar = { symbol: string; name: string; chg5d: number | null };

export default function Premarket() {
  // ── ET clock ───────────────────────────────────────────────────────────────
  // Every "is it before the open / after the settle" question on this page is
  // asked of this, and the SESSION PICKER below needs today's date before the
  // data source is chosen — which is why the clock leads the component instead
  // of sitting next to the quotes it used to live beside.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const { date: etDate, minutes: etMin } = etWall(clock);

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
  // selected, so the SPX feed keeps flowing while you read NVDA and switching
  // back is instant with no reconnect. That costs nothing extra — gexSocket is
  // one refcounted connection shared with the toolbar and every other consumer,
  // and it would stay open for them anyway. useChainGex's poll is keyed on
  // `sym` and disabled entirely while SPX is on screen, so at most one chain is
  // being polled at a time no matter how many symbols the picker offers.
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

  // ── KEY LEVELS BASIS ───────────────────────────────────────────────────────
  // OI is the default and the honest premarket answer (see LvlBasis). Persisted
  // in localStorage rather than sessionStorage — unlike the pre/post tab, which
  // the clock should be free to pick each morning, a basis preference is a way
  // of reading the board and should survive the session.
  const [lvlBasis, setLvlBasis] = useState<LvlBasis>("oi");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LVL_BASIS_KEY) as LvlBasis | null;
      if (saved && saved in LVL_BASIS_META) setLvlBasis(saved);
    } catch { /* private mode — OI it is */ }
  }, []);
  const pickLvlBasis = useCallback((v: LvlBasis) => {
    setLvlBasis(v);
    try { localStorage.setItem(LVL_BASIS_KEY, v); } catch { /* nothing to do */ }
  }, []);

  // ── SESSION DATE ───────────────────────────────────────────────────────────
  // Today is the live page and the default. An earlier entry shows that session
  // in one of two ways, and which one it gets depends on what was stored:
  //
  //   a FROZEN date — premarket_freeze has that session's captured chain, so
  //     both tabs open for real, off that day's own book. This is the point of
  //     the picker and it covers every session since the freeze recorder
  //     shipped.
  //   an OLDER date — no capture exists and none can be manufactured, so it
  //     falls back to HistoricalRecap: the settled per-day stores, the wall log
  //     and the ES range. Less, but true.
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
  // Flags only — no payloads — so the option list can mark which dates open the
  // real tabs. One small request, cached for a minute.
  const { byDate: freezeByDate } = useFreezeDates(SESSION_COUNT);
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
  // Frozen sessions are SPX only (the freeze captures the one symbol the socket
  // carries), so stepping back onto a past date from any chain-poll board lands
  // on SPX rather than on a disabled option with the wrong page behind it. The
  // sessionStorage choice is left alone: it is what today comes back to.
  useEffect(() => {
    if (sessionDate !== etDate && sym !== "SPX") setSym("SPX");
  }, [sessionDate, etDate, sym]);
  const isHistorical = sessionDate !== etDate;

  // ── DATA SOURCE: live, or a frozen past session ────────────────────────────
  // This is THE swap, and it is the only one. Everything below this line — every
  // memo, every panel, both tabs — reads the destructured values and cannot tell
  // which side they came from. That is deliberate and it is what makes a frozen
  // date the REAL page rather than a second implementation of it: there is no
  // historical rendering path to drift out of step with the live one.
  //
  // The freeze stores INPUTS (see the recorder's header), so the walls, CORE,
  // max pain, expected move, DEX/vanna, premium and the written-vs-traded split
  // on a frozen date are all recomputed here, now, by the same code that runs
  // live. Only the numbers going in are old.
  const liveGex = useMobileGex("oi-vol");
  /**
   * The chain-poll board — the third source, and the one that lets every
   * non-SPX symbol render this page instead of a cut-down one. Disabled while
   * SPX is on screen (the socket is already carrying it) and on a historical
   * date (those are SPX-only), so at most one chain is being polled at a time.
   * See chainGex.ts for why this is REST and not a second socket subscription.
   */
  const chainGex = useChainGex(sym, sym !== "SPX" && !isHistorical);
  const { pre: freezePre, post: freezePost, state: freezeState } =
    useSessionFreeze(sessionDate, isHistorical);

  // Each tab gets its OWN capture: 'pre' is the 09:10-09:29 map, 'post' the
  // 16:05 settle. Showing the settle under a Premarket Prep header would be the
  // same lie as showing today's chain under a past date.
  const frozenPre = useMemo(() => frozenGexOf(freezePre, sessionDate), [freezePre, sessionDate]);
  const frozenPost = useMemo(() => frozenGexOf(freezePost, sessionDate), [freezePost, sessionDate]);
  // A session that only captured one slot still opens that one — better a
  // Post-Market tab on a day the morning was missed than neither.
  const frozenGex = tab === "post" ? (frozenPost ?? frozenPre) : (frozenPre ?? frozenPost);
  /** True when the chosen date has a capture the page can actually render. */
  const frozen = isHistorical && !!frozenGex;

  const gex = frozen && frozenGex ? frozenGex : sym === "SPX" ? liveGex : chainGex;
  const {
    chain, spot, flip, callWall, putWall, totalNetGex,
    esFut, basis, expiry, isZeroDte, connected, hasData, updatedAt, source,
  } = gex;

  // ── overnight session ──────────────────────────────────────────────────────
  // Live: the rolling ~30h window off the socket. Frozen: that session's ES bars
  // plus the PRIOR session's, because the overnight range, the prior RTH high
  // and low and the prior 16:00 close all live in the day before the one on
  // screen. Both hooks always run — calling one conditionally would break the
  // hook order — and the dated one no-ops unless it is needed.
  //
  // historyDays 8, not 3 (2026-08-24). `daysBack` is CALENDAR days, and the two
  // things below need the prior TRADING session — which on a Monday is three
  // calendar days back and on a Tuesday after a Monday holiday is four. A 3 sat
  // exactly on the Monday boundary and fell off it entirely after a holiday.
  // With withAverages=false the extra sessions cost one larger read and no
  // recompute at all.
  const { sessionCandles: liveCandles, historical: liveHistory } =
    useEsCandles(true, 8, 5, false);
  const { rows: datedCandles } = useDatedEsCandles(sessionDate, frozen);
  /**
   * The non-SPX overnight series. Same record shape as the ES bars (that is the
   * whole point of useEtfCandles), read from `etf_candles` — which since the
   * 2026-08-27 recorder split covers the MAIN watchlist on the hot lane, with a
   * live dxLink fallback server-side for anything the table has not written
   * yet. Empty symbol = the hook is off, which is how SPX turns it off.
   *
   * 8 days, matching the ES call below and for the same reason: `daysBack` is
   * CALENDAR days and the prior TRADING session is three of them back on a
   * Monday, four after a holiday.
   */
  const { rows: symCandles } = useEtfCandles(sym === "SPX" ? "" : sym, 8, 5);

  /**
   * The pool `overnight` reads — deliberately NOT the hook's clipped
   * `sessionCandles`.
   *
   * `sessionCandles` is clipped to a rolling 30 HOURS (useEsCandles), which was
   * the right window for a chart and the wrong one for the prior RTH close: on
   * a Monday premarket the Friday 16:00 bar is ~64h old, so it is not in there,
   * `pdc` came back null, and "Prior RTH close (ES)", "Gap" and "Gap fill
   * target" all printed "—" every Monday (and every day after a holiday).
   *
   * `historical` is the same hook's un-clipped DB read, so the union covers the
   * prior session however far back it is. The clipped array is no longer bound
   * at all: it existed to hand ES bars to the Post-Market tab, and that tab
   * takes no ES prop any more.
   *
   * Not de-duplicated and not sorted, on purpose. Everything `overnight` does
   * with this is a min / max / latest-timestamp scan, and all three are
   * idempotent under duplicates — so a slot present in both arrays costs
   * nothing, while a Map+sort here would run at the live feed's 4Hz over ~8
   * sessions of bars for no benefit at all.
   */
  const candlePool = useMemo(
    () => (frozen ? datedCandles
      : sym !== "SPX" ? symCandles
        : liveHistory.length ? [...liveHistory, ...liveCandles] : liveCandles),
    [frozen, datedCandles, sym, symCandles, liveHistory, liveCandles]);

  /**
   * The session the page DESCRIBES. Live it is today; frozen it is the picked
   * date. Everything dated downstream — the overnight window's idea of "today",
   * the wall log, the journal, the baseline — keys off this rather than the
   * clock, which is the one change that lets a past session render correctly.
   */
  const viewDate = frozen ? sessionDate : etDate;
  /**
   * ...and the minute of that session. A frozen day is over, so it reads as
   * just past the settle: that is what puts the Post-Market tab into its
   * finished state instead of a mid-session one.
   */
  const viewMin = frozen ? RTH_CLOSE_MIN + 10 : etMin;

  // ── catalysts ──────────────────────────────────────────────────────────────
  const { events, earnByDate, now: calNow } = useEconCalendar({ withQuote: false });

  // ── quotes + market quality ────────────────────────────────────────────────
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [sectors, setSectors] = useState<SectorBar[] | null>(null);
  const [mqScore, setMqScore] = useState<{ score: number; decision: string } | null>(null);

  const loadQuotes = useCallback(async () => {
    try {
      // SPX is in the batch for ONE reason: the Post-Market recap needs SPX's
      // own prior close. It used to take the ES prior close and subtract the
      // live basis, which is not an SPX price and on one session produced a
      // "BROKE THE PUT WALL" card off a low SPX never traded. The route already
      // maps SPX → ^GSPC (server-v2/api-router.js), so this is one more symbol
      // on a call the page was making anyway — no new endpoint, no new poll.
      // …and the SYMBOL ON SCREEN, for exactly the same reason: the recap needs
      // that symbol's own prior close, and the Spot tile its day change. The
      // route maps SPX → ^GSPC / VIX → ^VIX / NDX → ^NDX and passes an equity
      // ticker straight through, so this stays one call however the picker
      // moves. ES/NQ/VIX stay in the batch on every symbol — they are market
      // context, not SPX trivia, and the panel that prints them is unchanged.
      const extra = ["SPX", "/ES", "/NQ", "VIX"].includes(sym) ? "" : `,${sym}`;
      const r = await fetch(`/api/quotes-batch?symbols=SPX,/ES,/NQ,VIX${extra}`, { cache: "no-store" });
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
          prevClose: it["prev-close"] ?? null,
        };
      }
      setQuotes(map);
    } catch { /* keep last good */ }
  }, [sym]);

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

  /**
   * `asOf` is the session the page is showing. Live it is omitted and the route
   * defaults to today; frozen it is passed as `today=`, which the route already
   * understands — it walks back from that date to find the prior settled
   * session. Without it a frozen Tuesday would be diffed against last night's
   * close, and the "vs prior close" chip would be measuring the wrong gap
   * entirely while looking perfectly normal.
   */
  const loadBaseline = useCallback(async (exp: string, symbol: string, asOf?: string) => {
    const gen = ++baselineGen.current;
    setBaselineState("loading");
    try {
      const r = await fetch(
        `/api/premarket-baseline?expiry=${encodeURIComponent(exp)}&basis=oi` +
          `&symbol=${encodeURIComponent(symbol)}` +
          (asOf ? `&today=${encodeURIComponent(asOf)}` : ""),
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
    // Clear first: a stale baseline for the PREVIOUS expiry — or, now, the
    // previous SYMBOL — would silently diff today's chain against the wrong
    // board. Same strikes, plausible numbers, nothing on screen naming it.
    setBaseline(null);
    void loadBaseline(expiry, sym, frozen ? viewDate : undefined);
  }, [expiry, sym, loadBaseline, frozen, viewDate]);

  // ── derived from the chain ─────────────────────────────────────────────────
  const perStrike = useMemo(() => {
    if (!chain.length || !(spot > 0)) return [];
    return chain
      .map((r) => ({ strike: r.strike, net: netGEXOf(r, "net", spot) }))
      .filter((r) => Number.isFinite(r.net))
      .sort((a, b) => a.strike - b.strike);
  }, [chain, spot]);

  /**
   * ── SCALE ──────────────────────────────────────────────────────────────────
   * Everything below used to be written for SPX, where a level is a whole
   * number, a "point" is ~0.015% of price and 10 points is a pin. None of that
   * survives contact with a $180 name: `fmtPx(strike, 0)` turns a 187.50 strike
   * into "188", and a 1-point threshold that means "noise" on SPX means 0.6% on
   * NVDA — the difference between "flat overnight" and a real gap.
   *
   * So three values are derived from the board itself and used everywhere a
   * literal used to be. On SPX they evaluate to exactly what was hard-coded, so
   * the SPX page is unchanged to the digit.
   */
  /** Strike/level decimals — read off the ladder's own step. */
  const kDp = useMemo(() => {
    let step = Infinity;
    for (let i = 1; i < perStrike.length; i++) {
      const d = Math.abs(perStrike[i].strike - perStrike[i - 1].strike);
      if (d > 0 && d < step) step = d;
    }
    if (!Number.isFinite(step)) return spot >= 1000 ? 0 : 2;
    return step < 0.5 ? 2 : step < 1 ? 1 : 0;
  }, [perStrike, spot]);
  /** Traded-price decimals. SPX/NDX print whole; anything under 1000 prints cents. */
  const pxDp = spot >= 1000 ? 0 : 2;
  /**
   * One "point" on THIS symbol, as a share of price rather than a literal.
   * 0.015% of spot is 1.0 on a 6,800 SPX — i.e. the constant it replaces — and
   * 0.03 on a $180 name, which is what "no move" actually looks like there.
   */
  const pxEps = Math.max(0.01, spot * 0.00015);
  /** "Pinned to the magnet" distance. 0.15% of spot ≈ the 10 SPX points it replaces. */
  const pinEps = Math.max(0.05, spot * 0.0015);
  /**
   * The live reference price for the gap and the overnight marker. SPX reads
   * the ES future because cash SPX does not trade overnight; every other symbol
   * trades its own extended session, so its own last IS the reference and
   * running it through a basis would be inventing a price.
   */
  const livePx = sym === "SPX" ? esFut : spot;

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

  /**
   * The per-strike number the Key Levels tiles print, on the SELECTED basis.
   *
   * Separate from `perStrike` (which is fixed at OI+Vol) on purpose: the bars,
   * the rail and the magnet must not move when the tiles' basis changes — they
   * are documented as OI+Vol everywhere else on this page and in the profile's
   * own header. This map exists only for the six tiles and their Δ.
   */
  const lvlByStrike = useMemo(() => {
    const m = new Map<number, number>();
    if (!chain.length || !(spot > 0)) return m;
    for (const r of chain) {
      const v = liveLeg(r, lvlBasis, spot);
      if (Number.isFinite(v)) m.set(r.strike, v);
    }
    return m;
  }, [chain, spot, lvlBasis]);

  const wallGex = useMemo(() => {
    const at = (k: number | null | undefined) =>
      k == null ? null : lvlByStrike.get(k) ?? null;
    return { call: at(callWall), put: at(putWall) };
  }, [lvlByStrike, callWall, putWall]);

  /**
   * OPTION-B MIGRATION — the "was" line each Key Levels tile carries.
   *
   * One memo, six tiles, so every tile is answering the same question against
   * the same baseline on the same basis. Everything here is null-safe by
   * construction: `null` anywhere means "we cannot say", and the tile renders
   * no migration line at all rather than a zero or a dash that reads as a real
   * measurement of no change.
   *
   * WHAT EACH TILE CAN AND CANNOT SAY
   *   callWall / putWall  strike moved (baseline.callWall/putWall) AND the
   *                       gamma at the CURRENT strike re-priced (byStrike).
   *   flip                strike only. The baseline's flip is OI+Vol on the
   *                       server regardless of basis (documented there), so it
   *                       is shown on every tab and labelled as a level move,
   *                       never as a gamma Δ.
   *   spot                prior settle, from baseline.spot — the overnight gap.
   *   magnet              gamma at the magnet strike, incl. a sign flip, which
   *                       is the single most useful thing a magnet can tell you
   *                       overnight (a +γ pin that went −γ is now a launch pad).
   *   maxPain             NOTHING. Max pain needs per-side OI, and the baseline
   *                       stores net GEX per strike. Deriving it from what we
   *                       have would be an invention, so the tile keeps its
   *                       existing drift pill and gains no "was".
   */
  const migration = useMemo(() => {
    const base = basisMap(baseline, lvlBasis);
    const none = {
      available: false, basisHasBaseline: false,
      callWall: null, putWall: null, flip: null, spot: null, magnet: null,
    } as const;
    if (!baseline) return none;

    /** Δ at ONE strike, both sides on `lvlBasis`. */
    const at = (k: number | null | undefined) => {
      if (k == null || !base) return null;
      const was = base[String(k)];
      const now = lvlByStrike.get(k);
      if (was == null || now == null || !Number.isFinite(was) || !Number.isFinite(now)) return null;
      const delta = now - was;
      // Percent is meaningless off a ~zero base (the VOL tab premarket is all
      // zeros), so it is omitted rather than printed as a huge bogus number.
      const pct = Math.abs(was) > 1e6 ? (delta / Math.abs(was)) * 100 : null;
      return { was, now, delta, pct, flipped: (was >= 0) !== (now >= 0) };
    };

    /** How far a LEVEL moved overnight, in points. */
    const moved = (was: number | null | undefined, now: number | null | undefined) =>
      was == null || now == null || !Number.isFinite(was) || !Number.isFinite(now)
        ? null : { was, now, move: now - was };

    return {
      available: true,
      basisHasBaseline: !!base,
      callWall: { gex: at(callWall), px: moved(baseline.callWall, callWall) },
      putWall:  { gex: at(putWall),  px: moved(baseline.putWall, putWall) },
      flip:     moved(baseline.flip, flip),
      spot:     moved(baseline.spot, spot > 0 ? spot : null),
      magnet:   magnet ? at(magnet.strike) : null,
    };
  }, [baseline, lvlBasis, lvlByStrike, callWall, putWall, flip, spot, magnet]);

  /**
   * DEX / vanna / call-put gamma, summed over the chain on screen.
   *
   * `vanna` is NULLABLE and that is the point. It is the one greek the page
   * cannot recompute: netVanna/netVolVanna are published per strike by
   * server-v2/computation/vex-chex.js off a per-contract vanna, and a chain
   * that does not carry one has no vanna — not a vanna of zero. Summing
   * `?? 0` across such a chain printed a confident "$0" that read as "vanna
   * nets out here" when it meant "we were never told". Null renders "—", the
   * same as every other underivable number on this page.
   *
   * DEX needs no such caveat: netDEXOf falls back to calculateNetDEX, which
   * rebuilds it from the raw signed deltas by the same formula the server uses
   * (delta × contracts × spot × 100, put deltas already negative), so it is the
   * same number either way.
   */
  const totals = useMemo(() => {
    let dex = 0, vanna = 0, cg = 0, pg = 0;
    let anyVanna = false;
    for (const r of chain) {
      dex += netDEXOf(r, "net", spot);
      if (r.netVanna != null || r.netVolVanna != null) {
        anyVanna = true;
        vanna += (r.netVanna ?? 0) + (r.netVolVanna ?? 0);
      }
      cg += callGEXOf(r, "net", spot);
      pg += putGEXOf(r, "net", spot);
    }
    return { dex, vanna: anyVanna ? vanna : null, callGex: cg, putGex: pg };
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
  // "today" here is the session BEING SHOWN, not the wall clock: on a frozen
  // date the bars are that day's and the day before's, and reading the clock
  // would make every one of them "before today" and the whole window empty.
  const overnight = useMemo(() => {
    if (!candlePool.length) return null;
    const today = viewDate;
    const minOf = (slotKey: string) => {
      const hm = slotKey.slice(11, 16);
      const [h, m] = hm.split(":").map(Number);
      return Number.isFinite(h) ? h * 60 + (m || 0) : -1;
    };

    /**
     * TWO prior dates, because on a Monday they are not the same day.
     *
     *   pdDate  the last session before today that actually TRADED RTH — Friday
     *           on a Monday, Thursday after a Friday holiday. "Prior RTH close"
     *           and "prior day range" mean this one, and nothing else.
     *   evDate  the last date before today carrying a Globex evening (>=18:00)
     *           bar — SUNDAY on a Monday. That is where the overnight session on
     *           screen actually began.
     *
     * This used to be one `pdDate` = "latest date before today with any bar",
     * plus an overnight test of `d < today && mins >= 18:00`. Inside a 30-hour
     * window those collapse to the same thing and it worked; over a weekend they
     * do not, and the single date landed on SUNDAY — which has no RTH bars at
     * all, so pdHi/pdLo/pdc stayed null and the gap rows went blank.
     */
    const EVENING_MIN = 18 * 60;
    let pdDate = "", evDate = "";
    for (const c of candlePool) {
      const d = c.date ?? c.slotKey.slice(0, 10);
      if (!d || d >= today) continue;
      const mins = minOf(c.slotKey);
      if (mins < 0) continue;
      if (mins >= RTH_OPEN_MIN && mins < RTH_CLOSE_MIN && d > pdDate) pdDate = d;
      if (mins >= EVENING_MIN && d > evDate) evDate = d;
    }

    let hi = -Infinity, lo = Infinity;          // overnight (18:00 -> 09:30)
    let pdHi = -Infinity, pdLo = Infinity;      // prior RTH range
    let pdc: number | null = null, pdcTs = -1;  // prior 16:00 close
    let openPx: number | null = null;           // today's 09:30 open
    let rthHi = -Infinity, rthLo = Infinity;    // today's RTH so far

    for (const c of candlePool) {
      const d = c.date ?? c.slotKey.slice(0, 10);
      const mins = minOf(c.slotKey);
      if (mins < 0) continue;

      // Pinned to evDate rather than "any earlier date", so the wider pool
      // cannot fold FRIDAY evening into a Monday overnight range.
      if ((d === today && mins < RTH_OPEN_MIN)
        || (!!evDate && d === evDate && mins >= EVENING_MIN)) {
        if (c.high > hi) hi = c.high;
        if (c.low < lo) lo = c.low;
      }
      if (!!pdDate && d === pdDate && mins >= RTH_OPEN_MIN && mins < RTH_CLOSE_MIN) {
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
      /** Which session "prior close" came from — surfaced next to the number. */
      pdDate: pdDate || null,
    };
  }, [candlePool, viewDate]);

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
  /**
   * Below this there is no gap to talk about. Was a flat 0.25 — one ES tick —
   * which on a $30 name is a 0.8% move being called "flat". Scaled to price, it
   * is still ~0.27 on SPX.
   */
  const gapEps = Math.max(0.01, spot * 0.00004);

  const gap = useMemo(() => {
    const pdc = overnight?.pdc;
    if (pdc == null || !(pdc > 0)) return null;
    const openPx = overnight?.openPx ?? null;
    const projected = openPx == null;
    const ref = openPx ?? (livePx > 0 ? livePx : null);
    if (ref == null) return null;

    const pts = ref - pdc;
    const pct = (pts / pdc) * 100;
    const flat = Math.abs(pts) < gapEps;
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
    const last = livePx > 0 ? livePx : ref;
    const remaining = filled ? 0 : pdc - last;

    const pd = overnight?.pd ?? null;
    const outside = pd ? ref > pd.hi || ref < pd.lo : null;

    return { pts, pct, projected, flat, up, filled, retrace, remaining, outside, openPx, pdc, pd };
  }, [overnight, livePx, gapEps]);

  // ── catalysts for the session on screen ────────────────────────────────────
  // Keyed to viewDate, so a frozen date asks for THAT day's catalysts. The
  // calendar hook fetches a forward window, so a date far enough back simply
  // has none and the panel shows nothing — which is the honest answer, and much
  // better than printing today's Fed speakers next to last Tuesday's chain.
  const todayEvents = useMemo(() => {
    return events
      .filter((e) => e.date === viewDate && e.country === "USD" && (e.impact === "High" || e.impact === "Medium" || e.impact === "President"))
      .slice(0, 4);
  }, [events, viewDate]);

  const todayEarnings = useMemo(() => {
    const b = earnByDate.get(viewDate);
    if (!b) return [];
    return [...b.pre, ...b.after]
      .sort((a, z) => (z.market_cap ?? 0) - (a.market_cap ?? 0))
      .slice(0, 2);
  }, [earnByDate, viewDate]);

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

  // etDate / etMin are computed at the top of the component now — the session
  // picker needs them before the data source is chosen.
  const toOpen = RTH_OPEN_MIN - viewMin;
  const openLabel =
    frozen ? "session closed"
      : toOpen > 0 ? `RTH open in ${Math.floor(toOpen / 60)}h ${String(toOpen % 60).padStart(2, "0")}m`
        : viewMin < RTH_CLOSE_MIN ? "RTH open" : "after the close";

  const esQ = quotes["/ES"], nqQ = quotes["/NQ"], vixQ = quotes["VIX"], spxQ = quotes["SPX"];
  /** The quote for the symbol on screen — SPX's own on the SPX board. */
  const symQ = sym === "SPX" ? spxQ : quotes[sym];
  /**
   * The ES print for the footbar. `esFut` rides the socket's `aux` frame and is
   * therefore 0 on the poll path; /api/quotes-batch is already pulling /ES on
   * every board for the "ES change" row, so the footer reads that rather than
   * printing a dash and making the strip a different shape per symbol.
   */
  const footEs = sym === "SPX" ? esFut : (esQ?.last ?? 0);

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
  /** The scrollTop WE last wrote — see onChartScroll. */
  const progTopRef = useRef(-1);
  const [pinned, setPinned] = useState(true);

  /**
   * Put the spot row in the middle of the panel. Returns FALSE when the layout
   * is not ready to be measured yet, so the caller can try again next frame.
   *
   * ── WHY THIS IS MEASURED AND NOT ARITHMETIC (2026-08-27) ───────────────────
   * It used to be `el.scrollTop = i * 19 + 9.5 - el.clientHeight / 2` — the row
   * height as a literal, and the panel's height read at the moment of the call.
   * Both are assumptions, and on a cold load both can be wrong:
   *
   *   · `el.clientHeight` is 0 until the panel has been laid out. A 0 there
   *     makes the target `i * 19 + 9.5`, which the browser clamps to the
   *     maximum scroll — so the card opened scrolled to the BOTTOM of the
   *     ladder instead of the middle of it, and stayed there.
   *   · 19 is `.pmk .row`'s height today. The two numbers have to be edited
   *     together and nothing says so.
   *
   * On the live SPX socket that was survivable: a new frame arrives about once
   * a second, `bars` changes identity, the effect below re-runs and the second
   * or third attempt lands after layout. On a CHAIN-POLL symbol the next
   * attempt is SIXTY SECONDS away, so the first bad centre is what you look at.
   * That is why this surfaced when the picker opened up to the watchlist.
   *
   * Now it reads the row element and centres on its real box, and reports
   * "not ready" instead of writing a nonsense scrollTop.
   */
  const centerOnSpot = useCallback((): boolean => {
    const el = chartRef.current;
    if (!el) return false;
    const i = bars.findIndex((b) => b.strike === spotStrike);
    if (i < 0) return false;
    const row = el.querySelectorAll<HTMLElement>(".row")[i];
    if (!row || el.clientHeight <= 0 || el.scrollHeight <= 0) return false;
    const target = Math.max(0, row.offsetTop - (el.clientHeight - row.offsetHeight) / 2);
    // Already there — do not write, so a stationary pinned panel never marks a
    // programmatic scroll it did not perform.
    if (Math.abs(el.scrollTop - target) <= 1) return true;
    progScrollRef.current = true;
    progTopRef.current = target;
    el.scrollTop = target;
    // The scroll event lands on the next frame, so the flag is cleared there.
    requestAnimationFrame(() => { progScrollRef.current = false; });
    return true;
  }, [bars, spotStrike]);

  /**
   * Centre while pinned — and keep trying until the panel can actually be
   * measured, rather than assuming the first attempt lands after layout.
   *
   * A ResizeObserver re-centres on every box change too: the panel is inside a
   * responsive grid, so a window resize (or the first paint settling) moves the
   * middle without changing `bars` at all.
   */
  useEffect(() => {
    if (!pinnedRef.current) return;
    let raf = 0;
    let tries = 0;
    const tick: () => void = () => {
      raf = 0;
      if (!pinnedRef.current) return;
      // ~20 frames is a third of a second — long enough for a cold mount, short
      // enough that a genuinely empty ladder stops asking.
      if (!centerOnSpot() && tries++ < 20) raf = requestAnimationFrame(tick);
    };
    tick();

    const el = chartRef.current;
    const ro = el && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => { if (pinnedRef.current) centerOnSpot(); })
      : null;
    if (el && ro) ro.observe(el);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [centerOnSpot]);

  const onChartScroll = useCallback(() => {
    if (progScrollRef.current) return;
    // Second guard, because the rAF above can win the race against the scroll
    // event on a slow frame: a scroll that lands exactly where WE put it is
    // ours, not a hand on the wheel. Without this the panel un-pinned itself on
    // its own centring write and never re-centred again.
    const el = chartRef.current;
    if (el && progTopRef.current >= 0 && Math.abs(el.scrollTop - progTopRef.current) <= 1) return;
    if (pinnedRef.current) { pinnedRef.current = false; setPinned(false); }
  }, []);

  const repin = useCallback(() => {
    pinnedRef.current = true;
    setPinned(true);
    centerOnSpot();
  }, [centerOnSpot]);

  /**
   * A new SYMBOL is a new ladder, so the panel goes back to centred on spot.
   * Without this, scrolling away on SPX and then picking NVDA left the new
   * board parked at whatever offset the old one was read at.
   */
  useEffect(() => {
    pinnedRef.current = true;
    setPinned(true);
    progTopRef.current = -1;
  }, [sym]);

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

  /**
   * "REST FALLBACK" is a warning on SPX — the socket went quiet and the page
   * dropped to polling. On a chain-poll symbol the poll IS the design, so it is
   * labelled as what it is rather than as a degraded socket.
   */
  const feedLabel = sym !== "SPX" && !frozen
    ? (connected ? "CHAIN POLL · 1m" : "CHAIN POLL · retrying")
    : source === "live" ? (connected ? "LIVE" : "RECONNECTING")
      : source === "rest" ? "REST FALLBACK" : "PAUSED";

  /**
   * A past date with NO capture. This — not `isHistorical` — is what disables
   * the two tabs, because a frozen date drives them perfectly well; only a date
   * with nothing stored has to fall back to HistoricalRecap.
   *
   * While the freeze request is still in flight the page waits rather than
   * flashing the recap: `freezeState === "loading"` is not yet an answer, and
   * rendering the fallback for 200ms and then swapping to the real tabs looks
   * exactly like a bug.
   */
  const recapOnly = isHistorical && !frozen && freezeState !== "loading";

  /** Said out loud when the tab on screen is not the slot it asked for. */
  const slotNote =
    tab === "post" && !frozenPost && frozenPre ? " — the settle capture is missing for this session, so this is the pre-open one"
      : tab === "pre" && !frozenPre && frozenPost ? " — the pre-open capture is missing for this session, so this is the settle one"
        : "";


  return (
    <div className="pmk" style={{ flex: 1, minHeight: 0 }}>
      <style dangerouslySetInnerHTML={{ __html: CSS + POSTMARKET_CSS + HISTORICAL_CSS + GEX_WATCH_CSS + GAMMA_BELL_CSS }} />
      <div className="wrap">

        <div className="pagehead">
          <h1>
            {recapOnly ? "Session Recap" : tab === "post" ? "Post-Market Recap" : "Premarket Prep"}
          </h1>
          {/* SYMBOL PICKER — a select, not the pill row it replaced. MAIN is
              fourteen names; fourteen pills push the session picker and the
              pre/post tabs onto a second row on anything narrower than a wide
              desktop, and the head stops reading as one strip. It borrows the
              session picker's `.dsel` shell for exactly that reason, so the two
              one-of-many controls in this head look like one another.

              SPX only on a frozen session: the freeze captures the one symbol
              the socket carries, and a chain poll has no per-date form — there
              is no stored NVDA chain for last Tuesday to render. Disabling the
              options beats rendering an SPX page under an NVDA label. */}
          <span className="dsel">
            <select
              value={sym}
              onChange={(e) => pickSym(e.target.value)}
              title={frozen
                ? "Frozen sessions are SPX only"
                : "Which symbol to show. SPX is the live-socket board; every other MAIN name is a one-minute chain poll."}
              aria-label="Symbol"
            >
              {SYMBOLS.map((s2) => (
                <option key={s2} value={s2} disabled={frozen && s2 !== "SPX"}>
                  {s2}
                </option>
              ))}
            </select>
          </span>
          <span className="badge-concept">
            {recapOnly
              ? `${sym} · RECORDED · ${sessionLabel(sessionDate)}`
              : frozen
                ? `${isZeroDte ? "0DTE" : "FRONT"} ${expiry || "—"} · FROZEN ${sessionLabel(sessionDate)}`
                : sym === "SPX"
                  ? `${isZeroDte ? "0DTE" : "FRONT"} ${expiry || "—"} · ${feedLabel} · ${openLabel}`
                  : `${sym} · CHAIN POLL · ${openLabel}`}
          </span>
          <span className={`dsel${isHistorical ? " past" : ""}`} style={{ marginLeft: "auto" }}>
            <select
              value={sessionDate}
              onChange={(e) => pickDate(e.target.value)}
              title="Which session to show. Today is live; a dot marks the dates whose captured chain can drive the full Premarket and Post-Market tabs."
              aria-label="Session date"
            >
              {sessions.map((d) => (
                <option key={d} value={d}>
                  {/* A leading dot marks a session with a capture, so the list
                      says which dates open the real tabs before you click one.
                      A plain bullet rather than an icon: the OS draws this menu
                      and nothing but text survives the trip. */}
                  {d === etDate
                    ? `Today · ${sessionLabel(d)}`
                    : `${freezeByDate.has(d) ? "• " : "  "}${sessionLabel(d)}`}
                </option>
              ))}
            </select>
          </span>
          <div className="tabs">
            {/* Both tabs stay LIVE on a frozen date — that is the whole point of
                the capture. They only go dead on a date with no capture, where
                there is no chain to render either tab from. */}
            <button
              className={!recapOnly && tab === "pre" ? "on" : ""}
              disabled={recapOnly}
              title={recapOnly ? "No captured chain for this session — showing the recorded recap instead" : undefined}
              style={recapOnly ? { opacity: .4, cursor: "not-allowed" } : undefined}
              onClick={() => pickTab("pre")}
            >
              Premarket
            </button>
            <button
              className={!recapOnly && tab === "post" ? "on" : ""}
              disabled={recapOnly}
              title={recapOnly ? "No captured chain for this session — showing the recorded recap instead" : undefined}
              style={recapOnly ? { opacity: .4, cursor: "not-allowed" } : undefined}
              onClick={() => pickTab("post")}
            >
              <span className="tdot" style={{ background: frozen ? "var(--violet)" : afterClose ? "var(--blue)" : "var(--off)" }} />
              Post-Market
            </button>
          </div>
        </div>

        {frozen && (
          <div className="frozenbar">
            <b>Frozen session — {sessionLabel(sessionDate)}.</b> Every number below is computed from
            that day&apos;s captured chain by the same code the live page runs
            {tab === "post"
              ? ", captured at the 16:05 settle"
              : ", captured just before the 09:30 open"}
            {slotNote}. Nothing here is live.
          </div>
        )}

        {recapOnly ? (
          /* No capture for this date, and none can be manufactured: nothing
             stores per-strike marks and volume for a past session, so both tabs
             would have to invent the chain they render. HistoricalRecap shows
             the per-date stores that DO go back instead. */
          <HistoricalRecap date={sessionDate} symbol={sym} />
        ) : tab === "post" ? (
          <PostMarketTab
            /* The recap runs for every symbol now — same component, same
               panels, that symbol's own recorded ladder, price path and wall
               log. `symbol` is what routes all three; it is not a label. */
            symbol={sym}
            spot={spot}
            /* The symbol's OWN prior close, from /api/quotes-batch. The recap
               takes no ES prop at all — a futures price run through a basis is
               not a cash price, and doing that is what once graded a put wall
               BROKEN off a low SPX never traded. See PostMarketTab's header. */
            prevClose={symQ?.prevClose ?? null}
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
            expiry={expiry || ""}
            etDate={viewDate}
            etMin={viewMin}
            hasData={hasData}
            frozenDate={frozen ? sessionDate : undefined}
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
                {fmtPx(flip, kDp)}{" "}
                <small className={distFlip == null ? undefined : distFlip >= 0 ? "chg-pos" : "chg-neg"}>
                  {distFlip == null ? "" : `${fmtPts(distFlip)} / ${fmtPct((distFlip / spot) * 100)}`}
                </small>
              </div>
            </div>
            <div className="vr" />
            <div className="kpi">
              {/* ES only where an ES exists. On every other symbol this is the
                  ticker's own last and its day change — not a futures price
                  shifted by a basis, which would be a price that never traded. */}
              <div className="k">{sym === "SPX" ? "SPX / ES" : sym}</div>
              <div className="v mono">
                {fmtPx(spot, pxDp)}{" "}
                {sym === "SPX"
                  ? <small>· ES {fmtPx(esFut, 2)}</small>
                  : <small className={(symQ?.change ?? 0) >= 0 ? "chg-pos" : "chg-neg"}>
                      {symQ?.pct != null ? fmtPct(symQ.pct) : "·"}
                    </small>}
              </div>
            </div>
            <div className={`bias${posGamma ? "" : " neg"}`}>
              <div className="t">{posGamma ? "Range day — fade the walls" : "Trend day — follow the breaks"}</div>
              <div className="d">
                {distFlip == null ? "Flip unavailable — no crossing in the current chain."
                  : `${distFlip >= 0 ? "Above" : "Below"} flip by ${nf(Math.abs(distFlip), pxDp)} pts. ${posGamma
                    ? `Suppression regime until ${fmtPx(flip, kDp)} breaks.`
                    : `Acceleration regime until ${fmtPx(flip, kDp)} is reclaimed.`}`}
              </div>
            </div>
          </div>

          {/* ── 1b. GEX LEVEL RAIL — every level on one axis ───────────────── */}
          <div className="gexrail">
            <div className="rh">
              <h3>GEX Levels · one axis</h3>
              <span className="tiny">
                {rail
                  ? `${fmtPx(rail.lo, kDp)} – ${fmtPx(rail.hi, kDp)} · ${nf(rail.span, pxDp)} pts`
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
                      <div className="v2 mono">{fmtPx(m.px, kDp)}</div>
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
          {/* Head names the basis the six tiles are on and what their "was"
              line is measured against. Both must be on screen: the tiles change
              meaning with the switch, and a Δ with no stated baseline is not a
              number anyone can act on. */}
          <div className="lvlhead">
            <div className="lh">
              <h3>Key Levels</h3>
              <span className={`vs${migration.available && !migration.basisHasBaseline ? " warn" : ""}`}>
                {!baseline
                  ? (baselineState === "loading" || baselineState === "idle"
                      ? "prior-close baseline loading…"
                      : "no prior-close baseline — levels only")
                  : !migration.basisHasBaseline
                    ? `no prior-close baseline on the ${LVL_BASIS_META[lvlBasis].long} basis — levels only`
                    : <>vs <b>{baseline.date}</b> close · {LVL_BASIS_META[lvlBasis].long} basis</>}
              </span>
            </div>
            <div className="seg" role="group" aria-label="Key levels basis">
              {(Object.keys(LVL_BASIS_META) as LvlBasis[]).map((b) => (
                <button
                  key={b}
                  type="button"
                  className={lvlBasis === b ? "on" : ""}
                  aria-pressed={lvlBasis === b}
                  title={LVL_BASIS_META[b].hint}
                  onClick={() => pickLvlBasis(b)}
                >
                  {LVL_BASIS_META[b].tab}
                </button>
              ))}
            </div>
          </div>

          <div className="levels">
            <div className="lvl call">
              <div className="name">Call Wall <em>resistance</em></div>
              <div className="px mono">{fmtPx(callWall, kDp)}</div>
              <div className="es mono">
                {es(callWall) != null ? `ES ${fmtPx(es(callWall), 0)} · ` : ""}{fmtUsd(wallGex.call, false)}
              </div>
              <div className="dist">
                <span className={`mono ${distCall != null && distCall >= 0 ? "chg-pos" : "chg-neg"}`}>{fmtPts(distCall)}</span>
                {overnight?.hi != null && callWall != null && basis != null && overnight.hi >= callWall + basis
                  ? <span className="pill hot">ON high tagged</span>
                  : <span className="pill">untested o/n</span>}
              </div>
              {/* A wall that BUILT overnight is one dealers have to defend; one
                  that eroded is a level with nothing behind it. That is the
                  whole reason this line exists — the strike alone cannot say it. */}
              {(() => {
                const m = migration.callWall;
                if (!m || (!m.gex && !m.px)) return null;
                const st = wallState(m.gex, "building", "eroding");
                return (
                  <MigLine
                    tag={st?.text}
                    tagClass={st?.cls}
                    was={m.gex ? fmtUsd(m.gex.was, false) : null}
                    now={m.gex ? fmtUsd(m.gex.now, false) : null}
                    pct={m.gex?.pct != null ? fmtPct(m.gex.pct, 0) : null}
                    note={m.px && Math.abs(m.px.move) >= pxEps
                      ? `wall moved ${fmtPts(m.px.move)} from ${fmtPx(m.px.was, kDp)}`
                      : null}
                  />
                );
              })()}
            </div>

            <div className="lvl magnet">
              <div className="name">0DTE Magnet <em>max γ</em></div>
              <div className="px mono">{magnet ? fmtPx(magnet.strike, kDp) : "—"}</div>
              <div className="es mono">
                {magnet && es(magnet.strike) != null ? `ES ${fmtPx(es(magnet.strike), 0)} · ` : ""}
                {/* Value on the SELECTED basis; the STRIKE stays the OI+Vol pick
                    so the magnet does not jump around as you switch tabs — it is
                    a structural choice (biggest |γ| in the near window), not a
                    reading of one leg. */}
                {magnet ? fmtUsd(lvlByStrike.get(magnet.strike) ?? magnet.net, false) : "—"}
              </div>
              <div className="dist">
                <span className="mono">{magnet ? fmtPts(magnet.strike - spot) : "—"}</span>
                <span className="pill">{magnet && Math.abs(magnet.strike - spot) <= pinEps ? "pinning" : "magnet"}</span>
              </div>
              {/* A magnet that changed SIGN overnight is the single most useful
                  thing this tile can report: a +γ pin that went −γ stopped being
                  a magnet and became a launch pad. */}
              {migration.magnet && (
                <MigLine
                  tag={migration.magnet.flipped
                    ? (migration.magnet.now >= 0 ? "flipped +γ" : "flipped −γ")
                    : (Math.abs(migration.magnet.now) >= Math.abs(migration.magnet.was) ? "building" : "eroding")}
                  tagClass={migration.magnet.flipped
                    ? "flipt"
                    : (Math.abs(migration.magnet.now) >= Math.abs(migration.magnet.was) ? "up" : "warnt")}
                  was={fmtUsd(migration.magnet.was, false)}
                  now={fmtUsd(migration.magnet.now, false)}
                  pct={migration.magnet.pct != null ? fmtPct(migration.magnet.pct, 0) : null}
                />
              )}
            </div>

            <div className="lvl spot">
              <div className="name">Spot <em>live</em></div>
              <div className="px mono">{fmtPx(spot, pxDp)}</div>
              <div className="es mono">
                {sym === "SPX"
                  ? <>ES {fmtPx(esFut, 2)}{esQ?.pct != null ? ` · ${fmtPct(esQ.pct)}` : ""}</>
                  : <>{symQ?.change != null
                        ? `${symQ.change >= 0 ? "+" : "−"}${Math.abs(symQ.change).toFixed(2)}`
                        : "—"}{symQ?.pct != null ? ` · ${fmtPct(symQ.pct)}` : ""}</>}
              </div>
              <div className="dist"><span className="mono muted">{openLabel}</span></div>
              {/* The overnight gap, from the baseline's own settle — the number
                  every level on this row has re-priced against. */}
              {migration.spot && (
                <MigLine
                  tag={Math.abs(migration.spot.move) < pxEps ? "flat o/n" : (migration.spot.move > 0 ? "gap up" : "gap down")}
                  tagClass={Math.abs(migration.spot.move) < pxEps ? "" : (migration.spot.move > 0 ? "up" : "down")}
                  was={fmtPx(migration.spot.was, pxDp)}
                  now={fmtPx(migration.spot.now, pxDp)}
                  pct={fmtPts(migration.spot.move)}
                />
              )}
            </div>

            <div className="lvl pain">
              <div className="name">Max Pain <em>{isZeroDte ? "0DTE" : "front"}</em></div>
              <div className="px mono">{fmtPx(maxPain, kDp)}</div>
              <div className="es mono">{es(maxPain) != null ? `ES ${fmtPx(es(maxPain), 0)}` : "OI-weighted"}</div>
              <div className="dist">
                <span className={`mono ${maxPain != null && maxPain - spot >= 0 ? "chg-pos" : "chg-neg"}`}>
                  {maxPain != null ? fmtPts(maxPain - spot) : "—"}
                </span>
                <span className="pill">{maxPain != null ? (maxPain > spot ? "drift ↑" : "drift ↓") : "—"}</span>
              </div>
              {/* NO migration line, deliberately. Max pain is computed from
                  per-side OI and the baseline stores net GEX per strike, so a
                  prior-close max pain cannot be derived from what we have.
                  Inventing one would be the only wrong number on this row. */}
            </div>

            <div className="lvl flip">
              <div className="name">Gamma Flip <em>regime</em></div>
              <div className="px mono">{fmtPx(flip, kDp)}</div>
              <div className="es mono">{es(flip) != null ? `ES ${fmtPx(es(flip), 0)} · zero γ` : "zero γ"}</div>
              <div className="dist">
                <span className={`mono ${distFlip != null && distFlip >= 0 ? "chg-pos" : "chg-neg"}`}>{fmtPts(distFlip)}</span>
                {em != null && distFlip != null && em > 0 && (
                  <span className={`pill ${Math.abs(distFlip) / em < 0.5 ? "warn" : ""}`}>
                    {(Math.abs(distFlip) / em).toFixed(1)}× EM away
                  </span>
                )}
              </div>
              {/* Shown on every tab. The baseline's flip is OI+Vol on the server
                  regardless of the requested basis (documented there), so this
                  is a LEVEL move and never labelled as a gamma Δ. */}
              {migration.flip && (
                <MigLine
                  tag={Math.abs(migration.flip.move) < pxEps
                    ? "held"
                    : (migration.flip.move > 0 ? `rose ${nf(migration.flip.move, pxDp)}` : `fell ${nf(Math.abs(migration.flip.move), pxDp)}`)}
                  tagClass={Math.abs(migration.flip.move) < pxEps ? "" : "flipt"}
                  was={fmtPx(migration.flip.was, kDp)}
                  now={fmtPx(migration.flip.now, kDp)}
                />
              )}
            </div>

            <div className="lvl put">
              <div className="name">Put Wall <em>support</em></div>
              <div className="px mono">{fmtPx(putWall, kDp)}</div>
              <div className="es mono">
                {es(putWall) != null ? `ES ${fmtPx(es(putWall), 0)} · ` : ""}{fmtUsd(wallGex.put, false)}
              </div>
              <div className="dist">
                <span className={`mono ${distPut != null && distPut >= 0 ? "chg-pos" : "chg-neg"}`}>{fmtPts(distPut)}</span>
                {overnight?.lo != null && putWall != null && basis != null && overnight.lo <= putWall + basis
                  ? <span className="pill hot">ON low tagged</span>
                  : <span className="pill cool">untested</span>}
              </div>
              {/* "deepening" = MORE negative gamma, i.e. a heavier floor. Read on
                  magnitude in wallState(), because the put wall's number is
                  negative and a falling number here means a stronger wall. */}
              {(() => {
                const m = migration.putWall;
                if (!m || (!m.gex && !m.px)) return null;
                const st = wallState(m.gex, "deepening", "easing");
                return (
                  <MigLine
                    tag={st?.text}
                    tagClass={st?.cls}
                    was={m.gex ? fmtUsd(m.gex.was, false) : null}
                    now={m.gex ? fmtUsd(m.gex.now, false) : null}
                    pct={m.gex?.pct != null ? fmtPct(m.gex.pct, 0) : null}
                    note={m.px && Math.abs(m.px.move) >= pxEps
                      ? `wall moved ${fmtPts(m.px.move)} from ${fmtPx(m.px.was, kDp)}`
                      : null}
                  />
                );
              })()}
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
                      <div className="k mono">{nf(b.strike, kDp)}</div>
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
                    <span>SPOT {fmtPx(spot, pxDp)}</span>
                  </div>
                )}
                {rowTop(flipStrike) != null && (
                  <div className="flipline" style={{ top: rowTop(flipStrike) as number }}>
                    <span>FLIP {fmtPx(flip, kDp)}</span>
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
                  <div className={`v mono ${totals.vanna == null ? "" : totals.vanna >= 0 ? "chg-pos" : "chg-neg"}`}>{fmtUsd(totals.vanna)}</div>
                  <div className="m">
                    {totals.vanna == null
                      ? "no per-contract vanna on this feed"
                      : totals.vanna >= 0 ? "vol down helps ↑" : "vol down helps ↓"}
                  </div>
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
              {/* SPX's overnight is the ES Globex session, 18:00 on. A stock's
                  is its own extended session, which starts at 04:00 — same
                  window logic (everything before today's 09:30), different
                  instrument and a different hour, so the label says which. */}
              <div className="colhead"><h3>Overnight Context</h3><span className="tiny">{sym === "SPX" ? "ES · 18:00" : `${sym} · ext`} → {String(Math.floor(etMin / 60)).padStart(2, "0")}:{String(etMin % 60).padStart(2, "0")} ET</span></div>

              <div className="onrange">
                {overnight?.lo != null && overnight?.hi != null ? (
                  <>
                    <div className="cap top" style={{ left: "12%", color: "var(--pos)" }}>ON low {fmtPx(overnight.lo, pxDp)}</div>
                    <div className="cap top" style={{ left: "88%", color: "var(--neg)" }}>ON high {fmtPx(overnight.hi, pxDp)}</div>
                    <div className="bar2"><div className="fill" style={{ left: "12%", right: "12%" }} /></div>
                    <div className="mk" style={{ left: "12%", background: "var(--pw)" }} />
                    <div className="mk" style={{ left: "88%", background: "var(--cw)" }} />
                    {onPos(livePx) != null && (
                      <>
                        <div className="mk" style={{ left: `${onPos(livePx)}%`, background: "#fff", height: 34, top: 9 }} />
                        <div className="cap bot" style={{ left: `${onPos(livePx)}%`, color: "#fff" }}>{sym === "SPX" ? "ES" : sym} {fmtPx(livePx, pxDp)}</div>
                      </>
                    )}
                    {onPos(overnight.pdc) != null && (
                      <>
                        <div className="mk" style={{ left: `${onPos(overnight.pdc)}%`, background: "var(--dim2)" }} />
                        <div className="cap bot" style={{ left: `${onPos(overnight.pdc)}%` }}>PDC {fmtPx(overnight.pdc, pxDp)}</div>
                      </>
                    )}
                  </>
                ) : (
                  <div style={{ paddingTop: 18, fontSize: 11.5, color: "var(--dim)" }}>No overnight bars yet.</div>
                )}
              </div>

              {/* ES and NQ stay on EVERY board, in the same two slots they
                  occupy on SPX. They are the market's context for whatever name
                  is on screen, not SPX trivia — and the row count of this
                  column does not change with the symbol. */}
              <div className="stat"><span className="l">ES change</span><span className={`r mono ${(esQ?.change ?? 0) >= 0 ? "chg-pos" : "chg-neg"}`}>
                {esQ?.change != null ? `${esQ.change >= 0 ? "+" : "−"}${Math.abs(esQ.change).toFixed(2)} (${fmtPct(esQ.pct)})` : "—"}
              </span></div>
              <div className="stat"><span className="l">NQ change</span><span className={`r mono ${(nqQ?.change ?? 0) >= 0 ? "chg-pos" : "chg-neg"}`}>
                {nqQ?.change != null ? `${nqQ.change >= 0 ? "+" : "−"}${Math.abs(nqQ.change).toFixed(2)} (${fmtPct(nqQ.pct)})` : "—"}
              </span></div>
              <div className="stat"><span className="l">ON range</span><span className="r mono">
                {onRange != null ? `${nf(onRange, pxDp)} pts` : "—"}
              </span></div>
              <div className="stat">
                <span className="l">
                  Prior RTH close ({sym === "SPX" ? "ES" : sym})
                  {/* Named, because over a weekend it is FRIDAY, not "yesterday". */}
                  {overnight?.pdDate && <> <span className="muted">{sessionLabel(overnight.pdDate)}</span></>}
                </span>
                <span className="r mono">{fmtPx(overnight?.pdc, pxDp)}</span>
              </div>
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
                      ? <span className="chg-pos">✓ filled at {fmtPx(gap.pdc, pxDp)}</span>
                      : <>
                          {fmtPx(gap.pdc, pxDp)}{" "}
                          <span className="muted">
                            ({nf(Math.abs(gap.remaining), pxDp)} pts {gap.remaining >= 0 ? "up" : "down"}
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
              <div className="stat"><span className="l">Prior day range ({sym === "SPX" ? "ES" : sym})</span><span className="r mono">
                {overnight?.pd
                  ? <>{fmtPx(overnight.pd.lo, pxDp)} – {fmtPx(overnight.pd.hi, pxDp)} <span className="muted">({nf(overnight.pd.hi - overnight.pd.lo, pxDp)})</span></>
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
                        <span className="s mono">{nf(d.strike, kDp)}</span>
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
                      ? `No prior-session board for ${sym} ${expiry || "this expiry"} yet — server-v2/premarket-baseline.js records one at 16:05 ET each session (and its ALLOWED_SYMBOLS list gates which symbols it will sweep), so this fills in after the next close.`
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
                    <div className="cap top" style={{ left: "8%", color: "var(--dim)" }}>{fmtPx(emLo, pxDp)}</div>
                    <div className="cap top" style={{ left: "50%", color: "#fff" }}>
                      EM ±{((em / spot) * 100).toFixed(2)}% / ±{nf(em, pxDp)} pts
                    </div>
                    <div className="cap top" style={{ left: "92%", color: "var(--dim)" }}>{fmtPx(emHi, pxDp)}</div>
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
                {em != null ? `±${nf(em, pxDp)} pts (${((em / spot) * 100).toFixed(2)}%)` : "—"}
              </span></div>
              <div className="stat"><span className="l">GEX-implied range</span><span className="r mono">
                {putWall != null && callWall != null
                  ? `${fmtPx(putWall, kDp)} – ${fmtPx(callWall, kDp)} (${nf(Math.abs(callWall - putWall), pxDp)})`
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
                  ? `${fmtPx(overnight.lo, pxDp)} – ${fmtPx(overnight.hi, pxDp)}`
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
                        {distFlip == null ? "n/a" : `${nf(Math.abs(distFlip), pxDp)} pts ${distFlip >= 0 ? "below" : "above"}`}
                      </span>, Call Wall <span className="r">{distCall == null ? "n/a" : `${nf(Math.abs(distCall), pxDp)} ${distCall >= 0 ? "above" : "below"}`}</span>,
                      {" "}Put Wall <span className="g">{distPut == null ? "n/a" : `${nf(Math.abs(distPut), pxDp)} ${distPut >= 0 ? "above" : "below"}`}</span> —{" "}
                      <b>
                        {posGamma
                          ? `fade extremes, scalp toward the ${magnet ? nf(magnet.strike, kDp) : "magnet"} magnet.`
                          : "stand aside at the edges, trade continuation through the walls."}
                      </b>
                    </>
                  ) : "Waiting for the first chain frame."}
                </p>
                <div className="scen">
                  <div><span className="g">▲</span><span>
                    <b>Above {fmtPx(callWall, kDp)}</b> — call wall break. Chase only with DEX confirming; gamma thins out above.
                  </span></div>
                  <div><span className="k">◆</span><span>
                    <b>{fmtPx(putWall, kDp)}–{fmtPx(callWall, kDp)}</b> — base case. {posGamma ? `Fade the edges, target ${magnet ? nf(magnet.strike, kDp) : "the magnet"}.` : "Two-sided and fast; size down."}
                  </span></div>
                  <div><span className="r">▼</span><span>
                    <b>Below {fmtPx(flip, kDp)}</b> — flip breached, regime turns negative. Stop fading; trend short toward {fmtPx(putWall, kDp)}.
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

          {/* THE GAMMA CARD — the same chain as the ladder above, drawn on a
              STRIKE axis: gamma mass with a least-squares normal through it on
              top, net GEX per strike underneath, one shared axis and one shared
              ±1σ band. Full width, because the read is the SHAPE — how peaked,
              how wide, where the centre sits against spot — and that needs the
              whole row. (It briefly shared the row with a second net-GEX card;
              two half-width copies of the same board read worse than one full
              one, and the bell card's lower pane already drew that view.)
              Its basis / range / pan-zoom state is its own — the page's
              three-leg lvlBasis drives the Key Levels tiles, and folding them
              together would mean changing the tiles to change this chart.
              The shared math lives in premarket/gammaChartKit.ts. */}
          <GammaBellCurve
            chain={chain}
            spot={spot}
            expiry={expiry}
            isZeroDte={isZeroDte}
            flip={flip}
            callWall={callWall}
            putWall={putWall}
            frozen={frozen}
          />

          {/* Which strikes grew far more than normal at yesterday's close.
              Reads the recorder's log via /api/gex-watch-feed — no live scan,
              and opex sessions are filtered out server-side, so this never
              shows the calendar and calls it a signal. Sits at the bottom
              because it is context for the session, not a number to trade off. */}
          <GexWatchFeed />

          <div className="footbar">
            <span className="l mono">
              {etDate} · {sym} · {feedLabel} · spot {fmtPx(spot, 2)} · ES {fmtPx(footEs, 2)}
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
