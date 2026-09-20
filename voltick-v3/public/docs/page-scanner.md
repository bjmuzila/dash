# `/scanner` — the Scanner

**Route:** `/scanner` (served at `voltick.cbedge.net/v3/scanner`)
**Mounted by:** `src/App.tsx:197` — `<Route path="/scanner" element={<Scanner />} />`, behind `const Scanner = lazy(() => import('@/pages/Scanner'))` (`src/App.tsx:56`).
**Rail entry:** `src/shell/Shell.tsx:143` — `{ to: '/scanner', label: 'Scanner', icon: '🔭', prefetch: ['/proxy/gex-change-top'] }`.
**Server shell:** `app/v3/scanner/route.ts` in the v2 repo (three lines calling `serveSpaShell("v3")`). Without it a hard refresh or a pasted link 404s — see AGENTS.md "Adding a page — FOUR steps, not three".

**Source files**

```
src/pages/Scanner.tsx                     the frame: tab state, owner gate, six mount points
src/pages/scanner/scannerNav.ts           the tab registry: ids, labels, accents, groups, DEFAULT_TAB
src/pages/scanner/format.ts               shared formatters + the z-score ladder (six tabs import it)
src/pages/scanner/candles.ts              /api/snapshots/candles — ES/NQ bars, IB Stats' only client

src/pages/scanner/GexChangeTopTab.tsx     tab 1 render
src/pages/scanner/gexChangeTop.ts         tab 1 types, grade ladder, scorecard maths, every string
src/pages/scanner/gexChangeTopData.ts     tab 1 endpoints and the two failure modes

src/pages/scanner/GexLevelsTab.tsx        tab 2 render (twelve cards, two draggable columns)
src/pages/scanner/gexLevels.ts            tab 2 types, maths, copy, the 12-card registry, persistence
src/pages/scanner/gexLevelsData.ts        tab 2 six endpoints, two polls

src/pages/scanner/IbStatsTab.tsx          tab 3 render
src/pages/scanner/ibStats.ts              tab 3 maths — the biggest module in the page
src/pages/scanner/ibStatsData.ts          tab 3 dataset + results + live candles
src/pages/scanner/ibLevels.ts             tab 3 level ladder geometry — @notWiredInV2, NOT mounted
src/pages/scanner/ibProbability.ts        tab 3 Probability Engine
src/pages/scanner/ibDailyResults.ts       tab 3 EOD scoreboard (23 columns)

src/pages/scanner/PickStudyTab.tsx        tab 4 render (OWNER ONLY)
src/pages/scanner/pickStudy.ts            tab 4 bucket logic, verdict wording, every copy string
src/pages/scanner/pickStudyData.ts        tab 4 five routes — three GETs, two POSTs

src/pages/scanner/StrikeQueryTab.tsx      tab 5 render
src/pages/scanner/strikeQuery.ts          tab 5 derivation pipeline, column contract, strings
src/pages/scanner/strikeQueryData.ts      tab 5 two endpoints and nothing else

src/pages/scanner/WatchThisTab.tsx        tab 6 render (four surfaces in one card)
src/pages/scanner/watchThis.ts            tab 6 types, sorting, day grouping, probe maths, strings
src/pages/scanner/watchThisChart.ts       tab 6 probe chart geometry and scales
src/pages/scanner/watchThisData.ts        tab 6 four endpoints, two polls, one mutation

src/pages/scanner/TpoTab.tsx              TOMBSTONE — `export {}`
src/pages/scanner/tpoData.ts              TOMBSTONE — the candle half moved to candles.ts
src/pages/scanner/tpoProfile.ts           TOMBSTONE
src/pages/scanner/tpoStructures.ts        TOMBSTONE
src/pages/scanner/tpoTaxonomy.ts          TOMBSTONE
src/pages/scanner/amt.ts                  TOMBSTONE
```

---

## What it is, in one paragraph

`/scanner` is six independent research surfaces sharing one route, one tab strip and one card edge. The tab lives in the query string (`/v3/scanner?tab=ibstats`), so a link is pasteable and Back leaves the page rather than walking the tabs; each tab is its own `lazy()` chunk, so opening GEX Change Top does not download IB Stats. What the six do: **GEX Change Top** is the default — the recorder's ★ Very strong gamma-delta captures for one ET session, five tiles an hour, each one flippable to its recorded option price line, with an EOD scorecard that grades every pick A+ to F. **GEX Levels** is the live 0DTE gamma board — four header tiles, two semi-gauges, and twelve drag-and-drop cards covering walls, flip, cumulative gamma, per-strike gamma and delta ladders on three expiry scopes, EOD session history and the intraday vol-GEX flow. **IB Stats** is the initial-balance / opening-range base-rate bench: a live read of today's session against ~2,300 recorded sessions, fifteen rules scored against that history, a three-ring probability engine, and — for the owner — sixteen historical cards and a 23-column EOD scoreboard. **Pick Study** (owner only) is GEX Change Top's feedback loop, bucketing graded picks on one capture-time feature at a time and calibrating the projection rule. **Strike Query** fans out the strike-growth recorder across the watchlist and ranks strikes by GEX and its 15/30/60-minute deltas. **Watch This — Far CB** is the far-OTM dominant-CB flagger and its permanent scoreboard. The whole page runs on v2's palette, not v3's semantics, under one global-token override (`.scanner-v2`), and every tab was transcribed 1:1 against `docs/parity/scanner.md` (1,525 rows) with v2's own bugs reproduced on purpose and tagged `// BUG (v2):` at the site.

---

## File map

| File | Lines | What it owns |
|---|---:|---|
| `src/pages/Scanner.tsx` | 208 | The frame only: `?tab=` state, the owner gate, six `lazy()` mount points, the tab strip |
| `src/pages/scanner/scannerNav.ts` | 195 | The tab registry — `ScannerTabId` union, `SCANNER_TABS`, `SCANNER_GROUPS`, `DEFAULT_TAB`, `OWNER_ONLY_TABS` |
| `src/pages/scanner/format.ts` | 135 | `fmtB` / `fmtInt` / `fmtChg` / `fmtPct` / `pctOrDash` / `EM_DASH` / `zColor` / `fmtZ` / `Z_LEGEND` / `NEUTRAL` |
| `src/pages/scanner/candles.ts` | 468 | `/api/snapshots/candles` — the four ES/NQ URL builders, the `lite=1` columnar decoder, `loadCandles` |
| `src/pages/scanner/gexChangeTop.ts` | 2049 | Wire types, the gate, the grade ladder, sign colours, scorecard maths, card derivation, chart maths, all copy |
| `src/pages/scanner/gexChangeTopData.ts` | 549 | `/proxy/gex-change-top`, `-history`, `-results`; `Load<T>`; the four hook-shaped view adapters |
| `src/pages/scanner/GexChangeTopTab.tsx` | 1999 | Card, toolbar, scorecard, slot sections, the 3D flip tile, the SVG price chart, footer legend |
| `src/pages/scanner/gexLevels.ts` | 2632 | 19 numbered sections: accessors, derivation, curve, pan/zoom, geometry, colour ladders, gauges, copy, the 12-card registry, layout persistence |
| `src/pages/scanner/gexLevelsData.ts` | 1078 | Six endpoints, two stale windows, the parse rules, `loadGexLevelsEntry` |
| `src/pages/scanner/GexLevelsTab.tsx` | 2132 | Header card, 12 card bodies, drag-and-drop columns, eleven hand-rolled SVG charts |
| `src/pages/scanner/ibStats.ts` | 3981 | Everything IB: windows, width ladders, break timing, `computeLiveSession`, `buildRules`, families, owner cards |
| `src/pages/scanner/ibStatsData.ts` | 295 | `/data/ib-*.json`, `/api/ib-results`, the live candle legs, `loadIbStatsEntry` |
| `src/pages/scanner/ibProbability.ts` | 412 | The three-ring engine: weights, env multipliers, ring geometry, the 10:30 freeze |
| `src/pages/scanner/ibDailyResults.ts` | 521 | The EOD scoreboard's 23 columns, cell readers, hit-rate footer, bias post-mortem |
| `src/pages/scanner/ibLevels.ts` | 747 | The IB level ladder's SVG geometry. Every export `@notWiredInV2`; nothing mounts it |
| `src/pages/scanner/IbStatsTab.tsx` | 1753 | Control strip, Live Read, IB Read, Probability Engine, sixteen owner cards, the scoreboard |
| `src/pages/scanner/pickStudy.ts` | 1416 | Bucket/calibration types, sorting, verdict, rule-bar state, every string |
| `src/pages/scanner/pickStudyData.ts` | 331 | Five routes: study / calibration / rule GETs, rule-fit and disarm POSTs |
| `src/pages/scanner/PickStudyTab.tsx` | 1020 | Controls, headline, verdict, bucket table, rule bar, fit preview, calibration table |
| `src/pages/scanner/strikeQuery.ts` | 874 | `SqRow`, the four-step filter, comparators, the six columns, cell text and colour, all strings |
| `src/pages/scanner/strikeQueryData.ts` | 287 | `/proxy/strike-growth/watchlist` and `…/by-expiry`, the fan-out, expiry derivation |
| `src/pages/scanner/StrikeQueryTab.tsx` | 545 | Toolbar, Top-10 cards, the sortable table |
| `src/pages/scanner/watchThis.ts` | 1196 | Flag/outcome types, `sortOutcomes`, `groupOutcomesByDay`, `probeStats`, twelve columns, every string |
| `src/pages/scanner/watchThisChart.ts` | 595 | `buildProbeGeometry`, the 960×340 viewBox, inks, hover model |
| `src/pages/scanner/watchThisData.ts` | 703 | Four endpoints + `POST /api/far-cb-tickers`, the two polls, the `useQuery` adapters |
| `src/pages/scanner/WatchThisTab.tsx` | 1634 | Flag grid, twelve-column table, day view, detail panel, the probe SVG |
| `src/pages/scanner/TpoTab.tsx` | 17 | Tombstone |
| `src/pages/scanner/tpoData.ts` | 46 | Tombstone — names a forwarding table to `candles.ts` |
| `src/pages/scanner/tpoProfile.ts` | 20 | Tombstone |
| `src/pages/scanner/tpoStructures.ts` | 24 | Tombstone |
| `src/pages/scanner/tpoTaxonomy.ts` | 21 | Tombstone |
| `src/pages/scanner/amt.ts` | 22 | Tombstone |

Total for the directory plus the page file: **35,782 lines.**

---

## The frame — `src/pages/Scanner.tsx`

### Six tabs, not seven

The page file's own header opens:

