# `/premarket` — Premarket Prep

**Route.** `/v3/premarket`. Registered in `src/App.tsx:190` as `<Route path="/premarket" element={<Premarket />} />`, behind `const Premarket = lazy(() => import('@/pages/Premarket'))` (`src/App.tsx:29`). Rail entry in `src/shell/Shell.tsx:108`: `{ to: '/premarket', label: 'Premarket', icon: '🌅', prefetch: ['/api/scanner/market-quality'] }`. A hard refresh is answered by `app/v3/premarket/route.ts` in the v2 repo — step 4 of AGENTS.md's four-step "Adding a page".

The file's own opening line records why it is a component and not a Next page:

> SPA-ONLY, like every other feed-consuming page in this repo. It rides lib/gexSocket (useMobileGex / useEsCandles), which only exists in a browser… Next prerenders anything under `app/`, and prerendering this tree is what failed the Docker build on 2026-08-19.

**Sources.**

| Path | Role |
|---|---|
| `src/pages/Premarket.tsx` | the page: both tabs, the CSS block, every memo, the docked replay transport |
| `src/pages/premarket/chainGex.ts` | `useChainGex` (the any-symbol REST board) and `useMultiExpiryGex` (the standing book) |
| `src/pages/premarket/postMarketData.ts` | the freeze, the replay, the recorded stores, the wall log, the grading |
| `src/pages/premarket/PostMarketTab.tsx` | the Post-Market recap, six sections |
| `src/pages/premarket/HistoricalRecap.tsx` | the fallback view for a date with no capture |
| `src/pages/premarket/GexProfile.tsx` | the scrolling per-strike ladder, mounted twice |
| `src/pages/premarket/GammaBellCurve.tsx` | the full-width two-pane gamma card |
| `src/pages/premarket/gammaChartKit.ts` | the gamma cards' shared math, binning and pan/zoom |
| `src/pages/premarket/GexHeatBar.tsx` | the gamma-book-churn bar and its history strip |
| `src/pages/premarket/CbContracts.tsx` | today's CB 0DTE checkpoints, read-only |
| `src/pages/premarket/format.ts` | the one set of number formatters all three surfaces read |
| `src/pages/premarket/*.css.ts` | the three lazy panels' stylesheets, split out so the panels can be lazy |
| `src/pages/premarket/GexWatchFeed.tsx` | **built, unmounted** (removed from the page 2026-08-29) |
| `src/pages/premarket/GexChurnFeed.tsx` | **built, unmounted** (superseded by `GexChurnHistory`) |
| `src/pages/premarket/TickerBoard.tsx` | **retired tombstone** (2026-08-27) |
| `src/pages/premarket/GammaDistribution.tsx` | **removed tombstone** (2026-08-25), 26 lines, `export {}` |

---

## What it is, in one paragraph

Premarket Prep is the pre-open cockpit and the post-close post-mortem for one symbol, on one page, with two tabs. The header says exactly what it answers: **what regime am I in, where are the walls, what happened overnight.** The Premarket tab carries a regime strip (positive/negative gamma, net GEX with its overnight change, the gamma flip, spot vs ES), a single-axis GEX level rail plotting Put Wall / Flip / CORE / Spot / Call Wall on one price domain, six Key Levels tiles each carrying a "was → now" migration line against the prior session's settled board, two side-by-side scrolling per-strike ladders (the front expiry, and every listed expiry with that tranche removed), an overnight context column (ON range, gap, gap fill, prior-day range, biggest GEX changes, sector heat), an expected-range column (EM band with the walls plotted inside it, the conviction overlap, market quality, a three-scenario playbook, catalysts), a full-width gamma bell card with a least-squares normal fit, a gamma-book-churn strip and today's CB contracts board. The Post-Market tab is a six-section recap of how the day actually went. **Any of the fourteen MAIN watchlist symbols renders the whole page**, and **any recorded past session can be opened frozen or replayed minute by minute** — both through one swap at the single place the data enters the component, so there is no second rendering path to drift.

---

## File map

| File | Lines | What it owns |
|---|---|---|
| `src/pages/Premarket.tsx` | 3525 | the `CSS` template literal (lines 305–775), the ET clock, the tab/symbol/basis/date state, the four-way data swap, replay state and its axis anchor, every derived memo, the whole Premarket tab's JSX, and the docked replay bar |
| `src/pages/premarket/PostMarketTab.tsx` | 2278 | six recap sections: Day Snapshot, Level Scorecard, How the Book Was Built, Positioning at the Close, Tomorrow's Map, Journal · Accuracy · Premium |
| `src/pages/premarket/postMarketData.ts` | 1432 | ET helpers, `recentSessions`/`prevSessionOf`/`sessionLabel`, `frozenGexOf`, `useSessionFreeze`/`useFreezeDates`, `usePremarketReplay`/`useReplayDates`/`etClockOf`, `useDatedEsCandles`, `useGexLevelsHistory`, `useEodGex`, `useSessionEsBars`, `useIntradayLadder`, `useNextExpiryStructure`, `useRecordedWalls`, the wall-reaction catalogue, `parseTickerBoard`/`useTickerBoard` |
| `src/pages/premarket/GammaBellCurve.tsx` | 840 | `GAMMA_BELL_CSS`, the two-pane SVG, the six KPI tiles, the level label fan |
| `src/pages/premarket/gammaChartKit.ts` | 687 | `rowNet`/`rowMass`, `moments`, `lsqGaussian` (Caruana), `massInside`, `wideHalfOf`, `foldBins`, `autoHalf`, `usePref`, `useStrikeWindow` (pan/zoom), `layoutLevels` |
| `src/pages/premarket/CbContracts.tsx` | 649 | the read-only CB-contract checkpoint rows and the probe curve |
| `src/pages/premarket/HistoricalRecap.tsx` | 574 | the recorded-stores view for a date with no freeze |
| `src/pages/premarket/GexHeatBar.tsx` | 539 | `buildShareColor`, `heatFill`, `GexHeatBar`, `GexHeatBoard`, `useGexChurnHistory`, `GexChurnHistory` |
| `src/pages/premarket/TickerBoard.tsx` | 580 | retired — nothing imports it |
| `src/pages/premarket/chainGex.ts` | 525 | `chainRowsOf`, `wallsOf`, `useChainGex`, `ladderOf`, `useMultiExpiryGex` |
| `src/pages/premarket/GexProfile.tsx` | 412 | `PROFILE_ROW_H`/`PROFILE_VIEW_H`/`PROFILE_PAD`, the window, the bar scale, the gesture-aware pin/centre |
| `src/pages/premarket/postMarketTab.css.ts` | 312 | `POSTMARKET_CSS`, `EV_ROW_H` |
| `src/pages/premarket/GexChurnFeed.tsx` | 178 | unmounted |
| `src/pages/premarket/GexWatchFeed.tsx` | 163 | unmounted; still exports `GEX_WATCH_CSS` |
| `src/pages/premarket/cbContracts.css.ts` | 118 | `CB_CONTRACTS_CSS` |
| `src/pages/premarket/format.ts` | 84 | `nf`, `fmtPx`, `fmtPts`, `fmtPct`, `fmtUsd`, `etMinOfDay`, `pillClass` |
| `src/pages/premarket/historicalRecap.css.ts` | 42 | `HISTORICAL_CSS` |
| `src/pages/premarket/GammaDistribution.tsx` | 26 | tombstone |

---

## The four data sources, and the one swap

Everything on this page hangs off exactly one destructuring (`Premarket.tsx:1394–1400`):

```js
const gex = replay && replayGex ? replayGex
          : frozen && frozenGex  ? frozenGex
          : sym === "SPX"        ? liveGex
          :                        chainGex;
const { chain, spot, flip, callWall, putWall, totalNetGex,
        esFut, basis, expiry, isZeroDte, connected, hasData, updatedAt } = gex;
```

> THE SWAP. Everything below this line — every memo, every panel, both tabs — reads the destructured values and cannot tell which side they came from. That is deliberate and it is what makes a frozen date the REAL page rather than a second implementation of it: there is no historical rendering path to drift out of step with the live one.

| Source | Hook | Symbol | Transport |
|---|---|---|---|
| **live** | `useMobileGex("oi-vol")` | SPX only — the socket carries one symbol | `lib/gexSocket`, refcounted, pinned to today's 0DTE |
| **frozen** | `frozenGexOf(freezePre \| freezePost, date)` | SPX only | `/proxy/premarket-freeze` |
| **replay** | `frozenGexOf(replayFrame.payload, date)` | SPX only | `/proxy/premarket-replay` |
| **chain poll** | `useChainGex(sym, sym !== "SPX" && !isHistorical)` | any MAIN name | `/api/expirations` → `/api/chains`, 60 s |

`replay` wins over `frozen` on the same date: *"you asked to drive the session, so the two-a-day capture stops being what is on screen."*

**Three things are genuinely SPX-only** and are *named as such on screen rather than faked*: the ES basis and every `ES 6,812` sub-line (*"no future stands behind AAPL"*), frozen past sessions, and the ES overnight window — for other symbols the overnight panel reads that ticker's own recorded candles instead.

**One page, every symbol (2026-08-27).** Before that date, non-SPX names were routed to `TickerBoard.tsx` — *"about a third of what is below"*. SPY and QQQ silently lacked the regime strip, the level rail, the six Key Levels tiles and their migration lines, the scrolling profile, DEX/vanna, the expected-range track, the bell curve, the catalysts and the entire Post-Market recap. `useChainGex` returns the **same shape** off REST, so the page renders identically and `TickerBoard` *"is not mounted any more."*

`chainGex.ts`'s header records the correction: the "a third of the cards render '—' forever" premise turned out to be true of **three** things, not a third of the page.

**Why REST, not a second socket**

> `lib/gexSocket` carries ONE symbol's frames — the server publishes SPX and nothing else on `/ws/gex`. Putting a second symbol on it is a server change (a second subscription, a second calculator, a second set of frames), not a page change… so this is a poll: accurate, one cycle behind, and labelled as such in the page head ("CHAIN POLL · 1m") rather than dressed up as live.

**Raw legs, not pre-summed rows.** `chainRowsOf` builds rows carrying `callGamma`/`putGamma`, `callDelta`/`putDelta`, OI, volume, marks and IV — the same raw legs the socket's `gexRows` carry — **not** a pre-summed `netGEX`:

> That is deliberate and it is what makes the page's three-way basis switch (OI / OI+VOL / VOL) mean the same thing here as it does on SPX… a pre-summed row would have frozen one basis in and silently ignored the switch.

Scale and sign match the server calculator exactly — **γ × (OI + Vol) × S², calls +, puts −**. No ×100, no put-side flip. *"do not 'simplify' one side of that constant away without the other."*

**Vanna is carried through only if the payload has it.** It is deliberately NOT reconstructed from Black-Scholes: *"the server's own bsGreeks returns zero for T = 0, so a client-side rebuild would print a vanna on a 0DTE board that the SPX board beside it does not, and the two tiles would be on different scales while looking like the same number."*

---

## Every endpoint on the page

