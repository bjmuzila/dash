# Parity inventory — Analysis (`/analytics`)

**What this is.** One line per value the v2 page renders, with where it comes
from, how it is formatted, what changes its colour, and what it shows when the
value is missing. It is the SPEC for the v3 port: the v3 page is finished when
every row here is ticked, and not before.

**Why it exists.** The failure mode this document prevents is rebuilding a page
from scratch — re-deciding what it contains at the same time as building it.
Both jobs were already done in v2. This file finishes the first one so the
second is only construction.

**Routes.** v2 `/app/analytics` → v3 `/v3/analytics`. The v3 page component is
`src/pages/Analysis.tsx` ("Analysis"); the ROUTE keeps v2's `/analytics`
spelling so a bookmark transfers by swapping one path segment.

**Scope.** v2's `components/pages/Analytics.tsx` (3,445 lines) plus everything
it composes:

| Dependency | What it contributes |
|---|---|
| `components/dashboard/EconCalendarPanel.tsx` (650 lines) | the whole Economic Calendar card, mounted `todayOnly hideToolbar` |
| `lib/failLevels.ts` → `computeAmt` / `InitialBalance` | the IB card's day type, bias lean and bias sentence |
| `hooks/useEsCandles.ts` | the ES candle feed the IB card reads |
| `lib/useScannerTickers.ts` | the ticker universe both pickers offer |
| `hooks/useRefreshButton.ts` | the ↻ button's four states |
| `components/shared/PageCard.tsx` | `PageShell` + `Card variant="budget"` |
| `components/shared/homeTheme.ts` | every colour, `LEVEL_COLORS`, the two button styles |
| `app/globals.css` | `.analytics-grid`, `.analytics-embed`, the global grid collapse |

**Total: 419 checklist rows.**

| Part | Covers | Rows |
|---|---|---|
| A | Page frame, grid, card surface, responsive + embed behaviour | 18 |
| B | Shared primitives and helpers every card below reuses | 21 |
| C | Ticker Lookup — controls, quick row, replay bar | 31 |
| D | Ticker Lookup — identity line, split frame, left pane | 17 |
| E | Ticker Lookup — right pane (board sweep + Δ 1D) | 16 |
| F | Ticker Lookup — the ladder (`TlLadder`) | 22 |
| G | Ticker Lookup — level chips, "The read", disclaimer, stamp | 18 |
| H | Ticker Lookup — the maths (`accumulateChainGreeks`, `tlLevelsFrom`, `tlAtm`, windowing) | 22 |
| I | Multi Greek | 11 |
| J | Estimated Move | 15 |
| K | Premarket | 12 |
| L | Economic Calendar (embedded `EconCalendarPanel`) | 28 |
| M | Confidence Score | 22 |
| N | Net Greeks | 17 |
| O | Initial Balance | 25 |
| P | Ticker Levels (+ the shared symbol picker) | 27 |
| Q | Strategy Builder | 24 |
| R | Poll cadences, localStorage keys, dead code, what v3 already has | 13 |
| S | **Colour parity** — the v2↔v3 token audit, tokens to add, every wash | 60 |

**Column meanings**

- **Source** — the endpoint AND the field underneath it, or the exact
  client-side formula where the value is derived. `/api/levels?ticker=SPX → up`
  is a source; "the EM band" is not.
- **Format & units** — decimal places, sign prefix, `%`, `pts`, `B`/`M`/`K`,
  locale. What the code actually does, not what looks sensible.
- **Threshold / colour rule** — every condition that changes a colour, a weight
  or the wording. This is where detail goes missing when a page is described
  rather than transcribed.
- **Empty / loading** — literally what renders when the value is not there.

**v2 colour constants** (`components/shared/homeTheme.ts`, `HOME_THEME as T`).
Named here because every colour rule below refers to them, and because three of
them are not the colour their name suggests:

| Token | Hex | Note |
|---|---|---|
| `T.bg` | `#05060A` | |
| `T.panel` | `#0D1119` | used as the spot-label chip background in the ladder |
| `T.cyan` | `#219EBC` | every card title |
| `T.purple` | `#126783` | a dark teal, not a violet. Used once — the second radial in `homeShellStyle`'s page-background glow |
| `T.orange` | `#FB8501` | replay, BETA/NOT-FINANCIAL-ADVICE tags, warnings |
| `T.green` | `#8ECAE6` | **a light blue**. Used ONCE on this page — the "Confirmation triggers" section title |
| `T.red` | `#EF4444` | |
| `T.muted` | `#FFFFFF` | identical to `T.text`; "muted" is achieved with `opacity`, not hue |
| `T.text` | `#FFFFFF` | |
| `T.border` | `rgba(255,255,255,0.10)` | |
| `T.panelBg` | `rgba(13,17,25,0.45)` | the card fill |
| `T.panelBgStrong` | `rgba(13,17,25,0.72)` | the econ-calendar header, the replay date `<select>` |

**`POS_GREEN = "#22C55E"` is page-local and deliberate.** `T.green` is a light
blue, so this page declares a real green for pos/neg signal. Every "up" colour
below is `POS_GREEN`, never `T.green`. Port it as a token, not a literal.

**`LEVEL_COLORS`** (`homeTheme.ts`) — the three wall badge colours, shared with
Multi Greek so the two surfaces cannot drift:

| Key | Hex | Meaning |
|---|---|---|
| `cb` | `#ffd600` | Core Bullseye — highest \|GEX\| strike |
| `cw` | `#29b6f6` | Call Wall — highest +GEX strike |
| `pw` | `#ff4757` | Put Wall — most −GEX strike |

**⚠ COLOUR PARITY IS A REQUIREMENT ON THIS PORT.** Brandon, 2026-08-30:
*"keep colors the same as the v2 version."* Every hex in the tables above and
below is the SPEC — the v3 page must render these values, not v3's dark-slate
palette.

This is not automatic, and it is not what `theme.ts` currently does. v3's `T.*`
maps v2's NAMES onto v3's VALUES, so six of the tokens this page leans on
resolve to a different colour. **Do not reach for `T.cyan` / `T.orange` /
`T.red` / `T.green` / `T.border` / `T.panelBg` on this page.** Part S is the
full audit and the token list that has to exist before any of Parts A–R can be
built.

Scope, decided 2026-08-30: **this page only.** The v2 values get their own
tokens; every other v3 page keeps the dark-slate palette. Nothing in Part S
touches an existing token's value.

