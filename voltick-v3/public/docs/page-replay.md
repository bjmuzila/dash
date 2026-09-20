# Replay — `/replay`

**Route:** `<Route path="/replay" element={<Replay />} />` in `src/App.tsx`.
**Mounted by:** `const Replay = lazy(() => import('@/pages/Replay'))`. App.tsx's comment on the import:

> `/replay` — the replay hub. Four tabs, each mounting a surface that already exists elsewhere, opened ALREADY REWOUND. Spec: `docs/parity/replay.md`. Its own chunk is small on purpose: three of the four tabs `lazy()` into the SAME chunks `/options-chain` and `/analytics` already load.

**Rail entry:** `{ to: '/replay', label: 'Replay', icon: '⏱️', prefetch: ['/proxy/strike-growth/replay-meta'] }` in `NAV` (`src/shell/Shell.tsx`), with the comment *"Prefetches the recorder's symbol list on hover — the first thing every one of the four tabs needs, whichever one you land on."*
**Production URL:** `voltick.cbedge.net/v3/replay`, plus `#tab=<id>`. A hard refresh is served by `app/v3/replay/route.ts` in the v2 repo.

> ⚠ **There are FIVE tabs, not four.** `TABS` in `Replay.tsx` holds `chain-ladder`, `gex-levels`, `gex-candles`, `mult-greek`, `options-chain`. The GEX-candles tab landed on 2026-09-03 (`GexCandlesCard.tsx`, *"── REPLAY (2026-09-03) ──"*) and the "four" in `App.tsx`, in `Replay.tsx`'s own header, in `MultiGreekReplay.tsx` (*"the only tab of the four"*) and in `ReplayStamp.tsx` (*"the four tabs of /v3/replay"*) was never updated. `GexCandlesCard.tsx` is the one file that counts correctly: *"The other four replay tabs open unlocked."* Everything below says five.

**Sources:**

| File | Lines |
|---|---|
| `src/board/gexCandles/GexCandlesCard.tsx` | 2056 |
| `src/pages/replay/MultiGreekReplay.tsx` | 1034 |
| `src/pages/Replay.tsx` | 262 |
| `src/pages/replay/mgReplay.ts` | 251 |
| `src/pages/optionsChain/ReplayBar.tsx` | 246 |
| `src/design/primitives/ReplayDock.tsx` | 212 |
| `src/design/primitives/ReplayStamp.tsx` | 178 |

Mounted but owned elsewhere: `src/pages/optionsChain/LadderModal.tsx`, `src/pages/analysis/lookup/TickerLookup.tsx`, `src/pages/analysis/lookup/replay.ts`, `src/pages/OptionsChain.tsx`, `src/pages/optionsChain/useChainData.ts`, `src/board/multiGreek/mgMath.ts`. Supporting: `src/data/symbol.tsx`, `src/data/api.ts` (239), `src/design/theme.ts` (471), `src/design/tokens.css` (716), `src/shell/Shell.tsx` (739), `AGENTS.md`, `budgets.json`.

---

## What it is, in one paragraph

`/replay` is a hub, not a feature. Five surfaces in this app can be rewound — the chain ladder, the Ticker Lookup's GEX-levels pair, the GEX candles with their bubbles, a four-panel Multi Greek comparison, and the whole options-chain grid — and before this page existed each of them was reachable only from inside the page that owns it. That is still true and still correct (*"rewinding IN CONTEXT is the point of having it there"*), but if the thing you want is replay itself, you had to remember which page hid which one. This page is one tab bar over those five surfaces, each **mounted already rewound**, each `lazy()` into a chunk another route already carries, and each following the toolbar's board symbol so that switching tabs never quietly changes the subject. Every one of them shares the same transport vocabulary: the same five speeds, the same 700 ms base frame, the same ◀ ▶ keys in the same order, the same "N sessions" retention line, the same **🔒 Axis** lock, and the same orange dock along the bottom edge of the page — a dock that sits *in flow* so it shrinks the surface rather than covering the last inch of it. And each one burns a **replay stamp** into the pane itself, because these screens get recorded and a recording is a crop.

---

## File map

| File | Lines | What it owns |
|---|---|---|
| `src/pages/Replay.tsx` | 262 | The hub: `TABS`, `TabDef`, the `#tab=` hash sync, the tab bar, and the two body shapes (framed vs full). Five `lazy()` imports and nothing else. |
| `src/pages/replay/mgReplay.ts` | 251 | The Multi Greek recorder side, kept out of the component. `MG_REPLAY_BASE_MS`, `MG_REPLAY_SPEEDS`, `parseMgSession`, `mgTimeline`, `pickMgFrame`, `mgReplayColumns`, `mgReplayValues`, `mgEx0Sources`, `minuteBucket`, `fmtMgReplayClock`, `fmtMgStampDate`. |
| `src/pages/replay/MultiGreekReplay.tsx` | 1034 | The Multi Greek tab: four `ReplayPanel`s, the shared clock, the two fetch waves, the transport, the ⚙ popover, the localStorage layer, the slot-1↔toolbar sync. The only tab with **no live v3 component behind it**. |
| `src/design/primitives/ReplayDock.tsx` | 212 | `ReplayDockHost` (in `Shell.tsx`), `ReplayDock` (the portal), `ReplayLock` (the 🔒 Axis button). |
| `src/design/primitives/ReplayStamp.tsx` | 178 | `ReplayStamp`, `ReplayBrand`, `ReplayStampLayer` — the caption burned into the pane. |
| `src/pages/optionsChain/ReplayBar.tsx` | 246 | The Options-Chain tab's transport, including the 0DTE / All-exp scope switch and the coverage line. |
| `src/board/gexCandles/GexCandlesCard.tsx` | 2056 | The whole candles card. The `replay` prop, `REPLAY_BASE_MS`, `REPLAY_SPEEDS`, `REPLAY_HISTORY_MINUTES`, `REPLAY_CANDLE_DAYS`, the timestamp cursor, the session picker, and the **only tab whose axis lock is on by default**. |

### The two shapes of tab

From `Replay.tsx`'s header:

> **FRAMED** — a component small enough to sit in a Card (the chain ladder, the GEX-levels card). The hub supplies the plate, the title and the one-line blurb.
>
> **FULL** — a whole page that renders its OWN frame (Multi Greek, Options Chain). Wrapping those in a second frame doubles the padding and nests a scroll container inside a scroll container, so they get the tab bar and the rest of the viewport and nothing else. `minHeight:0` on BOTH the column and the pane is what lets the embedded page's internal scroller size itself instead of pushing the tab bar off the top of the screen.

And a third case inside "framed", `TabDef.chart`:

> The default framed body is a block scroller (`overflow-y-auto`), which is right for a ladder and wrong for a chart: a `flex-1` chart inside a block parent has nothing to stretch against and collapses to nothing. This swaps the wrapper for a flex column so the chart gets the Card's remaining height, which is what every board card is written to expect.

So the body wrapper is exactly one of three strings:

| `full` | `chart` | Wrapper |
|---|---|---|
| `true` | — | `flex min-h-0 flex-1 flex-col` (no Card at all) |
| `false` | `true` | `flex min-h-0 flex-1 flex-col` inside a `<Card fill>` |
| `false` | falsy | `min-h-0 flex-1 overflow-y-auto` inside a `<Card fill>` |

### Why every tab opens rewound

> EVERY TAB OPENS ALREADY REWOUND. That is the reason the page exists: making someone press the embedded page's own replay toggle first is asking them to confirm the thing they just navigated to. It is INITIAL STATE only — each tab's own toggle still works, so leaving replay inside a tab behaves normally.

Concretely, five different prop names carry that one idea, because each surface already had its own:

| Tab | Mount |
|---|---|
| `chain-ladder` | `<LadderReplay symbol={symbol} embedded />` — `LadderModal` has no live mode at all |
| `gex-levels` | `<TickerLookupCard embedded initialReplay />` |
| `gex-candles` | `<GexCandles replay />` |
| `mult-greek` | `<MultiGreekReplay />` — replay-only by construction |
| `options-chain` | `<OptionsChain initialReplay initialReplayScope="0dte" />` |

Each of those seeds a `useState`, never a controlled prop: `const [replayOn, setReplayOn] = useState(initialReplay)` in `useChainData.ts` and `TickerLookup.tsx`, `useState(replay)` in `GexCandlesCard.tsx`. Pressing **Live** inside the tab leaves replay and the hub does not push it back.

### Why every tab follows the toolbar ticker

> Four tabs that each remembered their own symbol meant switching tabs could change the subject without saying so, and the toolbar — the one control that looks like it drives the page — drove only the Options Chain tab. The board symbol (`data/symbol.tsx`) now seeds all four.