| Endpoint | Caller | Cadence | Params | Notes |
|---|---|---|---|---|
| `/ws/gex` (socket) | `useMobileGex("oi-vol")` | push | — | SPX; one refcounted connection shared with the toolbar. Runs whichever symbol is selected — *"switching back is instant with no reconnect"* |
| `/api/expirations?ticker=` | `useChainGex` | with each poll | ticker | FRONT = the nearest listing on or after ET today |
| `/api/chains?ticker=&expiration=&range=all` | `useChainGex` | **60 s** | ticker, expiration, range | disabled entirely while SPX is on screen or on a historical date |
| `/proxy/gex-by-strike-multi?symbol=&spot=` | `useMultiExpiryGex` | **60 s**, first call delayed **400 ms** | symbol (`$SPX` upstream, others passthrough), spot to 2dp | server-cached per (symbol, session) for a minute — *"N readers cost one sweep"*. LIVE only |
| `/api/snapshots/candles?date=&interval=5&limit=2000&lite=1` and `?daysBack=8&…` | `useEsCandles(true, 8, 5, false)` | once + socket | date/daysBack/interval/limit/lite | **8 calendar days, not 3** — see below |
| `/api/snapshots/candles?date=&interval=5&limit=600&lite=1` | `useDatedEsCandles` | once per frozen/replayed past date | date | that session's and the prior session's bars |
| `/api/snapshots/etf-candles?symbol=&days=8&interval=5` | `useEtfCandles` | 60 s | symbol, days, interval | the non-SPX overnight series, from `etf_candles` |
| `/api/calendar` + `/proxy/earnings-week` | `useEconCalendar({withQuote:false})` | that module's | — | today's catalysts |
| `/api/quotes-batch?symbols=SPX,/ES,/NQ,VIX[,SYM]` | `loadQuotes` | **30 s** | symbols | SPX is in the batch *for one reason* — see below |
| `/api/scanner/market-quality` | `loadMq` | **60 s** | — | `sectorBars` (5-day sector change) + `globalScore`/`decision`. **Prefetched on rail hover** |
| `/api/premarket-baseline?expiry=&basis=oi&symbol=[&today=]` | `loadBaseline` | on (expiry, sym, frozen, replay, viewDate) change | expiry, basis, symbol, today | the prior session's settled per-strike GEX for the SAME expiry |
| `/proxy/premarket-freeze?date=&symbol=SPX` | `useSessionFreeze` | once per past date | date, symbol | both captures in one request |
| `/proxy/premarket-freeze?dates=1&limit=40&symbol=SPX` | `useFreezeDates` | once, cached 1 min | dates, limit | flags only — which dates have a `•` |
| `/proxy/premarket-replay?date=&symbol=SPX` | `usePremarketReplay` | once per (date, symbol) | date, symbol | the whole day in ONE request — *"playback and scrubbing must not fire a fetch per step"*. `dedupeFetch` TTL 30 s |
| `/proxy/premarket-replay?dates=1&limit=40&symbol=SPX` | `useReplayDates` | once, cached 1 min | dates, limit | which dates have a `▸` |
| `/proxy/gex-levels-history?symbol=&limit=40` | `useGexLevelsHistory` | once | symbol, limit | one settled row per session, **kept forever**. Fills the session picker AND `HistoricalRecap`; `dedupeFetch` collapses the two into one |
| `/api/gex-gross-feed?symbol=&days=45` | `useGexChurnHistory` | once per symbol | symbol, days | the `gex_gross_daily` rollup written at 16:50 ET |
| `/api/cb-contracts` (+ `?ticks=<id>`) | `CbContracts` | **60 s** | ticks | `auth:'subscriber'`. NOT `/api/cb-trades` |
| `/api/snapshots/option-strike-gex-history?mode=heatmap&minutes=0&date=` | `useIntradayLadder` | Post-Market / Historical only | mode, minutes, date | pruned to ~**two sessions** |
| `/proxy/walls?date=&symbol=` | `useRecordedWalls` | Post-Market / Historical only | date, symbol | the saved, server-classified grade |
| `/api/eod-gex?date=&limit=50` | `useEodGex` | Historical only | date, limit | the 0DTE / ex-0DTE split and the recorder's own pin |
| `/api/expirations` + `/api/chains` | `useNextExpiryStructure` | Post-Market only, once | ticker, expiration, range | *"the ONE thing that needs a second chain: tomorrow's structure cannot be derived from today's expiring book"* |

**Failure behaviour.** Every poll on this page **keeps the last good value**. `useChainGex`: *"An abort on unmount lands here too. Either way the last good board stays on screen — a poll that failed is not new information."* `loadQuotes` / `loadMq` both `catch { /* keep last good */ }`. `useMultiExpiryGex` degrades to `state: "error"` only if it never had a board.

Two clears are **deliberate**, and both prevent the same class of lie:

- `useChainGex` sets `IDLE` on every symbol change: *"Otherwise the new symbol's title sits over the old symbol's walls for a whole poll cycle — and on this page that is not a cosmetic glitch, it is six wrong levels presented as levels."*
- `loadBaseline` sets `baseline = null` before every fetch: *"a stale baseline for the PREVIOUS expiry — or, now, the previous SYMBOL — would silently diff today's chain against the wrong board. Same strikes, plausible numbers, nothing on screen naming it."*

**The baseline generation guard** (`baselineGen`) is a real bug fix:

> `expiry` changes at least twice on a cold mount — `useMobileGex` takes the SHARED socket's current expiry first and only pins today's 0DTE on a later commit — so two fetches are always in flight, and the second one is usually the WARM one while the first needs a full settled-chain sweep. Without this the slow, wrong-expiry response lands last and wins, and the card silently diffs today's chain against another expiry's board — same symbol, overlapping strikes, every number plausible, nothing on screen naming the expiry.

Belt and braces on top: the response is rejected unless `j.ok && j.byStrike && j.expiry === exp`.

---

## About that baseline (2026-08-21)

The prior-close baseline **used to be local** and it never worked:

> This page wrote its own end-of-day snapshot into localStorage ("cb-premarket-eod-v1"), once per session, but ONLY while it was mounted between 15:40 and 16:10 ET — and nobody has the PREMARKET page open at 3:40pm. The only writer was the one page that never ran in the write window, so the card showed "no prior-close snapshot yet" permanently. **It was a deadlock, not a warm-up.** (It was also per-browser, and required a snapshot from a STRICTLY EARLIER date, so even a fixed version had a two-session cold start.)

`server-v2/premarket-baseline.js` now computes it from settled ThetaData history — *"no window to miss, no cold start, one answer every device shares."* The dead key is still evicted once on mount (`LEGACY_EOD_KEY`), *"remove once a few weeks have passed."*

**THE BASIS MATTERS.** This is the page's single most important numerical decision.

> The baseline is read on the OI basis, and the live side of every comparison below is the OI leg too (`oiLeg()`), not the OI+Vol number printed in the KPI. On OI+Vol, a premarket comparison drags yesterday's whole session volume into the baseline against a live side that has ~none yet, so every strike prints a large negative Δ that is pure artifact. On OI both sides carry the same settled OI and the difference is what actually changed overnight: how each strike's gamma re-priced as spot moved. The card says "OI basis" out loud so the two numbers are never silently mismatched.

```js
oiLeg(row, spot) = netGEXOf(row, "net", spot) − netGEXOf(row, "vol", spot)
```

And `oiVsBaseline` sums **the intersection, not each side's own universe**:

> the live chain is a ±8% band around live spot, the settled baseline a ±500-point band around yesterday's settle, and the deep-OTM strikes at either edge carry the biggest OI on the board. Summing each side whole injects a large one-sided term and the KPI chip prints an arbitrary ▲/▼ — the same class of artifact the OI basis was chosen to avoid.

---

## Controls, defaults and where state lives

| Control | Default | Storage | Key |
|---|---|---|---|
| Pre / Post tab | clock-picked (`pre` until 09:30, `post` from **16:05**) until you click | `sessionStorage` | `cb-premarket-tab-v1` |
| Symbol picker | `SPX` | `sessionStorage` | `cb-premarket-sym-v1` |
| Session date | today | `sessionStorage` | `cb-premarket-date-v1` |
| Key Levels basis | `oi` | **`localStorage`** | `cb-premarket-lvlbasis-v1` |
| Bell card basis | `oi` (OI+VOL) | `localStorage` | `cb-premarket-gbell-basis-v1` |
| Bell card zoom | `auto` | `localStorage` | `cb-premarket-gbell-zoom-v1` |
| Replay on/off | off | component state | — |
| Replay index | last frame | component state | — |
| Replay speed | `1` | component state | — |
| Replay ⓘ note | closed | component state | — |
| Post-Market journal notes | — | `localStorage` | `cb-postmarket-notes-v1` |
| — (evicted) | — | `localStorage` | `cb-premarket-eod-v1` |
| Ladder scroll pin | pinned to spot | component state per `GexProfile` | — |

**Nothing is in the query string.** The date is deliberately `sessionStorage` and not `localStorage`:

> a date is a look-up, not a setting, and a page that reopens tomorrow still stuck on last Tuesday reads as broken data rather than as a remembered choice. A stored date that is no longer in the picker's window (it aged out, or the tab was left open across a session boundary) is dropped on read and the page falls back to today.

The Key Levels basis goes the other way: *"unlike the pre/post tab, which the clock should be free to pick each morning, a basis preference is a way of reading the board and should survive the session."* Once a tab is picked manually (`tabPinned`), **the clock never moves it again**.

**The symbol list.** `SYMBOLS = ["SPX", ...SCANNER_MAIN.filter(t => t !== "SPX")]` — SPX plus the MAIN group of the scanner universe: **SPY QQQ SPX NDX VIX AAPL AMD AMZN GOOGL META MSFT NVDA SPCX TSLA** (fourteen names). Why MAIN and not a hand-typed list:

> MAIN is exactly the roster the rest of the stack already treats as first-class, and both of the boards' data sources follow it: the scanner sweeps MAIN on the 2-minute HOT cadence, and `walls-recorder.js` samples the latest scanner row PER SYMBOL — so the Post-Market "Level grades" card reads a real recorded, server-classified verdict for every name offered here… A name outside MAIN would still render, but its wall log would be empty and its chain unswept.

The **static** import is deliberate: `/proxy/scanner-tickers` returns one flat de-duped array with no group labels, *"there is no runtime way to ask it 'which of these are MAIN'. `useScannerTickers()` would therefore hand back 169 tickers, not 14."* The picker is a `<select>`, not the pill row it replaced — *"fourteen pills push the session picker and the pre/post tabs onto a second row on anything narrower than a wide desktop, and the head stops reading as one strip."*

**A past date no longer locks the picker to SPX (2026-09-05)**

> This used to snap the symbol back to SPX the moment you stepped onto a past date, AND disable every non-SPX option while you were there — so on a Saturday, reading Friday's Post-Market recap, the ticker picker was simply dead. The reasoning was sound for the FROZEN path and wrong for the page… `HistoricalRecap` takes a `symbol` prop and reads that symbol's OWN recorded stores. Those go back for every MAIN name.

**Replay still snaps** (`useEffect(… if (replayOn && sym !== "SPX") setSym("SPX"))`) — *"its frames ARE a recorded SPX capture being stepped through, and there is no per-minute stored form of a chain poll, so a replay under an NVDA label would be a lie rather than a smaller truth."*

**The session picker.** `SESSION_COUNT = GEX_HISTORY_LIMIT = 40`. The list is the sessions that **actually have a settled row**, from `/proxy/gex-levels-history`:

> Offering the recorded dates rather than a computed run of weekdays is the difference between a picker that always lands on data and one that offers Thanksgiving. The weekday walk stays as the fallback for the moment before that request lands, and for the case where it fails — a picker with only "Today" in it would read as breakage.

Today is always first, *"even before it has a settled row of its own — it is the live option and the picker must be able to get back to it."* The restore effect runs **once, on mount, deliberately**: *"Re-running it whenever `sessions` changes would drag the user back to a stored date every time the clock ticked."* The snap-back effect waits for `recordedState !== "loading"`, because *"while it is still loading `sessions` is the weekday fallback, and bouncing a valid stored date off that would undo the restore."*

**Option marks**, drawn as text and not icons — *"the marks are load-bearing and a glyph font is one more thing to go missing"*:

| Mark | Meaning |
|---|---|
| `Today · {label}` | the live page |
| `▸ ` | replayable — frames recorded through the session |
| `• ` | captured — the two-a-day freeze, so both tabs open for real |
| (two spaces) | recorded-stores recap only |

It is the `Select` primitive, **not** a native `<select>`, and the CSS says why:

> the `.dsel` shell can theme the closed box and redraw the caret, but the list it drops is the operating system's. Tolerable for five ticker symbols, not for a DATE: the session list carries marks saying what each day can do, and a white platform menu is where that reading falls apart.

The symbol picker stays a native select — *"it is a one-of-many choice and the OS list is the right affordance on a phone"* — with `.pmk .dsel option` setting `background`/`color`, *"the only two properties [the OS popup] honours, and without them a dark page opens a white menu."*

---

## Replaying a session (2026-08-27)

`server-v2/premarket-replay-recorder.js` takes the same capture the freeze takes, **every 5 minutes from 04:00 to 16:25 ET**.

> There is no replay rendering path. Moving the scrubber moves an index; the whole page — the regime strip, the level rail, the six Key Levels tiles and their prior-close lines, the scrolling profile, DEX/vanna, the expected-range track, the bell curve, the playbook, both tabs — re-renders as that minute, recomputed here and now by the memos the live page runs.

**`viewMin` takes the FRAME's minute**, which is what rewinds everything time-relative with it — "22 min to open", the RTH-open / after-the-close label, the Post-Market tab's in-progress vs finished state. *"A replay whose clock stayed on the wall time would show 10:05's chain under 'after the close' — the same class of lie as showing today's numbers under a past date."*

**The trim, said out loud**

> A frame keeps **±20 listed strikes** around that minute's spot: an untrimmed SPX 0DTE board is ~100KB and a session of them would not fit in one request, and one request is what lets the scrubber run with no per-frame round trip. The walls, gamma flip and total net GEX are the server's FULL-BOARD values and pass through the trim untouched; anything this page scans the chain for (max pain, DEX/vanna totals, the profile's and bell curve's wings) is over that window on a replayed frame, and the replay bar says so.