The rule that still applies unchanged: **no colour literal anywhere outside
`src/design/tokens.css`.** Colour parity is satisfied by giving the v2 values
their own tokens — exactly as `--color-candle-up` / `--color-candle-down`
already do (*"carried across from v2 VERBATIM because 'the exact same candle
colour' was the requirement"*) — not by typing `#219EBC` into a component.

**Shared button styles** (`homeTheme.ts`, referenced by name throughout):

- `homeButtonStyle` = `padding 5px 10px · radius 6 · 1px rgba(33,158,188,.25) · bg linear-gradient(180deg,rgba(33,158,188,.12),rgba(33,158,188,.04)) · T.cyan · 10px/700 · letterSpacing .08em · uppercase · pointer`
- `homeSecondaryButtonStyle` = same metrics, `1px T.border · bg rgba(255,255,255,0.04) · T.text`

---

# Part A — Page frame, grid, card surface

Source: `components/pages/Analytics.tsx` lines 3414–3445, plus `app/globals.css`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Page shell | `<PageShell>` — no `maxWidth`, no `align` | `homeShellStyle` (100%×100%, `T.bg` + `shellGlow` radial pair, `var(--font-inter)`, flex column) wrapping `<main>` with `homeContentStyle` (`flex:1`, `padding clamp(14px,2vw,24px)`, `gap clamp(16px,2vw,32px)`, `overflow:auto`, `alignItems:stretch`) | none | n/a |
| Card grid | `<div className="analytics-grid">` | `display:grid; gap:14; gridTemplateColumns: repeat(4, 1fr); alignItems:start` | none | n/a |
| Card order (top→bottom, left→right) | JSX order | 1 Ticker Lookup (spans `1 / -1`) · 2 Multi Greek · 3 Estimated Move · 4 Premarket · 5 Econ Calendar · 6 Confidence Score · 7 Net Greeks · 8 Initial Balance · 9 Ticker Levels · 10 Strategy Builder (spans `1 / -1`) | none | n/a |
| Small-card height | Every card except the two full-width ones | `height: 480` fixed, `overflowY: auto` — a card that overflows scrolls INSIDE itself, the grid row never grows | none | n/a |
| Card surface | `<Card variant="budget" padding={16}>` → `classicCardAccentStyle` | `background T.panelBg · backdrop-filter blur(16px) · radius 18 · 1px T.border · boxShadow 0 18px 40px rgba(0,0,0,0.22)` + class `card-hover` | The `accent` prop is DEAD in v2 (`PageCard.tsx` ignores it). This page never passes one | n/a |
| Card `padding` exceptions | Econ Calendar `padding={0}`, `overflow:hidden` (the panel paints its own chrome edge-to-edge) | — | none | n/a |
| Full-width cards | Ticker Lookup + Strategy Builder | `gridColumn: "1 / -1"`, no fixed height, `gap: 12` | Ticker Lookup drops the span when `embedded` (used by Multi Greek's 🔍 overlay, not by this page) | n/a |
| Embed mode — detection | `useEffect` reading `new URLSearchParams(location.search).get("embed") === "1"` | Boolean state, default `false` | Because it is set in an effect, the FIRST paint is always the 4-column layout, then it swaps to 1 column | n/a |
| Embed mode — grid | `.analytics-embed` class added alongside `.analytics-grid`; also `gridTemplateColumns: "1fr"` inline | `grid-template-columns: 1fr !important; align-items: start !important` | — | n/a |
| Embed mode — card fill | `.analytics-embed > *` in `globals.css` | `background: radial-gradient(circle at 50% 0%, rgba(126,211,252,0.10) 0%, transparent 60%), #0d1119 !important; backdrop-filter: none !important` | Exists because 45%-translucent cards stacked in the narrow GEX-dock column smear through each other | n/a |
| Responsive — ≤899px, the page rule | `main .analytics-grid` inside `@media (max-width: 899px)` | `grid-template-columns: 1fr !important; align-items: start !important` | Declared last so it beats the generic 4-col→2-col collapse | n/a |
| Responsive — `repeat(3` collapse | Global rule, `@media (max-width:899px)` | `grid-template-columns: 1fr !important` | Hits the Estimated Move 3-stat row, the Ticker Levels 3-stat row and the Strategy idea's Entry/Stop/Target row | n/a |
| Responsive — `1fr 1fr` collapse | Global rule | `grid-template-columns: 1fr !important` | Hits `.tl-split` (the two ladder panes stack), the Multi Greek 2×2 grid, the Net Greeks 2×2 grid and the Strategy two-column body | n/a |
| Responsive — `auto-fit` re-exempt | Global rule | `repeat(auto-fit, minmax(min(100%, 150px), 1fr)) !important` | Hits `TL_CHIP_ROW` — the three level chips reflow rather than collapse | n/a |
| Responsive — `min-width` release | Global rule | `min-width: 0 !important` for inline `min-width: 300/320/380/400/420/480px` | Nothing on this page declares those; recorded so the v3 port does not reintroduce one | n/a |
| Responsive — 1100 / 950px | `globals.css` lines 308–315 | Generic dashboard steps | Do not apply to `.analytics-grid` (no rule targets it there) — the page goes 4 → 2 (generic) → 1 (@899) | n/a |
| Page-level scroll | `<main>` | The PAGE scrolls; each 480px card scrolls internally | none | n/a |
| Card hover lift | `.card-hover` from `globals.css` | Standard dashboard lift | Applies to every card on this page (`variant="budget"` is not `dissolve`) | n/a |

---

# Part B — Shared primitives and helpers

Source: `Analytics.tsx` lines 20–175. Everything below is referenced by name in
Parts C–Q. **Transcribe these first** — every card is composed of them, and a
drifted `fmtBig` is a drifted number on nine cards at once.

| Name | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| `Label` | Component | `<span>` `17px / 700 / letterSpacing .08em / uppercase` | `color: T.muted` with `opacity: .7` | n/a |
| `Value` | Component | `<span>` `font-family: var(--font-mono) / weight 800`, `size` prop **default 21** | `color` prop, **default `T.text`** | n/a |
| `Stat` | Component | `flex column, gap 3` → `Label` over `Value` | passes `color` + `size` straight through | n/a |
| `Row` | Component | `flex; align:center; justify:space-between; gap:8` + optional style override | none | n/a |
| `PillSelect` | Component | `flex; gap:4` of `<button>` | Active option → `homeButtonStyle`; the rest → `homeSecondaryButtonStyle` | n/a |
| `divider` | Const style | `height:1; background:T.border; margin:"10px 0"` | none | n/a |
| `POS_GREEN` | Const | `#22C55E` | The page's "up" colour — NOT `T.green` | n/a |
| `signColor(n)` | Function | — | `n > 0` → `POS_GREEN`; `n < 0` → `T.red`; `n === 0` or NaN-ish → `T.muted` | n/a |
| `useLiveData(url, refreshMs = 120_000)` | Hook | `fetch(url, {cache:"no-store"})` → JSON | Error string is `json?.error \|\| "HTTP {status}"`, stored via `String(e)` so it renders with the `Error: ` prefix. Refetches on `setInterval(refreshMs)` | Returns `{data, loading, error, lastUpdated, reload}` |
| `useLiveData` — null url | Hook | — | **`load()` returns BEFORE the `finally`, so `loading` stays `true` forever when `url` is null.** Every caller that passes `null` must gate on something else (Net Greeks uses `chainLoading`; Strategy Builder gates on `active` first). Port this exactly or those cards spin | `loading: true`, `data: null` |
| `UpdatedStamp` | Component | `updated {h:mm:ss AM/PM} ET` — `Intl.DateTimeFormat("en-US", {timeZone:"America/New_York", hour:"numeric", minute:"2-digit", second:"2-digit", hour12:true})` + `" ET"` | `10px mono · T.muted · opacity .55 · marginTop:auto · paddingTop:6 · textAlign:right` — `marginTop:auto` pins it to the card's bottom | `at == null` → `updated —` |
| `etDateISO()` | Function | `Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York"})` → `YYYY-MM-DD` | The ET session date every `?date=` param uses | n/a |
| `fmtBig(n)` | Function | sign `+`/`-` then: `≥1e9` → `(a/1e9).toFixed(1)` + `B`; `≥1e6` → `.toFixed(0)` + `M`; `≥1e3` → `.toFixed(0)` + `K`; else `.toFixed(0)` | none (the caller colours it) | `null` / non-finite → `—` (no sign) |
| `numOr(v)` | Function | `Number(String(v).replace(/,/g, ""))` | Returns `null` for `null`, `""` or non-finite — so a stored `"6,112.5"` parses | `null` |
| `useGrace(ms = 4000)` | Hook | `true` for the first 4s after mount, then `false` | Used ONLY by the IB card, to tell "still loading" from "loaded but empty" on a feed with no ready flag | n/a |
| `Placeholder` | Component | `minHeight` prop **default 70** · `radius 10` · `1px dashed T.border` · `T.muted` · `12px italic` · centered · `padding 8px 12px` · `opacity .8` | none | This IS the empty state |
| `CardState` | Component | Wraps `Placeholder` | `loading` → `Loading…`; `error` → `⚠ {error}` in `T.red`; otherwise the `empty` node (**default `"No data yet"`** — every card on this page overrides it) | — |
| `nowEtClock()` | Function | `{dow (0=Sun), mins since ET midnight, dateISO}` via `Intl` `weekday:"short"` + `hour/minute` `hour12:false` | Used by `nextPremarketDate()` | n/a |
| `nowEtMinutesSec()` | Function | `{min, sec}` in ET, `hour` taken `% 24` | Used by the IB countdown and the Confidence checkpoints | n/a |
| `isStrategyWindow()` | Function | `true` when ET weekday and `09:00 ≤ now < 16:00` | Gates the Strategy Builder's fetch entirely | n/a |
| `nextPremarketDate()` | Function | ET `YYYY-MM-DD`. Rolls forward one day when `mins ≥ 16*60` or the day is Sat/Sun, then skips weekends (max 7 iterations) | Built from `new Date("{today}T12:00:00-05:00")` — **hardcoded −05:00, so it is off by an hour under EDT**; the noon anchor absorbs it. Transcribe as-is; do not "fix" it in the port without a separate decision | n/a |

---

# Part C — Ticker Lookup · controls, quick row, replay bar

Source: `Analytics.tsx` lines 2366–2972. The card is exported as
`TickerLookupCard({ initialSymbol = "SPX", embedded = false, initialReplay = false })`
so other surfaces mount the same component; this page mounts it bare.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card frame | `<Card variant="budget" padding={16}>` | `gridColumn: "1 / -1"` (dropped when `embedded`), `flex column`, `gap 12`, no fixed height | none | n/a |
| Controls row | `<Row style={{flexWrap:"wrap", justifyContent:"flex-end", rowGap:8}}>` | Right-aligned cluster | none | n/a |
| Ticker menu | `TickerLevelsPicker` (the SAME component the Ticker Levels card uses — see Part P), wrapped in `minWidth: 132` | Trigger shows `sym` uppercase | Options = `[...new Set([...scannerTickers, ...TL_QUICK, ...recent, sym])]`; `custom` = `recent` (so recents carry an `×`) | n/a |
| ↻ refresh button | `useRefreshButton(async () => Promise.all([reloadChain(), reloadExps(), loadBoard()]))` | Labels: idle `↻ Now` · `↻ Refreshing…` · `✓ Refreshed` · `✗ Failed` | `homeRefreshButtonStyle(state)` — idle cyan on `rgba(33,158,188,.08)`, success `#1FD98A` + `0 0 12px` glow, error `T.red` + glow, refreshing `#888` at `opacity .6` and `cursor:not-allowed`. Locked while running; reverts to idle after **1800 ms** | n/a |
| ↻ tooltip | Static `title` | `"Re-fetch the chain, the listing and the whole-board sweep"` | none | n/a |
| ⏱ Replay toggle | `setReplayOn(v => !v)` | Label `⏱ Replay`, `fontWeight: 800` | ON → `homeButtonStyle` overridden to `background T.orange · borderColor T.orange · color #0b0f1a`. OFF → `homeSecondaryButtonStyle` with `color: T.orange` | n/a |
| ⏱ tooltip | Static `title` | `"Replay — scrub both ladders back through a recorded session (recorded walls only, ~5 trading days)"` | none | n/a |
| CB Edge logo | `<img src="/cb-edge-logo.png" crossOrigin="anonymous">` | `height 28 · width auto · opacity .95 · marginLeft 2 · flexShrink 0` | `crossOrigin` is required so html2canvas snapshots bake it in instead of tainting the canvas | n/a |
| Quick row | `[...TL_QUICK, ...recent.filter(r => !TL_QUICK.includes(r))]` | `flex; gap 6; wrap` of buttons | `TL_QUICK = ["SPX","SPY","QQQ","NVDA","TSLA"]`. Active (`s === sym`) → `homeButtonStyle`, else `homeSecondaryButtonStyle` | Quick row always renders (recents may be empty) |
| Replay bar — container | Rendered only while `replayOn` | `flex; align:center; gap 8; wrap; padding 6px 10px; radius 10; fontSize 11; color T.text` | `background rgba(251,133,1,0.07)`, `border 1px solid {T.orange}55` | n/a |
| Replay bar — "Replay" | Static | `fontWeight 900 · letterSpacing .1em · uppercase` | `T.orange`, `flexShrink: 0` | n/a |
| Replay — session `<select>` | `/proxy/strike-growth/replay-meta?symbol={sym}` → `dates[]`, each `String(d).slice(0,10)` | `YYYY-MM-DD` options, `11px mono / 800` | `background rgba(13,17,25,0.72)`, `color T.cyan`, `1px T.border`, `radius 6`. Selection defaults to the current value if still listed, else `dates[0]`. Changing it pauses playback | No dates → a single disabled-looking `<option value="">—</option>` and `select` is `disabled`; `replayErr` set to `No recorded sessions for {sym}.` |
| Replay — ◀ prev | `setReplayIdx(i => max(0, i-1))`, pauses playback | `tlReplayBtn(false)` — `height 24 · padding 0 8px · radius 6 · 11px/800` | Inactive style: `color T.text`, `bg rgba(255,255,255,0.05)`, `1px T.border`. `disabled` and `opacity .4` at index 0 | title `"Previous minute"` |
| Replay — ▶ / ❚❚ play | Toggles `replayPlaying`; **if already at the last step it first rewinds to index 0** | Label `❚❚` while playing, `▶` otherwise; `padding 0 12px` | Active → `tlReplayBtn(true)`: `color #0b0f1a`, `background T.orange`, `border T.orange`. `disabled` + `opacity .4` when `timeline.length < 2` | title `"Play / pause"` |
| Replay — ▶ next | `setReplayIdx(i => min(len-1, i+1))`, pauses | `tlReplayBtn(false)` | `disabled` + `opacity .4` at the last index | title `"Next minute"` |
| Replay — scrubber | `<input type="range" min=0 max=len-1>` | `flex 1 · minWidth 180 · height 3` | `accentColor: T.orange`. `disabled` when `timeline.length < 2`. Dragging pauses playback | — |
| Replay — "Speed" label | Static | `10px / 700`, `opacity .6` | none | n/a |
| Replay — speed buttons | `TL_REPLAY_SPEEDS = [0.5, 1, 2, 4, 8]` | Rendered `0.5×` … `8×`; `height 22 · padding 0 7px · fontSize 10` | Selected → orange `tlReplayBtn(true)`. Step interval = `TL_REPLAY_BASE_MS (700) / speed` | n/a |
| Replay — separator | Static `\|` | — | `color: T.border` | n/a |
| Replay — clock | `replayTimeline[replayIdx]` through `fmtTlReplayClock` | `HH:MM ET` — `toLocaleTimeString("en-US", {timeZone:"America/New_York", hour:"2-digit", minute:"2-digit", hour12:false})` | `font-mono`, `fontWeight 900` | `--:--` when there is no timeline |
| Replay — step counter | `{idx+1} / {len}` | Plain | `opacity .55` | Empty string when the timeline is empty |
| Replay — loading flag | `replayLoading` | `loading…` | `T.cyan`, `fontWeight 700` | shown only while loading |
| Replay — error flag | `replayErr` | The raw message | `T.red`, `fontWeight 700` | Messages: `No recorded sessions for {sym}.` · `Could not load recorded sessions.` · `No recorded frames for {sym} on {date}.` · `Could not load frames.` · or the route's own `error` string |
| Replay — caveat line | Rendered when `!loading && !err && timeline.length > 0` | `· recorded walls only · sweeps held to the minute · ± Move, ATM IV and Δ 1D off while rewound` | `opacity .55` | — |
| Replay — frames fetch | `/proxy/strike-growth/frames-by-expiry?symbol={sym}&date={replayDate}` — ONE request per (symbol, session) | Payload is positional: `expiries[]` index table + `frames[].cells = [expiryIdx, strike, net, vol]` | Frames sorted ascending by `ts`; a frame is kept only when `new Date(ts).getTime()` is finite | `!j.ok` or no frames → session cleared + error above |
| Replay — landing position | After a successful load | `setReplayIdx(timeline.length - 1)` — lands on the LAST sweep | Coming off a live card, the newest snapshot is the nearest thing to what was on screen | — |
| Replay — timeline | `tlTimelineOf(frames)` | Sweep timestamps snapped DOWN to the minute (`floor(ms/60000)*60000`), deduped, ascending | The recorder sweeps on 2-min (hot) / 5-min (full) lanes, so raw stamps are uneven | `[]` |
| Replay — frame selection | `replayFrame` | The last frame with `f.t <= replayClock + 59_999` — **step-hold, never a future reading** | — | `null` |
| Replay — playback end | Interval effect | Stops at the last step (`setReplayPlaying(false)`), does NOT loop | A session that silently restarts reads as the tape jumping backwards | — |
| Replay — reset triggers | `useEffect` on `[replayOn, sym]` | Clears `replaySession`, `replayIdx = 0`, `replayPlaying = false`, `replayErr = ""` | Prevents one symbol's frames painting under another's label | — |
| Replay — board sweep pause | `useEffect` on `[loadBoard, replayOn]` | `if (replayOn) return;` — the whole-board sweep does not run while rewound | The cheap chain/listing polls stay on so leaving replay does not blank the card | — |

---

# Part D — Ticker Lookup · identity line, split frame, left pane

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card-level gate | `gateLoading` / `gateError` / `!hasAny` | Renders `CardState` INSTEAD of everything below | Live: `loading` / `error ?? data?.error`. Rewound: `replayLoading` / `replayErr` — the live chain's state is ignored while rewound | Empty text: live `No live option chain for {sym}.` · rewound `No recorded ladder for {sym}{ on {date}}.` |
| Identity line — frame | `<div>` under the replay bar, directly above the ladders | `flex; align:center; gap 10; wrap; paddingBottom 10; borderBottom 1px T.border` | Positioned here ON PURPOSE: it is the line a screen capture of the ladders has to contain | n/a |
| "Ticker Lookup" | Static | `17px / 800 / letterSpacing .08em / uppercase` | `T.cyan` | always |
| `${sym}` | State | `22px / 800`, literal `$` prefix | `T.text` | always |
| "GEX levels" | Static | `12px mono` | `T.text` at `opacity .6` | always |
| Spot | `viewSpot` — live `data.data.underlyingPrice`, rewound `frame.spot` (only when `> 0`) | `Value size 22`, `toLocaleString("en-US", {maximumFractionDigits: 2})` | `T.text` | `—` |
| Gamma regime pill | `rightLevels.net >= 0` | `Positive gamma` / `Negative gamma` — `11px / 800 / .1em / uppercase`, `radius 999`, `padding 3px 10px` | Colour AND border are `POS_GREEN` when positive, `T.red` when negative. **Driven by the RIGHT pane (whole board), not the left** | always (net defaults to 0 → "Positive gamma") |
| Meta string | `[sym, tlExpiryChip(viewActiveExpiry, base), replayOn ? replayDate : today, replayOn ? clock : null].filter(Boolean).join(" · ")` | `11px mono / 700 / .06em / uppercase`, `opacity .78` | `base` for the DTE count is `replayDate` while rewound, `today` otherwise — labelling off today would mark the wrong pill 0DTE | Segments drop out individually |
| Split frame | `<div className="tl-split">` | `grid; gridTemplateColumns: 1fr 1fr; gridTemplateRows: minmax(0, 1fr); gap 14; alignItems: stretch; height: clamp(838px, 86vh, 1500px)` | `838px` is `TL_PANE_CHROME_H (272) + 20 + (2*10+1) * TL_ROW_H (26)` — tall enough for ten rungs a side plus the spot row with no scroll. `minmax(0,1fr)` + `minHeight:0` on each pane is what hands the overflow to the ladder scrollers instead of letting the panes paint over "The read" | n/a |
| Left pane frame | — | `1px T.border · radius 14 · padding 12 · flex column · gap 10 · minWidth 0 · minHeight 0` | none | n/a |
| Left pane title | Static | `By expiration` — `12px / 800 / .1em / uppercase` | `T.cyan` | always |
| Left pane Net GEX | `Stat label="Net GEX"`, `fmtBig(leftLevels.net)`, `size 16` | e.g. `+1.2B` | `POS_GREEN` when `>= 0`, else `T.red` | `+0` when the ladder is empty |
| Expiry pills | `viewExpiries` — live `groups.map(g => g["expiration-date"])`, rewound `replaySession.expiries` | `tlExpiryChip(exp, base)` → `"Aug 8 · 0DTE"` when `dte === 0`, `"Sep 5 · 6DTE"` when `dte > 0`, bare `"Aug 1"` when past. Month/day via `Intl` in **UTC** | Active (`viewActiveExpiry === e`) → `homeButtonStyle`, else `homeSecondaryButtonStyle`. An unparsable date renders the raw string | No pills when the chain has no groups |
| Active expiry fallback | `expiry` state | Falls back to `expiries[0]` when the picked expiry is not on this symbol's board | Switching ticker sets `expiry = null` | — |
| ± Move / ATM IV caption | `tlAtm(atmGroup, spot)` | `± Move ±{move.toFixed(2)} · ATM IV {(iv*100).toFixed(1)}%` — `11px mono`, `opacity .6` | Both read `—` while rewound (priced off live marks; nothing in the recording reconstructs them) | `± Move — · ATM IV —` |
| Left ladder scroller | `<div style={{flex:1, minHeight:0, overflowY:"auto", overflowX:"hidden"}}>` | The ONLY thing that scrolls in the pane | `minHeight: 0` is what lets it shrink instead of pushing the chips out the bottom | — |
| Left ladder empty | `leftLadder.length === 0` | `Placeholder` | — | Live `No populated strikes on this expiry.` · rewound `Nothing recorded on this expiry in this session.` |

---

# Part E — Ticker Lookup · right pane

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Right pane frame | — | Identical to the left pane | none | n/a |
| Right pane title | Static | `All expirations · ex-0DTE` — `12px / 800 / .1em / uppercase` | `T.cyan` | always |
| Right pane Net GEX | `fmtBig(rightLevels.net)`, `size 16` | — | `POS_GREEN` when `>= 0`, else `T.red` | `+0` |
| Board scope | `/api/expirations?ticker={sym}` → every `expiration-date` matching `/^\d{4}-\d{2}-\d{2}$/` and **strictly `> today`** (ISO strings compare correctly), deduped and sorted | — | Ex-0DTE ALWAYS: same-day gamma dwarfs the board and decays to nothing, so including it printed walls that were really today's pin | — |
| Board sweep | ONE `/api/chains?ticker={sym}&expiration={exp}&range=all` per expiry, **uncapped**, `TL_BOARD_CONCURRENCY = 6` workers, summed per strike through `accumulateChainGreeks` | Rows filtered to `strike > 0 && gex !== 0`, sorted ascending | A monotonic `sweepRef` token drops results from a superseded symbol. One dead expiry is counted out (`ok++` only on success), it does not blank the board | `bError` = the last error, but ONLY when `ok === 0` |
| Board result gating | `board.sym === sym ? board.rows : []` | — | A ladder from a previous ticker is worse than none | `[]` |
| Coverage caption — full board | `boardLabel` | `{n} expiration{s} · excl. 0DTE · whole board` | `T.text` at `opacity .6` | — |
| Coverage caption — partial | `boardLabel` | `{ok} expirations · excl. 0DTE · of {listed} listed — {listed-ok} chain call(s) failed` | Still `T.text` / `.6` (the pane is full-board, just incomplete) | — |
| Coverage caption — sweeping | `bLoading && !boardIsFull` | `sweeping the board…` | `T.orange` at `opacity .85` | — |
| Coverage caption — fallback | No board rows, sweep settled | `{n} front expirations · excl. 0DTE · full board unavailable` | `T.orange` at `opacity .85` — the fallback NEVER silently claims to be the whole board | — |
| Coverage caption — rewound | `replayRight.used.length` | `{n} expiration{s} · excl. 0DTE ({zeroDte}) · recorded walls only`, or `no expirations past 0DTE in this sweep · {n} recorded this session`, or `no recorded expirations past 0DTE this session` | `T.text` / `.6`. The count is the expiries that actually contributed a cell to THIS sweep, so it moves as you scrub | — |
| Fallback ladder | `frontRows` — the front expirations already in the base `/api/chains` payload, `today` dropped, summed per strike | Same filter/sort as the board | Used when `boardRows.length === 0` | — |
| Δ 1D baseline caption | `/api/eod-strike-gex-change?symbol={sym}` → `prevDate` | `Δ 1D vs close {prevDate}` — `11px mono`, `opacity .6` | Hidden entirely while `replayOn` (the Δ series is end-of-day; it has nothing to say about an intraday clock) | `Δ 1D — first snapshot recorded, baseline lands next session` when `chgOk` but no `prevDate`; `Δ 1D — no end-of-day history yet` otherwise |
| Δ payload gating | `chgResp.ok === true && chgResp.symbol.toUpperCase() === sym && rows.length > 0` | Map of `strike → chg`, keeping only finite `strike > 0` and finite `chg` | A stale Δ hung off a fresh ladder is worse than no Δ — SPY 600 / QQQ 600 overlap often enough to render as real | `null` → the Δ column is not drawn at all |
| Δ column enablement | `rightChanges = chgBaseline ? chgMap : null` | — | **The column stays OFF until a SECOND session lands.** With one snapshot every `chg` is 0 by construction, and a column of zeros reads as "the board didn't move" | column absent |
| Right ladder empty | `rightLadder.length === 0` | `CardState` (not `Placeholder`) — it carries the sweep's own loading/error | `loading` = `replayLoading` or `bLoading`; `error` = `replayErr` or `bError` | Live `No board-wide ladder yet (nothing listed past 0DTE).` · rewound `Nothing recorded past 0DTE in this session.` |

---

# Part F — Ticker Lookup · the ladder (`TlLadder`)

Source: `Analytics.tsx` lines 2096–2352. Both panes render this component.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Grid columns | `cols` | Without Δ: `132px 1fr 68px`. With Δ: `132px 1fr 68px 66px` | The strike column is sized for the WIDEST case — a 5-digit strike plus two tags — because the row must stay ONE line | — |
| Header — "Strike" | `Label` | left | — | always |
| Header — "Net GEX" | `Label` | centered | — | always |
| Header — "Value" | `Label` | right | — | always |
| Header — "Δ 1D" | `Label` | right | Rendered only when `changes` is passed (right pane, live, with a baseline) | — |
| Row height | `TL_ROW_H = 26` | 18px content + 2px padding a side + 1px border a side + 2px gap | The pane height is solved from this — do not change one without the other | — |
| Strike cell | `r.strike.toLocaleString("en-US", {maximumFractionDigits: 2})` | `13px mono`, `flexShrink: 0`, cell is `nowrap` | Spot row → `fontWeight 800` + `T.cyan`; otherwise `600` + `T.text` | — |
| Level tags | `levels.core / callWall / putWall === r.strike` | `CB` / `CW` / `PW` — `9px / 800 / .06em`, `padding 1px 4px`, `radius 3` | `background` = `LEVEL_COLORS.cb #ffd600` / `.cw #29b6f6` / `.pw #ff4757`; ink `#0b0f1a`. A strike can carry MORE THAN ONE tag; each gets its own chip | No tag |
| Level tag tooltips | Static `title` | `Core — biggest magnet` · `Call wall — ceiling` · `Put wall — floor` | — | — |
| Row chrome | — | `padding 2px 6px; radius 8` | **A level strike gets its tag and nothing else** — no tinted border, no colour wash. Spot is the ONE exception: `border 1px T.cyan` + `background rgba(33,158,188,0.08)`; every other row is `border 1px transparent` + transparent | — |
| Bar — negative | `!pos` | Right-aligned inside the left half, `width: {pct}%`, `height 14`, `borderRadius 4px 0 0 4px` | `background: T.red` | Not drawn when `unrecorded` |
| Bar — positive | `pos` (`gex >= 0`) | Left-aligned inside the right half, same metrics, `borderRadius 0 4px 4px 0` | `background: POS_GREEN` | Not drawn when `unrecorded` |
| Bar — scale | `pct = Math.max(2, Math.abs(gex)/maxAbs*100)` where `maxAbs = max |gex|` over the DRAWN window (or 1) | **Floor of 2%** so a tiny non-zero strike still shows a sliver | — |
| Centre rail | Static | `width 1 · height 18 · background T.border · flexShrink 0` | Bars are deliberately untouched by level marking — no outline, no glow | always |
| Value cell | `fmtBig(r.gex)` | `13px mono / 700`, right-aligned | `POS_GREEN` when `gex >= 0`, `T.red` when negative | `unrecorded` → `—`, `T.muted`, `opacity .5`, title `"not recorded in this sweep — the recorder stores the walls, not every strike"` |
| Δ cell | `changes.get(r.strike)` | `${chg > 0 ? "+" : chg < 0 ? "−" : ""}${fmtBig(Math.abs(chg))}` — note the **U+2212 minus**, not a hyphen. `12px mono / 700`, right, `nowrap` + ellipsis | `chg > 0` → `POS_GREEN`; `< 0` → `T.red`; exactly `0` → `T.text` | `chg == null` → `—`, `T.muted`, `opacity .5`, title `"no end-of-day snapshot for this strike"`. **Never 0** — "no reading" and "did not move" are different answers |
| Δ cell tooltip (present) | — | `{+}{fmtBig(chg)} vs prior session close` | — | — |
| Spot line | Derived DURING RENDER from measured row geometry | `position:absolute; left:0; right:0; height:0; borderTop: 1px dashed T.text; zIndex 2; pointerEvents:none` | **No CSS transition** — replay already eases spot frame by frame, and a transition on top of that leaves the line permanently trailing its own label | Not drawn when `spot == null`, `spot <= 0`, or geometry is unmeasured |
| Spot line — label | `spot.toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2})` | Pinned `right: 0; top: -13`; `9px mono / 800 / .04em`; `background T.panel`; `padding 0 4px`; `radius 3` | `color: T.text` | — |
| Spot line — position | `rowGeom.top0 + pos * rowGeom.pitch`, `pos` interpolated between the two strikes bracketing spot (`rows` runs high→low); clamped to the top/bottom rung | Pitch is measured `(last − first) / (n − 1)` via `getBoundingClientRect`, re-measured by a `ResizeObserver`, and the state is identity-stable unless it moved `> 0.5px` / `> 0.01px` | — |
| Auto-centre scroll | `useEffect([spotStrike, windowKey])` | Scrolls the pane so the ANCHOR row (falling back to the spot row) sits in the vertical middle | Measured with `getBoundingClientRect` (the scroll wrapper is `position:static`, so `offsetTop` would be measured against the wrong box). No-op when the whole ladder already fits | — |
| Row ordering | `tlWindow` | High → low, like a DOM | — | — |

---

# Part G — Ticker Lookup · chips, the read, disclaimer

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Chip row | `TL_CHIP_ROW` | `grid; repeat(auto-fit, minmax(150px, 1fr)); gap 8; alignItems: stretch; marginTop: auto; flexShrink: 0` | `marginTop:auto` pins the row to the pane's BOTTOM so the left and right panes' chips line up regardless of ladder length | always (chips render with `—`) |
| Chip — "Core (CB)" | `levels.core` | See chip anatomy below | `color = LEVEL_COLORS.cb` (`#ffd600`), note `biggest magnet` | value `—` |
| Chip — "Call wall" | `levels.callWall` | — | `LEVEL_COLORS.cw` (`#29b6f6`), note `ceiling` | value `—` |
| Chip — "Put wall" | `levels.putWall` | — | `LEVEL_COLORS.pw` (`#ff4757`), note `floor` | value `—` |
| Chip anatomy — frame | `TlLevelChip` | `1px T.border · radius 12 · padding 8px 10px · flex column · gap 2 · minHeight 106 · boxSizing border-box`; every row is `nowrap` + `overflow:hidden` + `ellipsis` so all chips are the same height | `TL_CHIP_MIN_H = 106` | — |
| Chip anatomy — name | prop | `12px / 800 / .1em / uppercase`, `lineHeight 16px`, `title` = the name | the chip's `color` | — |
| Chip anatomy — value | prop | `Value size 26`, `toLocaleString("en-US", {maximumFractionDigits: 2})`, `lineHeight 30px` | the chip's `color`; `T.muted` when null | `—` |
| Chip anatomy — distance | `value - spot` | `{abs} above` / `{abs} below`, `toLocaleString` max 2 frac; `13px mono`, `lineHeight 18px` | `T.text` (no sign colour) | `dist === 0` → `at price`; null → `—` |
| Chip anatomy — note | prop | `13px`, `lineHeight 18px`, `title` = the note | `T.text` | — |
| "The read" — frame | Below the split | `1px T.border · radius 10 · padding 10px 12px · background rgba(255,255,255,0.03) · 14px · lineHeight 1.6 · color T.text` | Driven entirely by the RIGHT pane's levels (the whole board is the regime that governs hedging) | Renders whenever the card is past its gate |
| "The read: " | Static | `fontWeight 800` | `T.cyan` | — |
| "The read" — regime sentence | `positiveGamma` | Positive: `"Net positive gamma across the board — dealers sell rallies and buy dips, so price tends to pin and mean-revert. "` · Negative: `"Net negative gamma across the board — dealers chase in both directions, so moves extend and volatility feeds itself. "` | — | one always renders |
| "The read" — Core clause | `rightLevels.core` | `Core magnet {n.toLocaleString()}. ` | — | clause omitted when null |
| "The read" — Call wall clause | `rightLevels.callWall` | `Call wall {n.toLocaleString()}. ` | — | omitted when null |
| "The read" — Put wall clause | `rightLevels.putWall` | `Put wall {n.toLocaleString()}. ` | — | omitted when null |
| "The read" — Flip clause | `rightLevels.flip` | `Gamma flip {n.toLocaleString("en-US", {maximumFractionDigits: 2})} — pinning above, trending below.` | The flip is NOT shown as a chip — only here | omitted when null |
| Disclaimer line | Static, varies by mode | Live: `OI+Vol basis · left pane shares Multi Greek's formula · right pane is the server full-board sweep · educational only, not investment advice`. Rewound: `OI+Vol basis · recorded strike_growth sweeps{ for {date}} · walls only, not the whole ladder · educational only, not investment advice` | `11px mono`, `T.text` at `opacity .45` | always |
| Updated stamp | `UpdatedStamp at={lastUpdated}` | Part B format | **Only rendered when `!replayOn`** — a live fetch stamp says nothing about a rewound card | — |

---

# Part H — Ticker Lookup · the maths

Not rendered directly, but every number above is its output. **Transcribe these
1:1.** Re-deriving them from the description is exactly where detail is lost.

| Rule | Source | Definition |
|---|---|---|
| `accumulateChainGreeks(payload, expiry = null)` | lines 192–225 | Walks `data.items` (filtered to one `expiration-date` when `expiry` is given), returns `Map<strike, {gex,dex,chex,vex}>` |
| — underlying | — | `S = numOr(data.underlyingPrice) ?? 0` |
| — contract count | — | `cnt(leg) = parseInt(leg["open-interest"] ?? leg.openInterest ?? 0) + parseInt(leg.volume ?? 0)`, each `\|\| 0` |
| — strike skip | — | Skip when `strike-price` parses falsy, and skip when `callCount === 0 && putCount === 0` |
| — GEX | — | `(γ_call·cc − γ_put·pc) · S² · 0.01 · 100` |
| — DEX | — | `(\|δ_call\|·cc − \|δ_put\|·pc) · S · 100` |
| — CHEX | — | `(−θ_call·cc + θ_put·pc) · S · 100` |
| — VEX | — | `(ν_call·cc − ν_put·pc) · S · 100` |
| — missing legs | — | Any absent/blank/non-finite greek reads as `0`, never NaN |
| `computeNetGreeks(payload)` | lines 229–235 | Sums every strike's four totals; returns `null` when the map is empty. Output is RAW dollars (`fmtBig`-ready) |
| `computePeakGreeks(payload)` | lines 237–255 | Per greek, the strike with the largest **absolute** value; returns `{strike, value}` or `null` |
| `tlLevelsFrom(rows, spot)` — callWall | lines 1858–1924 | The highest `+GEX` strike. Also tracks the SECOND-highest |
| `tlLevelsFrom` — putWall | — | The most-negative `GEX` strike. Also tracks the second-most-negative |
| `tlLevelsFrom` — core | — | The largest `\|GEX\|` strike on the board |
| `tlLevelsFrom` — CB collision rule | — | Core IS whichever wall sits on its own side of zero, so it collides with exactly one. When `core.strike === callWall.strike`, the call wall steps DOWN to `callWall2`; same for the put wall. Only one can ever collide (core has one sign) |
| `tlLevelsFrom` — flip | — | Port of `server-v2/computation/gex-calculator.js findGexFlip()`. Cumulate from the LOWEST strike up; take **only** the first `prevCum < 0 && cum >= 0` crossing and stop. Interpolate: `prevK + (strike − prevK) · (−prevCum / (cum − prevCum))`, or `strike` when the range is 0. **Requires `spot != null && spot > 0`** — no spot, no flip. A later positive→negative dip in the call wing is NOT a flip |
| `tlLevelsFrom` — net | — | Plain sum of every row's `gex` across the FULL ladder, not the drawn window |
| `tlAtm(group, spot)` | lines 1928–1945 | Nearest strike to spot in that expiry group. `move = call.mark + put.mark` when either is `> 0`, else `null`. `iv` = mean of the call/put `implied-volatility` values that are `> 0`, else `null` |
| `tlWindow(rows, anchor)` | lines 1951–1959 | Slice `±TL_LADDER_SIDE (20)` rungs by INDEX around the nearest row to the anchor (so a $2.50-wide and a $5-wide chain both give 20 a side), then sort high→low |
| `useTlAnchor(rows, spot, resetKey)` | lines 1998–2012 | The anchor strike only advances once spot has walked `TL_ANCHOR_SLACK = 5` rungs away from it. `resetKey` = `` `${sym}\|L\|${expiry}\|${replayOn?"r":"l"}` `` — a new symbol, expiry or live↔rewound crossing forces a fresh anchor. The ref is settled during render on purpose |
| `tlReplayRows(frame, sessionStrikes, expiries, basis="net")` | lines 1780–1807 | Sums the frame's cells for the given expiries over the SESSION's fixed strike axis. Returns `rows`, `missing` (strikes this sweep did not record → drawn as `—`), and `used` (the expiries that actually contributed) |
| `tlSessionAxis(frames, expiries)` | lines 1817–1829 | Every strike recorded in ANY frame under those expiries, ascending — the fixed axis, memoised on the SESSION so the ladder does not gain and lose rungs every step |

---

# Part I — Multi Greek

Source: lines 257–292. Feed: `/api/chains?ticker={tk}&range=all`, **60 s**.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card title | Static | `Multi Greek` — `17px / 800 / .08em / uppercase` | `T.cyan` | always |
| Header right caption | Static | `peak strike` — `12px mono` | `T.muted` at `opacity .6` | always |
| Ticker pills | `PillSelect` | `SPX` · `QQQ` · `SPY`, default `SPX` | active `homeButtonStyle` | always |
| Tile grid | — | `grid; 1fr 1fr; gap 10` — four tiles in a 2×2 | — | — |
| Tile order | `order` const | `GEX`, `DEX`, `CHEX`, `VEX` | — | — |
| Tile frame | — | `1px T.border · radius 10 · padding 10 · flex column · gap 3` | — | — |
| Tile label | `Label` | `{K} · peak strike` (e.g. `GEX · peak strike`) | — | always |
| Tile strike | `computePeakGreeks(data)[k].strike` | `Value size 20`, `toLocaleString()` | `signColor(peak.value)` — the STRIKE is coloured by the sign of its VALUE | `—` in `T.muted` |
| Tile value | `peak.value` | `fmtBig` — `17px mono`, `opacity .7` | `signColor(peak.value)` | `—` in `T.muted` |
| Card empty gate | `loading \|\| error \|\| !hasAny` where `hasAny` = any of the four peaks is non-null | `CardState` | — | `No live chain for {tk}.` |
| Updated stamp | `UpdatedStamp at={lastUpdated}` | Part B | — | `updated —` |

---

# Part J — Estimated Move

Source: lines 294–390. Feeds: `/api/levels?ticker={tk}` (**120 s**) and
`/api/tt-quotes?symbols={quoteSymbol}` (**15 s**).

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card title | Static | `Estimated Move` | `T.cyan`, `17px / 800 / .08em / uppercase` | always |
| Header caption | Static | `weekly` — `12px mono`, `opacity .6` | `T.muted` | always |
| "More →" link | `next/link href="/em"` | `10px / 800 / .08em / uppercase`, `1px T.border`, `radius 6`, `padding 3px 9px`, `nowrap`, no underline | `T.cyan` | always |
| Ticker pills | `EM_TICKERS` | `ESU` · `NQU` · `SPX` · `SPY` · `QQQ`, default `SPX` | — | always |
| Quote symbol map | `EM_QUOTE_SYMBOL` | `ESU → /ESU26` · `NQU → /NQU26` · `SPX → SPX` · `SPY → SPY` · `QQQ → QQQ`, URL-encoded | Futures quote under the front-contract symbol; the proxy resolves it | — |
| EM Up | `/api/levels → up` via `numOr` | `Stat`, `toLocaleString()`, `size 18` | `POS_GREEN` | card is gated off |
| Spot / Close / Mid | `item.last ?? item["last-price"] ?? item.mark ?? item["mark-price"] ?? item.close`, else `levels.close`, else `(up+down)/2` | `toLocaleString(undefined, {maximumFractionDigits: 2})`, `size 18` | **The LABEL changes**: `Spot` when a live quote `> 0` exists; `Close` when falling back to `levels.close > 0`; `Mid` when falling back to the band midpoint. Value colour is the default `T.text` | — |
| Spot rejection | — | A non-positive spot (0 / blank quote) is rejected and falls back to the midpoint | — | — |
| EM Down | `/api/levels → down` | `toLocaleString()`, `size 18` | `T.red` | — |
| Divider | `divider` | — | — | — |
| Distance label | Computed | `Distance to nearer band ({Up\|Down})` + `" · crossed"` when the nearer gap is negative | `Label` styling | — |
| Distance value | `nearerUp ? up - spot : spot - down` | `{-}{abs.toLocaleString(undefined,{maximumFractionDigits:1})} pts` — `Value size 18`. The `-` is prefixed manually when crossed | `T.red` when `near < 0` (crossed), else `POS_GREEN` | — |
| Distance percent | `abs(near) / spot * 100` | `{x.xx}%` — `Value size 14` | `T.muted` | — |
| Card ready gate | `up != null && down != null && spot != null && spot > 0` | Card renders as soon as the EM bands exist; spot falls back | — | `CardState` with `No published EM for {tk}.` |
| Updated stamp | `lastUpdated` from the **levels** fetch (not the quote) | Part B | — | `updated —` |

---

# Part K — Premarket

Source: lines 392–496. Feeds: `/api/premarket-summary` (**5 min**) and
`/api/es-gap?date={etToday}` (**120 s**).

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card title | Static | `Premarket` | `T.cyan` | always |
| Header date | `summary.date`, or `nextPremarketDate()` when stale | `YYYY-MM-DD` — `12px mono`, `opacity .6` | `T.muted` | `""` when neither exists |
| Staleness rule | `sumDate !== nextPremarketDate()` | — | A summary whose date is not the NEXT premarket session is stale — Friday's read on a Monday pre-open, or the prior session after 16:00 ET | Stale → the empty message below |
| Bullet list | `summary.bullets[]` (written daily by `premarket-summary-generator.js`) | `<ul>` `paddingLeft 18`, `gap 7`, `flex:1`, `minHeight:0`, `overflowY:auto`, thin scrollbar `rgba(255,255,255,0.12) transparent` | — | — |
| Bullet | one string | `17px`, `lineHeight 1.45` | `T.text` | — |
| Empty message | Static | `Summary will be up at 8:00 AM Eastern.` | Shown before 08:00, after 16:00, at weekends, and whenever the stored summary is stale | — |
| Error source | `error ?? data?.error` | Both the fetch error AND the route's own `error` field | `⚠` in `T.red` | — |
| Divider before gap | `divider` | Rendered only when `gap_pts != null` | — | — |
| /ES gap line | `/api/es-gap → gap.gap_pts` | `/ES gap: {+}{gap_pts.toFixed(2)} pts` — `14px mono`, `opacity .8`, label in `T.muted` | The number is `POS_GREEN` when `gap_pts > 0`, `T.red` otherwise (**including exactly 0**, because the test is `> 0`) | Whole line hidden when `gap_pts == null` |
| /ES gap percent | `gap_pts / gap.prior_close * 100` | ` ({x.xx}%)` appended | Only when `prior_close` is truthy | omitted |
| Gap fields available but unused | `/api/es-gap → gap.open_0930`, `gap.gap_dir`, `gap.pct_filled`, `gap.filled` | — | Typed in `EsGapResp` but NOT rendered in v2. Do not add them to v3 "for parity" — parity is what is on screen | — |
| Updated stamp | `lastUpdated` from the **summary** fetch | Part B | — | `updated —` |

---

# Part L — Economic Calendar

Source: `Analytics.tsx` lines 502–508 mounting
`<EconCalendarPanel todayOnly hideToolbar />`. The panel is
`components/dashboard/EconCalendarPanel.tsx` (650 lines) and is the same
component the home page uses.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card frame | `<Card variant="budget" padding={0}>` | `height 480`, `overflow: hidden`, `flex column` | The only zero-padding card on the page | — |
| Panel frame | `homeShellStyle` overridden | `background: transparent; height: 100%; overflow: hidden` | — | — |
| Props in effect | `todayOnly = true`, `hideToolbar = true`, `controlsPortalEl = null` | `activeDays = [today]` — ONE day, not the 7-day strip | — | — |
| Header bar | `hideToolbar` branch | `padding 5px 10px`, `background T.panelBgStrong`, `blur(16px)`, `borderBottom 1px T.border`, `zIndex 30` | — | always |
| Header title | Static | `Economic Calendar` — `10px / 700 / .12em / uppercase`, white. **No 📅 emoji** (that is the toolbar-visible variant) | — | always |
| Header date | `etToday()` | `YYYY-MM-DD` — `10px` | `#3a5570` | always |
| Filter dropdown | `hideToolbar` → **NOT rendered** | — | The filter state still exists and still filters; it is simply not adjustable from this card | — |
| Refresh button | `hideToolbar` → **NOT rendered** | — | — | — |
| Quote line | `/api/calendar-quote → quote` | `hideToolbar` → **NOT rendered** (`!hideToolbar && quote`) | — | — |
| Active filters (fixed here) | `useState(new Set(["all-usd", "trump", "earnings"]))` | — | So this card shows: every `USD` event, every `President`-impact event, and earnings. Non-USD High/Medium/Low events are filtered OUT | — |
| Feed-health banner | `/api/calendar → warning` + `source` | `⚠ {warning}` — `10px`, `lineHeight 1.35` | **OWNER ONLY** (`isOwnerClaim \|\| user.id === NEXT_PUBLIC_OWNER_USER_ID`). Amber `rgba(245,158,11,.10)` / `#f59e0b` normally; red `rgba(239,68,68,.10)` / `#ef4444` when `source === "unavailable"` | Hidden for customers in every case |
| Event feed | `/api/calendar → events[]`, sorted by `date` then `time` | Rows in a scroller (`flex:1; overflowY:auto`) | — | `Loading…` white 12px; owner-only raw `⚠ {error}` in `#ef4444` 10px |
| Empty line | — | `No events this week.` | Owner with a warning sees `No events available — see the notice above.` instead | — |
| Day separator | `fullDayLabel(date, today)` | `TODAY` for today, else `WEDNESDAY, SEP 3` (uppercased `weekday:"long", month:"short", day:"numeric"`) — `12px / 800 / .1em` | `#219EBC` on today with `background rgba(33,158,188,0.06)`; `#3a5570` otherwise with `background T.panelBg` | — |
| "TODAY" badge | `date === today` | `10px / 900`, `padding 1px 5px`, `radius 2`, `.1em` | `background #219EBC`, ink `#05080d` | — |
| Event row frame | `renderEvent` | `grid 62px 1fr`, `borderTop 1px T.border`, `borderLeft 3px {impactColor}`, `minHeight 48` | `background: linear-gradient(90deg, {col}0f 0%, transparent 35%), T.bg`. Faded rows: `col = #1e2a38`, flat `T.bg`, `opacity .32`, `transition opacity .4s` | — |
| Impact colours | `IMPACT_COLOR` | `High #ef4444` · `Medium #f59e0b` · `Low #3a5570` · `Holiday #6b7280` · `President #a855f7` · anything else `#3a5570` | — | — |
| Event time | `time_formatted` | `14px mono`, in the 62px column, `borderRight 1px T.border`, `boxShadow inset -1px 0 8px {col}18` | white; `#1e2a38` when faded | falls back to `ev.time`, then `TBD` |
| Event impact + country | `impact`, `country` | `{IMPACT}` `10px / 800 / .1em / uppercase` in the impact colour, then `{country}` `12px / 600` white | — | — |
| Event title | `title` | `14px`, `lineHeight 1.3` | `fontWeight 700` when `impact === "High"`, else `500`. White; `#1e2a38` when faded | — |
| A / F / P line | `actual`, `forecast`, `previous` | `A: <strong>{actual}</strong>` · `F: {forecast}` · `P: {previous}` — `12px mono`, `gap 10` | `A` `#22c55e` · `F` `#f59e0b` · `P` `#8a9ab8`; all `#1e2a38` when faded | Each part omitted when blank; the whole line omitted when all three are blank |
| Staleness rule | `isStale(ev, now)` | — | Stale when the event's ET date is before today, or same-day and `now − eventStart > 30 min`. Stale events are rendered SECOND, faded, after a 1px `T.border` spacer | `now` re-ticks every **60 s** |
| Earnings — source | `/proxy/earnings-week?week=both` → `rows[]`, through `pickAnticipated` then `groupEarningsByDate` | Buckets `pre` / `after` / `tbd` per ET date | `pickAnticipated` is mandatory — the raw feed is ~500 names/day and would push a 400-chip block between two econ events | — |
| Earnings — placement | `renderWithDaySeparators` | `pre` before the day's first event; `after` before the first event later than `16:00` (or at the end when there is none); `tbd` last | Only when `showEarnings` (filter has `all` or `earnings`) and the row is not faded | Days with earnings but no passing econ events are seeded so they still render |
| Earnings row block | `EarnRowBlock` | Same `grid 62px 1fr`, `borderLeft 3px`, `minHeight 48` | `pre` → `PRE`/`MKT`, `after` → `AFTER`/`HRS`, both `#219EBC`; `tbd` → `TIME`/`TBD` in `#8a9ab8`. Titles: `Premarket earnings` · `After-hours earnings` · `Time unconfirmed` | — |
| Earnings chip | `ChipLogo` + symbol | `width 40`, `gap 3`, symbol `10px mono / 700` white, ellipsised; chips wrap with `gap 8` | Links to `https://finance.yahoo.com/quote/{symbol}` in a new tab | Logo falls back `public/logos/<SYM>.png` → `/proxy/ticker-logo` → text chip |
| Earnings chip tooltip | `title` | `{company \|\| symbol} · {fmtMcap(market_cap)}{ · est {eps_est}}` | `fmtMcap`: `≥1e12` → `$x.xxT`; `≥1e9` → `$nB`; else `$nM`; `0` → `n/a` | — |
| Panel-level card state | — | The panel has **no `UpdatedStamp`** — it is the only card on the page without one | — | — |

---

# Part M — Confidence Score

Source: lines 510–782. Feed: `/api/confidence?date={etToday}`, **120 s**, with a
hand-rolled loader (not `useLiveData`) because it tracks CB changes across polls.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card title | Static | `Confidence Score` | `T.cyan` | always |
| BETA tag | Static | `BETA` — `10px / 800 / .1em`, `marginLeft 6`, `verticalAlign middle` | `T.orange` at `opacity .85` | always |
| Header date | `forDate` (always today) | `YYYY-MM-DD` — `12px mono`, `opacity .6` | `T.muted` | omitted until the first load |
| "More →" link | `next/link href="/confidence-score"` | Same chip as the EM card's | `T.cyan` | always |
| Score | `Math.round(score.hit)` — **already 0..100, not a fraction** | `Value size 34` | `bandColor` (below) | card gated off |
| "/100" | Static | `14px`, `opacity .6` | `T.muted` | — |
| Band | Computed | `HIT` when `hit >= pivot && hit >= chop`; else `PIVOT` when `pivot >= chop`; else `CHOP` | `HIT` → `POS_GREEN`; `PIVOT` → `T.orange`; `CHOP` → `T.red`. `17px / 800 / .1em` | `—` when `score` is null (card is gated off anyway) |
| Score bar | `score` | Track `height 6`, `radius 3`, `background T.border`, `overflow hidden`; fill `width: {score}%`, full height | Fill uses `bandColor` | — |
| "Current SPX CB" | `data.level` | `Stat`, `Math.round(level).toLocaleString()` | `T.cyan` | `—` |
| "Distance to CB" | `price ?? spx` minus `level` | `{+}{n.toFixed(1)}` — sign always shown for `>= 0` | `POS_GREEN` when `\|dist\| <= thresholds.hitPts ?? 8`; `T.text` otherwise; `T.muted` when null | `—` |
| Checkpoints label | `Label` | `CB checkpoints`, preceded by a `divider` | — | always (when past the gate) |
| Checkpoint rows | `MVC_CHECKPOINTS` | Three rows: `9:45` (585), `10:30` (630), `12:00` (720). **The comment above the block says "9:35 / 10:30 / 12:00" — the code says 9:45. The code wins.** | `grid 46px 64px 1fr`, `columnGap 8`, `borderBottom 1px T.border`, `paddingBottom 6` | — |
| Checkpoint time | `cp.label` | `14px mono` | `T.muted` | — |
| Checkpoint strike | `segmentAt(mvcTimeline, cp.min).strike` | `Value size 14`, `Math.round().toLocaleString()`, right-aligned | `T.cyan` | `—` |
| Checkpoint chip | Priority chain | `10px / 800 / .06em`, right, `nowrap` | **Order matters**: 1) future (`nowMin < cp.min`) → `pending` `T.muted`; 2) `outcome === "pivot"` AND a later checkpoint has a LOWER strike → `HIT` `POS_GREEN`; 3) any `outcome` → `outcomeChip`; 4) live AND the CB changed from the previous checkpoint → `CB CHANGED · PENDING` `T.orange`; 5) `pending` `T.muted` | — |
| `outcomeChip` mapping | lines 559–565 | `miss` → `MISS` `T.red` · `hit` → `HIT` `POS_GREEN` · `pivot` → `HIT` `POS_GREEN` · `chop` → `HIT · CHOP` `T.orange` · `null` → `—` `T.muted` | `hit`, `pivot` and `chop` all "engaged" the level; only `miss` means never reached | — |
| `segmentAt` fallback | lines 539–549 | The last segment whose `from` (HH:MM → minutes) is `<= target`; if the target precedes every segment, **the FIRST segment** is used | So the early checkpoints report the CB in force around the open rather than `—` | `null` when the timeline is empty |
| "CB CHANGED" strip | `changedAt != null` | `12px`, `paddingTop 2`, `gap 8`. Label `CB CHANGED` `800 / .06em` in `T.orange` | Set when a poll returns a `level` whose `Math.round` differs from the previous poll's | Hidden until the first change |
| CB-change resolution | `hitAfterChange` | `hit ✓` in `POS_GREEN` `700`, else `{fmtElapsed(now - changedAt)} — awaiting hit` in `T.muted` mono | `hitAfterChange` becomes true when `\|price − level\| <= thresholds.hitPts ?? 8`. The 1 s tick runs ONLY while a change is unresolved | — |
| `fmtElapsed` | lines 568–572 | `{m}m {s}s` when `m > 0`, else `{s}s` | Floors at 0 | — |
| Card empty gate | `loading \|\| error \|\| score == null` | `CardState` | — | `Waiting for today's first CB snapshot.` |
| Date policy | `const date = today` | **Always scores today** — no prior-session fallback, and `isStale` is hardcoded `false` | Deliberate: show an empty state rather than yesterday's score | — |