| Tab | How it follows |
|---|---|
| `chain-ladder` | Seeded from `usePageSymbol()`, re-seeded when the toolbar moves. **Keeps its own picker** — *"only roots the RECORDER swept can be replayed and that list is not the board's."* |
| `gex-levels` | Follows outright; *"its dropdown is gone (TickerLookup.tsx)"* |
| `gex-candles` | Reads `usePageSymbol` itself, so it follows on its own |
| `mult-greek` | **Slot 1 only.** Slots 2–4 stay independently typeable |
| `options-chain` | Already followed; reads `usePageSymbol` directly |

The Multi Greek carve-out is argued twice, in `Replay.tsx` and again in `MultiGreekReplay.tsx`:

> SLOT 1 follows; slots 2-4 stay independently typeable. Four slots pinned to one symbol would leave the tab comparing a symbol with itself, which is the point of that card — the live Multi Greek board is shaped the same way (panel 1 = the board ticker, the rest added by hand).

`src/data/symbol.tsx` names the same exception from the other side: *"Multi Greek is the other exception, deliberately: four independently typeable slots is the entire point of that card, and one page ticker applied to all four would leave it comparing a symbol with itself."*

---

## The tab bar and the hash

```tsx
<div role="tablist" aria-label="Replay surfaces" className="flex shrink-0 flex-wrap items-center gap-2 px-3 pt-3">
```

Each button is `rounded-md px-3.5 py-1.5 text-xs font-extrabold uppercase tracking-[0.08em] transition-colors`. Selected: `border border-accent bg-accent text-bg` — an **inverted** pill, ink on accent. Unselected: `border border-line bg-raised text-fg hover:bg-surface2`. `aria-selected` is set; the `title` is the tab's own `blurb`.

**The tab lives in the hash, not the path and not the query string:**

> A hash and not a route param: this page is ONE route and the tab is a view of it, not a location. The hash still makes a tab linkable and back-button-able, which is what the tab bar is for.

`tabFromHash()` parses `location.hash` with `URLSearchParams` and returns the id **only if it names a real tab**, else `null` — so `#tab=garbage` silently falls back to `DEFAULT_TAB` rather than rendering an empty pane.

**The hash is read after mount, not in the state initializer:**

> The route mounts inside a Suspense boundary and a shared link can arrive before the chunk does; settling the tab in an effect means the hash is read once, from the real location, with the listener attached in the same pass.

`select(id)` sets state *and* writes `window.location.hash = 'tab=' + id`:

> Assigning the same value is a no-op, so the hashchange this fires lands on the state just set rather than fighting it.

`DEFAULT_TAB` is `'chain-ladder'`. `active` falls back to `TABS[0]` if the id somehow does not resolve.

**The Suspense fallback** is one string, shared by both body shapes:

```
LOADING REPLAY…
```
at `text-sm tracking-[0.08em] text-faint`, centred in `flex flex-1 items-center justify-center p-10`.

---

## The shared transport vocabulary

Five surfaces, five separate implementations, one agreed set of numbers. **They are not imported from one another**, and `GexCandlesCard.tsx` states why:

> The same numbers and the same key layout as every other v3 transport — `mgReplay.ts`'s `MG_REPLAY_BASE_MS` / `MG_REPLAY_SPEEDS` and the Ticker Lookup bar. Not imported from either: those constants belong to modules this card has no other reason to pull in, and the two values are the whole of the shared decision.

### The numbers

| Constant | Value | Declared in |
|---|---|---|
| Base frame interval at 1× | **700 ms** | `MG_REPLAY_BASE_MS` (`mgReplay.ts`), `REPLAY_BASE_MS` (`useChainData.ts`), `REPLAY_BASE_MS` (`GexCandlesCard.tsx`), `TL_REPLAY_BASE_MS` (`analysis/lookup/replay.ts`), `BASE_MS` (`LadderModal.tsx`) |
| Speeds | **`[0.5, 1, 2, 4, 8]`** | `MG_REPLAY_SPEEDS`, `REPLAY_SPEEDS` ×2, `TL_REPLAY_SPEEDS`, `SPEEDS` |
| Default speed | **1×** | all five |

`mgReplay.ts` calls 700 ms *"v2's number, shared by all three replay surfaces"* — itself now stale, there are five.

The interval is always `BASE_MS / speed`, so 8× is one step every **87.5 ms** and 0.5× is one every **1 400 ms**.

### The transport row, left to right

Every bar draws the same things in the same order:

1. The word **`Replay`**, `font-weight: 800–900`, `letter-spacing: 0.1em`, uppercase, in `T.orange` (`--color-warn`, `#ffd166`).
2. **The session picker** — a `Select`, mono, showing `YYYY-MM-DD` (the candles tab shows `Fri 09-05` with the ISO date as a sub-line).
3. **The retention line** — `1 session` / `N sessions`. See below.
4. **◀ · ▶/❚❚ · ▶** — previous, play/pause, next.
5. **The scrubber** — `<input type="range">`, `flex: 1`, `minWidth` 160–180, `height: 3`, `accentColor: T.orange`.
6. **`Speed`** then the five speed buttons.
7. **`🔒 Axis`** / **`🔓 Axis`** — `ReplayLock`.
8. A `|` divider in `T.border`.
9. **The clock**, mono, `font-weight: 800–900`: `HH:MM ET` (Multi Greek, Ticker Lookup) or `HH:MM:SS ET` (the chain grid), `--:--` / `--:--:--` when there is nothing to show.
10. **The position** — `3 / 214`, or `frame 3 / 214`, or `bar 3/214`.
11. **The caveat line** — see "What the recorder actually stores".

Then a `flex: 1` spacer and whatever the surface adds on the right (a ⚙ on Multi Greek, `⛶ Ladder` on the chain grid, `Live` on the candles).

Three behaviours are identical everywhere, each with the same comment:

**Play from the end rewinds first.** *"Playing from the end would show one frame and stop, which reads as broken — rewind first."*

**Playback stops at the end, never loops.** *"a session that silently restarts reads as live data jumping backwards."* In `MultiGreekReplay` that stop is a separate effect rather than logic inside the updater: *"Outside the updater on purpose: updaters must be pure, and StrictMode calls them twice."*

**Any manual move pauses.** Every ◀, ▶ and scrubber handler calls `setPlaying(false)` first.

### The dock

`ReplayDock` is the one piece all five genuinely share. Three decisions, all in its header:

**It is not `position: fixed`.**
> A fixed bar covers the last inch of whatever it is docked over — on a ladder that is the strikes nearest the money, on a chart it is the live candles. This dock is the LAST FLEX CHILD of the app's page column instead: `flexShrink: 0` beside a `flex-1` page, so mounting it SHRINKS the page by its height and nothing is ever occluded. v2 records the same reasoning and the same trade — the content reflows twice per replay (once in, once out) and that is a fair price for never hiding the thing being replayed.

**It is a portal.**
> The transports live deep inside their surfaces … and they own the state they drive. Hoisting that state to the page to move a bar would be the wrong repair. So the surface renders `<ReplayDock>{bar}</ReplayDock>` wherever it likes in its own tree and the DOM lands at the bottom of the page … a portal moves the DOM, not the React tree.

**It is orange, and it is the only orange bar in the app.**
> Every other bar in this app is neutral. A rewound grid that does not announce itself reads as a live one, which is the single worst way any of these surfaces can be misunderstood — so the announcement is the whole bottom edge of the page, not a chip inside a panel. The bars themselves therefore drop their own plates: **the dock IS the plate.**

`ReplayBar.tsx` obeys that from its side: *"No plate. This bar lives in the REPLAY DOCK at the bottom of the page now … a second plate inside it would be a bar drawn inside a bar."*

**Host and claim counting.** `ReplayDockHost` is mounted in `Shell.tsx` three times — once per layout branch (embed, mobile, desktop) — and **wraps `ExpandStageHost`**, so the dock holds the bottom edge even under an expanded card. It renders the bar only while `claims > 0`:

> The dock only exists while something has claimed it — an empty bar with a hairline and a shadow is a page that looks broken at the bottom edge.

The target node is set through a **ref callback**, not a ref object:
> the bars cannot portal until this node exists, so the host has to RE-RENDER once it does. A ref would fill in silently and nothing would re-run. React also calls it with null on unmount, which is how the target clears itself.

With no host, `ReplayDock` renders its children inline: *"Rendered outside a ReplayDockHost (a preview, a test, a modal that owns its own bottom edge), ReplayDock renders its children inline exactly where they sit. That is the fallback, not an error."* That is exactly `LadderModal`'s non-embedded path — `embedded ? <ReplayDock>{transport}</ReplayDock> : transport`.

