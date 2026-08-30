# Parity inventory — Options Chain

**What this is.** One line per value the v2 page renders, with where it comes
from, how it is formatted, what changes its colour, and what it shows when the
value is missing. It is the SPEC for the v3 port: the v3 page is finished when
every row here is ticked, and not before.

**Why it exists.** The failure mode this document prevents is rebuilding a page
from scratch — re-deciding what it contains at the same time as building it.
Both jobs were already done in v2. This file finishes the first one so the
second is only construction.

**Scope.** v2's `components/pages/OptionsChain.tsx` (3,658 lines), mounted by
`app-vite/src/App.tsx` at `/app/options-chain` with **no props** (standalone
mode), plus everything it composes:

| File | Lines | Why it is in scope |
|---|---|---|
| `components/pages/OptionsChain.tsx` | 3,658 | the page |
| `lib/calculations/optionChain.ts` | 165 | `parseExpiration`, `GreekCell`, the greek formulas |
| `lib/calculations/heatSkins.ts` | 199 | `HEAT_SKINS`, `skinMetricBg`, `skinRankBg`, `levelFillBg` |
| `lib/calculations/heatLevels.ts` | 124 | `columnWalls`, `wallAt`, `WALL_RANK`, `INTENSITY_MIN`, `atMinIntensity` |
| `lib/marketSession.ts` | 132 | `etToday`, `etDateKey`, `isTradingDay`, `isSessionLive`, `isSpxFeedLive` |
| `lib/useScannerTickers.ts` | 51 | the ticker universe behind the picker |
| `hooks/useRefreshButton.ts` | 34 | the ↻ button's four labels + 1800 ms revert |
| `components/shared/ChainReplay.tsx` | 594 | the "⛶ Ladder" modal |
| `components/shared/DockToolbar.tsx` | (partial) | `Dock`, `SegGroup`, `DockCogMenu`, `DockField` geometry |
| `components/shared/DataBox.tsx` | (partial) | `BoxSnapBtn`, `BoxDiscordBtn` |
| `components/shared/homeTheme.ts` | (partial) | `HOME_THEME`, `LEVEL_COLORS`, the four shared styles |

**Total: 214 checklist rows.**

| Part | Covers | Rows |
|---|---|---|
| A | Page frame, load bar, injected keyframes | 6 |
| B | Toolbar — identity cluster (left) | 8 |
| C | Toolbar — ticker picker, GO, Recent, Refresh, Snap, Discord | 17 |
| D | Settings cog — Grid / Heat / Stamps / Replay sections | 18 |
| E | Replay transport bar | 21 |
| F | Empty, loading and error states | 6 |
| G | Grid frame, column template, header row | 11 |
| H | Expiry column headers + ⅀ Total header | 10 |
| I | Strike rails (left + mirrored right), ATM / EM tags | 14 |
| J | Value cells — heat, markers, Δ15 stamp, greek figure | 22 |
| K | OI cells and VOL cells | 12 |
| L | ⅀ Total cells | 6 |
| M | Strike hover card | 15 |
| N | Contract flow popup (**DEAD — unreachable**) | 11 |
| O | ChainReplay "⛶ Ladder" modal | 22 |
| P | Data layer — endpoints, polling, guards | 10 |
| Q | Derived state — window, scales, MVC, Δ15, EM | 3 |
| R | Persistence, props, dead code, known bugs | 2 |

---

## Column meanings

- **Source** — the endpoint AND the field underneath it, or the exact
  client-side formula where the value is derived. `/api/chains → data.items[].strikes[].call.gamma`
  is a source; "the chain" is not.
- **Format & units** — decimal places, sign prefix, `$`, `%`, `×`, padding.
  What the code actually does, not what looks sensible.
- **Threshold / colour rule** — every condition that changes a colour, a weight
  or the wording. This is where detail goes missing when a page is described
  rather than transcribed.
- **Empty / loading** — literally what renders when the value is not there.

---

## v2 colour constants

`components/shared/homeTheme.ts`, imported as `HOME_THEME as HT`. Two of them
are not the colour their name suggests.

| Token | Hex | Note |
|---|---|---|
| `HT.bg` | `#05060A` | |
| `HT.panel` | `#0D1119` | |
| `HT.cyan` | `#219EBC` | the page accent |
| `HT.purple` | `#126783` | a dark teal, not a violet |
| `HT.orange` | `#FB8501` | replay's colour throughout |
| `HT.green` | `#8ECAE6` | **a light blue** — the "positive total" colour here |
| `HT.red` | `#EF4444` | |
| `HT.muted` | `#FFFFFF` | identical to `HT.text`; "muted" is done with `opacity` |
| `HT.text` | `#FFFFFF` | |
| `HT.border` | `rgba(255,255,255,0.10)` | |
| `HT.panelBg` | `rgba(13,17,25,0.45)` | the grid's background |
| `HT.panelBgStrong` | `rgba(13,17,25,0.72)` | the flow popup's card |

`LEVEL_COLORS` (same file) — CB / CW / PW badge colours, used by `levelFillBg`:

| Key | Hex |
|---|---|
| `cb` | `#ffd600` |
| `cw` | `#29b6f6` |
| `pw` | `#ff4757` |
| `onSolid` | `#04121a` |

**Colour literals declared inside `OptionsChain.tsx` itself** (all of these must
become tokens in v3 — non-negotiable 1):

| Literal | Where |
|---|---|
| `#c3ccda` (`SOFT_WHITE`) | classic-skin cell ink |
| `#22c55e` / `#ef4444` | `SignVal` +/− ink; `✕` volMVC marker |
| `#4ade80` / `#f87171` | `DeltaStamp` figure ink |
| `#0D1119` (`HDR_BG`) | sticky header + strike rails; `DeltaStamp` plate |
| `#ffffff` | ATM inset rule; vivid cell ink; EM tag ink |
| `#3a4a5e` | "no value" / "·" ink |
| `#e4e4e7` | non-ATM strike-rail ink |
| `#ffd600` | classic `★` CB marker |
| `#04121a` | vivid `★` CB marker (on gold fill) |
| `#ffb300` | classic MVC outline ring + `mvcGlow` keyframe |
| `#29b6f6` / `#ff4757` | hover card CALLS / PUTS block |
| `#8B94A7` / `#cfe` / `#fff` | hover card `Row` key / value / strong |
| `#ffd600` / `rgba(255,255,255,0.28)` | ticker picker ★ / ☆ |
| `#219EBC` | intensity slider `accentColor` + its readout (hardcoded, not `HT.cyan`) |
| `#4a6a88` | empty-state body ink |
| `#05060A` | toolbar band background (hardcoded, not `HT.bg`) |
| `rgba(41,182,246,…)` / `rgba(255,71,87,…)` | heat ramp pos/neg (from `HEAT_SKINS`) |
| `rgba(13,17,25,0.97)` | both dropdown menus' background |

**Shared styles referenced by name below**

- `homeShellStyle` = `height/width 100% · overflow hidden · bg HT.bg · backgroundImage HT.shellGlow · font var(--font-inter) · color HT.text · flex column · minHeight 0`
- `homeButtonStyle` = `padding 5px 10px · radius 6 · 1px rgba(33,158,188,.25) · bg linear-gradient(180deg,rgba(33,158,188,.12),rgba(33,158,188,.04)) · HT.cyan · 10px/700 · letterSpacing .08em · uppercase · pointer`
- `homeInputStyle` = `14px · padding 8px 12px · 1px HT.border · radius 6 · bg rgba(0,0,0,0.4) · HT.text · outline none`
- `segBtnStyle(on)` (page-local) = `height 34 · padding 0 14px · 12px/700 · radius 8 · uppercase · letterSpacing .04em · borderBox`; **on** → border `rgba(HT.cyan,.35)`, bg `linear-gradient(180deg,rgba(HT.cyan,.18),rgba(HT.cyan,.05))`, ink `HT.cyan`; **off** → border `rgba(255,255,255,0.06)`, bg `rgba(255,255,255,0.04)`, ink `HT.text`
- `rgba(hex, a)` — page-local helper, identical implementation to `homeTheme`'s

---

## Shared formatters — transcribe these verbatim

| Fn | Rule |
|---|---|
| `fmtMoney(v)` | `sign = v >= 0 ? "+" : "-"`; `abs ≥ 1e6` → `` `${sign}$${(abs/1e6).toFixed(2)}M` ``; `abs ≥ 1e3` → `` `${sign}$${(abs/1e3).toFixed(1)}K` ``; else `` `${sign}$${abs.toFixed(0)}` ``. **Note zero renders `+$0`, not `$0`.** |
| `fmtCount(v)` | unsigned-compact: `sign = v < 0 ? "-" : ""` (no `+`, no `$`); `≥1e6` → `2dp M`; `≥1e3` → `1dp K`; else `0dp` |
| `fmtChg(v)` | falsy (incl. `0`) → `"·"`; else `` `${v>0?"+":"-"}${fmtCount(Math.abs(v))}` `` |
| `fmtDeltaChip(d)` | `!isFinite` → `"--"`; `sign = d<0 ? "−" : "+"` (**U+2212 minus, not hyphen**); `m = Math.round(Math.abs(d)/1e6)`; `m === 0` → `` `${sign}<$1M` ``; else `` `${sign}$${m.toLocaleString("en-US")}M` `` |
| `fmtExpHeader(iso)` | `new Date(iso + "T00:00:00Z")` (UTC, to avoid a local-TZ day shift); NaN → `iso`; else `` `${["Sun".."Sat"][getUTCDay()]} ${MM}-${DD}` `` → `"Mon 06-23"` |
| `fmtReplayClock(iso)` | `toLocaleTimeString("en-US", {timeZone:"America/New_York", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false})`; throw → `iso` |
| `fmtFlowMoney(v)` | `` `${v>=0?"+":"-"}$${(abs/1e6).toFixed(1)}M` `` — always millions, 1 dp |
| `fmtHoverUsd(n)` | `s = n<0?"-":""`; `≥1e9` → `2dp B`; `≥1e6` → `2dp M`; `≥1e3` → `1dp K`; else `0dp`; all prefixed `$`. **No `+` on positives** |
| `fmtHoverInt(n)` | `Math.round(n || 0).toLocaleString()` |
| `skinFig(text, plusSign)` | `plusSign ? text : text.replace(/^\+/, "")` |
| `rankOf(v, top3)` | `i = top3.indexOf(Math.abs(v))`; returns `i+1` when `0 ≤ i < 3`, else `0` |
| `buildExpiries()` | fallback calendar only: next 14 `isTradingDay` dates from `etToday()`, scanning at most 40 days. Label `` `${Day}, ${MM}-${DD}-${YYYY}` `` (**LOCAL** `getDay/getMonth/getDate`) |
| `isCurrentWeekExp(iso)` | Mon–Fri of the current ET week. Monday = `etToday() + (dow===0 ? +1 : 1-dow)` at 00:00 local; Friday = Monday+4 at 23:59:59.999; compares `new Date(iso+"T12:00:00")` |
| `nearestStrikeTo(t, strikes)` | linear scan, first minimum of `|s − t|` wins ties; `null` when `t` non-finite or list empty |
| `oiSides(strike, atm)` | `strike > atm` → `{call:true, put:false}`; `< atm` → `{call:false, put:true}`; `=== atm` → both |
| `oiSideChange(snap, strike, atm)` | both sides → `callChg − putChg`; call-only → `callChg`; put-only → `−putChg` |
| `volSideValue(cell, strike, atm)` | both → `callVol − putVol`; call-only → `callVol`; put-only → `−putVol` |
| `pickCenterStrike(all, nearest, anchor, key)` | empty/zero → `nearest`; `anchor.key !== key` or either strike missing → `nearest`; else `|trueIdx − anchorIdx| ≥ 5` ? `nearest` : `anchor.strike` |