---

# Part N — Net Greeks

Source: lines 784–909. Two feeds by ticker.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card title | Static | `Net Greeks` | `T.cyan` | always |
| Header caption | Computed | Non-SPX → `live chain`. SPX on fallback → `last session · {date}`. SPX live → `now · Δ15m · Δ30m` | `10px mono`, `T.muted` at `opacity .6` | always |
| Ticker pills | `NG_TICKERS` | `SPX` · `QQQ` · `SPY`, default `SPX` | — | always |
| SPX feed | `/api/snapshots/greeks?date={today}&limit=5000`, **120 s** | Ascending series; current = last row | Only fetched when `tk === "SPX"` | Empty pre-open / overnight (the writer is RTH-gated) |
| SPX fallback feed | `/api/snapshots/greeks?limit=1`, **60 s** | Newest-first, one row | Used only when today's series is empty — the card shows the LAST session instead of going blank | — |
| QQQ / SPY feed | `/api/chains?ticker={tk}&range=all`, **60 s** → `computeNetGreeks` | Already raw dollars | SPX is the only ticker with a recorded series (`greeks-ts-writer.js` is `$SPX`-only), so QQQ/SPY get totals with **no Δ columns** | — |
| Unit normalisation | `GREEK_SCALE` | `gex ×1e9`, `dex ×1e9`, `chex ×1e6`, `vex ×1e6` — `greeks_ts` stores `$B` for gex/dex and `$M` for chex/vex; the chain sum is already raw | Both sources are normalised to RAW dollars so the tiles never branch | — |
| Tile grid | — | `grid 1fr 1fr; gap 10` | — | — |
| Tile labels | `keys` const | `Net GEX` · `Net DEX` · `Net CHEX` · `Net VEX`, in that order | — | — |
| Tile frame | — | `1px T.border · radius 10 · padding 12 · flex column · gap 5` | — | — |
| Tile value | `cur[k]` | `fmtBig`, `Value size 28` | `> 0` → `POS_GREEN`; `< 0` → `T.red`; `=== 0` → `T.text` (**not muted** — differs from `signColor`) | — |
| Δ15m / Δ30m row | `rowNearestAgo(rows, latestTs, 15\|30, tol 6)` | `15m {fmtBig(d)}` and `30m {fmtBig(d)}` — `14px mono`, `gap 10`. The `15m`/`30m` word is `T.text` | Value uses `signColor(d)`. When `d == null` the whole span drops to `opacity .5` and the value is `—` in `T.muted` | `—` at `opacity .5` |
| `rowNearestAgo` | lines 798–808 | Closest row to `Number(latestTs) − minsAgo*60_000`, returned only when within `±6 min` | `Number()` coercion is deliberate — pg BIGINT timestamps can arrive as strings | `null` |
| Δ availability | — | Deltas are computed **only** for SPX on today's live series — never on the 1-row fallback, never for QQQ/SPY | — | `—` |
| Loading gate | `showLoading = (isSpx ? loading : chainLoading) && !cur` | Only spins when BOTH the today fetch and the fallback have produced nothing | Prevents a spinner while the fallback is still deciding | — |
| Card empty gate | `showLoading \|\| showError \|\| !cur` | `CardState` | — | SPX `No greeks series yet.` · other `No live chain for {tk}.` |
| Updated stamp | `isSpx ? lastUpdated : chainAt` | Part B — stamps the feed that actually produced the numbers | — | `updated —` |

