# Parity inventory — Level Log (`/level-log`)

**What this is.** One line per value the v2 page renders, with where it comes
from, how it is formatted, what changes its colour, and what it shows when the
value is missing. It is the SPEC for the v3 port: the v3 page is finished when
every row here is ticked, and not before.

**Why it exists.** The failure mode this document prevents is rebuilding a page
from scratch — re-deciding what it contains at the same time as building it.
Both jobs were already done in v2. This file finishes the first one so the
second is only construction.

**Scope.** The v2 route `/level-log`, which is:

| Layer | File | Lines |
|---|---|---|
| Route | `app-vite/src/App.tsx` → `<Route path="/level-log" element={S(<LevelLog />)} />` | 93 |
| Page | `components/pages/LevelLog.tsx` — the whole route, no shim, no `app/level-log/` directory | 2,608 |
| Page chrome | `components/shared/PageCard.tsx` → `PageShell` | 41–77 |
| Palette | `components/shared/homeTheme.ts` | 318 |
| Date control | `components/shared/ThemedDatePicker.tsx` | 213 |
| Refresh button | `hooks/useRefreshButton.ts` | 34 |
| Churn strip | `components/shared/GexHeatBar.tsx` → `useGexChurnHistory` + `GexChurnHistory` | 350–534 |
| Capture | `lib/snapshot.ts` → `captureAndCopy` | 1476–1482 |
| Server | `server-v2/server-with-proxy.js` → `/proxy/walls` (3155–3221), `/proxy/candles-intraday` (570–587), `/proxy/*` auth gate (1419) | — |
| Server | `server-v2/api-router.js` → `/api/gex-gross-feed` (7201–7240) | — |

**Total: 283 checklist rows** (Parts A–Q), plus 18 findings and 12 open
questions.

| Part | Covers | Rows |
|---|---|---|
| A | Page frame, control bar, header strings | 11 |
| B | The three switch groups — `LogView`, `ExpScope`, `GexBasis` | 15 |
| C | Quick tickers, date picker, filter box, refresh | 12 |
| D | Error card | 3 |
| E | Ticker rail card — header, 6 columns, sort, empty | 17 |
| F | Log card header — title, spot, expiry tag, variant tag, 3 buttons | 24 |
| G | `WallCaptureRail` + `WallRailChips` — drawing spec | 24 |
| H | `WallMigrationChart` — model, geometry, legend, axis | 49 |
| I | `WallMigrationPopout` | 15 |
| J | `GexChurnHistory` as used here | 14 |
| K | Variant-empty note | 4 |
| L | `WallTimeline` — rows, badges, meta, empties | 28 |
| M | Reaction legend | 3 |
| N | The eleven formatters, written out | 14 |
| O | ET time machinery | 10 |
| P | Data layer — four hooks, three endpoints, verified at the server | 24 |
| Q | `buildLogText` — the clipboard artefact | 16 |
| **A–Q** | **checklist subtotal** | **283** |
| R | Colours used | own table — 33 values + 4 new collisions |
| S | Do not port | own table — 19 items |
| T | Findings worth a decision | own table — 18 findings |
| U | Open questions for Brandon | own list — 12 questions |

**Column meanings**

- **Source** — the endpoint AND the field underneath it, or the exact
  client-side formula. `/proxy/walls → row.level_gex` is a source; "the GEX" is
  not.
- **Format & units** — decimal places, sign, `pts`, font, size, px geometry.
  What the code actually does, not what looks sensible.
- **Threshold / colour rule** — every condition that changes a colour, a weight
  or the wording. This is where detail goes missing when a page is described
  rather than transcribed.
- **Empty / loading** — literally what renders when the value is not there.

**A note on the model document.** The brief pointed at
`cbedge-v3/docs/parity/scanner.md`. **That file does not exist** — the staged
`cbedge-v3/docs/parity/` directory contains `em.md` and nothing else. This
document is written against `em.md`, which the brief names as the original of
the form. Where the brief cites a scanner decision (the `V2.green` split), it is
carried in as stated and flagged in Part R, because the staged `theme.ts` does
not contain the tokens that decision created either.

---

## Colour constants used by this page

`HT` = `HOME_THEME` from `components/shared/homeTheme.ts`. The page re-exports
six of them under local names in an aliasing block at lines 66–98, and those
local names are what every row below cites.

| Local name | Line | Resolves to | Actual value |
|---|---|---|---|
| `C.cyan` | 70 | `HOME_THEME.cyan` | `#219EBC` |
| `C.border` | 71 | `HOME_THEME.border` | `rgba(255,255,255,0.10)` |
| `C.label` | 72 | `HOME_THEME.text` | `#FFFFFF` |
| `GREEN` | 74 | `HOME_THEME.green` | `#8ECAE6` — **a light blue** |
| `RED` | 75 | `HOME_THEME.red` | `#EF4444` |
| `AMBER` | 76 | `HOME_THEME.orange` | `#FB8501` |
| `MUTED` | 77 | `HOME_THEME.muted` | `#FFFFFF` — **identical to `C.label`** |
| `CARD` | 78 | `classicCardAccentStyle` | see below |
| `CORE_GOLD` | 96 | `LEVEL_COLORS.cb` | `#ffd600` |
| `CALL_GREEN` | 97 | `ES_CANDLE_UP` | `#30d158` |
| `PUT_RED` | 98 | `LEVEL_COLORS.pw` | `#ff4757` |
| `LIGHT_BLUE` | imported | `homeTheme.LIGHT_BLUE` | `#7dd3fc` |

`CARD` = `classicCardAccentStyle` = `background rgba(13,17,25,0.45) ·
backdropFilter blur(16px) (+ `-webkit-` twin) · borderRadius 18 · border 1px
rgba(255,255,255,0.10) · boxShadow 0 18px 40px rgba(0,0,0,0.22)`.

