# Parity inventory — Replay

**What this is.** One line per value the v2 `/app/replay` page renders, with
where it comes from, how it is formatted, what changes its colour, what its sort
order is, and what it shows when the value is missing. It is the SPEC for the v3
port: `/v3/replay` is finished when every row here is ticked, and not before.

**Why it exists.** The failure mode this document prevents is rebuilding a page
from scratch — re-deciding what it contains at the same time as building it.
Both jobs were already done in v2. This file finishes the first one so the
second is only construction.

**Read this first.** `/replay` is a **hub**, not a page with its own data. It
owns a tab bar, a hash router and two mount shapes, and then it mounts four
components that already exist elsewhere. So this inventory has an unusual
property: three of its four tabs are ALREADY PORTED to v3 as part of other
pages. The port is mostly wiring, and one real build (Multi Greek). Part H is
the honest ledger of which is which — read it before estimating.

**Scope.** v2's `components/pages/Replay.tsx` (198 lines), mounted by
`app-vite/src/App.tsx:95` at `/app/replay` with **no props**, plus the four
components it mounts:

| File | Lines / bytes | Why it is in scope |
|---|---|---|
| `components/pages/Replay.tsx` | 198 | the hub — tab bar, hash router, two mount shapes |
| `components/shared/ChainReplay.tsx` | 594 | tab 1 — mounted `<ChainReplay embedded />` |
| `components/pages/Analytics.tsx` → `TickerLookupCard` | 2366–3200 (+ helpers 1585–2352) | tab 2 — mounted `<TickerLookupCard embedded initialReplay />` |
| `app/mult-greek/MultGreekClient.tsx` | 3,301 | tab 3 — mounted `<MultGreekClient initialReplay />` |
| `components/pages/OptionsChain.tsx` | 3,658 | tab 4 — mounted `<OptionsChainPage initialReplay initialReplayScope="0dte" />` |
| `components/shared/PageCard.tsx` | — | `PageShell`, `Card variant="budget"` |
| `components/shared/homeTheme.ts` | — | `HOME_THEME`, `homeShellStyle`, `homeInputStyle`, `LEVEL_COLORS` |
| `lib/calculations/heatSkins.ts` · `heatLevels.ts` | 199 / 124 | the heat ramps and CB/CW/PW definitions tabs 3 and 4 share |

**Total: 187 checklist rows.**

| Part | Covers | Rows | Already in v3? |
|---|---|---|---|
| A | Page frame, tab bar, hash routing, the two mount shapes | 18 | no — build |
| B | Tab 1 "Chain ladder" — `ChainReplay embedded` | 27 | **yes**, as `optionsChain/LadderModal.tsx` (modal only) |
| C | Tab 2 "GEX levels" — `TickerLookupCard embedded initialReplay` | 54 | **yes**, as `analysis/lookup/TickerLookup.tsx` (props already exist) |
| D | Tab 3 "Multi Greek" — `MultGreekClient initialReplay` | 58 | **no** — card exists, page and replay path do not |
| E | Tab 4 "Options chain" — `initialReplay` + `initialReplayScope="0dte"` | 12 | **yes**, minus the two props |
| F | Shared data layer — the recorder endpoints | 8 | partly |
| G | Cross-tab behaviour, persistence, keyboard | 10 | no |

Parts B, C and E are deliberately SHORT: their full row-by-row inventories
already exist and are not duplicated here. They live in
`docs/parity/options-chain.md` (Parts E and O) and `docs/parity/analysis.md`.
This file records only what the `/replay` MOUNT changes about them, and points
at the existing document for the rest. Duplicating 200 rows into a second file
is how two specs drift apart.

---

## Declared departures

Rows v3 will not ship, each a decision rather than a loss. The parity script
must report every one as a `~ soft` line rather than passing over it.

| Row | v2 | Decision |
|---|---|---|
| A/logo, B/brandMark | `/cb-edge-logo.png` stamped into the ladder and the modal header | **Keep.** The ladder travels as a screenshot; the mark is the attribution. Already in v3's `LadderModal`. |
| D/snapshotBtn | `MultiGreekSnapshotBtn` (TABLE/LADDERS + clipboard) | **Soft-drop.** v2's own audit flags it as not replay-aware — it emits today's LIVE walls while rewound. Do not port the bug; leave the button out of the replay tab. |
| D/snapBtn, D/discordBtn | `BoxSnapBtn` (📷 DOM-to-canvas), `BoxDiscordBtn` | **Soft-drop.** v3 ships no DOM-to-canvas renderer (same departure already declared for the chain, `C/snapshot`). |
| D/clickCard | per-cell contract flow popup | Unreachable in replay in v2 (cells are not clickable while rewound). Do not port. |
| D/emBadges, D/deltaStamps | EM and Δ chips | Forced off in replay by v2 itself (`showEm=false`, `deltaWindow=0`). Do not port into the replay page. |
| C/updatedStamp | `updated 3:42:18 PM ET` | v2 hides it while rewound (`!replayOn`). Not a row to build. |
| A/nextTabPrefetch | — | v2 has none. v3 SHOULD add `preload()` on tab hover (non-negotiable 3). New behaviour, flagged not smuggled. |

---

## Open decisions — answer these before Part 2

Five things where transcribing v2 verbatim would carry a defect across. Each
needs a yes/no, not a judgement call during the build.

1. **The Δ double-sign bug (Part C, `Δ 1D` column).** v2 renders `++1.2B` and
   `−+840M`: the cell prepends its own sign and then calls `fmtBig`, which
   prepends one too. The column is suppressed in replay, so it is invisible on
   `/replay` — but the same `TickerLookupCard` renders it live on `/analytics`.
   Fix in the shared component, or transcribe?
2. **"No recorded sweeps for {ticker} this session" is unreachable** (Part D).
   A panel whose ticker has no session, or whose clock is before its first
   sweep, falls through to the LIVE empty string `"Select an expiry and click
   GO"` — which is nonsense in a replay page with no GO button. Fix, or
   transcribe?
3. **CW/PW have no spot filter in v2** (Part D). `computeWalls` picks the top
   `+GEX` and most `−GEX` strikes with no requirement that CW sit above spot or
   PW below. v3's `board/multiGreek/mgMath.ts` has already added
   `strike > spot` / `strike < spot` guards. **These two are not the same page
   today.** Which one is correct?
