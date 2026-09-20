# `/analytics` — Analysis

**Route.** `/v3/analytics`. Registered in `src/App.tsx:193` as `<Route path="/analytics" element={<Analysis />} />`, behind `const Analysis = lazy(() => import('@/pages/Analysis'))` (`src/App.tsx:38`). Rail entry in `src/shell/Shell.tsx:134`: `{ to: '/analytics', label: 'Analysis', icon: '📈', prefetch: ['/api/premarket-summary'] }`. A hard refresh is answered by `app/v3/analytics/route.ts` in the v2 repo — step 4 of AGENTS.md's four-step "Adding a page", and the reason the page does not 404 on a shared link.

**Sources.**

| Path | Role |
|---|---|
| `src/pages/Analysis.tsx` | the page: the grid, the embed switch, the card order |
| `src/pages/analysis/kit.tsx` | v2's type scale, controls, states, fetch hook, refresh button |
| `src/pages/analysis/greeks.ts` | per-strike GEX/DEX/CHEX/VEX from `/api/chains`; the stored series |
| `src/pages/analysis/ib.ts` | the 09:30–10:30 ET Initial Balance read, narrowed from v2's `failLevels.ts` |
| `src/pages/analysis/TickerPicker.tsx` | the portal'd searchable symbol menu |
| `src/pages/analysis/analysis.css` | page frame, radials, scrollbars, the phone collapse |
| `src/pages/analysis/cards/*.tsx` | nine card bodies (eight mounted — see Gotchas) |
| `src/pages/analysis/lookup/TickerLookup.tsx` | the full-width two-pane GEX lookup + replay |
| `src/pages/analysis/lookup/Ladder.tsx` | the bar ladder both panes draw |
| `src/pages/analysis/lookup/levels.ts` | walls, core, gamma flip, the drawn window, ATM premium |
| `src/pages/analysis/lookup/replay.ts` | recorded-sweep frames, the fixed axis, the positional parser |

---

## What it is, in one paragraph

Analysis is the pre-open / mid-session reading room: one screen that answers "what is the options board saying about this symbol right now, and what does the tape say about the day". At the top sits **Ticker Lookup**, a full-width card that takes whatever symbol the toolbar is on and draws two GEX ladders side by side — one expiration on the left, the whole listed board minus 0DTE on the right — with Core / Call Wall / Put Wall computed off each, a gamma-regime pill, a plain-language read and a replay transport that rewinds both ladders through a recorded session. Under it, a four-column grid of eight fixed-height cards: peak greek strikes, the published weekly estimated-move bands, the AI premarket five-bullet read, today's economic calendar, the Core Bullseye confidence score, the four net greek totals with 15/30-minute deltas, the Initial Balance day-type read, and per-symbol Spot / Call Wall / Put Wall / Core. Every number on the page is REST — the page opens no socket of its own and mounts no canvas. It is a **1:1 port of v2's `/app/analytics`** against a 419-row checklist (`docs/parity/analysis.md`), and it deliberately renders **v2's palette, not v3's**.

---

## Why the `v2` Card plate

`src/design/primitives/Card.tsx` takes a `plate` prop typed `export type CardPlate = 'v3' | 'v2'` (`Card.tsx:60`). Everywhere else in the app that prop is left alone and the card is the dark-slate plate: `rounded-md border border-line bg-surface`. This page passes `plate="v2"` on every card, from `AnalysisCard` in `kit.tsx`, and it is the **only** page that does.

The plate itself is `V2_PLATE` (`Card.tsx:99–106`), v2's `classicCardStyle` + `classicCardAccentStyle` as one object:

```
background:       V2W.panelBg            // alpha(--color-v2-panel, 0.45)
backdropFilter:   blur(16px)             // + WebkitBackdropFilter
borderRadius:     18
border:           1px solid V2W.border   // alpha(--color-fg, 0.10) — a WHITE hairline
boxShadow:        0 18px 40px alpha(--color-shadow, 0.22)
```

The reason it exists as a Card **variant** rather than a page-local `<div>` is AGENTS.md non-negotiable 1: "anything with a border and a background is a Card… Never invent a plate colour." A page-local div with its own border is exactly the thing that rule is there to stop, so the second plate went into the primitive.

The reason the page needs a second plate at all is a product requirement recorded verbatim in three headers — Brandon, 2026-08-30: **"keep colors the same as the v2 version."** And the trap that requirement sets is spelled out at the top of the `V2` block in `src/design/theme.ts:137–156`:

> `T` deliberately maps v2's **names** onto v3's **values**, so on a page that must match v2 these four are traps: `T.cyan → #5b8cff` where v2 is `#219EBC` (a teal); `T.orange → #e0a44a` where v2 is `#FB8501`; `T.red → #e0645f` where v2 is `#EF4444`; `T.green → #22c55e` where v2 is `#8ECAE6` — **a LIGHT BLUE, not a green**.

So the page reaches for `V2.*` and `V2W.*` instead, which resolve to the `--color-v2-*` block in `tokens.css:324–371`. Three of those tokens duplicate a value already present under another name (`v2-cyan == cal-accent`, `v2-red == impact-high`, `v2-pos == cal-actual`) and the token file says that is deliberate: "A card title is not a calendar accent and the page's positive figure is not an econ 'actual'; they happen to agree today and must be free to move apart tomorrow." The block's own SCOPE note: *"this page only. Nothing else in v3 reads them, and no existing token changed value to make them exist. If v3 ever adopts v2's palette wholesale, this block is what gets promoted — and then deleted."*

`V2.text` / `V2.muted` are plain aliases of `T.text` / `T.muted` (`theme.ts:212–213`) because v3's are already `#e7ece9`, which is what v2's are. v2 has no grey secondary — "muted" there is white at an opacity — so the port carries v2's opacities rather than inventing a grey.

### The v2 palette, as tokens and hex

| Token (theme.ts) | Custom property | Hex (`tokens.css`) | Where it is used on this page |
|---|---|---|---|
| `V2.cyan` | `--color-v2-cyan` | `#6aa0ff` | every `CardTitle`, the picker trigger, Core values, CB checkpoint strikes, "The read:" lead-in, `btn` gradient |
| `V2.orange` | `--color-v2-orange` | `#ffd166` | `TitleTag` (BETA / NOT FINANCIAL ADVICE), PIVOT band, CB CHANGED, replay transport, Call Wall, the fallback board label |
| `V2.red` | `--color-v2-red` | `#ff6b7a` | every negative figure, EM Down, IB Low, Stop, error copy |
| `V2.green` | `--color-v2-green` | `#7fb0ff` | **one use only** — the Strategy card's "Confirmation triggers" section title. It is a light blue |
| `V2.pos` | `--color-v2-pos` | `#3ddc8e` | the page's actual positive/up: EM Up, IB High, Put Wall, HIT band, positive greeks |
| `V2.purple` | `--color-v2-purple` | `#b48cff` | the page-background glow's second radial |
| `V2.bg` | `--color-v2-bg` | `#0a0d10` | page canvas, and a faded econ row's plate |
| `V2.panel` | `--color-v2-panel` | `#0e1216` | base for the 45% / 72% / 97% panel washes |
| `V2.ink` | `--color-v2-ink` | `#071026` | ink on a solid fill — CB/CW/PW ladder tags, an active replay button |
| `V2.refresh` | `--color-v2-refresh` | `#3ddc8e` | the refresh button's success state + text glow |
| `V2.badgeInk` | `--color-v2-badge-ink` | `#071026` | ink on the econ calendar's solid TODAY badge |
| `V2.lightBlue` | `--color-v2-lightblue` | `#7fb0ff` | the embed-mode card radial |
| `LEVEL_COLORS.cb` | `--color-level-cb` | `#ffd166` | Core tag + the ladder's gold bar wash + the favourited star |
| `LEVEL_COLORS.cw` | `--color-level-cw` | `#4d8cff` | Call Wall tag / chip |
| `LEVEL_COLORS.pw` | `--color-level-pw` | `#ff5fa2` | Put Wall tag / chip |
| `CAL.accent` | `--color-cal-accent` | `#6aa0ff` | econ day separator + TODAY badge + PRE/AFTER earnings blocks |
| `CAL.actual` | `--color-cal-actual` | `#3ddc8e` | econ `A:` value |
| `CAL.forecast` | `--color-cal-forecast` | `#ffd166` | econ `F:` value |
| `CAL.high / medium / low / holiday / president / faded` | `--color-impact-*` | `#ff6b7a` / `#ffd166` / `mix(#2f6bff 45%, #0a0d10)` / `#c0c5c3` / `#b48cff` / `mix(#1e2630 70%, #0a0d10)` | the econ impact ramp and the stale-row plate |

Washes (`V2W`, `theme.ts:228–276`), all `color-mix()` over a token so they keep tracking it:

| Wash | Definition | Used for |
|---|---|---|
| `V2W.border` | `alpha(T.text, 0.10)` | every card edge, divider, tile border on the page |
| `V2W.panelBg` | `alpha(V2.panel, 0.45)` | THE CARD FILL — the frosted look *is* the translucency |
| `V2W.panelBgStrong` | `alpha(V2.panel, 0.72)` | econ header bar, the replay date select |
| `V2W.panelSolid` | `alpha(V2.panel, 0.97)` | the portal'd ticker-picker panel |
| `V2W.wash04 / wash05 / wash03` | `alpha(T.text, .04/.05/.03)` | button fills, row hovers, "The read" block |
| `V2W.star` | `alpha(T.text, 0.28)` | the picker's unfavourited ☆ |
| `V2W.scrollThumb` | `alpha(T.text, 0.12)` | the Premarket bullet list's scrollbar thumb |
| `V2W.spotRow` | `alpha(V2.cyan, 0.08)` | the ladder's spot row |
| `V2W.pickRow / pickRowHover` | `alpha(V2.cyan, .10/.15)` | picker active row and its hover |
| `V2W.todayRow` | `alpha(V2.cyan, 0.06)` | the econ TODAY day separator |
| `V2W.embedGlow` | `alpha(V2.lightBlue, 0.10)` | the `?embed=1` card radial |

`V2W`'s header carries a **do-not-do**: *"NOT here on purpose: anything that sits ON TOP of a coloured bar. The ladder's CB/CW/PW tags and the spot-price chip take a SOLID fill — a translucent plate lets the bar read through it and the label stops being legible. v2 does not make those translucent and neither may v3."*

---

## File map