---

# Part O — Initial Balance

Source: lines 911–1105. Feed: `useEsCandles(true)` (the shared ES candle feed) →
`computeAmt(esBars, etToday)` from `lib/failLevels.ts`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card title | Static | `Initial Balance` | `T.cyan` | always |
| Header caption | Static | `ES` — `12px mono`, `opacity .6` | `T.muted` | always |
| Candle selection | `candles.filter(c => c.symbol.toUpperCase().includes("ESU"))`, falling back to ALL candles when no ESU bar exists | — | — | — |
| Countdown bar | `ibCountdown()` | `pre` → `IB forms in {m}m {ss}s` · `forming` → `Forming — {m}m {ss}s left` · `done` → `IB locked`. Seconds are zero-padded to 2 | `forming` → `T.orange`; `done` → `POS_GREEN`; `pre` → `T.muted`. `12px mono` | Empty string until `mounted` (the countdown is client-only to avoid an SSR hydration mismatch) |
| Countdown window | `IB_OPEN_MIN = 570 (09:30)`, `IB_END_MIN = 630 (10:30)` ET | Ticks every 1 s | — | — |
| IB High | `amt.ib.high` | `Stat`, `Math.round().toLocaleString()`, default `size 21` | `POS_GREEN` | `—` |
| IB Mid | `amt.ib.mid` = `(high + low) / 2` | same | `T.cyan` | `—` |
| IB Low | `amt.ib.low` | same | `T.red` | `—` |
| Range | `high − low` | `{Math.round(range)} pts` | Reads the literal string `forming` while `cd.phase === "forming"`. Default `T.text` | `—` |
| "IB read" label | `Label`, after a `divider` | `IB read` | — | — |
| Day type | `amt.dayTypeLabel` | One of `Forming` · `Trend ↑` · `Trend ↓` · `Reversal ↑` · `Reversal ↓` · `Balance / Two-sided` · `Balance`. `14px / 800` | Coloured by `amt.bias.lean`: `long` → `POS_GREEN`, `short` → `T.red`, else `T.muted` | `—` |
| Lean | `amt.bias.lean` | `long` / `short` / `neutral` — `10px / 800 / .08em / uppercase`, right-aligned | Same lean colour | `neutral` |
| Bias sentence | `amt.bias.text` | `14px`, `lineHeight 1.4`, `T.text`. The five exact strings: trend-up `"Trend up — favor break-&-retest longs above IB/PDH; stops below IB low."` · trend-down `"Trend down — favor break-&-retest shorts below IB/PDL; stops above IB high."` · reversal-up `"Reversal up — early low taken then reclaimed; long back above IB."` · reversal-down `"Reversal down — poor high then back below IB; short the rollover."` · balance `"Balance day — fade ONH/PDH and ONL/PDL back toward the IB mid; avoid the middle."` · default `"Two-sided auction — trade the reference levels, no strong directional lean."` | — | undefined renders nothing |
| Day-type classification | `computeAmt` | `brokeHigh && !brokeLow && close > high` → trend-up · `brokeLow && !brokeHigh && close < low` → trend-down · `brokeHigh && close < low` → reversal-down · `brokeLow && close > high` → reversal-up · `brokeHigh && brokeLow` → `Balance / Two-sided` · `ib.locked` → `Balance` · else `Forming` | `brokeHigh/Low` are computed from bars at or after 10:30 ET only. `locked` = the last bar's ET minute `>= 630` | — |
| "Rules in play (n)" | `applicableRules(ib)` | `Label` with the count, after a `divider`. Section is omitted entirely when the list is empty | — | section hidden |
| Rule card | — | `1px T.border` + `borderLeft 3px {themeColor}` · `radius 8` · `padding 8px 10px` · `gap 3`; scroller `flex:1; overflowY:auto; minHeight:0` | Rule colours are mapped through `ruleColorMap`: `#ffb300 → T.orange`, `#219EBC → T.cyan`, `#00e676 → POS_GREEN`, `#ff5252 → T.red`, `#ffffff → T.text`, `#ff1744 → T.red`, anything else → `T.cyan` | — |
| Rule title | `rule.title` | `14px / 800` in the mapped colour | — | — |
| Rule detail | `rule.detail` | `12px`, `lineHeight 1.4`, `T.text` | — | — |
| Rule 1 — forming | `!done` | Title `IB Forming · Provisional Reads` (`#ffb300` → orange). Detail: ``Tracking the 9:30–10:30 ET range live — current IB H/L {high.toFixed(2)} / {low.toFixed(2)}. The reads below use the developing range and can still change; they lock at 10:30 ET.`` | Always first while the window is open | — |
| Rule 1 — locked | `done` | Title `Inside Day Exception` (`#219EBC` → cyan). Detail `IB window complete. Only 0.6% of days stay fully inside the IB — plan for at least one breakout.` | — | — |
| Rule 2 — range mode | `done && !brokeHigh && !brokeLow && nowMins > 660 (11:00)` | Title `Timing Curve · Range Mode` (`#ffffff` → `T.text`). Detail `Past 11:00 ET with no breakout — 84.1% of breakouts hit by now. Shift from breakout to range/premium-decay playbook.` | — | — |
| Rule 3 — single break | `brokeHigh XOR brokeLow` | Title `Single-Break Trend Day` (`#00e676` → `POS_GREEN`). Detail `One clean side broken — modern ES regime: 75.59% single-break trend days, 22.05% double-breach risk. Respect the first break{tag}.` where `tag` is `" (provisional — IB still forming)"` before 10:30, else `""` | Both branches (high-only and low-only) produce the SAME title and text | — |
| Rule 3 — double breach | `brokeHigh && brokeLow` | Title `Double Breach (ES)` (`#ff1744` → `T.red`). Detail `Both IB sides broken — the ~40% ES double-cross whiplash profile. Trend-continuation conviction is reduced{tag}.` | — | — |
| Card empty gate | `ib == null` | `CardState` with `loading = candles.length === 0 && grace` (4 s grace window) | — | `pre` phase → `IB hasn't formed yet — waiting for 9:30 ET open.` · otherwise `No ES data for this session.` |
| Updated stamp | `Number(candles[candles.length-1].timestamp)` — the newest candle | Part B | — | `updated —` when there are no candles |