**Styling:** `flexShrink: 0`, `position: relative`, `zIndex: 40`, `borderTop: 1px solid alpha(--color-warn, 0.35)`, background `linear-gradient(180deg, warn@10%, warn@3%)` over `panel@92%`, `backdropFilter: blur(14px)`, `boxShadow: 0 -10px 30px alpha(--color-shadow, 0.35)` (**upward** — *"because the thing it needs to separate from is above it"*), `padding: 8px 16px`. The inner row is `display:flex; flexWrap:wrap; gap:10px; fontSize: var(--text-xs)`.

### 🔒 Axis — the lock

One button, one meaning, five different implementations. From `ReplayDock.tsx`:

> **"Do not move while I scrub."**
>
> Every replay surface here re-derives its view from the frame it is parked on, and each of them has a rule that re-frames when the data moves: the candles autoscale their price axis, the chain scrolls the ATM row back to the middle, the Multi Greek panels re-centre when spot crosses a strike, the ladders rescale their bars to the current snapshot's own peak. Every one of those is right while you are watching live, and every one of them is WRONG while you are stepping back and forth over the same ten minutes trying to see what changed — the thing you are comparing against moves out from under you, and on a screen recording it reads as the market jumping rather than the frame.
>
> So: one button, one meaning, on every transport. ON freezes the view — no re-centring, no rescaling, no re-anchoring — and only the DATA changes as the cursor moves. OFF is the old behaviour.
>
> What "the view" is differs per surface, and that is the point of a shared control rather than a shared implementation.

| Surface | What the lock freezes | Default |
|---|---|---|
| GEX candles | The price axis and the visible bar range, pinned to `replayPriceRange` = the whole session's low→high | **ON** |
| Options chain grid | The scroll — the ATM-row rescue that fires when it leaves the central 60% | OFF |
| Multi Greek | The scroll — the four panels' re-centre on the ATM strike | OFF |
| Ticker Lookup ladders | The window anchor **and** the bar scale | OFF |
| Chain ladder | Bar scale / window anchor (`ReplayLock` in `LadderModal`) | OFF |

The candles tab is the documented exception:

> The other four replay tabs open unlocked, because on a ladder the unlocked behaviour is merely busy. Here it is the thing everyone hits first: a candle chart that opens rewound to 09:30 has one bar of price range, and every step of the scrubber re-derives the axis from however much of the day has been revealed. The chart visibly grows and re-scales all the way to the close, which is unusable for the one job replay has — watching a level hold or break. Locked, the pane is the whole session from the first bar and only the candles change. The button is right there to turn it off.

It is **re-armed, not cleared**, whenever the subject changes — picking another session sets `setAxisLock(true)` again, because *"the default is the default every time you enter replay or pick another session, not only on the first one."* Rendered even when pressed: *"the default is a default, and the one thing worse than a chart that rescales is a chart that will not."*

The button itself: 22px tall, `padding 0 8px`, `borderRadius 6`, `--text-2xs`, `fontWeight 800`, `letterSpacing 0.04em`. ON → `--color-warn` text on `warn@16%` with a `warn@55%` border and the glyph `🔒 Axis`; OFF → `--color-muted` on `fg@5%` with a `--color-line` border and `🔓 Axis`. `aria-pressed` is set.

### The replay stamp

Every rewound surface burns its caption into the pane. `ReplayStamp.tsx`:

> These surfaces are SCREEN-RECORDED. A recording is a crop of the pane, and a caption that lives in the page chrome above it is one crop away from being gone — so a clip of a rewound ladder becomes indistinguishable from a clip of a live one, which is the single worst way any of these can be misread. The stamp therefore rides the pane itself, at its top-left, and the brand mark rides the bottom-right. Both travel with the pixels.

`pointerEvents: none` throughout — *"the stamp sits over a scrubbable, hoverable surface and must never intercept a click meant for a strike or a candle."*

**Three lines, at most:**

1. `symbol` in mono, `--text-base` (15px), `--color-accent`, `letterSpacing 0.08em`; then an optional expiry chip — `0DTE` in `--color-warn` when `zeroDte`, else `EXP <label>` in `LIGHT_BLUE`, on a 10%-alpha plate with a 45%-alpha border; then an optional `+N` for extra summed expiries.
2. `<dateLabel> · <clockLabel>`, `--text-xs`, `fg@55%`, tabular. Either half may be absent.
3. `note`, `--text-2xs`, `fg@45%` — the caveat, e.g. `recorded walls only`.

**Plate:** `alpha(--color-bg, 0.62)`, `1px solid --color-line`, `borderRadius 8`, `padding 6px 10px`, `backdropFilter: blur(6px)`, `zIndex 6`. *"Frosted so it stays legible over a bar, a candle or a lit row."*

**`ReplayBrand`** is the CB Edge **wordmark**, bottom-right, `opacity 0.85`, `h-6 w-auto`:
> Deliberately the WORDMARK and not the square badge: this sits in a wide, mostly-empty corner of a chart, and the horizontal lockup reads at a glance in a compressed recording where a 24px badge does not.

The candles tab insets it past the axis: `right={phone ? 44 : 68} bottom={phone ? 26 : 30}` — *"Sitting the mark ON the axis labels is worse than not drawing it: the price is the one thing a recording must stay readable."*

---

## The data path

### Endpoints

| URL | Used by | Returns | When |
|---|---|---|---|
| `/proxy/strike-growth/replay-meta?symbol=<T>` | Multi Greek (×4, parallel), chain grid, chain ladder, Ticker Lookup | `{ dates: string[] }` | on entering replay / on symbol change |
| `/proxy/strike-growth/frames-by-expiry?symbol=<T>&date=<YMD>` | Multi Greek (×4, parallel), chain grid, Ticker Lookup | `{ ok, error?, expiries: string[], frames: [{ ts, spot, cells }] }` | once per (symbol, session) |
| `/proxy/strike-growth/frames?symbol=<T>&date=<YMD>` | **chain ladder only** | one net per strike for the front active expiry | once per (symbol, session) |
| `/api/snapshots/option-strike-gex-history?mode=heatmap&minutes=5760…` | GEX candles | one column per minute | the card's own poll |
| `/api/snapshots/candles` / the etf-candles route | GEX candles | 7 calendar days of 1m bars | the card's own poll |
| `/api/expirations` | GEX candles | first entry only — the nearest expiration | the card's own effect |

Everything goes through `query()` from `src/data/api.ts` with **`staleMs: 0`** on the replay path — both `MultiGreekReplay.tsx` and `useChainData.ts` wrap it in a local

```ts
async function get<T>(url: string): Promise<T | null> {
  try { return await query<T>(url, { staleMs: 0 }) } catch { return null }
}
```

so a recorded session is never served from the cache window, and a failure returns `null` rather than throwing into the tree.

**Nothing on this page polls.** `MultiGreekReplay.tsx` is explicit:

> This page opens NONE of them — it is REST-only, two recorder endpoints, no socket, and nothing polls. That is a departure, and it is recorded as one in the spec rather than being quietly better.

The thing it is a departure from:

> v2 keeps every live loop running while rewound and throws the output away: a 15s chain poll per ticker, an ES/SPX basis poll, the socket, an EM lookup, a 35-minute GEX ring. None of it reaches the screen.

The GEX-candles tab is the exception — it is a live board card with a cursor, so its polls keep running; what stops is the *rendering* of live data (see "The candles tab" below).

### The prefetch

`NAV` warms `/proxy/strike-growth/replay-meta` **with no `?symbol=`**. Every real call appends one, so the warmed URL is a different cache key and is never read back — this prefetch warms the route's connection and any server-side work the bare path does, not the response the page will use. (Contrast `/em`, whose NAV comment says its prefetch *"reads it back out of the api.ts cache"*.)

### One request per session, not per step

`useChainData.ts`:
> The frames. One request per (symbol, session) — the whole day is pulled up front so scrubbing is instant and never re-hits the network mid-drag.

And the previous session is dropped **immediately** on a change:
> Holding it while the new day loads would render one date's grid under another date's label.

Same rule for the ticker:
> Leaving replay (or switching ticker) drops the session so the next entry does not flash the previous symbol's frames under the new ticker.

### The positional wire format

`frames-by-expiry` returns cells as `[expiryIndex, strike, net, vol]` against the response's own `expiries` index table:

> which is what keeps a full session inside a few hundred KB. A cell naming an expiry or a strike that does not resolve is dropped rather than guessed at.

`parseMgSession` returns **`null`** for a response with no usable frames, *"so the caller can tell 'this ticker was never recorded' from 'this ticker recorded nothing yet'."* And it sorts once, at parse time:

> Ascending, once, here — every step-hold below breaks out of its scan on the first frame past the cutoff and is wrong on an unsorted list.