| File | Lines | What it owns |
|---|---|---|
| `src/pages/Analysis.tsx` | 80 | the four-column grid, `alignItems: start`, the `?embed=1` effect, card order |
| `src/pages/analysis/kit.tsx` | 746 | `FS` type scale, `Label`/`Value`/`Stat`/`Row`/`CardTitle`/`CardNote`/`TitleTag`, `btn`/`btnSecondary`/`PillSelect`/`MoreLink`, `Placeholder`/`CardState`/`UpdatedStamp`, `CARD_H`/`AnalysisCard`, `signColor`, `numOr`/`fmtBig`/`fmtElapsed`, the ET clocks, `useLiveData`/`useGrace`/`useSecondTick`, `refreshStyle`/`useRefreshButton` |
| `src/pages/analysis/greeks.ts` | 206 | `accumulateChainGreeks`, `computeNetGreeks`, `computePeakGreeks`, `GREEK_SCALE`, `rowNearestAgo` |
| `src/pages/analysis/ib.ts` | 192 | `IB_OPEN_MIN`/`IB_END_MIN`, ET bar parts, `computeIb`, `computeIbRead` (day type + the six bias sentences) |
| `src/pages/analysis/TickerPicker.tsx` | 340 | `loadList`/`saveList`/`cleanSymbol`/`FAV_KEY`, the portal'd search menu |
| `src/pages/analysis/analysis.css` | 161 | `.cb-analysis-page` frame + two radials, `.analysis-embed`, the scrollbar pair, the `@media (max-width:899px)` collapse |
| `cards/MultiGreek.tsx` | 90 | peak strike per greek, 2×2 tiles |
| `cards/EstimatedMove.tsx` | 150 | weekly EM bands + distance to the nearer band |
| `cards/Premarket.tsx` | 122 | the five-bullet AI read + the /ES gap line |
| `cards/EconCalendar.tsx` | 524 | today's econ rows + woven earnings blocks (the `todayOnly hideToolbar` panel) |
| `cards/Confidence.tsx` | 360 | CB confidence score, band, three checkpoints, CB-change timer |
| `cards/NetGreeks.tsx` | 182 | four net totals, Δ15m / Δ30m, the last-session fallback |
| `cards/InitialBalance.tsx` | 255 | IB H/M/L, countdown, day type, bias sentence, statistical rules |
| `cards/TickerLevels.tsx` | 351 | Spot / Call Wall / Put Wall / Core for one symbol from two feeds |
| `cards/StrategyBuilder.tsx` | 342 | the daily AI plan. **Built but not mounted** — see Gotchas |
| `lookup/TickerLookup.tsx` | 1465 | the full-width card: two panes, replay, identity line, chips, the read |
| `lookup/Ladder.tsx` | 460 | `TlLadder` — the bar ladder, spot line, level tags, Δ 1D cell |
| `lookup/levels.ts` | 238 | `tlLevelsFrom` (walls/core/flip/net), `TL_*` window constants, `tlWindow`, `tlAtm`, `tlExpiryChip` |
| `lookup/replay.ts` | 179 | `TlReplayFrame`/`TlReplaySession`, `tlReplayRows`, `tlSessionAxis`, `tlTimelineOf`, `parseReplayFrames` |

---

## The page frame and the grid

`AnalysisPage` renders `<main className="cb-analysis-page">` containing one `div.analysis-grid`:

```
display: grid
gap: 14
gridTemplateColumns: embed ? '1fr' : 'repeat(4, 1fr)'
alignItems: 'start'
```

The header of `Analysis.tsx` states the invariant: *"Four columns, `alignItems: start`, with every small card at a FIXED 480px. That combination is what stops one card growing its whole row: a card that overflows scrolls inside itself. The two full-width cards span `1 / -1`."*

`.cb-analysis-page` (`analysis.css:24`) is v2's `homeShellStyle` + `homeContentStyle` collapsed into one frame:

```
display:flex; flex:1; min-height:0; flex-direction:column; overflow-y:auto
padding: clamp(14px, 2vw, 24px)
gap:     clamp(16px, 2vw, 32px)
background-color: var(--color-v2-bg)           /* #0a0d10 */
background-image:
  radial-gradient(circle at 15% 50%, color-mix(--color-v2-cyan 4%, transparent) 0%, transparent 50%),
  radial-gradient(circle at 85% 30%, color-mix(--color-v2-purple 5%, transparent) 0%, transparent 50%)
```

Those two radials are `V2W.glowA` / `V2W.glowB` written as CSS — v2's `shellGlow`, same values, same positions.

### Card order (top to bottom, left to right)

1. `TickerLookupCard` — full width (`span`), `height="auto"`. Sits FIRST because *"the symbol you type here is the page's entry point, so it leads rather than sitting under the card stack."*
2. `MultiGreekCard`
3. `EstimatedMoveCard`
4. `PremarketCard`
5. `EconCalendarCard`
6. `ConfidenceCard`
7. `NetGreeksCard`
8. `InitialBalanceCard`
9. `TickerLevelsCard`

---

## `AnalysisCard` and `CARD_H`

`CARD_H = 480` (`kit.tsx:~370`). Its comment is the rule:

> All eight cards under Ticker Lookup are exactly this tall — not "about" this tall, and not sized to their content… Without one fixed number the tallest card in a row sets that row's height and the three beside it sit in a box they do not fill, so the second row starts at a different y from the first and the board reads as ragged. A card whose content is longer than this scrolls INSIDE itself.

The height is applied as `height`, `minHeight` **and** `maxHeight` together — *"`height` alone is a suggestion to a flex item whose content overflows, and one card growing by a row is the whole reason this constant exists."*

**The `'auto'` sentinel is load-bearing** and carries the port's most explicit bug story (`kit.tsx:405–412`):

> ⚠ IT IS THE STRING `'auto'`, NOT `undefined`, AND THAT IS THE WHOLE POINT. This prop used to be `height?: number` with a `= CARD_H` default, and the two wide cards passed `height={undefined}` to mean "no height". A default parameter fires on an explicit `undefined` exactly as it does on an omitted one, so those cards silently got 480px and Ticker Lookup was clipped at the seventh rung with a scrollbar of its own — the bug this prop was added to fix, surviving the fix, because the opt-out was spelled as the thing that opts in.

A fixed card scrolls in its body (`overflowY:'auto'`); an `'auto'` card gets `overflow:'visible'` on the Card so its ladders are not clipped, and never scrolls itself — *"A scrollbar on the card as well as on the ladders inside it is two scrollbars for one gesture."*

Body padding is `16` (`12` gap when `span`, else `10`); `flush` drops padding entirely and is used only by the econ calendar, which paints edge to edge.

---

## The type scale, `FS`

v3's ramp is 9/10/11/13/15/18/24/32. v2's page uses fourteen sizes that "agree on almost nothing", so `kit.tsx` names them once. `check-theme.mjs` rule 4 bans a bare `fontSize:` number, and its own comment says anything that interpolates a scale constant is fine — `FS` is that constant.

| Key | px | What it sizes |
|---|---|---|
| `tag` | 9 | ladder level tags (CB/CW/PW), spot-price chip |
| `micro` | 10 | updated stamps, pill buttons, badges, the BETA tag |
| `small` | 11 | captions, picker rows, the replay bar, the disclaimer |
| `caption` | 12 | card notes, chip names, section titles, rule detail |
| `row` | 13 | ladder strike/value cells, the picker trigger |
| `body` | 14 | body copy — the bias sentence, "The read", level rows |
| `compact` | 16 | the panes' "Net GEX" stat, Strategy's entry/stop/target |
| `label` | 17 | `Label`, `CardTitle`, list items, the bias pill |
| `stat` | 18 | the three-up stat rows |
| `peak` | 20 | Multi Greek's peak strike |
| `value` | 21 | the default `Value` size |
| `lead` | 22 | Core, identity-line spot, the `$SYMBOL` |
| `chip` | 26 | a level chip's value |
| `tile` | 28 | a Net Greeks tile |
| `hero` | 34 | the Confidence score |

Kit primitives: `Label` is 17px/700, `.08em`, uppercase, `V2.muted` @ 0.7 opacity. `Value` is `var(--font-mono)`, weight 800, default 21px, default `V2.text`. `CardTitle` is 17px/800, `.08em`, uppercase, `V2.cyan`. `CardNote` is 12px mono, `V2.muted` @ 0.6. `TitleTag` is 10px/800, `.1em`, `V2.orange` @ 0.85. `divider` is `height:1; background:V2W.border; margin:'10px 0'`.

---

## The data path

**No socket.** `Analysis.tsx`'s header: *"NO SOCKET. Every value on this page is REST. The one live-ish feed is `useEsCandles`, behind the Initial Balance card, and it rides the shared socket through `data/esCandles.ts` — this page never touches a topic list."* That satisfies AGENTS.md non-negotiable 2.

**No canvas.** Nothing on this page carries `data-cb-layer`; every bar is a DOM element with a `width: N%`. `npm run perf` therefore has nothing to measure here.

### `useLiveData(url, refreshMs = 120_000)`

Every fetch on the page except Confidence, the replay calls and the board sweep goes through this hook. `kit.tsx` explains why it is not `data/api.ts`'s `useQuery` — three reasons, all parity:

1. the page stamps every card with the time of its last successful fetch (`lastUpdated`), which `useQuery` does not expose;
2. its error is the string v2 renders — `json.error` when the body carries one, else `HTTP {status}` — wrapped by `String(e)`, so it reaches the card with the `Error: ` prefix v2 shows;
3. it polls unconditionally. `useQuery` suspends polling on a hidden tab, which is better behaviour and a *different* behaviour; adopting it would change what the "updated" stamp means.

All requests carry `{ cache: 'no-store' }`.

**⚠ A null `url` leaves `loading` TRUE forever** — the guard returns before the `finally`. That is v2's, it is load-bearing for callers that gate on a second signal (Net Greeks reads the chain's loading flag instead; Strategy Builder checks its window first), and *"quietly 'fixing' it here would change which empty state those cards show."*

### Every endpoint on the page