`replayTrim = replayFrame?.payload?.trimmedSide ?? 0`, and the ⓘ note prints `±{replayTrim} strikes` when it is non-zero.

**Landing frame, and the stop.** A newly loaded session lands on its **LAST** frame:

> entering replay from the live page should show the session as it ENDED, not as it looked at 04:00, and the scrubber is then dragged backwards. (ChainReplay lands on frame 0 because it is a standalone player you press Play on; this one is the page, and the page's default is "now".)

The stop-at-the-end lives in its **own effect**, not in the interval's updater:

> Deliberately NOT inside the updater above: updaters must be pure (StrictMode runs them twice) and setting state from one double-fires the pause. Same note lives in ChainReplay.

Pressing Play on the last frame **rewinds to 0 first** — *"otherwise the button looks dead at exactly the position the page always lands on."*

**The bell curve's fixed axis.** `replayAxisAnchor` is computed over **every frame**, not the current one, so it does not move as the scrubber does:

> Every chart on this page centres its strike window on spot, and on a live board that is invisible — spot moves a point at a time. Stepped through a recorded session it is the opposite: spot jumps every frame, the window re-centres every frame, and every bar slides sideways under the cursor. The page reads as SHAKING, and the one thing a replay exists to show — which strike grew — is the one thing that will not hold still long enough to be watched.

```js
center   = (minSpot + maxSpot) / 2
halfSpan = (maxSpot − minSpot) / 2     // also a FLOOR on the window
```

> because the floor covers the day's whole travel, pinning the axis can never push spot off the side of its own chart.

**The docked transport.** `REPLAY_SPEEDS = [0.5, 1, 2, 4, 8]`, `REPLAY_BASE_MS = 700`. Interval is `REPLAY_BASE_MS / replaySpeed`.

> Deliberately the same numbers ChainReplay and MultGreekClient's replay use — 700ms a frame at 1×, 0.5× to 8× — so the three replays on this site feel like one control rather than three opinions about how fast a session should run.

The bar is **outside `.wrap`, last, and sticky**:

> `.pmk` is this page's own scroll container (`height:100%; overflow:auto`), so a `position:sticky; bottom:0` last child of it is pinned to the bottom edge of the viewport for the whole scroll and comes to rest in flow at the very end — nothing is ever permanently covered.
> It used to sit under the head, inside `.wrap`, and that was wrong for what this replay actually is: the page IS the replay, the page is five screens tall, and the thing most worth watching build — the book, over on the Post-Market tab — is nowhere near the top. A transport you have to scroll back up to reach is a transport you stop using.

CSS: `z-index:30`, `padding:9px 20px 10px`, `border-top:1px solid var(--cyanEdge)`, `background: linear-gradient(var(--cyanWash), var(--cyanWash)), var(--plate)` — *"Cyan wash OVER the app's opaque plate: the wash alone is translucent and the page scrolls beneath this bar"* — and `box-shadow: 0 -14px 34px` at 34% `--color-shadow`. `.rplwrap` repeats `.wrap`'s `max-width:1560px; margin:0 auto` so the transport lines up with the page.

**The controls are `/es-candles`' controls, part for part** — `DockButton` for every transport key, `SegGroup` for the speed strip, `DockSlider` for the scrub, `● Live` to leave and `✕` to close: *"That page's replay is the one people learn first, and two replays on one site that look different read as two features with two sets of rules."*

The `✕` is **outside** the has-frames branch: *"on a session with nothing recorded the bar is one sentence, and a dock you can open and not close is a trap."* The date stepper `◀ ▶` walks **only the sessions that actually have frames** — *"Stepping onto a date with no recording would be a control that turns itself off."* Landing on a non-recorded date steps to the newest recording instead of doing nothing.

The coverage caveats moved behind the ⓘ toggle: *"a docked bar spends viewport permanently, and the transport is what earns it."*

---

## The ET clock, and what `viewDate` / `viewMin` mean

`etWall(clock)` returns `{ date, minutes }` in `America/New_York`. The clock ticks every **30 s** and leads the component, *"the SESSION PICKER below needs today's date before the data source is chosen."*

```
RTH_OPEN_MIN  = 570   (09:30 ET)
RTH_CLOSE_MIN = 960   (16:00 ET)
afterClose    = etMin >= RTH_CLOSE_MIN + 5     // 16:05, the SETTLE, not the bell
```

> the last frames still land in those five minutes.

| | live | frozen | replay |
|---|---|---|---|
| `viewDate` | `etDate` | `sessionDate` | `sessionDate` |
| `viewMin` | `etMin` | `RTH_CLOSE_MIN + 10` = 970 | `replayFrame.minute` |

A frozen day *"is over, so it reads as just past the settle: that is what puts the Post-Market tab into its finished state instead of a mid-session one."* `openLabel`, verbatim: `session closed` (frozen) / `RTH open in {h}h {mm}m` (before 09:30) / `RTH open` / `after the close`.

---

## The scale constants — one page, fourteen instruments

> Everything below used to be written for SPX, where a level is a whole number, a "point" is ~0.015% of price and 10 points is a pin. None of that survives contact with a $180 name: `fmtPx(strike, 0)` turns a 187.50 strike into "188", and a 1-point threshold that means "noise" on SPX means 0.6% on NVDA — the difference between "flat overnight" and a real gap.
> So three values are derived from the board itself and used everywhere a literal used to be. **On SPX they evaluate to exactly what was hard-coded, so the SPX page is unchanged to the digit.**

| Constant | Formula | Meaning |
|---|---|---|
| `kDp` | smallest gap between adjacent listed strikes: `<0.5 → 2`, `<1 → 1`, else `0`; no ladder → `spot >= 1000 ? 0 : 2` | decimals for a **level that IS a listed strike** — the walls, CORE, max pain |
| `pxDp` | `spot >= 1000 ? 0 : 2` | decimals for a **traded price** — spot, ES, and the GAMMA FLIP |
| `pxEps` | `max(0.01, spot × 0.00015)` | one "point". 1.0 on a 6,800 SPX; 0.03 on a $180 name |
| `pinEps` | `max(0.05, spot × 0.0015)` | "pinned to the magnet". ≈ the 10 SPX points it replaces |
| `gapEps` | `max(0.01, spot × 0.00004)` | below this there is no gap. Was a flat 0.25 — one ES tick — *"which on a $30 name is a 0.8% move being called 'flat'"*. Still ~0.27 on SPX |

**The flip takes `pxDp`, not `kDp`, and that is the interesting case:**

> The flip is the one that reads like a strike and is not one: `findGEXFlip` INTERPOLATES between two strikes and keeps a tenth of a point. Rounding it to the strike grid throws away the interpolation it just did and prints a strike that is not the answer. On SPX both constants are 0 so nothing moves; on a sub-$1000 name with dollar strikes the flip was printing "49" for 48.83, next to a SPOT label on the same axis reading "48.75".

`livePx = sym === "SPX" ? esFut : spot` — *"SPX reads the ES future because cash SPX does not trade overnight; every other symbol trades its own extended session, so its own last IS the reference and running it through a basis would be inventing a price."*

---

## Every derived number

Units: GEX in raw dollars unless stated; distances in index points; percentages as printed.

| Number | Formula |
|---|---|
| per-strike net GEX (`perStrike`) | `callGEXOf + putGEXOf` = `|callγ|·(OI+Vol)·S² − |putγ|·(OI+Vol)·S²`, sorted ascending by strike. **Fixed at OI+Vol** |
| `totalNetGex` | the feed's own board total (socket / freeze / frame / `Σ netGEXOf` on a chain poll) |
| `maxPain` | classic: the strike minimising `Σ_r [S>r.k] callOI_r·(S−r.k) + [S<r.k] putOI_r·(r.k−S)`. Needs ≥ 5 rows with OI |
| `magnet` (0DTE MAGNET) | the largest `|net|` in the **NEAR window**, `NEAR_HALF = 12` strikes each side of spot. *"A magnet picked off the whole ladder would be stolen by a single monster strike 200 points out"* |
| `coreBullseye` (CORE / CB) | the feed's derived `core` when the source carries it; else the largest `|net|` over the **whole** `perStrike`. *"Deliberately NOT a window around spot: a ±N-strike window moves its own edges as price ticks, so the CORE can jump twenty points on a quote with nothing having changed in the book"* |
| `flipStrike` | nearest listed strike to `flip`, off the **whole ladder** *"so it does not change as the panel scrolls"* |
| `totals.dex` | `Σ netDEXOf(r, "net", spot)` — precomputed legs win; the fallback rebuilds it as delta × contracts × spot × 100 |
| `totals.vanna` | `Σ (netVanna + netVolVanna)` **only if any row carries one**, else `null` |
| `totals.callGex` / `putGex` | `Σ callGEXOf` / `Σ putGEXOf` |
| `em` (expected move) | ATM straddle × **0.85** (`callMark + putMark`, falling back to the bid/ask mid on the call), else `spot × ATM IV × √(1/252)`, else null |
| `emLo` / `emHi` | `spot ∓ em` |
| `conviction` | overlap of the EM band and the wall-to-wall band, as % of the EM band: `max(0, min(emHi, max(pw,cw)) − max(emLo, min(pw,cw))) / (emHi − emLo) × 100` |
| `distFlip` / `distCall` / `distPut` | `spot − flip` / `callWall − spot` / `spot − putWall` |
| `netGexChangePct` | `(oiVsBaseline.live − oiVsBaseline.base) / |base| × 100`, **OI leg both sides, intersection strikes only** |
| `strikeDeltas` | top 4 by `|oiLeg − baseline.byStrike[k]|`. A strike the baseline never listed is **skipped, not zeroed** — *"a new strike would otherwise print its whole gamma as 'change', which it isn't"* |
| `leavesAtBell` | `multiGex.all.totalNetGex − ex0.totalNetGex` — the front tranche's share of the net, *"stated as the subtraction it is rather than as an invented percentage of it. (A share of ABSOLUTE gamma cannot be recovered from two signed nets.)"* |
| `onRange` | `overnight.hi − overnight.lo` |
| `gap.pts` / `gap.pct` | `ref − pdc` / `pts / pdc × 100` where `ref = openPx ?? livePx` |
| `gap.retrace` | `clamp(0, 100, (ref − extreme) / (ref − pdc) × 100)`, `extreme` = today's RTH low on a gap up, high on a gap down. *"Uses the extreme in the fill direction, not the last price, so a fill that already reversed still reads as filled/near-filled"* |
| `gap.remaining` | `filled ? 0 : pdc − livePx` |
| `gap.outside` | `ref > pd.hi \|\| ref < pd.lo` |
| `sectorRows` | top 3 + bottom 3 of `sectorBars` by `chg5d`, de-duplicated |
| `onPos(px)` | `clamp(0,100, (px − (lo − pad)) / (span + 2·pad) × 100)`, `pad = span × 0.18` — *"12%..88% of the track, matching the mockup"* |
| `emPos(px)` | the same with `pad = span × 0.10` |
| `rail.pos(px)` | `(px − dLo) / (dHi − dLo) × 100`, `dLo/dHi = lo/hi ∓ span × 0.14` — *"room for the outermost caps"* |

`etClockOf(minute)` → `HH:MM`; `sessionLabel(date)` → the picker's human label.

**The formatters (`format.ts`).** One copy for all three surfaces. These lived three times over and the third had drifted four ways: `fmtUsd` printed millions at one decimal ($1.4M) against the others' zero ($1M) and never signed a positive; `fmtPts` dropped the " pts" suffix; `fmtPx` had no `v <= 0` guard so a zero settled level printed "0"; `pillClass` mapped the `vio` tone to a plain pill, losing the violet the PINNED reaction carries. **"None of that was a decision anyone made. It is what three copies of the same twenty lines turn into."**

```
nf(v, dp)     locale-grouped fixed decimal, no sign
fmtPx(v, dp)  '—' for null / NaN / v <= 0 — "a zero price is not a price"
fmtPts(v)     '+N pts' / '−N pts' (U+2212), always carries its unit
fmtPct(v, dp) '+N.NN%' / '−N.NN%', default 2dp
fmtUsd(v, signed=true)  ±$1.92B / ±$840M / ±$12.4K / ±$840.
              `signed` controls only the PLUS — "a dollar figure that hides its sign
              is worse than no figure"
```

---

## Section 1 — the regime strip

`.regime` is a four-column grid collapsing to one below 1180px.

**The badge.** A dot (`off` / `neg` / default) plus two lines:

| `hasData` / sign | Label | Sub |
|---|---|---|
| no data | `WAITING FOR FEED` | `no chain frame yet` |
| positive | `POSITIVE GAMMA` | `Dealers long gamma · mean-reverting tape` |
| negative | `NEGATIVE GAMMA` | `Dealers short gamma · moves get amplified` |

`posGamma = (totalNetGex ?? 0) >= 0`. The whole `<section>` takes `.is-neg` when negative, which is what tints the page's regime wash.

**Three KPIs**, separated by `.vr` rules (hidden below 1180px):

1. **Net GEX** — `fmtUsd(totalNetGex)` plus, when available, `▲/▼ {|pct|}% <small>OI</small>` at 11px with `title="OI-basis change vs the {baseline.date} close"`. When null: `<small>vs prior close —</small>`. The chip is labelled `OI` because *"mixing the bases silently is how you get a permanent premarket ▼ that is really just yesterday's volume falling off."*
2. **Gamma Flip** — `fmtPx(flip, pxDp)` plus `{fmtPts(distFlip)} / {fmtPct(distFlip/spot×100)}`.
3. **SPX / ES** (or the ticker) — `fmtPx(spot, pxDp)`, then `· ES {fmtPx(esFut, 2)}` on SPX, or the symbol's own day % elsewhere. *"On every other symbol this is the ticker's own last and its day change — not a futures price shifted by a basis, which would be a price that never traded."*

**The bias card.** Title `Range day — fade the walls` / `Trend day — follow the breaks`. Detail: `Flip unavailable — no crossing in the current chain.` or `{Above|Below} flip by {n} pts. {Suppression|Acceleration} regime until {flip} {breaks|is reclaimed}.`

---

## Section 1b — the GEX level rail

`.gexrail`. Five levels on **one shared price domain**, which is the whole point: PW, FLIP, CORE (`max γ strike`), SPOT, CW.

Domain: `lo`/`hi` over the placed marks, padded by `span × 0.14`. Caps **alternate up/down in PRICE order** (`i % 2`), and their `left` is clamped to `4%..96%`. The band between the two walls is drawn as `.band`. A rail with fewer than two marks renders nothing and the panel says `Waiting for the chain…`.

Header right: `{lo} – {hi} · {span} pts`, or `waiting for the chain`. Each cap shows the code, the long name (`.ln`, **dropped below 1180px** — *"Five caps on a narrow rail: keep the code, drop the long name"*), the price at `kDp`, and the distance — except SPOT, which shows `ES {n}` where a basis exists and `live` otherwise.

Colours: PW `var(--pw)`, FLIP `var(--amber)`, CORE `var(--violet)`, SPOT `T.text`, CW `var(--cw)`.

---

## Section 2 — Key Levels

Six tiles in a `repeat(6, 1fr)` grid (`repeat(3, 1fr)` below 1180px), each `border:1px solid var(--card)`, `border-radius:var(--r)` (12px), `background:var(--panel2)`, with a 21px value line.

**The basis switch.** Three segmented buttons, persisted in `localStorage`:

| Tab | Long | Formula | Hint (verbatim) |
|---|---|---|---|
| `OI` | OI only | γ × OI × S² | `γ × OI × S². Both sides of the overnight Δ carry the same settled OI, so the change is pure gamma re-pricing. The honest premarket basis.` |
| `OI+VOL` | OI + Vol | γ × (OI+Vol) × S² | `γ × (OI+Vol) × S² — what the profile bars and the Net GEX KPI print. Premarket the Δ drags yesterday's whole session volume in; read the levels, not the change.` |
| `VOL` | Vol only | γ × Volume × S² | `γ × Volume × S². Today's trading only — near zero before 09:30, and the cleanest read on what is actually being traded once the session is running.` |

> This is deliberately NOT the page-wide basis: the profile bars, the rail and Biggest Changes keep their own (documented) bases. The switch exists because the same six levels answer different questions on each leg, and reading them on one leg while the Δ beside them is computed on another is the exact mismatch the OI default was chosen to avoid.

`lvlByStrike` is a separate map from `perStrike` on purpose — *"the bars, the rail and the magnet must not move when the tiles' basis changes."*

**The head line**

| Condition | Text |
|---|---|
| loading / idle | `prior-close baseline loading…` |
| no baseline at all | `no prior-close baseline — levels only` |
| baseline exists but not for this basis | `no prior-close baseline on the {OI only\|OI + Vol\|Volume only} basis — levels only` (in amber) |
| ok | `vs **{baseline.date}** close · {basis long} basis` |

`basisMap()` returns **null** rather than a plausible wrong number:

> `byStrike` is on whatever basis the fetch asked for (`oi`), so on the VOL and OI+VOL tabs it is the WRONG map — using it would print a Δ that is entirely basis mismatch. When the server predates the per-strike legs, those two tabs get null and the tiles say "no baseline on this basis" instead of a plausible wrong number.

`byStrikeOi` / `byStrikeVol` are **optional on purpose**: *"a VPS running a build that predates the server change returns neither, and `basisMaps()` degrades to 'OI only has a baseline' rather than silently diffing one basis against another."*

**The migration line.** `MigLine` renders **nothing** when it has nothing to say:

> That is the whole contract — a tile with no baseline for the selected basis must look like the tile always did, not like a tile reporting no change. `null` in, null out.

A percent is omitted off a near-zero base (`|was| <= 1e6`): *"the VOL tab premarket is all zeros… omitted rather than printed as a huge bogus number."*

**What each tile can and cannot say** (verbatim from the memo):

| Tile | Migration |
|---|---|
| Call Wall / Put Wall | strike moved (`baseline.callWall/putWall`) **and** the gamma at the CURRENT strike re-priced (`byStrike`) |
| Gamma Flip | **strike only.** The baseline's flip is OI+Vol on the server regardless of basis, so it is shown on every tab and labelled as a level move, never as a gamma Δ |
| Spot | prior settle, from `baseline.spot` — the overnight gap |
| 0DTE Magnet | gamma at the magnet strike, **incl. a sign flip**, *"which is the single most useful thing a magnet can tell you overnight (a +γ pin that went −γ is now a launch pad)"* |
| Max Pain | **NOTHING.** *"Max pain needs per-side OI, and the baseline stores net GEX per strike. Deriving it from what we have would be an invention, so the tile keeps its existing drift pill and gains no 'was'."* |

**`wallState` — read on magnitude, not sign**

> a put wall's gamma is negative: −39.2M from −37.0M is the wall getting HEAVIER, and calling that "down" because the number fell would invert the only thing the tag is for.

Under **2%** either way is `unchanged` — *"noise on a re-priced chain, not a migration."* A sign change is `flipped sign`. Call wall words: `building` / `eroding`; put wall words: `deepening` / `easing` (`"deepening" = MORE negative gamma, i.e. a heavier floor`).

**The six tiles**

| Tile | Name / em | Value | Sub-line | Pill |
|---|---|---|---|---|
| Call Wall | `resistance` | `fmtPx(callWall, kDp)` | `ES {n} · {fmtUsd(wallGex.call, false)}` | `ON high tagged` when `overnight.hi >= callWall + basis`, else `untested o/n` |
| 0DTE Magnet | `max γ` | magnet strike | `ES {n} · {value on the selected basis}` | `pinning` when `|strike − spot| <= pinEps`, else `magnet` |
| Spot | `live` | `fmtPx(spot, pxDp)` | ES + % on SPX; the symbol's own change elsewhere | `openLabel` |
| Max Pain | `0DTE`/`front` | `fmtPx(maxPain, kDp)` | `ES {n}` or `OI-weighted` | `drift ↑` / `drift ↓` |
| Gamma Flip | `regime` | `fmtPx(flip, pxDp)` | `ES {n} · zero γ` or `zero γ` | `{(|distFlip|/em).toFixed(1)}× EM away`, `.warn` below 0.5× |
| Put Wall | `support` | `fmtPx(putWall, kDp)` | `ES {n} · {fmtUsd(wallGex.put, false)}` | `ON low tagged` when `overnight.lo <= putWall + basis`, else `untested` |

The magnet's **strike stays the OI+Vol pick** while its value follows the basis: *"so the magnet does not jump around as you switch tabs — it is a structural choice (biggest |γ| in the near window), not a reading of one leg."* Wall-migration note text: `wall moved {fmtPts(move)} from {fmtPx(was, kDp)}`, drawn only when `|move| >= pxEps`. Spot's tag is `flat o/n` / `gap up` / `gap down`. Flip's tag is `held` / `rose {n}` / `fell {n}`.

---

## Section 3 — the two ladders

`.body.two` — a 1fr 1fr grid, **one component mounted twice**:

> LEFT the front expiry (0DTE on SPX) — the map for the open. RIGHT every listed expiration with that tranche removed — the standing book, the levels that are still there tomorrow. One component mounted twice (`premarket/GexProfile.tsx`), never two copies of the same JSX: the read is the COMPARISON between the two boards, and it only works if the two charts are pixel-identical. Each wears its OWN walls and flip — see `tagForEx`.

Left sub-line: `{0DTE|front} {expiry} · OI + Vol · scroll`. Right sub-line: `all {N} expirations less 0DTE · OI + Vol · scroll`.

**Tags.** Left (`tagFor`), first match wins: `CALL WALL` (`--cw`) → `PUT WALL` (`--pw`) → `0DTE MAGNET` (`--violet`) → `MAX PAIN` (`--blue`) → `GAMMA FLIP` (`--amber`).

Right (`tagForEx`): only `CALL WALL` / `PUT WALL` / `GAMMA FLIP`, all from **`ex0`'s own** server-computed values:

> Reading the front expiry's pin against the standing book's bars is the exact mistake this panel exists to make impossible, so its tags are never borrowed.

**`GexProfile` geometry**

```
PROFILE_ROW_H  = 19   // interpolated into `.pmk .row` AND used by the scroll maths
PROFILE_VIEW_H = 440  // FIXED, not a max
PROFILE_PAD    = (440 − 19) / 2 = 210.5   // half a viewport at EACH end
VIEW_HALF      = 60   // ±60 strikes render, and the scale is taken over the SAME window
```

**The bar scale is normalised over the rendered window**, and the story of why is one of the file's best:

> It used to normalise over a NARROWER ±12 "near" window… What it actually produced was the opposite failure: on the ex-0DTE board — 55 expirations stacked up, so the standing walls sit well outside ±12 — most of the ladder came out at a width ABOVE 100%… those bars ran off the right edge and were sliced flat at the panel border… the axis said $678M while bars several times that were drawn the same length as it. **A scale that only describes 25 of the 121 rows it is drawing is not a scale.**

Bar width: `w = min(50, |net| / (net >= 0 ? maxP : maxN) × 50)` — half-track each side. The clamp *"is a guard and not a mechanism — but it is what guarantees the 'sliced flat at the border' picture can never come back."*

**The padding is not decoration:**

> Centring is `scrollTop = rowTop − (view − row) / 2`, and scrollTop cannot go below 0 or above `scrollHeight − clientHeight`. Without room past the ends of the ladder, a spot within ~11 rows of either END has NO scroll position that centres it… So the box is a FIXED height with HALF A VIEWPORT of padding at each end. The first and last rows can both reach the middle, the centring target is exactly `i * ROW_H` for every row on every ticker, and the clamp is unreachable.

`centerOnSpot()` **returns false when it cannot measure**, and the retry loop is sized for the worst case:

> `el.clientHeight` is 0 until the panel has been laid out, and a 0 there makes the target the row's own offset, which the browser clamps to the maximum scroll — the card then opens scrolled to the BOTTOM of the ladder and stays there. On the live SPX socket that was survivable (a new frame a second later re-ran it); on a chain-poll symbol the next attempt is SIXTY SECONDS away, so the first bad centre is what you look at.

**~90 rAF tries**, not 20: *"a tab that mounts in the background, a font that settles late or a slow first paint can all push the first measurable frame past a third of a second."* A `ResizeObserver` re-centres on every box change, and it is attached **unconditionally** — *"It used to sit behind [the pinned check], so a panel that happened to be un-pinned when the effect ran got no observer at all and then never re-centred once it was re-pinned."*

**`gestureAtRef` — the un-pin rule.** The panel un-pins only on a scroll the **reader** performed, and the question is asked the other way round:

> It used to try to tell them apart by remembering the scrollTop it had written, and that broke on the case that matters most: switch symbol → the old ladder's 121 rows are replaced by an empty one → the browser CLAMPS scrollTop from 1,140 to 0 and fires a scroll event → that event matches neither guard, so the panel un-pinned itself → the new symbol's board then loaded and was never centred, opening sixty strikes above the money with "back to spot" already showing. **Which is exactly what AMD did.**
> So: a scroll only counts as the reader's if a wheel, a drag, a touch or a key happened just before it. Nothing else can un-pin the panel, which makes every one of those cases safe by construction rather than by a guard per case.

Window: **700 ms** — *"comfortably longer than the smooth-scroll a single wheel notch produces and far shorter than any gap between a gesture and an unrelated reflow."* `resetKey` is the **symbol** (`{sym}|front` / `{sym}|ex0dte`): *"scrolling away on SPX and then picking NVDA must not leave the new board parked at the old one's offset."*

`rowTop()` adds `PROFILE_PAD` because *"an absolutely positioned child is placed from the PADDING edge while the rows begin after the padding. Without it both rules sit half a viewport above the row they name."*

**The greeks strip (left pane children)**

| Tile | Value | Meaning line |
|---|---|---|
| DEX | `fmtUsd(totals.dex)` | `calls leading · tilt ↑` / `puts leading · tilt ↓` |
| Vanna | `fmtUsd(totals.vanna)` | `vol down helps ↑` / `vol down helps ↓` / `no per-contract vanna on this feed` |
| Call / Put γ | `{callGex}` / `{|putGex|}` | `call side heavier` / `put side heavier` |

Vanna is **nullable and that is the point**:

> It is the one greek the page cannot recompute… a chain that does not carry one has no vanna — not a vanna of zero. Summing `?? 0` across such a chain printed a confident "$0" that read as "vanna nets out here" when it meant "we were never told". Null renders "—", the same as every other underivable number on this page.

**The ex-0DTE strip.** `Net GEX · whole board` / `Net GEX · ex-0DTE` / `Leaves at the bell`. The ex-0DTE meaning line reads `the book underneath dampens` / `the book underneath amplifies` / `no standing book yet`. `Leaves at the bell` is **signed like its two siblings**:

> it was the only one of the three rendering in plain text, so a front tranche that leaves NEGATIVE gamma behind looked neutral next to two coloured tiles.

**Right-pane empty states, verbatim**

| Condition | Text |
|---|---|
| frozen or replay | `The whole-board sweep reads the live chain, so there is no version of it for a past session.` |
| `state === "error"` | `The whole-board sweep did not answer.` |
| `state === "empty"` | `Nothing but 0DTE listed on this board.` |
| loading | `Sweeping every expiration…` |

**`useMultiExpiryGex`'s 400 ms delay — not a nicety**

> On a symbol switch this effect re-runs on the very render where `sym` became AMD but `spot` is still the OLD symbol's price — `useChainGex` has not cleared its state yet. Firing immediately kicked off a full multi-expiry SWEEP for AMD against a 771.43 spot, which the next render then aborted and re-issued at 469.35. Two sweeps, one of them nonsense, every time the picker moved (it is visible as a cancelled request in the network waterfall).

`spot` also rides a **ref**, not the effect's deps: *"It ticks several times a second on the socket board, and re-running the effect on each tick would restart the poll (and defeat the server's per-minute cache) for a number the sweep barely uses."*