### What the recorder actually stores

This is the single most-repeated warning in the replay code, and every transport states it out loud.

`analysis/lookup/replay.ts`:
> * The recorder stores the top N strikes per side per expiry per sweep. It is a record of the WALLS, not the whole ladder — a strike that was never a wall renders "—", NOT 0. ("Not recorded" and "no gamma here" are different answers…)
> * Only GEX is recorded. ± Move and ATM IV are priced off live marks, so they read "—" while rewound rather than putting today's premium on a three-day-old ladder.
> * The Δ 1D column is an END-OF-DAY series. It has nothing to say about an intraday clock, so it is hidden entirely while rewound.
> * Cadence is the recorder's sweep (**2 min hot lane / 5 min full roster**); retention is about **five trading days**.

`ReplayBar.tsx`:
> The bar also states its own COVERAGE out loud, twice over. `strike_growth` records only the top N strikes a side per sweep, so the grid looks like the live chain while being a record of the WALLS — without the "recorded walls only" line and the cells-this-frame count, a missing strike reads as "no gamma there" rather than "the recorder never stored that strike".

`MultiGreekReplay.tsx` puts the same reasoning behind the dock's colour:
> the recorder stores the WALLS, not every strike, so a grid that looks like a live chain while being a record of the walls is the single worst way this can be misread, and the caveat line on the right is the sentence that stops it.

**The caveat strings, verbatim:**

| Surface | String |
|---|---|
| Multi Greek | `· recorded walls only · sweeps held to the minute · Δ and EM off while rewound` (+ ` · no history: <tickers>` when any slot has none) |
| Ticker Lookup | `· recorded walls only · sweeps held to the minute · ± Move, ATM IV and Δ 1D off while rewound` |
| Chain grid | `· recorded walls only · <N> expiries · <shown>/<total> cells this frame · GEX only` |
| Stamp `note` | `recorded walls only` |

The chain grid's fraction is scoped, deliberately:
> Cells present / cells the SCOPED axis could hold, so the denominator shrinks with the scope instead of implying the 0DTE view is missing the other expiries' cells.

### Retention, said out loud on every bar

Two different recorders with two different limits, and the UI never guesses at either.

**`strike_growth`** (Multi Greek, both chains, Ticker Lookup) — *"retention is about five trading days"*. The picker lists whatever `replay-meta` returned.

**`option_strike_gex_history`** (GEX candles) — pruned by `pruneOptionStrikeGexHistory` in `server-v2/_lib-db.cjs` to `GEX_HISTORY_KEEP_SESSIONS`, **three trading sessions**, env-overridable:

> So the session picker below will offer at most three days no matter what this number says, and on a Monday two of them may be Thursday and Friday. That is a retention decision, not a client one: raising `GEX_HISTORY_KEEP_SESSIONS` is what buys more days.
>
> The picker therefore never guesses. It lists the ET days the payload actually came back holding, and says how many that was.

`REPLAY_HISTORY_MINUTES = 5760` (4 days) is the route's own clamp: *"asking for more is silently the same request, so this is 'everything there is'."* `REPLAY_CANDLE_DAYS = 7` is dxFeed's practical 1m ceiling: *"simultaneously 'enough to cover the oldest retained gamma session across a weekend' and 'the most that can be answered'."*

The retention line is the same sentence in four places, and the reason is the same each time:

> HOW MANY SESSIONS ARE ACTUALLY THERE. The recorder's retention — not this card — decides the length of that list, and a dropdown with three entries and no explanation reads as a broken fetch rather than as the limit it is. Said out loud, in the same place, on every replay transport in v3.

Tooltips, verbatim:

* Multi Greek session picker: `Recorded session. The recorder keeps roughly five trading days.`
* Multi Greek count: `Recorded sessions across the four slots. Server-side retention decides this, not the board.`
* Ticker Lookup count: `Recorded sessions the strike-growth recorder is holding for <SYM>. Server-side retention decides this, not the chart.`
* Chain ladder count: `Recorded sessions held for <SYM>. Server-side retention decides this, not the chart.`
* Candles picker: `Which recorded session to scrub`; count: `Sessions currently held in option_strike_gex_history. Server-side retention (GEX_HISTORY_KEEP_SESSIONS) decides this, not the chart.`

---

## Tab 1 — Chain ladder

**Title:** `Option chain replay`
**Blurb / tooltip:** `Per-strike net GEX for one expiry, played through the session. Its own symbol and date pickers.`
**Shape:** framed, scrolling body.
**Mount:** `<LadderReplay symbol={symbol} embedded />` → `LadderModal`.

A different data path from the grid, on purpose:

> `/proxy/strike-growth/frames` returns ONE net per strike for the front active expiry, where `/frames-by-expiry` returns the whole matrix. The ladder is the front contract's profile moving through the day; the grid is every expiry at one instant. Both read the same recorder.

`embedded` changes three things: the header goes `row` instead of `column`, the bottom margins collapse to 0, and the transport portals into the dock (`embedded ? <ReplayDock>{transport}</ReplayDock> : transport`). The modal wrapper is skipped entirely — `if (embedded || !onClose) return <div>{body}</div>`.

It keeps a `TickerPicker`, and the comment beside it says whose list it is: *"The RECORDER's symbol list, not the board's — a session can only [be replayed if it was swept]."*

Two behaviours transcribed rather than simplified, *"because both were bugs that took a while to see"*:

> * The spot line's vertical position is DERIVED DURING RENDER, not held in state. Measured in a layout effect it sat one commit behind the `spot` the label printed in the same paint — invisible at rest, and tens of strikes out during playback.
> * The spot TWEEN lands exactly on the frame's spot in its cleanup. An interrupted tween otherwise leaves the displayed spot SHORT of the frame it was heading for, the next tween starts from that shortfall, and the error compounds — one dropped frame is invisible, a few hundred is how the dashed line ends up dozens of strikes from the price.

Colours: positive net GEX is `MOVE_UP` (`--color-move-up`, `#4d8cff`) — *"v2 used `HOME_THEME.green` here, which is a light blue"* — and negative is `T.red` (`--color-down`, `#ff6b7a`).

**Empty state:** `No recorded frames for <SYMBOL> on <date or 'this date'>.`

---

## Tab 2 — GEX levels

**Title:** `GEX levels replay`
**Blurb:** `The Ticker Lookup's two ladders — one expiry beside the whole board ex-0DTE — with the walls and gamma flip they imply.`
**Shape:** framed, scrolling body.
**Mount:** `<TickerLookupCard embedded initialReplay />` from `src/pages/analysis/lookup/TickerLookup.tsx` — the same component `/analytics` renders.

`embedded` drops the card's page span (`<AnalysisCard span={!embedded} height="auto">`); `initialReplay` seeds `replayOn`. Its own ticker dropdown is **gone** on this route — it follows `usePageSymbol` outright.

It rewinds **both panes off one clock** (*"every ladder, level chip, wall and the plain-language read are rebuilt from a recorded strike_growth sweep instead of the live chain"*). Its scrubber resolution is the minute (`tlMinute`), its clock format `HH:MM` 24-hour ET, and its axes are session-wide unions: *"Every strike recorded in ANY frame, ascending — the fixed ladder axis."*

Three live readings go dark while rewound, and the bar says which: **± Move**, **ATM IV** and **Δ 1D**.

---

## Tab 3 — GEX candles

**Title:** `GEX candles replay`
**Blurb:** `The candles with the GEX bubbles and the rail over them, scrubbed through the session on one cursor — the ladder as it stood at each bar, not as it stands now.`
**Shape:** framed **with `chart: true`** — the only tab that sets it, so its body wrapper is a flex column rather than a scroller.
**Mount:** `<GexCandles replay />` — `GexCandlesCard` from `src/board/gexCandles/`, the same chunk the board loads.

### It is opt-in and costs nothing

> OPT-IN, via the `replay` prop, and the board does not pass it. `<GexCandlesCard />` on the board is byte-for-byte the live card it has always been: no transport, no toolbar change, no extra request, and every replay hook sits inert behind one `replayOn` flag.
>
> It costs NOTHING to fetch, which is the reason it could be added at all. This card already holds a whole session of candles AND a whole session of per-minute GEX ladders in memory — that is what the bubbles ARE. So the replay is not a second data path: it is ONE cursor timestamp, and both series are clipped to it. `bars.filter(t <= cursor)` and `columns.filter(slotTs <= cursor)`, **upstream of the bubble model and the rail**, so the candles, the bubbles and the rail can never disagree about what time it is.

The state is declared unconditionally: *"Declared unconditionally because hooks are — the cost of an unused piece of state is nothing, and the alternative is a second component."*

### The cursor is a timestamp