---

# Part A — Page frame

Source: lines 3110–3128, 3540.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Page shell | `<div ref={pageRef}>` | `...homeShellStyle` + `height:"100%"` + `overflow:"hidden"` | none — `pageRef` is also the snapshot/Discord capture root | n/a |
| Injected `<style>` | inline string, line 3119 | `@keyframes mvcGlow{0%,100%{box-shadow:0 0 3px rgba(255,179,0,.35)}50%{box-shadow:0 0 10px rgba(255,179,0,.9)}}` | `.mvc-peak-cell{animation:mvcGlow 2.4s ease-in-out infinite}` — applied to the ★ MVC cell only | always present |
| `.mvc-peak-left` / `.mvc-peak-right` | same `<style>` | `clip-path: inset(-12px 0 -12px -12px)` / `inset(-12px -12px -12px 0)` | **DEAD** — neither class is applied anywhere in the file. Do not port | n/a |
| Load progress bar — track | `loadProgress > 0` | `position:absolute; top/left/right:0; height:3; zIndex:10` | bg `HT.bg` | rendered only while `loadProgress > 0` |
| Load progress bar — fill | `loadProgress` | `width: {n}%; height:100%` | bg `HT.cyan`; `transition: width 0.3s ease` | Set to `8` at fetch start, `100` on success, then `0` after **800 ms**; `0` on error |
| Toolbar band | wrapper div, line 3128 | `flex column · gap 3 · padding "3px 10px 4px" · flexShrink 0 · position sticky · top 0 · zIndex 60 · minWidth 0` | bg `#05060A` (a literal, **not** `HT.bg` — same value); `borderBottom 1px HT.border` | always renders |

---

# Part B — Toolbar, identity cluster (left)

Inside `<Dock captureHide className="dock-noscroll" flat fullWidth>`; the Dock
itself is `flexWrap:nowrap · overflowX:auto · scrollbarWidth:none · width 100%`.
`captureHide` sets `[data-capture-hide]`, which `lib/snapshot.ts` strips from
the clone — **the whole Dock is absent from every snapshot**.

Dock (flat) chrome: `padding 6px 10px`, `radius 12px 12px 0 0`, `border none`,
`borderTop 1px rgba(HT.cyan,.12)`, `backdrop-filter blur(16px)`, background
`radial-gradient(ellipse 80% 120% at 50% -20%, rgba(cyan,.07) 0%, transparent 70%), linear-gradient(180deg, panelBg 0%, rgba(#0d1119,.25) 55%, transparent 100%)`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "OPTIONS CHAIN" | static | `12px / 800 · letterSpacing .14em · uppercase · nowrap` | `HT.cyan` | always |
| Active ticker | `activeTicker` state | `13px / 800 · letterSpacing .06em · var(--font-mono) · nowrap` | `HT.cyan` | initial value `"SPX"` |
| Mode readout | derived | `` `${greekMode.toUpperCase()} · ${DATA_MODE_LABEL[dataMode]} · ${displayPercent}%` `` — e.g. `"GEX · OI + Vol · 10%"`. `10px / 800 · letterSpacing .08em` | `HT.text` | always. `DATA_MODE_LABEL`: `oi-vol → "OI + Vol"`, `vol-only → "Vol Only"`, `flow → "Flow GEX"` |
| LIVE/REPLAY dot | `replayFrame != null` | `7×7 circle` | `HT.orange` when a replay frame is on screen, else `HT.green` (`#8ECAE6`) | always |
| LIVE/REPLAY label | same | `"REPLAY"` / `"LIVE"` · `10px / 800 · letterSpacing .08em` | same colour rule as the dot | always |
| FOCUS chip | `selExps.size` / `selStrikes.size` | `` `FOCUS: ${["N exp", "N strike(s)"].filter(Boolean).join(" + ")} ✕` ``; strike part pluralises at `>1`. `height 20 · padding 0 8px · radius 999 · 9.5px/800 · letterSpacing .06em` | border `rgba(HT.cyan,.5)`, bg `rgba(HT.cyan,.14)`, ink `HT.cyan`. Click → `clearSel()` (both sets emptied) | **rendered only while `hasSel`** — it is the only way out of a selection |
| OI provenance line | `/proxy/oi-change → date`, `prevDate` (via `oiSnapshot`) | three wordings: `` `ΔOI ${date} vs ${prevDate}` `` · `` `OI ${date} · no prior snapshot yet` `` · `"OI snapshot not recorded"`. `9.5px / 700 · nowrap · opacity .9` | `HT.cyan` when `prevDate` exists, else `HT.muted` | rendered **only** when `greekMode === "oi"` |
| Identity cluster box | — | `flex:1 · minWidth 0 · flex row · align center · gap 8 · overflow hidden` | none | n/a |

---

# Part C — Toolbar, actions (right)

The whole ticker group is hidden when `externalTicker != null`. On the
standalone `/options-chain` route it always renders.

### C1 — Ticker picker (`TickerListDropdown`, page-local, lines 286–441)

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Trigger button | static | `"Tickers ▾"` — `10px/700 · padding 5px 10px · radius 6 · uppercase · letterSpacing .08em` | border `HT.border`, bg `rgba(255,255,255,0.04)`, ink `HT.text`; `▾` at `opacity .7` | always |
| Menu panel | portal to `document.body` | `position fixed · left = trigger.left · top = trigger.bottom + 3 · width 200 · zIndex 9999` | bg `rgba(13,17,25,0.97)` · `blur(20px)` · `1px HT.border` · `borderTop 2px rgba(HT.cyan,.5)` · radius 6 · `boxShadow 0 8px 32px rgba(0,0,0,0.7)` | anchored on `scroll` (capture) + `resize` |
| Search box | `query` state | `placeholder "Search…"`, uppercased on input, `autoFocus`, `spellCheck false`. `11px/700 · padding 5px 8px · radius 5 · letterSpacing .06em` | bg `rgba(255,255,255,0.04)`, `1px HT.border` | **Cleared on CLOSE, not on open** — the menu never renders a frame of stale filtering |
| Ticker universe | `useScannerTickers()` → `GET /proxy/scanner-tickers` → `j.tickers` | trimmed, uppercased, deduped | falls back to the static `SCANNER_TICKERS` list on any non-OK or throw | picker is never empty |
| Filter | `t.includes(query.trim().toUpperCase())` | substring, not prefix | empty query matches all | — |
| Sort order | — | favourites first (`.sort()` A→Z), then a 1px divider, then the rest (`.sort()` A→Z) | divider rendered only when **both** groups are non-empty | `"No match"` at `10px HT.muted`, `padding 8px 12px`, when zero rows |
| Row | — | `★/☆ + ticker` · `padding 5px 10px · 11px · letterSpacing .04em` | active (`=== activeTicker.toUpperCase()`) → weight 800, ink `HT.cyan`, bg `rgba(33,158,188,0.10)`; else 600 / `HT.text` / transparent. Hover → `rgba(33,158,188,0.15)` / `rgba(255,255,255,0.05)` | — |
| Favourite star | `localStorage["options-chain-fav-tickers-v1"]` (JSON string[]) | `★` when favourited else `☆`, `12px`, `title` = `"Unfavorite"` / `"Favorite"` | `#ffd600` when on, `rgba(255,255,255,0.28)` when off. Click `stopPropagation`s so it does not select the ticker | `[]` on parse failure |
| Close behaviour | — | outside `mousedown` (trigger **and** portal menu both count as inside); selecting a row | — | — |