---

## Section 4 — context (two columns)

**Overnight column.** Header: `Overnight Context` · `{ES · 18:00 | {SYM} · ext} → {HH:MM} ET`.

> SPX's overnight is the ES Globex session, 18:00 on. A stock's is its own extended session, which starts at 04:00 — same window logic (everything before today's 09:30), different instrument and a different hour, so the label says which.

**The candle pool** is deliberately the **un-clipped** history, not the hook's `sessionCandles`:

> `sessionCandles` is clipped to a rolling 30 HOURS, which was the right window for a chart and the wrong one for the prior RTH close: on a Monday premarket the Friday 16:00 bar is ~64h old, so it is not in there, `pdc` came back null, and "Prior RTH close (ES)", "Gap" and "Gap fill target" all printed "—" every Monday (and every day after a holiday).

It is **not de-duplicated and not sorted**, on purpose: *"Everything `overnight` does with this is a min / max / latest-timestamp scan, and all three are idempotent under duplicates — so a slot present in both arrays costs nothing, while a Map+sort here would run at the live feed's 4Hz over ~8 sessions of bars for no benefit at all."*

**`historyDays` is 8, not 3** (2026-08-24): *"`daysBack` is CALENDAR days, and the two things below need the prior TRADING session — which on a Monday is three calendar days back and on a Tuesday after a Monday holiday is four. A 3 sat exactly on the Monday boundary and fell off it entirely after a holiday."*

**Two prior dates, because on a Monday they are not the same day:**

| | Definition |
|---|---|
| `pdDate` | the last session before today that actually TRADED RTH — Friday on a Monday. *"'Prior RTH close' and 'prior day range' mean this one, and nothing else"* |
| `evDate` | the last date before today carrying a Globex evening (≥ 18:00) bar — **SUNDAY** on a Monday |

> This used to be one `pdDate`… Inside a 30-hour window those collapse to the same thing and it worked; over a weekend they do not, and the single date landed on SUNDAY — which has no RTH bars at all, so pdHi/pdLo/pdc stayed null and the gap rows went blank.

The overnight range is pinned to `evDate` *"so the wider pool cannot fold FRIDAY evening into a Monday overnight range."* `pdc` is the **last RTH bar's close** of `pdDate` — *"Deliberately not the last overnight print."*

**The ON bar.** `.onrange`, 52px. ON low at 12%, ON high at 88%, a blue gradient fill between them, plus markers for `livePx` (white, taller) and `PDC` (dim). Empty: `No overnight bars yet.`

**The stat rows**, in order: `ES change`, `NQ change`, `ON range`, `Prior RTH close ({ES|SYM}) {sessionLabel(pdDate)}`, `VIX`, `Gap`, `Gap fill target`, the gap bar, `Prior day range`.

ES and NQ stay on **every** board: *"They are the market's context for whatever name is on screen, not SPX trivia — and the row count of this column does not change with the symbol."*

**VIX's colour is inverted and that is correct:**

> Up is red because a rising VIX is the tape getting worse, not better — the colour on this page means "good or bad for the book", not "the number went up". **Do not "fix" this to match its neighbours.**

**The gap.** Label `Gap (projected)` before 09:30, `Gap (4pm → 9:30)` after:

> BEFORE 09:30 there is no open yet, so the front ES stands in for it and the row is marked PROJECTED — it moves until the bell and should not be read as a fact. From 09:30 the gap is FIXED at the printed open and never moves again for the rest of the day.

Pills: `✓ FILLED` (cool) / `projected · pre-open` / `outside PD range` (warn) / `inside PD range` / `gap up` / `gap down`. `outside` is *"the read that changes how you trade it: a gap opening beyond yesterday's range has no reference above or below it, so it runs or fails hard, while a gap inside the range is in known territory and fills far more often."*

Gap fill target: `✓ filled at {pdc}` or `{pdc} ({n} pts up|down · {r}% retraced)`. The `.gapbar` below it fills to `retrace` (or 100% when filled), blue while open and `--pos` when closed, labelled `gap closed` or `{r}% of the gap retraced`.

**Biggest GEX Changes.** Head note: `vs {baseline.date} close · OI basis`. Four diverging bars, each scaled to `|delta| / max × 50`% from the centre. Empty states:

| Condition | Text |
|---|---|
| loading / idle | `Loading the prior-close board…` |
| empty | `No prior-session board for {SYM} {expiry} yet — server-v2/premarket-baseline.js records one at 16:05 ET each session (and its ALLOWED_SYMBOLS list gates which symbols it will sweep), so this fills in after the next close.` |
| otherwise | `No strike moved against the prior close.` |

**Sector Heat.** `Market Quality · 5d %`. Top 3 + bottom 3 by `chg5d`, each tile's border at `alpha(c, 0.15 + a)` and fill at `alpha(c, a × 0.25)` where `a = min(0.35, |v| / 12)`, `c = v >= 0 ? T.green : T.red`. The note records the fix: *"Was a pair of raw RGB channel strings — a hand-typed green and red that stopped tracking the theme the day it moved."* Empty: `Loading sector data…`. **Sector heat is not recomputed here — Market Quality already owns it.**

**Expected Range column.** The EM track (`.onrange`, 58px) draws the band from `emLo` to `emHi` in a violet gradient, with Put Wall and Call Wall plotted **inside** it and spot marked in white. Centre cap: `EM ±{(em/spot×100).toFixed(2)}% / ±{nf(em, pxDp)} pts`. Empty: `No ATM straddle yet — expected move unavailable.`

Stat rows: `IV-implied move`, `GEX-implied range`, `Overlap / conviction`, `Overnight range`, `Market quality`.

| Reading | Bands |
|---|---|
| Overlap / conviction | `HIGH` ≥ 60, `MEDIUM` ≥ 35, else `LOW`, with the % beside it |
| Market quality | `{round(score)} / 100 {decision}`, green ≥ 60, neutral ≥ 40, else red |

**The playbook.** Head `Today's one-liner`. Body: `{Positive|Negative} gamma, flip {n} pts {below|above}, Call Wall {n} {above|below}, Put Wall {n} {above|below} — ` then bold: `fade extremes, scalp toward the {magnet} magnet.` (positive) or `stand aside at the edges, trade continuation through the walls.` (negative). Before data: `Waiting for the first chain frame.`

Three scenarios, verbatim:

- ▲ `Above {callWall}` — `call wall break. Chase only with DEX confirming; gamma thins out above.`
- ◆ `{putWall}–{callWall}` — `base case.` then `Fade the edges, target {magnet}.` or `Two-sided and fast; size down.`
- ▼ `Below {flip}` — `flip breached, regime turns negative. Stop fading; trend short toward {putWall}.`

**Catalysts.** Keyed to `viewDate`, so a frozen date asks for that day's catalysts — *"a date far enough back simply has none and the panel shows nothing, which is the honest answer, and much better than printing today's Fed speakers next to last Tuesday's chain."* Up to 4 USD High/Medium/President events, plus up to 2 earnings (by market cap). Empty: `Nothing scheduled on the US calendar today.` Stale events render at `opacity: 0.5`.

Four pill tones, not three:

> A "President" entry used to fall through to the bare pill, which put a Trump headline on the same visual footing as a Low-impact housing print — and the impact ramp has carried a distinct colour for it (`--color-impact-president`) the whole time. Holiday and Low keep the bare pill: they genuinely are the quiet ones.

---

## The gamma bell card (full width)

Two stacked panes over **ONE strike axis**:

> **TOP** gamma mass per strike (`|call GEX| + |put GEX|`) as a histogram, with a LEAST-SQUARES normal drawn through it. "What bell would you draw through these bars, and how wide is it?" **BOTTOM** net GEX per strike, green above zero and red below, with the long-gamma / short-gamma sides named on the pane. "Which side of the board dampens and which amplifies?"

Layout: `PAD = { t: 68, r: 18, b: 44, l: 72 }`, `GAP = 16`, `TOP_SHARE = 0.6`, `NET_HEAD = 1.14`. The top pad carries *"up to THREE packed rows of level labels, and each row now drops its leader through its OWN horizontal lane… the third lane needs room to clear the rule, hence 68."* `NET_HEAD` keeps ~7% of the net pane clear above and below the bars: *"the bar IS the edge of the card, which reads as a clipped chart rather than a full one."*

The two panes have **separate y scales**, deliberately: *"mass is always positive and the fit lives on it, while net GEX is signed and needs its zero line placed by the pos/neg split. They share only the strike axis, the level rules and the ±1σ band, which is exactly what makes reading down a strike from one pane to the other mean something."*

**Why least squares and not the moment fit**

> The moment fit (Σm·k / Σm and its sd) is dragged around by every far-OTM strike carrying a sliver of gamma. On a 0DTE board that inflates σ and pulls μ off the visible peak, so the drawn curve does not sit on the bars and the printed "σ = N pts" is not the width anyone can see. The least-squares fit answers the question the eye is asking. Both numbers are honest; only one of them describes the picture, and this card prints the one that does.

`lsqGaussian` is **Caruana's method**: take logs, a Gaussian becomes a quadratic in `k`, one weighted quadratic regression gives all three parameters in closed form. Weighting by mass *"is what stops the log from letting the near-zero tails — which are the majority of the strikes — dominate the fit."* Details:

- strikes below **0.5% of the peak** are dropped: *"a strike at 0.5% of the peak carries no shape information and its log is pure noise"*
- `x` is shifted by the mean strike: *"k is ~7,700, and k⁴ unshifted overflows the useful precision of the sums"*
- `c2 >= 0` (opens upward) → not a bell → fall back to the moment fit
- sanity gate: `σ > 0.3`, `σ < span × 2`, `μ` within one span of the used range, `0 < a < peak × 12`
- fewer than 5 usable bins → fall back

`massInside(rows, μ, σ)` = share of total mass inside μ ± σ, as a percentage.

**Window constants**

| Constant | Value | Meaning |
|---|---|---|
| `MAX_BAND` | `0.03` | the base board: ±3% of spot |
| `WIDE_MIN_STRIKES` | `60` | the floor, in **strikes** |
| `WIDE_MAX_BAND` | `0.30` | the ceiling on widening |
| `AUTO_MIN_STRIKES` | `20` | AUTO never shows fewer than this each side |
| `MAX_BARS` | `150` | above this, neighbours are folded |
| `MAX_BAR_W` | `48` px | the widest a single bar may be |
| `MIN_HALF` | `14` | zoom cap; the real floor is `min(14, 3 × gridStep)` |
| `WHEEL_IN` / `WHEEL_OUT` | `0.86` / `1.16` | GexChart's constants — *"the charts must feel identical"* |
| `YZONE` | `18` px | a drag inside this many px of the left edge scales Y instead of panning |

`wideHalfOf` exists because the band is a percentage and a strike ladder is not:

> SPX lists every 5 points (0.065% of spot), so ±3% is ~92 strikes. AMZN lists every $2.50 (0.97% of spot) — nearly fifteen times coarser in relative terms — so the same ±3% is SEVEN strikes, and the bell card drew seven bars with a "least-squares fit" through them.
> On SPX `dists[59]` is ~150 points against a 230-point base, so the base wins and nothing about the SPX cards moves. That is deliberate: this is a fix for coarse ladders, not a re-tune of the chart everyone already reads.

`AUTO_MIN_STRIKES` fixes the same problem from the other side: *"AUTO is `spot ± 4.5σ`, which is a statement about the gamma distribution and says nothing about how many bars that works out to… Widening the BOARD did not fix that, because AUTO was never hitting the board's edge; it was hitting its own σ."*

`MAX_BAR_W` likewise: *"A VOL board before the open, or any ±1% window on a coarse ladder, has under a dozen strikes in it — tiled across 1,400px that is nine 160px SLABS edge to edge, which is a colour field with a curve on top rather than a distribution anyone can read a shape off."*

**The basis tabs (card-local)**

| Tab | Formula | Hint |
|---|---|---|
| `OI+VOL` | `netGEXOf(r, "net")` | `γ × (OI + Volume) × S². The whole board: positioning carried into the session PLUS everything traded on top of it. SPX trades nearly around the clock, so the volume leg is never really empty and stripping it out understates the board.` |
| `VOL` | `netGEXOf(r, "vol")` | `γ × Volume × S². Today's trading only — the cleanest read on fresh repositioning, with the carried-in OI leg stripped out.` |

The `oi` tab is the **combined** board, and it used to be `net − vol`:

> that made sense when the volume leg was genuinely empty before 09:30. SPX now trades nearly 24 hours, so by the time anyone opens /premarket there is real volume on the board and subtracting it out was throwing away half the picture.

`rowMass` falls back to `|rowNet|` on a pre-summed row *"instead of being silently dropped."*

**Pan / zoom, and the one invariant.** Wheel zooms cursor-anchored, drag pans, a drag in the left gutter scales both panes vertically, double-click resets.

> **THE WINDOW IS A VIEW, NOT AN INPUT.** All three fits and all six KPI tiles are computed over the whole ±band this card reads, so panning and zooming cannot change what the card is claiming. Only the bars, the y-scales and the bar width come from what is on screen.

The card's basis / range / pan-zoom state is **its own**: *"the page's three-leg `lvlBasis` drives the Key Levels tiles, and folding them together would mean changing the tiles to change this chart."* Props from the page: `chain`, `spot`, `expiry`, `isZeroDte`, `flip`, `callWall`, `putWall`, `frozen = frozen || replay` (*"Says 'captured session, not live' in the card footer — true of a replayed frame for exactly the same reason"*), and `axisAnchor = replayAxisAnchor`.

The six KPI tiles are *"never floated over the plot. Three describe the FIT (peak, width, mass inside 1σ) and three describe the BOARD (its moment centre, net GEX, total mass). They are deliberately adjacent."*

---

## Section 5 — gamma book churn

`GexChurnHistory` — *"the SAME component the level log mounts, keyed to the symbol on screen instead of to a clicked row"*, so the two pages can never disagree about a ticker's churn. Feed: `/api/gex-gross-feed?symbol=&days=45`, the `gex_gross_daily` rollup written at **16:50 ET**. It spans the full row (`gridColumn: "1 / -1"`, `borderRight: 0`) and is passed `style={{ padding: 0, borderTop: "none" }}` because *"The component draws its own card padding and top rule for the log page's layout; the row it sits in supplies both, so they are zeroed rather than doubled."*

**One bar, two facts:**

> FILL = how much of this ticker's gamma book rewrote itself today. COLOR = whether that gamma was ADDED, ROTATED in place, or PULLED OFF.

Everything takes its absolute value **at the leg** before summing — `|call_gex| +
|put_gex|` — *"so a put build can never cancel a call build and report a busy session
as a quiet one."*

**The fill scale is not 0–100%:**

> Measured across the roster, the median ticker churns 16–19% of its book on an ordinary session and p90 sits near 40% — but on 2026-08-27 NVDA printed 312% and CRM 261%, and five of the top thirty cleared 100%. A bar that filled at 100% would peg on every interesting day and sit half-full on every dull one.

So the fill is **heat**: churn ÷ that ticker's own trailing clean average, where 1.0 is a normal day for it. *"SPY carries a $92B gross book and WEN $3.7M; any roster-wide percentage ranks by ticker size, not by what happened."* Below enough clean sessions the feed sends `heat: null` and the bar *"falls back to a fixed provisional churn scale and SAYS so (hatched track). It never silently shows a ratio against an average of three days."* Tick marks for "normal" and "hot" are **not drawn** on the provisional scale — *"that bar has no per-ticker normal yet."*

**Colour is `build_share`, which is bounded** to `[−1, +1]` by the triangle inequality:

```
+1  pure addition — gamma arrived, nothing left      (LIGHT_BLUE, bright)
 0  pure rotation — as much came off as went on      (dim, either hue)
−1  pure unwind   — gamma left, nothing replaced it  (ES_CANDLE_DOWN)
```

`buildShareColor` = `alpha(mix(to, T.panel, RAMP_FLOOR + (1−RAMP_FLOOR)·|s|^RAMP_EASE), a)` with `RAMP_FLOOR = 0.4`, `RAMP_EASE = 0.55`. Ported note: *"v2 read both anchors as hex and interpolated the channels itself. In v3 the anchors are `var(--color-…)` references, which have no channels to read at build time — so the ramp is handed to the browser as a nested `color-mix` instead."* **OPEX and earnings are shown, not hidden** — excluded from the baseline but badged, *"so a maxed-out bar is never mistaken for repositioning."*

---

## Section 6 — Contracts

`CbContracts`, lazy, and mounted **only on a live (non-frozen, non-replayed) session**:

> the route ignores the page's date picker entirely, so mounting it under a past date would file one day's contracts under another day's header.

One row per checkpoint — **9:45, 10:30, 12:00** — with what was paid, the day's high-water mark, and the P/L to that mark. **The P/L is entry → peak, not held-to-the-bell, and there is no summed total across the three rows.**

Session selection is the server's: *"today's, the moment today has one — and the last session that has rows until then… So on a Saturday, or at 6am Monday, the card is Friday's board, and at 09:45 ET the next 60s poll flips it to this morning… Nothing here schedules anything: the poll is the whole mechanism."*

**Skipped rows stay:** *"A checkpoint that probed at $2.40 and never qualified is a recorded decision, not a gap — it renders dimmed with the price that disqualified it. Dropping them is what makes 'nothing set up today' look exactly like 'the recorder was down'."*

**What it deliberately is not:** the owner board's range picker, its per-checkpoint roll-up cards, and its recorder controls (Run now / Diagnose) — *"Widening this card back into that one is how a customer surface ends up with a 'Run now' button on it."* It reads `/api/cb-contracts`, **not** `/api/cb-trades`: *"that route is owner-gated, also carries the POST recorder actions and the `?diag=` dump, and answers for any date."*

---

## The footbar

```
{viewDate} · {sym} · {feedLabel} · spot {n.nn} · ES {n.nn} · basis ±{n.nn} · {N} strikes · {HH:MM:SS} ET
```

`viewDate`, not `etDate` — *"on a frozen or replayed session the footer must stamp the session on screen, not the wall-clock day."*

**Both prices are 2dp, deliberately, and NOT `pxDp`:**

> spot, ES and basis are one arithmetic line here — `basis = ES − spot` — and the point of a diagnostic footer is that you can check it adds up. At `pxDp` the SPX row would read "6799 · ES 6843.19 · basis +45.60", which does not. This is the one place on the page that wants more precision than the instrument trades at.

Chips: `{0DTE|FRONT} {expiry}`, and either `baseline {date} · {N} strikes · OI` or `no baseline` / `baseline loading…`.

**`feedLabel`, every variant**

| Condition | Text |
|---|---|
| replay | `REPLAY {HH:MM} ET` |
| non-SPX, live, connected | `CHAIN POLL · 1m` |
| non-SPX, live, disconnected | `CHAIN POLL · retrying` |
| SPX, socket, connected | `LIVE` |
| SPX, socket, disconnected | `RECONNECTING` |
| SPX, `source === "rest"` | `REST FALLBACK` |
| otherwise (a frozen capture — `source: "off"`) | `PAUSED` |

> "REST FALLBACK" is a warning on SPX — the socket went quiet and the page dropped to polling. On a chain-poll symbol the poll IS the design, so it is labelled as what it is rather than as a degraded socket.

`frozenGexOf` forces `connected: false, source: "off"` — *"the page's own status chip reads these; it must say the feed is not live rather than inheriting a green LIVE badge from a day that ended a week ago."*

**The head badge**

| State | Text |
|---|---|
| recap only | `{SYM} · RECORDED · {sessionLabel}` |
| replay | `{0DTE\|FRONT} {expiry} · REPLAY {HH:MM} ET · {sessionLabel}` |
| frozen | `{0DTE\|FRONT} {expiry} · FROZEN {sessionLabel}` |
| SPX live | `{0DTE\|FRONT} {expiry} · {feedLabel} · {openLabel}` |
| other live | `{SYM} · CHAIN POLL · {openLabel}` |

Page title: `Session Recap` (recap only) / `Post-Market Recap` / `Premarket Prep`.

---

## The Post-Market tab

`PostMarketTab`, lazy. Six sections:

1. **Day Snapshot** — did the morning map hold?
2. **Level Performance Scorecard**
3. **How the Book Was Built** — build-time bars + peak marks, `Wall migration`, `Written vs traded`
4. **Positioning at the Close** — `Positioned vs written`, `What that means`
5. **Tomorrow's Map** (`— after 0DTE rolls off`)
6. **Journal · Accuracy · Premium** — `Session journal`, `Level accuracy`, `Where premium actually went`

**The high-water mark is gone; everything is share now (2026-08-24).** This is the tab's central correction and it is worth quoting nearly whole:

> This panel used to carry a peak tick and a hatched "given back" region, and the bar scale folded the peak in. **All of it was measuring the clock.**
> Per-strike GEX is γ × (OI+Vol) × S² and γ ∝ 1/√T… every strike's raw peak lands in the final minutes at 50-150× its own settle — an ATM 0DTE strike marks ~$200-300B at 15:55 against a ~$2B close — and ONE such strike set the bar scale for all 121 rows… and by the last recorded column all but a handful of ATM strikes have decayed to ~zero, so EVERY row read ~100% off its own high. **It is a property of expiry, not a measurement**, and it cannot tell an abandoned level apart from one that merely expired.

The replacement:

```
share_k(t) = |net_k(t)| / Σ_j |net_j(t)|
```

> The 1/√T term is in the numerator and the denominator, so it divides straight out. What is left is the board changing hands.

What each part of a row means now:

- **bar LENGTH** — where the strike closed, in dollars, scaled over the biggest closing bar on screen. Nothing else is in that scale.
- **bar COLOUR** — when it took its board share: blue AM, violet MID, amber PM.
- **the column** — 15:00→close change in board share, in points, on its own scale. Right/amber took share into the bell, left/red lost it. *"Magnitude-based, so a put wall going more negative reads as growth, which is what it is."*

Section 2 deliberately does **not** ask "what changed since 09:30": *"On 0DTE the open book is ~2% of the close, so that question always answers 'everything' and its delta chart is a copy of the profile."*

**Nothing on this tab is a future**

> Every price this tab prints is a CASH price from that symbol's own source. There is no basis conversion left in the file and no prop that could supply one: `esFut`, `basis`, `candles` and `overnight` are gone, and so is the ES-bar fallback for the day's path. A futures print run through a basis is not an SPX print, and the one time it was allowed to stand in for one it **produced a session low SPX never traded and graded the put wall BROKEN off it.**

That is also why `/api/quotes-batch` carries SPX at all: the page passes `prevClose={symQ?.prevClose}` and the route maps `SPX → ^GSPC`, `VIX → ^VIX`, `NDX → ^NDX`, passing an equity ticker straight through — *"one more symbol on a call the page was making anyway — no new endpoint, no new poll."*

**The saved grade wins.** `/proxy/walls?date&symbol` is `walls-recorder.js`'s own verdict: it captures the call wall / put wall / CORE at 09:29 and every 15 min to 16:00, **writes only on a change**, and classifies every touch four slots later (reject / break / pin / new wall / …). *"The scorecard reads that verdict instead of inventing its own, exactly like /level-log; the derived grade stays underneath as the fallback."*

`/api/snapshots/option-strike-gex-history` carries the same guards as `useGexBubbleHistory`: *"the route answers 200 even when it threw, and 'today' is the newest NON-WEEKEND day present, not `etDayKey(now)` — the recorder has no market-hours gate and rewrites a frozen copy all weekend."*

**Nothing here is synthetic.** *"A number that cannot be derived renders as '—' or as an explicit 'not recorded today' note; it is never filled in with a plausible value. That rule is what makes the scorecard worth reading."*

The journal's notes key lives in `postMarketData.ts`, not the tab, *"because the historical recap writes the SAME per-date notes: two keys would mean a note typed on the live tab vanished the moment you looked the day up again tomorrow."*

---

## Historical Recap — the fallback view

`recapOnly` — **not `isHistorical`** — is what disables the two tabs:

> a frozen date drives them perfectly well; only a date with nothing stored has to fall back… While the freeze request is still in flight the page waits rather than flashing the recap: `freezeState === "loading"` is not yet an answer, and rendering the fallback for 200ms and then swapping to the real tabs looks exactly like a bug. A REPLAY of that date is a capture too — a much better one.

Four dated stores with very different reach:

| Store | Reach |
|---|---|
| `/proxy/gex-levels-history` | **THE DEEP ONE.** One settled row per session, kept **forever**, gap-filled from settled ThetaData OI on boot. Spot, both walls, flip, dollar gamma, call/put gamma ratio, the second wall each side, total OI, a 48-point cumulative GEX curve. *"This is what makes an ARBITRARY past date work, and it is also what fills the picker"* |
| `/api/eod-gex` | the 0DTE / ex-0DTE split and the recorder's own pin (strike + share of board gamma) |
| `/api/snapshots/candles` | the session's ES 5m bars — **ES, not SPX, and labelled as such** |
| `/proxy/walls?date&symbol` | the intraday grade: the 09:29 capture, every move of each level, every classified touch |
| `/api/snapshots/option-strike-gex-history?minutes=0&date=` | the per-minute ladder. **Pruned to about TWO SESSIONS**, so it is *"a bonus on recent dates and legitimately empty before that. Never back-filled, always said out loud"* |

> The live-only panels (written-vs-traded, the positioned/written split, premium, next-expiry structure) are absent rather than approximated: each needs that session's own chain with its marks, volumes and open interest, and nothing stores that per strike per past day.

The frozen banner, verbatim:

> **Frozen session — {label}.** Every number below is computed from that day's captured chain by the same code the live page runs, captured {just before the 09:30 open | at the 16:05 settle}{slotNote}. Nothing here is live.

`slotNote` when the tab on screen is not the slot it asked for: ` — the settle capture is missing for this session, so this is the pre-open one` or ` — the pre-open capture is missing for this session, so this is the settle one`. *"A session that only captured one slot still opens that one — better a Post-Market tab on a day the morning was missed than neither."*

---

## Rendering, colours and the `.pmk` scope

Everything is **DOM/SVG** — no `<canvas>`, so nothing on this page carries `data-cb-layer` and `npm run perf` has nothing to attribute here. The page injects one `<style>` at the top of its tree:

```jsx
<style dangerouslySetInnerHTML={{ __html:
  CSS + POSTMARKET_CSS + HISTORICAL_CSS + GAMMA_BELL_CSS + CB_CONTRACTS_CSS }} />
```

> the page concatenates every premarket stylesheet into one `<style>` block on first paint and the cascade depends on them all being there. Splitting the CSS out of the components is what makes that possible: importing the constant from the component would drag the component back into this chunk and undo the `lazy()`.

Everything is scoped under `.pmk` with **custom properties on `.pmk`, not `:root`**, *"so its generic class names cannot leak into the app."*

**`hexA()` — a silent-failure story worth reading**

> hexA() USED TO PARSE A HEX. It cannot any more, and it was silently producing invalid CSS: v3's `HOME_THEME` is v2's name for `T`, whose values are `var(--color-…)` STRINGS, not hexes. `parseInt("var(--color-accent)", 16)` is NaN, so every `--cyanEdge`, `--cyanWash`, `--posDim` … came out as `rgba(NaN,NaN,NaN,0.45)` — invalid, so the browser dropped the declaration and the variable resolved to nothing wherever it was used.

It is now a thin alias for `alpha()` from `design/theme.ts`, *"The name is kept so the call sites below read unchanged."* Likewise `ink(a) = alpha(T.text, a)`.

**The `.pmk` variable map**

| `.pmk` var | Source | Hex |
|---|---|---|
| `--bg` | `HT.bg` = `--color-bg` | `#0a0d10` |
| `--panel` | `HT.panel` = `--color-surface` | `#0e1216` |
| `--panel2` | `HT.panelBg` = `--color-surface2` | `#141a21` |
| `--line` / `--card` | `HT.border` = `--color-line` | `#1e2630` |
| `--line2` / `--sunken` / `--active` / `--line3` / `--off` | `ink(.20/.05/.08/.30/.28)` | white washes over `--color-fg` `#e7ece9` |
| `--plate` | `HT.panel` | `#0e1216` — **the one SOLID plate** |
| `--cyan` | `HT.cyan` = `--color-accent` | `#2f6bff` |
| `--txt` / `--dim` | `HT.text` = `--color-fg` | `#e7ece9` |
| `--dim2` / `--muted` | `HT.muted` = `--color-muted` | `#e7ece9` |
| `--pos` / `--cw` | `ES_CANDLE_UP` = `--color-candle-up` | `#3ddc8e` |
| `--neg` / `--pw` | `ES_CANDLE_DOWN` = `--color-candle-down` | `#ff6b7a` |
| `--amber` | `HT.orange` = `--color-warn` | `#ffd166` |
| `--blue` | `LIGHT_BLUE` = `--color-series-5` | `#7fb0ff` |
| `--violet` | `--color-violet` | `#b48cff` |
| `--r` / `--r2` | — | `12px` / `9px` |

Six of those carry warnings, all from the CSS block's own comments.

> **The surface ramp** used to be the mockup's own slate (#0a0d12 / #11161f / #151b26 / #242e3b), "which is why the page read as a different product from the rest of the app: the cards sat a full step lighter than every other card in the dashboard and their edges were a solid slate line rather than the app's white hairline."
>
> **`--plate` must stay opaque:** "Bar tags, the ladder's spot/flip labels and the footer sit ON TOP of coloured bars, so they cannot use a white alpha — it would let the bar read straight through the text."
>
> **The wall pair is separate from the gamma pair:** "`--pos` / `--neg` say 'positive or negative gamma' and belong to the bars. `--cw` / `--pw` say 'call wall / put wall' and belong to the LEVELS. They were the same tokens until 2026-08-20, which meant flipping the wall convention would have re-coloured every bar on the page… **NOT re-pointed at `LEVEL_COLORS.cw/.pw` (blue/red): that would silently undo the 2026-08-20 green/red decision as a side effect of a re-theme.**"
>
> **`--muted` was once missing** from the alias layer, and `GexChurnFeed` / `GexWatchFeed` both style secondary text with it: "An undefined custom property makes the whole color declaration invalid, so those lines silently fell back to the inherited colour — the same class of bug as v2's grey text, in the other direction."
>
> **The alpha rungs** (`--posWash` .08, `--posEdge` .22, `--posEdgeUp` .40, `--posBand` .28, `--posGlow` .16, `--posGlow2` .05, and the matching neg / blue / amber ladders) exist because "`PostMarketTab.tsx` and `HistoricalRecap.tsx` are separate template literals with no access to the JS side, so a hand-typed green in one of them silently keeps the OLD hue after this block moves."
>
> **The font:** "`--font-sans` is v3's own stack. v2 asked for `--font-inter` here, which is a Next font variable that does not exist in this app — the page fell through to the generic list every render."

**Layout constants**

| Thing | Value |
|---|---|
| `.pmk` | `font: 13px/1.45 var(--font-sans)`, `height:100%`, `overflow:auto` |
| `.wrap` / `.rplwrap` | `max-width:1560px; margin:0 auto`; `.wrap` `padding:18px 20px 60px` |
| `.levels` | `repeat(6, 1fr)`, gap 10, `padding:14px 18px` |
| `.body` | `1.55fr 1fr 1fr`; `.body.two` `1fr 1fr` |
| `.col` | `padding:14px 18px`, `border-right:1px solid var(--line)` |
| `.lvl .px` | 21px, weight 660, `letter-spacing:-.03em` |
| `.onrange` | 52px tall (58 for the EM track); bar at `top:22px`, 8px tall |
| `.footbar` | `padding:9px 18px`, `background:var(--plate)` |
| `.rplbar` | `position:sticky; bottom:0; z-index:30` |
| `PROFILE_ROW_H` / `_VIEW_H` / `_PAD` | 19 / 440 / 210.5 |
| gamma card `PAD` / `GAP` / `TOP_SHARE` / `NET_HEAD` | `{t:68,r:18,b:44,l:72}` / 16 / 0.6 / 1.14 |

---

## Phone behaviour

`/premarket` is **not** in `DESKTOP_TO_MOBILE` (`src/mobile/mobileNav.ts:80`), so a phone is never redirected off it. The registry names this page explicitly:

> ONLY routes listed here redirect a phone; everything else (Analysis, Flow, Replay, Scanner, **Premarket**) keeps rendering its desktop layout, because there is no phone build of it and a cramped real page beats a redirect to an unrelated one.

There is also no `/m/*` tab for it — AGENTS.md's phone section requires a tab to be a board card or an existing page rendered full-bleed, and *"Never add a mobile-only fetch, or a second component, for something a card already computes."* What the page does itself, at **`@media (max-width: 1180px)`**:

```
.pmk .body, .pmk .body.two   → grid-template-columns: 1fr
.pmk .col                     → border-right: 0; border-bottom: 1px solid var(--line)
.pmk .levels                  → repeat(3, 1fr)     // six tiles become two rows of three
.pmk .regime                  → 1fr, gap 12
.pmk .vr                      → display: none      // the KPI dividers
.pmk .bias                    → justify-self: start; text-align: left; max-width: none
.pmk .rail .cap2 .ln          → display: none      // keep the code, drop the long name
```

The three lazy stylesheets carry their own: `postMarketTab.css.ts` has two `@media (max-width:1180px)` blocks, `historicalRecap.css.ts` one, and `cbContracts.css.ts` one at `900px`. The symbol picker stays a native `<select>` partly for this reason — *"the OS list is the right affordance on a phone."* The `.pmk` scroll container plus `position:sticky; bottom:0` means the replay dock pins to the viewport edge on a phone the same way it does on a desktop.

---

## Status and empty-state messages, verbatim

| Message | Where | When |
|---|---|---|
| `WAITING FOR FEED` / `no chain frame yet` | regime badge | `!hasData` |
| `Waiting for the chain…` | level rail | fewer than two placeable marks |
| `waiting for the chain` | rail header | same |
| `prior-close baseline loading…` | Key Levels head | `baselineState` idle/loading |
| `no prior-close baseline — levels only` | Key Levels head | fetch returned empty |
| `no prior-close baseline on the {basis} basis — levels only` | Key Levels head | the basis has no map |
| `Waiting for the chain…` | either ladder (`GexProfile` default) | no rows |
| `The whole-board sweep reads the live chain, so there is no version of it for a past session.` | right ladder | frozen or replay |
| `The whole-board sweep did not answer.` | right ladder | `state === "error"` |
| `Nothing but 0DTE listed on this board.` | right ladder | `state === "empty"` |
| `Sweeping every expiration…` | right ladder | loading |
| `no standing book yet` | ex-0DTE strip | `ex0.totalNetGex == null` |
| `no per-contract vanna on this feed` | greeks strip | `totals.vanna == null` |
| `No overnight bars yet.` | ON track | no `hi`/`lo` |
| `Loading the prior-close board…` | Biggest GEX Changes | baseline loading |
| `No prior-session board for {SYM} {expiry} yet — server-v2/premarket-baseline.js records one at 16:05 ET each session (and its ALLOWED_SYMBOLS list gates which symbols it will sweep), so this fills in after the next close.` | Biggest GEX Changes | baseline empty |
| `No strike moved against the prior close.` | Biggest GEX Changes | baseline ok, no deltas |
| `Loading sector data…` | Sector Heat | no `sectorBars` yet |
| `No ATM straddle yet — expected move unavailable.` | EM track | `em == null` |
| `Waiting for the first chain frame.` | playbook | `!hasData` |
| `Nothing scheduled on the US calendar today.` | Catalysts | no events, no earnings |
| `Loading this session's frames…` | replay bar + ⓘ | `replayState === "loading"` |
| `Could not load this session's frames.` | replay bar + ⓘ | `replayState === "error"` |
| `No frames recorded for this session — step ◀ / ▶ to another.` | replay bar | no frames |
| `No frames recorded for this session. The recorder captures the page every 5 minutes from 04:00 ET and cannot back-fill a day it was not running for.` | ⓘ note, and the Replay button's disabled title | no frames |
| `· recorded walls only …` / the ⓘ body | ⓘ note | frames present |
| `No captured chain for this session — showing the recorded recap instead` | both tab buttons' `title` | `recapOnly` |
| `Replayed sessions are SPX only` | symbol select `title` | `replayOn` |
| `Which symbol to show. SPX opens the frozen board for this session; every other MAIN name opens its recorded recap.` | symbol select `title` | historical |
| `Which symbol to show. SPX is the live-socket board; every other MAIN name is a one-minute chain poll.` | symbol select `title` | live |
| `Which session to show. Today is live; • marks a captured session that drives the full tabs, ▸ one that can also be replayed minute by minute.` | session Select `title` | always |
| `Step {label} through its recorded frames — the whole page, minute by minute` | Replay button `title` | date has frames |
| `IB`-style `no baseline` / `baseline loading…` | footbar chip | per `baselineState` |

The ⓘ note's main body, verbatim:

> **The page IS the replay.** Every level, tile and panel above is recomputed from that minute's own captured chain by the same code the live page runs, and the page's clock is rewound with it — both tabs, so the Post-Market side rebuilds the book frame by frame too. Nothing driven by the chain is live. (The GEX-watch strip in the last row is not date-scoped and still shows the latest recorded close.) Frames keep **±N strikes** around spot, so the walls, gamma flip and total net GEX are that minute's full-board values, while anything scanned off the chain here — max pain, the DEX and vanna totals, the profile's and bell curve's wings — is over that window.

---

## Performance and bundle notes

**Three lazy panels inside the route chunk.** `PostMarketTab`, `HistoricalRecap` and `CbContracts` are each `lazy()`:

> Between them these are most of this route's weight, and NONE of them is on screen when the page opens: the post-market tab needs the tab switched, the historical recap only appears for a date with no capture, and the contracts panel is hidden while the page is frozen or replaying. Statically imported, every visitor downloaded all three to look at the pre-open view.

Their **stylesheets still load eagerly** from the sibling `.css.ts` modules, because the concatenated `<style>` needs the whole cascade on first paint. That split is precisely what makes the `lazy()` possible. Every `Suspense` fallback on this page is **`null`, not a spinner**: *"the frame is already drawn around this and a spinner inside a frame reads as an error. Same call the board's `Deferred` makes."*

**Budgets** (`budgets.json`). `"route": 59100` brotli bytes is the ceiling this chunk shares with every other page; `"entry": 38900`, `"react": 55000`, `"data": 78000`, `"css": 8500`, `"html": 2600`, `"totalInitial": 108400`. The file's own comment: *"a budget with 4x headroom enforces nothing. Raising a number is a deliberate decision that shows up in a diff."* `ratchet.slack` is `0.15` with `enforce: false`.

**Theme baseline.** This page is by far the largest entry set in `theme-baseline.json`, and every number is a grandfathered violation that the build fails if it exceeds:

```
src/pages/Premarket.tsx                    39
src/pages/premarket/postMarketTab.css.ts   20
src/pages/premarket/cbContracts.css.ts     16
src/pages/premarket/GexHeatBar.tsx         15
src/pages/premarket/GexChurnFeed.tsx        7
src/pages/premarket/GexWatchFeed.tsx        7
src/pages/premarket/GammaBellCurve.tsx      4
src/pages/premarket/historicalRecap.css.ts  3
src/pages/premarket/PostMarketTab.tsx       2
src/pages/premarket/GexProfile.tsx          1
```

Per that file's README: *"The build fails when a file goes ABOVE its number here. Clean a file up and run `npm run theme:update` to pull its number down; a file at zero is removed and can never regress. **Never raise a number to make a build pass.**"* Note `GexWatchFeed.tsx` (7) and `GexChurnFeed.tsx` (7) are still in the baseline although nothing mounts them — the checker scans `src/`, not the import graph.

**Per-frame / poll machinery on this page:**

- one 30 s `setInterval` for the ET clock
- 30 s quotes, 60 s market quality, 60 s chain poll (non-SPX only), 60 s multi-expiry, 60 s CB contracts
- the replay interval only exists while playing
- `GexProfile`'s rAF retry loop is bounded at 90 tries and only runs while pinned
- the gamma card's fits are memoised over the band, not the visible window

**No canvas and no `data-cb-layer`.** `budgets.json`'s `perf` block (`idleRepaintsPerFrame: 0.15`, `offscreenRepaints: 0`, `interactionRepaints: 10`) measures canvases attributed to board cards; this page owns none.

**Socket discipline.** AGENTS.md non-negotiable 2 ("Pages never touch the socket") is met via `useMobileGex` / `useEsCandles`. The socket keeps flowing SPX while you read NVDA at no extra cost — *"gexSocket is one refcounted connection shared with the toolbar and every other consumer, and it would stay open for them anyway"* — and `useChainGex` is disabled entirely while SPX is on screen, *"so at most one chain is being polled at a time no matter how many symbols the picker offers."*

---

## Gotchas

1. **Four files in `src/pages/premarket/` are built and unmounted.** `TickerBoard.tsx` (580) and `GammaDistribution.tsx` (26) are tombstones that say so. `GexWatchFeed.tsx` (163) and `GexChurnFeed.tsx` (178) are live components nothing renders — GEX Watch came out of section 5 on **2026-08-29**. Bringing GEX Watch back is *"this import plus the two lines in section 5, and `GEX_WATCH_CSS` has to go back into the `<style>` concat below or it returns unstyled."*

2. **The OI/OI+Vol basis mismatch is the page's biggest trap.** The Net GEX KPI prints OI+Vol; the ▲/▼ chip beside it, the Key Levels default and Biggest GEX Changes are all OI. They are labelled `OI` on screen for exactly that reason. Diffing an OI+Vol live side against an OI baseline premarket produces a large negative Δ on every strike that is pure artifact.

3. **`oiVsBaseline` sums the INTERSECTION only.** Summing each side's whole universe injects a one-sided term (the live chain is ±8% of live spot, the baseline ±500 points of yesterday's settle) and the KPI chip prints an arbitrary direction. Also: **The flip is a price, not a strike.** It takes `pxDp`, everything else on its row takes `kDp`. Rounding the flip to the strike grid throws away the interpolation `findGEXFlip` just did.