**The page's own comment (lines 80–95) states the collision out loud and then
walks into it anyway.** It says `HOME_THEME.green` "is the status palette's light
blue (#8ECAE6)… neither of them reads as GREEN next to a red put wall" — and
uses `ES_CANDLE_UP` for the call wall on that basis. It then assigns
`const GREEN = HOME_THEME.green` and paints eight positive/success affordances
with it (Part R). The code wins: this page renders "green" as `#8ECAE6`.

## Shared inline style objects

Declared inside `LevelLog()` and referenced by name below.

- `chipStyle(on, color = C.cyan)` (765–771) = `padding 6px 12px · radius 8 ·
  cursor pointer · fontFamily inherit · border 1px (on ? color : C.border) ·
  background (on ? rgba(color,.16) : rgba(255,255,255,0.03)) · color (on ? color
  : C.label) · 13px / 800 · letterSpacing .08em · uppercase`
- `th` (773–777) = `12px / 800 · letterSpacing .12em · uppercase · textAlign
  right · padding 10px 9px · borderBottom 1px C.border · whiteSpace nowrap ·
  position sticky · top 0 · background HT.panelBgStrong (rgba(13,17,25,0.72))`
- `td` (778–781) = `padding 8px 9px · borderBottom 1px rgba(255,255,255,0.05) ·
  13px · textAlign right · whiteSpace nowrap · fontFamily var(--font-mono)`
- `wallBadgeStyle(color)` (338–347) = `inline-block · border-box · height 20 ·
  lineHeight 18px · padding 0 9px · radius 6 · 12px / 800 · letterSpacing .12em
  · textIndent .12em · uppercase · nowrap · center · color <color> · background
  rgba(color,.13) · border 1px rgba(color,.3)`

## Type scale (269–288)

| Constant | Value | Used for |
|---|---|---|
| `FS_LABEL` | `12` | uppercase chips + eyebrow labels |
| `FS_BODY` | `13` | the sentence in each timeline row |
| `FS_META` | `12` | mono: time, GEX line, counters |
| `LS_LABEL` | `"0.12em"` | every uppercase tracking |
| `ROW_LEAD_H` | `20` | badge box height; the timeline dot centres on it |
| `RAIL_CHIP_H` | `24` | rail chip height |
| `LEGEND_CHIP_H` | `16` | migration legend chip height |
| `LEGEND_SWATCH` | `11` | legend colour square, border-box |
| `WALL_SLOTS` | `27` | slot 0 = 09:29, slots 1–26 = 09:45 → 16:00 |
| `LEVEL_LOG_H` | `620` | max height of the timeline scroller |
| `TICKER_COL_H` | `620` | max height of the ticker rail scroller |
| `MIG_H` | `250` | migration chart body height |
| `MIG_PAD` | `8` | migration chart vertical pad |

---

# Part A — Page frame, control bar, header strings

Source: `LevelLog.tsx:623–651`, `786–795`, `887–892`; `PageCard.tsx:41–77`.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| A1 | Route | `App.tsx:93` | `<Route path="/level-log" element={S(<LevelLog />)} />`, lazy-imported from `@/components/pages/LevelLog` | none | n/a |
| A2 | Page shell | `PageShell className="wall-scroll"` | `homeShellStyle`: `height 100% · width 100% · overflow hidden · flex column · minHeight 0 · fontFamily var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif` | `background HT.bg #05060A`, `backgroundImage HT.shellGlow` = two radials — `circle at 15% 50% rgba(33,158,188,0.04) → transparent 50%` and `circle at 85% 30% rgba(18,103,131,0.05) → transparent 50%`; `color HT.text` | n/a |
| A3 | Content column | `homeContentStyle` + `overflow:auto` + `alignItems:stretch` | `flex 1 · flex column · minHeight 0 · padding clamp(14px,2vw,24px) · gap clamp(16px,2vw,32px)` | none | No `maxWidth` is passed, so the column is full-bleed |
| A4 | `wall-scroll` class | `globals.css` (**not staged**) | Applied to the `<main>` and to both inner scrollers (rail, timeline) | Unknown — the stylesheet is not in this tree | Must be recovered before the port; see Part U |
| A5 | Control bar plate | `CARD` + overrides | `padding 14px 18px · marginBottom 14 · flex · gap 12 · alignItems center · flexWrap wrap` | `CARD` (see above) | Always renders |
| A6 | Page title | Static | `"Level Log"` → renders **`LEVEL LOG`** (`textTransform: uppercase`) — `17px / 800 · letterSpacing .1em` | `C.cyan` `#219EBC` | Always renders |
| A7 | Sub-line | `viewMeta.blurb` + statics + `vTag` | `` `{blurb} — 09:29 open + every 15m to 16:00 ET, change-only · {vTag}` `` — `13px`, no textTransform | `C.label` `#FFFFFF` | Always renders. Default paint: `Walls + CORE on one timeline — 09:29 open + every 15m to 16:00 ET, change-only · 0DTE · OI+vol GEX` |
| A8 | `viewMeta` lookup | `VIEW_META.find(v => v.id === view)!` (783) | Non-null asserted; `view` is always one of the three ids so the assertion is safe | none | n/a |
| A9 | Body grid | inline (892) | `display grid · gridTemplateColumns "minmax(0, 1fr) minmax(0, 2.6fr)" · gap 16 · alignItems start` | none | The exact `minmax(0, 1fr) minmax(…)` signature is what `globals.css`'s GLOBAL GRID COLLAPSE block matches to stack the two columns on a phone (comment 888–891) — **that block is not in v3** |
| A10 | Initial state | `useState` (624–650) | `date = todayETStr()`, `view = "all"`, `scope = "0dte"`, `basis = "oivol"`, `tickers = []`, `sel = null`, `detail = null`, `q = ""`, `err = null`, `loaded = false`, `nonce = 0`, `popout = false` | none | First paint is the whole control bar + an empty rail showing `…` + a log card headed `— — LEVEL LOG` |
| A11 | Snapshot target ref | `logCardRef` (652) | Attached to the log card `<div>` at 951 — **the PNG is that card and nothing outside it** | none | n/a |

---

# Part B — The three switch groups

Source: `LevelLog.tsx:181–248`, `796–835`. All three are `chipStyle` buttons in
render order left→right.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| B1 | View group container | inline (799) | `flex · gap 8 · alignItems center · marginLeft 4` — **no left divider**, unlike the two below | none | Always renders |
| B2 | `WALLS` | `VIEW_META[0]` — `{id:"walls", label:"Walls", color:AMBER, blurb:"Call wall + put wall only"}` | `chipStyle(view==="walls", AMBER)` → uppercase `WALLS` | On: border/text `AMBER #FB8501`, bg `rgba(251,133,1,.16)`. Off: border `C.border`, text `C.label`, bg `rgba(255,255,255,0.03)` | Always enabled |
| B3 | `CORE` | `VIEW_META[1]` — `{id:"core", label:"Core", color:CORE_GOLD, blurb:"CORE level only"}` | `chipStyle(view==="core", CORE_GOLD)` → uppercase `CORE` | On: `CORE_GOLD #ffd600` | Always enabled |
| B4 | `ALL` | `VIEW_META[2]` — `{id:"all", label:"All", color:C.cyan, blurb:"Walls + CORE on one timeline"}` | `chipStyle(view==="all", C.cyan)` → uppercase `ALL` | On: `C.cyan #219EBC`. **This is the default** (628; changed to `all` 2026-08-23) | n/a |
| B5 | View `title=` | `v.blurb` | Verbatim: `"Call wall + put wall only"` / `"CORE level only"` / `"Walls + CORE on one timeline"` | none | n/a |
| B6 | What a view switch does | `setView(v.id)` | Pure client-side filter. `VIEW_LEVELS`: `walls → ["call_wall","put_wall"]`, `core → ["cb"]`, `all → ["call_wall","put_wall","cb"]`. `inView(v, lt)` = `VIEW_LEVELS[v].includes(lt)` | none | **No refetch.** One `/proxy/walls` read already carries all three level types (comment 44–47) |
| B7 | What a view switch scopes | `log` / `events` memos (705–712) | Both `detail?.x ?? []` filtered by `inView`. Downstream: ticker-rail columns, capture rail, migration chart, timeline, `logText`, PNG filename, PNG title | none | The scope can never disagree with what is exported |
| B8 | Scope group container | inline (812) | `flex · gap 8 · alignItems center · paddingLeft 12 · borderLeft 1px C.border` | none | Always renders |
| B9 | `0DTE` | `SCOPE_META[0]` — `{id:"0dte", label:"0DTE"}` | `{...chipStyle(scope==="0dte", GREEN), padding "6px 10px", letterSpacing "0.06em"}` — the padding and tracking **override** `chipStyle` | On: `GREEN #8ECAE6` (the light blue) | **Default** (636) |
| B10 | `NON-0DTE` | `SCOPE_META[1]` — `{id:"agg", label:"Non-0DTE"}` | Same style | On: `GREEN #8ECAE6` | n/a |
| B11 | Scope `title=` | `v.blurb` | `0dte`: `"Nearest listed contract only — chain.expirations[0]"`. `agg`: `"Every OTHER listed expiration, summed per strike"` | none | n/a |
| B12 | Basis group container | inline (824) | Identical to B8 | none | Always renders |
| B13 | `OI + VOL` | `BASIS_META[0]` — `{id:"oivol", label:"OI + Vol"}` | `{...chipStyle(basis==="oivol", AMBER), padding "6px 10px", letterSpacing "0.06em"}` | On: `AMBER #FB8501` | **Default** (637) |
| B14 | `VOL ONLY` | `BASIS_META[1]` — `{id:"vol", label:"Vol only"}` | Same style | On: `AMBER #FB8501` | n/a |
| B15 | Basis `title=` | `v.blurb` | `oivol`: `"netGEX + netVolGEX — open interest and today's volume"`. `vol`: `"netVolGEX alone — today's volume, no open interest"` | none | **Both scope and basis REFETCH** — they are deps of `loadDay` (668) and of all three per-symbol effects (692, 1484, 2300). Nothing is derived client-side |

**What persists:** nothing. `view`, `scope`, `basis`, `date` and `sel` are all
plain `useState` with no `localStorage`, no URL param and no server round-trip.
A reload returns every control to its default and `date` to today ET.

---

# Part C — Quick tickers, date picker, filter box, refresh

Source: `LevelLog.tsx:250–259`, `672–676`, `726–739`, `836–879`;
`ThemedDatePicker.tsx`; `useRefreshButton.ts`.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| C1 | Quick-pill container | inline (839) | `flex · gap 6 · alignItems center · paddingLeft 12 · borderLeft 1px C.border` | none | Always renders |
| C2 | `SPX` `SPY` `QQQ` | `QUICK_TICKERS = ["SPX","SPY","QQQ"] as const` (259) | **This exact order, hardcoded, not sorted.** `{...chipStyle(sel===sym), padding "6px 10px", fontSize 12, letterSpacing "0.06em"}` | On: `C.cyan` (the default `chipStyle` colour — the pills do **not** take a per-view colour) | n/a |
| C3 | Quick pill — disabled | `missing = loaded && !haveSymbols.has(sym)` | `{opacity: 0.4, cursor: "not-allowed"}` merged last, `disabled` set | Colours unchanged, dimmed | **Before the day list lands (`loaded === false`) every pill is enabled** — the disable only appears after the fetch settles |
| C4 | Quick pill `title=` | ternary (852) | Enabled: `` `Jump to {sym}` ``. Disabled: `` `No {sym} row recorded for {date}` `` | none | n/a |
| C5 | `haveSymbols` | `new Set(tickers.map(t => t.symbol))` (726) | Built off the **unfiltered** `tickers`, not `shown` — the filter box cannot grey out a pill (comment 724–725) | none | Empty set while loading |
| C6 | Quick pill click | `pickTicker(sym)` (733–739) | `setSel(sym)`; then `setQ(prev => query && !sym.includes(query) ? "" : prev)` — clears the filter box only when the current query would hide the row being selected | none | A rail-row click (`setSel` at 923) does **not** do this |
| C7 | Right-hand group | inline (860) | `marginLeft auto · flex · gap 8 · alignItems center · flexWrap wrap` | none | Always renders |
| C8 | Date picker | `<ThemedDatePicker value={date} onChange={…} width={160} />` | Trigger button: `flex · space-between · gap 8 · width 100% · padding 10px 12px · radius 10 · 14px / 700 · color HT.text · background rgba(0,0,0,0.30)`. Label `` `{Mon} {D}, {YYYY}` `` e.g. `Sep 3, 2026` (month = `MONTHS_LONG[m].slice(0,3)`) | Closed border `1px HT.border`; open border `1px DOCK_THEME.activeBorder` = `rgba(33,158,188,0.3)` + `boxShadow DOCK_THEME.activeGlow` = `0 0 14px rgba(33,158,188,0.22)`; `transition border-color .14s, box-shadow .14s` | `placeholder="Select date"` when `value` is empty — unreachable here, `date` is always a valid string |
| C9 | Date picker — glyphs | `ThemedDatePicker.tsx:122–134` | Left: a 15×15 calendar SVG, `stroke currentColor`, `strokeWidth 1.8`, in `HT.cyan`. Right: a 16×16 chevron SVG in `HT.muted`, `transform rotate(180deg)` when open, `transition transform .18s` | none | n/a |
| C10 | Date picker — panel | portal to `document.body` (137–207) | `position fixed · top rect.bottom+6 · left rect.left · width max(rect.width, 260) · minWidth 260 · zIndex 9999 · padding 12 · radius 14 · border 1px HT.border · borderTop 2px DOCK_THEME.cyanTop rgba(33,158,188,0.5) · backdropFilter blur(18px)`; background `DOCK_THEME.bg` = `radial-gradient(circle at 50% 0%, rgba(33,158,188,0.07) 0%, transparent 55%), rgba(10,13,20,0.98)`; `boxShadow DOCK_THEME.shadow`. Month header `14px / 800`; weekday row `S M T W T F S` at `10px / 700` in `HT.muted`; day cells `aspectRatio 1 · radius 8 · 12px`, selected `800` in `HT.cyan` on `DOCK_THEME.activeTile`, today gets `1px HT.border`, hover `DOCK_THEME.hoverTile` | Portals so the card's `overflow:hidden` cannot clip it (comment 864–866). Closes on outside `mousedown` or `Escape` |
| C11 | Date change | `onChange={(v) => { setDate(v); setSel(null); }}` (869) | Emits `"YYYY-MM-DD"`. **Clears the selection**, so `loadDay`'s `setSel(prev => prev ?? rows[0]?.symbol ?? null)` re-picks the first row of the new day | none | Scope/basis changes do **not** clear `sel` |
| C12 | Filter box + refresh | `homeInputStyle` overridden; `useRefreshButton(refreshAll)` | Input: `{...homeInputStyle, fontSize 13, padding "7px 10px", minWidth 140, fontFamily "inherit"}` → `border 1px HT.border · radius 6 · background rgba(0,0,0,0.4) · color HT.text · outline none`; placeholder `"Filter ticker…"` (single `…` glyph). Refresh: `homeRefreshButtonStyle(state)` → `10px / 700 · padding 2px 10px · radius 2 · flexShrink 0 · transition all 0.15s`; labels `↻ Now` / `↻ Refreshing…` / `✓ Refreshed` / `✗ Failed`; `title="Re-pull the day list and the selected ticker's level log"` | Refresh idle: border `rgba(33,158,188,.4)`, bg `rgba(33,158,188,.08)`, text `HT.cyan`. Refreshing: text `#888`, `opacity .6`, `cursor not-allowed`. Success: `REFRESH_GREEN #1FD98A`, bg `rgba(31,217,138,.1)`, `textShadow 0 0 12px rgba(31,217,138,.5)`. Error: `HT.red #EF4444` + matching wash and glow | `useRefreshButton` holds a `lockedRef` — a re-click while refreshing is a no-op. Every state reverts to `idle` after **1800 ms** via a `finally` `setTimeout`. `refreshAll` = `setNonce(n=>n+1)` then `await loadDay()` |

---

# Part D — Error card

Source: `LevelLog.tsx:654–668`, `882–886`.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| D1 | Error card | `err` state | `{...CARD, padding 18, marginBottom 14, fontSize 13}` | `color RED #EF4444` | Rendered whenever `err` is truthy; sits between the control bar and the two-column grid |
| D2 | Error text | template (884) | `` `Could not load /proxy/walls — {err}` `` | — | `err = String(e)` (666), so a thrown `Error` stringifies **with its `Error: ` prefix** — the line reads `Could not load /proxy/walls — Error: HTTP 502` |
| D3 | What sets it | `loadDay` catch (666) | Only the **day-summary** read can set `err`. `!j?.ok` throws `new Error(j?.error || `HTTP ${r.status}`)`. On error it also `setTickers([])` | — | The three per-symbol reads (`detail`, `useIntradaySpot`, `useWallSeries`) swallow every failure silently and set an empty value. **A ticker whose detail 502s is indistinguishable from a quiet session** |

---

# Part E — Ticker rail card

Source: `LevelLog.tsx:714–726`, `773–784`, `893–948`. Card = `{...CARD,
overflow:"hidden"}`.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| E1 | Rail header row | inline (895) | `padding 14px 18px · borderBottom 1px C.border · flex · gap 12 · alignItems center` | none | Always renders |
| E2 | `TICKERS — {date}` | Static + `date` | `` `Tickers — {date}` `` → renders uppercase — `13px / 800 · letterSpacing .14em`. Date is the raw `YYYY-MM-DD`, **not** reformatted | inherits `HT.text` | Always renders |
| E3 | Row counter | `loaded ? String(shown.length) : "…"` | `13px`, `marginLeft auto` | inherits `HT.text` | `…` (single glyph) until `loaded` |
| E4 | Scroller | inline (903) | `className="wall-scroll" · maxHeight 620 (TICKER_COL_H) · overflow auto` | none | n/a |
| E5 | Table | inline (904) | `width 100% · borderCollapse collapse` | none | n/a |
| E6 | Column 1 — `TICKER` | `t.symbol` | Head `{...th, textAlign:"left"}`. Cell `{...td, textAlign:"left", fontWeight:800, letterSpacing:"0.03em"}` — mono via `td` | inherits `HT.text` | Symbol is always present on a row |
| E7 | Column 2 — `SPOT` | `/proxy/walls → tickers[].spot` | `th` (right). `wallNum(t.spot)` → `en-US`, **exactly 2 dp**, comma-grouped | inherits `HT.text` | `—` (em dash) when null or non-finite |
| E8 | Column 3 — `PUT` | `/proxy/walls → tickers[].put_wall` | `th` right, head coloured `LEVEL_COLOR.put_wall`. Cell `{...td, color: PUT_RED}`. `wallStrike()` → `en-US`, **max 2 dp, no minimum** — `6890`, not `6890.00` | `PUT_RED #ff4757` on both head and cell | `—`. **Column present only when `inView(view,"put_wall")`** — absent in the CORE view |
| E9 | Column 4 — `CALL` | `→ tickers[].call_wall` | Same | `CALL_GREEN #30d158` | `—`. Absent in the CORE view |
| E10 | Column 5 — `CORE` | `→ tickers[].cb` | Same | `CORE_GOLD #ffd600` | `—`. Absent in the WALLS view |
| E11 | Column order | `LEVEL_COL_ORDER = ["put_wall","call_wall","cb"]` filtered by `inView` (294, 784) | **Price order, not `VIEW_LEVELS` order** — put under call, CORE last — so switching to ALL adds a column rather than reshuffling the two already there (comment 909–912) | — | WALLS → `PUT CALL`; CORE → `CORE`; ALL → `PUT CALL CORE` |
| E12 | Column 6 — `CHG` | `→ tickers[].changes` | `td` right, mono, raw integer, no formatting | inherits `HT.text` | A missing `changes` renders as blank (no `wallNum` guard) |
| E13 | Delta chip | `<WallDelta now={t[lt]} open={t.open?.[lt]} />` (610–619, 934) | Suffix inside the level cell. `` `{▲|▼}{wallStrike(Math.abs(now - open))}` `` — `13px / 800 · marginLeft 6 · padding 1px 5px · radius 4` | `up = now > open` → `GREEN #8ECAE6` on `rgba(142,202,230,.12)`; down → `AMBER #FB8501` on `rgba(251,133,1,.12)`. **Down is amber, not red** | Renders `null` when `now == null`, `open == null`, **or `now === open`** — an unmoved level shows no chip at all |
| E14 | Row — selected | `t.symbol === sel` | `background rgba(33,158,188,0.1)` + `boxShadow inset 2px 0 0 #219EBC` | `C.cyan` | Unselected rows get `undefined` for both, i.e. no hover style at all — the rail has **no hover affordance**, only `cursor:pointer` |
| E15 | Row click | `onClick={() => setSel(t.symbol)}` (923) | Sets the selection. Does **not** clear the filter box (contrast C6) | none | n/a |
| E16 | Sort — the comparator | `shown` memo (714–722) | `rows.filter(t => query ? t.symbol.includes(query) : true)` where `query = q.trim().toUpperCase()`; then `[...rows].sort((a,b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) \|\| a.symbol.localeCompare(b.symbol))` | — | **Default and only sort — rank ascending, ties broken by symbol `localeCompare`. There is no sort UI: no header is clickable, no direction can be reversed.** Null/absent `rank` sorts to the very end and then alphabetically among itself. `rank` is attached server-side by `attachRank()` and **only on the universe response** (`server-with-proxy.js:3216`) |
| E17 | Empty row | `loaded && !shown.length` | `<td colSpan={railCols.length + 3}>` — 4 in WALLS/ALL⁻, 5 in ALL — `{...td, textAlign:"center", padding:"34px 0", fontFamily:"inherit"}` (mono overridden back to sans). Text: `` `No rows for {date}. The recorder writes from 09:29 ET on trading days.` `` | inherits `HT.text` | Absent while `!loaded` — the table body is simply empty, with no skeleton and no spinner |

---

# Part F — Log card header

Source: `LevelLog.tsx:485–608`, `741–763`, `950–999`. Card = `{...CARD,
overflow:"hidden"}` carrying `logCardRef`.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| F1 | Header row | inline (952) | `padding 14px 18px · borderBottom 1px C.border · flex · gap 12 · alignItems center · flexWrap wrap` | none | Always renders |
| F2 | Card title | `sel` + `VIEW_SCOPE[view]` | `` `{sel ?? "—"} — {VIEW_SCOPE[view]} log` `` → uppercase — `12px (FS_LABEL) / 800 · letterSpacing .12em`. `VIEW_SCOPE = {walls:"wall", core:"core", all:"level"}` | inherits `HT.text` | With no selection: `— — LEVEL LOG` |
| F3 | Spot readout | `selRow?.spot ?? null` | `wallNum(spot)` — 2 dp, comma-grouped — `12px (FS_META)`, `var(--font-mono)` | inherits `HT.text` | `—` |
| F4 | Expiry tag — gate | `expTag = expiryTag(expiry, date)` (756) | The whole `<span>` is omitted when `expTag` is null, i.e. when `series.expiry` is null | — | Pre-migration rows hold `""`, which fails the `/^\d{4}-\d{2}-\d{2}$/` test in `useWallSeries` (1470), so `expiry` stays null and the tag is **absent rather than guessed** |
| F5 | Expiry tag — text | `expiryTag` (136–142) + suffix (976) | `` `exp {MM}/{DD} · {d}DTE` `` normally; `` `exp {MM}/{DD}` `` when `d == null \|\| d < 0`; falls back to the whole `expiry` string when it will not split on `-`. Suffix `` ` +{expiries-1}` `` appended **only when `scope === "agg" && expiries > 1`** | `color LIGHT_BLUE #7dd3fc`, `background rgba(125,211,252,.12)`, `border 1px rgba(125,211,252,.35)`, `radius 6`, `padding 2px 7px`, `12px / 800` mono, `nowrap` | — |
| F6 | Expiry tag — `title=` (0DTE) | ternary (968) | Verbatim: `` `Levels computed from the {expiry} expiration — the nearest listed contract at capture. Walls and CORE all come from that one chain; nothing is aggregated across expirations.` `` | none | n/a |
| F7 | Expiry tag — `title=` (agg) | ternary (967) | Verbatim: `` `Levels summed across {expiries} expiration{s} starting {expiry} — today's contract excluded. Each expiry's ladder is computed on its own and the exposures are added per strike.` `` — plural suffix is `expiries === 1 ? "" : "s"` | none | n/a |
| F8 | Expiry tag — capture | comment 962–963 | **Deliberately NOT `data-capture-hide`** — it rides into the PNG, so a shared screenshot always names its board | — | n/a |
| F9 | Variant tag | `vTag = variantTag(scope, basis)` (757) | `` `{0DTE\|non-0DTE} · {OI+vol GEX\|vol-only GEX}` `` — `12px / 800` mono, `padding 2px 7px`, `radius 6`, `nowrap` | `basis === "vol"` → text `AMBER #FB8501`, bg `rgba(251,133,1,.12)`, border `1px rgba(251,133,1,.35)`. Otherwise → text `MUTED #FFFFFF`, bg `rgba(255,255,255,0.04)`, border `1px C.border` | Always renders |
| F10 | Variant tag — `title=` | template (989) | `` `{SCOPE_META[scope].blurb} · {BASIS_META[basis].blurb}` `` — e.g. `Nearest listed contract only — chain.expirations[0] · netGEX + netVolGEX — open interest and today's volume` | none | Both lookups use `?.blurb`, so a bad id would print `undefined · undefined`; unreachable with the current types |
| F11 | Button group | `<div data-capture-hide>` (994) | `marginLeft auto · flex · gap 8 · alignItems center` | none | **Dropped from the PNG** by `lib/snapshot.ts` |
| F12 | `⤢ CORE MIGRATION` | `CoreMigrationButton` (498–522) | `padding 6px 12px · radius 8 · fontFamily inherit · 13px / 800 · letterSpacing .08em · uppercase`. Label literal `"⤢ CORE migration"` | Enabled: border `1px CORE_GOLD`, bg `rgba(255,214,0,0.12)`, text `CORE_GOLD`, `opacity 1`, `cursor pointer`. Disabled: border `1px C.border`, bg `rgba(255,255,255,0.03)`, text `C.label`, `opacity 0.5`, `cursor default` | **Disabled rule: `!symbol`** — i.e. `sel` is null. `title` = `` `Open {symbol}'s CORE migration — the last 63 recorded sessions — in a new tab` `` enabled, `"Pick a ticker first"` disabled |
| F13 | CORE migration — action | `open()` (501–505) | `window.open(`/core-migration.html?${new URLSearchParams({symbol, end: endDate, scope, basis})}`, "_blank", "noopener")`. Params in that order: `symbol`, `end`, `scope`, `basis` | none | Guards `if (!symbol) return` a second time. **`public/core-migration.html` is not in this tree** — see Part U |
| F14 | `⧉ COPY` | `CopyLogButton` (582–608) | `padding 5px 10px · radius 8 · fontFamily inherit · 13px / 800 · letterSpacing .08em · uppercase`. Label ladder: `"⧉ Copy"` → `"✓ Copied"` | Idle: border `1px C.border`, bg `rgba(255,255,255,0.03)`, text `C.label`. Done: border `1px GREEN`, bg `rgba(142,202,230,.14)`, text `GREEN #8ECAE6`. Disabled: `opacity 0.3`, `cursor default` | **Disabled rule: `empty`** = `!sel \|\| !(log.length \|\| events.length)`. `title="Copy this log as formatted text"` |
| F15 | Copy — action | `navigator.clipboard.writeText(text)` | `text = logText` (Part Q). On success `setDone(true)` then reverts after **1600 ms** | — | On a clipboard rejection the `catch` is empty: **the label does not change and no error is shown** — comment 589: "clipboard blocked — leave the label alone rather than lying" |
| F16 | `📸 PNG` | `SnapLogButton` (535–580) | `padding 5px 10px · radius 8 · fontFamily inherit · 13px / 800 · letterSpacing .08em · uppercase`. Label ladder: `"📸 PNG"` → `"Capturing…"` → `"✓ Copied"` / `"✓ Saved"` / `"✕ Failed"` | `ok = state==="copied" \|\| state==="saved"` → text+border `GREEN #8ECAE6`, bg `rgba(142,202,230,.14)`. `err` → text `RED #EF4444`, border `C.border` (**the border does NOT follow the error colour — only `ok` swaps it**), bg `rgba(255,255,255,0.03)`. Idle/working → text `C.label`, border `C.border` | **Disabled rule: `disabled \|\| state === "working"`**, where `disabled = empty`. `opacity`: `disabled ? 0.3 : working ? 0.6 : 1`. Every state reverts to `idle` after **2200 ms** |
| F17 | Snapshot — action | `captureAndCopy(el, filename, {framed:true, hugTarget:true, title})` (551) | `el = logCardRef.current` — the whole log card. `framed:true` bakes the title band + the `"Data provided by CBEdge.net"` watermark and expands the clone past its scroll window. `hugTarget:true` stops the expansion at the content instead of at `captureH`, which otherwise left a dead band inside the card (comment 548–550) | — | Returns `"copied"` or `"saved"` — clipboard first, silent fallback to a download. A thrown capture logs `console.error("[level-log] snapshot", e)` and sets `err` |
| F18 | Snapshot — filename | `snapFile` (763) | `` `{sel?.toLowerCase() ?? "walls"}-{view}-{scope}-{basis}-log-{date}.png` `` — e.g. `spx-all-0dte-oivol-log-2026-09-03.png` | — | `"walls"` when `sel` is null — unreachable, the button is disabled |
| F19 | Snapshot — title band | `snapTitle` (762) | `` `{sel ?? "—"} — {core?"CORE":all?"Level":"Wall"} log · {date} · {vTag}` `` — e.g. `SPX — Level log · 2026-09-03 · 0DTE · OI+vol GEX` | — | **A third spelling of the scope word.** The card header uses `VIEW_SCOPE` (`wall`/`core`/`level`), `buildLogText` uses `VIEW_SCOPE[…].toUpperCase()`, and this uses its own inline ternary (`Wall`/`CORE`/`Level`). Three code paths, one concept |
| F20 | `logText` memo | `buildLogText(sel ?? "—", spot, date, view, log, events, expiry, vTag)` (758–761) | Recomputed on any of those eight | — | Part Q |
| F21 | `expTag` memo | `expiryTag(expiry, date)` (756) | deps `[expiry, date]` | — | — |
| F22 | `vTag` memo | `variantTag(scope, basis)` (757) | deps `[scope, basis]` | — | — |
| F23 | `empty` | `!sel \|\| !(log.length \|\| events.length)` (744) | Computed **after** the view filter, so switching to CORE on a walls-only day disables both buttons | — | Drives F14 and F16 |
| F24 | `todayDays` memo | `[{ date, log, events, price }]` (751–754) | A one-element `DaySlice[]`, deps `[date, log, events, price]`. Feeds the inline chart and the popout's "Today" range so that range costs no refetch | — | — |

---

# Part G — `WallCaptureRail` and `WallRailChips`

Source: `LevelLog.tsx:1081–1266`. Wrapper `padding 14px 18px 12px · borderBottom
1px C.border`.

**Paint target: DOM.** Absolutely-positioned `<span>` elements inside a
`position:relative` track. **No canvas, no SVG.** No `data-cb-layer` and no
visibility guard are required by v3's rules for this component.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| G1 | Mark collection | `byKey: Map<string, RailMark>` (1118–1141) | Key `` `${slot}|${lt}` ``. `put(m, strong)`: when `strong === false` an existing key is **kept** (`if (!strong && byKey.has(k)) return`); when `true` it is **overwritten** | — | Log rows go in first with `strong=false`, so the **first** log row for a (slot, level) wins over later ones. Events go in with `strong=true` and always win — "price tagged it" is the story, "the level also moved" the footnote (comment 1116–1117) |
| G2 | Slot bounds | `if (r.slot < 0 \|\| r.slot >= WALL_SLOTS) continue` (1125, 1135) | Accepts slots `0 … 26` inclusive of 0, exclusive of 27 | — | Out-of-range rows are silently dropped from the rail but still reach the timeline (Part L has no such guard) |
| G3 | Mark sort | `[...byKey.values()].sort((a,b) => a.slot - b.slot)` (1143) | Slot ascending only — **no tie-break.** Within one slot the order is Map insertion order: log rows in server order, then events in server order | — | — |
| G4 | `lastSlot` | `marks.length ? marks[marks.length-1].slot : 0` (1144) | The largest in-range slot carrying any mark | — | `0` when nothing is recorded — the fill is then zero-width |
| G5 | Track | inline (1172) | `position relative · flex 1 1 auto · height 6 · borderRadius 3` | `background rgba(255,255,255,0.055)` | Always renders |
| G6 | Fill | inline (1173–1176) | `position absolute · left 0 · top 0 · bottom 0 · width {railPct(lastSlot)}% · borderRadius 3` | `linear-gradient(90deg, rgba(33,158,188,0.3), rgba(33,158,188,0.09))` | Zero width when nothing is recorded |
| G7 | `railPct` | `(slot / (WALL_SLOTS - 1)) * 100` (1109) | `slot / 26 * 100`. Slot 0 → 0 %, slot 13 → 50 %, slot 26 → 100 % | — | — |
| G8 | Left gutter label | Static | `"09:29"` — `12px (FS_META)` mono, `flex 0 0 auto` | inherits `HT.text` | Always |
| G9 | Right gutter label | Static | `"16:00"` — same | inherits `HT.text` | Always |
| G10 | Hour ticks | `RAIL_HOURS` (1105–1108) | Six ticks: slot 2→`"10"`, 6→`"11"`, 10→`"12"`, 14→`"13"`, 18→`"14"`, 22→`"15"`. Each `position absolute · left railPct(slot)% · top -4 · width 1 · height 14`, `aria-hidden` | `background rgba(255,255,255,0.13)` | **There is no 09:30 tick and no 16:00 tick** — the two ends are the gutter labels only |
| G11 | Hour labels | second row (1193–1200) | `position relative · height 12 · margin "3px 62px 0 52px"` — inset by the two gutters so the labels line up with their ticks rather than the flex row. Each `left railPct(slot)% · transform translateX(-50%) · 10px` mono, `aria-hidden` | inherits `HT.text` | — |
| G12 | Mark — `approach` | `dot()` (1155–1157) | `9 × 9 · borderRadius 50% · transform translate(-50%,-50%) · left railPct(slot)% · top 50%` | `background transparent`, `border 1.5px solid c`, `boxShadow 0 0 8px rgba(c,0.4)` — **a hollow ring** | — |
| G13 | Mark — `touch` | `dot()` (1158–1160) | `11 × 11`, same positioning | `background c`, `border 2px solid HT.bg #05060A`, `boxShadow 0 0 0 2px rgba(c,0.3), 0 0 12px rgba(c,0.55)` — **a ringed disc**, the largest mark | — |
| G14 | Mark — `open` | `dot()` (1161–1163) | `9 × 9` | `background c`, `boxShadow 0 0 9px rgba(c,0.5)` — **a filled disc** | — |
| G15 | Mark — `change` | `dot()` fallthrough (1164) | `7 × 7` | `background c`, `boxShadow 0 0 8px rgba(c,0.5)` — **the smallest mark** | — |
| G16 | Mark colour | `LEVEL_COLOR[m.lt]` (1150) | **Colour carries the LEVEL, shape carries the kind** (comment 1146–1148): `call_wall` `#30d158`, `put_wall` `#ff4757`, `cb` `#ffd600` | — | — |
| G17 | Mark `title=` — open | `note` (1129–1130) | `` `{at} · {LEVEL_LABEL} baseline {wallStrike(strike)}` `` | none | — |
| G18 | Mark `title=` — change | `note` (1131) | `` `{at} · {LEVEL_LABEL} → {wallStrike(strike)}{delta != null ? ` ({+|}{wallNum(delta)})` : ""}` `` — the `+` is added only for `delta > 0`; a negative delta carries its own `-` from `wallNum` | none | Parenthetical omitted when `delta` is null |
| G19 | Mark `title=` — event | `note` (1138–1139) | `` `{at} · {LEVEL_LABEL} {tagged\|approached} {wallStrike(strike)} · spot {wallNum(spot_at_hit)}` `` + `` ` · {REACTION_LABEL[reaction]}` `` when a reaction exists | none | Reaction clause omitted while unresolved |
| G20 | Chip row | `WallRailChips` (1265) | `flex · gap 7 · flexWrap wrap · alignItems center · marginTop 12` | none | **Returns `null` outright when `marks.length === 0`** (1210) — no empty-state text |
| G21 | Chip | inline (1231–1253) | `inline-block · border-box · height 24 · lineHeight 22px · padding "0 9px 0 7px" · radius 7 · 11.5px` mono · `nowrap`, carries `data-cap-center` | `border 1px C.border`, `background rgba(255,255,255,0.028)` | **Deliberately inline-block, not inline-flex** — `align-items:center` is a line-box trick html2canvas does not implement (comment 1224–1230) |
| G22 | Chip contents, in order | (1238–1252) | ① dot: `inline-block · verticalAlign middle · marginRight 7 · 6×6 · radius 50%`, filled `c` with `boxShadow 0 0 7px rgba(c,0.55)` unless kind is `approach`, which is `transparent` + `1.5px solid c` and **no shadow**. ② `{m.at}` with `marginRight 7`. ③ `<b style="fontWeight:700; marginRight:7">{RAIL_KIND_LABEL[kind]}</b>` — `OPEN` / `MOVE` / `TAG` / `NEAR`, already uppercase, no `textTransform`. ④ level label: `10px · letterSpacing .12em · uppercase · color LEVEL_COLOR · marginRight "-0.12em"` — the negative margin cancels the trailing letter-space, because `textIndent` has no effect on an inline box (comment 1247–1249) | Dot and label colour = `LEVEL_COLOR[m.lt]` | — |
| G23 | Chip `title=` | `m.note` | The same string as the rail mark's tooltip **minus the leading `{at} · `** — the chip already prints the time | none | — |
| G24 | Quiet collapse | (1214–1221, 1257–1264) | Between marks: when `prev >= 0 && gap >= 3` where `gap = m.slot - prev - 1`, emit `` `— {gap * 15}m quiet —` ``. At the end: `toClose = WALL_SLOTS - 1 - prev`; when `toClose >= 3`, emit `` `— {toClose * 15}m to close —` ``. Both `11px` mono, `padding "0 2px"` | inherits `HT.text` | **3 empty slots = 45 minutes** is the floor — below that the label is longer than the run (comment 1215). Note the quiet minutes are computed at a flat 15 min/slot, so a gap that spans the 09:29→09:45 boundary (16 min) is reported one minute short |

---

# Part H — `WallMigrationChart`

Source: `LevelLog.tsx:1268–1281`, `1488–1828` (model), `1830–2181` (render).
Wrapper `padding 13px 18px 12px · borderBottom 1px C.border`.

**Paint target: SVG.** One `<svg viewBox="0 0 100 {height}" height={height}
preserveAspectRatio="none" style="width:100%; display:block">` containing
`<line>` and `<polyline>` only. **No canvas.** No `<text>` and no `<circle>` are
placed inside it, and every stroke carries `vectorEffect="non-scaling-stroke"`
so the horizontal squash never thickens a line (comment 2104–2107). No
`data-cb-layer` and no visibility guard are required by v3's rules.

### H1 — Gate and model

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| H1 | Component gate | `if (!model) return null` (1830) | The **whole panel disappears** rather than render an empty frame | — | Four independent null returns build `model`: no level has rows (1617), no day produced a segment (1796), fewer than 2 y-values (1806), no level earns a legend chip (1825) |
| H2 | `levels` | `VIEW_LEVELS[view].filter(lt => days.some(d => d.log.some(r => r.level_type === lt)))` (1616) | **Union across days, not intersection** — a level present on 3 of 5 sessions draws on those 3 (comment 1613–1615) | — | Empty → `null` |
| H3 | Per-day re-filter | `day.log.filter(r => inView(view, r.level_type))` (1625–1626) | Applied again inside the loop so the inline chart (pre-filtered rows) and the popout's week fetch (raw rows) count the same captures. Idempotent | — | — |
| H4 | `lastWrite` | max in-range `r.slot` and `e.hit_slot` (1632–1633) | Where the LOG stopped writing | — | `0` when nothing wrote |
| H5 | `tapeAll` | `price.map(p => ({s: slotAtMins(p.mins), v: p.px})).filter(p => finite(s) && s >= 0 && s <= 26 && v > 0)` (1656–1658) | The 1-minute tape mapped onto fractional slots | — | `[]` when the tape read failed |
| H6 | `lastSlot` — the x extent | `Math.min(26, Math.max(lastWrite, Math.ceil(tapeEnd)))` (1661) | **The extent is the TAPE, not the log.** Mid-session the tape ends at the last closed minute so the chart ends at now; on a past date it ends at 16:00 (comment 1636–1655) | — | With no tape, `tapeEnd` is 0 and the extent falls back to `lastWrite` |
| H7 | Forward fill | (1664–1681) | Per level: rows filtered to that type, in-range, finite strike; sorted by slot; then `for s = 0..lastSlot` take the last row with `slot <= s`. Array length is always 27, `null`-filled | — | A level with no rows is `continue`d — **not drawn at all**, no placeholder |
| H8 | Why a step | comment 1522–1526 | Every level is a STEP and never a slope. A diagonal between two captures would draw the level at prices it never occupied | — | — |
| H9 | `coreG` | (1706–1717) | Same forward fill over `cb` rows with a finite `level_gex` | — | All-null when no `cb` row carried gamma |
| H10 | Role gate | `if (cbArr && (cwArr \|\| pwArr))` (1730) | Roles only exist when CORE **and** at least one wall are in play — the WALLS view (no `cb`) and the CORE view (no walls) fall through to plain per-level drawing (comment 1723–1728) | — | `roles = null` |
| H11 | `coreSide` — rule 1 | `a != null && c === a` → `"call"` (1748) | **Exact strike equality against the call wall** | — | — |
| H12 | `coreSide` — rule 2 | `b != null && c === b` → `"put"` (1749) | Exact equality against the put wall | — | — |
| H13 | `coreSide` — rule 3 | `g = coreG[s]; g != null && g !== 0` → `g > 0 ? "call" : "put"` (1751–1752) | The recorded gamma sign. **Zero is explicitly excluded** and falls through | — | — |
| H14 | `coreSide` — rule 4 | `a != null && b != null` → `Math.abs(c-a) <= Math.abs(c-b) ? "call" : "put"` (1753) | The nearer wall. **Ties go to `call`** | — | — |
| H15 | `coreSide` — rule 5 | `a != null ? "call" : "put"` (1754) | Whichever wall exists | — | Last resort; never null |
| H16 | Role assignment | (1756–1758) | `core[s] = c`; `o = coreSide === "call" ? b : a` — the OTHER wall; when `o != null`, `other[s] = o` and `side[s] = coreSide === "call" ? "put" : "call"` | — | `roles` is committed only when `core.some(v => v != null)` (1760) |
| H17 | Spot captures | (1766–1774) | `spot[]` filled from every `log` row with a finite `spot > 0`, **then** every `event` with a finite `spot_at_hit > 0` — so a tag's `spot_at_hit` **overwrites** the level row at the same slot (comment 1763–1765) | — | `spotPts` = the non-null entries as `{s, v}` |
| H18 | `dense` | `tape.length >= 20` where `tape = tapeAll.filter(p => p.s <= lastSlot)` (1784–1785) | **Twenty 1-minute bars is the threshold** for using the tape | — | Decided **per day**, so one session missing its tape does not downgrade the other four (comment 1781–1782) |
| H19 | `spotDrawn` | `dense ? tape : spotPts.map(…)` (1786) | The tape when it arrived, the log's own captures when it did not — **never the two spliced together** | — | — |
| H20 | Segment drop | `if (!series.size && !spotDrawn.length) continue` (1793) | A day with neither levels nor spot contributes no segment | — | — |
| H21 | y range | (1801–1812) | One range across **every** day: all non-null level values plus every `spotDrawn.v`. `lo = min`, `hi = max`; degenerate case `!(hi > lo)` → `c = lo \|\| 1; lo = c*0.999; hi = c*1.001`; then `padY = (hi-lo)*0.08` applied to both ends | — | **`vals.length < 2` → `null`, the whole panel disappears**. Per-day scaling is rejected on purpose — the week view exists to show a wall holding its strike across days (comment 1798–1800) |
| H22 | `kept` — legend eligibility | (1818–1824) | `roled = segs.some(s => s.roles)`. When not roled: a level is kept if any segment has a series for it. When roled: `cb` is always kept; a wall is kept only if `seg.roles.side.some(v => v === want)` — i.e. **it is the OTHER line somewhere**. A wall that is the CORE all session takes no chip, because that chip would toggle nothing (comment 1814–1817) | — | `!kept.length` → `null` |

### H2 — Geometry

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| H23 | viewBox | (2109) | `0 0 100 {height}` with `preserveAspectRatio="none"` — the x axis is slots, the y axis is price, and the two have no business sharing a scale (comment 2104) | — | `height` = `MIG_H` `250` inline, `MIG_H * 2.2` = **550** in the popout |
| H24 | `segW` | `100 / N` (1833) | Each day owns an equal slice of the 100-wide viewBox — **equal width per day, not equal minutes** (comment 1843–1845) | — | `N = 1` inline |
| H25 | `x(i, s)` | `i * segW + (s / Math.max(1, segs[i].lastSlot)) * segW` (1846) | Each day's slots run edge to edge inside its slice. The `max(1, …)` guards a day whose `lastSlot` is 0 | — | — |
| H26 | `y(v)` | `MIG_PAD + (1 - (v - lo)/(hi - lo)) * (height - MIG_PAD * 2)` (1847) | `MIG_PAD = 8` top and bottom | — | — |
| H27 | `stepRun` | (1854–1867) | Walks one day's fill. For each slot with a non-null value: when it differs from `prev`, first emit `x(i,s),y(prev)` — **the vertical riser** — then `x(i,s),y(v)`. Never crosses a day boundary | — | `reverse` param exists and is **never passed `true`** by any caller — dead |
| H28 | `stepRuns` | (1876–1889) | One polyline **per contiguous non-null run**, because the CORE-sign rule punches holes mid-day and a single polyline would bridge one with a diagonal through strikes the wall never held (comment 1869–1875) | — | `undefined` array → `[]` |
| H29 | Day dividers | (2114–2117) | `<line>` at `x = (k+1) * segW` for `segs.slice(1)`, `y1 0 → y2 height` | `stroke rgba(255,255,255,0.22)`, `strokeWidth 1`, `vectorEffect non-scaling-stroke`, **solid** | Absent when `N === 1` |
| H30 | Held-from mark | `heldFrom = last.lastWrite < last.lastSlot ? x(N-1, last.lastWrite) : null` (1977, 2121–2125) | `<line>` `y1 0 → y2 height`, `strokeDasharray "3 3"` | `stroke rgba(255,255,255,0.16)`, `strokeWidth 1` — **dashed, unlike the solid day divider**, because one is a gap in the clock and the other a gap in the rows (comment 2111–2113) | Absent when the log wrote all the way to the extent |
| H31 | Draw order — plain | `drawOrder = ["put_wall","call_wall","cb"]` (1925), `drawn = drawOrder.filter(lt => levels.includes(lt))` (1926) | Walls first so the gold CORE reads on top of the wall it coincides with | — | — |
| H32 | Stroke widths — plain | (1964) | `lt === "cb" ? 2.2 : 1.8` | `LEVEL_COLOR[lt]` | — |
| H33 | Role branch gate | `if (roled && !off.has("cb"))` (1928) | **Switching CORE off drops the role model with it** — both walls go back to their own recorded series and each runs the full span (comment 1915–1923) | — | — |
| H34 | OTHER line | (1935–1953) | One polyline per contiguous same-side run. `stepRun(i, r.other, a, b)`, then when `r.other[b+1] != null && b+1 <= L` push `x(i,b+1),y(r.other[b])` and `x(i,b+1),y(nx)` so consecutive runs meet at the vertical edge instead of leaving a slot-wide hole | `LEVEL_COLOR[sd === "call" ? "call_wall" : "put_wall"]`, `w = 1.8`. Skipped when `off.has(lt)` for that side | — |
| H35 | CORE line | (1955–1957) | `stepRuns(i, r.core)`, one polyline per run | `LEVEL_COLOR.cb #ffd600`, `w = 2.2` | No `off.has("cb")` guard here — the branch only runs while CORE is on (comment 1954) |
| H36 | Level polylines | (2126–2129) | `fill="none"`, `vectorEffect="non-scaling-stroke"`, `strokeLinejoin="miter"` | per H32/H34/H35 | — |
| H37 | Spot polyline | (1970–1974, 2131–2134) | One per segment, `seg.spotDrawn.map(p => `${x(i,p.s)},${y(p.v)}`)`. `strokeWidth 1.5`, `vectorEffect non-scaling-stroke`, **no `strokeLinejoin`** | `stroke HT.text #FFFFFF`. Drawn **last**, so it reads on top of the levels it is being compared with (comment 2130) | `off.has("spot")` → `[]`. Segments with an empty `d` are filtered out |

### H3 — Head, legend, axis

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| H38 | `WALL MIGRATION` | Static (2071–2073) | `12px (FS_LABEL) / 800 · letterSpacing .12em · uppercase` | inherits `HT.text` | Always renders when the panel does |
| H39 | Caption | (2074–2078) | `` `{N > 1 ? `${N} sessions · ` : ""}recorded levels · {anyDense ? `${totalMins} min of price` : `${totalCaps} spot capture{s}`}` `` — `12px (FS_META)` mono. `totalMins` = Σ `seg.spotDrawn.length` over dense segments only; `totalCaps` = Σ `seg.spotPts.length` over all; `anyDense` = `segs.some(s => s.dense)`. Plural `totalCaps === 1 ? "" : "s"` | `color MUTED #FFFFFF` | **Mixed-mode inaccuracy: when any segment is dense the caption prints `totalMins` only, which counts the dense segments and ignores the non-dense ones entirely** |
| H40 | `⤢ EXPAND` | (2079–2093) | Rendered only when `onExpand` is given — the inline card, never the popout. `marginLeft auto · padding 3px 9px · radius 7 · 12px / 800 · letterSpacing .08em · uppercase`, carries `data-capture-hide` | `border 1px C.border`, `background rgba(255,255,255,0.03)`, `color C.label` | `title="Open this chart full size — and over the last 5 sessions"` |
| H41 | Legend row | (2099–2102) | `flex · gap 14 · alignItems center · flexWrap wrap · marginBottom 6`. Order: `drawn` in `["put_wall","call_wall","cb"]` order, then `spot` | — | The spot chip renders only when `lastSpot != null`, where `lastSpot = last.spotDrawn.at(-1)?.v` |
| H42 | Legend chip | `legendChip` (2001–2064) | `<button>`, `position relative · inline-block · border-box · nowrap · height 16 · lineHeight 16px · padding "0 0 0 17px"` (= `LEGEND_SWATCH + 6`) `· radius 6 · border 1px transparent · background transparent · fontFamily inherit · 11px · cursor pointer`, carries `data-cap-center` and `aria-pressed={on}` | `color MUTED #FFFFFF`, `opacity: on ? 1 : 0.4` | `title` = `` `Hide {label}` `` when on, `` `Show {label}` `` when off |
| H43 | Legend swatch | (2054–2059) | `<span aria-hidden data-cap-swatch>`: `position absolute · left 0 · top 50% · marginTop -5.5 · display block · border-box · 11 × 11 · radius 2` — **taken out of the line box on purpose** (comment 2022–2053) | `background: on ? color : "transparent"`, `border 1px solid color` — off hollows the square out | — |
| H44 | Legend labels + values | (2060–2061, 2100–2101) | Label `verticalAlign middle · marginRight 6`; value `verticalAlign middle · fontFamily var(--font-mono)`. Levels: `LEVEL_LABEL[lt]` = `"Put Wall"` / `"Call Wall"` / `"CORE"` with `wallStrike(lastOf(lt))`. Spot: label **`"spot"` — lowercase, unlike the other three** — with `wallNum(lastSpot)`. `lastOf(lt)` (1892–1899) walks segments **newest first**, and within a segment slots **downward from `lastSlot`**, returning the first non-null | Value colour: `on ? HT.text : MUTED` — **both are `#FFFFFF`, so toggling changes nothing about the value's colour** | `wallStrike(null)` → `—` |
| H45 | Legend state | `off: Set<MigKey>` (1603–1608) | Held as the set of what is **OFF**, so a level that appears later (a week fetch landing, the view switching) arrives visible (comment 1599–1602). `MigKey = WallLevel \| "spot"` | — | **Local to each `WallMigrationChart` instance.** The popout mounts a second instance, so its toggles are independent of the inline card's and reset every time it opens. Switching `view` does not reset either |
| H46 | Watermark | (2139–2148) | `<img src="/cb-edge-logo.png" alt="CB Edge">` — `position absolute · right 16 · bottom 12 · height 58 · width auto · opacity 0.4 · pointerEvents none · userSelect none`. **Not `data-capture-hide`** — riding into the screenshot is the point (comment 2136–2138) | — | Rendered only when the `watermark` prop is passed — **the popout only**. The inline card omits it |
| H47 | Axis — single session | (2153–2161) | `flex · justifyContent space-between · marginTop 5 · 10px` mono, `aria-hidden`. Three stamps: `slotClock(0)`, `slotClock(Math.round(last.lastSlot / 2))`, `slotClock(last.lastSlot)` | `color MUTED #FFFFFF` | Always three, even on a two-slot day |
| H48 | Axis — multi session | (2162–2174) | `flex · marginTop 5`, `aria-hidden`. Per segment `flex 0 0 {segW}% · textAlign center`, containing `dowName(seg.date)` — `block · 10px / 800 · letterSpacing .1em · uppercase · color C.label` — over `mdShort(seg.date)` — `block · 10px` mono | Container `color MUTED`; weekday overridden to `C.label` — **both `#FFFFFF`** | — |
| H49 | No caption under the plot | comment 2176–2178 | Deliberate: the legend names every series and the page head carries the scope | — | — |

---

# Part I — `WallMigrationPopout`

Source: `LevelLog.tsx:1063–1076`, `2304–2432`, `2434–2443`.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| I1 | Mount gate | `{popout ? <WallMigrationPopout … /> : null}` (1065) | **Mounted only while open**, so the 5-session fetch never runs for a reader who did not ask for it (comment 1063–1064) | — | — |
| I2 | Portal | `ModalPortal` (2439–2443) | `createPortal(children, document.body)`, host set in a `useEffect` so `document` is not touched during SSR/prerender. Renders `null` until the effect runs | — | **v2-only chrome — do not port; see Part S** |
| I3 | Scrim | (2363–2369) | `position fixed · inset 0 · zIndex 9998 · display flex · alignItems center · justifyContent center · padding 24` | `background rgba(0,0,0,0.72)` | `onClick={onClose}` |
| I4 | Panel | (2370–2377) | `{...CARD, width "min(1400px, 96vw)", maxHeight "92vh", overflow auto, display flex, flexDirection column, position relative}`, carries `panelRef` | `CARD` | `onClick={e => e.stopPropagation()}` so a click inside never dismisses it mid-read |
| I5 | Escape key | (2345–2349) | `window.addEventListener("keydown", …)`, `e.key === "Escape"` → `onClose()`. Removed on unmount | — | — |
| I6 | Head row | (2382) | `data-capture-hide` on the **whole** head — `snapshot.ts` already bakes a title band carrying the ticker, range and variant, so this row came out as the same sentence twice (comment 2378–2381). `flex · gap 12 · alignItems center · flexWrap wrap · padding 14px 18px · borderBottom 1px C.border` | — | Dropped from the PNG |
| I7 | Popout title | (2383–2385) | `` `{symbol ?? "—"} — Wall migration` `` → uppercase — `15px / 800 · letterSpacing .1em` | `color C.cyan #219EBC` | `— — WALL MIGRATION` with no symbol |
| I8 | Popout sub-line | (2386–2388) | `` `{variantTag(scope, basis)} · {VIEW_SCOPE[view]} view` `` — `12px (FS_META)` mono. e.g. `0DTE · OI+vol GEX · level view` | `color MUTED #FFFFFF` | — |
| I9 | `TODAY` / `5 SESSIONS` | (2389–2392) | `chip(on)` (2351–2357) = the page's `chipStyle` re-declared locally, **cyan-only, no colour parameter**: `padding 6px 12px · radius 8 · fontFamily inherit · 13px / 800 · letterSpacing .08em · uppercase` | On: border+text `C.cyan`, bg `rgba(33,158,188,.16)`. Off: border `C.border`, text `C.label`, bg `rgba(255,255,255,0.03)` | **Default is `5`** (2329). `title`: `` `Just {date}` `` / `"The last 5 recorded sessions ending on the selected date"` |
| I10 | Range behaviour | `days = range === 1 ? today : week.days` (2331) | `"Today"` reuses the page's already-loaded `todayDays` — **no refetch**. `"5 sessions"` calls `useWallDays(symbol, date, 5, nonce, scope, basis)`; passing `null` for the symbol when `range !== 5` keeps that hook idle | — | Both honour the page's view and both variant switches |
| I11 | Loading pip | (2393–2395) | `` `loading…` `` — `12px (FS_META)`, rendered only when `range === 5 && week.loading` | `color MUTED #FFFFFF` | — |
| I12 | Button group | (2398) | A **second** `data-capture-hide` nested inside the head's, `marginLeft auto · flex · gap 8 · alignItems center` | — | Redundant but harmless |
| I13 | `📸 PNG` | `SnapLogButton` (2399–2404) | Same component as F16. `targetRef = panelRef` — **the target is the PANEL, not the chart**, because a PNG of the plot alone is a picture of some lines with no idea what they are of (comment 2333–2338). `disabled = !days.length` | Same ladder as F16 | `snapFile` = `` `{symbol?.toLowerCase() ?? "walls"}-wall-migration-{view}-{scope}-{basis}-{date}{range===5?"-5d":""}.png` ``. `snapTitle` = `` `{symbol ?? "—"} — Wall migration · {range===5?"5 sessions to ":""}{date} · {variantTag(scope,basis)}` `` |
| I14 | `✕ CLOSE` | (2405–2415) | `padding 6px 12px · radius 8 · fontFamily inherit · 13px / 800 · letterSpacing .08em · uppercase` | `border 1px C.border`, `background rgba(255,255,255,0.03)`, `color C.label` | Never disabled |
| I15 | Chart / empty | (2419–2427) | `days.length` → `<WallMigrationChart days={days} view={view} height={MIG_H * 2.2} watermark />` (**550 px**, watermark on, **no `onExpand`** so no Expand button). Otherwise a `padding 28 · 13px (FS_BODY)` block | `color MUTED #FFFFFF` | Loading: `"Loading sessions…"`. Otherwise: `` `No recorded sessions for {symbol ?? "—"} in the 5 weekdays ending {date} on {variantTag(scope,basis)}.` `` — **says "5 weekdays" as a literal even when `range === 1`** |

---

# Part J — `GexChurnHistory` as used here

Source: `LevelLog.tsx:640–643`, `1008–1023`; `GexHeatBar.tsx:350–534`.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| J1 | Placement | `<div data-capture-hide>` (1021–1023) | Between the migration chart and the timeline scroller. **Dropped from the PNG deliberately**: framed capture expands the scroll body without reflowing siblings, so anything between the two gets drawn over (comment 1015–1020) | — | — |
| J2 | Hook call | `useGexChurnHistory(sel)` (643) | **Keyed on `sel` alone** — switching date, view, scope or basis does not re-request a series that is the same either way (comment 640–642). `days` takes the hook default **45** | — | `symbol == null` → `rows = []`, `note = ""`, and the effect returns early without touching `loading` |
| J3 | Strip container | (417–425) | `padding 12px 18px · borderTop 1px HT.border · flex column · gap 8` | — | Always renders while `sel` is set |
| J4 | `GAMMA BOOK CHURN` | Static (428–430) | `13px / 800 · letterSpacing .14em · uppercase` | `color HT.text #FFFFFF` | Always |
| J5 | Sub-line | (431–433) | `` `how much of {symbol}'s book rewrote itself, session by session` `` | `color HT.text` | `"pick a ticker"` when `symbol` is null |
| J6 | Loading | (436–437) | `"Loading…"` — `12px` | `color HT.text` | Shown while `loading` |
| J7 | No symbol | (438) | `null` — the body renders nothing below the head | — | — |
| J8 | No rows | (438–441) | `note \|\| `Nothing on file for {symbol}.`` — `12px · lineHeight 1.6` | `color HT.text` | The server's own `note` wins when present |
| J9 | Row window | `shown = [...rows].reverse().slice(0, limit)` (414) | **Newest first** — a log page reads backwards from the selected session (comment 412–413). `limit` defaults to **12** and the page passes none. **45 sessions are fetched; 12 are rendered** | — | — |
| J10 | Row date | `r.date.slice(5)` (460) | `"MM-DD"` — `11px` mono, `width 46 · flex 0 0 auto` | `color HT.text` | — |
| J11 | Bar track | (470–483) | `position relative · flex 1 · height 8 · radius 8 · overflow hidden` | `background rgba(255,255,255,0.06)` (`themeRgba(HT.muted, 0.06)`). When `provisional`, adds `repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 4px, transparent 4px 8px)` — a hatched track. `opacity 0.45` when `r.clean === false` | — |
| J12 | Bar fill | (485–494) | `width {frac*100}% · height 100%`, `background linear-gradient(90deg, buildShareColor(buildShare, 0.82), buildShareColor(buildShare))`. `heatFill`: `heat == null \|\| !finite` → `{frac: clamp01(churnPct / 100), provisional: true}`; else `{frac: clamp01(heat / 4), provisional: false}` — **`HEAT_EXTREME = 4`, `PROVISIONAL_MAX_PCT = 100`** | `buildShareColor(s)` mixes `HT.panel #0D1119` toward `ES_CANDLE_DOWN #ff5b5b` when `s < 0` and toward `LIGHT_BLUE #7dd3fc` otherwise, at `t = 0.4 + 0.6 * |s|^0.55` (`RAMP_FLOOR = 0.4`, `RAMP_EASE = 0.55`) | — |
| J13 | Row `title=` | (464–469) | `` `{date} — {Math.round(churnPct)}% of the book changed` `` + (`heat != null` ? `` `, {heat.toFixed(1)}× a normal day` `` : `" (no baseline yet)"`) + `` ` · build share {buildShare.toFixed(2)}` `` + (`flag` ? `` ` · {flag}` `` : `""`) | none | — |
| J14 | Row value + flag | (497–521) | Value: `heat != null ? `{heat.toFixed(1)}×` : `{Math.round(churnPct)}%`` — `11px / 700` mono, `width 54 · textAlign right`. Flag: `r.isOpex ? "OPEX" : r.isEarnings ? "ERN" : null` — `9px · letterSpacing 0.5 · width 34` | Value colour = `buildShareColor(buildShare)`. Flag colour `HT.text` | Flag cell renders `""` when neither applies, holding its 34 px. Trailing `note` line at `10px · lineHeight 1.5` in `HT.text` when present |

---

# Part K — Variant-empty note

Source: `LevelLog.tsx:1025–1041`.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| K1 | Gate | `empty && sel && !(scope === "0dte" && basis === "oivol")` (1030) | Renders **only off the default variant** — a variant with nothing in it is almost always "not recorded yet" rather than "nothing happened" (comment 1025–1029) | — | On the default pair an empty log shows only `WallTimeline`'s own sentence (L27) |
| K2 | Block | (1031) | `padding 12px 18px · 13px (FS_BODY) · borderTop 1px C.border` | `color MUTED #FFFFFF` | — |
| K3 | Text | (1032–1033) | `` `Nothing recorded for {sel} on ` `` + `<b style="color: C.label">{vTag}</b>` + `` ` for {date}. The non-0DTE and vol-only legs are recorded forward only — nothing reconstructs them for past sessions. ` `` | The `<b>` takes `C.label #FFFFFF` — **identical to the surrounding `MUTED #FFFFFF`, so the emphasis is carried by `font-weight` alone** | The legs started being written **2026-08-27**; any earlier date has only the default pair (comment 1026–1028) |
| K4 | `BACK TO 0DTE · OI+VOL` | (1034–1039) | `{...chipStyle(false), padding "3px 8px", fontSize 12}` → uppercase. `onClick={() => { setScope("0dte"); setBasis("oivol"); }}` | Always the "off" chip colours: border `C.border`, bg `rgba(255,255,255,0.03)`, text `C.label` | Two `setState` calls in one handler — React batches them into one refetch |

---

# Part L — `WallTimeline`

Source: `LevelLog.tsx:1043–1048`, `2446–2608`. Scroller: `className="wall-scroll"
· maxHeight 620 (LEVEL_LOG_H) · overflowY auto`. Body: `padding 6px 18px 18px`.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| L1 | Entry shape | `Entry` (2465–2470) | `{slot, at, kind: "open"\|"change"\|"hit", lt, strike, body: ReactNode, meta?: string, side?: "below"\|"above"}` | — | — |
| L2 | Log entries | (2473–2481) | `kind = r.reason` (the server's `"open"` / `"change"` verbatim), `strike = Number(r.strike)` | — | **No slot-range guard** — unlike the rail (G2), an out-of-range slot still produces a timeline row |
| L3 | Open body | (2477) | `Open baseline — **{wallStrike(strike)}**. Spot **{wallNum(spot)}**.` — both bolds are `<b style="fontFamily: var(--font-mono)">` | inherits `HT.text` | `—` inside the bold on a null |
| L4 | Change body | (2478) | `Rolled {up\|down} **{wallStrike(prev_strike)} → {wallStrike(strike)}**.` | inherits | `Number(r.delta) > 0 ? "up" : "down"` — **a null `delta` becomes `NaN`, `NaN > 0` is false, so it reads "Rolled down"** |
| L5 | Log meta | (2479) | `` `GEX at level {gexShort(level_gex)}` `` | inherits | `undefined` when `level_gex` is null — the meta line is then omitted entirely |
| L6 | `approachSide` | (2457–2461) | `call_wall → "below"`, `put_wall → "above"`, `cb → spot_at_hit <= strike ? "below" : "above"`. Walls have a fixed side; CORE has none, so it comes off spot vs strike at the tag (comment 2446–2456) | — | Ties (`spot === strike`) go to `"below"` |
| L7 | Approach body | (2494–2498) | `Came {up\|down} to **{wallNum(spot_at_hit)}**` then either ` — **{wallNum(miss)}** short of **{wallStrike(strike)}**, never tagged` when `miss != null`, or `, right on **{wallStrike(strike)}** but never tagged`; then `` ` — {note}.` `` or `.` | inherits | `up` when `side === "below"` |
| L8 | Touch body | (2499) | `Tagged **{wallStrike(strike)}** from {side} at **{wallNum(spot_at_hit)}**` then `` ` — {note}.` `` or `.` | inherits | — |
| L9 | Meta ① excursion | (2505–2509) | `!approach && excursion_pts != null` → `excursion_pts >= 0` ? `` `pushed {wallNum(|excursion_pts|)} {side === "below" ? "up through" : "down through"}` `` : `` `stayed {wallNum(|excursion_pts|)} short of it` `` | — | Excursion is measured in the BREAK direction, the opposite side from the approach (comment 2501–2504) |
| L10 | Meta ② reclaim | (2510) | `` `reclaimed in {reclaim_min}m` `` | — | Omitted when null |
| L11 | Meta ③ attempts | (2511) | `!approach && attempts > 1` → `` `attempt {attempts} on this strike` `` | — | Omitted on an approach and on a first attempt |
| L12 | Meta ④ core | (2512) | `was_core` → `core_held === false ? "was the CORE — CORE moved after" : "was the CORE"` | — | **`core_held === true` and `core_held === null` both render `"was the CORE"`** — the strict `=== false` does not distinguish them |
| L13 | Meta ⑤ GEX | (2513) | `` `GEX at level {gexShort(gex_at_hit)}` `` | — | Omitted when null |
| L14 | Meta ⑥ build | (2514) | `build = gexBuildPct(gex_at_hit, gex_at_resolve)`; `` `{build >= 0 ? "built" : "bled"} {|build|.toFixed(0)}% by resolve` `` — **0 dp** | — | Omitted when null. **`build === 0` renders `built 0%`** |
| L15 | Meta ⑦ watching | (2515) | `reaction == null` → `"watching — resolves 4 slots after the tag"` | — | — |
| L16 | Meta join | (2516) | `.filter(Boolean).join(" · ")` — the seven in that exact order | `12px (FS_META)` mono · `marginTop 6` · `lineHeight 1.5` | Empty string → the meta `<div>` is not rendered (`e.meta ? …` at 2601) |
| L17 | Sort | (2523–2524) | `kindRank = k => k === "hit" ? 1 : 0`; `entries.sort((a,b) => a.slot - b.slot \|\| kindRank(a.kind) - kindRank(b.kind))` | — | **Default and only sort: slot ascending, then changes/opens before hits.** `open` and `change` both rank 0, so they tie and fall back to `Array.prototype.sort`'s stability — i.e. the order the server returned `log` in. **There is no sort UI and no way to reverse the direction.** Oldest first, so the open baseline leads and the latest slot lands at the bottom (comment 2520–2522) |
| L18 | `evByKey` | (2526) | `new Map(events.map(e => [`${e.hit_slot}|${e.level_type}`, e]))` | — | **Last event wins on a duplicate key.** Two events at the same slot on the same level produce two rows that both read the second event's badge |
| L19 | `twinsOf` | (2534–2539) | ALL view only. Same slot, **different** `lt`, finite and equal `strike`; deduped by first index. O(n²) over entries | — | Returns `[]` outside the ALL view — the pass does not run |
| L20 | Row grid | (2560–2562) | `display grid · gridTemplateColumns "58px 14px 1fr" · gap 10 · padding "11px 0" · borderBottom: last ? "none" : "1px solid rgba(255,255,255,0.05)"`. Key `` `${slot}-${kind}-${lt}-${i}` `` | — | — |
| L21 | Time column | (2566) | `{e.at}` — `12px (FS_META)` mono, `lineHeight 20px` (locks to `ROW_LEAD_H`) | inherits `HT.text` | Whatever the server sent; **the client does not parse or reformat it** |
| L22 | Timeline dot | (2570) | `position absolute · left 3.5 · top 6.5` (`(20-7)/2`) `· 7 × 7 · borderRadius 999` | `dot = hit ? AMBER #FB8501 : open ? HOME_THEME.orange #FB8501 : C.cyan #219EBC` — **`AMBER` IS `HOME_THEME.orange`, so a hit and an open baseline are the identical colour, written two ways. Only `change` is distinguishable.** `boxShadow 0 0 10px rgba(33,158,188,0.45)` — **always cyan, regardless of the dot's own colour** | — |
| L23 | Connector | (2571) | `position absolute · left 6.5 · top 16.5` (`(20+7)/2 + 3`) `· bottom -11 · width 1` | `background rgba(255,255,255,0.08)` | Omitted on the last row |
| L24 | Level chip | (2575–2577) | `LEVEL_LABEL[e.lt]` → uppercase — `12px (FS_LABEL) · lineHeight 20px · 800 · letterSpacing .12em` | `LEVEL_COLOR[e.lt]` | Always |
| L25 | Kind badge | (2578–2580) | `open` → `wallBadgeStyle(MUTED)` with `"Open baseline"` → **`OPEN BASELINE`**. `change` → `wallBadgeStyle(C.cyan)` with `"Changed"` → **`CHANGED`**. `hit` → `wallBadge(ev?.reaction ?? null, false, ev?.reclaim_min ?? null)` | Open badge is `MUTED #FFFFFF`; change badge is `C.cyan #219EBC` | See Part M for the nine reaction badges |
| L26 | Side chip | (2583–2588) | `↑ from below` / `↓ from above` — `12px (FS_META)` mono, `lineHeight 20px`. Rendered only on hit entries (`e.side` is set only there) | `side === "below"` → `GREEN #8ECAE6`; `"above"` → `RED #EF4444`. `title`: `"Price came into the level from below — a break goes up"` / `"Price came into the level from above — a break goes down"` | — |
| L27 | Twin chip | (2590–2598) | `` `= {LEVEL_LABEL[lt]}` `` → uppercase — `10px · lineHeight 20px · letterSpacing .12em`. `title` = `` `This strike is also the {LEVEL_LABEL[lt].toLowerCase()} at this slot — one level, two roles` `` — e.g. `…also the call wall at this slot…` | `LEVEL_COLOR[lt]` of the **twin**, not the row | ALL view only |
| L28 | Empty state | (2541–2551) | `padding 34px 18px · textAlign center · 13px (FS_BODY)`. Three strings by view: `core` → `"Nothing recorded on the CORE for this ticker — no baseline, no level changes, no touches."`; `all` → `"Nothing recorded for this ticker — no baseline, no level changes, no touches on either wall or the CORE."`; else (`walls`) → `"Nothing recorded on the walls for this ticker — no baseline, no level changes, no touches."` | inherits `HT.text` | **This is also the no-selection state** — `log` and `events` are `[]` when `detail` is null, so a page with no ticker chosen shows the ALL sentence |

---

# Part M — Reaction legend

Source: `LevelLog.tsx:296–367`, `1050–1059`.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| M1 | Legend row | (1055) | `data-capture-hide` · `flex · gap 8 · flexWrap wrap · padding 14px 18px · borderTop 1px C.border`. Kept out of the PNG because it is page chrome **and** because framed mode expands the scroll body without reflowing siblings, so it rendered on top of the timeline entries in the capture (comment 1050–1054) | — | Always renders, even on an empty log |
| M2 | The nine badges, in order | `(Object.keys(REACTION_LABEL) as WallReaction[]).map(rx => <span title={REACTION_RULE[rx]}>{wallBadge(rx)}</span>)` (1056–1058) | Insertion order of `REACTION_LABEL` (296–300) — see the table below | Each takes `wallBadgeStyle(REACTION_COLOR[rx])` | `wallBadge(rx)` is called with `short = false` and `reclaimMin = null`, so **the legend can never show `Break & reject`, and never shows `Untested`** — two badges the timeline renders that the legend does not explain |
| M3 | Break-then-reject override | `isBreakThenReject` (325–327), `wallBadge` (358–363) | `reaction === "break_5" \|\| reaction === "break_lt5"`, **and** `reclaim_min != null`. Label: `short ? "Brk→Rej" : `Break & reject ({reclaimMin}m)`` → uppercase, so it renders **`BREAK & REJECT (12M)`** — the `m` is uppercased by `textTransform`. `title` = `` `Broke, then reclaimed after {reclaimMin}m — failed break` `` | `wallBadgeStyle(GREEN #8ECAE6)` — **overrides the amber `REACTION_COLOR` for both break kinds** | `classify()` files "broke by 8 then failed" as `break_5` with `reclaim_min` set, deliberately, so the size label stays about distance; the page says so instead (comment 319–324) |

### The reaction taxonomy — all nine

| id | `REACTION_LABEL` (rendered uppercase) | `REACTION_COLOR` | Value | `REACTION_RULE` (the `title=`) |
|---|---|---|---|---|
| `reject` | `REJECT` | `GREEN` | `#8ECAE6` | `Tagged, never got past the touch band, faded ≥ 0.15% back inside` |
| `break_lt5` | `BREAK <5` | `AMBER` | `#FB8501` | `Pushed through to the far side of the level, but by less than the break threshold` |
| `break_5` | `BREAK +5` | `AMBER` | `#FB8501` | `Pushed ≥ 5 pts (0.15% for sub-$1000 names) through to the far side of the level — measured away from the side price approached on, so falling back the way it came never counts` |
| `consolidated` | `BROKE & CONSOLIDATED` (short: `CONSOL.`) | `HOME_THEME.orange` | `#FB8501` | `Broke through, then the last 3 samples all held on the far side inside a 0.10% range` |
| `new_wall` | `NEW WALL` | `C.cyan` | `#219EBC` | `Broke through, and the level itself then rolled in the break direction` |
| `pin` | `PINNED` | `LIGHT_BLUE` | `#7dd3fc` | `Sat inside the touch band for 3+ samples without resolving either way` |
| `rolled_over` | `ROLLED OVER` | `GREEN` | `#8ECAE6` | `Came inside 0.30% without ever tagging, then reversed away — the level held at distance` |
| `reached` | `APPROACHED, THEN TAGGED` | `MUTED` | `#FFFFFF` | `Approached, then tagged the level after all` |
| `stalled` | `STALLED NEAR` | `MUTED` | `#FFFFFF` | `Drifted near the level and neither tagged nor left` |
| *(null)* | `UNTESTED` | `MUTED` | `#FFFFFF` | *(no `title`)* — timeline only, never in the legend |

**Three of the nine share `#FB8501`** — `break_lt5` and `break_5` via `AMBER`,
`consolidated` via `HOME_THEME.orange`, which is the same constant written a
second way. **Two more share `#FFFFFF`** (`reached`, `stalled`) with the
`UNTESTED` badge and with body text. So nine reactions render in **five**
distinguishable colours.

**`REACTION_RULE` cannot be verified.** Its header says it "mirrors `classify()`
in `walls-recorder.js`"; that file is **not staged**. Every threshold in the
table above is transcribed from the client string, not confirmed against the
classifier.

---

# Part N — The formatters, written out

Source: `LevelLog.tsx:100–142`, `369–405`, `2183–2226`.

| # | Formatter | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| N1 | `rgba(hex, a)` | 100–104 | Strips `#`, expands a 3-digit hex by doubling each char, `parseInt(…, 16)`, then `` `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})` `` | — | A malformed hex yields `NaN` channels; no guard. **Duplicates `themeRgba` in `homeTheme.ts`, which does not handle 3-digit hex** |
| N2 | `gexShort(v)` | 370–377 | `a = |v|`, `sign = v < 0 ? "−" : "+"` (**U+2212 MINUS SIGN, not a hyphen**). `a >= 1e9` → `{sign}{(a/1e9).toFixed(2)}B` (**2 dp**); `a >= 1e6` → `{sign}{(a/1e6).toFixed(0)}M` (**0 dp**); `a >= 1e3` → `{sign}{(a/1e3).toFixed(0)}K` (**0 dp**); else `{sign}{a.toFixed(0)}` | — | `v == null \|\| !Number.isFinite(Number(v))` → `"—"` (em dash). **`v === 0` renders `+0`** — the sign test is `< 0` |
| N3 | `gexBuildPct(from, to)` | 380–385 | `a = |from|`; returns `((|to| - a) / a) * 100`. Compares **magnitudes**, so a sign flip reads as a build or bleed of magnitude only | — | `from == null \|\| to == null` → `null`. `!(a > 0)` → `null`, which also rejects `from === 0` and `NaN` |
| N4 | `wallNum(n, dp = 2)` | 387–389 | `Number(n).toLocaleString("en-US", {minimumFractionDigits: dp, maximumFractionDigits: dp})` — **exactly 2 dp, comma-grouped** | — | `n == null \|\| !finite` → `"—"`. `dp` is never passed anything but its default anywhere in the file |
| N5 | `wallStrike(n)` | 391–393 | `Number(n).toLocaleString("en-US", {maximumFractionDigits: 2})` — **max 2 dp, no minimum**: `6890`, not `6890.00` (comment 390) | — | `n == null \|\| !finite` → `"—"` |
| N6 | `missPts(strike, spot)` | 400–405 | `d = |spot - strike|`; returns `d` | — | Either non-finite → `null`. **`d < 0.005` → `null`**, so the caller can say "right on the level" instead of printing a meaningless `0.00 short` (comment 395–399) |
| N7 | `mmdd(date)` | 2184–2187 | `"08/25"` from `"2026-08-25"` — `date.split("-")` then `` `${mm}/${dd}` `` | — | Falls back to the whole `date` when the split does not yield both parts. **DEAD CODE — defined once, called nowhere** (grep: 1 occurrence in the file, its own definition) |
| N8 | `dowName(date)` | 2195–2199 | `Date.parse(`${date}T12:00:00Z`)` then `toLocaleDateString("en-US", {weekday:"long", timeZone:"UTC"}).toUpperCase()` → `"MONDAY"`. **Parsed at NOON UTC and read back in UTC** so the name never slips a day west of Greenwich (comment 2189–2194) | — | Unparseable → `""` |
| N9 | `mdShort(date)` | 2202–2205 | `"8/21"` from `"2026-08-21"` — `` `${Number(mm)}/${Number(dd)}` ``, **no zero pad** | — | Falls back to the whole `date` |
| N10 | `slotClock(slot)` | 1284–1288 | `slot <= 0` → `"09:29"`. Else `m = 585 + (slot - 1) * 15`, printed `HH:MM` with both parts `padStart(2, "0")`. Slot 1 → `09:45`, slot 26 → `16:00` | — | A slot above 26 is not clamped — `slotClock(30)` returns `17:00` |
| N11 | `expiryTag(expiry, date)` | 136–142 | `md = mm && dd ? `${mm}/${dd}` : expiry`; `d = dteBetween(date, expiry)`. Returns `` `exp {md} · {d}DTE` `` normally, `` `exp {md}` `` when `d == null \|\| d < 0` | — | `!expiry` → `null`, so the tag is **absent rather than guessed** on a pre-migration row holding `""` (comment 132–134). `d === 0` renders `· 0DTE` |
| N12 | `dteBetween(date, expiry)` | 116–121 | `Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000)` — **calendar days, not trading days**: it labels the contract, it is not a decay measure (comment 130–131) | — | Either parse non-finite → `null` |
| N13 | `variantTag(scope, basis)` | 245–246 | `` `{scope === "agg" ? "non-0DTE" : "0DTE"} · {basis === "vol" ? "vol-only GEX" : "OI+vol GEX"}` `` — the four strings, verbatim | — | Total function |
| N14 | `variantQuery(scope, basis)` | 248 | `` `&scope={scope}&basis={basis}` `` — **note the leading `&`**; every call site appends it to a query that already has a `date=` | — | Not URL-encoded; both values come from a closed union so it is safe |

---

# Part O — The ET time machinery

Source: `LevelLog.tsx:106–113`, `261`, `1104–1109`, `1279–1317`, `1412–1421`.

| # | Function | Source | Format & units | Exact boundaries | Empty or loading state |
|---|---|---|---|---|---|
| O1 | `todayETStr()` | 107–113 | `new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit"}).formatToParts(new Date())`, reassembled as `` `${y}-${m}-${d}` `` | Wall-clock ET, so it flips at ET midnight | A missing part contributes `""` — cannot happen with these options |
| O2 | `WALL_SLOTS` | 261 | `27` | **Slot 0 = 09:29. Slots 1…26 = 09:45, 10:00, … 16:00.** Slot 26 is 09:45 + 25×15 = 960 min = 16:00 | — |
| O3 | `OPEN_SLOT_MINS` | 1280 | `9*60 + 29` = **569** — slot 0, the open baseline capture | — | — |
| O4 | `GRID_START_MINS` | 1281 | `9*60 + 45` = **585** — slot 1, then every 15 min to 16:00 (slot 26) | — | — |
| O5 | `slotAtMins(m)` | 1296–1300 | Three branches. `m <= 569` → **`0`**. `569 < m <= 585` → `(m - 569) / 16` — a fractional slot in `(0, 1]`. `m > 585` → `1 + (m - 585) / 15` | **Slot 0 sits 16 minutes before slot 1, not 15**, because the open capture is at 09:29 — that first gap is its own scale (comment 1290–1295). It is the inverse of the recorder's `slotMins()` | Unbounded above: 16:01 ET returns `26.067`, which the chart's filters then reject (`s <= WALL_SLOTS - 1`) |
| O6 | `railPct(slot)` | 1109 | `(slot / 26) * 100` | Slot 0 → 0 %, 13 → 50 %, 26 → 100 % | Not clamped |
| O7 | `RAIL_HOURS` | 1105–1108 | Six entries, `{slot, label}`: `2→"10"`, `6→"11"`, `10→"12"`, `14→"13"`, `18→"14"`, `22→"15"` | Each is exactly on the hour: slot 2 = 585+15 = 600 = 10:00; slot 22 = 585+315 = 900 = 15:00 | **09:30 and 16:00 have no tick** — the two ends carry gutter labels instead |
| O8 | `etOffsetMinutes(d)` | 1303–1310 | `d.toLocaleString("en-US", {timeZone:"America/New_York", timeZoneName:"shortOffset"})` matched against `/GMT([+-]\d{1,2})(?::(\d{2}))?/`; returns `h*60 + (h < 0 ? -mm : mm)` — the minutes term takes the hour's sign | Handles EST (−300) and EDT (−240) | **No match → `-300`** (EST), a silent one-hour error during EDT if the format ever changes |
| O9 | `etMsOn(date, hh, mm)` | 1313–1317 | `naive = Date.parse(`${date}T{HH}:{MM}:00Z`)`; returns `naive - etOffsetMinutes(new Date(naive)) * 60_000` | The offset is read at the **naive UTC instant**, not at the true local instant — off by one only for a DST transition falling inside the 4-to-5-hour shift window, which never lands in a session | `!Number.isFinite(naive)` → `NaN`, which every caller checks |
| O10 | `etMinsOfTs(ts)` | 1412–1421 | `new Date(ts).toLocaleString("en-US", {timeZone:"America/New_York", hour12:false, hour:"2-digit", minute:"2-digit"})` matched against `/(\d{1,2}):(\d{2})/`; returns `h*60 + m` | ET minutes since midnight, from a timestamptz | Unparseable date or no regex match → `NaN`, which `useWallSeries` skips with `continue` |

`useIntradaySpot` converts a candle's epoch ms to ET minutes as
`570 + (t - from) / 60_000` where `from = etMsOn(date, 9, 30)` — i.e. it anchors
on 09:30 = 570 minutes and counts forward, on the stated grounds that **no DST
change lands inside a session, so minutes off the open is exact** (comment
1364).

---

# Part P — Data layer

**Three endpoints, not two.** The brief names `/proxy/walls` and
`/proxy/candles-intraday`. The page also reaches **`/api/gex-gross-feed`**
through `useGexChurnHistory` (`GexHeatBar.tsx:381–384`), imported at
`LevelLog.tsx:61` and called at `643`.

Everything below is checked against the server, not just the client:
`server-with-proxy.js:3155–3221` (`/proxy/walls`), `:570–587`
(`/proxy/candles-intraday`), `:1419` (the `/proxy/*` gate), and
`api-router.js:7215–7239` (`/api/gex-gross-feed`).

| # | Step | Source | Behaviour | Notes |
|---|---|---|---|---|
| P1 | `/proxy/*` auth gate | `server-with-proxy.js:1412–1425` | `checkProxyAccess(req, pathname, method)` runs **before any `/proxy/*` handling**; a failure sends `{error: reason}` at the verdict's code. `middleware.ts` excludes `/proxy` from the Next matcher, so this is the only place these routes are authenticated. Reads → subscriber, writes → owner, a small allowlist → public, cron → `x-internal-token` | **No-op unless `PROXY_AUTH_REQUIRED=1`.** `proxy-auth.js` is **not staged**, so the allowlist cannot be read here |
| P2 | `loadDay` — request | `LevelLog.tsx:654–668` | `GET /proxy/walls?date={encodeURIComponent(date)}&scope={scope}&basis={basis}`, `{cache: "no-store"}` | Three params. `symbol` is deliberately absent — this is the universe view |
| P3 | `loadDay` — server side | `server-with-proxy.js:3208–3217` | `getWalls({date: params.date \|\| undefined, symbol, scope, basis})`. Because no `symbol` was sent, `body = await attachRank(out)` — **`rank` is attached ONLY on the universe response** | `attachRank` adds ATR distance / bucket / out-of-sample reach score per level plus the `rank` block. **It never throws**: a missing calibration snapshot still renders the walls (comment 3134–3137). The rail's only sort key (E16) comes from here |
| P4 | `loadDay` — defaults at the server | `:3209–3212` | `date` → `u.searchParams.get('date') \|\| undefined`, i.e. `getWalls`'s own default. `symbol` → `\|\| undefined`. `scope`/`basis` → `scannerVariants.normalize(scope, basis)` | The client **always** sends `date`, so the server default never fires. `scanner-variants.js` and `walls-recorder.js` are **not staged**; the route's own comment (3125–3128) states the defaults as `scope=0dte` and `basis=oivol`, and that "a request that names neither is byte-for-byte the response this endpoint always gave" |
| P5 | `loadDay` — response handling | `:661–667` | `j = await r.json()`; `if (!j?.ok) throw new Error(j?.error \|\| `HTTP ${r.status}`)`. `rows = Array.isArray(j.tickers) ? j.tickers : []`. `setTickers(rows)`; `setSel(prev => prev ?? rows[0]?.symbol ?? null)` | **`r.ok` is never checked** — a 502 whose body carries `{ok:false, error}` is caught by the `ok` test, but a non-JSON error body throws in `r.json()` and lands in the same catch |
| P6 | `loadDay` — state | `:655, 666–667` | Start: `setErr(null); setLoaded(false)`. Catch: `setErr(String(e)); setTickers([])`. Always: `setLoaded(true)` | `setLoaded(true)` is outside the try/catch, so it runs on both paths |
| P7 | `loadDay` — deps | `:668, 670` | `useCallback(…, [date, scope, basis])`; `useEffect(() => { void loadDay(); }, [loadDay])` | **`nonce` is NOT a dep.** Refresh re-runs `loadDay` by calling it directly (674) |
| P8 | `refreshAll` | `:672–676` | `setNonce(n => n + 1)` then `await loadDay()` | The nonce bump pokes the three per-symbol effects; the direct call re-pulls the day list |
| P9 | Detail effect — request | `:678–692` | `GET /proxy/walls?date={date}&symbol={encodeURIComponent(sel)}&scope={scope}&basis={basis}`, `{cache:"no-store"}` | Four params, in that order |
| P10 | Detail effect — server side | `server-with-proxy.js:3208–3216` | Same `getWalls` call, but **`symbol` is present so `attachRank` does NOT run** — "the per-symbol view is a log, not a leaderboard" (comment 3214–3215) | — |
| P11 | Detail effect — response | `:687–689` | `if (alive && j?.ok) setDetail({symbol: j.symbol, log: j.log ?? [], events: j.events ?? []})` | A `j.ok === false` response leaves the **previous** detail on screen — the state is only cleared by the catch or by `!sel` |
| P12 | Detail effect — abort | `:680, 689–691` | An `alive` boolean, flipped in the cleanup. **No `AbortController`** — the request completes and its result is discarded | Same pattern in all four hooks. A fast sequence of clicks fires N requests and keeps the last **resolved**, not the last **issued** |
| P13 | Detail effect — deps | `:692` | `[sel, date, nonce, scope, basis]` | `nonce` is the refetch poke |
| P14 | `useIntradaySpot` — request | `:1341–1373` | `from = etMsOn(date, 9, 30)`, `to = etMsOn(date, 16, 0)`; bails to `[]` if either is non-finite. `GET /proxy/candles-intraday?symbol={encodeURIComponent(symbol)}&interval=1m&fromMs={Math.round(from)}`, `{cache:"no-store"}` | Three params. **`to` is computed but never sent** — the filtering is client-side |
| P15 | `/proxy/candles-intraday` — the server's params | `server-with-proxy.js:570–587` | `symbol` = `(get('symbol') \|\| '').trim().toUpperCase()`; **400 `{error:'symbol required'}` when empty.** `interval` = `(get('interval') \|\| '1m').trim()` — **not validated**, passed straight to `fetchIntradayCandles`. `daysBack` = `Math.max(1, Math.min(5, Number(get('daysBack')) \|\| 1))` — **clamped to 1…5, default 1**; the client never sends it. `fromMs` → `fromMsRaw`; `floor = Date.now() - 7*86_400_000`; `fromTime = Number.isFinite(fromMsRaw) && fromMsRaw > floor ? fromMsRaw : Date.now() - daysBack*86_400_000` | **There is no `toMs` / `to` / `until` param.** And: **a `fromMs` older than 7 days is silently ignored and replaced by `Date.now() - 1 day`.** The client then filters every returned bar out with `t < from \|\| t > to`, so the hook resolves `[]`. This is the documented "date outside dxFeed's ~7-day 1m window" path (comment 1337–1339), **confirmed at the server** |
| P16 | `/proxy/candles-intraday` — response | `:583–585` | 200 `{symbol, interval, candles: [{time, open, high, low, close, volume}]}`; 502 `{error:'candles-intraday failed', detail, symbol}` on a rejected `fetchIntradayCandles`. The proxy caches ~60 s (client comment 1332) | — |
| P17 | `useIntradaySpot` — parse | `:1356–1368` | `cs = Array.isArray(j?.candles) ? j.candles : []`. Per candle: `t = Number(row?.time)`, `px = Number(row?.close)`; **skip unless `Number.isFinite(t) && px > 0`**; skip unless `from <= t <= to`. Push `{mins: 570 + (t - from)/60_000, px}`. Then `out.sort((a,b) => a.mins - b.mins)` | Only `time` and `close` are read — OHLC's other four fields are discarded |
| P18 | `useIntradaySpot` — deps / failure | `:1372, 1369` | `[symbol, date, nonce]` — **not `scope` or `basis`**, correctly: the tape is the same tape under any variant. `catch { if (alive) setRows([]) }` | `!symbol` → `setRows([])` and return, before any fetch |
| P19 | `useWallSeries` — request | `:1441–1486` | `GET /proxy/walls?date={date}&symbol={encodeURIComponent(symbol)}&series=1&scope={scope}&basis={basis}`, `{cache:"no-store"}` | Five params. `series` is the literal string `1` |
| P20 | `series=1` — the server branch | `server-with-proxy.js:3164–3206` | Entered on `symbol && u.searchParams.get('series') === '1'` — an **exact string compare**, and it requires a symbol. `scannerEnsureSchema()` false → **503 `{ok:false, error:'no DB'}`**. `seriesDate` = `get('date') \|\| new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York'}).format(new Date())` — today ET. `isDefaultVariant` → `SELECT ts, spot, call_wall, put_wall, cb, gex_flip, total_net_gex, call_wall_gex, put_wall_gex, cb_gex, expiry, 1 AS expiries FROM scanner_snapshots WHERE date=$1 AND symbol=$2 ORDER BY ts ASC`; otherwise the same columns with a real `expiries` from `scanner_variants WHERE … AND expiry_scope=$3 AND basis=$4`. Symbol is `String(symbol).toUpperCase()`. Response: `{ok:true, date, symbol, scope, basis, series: rows}` | The default variant reads `scanner_snapshots`, which predates the variant split and is written on every sweep, so this branch **cannot regress** on a box where `scanner_variants` is still empty (comment 3179–3184). `1 AS expiries` on the default is why the header's `+N` suffix can never appear on the 0DTE scope |
| P21 | `useWallSeries` — parse | `:1456–1480` | `src = Array.isArray(j?.series) ? j.series : []`. Per row: `mins = etMinsOfTs(String(rec?.ts ?? ""))`, **skip when non-finite**. `e = typeof rec.expiry === "string" ? rec.expiry.trim() : ""`; `if (/^\d{4}-\d{2}-\d{2}$/.test(e)) exp = e` — **last valid wins, and the server orders `ts ASC`, so the newest labelled row is the answer** (comment 1458–1462). `k = Number(rec.expiries); if (finite && k > 0) nExp = k` — same last-wins rule. Push `{s: slotAtMins(mins), callWall: fin(call_wall), putWall: fin(put_wall), callG: fin(call_wall_gex), putG: fin(put_wall_gex)}`, then sort by `s` | **`fin(v)` (1406–1409): `Number(v)`, returned when finite, else `null`.** |
| P22 | `useWallSeries` — what is consumed | `:698–700` | `const series = useWallSeries(…); const expiry = series.expiry; const expiries = series.expiries;` | **`series.samples` is read by nothing.** The `SnapSample` type, `fin()`, and the per-row parse of `call_wall`, `put_wall`, `call_wall_gex`, `put_wall_gex` are all built and discarded. See Part T |
| P23 | `useWallDays` — the popout's week | `:2240–2302` | Wave 1: `candidates = lastWeekdays(endDate, count + 3)` — for `count = 5` that is **8 candidate weekdays**, all fetched in one `Promise.all` as `GET /proxy/walls?date={d}&symbol={symbol}&scope={scope}&basis={basis}`. A `!j?.ok` or a throw resolves `null`; a day with no `log` and no `events` resolves `null`. `kept = logs.filter(Boolean).slice(-count)` — the **newest 5** that came back with rows. Then `setState({days: kept.map(k => ({...k, price: []})), loading: true})` — levels paint immediately. Wave 2: `Promise.all` of one `GET /proxy/candles-intraday?symbol=&interval=1m&fromMs=` per kept day, parsed identically to P17. Finally `setState({days: kept.map((k,i) => ({...k, price: tapes[i]})), loading: false})` | **Up to 13 requests when the popout opens** (8 logs + 5 tapes) — and it opens on `range = 5` by default. Wave 2 waits on wave 1: a genuine two-stage waterfall, justified in the comment (2230–2238) on the grounds that a bank holiday should not cost a candle fetch. **`!symbol \|\| count < 1` → `{days: [], loading: false}` with no request.** Deps `[symbol, endDate, count, nonce, scope, basis]` |
| P24 | `useGexChurnHistory` | `GexHeatBar.tsx:370–399`; `api-router.js:7215–7239` | `GET /api/gex-gross-feed?symbol={encodeURIComponent(symbol)}&days=45`, `{cache:"no-store"}`. Server: **`auth: 'subscriber'`, `methods: ['GET']`**. With a `symbol` it returns `readGrossHistory(sym, days)` where `days = Math.max(1, Math.min(400, Number(q.get('days')) \|\| 60))` — **clamped 1…400, server default 60; the client's 45 passes through unchanged**. `sym = (q.get('symbol') \|\| '').trim().toUpperCase()`. `!libDb?.queryAll` → 200 `{ok:true, rows:[], note:'Feed unavailable.'}`. Any throw → **200** `{ok:true, rows:[], note:'Feed unavailable right now.', error}` — "a customer page must degrade to 'nothing to show', never to a stack" | Client: `setRows(Array.isArray(j.rows) ? j.rows : [])`, `setNote(typeof j.note === "string" ? j.note : "")`; catch → `setRows([]); setNote("Churn history unavailable right now.")`; `finally setLoading(false)`. `alive` flag, **no `AbortController`**. Deps `[symbol, days]` |

**Request count, steady state.** A first load with a selection resolves:
1 × `/proxy/walls` (day summary) → then, in parallel, 1 × `/proxy/walls`
(detail), 1 × `/proxy/walls?series=1`, 1 × `/proxy/candles-intraday`,
1 × `/api/gex-gross-feed` = **5 requests in 2 waves**. Opening the popout adds
up to **13** more. A refresh re-runs all five. A scope or basis switch re-runs
four of the five (`/api/gex-gross-feed` is keyed on `sel` alone).

**Polling: none.** There is no `setInterval`, no `pollMs`, no socket. The page
fetches on load and on an explicit refresh — "so an open tab never hammers the
recorder" (header comment 15–16).

**The waterfall v3 rule 3 will flag.** `loadDay` → `setSel(rows[0].symbol)` →
the four per-symbol reads is a real two-stage waterfall on a cold load, because
the symbol is genuinely unknown until the day list returns. It is not
removable the way `/em`'s was. See Part U.

---

# Part Q — `buildLogText`

Source: `LevelLog.tsx:407–481`. Called at `758–761`, consumed by `CopyLogButton`
only. Built from the **raw rows** rather than scraped out of the rendered
timeline, so the copy carries meta the eye skips (comment 407–412).

| # | Element | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| Q1 | Header line | (425–427) | `` `{symbol} — {SCOPE} LOG · {date}` `` + (`exp` ? `` ` · {exp}` `` : `""`) + (`spot != null` ? `` ` · spot {wallNum(spot)}` `` : `""`) | — | `SCOPE` = `VIEW_SCOPE[view].toUpperCase()` → `WALL` / `CORE` / `LEVEL`. `symbol` arrives as `sel ?? "—"` |
| Q2 | Basis line | (431) | `` `basis: {variant}` `` where `variant` is `vTag` — e.g. `basis: 0DTE · OI+vol GEX` | — | Always present. Without it a pasted non-0DTE or vol-only log is indistinguishable from the default one (comment 428–430) |
| Q3 | OPEN block — gate | (433–438) | `opens = log.filter(r => r.reason === "open")`; block omitted entirely when empty | — | — |
| Q4 | OPEN block — header | (436) | A blank line, then `` `OPEN {opens[0].at}` `` | — | Uses the **first** open row's time for all of them |
| Q5 | OPEN block — rows | (437) | `` `  {LEVEL_LABEL.padEnd(10)} {wallStrike(strike)}` `` — **two leading spaces**, label padded to 10 (`"Call Wall"` = 9, `"Put Wall"` = 8, `"CORE"` = 4) | — | In `log` order |
| Q6 | Change line | (445–446) | `` `{r.at}  {LEVEL_LABEL.padEnd(10)} {"CHANGED".padEnd(22)} {wallStrike(prev_strike)} → {wallStrike(strike)}` `` — **two spaces after the time**, verdict padded to 22 | — | `"CHANGED"` is a literal, not a lookup |
| Q7 | Change meta | (447) | `` `{" ".repeat(7)}GEX at level {gexShort(level_gex)}` `` — **7 spaces**, matching a 5-char `HH:MM` plus the two-space gap | — | Omitted when `level_gex` is null |
| Q8 | Event verdict | (453–455) | `reaction == null` → `"WATCHING"`; `isBreakThenReject(e)` → `` `BREAK & REJECT ({reclaim_min}m)` `` (**lowercase `m` here — the badge's is uppercased by CSS**); else `REACTION_LABEL[reaction].toUpperCase()` | — | `"APPROACHED, THEN TAGGED"` is **23 characters and overflows `padEnd(22)`**, so that one verdict pushes its body column one space right |
| Q9 | Approach body — short | (459–460) | `` `came {side === "below" ? "up" : "down"} to {wallNum(spot_at_hit)}, {wallNum(miss)} short of {wallStrike(strike)}, no tag` `` | — | When `miss != null` |
| Q10 | Approach body — on the level | (461) | `` `came {up\|down} right onto {wallStrike(strike)}, no tag` `` | — | When `miss == null`, i.e. `< 0.005` apart |
| Q11 | Touch body | (462) | `` `tagged {wallStrike(strike)} from {side} at {wallNum(spot_at_hit)}` `` | — | `side` from `approachSide(e)` |
| Q12 | Event line | (463) | `` `{e.at}  {LEVEL_LABEL.padEnd(10)} {verdict.padEnd(22)} {body}` `` | — | Same two-space gap as Q6 |
| Q13 | Event meta — the five, in order | (465–472) | ① `e.note`; ② `!approach && attempts > 1` → `` `attempt {attempts} on this strike` ``; ③ `was_core` → `core_held === false ? "was the CORE — CORE moved after" : "was the CORE"`; ④ `gex_at_hit != null` → `` `GEX {gexShort(gex_at_hit)}` `` (**note: no "at level"** — the timeline says `GEX at level`); ⑤ `build != null` → `` `{build >= 0 ? "built" : "bled"} {|build|.toFixed(0)}%` `` (**no "by resolve"** — the timeline adds it). `.filter(Boolean).join(" · ")` | — | **The copy text carries FIVE meta items; the timeline carries SEVEN** (L9–L15). `excursion_pts` and the `"watching — resolves 4 slots after the tag"` note are **not in the copy text** |
| Q14 | Event meta line | (473) | `` `{" ".repeat(7)}{meta}` `` | — | Line omitted when `meta` is `""` |
| Q15 | Ordering | (477) | `lines.sort((a,b) => a.slot - b.slot \|\| (a.hit === b.hit ? 0 : a.hit ? 1 : -1))` — slot ascending, then **changes before the hits they produced**. Log lines are pushed first, so ties inside one group hold server order | — | Matches the screen's ordering (L17) but is a **separately written comparator** — see Part T |
| Q16 | Empty | (478–479) | `lines.length` → a blank line then every line's text. Otherwise `out.push("", "No changes or touches recorded.")` | — | The header and basis lines are always emitted, so the copy is never empty. `return out.join("\n")` |

### Worked example of the full output

```
SPX — LEVEL LOG · 2026-09-03 · exp 09/03 · 0DTE · spot 6,512.40
basis: 0DTE · OI+vol GEX

OPEN 09:29
  Call Wall  6550
  Put Wall   6450
  CORE       6550

09:45  Put Wall   CHANGED                6450 → 6475
       GEX at level −1.20B
11:15  Call Wall  TAGGED…                tagged 6550 from below at 6,549.80
```

*(The `TAGGED…` slot in the last block is whichever of the eleven verdicts
applies — `REJECT`, `BREAK <5`, `BREAK +5`, `BROKE & CONSOLIDATED`, `NEW WALL`,
`PINNED`, `ROLLED OVER`, `APPROACHED, THEN TAGGED`, `STALLED NEAR`, `WATCHING`,
or `BREAK & REJECT (18m)` — each `padEnd(22)`.)*

---

# Part R — Colours used

Every colour value this page can paint, where it comes from, and what it becomes
in v3.

**Brandon's standing decision (2026-09-03): v3 keeps v2's palette, as tokens —
but the one collision v2 never intended is dropped.** `HOME_THEME.green`
`#8ECAE6` is a light blue doing chrome AND positive AND accent. The scanner port
split those three jobs onto `V2.green` (chrome, keeps `#8ECAE6`), `V2.up`
(`#1FD98A`) and `V2.accent` (`#7dd3fc`). **The same split applies here**, and the
"v3 token" column below assigns each of this page's `GREEN` uses to one of the
three by role.

⚠ **Neither `V2.up` nor `V2.accent` exists in the staged `tokens.css` or
`theme.ts`.** The staged `V2` object (`theme.ts:157–176`) carries `green`, `pos`
(`#22c55e`), `refresh` (`#1fd98a`) and `lightBlue` (`#7ed3fc`). `--color-v2-refresh`
already holds `#1fd98a`, and `--color-v2-lightblue` holds `#7ed3fc` — **one digit
off `#7dd3fc`**, deliberately, because v2's analytics CSS painted `#7ed3fc` and
"the CSS is what reaches the screen" (`tokens.css:238–242`). So this port needs
two **new** tokens, not two aliases. See Part U.

| v2 value | Where used on this page | Exists in v3 `tokens.css`? | Proposed v3 token |
|---|---|---|---|
| `HT.bg` `#05060A` | page canvas (`homeShellStyle`); the border ring on a `touch` rail mark (G13) | yes — `--color-v2-bg` | `V2.bg` |
| `HT.panelBg` `rgba(13,17,25,0.45)` | every card plate via `CARD` | no exact | `alpha(V2.panel, .45)` — already `V2W.panelBg` |
| `HT.panelBgStrong` `rgba(13,17,25,0.72)` | sticky table header background (`th`) | no exact | `alpha(V2.panel, .72)` — already `V2W.panelBgStrong` |
| `HT.border` `rgba(255,255,255,0.10)` | every card border, every group divider, `th` bottom rule, rail chip border, input border, off-chip border | no exact | `alpha(T.text, .10)` — already `V2W.border`. **Not** `--color-line`, which is opaque `#23272e` |
| `HT.text` / `C.label` `#FFFFFF` | all label and body text; the migration chart's **spot polyline stroke** and its legend swatch | yes — `--color-fg` | `T.text` |
| `HT.muted` / `MUTED` `#FFFFFF` | `UNTESTED`, `reached`, `stalled` badges; `Open baseline` badge; legend chip labels; the migration caption; the `oivol` variant tag; the variant-empty note; the popout sub-line, loading pip and empty message; the axis stamps | yes — `--color-muted` (also `#ffffff`) | `T.muted` — **but see the collision note below** |
| `HT.cyan` / `C.cyan` `#219EBC` | page title; `ALL` chip; `CHANGED` badge; `new_wall` badge; rail fill gradient; selected-row wash and inset bar; timeline `change` dot; **every timeline dot's glow**; date-picker icon and active states; popout `Today`/`5 sessions` chips and title | yes — `--color-v2-cyan` | `V2.cyan` |
| `HT.red` / `RED` `#EF4444` | error card text; `↓ from above` side chip; `SnapLogButton` error text; refresh-button error state | yes — `--color-v2-red` | `V2.red` |
| `HT.orange` / `AMBER` `#FB8501` | `WALLS` view chip; both basis chips; `break_lt5`, `break_5`, `consolidated` badges; the `vol` variant tag; `WallDelta` **down** arrow; timeline **hit** dot; timeline **open** dot | yes — `--color-v2-orange` | `V2.orange` |
| `HT.green` / `GREEN` `#8ECAE6` — **chrome role** | both scope chips (`0DTE` / `NON-0DTE`) | yes — `--color-v2-green` | **`V2.green`** |
| `HT.green` / `GREEN` `#8ECAE6` — **positive role** | `reject` badge; `rolled_over` badge; `BREAK & REJECT` badge; `WallDelta` **up** arrow; `↑ from below` side chip; `SnapLogButton` ok state; `CopyLogButton` done state | no | **`V2.up` `#1FD98A`** — new token `--color-v2-up` |
| `HT.green` / `GREEN` `#8ECAE6` — **accent role** | *(none on this page)* | — | `V2.accent` unused here; still add it for the shared file |
| `LIGHT_BLUE` `#7dd3fc` | the expiry tag (text, `.12` wash, `.35` border); the `pin` badge; the `buildShareColor` positive anchor in `GexChurnHistory` | **no** — `--color-v2-lightblue` is `#7ed3fc`, a different value | **`V2.accent` `#7dd3fc`** — new token `--color-v2-accent`. **Do not reuse `--color-v2-lightblue`** |
| `LEVEL_COLORS.cb` / `CORE_GOLD` `#ffd600` | `CORE` view chip; CORE rail column head and cells; CORE rail marks and chips; the CORE polyline and its legend swatch; the CORE migration button | yes — `--color-level-cb` | `LEVEL_COLORS.cb` |
| `LEVEL_COLORS.pw` / `PUT_RED` `#ff4757` | Put column head and cells; put-wall rail marks and chips; the put-wall polyline and legend swatch; the timeline's put-wall level chip | yes — `--color-level-pw` | `LEVEL_COLORS.pw` |
| `ES_CANDLE_UP` / `CALL_GREEN` `#30d158` | Call column head and cells; call-wall rail marks and chips; the call-wall polyline and legend swatch; the timeline's call-wall level chip | yes — `--color-candle-up` | `ES_CANDLE_UP`. **Deliberately not `LEVEL_COLORS.cw` `#29b6f6`** — the shared set paints the call wall blue, which does not read as green beside a red put wall (comment 88–94) |
| `ES_CANDLE_DOWN` `#ff5b5b` | the `buildShareColor` negative anchor in `GexChurnHistory` | yes — `--color-candle-down` | `ES_CANDLE_DOWN` |
| `HT.panel` `#0D1119` | the `buildShareColor` neutral origin in `GexChurnHistory` | yes — `--color-v2-panel` | `V2.panel` |
| `REFRESH_GREEN` `#1FD98A` | refresh button success border, wash, text and `textShadow` | yes — `--color-v2-refresh` | `V2.refresh` (same value as the new `V2.up`; keep both names — a refresh state is not a positive figure) |
| `#888888` | refresh button text while `refreshing` | **no** | `T.flat` `#7a828d`, or a new `--color-v2-dim` if the exact value matters |
| `rgba(255,255,255,0.03)` | every "off" chip and secondary button background | no | `alpha(T.text, .03)` — already `V2W.wash03` |
| `rgba(255,255,255,0.04)` | the `oivol` variant tag background | no | `alpha(T.text, .04)` — already `V2W.wash04` |
| `rgba(255,255,255,0.05)` | table row bottom rules; timeline row bottom rules; date-picker nav buttons | no | `alpha(T.text, .05)` — already `V2W.wash05` |
| `rgba(255,255,255,0.055)` | rail track background | no | `alpha(T.text, .055)` |
| `rgba(255,255,255,0.028)` | rail chip background | no | `alpha(T.text, .028)` |
| `rgba(255,255,255,0.06)` | churn bar track | no | `alpha(T.text, .06)` |
| `rgba(255,255,255,0.08)` | timeline connector line | no | `alpha(T.text, .08)` |
| `rgba(255,255,255,0.13)` | rail hour ticks | no | `alpha(T.text, .13)` |
| `rgba(255,255,255,0.16)` | the dashed "log stopped writing" line | no | `alpha(T.text, .16)` |
| `rgba(255,255,255,0.22)` | the solid session-divider line | no | `alpha(T.text, .22)` |
| `rgba(0,0,0,0.4)` | filter-input background (`homeInputStyle`) | `--color-shadow` is `#000000` | `alpha(T.shadow, .4)` |
| `rgba(0,0,0,0.30)` | date-picker trigger background | same | `alpha(T.shadow, .30)` |
| `rgba(0,0,0,0.72)` | popout scrim | same | `alpha(T.shadow, .72)` |
| `rgba(0,0,0,0.22)` | `classicCardStyle` box shadow | same | `alpha(T.shadow, .22)` |
| `rgba(10,13,20,0.98)` | `DOCK_THEME.bg`, the date-picker panel | no | new `--color-v2-dock` or `alpha(V2.panel, .98)` (**not identical** — `#0D1119` vs `#0A0D14`) |
| `DOCK_THEME.shadow` | date-picker panel shadow: `0 1px 0 rgba(255,255,255,0.06) inset, 0 20px 44px -14px rgba(0,0,0,0.75), 0 6px 16px rgba(0,0,0,0.45)` | no | Compose from `alpha(T.text, .06)` and `alpha(T.shadow, …)` |
| `HT.shellGlow` | the two page-background radials | no | `V2W.glowA` / `V2W.glowB` already exist |
| `var(--font-mono)` | every mono readout | v3 has `--font-mono` | `--font-mono`. **v2's value comes from the Next font loader, not from `homeTheme`** — confirm the two resolve to the same face |

### The NEW collisions this page introduces

1. **`MUTED === C.label === #FFFFFF`.** `HOME_THEME.muted` and `HOME_THEME.text`
   are the same string. Every "muted" thing on this page — the `UNTESTED`,
   `reached` and `stalled` badges, the migration legend labels and values, the
   caption, the `oivol` variant tag, the variant-empty note, the popout's
   sub-line and empty message, both axis rails — is **full-strength white,
   identical to body text**. The name says "de-emphasised"; the code paints
   primary. **v3 must decide whether the port preserves that or gives `MUTED` a
   real step-down**, because "as v2 rendered it" and "as v2 named it" are two
   different pages here. Note `--color-muted` in v3 is also `#ffffff`, so a
   naïve re-key reproduces the collision exactly.

2. **`AMBER === HOME_THEME.orange`, used as two different semantics in one
   component.** In `WallTimeline` the dot is `hit ? AMBER : open ?
   HOME_THEME.orange : C.cyan` (2556). Those are the same value. **A tag and an
   open baseline are indistinguishable on the timeline's dot column** — only
   `change` reads apart. This is not the same collision as `GREEN`'s; it is a
   ternary that believes it has three branches and has two.

3. **Two light blues side by side in the legend.** `GREEN` `#8ECAE6` (`reject`,
   `rolled_over`) and `LIGHT_BLUE` `#7dd3fc` (`pin`) sit in the same wrapped
   badge row. Splitting `GREEN`'s positive role onto `V2.up` `#1FD98A` fixes this
   as a side effect — `reject` and `rolled_over` become a real green and `pin`
   stays the only light blue.

4. **Every timeline dot glows cyan.** `boxShadow: 0 0 10px rgba(HOME_THEME.cyan,
   0.45)` (2570) is hardcoded regardless of the dot's own colour, so an amber hit
   dot wears a cyan halo. Transcribe as-is or fix; it is one line either way.

---

# Part S — Do not port

| Item | Where | What it is | Action for v3 |
|---|---|---|---|
| `ModalPortal` | 2434–2443 | `createPortal(children, document.body)` behind a `useEffect`-set host, because `document` does not exist during SSR/prerender. v3 is a client-only SPA with no prerender step | **Do not port.** Use v3's own overlay primitive, or render the popout inline with a fixed-position wrapper |
| `PageShell` | `PageCard.tsx:41–77`, used at 787 | v2's page chrome — `homeShellStyle` + `homeContentStyle` + an inner `<main>` | **Do not port.** v3's equivalent is `src/design/primitives/Page.tsx` inside `Shell.tsx`'s rail + toolbar frame; the page contributes nothing to the frame |
| `"use client"` | line 1 | A Next directive | **Do not port.** v3 is Vite |
| `@/` import alias | 59–64 | Next path alias | **Do not port** as-is; v3 uses its own alias |
| `mmdd()` | 2184–2187 | A `"MM/DD"` formatter, complete with a doc comment calling it "the week view's per-slice stamp". **The week view actually uses `mdShort()`.** Referenced by nothing | **Do not port.** Dead |
| `stepRun(…, reverse)` | 1854, 1864 | The `reverse` parameter and its `for (let s = b; s >= a; s--)` branch. Every call site passes the default `false` | **Do not port** the parameter |
| `SnapSample`, `fin()`, and four of five parsed series columns | 1376–1382, 1406–1409, 1475–1476 | `callWall`, `putWall`, `callG`, `putG` are parsed off `/proxy/walls?series=1` into an array that nothing reads (P22) | **Do not port** the parse. Keep the request — `expiry` and `expiries` are the header's expiry tag. See Part T |
| `WallTicker.hits`, `.reclaim_min`, `.reaction`, `.last_event` | 156–159 | Typed on the day-summary row; rendered by no column and read by no code path | **Do not port** the fields, or port them and render something |
| `WallLogRow.ts`, `WallEventRow.hit_ts`, `.resolved_ts` | 164, 172, 174 | Typed, never read — the page uses `at` everywhere | **Do not port** |
| Colour literals | throughout | 20-odd `rgba(255,255,255,x)` and `rgba(0,0,0,x)` strings typed inline (Part R), plus the local `rgba()` helper (100–104) duplicating `themeRgba` | **v3 non-negotiable.** Every one becomes `alpha(TOKEN, x)`; the helper is deleted |
| `globals.css` GLOBAL GRID COLLAPSE dependence | comment 888–891 | The two-column grid relies on a `globals.css` block matching `minmax(0, 1fr) minmax(…)` to stack on a phone. **v3 has no such block** (recorded in `em.md` Part K as still outstanding) | **Do not rely on it.** v3 must write an explicit narrow-width rule or the page is visibly worse than v2 on a small window |
| `wall-scroll` class | 787, 903, 1046 | Defined in `globals.css`, **not in this tree**. Applied to three scrollers | Recover the rule before the port, or drop it — v3's `tokens.css` already styles every scrollbar app-wide (`:root` + `*::-webkit-scrollbar`), which may make it redundant |
| `card-hover` | `PageCard.tsx:124` | The `Card` primitive's hover-lift class. **This page never uses `Card`**, only `CARD` (the raw style object), so no lift applies | Nothing to port; noted so nobody adds one |
| Page-level socket access | — | **None.** The page has no `useFrame`, no `useField`, no `watchFrame`, no WebSocket | Nothing to remove |
| Untagged canvas | — | **None.** Every mark on this page is DOM or SVG (Parts G, H). `lib/snapshot.ts` creates a canvas transiently inside html2canvas, which is a capture concern, not a rendered layer | No `data-cb-layer` is needed |
| Missing visibility guard | — | **Nothing paints on a timer.** No `requestAnimationFrame`, no `setInterval`, no poll. The three `setTimeout` calls are label reverts (1800 / 2200 / 1600 ms) | No visibility guard is needed |
| The two-wave `useWallDays` waterfall | 2250–2297 | Logs then tapes, sequential by design | **Flagged, not banned** — see Part T |
| html2canvas | via `lib/snapshot.ts` | v2's capture engine. v3 already has its own (`src/shell/snapshot.ts`), which is not html2canvas because html2canvas cannot parse `color-mix()` — and every `alpha()` call in v3 is a `color-mix()` | **Do not port** `lib/snapshot.ts`. Route both snapshot buttons through v3's engine and its one owner-gated toolbar camera (`src/shell/CopyShot.tsx`), the same resolution `/em` reached on 2026-09-02 |
| `data-cap-center` / `data-cap-swatch` | 357, 366, 1232, 2009, 2054 | Opt-in attributes for html2canvas centring workarounds that **v3's engine does not implement**, because it renders through the browser rather than re-laying-out text | **Do not port** the attributes. Keep the fixed height + matching line-height idiom — that is what makes the badges read correctly on the live page |

---

# Part T — Findings worth a decision

| # | Finding | Evidence | Why it matters |
|---|---|---|---|
| T1 | **`/proxy/walls?series=1` is fetched, parsed, sorted — and its payload is thrown away.** `useWallSeries` builds a `SnapSample[]` from `call_wall`, `put_wall`, `call_wall_gex`, `put_wall_gex` for every 5-minute row of the day; the page reads only `series.expiry` and `series.expiries` | 1441–1486 vs 698–700. `grep` for `.samples` in `LevelLog.tsx` returns only the type declaration, the empty constant and the `setRows` call | **The endpoint's own header comment states its purpose and the code does not fulfil it.** Lines 1424–1440: "walls_log is change-only, and `level_gex` only exists on the rows it wrote. Between two rolls the chart therefore had no gamma… A session where both walls hold their strikes while dominance flips call→put is a real and tradeable event that the log physically cannot express." `WallMigrationChart` builds `coreG` from **`log`'s `level_gex`** (1706–1717), not from the series. **THE CODE WINS: the chart still has no gamma between rolls, and the flip the comment describes is still invisible.** The request costs a full day of rows to carry two scalar fields. Decision: either wire `samples` into `coreG` (which is what the comment says was intended), or reduce the read to a `LIMIT 1` expiry lookup |
| T2 | **The ordering rule is written three times.** The timeline (`kindRank`, 2523–2524), `buildLogText` (`a.hit === b.hit ? 0 : a.hit ? 1 : -1`, 477), and the rail (`a.slot - b.slot` with no tie-break, 1143) | 477, 1143, 2524 | Three sources of truth for "changes lead the hit they produced". The first two agree today; the rail's has no tie-break at all and depends on Map insertion order. Any future change to the rule has to land in three places or the copied text and the screen diverge — which is exactly the failure the view filter was centralised (comment 702–704) to prevent |
| T3 | **The event meta list is written twice and the two lists differ.** The timeline renders seven items (excursion, reclaim, attempts, core, GEX, build, watching); the clipboard text renders five (note, attempts, core, GEX, build) | 2500–2516 vs 466–472 | The copy text is described as carrying "the meta the eye skips" (comment 409–411) and in fact carries **less** than the screen: **`excursion_pts` — the single most quantitative field on a hit — never reaches the clipboard**, and neither does the "watching" state. Also the wording drifts: `GEX at level` vs `GEX`, `built 12% by resolve` vs `built 12%`. Decision: one meta builder, two renderers |
| T4 | **The scope word is spelled three ways by three code paths.** `VIEW_SCOPE[view]` → the card header (`wall`/`core`/`level`, uppercased by CSS); `VIEW_SCOPE[view].toUpperCase()` → the clipboard header; an inline ternary → the PNG title band (`Wall`/`CORE`/`Level`) | 762 vs 954 vs 420 | The PNG band and the card it is a picture of can print different words for the same view. Collapse to one function |
| T5 | **A comment and the code disagree about the chart's height, three times. THE CODE WINS.** `MIG_H = 250`. Line 1274–1276 says the body "is taller than its 190"; line 1538 says "same 190px body"; line 1991 says "Three levels and a price line inside 190px" | 1276, 1538, 1991 | The 190 references are inherited from `PostMarketTab`'s `WallChart` and were never updated. Port **250**, and **550** for the popout — line 2305 says the popout is "twice as tall" while 2420 passes `MIG_H * 2.2`. **THE CODE WINS: 2.2×** |
| T6 | **A comment describes a model that was removed. THE CODE WINS.** `DaySeg.roles`'s doc (1566–1570) says "the two ROLES — CORE (the heavier wall) and OTHER (the lighter one)". The removal note at 1504–1507 says that model was deleted on 2026-08-27 because it made ALL report a different CORE than CORE for the same ticker | 1504–1507 vs 1566–1570 vs 1756 | The code sets `core[s] = c` where `c = cbArr[s]` — **the recorded `cb` strike**, not the heavier wall. `OTHER` is the wall CORE is *not* sitting on. Anyone porting from the doc comment reintroduces the "MSFT reads 505 here and 500 everywhere else" bug the removal note exists to prevent |
| T7 | **`REACTION_RULE` cannot be verified against the classifier.** Its header says it "mirrors `classify()` in `walls-recorder.js`"; that file is not in this tree | 306–317; `ls server-v2/` returns three files | Nine tooltips state numeric thresholds — `0.15%`, `5 pts`, `0.10%`, `0.30%`, `3 samples`, `3+ samples` — that no staged code confirms. **If `classify()` has moved, these tooltips lie to the customer.** Verify before the port ships |
| T8 | **`isBreakThenReject` renders a badge the legend cannot explain.** The legend calls `wallBadge(rx)` with `reclaimMin` defaulting to `null`, so `BREAK & REJECT (Nm)` never appears in it. Nor does `UNTESTED`, which the timeline renders whenever a hit is unresolved | 1056–1058 vs 356–367 | Two of the eleven badges a reader can encounter have no key. Decision: add both to the legend (`BREAK & REJECT` needs a sample `reclaim_min`), or accept the gap explicitly |
| T9 | **One state, three words.** An unresolved hit renders the badge `UNTESTED`, the meta `watching — resolves 4 slots after the tag`, and the clipboard verdict `WATCHING` | 357, 2515, 453 | Same row, same field (`reaction == null`), three vocabularies. Pick one |
| T10 | **`WallDelta` paints a downward roll amber, not red**, while every other directional affordance on the page uses red for down (the `↓ from above` chip, the error card) | 613 vs 2585 | Deliberate or drift? There is no comment. Amber is also `break_lt5`/`break_5`/`consolidated` and both basis chips, so the down-delta chip is visually a "break" badge. Transcribe as-is or unify |
| T11 | **`popout` opens on `range = 5`, which fires up to 13 requests, and the reader asked for one chart.** `useWallDays` requests `count + 3 = 8` candidate weekdays before it knows which have rows, then up to 5 tapes | 2329, 2250–2295 | The `Today` range is already loaded and costs nothing (2331). Decision: default the popout to `1`, or keep `5` and accept the burst. Note the two waves are a genuine waterfall — wave 2 waits on wave 1 — which v3's rule 3 will flag; the justification (2230–2238) is that a holiday should not cost a candle fetch, which is real but is a request-count trade, not a latency one |
| T12 | **The cold-load waterfall is not removable.** `loadDay` must resolve before `sel` exists, and all four per-symbol reads key on `sel` | 665, 692, 1372, 1484, 396 | Unlike `/em`, where every enrichment URL was built from a symbol known at step 1, here the symbol comes **out of** the first response. The only way to flatten it is to guess — e.g. prefetch `SPX` (which is `QUICK_TICKERS[0]` and in `scanner-tickers.js` MAIN) in parallel with the day list and discard it if `rows[0]` differs. See Part U |
| T13 | **Four fetches, four `alive` booleans, zero `AbortController`s.** A rapid sequence of ticker clicks fires N requests and renders whichever **resolves** last, not whichever was **issued** last | 680, 1344, 1448, 2247, and `GexHeatBar.tsx:377` | On a slow connection, clicking SPX → SPY → QQQ can leave SPY's log on screen under a QQQ header if SPY resolves last. v3's `query()` has dedupe and a stale window but no cancellation either; this needs a per-request generation counter or a real abort signal |
| T14 | **The migration caption undercounts in mixed mode.** When any segment is dense the caption prints `totalMins`, which sums `spotDrawn.length` **only over dense segments** — the non-dense sessions contribute nothing and are not mentioned | 1979–1981, 2075–2077 | A week where three days had tape and two did not reads as "3 sessions' worth of minutes" over a five-session chart. Small, but it is a number the panel prints about itself |
| T15 | **`core_held` cannot say "held".** The meta test is `core_held === false ? "was the CORE — CORE moved after" : "was the CORE"`, so `true` and `null` render identically | 2512, 469 | The recorder distinguishes "the CORE held" from "we do not know"; the page does not. Decision: add a third string, or drop the field |
| T16 | **A change row with a null `delta` reads "Rolled down".** `Number(null) > 0` is `false` | 2478 | The strike pair beside it (`6450 → 6475`) can contradict the word. The rail's tooltip handles the same field correctly with an explicit `delta != null` guard (1131) — two readers of one field, one of them guarded |
| T17 | **Fully built, rendered by nothing:** `mmdd()` (a formatter with a doc comment naming its caller, which uses a different formatter); `stepRun`'s `reverse` branch; four of `WallTicker`'s ten fields; three timestamp fields across the two row types; and `SnapSample` in its entirety (T1) | Part S | Each is a small thing; together they are ~40 lines of code the port would carry across for nothing |
| T18 | **The page has no responsive behaviour of its own.** A fixed two-column grid, a 620 px scroller, a 6-column table and a wrapping control bar, at any width | 892, 903, 1046 | v2 is partly rescued by `globals.css`'s GLOBAL GRID COLLAPSE. **v3 has no equivalent** (`em.md` Part K, still open). Whatever `/em` does about this, this page needs the same |

---

# Part U — Open questions for Brandon

1. **`scanner.md` is not in the tree.** The brief names it as the model and as
   the source of the `V2.green` / `V2.up` / `V2.accent` split.
   `cbedge-v3/docs/parity/` contains only `em.md`. Is `scanner.md` unstaged, or
   is the scanner inventory somewhere else? This document was written against
   `em.md` and applied the split as the brief states it.

2. **`V2.up` `#1FD98A` and `V2.accent` `#7dd3fc` do not exist yet.** The staged
   `theme.ts` has `V2.pos` `#22c55e`, `V2.refresh` `#1fd98a` and `V2.lightBlue`
   `#7ed3fc`. `--color-v2-refresh` already **is** `#1fd98a`. Two questions:
   (a) does `V2.up` alias `--color-v2-refresh`, or get its own
   `--color-v2-up` with the same value so a refresh state and a positive figure
   can move apart later? (b) `V2.accent` must be `#7dd3fc`, which is **one digit
   off** the existing `--color-v2-lightblue` `#7ed3fc` — confirm a new token
   rather than a reuse.

3. **`MUTED` is `#FFFFFF`.** Does the port reproduce v2's rendering (every
   "muted" element full white, indistinguishable from body text) or v2's
   intent (a real step-down)? Twelve elements are affected. v3's `--color-muted`
   is also `#ffffff`, so a straight re-key reproduces it silently either way —
   this needs a deliberate answer.

4. **The timeline dot cannot tell a tag from an open baseline** — both are
   `#FB8501`. Fix, or transcribe?

5. **`/proxy/walls?series=1`** — wire `samples` into the chart's gamma (which is
   what its own header comment says it exists for), or shrink the read to an
   expiry lookup? Today it is a full day of rows for two scalars.

6. **`REACTION_RULE`'s nine threshold strings** need checking against
   `walls-recorder.js`'s `classify()`, which is not staged. Can that file be
   staged, or is there a canonical statement of the thresholds elsewhere?

7. **`public/core-migration.html` is not in this tree**, and `CoreMigrationButton`
   is the only thing that opens it. Does v3 keep the pop-out tab (which needs
   that static file served under v3), turn it into a v3 route, or drop the
   button?

8. **`globals.css`** is not staged, and this page depends on it twice — the
   `wall-scroll` class on three scrollers, and the GLOBAL GRID COLLAPSE block
   that stacks the two columns on a phone. Both need a v3 answer before the
   layout can be called finished.

9. **The popout's default range is `5`, costing up to 13 requests on open.**
   Default it to `1` (free, already loaded), or keep `5`?

10. **The cold-load waterfall (T12).** Prefetch `SPX`'s detail in parallel with
    the day list on the assumption that `rows[0]` is usually SPX, or accept the
    two-stage load? A wrong guess costs one wasted request; a right one removes
    a full round trip from every cold load.

11. **Request cancellation.** Four hooks use an `alive` flag with no abort, so
    the last **resolved** response wins rather than the last **issued** (T13).
    Does v3 add a generation counter to `query()`, or does the page carry its
    own?

12. **The snapshot buttons.** `/em` resolved this on 2026-09-02 by moving to one
    owner-gated toolbar camera with surfaces publishing themselves to it. This
    page has **two** capture targets — the log card and the popout panel — with
    different titles and filenames. Does the toolbar camera take a target list,
    or does the popout keep an in-panel button?