### C2 — GO, Recent, Refresh, Snapshot, Discord

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "GO" button | `doGo()` | `segBtnStyle(false)` | `disabled` + `opacity .45` + `cursor not-allowed` when `!tickerInput`; else `opacity 1` | always rendered (standalone) |
| GO behaviour | — | uppercases `tickerInput`, pushes it to recents, sets `activeTicker` | **ticker changed** → sets `pendingGoRef` and waits for `/api/expirations` to snap a valid expiry before loading; **unchanged** → `loadChain(ticker, selectedExpiry, bust=true, force=true)` immediately | no-op when `tickerInput` is empty |
| "Recent ▾" dropdown | `localStorage["options-chain-recent-tickers-v1"]` | `CustomDropdown` with `triggerLabel="Recent"`, `accentCyan={false}` → border `HT.border`, bg `rgba(255,255,255,0.04)`, ink `HT.text` | menu rows: active → 800 / `HT.cyan` / `rgba(33,158,188,0.10)`; menu z-index **100010** (must sit above `DockToolbar`'s 100000) | **hidden entirely when `recentTickers.length === 0`** |
| Recents list rule | `pushRecentTicker` | most-recent-first, de-duplicated, **max 7** (`RECENT_TICKERS_MAX`) | written on every GO and every quick-select | hydrated in an effect after mount (avoids SSR mismatch) |
| Refresh button | `useRefreshButton(doRefresh)` | four labels: `"↻ Now"` (idle) · `"↻ Refreshing…"` · `"✓ Refreshed"` · `"✗ Failed"` | `homeRefreshButtonStyle(state)`: idle ink `HT.cyan` / border `rgba(cyan,.4)` / bg `rgba(cyan,.08)`; refreshing ink `#888`, `opacity .6`, `cursor not-allowed`; success `#1FD98A` + `textShadow 0 0 12px rgba(green,.5)`; error `HT.red` + matching glow. `10px/700 · padding 2px 10px · radius 2` | reverts to idle after **1800 ms**; re-entry locked by `lockedRef` while in flight |
| Refresh behaviour | `doRefresh` | `loadChain(activeTicker, selectedExpiry, bust=true, force=true)` then `refreshSeed += 1` | `refreshSeed` re-triggers the DoD, EM, prev-close, changeMap, Δ15 and OI-change effects | — |
| Snapshot button | `BoxSnapBtn targetRef={pageRef} title={replayTitle}` | emoji-only: `📸` idle · `…` busy · `✓` ok · `✕` err. `padding 2px 5px · fontSize 14` | ink `#a78bfa` idle, `#00e676` ok, `#ef4444` err; `borderColor = ${color}40` | 1800 ms revert; clipboard first, silent download fallback to `snapshot.png` |
| Discord button | `BoxDiscordBtn targetRef={pageRef} title={replayTitle} message={…}` | same emoji states | **owner-only** — `useIsOwner()` false ⇒ renders `null` | message: live → `` `📊 Options Chain — ${activeTicker} ${selectedExpiry}` ``; replay → `` `⏪ Options Chain REPLAY — ${activeTicker} · ${replayDate} ${fmtReplayClock(frame.ts)} ET` `` |
| Snapshot title band (live) | `snapTitle` | `` `Options Chain — ${activeTicker}  •  ${greekMode.toUpperCase()}  •  ${dataMode === "oi-vol" ? "OI+Vol" : "Vol only"}` `` (two spaces either side of each `•`) | — | — |
| Snapshot title band (replay) | `replayTitle` | `` `Options Chain REPLAY — ${activeTicker}  •  ${replayDate} ${clock} ET  •  ${scope}  •  GEX  •  ${basis}` ``; `scope` = `` `0DTE ${replayZeroDteExp}` `` or `` `all exp (${n})` `` | — | falls back to `snapTitle` when no replay frame |

---

# Part D — Settings cog (`DockCogMenu`)

`title="Options chain"`, `buttonTitle="Options chain settings"`, `width={340}`,
`paneHeight={236}`. Tabs, not an accordion: one fixed-height pane, only the
active body mounted, the tab choice sticky across open/close. Every section's
`summary` is joined with `" · "` into the panel's state line.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Tab "Grid" — summary | derived | `` `${displayPercent}% · ${greekMode.toUpperCase()}` `` | — | always |
| "STRIKES" field | `DockField label="Strikes"` | label `10px/800 · letterSpacing .10em · uppercase · rgba(255,255,255,0.62)` | — | — |
| % strikes dropdown | `CustomDropdown` over `DISPLAY_PERCENTS` | options **5, 10, 15, 20, 25, 30, 50, 100**, labelled `` `${v}% strikes` ``. Cyan trigger: border `rgba(33,158,188,.25)`, bg `linear-gradient(180deg,rgba(33,158,188,.12),rgba(33,158,188,.04))`, ink `HT.cyan` | menu `zIndex 100010`, `maxHeight 320`, `overflowY auto` | default **10 for SPX, 30 for every other ticker**, re-applied on every `activeTicker` change (user override survives only until the next ticker change) |
| "GREEK" field | `SegGroup wrap` over `GREEK_MODES` | six tiles: **GEX · DEX · CHEX · VEX · OI · VOL**, labels uppercased | active tile → `1px rgba(cyan,.35)` + `linear-gradient(180deg,rgba(cyan,.18),rgba(cyan,.05))` + ink `HT.cyan`; inactive → transparent border, `T.tile` bg, ink `T.text`. Strip: `padding 4 · radius 12 · bg rgba(0,0,0,0.22) · 1px rgba(255,255,255,0.04) · minHeight 34`; wrapped tiles `height 26` | **`opacity .4` + `pointerEvents none` while `replayOn`**, with `title="GEX only in replay — DEX/CHEX/VEX/OI/VOL are not recorded"`. Rendered inert, never hidden |
| `wrap` on the Greek strip | — | six tiles in a ~316px pane | without it the last tile (VOL) ran under the pane's `overflowX:hidden` edge and was unclickable | — |
| "BASIS" field | `SegGroup wrap` over `DATA_MODES.filter(m => m !== "flow")` | two tiles: **"OI + Vol"** and **"Vol Only"** | **`"flow"` is deliberately filtered out of the UI** — `DATA_MODES` still contains it and `parseExpiration` still implements it, but nothing can select it | stays live during replay (`strike_growth` records both bases) |
| Tab "Heat" — summary | derived | `` `${HEAT_SKINS[heatSkin].label.toLowerCase()} · ${intensity <= 0.5 ? "levels" : `${intensity.toFixed(2)}x`}` `` | — | always |
| Intensity slider | `<input type="range">` | `min 0.5 · max = HEAT_SKINS[skin].intensity.max · step 0.01 · width 110 · height 3` | `accentColor "#219EBC"` (hardcoded) | — |
| Intensity hint | `DockField hint` | `"Heat intensity. At the minimum stop the gamma wash switches off and only CB / CW / PW stay marked."` | label gets `cursor:help` | — |
| Intensity readout | `intensity` | `"LEVELS"` when `intensity ≤ INTENSITY_MIN.chain (0.5)`, else `` `${intensity.toFixed(2)}x` ``. `10px/700 · minWidth 44 · var(--font-mono)` | ink `#219EBC` (hardcoded) | — |
| Intensity ranges per skin | `HEAT_SKINS` | classic `{def: 1.75, max: 3}` · vivid `{def: 3, max: 4}` | switching skins **resets** intensity to the new skin's `def` — the number is not carried across, because the ramps are different curves | first render always uses `CHAIN_DEFAULT_SKIN`'s def; a saved skin is applied in an effect (hydration-safe) |
| Deferred intensity | `useDeferredValue(intensity)` | the grid paints from the deferred copy | keeps slider drag responsive while the ~560-cell matrix repaints on a lower-priority pass | — |
| "SKIN" field | `SegGroup` | two tiles: **CLASSIC**, **VIVID** | — | — |
| Skin persistence | `localStorage["chain_heat_skin"]` | `"classic"` / `"vivid"`, validated by `isHeatSkin` | default `CHAIN_DEFAULT_SKIN = "vivid"` | invalid/absent → default |
| Tab "Stamps" — summary | derived | `"Δ15m"` when `showDelta15 && !replayOn && greekMode === "gex"`, else `"off"` | — | always |
| Δ15m toggle button | `setShowDelta15` | label `"Δ15m"`, `segBtnStyle(active)` | `disabled` when `replayOn \|\| greekMode !== "gex"` → `opacity .4`, `cursor default`. Three tooltips: replay → `"Δ15m stickers are live-only — not available in replay"`; wrong tab → `"Δ15m stickers are GEX-only"`; else → `"Stamp each front-expiry cell with its 15-minute net-GEX change (top 5 strikes per side of ATM)"` | **off by default** (it widens the 0DTE column, so the layout shift must be asked for) |
| Tab "Replay" — presence | `isStandalone` | section exists **only** when `externalTicker == null` | an embedded chain must not be able to show yesterday | — |
| Tab "Replay" — summary | `replayOn` | `"running"` or `undefined` (omitted from the state line) | — | — |
| Replay toggle button | `setReplayOn` | `"▶ Replay"` / `"■ Exit Replay"`, `segBtnStyle(replayOn)`, `title="Rewind the grid itself through the session's recorded net-GEX snapshots"` | — | initial state = `initialReplay` prop (`false` on the standalone route) |

---

# Part E — Replay transport bar

Rendered when `replayOn && isStandalone`, **outside** the `captureHide` Dock —
deliberately, so a screenshot of a rewound grid always carries its clock.

Bar chrome: `flex · wrap · gap 10 · padding 5px 8px · radius 8 · 11px · nowrap`,
border `1px rgba(HT.orange,.35)`, bg `linear-gradient(180deg,rgba(HT.orange,.12),rgba(HT.orange,.03))`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "REPLAY" | static | `800 · letterSpacing .1em · uppercase` | `HT.orange` | always |
| Session date dropdown | `/proxy/strike-growth/replay-meta?symbol=…` → `j.dates`, sliced to 10 chars | `CustomDropdown` with `accentCyan={false}` | — | **hidden when `replayDates.length === 0`**; `replayErr` set to `` `No recorded sessions for ${activeTicker}.` `` |
| Date selection rule | — | keeps the current date if it is still in the list, else `ds[0]` | list is ~5 trading days (recorder retention) — it is not a history picker | — |
| "Exp" label | static | `10px / 700` | `HT.muted` | always |
| Scope buttons | `REPLAY_SCOPES` | two: **"0DTE"** and **"All exp"** (`REPLAY_SCOPE_LABEL`). `segBtnStyle(active)` overridden to `height 24 · padding 0 9px · 10px · textTransform none` | `"0dte"` `disabled` + `opacity .4` when `!replayZeroDteExp` | — |
| Scope tooltips | — | 0DTE → `` `Show only ${exp}` `` + `" (expires this session)"` when exact, or `" — front recorded expiry; this root had no same-day listing"` when a fallback; when no expiry → `"No expiry recorded for this session"`. All → `` `Show all ${n} recorded expiries, with the ⅀ Total column (0DTE excluded from Total, as on the live chain)` `` | — | — |
| Scope switch semantics | — | frame index is **untouched** by the switch | 0DTE scope hides the ⅀ Total column entirely (`showTotalCol = false`) | — |
| ◀ step-back | — | `segBtnStyle(false)` + `height 26 · padding 0 8px` | `disabled` when no frames or `replayIdx <= 0`; `opacity` `1`/`.4` | pauses playback first |
| ▶ / ❚❚ play-pause | — | `▶` when paused, `❚❚` when playing. `height 26 · padding 0 12px`, `segBtnStyle(replayPlaying)` | `disabled` when `replayFrames.length < 2`; `opacity` `1`/`.4` | pressing ▶ **at the last frame rewinds to index 0 first** |
| ▶ step-forward | — | `height 26 · padding 0 8px` | `disabled` at the last frame | pauses playback first |
| Scrubber | `<input type="range">` | `min 0 · max = frames.length−1 · flex 1 · minWidth 160 · height 3` | `accentColor HT.orange`; `disabled` with no frames | dragging sets `replayPlaying = false` |
| "Speed" label + tiles | `REPLAY_SPEEDS` | five: **0.5× 1× 2× 4× 8×**, rendered `` `${sp}×` ``. `height 24 · padding 0 7px · 10px · textTransform none` | active → `segBtnStyle(true)` | frame interval = `REPLAY_BASE_MS (700) / speed` |
| Separator | static | `"\|"` | ink `HT.border` | always |
| Frame clock | `replayFrame.ts` | `` `${fmtReplayClock(ts)} ET` `` → `"13:42:07 ET"`. `var(--font-mono) · 800` | `HT.text` | `"--:--:--"` when no frame |
| Recorded spot | `replayFrame.spot` | `` `spot ${spot.toFixed(2)}` `` · `var(--font-mono)` | `HT.muted` | `"spot —"` when spot ≤ 0 |
| Frame counter | — | `` `frame ${min(idx, n−1)+1} / ${n}` `` | `HT.muted`, `opacity .75` | empty string when no frames |
| Coverage line — prefix | static | `"· recorded walls only · "` | `HT.muted`, `opacity .7` | rendered only when a frame exists |
| Coverage line — expiry part | derived | 0DTE scope → `` `${exp}${exact ? "" : " (front — no same-day listing)"} of ${replayAllExpiries.length} recorded` ``; all scope → `` `${n} expir${n===1?"y":"ies"}` `` | — | — |
| Coverage line — cell count | derived | `` `${shown}/${replayAxis.strikes.length * max(1, replayAxis.expiries.length)} cells this frame · GEX only` ``. In 0DTE scope `shown` counts only that expiry's keys | denominator **shrinks with scope** so the 0DTE view is not made to look incomplete | — |
| Loading / error chips | `replayLoading`, `replayErr` | `"· loading…"` / `` `· ${replayErr}` `` | `HT.cyan` / `HT.red`; error is suppressed while loading | — |
| "⛶ Ladder" button | `setReplayOpen(true)` | `segBtnStyle(false)` + `height 26 · padding 0 10px · 10px`, `title="Open the single-ladder replay view"` | pushed right by a `flex:1` spacer | opens the `ChainReplay` modal (Part O) |

---

# Part F — Empty, loading and error states

Three mutually exclusive branches, in this order (lines 3542–3567).

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Replay empty — heading | `replayOn && isStandalone && !replayFrame` | `"Loading recorded session…"` while `replayLoading`, else `` `Nothing recorded to replay for ${activeTicker}` ``. `14px / 700 · marginBottom 8` | `HT.orange` | — |
| Replay empty — body | same | loading → `` `${activeTicker} · ${replayDate}` ``; else `` `${replayErr \|\| "No snapshots for this ticker yet."} The recorder keeps roughly five trading days and only covers tickers on the scanner watchlist.` ``. `12px · lineHeight 1.5 · maxWidth 460` | container ink `#4a6a88` | — |
| No-strikes — heading | `!visibleStrikes.length` | `"No Live Chain Data"` when `chainError`, else `"Select ticker, expiry & % strikes"`. `14px / 700 · marginBottom 8` | ink `#4a6a88` | — |
| No-strikes — body | same | `chainError` text, else `"Then click GO to load chain"`. `12px` | — | — |
| `chainError` wordings | `loadChain` | `` `No live chain payload returned for ${ticker}.` `` (all columns parsed to zero cells) · `` `Live chain load failed for ${ticker}.` `` (fetch threw) | also `console.error("[OptionsChain] Load failed for …", err)` | cleared to `null` at the start of every load |
| Empty-state container | — | `flex 1 · flex · align center · justify center · 12px` | ink `#4a6a88` | — |

---

# Part G — Grid frame, column template, header row

`ChainMatrix` is `React.memo`'d so parent-only state (progress bar, clock,
intensity commits) never re-renders the ~560-cell matrix.