> THE CURSOR IS A TIMESTAMP, NOT A BAR INDEX. Switching 1m → 5m rebuilds the timeline with a fifth of the entries; an index would land somewhere unrelated while a time stays the same time.

`replayIdx` is derived from `replayMs` on every render:

```ts
const after = replayTimeline.findIndex((t) => t > replayMs)
return after === -1 ? replayTimeline.length - 1 : Math.max(0, after - 1)
```

i.e. the last bar at or before the cursor. `replayMs = 0` means "not seeded yet" and the seed effect parks it on the session's **first** bar — *"the earliest possible opening state for a replay tab."* Note this is the opposite of every other tab, which lands on the **last** frame.

### What goes off while rewound

> Rewound, the live feeds are OFF — the socket's spot / esCandles frames paint the forming bar, and pushing a live print onto a rewound chart would put a 15:59 candle on a 10:04 tape. The forming-bar countdown goes with them: there is no bar forming in a session that already closed.

Each is a guard in the code: `livePrice = esCapable && !useEs && !replayOn`, `httpLive = !esCapable && !replayOn`, `if (!useEs || replayOn) return` on the ES subscription, and the countdown's `if (!settings.countdown || replayOn)`.

The multi-day tape picker is suppressed too: `const daysPicker = replayOn ? null : (…)` — *"replay is one picked session and the day dropdown [would be a second answer to the same question]."*

`viewKey` carries `replayOn ? 'R' : 'L'` so *"entering or leaving replay reframes ONCE. It is the only replay state that belongs here: the cursor moving is not a scale change."*

### The bubble denominator

While rewound, the bubble layer's size denominator is taken over the **whole replayed session**, not the revealed part — so a bubble does not grow as you scrub past it. Off the replay path nothing changes.

### Its own controls

* **Session picker** — `Fri 09-05` labels with the ISO date as a sub-line. Changing it clears the cursor (`setReplayMs(0)`) and re-arms the axis lock: *"carrying a timestamp across a day boundary would land it at whichever end of the new tape it happened to fall past."*
* **`N sessions recorded`** — the retention line.
* **The clock** — `HH:MM ET` from the cursor, `--:--` when unseeded. *"The clock is the whole point of the bar: it is the one place the cursor is stated as a TIME rather than as a slider position."*
* **`bar N/M`**, or **`no bars`**.
* **`🔒 Axis`, pressed by default.**
* **`Live`** — leaves replay *and* clears `replayDay`, `replayMs` and re-arms the lock: *"or coming back into replay reopens on a day that may no longer be the one on screen."* Title: `Leave replay and return to the live chart`.

A guard drops a stale session: *"a tab left open overnight can hold a `replayDay` the server no longer [has]"* — if `replayDay` is not in `sessionDays`, it is cleared.

---

## Tab 4 — Multi Greek

**Title:** `Multi Greek replay`
**Blurb:** `Four tickers rewound off one shared clock.`
**Shape:** **full** — no Card, no blurb on screen, the whole viewport under the tab bar.
**Mount:** `<MultiGreekReplay />`.

> It is the only tab … with no v3 component behind it: `board/multiGreek/MultiGreekCard.tsx` is the LIVE ladder and has no replay path, so this is a build rather than a mount.

### The one idea

From `mgReplay.ts`:

> Four tickers, four independent recordings, ONE clock. The recorder sweeps each symbol on its own cadence, so the four sessions do not share timestamps and never will. The timeline is therefore built out of MINUTE BUCKETS across every loaded session, and each panel independently answers "what was your last sweep at or before the end of this minute?" — a **STEP-HOLD, never a nearest-match**. A nearest-match would let one panel show a reading from thirty seconds in the future of the panel beside it, which is precisely the comparison this page exists to make honest.

```ts
minuteBucket(ms)      = Math.floor(ms / 60_000) * 60_000
pickMgFrame(s, clock) = last frame with f.t <= clock + 59_999      // step-hold
mgTimeline(sessions)  = sorted union of minuteBucket(f.t) over ALL sessions
```

> One step per recorded minute rather than a dense minute axis — a session with a twenty-minute recorder gap should not cost twenty scrubber steps that show the same reading. A ticker with no session contributes no steps and does not shorten anyone else's.

### Two things belong to the session, not the frame

> * the strike axis — the union across the whole day;
> * the expiry columns — likewise.
>
> A strike the current sweep did not record renders `--`, not 0: "no gamma here" and "not recorded at this moment" are different claims.

Restated at the row level:
> A ladder that gained and lost rows as the recorder's coverage moved would make scrubbing unreadable, and a strike this sweep did not record has a row with no value rather than no row.

A missing cell gets `opacity-50`, prints `--`, and carries the tooltip `not recorded in this sweep — the recorder stores the walls, not every strike`.

### The two decisions v3 keeps

> * **CW must be ABOVE spot and PW BELOW it.** v2 picks the top +GEX and most −GEX strikes with no spot filter, which lets a "call wall" print under the money. v3's `columnStats` guards both, and that guard is the shipped definition everywhere else in v3.
> * **`MAX_EXP_COLS` is 3.** The chain route returns the nearest expiration plus at most two more, so v2's 4 made its "4" option silently identical to "3".

Both come from `board/multiGreek/mgMath.ts` unchanged — *"one definition of a wall in v3, not two."*

### The two fetch waves

Both fan out in parallel, per non-negotiable 3:

1. `replay-meta` × 4 → **the union** of the four date lists, sorted descending. *"a session one ticker recorded and another did not is still a session worth scrubbing, and intersecting would hide it."*
2. `frames-by-expiry` × 4 for the chosen date → `parseMgSession` each.

Both effects key on `key = tickers.join(',')`, not the array: *"the array identity changes every render."*

The clock lands on the **last** step: *"the end of the session is the state you were most recently looking at live, so it is the one that needs no orientation."*

### A panel

**Header:** the ticker as bare text until clicked — *"A permanent bordered box was the widest thing in a narrow panel, spending it on three characters that change once a session."* On the right, the **recorded** spot (`toLocaleString`, max 2dp) or `--`.

The input's `onKeyDown` calls `stopPropagation` first, and says why: *"the page binds Space to play/pause, and a space typed into a ticker box must not scrub."* `Enter` blurs (committing), `Escape` reverts. `maxLength={6}`.

Committing empty **restores** rather than removes: *"four panels is the shape of the page, and a blank seat is not a comparison."* A duplicate is rejected (`commitTicker` returns `false`). Slot 0 writes to the **toolbar**, not locally:
> Slot 1 IS the board symbol, so typing here moves the TOOLBAR and the sync effect above brings the slot with it. Writing it locally instead would put the panel and the toolbar on two different symbols — and the effect would immediately snap the panel back, so the box would look broken.

**Column header block** — `Strike / Total` in the rail, then one block per column: the `NDTE` label, `GEX · MM-DD`, and the column's net total via `fmtGex` with a `posPct` percentage beside it (`text-up` at ≥50%, else `text-down`). The ex-0DTE column's tooltip counts expiries **per sweep**:
> Counted PER SWEEP, so it moves as you scrub while the column set stays fixed. That is the honest number: it says how many expiries this snapshot actually contributed.

**Rows** — descending strikes. The ATM row is outlined with a four-sided 2px inset `box-shadow` in `--color-fg` and `zIndex: 1`.

**Cells** — `cellAlpha(v, maxAbs, rank, intensity)` mixed into `--color-gex-pos` (`#4d8cff`) or `--color-gex-neg` (`#ff5fa2`); rank 0 also gets a `1px solid <hue>` outline at `outlineOffset: -1`.

**The Core Bullseye wash** is the longest comment in the file:

```ts
const CB_WASH = `linear-gradient(112deg, ${CB_GOLD} 0%, ${CB_FILL} 55%, ${CB_FADE} 82%)`
// CB_GOLD = var(--color-level-cb)                    (#ffd166)
// CB_FILL = color-mix(… --color-level-cb 85%, transparent)
// CB_FADE = color-mix(… --color-level-cb  0%, transparent)
```

> Replay used to paint v2's FLAT gold at 85% over the whole cell, and that was the bug both of those surfaces already fixed: a Core below spot is negative, and at 85% the gold buried the red — two cells that meant opposite things looked identical. The wash keeps gold where the eye looks for the marker (the ★ / badge end of the cell) and is gone before the figure, which sits on the ordinary heat and reads red or blue again.
>
> Stops are the ladder's 55/82, not the chain's 26/66: the ladder is scanned across four panels at once, so gold holds through the figure and hands over in the last quarter.

> Fades to gold-at-zero, not `transparent`: a ramp through grey reads dirty.