---

# Part P — Ticker Levels (and the shared symbol picker)

Source: lines 1107–1583. Feeds: `/proxy/walls?date={today}` (**120 s**),
`/proxy/scanner?any=1&limit=200` (**120 s**), `useScannerTickers()`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card title | Static | `Ticker Levels` | `T.cyan` | always |
| Expiry chip (header right) | `expiryLabel(row.expiry, today)` | `Aug 6 · 0DTE` / `Sep 5 · 6DTE`; a past expiry renders bare `Sep 5`; unparsable renders `exp {raw}` — `12px mono`, `opacity .7` | Tooltip: `Levels computed on the {expiry} chain`, or `No expiry recorded for this symbol` | `exp —` |
| Symbol picker | `TickerLevelsPicker` | see the picker rows below | Universe = `[...TL_DEFAULT, ...extra, ...scannerTickers, tk]`, deduped. `TL_DEFAULT = ["SPX","SPY","QQQ"]` | — |
| Spot | `/proxy/scanner → spot` (preferred), else `/proxy/walls → spot` | `Stat`, `toLocaleString("en-US", {maximumFractionDigits: 2})`, `size 18` | default `T.text` | `—` |
| Call Wall | scanner `call_wall`, else walls `call_wall` | same | `T.orange`; `T.muted` when null | `—` |
| Put Wall | scanner `put_wall`, else walls `put_wall` | same | `POS_GREEN`; `T.muted` when null | `—` |
| Core | `/proxy/walls → tickers[].cb` **only** | `Value size 22`, same locale format, after a `divider` and under a `Core` label | `T.cyan`; `T.muted` when null | `—` |
| Core distance | `core − spot` | `{+}{n.toLocaleString(undefined,{maximumFractionDigits:1})}` — `Value size 14`, right of the Core value | `signColor(distCore)`; `T.muted` when null | `—` |
| Distance label | Computed | `Distance to nearer wall ({Call\|Put})` + `" · through"` when the nearer gap is negative | `Label` styling | — |
| Distance value | `nearerCall ? call − spot : spot − put` | `{-}{abs.toLocaleString(undefined,{maximumFractionDigits:1})} pts` — `Value size 18` | Crossed → `T.red`; otherwise `POS_GREEN`; `T.muted` when null | `—` |
| Distance percent | `abs(near) / spot * 100` | `{x.xx}%` — `Value size 14` | `T.muted` | `—` |
| Source precedence | — | Scanner rows win for spot/call/put (fresher — swept every 2–5 min); `/proxy/walls` overlays `cb` on top. Rows only in walls are inserted whole with `expiry: null` | `/proxy/walls` is the ONLY endpoint that returns `cb` | — |
| TODAY-ONLY rule | — | Scanner rows flagged `stale` are **dropped, not displayed**; there is no prior-session walls fallback | An empty map with both fetches settled means today's recorders have not run yet — not a failure | — |
| Footnotes line | `notes.join(" · ")` | `11px mono`. Possible notes: `waiting on today's scanner sweep` (symbol is known to a recorder but has no fresh row) · `not in the scanner universe` (unknown symbol) · `core pending — first walls run 9:29 AM ET` | `T.orange` at `opacity .75` when the core-pending note is present; otherwise `T.muted` at `opacity .5` | Line omitted when there are no notes |
| Ready / loading gate | `loaded = bySymbol.size > 0 \|\| row.spot != null` | `loading = (wLoading \|\| sLoading) && !loaded`; `error = loaded ? null : wError ?? sError` | — | `Waiting on today's first recorder run.` |
| Futures | — | **ESU / NQU are deliberately absent.** `scanner_snapshots` covers cash indices and equities only; the derived basis-shifted rows were removed | — | — |
| Updated stamp | `lastUpdated` from the **walls** fetch | Part B | — | `updated —` |
| Picker — trigger | `TickerLevelsPicker` button | `width 100% · 13px / 800 · padding 7px 11px · 1px T.border · radius 6 · bg rgba(255,255,255,0.04) · T.cyan · .08em uppercase · nowrap`, with a `▾` in `T.muted` at `opacity .7` | `aria-label="Select ticker"` | — |
| Picker — panel | `createPortal` to `document.body` (the card clips its overflow) | `position: fixed` at the trigger's `left` / `bottom + 3`; `width: max(triggerWidth, 200)`; `background rgba(13,17,25,0.97)`; `backdrop-blur(20px)`; `1px T.border` + `borderTop 2px T.cyan`; `radius 6`; `boxShadow 0 8px 32px rgba(0,0,0,0.7)`; `zIndex 9999` | Repositions on `scroll` (capture) and `resize` | — |
| Picker — search box | `<input autoFocus>` | `11px / 700`, `padding 5px 8px`, `1px T.border`, `radius 5`, `bg rgba(255,255,255,0.04)`, `.06em`; value forced uppercase | Query is normalised `trim().toUpperCase().replace(/[^A-Z0-9.]/g, "")`. **Cleared on CLOSE, not on open**, so the menu never paints one frame of stale filtering | placeholder `Search or add…` |
| Picker — Enter key | `onKeyDown` | Exact match → choose it; else the first non-divider row → choose it; else → add the query | — | — |
| Picker — "+ Add" row | `q && !exact` | `+ Add “{q}”` — `11px / 700`, `padding 6px 10px`, `T.cyan`, `.04em`; hover `rgba(255,255,255,0.05)` | Exists because the scanner universe is not everything the walls tables know about (NDX, for instance) | — |
| Picker — rows | `options` filtered by substring `includes(q)` | Favourites first (sorted), then a 1px `T.border` divider (only when both groups are non-empty), then the rest (sorted). `11px`, `padding 5px 10px`, `.04em`, `nowrap` | Active row: `fontWeight 800`, `T.cyan`, `background rgba(33,158,188,0.10)` (hover `.15`); others `600`, `T.text`, hover `rgba(255,255,255,0.05)` | `No tickers` at `10px` `T.muted` when the list is empty and there is no query |
| Picker — favourite star | `toggleFav` | `★` / `☆` at `12px` | Favourited → `#ffd600`; otherwise `rgba(255,255,255,0.28)`. Tooltip `Favorite` / `Unfavorite`. Click stops propagation | — |
| Picker — remove `×` | Only for symbols in the `custom` list | `×` at `12px`, `T.muted` at `opacity .7`, tooltip `Remove {t}` | Removing the currently-selected symbol resets the card to `SPX` | — |
| Picker — dismissal | `mousedown` outside both refs, or `Escape` | Closes | — | — |
| Picker — persistence | `localStorage` | `analytics.tickerLevels.extra` (added symbols) and `analytics.tickerLevels.favs` (favourites), both JSON string arrays | Loaded in an EFFECT, not a `useState` initializer, so the server and first client render agree. All reads/writes are `try`-wrapped (private mode / bad JSON falls back to defaults) | — |