Scroll container: `flex 1 · overflow auto · minHeight 0 · padding "0 10px 10px"`
— **no `padding-top`**, because a sticky `top:0` header inside a padded scroll
container sticks to the content edge and rows show through the gap above it.
The breathing room is `marginTop: 8` on the grid itself.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Grid element | — | `display grid · radius 12 · overflow clip · marginTop 8` | `1px HT.border` + `borderTop 2px rgba(HT.cyan,.85)`; bg `HT.panelBg` | — |
| `gridTemplateColumns` | derived | `` `${56}px ${…expiry tracks} ${total?} ${ghosts?} ${56}px` `` | see the three rows below | — |
| Expiry track width | `isCountMode`, `hasDelta15` | normal `minmax(78px, 1fr)`; **count tabs (OI/VOL)** `minmax(84px, 1fr)`; the Δ15 column `minmax(152px, 1.9fr)` | the Δ15 widening applies **only** to `columns[i].expiration === delta15Exp` and only while stickers are on screen | — |
| ⅀ Total track width | `showTotalCol` | `minmax(88px, 1.15fr)`; count tabs `minmax(92px, 1.15fr)` | omitted entirely when `showTotalCol` is false | — |
| Ghost tracks | `layoutExpCols` | `ghostExpCols = max(0, layoutExpCols − renderIdx.length)` at the same widths, plus one ghost Total track when `layoutExpCols > 0 && !showTotalCol` | **live chain passes `layoutExpCols = 0`, so ghosts are off**; replay passes `replayAllExpiries.length` so collapsing to 0DTE does not stretch the remaining column | ghost cells are empty `aria-hidden` divs, one per row (the grid auto-places and rows are `display:contents`, so a missing cell would shear the whole grid) |
| Rendered column filter | `renderIdx` | indices `0..gridCols-1`, **dropping any column whose `expiration` is not `isTradingDay`** (e.g. an observed Jul 3) | empty placeholder slots (`columns[i] == null`) are kept | — |
| `gridCols` | derived | replay → `columns.length`; live → `max(columns.length, expirySelection === "key" ? 4 : seqColumns)` | `seqColumns = max(1, floor(expiryCount ?? EXP_COLUMNS))`, `EXP_COLUMNS = 14` | live keeps the fixed slot count so the grid does not reflow while expirations resolve |
| Row height floor | `ROW_MIN_H` | **17px**, applied on the sticky strike cells (the one cell every row has) | pinned so a row's height is independent of its contents — otherwise a strike gaining a value under replay grows its row and shoves the ATM rule | count-mode cells that need two lines still grow past it |
| Header corner (left) | static | `"Strike"` · `position sticky · left 0 · top 0 · zIndex 6 · padding 7px 5px · 9px/800 · uppercase · letterSpacing .03em · align flex-end` | bg `#0D1119` (`HDR_BG`, fully opaque — rows scroll under it); `borderBottom` + `borderRight` `1px HT.border` | always |
| Header corner (right) | static | `"Strike"` · `position sticky · right 0 · top 0 · zIndex 6` · same type · `justifyContent flex-end` | `borderBottom` + `borderLeft` `1px HT.border` | always |
| Ghost header cells | — | `position sticky · top 0 · zIndex 3 · background HDR_BG · borderBottom 1px HT.border` | opaque so rows scroll *under* the header band rather than through the gap beside it | — |

---

# Part H — Expiry column headers and the ⅀ Total header

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Expiry header cell | — | `position sticky · top 0 · zIndex 3 · textAlign center · padding 5px 6px · borderBottom 1px HT.border · transition opacity .12s` | three background states, in priority order: **selected** → `linear-gradient(180deg, rgba(cyan,.30), rgba(cyan,.07)), HDR_BG` + `inset 0 -2px 0 HT.cyan`; **change column** → `linear-gradient(180deg, rgba(orange,.18), rgba(orange,.05)), HDR_BG`; **normal** → `linear-gradient(180deg, rgba(cyan,.14), rgba(cyan,.04)), HDR_BG` | placeholder slot renders `"—"` |
| Expiry date text | `fmtExpHeader(col.expiration)` | `"Mon 06-23"` · `10px / 500` | ink `HT.orange` on a change column, else `HT.text` | `"—"` |
| Change-mode suffix | `changeMode` | appended as `` ` ·Δ${changeMode}` `` → `" ·Δ15"`, `" ·Δ30"`, `" ·Δ60"` | only on columns present in `changeMeta.expiries` | absent on `"live"` |
| Δ15m suffix | `hasDelta15` | `" ·Δ15m"` · `700` | ink `HT.muted`; only on `col.expiration === delta15Exp` and only when it is **not** a change column | absent |
| Per-expiry total | `visibleStrikes.reduce(valueAt)` (or `changeMap` on a change column) | `fmtVal(colTotal)` — `fmtMoney` normally, `fmtChg` on OI, `fmtCount` on VOL. `10px / 800 · var(--font-mono)` | `HT.green` when `≥ 0`, `HT.red` when `< 0`, `HT.muted` when null | `"—"` for a placeholder slot |
| Header click | `onToggleExp(exp, e.shiftKey)` | plain click toggles the expiry in `selExps`; **shift-click solos** (replaces the set with just this one; shift-clicking the sole selection clears it) | `title="Click to focus this expiration (shift-click = only this one)"` | no handler on a placeholder slot |
| Unselected column dimming | `selMode && !expSel` | `opacity 0.3` on the header | — | — |
| ⅀ Total header cell | `showTotalCol` | `position sticky · top 0 · zIndex 3 · padding 5px 6px` | bg `linear-gradient(180deg, rgba(cyan,.24), rgba(cyan,.07)), HDR_BG`; `borderLeft 2px rgba(HT.cyan,.45)` | hidden when `showTotalCol` is false |
| ⅀ Total header label | `selExps.size` | `"Total"` normally, `` `Sel ${n}` `` while expiries are selected. `10px / 700 · letterSpacing .04em` | ink `HT.cyan` | — |
| ⅀ Total header figure | `grandVisibleTotal` = sum of every `rowTotals` value | `fmtVal(...)`, `10px / 800 · var(--font-mono)` | `HT.green` when `≥ 0` else `HT.red` | — |

**What ⅀ Total sums.** Per strike, across every rendered expiry **except the
session's 0DTE** (`todayKey = sessionDate \|\| etDateKey(etToday())`) — unless
expiries are selected, in which case it sums **exactly the selected set, 0DTE
included** (an explicit pick outranks the default exclusion). Change columns
contribute their `changeMap` value; count tabs never mix in change dollars
(`!isCountMode` guards both the row sum and the per-cell branch).

---

# Part I — Strike rails and row markers