4. **CORE is off the whole ladder; the 0DTE magnet is off ±12 strikes.** They are different numbers on purpose, and CORE is deliberately not windowed *"so the CORE can [not] jump twenty points on a quote with nothing having changed in the book."* The comment also records that the claim "this rail and the Board's Key Levels card cannot print a different CORE" **used to be untrue** — the Board was on the ±12 magnet.

5. **Max Pain has no migration line and must not get one.** The baseline stores net GEX per strike; max pain needs per-side OI. *"Inventing one would be the only wrong number on this row."*

6. **`wallState` reads magnitude, not sign.** A put wall going from −37.0M to −39.2M is `deepening`, not "down". Also: **Vanna null ≠ vanna zero.** `?? 0` across a chain with no per-contract vanna printed a confident `$0`. Do not reintroduce it, and do not rebuild vanna from Black-Scholes client-side — `bsGreeks` returns zero at T = 0.

7. **The right ladder must never borrow the front board's tags.** `tagForEx` reads `ex0`'s own walls and flip. Reading the front expiry's pin against the standing book's bars is the exact mistake the panel exists to prevent.

8. **The profile's bar scale must cover the whole rendered window.** Normalising over a narrower ±12 produced bars above 100% width, sliced flat at the panel border, with a horizontal scrollbar.