---

# Part Q — Strategy Builder

Source: lines 3204–3411. Feed: `/api/strategy`, **5 min**, only while
`isStrategyWindow()`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card frame | `<Card variant="budget" padding={16}>` | `gridColumn: "1 / -1"`, `flex column`, `gap 12`, no fixed height | — | — |
| Card title | Static | `Strategy Builder` | `T.cyan`, `17px / 800 / .08em / uppercase` | always |
| "NOT FINANCIAL ADVICE" tag | Static | `10px / 800 / .1em`, `marginLeft 6`, `verticalAlign middle` | `T.orange` at `opacity .85` | always |
| Header date | `strategy.date` | `YYYY-MM-DD`, or `last · {date}` when the plan is not today's — `12px mono`, `opacity .7` | Stale (`planDate !== etDateISO()`) → `T.orange`; fresh → `T.muted` | Hidden when there is no date OR the card is outside its window |
| Window gate | `isStrategyWindow()`, re-checked every **60 s** | Outside the window the card renders ONLY a `Placeholder` and fetches nothing (`useLiveData(null)`) | Weekdays, `09:00 ≤ ET < 16:00` | `Available 9:00 AM – 4:00 PM ET on weekdays.` |
| Ready gate | `!!plan && (!!plan.summary \|\| !!plan.headline)` | `CardState` when not ready | Error source is `error ?? data?.error` | `No strategy yet — regenerates hourly on weekdays (~7am–4pm ET).` |
| Bias pill | `plan.bias` | `long` / `short` / `neutral` — `17px / 800 / .1em / uppercase`, `1px` border, `radius 8`, `padding 4px 12px` | `biasColor`: `long` → `POS_GREEN`, `short` → `T.red`, anything else → `T.muted`. Border and text are the same colour | Renders `neutral` when `bias` is missing |
| Headline | `plan.headline` | `17px / 700`, `flex: 1` | `T.text` | omitted when blank |
| Summary | `plan.summary` | `<p>` `14px`, `lineHeight 1.65`, `margin 0`, `opacity .92` | `T.text` | omitted when blank |
| Body grid | — | `grid 1fr 1fr; gap 16`, after a `divider` | Collapses to one column ≤899px | — |
| "Key levels" title | `SectionTitle` | `12px / 800 / .1em / uppercase` | `T.cyan` | always |
| Level row | `plan.levels[]` | `borderBottom 1px T.border`, `paddingBottom 6`, `gap 2` | — | Whole list → a single `—` at `14px` `T.muted` `opacity .6` when empty |
| Level label | `lv.label` | `14px / 700` | `T.cyan` | `—` |
| Level price | `lv.price` | An em-dash separator in `T.muted` `opacity .6`, then the price `14px mono / 800` in `T.text`, then a `SPX` suffix at `10px / 700` `T.muted` `opacity .65`, `marginLeft 4`, `.06em` | Rendered only when `price != null && String(price) !== ""`. **The SPX tag is hardcoded — the generator is SPX-only** | separator + price omitted |
| Level note | `lv.note` | `14px`, `lineHeight 1.45` | `T.muted` | omitted |
| "Primary idea" title | `SectionTitle` | `12px / 800 / .1em / uppercase` | `T.orange` | always |
| Idea frame | `plan.idea` | `1px T.border`, `radius 10`, `padding 10`, `gap 6` | — | `—` at `14px` `T.muted` `opacity .6` when there is no idea |
| Idea direction | `idea.direction` | `▲ LONG` / `▼ SHORT` / `—` — `17px / 800` | `biasColor(direction)` | `—` |
| Entry / Stop / Target | `idea.entry` / `.stop` / `.target` through `withSpx` | `grid repeat(3, 1fr); gap 8`; `Stat size 16`; each value gains the same `SPX` suffix chip | Entry default `T.text`; Stop `T.red`; Target `POS_GREEN` | `withSpx` renders `—` for blank/missing |
| Idea rationale | `idea.rationale` | `14px`, `lineHeight 1.5` | `T.muted` | omitted |
| "Confirmation triggers" title | `SectionTitle` | `12px / 800 / .1em / uppercase` | **`T.green` (`#8ECAE6`, the light blue)** — the ONLY use of `T.green` on this page | always |
| Trigger list | `plan.triggers[]` | `<ul>` `paddingLeft 18`, `gap 5`; each `<li>` `17px`, `lineHeight 1.5`, `T.text` | — | `—` at `14px` `T.muted` `opacity .6` |
| Risk line | `plan.risk` | After a `divider`: `RISK · ` in `T.orange` `800` `.06em`, then the text at `17px`, `lineHeight 1.55`, `T.muted` | Whole block omitted when `risk` is blank | omitted |
| Updated stamp | `UpdatedStamp at={lastUpdated}` | Part B | Stamps only successful fetches, so it stays at the last in-window fetch after 16:00 | `updated —` |