Two rails per row: sticky left (`left:0`) and a mirrored sticky right
(`right:0`), so a cell in the furthest expiry column is one glance from its
strike. Identical behaviour; only the border edge and the selection gradient
direction differ.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Strike number | `strike` | `Number.isInteger(strike) ? strike.toFixed(0) : strike.toFixed(2)` · `10px · var(--font-mono) · textAlign right` | `HT.cyan` + weight 700 on the ATM row; else `#e4e4e7` + weight 400 | — |
| Left rail box | — | `position sticky · left 0 · zIndex 2 · padding "2px 5px" · minHeight 17 · borderRight 1px HT.border · flex · align center · justify flex-end · gap 3 · nowrap · overflow hidden · cursor pointer · transition opacity .12s` | bg `HDR_BG`, or `linear-gradient(90deg, rgba(cyan,.06), rgba(cyan,.30)), HDR_BG` when the strike is selected | — |
| Right rail box | — | as above but `right 0`, `padding "2px 5px 2px 10px"`, `borderLeft 1px HT.border` | selection gradient is `linear-gradient(270deg, …)`; selection inset is `inset 2px 0 0 HT.cyan` (left rail uses `inset -2px 0 0`) | extra left padding keeps the number off the Total column's figure |
| ATM rule | `strike === nearestStrike` | `boxShadow: inset 0 2px 0 #ffffff, inset 0 -2px 0 #ffffff` on both rails | **inset shadow, never a real border** — a 2px top+bottom border adds 4px to the tallest cell in the row, so the ATM row would grow and the whole ladder would jump each time spot crossed a strike | — |
| "ATM" tag | `isATM` | `"ATM"` · `8px / 900 · letterSpacing .06em · padding 0 · fontFamily sans-serif · marginRight auto` | ink `HT.cyan`, background transparent | — |
| ATM tooltip | — | `` `At-the-money — nearest strike to spot (${spot ? spot.toFixed(2) : "—"})` `` | — | — |
| "EM ±1σ" tags | `emStrikes.d1` / `.u1` | `"EM +1σ"` / `"EM −1σ"` (**U+2212 minus**) · `8px / 800 · letterSpacing .02em · padding 1px 3px · radius 3 · marginRight auto` | ink `#ffffff`, bg `rgba(255,255,255,0.12)` | rendered only when `anyCurrentWeek && emStrikes != null` |
| "EM ±2σ" tags | `emStrikes.d2` / `.u2` | `"EM +2σ"` / `"EM −2σ"` | same styling as 1σ | same gate |
| EM tooltips | `emLevels` | `` `1× weekly expected move ${up?"up":"down"} (${close} ± ${em})` `` and `` `2× weekly expected move … (${close} ± ${2*em})` ``; the parenthetical is omitted when `emLevels` is null | — | — |
| EM marker lines | — | **removed** — the tag beside the strike is the whole signal; the CLOSE (band-centre) marker is gone entirely | `emStrikes.close` is still computed but nothing renders it | — |
| Row click | `onToggleStrike(strike, e.shiftKey)` | plain click toggles into `selStrikes`; shift-click solos | `title` falls back to `"Click to focus this strike (shift-click = only this one)"` when there is no EM/ATM tooltip | both rails carry the same handler |
| Unselected row dimming | `selStrikes.size > 0 && !strikeSel` | rails `opacity 0.28`; value cells `opacity 0.13` | — | — |
| ATM row ref | `atmRowRef` | attached to the **left** rail cell of the ATM row only | used by both auto-scroll effects | — |
| Padding rows | `visibleStrikes[i] === null` | full row of empty cells, both sticky rails at `minHeight 17` + `HDR_BG` | exists so the centre strike stays centred when the chain runs out on one side | Total cell (if shown) keeps `borderLeft 2px rgba(HT.cyan,.25)` |

---

# Part J — Value cells (greek tabs)

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Cell box | — | `padding "2px 8px"` (count tabs `"3px 6px"`) · `fontSize = CELL.fontSize` · `var(--font-mono)` · `textAlign right` · `letterSpacing 0` · `nowrap · overflow hidden` · `flex · justify flex-end · gap 5` · `transition opacity .12s` | `alignItems`: count tabs `center`, else `CELL.align` (classic `baseline`, vivid `center`) | — |
| Cell geometry per skin | `CHAIN_CELL` (page-local, **not** `HEAT_SKINS[…].cell`) | **classic**: `radius 0 · inset 0 · fontSize 10 · text #c3ccda · weight [400,400,400] · signColors true · plusSign true · align baseline`. **vivid**: `radius 3 · inset 0.5 · fontSize 9.5 · shadow "0 1px 2px rgba(0,0,0,.85)" · text #ffffff · weight [600,600,300] · signColors false · plusSign false · align center` | the skin's ramp / rank floors / level fill come from `HEAT_SKINS`; only the geometry is overridden here | — |
| Cell inset margin | `CELL.inset` | vivid only: `margin: 0.5` — a margin, **not** a grid gap, so the column tracks do not move and the sticky header stays aligned | **not applied on the ATM row** — the ATM rule is an inset shadow on every cell and a margin would break it into dashes | — |
| Cell weight | `CELL.weight[rank===1 ? 0 : rank ? 1 : 2]` | rank 1 / ranks 2–3 / unranked | `value == null` forces weight 400 | — |
| Cell ink | `CELL.text` | classic `#c3ccda`, vivid `#ffffff` | `value == null` → `#3a4a5e` | — |
| Cell text shadow | `CELL.shadow` | vivid only, and only when `value != null` | — | — |
| Heat fill (normal) | `skinMetricBg(value, cellScale.max, cellRank, intensity, SK)` | `n=0 \|\| max=0` → `"transparent"`; rank 1/2/3 → `skinRankBg`; else `ratio = min(\|n\|/max, 1)`, `eased = (ratio × max(intensity, 1))^ease`, `alpha = min(ramp.max, ramp.base + eased × ramp.span)`, `rgba(pos\|neg, alpha.toFixed(2))` | classic ramp `{base .02, span .16, max .18, ease 1.4}`; vivid ramp `{base .05, span .25, max 1, ease 0.4}`. `pos = "41,182,246"`, `neg = "255,71,87"` (both skins) | `transparent` |
| Rank floors | `skinRankBg(value, rank, SK)` | `rgba(pos\|neg, SK.rank[rank-1])` | classic `[0.90, 0.45, 0.25]` · vivid `[0.95, 0.62, 0.40]` | — |
| Levels-only mode | `atMinIntensity(intensity, 0.5)` | the whole gamma wash switches **off**; only CB / CW / PW paint, at rank floors 1 / 2 / 3 (`WALL_RANK`) | walls come from `columnWalls(visibleStrikes × valueAt)` so they follow the **active greek tab**; change columns are left bare — "the wall" is a statement about gamma, not a 15-minute delta | non-wall cells `transparent` |
| CB / CW / PW definition | `columnWalls(rows)` | **CB** = largest `\|net\|` (sign-blind, takes its strike first). **CW** = largest `+net` strike ≠ CB. **PW** = most `−net` strike ≠ CB | `null` rather than a fallback when a side is empty or holds only CB — three labels always name three distinct strikes | — |
| Level fill overlay | `levelFillBg(kind, SK, heat)` | classic → `null` (falls through to plain heat). vivid → `` `linear-gradient(over, over), ${heat === "transparent" ? "rgba(0,0,0,0)" : heat}` `` where `over = rgba(LEVEL_COLORS[kind], alpha)` | vivid alphas `{cb: 0.85, cw: 1, pw: 1}` — CB pulled back because gold at 1.0 swamps the row | — |
| Which cells get a level fill | `cellLevel` | `SK.levelFill` off → never. Levels-only → CB/CW/PW. **Every other slider position → the CORE level only** (the ★ MVC strike) | — | — |
| ATM box on a cell | `atmShadow` | `inset 0 2px 0 #ffffff, inset 0 -2px 0 #ffffff` on every cell in the ATM row, **plus** `inset 2px 0 0 #ffffff` on the first rendered column; the right edge is drawn on the ⅀ Total cell | box-shadow, not a border — same layout reason as the rails | — |
| ★ MVC marker (classic) | `mvcByCol[colIdx] === strike` | `"★"` · ink `#ffd600` · `lineHeight 1` + `MARKER_EDGE` | `MARKER_EDGE` = `WebkitTextStrokeWidth 1px · WebkitTextStrokeColor #000 · paintOrder "stroke fill" · textShadow "0 0 3px rgba(255,255,255,.9), 0 0 1px rgba(0,0,0,1)"` | `title="CB - Core Bullseye — highest \|net GEX\|"` |
| ★ MVC marker (vivid) | same | pinned `position absolute · top 1 · left 2 · fontSize 10 · pointerEvents none` | ink `#04121a` with `textShadow 0 0 2px rgba(255,255,255,.55)` — a gold star on a gold tile is an invisible star | same tooltip |
| MVC ring | `isMvc && !SK.levelFill` | `outline: 2px solid #ffb300; outlineOffset: -2px` | **classic only** — on vivid the cell itself is gold and a ring reads as a smudge | — |
| MVC glow | `className="mvc-peak-cell"` | `animation: mvcGlow 2.4s ease-in-out infinite` | applied whenever `isMvc`, on both skins | — |
| ✕ volume-MVC marker | `volMvcByCol[colIdx] === strike` | `"✕"` · `11px / 900` + `MARKER_EDGE` | ink `#22c55e` when the volume-only GEX at that strike is `≥ 0`, `#ef4444` when negative (falls back to the cell value, then to `0`, if `volGex` is missing) | rendered **only** when `greekMode === "gex" && dataMode === "oi-vol"` and not a change column |
| ✕ tooltip | — | `` `Highest volume GEX (${fmtMoney(volGex)}) — ${positive?"positive":"negative"} gamma` ``; the parenthetical is dropped when `volGex` is null | — | — |
| Δ15 sticker | `delta15.get(strike)` | `fmtDeltaChip(d)` in a chip: `height 14 · 9px · var(--font-mono) · lineHeight 1 · padding 0 4px · radius 4 · nowrap · flexShrink 0` | weight **900 when `rank === 1`**, else 800. bg `#0D1119` (uniform dark plate, so it reads the same on a hot wall and a quiet strike); ink `#4ade80` when `d > 0`, `#f87171` otherwise; `border none` | `title` = `` `Δ15m ${text} · #${rank} mover (${Math.abs(Math.round(pct))}%)` `` |
| Δ15 gating | `hasDelta15` | `!isCountMode && greekMode === "gex" && delta15Exp && delta15.size > 0`, and per-cell `col.expiration === delta15Exp` and not a change column | — | — |
| Greek figure | `fmtMoney(value)` | classic → `<SignVal>` (leading `+`/`-` tinted `#22c55e`/`#ef4444`, rest `#c3ccda`); vivid → `skinFig(...)` with the leading `+` stripped and no sign colours | vivid drops the coloured sign because a full-strength red tile with a green `+` on it is the unreadable case; direction is carried by the tint | `"·"` in `#3a4a5e` when `value == null` |
| Figure with a sticker | `dEntry != null` | the `<span>` takes `marginLeft:auto · minWidth 0 · overflow hidden · textOverflow ellipsis` | the value is pushed right by margin, not a reserved slot, so unstamped rows in the same column give all their width to the number and every value still ends on the same right edge | — |
| Cell click | `onCellHover({strike, colIdx, x: e.clientX, y: e.clientY})` | opens the strike hover card (Part M) | `title="Click for volume / OI / net premium"`; only when `col != null` | **note: this is a CLICK, despite the prop name `onCellHover`** |
| Cell dimming | — | `opacity 0.13` when the row is dimmed **or** (`selMode` and the column is not selected) | a cell stays lit only if BOTH its column and its row survive the selection | — |

---

# Part K — OI and VOL cells