9. **`PROFILE_PAD` is load-bearing twice** — once so every row can reach the middle of the scroller, and once because the absolutely positioned spot/flip rules are placed from the padding edge. Also: **Only a reader's gesture may un-pin a ladder.** A browser-clamped scrollTop after a symbol switch is not a gesture; treating it as one opened AMD sixty strikes above the money with "back to spot" already showing.

10. **`useMultiExpiryGex`'s first fetch is delayed 400 ms on purpose** and `spot` rides a ref. Removing either costs a wasted full-board sweep on every symbol switch.

11. **The overnight window needs TWO prior dates.** `pdDate` (last RTH session) and `evDate` (last Globex evening) are the same day midweek and different days over a weekend. Collapsing them lands on Sunday and blanks every gap row on a Monday.

12. **`useEsCandles(true, 8, …)` — do not reduce the 8.** `daysBack` is calendar days; the prior trading session is 3 back on a Monday and 4 after a holiday. Also: **The candle pool is deliberately unsorted and un-deduplicated.** Every consumer is a min/max/latest scan, and a Map+sort would run at 4 Hz over eight sessions of bars.

13. **VIX's change colour is inverted on purpose.** Up is red. *"Do not 'fix' this to match its neighbours."*

14. **The gap test is `|pts| < gapEps`, scaled to price.** A flat 0.25 was one ES tick on SPX and a 0.8% move on a $30 name. Also: **`--cw`/`--pw` are NOT `LEVEL_COLORS.cw/.pw`.** Call wall is green and put wall red on this page, decided 2026-08-20. Re-pointing them at the blue/red level tokens would undo that decision as a side effect of a re-theme.