The composite is `background: ${CB_WASH}, ${heat}` — *"A gradient layered over a background in one property is the only way to composite a translucent layer over another without knowing what the layer underneath resolved to."*

The ★ on a non-front column is drawn in `--color-app`:
> Drawn in the app ground, not gold: the corner it sits in is where CB_WASH holds FULL gold, and a gold star on gold is an invisible star. No halo either — solid gold is already its ground, and the glow only softened the glyph's edge. Matches the live ladder.

On the **front** column the level is a `CB` / `CW` / `PW` badge instead, `bg-app` with `inset 0 0 0 1px var(--color-level-<kind>)`.

### The three empty states

> v2 has only two paths here and they collapse: a ticker with no session AND a ticker whose clock sits before its first sweep both fall through to the LIVE string "Select an expiry and click GO" — advice with no GO button anywhere on the page, and its own intended wording ("No recorded sweeps for X this session") is unreachable. Fixed rather than transcribed: `docs/parity/replay.md`, open decision 2.

```
loading                    → "Loading recorded session…"
no session                 → "No recorded sweeps for <T> this session"
session, no frame, no clock→ "No recorded sweeps for <T> this session"
session, no frame, a clock → "<T> had not swept yet at HH:MM ET"
frame, no strikes          → "No strikes in range"
```

### The re-centring, and the lock

Two effects in a deliberate order:
> a ladder that genuinely changed clears the user-scroll latch in the same commit the centring effect then acts on. While rewound the ladder is fixed for the session, so this fires only when the ATM strike moves — i.e. when spot crosses a strike — and otherwise holds wherever the user left it.

The user-scroll latch is set from `wheel` and `touchmove` listeners (both `passive: true`) that compare `scrollTop` across a `requestAnimationFrame`. The centring effect is the **first line** the lock short-circuits: `if (axisLock) return`.

Why the lock is one switch for all four:
> The strike axis here is already the session's union and holds still; what moves is the SCROLL. The panel re-centres on the ATM strike whenever spot crosses a rung, and across four panels on one clock that is four ladders jumping at four different moments while you step. Locked, none of them move and the numbers change underneath a fixed set of strikes — which is the comparison this page exists to make.

### Settings (the ⚙ popover)

| Control | Options | Default | Persisted as |
|---|---|---|---|
| Columns | `1` / `2` / `3` | `MAX_EXP_COLS` = 3 | `cb-v3-replay-mg-col-count` (string) |
| `ALL ex-0DTE` | on/off | **on** | `cb-v3-replay-mg-ex0` (`'1'`/`'0'`) |
| Basis | `OI+VOL` / `VOL` | `oivol` | `cb-v3-replay-mg-basis` |
| Heat intensity | 0.5 → 3, step 0.05 | **1.75** | **not persisted** |
| `CB / CW / PW` | on/off | **on** | **not persisted** |
| Tickers | four slots | `['SPX','SPY','QQQ','NDX']` | `cb-v3-replay-mg-tickers` (JSON `string[]`) |
| 🔒 Axis | on/off | **off** | not persisted |

Tooltips, verbatim: `How many EXPIRY columns each panel draws, nearest first. Three is every expiry the recorder stores.` · `Append a total column summing every recorded expiry except 0DTE — including expiries with no column of their own.` · `OI+VOL is the recorded net; VOL is the recorded volume-only series` · `How hard the wash ramps. The top three strikes in a column keep their fixed steps at every setting.` · `Mark the Core Bullseye, Call Wall and Put Wall. The front expiry names them; later expiries star their own CB.`

The ⚙ button's own title is dynamic: `Board settings — <BASIS_LABEL> · <n> of 4 col`.

`loadTickers()` overlays saved slots on the defaults and resets duplicates:
> A repeated symbol is not a comparison — it is one panel fewer, silently.

The slot-1 sync effect does the same thing live: the displaced symbol moves into whichever slot now duplicates the new one, *"so the tab still shows four distinct readings across a toolbar change."*

**`Space` toggles play/pause**, document-wide, skipped inside `INPUT`, `TEXTAREA` and `contentEditable`.

### The basis note

`mgReplayValues`'s docstring:
> The OI-only basis has no recorded series (the recorder stores net and volume, not the two legs), so it resolves to net exactly as v2's does.

So the ⚙ offers only two of `mgMath`'s three `Basis` values.

---

## Tab 5 — Options chain

**Title:** `Options chain replay`
**Blurb:** `The full grid — every strike and column — rewound.`
**Shape:** **full**.
**Mount:** `<OptionsChain initialReplay initialReplayScope="0dte" />`.

The scope seed is argued in `Replay.tsx`:
> Opens scoped to 0DTE: this tab is for watching the front contract move, and "all expiries" is one click away on the bar's own scope control.