Both count tabs ladder identically — **calls above the ATM strike, puts below,
both on the ATM pivot row** (`oiSides`) — so flipping between OI and VOL
compares the same cells rather than re-reading the grid.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| OI cell — content | `oiChangeMap.get(`exp\|strike`)` from `/proxy/oi-change` | **the day-over-day CHANGE only** — the settled OI level is deliberately not printed | one `OiChgLine` per side actually rendered; two only on the ATM pivot | `"·"` in `#3a4a5e` when the snapshot has no non-zero change on a rendered side |
| `OiChgLine` figure | `fmtChg(chg)` | `"+1.2K"` / `"-430"` / `"·"` for flat. `weight 700`, `lineHeight 1.3`, `fontSize 10` | ink `rgba(255,255,255,0.96)` + `textShadow 0 1px 2px rgba(0,0,0,0.85)` when non-zero, else `#3a4a5e`. **Near-white on purpose** — a red number on a red heat cell was unreadable; direction is carried by the leading sign and the tint | `chg === null` (no stored baseline) renders `"—"`, so "we don't know" never reads as "unchanged" |
| `OiChgLine` side letter | `oiBothSides` | `"C"` / `"P"` · `9px / 700 · marginRight auto` | ink `rgba(255,255,255,0.35)` | rendered **only on the ATM pivot row**, where position cannot say which side |
| OI heat / totals value | `valueAt` → `oiSideChange(snap, strike, nearestStrike)` | above ATM → `callChg`; below → `−putChg`; at ATM → `callChg − putChg` | the colour a cell wears and the figure it shows can never disagree — both read this number | `null` when there is no snapshot entry (the cell renders empty rather than falling back to a live OI level with no delta beside it) |
| OI missing-strike rule | — | strikes the 9:32 sweep did not capture render empty | a root outside the watchlist, an expiry past recorded depth, or a strike listed intraday | — |
| VOL cell — content | `col.cells.get(strike)` → `callVol` / `putVol` (live off the chain) | today's traded contract count, **unsigned** | one `VolLine` per rendered side; two only on the ATM pivot | `"·"` when neither rendered side has a non-zero volume |
| `VolLine` figure | `fmtCount(Math.abs(vol))` | `"12.4K"`, `"1.2M"`. No leading sign — volume is a LEVEL, not a change, so every figure would wear a `+` | same near-white-on-heat treatment as `OiChgLine` | `"·"` for an untraded strike (flat and untraded look identical at 10px; the dot is the quieter of the two) |
| `VolLine` side letter | `oiBothSides` | `"C"` / `"P"` | as above | ATM pivot only |
| VOL heat / totals value | `valueAt` → `volSideValue(cell, strike, nearestStrike)` | above ATM → `+callVol`; below → `−putVol`; at ATM → `callVol − putVol` | the sign is purely the SIDE, so the heat scale can say "calls"/"puts" in the same blue/red language every other tab speaks | — |
| Two-line container | — | `flex column · alignItems stretch · width 100% · lineHeight 1.3 · fontSize 10` | — | — |
| Column formatter | `fmtVal` | OI → `fmtChg` · VOL → `fmtCount` · everything else → `fmtMoney` | used by the expiry-header totals, the ⅀ header and the ⅀ cells | — |
| Δ-column lockout | `isCountMode` | **the 15/30/60 Δ columns never apply on OI or VOL** | those columns carry volume-GEX dollars — a different quantity in a different unit; on OI it would fight the cell's own ΔOI, on VOL it is simply not what the tab shows | both count tabs always read live columns |
| Cell padding | `isCountMode` | `"3px 6px"` instead of `"2px 8px"`; track width 84/92px instead of 78/88px | — | — |

---

# Part L — ⅀ Total cells

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Total figure | `rowTotals.get(strike)` | `fmtVal(tot)`, `weight 700 · CELL.fontSize · var(--font-mono) · textAlign right` | count tabs and vivid → white figure (`rgba(255,255,255,0.96)` + shadow), direction from the tint only; classic non-count → `<SignVal>` | `"·"` in `#3a4a5e` when `tot === 0` |
| Total heat | `skinMetricBg(tot, totalScale.max, rankOf(tot, totalScale.top3), intensity, SK)` | own scale, computed over the visible strikes' `\|rowTotals\|` (descending; `max = [0] ?? 1`, `top3 = slice(0,3)`) | levels-only → `columnWalls` over `rowTotals` and `skinRankBg` at `WALL_RANK`. The ⅀ column is ranked as its own column | `transparent` when `tot === 0` |
| Total border | — | `borderLeft: 2px solid rgba(HT.cyan, selMode ? 0.8 : 0.35)` | brightens while expiries are selected | padding rows use `rgba(HT.cyan, 0.25)` |
| Total ATM edge | `isATM` | `inset 0 2px 0 #ffffff, inset 0 -2px 0 #ffffff, inset -2px 0 0 #ffffff` | the ATM box's right edge lives here (the ⅀ column is the rightmost value column) | — |
| Total dimming | `strikeDim` | `opacity 0.13` for a **strike** selection only | never dims for an expiry selection — the ⅀ column answers that by re-summing | — |
| Total cell box | — | `padding "2px 8px" · nowrap · overflow hidden · flex · align baseline · justify flex-end · radius CELL.radius` | `textShadow` from `CELL.shadow` when `tot !== 0` | — |

---

# Part M — Strike hover card (`StrikeHoverCard`)

Opened by **clicking** any populated cell. Portalled to `document.body`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card box | — | `position fixed · width 246 · zIndex 1000 · padding 13 · radius 12 · var(--font-mono) · color #fff` | bg `rgba(13,17,25,0.98)` · border `1px rgba(33,158,188,0.30)` · `boxShadow 0 12px 40px rgba(0,0,0,0.6)` · `blur(12px)` | — |
| Placement | pointer `x`,`y` | `left = clamp(8, x+16, vw−262)`, `top = clamp(8, y+16, vh−240)` | `vw`/`vh` default to 1280/800 during SSR | — |
| Title | `ticker`, `strike` | `` `${ticker} ${strike.toLocaleString()}` `` · `15px / 800` | — | — |
| Expiry | `fmtExpHeader(expiration)` | `"Mon 06-23"` · `11px / 600 · marginLeft auto` | `HT.muted` | — |
| Close ✕ | — | `background none · border none · 14px · lineHeight 1`, `aria-label="Close"` | `HT.muted` | also closes on outside `mousedown` (deferred one tick so the opening click does not close it) and on `Escape` |
| CALLS block | `cell.callVol`, `cell.callOI`, `cell.callPrem` | three rows: `Volume` / `OI` / `Net Prem`. Block: `padding 7px 9px · radius 8` | colour `#29b6f6`: bg `rgba(c,0.06)`, border `1px rgba(c,0.28)`, label ink `c` at `10px/800 · letterSpacing .08em` | — |
| PUTS block | `cell.putVol`, `cell.putOI`, `cell.putPrem` | same shape | colour `#ff4757` | — |
| `Row` component | — | `flex · justify space-between · 11.5px · lineHeight 1.6` | key ink `#8B94A7`; value ink `#cfe` at 600, or `#fff` at 800 when `strong` | — |
| Volume / OI values | `fmtHoverInt` | `Math.round(n).toLocaleString()` → `"12,431"` | — | `"0"` |
| Net Prem values | `fmtHoverUsd` | `$1.23M` / `$45.6K` / `$789` — no `+` on positives; `strong` | — | `"$0"` |
| "Net Prem (C−P)" | `cell.callPrem − cell.putPrem` | `fmtHoverUsd(netPrem)` · `12px / 800`, above a `1px rgba(255,255,255,0.08)` rule | `#29b6f6` when `≥ 0`, `#ff4757` when negative | — |
| "Δ GEX vs Yest" | `/proxy/strike-dod?limit=2000` → matched row's `now_delta ?? delta` | `sgn()` = `(v>=0?"+":"") + fmtHoverUsd(v)` · `12px / 800` | `#29b6f6` when `≥ 0` else `#ff4757` | when no DoD row matches: label plus `"— (top-mover strike only)"` at `11.5px HT.muted opacity .7` |
| "Yest → Now" | `net_yest`, `net_now` | `` `${sgn(netYest)} → ${sgn(netNow)}` `` · `11px / 600` · ink `#cfe` | — | `net_now == null` renders `"—"` for the right-hand side |
| DoD match rule | — | `d.strike === hoverCell.strike && (!d.expiry \|\| d.expiry === col.expiration)` | rows are pre-filtered to `activeTicker` (uppercased) at fetch time | the endpoint returns **one row per ticker**, at the strike that moved most vs yesterday — every other strike legitimately has no baseline |
| Card gating | — | rendered only when `hoverCell` and both `columns[colIdx]` and its cell exist | — | silently nothing otherwise |

---

# Part N — Contract flow popup (`ContractFlowPopup`) — **DEAD CODE**

> **Finding.** `ChainMatrix` destructures `onCellClick` but **never calls it**.
> Every populated cell's `onClick` invokes `onCellHover` instead. `contractPopup`
> can therefore never become non-null, and this entire component — ~120 lines,
> a `lightweight-charts` instance, and a `/proxy/flow-gex-history` call — is
> unreachable in the shipped build. It is inventoried so the port is a decision
> rather than an accident: **recommend NOT porting**, and dropping
> `lightweight-charts` from the v3 page's dependency graph with it. If it should
> come back, wire the cell click to it explicitly and say so.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Overlay | — | `position fixed · inset 0 · zIndex 500 · flex centre` | bg `rgba(0,0,0,0.55)`; click outside closes | — |
| Card | — | `width 520 · maxWidth 92vw · radius 14 · padding 16` | bg `HT.panelBgStrong`, `1px HT.border` | — |
| Title | props | `` `SPX ${strike} · ${expiration} · Flow GEX` `` · `17px / 800` | `HT.text`. **Hardcodes "SPX"** regardless of `activeTicker` | — |
| Close ✕ | — | `14px`, `opacity .7` | `HT.text` | — |
| Spot line | `data.spot` | `` `spot ${spot.toFixed(2)}` `` · `14px` | `HT.muted` | `"Loading…"` before the response; empty string when `error` |
| Latest value | last point with `flowGex != null` | `fmtFlowMoney` → `"+$1.4M"` · `var(--font-mono) / 800 · marginLeft 10` | `HT.green` when `≥ 0`, `HT.red` otherwise | omitted when null |
| Chart | `/proxy/flow-gex-history?expiration=…&strike=…` → `seriesByStrike[strike]` | `lightweight-charts` line series, `HT.cyan`, `lineWidth 2`, `priceLineVisible false`, `lastValueVisible true`. Container `height 260` | axes `rgba(255,255,255,.10)`, grid `rgba(255,255,255,.06)`, text `rgba(255,255,255,.70)`; price formatter `fmtFlowMoney`; time formatter ET `HH:mm` 24h | `display:none` until `data` arrives; `fitContent()` after each `setData` |
| Fetch timeout | `AbortController` | **15 000 ms** | the query reconstructs per-minute history from raw tape (a Postgres window CTE over `flow_prints`) and can be slow | — |
| Error — timeout | — | `"Request timed out after 15s — the flow-history query may be slow right now."` | `HT.red` at `14px` | — |
| Error — other | — | `"No response from /proxy/flow-gex-history"` · `` `No tape recorded for strike ${strike} today.` `` · the thrown message · `"Fetch failed"` | — | — |
| Retry button | `setRetryTick` | `"Retry"` · `14px · padding 3px 10px · radius 6 · nowrap` | ink `HT.cyan`, border `1px rgba(HT.cyan,0.4)` | shown beside the error only |
| Footnote | static | `"Combined call+put flow GEX for this strike (approximation: latest known gamma, not gamma-at-that-instant)."` · `12px · opacity .6 · marginTop 8` | `HT.muted` | always |