| Endpoint | Caller | Cadence | Query params | Shape / notes |
|---|---|---|---|---|
| `/api/chains?ticker={SPX\|QQQ\|SPY}&range=all` | Multi Greek | 60 s | ticker, range | `{data:{items:[{expiration-date, strikes:[{strike-price, call{…}, put{…}}]}], underlyingPrice}}` |
| `/api/levels?ticker={ESU\|NQU\|SPX\|SPY\|QQQ}` | Estimated Move | 120 s (default) | ticker | `{close, em, up, down}` as strings |
| `/api/tt-quotes?symbols={/ESU26\|/NQU26\|SPX\|SPY\|QQQ}` | Estimated Move | **15 s** | symbols (URI-encoded) | `{data:{items:[{last, last-price, mark, mark-price, close}]}}` |
| `/api/premarket-summary` | Premarket card | 5 min | — | `{summary:{date, bullets[], generated_at}, error?}`. **Prefetched on rail hover** |
| `/api/es-gap?date={ET today}` | Premarket card | 120 s | date | `{date, gap:{prior_close, open_0930, gap_pts, gap_dir, pct_filled, filled}}` |
| `useEconCalendar` (`data/econCalendar.ts`) | Econ Calendar | that module's | `{withQuote:false, week:'both'}` | raw `fetch(…, {cache:'no-store'})`, **not** through `api.ts` — which is why the rail entry for `/economic-calendar` carries no prefetch |
| `/api/confidence?date={ET today}` | Confidence | 120 s, own loader | date | `{level, price\|spx, thresholds:{hitPts}, score:{hit,pivot,chop,break}, mvcTimeline:[{strike,from,to,touched,outcome}]}` |
| `/api/snapshots/greeks?date={today}&limit=5000` | Net Greeks (SPX) | 120 s | date, limit | `{rows:[{timestamp,gex,dex,chex,vex,date}]}` ascending |
| `/api/snapshots/greeks?limit=1` | Net Greeks fallback | 60 s | limit | newest-first, one row |
| `/api/chains?ticker={QQQ\|SPY}&range=all` | Net Greeks (non-SPX) | 60 s | ticker, range | live chain instead of a stored series |
| `/api/snapshots/candles?date=…&interval=5&limit=2000&lite=1` and `?daysBack=20&limit=20000&interval=5&lite=1` | Initial Balance via `useEsCandles(true)` | once + socket `esCandles` frames | date/daysBack/interval/limit/lite | columnar `{cols, rows:[[…]]}` |
| `/proxy/walls?date={today}` | Ticker Levels | 120 s | date | `{ok, date, tickers:[{symbol, spot, call_wall, put_wall, cb}]}` |
| `/proxy/scanner?any=1&limit=200` | Ticker Levels | 120 s | any, limit | `{ok, rows:[{symbol, date, stale, expiry, spot, call_wall, put_wall}]}` |
| `/proxy/scanner-tickers` | Ticker Levels via `useScannerTickers` | once | — | `{tickers:[…]}`; falls back to the static `SCANNER_TICKERS` on failure |
| `/api/chains?ticker={sym}` | Ticker Lookup, left pane | 60 s | ticker | the base chain — all expirations, default range |
| `/api/expirations?ticker={sym}` | Ticker Lookup, right pane | **900 s** | ticker | `{data:{items:[{expiration-date}]}}` — *"a listing changes on the day a new weekly is added, not minute to minute"* |
| `/api/chains?ticker={sym}&expiration={exp}&range=all` | Ticker Lookup board sweep | 120 s, **one call per expiration** | ticker, expiration, range | 6 in flight (`BOARD_CONCURRENCY`) |
| `/api/eod-strike-gex-change?symbol={sym}` | Ticker Lookup Δ 1D | **3 600 s** | symbol | `{ok, symbol, date, prevDate, rows:[{strike, netGex, prevNetGex, chg, hadPrev}]}` |
| `/proxy/strike-growth/replay-meta?symbol={sym}` | replay session list | once per (replayOn, sym) | symbol | `{dates:[…]}` |
| `/proxy/strike-growth/frames-by-expiry?symbol={sym}&date={d}` | replay frames | once per (symbol, session) | symbol, date | `{ok, expiries:[…], frames:[{ts, spot, cells:[[expiryIdx, strike, net, vol]]}]}` — positional |
| `/api/strategy` | Strategy Builder (unmounted) | 5 min, gated | — | `{strategy:{date, plan{…}, generated_at}, error?}` |

### Prefetch

`Shell.tsx:285` fires `item.prefetch?.forEach((u) => preload(u))` on `onPointerEnter` of the rail link. For `/analytics` that is exactly one URL, `/api/premarket-summary` — the Premarket card's feed, which is cheap and unconditional. Nothing else is warmed, because every other entry fetch on this page is keyed on a symbol the click has not chosen yet.

### Failure behaviour

- `useLiveData` sets `error = String(e)` and **keeps the last good `data`**; the poll continues. A blip therefore never blanks a card that already painted.
- A `res.ok === false` becomes `new Error(json?.error || 'HTTP ' + res.status)`.
- Ticker Lookup's board sweep counts failures rather than throwing: *"One dead expiry must not blank the board — count it out and say so in the header rather than throwing the whole sweep away."* The header then reads `… of N listed — K chain call(s) failed`.
- `useScannerTickers` keeps the build-time fallback list on any failure — *"a dead proxy degrades to a stale picker rather than an empty one."*
- The replay fetches set `replayErr` strings and render them inline in the dock.

---

## Card: Ticker Lookup (full width, `height="auto"`)

Parts C–G of the parity doc. The largest surface on the page and the only one with replay.

### Two panes, one ticker

- **LEFT — one expiration.** Built from `/api/chains` + `accumulateChainGreeks()`, *"the exact same function the Multi Greek card uses, so the per-strike numbers here and up there can never drift apart."*
- **RIGHT — THE WHOLE BOARD, MINUS 0DTE.** The real listing from `/api/expirations`, then **one `/api/chains` call per expiry** with `&range=all`, through the same function, summed per strike.