(`OptionsChain`'s own default is `initialReplayScope = 'all'`; only this tab overrides it.)

### The scope switch

`REPLAY_SCOPES = ['0dte', 'all']`, labelled `0DTE` and `All exp`.

> 0DTE collapses the grid to the session's front/same-day expiry; All expands it back to every recorded expiry plus the ⅀ Total column. **The frame index is untouched by the switch** — the clock you are parked on is the thing being examined, and losing it to change what is summed would be the wrong trade.

The session's 0DTE expiry is *"the one expiring ON the replayed date"*, falling back to the front recorded expiry when the root had no same-day listing — which the tooltip then says out loud:

* exact: `Show only <exp> (expires this session)`
* inexact: `Show only <exp> — front recorded expiry; this root had no same-day listing`
* none: `No expiry recorded for this session` (button disabled, `opacity 0.4`)
* all: `Show all <N> recorded expiries, with the ⅀ Total column (0DTE excluded from Total, as on the live chain)`

### Greek tab and axis

Entering replay forces the greek tab to **GEX**: *"GEX is the only greek `strike_growth` records."*

The replay axis is the session's union of strikes and expiries, filtered by scope — *"This is the difference between a replay you can read and one that shakes."* Spot falls back to the live spot when the frame's is 0.

### The lock

> On the grid the axis is FIXED already (the session's strike union), so the thing that moves is the SCROLL: the ATM row walks down a stationary ladder as the session runs, and the page pulls it back to the middle whenever it leaves the central 60%. That rescue is right when you are watching a session play through and wrong when you are stepping over the same ten minutes, so the lock switches it off. Owned by `OptionsChain.tsx`, which is where the scroller lives.

### The right-hand button

`⛶ Ladder`, title `Open the single-ladder replay view` — the door back to the same component tab 1 mounts, as a modal this time.

### Error strings

* `Could not load recorded sessions.` — `replay-meta` returned null
* `No recorded sessions for <TICKER>.` — meta returned an empty `dates`
* `Could not load frames.` — `frames-by-expiry` returned null
* `No recorded frames for <TICKER> on <date>.` — or the server's own `error` field
* And the page-level line: `<err> The recorder keeps roughly five trading days and only covers tickers on the scanner watchlist.`

---

## Every derived number

| Value | Formula | Units |
|---|---|---|
| Frame interval | `BASE_MS / speed` = `700 / speed` | ms |
| Minute bucket | `floor(ms / 60_000) * 60_000` | epoch ms |
| Step-hold pick | last frame with `f.t <= clock + 59_999` | — |
| Shared timeline | sorted union of `minuteBucket(f.t)` over all loaded sessions | epoch ms |
| Candles cursor index | `findIndex(t > replayMs) - 1`, clamped | bar index |
| Column DTE | `daysBetween(replayDate, expiration)` = `round((Date.parse(exp+'T12:00:00Z') - Date.parse(date+'T12:00:00Z')) / 86_400_000)` | whole days |
| Column label | `` `${Math.max(0, daysTo)}DTE` `` | — |
| Cell value | `Σ over expiries of (basis==='vol' ? cell.vol : cell.net)` | dollars of GEX |
| `maxAbs` / `cb` | strike of the biggest `|GEX|` in the column | — |
| `cw` / `pw` | biggest +GEX **above** spot / most −GEX **below** spot, skipping the CB | — |
| `posPct` | positive share of the column's total | percent |
| Cell alpha | `cellAlpha(v, maxAbs, rank, intensity)` — ranks 0–2 take fixed steps, the rest ramp | 0–1 |
| `fmtGex` | `≥1e9 → $x.xxB`, `≥1e6 → $x.xxM`, `≥1e3 → $xK` (0dp), else `$x` (0dp); zero/null → `--` | — |
| Chain coverage | `cellsPresent / (strikes × max(1, expiries))` | cells |

**Two date formatters both parse at noon UTC**, for the same reason:

`fmtMgStampDate`:
> Parsed at NOON UTC, never midnight: `new Date('2026-09-08')` is midnight UTC, which is the 7th in New York, and the stamp would name every session as the day before itself. Formatted in UTC for the same reason.

`dayLabel` in `GexCandlesCard.tsx` says it again for `Fri 09-05`, and `daysBetween` in `mgMath.ts` uses `T12:00:00Z` on both ends for the same reason.

**The clock formats differ by surface**, and that is deliberate — `HH:MM` where the resolution is the minute (Multi Greek, Ticker Lookup, candles), `HH:MM:SS` on the chain grid where the frame is a sweep.

---

## Controls and where state lives

| Control | Default | Storage |
|---|---|---|
| Active tab | `chain-ladder` | **`#tab=<id>`** in the URL hash |
| Board symbol | `SPX` | **`localStorage` `cb-v3-page-symbol`**, via `usePageSymbol` |
| Multi Greek slots 2–4 | `SPY`, `QQQ`, `NDX` | **`localStorage` `cb-v3-replay-mg-tickers`** (JSON `string[]`, slot 1 overwritten by the toolbar) |
| MG column count | 3 | **`localStorage` `cb-v3-replay-mg-col-count`** |
| MG ex-0DTE | on | **`localStorage` `cb-v3-replay-mg-ex0`** |
| MG basis | `oivol` | **`localStorage` `cb-v3-replay-mg-basis`** |
| MG intensity | 1.75 | React state only |
| MG CB/CW/PW | on | React state only |
| Session date | newest available | React state, per surface |
| Speed | 1× | React state, per surface |
| Playing | false | React state, per surface |
| Cursor | last frame (all but candles) / first bar (candles) | React state |
| 🔒 Axis | off, **on for candles** | React state |
| Chain scope | `0dte` on this route | React state |
| Rail icon order | `NAV` order | `localStorage` `cb-v3-rail-order` (Shell's) |

**Nothing about the replay session itself survives a reload** except the tab, the symbol and the Multi Greek board. Every `localStorage` write goes through a try/catch `write()` marked `/* best-effort */`.

---

## Rendering

**Mostly DOM.** The Multi Greek panels, both ladders, the chain grid and every transport are `<div>` grids and inline styles. The one `<canvas>` on the page belongs to the GEX-candles tab — lightweight-charts inside a `ChartFrame`, plus the card's own bubble/rail layers, all tagged `data-cb-layer` per non-negotiable 6.

The transports are **inline-styled from the theme object**, not from token utility classes, and the Multi Greek `Select` says why: *"this bar is inline-styled from the theme object, not the token utilities, so a class-based control would read as a stray."* That is still tokens underneath — `T.orange` is `var(--color-warn)`, `alpha()` emits `color-mix(in srgb, var(--color-…) N%, transparent)`.

The one place a native control was replaced: the Multi Greek session picker.
> a native `<select>` handed it to the OS, which draws it in the platform's chrome — a light menu over a dark dock.

### Colour tokens

| Token | Hex | Where |
|---|---|---|
| `--color-warn` | `#ffd166` | the dock's border, gradient and glow; the word `Replay`; every pressed transport button; the scrubber's `accentColor`; the 🔒 lock when on; the `0DTE` stamp chip |
| `--color-accent` | `#2f6bff` | the selected tab pill's fill; the stamp's symbol; the panel ticker; `loading…` |
| `--color-bg` | `#0a0d10` | page canvas; the selected tab's ink (`text-bg`); the stamp plate at 62% |
| `--color-app` | `#0a0d10` | the ★ glyph and the level badge plate |
| `--color-surface` | `#0e1216` | the framed tabs' `Card` |
| `--color-surface2` | `#141a21` | a Multi Greek panel's plate; the unselected tab's hover |
| `--color-raised` | `color-mix(#141a21 92%, #e7ece9)` | unselected tab pill |
| `--color-line` | `#1e2630` | every border and the `|` dividers |
| `--color-fg` | `#e7ece9` | the ATM row outline; primary text |
| `--color-muted` | `#e7ece9` | labels, the unlocked 🔒 |
| `--color-faint` | `#c0c5c3` | `LOADING REPLAY…` |
| `--color-gex-pos` | `#4d8cff` | positive cell heat |
| `--color-gex-neg` | `#ff5fa2` | negative cell heat |
| `--color-level-cb` | `#ffd166` | the Core Bullseye wash |
| `--color-level-cw` | `#4d8cff` | the CW badge ring |
| `--color-level-pw` | `#ff5fa2` | the PW badge ring |
| `--color-move-up` | `#4d8cff` | the ladder's positive bars |
| `--color-down` | `#ff6b7a` | the ladder's negative bars; error text |
| `--color-up` / `--color-down` | `#3ddc8e` / `#ff6b7a` | the `+`/`−` sign glyph and `posPct` |
| `--color-shadow` | `#000000` | the dock's upward shadow at 35% |

### Layout constants

| Constant | Value | Where |
|---|---|---|
| Dock z-index | 40 | `ReplayDock` |
| Dock padding | `8px 16px`, `gap: 10` | `ReplayDock` |
| Dock blur | `blur(14px)` | `ReplayDock` |
| Stamp z-index | 6 | `ReplayStamp` / `ReplayBrand` |
| Stamp offset | `left 8, top 4` (Multi Greek passes `top -2`) | `ReplayStamp` |
| Stamp blur | `blur(6px)` | `ReplayStamp` |
| Brand offset | `right 8, bottom 6`; candles: `right 68 / 44`, `bottom 30 / 26` | `ReplayBrand` |
| Strike rail | `RAIL_PX = 76` | `MultiGreekReplay` — *"matching the live card so the two boards read alike"* |
| Panel grid | `76px repeat(N, minmax(0, 1fr))` | `MultiGreekReplay` |
| Transport button | `height 24` (22 for speed/lock) | all bars |
| Scrubber | `height 3`, `minWidth 160–180`, `flex 1` | all bars |
| Ticker input | `w-[58px]`, `maxLength 6` | `ReplayPanel` |
| ⚙ popover | `w-60` | `MultiGreekReplay` |
| Session `Select` menu | `menuWidth="w-32"` | Multi Greek, Ticker Lookup, candles |

Multi Greek panels hide their scrollbars entirely — `[&::-webkit-scrollbar]:hidden` plus `scrollbarWidth: 'none'` and `msOverflowStyle: 'none'` — and the panel row is `overflow-x-auto`, so four panels scroll sideways on a narrow viewport rather than crushing.

---

## Phone behaviour

**`/replay` is not in `DESKTOP_TO_MOBILE`.** That map holds three entries (`/board`, `/traders-dashboard`, `/em`), and the comment above it names this route:

> ONLY routes listed here redirect a phone; everything else (Analysis, Flow, **Replay**, Scanner, Premarket) keeps rendering its desktop layout, because there is no phone build of it and a cramped real page beats a redirect to an unrelated one.

So a phone on `/v3/replay` gets the desktop hub inside the full `Shell`. What that means in practice:

* **The dock still works.** `Shell.tsx` mounts a `ReplayDockHost` on the mobile branch too, so a transport still lands at the bottom edge — and being in flow, it shrinks the surface rather than covering it. It wraps (`flexWrap: 'wrap'`), so on a narrow screen it simply gets taller.
* **The tab bar wraps** — `flex-wrap` with `gap-2`.
* **The Multi Greek row scrolls sideways.** Four `min-w-0 flex-1` panels in an `overflow-x-auto` row.
* **The candles card knows it is on a phone.** `GexCandlesCard` reads `useIsPhone()` and moves the brand mark and the countdown clear of the price axis: `ReplayBrand right={phone ? 44 : 68}` and the countdown from `right-16 text-xs` to `right-2 text-sm`. That is the only phone-aware code any of the five tabs contains.
* **None of the transports are touch-sized.** Every button is 22–26px tall with `--text-2xs` ink; `Controls.tsx`'s `size="touch"` (34px) is not used on any replay bar.

There is **no `/m/replay` tab** — `MOBILE_TABS` has six entries and this is not one of them. The nearest phone surface is `/m/spx`, which mounts the same `GexCandlesCard` **without** the `replay` prop.

---

## Status and empty-state messages, verbatim

| String | Where | When |
|---|---|---|
| `LOADING REPLAY…` | the hub's Suspense fallback | a tab's chunk is downloading |
| `Loading recorded session…` | a Multi Greek panel | `loading` |
| `No recorded sweeps for <T> this session` | a Multi Greek panel | no session, or a session with no frame and no clock |
| `<T> had not swept yet at HH:MM ET` | a Multi Greek panel | a clock earlier than that ticker's first sweep |
| `No strikes in range` | a Multi Greek panel | a frame with an empty strike union |
| `No recorded sessions for these tickers.` | the Multi Greek dock | the four `replay-meta` calls returned nothing |
| `No recorded frames on <date>.` | the Multi Greek dock | all four sessions parsed to `null` |
| `loading…` | every dock, in `--color-accent` | a fetch in flight |
| `· recorded walls only · sweeps held to the minute · Δ and EM off while rewound` | the Multi Greek dock | a loaded timeline |
| `· no history: <T>, <T>` | appended to the above | any slot with no session |
| `· recorded walls only · sweeps held to the minute · ± Move, ATM IV and Δ 1D off while rewound` | the Ticker Lookup dock | a loaded timeline |
| `· recorded walls only · <N> expir(y\|ies) · <n>/<m> cells this frame · GEX only` | the chain-grid dock | a frame is selected |
| `No recorded frames for <SYM> on <date>.` | the chain ladder body | no frames |
| `Could not load recorded sessions.` | the chain-grid dock | `replay-meta` returned null |
| `No recorded sessions for <TICKER>.` | the chain-grid dock | empty `dates` |
| `Could not load frames.` | the chain-grid dock | `frames-by-expiry` returned null |
| `No recorded frames for <TICKER> on <date>.` | the chain-grid dock | empty `frames`, or the server's own `error` |
| `… The recorder keeps roughly five trading days and only covers tickers on the scanner watchlist.` | `OptionsChain.tsx` | appended to any replay error |
| `no bars` | the candles dock | an empty timeline |
| `1 session` / `<N> sessions` | Multi Greek, Ticker Lookup, chain ladder | always |
| `<N> sessions recorded` | the candles dock | always |
| `--:--` / `--:--:--` | every dock's clock | no frame |
| `--` | a Multi Greek cell, or a panel's spot | not recorded in this sweep |
| `No candles recorded for <T> yet.` | the candles card | empty and not loading |
| `not recorded in this sweep — the recorder stores the walls, not every strike` | a cell tooltip | a missing cell |

---

## Performance and bundle notes

### The hub's own chunk is nearly empty

App.tsx: *"Its own chunk is small on purpose: three of the four tabs `lazy()` into the SAME chunks `/options-chain` and `/analytics` already load."*

`Replay.tsx` restates it as a rule about entry cost:

> Every tab is `lazy()`: opening this page must not pull the Options Chain's chunk down before anyone has picked that tab. They are the same chunks the `/options-chain` and `/analytics` routes already load, so a user who has been to either arrives here with the tab already cached.

Where each tab's weight actually lives:

| Tab | Chunk | Already loaded by |
|---|---|---|
| `chain-ladder` | `LadderModal` | `/options-chain` (its `⛶ Ladder` button) |
| `gex-levels` | `TickerLookup` | `/analytics` (the Ticker Lookup card) |
| `gex-candles` | `GexCandlesCard` | the home board, `/board`, `/m/spx` |
| `mult-greek` | `MultiGreekReplay` | **nothing** — this tab's chunk is its own |
| `options-chain` | `OptionsChain` | `/options-chain`, `/m/chain`'s ancestor |

So `Replay-*.js` itself is a tab bar, five `lazy()` calls and a `TABS` array — and four of the five tabs are a cache hit for anyone who has used the app. `MultiGreekReplay` is the one genuine addition, which is also the one tab with no live component behind it.

`budgets.json` lines that apply:

```json
"entry": 38900,
"react": 55000,
"route": 59100,
"css": 8500,
"html": 2600,
"totalInitial": 108400
```

Note `GexCandlesCard.tsx` is 2 056 lines and its own header states the ceiling it is written against:
> v2's `EsChartCard` is ~376KB of source; this card's whole route chunk has an 80kb brotli ceiling in `budgets.json`. "Only GEX bubbles" is what makes the two facts compatible.

(That 80kb is the comment's; `budgets.json`'s `route` line today is 59 100.)

### Runtime

* **Nothing polls on this page** except what the GEX-candles card brings with it. The other four tabs are two REST calls and then pure client-side scrubbing.
* **A whole session is pulled up front** so *"scrubbing is instant and never re-hits the network mid-drag."*
* **The playback loop is a `setInterval`,** not a `requestAnimationFrame` loop — at 8× that is a state update every 87.5 ms, which drives a full React re-render of four ladders on the Multi Greek tab.
* **The candles tab is the only one with a canvas**, so `scripts/perf-check.mjs`'s `data-cb-layer` accounting only sees that tab. The relevant limits:

```json
"idleRepaintsPerFrame": 0.15,
"offscreenRepaints": 0,
"interactionRepaints": 10
```

The Multi Greek tab's per-frame cost is React reconciliation of `4 × strikes × columns` cells — a `<div>` per cell with an inline `background` string. There is no virtualization and no visibility gate: the panels are always on screen by construction (the tab is `full`), so `ChartFrame`'s machinery does not apply.

---

## Gotchas

1. **There are five tabs. Four files say four.** `App.tsx`, `Replay.tsx`'s header, `MultiGreekReplay.tsx` and `ReplayStamp.tsx` all predate the GEX-candles tab (2026-09-03). Only `GexCandlesCard.tsx` counts right.

2. **The GEX-candles tab opens on the session's FIRST bar; every other tab opens on the LAST frame.** That asymmetry is deliberate on both sides — *"the earliest possible opening state for a replay tab"* vs *"the end of the session is the state you were most recently looking at live"* — but it means the ◀/▶ keys start at opposite ends depending on the tab.

3. **The axis lock is ON by default on exactly one tab.** Land on GEX candles and the pane is already frozen to the whole session's range; land on any other and it is not.

4. **`#tab=` is the only URL state.** The symbol, the session, the cursor and the speed are not in the URL, so a shared `/replay#tab=mult-greek` link opens on the recipient's own board symbol and their own saved slots.

5. **The rail prefetch warms a URL nothing asks for.** `/proxy/strike-growth/replay-meta` with no `?symbol=` is a different `api.ts` cache key from every real call.

6. **`staleMs: 0` everywhere on the replay path.** Re-picking the same session refetches it. That is intentional (a recorded day can still be growing) but it means the ◀/▶ of a session switch is a full round trip.

7. **The chain-ladder tab reads a different endpoint** (`/frames`, not `/frames-by-expiry`) and therefore a different shape — one net per strike for the front active expiry. Tabs 1 and 5 can legitimately disagree about a number because they are summing different things.

8. **A step-hold is not a nearest-match.** `pickMgFrame` uses `clock + 59_999` as the cutoff and takes the *last* frame at or before it. Changing that to a nearest-match would let one panel show the future of the one beside it.

9. **Missing is not zero.** A Multi Greek cell with no key prints `--` at `opacity-50`; a recorded zero prints its zero. `fmtGex` returns `--` for both `null` **and** literal `0`, so a genuine zero and a missing cell look the same in the *string* — the `recorded` flag is what separates them in the styling and the tooltip.

10. **`Space` is bound document-wide on the Multi Greek tab** and is not removed when another tab is active — it is, however, inside `MultiGreekReplay`, which unmounts with the tab, so the listener goes with it. The ticker input's `stopPropagation` is what keeps a typed space from scrubbing.

11. **Typing in Multi Greek slot 1 moves the whole app's board symbol.** It is not panel-local, and every other card on every other route follows it.

12. **A duplicate symbol silently costs a panel.** `commitTicker` rejects it outright; `loadTickers` and the toolbar sync effect quietly re-seat it.

13. **The Multi Greek dates list is a UNION, not an intersection.** A date in the picker may have frames for only one of the four slots; the other three then show `No recorded sweeps for <T> this session`.

14. **`MAX_EXP_COLS` is 3 because the backend returns 3.** A "4" option would be silently identical to "3" — that was v2's bug.

15. **The OI-only basis does not exist while rewound.** The recorder stores net and volume, not the two legs, so `mgMath`'s third `Basis` value has no ⚙ button here.

16. **Retention is three sessions on the candles tab and about five everywhere else.** They are two different tables (`option_strike_gex_history` vs `strike_growth`) with two different prune rules, so the session pickers on two tabs of the same page can legitimately offer different days.

17. **A tab left open overnight can hold a session the server has pruned.** The candles card guards this explicitly; the other tabs re-fetch `replay-meta` on entry and re-seed `date` only if the current one is still in the list.

18. **`ReplayDock` renders inline when there is no host.** That is how `LadderModal`'s modal path works — but it also means a replay bar mounted outside `Shell` silently appears in the middle of a layout rather than failing.

19. **`ReplayDockHost` must stay outside `ExpandStageHost`.** `Shell.tsx`: *"Inside ReplayDockHost, so the dock still holds the bottom edge under an expanded card rather than being covered by it."*

20. **Nothing on the page reports a stale recording.** There is no freshness clock — the stamp names the session and the cursor, and that is the whole guarantee.