---

# Part O — ChainReplay "⛶ Ladder" modal

`components/shared/ChainReplay.tsx`, mounted as `<ChainReplay symbol={activeTicker} onClose={…} />`
→ modal mode. **A different data path from in-grid replay**: `/proxy/strike-growth/frames`
(one net per strike, front expiry) rather than `/frames-by-expiry`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Overlay | — | `position fixed · inset 0 · zIndex 9999 · padding "40px 16px" · overflowY auto · align flex-start` | bg `rgba(0,0,0,0.72)`; outside click closes; `Escape` closes | — |
| Modal card | — | `width min(760px, 100%) · radius 14 · padding "18px 20px 20px"` | bg `HT.panel`, `1px HT.border`, `boxShadow 0 24px 60px rgba(0,0,0,0.55)` | — |
| Heading | static | `"Option Chain Replay"` · `16px / 800 · letterSpacing .02em` | `HT.text` | — |
| Sub-heading | static | `"Play back the recorded per-strike net-GEX profile through the session."` · `12px` | `SUB` = `rgba(255,255,255,0.55)` | — |
| Header logo | `/cb-edge-logo.png` | `height 26` | — | — |
| Close ✕ | — | `homeInputStyle` + `34×34 · padding 0 · 18px`, `aria-label="Close"` | — | — |
| Symbol readout | `symbol` | `13px / 800 · letterSpacing .06em · var(--font-mono) · minWidth 46` | `HT.cyan` | `"—"` |
| Symbol picker | `components/shared/TickerListDropdown` (**a different component from the page-local one**), `universe={symbols}` from `/proxy/strike-growth/replay-meta → j.symbols` | — | — | defaults to `"MSFT"` when present, else `syms[0]` — **the page's `symbol` prop wins only if non-empty** |
| Date `<select>` | `/proxy/strike-growth/replay-meta?symbol=…` → `j.dates` | native select, `homeInputStyle` + `padding 6px 10px` | — | resets to `ds[0]` on every symbol change |
| Play / Pause | — | `"▶ Play"` / `"❚❚ Pause"` · `homeInputStyle` + `padding 6px 16px · minWidth 74 · weight 600` | playing → bg `rgba(239,68,68,0.15)`, border `#EF4444`; idle → bg `rgba(125,211,252,0.15)`, border `#7dd3fc` (`LIGHT_BLUE`) | `disabled` with no frames; pressing at the last frame rewinds to 0 first |
| Speed tiles | `SPEEDS = [0.5,1,2,4,8]` | `` `${sp}×` `` · `homeInputStyle` + `padding 4px 8px · 12px` | active → border + ink `LIGHT_BLUE`; inactive → border `HT.border`, ink `SUB`. Interval `BASE_MS (700) / speed` | — |
| Scale tiles | `scaleMode` | **"frame"** and **"day"**, `textTransform capitalize` | `"frame"` rescales each snapshot to its own peak (`frameMax`); `"day"` uses the session-wide `maxAbs`. Tooltips state exactly that. Default `"frame"` | `denom = (mode==="day" ? maxAbs : frameMax) \|\| 1` |
| Scrubber | — | `min 0 · max frames.length−1 · flex 1`, `accentColor LIGHT_BLUE` | dragging sets `playing = false` | `disabled` with no frames |
| Clock + spot | `frame.ts`, tweened `spot` | `` `**HH:MM** ET · spot ${spot.toFixed(2)}` `` · `14px · tabular-nums · minWidth 150 · textAlign right`; clock is `fmtClock` (**minutes only**, unlike the in-grid bar's seconds) | clock `HT.text`, the `· spot …` part `SUB` | `"—"` |
| Frame counter | — | `` `Frame ${idx+1} / ${frames.length}` `` · `12px` | `SUB` | empty string |
| Ladder row — strike | `allStrikes` (union across all frames, **descending**) | `width 56 · textAlign right · 12px · tabular-nums` | `HT.text` | — |
| Ladder row — bars | `netByStrike.get(k) ?? 0` | diverging bar: negative fills right-to-left on the left half, positive left-to-right on the right half. `pct = min(100, \|net\|/denom × 100)`, bar `height 12`, row `height 16`, radius `3px 0 0 3px` / `0 3px 3px 0`, `opacity 0.9`; 1px centre divider in `HT.border` | positive `POS = HT.green (#8ECAE6)`, negative `NEG = HT.red (#EF4444)` | a strike absent from this frame renders a zero-width bar |
| Ladder row — value | `fmtGex(net)` | `≥1e9` → `2dp B`; `≥1e6` → `1dp M`; `≥1e3` → `0dp K`; else `0dp`. **Signed via the raw value, no `$`.** `width 68 · textAlign left · 11px · tabular-nums` | ink `POS` / `NEG` by sign | `"0"` |
| Spot line | interpolated | dashed `1px HT.text`, `left 64 · right 0`, positioned by continuous row index through a measured row pitch (`(lastMid − top0)/(n−1)`, re-measured by a `ResizeObserver`) | off either end it parks one row past the edge rather than clamping | hidden when `spot <= 0` or geometry unmeasured |
| Spot label | — | `` `spot ${spot.toFixed(2)}` `` · `10px · padding 0 4px`, right-anchored, `top -8` | ink `HT.text` on `HT.panel` | — |
| Spot tween | — | eases toward the frame's spot over `min(BASE_MS/speed, 450)` ms, ease-out `1−(1−t)²` | **only while playing** — scrubbing snaps instantly. Cleanup lands exactly on the target so error cannot compound | — |
| Provenance stamp | `symbol`, `frameExpiry`, `date`, `frame.ts` | frosted chip at `left 64 · top 0 · zIndex 3 · pointerEvents none · padding 6px 10px · radius 8`, bg `rgba(5,6,10,0.62)` + `blur(6px)`, `1px HT.border`. Ticker `15px/800 · letterSpacing .08em · HT.cyan`; second line `` `${fmtStampDate(date)} · ${fmtStampClock(ts)} ET` `` at `11px SUB` | expiry chip: `"0DTE"` in `HT.orange` on `rgba(251,133,1,.10)` / border `rgba(251,133,1,.45)` when `frameExpiry === date`; else `` `EXP ${fmtExpiry(exp)}` `` in `LIGHT_BLUE` on `rgba(125,211,252,.10)` / border `rgba(125,211,252,.35)`. `+N` chip at `10px/700 SUB` when `expiryCount − 1 > 0`, `title="Net summed across N expiries"` | `frameExpiry` falls back to `expiries[0]` for older server builds with no per-frame `expiry` |
| Brand mark | `/cb-edge-logo.png` | `height 30`, bottom-right of the ladder, `opacity .92`, `drop-shadow(0 2px 6px rgba(0,0,0,0.8))`, `pointerEvents none` | lives **inside** the ladder so it survives a crop of just the chart | — |
| Loading / error / empty | — | `"Loading…"` (`padding 40 · SUB`) · error text (`padding 24 · NEG`) · `` `No recorded frames for ${symbol} on ${date \|\| "this date"}.` `` (`padding 40 · SUB`) | three failure messages: `"Could not load recorded symbols."` · `"Could not load recorded dates."` · `"Could not load frames."` (or `j.error`, or `"No data."`) | — |

---

# Part P — Data layer

| Concern | Detail |
|---|---|
| Chain fetch | `GET /api/chains?ticker=…&expiration=…&range=all[&noCache=1]` via `dedupeFetch` (identical concurrent GETs collapse to one request — this component is also embedded elsewhere). Reads `json.data.items` and `json.data.underlyingPrice`. **All expiry columns are fetched in parallel and painted in a SINGLE commit** — no column-by-column domino fill, and the old grid stays visible until the new data is ready. |
| Which expiries | `expirySelection === "key"` → `pickKeyExpirations` (0DTE / 1DTE / nearest Friday weekly / nearest 3rd-Friday monthly, each slot claimed independently). Otherwise `all.slice(startIdx, startIdx + seqColumns)` from the selected expiry, `seqColumns = 14`. Falls back to `[{value: startExp}]` when the list is empty. |
| Load guards | `loadInFlightRef` blocks overlapping loads outright; `LOAD_MIN_INTERVAL_MS = 5000` rate-limits non-forced loads. `force=true` (user GO / Refresh) bypasses the interval but still serialises. A `loadTokenRef` discards stale responses. |
| Auto-load | On mount, `loadChain((externalTicker \|\| "SPX").toUpperCase(), selectedExpiry \|\| expiries[0].value)` — not forced. |
| Poll | `setInterval` **60 000 ms**, without `noCache` so the server cache absorbs repeats. Gate: SPX → `isSpxFeedLive()` (Sun 20:00 → Fri 16:00 ET, minus a daily 16:00–18:00 maintenance break, Saturday closed); every other ticker → `isSessionLive()` (9:30–16:00 ET on a trading day). Outside the gate the greeks simply stay stale — no overwrite. |
| Expirations | `GET /api/expirations?ticker=…` → `data.items[]["expiration-date"]`, deduped and sorted, labelled `` `${Day}, ${MM}-${DD}-${YYYY}` `` (local date parts from `iso+"T12:00:00"`). If the current selection is not a real listing, snaps to today's 0DTE if present, else `list[0]`. A pending GO fires its load here, after the snap. Re-runs on **ticker change only**. |
| Flow GEX | `GET /proxy/gex?basis=flow[&noCache=1]` → `gexJson.gexRows[].{strike, flowGEX}`, fetched **only when `dataMode === "flow"` AND the ticker is SPX** (no dealer inventory elsewhere). Currently unreachable — `"flow"` is filtered out of the Basis control. |
| Other endpoints | `/api/levels?ticker=` → `{close, em}` (weekly EM; both must be finite and > 0 or `emLevels` is null) · `/api/quotes-batch?symbols=` → `prev-close` (**write-only — nothing on the page prints it since the stat row was removed**) · `/proxy/strike-dod?limit=2000` → DoD movers, filtered client-side to `activeTicker` · `/api/mult-greek-gex-grid?ticker=&expiry=` → `data.cells[strike].{vNow,v5,v15,v30}` (Δ15 baselines, polled **every 20 000 ms** while the toggle is on, and cleared to `{}` the moment it is off) · `/proxy/strike-growth/by-expiry?symbol=` → `rows[].{expiry, strike, chg15, chg30, chg60}` · `/proxy/oi-change?symbol=` → `rows[].{expiry, strike, callOI, putOI, callChg, putChg}` + `date`, `prevDate`, fetched **only while `greekMode === "oi"`** · `/proxy/strike-growth/replay-meta?symbol=` → `dates[]` · `/proxy/strike-growth/frames-by-expiry?symbol=&date=` → `{expiries[], frames[{ts, spot, cells: [[expIdx, strike, net, vol], …]}]}` |
| OI ticker gate | `oiChange` carries its own `symbol`; `oiSnapshot` returns an **empty map** unless it matches `activeTicker`. Without this, switching ticker on a non-OI tab (which skips the fetch entirely) would render SPY's ΔOI under QQQ's chain, indistinguishable from real data. |
| Greek formulas (`parseExpiration`) | `contracts = OI + volume` per side (**`vol-only` mode zeroes the OI term**); `live = cc > 0 \|\| pc > 0`. `GEX = (γc·cc − γp·pc) · S² · 0.01 · 100` · `DEX = (\|Δc\|·cc − \|Δp\|·pc) · S · 100` · `CHEX = (−θc·cc + θp·pc) · S · 100` · `VEX = (νc·cc − νp·pc) · S · 100` · `volGex = (γc·cVol − γp·pVol) · S² · 0.01 · 100` (always raw volume, independent of `dataMode`) · `oi = cOI − pOI` (**always the settled book — `vol-only` must not blank it**) · `prem = mark × volume × 100` where `mark` falls back `mark → mark-price → (bid+ask)/2 → last → last-price → close → price → mid`. `S = spot > 0 ? spot : 0`. Items are filtered to `expiration-date` matching the target's first 10 chars; if none match, **all** items are used. `flow` mode replaces `gex` with `flowGexMap.get(strike) ?? 0`. |
| Last-update clock | `setLastUpdate(toLocaleTimeString ET, 24h, hh:mm:ss))` on every `activeTicker` / `selectedExpiry` / `displayPercent` / `refreshSeed` change. **`lastUpdate` is never rendered** — dead state since the stat row was removed. |

---

# Part Q — Derived state

| Concern | Detail |
|---|---|
| Strike window | `allStrikes` = union of every strike across the rendered columns, ascending (in replay: the fixed **session** axis, not the current frame's). `nearestStrike` = the strike closest to `spot` (or, with no spot, to `allStrikes[floor(n/2)]`). `autoDisplayPercent`: replay → **100**; `displayPercent === 10 && round(n × 0.10) < 10` → **20**; else `displayPercent`. `visibleStrikes` at ≥100% is the whole ladder sorted **descending**; otherwise `targetCount = max(11, round(n × pct/100))` forced **odd**, `wing = (targetCount−1)/2` strikes each side of the centre, high→low, **padded with `null`** where the chain runs out so the centre stays put. |
| Sticky centre | `RECENTER_EVERY_STRIKES = 5`. The window re-centres only when the true ATM has moved ≥5 strike steps from the anchor; the anchor is state keyed `` `${activeTicker}\|${replayFrame ? `replay:${date}:${scope}` : "live"}` ``, and an anchor from another chain or scope is discarded. **The ATM row itself is never anchored** — the highlight, the OI/VOL side split and the EM tags all follow real spot, so the ATM row drifts up to 4 rows off centre between re-centres (the smallest window is 11 rows, so it can never leave view). |
| Auto-scroll | (a) On load / ticker or window-size change, keyed `` `${ticker}\|${expiry}\|${visibleStrikes.length}` ``, one `requestAnimationFrame` centres the ATM row in the scroll viewport. (b) **While replay is playing only**, if the ATM row leaves the middle 60% of the viewport (`band = viewH × 0.2`), the container scrolls it back to centre — it scrolls, it never reflows, and it is gated on `replayPlaying` so scrubbing never yanks the user's position. |
| Per-column scales | `colScales[i] = { max: sorted[0] ?? 1, top3: sorted.slice(0,3) }` over `\|valueAt(col, s)\|` for the **visible** strikes, excluding zeros. `changeScaleByExp` does the same per change-column. `totalScale` does the same over `rowTotals`. |
| MVC markers | `mvcByCol[i]` = visible strike with the highest `\|cell.gex\|` — **always keyed on GEX, independent of the active greek tab** (that is the MVC definition). `volMvcByCol[i]` = highest `\|cell.volGex\|`. |
| Δ15 selection | Front column (`columns[0]`) only. Take the **top 5 `\|gex\|` strikes on each side of ATM** (`s >= nearestStrike` counts as above). For each: `d = live − gexBaseline[s].v15`; skip when either is null, when `d === 0`, when `\|past\| < 1e-6` (a baseline at ~0 makes the percent meaningless), or when `\|pct\| < 1` (sub-1% is noise), where `pct = d/\|past\| × 100`. Rank runs **1..N within each sign** by `\|pct\|` descending, so a quiet side still gets its own full scale. Suppressed entirely in replay. |
| EM strikes | `emStrikes = { close, d1: close−em, u1: close+em, d2: close−2em, u2: close+2em }`, each snapped to the nearest **visible** strike. Bands render only when `anyCurrentWeek` — i.e. at least one rendered column is `isCurrentWeekExp`. |
| Focus selection reset | `clearSel()` fires on any change to `activeTicker`, `selectedExpiry`, `replayDate` or `replayScope`. |
| Replay mode pinning | Entering replay saves `{greek, change}` to `preReplayModes` and forces `greekMode = "gex"`, `changeMode = "live"`; leaving restores them. The controls stay **visible but inert**, with a tooltip saying why — deliberately not a silent disable. Frames are dropped on any `activeTicker` or `replayOn` change. Playback **stops at the last frame rather than looping** (a session that silently restarts reads as live data jumping backwards). Loading a session lands on the **last** frame, not the first. |
| Replay column build | `replayColumns` maps the **session axis's** expiries (not the frame's) to `ExpColumn`s. Recorded cells carry `{net, vol}`; `gex = dataMode === "vol-only" ? vol : net` (flow is not recorded and reads as OI+Vol rather than blanking the grid); **`dex/chex/vex/oi/callOI/putOI/callVol/putVol/callPrem/putPrem` are all set to `0`** — a live DEX beside a 30-minutes-ago GEX is exactly the confusion replay exists to avoid. |

---

# Part R — Persistence, props and dead code

| Concern | Detail |
|---|---|
| `localStorage` keys | `options-chain-fav-tickers-v1` (string[]) · `options-chain-recent-tickers-v1` (string[], max 7) · `chain_heat_skin` (`"classic"` \| `"vivid"`). All reads are try/catch'd and SSR-guarded; recents and skin are hydrated in effects after mount so the markup cannot mismatch on hydration. |
| Deep link | `?symbol=AAPL&expiry=2026-07-31` **pre-fills** `tickerInput` / `selectedExpiry` but does not auto-load — the user still presses GO. **Uncontrolled mode only**: when `externalTicker` is set the URL belongs to the host page and is ignored. |
| Props (standalone route passes none) | `expirySelection` (`"sequential"` \| `"key"`, default sequential) · `expiryCount` (default `EXP_COLUMNS = 14`) · `ticker` (external control; hides the whole ticker group and the Replay cog section) · `showGrandTotal` (**INERT** — the TOTAL stat row it hid was removed 2026-08-28; accepted only so the `/home` embed keeps type-checking) · `initialReplay` (default false) · `initialReplayScope` (default `"all"`). |
| Removed in v2, do not re-add | The TOTAL stat row (Spot · Total Net GEX · ex-0DTE · Weekly EM · CB of the first three expiries) and the `"TICKER · N% strikes"` readout beside it. Every figure is re-readable from the grid: column headers carry each expiry's total, the ⅀ header carries the ex-0DTE total, ★ marks each column's CB. The EM band marker lines and the CLOSE band-centre marker are also gone. |
| Dead in v2, do not port | `ContractFlowPopup` (unreachable, Part N) · `.mvc-peak-left` / `.mvc-peak-right` CSS · `showGrandTotal` · `lastUpdate` state (set, never rendered) · `prevClose` (write-only) · `emStrikes.close` (computed, never rendered) · `DATA_MODES`' `"flow"` entry (filtered out of the UI) · `RANK_FLOOR_ALPHA` / `rankBg` / `metricBg` in `optionChain.ts` (superseded by `heatSkins`; the chain imports only the skin versions) · `wallVisible` in `heatLevels.ts` (this page has no CB/CW/PW toggles). |

---

# Notes for the port (step 2 onward)

**What must not come across** (v3 non-negotiables): v2 JSX, v2 component
imports, any `@/app/...` alias, and **any colour literal** — every hex in the
tables above becomes a token in `src/design/tokens.css`, reached through
`T.*` / `alpha()` / `mix()`.

**What must come across 1:1**: every formula in the *Shared formatters* table
and Parts J / K / P / Q — the ramps, the rank floors `[0.90,0.45,0.25]` and
`[0.95,0.62,0.40]`, `RECENTER_EVERY_STRIKES = 5`, the top-5-per-side Δ15 gate
with its `1e-6` and `1%` cutoffs, the `oiSides` calls-above/puts-below rule,
`targetCount = max(11, …)` forced odd, the 60 s / 20 s / 15 s / 5 s / 1800 ms /
800 ms timings, and every one of the wordings in the *Empty or loading* column.

**Three v3-shaped decisions this inventory surfaces, for review before any code:**

1. **The socket.** This page opens **no WebSocket at all** — it is entirely
   REST + polling. v3's non-negotiable 2 (`useFrame`/`useField`) has nothing to
   bind here; the port needs `src/data/api.ts` with parallel entry fetches
   (non-negotiable 3), not `hooks.ts`.
2. **The grid is not a chart.** ~560 cells of DOM, memoised, with
   `useDeferredValue` on the intensity slider. It has no canvas, so
   `ChartFrame` / `data-cb-layer` / the visibility contract (non-negotiables
   4–6) do not apply to the matrix. The only paint-budget question is whether
   the cell count needs virtualising in v3 — flagging it now rather than
   discovering it at `npm run perf`.
3. **The existing `cbedge-v3/src/pages/OptionsChain.tsx` (550 lines) is not a
   port of this page.** Its own header comment says so: it builds a
   single-expiry calls/puts ladder and defers the matrix, the skins, four of
   the six greek tabs, replay, the hover card and the flow popup. It also
   guesses the `/api/chains` field names ("NOT confirmed" in its comment) —
   Part P above has them confirmed from `parseExpiration`. **Recommend
   replacing that file rather than extending it**, and reusing only its
   `ExpirationPicker` shell if anything.

---

*Generated from v2 `components/pages/OptionsChain.tsx` @ mtime 2026-08-26.
Review this file, then step 2 (port the logic verbatim into `cbedge-v3/src/`).*