> `/scanner` — the scanner page. Six tabs over one route.
> (Seven until 2026-09-03, when TPO Structures was dropped. See the dated note in `pages/scanner/scannerNav.ts` — the registry is where a tab exists or stops existing; this file only mounts what the registry's union allows, which is why `TAB_COMPONENT` is a `Record<ScannerTabId, …>` and not a partial map.)

`App.tsx:49` and `App.tsx:53` still say "seven tabs over one route" and "Each of the seven tabs is its own `lazy()` chunk". Those two comment lines are stale; the union, the registry and the `TAB_COMPONENT` record all carry six.

The TPO removal note in `scannerNav.ts` is worth reading in full because it names the enforcement:

> 2026-09-03: `'tpo'` — TPO Structures. Brandon dropped the tab. It left THREE places in this file, not one… a stale key in `SCANNER_GROUPS` is harmless, but a stale entry in `SCANNER_TABS` STILL DRAWS A PILL — one that selects a tab id with no component behind it. Removing it from `SCANNER_TABS` is what stops the pill; removing it from `ScannerTabId` is what makes the compiler find every other site, because `TAB_COMPONENT` in pages/Scanner.tsx is a `Record<ScannerTabId, …>` and a leftover `'tpo'` key is only an error once the union no longer contains it. The union is the enforcement, so it leaves too.

`isScannerTabId('tpo')` is now false, so a pasted `?tab=tpo` falls back to `DEFAULT_TAB` like any other unknown id.

### The registry

```ts
export type ScannerTabId =
  | 'gexlevels' | 'gexchangetop' | 'pickstudy' | 'strike' | 'ibstats' | 'watch'
```

| id | `label` | `short` | `accent` | `icon` | owner only |
|---|---|---|---|---|---|
| `gexlevels` | GEX Levels | Levels | `V2.cyan` | 📏 | no |
| `gexchangetop` | GEX Change Top | GEX Δ Top | `V2.orange` | 📊 | no |
| `pickstudy` | Pick Study | Study | `V2.purple` | 🔬 | **yes** |
| `strike` | Strike Query | Strike | `V2.cyan` | 🎯 | no |
| `ibstats` | IB Stats | IB Stats | `V2.accent` | 📐 | no |
| `watch` | Watch This | Watch | `V2.accent` | 👁️ | no |

`SCANNER_GROUPS` clusters them left→right with a hairline divider between clusters:

```
gamma      → gexlevels, gexchangetop, pickstudy, strike
structure  → ibstats                     (one tab since TPO left; kept as its own
                                          cluster because IB Stats is a structure
                                          read, not a gamma read, and the divider
                                          is what says so)
more       → watch
```

`DEFAULT_TAB = 'gexchangetop'`. The registry note records why that is one constant:

> v2 had TWO answers for the default tab: `ScannerPage`'s `useState` said "gexchangetop" and `sectionNav.ts`'s `SCANNER_SECTION.defaultTab` said "gexlevels". On a bare /scanner the strip highlighted GEX Levels while GEX Change Top was rendered. There is one constant here, `DEFAULT_TAB`, and both the page and the strip read it.

`OWNER_ONLY_TABS` is **derived, never hand-listed**: `new Set(SCANNER_TABS.filter(t => t.ownerOnly).map(t => t.id))`. And `isScannerTabId` deliberately does **not** filter by owner:

> a non-owner who pastes `?tab=pickstudy` has a valid tab id that they are not shown. Conflating the two would make a bad URL and a forbidden URL indistinguishable.

### The tab is the URL

`TAB_PARAM = 'tab'`. `useSearchParams()` is the source of truth. `selectTab` writes with `{ replace: true }`:

> `replace` so the six tabs do not stack six entries in the history for one visit — back should leave the page, not walk the tabs you browsed.

The `SCANNER_TAB_EVENT` window event that v2 needed is gone, and the reason it existed is recorded:

> v2 needed it because its strip navigated to `/scanner?tab=…` and React Router does not remount for a query-string-only change — so the URL moved and the visible tab did not… v2's listener was also the unvalidated way in: it cast any truthy `detail` to a tab id with no `isScannerTabId` guard, so a malformed event rendered the page with no card at all, silently.

### The owner gate is THREE-way

```ts
const ownerGated = OWNER_ONLY_TABS.has(tab) && !isOwner
const visibleTab: ScannerTabId | null =
  ownerGated ? (authLoaded ? DEFAULT_TAB : null) : tab
```

> While auth resolves, `visibleTab` is null and NOTHING mounts — not the gated tab, not the fallback. A flash of the wrong tab that then swaps is worse than an empty beat, and it would also fire the wrong tab's requests.

And the gate is chrome, not a boundary:

> It decides what is drawn, not what is allowed. A hidden tab is one devtools poke away from visible, so anything behind it that must not leak needs a server-side gate on its own data route. Pick Study's five routes are only PROVEN gated on the two POSTs.

### Suspense keying

```tsx
<Suspense key={visibleTab ?? 'pending'} fallback={null}>{Tab ? <Tab /> : null}</Suspense>
```

> `key` on the boundary so switching tabs gets a fresh Suspense rather than holding the previous tab's tree while the next chunk loads.

`fallback={null}` — there is no page-level spinner. Each tab owns its own loading copy.

### The one global-token override

The page root carries `className="scanner-v2 flex min-h-0 flex-1 flex-col gap-3"`. `tokens.css:403–424`:

> `/v3/scanner` runs on v2's palette (Brandon, 2026-09-03). v2 draws a card edge as a WHITE HAIRLINE, `rgba(255,255,255,0.10)`; v3's `--color-line` is an opaque slate #23272e. Six sites reach the edge through an inline style and are remapped one by one, but 37 more go through the `border-line` utility and the Card primitive — neither of which the scanner owns. Rather than recolour every v3 page or fork the primitives, the scanner's root carries `.scanner-v2` and the token is redefined FOR THAT SUBTREE ONLY… Delete this to put the scanner back on the v3 edge. Nothing else changes.

The rule as it stands:

```css
.scanner-v2 { --color-line: #1e2630; }
```

**Gotcha:** `:root` already declares `--color-line: #1e2630` (`tokens.css:79`). The override is byte-identical to the value it overrides, so as shipped it changes nothing. The comment's "#23272e" is stale. See Gotchas at the end.

### The tab strip

A plain `<nav className="flex flex-wrap items-center gap-1 border-b border-line pb-2">`. Per group: a `<span aria-hidden className="mx-1 h-4 w-px bg-line" />` divider for every group after the first, then a pill per tab. Pills are `rounded-md border px-3 py-1.5 text-sm`; the active one is `border-line bg-surface2 text-fg` plus an inline `borderColor: t.accent`, the inactive one `border-transparent text-muted`. Owner-only pills are filtered out for everyone else, and an empty group renders nothing at all.

> The accent is per-tab and comes from the registry as a token. Only the active pill wears it, so the row does not become six competing colours.

---

## Shared modules

### `format.ts` — six tabs import this

| Export | Contract |
|---|---|
| `EM_DASH` | `'—'` (U+2014). The page's one "no value" glyph |
| `NEUTRAL` | `V2.neutral` → `--color-v2-neutral` `#c0c5c3`. v2's `NEUTRAL`, imported by six tabs |
| `fmtB(n)` | Signed compact: `+1.40B` / `-45.6M` / `+789.` Tiers at 1e9 (2dp), 1e6 (1dp), 1e3 (1dp), else 0dp. **ASCII hyphen, not U+2212** — "the tables it feeds are tabular-figure aligned and the minus glyph is a different width in that font" |
| `fmtInt(n)` | `Math.round(n).toLocaleString()` — contract counts, not money |
| `fmtChg(n)` | `+1,204` / `-330` / `+0`. The minus comes from the NUMBER, only the plus is added |
| `fmtPct(v, d=1)` | 0–1 fraction → `12.4%`, em dash on null/NaN |
| `pctOrDash(n)` | `Math.round(n*100)` + `%` — note it multiplies, so it takes a fraction despite the name |
| `zColor(z)` | null → `alpha(T.text,0.4)` · `\|z\| ≥ 3` → `V2.red` · `≥ 2` → `V2.orange` · else `T.text` |
| `fmtZ(z)` | `+2.4σ` one decimal, em dash on null |
| `Z_LEGEND` | `{ unusual: 'z ≥ 2σ = unusual', extreme: 'z ≥ 3σ = extreme' }` |

Four rules stated as non-negotiable in the header:

1. `fmtB` **always** carries a sign, so zero prints `+0`. "The columns it feeds are signed gamma deltas, where a bare `0` reads as 'no data' and `+0` reads as 'measured, and flat'. Do not add a zero case."
2. `fmtB` buckets on the **absolute** value, so `-1.4e9` prints `-1.40B` — sign from the prefix, never from the number.
3. `fmtChg` uses `>= 0` for its plus, also printing `+0`, but takes its minus from the number. Two functions, two routes to the same place; both copied because six tabs' columns already read one way or the other.
4. `zColor` compares the **absolute** z, so `-3.1σ` is painted exactly like `+3.1σ`. "The colour says 'unusual', not 'up'."

And the precision note:

> None of these guard null or NaN. v2's `fmtB(null as any)` yields `+NaN` and that is what reaches the screen. Callers that can pass a null MUST check first and render their own em dash… adding it would silently turn six tabs' "no data" states from an explicit "—" into a "+0", which is the one thing rule 1 above exists to prevent.

### `candles.ts` — the ES/NQ bar legs

Extracted from `tpoData.ts` on 2026-09-03 when TPO went. **It now has exactly one consumer in v3: `ibStatsData.ts`.**

| Export | Value / behaviour |
|---|---|
| `CandleInstrument` | `'ESU' \| 'NQU'` (was `TpoInstrument`) |
| `esCandlesTodayUrl(interval=5, date=etDateStr())` | `/api/snapshots/candles?…lite=1`, sends `interval` |
| `esCandlesHistoryUrl(daysBack=20, interval=5)` | ES history, **limit 20000** |
| `nqCandlesTodayUrl(date)` | NQ today — **does not send `interval`** |
| `nqCandlesHistoryUrl(daysBack=20)` | NQ history, **limit 10000** |
| `CANDLES_TODAY_STALE_MS` | `3_000` |
| `CANDLES_HISTORY_STALE_MS` | `60_000` |
| `CANDLE_COALESCE_MS` | `250` (the 4 Hz publish ceiling a socket-fed caller would see) |
| `etDateStr(d=new Date())` | ET calendar day as `YYYY-MM-DD`, from ONE module-level `Intl.DateTimeFormat` |

Five documented behaviours:

1. **The rows arrive as strings.** Postgres BIGINT/REAL deserialize quoted. Without `normalizeCandle` "`new Date('1782187200000')` is Invalid Date, every RTH filter drops every bar, and the caller shows 'waiting on candles' forever with no error."
2. **`lite=1` is columnar** — `{lite:1, cols:[…], rows:[[…]]}`, zipped back by `cols`, with a fall-through to the legacy `rows:[{…}]` object shape "so a client deployed ahead of the backend still works".
3. **ES sends `interval`, NQ does not.** `es_candles` holds 1m AND 5m rows on the same slotKey space; "the NQ pair was never given the filter".
4. **History limits differ by symbol: ES 20000, NQ 10000.** Not a typo — five sessions of 1m ES bars is ~9.7k rows, close enough to a 10k ceiling that a busy week would silently truncate. NQ never got the raise.
5. **`daysBack <= 0` drops the filter and raises the limit to 50000.** No caller reaches it; IB Stats always passes `LIVE_FEED_HISTORY_DAYS` = 2.

`loadCandles` uses `Promise.allSettled` for **both** instruments with a per-leg warning. v2's NQ load used `Promise.all`, "so one rejected leg takes the other down and the caller shows an empty chart with nothing logged".

The one deliberate departure: two request-dedupe layers became one. v2 stacked `useEsCandles.sharedLoad` (3000 ms TTL, keyed `` `${interval}|${days}` ``) on top of `snapdb._dedupeCandles` (5000 ms TTL, keyed on the full URL) — "two TTL caches with different windows and different key spaces on one request path, so which one answers depends on which mounted first".

---

# TAB 1 — GEX Change Top (`?tab=gexchangetop`, the default)

## What it lists

Three stacked surfaces inside one `Card` titled **`GEX Change · Hourly Top 5`**:

1. the **EOD scorecard** — every auto-probed pick for the date, graded;
2. the **slot sections** — the ★ Very strong captures, five tiles per 30-minute slot;
3. the **footer legend** — the ranking and grading contract, as prose.

Subtitle (`CARD_SUBTITLE`, C45), verbatim:

> `★ Very strong picks (|Δ| ≥ $200k & |% vs open| ≥ 30%), ranked by score · captured every 30 min during RTH`

with `' · refreshing…'` (`SUBTITLE_REFRESHING_SUFFIX`, one U+2026) appended while the slot feed is loading. That suffix is **the only loading affordance once data is on screen.**

Ink: `V2.green`. The docblock records the reversal:

> Step 2 moved it to `T.muted` as part of collapsing #8ECAE6's three jobs; 2026-09-03 reverses that — the scanner renders v2's palette and #8ECAE6 splits by JOB, so the CHROME leg keeps v2's value while the positive leg goes to `V2.up`.

## Data path

| Const | Path | Poll | Stale |
|---|---|---:|---:|
| `EP_TOP` | `/proxy/gex-change-top` | `POLL_MS` 60 000 ms | `NO_STORE_STALE_MS` 10 000 ms |
| `EP_RESULTS` | `/proxy/gex-change-top-results` | `POLL_MS` 60 000 ms | 10 000 ms |
| `EP_HISTORY` | `/proxy/gex-change-top-history` | `POLL_MS` when 1–8 cards open, else none | `HISTORY_STALE_MS` = `POLL_MS` = 60 000 ms |
| `EP_STUDY` | `/proxy/gex-change-top-study` | — | **this tab never calls it** (Pick Study does) |
| `EP_WATCH` | `/api/watch` | — | **this tab never calls it** (the recorder does, server-side) |

Query params: `?date=YYYY-MM-DD`, **omitted entirely when falsy**, never sent blank —

> the SERVER then picks today… which is what keeps a viewer in London from asking for tomorrow's slots.

The history URL is `?id=<watch_id>` always, `&date=` appended only when present.

`gexChangeTopUrls(date)` returns `{ top, results }` for `preload()`. The rail prefetches `/proxy/gex-change-top` bare (no date) on hover.

### The 10-second remount-dedupe window

`NO_STORE_STALE_MS = 10_000`, and the docblock is the clearest statement of a mistake this repo made and corrected:

> This was `0` until 2026-09-03, on the reasoning that v2 sent `{ cache: "no-store" }` and `staleMs: 0` is the `query()` equivalent. That reasoning was WRONG, and a network trace of /v3/scanner proved it: every feed on the page fired TWICE on one load. The two are not equivalent. `no-store` is an HTTP-cache directive on a fetch v2 made ONCE PER MOUNT and then held in component state — v2 never asked twice because it never re-ran the fetch. `staleMs: 0` disables `query()`'s in-memory reuse, so every remount, every StrictMode double-invoke and every rail `preload()` that lands before the component mounts costs a SECOND full round trip… 10s is chosen against the poll cadence, not plucked: these feeds poll at 60s, so a value one sixth of that cannot put a number on screen that the next tick would not have shown anyway.

The identical block is repeated verbatim in `gexLevelsData.ts`, `pickStudyData.ts` and `watchThisData.ts`.

### Two failure modes, kept apart

```ts
export type Load<T> =
  | ({ status: 'ok' } & T)
  | { status: 'rejected'; error: string }   // body said ok:false  → CLEAR the rows
  | { status: 'failed';   error: string }   // request threw       → KEEP last-good rows
```

> A body that says `ok: false` CLEARS the rows; a thrown request keeps the last-good rows on screen. v2 wrote those two branches deliberately and the difference is visible — a proxy blip leaves the board up, a server that says "no" empties it.

`topView()` checks `ok:false` **before** `error`, on purpose: "reversing the two would put a stale board under an 'Error:' line that v2 would have emptied." `pickHistView()` is the other way round, because v2's `loadPick` wiped the chart on both failure paths.

### Three named departures

1. **C12's waterfall is straightened.** v2 ran `loadResults(date || undefined)` in an effect keyed on `date`, firing once with `""` then again when `/gex-change-top` echoed a date back — two `/results` requests per entry, the second waiting on the first feed for a value it did not need. `loadGexChangeTopEntry()` fires both together.
2. **`query()` dedupes by URL, v2 did not, and v2 had no `AbortController`** — two overlapping loads could resolve out of order and the later-resolving one won. Two loads of the *same* URL now share one promise. A load of a *different* date still can race, exactly as before.
3. **A LOSS, flagged:** v2 called `r.json()` unconditionally and read `j.error` off the body whatever the status. `query()` throws on a non-2xx before the body is parsed, and this proxy pairs `ok:false` with 503 (404 for history) — so where v2 showed "recorder not running", v3 shows `503 Service Unavailable — /proxy/gex-change-top`. The `rejected` variant is still correct for a 200-with-`ok:false`; it is simply not the path today's server takes.

Polls pause on a hidden tab (`useQuery`'s default). v2's intervals kept firing while hidden. "A missed poll is repaired by the next one, so nothing in the session's record is lost, which is the only condition that would justify `background: true`."

## Wire types

`Row` (one captured pick, from `slots[].rows[]`):

`slot`, `rank`, `symbol`, `expiry`, `strike`, `spot`, `latest_chg`, `pct_open`, `z_score`, `score`, `window_min`, `watch_id`, `proj_grade?`, `proj_pts?`, `live?`.

- `watch_id` is `watch_options.id` of the auto-probed contract — **null on pre-auto-probe rows**, and a null `watch_id` makes a card unclickable with no back face and no tooltip.
- `proj_grade` is stamped at capture by the recorder's projection rule, **null whenever no rule is armed, which is the shipping default** (`server-v2/config/pick-proj-rule.json`). Never recomputed client-side — "the whole point is that it records what was predicted in advance."
- `live: true` means the row was written by the recorder's fast trigger scan the minute the strike crossed into ★ Very strong. Its slot is the exact ET minute of the crossing.

`SlotBucket`: `{ slot, ts, live?, rows }` — `live` is true only when **every** row in the bucket was trigger-written.

`ResultRow` (scorecard): `watch_id`, `symbol`, `expiry`, `strike`, `side`, `first_slot`, `slots`, `best_rank`, `score`, `entry`, `entry_ts`, `max_mark`, `max_ts`, `max_pct`, `min_mark`, `min_pct`, `close_mark`, `close_ts`, `close_pct`, `samples`, `min_ts?`, `sustained_mark?`, `sustained_pct?`, `sustained_ts?`, `grade?`, `grade_pts?`.

### Eleven fields on the wire with no surface

Tagged `@neverReadInV2` individually so step 3 makes a decision rather than losing them:

- `Row` (2): `z_score`, `window_min`
- `ResultRow` (9): `best_rank`, `score`, `min_mark`, `close_ts`, `samples`, `min_ts`, `sustained_mark`, `sustained_pct`, `sustained_ts`

And the one that matters:

> `sustained_pct` is the interesting one. Its own type comment calls it "the fillable move, as opposed to `max_pct`'s single print" — i.e. it is the honest version of the number the whole scorecard, the whole grade ladder and the whole card headline are built on, and the UI shows `max_pct` instead. NO SURFACE IS INVENTED FOR THEM HERE… The spec prose at C9 says "seven"; the true count on `ResultRow` is nine.

`z_score` is read by the v3-only gate but still rendered nowhere.

## The gate (v3-only, no v2 counterpart)

```ts
export const GATE = { chg: 500_000, pctOpen: 50, z: 2 } as const
export const GATE_DEFAULT: GateOn = { chg: true, pct: true, z: false }
```

Three independent switches, each with its own label and its own cost counter:

| key | label | test |
|---|---|---|
| `chg` | `\|Δ\| ≥ $500k` | `latest_chg != null && Math.abs(latest_chg) >= 500000` |
| `pct` | `\|% vs open\| ≥ 50%` | `pct_open != null && Math.abs(pct_open) >= 50` |
| `z` | `\|z\| ≥ 2` | `z_score != null && Math.abs(z_score) >= 2` |

Null fails every test: "an unverifiable row is not a passing row."

Why three and not one:

> This first shipped as a single all-three-at-once toggle and on its first real date it removed 53 of 54 picks. A 98% rejection rate is not a strict filter, it is a broken one — and one number cannot say WHICH condition did it, so the only thing to do with the result was guess. Each switch now carries the count it ALONE rejects.

Why `z` is off by default, in the file's own words:

> z is (latest_chg − mean_chg) / sd_chg over that strike's OWN recent deltas, so it measures ACCELERATION, not size. A strike that builds steadily all morning has latest ≈ mean and therefore z ≈ 0 BY CONSTRUCTION — and steady accumulation is the exact pattern this scanner exists to find. `|z| ≥ 2` is not a stricter version of the magnitude filters; it selects a different phenomenon (a sudden burst) and throws the builds away. It stays available because "show me only the bursts" is a real question, just not part of "is this pick big enough".

And what is deliberately **not** offered:

> NOT AVAILABLE HERE: a floor on the `pct_open` DENOMINATOR. At 09:47 the open baseline is a handful of contracts, so "+300% vs open" is a rounding error wearing a percentage sign. `gex_open` is a real column on `strike_growth` but is not carried onto `gex_change_top`, so it cannot be checked client-side on rows already recorded. The recorder's 10:00 warm-up stands in for it.

`gateCounts` reports `alone` per condition **measured with the other switches ignored** — "so the three numbers are comparable TO EACH OTHER… They will not sum to `hidden`: a pick failing two conditions is counted by both." `gateOkIdsFrom` carries the same decision to the scorecard by `watch_id`, "because a gate judged on the cards but not on the averages tells you nothing."

The `z` switch's tooltip appends a second paragraph explaining the acceleration point; the other two get only `"{label} — on its own this drops {cost} of {total} picks on this date."`

## The grade ladder — the cross-part contract

100 points in three parts, measured from the scorecard's `entry`:

| Part | Range | Input | Meaning |
|---|---:|---|---|
| Peak | 0–55 | `max_pct` (MFE) | how much gain was ever on offer |
| Pain | 0–25 | `min_pct` (MAE) | how much heat it took getting there |
| Close | 0–20 | `close_pct` | where it actually finished |

**Peak**, first match wins, every boundary `>=` except the last which is strict `> 0`:
`>= 150 → 55 · >= 100 → 50 · >= 50 → 42 · >= 30 → 33 · >= 20 → 26 · >= 10 → 18 · > 0 → 8 · else → 0`.
`max_pct === 0` therefore scores 0 peak **and** trips `neverGreen`.

**Pain** on `minPct`, defaulted to **−25** when absent:
`>= -10 → 25 · >= -20 → 20 · >= -30 → 15 · >= -45 → 9 · >= -60 → 4 · else → 0`.

The code-vs-comment conflict is transcribed rather than fixed:

> v2's comment reads: "No low recorded -> assume it was not free. Half credit…" The default it actually uses is −25, which lands in the `>= -30 → 15` bucket — 15 of 25, i.e. SIXTY percent, not half. THE CODE WINS: −25 and 15 are transcribed exactly, because Pick Study has been reading 15 back for every ungraded-MAE pick on file and "fixing" it to 12.5 would silently re-grade that history.

**Close** on `closePct` (nullable):
`null → 8 · >= 50 → 20 · >= 20 → 16 · >= 0 → 11 · >= -20 → 6 · >= -50 → 2 · else → 0`.

> Note the null default of 8 sits BETWEEN the `>= -20` bucket (6) and the `>= 0` bucket (11) — a flat close scores 11, better than having no close at all, and a −10% close scores 6, worse. That ordering is deliberate.

Minimum for a pick that traded green at all: 8 + 0 + 0 = 8. `gradePoints` returns null only when `maxPct` is null/non-finite.

**Letter ladder (local path), all `>=`:** `A+ >= 85 · A >= 72 · B >= 58 · C >= 44 · D >= 28 · F below 28`, **plus F unconditionally when `max_pct <= 0`.**

The hard rule:

> A pick that never traded above its flag mark offered no exit at all, and that is the case this grade exists to name — avg peak hides it, because one +300% runner pays for four that went straight to red. Pain and close credit must not launder a never-green pick up into a D.

### The `gradeFor` bug, reproduced

`gradeFor` has two paths. The server is the source of truth (`server-v2/_lib-pick-grade.cjs`); the local ladder exists only for rows frozen before grading shipped.

> `// BUG (v2):` the SERVER path never applies the never-green override while the local path does. A `/results` row carrying `grade: "B"` with `max_pct <= 0` renders a B pill AND is counted in the "never green N (P%)" figure beside it (C70), because `neverGreen` is computed on BOTH paths and only ACTED ON by one. The two halves of the same strip disagree about the same pick, by construction. Transcribed as written — the server is the authority on the letter, and quietly overriding it here would put the client and `_lib-pick-grade.cjs` into a fight the user would see as a flickering grade.

Two more preserved details on the server path: an unparseable `grade_pts` contributes 0 (dragging the GPA down without changing the letter), and the `"N/100 · "` prefix is omitted when `grade_pts` is not finite. That path **never** carries the "Never traded green" wording even when `neverGreen` is true. On the local path the never-green `why` string uses a **capital** "Peak" against the lowercase "peak" in the other two variants — "copied, not normalised".

### Grade ink and tooltips

`GRADE_COLOR`: `A+` and `A` → `V2.green` · `B` → `V2.cyan` · `C` and `D` → `V2.orange` · `F` → `V2.red`.

> SIX STEPS PAINTED WITH FOUR COLOURS: A+ and A are the same value, and so are C and D. Colour alone cannot separate them; the tooltip is the only thing that does. That is v2's ramp and it is transcribed rather than expanded… A GRADE LETTER IS A CATEGORY, NOT A SIGN — it takes the chrome leg of the #8ECAE6 split, exactly like `sideColor`'s call badge.

`GRADE_NOTE`, verbatim (range hyphens ASCII, clause separators em dashes):

- **A+** `85-100 pts — a big gain was on offer, it was cheap to hold, and it finished well.`
- **A** `72-84 pts — a real move (roughly +50% or better) without punishing heat.`
- **B** `58-71 pts — a tradable pop, or a bigger one that took real drawdown first.`
- **C** `44-57 pts — small gain on offer, or a decent peak paid for with heat.`
- **D** `28-43 pts — barely ticked green before it rolled.`
- **F** `Under 28 pts, or never traded green at all — no exit was ever on offer.`

`gradePillTitle(info, provisional)` = `GRADE_NOTE[grade]` + `\n` + `info.why` + (provisional ? `\n` + `Provisional — the session is still live, so peak/close can still move.` : `''`). `provisional` is `!frozen` at all three call sites, and a provisional pill appends `GRADE_PILL_PROVISIONAL_MARK` = `·` (U+00B7).

`projPillTitle(grade, pts)` is the tab's only cross-reference to Pick Study:

> `Projected {grade} ({pts}/100) at capture, from the rule in server-v2/config/pick-proj-rule.json. This is a prediction made before the pick did anything — compare it against the solid grade pill, and against the Pick Study tab's calibration table.`

`projGradeKey` colours an unrecognised grade string as **C** while still printing its raw text. "The projection is drawn hollow, dashed and prefixed on purpose: a prediction must never read like a result at a glance." Prefix literal: `proj`.

## THREE zero conventions, all on screen at once

The `// BUG (v2):` marker at §SIGN COLOURS:

| Site | Function | Rule | Zero reads as |
|---|---|---|---|
| Scorecard Peak % (C82) | `peakPctTableColor` | `>= 0` → up | **UP** |
| Card front headline (C102) | `peakPctCardColor` | `> 0` → up, else down | **DOWN** |
| Card back "now" (C104) | `pnlColor` | `> 0` up / `< 0` down / else neutral | **NEITHER** |

Plus a fourth: `deltaIsUp` coalesces a null `latest_chg` to 0 before testing `>= 0`, "so an em dash — the 'no data' glyph — is painted in the UP colour."

> All four are transcribed as separate named functions rather than collapsed, because collapsing them here would change what is on screen without anyone choosing to. Step 3 picks ONE rule and deletes the others.

A break-even pick is green in the table, red on the front and white on the back, **at the same moment, for the same contract.**

Other sign functions:

| Function | Row | Rule |
|---|---|---|
| `closePctTableColor` | C85 | `>= 0` up — and C62's "closed green" COUNTER is strict `> 0`, so the colour and the count disagree about a flat close |
| `pctOpenColor` | C118 | null neutral, `>= 0` up |
| `avgPeakColor` | C58 | **NULL IS PAINTED DOWN**, and prints an em dash |
| `neverGreenColor` | C70 | any non-zero DOWN; exactly zero UP |
| `sideColor` | C77/C126 | anything not `'P'` paints as a call, **`null` included** |
| `slotHeaderColor` | C92 | live → `V2.cyan`, scheduled → `V2.orange` |

The INK paragraph records the three-way split of v2's `HOME_THEME.green` #8ECAE6:

```
chrome    #8ECAE6  V2.green   headers, subtitle, the call badge, the A+/A pill
accent    #7dd3fc  V2.accent  the tab pills (scannerNav.ts)
positive  #1FD98A  V2.up      the sign-driven functions
```

> A `<th>` reading "Peak %" was painted the same value as a +140% peak underneath it. That collision is the ONE thing this port breaks.

## Formatters (C17–C27)

| Fn | Output | Notes |
|---|---|---|
| `fmtBig(v)` | `-8.6M`, `1.2B` | **No sub-1M branch.** A Δ of 200,000 — exactly the ★ threshold — prints `0.2M`; 40,000 prints `0.0M`. ASCII hyphen, no `$` |
| `fmtStrike(v)` | `5,900` / `5900.5` | Integer → `toLocaleString`, fractional → bare `String(v)` |
| `fmtSpot(v)` | 2dp | `!(v > 0)` also catches 0 and NaN |
| `fmtPx(v)` | 2dp, no `$` | |
| `fmtGex(v)` | `+$1.20M`, `−$340K` | **U+2212 minus**, unlike `fmtBig`'s ASCII. Zero takes `+`. Tiers B(2dp)/M(2dp)/K(0dp) |
| `fmtPctSigned(v)` | `+34%`, `-7%` | Already-percent units, 0dp, `+` on non-negatives, zero → `+0%` |
| `slotLabel(slot)` | `10:30 AM ET` | `00:30`→`12:30 AM ET`; a slot with no `:` substitutes `00` |
| `capturedLabel(day, slot)` | `Jul 30 · 10:30 AM ET` | U+00B7. A day not matching `YYYY-MM-DD` **exactly** (including `""`) returns just the time |
| `fmtClock(ts)` | `1:42 PM` | **Pinned to ET**, no zone suffix printed |
| `ago(ts)` | `42s ago` / `6m ago` / `3h ago` | Recomputed only on render — a card left open shows a frozen value |
| `isRth(ts)` | boolean | Weekends false; 09:30 ET **inclusive** to 16:00 ET **exclusive**. **Holidays are NOT excluded** |

Two conventions on one tab: `fmtBig` uses ASCII `-`, `fmtGex` uses U+2212. "Both are copied because both are already on screen."

`capturedLabel` guards the month lookup with `String(MONTHS[…])` rather than `?? ''`:

> under `noUncheckedIndexedAccess` an out-of-range month is `undefined`, and v2's template literal printed the word "undefined". Substituting an empty string here would be a silent behaviour change.

## The toolbar (C46–C50)

Rendered into `Card`'s `actions` slot, left to right:

1. **`DatePicker`** (`size="sm"`, `title="Capture date"`, `label={v => v}`). Shows `Date` for a beat on first paint until the feed echoes a date back. v2's blank `mm/dd/yyyy` was the OS field's placeholder; "that field is gone: the platform calendar it opened was the one control in this toolbar that was not ours to paint."
2. **`Refresh`** (`REFRESH_LABEL`) — **never disabled, even mid-load.** Calls `top.refetch()` and `res.refetch()`.
3. **Flip all** — `⟳ Flip all (12)` / `⟲ Flip back`. Disabled when `flippableCount === 0`. Titles: `Turn every probed card over to its price line` / `Turn every card back to the pick`. When all are flipped the button wears `V2.cyan` with `alpha(V2.cyan, 0.5)` as its border.
4. **The gate**, in a bordered `<span>` whose border is `alpha(V2.cyan, 0.35)` when any switch is on, else `V2W.border`. Label `Gate` (`text-3xs font-semibold uppercase tracking-wide`) carrying the four-sentence tooltip about view filters. Then one `ToolButton` per `GATE_TESTS` entry labelled `` `${t.label} −${counts.alone[t.key]}` ``, and when the gate is active a trailing `−{hidden} of {total}`.
5. **The hint** (`TOOLBAR_HINT`): `click a card for its option price line`.

## The scorecard (C54–C87)

Section header row, in order: **`Scorecard`** (`text-base font-extrabold`, `V2.orange`) → a freshness `StaticPill` → the summary line → a flex spacer → the cheap toggle → the show/hide chip.

**The freshness pill** is `EOD · final` when `frozen`, else `live · peak so far`. **NOT a button** — v2 gives it no click handler and forces `cursor: default`. `frozen` defaults to false, so a failed `/results` load shows the LIVE wording "rather than admitting it has nothing". `frozenRef` in the tab holds the last-good flag because `useQuery` replaces `data` wholesale.

**The summary line** is omitted entirely at zero picks. Format:

```
{n} picks ({basis}) · avg peak {±N%} · ≥+25% {n} · ≥+50% {n} · ≥+100% {n} · closed green {n}
```

`scorecardBasisLabel` = `entry > $0.50` (or `all entries` when `scoreCheap`), with the active gate's conditions **appended, not substituted** — "the entry floor still applies underneath them and the line has to say so."

### WATCH THE DENOMINATORS

Three populations, three different stories about the same date:

- `avgPeak` and `hit25` / `hit50` / `hit100` are over **`withPeak`** = `filtered.filter(r => r.max_pct != null)`. A pick with no `max_pct` is in neither numerator nor denominator.
- `greenClose` is over **`filtered`**, and is `close_pct != null && close_pct > 0` — **strict**. So a pick with no close counts against it, and a flat close is not counted while C85 paints that same flat close in the UP colour.
- `gpa` and `neverGreen` are over **`graded`**, which drops any row `gradeFor` returned null for.

### The entry floor

`ENTRY_FLOOR = 0.5`.

> Below this a contract's % moves are an artifact of tick size, not a tradable result — $0.05 to $0.20 is "+300%". Applied to the hourly cards AND the scorecard so the two never disagree about which picks exist.

Two comparators that are exact complements: `filterResults` keeps `entry > 0.50` (strict), `cheapIdsFrom` takes `entry <= 0.50`. A row with `entry == null` is dropped in **both** modes.

`countCheapCards` counts **cards on screen**, not scorecard rows: "If `/results` has sub-floor rows but `slots` is empty for that date this is 0 and the cheap-entry toggle never renders at all." It is computed over `viewSlots` (post-gate), not `slots`.

The cheap toggle only renders when `cheapCards > 0 || scoreCheap`, and reads `score ≤ $0.50 too (N)` / `exclude ≤ $0.50`. Its tooltip:

> `{N} cards on this date entered at $0.50 or less. Their % moves are tick-size artifacts, so they are left out of the ranking and the averages by default.`

### The grade distribution strip (C66–C70)

Gated on `showResults && !resErr && summary.graded.length > 0`. Renders `Grades`, then all six letters **in `GRADE_ORDER`, always** — a zero count still renders at `opacity: 0.3`. Chips are `rounded-sm border px-1.5 py-0.5 font-mono text-xs font-bold leading-none` with `color: GRADE_COLOR[g]`, `borderColor: alpha(…, 0.4)`, `background: alpha(…, 0.12)`.

Then `avg {gpa}/100` in `V2.cyan` and `never green {n} ({p}%)` inked by `neverGreenColor`. The never-green tooltip:

> `Picks whose best post-flag mark never printed above the entry — they went straight to red and stayed there.`

`fmtGpa`'s `null → "—"` branch is documented as **unreachable and kept anyway**:

> The whole distribution strip is gated on `graded.length > 0` and `gpa` is `graded.length ? … : null` — so by construction every render that can reach this function has a number for it… it is transcribed rather than dropped because deleting it would move a null check out of this file and into whatever calls it.

### The twelve columns (C74–C86)

**There is NO sort on any of them: no key, no default column, no direction, no comparator, no tie-break and no click handler.** Rows render in the server's array order.

| # | key | Header | Align | Cell |
|---:|---|---|---|---|
| 1 | `grade` | Grade | left | `<GradePill info={gradeFor(r)} provisional={!frozen} />` — an ungraded row leaves the cell **EMPTY**, no dash |
| 2 | `symbol` | Symbol | left | `font-extrabold` |
| 3 | `contract` | Contract | left | `{strike}{side}` in `sideColor(r.side)` + expiry in `T.text`. Anything not `'P'` — **null included** — is call-coloured |
| 4 | `flagged` | Flagged | left | `slotLabel(first_slot)` with `' ET'` stripped, plus `×N` when `slots > 1`. The multiplier is **not** visually distinguished |
| 5 | `entry` | Entry | right | `fmtPx(r.entry)` |
| 6 | `peak` | Peak | right | `fmtPx(r.max_mark)` |
| 7 | `peakAt` | Peak at | left | `fmtClock(r.max_ts)` |
| 8 | `peakPct` | Peak % | right | `fmtPctSigned(max_pct)`, `font-extrabold`, ink `peakPctTableColor` (`>= 0` up) |
| 9 | `perContract` | $/ct | right | `(max_mark − entry) × 100`, `+$412` / `−$88` (U+2212), 0dp. **Never coloured by sign**, unlike Peak % beside it. Strictly from `r.max_mark`, unlike the card's version |
| 10 | `close` | Close | right | `fmtPx(r.close_mark)` |
| 11 | `closePct` | Close % | right | `fmtPctSigned(close_pct)`, ink `closePctTableColor` |
| 12 | `lowPct` | Low % | right | `fmtPctSigned(min_pct)` — **NEVER coloured.** A −60% MAE is the same ink as a −2% one, "even though it is the pain ladder's whole input" |

Row key is `` `${watch_id}-${first_slot}` `` — "`watch_id` alone is not unique across first slots."

Headers take the `Table` primitive's own `text-muted` rather than `V2.green`:

> these headers stay on the primitive because the scanner does not own `Table`… that is the one unresolved divergence on this tab.

**Footnote (C87)**, rendered only when `filtered.length > 0` so it never sits under the empty state:

> `Entry = the auto-probe mark at the slot the strike was first flagged. Peak / Low / Close are measured from that entry, over snapshots taken after it — the best exit that was actually on offer, not a fill.`

### Empty states, verbatim

`scorecardEmptyCopy(totalResults)` picks one:

- `totalResults === 0` → **`No scored picks for this date yet — rows appear once picks have been auto-probed and snapshots start landing.`**
- otherwise → **`No picks above the $0.50 entry floor for this date — use “show ≤ $0.50” above to include them.`** (curly quotes U+201C/U+201D)

And the second one names a button that does not exist:

> VERBATIM FROM v2, INCLUDING ITS ERROR… the real toggle reads "score ≤ $0.50 too (N)" and only renders at all when `cheapCards > 0 || scoreCheap`, so the copy can point at nothing. Spec row C72 says to fix the string in the port; `SCORECARD_EMPTY_BELOW_FLOOR_FIXED` below is that fix, left as a separate export so step 3 makes the swap deliberately rather than inheriting a paraphrase.

The fixed string exists and is **deliberately not used**: `No picks above the $0.50 entry floor for this date — use “score ≤ $0.50 too” above to include them.`

**Scorecard error line** (`Scorecard error: {msg}`) renders **outside** the show/hide gate, and when set it suppresses the strip, the empty state and the table.

**Show/Hide** (`showResultsLabel`, default **shown**) hides the strip, the empty state and the table; it does **not** hide the title, the pill, the summary line, the toggles or the error line.

## The slot sections (C90–C95)

Rendered from `viewSlots` in **server array order**. Per section:

- `slotLabel(bucket.slot)` at `text-base font-extrabold`, inked cyan for a live-trigger section and orange for a scheduled capture;
- when `bucket.live`, the badge `⚡ LIVE TRIGGER` (`rounded-sm border px-1.5 py-px text-2xs font-extrabold tracking-wide`, `V2.cyan` on `alpha(V2.cyan, 0.12)` with a `0.45` border), tooltip:

  > `Filed the minute this strike crossed into ★ Very strong, by the recorder's 60s trigger scan — not a scheduled top-5 capture.`

  and the reason it exists:

  > A live section is a CROSSING, not a leaderboard: it usually holds one or two cards, and the badge is the only thing that stops that reading as four missing picks.

- `{n} picks` / `1 pick`;
- the grid: `grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5` — "v2's five-then-3/2/1 grid, on the standard breakpoints rather than its four hand-written px media queries."

Feed error line (C88) renders **even while loading** and suppresses C89. Format: `Error: {msg}`, `V2.red`.

The no-slots node (C89) has three cases:

1. loading → `Loading…`
2. `slots.length > 0` but the gate emptied them → `gateHidAllCopy(total, on)`:
   `The gate hid all {N} picks on this date. Nothing recorded here cleared {labels joined by " and "} together — switch one off to see which.`
3. otherwise → `No very-strong picks recorded yet for this date. The recorder files a strike the minute it crosses into ★ Very strong, and captures the top 5 every 30 min during RTH.`

> Without the distinction the switches read as a broken fetch. It names the active conditions on purpose: at this point the answer is almost always "one of these is too tight", and the line should say which are on so the next click is obvious.

## The pick tile — three boxes, and each has to be the box it is

```
tile      position: relative · minHeight 260 · perspective 1200
  └ flipper   position: absolute · inset 0 · preserve-3d · rotateY(0|180)
      ├ front   position: absolute · inset 0 · backface-visibility hidden
      └ back    the same, plus its own rotateY(180deg)
```

| Const | Value | Why |
|---|---:|---|
| `FLIP_PERSPECTIVE` | `1200` | On the TILE, not the flipper: "it has to come from an ancestor of the rotating box. On the flipper itself the rotation is orthographic and the card reads as a horizontal squash, not a turn." |
| `FLIP_MIN_HEIGHT` | `260` | Sized for the TALLER face (header + sub + headline + "now" + toolbar + a fixed 96px chart + hint). Both faces are `inset: 0`, so this one number is the tile's height whichever way up it is — "that is what stops a flip resizing the card or reflowing the grid." |
| `FLIP_TRANSITION` | `transform 0.32s ease-out` | Compositor-only: no layout, no paint, no main-thread work per frame |
| `FLIP_TRANSITION_NONE` | `none` | Reduced motion. Not `transform 0s`: "`none` also removes the `transitionend` and the compositor layer promotion, so the face swap is a single style recalc." |

> The flipper MUST be `absolute + inset: 0`. Both faces are absolutely positioned against it, so left in normal flow it has no in-flow children, computes to zero height, and the whole tile collapses. (v2's own comment, and it is the first thing that breaks if someone "simplifies" this.)

`FACE_STYLE` sets `borderColor: V2W.border`, `background: V2W.panelBg`, and `backfaceVisibility: 'hidden'` (+ the `-webkit-` prefix). The last one is load-bearing:

> It is what makes a face turned away from the viewer drop out of BOTH the paint and the hit test — without it the flipper shows the front and the mirrored back stacked on top of each other, and the turned-away face still swallows clicks.

The back is `{ ...FACE_STYLE, transform: 'rotateY(180deg)' }`; both carry `FACE_CLASS = 'absolute inset-0 overflow-hidden rounded-md border'`. Padding differs: front `12/14`, back `px-3 py-2.5` (10/12).

`data-flip3d="front"|"back"` is still written on the flipper and **nothing reads it**:

> Capture is NOT ported and nothing reads it. It stays because the tile is a real two-face 3D flip and the attribute is the only place the DOM says which face is actually facing the viewer — a `transform` matrix does not tell you that at a glance.

### Reduced motion (C16)

`useReducedMotion()` is called **once, at the tab**, and threaded down:

> a hook per tile would put ~65 `matchMedia` listeners on one media query for a boolean that is identical in all of them.

`window.matchMedia?.(…)` is optional-chained — an old browser without it leaves `reduceMotion` false, i.e. the animation plays, which is v2's fallback. Reduced motion is an instant face swap: "the rotation still happens, it just takes no time."

### Card identity — two different keys

```ts
cardId(row, slot)      = `${symbol}-${strike}-${slot}`        // flip / open / capture key
cardRenderKey(row)     = `${symbol}-${expiry}-${strike}`      // the React key
```

> `cardId` OMITS `expiry`… Two different expiries on the same symbol and strike inside one slot would therefore SHARE flip state and open state while rendering as two tiles. Transcribed as written; adding `expiry` here would be a silent behaviour change to which cards turn over together.

### The derived values (`derivePickCard`)

| Field | Source |
|---|---|
| `side` | `deriveSide` — strike **below** spot ⇒ put; a null or zero spot ⇒ call. The scorecard uses the SERVER's `r.side` instead, so the two can disagree about the same contract on the same screen. Neither is authoritative |
| `up` | `deltaIsUp(latest_chg)` — null coalesces to 0, reports UP |
| `otmPct` | `Math.abs(strike − spot) / spot × 100`, unsigned. A strike either side reads "OTM". Null when spot is falsy or ≤ 0, and the span is then omitted entirely |
| `entry` | **scorecard first** (`entryById`), `hist.contract.added_price` second, null last |
| `entryTs` | scorecard `entry_ts` |
| `peakMark` / `peakTs` | scorecard `max_mark` / `max_ts`, else a client fallback scan over `points` that never counts a mark from before `entryTs` |
| `peakPct` | scorecard `max_pct`, else `((peakMark − entry) / entry) × 100` (guarded against `entry === 0`) |
| `peakDollars` | `(peakMark − entry) × 100` — **may use the fallback peak**, unlike the table's `$/ct` |
| `lastMark` / `lastTs` | **TWO INDEPENDENT reverse scans.** The timestamp can come from a LATER point than the mark when the newest snapshot has a null mark |
| `pnlPct` | `((lastMark − entry) / entry) × 100` |
| `trigLabel` | `fmtClock(entryTs)`, else `slotLabel(slot)` minus `' ET'` — "for a LIVE card the slot IS the minute it crossed, so the fallback is meaningful rather than a placeholder" |
| `underFloor` | `wid != null && cheapIds.has(wid)` |
| `grade` | `gradeFor(resultById.get(wid))` — the SAME scorecard row the entry basis came from |
| `captured` | `capturedLabel(date, slot)` |

**The entry basis is the point of the function**, and the bug it fixes is named with a real contract:

> `watch_options.added_price` is write-once at a contract's FIRST-EVER probe — `/api/watch` upserts on ticker+expiry+strike+side and only writes the mark when the row is NEW — so a strike already in the watch pipeline from an earlier day keeps that day's mark forever. A re-flagged pick charted today then read as a huge loss it never took: PLTR 250814 180C carried a 1.72 basis from a 3-DTE probe while the session it was re-flagged in never traded above ~1.00, printing −80% on a card whose slot stamp said 10:30 AM.

Because `points` is RTH-filtered at fetch time, **"now" on the card back means "the last RTH snapshot", not wall-clock now.**

### Front face, in render order (C109–C124)

`rank` (inside the symbol span, 6px apart, same ink) · `symbol` · `strike` (top right) · **`delta`** — the headline, `fmtBig(latest_chg)`, inked by `deltaColor` · `grade` pill (larger size) · `expirySpot` = `{expiry} · spot {n}` · `captured` = `captured Jul 30 · 10:30 AM ET` · `otm` = `OTM 3.4%` (one decimal; **omitted entirely when spot is null/≤0**) · `pctOpen` = `+34% vs open` (the span renders even when null) · `score` = `score 84` / `score —` (server-computed) · `projGrade` (renders nothing when `proj_grade` is null — the default) · `veryStrong` = `★ Very strong` (**every card carries it; there is no second tier**) · `underFloorBadge` = `≤ $0.50 · unscored` (only when `underFloor`) · `priceLineHint` = `▸ price line` (only when `watch_id != null`).

`underFloorTitle`: `Entered at $N.NN — at or under the $0.50 floor, so it is left out of the scorecard ranking and averages.` The `?? 0` fallback is v2's and is unreachable in practice.

Tile `title=`: a row with no `watch_id` has **no tooltip at all**, because it is also not clickable. Otherwise `Chart {symbol} {strike}{side}` or, when flipped, `Back to the pick`.

### Back face, in render order (C125–C138)

`symbol` · side badge `{strike}{side}` (coloured by the CARD's derived side, which can disagree with the table's) · `×` close (`CARD_CLOSE_GLYPH`, U+00D7 — "the flip control, not a capture control, so it stays") · sub line `{expiry} · {captured}` · **peak headline** `▲ 142.9%` (ONE decimal, the glyph carries the sign) · the word `peak` · grade pill (default size) · `in {entry} {trig} → high {peak} {peakTs} · +$412/ct` · **`now`** at 0.7 opacity · the `1D` range pill (**NOT a control** — "the recorder's snapshots are one session") · the metric toggle · the chart · the chart hint.

`fmtNowPct` = ` · +12%` / ` · −7%` (U+2212, 0dp). `fmtPeakDollarsClause` = ` · +$412/ct` (U+2212 for negatives).

`chartHint` restates the IN/HIGH line in one line "so a cropped screenshot of the chart still carries the entry and the peak":

```
{price (mark)|net gex @ strike} · RTH · in {entry} {trigLabel} · high {peakMark} {peakTs} · {ago(lastTs)}
```

The back face is where the history fetch lives, and that placement is deliberate:

> it must not happen until a card is opened. ~65 tiles fetching a session's snapshots at mount is the request storm C14 and C15 exist to prevent. That is also why this component IS the face rather than something rendered inside one: mounting it and mounting the fetch are the same event.

### The metric toggle

```ts
export const METRICS = [{ key: 'mark', label: 'Price' }, { key: 'net_gex', label: 'Net GEX' }]
export const DEFAULT_METRIC: Metric = 'mark'
```

> ONE metric for the WHOLE tab, not one per card. Switching it on one open card switches every open card at once. Persists to nothing.

## Flip state and the open-card poll

`flipped` and `opened` are two separate `Set<string>` of `cardId`s.

- `toggleFlip` flips `flipped` and **adds** to `opened`, never removing: "a back face that has already loaded its history stays mounted and a second flip costs no request."
- `flipAll` when already all-flipped clears `flipped` and **leaves `opened` alone**.
- `onDateChange` clears **both**, but not the history cache — "it is keyed by `watch_id` inside `query()`, so a strike that appears on two dates does not refetch."

```ts
export const OPEN_CARD_POLL_MAX = 8
const historyPollMs = openCount > 0 && openCount <= OPEN_CARD_POLL_MAX ? POLL_MS : undefined
```

> Above this many open (face-down) cards the per-card history refresh stops entirely. After a "Flip all" there can be ~65 open cards and re-polling all of them would be 65 requests/min against the proxy for charts nobody is reading; beyond this the data loaded on open stands until Refresh. A hand-rolled rate limiter standing in for a batched history endpoint.

`FLIP_ALL_WAVE_SIZE = 6` survives as a number only — the recursion is gone because `query()`'s dedupe and cache do what the wave scheduler hand-rolled. "The NUMBER is kept because it records the rate ceiling the proxy was being protected by."

## The back face's chart (C139–C153)

Mounted through `ChartFrame`, drawn imperatively into an SVG the frame owns. **SVG, not canvas** — so there is no `data-cb-layer` to place, and "SVG keeps the tokens as `var()` strings instead of forcing a resolve."

**Geometry (v2's, to the pixel):**

```ts
GEO  = { W_MIN: 160, W_FALLBACK: 240, H: 96, PADL: 44, PADR: 8, PADT: 6, PADB: 16 }
CHIP = { H: 13, CHAR_W: 5.4, PAD: 8, MIN_T: 30, MIN_V: 26 }
```

`5.4` is v2's per-character width estimate for the mono face; the value chip is capped so it never spills into the plot. The viewBox is the box's REAL pixel width at a FIXED pixel height, "so one viewBox unit is one CSS pixel and tick text renders at its literal size." `chartWidth(boxW) = max(160, round(boxW) || 240)`. Wrapper is `h-24` — a **fixed height**, so "flipping a card can never reflow the grid around it."

**Maths:**

- `pickSeries(points, metric)` drops nulls and non-finites; the RTH filter already ran at fetch time.
- `MIN_CHART_POINTS = 2` — below this the chart is replaced by its empty state.
- `showEntryLine(metric, entry)` — the entry baseline draws on **Price only**. "Never on Net GEX, where an option mark means nothing against a gamma figure."
- `Y_PAD_FRACTION = 0.08`, applied to both ends. A flat series (min === max) is widened by ±1 **before** the padding, "so a constant line sits in the middle of the box instead of collapsing onto an edge."
- `Y_TICK_FRACTIONS = [0, 0.5, 1]` — **three** gridlines. Another code-vs-comment conflict: v2's `PickChart` doc comment says "5 gridlines with left-hand value ticks", inherited from the owner Probe page. THE CODE WINS.
- `chartValueLabel` — Net GEX takes the `$` form, Price is bare 2dp.
- `PEAK_MARKER_MAX_MS = 5 * 60_000`. `nearestIndexToTs` finds the NEAREST sample and returns null past that window: "more than five minutes from the scorecard's peak timestamp is a DIFFERENT event, and the marker is not drawn at all rather than pointed at the wrong bar." Nearest, not exact, because "the scorecard reads `watch_snapshots` straight while these points are RTH-filtered client-side, so the two series can be off by a sample." Callers pass `peakTs = null` for Net GEX.

**`// BUG (v2):` `chartTimeLabel`** uses the BROWSER's locale and timezone — an empty locale array and no `timeZone` option — while `fmtClock` pins ET:

> For a viewer outside New York the chart's axis and the "high @ 1:42 PM" stamp directly above it name different times for the same sample. Transcribed as written; step 3 decides whether the axis moves to ET or the stamp moves to local, but they must not stay split.

**The gradient id** was `id="gct-fill"` in v2, "declared inside every chart instance, so a Flip all put ~65 duplicate DOM ids on the page and every gradient reference resolved to the first one." v3 uses `useId()`.

### Two visibility gates, covering different things

1. **Scrolled out / background tab** → `ChartFrame`'s signal. This is an on-demand renderer, so `draw()` returns early on `!handle.visible()` and the `onVisibility(true)` edge repaints what was skipped. That signal is an IntersectionObserver plus `document.hidden`.
2. **Rotated away by the flip** → `backface-visibility: hidden`, **and only that.** The note is precise about why the first gate cannot do this job:

   > an IntersectionObserver does NOT see a turned-away face. `rotateY(180deg)` maps the border box to a rectangle of the same area in the root's coordinate space, so the observer reports the face as intersecting and `handle.visible()` stays true — the frame's gate is about the viewport, not about which way a box is pointing. `backface-visibility: hidden` is what makes the claim true, and it does it at two levels: the compositor drops the face from the paint entirely, and the face drops out of hit-testing, so a turned-away chart receives no `mousemove` and therefore does no crosshair redraws.

The back face also carries `inert={facingAway}` — "purely an interaction gate: it does not affect the paint, so the first half of a flip-back still shows this face rotating away."

Crosshair: `mousemove` maps to a nearest index **in viewBox units**, so it stays correct at any tile width; `mouseleave` clears it. Both listeners are attached natively in `onMount` and removed in its cleanup, alongside `root.remove()`.

`EMPTY_POINTS` is one frozen module-level array so "no history yet" is a stable prop identity "and does not re-trigger the chart's redraw effect on every render". `hist` is memoised so the RTH filter runs once per response, not once per render.

**Chart states, in order:** `loading history…` (requires `!points.length`, "so a refresh over existing points keeps the chart on screen instead of blanking it") → the error → the chart. Below two plotted samples: `not enough history yet —` / `snapshots accrue every minute through RTH` (two lines).

## The footer legend (C154–C158)

Four strings, all **display copy describing server behaviour**, none of it client logic:

- `Score = 0.6·|Δ| + 0.4·|% vs open|, normalized 0–100` (U+00B7 dots, U+2013 in the range)
- `★ Very strong` + ` = |Δ| ≥ $200k AND |% vs open| ≥ 30%` (both U+2265). This restates C45, which writes the same rule with `&` instead of `AND`; **both are on screen at once**
- `Every pick is auto-probed at capture — the flip side is its recorded option price since it was flagged`
- `Grade = 55 pts peak (best gain offered) + 25 pts pain (worst drawdown) + 20 pts close. ` + **`F`** + ` is automatic when a pick never traded green, whatever the rest of the row says.`
- `A dashed ` + **`proj`** + ` pill is what the projection rule predicted at capture — see the Pick Study tab for whether those predictions are holding up.` — gated on `anyProjected(slots)`, false whenever no rule is armed

The weights and thresholds are **deliberately not exported as numbers**:

> Exporting them would invite step 3 to filter or rank with them, which would put a second implementation of the recorder's rule on the client — and a client that disagreed with the server about which picks are ★ would be worse than one that simply reports what it was sent. If v3 ever needs the numbers, it needs a server field, not a constant here.

## What is not mounted on this tab

- `loadPickStudy` and `probeWatchAdd` — both `@notWiredInV2`, neither imported.
- The entire html2canvas capture surface: `⧉ Copy image` (C51), `📷 Screenshot` (C52), the filename `gex-change-top-{date|today}.png` (C53), the two per-card `📷` buttons with their busy / `✓ Copied` / `✓ Saved` lifecycle and 1800 ms reset (C109/C110/C127), and the `data-noshot="1"` / `data-face` / `data-card` attribute protocol.

  The reason each PNG lost its chrome is preserved: `[data-noshot="1"]` nodes were removed from the clone AFTER the live↔clone canvas pairing, "which is why the toolbar (C46), the slot headers (C91), the '▸ price line' hint (C123) and the capture buttons themselves are absent from every PNG — and therefore why each card carries its own `capturedLabel` stamp (C116)."

  And `[data-flip3d]`: html2canvas has no 3D pipeline and ignores `backface-visibility`, "so a face-down card rasterized as BOTH faces stacked with the back one mirrored."

  v3 has ONE owner-gated camera in the toolbar (`src/shell/CopyShot.tsx`) over a dependency-free engine (`src/shell/snapshot.ts`: clone the subtree, pin computed styles onto it, render through `<svg><foreignObject>`), which bakes its own title band plus "Data provided by CBEdge.net".
- The per-card `<img src="/cb-edge-logo.png">` watermark (C124).

---

# TAB 2 — GEX Levels (`?tab=gexlevels`)

## What it is

A header card (four stat tiles, two semi-gauges, two read-only filters, one refresh) followed by **twelve cards in two draggable columns**:

```
 1 oiDate        ·  2 eodGex      ·  3 eodGexEx0dte  ·  4 history
 5 oiExpiry      ·  6 netGamma    ·  7 netGammaAll   ·  8 netGammaEx0dte
 9 callPutGamma  · 10 netDelta    · 11 netDeltaEx0dte · 12 volFlow
```

Eleven of the twelve draw hand-rolled inline SVG — "they are small, they re-render on hover and on a pan that is already React state, and SVG keeps every colour as a `var(--color-…)` string instead of forcing a resolve." **Card 12 is the only canvas on the tab.**

## The ten non-obvious rules

1. **The OI+Vol basis.** Every gamma surface values a strike at `netGEX + netVolGEX` (`oiVolNet`) — open interest AND volume. Walls, flip, $Gamma and both EOD columns are all on that basis, "which is why they are comparable. The 0DTE NET DELTA card is the one exception: it is `netDEX` alone (basis `"oi"`). `dexOf` exists as ONE accessor so the two delta cards can never silently drift onto different bases again."
2. **The cumulative curve is computed over the WHOLE chain, then windowed for display.** "Running it over the visible slice instead would move the zero crossing off the real gamma flip, which is the entire point of the chart."
3. **Zero counts as positive, three times over**, and each is load-bearing: `curveSignOf(0) === 1`, the EOD bar ladder is `v >= 0`, and card 12's flip counter treats `0` as the positive side. "Do not 'fix' one without the other two."
4. **The sign segments interpolate their own crossing.** `signSegments` inserts a synthetic point at `cum === 0` between the two listed strikes that straddle it, "so the colour flips exactly at the flip rather than at the next strike in the chain."
5. **Today's history row is rewritten on a FIVE-FIELD test only.** `spot`, `r2`, `s2`, `openInt` and `curve` are written at the same time but are NOT in the test, "so those five cells can sit stale for a whole session while the row looks live."
6. **Two magnitude formatters, kept.** `fmtBn` ("1.24bn", "412.7M", ASCII minus, no K or T tier) formats every SVG axis, tooltip and history cell on cards 1–11; `fmtGex` ("1.24B", "−413K", U+2212, T/B/M/K) formats card 12's six tiles and its price axis. "They are DIFFERENT COLUMNS, not a duplication: card 12 is a shared component — the same panel renders on /home, where `fmtGex` mirrors the Levels strip's `fmtMoneyB`. Collapsing them here would silently re-format the home page."
7. **The 15s and 60s polls are not arbitrary.** `/proxy/gex` is a live 0DTE feed (15s); `/proxy/gex-by-strike-multi` is one upstream fetch PER EXPIRATION and is server-cached ~60s, "so polling it faster buys a cached body"; `/proxy/gex-vol-flow` polls at 15s = half its 30s bucket, "so a newly written bucket appears within one poll instead of up to a bucket late."
8. **OPRA open interest is a once-daily value**, posted ~06:30 ET and reflecting the prior close. The OI-by-expiration card does not ride the 15s poll at all: it caches per ET DAY in localStorage and only its own Refresh forces a re-pull.
9. **A session with a null on the chosen EOD basis is DROPPED, never plotted as zero**, and the count of dropped sessions is disclosed — "a silently short chart reads as 'the market was quiet', not as 'those rows have no value for this column yet'."
10. **Card 12's % series autoscale always contains 50.** "Pure data-fit would make a 58–64 day look like a regime war; a hard 0–100 would flatten the same day into a straight line."

## The data path — six endpoints, two polls

| Const | Path | Params | Poll | Stale |
|---|---|---|---:|---:|
| `EP_GEX` | `/proxy/gex` | **none at all** | `GEX_POLL_MS` 15 000 | 10 000 |
| `EP_GEX_BY_STRIKE_MULTI` | `/proxy/gex-by-strike-multi` | `?symbol=$SPX` | `GEX_MULTI_POLL_MS` 60 000 | 10 000 |
| `EP_EOD_GEX` | `/api/eod-gex` | `?symbol=%24SPX&limit=30` | **none** | 10 000 |
| `EP_GEX_LEVELS_HISTORY` | `/proxy/gex-levels-history` | `?limit=3650` | **none** | 10 000 |
| `EP_CHAINS` | `/api/chains` | `?ticker=…&expiration=…&range=all` | **none** | `CHAINS_STALE_MS` = **0** |
| `EP_GEX_VOL_FLOW` | `/proxy/gex-vol-flow` | `?bin=30&session={rth\|eth}&{scope=all\|scope=front\|expiry=<iso>}` | `VOL_FLOW_POLL_MS` 15 000 | 10 000 |

`gexLevelsPreloadUrls()` returns the five that need nothing from another response: `/proxy/gex`, the multi sweep, `/api/eod-gex`, the history log, and the flow feed at `(front, rth)`. **`/api/chains` is absent on purpose.**

### `/api/chains` gets a ZERO in-memory window

> the real cache is the per-ET-day localStorage entry (`readFreshOiExpiryCache`), and the only thing that ever gets past that is the card's Refresh, which exists precisely to force a re-pull. An in-memory window would swallow it.

### The waterfall is real and it stays

> `/api/chains` cannot be addressed without an EXPIRATION, and the only thing that hands the client a list of expirations is `/proxy/gex`'s `expirations` field. It is not a value the client already had; it is data, so this is not the artificial waterfall v3 non-negotiable 4 is about.

`oiExpiryTargets()` takes the expiration list as an **argument**, "which is what lets the route fire this without waiting on a render."

### The `d`-gate is a render decision, not a data one

> In v2 all twelve cards live inside `{d && (…)}` — the gate being `d != null`, which needs BOTH `rows.length > 0` AND `spot > 0`. So a `/proxy/gex` outage blanks the four cards that have their own data source and may be answering perfectly: both EOD boards (`/api/eod-gex` outright), and Open interest by date and the history log, which read the persisted log for every PRIOR session and take only TODAY's row from the live derivation. A blank chart where nine sessions of history are sitting in localStorage. Every loader below is INDEPENDENTLY AWAITABLE and `loadGexLevelsEntry` settles them separately… Nothing in this file gates anything on anything.

The render layer reproduces it deliberately and marks the one-line exit:

> lifting the gate is deleting the `d &&` on the next line and nothing else. Brandon's call, not this step's.

### Other documented data behaviour

- **Null and zero are different on the EOD feed.** `total_gex_ex0dte` / `total_gex_0dte` are coerced `o.x == null ? null : (Number(o.x) || 0)`, "so a row that predates the column stays NULL and the chart DROPS that session rather than plotting it at zero on the wrong basis." `spot` and the date get no such treatment. `date` is truncated to ten characters and then used as the filter, so a row with no date is dropped entirely. The sort is `localeCompare` **ascending** — "the API answers newest-first and the chart wants oldest → newest, left → right."
- **The multi feed ships slim rows** — `{strike, netGEX, netVolGEX, netDEX, volNetDEX}` — and `multiRow` zero-fills the rest. "The zero-fill is what lets the shared chart components stay untouched — and it is silently lossy: a call/put gamma surface pointed at one of these ladders would draw nothing. Nothing points one at it."
- **Two failure modes on the flow feed.** `ok:false` clears the series **and still advances the updated stamp**; a thrown request keeps the last good series under the error scrim and does **not** advance the stamp.
- **The server history feed fails completely silently**, and an EMPTY server answer is DISCARDED rather than merged: "a dead endpoint reads as 'Logging starts as soon as a level moves.' rather than as an outage."

### The departures

1. **`/api/eod-gex` is requested ONCE instead of twice.** v2 mounts an `EodGexPanel` per EOD card and each owns its own `useEodGex(30)`, so identical params went out twice on every mount and twice more on every Refresh. `query()` keyed on the URL collapses it. "Both cards still choose their own BASIS client-side, which is what they always did — the basis was never a request parameter."
2. **`{cache:"no-store"}` + five hand-rolled intervals become `staleMs` + `pollMs`.** There is **no `AbortController` anywhere in either v2 file**; `query()` "makes the race unwinnable a different way, by ADDRESSING STALENESS WITH THE URL."
3. **The polls now pause on a hidden tab**, and card 12's wake-on-visible tick — "the tab's only `document.visibilityState` reference, and the one that made a poll MORE eager rather than pausing anything" — comes free.
4. **A LOSS:** the multi feed's Content-Type guard cannot be reproduced exactly. v2 inspected `res.headers` BEFORE parsing, so an un-redeployed server-v2 got a sentence instead of `Unexpected token '<'`. `loadGexByStrikeMulti` recovers it by mapping the two error shapes that reach it (a 404 status in the thrown message, or a JSON `SyntaxError` from an HTML body served with a 200) back onto v2's string. "It is a heuristic on an error message where v2 had a header."

## The colour collapse, reversed (2026-09-03)

This tab paints **two positives on adjacent cards, on purpose**:

- **`V2.pos`** — v2's `GEX_POS_GREEN`, "declared in v2 *precisely because* `.green` is a blue". The GAMMA surfaces only: the cumulative curve and its fill, the per-strike gamma bars, their legend swatches, and the gamma-bars flip line.
- **`V2.accent`** — v2's `LIGHT_BLUE`. The DELTA / OI / EOD surfaces, both gauge positive bands, the Resistance tile, the call leg, and the two gamma charts' spot lines.
- Every v2 negative is **`V2.red`** — signs, error lines and both ends of the CPG ladder alike.

The per-marker treatments are v2's again, not one each:

| Marker | Const | Colour · dash · opacity | Note |
|---|---|---|---|
| Spot, cumulative (card 6) | `SPOT_LINE_CURVE` | `V2.accent` · `2 3` · 0.6 | B199 |
| Spot, bars (cards 7/8) | `SPOT_LINE_BARS` | `V2.accent` · `2 3` · 0.75 | B228 |
| Spot, white (card 11) | `SPOT_LINE_WHITE` | `T.text` · `2 3` · 0.6 | B239/B249. Card 11's legend Spot swatch is the only white one on the tab |
| Flip, cumulative | `FLIP_LINE_CURVE` | `T.text` · `2 3` · 0.55 | **drawn whenever finite — B198 has NO in-view guard** |
| Flip, bars | `FLIP_LINE_BARS` | `V2.pos` · `4 3` · 0.55 | in-view only (B227) |
| Flip, sparkline | `FLIP_LINE_SPARK` | `T.text` · `2 2` · 0.45 | in-view only (B168) |

`VIOLET` — v3's dedicated flip token — is **still not taken**: "it would put a hue on this tab that v2 never painted here."

Ladders:

| Fn | Rule |
|---|---|
| `signColor(sign)` | `> 0` → `V2.pos`, else `V2.red` |
| `signAreaFill(sign)` | `alpha(signColor, 0.2)` — v2 appended a `33` hex byte |
| `gammaBarColor(v)` | `v >= 0` → `V2.pos` (cards 7 & 8) |
| `deltaBarColor(v)` | `v >= 0` → **`V2.accent`** (cards 10 & 11) |
| `eodBarColor(v)` | `v >= 0` → `V2.accent` (cards 2 & 3) |
| `CALL_LEG_COLOR` / `PUT_LEG_COLOR` | `V2.accent` / `V2.red` — "these are not signs — raw callGEX is positive and raw putGEX negative by construction" |
| `OI_BAR_COLOR` | `V2.accent` — "OI is never negative, so this is a SERIES colour and not a ladder" |
| `ERROR_INK` | `V2.red` on all five error lines |
| `pctInk(v)` | card 12's % series: `>= 50` → `V2.up`, else `V2.red`. **This is the one place on the tab where v2 painted a SIGN with #8ECAE6**, so it takes the positive leg |

## The header card

**Title:** `` `${symbol ?? 'SPX'} · GEX Levels` ``
**Subtitle:** `` `${expiry ?? '0DTE'} expiry · spot {2dp} · as of {HH:MM:SS AM/PM} ET` ``, or `loading live /proxy/gex snapshot…`
**Feed error:** `Feed error: {msg}` — rendered **whenever the feed errored, including alongside a stale `d`**, so the tiles keep showing the last good numbers underneath.
**Waiting state:** `waiting on /proxy/gex…`
**Footnote**, a sibling of the gated block so it shows under the waiting state too:

> `Single shared 0DTE feed — Stock/Expiry filters are read-only displays so this tab can't move the live feed everyone else is on.`

### `deriveGexLevels` — the live derivation

Returns **null** — which hides the whole card grid — when there are no usable rows or spot is not strictly positive. Rows are filtered `r && Number.isFinite(r.strike)` first:

> a socket frame can carry a null hole in `gexRows`, and reading `.strike` off it threw the "undefined (reading 'strike')" that killed the page.

| Field | Rule |
|---|---|
| `resistance` / `support` / `neutral` | `callWall` / `putWall` / `gexFlip` when finite, else null |
| `dollarGamma` | server's `totalNetGex` when finite, **else the client sum of `oiVolNet`**. "The UI never says which of the two it is showing" |
| `cpgRatio` | `Σ max(0, callGEX) / Σ \|putGEX\|`. **Returns 0 when the put book is empty** — which the gauge paints in its RED left band, "maximally put-heavy for a chain with no puts" (spec open question 5) |
| `r2` / `s2` | The 2nd-strongest wall each side: highest positive `oiVolNet` **above** spot / most negative **below**, excluding whichever strike already won #1. All three conditions strict |
| `totalCallOI` / `totalPutOI` | plain sums; `openInterestTotal` adds them |

Note the clamp: negative `callGEX` is clamped to 0 and `putGEX` is taken as an absolute — "the ratio is call-gamma over put-gamma-magnitude, not a net."

### The four tiles

| Tile | `TILE_COPY` | Accent | Scope chip | Value |
|---|---|---|---|---|
| Stock Price | `Stock Price` | `T.text` | — | `fmt2(spot)` |
| Resistance | `Resistance` | `V2.accent` | `0DTE` | `fmt0(resistance)` or em dash |
| Support | `Support` | `V2.red` | `0DTE` | `fmt0(support)` |
| Neutral | `Neutral` | `T.text` | `0DTE` | `fmt0(neutral)` |

The three tooltips exist because the page grew whole-board and ex-0DTE cards that print their OWN flip and walls:

> "two different numbers called Neutral and flip on one screen, with no scope on either, reads as a bug rather than as two honest measurements of different things."

- Resistance: `Call wall on the live feed's single expiry (±8% of spot). The ex-0DTE card lower down has the whole board's.`
- Support: `Put wall on the live feed's single expiry (±8% of spot). The ex-0DTE card lower down has the whole board's.`
- Neutral: `Gamma flip on the live feed's single expiry. The all-expirations and ex-0DTE cards lower down each report their own — they are not meant to match this one.`

### The two semi-gauges

`GAUGE_GEOM = { w: 200, h: 118, cx: 100, cy: 100, r: 78, needleFrac: 0.82 }` in SVG user units. `gaugeAngle(v, min, max)` clamps then maps to `π → 0` (left edge = min).

**$Gamma** auto-ranges: `span = max(500_000_000, |dollarGamma| × 1.4)` — "so the needle can never exceed ~71% of a half and never pins." Two bands, boundary at exactly 0: `[−span, 0]` red, `[0, span]` `V2.accent`.

> spec Part B is explicit that the `$Gamma` gauge's positive band is `LIGHT_BLUE`, not `GEX_POS_GREEN`, even though the gamma BARS beside it are.

**CPG Ratio** is a **fixed 0–2 scale** — a ratio above 2 clamps and pins hard right. Three bands: `[0, 0.7)` red · `[0.7, 1.3)` `V2.accent` · `[1.3, 2]` red.

> The middle band is BALANCED, not positive — it is v2's accent, never a green. Both extremes are `HOME_THEME.red`, which means the colour alone cannot tell call-heavy from put-heavy: this ladder is centre-good, not signed.

### The two read-only filters and the refresh

**Stock Filter** is a read-only PLATE, not a disabled input: "it has no `disabled` attribute in v2 either and is not focusable — it only looks like one."

**Expiry Filter** is a native `<select disabled>` — "as a native select rather than a portal'd menu that can never open (spec 'Do not port' 22)". Options are the snapshot's **raw `YYYY-MM-DD` strings in SERVER order**, unsorted and unformatted; the placeholder option is the live expiry.

**Refresh** ladder (`REFRESH_LABEL`, glyphs U+21BB / U+2713 / U+2717 / U+2026):

| state | label | ink |
|---|---|---|
| `idle` | `↻ Now` | `V2.cyan` |
| `refreshing` | `↻ Refreshing…` | `T.flat` — "v2 typed a bare `#888` here — not a named v2 constant, so there is nothing to point at" |
| `success` | `✓ Refreshed` | `V2.up` |
| `error` | `✗ Failed` | `V2.red` |

`REFRESH_LOCK_MS = 1800` — released this long AFTER the request settles, so a second click is a no-op for the whole request plus 1800ms. **The timer IS cleared on unmount here**; v2 never did, "so switching tabs mid-refresh fired a setState on an unmounted component. The value is the transcription, the leak is not."

## The twelve cards, one by one

Every card's title and subtitle come from `GEX_LEVELS_CARDS`, and the subtitles carry the **BASIS** of each surface — "the one thing that distinguishes cards 2/3, 6/7/8 and 10/11 from each other, so paraphrasing one makes two cards look like duplicates."

### Card 1 — Open interest by date (`oiDate`, left column)

Subtitle: `Total call+put open interest in CONTRACTS (not gamma dollars — no γ, no spot² here), one bar per trading day logged`
Endpoints: `proxy/gex-levels-history` + `proxy/gex` (prior sessions from the log, today's row from the live derivation).
Geometry: `{ w:720, h:220, padL:60, padR:16, padB:30, padT:18 }`. Bars 50% of the slot, min 4. Ticks: first, last, middle, or every bar at ≤ 8.
Empty: `Logging starts as soon as a level moves.` (shared verbatim with card 4).
Ink: `OI_BAR_COLOR` = `V2.accent`.

### Card 2 — SPX EOD GEX by session (`eodGex`, left)

Subtitle: `0DTE net GEX at the close on the OI+Vol basis — γ × (OI + volume) × spot², the same basis as the walls, the flip and $Gamma · last 30 sessions (eod_gex.total_gex_0dte, $SPX)`
`EOD_GEX_SYMBOL = '$SPX'`, `EOD_GEX_DAYS = 30`.
Geometry `{ w:700, h:240, padL:52, padR:12, padB:34, padT:16 }`, bars 60% of slot min 3, ticks every `ceil(n/10)`-th or all at ≤ 10.

**The zero line floats** (`eodZeroLine`): both signs → mid-plot with half the height each · only negatives → the TOP, the whole height below · only positives → the BOTTOM, the whole height above. "So a sign flip is visible instead of being squashed against an axis."

Status line: `Loaded {HH:MM} ET · {n} sessions (eod_gex.total_gex_0dte, OI+Vol)`, plus ` · {k} without this basis, not shown` when any session has a null on this basis (boundary `> 0`). Loading → `Loading…`; never loaded → em dash.
Empty copy for this basis: `no 0DTE OI+Vol rows yet — run scripts/backfill-eod-gex-0dte.js`.
Error: `EOD GEX error: {msg}`.
Legend: `Positive · Net GEX (0DTE, OI+Vol)` / `Negative · …`.
Tooltip carries `SPX close: {2dp}` and `{label}: {fmtBn}`.

### Card 3 — SPX EOD GEX (ex-0DTE) by session (`eodGexEx0dte`, left)

Subtitle: `Net GEX at the close across all listed expirations except 0DTE, same OI+Vol basis as the card above · add the two for the whole-chain total · last 30 sessions (eod_gex.total_gex_ex0dte, $SPX)`
Same panel, same single `/api/eod-gex` response, different `field`. Empty: `no ex-0DTE data yet`.

**Removed and not to be re-added:** the third basis `EOD_GEX_FIELD_META.totalGex` ("legacy, mixed basis") together with the `field = "totalGex"` DEFAULT on both `EodGexPanel` and `EodGexBarChart`:

> Genuinely dead: both call sites pass an explicit basis, so the strings "Net GEX (legacy, mixed basis)", "no eod_gex rows" and "eod_gex.total_gex — basis varies by source, reference only" never rendered. Its column is not chartable as one series at all — `eod_gex.total_gex`'s basis depends on which writer touched the row last.

### Card 4 — History of key level changes (`history`, left)

Subtitle: `One row per trading day — today updates live, prior days stay frozen`

`HISTORY_STORAGE_KEY = 'gexlevels-daily-history-v1'` (localStorage), `HISTORY_MAX_DAYS = 60` (**the WRITE cap only** — React state is not truncated, so server rows past day 60 still render), `HISTORY_FETCH_LIMIT = 3650` ("the server keeps this table forever; ten years of sessions is the practical ceiling").

`mergeHistory(server, local)` keys by date, freshest `t` wins per date, result sorted date **DESC**. A local row that wins keeps `curve: e.curve ?? cur?.curve ?? null`, "so a pre-curve local row cannot delete a curve the server already has."

**The five-field rewrite test** (`historyRowChanged`):

```
resistance !== · support !== · neutral !== ·
round(dollarGamma / 1e6) !== ·  |Δ cpgRatio| > 0.02  (STRICT)
```

`spot`, `r2`, `s2`, `openInt` and `curve` are written by `buildTodayHistoryRow` but **are not compared**. `applyTodayHistoryRow` prepends on a new trading day, rewrites in place when the test passes, "otherwise return the SAME array so nothing re-renders."

**The eleven columns:** Date (left) · **Curve** (center) · Price · Resistance · Support · Neutral · $Gamma · CPG · R2 · S2 · Open Int (all right).

> NO column carries a colour rule — a negative $Gamma reads as plain text with a hyphen, and CPG is plain despite the header gauge banding the same value red/blue/red. There is also NO SORT UI: row order is whatever the merge produced (date DESC) with today prepended at index 0.

The Curve cell is the only non-text one: a curve with more than one point renders the sparkline, anything shorter renders a dimmed em dash. Both get the same `title`:

> `Cumulative gamma$ across all strikes as of this row's last update — dashed line = Neutral (gamma flip)`

Sparkline geometry: `CURVE_SPARK_GEOM = { w: 104, h: 28, padY: 3 }`. Its domain always contains zero (`domainWithZero`), and a flat curve gets ±1.

Curve storage: `CURVE_POINTS = 48`, "small on purpose — it rides in localStorage AND in the `gex_levels_history.curve` JSONB column." `downsampleCurve` rounds the strike to 2dp and the cumulative to a whole dollar. `parseCurve` tolerates a JSON string and returns the array only when **more than one** point survives.

### Card 5 — Open interest by expiration (`oiExpiry`, right)

Subtitle: `` `${symbol} · nearest 12 listed expirations` ``
`OI_EXPIRY_MAX = 12`. Cache key `gexlevels-oi-by-expiry-v1:{symbol}` in localStorage, shape `{ date, symbol, rows }` where `date` is an **ET calendar day, not a TTL**.

`oiExpiryTargets` = lexicographic sort of the `YYYY-MM-DD` strings ("which is also chronological for that format"), then the nearest 12.

`loadOiByExpiration(symbol, expirations, force)` in v2's exact order:

1. **BAIL** (touching nothing) with no symbol or no expirations — "a snapshot that never lands leaves the card at 'no data yet' forever, which is v2's behaviour."
2. Unless `force`, answer from TODAY's cache **without a request**.
3. `oiExpiryTargets`.
4. `Promise.allSettled` over all twelve **at once**; only fulfilled legs kept, paired back to their target by INDEX.
5. If NOTHING resolved, throw `no expirations resolved` — the card's one error line. **A partial result is not an error.**
6. Write the cache, stamped with today's ET date.

`rejected` is reported back as new information v2 threw away: "a chart of 12 bars quietly becomes a chart of 9 with nothing saying so."

`sumChainOi` reads `open-interest` (falling back to `openInterest`) through `parseInt(…, 10) || 0`. A group whose `expiration-date` is present AND different is skipped — **so an EMPTY `expiration-date` is counted**, which is v2's behaviour and matters when the upstream omits the field.

Two mini charts (`{ w:340, h:190, padL:40, padR:10, padB:32, padT:20 }`), bars 55% of slot min 3, ticks every `ceil(n/8)`-th or all at ≤ 8. Labels `Call` (`callOI`, call-leg colour) and `Put` (`putOI`, put-leg colour).
Status: `Loaded {HH:MM} ET · once/day (OPRA OI)`. Empty states: `loading expirations…` / `no data yet` / `no expirations`.
Error: `OI-by-expiration error: {msg}`.

### Card 6 — Net gamma exposure by strike, 0DTE cumulative (`netGamma`, right)

Title: `` `Net gamma exposure by strike (0DTE · {expiry})` `` — the expiry clause appears only once the feed reports one.
Subtitle: `The live feed's SINGLE expiry. Cumulative across ALL its strikes — green above zero (dealers long gamma), red below (short gamma); crosses zero at the gamma flip (Neutral) · scroll to zoom, drag to pan, double-click to reset`

Geometry `{ w:720, h:220, padL:54, padR:16, padB:26, padT:18 }`. Window `WINDOW_FRAC_FULL_CHAIN = 1` — "a half-window of a whole spot — wider than the entire listed chain, so every strike is visible on first paint and zoom/pan work from there." Y padding `CURVE_Y_PAD_FRAC = 0.08`.

Legend: `Positive gamma$` (`V2.pos`) · `Negative gamma$` (`V2.red`) · `Spot` (`SPOT_LINE_CURVE.color`).
Tooltips: `Strike {2dp}` / `Cumulative Gamma$: {fmtBn}`.
Empty: `no chain rows`.

### Cards 7 & 8 — multi-expiry gamma bars (`netGammaAll`, `netGammaEx0dte`, right)

Card 7 subtitle: `Every listed expiration combined, 0DTE included — gamma$ per strike, green above zero / red below · OI+Vol basis · scroll to zoom, drag to pan, double-click to reset · refreshed once a minute`
Card 8 subtitle: `Same board with the 0DTE expiry removed — gamma$ per strike, what's left standing after today expires · OI+Vol basis · scroll to zoom, drag to pan · refreshed once a minute`

> v2's subtitle omits "double-click to reset" here alone, though the behaviour is identical to card 7's. Copied as written.

Geometry `{ w:720, h:220, padL:56, padR:16, padB:26, padT:18 }`, bars 62% of slot min 2, window `WINDOW_FRAC_DEFAULT = 0.06` (±6% of spot).

Scope notes: card 7 gets `` `${expiryCount} expirations` `` straight from the payload; card 8 (and 11) get `` `${max(0, expiryCount − 1)} expirations, 0DTE excluded` `` — **derived by subtracting one**, because "the server does not report an ex-0DTE count."

Header line (`multiStatusLine`): `{scope} · total {fmtBn} · flip {fmt0} · res {fmt0} · sup {fmt0}`. **The walls clause is dropped entirely — not printed as an em dash — when the ladder carries neither wall**, "so a stale deploy reads as 'this build has no walls' instead of 'there are no walls'." These are THIS ladder's own walls, never `/proxy/gex`'s, which are 0DTE and clipped to ±8% of spot.

`LEGEND_NET_GAMMA_MULTI` has four items, and it carries a known collision:

> "Positive gamma$" and "Flip" carry the SAME swatch, because on this chart the flip line IS `GEX_POS_GREEN` — so the legend cannot tell them apart. That is v2's own quirk. Step 2 broke it by collapsing the flip line onto white; 2026-09-03 restores v2's per-chart treatment, and a legend swatch has to be the colour of the mark it names, so the collision comes back with it.

Errors: `Multi-expiry GEX error: {msg}`.
Empty ternary in this precedence: `sweeping the board…` → `no ladder available` → `no strikes returned`.

**Note `symbol` is hardcoded `$SPX`** on this feed, not `snap.symbol`:

> So the three multi-expiry cards describe SPX while the four header tiles above them follow whatever the shared feed is on. If the feed ever moves off SPX they silently disagree — spec open question 6.

### Card 9 — Call/put gamma exposure by strike (`callPutGamma`, right)

Subtitle: `Click-drag to pan, double-click to reset` — "the shortest subtitle on the tab, and it does not mention scroll-to-zoom even though the wheel handler is attached. v2's, unchanged."
Geometry `{ w:720, h:220, padL:54, padR:16, padB:26, padT:18 }`; paired bars 34% of slot each, min 1.5, with a 1px gutter. Domain via `callPutDomain` (split extremes). Legend: `CallGEX` / `PutGEX`. Tooltips: `CallGEX: {fmtBn}` / `PutGEX: {fmtBn}`.

### Card 10 — Net delta exposure by strike, 0DTE (`netDelta`, right)

Title: `` `Net delta exposure by strike (0DTE · {expiry})` ``
Subtitle: `The live feed's SINGLE expiry — delta$ per strike on the OI leg only · click-drag to pan, double-click to reset`
**Basis `'oi'` — the one card on the tab that is not on `oiVolNet`.** Legend uses the bare words `Positive` / `Negative` (no `delta$` suffix). Geometry `{ w:720, h:220, padL:50, padR:16, padB:26, padT:18 }`.

### Card 11 — Net delta exposure by strike, ex-0DTE (`netDeltaEx0dte`, right)

Subtitle: `Every listed expiration EXCEPT 0DTE — delta$ per strike on the OI+Vol basis, so it matches the gamma ladders above rather than the 0DTE delta card · hover a bar to split the two legs · scroll to zoom, drag to pan · refreshed once a minute`
Basis `'oivol'`. Legend: `Positive delta$` / `Negative delta$` / `Spot` (white).
Header (`multiDeltaStatusLine`): `{scope} · total {fmtBn}` — summed **client-side** on purpose:

> the payload's `totalNetGex` is a GAMMA total and there is no server-side delta total to borrow. Summing the ladder being drawn keeps number and bars in lockstep.

`multiDeltaAllZero` triggers a specific empty note when every strike's OI+Vol delta is exactly zero:

> `net delta is zero at every strike — server-v2 is likely running a build before /proxy/gex-by-strike-multi shipped netDEX; redeploy it`

Error: `Multi-expiry DEX error: {msg}` — the delta panel's wording for **the same error from the same shared load** the gamma panels call `Multi-expiry GEX error:`.

Tooltips: `Net Delta: {fmt0}`, and the leg split `OI {fmt0} · Vol {fmt0}` **rendered only on the `"oivol"` basis, i.e. only on card 11**.

**The `fmt0` axis is a known oddity:** the net-delta charts label their y axis with `fmt0`, not `fmtBn` — "the only axis on the tab that does, so a delta reads '412,773,000' where every neighbour would read '412.8M' (B250). v2's, kept."

### Card 12 — Net vol GEX flow, today (`volFlow`, right)

Subtitle, as shipped:

> `Intraday path of the volume leg, 5m buckets from option_strike_gex_history · pick an expiration or track the front · above zero = flow adding long gamma (dampening), below = short gamma (amplifying)`

**`// BUG (v2):` "5m buckets" is STALE.** The panel sends `bin=BIN_SEC` = **30** and prints `30s buckets · today ET` in its own header a few pixels below, "so the card contradicts itself on screen. The code wins; the string never caught up." The one-line fix is written out in the registry comment: swap the literal for `` `Intraday path of the volume leg, ${BIN_LABEL} buckets from …` ``.

**The panel moved on 2026-09-10** to `src/board/volGexFlow/VolGexFlowCard.tsx`, when the home board grew the same card: "this tab and the board now mount ONE `<VolGexFlowPanel />` and cannot drift. Nothing about it changed in the move — the transcribed v2 bugs went with it." The tab renders it inside a fixed `<div className="h-[460px]">`; the panel takes **no props** and owns its picker, session switch, view switch, fetch and poll.

Constants:

| Const | Value | Why |
|---|---:|---|
| `BIN_SEC` | `30` | "the floor the endpoint enforces AND the recorder's write cadence. Going 1:1 with the recorder is only safe because it writes on a fixed 30s grid slot… Under the older drifting throttle this pairing produced **'the shark tooth'**: buckets that caught two writes threw one away, and neighbours that caught none dropped a point entirely." |
| `BIN_LABEL` | `'30s'` | Sub-minute, so `BIN_SEC / 60` would render "0.5m" |
| `VOL_FLOW_POLL_MS` | `15_000` | Half the bucket width |
| `VOL_FLOW_FRONT` / `VOL_FLOW_ALL` | `'__front__'` / `'__all__'` | "Real picks are ISO expiry strings, which can never collide with these because neither parses as a date" |
| `VOL_FLOW_DEFAULT_SESSION` | `'rth'` | "the overnight stretch has no new prints — values persist until the chain resets, which draws a long flat line and a phantom step that read as signal but aren't" |
| `PCT_VIEW_STORAGE_KEY` | `'cbedge.volGexFlow.pctView'` | **`sessionStorage`, NOT localStorage** — per browser tab, cleared when the tab closes. "It is the only sessionStorage key in Part B; the card layout and the OI cache both use localStorage, with no stated reason for the split" |
| `VOL_FLOW_PCT_BASELINE` | `50` | "The % series splits here, not at zero: 50% is a balanced chain" |
| `PCT_AUTOSCALE_PAD` | `5` | percentage points either side |
| `VOL_FLOW_SIZE_PUMP_FRAMES` | `120` | rAF retries while the box has no dimensions |

**Controls.** Session: `RTH` (`Regular hours — 09:30–16:00 ET`) / `ETH` (`Extended — the whole ET day, including the overnight tail`). View: `$ GEX` (`Net vol GEX in dollars — the signed flow series`) / `+GEX %`:

> `Share of the selected expiry's |net GEX| (OI+Vol) that is positive — the same number as the home Levels strip's +GEX % tile. Above 50% = long-gamma chain.`

The view buttons are **always rendered**:

> an earlier version hid the control whenever the window held no posPct rows, so the whole feature vanished on a weekend and read as the change having been rolled back.

Picker options: the two sentinels first (`Front · Sep 19` when an expiry has resolved, else just `Front`; then `All expiries`), then one row per reported expiry in the **server's order**, labelled `` `${shortExpiry} · ${rows.toLocaleString()} rows` ``. "The list is whatever the endpoint reports as actually having rows today, so a pick can never produce an empty chart."

**Stats.** `computeVolFlowStats` uses a STRICT comparison in both extreme scans, so **the FIRST extreme wins a tie**. `flips` counts zero crossings **with zero on the POSITIVE side**. `computeVolFlowPctStats` is kept separate rather than folded in:

> the two views cover DIFFERENT bucket sets: a bucket with rows but no gamma at all has a volGex and no posPct.

Its `flips` counts crossings of **50**, not 0, same `>= / <` boundary, so exactly 50 is the long side.

**Six tiles, in the fixed order of meaning** (now / change / high / low / regime / context) "so the eye doesn't have to re-learn the block when you flip the switch". Six placeholders keep the block's height fixed so the chart never moves.

$ view: `Net Vol GEX` · `Δ Last Bucket` · `Session High` · `Session Low` · `Sign Flips` · `Spot`.
% view: `+GEX %` · `Δ Last Bucket` · `Session High` · `Session Low` · `Time > 50%` · `Regime` (`LONG γ` / `SHORT γ`, γ is U+03B3).

Two preserved asymmetries:

> Session High is inked positive UNCONDITIONALLY — a session whose high is still negative reads as positive. Session Low falls back to plain text when it is non-negative; it is the only tile on the tab with a neutral fallback ink, and High has no mirroring guard. Spec open question 11.

And a second `// BUG (v2):` in the % view's Δ tile:

> the sign GLYPH and the INK disagree at exactly zero. The label ternary is `> 0` and the colour ternary is `>= 0`, so a delta of exactly zero renders "−0.0pt" — a minus sign — inked positive.

Also: the `Spot` tile tests `last.spot` for **truthiness**, "so a genuine spot of 0 prints an em dash."

**The scrim**, in precedence order: error → loading (`Loading net vol GEX history…` / `Loading +GEX % history…`) → the two empties (`No snapshots in today's RTH window — try ETH` / `No snapshots recorded yet today`). Branch 3 is "the only empty state on the tab that names its own remedy." Ink: `V2.red` on an error, `V2.cyan` otherwise. Visible while loading, on an error, or on an empty settled window.
Error strings: `History DB unavailable` / `Feed unavailable`.

**The chart** is `lightweight-charts`. Options: transparent background, `textColor` from `--color-fg`, grid `alpha(fg, 0.05)`, borders `alpha(fg, 0.1)`, `attributionLogo: false`, **`handleScale: false` / `handleScroll: false`** — "no pan, no zoom — the opposite of the four strike charts on this same tab, which implement bespoke wheel-zoom and drag-pan."

Two Baseline series (the `$` one on the RIGHT scale splitting at 0, the `%` one on the LEFT splitting at 50):

> A Baseline series is used because net vol GEX is a POLARITY measure — the sign IS the signal — and a baseline series splits the fill at zero natively, so the sign is read from colour and side without a legend lookup.
>
> Two scales rather than one shared: each carries exactly one series, so each keeps its own price formatter ($ vs %) with no fighting over which series formats the axis. Both are declared at construction and only `visible` is toggled — adding a price scale to a live chart re-lays-out the pane and jumps the series.

Series shape: `lineWidth: 2`, `priceLineVisible: false`, `scaleMargins: { top: 0.12, bottom: 0.14 }` — "the bottom margin keeps the lowest price tick off the canvas edge, where lightweight-charts would clip the label in half." Fills at alphas 0.32 / 0.02 either side.

**Token resolution warning**, verbatim:

> THESE ARE CUSTOM-PROPERTY NAMES, NOT `var()` STRINGS. `tokenHex()` looks each one up on the computed style at mount and returns `'transparent'` for a name it cannot find — it does NOT throw. So a rename or a deletion of either token below paints card 12's chart blank with no error anywhere.

The two names are `--color-v2-refresh` (up) and `--color-v2-red` (down), deliberately the same tokens `V2.up` and `V2.red` hand to the six tiles "otherwise the series and its own tiles disagree about the sign of the same number."

Axis formats: `%` at 0dp with `minMove` **0.1**; `$` at **ONE** decimal where the tiles use two.

`pctAutoscaleRange(vals)`: `lo = max(0, min(50, …vals) − 5)`, `hi = min(100, max(50, …vals) + 5)`. Empty → `{0, 100}`. v2 reads its values from a REF, not state, "because the provider is captured once at series creation and would otherwise close over a stale array — step 3 must keep that."

Series data is `Math.floor(ts / 1000)` — lightweight-charts wants UNIX seconds, the wire carries ms.

**`CARD_12_IS_THE_ONLY_CANVAS = true`**, and the three v3 violations it arrived with are written down so they are not rediscovered at render time: no `data-cb-layer` on the chart container; **no visibility guard anywhere** (the ResizeObserver and the rAF size pump run whenever mounted); and the two opposite interaction models side by side.

## Pan, zoom and windowing — the four strike charts

| Const | Value |
|---|---:|
| `ZOOM_STEP` | `1.15` |
| `ZOOM_MIN` / `ZOOM_MAX` | `0.25` / `8` |
| `WINDOW_FRAC_DEFAULT` | `0.06` |
| `WINDOW_FRAC_FULL_CHAIN` | `1` |
| `WINDOW_MIN_POINTS` | `4` — a window leaving this many points or fewer falls back to the whole set |

`useChartPan` wires the events. Two notes:

> `draggingRef` is a REF and not state on purpose: the per-point hover handlers check it synchronously to suppress a tooltip mid-drag, and a state update is one tick too slow for that.

> B68 — React's `onWheel` is passive and cannot `preventDefault` the page scroll, so the wheel goes on natively, non-passive, through `mergeRefs`.

Double-click recentres on spot **and** drops the zoom. `mergeRefs` exists because one DOM node needs two refs: the hover origin and the native wheel target.

`useChartHover` reports which mark is under the cursor plus the cursor position **relative to the chart's own `position:relative` wrapper**, "so an HTML tooltip can follow it."

`usePoll(tick, ms)` reproduces `useQuery`'s `pollMs` semantics for these five parse-first loaders: a tick is **skipped** while hidden and one fires immediately on the way back.

## The 12-card layout: drag, drop and persistence

`DEFAULT_LAYOUT` is **derived from the registry** (`filter(c => c.defaultColumn === …)`) "so the two can never drift". Left is the daily / session-history stack (cards 1–4); right is the live-chain stack (5–12).

`CARD_LAYOUT_STORAGE_KEY = 'gexlevels-card-layout-v1'`, shape `{ left: CardKey[], right: CardKey[] }`.
Legacy keys read **only when v1 is absent**: `gexlevels-card-order-left-v3`, `gexlevels-card-order-right-v3` — "read once to migrate rather than discard."

`normalizeLayout` runs three passes: drop values that are not card keys (a card renamed or removed) → drop duplicates with **first position winning** → append every unseen key to the bottom of its **default** column.

> That last pass is why a NEW card key can be added to the registry without bumping the storage key and resetting everyone's arrangement… The guarantee is that all 12 cards render exactly once whatever localStorage holds.

Any parse failure falls through to the default arrangement. A write failure is swallowed.

`placeCard` pulls the key out of BOTH columns then splices it in at `before`'s index (null = append) — **one code path** for a same-column reorder and a cross-column move:

> v2 used to have two hooks with two key unions, which made a card structurally unable to leave the column it was declared in.

Drag details:

- Payload rides on `text/plain`. `draggedKeyFrom` prefers the dataTransfer payload over component state: "it survives a re-render mid-drag and it is what the browser guarantees is set on drop. Some browsers throw reading dataTransfer outside a drop handler, hence the fallback."
- Only the **handle** is draggable: glyph `⠿` (U+283F), title `Drag to move — reorder within a column or drop into the other one`, and it swallows the mousedown "so the card drag and the charts' drag-pan cannot fight over one gesture."
- A card drop calls `stopPropagation` "so a drop on a card wins over the column underneath."
- The tail strip (`Drop here`) is rendered **for the whole duration of a drag** — "it is the append target and the ONLY way into a column that has been emptied out."
- The dragged card renders at `opacity: 0.35`.

**First paint is ALWAYS the default arrangement** and the stored one swaps in after mount, "because localStorage is unavailable during prerender. A user with a custom layout therefore sees one frame of the default."

`resetLayout` is `@notWiredInV2`: "Fully implemented in v2, returned by the hook, and connected to NO BUTTON — there is no visible way to reset the layout. It persists correctly; it is simply unreachable." **Not imported by the render layer.**

## Also removed on this tab, do not re-add

- `GexLevelsRow.callVolume` / `putVolume` — declared on the wire type, zero-filled by `multiRow`, "read by nothing in 2233 lines".
- `useChartPan`'s `zoom` return value — returned and never read; all four consumers use `winHalf`, which already folds the zoom in. "`zoom` survives here as an ARGUMENT to `panWinHalf`, which is the only place it ever mattered."
- `ColumnDropZone`'s `active={false}` branch — the only call site hardcodes `active={true}`, so the dimmer opacity was unreachable.


---

# TAB 3 — IB Stats (`?tab=ibstats`)

## What it is

The initial-balance / opening-range base-rate bench. A control strip (symbol pair + window quartet + range caption), then for everyone: **Live Read**, **IB Read**, **Probability Engine**. For the owner only: a disclosure opening **sixteen historical cards**, and the **EOD scoreboard** (23 columns).

The TAB is public — `scannerNav.ts` gives `ibstats` no `ownerOnly` flag. Exactly two blocks inside it are gated: `OWNER_GATED_BLOCKS = ['historical-stats', 'daily-results']`.

> v2's test is `isOwnerClaim || (env owner id ? userId === env owner id : false)` with NO `loaded` guard, so the owner briefly sees the public view while auth resolves and the button then appears. It also reads `useAuth().userId` where `useIsOwner.ts:29` reads `useAuth().user?.id` — two different fields for one test, and if the former does not exist the env-var fallback has never fired. v3 resolves ownership once, in one place.

## Controls

```ts
SYMBOLS        = ['ES', 'NQ']           DEFAULT_SYMBOL = 'ES'
WINDOWS        = [ {60,'IB 60m','09:30–10:30'}, {30,'ORB 30m','09:30–10:00'},
                   {15,'ORB 15m','09:30–09:45'}, {5,'ORB 5m','09:30–09:35'} ]
DEFAULT_WINDOW = 60
```

The dashes in `range` are **EN DASHES (U+2013)**, not hyphens. Each window button's tooltip is its range plus `' ET'`; the strip's trailing caption is `` `${winRange(win)} ET` ``.

**Neither control is written back to the URL** (G8), so the tab's own state is unshareable. Ported as written.

## The range is a parameter, not a constant

> Every rule asks "the range built from 09:30 for N minutes"; IB is just N=60. `rangeEnd(win)` is `570 + win` and downstream code keys off REND, never off a literal 630. The two places v2 forgot this are marked (rule 13's scored bucket, and every hardcoded "10:30" string).

`RTH_OPEN = 570` (09:30 ET), `RTH_CLOSE = 960` (16:00 — **the 16:00 bar is INCLUDED**, filter is `min <= 960`), `TWO_PM = 840` (the contained-day cut and the engine's `late` flip).

## Nine more rules that are not obvious from the screen

2. **A break is a bar CLOSE outside the range.** A wick-only excursion is a TOUCH, and the two are counted in different columns everywhere. "The day types (single/both/neither) are built from TOUCHES; the 'Break' column, the live `status` and every `fcb` statistic are built from CLOSES. A session can be a single-break day by wick and have no close break at all."
3. **The range bars are `min >= 570 && min < REND`** — exclusive at the end, "so the 10:30 bar itself is already post-range and can be the break bar."
4. **FOUR independent copies of the width class, with FOUR different sample-size guards** — `widthClassLive` / `widthClassDerived` / `widthClassEod` / `widthClassDataset` — ported as four named functions rather than unified: "unifying them silently changes the numbers on four different cards."
5. **FIVE incompatible break-timing ladders**, same treatment (`breakTimeBucketScored` … `BREAK_TIME_WINDOWS`).
6. **"Contained", `first`'s tie-break and `retest` are each defined two or three different ways** between the offline dataset, the EOD grader and the live tape. All variants ported separately and named for their path.
7. **`scoreWithHistory` applies NO minimum-sample floor.** "A rule matching 2 sessions reports its rate with the same weight and the same colour as one matching 900."
8. **`bestSample` walks tightest→loosest and takes the FIRST group with ≥ 40 members**; nothing qualifying falls back to the WHOLE dataset under the label `all sessions`. "The label is the only thing on screen that says which happened."
9. **`pHigh` falls back to a hard-coded 50** when no conditioned session ever recorded a first touch — "visually indistinguishable from a measured 50%."
10. **The dataset is a static export.** `hist.avgIb` / `hist.avgAtr` are the last 20 sessions OF THAT FILE, not the last 20 real sessions, "so the live width bucket is measured against averages frozen at `LAST_UPDATED`." `LAST_UPDATED = '7/11/2026'`, hand-typed, US format, no zero padding: "Nothing compares it to `ds.generated`, so it cannot go stale-detect — it is prose on a card."

## The eleven sample floors

`MIN_N = 40` is "THE ONE SAMPLE FLOOR THE LIVE CARDS USE" — it gates `bestSample`, the day-of-week matrix swap and the break-side grouping in the active rule. `SAMPLE_FLOORS` collects every other one so the next reader does not have to find them one at a time. **They are not interchangeable and are not unified:**

`liveConditional 40 · verdictThin 20 · playbookLegacy 15 · ruleRanking 8 · avgIbWindow 20 · atrWindow 14 · datasetTrailingMin 5 · deriveWarmup 14 · eodTrailingMin 14 · datasetMinBars 10 · eodMinBars 3 · levelCanvasMinBars 2`

Note `ruleRanking: 8` — "the Rule Ranking table's row filter — under this the row VANISHES."

## Data path

| Source | URL | Stale | Poll |
|---|---|---:|---:|
| The dataset | `/data/ib-{ES\|NQ}.json` (60m) or `/data/orb{30\|15\|5}-{SYM}.json` | `DATASET_STALE_MS` 86 400 000 | none |
| Results | `/api/ib-results?symbol={SYM}&limit=90` | `RESULTS_STALE_MS` 60 000 | none |
| Live candles | `/api/snapshots/candles` via `loadCandles` | 3 000 / 60 000 | `IB_CANDLE_POLL_MS` 15 000 |

`datasetPath` — "The 60-minute window is the odd one out — it is `ib-`, not `orb60-`, because it predates the other three."

**A missing dataset file is a product state, not a bug:**

> Only the 60-minute datasets are referenced anywhere else in the v2 tree, so three of the four window buttons may lead straight to the "dataset not found" card. Its copy tells you how to produce the file, verbatim.

`datasetErrorMessage(sym, win, status)`, which IS the card body:

> `{SYM} {winLabel}: {status} — is public/data/orb5-ES.json in the repo? Export it from ib-backtest-esu6.html with the 5m window selected.`

The status is recovered from `query()`'s error text (`"<status> <statusText> — <url>"`); a NETWORK failure has no status and lands as its raw message, "exactly as v2's `catch` rendered `e.message`."

`/api/ib-results` is **subscriber-gated and clamps its own limit** — `Math.min(365, Math.max(1, Number(limit) || 90))`, symbol coerced to NQ or ES — and returns rows **NEWEST FIRST**. Both facts are load-bearing: the scoreboard renders in API order and the tape has to reverse.

**Departure 1 — the tape no longer has its own request.** v2 fired `limit=5` for the strip and `limit=90` for the scoreboard from two components with no shared cache. `loadIbResults(sym)` makes ONE request at 90 and `tapeFrom()` slices the five newest locally, `.reverse()`d because the tape reads oldest→newest. Flags are coerced to real booleans "because they arrive as 0/1 integers."

**Departure 2 — the scoreboard's request is no longer lazy.** v2 fetched on first expand, "which is a waterfall behind a click. Here the route may fire it at entry; the disclosure still controls what is DRAWN."

**Removed:** the four `alive` flags ("the request still completes and its response is still parsed, the result is just dropped"); `IbLevelCanvas`'s duplicate `/data/ib-ES.json` fetch; and the silent `.catch(() => {})` on the tape —

> It swallows every error, and the tape then falls back to the STATIC EXPORT whose newest row is months old — with no visual difference from live data.

`loadIbStatsEntry` fires both in parallel; the dataset's error propagates ("without it there is no card to render") while the results feed's failure is swallowed into a null. `preloadIbDataset(sym, win)` warms a ~300 KB file on hover — "the difference between an instant swap and a 'Loading ES ORB 30m dataset…' card."

### No socket, so no 4 Hz

v2 mounted **both** `useEsCandles(sym === "ES", 2)` and `useNqCandles(sym === "NQ", 2)` on every render and enabled the matching one; "switching symbol tears one down and connects the other, and there is a gap in between where neither has bars." Three facts had to survive: `historyDays = 2` (the second session supplies `pdh`/`pdl` for rule 11); `withAverages` defaults TRUE on the ES hook and runs two full `buildSlotAverages` passes per republish for fields this tab never reads (pass false); and live frames coalesce on a 250 ms trailing timer — a 4 Hz publish ceiling.

v3 non-negotiable 2 forbids a page opening a socket, and **there is no candle frame type in `@/data/store`** to read with `useFrame`, so the REST legs are the only route that exists today. `connected` (G53's subtitle switch) becomes "the last candle read resolved" — "the closest true statement this transport can make."

## Card 1 — Live Read

Title: `` `Live Read — direction, expansion, active rule · ${winLabel}` ``
Subtitle: the surviving condition stack label, plus `` ` · ${winLabel} STILL FORMING` `` when the range is incomplete.

**The condition stack** (`liveConditionStack`), in order — `bestSample` walks it from the full stack down to one condition and takes the first group with ≥ 40 members:

1. `bias` — `close > mid` / `close < mid` (**omitted when bias is null**)
2. `first` — `HIGH first` / `LOW first` (**always present**)
3. `widthBucket` — e.g. `NARROW IB 60m` (omitted when the bucket is null)
4. `orbDir` — `inner ORB up` / `inner ORB down` (omitted when null)

Labels are joined with `' + '`. Nothing qualifying → the whole dataset under `all sessions`.

`bucketKeyOf` lower-cases the width word — `"—"` lower-cases to `"—"`, which matches no bucket, "that is how a missing width class disables rule 4 and drops condition 3 from the stack."

**The gauge** — SVG user units inside `viewBox="0 0 100 50"`:

```
trackPath 'M 10 50 A 40 40 0 0 1 90 50'   upPath 'M 10 50 A 40 40 0 0 1 50 10'
downPath  'M 50 10 A 40 40 0 0 1 90 50'   strokeWidth 10   arc 125
needle { x1:50, y1:50, x2:50, y2:15, strokeWidth 2.5 }   hub { cx:50, cy:50, r:4.5 }
deadBand 2
```

**`// BUG (v2):`**

> `arc` is 125 ≈ π·40, THE LENGTH OF THE FULL SEMICIRCLE, and it is applied as the `strokeDasharray` of QUARTER-arc paths whose real length is ≈ 62.8. The visible length therefore saturates at pHigh = 50: the winning side's arc is fully drawn for every reading past the middle and only the losing side's arc actually varies. Ported as written — the fix changes what the gauge looks like, so it is a design call (Q5), not a bug fix.

`gaugeAngle(pHigh)` = `−90 + (pHigh/100)·180`. `gaugeReadout` is **always the winning side's probability**, "so it can never read below 50.0%". `gaugeVerdict` reads `NO DIRECTIONAL EDGE` inside the dead band, else `HIGH BREAK BIAS` / `LOW BREAK BIAS` — and **the colour is not neutralised inside the dead band**: "a 49.5% reading still paints the down colour while saying 'NO DIRECTIONAL EDGE'." Needle and hub are v2's only raw `#fff` literals, both `T.text` here.

**The overall score**, applied strictly in this order:

```
s  = (pHigh − 50) × 1.6
+22 / −22   one-sided close break
×0.4        BOTH sides broke            (rotation kills conviction)
±6          price vs the midpoint       ← AFTER the ×0.4, so undamped by it
±4          the midpoint bias           ← likewise
×0.5        while the range is forming   (this one damps everything)
clamp [−100, +100]
```

`convictionOf`: `|s| >= 45` STRONG · `>= 20` LEAN · else NEUTRAL. `overallVerdictText` has five possible strings; **a score of exactly 0 is `bull` AND `NEUTRAL`**, so it reads `NEUTRAL — no edge` and paints warn. `scoreText` is a signed integer with the ASCII minus `toFixed` emits; the caption under it, `−100 bear … +100 bull`, uses **U+2212** and a single U+2026 — "unlike the score above it."

**The expansion matrix** — three mutually exclusive bars summing to 100 over `expansionPopulation` (today's weekday when ≥ 40 of them, else the whole group; weekend → the fallback fires). `ROTATION_RISK_PCT = 32`, strict `>`:

- high → `Rotational risk HIGH — expect a two-sided day`
- low → `One-sided break expected — opposite extreme protected`

Bars: Single-side trend `V2.cyan` · Rotational chop (both) `V2.purple` · Contained range (none) `V2.orange` — "cyan / purple / warn — not a rate ladder."

**The active tactical rule**, evaluated in this exact order:

(a) a break printed BEFORE the range closed → null. "Dead in practice: `post` starts at REND, so a break cannot exist before the range is complete."
(b) both sides broken → `BOTH SIDES BROKEN — rotation day`, verdict `fade`, note `Rotation day — fade the extremes, don't chase`.
(c) a break printed → group by break side **AND** width bucket; under `MIN_N`, fall back to break side alone. Then:
  - `failP > 50` → `{H|L} break — fails more often than it runs`, verdict `fade`, and **the DISPLAYED p is `100 − failP`** — "the success rate of the FADE, not the failure rate quoted in its own note" (`{failP}% of these breaks close back inside within 30m`);
  - otherwise → `{W} break confirmed → ≥1× ext`, verdict `tradeable` at `p >= 55` else `noise`. "There is NO 'fade' outcome on this path however low p is." Note: `fail rate {failP}%`.

(d) a bias only → `Midpoint bias → {HIGH|LOW} breaks first`, `p = bias === 'H' ? pHigh : 100 − pHigh`, verdict `tradeable` at `>= 60`, `fade` at `<= 45`, else `noise`. Note: the sample label.
(e) no bias → `` `No bias — ${winLabel} closed on the midpoint` ``, p 50, verdict `noise`, note `wait for a break`.

`ActiveRule.n` is "set by every branch and RENDERED BY NOTHING — sample counts are owner-only."

Verdict words: `TRADEABLE EDGE` / `FADE SETUP` / `NO EDGE`; ink `V2.up` / `V2.red` / `V2.orange`, and **a NULL rule paints the warn colour, same as "noise"**.

Fixed strings: `Overall break bias` · `Breakout target bias` · `High first ` / `Low first ` · `Active tactical rule` · `Edge rate` · and `Waiting on the 10:30 ET close.` — **hardcoded to 10:30, it does not follow the window selector (G110).**

**Two early-return cards instead of the trio:**

- `live == null` (outside market hours, weekends): title `` `Today — ${sym}` ``, subtitle `Waiting for today's bars…` or `Candle feed disconnected`, body `No RTH bars yet for the current session. This card fills in from 09:30 ET.` **The IB Read and Probability Engine cards do not render at all here.**
- pre-range: title `` `Today — ${sym} · ${dowName}` ``, subtitle `` `Pre-range — ${winLabel} levels set at ${clock(rangeEnd)} ET` ``, two tiles `Live price` and `Clock (ET)`.

**`dowIdx` is the BROWSER-local weekday**, not the ET one:

> Every other date computation on this tab is ET-anchored; this one is v2's `new Date().getDay()` and it silently changes rule 0c's condition west of ET after 21:00 local.

## Card 2 — IB Read

Title: `IB Read — 4 families, one glance` — "a template literal with no interpolation in v2 — it says 'IB' on every tab."
Subtitle (formed): `The 14 rules grouped so correlated priors stop overcounting…` — **says "14 rules"; the board carries 15 on a weekday (G119).**

`scoreWithHistory` scores every rule with a condition against the dataset. `last5` is **oldest → newest**, over the rule's last five IN-PLAY sessions. Dot colours: hit `V2.up`, miss `V2.red` (and the miss dot drops to 55% opacity).

**The four families** (members that resolve to nothing are dropped silently):

| key | Title | Sub | ids | badge |
|---|---|---|---|---|
| `struct` | Morning Structure Bias | close vs mid · formation order · FVG · close location | 1, 2, 7, 10 | `correlated · 1 idea` |
| `confirm` | Break Confirmation | what price actually did after the break | 3, 5, 6, 8, 9 | — |
| `timing` | Timing, Width & Day Type | whether one side runs, and how far | 4, 11, 13, 14, 0c | — |
| `conflict` | Conflict Watch | faster structure vs the morning lean | 12 | `early tell` (hero) |

> Rules 4, 11, 14 and 0c all carry `side: null`, so in "Timing, Width & Day Type" only rule 13 can ever give the family a direction.

`familyStat` sums **percentages, not weighted by sample size**. **Ties resolve to "H"** — including `0 === 0` when `dir` is non-empty but every rate is 0. `avg` is the mean rate of the members on the winning side only. Verdicts: `HIGH ↑` (`V2.up`) / `LOW ↓` (`V2.red`) / `CONTEXT` (`V2.orange`), arrows U+2191/U+2193.

**The tape** — `LAST 5 SESSIONS`, chips of `{MM-DD}`, direction and day type. `tapeChip` checks `dayType` in exactly this order: `contained` → `both broke` → `single break` → em dash. A null first-touch side paints `V2.orange` and prints an em dash.

> A tape sourced from the static export instead of the API is MONTHS OLD and looks identical — that is v2's silent failure mode (G123).

Card footnote, verbatim:

> `Families collapse correlated rules so one bullish idea (close above mid · low-first · bullish structure) can’t read as four separate votes. Green dots = the rule was right on that past session, red = wrong (oldest → newest, its last 5 in-play sessions). The Conflict Watch card is the early tell: when the faster ORB structure disagrees with the morning lean, the lean is the stale one.`

Accent: `IB_READ_ACCENT = V2.accent` — the accent leg of the #8ECAE6 collision. "This tab's body already accented in #7dd3fc in v2; the tab pill now agrees with it."

## Card 3 — Probability Engine

Takes the SAME `buildRules()` output the family board reads, buckets each in-play rule by the side it points to, applies four environmental multipliers, and normalises to three integers filling three rings.

Six things not obvious:

1. **The weight is flat.** Every in-play rule contributes `(edge/100) × 1.5`. Sample size is not an input — `engineRules` strips `n` before the rules reach the file — "so a rule matching 12 sessions moves the gauges exactly as hard as one matching 900." (Q8)
2. **A directionless in-play rule is bucketed as ROTATION, not excluded.** "Rules 4, 11, 14 and 0c carry `side: null`, so 'IB Width → Day Type' at 62% adds 0.93 to rotation risk purely for having no side."
3. **Rule `0c` never reaches the engine at all.** The gauge population is `STAGE_DEFS.flatMap(...)`, "and 0c is in no stage — even though it renders as a family member on the card directly above."
4. **The additive terms land before the multiplicative ones**, so the wide-range `+2.0` is itself multiplied by the 1.2 and the 1.5 that follow.
5. **Rotation is a rounding residual:** `100 − round(bull) − round(bear)`. It can come out a point low, a point high, or **NEGATIVE** (bull 50.5→51, bear 49.5→50 ⇒ rot = −1), "which renders as an empty ring over a '-1%' label." (Q9)
6. **The stage order is not numeric.** `allRows` walks stages 1–4, i.e. ids 4, 11, 7, 2, 1, 10, 12, 5, 6, 13, 3, 8, 9, 14.

```
ENV_MULTIPLIERS (in APPLICATION ORDER)
 1. wideRotationBonus        +2.0  additive to rot, and therefore itself scaled by 3 and 4
 2. narrowDirectionalBonus   +0.8  additive to BOTH directional buckets
 3. activeVolumeDirectional  ×1.3  on bull+bear …
    quietVolumeRotation      ×1.2  … or, when volume is anything but "active", on rot.
                                   There is no third branch
 4. lateRotation             ×1.5  on rot, after everything else
```

`engineEnvFrom`: a `"—"` width bucket falls through to `"normal"`; `volSurge === null` falls through to `"normal"` volume, **which is the branch that boosts rotation**; `time` flips at 14:00 ET.

If no row qualifies, the function returns three ZEROS and all three rings read 0%.

`STAGE_DEFS`: 🔒 Stage 1 Opening Baseline Setup `[4,11,7,2]` · 🔓 Stage 2 Interior Range Dynamics `[1,10,12]` · 🔓 Stage 3 Breakout Validation & Traps `[5,6,13]` · 🏁 Stage 4 Continuation Targets & End-of-Day `[3,8,9,14]`.

Ring geometry, SVG user units inside `viewBox="0 0 118 118"`: `cx 59, cy 59, r 50, strokeWidth 9, rotateDeg −90` (so the ring starts at twelve o'clock), `circumference = 2π·50` printed as `314.2`. `ringDashOffset(pct) = CIRC × (1 − pct/100)` — a pct of 0 leaves the ring undrawn. The centre number greys to `alpha(T.text, 0.55)` at zero: "this is the one place on this tab where v2 does dim a value, so the opacity is carried explicitly."

Ring inks: `bull` `V2.up` · `bear` **`V2.neg`** · `rot` `V2.orange` · `off` `V2.neutral`.

> `V2.neg` exists solely for this card's `bear` ring — do not "fix" it to `V2.red`.

And the reason, at length:

> The IB Read card ONE ROW UP paints its positives and negatives #8ECAE6 / #EF4444; this card, directly below it on the same screen, paints #1FD98A / #FF3B3B. That side-by-side difference is v2's, and it is now DELIBERATE.

Strings: icon 📊, title `Probability Engine`, strapline `Live mathematical projection of final intraday session behavior based on active indicators — {SYM} futures.`, chip `10:30 Close` / `frozen at the IB close` — **hardcoded "10:30"; it does not follow the window selector, so on ORB 15m it labels an 09:45 freeze as 10:30.**

`ENGINE_FLAGS = { showLive: false, showStages: false }` in v2. `showLive: false` collapses the "Live" chip's guard to `!pClose && pClose` — always false — and the live gauges' guard to `!pClose`:

> at the range close the card silently swaps which trio of gauges it is showing, with no label change before the swap.

**The render layer sets both to `true`** and says so, marking it as the tab's one DEPARTURE:

> Step 3's brief requires every engine output string on screen, so `SHOW_STAGES` / `SHOW_LIVE` below are true. Set them to `ENGINE_FLAGS` to restore v2's card exactly — the guards are written the way v2 writes them.

**The 10:30 freeze** lives in a module-level `Map<string, EngineSnapshot>` keyed `` `${sym}-${today}` ``, written in an EFFECT the first time `live.ibComplete` is true. v2 mutated a ref DURING RENDER:

> It survives re-renders and NOT a remount: switching tabs and coming back loses the freeze and re-captures at whatever the state is then, still labelled "frozen at the IB close". The map survives a remount; that is the one correction `ibProbability.ts` asks for by name.

The map is not React state, so a `snapTick` counter is what re-reads it after the effect writes.

## The sixteen owner cards

Behind `Show historical stats ({n} sessions) ▼ (owner)` / `Hide historical stats ▲ (owner)`, **default closed**.

| # | Title | accent |
|---|---|---|
| — | `{winLabel} Stats — {symbol} {barMinutes}m RTH` (five header tiles) | blue |
| ★ | `★ Rule Ranking — highest hit rate first` · `Rules with ≥8 sample days only` | green |
| 0 | `0 · Baseline — IB break behavior` · `The benchmark every rule must beat` | cyan |
| 0b | `0b · Time of IB Break` · `When the first break actually happens` | purple |
| 0c | `0c · Day of the Week` | blue |
| 1 | `1 · Midpoint Close Bias` | cyan |
| 2 | `2 · Formation Order + Midpoint` | green |
| 3 | `3 · Single Break Continuation` · `The claimed 70–85% edge, tested on close-confirmed breaks` | orange |
| 4 | `4 · IB Width → Day Type` · `Narrow → trend/break. Wide → rotation, fade the breaks.` | red |
| 5 | `5 · Breakout Entry — close beyond IB + volume` | green |
| 6 | `6 · Failed Breakout Fade` · `Break closes outside, then closes back inside within 30 min` | red |
| 7 | `7 · 15m FVG inside the IB` | purple |
| 8 | `8 · Retest Continuation` · `Returns to within 2 ticks of the broken level, close holds outside` | cyan |
| B | `B · 0.25 Fib Pullback → Continuation` · `Two readings of "the 0.25 level" — they are very different trades` | green |
| 9 | `9 · Extension Targets` · `Scale-out probabilities, measured from the broken level` | orange |
| 10 | `10 · Close Location in IB Range` | green |
| 11 | `11 · Open Type + IB Width` · `OAR = open outside the prior RTH range · HIR/LIR = open inside it` | purple |
| 12 | `12 · ORB + IB Alignment` · `09:30–09:45 opening range breaks the same way as the IB midpoint bias` | cyan |
| 13 | `13 · Time Filter — when the break happens` · `Hit = extension ≥ 1× IB width` | orange |
| 14 | `14 · Contained Day (rare)` · `Price still entirely inside the IB at 14:00 ET` | red |

> The `accent` prop plumbing is REMOVED: "`PageCard`'s `Card` documents `accent` as ignored and the tab's local `Card` re-implements it as a title colour only — six hues over sixteen cards with no semantic rule. The per-card accent NAMES are kept below as data… but v3 should pick one token for a card title and drop the prop."

`OWNER_CARDS` writes every row's `n` and `hits` explicitly rather than leaving them to the render layer:

> a row's DENOMINATOR is the part a rewrite gets wrong: several of these cards mix populations deliberately (card 9's WIDE row counts a different outcome in the same column; card 17 slices `wd`, not `days`; card 13's two paths are not complementary), and every one of those choices is invisible from the screen.

Header body copy, verbatim, with `break` and `close` bolded:

> `{winLabel} = {range} ET high/low. A break means a bar close outside the range — wick-only touches are tracked separately as the trap set. Extensions, MFE and MAE are quoted in multiples of range width, measured from the broken level. Every rule below is identical across windows, so the tabs above are directly comparable: the shorter the window, the earlier the entry and the higher the both-sides-broke tax.`

Ranking footnote: `Sample size is the first thing to check — a 90% hit rate on 9 days is nothing. A rule at 50±5% is a coin flip.`
Break-time footnote: `The steepest part of this curve is your attention window — that's when to be at the screen.`
DOW footnote: `Read each weekday against the ALL DAYS row, not against 50%. A day only matters if it deviates from the sample’s own baseline by more than a few points — with ~450 sessions per weekday, a 3–4 point gap is still inside the noise band.`

The DOW table is 10 columns wide, `ALL DAYS` totals row, **no sort — always Monday→Friday**, and "Header 3 says 'IB' on every window tab." `DOW_COLORED_COLUMNS = [3, 4, 6]`.

The break-time tile `minsAfterOpen` "subtracts 570 UNCONDITIONALLY, so on an ORB tab it measures from 09:30."

## The EOD scoreboard (owner only)

One row per finished session, **23 columns**, newest at the top. Written at 16:30 ET by `server-v2/ib-results-recorder.js`, read back through `GET /api/ib-results?symbol=ES|NQ&limit=90`.

Columns 1–8 are the session: `Date` (left; the only left-aligned column, everything else is centred) · `Width` · `Bkt` · `Bias` · `1st` · `Break` · `Time` · `1×`. Columns 9–22 are `R1`…`R14`, each with `RULE_NAMES[id]` as its header tooltip. Column 23 is `Shouldn't Be`:

> `The side the 10:30 bias called that did NOT hold — what price shouldn't have been.`

Six documented behaviours:

1. **There is no sort.** Rows render in `data.map` order — the API's order. "No column is clickable, there is no arrow glyph, no default-sort indicator, and `useTableSort` — the shared hook six other scanner tables use — is not imported by this file or by any other file on this tab. If v3 adds sorting it is a NEW feature, not parity, and the incoming order is itself meaningful."
2. **The rule engines use different state vocabularies.** These rows carry `state: "in" | "off"`; the LIVE engine uses `"in-play" | "pending" | "not-in-play"`. "They are not interchangeable and nothing translates between them."
3. **The cell is three-state, and the third is not "no data":** a rule can be scored-and-wrong (✗) or not in play (—). "The dash is also what an absent rule id renders as, with an EMPTY tooltip, so 'the recorder did not grade this' and 'the rule was not in play' look identical." Idle opacity `0.4`.
4. **The hit-rate footer's population is per column** — only rows where that rule was `state === "in"` AND `hit != null` — "which is why the footnote says so out loud." `HIT_RATE_COLSPAN = 8`, label `` `HIT RATE (in-play days only, last ${n})` `` in `V2.accent`.
5. **The card title is hardcoded to `IB 60m (09:30–10:30 ET)`.** The recorder only ever writes the 60-minute window, "so the title is TRUE and the window selector above it is what lies: switching to ORB 15m changes every other card and leaves this one reading 60m data under a 60m title."
6. **`err` is one state, not keyed by symbol, and never cleared.** "An ES failure leaves the red banner up after switching to NQ, even when NQ loads fine." Reproduced deliberately at the effect.

**Code-vs-prose conflict, rule 12:** `RULE_CLAIM['12']` says "inner **30m** ORB". Every implementation uses the 09:30–09:45 **fifteen**-minute range (`lib/ibDaily.ts:169` and `IbStatsTab.tsx:312` both filter `min < 585`). THE CODE WINS; the legend string is wrong, "transcribed verbatim rather than silently corrected, because correcting published copy is a content decision."

**Removed:** the THIRD copy of the rate-colour ladder (v2 types the same four branches at three sites), the SECOND copy of `f1` / `clock`, and the lazy fetch-on-first-expand with its `rows[sym]` cache.

## The dataset's own semantics (not ported as code)

Recorded in `DATASET_MIN_BARS`'s docblock "because every percentage this tab renders is derived from fields written under these rules". Highlights:

- **Day gate:** a session needs ≥ 10 IB bars AND ≥ 10 post bars, and a width > 0, "or it is DROPPED — invisible downstream, with no gap marker."
- `ibVol` is the **MEAN** bar volume, not the total.
- `orb` is `ibBars.slice(0, 3)` — the first three bars **BY POSITION**, i.e. 09:30–09:45 at 5m and 09:30–09:33 at 1m. "The live path and the EOD grader both use `min < 585`, which is bar-size independent."
- `fvg`: 15m candles built by CHUNKING three bars at a time (`i += 3`), not by minute window; the LAST qualifying gap wins. `orbDir` scans `ibBars.slice(3)` and DOES break on the first match.
- `pdh`/`pdl` come from `days[i-1]` — the previous **SURVIVING** session, "which after the day-gate drops is not necessarily the previous calendar session."
- `atr` is a plain MEAN of RTH high−low over the trailing 14 (min 5), **no gap component, no Wilder smoothing**. "'ATR14' overstates it."
- `firstTouch`: the first post bar that wicks outside, **HIGH CHECKED FIRST inside a bar** — so an outside bar always records "H". `lib/ibDaily.ts:114` breaks that tie by magnitude instead, "so the dataset and the EOD recorder disagree on outside-bar days."
- **MFE/MAE over `post.slice(breakIdx + 1)` — the BREAK BAR ITSELF IS EXCLUDED** — as wick excursions in points, then divided by width.
- `failed` within the first **SIX BARS** of that remainder (not 30 clock minutes), freezing `peakBeforeFail` in POINTS at that moment.
- `hit`: `mfe >= t * width`, inclusive, for t in 0.5/1/1.5/2. Keys are `"0.5" | "1" | "1.5" | "2"` — "`String(1)` is `"1"`, never `"1.0"`."
- `fibA` is 0.25 of the IB RANGE back inside the IB, and **`cont` and `fail` are NOT mutually exclusive, so card 14's rows 2 and 3 can sum past 100%.** `fibB` is 0.25 of the post-break IMPULSE and carries ONLY `hit` and `cont` — "`fail`, `mfe` and `lvl` are hardcoded null, which is why variant B has two rows to variant A's four."

## `ibLevels.ts` — transcribed, and deliberately not mounted

747 lines of SVG geometry for a price ladder that **nothing imports**. Every export is tagged `@notWiredInV2`. Three findings change what "porting this" means:

1. **It is not a canvas.** "The file is named `IbLevelCanvas`, its header calls it 'the live IB state canvas', and the empty-state copy says 'The canvas builds itself…'. There is NO `<canvas>` element, NO `getContext`, NO 2D context and NO imperative draw call anywhere in it. The whole picture is ONE declarative `<svg viewBox="0 0 560 460">`." And the DPR note: "Resolution independence comes from the viewBox… That is free here and NOT free in canvas: if v3 rebuilds this as a real canvas it must size the backing store to `cssPx * devicePixelRatio` and `ctx.scale(dpr, dpr)` itself, or the ladder ships blurry on every retina screen."
2. **`data-cb-layer` does not apply** — no canvas to tag. The `<svg>` carries `role="img"` and an `aria-label`.
3. **The visibility guard DOES apply and is absent.** `useEsCandles(true, 1)` — `enabled` is the **hardcoded literal `true`**. "The moment it mounts it holds a socket subscription and re-renders at the feed's 250 ms trailing coalesce — 4 Hz — whether or not a single pixel of it is on screen. Four `useMemo`s re-evaluate and ~20 SVG nodes are diffed four times a second, off-screen, forever."

Five things a revival would have to fix: it is **ES only** (`useEsCandles` with no symbol prop and `/data/ib-ES.json` hardcoded — "the NQ tab would show ES levels"); **60m only** (`IB_START`/`IB_END` are literals, the window selector is ignored); **it blends sessions** (the IB filter is minute-of-day with NO session-date grouping); **only the high-side 0.25 fib is drawn**, so "on a low break the retest line points the wrong way"; and the rail shows the UP ladder whenever the market has not broken down, "including an unbroken session."

Its removals are instructive too: the unscoped `@keyframes ibBrokenPulse` injected as an inline `<style>` which also ignores `prefers-reduced-motion` — "v3's tokens.css carries the global reduced-motion rule; a keyframe belongs there."

## Render notes

The tables are **hand-rolled**, not `design/primitives/Table`:

> That primitive early-returns its `empty` node INSTEAD of the table, which drops the header row — and G169 (an empty Rule Ranking keeps its header), G232 (a footer row spanning eight columns) and G195 (section rows spanning five) all need markup that primitive cannot express. Every class below is the primitive's own vocabulary so the two still read as one table.

Nothing here paints a chart: the Live Read gauge and the engine's three rings are declarative SVG of five nodes each, "so non-negotiables 5, 6 and 7 have nothing to bite on."

`hist` is memoised (`buildHist(days)`), which v2 did not do:

> v2 built this as a fresh OBJECT LITERAL on every render, and it is a dependency of the `live` useMemo, so the whole live computation re-ran every render (G64).

`IbHist.dowStats` is computed and **read by nothing** — kept in the type so the shape matches v2's prop.


---

# TAB 4 — Pick Study (`?tab=pickstudy`) — OWNER ONLY

## What it is

A read-only viewer over `/proxy/gex-change-top-study`. Every GEX Change Top pick that has been graded is bucketed on **ONE capture-time feature at a time**, and the table reports the A/B hit rate per bucket. A calibration block at the bottom **grades the grader**.

Card title `Pick Study` (the card chrome upper-cases it). Subtitle:

> `` `What the graded picks had in common at capture · ${days}d window${loading ? ' · loading…' : ''}` ``

`days` is client state, "so the subtitle names the REQUESTED window immediately, before the response for it lands. The suffix tracks the STUDY fetch only — the calibration and rule fetches have no loading flag at all." **This is the tab's only loading affordance anywhere.**

## The owner gate, precisely

`PickStudyTab.tsx` contains **no owner check of its own**; the gate lives in `scannerNav.ts` and the page shell. What the client actually proves about the server:

> the two POST routes are gated — both branch on 401/403 and throw `OWNER_ONLY_ERROR`. That is the only evidence in the file. The THREE GET routes (…-study, …-calibration, …-rule) have no such branch, which does NOT mean they are ungated — it means this client cannot tell you. Given the tab is owner-only because it is "research in progress, not a customer view", the three reads should be gated server-side too. OPEN QUESTION… do not assume either way.

`OWNER_ONLY_ERROR` = `owner-only — sign in as the owner to change the rule`.

## Data path — five routes

```
GET  /proxy/gex-change-top-study        days, by, cohort   → the buckets
GET  /proxy/gex-change-top-calibration  days, cohort       → the grader's grades
GET  /proxy/gex-change-top-rule         (no params)        → the rule in force
POST /proxy/gex-change-top-rule-fit     days, cohort, apply
POST /proxy/gex-change-top-rule         {"clear":true}     → disarm
```

Params are set in **v2's exact `set()` order** "so the cache key matches call for call". Stale window 10 000 ms (the same remount-dedupe block as the other tabs). **No polling anywhere:**

> Not one of the five has an interval, so there is no visibility gating to add and an off-screen tab costs nothing. If step 3 ever adds a poll, it adds `pollMs` on `useQuery`.

Four things not obvious from the route list:

1. **The three GETs are already parallel.** v2 fires them from three independent mount effects in the same commit — "v3 non-negotiable #3 is satisfied by the v2 code as written." The ONLY chaining is post-mutation (rule → calibration after a fit or a disarm), "which is correct sequencing, not a waterfall."
2. **The calibration takes no `by`.** It is not per-feature, so changing the feature refetches the study and NOT the calibration.
3. **The fit floors its window at 90 days.**
4. No polling.

### Departures (transport only, semantics unchanged)

- `fetch(url, {cache:'no-store'})` → `query(url, {staleMs})`. "Plus v3's in-flight dedupe, so the ↻ button's double-click (v2 leaves it enabled and un-debounced, D28) makes one request instead of two."
- v2 hand-rolls five `fetch` chains with **NO AbortController on any of them**: "toggling `days` twice quickly issues two study requests and whichever resolves LAST wins, which may be the older window. Every read below accepts a `signal`."
- **The three reads THROW instead of returning null.** v2 swallows two of them entirely (`setCal(null)` / `setRule(null)` on both a throw and an `ok:false` body), "which is what makes a 500 on the calibration route render as the words 'nothing is being predicted yet'."

`StudyBodyError` is a typed throw added deliberately:

> v2's `ok:false` branch calls `setData(null)` and erases the whole upper half of the tab (D31, D32), while a THROWN fetch keeps the previous window's numbers on screen (D33, D36). With one untyped `Error` for both, a step-3 port has to pick one and lose the other; with this class it can reproduce both, which is what it does.

The effect's comment names what is NOT cleared:

> Switching feature / window / cohort leaves the PREVIOUS result fully rendered, with only the subtitle's " · loading…" to say otherwise. There is no skeleton on this tab.

### The fit silently widens the window — `// BUG (v2):`

```ts
export function fitDays(days: number): number { return Math.max(days, FIT_MIN_DAYS) } // 90
```

> a user looking at the 14d view clicks "Fit now" and gets a 90d fit with NOTHING on screen saying the window changed. The bucket table above still shows 14 days; the terms below it were fitted on 90. Part D open question 6 asks whether the floor is intended or whether the fit should refuse rather than silently widen.

`apply` is set **only when applying** — "a dry run's URL has no such param at all, rather than `apply=0`. The server distinguishes presence, not value."

### The two writes

Neither goes through `query()`: "it is a GET-only helper with no method or body option, and a mutation that is deduped or served from cache is a mutation that silently does not happen."

`postRuleFit` sends **NO BODY and NO content-type** — everything is in the query string. `apply: false` is a dry run reporting the terms it would arm and every bucket it rejected, "so the rule is never a black box you are asked to trust." The body is handed back **even when `ok` is false**, because v2 renders the preview AND an error line in that case.

`postDisarm` POSTs `{"clear": true}`. Stamped projections are **not** touched:

> they are history, and rewriting them would destroy the calibration, which is the whole point of a table that tests predictions made before the picks did anything.

v2 fetches the response body and throws it away, "so an `{ok:false}` disarm reports success and the bar simply re-renders from the refetched rule." v3 returns the parsed body so a caller CAN check `ok`; whether it does is left open, "and checking it would be a behaviour change."

**Caller contract after `apply: true`:** refresh the rule and THEN the calibration. "Both are needed: the rule feeds the bar, the calibration feeds the body, and refreshing only one is exactly how the two 'armed' flags drift apart."

## Controls and defaults

```ts
DEFAULT_BY = 'score'   DEFAULT_DAYS = 60   DEFAULT_COHORT = 'selected'
DAY_OPTS   = [14, 30, 60, 90, 180]
```

> NOTHING on this tab persists: not to localStorage, not to the URL. All three reset on every remount, and a finding cannot be shared by copying the address bar.

The feature row is **server-driven** (`StudyResp.features`); `FEATURE_FALLBACK` is the one-entry stand-in (`{ key: 'score', label: 'Score' }`) rendered before the first response and after any study error.

**The three cohorts**, in order, with their hints (which double as the button `title` AND the body copy under the headline):

| key | label | hint |
|---|---|---|
| `selected` | Taken | `The picks that made the board — what the cards actually showed.` |
| `shadow` | Passed on | `Candidates that qualified and cleared the entry floor but ranked below the top 5. The control group.` |
| `all` | Both | `Taken and passed-on together — the widest sample, and the least conditioned on selection.` |

Refresh glyph `↻`, "never disabled, never busy — a second click double-fires." `REFRESH_TARGETS = ['study', 'calibration']` — **the rule is deliberately absent**, "one of the two ways to desynchronise `rule.armed` from `cal.armed`. Named so the omission is visible rather than looking like something step 3 forgot." The render layer keeps three separate refresh nonces for exactly this reason.

## Eight pieces of business logic

1. **Thin is a SERVER verdict, not a client comparison.** `bucket.thin` arrives on the wire; the client never compares `n` to `minN`. `minN` is used only to write the two sentences that mention it. Why the flag exists: "At ~15–30 picks a day, a month is ~500 rows, and eight features against 500 rows will hand you beautiful splits that are pure noise."
2. **"Holds" is the out-of-sample filter.** Every bucket is also computed on the first and second half of the window separately, **split by DATE so no session lands on both sides**. `holds` is true only when both halves point the same way as the full window. `firstHalf`/`secondHalf` are read in exactly ONE place — the Holds cell's tooltip.
3. **The verdict is a control-group test and it IGNORES the cohort buttons.** `data.cohorts` is returned as `{selected, shadow}` independently of which cohort is selected, "so the sentence does not change when you flip Taken / Passed on / Both."
4. **The verdict's rounding trap** (below).
5. **Two sources of truth for "armed"** (below).
6. **The fit floors its window at 90 days.**
7. **"Never green" is red under two different rules on the same screen:** `bucketNeverGreenColor` reddens only a bucket worse than the window; `calNeverGreenColor` reddens unconditionally. "Same header string, two meanings."
8. **`GRADES` is order-bearing.** `['A+','A','B','C','D','F']` is both the calibration table's six trailing columns AND the rank used to sort the Predicted column, "so 'A+' cannot land between 'A' and 'B'." `UNKNOWN_GRADE_RANK = 99` sinks an unknown string below F rather than above A+.

## The verdict — `// BUG (v2):` the rounding trap

`VERDICT_PREFIX` = `Taken vs passed on · ` (bold). Returns **null** — the whole box absent — when there are no cohorts, or either side's `pctGood` is null. Branches in order:

1. `c.shadow.n < minN` → neutral ink (`T.text`):
   `Only {n} passed-on pick(s) recorded so far — the control group needs {minN}+ before this comparison means anything. It starts filling from the deploy that turned shadow recording on.`
   "Neutral, not a warning: nothing is wrong, there is simply not enough yet."
2. `|d| < 5` → `V2.orange`:
   `Taken picks hit {x} vs {y} for the ones passed on — a {±d}pt gap. That is inside the noise: on this sample the top-5 cut is not doing measurable work.`
3. `d > 0` → `V2.up`. **Note this branch drops "for the ones"** — the only one of the four that does:
   `Taken picks hit {x} vs {y} passed on — {+d}pts. The ranking is selecting something real.`
4. else → `V2.red`:
   `Taken picks hit {x} vs {y} for the ones passed on — {−d}pts. The picks you skipped did BETTER. Check the ranking before tuning anything else.`

The bug:

> `d` is compared at FULL precision (`< 5`) but printed through `signed()` at 0 dp. A gap of 4.6 therefore takes the "inside the noise" branch while printing "+5pt", and −4.6 prints "-5pts" in an orange box. The code is right and the sentence looks wrong. Ported exactly as written: rounding the comparison instead would silently move the boundary, and printing a decimal would change four sentences' typography.

Fallbacks when the server omits a value: `MIN_N_FALLBACK 30`, `NEED_FALLBACK 150`, `BASE_FALLBACK 50` — "whether 30 / 150 / 50 are the real server defaults is Part D open question 8."

## The bucket table — nine columns

| key | Label | Align | title |
|---|---|---|---|
| `bucket` | Bucket | left | — |
| `n` | n | right | — |
| `pctGood` | A/B rate | left | — |
| `lift` | Lift | right | `Hit rate minus the window's overall hit rate. This is the number that matters.` |
| `holds` | Holds | right | `Does the split point the same way in BOTH halves of the window? A ✗ means it did not survive out of sample.` |
| `neverGreen` | Never green | right | — |
| `avgPts` | Avg pts | right | — |
| `medSustained` | Med. sustained | right | `Median best gain that held for two consecutive snapshots — a fillable move, not a one-print spike.` |
| *(null)* | *(blank)* | right | the copy-term column — **not sortable**, a plain `<th>` |

(The period after "Med" is in the source label.)

`LIFT_UP_PT = 8` / `LIFT_DOWN_PT = -8`, **inclusive both sides: +8.0 is up, +7.9 is not.** Lift cell reads `+12pt` — **singular "pt", no "s"**; a dash carries no suffix. Med. sustained reads `+3%`; a dash carries no `%`.

Holds glyphs: `✓` / `✗`. Thin rows render at `THIN_ROW_OPACITY = 0.45` with a `thin` badge whose tooltip names `minN`.

`RateBar`'s fill stays `V2.cyan` while the Lift value beside it takes the up/red pair — and the reason is spelled out so it is not "tidied":

> The bar encodes MAGNITUDE and is deliberately not a threshold mark; unifying them would make an 8% hit rate and a −8pt lift the same colour. The next reader will try to merge them — this paragraph is why they should not.

**Empty row:** `No graded picks in this window yet.`, spanning `BUCKET_COLUMN_COUNT` = 9 — **correct in v2**.

**Footnote** (bold runs: `first`, `Holds`), rendered whenever `data` exists — including when `buckets` is empty, because it is the only place `splitDate` is rendered:

> `Features come from the slot each pick was first flagged — the only source that cannot see the outcome. Lift is this bucket's A/B rate minus the window's. Holds recomputes the split on each half of the window separately (split at {splitDate}, by date so no session lands on both sides); a ✗ means it did not survive out of sample and is not a finding. Buckets under n={minN} are greyed.`

**The copy-term button:** `⧉ term` / `✓ copied` (`COPIED_RESET_MS = 1600`). Payload `{"by":"score","bucket":"70-79","pts":12}` — `by` prefers the SERVER's echoed `data.by` over client state "so a term copied mid-refetch names the feature the numbers actually came from", and `pts` is `Math.round` of the lift, **a NULL lift becoming 0, which is a term that does nothing.** Title, two lines joined by a literal newline:

> `Copy this bucket as a projection-rule term for server-v2/config/pick-proj-rule.json.\nThe SIGN is what the data supports; the magnitude (lift used directly as points) is a convention you should sanity-check.`

And the note on whether it survives:

> it is also the one control that can silently do nothing: a blocked clipboard produces no ✓ and no error.

Sorting: `cycleSort` / `applySort` / `compareSortValues`. Arrows `▲` / `▼` / `↕` with `SORT_INACTIVE_OPACITY = 0.32`.

## The calibration table — eleven columns, `colSpan={10}`

Five fixed columns (`Predicted` left · `n` · `Actual A/B` left · `Never green` · `Avg pts`) plus **one per grade** = eleven. Each grade column's title: `` `How many of these picks actually graded ${g}.` ``

**`// BUG (v2):`**

> the empty-state row is `<td colSpan={10}>` against these eleven columns, so the cell under-spans by one and the last grade column sits outside it. The bucket table's equivalent (colSpan={9}) spans correctly, which is what makes this a slip rather than a convention.

`CAL_COLUMN_COUNT` is **derived, not typed**, and the render layer uses it — the one place this port corrects v2:

> It is a correction only in the sense that the correct number is already derived from the column list, so writing anything else would mean typing a literal that the header row can drift away from.

`gradeCount(r, g)` = `r.actual?.[g] ?? 0` — "a missing key and a real 0 are indistinguishable." `gradeCountIsDim` tests **truthiness**, so a zero renders as `0` dimmed.

Section title `Calibration · grading the grader` — **not upper-cased, unlike the card title.**

Pre-table line, chosen on the **truthiness** of `cal.unprojected` (so 0, undefined and null all take the second string):

- `{n} pick(s) were captured before the rule was armed and carry no projection — they are excluded from this table, not counted as misses.`
- `Every pick in the window carries a projection.`

Empty: `Rule is armed but no picks carry a projection yet — they start appearing at the next capture.`

Footnote:

> `Read down the Predicted column: the A/B rate should rise monotonically from F to A+. If it does not, the rule is not ranking. Projections are stamped at capture and never recomputed, so retuning the rule leaves the old predictions intact — which is what makes this table a real out-of-sample test rather than a restatement.`

## The rule bar — two sources of truth for "armed"

`ruleBarArmed(rule)` reads `/…-rule`. `isNotArmed(cal)` reads `/…-calibration`. **They can disagree on screen** — "the bar can say 'Armed' with term chips above prose saying 'Nothing is being predicted yet'", and the ↻ button is one of the two ways to get there.

`isNotArmed` also collapses four distinguishable states into one screen: a first paint, a thrown calibration fetch, an `ok:false` body and a genuinely un-armed rule all land on `cal === null`.

Status words: `Armed` / `Ready to arm` / `Collecting evidence`.

Auto-fit suffixes:
` · re-checked automatically after every EOD freeze` / ` · auto-fit is OFF (GEX_CHANGE_TOP_AUTOFIT=0)`

And the third `// BUG (v2):`:

> When the RULE FETCH FAILED, `rule` is null, so the ternary takes the OFF branch and the bar prints "auto-fit is OFF (GEX_CHANGE_TOP_AUTOFIT=0)" — an unknown state stated as a fact, indistinguishable from cold start. Shipped as written; v3 needs a third string, which is a copy decision.

Buttons: **Fit** (`fitting…` / `Re-fit (preview)` / `Fit now`), **Arm** (`arming…` / `Re-fit & store` / `Fit & arm`), **Disarm** (`…` / `Disarm`, shown only per `showDisarm(rule)`, ink `V2.red`). Fit results: `Fit stored` / `Fit result (not stored)` / `Nothing to arm`, with a `✕` dismiss and a rejection audit.

**The not-armed prose**, three paragraphs (bold runs `not thin`, `hold`, `Fit now`; one `<code>` run in `V2.cyan`). This is the DEFAULT state of the tab:

> `Nothing is being predicted yet, so there is nothing to calibrate. That is deliberate and it is not permanent: a projection seeded with plausible-looking guesses is indistinguishable on screen from one backed by evidence, so the rule stays inert until the study can support one — and then arms itself.`
>
> `The fit uses the same two filters this page tells you to read by eye: a bucket must be not thin and must hold in both halves of the window. Each surviving bucket becomes one term whose points are its measured lift, clamped. It refuses to fit on ticker, and drops the |Δ GEX| and |% vs open| terms when the blended Score already covers them, so one edge is never counted three times. Hit Fit now to see exactly what it would arm and everything it rejected.`
>
> `Hand-pinning still works and still wins: drop server-v2/config/pick-proj-rule.json and the auto-fit stands down rather than overwrite it.`

Error strings: `load failed` (study `ok:false` fallback) · `fit failed` · `Error: ` prefix.

**Colour split on this tab:**

```
(a) chrome ............ both table header rows            → V2.green
(b) semantic positive . ✓ holds, lift >= 8, +ve term chip → V2.up
(c) a state ........... the "Armed" word and the Arm btn  → V2.up
(d) a confirmation .... the transient "✓ copied"          → V2.up
```

> The result in v2 is that a `>= 8` lift — the strongest signal in the table — is painted the exact same colour as the column headings above it.

Reds split by MEANING, not value: a signed negative (`HEADLINE_BAD_COLOR`) and an alert (`ALERT_COLOR`) are two different ideas, "but v2 paints both `HOME_THEME.red` — so both take `V2.red` and stay separate CONSTANTS so they can move apart later without a hunt."

The tables here are hand-rolled for the same reason as IB Stats': "`Table` early-returns its `empty` node INSTEAD of the table, which drops the header row — and D74 / D119 both need a spanned cell under a header."

**Removed:** `new URL(path, window.location.origin)` ("does not exist during SSR or in a test renderer"); the `.finally(() => setLoading(false))` bookkeeping; and the un-cleaned 1600 ms `setTimeout` behind "✓ copied" — "it must not survive as written — no clearTimeout on unmount means a setState after unmount."

---

# TAB 5 — Strike Query (`?tab=strike`)

## What it is

A card titled **`Strike GEX Query`** holding a toolbar, a Top-10 card block and a sortable table of strikes ranked by GEX and its 15/30/60-minute deltas, fanned out across the watchlist.

Subtitle (`sqSubtitle`), a spaced middle dot between parts:

```
Top movers by strike · {ticker|all watched tickers}[ · above spot · Δ↑ | · below spot · Δ↓][ · OTM ≥N%][ · loading…]
```

> What it deliberately never mentions: the selected Expiry, the Limit, or the card scope — three of the seven controls are invisible in the header summary.

`· loading…` is **the only loading affordance on the tab. No spinner exists.**

## ONLY THE TICKER REFETCHES

This is the single most important property of the tab, and it is enforced as exported data:

```ts
SQ_REFETCH_INPUTS     = ['symbol', 'watchlistLength']
SQ_CLIENT_ONLY_INPUTS = ['expiry', 'limit', 'dir', 'minOtm', 'cardScope', 'sort']
```

> Each of these re-runs `sqFilterRows` / `sqDisplayRows` / `sqTopCards` over rows ALREADY IN STATE. Putting any of them in a fetch key turns one request per ticker change into six, which is the single most important thing this port must not do.

They are exported "so a step-3 query key can be asserted against it in review", and the module deliberately exports **no function that takes a filter, a limit or a sort.**

## Data path — two endpoints

| URL | When | Stale |
|---|---|---:|
| `/proxy/strike-growth/watchlist` | once, at mount | `SQ_WATCHLIST_STALE_MS` 60 000 |
| `/proxy/strike-growth/by-expiry?symbol=…` | one per TARGET ticker, in parallel; re-fired only on a ticker change or when the watchlist first arrives | `SQ_ROWS_STALE_MS` 15 000, or **0** on `force` |

`SQ_ROWS_STALE_MS` is 15s because "the recorder writes a snapshot every ~5 minutes, so a 15s window costs no freshness a user can observe while still absorbing a re-render storm or two mounts of the same tab." `↻ Refresh` passes `force` — "a button labelled Refresh that returns a cached body is a lie."

**No polling.** v2 has none at all: no `setInterval`, no visibility hook, no market-hours gate. `pollMs` is deliberately not passed — "quietly adding one would change the tab's egress profile without anyone deciding to."

Three behaviours:

1. **The fan-out is a fan-out, not a waterfall.** `ALL` fires one request per watched ticker simultaneously (ten with the fallback universe), with **no concurrency cap**.
2. **One dead ticker is silent.** Each mapper swallows its own rejection and contributes zero rows. "A ticker that 500s is therefore indistinguishable from a ticker with no recorded strikes."
3. **The client overwrites `symbol`.** Every row is re-stamped `{ ...r, symbol }` with the symbol that was ASKED FOR. "Anything the server says about the symbol field is discarded."

### The error path is structurally unreachable

> v2 wraps the fan-out in a try/catch that sets an error banner, but `Promise.all` over mappers that each swallow their own rejection CANNOT reject. Only a synchronous throw in the four merge lines could set it, and none of them can throw. So the banner is dead code in practice, and the real consequence is the one in note 2: a per-symbol 500 renders as "No rows yet…" — the same sentence as an empty result set.

`failed` is returned as **new information v2 threw away**; nothing renders it yet.

### Departures

- `query()` instead of raw `fetch`: v2 has no `AbortController` and no request key, "so switching ticker mid-flight leaves the old fan-out running and whichever `setRows` resolves LAST wins — a stale response can overwrite a newer one." The render layer adds a `seq` counter on top.
- **One caching policy, not two.** v2 sent `{cache:"no-store"}` on by-expiry and *nothing at all* on watchlist, "so one endpoint bypasses the HTTP cache and the other takes whatever the browser decides."
- **Symbols are URL-encoded.** v2 interpolated raw. "Every symbol in the universe is alphanumeric so nothing changes today; the encode is there so a future ticker with a `+` or a `/` does not silently query something else."

### The watchlist's three silent failure modes

All collapse to the SAME empty array, deliberately, because that is what the caller reacts to: the request rejects (`.catch(() => {})`), `ok` is falsy (early return), or every row has `active: false`.

> There is no error text, no retry and no console line for any of them. The caller CANNOT tell a down proxy from an empty roster.

The sort is `Array.prototype.sort()` with **no comparator** — default lexicographic, which feeds the Ticker dropdown.

## Universes

```ts
SQ_FALLBACK = ['SPX','SPY','QQQ','NVDA','AAPL','TSLA','AMZN','META','MSFT','GOOGL']  // 10, THIS order
SQ_INDICES  = Set(['SPX','SPY','QQQ','IWM','NDX'])   // 5 — the "All − Indices" exclusion
SQ_CAP_ONE  = Set(['SPX','SPY','QQQ'])               // 3 — the Top-10 one-slot cap
SQ_TOP_CARDS = 10
```

`SQ_FALLBACK` is unsorted on purpose: "the order is visible: it is the dropdown's order and it is the concatenation order of the fan-out, which is in turn the stable-sort tie-break for every comparator."

**The asymmetry is v2's and is ported as-is:**

> IWM and NDX are excludable by the scope toggle but are NOT slot-capped — either of them can take all ten cards. The Top-10 header string says "SPX/SPY/QQQ 1 slot each", which matches `SQ_CAP_ONE` and NOT `SQ_INDICES`, so the visible copy is consistent with the cap and silent about the exclusion.

## `sqVal` — null becomes ZERO

```ts
const v = c === 'strike' ? r.strike : r[c]
return v == null ? 0 : Number(v)
```

> NULL BECOMES ZERO — not `-Infinity`, not "sorts last". A row whose 15-minute change was never recorded ranks exactly where a measured flat row ranks, in the middle of an `Math.abs()` ordering. Every comparator and both filters read through this, so the coercion decides row ORDER as well as text. Do not "fix" it here: the fix belongs upstream, in a real "no data" sort bucket, and it needs the API's answer to whether null means "insufficient history" or "no change".

…and that same null is then rendered **two ways**: `sqCardMetricText` prints `+0` in the up colour on a Top-10 card (`0 >= 0`), `sqDeltaCellText` prints an em dash in `T.text` in the table. Both exported separately rather than reconciled; `SQ_NULL_CHG_RENDER` states the conflict.

## The four filters, IN ORDER

```
1. expiry     SQ_ALL passes everything, otherwise an exact match
2. card scope 'exidx' drops SQ_INDICES.  THIS FILTERS THE TABLE TOO
3. min OTM    only when > 0, boundary >=, so 0.05 KEEPS a strike exactly 5.0% away
4. direction  only when not 'all'
```

> Order matters and is not incidental: the direction filter reads the sort column and the min-OTM filter reads spot, so any reordering changes which rows survive, not just how fast.

`sqOtmDist` returns a **fraction** (0.05 = 5%), symmetric, and **0 when spot is null/undefined/zero/negative** — "that is not neutral: `0 >= 0.02` is false, so a row with no usable spot is silently dropped by any `minOtm > 0` filter and kept when `minOtm === 0`."

### `sqDirPass` — `// BUG (v2):`

> this tests the sign of the ACTIVE SORT COLUMN, not of GEX. The control's own tooltip promises GEX specifically… and the tooltip is only truthful while the sort happens to be on `gex_now`, which is merely the default. Sorting by `strike` makes `v = r.strike`, always positive, so `Negative` returns ZERO ROWS for every input; sorting by `delta_abs` (already a magnitude) does the same. Two of the six sort states therefore make "Negative" an empty set, and the empty-state row gives no hint why.

Both boundaries strict: a strike exactly at spot, or a metric of exactly 0 (**which includes every null**), fails BOTH directions. The fix, when taken, "is to name the metric — `sqVal(r, 'gex_now')` — not to change the tooltip."

## Comparators

```ts
return col === 'strike' ? bv - av : Math.abs(bv) - Math.abs(av)
```

> `strike` compares SIGNED values; every other column compares `Math.abs()`. So in "desc" a Δ 15m of −800M outranks one of +200M, and `delta_abs` — already a magnitude — gets a double-abs that is a no-op.

Nulls arrive as `0`, landing last in desc and first in asc, "mixed indistinguishably among genuine zeros." **Ties keep the input order** — `sort` is stable and the input order is the fan-out concatenation order.

The table caps AFTER the sort, "so it is a true top-N and not a window."

### `sqTopCards` — `// BUG (v2):` and a structural warning

> `f.sort.dir` is NOT applied here. Flipping a column header to ascending reverses the TABLE while the cards stay descending — so the two lists silently disagree about what "top" means in exactly one of the two arrow states.

And the trap the port must not reproduce:

> The `All` / `All − Indices` toggle is drawn inside this block's HEADER, yet line 697 applies `cardScope` to `displayRows` as well — it filters the TABLE, and nothing in the UI says so. Worse, v2 gates the entire block on `topCards.length > 0`, so when the toggle empties the view the header that holds the toggle unmounts with it: the control disappears at precisely the moment a user needs it to undo what it just did… step 3 must NOT reproduce the unmount trap — the scope control belongs in the toolbar with the other filters, which are always mounted.

The cap walk: rank, take rows in order, skip a `SQ_CAP_ONE` symbol that already has a card, stop at ten. Fewer than ten eligible rows yields fewer than ten cards.

## The columns

`SQ_COLUMNS` — six sortable, in order:

| key | Label | kind | signColoured |
|---|---|---|---|
| `strike` | Strike | rawNumber (no `$`, no `toFixed`, no separator) | no |
| `gex_now` | GEX Now | magnitude (`fmtB`) | **no** |
| `chg15` | Δ 15m | nullableMagnitude | **yes** |
| `chg30` | Δ 30m | nullableMagnitude | **yes** |
| `chg60` | Δ 60m | nullableMagnitude | **yes** |
| `delta_abs` | Delta Abs | magnitude | **no** |

> SIGN COLOURING IS INCONSISTENT BY COLUMN IN v2 AND IS ENCODED PER COLUMN RATHER THAN NORMALISED: the three Δ columns are green/red, while `GEX Now` and `Delta Abs` are plain text whatever the sign — a negative GEX Now and a negative Δ 15m in the same row are painted differently, and the only thing carrying the sign on the former is the `-` inside `fmtB`'s own string. Do not "tidy" this into one rule here.

`SQ_FIXED_HEADERS`: `Symbol` and `Expiry` (the two optional leading columns, shown only when the corresponding filter is `ALL`) and `OTM%`, which is **not sortable** — no arrow, no click target, no `SqCol` entry:

> OTM% is NOT in this list and must not be added: it is not a `SqCol`, it has no sort handler, no arrow glyph and no cursor change.

Empty `colSpan` = `SQ_COLUMNS.length + 1 + (showSymbol) + (showExpiry)` — 9 with both, 8 with one, 7 with neither.

Sort arrows each carry a **leading space**: `' ↓'` / `' ↑'` / `' ⇅'` (U+21C5), "and the inactive one is dimmed rather than hidden so every sortable header always carries a glyph." `sqToggleSort`: clicking the active column flips direction; clicking any other always restarts at `desc`. "There is no third 'unsorted' state."

**OTM% orange threshold** is a hardcoded **5** in PERCENT (not a fraction, unlike `SQ_MIN_OTM_OPTIONS`), and is **independent of the `min OTM` filter**:

> set min OTM to 10% and every visible row is orange, because every visible row is by definition past this mark.

`sqOtmText` prints `3.4%` at one decimal, or an em dash when spot is null/undefined/**or 0**; a row with no usable spot has `sqOtmDist` 0, "so its em dash is painted the dim colour, never orange."

## Toolbar options and defaults

```ts
SQ_DEFAULTS = { symbol:'ALL', expiry:'ALL', limit:25,
                sort:{col:'gex_now',dir:'desc'}, cardScope:'all', dir:'all', minOtm:0 }
```

> NOTHING IS PERSISTED — no localStorage, no sessionStorage, no URL param anywhere in this tab — so every one of these is restored on every remount.

- **Ticker** — `ALL` first, then the universe in ITS OWN order. Never empty. **The only control that refetches.**
- **Expiry** — `ALL` / `All Expiries` is "the one place on this tab where a value and its label differ". Expiry strings render RAW from the API — no reformatting, no locale pass. Derived per load via `Array.prototype.sort()` with no comparator, "which is also chronological for ISO `YYYY-MM-DD` and is NOT for any other format the API might send." `sqReconcileExpiry` snaps back to `ALL` when the selection no longer exists, "rather than leaving a filter selected that matches nothing."
- **Limit** — `10 / 25 / 50 / 100`, default 25.
- **Direction** — `All / Positive / Negative`, tooltip (v2's, and it names GEX):
  > `Positive = OTM strikes above spot with rising GEX (Δ↑) · Negative = OTM strikes below spot with falling GEX (Δ↓)`
- **min OTM** — `any / 2%+ / 5%+ / 10%+ / 15%+ / 20%+` as fractions. Labels use a trailing `+` while the card subtitle uses a leading `≥` for the same idea — "two spellings, both v2's." `any` is `0`, which **skips the filter entirely** rather than filtering at `>= 0`.
  Label is lowercase `min`, uppercase `OTM`, and **not** uppercased by CSS.
- **Card scope** — `All` / `All − Indices` (**U+2212 MINUS SIGN, not a hyphen**).
- **`↻ Refresh`** (U+21BB then one space) — never disabled while loading.
- **`click a column header to sort`** — all lowercase, never changes, never hides.
- **`|`** — a literal pipe glyph, not a rule element.

Top-10 header: `` `Top 10 · ${activeSortColumnLabel} · SPX/SPY/QQQ 1 slot each` `` — the middle segment changes on every header click.

**The one empty-state sentence:**

> `No rows yet. Needs recorder history for the selected ticker(s).`

with the literal `(s)`, and:

> It does not distinguish its four causes — API returned nothing, the expiry filter matched nothing, min OTM excluded everything, or the direction filter is structurally empty — and offers no reset.

## Rendering

Zebra runs **opposite ways** in the two blocks: table rows are `i % 2 ? alpha(T.text, 0.02) : 'transparent'`; cards are `i % 2 ? alpha(T.text, 0.02) : alpha(V2.cyan, 0.06)` — "Cards alternate the OTHER way." Row keys are **index-suffixed** (`` `${symbol}-${expiry}-${strike}-${i}` ``) "so nothing is reused across a re-sort."

The table is hand-rolled because `Table` would drop the header row, and E115 requires "the header row still renders, so the tab is not blank" before the first fetch settles.

**A rule carried over from deleted code.** v2 had a `ModalPortal` helper; it is dead (a whole-tree grep returns only its own declaration) and is NOT ported. Its insight is kept as a v3 rule:

> `position: fixed` resolves against the VIEWPORT only while no ancestor has a transform, filter, backdrop-filter, perspective, will-change or contain. Every card surface sets `backdrop-filter: blur(16px)` and the hover lift adds a `transform`, so an overlay rendered inside a card has `inset: 0` cover THE CARD — it looks centred because it is, on a card two screens down. Any floating layer must portal to `<body>`.

This tab opens no socket and mounts no canvas.


---

# TAB 6 — Watch This — Far CB (`?tab=watch`)

## What it is

**Four surfaces, one card** titled `Watch This — Far CB` (the em dash is in the source string; the card chrome upper-cases it). In render order: the **flag-card grid**, the **flat twelve-column outcomes table**, the **`ResultsByDay` day view**, and the **`OutcomeDetailPanel`** that expands under a row of EITHER table — one instance, built once, handed to both call sites, "so only one detail is ever open across the whole tab."

Subtitle:

```
Highest GEX strike within 30d expirations, far OTM vs spot · scanner universe[ · >N% OTM][ · refreshing…]
```

`threshold` prints **RAW** — no rounding, no `toFixed`. The `· >N% OTM` clause is **omitted entirely** when the endpoint returns no threshold. `· refreshing…` is appended on every load and `loading` starts true, "so the first paint always carries it."

## The selection rule

No server code for `/proxy/far-cb-watch` exists in the v2 tree, so `FAR_CB_SELECTION_RULE` is the CLIENT's statement of it:

```
single highest |GEX| strike per ticker,
over expiries ≤ 30 DTE,
on the OI+Vol canonical net-GEX basis,
flagged when that strike is MORE THAN `threshold`% away from spot (strictly >, never >=),
universe = the scanner watchlist plus anything POSTed to /api/far-cb-tickers,
at most 50 rows.
```

`FAR_CB_FALLBACK_THRESHOLD_PCT = 15` is **the only client-side threshold literal on the tab**, applied only when the field is absent.

**Code-vs-comment conflict, code wins:**

> v2's block comment says "highest GEX strike"; the rendered footer says "highest |GEX| strike" — absolute value. The rendered string is what the user reads, and it is corroborated by the code: `up = r.gex_value >= 0` only earns its keep if rows can carry NEGATIVE `gex_value`, which is a thing only an absolute-value ranking produces.

**And the two strings disagree on screen:**

> When the endpoint omits `threshold`, the footer prints ">15%" from the fallback while the subtitle DROPS its threshold clause entirely. Same missing field, two different answers, both visible at once.

## Data path — four endpoints, two polls, one mutation

| Const | URL | Limit | Poll | Stale |
|---|---|---:|---:|---:|
| `EP_FAR_CB_WATCH` | `/proxy/far-cb-watch?limit=50` | 50 | `WATCH_POLL_MS` 120 000 | 10 000 |
| `EP_FAR_CB_OUTCOMES` | `/proxy/far-cb-outcomes?status={view}&limit=100` | 100 | `OUTCOMES_POLL_MS` 60 000 | 10 000 |
| *(results page)* | `/proxy/far-cb-outcomes?status=all&limit=300&quotes=0` | 300 | **none** | 10 000 |
| `EP_FAR_CB_OUTCOME_DETAIL` | `/proxy/far-cb-outcome-detail?symbol=…&strike=…&expiry=…` | — | none | `DETAIL_STALE_MS` **0** |
| `EP_FAR_CB_TICKERS` | `POST /api/far-cb-tickers` | — | — | raw `fetch` |

`status` is the view selector **verbatim** — `all | open | touched | expired` — "so the flat table's filtering is SERVER-side, not a client filter over a cached page." `results` is the fifth view and must never reach there; `OutcomeStatusView = Exclude<OutcomeView,'results'>` "so the mistake cannot compile."

### Six behaviours

1. **The flag feed reads the body as text first, then parses it itself.** v2 never checks `res.status`: it takes `res.text()`, tries `JSON.parse`, and on failure throws `Server returned {status} (non-JSON).`
   > That string is not cosmetic — it is the ONLY reason a 503 HTML error page reaches the "Recorder hasn't run yet" branch, because `isRecorderNotRunError` matches the SUBSTRING "503" and that substring arrives inside the message the client just composed.
2. **The two polls disagree about hidden tabs, and only one of them meant to.** The 60s outcomes poll early-returns on `document.hidden` (v2, with a comment saying why); the 120s flag poll has no such check "and runs at full rate in a background tab. That asymmetry is v2's, it is undefended, and it is what THE ONE DELIBERATE DEPARTURE closes."
3. **The outcomes feed swallows everything** — a bare `catch {}` and `if (j.ok) setOutcomes(...)`, so an `ok:false` body is dropped silently too. "The table simply keeps whatever it had, with no error, no empty state and no way to tell a dead endpoint from a genuinely empty result." `loadOutcomes` returns the failure as a VARIANT so step 3 can decide.
4. **The results view asks for a DIFFERENT page of the same endpoint.** `status=all` because the per-day counts must be complete; `limit=300`, "which the v2 comment calls the endpoint's ceiling"; and `quotes=0`, "because `ResultsByDay` renders only per-day counts and flag fields and never touches a contract price column, so there is no reason to make the server price 300 contracts." Different URL ⇒ different cache entry ⇒ a different request, not a filter over rows already held.
   Once the tracker holds more than 300 flags "the per-day counts silently become partial with nothing on screen saying so."
5. **The detail request is race-guarded by a COUNTER, not by an abort** in v2 — `detailReq = useRef(0)`, every branch bailing when the counter moved. "The request still completes and still downloads; it is only prevented from painting." v3 expresses it as data: `useQuery(openRow ? detailUrlFor(openRow.row) : null)`.
6. **Re-opening a row always refetches.** There is no detail cache in v2. `DETAIL_STALE_MS` is deliberately **0** "so a repeat open is a repeat request, rather than the port being quietly stale where v2 was live."

### The one deliberate departure

**The 120s flag poll now stops on a hidden tab, and that is a fix.**

> For the 60s outcomes poll that is a faithful port: v2 hand-rolled exactly that check. For the 120s flag poll it is a BEHAVIOUR CHANGE — v2 kept requesting a 50-row scan every two minutes in a window nobody was looking at… It is safe because the flag feed is a CURRENT-VALUE read: a missed sweep is repaired by the next poll, and the recorder — which sweeps every 30 minutes during RTH — is the thing that actually accumulates the record. Nothing is lost by not asking.

The error ladder survives the transport change unchanged, and the file walks all three cases:

```
v2, 503 + JSON body → j.error "no DB"                           → matches "no DB"
v2, 503 + HTML body → "Server returned 503 (non-JSON)."         → matches "503"
v3, either          → "503 Service Unavailable — /proxy/far-cb-watch" → matches "503"
```

All three render the same sentence. The one case needing help is a **200 carrying non-JSON**, where `res.json()` throws a `SyntaxError` with no status in it; `loadFarCbWatch` maps that back onto `nonJsonError(200)`.

### The mutation

`POST /api/far-cb-tickers` with `{symbol}` — the only raw `fetch` in either data file, "and it is a genuine mutation, which is the only thing that earns one." v2 reads `res.json()` **unconditionally** and then throws `j.error || "Add failed"` on `!res.ok`, "so the server's own sentence wins ('Sign in to add a ticker' on a 401, 'Ticker is required' on a 400, `libDb.addFarCbTicker`'s own rejection on a duplicate)". One addition: `credentials: 'same-origin'` — "a route gated `auth: 'user'` must not be the one call in v3 that leaves its auth to a default."

**Nothing refetches on success:**

> v2 does not call `load()`; the added ticker appears only when the 2-minute poll happens to run after the server's next sweep, which is what `addSuccessMessage` is telling the user. Preserved — do not "helpfully" invalidate the flag feed here, because the row will not be there yet and an immediate refetch would look like the add failing.

`GET /api/far-cb-tickers` exists and answers `{ok, rows}` — and **the tab never calls it**:

> the tab can add a ticker and cannot list what is on the watchlist. The universe is visible only as whatever the recorder happens to flag, which is why the card subtitle can say "scanner universe" without anything on screen naming it.

Only the PATH is written down (`EP_FAR_CB_TICKERS_LIST`); no loader and no response type, "because the row shape is `libDb.listFarCbTickers()`'s and guessing at it would put a wrong type in the tree."

## The add row

Placeholder `Add a ticker (e.g. RDDT)`, `maxLength` **6 characters**, button `+ Add` / `Adding…`. `normaliseTickerInput` is `trim().toUpperCase()` applied **at submit time only** — "the input holds raw keystrokes". An empty trimmed value bails silently **without clearing the previous status message**.

Success: `` `${symbol} added — appears after the next sweep.` `` — **never auto-dismisses**, it persists until the next add attempt. Failure keeps the input and shows the server's sentence.

**`// BUG (v2):`** the `+ Add` button is `disabled` mid-POST but the input's Enter handler is not, "so Enter can double-post." `canAddTicker(raw, adding)` is the guard both call sites share — and **this is the one place the render layer closes a v2 gap**:

> That is the render layer honouring a guard the logic module wrote, not a new decision taken at the keyboard.

Refresh: `↻ Refresh` with the note `Refreshes every 2m · recorder sweeps every 30m during RTH` — "The '2m' matches the code. The '30m during RTH' is a claim about the server-side recorder that nothing on the client can verify."

## The flag grid

Row key `` `${symbol}-${expiry}-${strike}` ``. `isCallSide(r)` is `gex_value >= 0` — **inclusive, so an exact zero reads as call-side** — and drives four colours plus the `Call-side`/`Put-side` word.

Card body sentence, `otm_pct` at **zero** decimals and `spot` at two:

> `Highest GEX level for {SYM} is the ${strike} strike ({expiry}), {N}% away from spot (${spot}) — farther out than the usual near-the-money CB. {Call-side|Put-side} dominant.`

Badge `WATCH THIS`. Labels `OI+VOL ` and `VOL ` — **the trailing space is in the string**. `View chain →` links to `/options-chain?symbol=…&expiry=…&strike=…`; `strike` is **not** `encodeURIComponent`'d — "it is a plain number, so it is safe in practice. Kept as-is rather than 'fixed', because changing it changes the URL for a fractional strike."

`fmtStrike` is raw: `5900` prints `$5900`, `5902.5` prints `$5902.5`. `fmtSpot` is two decimals and **not null-guarded** — "a null spot would throw, as in v2."

**`// BUG (v2):` `volGexColor`** tests `(gex_value_vol ?? 0) >= 0` while the TEXT tests `!= null`, "so a NULL vol-GEX is painted as positive while displaying an em dash."

Error banner renders **whenever `err` is truthy, including while loading** — there is no `!loading` guard. `flagErrorText` maps `no DB` or `503` substrings to:

> `Recorder hasn't run yet — data appears after the first RTH sweep.`

Empty (requires **all three**: no rows, not loading, no error):

> `Nothing flagged right now — no watchlist ticker has an unusually far-OTM dominant CB level.`

`FLAG_GRID_HAS_NO_LOADING_STATE = true` is an exported assertion:

> There is NO loading state for the flag grid — no spinner, no skeleton. The only loading affordance is the `· refreshing…` suffix on the subtitle, and old rows stay on screen through a refresh.

Footer:

> `Basis: OI+Vol net GEX (canonical) · single highest |GEX| strike per ticker across expiries ≤30 DTE`
> `Flagged when that strike is >{N}% away from spot`

## Tracked results — the view selector

`OUTCOME_VIEWS = ['all','open','touched','expired','results']`, labels built by upper-casing the first letter. `DEFAULT_OUTCOME_VIEW = 'all'`, **not persisted anywhere — no storage, no URL param.** Four are SERVER-side status filters on the flat table; `results` is a CLIENT-side roll-up grouped by calendar date.

Hints:

- results: `One row per date · how many flags opened, were touched, and expired that day · click a date to expand`
- flat: `Graded daily ~16:10 ET · no win/loss — just whether spot reached the strike · Entry = the flagged contract's price the day it was flagged, High = the best it has printed since, Max % = the move between them · click any column to sort`

## The flat table — twelve columns

| key | Label | align |
|---|---|---|
| `symbol` | Symbol | left |
| `strike` | Strike | right |
| `expiry` | Expiry | left |
| `first_flagged` | Flagged | left |
| `opt_entry` | Entry | right |
| `opt_high` | High | right |
| `opt_pct_high` | Max % | right |
| `spot_at_flag` | Flagged Spot | right |
| `otm_pct_at_flag` | OTM at flag | right |
| `closest_pct` | Closest | right |
| `touched_date` | Touched | left |
| `status` | Status | left |

`OUTCOME_COLSPAN = 12`. Every header is clickable; `align` defaults to right in v2 and is "spelled out here so step 3 cannot guess."

Cell rules:

- **Entry is the only cell that names the contract's C/P side** — `$1.24 C` — "High deliberately does not repeat it, because saying it twice on one row says nothing twice." A null `opt_type` just drops the letter. Its `title` is `First price recorded {date}`, or **`undefined` — no tooltip at all — when the date is missing.**
- `High` at 2dp, inked `V2.accent` when present.
- `Max %`: glyph, space, ABSOLUTE value at one decimal, `%`. **Glyph boundary `>= 0`, so an exact 0 shows `▲ 0.0%`**, and the colour boundary is also `>= 0` here, so zero is painted up.
- `Flagged Spot` 2dp · `OTM at flag` **ZERO** decimals · `Closest` one decimal.
- `Closest` highlights **strictly `< 1`**, so exactly 1.0% is not highlighted. Ink `V2.accent` — "this is not a direction — 'closest' is small-is-notable in both signs."
- **`// BUG (v2):` `touchedColor`** tests the RAW `touched_date` while the TEXT tests the NORMALISED one, "so a truthy-but-malformed date paints light blue while displaying an em dash."
- `Status` upper-cased; ladder tested touched → `V2.accent`, expired → body text, else (open) → `V2.up`.

**TWO GREENS, KEPT:**

> v2 paints the flat table's OPEN `HOME_THEME.green` #8ECAE6 while the detail panel's OPEN chip — one row below it, on screen at the same time — is `PROBE_GRN` #30d158. Same word, same state, two greens… the WORD here takes the split's positive leg `V2.up`, and the CHIP keeps #30d158.

Empty: `No tracked flags yet.`

## Sorting — nulls sink in BOTH directions, and there is no tie-break

```ts
if (aNull && bNull) return 0
if (aNull) return 1      // fixed sign, never multiplied by `mul`
if (bNull) return -1
```

> A value is null for sorting purposes when `v == null || v === ""` — so `null`, `undefined` AND the empty string count, but `0` does not… That reads like a mistake and is not: the column the rule was written for is `Touched`, where floating every untouched row to the top of a DESC sort buries the rows the user asked to see.

> NO TIE-BREAK. Equal keys return 0 and fall through to sort stability, i.e. the server's own `first_flagged DESC`. Adding a tie-break would change the screen.

Two asymmetries in `OUTCOME_SORT_VALUE`, copied verbatim:

> `expiry` falls back to the RAW string when `ymd()` rejects it, so a malformed expiry still sorts lexically. `first_flagged` has NO such fallback and sinks instead.

**`// BUG (v2):`** `strike`, `spot_at_flag` and `otm_pct_at_flag` go through `Number(...)`, "which yields NaN for a non-numeric value — and NaN is not caught by the null test, so it produces an inconsistent comparator. The fix, when it is taken, is to treat `!Number.isFinite(v)` as null so NaN sinks with the rest."

`STATUS_RANK = { open: 0, touched: 1, expired: 2 }` — "so a status sort reads as a lifecycle, not A–Z." `UNKNOWN_STATUS_RANK = 99`, "not null, so it does NOT sink in DESC."

`defaultOutcomeSort(view)` is re-applied on **every view switch**, so a manual sort is discarded:
`touched` → `touched_date desc` · `expired` → `expiry desc` · everything else → `first_flagged desc` (matching the server's own order). The `results` branch shares the else and the value is **inert** — the Results view renders day buckets which never read `sort` — but "a missing branch would be a silently different state, not a simpler one."

`nextOutcomeSort`: the same column toggles direction; a NEW column opens **descending — except `symbol`**, which opens A–Z. The test is literally `key === "symbol"`, not a type test, "so `expiry`, `first_flagged`, `touched_date` and `status` all open descending too."

**Three glyphs, not two:** inactive `▾` (U+25BE, at a quarter opacity), asc `▲` (U+25B2), desc `▼` (U+25BC) — "a DIFFERENT character from the inactive one, deliberately." Every header carries `Sort by {label}`.

Sorting is client-side over the already-fetched page: "sorting by `opt_high` DESC shows the best of the fetched hundred, not the best overall."

## `ymd()` — a string slice, not a date parse

```ts
const s = String(v).slice(0, 10)
return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
```

> No `Date`, no parsing, no timezone conversion: that is what makes it safe to use as a Map key and to compare with `<` / `===`. Anything that does not match after slicing is `null`, including `null`, `undefined` and `""`… so it cannot roll a day backwards the way `new Date("2026-09-18").toISOString()` does west of Greenwich.

## Day grouping — the asymmetry, copied on purpose

One flag can land in up to THREE different days: opened, touched, expired. Newest day first, ordered by **raw string descending** ("correct only because the keys are ISO `YYYY-MM-DD` — which `ymd()` guarantees, and which is the reason the key is a slice and not a Date").

> `opened` and `touched` bucket UNCONDITIONALLY off their date fields — they ask "is there a date?", never "what is the status?". `expired` alone is gated on `status === "expired"`.
>
> The consequence is not cosmetic: a flag that was touched and later expired carries `status === "touched"`, so it appears in a `touched` bucket on its touch date and in NO `expired` bucket, ever — even though its expiry has passed. The Expired column therefore counts "expired without ever being touched", which is exactly what its note string says, and the three per-day counts do not sum to the number of distinct flags.

Rows inside a bucket are **not sorted at all** — they keep the endpoint's `first_flagged DESC` order.

Day table: five columns, the fifth being the disclosure column with **no label**; `DAY_COLSPAN = 5`. Disclosure glyphs `▾` (U+25BE) open / `▸` (U+25B8) closed; `Click to expand this date` **does not change when already open**. The open date is inked `V2.accent`.

Section colours: Opened `V2.up` · Touched `V2.accent` · Expired `V2.orange` (the warning ink). A zero count is **dimmed rather than hidden** — it renders the literal `0`, never an em dash — and the opacity is carried explicitly because "`T.muted` is opaque white in v3 and would not dim it at all."

`SECTION_NONE = 'None'`, `RESULTS_LOADING = 'Loading results…'`. The per-section sub-table has eight columns, `SECTION_COLSPAN = 8`, and **none of its headers is clickable.** In the sub-table the touch DATE is glued onto the status label, so "a touched row with a null `touched_date` renders 'TOUCHED ' with a trailing space."

## The detail panel and `probeStats`

`probeStats(days)` grades **the peak, not the last mark**:

| field | meaning |
|---|---|
| `entry` | the FIRST priced close — what taking the flag would have cost |
| `mark` | the **maximum** close, not the live mark. This is what the headline % grades |
| `last` | the last priced close, shown muted as "now" |
| `pct` | `((mark − entry) / entry) × 100`, **null when `entry <= 0`** — a division guard, not a formatting choice |
| `dollars` | `(mark − entry) × 100`, per SINGLE contract |

> a flag that ran +150% and gave it all back still handed you the +150%.

**`// BUG (v2):` the boundary mismatch** — `probeTone`'s colour test is `> 0` while `fmtProbePct`'s glyph test is `>= 0`, "so an exact `0` renders '▲ 0.0%' in plain text — an up arrow with no up colour."

`probeTone` uses the probe's OWN pair (`ES_CANDLE_UP` #30d158 / `ES_CANDLE_DOWN` #ff5b5b) while the table side takes `V2.up` / `V2.red`:

> open a row and the table's OPEN is one green while the panel's OPEN chip is the other. BOTH PAIRS SHIP… Do not unify them.

Labels `in` / `high` / `now` (lower-case in source, upper-cased by style) and `→`. `fmtProbeDollars` = ` · +$420/ct` with **U+2212** — "it is a sign in running text here, not a table column."

The C/P badge: C is `V2.green` (a CATEGORY — "call vs put, never chosen by the sign of a number"), P is `V2.orange`. The status chip's word is mixed case for touched (`Touched 2026-09-18`) and upper for everything else, "unlike the flat table's cell, which upper-cases everything."

`probeExp` parses at **UTC NOON** "so a local timezone west of Greenwich cannot roll the label back a day", locale is the browser's, and unparseable input falls back to the raw string.

Detail chrome: `…` ticker placeholder · `Loading…` subline · `×` close · `Loading day-by-day detail…` · `No daily bars yet.`

Day-by-day table, six columns: `Date` (raw `YYYY-MM-DD`, no reformatting; **rows keep the endpoint's order — no client sort**) · `Spot` · `Spot Δ%` · `Contract` · `Contract Δ$` · `Contract Δ%`. `fmtContractDollarChg` puts the **sign BEFORE the `$`**: `+$1.20`, `-$0.35`. The Δ columns' ink is `>= 0` → `V2.up`, null → body text.

## The probe chart (`watchThisChart.ts`)

**Inline `<svg>`, hand-rolled. Not a canvas, not a chart library**, and v2's reason still holds:

> this chart renders inside a table cell that is already inside two other tables, and every charting library on the page wants a MEASURED container. A `viewBox` scales without measuring anything, which is the only reason this triple-nested cell can hold a chart at all.

Geometry: `{ w: 960, h: 340, padL: 12, padR: 78, padT: 26, padB: 30 }` → a plot area of **870 × 284 user units**. "The right pad is the widest by far because the price rail and the last-mark pill live in it." `role="img"`, `aria-label="Contract price probe"`.

Four pieces of geometry that are not obvious from the picture:

1. **The x scale spans ALL days, including no-trade days** — `n = days.length`, not `points.length`. "A day the contract never traded keeps its slot on the axis so the timeline stays even, but carries no point — and the LINE BREAKS there rather than drawing a straight segment across a gap that never happened. That is what `segments` is for."
2. **The entry price is forced into the y domain before the 10% padding** (`PROBE_Y_PAD_FRACTION = 0.1`). "It is the chart's break-even… so the line the P/L is measured from can never fall off-canvas."
3. **The three gridlines sit at the data hi / mid / lo, NOT at the padded axis bounds.** "They label real prices on a right-hand rail, so the rail reads as three quotes rather than three round numbers. When every close is equal, all three stack on one y — v2's behaviour, unguarded."
4. **The touched marker is an EXACT string match** — `days.findIndex(d => d.date === ymd(touchedDate))`, no tolerance, no nearest-day search. "A touch date the `days` array does not contain draws nothing, silently."

**Spot is deliberately not drawn:** "Spot would need a second independent scale (the contract is worth a couple of dollars, spot is worth hundreds), and the day-by-day table directly below already carries spot, spot Δ% and the contract Δ$/Δ% for every point on this chart."

Constants — strokes `{ line 1.9, grid 1, entry 1, touched 1, crosshair 1, extremeMarker 1.6, hoverDot 2, tooltip 1 }`; dashes `{ touched '3 3', entry '3 5', crosshair '2 3' }`; radii `{ extremeMarker 3.4, lastDot 3.6, hoverDot 4 }`; touched opacity `0.65`; the wash gradient is vertical, accent at 22% down to nothing. Tooltip box `{ w: 168, h: 44, rx: 7 }`.

Inks: line/wash/hover ring `V2.green` · touched `V2.green` · high `ES_CANDLE_UP` · low `ES_CANDLE_DOWN` · text `T.text` · pill ink `V2.ink` ("must stay dark on a filled chip") · hover dot fill `V2.bg` · gridline `alpha(fg,0.07)` · entry line `alpha(fg,0.4)` · crosshair `alpha(fg,0.32)` · tooltip fill `alpha(V2.panel,0.96)`.

**`// BUG (v2):` the tooltip border is up-toned whatever the sign** — `rgba(48,209,88,0.45)` even when the hovered P/L is negative, "so a losing day reads inside a green box."

The one knowing exception to "no type sizes":

> `PROBE_CHART_GLYPH` names sizes. They are SVG USER UNITS inside a fixed 960×340 viewBox — coordinates in the same space as every x and y below, not CSS type sizes… Omitting them would not remove a magic number from the codebase, it would move it into step 3 as a guess.

Sizes: rail 12 · marker 11 · extreme 12 · axis 12 · pill 13 · tip date 11 · tip price 15 · tip P/L 13.

`buildProbeGeometry` returns **null below TWO days carrying a finite price** — a single priced day still returns null — and the panel then shows:

> `Not enough history yet — the contract needs a second session on the tape.`

Axis dates parse at **UTC noon** for the same westward-rollback reason; an empty series yields `""`.

The chart hint, "used twice in v2 — under the chart and baked into the PNG; the PNG is gone, so it has one consumer now":

> `Contract mark · daily bars · flagged @ {entry} · touched {date} · today sampled every 15m`

and the footer wraps it: `` `${hint} · no-trade days show —` `` — "the trailing em dash is a literal in the string — it names the no-trade gaps."

### The visibility gate `ChartFrame` cannot give it

`useProbeVisibility` reproduces the third sanctioned signal — `data-visible` on the `<svg>` itself:

> `ChartFrame` hands a bare div to an IMPERATIVE renderer; this chart is declarative React markup, so there is nothing to mount into it. What the frame actually provides — an IntersectionObserver plus the tab's own visibility, published as `data-visible` — is reproduced here on the `<svg>` itself, which is the third of the three sanctioned signals and the one a declarative chart can carry.
>
> It gates the ONE thing this chart does that is not markup: recomputing the hover crosshair, dot and tooltip on every pointer move. A hidden tab cannot deliver a mousemove, so in practice the observer half is what earns its keep — a chart scrolled out of a long Results day still stops recomputing.

`PROBE_ROOT_MARGIN = '200px'`. The observer and a `visibilitychange` listener both publish into one boolean.

v2 fails non-negotiable 5 outright here: "`ProbeChart` has NO visibility guard of any kind: no `document.hidden` check, no intersection test, nothing. It repaints on every hover move regardless of whether anyone can see it."

## Last-good rows, held in a ref

> v2 leaves the previous rows on screen through every failure of the flag feed and of the outcomes feed — it throws or no-ops BEFORE `setRows`. Under `useQuery` an `ok:false` body still arrives as `data`, so accepting it blindly would empty a grid v2 leaves standing. `keptFlags` / `keptRows` are that "do not apply this body" rule.

There is also no clear-on-change: "the previous view's rows stay up until the new response lands."

Row backgrounds: `ROW_WASH = alpha(T.text, 0.02)`, `ROW_OPEN = V2W.pickRow`, `ROW_EXPANDED = alpha(SHADOW, 0.2)`, `DIM_INK = alpha(T.text, 0.35)`, `DISCLOSURE_INK = alpha(T.text, 0.45)`, `PANEL_MUTED = alpha(T.text, 0.62)`.

**ONE row open at a time across BOTH tables.** The key is UI-scoped; the row is what the detail URL is built from. A second click on the same UI key closes the row and fetches nothing.

**Chrome inks:** every table header row on this tab (flat, day, section, detail-day) was `HOME_THEME.green` in v2 — the same value as "positive". `TABLE_HEADER_INK = V2.green` is the chrome leg; `sortHeaderInk(active)` is `V2.accent` when active, else the header ink, "an INACTIVE header sets no colour at all in v2 and inherits the header row's ink."

## What is deliberately not ported

- **`components/scanner/ProbeButton.tsx`, in its entirety.** Dead — a repo-wide grep finds only its own definition. "It also exports a SECOND `useIsOwner()` that duplicates `components/shared/useIsOwner` with DIFFERENT logic… Both halves stay out. If an owner '+ Probe' action is wanted on a Watch card, write it fresh against the v3 owner gate — do not resurrect a second owner test."
- **`captureFlagCard` and its `⧉ Copy image` button.** Not ported at all: no capture, no button, no offscreen canvas, no clipboard path, no `URL.createObjectURL`. And what it actually was:
  > `document.createElement("canvas")` that is NEVER APPENDED TO THE DOM — it exists only to be `toBlob`'d into a clipboard PNG. Its whole design depends on the cloned SVG carrying RESOLVED colour literals, because a `var()` reference serialises to nothing off-DOM, which is exactly why the `PROBE_*` hardcoded palette existed and exactly what v3 non-negotiable 1 forbids. It also reaches its source by `document.getElementById(chartId)`.
- `OutcomeRow.opt_price` — "the live mid, still carried for the popup", read by nothing.
- `OutcomeRow.touched` / `OutcomeDetail.touched` (the booleans) — "the UI keys every branch off `status` and off the DATE fields."
- `?embed=1` and its `target="_top"` links — GexDock chrome, so `chainHref` is a plain link here.

---

## Rendering, layout and performance across the page

### Primitives and tokens

Every tab composes `Card`, `Controls` (`Chip`, `SegGroup`, `SegMenu`, `Select`), `DatePicker`, `Stat`, `ChartFrame` and — on GEX Change Top only — `Table`. The other five tabs hand-roll their tables for the reason quoted at each: `design/primitives/Table` early-returns its `empty` node **instead of** the table, dropping the header row, and it has no colSpan'd empty row.

Type sizes come from the token scale — `text-3xs` 9 / `text-2xs` 10 / `text-xs` 11 / `text-sm` 13 / `text-base` 15 / `text-lg` 18 / `text-xl` 24 / `text-2xl` 32. Canvas and SVG read the number off the same scale rather than typing one.

**Token values actually in `tokens.css`** for the names this page uses:

| Token | Hex |
|---|---|
| `--color-v2-cyan` | `#6aa0ff` |
| `--color-v2-orange` | `#ffd166` |
| `--color-v2-red` | `#ff6b7a` |
| `--color-v2-green` | `#7fb0ff` |
| `--color-v2-pos` | `#3ddc8e` |
| `--color-v2-purple` | `#b48cff` |
| `--color-v2-bg` | `#0a0d10` |
| `--color-v2-panel` | `#0e1216` |
| `--color-v2-ink` | `#071026` |
| `--color-v2-refresh` (`V2.up`) | `#3ddc8e` |
| `--color-v2-lightblue` | `#7fb0ff` |
| `--color-v2-accent` | `#7fb0ff` |
| `--color-v2-neg` | `#ff5fa2` |
| `--color-v2-neutral` | `#c0c5c3` |
| `--color-v2-chip` | `#7fb0ff` |
| `--color-line` | `#1e2630` |
| `--color-fg` | `#e7ece9` |
| `--color-candle-up` / `--color-candle-down` | `#3ddc8e` / `#ff6b7a` |

**These are NOT the hexes the scanner's prose cites.** Every `#8ECAE6` / `#1FD98A` / `#EF4444` / `#22C55E` / `#FB8501` / `#7dd3fc` / `#FF3B3B` in the comments is v2's original value; `tokens.css` maps the v2 NAMES onto v3-palette VALUES. The token indirection is what ships. See Gotchas.

### Canvas and visibility

- **One canvas on the whole page:** GEX Levels card 12 (`lightweight-charts`), via the shared `VolGexFlowPanel`. `CARD_12_IS_THE_ONLY_CANVAS = true` records it.
- Everything else is SVG: GEX Change Top's 96px price chart (imperative, through `ChartFrame`), GEX Levels' eleven hand-rolled charts, IB Stats' gauge and three rings (declarative, five nodes each), Watch This' 960×340 probe (declarative, with its own `data-visible`).
- Three visibility mechanisms are in play, one per shape: `handle.visible()` + `onVisibility` (GEX Change Top's chart), `backface-visibility: hidden` (the flip), and a hand-rolled `data-visible` IntersectionObserver (the probe).

### Per-frame work

There is no rAF loop anywhere on this page. Redraws are event-driven: a prop change, a resize, a hover move, a poll tick. The GEX Change Top chart routes ticks through a ref and one imperative `draw()` — "the chart never re-renders React for a tick." Card 12's rAF is a **size pump only** (`VOL_FLOW_SIZE_PUMP_FRAMES = 120`), retrying while the box has no dimensions.

### Polls, collected

| Tab | Feed | Cadence | Hidden-tab |
|---|---|---:|---|
| GEX Change Top | slots, results | 60 s | pauses |
| GEX Change Top | per-card history | 60 s, only while 1–8 cards are open | pauses |
| GEX Levels | `/proxy/gex` | 15 s | pauses |
| GEX Levels | multi sweep | 60 s | pauses |
| GEX Levels | vol-flow (card 12) | 15 s | pauses |
| IB Stats | live candles | 15 s | pauses (explicit `document.visibilityState` check in the effect) |
| Pick Study | — | none | — |
| Strike Query | — | none | — |
| Watch This | flag feed | 120 s | pauses (**the one deliberate departure**) |
| Watch This | outcomes | 60 s | pauses (faithful port) |

`background: true` is **not set on any of them**. Every one is a current-value read where a missed tick is repaired by the next.

### Bundle

`vite.config.ts` splits React into its own chunk and code-splits everything else by route via `lazy()`. Each scanner tab is a **separate chunk inside** the `/scanner` route chunk, which is the point:

> v2 static-imported all seven of its tabs, so 329KB of tab components plus a 3,100-line page shipped to every visitor whichever tab they opened. One chunk per tab means an over-budget tab is legible in check-budgets.mjs by name, which is the whole reason the budgets file names chunks at all.

`budgets.json`, in **brotli-compressed bytes**:

```
entry         38900
react         55000
route         59100     ← every tab chunk is measured against this
data          78000     ← any data-* manualChunk (today: data-seasonality only)
css            8500
html           2600
totalInitial 108400
ratchet { slack: 0.15, enforce: false }
perf { idleRepaintsPerFrame: 0.15, offscreenRepaints: 0, interactionRepaints: 10 }
```

The file's own `$comment` on why the numbers are tight: "a budget with 4x headroom enforces nothing. Raising a number is a deliberate decision that shows up in a diff… LOWERING one matters just as much and is far easier to forget, which is what `ratchet` is for."

No scanner chunk gets its own `data-*` line; `data` today covers only the almanac.

**Theme compliance.** `theme-baseline.json` grandfathers per-file colour-literal counts for twenty files across the board, `/options-chain` and `/premarket`. **Not one file under `src/pages/scanner/` appears in it**, and neither does `src/pages/Scanner.tsx` — every one of these 35,782 lines is already at zero literals, so `npm run check:theme` fails the build the moment a hex, an `rgb()`, an `hsl()`, a Tailwind palette shade or an unknown `var(--typo)` lands in any of them. That is what makes the `V2.*` / `alpha()` / `mix()` indirection load-bearing rather than stylistic.

### Phone behaviour

`/scanner` is **not** in `DESKTOP_TO_MOBILE` in `src/mobile/mobileNav.ts`, so a phone opening it is **not redirected** — it renders the desktop page inside the desktop shell. There is no `/m/scanner` tab and no scanner card in the board catalog.

What that means per tab:

- The tab strip is `flex-wrap`, so six pills wrap to two or three rows on a handset.
- GEX Change Top's slot grid is genuinely responsive: `grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5`. The flip tile is a fixed 260px tall and `inset: 0` on both faces, so a flip never reflows.
- GEX Levels' two columns are `flex-1 basis-[480px]`, so they stack below ~960px — but **drag-and-drop card reordering is an HTML5 drag, which does not work on touch**, and the wheel-zoom/drag-pan model on the four strike charts assumes a pointer.
- Every table on the page is a wide `<table>` inside an `overflow-x-auto` wrapper: the scoreboard is 23 columns, Watch This' flat table is 12, the scorecard is 12, Strike Query's is up to 9.
- `useIsPhone()` exists (`PHONE_MAX_WIDTH = 820`, width AND (coarse OR no-hover)) and **no file under `src/pages/scanner/` calls it.**
- Tooltips carry a lot of this page's meaning — the gate switch costs, `biasTitle`, every grade note, the three tile scopes — and `title=` does not open on touch.

---

## Status and empty-state messages, verbatim

### GEX Change Top

| String | When |
|---|---|
| `Loading…` | first paint of the slot area |
| `No very-strong picks recorded yet for this date. The recorder files a strike the minute it crosses into ★ Very strong, and captures the top 5 every 30 min during RTH.` | settled, no slots, gate inert |
| `The gate hid all {N} picks on this date. Nothing recorded here cleared {…} together — switch one off to see which.` | settled, rows exist, the gate emptied them |
| `Error: {msg}` | the slot feed errored — rendered even while loading, and it suppresses the two above |
| `Scorecard error: {msg}` | `/results` errored — outside the show/hide gate |
| `No scored picks for this date yet — rows appear once picks have been auto-probed and snapshots start landing.` | `/results` returned zero rows |
| `No picks above the $0.50 entry floor for this date — use “show ≤ $0.50” above to include them.` | rows exist, none clears the floor. **Names a button that does not exist** |
| ` · refreshing…` | appended to the subtitle while the slot feed loads |
| `loading history…` | a back face with no points yet |
| `not enough history yet —` / `snapshots accrue every minute through RTH` | fewer than 2 plotted samples |
| `load failed` / `no history` | `ok:false` fallbacks |

### GEX Levels

| String | When |
|---|---|
| `loading live /proxy/gex snapshot…` | header subtitle before `d` exists |
| `waiting on /proxy/gex…` | no `d`, no error |
| `Feed error: {msg}` | `/proxy/gex` errored — shown even over a stale `d` |
| `Loading…` / `—` | panel status while loading / never loaded |
| `Logging starts as soon as a level moves.` | cards 1 and 4, verbatim in both |
| `no chain rows` | the four 0DTE cards with `d == null` |
| `no expirations` · `loading expirations…` · `no data yet` | card 5 |
| `loading eod_gex…` | cards 2/3 |
| `no 0DTE OI+Vol rows yet — run scripts/backfill-eod-gex-0dte.js` | card 2, that basis empty |
| `no ex-0DTE data yet` | card 3, that basis empty |
| `sweeping the board…` → `no ladder available` → `no strikes returned` | cards 7/8/11, in this precedence |
| `net delta is zero at every strike — server-v2 is likely running a build before /proxy/gex-by-strike-multi shipped netDEX; redeploy it` | card 11, every strike zero |
| `EOD GEX error:` / `OI-by-expiration error:` / `Multi-expiry GEX error:` / `Multi-expiry DEX error:` | the four error prefixes |
| `endpoint /proxy/gex-by-strike-multi not found — server-v2 needs a restart/redeploy to pick up the route` | the stale-deploy sentence |
| `unexpected {contentType} response (HTTP {status})` | any other non-JSON |
| `no expirations resolved` | card 5, EVERY leg rejected |
| `Loading net vol GEX history…` / `Loading +GEX % history…` | card 12 scrim |
| `No snapshots in today's RTH window — try ETH` / `No snapshots recorded yet today` | card 12 empties |
| `History DB unavailable` / `Feed unavailable` | card 12 errors |
| `Drop here` | the drag tail strip |

### IB Stats

| String | When |
|---|---|
| `Loading {SYM} {winLabel} dataset…` under `{winLabel} Stats` | the dataset is in flight |
| `{winLabel} Stats — dataset not found` + the thrown message | the dataset 404'd or the network failed |
| `Waiting for today's bars…` / `Candle feed disconnected` | `live == null`, connected or not |
| `No RTH bars yet for the current session. This card fills in from 09:30 ET.` | `live == null` body |
| `Pre-range — {winLabel} levels set at {clock} ET` | before the first range bar |
| `Waiting on the 10:30 ET close.` | Live Read, hardcoded 10:30 |
| `no history` | an empty last-5 dot strip |
| `Show historical stats ({n} sessions) ▼ (owner)` / `Hide historical stats ▲ (owner)` | the owner disclosure |

### Pick Study

`No graded picks in this window yet.` · `Rule is armed but no picks carry a projection yet — they start appearing at the next capture.` · `Every pick in the window carries a projection.` · `{n} pick(s) were captured before the rule was armed and carry no projection — they are excluded from this table, not counted as misses.` · `Error: {msg}` · `load failed` · `fit failed` · `owner-only — sign in as the owner to change the rule` · `Fit stored` / `Fit result (not stored)` / `Nothing to arm` · the three not-armed paragraphs.

### Strike Query

`No rows yet. Needs recorder history for the selected ticker(s).` — **the only empty-state sentence**, covering all four causes, with no reset. Plus `loading…` in the subtitle.

### Watch This

`Nothing flagged right now — no watchlist ticker has an unusually far-OTM dominant CB level.` · `Recorder hasn't run yet — data appears after the first RTH sweep.` · `Server returned {status} (non-JSON).` · `load failed` · `No tracked flags yet.` · `Loading results…` · `None` · `Loading day-by-day detail…` · `No daily bars yet.` · `Not enough history yet — the contract needs a second session on the tape.` · `Add failed` · `{SYM} added — appears after the next sweep.`

---

## Gotchas

1. **`src/pages/scanner/seasonality`-style missing file, but here it is a stale comment set:** `App.tsx:49` and `:53` still say the scanner has "seven tabs" and that "each of the seven tabs is its own `lazy()` chunk". The registry, the union and `TAB_COMPONENT` all carry **six** since 2026-09-03. `Shell.tsx`'s rail comment is correct.

2. **`.scanner-v2` is a no-op as shipped.** The rule sets `--color-line: #1e2630`, and `:root` in the same file already declares `--color-line: #1e2630`. The docblock says v3's line is "an opaque slate #23272e". Either the token moved and the comment did not, or the override value was never updated. Deleting the class today would change nothing — which is exactly what the docblock promises, for the wrong reason.

3. **Every v2 hex quoted in the scanner's prose is stale relative to `tokens.css`.** The comments say `V2.cyan` #219EBC, `V2.green` #8ECAE6, `V2.up` #1FD98A, `V2.pos` #22C55E, `V2.red` #EF4444, `V2.orange` #FB8501, `V2.accent` #7dd3fc, `V2.neg` #FF3B3B. The tokens resolve to `#6aa0ff`, `#7fb0ff`, `#3ddc8e`, `#3ddc8e`, `#ff6b7a`, `#ffd166`, `#7fb0ff`, `#ff5fa2`. **Note `V2.green` and `V2.accent` and `V2.lightblue` and `V2.chip` all now resolve to the same `#7fb0ff`, and `V2.up` and `V2.pos` both to `#3ddc8e`** — so the three-way split of #8ECAE6 that four files' docblocks describe at length is, at the token layer, a two-way split. The intent is recorded; the values have converged.

4. **Three zero conventions on GEX Change Top, plus a fourth for nulls.** A break-even pick paints green in the scorecard, red on the card front and white on the card back, simultaneously. An em dash for a null Δ is painted in the UP colour.

5. **A "B" pill beside a "never green" count that includes it.** `gradeFor`'s server path does not apply the never-green override; the counter reads `neverGreen` from both paths.

6. **The scorecard's below-floor empty state names a button that does not exist.** The corrected string is exported next to it and deliberately unused.

7. **`fmtBig` has no sub-1M branch.** A Δ of exactly $200,000 — the ★ threshold the subtitle quotes — renders as `0.2M`; $40,000 renders as `0.0M`.

8. **Two minus signs on one tab.** `fmtBig` ASCII, `fmtGex` U+2212. Both already on screen.

9. **`cardId` omits the expiry while the React key includes it.** Two expiries on one symbol+strike in one slot render as two tiles that **share flip state**.

10. **The GEX Change Top chart's x-axis is browser-local while every stamp above it is ET.** For a viewer outside New York the axis and the "high @ 1:42 PM" line name different times for the same sample.

11. **GEX Levels' `d`-gate blanks four cards that could have answered.** A `/proxy/gex` outage hides both EOD boards, the OI-by-date chart and nine sessions of history sitting in localStorage.

12. **Card 12 contradicts itself on screen** — subtitle "5m buckets", its own header "30s buckets · today ET", and the wire really sends `bin=30`.

13. **Card 12's % Δ tile prints `−0.0pt` in the positive colour at exactly zero** (glyph `> 0`, ink `>= 0`).

14. **Card 12's chart colours resolve through `tokenHex()`, which returns `'transparent'` for an unknown name and does not throw.** Rename `--color-v2-refresh` or `--color-v2-red` and the chart paints blank with no error anywhere.

15. **The history table's today row goes stale in five cells.** Price, R2, S2, Open Int and Curve are written but are not in the five-field rewrite test.

16. **`HISTORY_MAX_DAYS = 60` is a WRITE cap only.** React state is not truncated, so server rows past day 60 still render.

17. **The net-delta charts label their y axis with `fmt0`** — the only axis on the tab that does, so a delta reads `412,773,000` where every neighbour reads `412.8M`.

18. **The multi-expiry cards are hardcoded to `$SPX`** while the four header tiles follow the shared feed's symbol. If the feed moves off SPX they silently disagree.

19. **GEX Levels' `resetLayout` is fully implemented, persists correctly, and is wired to no button.** Not imported by the render layer.

20. **The GEX Levels card layout's first paint is always the default**, and the stored arrangement swaps in after mount — so a user with a custom layout sees one frame of the default.

21. **`cpgRatio` returns 0 for an empty put book**, which the CPG gauge paints in its RED left band — "maximally put-heavy" for a chain with no puts.

22. **IB Stats' Live Read gauge saturates at 50%.** `arc` is 125 (the full semicircle) applied as the dasharray of quarter arcs whose real length is ≈62.8.

23. **IB Stats' probability engine can render a negative rotation ring.** Rotation is `100 − round(bull) − round(bear)`; 50.5/49.5 gives −1%, an empty ring beside a "-1%" label.

24. **The engine's `10:30 Close` chip and Live Read's `Waiting on the 10:30 ET close.` are hardcoded** and do not follow the window selector — on ORB 15m they label an 09:45 event as 10:30.

25. **Rule `0c` renders as a family member and never reaches the engine**, because it is in no `STAGE_DEFS` entry.

26. **The engine weights every rule flat**, `n` having been stripped before it arrives: a rule matching 12 sessions moves the needles as hard as one matching 900.

27. **`dowIdx` is the BROWSER's weekday** on a tab where everything else is ET-anchored — rule 0c's condition changes west of ET after 21:00 local.

28. **The IB Stats results error is never cleared.** An ES failure leaves the red banner up while NQ loads fine.

29. **The IB Stats tape falls back silently to the static export**, whose newest row is months old and looks identical to live data.

30. **IB Stats' EOD scoreboard title is hardcoded to `IB 60m (09:30–10:30 ET)`** and the recorder only writes that window — so switching to ORB 15m changes every other card and leaves this one reading 60m data.

31. **Rule 12's published claim says "inner 30m ORB"; every implementation uses the 15-minute range** (`min < 585`).

32. **`ibLevels.ts` is 747 lines that nothing imports**, and its v2 original held a socket subscription with `enabled` hardcoded `true` — 4 Hz re-renders off-screen, forever.

33. **Pick Study's `Fit now` silently widens a 14-day view to 90 days.**

34. **Pick Study's verdict compares at full precision and prints at 0 dp** — a 4.6pt gap reads "+5pt" inside the sentence calling it noise.

35. **Pick Study has two sources of truth for "armed", and `↻` refreshes only one of them.**

36. **Pick Study asserts an env setting it cannot see.** A failed rule fetch prints `auto-fit is OFF (GEX_CHANGE_TOP_AUTOFIT=0)` as a fact.

37. **Pick Study's calibration empty row spans 10 of 11 columns in v2.** v3 uses the derived count — the one place this port corrects rather than reproduces.

38. **Strike Query's direction filter tests the ACTIVE SORT COLUMN, not GEX**, while its tooltip promises GEX. On `strike` or `delta_abs`, `Negative` is structurally empty for every input, and the empty-state gives no hint why.

39. **Strike Query's Top-10 cards ignore the sort DIRECTION**, so the cards and the table disagree about "top" in one of the two arrow states.

40. **Strike Query's `All − Indices` toggle filters the TABLE too, and unmounts with the block that holds it** when it empties the view. Documented explicitly as the one trap step 3 must not reproduce.

41. **Strike Query's null Δ renders two ways at once:** `+0` in the up colour on a card, an em dash in the table, for the same field of the same row.

42. **Strike Query's error banner is structurally unreachable**, so a per-symbol 500 is indistinguishable from an empty result set.

43. **Strike Query's `SQ_INDICES` (5) ≠ `SQ_CAP_ONE` (3)**, and the visible copy names only the three.

44. **Watch This' subtitle and footer disagree when `threshold` is absent** — the footer prints `>15%` from the fallback, the subtitle drops the clause entirely, both visible at once.

45. **Watch This' `volGexColor` paints a NULL vol-GEX positive beside an em dash;** `touchedColor` paints a malformed touch date light blue beside an em dash.

46. **Watch This' expired bucket is status-gated while opened and touched are not**, so the three per-day counts do not sum to the number of distinct flags, and a touched-then-expired flag never appears in an expired bucket.

47. **Watch This' NaN comparator:** a non-numeric `strike` / `spot_at_flag` / `otm_pct_at_flag` makes `sortOutcomes` inconsistent, because NaN is not caught by the null test.

48. **Watch This' probe tooltip border is up-toned whatever the sign of the hovered P/L.**

49. **Watch This' Results view silently truncates past 300 flags.**

50. **Six tombstone files remain on disk** (`TpoTab.tsx`, `tpoData.ts`, `tpoProfile.ts`, `tpoStructures.ts`, `tpoTaxonomy.ts`, `amt.ts`), each a one-line `export {}` under a header that names the exact `git rm` to run. They are imported by nothing.

51. **`OUTCOME_SORT_VALUE.expiry` has a raw-string fallback and `first_flagged` does not** — a malformed expiry still sorts, a malformed flag date sinks.

52. **Tooltips carry a lot of this page's meaning and `/scanner` has no phone route**, so a touch user gets the pills, the tables and the charts but none of the `title=` prose.