---

# Part R — Cadences, storage, dead code, and the v3 starting point

| Item | Detail |
|---|---|
| Poll cadence table | `useLiveData` default **120 s**. Overrides: Multi Greek chain 60 s · EM levels 120 s / EM quote **15 s** · Premarket summary **5 min** / ES gap 120 s · Confidence **120 s** (own loader) · Net Greeks today-series 120 s / fallback 60 s / chain 60 s · Ticker Levels walls 120 s / scanner 120 s · Ticker Lookup chain 60 s / expirations **15 min** / board sweep 120 s / Δ 1D **60 min** · Strategy **5 min** |
| Sub-second timers | Confidence: a 1 s tick, running ONLY while a CB change is unresolved. IB: a 1 s tick, always. Econ Calendar: a 60 s `now` tick for staleness. Strategy: a 60 s window re-check |
| Concurrency | Ticker Lookup board sweep: `TL_BOARD_CONCURRENCY = 6` parallel chain fetches, uncapped expiry count |
| localStorage keys | `analytics.tickerLevels.extra` · `analytics.tickerLevels.favs` · `analytics.tickerLookup.recent` (capped at **8**). All three are read in effects and wrapped in `try`/`catch` |
| Endpoints touched | `/api/chains` · `/api/expirations` · `/api/levels` · `/api/tt-quotes` · `/api/premarket-summary` · `/api/es-gap` · `/api/confidence` · `/api/snapshots/greeks` · `/api/strategy` · `/api/eod-strike-gex-change` · `/api/calendar` · `/api/calendar-quote` · `/proxy/walls` · `/proxy/scanner` · `/proxy/scanner-tickers` · `/proxy/earnings-week` · `/proxy/ticker-logo` · `/proxy/strike-growth/replay-meta` · `/proxy/strike-growth/frames-by-expiry` |
| WebSocket | **The page opens NO socket.** Every value is REST. `useEsCandles` is the one live-ish feed (IB card) and it is its own hook — check what it rides before wiring the v3 equivalent through `src/data/hooks.ts` |
| Removed in v2, do not port | The SPX Premium Flow card (line 3202 — "now has its own dedicated page"). ESU / NQU rows on Ticker Levels (lines 1134–1137). The Gamma flip level CHIP (removed; the flip survives only in "The read"). The spot caret `◀` in the ladder (replaced by the dashed price line) |
| Typed but unrendered | `EsGapResp.gap.open_0930` / `gap_dir` / `pct_filled` / `filled`; `ConfidenceResp.score.break`; `TlChangeRow.netGex` / `prevNetGex` / `hadPrev`; `TlReplayFrame.cells[].vol` (the `basis: "vol"` path of `tlReplayRows` is never called with `"vol"` from this page) |
| Comment vs code conflicts | 1) The Confidence checkpoint comment says "9:35 / 10:30 / 12:00"; `MVC_CHECKPOINTS` says **9:45**. 2) The file header calls the page a "UI-only scaffold with MOCK data" — it is not, every card is live. 3) `TL_CHIP_MIN_H`'s comment computes 92 but the constant is **106**. In all three the CODE is the spec |
| v3 route wiring — ALL FOUR STEPS DONE | Verified 2026-08-30: `src/pages/Analysis.tsx` ✓ · the `lazy()` route in `src/App.tsx` ✓ · `{ to: '/analytics', label: 'Analysis', icon: '📈', prefetch: ['/api/premarket-summary'] }` in `src/shell/Shell.tsx` ✓ · `app/v3/analytics/route.ts` ✓. Nothing to add; a hard refresh of `/v3/analytics` resolves |
| v3 status — BUILT 2026-08-30 | The first port was discarded and the page rebuilt from this document. 23 files, ~7,000 lines, under `src/pages/analysis/`: `kit.tsx` (Part B) · `greeks.ts` (Part H) · `ib.ts` · `TickerPicker.tsx` · `cards/` × 8 · `lookup/` × 4 (levels, replay, Ladder, TickerLookup) · `analysis.css` · `Analysis.tsx` |
| What the discarded version was missing | Four stubs (Ticker Lookup, Multi Greek, Econ Calendar, Initial Balance), a Ticker Levels regressed to four hardcoded pills, and v3's palette throughout. All rebuilt |
| Verified before hand-off | `tsc --noEmit` under v3's exact tsconfig (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noUnusedLocals`): clean. `scripts/check-theme.mjs` run against the new tree: zero violations, and confirmed with a deliberate probe file that the scanner does walk `src/pages/analysis/` |
| NOT verified — needs Brandon's machine | `npm run build` (vite + budgets), `check:ws`, `perf`, `check:casing`. The device's Linux VM was unavailable this session, so nothing could be run in the repo itself |
| Type scale — an open question | `check-theme.mjs` rule 4 bans a bare `fontSize:` number and names a canonical ramp (9 / 10 / 11 / 13 / 15 / 18 / 24 / 32). v2's page uses 9, 10, 11, 12, 13, 14, 16, 17, 18, 20, 21, 22, 26, 28, 34 — they agree on almost nothing. The port keeps v2's sizes in a named constant (`FS` in `kit.tsx`), which satisfies the rule. Reconciling the two ramps is a separate decision |