**Why not `/proxy/gex-by-strike-multi`, which returns exactly this ladder** — the header records the failure in full: that sweep is ThetaData-sourced; for SPX it is fine, for single names it comes back sparse — most near-spot strikes carried no OI, so the ladder printed three-figure GEX at the money and its Core landed on a far wing strike (*NVDA at 218 spot: Core 335, flip 59.77, every near-spot bar red, while the Options Chain page's ⅀ Total for the same name and session was strongly positive*). Two surfaces, same label, different answers. Reading the same TastyTrade chain the rest of the app prices off makes Ticker Lookup and the Options Chain agree by construction.

**Cost:** one request per expiration instead of one per board. **No cap** — *"'All expirations' has to mean all of them; a quarterly 300 days out is exactly the kind of strike that parks a wall the front weeklies never show. The cost is paid by refreshing slowly and on the ↻ button instead of by dropping expiries."*

**Why ex-0DTE, always:** same-day gamma dwarfs the rest of the board and decays to nothing by the close, so a board that included it printed walls that were really just today's pin. The 0DTE view is one click away on the left pane's expiry pills.

### Where the symbol comes from

`usePageSymbol()` — the toolbar. The card's own dropdown was **deleted**:

> This card had its own dropdown, which made it the one surface where the symbol on screen could disagree with the symbol in the toolbar — and on the Replay hub, where the GEX-levels tab sits beside three other replays that all follow the board, that disagreement was the whole bug.

The QUICK row (`['SPX','SPY','QQQ','NVDA','TSLA']` plus recents) is **not** a second source: its buttons call `lookup()`, which calls `setPageSymbol(s)` — so pressing one moves the toolbar too. `forget` went with the picker; recents are append-only now, capped at 8, stored at `localStorage['analytics.tickerLookup.recent']` as a `string[]`, read in an effect (not a `useState` initializer) so the first client render agrees with the server's.

Changing the symbol clears the pinned expiry (`useEffect(… , [sym])`) — *"A new ticker has a different expiry board, so the pinned expiry cannot survive the change."*

### Constants

| Constant | Value | Why |
|---|---|---|
| `LOOKUP_KEY` | `'analytics.tickerLookup.recent'` | recents key |
| `QUICK` | `SPX, SPY, QQQ, NVDA, TSLA` | quick row |
| `BOARD_REFRESH_MS` | `120_000` | the board is one call per expiry, so it polls slowly |
| `BOARD_CONCURRENCY` | `6` | the only throttle on an uncapped sweep. *"The server-side sweep uses four; this runs from one browser, not the VPS"* |
| `ANCHOR_SLACK` | `5` strikes | how far spot must walk before the ladder re-anchors |
| `CHIP_MIN_H` | `106` px | 14 label + 24 value + 15 + 15 + gaps + padding + border |
| `PANE_CHROME_H` | `24+20+64+18+40+CHIP_MIN_H` = `272` px | everything in a pane that is not the ladder |
| `SPLIT_MIN_H` | `PANE_CHROME_H + 20 + (10*2+1)*26` = `838` px | ten rungs a side plus the spot row, with no scroll on open |
| `TL_LADDER_SIDE` | `20` | rungs each way from the anchor in the window. Ten a side *"cropped walls that were still in play on a wide-strike name"* |
| `TL_LADDER_VIEW_SIDE` | `10` | rungs that must be visible the moment the card paints |
| `TL_ROW_H` | `26` | 18px content + 2px padding a side + 1px border a side + the 2px gap |

The split is `display:grid; gridTemplateColumns:'1fr 1fr'; gridTemplateRows:'minmax(0,1fr)'; gap:14; height: clamp(838px, 86vh, 1500px)`. The comment: *"minmax(0,1fr) + minHeight:0 on each pane is what actually hands the overflow to the ladder scrollers. A grid item's automatic minimum size is its CONTENT — without it the panes ignore the fixed height, grow to the full ladder, and paint straight over 'The read'."*

### `useTlAnchor` — the anti-judder hook

Spot quantised to a strike that only moves once spot has walked `ANCHOR_SLACK` rungs. Everything that would make the ladder *move* — the window slice and the scroll centring — reads the anchor; the dashed spot line and the level chips keep reading the real spot. *"It is the paper underneath that stops sliding."*

The ref is settled **during render** on purpose: *"The anchor is a pure function of (rows, spot, resetKey) plus its own previous value, and re-running it lands on the same strike — so there is nothing for an effect to schedule, and an effect would only add a paint at the old scroll position before correcting it."*

Reset keys are `${sym}|L|${leftAxisKey}|${replayOn?'r':'l'}` and `${sym}|R|${boardAxisKey}|…`.

### `tlLevelsFrom` — walls, core, flip, net

`levels.ts:37`. Computed off the **FULL ladder, not the drawn window**: *"A wall two hundred points out is still the wall; cropping first would invent a nearer one and the card would confidently name a level that is not there."*

- `callWall` = the strike with the **highest positive** GEX anywhere on the ladder
- `putWall` = the strike with the **most negative** GEX anywhere
- `core` (CB) = the strike with the highest `|GEX|`
- `net` = Σ GEX over every row, in raw dollars

**The CB collision rule.** Core is the highest `|GEX|` strike, so it *is* whichever wall sits on its own side of zero. Left alone the card prints one level twice and two tags stack on one ladder row. The colliding wall steps down to the **second** strike on its side — which is why the loop tracks `callWall2` / `putWall2`. Core has one sign, so only one wall can ever collide; the other is untouched.

**Gamma flip** — a port of `server-v2/computation/gex-calculator.js findGexFlip()`, which is what `/proxy/gex`, the EOD recorder and every other GEX surface mean by "flip". Two things it does that a naive sign-change scan does not:

1. **Only the negative→positive crossing counts.** Cumulating from the lowest strike up, dealer gamma starts short (the put wing) and turns long; that one turn is the flip. A later positive→negative dip out in the call wing — one fat short-gamma strike — is NOT a flip, *"and catching it printed a level hundreds of points above spot."*
2. **It needs a spot.** No spot, no flip.

Interpolated: `flip = prevK + (r.strike − prevK) × (−prevCum / (cum − prevCum))`, falling back to `r.strike` when the range is zero. Units: strike price.

### `tlAtm` — the ATM straddle

For the picked expiry: find the strike nearest spot, then `move = call.mark + put.mark` (points) when either is > 0, and `iv = mean of the positive of {call['implied-volatility'], put['implied-volatility']}` (a fraction; rendered `×100` to one decimal as a %). Rendered as `± Move ±{move.toFixed(2)} · ATM IV {(iv*100).toFixed(1)}%`, or `—` for either. *"the expected move the options are actually priced for, not an IV-derived approximation."*

### `tlWindow` / `tlNearestIdx`

`tlWindow(rows, anchor)` slices `±TL_LADDER_SIDE` rungs off the anchor's **index**, not a point distance — *"a $2.50-wide chain and a $5-wide chain both give twenty rungs a side"* — then re-sorts high→low "like a DOM".

### Right-pane fallback

If the board sweep has produced nothing (`boardRows.length === 0`), the pane falls back to the front expirations the base `/api/chains` payload already carried, with today dropped so the fallback obeys the same ex-0DTE rule, summed per strike. `accumulateChainGreeks` takes one expiry at a time, so the maps are merged at the call site *"rather than growing a second formula."*

### The Δ 1D column

One call per ticker on a **1-hour** poll: `/api/eod-strike-gex-change?symbol=…`. It is a daily series (the recorder writes once at 16:05 ET), so the ↻ button does not refetch it. **The backend has already differenced the two most recent snapshot dates; nothing on the page does arithmetic on GEX.**

Two gates:

- `chgOk` requires `resp.ok === true` **and** `resp.symbol.toUpperCase() === sym` **and** at least one row. *"A ticker switch leaves the previous name's Δ in state for a beat, and a stale Δ hung off a fresh ladder is worse than no Δ at all — the strikes overlap often enough (SPY 600 / QQQ 600) that it would silently render as real."*
- `chgBaseline = resp.prevDate` — null until a **second** session lands. *"With one snapshot every chg is 0 by construction, and a column of zeros reads as 'the board didn't move' rather than 'we don't know yet'."*

The column is passed **only to the right pane**: the recorder snapshots the board, so hanging a board-level Δ off the left pane's single-expiry ladder would print a change that does not belong to the number beside it.

### Replay

Toggle: the `⏱ Replay` button (`V2.orange` fill, `V2.ink` text when on). Its title: *"Replay — scrub both ladders back through a recorded session (recorded walls only, ~5 trading days)"*.

`replay.ts`'s header states what is and is not recorded, because it shapes the UI:

- the recorder stores the **top N strikes per side per expiry per sweep**. It is a record of the WALLS, not the whole ladder — a strike that was never a wall renders `—`, **NOT 0**. ("Not recorded" and "no gamma here" are different answers.)
- **Only GEX is recorded.** ± Move and ATM IV are priced off live marks, so they read `—` while rewound rather than putting today's premium on a three-day-old ladder.
- the **Δ 1D column is an END-OF-DAY series**, so it is hidden entirely while rewound, along with its caption.
- cadence is the recorder's sweep (2 min hot lane / 5 min full roster); retention is about **five trading days**.

Transport controls, all in the page-level `ReplayDock` (in flow at the bottom of the page, not an overlay — *"That matters here specifically: the ladders look exactly like the live ones, so 'recorded walls only' has to be readable or an em-dashed rung reads as a broken card"*):

| Control | Behaviour / default |
|---|---|
| session `Select` | `replayDate`, defaults to `dates[0]`. Changing it stops playback and clears the axis lock |
| session count | `"1 session"` / `"N sessions"` — *"a dropdown with three entries and no explanation reads as a broken fetch rather than as the limit it is"* |
| ◀ / ▶ step | one minute; disabled at the ends |
| ▶ / ❚❚ | playing from the last step rewinds to 0 first — *"Playing from the end shows one step and stops, which reads as broken"* |
| range slider | `accentColor: V2.orange`, `flex:1; minWidth:180; height:3` |
| Speed | `TL_REPLAY_SPEEDS = [0.5, 1, 2, 4, 8]`, default `1`. Interval is `TL_REPLAY_BASE_MS / speed` with `TL_REPLAY_BASE_MS = 700` ms |
| 🔒 Axis (`ReplayLock`) | default off. Locks **both** the window (feeds `useTlAnchor` a null spot, so it holds) **and** the bar scale (`lockedMaxRef`) |
| clock | `HH:MM ET`, 24-hour, `America/New_York`; plus `idx+1 / N` |

Playback **stops at the last step rather than looping** — *"a session that silently restarts reads as the tape jumping backwards."*

`lockedMaxRef` is a ref written during render on purpose: *"it is written during render from values this render already has, and setting state here would be a render loop. Reading it back on the same pass is what makes the FIRST locked frame use the scale you were looking at when you pressed the button."*

The frame chosen for a clock is **the last sweep at or before it** (`cutoff = replayClock + 59_999`) — step-hold, never a future reading.

The ladder **axis is the SESSION's, not the frame's** (`tlSessionAxis`): *"The recorder stores the top N strikes a side per sweep, so a frame-built ladder gains and loses rungs on every step and the whole thing shakes under the reader while it plays. Fixed for the session, it is one ladder with values changing on it."* Both axes are memoised on the session and keyed by **joined strings**, because the expiry arrays are rebuilt each render and their identity would defeat the memo.

The frames payload is **positional** — `cells: [expiryIdx, strike, net, vol]` with `expiries` as the index table — *"because a day of sweeps repeated as objects is several megabytes of key names."*

The board sweep is **paused while rewound**: *"Rewound, none of it is on screen, so it is paused rather than hammering the proxy for a pane that is showing a recording. The cheap chain/listing polls stay on so leaving replay does not blank the card."*

`viewSpot` while rewound is the spot **recorded at that sweep** — the live quote would put today's price on a past session's ladder. DTE labels count from `replayBase = replayDate` for the same reason: *"off today it would label the wrong one."*

Leaving replay, or switching ticker, drops the session, the index, playback, the error **and the axis lock** — *"A window and a scale frozen on one symbol's session mean nothing on the next one's."*

### `ReplayBrand`

Rendered inside the split (`position:relative` on the split is for it) when replay is on, so a screen capture of a rewound ladder carries whose it is.

### The identity line

Sits **below** the transport and **directly on top of the ladders**, not in the card header:

> It sits HERE… because this is the line a screen capture has to contain. Cropping to the ladders now picks it up; in the header it was one scroll or one crop away from being left out. It also reads in the right order: the controls change what is drawn, this states what got drawn.

Contents, left to right: `Ticker Lookup` (17px, cyan, uppercase) · `$SYM` (22px) · `GEX levels` (12px mono, 0.6) · spot (22px `Value`) · the gamma pill · then a mono run of `sym · {expiry chip} · {session date} · {clock ET}` joined with ` · `.

The gamma pill reads **`Positive gamma`** (`V2.pos`) or **`Negative gamma`** (`V2.red`), bordered, `borderRadius:999`, driven by `rightLevels.net >= 0` — *"the whole board is the regime that actually governs how dealers hedge."*

### The level chips

`CHIP_ROW` is `repeat(auto-fit, minmax(150px, 1fr))`, `gap:8`, `marginTop:'auto'` — pinned to the bottom of the pane so the two panes' chip rows line up at the same y however many rungs their ladders have. Each chip is `minHeight: CHIP_MIN_H` (106) with every line clipped to one line, so all three are the same height.

| Chip | Colour token | Note |
|---|---|---|
| `Core (CB)` | `LEVEL_COLORS.cb` `#ffd166` | `biggest magnet` |
| `Call wall` | `LEVEL_COLORS.cw` `#4d8cff` | `ceiling` |
| `Put wall` | `LEVEL_COLORS.pw` `#ff5fa2` | `floor` |

Distance line: `at price` when the gap is exactly 0, else `{|value − spot|} above` / `below`. **The flip is NOT a chip** — it lives only in "The read".

### The read

A `V2W.wash03` block, 14px, line-height 1.6, opening with `The read: ` in `V2.cyan` bold, then verbatim one of:

> `Net positive gamma across the board — dealers sell rallies and buy dips, so price tends to pin and mean-revert. `

> `Net negative gamma across the board — dealers chase in both directions, so moves extend and volatility feeds itself. `

followed by, when non-null: `Core magnet {n}. `, `Call wall {n}. `, `Put wall {n}. `, `Gamma flip {n} — pinning above, trending below.`

### The disclaimer line (11px mono, opacity 0.45)

Live: `OI+Vol basis · left pane shares Multi Greek's formula · right pane is the server full-board sweep · educational only, not investment advice`

Rewound: `OI+Vol basis · recorded strike_growth sweeps for {date} · walls only, not the whole ladder · educational only, not investment advice`

### `boardLabel` — every variant, verbatim

| State | Text |
|---|---|
| live, full board | `{N} expiration(s) · excl. 0DTE · whole board` |
| live, some calls failed | `{ok} expirations · excl. 0DTE · of {listed} listed — {listed-ok} chain call(s) failed` |
| live, sweeping | `sweeping the board…` |
| live, fallback | `{N} front expirations · excl. 0DTE · full board unavailable` — painted **`V2.orange` at 0.85 opacity**, because *"a fallback must never read as the whole board"* |
| rewound, has cells | `{N} expiration(s) · excl. 0DTE ({zeroDte}) · recorded walls only` |
| rewound, sweep empty | `no expirations past 0DTE in this sweep · {N} recorded this session` |
| rewound, nothing | `no recorded expirations past 0DTE this session` |

The count is **the expiries that actually put a cell into the profile on screen**, not the session's recorded list, *"and the session count would then describe the recording rather than the ladder beside it."*

### Δ 1D caption (live only)

- `Δ 1D vs close {prevDate}`
- `Δ 1D — first snapshot recorded, baseline lands next session`
- `Δ 1D — no end-of-day history yet`

### Empty / gate states

| State | Text |
|---|---|
| live, no chain | `No live option chain for {SYM}.` |
| rewound, no ladder | `No recorded ladder for {SYM} on {date}.` |
| left pane, live | `No populated strikes on this expiry.` |
| left pane, rewound | `Nothing recorded on this expiry in this session.` |
| right pane, live | `No board-wide ladder yet (nothing listed past 0DTE).` |
| right pane, rewound | `Nothing recorded past 0DTE in this session.` |
| replay meta empty | `No recorded sessions for {SYM}.` |
| replay meta failed | `Could not load recorded sessions.` |
| replay frames empty | `No recorded frames for {SYM} on {date}.` |
| replay frames failed | `Could not load frames.` |
| dock hint while playable | `· recorded walls only · sweeps held to the minute · ± Move, ATM IV and Δ 1D off while rewound` |

### The refresh button

`useRefreshButton` from `kit.tsx`: locked while running, reverts to `idle` after **1800 ms**. Labels: `↻ Now` → `↻ Refreshing…` → `✓ Refreshed` / `✗ Failed`. Colours by state come from `refreshStyle()` — success `V2.refresh` with a `0 0 12px` text glow, error `V2.red` with the same, idle `alpha(V2.cyan, 0.4)` edge over `alpha(V2.cyan, .08)`. On this card it fires all three at once: `Promise.all([reloadChain(), reloadExps(), loadBoard()])`. Its title: *"Re-fetch the chain, the listing and the whole-board sweep"*.

---

## `TlLadder` — the ladder renderer

`lookup/Ladder.tsx`. DOM, not canvas. Bars run out from a centre rail: **+GEX right, −GEX left**.

The rule at the top of the file:

> A LEVEL IS SAID ONCE, by a named tag beside its strike (CB / CW / PW). The row behind it is not tinted and the bars are not outlined — both fought the one thing the bars exist to say, which is magnitude and sign. A strike that is two levels at once could only ever wear one of the wash colours, which made the wash a worse copy of the tags beside it.

**The Core is the one level that also marks its bar.** `CB_WASH_POS` / `CB_WASH_NEG`:

```
CB_GOLD = var(--color-level-cb)                                  #ffd166
CB_FILL = color-mix(in srgb, var(--color-level-cb) 85%, transparent)
CB_FADE = color-mix(in srgb, var(--color-level-cb)  0%, transparent)
CB_STOPS = `${CB_GOLD} 0%, ${CB_FILL} 55%, ${CB_FADE} 82%`
CB_WASH_POS = linear-gradient(90deg, CB_STOPS)     // +GEX grows right: gold at the left edge
CB_WASH_NEG = linear-gradient(270deg, CB_STOPS)    // −GEX grows left:  gold at the right edge
```

Why not a flat gold fill — *"it buries the sign. A red core bar and a blue core bar would render as the same gold stripe, and the sign is half of what the bar says. So the gold is held at the bar's ROOT — the centre rail, where the eye lands and where every bar starts — at full strength, then at 85%, then out before the tip. The tip is bare sign colour."* `CB_FADE` fades to gold-at-zero, not `transparent`, because *"a ramp through grey reads dirty."* Same stops (0 / 55 / 82) as the Multi Greek ladder, its replay, and the option chain's `levelFillBg()`.

CW and PW keep the tag-only rule: their colour IS a direction (blue ceiling, red floor) and would fight the bar's own sign. Gold carries no direction.

### Layout

- Columns: `'132px 1fr 68px'`, or `'132px 1fr 68px 66px'` when the Δ column is on. The strike column is sized for the **widest it ever gets** — a five-digit strike and two level tags — *"A narrower column made the tags wrap and a single strike took two rows."*
- Row: `padding:'2px 6px'`, `borderRadius:8`, `gap:8`, plus the 2px column gap = `TL_ROW_H` 26px.
- Bar height 14px; the centre rail is a `1×18` `V2W.border` sliver.
- Bar width: `pct = max(2, |gex| / maxAbs × 100)` — *"Floor of 2% so a tiny non-zero strike still shows a sliver."* `maxAbs` is `scaleMax` when the axis is locked, else this ladder's own peak.
- Spot row: `border: 1px solid V2.cyan`, `background: V2W.spotRow`, strike weight 800 and cyan.
- Level tags: 9px/800, solid `m.color` fill with `V2.ink` text. *"Named tags, not anonymous dots. Three dot colours is a legend to memorise; 'CB' is not."*

### Auto-centre

An effect parks the anchor row in the **middle** of the pane, measured with `getBoundingClientRect` and not `offsetTop` — *"the scroll wrapper is position:static, so offsetParent is some ancestor Card and offsetTop would be measured against the wrong box."* It centres on the **anchor**, not on spot: *"Rewound, spot moves every frame and re-centring on each move is exactly the jitter this pane used to show."* It bails when `scrollHeight - clientHeight <= 0`. Dependencies are `[spotStrike, windowKey]` — it re-centres when the ticker/expiry changes the window or when spot walks to a new anchor strike, **not on every tick**.

### The spot line

One dashed 1px `V2.text` line straight across the ladder, at the **price** rather than on the nearest rung — *"the lit row says which strike price is closest to, the line says where inside that strike it actually is — the difference between '769, roughly' and '769.9, leaning on 770'."* Its chip is a **solid** `V2.panel` plate, 9px mono, two decimals, *"because this chip sits on top of the bars."*

Position is **derived during render, never state fed by an effect** — *"an effect would paint the line one commit behind the spot it is labelled with, and during replay it would visibly trail."* Row pitch *is* measured off the DOM (rows carry padding and a border, so a guessed px-per-row drifts) but as `(lastCentre − firstCentre) / (n − 1)` so nothing compounds, via a `ResizeObserver` in `useLayoutEffect`, and the state is identity-stable unless it moved more than 0.5px / 0.01px — *"so a ResizeObserver tick cannot re-render the whole ladder for a sub-pixel reflow."*

Spot's continuous row index is interpolated between the two strikes that bracket it (`pos = i−1 + (hi − spot)/(hi − lo)`), pinned to row 0 above the top rung and to `n−1` below the bottom one.

**No CSS transition on the line** — *"Replay already eases spot frame by frame; a transition on top of that restarts every frame and the line ends up permanently trailing the price written on it."*

### The Δ 1D cell

`undefined` → `—`, muted at 0.5 opacity, title `no end-of-day snapshot for this strike`. A reading of **exactly 0 paints white** (`V2.text`) — it moved nowhere, which is information. Non-zero: `V2.pos` / `V2.red`, title `{fmtBig(chg)} vs prior session close`.

A recorded fix, not a transcription:

> `fmtBig` ALREADY signs its output. v2 prepended a second sign here and in the cell below, so a +1.2B change read `++1.2B` and a −840M one read `−+840M`. Fixed rather than transcribed (`docs/parity/replay.md`, open decision 1) — and fixed the same way in both places, so the Δ column signs exactly like the Value column beside it.

An unrecorded (replay `missing`) strike draws **no bar at all** and `—` in Value, title: `not recorded in this sweep — the recorder stores the walls, not every strike`.

---

## Card: Multi Greek

Part I. `AnalysisCard` at 480px. Title `Multi Greek`, note `peak strike`.

**Control.** `PillSelect` over `['SPX','QQQ','SPY']`, default `SPX`, state is component-local `useState` — not the query string, not localStorage.

**Feed.** `/api/chains?ticker={tk}&range=all` on a **60 s** poll.

**Derivation.** `computePeakGreeks(payload)` → per greek, the strike carrying the largest `|value|`. The per-strike arithmetic is `accumulateChainGreeks` (`greeks.ts:81`), and its header is the most important comment in the port:

> ⚠ DELIBERATELY NOT `board/chainGex.ts`… `chainGex.ts` implements the SERVER's definitions (call wall = the largest positive OI+VOL strictly ABOVE spot; put wall = the most negative strictly BELOW). v2's Analytics page does not do that… On a board where the biggest call wall sits below spot — which happens on a hard down day, and is exactly when someone is looking — the two definitions return different strikes. Reusing `chainGex.ts` here would have been the single easiest way to ship a page that looks finished and prints a different Call Wall from the one v2 printed.

The formulas, per strike, with `S = data.underlyingPrice` and `cnt(leg) = parseInt(open-interest) + parseInt(volume)`:

```
gex  += ( call.gamma·cc −  put.gamma·pc) · S² · 0.01 · 100      // $ per 1% move
dex  += (|call.delta|·cc − |put.delta|·pc) · S   · 100           // $
chex += (−call.theta·cc  +  put.theta·pc) · S    · 100           // $
vex  += ( call.vega·cc  −  put.vega·pc)  · S     · 100           // $
```

A strike where **both** counts are zero is **skipped**, not added as a zero — *"Skipping it rather than adding a zero keeps it out of the ladder entirely."* Any absent, blank or non-finite greek reads as 0, never NaN. Note the sign conventions: DEX uses `|delta|` on both legs, CHEX flips theta's sign.

v2 folds OI and volume into ONE count and multiplies once; by linearity GEX agrees with `oi-term + vol-term`, but the zero-skip and the DEX/CHEX/VEX terms are this file's own and have no upstream equivalent.

**Render.** A 2×2 grid, each tile `1px V2W.border`, `borderRadius:10`, `padding:10`. `Label` reads `{GEX|DEX|CHEX|VEX} · peak strike`; the strike is 20px (`FS.peak`) and **coloured by the sign of its value** — *"the number says where, the colour says which way it leans"* — with `fmtBig(value)` under it at 17px, 0.7 opacity, mono.

**Empty.** `No live chain for {tk}.` when no greek resolved a peak.

---

## Card: Estimated Move

Part J. Title `Estimated Move`, note `weekly`, plus a `MoreLink` to `/app/em` (a plain anchor out of the SPA — v2's page, since v3 has no Next router).

**Control.** `PillSelect` over `['ESU','NQU','SPX','SPY','QQQ']`, default `SPX`, local state.

**Feeds.** `/api/levels?ticker={tk}` at the 120 s default, and `/api/tt-quotes?symbols={QUOTE_SYMBOL[tk]}` at **15 s**. `QUOTE_SYMBOL` maps `ESU → /ESU26`, `NQU → /NQU26`, and the three cash names to themselves — *"the proxy resolves /NQU26 to the live contract."*

**Spot resolution**, in order: `item.last` → `item['last-price']` → `item.mark` → `item['mark-price']` → `item.close`; then `close` (the stored weekly close) then `midpoint = (up + down) / 2`. A zero or blank quote **is not a spot** — it is rejected and falls back to the midpoint *"rather than dividing the percentage by it."* The label says which source won: `Spot` (live), `Close` (stored), `Mid`.

**Derived numbers** (points):

```
distUp   = up − spot
distDown = spot − down
nearerUp = distUp <= distDown
near     = nearerUp ? distUp : distDown     // signed: >0 not yet reached, <0 through it
crossed  = near < 0
pct      = |near| / spot × 100              // two decimals
```

**Render.** Three `Stat`s at `FS.stat` 18px — `EM Up` (`V2.pos`), the spot label, `EM Down` (`V2.red`) — a divider, then `Distance to nearer band (Up|Down)[ · crossed]` over the points value (`V2.red` when crossed else `V2.pos`, prefixed `-` when crossed) and the percentage at 14px muted.

**Stamp.** From the LEVELS fetch, **not** the 15 s quote — *"the bands are what the card is about, and a stamp that ticked every 15 seconds would claim the EM was refreshed when only the price was."*

**Empty.** `No published EM for {tk}.`

---

## Card: Premarket

Part K. The AI five-bullet read of the global pre-market tape, written daily by the VPS cron (`premarket-summary-generator.js → premarket_summary`). **The page never calls a model; it reads the stored row.**

**Feeds.** `/api/premarket-summary` on a **5 min** poll (and the rail's prefetch), plus `/api/es-gap?date={ET today}` at the 120 s default.

**Staleness is the whole trick.** `nextPremarketDate()` (`kit.tsx`) computes the next session; anything whose `summary.date` is not that date is stale and shows the "coming at 8am" message instead of itself — *"Friday's read on a Monday pre-open, or yesterday's after the 16:00 close."*

`nextPremarketDate()` rolls forward when ET minutes ≥ 16×60 or the day is Sun/Sat, then skips weekends. Its anchor is v2's and is transcribed rather than corrected:

> The `-05:00` is v2's, and it is EST year-round where the session may be EDT. The noon anchor absorbs the hour so the date never lands on the wrong day. Transcribed rather than corrected: changing it is a behaviour change and belongs in its own commit, not inside a parity port.

**Render.** A `<ul>` at `paddingLeft:18`, gap 7, 17px (`FS.label`), line-height 1.45, `V2.text`, scrolling with `scrollbarColor: V2W.scrollThumb transparent`. Below it, when `gap_pts` exists: a divider then `/ES gap: {±gap_pts.toFixed(2)} pts ({(gap_pts/prior_close×100).toFixed(2)}%)` at 14px mono, muted @0.8, with the number in `V2.pos` / `V2.red`.

> Note the test is `> 0`, so a dead-flat zero gap paints red. v2's behaviour.

**Error handling.** The `CardState` receives `error ?? data?.error ?? null` — both the transport error *and* the route's own error field, because *"the generator reports a failed run in the body with a 200."*

**Empty, verbatim.** `Summary will be up at 8:00 AM Eastern.` — *"Shown before 08:00, after the 16:00 close, at weekends, and whenever the stored summary belongs to a session that has already been and gone."*

**Note chip.** The stale date (`nextDate`) when stale, else `summary.date`.

---

## Card: Economic Calendar

Part L. `AnalysisCard flush` — it paints edge to edge.

v2 mounts its full `EconCalendarPanel` here with `todayOnly hideToolbar`, so this card is that panel in its narrowest configuration: **TODAY only, no filter dropdown, no refresh button, no quote.** The DATA is already v3's — `data/econCalendar.ts` carries the fetch, the bucketing, the staleness rule and the impact ramp, shared with the board's own calendar card. Only the RENDERER is here, because v2's markup for this panel is specific: a **62px time gutter**, a **3px left border** in the impact colour, a horizontal gradient wash that **fades out by 35%**, and earnings rows **woven into the day** rather than listed under it.

**The filter trap**, verbatim from the header:

> WHAT `hideToolbar` TAKES AWAY, and what it does not: the filter menu is gone from the UI but the FILTER IS STILL APPLIED. The fixed set is `{all-usd, trump, earnings}`, so this card shows every USD event, every presidential item, and earnings — and silently drops non-USD High/Medium/Low events. That is v2's behaviour and it is easy to mistake for missing data.

**Hook.** `useEconCalendar({ withQuote: false, week: 'both' })`. Its fetch is a raw `fetch(…, {cache:'no-store'})` and not through `api.ts` — which is why the rail entry for `/economic-calendar` deliberately carries **no prefetch** (*"a warmed api cache would never be read back — an unused request on every hover. Give it one the day that hook moves onto api.ts."*)

**Header bar.** `padding:'5px 10px'`, `V2W.panelBgStrong`, `blur(16px)`, `zIndex:30`. Text: `Economic Calendar` (10px, `.12em`, uppercase, 700) then today's ISO date at 0.6 opacity. **No 📅 emoji** — *"that belongs to the toolbar-visible form."*

**Owner-only diagnostics.** `useIsOwner()` gates two things: the `⚠ {warning}` banner (`CAL.high` wash when `source === 'unavailable'`, else `CAL.medium`) and the raw `⚠ {error}` line. *"It names upstream hosts, status codes and cache timestamps: diagnostics, not customer copy. A customer sees no banner either way, because when data is present it is real data and when it is not they get the plain empty line below."*

**Rows.** `DaySections` splits into active and stale (`isStale(e, now)`), the stale group rendered second behind a 1px separator with `opacity: 0.32` and `transition: opacity 0.4s`. A day separator is `V2W.todayRow` when it is today and `V2W.panelBg` otherwise, with the label in `CAL.accent` at full opacity today and `V2.text` at **0.55** otherwise — *"Not-today is WHITE at an opacity, not a slate grey — this page has no grey text."* Today also gets a solid `CAL.accent` badge reading **`TODAY`** with `V2.badgeInk` ink.

**Event row.** `gridTemplateColumns:'62px 1fr'`, `minHeight:48`, `borderLeft: 3px solid {impactColor}`, background `linear-gradient(90deg, alpha(col, 0.059) 0%, transparent 35%), V2.bg` — *"0x0f/255 ≈ 5.9% — v2 writes it as a hex alpha suffix on the colour."* The time gutter has `boxShadow: inset -1px 0 8px alpha(col, 0.094)` — *"0x18/255 ≈ 9.4%."* Title weight is **700 for High impact, 500 otherwise**. `A:` is `CAL.actual` and bold, `F:` is `CAL.forecast`, `P:` is plain `V2.text`. A faded row paints them all `V2.text`.

**Earnings weaving.** Premarket names go ahead of the day's first event; after-hours go before the first event later than `16:00` (or at the end when there is none); unconfirmed-time names go last. *"The tbd bucket goes last because it has no place in the day's sequence, and anchoring it anywhere earlier would imply one. Before that bucket existed those names were dropped outright, which is most of what 'lots of names missing' was."* Days that have earnings but no passing econ events are seeded so a quiet day still renders its earnings.

`EARN_KIND`: `pre` → `PRE` / `MKT` / `Premarket earnings` / `CAL.accent`; `after` → `AFTER` / `HRS` / `After-hours earnings` / `CAL.accent`; `tbd` → `TIME` / `TBD` / `Time unconfirmed` / `V2.text`. *"TBD was a grey; it is white now and still reads apart from the cyan of a CONFIRMED pre/after session."* The wash is `alpha(k.color, 0.071)` to 40% (`0x12/255 ≈ 7%`).

**Chips.** `CHIP_W = 40`, `CHIP_GAP = 8`. Each is an `<a>` to `https://finance.yahoo.com/quote/{symbol}` (`target=_blank rel=noreferrer`), with a title of `{company} · {fmtMcap(market_cap)}[ · est {eps_est}]`. v2 renders a `ChipLogo` (local mirror → `/proxy/ticker-logo` → text chip); v3 renders **only the text chip its own last fallback would have produced** — *"the same shape and the same size, without a half-ported image pipeline."* The glyph is `symbol.slice(0, 4)`.

**Status / empty lines, verbatim.**

| Condition | Text |
|---|---|
| loading | `Loading…` |
| error, owner | `⚠ {error}` |
| no events, owner with a warning | `No events available — see the notice above.` |
| no events, anyone else | `No events this week.` |

---

## Card: Confidence Score

Part M. Title `Confidence Score` + orange `TitleTag` **BETA**, and a `MoreLink` to `/app/confidence-score`.

**This card does not use `useLiveData`** — it has to compare each poll against the previous one to notice the CB moving strike, which needs its own loader. Poll: `/api/confidence?date={etDateISO()}` every **120 s**.

**Always scores today.** There is no prior-session fallback and `isStale` is hardcoded false — *"before the first snapshot lands the card says so rather than showing yesterday's score under a live-looking timestamp."*

**Derived numbers.**

```
score     = round(score.hit)                        // 0..100, NOT fractions
band      = 'HIT'   when hit >= pivot and hit >= chop
            'PIVOT' when pivot >= chop
            'CHOP'  otherwise
bandColor = HIT → V2.pos, PIVOT → V2.orange, CHOP → V2.red
distToCb  = price − level                           // SPX points, one decimal, signed
hitPts    = thresholds.hitPts ?? 8                  // points
```

`Distance to CB` paints `V2.pos` when `|distToCb| <= hitPts`, else `V2.text`, else muted when null.

**The score bar.** 6px tall, `borderRadius:3`, track `V2W.border`, fill `width: {score}%` in `bandColor`.

**CB-change tracking.** On each poll, if the rounded level differs from the rounded previous level, `changedAt = Date.now()` and `hitAfterChange = false`. If `|price − level| <= hitPts` at any poll, `hitAfterChange = true`. The row then reads `CB CHANGED` (orange, 800) followed by either `hit ✓` (`V2.pos`) or `{fmtElapsed(now − changedAt)} — awaiting hit`.

**The 1 s clock runs ONLY while a CB change is outstanding** — `useSecondTick(changedAt != null && !hitAfterChange)`. *"there is nothing else on this card that ticks, and a permanent interval would re-render it sixty times a minute for a number nobody is watching."*

**The three checkpoints.**

```
CHECKPOINTS = [ {'9:45', 585}, {'10:30', 630}, {'12:00', 720} ]   // ET minutes
```

> ⚠ v2's comment above this array says "9:35 / 10:30 / 12:00" and its code says 9:45. The code is what shipped and what the scores were read against, so 9:45 is the parity value. Recorded in Part M of the parity doc.

`segmentAt(timeline, targetMin)` returns the last segment that had started by then; if the target precedes the first snapshot it falls back to the **earliest** segment — *"that is the CB that was in force around the open, which is what the early checkpoints are asking about. Returning null there would print a dash on a checkpoint that did have an answer."*

**The chip priority is ordered and the order matters:**

1. still in the future → `pending`
2. recorded `pivot`, but a LATER checkpoint sits on a lower strike → it was never a pivot, just a hit. Show `HIT`
3. any recorded outcome → that outcome
4. live, and the CB moved since the previous checkpoint → `CB CHANGED · PENDING`, because the level under it is not the one that was scored
5. otherwise → `pending`

`outcomeChip`: `miss → MISS` (`V2.red`); `hit → HIT` and `pivot → HIT` (both `V2.pos`); `chop → HIT · CHOP` (`V2.orange`); null → `—` muted. *"hit / pivot / chop all ENGAGED the level and all read HIT; only `miss` means price never reached it. `chop` adds the qualifier."*

Row grid: `'46px 64px 1fr'`, `columnGap:8`, `borderBottom: 1px V2W.border`, `paddingBottom:6` — time (14px mono muted), strike (14px `Value`, `V2.cyan`, right-aligned), chip (10px/800, `.06em`, right, `nowrap`).

**Empty.** `Waiting for today's first CB snapshot.`

---

## Card: Net Greeks

Part N. Title `Net Greeks`.

**Control.** `PillSelect` over `['SPX','QQQ','SPY']`, default `SPX`, local state.

**Two sources, one set of tiles.** SPX is the only ticker with a recorded series — `greeks-ts-writer.js` is `$SPX`-only, because it reads `/proxy/gex`, a single-symbol engine — so QQQ and SPY come from the live chain instead: same OI+Vol maths, no stored history, therefore **no Δ columns**. Both sources are normalised to **raw dollars** before they reach a tile, so nothing below the fetch branches on where the number came from.

**Feeds.**

- SPX: `/api/snapshots/greeks?date={today}&limit=5000` (120 s, ascending) plus a fallback `/api/snapshots/greeks?limit=1` (60 s, **newest-first**) *"Used ONLY when today has none, so the card shows the last session's totals instead of going blank overnight."* Today's series is empty pre-open and overnight — the writer is RTH-gated.
- QQQ / SPY: `/api/chains?ticker={tk}&range=all` (60 s) → `computeNetGreeks`.

**`GREEK_SCALE`** (`greeks.ts:174`) — stored greek → raw dollars, *"so the tiles never branch on their source"*: `gex: 1e9`, `dex: 1e9`, `chex: 1e6`, `vex: 1e6`. `greeks_ts` writes **$B for gex/dex and $M for chex/vex**; a chain sum is already raw.

**Δ 15 m / Δ 30 m.** `rowNearestAgo(rows, latestTs, minsAgo, tolMin = 6)` finds the row closest to `latest − minsAgo·60 000` ms, **returned only when it lands within ±6 minutes**. *"Outside the tolerance there is no honest Δ and the card prints an em dash instead of comparing against whatever happened to be nearest."* The `Number()` coercions inside it are load-bearing: *"pg BIGINT timestamps come back as strings and string arithmetic would silently produce NaN diffs."*

`delta = (cur[k] − ago[k]) × GREEK_SCALE[k]`, in raw dollars. Deltas are computed **only on today's live series** — never on a one-row fallback, never for a ticker with no series.

**Loading gate.** `showLoading = (isSpx ? loading : chainLoading) && !cur` — *"While today's fetch is still in flight we do not yet know whether the fallback will be needed, so only spin when BOTH have produced nothing."*

**Render.** A 2×2 grid, tiles `1px V2W.border`, `borderRadius:10`, `padding:12`. `Label` is `Net GEX` / `Net DEX` / `Net CHEX` / `Net VEX`; the value is `fmtBig(nowVal)` at **28px** (`FS.tile`).

> A zero here is WHITE, not muted — deliberately unlike `signColor`, which greys it. Both are v2's and they differ.

The `Delta` sub-component draws `15m {fmtBig(d)}` / `30m {fmtBig(d)}` at 14px mono; a null Δ is `—` in `V2.muted` at 0.5 opacity for the whole span.

**Note chip.** `live chain` (non-SPX) / `last session · {date}` (fallback) / `now · Δ15m · Δ30m`.

**Stamp.** `isSpx ? lastUpdated : chainAt` — *"Stamp the feed that actually produced the numbers on screen."*

**Empty.** `No greeks series yet.` (SPX) / `No live chain for {tk}.` (others).

---

## Card: Initial Balance

Part O. Title `Initial Balance`, note `ES`.

**Feed.** `useEsCandles(true)` — history from `/api/snapshots/candles` plus the shared socket's `esCandles` frame for the bar still forming. This is the page's one live-ish feed and it rides `data/esCandles.ts`; the page never touches a topic list. `lastUpdated` is the newest candle's timestamp — *"there is no fetch to stamp, because the bars arrive over the shared socket."*

**ES only.** The feed can carry more than one contract, so the card prefers bars whose `symbol` contains `ESU` and falls back to everything when the symbol tag is absent.

**Constants.** `IB_OPEN_MIN = 570` (09:30 ET), `IB_END_MIN = 630` (10:30 ET); `RTH_OPEN = 570`, `RTH_CLOSE = 960` (16:00).

**`computeIb`.** High/low of bars with `IB_OPEN_MIN <= etMinutes < IB_END_MIN`; `mid = (high + low) / 2`; `locked` once the last bar of the day is at or past 10:30. `brokeHigh` / `brokeLow` are judged **only on bars at or after 10:30** — *"a wick inside the window that made the high is not a break of it, it IS the high."*

**`etParts`.** *"The `Number(ts)` coercion is not defensive noise. Production historical bars arrive with a STRING timestamp (pg BIGINT → JSON), and `new Date('178…')` is an Invalid Date — which silently NaN'd every RTH check and dropped the whole IB. v2 carries the same coercion and the same comment."*

**Day type.** *"Classification order is significant — the reversal cases have to be tested before the two-sided case or a day that took the highs and rolled all the way under the IB would classify as plain 'Balance'."*

| Condition (in order) | `dayType` | Label |
|---|---|---|
| `brokeHigh && !brokeLow && close > high` | `trend-up` | `Trend ↑` |
| `brokeLow && !brokeHigh && close < low` | `trend-down` | `Trend ↓` |
| `brokeHigh && close < low` | `reversal-down` | `Reversal ↓` |
| `brokeLow && close > high` | `reversal-up` | `Reversal ↑` |
| `brokeHigh && brokeLow` | `balance` | `Balance / Two-sided` |
| `locked` | `balance` | `Balance` |
| — | `forming` | `Forming` |

**Bias sentences, verbatim** (`lean` drives the colour: long → `V2.pos`, short → `V2.red`, neutral → `V2.muted`):

- trend-up / long — `Trend up — favor break-&-retest longs above IB/PDH; stops below IB low.`
- trend-down / short — `Trend down — favor break-&-retest shorts below IB/PDL; stops above IB high.`
- reversal-up / long — `Reversal up — early low taken then reclaimed; long back above IB.`
- reversal-down / short — `Reversal down — poor high then back below IB; short the rollover.`
- balance / neutral — `Balance day — fade ONH/PDH and ONL/PDL back toward the IB mid; avoid the middle.`
- default / neutral — `Two-sided auction — trade the reference levels, no strong directional lean.`

**Why the file is narrow.** `ib.ts` ports three of `computeAmt`'s six outputs — `ib`, `dayTypeLabel`, `bias`. *"if a later v3 page needs the level reads, port `computeRefLevels` properly into `src/data/` — do NOT widen this file, which is scoped to one card and says so."*

**Countdown.** `useSecondTick(true)` drives `ibCountdown()`:

| Phase | Text | Colour |
|---|---|---|
| `pre` (< 09:30) | `IB forms in {m}m {ss}s` | `V2.muted` |
| `forming` (09:30–10:30) | `Forming — {m}m {ss}s left` | `V2.orange` |
| `done` | `IB locked` | `V2.pos` |

**Stats row.** `IB High` (`V2.pos`), `IB Mid` (`V2.cyan`), `IB Low` (`V2.red`), `Range` — which reads `forming` while the window is open, else `{round(high − low)} pts`.

**Rules in play.** Every read before 10:30 is provisional and says so, because the range can still widen — the suffix is ` (provisional — IB still forming)`. The rules, with their base rates transcribed exactly (*"A rule whose number drifted would be worse than no rule"*):

| Title | Tone → colour | Detail (verbatim) |
|---|---|---|
| `IB Forming · Provisional Reads` | `forming` → `V2.orange` | `Tracking the 9:30–10:30 ET range live — current IB H/L {high} / {low}. The reads below use the developing range and can still change; they lock at 10:30 ET.` |
| `Inside Day Exception` | `info` → `V2.cyan` | `IB window complete. Only 0.6% of days stay fully inside the IB — plan for at least one breakout.` |
| `Timing Curve · Range Mode` (done, no break, past 11:00) | `neutral` → `V2.text` | `Past 11:00 ET with no breakout — 84.1% of breakouts hit by now. Shift from breakout to range/premium-decay playbook.` |
| `Single-Break Trend Day` (`brokeHigh !== brokeLow`) | `good` → `V2.pos` | `One clean side broken — modern ES regime: 75.59% single-break trend days, 22.05% double-breach risk. Respect the first break{tag}.` |
| `Double Breach (ES)` (both) | `bad` → `V2.red` | `Both IB sides broken — the ~40% ES double-cross whiplash profile. Trend-continuation conviction is reduced{tag}.` |

*"Both single-break branches produce the SAME title and text in v2. Kept as one branch here; splitting them would imply a distinction that is not there."*

Each rule card carries `borderLeft: 3px solid {tone colour}` and `borderRadius:8`. The header is `Rules in play ({n})`.

**Loading vs empty.** `useGrace(4000)` — true for the first 4 s after mount, *"Used by the IB card to tell 'still loading' from 'loaded but empty' on a feed that exposes no ready flag."* So `loading = candles.length === 0 && grace`.

**Empty, verbatim.** `IB hasn't formed yet — waiting for 9:30 ET open.` when the phase is `pre`, else `No ES data for this session.`

---

## Card: Ticker Levels

Part P. Title `Ticker Levels`.

**Two read paths, because neither alone is sufficient:**

- `/proxy/walls?date={today}` → `{tickers:[{symbol, spot, call_wall, put_wall, cb}]}`. Sampled from `scanner_snapshots` onto a **15 m slot grid starting 09:29 ET**. *"The ONLY endpoint that returns `cb`, so CORE comes from here or nowhere — `/proxy/scanner`'s SELECT omits the column even though the table has it."*
- `/proxy/scanner?any=1&limit=200` → each symbol's most recent row regardless of date, swept every 2–5 m. Fresher spot/walls than the slot grid, but no `cb`, and rows carried over from a previous session are flagged `stale`.

So **scanner wins for spot/call/put and walls supplies CORE**. Both are fetched once for the WHOLE universe on a 120 s poll, not per selection — *"switching the symbol is a local lookup, instant and costing no extra request."*

**TODAY ONLY.** `stale` scanner rows are **dropped rather than shown**, and there is no prior-session walls fallback. *"Before the recorders have written today the card says so instead of printing yesterday's numbers under a live-looking timestamp."*

**NO FUTURES.** `scanner_snapshots` covers cash indices and equities only, so ESU/NQU were derived rows — SPX plus the ES−SPX basis, and spot-only for NQ. *"They are gone: futures traders read the index levels off the ES chart, and a basis-shifted row was one more number to keep honest for no extra signal."*

**Controls.** The `TickerPicker`. Options are `[...DEFAULTS, ...extra, ...scannerTickers, tk]` deduped, where `DEFAULTS = ['SPX','SPY','QQQ']`. Default selection `SPX`, local state. `extra` persists at `localStorage['analytics.tickerLevels.extra']` as a `string[]` (`STORE_KEY`), restored in an effect *"rather than a useState initializer so the first client render matches what the server rendered."* Adding a symbol also selects it — *"typing a ticker means you want to look at it."* Removing one that is currently selected falls back to `SPX`.

Favourites live separately at `localStorage['analytics.tickerLevels.favs']` (`FAV_KEY`, also a `string[]`), shared with Ticker Lookup's picker.

**Derived numbers** (points, one decimal unless stated):

```
distCall   = call − spot
distPut    = spot − put
nearerCall = distCall != null && (distPut == null || distCall <= distPut)
near       = nearerCall ? distCall : distPut       // signed; <0 means through it
distCore   = core − spot                            // signed, signColor'd
pct        = |near| / spot × 100                    // two decimals
```

**`expiryLabel(exp, today)`** → `"Aug 6 · 0DTE"` style. *"The scanner always takes `expirations[0]` — the nearest — so this reads 0DTE intraday and rolls to the next contract after the close. Which expiry produced a wall is not cosmetic: a call wall from tomorrow's chain is a different level from today's."* Falls back to `exp —` / `exp {raw}`.

**Render.** Three `Stat`s at 18px — `Spot` (default ink), `Call Wall` (`V2.orange`, muted when null), `Put Wall` (`V2.pos`, muted when null) — a divider, then `Core` at 22px (`V2.cyan`, muted when null) with `distCore` beside it, another divider, then `Distance to nearer wall (Call|Put)[ · through]` with the points and the percentage.

**Notes line, verbatim** (joined by ` · `, orange at 0.75 when core is waiting, else muted at 0.5):

- `waiting on today's scanner sweep` — the symbol is known to a recorder but today's sweep has not reached it
- `not in the scanner universe` — it is not a symbol any recorder knows
- `core pending — first walls run 9:29 AM ET`

*"Every symbol a recorder knows about, stale rows INCLUDED — that is the difference between 'we don't scan that name' and 'today's sweep hasn't reached it yet', and the note below says which."*

**Empty.** `Waiting on today's first recorder run.`

**Title attr** on the note chip: `Levels computed on the {expiry} chain` or `No expiry recorded for this symbol`.

---

## The `TickerPicker`

Shared by Ticker Levels (and formerly Ticker Lookup) *"so this page has ONE ticker menu rather than two that drift."* Modelled on the Options Chain page's dropdown: bordered trigger, a **portal'd** frosted panel with a 2px cyan top accent, a search field, star-to-favourite with favourites floated to the top, click-outside and Esc to close.

**Portal'd because both host cards clip their overflow** — a menu rendered in flow would be cut off by the card that owns it. The panel is `position:fixed` and is therefore re-placed on any scroll or resize, with `true` for **capture** — *"the scroll that moves the trigger is usually an ancestor's, not the window's."* `zIndex: 9999`, `width: max(triggerWidth, 200)`, list `maxHeight: 300`.

**One thing it does that the chain's picker does not:** a query matching no listed symbol offers to add it (`+ Add “{q}”`). *"The scanner universe is not everything the walls tables know about — NDX, for instance — so a free-text path has to exist, and folding it into the search box is what let v2 delete the separate input and 'Look up' button that used to sit under the card."*

**The search box clears on CLOSE, not on open**, and the reason is recorded:

> Choosing or adding already cleared it, but closing any OTHER way — outside click, Escape, re-clicking the trigger — left the query behind, so reopening showed a list pre-filtered by a search you did not make and the first thing you had to do was clear a box you did not fill in. Cleared on CLOSE, not on open, so the menu never renders one frame of stale filtering on the way in.

`cleanSymbol(raw)` = `trim().toUpperCase().replace(/[^A-Z0-9.]/g, '')`. `loadList`/`saveList` swallow private-mode throws and bad JSON and fall back to defaults.

Enter: choose the exact match if there is one, else the first row, else add. The favourited star is `LEVEL_COLORS.cb` (`#ffd166`) — *"the same value v2 types here, already a token because the ladder's CB tag needs it."* Unfavourited is `V2W.star`. Custom (added) symbols carry an `×`. Empty list, no query: `No tickers`.

---

## Phone behaviour

`/analytics` is **not** in `DESKTOP_TO_MOBILE` (`src/mobile/mobileNav.ts:80`), so a phone is never redirected off it. The registry says why:

> ONLY routes listed here redirect a phone; everything else (Analysis, Flow, Replay, Scanner, Premarket) keeps rendering its desktop layout, because there is no phone build of it and a cramped real page beats a redirect to an unrelated one.

The page handles the width itself, in `analysis.css` under `@media (max-width: 899px)`:

- `.analysis-grid { grid-template-columns: 1fr !important; align-items: start !important }` — **one column, skipping the intermediate 2-column step.** *"v2 steps 4 → 2 (the generic collapse) → 1 (@899); the intermediate 2-column step crushes these dense cards, so v3 goes straight to one and skips it."*
- `.tl-split` goes to one column, `height: auto !important`, `grid-template-rows: auto auto !important`, and each pane gets `min-height: 70vh`. *"The fixed `clamp(838px, 86vh, 1500px)` is solved for two panes side by side. Stacked, it would clip the second one to nothing."*
- Three inline grid shapes are flattened by **attribute substring match**: `[style*='grid-template-columns: 1fr 1fr']`, `[style*='… 1fr 1fr 1fr']`, `[style*='… repeat(3, 1fr)']`.

That last block carries the page's most explicit architectural warning:

> ⚠ v2 ALSO relies on `globals.css`'s GLOBAL GRID COLLAPSE, which flattens inline `grid-template-columns` by SUBSTRING MATCH on the style attribute. v3 has no such rule and is not getting one — matching on inline styles is exactly the kind of action at a distance v3 exists to avoid — so every collapse v2 got for free is written out explicitly below.

The auto-fit level-chip rows are untouched: they already reflow.

The rail and toolbar stay put (`Shell.tsx` only drops them on `/m/*`), so on a handset in portrait the 16px rail still eats its width.

---

## Embed mode

`?embed=1` on the URL. Read **in an effect**, not during render:

> In the GEX dock this page is iframed at `?embed=1` into a narrow column. The frosted cards are 45% translucent, so stacked there they show through to whatever is behind them and read as smeared — embed mode makes them opaque and forces a single column. Read in an EFFECT, so the first paint is always the four-column layout and then it swaps. That is v2's behaviour; reading it during render would be a hydration mismatch in the Next build this was ported from.

It does two things: sets `gridTemplateColumns: '1fr'` inline, and adds `.analysis-embed`, which forces one column and repaints every child as `radial-gradient(circle at 50% 0%, color-mix(--color-v2-lightblue 10%, transparent) 0%, transparent 60%), var(--color-v2-panel)` with `backdrop-filter: none`.

`TickerLookupCard` also accepts `embedded` (drops the `span`) and `initialReplay` — used by `/replay`, which mounts this same card already rewound.

---

## Scrollbars

Scoped to `.cb-analysis-page` and everything inside it, **not** to `tokens.css`: *"every other v3 route still gets the platform scrollbar, and making that consistent is a separate, deliberate change to a shared file."* (Note this predates / sits alongside the app-wide scrollbar block that `tokens.css` now carries; the page rule is narrower and wins by specificity.)

```
scrollbar-width: thin
scrollbar-color: color-mix(in srgb, var(--color-fg) 12%, transparent) transparent
::-webkit-scrollbar          10px × 10px
::-webkit-scrollbar-track    transparent
::-webkit-scrollbar-thumb    --color-fg @12%, radius 8, 2px transparent border + background-clip: padding-box
        :hover               --color-fg @24%
        :vertical:active     --color-fg @32%
```

**The value is not invented:** v2 themes exactly one scroller itself — the Premarket card's bullet list — as `rgba(255,255,255,0.12) transparent`, and that is the pair used here. **Both mechanisms are declared on purpose:** `scrollbar-color` is the standard (Firefox, Chrome 121+); the `::-webkit-` rules cover older Chromium and Safari, which ignore it entirely. *"Dropping either leaves a light scrollbar on some share of real browsers."* The track is transparent, not a plate: *"the ladder pane and the card behind it are two different fills, and a track painted one of them reads as a seam down the side of whichever it does not match."* The 2px transparent border is *"how a webkit thumb gets inset from its track — there is no margin on this pseudo-element."*

---

## Performance and bundle

- **Own chunk.** `const Analysis = lazy(() => import('@/pages/Analysis'))`. Chunk names fall out of the file names, *"which is what makes an over-budget route legible in `check-budgets.mjs` output."*
- **Budget.** `budgets.json:5` — `"route": 59100` brotli bytes, the ceiling every route chunk shares. `budgets.json:3` `"entry": 38900`; `"react": 55000`; `"css": 8500`; `"totalInitial": 108400`. The `$comment` is explicit: *"These are set close to current reality on purpose — a budget with 4x headroom enforces nothing. Raising a number is a deliberate decision that shows up in a diff."* Ratchet slack is `0.15` with `enforce: false`, so a shrinking bundle reports SLACK but never fails.
- **Theme baseline.** `theme-baseline.json` lists **no file under `src/pages/analysis/`**. The whole page is clean of colour literals and can never regress — a file that reaches zero is dropped and *"can never regress."*
- **No canvas, no `data-cb-layer`.** `budgets.json:15–20`'s `perf` block (`idleRepaintsPerFrame: 0.15`, `offscreenRepaints: 0`, `interactionRepaints: 10`) measures canvases attributed to board cards; this page has none, so `npm run perf` has nothing to attribute here.
- **No request waterfall** (AGENTS.md non-negotiable 3). Every card fires its own fetch at mount, in parallel, from its own `useLiveData`. The one sequence that exists is deliberate and documented: Ticker Lookup's right pane must read `/api/expirations` before it can sweep `/api/chains` per expiry.
- **Per-frame cost.** Only three timers ever run: Confidence's 1 s tick (gated on an unresolved CB change), Initial Balance's 1 s tick (always, for the countdown), and Strategy Builder's 60 s window re-check (unmounted). Replay's step interval only exists while playing.
- **Memoised work.** The replay axes are memoised on the session and keyed by joined strings — *"Walking every frame's cells is cheap once and wasteful sixty times a minute at 8× playback."*

---

## Gotchas

1. **`StrategyBuilderCard` is fully built and never rendered.** `src/pages/analysis/cards/StrategyBuilder.tsx` (342 lines) exports `StrategyBuilderCard`, and `grep -rn "StrategyBuilder" src/` returns exactly one hit — its own `export function` line. `Analysis.tsx` neither imports nor mounts it, so `/api/strategy` is never called from v3 and the `NOT FINANCIAL ADVICE` tag, the `Available 9:00 AM – 4:00 PM ET on weekdays.` placeholder and the Confirmation-triggers section (the page's ONLY use of `V2.green`) are unreachable today. It is documented above because it is the ninth card of the parity port and is one import line from shipping.

2. **`T.cyan` / `T.orange` / `T.red` / `T.green` are traps on this page.** They resolve to different colours from v2's. Use `V2.*`. And note `V2.green` is a **light blue**, not a positive colour — `V2.pos` is the positive.

3. **`useLiveData(null)` never stops loading.** The guard returns before the `finally`, so `loading` stays `true` forever. Two cards depend on that (Net Greeks gates on the chain's flag; Strategy Builder checks its window first). Fixing it changes which empty state those cards show.

4. **`AnalysisCard height` must be the string `'auto'`.** Passing `undefined` fires the `= CARD_H` default and silently clips the card to 480px — the exact bug the prop was added to fix.

5. **Two different zero colours, both correct.** `signColor(0)` is `V2.muted`; a Net Greeks tile showing 0 is `V2.text`. *"Both are v2's behaviour and they are genuinely different; do not unify them."*

6. **The econ calendar silently filters.** `hideToolbar` removes the menu but the `{all-usd, trump, earnings}` filter still runs, dropping non-USD High/Medium/Low events. Easy to mistake for missing data.

7. **The Premarket card's `/ES` gap paints red at exactly zero** — the test is `> 0`. v2's behaviour, kept.

8. **`nextPremarketDate()` hardcodes `-05:00` (EST) year-round.** The noon anchor absorbs the DST hour so the date is still right; it is transcribed, not corrected, on purpose.

9. **The Confidence checkpoints are 9:45 / 10:30 / 12:00, not 9:35.** v2's *comment* says 9:35; v2's *code* says 9:45, and the code is what the scores were read against.

10. **This page's wall definitions are NOT `board/chainGex.ts`'s.** `tlLevelsFrom` takes the extreme `+GEX` / `−GEX` strike **anywhere** on the ladder with no reference to spot, then resolves the Core collision by stepping the colliding wall down to the second strike on its side. On a hard down day the two definitions return different strikes. Reusing `chainGex.ts` here is the single easiest way to ship a page that looks finished and prints a different Call Wall.

11. **Do not reach for `/proxy/gex-by-strike-multi` for the right pane.** It returns exactly this ladder and its numbers did not match the chain on single names (the NVDA case is written into the header).

12. **The gamma flip only counts a negative→positive crossing**, cumulating from the lowest strike up, and it needs a spot. A naive sign-change scan catches a short-gamma strike out in the call wing and prints a flip hundreds of points above spot.

13. **The Δ 1D column hides itself until a second snapshot exists.** With one snapshot every `chg` is 0 by construction, and a column of zeros reads as "the board didn't move".

14. **Replay `—` is not `0`.** The recorder stores the top N strikes per side per expiry per sweep; a strike that was never a wall was never recorded. `± Move`, `ATM IV` and the whole `Δ 1D` column go dark while rewound.

15. **The ladder's spot line must not get a CSS transition** and its position must not come from state set in an effect — both make it trail the price written on it, visibly, during replay.

16. **`lockedMaxRef` and `useTlAnchor`'s ref are both written during render.** That is deliberate and both comments explain why; converting either to state is a render loop or a one-frame-late paint.

17. **Ticker Lookup has no ticker menu.** The toolbar's `usePageSymbol` is the only source. The QUICK row sets the *board* symbol. Do not add a local dropdown back — that disagreement was the Replay-hub bug.

18. **The `/economic-calendar` rail entry has no prefetch on purpose.** Its hook uses a raw `fetch`, not `api.ts`, so a warmed cache would never be read back. The same applies to anything on this page that does not go through `useLiveData`'s `api.ts`-free path — only `/api/premarket-summary` is warmed.

19. **`MoreLink` targets are v2 routes** (`/app/em`, `/app/confidence-score`) and are plain `<a>` tags out of the SPA, not router links.

20. **The board sweep is uncapped.** SPX lists 40+ expirations and every one is fetched, six at a time. The throttle is `BOARD_CONCURRENCY`, the poll is 120 s, and it pauses entirely while replay is on. Do not "optimise" it by slicing the expiry list — "All expirations" has to mean all of them.