15. **`--plate` must stay opaque** and `--muted` must stay defined. A white alpha lets the bar read through a tag; an undefined custom property invalidates the whole `color` declaration silently. Likewise **`hexA()` no longer parses a hex** — `T`'s values are `var(--color-…)` strings, and reading channels off them produces `rgba(NaN,NaN,NaN,a)`, which the browser drops silently.

16. **Never import a lazy panel's CSS from the panel.** Take it from the sibling `.css.ts`; importing the constant from the component drags the component into the route chunk and undoes the `lazy()`. And the `<style>` blocks are template literals — **no backticks inside them**, stated in all three headers.

17. **`recapOnly`, not `isHistorical`, gates the tabs** — and it waits for both the freeze and (when replay is on) the frames request to settle, *"rendering the fallback for 200ms and then swapping to the real tabs looks exactly like a bug."*

18. **`CbContracts` must not be mounted on a frozen or replayed date.** The route picks its own session and ignores the page's date picker, so it would file one day's contracts under another day's header. Also: **The replay pause lives in its own effect**, not the interval's updater — StrictMode runs updaters twice and setting state from one double-fires the pause.

19. **The Post-Market tab takes no ES prop and must never get one.** A futures print run through a basis once produced a session low SPX never traded and graded the put wall BROKEN off it.

20. **The Post-Market build panel measures SHARE, not a high-water mark.** γ ∝ 1/√T makes every strike read ~100% off its own peak on every expiry session — a property of expiry, not a measurement.

21. **The picker is a fixed list, not a free text box.** A name outside `SCANNER_MAIN` would render but its wall log would be empty and its chain unswept. Also: **`/proxy/scanner-tickers` cannot replace `SCANNER_MAIN` here.** It returns one flat de-duped array with no group labels — 169 tickers, not 14. *"If the picker should ever follow live overrides, the endpoint has to expose the buckets first."*

22. **The session-date restore effect runs once, on mount, with an eslint-disable.** Re-running it on `sessions` changes would drag the user back to a stored date every time the clock ticked.

23. **`theme-baseline.json` carries 39 grandfathered violations for `Premarket.tsx` alone.** That number may only go down. `npm run theme:update` after cleaning; never raise it to make a build pass.