---

# Part S — Colour parity: v2's values are the spec

Brandon, 2026-08-30: *"keep colors the same as the v2 version."* Scope decided
the same day: **this page only** — no existing v3 token changes value, and no
other v3 page is recoloured.

This part is a PRE-REQUISITE, not a finishing step. Build any of Parts A–R
against `T.*` as it stands today and the page comes out in v3's dark-slate
palette, which is the wrong answer to a requirement that was stated up front.

## S.1 — The six that do NOT match

`src/design/theme.ts` maps v2's names onto v3's values on purpose ("*only its
palette changes, and it changes to v3's*"). On this page that intent is
overridden. These six are the trap:

| v2 name | v2 value | `T.*` resolves to | v3 token behind it | Verdict |
|---|---|---|---|---|
| `T.cyan` | `#219EBC` teal | `#5b8cff` | `--color-accent` | **WRONG** — blue-violet. Every card title on the page |
| `T.orange` | `#FB8501` | `#e0a44a` | `--color-warn` | **WRONG** — muted amber. Replay, BETA tags, warnings |
| `T.red` | `#EF4444` | `#e0645f` | `--color-down` | **WRONG** — softer red. Every negative number |
| `T.green` | `#8ECAE6` light blue | `#35c28e` green | `--color-up` | **WRONG, and inverted in meaning** — v2's `green` is a light BLUE. One use: the "Confirmation triggers" title |
| `T.border` | `rgba(255,255,255,0.10)` | `#23272e` | `--color-line` | **WRONG** — opaque slate vs a white wash. Every card edge, divider and hairline |
| `T.panelBg` | `rgba(13,17,25,0.45)` | `#14171d` | `--color-surface2` | **WRONG** — opaque vs 45% translucent. This is the CARD FILL; the frosted look is the translucency |

Two more that differ but matter less, recorded so nobody "fixes" them later:
`T.bg` `#05060A` vs `--color-bg` `#07080b`, and `T.panel` `#0D1119` vs
`--color-surface` `#0f1117`.

## S.2 — Already exact in v3, reuse as-is

`tokens.css` already carries these at v2's exact value. No new token, no change:

| v2 value | Existing v3 token | Used on this page for |
|---|---|---|
| `#ffd600` | `--color-level-cb` | the `CB` ladder tag, the Core chip, the picker's favourite ★ |
| `#29b6f6` | `--color-level-cw` | the `CW` ladder tag, the Call wall chip |
| `#ff4757` | `--color-level-pw` | the `PW` ladder tag, the Put wall chip |
| `#ef4444` | `--color-impact-high` | econ High impact (same value as v2's `T.red`, different meaning — keep both names) |
| `#f59e0b` | `--color-impact-medium` / `--color-cal-forecast` | econ Medium impact, the `F:` figure |
| `#3a5570` | `--color-impact-low` | econ Low impact, the header date, the earnings `MKT`/`HRS` sub-label |
| `#6b7280` | `--color-impact-holiday` | econ Holiday impact |
| `#a855f7` | `--color-impact-president` | econ President impact (the TRUMP filter) |
| `#1e2a38` | `--color-impact-faded` | every faded (stale) econ row's text and left border |
| `#22c55e` | `--color-cal-actual` | the `A:` figure — **and it is the same value as `POS_GREEN`**, see S.3 |
| `#8a9ab8` | `--color-cal-previous` | the `P:` figure, the earnings `TIME TBD` bucket |
| `#219ebc` | `--color-cal-accent` | the econ day-separator + TODAY badge — **and the same value as v2's `T.cyan`**, see S.3 |

## S.3 — Tokens to ADD to `tokens.css`

Thirteen (twelve at first pass; `v2-dim` was found during the build). Grouped under one `── v2 parity ──` heading with a comment saying why
they exist, in the style of the existing candle-colour block.

| New token | Value | Replaces | Notes |
|---|---|---|---|
| `--color-v2-cyan` | `#219ebc` | `T.cyan` | Same value as `--color-cal-accent`. Keep BOTH: a card title is not a calendar accent, and the two must be free to move apart |
| `--color-v2-orange` | `#fb8501` | `T.orange` | No existing v3 token carries it |
| `--color-v2-red` | `#ef4444` | `T.red` | Same value as `--color-impact-high`. Keep both, same reasoning |
| `--color-v2-green` | `#8ecae6` | `T.green` | The light blue. ONE use on the page |
| `--color-v2-pos` | `#22c55e` | `POS_GREEN` | Same value as `--color-cal-actual`. Keep both — this is the page's up/positive colour, not a calendar figure |
| `--color-v2-purple` | `#126783` | `T.purple` | Only in the page-background glow's second radial |
| `--color-v2-bg` | `#05060a` | `T.bg` | Page canvas + faded econ row background |
| `--color-v2-panel` | `#0d1119` | `T.panel` | The ladder's spot-label chip, and the base for all three panel washes in S.4 |
| `--color-v2-ink` | `#0b0f1a` | the bare literal | Ink on a solid fill: ladder `CB`/`CW`/`PW` tags, active replay buttons, the active ⏱ Replay toggle |
| `--color-v2-refresh` | `#1fd98a` | `REFRESH_GREEN` | The ↻ button's success state + its glow |
| `--color-v2-badge-ink` | `#05080d` | the bare literal | Ink on the econ calendar's solid `TODAY` badge |
| `--color-v2-dim` | `#888888` | the ↻ button's "refreshing" grey | v2 types `#888` inline. `--color-flat` (`#7a828d`) is close but not the same |
| `--color-v2-lightblue` | `#7ed3fc` | the embed-mode radial | **Note the discrepancy**: `homeTheme.LIGHT_BLUE` is `#7dd3fc`, but the `.analytics-embed` CSS writes `rgba(126,211,252,.10)` = `#7ed3fc`. One off in the red channel. The CSS is what paints, so `#7ed3fc` is the parity value |

Then extend `theme.ts` with a `V2` bridge object over these, so a ported
component reads `V2.cyan` and never a literal:

```
export const V2 = {
  cyan: 'var(--color-v2-cyan)',
  orange: 'var(--color-v2-orange)',
  red: 'var(--color-v2-red)',
  green: 'var(--color-v2-green)',
  pos: 'var(--color-v2-pos)',
  purple: 'var(--color-v2-purple)',
  bg: 'var(--color-v2-bg)',
  panel: 'var(--color-v2-panel)',
  ink: 'var(--color-v2-ink)',
  refresh: 'var(--color-v2-refresh)',
  dim: 'var(--color-v2-dim)',
  badgeInk: 'var(--color-v2-badge-ink)',
  lightBlue: 'var(--color-v2-lightblue)',
  text: T.text,   // #ffffff — already identical
  muted: T.muted, // #ffffff — already identical
} as const
```

`text` / `muted` / `faint` need nothing: v3's are already `#ffffff`, which is
what v2's `T.text` and `T.muted` are. **v2 has no grey secondary** — "muted" is
white at an opacity, and every `opacity: .5/.6/.7/.8` in Parts A–R is doing that
job. Port the opacities, not a grey.

## S.4 — Every wash, as `alpha()` / `mix()`

v2 builds these with a local `themeRgba()` helper or a typed `rgba()`. In v3
they come from `alpha(token, a)` in `theme.ts`, which is `color-mix()`
underneath and keeps tracking the token. **None of these is a new token.**

| v2 literal | v3 expression | Where |
|---|---|---|
| `rgba(255,255,255,0.10)` | `alpha(T.text, 0.10)` | `T.border` — every card edge, divider, tile border, hairline |
| `rgba(13,17,25,0.45)` | `alpha(V2.panel, 0.45)` | `T.panelBg` — the card fill (`classicCardAccentStyle`) |
| `rgba(13,17,25,0.72)` | `alpha(V2.panel, 0.72)` | `T.panelBgStrong` — the econ header bar, the replay date `<select>` |
| `rgba(13,17,25,0.97)` | `alpha(V2.panel, 0.97)` | the portal'd ticker picker panel |
| `rgba(0,0,0,0.22)` | `alpha(SHADOW, 0.22)` | `classicCardStyle`'s `0 18px 40px` card shadow |
| `rgba(0,0,0,0.7)` | `alpha(SHADOW, 0.70)` | the picker panel's `0 8px 32px` shadow |
| `rgba(255,255,255,0.04)` | `alpha(T.text, 0.04)` | picker trigger bg, picker search-input bg, `homeSecondaryButtonStyle` bg |
| `rgba(255,255,255,0.05)` | `alpha(T.text, 0.05)` | picker row hover, inactive replay-transport button bg |
| `rgba(255,255,255,0.03)` | `alpha(T.text, 0.03)` | "The read" block background |
| `rgba(255,255,255,0.28)` | `alpha(T.text, 0.28)` | the picker's UNfavourited ☆ |
| `rgba(255,255,255,0.12)` | `alpha(T.text, 0.12)` | the Premarket bullet list's thin scrollbar thumb |
| `rgba(33,158,188,.25)` | `alpha(V2.cyan, 0.25)` | `homeButtonStyle` border |
| `rgba(33,158,188,.12)` → `.04` | `alpha(V2.cyan, 0.12)` → `0.04` | `homeButtonStyle`'s `linear-gradient(180deg, …)` |
| `rgba(33,158,188,0.08)` | `alpha(V2.cyan, 0.08)` | the ladder's spot-row background; also the ↻ button's idle fill |
| `rgba(33,158,188,0.10)` / `0.15` | `alpha(V2.cyan, 0.10)` / `0.15` | picker active row, and its hover |
| `rgba(33,158,188,0.06)` | `alpha(V2.cyan, 0.06)` | the econ calendar's TODAY day-separator background |
| `themeRgba(cyan, 0.4)` | `alpha(V2.cyan, 0.40)` | the ↻ button's idle border |
| `rgba(33,158,188,0.04)` | `alpha(V2.cyan, 0.04)` | `homeShellStyle`'s first background radial (15% 50%) |
| `rgba(18,103,131,0.05)` | `alpha(V2.purple, 0.05)` | `homeShellStyle`'s second background radial (85% 30%) |
| `rgba(251,133,1,0.07)` | `alpha(V2.orange, 0.07)` | the replay bar's background |
| `` `${T.orange}55` `` | `alpha(V2.orange, 0.333)` | the replay bar's border — `0x55` is 85/255 = 33.3% |
| `themeRgba(REFRESH_GREEN, 0.1)` / `0.5` | `alpha(V2.refresh, 0.10)` / `0.50` | the ↻ success fill, and its `0 0 12px` text-shadow |
| `themeRgba(T.red, 0.1)` / `0.5` | `alpha(V2.red, 0.10)` / `0.50` | the ↻ error fill and glow |
| `rgba(126,211,252,0.10)` | `alpha(V2.lightBlue, 0.10)` | the `.analytics-embed` card radial |
| `${col}0f` | `alpha(impactColor, 0.059)` | the econ event row's `linear-gradient(90deg, … 0%, transparent 35%)` — `0x0f` = 15/255 |
| `${col}18` | `alpha(impactColor, 0.094)` | the econ event row's time-column `inset -1px 0 8px` — `0x18` = 24/255 |
| `${k.color}12` | `alpha(earnColor, 0.071)` | the earnings row's gradient — `0x12` = 18/255 |

**`mix()`, not `alpha()`, wherever the wash sits over a coloured bar.** The
ladder's `CB`/`CW`/`PW` tags and the spot-price label chip both sit on top of
bars; a translucent plate lets the bar read through and the tag stops being
legible. The tags take a SOLID `LEVEL_COLORS.*` fill with `V2.ink` on top, and
the spot label takes a solid `V2.panel`. Neither is `alpha()`-anything in v2 and
neither may become one in v3.

## S.5 — What the checks will and will not catch

| Check | Catches | Does NOT catch |
|---|---|---|
| `npm run check:theme` | Any hex / `rgb()` / `hsl()` outside `tokens.css`; Tailwind's default palette (`text-gray-400`, `bg-zinc-900`); unknown `var(--typo)` | **A token that resolves to the wrong colour.** `T.cyan` passes the scan and paints `#5b8cff`. Nothing automated protects colour PARITY — only this document does |
| `theme-baseline.json` | Files above their grandfathered count | Currently lists four board/chart files only. **`src/pages/Analysis.tsx` is not in it, so its allowance is zero** — one literal fails the build. Never add it to the baseline to get a build through |
| `npm run build` / the Dockerfile | Runs `check:theme` before `build:fast` | — |

Verification for the parity script (step 4) is therefore a colour check as well
as a value check: sample the computed `color` / `background-color` of the card
titles, the sign-coloured numbers, the ladder tags and the card edge on
`/app/analytics` and `/v3/analytics`, and FAIL on any that differ.