4. **`MAX_EXP_COLS` is 4 in v2, 3 in v3's `mgMath.ts`.** Same question.
5. **The chain-ladder tab has no symbol coupling** (Part B). `ChainReplay`
   carries its own picker and defaults to MSFT-if-recorded; the other three tabs
   follow their own symbol too. v3 has a board-wide `usePageSymbol` in the
   Shell. Does `/v3/replay` bind its tabs to the board symbol, or keep four
   independent symbols the way v2 does? (v2's answer is four independent; the
   Shell's ticker control will look broken either way unless this is decided.)

---

# Part A — Page frame, tab bar, hash routing

`components/pages/Replay.tsx`. The hub owns nothing but the tab bar and the
choice of mount shape.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| A1 | Route | `app-vite/src/App.tsx:95` `<Route path="/replay">` | `/app/replay`; v3 target `/v3/replay` | — | — |
| A2 | Tab button — `Chain ladder` | `TABS[0].label` | `padding 7px 14px · radius 8 · 11px / 800 · letterSpacing .08em · uppercase · fontFamily inherit` | active: ink `#0b0f1a` on `HT.cyan`, border `HT.cyan`. inactive: ink `HT.text` on `rgba(255,255,255,0.05)`, border `HT.border`. `transition: background .15s, color .15s` | always rendered |
| A3 | Tab button — `GEX levels` | `TABS[1].label` | same | same | always |
| A4 | Tab button — `Multi Greek` | `TABS[2].label` | same | same | always |
| A5 | Tab button — `Options chain` | `TABS[3].label` | same | same | always |
| A6 | Tab tooltip 1 | `TABS[0].blurb` | `title="Per-strike net GEX for one expiry, played through the session. Its own symbol and date pickers."` | — | — |
| A7 | Tab tooltip 2 | `TABS[1].blurb` | `title="The Ticker Lookup's two ladders — one expiry beside the whole board ex-0DTE — with the walls and gamma flip they imply."` | — | — |
| A8 | Tab tooltip 3 | `TABS[2].blurb` | `title="Four tickers rewound off one shared clock."` | — | — |
| A9 | Tab tooltip 4 | `TABS[3].blurb` | `title="The full grid — every strike and column — rewound."` | — | — |
| A10 | Tab bar container | — | `role="tablist"` · `aria-label="Replay surfaces"` · `display flex · gap 8 · flexWrap wrap · alignItems center`; each button `role="tab"` `aria-selected` | — | — |
| A11 | Default tab | `DEFAULT_TAB` | `"chain-ladder"` | — | — |
| A12 | Hash routing — read | `tabFromHash()` | `#tab=<id>` parsed with `new URLSearchParams(location.hash.replace(/^#/,""))`; accepted only if it names a real tab, else `null` | read **after mount in an effect**, never in the state initializer (SSR/CSR agreement). v3 is client-only, but keep the shape — `useState(tabFromHash)` would still break a shared link that arrives before hydration | falls back to `DEFAULT_TAB` |
| A13 | Hash routing — write | `select(id)` | `window.location.hash = \`tab=${id}\`` | assigning the same value is a no-op, so the `hashchange` it fires lands on the state just set | — |
| A14 | Hash routing — back button | `hashchange` listener | re-reads `tabFromHash()`, ignores a hash that names no tab | listener added on mount, removed on unmount | — |
| A15 | Mount shape — FRAMED | `TABS[n].full === false` (tabs 1, 2) | `<PageShell className="replay-root">` → tab bar → `<Card variant="budget" title={active.title} subtitle={active.blurb}>` → the component | — | — |
| A16 | Card title (framed) | `TABS[n].title` | tab 1 `"Option chain replay"`, tab 2 `"GEX levels replay"` — **not the same strings as the tab labels** | — | — |
| A17 | Mount shape — FULL | `TABS[n].full === true` (tabs 3, 4) | root `<div className="replay-root" style={{...homeShellStyle, display flex, flexDirection column, minHeight 0, height "100%"}}>`; tab bar in a `padding "12px clamp(14px, 2vw, 24px) 0" · flexShrink 0` strip; pane `flex 1 · minHeight 0 · display flex · flexDirection column` | The embedded page renders its OWN shell. `minHeight: 0` on BOTH the column and the pane is what lets its internal scroller size itself instead of pushing the tab bar off the top. Wrapping a FULL tab in `PageShell` double-pads and nests a scroller in a scroller | — |
| A18 | Suspense fallback | `fallback` const | `"LOADING REPLAY…"` · `padding 40 · textAlign center · color rgba(255,255,255,0.55) · fontSize 13 · letterSpacing .08em` | — | shown while a lazy tab's chunk loads |

**Code splitting.** Everything except `ChainReplay` is `lazy()`. Mounting
`/replay` must not pull Multi Greek's and Options Chain's chunks down before a
tab is picked. In v3 this maps onto per-tab `lazy()` inside the page, not a
single route chunk — and it is what keeps `/v3/replay` under the `route` budget
(80 000 B brotli) even though tab 4 alone is the whole Options Chain page.

**Every tab opens ALREADY REWOUND.** This is the reason the page exists: making
the user press the embedded page's own replay toggle first is asking them to
confirm the thing they navigated to. It is INITIAL STATE only — each tab's own
toggle still works normally, and a user can exit replay inside a tab.

**Tab 4 additionally opens scoped to 0DTE** (`initialReplayScope="0dte"`). The
tab is for watching the front contract move; "all expiries" is one click away on
the bar's own scope control.

---

# Part B — Tab 1 "Chain ladder" (`ChainReplay embedded`)

`components/shared/ChainReplay.tsx`, mounted with **no `symbol` prop and no
`onClose`** → inline body, no portal, no overlay, no modal card, no header, no
close button.

**The full row-by-row inventory of this component already exists** as
`docs/parity/options-chain.md` **Part O** (22 rows) — it is the same component,
mounted there as the "⛶ Ladder" modal. Do not re-transcribe it; tick Part O.

This part records only what the `embedded` mount changes.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| B1 | Root | `embedded \|\| !onClose` | `return <div>{body}</div>` — a bare div | **Not** the `createPortal` overlay. Rows O/overlay, O/modalCard, O/heading, O/subHeading, O/headerLogo, O/close are all ABSENT in this mount | — |
| B2 | Heading | — | supplied by the HUB's `<Card title="Option chain replay" subtitle="Per-strike net GEX for one expiry, played through the session. Its own symbol and date pickers.">` | the modal's own `"Option Chain Replay"` / `"Play back the recorded per-strike net-GEX profile through the session."` are **not** rendered here | — |
| B3 | Escape key | `useEffect([onClose])` | `if (!onClose) return` — **no Escape handler in embedded mode** | — | — |
| B4 | Default symbol | `/proxy/strike-growth/replay-meta` → `j.symbols` | `setSymbol(cur => cur \|\| (syms.includes("MSFT") ? "MSFT" : syms[0] \|\| ""))` | with no `symbol` prop, `cur` is `""` → **MSFT if recorded, else the first recorded symbol**. Deliberate: a hardcoded default in the hub would be a second place to be wrong | `"—"` in the readout |
| B5 | Symbol readout | `symbol` | `13px / 800 · letterSpacing .06em · var(--font-mono) · minWidth 46` | `HT.cyan` | `"—"` |
| B6 | Symbol picker | `TickerListDropdown`, `universe={symbols}` | — | universe is the RECORDER's symbol list, not the scanner universe | — |
| B7 | Date `<select>` | `replay-meta?symbol=` → `j.dates` | `homeInputStyle` + `padding 6px 10px · cursor pointer` | resets to `ds[0]` on **every** symbol change | — |
| B8 | Play / Pause | — | `"▶ Play"` / `"❚❚ Pause"` · `homeInputStyle` + `padding 6px 16px · minWidth 74 · fontWeight 600` | playing → bg `rgba(239,68,68,0.15)`, border `NEG #EF4444`; idle → bg `rgba(125,211,252,0.15)`, border `LIGHT_BLUE #7dd3fc`. Ink `HT.text` both ways | `disabled` when `!frames.length`; pressing at the last frame rewinds to 0 first |
| B9 | Speed tiles | `SPEEDS = [0.5, 1, 2, 4, 8]` | `` `${sp}×` `` · `homeInputStyle` + `padding 4px 8px · 12px` | active → border + ink `LIGHT_BLUE`; inactive → border `HT.border`, ink `SUB rgba(255,255,255,0.55)`. Interval `BASE_MS (700) / speed` → 1400 / 700 / 350 / 175 / 87.5 ms | — |
| B10 | Scale tiles | `scaleMode` | `"frame"` and `"day"`, `textTransform capitalize` | `frame` → `denom = frameMax` (rescale each snapshot to its own peak — bars always readable); `day` → `denom = maxAbs` (fixed session-wide scale — magnitudes comparable across time). **Default `"frame"`.** Tooltips state exactly that, verbatim | `denom = (…) \|\| 1` |
| B11 | Scrubber | — | `type=range · min 0 · max frames.length−1 · flex 1`, `accentColor LIGHT_BLUE` | dragging sets `playing = false` | `disabled` with no frames |
| B12 | Clock + spot | `frame.ts`, tweened `spot` | `**HH:MM** ET` then `· spot NNNN.NN` · `14px · tabular-nums · minWidth 150 · textAlign right`. `fmtClock` is **minutes only** (no seconds) — unlike the in-grid bar | clock `HT.text` (`<strong>`), the `· spot …` run `SUB` | `"—"` |
| B13 | Frame counter | — | `` `Frame ${idx + 1} / ${frames.length}` `` · `12px` · `marginBottom 14` | `SUB` | `""` |
| B14 | Ladder — strike | `allStrikes` = union across ALL frames, **descending** | `width 56 · textAlign right · 12px · tabular-nums` | `HT.text` | — |
| B15 | Ladder — bar | `netByStrike.get(k) ?? 0` | diverging: negative fills right-to-left on the LEFT half (`justifyContent flex-end`, radius `3px 0 0 3px`); positive left-to-right on the RIGHT half (radius `0 3px 3px 0`). `pct = min(100, \|net\|/denom × 100)`, bar `height 12`, row `height 16`, `opacity 0.9`. 1px centre rail `height 16` in `HT.border`. Row gap 3, column gap 8 | positive `POS = HT.green #8ECAE6` (a light blue); negative `NEG = HT.red #EF4444` | a strike absent from this frame → `net = 0` → zero-width bar |
| B16 | Ladder — value | `fmtGex(net)` | `≥1e9` → `2dp` + `B`; `≥1e6` → `1dp` + `M`; `≥1e3` → `0dp` + `K`; else `0dp`. Signed by the raw value, **no `$`, no forced `+`**. `width 68 · textAlign left · 11px · tabular-nums` | ink `POS` / `NEG` by `net >= 0` | `"0"` |
| B17 | Spot line | derived during render | dashed `1px HT.text`, `left 64 · right 0`, `height 0`, `pointerEvents none`, `zIndex 1`, **no CSS transition** | position = continuous row index interpolated between bracketing strikes, × a measured pitch `(lastMid − top0)/(n−1)` from a `ResizeObserver`. Off either end it parks ONE ROW PAST the edge (`pos = -1` or `n`) rather than clamping | hidden when `spot <= 0` or geometry unmeasured |
| B18 | Spot label | — | `` `spot ${spot.toFixed(2)}` `` · `right 0 · top -8 · 10px · padding "0 4px"` | ink `HT.text` on `HT.panel` | — |
| B19 | Spot tween | `animSpot` ref | eases toward the frame's spot over `min(BASE_MS/speed, 450)` ms, ease-out `1 − (1−t)²`, driven by `requestAnimationFrame` | **only while playing** — scrubbing snaps instantly (a tween per intermediate frame stacks and overshoots). The cleanup lands `animSpot.current` exactly on the target so error cannot compound | — |
| B20 | Provenance stamp — position | — | `position absolute · left 64 · top 0 · zIndex 3 · pointerEvents none · padding "6px 10px" · radius 8 · gap 3`, bg `rgba(5,6,10,0.62)` + `backdropFilter blur(6px)`, border `1px HT.border` | must never intercept a scrub or click | — |
| B21 | Stamp — ticker | `symbol` | `15px / 800 · letterSpacing .08em · var(--font-mono) · lineHeight 1` | `HT.cyan` | `"—"` |
| B22 | Stamp — expiry chip | `frame.expiry \|\| expiries[0]` | `"0DTE"` when `frameExpiry === date`, else `` `EXP ${fmtExpiry(exp)}` `` (`"Jul 31"` → `Aug 8`). `10px / 700 · letterSpacing .06em · padding "3px 6px" · radius 4` | 0DTE: ink `HT.orange`, bg `rgba(251,133,1,0.10)`, border `rgba(251,133,1,0.45)`. else: ink `LIGHT_BLUE`, bg `rgba(125,211,252,0.10)`, border `rgba(125,211,252,0.35)` | chip omitted when no expiry |
| B23 | Stamp — `+N` chip | `(frame.expiryCount ?? expiries.length) − 1` | `` `+${n}` `` · `10px / 700` · `title="Net summed across N expiries"` | `SUB` | hidden when `n <= 0` |
| B24 | Stamp — date + clock | `date`, `frame.ts` | `` `${fmtStampDate(date)} · ${fmtStampClock(ts)} ET` `` → `Fri Jul 31 · 10:42:07 ET`. **Seconds here**, unlike the transport clock. `11px · tabular-nums · lineHeight 1.2` | `SUB` | date half omitted when `!date` |
| B25 | Brand mark | `/cb-edge-logo.png` | `height 30 · width auto`, bottom-right OF THE LADDER, `opacity .92`, `filter drop-shadow(0 2px 6px rgba(0,0,0,0.8))`, `pointerEvents none` | inside the ladder so it survives a crop of just the chart | — |
| B26 | Loading / error / empty | — | `"Loading…"` (`padding 40 · center · SUB`) · error text (`padding 24 · center · NEG`) · `` `No recorded frames for ${symbol} on ${date \|\| "this date"}.` `` (`padding 40 · center · SUB`) | — | three fetch failures: `"Could not load recorded symbols."` · `"Could not load recorded dates."` · `"Could not load frames."` (or `j.error`, or `"No data."`) |
| B27 | Stop at end | `useEffect([playing, idx, frames.length])` | `if (playing && frames.length > 0 && idx >= frames.length - 1) setPlaying(false)` | Deliberately **outside** the `setIdx` updater — updaters must be pure, and StrictMode invokes them twice, which double-fires the pause | no looping |

**v3 status.** `cbedge-v3/src/pages/optionsChain/LadderModal.tsx` is a complete
port of this component, modal shape only. The delta is: an `embedded` prop that
returns the bare body, and skipping the Escape handler when there is no
`onClose`. It uses `query()` from `data/api.ts`, so it already satisfies
non-negotiable 3.

---

# Part C — Tab 2 "GEX levels" (`TickerLookupCard embedded initialReplay`)

`components/pages/Analytics.tsx`, `TickerLookupCard`. Two ladders side by side —
one expiry on the left, the whole board ex-0DTE on the right — with the walls
and gamma flip they imply.

**The full row-by-row inventory already exists** as `docs/parity/analysis.md`
(419 rows, the Ticker Lookup section). Do not re-transcribe it; tick those rows.

This part records what the two props change, and the replay-specific rows,
because those are the ones a hub port gets wrong.

### C.1 — What the props do

| # | Prop | Effect | Note |
|---|---|---|---|
| C1 | `embedded` | **exactly one thing**: the root `<Card>`'s `style.gridColumn` becomes `undefined` instead of `"1 / -1"` | nothing else in the component reads it |
| C2 | `initialReplay` | **exactly one thing**: `useState(initialReplay)` for `replayOn` | initial state only; the ⏱ Replay toggle still works |
| C3 | `initialSymbol` | not passed by the hub → defaults `"SPX"`, seeded once via a lazy initializer, uncontrolled thereafter | — |

### C.2 — Replay transport bar (rendered only when `replayOn`)

Container: `flex · alignItems center · gap 8 · flexWrap wrap · padding "6px 10px" · radius 10`, bg `rgba(251,133,1,0.07)`, border `1px ${HT.orange}55`, `11px`, ink `HT.text`.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| C4 | `Replay` | static | `fontWeight 900 · letterSpacing .1em · uppercase · flexShrink 0` | `HT.orange` | always |
| C5 | Date `<select>` | `/proxy/strike-growth/replay-meta?symbol=` → `j.dates` (`String(d).slice(0,10)`) | `padding "3px 6px" · 11px / 800 · var(--font-mono) · radius 6`, bg `rgba(13,17,25,0.72)`, border `1px HT.border` | ink `HT.cyan`. `onChange` pauses first | `disabled` and a single `<option value="">—</option>` when the list is empty |
| C6 | `◀` prev | — | `tlReplayBtn(false)` = `height 24 · padding "0 8px" · radius 6 · 11px / 800 · lineHeight 1` | `disabled` at `replayIdx <= 0`; `opacity 1 / 0.4`. `title="Previous minute"` | pauses first |
| C7 | `▶` / `❚❚` | — | glyph swap; `padding "0 12px"` | `disabled` when `replayTimeline.length < 2`; `opacity 1 / 0.4`. `title="Play / pause"`. Active fill: ink `#0b0f1a` on `HT.orange`; idle: ink `HT.text` on `rgba(255,255,255,0.05)` | at the last frame, pressing ▶ sets idx 0 first |
| C8 | `▶` next | — | as C6 | `disabled` at the last step. `title="Next minute"` | pauses first |
| C9 | Scrubber | `replayIdx` | `min 0 · max timeline.length−1 · flex 1 · minWidth 180 · height 3` | `accentColor HT.orange`; `disabled` at `< 2` steps | dragging pauses |
| C10 | `Speed` caption | static | `10px / 700 · opacity .6` | — | — |
| C11 | Speed tiles | `TL_REPLAY_SPEEDS = [0.5, 1, 2, 4, 8]` | `` `${sp}×` `` · `height 22 · padding "0 7px" · 10px` | active fill as C7. Default `1` | never disabled |
| C12 | Separator | static | `"\|"` | ink `HT.border` | — |
| C13 | Clock | `replayClock` | `` `${fmtTlReplayClock(ms)} ET` `` → `10:42 ET`. **`HH:MM` 24-hour, no seconds.** `var(--font-mono) · fontWeight 900` | `HT.text` | `"--:--"` |
| C14 | Frame counter | — | `` `${min(idx, n−1)+1} / ${n}` `` — 1-indexed, space-slash-space | `opacity .55` | `""` |
| C15 | Loading chip | `replayLoading` | `"loading…"` lowercase | `HT.cyan`, 700 | — |
| C16 | Error chip | `replayErr` | verbatim | `HT.red`, 700 | — |
| C17 | Caveat line | derived | `· recorded walls only · sweeps held to the minute · ± Move, ATM IV and Δ 1D off while rewound` | `opacity .55` | rendered only when `!loading && !err && timeline.length > 0` |

### C.3 — The shared-clock mechanics (transcribe exactly)

| # | Concern | Detail |
|---|---|---|
| C18 | Timeline | `tlMinute(ms) = Math.floor(ms / 60_000) * 60_000`; `tlTimelineOf(frames) = [...new Set(frames.map(f => tlMinute(f.t)))].sort(asc)`. **One step per minute that carried a sweep** — not per frame, and not a dense minute axis |
| C19 | Frame pick | STEP-HOLD: `cutoff = replayClock + 59_999`; walk ascending frames, keep the last with `f.t <= cutoff`, `break` otherwise. Never a reading from the future |
| C20 | Landing frame | `setReplayIdx(max(0, timeline.length - 1))` — **the LAST sweep**, not the first |
| C21 | Tick | `setInterval(…, TL_REPLAY_BASE_MS (700) / speed)`; the updater pauses at the end and returns `i`. Deps `[playing, speed, timeline.length]`. No looping |
| C22 | Axis stability | Axes are memoised on the **session**, not the frame (`tlSessionAxis`), so the ladder does not gain or lose rungs as you scrub |
| C23 | Reset | `useEffect([replayOn, sym])` clears session, idx, playing, err. The frames effect clears them again before fetching |

### C.4 — The single swap point (lines 2709–2789)

Everything replay changes about the two ladders happens here, in eight lines.
Transcribe the whole block rather than re-deriving it per consumer.

| # | View value | Live | Rewound |
|---|---|---|---|
| C24 | `viewSpot` | `numOr(chain.underlyingPrice)` | `frame.spot > 0 ? frame.spot : null` |
| C25 | `viewLeftRows` | `leftRows` | `replayLeft?.rows ?? []` |
| C26 | `viewRightRows` | `rightRows` | `replayRight?.rows ?? []` |
| C27 | `viewExpiries` | `expiries` (from `/api/chains`) | `replaySession.expiries` |
| C28 | `viewActiveExpiry` | `activeExpiry` | the picked expiry if the session recorded it, else `session.expiries[0] ?? null` |
| C29 | `atm` | `tlAtm(atmGroup, spot)` | **hard `{ move: null, iv: null }`** → the `± Move — · ATM IV —` caption |
| C30 | Right-pane scope | `boardExpiries` (whole board) | `session.expiries.filter(e => e !== replayZeroDte)` where `replayZeroDte = session.expiries.includes(replayDate) ? replayDate : session.expiries[0] ?? ""` |
| C31 | Board sweep | `loadBoard()` + a 120 000 ms interval | **`if (replayOn) return;`** — the sweep is entirely paused while rewound |
| C32 | `Δ 1D` column | `rightChanges` | `null` — the whole column and its caption disappear |
| C33 | `UpdatedStamp` | rendered | not rendered |
| C34 | `/api/chains`, `/api/expirations`, `/api/eod-strike-gex-change` | polling | **still polling** — replay is a render swap, not a teardown |

### C.5 — Replay-only rendered values

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty state |
|---|---|---|---|---|---|
| C35 | Context string | derived | `` [sym, tlExpiryChip(viewActiveExpiry, replayDate), replayDate, `${clock} ET`].filter(Boolean).join(" · ") `` → `SPX · AUG 8 · 3DTE · 2025-08-05 · 10:42 ET` | `11px · mono · 700 · letterSpacing .06em · uppercase · opacity .78` | the live form drops the clock and uses `today` |
| C36 | Expiry pill DTE base | `replayOn && replayDate ? replayDate : today` | `tlExpiryChip` → `"Aug 8 · 0DTE"` / `"Aug 8 · 3DTE"` / bare `"Aug 8"` for a past expiry | DTE counts from the **replayed session date**, not today | — |
| C37 | Right-pane coverage caption | `replayBoardUsed = replayRight?.used.length ?? 0` | `` `${n} expiration${n===1?"":"s"} · excl. 0DTE (${replayZeroDte}) · recorded walls only` `` | ink `HT.text` at `opacity .6` in replay (the live fallback variants go **orange** at `.85`) | `` `no expirations past 0DTE in this sweep · ${n} recorded this session` `` when `used === 0` but the session has some; `no recorded expirations past 0DTE this session` when it has none |
| C38 | Coverage moves as you scrub | — | `used` counts expiries that contributed a cell to **the frame on screen** | deliberate | — |
| C39 | Ladder cell — unrecorded | `replayLeft/Right.missing` | value `"—"`, **no bar at all**, `opacity .5`, ink `HT.muted` | `title="not recorded in this sweep — the recorder stores the walls, not every strike"` | a strike present but summing to zero is **not** missing — it gets a row, a 2%-floor bar and the value `+0` |
| C40 | Gate empty (replay) | — | `` `No recorded ladder for ${sym}${replayDate ? ` on ${replayDate}` : ""}.` `` | when the gate fires, identity line, both panes, "The read" and the disclaimer all vanish; the toolbar, quick row and replay bar remain | live form: `` `No live option chain for ${sym}.` `` |
| C41 | Left ladder empty | — | `"Nothing recorded on this expiry in this session."` | | live: `"No populated strikes on this expiry."` |
| C42 | Right ladder empty | — | `"Nothing recorded past 0DTE in this session."` | | live: `"No board-wide ladder yet (nothing listed past 0DTE)."` |
| C43 | `replayErr` — no sessions | — | `` `No recorded sessions for ${sym}.` `` | `HT.red` | — |
| C44 | `replayErr` — meta threw | — | `"Could not load recorded sessions."` | | — |
| C45 | `replayErr` — no frames | — | `` `No recorded frames for ${sym} on ${replayDate}.` `` (or `String(j.error)`) | | — |
| C46 | `replayErr` — frames threw | — | `"Could not load frames."` | | — |
| C47 | Footer disclaimer (replay) | — | `` `OI+Vol basis · recorded strike_growth sweeps${replayDate ? ` for ${replayDate}` : ""} · walls only, not the whole ladder · educational only, not investment advice` `` | `11px · mono · opacity .45` | live form is a different sentence — see analysis.md |
| C48 | ⏱ Replay toggle | — | `"⏱ Replay"`, `title="Replay — scrub both ladders back through a recorded session (recorded walls only, ~5 trading days)"` | ON: ink `#0b0f1a` on `HT.orange`, border `HT.orange`, 800. OFF: `homeSecondaryButtonStyle` with ink `HT.orange`, 800 | on by default in this mount |

### C.6 — Replay row math (transcribe verbatim)

| # | Function | Detail |
|---|---|---|
| C49 | `tlReplayRows(frame, sessionStrikes, expiries, basis = "net")` | for each session strike, sum `frame.cells.get(\`${e}\|${strike}\`)` over the given expiries; `seen` gates `missing`; `used` = expiries that contributed. Rows sorted ascending, **zeros NOT dropped** (unlike the live path, which drops `gex === 0`) |
| C50 | `tlSessionAxis(frames, expiries)` | union of every strike across every frame under those expiries, ascending. Key parse by `indexOf("\|")`, `Number.isFinite` guard |
| C51 | `basis: "vol"` | parsed from every cell and **never used** — no call site passes it. Either drop it or expose it as the scale toggle this pane does not have |
| C52 | `tlLevelsFrom(rows, spot)` | `callWall` = highest `+GEX`, `putWall` = most `−GEX`, `core` = highest `\|GEX\|`; strict `>` / `<` so the FIRST (lowest, ascending) wins a tie. **CB collision rule:** if core and a wall share a strike, that wall steps down to the second-best strike on its own side (may be `null` → chip shows `—`) |
| C53 | Gamma flip | cumulative GEX ascending; the **first negative→positive crossing only**; `flip = prevK + (r.strike − prevK) × (−prevCum / (cum − prevCum))`. No spot → **no flip** (`null`). A replay frame with `spot <= 0` therefore kills the flip |
| C54 | Levels are computed on the FULL ladder | not the drawn window — so a wall 200 points out still wins, and its `CB`/`CW`/`PW` tag can be scrolled off (or outside the ±20 window) while the chip still shows the number |
| C55 | Drawn window | `TL_LADDER_SIDE = 20` → 41 rungs, sliced **by index** around the anchor, then reversed to descending |
| C56 | Anchor hysteresis | `TL_ANCHOR_SLACK = 5` — the anchor re-quantises only after spot walks 5 strike INDICES. Reset key includes `replayOn ? "r" : "l"`, so entering replay re-anchors. The ref is settled DURING RENDER on purpose |
| C57 | `fmtBig` | `sign = n >= 0 ? "+" : "-"` (ASCII); `≥1e9` → `1dp B`, `≥1e6` → `0dp M`, `≥1e3` → `0dp K`, else `0dp`. Sign **always present, including for zero** (`+0`). No thousands separators. `—` for null/non-finite |

**v3 status.** `cbedge-v3/src/pages/analysis/lookup/TickerLookup.tsx` already
takes `{ initialSymbol, embedded, initialReplay }` and already holds
`replayOn`; `analysis/lookup/replay.ts` already exports `TL_REPLAY_SPEEDS`,
`TL_REPLAY_BASE_MS`, `tlMinute`, `fmtTlReplayClock`, `tlReplayRows`,
`tlTimelineOf`, `tlSessionAxis`, `parseReplayFrames`. **This tab is a two-line
mount.** Verify against `docs/parity/analysis.md` rather than rebuilding.

---

# Part D — Tab 3 "Multi Greek" (`MultGreekClient initialReplay`)

Four tickers rewound off ONE shared clock. This is the tab with no v3
equivalent: `src/board/multiGreek/MultiGreekCard.tsx` is a board CARD with no
replay path, and its `mgMath.ts` has already diverged from v2 in four ways
(open decisions 3 and 4, plus `fmtGex` and `cellAlpha` — see D58).

### D.1 — Frame and shell

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| D1 | `initialReplay` | — | **exactly one thing**: `useState(initialReplay)` for `replayOn` | initial state only | — |
| D2 | Root | — | `homeShellStyle` + `display flex · height 100% · width 100% · overflow hidden` | **no `PageShell`, no title, no nav** — the hub's FULL mount shape exists for this | — |
| D3 | Panels row | — | `className="mg-panels"` · `display flex · gap 8 · padding 8 · position relative · overflow hidden · minHeight 0` | — | — |
| D4 | Status dot | `status.state` | 8×8 circle | `{live: HT.green, loading: HT.orange, err: HT.red, idle: HT.red}` | — |
| D5 | Status text | `status.msg` | `10px / 800 · letterSpacing .1em` | same ink as the dot | `READY` · `LOADING...` · `LIVE` · `CLOSED` · `` `PARTIAL (n/N)` `` · `` `PROXY ERR {code}` `` |
| D6 | Line-up | `TICKERS.join(" · ")` | `11px / 800 · letterSpacing .08em · var(--font-mono)`, truncates | `HT.text` | — |
| D7 | Context string | derived | `` `${basisLabel}${colCount!==3\|\|!showAll ? ` · ${colCount} EXP${showAll?"+ALL":""}` : ""}${deltaWindow ? ` · Δ${deltaWindow}M` : ""} · REPLAY` `` | `10px / 800 · letterSpacing .1em · opacity .75`. `basisLabel` ∈ `OI+VOL` / `VOL` / `OI` | **Quirk:** the `· Δ{n}M` badge shows in replay even though panels receive `deltaWindow={0}` — the bar reports the setting, the panels ignore it |
| D8 | Refresh button | `useRefreshButton` | `↻ Now` / `↻ Refreshing…` / `✓ Refreshed` / `✗ Failed`, reverts after 1800 ms | — | `!isStatic` only |
| D9 | Cog menu | `DockCogMenu` | `title="Multi Greek"` · `buttonTitle="Multi Greek settings"` · `width 340` · `paneHeight 196` | four sections: Expiry / Board / Heat / Tools | — |

### D.2 — Cog sections (all four still work while rewound)

| # | Section | Control | Values | Effect in replay |
|---|---|---|---|---|
| D10 | Expiry | `DockExpiryPicker` + `GO` | `frontLabel="— Expiry —"`, `includeFront` | **none** — drives the live chain only |
| D11 | Board | `Columns` | `SegGroup 1 \| 2 \| 3` + `ToggleTile ALL` | **applies.** Hint `"Expiry columns per panel, plus the ex-0DTE total"`; ALL `title="Total NET GEX per strike across every expiration except 0DTE"` |
| D12 | Board | `Basis` | `SegGroup OI+VOL \| VOL \| OI` | **applies**, but `"oi"` silently falls back to `net` and the caveat line says so |
| D13 | Board | `Δ stamps` | `SegGroup Δ OFF \| 5M \| 15M \| 30M` | **none** — `deltaWindow` forced to 0 |
| D14 | Heat | `Intensity` | `DockSlider min .5 · max intensityMax · step .01 · valueWidth 52`; format `v <= 0.5 ? "LEVELS" : \`${v.toFixed(2)}x\`` | **applies.** `title="Heat intensity. At the minimum stop the gamma wash switches off and only CB / CW / PW stay marked."` |
| D15 | Heat | `Skin` | `SegGroup CLASSIC \| VIVID` | **applies** |
| D16 | Heat | `Levels` | three buttons `CB` / `CW` / `PW`, `fontWeight 900` | **applies.** ON: bg + border `LEVEL_COLORS[k]`, ink `LEVEL_COLORS.onSolid #04121a`. OFF: ink `LEVEL_COLORS[k]`, `opacity .5`. Titles `"CB — Core Bullseye, highest \|GEX\| level"` / `"CW — Call Wall, highest +GEX level"` / `"PW — Put Wall, most −GEX level"`, each suffixed `` ` — click to ${on ? "hide" : "show"}` `` |
| D17 | Tools | `🔍 Lookup` | opens the Ticker Lookup overlay on `"SPX"` | reachable. `title="Ticker Lookup — enter any ticker for its GEX ladder, walls and gamma regime"`. **Note this is the SAME component as tab 2** — decide whether the replay page keeps a modal route to it |
| D18 | Tools | `⏱ REPLAY` | toggles `replayOn` | ON here by default. `title="Replay — scrub all four panels back through a recorded session (recorded walls only, ~5 trading days)"`. ON: ink `#0b0f1a` on `HT.orange`, border `HT.orange`, 900. OFF: ink `HT.orange`, 900 |

### D.3 — Replay transport bar

Rendered when `replayOn && !isStatic`. Container `flexShrink 0 · flex · alignItems center · gap 8 · flexWrap wrap · margin "0 10px 2px" · padding "5px 10px" · radius 10`, bg `rgba(251,133,1,0.07)`, border `1px ${HT.orange}55`, `11px`, ink `HT.text`.

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| D19 | `Replay` | static | `900 · letterSpacing .1em · uppercase · flexShrink 0` | `HT.orange` | always |
| D20 | Date `<select>` | union of four `replay-meta` calls | raw `YYYY-MM-DD`, **newest first** (`.sort().reverse()`). `padding "3px 6px" · 11px / 800 · mono · radius 6`, bg `HT.panelBgStrong`, border `1px HT.border` | ink `HT.cyan` | `disabled` + single `<option value="">—</option>` when empty. `onChange` pauses first |
| D21 | `◀` prev | — | `mgTransportBtn(false)` = `height 24 · padding "0 8px" · radius 6 · 11px / 800 · lineHeight 1` | `disabled` at `idx <= 0`; `opacity 1 / 0.4`. `title="Previous minute"` | pauses first |
| D22 | `▶` / `❚❚` | — | `padding "0 12px"` | `disabled` when `timeline.length < 2`. `title="Play / pause (Space)"`. Active: ink `#0b0f1a` on `HT.orange`; idle: ink `HT.text` on `rgba(255,255,255,0.05)` | at the last step, pressing ▶ sets idx 0 first |
| D23 | `▶` next | — | as D21 | `disabled` at the last step. `title="Next minute"` | pauses first |
| D24 | Scrubber | `replayIdx` | `min 0 · max timeline.length−1 · flex 1 · minWidth 180 · height 3` | `accentColor HT.orange`; `disabled` at `< 2` | dragging pauses. Range is **indices into the shared minute timeline**, not timestamps |
| D25 | `Speed` caption | static | `10px / 700 · opacity .7` | `HT.muted` | — |
| D26 | Speed tiles | `MG_REPLAY_SPEEDS = [0.5, 1, 2, 4, 8]` | `` `${sp}×` `` (U+00D7) · `height 22 · padding "0 7px" · 10px` | active fill as D22. Default `1`, **not persisted** | — |
| D27 | Separator | static | `"\|"` | `HT.border` | — |
| D28 | Clock | `replayClock` | `` `${fmtReplayClock(ms)} ET` `` → `09:35 ET`. **`HH:MM` 24-hour, no seconds.** `mono · 900` | `HT.text` | `"--:--"` |
| D29 | Frame counter | — | `` `${min(idx, n−1)+1} / ${n}` `` | `HT.muted · opacity .6` | `""` |
| D30 | Loading chip | `replayLoading` | `"loading…"` | `HT.cyan`, 700 | — |
| D31 | Error chip | `replayErr` | verbatim | `HT.red`, 700 | — |
| D32 | Caveat line | derived, concatenated in this order | `"· recorded walls only · sweeps held to the minute"` + (basis `oi` only) `" · OI basis not recorded — showing OI+VOL"` + `" · Δ and EM off while rewound"` + (any ticker with no session) `` ` · no history: ${missing.join(", ")}` `` | `HT.muted · opacity .6` | hidden while loading or erroring, or with an empty timeline |
| D33 | Keyboard | `Space` | toggles play/pause while `replayOn`, `preventDefault()` | ignored when the target is `INPUT` / `TEXTAREA` / `isContentEditable` — and each panel's ticker box also calls `stopPropagation()` on keydown | — |

### D.4 — Shared clock (four sessions, one timeline)

| # | Concern | Detail |
|---|---|---|
| D34 | Bucket | `minuteBucket(ms) = Math.floor(ms / 60_000) * 60_000` |
| D35 | Timeline | every distinct minute bucket across **ALL loaded sessions**, ascending. A ticker with no session simply contributes no steps — it does not shorten the others |
| D36 | Frame pick | STEP-HOLD per ticker: `cutoff = replayClock + 59_999`, last frame `<= cutoff`, `break`. Never a future reading |
| D37 | Landing | `useEffect(() => setReplayIdx(max(0, timeline.length - 1)), [timeline])` — the LAST step |
| D38 | Tick | `MG_REPLAY_BASE_MS = 700` / speed → 1400 / 700 / 350 / 175 / 87.5 ms. Stops at the end, no loop. Deps `[playing, speed, timeline.length]` |
| D39 | Reset | `useEffect([replayOn, TICKERS])` clears sessions, idx, playing, err — so changing ANY panel's ticker re-fetches all four. `replayDate` and `replaySpeed` survive |
| D40 | No scale toggle | Multi Greek has **no** `frame`/`day` switch (the chain ladder does). Heat is always scaled to the current frame's per-column `maxAbs` |

### D.5 — Panels

| # | Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|---|
| D41 | Ticker (editable) | `slotInputs[ti] ?? ticker` | `<input maxLength 6 · uppercase-on-change · spellCheck false · autoCapitalize characters · placeholder "TICKER"`, `width 92 · padding "1px 6px" · radius 7`, bg `rgba(0,0,0,0.22)`, border `1px HT.border`. `title="This panel's ticker — type a symbol and press Enter"` | `HT.cyan`, `17px / 800 · letterSpacing .1em`. Enter commits + blurs; Escape resets + blurs; blur commits; focus selects | `editableTicker = !isStatic && !tickerOverrideKey` → **true on `/replay`** |
| D42 | Ticker commit rule | `commitSlot(i)` | `want = typed \|\| DEFAULT_TICKERS[i]` — empty RESTORES the default, never removes a panel. Refused if another slot holds `want`. Persists `JSON.stringify(next)` to `mg_tickers` | — | — |
| D43 | Spot | `replayFrameByTicker[t]?.spot` | `spot.toFixed(2)` · `17px / 700 · mono` | `HT.cyan` | `spot === 0` → `"--"` in `HT.text` at `opacity .5` |
| D44 | Header bar | — | `padding "6px 10px"`, bg `rgba(33,158,188,0.04)`, `borderBottom 1px HT.border`, `userSelect none`, `justifyContent space-between` | — | — |
| D45 | `STRIKE` header | static | uppercase · `letterSpacing .06em` · `11px / 800` · `padding "5px 4px"` · centred | `HT.muted` | — |
| D46 | Column DTE line | `colLabel(date, replayDate).dte` | `` `${dt}DTE` `` where `dt = round((Date(date+"T12:00:00Z") − Date(replayDate+"T12:00:00Z")) / 86400000)` | `HT.cyan` · `10px / 800 · letterSpacing .04em` | DTE counts from the **replayed session date** |
| D47 | Column sub line | `date.slice(5)` | `` `GEX · ${MM-DD}` `` | `HT.muted` · `8px / 700`, truncates | — |
| D48 | `ALL` column header | static | DTE line `ALL`, sub line `EX-0DTE` | replay tooltip `` `Total NET GEX per strike across ${ex0InProfile} expiration${s}, excluding 0DTE` `` where `ex0InProfile` counts the ex-0DTE dates present in **this sweep** — so it moves as you scrub while the column set stays fixed. Deliberate | live tooltip is the static wording |
| D49 | Grid track | — | `` `76px ${cols.map(()=>"1fr").join(" ")}` ``, `columnGap = SK.cell.gap`, bg `HT.panelBgStrong`, `borderBottom 1px HT.border` | — | — |
| D50 | `TOTAL` row — label | static | uppercase · `letterSpacing .06em` · `11px / 800` · centred | `HT.muted`. Row bg `rgba(33,158,188,0.02)`, `borderBottom 1px HT.border`. Every cell `title="Column NET GEX total · % of gross GEX that is positive"` | — |
| D51 | `TOTAL` row — net | `totals[col].net = pos − neg` | `fmtCell(v, SK)`, sign + figure as ONE run | `v > 0` → `#29b6f6` · `v < 0` → `#ff4757` · `v === 0` → `#94a3b8` | `"--"` when the column total is null |
| D52 | `TOTAL` row — positive share | `totals[col].posPct` | `` `${Math.round(posPct)}%` `` · `marginLeft 3 · 9px / 800 · opacity .9` | `>= 50` → `#22c55e`, else `#ef4444` | span omitted when null |
| D53 | Strike rail | `r.strike` | `Number.isInteger(s) ? s : s.toFixed(2)` · `11px / 800 · mono · centred · nowrap`, `borderRight 1px rgba(255,255,255,.06)` | ink `#94a3b8` | — |
| D54 | ATM chip | `r.isATM && SK.atm ∈ {chip, both}` | `"ATM"`, `title="At the money"`, `height 11 · padding "0 4px" · 8px / 900 · letterSpacing .04em · radius 3`, ink `#04121a` on `#ffffff` | skin-dependent | — |
| D55 | ATM ring | `r.isATM` | `boxShadow: inset 0 2px 0 #fff, inset 0 -2px 0 #fff, inset 2px 0 0 #fff, inset -2px 0 0 #fff` on the whole row | **universal, not skin-gated** | — |
| D56 | GEX cell — value | `r.gex[e]` | `val == null` **or** `val === 0` → `"--"`; else `fmtCell` → `≥1e9` `1dp B` · `≥1e6` `1dp M` · `≥1e3` `0dp K` · else `0dp`. `sign = n < 0 ? "-" : ""` — **positives get NO sign, no `$`** (money skin: `$ (a/1e6).toFixed(2) M`) | ink `SK.cell.text` — sign and value are ONE run, never two colours. Weight `SK.cell.weight[topRank===1?0:topRank?1:2]` | a strike absent from this sweep stays `undefined` → `--`, deliberately NOT `0` ("no gamma here" is a different claim from "not recorded at this moment") |
| D57 | GEX cell — heat | `skinMetricBg(val, maxAbs[e], topRank, intensity, SK)` | `n===0 \|\| max===0` → transparent; rank 1–3 → `skinRankBg`; else `alpha = min(ramp.max, ramp.base + ((ratio × max(intensity,1)) ** ramp.ease) × ramp.span)`, colour `rgba(SK.pos \| SK.neg, alpha)` | `SK.pos = "41,182,246"`, `SK.neg = "255,71,87"`. CLASSIC ramp `{base .02, span .16, max .18, ease 1.4}`, rank `[.90,.45,.25]`, intensity `{def 1.75, max 3}`, `levelFill false`. VIVID ramp `{base .05, span .25, max 1, ease .4}`, rank `[.95,.62,.40]`, intensity `{def 3, max 4}`, `levelFill true` | `val == null` → transparent |
| D58 | v3 divergence — flag | `board/multiGreek/mgMath.ts` | `MAX_EXP_COLS` 3 vs v2's 4 · `columnStats` adds `strike > spot` / `strike < spot` guards to CW/PW that v2 does not have · `fmtGex` prints `+` on positives and `$…M/B/K` where v2's `fmtCell` prints no `$` and no `+` · `cellAlpha` RAMP `{base .04, span .55, max .62, ease 1.6}` matches neither skin | **Four silent behaviour changes.** Open decisions 3 and 4 | — |
| D59 | Rank-1 ring | `!levelsOnly && topRank===1 && val != null` | `outline 1px solid rgba(SK.pos\|SK.neg, .9)`, `outlineOffset -1px`, `zIndex 1` | by sign | — |
| D60 | `★` peak star | `!levelsOnly && !isFront && topRank===1` | `position absolute · top 1 · left 2 · 10px · lineHeight 1 · pointerEvents none` | normal: `#ffd600` with `textShadow 0 0 2px rgba(0,0,0,.8)`. On a level-filled CB tile: `#04121a` with `textShadow 0 0 2px rgba(255,255,255,.55)` | — |
| D61 | CB glow | `isCB` → `className="mvc-peak-cell"` | `animation mvcGlow 2.4s ease-in-out infinite`; `0%,100%` → `box-shadow 0 0 3px rgba(255,255,255,.35)`, `50%` → `0 0 10px rgba(255,255,255,.85)` | injected as an inline `<style>` inside each Card | — |
| D62 | Level badge | `lvl && !SK.levelFill` | `CB` / `CW` / `PW`, `position absolute · right 2 · top 50% · translateY(-50%) · 8px / 900 · lineHeight 1.3 · letterSpacing .04em · radius 3 · padding "0 3px" · pointerEvents none`, ink `#ffffff`, bg `rgba(4,8,16,0.92)`, `boxShadow inset 0 0 0 1px ${lvl.c}` | titles `"CB — highest \|GEX\| level"` / `"CW — highest +GEX level"` / `"PW — most −GEX level"`; colours `LEVEL_COLORS.cb #ffd600` / `.cw #29b6f6` / `.pw #ff4757` | the value span gains `paddingRight 17` only when a badge actually renders |
| D63 | Cursor | — | `"default"` while rewound; the click handler is `undefined` | cells are not clickable in replay | — |
| D64 | Row sort | `allStrikes.sort((a,b) => b - a)` | **descending**, in both live and replay | replay's ladder is the **session's** strike union (fixed for the whole day), so it never shakes while scrubbing | — |
| D65 | Column order | `displayCols` | the session's expiries ascending, sliced to `colCount`, with the `ALL` column **appended** (`replaceLast = false`) | replay never swaps ALL in for the last expiry | — |
| D66 | Panel empty (frame, no cols) | — | `` `No recorded sweeps for ${ticker} this session` `` · `height 80 · centred · 12px` | ink `#475569` | **see open decision 2 — this string is unreachable in v2** |
| D67 | Panel empty (no frame) | — | `"Select an expiry and click GO"` | ink `#475569` | what actually renders for a ticker with no session, or a clock before its first sweep. `spot` is 0, so the header shows `--` |
| D68 | Panel empty (no rows) | — | `"No strikes in range"` | ink `#475569` | — |

### D.6 — Derived math (transcribe verbatim)

| # | Function | Detail |
|---|---|---|
| D69 | `computeReplayRows(frame, cols, sessionStrikes, contractMode)` | `basis = contractMode === "vol" ? "vol" : "net"` (`"oi"` ⇒ `net`, there is no OI-only recorded series). `allStrikes` descending. `atmStrike` = min `\|s − spot\|`, **first-wins scanning descending**, so a tie goes to the HIGHER strike. A missing cell leaves `gex[e]` `undefined`, not `0` |
| D70 | `columnStats(rows, cols)` | `g = r => r.gex[e] \|\| 0` (undefined never ranks or shades). `maxAbs` has a **floor of 1, not 0**. `top3` = ranks 1–3 by `\|GEX\|` descending, sign-blind. `top5PerSide` = 1–5 within each sign, **positives written first**. `mvcStrike` = highest `\|GEX\|`, first-wins in row order (descending strike) |
| D71 | `computeWalls(rows, expiry)` | CB = max `\|GEX\|`, first-wins descending. CW = top `+GEX` **skipping CB**. PW = most `−GEX` **skipping CB**. Three distinct strikes. **No spot filter in v2** — see open decision 3. Computed from the UNTRIMMED rows, so a capture window never changes which strike is a wall |
| D72 | Ex-0DTE TOTAL | `EX0_KEY = "ALL_EX_0DTE"`; `sumDates = totalCols.filter(c => c.daysTo !== 0).map(c => c.date)`; `gex[EX0_KEY] = sumDates.reduce((s,d) => s + (r.gex[d] \|\| 0), 0)`. Then the same `maxAbs` / `top3` / `top5PerSide` / `mvcStrike` bookkeeping every real column gets. `daysTo` is relative to `replayDate`, so "0DTE" means the expiry equal to the replayed session date |
| D73 | Rows over the union | rows are computed over shown ∪ summed dates, then `cols` trimmed back — a strike that exists only in a hidden expiry still gains a row (correct: it has an ALL value) |
| D74 | `levelsOnly` | `atMinIntensity(intensity, INTENSITY_MIN.chain = 0.5)`. In levels-only mode EVERY column names its own CB/CW/PW (`wallsByCol`, including the ALL column); otherwise only the FRONT column does |
| D75 | `levelFillBg` | CLASSIC → `null` (plain heat). VIVID → `linear-gradient(over, over), heat` with `over = rgba(LEVEL_COLORS[kind], alpha)`, alphas `{cb .85, cw 1, pw 1}` |
| D76 | Auto-scroll to ATM | per panel, latched. `anchorKey = \`${atmStrike}\|${rows.length}\|${rows[0]?.strike}\``; a change resets `userScrolledRef`. The centring effect runs on EVERY render (no dep array): `body.scrollTop = max(0, round(el.offsetTop − body.clientHeight/2 + el.offsetHeight/2))`. The latch is set only by a `wheel`/`touchmove` that ACTUALLY MOVED the panel (compare `scrollTop` across an rAF). Rounding is explicit so four panels line up to the pixel |

### D.7 — Live loops that keep running while rewound

Replay here is a **rendering swap**, not a teardown. Every live loop stays alive
and its output is discarded. A v3 port may skip all of them in replay mode
without changing a pixel — but that IS a change, so record it as a departure.

| # | Endpoint / feed | Interval | Fate in replay |
|---|---|---|---|
| D77 | `/api/expirations?ticker=` per ticker | once | unused |
| D78 | `/api/chains?ticker=&range=all[&noCache=1]` per ticker | **15 000 ms while `isMarketOpen()`** | unused |
| D79 | `/api/levels?ticker=` | per `activeExpiry` change | `emByTicker` — unused (`showEm` false) |
| D80 | `/proxy/es-spx-basis` | `MG_BASIS_REFRESH_MS = 1 800 000` | `useSpxFromEs` ladder — unused |
| D81 | `subscribeGex({ topics: ["spot", "aux"] })`; handles `snapshot`, `spot`, `aux`; publishes every `MG_SPX_PUBLISH_MS = 2000` | live | `effectiveSpots` — unused; panel spot comes from the frame |
| D82 | `/api/mult-greek-gex-grid` | 20 000 ms | **never fires** — `deltaWindow` is 0 |
| D83 | `/api/mult-greek-gex-change` | 20 000 ms | **never fires** — cells are not clickable |
| D84 | `gexHistRef` ring (`RING_MS = 35 × 60_000`), `gexOpenRef`, `getGexChange` | — | computed, discarded |

### D.8 — Persistence

| # | Key | Value | Notes |
|---|---|---|---|
| D85 | `mg_tickers` | JSON array of 4 symbols | applied **per slot** over a `DEFAULT_TICKERS = ["SPX","SPY","QQQ","NDX"]` base, `slice(0,4)`, each `trim().toUpperCase()`, empties skipped. De-dup: a repeated symbol resets to that slot's default; if the default collides too, the stored value is kept |
| D86 | `mg_custom_ticker` | legacy single symbol | read only when `mg_tickers` is absent or not an array → lands in slot index 3. Never written |
| D87 | `mg_heat_skin` | `"classic"` \| `"vivid"` | applied in an effect (server render is always `"classic"`); also resets `intensity` to that skin's `def` |
| D88 | `mg_col_count` | `"1".."3"` | clamped `min(3, max(1, round(n)))` on **read as well as write**, so an old `4` lands on 3 |
| D89 | `mg_show_all` | `"0"` \| `"1"` | — |
| D90 | not persisted | `replayOn`, `replayDate`, `replayIdx`, `replaySpeed` | — |

---

# Part E — Tab 4 "Options chain" (`initialReplay initialReplayScope="0dte"`)

**The full row-by-row inventory already exists** as
`docs/parity/options-chain.md` — Part E (replay transport bar, 21 rows), Part F
(empty states), Part O (the ⛶ Ladder modal, 22 rows), Part Q (replay column
build, mode pinning, sticky centre) and Part R (the two props). Do not
re-transcribe; tick those rows.

This part records only the mount.

| # | Concern | v2 | v3 status |
|---|---|---|---|
| E1 | Mount | `<OptionsChainPage initialReplay initialReplayScope="0dte" />`, lazy | v3's `pages/OptionsChain.tsx` takes **no props** (line 82) |
| E2 | `initialReplay` | default `false`; seeds `replayOn` | `useChainData` owns `c.replay.on` — needs the seed threaded through |
| E3 | `initialReplayScope` | default `"all"`; seeds `replayScope` | `useChainData` owns `c.replay.scope` — needs the seed threaded through |
| E4 | Shape | FULL — the page brings its own `PageShell` | v3's page is `<main>` inside the Shell; check it survives `minHeight: 0` nesting |
| E5 | Scope semantics | `0dte` collapses the grid to the session's front/same-day expiry and **hides the ⅀ Total column entirely** (`showTotalCol = false`); the frame index is untouched by the switch | already implemented — `ReplayBar` + `REPLAY_SCOPES` |
| E6 | Mode pinning | entering replay saves `{greek, change}` and forces `greekMode = "gex"`, `changeMode = "live"`; controls stay **visible but inert** with a tooltip saying why | already implemented (`replayPinned`, tooltip `"GEX only in replay — DEX/CHEX/VEX/OI/VOL are not recorded"`) |
| E7 | LIVE / REPLAY pill | `c.replay.frame ? "REPLAY" : "LIVE"`, ink and dot `T.orange` / `T.green` | already implemented |
| E8 | Replay empty state | heading `"Loading recorded session…"` / `` `Nothing recorded to replay for ${ticker}` ``; body `` `${ticker} · ${date}` `` / `` `${err \|\| "No snapshots for this ticker yet."} The recorder keeps roughly five trading days and only covers tickers on the scanner watchlist.` `` | already implemented |
| E9 | Cog "Replay" section | `▶ Replay` / `■ Exit Replay` | already implemented — must still work from inside the tab |
| E10 | ⛶ Ladder button | opens `ChainReplay` in modal mode | already implemented as `LadderModal`. **Note the collision:** tab 1 is the same component embedded. A user can open the modal on top of the hub. Decide: keep, or hide the button when mounted inside `/replay` |
| E11 | Recentre while playing | if the ATM row leaves the middle 60% of the viewport (`band = viewH × 0.2`), scroll it back — gated on `replayPlaying` so scrubbing never yanks position | already implemented |
| E12 | `autoDisplayPercent` | replay → **100** (the whole ladder) | already implemented |

---

# Part F — Shared data layer

Two recorder endpoints serve all four tabs. Everything else each tab fetches is
its own page's live data and is documented in that page's parity file.

| # | Concern | Detail |
|---|---|---|
| F1 | `GET /proxy/strike-growth/replay-meta` | no params → `{ ok, symbols: string[] }` (the recorded universe). Used by **tab 1 only**, for its symbol picker |
| F2 | `GET /proxy/strike-growth/replay-meta?symbol=<T>` | → `{ ok, dates: string[] }`, `String(d).slice(0,10)`. Used by tabs 1–4. `{ cache: "no-store" }`. **No polling** |
| F3 | `GET /proxy/strike-growth/frames?symbol=&date=` | → `{ ok, frames: [{ ts, spot, strikes: [{strike, net}], expiry?, expiryCount? }], expiries: string[] }` — ONE net per strike, front active expiry. **Tab 1 only** |
| F4 | `GET /proxy/strike-growth/frames-by-expiry?symbol=&date=` | → `{ ok, expiries: string[], frames: [{ ts, spot, cells: [[expiryIdx, strike, net, vol], …] }] }` — the whole matrix, `cells` **positional**. Tabs 2, 3, 4 |
| F5 | Cell parse | `cells.set(\`${expiries[c[0]]}\|${Number(c[1])}\`, { net: Number(c[2]) \|\| 0, vol: Number(c[3]) \|\| 0 })`; skip when the expiry or strike is invalid. Frame carries `expiries` filtered to the ones THIS sweep actually held |
| F6 | Frame ordering | `.filter(f => isFinite(f.t))` then `.sort((a,b) => a.t - b.t)`. Every step-hold pick relies on this |
| F7 | Session shape | `{ frames, strikes: union ascending, expiries: union sorted }` — the union across the whole day, which is what keeps every ladder axis stable while scrubbing |
| F8 | Coverage, stated everywhere | retention ≈ **5 trading days**; per-frame coverage is the **recorded walls only** (top N strikes a side per sweep), RTH; only tickers on the scanner watchlist are recorded. Every tab says this out loud in its own caveat line — that is deliberate, not duplication: a grid that looks like the live chain while being a record of the walls is the single worst way this feature can be misread |

**v3 mapping.** All four calls go through `query()` / `preload()` in
`src/data/api.ts`. **No tab touches the socket** — non-negotiable 2 has nothing
to bind on this page, and non-negotiable 3 means the four `replay-meta` calls of
tab 3 fire in parallel at entry, not per panel.

---

# Part G — Cross-tab behaviour

| # | Concern | v2 | Note for v3 |
|---|---|---|---|
| G1 | Symbol | four independent symbols — tab 1 has its own picker, tabs 2/4 have their own, tab 3 has four | **open decision 5** — the v3 Shell owns a board symbol |
| G2 | Date | independent per tab. Switching tabs does not carry the session date across | a shared `replayDate` would be new behaviour; flag it, do not smuggle it |
| G3 | Clock | independent per tab | same |
| G4 | Unmount | switching tabs unmounts the previous tab entirely (no `keepMounted`) — its fetches, intervals and playback all stop | keep. It is also what makes non-negotiable 5 trivially satisfied here |
| G5 | Chunk loading | tab 1 static, tabs 2–4 `lazy()` | in v3 all four are `lazy()`; tab 4 alone is the whole Options Chain page |
| G6 | Route | `app/v3/replay/route.ts` calling `serveSpaShell("v3")` | **step 4 of four.** Miss it and `/v3/replay` works in-app and 404s on a hard refresh or a shared link — and the hash router makes shared links the whole point of the tab bar |
| G7 | NAV entry | — | `src/shell/Shell.tsx` already has `{ to: '/replay', label: 'Replay', icon: '⏱️', comingSoon: true }`. The build flips `comingSoon` off and adds `prefetch` |
| G8 | Prefetch | none in v2 | `prefetch: ['/proxy/strike-growth/replay-meta']` on the rail item — the symbol list is the first thing every tab needs |
| G9 | Theme | v2 palette throughout | Analysis is already pinned to the V2/V2W tokens ("keep colors the same as the v2 version"). Tabs 2 and 3 must match Analysis, tabs 1 and 4 must match the chain. **Check which token set each tab lands on before styling** — `T.cyan`/`T.orange`/`T.red`/`T.green` resolve to different colours in the two sets |
| G10 | Budgets | — | `route` budget is 80 000 B brotli. Tab 4 is the existing `OptionsChain` chunk and tab 2 the existing `Analysis` lookup chunk — both must stay SHARED chunks, not be duplicated into a replay chunk. Verify with `npm run budgets` after wiring |

---

# Verification — `scripts/parity-check-replay.mjs`

Same shape as `parity-check-chain.mjs`: drive `/app/replay` and `/v3/replay` in
ONE browser against ONE backend in the same minute, harvest the LABELLED VALUES
out of each, and FAIL on anything present in v2 and absent in v3. Text, not
selectors — the port replaces every class name on purpose.

What this script must do that the existing ones do not:

1. **Walk the tab bar.** Four tabs, and only one is in the DOM at a time. The
   harvest clicks each tab (`role="tab"`, matched by label text) and harvests
   after each, exactly as `parity-check-chain.mjs` clicks through v2's cog tabs.
2. **Wait for a session, not a load.** Each tab fires `replay-meta` then
   `frames…`; the grid is empty until both land. `PARITY_SETTLE` must cover the
   slowest (tab 3 fires eight calls: four meta, four frames).
3. **Pin the clock.** The frame counter, the ET clock, the coverage cell count
   and every value in the grid depend on which frame is selected. Both sides
   land on the LAST frame by default (C20, D37) — assert that first, and if it
   drifts, drive both scrubbers to index 0 before comparing values.
4. **Probe the caveat lines verbatim.** They are the rows most likely to be
   dropped as "chrome", and they are the ones stopping a rewound grid being read
   as live. All four: C17, D32, the chain's coverage line, and tab 1's stamp.
5. **Report the declared departures as `~ soft`,** not silence — including the
   Multi Greek snapshot/📷/Discord buttons, so the drop stays visible.
6. Exit codes `0` pass · `1` parity failure · `2` could not run. A run that
   could not look is never a pass.

Add `check:parity:replay` and `check:parity:replay:self` to `package.json` and
into the `check` chain, matching the five that are already there.

---

# Notes for the port (step 2 onward)

**What must NOT come across** (v3 non-negotiables): v2 JSX, v2 component
imports, any `@/app/...` alias, and any colour literal — every hex in the tables
above becomes a token in `src/design/tokens.css`, reached through `T.*` /
`alpha()` / `mix()`.

**What must come across 1:1**: `MG_REPLAY_BASE_MS` / `TL_REPLAY_BASE_MS` /
`BASE_MS` all `700`; the speed ladder `[0.5, 1, 2, 4, 8]`; `minuteBucket` and
the step-hold `+59_999` cutoff; landing on the LAST frame; stop-at-end with no
loop; `TL_LADDER_SIDE = 20`; `TL_ANCHOR_SLACK = 5`; `maxAbs` floor of 1;
`INTENSITY_MIN.chain = 0.5`; the rank floors `[.90,.45,.25]` and `[.95,.62,.40]`;
`MAX_EXP_COLS`; the CB-collision rule; the first-negative-to-positive flip; and
every wording in the *Empty or loading* column.

**The honest ledger.** Of 187 rows: Part C (54) is a mount of a component v3
already ships with the right props. Part E (12) is two props on a page v3
already ships. Part B (27) is an `embedded` flag on a component v3 already
ships. Part A (18) and Part G (10) are the hub itself — small, new. **Part D
(58) is the build**, and it carries four silent divergences that already exist
in `mgMath.ts`. Estimate accordingly, and answer the five open decisions first.
