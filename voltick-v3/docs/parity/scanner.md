# Parity inventory — Scanner (`/scanner`)

**What this is.** One line per value the v2 page renders, with where it comes
from, how it is formatted, what changes its colour, and what it shows when the
value is missing. It is the SPEC for the v3 port: the v3 page is finished when
every row here is ticked, and not before.

**Why it exists.** The failure mode this document prevents is rebuilding a page
from scratch — re-deciding what it contains at the same time as building it.
Both jobs were already done in v2. This file finishes the first one so the
second is only construction.

**Status: STEP 1 OF 4. Nothing has been built.** No file under `cbedge-v3/src/`
has been written or changed. This document is for review before any v3 code
exists.

---

## Scope

The v2 route `/app/scanner`, which is one page hosting **seven inline tabs**.

| Layer | File | Size |
|---|---|---|
| Route | `app-vite/src/App.tsx` → `<Route path="/scanner">` | — |
| Page + 3 inline tabs | `components/pages/Scanner.tsx` | 3,100 lines |
| Tab registry | `components/scanner/scannerNav.ts` | 150 lines |
| Legacy tab bar | `components/scanner/ScannerTabsBar.tsx` | 142 lines |
| Shared table styles | `components/scanner/scannerStyles.ts` | 43 lines |
| GEX Levels tab | `components/scanner/GexLevelsTab.tsx` | 2,233 lines |
| GEX Change Top tab | `components/scanner/GexChangeTop.tsx` | 1,395 lines |
| Pick Study tab | `components/scanner/PickStudyTab.tsx` | 703 lines |
| IB Stats tab | `components/scanner/IbStatsTab.tsx` + `IbDailyResults.tsx` + `IbLevelCanvas.tsx` | 105 + 16 + 17 KB |
| TPO support | `TpoForecastCard.tsx`, `TpoForwardMap.tsx`, `TpoOpenLocation.tsx` | 20 KB |
| Maths / data libs | `lib/tpo.ts`, `lib/amt.ts`, `lib/ibStats.ts`, `lib/ibDaily.ts`, `lib/snapdb.ts`, `lib/valueArea.ts`, `lib/tpo-forecast-compute.ts`, `lib/marketSession.ts`, `lib/balanceImbalance.ts`, `lib/snapshot.ts` | — |
| Hooks | `hooks/useEsCandles.ts`, `useNqCandles.ts`, `useIbDirection.ts`, `useRefreshButton.ts` | — |
| Shared chrome | `components/shared/PageCard.tsx`, `homeTheme.ts`, `ThemedSelect.tsx`, `useIsOwner.ts`, `useTableSort.tsx` | — |
| Backend (unchanged) | `server-v2/server-with-proxy.js`, `server-v2/api-router.js` | — |

**Out of scope.** The phone build (`components/mobile/`) — no `/m/` tab reaches
Scanner. `/level-log` and `/strike-history`, which are separate routes that only
share the sub-strip. The Test Lab tabs that used to live here (`GexScannerTab`,
`GexPctTab`, `MarketQualityTab`, `StatPrompterTab`) — they moved to `/test` on
2026-08-16 and their files remain under `components/scanner/` only because that
folder is the feature family, not the page.

---

## Total: 1,525 checklist rows (1,324 live — Part F's 201 were dropped 2026-09-03)

| Part | Covers | Rows |
|---|---|---|
| **A** | Page frame, tab routing, owner gate, shared styles, the four route edits | 58 |
| **B** | GEX Levels (`?tab=gexlevels`) — 12 cards, drag layout, 6 endpoints | 335 |
| **C** | GEX Change Top (`?tab=gexchangetop`) — **the default tab**; cards, grade ladder, scorecard | 158 |
| **D** | Pick Study (`?tab=pickstudy`) — **owner only**; buckets, splits, calibration | 127 |
| **E** | Strike Query (`?tab=strike`) — top movers by strike, per-ticker or ALL | 118 |
| ~~**F**~~ | ~~TPO Structures (`?tab=tpo`)~~ — **DROPPED FROM v3 2026-09-03.** Kept for the record and because rows F4–F13 / F191–F200 still spec `candles.ts` | ~~201~~ |
| **G** | IB Stats (`?tab=ibstats`) — initial-balance statistics, probability engine | 308 |
| **H** | Watch This (`?tab=watch`) — far-OTM CB levels + outcome tracking | 220 |

**Column meanings**

- **Label as shown** — the literal string the user reads, in quotes.
- **Source** — the endpoint AND the field underneath it, or the exact
  client-side formula. `/proxy/gex-change-top → row.max_pct` is a source; "the
  grade" is not.
- **Format & units** — decimal places, sign, `%`, `pts`, font, size. What the
  code actually does, not what looks sensible.
- **Threshold / colour rule** — every condition that changes a colour, a weight
  or the wording, with the exact boundary and whether it is `>=` or `>`. This is
  where detail goes missing when a page is described rather than transcribed.
- **Empty / loading** — literally what renders when the value is not there.

Where a code comment and the code itself disagree, **the code wins** and the row
says so. There are nine such conflicts in this document; they are listed in the
Findings section below.

---

## The one colour decision this page turns on

`HOME_THEME.green` is **`#8ECAE6` — a light blue** — and it does three unrelated
jobs across six of the seven tabs:

1. **chrome** — every `Card` subtitle and most table header rows,
2. **the IB Stats tab accent**,
3. **the positive / up semantic**, painted against `HOME_THEME.red` `#EF4444`.

So a "good" number and the column heading above it are the same colour, and the
positive colour is a blue. Every part below found this independently. The port
collapses it by construction, the same way `docs/parity/em.md` collapsed its
two-reds case:

| v2 role | v2 value | v3 token |
|---|---|---|
| chrome (subtitles, header rows) | `#8ECAE6` | `T.muted` |
| positive / up | `#8ECAE6`, also `#1FD98A`, `#22c55e`, `#30d158` | `MOVE_UP` → `--color-move-up` `#35c28e` |
| negative / down | `#EF4444`, also `#FF3B3B`, `#ff5a6a` | `MOVE_DOWN` → `--color-move-down` `#e0645f` |
| IB Stats accent | `#8ECAE6` | `T.series5` → `--color-series-5` `#4fb8d4` |
| TPO / Watch accent | `LIGHT_BLUE` `#7dd3fc` (and `#7ed3fc`, and `#4fb8d4`) | `T.series5` |

Rows below still record what v2 did, because the record is the point; the "v3
token" column is what ships.

**Type scale.** The page paints at 10 / 12 / 14 / 17 px. v3's scale is 9 / 10 /
11 / 13 / 15 / 18 / 24 / 32 and has neither 14 nor 17 — and in three places on
the GEX Levels tab a 17px label is larger than the 14px value it labels. Every
size needs re-pegging, not copying. Nothing in v3 may name a px size; canvas and
SVG read the number off the same scale.

---

## Findings worth a decision before the build

Transcribing the page surfaced things that are defects in v2, not just details
to carry across. They are recorded in full in their parts; this is the index.

**Two sources of truth, disagreeing**

1. **The default tab.** `ScannerPage` opens on `gexchangetop`; `sectionNav.ts`'s
   `SCANNER_SECTION.defaultTab` says `gexlevels`. On a bare `/scanner` the strip
   highlights GEX Levels while GEX Change Top is rendered. (A12, A24)
2. **"Armed" on Pick Study.** The rule bar reads `rule.armed`; the body reads
   `cal.armed`; the ↻ button refreshes `cal` but not `rule`. The bar can say
   "Armed" over prose saying nothing is being predicted. (D)
3. **Server grade vs local grade on GEX Change Top.** `gradeFor`'s server path
   never applies the never-green override, the local fallback does. A row with
   `grade: "B"` and `max_pct <= 0` renders a B pill *and* counts in "never
   green". (C)

**Code-vs-comment conflicts — code wins in every row**

4. GEX Levels' card subtitle says "5m buckets"; `BIN_SEC = 30` and the panel's
   own header says 30s. (B264)
5. GEX Change Top's pain ladder comment says a missing MAE gets "half credit";
   the `-25` default lands in the `>= -30 → 15` bucket, i.e. 60%. (C)
6. Strike Query's direction filter tooltip promises GEX; `dirPass` actually
   tests the sign of the *active sort column*, so sorting by Strike or Delta Abs
   makes `Negative` return zero rows with no explanation. (E)
7. Watch This' block comment says "highest GEX strike"; the footer and the code
   both use `|GEX|`. (H)
8. TPO's forecast card copy ("lights up at open") misdescribes its gate, which
   is 10:30 ET plus a complete IB. (F)
9. GEX Levels' header comment advertises an "ITM toggles / strike table" panel
   that exists nowhere in the file. (B)

**Dead on arrival — do not port, and now verified dead on the server too**

10. **`VolPinScanner`** (`Scanner.tsx:253–598`) — an 11-column sortable table, a
    PINNING/SQUEEZING/WATCHING ladder, an event log. No tab renders it, **and
    `/proxy/vol-pin-scanner` does not exist in `server-v2` at all** — zero
    matches across `server-with-proxy.js`, `api-router.js` and
    `proxy-tastytrade.js`. `vol-pin-recorder.js` is on disk but not wired. It
    would 404 if anything called it.
11. **`GreeksScanner`** (`Scanner.tsx:107–248`) — the route
    `/proxy/greek-scanner` *does* exist (`server-with-proxy.js:2993`), but no tab
    renders this component. **Brandon, 2026-09-02: the live Greeks scanner is on
    the owner page.** This copy is a stale fork; out of scope.
12. `ModalPortal` (`Scanner.tsx:896`) — one hit in a whole-tree grep: its own
    declaration. `ThemedSelect` already portals its own menu.
13. `StructureRow` and `TpoForwardMap` — both fully built, neither rendered. (F)
14. `RuleBoard` and `PlaybookLegacy` on IB Stats — two fully-built dead cards. (G)
15. `IbLevelCanvas` — a complete 560×460 SVG that nothing imports. (G)
16. `ScannerSubStrip.tsx` — marked `DEPRECATED — safe to delete` in its own
    header; a bare re-export of `SectionSubStrip`. (A)
17. `useCardLayout().reset` on GEX Levels — implemented, persists correctly,
    wired to no button. (B)

**v3 non-negotiables the page violates as written**

18. **All seven tabs are static imports.** 329 KB of tab components plus the
    3,100-line page ship to every visitor whichever tab they open, and every tab
    switch is a full unmount → remount → refetch. Non-negotiable 7. (A57, A58)
19. **Three canvases, none tagged, none guarded.** GEX Levels' `VolGexFlowPanel`
    chart and TPO's letter profile both paint to canvas with **no
    `data-cb-layer`** and **no visibility guard** — the TPO draw effect re-runs
    on `spot`, so it repaints on every new bar whether the card is on screen or
    not. Non-negotiables 5 and 6. `IbLevelCanvas` and Watch This' `ProbeChart`
    are inline SVG, so 6 does not apply to them; the visibility guard still does,
    and neither has one. (B, F, G, H)
20. **Confirmed request waterfall** on GEX Levels: `/proxy/gex` → `/api/chains`,
    plus `/api/eod-gex` fired twice per mount. Non-negotiable 3. (B)
21. **Two dedupe layers on one path** — `snapdb.ts`'s 5,000 ms `_candleCache`
    sits under `useEsCandles`' own 3,000 ms `sharedLoad`. (F)
22. **Colour literals and Tailwind-free px sizes everywhere**, including
    `scannerStyles.ts`, which six of seven tabs import. Non-negotiable 1.

---

## Endpoint verification

Every endpoint named in this document was checked against `server-v2`. One does
not exist; everything else resolves.

| Endpoint | Used by | Resolves in |
|---|---|---|
| `/proxy/gex` | Part B | `server-with-proxy.js:323` |
| `/proxy/gex-by-strike-multi` | Part B | `server-with-proxy.js` |
| `/proxy/gex-levels-history` | Part B | `server-with-proxy.js` |
| `/proxy/gex-vol-flow` | Part B | `server-with-proxy.js` |
| `/api/chains` | Part B | `api-router.js` |
| `/api/eod-gex` | Part B | `api-router.js`, `server-with-proxy.js` |
| `/proxy/gex-change-top` | Parts C, D | `server-with-proxy.js` |
| `/proxy/gex-change-top-history` | Part C | `server-with-proxy.js` |
| `/proxy/gex-change-top-results` | Part C | `server-with-proxy.js` |
| `/proxy/gex-change-top-study` | Parts C, D | `server-with-proxy.js` |
| `/proxy/gex-change-top-calibration` | Part D | `server-with-proxy.js` |
| `/proxy/gex-change-top-rule` | Part D | `server-with-proxy.js` |
| `/proxy/gex-change-top-rule-fit` | Part D | `server-with-proxy.js` |
| `/api/watch` | Part C | `api-router.js` |
| `/proxy/strike-growth/by-expiry` | Part E | `server-with-proxy.js` |
| `/proxy/strike-growth/watchlist` | Part E | `server-with-proxy.js` |
| `/api/snapshots/candles` | Part F | `api-router.js` |
| `/api/tpo-forecast` | Part F | `api-router.js` |
| `/api/ib-results` | Part G | `api-router.js`, `server-with-proxy.js` |
| `/api/far-cb-tickers` | Part H | `api-router.js`, `server-with-proxy.js` |
| `/proxy/far-cb-watch` | Part H | `server-with-proxy.js` |
| `/proxy/far-cb-outcomes` | Part H | `server-with-proxy.js` |
| `/proxy/far-cb-outcome-detail` | Part H | `server-with-proxy.js` |
| `/api/auth/me` | Part A (`useIsOwner`) | `app/api/auth/me/route.ts` (Next, not `server-v2`) |
| `/proxy/greek-scanner` | Part A (dead code) | `server-with-proxy.js:2993` — route lives, consumer does not |
| **`/proxy/vol-pin-scanner`** | Part A (dead code) | **NOWHERE — 0 matches in all three server files** |

---

## Adding the route in v3 — four edits, all currently in a *retired* state

Scanner was removed from v3 on 2026-08-30. Every one of the four steps in
`cbedge-v3/AGENTS.md` has to be reversed, not merely performed:

1. `cbedge-v3/src/pages/Scanner.tsx` — today a tombstone comment + `export {}`.
   It invites `git rm`. **Overwrite it; do not delete it.**
2. `cbedge-v3/src/App.tsx` — add the `lazy()` import and `<Route
   path="/scanner">`, and delete the "RETIRED 2026-08-30" comment block.
3. `cbedge-v3/src/shell/Shell.tsx` — add the `NAV` entry with `prefetch` URLs.
4. `app/v3/scanner/route.ts` in the v2 repo — today it answers **404 by design**;
   it must become the three-line `serveSpaShell("v3")` form.

Plus a fifth that `Shell.tsx:44–46` says moves with the others: `/scanner` back
into `ALL_PAGES` / `LIVE_ROUTES` in `cbedge-v3/src/pages/TradersDashboard.tsx`.

Part A rows A44–A49 spell each one out.

---

## Open questions, consolidated

Each part carries its own list; these are the ones that change what gets built.

1. **Does `/v3/scanner` put the tab in the URL?** v2 cannot share a tab by
   copying the address bar — clicking a tab never writes `?tab=`. The `/v3/em`
   handler's own comment argues a shared link *is* a hard refresh. Proposal:
   `useSearchParams`, so back/forward move between tabs.
2. **Which tab does it open on?** v2 has two answers (finding 1).
3. **Does Pick Study ship to v3 at all?** Owner-only research, and its client
   only proves a server-side gate on two of the five routes it hits.
4. **One route with seven lazy tabs, or seven `/v3/*` routes?** The former is the
   straight port and is what the rest of this document assumes.
5. **Do the two dead scanners get deleted from v2** while we are here, or left?
   `/proxy/vol-pin-scanner` has no server route at all.
6. **Rail icon and prefetch URLs** for the new `NAV` entry — the one taste call
   in the four edits.

---
# Part A — Page frame, tab routing, owner gate

## Scope

| Layer | File | Lines |
|---|---|---|
| Route (v2 SPA) | `app-vite/src/App.tsx` → `<Route path="/scanner">` | — |
| Page | `components/pages/Scanner.tsx` → `ScannerPage` | 3044–3100 |
| Owner-tab set | `components/pages/Scanner.tsx` → `OWNER_ONLY_TABS` | 3049–3051 |
| Tab registry | `components/scanner/scannerNav.ts` | 1–150 (whole file) |
| Legacy tab bar | `components/scanner/ScannerTabsBar.tsx` | 1–142 (whole file) |
| Live sub-strip | `components/shared/SectionSubStrip.tsx` + `sectionNav.ts` → `SCANNER_SECTION` | `sectionNav.ts:75–85` |
| Shared table styles | `components/scanner/scannerStyles.ts` | 1–43 (whole file) |
| Page chrome | `components/shared/PageCard.tsx` → `PageShell`, `Card` | 1–140 |
| Theme constants | `components/shared/homeTheme.ts` → `HOME_THEME`, `LIGHT_BLUE`, `SOFT_RED` | 3–90 |
| Owner check | `components/shared/useIsOwner.ts` | 1–33 (whole file) |
| SPA shell handler | `lib/serveSpaShell.ts`, `app/v3/<name>/route.ts` | — |

**Note on the v3 side.** `/v3/scanner` currently answers **404 by design**
(`app/v3/scanner/route.ts`, retired 2026-08-30), `cbedge-v3/src/pages/Scanner.tsx`
is a tombstone exporting `{}`, there is no `<Route path="/scanner">` in
`cbedge-v3/src/App.tsx`, and the Scanner rail slot was deliberately removed from
`NAV` in `cbedge-v3/src/shell/Shell.tsx`. **All four of those are reversals this
port has to make**, and they are exactly the four steps in `cbedge-v3/AGENTS.md`.
Rows A44–A47 spell out each one.

---

## A.1 — Page shell (`Scanner.tsx:3088–3098`, `PageCard.tsx:38–78`)

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **A1** Page canvas | `PageShell` → `homeShellStyle` | `height:100%; width:100%; overflow:hidden; display:flex; flexDirection:column; minHeight:0` | `background: HOME_THEME.bg` `#05060A`; `backgroundImage: HOME_THEME.shellGlow` = two radials — `circle at 15% 50% rgba(33,158,188,.04) → transparent 50%` and `circle at 85% 30% rgba(18,103,131,.05) → transparent 50%` | n/a — always painted |
| **A2** Page font | `homeShellStyle.fontFamily` | `var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif` | `color: HOME_THEME.text` `#FFFFFF` | n/a |
| **A3** Content column | `homeContentStyle` | `flex:1; display:flex; flexDirection:column; minHeight:0; overflow:auto` (PageShell overrides `overflow:hidden` → `auto` on the `<main>`); `padding: clamp(14px, 2vw, 24px)`; `gap: clamp(16px, 2vw, 32px)` | none | n/a |
| **A4** Content alignment | `PageShell align` prop | `ScannerPage` passes **nothing**, so `align="stretch"` → `alignItems:"stretch"`; cards fill the column | none | n/a |
| **A5** Content max width | `PageShell maxWidth` prop | `ScannerPage` passes **nothing** → no `maxWidth` wrapper, no `marginInline:auto`. The page is full-bleed inside the shell padding | none | n/a |
| **A6** Card hover lift | `Card` → `className="card-hover"` | Applied to every `variant` except `"dissolve"`. The lift itself is defined in `app/globals.css`, not here | none | n/a |
| **A7** Card surface | `Card variant` default `"gloss"` | `"gloss"` is an **alias of `"budget"`** → `classicCardAccentStyle`. Frosted fill, hairline edge, faint light-blue radial glow, **no top accent strip** | The `accent` prop is accepted and **ignored** (`PageCard.tsx:24–35`) — do not reintroduce a per-card accent colour | n/a |
| **A8** Card title row | `Card title` | `fontSize:14; fontWeight:800; letterSpacing:.12em; textTransform:uppercase` | `color: HOME_THEME.text` `#FFFFFF` | Row is not rendered when both `title` and `subtitle` are `null` |
| **A9** Card subtitle row | `Card subtitle` | `fontSize:12` | `color: HOME_THEME.green` — which is **`#8ECAE6`, a light blue, not a green** | Not rendered when `subtitle == null` |
| **A10** Card padding | `Card padding` default | `24` (px, all sides). Tabs override per card | none | n/a |
| **A11** Title/subtitle block spacing | `Card` header `<div>` | `marginBottom:16; display:flex; flexDirection:column; gap:2` | none | n/a |

---

## A.2 — Tab state, default tab and deep-link (`Scanner.tsx:3053–3087`)

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **A12** Initial tab | `useState<MainTab>("gexchangetop")` (`:3056`) | `"gexchangetop"` — GEX Change Top. Changed 2026-08-21; was `"gexlevels"` | Applies on first render, before the deep-link effect runs | n/a |
| **A13** Deep-link read | `readTabFromUrl()` (`scannerNav.ts:130–134`) in a mount effect with `[]` deps (`:3078–3081`) | `new URLSearchParams(window.location.search).get("tab")`, accepted only if `isScannerTabId(v)` | Runs **after** first paint, so the default tab renders for one frame and then swaps. Deliberate: keeps the page prerenderable and avoids a hydration mismatch (comment at `:3074–3076`) | Returns `null` during SSR/prerender (`typeof window === "undefined"`) and for any unrecognised `?tab=` value → the default stands |
| **A14** Deep-link is not owner-aware | Same effect, unconditional `setTab` | A pasted `?tab=pickstudy` **always wins the state**, for everyone | The render is gated separately (A18–A20). The URL is never corrected for a non-owner — the address bar keeps saying `pickstudy` while GEX Change Top is on screen | n/a |
| **A15** URL is never written back | — | Clicking a tab **inside** the page does not push `?tab=` | Same defect em.md records for `?ticker=`: a tab cannot be shared by copying the address bar, and browser back/forward do not move between tabs | **FIX IN v3** — route the tab through `useSearchParams` so the query string is the source of truth |
| **A16** Cross-component tab switch | `SCANNER_TAB_EVENT` = `"cb:scanner-tab"` (`scannerNav.ts:143`), listened for at `:3083–3087` | `window.addEventListener("cb:scanner-tab", …)`; handler reads `(e as CustomEvent<string>).detail` and calls `setTab(id as MainTab)` | Exists because the toolbar sub-strip links to `/scanner?tab=…`; while already on `/scanner` that is a query-string-only navigation and React Router does not remount `ScannerPage`, so the URL would move and the visible tab would not | Listener is removed on unmount |
| **A17** Event handler does not validate | `:3084–3086` | The handler accepts any truthy `detail` and casts it to `MainTab` — **no `isScannerTabId` check**, unlike the deep-link path (A13) | A malformed event id sets `tab` to a value no `visibleTab &&` branch matches → `PageShell` renders with **no card at all**, silently | **FIX IN v3** — validate on both paths |

---

## A.3 — Owner gate (`Scanner.tsx:3049–3066`, `useIsOwner.ts`, `scannerNav.ts:30–36`)

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **A18** Owner-only tab set | `OWNER_ONLY_TABS = new Set(SCANNER_TABS.filter(t => t.ownerOnly).map(t => t.id))` (`:3049–3051`) | Derived from the registry, not hand-listed. Today it contains exactly one id: **`"pickstudy"`** | Adding `ownerOnly: true` to any `TabDef` gates it in both the strip and the page with no other edit | n/a |
| **A19** Owner check | `useIsOwner()` → `{ isOwner, loaded }` | `isOwner = isOwnerClaim \|\| (ownerId && user?.id === ownerId)`, where `ownerId = process.env.NEXT_PUBLIC_OWNER_USER_ID.trim()`. `loaded = isLoaded` — false until `/api/auth/me` answers | The id-match fallback exists so the owner cannot be locked out before the `is_owner` claim is wired up on an account | `isOwner` is `false` while loading, so owner chrome never flashes for a non-owner |
| **A20** Rendered tab | `visibleTab = ownerGated ? (authLoaded ? "gexchangetop" : null) : tab` (`:3066`) | Three-way, not two: **`null` during the auth beat** | While auth resolves, an owner-gated tab renders **nothing** — no component mounts, so none of that tab's fetches fire. A flash of the wrong tab that then swaps is worse than an empty beat, and it would also fire the wrong tab's requests | `visibleTab === null` → `PageShell` with no children: the shell background and padding, nothing else |
| **A21** Non-owner fallback tab | Same expression | Once `authLoaded` is true, a non-owner on `pickstudy` lands on **`"gexchangetop"`** | Hardcoded — it is **not** read from `SCANNER_SECTION.defaultTab`, which says `"gexlevels"` (see A24) | n/a |
| **A22** Gate is chrome only | `TabDef.ownerOnly` JSDoc (`scannerNav.ts:30–36`) and `useIsOwner.ts:10–17` | — | **Not a security boundary.** A hidden client tab is one devtools poke away from visible. Anything that must not leak needs a server-side gate on its data route too — owner *routes* are blocked by `middleware.ts` and `components/shared/ownerGuard.tsx`, but an owner-only *tab* inside a public page is not | n/a |

---

## A.4 — Tab registry (`scannerNav.ts:38–63`)

`SCANNER_TABS`, in bar order. Every field is transcribed; `short` is what the
sub-strip prints when the row must fit one line, falling back to `label`.

| # | `id` | `label` | `short` | `color` | value | `icon` | `ownerOnly` |
|---|---|---|---|---|---|---|---|
| **A23a** | `gexlevels` | `"GEX Levels"` | `"Levels"` | `HOME_THEME.cyan` | `#219EBC` | `📏` | — |
| **A23b** | `gexchangetop` | `"GEX Change Top"` | `"GEX Δ Top"` | `HOME_THEME.orange` | `#FB8501` | `📊` | — |
| **A23c** | `pickstudy` | `"Pick Study"` | `"Study"` | `HOME_THEME.purple` | `#126783` | `🔬` | **`true`** |
| **A23d** | `strike` | `"Strike Query"` | `"Strike"` | `HOME_THEME.cyan` | `#219EBC` | `🎯` | — |
| **A23e** | `tpo` | `"TPO Structures"` | `"TPO"` | `LIGHT_BLUE` | `#7dd3fc` | `🏛️` | — |
| **A23f** | `ibstats` | `"IB Stats"` | `"IB Stats"` | `HOME_THEME.green` | `#8ECAE6` | `📐` | — |
| **A23g** | `watch` | `"Watch This"` | `"Watch"` | `LIGHT_BLUE` | `#7dd3fc` | `👁️` | — |

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **A24** Default tab, second declaration | `SCANNER_SECTION.defaultTab = "gexlevels"` (`sectionNav.ts:80`) | — | **Disagrees with the page.** `ScannerPage` opens on `"gexchangetop"` (A12); the section registry says `"gexlevels"`. Two sources of truth for one answer. The page wins on screen because the strip only reads `defaultTab` to decide which pill to mark current when no `?tab=` is present — so on a bare `/scanner` the strip highlights **GEX Levels** while **GEX Change Top** is rendered | **FIX IN v3** — one constant, read by both |
| **A25** Cluster grouping | `SCANNER_GROUPS` (`scannerNav.ts:109–113`) | Three clusters, left → right, hairline dividers between: `gamma` = `[gexlevels, gexchangetop, pickstudy, strike]`; `structure` = `[tpo, ibstats]`; `more` = `[watch]` + route `/level-log` | Every tab appears in exactly one cluster. A stale key in `groups` alone is harmless (`renderItem` returns `null` for an unknown id); a stale entry in `SCANNER_TABS` still draws the pill | n/a |
| **A26** Section routes | `SCANNER_ROUTES` (`scannerNav.ts:82–95`) | One entry: `{ href: "/level-log", label: "Level Log", short: "Log", color: HOME_THEME.orange, icon: "🧾" }` | Rendered after the tabs, marked `↗`. `/strike-history` left on 2026-08-16 (now Test Lab); `/replay` left when it became a top-level toolbar destination | n/a |
| **A27** Section path test | `SCANNER_SECTION_PATHS` + `isScannerSectionPath()` (`scannerNav.ts:116–126`) | `["/scanner", "/level-log"]`; the test strips a leading `/app` (`pathname.replace(/^\/app(?=\/\|$)/, "") \|\| "/"`) then matches `p === r \|\| p.startsWith(r + "/")` | Decides whether the Scanner sub-strip shows at all. Dropping a route from `SCANNER_ROUTES` is what stops the strip following you onto it | Returns `false` for `null`/`undefined`/`""` |
| **A28** Tab href helper | `scannerTabHref(id)` (`scannerNav.ts:120`) | `` `/scanner?tab=${id}` `` | Used when the bar is rendered off `/scanner` | n/a |
| **A29** Tab id guard | `isScannerTabId(v)` (`scannerNav.ts:122–124`) | `!!v && SCANNER_TABS.some(t => t.id === v)` | Note it does **not** filter `ownerOnly` — `isScannerTabId("pickstudy")` is `true` for everyone. That is why A14's deep link sets the state | n/a |

---

## A.5 — Shared table styles (`scannerStyles.ts`, whole file)

Every scanner-family tab imports these. Written out in full because they set the
look of six of the seven tabs and none of the values survive into v3 unchanged.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **A30** `NEUTRAL` | `scannerStyles.ts:16` | `"#6B7280"` | A bare literal — in `HOME_THEME`'s namespace but not in `HOME_THEME` | n/a |
| **A31** `fmtB(n)` | `:18–24` | Sign is **always shown**: `s = n < 0 ? "-" : "+"`. `≥1e9` → `${s}${(a/1e9).toFixed(2)}B`; `≥1e6` → `.toFixed(1)}M`; `≥1e3` → `.toFixed(1)}K`; else `.toFixed(0)`. ASCII hyphen, not U+2212 | `Math.abs(n)` drives the bucket, so `-1.4e9` → `"-1.40B"` | No null guard — `fmtB(null as any)` yields `"+NaN"` |
| **A32** `fmtInt(n)` | `:26` | `Math.round(n).toLocaleString()` — locale-grouped, no sign forced | none | Same: no null guard |
| **A33** `fmtChg(n)` | `:27` | `` `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()}` `` — plus sign for `>= 0`, minus comes from the number | **`0` renders `"+0"`** | Same |
| **A34** `th` | `:29` | `padding:"6px 10px"; textAlign:"right"; fontWeight:700; letterSpacing:"0.05em"` | No colour — call sites set it, most commonly `HOME_THEME.green` `#8ECAE6` on the header row | n/a |
| **A35** `td` | `:30` | `padding:"6px 10px"; textAlign:"right"` | `color: HOME_THEME.text` `#FFFFFF` | n/a |
| **A36** `seg(active)` | `:32–36` | `padding:"6px 14px"; borderRadius:8; fontSize:14; cursor:pointer; fontWeight:700` | Active: `border 1px HOME_THEME.cyan`, `background rgba(33,158,188,0.15)`, `color #FFFFFF`. Inactive: `border 1px rgba(255,255,255,0.15)`, `background transparent`, `color rgba(255,255,255,0.7)` | n/a |
| **A37** `zColor(z)` | `:38–43` | Ladder, in evaluation order: `z == null` → `rgba(255,255,255,0.4)`; `Math.abs(z) >= 3` → `HOME_THEME.red` `#EF4444`; `Math.abs(z) >= 2` → `HOME_THEME.orange` `#FB8501`; else `HOME_THEME.text` `#FFFFFF` | Both boundaries are `>=`, on the **absolute** value — a `-3.1σ` is coloured the same as `+3.1σ` | `null` → 40% white |

---

## A.6 — The legacy tab bar (`ScannerTabsBar.tsx`, whole file)

**`ScannerTabsBar` is not rendered by `ScannerPage`.** The page composes
`<PageShell>` + the active tab and nothing else; the visible strip today comes
from `SectionSubStrip`, mounted by `GlobalToolbar`. The bar is documented here
because it still exists, still exports the registry, and would be the obvious
thing to copy.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **A38** Two modes | `ScannerTabsBar({ active, onSelect })` (`:49–56`) | `onSelect` given → `<button>`s flipping local state. `onSelect` absent → `<Link href={scannerTabHref(id)} prefetch={false}>` | Strike History is a `<Link>` in **both** modes — it is a split-out page, not an inline tab | n/a |
| **A39** Owner filter | `tabs = SCANNER_TABS.filter(t => !t.ownerOnly \|\| isOwner)` (`:64`) | Applied to **both** the desktop row and the phone `<select>` | Same rule `SectionSubStrip` applies. This bar is legacy, but it must not be the one place a hidden tab still shows | n/a |
| **A40** Pill style | `tabStyle(isActive, color)` (`:66–77`) | `padding:"8px 20px"; borderRadius:8; fontSize:14; fontWeight:700; transition:"all 0.15s"; textDecoration:none; display:inline-flex; alignItems:center; gap:5` | Active border `1px solid ${color}`; inactive `1px solid rgba(255,255,255,0.1)`. Active background is **special-cased for cyan**: `color === HOME_THEME.cyan ? "rgba(33,158,188,0.15)" : `${color}22`` — a hex-alpha suffix everywhere else. Active text `#FFFFFF`, inactive `rgba(255,255,255,0.55)` | n/a |
| **A41** Row layout | `<div className="scanner-tabs">` (`:107`) | `display:flex; gap:10; marginBottom:4; flexWrap:wrap` | Paired with `.scanner-tab-select` in `app/globals.css`, which shows exactly one of the two by viewport | n/a |
| **A42** Phone `<select>` | `:90–105` | `display:"none"` inline (CSS un-hides it on a phone); `width:100%; padding:"8px 10px"; borderRadius:8; fontSize:14; fontWeight:700; marginBottom:4`; `border 1px HOME_THEME.cyan`; `background rgba(0,0,0,0.5)`; `color #FFFFFF`. Options are `t.label` per tab, then a literal `"Strike History"` option with value `"strikehistory"` | `value={active ?? "gex"}` — **`"gex"` is not a tab id any more** (it moved to Test Lab 2026-08-16), so with `active == null` the select falls back to a value no option carries and the browser shows the first option instead | n/a |
| **A43** Strike History link | `:117–133` | `<Link href="/strike-history" prefetch={false}>` styled with `tabStyle(true, LIGHT_BLUE)` — **always the active style** — then `color: HOME_THEME.text` and `opacity: active === "strikehistory" ? 1 : 0.95`. Label `"Strike History"`, followed by `<span style={{fontSize:11, opacity:.8}}>↗</span>` **only when not active** | Reads as permanently selected because it is; the 0.95/1 opacity is the only difference | n/a |

---

## A.7 — Adding the route in v3: the four edits (`cbedge-v3/AGENTS.md` "Adding a page")

Each of these is currently in its **retired** state and has to be reversed.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **A44** Edit 1 — the page | `cbedge-v3/src/pages/Scanner.tsx` | Today: a tombstone comment + `export {}` (retired 2026-08-30). Must become a default-exported component composed from `src/design/primitives/*` | The tombstone says the file survives only because the tooling could not delete it, and invites `git rm`. **Do not `git rm` it — overwrite it** | n/a |
| **A45** Edit 2 — the route | `cbedge-v3/src/App.tsx` | Add `const Scanner = lazy(() => import('@/pages/Scanner'))` beside the other seven, and `<Route path="/scanner" element={<Scanner />} />`. Also delete the "RETIRED 2026-08-30" comment block that names Scanner | Every route except the landing route is `lazy()`. Chunk names fall out of file names, which is what makes an over-budget route legible in `check-budgets.mjs` | Unregistered routes render `NotFound` — there is **no** catch-all redirect (v2 fell through to `/traders-dashboard`, which made a missing page look like it half-worked) |
| **A46** Edit 3 — the rail slot | `cbedge-v3/src/shell/Shell.tsx` → `NAV` | Add a `NavItem`: `{ to: '/scanner', label: 'Scanner', icon: '🔭', prefetch: [...] }`. Fields are `to`, `label`, `icon` (single emoji), `prefetch?: string[]`, `comingSoon?: boolean` | `prefetch` URLs fire through `preload()` from `@/data/api` on `onPointerEnter` (`Shell.tsx:181`). **Set them to the default tab's first fetch**, so the hover lands the click on data already home — the pattern the `/em` and `/replay` entries document. Do **not** ship it as `comingSoon` | Rail order persists per browser under `localStorage` key `cb-v3-rail-order`; a new `to` falls in via the `NAV.map(n => n.to)` fallback |
| **A47** Edit 4 — the SPA shell handler | `app/v3/scanner/route.ts` (v2 repo) | Today: `export const GET = () => new Response("Not found", { status: 404 })`. Must become the three-line form the other seven use: `import { serveSpaShell } from "@/lib/serveSpaShell"; export const dynamic = "force-dynamic"; export const GET = () => serveSpaShell("v3");` | **Miss this and the page works in-app but 404s on a hard refresh or a shared link.** Deliberately not solved with a catch-all: a catch-all under `/v3` would swallow `/v3/assets/*.js` and hand back HTML | `serveSpaShell` returns `"v3 build not found"` with status 404 if `public/v3/index.html` is missing |
| **A48** Optional — the seed | `serveSpaShell(app, seed?)` | A second argument is inlined as `window.__SPA_SEED__` just before `</head>`, so the route's first render has its data in the same response as the document | Without it the SPA serialises shell → entry chunk → route chunk → seed fetch, a 4th hop. `/v3/em`'s handler passes no seed today; `/v3/replay`'s is the pattern to copy if Scanner's default tab has a cheap server-side payload | Client keeps a fetch fallback for when the key is absent |
| **A49** Also update | `cbedge-v3/src/pages/TradersDashboard.tsx` → `ALL_PAGES` / `LIVE_ROUTES` | `/scanner` was removed from both on 2026-08-30. `Shell.tsx:44–46` states this list, `App.tsx`'s routes and `ALL_PAGES`/`LIVE_ROUTES` **move together** | A route present in `App.tsx` but absent from `LIVE_ROUTES` will read as dead on the Traders Dashboard's own page index | n/a |

---

## A.8 — Tab → component mount table (`Scanner.tsx:3088–3098`)

All seven are plain `&&` conditionals inside one `<PageShell>` — **no `lazy()`,
no `Suspense`, no keep-alive.** Switching tabs unmounts the previous component
outright, so all of its state and all of its fetched data are discarded and
refetched on return.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **A50** `gexlevels` | `<GexLevelsTab />` — `components/scanner/GexLevelsTab.tsx` | Static import (`Scanner.tsx:42`) | — | See Part B |
| **A51** `gexchangetop` | `<GexChangeTop />` — `components/scanner/GexChangeTop.tsx` | Static import (`:40`) | The default tab | See Part C |
| **A52** `pickstudy` | `<PickStudyTab />` — `components/scanner/PickStudyTab.tsx` | Static import (`:41`) | Owner-gated (A18–A22) | See Part D |
| **A53** `strike` | `<StrikeQueryScanner />` — inline, `Scanner.tsx:624–895` | — | — | See Part E |
| **A54** `tpo` | `<TpoStructuresScanner />` — inline, `Scanner.tsx:2896–3043` | — | — | See Part F |
| **A55** `ibstats` | `<IbStatsTab />` — `components/scanner/IbStatsTab.tsx` | Static import (`:36`) | — | See Part G |
| **A56** `watch` | `<WatchThisScanner />` — inline, `Scanner.tsx:1639–2058` | — | — | See Part H |
| **A57** Every tab is in the entry chunk | All seven imports are static | Four large components (`GexLevelsTab` 107KB, `IbStatsTab` 105KB, `GexChangeTop` 79KB, `PickStudyTab` 38KB) plus 3,100 lines of page ship to every visitor who lands on `/scanner`, whichever tab they open | Violates v3 non-negotiable 7 (budgets) as written | **FIX IN v3** — `lazy()` per tab, so a tab's chunk is legible in `check-budgets.mjs` and only the opened one downloads |
| **A58** No tab is kept alive | `&&` conditionals | Every tab switch is a full unmount → remount → refetch | Combined with A57 this is the page's whole perf story | **FIX IN v3** — the REST layer's cache (`src/data/api.ts`) makes a remount cheap without keep-alive; do not reach for a manual cache |

---

## Colours used

`HT` = `HOME_THEME` (`components/shared/homeTheme.ts:3–17`). Right-hand column
keyed against `cbedge-v3/src/design/tokens.css`.

| v2 value | Where used in Part A | Exists in v3 `tokens.css`? | v3 token to use |
|---|---|---|---|
| `HT.bg` `#05060A` | page canvas | yes — `--color-v2-bg` | `V2.bg` |
| `HT.panel` `#0D1119` | card base | yes — `--color-v2-panel` | `V2.panel` |
| `HT.panelBg` `rgba(13,17,25,0.45)` | card plate | no exact | `alpha(V2.panel, .45)` |
| `HT.panelBgStrong` `rgba(13,17,25,0.72)` | denser plates | no exact | `alpha(V2.panel, .72)` |
| `HT.border` `rgba(255,255,255,0.10)` | every card edge | no exact — `--color-line` is opaque `#23272e` | `alpha(T.text, .10)` |
| `HT.text` / `HT.muted` `#FFFFFF` | all body text | yes — `--color-fg` | `T.text` |
| `HT.cyan` `#219EBC` | GEX Levels + Strike Query pills, `seg()` active, active tab background `rgba(33,158,188,.15)` | yes — `--color-v2-cyan` | `V2.cyan` |
| `HT.orange` `#FB8501` | GEX Change Top pill, Level Log route, `zColor` 2σ band | yes — `--color-v2-orange` | `V2.orange` |
| `HT.purple` `#126783` | Pick Study pill, page glow's second radial | yes — `--color-v2-purple` | `V2.purple` |
| `HT.green` `#8ECAE6` | IB Stats pill, **every card subtitle**, most table headers | yes — `--color-v2-green`, documented there as "a LIGHT BLUE" | **Split — see below** |
| `HT.red` `#EF4444` | `zColor` 3σ band | yes — `--color-v2-red` | `MOVE_DOWN` `--color-move-down` `#e0645f` |
| `LIGHT_BLUE` `#7dd3fc` | TPO + Watch This pills, Strike History link | no exact — `--color-v2-lightblue` is `#7ed3fc`, `--color-series-5` is `#4fb8d4` | `T.series5` |
| `SOFT_RED` `#f4948e` | declared, unused in Part A | no | — |
| `NEUTRAL` `#6B7280` | `scannerStyles` | yes — `--color-impact-holiday` `#6b7280` | `CAL.holiday`, or `T.flat` `#7a828d` |
| `HT.shellGlow` | page background radials | no | gradient built from `V2.cyan` / `V2.purple` |
| `rgba(255,255,255,0.7)` | `seg()` inactive text | no | `alpha(T.text, .7)` |
| `rgba(255,255,255,0.55)` | `tabStyle` inactive text | no | `alpha(T.text, .55)` |
| `rgba(255,255,255,0.4)` | `zColor(null)` | no | `alpha(T.text, .4)` |
| `rgba(255,255,255,0.15)` | `seg()` inactive border | no | `alpha(T.text, .15)` |
| `rgba(255,255,255,0.1)` | `tabStyle` inactive border | no | `alpha(T.text, .10)` |
| `rgba(0,0,0,0.5)` | phone `<select>` background | `--color-shadow` is `#000000` | `alpha(T.shadow, .5)` |

**The collapse case for this page: `HOME_THEME.green` is `#8ECAE6`, a light
blue, doing three unrelated jobs.** It is (1) chrome — every `Card` subtitle and
most table header rows; (2) the IB Stats tab accent; (3) the *positive/up*
semantic in six of the seven tabs, painted against `HT.red` for negative. So a
"good" number and the column heading above it are the same colour, and the
positive colour is a blue. Every part of this doc reports the same collision
independently (B: three positives; C, D, E, G, H: two or more).

**The port collapses it by construction**, exactly as em.md did for its
two-reds: chrome → `T.muted`; positive → `MOVE_UP` `--color-move-up` `#35c28e`;
negative → `MOVE_DOWN` `--color-move-down` `#e0645f`; the IB Stats accent →
`T.series5`. Rows above still record what v2 did, because the record is the
point.

**Type scale.** Part A paints at 12 / 14 px. v3's scale is 9 / 10 / 11 / 13 / 15
/ 18 / 24 / 32 and has neither. Card titles (14/800/uppercase) → `text-sm` with
the weight kept; subtitles (12) → `text-xs`. Every tab reports the same problem
at 12 / 14 / 17 px, so re-pegging is page-wide, not per-tab. Nothing in v3 may
name a px size: canvas and SVG read the number off the same scale.

---

## Do not port

1. **`ScannerTabsBar.tsx` in its entirety.** Not rendered by the page; superseded
   by `SectionSubStrip`. It also drags `next/link` and `next/navigation` — both
   banned in v3, which is React Router under `basename="/v3"`.
2. **`ScannerSubStrip.tsx`.** Marked `DEPRECATED — safe to delete` in its own
   header; it is a bare re-export of `SectionSubStrip`. Nothing imports it.
3. **`GreeksScanner`** (`Scanner.tsx:107–248`) and its `MODE_META`, `GreekMode`,
   `GreekRow`. Fully written — four modes, a 60 s poll of
   `GET /proxy/greek-scanner?window={15|30|60}&mode={charm|vanna|gamma|tg}&limit=25`,
   a 9–11 column table, a `◆ near spot (<2%)` marker, a z-score legend — and
   **reachable from no tab**: `ScannerPage`'s seven `&&` branches never name it.
   **Brandon 2026-09-02: the live Greeks scanner is on the owner page.** This
   copy is a stale fork; do not port it, and do not treat the owner page's
   version as in scope for `/v3/scanner`.
4. **`VolPinScanner`** (`:433–598`) plus `PinRow`, `fmtPct`, `pinStatusRank`,
   `SortTh`, `PinStatus`, `PinSortKey`, `pinSortValue`, `PinEvent`, `PinEventLog`
   (`:253–432`). Same story: an 11-column sortable table over
   `GET /proxy/vol-pin-scanner?limit=30&minSnapshots={n}`, a
   PINNING/SQUEEZING/WATCHING status ladder, an event log — and no tab reaches
   it. Do not port.
5. **`Win` type** (`:55`). Its comment says it stays "because `GreeksScanner`
   below still uses it"; with #3 dead, so is the type.
6. **`PageShell` / `Card` from `@/components/shared/PageCard`.** v2 chrome. v3
   uses `src/design/primitives/Page.tsx` + `Card.tsx`.
7. **`ThemedSelect`** (`@/components/shared/ThemedSelect`). v3 has
   `src/design/primitives/Controls.tsx`.
8. **Every colour literal in `scannerStyles.ts`** — `#6B7280`,
   `rgba(255,255,255,0.15)`, `rgba(33,158,188,0.15)`, `rgba(255,255,255,0.7)`.
   v3 non-negotiable 1: nothing outside `tokens.css`.
9. **`fontSize: 14` / `12` inline** throughout Part A. v3 non-negotiable 1's type
   scale — no `text-[14px]`, no `fontSize: 12`.
10. **The `.scanner-tabs` / `.scanner-tab-select` viewport swap** in
    `app/globals.css`. v3 has `src/design/useIsPhone.ts`; a phone variant is a
    component decision, not a stylesheet that reaches across apps.
11. **`useIsOwner` from `@/components/shared`.** It reads v2's `AuthProvider`.
    v3 has `src/data/auth.tsx` — re-derive the same rule (`isOwnerClaim ||
    id-match against the owner env var`, plus a `loaded` flag) against it, and
    keep A20's three-way `null` beat.
12. **The unvalidated `SCANNER_TAB_EVENT` handler** (A17). Keep the mechanism
    only if v3 still needs cross-component tab switching — with the tab in the
    query string (A15) it does not, because a `useSearchParams` write is
    observed by the page directly.
13. **`OWNER_ONLY_TABS` as a `Set<MainTab>` built at module scope from a
    filtered array.** Keep the derivation (it is why one flag gates both
    surfaces); drop the double cast.
14. **The `?tab=` deep-link-in-an-effect pattern** (A13). It exists to keep the
    Next page prerenderable. v3 is a Vite SPA — read the param synchronously
    from the router and skip the one-frame wrong-tab flash entirely.
15. **`SCANNER_SECTION.defaultTab`'s second answer** (A24). One constant in v3.

---

## Open questions for Brandon

1. **Does `/v3/scanner` want the tabs in the URL?** A15 records that v2 cannot
   share a tab by copying the address bar. The `/v3/em` handler's comment says a
   shared link *is* a hard refresh and that is why step 4 matters — same argument
   applies to `?tab=`. Proposal: `useSearchParams`, so back/forward move between
   tabs and `/v3/scanner?tab=ibstats` is pasteable.
2. **Which tab should `/v3/scanner` open on?** v2 has two answers (A12
   `gexchangetop`, A24 `gexlevels`) and I am porting whichever you name, once.
3. **Does Pick Study come to v3 at all?** It is owner-only research (A18), and
   its data routes may have no server-side gate (Part D lists the five it hits
   and could only prove a gate on two). If it ships, the gate needs a server
   answer first.
4. **Does the Level Log route (`/level-log`) come across as part of the Scanner
   section?** It is the only entry in `SCANNER_ROUTES` and would need its own
   page, route and shell handler — a second port, not part of this one.
5. **Strike History** (`/strike-history`) is linked from `ScannerTabsBar` but
   belongs to Test Lab since 2026-08-16. Confirm it is out of scope here.
6. **Seven tabs in one route, or split?** A57/A58: v2 ships all four large tab
   components in the entry chunk and refetches everything on every tab switch.
   Per-tab `lazy()` inside one `/scanner` route is the straight port; separate
   `/v3/<tab>` routes would be a different page shape. I am assuming the former.
7. **Rail icon and prefetch for the new `NAV` entry** (A46). I will use `🔭` and
   the default tab's first endpoint unless you want something else — the icon is
   the one thing in the four edits that is a taste call, not a transcription.

**Part A row count: 58**
# Part B — GEX Levels (`?tab=gexlevels`)

## Scope

| Layer | File | Lines covered |
|---|---|---|
| Tab registration + accent + group | `components/scanner/scannerNav.ts` | 16–17, 49–64, 103–107, 122–126, 133–150 |
| Route + mount + owner gate | `components/pages/Scanner.tsx` | 8, 42, 50, 3049–3098 |
| **Tab component (whole file)** | `components/scanner/GexLevelsTab.tsx` | **1–2233 (all of it)** |
| — module header + `AmTbrStat` | ” | 1–90 |
| — types + accessors + fmt helpers | ” | 92–155 |
| — `useGexLevels` + `deriveGexLevels` | ” | 157–234 |
| — `GlEmpty` / `ChartLegend` / `SemiGauge` | ” | 236–288 |
| — `useChartHover` / `mergeRefs` / `useChartPan` / `ChartTooltip` | ” | 290–407 |
| — cumulative curve math + sign segments + colours | ” | 409–470 |
| — `NetGammaByStrikeChart` | ” | 472–570 |
| — `NetGammaBarsByStrikeChart` | ” | 572–653 |
| — `NetDeltaByStrikeChart` | ” | 655–727 |
| — `CallPutGammaByStrikeChart` | ” | 729–798 |
| — `OiByDateChart` | ” | 800–850 |
| — OI-by-expiration data layer + charts + panel | ” | 852–1035 |
| — EOD GEX data layer + chart + panel | ” | 1037–1246 |
| — multi-expiry ladder data layer + two panels | ” | 1248–1470 |
| — daily history log (types, storage, merge) | ” | 1472–1583 |
| — `GlCurveSpark` + `HistoryTable` | ” | 1585–1668 |
| — card layout / drag-and-drop | ” | 1670–1904 |
| — `GexLevelsTab` body: header card + 12-card registry + columns | ” | 1906–2233 |
| **Card 12 body (whole file)** | `components/dashboard/VolGexFlowPanel.tsx` | **1–612 (all of it)** |
| — constants, types, format helpers | ” | 33–142 |
| — state, persistence, fetch + poll | ” | 144–214 |
| — picker options, `stats`, `pctStats` | ” | 216–273 |
| — chart creation, series, data push, view swap | ” | 275–428 |
| — the six stat tiles | ” | 430–458 |
| — header controls, tile grid, chart box, scrim | ” | 460–612 |
| Refresh-button hook | `hooks/useRefreshButton.ts` | 1–34 |
| Card surface | `components/shared/PageCard.tsx` | 84–145 |
| Theme constants | `components/shared/homeTheme.ts` | 3–18, 88, 176–215, 217–238, 258–271, 287–318 |
| Read-only expiry dropdown | `components/shared/ThemedSelect.tsx` | 1–213 |
| v3 token targets | `cbedge-v3/src/design/tokens.css`, `cbedge-v3/src/design/theme.ts` | tokens 36–266; theme 40–221 |

**Everything this tab renders is transcribed.** `hooks/useRefreshButton.ts` and
`components/dashboard/VolGexFlowPanel.tsx` were staged after the first pass and
are covered in full (rows **B59** and **B263**–**B334** respectively).

**Note on row order.** Rows **B275**–**B335** were added in the second pass and
sit topically — the card-12 block in section B16, the sixth endpoint in
section B17 — so the row anchors are unique and complete but no longer ascend
strictly in file order. Numbering is stable; do not renumber on assembly.

**Test-Lab residue.** This tab lived inline in `components/pages/TestLab.tsx`
until 2026-08-16 (`GexLevelsTab.tsx:3–14`). The body was moved verbatim; three
things are still Test-Lab-shaped and are called out individually in rows below
and in **Do not port**: (1) the `gl*` / `Gl*` symbol prefix on every helper,
which existed only to avoid collisions inside the one big TestLab module and is
pointless in a file of its own; (2) the module header comment at lines 69–90
that still advertises panels this file does not contain; (3) `AmTbrStat`
(lines 24–67), a tile lifted along with the tab because "GexLevelsTab was its
only remaining consumer", carrying a doc comment about an AM TBR feature that
now lives on `/es-candles`.

---

## Shared inline constants used throughout Part B

`HT` = `HOME_THEME` (`components/shared/homeTheme.ts:3–18`).

- `HT.bg` `#05060A` · `HT.panel` `#0D1119` · `HT.cyan` `#219EBC` ·
  `HT.purple` `#126783` · `HT.orange` `#FB8501` · `HT.green` `#8ECAE6` (a light
  blue, not a green) · `HT.red` `#EF4444` · `HT.muted` = `HT.text` = `#FFFFFF` ·
  `HT.border` `rgba(255,255,255,0.10)` · `HT.panelBg` `rgba(13,17,25,0.45)`
- `LIGHT_BLUE` = `#7dd3fc` (`homeTheme.ts:88`)
- `GEX_POS_GREEN` = `#22C55E` (`GexLevelsTab.tsx:456`) — declared locally with a
  comment explaining it is deliberately NOT `HT.green`
- `statTileStyle` = `bg HT.panelBg · backdropFilter blur(20px) · border none ·
  borderRadius 16` (`homeTheme.ts:209–215`)
- `homeInputStyle` = `fontSize 14 · padding 8px 12px · 1px solid HT.border ·
  radius 6 · bg rgba(0,0,0,0.4) · color HT.text · outline none` (`217–225`)
- `homeButtonStyle` = `padding 5px 10px · radius 6 · border 1px
  rgba(33,158,188,.25) · bg linear-gradient(180deg,rgba(33,158,188,.12),
  rgba(33,158,188,.04)) · color HT.cyan · fontSize 10 · weight 700 ·
  letterSpacing .08em · uppercase · cursor pointer` (`227–238`)
- `Card` (`PageCard.tsx:84–145`) with `variant="budget"` resolves to
  `classicCardAccentStyle` = `bg HT.panelBg · backdropFilter blur(16px) ·
  radius 18 · 1px solid HT.border · boxShadow 0 18px 40px rgba(0,0,0,0.22)`,
  `padding 24`, class `card-hover`. Header block: `marginBottom 16`, flex column
  gap 2; title `14px / 800 · letterSpacing .12em · uppercase · HT.text`;
  subtitle `12px · HT.green (#8ECAE6)`.

---

# B — Part rows

## B1 — Tab frame, route, mount and gating
`scannerNav.ts:16–17, 49–64, 103–107, 122–126, 133–150` · `Scanner.tsx:3049–3098`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B1** `"GEX Levels"` — tab pill label | `SCANNER_TABS[0].label` (`scannerNav.ts:50`) | Literal string. Position 0 — first pill in the bar | `color: HOME_THEME.cyan` `#219EBC`; `icon: "📏"` | Always rendered (no `ownerOnly` flag) |
| **B2** `"Levels"` — compact pill label | `SCANNER_TABS[0].short` | Used only by the GlobalToolbar sub-strip, where the whole row must fit on one line | Same cyan + 📏 | Falls back to `label` if `short` omitted; it is not omitted here |
| **B3** Tab id / deep link | `?tab=gexlevels` | `scannerTabHref("gexlevels")` → `"/scanner?tab=gexlevels"` (`scannerNav.ts:122`) | — | `readTabFromUrl()` (`133–137`) reads `?tab` from `window.location.search` in an **effect**, not `useSearchParams`, so the page stays prerenderable. First paint is always the default tab, then it swaps |
| **B4** Default tab of `/scanner` | `useState<MainTab>("gexchangetop")` (`Scanner.tsx:3056`) | GEX Levels is **not** the default. It was until 2026-08-21 (`scannerNav.ts:101`) | — | A bare `/scanner` never opens this tab |
| **B5** In-place tab switch | `SCANNER_TAB_EVENT` = `"cb:scanner-tab"` (`scannerNav.ts:145–150`) | `window.dispatchEvent(new CustomEvent(...,{detail:id}))`; `ScannerPage` listens and calls `setTab` (`Scanner.tsx:3079–3086`) | — | Needed because React Router does not remount `ScannerPage` for a query-only navigation |
| **B6** Owner gate | `OWNER_ONLY_TABS` = `SCANNER_TABS.filter(t=>t.ownerOnly)` (`Scanner.tsx:3049–3051`) | `"gexlevels"` is **not** in the set — only `"pickstudy"` is | `visibleTab = ownerGated ? (authLoaded ? "gexchangetop" : null) : tab` | GEX Levels renders for every visitor, owner or not. Nothing on this tab is `useIsOwner()`-conditional |
| **B7** Mount | `{visibleTab === "gexlevels" && <GexLevelsTab />}` (`Scanner.tsx:3091`) | Hard unmount when the tab is not visible | — | Switching away tears down every interval and every piece of state in this file; switching back re-mounts from scratch and re-fires all four fetches |
| **B8** Page shell | `<PageShell>` (`PageCard.tsx:41–77`) | `homeShellStyle` (bg `HT.bg`, `backgroundImage HT.shellGlow`, font `var(--font-inter)`) + `homeContentStyle` (`flex 1`, `padding clamp(14px,2vw,24px)`, `gap clamp(16px,2vw,32px)`, `overflow auto`), `alignItems: stretch` | — | v2-only chrome. See **Do not port** |
| **B9** Tab root element | `<>…</>` fragment (`GexLevelsTab.tsx:1971`) | The component renders a header `Card` then, conditionally, a 2-column flex wrapper. No wrapping div, no section landmark | — | — |

## B2 — Number and date format helpers
`GexLevelsTab.tsx:140–155, 951–954, 1500–1509`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B10** `glFmt0(n)` | `:140–142` | `Number.isFinite(n) ? Math.round(n).toLocaleString() : "—"` — rounds to integer, then **browser-locale** grouping (`1,234` in en-US, `1.234` in de-DE) | — | `"—"` for `null`, `undefined`, `NaN`, `Infinity` |
| **B11** `glFmt2(n)` | `:144–146` | `Number.isFinite(n) ? n.toFixed(2) : "—"` — exactly 2 dp, **no** thousands separator (`6412.50`, not `6,412.50`) | — | `"—"` |
| **B12** `glFmtBn(n)` | `:148–155` | Three-branch ladder on `abs = Math.abs(v)`: `abs >= 1e9` → `` `${(v/1e9).toFixed(2)}bn` `` · `abs >= 1e6` → `` `${(v/1e6).toFixed(1)}M` `` · else → `v.toFixed(0)`. Suffix case is **inconsistent**: lowercase `bn`, uppercase `M`. Sign is whatever `toFixed` prints, so negatives read `-1.24bn`. The `< 1e6` branch has no grouping at all: `-412773` | Boundaries are `>=` on the absolute value, both times | `"—"` when not finite |
| **B13** `glFmtDate(ymd)` | `:1504–1509` | `ymd.split("-").map(Number)` → `` `${months[m-1] ?? ""} ${day}, ${y}` `` with `months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]` → `"Aug 14, 2026"` | — | Returns the raw `ymd` unchanged if `y`, `m` or `day` is falsy (covers `""`, `NaN`, and a genuine month `0`) |
| **B14** `glFmtExpiryLabel(ymd)` | `:951–954` | `const [, m, d] = ymd.split("-").map(Number)` → `` `${m}/${d}` `` → `"8/14"`. No zero padding, no year | — | Returns the raw `ymd` when `m` or `d` is falsy |
| **B15** `todayEtDate()` | `:1500–1502` | `new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(new Date())` → `"2026-09-02"`. `en-CA` is chosen purely because it yields ISO ordering | — | n/a |
| **B16** `glOiVolNet(r)` | `:123–125` | `(r.netGEX ?? 0) + (r.netVolGEX ?? 0)` — the OI+Vol gamma basis used by **every** gamma surface on this tab | — | Missing legs count as 0, not as "no data" |
| **B17** `glDexOf(r, basis)` | `:135–138` | `const oi = r.netDEX ?? 0; return basis === "oi" ? oi : oi + (r.volNetDEX ?? 0)` — `"oi"` is the default and the 0DTE card's basis; `"oivol"` is the ex-0DTE card's | — | Missing legs count as 0 |

## B3 — Data layer: the live 0DTE feed
`GexLevelsTab.tsx:92–121, 157–234`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B18** Primary fetch | `GET /proxy/gex` (`:162`) | `fetch("/proxy/gex", { cache: "no-store" })`. No query params. Response is a `GexLevelsSnapshot`: `{ symbol?, spot?, expiry?, expirations?: string[], gexRows?: GexLevelsRow[], callWall?, putWall?, gexFlip?, totalNetGex?, updatedAt? }` | `!r.ok` → `throw new Error(\`proxy ${r.status}\`)` | Rejection sets `err` to the message; `snap` keeps its **previous** value, so the page shows stale data plus an error banner rather than blanking |
| **B19** Poll interval | `setInterval(tick, 15_000)` (`:173`) | **15 s**, fixed, no jitter, no visibility check, no market-hours gate. First tick fires immediately on mount | — | `alive` flag + `clearInterval` on unmount; the in-flight fetch is **not** aborted (no `AbortController`) |
| **B20** Row shape | `GexLevelsRow` (`:92–108`) | Eleven fields, in declaration order: `strike`, `callOI`, `putOI`, `callVolume`, `putVolume`, `callGEX`, `putGEX`, `netGEX`, `netVolGEX`, `netDEX` — all required `number` — plus `volNetDEX?: number`, optional only because older localStorage cache shapes predate it | — | `callVolume` / `putVolume` are declared and never read anywhere in the file |
| **B21** `deriveGexLevels(s)` — row filter | `:198` | `(s.gexRows ?? []).filter(r => r && Number.isFinite(r.strike)).slice().sort((a,b) => a.strike - b.strike)` — ascending strike. The `r &&` guard is there because a socket frame can carry a null hole | — | Returns `null` (→ whole card set hidden) when `!rows.length` |
| **B22** `deriveGexLevels` — spot gate | `:199–200` | `const spot = Number(s.spot ?? 0); if (!rows.length \|\| !(spot > 0)) return null` | Strictly `> 0`; a spot of exactly `0` or `NaN` kills the derive | Returns `null` |
| **B23** `resistance` / `support` / `neutral` | `:202–204` | `Number.isFinite(s.callWall) ? s.callWall : null` (same for `putWall` → `support`, `gexFlip` → `neutral`) | — | `null` |
| **B24** `dollarGamma` | `:205–207` | `Number.isFinite(s.totalNetGex) ? s.totalNetGex : rows.reduce((sum,r) => sum + glOiVolNet(r), 0)` — server value preferred, client sum is the fallback | — | Falls back silently; the UI never says which of the two it is showing |
| **B25** `cpgRatio` | `:209–216` | `totalCallGEX / totalPutGEXabs` where `totalCallGEX += Math.max(0, r.callGEX ?? 0)` (negative callGEX clamped to 0) and `totalPutGEXabs += Math.abs(r.putGEX ?? 0)` | `totalPutGEXabs > 0 ? ratio : 0` — a zero put book yields a ratio of **0**, i.e. it renders as maximally put-heavy, which is backwards | `0` |
| **B26** `r2` — 2nd resistance | `:221–223, 230` | `rows.filter(r => r.strike > spot && glOiVolNet(r) > 0 && r.strike !== resistance).sort((a,b) => glOiVolNet(b) - glOiVolNet(a))[0]?.strike ?? null` — strictly above spot, strictly positive net gamma, excluding the #1 wall; sorted net-gamma DESC | All three conditions are strict (`>`, `>`, `!==`) | `null` when no strike qualifies |
| **B27** `s2` — 2nd support | `:224–226, 231` | `rows.filter(r => r.strike < spot && glOiVolNet(r) < 0 && r.strike !== support).sort((a,b) => glOiVolNet(a) - glOiVolNet(b))[0]?.strike ?? null` — strictly below spot, strictly negative, excluding #1; sorted net-gamma ASC (most negative first) | Strict | `null` |
| **B28** `totalCallOI` / `totalPutOI` | `:213–214, 232` | `sum(r.callOI ?? 0)` and `sum(r.putOI ?? 0)` over the filtered rows. Consumed only as `openInt = totalCallOI + totalPutOI` on the history row (`:1936`) | — | `0` |
| **B29** `d` memo | `useMemo(() => deriveGexLevels(snap), [snap])` (`:1912`) | Recomputes on every 15 s frame — `setSnap(j)` always installs a new object identity even when the payload is byte-identical | — | `null` until the first successful `/proxy/gex` |

## B4 — Header card: `"{SYMBOL} · GEX Levels"`
`GexLevelsTab.tsx:1965–2046` (tiles: `24–67`; gauges: `253–288`)

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B30** Card title `"SPX · GEX Levels"` | `` `${snap?.symbol ?? "SPX"} · GEX Levels` `` (`:1975`) | Wrapped in `<span style={{fontSize:17}}>`, which **overrides** the Card's own 14px title style. Card title also applies `800 weight · letterSpacing .12em · uppercase · HT.text` | — | Reads `"SPX · GEX Levels"` before the first frame, because `snap` is null and `"SPX"` is the literal fallback |
| **B31** Card subtitle — loaded | `` `${snap?.expiry ?? "0DTE"} expiry · spot ${glFmt2(d.spot)} · as of ${asOf} ET` `` (`:1976`) | e.g. `"2026-09-02 expiry · spot 6412.35 · as of 03:41:07 PM ET"`. Style: `12px · HT.green #8ECAE6` | — | — |
| **B32** Card subtitle — loading | Same ternary, `d` falsy branch | `"loading live /proxy/gex snapshot…"` (single `…` glyph) | Same 12px `HT.green` | This IS the first-paint subtitle |
| **B33** `asOf` | `:1965–1967` | `new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(snap.updatedAt))` → `"03:41:07 PM"`. **Forced ET**, unlike EM's browser-local stamp | — | `"—"` when `snap?.updatedAt` is falsy — including `0` |
| **B34** Feed error banner | `err` from `useGexLevels` (`:1978`) | `` `Feed error: ${err}` `` — `fontSize 14 · marginBottom 10` | `color: HT.red` `#EF4444`. No background, no border, no icon | Rendered whenever `err` is truthy, **including alongside a stale `d`** — the tiles keep showing the last good numbers underneath |
| **B35** Waiting state | `!d && !err` (`:1979`) | `<GlEmpty note="waiting on /proxy/gex…" />` → `padding 32 · textAlign center · fontSize 14 · HT.text · opacity 0.5` | — | This is the whole body until the first frame; **no skeleton, no spinner** |
| **B36** Stat row container | `:1981` | `display:flex · flexWrap:wrap · gap:14 · alignItems:center` — the tiles, both gauges, the expiry select and the refresh button all sit in one wrapping row | — | Rendered only when `d` is truthy |
| **B37** `"Stock Filter"` label | Static (`:1983`) | `17px / 800 · letterSpacing .08em · uppercase · HT.text · opacity 0.6`; column wrapper `gap 4 · minWidth 120` | — | Always rendered inside the `d` block |
| **B38** Stock Filter value | `snap?.symbol ?? "SPX"` (`:1984`) | A **`<div>`, not an `<input>`** — `homeInputStyle` + `fontSize 14 · opacity 0.7 · cursor not-allowed · textAlign center · fontWeight 800`. So: `bg rgba(0,0,0,0.4)`, `1px HT.border`, `radius 6`, `padding 8px 12px` | Read-only by construction. It has no `disabled` attribute and is not focusable — it only *looks* like a disabled input | `"SPX"` fallback |
| **B39** `AmTbrStat` tile shell | `:46–66` | `statTileStyle` + `padding "16px 18px"` → `bg HT.panelBg · blur(20px) · no border · radius 16`. Label row `flex · alignItems baseline · gap 7` | Whole tile carries `title={title}` when the prop is passed | — |
| **B40** `AmTbrStat` label | `:49–51` | `17px / 700 · uppercase · letterSpacing .08em · HT.text · opacity 0.6` | — | — |
| **B41** `AmTbrStat` value | `:64` | `14px / 900 · color = accent · marginTop 6`. **The value is 3px SMALLER than its own label** — this is what the code does, not a typo in this doc | Colour is entirely the caller's `accent` prop; the tile applies no threshold of its own | Callers pass `"—"` as the value string |
| **B42** `AmTbrStat` scope chip `"0DTE"` | `:52–62`, rendered only when `scope` is truthy | `11px / 800 · letterSpacing .06em · padding "1px 6px" · borderRadius 999 · whiteSpace nowrap` | `color: LIGHT_BLUE #7dd3fc` · `background: rgba(141,205,255,0.10)` · `border: 1px solid rgba(141,205,255,0.28)`. **The chip's text and its plate are two different blues** — `#7dd3fc` vs `#8DCDFF`. See **Colours used** | Chip omitted entirely when `scope` is absent |
| **B43** Tile — `"Stock Price"` | `glFmt2(d.spot)` (`:1986`) | 2 dp, no grouping. `accent = HOME_THEME.text` `#FFFFFF` | No threshold | Never `"—"` — the derive already required `spot > 0` |
| **B44** Tile — `"Resistance"` | `d.resistance != null ? glFmt0(d.resistance) : "—"` (`:1992–1996`), from `/proxy/gex → callWall` | Rounded integer + locale grouping | `accent = LIGHT_BLUE #7dd3fc`. `scope="0DTE"` chip | `"—"` |
| **B45** `"Resistance"` tooltip | `title=` on the tile (`:1995`) | `"Call wall on the live feed's single expiry (±8% of spot). The ex-0DTE card lower down has the whole board's."` | — | Always present on this tile |
| **B46** Tile — `"Support"` | `d.support != null ? glFmt0(d.support) : "—"` (`:1997–2001`), from `/proxy/gex → putWall` | Rounded integer + grouping | `accent = HOME_THEME.red #EF4444`. `scope="0DTE"` chip | `"—"` |
| **B47** `"Support"` tooltip | `title=` (`:2000`) | `"Put wall on the live feed's single expiry (±8% of spot). The ex-0DTE card lower down has the whole board's."` | — | Always present |
| **B48** Tile — `"Neutral"` | `d.neutral != null ? glFmt0(d.neutral) : "—"` (`:2002–2006`), from `/proxy/gex → gexFlip` | Rounded integer + grouping | `accent = HOME_THEME.text #FFFFFF` | `"—"` |
| **B49** `"Neutral"` tooltip | `title=` (`:2005`) | `"Gamma flip on the live feed's single expiry. The all-expirations and ex-0DTE cards lower down each report their own — they are not meant to match this one."` | — | Always present |
| **B50** `SemiGauge` geometry | `:261–284` | `W 200 · H 118 · cx 100 · cy 100 · r 78`; `viewBox "0 0 200 126"`, `width 100%`, `maxWidth 190`, `display block`. Value clamped to `[min,max]`; `frac = (v-min)/(max-min \|\| 1)`; `angle = π − frac·π` (left = min, right = max) | — | Renders even at `value = 0` |
| **B51** `SemiGauge` bands | `:278–280` | One `<path>` per band, `strokeWidth 13`, `fill none`, `opacity 0.9`, arc radius 78, sweep-flag 1 | Colours are per-band, supplied by the caller | Bands drawn in array order; later bands paint over earlier ones |
| **B52** `SemiGauge` needle + hub | `:281–282` | Line from `(100,100)` to `(100 + 63.96·cos θ, 100 − 63.96·sin θ)` — i.e. `r × 0.82`. `stroke HT.text · strokeWidth 2.5 · strokeLinecap round`. Hub `<circle r 4.5 fill HT.text>` | — | — |
| **B53** `SemiGauge` value text | `:283` | At `(100, 82)`, `textAnchor middle`, `fontSize 15`, `fontWeight 800`, `fill HT.text` | — | Whatever string `valueLabel` carries |
| **B54** `SemiGauge` caption | `:285` | `17px / 800 · letterSpacing .1em · uppercase · HT.text · opacity 0.7 · marginTop -6 · textAlign center` — the negative margin tucks it under the arc | — | — |
| **B55** Gauge — `"$Gamma"` | `value = d.dollarGamma`, `valueLabel = glFmtBn(d.dollarGamma)` (`:2007–2017`) | Scale is **auto-ranging**: `gammaSpan = Math.max(500_000_000, Math.abs(d.dollarGamma) * 1.4)` (`:1968`), `min = -gammaSpan`, `max = +gammaSpan`. Floor is 500 M; above that the needle can never exceed ≈71% of a half (1/1.4), so it never pins | Bands: `[-gammaSpan, 0]` → `HT.red`; `[0, +gammaSpan]` → `LIGHT_BLUE`. Two bands, boundary at exactly `0` | Not rendered when `d` is null (whole row is gated) |
| **B56** Gauge — `"CPG Ratio"` | `value = d.cpgRatio`, `valueLabel = glFmt2(d.cpgRatio)` (`:2018–2029`) | Fixed scale `min 0 · max 2`; a ratio above 2 clamps and pins the needle hard right | **Band ladder, in order:** `[0, 0.7)` → `HT.red` · `[0.7, 1.3)` → `LIGHT_BLUE` · `[1.3, 2]` → `HT.red`. Note the red is used for **both** extremes, so the colour alone cannot tell call-heavy from put-heavy | — |
| **B57** `"Expiry Filter"` label | Static (`:2031`) | `17px / 800 · letterSpacing .08em · uppercase · HT.text · opacity 0.6`; column wrapper `gap 4 · minWidth 170` | — | — |
| **B58** Expiry Filter control | `<ThemedSelect …>` (`:2032–2038`) | `value = snap?.expiry ?? ""`; `options = (snap?.expirations?.length ? snap.expirations : [snap?.expiry ?? ""]).filter(Boolean).map(e => ({value:e, label:e}))` — **raw `YYYY-MM-DD` strings, unformatted, in server order (not sorted here)**; `onChange = () => {}`; `disabled`; `placeholder = snap?.expiry ?? "—"` | `disabled` → trigger gets `opacity 0.5`, `cursor not-allowed`, and the click handler short-circuits. Trigger style: `padding 8px 12px · radius 8 · 14px / 700 · bg rgba(0,0,0,0.4) · 1px HT.border`; selected text `HT.cyan`, placeholder text `HT.muted` (`ThemedSelect.tsx:105–137`) | With no expirations and no expiry the option list is empty and the trigger shows the `"—"` placeholder |
| **B59** Refresh button | `useRefreshButton(load)` → `{trigger, label, style, state}` (`hooks/useRefreshButton.ts:5–34`; used at `:1908, 2040`) | `<button style={refreshStyle} onClick={trigger}>{label}</button>`. **Label ladder, by state:** `refreshing` → `"↻ Refreshing…"` · `success` → `"✓ Refreshed"` · `error` → `"✗ Failed"` · `idle` → `"↻ Now"`. Glyphs are U+21BB, U+2713, U+2717 and a single `…`. Style is `homeRefreshButtonStyle(state)` = `10px / 700 · padding 2px 10px · radius 2 · flexShrink 0 · transition all .15s` | Four states (`homeTheme.ts:294–318`): `idle` → border `rgba(33,158,188,.4)`, bg `rgba(33,158,188,.08)`, colour `HT.cyan` · `refreshing` → colour `#888`, `cursor not-allowed`, `opacity .6` · `success` → `REFRESH_GREEN #1FD98A` border/colour, bg at 10%, `textShadow 0 0 12px rgba(31,217,138,.5)` · `error` → `HT.red` border/colour, bg at 10%, `textShadow 0 0 12px rgba(239,68,68,.5)`. `success` is set on any resolve of `fn()`, `error` on any throw — `load()` rejects only on `!r.ok` or a network failure | **Re-entrancy lock:** `lockedRef` is set before the request and released **1800 ms after it settles**, so a second click is a no-op for the whole request plus 1800 ms. `finally` schedules `setTimeout(() => { setState("idle"); lockedRef.current = false }, 1800)` — **the timer is never cleared on unmount**, so switching tabs mid-refresh fires a `setState` on an unmounted component. `trigger` is `useCallback(…, [fn])` and `load` is `useCallback(…, [])`, so the identity is stable and the lock survives re-renders |
| **B60** Read-only footnote | Static (`:2043–2045`) | `"Single shared 0DTE feed — Stock/Expiry filters are read-only displays so this tab can't move the live feed everyone else is on."` (apostrophe is `&apos;`). `fontSize 14 · HT.text · opacity 0.45 · marginTop 12` | — | **Renders unconditionally** — it is a sibling of the `{d && …}` block, so it shows under the "waiting on /proxy/gex…" empty state too |

## B5 — Shared chart primitives
`GexLevelsTab.tsx:236–251, 290–470`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B61** `GlEmpty` | `:236–238` | `<div style={{padding:32, textAlign:"center", fontSize:14, color:HT.text, opacity:0.5}}>{note}</div>` | — | This is the single empty-state primitive for every panel below |
| **B62** `ChartLegend` | `:240–251` | Row: `flex · gap 16 · marginTop 10 · fontSize 14 · HT.text · opacity 0.75`. Each item: `flex · alignItems center · gap 6`, swatch `10×10 · borderRadius 2 · display inline-block · background = item.color`, then the label text | Swatch takes the caller's colour verbatim | Renders an empty row if handed `[]` (no caller does) |
| **B63** `useChartHover` | `:293–303` | `hover = {idx, x, y}` where `x = e.clientX − rect.left`, `y = e.clientY − rect.top` against the wrapping `position:relative` div. `hide()` sets `null` | — | `null` until the first `onMouseMove` on a mark |
| **B64** Stale-hover guard | `const hp = hover ? shown[hover.idx] : null` (`:512, 602, 676, 752, 813, 967, 1161`) | Present in **all seven** hover-capable charts. Zoom/pan/refresh rebuilds `shown` with fewer points while `hover.idx` still holds the old index | — | Tooltip is gated on `hover && hp`, so a stale index renders **nothing** rather than throwing `Cannot read properties of undefined (reading 'strike')` mid-render |
| **B65** `ChartTooltip` | `:383–407` | `position absolute · left x · top y · transform "translate(-50%, -100%) translateY(-10px)" · borderRadius 8 · padding "8px 12px" · fontSize 14 · lineHeight 1.5 · whiteSpace nowrap · pointerEvents none · zIndex 50` | `background: HT.panel` `#0D1119` — the **opaque** panel, not `panelBg`; `border: 1px solid HT.border`; `color HT.text`; `boxShadow 0 12px 28px rgba(0,0,0,0.45)` | Never clamped to the container, so it can overflow the card near the edges |
| **B66** `mergeRefs` | `:314–323` | Fans one DOM node out to both a ref object and a callback ref, so a chart div can carry `containerRef` (hover origin) and `wheelRef` (native wheel listener) at once | — | Skips null/undefined refs |
| **B67** `useChartPan` — window | `:325–331` | `winHalf = Math.max((spot * windowFrac) / zoom, 1)`. `windowFrac` default **0.06** (±6% of spot); `NetGammaByStrikeChart` passes **1** so its default window is wider than the whole chain and it shows every strike on first paint | Floor of 1 strike unit | — |
| **B68** `useChartPan` — wheel zoom | `:339–349` | Native `wheel` listener attached with `{passive:false}` (React's `onWheel` is passive and cannot `preventDefault`). `e.deltaY < 0 ? z*1.15 : z/1.15`, clamped `Math.min(8, Math.max(0.25, …))` | **Zoom ladder: min 0.25 · step ×1.15 or ÷1.15 per wheel notch · max 8** | Listener detached on unmount |
| **B69** `useChartPan` — drag pan | `:351–374` | `onDragStart(clientX, pxPerStrike)` stores `{startX, startPan, pxPerStrike}` in a **ref** (state is a tick too slow for the per-point hover check). `onDragMove`: `deltaStrikes = (clientX − startX) / pxPerStrike`, then `setPanOffset(clampPan(startPan − deltaStrikes))` | `clampPan`: `lo = minStrike + winHalf`, `hi = maxStrike − winHalf`; if `lo > hi` return `0` (chain narrower than the window, nothing to pan); else centre is clamped into `[lo,hi]` and the offset is `centre − spot` | `onDragEnd` clears the ref and `isDragging` |
| **B70** `useChartPan` — reset | `resetPan` (`:376`) | `setPanOffset(0); setZoom(1)` — bound to `onDoubleClick` on all four pannable charts | — | — |
| **B71** `useChartPan` — cursor | `:517, 607, 681, 757` | `cursor: canPan ? (isDragging ? "grabbing" : "grab") : "default"`; `userSelect: isDragging ? "none" : undefined` | `canPan = maxStrike − minStrike > winHalf * 2` (`:377`) | — |
| **B72** `glCumulativeByStrike` | `:414–421` | Sorts ascending, then a running `cum += glOiVolNet(r)` from the **lowest strike in the full chain** upward. Deliberately computed over the whole chain, not the visible window, so the zero crossing lands on the real flip | — | `[]` for an empty row set |
| **B73** `glSignSegments` | `:429–450` | Splits a cumulative curve into contiguous same-sign runs. `signOf(v) = v >= 0 ? 1 : -1` (**zero counts as positive**). At a sign change it inserts an interpolated crossing point: `frac = dv === 0 ? 0 : (0 - prev.cum)/dv`, `strike = prev.strike + (p.strike − prev.strike)·frac`, `cum = 0`; the crossing point ends the old segment and starts the new one | Final `.filter(s => s.pts.length > 1)` drops single-point runs | Returns `[]` when `pts.length < 2` |
| **B74** `GL_SIGN_COLOR(sign)` | `:457` | `sign > 0 ? GEX_POS_GREEN #22C55E : HOME_THEME.red #EF4444` | Boundary is the `>= 0` in `signOf` — a cumulative of exactly 0 paints **green** | — |
| **B75** `GEX_POS_GREEN` rationale | `:452–456` (comment) | `#22C55E`, declared locally. Comment: "deliberately NOT `HOME_THEME.green` — that token is `#8ECAE6`, a light blue, which would both fail to read as 'green' and collide with the `LIGHT_BLUE` spot line on this very chart. `#22C55E` matches `POS_GREEN` in `app/analytics/page.tsx`" | — | — |
| **B76** `glDownsampleCurve` | `:463–470` | `GL_CURVE_POINTS = 48`. If `pts.length <= 48` map all; else `step = (len-1)/47` and take `pts[Math.round(i*step)]` for `i` in `0..47`. Each point becomes `{k: Number(strike.toFixed(2)), c: Math.round(cum)}` | — | `[]` for an empty curve |

## B6 — Card layout: 12 cards, two columns, drag-and-drop
`GexLevelsTab.tsx:1695–1904, 2201–2226`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B77** Card key set | `ALL_CARD_KEYS` (`:1695–1699`) | Exactly 12, in declaration order: `"oiDate", "eodGex", "eodGexEx0dte", "history", "oiExpiry", "netGamma", "netGammaAll", "netGammaEx0dte", "callPutGamma", "netDelta", "netDeltaEx0dte", "volFlow"` | — | — |
| **B78** Default left column | `DEFAULT_LAYOUT.left` (`:1715`) | In order: `oiDate` → `eodGex` → `eodGexEx0dte` → `history`. The "daily / session history" stack | — | — |
| **B79** Default right column | `DEFAULT_LAYOUT.right` (`:1716`) | In order: `oiExpiry` → `netGamma` → `netGammaAll` → `netGammaEx0dte` → `callPutGamma` → `netDelta` → `netDeltaEx0dte` → `volFlow`. The "live chain" stack | — | — |
| **B80** Layout persistence | `localStorage["gexlevels-card-layout-v1"]` (`:1719`) | `JSON.stringify({left: CardKey[], right: CardKey[]})`. Written on every drop and on reset (`saveLayout`, `:1773–1775`), inside `try{}catch{}` | — | Write failure is swallowed silently — layout just does not persist |
| **B81** Legacy layout migration | `"gexlevels-card-order-left-v3"` / `"gexlevels-card-order-right-v3"` (`:1722–1723, 1759–1766`) | Read **only** when the v1 key is absent. Each is a bare `CardKey[]`; a missing side falls back to that side's default | — | Falls through to `normalizeLayout(DEFAULT_LAYOUT)` on any parse throw |
| **B82** `normalizeLayout` | `:1733–1753` | Three passes: drop non-`CardKey` values, drop duplicates (**first position wins**), then append every unseen key to the bottom of its **default** column. Guarantees all 12 cards render exactly once whatever localStorage holds | — | A brand-new card key added to `ALL_CARD_KEYS` lands at the bottom of its default column for existing users, without bumping the storage key |
| **B83** Hydration order | `useState(() => normalizeLayout(DEFAULT_LAYOUT))` then `useEffect(() => setLayout(readStoredLayout()), [])` (`:1790, 1793`) | First paint is always the DEFAULT order; the stored order swaps in after mount. Deliberate — `localStorage` is unavailable during SSR/prerender | — | A user with a custom layout sees one frame of the default arrangement on every mount |
| **B84** Drag handle glyph | `DragHandle` (`:1857–1870`) | `⠿` (U+283F, braille pattern dots-123456). `cursor grab · HT.text · opacity 0.4 · fontSize 17 · lineHeight 1 · padding "2px 6px" · userSelect none · flexShrink 0` | — | Always present in every card's title row |
| **B85** Drag handle tooltip | `title=` on the handle (`:1864`) | `"Drag to move — reorder within a column or drop into the other one"` | — | — |
| **B86** Handle isolates the gesture | `onMouseDown={e => e.stopPropagation()}` (`:1863`) | Only the small handle is `draggable`, not the card. Stops the card drag and `useChartPan`'s mousedown-drag from fighting over the same gesture | — | — |
| **B87** `CardTitleRow` | `:1872–1879` | `flex · alignItems center · justifyContent space-between · gap 8`; label in `<span style={{fontSize:17}}>` (again overriding the Card's 14px), handle on the right | — | — |
| **B88** Drag payload | `handleDragStart` (`:1811–1815`) | `e.dataTransfer.effectAllowed = "move"`, `setData("text/plain", id)`. Reads use `draggedKeyFrom(e, fallback)` (`:1779–1787`), which prefers the dataTransfer value over React state because it survives a mid-drag re-render | `isCardKey()` validates the string before it is used | Falls back to `draggingId` state if `getData` throws (some browsers throw outside a drop handler) |
| **B89** Drop onto another card | `cardDrop(col, id)` (`:1825–1832`) | `preventDefault` + **`stopPropagation`** so it wins over the column handler underneath. Places the dragged card at that card's index, in **that card's** column, pushing it and everything below down | No-op when `dragged === id` or `dragged` is null | — |
| **B90** Drop onto the column tail | `columnDrop(col)` (`:1840–1846`) | Appends to the bottom of that column (`place(dragged, col, null)`) | — | This is the **only** way to reach a column that has been emptied out |
| **B91** `place()` | `:1798–1809` | Filters the key out of BOTH columns first, then `splice(idx === -1 ? length : idx, 0, key)` into the target. One code path for same-column reorder and cross-column move | — | Persists via `saveLayout` inside the state updater |
| **B92** Dragged-card ghost | `:2212` | The wrapper div gets `opacity: draggingId === key ? 0.35 : 1`, `transition: "opacity .15s"` | Boundary is exact key equality | — |
| **B93** `ColumnDropZone` — `"Drop here"` | `:1884–1904`, mounted at `:2217` | `border 1px dashed HT.border · radius 10 · padding "14px 10px" · textAlign center · fontSize 14 · letterSpacing .04em · uppercase · fontWeight 800 · HT.text · transition opacity .15s` | `opacity: active ? 0.55 : 0.25`. **`active` is hardcoded `true` at the only call site**, so the 0.25 branch is unreachable | Mounted only while `cards.draggingId` is non-null — costs nothing at rest |
| **B94** Column container | `renderColumn` (`:2201–2219`) | `flex "1 1 480px" · minWidth 380 · minHeight 60 · display flex · flexDirection column · gap 20`. `onDragOver={columnDragOver}` + `onDrop={columnDrop(col)}` | `minHeight 60` is what keeps an emptied column droppable | — |
| **B95** Two-column wrapper | `:2222–2225` | `display flex · flexWrap wrap · gap 20 · alignItems flex-start`; left column then right column | At viewports under ~800px the `1 1 480px` basis wraps the two columns into one stack | **Rendered only when `d` is truthy** — see **B96** |
| **B96** Whole card grid gated on the 0DTE feed | `{d && (() => {…})()}` (`:2048`) | All 12 cards, including the four that have their own independent data sources (`oiDate`, `eodGex`, `eodGexEx0dte`, `history`), are hidden until `deriveGexLevels` returns non-null | Gate is `d != null`, which requires `rows.length > 0` **and** `spot > 0` | A `/proxy/gex` outage blanks the entire tab below the header card, even though `/api/eod-gex` and `/proxy/gex-levels-history` may be answering fine. Flagged in **Do not port** |
| **B97** Reset control | `cards.reset` (`:1848–1852`) | Restores `normalizeLayout(DEFAULT_LAYOUT)` and persists it | — | **Returned by `useCardLayout` and never wired to any button.** There is no visible way to reset the layout |

## B7 — Card 1 of 12: `"Open interest by date"` (`oiDate`)
`GexLevelsTab.tsx:800–850, 2053–2062`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B98** Card title | Static via `CardTitleRow` (`:2057`) | `"Open interest by date"` — `17px` span inside the Card's `800 / .12em / uppercase / HT.text` header | — | — |
| **B99** Card subtitle | Static (`:2058`) | `"Total call+put open interest in CONTRACTS (not gamma dollars — no γ, no spot² here), one bar per trading day logged"` — `12px · HT.green #8ECAE6` | — | — |
| **B100** Chart geometry | `OiByDateChart` (`:803`) | `W 720 · H 220 · padL 60 · padR 16 · padB 30 · padT 18`; `viewBox "0 0 720 220"`, `width 100%`, `preserveAspectRatio "xMidYMid meet"`, `display block`, `maxHeight 240` | — | — |
| **B101** Row source + sort | `history` state (`:2060`), sorted `(a,b) => a.date.localeCompare(b.date)` (`:806`) | **Date ASC** — oldest left. The `history` array itself arrives date DESC (see **B172**), so this chart re-sorts | — | `!rows.length` → `<GlEmpty note="Logging starts as soon as a level moves." />` |
| **B102** Bar value | `r.openInt` = `d.totalCallOI + d.totalPutOI` at record time (`:1936`) | Contracts, integer. `maxOi = Math.max(1, ...openInt)`; `barH(v) = (v/maxOi) * (y0 − padT)` where `y0 = H − padB = 190`; height floored at 1px | — | — |
| **B103** Bar geometry + colour | `:819–831` | `x(i) = n > 1 ? padL + (i/(n−1))·(W−padL−padR) : 382` (single-bar case is hard-centred); `barW = Math.max(4, ((W−padL−padR)/max(n,1)) · 0.5)` | `fill: LIGHT_BLUE #7dd3fc` unconditionally — **no sign colouring**, OI is never negative. `opacity: hovered ? 1 : 0.8`; `cursor: crosshair` | — |
| **B104** X tick labels | `:832–838` | Rendered when `n <= 8 \|\| i === 0 \|\| i === n−1 \|\| i === Math.floor(n/2)`. Text = `glFmtDate(r.date).replace(/, \d+$/, "")` → `"Aug 14"` (year stripped). `y = y0 + 16 = 206`, `textAnchor middle`, `fontSize 10`, `fill HT.text`, `opacity 0.55` | — | — |
| **B105** Y axis labels | `:839–840` | Two only: `glFmt0(maxOi)` at `(padL−8, padT+4)` and `"0"` at `(padL−8, y0+4)`, `textAnchor end`, `fontSize 10`, `opacity 0.55` | — | — |
| **B106** Zero baseline | `:818` | `line` from `padL` to `W−padR` at `y0`, `stroke HT.border`, `strokeWidth 1` | — | — |
| **B107** Tooltip | `:842–847` | Line 1 `glFmtDate(hp.date)` at `fontWeight 800` → `"Aug 14, 2026"`; line 2 `` `Total OI: ${glFmt0(hp.openInt)}` `` | — | Suppressed when `hp` is undefined (stale index) |
| **B108** No pan / zoom | `:816` | This chart takes only `containerRef` — **no `useChartPan`**, no wheel listener, no drag, no double-click reset | — | The card is fully static apart from hover |

## B8 — Cards 2 & 3: the two EOD GEX boards (`eodGex`, `eodGexEx0dte`)
`GexLevelsTab.tsx:1057–1246, 2063–2082`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B109** Card 2 title | `:2067` | `"SPX EOD GEX by session"` | — | — |
| **B110** Card 2 subtitle | Template literal (`:2068`) | `` `0DTE net GEX at the close on the OI+Vol basis — γ × (OI + volume) × spot², the same basis as the walls, the flip and $Gamma · last 30 sessions (eod_gex.total_gex_0dte, $SPX)` `` — `EOD_GEX_DAYS` = 30, `EOD_GEX_SYMBOL` = `"$SPX"` (`:1086–1087`) | — | — |
| **B111** Card 3 title | `:2077` | `"SPX EOD GEX (ex-0DTE) by session"` | — | — |
| **B112** Card 3 subtitle | Template literal (`:2078`) | `` `Net GEX at the close across all listed expirations except 0DTE, same OI+Vol basis as the card above · add the two for the whole-chain total · last 30 sessions (eod_gex.total_gex_ex0dte, $SPX)` `` | — | — |
| **B113** Fetch | `GET /api/eod-gex?symbol=%24SPX&limit=30` (`:1099`) | `cache: "no-store"`. `useEodGex(30)`; `useEffect(() => { void run(); }, [run])` and `run` is `useCallback(…, [days])` with `days` constant → **fires exactly once per mount, no poll** | `!res.ok` → `throw new Error(\`HTTP ${res.status}\`)` | `err` string rendered; `rows` keeps its previous value |
| **B114** Two independent fetches | Both cards mount their own `EodGexPanel`, each with its own `useEodGex` | `/api/eod-gex` is therefore requested **twice** on every mount, with identical params, and twice more on each Refresh click | — | No shared cache, no dedupe |
| **B115** Response parse | `:1102–1124` | `json.rows` (array or `[]`) → `{ date: String(o.date ?? "").slice(0,10), totalGex: Number(o.total_gex ?? 0) \|\| 0, totalGexEx0dte: o.total_gex_ex0dte == null ? null : (Number(…) \|\| 0), totalGex0dte: o.total_gex_0dte == null ? null : (Number(…) \|\| 0), spot: Number(o.spot ?? 0) \|\| 0 }` | `.filter(r => r.date)` then `.sort((a,b) => a.date.localeCompare(b.date))` — API returns newest-first, chart wants oldest→newest | `null` (not `0`) is preserved for the two OI+Vol columns so the chart can drop those sessions |
| **B116** Basis drop rule | `EodGexBarChart` (`:1145`) | `data = rows.filter(r => Number.isFinite(r[field]))` — a session with a `null` on this basis is **removed from the chart**, not plotted as zero | — | If every row is null: `GlEmpty` with `meta.empty` |
| **B117** Dropped-session disclosure | `EodGexPanel` (`:1216–1217, 1229–1231`) | `plottable = rows.filter(finite).length`, `dropped = rows.length − plottable`. Status line appends `` ` · ${dropped} without this basis, not shown` `` when `dropped > 0` | Boundary `> 0` | Comment at `:1213–1215`: "a silently short chart reads as 'the market was quiet', not as 'those rows have no value for this column yet'" |
| **B118** Status line — loaded | `:1226–1231` | `` `Loaded ${updatedLabel} ET · ${plottable} session${plottable === 1 ? "" : "s"} (${meta.note})` `` + optional dropped clause. `updatedLabel` = `Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit"})` on `loadedAt`. `fontSize 14 · HT.text · opacity 0.6` | Singular/plural on `plottable === 1` | `"Loading…"` while loading; `"—"` when `loadedAt` is null and not loading |
| **B119** `meta.note` — 0DTE | `EOD_GEX_FIELD_META.totalGex0dte.note` (`:1077`) | `"eod_gex.total_gex_0dte, OI+Vol"` | — | — |
| **B120** `meta.note` — ex-0DTE | `…totalGexEx0dte.note` (`:1082`) | `"eod_gex.total_gex_ex0dte, OI+Vol"` | — | — |
| **B121** `meta.label` — 0DTE | `:1075` | `"Net GEX (0DTE, OI+Vol)"` — used in the tooltip and both legend entries | — | — |
| **B122** `meta.label` — ex-0DTE | `:1081` | `"Net GEX (ex-0DTE, OI+Vol)"` | — | — |
| **B123** `meta.empty` — 0DTE | `:1076` | `"no 0DTE OI+Vol rows yet — run scripts/backfill-eod-gex-0dte.js"` | — | Shown by `GlEmpty` when nothing is plottable and there is no error |
| **B124** `meta.empty` — ex-0DTE | `:1080` | `"no ex-0DTE data yet"` | — | — |
| **B125** Refresh button | `:1233` | `homeButtonStyle` + `padding "4px 10px" · fontSize 14 · marginLeft "auto"`; label `"Refresh"` | Overrides `homeButtonStyle`'s 10px with 14px, so it is visually larger than a standard home button | Not disabled while loading — a rapid click fires overlapping requests |
| **B126** Error line | `:1235` | `` `EOD GEX error: ${err}` `` — `fontSize 14 · HT.red · marginBottom 8` | `HT.red` | Rendered above the chart; the chart still renders if `hasData` |
| **B127** Loading empty | `:1237` | `GlEmpty note={loading ? "loading eod_gex…" : meta.empty}` | — | Only when `!hasData && !err` |
| **B128** Chart geometry | `:1140` | `W 700 · H 240 · padL 52 · padR 12 · padB 34 · padT 16`; `plotH = 190`. `viewBox "0 0 700 240"`, `width 100%`, `preserveAspectRatio "xMidYMid meet"` — **no `maxHeight`** here, unlike the strike charts | — | — |
| **B129** Zero-line placement | `:1156–1159` | `hasNeg && hasPos` → `yZero = padT + plotH/2` (111) and `half = plotH/2` · only negatives → `yZero = padT` (16), `half = plotH` · only positives → `yZero = padT + plotH` (206), `half = plotH` | Comment: "so a sign flip is visible instead of being squashed against the axis" | — |
| **B130** Bar geometry + colour | `:1167–1185` | `cx = padL + slotW·(i+0.5)`, `slotW = (W−padL−padR)/n`, `barW = Math.max(3, slotW·0.6)`, `barH(v) = (|v|/maxAbs)·half` floored at 1px, `maxAbs = Math.max(1, ...|val|)` | `fill: v >= 0 ? LIGHT_BLUE #7dd3fc : HT.red #EF4444`. Boundary is `>= 0`, so exactly zero paints blue. `opacity: hovered ? 1 : 0.85`; `cursor crosshair` | — |
| **B131** X tick labels | `:1186–1192` | Rendered when `n <= 10 \|\| i % Math.ceil(n/10) === 0`. Text `glFmtExpiryLabel(r.date)` → `"8/14"`. `y = H − padB + 16 = 222`, `fontSize 9`, `opacity 0.55` | — | — |
| **B132** Y axis labels | `:1193–1197` | Top: `glFmtBn(hasPos ? maxAbs : 0)` at `(padL−6, padT+4)`. Middle: `"0"` at `(padL−6, yZero+4)`. Bottom: `glFmtBn(−maxAbs)` at `(padL−6, padT+plotH+4)` — **only when both signs are present** | `fontSize 9`, `textAnchor end`, `opacity 0.55` | An all-negative dataset prints its top label as `"0"` (from `hasPos ? maxAbs : 0`) and its zero label also as `"0"` |
| **B133** Tooltip | `:1199–1205` | Line 1 `glFmtDate(hp.date)` at `800` · line 2 `` `${meta.label}: ${glFmtBn(val(hp))}` `` · line 3 `` `SPX close: ${glFmt2(hp.spot)}` `` | — | Suppressed on stale index |
| **B134** Legend | `:1241` | Two items: `` `Positive · ${meta.label}` `` swatch `LIGHT_BLUE`, `` `Negative · ${meta.label}` `` swatch `HT.red` | — | Rendered only when `hasData` |
| **B135** No pan / zoom | `:1164` | `containerRef` only; hover via `onMouseLeave={hide}` on the `<svg>` and `onMouseMove` per bar | — | — |
| **B136** Dead third basis | `EOD_GEX_FIELD_META.totalGex` (`:1069–1073`) | Label `"Net GEX (legacy, mixed basis)"`, empty `"no eod_gex rows"`, note `"eod_gex.total_gex — basis varies by source, reference only"`. It is the **default** value of the `field` prop on both `EodGexPanel` and `EodGexBarChart` | **No call site passes it** — `:2070` passes `"totalGex0dte"`, `:2080` passes `"totalGexEx0dte"` | Unreachable. See **Do not port** |

## B9 — Card 4: `"History of key level changes"` (`history`)
`GexLevelsTab.tsx:1472–1668, 1917–1963, 2083–2092`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B137** Card title | `:2087` | `"History of key level changes"` | — | — |
| **B138** Card subtitle | `:2088` | `"One row per trading day — today updates live, prior days stay frozen"` | — | — |
| **B139** Card-level empty | `:2090` | `history.length === 0 ? <GlEmpty note="Logging starts as soon as a level moves." /> : <HistoryTable rows={history} />` | Boundary `=== 0` | Same string as `OiByDateChart`'s empty (**B101**) |
| **B140** localStorage cache | `GL_HISTORY_KEY = "gexlevels-daily-history-v1"` (`:1511`) | `loadGlHistory()` → `JSON.parse` or `[]` on any throw. `saveGlHistory(entries)` writes `entries.slice(0, GL_HISTORY_MAX_DAYS)` = **first 60 rows only** | Truncation applies to the **write only** — React state is not truncated, so server rows past day 60 still render | Quota/private-mode failure is swallowed; history just does not persist |
| **B141** Server history fetch | `GET /proxy/gex-levels-history?limit=3650` (`:1535`) | `cache: "no-store"`. Requires `j.ok === true` **and** `Array.isArray(j.rows)`, else `[]` | Any throw → `[]` ("server unreachable — localStorage fallback stands"). **No error is surfaced to the user** | Silent |
| **B142** Server row mapping | `:1550–1565` | snake_case → camel: `date`, `t`, `spot`, `resistance`, `support`, `neutral`, `dollar_gamma`→`dollarGamma`, `cpg_ratio`→`cpgRatio`, `r2`, `s2`, `open_int`→`openInt`, `curve`. `num(v) = (v == null \|\| v === "") ? null : Number(v)` for the five nullable level fields | `.filter(e => e.date && e.spot > 0)` — rows with no date or a non-positive spot are dropped | — |
| **B143** Curve parse | `parseCurve` (`:1541–1549`) | Accepts a JSONB array or a JSON string (`JSON.parse` in a try/catch). Maps to `{k: Number(p.k), c: Number(p.c)}`, filters non-finite | Returns the array only when `pts.length > 1`; otherwise `null` | `null` → the Curve cell renders `"—"` |
| **B144** Merge order | `mergeGlHistory(server, local)` (`:1573–1583`) | Server rows seed a `Map` by date; each local row overwrites **only if** `(e.t ?? 0) > (cur.t ?? 0)`. When a local row wins it keeps `curve: e.curve ?? cur?.curve ?? null` so a pre-curve local row cannot delete a curve the server has. Result sorted **date DESC** (`(a,b) => a.date < b.date ? 1 : -1`) | Freshest `t` wins per date | — |
| **B145** Mount sequence | `:1917–1926` | `setHistory(loadGlHistory())` synchronously (fast paint from cache), then `fetchServerGlHistory().then(server => { if (!alive \|\| !server.length) return; setHistory(local => mergeGlHistory(server, local)); })` | Server result is discarded entirely when it is empty — the cache is never cleared by an empty server response | `alive` flag guards the late `setState` |
| **B146** Today's row — creation | `:1928–1946` | On every `d` change: if no row for `todayEtDate()` exists, prepend `{date, t: Date.now(), spot, resistance, support, neutral, dollarGamma, cpgRatio, r2, s2, openInt: totalCallOI + totalPutOI, curve: glDownsampleCurve(glCumulativeByStrike(d.rows))}` | — | Prior days' rows are never touched once their date has passed |
| **B147** Today's row — **rewrite threshold ladder** | `:1948–1954` | `changed` is true when ANY of: `existing.resistance !== entry.resistance` · `existing.support !== entry.support` · `existing.neutral !== entry.neutral` · `Math.round(existing.dollarGamma / 1e6) !== Math.round(entry.dollarGamma / 1e6)` (i.e. a **1 M $Gamma** step) · `Math.abs(existing.cpgRatio − entry.cpgRatio) > 0.02` (strictly greater) | `if (!changed) return prev` — no write, no re-render | **`spot`, `r2`, `s2`, `openInt` and `curve` are not in the comparison.** Today's Price, R2, S2, Open Int and Curve cells therefore go stale until one of the five watched fields moves |
| **B148** Table container | `:1627` | `maxHeight 320 · overflow auto · borderRadius 10 · border 1px solid HT.border`. Inner `<table style={{width:"100%", borderCollapse:"collapse"}}>` | — | Scrolls internally; no sticky header |
| **B149** `th` style | `:1623` | `textAlign right · padding "6px 8px" · fontSize 17 · fontWeight 800 · letterSpacing .04em · uppercase · HT.text · opacity 0.6 · borderBottom 1px solid HT.border · whiteSpace nowrap` | — | **Header type (17px) is larger than body type (14px)** — same inversion as the stat tiles |
| **B150** `td` style | `:1624` | `textAlign right · padding "6px 8px" · fontSize 14 · fontFamily "var(--font-mono, monospace)" · HT.text · borderBottom 1px solid HT.border` | — | — |
| **B151** Sorting | — | **There is no sort UI.** No `onClick` on any `th`, no sort key, no direction indicator. Row order is whatever `history` state holds = date DESC from `mergeGlHistory`, with today prepended at index 0 by the live-update effect | — | — |

### B9a — `HistoryTable` columns, in render order (11 columns)
`GexLevelsTab.tsx:1630–1662`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B152** `"Date"` (col 1) | `r.date` | `glFmtDate(r.date)` → `"Aug 14, 2026"`. `th` and `td` both overridden to `textAlign: "left"` | No colour rule | Raw `ymd` if unparseable |
| **B153** `"Curve"` (col 2) | `r.curve` | `<GlCurveSpark curve={r.curve} neutral={r.neutral} />` inside a `flex · justifyContent center` div. `th` and `td` `textAlign: "center"`; `td` padding overridden to `"4px 8px"` | — | `curve` null or `< 2` points → `<span style={{opacity:0.35}}>—</span>` |
| **B154** `"Curve"` cell tooltip | `title=` on the inner div (`:1649`) | `"Cumulative gamma$ across all strikes as of this row's last update — dashed line = Neutral (gamma flip)"` | — | Present on every row, including the `"—"` ones |
| **B155** `"Price"` (col 3) | `r.spot` | `glFmt2(r.spot)` → 2 dp, no grouping | No colour rule | `"—"` from `glFmt2` if non-finite (cannot happen — `spot > 0` is a filter condition) |
| **B156** `"Resistance"` (col 4) | `r.resistance` | `r.resistance != null ? glFmt0(r.resistance) : "—"` | No colour rule — the header card paints Resistance `LIGHT_BLUE` but this column is plain `HT.text` | `"—"` |
| **B157** `"Support"` (col 5) | `r.support` | `r.support != null ? glFmt0(r.support) : "—"` | No colour rule — the header card paints Support `HT.red` here it is plain `HT.text` | `"—"` |
| **B158** `"Neutral"` (col 6) | `r.neutral` | `r.neutral != null ? glFmt0(r.neutral) : "—"` | No colour rule | `"—"` |
| **B159** `"$Gamma"` (col 7) | `r.dollarGamma` | `glFmtBn(r.dollarGamma)` → `"1.24bn"` / `"412.7M"` / `"9412"` | **No sign colouring** — a negative $Gamma reads as plain white text with a `-` | `"—"` if non-finite |
| **B160** `"CPG"` (col 8) | `r.cpgRatio` | `glFmt2(r.cpgRatio)` → `"0.86"` | No colour rule, despite the header gauge banding this value red/blue/red | `"—"` if non-finite |
| **B161** `"R2"` (col 9) | `r.r2` | `r.r2 != null ? glFmt0(r.r2) : "—"` | No colour rule | `"—"` |
| **B162** `"S2"` (col 10) | `r.s2` | `r.s2 != null ? glFmt0(r.s2) : "—"` | No colour rule | `"—"` |
| **B163** `"Open Int"` (col 11) | `r.openInt` | `glFmt0(r.openInt)` — contracts | No colour rule | `"—"` if non-finite; `0` renders as `"0"` |

### B9b — `GlCurveSpark`
`GexLevelsTab.tsx:1589–1620`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B164** Spark geometry | `:1590` | `W 104 · H 28 · padY 3`; `<svg viewBox="0 0 104 28" width={104} height={28} display block aria-hidden>` | — | — |
| **B165** Spark domain | `:1593–1599` | `x` maps `[curve[0].k, curve[last].k]` → `[0, 104]`; `y` maps `[min(0,…), max(0,…)]` → `[28−3, 3]`. `if (lo === hi) { lo -= 1; hi += 1 }` | Zero is always inside the domain because `Math.min(0, …)` / `Math.max(0, …)` | — |
| **B166** Spark baseline | `:1603` | Full-width line at `y(0)`, `stroke HT.border`, `strokeWidth 1` | — | — |
| **B167** Spark segments | `:1604–1614` | `glSignSegments(pts)`; per segment: filled path `${c}33` (20% alpha) closed down to `y0`, plus a stroked path `stroke c`, `strokeWidth 1.25` | `c = GL_SIGN_COLOR(seg.sign)` — `#22C55E` positive, `#EF4444` negative | — |
| **B168** Spark neutral marker | `:1615–1617` | Vertical line at `x(neutral)`, `stroke HT.text`, `strokeWidth 1`, `strokeDasharray "2 2"`, `opacity 0.45`, spanning the full 28px height | Drawn **only** when `neutral != null && neutral >= xlo && neutral <= xhi` — an off-domain flip is silently omitted | Omitted |

## B10 — Card 5: `"Open interest by expiration"` (`oiExpiry`)
`GexLevelsTab.tsx:852–1035, 2093–2102`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B169** Card title | `:2097` | `"Open interest by expiration"` | — | — |
| **B170** Card subtitle | `:2098` | `` `${snap?.symbol ?? "SPX"} · nearest 12 listed expirations` `` (`OI_EXPIRY_MAX` = 12, `:862`) | — | — |
| **B171** Inputs | `symbol={snap?.symbol ?? "SPX"}`, `expirations={snap?.expirations ?? []}` (`:2100`) | Both come from the `/proxy/gex` snapshot. **This is a request waterfall**: `/proxy/gex` must land before `/api/chains` can be called at all | — | Empty `expirations` → `run()` bails at `:914` and the card sits at `"no data yet"` forever |
| **B172** Cache | `localStorage["gexlevels-oi-by-expiry-v1:{symbol}"]` (`:863, 867–885`) | Value `{date: todayEtDate(), symbol, rows}`. Read is valid only when `parsed?.date` is truthy **and** `parsed?.symbol === symbol`; the effect additionally requires `cached.date === todayEtDate()` (`:917`) | Rationale (`:853–856`): OPRA OI is a once-daily value posted ~06:30 ET reflecting the prior close, so it does not ride the 15 s poll | Any throw → `null` → refetch |
| **B173** Fetch (per expiry) | `GET /api/chains?ticker={sym}&expiration={exp}&range=all` (`:888`) | Both params `encodeURIComponent`'d. **No `cache` option** — unlike every other fetch in this file, this one uses the default HTTP cache | `!res.ok` → `throw new Error(\`HTTP ${res.status}\`)` | That single expiry's promise rejects |
| **B174** Target selection | `:926` | `expirations.slice().sort().slice(0, 12)` — **lexicographic** sort of `YYYY-MM-DD` strings, which is also chronological for that format, then the first 12 | `OI_EXPIRY_MAX = 12` | — |
| **B175** Parallelism | `Promise.allSettled(targets.map(fetchOiTotalsForExpiry))` (`:927`) | Up to 12 concurrent requests, all fired at once | Only `status === "fulfilled"` entries are kept (`:930`); a rejected expiry is silently absent from the chart | `if (!next.length) throw new Error("no expirations resolved")` |
| **B176** OI summation | `fetchOiTotalsForExpiry` (`:891–904`) | Walks `json.data.items[]`; per group, `groupExp = String(g["expiration-date"] ?? "").slice(0,10)`; **skips the group when `groupExp` is truthy and `!== expiry.slice(0,10)`** (an empty `expiration-date` is therefore counted). Per strike: `parseInt(String(o["open-interest"] ?? o.openInterest ?? 0), 10) \|\| 0`, accumulated into `callOI` / `putOI` | — | Missing legs contribute 0 |
| **B177** Refetch trigger | `useEffect(() => { void run(false); }, [symbol, expirations.join(",")])` (`:943–946`) | Re-runs whenever the symbol or the comma-joined expiration list changes. `run(false)` consults the cache first; the Refresh button calls `run(true)` and skips it | ESLint `react-hooks/exhaustive-deps` disabled on this effect | — |
| **B178** Status line | `OiByExpirationPanel` (`:1019–1021`) | `loading ? "Loading…" : updatedLabel ? \`Loaded ${updatedLabel} ET · once/day (OPRA OI)\` : "—"` where `updatedLabel` is ET `hh:mm` from `loadedAt`. `fontSize 14 · HT.text · opacity 0.6` | — | `"—"` before the first load |
| **B179** Refresh button | `:1022` | `homeButtonStyle` + `padding "4px 10px" · fontSize 14 · marginLeft auto`; label `"Refresh"`; calls `run(true)` (bypasses the day cache) | — | Not disabled while loading |
| **B180** Error line | `:1024` | `` `OI-by-expiration error: ${err}` `` — `fontSize 14 · HT.red · marginBottom 8` | `HT.red` | — |
| **B181** Empty state | `:1025–1026` | `!rows.length && !err` → `GlEmpty note={loading ? "loading expirations…" : "no data yet"}` | — | — |
| **B182** Chart pair layout | `:1028–1031` | `display grid · gridTemplateColumns "1fr 1fr" · gap 12`. Left = `valueKey "callOI"`, `color LIGHT_BLUE`, `label "Call"`. Right = `valueKey "putOI"`, `color HT.red`, `label "Put"` | — | — |
| **B183** Mini-chart geometry | `OiByExpiryMiniChart` (`:958`) | `W 340 · H 190 · padL 40 · padR 10 · padB 32 · padT 20`; `viewBox "0 0 340 190"`, `width 100%`, `preserveAspectRatio "xMidYMid meet"`, `maxHeight 200` | — | `!rows.length` → `GlEmpty note="no expirations"` |
| **B184** Mini-chart heading | `:971` | The literal `"Call"` or `"Put"`, `fontSize 12 · fontWeight 800 · letterSpacing .1em · uppercase · textAlign center · marginBottom 2` | `color` = the chart's own colour (`LIGHT_BLUE` / `HT.red`) | — |
| **B185** Mini-chart bars | `:974–990` | `slotW = (W−padL−padR)/n = 290/n`; `cx = padL + slotW·(i+0.5)`; `barW = Math.max(3, slotW·0.55)`; `barH(v) = (v/maxV)·(y0−padT)` where `y0 = 158`, `maxV = Math.max(1, ...)`; height floored at 1 | `fill = color` unconditionally; `opacity: hovered ? 1 : 0.85`; `cursor crosshair` | — |
| **B186** Mini-chart X labels | `:991–997` | Rendered when `n <= 8 \|\| i % Math.ceil(n/8) === 0`. Text `glFmtExpiryLabel(r.expiry)` → `"8/14"`, `y = y0 + 14 = 172`, `fontSize 9`, `opacity 0.55` | — | — |
| **B187** Mini-chart Y labels | `:998–999` | `glFmtBn(maxV)` at `(padL−6, padT+4)` and `"0"` at `(padL−6, y0+4)`, `fontSize 9`, `textAnchor end`, `opacity 0.55` | **`glFmtBn` on a contract count** — an OI of 412,773 prints `"412773"` and one of 1,240,000 prints `"1.2M"`. Contracts, formatted with the dollar-magnitude helper | — |
| **B188** Mini-chart tooltip | `:1001–1006` | Line 1 `glFmtDate(hp.expiry)` at `800` → `"Aug 14, 2026"`; line 2 `` `${label} OI: ${glFmt0(hp[valueKey])}` `` → `"Call OI: 412,773"` | — | Suppressed on stale index |
| **B189** No pan / zoom | `:970` | `containerRef` only, `onMouseLeave={hide}` on the svg | — | — |

## B11 — Card 6: `"Net gamma exposure by strike (0DTE…)"` (`netGamma`)
`GexLevelsTab.tsx:472–570, 2103–2113`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B190** Card title | `:2107` | `` `Net gamma exposure by strike (0DTE${snap?.expiry ? ` · ${glFmtExpiryLabel(snap.expiry)}` : ""})` `` → `"Net gamma exposure by strike (0DTE · 9/2)"`, or `"…(0DTE)"` when the snapshot carries no expiry | — | — |
| **B191** Card subtitle | `:2108` | `"The live feed's SINGLE expiry. Cumulative across ALL its strikes — green above zero (dealers long gamma), red below (short gamma); crosses zero at the gamma flip (Neutral) · scroll to zoom, drag to pan, double-click to reset"` | — | — |
| **B192** Chart geometry | `:479` | `W 720 · H 220 · padL 54 · padR 16 · padB 26 · padT 18`; `viewBox "0 0 720 220"`, `width 100%`, `preserveAspectRatio "xMidYMid meet"`, `maxHeight 240` | — | `!rows.length` → `<GlEmpty note="no chain rows" />` |
| **B193** Default window | `useChartPan(rows, spot, 1)` (`:484`) | `windowFrac = 1` → `winHalf = spot`, wider than the whole listed chain, so **every strike is visible on first paint**. Scroll-zoom and drag still work from there | — | — |
| **B194** Visible slice | `:488–489` | `shown = cumAll.filter(p => p.strike >= center − winHalf && p.strike <= center + winHalf)`; **`if (shown.length <= 4) shown = cumAll`** — a window that would leave 4 or fewer points falls back to the whole curve | Boundary `<= 4` | — |
| **B195** Y domain | `:494–499` | `rawMin = Math.min(0, ...vals)`, `rawMax = Math.max(0, ...vals)`; `if (rawMin === rawMax) { rawMin -= 1; rawMax += 1 }`; then padded by **8% of the span on each side**: `minV = rawMin − span·0.08`, `maxV = rawMax + span·0.08` | Zero is always in domain | — |
| **B196** Zero baseline | `:525` | `padL → W−padR` at `y(0)`, `stroke HT.border`, `strokeWidth 1` | — | — |
| **B197** Sign-split area + line | `:526–537` | Per segment from `glSignSegments(shown)`: an area path `${lp} L x(last) y0 L x(first) y0 Z` filled `${c}33` (20% alpha), and the line path stroked `c` at `strokeWidth 2` | `c = GL_SIGN_COLOR(seg.sign)` — `#22C55E` for `cum >= 0`, `#EF4444` below. The colour flips at the **interpolated** crossing, not at the next listed strike | — |
| **B198** Neutral (flip) line | `:538–540` | Vertical dashed line at `x(neutral)`, `y padT → H−padB`, `stroke HT.text`, `strokeWidth 1`, `strokeDasharray "2 3"`, `opacity 0.55` | Drawn whenever `Number.isFinite(neutral)` — **no in-view check**, unlike `NetGammaBarsByStrikeChart` (**B209**) and `GlCurveSpark` (**B168**). A flip outside the visible window is drawn at a clamped/extrapolated x | Omitted when `neutral` is null/NaN |
| **B199** Spot line | `:541` | Vertical dashed line at `x(spot)`, `stroke LIGHT_BLUE`, `strokeWidth 1`, `strokeDasharray "2 3"`, `opacity 0.6` | — | Always drawn |
| **B200** Hover hit targets | `:542–552` | One `<circle>` per visible point: `r = hover?.idx === i ? 4 : 7` — the **hovered** dot is drawn *smaller*; `fill = hovered ? GL_SIGN_COLOR(cum >= 0 ? 1 : -1) : "transparent"`; `cursor: "inherit"`; `onMouseMove` fires `show(i, e)` **only when `!pan.draggingRef.current`** | Sign boundary `cum >= 0` → green | Transparent when not hovered — the dots are invisible hit targets |
| **B201** Y axis labels | `:553–555` | Three: `glFmtBn(rawMin)`, `glFmtBn(0)` (prints `"0"`), `glFmtBn(rawMax)` — positioned at their own `y(v)+4`, `x = padL − 8`, `textAnchor end`, `fontSize 10`, `opacity 0.55`. Note these label `rawMin`/`rawMax`, **not** the padded `minV`/`maxV` | — | — |
| **B202** X axis labels | `:556–558` | Three: `glFmt0(xlo)`, `glFmt0((xlo+xhi)/2)`, `glFmt0(xhi)` at `y = H − padB + 16 = 210`, `textAnchor middle`, `fontSize 10`, `opacity 0.55` | — | — |
| **B203** Tooltip | `:560–567` | Line 1 `` `Strike ${glFmt2(hp.strike)}` `` at `fontWeight 800`; line 2 `` `Cumulative Gamma$: ${glFmtBn(hp.cum)}` `` at `fontWeight 700`, coloured `GL_SIGN_COLOR(hp.cum >= 0 ? 1 : -1)` | Gated `hover && hp && !pan.isDragging` — the tooltip is suppressed for the whole duration of a drag | — |
| **B204** Interaction handlers | `:516–522` | `onMouseDown` → `e.preventDefault()` + `onDragStart(clientX, pxPerStrike)` · `onMouseMove` → `onDragMove(clientX)` · `onMouseUp` → `onDragEnd` · `onMouseLeave` → `onDragEnd()` **and** `hide()` · `onDoubleClick` → `resetPan` · native `wheel` (non-passive) → zoom | — | — |
| **B205** Legend | `:2111` | Three items: `"Positive gamma$"` `GEX_POS_GREEN`, `"Negative gamma$"` `HT.red`, `"Spot"` `LIGHT_BLUE` | — | Always rendered under the chart (not gated on rows) |

## B12 — Cards 7 & 8: multi-expiry net gamma (`netGammaAll`, `netGammaEx0dte`)
`GexLevelsTab.tsx:572–653, 1248–1418, 2114–2147`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B206** Card 7 title | `:2118` | `"Net gamma exposure by strike (all expirations)"` | — | — |
| **B207** Card 7 subtitle | `:2119` | `"Every listed expiration combined, 0DTE included — gamma$ per strike, green above zero / red below · OI+Vol basis · scroll to zoom, drag to pan, double-click to reset · refreshed once a minute"` | — | — |
| **B208** Card 8 title | `:2135` | `"Net gamma exposure by strike (ex-0DTE)"` | — | — |
| **B209** Card 8 subtitle | `:2136` | `"Same board with the 0DTE expiry removed — gamma$ per strike, what's left standing after today expires · OI+Vol basis · scroll to zoom, drag to pan · refreshed once a minute"` (note: no "double-click to reset" on this one, though the behaviour is identical) | — | — |
| **B210** Fetch | `GET /proxy/gex-by-strike-multi?symbol=%24SPX` (`:1326`) | `cache: "no-store"`. Symbol is `EOD_GEX_SYMBOL` = `"$SPX"` (`:1915`), **not** `snap.symbol` — so this ladder is hardcoded to SPX while the header card follows the shared feed | — | One shared `useGexByStrikeMulti` at the tab level feeds all three multi cards |
| **B211** Poll interval | `GEX_MULTI_POLL_MS = 60_000` (`:1280, 1363`) | **60 s**, first tick immediate. Comment: server-side cached ~60 s because the sweep is one upstream fetch per expiration | — | `alive` flag + `clearInterval`; no abort |
| **B212** Content-type guard | `:1332–1339` | Before `res.json()`: if the content-type does not include `application/json`, throw. Message is `"endpoint /proxy/gex-by-strike-multi not found — server-v2 needs a restart/redeploy to pick up the route"` when `res.status === 404` or the type includes `text/html`, otherwise `` `unexpected ${ct \|\| "empty"} response (HTTP ${res.status})` `` | Exists because an un-redeployed server-v2 falls through to Next's HTML 404 and `res.json()` then throws `Unexpected token '<'`, which reads like a data bug | — |
| **B213** Payload parse | `:1342–1350` | `{spot: Number(json.spot ?? 0), sessionDate: String(json.sessionDate ?? ""), expiryCount: Number(json.expiryCount ?? 0), all: parseMultiLadder(json.all), ex0dte: parseMultiLadder(json.ex0dte), updatedAt: Number(json.updatedAt ?? Date.now()), cached: !!json.cached}` | `!res.ok \|\| json?.ok === false` → throw `String(json?.error \|\| \`HTTP ${res.status}\`)` | `sessionDate`, `updatedAt` and `cached` are parsed and **never rendered anywhere** |
| **B214** Ladder parse | `parseMultiLadder` (`:1303–1316`) | `rows = json.rows.map(multiRow).filter(r => Number.isFinite(r.strike) && r.strike > 0)`. `totalNetGex`, `gexFlip`, `callWall`, `putWall` each `== null ? null : Number(v)` | `strike > 0` is strict | Missing `callWall`/`putWall` (a server-v2 that predates the change) parse as `null` |
| **B215** `multiRow` | `:1290–1301` | The endpoint ships slim rows `{strike, netGEX, netVolGEX, netDEX, volNetDEX}`. `multiRow` zero-fills `callOI, putOI, callVolume, putVolume, callGEX, putGEX` so the shared chart components stay untouched | — | **A consequence: `CallPutGammaByStrikeChart` would draw nothing for these ladders** — it is never pointed at them, but the shape is silently lossy |
| **B216** Header status line | `NetGammaMultiPanel` (`:1385–1404`) | `loading && !ladder ? "Loading…"` : with a ladder, `[scopeNote, \`total ${glFmtBn(totalNetGex)}\`, \`flip ${gexFlip != null ? glFmt0(gexFlip) : "—"}\`, wallsClause].filter(Boolean).join(" · ")` : `"—"`. `fontSize 14 · HT.text · opacity 0.6` | — | — |
| **B217** Walls clause | `:1399–1401` | Included **only** when `ladder.callWall != null \|\| ladder.putWall != null`; then `` `res ${callWall != null ? glFmt0(callWall) : "—"} · sup ${putWall != null ? glFmt0(putWall) : "—"}` `` | Comment (`:1394–1398`): dropped entirely rather than printed as `"—"` when the server predates the change, "so a stale deploy reads as 'this build has no walls' instead of 'there are no walls'". These are **this ladder's own** walls, not `/proxy/gex`'s | Whole clause absent |
| **B218** `scopeNote` — all | `:2127` | `` `${multi.data?.expiryCount ?? 0} expirations` `` → `"14 expirations"` | — | `"0 expirations"` before the first payload |
| **B219** `scopeNote` — ex-0DTE | `:2144` | `` `${Math.max(0, (multi.data?.expiryCount ?? 0) - 1)} expirations, 0DTE excluded` `` — the count is derived by subtracting one, floored at 0, not reported by the server | — | `"0 expirations, 0DTE excluded"` |
| **B220** Refresh button | `:1405` | `homeButtonStyle` + `padding "4px 10px" · fontSize 14 · marginLeft auto`; label `"Refresh"`; calls the **shared** `multi.refresh` | All three multi cards' Refresh buttons hit the same request | — |
| **B221** Error line | `:1407` | `` `Multi-expiry GEX error: ${err}` `` — `fontSize 14 · HT.red · marginBottom 8` | `HT.red` | The same `err` string is shown by **all three** multi cards simultaneously |
| **B222** Empty ladder | `:1408–1409` | `!ladder \|\| !ladder.rows.length` → `GlEmpty note={loading ? "sweeping the board…" : err ? "no ladder available" : "no strikes returned"}` | Three-way ternary, in that precedence | — |
| **B223** Bars chart geometry | `NetGammaBarsByStrikeChart` (`:585`) | `W 720 · H 220 · padL 56 · padR 16 · padB 26 · padT 18`; `maxHeight 240` | — | `!rows.length` → `GlEmpty "no chain rows"` |
| **B224** Bars chart window | `useChartPan(rows, spot)` (`:587`) | Default `windowFrac 0.06` → `winHalf = max(spot·0.06/zoom, 1)`; at SPX 6400 that is ±384 points on first paint. `if (shown.length <= 4) shown = sortedAll` | — | — |
| **B225** Bar geometry + colour | `:616–633` | `barW = Math.max(2, ((W−padL−padR)/shown.length) · 0.62)`; `top = v >= 0 ? y(v) : y0`; `h = Math.max(1, |y(v) − y0|)`; value is `glOiVolNet(r)` | `fill: v >= 0 ? GEX_POS_GREEN #22C55E : HT.red #EF4444`. `opacity: hovered ? 1 : 0.85`. `onMouseMove` guarded by `!pan.draggingRef.current` | — |
| **B226** Bars Y domain | `:596–597` | `minV = Math.min(0, ...vals)`, `maxV = Math.max(0, ...vals)`; `if (minV === maxV) { minV -= 1; maxV += 1 }`. **No 8% padding** here, unlike the cumulative chart (**B195**) | — | — |
| **B227** Bars flip line | `:601, 634–636` | `flipInView = neutral != null && neutral >= xlo && neutral <= xhi`; when true, a vertical line at `x(neutral)` with `stroke GEX_POS_GREEN`, `strokeWidth 1`, `strokeDasharray "4 3"`, `opacity 0.55` | **Green, and dashed `"4 3"`** — different colour AND different dash pattern from the cumulative chart's white `"2 3"` flip line (**B198**). Same semantic, two treatments | Omitted when out of view |
| **B228** Bars spot line | `:637` | `x(spot)`, `stroke LIGHT_BLUE`, `strokeWidth 1`, `strokeDasharray "2 3"`, **`opacity 0.75`** | Same colour as **B199** but a different opacity (0.75 vs 0.6) | — |
| **B229** Bars axis labels | `:638–643` | Y: `glFmtBn` of `[minV, 0, maxV]` at `padL−8`, `fontSize 10`, `opacity 0.55`. X: `glFmt0` of `[xlo, mid, xhi]` at `y = 210`, `fontSize 10`, `opacity 0.55` | — | — |
| **B230** Bars tooltip | `:645–650` | Line 1 `` `Strike ${glFmt2(hp.strike)}` `` at `800`; line 2 `` `Net gamma$: ${glFmtBn(glOiVolNet(hp))}` `` — plain `HT.text`, **not sign-coloured** (unlike the cumulative chart's line 2) | Gated `hover && hp && !pan.isDragging` | — |
| **B231** Multi legend | `:1413` | **Four** items: `"Positive gamma$"` `GEX_POS_GREEN` · `"Negative gamma$"` `HT.red` · `"Spot"` `LIGHT_BLUE` · `"Flip"` `GEX_POS_GREEN` | **"Positive gamma$" and "Flip" are the same swatch colour** — the legend cannot distinguish them | Rendered only when the ladder has rows |

## B13 — Card 9: `"Call/put gamma exposure by strike"` (`callPutGamma`)
`GexLevelsTab.tsx:729–798, 2148–2158`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B232** Card title | `:2152` | `"Call/put gamma exposure by strike"` | — | — |
| **B233** Card subtitle | `:2153` | `"Click-drag to pan, double-click to reset"` — the **shortest subtitle on the tab**; it does not mention scroll-to-zoom even though the wheel handler is attached | — | — |
| **B234** Chart geometry | `:734` | `W 720 · H 220 · padL 54 · padR 16 · padB 26 · padT 18`; `maxHeight 240`. `useChartPan(rows, spot)` → default `windowFrac 0.06` | — | `!rows.length` → `GlEmpty "no chain rows"` |
| **B235** Y domain | `:744–747` | `minV = Math.min(0, ...putVals)`, `maxV = Math.max(0, ...callVals)` — the two legs get **separate** extremes: puts define the floor, calls the ceiling. `if (minV === maxV) { minV -= 1; maxV += 1 }` | Because raw `putGEX` is negative and raw `callGEX` positive, calls land above zero and puts below without being netted | — |
| **B236** Paired bar geometry | `:750–751, 766–779` | `slotW = (W−padL−padR)/shown.length`; `barW = Math.max(1.5, slotW·0.34)`. Call bar `x = x(strike) − barW − 0.5`; put bar `x = x(strike) + 0.5` — a 1px gutter centred on the strike | — | — |
| **B237** Call bar | `:776` | Height `Math.max(1, |y(callGEX) − y0|)`, top `cv >= 0 ? y(cv) : y0`. `fill LIGHT_BLUE #7dd3fc`, `opacity hovered ? 1 : 0.85`, `cursor inherit` | Boundary `>= 0` | Missing `callGEX` → `0` → 1px stub at the axis |
| **B238** Put bar | `:777` | Height `Math.max(1, |y(putGEX) − y0|)`, top `pv >= 0 ? y(pv) : y0`. `fill HT.red #EF4444`, same opacity rule | — | — |
| **B239** Spot line | `:781` | `x(spot)`, `stroke HOME_THEME.text` (**white**, not `LIGHT_BLUE`), `strokeWidth 1`, `strokeDasharray "2 3"`, `opacity 0.6` | Third spot-line treatment on the tab. See **Colours used** | — |
| **B240** Flip line | — | **There is none.** This chart takes no `neutral` prop at all | — | — |
| **B241** Axis labels | `:782–787` | Y: `glFmtBn` of `[minV, 0, maxV]` at `padL−8`, `fontSize 10`, `opacity 0.55`. X: `glFmt0` of `[xlo, mid, xhi]` at `y = 210` | — | — |
| **B242** Tooltip | `:789–795` | Line 1 `` `Strike ${glFmt2(hp.strike)}` `` at `800`; line 2 `` `CallGEX: ${glFmtBn(hp.callGEX)}` ``; line 3 `` `PutGEX: ${glFmtBn(hp.putGEX)}` `` — neither leg is colour-coded in the tooltip | Gated `hover && hp && !pan.isDragging` | — |
| **B243** Legend | `:2156` | Two items: `"CallGEX"` `LIGHT_BLUE` · `"PutGEX"` `HT.red` | — | — |

## B14 — Card 10: `"Net delta exposure by strike (0DTE…)"` (`netDelta`)
`GexLevelsTab.tsx:655–727, 2159–2169`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B244** Card title | `:2163` | `` `Net delta exposure by strike (0DTE${snap?.expiry ? ` · ${glFmtExpiryLabel(snap.expiry)}` : ""})` `` → `"Net delta exposure by strike (0DTE · 9/2)"` | — | — |
| **B245** Card subtitle | `:2164` | `"The live feed's SINGLE expiry — delta$ per strike on the OI leg only · click-drag to pan, double-click to reset"` | — | — |
| **B246** Basis | `basis="oi"` (`:2166`) | `glDexOf(r,"oi")` = `r.netDEX ?? 0` — the **OI leg only**, deliberately different from every gamma ladder on the tab | Comment (`:127–133`): "Kept as one accessor so the two net-delta cards can never silently drift onto different bases again" | — |
| **B247** Chart geometry | `:660` | `W 720 · H 220 · padL 50 · padR 16 · padB 26 · padT 18`; `maxHeight 240`. `useChartPan(rows, spot)` → `windowFrac 0.06` | — | `!rows.length` → `GlEmpty "no chain rows"` |
| **B248** Bars | `:690–707` | `barW = Math.max(2, slot·0.62)`; `top = v >= 0 ? y(v) : y0`; `h = Math.max(1, |y(v) − y0|)` | `fill: v >= 0 ? LIGHT_BLUE #7dd3fc : HT.red #EF4444` — **positive is blue here, green on the gamma bars**. `opacity hovered ? 1 : 0.85` | — |
| **B249** Spot line | `:708` | `x(spot)`, `stroke HOME_THEME.text` (white), `strokeDasharray "2 3"`, `opacity 0.6` | — | — |
| **B250** Y axis labels | `:709–711` | `[minV, 0, maxV]` formatted with **`glFmt0`, not `glFmtBn`** — the only chart on the tab that does. A delta of 412,773,000 prints as `"412,773,000"` where every other axis would print `"412.8M"` | `fontSize 10`, `textAnchor end`, `opacity 0.55` | — |
| **B251** X axis labels | `:712–714` | `glFmt0` of `[xlo, mid, xhi]` at `y = 210`, `fontSize 10`, `opacity 0.55` | — | — |
| **B252** Tooltip | `:716–723` | Line 1 `` `Strike ${glFmt2(hp.strike)}` `` at `800`; line 2 `` `Net Delta: ${glFmt0(glDexOf(hp, basis))}` ``; line 3 **only when `basis === "oivol"`**: `` `OI ${glFmt0(hp.netDEX ?? 0)} · Vol ${glFmt0(hp.volNetDEX ?? 0)}` `` at `opacity 0.6` | On this card `basis` is `"oi"`, so line 3 never renders here | Gated `hover && hp && !pan.isDragging` |
| **B253** Legend | `:2167` | Two items: `"Positive"` `LIGHT_BLUE` · `"Negative"` `HT.red` — the bare words, without the `delta$` suffix the ex-0DTE card's legend uses (**B258**) | — | — |

## B15 — Card 11: `"Net delta exposure by strike (ex-0DTE)"` (`netDeltaEx0dte`)
`GexLevelsTab.tsx:1420–1470, 2170–2186`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B254** Card title | `:2174` | `"Net delta exposure by strike (ex-0DTE)"` | — | — |
| **B255** Card subtitle | `:2175` | `"Every listed expiration EXCEPT 0DTE — delta$ per strike on the OI+Vol basis, so it matches the gamma ladders above rather than the 0DTE delta card · hover a bar to split the two legs · scroll to zoom, drag to pan · refreshed once a minute"` | — | — |
| **B256** Header total | `NetDeltaMultiPanel` (`:1437–1440, 1452`) | `` `${scopeNote} · total ${glFmtBn(totalDex)}` `` where `totalDex = useMemo(() => rows.reduce((a,r) => a + glDexOf(r,"oivol"), 0), [ladder])`. Summed **client-side on purpose** — the payload's `totalNetGex` is a gamma total and there is no server-side delta total to borrow (`:1424–1426`) | — | `loading && !ladder ? "Loading…"`, else `"—"` |
| **B257** All-zero guard | `:1443, 1460–1461` | `allZero = !!ladder?.rows.length && ladder.rows.every(r => glDexOf(r,"oivol") === 0)` | When true, renders `GlEmpty note="net delta is zero at every strike — server-v2 is likely running a build before /proxy/gex-by-strike-multi shipped netDEX; redeploy it"` **instead of** the chart | Comment: "Say so instead of drawing a convincing flat line" |
| **B258** Legend | `:1465` | Three items: `"Positive delta$"` `LIGHT_BLUE` · `"Negative delta$"` `HT.red` · `"Spot"` `HOME_THEME.text` | The only legend on the tab whose Spot swatch is white, matching this chart's white spot line | Rendered when the ladder has rows and is not all-zero |
| **B259** Error line | `:1457` | `` `Multi-expiry DEX error: ${err}` `` — `fontSize 14 · HT.red · marginBottom 8`. Note the wording differs from the gamma panels' `"Multi-expiry GEX error: …"` (**B221**) even though it is the **same** `err` from the same shared hook | `HT.red` | — |
| **B260** Empty ladder | `:1458–1459` | Identical three-way ternary to **B222**: `loading ? "sweeping the board…" : err ? "no ladder available" : "no strikes returned"` | — | — |
| **B261** Split-legs tooltip line | `:720–722` (reached only from this card) | `` `OI ${glFmt0(hp.netDEX ?? 0)} · Vol ${glFmt0(hp.volNetDEX ?? 0)}` `` at `opacity 0.6`, rendered under the `Net Delta:` line | Only when `basis === "oivol"` | Both legs print `"0"` on a stale server |
| **B262** Refresh button | `:1455` | `homeButtonStyle` + `padding "4px 10px" · fontSize 14 · marginLeft auto`; label `"Refresh"`; shared `multi.refresh` | — | — |

## B16 — Card 12: `"Net vol GEX flow (today)"` (`volFlow`)
`GexLevelsTab.tsx:2187–2198` · `components/dashboard/VolGexFlowPanel.tsx:1–612`

`C` = `HOME_THEME` inside `VolGexFlowPanel` (`:33`). The panel declares three
role aliases at `:37–38, 80`: **`POS = C.green` `#8ECAE6`** (the light blue),
**`NEG = C.red` `#EF4444`**, **`PCT = C.orange` `#FB8501`**.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B263** Card title | `:2191` | `"Net vol GEX flow (today)"` | — | — |
| **B264** Card subtitle | `:2192` | `"Intraday path of the volume leg, 5m buckets from option_strike_gex_history · pick an expiration or track the front · above zero = flow adding long gamma (dampening), below = short gamma (amplifying)"` | — | **The subtitle says "5m buckets" and the code sends `bin=30` (30-second buckets).** `BIN_SEC = 30` (`VolGexFlowPanel.tsx:51`) and the panel's own header prints `"30s buckets · today ET"`. The card subtitle is stale; the code wins |
| **B265** Body | `<div style={{height:460}}><VolGexFlowPanel /></div>` (`:2194–2196`) | Fixed 460 px wrapper. `VolGexFlowPanel` takes **no props** — it owns its own picker, session switch, view switch, fetch and poll. Panel root: `flex column · height 100% · minHeight 0 · gap 8 · padding 14 · overflow auto` (`:461`) | — | The panel is shared with `app/home/HomeClient.tsx`'s "Vol GEX Flow" tab (`:5–7`); nothing here is scanner-specific |
| **B266** Only time-series card | Comment `:1711–1713` | Every other card on the tab is by-strike or by-session; this is the one intraday time series. "It answers 'how did today's vol GEX get to the level the boards above are showing', which a strike ladder structurally cannot" | — | — |

### B16a — VolGexFlowPanel data layer
`VolGexFlowPanel.tsx:42–59, 83–109, 180–214`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B275** Fetch | `GET /proxy/gex-vol-flow?bin={BIN_SEC}&session={session}&{scopeClause}` (`:184`) | `cache: "no-store"`. Server buckets `option_strike_gex_history` — last reading per `(expiry, strike)` per bucket, summed (`:9–12`) | — | **This is fetch 6 on the tab**, not counted in **B267**–**B271** |
| **B276** `bin` param | `BIN_SEC = 30` (`:51`) | Always `bin=30`. Comment: 30 s "is the floor the endpoint enforces, and it matches the recorder's 30 s write cadence (`gex-history-writer.js`)". `BIN_LABEL = BIN_SEC < 60 ? \`${BIN_SEC}s\` : \`${BIN_SEC/60}m\`` (`:54`) → `"30s"` | Comment `:46–50`: going 1:1 with the recorder is only safe because the recorder writes on a fixed 30 s grid slot; under the older drifting throttle this pairing produced "the shark tooth" — buckets that caught two writes threw one away, neighbours that caught none dropped a point | Not user-adjustable; there is no bucket-size control |
| **B277** `session` param | `session` state, default `"rth"` (`:146`) | `session=rth` or `session=eth` | Default is RTH because "the overnight stretch has no new prints — values persist until the chain resets, which draws a long flat line and a phantom step that read as signal but aren't" (`:476–478`) | Changing it sets `loading` true and refetches |
| **B278** Scope clause | `:181–182` | `pick === ALL ? "scope=all" : pick === FRONT ? "scope=front" : \`expiry=${encodeURIComponent(pick)}\``. Sentinels are `FRONT = "__front__"` and `ALL = "__all__"` (`:58–59`) — chosen because "real picks are ISO expiry strings, which can never collide with these because neither parses as a date" | — | Default `pick` is `FRONT` |
| **B279** Poll + wake | `POLL_MS = 15_000` (`:42, 208`) | **15 s**, immediate first tick. Comment: "Half the bucket width, so a newly written bucket is on screen within one poll rather than up to a full bucket late." Additionally a `visibilitychange` listener fires an immediate tick when `document.visibilityState === "visible"` (`:211–212`) | — | `alive` flag, `clearInterval` and listener removal on unmount. **No `AbortController`** |
| **B280** Response shape | `VolFlowResponse` (`:100–109`) | `{ok?, reason?, scope?, session?, expiry?, binSec?, expiries?: ExpiryInfo[], points?: VolFlowPoint[]}`. `ExpiryInfo = {expiry, rows, lastTs}` (`:98`) | — | `scope`, `session` and `binSec` are declared on the type and **never read** |
| **B281** Server-side error | `:186–188` | `j?.ok === false` → `setErr(j.reason === "no-db" ? "History DB unavailable" : "Feed unavailable")` and `setPoints([])` | Two-branch ladder on `reason === "no-db"`; every other reason collapses to `"Feed unavailable"` | Points are **cleared**, so the chart empties |
| **B282** Network / parse error | `:196–197` | `catch` → `setErr(String((e as Error)?.message \|\| e))` — the raw message, unmapped | — | **Points are NOT cleared on this path**, so a transient network failure leaves the last good series on screen under the error scrim |
| **B283** `loading` lifecycle | `:151, 199, 206` | Initialised `true`. Set `true` at the top of the poll effect (so on every `pick` / `session` change), cleared in `finally`. **Not** set true by the 15 s tick itself | — | First paint is the loading scrim |
| **B284** `VolFlowPoint` | `:83–96` | `{ts, spot, volGex, oiGex, combined, dVol, strikes, posGex?, absGex?, posPct?}`. `ts` is ms; `posPct` is 0–100, `null` on a bucket with no rows | — | **`oiGex`, `combined`, `posGex` and `absGex` are declared and never read** — only `ts`, `spot`, `volGex`, `dVol`, `strikes` and `posPct` reach the UI |
| **B285** `pctPoints` | `:168–171` | `points.filter(p => p.posPct != null && Number.isFinite(p.posPct))` | — | The % view covers a **different bucket set** from the $ view: "a bucket with rows but no gamma at all has a volGex and no posPct" (`:249–250`) |

### B16b — VolGexFlowPanel header controls
`VolGexFlowPanel.tsx:216–225, 460–553`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B286** Header row | `:464` | `flex · alignItems center · gap 10 · flexShrink 0 · flexWrap wrap · position relative · zIndex: menuOpen ? 30 : 1` | The `zIndex` lift is driven by `ThemedSelect`'s `onOpenChange` so the portal'd menu sits above the chart canvas | — |
| **B287** Panel title | `:465–467` | `pctView ? "+GEX % of Chain" : "Net Vol GEX Flow"` — `12px / 800 · letterSpacing .1em · uppercase · C.text` | Swaps with the view switch | — |
| **B288** Expiry picker | `<ThemedSelect value={pick} options={expiryOptions} onChange={setPick} onOpenChange={setMenuOpen} width={190} ariaLabel="Expiration" />` (`:468–475`) | **Live and enabled** — unlike the tab's own Expiry Filter (**B58**), which is permanently `disabled`. Two functioning dropdowns of the same component on one screen, one of which does nothing | Trigger `padding 8px 12px · radius 8 · 14px / 700 · bg rgba(0,0,0,0.4) · 1px C.border`; selected label inks `C.cyan` | Changing it sets `loading` and refetches |
| **B289** Picker options, in order | `expiryOptions` (`:216–225`) | Always exactly 2 sentinels then one row per reported expiry: **(1)** `value "__front__"`, label `resolvedExpiry ? \`Front · ${shortExpiry(resolvedExpiry)}\` : "Front"` → `"Front · Jul 31"`; **(2)** `value "__all__"`, label `"All expiries"`; **(3…n)** `value e.expiry`, label `` `${shortExpiry(e.expiry)} · ${e.rows.toLocaleString()} rows` `` → `"Jul 31 · 1,204 rows"` | Order is `expiries` array order as the server sent it — **not sorted client-side** | The list "is whatever the endpoint reports as actually having rows today, so a pick can never produce an empty chart" (`:22–23`). Before the first response only the two sentinels exist |
| **B290** `shortExpiry(iso)` | `:134–142` | `/^(\d{4})-(\d{2})-(\d{2})$/` → `new Date(Date.UTC(y, m-1, d, 12)).toLocaleDateString("en-US",{timeZone:"UTC",month:"short",day:"numeric"})` → `"Jul 31"`. Parsed at **UTC noon** so the label cannot slip a day west of UTC | — | Returns the raw ISO string on a regex miss |
| **B291** Session segmented control | `:479–505` | Two buttons, in order **`"RTH"`** then **`"ETH"`**. Default `"rth"`. Container `flex · 1px solid C.border · radius 7 · overflow hidden` | Button `10px / 800 · letterSpacing .1em · padding "3px 10px" · border none · cursor pointer`. Active: `background rgba(33,158,188,0.18)`, `color C.cyan`. Inactive: `background transparent`, `color C.text` — **full-strength white by design**: "the cyan tint + cyan ink on the active button carries the state, so dimming the inactive one is redundant and just costs legibility" (`:494–496`) | `aria-pressed={on}` on both |
| **B292** `"RTH"` tooltip | `title=` (`:481`) | `"Regular hours — 09:30–16:00 ET"` | — | — |
| **B293** `"ETH"` tooltip | `title=` (`:482`) | `"Extended — the whole ET day, including the overnight tail"` | — | — |
| **B294** View segmented control | `:511–536` | Two buttons, in order **`"$ GEX"`** then **`"+GEX %"`**. Default `$` (`showPct` false). `onClick={() => { if (!active) togglePct(); }}` — clicking the already-active button is a no-op | Container border: `pctView ? "rgba(251,133,1,0.40)" : C.border`. Button fill: active **and** `+GEX %` → `rgba(251,133,1,0.18)` with `color PCT #FB8501`; active `$ GEX` → `rgba(255,255,255,0.06)` with `color C.text`; inactive → `transparent` / `C.text` | **Always rendered.** Comment `:508–510` and `:172–177`: it used to hide itself when the window held no `posPct` rows, so "the whole feature vanished on a weekend … and read as the change having been rolled back" |
| **B295** `"$ GEX"` tooltip | `title=` (`:514`) | `"Net vol GEX in dollars — the signed flow series"` | — | — |
| **B296** `"+GEX %"` tooltip | `title=` (`:515`) | `"Share of the selected expiry's |net GEX| (OI+Vol) that is positive — the same number as the home Levels strip's +GEX % tile. Above 50% = long-gamma chain."` | — | — |
| **B297** View persistence | `PCT_VIEW_KEY = "cbedge.volGexFlow.pctView"` (`:81, 158–166`) | **`sessionStorage`, not `localStorage`** — per browser tab, cleared when the tab closes. Read on mount: `getItem(key) === "1"` sets `showPct` true, anything else leaves it false. Write in the updater: `setItem(key, v ? "0" : "1")` where `v` is the **previous** value | Both read and write are wrapped in `try {} catch {}` | Default off "so the tab still opens on the dollar series it has always shown" (`:155–156`) |
| **B298** Bucket note | `:537–539` | `` `${BIN_LABEL} buckets · today ET` `` → `"30s buckets · today ET"` — `11px · C.text · letterSpacing .06em` | — | Always rendered |
| **B299** Updated stamp | `:541–545` | `etTime(Math.floor(updatedAt / 1000))` → `"03:41 PM"` — `11px · C.text · fontFamily var(--font-mono)`, pushed right by `marginLeft: "auto"` on its wrapper | — | The whole `<span>` is **omitted** while `updatedAt` is null (before the first response). `updatedAt` is set on **every** settled response including an `ok:false` one, so a failing feed still advances the stamp |
| **B300** Panel Refresh button | `:546–551` | Label `"Refresh"`. `10px / 700 · letterSpacing .08em · uppercase · color C.cyan · background rgba(33,158,188,0.10) · border 1px solid C.border · radius 6 · padding "3px 10px"`. `onClick={() => void load()}` | Hand-rolled, **not** `homeButtonStyle` and **not** `useRefreshButton` — a third refresh-button treatment on the tab (cf. **B59**, **B125**) | Never disabled, no lock, no state feedback — rapid clicks fire overlapping requests |

### B16c — VolGexFlowPanel chart
`VolGexFlowPanel.tsx:275–428, 576–608`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B301** Chart engine | `createChart` from `lightweight-charts` (`:28, 290`) | Mounted imperatively into `<div ref={boxRef} style={{position:"absolute", inset:0}} />` inside a `flex 1 · minHeight 200 · position relative` wrapper (`:578–579`). **This is the only `<canvas>` on the tab** — every other chart in Part B is hand-rolled inline SVG | — | `box.innerHTML = ""` before create; full teardown (`chart.remove()`, refs nulled, `ResizeObserver` disconnected, rAF cancelled) on unmount |
| **B302** Canvas tagging | `:579` | **The chart container carries no `data-cb-layer`** — no data attribute of any kind | — | Violates v3 non-negotiable 6. See **Do not port** |
| **B303** Visibility gating | `:203–214, 285–394` | **None for painting.** The `ResizeObserver` and the rAF pump run whenever mounted, and the chart re-lays-out on every resize regardless of whether the card is on screen. The only `visibilitychange` handler makes the poll **more** eager, not less (**B279**) | — | Violates v3 non-negotiable 5 |
| **B304** Chart options | `:290–319` | `layout.background` `{type: Solid, color: "transparent"}` · `textColor C.text` · `fontFamily "Inter, system-ui, sans-serif"` · `attributionLogo false`. Grid `vertLines`/`horzLines` both `rgba(255,255,255,.05)`. `rightPriceScale {visible: true, borderColor: C.border}`, `leftPriceScale {visible: false, borderColor: C.border}` — the left scale is declared in the constructor rather than added on demand because "adding a price scale to a live chart re-lays-out the pane and jumps the series" (`:302–304`). `handleScale: false`, `handleScroll: false` — **no pan, no zoom**. `crosshair {mode: 0}`. `timeScale {borderColor: C.border, timeVisible: true, secondsVisible: false, tickMarkFormatter: etTime}`. `localization {priceFormatter: p => fmtGex(p, 1), timeFormatter: etTime}` | — | — |
| **B305** `$` series | `chart.addSeries(BaselineSeries, …)` (`:321–334`) | Right scale. `baseValue {type:"price", price: 0}` · `lineWidth 2` · `priceLineVisible false`. `scaleMargins {top: 0.12, bottom: 0.14}` — the bottom margin "keeps the lowest price tick off the canvas edge, where lightweight-charts would clip the label in half" | `topLineColor POS` `#8ECAE6` · `topFillColor1 "rgba(142,202,230,0.32)"` · `topFillColor2 "rgba(142,202,230,0.02)"` · `bottomLineColor NEG` `#EF4444` · `bottomFillColor1 "rgba(239,68,68,0.02)"` · `bottomFillColor2 "rgba(239,68,68,0.32)"`. The two fill rgba values are hand-typed expansions of `C.green` and `C.red` | A Baseline series is used because "net vol GEX is a POLARITY measure — the sign is the signal … a baseline series splits the fill at zero natively" (`:14–17`) |
| **B306** `%` series | `chart.addSeries(BaselineSeries, …)` (`:340–366`) | `priceScaleId "left"`, `baseValue {type:"price", price: 50}`, `visible: false` at creation, same six colours as **B305**, `lineWidth 2`, `priceLineVisible false`, `priceFormat {type:"custom", minMove: 0.1, formatter: p => \`${p.toFixed(0)}%\`}`. Same `scaleMargins {top .12, bottom .14}` | Split at **50**, not 0 — "on this series the regime change is the chain flipping between net long and net short gamma" (`:261–262`). Two scales rather than one shared "so each keeps its own price formatter ($ vs %)" (`:337–339`) | — |
| **B307** `%` autoscale ladder | `autoscaleInfoProvider` (`:358–364`) | No values → `{minValue: 0, maxValue: 100}`. Otherwise `lo = Math.max(0, Math.min(50, ...vals) - 5)` and `hi = Math.min(100, Math.max(50, ...vals) + 5)` — **padded by 5 points either side but always containing 50, clamped to 0–100** | Comment `:353–357`: pure data-fit "would make a 58–64 day look like a regime war"; a hard 0–100 "would flatten that same day into a dead straight line" | Reads `pctValsRef`, a **ref not state**, because the provider is captured once at series creation and would otherwise close over stale data (`:280–283`) |
| **B308** Data push | `:396–414` | `$`: `points.map(p => ({time: Math.floor(p.ts/1000) as UTCTimestamp, value: p.volGex}))` then `timeScale().fitContent()` in a try/catch. `%`: sets `pctValsRef.current` then `pctPoints.map(p => ({time: …, value: p.posPct}))` — **no `fitContent` on the % effect** | — | `fitContent` is wrapped `try {} catch { /* not laid out yet */ }` |
| **B309** View swap | `:418–428` | Separate effect from chart creation "so switching never tears down and rebuilds the canvas — only visibility and which scale is showing". Toggles `visible` on both series and `visible` on both price scales, then `fitContent()` | Driven by `pctView`, which is `showPct` alone (`:178`) — deliberately **not** gated on whether any `posPct` data exists | An empty % view "lands on the same 'no snapshots' scrim the $ view already shows" (`:176–177`) |
| **B310** Sizing | `:369–384` | `ResizeObserver` on the box calls `applySize`, which only calls `chart.applyOptions({width, height})` when both are `> 0` and either changed. Plus a `requestAnimationFrame` pump that retries `applySize` while width or height is 0, **up to 120 frames** | — | Guards against a chart created inside a not-yet-laid-out flex box |
| **B311** `"LONG GAMMA"` corner label | `:586–588`, **% view only** | `position absolute · top 6 · left 10 · fontSize 9.5 · fontWeight 800 · letterSpacing .09em · pointerEvents none` | `color "rgba(142,202,230,0.85)"` — `#8ECAE6` at 85% | Rendered only when `pctView`; `pointerEvents:none` "so they never eat a crosshair hover" |
| **B312** `"SHORT GAMMA"` corner label | `:589–591`, **% view only** | `position absolute · bottom 24 · left 10 · fontSize 9.5 · fontWeight 800 · letterSpacing .09em · pointerEvents none` | `color "rgba(239,68,68,0.85)"` — `#EF4444` at 85% | As above. Comment `:581–583`: corner labels instead of a legend because "with one series on screen the question isn't 'which line is which', it's 'which side of the 50 line am I on'" |
| **B313** Scrim | `:595–607` | Gate: `loading \|\| err \|\| (!points.length && !loading)`. `position absolute · inset 0 · flex centred · background "rgba(5,6,10,0.72)" · borderRadius 10 · textAlign center · padding 16` | Text `12px / 700 · letterSpacing .06em`, `color: err ? C.red : C.cyan` | **Covers the chart only** — the six stat tiles above it stay visible and keep showing their last values |
| **B314** Scrim text ladder | `:598–604` | In precedence order: **(1)** `err` → the raw error string · **(2)** `loading` → `pctView ? "Loading +GEX % history…" : "Loading net vol GEX history…"` · **(3)** `session === "rth"` → `"No snapshots in today's RTH window — try ETH"` · **(4)** otherwise → `"No snapshots recorded yet today"` | — | Branch 3 is the only empty state on the tab that names its own remedy |

### B16d — VolGexFlowPanel stat tiles (6, `3×2` grid)
`VolGexFlowPanel.tsx:113–130, 228–273, 434–458, 555–574`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B315** Tile grid | `:559` | `display grid · gridTemplateColumns "repeat(3, minmax(0, 1fr))" · gap 5 · flexShrink 0` — a **pinned 3×2**. Comment `:555–558`: `auto-fit` "used to reflow from one row to two to three as the window narrowed, and every row it added came straight out of the chart's height" | — | — |
| **B316** Tile chrome | `:561–572` | Tile: `flex column · alignItems center · gap 0 · background "rgba(13,17,25,0.35)" · border 1px solid C.border · radius 7 · padding "4px 8px" · minWidth 0`. Label `9.5px / 700 · uppercase · letterSpacing .07em · C.text · nowrap · ellipsis`. Value `var(--font-mono) · 16px · lineHeight 1.25 · 800 · color = card.color · nowrap`. Sub `9px · C.text · nowrap · ellipsis` | Only the value takes a threshold colour; label and sub are always `C.text` | **`9.5px` is a half-pixel type size** — it appears nowhere else in Part B |
| **B317** Tile placeholders | `:560` | `(cards.length ? cards : Array.from({length: 6}, () => null))` — when there are no stats, **six empty tiles still render** with label `"—"`, value `"—"` and an empty sub | — | Keeps the block's height fixed so the chart never moves |
| **B318** `stats` memo | `:228–246` | `vals = points.map(p => p.volGex)`; `last = points[len-1]`; `hiIdx`/`loIdx` by `reduce` with strict `>` / `<`, so **the first extreme wins a tie**; `flips` counts `i` where `(vals[i-1] < 0 && vals[i] >= 0) \|\| (vals[i-1] >= 0 && vals[i] < 0)` — **zero counts as positive** | — | `null` when `!points.length` → `cards` is `[]` → six placeholders |
| **B319** `pctStats` memo | `:251–273` | Same shape over `pctPoints`. `above = vals.filter(v => v >= 50).length`; `abovePct = (above / vals.length) * 100`; `flips` counts crossings of **50**, not 0, with the same `>= / <` boundary; `prev = vals.length > 1 ? vals[len-2] : null`; `d = prev == null ? null : last - prev` | — | `null` when `pctPoints.length === 0` |
| **B320** `fmtGex(v, digits = 2)` | `:113–122` | **Ladder:** `>= 1e12` → `T` · `>= 1e9` → `B` · `>= 1e6` → `M` · `>= 1e3` → `K` at **0 dp** · else `abs.toFixed(0)`. All on `Math.abs(v)`, with `sign = v < 0 ? "−" : ""` — a **U+2212 MINUS SIGN**, not an ASCII hyphen. The chart's `priceFormatter` calls it with `digits = 1`; the tiles use the default 2 | — | `"—"` for `null`, `undefined` and non-finite. **This is a second, incompatible magnitude formatter alongside `glFmtBn` (B12)** — different tiers (`T`/`K` exist here), different case (`B` vs `bn`), different minus glyph |
| **B321** `etTime(sec)` | `:124–130` | `new Date(sec*1000).toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit"})` → `"03:41 PM"`. Forced ET | — | Used for every tile sub-label, the time axis and the updated stamp |
| **B322** `$` tile 1 — `"Net Vol GEX"` | `stats.last.volGex` (`:451`) | `fmtGex(v)` → `"−1.24B"`. Sub `etTime(last.ts/1000)` | `color: last.volGex >= 0 ? POS #8ECAE6 : NEG #EF4444` | Placeholder when `stats` is null |
| **B323** `$` tile 2 — `"Δ Last Bucket"` | `stats.last.dVol` (`:452`) | `last.dVol == null ? "—" : \`${last.dVol > 0 ? "+" : ""}${fmtGex(last.dVol)}\`` — a `+` only when strictly positive; negatives get their `−` from `fmtGex`. Sub is `BIN_LABEL` → `"30s"` | `color: (last.dVol ?? 0) >= 0 ? POS : NEG` | `"—"` when `dVol` is null |
| **B324** `$` tile 3 — `"Session High"` | `stats.high.v` (`:453`) | `fmtGex(v)`. Sub `etTime(stats.high.at/1000)` | `color: POS` **unconditionally** — a session whose high is still negative is inked as positive | — |
| **B325** `$` tile 4 — `"Session Low"` | `stats.low.v` (`:454`) | `fmtGex(v)`. Sub `etTime(stats.low.at/1000)` | `color: stats.low.v < 0 ? NEG : C.text` — the only tile with a **white** fallback ink. Asymmetric with tile 3, which has no such guard | — |
| **B326** `$` tile 5 — `"Sign Flips"` | `stats.flips` (`:455`) | `String(stats.flips)` — a bare integer. Sub: `flips === 0 ? "one regime" : "regime changes"` | `color: stats.flips > 0 ? C.orange #FB8501 : C.cyan #219EBC` | — |
| **B327** `$` tile 6 — `"Spot"` | `stats.last.spot` (`:456`) | `last.spot ? last.spot.toFixed(2) : "—"` — 2 dp, no grouping. Sub `` `${last.strikes} strikes` `` | `color: C.cyan` unconditionally | `"—"` when `spot` is `0`, `null` or `undefined` (falsy test, so a genuine 0 prints `"—"`) |
| **B328** `%` tile 1 — `"+GEX %"` | `pctStats.last.v` (`:440`) | `` `${v.toFixed(0)}%` `` → `"58%"`. Sub `etTime(last.ts/1000)` | `ink(v) = v >= 50 ? POS : NEG` | Placeholder when `pctStats` is null |
| **B329** `%` tile 2 — `"Δ Last Bucket"` | `pctStats.d` (`:441`) | `s.d == null ? "—" : \`${s.d > 0 ? "+" : "−"}${Math.abs(s.d).toFixed(1)}pt\`` → `"+1.4pt"` / `"−0.7pt"`. Sub `BIN_LABEL` → `"30s"` | `color: (s.d ?? 0) >= 0 ? POS : NEG`. **The sign glyph and the colour disagree at exactly zero**: the label ternary is `> 0`, the colour ternary is `>= 0`, so `d === 0` renders `"−0.0pt"` inked positive | `"—"` when there is only one bucket |
| **B330** `%` tile 3 — `"Session High"` | `pctStats.high.v` (`:442`) | `` `${v.toFixed(0)}%` ``. Sub `etTime(high.at/1000)` | `color: POS` unconditionally — a session whose high is under 50% is still inked positive | — |
| **B331** `%` tile 4 — `"Session Low"` | `pctStats.low.v` (`:443`) | `` `${v.toFixed(0)}%` ``. Sub `etTime(low.at/1000)` | `color: NEG` unconditionally — symmetric with tile 3 here, unlike the `$` view (**B325**) | — |
| **B332** `%` tile 5 — `"Time > 50%"` | `pctStats.abovePct` (`:444`) | `` `${abovePct.toFixed(0)}%` ``. Sub: `s.flips === 0 ? "one regime" : \`${s.flips} regime changes\`` — note this sub carries the **count**, where the `$` view's tile 5 puts the count in the value and a bare noun in the sub | `color: s.abovePct >= 50 ? POS : NEG` | — |
| **B333** `%` tile 6 — `"Regime"` | `pctStats.last.v` (`:445`) | `s.last.v >= 50 ? "LONG γ" : "SHORT γ"` — the γ is U+03B3. Sub `` `${s.last.strikes} strikes` `` | `ink(s.last.v)` — `POS` at `>= 50`, else `NEG` | — |
| **B334** Tile ordering rationale | Comment `:431–433` | The six tiles keep the same "order of meaning (now / change / high / low / regime / context)" across both views "so the eye doesn't have to re-learn the block when you flip the switch" | — | — |

## B17 — Every fetch on this tab, in one place

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **B267** Fetch 1 | `GET /proxy/gex` | No params · `cache: "no-store"` · **poll 15 s** · fires on mount · 1 instance | `!ok` → `proxy {status}` | Sets `err`; keeps last good `snap` |
| **B268** Fetch 2 | `GET /proxy/gex-by-strike-multi?symbol=$SPX` | `cache: "no-store"` · **poll 60 s** · fires on mount · 1 instance, shared by 3 cards | Content-type guard, then `!ok \|\| json.ok === false` | Sets `err`; keeps last good `data` |
| **B269** Fetch 3 | `GET /api/eod-gex?symbol=$SPX&limit=30` | `cache: "no-store"` · **no poll** · fires once per panel mount · **2 instances** (one per EOD card), identical params | `!ok` → `HTTP {status}` | Sets that panel's `err` |
| **B270** Fetch 4 | `GET /proxy/gex-levels-history?limit=3650` | `cache: "no-store"` · **no poll** · fires once on tab mount | Failure returns `[]` silently — no user-visible error | localStorage cache stands |
| **B271** Fetch 5 | `GET /api/chains?ticker={sym}&expiration={exp}&range=all` | **No `cache` option** · fires up to **12 in parallel** via `Promise.allSettled` · once per ET day (localStorage-gated) · re-fires on `symbol` or `expirations` change and on Refresh | `!ok` → `HTTP {status}` per expiry; all rejected → `"no expirations resolved"` | Rejected expiries silently absent |
| **B335** Fetch 6 | `GET /proxy/gex-vol-flow?bin=30&session={rth\|eth}&{scope=front\|scope=all\|expiry=<iso>}` | `cache: "no-store"` · **poll 15 s** · plus an immediate tick on `visibilitychange → visible` · fires on mount and on every picker or session change · 1 instance (card 12) | `json.ok === false` → `"History DB unavailable"` (reason `no-db`) or `"Feed unavailable"`; a thrown error surfaces raw | Server-side error clears `points`; a network throw does not |
| **B272** Waterfall | Fetch 5 depends on `snap.expirations` from Fetch 1 | `/proxy/gex` → `/api/chains` is a two-hop dependency | — | Violates the v3 "no request waterfalls" rule. See **Do not port** |
| **B273** Abort behaviour | All six | **No `AbortController` anywhere in either file.** Unmount clears intervals and flips an `alive` flag, but in-flight requests run to completion and their `setState` is guarded only in `useGexLevels` (`if (alive)`) and `fetchServerGlHistory`'s caller | — | `useEodGex`, `useOiByExpiration`, `useGexByStrikeMulti` and `VolGexFlowPanel.load` all `setState` unconditionally in their `finally`/`catch`, so a late response after unmount is an unguarded update. `useRefreshButton`'s 1800 ms revert timer is likewise never cleared (**B59**) |
| **B274** Visibility | — | No `IntersectionObserver` and no market-hours check anywhere. All polls run at full rate in a background tab and all 12 cards paint whether or not they are scrolled into view. The **only** `document.visibilityState` reference on the tab is `VolGexFlowPanel`'s wake-on-visible handler (`:211`), which makes that one poll *more* eager rather than pausing anything | — | Violates v3 constraint 5. See **Do not port** |

---

### Colours used

Every colour value this part paints, with its v3 target. `alpha(X, a)` is
`theme.ts:27`.

| v2 value | Where used | Exists in v3 `tokens.css`? | Proposed v3 token |
|---|---|---|---|
| `HT.text` `#FFFFFF` | every label, every axis tick, tooltip text, needle + hub, `NetDelta`/`CallPutGamma` spot line, cumulative-chart flip line, `GlCurveSpark` neutral line, drag handle, `"Drop here"`, table cells | yes — `--color-fg` | `T.text` |
| `HT.red` `#EF4444` | Support tile accent, both gauges' negative/extreme bands, every negative bar (gamma bars, delta bars, EOD bars), every put bar, all five error lines, `GL_SIGN_COLOR(-1)` | yes — `--color-v2-red` (and `--color-impact-high`) | **`MOVE_DOWN`** — collapse with the data-negative semantic |
| `HT.border` `rgba(255,255,255,0.10)` | every chart's zero baseline, `ChartTooltip` border, `HistoryTable` container + every `th`/`td` bottom border, `ColumnDropZone` dashed edge, Card edge, `homeInputStyle` edge, `ThemedSelect` trigger edge | no exact (v3's `--color-line` is opaque `#23272e`) | `V2W.border` = `alpha(T.text, .10)` |
| `HT.panel` `#0D1119` | `ChartTooltip` background — **opaque**, deliberately not the translucent plate | yes — `--color-v2-panel` | `V2.panel` |
| `HT.panelBg` `rgba(13,17,25,0.45)` | `statTileStyle` (the four header tiles), `classicCardAccentStyle` (all 13 cards) | no exact | `V2W.panelBg` = `alpha(V2.panel, .45)` |
| `HT.cyan` `#219EBC` | `homeButtonStyle` text + border + gradient (the four "Refresh" buttons), the tab pill's accent in `scannerNav`, `ThemedSelect` selected-value text and `DOCK_THEME` derivatives | yes — `--color-v2-cyan` | `V2.cyan` |
| `HT.green` `#8ECAE6` — **a light blue** | Card **subtitle** colour on all 13 cards (`PageCard.tsx:138`) | yes — `--color-v2-green` | `V2.green`. Keep the v2-green name and its warning comment |
| `LIGHT_BLUE` `#7dd3fc` | Resistance tile accent, `$Gamma` gauge positive band, `CPG` gauge middle band, call bars, positive delta bars, OI-by-date bars, Call mini-chart, EOD positive bars, spot line on both gamma charts, scope-chip **text**, `accent` prop on all 13 cards (ignored) | **no exact.** v3's `LIGHT_BLUE` → `--color-series-5` `#4fb8d4`; `--color-v2-lightblue` is `#7ed3fc` (one digit off, sourced from a CSS rule elsewhere in v2) | `LIGHT_BLUE`, accepting the shift — or add a `--color-v2-lightblue-exact` if pixel parity is required. **Flag for Brandon** |
| `GEX_POS_GREEN` `#22C55E` | positive cumulative-gamma area + line, positive gamma bars, the bars chart's flip line, two legend swatches | yes — `--color-v2-pos` and `--color-netdrift-call`, both `#22c55e` | **`MOVE_UP`** (`#35c28e`) if the semantic collapse is accepted, else `V2.pos` for exact parity |
| `rgba(141,205,255,0.10)` = `#8DCDFF` @ 10% | scope-chip background | no | `alpha(LIGHT_BLUE, .10)` — **collapse onto the chip's own text colour** |
| `rgba(141,205,255,0.28)` = `#8DCDFF` @ 28% | scope-chip border | no | `alpha(LIGHT_BLUE, .28)` |
| `rgba(0,0,0,0.4)` | `homeInputStyle` background (the Stock Filter plate), `ThemedSelect` trigger background | `--color-shadow` is `#000000` | `alpha(SHADOW, .4)` |
| `rgba(0,0,0,0.45)` | `ChartTooltip` `boxShadow 0 12px 28px` | as above | `alpha(SHADOW, .45)` |
| `rgba(0,0,0,0.22)` | `classicCardStyle` `boxShadow 0 18px 40px` | as above | `alpha(SHADOW, .22)` |
| `rgba(33,158,188,.25)` / `.12` / `.04` | `homeButtonStyle` border and its two gradient stops | derived from `--color-v2-cyan` | `alpha(V2.cyan, .25)` / `.12` / `.04` |
| `rgba(33,158,188,.4)` / `.08` | `homeRefreshButtonStyle` idle border / background | derived | `alpha(V2.cyan, .4)` / `.08` |
| `REFRESH_GREEN` `#1FD98A` | refresh button success border, fill @10%, text, and `textShadow 0 0 12px` @50% | yes — `--color-v2-refresh` | `V2.refresh` |
| `#888` | refresh button text while `refreshing` | no | `T.flat` (`--color-flat` `#7a828d`) |
| `${c}33` (20% alpha of `#22C55E` or `#EF4444`) | cumulative-gamma area fill and `GlCurveSpark` area fill | no — it is a runtime hex-append | `alpha(MOVE_UP, .2)` / `alpha(MOVE_DOWN, .2)` |
| `DOCK_THEME.*` (`activeBorder`, `activeGlow`, `bg`, `shadow`, `activeTile`, `hoverTile`, `cyanTop`) | `ThemedSelect` menu chrome. Unreachable on the tab's own Expiry Filter (it is `disabled`), but **live** on card 12's expiry picker (**B288**) | derived from `V2.cyan` | `V2.cyan` washes as in `theme.ts` `V2W` |
| `var(--font-mono, monospace)` / `var(--font-mono)` | every `HistoryTable` `td`; card 12's updated stamp and all six tile values | yes — `--font-mono` | `--font-mono` |
| **Card 12 only — `VolGexFlowPanel.tsx`** | | | |
| `POS = C.green` `#8ECAE6` | the `$` and `%` series' `topLineColor`, and the positive ink on tiles 1–3, 5 and 6 in both views | yes — `--color-v2-green` | **`MOVE_UP`** — collapse with gamma-positive. See the note below |
| `rgba(142,202,230,0.32)` / `rgba(142,202,230,0.02)` | `topFillColor1` / `topFillColor2` on both Baseline series — hand-typed expansions of `#8ECAE6` | no | `alpha(MOVE_UP, .32)` / `alpha(MOVE_UP, .02)` |
| `rgba(142,202,230,0.85)` | `"LONG GAMMA"` corner label | no | `alpha(MOVE_UP, .85)` |
| `NEG = C.red` `#EF4444` | both series' `bottomLineColor`, negative tile ink, scrim error text | yes — `--color-v2-red` | **`MOVE_DOWN`** |
| `rgba(239,68,68,0.02)` / `rgba(239,68,68,0.32)` | `bottomFillColor1` / `bottomFillColor2` | no | `alpha(MOVE_DOWN, .02)` / `alpha(MOVE_DOWN, .32)` |
| `rgba(239,68,68,0.85)` | `"SHORT GAMMA"` corner label | no | `alpha(MOVE_DOWN, .85)` |
| `PCT = C.orange` `#FB8501` | the `+GEX %` switch's active ink only — **never the series** (`:66–69`); also `"Sign Flips"` ink when `flips > 0` | yes — `--color-v2-orange` | `V2.orange` |
| `rgba(251,133,1,0.40)` / `rgba(251,133,1,0.18)` | `+GEX %` switch container border / active button fill | no | `alpha(V2.orange, .40)` / `.18` |
| `C.cyan` `#219EBC` | panel Refresh ink, active session-button ink, `"Spot"` tile ink, `"Sign Flips"` ink at 0, loading-scrim text | yes — `--color-v2-cyan` | `V2.cyan` |
| `rgba(33,158,188,0.18)` / `rgba(33,158,188,0.10)` | active session-button fill / panel Refresh fill | no | `alpha(V2.cyan, .18)` / `.10` |
| `rgba(255,255,255,0.06)` | active `$ GEX` button fill | no | `V2W.wash05`-adjacent → `alpha(T.text, .06)` |
| `rgba(255,255,255,.05)` | chart grid lines, both axes | no | `alpha(T.text, .05)` |
| `rgba(13,17,25,0.35)` | the six stat tiles' plate — `#0D1119` at **35%**, where the rest of the tab's plates are at 45% | no | `alpha(V2.panel, .35)` — a **fourth** panel alpha (.35 / .45 / .72 / .97) |
| `rgba(5,6,10,0.72)` | the chart scrim — `#05060A` (`HT.bg`) at 72% | `--color-v2-bg` | `alpha(V2.bg, .72)` |
| `"transparent"` | chart `layout.background`, inactive segmented-button fills | n/a | keep literal `transparent` |

**The three-blues case (this part's "two-reds").** v2 paints, on one screen,
three different light blues for things that read as the same accent:
`LIGHT_BLUE #7dd3fc` (tiles, bars, spot lines, chip text), `HT.green #8ECAE6`
(every card subtitle), and `#8DCDFF` (the scope chip's plate and border). The
port should collapse all three onto **one** token. Row **B42** records that the
chip's own text and its own plate disagree, which is the tightest case.

**`#8ECAE6` carries two unrelated jobs on this tab.** On all 13 cards it is the
**subtitle** colour, applied by `PageCard` (**B31**). Inside card 12 it is
`POS` — the **positive / long-gamma** series colour and the positive tile ink
(**B305**, **B322**), chosen there precisely because "C.green is the dashboard's
light blue — the same token the Levels strip uses for a positive Net GEX, so
'positive gamma' reads identically across the app" (`VolGexFlowPanel.tsx:35–36`).
So on card 12 the subtitle text and the positive series are the same value for
two different reasons. These must split in v3: subtitle → `V2.green`,
positive → `MOVE_UP`.

**The three-positives case.** "Positive" is `GEX_POS_GREEN #22C55E` on the three
gamma surfaces, `LIGHT_BLUE #7dd3fc` on the delta, OI and EOD surfaces, and
`#8ECAE6` on card 12's flow series. Three values, one semantic, and each has a
comment defending it against the *other two* (`GexLevelsTab.tsx:452–456` argues
`#22C55E` because `#8ECAE6` is a blue that would collide with the spot line;
`VolGexFlowPanel.tsx:35–36` argues `#8ECAE6` because it matches the Levels
strip). Both arguments are locally sound, which is exactly how three values
survive. v3 should decide this once.

**The three-spot-lines case.** The spot marker is `LIGHT_BLUE @ 0.6` on the
cumulative gamma chart (**B199**), `LIGHT_BLUE @ 0.75` on the gamma bars
(**B228**), and `HT.text @ 0.6` on the delta and call/put charts (**B239**,
**B249**). Same mark, three treatments. Collapse to one.

**The two-flip-lines case.** The gamma flip is `HT.text`, dash `"2 3"`,
opacity 0.55 on the cumulative chart (**B198**, drawn even when out of view);
`GEX_POS_GREEN`, dash `"4 3"`, opacity 0.55 on the gamma bars (**B227**, drawn
only when in view); and `HT.text`, dash `"2 2"`, opacity 0.45 in the table
sparkline (**B168**, in-view only). Three treatments, one semantic.

**Type sizes used, against the v3 scale.** This part paints at **9, 9.5, 10, 11,
12, 14, 15, 16, 17** px — the `9.5` and `16` are card 12's tile label and tile
value (**B316**), and `9.5` again on its two corner labels (**B311**, **B312**).
v3's scale is 9 / 10 / 11 / 13 / 15 / 18 / 24 / 32. **9.5, 12, 14, 16 and 17
have no slot**, and a half-pixel size cannot be expressed on the scale at all.
The 17px label/heading size in particular is used for the
stat-tile labels (**B40**), the gauge captions (**B54**), the card title spans
(**B30**, **B87**), the `th` row (**B149**) and the drag handle — and in three of
those it is *larger than the value it labels* (**B41**, **B149**). v3 should map
17 → `text-lg` (18) and 14 → `text-sm` (13) or `text-base` (15) and, separately,
fix the label-larger-than-value inversion rather than reproduce it.

### Do not port

1. **`accent={LIGHT_BLUE}` on every `Card`** — 13 call sites (`:1974`, `:2056`,
   `2066`, `2076`, `2086`, `2096`, `2106`, `2117`, `2134`, `2151`, `2162`,
   `2173`, `2190`). `PageCard.tsx:23–34` documents the prop as **dead**: "The
   `accent` prop is retained only so the existing call sites still typecheck; it
   is ignored." Drop it.
2. **`variant="budget"`** — resolves to `classicCardAccentStyle`, the same
   surface `"gloss"` gives. Both are aliases in v2. v3 should have one card.
3. **The module header comment, `:69–90`.** It advertises "ITM toggles / strike
   table" as part of this tab. **There is no strike table and there are no ITM
   toggles anywhere in the 2233 lines.** It also says the "History of key level
   changes" and "Open Interest by expiration" panels "have no backing history in
   this app yet" and then, two lines later, describes both as built. This is
   Test-Lab-era text that survived the 2026-08-16 move. Do not carry it, and do
   not build a strike table from it — if v3 wants one, that is a new decision.
4. **`AmTbrStat` and its doc comment (`:24–67`).** The name and the comment
   describe an "AM TBR" feature that moved to `/es-candles`. In v3 this is just
   a stat tile with an optional scope chip; name it for what it is.
5. **The `gl` / `Gl` symbol prefix** on `glFmt0`, `glFmt2`, `glFmtBn`,
   `glFmtDate`, `glFmtExpiryLabel`, `glOiVolNet`, `glDexOf`, `glCumulativeByStrike`,
   `glSignSegments`, `glDownsampleCurve`, `GlEmpty`, `GlCurveSpark`,
   `GlHistoryEntry`, `loadGlHistory`, `saveGlHistory`, `mergeGlHistory`,
   `fetchServerGlHistory`, `GL_SIGN_COLOR`, `GL_CURVE_POINTS`, `GL_HISTORY_KEY`,
   `GL_HISTORY_MAX_DAYS`. Collision-avoidance for a file that no longer exists.
6. **`EOD_GEX_FIELD_META.totalGex`** (`:1069–1073`) and the `field = "totalGex"`
   defaults on `EodGexBarChart` (`:1139`) and `EodGexPanel` (`:1210`).
   Unreachable — both call sites pass an explicit basis. The strings
   `"Net GEX (legacy, mixed basis)"`, `"no eod_gex rows"` and
   `"eod_gex.total_gex — basis varies by source, reference only"` never render.
   `EodGexRow.totalGex` is parsed only to feed this dead branch.
7. **`useChartPan`'s `zoom` return value** (`:380`). Returned, never read by any
   of the four consumers — they use `winHalf`, which already folds it in.
8. **`GexLevelsRow.callVolume` / `putVolume`** (`:96–97`). Declared, zero-filled
   by `multiRow`, never read.
9. **`GexMultiPayload.sessionDate`, `.updatedAt`, `.cached`** (`:1272, 1276–1277`).
   Parsed at `:1344, 1348–1349`, rendered nowhere. The multi cards have no
   "as of" stamp at all, which is arguably the bug — a 60 s-cached server
   response with no freshness indicator.
10. **`ColumnDropZone`'s `active={false}` branch** (`:1897`). The only call site
    (`:2217`) hardcodes `active={true}`, so `opacity: 0.25` is unreachable.
11. **`useCardLayout().reset`** (`:1848–1852, 1854`). Fully implemented,
    persists correctly, and **wired to no button.** Either give it a control in
    v3 or delete it.
12. **Colour literals in the component** — `GEX_POS_GREEN = "#22C55E"` (`:456`),
    `rgba(141,205,255,0.10)` and `rgba(141,205,255,0.28)` (`:57–58`),
    `"rgba(0,0,0,0.45)"` (`:400`), and the runtime `${c}33` hex-append at `:533`
    and `:1610`. All violate v3 non-negotiable 1.
13. **Direct `fetch()` in components** — five endpoints (**B267**–**B271**), each
    with its own `useState` triple and its own `setInterval`. v3 routes data
    through `useQuery` / `useFrame` / `useField` from `src/data`.
14. **The `/proxy/gex` → `/api/chains` waterfall** (**B272**). v3 constraint 3
    requires the route to fire everything in parallel at entry; the expiration
    list has to come from somewhere that is not a second hop.
15. **The duplicated `/api/eod-gex` request** (**B114**). Two identical fetches
    on every mount because each card owns its own hook. One query, two readers.
16. **The whole-grid gate on `d`** (**B96**). Four cards with independent data
    sources are hidden by a `/proxy/gex` outage. In v3 each card should own its
    own loading/empty state.
17. **No visibility gating** (**B274**). Twelve cards paint and two polls run at
    full rate in a background tab and while scrolled out of view. v3 constraint 5
    (`handle.visible()` / `onVisibility` / `data-visible`) applies to all of them.
18. **No `AbortController`** (**B273**). Three of the five hooks `setState`
    unconditionally after unmount.
19. **Native HTML5 drag-and-drop for the card layout** (`:1811–1846`). `dragstart`
    / `dragover` / `drop` on a `draggable` `<span>` has no touch-device path at
    all, and no keyboard path. If the arrangement is worth keeping in v3, it
    needs a pointer-event implementation.
20. **`localStorage` layout persistence with a first-paint flash** (**B83**). The
    stored arrangement swaps in one frame after mount.
21. **v2-only chrome** — `<PageShell>` (`Scanner.tsx:3089`), the `"@/…"` Next
    path alias, `"use client"`, and `readTabFromUrl()`'s effect-based query
    reading, which exists specifically to dodge Next's build-time Suspense
    requirement. v3 reads the query string directly.
22. **`ThemedSelect` for a value that cannot change** (**B58**). A permanently
    `disabled` portal'd dropdown that mounts a document-level `mousedown` and
    `keydown` listener, a `scroll`/`resize` reposition effect and a
    `createPortal` path for a menu that can never open. Render the expiry as a
    plain read-only plate, the way Stock Filter already is (**B38**).
23. **The untagged canvas** (**B302**). `VolGexFlowPanel`'s lightweight-charts
    container carries no `data-cb-layer` — it is the tab's only `<canvas>` and it
    violates v3 non-negotiable 6 outright. In v3 it must also mount through
    `ChartFrame` (non-negotiable 4) rather than `createChart` into a bare div.
24. **The card-12 stale subtitle** (**B264**). `GexLevelsTab.tsx:2192` says
    "5m buckets"; the panel sends `bin=30` and prints "30s buckets". Port the
    behaviour, fix the string — do not carry the contradiction across.
25. **A third refresh-button treatment** (**B300**). The tab already has
    `useRefreshButton` (**B59**) and the `homeButtonStyle` "Refresh" used by four
    panels (**B125**, **B179**, **B220**, **B262**); card 12 hand-rolls a fourth
    style with no state feedback and no re-entrancy lock. One refresh affordance
    in v3.
26. **`sessionStorage` for the view toggle** (**B297**). `cbedge.volGexFlow.pctView`
    is the only `sessionStorage` key in Part B — the card layout (**B80**) and
    the OI cache (**B172**) both use `localStorage`. Two persistence lifetimes for
    two user preferences on one tab, with no stated reason for the split.
27. **Two incompatible magnitude formatters** (**B12** vs **B320**). `glFmtBn`
    (`bn`/`M`, ASCII `-`, no `T` or `K` tier) and `fmtGex` (`T`/`B`/`M`/`K`,
    U+2212 `−`) both render gamma dollars, on the same screen, in adjacent cards.
    v3 needs one.
28. **The `Δ Last Bucket` zero-delta mismatch** (**B329**). Label ternary is
    `> 0`, colour ternary is `>= 0`, so a delta of exactly zero renders
    `"−0.0pt"` in the positive colour. Fix on port; do not reproduce.
29. **`handleScale: false` / `handleScroll: false` on the flow chart** (**B304**)
    while all four strike charts implement bespoke wheel-zoom and drag-pan
    (**B68**, **B69**). Two opposite interaction models for charts sitting in the
    same column. Pick one before porting.
30. **Half-pixel type** (**B316**). `fontSize: 9.5` on card 12's tile labels and
    corner labels cannot be expressed on v3's type scale.

### Open questions for Brandon

1. **Is the Expiry Filter dropdown meant to stay?** It is a disabled
   `ThemedSelect` whose only job is to display `snap.expiry` — which the card
   subtitle already prints (**B31**). Stock Filter next to it does the same job
   as a plain div (**B38**). Sharpened now that card 12 is transcribed: the same
   component appears **twice on this tab**, disabled at the top (**B58**) and
   fully live inside card 12 (**B288**). Should v3 render the header pair as
   plates, or is the dropdown a placeholder for a per-user expiry that is coming?
2. **`LIGHT_BLUE` exact value.** v2 uses `#7dd3fc`. v3 has `--color-series-5`
   `#4fb8d4` (a visibly different blue) and `--color-v2-lightblue` `#7ed3fc`
   (one digit off, and documented as sourced from an unrelated CSS rule).
   Which one does this tab ship with?
3. **Does the three-positives split survive?** Gamma-positive is `#22C55E`,
   delta/OI/EOD-positive is `#7dd3fc`, and card 12's flow-positive is `#8ECAE6`.
   Each has a code comment defending it against the other two. Separately:
   `#8ECAE6` is simultaneously the **subtitle** colour on all 13 cards and the
   **positive series** colour inside card 12. Confirm the intended collapse
   before porting.
4. **The stale-cell problem in the history table (B147).** Today's row is only
   rewritten when resistance, support, neutral, a 1 M step in $Gamma, or a
   0.02 step in CPG moves. Price, R2, S2, Open Int and the Curve sparkline are
   written at the same time but are not in the change test, so they can sit
   stale for the whole session while the row *looks* live. Should they join the
   comparison, or should the row rewrite on a timer instead?
5. **`cpgRatio` returns `0` when the put book is empty** (**B25**), which the
   CPG gauge then paints in the *red* left band — i.e. "maximally put-heavy" for
   a chain with no puts. Is `null` / `"—"` the right answer there?
6. **`multi` is hardcoded to `"$SPX"`** (**B210**) while the header card follows
   `snap.symbol` from the shared feed. If the shared feed is ever moved off SPX,
   the three multi-expiry cards will silently describe a different instrument
   from the four stat tiles above them. Intended, or a latent bug?
7. **`/proxy/gex-levels-history` failures are completely silent** (**B141**).
   A user on a fresh browser with a dead history endpoint sees
   "Logging starts as soon as a level moves." — which reads as "nothing has
   happened yet", not "the server did not answer". Should this surface an error
   line the way the other five fetches do?
8. **Is the card drag-and-drop worth rebuilding?** It is ~230 lines
   (`:1670–1904`) plus a localStorage schema and a legacy-key migration, it has
   no reset control (**B97**), and it has no touch or keyboard path. Confirm it
   is in scope for v3 before it is ported.
9. **`OiByExpiryMiniChart` formats a contract count with `glFmtBn`** (**B187**),
   so an OI axis can read `"1.2M"` while the tooltip beside it reads
   `"1,240,000"`. Which is right?
10. **Which magnitude formatter wins?** `glFmtBn` (**B12**) and `fmtGex`
    (**B320**) both format gamma dollars and disagree on the tier ladder, the
    suffix case and the minus glyph — `"1.24bn"` vs `"1.24B"`, `"-412773"` vs
    `"−413K"`. They render in adjacent cards. Which is the house format?
11. **Card 12's `Session High` / `Session Low` ink is asymmetric between views.**
    In the `$` view, High is unconditionally `POS` but Low falls back to white
    when it is non-negative (**B324**, **B325**); in the `%` view both are
    unconditional (**B330**, **B331**). Is the `$` view's white-fallback the
    intended behaviour, or should High get the mirrored guard?
12. **Is the `$`/`+GEX %` view switch in scope for the scanner tab?** It is
    remembered per browser tab in `sessionStorage` (**B297**) and it re-labels
    all six tiles and swaps the price scale. `VolGexFlowPanel` is shared with
    `app/home/HomeClient.tsx`, so a change here lands on the home page too —
    which means it may not be Part B's to re-decide.

**Part B row count: 335**
# Part C — GEX Change Top (`?tab=gexchangetop`)

**Scope.** The v2 Scanner tab `gexchangetop` — the tab `/scanner` opens on by
default. One file renders the whole thing:

| Layer | File | Lines |
|---|---|---|
| Tab registry | `components/scanner/scannerNav.ts` → `SCANNER_TABS[1]`, `SCANNER_GROUPS.gamma` | 49–64, 103–107 |
| Page mount | `components/pages/Scanner.tsx` → `ScannerPage` | 3053–3100 |
| **View (everything else)** | `components/scanner/GexChangeTop.tsx` | 1–1395 |
| Card surface | `components/shared/PageCard.tsx` → `Card variant="budget"` | 84–145 |
| Palette | `components/shared/homeTheme.ts` → `HOME_THEME`, `homeButtonStyle`, `classicCardAccentStyle` | 3–18, 186–189, 227–238 |
| Capture engine | `lib/snapshot.ts` → `captureToBlob`, `captureAndCopy`, `copyOrDownload`, `downloadBlob` | 1433–1482, and the `data-noshot` / `data-flip3d` clone rules at 477–501, 1191 |

**Out of scope for this part:** the sibling tabs (`gexlevels`, `strike`, `tpo`,
`ibstats`, `watch`), and `PickStudyTab.tsx`. Pick Study is **Part D**. Note the
coupling: Pick Study is this tab's feedback loop — it reads the graded pick
history back off `/proxy/gex-change-top-study` and asks what the A/B picks had
in common at capture. Every weight, boundary and label in **§C.D (the grade
ladder)** and **§C.M (the ranking/flag legend)** below is therefore a
cross-part contract, not a local styling choice.

**No owner gate on this tab.** `GexChangeTop` never calls `useIsOwner()` and
`SCANNER_TABS` marks only `pickstudy` as `ownerOnly`. The gate points the other
way: `ScannerPage` falls BACK to `gexchangetop` when a non-owner deep-links an
owner-only tab (`Scanner.tsx:3066`).

**Two source-of-truth notes that govern the whole part.**

1. **The server computes; the client renders.** The score (`row.score`), the
   ★ Very strong flag, the projected grade (`row.proj_grade`) and the shipped
   letter grade (`row.grade` / `row.grade_pts`) are all produced by
   `server-v2/gex-change-top-recorder.js` and `server-v2/_lib-pick-grade.cjs`.
   The score formula and the ★ threshold appear in this file **only as label
   strings** (§C.M) — a grep of `components/` and `lib/` finds no other copy of
   `200_000`, `0.6·`, or `"Very strong"`. The client's own grade ladder
   (`gradePoints`) is a **fallback for rows frozen before grading shipped**.
2. **The scorecard is the entry basis for the cards.** A pick card reads its
   entry, peak, peak time and grade off the scorecard row matched by
   `watch_id`, never off `watch_options.added_price` (see C98). Card and table
   can never disagree about the same contract.

---

## Colour constants used by this tab

`HT` = `HOME_THEME` from `components/shared/homeTheme.ts`. **Read the values
before the rows** — three of them are traps:

| Name | Value | The trap |
|---|---|---|
| `HT.green` | **`#8ECAE6`** | A **light blue**, not a green. It is this tab's positive/up colour, its call-side colour, its A/A+ grade colour AND its table-column-header colour. |
| `HT.text` | `#FFFFFF` | |
| `HT.muted` | `#FFFFFF` | **Identical to `HT.text`.** There is no muted colour on this tab. Every "secondary" line is full-strength white, dimmed only by a per-element `opacity` (0.3 / 0.62 / 0.65 / 0.7). |
| `HT.cyan` | `#219EBC` | |
| `HT.orange` | `#FB8501` | |
| `HT.red` | `#EF4444` | |
| `HT.bg` | `#05060A` | |
| `HT.panelBg` | `rgba(13,17,25,0.45)` | |
| `HT.border` | `rgba(255,255,255,0.10)` | |

Local alpha helper, `GexChangeTop.tsx:89–92`:

```
tint(hex, a) → `rgba(${r},${g},${b},${a})`   // parses "#rrggbb" only
```

`tint()` is called **only** with `HT.bg` / `HT.cyan` / `HT.orange` / `HT.green` /
`HT.red` / `HT.text` and with `GRADE_COLOR[g]` — all six-digit hex. It would
produce `rgba(NaN,NaN,NaN,a)` if handed `HT.border`, which is already an
`rgba()`. It never is.

## Shared inline styles

Declared inside the component body (`GexChangeTop.tsx:747–791`) and referenced
by name below.

- `MONO` = `"var(--font-mono)"` (module constant, line 287)
- `faceStyle` = `classicCardAccentStyle` + `position:absolute · inset:0 ·
  padding:12px 14px · backfaceVisibility:hidden · WebkitBackfaceVisibility:hidden ·
  overflow:hidden`
- `classicCardAccentStyle` = `background HT.panelBg · backdropFilter blur(16px) ·
  WebkitBackdropFilter blur(16px) · borderRadius 18 · border 1px HT.border ·
  boxShadow 0 18px 40px rgba(0,0,0,0.22)`
- `tglStyle(on, cyan=false)` = `MONO · 10px / 700 · letterSpacing .02em ·
  cursor pointer · padding 3px 7px · radius 5` · border `1px solid` →
  `tint(HT.cyan,.4)` when `on && cyan` else `HT.border` · background → `on`:
  `tint(HT.cyan,.12)` if cyan else `tint(HT.text,.08)`; `!on`: `transparent` ·
  colour → `on`: `HT.cyan` if cyan else `HT.text`; `!on`: `HT.text`
- `badgeStyle(side)` — `c = side==="P" ? HT.orange : HT.green` · `MONO · 11px /
  700 · padding 1px 5px · radius 4 · marginLeft 5 · colour c · background
  tint(c,.12) · border 1px tint(c,.4)`
- `lblStyle` = `colour HT.text · 9px · uppercase · letterSpacing .06em · marginRight 3`
- `th` = `textAlign right · padding 6px 8px · 11px / 700 · letterSpacing .06em ·
  uppercase · colour **HT.green** · borderBottom 1px HT.border · whiteSpace nowrap`
- `td` = `textAlign right · padding 6px 8px · MONO · 13px · colour HT.text ·
  borderBottom 1px tint(HT.text,.05) · whiteSpace nowrap`
- `gradeChipStyle(g)` = `inline-flex · alignItems center · gap 3 · MONO · 11px /
  800 · lineHeight 1 · padding 2px 6px · radius 5 · whiteSpace nowrap · colour
  GRADE_COLOR[g] · background tint(GRADE_COLOR[g],.14) · border 1px
  tint(GRADE_COLOR[g],.45)`
- `homeButtonStyle` (imported) = `padding 5px 10px · radius 6 · border 1px
  rgba(33,158,188,.25) · background linear-gradient(180deg,rgba(33,158,188,.12),
  rgba(33,158,188,.04)) · colour HT.cyan · 10px / 700 · letterSpacing .08em ·
  uppercase · cursor pointer`

---

# C.A — Mount, route and tab gating

Source: `scannerNav.ts:49–64, 100–107, 122–150`; `Scanner.tsx:3048–3100`;
`GexChangeTop.tsx:474`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| C1 · Tab pill — "GEX Change Top" | `SCANNER_TABS[1].label` | Full label `"GEX Change Top"`; sub-strip short label `"GEX Δ Top"`; icon `"📊"` | `color: HOME_THEME.orange` — the pill accent for this tab only | Always rendered (not `ownerOnly`) |
| C2 · Default tab | `Scanner.tsx:3056` → `useState<MainTab>("gexchangetop")` | — | This is the FIRST paint of `/scanner` with no `?tab=` (changed 2026-08-21; was `gexlevels`) | Renders immediately; no auth wait |
| C3 · Deep link | `readTabFromUrl()` in a mount effect (`Scanner.tsx:3071–3074`) | `new URLSearchParams(window.location.search).get("tab")`, validated by `isScannerTabId` | Any valid `?tab=` overrides C2 **after** first paint — the default tab renders one frame first. Invalid/absent → stays on `gexchangetop` | Deliberate: reading in an effect keeps the page prerenderable |
| C4 · Owner-gate fallback | `Scanner.tsx:3062–3066` | `ownerGated = OWNER_ONLY_TABS.has(tab) && !isOwner` | When a non-owner lands on `?tab=pickstudy`: `authLoaded` → render `gexchangetop`; `!authLoaded` → render **nothing** (`visibleTab = null`). So this tab is the non-owner's landing pad | Blank beat while auth resolves, then this tab |
| C5 · In-place tab switch | `SCANNER_TAB_EVENT` = `"cb:scanner-tab"` window CustomEvent (`scannerNav.ts:145–150`, `Scanner.tsx:3084–3087`) | Toolbar sub-strip fires it when a pill is clicked while already on `/scanner` | React Router does not remount `ScannerPage` on a bare query-string change, so without the event the URL updates and the view does not. Switching AWAY unmounts `GexChangeTop` entirely — all state (`slots`, `results`, `flipped`, `hist`, `date`) is lost and refetched on return | — |

---

# C.B — Data layer: three endpoints, two polls, four effects

Source: `GexChangeTop.tsx:480–515, 564–576, 606–624, 648–658, 676–694`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| C6 · Slot feed | `GET /proxy/gex-change-top` · `{ cache: "no-store" }` · query `date=<YYYY-MM-DD>` — **param omitted entirely when `d` is falsy**, and the server then defaults to today | Response `{ ok: boolean, error?: string, slots: SlotBucket[], date: string }`. `SlotBucket = { slot, ts, live?, rows: Row[] }` | `!j.ok` → `setErr(j.error \|\| "load failed")` **and** `setSlots([])`; `date` is left at its previous value. `catch` → `setErr(String(e?.message \|\| e))`, slots untouched. **No `AbortController`** — two overlapping loads can resolve out of order and the later-resolving one wins | `setLoading(true)` at call, `false` in `finally`. `loading` only ever surfaces as the subtitle suffix (C45) and the empty-state word (C89) |
| C7 · `Row` shape | `/proxy/gex-change-top → slots[].rows[]` | `slot: string` · `rank: number` · `symbol: string` · `expiry: string` · `strike: number` · `spot: number\|null` · `latest_chg: number\|null` · `pct_open: number\|null` · `z_score: number\|null` · `score: number\|null` · `window_min: number` · `watch_id: number\|null` · `proj_grade?: string\|null` · `proj_pts?: number\|null` · `live?: boolean` | **`z_score` and `window_min` are never rendered anywhere on this tab.** They are on the wire and dropped | — |
| C8 · Scorecard feed | `GET /proxy/gex-change-top-results` · `{ cache: "no-store" }` · query `date=<YYYY-MM-DD>` (omitted when falsy) | Response `{ ok, error?, rows: ResultRow[], frozen: boolean }` | `!j.ok` → `setResErr(j.error \|\| "load failed")` + `setResults([])`; `frozen` **not** reset. `ok` → `setResErr(null)`, `setResults(Array.isArray(j.rows) ? j.rows : [])`, `setFrozen(!!j.frozen)`. `catch` → `setResErr(...)`, results untouched | No loading flag at all — the scorecard has no loading state |
| C9 · `ResultRow` shape | `/proxy/gex-change-top-results → rows[]` | `watch_id` · `symbol` · `expiry` · `strike` · `side: string\|null` · `first_slot: string\|null` · `slots: number\|null` · `best_rank: number\|null` · `score: number\|null` · `entry` · `entry_ts` · `max_mark` · `max_ts` · `max_pct` · `min_mark` · `min_pct` · `close_mark` · `close_ts` · `close_pct` · `samples` · `min_ts?` · `sustained_mark?` · `sustained_pct?` · `sustained_ts?` · `grade?` · `grade_pts?` | **Never rendered:** `best_rank`, `score`, `min_mark`, `close_ts`, `samples`, `min_ts`, `sustained_mark`, `sustained_pct`, `sustained_ts`. Seven fields on the wire with no surface. `sustained_pct` in particular is documented as "the fillable move, as opposed to max_pct's single print" and the UI shows `max_pct` instead | — |
| C10 · Pick history feed | `GET /proxy/gex-change-top-history` · `{ cache: "no-store" }` · `id=<watch_id>` (always) · `date=<day>` (omitted when `day` falsy) | Response `{ ok, points: PickPoint[], contract: PickContract\|null, error? }`. `PickPoint = { ts: number, mark: number\|null, net_gex: number\|null }`. `PickContract = { ticker, expiration, strike, side, added_price }` | `ok` → points **filtered client-side** by `isRth(Number(p.ts))` (C27); `contract: j.contract ?? null`. `!ok` → `{ points: [], contract: null, error: j.error \|\| "no history" }`. `catch` → same shape with `error: String(message)` | `histLoading[watchId] = true` during; `false` in `finally`. Keyed by `watch_id`, so the same contract in several slots shares one fetch and one cache entry |
| C11 · Mount load | `useEffect(() => { load(); }, [load])` (line 564) | Fires once — `load` is `useCallback(…, [])` | Called with **no argument**, so no `date` param goes out and the server picks today | — |
| C12 · Results load — **this is a waterfall** | `useEffect(() => { loadResults(date \|\| undefined); }, [loadResults, date])` (line 565) | Fires on mount with `date === ""` (no param), then AGAIN once C6's response sets `date` | Two `/results` requests on every entry, the second one dependent on the first feed's response. Violates the v3 "route fires everything in parallel at entry" rule | — |
| C13 · 60s poll | `setInterval(…, 60 * 1000)` calling **both** `load(date \|\| undefined)` and `loadResults(date \|\| undefined)` (lines 570–576) | Deps `[load, loadResults, date]` — the interval is torn down and re-armed whenever `date` changes | 60s, not 5 min, deliberately: the recorder's trigger scan files a crossing within a minute and a 5-minute poll put the card on screen up to five minutes stale. **Keeps polling while the tab is hidden** — there is no visibility guard | — |
| C14 · Open-card refresh poll | `setInterval(…, 60_000)` looping `loadPick(id, date)` over `openWatchIds` (lines 648–658) | Deps `[openKey, date, loadPick]`; `openKey = openWatchIds.join(",")` keeps the interval from resetting every render. `exhaustive-deps` disabled on this hook | **Bails entirely when `openWatchIds.length === 0` or `> 8`.** After a "Flip all" there can be ~65 open cards and re-polling all of them would be 65 requests/min; beyond 8 the data loaded on open stands until Refresh | — |
| C15 · `flipAll` fetch waves | `flipAll` (676–694) | `need = [...new Set(flippable.map(f => f.wid))].filter(id => !hist[id])` — only uncached ids. Fired in waves of **6**, each wave `Promise.all`, recursing while `i < need.length` | A second "Flip all" after a flip-back costs zero requests (everything is cached). `flipped` is cleared but `opened` is NOT, so the back faces stay mounted | — |
| C16 · Reduced motion | `window.matchMedia?.("(prefers-reduced-motion: reduce)")` (597–604) | `setReduceMotion(mq.matches)`, live via `change` listener | `reduceMotion` → the flipper's `transition` becomes `"none"` instead of `"transform 0.32s ease-out"`. Nothing else changes | `mq` undefined (old browser) → effect returns early, `reduceMotion` stays `false` |

---

# C.C — Number and time format helpers, written out

Source: `GexChangeTop.tsx:89–138, 269–297`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| C17 · `fmtBig(v)` | line 95 | `a = Math.abs(v)`, `s = v < 0 ? "-" : ""`. `a >= 1e9` → `` `${s}${(a/1e9).toFixed(1)}B` ``; **otherwise always** `` `${s}${(a/1e6).toFixed(1)}M` ``. No `$` sign | **There is no sub-1M branch.** A Δ of 200,000 (exactly the ★ threshold) prints `"0.2M"`; 40,000 prints `"0.0M"`. Sign uses ASCII hyphen `-`, not U+2212 | `v == null` → `"—"` (em dash) |
| C18 · `fmtStrike(v)` | line 101 | `Number.isInteger(v)` → `v.toLocaleString("en-US")` (thousands separator: `5,900`); else `String(v)` (so `5900.5` renders bare, unseparated) | none | Takes `number`, not nullable — never `"—"` |
| C19 · `fmtSpot(v)` | line 102 | `v.toFixed(2)` | none | `v == null \|\| !(v > 0)` → `"—"`. Note `!(v > 0)` also catches `0` and `NaN` |
| C20 · `fmtPx(v)` | line 103 | `Number(v).toFixed(2)` | none | `v == null \|\| !Number.isFinite(v)` → `"—"` |
| C21 · `fmtGex(v)` | line 105 | `sign = v >= 0 ? "+" : "−"` (**U+2212 MINUS SIGN**, not a hyphen). `a >= 1e9` → `` `${sign}$${(a/1e9).toFixed(2)}B` ``; `a >= 1e6` → `` …toFixed(2)}M` ``; else `` `${sign}$${(a/1e3).toFixed(0)}K` `` | Zero takes `"+"`. Used only on the chart's Net GEX y-axis ticks and crosshair readout | `v == null \|\| !Number.isFinite(v)` → `"—"` |
| C22 · `fmtPct(v)` | line 138 | `` `${v >= 0 ? "+" : ""}${v.toFixed(0)}%` `` — zero decimals, `+` prefix on non-negatives, negatives keep `toFixed`'s ASCII `-` | Zero renders `"+0%"` | `v == null \|\| !Number.isFinite(v)` → `"—"` |
| C23 · `slotLabel(slot)` | line 113 | `"HH:MM"` (24h ET) → `` `${hr}:${mStr ?? "00"} ${ampm} ET` ``. `ampm = h >= 12 ? "PM" : "AM"`; `hr = h % 12 === 0 ? 12 : h % 12` | `"00:30"` → `"12:30 AM ET"`; `"12:00"` → `"12:00 PM ET"` | A slot with no `":"` → `mStr` is `undefined` → `"00"` is substituted |
| C24 · `capturedLabel(day, slot)` | line 124 | `` `${MONTHS[m-1]} ${d} · ${slotLabel(slot)}` `` → `"Jul 30 · 10:30 AM ET"`. `MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]`. Separator is U+00B7 | Day must match `/^(\d{4})-(\d{2})-(\d{2})$/` exactly | No match (including `date === ""` before the first response lands) → returns **just the time**, `"10:30 AM ET"`, with no date |
| C25 · `fmtClock(ts)` | line 132 | `new Date(ts).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })` → `"1:42 PM"`. **Pinned to ET**, no zone suffix printed | none | `ts == null \|\| !Number.isFinite(ts)` → `"—"` |
| C26 · `ago(ts)` | line 290 | `s = Math.round((Date.now() - t) / 1000)`. `s < 60` → `` `${s}s ago` ``; `s < 3600` → `` `${Math.round(s/60)}m ago` ``; else `` `${Math.round(s/3600)}h ago` `` | Recomputed only on render — a card left open shows a frozen "42s ago" until something re-renders | `!Number.isFinite(t) \|\| t <= 0` → `"—"` |
| C27 · `isRth(ts)` | line 269 | `Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false })`; `mins = hour*60 + minute` | `weekday === "Sat" \|\| "Sun"` → **false**. Otherwise `mins >= 570 && mins < 960` — i.e. **09:30 inclusive to 16:00 exclusive, ET**. Holidays are NOT excluded | `!Number.isFinite(ts)` → false |

---

# C.D — The grade ladder (the cross-part contract)

Source: `GexChangeTop.tsx:140–228, 255–267`. **This is the section Pick Study
(Part D) reads back. Every boundary below is 1:1 from the code.**

The stated design: 100 points in three parts — **Peak 0–55** (`max_pct`, the
MFE), **Pain 0–25** (`min_pct`, the MAE), **Close 0–20** (`close_pct`). Hard
rule: `max_pct <= 0` is an **F** regardless of the other two, because a pick
that never traded above its flag mark offered no exit at all.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| C28 · `GRADE_ORDER` | line 157 | `["A+", "A", "B", "C", "D", "F"]` | This exact order drives the distribution strip (C68) and validates `proj_grade` / server `grade` strings | — |
| C29 · **Peak ladder** (0–55 pts) | `gradePoints` lines 180–183, on `maxPct` | Ordered boundaries, first match wins: `>= 150` → **55** · `>= 100` → **50** · `>= 50` → **42** · `>= 30` → **33** · `>= 20` → **26** · `>= 10` → **18** · `> 0` → **8** · else → **0** | All `>=` except the last, which is strict `> 0`. `maxPct === 0` scores 0 peak AND trips `neverGreen` | `maxPct == null \|\| !Number.isFinite(maxPct)` → **the whole function returns `null`** and the pick is ungraded |
| C30 · **Pain ladder** (0–25 pts) | lines 186–187, on `m` | `m = (minPct == null \|\| !Number.isFinite(minPct)) ? **-25** : minPct`. Then: `m >= -10` → **25** · `>= -20` → **20** · `>= -30` → **15** · `>= -45` → **9** · `>= -60` → **4** · else → **0** | All `>=`. **The code comment says the missing-MAE default is "half credit"; −25 lands in the `>= -30 → 15` bucket, which is 15/25 = 60%. The code wins — port 15.** | No `min_pct` on file → 15 pts, never `null` |
| C31 · **Close ladder** (0–20 pts) | lines 188–189, on `c` | `c = (closePct == null \|\| !Number.isFinite(closePct)) ? null : closePct`. Then: `c == null` → **8** · `c >= 50` → **20** · `>= 20` → **16** · `>= 0` → **11** · `>= -20` → **6** · `>= -50` → **2** · else → **0** | All `>=`. `close_pct === 0` scores 11, not 8 — the null default (8) sits BETWEEN the `>= -20` (6) and `>= 0` (11) buckets | No `close_pct` → 8 pts |
| C32 · `gradePoints` total | line 190 | `peak + pain + close`, integer 0–100 | Max 55+25+20 = 100. Min for a green pick: 8+0+0 = **8** | Returns `null` only when `max_pct` is null/non-finite |
| C33 · **Letter ladder** (local fallback path) | `gradeFor` lines 212–215 | `neverGreen = !(Number(r.max_pct) > 0)`. `grade = neverGreen ? "F" : pts >= 85 ? "A+" : pts >= 72 ? "A" : pts >= 58 ? "B" : pts >= 44 ? "C" : pts >= 28 ? "D" : "F"` | Ordered boundaries: **A+ ≥ 85 · A ≥ 72 · B ≥ 58 · C ≥ 44 · D ≥ 28 · F < 28**, all `>=`, **and F unconditionally when `max_pct <= 0` or is non-numeric**. A green pick scoring 8–27 is also F | `gradePoints` null → `gradeFor` returns `null` and no pill renders |
| C34 · **Server grade path** (preferred) | `gradeFor` lines 199–209 | Taken when `r.grade` is truthy **and** `GRADE_ORDER.includes(r.grade)`. Returns `{ grade: r.grade, pts: Number.isFinite(Number(r.grade_pts)) ? Number(r.grade_pts) : 0, neverGreen: !(Number(r.max_pct) > 0), why }` | **The never-green override is NOT applied on this path.** A server row with `grade: "B"` and `max_pct <= 0` renders **B**, while `neverGreen: true` still feeds the "never green" counter (C70). The two halves of the screen disagree by construction. Server is source of truth: `server-v2/_lib-pick-grade.cjs` | Unparseable `grade_pts` → `pts: 0`, so it drags the GPA (C69) down without changing the letter |
| C35 · `why` string — server path | line 207 | `` `${p}/100 · peak {fmtPct(max_pct)} · low {fmtPct(min_pct)} · close {fmtPct(close_pct)}` `` — the `"N/100 · "` prefix is omitted when `grade_pts` is not finite | Never carries the "Never traded green" wording, even when `neverGreen` is true | — |
| C36 · `why` string — local path | lines 216–218 | `neverGreen` → `` `Never traded green. Peak {…} · low {…} · close {…} — no exit was ever on offer.` ``; else `` `${pts}/100 · peak {…} · low {…} · close {…}` `` | Note the capital `Peak` in the never-green variant vs lowercase `peak` in the other two | — |
| C37 · `GRADE_COLOR` | lines 159–166 | `A+` → `HT.green` · `A` → `HT.green` · `B` → `HT.cyan` · `C` → `HT.orange` · `D` → `HT.orange` · `F` → `HT.red` | **A six-step ladder painted with four colours.** A+ and A are the same value; C and D are the same value. Colour alone cannot separate them | — |
| C38 · `GRADE_NOTE` (tooltip text, verbatim) | lines 168–175 | `A+`: `"85-100 pts — a big gain was on offer, it was cheap to hold, and it finished well."` · `A`: `"72-84 pts — a real move (roughly +50% or better) without punishing heat."` · `B`: `"58-71 pts — a tradable pop, or a bigger one that took real drawdown first."` · `C`: `"44-57 pts — small gain on offer, or a decent peak paid for with heat."` · `D`: `"28-43 pts — barely ticked green before it rolled."` · `F`: `"Under 28 pts, or never traded green at all — no exit was ever on offer."` | Hyphens in the ranges are ASCII `-`; the clause separators are em dashes | Shown as the first line of every `GradePill` `title=` and as the whole `title=` of every distribution chip |
| C39 · `<GradePill>` | lines 256–267 | `gradeChipStyle(info.grade)` with `fontSize = size` (prop, default **11**) and `padding = size >= 13 ? "3px 8px" : "2px 6px"`. Content: the letter, then — when `provisional` — a `<span style={{ fontWeight: 600, opacity: 0.7 }}>·</span>` | `title` = `` `${GRADE_NOTE[grade]}\n${info.why}` `` + when provisional `` `\nProvisional — the session is still live, so peak/close can still move.` ``. `provisional` is passed as `!frozen` at **all three** call sites | `info == null` → **renders nothing** (no placeholder, no dash) |
| C40 · `<ProjPill>` — the PROJECTED grade | lines 236–253 | `inline-flex · gap 2 · MONO · 10px / 700 · lineHeight 1 · padding 2px 5px · radius 5 · nowrap · colour tint(GRADE_COLOR[g], 0.85) · background transparent · **border 1px dashed** tint(GRADE_COLOR[g], 0.5)`. Content: `<span style={{opacity:.7, fontWeight:600}}>proj</span>` then the **raw** `grade` string | `g = GRADE_ORDER.includes(grade) ? grade : "C"` — an unrecognised grade string is COLOURED as C but its raw text is still printed. Drawn hollow + dashed + prefixed on purpose: a prediction must never read like a result at a glance | `!grade` → **renders nothing**. This is the shipping default: `proj_grade` is null whenever no rule is armed (`server-v2/config/pick-proj-rule.json`) |
| C41 · ProjPill tooltip (verbatim) | line 241 | `` `Projected ${grade}${pts == null ? "" : ` (${pts}/100)`} at capture, from the rule in server-v2/config/pick-proj-rule.json. This is a prediction made before the pick did anything — compare it against the solid grade pill, and against the Pick Study tab's calibration table.` `` | Names Part D explicitly | — |

---

# C.E — Card frame and toolbar

Source: `GexChangeTop.tsx:812–866`; `PageCard.tsx:84–145`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| C42 · Screenshot root | `<div ref={cardRef}>` wrapping the whole `<Card>` (line 813) | No styles of its own | The full-page ⧉/📷 buttons capture **from here down**, so the PNG includes the Card plate, its title and subtitle, the scorecard and every slot section | — |
| C43 · Card plate | `<Card variant="budget">` → `classicCardAccentStyle`, `padding: 24`, `className="card-hover"` | `background HT.panelBg · blur(16px) · radius 18 · border 1px HT.border · boxShadow 0 18px 40px rgba(0,0,0,0.22)` | `variant="budget"` and `"gloss"` resolve to the same surface. The `accent` prop is **dead** (`PageCard.tsx:86–87` — accepted and ignored). `.card-hover` adds a transform on hover from a global stylesheet not present in this checkout | Always renders |
| C44 · Card title | `<span style={{ fontSize: 17 }}>GEX Change · Hourly Top 5</span>` | The wrapper div is `14px / 800 · letterSpacing .12em · uppercase · colour HT.text`; the inner span overrides only the size to **17px** and inherits the weight, tracking and uppercasing. Separator is U+00B7 | none | Always renders |
| C45 · Card subtitle | Template string, line 817 | `` `★ Very strong picks (\|Δ\| ≥ $200k & \|% vs open\| ≥ 30%), ranked by score · captured every 30 min during RTH` `` + `loading ? " · refreshing…" : ""`. `12px`, colour **`HT.green` = `#8ECAE6`** | The `" · refreshing…"` suffix (single `…` glyph) is the ONLY loading affordance while data already exists on screen | Always renders |
| C46 · Toolbar row | `<div data-noshot="1">` (line 819) | `flex · alignItems center · gap 10 · marginBottom 12 · flexWrap wrap` | **`data-noshot="1"` means `lib/snapshot.ts:1191` removes this entire row from every capture** — the date picker, Refresh, Flip all, the hint and both capture buttons are absent from every PNG | Always renders |
| C47 · Date picker | `<input type="date" value={date}>` | `homeButtonStyle` + `padding 6px 10px · fontSize 13 · colorScheme "dark"` | `onChange`: `setDate(v)` → `setFlipped({})` → `setOpened({})` → `load(v \|\| undefined)` → `loadResults(v \|\| undefined)`. **All flip state is discarded on a date change**, `hist` is NOT (it stays cached keyed by `watch_id`) | `date === ""` on first paint until C6's response lands, so the native control shows its blank `mm/dd/yyyy` for a beat |
| C48 · "Refresh" | `<button>` | `homeButtonStyle` + `padding 6px 12px · fontSize 13` — so `10px / 700 · letterSpacing .08em · uppercase` is overridden to 13px but stays 700/uppercase/tracked | `onClick`: `load(date \|\| undefined)` + `loadResults(date \|\| undefined)`. Never disabled, even mid-load | — |
| C49 · "⟳ Flip all (N)" / "⟲ Flip back" | `<button onClick={flipAll}>` | Idle label `` `⟳ Flip all${flippable.length ? ` (${flippable.length})` : ""}` ``; when `allFlipped` the label is `"⟲ Flip back"`. `homeButtonStyle` + `padding 6px 12px · fontSize 13` | `disabled = !flippable.length`; `opacity 1 / 0.5`; `cursor pointer / default`. When `allFlipped`: `borderColor tint(HT.cyan,.5)`, `colour HT.cyan`, `background tint(HT.cyan,.12)`; otherwise `HT.border` / `HT.text` / `homeButtonStyle.background`. `allFlipped = flippable.length > 0 && flippable.every(f => flipped[f.cid])` | `title` = `allFlipped ? "Turn every card back to the pick" : "Turn every probed card over to its price line"`. `flippable` counts only rows with a non-null `watch_id` |
| C50 · Toolbar hint | Static string | `"click a card for its option price line"` — `12px`, colour `HT.text` | none | Always renders |
| C51 · "⧉ Copy image" | `<button onClick={() => capture("copy")}>` | Label `"⧉ Copy image"`, `"Copying…"` while busy. `homeButtonStyle` + `padding 6px 12px · fontSize 13 · opacity shooting ? 0.6 : 1` | `disabled = shooting !== null` (either button busy disables both). `capture()` → `captureToBlob(cardRef.current)` with **no options** → un-framed, no title band, background `SNAP_BG = HT.bg`, `scale = min(2, devicePixelRatio)`, `allowTaint` default true → `copyOrDownload(blob, fname)`; clipboard first, silent fallback to a download | Failure is swallowed by a bare `catch {}` — the button just resets to idle with **no error shown anywhere** |
| C52 · "📷 Screenshot" | `<button onClick={() => capture("download")}>` | Label `"📷 Screenshot"`, `"Saving…"` while busy. Same base style **plus** `borderColor: HT.orange`, `color: HT.orange` | Same disable rule. `downloadBlob(blob, fname)` — no clipboard attempt | Same silent failure |
| C53 · Capture filename | `capture()` line 714 | `` `gex-change-top-${date \|\| "today"}.png` `` | `date` is `""` only before the first response, so `"today"` is effectively unreachable after load | — |

---

# C.F — Scorecard header and summary line

Source: `GexChangeTop.tsx:872–914`; derived values `795–810`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| C54 · "Scorecard" | Static | `fontWeight 800 · fontSize 15 · colour HT.orange` | none | Always renders — even when `results` is empty and `showResults` is false |
| C55 · Freshness pill — "EOD · final" / "live · peak so far" | `frozen` from `/results → j.frozen` | `tglStyle(true)` + `cursor: "default"` + `fontSize: 9` (overriding tglStyle's 10) → `border 1px HT.border · background tint(HT.text,.08) · colour HT.text · MONO · 700 · letterSpacing .02em · padding 3px 7px · radius 5` | `frozen` → `"EOD · final"`; else `"live · peak so far"`. It is not a button — no click handler, cursor forced to default | `frozen` defaults to `false`, so a failed `/results` load shows "live · peak so far" |
| C56 · Filter basis — `filteredResults` | line 795 | `results.filter(r => r.entry != null && (scoreCheap || r.entry > ENTRY_FLOOR))` | `ENTRY_FLOOR = 0.5` (line 67). Default filter is **strict `>`**, so an entry of exactly `$0.50` is **excluded**. A row with `entry == null` is dropped in **both** modes | — |
| C57 · Summary line — pick count | `filteredResults.length`, only rendered when `> 0` | `` `${n} pick${n === 1 ? "" : "s"}` `` then `` ` (${scoreCheap ? "all entries" : `entry > $${ENTRY_FLOOR.toFixed(2)}`})` `` → `"(entry > $0.50)"`. `12px`, colour `HT.text` | none | The whole summary span is omitted when `filteredResults.length === 0` |
| C58 · Summary — "avg peak" | `avgPeak = withPeak.length ? sum(max_pct)/withPeak.length : null`, where `withPeak = filteredResults.filter(r => r.max_pct != null)` | `fmtPct(avgPeak)` inside `<b>` | Colour: `avgPeak != null && avgPeak >= 0` → `HT.green`; otherwise `HT.red`. **`null` is painted red**, and then prints `"—"` | `withPeak.length === 0` → `"—"` in red |
| C59 · Summary — "≥+25%" | `hit(25)` = `withPeak.filter(r => r.max_pct >= 25).length` | Integer in `<b style={{ color: HT.text }}>` | `>=`, inclusive. Denominator is `withPeak`, not `filteredResults` — a pick with no `max_pct` is in neither numerator nor denominator | `0` renders as `0`, never blank |
| C60 · Summary — "≥+50%" | `hit(50)` | as C59 | `>= 50` | as C59 |
| C61 · Summary — "≥+100%" | `hit(100)` | as C59 | `>= 100` | as C59 |
| C62 · Summary — "closed green" | `greenClose = filteredResults.filter(r => r.close_pct != null && r.close_pct > 0).length` | as C59 | **Strict `> 0`** — a flat close (`0`) does NOT count as green, unlike the close ladder (C31) where `>= 0` scores 11 pts. Denominator here is `filteredResults`, not `withPeak` | as C59 |
| C63 · Cheap-entry toggle | `<button data-noshot="1" onClick={() => setScoreCheap(s => !s)}>` — rendered only when `cheapCards > 0 \|\| scoreCheap` | Off label: `` `score ≤ $${ENTRY_FLOOR.toFixed(2)} too (${cheapCards})` `` → `"score ≤ $0.50 too (3)"`. On label: `` `exclude ≤ $${ENTRY_FLOOR.toFixed(2)}` `` → `"exclude ≤ $0.50"`. `homeButtonStyle` + `padding 4px 10px · fontSize 11` | On: `borderColor tint(HT.orange,.5)`, `colour HT.orange`, `background tint(HT.orange,.12)`. Off: `HT.border` / `HT.text` / `homeButtonStyle.background`. Persists to **nothing** — component state only, reset on tab switch | `title` = `` `${cheapCards} card${cheapCards === 1 ? "" : "s"} on this date entered at $0.50 or less. Their % moves are tick-size artifacts, so they are left out of the ranking and the averages by default.` `` |
| C64 · `cheapIds` / `cheapCards` | lines 537–541, 557–562 | `cheapIds = new Set(results.filter(r => r.entry != null && r.entry <= ENTRY_FLOOR).map(r => r.watch_id))` — note `<=`, the exact complement of C56's `>`. `cheapCards` = count of **rows inside `slots`** whose `watch_id` is in `cheapIds` | So `cheapCards` counts CARDS on screen, not scorecard rows. If `/results` has sub-floor rows but `slots` is empty for that date, `cheapCards === 0` and the toggle never renders | `cheapIds.size === 0` → short-circuits to `0` |
| C65 · "Hide" / "Show" | `<button data-noshot="1" onClick={() => setShowResults(s => !s)}>` | `homeButtonStyle` + `padding 4px 10px · fontSize 11`. Label `showResults ? "Hide" : "Show"` | Default `showResults = true` (line 501). Hiding suppresses the grades strip (C66–C70), the empty state (C72) and the table (C73–C87). It does **not** suppress the "Scorecard" title, the freshness pill, the summary line, the toggles, or the error line | Persists to nothing |

---

# C.G — Grade distribution strip

Source: `GexChangeTop.tsx:916–935`. Gate: `showResults && !resErr && graded.length > 0`.

`graded = filteredResults.map(gradeFor).filter(g => g != null)` (lines 804–806).

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| C66 · Strip container | — | `flex · alignItems center · gap 6 · flexWrap wrap · marginBottom 10` | Hidden entirely when `graded.length === 0` (all rows ungraded), when `resErr` is set, or when `showResults` is false | — |
| C67 · "Grades" label | Static | `fontSize 12 · colour HT.text` | none | — |
| C68 · Six grade chips | `GRADE_ORDER.map(g => …)` — **A+, A, B, C, D, F in that fixed order** | `gradeChipStyle(g)` + `opacity: gradeCount(g) ? 1 : 0.3`. Content: the letter, then `<b style={{ marginLeft: 2 }}>{count}</b>` | `gradeCount(g) = graded.filter(x => x.grade === g).length`. A zero-count grade still renders, at **0.3 opacity**. `title` = `GRADE_NOTE[g]` (C38) verbatim | Six chips always, never fewer |
| C69 · "avg N/100" | `gpa = graded.length ? sum(x.pts)/graded.length : null` | `` `${gpa.toFixed(0)}/100` `` in `<b style={{ color: HT.cyan, fontFamily: MONO }}>`; the word `avg` is `12px` `HT.text` | Averages `pts` across **both** the server-graded and locally-graded rows in one number. A server row with unparseable `grade_pts` contributes `0` (C34) | `gpa == null` → `"—"` — **unreachable**, the block is gated on `graded.length > 0` |
| C70 · "never green N (P%)" | `neverGreen = graded.filter(g => g.neverGreen).length`; `neverGreenPct = graded.length ? (neverGreen/graded.length)*100 : null` | `` `${neverGreen}${neverGreenPct != null ? ` (${neverGreenPct.toFixed(0)}%)` : ""}` `` in `<b style={{ fontFamily: MONO }}>` | Colour: `neverGreen` truthy → `HT.red`; **`0` → `HT.green`**. `neverGreen` is `!(Number(max_pct) > 0)` on BOTH grade paths, so a server-graded "B" with `max_pct <= 0` is counted here while still showing a B pill (C34) | `title` = `"Picks whose best post-flag mark never printed above the entry — they went straight to red and stayed there."` |

---

# C.H — Scorecard table

Source: `GexChangeTop.tsx:937–1009`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| C71 · Scorecard error line | `resErr` | `` `Scorecard error: ${resErr}` `` — `fontSize 13 · colour HT.red · padding 4px 0` | Rendered whenever `resErr` is truthy, **regardless of `showResults`** — it is outside that gate. When set, the grades strip, empty state and table are all suppressed | The last-good `results` array is still in state but nothing renders it |
| C72 · Scorecard empty state | `showResults && !resErr && filteredResults.length === 0` | `colour HT.text · fontSize 13 · padding 8px 4px` | `results.length === 0` → `"No scored picks for this date yet — rows appear once picks have been auto-probed and snapshots start landing."` · otherwise → `` `No picks above the $0.50 entry floor for this date — use “show ≤ $0.50” above to include them.` `` (curly quotes U+201C/U+201D) | **The second string names a button that does not exist**: the toggle reads `"score ≤ $0.50 too (N)"` (C63), and it only renders when `cheapCards > 0 \|\| scoreCheap`. Fix the string in the port |
| C73 · Table wrapper + sort | `<div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>` | Rows are `filteredResults.map(…)` in **array order** | **There is no client-side sort. No sort key, no default sort column, no direction, no comparator, no tie-break, no header click handlers.** Row order is whatever `/proxy/gex-change-top-results → j.rows` returns. `key = `${r.watch_id}-${r.first_slot}`` | — |
| C74 · Col 1 header — "Grade" | `th` + `textAlign: "left"` | `11px / 700 · letterSpacing .06em · uppercase · colour HT.green · borderBottom 1px HT.border · nowrap · padding 6px 8px` | Same `th` for all 12 headers; only `textAlign` varies | — |
| C75 · Col 1 cell — grade pill | `<GradePill info={gradeFor(r)} provisional={!frozen} />` | `td` + `textAlign: "left"`; pill at default `size = 11`, `padding 2px 6px` | `provisional = !frozen` adds the `·` suffix and the extra tooltip line while the session is live | `gradeFor(r) == null` → **empty cell**, no dash |
| C76 · Col 2 — "Symbol" | `r.symbol` | `td` + `textAlign left · fontWeight 800` (MONO 13px) | none | Renders whatever the server sends; no fallback |
| C77 · Col 3 — "Contract" | `` `${fmtStrike(r.strike)}${r.side ?? ""} ` `` + `<span style={{ color: HT.text }}>{r.expiry}</span>` | `td` + `textAlign left`, cell colour `sideC` | `sideC = r.side === "P" ? HT.orange : HT.green` — so `null`, `"C"`, and any other value all paint `HT.green`. The expiry span overrides back to `HT.text` | `r.side == null` → the letter is omitted (`?? ""`) but the cell is still call-coloured |
| C78 · Col 4 — "Flagged" | `r.first_slot` → `slotLabel(first_slot).replace(" ET", "")` | `td` + `textAlign left · colour HT.text`. `"10:30 AM"` — the `" ET"` suffix is stripped, so the zone is unlabelled here | `r.slots != null && r.slots > 1` appends `` ` ×${r.slots}` `` in a span **also** `HT.text` — the multiplier is not visually distinguished | `first_slot == null` → `"—"` (the `×N` suffix can still follow it) |
| C79 · Col 5 — "Entry" | `fmtPx(r.entry)` | `td` (right, MONO 13, `HT.text`) — 2 dp, no `$` | none | `"—"` |
| C80 · Col 6 — "Peak" | `fmtPx(r.max_mark)` | as C79 | none | `"—"` |
| C81 · Col 7 — "Peak at" | `fmtClock(r.max_ts)` | `td` + `textAlign left · colour HT.text` → `"1:42 PM"`, ET, no zone suffix | none | `"—"` |
| C82 · Col 8 — "Peak %" | `fmtPct(r.max_pct)` | `td` + `fontWeight 800` | Colour: `max_pct == null` → `HT.text`; `>= 0` → `HT.green`; else `HT.red`. **`0` is painted green** (`>=`) even though it is a never-green pick by C33's rule | `"—"` in `HT.text` |
| C83 · Col 9 — "$/ct" | `peakDollars = (r.entry != null && r.max_mark != null) ? (r.max_mark - r.entry) * 100 : null` | `` `${peakDollars >= 0 ? "+" : "−"}$${Math.abs(peakDollars).toFixed(0)}` `` — **U+2212** for negative, zero decimals, `×100` for one contract | `td` + `colour HT.text` — **never coloured by sign**, unlike Peak % beside it | `null` → `"—"` |
| C84 · Col 10 — "Close" | `fmtPx(r.close_mark)` | as C79 | none | `"—"` |
| C85 · Col 11 — "Close %" | `fmtPct(r.close_pct)` | `td`, normal weight (not 800, unlike Peak %) | Colour: `null` → `HT.text`; `>= 0` → `HT.green`; else `HT.red`. `0` paints green here, while C62's "closed green" counter requires `> 0` | `"—"` in `HT.text` |
| C86 · Col 12 — "Low %" | `fmtPct(r.min_pct)` | `td` + `colour HT.text` | **Never coloured.** A −60% MAE is the same white as a −2% one, even though it is the pain ladder's whole input | `"—"` |
| C87 · Table footnote | Static string, line 1003 | `"Entry = the auto-probe mark at the slot the strike was first flagged. Peak / Low / Close are measured from that entry, over snapshots taken after it — the best exit that was actually on offer, not a fill."` — `marginTop 6 · fontSize 11 · colour HT.text` | none | Rendered only inside the table branch, so it disappears with the empty state |

---

# C.I — Page error, empty state and slot sections

Source: `GexChangeTop.tsx:1012–1041, 1370–1374`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| C88 · Feed error line | `err` | `` `Error: ${err}` `` — `colour HT.red · fontSize 13 · padding 8px 0` | Rendered whenever `err` is truthy, **including while `loading` is true** (no `!loading` guard). Suppresses C89 | Text is either `j.error`, the literal `"load failed"`, or `String(e.message)` |
| C89 · No-slots state | `!err && slots.length === 0` | `colour HT.text · fontSize 14 · padding 16px 4px` | `loading` → `"Loading…"` (single `…`); otherwise → `"No very-strong picks recorded yet for this date. The recorder files a strike the minute it crosses into ★ Very strong, and captures the top 5 every 30 min during RTH."` | This is also the first-paint state, for the ~1 network round trip before C6 resolves |
| C90 · Slot section | `slots.map(hb => …)`, `key = hb.slot`, `marginBottom 22` | Rendered in **server array order** — the file header comments "most recent first", but nothing in the client sorts or reverses. There is no client comparator | none | An empty `hb.rows` renders a header and an empty grid |
| C91 · Slot header row | `<div data-noshot="1">` | `flex · alignItems baseline · gap 10 · marginBottom 10` | **`data-noshot="1"` — the slot headers are stripped from every screenshot.** That is exactly why each card carries its own `capturedLabel` stamp (C116) | — |
| C92 · Slot time | `slotLabel(hb.slot)` | `fontWeight 800 · fontSize 15` → `"10:30 AM ET"` | Colour: `hb.live` → `HT.cyan`; otherwise `HT.orange` | — |
| C93 · "⚡ LIVE TRIGGER" badge | Rendered when `hb.live` — true only when **every** row in the bucket was trigger-written (type comment, line 53) | `fontSize 10 · fontWeight 800 · letterSpacing .06em · padding 1px 6px · radius 4 · colour HT.cyan · background tint(HT.cyan,.12) · border 1px tint(HT.cyan,.45)` | `title` = `"Filed the minute this strike crossed into ★ Very strong, by the recorder's 60s trigger scan — not a scheduled top-5 capture."` A live section is a **crossing**, not a leaderboard: it usually holds one or two cards, and the badge is what stops that reading as four missing picks | Absent when `hb.live` is falsy |
| C94 · Pick count | `hb.rows.length` | `` `${n} pick${n === 1 ? "" : "s"}` `` — `colour HT.text · fontSize 12` | none | `0 picks` if the bucket is empty |
| C95 · Card grid | `<div className="gct-grid">` | `display grid · gridTemplateColumns repeat(5, 1fr) · gap 12` | Breakpoints from an inline `<style>` block re-emitted on every render (line 1370): `max-width 1100px` → `repeat(3, 1fr) !important`; `max-width 720px` → `repeat(2, 1fr) !important`; `max-width 460px` → `1fr !important` | — |

---

# C.J — Pick card: derived values and front face

Source: `GexChangeTop.tsx:1042–1248`. Every card is one `Row` from one
`SlotBucket`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| C96 · `cid` — the flip/shot key | `` `${r.symbol}-${r.strike}-${hb.slot}` `` (line 1046) | — | **Omits `expiry`**, while the React `key` (line 1132) is `` `${r.symbol}-${r.expiry}-${r.strike}` ``. Two different expiries on the same symbol+strike inside one slot would share flip state, `opened` state and 📷 state | — |
| C97 · `side` | `r.spot != null && r.spot > 0 && r.strike < r.spot ? "P" : "C"` (line 1053) | — | Strike **below** spot ⇒ put. `spot` null/zero ⇒ `"C"`. This is derived on the card; the scorecard table uses the server's `r.side` instead (C77), so the two can disagree for the same contract | — |
| C98 · `entry` — the entry basis | `entryById.get(wid) ?? h?.contract?.added_price ?? null` (lines 1075–1078) | `entryById` is built from `/results` rows with `entry != null`, keyed by `watch_id` | **Deliberate three-step fallback.** `watch_options.added_price` is write-once at a contract's FIRST-EVER probe, so a re-flagged strike carried a stale basis from an earlier day (the documented PLTR 250814 180C case: a 1.72 basis on a session that never traded above ~1.00, printing −80% on a 10:30 AM card). `computeResults()` anchors `entry` to the first snapshot at/after the slot the pick was first flagged that day, and that is what `entryById` carries. `added_price` survives only for a pick the scorecard has no row for | Both null → `entry = null` → `fmtPx` → `"—"`, and `pnlPct` / `peakPct` fallback / `peakDollars` all become null |
| C99 · `peakMark` / `peakTs` | `res?.max_mark ?? null` / `res?.max_ts ?? null`; when `peakMark == null`, a scan over the charted `pts` (lines 1104–1112) | Fallback loop: skip `p.mark == null \|\| !finite`; **skip any `p.ts < entryTs`** when `entryTs != null` — never count a mark from before the flag; keep the running max | The scorecard is the source of truth; the loop exists only for a pick with no `/results` row yet (freshly triggered, results not loaded) so a brand-new live card still says something | Both paths empty → `peakMark = null` → `"—"` |
| C100 · `peakPct` | `res?.max_pct ?? ((entry != null && entry !== 0 && peakMark != null) ? ((peakMark - entry)/entry)*100 : null)` | Percent, sign preserved | `entry === 0` is guarded, so no division by zero | `null` → headline `"—"` |
| C101 · `peakDollars` (card) | `(entry != null && peakMark != null) ? (peakMark - entry) * 100 : null` | Dollars per contract | Note the card computes this from `peakMark` (which may be the client fallback), while the table's `$/ct` (C83) uses `r.max_mark` strictly | `null` → the `· ±$N/ct` clause is omitted entirely |
| C102 · `peakColor` | `peakPct == null ? HT.text : peakPct > 0 ? HT.green : HT.red` | — | **Strict `> 0`** here, so a `0` peak paints RED on the card — while the table's Peak % (C82) uses `>= 0` and paints the same value GREEN. Two boundaries for one semantic | — |
| C103 · `lastMark` / `lastTs` | `[...pts].reverse().find(p => p.mark != null)?.mark`; `[...pts].reverse().find(p => Number.isFinite(p.ts))?.ts` | Two independent reverse scans — the timestamp can come from a **later** point than the mark | `pts` is the RTH-filtered history, so "now" means "last RTH snapshot", not wall-clock now | Both `null` when the card is not flipped or has no history |
| C104 · `pnlPct` / `pnlColor` | `(entry != null && entry !== 0 && lastMark != null) ? ((lastMark - entry)/entry)*100 : null`; colour `null → HT.text`, `> 0 → HT.green`, `< 0 → HT.red`, `=== 0 → HT.text` | — | Zero is explicitly neutral here (a third boundary convention on the same tab) | `null` → the `· ±N%` clause is omitted |
| C105 · `trigLabel` | `entryTs != null ? fmtClock(entryTs) : slotLabel(hb.slot).replace(" ET", "")` | `"1:42 PM"` or `"10:30 AM"` | `entryTs = res?.entry_ts ?? null`. For a live card the slot IS the minute it crossed, so the fallback is meaningful | — |
| C106 · `underFloor` | `wid != null && cheapIds.has(wid)` | — | Legacy slots only. The recorder now enforces the floor at CAPTURE (probes down the ranked list, keeps the first five that clear `$0.50`), so from that date on nothing needs marking. Older dates cannot be repaired — rank 6 was never recorded, so dropping a cheap card would leave the hour with four | A pick never auto-probed (`wid == null`) has no entry to judge and is never marked |
| C107 · Card tile | `<div data-card="1">` (line 1131) | `position relative · minHeight **260** · perspective 1200` | `cursor = wid == null ? "default" : "pointer"`. **`opacity = underFloor ? 0.62 : 1`** — present but discounted. `minHeight 260` is sized for the taller (back) face so flipping never reflows the grid | `title` = `wid == null ? undefined : isFlipped ? "Back to the pick" : `Chart ${symbol} ${fmtStrike(strike)}${side}`` |
| C108 · Flipper | `<div data-flip3d={isFlipped ? "back" : "front"}>` | `position absolute · inset 0 · transformStyle preserve-3d · transform rotateY(180deg)/rotateY(0deg)` | `transition = reduceMotion ? "none" : "transform 0.32s ease-out"`. `willChange = hasBack ? "transform" : undefined` — set only on tiles actually opened, so ~65 tiles are not promoted to layers for nothing. `data-flip3d` is read by `lib/snapshot.ts:477–495` to drop the hidden face in the capture clone (html2canvas has no 3D pipeline and would otherwise paint both faces stacked, the back one mirrored) | Must stay `absolute + inset 0`: both faces are absolutely positioned against it, so in normal flow it has no height and the tile collapses |
| C109 · Front — 📷 button | `<button data-noshot="1">` (1176–1194) | `absolute top 6 right 6 · radius 6 · fontSize 12 · lineHeight 1 · fontWeight 700 · padding 3px 6px · inline-flex · gap 4`. Labels: idle `"📷"` · busy `"…"` · `"✓ Copied"` · `"✓ Saved"` | Border: `st` busy → `1px tint(HT.text,.2)`; `st` done → `1px HT.green`; idle → `1px transparent`. Background: `st && st !== "busy"` → `tint(HT.bg,.35)`; else transparent. Colour: busy → `HT.text`; done → `HT.green`; idle → `HT.text`. `disabled` while busy | `title` = `"Screenshot / copy this card"`. `onClick` stops propagation (so it does not flip the card) and calls `shotCard(closest("[data-card]"), cid, `${symbol}-${strike}-${slot without ":"}`)` |
| C110 · `shotCard` lifecycle | lines 730–740 | `captureAndCopy(node, `${name}.png`)` → clipboard, silent fallback to download. Result `"copied"` or `"saved"` held **1800 ms** then deleted | Guard: no-op if `cardState[id] === "busy"` | `catch` → the state entry is deleted immediately. **There is no error glyph** — a failed card capture is indistinguishable from never having clicked |
| C111 · Front — rank + symbol | `r.rank` and `r.symbol` | Header row `flex · alignItems baseline · space-between · marginBottom 4 · paddingRight 18`. Left span `fontWeight 800 · fontSize 17 · colour HT.text`, with the rank in an inner span `colour HT.text · marginRight 6` | The rank is the same colour and only differs by the 6px gap — it reads as part of the ticker | `rank` is non-nullable in `Row` |
| C112 · Front — strike (top right) | `fmtStrike(r.strike)` | `fontSize 14 · colour HT.text` | none | — |
| C113 · Front — Δ headline | `fmtBig(r.latest_chg)` | `fontSize 20 · fontWeight 800 · lineHeight 1.2` → `"-8.6M"` | `up = (r.latest_chg ?? 0) >= 0`; `col = up ? HT.green : HT.red`. **`latest_chg == null` coalesces to `0` ⇒ `up = true` ⇒ the em dash is painted light-blue** | `null` → `"—"`, in green |
| C114 · Front — grade pill | `<GradePill info={grade} provisional={!frozen} size={13} />` | `size 13` ⇒ `padding "3px 8px"` (the larger variant) | `grade = gradeFor(resultById.get(wid))` — the SAME scorecard row the entry basis came from, so card and table cannot disagree | `wid == null` or no result row → nothing renders, and the Δ row's `space-between` lets the Δ take the width |
| C115 · Front — expiry + spot | `` `${r.expiry} · spot ${fmtSpot(r.spot)}` `` | `fontSize 14 · colour HT.text · marginTop 4` | none | Spot null/≤0 → `"spot —"` |
| C116 · Front — capture stamp | `` `captured ${capturedLabel(date, hb.slot)}` `` | `fontSize 12 · colour HT.text · marginTop 2` → `"captured Jul 30 · 10:30 AM ET"` | Exists **because** the slot header above is `data-noshot` (C91) — a single-card screenshot has to carry its own capture time | `date === ""` → just `"captured 10:30 AM ET"` |
| C117 · Front — OTM % | `otmPct = (r.spot && r.spot > 0) ? (Math.abs(r.strike - r.spot)/r.spot)*100 : null` | `` `OTM ${otmPct.toFixed(1)}%` `` — 1 dp, `colour HT.orange` | Unsigned: a strike above or below spot both read "OTM" | `otmPct == null` → **the span is omitted entirely**, and the flex row closes up |
| C118 · Front — % vs open | `r.pct_open` | `` `${pct_open >= 0 ? "+" : ""}${pct_open.toFixed(0)}% vs open` `` — zero decimals, `fontSize 14` | Colour: `null` → `HT.text`; `>= 0` → `HT.green`; else `HT.red` | `null` → `"—"` in `HT.text` (the span still renders) |
| C119 · Front — score | `r.score` | `` `score ${r.score.toFixed(0)}` `` — `colour HT.cyan · fontSize 14` | Server-computed. Definition given in the footer legend (C154) | `null` → `"score —"` |
| C120 · Front — proj pill | `<ProjPill grade={r.proj_grade} pts={r.proj_pts} />` | See C40–C41 | Renders nothing when `proj_grade` is null, which the type comment calls "the shipping default" | — |
| C121 · Front — "★ Very strong" | Static string | `marginTop 6 · fontSize 14 · fontWeight 800 · colour HT.orange · paddingRight 78` — the right padding clears the logo (C124) | Every card on this tab carries it; there is no other tier. The rule it names is enforced server-side | — |
| C122 · Front — "≤ $0.50 · unscored" badge | Rendered when `underFloor` (C106) | `` `≤ $${ENTRY_FLOOR.toFixed(2)} · unscored` `` — `marginLeft 6 · fontSize 11 · fontWeight 700 · padding 1px 5px · radius 4 · colour HT.text · background tint(HT.text,.10) · border 1px tint(HT.text,.25)` | `title` = `` `Entered at $${(entryById.get(wid) ?? 0).toFixed(2)} — at or under the $0.50 floor, so it is left out of the scorecard ranking and averages.` `` — the `?? 0` means a missing entry would render `"Entered at $0.00"`, though `underFloor` implies the id is in `cheapIds`, which implies an entry exists | Absent when not under floor |
| C123 · Front — "▸ price line" | Rendered when `wid != null` | `<div data-noshot="1">` · `absolute left 14 bottom 8 · fontSize 11 · colour tint(HT.cyan, 0.75)` | The affordance for the flip. `data-noshot` ⇒ **absent from every screenshot** | Absent for a pre-auto-probe row (`watch_id` null), which is also unclickable |
| C124 · Front — CB Edge logo | `<img src="/cb-edge-logo.png" alt="CB Edge">` | `absolute right 10 bottom 8 · height 32 · width auto · opacity .85 · pointerEvents none` | **Deliberately NOT `data-noshot`** — it is the brand mark kept in the card screenshot | Broken-image alt text if the asset 404s; no fallback |

---

# C.K — Pick card: back face (the probed contract's session line)

Source: `GexChangeTop.tsx:1251–1362`. Mounted only when `hasBack = isFlipped ||
opened[cid]` — the back is a second `backdrop-filter` surface, so mounting one
per tile up front would double the blur passes across ~65 tiles for a chart
nobody has asked for. Once opened, a back stays mounted so the flip-back
animates with content.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| C125 · Back face surface | `<div data-face="back">` | `faceStyle` + `transform rotateY(180deg)` + `padding "10px 12px"` (overriding the front's `12px 14px`) | Same box as the front, so the tile is exactly the same size either way up | — |
| C126 · Back — symbol + contract badge | `r.symbol` then `badgeStyle(side)` containing `` `${fmtStrike(r.strike)}${side}` `` | Symbol `fontSize 15 · fontWeight 800 · colour HT.text`. Badge `MONO 11 / 700 · padding 1px 5px · radius 4 · marginLeft 5` | Badge colour `c = side === "P" ? HT.orange : HT.green`; `background tint(c,.12)`, `border 1px tint(c,.4)`. `side` is the client derivation (C97) | Header left box is `minWidth 0 · overflow hidden · whiteSpace nowrap` |
| C127 · Back — 📷 button | `<button data-noshot="1">` | `background none · border none · padding "0 2px" · fontSize 12 · lineHeight 1 · fontWeight 700`. Labels: idle `"📷"` · busy `"…"` · copied `"✓"` · saved `"✓"` (**no word**, unlike the front's "✓ Copied") | Colour: `st && st !== "busy"` → `HT.green`; otherwise `HT.text` | Filename gets a `-chart` suffix: `` `${symbol}-${strike}-${slot without ":"}-chart.png` ``. Reachable from this side because "Flip all" can put the whole board face-down |
| C128 · Back — close "×" | `<button data-noshot="1">` | Glyph `"×"` (U+00D7) · `background none · border none · padding "0 2px" · fontSize 15 · lineHeight 1 · colour HT.text` | `title` = `"Back to the pick"`. `onClick` stops propagation then calls `toggleFlip(cid, wid)` — the same toggle the tile click uses | — |
| C129 · Back — sub line | `` `${r.expiry} · ${capturedLabel(date, hb.slot)}` `` | `MONO · fontSize 10 · colour HT.text · marginTop 2` | none | — |
| C130 · Back — peak headline | `peakPct` (C100) | `MONO · fontSize 18 · fontWeight 800 · lineHeight 1`, colour `peakColor` (C102). Text: `` `${peakPct >= 0 ? "▲" : "▼"} ${Math.abs(peakPct).toFixed(1)}%` `` — **1 dp**, glyph carries the sign | The headline is deliberately the PEAK (max favourable excursion), not "now". The card answers "was there a trade in it", not "what would I be holding at 3:55 PM" | `peakPct == null` → `"—"` in `HT.text` |
| C131 · Back — "peak" label | Static | `lblStyle` with `marginRight: 0` → `9px · uppercase · letterSpacing .06em · colour HT.text` | none | — |
| C132 · Back — grade pill | `<GradePill info={grade} provisional={!frozen} />` | Default `size 11`, `padding 2px 6px` | Same `grade` object as the front (C114) | — |
| C133 · Back — "in … → high …" line | Composite, line 1309 | `MONO · fontSize 11 · colour HT.text · marginTop 4 · nowrap · overflow hidden · textOverflow ellipsis`. Sequence: `<span lblStyle>in</span>` `fmtPx(entry)` `<span opacity .65> {trigLabel}</span>` `<span margin 0 4px>→</span>` `<span lblStyle>high</span>` `<span 700 peakColor>{fmtPx(peakMark)}</span>` | Then, only when `peakTs != null`: `<span opacity .65> {fmtClock(peakTs)}</span>`. Then, only when `peakDollars != null`: `<span 700 peakColor> · ${peakDollars >= 0 ? "+" : "−"}$${abs.toFixed(0)}/ct</span>` (U+2212) | Each optional clause is dropped entirely rather than showing a dash |
| C134 · Back — demoted "now" line | Composite, line 1324 | `MONO · fontSize 10 · colour HT.text · **opacity .7** · marginTop 2 · nowrap`. `<span lblStyle>now</span>` `fmtPx(lastMark)` then, when `pnlPct != null`, `<span colour pnlColor> · ${pnlPct >= 0 ? "+" : "−"}${abs.toFixed(0)}%</span>` (U+2212, zero decimals) | "now" survives as context against the peak, never as the number the card leads with | `lastMark == null` → `"now —"` and the pct clause is dropped |
| C135 · Back — "1D" range pill | Static | `tglStyle(true)` + `cursor: "default"` → border `HT.border`, background `tint(HT.text,.08)`, colour `HT.text` | **Not a control.** There is exactly one range: the recorder's snapshots are a single-session series. Inside a `data-noshot="1"` toolbar | — |
| C136 · Back — metric toggle | `METRICS` = `[{ key: "mark", label: "Price" }, { key: "net_gex", label: "Net GEX" }]`, in that order | Each `<button style={tglStyle(metric === m.key, true)}>` → active: `border 1px tint(HT.cyan,.4)`, `background tint(HT.cyan,.12)`, `colour HT.cyan`; inactive: `border 1px HT.border`, `background transparent`, `colour HT.text`. Group `flex · gap 4` | Default `metric = "mark"`. **`metric` is a single component-level state, not per card** — switching to Net GEX on one open card switches every open card at once. Persists to nothing. `onClick` stops propagation so it does not flip the card | Only two options; the other four greeks are deliberately absent |
| C137 · Back — chart slot states | lines 1350–1356 | Three-way: `wid != null && histLoading[wid] && !pts.length` → `"loading history…"` (`MONO 10 · colour HT.text · center · padding 26px 0`) · `h?.error` → the error string (`MONO 10 · **colour HT.red** · center · padding 26px 0`) · otherwise `<PickChart>` | The loading branch requires `!pts.length`, so a refresh over existing points keeps the chart on screen instead of blanking it | `h` undefined and not loading (e.g. `wid == null`, or `opened` without a fetch) → falls through to `PickChart` with `points: []` → C147 |
| C138 · Back — chart hint | Composite, line 1358 | `marginTop 4 · MONO · fontSize 9 · colour HT.text · letterSpacing .03em · nowrap · overflow hidden · ellipsis`. Text: `` `${metric === "mark" ? "price (mark)" : "net gex @ strike"} · RTH · in ${fmtPx(entry)} ${trigLabel} · high ${fmtPx(peakMark)}${peakTs != null ? ` ${fmtClock(peakTs)}` : ""} · ${ago(lastTs)}` `` | Restates C133 in one line so a cropped screenshot of the chart still carries the entry and the peak | `ago(lastTs)` → `"—"` when there is no history |

---

# C.L — `PickChart` (the back face's SVG)

Source: `GexChangeTop.tsx:299–472`. A port of `ProbeChart` from the owner Probe
page; the additions here are the dashed entry baseline, the Net-GEX zero line
and the peak marker.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| C139 · Geometry | Module constants, line 336 | `W = Math.max(160, boxW \|\| 240)` · `H = 96` · `PADL 44` · `PADR 8` · `PADT 6` · `PADB 16`. `viewBox = "0 0 W 96"`; SVG `width: 100%`, `height: 96`, `display block`, `cursor crosshair` | The viewBox is the box's REAL pixel width at a FIXED pixel height, so **one viewBox unit = one CSS pixel** — tick text renders at its literal size and the chart height never changes with tile width | `boxW = 0` before the ResizeObserver fires → `W = 240` |
| C140 · Width measurement | `attachBox` callback ref + `ResizeObserver` (322–334) | `setBoxW(Math.round(contentRect.width))` | Callback ref rather than `useRef`, so the observer attaches whenever the box mounts — **including after the "no history yet" state**, which is a different DOM node | Observer disconnected on unmount and on every re-attach |
| C141 · Series extraction | line 337 | `points.map(p => ({ ts: p.ts, v: metric === "mark" ? p.mark : p.net_gex })).filter(v != null && Number.isFinite(v))` | Points already RTH-filtered at fetch time (C10) | `pts.length < 2` → C147 |
| C142 · Y domain | lines 351–357 | `dom = showEntry ? [...ys, entry] : ys`. `minY/maxY` from `dom`; if equal, `minY -= 1; maxY += 1`. Then `pad = (maxY - minY) * 0.08` applied to **both** ends | `showEntry = metric === "mark" && entry != null && Number.isFinite(entry)` — the entry line is included in the domain so it is always visible on Price, never on Net GEX | — |
| C143 · Scales + paths | lines 360–363 | `sx(i) = PADL + (n <= 1 ? 0 : i/(n-1)) * (W - PADL - PADR)` — **index-spaced, not time-spaced**: a gap in the snapshot series is not visible as a gap. `sy(v) = H - PADB - ((v - minY)/(maxY - minY \|\| 1)) * (H - PADT - PADB)`. Path coords `toFixed(1)` | `area = line + L(sx(n-1), H-PADB) + L(sx(0), H-PADB) + Z` | — |
| C144 · Gridlines + y ticks | lines 382, 425–430 | `yTicks = [0, 0.5, 1].map(f => minY + f*(maxY - minY))` — **three** lines: bottom, middle, top. Line `stroke tint(HT.text, 0.08) · strokeWidth 1`. Tick text `x = PADL - 5 · y = sy(v) + 3 · textAnchor end · fontSize 9 · fill HT.text · MONO` | Label format `fmtY = metric === "net_gex" ? fmtGex : v.toFixed(2)`. **The function's own doc comment says "5 gridlines"; the code draws 3. The code wins.** | — |
| C145 · X time labels | lines 431–432 | Two labels only: `fmtT(minX)` at `x = PADL` (anchor start) and `fmtT(maxX)` at `x = W - PADR` (anchor end), both `y = H - 4 · fontSize 9 · fill HT.text · MONO` | `fmtT(ts) = new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })` — **empty locale array and NO `timeZone`, so this is the browser's locale and the browser's timezone**, while `fmtClock` (C25) pins ET. For a non-ET viewer the axis and the "high @ 1:42 PM" stamp above it disagree | — |
| C146 · Reference lines | lines 433–441 | Net-GEX zero line, drawn only when `metric === "net_gex" && minY < 0 && maxY > 0`: `stroke tint(HT.text, 0.2) · strokeWidth 1`, solid. Entry baseline, drawn only when `showEntry`: `stroke tint(HT.text, 0.35) · strokeWidth 1 · strokeDasharray "4 4"` | Mutually exclusive by metric | Neither renders otherwise |
| C147 · "not enough history yet" | `pts.length < 2` (341–349) | A 96px-tall flex-centred `<div>`: `MONO · fontSize 10 · colour HT.text · textAlign center · lineHeight 1.5`. Text on two lines: `"not enough history yet —"` `<br/>` `"snapshots accrue every minute through RTH"` | Also the state for a card opened before its fetch lands and for a single-point series | This div still carries `attachBox`, so the width is measured for when the data arrives |
| C148 · Area + line | lines 442–443 | `<path d={area} fill="url(#gct-fill)" />` then `<path d={line} fill="none" stroke={HT.cyan} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />` | Gradient `id="gct-fill"`, `x1 0 y1 0 x2 0 y2 1`: `0%` → `tint(HT.cyan, 0.28)`, `100%` → `tint(HT.cyan, 0)`. **The id is a hardcoded literal, re-declared inside every chart instance** — up to ~65 duplicate DOM ids after a Flip all | — |
| C149 · Peak marker | lines 369–379, 444–455 | Nearest charted sample to `peakTs` by `Math.abs(pts[i].ts - peakTs)`. Renders a vertical dashed line `x = sx(peakIdx)`, `y1 = PADT`, `y2 = H - PADB`, `stroke tint(HT.green, 0.35) · strokeWidth 1 · strokeDasharray "2 3"`, plus a `circle r=3.2 · fill HT.green · stroke HT.bg · strokeWidth 1` | Only when `metric === "mark"` (the caller passes `peakTs = null` for Net GEX, where a "high" means nothing). **Nearest, not exact** — the scorecard reads `watch_snapshots` straight while these points are RTH-filtered client-side. `if (best > 5 * 60_000) peakIdx = null` — more than **5 minutes** away is a different event, so draw nothing rather than point at the wrong bar | `peakTs == null` or beyond 5 min → no marker |
| C150 · Crosshair — interaction | `onMouseMove` / `onMouseLeave` / `onClick` (390–396, 417) | `x = ((clientX - box.left)/box.width) * W`; `frac = (x - PADL)/(W - PADL - PADR)`; `setHover(Math.round(clamp(frac, 0, 1) * (n-1)))` — nearest index in viewBox units, so it stays correct at any tile width. `onMouseLeave` → `null` | **`onClick` calls `e.stopPropagation()`** — reading the chart must not flip the card back (same as the Probe page's `.op-chartwrap`) | `box.width === 0` → the move handler returns early |
| C151 · Crosshair — marks | lines 456–465 | Vertical line `stroke tint(HT.cyan, 0.5) · strokeWidth 1 · strokeDasharray "3 3"`; dot `r 3 · fill HT.cyan · stroke HT.bg · strokeWidth 1` | — | No hover → a single `circle cx={sx(n-1)} cy={sy(last)} r={3} fill={HT.cyan}` on the last point, with **no `bg` stroke** |
| C152 · Crosshair — time chip | lines 461–462 | `rect x=tX · y=H-PADB+2 · width=tW · height=13 · rx=3 · fill HT.bg · stroke tint(HT.cyan,.4)`. `tW = Math.max(30, label.length * 5.4 + 8)`; `tX = clamp(hx - tW/2, 0, W - tW)`. Text centred, `y = H - PADB + 11 · fontSize 9 · fill HT.text · MONO` | The `5.4` is a hardcoded per-character width estimate for the mono face | — |
| C153 · Crosshair — value chip | lines 463–464 | `rect x=0 · y=vY · width=vW · height=13 · rx=3 · fill HT.bg · stroke tint(HT.cyan,.4)`. `vW = Math.min(PADL - 2, Math.max(26, label.length * 5.4 + 8))` — capped at 42 so it never spills into the plot. `vY = clamp(hy - 6.5, 0, H - PADB - 13)`. Text `x = vW/2 · y = vY + 9 · fontSize 9 · **fill HT.cyan** · MONO` | Value label uses `fmtY` (C144), so Net GEX reads `"+$1.20M"` | — |

---

# C.M — Footer legend (the ranking + grading contract, as rendered)

Source: `GexChangeTop.tsx:1376–1391`. Container: `marginTop 8 · flex · gap 16 ·
flexWrap wrap · fontSize 12 · colour HT.text`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| C154 · Score definition | Static string | `"Score = 0.6·|Δ| + 0.4·|% vs open|, normalized 0–100"` — U+00B7 for the multiplication dots, U+2013 en dash in "0–100" | **Label only.** No client code computes this; `r.score` arrives from `/proxy/gex-change-top`. A grep of `components/` and `lib/` finds no second copy of the weights. **Weights: 0.6 on |Δ|, 0.4 on |% vs open|.** | Always renders |
| C155 · ★ Very strong definition | `<span style={{ color: HT.orange }}>★ Very strong</span>` + static text | `"★ Very strong = |Δ| ≥ $200k AND |% vs open| ≥ 30%"` — both boundaries `≥` (U+2265) | **Label only**, enforced by `server-v2/gex-change-top-recorder.js`. Restates the card subtitle (C45), which writes the same rule with `&` instead of `AND` | Always renders |
| C156 · Auto-probe note | Static string | `"Every pick is auto-probed at capture — the flip side is its recorded option price since it was flagged"` | Describes the recorder's `POST /api/watch` → `watch_options` + 60s snapshot loop, whose `id` rides along as `row.watch_id` | Always renders |
| C157 · Grade formula note | Static + `<span style={{ color: HT.red }}>F</span>` | `"Grade = 55 pts peak (best gain offered) + 25 pts pain (worst drawdown) + 20 pts close. "` then red `"F"` then `" is automatic when a pick never traded green, whatever the rest of the row says."` | The three maxima match C29/C30/C31 exactly (55 / 25 / 20 = 100). The never-green rule matches C33 for the **local** path only — the server path does not apply it (C34) | Always renders |
| C158 · Projection note | Rendered when `slots.some(hb => hb.rows.some(r => r.proj_grade))` | `"A dashed proj pill is what the projection rule predicted at capture — see the Pick Study tab for whether those predictions are holding up."` with `proj` in `<b>` | The only cross-reference to Part D on this tab. Gated on at least one row having a `proj_grade`, which is null by default | Absent whenever no rule is armed |

---

### Colours used

Every value this part paints. `HT` values are literals in
`components/shared/homeTheme.ts`; `tint(x, a)` is the local alpha helper.

| v2 value | Where used | Exists in v3 `tokens.css`? | Proposed v3 token |
|---|---|---|---|
| `HT.bg` `#05060A` | SVG crosshair chip fills, peak-marker circle stroke, `tint(HT.bg,.35)` on the front 📷 button, capture background (`SNAP_BG`) | yes — `--color-v2-bg` | `V2.bg` |
| `HT.panelBg` `rgba(13,17,25,0.45)` | Card plate, both card faces | no exact | `V2W.panelBg` = `alpha(V2.panel, .45)` |
| `HT.border` `rgba(255,255,255,0.10)` | Card border, face borders, `th` bottom rule, every off-state toggle border, buttons | no exact | `V2W.border` = `alpha(T.text, .10)` — **not** `--color-line`, which is opaque `#23272e` |
| `HT.text` `#FFFFFF` | Every label and body line, `td` colour, chart tick fills, "Low %", "$/ct", the "now" line, `lblStyle` | yes — `--color-fg` | `T.text` |
| `HT.muted` `#FFFFFF` | **Never referenced by name in this file** — but it is the same value as `HT.text`, which is why "secondary" text here is full white | yes — `--color-muted` (also `#ffffff`) | **Collapse.** Do not introduce a grey; carry v2's `opacity` values instead (0.3 / 0.62 / 0.65 / 0.7) |
| `HT.cyan` `#219EBC` | Chart line + area gradient + crosshair + value-chip text, `score N`, grade **B**, live slot header, ⚡ LIVE TRIGGER badge, active Flip-all, GPA value, `▸ price line` at .75, active metric toggle, `homeButtonStyle` text/border/gradient | yes — `--color-v2-cyan` | `V2.cyan` |
| `HT.orange` `#FB8501` | "Scorecard" title, recorded (non-live) slot header, `OTM N%`, `★ Very strong`, grades **C** and **D**, put-side badge and put-side Contract cell, 📷 Screenshot button, active cheap toggle | yes — `--color-v2-orange` | `V2.orange` |
| `HT.green` `#8ECAE6` (**a light blue**) | Positive Δ, positive Peak %, positive Close %, positive `% vs open`, grades **A+** and **A**, call-side badge and call-side Contract cell, **`th` column-header text**, **Card subtitle**, peak marker line + dot, `avg peak` when ≥ 0, `never green` when 0, 📷 success border and glyph | yes — `--color-v2-green` | **SPLIT — see the note below.** `MOVE_UP` for direction; a call-side token; `T.muted` for headers and subtitle |
| `HT.red` `#EF4444` | Negative Δ / Peak % / Close % / `% vs open` / pnl, grade **F**, feed error, scorecard error, chart history error, `avg peak` when < 0 or null, `never green` when > 0, the footer's red `F` | yes — `--color-v2-red` | `MOVE_DOWN` for direction; `V2.red` for the error lines |
| `tint(HT.cyan, .12)` | Active Flip-all bg, LIVE TRIGGER bg, active metric toggle bg | no | `alpha(V2.cyan, .12)` |
| `tint(HT.cyan, .28)` → `tint(HT.cyan, 0)` | `#gct-fill` gradient stops | no | `alpha(V2.cyan, .28)` → `alpha(V2.cyan, 0)` |
| `tint(HT.cyan, .4)` | Active metric toggle border, crosshair chip strokes | no | `alpha(V2.cyan, .4)` |
| `tint(HT.cyan, .45)` | LIVE TRIGGER border | no | `alpha(V2.cyan, .45)` |
| `tint(HT.cyan, .5)` | Active Flip-all border, crosshair vertical line | no | `alpha(V2.cyan, .5)` |
| `tint(HT.cyan, .75)` | `▸ price line` hint | no | `alpha(V2.cyan, .75)` |
| `tint(HT.text, .05)` | `td` bottom rule | no | `V2W.wash05` |
| `tint(HT.text, .08)` | Chart gridlines, on-state neutral toggle bg (freshness pill, `1D`) | no | `alpha(T.text, .08)` |
| `tint(HT.text, .10)` | `≤ $0.50 · unscored` badge bg | no | `V2W.border` (same value) |
| `tint(HT.text, .2)` | Net-GEX zero line, busy 📷 border | no | `alpha(T.text, .2)` |
| `tint(HT.text, .25)` | `≤ $0.50 · unscored` badge border | no | `alpha(T.text, .25)` |
| `tint(HT.text, .35)` | Dashed entry baseline on the Price chart | no | `alpha(T.text, .35)` |
| `tint(HT.orange, .12)` / `.5` | Active cheap-toggle bg / border | no | `alpha(V2.orange, .12)` / `.5` |
| `tint(HT.green, .35)` | Peak-marker dashed line | no | `alpha(MOVE_UP, .35)` |
| `tint(HT.bg, .35)` | 📷 button bg after a successful shot | no | `alpha(V2.bg, .35)` |
| `tint(GRADE_COLOR[g], .14)` / `.45` | Grade chip bg / border | no | `alpha(<grade token>, .14)` / `.45` |
| `tint(GRADE_COLOR[g], .5)` / `.85` | ProjPill dashed border / text | no | `alpha(<grade token>, .5)` / `.85` |
| `tint(c, .12)` / `tint(c, .4)` where `c = orange\|green` | Contract badge bg / border on the back face | no | `alpha(<side token>, .12)` / `.4` |
| `rgba(33,158,188,.25)` | `homeButtonStyle` border | no | `alpha(V2.cyan, .25)` |
| `linear-gradient(180deg, rgba(33,158,188,.12), rgba(33,158,188,.04))` | `homeButtonStyle` background | no | `linear-gradient(180deg, alpha(V2.cyan,.12), alpha(V2.cyan,.04))` |
| `rgba(0,0,0,0.22)` | `classicCardAccentStyle` box shadow | `--color-shadow` is `#000000` | `alpha(SHADOW, .22)` |

**The one-colour-many-semantics problems on this tab.** v2's palette is six
hues doing eighteen jobs. Collapse these in the port rather than carrying them
over:

1. **`HT.green` `#8ECAE6` carries four unrelated semantics** — "positive /
   up", "call side", "table column header" and "card subtitle". A `th` on the
   scorecard is painted the same colour as a +140% peak. Split: `MOVE_UP` for
   sign, a call/put pair for side, `T.muted` for headers and the subtitle.
2. **`HT.text` and `HT.muted` are the same `#FFFFFF`.** There is no muted text
   on this tab; hierarchy comes from size (17 / 15 / 14 / 13 / 12 / 11 / 10 /
   9 px) and from four ad-hoc `opacity` values. v3's `--color-muted` and
   `--color-faint` are also `#ffffff`, so this collision survives the port
   unless someone decides otherwise. **Flag for Brandon** — this is a real
   legibility question, not a token question.
3. **`HT.orange` carries four semantics** — "★ Very strong / warning", "put
   side", "recorded slot header" and grades **C and D**.
4. **`HT.cyan` carries five** — the chart line, `score N`, grade **B**, the
   live slot header, and the primary button treatment.
5. **The grade ramp is six letters in four colours.** `A+` and `A` are both
   `HT.green`; `C` and `D` are both `HT.orange`. A user cannot tell A+ from A,
   or C from D, by colour. If v3 wants a grade ramp it needs six steps —
   otherwise the tooltip is the only thing that separates them.
6. **Three different zero conventions for the same "is it positive" question.**
   Peak % in the table (C82) uses `>= 0` → green. `peakColor` on the card
   (C102) uses `> 0` → green, `0` → red. `pnlColor` (C104) uses `> 0` green /
   `< 0` red / `=== 0` neutral. The same contract at exactly break-even paints
   green in the table, red on the card front and white on the card back. Pick
   one rule in v3.

### Do not port

1. **`tint()` (lines 89–92).** A local re-implementation of homeTheme's private
   `themeRgba`, and in v3 it is a colour-literal factory. Use `alpha()` / `mix()`
   from `src/design/theme.ts`.
2. **Direct `fetch()` from the component (three call sites: 484, 506, 612).**
   v3 pages go through `query` / `useQuery` / `preload` in `src/data/api.ts`,
   which dedupe, cache and pause polling on hidden tabs. None of that exists
   here.
3. **The results waterfall (C12).** `loadResults` fires on mount with `date === ""`,
   then a second time once `/proxy/gex-change-top` sets `date`. Two requests,
   the second dependent on the first response. v3 must resolve the date first
   (URL param or "today") and fire all three in parallel at route entry.
4. **The 60s `setInterval` pair (C13) and the open-card interval (C14).**
   Replace with `pollMs`. Note the v2 polls do **not** pause on a hidden tab,
   and the open-card poll's `if (openWatchIds.length > 8) return` is a
   hand-rolled rate limiter standing in for a batched history endpoint.
5. **The `flipAll` wave scheduler (C15).** Six-at-a-time `Promise.all`
   recursion exists because there is no batch endpoint. Same reason.
6. **The whole html2canvas capture surface** — `⧉ Copy image`, `📷 Screenshot`,
   and the two per-card `📷` buttons, plus the `data-noshot="1"`,
   `data-flip3d`, `data-face`, `data-card` attribute protocol they depend on.
   Per `docs/parity/em.md` Part D, v3 has **one** owner-gated camera in the
   toolbar (`src/shell/CopyShot.tsx`) and a dependency-free capture in
   `src/shell/snapshot.ts`. This tab publishes its capture target to that menu
   instead.
7. **The per-card `<img src="/cb-edge-logo.png">` watermark (C124).** It exists
   only because the per-card 📷 needed a brand mark in the PNG. The shared
   framed capture bakes a title band and `"Data provided by CBEdge.net"`, so
   the in-card logo is redundant chrome that eats 32px of every tile.
8. **The `gct-fill` SVG gradient id (C148).** A hardcoded id declared inside a
   component rendered up to ~65 times — duplicate DOM ids, and the last one
   wins in some engines. v3 charts are imperative and mount through
   `ChartFrame`; if this stays SVG the id must be per-instance.
9. **`<style>{…}</style>` injected inside the render tree (line 1370).** Three
   media queries with `!important`, re-emitted on every render. v3 puts grid
   breakpoints in CSS.
10. **`colorScheme: "dark"` on the date input (line 827).** v3 sets
    `color-scheme: dark` document-wide in `tokens.css`.
11. **The unreachable `gpa == null → "—"` branch (C69).** The block is gated on
    `graded.length > 0`, which makes `gpa` non-null by construction.
12. **The wrong string in the scorecard empty state (C72)** — it tells the user
    to press `"show ≤ $0.50"`, a button that reads `"score ≤ $0.50 too (N)"`
    and that may not be on screen at all. Correct it in the port; do not
    transcribe the mismatch.
13. **The `"5 gridlines"` comment on `PickChart` (line 302)** and the
    `"half credit"` comment on the pain default (line 185). Both disagree with
    the code (3 gridlines; 15/25 = 60%). Port the code.
14. **`useIsOwner` / `PageShell` / the tab-switch CustomEvent** — v2 page
    chrome. This tab is not owner-gated; the shell and the tab bar are the
    parent route's job in v3.
15. **`z_score`, `window_min`, `best_rank`, `min_mark`, `close_ts`, `samples`,
    `min_ts`, `sustained_mark`, `sustained_pct`, `sustained_ts`** — ten fields
    on the wire with no surface (C7, C9). Do not build UI for them on
    assumption; ask first (see below).

### Open questions for Brandon

1. **Sort order is entirely server-decided.** The scorecard table (C73) and the
   slot list (C90) have no client comparator at all. Is `j.rows` guaranteed
   ordered (by `first_slot`? by `grade_pts`? by `score`?) and is `j.slots`
   guaranteed most-recent-first? The file header asserts most-recent-first but
   nothing enforces it. v3 needs a stated default sort, or it needs to sort.
2. **`gradeFor`'s server path never applies the never-green override (C34).**
   A row with `grade: "B"` and `max_pct <= 0` renders a **B pill** while being
   counted in the **never-green** total. Is the server already applying the F
   rule (in which case the local `neverGreen` flag is only a counter and this
   is fine), or is this a real divergence to fix in the port?
3. **`sustained_pct` is on the wire and not shown.** Its comment calls it "the
   fillable move, as opposed to `max_pct`'s single print" — and the scorecard,
   the grade ladder and the card headline are all built on `max_pct`. Was
   showing the sustained figure ever the intent, and should the grade's peak
   term use it?
4. **`fmtBig` has no sub-$1M branch (C17).** The ★ threshold is `$200k`, so
   every card at the threshold reads `"0.2M"` and a $40k Δ reads `"0.0M"`.
   Should the port add a `K` branch, or is the M-only form deliberate parity
   with the GEX Change Scanner card?
5. **Chart x-axis timezone (C145).** `fmtT` uses the browser's locale and zone;
   every other time on the tab (`fmtClock`, `slotLabel`) is ET. For a non-ET
   viewer the axis disagrees with the "high @ 1:42 PM" stamp directly above it.
   Pin the axis to ET, or was browser-local intended?
6. **`cid` omits `expiry` (C96)** while the React key includes it. Two expiries
   on the same symbol+strike inside one slot would share flip, `opened` and 📷
   state. Has that ever occurred? Should the port key on expiry too?
7. **Is `proj_grade` ever populated in production?** The type comment says null
   "is the shipping default". If it is always null, `ProjPill` (C40), the
   conditional footer note (C158) and the Pick Study cross-reference are dead
   in practice, and Part D's calibration table has nothing to calibrate.
8. **`pct_open` units.** Rendered as `` `${v.toFixed(0)}% vs open` `` with no
   scaling. Is the wire value already a percentage (30 ⇒ "30%") or a fraction?
   The ★ rule says `|% vs open| ≥ 30%`, which implies the former.
9. **The `metric` toggle is global, not per card (C136).** Switching to Net GEX
   on one open card switches every open card. Intentional (one mode for the
   board) or an accident of hoisting the state?
10. **Do the score formula and the ★ threshold move to v3, or stay in
    `server-v2`?** `gex-change-top-recorder.js` and `_lib-pick-grade.cjs` are
    not in this checkout. If v3 keeps reading the same `/proxy/*` endpoints
    then C154/C155/C157 stay label-only and the ladder in §C.D is only a
    fallback — but the fallback still has to match the server exactly, and
    nothing today verifies that it does.
11. **Is the entry floor still `$0.50`, and is the legacy path still needed?**
    The recorder enforces the floor at capture now, so `underFloor` (C106),
    the cheap toggle (C63) and the `≤ $0.50 · unscored` badge (C122) only ever
    fire on dates recorded before that shipped. Is there a cutoff date after
    which all three can be dropped from the port?
12. **`.card-hover`** is a global class applied by `PageCard` but its CSS is not
    in this checkout. What does it do (transform? shadow?) — it matters because
    a transform on the card makes it the containing block for anything
    `position: fixed` inside (the `Scanner.tsx:881–895` note).

**Part C row count: 158**
# Part D — Pick Study (`?tab=pickstudy`, owner only)

**Scope.** The `pickstudy` tab of `/scanner`. One component file, plus the two
files that decide whether it is ever mounted:

| Layer | File | Lines |
|---|---|---|
| Tab definition + `ownerOnly` flag | `components/scanner/scannerNav.ts` | 22–37, 49–64, 103–107 |
| Legacy top tab strip (drops the pill) | `components/scanner/ScannerTabsBar.tsx` | 59–64, 102–121 |
| Page shell owner gate | `components/pages/Scanner.tsx` | 45, 3044–3100 |
| The tab itself | `components/scanner/PickStudyTab.tsx` | 1–703 (whole file) |
| Table styles (`th` / `td` / `seg`) | `components/scanner/scannerStyles.ts` | 29–37 |
| Card + shell chrome | `components/shared/PageCard.tsx` | 41–145 |
| Colour constants | `components/shared/homeTheme.ts` | 3–18, 227–238 |

**Not staged, so not transcribed:** `components/shared/useTableSort` (`SortTh`,
`useTableSort`) and `components/shared/useIsOwner`. Both are imported by files in
scope and neither file exists under
`/mnt/user-data/uploads/spx-gex-dashboard-tt-fixed/components/shared/`. Every
claim below about those two modules is derived from their **call sites only** and
is marked as such; see **Open questions**.

`HT` = `HOME_THEME` from `components/shared/homeTheme.ts`. Note the values, which
are not what their names say: `HT.green` is `#8ECAE6` (a **light blue**),
`HT.purple` is `#126783` (a **teal**), `HT.muted` is `#FFFFFF` (identical to
`HT.text`).

`tint(hex, a)` is this file's local alpha helper (lines 109–112) — it parses a
6-digit hex and emits `rgba(r,g,b,a)`. It is a **byte-for-byte duplicate** of
`themeRgba` in `homeTheme.ts:63–69`, which is not exported. All `tint(...)` calls
below are that function.

`MONO` = `"var(--font-mono)"` (line 114).
`GRADES` = `["A+", "A", "B", "C", "D", "F"]` (line 115) — this exact order,
hardcoded, used for both the calibration table's six trailing columns and the
`projected` sort rank.

---

## D.0 — The owner gate, both halves

`PickStudyTab.tsx` contains **no owner check of its own**. It renders whatever it
is mounted with. The gate is entirely in the two files above, and it is chrome.

Source: `scannerNav.ts:22–37, 59`; `ScannerTabsBar.tsx:59–64`;
`Scanner.tsx:3048–3066, 3089–3098`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D1 · `ownerOnly` flag | `scannerNav.ts:36` → `TabDef.ownerOnly?: boolean` | Optional boolean on the tab record | `pickstudy` is the **only** tab in `SCANNER_TABS` that sets it (`scannerNav.ts:59`). The JSDoc on the field states the contract verbatim: *"Draw the pill for the owner only. Chrome-level: the sub-strip skips it and ScannerPage refuses to render the tab, but this is NOT a security boundary — anything that must not leak needs a server-side gate on its data route too."* | n/a |
| D2 · The tab record | `scannerNav.ts:59` | `{ id: "pickstudy", label: "Pick Study", short: "Study", color: HOME_THEME.purple, icon: "🔬", ownerOnly: true }` | Pill accent `HT.purple` `#126783`; sub-strip glyph `🔬`; compact label `"Study"`, full label `"Pick Study"` | n/a |
| D3 · Group placement | `scannerNav.ts:104` | `SCANNER_GROUPS[0]` — `{ key: "gamma", tabs: ["gexlevels", "gexchangetop", "pickstudy", "strike"] }` | Third position in the `gamma` cluster, immediately after GEX Change Top. The in-file comment (`scannerNav.ts:52–58`) states the reason: it is that tab's feedback loop, and the reason for the flag — *"OWNER ONLY (2026-08-21): this is the tuning bench for the pick ranking — half-formed splits, thin buckets and a calibration block that reads 'not armed' most of the time. It is research in progress, not a customer view."* | n/a |
| D4 · Sub-strip filter (legacy bar) | `ScannerTabsBar.tsx:63–64` → `const { isOwner } = useIsOwner(); const tabs = SCANNER_TABS.filter((t) => !t.ownerOnly \|\| isOwner);` | Applied **once**, to a single `tabs` array | Filters BOTH surfaces the bar renders: the desktop `.scanner-tabs` row (`:110`) and the mobile `.scanner-tab-select` `<option>` list (`:102`). No `loaded` beat here — this bar reads `isOwner` only, so it flickers the pill in for an owner on the tick auth resolves | Non-owner: the `<button>`/`<Link>` and the `<option>` are both absent from the DOM |
| D5 · The other sub-strip | `scannerNav.ts:59–62` comment; `ScannerTabsBar.tsx:59–62` comment | — | The comment names `SectionSubStrip` (the `GlobalToolbar` strip) as applying the *same* rule, and calls `ScannerTabsBar` *"legacy … but it must not be the one place a hidden tab still shows."* **`SectionSubStrip` / `GlobalToolbar` are not staged**, so that half is unverified here | — |
| D6 · `OWNER_ONLY_TABS` | `Scanner.tsx:3049–3051` → `new Set<MainTab>(SCANNER_TABS.filter((t) => t.ownerOnly).map((t) => t.id as MainTab))` | A `Set` derived from `scannerNav` at module scope, not a second hand-maintained list | Today the set is exactly `{"pickstudy"}`. Adding `ownerOnly: true` to another tab gates it here with no edit to `Scanner.tsx` | n/a |
| D7 · `useIsOwner()` | `Scanner.tsx:45, 3061` → `const { isOwner, loaded: authLoaded } = useIsOwner()` | Returns `{ isOwner: boolean; loaded: boolean }` | The shared hook (`@/components/shared/useIsOwner`) is **not staged**. A *different, unrelated* `useIsOwner` exists at `components/scanner/ProbeButton.tsx:21–26` and returns a **bare boolean**, computed as `isOwnerClaim \|\| (process.env.NEXT_PUBLIC_OWNER_USER_ID ? userId === process.env.NEXT_PUBLIC_OWNER_USER_ID : false)` off `useAuth()`. `IbStatsTab.tsx:1374–1378` inlines that same expression a third time. The shared hook's shape (`{isOwner, loaded}`) is destructured at three call sites and is therefore certain; its *body* is not visible | — |
| D8 · `ownerGated` | `Scanner.tsx:3062` → `OWNER_ONLY_TABS.has(tab) && !isOwner` | boolean | True only when the *current* tab is owner-only AND the viewer is not the owner. Note it reads `tab` (the requested tab), not `visibleTab` | — |
| D9 · `visibleTab` — the `authLoaded` beat | `Scanner.tsx:3066` → `const visibleTab: MainTab \| null = ownerGated ? (authLoaded ? "gexchangetop" : null) : tab;` | `MainTab \| null` | Three-way: **(a)** not gated → `tab`; **(b)** gated and auth resolved → hard fallback to `"gexchangetop"`; **(c)** gated and auth still resolving → **`null`**. The in-code comment states why: *"While auth is still resolving, an owner-gated tab renders NOTHING rather than falling back — a flash of the wrong tab that then swaps is worse than an empty beat, and it would also fire that tab's fetches."* | `visibleTab === null` → every one of the seven `{visibleTab === "…" && <Tab/>}` lines (`:3091–3097`) is false, so `<PageShell>` renders with **no child at all**. `PickStudyTab` is never mounted, so none of its three mount effects run and **none of D57–D61's fetches fire** |
| D10 · Deep-link path | `Scanner.tsx:3054–3056, 3071–3074` | `useState<MainTab>("gexchangetop")` then a mount effect `readTabFromUrl()` → `setTab` | A pasted `/scanner?tab=pickstudy` sets `tab = "pickstudy"` on mount regardless of auth. The gate is D8/D9, downstream of it — the URL always wins the *state*, never the *render* | Owner: renders Pick Study. Non-owner, auth resolved: silently renders GEX Change Top at the `?tab=pickstudy` URL — **the address bar is not corrected**, no message, no redirect |
| D11 · In-place tab switch | `Scanner.tsx:3080–3087`; `scannerNav.ts:145–150` | `window.addEventListener(SCANNER_TAB_EVENT /* "cb:scanner-tab" */, …)` → `setTab(e.detail)` | The sub-strip fires this when a pill is clicked while already on `/scanner`, because React Router does not remount for a query-only change. The listener does **no** owner check — it will set `tab = "pickstudy"` for anyone who dispatches the event; D8/D9 is what stops it rendering | — |

**⚠ This is chrome, not a security boundary.** Stated explicitly in
`scannerNav.ts:32–35` and again in `ProbeButton.tsx:13–14` (*"Same cosmetic owner
gate as IbStatsTab: the real gate is server-side"*). Anyone can call the routes
this tab hits directly. **Every route it touches needs its own server-side owner
gate**; the tab only proves the server enforces one on the *write* path, and only
for two of the five calls (D64, D65 branch on `401/403`). The read routes have no
such branch, which does not mean they are ungated — it means this file cannot
tell you.

**Routes this tab hits** (full detail in D57–D61):

1. `GET /proxy/gex-change-top-study` — read
2. `GET /proxy/gex-change-top-calibration` — read
3. `GET /proxy/gex-change-top-rule` — read
4. `POST /proxy/gex-change-top-rule-fit` — write (client expects `401/403`)
5. `POST /proxy/gex-change-top-rule` with `{"clear":true}` — write (client expects `401/403`)

---

## D.1 — Formatters and colour helpers

Source: `PickStudyTab.tsx:109–131`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D12 · `pct(v, dp = 0)` | `:117–118` | `` `${v.toFixed(dp)}%` `` — **0 decimal places at every call site in this file** (no call passes `dp`) | — | `v == null \|\| !Number.isFinite(v)` → `"—"` (em dash). Note `NaN` and `Infinity` both land on `"—"` |
| D13 · `signed(v, dp = 0)` | `:119–120` | `` `${v >= 0 ? "+" : ""}${v.toFixed(dp)}` `` — 0 dp everywhere. `-0` prints `"-0"` because `-0 >= 0` is `true` in JS but `(-0).toFixed(0)` is `"0"` → actually renders `"+0"` | — | Same null/non-finite guard → `"—"` |
| D14 · `liftColor(v)` | `:123–124` | Returns a colour string | Exactly three branches, in order: `v == null` → `HT.text` `#FFFFFF`; **`v >= 8`** → `HT.green` `#8ECAE6`; **`v <= -8`** → `HT.red` `#EF4444`; otherwise → `HT.text`. Boundaries are inclusive on both sides — `+8.0` is green, `+7.9` is white, `-8.0` is red | `null` → white, same as the dead-band. A lift of exactly `0` and a *missing* lift are painted identically |
| D15 · `tint(hex, a)` | `:109–112` | `` `rgba(${r},${g},${b},${a})` `` from a 6-digit hex | Only ever called with 6-digit hex (`HT.text`, `HT.green`, `HT.red`, `HT.orange`, `HT.cyan`, or a `tone` that is one of those). A 3-digit hex or an `rgba()` input would produce `rgba(NaN,NaN,NaN,a)` — not reachable today | n/a |
| D16 · `th` | `scannerStyles.ts:29` | `padding: 6px 10px; textAlign: right; fontWeight: 700; letterSpacing: 0.05em` — **no colour**, so it inherits | Colour comes from the `<tr>` (D36, D80): `HT.green` `#8ECAE6`. Both tables override `textAlign` to `left` on their first column, and on `pctGood` | n/a |
| D17 · `td` | `scannerStyles.ts:30` | `padding: 6px 10px; textAlign: right; color: HT.text` | Overridden to `textAlign: left` on the bucket/predicted column and the A/B-rate column; `textAlign: right` restored explicitly on the copy-button cell | n/a |
| D18 · `seg(active)` | `scannerStyles.ts:32–37` | `padding: 6px 14px; borderRadius: 8; fontSize: 14; fontWeight: 700; cursor: pointer` | **active:** border `1px solid #219EBC`, background `rgba(33,158,188,0.15)`, colour `#FFFFFF`. **inactive:** border `1px solid rgba(255,255,255,0.15)`, background `transparent`, colour `rgba(255,255,255,0.7)` | n/a |

---

## D.2 — Card frame

Source: `PickStudyTab.tsx:480–485`; `PageCard.tsx:84–145`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D19 · `"PICK STUDY"` | `<Card title={<span style={{fontSize:17}}>Pick Study</span>}>` `:483` | The literal typed is `Pick Study`. `PageCard`'s title wrapper (`PageCard.tsx:133`) applies `fontSize:14; fontWeight:800; letterSpacing:0.12em; textTransform:uppercase; color: HT.text` — the inner span overrides **only** `fontSize` to `17`. **What renders is `PICK STUDY` at 17px/800, letter-spaced 0.12em, white** | none | Always renders |
| D20 · Card subtitle | `:484` → `` `What the graded picks had in common at capture · ${days}d window${loading ? " · loading…" : ""}` `` | `fontSize: 12`, colour `HT.green` `#8ECAE6` (`PageCard.tsx:138`) | The `" · loading…"` suffix (single `…` glyph) is the **only** loading affordance on the whole tab. It tracks the study fetch (`loading` state) only — the calibration and rule fetches have no loading flag at all | Always renders. `days` is client state, so the subtitle shows the *requested* window immediately, before the response for it lands |
| D21 · Card surface | `variant="budget"` `:482` | `PageCard.tsx:118–121` resolves `"budget"` → `classicCardAccentStyle` = `background HT.panelBg rgba(13,17,25,0.45); backdropFilter blur(16px); borderRadius 18; border 1px rgba(255,255,255,0.10); boxShadow 0 18px 40px rgba(0,0,0,0.22)`. `padding` defaults to `24` | `className="card-hover"` is applied (variant is not `dissolve`) — the dashboard-wide hover lift. The `accent` prop is **not passed** and would be ignored anyway (`PageCard.tsx:23–33`: *"Card accents are DEAD"*) | n/a |

---

## D.3 — Controls

Source: `PickStudyTab.tsx:126–131, 486–501`. Two rows of segmented buttons plus a
refresh glyph. **Nothing on this tab persists to `localStorage`, writes to the
URL, or reads a query param.** Every control resets to its default on remount.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D22 · Feature row | `data?.features ?? [{ key: "score", label: "Score" }]` `:447`, rendered `:487–491` | `flex; flexWrap: wrap; gap: 8; marginBottom: 10`. One `<button style={seg(by === f.key)}>{f.label}</button>` per feature | **The option list is server-driven** — it comes from `/proxy/gex-change-top-study → features[]`, so the exact set and order cannot be transcribed from the client. Client default is `by = "score"` (`:350`) | Before the first response (and after any study error, which sets `data = null`): the fallback array renders exactly **one** button labelled `"Score"`, active |
| D23 · Day row | `DAY_OPTS = [14, 30, 60, 90, 180]` `:126`, rendered `:493–495` | Labels `"14d"`, `"30d"`, `"60d"`, `"90d"`, `"180d"` — this order, hardcoded. `seg(days === d)` | Default `days = 60` (`:351`) | Always renders all five |
| D24 · Spacer | `:496` | `<span style={{ width: 10 }} />` — a bare 10px gap between the day group and the cohort group, on top of the row's `gap: 8` | none | n/a |
| D25 · Cohort — `"Taken"` | `COHORTS[0]`, key `"selected"` `:128` | `seg(cohort === "selected")`; `title` = *"The picks that made the board — what the cards actually showed."* | **Default** (`cohort = "selected"`, `:352`) | Always renders |
| D26 · Cohort — `"Passed on"` | `COHORTS[1]`, key `"shadow"` `:129` | `title` = *"Candidates that qualified and cleared the entry floor but ranked below the top 5. The control group."* | — | Always renders |
| D27 · Cohort — `"Both"` | `COHORTS[2]`, key `"all"` `:130` | `title` = *"Taken and passed-on together — the widest sample, and the least conditioned on selection."* | — | Always renders |
| D28 · `"↻"` | `:500` | `homeButtonStyle` + `padding: "6px 12px"; fontSize: 13`. `homeButtonStyle` = `borderRadius 6; border 1px rgba(33,158,188,.25); background linear-gradient(180deg,rgba(33,158,188,.12),rgba(33,158,188,.04)); color #219EBC; fontWeight 700; letterSpacing 0.08em; textTransform uppercase; cursor pointer` | `onClick={() => { load(); loadCal(); }}` — **`loadRule()` is deliberately NOT called.** The rule bar does not refresh on ↻; only arming, re-fitting or disarming refreshes it (D64, D65) | Never disabled, never shows a busy state — a second click while in flight starts a second unaborted request |
| D29 · Cohort hint line | `COHORTS.find((c) => c.key === cohort)?.hint ?? ""` `:460`, rendered `:522` | `fontSize: 12`, colour `HT.text`, `marginBottom: 14` | Repeats the active cohort's `title` text as body copy under the headline | Renders **inside** the `{data && …}` block, so it is absent until the first study response lands |

---

## D.4 — Error and loading states

Source: `PickStudyTab.tsx:359–360, 375–379, 386–390, 393–397, 503`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D30 · `"Error: {err}"` | `err` state `:503` | `color HT.red #EF4444; fontSize 13; padding 8px 0` | Rendered whenever `err` is truthy. **No `!loading` guard** — it stays on screen through the next fetch until that fetch's `setErr(null)` at `:370` | — |
| D31 · Error text — bad payload | `:377` → `setErr(j?.error \|\| "load failed")` | The server's `error` field, else the literal `"load failed"` | Fires when the response parses but `j.ok` is not truthy. **Also sets `setData(null)`** — see D32 | — |
| D32 · What an error erases | `:377` `setData(null)` | — | Everything inside `{data && (…)}` (`:505–614`) disappears: the headline row, the cohort hint, the verdict, both section labels, the bucket table and its footnote. The **calibration section survives** — it sits outside that block (`:617`) and reads `cal`/`rule`, not `data` | The tab collapses to: controls + error line + calibration block |
| D33 · Error text — network/parse | `:378` → `.catch((e) => setErr(String(e?.message \|\| e)))` | Raw exception message | Covers a rejected `fetch` and a JSON parse failure alike | — |
| D34 · Calibration errors | `loadCal` `:388–389` | **Silent.** `setCal(j?.ok ? j : null)` on success-shape, `setCal(null)` on throw | A failed or `ok:false` calibration response is indistinguishable on screen from *"the rule is not armed"* — both land on D82. There is no calibration error string anywhere in the file | Falls through to the not-armed prose (D82) |
| D35 · Rule errors | `loadRule` `:395–396` | **Silent.** `setRule(j?.ok ? j : null)` / `setRule(null)` | With `rule === null` the bar still renders, using its fallbacks — see D70's `auto` note, which mislabels this case | Rule bar shows *"Collecting evidence"* with `0/150` unless `cal` supplies numbers |
| D36 · Stale data during reload | `load` `:369–379` | — | `load()` sets `loading` and clears `err`, but **does not clear `data`**. Switching feature/window/cohort leaves the *previous* result fully rendered — table, headline, verdict, footnote — with only the subtitle's `" · loading…"` to say so. There is no skeleton, no dimming, no `.stale` treatment | Previous window's numbers, indistinguishable from live ones |

---

## D.5 — Headline row

Source: `PickStudyTab.tsx:508–521`. `flex; gap 20; flexWrap wrap; alignItems baseline; marginBottom 6`. All four spans are `fontSize 13`, colour `HT.text`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D37 · `"{n} graded picks"` | `data.overall.n` `:510` | Number in `<b style={{fontFamily: MONO, color: HT.cyan}}>` `#219EBC`, then the plural word in white | Pluralisation is `overall?.n === 1 ? "" : "s"` — so `1` → `"graded pick"`, everything else including `0` → `"graded picks"`. When `overall` is `undefined` the comparison is `false`, so it also reads `"graded picks"` | `overall?.n ?? 0` → renders `0` |
| D38 · `"A/B rate {x}%"` | `data.overall.pctGood` `:513` | `pct(v)` → 0 dp + `%`, in `<b>` mono, colour `HT.green` `#8ECAE6` | Colour is **unconditional** — a 12% A/B rate is painted the same light blue as an 80% one | `null` → `"—"`, still light blue |
| D39 · `"never green {x}%"` | `data.overall.pctNeverGreen` `:516` | `pct(v)`, `<b>` mono, colour `HT.red` `#EF4444` | Unconditional red | `null` → `"—"`, still red |
| D40 · `"avg {x}/100"` | `data.overall.avgPts` `:519` | `` `${avgPts.toFixed(0)}/100` `` — **0 dp, with a `/100` suffix**. `<b>` mono, **no colour override** so it inherits the parent span's `HT.text` white | none | `null` → `"—"` (no `/100` suffix on the dash) |

Note the `/100` suffix appears **only here**. The same field in the bucket table
(D53) and the calibration table (D89) renders as a bare `toFixed(0)`.

---

## D.6 — The control-group verdict

Source: `PickStudyTab.tsx:464–478` (the `useMemo`) and `:525–533` (the render).
Reads `data.cohorts` — which the server returns as `{selected, shadow} | null`
**independently of which cohort button is active**, so this sentence does not
change when you flip Taken/Passed on/Both.

Container: `fontSize 13; lineHeight 1.5; padding 8px 12px; borderRadius 8;
marginBottom 16; color {tone}; background tint(tone, 0.08); border 1px
tint(tone, 0.3)`. Prefixed by a literal `<b>Taken vs passed on · </b>`.

Branches, **in evaluation order**:

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D41 · Block absent | `:466` | — | Returns `null` — the whole box is not rendered — when `!data.cohorts`, or `cohorts.selected.pctGood == null`, or `cohorts.shadow.pctGood == null` | Nothing renders; no placeholder |
| D42 · *"Only {n} passed-on pick(s) recorded so far — the control group needs {minN}+ before this comparison means anything. It starts filling from the deploy that turned shadow recording on."* | `:467–469` | `n` = `cohorts.shadow.n`, raw integer. `minN` = `data.minN ?? 30` | Fires when **`cohorts.shadow.n < (data?.minN ?? 30)`** — strictly less than. `tone = HT.text` `#FFFFFF`, so the box is a white-on-white-wash neutral, not a warning | This is the state a fresh deploy sits in |
| D43 · *"Taken picks hit {X} vs {Y} for the ones passed on — a {D}pt gap. That is inside the noise: on this sample the top-5 cut is not doing measurable work."* | `:471–473` | `X` = `pct(selected.pctGood)`, `Y` = `pct(shadow.pctGood)`, `D` = `signed(selected.pctGood - shadow.pctGood)` — **all 0 dp** | Fires when **`Math.abs(d) < 5`** — strictly less than 5 points. `tone = HT.orange` `#FB8501` | — |
| D44 · *"Taken picks hit {X} vs {Y} passed on — {D}pts. The ranking is selecting something real."* | `:474–476` | Same three substitutions. Note the wording drops *"for the ones"* in this branch only | Fires when `d > 0` (having already failed `abs(d) < 5`, so effectively **`d >= 5`**). `tone = HT.green` `#8ECAE6` | — |
| D45 · *"Taken picks hit {X} vs {Y} for the ones passed on — {D}pts. The picks you skipped did BETTER. Check the ranking before tuning anything else."* | `:477` | Same. `D` carries its own `-` sign from `signed()` | The `else` — effectively **`d <= -5`**. `tone = HT.red` `#EF4444` | — |

**Rounding trap to carry into v3:** `d` is compared at full precision (`< 5`) but
printed through `signed(d)` at 0 dp. A gap of `4.6` takes the *"inside the noise"*
branch while printing `"+5pt"`, and `-4.6` likewise prints `"-5pts"` in an orange
box. The code is right; the sentence looks wrong. Reproduce the behaviour, or fix
it deliberately — do not fix it by accident.

---

## D.7 — Bucket table

Source: `PickStudyTab.tsx:536–612`. Wrapped in `<div style={{overflowX:"auto"}}>`.
Table: `width 100%; borderCollapse collapse; fontSize 13`.

### D.7a — Section labels

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D46 · Feature title | `/proxy/gex-change-top-study → label` `:536` | `fontSize 14; fontWeight 800; color HT.orange #FB8501; marginBottom 2` | Server string — the client never composes it | Absent with the rest of the `data &&` block |
| D47 · Feature note | `/proxy/gex-change-top-study → note` `:537` | `fontSize 12; color HT.text; marginBottom 10; maxWidth 780; lineHeight 1.5` | Server string | As above |

### D.7b — Columns, in render order (9)

Header row (`:542`): `color HT.green #8ECAE6; textTransform uppercase; fontSize 11`
— so every header below renders **upper-cased and light blue**. All nine use the
`th` style (D16). Sorting is `useTableSort<BucketSortKey>()` (`:366`); the
comparator is `bucketSortValue` (`:321–334`).

**Default sort: none.** `useTableSort()` is called with no argument and the
in-file comment (`:363–365`) states the cycle: *"Click a column title to sort;
click again to flip; a third click puts the rows back in the order the server sent
them (which is meaningful here — the buckets arrive in the feature's own order,
and grades arrive ranked)."* So first paint is **server order**, and the sort is a
**three-state** cycle, not the usual two.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D48 · `"BUCKET"` | `sortKey="bucket"` → `b.bucket` (string) `:323` | `th` + `textAlign: left` | String comparator. No `title` attribute | — |
| D49 · `"N"` | `sortKey="n"` → `b.n` (number) `:324` | `th` (right) | — | — |
| D50 · `"A/B RATE"` | `sortKey="pctGood"` → `b.pctGood` (`number \| null`) `:325` | `th` + `textAlign: left` | — | — |
| D51 · `"LIFT"` | `sortKey="lift"` → `b.lift` (`number \| null`) `:326` | `th` (right) | `title="Hit rate minus the window's overall hit rate. This is the number that matters."` | — |
| D52 · `"HOLDS"` | `sortKey="holds"` → `b.holds == null ? null : b.holds ? 1 : 0` `:328` | `th` (right) | `title="Does the split point the same way in BOTH halves of the window? A ✗ means it did not survive out of sample."` The `1/0/null` projection is commented at `:327` as *"Sorts ✓ above ✗ above —, which is the order you actually scan for"* — which holds only on a **descending** pass, and only if the shared sort sinks `null` | — |
| D53 · `"NEVER GREEN"` | `sortKey="neverGreen"` → `b.pctNeverGreen` `:329` — **note the sort key and the field name differ** | `th` (right) | — | — |
| D54 · `"AVG PTS"` | `sortKey="avgPts"` → `b.avgPts` `:330` | `th` (right) | — | — |
| D55 · `"MED. SUSTAINED"` | `sortKey="medSustained"` → `b.medSustained` `:331` | `th` (right) — the label carries a period after `Med` | `title="Median best gain that held for two consecutive snapshots — a fillable move, not a one-print spike."` | — |
| D56 · *(blank)* | `<th style={th} />` `:551` | Empty header over the copy-term column | **Not sortable** — a plain `<th>`, not a `SortTh` | Renders as an empty cell |

### D.7c — Row chrome and cell rendering

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D57 · Row divider | `:562` | `borderTop: 1px solid tint(HT.text, 0.06)` = `rgba(255,255,255,0.06)` | On **every** row including the first, so the table has a hairline directly under the header | — |
| D58 · Thin row dimming | `:563` → `opacity: b.thin ? 0.45 : 1` | Whole-row opacity | `b.thin` is decided **server-side** (the client never compares `n` to `minN` itself for this). Dims the entire `<tr>`, copy button included | — |
| D59 · Bucket cell | `b.bucket` `:565–566` | `td` + `textAlign left; fontWeight 800; fontFamily MONO` | — | Server string; no dash fallback |
| D60 · `"thin"` badge | `:567–570` | Literal lowercase `thin`. `marginLeft 6; fontSize 10; fontWeight 700; color HT.orange #FB8501` | Rendered iff `b.thin`. `title` = `` `Only ${b.n} pick(s) — under the ${data.minN} minimum. Not a finding yet.` `` — the `(s)` is literal, never resolved | Absent when not thin |
| D61 · `n` cell | `b.n` `:572` | `td` + mono. Raw integer, no thousands separator | — | Always a number per the type |
| D62 · A/B rate cell | `<RateBar v={b.pctGood} />` `:573` | `td` + `textAlign: left`. See D63 | — | See D63 |
| D63 · `RateBar` | `:134–147` | `inline-flex; alignItems center; gap 6; minWidth 96`. Track: `52 × 6 px; borderRadius 3; background tint(HT.text, 0.10)`. Fill: absolutely positioned, `borderRadius 3`, `width: Math.max(0, Math.min(100, v))%`, `background HT.cyan #219EBC`. Label: `fontFamily MONO; fontWeight 700`, text `pct(v)` (0 dp) | Bar width is **clamped to 0–100**, so a lift-style negative or an out-of-range value silently pins to an end. Fill colour is unconditional cyan — the bar encodes magnitude only, never a threshold | `v == null` → the whole component returns `<span style={{color: HT.text}}>—</span>` — **no track, no bar**, just an em dash. Layout shifts, because the 96px `minWidth` is not applied on this path |
| D64 · Lift cell | `b.lift` `:574–576` | `td` + `fontFamily MONO; fontWeight 800`. Text `` `${signed(b.lift)}pt` `` — **singular `pt`, no `s`**, at 0 dp | `color: liftColor(b.lift)` — see D14: `>= 8` light blue, `<= -8` red, otherwise white | `null` → `"—"` (bare dash, **no `pt` suffix**) and white |
| D65 · Holds cell | `b.holds` `:577–582` | `td` + mono. Glyph only | `null` → `"—"` white; `true` → `"✓"` in `HT.green` `#8ECAE6`; `false` → `"✗"` in `HT.red` `#EF4444` | `"—"` |
| D66 · Holds tooltip | `:578` | `` title={`First half ${pct(b.firstHalf.pctGood)} (n=${b.firstHalf.n}) · second half ${pct(b.secondHalf.pctGood)} (n=${b.secondHalf.n})`} `` | On the `<td>`, present on **every** row including the `"—"` ones. This is the **only** place `firstHalf` / `secondHalf` are read | A null half-rate renders `"—"` inside the tooltip |
| D67 · Never green cell | `b.pctNeverGreen` `:583–585` | `td` + mono, `pct(v)` 0 dp | **Conditional:** `(b.pctNeverGreen ?? 0) > (overall?.pctNeverGreen ?? 0)` → `HT.red` `#EF4444`, else `HT.text`. Strictly greater. Both sides coalesce `null` to `0`, so a bucket with **no** never-green figure compares as `0` and is never red | `null` → `"—"`, white (`0 > x` is false for any non-negative `x`) |
| D68 · Avg pts cell | `b.avgPts` `:586` | `td` + mono, `toFixed(0)` — **no `/100` suffix here**, unlike D40 | No colour rule | `null` → `"—"` |
| D69 · Med. sustained cell | `b.medSustained` `:587` | `td` + mono, `` `${signed(v)}%` `` — 0 dp, explicit sign, percent suffix | No colour rule | `null` → `"—"` (no `%`) |
| D70 · `"⧉ term"` button | `:588–600` | `homeButtonStyle` + `padding 2px 8px; fontSize 11`. Cell is `td` + `textAlign: right`. Label `"⧉ term"` idle | Idle: `color HT.text`, `borderColor HT.border rgba(255,255,255,0.10)` | Always rendered, on thin rows too (dimmed with the row) |
| D71 · `"✓ copied"` state | `copied === b.bucket` `:594–598` | Label swaps to `"✓ copied"` | `color HT.green #8ECAE6`, `borderColor tint(HT.green, 0.5)`. Reverts after **1600 ms** (`setTimeout`, `:455`) | The timer is not cleaned up on unmount — a `setCopied` after unmount is possible |
| D72 · Copy button tooltip | `:591` | Two lines joined by a literal `\n`: *"Copy this bucket as a projection-rule term for server-v2/config/pick-proj-rule.json."* / *"The SIGN is what the data supports; the magnitude (lift used directly as points) is a convention you should sanity-check."* | — | — |
| D73 · What is copied | `copyTerm` `:451–458` | `JSON.stringify({ by: data?.by ?? by, bucket: b.bucket, pts: Math.round(b.lift ?? 0) })` → e.g. `{"by":"score","bucket":"70-79","pts":12}` | `by` prefers the **server's echoed** `data.by` over the client's `by` state. `pts` is `Math.round` of the lift, and a `null` lift becomes **`0`** — a term that does nothing | Clipboard write is `navigator.clipboard?.writeText(...)`; the rejection handler is an empty block with the comment *"clipboard blocked — the table still shows the numbers"*. **A blocked clipboard is completely silent** — no `✓`, no error |
| D74 · `"No graded picks in this window yet."` | `data.buckets.length === 0` `:555–559` | `<td colSpan={9}>` + `td` overridden to `textAlign left; color HT.text; padding 14px 8px` | `colSpan={9}` **matches** the 9 columns — correct | This is the empty state for a valid response with no rows |

### D.7d — Footnote

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D75 · Bucket-table footnote | `:607–612` | `marginTop 8; fontSize 11; color HT.text; lineHeight 1.6; maxWidth 860`. Full text, with bold runs marked: *"Features come from the slot each pick was **first** flagged — the only source that cannot see the outcome. Lift is this bucket's A/B rate minus the window's. **Holds** recomputes the split on each half of the window separately (split at {splitDate}, by date so no session lands on both sides); a ✗ means it did not survive out of sample and is not a finding. Buckets under n={minN} are greyed."* Note the apostrophes are `&apos;` in source | `{splitDate}` = `data.splitDate ?? "—"`; `{minN}` = `data.minN`, raw. This is the **only** place `splitDate` is rendered | Renders whenever `data` exists, including when `buckets` is empty |

---

## D.8 — Calibration block

Source: `PickStudyTab.tsx:616–700`. Container: `marginTop 26; paddingTop 16;
borderTop 1px solid tint(HT.text, 0.10)`. **Outside** the `{data && …}` block, so
it renders even when the study fetch failed.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D76 · `"Calibration · grading the grader"` | Static `:618–620` | `fontSize 14; fontWeight 800; color HT.orange #FB8501; marginBottom 6` | Not upper-cased (unlike the Card title) | Always renders |

### D.8a — `RuleBar` (`:172–259`)

Container: `padding 10px 12px; borderRadius 8; marginBottom 4; background
tint(tone, 0.07); border 1px solid tint(tone, 0.28)`.

The three derived values that drive everything (`:180–184`):

- `armed = !!rule?.armed`
- `need = rule?.thresholds.minPicks ?? cal?.need ?? 150` — **three-deep fallback, final literal `150`**
- `have = cal?.have ?? cal?.n ?? 0` — **note `have` comes from the CALIBRATION response, `need` from the RULE response**
- `ready = have >= need` (inclusive)
- `tone = armed ? HT.green : ready ? HT.cyan : HT.orange`
- `busy = fitting !== ""`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D77 · Status word | `:199–201` | `fontSize 12; fontWeight 800; color {tone}` | Exactly three: **`"Armed"`** when `rule.armed` (green `#8ECAE6`); **`"Ready to arm"`** when not armed and `have >= need` (cyan `#219EBC`); **`"Collecting evidence"`** otherwise (orange `#FB8501`) | `rule === null` → not armed; with no `cal` either, `have = 0`, `need = 150` → *"Collecting evidence"* |
| D78 · Detail line — armed | `:204` | `` `${rule?.terms.length ?? 0} term(s) · base ${rule?.base ?? 50} · ${SOURCE[rule?.source ?? "none"] ?? rule?.source}${rule?.fittedAt ? ` · ${rule.fittedAt}` : ""}` `` — `fontSize 11; color HT.text`. `base` falls back to the literal **`50`**. `fittedAt` is printed **raw**, with no date formatting | `SOURCE` map (`:186–191`), verbatim: `env` → *"pinned by the GEX_CHANGE_TOP_PROJ_RULE env var"*; `file` → *"pinned by config/pick-proj-rule.json"*; `stored` → *"fitted from the study"*; `none` → *"none"*. An unrecognised `source` falls through to the raw string | `terms` missing → `0 term(s)`; the `(s)` is literal and never resolved even at 1 |
| D79 · Detail line — not armed | `:205` | `` `${have}/${need} graded picks${rule?.auto ? " · re-checked automatically after every EOD freeze" : " · auto-fit is OFF (GEX_CHANGE_TOP_AUTOFIT=0)"}` `` | **Bug to carry knowingly, not to port:** the ternary tests `rule?.auto`, so when the rule fetch **failed** (`rule === null`, D35) the line asserts *"auto-fit is OFF (GEX_CHANGE_TOP_AUTOFIT=0)"* — naming a specific env var setting the client has no evidence for. Unknown is rendered as a confident negative | `0/150 graded picks · auto-fit is OFF (GEX_CHANGE_TOP_AUTOFIT=0)` is the cold-start / rule-fetch-failed string |
| D80 · Fit button | `:208–212` | `homeButtonStyle` + `padding 4px 10px; fontSize 12`. Label: `fitting === "preview"` → **`"fitting…"`**; else `armed` → **`"Re-fit (preview)"`**; else → **`"Fit now"`** | `title="Dry run. Shows the terms the fit would arm and every bucket it rejected, without changing anything."` `disabled={busy}`, `opacity: busy ? 0.5 : 1` | Disabled during any of the three busy states, not just its own |
| D81 · Arm button | `:213–220` | Same metrics, plus `color HT.green #8ECAE6; borderColor tint(HT.green, 0.45)`. Label: `fitting === "arm"` → **`"arming…"`**; else `armed` → **`"Re-fit & store"`**; else → **`"Fit & arm"`** | `title="Run the fit and store the result. From the next capture on, every pick is stamped with a projected grade."` `disabled={busy}` | — |
| D82 · Disarm button | `:221–230` | Same metrics, plus `color HT.red #EF4444; borderColor tint(HT.red, 0.4)`. Label: `fitting === "disarm"` → **`"…"`** (bare ellipsis, no word); else **`"Disarm"`** | Rendered **only** when `armed && rule?.source === "stored"` — a rule pinned by `env` or `file` shows no Disarm button at all. `title="Clear the stored rule and stop projecting. Projections already stamped on past picks are left alone — they are the calibration."` | Absent entirely in every other state |
| D83 · Progress bar | `:233–240` | Track: `marginTop 8; height 5; borderRadius 3; background tint(HT.text, 0.10)`. Fill: `height 100%; borderRadius 3; background {tone}; width: Math.max(2, Math.min(100, (have / Math.max(1, need)) * 100))%` | Rendered **only when `!armed`**. Width has a **2% floor**, so zero progress still shows a stub. `need` is guarded to at least `1` against a divide-by-zero | With `have = 0` → a 2%-wide orange stub |
| D84 · Term chips | `:242–246` | `flex; flexWrap wrap; gap 6; marginTop 8`, one `TermChip` per term, keyed `` `${t.by}:${t.bucket}` `` | Rendered only when `armed && (rule?.terms.length ?? 0) > 0` | An armed rule with zero terms renders no chip row |
| D85 · `TermChip` | `:150–162` | `inline-flex; gap 6; alignItems baseline; fontFamily MONO; fontSize 11; padding 3px 8px; borderRadius 6; background tint(c, 0.10); border 1px solid tint(c, 0.28)`. Three parts: `{t.by}` in `HT.text`, `<b>{t.bucket}</b>` in `HT.text`, `<b>{signed(t.pts)}</b>` in `c` | **`c = t.pts >= 0 ? HT.green : HT.red`** — inclusive at zero, so a `0`-point term is a light-blue chip reading `"+0"` | — |
| D86 · Pinned-rule warning | `:248–253` | `marginTop 8; fontSize 11; color HT.orange #FB8501; lineHeight 1.5`. Text: *"A hand-written rule is pinning this ({X}). The auto-fit will still run and report, but it will not overwrite what you pinned."* where `{X}` = `rule.pinnedBy === "env" ? "env var" : "config/pick-proj-rule.json"` | Rendered whenever `rule?.pinnedBy` is truthy — **including when the rule is not armed** | Absent when `pinnedBy` is `null` |
| D87 · Rule note | `:254–256` | `marginTop 6; fontSize 11; color HT.text` — the server's `rule.note` verbatim | Rendered only when **`rule?.note && armed`** — an un-armed rule's note is swallowed | — |
| D88 · Fit error line | `:629` | `color HT.red #EF4444; fontSize 12; margin 8px 0` | Set from `j.error \|\| "fit failed"` on an `ok:false` body, or the thrown message. The two owner-gate throws produce the literal **`"owner-only — sign in as the owner to change the rule"`** (`:417`, `:439`) | Cleared at the start of the next fit/disarm |

### D.8b — `FitPreview` (`:268–312`)

Rendered when `fit` is non-null (`:630`); dismissed by the `✕` button, which sets
`fit = null`. Container: `marginTop 10; padding 10px 12px; borderRadius 8;
background tint(HT.text, 0.04); border 1px solid tint(tone, 0.25)` where
`tone = fit.armed ? HT.green : HT.orange`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D89 · Preview headline | `:277–279` | `<b style={{fontSize:12, color: tone}}>` | Three states: `fit.applied` → **`"Fit stored"`**; else `fit.armed` → **`"Fit result (not stored)"`**; else → **`"Nothing to arm"`**. Note `applied` wins over `armed`, so a stored fit reads *"Fit stored"* regardless | — |
| D90 · Reason | `fit.reason` `:280` | `flex 1; fontSize 11; color HT.text; lineHeight 1.5` — server string, printed raw | — | `undefined` renders as nothing (React drops it) |
| D91 · `"✕"` dismiss | `:281` | `homeButtonStyle` + `padding 2px 8px; fontSize 11` | `onClick` → `setFit(null)`. No `title` | — |
| D92 · Fit note | `fit.note` `:283` | `marginTop 6; fontSize 11; color HT.orange #FB8501` | Rendered iff truthy | — |
| D93 · Fit terms | `:284–288` | `flex; flexWrap wrap; gap 6; marginTop 8` — same `TermChip` as D85 | Rendered iff `fit.terms?.length` | — |
| D94 · `"{n} bucket(s) rejected — why"` | `:289–293` | A native `<details>`/`<summary>`, `marginTop 10`. Summary: `fontSize 11; color HT.text; cursor pointer` | Rendered iff `fit.rejected?.length`. **Collapsed by default** — no `open` attribute. The `(s)` is literal | — |
| D95 · Rejected list body | `:294` | `marginTop 6; maxHeight 220; overflowY auto` | Scrolls past ~220px of rows | — |
| D96 · Rejected row | `:295–305` | `flex; gap 8; fontSize 11; fontFamily MONO; padding 2px 0; color HT.text`. Five fixed-width cells in order: `r.by` (`minWidth 70`), `<b>{r.bucket}</b>` (`minWidth 90`), `` `n=${r.n}` `` (`minWidth 50`), lift (`minWidth 60`), `r.why` (`opacity 0.8`, no width) | `borderTop: i ? "1px solid tint(HT.text, 0.06)" : undefined` — divider on every row **except the first**. Lift cell: `color: liftColor(r.lift)` (D14), text `` `${signed(r.lift)}pt` `` or `"—"` | `r.lift == null` → `"—"`, white |

### D.8c — The "not armed" prose — **the exact condition**

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D97 · The gate | `:632` → `{!cal \|\| !cal.armed ? (…prose…) : (…table…)}` | — | **The prose renders when ANY of these holds:** (1) the calibration fetch **threw** — `.catch(() => setCal(null))` `:389`; (2) the response body's **`ok` was not truthy** — `setCal(j?.ok ? j : null)` `:388`; (3) the response was `ok` but **`armed !== true`**. `cal` is also `null` on first paint, before the fetch resolves, so **the prose is what the tab shows while the calibration request is in flight** | Initial paint, every failure mode, and genuine un-armed all render the identical block — they are not distinguishable on screen |
| D98 · Two sources of truth for "armed" | `:180` vs `:632` | — | The **rule bar** reads `rule.armed` (from `/proxy/gex-change-top-rule`); the **body** reads `cal.armed` (from `/proxy/gex-change-top-calibration`). They are separate fetches with separate failure modes, so the bar can read **"Armed"** with term chips while the body immediately below reads *"Nothing is being predicted yet"*. Reachable whenever the calibration route errors, or lags the rule route. `runFit(true)` and `disarm()` both refresh the pair (`:423`, `:442`) so the *normal* flows stay consistent; the ↻ button refreshes `cal` but **not** `rule` (D28), which is the other way to desynchronise them | — |
| D99 · Prose block | `:633–647` | `fontSize 12; color HT.text; lineHeight 1.6; maxWidth 860; marginTop 12`. Three paragraphs separated by `<br /><br />`. Verbatim: *"Nothing is being predicted yet, so there is nothing to calibrate. That is deliberate and it is not permanent: a projection seeded with plausible-looking guesses is indistinguishable on screen from one backed by evidence, so the rule stays inert until the study can support one — and then arms itself."* / *"The fit uses the same two filters this page tells you to read by eye: a bucket must be **not thin** and must **hold** in both halves of the window. Each surviving bucket becomes one term whose points are its measured lift, clamped. It refuses to fit on ticker, and drops the \|Δ GEX\| and \|% vs open\| terms when the blended Score already covers them, so one edge is never counted three times. Hit **Fit now** to see exactly what it would arm and everything it rejected."* / *"Hand-pinning still works and still wins: drop `server-v2/config/pick-proj-rule.json` and the auto-fit stands down rather than overwrite it."* | `not thin`, `hold` and `Fit now` are `<b>`. The filename is a `<code>` at `fontFamily MONO; color HT.cyan #219EBC` (`:645`) | This is the default state of the tab |

### D.8d — Calibration table (the `cal.armed` branch)

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D100 · Pre-table line | `:650–654` | `fontSize 12; color HT.text; margin 12px 0 10px`. Two strings: **`{n} pick(s) were captured before the rule was armed and carry no projection — they are excluded from this table, not counted as misses.`** or **`Every pick in the window carries a projection.`** | Chosen on **truthiness** of `cal.unprojected` — `0`, `undefined` and `null` all take the second string | Always one of the two |
| D101 · `"PREDICTED"` | `sortKey="projected"` `:659` | `th` + `textAlign left`, upper-cased light blue by the `<tr>` (`:658`, same as D48's row) | Comparator `:340`: `GRADES.indexOf(r.projected)`, with **unknown → `99`**. Commented *"By grade rank, not alphabetically — 'A+' must not land between 'A' and 'B'"*. Rank order: `A+`=0, `A`=1, `B`=2, `C`=3, `D`=4, `F`=5, unknown=99 | — |
| D102 · `"N"` | `sortKey="n"` → `r.n` `:660, :342` | `th` (right) | — | — |
| D103 · `"ACTUAL A/B"` | `sortKey="pctGood"` → `r.pctGood` `:661, :343` | `th` + `textAlign left` | — | — |
| D104 · `"NEVER GREEN"` | `sortKey="neverGreen"` → `r.pctNeverGreen` `:662, :344` | `th` (right) | — | — |
| D105 · `"AVG PTS"` | `sortKey="avgPts"` → `r.avgPts` `:663, :345` | `th` (right) | — | — |
| D106 · `"A+"` | `sortKey="g:A+"` `:664–667` | `th` (right) | `title="How many of these picks actually graded A+."` Comparator `:337`: `r.actual?.["A+"] ?? 0` — **missing sorts as 0, never as null** | — |
| D107 · `"A"` | `sortKey="g:A"` | `th` (right) | `title="How many of these picks actually graded A."` | — |
| D108 · `"B"` | `sortKey="g:B"` | `th` (right) | `title="How many of these picks actually graded B."` | — |
| D109 · `"C"` | `sortKey="g:C"` | `th` (right) | `title="How many of these picks actually graded C."` | — |
| D110 · `"D"` | `sortKey="g:D"` | `th` (right) | `title="How many of these picks actually graded D."` | — |
| D111 · `"F"` | `sortKey="g:F"` | `th` (right) | `title="How many of these picks actually graded F."` | — |
| D112 · Row chrome | `:672` | `borderTop 1px solid tint(HT.text, 0.06)`; `opacity: r.thin ? 0.45 : 1` | Thin rows are **greyed but carry no `"thin"` badge** — the bucket table's D60 badge has no counterpart here. `key={r.projected}` | — |
| D113 · Predicted cell | `r.projected` `:673` | `td` + `textAlign left; fontWeight 800; fontFamily MONO` | Server string, printed raw | — |
| D114 · `n` cell | `r.n` `:674` | `td` + mono | — | — |
| D115 · Actual A/B cell | `<RateBar v={r.pctGood} />` `:675` | `td` + `textAlign left`. Identical component to D63 | — | `null` → bare `"—"` |
| D116 · Never green cell | `r.pctNeverGreen` `:676` | `td` + mono, `pct(v)` 0 dp | **Unconditionally `HT.red` `#EF4444`** — unlike the bucket table's D67, which only reddens above the overall rate. Same semantic, two different rules, in two tables on the same screen | `null` → `"—"`, still red |
| D117 · Avg pts cell | `r.avgPts` `:677` | `td` + mono, `toFixed(0)`, no suffix | — | `null` → `"—"` |
| D118 · Grade count cells (×6) | `r.actual?.[g] ?? 0` `:678–682` | `td` + mono. Raw integer | `color: r.actual?.[g] ? HT.text : tint(HT.text, 0.3)` — a **zero renders as `0` at 30% white**, not as a dash. Truthiness test, so a `0` count and a missing key look identical | Missing key → `0`, dimmed |
| D119 · Empty row | `:685–689` | `<td colSpan={10}>` + `td` overridden to `textAlign left; color HT.text; padding 12px 8px`. Text: *"Rule is armed but no picks carry a projection yet — they start appearing at the next capture."* | **`colSpan={10}` against 11 columns** (5 + 6 grades). The cell under-spans by one — the last column sits outside it. Compare D74, which spans correctly. **Fix to 11 in v3** | Fires when `(cal.rows ?? []).length === 0` |
| D120 · Calibration footnote | `:693–697` | `marginTop 8; fontSize 11; color HT.text; lineHeight 1.6; maxWidth 860`. Verbatim: *"Read down the Predicted column: the A/B rate should rise monotonically from F to A+. If it does not, the rule is not ranking. Projections are stamped at capture and never recomputed, so retuning the rule leaves the old predictions intact — which is what makes this table a real out-of-sample test rather than a restatement."* | No bold runs | Renders with the table |

---

## D.9 — Data layer: every fetch

Source: `PickStudyTab.tsx:369–445`. **No polling anywhere on this tab.** No
`AbortController`, no `useEffect` cleanup on any of the five calls. No socket, no
`useFrame`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| D121 · Study fetch | `GET /proxy/gex-change-top-study` `:369–380` | Params, in `set()` order: **`days`** (`String(days)`, default `60`), **`by`** (default `"score"`), **`cohort`** (default `"selected"`). `{ cache: "no-store" }`. Built with `new URL(path, window.location.origin)` — same-origin, absolute | Fires from `useEffect(() => { load(); }, [load])` `:399` with `load` memoised on `[by, days, cohort]` — so **any** of the three controls refetches. Response `StudyResp` (`:64–78`): `{ok, error?, days, by, cohort, label, note, minN, splitDate, overall, cohorts, features[], buckets[]}` | On `!j.ok`: `setErr(j.error \|\| "load failed")` **and `setData(null)`**. On throw: `setErr(message)`, `data` **kept** (D36). `loading` set true at entry, cleared in `finally` |
| D122 · Calibration fetch | `GET /proxy/gex-change-top-calibration` `:382–390` | Params: **`days`**, **`cohort`**. **No `by`** — the calibration is not per-feature. `{ cache: "no-store" }` | `useEffect(…, [loadCal])` `:400`, memoised on `[days, cohort]` — so **changing the feature does not refetch it**. Response `CalResp` (`:83–91`) | `setCal(j?.ok ? j : null)`; `.catch(() => setCal(null))`. **Entirely silent** — see D34, D97 |
| D123 · Rule fetch | `GET /proxy/gex-change-top-rule` `:392–397` | **No params.** `{ cache: "no-store" }` | `useEffect(…, [loadRule])` `:401` with `loadRule` memoised on `[]` — **fires exactly once on mount**. Refetched only by `runFit(apply=true)` and `disarm()`. **Not** by the ↻ button | `setRule(j?.ok ? j : null)`; `.catch(() => setRule(null))`. Silent |
| D124 · Fit (dry run and apply) | `POST /proxy/gex-change-top-rule-fit` `:409–427` | Params: **`days` = `String(Math.max(days, 90))`** — the fit **floors the window at 90 days regardless of the day toggle**, so a 14d view fits on 90d; **`cohort`**; **`apply=1` only when applying**. `{ method: "POST" }` — **no body, no `content-type` header** | `setFitting(apply ? "arm" : "preview")` disables all three buttons. **`if (r.status === 401 \|\| r.status === 403) throw new Error("owner-only — sign in as the owner to change the rule")`** — the one place the client acknowledges the server-side gate. On success sets `fit`; on `!j.ok` also sets `fitErr = j.error \|\| "fit failed"`. When `apply`, chains `loadRule()` **then** `loadCal()` | `finally` clears `fitting`. A non-2xx that is not 401/403 falls through to `r.json()` and may throw a parse error into `fitErr` |
| D125 · Disarm | `POST /proxy/gex-change-top-rule` `:431–445` | `{ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clear: true }) }`. **Same path as the D123 GET**, distinguished by method | Same `401/403` → `"owner-only — sign in as the owner to change the rule"`. On success: `setFit(null)`, then `loadRule()`, then `loadCal()`. The response body is **fetched and discarded** — `.then(() => …)` ignores it, so a `{ok:false}` disarm reports success | `finally` clears `fitting` |
| D126 · No abort, no ordering guarantee | all five | — | None of the five calls aborts a predecessor. Toggling `days` twice quickly issues two study fetches; whichever resolves last wins, which may be the older window. The subtitle's `" · loading…"` clears on the **first** `finally`, so it can go quiet with a stale table still on screen | — |
| D127 · Parallel on mount | `:399–401` | Three independent `useEffect`s | The three GETs fire in the same commit — **not** a waterfall, which satisfies v3 non-negotiable #3 as written. The only chaining is post-mutation (`loadRule` → `loadCal` after a fit/disarm), which is correct sequencing, not a waterfall | — |

---

### Colours used

Every colour on this tab is a JS string from `HOME_THEME` or a `tint()` of one.
There is not a single hex literal typed into `PickStudyTab.tsx` — but there is not
a single CSS variable either, so **all of it violates v3 non-negotiable #1** and
must be re-keyed.

| v2 value | Where used | Exists in v3 `tokens.css`? | Proposed v3 token |
|---|---|---|---|
| `HT.cyan` `#219EBC` | `RateBar` fill (both tables); headline graded-pick count; `"Ready to arm"` tone; the `<code>` filename in the not-armed prose; `seg()` active border + wash; `homeButtonStyle` border/background/text (↻, ⧉ term, all four rule buttons) | yes — `--color-v2-cyan` | `T.cyan` (`--color-accent`). Do **not** reach for `--color-v2-cyan`: that block is scoped to `/v3/analytics` only (`tokens.css:200–221`) |
| `HT.green` `#8ECAE6` — **a light blue, not a green** | Both table header rows; headline A/B rate; `✓` Holds glyph; `liftColor` positive (`>= 8`); positive `TermChip`; `"Armed"` tone; Arm-button text + border; `"✓ copied"`; `Card` subtitle | yes — `--color-v2-green` | `T.green` (`--color-up` `#35c28e`) for every **semantic positive** (D14 lift, D65 ✓, D85 chip, D77 Armed, D71 copied). See the collapse note below |
| `HT.red` `#EF4444` | Study error line; fit error line; headline never-green; `✗` Holds glyph; `liftColor` negative (`<= -8`); bucket never-green when above overall; **calibration never-green unconditionally**; negative `TermChip`; Disarm button; red verdict | yes — `--color-v2-red` / `--color-impact-high` | `T.red` (`--color-down` `#e0645f`) |
| `HT.orange` `#FB8501` | `data.label` section title; `"Calibration · grading the grader"`; `"thin"` badge; `"Collecting evidence"` tone; pinned-rule warning; `fit.note`; `FitPreview` un-armed tone; orange verdict | yes — `--color-v2-orange` | `T.orange` (`--color-warn` `#e0a44a`) |
| `HT.text` `#FFFFFF` | All body copy, `td` default, neutral `liftColor`, neutral verdict tone, `"⧉ term"` idle, all `TermChip` label text | yes — `--color-fg` | `T.text` |
| `HT.border` `rgba(255,255,255,0.10)` | `"⧉ term"` idle border | no exact | `alpha(T.text, .10)` — **not** `--color-line`, which is opaque `#23272e` |
| `HT.panelBg` `rgba(13,17,25,0.45)` | Card plate (`classicCardAccentStyle`) | no exact | `alpha(V2.panel, .45)` or `T.panel` |
| `HT.purple` `#126783` | The tab **pill** accent in `scannerNav.ts:59`. Never painted by `PickStudyTab.tsx` itself | yes — `--color-v2-purple`; `T.purple` maps to `--color-dex` `#1f8dad` | `T.purple` |
| `tint(HT.text, 0.10)` `rgba(255,255,255,0.10)` | `RateBar` track; progress-bar track; calibration section `borderTop` | no exact | `alpha(T.text, .10)` |
| `tint(HT.text, 0.06)` `rgba(255,255,255,0.06)` | Row dividers in both tables; rejected-list dividers | no exact | `alpha(T.text, .06)` |
| `tint(HT.text, 0.04)` `rgba(255,255,255,0.04)` | `FitPreview` background | no exact | `alpha(T.text, .04)` |
| `tint(HT.text, 0.3)` `rgba(255,255,255,0.3)` | A zero grade count in the calibration table | no exact | `alpha(T.text, .3)` |
| `tint(tone, 0.07)` / `0.28` | `RuleBar` background / border, where `tone` ∈ {green, cyan, orange} | no | `alpha(<tone token>, .07)` / `.28` |
| `tint(tone, 0.08)` / `0.3` | Verdict box background / border, `tone` ∈ {white, orange, green, red} | no | `alpha(<tone token>, .08)` / `.3` |
| `tint(c, 0.10)` / `0.28` | `TermChip` background / border, `c` ∈ {green, red} | no | `alpha(<tone token>, .10)` / `.28` |
| `tint(HT.green, 0.5)` | `"✓ copied"` border | no | `alpha(T.green, .5)` |
| `tint(HT.green, 0.45)` | Arm-button border | no | `alpha(T.green, .45)` |
| `tint(HT.red, 0.4)` | Disarm-button border | no | `alpha(T.red, .4)` |
| `tint(tone, 0.25)` | `FitPreview` border | no | `alpha(<tone token>, .25)` |
| `rgba(255,255,255,0.15)` | `seg()` inactive border (`scannerStyles.ts:34`) | no exact | `alpha(T.text, .15)` |
| `rgba(255,255,255,0.7)` | `seg()` inactive text | no exact | `alpha(T.text, .7)` — or just `T.muted`, which is `#ffffff` today |
| `rgba(33,158,188,0.15)` | `seg()` active background | no exact | `alpha(T.cyan, .15)` |
| `rgba(33,158,188,.25)` / `.12` / `.04` | `homeButtonStyle` border and gradient stops | no exact | `alpha(T.cyan, .25)` / `.12` / `.04` |
| `rgba(0,0,0,0.22)` | Card `boxShadow` | yes — `--color-shadow` is `#000000` | `alpha(SHADOW, .22)` |
| `var(--font-mono)` | Every numeric cell, both tables, `TermChip`, rejected rows, the `<code>` filename | yes — `--font-mono` | unchanged |

**Collapse these in the port — v2 painted one semantic with several values, and
several semantics with one value.**

1. **`HT.green` `#8ECAE6` is doing four unrelated jobs at once**: chrome (both
   table header rows), a semantic positive (`✓`, a `>= 8` lift, a positive term
   chip), a state (`"Armed"`), and a transient confirmation (`"✓ copied"`). The
   result is that **a positive lift is painted the exact same colour as the
   column headings above it** — the strongest signal in the table is the same
   light blue as its own chrome. In v3, headers take `T.muted`; only the
   semantics take `T.green`.
2. **Two "never green" rules for one column name.** The bucket table (D67) reddens
   only when the bucket beats the window's overall rate; the calibration table
   (D116) reddens **always**. Two tables, same header string `NEVER GREEN`, two
   different meanings for the colour red. Pick one — the conditional rule is the
   informative one — and use it in both.
3. **Two "positive" hues.** `HT.cyan` fills the `RateBar` (a magnitude) while
   `HT.green` colours the lift beside it (a signed quantity). Keep them distinct
   in v3 — the bar is deliberately *not* a threshold mark — but say so in a
   comment, because the next reader will try to unify them.
4. **`liftColor`'s dead-band and its null both paint `HT.text`.** A `0` lift and a
   *missing* lift are the same white. If v3 wants those distinguishable, use
   `T.flat` for the dead-band and `T.faint` for null.

---

### Do not port

1. **`import type { CSSProperties } from "react"` (`:41`) — dead.** `CSSProperties`
   is never referenced anywhere in the 703-line file. Drop it.
2. **Type fields the component never reads.** Transcribe the *runtime* shape, not
   the declared one. `CalResp` declares `error`, `base`, `minN`, `terms`,
   `overall`, `note`, `auto`, `source`, `pinnedBy`, `fittedAt`, `days` — of which
   only `ok`, `armed`, `unprojected`, `rows`, `have`, `n`, `need` are ever read.
   `RuleState` declares `fitDays` and `lastFit` (neither read) and
   `thresholds: {minPicks, minLift, maxTerms, maxPts}` of which **only `minPicks`**
   is read. `FitResp` declares `changed`, `have`, `need`, `days`, `pinnedBy` —
   none read. Porting the types wholesale imports a contract v3 does not use.
3. **`tint()` (`:109–112`) — a verbatim duplicate** of `themeRgba` in
   `homeTheme.ts:63–69`. v3 has `alpha()` in `src/design/theme.ts`. Delete, do not
   re-implement.
4. **`HOME_THEME` / `homeButtonStyle` / `seg()` / `th` / `td` — all v2 chrome.**
   Every colour reaches the DOM as an inline style string from a JS constant.
   Violates non-negotiable #1 wholesale. Nothing here can be ported by copy.
5. **`Card variant="budget"` and `PageShell`** (`components/shared/PageCard.tsx`) —
   v2 page chrome. The `accent` prop is already documented as ignored
   (`PageCard.tsx:23–33`); do not carry the prop forward at all.
6. **The `⧉ term` copy button (D70–D73) is arguably obsolete by this file's own
   account.** The header comment (`:28–37`) says the hand-written
   `server-v2/config/pick-proj-rule.json` procedure is the thing the auto-fit
   replaced — *"a procedure nobody runs on a schedule"* — and D80–D82's buttons do
   the job in-app with a preview and a rejection audit. The copy button emits a
   JSON fragment for exactly that superseded file. It is also the one control that
   can silently do nothing (a blocked clipboard, D73). **Brandon question, not a
   unilateral cut** — see Open questions.
7. **`colSpan={10}` on the calibration empty row (`:686`)** against 11 columns.
   Port as `colSpan={11}`. This is a straight bug, not a behaviour to preserve.
8. **D79's `rule?.auto` ternary** asserting `"auto-fit is OFF
   (GEX_CHANGE_TOP_AUTOFIT=0)"` when the rule fetch merely *failed*. v3 needs a
   third string for "rule state unknown", or it must not claim a setting it has no
   evidence for.
9. **Silent failure on two of three reads (D34, D35).** v3's `useQuery`
   (`src/data/api.ts:122`) carries an error channel; use it. A calibration route
   that 500s must not render as *"nothing is being predicted yet"*.
10. **No `AbortController` on any of the five calls (D126).** v3's `query()` /
    `useQuery()` handle this; hand-rolled `fetch` chains must not come across.
11. **The un-cleaned `setTimeout` in `copyTerm` (`:455`)** — 1600 ms, no
    `clearTimeout` on unmount. If the button survives (#6), the timer must not.
12. **`SortTh` name collision.** `components/pages/Scanner.tsx:291` defines a
    *local* `SortTh` with a completely different API (`label` / `col` / `sortKey` /
    `sortDir` / `onSort`, two-state, prints `" ▲"` / `" ▼"`). `PickStudyTab`
    imports a *different* `SortTh` from `@/components/shared/useTableSort` with a
    three-state cycle. Two components, one name, one file apart. v3 gets **one**
    sortable-header primitive.
13. **Nothing here touches a socket or a canvas**, so non-negotiables #2, #4, #6
    are not at risk on this tab. #5 (`handle.visible()`) is currently *worse* than
    unimplemented: the tab has no visibility awareness at all, but since it also
    has no polling, an off-screen tab costs nothing. If v3 adds polling, add
    visibility gating with it.
14. **v2-only routing chrome in the gate:** `next/link` and `useRouter` in
    `ScannerTabsBar.tsx:19–20`, the `SCANNER_TAB_EVENT` window-event hack
    (`scannerNav.ts:139–150`, `Scanner.tsx:3080–3087`) that exists only because
    React Router will not remount for a query-only change, and `readTabFromUrl()`'s
    effect-based param read (`scannerNav.ts:128–137`) that exists only to dodge
    Next's `useSearchParams` Suspense requirement. v3 routes the tab properly and
    needs none of the three.

---

### Open questions for Brandon

1. **`components/shared/useTableSort` is not staged.** Both tables' entire sort
   behaviour depends on it and it cannot be transcribed. Specifically unresolved:
   (a) does `apply()` sort **ascending or descending on the first click**;
   (b) where do `null`s land — D52's `1/0/null` comment claims *"✓ above ✗ above
   —"*, which only works if `null` sinks on a descending pass, and D106's `?? 0`
   for grade counts says the two tables handle missing values differently;
   (c) is there a **tie-break** (e.g. by the original index) or is it an unstable
   sort; (d) does `SortTh` render a direction glyph, and does it recolour when
   active the way `Scanner.tsx:298` does. Please stage the file, or confirm the v3
   primitive's semantics and I will re-derive from that.
2. **`components/shared/useIsOwner` is not staged.** Its return shape
   (`{isOwner, loaded}`) is certain from three call sites, but its body is not.
   Does it read the same `useAuth().isOwnerClaim || userId === NEXT_PUBLIC_OWNER_USER_ID`
   expression that `ProbeButton.tsx:21–26` and `IbStatsTab.tsx:1374–1378` each
   inline separately? And what makes `loaded` flip — a session fetch resolving, or
   Clerk/`AuthProvider` hydration? v3 needs one owner hook, and it needs to know
   what `loaded` is waiting on.
3. **Which of the five `/proxy/gex-change-top-*` routes have server-side owner
   gates today?** The client proves a gate exists on `…-rule-fit` and `…-rule`
   POST (it branches on `401/403`, D124/D125). It proves **nothing** about
   `…-study`, `…-calibration` and `…-rule` GET. Given the tab is owner-only
   because it is *"research in progress, not a customer view"*
   (`scannerNav.ts:56–58`), the three read routes should be gated too — please
   confirm they are, because the chrome gate is not one.
4. **The feature list (D22) is server-driven** (`features[]` on the study
   response). The v3 parity check cannot assert on option labels I have never
   seen. Can you paste the current `features` array — keys and labels, in order —
   so it can be pinned?
5. **Does the `⧉ term` copy button stay?** (Do-not-port #6.) The header comment
   says the file it targets is the superseded manual path; the in-app fit does the
   same job with an audit trail. Cut it, or keep it as an escape hatch for
   hand-pinning — which the prose at D99 says still works and still wins.
6. **`Math.max(days, 90)` on the fit (D124)** — the fit ignores the day toggle
   below 90d. Intended floor, or should the fit refuse rather than silently widen?
   Today a user on the 14d view clicks *"Fit now"* and gets a 90d fit with no
   indication the window changed.
7. **Two sources of truth for "armed" (D98).** Should v3 keep `rule.armed` and
   `cal.armed` as separate reads, or derive the body's gate from the rule state so
   the bar and the block below it cannot disagree?
8. **`base ?? 50` (D78) and `need ?? 150` (D77)** are client-side literals standing
   in for server values. Are `50` and `150` the real server defaults? If so they
   belong in one place, not hardcoded on the render path.
9. **Nothing on this tab persists** — feature, window and cohort all reset to
   `score` / `60d` / `Taken` on every mount, and the URL never records them. Should
   v3 put them in the query string (the way `em.md`'s Part A row records was
   fixed for `?ticker=`), so a finding can be shared by copying the address bar?

**Part D row count: 127**
# Part E — Strike Query (`?tab=strike`)

**Scope.** The `/scanner?tab=strike` tab, which is one inline component in the
scanner page file — there is no separate file for it.

| Layer | File | Lines |
|---|---|---|
| Tab registration (id, label, short, colour, icon) | `components/scanner/scannerNav.ts` | 49–61 (`SCANNER_TABS`), 104 (`SCANNER_GROUPS.gamma`) |
| Tab mount | `components/pages/Scanner.tsx` → `ScannerPage` | 3090–3098 (`{visibleTab === "strike" && <StrikeQueryScanner />}` at 3094) |
| Owner gate | `components/pages/Scanner.tsx` | 3049–3066 (`OWNER_ONLY_TABS`) |
| Banner comment | `components/pages/Scanner.tsx` | 599–601 |
| Fallback universe | `components/pages/Scanner.tsx` → `SQ_FALLBACK` | 603 |
| Row / column types | `components/pages/Scanner.tsx` → `SqRow`, `SqCol` | 605–617 |
| Accessor | `components/pages/Scanner.tsx` → `sqVal` | 619–622 |
| The tab | `components/pages/Scanner.tsx` → `StrikeQueryScanner()` | 624–879 |
| Unused modal helper | `components/pages/Scanner.tsx` → `ModalPortal` | 881–903 (doc comment 881–895, function 896–903) |
| Shared styles / formatters | `components/scanner/scannerStyles.ts` | whole file (43 lines) |
| Dropdown component | `components/shared/ThemedSelect.tsx` | whole file |
| Card / shell | `components/shared/PageCard.tsx` → `Card`, `PageShell` | 41–77 (`PageShell`), 84–145 (`Card`) |
| Palette | `components/shared/homeTheme.ts` → `HOME_THEME`, `DOCK_THEME` | 3–18, 258–271 |

Two facts that shape everything below:

1. **The tab has exactly one Card.** No modal, no second panel, no legend row,
   no event log. `Card` → toolbar → Top-10 card grid → one table. That is the
   whole tab.
2. **Only `symbol` refetches.** `load` is a `useCallback` with deps
   `[symbol, watchlist.length]` (679). Expiry, Limit, direction, min-OTM,
   card-scope and the sort column are all **pure client-side re-derivations of
   `rows` already in state** — none of them touches the network. This is the
   single most important thing to preserve in the port, because a naive v3
   rebuild that puts every control in a query key turns one fetch into six.

`HT` below = `HOME_THEME` from `components/shared/homeTheme.ts`.
`DT` = `DOCK_THEME` from the same file.

---

## E.0 — Tab plumbing

Source: `scannerNav.ts:49–61, 104, 122, 133–137, 145`; `Scanner.tsx:50, 3049–3098`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **E1** `"Strike Query"` — the tab pill in `ScannerTabsBar` | `SCANNER_TABS` entry `{ id: "strike", label: "Strike Query", short: "Strike", color: HOME_THEME.cyan, icon: "🎯" }` (`scannerNav.ts:60`) | Full label `"Strike Query"` in the on-page tab bar | Pill accent `HT.cyan` `#219EBC` | Always renders |
| **E2** `"🎯 Strike"` — the toolbar sub-strip pill | Same entry: `short: "Strike"`, `icon: "🎯"` | Compact label used only where the whole row must fit one line | Same `HT.cyan` accent | Always renders |
| **E3** Sub-strip grouping | `SCANNER_GROUPS` key `"gamma"` = `["gexlevels", "gexchangetop", "pickstudy", "strike"]` (`scannerNav.ts:104`) | Strike Query is the **4th and last** pill in the gamma cluster | Hairline divider after it, before the `structure` cluster | n/a |
| **E4** Deep link | `readTabFromUrl()` (`scannerNav.ts:133–137`) → `new URLSearchParams(window.location.search).get("tab")`, validated by `isScannerTabId`; applied in a mount effect (`Scanner.tsx:3072–3075`) | `/scanner?tab=strike` | Runs in an effect, not `useSearchParams`, so the page stays prerenderable | On first paint the **default tab** (`"gexchangetop"`) renders, then swaps on mount. An invalid `?tab=` value is ignored and the default stands |
| **E5** In-page tab switch from the toolbar | `SCANNER_TAB_EVENT = "cb:scanner-tab"` (`scannerNav.ts:145`), listened for at `Scanner.tsx:3081–3088` | `window.dispatchEvent(new CustomEvent("cb:scanner-tab", { detail: "strike" }))` | Exists because React Router does not remount on a query-string-only change | n/a |
| **E6** Owner gating | `OWNER_ONLY_TABS = new Set(SCANNER_TABS.filter(t => t.ownerOnly).map(t => t.id))` (`Scanner.tsx:3049–3051`) | **`strike` has no `ownerOnly` flag** — the tab is public. Only `pickstudy` is owner-only | `useIsOwner()` never affects this tab | n/a |
| **E7** Page wrapper | `<PageShell>` (`Scanner.tsx:3091`) | `homeShellStyle` + `homeContentStyle`, `overflow:auto`, `alignItems:stretch`, padding `clamp(14px,2vw,24px)`, gap `clamp(16px,2vw,32px)` | Background `HT.bg` `#05060A` + `HT.shellGlow` (two radials: `circle at 15% 50% rgba(33,158,188,0.04) → transparent 50%`, `circle at 85% 30% rgba(18,103,131,0.05) → transparent 50%`) | Always renders |

---

## E.1 — Shared helpers, written out

Source: `components/scanner/scannerStyles.ts:16–43`.

Only **five** of this module's exports are reachable from this tab: `fmtB`,
`seg`, `td`, `th`, and (imported but unused) `NEUTRAL` and `zColor`. `fmtInt`
and `fmtChg` are not imported by the Strike Query block at all.

```ts
export const NEUTRAL = "#6B7280";

export const fmtB = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? "-" : "+";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(0)}`;
};

export const th: CSSProperties = {
  padding: "6px 10px", textAlign: "right", fontWeight: 700, letterSpacing: "0.05em",
};

export const td: CSSProperties = {
  padding: "6px 10px", textAlign: "right", color: HOME_THEME.text,
};

export const seg = (active: boolean): CSSProperties => ({
  padding: "6px 14px", borderRadius: 8, fontSize: 14, cursor: "pointer", fontWeight: 700,
  border: `1px solid ${active ? HOME_THEME.cyan : "rgba(255,255,255,0.15)"}`,
  background: active ? "rgba(33,158,188,0.15)" : "transparent",
  color: active ? HOME_THEME.text : "rgba(255,255,255,0.7)",
});

export const zColor = (z: number | null) =>
  z == null ? "rgba(255,255,255,0.4)"
  : Math.abs(z) >= 3 ? HOME_THEME.red
  : Math.abs(z) >= 2 ? HOME_THEME.orange
  : HOME_THEME.text;
```

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **E8** `fmtB(n)` — every money-ish figure on this tab | `scannerStyles.ts:18–24` | **Always signed.** `s = n < 0 ? "-" : "+"`, so `fmtB(0)` renders `"+0"` and there is no unsigned form. Magnitude ladder on `a = Math.abs(n)`: `a >= 1e9` → `${s}${(a/1e9).toFixed(2)}B` (**2** dp); `a >= 1e6` → `${s}${(a/1e6).toFixed(1)}M` (**1** dp); `a >= 1e3` → `${s}${(a/1e3).toFixed(1)}K` (**1** dp); else `${s}${a.toFixed(0)}` (**0** dp, no thousands separator) | Boundaries are `>=`, so exactly `1_000_000_000` → `"+1.00B"`, `999_999_999` → `"+1000.0M"`. No colour of its own — the caller sets it | `fmtB` is never called with `null` on this tab: every call site null-checks first (E63–E65) or the field is non-nullable |
| **E9** `th` — every column header cell | `scannerStyles.ts:29` | `padding: 6px 10px`, `textAlign: right`, `fontWeight: 700`, `letterSpacing: 0.05em`. **No `fontSize`** — inherits `14` from the `<table>` and the `<tr>` | No colour of its own; the `<tr>` sets `HT.green`, and the sortable heads override per-column (E55) | n/a |
| **E10** `td` — every body cell | `scannerStyles.ts:30` | `padding: 6px 10px`, `textAlign: right`, `color: HT.text` `#FFFFFF` | Overridden per column where a rule applies (E62–E65, E60) | n/a |
| **E11** `seg(active)` — every button on this tab | `scannerStyles.ts:32–37` | `padding: 6px 14px`, `borderRadius: 8`, `fontSize: 14`, `fontWeight: 700`, `cursor: pointer` | `active === true`: border `1px solid HT.cyan` `#219EBC`, background `rgba(33,158,188,0.15)`, colour `HT.text` `#FFFFFF`. `active === false`: border `1px solid rgba(255,255,255,0.15)`, background `transparent`, colour `rgba(255,255,255,0.7)` | n/a |
| **E12** `NEUTRAL = "#6B7280"` | `scannerStyles.ts:16` | Imported at `Scanner.tsx:41` | **Never referenced anywhere in the Strike Query block.** Used only by other tabs in the same file | n/a — do not port into the Strike Query view |
| **E13** `zColor(z)` | `scannerStyles.ts:39–43` | Imported at `Scanner.tsx:41`. Ladder: `z == null` → `rgba(255,255,255,0.4)`; `Math.abs(z) >= 3` → `HT.red`; `Math.abs(z) >= 2` → `HT.orange`; else `HT.text` | **Never referenced anywhere in the Strike Query block.** Used only by other tabs | n/a — do not port into the Strike Query view |

---

## E.2 — Data layer

Source: `Scanner.tsx:603–622, 625–681`.

### The row shape (`Scanner.tsx:605–617`)

```ts
type SqRow = {
  symbol: string;
  expiry: string;
  strike: number;
  gex_now: number;
  delta_abs: number;
  chg15: number | null;
  chg30: number | null;
  chg60: number | null;
  spot?: number | null;
};

type SqCol = "strike" | "gex_now" | "chg15" | "chg30" | "chg60" | "delta_abs";

const sqVal = (r: SqRow, c: SqCol): number => {
  const v = c === "strike" ? r.strike : r[c];
  return v == null ? 0 : Number(v);
};
```

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **E14** Watchlist fetch | `GET /proxy/strike-growth/watchlist` (`Scanner.tsx:641`) | **No query params. No `cache` option** (so default browser caching applies, unlike the by-expiry call). No `AbortController` | Fires **once**, from `useEffect(() => { void refreshWatchlist(); }, [refreshWatchlist])` (655) with `refreshWatchlist` a `useCallback(…, [])` — a stable identity, so exactly one call per mount | `.catch(() => {})` — a network failure is **silently swallowed**. No error text, no retry, no console line |
| **E15** Watchlist parse | `d.ok` must be truthy, else `return` with no state change. Then `d.rows.filter(r => r.active).map(r => r.symbol).sort()` (`Scanner.tsx:644–646`) | Response shape: `{ ok: boolean, rows: { symbol: string, active: boolean }[] }`. `.sort()` is a **default lexicographic string sort**, no comparator | `if (active.length > 0) setWatchlist(active)` — an all-inactive watchlist leaves state at `[]` and the fallback stands | `d.ok === false` or 0 active symbols → `watchlist` stays `[]` |
| **E16** `symbolList` — the universe actually queried | `watchlist.length > 0 ? watchlist : SQ_FALLBACK` (`Scanner.tsx:638`) | `SQ_FALLBACK` (603) is exactly, in this hardcoded order: **`SPX · SPY · QQQ · NVDA · AAPL · TSLA · AMZN · META · MSFT · GOOGL`** — 10 tickers, not sorted | Fallback also feeds the Ticker dropdown, so before the watchlist lands the dropdown shows these 10 in this order; after, it shows the alphabetically sorted active watchlist | The fallback IS the first-paint universe — the tab never renders an empty dropdown |
| **E17** Per-symbol GEX fetch | `GET /proxy/strike-growth/by-expiry?symbol={sym}` with `{ cache: "no-store" }` (`Scanner.tsx:664`) | One request **per ticker**, fired with `Promise.all` over `targets` (661–670). `targets = symbol === "ALL" ? symbolList : [symbol]` (660) — so **"ALL" fires 10+ parallel requests**, a fan-out, not a waterfall. `sym` is interpolated raw, un-encoded | `j.ok` falsy → `return []` for that symbol. Any throw inside the mapper → `catch { return [] }` (668), so **one dead ticker silently contributes zero rows** and the rest still render | While in flight, `rows` keeps its **previous** contents — `setRows` is only called after all promises settle (672), so the table shows stale data rather than blanking |
| **E18** Response shape | `{ ok: boolean, rows: SqRow[] }` | Each row is re-stamped `{ ...r, symbol: sym }` (667) — **the client overwrites whatever `symbol` the API sent** with the symbol it asked for | — | — |
| **E19** Merge | `results.flat()` → `setRows(all)` (671–672) | Concatenation in `targets` order, i.e. `symbolList` order, then the API's row order within each ticker. **No dedupe, no re-sort at merge time** | This concatenation order is the stable-sort tie-break for every comparator below | — |
| **E20** Expiry option list | `[...new Set<string>(all.map(r => r.expiry))].sort()` (673) | Default lexicographic string sort. For ISO `YYYY-MM-DD` strings that is also chronological; for any other format it is not | Recomputed on every successful `load` | Empty array → the Expiry dropdown holds only `"All Expiries"` |
| **E21** Expiry reset on reload | `setExpiry(prev => (prev === "ALL" \|\| exps.includes(prev) ? prev : "ALL"))` (675) | A selected expiry that no longer exists in the new data snaps back to `"ALL"` | — | — |
| **E22** Loading flag | `setLoading(true)` at the top of `load`, `setLoading(false)` in `finally` (658, 677) | Drives only the subtitle suffix (E37) and the empty-state gate (E67) | No spinner, no skeleton, no dimming | — |
| **E23** Error flag | `setErr(String(e?.message \|\| e))` in the **outer** catch (676) | — | **Near-unreachable.** Every per-symbol fetch is wrapped in its own `try/catch` that returns `[]`, and `Promise.all` over never-rejecting promises cannot reject. Only a synchronous throw in the merge lines (671–675) could set it | `err` renders as a banner (E66) and suppresses the empty-state row |
| **E24** What refetches | `load` is `useCallback(…, [symbol, watchlist.length])` (679), consumed by `useEffect(() => { load(); }, [load])` (681) | Refetch fires on: **mount**, **Ticker change**, and **the watchlist arriving** (`watchlist.length` going 0 → n) | The `eslint-disable react-hooks/exhaustive-deps` on 678 is deliberate: `symbolList` is a fresh array each render and would loop | Changing Expiry, Limit, direction, min-OTM, card scope or sort column **does not refetch** |
| **E25** Manual refetch | `↻ Refresh` button → `onClick={() => load()}` (`Scanner.tsx:781`) | Re-runs the same fan-out | Also re-runs the expiry-reset logic (E21) | Not disabled while `loading` — a double click fires two overlapping fan-outs, and the later `setRows` wins by arrival order, not by request order |
| **E26** Polling | — | **There is none.** No `setInterval`, no visibility hook, no market-hours gate anywhere in this tab | — | Data only moves on mount, ticker change, or the Refresh button |
| **E27** Abort | — | **No `AbortController` on either endpoint.** Switching ticker mid-flight leaves the old fan-out running; whichever `setRows` resolves last wins | — | A stale response can overwrite a newer one |
| **E28** `sqVal(r, c)` | `Scanner.tsx:619–622` | `const v = c === "strike" ? r.strike : r[c]; return v == null ? 0 : Number(v);` | **Nulls become `0`, not `-Infinity` and not "sorts last".** A row with `chg15: null` sorts as if its 15-minute change were exactly zero, which puts it in the middle of an `Math.abs()` ranking, not at the end | Every comparator and both filters read through this |

---

## E.3 — Derivation pipeline (client-side, no network)

Source: `Scanner.tsx:683–731`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **E29** `INDICES` | `new Set(["SPX", "SPY", "QQQ", "IWM", "NDX"])` (683) | **Five** symbols. Declared **inside the component body**, so it is reallocated every render | Used only by the `cardScope === "exidx"` filter | n/a |
| **E30** `otmDist(r)` | `r.spot && r.spot > 0 ? Math.abs(r.strike - r.spot) / r.spot : 0` (685) | A **fraction**, not a percent: `0.05` = 5%. Symmetric — a strike below spot and one above at the same distance both give the same positive value | Returns `0` when `spot` is null, undefined, `0` or negative — which means such rows are dropped by any `minOtm > 0` filter (`0 >= 0.02` is false) but kept when `minOtm === 0` | — |
| **E31** `dirPass(r)` | `Scanner.tsx:689–693` | `if (!r.spot \|\| r.spot <= 0) return false;` then `const v = sqVal(r, colSort.col);` then `return dir === "pos" ? (r.strike > r.spot && v > 0) : (r.strike < r.spot && v < 0);` | **The metric is the ACTIVE SORT COLUMN, not GEX.** Sorting by `strike` makes `v = r.strike`, always positive, so `dir="neg"` (`v < 0`) returns **zero rows** for every input. Sorting by `delta_abs` (a magnitude) has the same problem. Boundaries are strict `>` / `<` — a strike exactly at spot, or a metric of exactly `0`, fails both directions | Rows with no usable `spot` are dropped outright, silently |
| **E32** `displayRows` filter chain — order matters | `Scanner.tsx:695–706` | Applied strictly in this order: **(1)** expiry — `expiry === "ALL" ? rows : rows.filter(r => r.expiry === expiry)`; **(2)** card scope — `if (cardScope === "exidx") f = f.filter(r => !INDICES.has(r.symbol))`; **(3)** min OTM — `if (minOtm > 0) f = f.filter(r => otmDist(r) >= minOtm)`; **(4)** direction — `if (dir !== "all") f = f.filter(dirPass)` | The min-OTM boundary is `>=`, so `minOtm = 0.05` keeps a strike sitting exactly 5.0% away | Any step can empty the list; the empty-state row (E67) is what renders |
| **E33** **The card-scope control also filters the TABLE** | `Scanner.tsx:697` | The `All` / `All − Indices` segmented pair is drawn inside the **Top-10 header** (E43), but line 697 applies it to `displayRows` too | This is not signposted anywhere in the UI. Clicking `All − Indices` silently drops SPX/SPY/QQQ/IWM/NDX from the table as well as the cards | — |
| **E34** Table comparator | `Scanner.tsx:700–704` | `const av = sqVal(a, colSort.col), bv = sqVal(b, colSort.col); const cmp = colSort.col === "strike" ? bv - av : Math.abs(bv) - Math.abs(av); return colSort.dir === "desc" ? cmp : -cmp;` | **`strike` sorts by signed value; every other column sorts by `Math.abs()`.** So a `Δ 15m` of `-800M` outranks one of `+200M` in "desc". Ties keep the E19 merge order (`Array.prototype.sort` is stable) | Nulls arrive as `0` (E28) and therefore sort **last in desc, first in asc**, mixed among genuine zeros |
| **E35** Row cap | `f.slice(0, limit)` (705) | Applied **after** sorting, so it is a true top-N | `limit` ∈ `{10, 25, 50, 100}`, default `25` | — |
| **E36** `topCards` base set | `Scanner.tsx:712–718` | Repeats **exactly** the same four filters as E32, in the same order, against `rows` | Deliberate duplication in the source — the two lists cannot diverge on filters, only on ordering and cap | — |
| **E37** `topCards` ranking | `Scanner.tsx:717–720` | `[...base].sort((a, b) => colSort.col === "strike" ? bv - av : Math.abs(bv) - Math.abs(av))` | **`colSort.dir` is NOT applied.** The cards are always descending. Flipping a column header to ascending reverses the table while the cards stay put — the "Top 10" is a top-10 by magnitude regardless of arrow direction | — |
| **E38** Index cap on the cards | `Scanner.tsx:721–729` | `const CAP_ONE = new Set(["SPX", "SPY", "QQQ"])` — walk `ranked`, skip a row whose symbol is in `CAP_ONE` and already `used`, push the rest, `break` at `out.length === 10` | **`CAP_ONE` is three symbols; `INDICES` (E29) is five.** IWM and NDX are excluded by the `All − Indices` toggle but are **not** capped to one slot — they can take all ten. The header string says "SPX/SPY/QQQ 1 slot each", which matches `CAP_ONE` and not `INDICES` | Fewer than 10 available rows → fewer than 10 cards; 0 rows → the whole card block is not rendered (E42) |
| **E39** `showSymbol` / `showExpiry` | `symbol === "ALL"` / `expiry === "ALL"` (708–709) | Controls whether the Symbol and Expiry **columns exist at all** in the table | Selecting a single ticker removes the Symbol column; selecting a single expiry removes the Expiry column. Both selected → the table narrows from 9 columns to 7 | Also feeds the empty-row `colSpan` (E67) |
| **E40** `cols` — the sortable column definition list | `Scanner.tsx:732–739` | In order: `{strike,"Strike"} · {gex_now,"GEX Now"} · {chg15,"Δ 15m"} · {chg30,"Δ 30m"} · {chg60,"Δ 60m"} · {delta_abs,"Delta Abs"}` | Drives the header cells (E55) and the Top-10 metric label (E44, E48). The **body cells are hardcoded separately** (E61–E66) and happen to match this order — they are not generated from `cols` | n/a |
| **E41** `toggleSort(col)` | `Scanner.tsx:651–652` | `setColSort(p => p.col === col ? { col, dir: p.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" })` | Clicking the **active** column flips direction; clicking a **new** column always starts at `"desc"`. There is no third "unsorted" state | Default state: `{ col: "gex_now", dir: "desc" }` (633) |
| **E42** Sort state is not persisted | — | No `localStorage`, no URL param, no `sessionStorage` **anywhere in this tab** | Every control resets to its default on remount: `symbol="ALL"`, `expiry="ALL"`, `limit=25`, `colSort={gex_now,desc}`, `cardScope="all"`, `dir="all"`, `minOtm=0` | — |

---

## E.4 — Card frame and subtitle

Source: `Scanner.tsx:746–747`; `PageCard.tsx:84–145`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **E43** Card surface | `<Card variant="budget" …>` (746) | `variant="budget"` resolves to `classicCardAccentStyle`: background `HT.panelBg` `rgba(13,17,25,0.45)`, `backdropFilter: blur(16px)` (+ `-webkit-`), `borderRadius: 18`, `border: 1px solid HT.border` `rgba(255,255,255,0.10)`, `boxShadow: 0 18px 40px rgba(0,0,0,0.22)`. Default `padding: 24` | Gets `className="card-hover"` (the dashboard-wide hover lift). **No top accent strip** — `accent` is a dead prop, ignored by design (`PageCard.tsx:22–34`) | Always renders, even with zero rows |
| **E44** Card title — `"Strike GEX Query"` | `title={<span style={{ fontSize: 17 }}>Strike GEX Query</span>}` (746) | The Card's own header style is `fontSize: 14, fontWeight: 800, letterSpacing: 0.12em, textTransform: uppercase, color: HT.text`; the inline `<span>` **overrides size to 17px**. Rendered uppercase by CSS → reads **"STRIKE GEX QUERY"** | `HT.text` `#FFFFFF` | Always renders |
| **E45** Card subtitle — base | `` `Top movers by strike · ${symbol === "ALL" ? "all watched tickers" : symbol}` `` (747) | Card subtitle style: `fontSize: 12`, `color: HT.green` `#8ECAE6`. Separator is a middle dot `·` with a space either side | With Ticker = ALL: `"Top movers by strike · all watched tickers"`. With Ticker = NVDA: `"Top movers by strike · NVDA"` | Always renders |
| **E46** Card subtitle — direction suffix | `` ${dir !== "all" ? ` · ${dir === "pos" ? "above spot · Δ↑" : "below spot · Δ↓"}` : ""} `` (747) | Appends `" · above spot · Δ↑"` for Positive, `" · below spot · Δ↓"` for Negative | Omitted entirely when `dir === "all"` | — |
| **E47** Card subtitle — OTM suffix | `` ${minOtm > 0 ? ` · OTM ≥${(minOtm * 100).toFixed(0)}%` : ""} `` (747) | `" · OTM ≥2%"`, `" · OTM ≥5%"`, `" · OTM ≥10%"`, `" · OTM ≥15%"`, `" · OTM ≥20%"`. **Zero decimals**, `≥` is a single glyph, no space after it | Omitted when `minOtm === 0` | — |
| **E48** Card subtitle — loading suffix | `` ${loading ? " · loading…" : ""} `` (747) | Appends `" · loading…"` — single `…` glyph, lowercase | **This is the only loading affordance on the entire tab.** No spinner, no skeleton, no dimmed rows | Removed when `loading` goes false |
| **E49** Card subtitle — what it does NOT say | — | The subtitle never mentions the selected **Expiry**, the **Limit**, or the **card scope** | Three of the seven controls are invisible in the header summary | — |

---

## E.5 — Toolbar

Source: `Scanner.tsx:741–743` (`lbl`), `749–785` (the flex row).

Container: `display: flex, flexWrap: wrap, gap: 12, alignItems: flex-end, marginBottom: 16` (749).

`lbl` (741–743) — the small caps label above each dropdown:
`fontSize: 14, color: HT.green (#8ECAE6), textTransform: uppercase, letterSpacing: 0.05em`.

Each of the three dropdown groups is `display: flex, flexDirection: column, gap: 4`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **E50** `"Ticker"` label | Static string, `style={lbl}` (751) | Uppercased by CSS → **"TICKER"**. 14px, `HT.green`, `letterSpacing 0.05em` | — | Always renders |
| **E51** Ticker dropdown | `<ThemedSelect ariaLabel="Ticker" width={130} value={symbol} onChange={setSymbol} options={[{value:"ALL",label:"ALL"}, ...symbolList.map(s => ({value:s,label:s}))]} />` (752–753) | Width **130px**. Options: `"ALL"` first, then `symbolList` (E16) in its own order — the 10 fallback tickers before the watchlist lands, the alphabetically sorted active watchlist after | Default `"ALL"`. **Changing this REFETCHES** (E24) — it is the only control that does | Never empty: `"ALL"` plus at least the 10 fallbacks |
| **E52** `"Expiry"` label | Static string, `style={lbl}` (756) | → **"EXPIRY"** | — | Always renders |
| **E53** Expiry dropdown | `<ThemedSelect ariaLabel="Expiry" width={150} value={expiry} onChange={setExpiry} options={[{value:"ALL",label:"All Expiries"}, ...expiries.map(e => ({value:e,label:e}))]} />` (757–758) | Width **150px**. First option's **value is `"ALL"` but its label is `"All Expiries"`** — the only place on this tab where a value and its label differ. Expiry strings render **raw from the API**, unformatted | Default `"ALL"`. Client-side filter only — no refetch. Auto-resets to `"ALL"` when the selected expiry vanishes from a reload (E21) | Before the first successful load, the only option is `"All Expiries"` |
| **E54** `"Limit"` label | Static string, `style={lbl}` (761) | → **"LIMIT"** | — | Always renders |
| **E55** Limit dropdown | `<ThemedSelect ariaLabel="Limit" width={90} value={String(limit)} onChange={v => setLimit(Number(v))} options={[10,25,50,100].map(l => ({value:String(l),label:String(l)}))} />` (762–763) | Width **90px**. Exactly four options in this order: **`10` · `25` · `50` · `100`**. Bare numerals, no "rows" suffix | Default **25**. Client-side `slice` only (E35) — no refetch | Always four options |
| **E56** Divider `"\|"` | `<span style={{ color: HOME_THEME.border }}>\|</span>` (765) | A literal pipe character painted `HT.border` = `rgba(255,255,255,0.10)` — a **text glyph at 10% white**, not a rule element. Effectively invisible | — | Always renders |
| **E57** Direction group tooltip | `title="Positive = OTM strikes above spot with rising GEX (Δ↑) · Negative = OTM strikes below spot with falling GEX (Δ↓)"` on the wrapping `<div>` (766) | Native browser tooltip, full text as quoted | **The tooltip says "GEX"; the code (E31) uses the active sort column.** The tooltip is only accurate while the sort is on `gex_now` (the default). Per the brief's rule, the code wins and the tooltip is wrong | Always present |
| **E58** `"All"` direction button | `<button onClick={() => setDir("all")} style={seg(dir === "all")}>All</button>` (767) | `seg()` metrics (E11) | Active: border `HT.cyan`, bg `rgba(33,158,188,0.15)`, text `#FFFFFF`. Inactive: border `rgba(255,255,255,0.15)`, bg transparent, text `rgba(255,255,255,0.7)` | **This is the default** (`dir = "all"`, line 635) |
| **E59** `"Positive"` direction button | `style={{ ...seg(dir === "pos"), ...(dir === "pos" ? { color: HOME_THEME.green, borderColor: HOME_THEME.green } : {}) }}` (768) | Same `seg()` metrics | When active, `seg(true)`'s cyan border and white text are **overridden** to `HT.green` `#8ECAE6` for both; the background stays `seg(true)`'s `rgba(33,158,188,0.15)`. When inactive it is plain `seg(false)` | — |
| **E60** `"Negative"` direction button | `style={{ ...seg(dir === "neg"), ...(dir === "neg" ? { color: HOME_THEME.red, borderColor: HOME_THEME.red } : {}) }}` (769) | Same `seg()` metrics | When active, colour and border become `HT.red` `#EF4444`, background stays `rgba(33,158,188,0.15)` | With the sort on `strike` or `delta_abs` this button yields an **always-empty table** (E31) with no explanation shown |
| **E61** `"min OTM"` label + wrapper | `<label style={{ display:"flex", alignItems:"center", gap:6, fontSize:14, color: HOME_THEME.orange }} title="How far OTM the strike must sit vs spot">` (771) | Literal text **`min OTM`** — lowercase `min`, uppercase `OTM`, **not** uppercased by CSS (unlike E50/E52/E54). 14px, `HT.orange` `#FB8501` | Native tooltip: `"How far OTM the strike must sit vs spot"` | Always renders |
| **E62** min-OTM select — the control | A **raw native `<select>`**, not `ThemedSelect` (773–774) | Inline style: `fontSize: 14, padding: "6px 10px", borderRadius: 6, background: "rgba(0,0,0,0.4)", color: HT.text, border: "1px solid rgba(255,255,255,0.15)"`. Note `borderRadius: 6` against ThemedSelect's `8`, and `padding 6px 10px` against ThemedSelect's `8px 12px` | **The one off-theme control on the tab** — its option list is the OS menu, not the frosted DOCK panel. Value is coerced with `Number(e.target.value)` | Client-side filter only — no refetch |
| **E63** min-OTM options, in order | `Scanner.tsx:775–780` | Six options: **`any` → 0** · **`2%+` → 0.02** · **`5%+` → 0.05** · **`10%+` → 0.10** · **`15%+` → 0.15** · **`20%+` → 0.20`**. Labels use a trailing `+`, the subtitle (E47) uses a leading `≥` — two spellings of the same idea | Default **`any` (0)**, which skips the filter entirely rather than filtering at `>= 0` | — |
| **E64** `"↻ Refresh"` button | `<button onClick={() => load()} style={seg(false)}>↻ Refresh</button>` (783) | Literal label `"↻ Refresh"` — `↻` U+21BB, one space, then `Refresh`. Always `seg(false)` styling | **Never renders an active/pressed state**, and is **not disabled while `loading`** — it is hardcoded `seg(false)` | Clicking during an in-flight load starts a second overlapping fan-out (E25) |
| **E65** Hint text | `<span style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", alignSelf: "center" }}>click a column header to sort</span>` (784) | Literal, all lowercase: **`click a column header to sort`**. 14px, `rgba(255,255,255,0.35)`, vertically centred against the `flex-end`-aligned row | Static — never changes, never hides | Always renders |

### ThemedSelect — what E51 / E53 / E55 actually draw

Source: `components/shared/ThemedSelect.tsx`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **E66** Trigger button | `ThemedSelect.tsx` `trigger` style | `display:flex; alignItems:center; justifyContent:space-between; gap:8; width:100%; padding:8px 12px; borderRadius:8; fontFamily:inherit; fontSize:14; fontWeight:700; transition: border-color .14s, box-shadow .14s` | Background `rgba(0,0,0,0.4)`. Border `1px solid HT.border` closed → `1px solid DT.activeBorder` (`rgba(33,158,188,0.3)`) open. `boxShadow: none` closed → `DT.activeGlow` (`0 0 14px rgba(33,158,188,0.22)`) open. Text `HT.text`. None of the three selects on this tab pass `disabled`, so the `opacity 0.5 / cursor not-allowed` branch is unreachable here | Selected label colour `HT.cyan` `#219EBC`; with no match, `placeholder` `"—"` in `HT.muted` `#FFFFFF`. All three selects always have a matching option, so the placeholder never shows on this tab |
| **E67** Chevron | Inline SVG, `16×16`, `viewBox 0 0 24 24`, `path d="M6 9l6 6 6-6"`, `strokeWidth 1.8`, round caps/joins | Colour `HT.muted` `#FFFFFF` | `transform: rotate(180deg)` when open, `transition: transform .18s` | Always drawn |
| **E68** Menu panel | `createPortal(…, document.body)` | `position: fixed`, `zIndex: 9999`, `padding: 6`, `borderRadius: 14`, `gap: 2`, `overflowY: auto`, width = trigger width | Background `DT.bg` = `radial-gradient(circle at 50% 0%, rgba(33,158,188,0.07) 0%, transparent 55%), rgba(10,13,20,0.98)`; `backdropFilter: blur(18px)`; border `1px solid HT.border` with **`borderTop: 2px solid DT.cyanTop`** (`rgba(33,158,188,0.5)`); `boxShadow: DT.shadow` | Only mounted while `open && rect` |
| **E69** Menu placement | Position effect | `GAP = 6, PAD = 8`. Flips above the trigger when `below < Math.min(maxMenuHeight, 160) && above > below`; height `Math.max(120, Math.min(maxMenuHeight, flip ? above : below))`; `left` clamped to `[PAD, innerWidth - width - PAD]` | `maxMenuHeight` defaults to **320** — none of the three selects overrides it | Repositions on `scroll` (capture) and `resize` |
| **E70** Menu option rows | `options.map` | `padding: 8px 10px; borderRadius: 8; fontSize: 14; textAlign: left; fontFamily: inherit` | Selected: `fontWeight: 800`, colour `HT.cyan`, background `DT.activeTile` (`linear-gradient(180deg, rgba(33,158,188,0.16), rgba(33,158,188,0.04))`), border `1px solid DT.activeBorder`. Unselected: `fontWeight: 600`, colour `HT.text`, transparent background and border. Hover on an unselected row sets background `DT.hoverTile` `rgba(33,158,188,0.1)` via a JS `onMouseEnter`/`onMouseLeave` pair, not CSS | `options.length === 0` → an italic `"—"` row at `fontSize 12`, `HT.muted`, `opacity 0.6`. Reachable on this tab only if `SQ_FALLBACK` were emptied — the Expiry list always has `"All Expiries"` |
| **E71** Menu dismissal | `mousedown` on `document` outside both refs, or `Escape` on `keydown` | Listeners are attached **unconditionally on mount** (`useEffect(…, [])`), not gated on `open` | No focus trap, no arrow-key navigation, no type-ahead | — |

---

## E.6 — Top 10 card grid

Source: `Scanner.tsx:789–829`. The whole block is gated on `topCards.length > 0` (789).

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **E72** Block wrapper | `<div style={{ marginBottom: 18 }}>` (790) | — | Rendered only when `topCards.length > 0` | With zero rows the **entire block, including its header and the scope toggle, disappears** — so `All − Indices` becomes unclickable exactly when a user might want to undo it |
| **E73** Header row | `<div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", marginBottom:8 }}>` (791) | — | — | — |
| **E74** Header text | `` `Top 10 · ${cols.find(c => c.key === colSort.col)?.label} · SPX/SPY/QQQ 1 slot each` `` (792–794) | `fontSize: 17`, `color: HT.green` `#8ECAE6`, `textTransform: uppercase`, `letterSpacing: 0.05em`. Renders uppercase, e.g. **"TOP 10 · GEX NOW · SPX/SPY/QQQ 1 SLOT EACH"** | The middle segment is the active sort column's label from `cols` (E40) and changes with every header click | `cols.find(...)?.label` is `undefined`-safe but every `SqCol` is in `cols`, so it never renders `"undefined"` |
| **E75** `"All"` scope button | `<button onClick={() => setCardScope("all")} style={seg(cardScope === "all")}>All</button>` (796) | `seg()` metrics (E11) | Default `cardScope = "all"` (634) | — |
| **E76** `"All − Indices"` scope button | `<button onClick={() => setCardScope("exidx")} style={seg(cardScope === "exidx")}>All − Indices</button>` (797) | Literal label uses **U+2212 MINUS SIGN `−`**, not a hyphen: `"All − Indices"` | Filters out `INDICES` = SPX, SPY, QQQ, IWM, NDX — **from the table as well as the cards** (E33) | — |
| **E77** Grid | `<div style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr)", gap:10 }}>` (800) | **Fixed 5 columns**, no `minmax`, no media query, no `auto-fit`. Ten cards → two rows of five | Cards squash rather than wrap on a narrow viewport | With 1–4 cards the row is short and the remaining columns are blank |
| **E78** Card shell | `Scanner.tsx:807–810` | `border: 1px solid rgba(255,255,255,0.1)`, `borderRadius: 10`, `padding: "10px 12px"` | Background alternates by index: `i % 2 ? "rgba(255,255,255,0.02)" : "rgba(33,158,188,0.06)"` — **even indices (#1, #3, #5, #7, #9) get the cyan tint**, odd get the white wash. This is the **opposite polarity** to the table's zebra (E60), where even rows are transparent | — |
| **E79** Card key | `` key={`${r.symbol}-${r.expiry}-${r.strike}-${i}`} `` (807) | Index is in the key, so React never reuses a card across a re-sort | — | — |
| **E80** Card — symbol | `r.symbol` (812) | `fontWeight: 800`, `fontSize: 17`, `color: HT.text` `#FFFFFF` | None | Never null — E18 stamps it client-side |
| **E81** Card — rank | `` `#${i + 1}` `` (813) | `fontSize: 14`, `color: rgba(255,255,255,0.4)`. Renders `#1` … `#10`. Right-aligned by the row's `justifyContent: space-between`, baseline-aligned with the symbol | 1-based | Always renders |
| **E82** Card — strike | `` `$${r.strike}` `` (816) | `fontSize: 14`, `fontWeight: 700`, `color: HT.cyan` `#219EBC`, `margin: "2px 0"`. **A raw `$` prefix on the raw number** — no `toFixed`, no thousands separator, no currency formatter. `6050` renders `$6050`; `6047.5` renders `$6047.5` | — | `strike` is non-nullable in `SqRow` |
| **E83** Card — expiry | `r.expiry` in a nested span (816) | `color: rgba(255,255,255,0.4)`, `fontWeight: 400` (overriding the 700 parent), inherits `fontSize: 14`. Separated from the strike by a single space | Raw API string, unformatted | — |
| **E84** Card — metric value | `{colSort.col === "strike" ? r.strike : fmtB(v)}` where `v = sqVal(r, colSort.col)` (802, 818–820) | `fontSize: 14`, `fontWeight: 800`. Sorting by Strike shows the **bare number with no `$`** (unlike E82); every other column goes through `fmtB` (E8) and is therefore always signed | Colour `metricCol` (804–805): `colSort.col === "strike" \|\| "gex_now" \|\| "delta_abs"` → `HT.text` `#FFFFFF`; otherwise (`chg15`/`chg30`/`chg60`) → `pos ? HT.green : HT.red` where `pos = v >= 0`. **`gex_now` is white even when negative**, while a negative `Δ 15m` is red — the same sign, two treatments | A `null` chg becomes `0` via `sqVal` (E28), so it renders `"+0"` in **green** (`0 >= 0`), not as a dash |
| **E85** Card — metric label | `cols.find(c => c.key === colSort.col)?.label` (821–823) | `fontSize: 14`, `color: rgba(255,255,255,0.4)`, `textTransform: uppercase` → **"GEX NOW"**, **"Δ 15M"**, **"DELTA ABS"**, **"STRIKE"**, **"Δ 30M"**, **"Δ 60M"** | Note the CSS uppercase turns `Δ 15m` into `Δ 15M` on the card but the table header keeps its own casing rule (E55) | — |

---

## E.7 — Table header

Source: `Scanner.tsx:831–850`.

Table: `width: 100%`, `borderCollapse: collapse`, `fontSize: 14`, inside a
`<div style={{ overflowX: "auto" }}>` (831).
Header `<tr>`: `color: HT.green` `#8ECAE6`, `textAlign: right`, `fontSize: 14`,
`textTransform: uppercase` (834).

Column order is: **Symbol?** · **Expiry?** · **OTM%** · Strike · GEX Now · Δ 15m · Δ 30m · Δ 60m · Delta Abs — 9 columns at most, 7 at fewest.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **E86** `"SYMBOL"` | `{showSymbol && <th style={{ ...th, textAlign: "left" }}>Symbol</th>}` (835) | Source string `"Symbol"`, rendered uppercase by the `<tr>`. **Left**-aligned, overriding `th`'s right | **Column omitted entirely** when a single ticker is selected (E39) | — |
| **E87** `"EXPIRY"` | `{showExpiry && <th style={{ ...th, textAlign: "left" }}>Expiry</th>}` (836) | Source string `"Expiry"`, uppercase. **Left**-aligned | **Column omitted entirely** when a single expiry is selected | — |
| **E88** `"OTM%"` | `<th style={th}>OTM%</th>` (837) | Literal `"OTM%"`, right-aligned, `HT.green`, `fontWeight 700`, `letterSpacing 0.05em` | **Not sortable.** No `onClick`, no arrow glyph, no cursor change — the only data column that cannot be sorted, and the hint text (E65) does not say so | Always present |
| **E89** `"STRIKE"` header | `cols[0]`, rendered by the map at 838–849 | Label `"Strike"` → uppercase | Sortable. See E95 for the shared header treatment | — |
| **E90** `"GEX NOW"` header | `cols[1]` | Label `"GEX Now"` → uppercase | Sortable. **This is the default sort column**, descending | — |
| **E91** `"Δ 15M"` header | `cols[2]` | Label `"Δ 15m"` → uppercase (`Δ` U+0394) | Sortable, by `Math.abs()` | — |
| **E92** `"Δ 30M"` header | `cols[3]` | Label `"Δ 30m"` → uppercase | Sortable, by `Math.abs()` | — |
| **E93** `"Δ 60M"` header | `cols[4]` | Label `"Δ 60m"` → uppercase | Sortable, by `Math.abs()` | — |
| **E94** `"DELTA ABS"` header | `cols[5]` | Label `"Delta Abs"` → uppercase | Sortable, by `Math.abs()` — of an already-absolute field, so the double-abs is a no-op | — |
| **E95** Sortable header cell — style | `Scanner.tsx:842–845` | `{ ...th, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }` | Colour: `active ? HT.cyan (#219EBC) : HT.green (#8ECAE6)` — the active column is the **only** cyan thing in the header row | — |
| **E96** Sort arrow glyph | `const arrow = active ? (colSort.dir === "desc" ? " ↓" : " ↑") : " ⇅"` (840), rendered in a nested span (846) | Three states: **`" ↓"`** (active desc, U+2193), **`" ↑"`** (active asc, U+2191), **`" ⇅"`** (inactive, U+21C5). Each has a **leading space**. Span style `fontSize: 14` | `opacity: active ? 1 : 0.4` — inactive arrows are dimmed rather than hidden | Every sortable header always shows one of the three |
| **E97** Header click target | `onClick={() => toggleSort(c.key)}` on the `<th>` (842) | The whole cell, including its padding, is clickable | No `role="button"`, no `tabIndex`, no `aria-sort`, no keyboard handler — **not keyboard-reachable** | — |

---

## E.8 — Table body

Source: `Scanner.tsx:852–873`. Body cells are written out **literally**, not
generated from `cols` — the header (E89–E94) and the body happen to agree.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **E98** Row shell | `Scanner.tsx:853–855` | `borderTop: 1px solid rgba(255,255,255,0.06)` on every row, including the first | Background zebra: `i % 2 ? "rgba(255,255,255,0.02)" : "transparent"` — **even rows transparent**, odd rows washed. Opposite polarity to the cards (E78) | — |
| **E99** Row key | `` key={`${r.symbol}-${r.expiry}-${r.strike}-${i}`} `` (854) | Index-suffixed, so nothing is reused across a re-sort | — | — |
| **E100** Symbol cell | `{showSymbol && <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{r.symbol}</td>}` (856) | Left-aligned, `fontWeight: 700`, colour `HT.text` `#FFFFFF` (from `td`) | None — the symbol is never coloured by direction, index status, or anything else | Cell absent when the column is (E39) |
| **E101** Expiry cell | `{showExpiry && <td style={{ ...td, textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 14 }}>{r.expiry}</td>}` (857) | Left-aligned, colour **`rgba(255,255,255,0.7)`** (dimmer than every other cell), explicit `fontSize: 14` (redundant with the table's own 14). Raw API string, unformatted | None | Cell absent when the column is |
| **E102** OTM% cell — value | `{r.spot ? `${(otmDist(r) * 100).toFixed(1)}%` : "—"}` (859–860) | **One** decimal place, trailing `%`, e.g. `"3.4%"`. Right-aligned | — | `r.spot` falsy (`null`, `undefined` **or `0`**) → **`"—"`** (em dash U+2014) |
| **E103** OTM% cell — colour | `color: otmDist(r) * 100 >= 5 ? HOME_THEME.orange : "rgba(255,255,255,0.7)"` (858) | — | **One boundary: `>= 5` percent** → `HT.orange` `#FB8501`; below → `rgba(255,255,255,0.7)`. This threshold is fixed and **independent of the `min OTM` filter** — with `min OTM = 10%` every visible row is orange | A missing-spot row has `otmDist = 0`, so the `"—"` is painted the dim white, not orange |
| **E104** Strike cell | `<td style={{ ...td, fontWeight: 700 }}>{r.strike}</td>` (861) | **Raw number, no formatting** — no `$`, no `toFixed`, no separator. `fontWeight: 700`, colour `HT.text`, right-aligned. Contrast with the card, which prefixes `$` (E82) | None | Non-nullable |
| **E105** GEX Now cell | `<td style={td}>{fmtB(r.gex_now)}</td>` (862) | `fmtB` (E8) — always signed, `B`/`M`/`K` suffixes | **No colour rule at all** — plain `HT.text` `#FFFFFF` even when negative. The sign is carried only by the `-` in the string | `gex_now` is non-nullable in `SqRow`; a nullish value from the API would reach `Math.abs(undefined)` → `NaN` → `"+NaN"` |
| **E106** `Δ 15m` cell | `<td style={{ ...td, color: r.chg15 == null ? HOME_THEME.text : r.chg15 >= 0 ? HOME_THEME.green : HOME_THEME.red }}>{r.chg15 == null ? "—" : fmtB(r.chg15)}</td>` (863) | `fmtB`, always signed | Three-way ladder: `null` → `HT.text` `#FFFFFF`; `>= 0` → `HT.green` `#8ECAE6`; `< 0` → `HT.red` `#EF4444`. Boundary is `>=`, so **exactly `0` is green** and renders `"+0"` | `null` → **`"—"`** (em dash) in white |
| **E107** `Δ 30m` cell | Same expression on `r.chg30` (864) | Identical to E106 | Identical ladder | Identical `"—"` |
| **E108** `Δ 60m` cell | Same expression on `r.chg60` (865) | Identical to E106 | Identical ladder | Identical `"—"` |
| **E109** Delta Abs cell | `<td style={td}>{fmtB(r.delta_abs)}</td>` (866) | `fmtB` — **still signed**, so an already-absolute magnitude renders with a leading `+`, e.g. `"+1.2M"` | **No colour rule** — plain `HT.text` | Non-nullable |
| **E110** Column-count mismatch to be aware of when porting | E86–E94 vs E100–E109 | Header cells are produced by `cols.map`; body cells are nine hand-written `<td>`s | They agree today. A v3 port that generates one from the other must keep **OTM% out of `cols`** (it is not a `SqCol` and is not sortable) | — |

---

## E.9 — Loading, empty and error states

Source: `Scanner.tsx:747, 787, 869–873`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **E111** Loading | `loading` state | The subtitle gains `" · loading…"` (E48) and **nothing else changes** | No spinner, no skeleton, no `.stale` dimming, no disabled controls | Previous rows stay on screen for the whole fetch — the table never blanks between loads |
| **E112** Error banner | `{err && <div style={{ color: HOME_THEME.red, marginBottom: 12, fontSize: 14 }}>{err}</div>}` (787) | Raw `String(e?.message \|\| e)` — no wrapper text, no icon, no border, no background plate. `HT.red` `#EF4444`, 14px | Rendered whenever `err` is truthy, **including while `loading` is true** — no `!loading` guard | Near-unreachable in practice (E23) |
| **E113** Empty row | `Scanner.tsx:869–873` | `<tr><td colSpan={cols.length + 1 + (showSymbol ? 1 : 0) + (showExpiry ? 1 : 0)} style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>` — `colSpan` evaluates to **9** with both optional columns, **8** with one, **7** with neither | Gated on `!displayRows.length && !loading && !err` — suppressed during a load and suppressed when an error banner is showing | Text: **`"No rows yet. Needs recorder history for the selected ticker(s)."`** — one line, literal `(s)` |
| **E114** Empty state does not distinguish causes | — | The same sentence renders whether the API returned nothing, the expiry filter matched nothing, `min OTM` excluded everything, or the direction filter is structurally empty (E31) | No filter-reset affordance is offered | The Top-10 block vanishes at the same moment (E72), taking the `All`/`All − Indices` toggle with it |
| **E115** No first-paint distinct state | — | Before the first fetch settles, `rows = []` and `loading = true`, so **the table body is completely empty** — no header-only skeleton, no placeholder rows, just the `<thead>` above nothing | The header row still renders, so the tab is not blank | — |

---

## E.10 — `ModalPortal`

Source: `Scanner.tsx:881–903` (doc comment 881–895, implementation 896–903).

```tsx
function ModalPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.body); }, []);
  if (!host) return null;
  return createPortal(children, host);
}
```

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **E116** `ModalPortal` — usage | `Scanner.tsx:896` | **`ModalPortal` is never called.** A whole-tree grep for the identifier returns exactly one hit: its own declaration. The Strike Query tab renders no modal, and neither does any other tab in the file | — | **Dead code.** It sits directly after `StrikeQueryScanner` and before the Watch This block, which is why it reads as belonging to this tab; it does not |
| **E117** The reason it exists (worth carrying as a v3 rule, not as code) | Doc comment `Scanner.tsx:881–895` | `position: fixed` resolves against the viewport **only** while no ancestor has `transform`, `filter`, `backdrop-filter`, `perspective`, `will-change` or `contain`. Every `PageCard` surface sets `backdropFilter: blur(16px)` and `.card-hover` adds a `transform` on hover — so an overlay rendered inside a `Card` has `inset: 0` cover **the card**, not the screen | The failure symptom named in the comment: the overlay "looked centered because it was — centered on a card sitting a couple of screens down" | Portaling to `<body>` is the fix. `document` only exists after mount, hence the `useState`/`useEffect` dance — SSR must render `null` rather than throw, because this page is both Next-prerendered and run in the Vite SPA |
| **E118** `ThemedSelect` already solves the same problem independently | `ThemedSelect.tsx` | Its menu is `createPortal(…, document.body)` with `position: fixed` and `zIndex: 9999` | So the tab's only floating layer is already escaping the card without `ModalPortal` | — |

---

### Colours used

`HT` = `HOME_THEME`, `DT` = `DOCK_THEME`, both from
`components/shared/homeTheme.ts`.

| v2 value | Where used in Part E | Exists in v3 `tokens.css`? | Proposed v3 token |
|---|---|---|---|
| `HT.bg` `#05060A` | `PageShell` canvas behind the card (E7) | yes — `--color-v2-bg` | `T.bg` (v3's own `--color-bg` `#07080b`) — this tab has no parity mandate, so it should take v3's canvas, not v2's |
| `HT.shellGlow` (two radials, `rgba(33,158,188,0.04)` / `rgba(18,103,131,0.05)`) | `PageShell` background image (E7) | no | Shell-level in v3 — the page contributes nothing; drop it from the tab |
| `HT.panelBg` `rgba(13,17,25,0.45)` | The one `Card` plate (E43) | no exact | `alpha(T.panel, .45)` |
| `HT.border` `rgba(255,255,255,0.10)` | Card border (E43); the `\|` divider glyph (E56); `ThemedSelect` trigger + menu border (E66, E68) | no exact | `alpha(T.text, .10)` — **not** `--color-line`, which is opaque `#23272e` |
| `HT.text` `#FFFFFF` | `td` default (E10); card title (E44); card symbol (E80); Strike cell (E104); GEX Now cell (E105); Delta Abs cell (E109); **the `null` state of the three Δ cells** (E106–E108); `seg(true)` label (E11); `ThemedSelect` trigger + unselected option text | yes — `--color-fg` | `T.text` |
| `HT.cyan` `#219EBC` | Active sort-header colour (E95); card strike price (E82); `seg(true)` border (E11); `ThemedSelect` selected-value + selected-option text (E66, E70) | yes — `--color-v2-cyan` | `T.cyan` (`--color-accent` `#5b8cff`) |
| `HT.green` `#8ECAE6` — **a light blue, not a green** | Every `lbl` toolbar label (E50/E52/E54); the header `<tr>` colour and every inactive sort header (E95); Card subtitle (E45); Top-10 header text (E74); **the "Positive" active button** (E59); **the positive colour of `Δ 15m` / `Δ 30m` / `Δ 60m` cells** (E106–E108) and of a positive card metric (E84) | yes — `--color-v2-green` | **Split it.** Chrome uses (labels, headers, subtitle) → `T.muted`. Directional uses (positive Δ cell, "Positive" button, positive card metric) → `MOVE_UP` `--color-move-up` `#35c28e`. v2 painting "this number went up" and "this is a column header" the **same** value is exactly the em.md two-reds case |
| `HT.red` `#EF4444` | Error banner (E112); **the "Negative" active button** (E60); **the negative colour of the three Δ cells** (E106–E108) and of a negative card metric (E84) | yes — `--color-v2-red` (== `--color-impact-high`) | **Split it.** Error banner → `T.red` / `--color-down`. Directional uses → `MOVE_DOWN` `--color-move-down` `#e0645f` |
| `HT.orange` `#FB8501` | The `min OTM` label (E61); the OTM% cell at `>= 5%` (E103) | yes — `--color-v2-orange` | `T.orange` (`--color-warn` `#e0a44a`) |
| `rgba(255,255,255,0.7)` | `seg(false)` label (E11); Expiry body cell (E101); OTM% cell **below** 5% (E103) | no | `alpha(T.text, .70)` — but see the flag below |
| `rgba(255,255,255,0.4)` | Card expiry (E83); card rank `#N` (E81); card metric label (E85); the empty-state row (E113); `zColor`'s null branch (unused, E13) | no | `alpha(T.text, .40)` |
| `rgba(255,255,255,0.35)` | The `click a column header to sort` hint (E65) | no | **Collapse into `alpha(T.text, .40)`** — 0.35 and 0.40 are the same semantic ("de-emphasised chrome") at two values, five percentage points apart and indistinguishable on screen |
| `rgba(255,255,255,0.15)` | `seg(false)` border (E11); the native min-OTM select's border (E62) | no | `alpha(T.text, .15)` |
| `rgba(255,255,255,0.1)` | Top-10 card border (E78) | no | `alpha(T.text, .10)` — **same value as `HT.border`**, written two different ways in v2 (named constant on the Card, literal on the cards). One token in v3 |
| `rgba(255,255,255,0.06)` | Table row `borderTop` (E98) | no | `alpha(T.text, .06)` |
| `rgba(255,255,255,0.02)` | Odd-row table zebra (E98); **even**-index card background (E78) | no | `alpha(T.text, .02)` — note the two polarities (E78 vs E98); pick one in v3 |
| `rgba(33,158,188,0.15)` | `seg(true)` background (E11) | no | `alpha(T.cyan, .15)` |
| `rgba(33,158,188,0.06)` | Even-index Top-10 card background (E78) | no | `alpha(T.cyan, .06)` |
| `rgba(0,0,0,0.4)` | `ThemedSelect` trigger background (E66); native min-OTM select background (E62) | `--color-shadow` is `#000000` | `alpha(T.shadow, .4)` |
| `DT.bg` = `radial-gradient(circle at 50% 0%, rgba(33,158,188,0.07) 0%, transparent 55%), rgba(10,13,20,0.98)` | `ThemedSelect` menu panel (E68) | no | `radial-gradient(… alpha(T.cyan,.07) …), alpha(T.panel, .98)` |
| `DT.cyanTop` = `rgba(33,158,188,0.5)` | `ThemedSelect` menu 2px top accent (E68) | no | `alpha(T.cyan, .5)` |
| `DT.activeBorder` = `rgba(33,158,188,0.3)` | Open-trigger border, selected-option border (E66, E70) | no | `alpha(T.cyan, .3)` |
| `DT.activeGlow` = `0 0 14px rgba(33,158,188,0.22)` | Open-trigger box-shadow (E66) | no | `0 0 14px ${alpha(T.cyan, .22)}` |
| `DT.activeTile` = `linear-gradient(180deg, rgba(33,158,188,0.16), rgba(33,158,188,0.04))` | Selected menu option (E70) | no | `linear-gradient(180deg, ${alpha(T.cyan,.16)}, ${alpha(T.cyan,.04)})` |
| `DT.hoverTile` = `rgba(33,158,188,0.1)` | Hovered unselected menu option (E70) | no | `alpha(T.cyan, .1)` |
| `DT.shadow` = `0 1px 0 rgba(255,255,255,0.06) inset, 0 20px 44px -14px rgba(0,0,0,0.75), 0 6px 16px rgba(0,0,0,0.45)` | `ThemedSelect` menu (E68) | no | Built from `alpha(T.text,.06)` + `alpha(T.shadow,.75)` + `alpha(T.shadow,.45)` |
| `boxShadow: 0 18px 40px rgba(0,0,0,0.22)` | Card plate (E43) | no | `0 18px 40px ${alpha(T.shadow, .22)}` |
| `NEUTRAL` `#6B7280` | **Imported, never used by this tab** (E12) | `--color-impact-holiday` is `#6b7280` | Do not import in v3 |
| `zColor` ladder (`HT.red` / `HT.orange` / `HT.text` / `rgba(255,255,255,0.4)`) | **Imported, never used by this tab** (E13) | — | Do not import in v3 |

**Semantics v2 painted with two different values — collapse these in the port:**

1. **"Positive" is `#8ECAE6` (a light blue) while "negative" is `#EF4444` (a
   red).** The pair is not a pair: one is a chrome accent that also happens to
   mean "up", the other is an alert red. `MOVE_UP` / `MOVE_DOWN` fixes both ends
   at once.
2. **`#8ECAE6` means two unrelated things** — "this is a label/header" and "this
   number rose". Ported as one token it will keep meaning both.
3. **`#EF4444` means two unrelated things** — "this number fell" and "the fetch
   errored". Same fix as em.md's two-reds.
4. **`rgba(255,255,255,0.10)` is written as `HT.border` on the Card and as a
   literal `rgba(255,255,255,0.1)` on the Top-10 cards** — the same value, two
   spellings, and therefore two things that can drift.
5. **De-emphasised text is `0.7`, `0.4` and `0.35`** across nine sites. Three
   steps where the design has two intents (secondary vs. faint).
6. **Sign colouring is inconsistent by column.** `Δ 15m/30m/60m` are green/red;
   `GEX Now` and `Delta Abs` are white regardless of sign; the card metric is
   white for `strike`/`gex_now`/`delta_abs` and green/red for the three Δs. If
   v3 keeps this, it should be a stated rule ("only deltas are signed-coloured"),
   not an accident of six separate `<td>` styles.

---

### Do not port

1. **`ModalPortal` (E116).** Dead — zero call sites in the whole tree. Its
   lesson (`position: fixed` breaks inside a `backdrop-filter`/`transform`
   ancestor) is worth keeping as a v3 rule; the component is not. `ThemedSelect`
   already portals its own menu, and v3's dropdown should too.
2. **`NEUTRAL` and `zColor` imports (E12, E13).** Reachable from
   `scannerStyles.ts` but never referenced by this block.
3. **The outer `try/catch` error path (E23, E112).** Structurally unreachable:
   `Promise.all` over mappers that each swallow their own rejection cannot
   reject. v3 should surface **per-symbol** failures instead — right now a
   ticker that 500s is indistinguishable from a ticker with no strikes.
4. **The `dir` filter as written (E31).** It reads the *active sort column* as
   its "growth" metric, so `Negative` returns zero rows whenever the sort is on
   `Strike` or `Delta Abs`, and `Positive` means something different in each of
   the six sort states. Its own tooltip (E57) describes GEX specifically. Port
   the *intent* — side vs. spot combined with the sign of a **named** metric —
   not this expression.
5. **The native `<select>` for `min OTM` (E62).** The only OS-menu control on
   the tab, with its own radius (6 vs 8) and padding (`6px 10px` vs `8px 12px`).
   It should be the same component as the other three.
6. **`INDICES` (5 symbols) vs `CAP_ONE` (3 symbols) (E29, E38).** IWM and NDX
   are excludable but not slot-capped, and the header string only names three.
   Reconcile to one list before porting, or state deliberately why two exist.
7. **`INDICES` allocated inside the render body (E29)** and both `displayRows`
   and `topCards` computed as bare IIFEs on every render (E32, E36) with **no
   `useMemo`** — on a 100-row `ALL` fan-out this re-filters and re-sorts twice
   per keystroke-free re-render. v3 should memoise on the filter tuple.
8. **`fetch` with no `AbortController` (E27)** and **no request key** — a stale
   response can overwrite a newer one after a fast ticker switch. v3 routes data
   through `src/data/hooks.ts`; this tab must not call `fetch` from the page.
9. **`{ cache: "no-store" }` on one endpoint and nothing on the other (E14,
   E17).** Pick one caching policy.
10. **Colour literals everywhere.** Eighteen distinct `rgba(…)` / hex strings
    are typed inline in this block (see the table above). v3 non-negotiable #1
    forbids all of them outside `tokens.css`.
11. **Type sizes off the scale.** This block uses `17`, `14`, `12` and `10` px.
    v3's scale has no 17 and no 14: nearest steps are `--text-lg` 18 and
    `--text-sm` 13 / `--text-base` 15. Every `fontSize: 14` here (the table, the
    labels, the buttons, the cards, the hint) has to be re-pegged, not copied.
12. **`gridTemplateColumns: "repeat(5, 1fr)"` with no responsive rule (E77).**
    Ten cards in a fixed 5-wide grid squash rather than wrap.
13. **The sortable `<th>` has no keyboard or ARIA affordance (E97).** No
    `tabIndex`, no `aria-sort`, no key handler. Do not carry that across.
14. **`PageShell` and the v2 tab-bar chrome (E7).** v3's `Shell.tsx` owns the
    rail and toolbar; the tab contributes nothing to page chrome.
15. **Card-scope buttons that filter the table while living in the card header
    (E33, E72).** They also disappear exactly when they have emptied the view,
    which is unrecoverable without another control.

---

### Open questions for Brandon

1. **`dirPass` metric (E31).** Should Positive/Negative always test the sign of
   `gex_now` (which is what the tooltip promises), or genuinely follow whatever
   column is sorted? As written, two of the six sort states make `Negative` an
   empty set.
2. **`INDICES` vs `CAP_ONE` (E29, E38).** Should `All − Indices` and the
   one-slot cap use the same list? If yes, which one — the 3 or the 5?
3. **Card scope filtering the table (E33).** Intended, or a copy-paste from the
   `topCards` derivation? If intended, the toggle should sit in the toolbar with
   the other filters, not in the Top-10 header.
4. **Top-10 ignores the sort direction (E37).** Should flipping a column to
   ascending give a "bottom 10", or should the cards stay a magnitude ranking?
5. **`gex_now` and `delta_abs` are never sign-coloured (E105, E109, E84)** while
   the three Δ columns are. Deliberate rule, or oversight? It decides whether v3
   ships "only deltas are coloured" or "every signed number is coloured".
6. **Strike formatting (E82, E104).** The card shows `$6050`, the table shows
   `6050`. Which is right, and should fractional strikes (`6047.5`) get a fixed
   decimal treatment?
7. **The OTM% orange threshold is a hardcoded 5% (E103), independent of the
   `min OTM` filter.** With `min OTM = 10%` the whole column is orange. Should
   the threshold track the filter, or is 5% a fixed "notably far out" mark?
8. **`/proxy/strike-growth/by-expiry` response contract.** The code reads
   `{ ok, rows: SqRow[] }` and nothing else. Are `chg15/30/60` null for
   "insufficient history" or also for "no change"? That decides whether E28's
   null→0 coercion is acceptable in v3 or has to become a real "no data" sort
   bucket.
9. **Refresh cadence.** The tab has no polling at all (E26) — data moves only on
   mount, ticker change, or the ↻ button. Should v3 give it a live subscription
   through `useFrame`/`watchFrame`, or keep it pull-only?
10. **Fan-out size.** `ALL` fires one request per watched ticker (E17) with no
    concurrency cap. How large can the watchlist get before that needs a
    server-side `symbols=` batch endpoint?

**Part E row count: 118**
# Part F — TPO Structures (`?tab=tpo`)

> ## ⚠ PART F IS NO LONGER A BUILD TARGET
>
> **TPO Structures was dropped from v3 on 2026-09-03 (Brandon).** The tab has no
> entry in `SCANNER_TABS`, no id in `ScannerTabId`, no mount in
> `pages/Scanner.tsx`, and its six modules are tombstoned under
> `cbedge-v3/src/pages/scanner/` awaiting `git rm`.
>
> This Part stays in the document for two reasons, not out of tidiness:
>
> 1. **Rows F4–F13 and F191–F200 are still live.** They spec the candle layer —
>    `/api/snapshots/candles`, the four URL builders, the ET session grouping —
>    which survived the removal as `pages/scanner/candles.ts` and is what IB
>    Stats' live tape reads. Those rows are the spec for that module now.
> 2. The rest is the record of what v2's tab did, which is what makes dropping it
>    a decision rather than an omission. **v2's `/app/scanner?tab=tpo` is
>    untouched and still live.**
>
> Everything else here — the letter profile, the AMT read, the structure
> taxonomy, the k-NN forecast — describes v2 only. Do not build from it.



**Scope.** The v2 scanner tab `id: "tpo"`, label `"TPO Structures"`, short
`"TPO"`, icon `🏛️`, pill colour `LIGHT_BLUE` (`components/scanner/scannerNav.ts:61`).
It is NOT `ownerOnly`, so it renders for every visitor; it lives in the
`"structure"` sub-group alongside `ibstats` (`scannerNav.ts:105`). The tab is
mounted by `ScannerPage` as `{visibleTab === "tpo" && <TpoStructuresScanner />}`
(`Scanner.tsx:3096`), inside `<PageShell>`.

| Layer | File | Lines |
|---|---|---|
| Tab body | `components/pages/Scanner.tsx` → `TpoStructuresScanner` | 2896–3042 |
| Letter profile (canvas) | `components/pages/Scanner.tsx` → `TpoLetterProfile` | 2272–2649 |
| Rail row — **defined, never rendered** | `components/pages/Scanner.tsx` → `StructureRow` | 2656–2717 |
| AMT panel | `components/pages/Scanner.tsx` → `AmtPanel` | 2787–2894 |
| AMT signal row | `components/pages/Scanner.tsx` → `AmtSignalRow` | 2737–2785 |
| Forecast one-liner | `components/scanner/TpoForecastCard.tsx` | 1–69 |
| Open-location card | `components/scanner/TpoOpenLocation.tsx` | 1–137 |
| Forward map — **imported, never rendered** | `components/scanner/TpoForwardMap.tsx` | 1–142 |
| Profile / structure engine | `lib/tpo.ts` | 1–480 |
| Auction read + signals | `lib/amt.ts` | 1–305 |
| Candle feed (ES) | `hooks/useEsCandles.ts` | 1–458 |
| Candle feed (NQ) | `hooks/useNqCandles.ts` | 1–187 |
| RTH session grouping | `lib/balanceImbalance.ts` → `groupRthByDate` + its helpers | 56–119 (rest of file unreachable from this tab) |
| Candle transport | `lib/snapdb.ts` → `queryEs/NqCandlesToday/Historical` | 353–469 |
| Forecast engine | `lib/tpo-forecast-compute.ts` | 1–205 |
| **Not** in this tab's path | `lib/valueArea.ts`, `lib/marketSession.ts` | see F190, F201 |

**Render order of the tab** (`Scanner.tsx:2963–3041`), a `flex column` with
`gap: 16`:

1. Card — "TPO profile + open levels — last N sessions" (instrument + day
   selector, then `TpoLetterProfile`, then a legend line)
2. `AmtPanel` — "AMT — auction read & live signals" (4 tiles, bias banner,
   collapsed `<details>` signal rail)
3. `TpoForecastCard` — "Forecast"
4. `TpoOpenLocation` — "RTH open vs previous values" (only when
   `res.sessions.length >= 2`)
5. `<details>` "Structure stats" → Card "Structure stats"

**Total: 201 checklist rows (F1–F201).**

| Section | Covers | Rows |
|---|---|---|
| F.1 | Data layer — state, history window, hooks, memo keys | F1–F23 |
| F.2 | Card 1 header + instrument/day controls | F24–F34 |
| F.3 | `TpoLetterProfile` toolbar | F35–F44 |
| F.4 | `TpoLetterProfile` canvas drawing spec | F45–F75 |
| F.4b | View state, anchoring, pointer interaction | F76–F84 |
| F.4c | Hover card | F85–F88 |
| F.5 | Legend under the profile | F89–F94 |
| F.6 | `AmtPanel` | F95–F112 |
| F.7 | `AmtSignalRow` | F113–F122 |
| F.8 | `TpoForecastCard` | F123–F131 |
| F.9 | `TpoOpenLocation` | F132–F162 |
| F.10 | Structure stats | F163–F174 |
| F.12 | `StructureRow` (defined, never rendered) | F175–F184 |
| F.14a | Session grouping — the RTH rule every profile depends on | F185–F190 |
| F.14b | Candle transport — endpoints, dedupe, lite payload | F191–F195 |
| F.14c | `/api/tpo-forecast` engine — k-NN inputs, formula, outputs | F196–F201 |

---

## Shared constants this part paints with

`HT` = `HOME_THEME` (`components/shared/homeTheme.ts:3–18`). The names lie in two
places and both matter for the port: **`HT.green` is `#8ECAE6`, a light blue**,
and **`HT.muted` is `#FFFFFF`, identical to `HT.text`**.

```
HT.bg      #05060A     HT.panel   #0D1119    HT.cyan   #219EBC
HT.purple  #126783     HT.orange  #FB8501    HT.green  #8ECAE6   (light blue)
HT.red     #EF4444     HT.text    #FFFFFF    HT.muted  #FFFFFF
HT.border  rgba(255,255,255,0.10)            HT.panelBg rgba(13,17,25,0.45)
LIGHT_BLUE #7dd3fc     (homeTheme.ts:88)
NEUTRAL    #6B7280     (scannerStyles.ts:16)
```

`KIND_COLOR` (`Scanner.tsx:2235–2244`) — the tab's whole colour key:

| kind | value |
|---|---|
| `excess_high` | `HT.red` `#EF4444` |
| `excess_low` | `HT.red` `#EF4444` |
| `tail_high` | `HT.orange` `#FB8501` |
| `tail_low` | `HT.orange` `#FB8501` |
| `poor_high` | `HT.orange` `#FB8501` |
| `poor_low` | `HT.orange` `#FB8501` |
| `hole` | `NEUTRAL` `#6B7280` |
| `naked_poc` | `LIGHT_BLUE` `#7dd3fc` |

Note the collision the code creates and never resolves: **tail and poor are the
same orange**, so on the chart a "don't fade" tail and a "trade toward it" poor
high are indistinguishable by colour — the two opposite trades `lib/tpo.ts`'s
header comment says must never be confused.

`pctOrDash` (`Scanner.tsx:2246`) — the part's only number formatter:

```ts
const pctOrDash = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
```

Integer percent, `Math.round` (half-up), no `%`-sign suppression, `"—"` (em dash)
for `null`. `0` is NOT null, so a real `0` renders `"0%"`.

`seg(active)` (`scannerStyles.ts:32–37`) — the instrument / day pills:
`padding 6px 14px · radius 8 · 14px / 700 · cursor pointer · border 1px
(active ? HT.cyan : rgba(255,255,255,0.15)) · background (active ?
rgba(33,158,188,0.15) : transparent) · color (active ? #FFFFFF :
rgba(255,255,255,0.7))`.

`Card variant="budget"` (`PageCard.tsx:105–144`) resolves to
`classicCardAccentStyle` (`homeTheme.ts:186–189`) = `background HT.panelBg ·
backdropFilter blur(16px) · radius 18 · 1px HT.border · boxShadow 0 18px 40px
rgba(0,0,0,0.22)`, `padding: 24` default, `className="card-hover"`. Its header
block is `marginBottom 16 · flex column gap 2`; the **title wrapper** is
`14px / 800 · letterSpacing .12em · UPPERCASE · HT.text` (every title string
below is therefore uppercased on screen even though the source writes it in
sentence case), and the **subtitle** is `12px · HT.green (#8ECAE6)`.

---

## F.1 — Data layer (`Scanner.tsx:2896–2961`, `hooks/useEsCandles.ts`, `hooks/useNqCandles.ts`)

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F1** Instrument state | `useState<"ESU"\|"NQU">("ESU")` | Default `"ESU"` | — | Not persisted — no localStorage, no URL param. Remounting the tab resets to ESU |
| **F2** Sessions-to-draw state | `useState<5\|10\|30>(5)` | Default `5` | — | Not persisted |
| **F3** Kind-filter state | `useState<"all"\|"extremes"\|"holes">("all")` | Default `"all"` | `holes` → `s.kind === "hole"`; `extremes` → `s.kind !== "hole"`; `all` → everything | **`setKindFilter` is never called anywhere in the file.** No control renders it. The filter is permanently `"all"` — see Do not port |
| **F4** History window (calendar days) | `historyDays = nSessions <= 5 ? 14 : nSessions <= 10 ? 22 : 46` | Integer days | Ladder: `5D → 14`, `10D → 22`, `30D → 46`. The comment explains 30 RTH sessions needs ~45 calendar days | — |
| **F5** ES candle hook | `useEsCandles(instr === "ESU", historyDays)` — `intervalMinutes` defaults `5`, `withAverages` defaults `true` | Returns `{candles, sessionCandles, historical, connected, refresh}` | Fully idle when `enabled === false` (no SQLite read, no socket subscription) | On the NQU tab this hook is disabled and returns empty arrays |
| **F6** NQ candle hook | `useNqCandles(instr === "NQU", historyDays)` | Same shape | Same enable gate | — |
| **F7** Bandwidth gate | `useWsLifecycle()` AND the `enabled` flag → `shouldConnect` | — | Both hooks stay disconnected if the global lifecycle says no | — |
| **F8** ES load | `queryEsCandlesToday(5)` → `GET /api/snapshots/candles?date=${etDateStr()}&interval=5&limit=2000&lite=1`; `queryEsCandlesHistorical(historyDays, 5)` → `GET /api/snapshots/candles?daysBack=${historyDays}&limit=20000&interval=5&lite=1` (`lib/snapdb.ts:441–458`). Both legs run under `Promise.allSettled`, shared across hook instances by `sharedLoad` (3000 ms TTL, key `` `${intervalMinutes}\|${historyDays}` ``) | `date` is the ET date from `etDateStr()` (`Intl.DateTimeFormat` `America/New_York`, `YYYY-MM-DD`). `interval` defaults to `5`. Rows are `EsCandleRecord` | `daysBack <= 0` switches the query string to `limit=50000` with **no `daysBack` filter** — "every candle we have". Never hit from this tab, which always passes 14/22/46 | A rejected leg logs `"[es-candles] today load failed:"` / `"[es-candles] history load failed:"` and yields `[]` for that leg only. Both legs failing leaves `todayRows`/`historical` empty → "Waiting on RTH candles." |
| **F9** ES live merge | `subscribeGex({topics: ["esCandles","es1mCandles"]})`; handler takes `type === "snapshot" → data.esCandles`, or `type === "esCandles"` | Merged by `slotKey`; live wins | Publishes are **coalesced on a 250 ms trailing timer** (`COALESCE_MS`), a 4 Hz render ceiling. Refs are written every frame, so no data is dropped | `connected` flips false on unsubscribe |
| **F10** NQ load | `queryNqCandlesToday()` → `GET /api/snapshots/candles?symbol=/NQ&date=${etDateStr()}&limit=2000&lite=1`; `queryNqCandlesHistorical(historyDays)` → `GET /api/snapshots/candles?symbol=/NQ&daysBack=${historyDays}&limit=10000&lite=1` (`lib/snapdb.ts:461–469`). Run under `Promise.all` — **not** `allSettled`, so one rejection takes both down | Same endpoint as ES; `symbol=/NQ` selects the `nq_candles` table | **Neither NQ query sends `interval`**, unlike the ES pair — the NQ read is unfiltered by aggregation. History limit is **10000**, half the ES leg's 20000; `daysBack <= 0` → `symbol=/NQ&limit=50000` | `.catch(() => {})` at the call site swallows it silently; the tab shows "Waiting on RTH candles." with no error |
| **F11** NQ live merge | `useNqCandles` opens **its own raw `WebSocket` to `${ws|wss}://${host}/ws/gex`**, reconnecting on a fixed 2500 ms timer | `type === "snapshot" → data.nqCandles`; `type === "nqCandles"` | No coalescing at all — every frame fires `setTodayRows` / `setSessionTick` | — |
| **F12** Candle union | `allCandles` = `Map<slotKey, EsCandle>` seeded from `historical`, overwritten by `candles`, then `.sort((a,b) => a.timestamp - b.timestamp)` | Ascending by ms timestamp | Live rows always win over DB rows on the same `slotKey` | `[]` when nothing loaded |
| **F13** Instrument filter | `allCandles.filter(c => (c.symbol ?? "").toUpperCase().includes("ESU"\|"NQU"))`, and `return filtered.length ? filtered : allCandles` | Substring match on `symbol` | **Falls back to the unfiltered array when the filter empties it** — so a feed whose `symbol` is `"/ES"` rather than `"ESU25"` silently passes everything through | `[]` |
| **F14** Recompute key | `barCountKey = \`${candles.length}:${last?.date ?? ""}\`` | String | The structure scan is memoised on **bar count + last date only** — deliberately NOT on candle content, so an intrabar tick never re-runs the multi-day walk | `"0:"` |
| **F15** Bin size | `binSize = instr === "NQU" ? 5 : 1` | Points | ESU = 1 pt bins, NQU = 5 pt bins | — |
| **F16** Structure scan | `useMemo(() => buildTpoStructures(candles, binSize), [barCountKey, binSize])` — `candles` is deliberately absent from the deps (`eslint-disable react-hooks/exhaustive-deps`) | `TpoResult` | — | `buildTpoStructures([])` returns empty `sessions`/`structures`/`open` and 8 zero-`n` stat rows |
| **F17** Spot | `candles[candles.length - 1]?.close ?? null` | Number, raw | Last bar's CLOSE, not a live quote — so "spot" lags by up to one 5-minute bar | `null` |
| **F18** AMT read | `useMemo(() => amtRead(res), [res])` | `AmtRead` | Recomputes once per `res`, i.e. once per new bar | `{ok:false, reason:…}` |
| **F19** Open rail | `res.open` filtered by `kindFilter`, then, when `spot != null`, sorted by `Math.abs(mid - spot)` ascending where `mid = (priceLo + priceHi) / 2` | — | Nulls impossible (all numbers). No tie-break — `Array.prototype.sort` stability decides ties, i.e. `res.open`'s own order (`createdTs` DESC) | Unsorted `res.open` order when `spot == null` |
| **F20** `res.open` base order | `all.filter(s => s.repairedAt == null).sort((a,b) => b.createdTs - a.createdTs)` (`lib/tpo.ts:408`) | Newest-created first | — | `[]` |
| **F21** `enoughHistory` | `res.sessions.length >= 2` | Boolean | Gates `TpoOpenLocation` only | Card omitted entirely when false |
| **F22** `shown` | `res.sessions.slice(-nSessions)` | Last N built sessions | A session enters `res.sessions` only if its RTH group has `>= 6` bars AND `buildTpoSession` returns non-null (needs `>= 3` price bins) | `[]` |
| **F23** Dead local | `const today = res.sessions[res.sessions.length - 1] ?? null` (`Scanner.tsx:2938`) | — | **Never referenced.** Dead — see Do not port | — |

---

## F.2 — Card 1 header + controls (`Scanner.tsx:2967–2978`)

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F24** Card title | `` `TPO profile + open levels — last ${shown.length} session${shown.length === 1 ? "" : "s"}` `` | Inner span `17px`, colour `LIGHT_BLUE`; wrapper forces `800 / letterSpacing .12em / UPPERCASE` | Singular/plural on `shown.length === 1` | Reads "…last 0 sessions" before any data lands |
| **F25** Card subtitle | `` `${instr} · ${binSize}-pt bins · 30-min periods · RTH · dashed lines = unfinished business (${open.length})` `` | `12px`, colour `HT.green #8ECAE6`; middots are `·` | `open.length` is the FULL filtered open list, but only 12 lines are drawn — see F49 | Renders "(0)" |
| **F26** "ESU" pill | `setInstr("ESU")` | `seg(instr === "ESU")` | Active: `1px HT.cyan` + `rgba(33,158,188,0.15)` + `#FFFFFF`. Inactive: `1px rgba(255,255,255,0.15)` + transparent + `rgba(255,255,255,0.7)` | Always rendered; default active |
| **F27** "NQU" pill | `setInstr("NQU")` | `seg(instr === "NQU")` | Same ladder | Switching flips which candle hook is enabled → the other tears its socket down |
| **F28** Spacer | `<span style={{width:12}} />` | 12 px gap between the instrument pair and the day pills | — | — |
| **F29** "5D" pill | `setNSessions(5)` | `seg(nSessions === 5)`; label is `` `${n}D` `` | Default active | — |
| **F30** "10D" pill | `setNSessions(10)` | `seg(nSessions === 10)` | — | — |
| **F31** "30D" pill | `setNSessions(30)` | `seg(nSessions === 30)` | Changing this changes `historyDays` → re-runs the SQLite load → new `res` | — |
| **F32** Controls row | inline | `flex · gap 6 · marginBottom 14 · flexWrap wrap · alignItems center` | — | — |
| **F33** No-sessions state | `!shown.length` | `padding 24 · textAlign center · HT.text · 14px` | — | Literal text: **"Waiting on RTH candles."** The `TpoLetterProfile` canvas is not mounted at all in this state |
| **F34** Profile mount | `!!shown.length && <TpoLetterProfile sessions={shown} spot={spot} binSize={binSize} levels={open.slice(0, 12)} />` | `levels` is capped at the **12** open structures nearest spot | — | — |

---

## F.3 — `TpoLetterProfile` toolbar (`Scanner.tsx:2561–2584`)

`btn(active)` (`Scanner.tsx:2561–2566`): `padding 3px 10px · radius 6 · 14px /
700 · cursor pointer · border 1px (active ? HT.cyan : rgba(255,255,255,0.15)) ·
background (active ? rgba(33,158,188,0.15) : transparent) · color
(active ? HT.text : HT.text)` — **both colour branches are `HT.text`**, so the
ternary is a no-op; only border and fill mark the active state.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F35** `"Collapsed"` | `setSplit(false)` | `btn(!split)` | Active by default (`split` initial `false`) | — |
| **F36** `"Split / expanded"` | `setSplit(true)` | `btn(split)` | Toggling `split` also sets `anchorRef.current = true` via the effect on `[sessions.length, split]` → the view re-anchors | — |
| **F37** `"Labels"` | `setLabels(v => !v)` | `btn(labels)`; initial `true` | Controls ONLY the outlined structure band on the newest session (F47). The 3 px spine (F45) and the hover card are unaffected | — |
| **F38** `"Price +"` | `setZy(z => Math.min(8, z * 1.25))` | `btn(false)` — never renders active | Vertical zoom ceiling **8** | — |
| **F39** `"Price −"` | `setZy(z => Math.max(0.4, z / 1.25))` | `btn(false)`; the glyph is U+2212 MINUS SIGN, not a hyphen | Floor **0.4** | — |
| **F40** `"Width +"` | `setZx(z => Math.min(6, z * 1.25))` | `btn(false)` | Horizontal zoom ceiling **6** | — |
| **F41** `"Width −"` | `setZx(z => Math.max(0.4, z / 1.25))` | `btn(false)` | Floor **0.4** | — |
| **F42** `"Reset"` | `reset()` → `anchorRef.current = true; setZx(1); setZy(1); setOx(0); setOy(0)` | `btn(false)` | Re-anchors on the newest profile centred on spot (F52), not on `0,0` | — |
| **F43** Hint line | Static | `"drag to pan · wheel = price zoom · shift+wheel = width zoom · hover a structure for detail"` — `14px`, `HT.text`, `marginLeft 4` | — | Always rendered |
| **F44** Two 10px spacers | `<span style={{width:10}} />` | After "Split / expanded" and after "Labels" | — | — |

---

## F.4 — `TpoLetterProfile` canvas drawing spec (`Scanner.tsx:2351–2559`)

**It paints to a `<canvas>`, not the DOM** (`Scanner.tsx:2586–2618`). The
comment at 2263–2265 gives the reason: 5 sessions × ~14 periods × ~60 bins is
several thousand cells and that many DOM nodes re-rendering on a WS tick is what
froze the tab. The canvas carries **no `data-cb-layer`** and there is **no
visibility guard** — the draw effect runs whenever any of its 12 deps change,
whether or not the card is on screen. Both are v3 non-negotiables; see
Do not port.

Fixed geometry, all from `Scanner.tsx:2267–2270` and `2359–2375`:

```
TPO_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"   // 36 glyphs
IB_PERIODS  = 2                     // periods 0 and 1 = 09:30–10:30
VIEW_H      = 660                   // fixed CSS px viewport height
AXIS = 58 · TOP = 14 · BOT = 26 · GUTTER = 118
rows   = Math.max(1, Math.round((hi - lo) / binSize))
baseRh = Math.max(5, Math.min(11, (VIEW_H - TOP - BOT) / rows))   // (620/rows) clamped to [5,11]
rh     = baseRh * zy                              // row height, px
cw     = Math.max(4, (baseRh - 0.5) * zx)         // cell width, px
DPR    = Math.min(2, window.devicePixelRatio || 1)
y(p)   = TOP + oy + ((hi - p) / binSize) * rh
vis(py)= py > TOP - rh && py < VIEW_H - BOT + rh   // i.e. (14-rh, 634+rh)
```

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F45** Canvas element | `<canvas ref>` | `display block · width 100% · height 660 · borderRadius 10 · touchAction none`; backing store `w*DPR × 660*DPR`, transform `setTransform(DPR,0,0,DPR,0,0)` | `background: "#0b0f14"` | Effect returns early when `!cv \|\| !sessions.length`, leaving the previous frame on screen |
| **F46** Price domain | `lo = Math.min(...sessions.map(d => d.low))`, `hi = Math.max(...sessions.map(d => d.high))` | Shared across all drawn sessions — one price axis for the strip | Effect bails if `!(hi > lo)` | Blank canvas |
| **F47** Width source | `ResizeObserver` on the wrapper div → `setW(el.clientWidth \|\| 1180)` | Initial state `1180` | — | Falls back to `1180` when `clientWidth` is 0 |
| **F48** Clip region | `g.rect(AXIS, 0, w - AXIS, VIEW_H - BOT + 14)` = `rect(58, 0, w-58, 648)` | Everything from the first session to the open-level labels is clipped to it | Keeps panned content off the price gutter | — |
| **F49** Strip origin | `let x = AXIS + 10 + ox` = `68 + ox` | Sessions laid left→right OLDEST first (`res.sessions` is date-ascending) | Per session: `cols = split ? d.periods : (d.maxCount \|\| 1)`, `wid = cols * cw`, then `x += wid + GUTTER` | — |
| **F50** Session culling | `if (x + wid + GUTTER > 0 && x < w)` | Off-screen sessions draw nothing — but still advance `x` | — | — |
| **F51** Value-area shading | `g.fillRect(x - 3, y(d.vah) - rh/2, wid + 8, y(d.val) - y(d.vah) + rh)` | Fill `rgba(255,255,255,0.055)` — a 5.5% white wash | Painted only when `vis(y(d.vah)) \|\| vis(y(d.val))`. The band spans **VAH→VAL**, i.e. the 70% value area from `vaPct = 0.70` in `buildTpoSession` | Skipped when both edges are off-screen |
| **F52** Letter cell | one per entry of `b.periods` per bin | `fillRect(cx, cy - rh/2 + 0.5, cw - 1.2, rh - 1)` where `cx = x + (split ? pi : i) * cw` — **collapsed packs letters left by array order `i`; split parks each letter in its own period column `pi`** | See F53–F55 | Bins failing `vis(cy)` are skipped entirely |
| **F53** POC row cell | `Math.abs(b.price - d.poc) < 1e-9` | fill `#F2A93B` (an amber that is NOT `HT.orange`), ink `#3d2405` | **First branch — wins over the IB rule**, so an IB letter sitting on the POC is amber, never red | — |
| **F54** Initial-Balance cell | `pi < IB_PERIODS` i.e. period index 0 or 1 → 09:30 and 10:00 | fill `HT.red #EF4444`, ink `#ffffff` | Second branch | — |
| **F55** Later-period cell | everything else | fill `#5B9BD5`, ink `#0b1a26` | Third branch | — |
| **F56** Letter glyph | `TPO_LETTERS[pi % 36]` | Font `` `${Math.max(6, Math.floor(Math.min(rh, cw) - 1.5))}px ui-monospace, monospace` ``, `textBaseline "middle"`, `textAlign "center"`, drawn at `cx + (cw - 1.2)/2, cy` | **Drawn only when `rh >= 7 && cw >= 6`** — below that the cells are anonymous coloured boxes. Period 26 wraps to `"0"`, period 36 back to `"A"` | — |
| **F57** `P:` tag | `tag(d.poc, "#F2A93B", \`P: ${d.poc.toFixed(2)}\`, 46)` | Leader line `x+wid+4 → x+wid+46` at `y(poc)`, `lineWidth 1`; label at `x+wid+50`, `10px ui-monospace`, `textAlign left`, baseline middle | Colour `#F2A93B` | Skipped when `!vis(y(price))` |
| **F58** `M:` tag | `tag(d.mid, HT.red, \`M: ${d.mid.toFixed(2)}\`, 34)` | Leader 34 px | Colour `HT.red #EF4444`. `mid = (high + low) / 2` — the RANGE midpoint, not the POC | Skipped when off-screen |
| **F59** `H:` tag | `tag(d.high, "rgba(140,190,235,0.8)", \`H: ${d.high.toFixed(2)}\`, 26)` | Leader 26 px | — | Skipped when off-screen |
| **F60** `L:` tag | `tag(d.low, "rgba(140,190,235,0.8)", \`L: ${d.low.toFixed(2)}\`, 26)` | Leader 26 px | Same colour as `H:` | Skipped when off-screen |
| **F61** Tag draw order | `P` → `M` → `H` → `L` | Later tags paint over earlier ones where prices coincide | — | — |
| **F62** Structure spine | for each `d.structures` where `kind !== "naked_poc"`: `fillRect(x - 6, y(priceHi) - rh/2, 3, y(priceLo) - y(priceHi) + rh)` | 3 px wide, in the 6 px gutter left of the profile | Fill `KIND_COLOR[kind]` | Naked POCs are excluded from the spine entirely |
| **F63** Callout collection | pushed when `yBot > TOP - rh && yTop < VIEW_H - BOT + rh`, with `x0 = x - 8`, `x1 = x + wid + 4`, `today = d.date === lastDate` | `yTop = y(priceHi) - rh/2`, `yBot = y(priceLo) + rh/2` | Collected for EVERY session (hover works on all), painted only for the newest | — |
| **F64** Session date label | `d.date.slice(5)` → `"MM-DD"` | `fillStyle rgba(255,255,255,0.9)`, `10px ui-sans-serif, system-ui`, `textAlign left`, at `(x, VIEW_H - 10)` = y 650 | — | — |
| **F65** Structure band | `if (labels)` and `c.today` | `roundRect(c.x0, c.yTop, c.x1 - c.x0, Math.max(4, c.yBot - c.yTop), 4)`, `fill` then `stroke` | `strokeStyle = KIND_COLOR`, `lineWidth 1.5`, `fillStyle = \`${color}1F\`` (12% alpha via hex suffix) | Nothing drawn when `labels === false` or no session matches `lastDate` |
| **F66** Hit regions | `hitsRef.current = callouts.map(...)` | Stored in a **ref, not state**, so hovering never re-runs the draw | — | `[]` |
| **F67** Spot line | `spot != null && vis(y(spot))` | `setLineDash([5,4])`, `moveTo(AXIS, y) → lineTo(w - 4, y)`, dash cleared after | `strokeStyle HT.green #8ECAE6` | Not drawn when spot is null or off-screen |
| **F68** Spot label | `spot.toFixed(2)` | `10px ui-monospace`, `textAlign right`, at `(w - 6, y(spot) - 7)` | `fillStyle HT.green` | — |
| **F69** Open-level line | `levels` (= `open.slice(0,12)`), price `pr = (priceLo + priceHi) / 2` | `setLineDash([5,4])`, `globalAlpha 0.5`, `lineWidth 1`, `AXIS → w - 4` | `KIND_COLOR[st.kind] \|\| "#ffffff"` — the `\|\| "#ffffff"` fallback is unreachable, `KIND_COLOR` is a total record | Nothing drawn when `levels` is empty/undefined |
| **F70** Open-level label | `` `${KIND_LABEL[st.kind]} ${pr.toFixed(2)}` `` e.g. `"naked poc 6412.50"` | `700 10px ui-monospace`, `textAlign right`, `textBaseline bottom`, at `(w - 6, py - 1)` | Same kind colour, `globalAlpha` restored to 1 first | — |
| **F71** Price gutter | drawn AFTER `g.restore()`, outside the clip | `fillRect(0, 0, AXIS, VIEW_H)` in `#0b0f14` — an opaque plate so panned content never shows through | — | — |
| **F72** Axis grid step | `stepBins = Math.max(1, Math.round(28 / rh))` | Aims for ~28 px between labels | — | — |
| **F73** Gridline | `for (i = 0; i <= rows; i += stepBins)`, `p = hi - i * binSize` | `AXIS → w - 4`, `strokeStyle rgba(255,255,255,0.05)` | **Drawn outside the clip, i.e. ON TOP of the profile letters** | Rows failing `vis(py)` skipped |
| **F74** Axis price label | `p.toFixed(2)` | `10px ui-monospace`, `textAlign left`, baseline middle, at `x = 4` | `fillStyle rgba(255,255,255,0.9)` | — |
| **F75** Draw dependencies | `[sessions, spot, binSize, w, split, labels, zx, zy, ox, oy, levels]` | — | `spot` is in the list, so a new bar's close redraws the whole canvas | — |

### F.4b — View state, anchoring and pointer interaction (`Scanner.tsx:2286–2349`, `2384–2397`, `2588–2617`)

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F76** Anchor trigger | `useEffect(() => { anchorRef.current = true; }, [sessions.length, split])` | — | Fires on mount, on a session-count change, and on every Collapsed↔Split toggle | — |
| **F77** Anchor X | `totalW = Σ((split ? d.periods : (d.maxCount \|\| 1)) * cw + GUTTER)`; `wantOx = Math.min(0, w - AXIS - 10 - totalW)` | px | Puts the RIGHT edge of the strip (the newest session) at the right edge of the viewport; `Math.min(0, …)` stops it scrolling past on a short strip | — |
| **F78** Anchor Y | `wantOy = spot != null ? VIEW_H/2 - TOP - ((hi - spot)/binSize)*rh : 0` | px | Vertically centres spot; `0` when spot is null | — |
| **F79** Anchor commit | `if (Math.abs(wantOx - ox) > 0.5 \|\| Math.abs(wantOy - oy) > 0.5) { setOx; setOy; return; }` | — | The anchor pass **returns before drawing** — the state change re-runs the effect and the real paint happens on the next pass (one dropped frame by design) | — |
| **F80** Wheel zoom | Native `addEventListener("wheel", …, {passive:false})` on the canvas, registered in a mount-only effect | `k = e.deltaY < 0 ? 1.12 : 1/1.12` | No shift → `zy` clamped `[0.4, 8]`; shift → `zx` clamped `[0.4, 6]`. Offset re-solved as `o' = m - ((m - o) * nz) / z` so the price under the cursor stays put | Registered via a native listener specifically because React's synthetic wheel handler is passive |
| **F81** Drag pan | `onPointerDown` → `setPointerCapture` + `drag.current = {x, y, ox, oy}`; `onPointerMove` → `setOx(d.ox + dx); setOy(d.oy + dy)` | 1:1 px | Starting a drag clears any hover card | `onPointerUp` / `onPointerCancel` null the ref; there is no `onPointerLeave` release, so leaving mid-drag with the button down keeps `drag.current` set |
| **F82** Hover hit test | `hitsRef.current.find(h => mx >= h.x0 - 3 && mx <= h.x1 + 3 && my >= h.yTop - 3 && my <= h.yBot + 3)` | **3 px pad on all four sides** — a 1-point poor high is ~5 px tall and otherwise un-hoverable | First match in array order wins (oldest session first, then structure order) | `setHover(null)` on no hit and on `onPointerLeave` |
| **F83** Hover re-set guard | `if (hover?.hit.s.id !== hit.s.id \|\| hover.x !== mx) setHover(...)` | — | Re-renders on every x-pixel of movement inside one band | — |
| **F84** Cursor | `drag.current ? "grabbing" : hover ? "pointer" : "grab"` | — | `drag.current` is a **ref**, so the `grabbing` cursor only appears after the first pan `setState` re-renders | — |

### F.4c — Hover card (`Scanner.tsx:2620–2646`)

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F85** Card box | `hover && <div>` | `position absolute · pointerEvents none · zIndex 5 · width 268 · padding 9px 11px · radius 8`; `left = Math.min(hover.x + 14, Math.max(0, w - 290))`, `top = Math.min(hover.y + 12, VIEW_H - 92)` = `min(y+12, 568)` | `background rgba(11,15,20,0.96)` (= `#0b0f14` at 96%), `border 1px ${hit.color}`, `boxShadow 0 6px 20px rgba(0,0,0,0.5), inset 0 0 0 999px ${hit.color}1A` — the inset shadow is how the card is tinted to the structure's kind colour | Unmounted when `hover === null` |
| **F86** Card title | `KIND_TITLE[s.kind]` — full strings in F.7 | `12px / 700` | Colour = `KIND_COLOR[kind]` | — |
| **F87** Card note | `KIND_NOTE[s.kind]` | `12px · marginTop 3 · lineHeight 1.35` | `HT.text` | — |
| **F88** Card identity line | `` `${s.date} · ${band}` `` where `band = priceHi > priceLo ? \`${priceLo.toFixed(2)}–${priceHi.toFixed(2)}\` : priceLo.toFixed(2)` | `12px · marginTop 5 · fontVariantNumeric tabular-nums`; the separator is an en dash `–` | `HT.text` | Zero-width structures (naked POC, poor high/low) show a single price |

---

## F.5 — Legend under the profile (`Scanner.tsx:2987–2993`)

Row style: `flex · gap 14 · flexWrap wrap · marginTop 12 · fontSize 13 · color HT.text`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F89** `"naked POC — magnet"` | static | `naked POC` in `<b>` | `KIND_COLOR.naked_poc` = `LIGHT_BLUE #7dd3fc` | Always |
| **F90** `"poor hi/lo — unfinished, target"` | static | `poor hi/lo` in `<b>` | `KIND_COLOR.poor_high` = `HT.orange #FB8501` | Always |
| **F91** `"excess — rejection, holds"` | static | `excess` in `<b>` | `KIND_COLOR.excess_high` = `HT.red #EF4444` | Always |
| **F92** `"hole — thin, runs through"` | static | `hole` in `<b>` | `KIND_COLOR.hole` = `NEUTRAL #6B7280` | Always |
| **F93** `"· dashed lines = the {open.length} open structures nearest spot"` | `open.length` | plain text | **Wrong count.** Only `open.slice(0, 12)` is passed to the profile, so with 40 open structures the line claims 40 dashed lines and 12 are drawn | Reads "the 0 open structures nearest spot" |
| **F94** Missing legend entry | — | — | `tail hi` / `tail lo` have **no legend row**, and they share `HT.orange` with `poor hi/lo` — so a tail on the chart reads as a poor high | — |

---

## F.6 — `AmtPanel` (`Scanner.tsx:2787–2894`)

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F95** Live pad | `livePad = Math.max(binSize * 2, (spot ?? 0) * 0.0012)` | Points | ESU: `max(2, spot·0.0012)` → ~7.9 pts at 6600. NQU: `max(10, …)`. `spot == null` → `max(binSize*2, 0)` | — |
| **F96** Not-ready card | `!amt.ok` | Card `variant="budget"`, title `"AMT — auction read & live signals"` (`17px`, `HT.cyan`; `&amp;` in source renders `&`); body `padding 20 · textAlign center · HT.text · 14px` | Two reasons only: **`"No RTH session yet."`** and **`"Needs a prior completed session for value context."`** (`lib/amt.ts:98–99`) | This IS the panel's loading state — no spinner, no skeleton |
| **F97** Card title | static | `17px`, `HT.cyan`, uppercased by the Card header | — | — |
| **F98** Card subtitle | `` `Day-timeframe read vs prior value${liveCount ? ` · ${liveCount} live` : ""}${spot != null ? ` · spot ${spot.toFixed(2)}` : ""}` `` | `12px`, `HT.green #8ECAE6`; spot 2 dp | Suffixes appear only when non-zero / non-null | Bare `"Day-timeframe read vs prior value"` |
| **F99** Tile grid | inline | `display grid · gridTemplateColumns repeat(auto-fit, minmax(180px, 1fr)) · gap 10 · marginBottom 14` | — | — |
| **F100** Tile shell | `tile(label, value, note, color)` | `padding 10px 12px · radius 10 · 1px rgba(255,255,255,0.08) · bg rgba(255,255,255,0.02) · flex column gap 3 · minWidth 0`. Label `12px · UPPERCASE · letterSpacing .05em · HT.text`; value `17px / 800 · color ?? HT.text`; note `14px · HT.text · lineHeight 1.4` | — | `note` omitted when falsy |
| **F101** Tile "Day type" | `amt.dayType.label` / `.note` | See the full 7-outcome table in F.8 | No colour override — value is `HT.text` | Never null (`amt.ok` implies a computed dayType) |
| **F102** Tile "IB width" | `amt.ibRatio != null ? \`${amt.ibClass} · ${amt.ibRatio.toFixed(2)}×\` : "building"`, note `"vs recent-median IB"` | e.g. `"narrow · 0.62×"` — 2 dp, `×` is U+00D7 | `ibColor`: `narrow → HT.orange`, `wide → HT.cyan`, otherwise (`average` or `null`) `HT.text` | `"building"` when no median IB baseline exists yet |
| **F103** Tile "State" | value `amt.stateLabel.split(" — ")[0]`, note `amt.stateLabel.split(" — ")[1]` | Splits on `" — "` (space em-dash space). e.g. value `"Imbalance ↑"`, note `"value entirely above prior; repricing higher"` | `stateColor`: `imbalance_up`/`shift_up` → `HT.green #8ECAE6`; `imbalance_down`/`shift_down` → `HT.red`; `balance` → `LIGHT_BLUE` | — |
| **F104** Tile "Opening" | `amt.opening?.label ?? "—"`, note `amt.opening?.note` | Four labels, all suffixed `"(approx)"` — see F.8 | No colour override | `"—"` if `opening` is null (unreachable when `ok`) |
| **F105** Bias banner | `amt.bias` + `amt.location` | Banner `padding 10px 14px · radius 10 · marginBottom 14 · 14px / 600 · lineHeight 1.5 · HT.text`; the location sub-line `14px / 400 · marginTop 4` | `border 1px ${stateColor}40` (25%), `background ${stateColor}0F` (6%) | Both strings always present when `ok` |
| **F106** Signal-rail `<summary>` | `<details>` — **collapsed by default**, no `open` attribute | `flex · gap 10 · cursor pointer · listStyle none · padding 8px 12px · radius 10` | `border 1px ${liveCount ? HT.green : HT.orange}40`, `background ${…}0F`, `borderLeft 3px solid ${…}` — green when anything is live, orange otherwise | — |
| **F107** `"Signals & Alerts"` | static (`&amp;` in source) | `15px / 800 · letterSpacing .04em · UPPERCASE · HT.text` | — | — |
| **F108** Count pill | `liveCount ? \`● ${liveCount} live\` : \`${signals.length} armed\`` | `12px / 800 · letterSpacing .04em · UPPERCASE · padding 2px 8px · radius 999` | Live: colour `HT.green`, `border 1px HT.green`, `bg ${HT.green}1A`. Not live: colour `HT.text`, `border 1px rgba(255,255,255,0.25)`, `bg rgba(255,255,255,0.04)` | `"0 armed"` when the signal list is empty |
| **F109** `"tap to expand"` | static | `marginLeft auto · 13px · HT.text` | Text never changes to "collapse" when open | — |
| **F110** Signal list | `signals.map(s => <AmtSignalRow …>)` keyed on `s.id` | `flex column · gap 7 · marginTop 10` | — | — |
| **F111** Empty signal list | `!signals.length` | `padding 16 · textAlign center · HT.text · 14px` | — | **"No actionable auction signals yet — waiting on IB and structure to form."** |
| **F112** Signal sort | `(Number(b.live) - Number(a.live)) \|\| (LEVEL_RANK[a.level] - LEVEL_RANK[b.level]) \|\| (a.dist - b.dist)` | 3-key comparator, recomputed in a `useMemo` on `[amt.signals, spot, livePad]` | 1) **live first** (`live` = `trigger != null && spot != null && \|spot - trigger\| <= livePad`); 2) **level rank** `action 0 < watch 1 < info 2`; 3) **absolute distance to spot ascending**, with `Infinity` when `trigger` or `spot` is null so triggerless signals sink to the bottom. No 4th tie-break — `sort` stability leaves `amt.signals` build order | — |

---

## F.7 — `AmtSignalRow` (`Scanner.tsx:2737–2785`)

`LEVEL_RANK` = `{action: 0, watch: 1, info: 2}`.
`LEVEL_COLOR` = `{action: HT.orange #FB8501, watch: LIGHT_BLUE #7dd3fc, info: HT.text #FFFFFF}`.
`dirGlyph(d)` (`Scanner.tsx:2734–2735`) = `up → {g:"▲", c:HT.green #8ECAE6}`,
`down → {g:"▼", c:HT.red #EF4444}`, anything else (`"flat"`) →
`{g:"◆", c:HT.text #FFFFFF}`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F113** Row shell | — | `display grid · gridTemplateColumns "70px 1fr 96px" · gap 10 · alignItems start · padding 9px 12px · radius 8` | Live: `border 1px HT.green`, `background ${HT.green}14` (8%). Not live: `border 1px rgba(255,255,255,0.08)`, `background rgba(255,255,255,0.02)` | — |
| **F114** Live test | `s.trigger != null && spot != null && Math.abs(spot - s.trigger) <= livePad` | Inclusive `<=` | Recomputed **per render** in the row, independently of the sort's copy — so liveness reacts to every WS tick without re-running `amtRead` | Never live when `trigger` or `spot` is null |
| **F115** Level chip | `s.level` — literally `"action"`, `"watch"` or `"info"` | `12px / 800 · letterSpacing .04em · UPPERCASE · radius 5 · padding 2px 6px · textAlign center` | colour `LEVEL_COLOR[level]`, `border 1px ${c}55` (33%), `background ${c}18` (9%) | — |
| **F116** `"● LIVE"` badge | `live` | `12px / 800 · letterSpacing .04em · textAlign center`, glyph `●` U+25CF | `HT.green` | Omitted entirely when not live |
| **F117** Direction glyph | `dirGlyph(s.dir).g` | `▲` / `▼` / `◆`, inline before the title | Colours per `dirGlyph` above | Always one of the three |
| **F118** Signal title | `s.title` — full catalogue in F.9 | `14px / 700 · HT.text`, `flex · gap 6` with the glyph | — | — |
| **F119** Signal detail | `s.detail` | `14px · HT.text · lineHeight 1.45` | — | — |
| **F120** Trigger price | `s.trigger != null ? s.trigger.toFixed(2) : "—"` | 2 dp, `14px / 700`, right-aligned column | `HT.text` | `"—"` |
| **F121** Target | `s.target != null ? \`→ ${s.target.toFixed(2)}\` : "trail"` | `"→ 6412.50"` or the literal word `"trail"` | `HT.text` | `"trail"` is the null-target rendering — used by every range-extension and tail/hole signal |
| **F122** Distance | `dist = s.trigger - spot`, rendered `` `${dist >= 0 ? "+" : ""}${dist.toFixed(2)}` `` | Signed, 2 dp. **Signed here (trigger − spot), unsigned in the sort comparator** | `HT.text` — never coloured, unlike `StructureRow`'s distance | The whole `<span>` is omitted when `trigger` or `spot` is null |

---

## F.8 — `TpoForecastCard` (`components/scanner/TpoForecastCard.tsx:1–69`)

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F123** Fetch | `GET /api/tpo-forecast?symbol=${instr === "NQU" ? "NQ" : "ES"}`, `{cache: "no-store"}`. Served by `computeTpoForecast(searchParams)` (`lib/tpo-forecast-compute.ts:97–205`), which maps `symbol.toUpperCase() === "NQ" ? "NQU" : "ESU"` — **any other value, including a missing param, falls through to `"ESU"`** | Runs on mount and on every `instr` change, then on a **60 000 ms `setInterval`**. Cleanup clears the interval and sets `alive = false`; **there is no `AbortController`** — an in-flight response is dropped by the `alive` flag, not cancelled | `j?.error` truthy → error branch. The route returns `{error: String(message)}` at HTTP **500** from its outer `catch`; the card does not check `res.ok`, it only reads `j.error` | — |
| **F124** Card frame | `Card variant="budget"`, title `"Forecast"` | Title span `15px`, `HT.orange`; body `14px · HT.text · lineHeight 1.5` | — | — |
| **F125** Error line | `err` | `"Couldn't load: {err}"` (apostrophe is `&apos;`) | `HT.text` | Renders whenever the fetch throws or the response carries `error` |
| **F126** Loading line | `!fc` | Literal `"Loading…"` (single `…` glyph), no subtitle | — | First paint |
| **F127** Accumulating | `!fc.ok && status === "accumulating"` | Body `` `Accumulating history — ${fc.nHistory}/${fc.need ?? 40} sessions.` ``; subtitle `"open → day base rate"` | The server always sends `need: LIVE_MIN` = **40**, so the `?? 40` fallback never fires. **Two server branches produce this status**: `hist.length < 40` (`nHistory` = real count), and the `catch` around the `tpo_profiles` query when the recorder table does not exist (`nHistory: 0`) — the card renders both as `"…0/40 sessions."` and cannot tell them apart | — |
| **F128** Pre-IB | `!fc.ok && status === "pre_ib"` | Body `"Waiting on today's open to print."` (`&apos;`); subtitle `"lights up at open"` | Server condition is `!todaySess \|\| !ibDone`, where `ibDone = etNowMin() >= 630 (10:30 ET) && ibHigh != null && ibLow != null`. **The card's wording is wrong**: this state is waiting on the IB to *complete* at 10:30 ET, not on the open to print — the server's own `note` says "Waiting on the Initial Balance (first two 30-min periods) to complete." | — |
| **F129** Result line | `fc.ok` | `` `Similar opens (n=${fc.k}) settled value ` `` + `<b>{va[0].toFixed(0)}–{va[1].toFixed(0)}</b>` + `" · POC "` + `<b>{predicted_poc.toFixed(2)}</b>` + optional `" · spot "` + `<b>{spot.toFixed(2)}</b>`. VA bounds **0 dp**, POC and spot **2 dp**, all `tabular-nums` | `fc.k` is the constant `K = 25`, so the line **always reads `(n=25)`** — it is the neighbour count, not a sample size that varies. `predicted_va` and `predicted_poc` are absolute prices off the offset grid (F196). `spot` is `bars[bars.length-1]?.close` on the SERVER's today-bars, not the client's `spot` | POC bold is `LIGHT_BLUE #7dd3fc`; the VA and spot bolds inherit `HT.text`. Spot clause omitted when `fc.spot == null` |
| **F130** Result subtitle | `` `${fc.symbol} · open → day · conf ${fc.confidence}` `` | `confidence` rendered **raw, unformatted** — no rounding, no `%` | `fc.symbol` is the server's normalised `"ESU"` / `"NQU"`, **not** the `"ES"` / `"NQ"` the request sent. `confidence` is an **integer 0–100** (F197), so the subtitle reads e.g. `"ESU · open → day · conf 73"` — a bare number a reader will not know is a percent | `HT.green #8ECAE6` (Card subtitle colour) |
| **F131** Unrendered fields | `fc.realized_poc`, `fc.realized_va`, and — absent from the card's `Forecast` type entirely — `date`, `nHistory`, `ibMid`, `ibHigh`, `ibLow`, `prices`, `predicted[]`, `realized[]`, plus the `note` string on both `ok:false` branches | The response carries two full 201-point normalised density curves (`predicted`, `realized`) and their shared price axis; the card renders none of it | The card composes its own wording and never shows the server's `note` | — |

---

## F.9 — `TpoOpenLocation` (`components/scanner/TpoOpenLocation.tsx:1–137`)

Mounted only when `res.sessions.length >= 2` (`Scanner.tsx:3004`).

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F132** Card title | static | `"RTH open vs previous values"` — `17px`, `HT.orange`, uppercased by the Card header | — | — |
| **F133** Waiting state | `!candles.length \|\| res.sessions.length < 2 \|\| !latestDate \|\| !prior` | `padding 16 · HT.text · 14px` | — | **"Waiting on RTH candles."** — same string as F33 |
| **F134** RTH open price | `candles.find(c => c.date === latestDate && etMin(c.timestamp) >= 570 && etMin(c.timestamp) < 960)?.open` | `RTH_OPEN = 9*60+30 = 570`, `RTH_CLOSE = 16*60 = 960`; `etMin` reads hour/minute via `Intl.DateTimeFormat` in `America/New_York`, `hour12:false` | Uses the bar's OPEN, not close | `null` before 09:30 ET |
| **F135** Prior session | `[...res.sessions].reverse().find(s => s.date < latestDate)` | The last built session strictly before today | — | Card returns the waiting state when there is none |
| **F136** Prior-week value | `res.sessions.filter(s => s.date < mondayOf(latestDate) && s.date >= mondayOf(previous week))`, merged by `mergeVA` | `mondayOf` uses `getUTCDay()` and `dow → (dow+6)%7` back-step; the prior week's Monday is derived from `wkMon - 7 * 864e5` | `mergeVA` sums bin counts across sessions, then walks out from the merged POC to **70%** (`target = total * 0.7`), taking the higher neighbour on ties (`ab >= bel`) | Returns `null` when fewer than 3 merged bins → renders **"No prior-week value."** (`12px`, `HT.text + "88"`) |
| **F137** Anchor for open levels | `openPx ?? spot ?? prior.poc` | Three-step fallback | — | — |
| **F138** Open-level candidates | `res.open.filter(s => (kind === "naked_poc" \|\| kind === "poor_high" \|\| kind === "poor_low") && s.ageSessions >= 1)` | Excess, tail and hole are excluded here | `nkUp` = nearest with `mid > anchor` (sorted ascending); `nkDn` = nearest with `mid < anchor` (sorted descending). A structure exactly AT the anchor is dropped by both | `null` on either side |
| **F139** Location classifier | `loc(vah, val)` = `O == null ? null : O > vah ? "above" : O < val ? "below" : "inside"` | Strict `>` / `<`, so O exactly on VAH is `"inside"` | — | `null` before the open |
| **F140** Banner text | `dLoc` | `"Prior RTH session hasn't opened yet"` (O null) / `"Open INSIDE prior value"` / `"Open ABOVE prior value"` / `"Open BELOW prior value"` — `15px / 800 · letterSpacing .01em` | `tone`: `above → HT.green #8ECAE6`, `below → HT.red`, `inside` **and `null`** → `LIGHT_BLUE` | The `O == null` case takes the `LIGHT_BLUE` tone by falling through the ternary |
| **F141** Banner plate | — | `background ${tone}14` (8%), `border 1px ${tone}55` (33%), `radius 10`, `padding 11px 14px`, `marginBottom 12` | — | — |
| **F142** Lean paragraph — no open | `O == null` | `12.5px · HT.text · marginTop 4 · lineHeight 1.55` | — | "Levels below are prior session values — the open read fills in at 09:30 ET." |
| **F143** Lean — inside | `dLoc === "inside"` | same | — | "Rotational / balanced lean. Two-sided trade likely inside prior value; the pd VAH/VAL edges are fade zones back toward pd POC. Break-and-accept beyond an edge flips to the outside-value case." |
| **F144** Lean — above | `dLoc === "above"` | same | — | "Higher open. If price ACCEPTS above pd VAH (holds, builds value) → trend up, target the open levels above. If it REJECTS back below pd VAH → failed auction, rotate down toward pd POC / into prior value." |
| **F145** Lean — below | `dLoc === "below"` | same | — | "Lower open. If price ACCEPTS below pd VAL (holds, builds value) → trend down, target the open levels below. If it REJECTS back above pd VAL → failed auction, rotate up toward pd POC / into prior value." |
| **F146** `Ref` row | `<Ref label px color>` | `flex · gap 8 · padding 6px 0 · borderTop 1px ${HT.text}12` (7%). Label `12px · ${HT.text}CC` (80%) · `minWidth 118`. Price `13px / 700 · tabular-nums · minWidth 62 · color ?? HT.text`, **2 dp** | — | **Returns `null` and the row disappears** when `px == null` |
| **F147** `Ref` delta | `rel = O - px` | `` `open ${rel >= 0 ? "+" : ""}${rel.toFixed(2)}` `` — `12px / 700 · tabular-nums` | `rel >= 0 → HT.green`, else `HT.red`. Zero counts as positive | Whole span omitted when `O == null` |
| **F148** Column head — left | `` `Prior day (${prior.date})` `` | `11px · UPPERCASE · letterSpacing .07em · ${HT.text}AA` (67%) · `700` · `marginBottom 2` | — | — |
| **F149** `"pd high"` | `prior.high` | `Ref`, no colour → `HT.text` | — | — |
| **F150** `"pd VAH"` | `prior.vah` | `Ref` | `LIGHT_BLUE` | — |
| **F151** `"pd POC"` | `prior.poc` | `Ref` | `HT.orange` | — |
| **F152** `"pd VAL"` | `prior.val` | `Ref` | `LIGHT_BLUE` | — |
| **F153** `"pd low"` | `prior.low` | `Ref` | `HT.text` | — |
| **F154** Column head — right | static | `"Prior week & open levels"` (`&amp;`), same style as F148 | — | — |
| **F155** `"pw VAH"` | `week.vah` | `Ref` | `LIGHT_BLUE` | Whole trio replaced by "No prior-week value." when `week == null` |
| **F156** `"pw POC"` | `week.poc` | `Ref` | `HT.orange` | — |
| **F157** `"pw VAL"` | `week.val` | `Ref` | `LIGHT_BLUE` | — |
| **F158** Up open level | label `nkUp ? \`↑ ${KIND_TITLE[nkUp.kind].split(" — ")[0]}\` : "↑ open level"`, price `midS(nkUp)` | e.g. `"↑ Poor high"`, `"↑ Naked POC"` | `HT.green` | When `nkUp == null` the price is `null` → **`Ref` returns null and the row vanishes**, so the `"↑ open level"` fallback label is unreachable |
| **F159** Down open level | same with `nkDn`, `↓` | e.g. `"↓ Naked POC"` | `HT.red` | Same — fallback label unreachable |
| **F160** Card subtitle | `` `${O != null ? `open ${O.toFixed(2)} · ` : ""}${spot != null ? `spot ${spot.toFixed(2)} · ` : ""}vs prior day + prior week + open levels` `` | 2 dp each | `HT.green` (Card subtitle) | Both prefixes drop out independently |
| **F161** Footnote | static | `marginTop 10 · 11.5px · ${HT.text}99` (60%) · `lineHeight 1.5` | — | `"open ±" = where the RTH open printed relative to each level. Prior-week value merges the prior calendar week's RTH profiles; open levels are the nearest unfinished naked POC / poor high-low above and below.` (quotes are `&quot;`, apostrophes `&apos;`) |
| **F162** Column layout | — | Outer `flex · gap 18 · flexWrap wrap`; each column `flex 1 · minWidth 260` | — | — |

---

## F.10 — Structure stats (`Scanner.tsx:3007–3039`)

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F163** `<summary>` | `<details>` — collapsed by default | `"Structure stats"` `15px / 800 · HT.cyan`, then `"· base rates by kind · tap to expand"` `12px / 600 · HT.text · UPPERCASE · letterSpacing .05em`; container `cursor pointer · listStyle none · padding 12px 16px · radius 12 · border 1px rgba(255,255,255,0.09)` | — | Always rendered, even with zero stats |
| **F164** Card title | static | `"Structure stats"` — `17px`, `HT.cyan` | — | — |
| **F165** Card subtitle | `` `${res.sessions.length} sessions loaded · graded once ≥1 later session exists` `` | `12px`, `HT.green` | The `≥1` matches `gradable = all.filter(s => s.ageSessions >= 1)` (`lib/tpo.ts:368`) | `"0 sessions loaded · …"` |
| **F166** Header row | static | `grid "1fr 44px 62px 70px 56px" · gap 6 · padding 4px 0 6px · borderBottom 1px rgba(255,255,255,0.12) · 14px · HT.text · UPPERCASE · letterSpacing .05em` | — | — |
| **F167** Column 1 — `"kind"` | `KIND_LABEL[s.kind]` | `14px / 700` | Coloured `KIND_COLOR[s.kind]` | — |
| **F168** Column 2 — `"n"` | `s.n` = count of gradable structures of that kind | Integer | `HT.text` | — |
| **F169** Column 3 — `"test %"` | `pctOrDash(s.testRate)`; `testRate = tested/n` where tested = `testedAt != null` | Rounded integer % | `HT.text` — **no colour ladder anywhere in this table** | `"—"` when `n === 0` (but such rows are filtered out) |
| **F170** Column 4 — `"repair %"` | `pctOrDash(s.repairRate)`; `repairRate = repaired/n` | Rounded integer % | `HT.text` | `"—"` |
| **F171** Column 5 — `"med d"` | `s.medSessionsToTest ?? "—"` | Raw integer sessions — **upper median** (`spans[Math.floor(len/2)]` on an ascending sort) | `HT.text` | `"—"` when nothing of that kind was ever tested |
| **F172** Row set | `res.stats.filter(s => s.n > 0)` | Fixed order from the `kinds` array in `buildTpoStructures` (`lib/tpo.ts:369–372`): **excess_high, excess_low, tail_high, tail_low, poor_high, poor_low, hole, naked_poc**. No user sort, no click-to-sort | Row `borderBottom 1px rgba(255,255,255,0.06) · padding 7px 0` | Rows with `n === 0` are dropped entirely |
| **F173** Bucket chips | `res.buckets.filter(b => b.kind === s.kind && b.n > 0)` | `` `${b.bucket} ` `` + `<b>{pctOrDash(b.testRate)}</b>` + `` ` n=${b.n}` `` — `14px · HT.text`, `flex · gap 10 · marginTop 4 · flexWrap wrap` | Bucket order fixed: **`"0-5d"`, `"6-20d"`, `"20d+"`** | Empty buckets omitted; a kind whose buckets are all empty shows the row with no chip line |
| **F174** Nothing-graded state | `!res.stats.some(s => s.n > 0)` | `padding 16 · HT.text · 14px` | — | **"Not enough history loaded to grade anything yet."** |

---

## F.11 — The full `StructureKind` taxonomy (`lib/tpo.ts:59–64`, `427–480`)

Eight kinds. All four string tables are **total records** — every kind has every
string, so no fallback path exists.

### excess_high
- `KIND_LABEL` — `"excess hi"`
- `KIND_TITLE` — `"Excess high — selling tail"`
- `KIND_NOTE` — `"Singles at the high, period closed back inside. Fade it."`
- `KIND_MEANING` — `"Rejection — auction ended properly. Level holds; fade back toward POC."`
- `KIND_COLOR` — `HT.red #EF4444` · `side: "up"`
- **Detection** (`lib/tpo.ts:254–262`): a run of `>= 2` contiguous single-print bins ending at the top bin, AND the period that printed the session high closed **below** the run's low (`hiPeriod.close < lo`)
- **Repair**: some later bar's `high > priceHi`
- **`baseRateFor`** — bucket rate when that `kind × bucket` has `n >= 5` and a non-null `testRate`; else the kind rate when `n >= 5`; else `null`
- **`ageBucket`** — `<= 5 → "0-5d"`, `<= 20 → "6-20d"`, else `"20d+"`

### excess_low
- `KIND_LABEL` — `"excess lo"`
- `KIND_TITLE` — `"Excess low — buying tail"`
- `KIND_NOTE` — `"Singles at the low, period closed back inside. Fade it."`
- `KIND_MEANING` — `"Rejection — auction ended properly. Level holds; fade back toward POC."`
- `KIND_COLOR` — `HT.red #EF4444` · `side: "down"`
- **Detection** (`lib/tpo.ts:268–272`): `>= 2` contiguous singles starting at the bottom bin, AND the period that printed the session low closed **above** the run's high (`loPeriod.close > hi`)
- **Repair**: some later bar's `low < priceLo`
- Same `baseRateFor` / `ageBucket` rules as above (they are kind-agnostic)

### tail_high
- `KIND_LABEL` — `"tail hi"`
- `KIND_TITLE` — `"Tail high — trend leg"`
- `KIND_NOTE` — `"Singles left by a trend leg, closed at the high. Don't fade."`
- `KIND_MEANING` — `"Trend leg left singles behind — continuation, NOT rejection. Don't fade it."`
- `KIND_COLOR` — `HT.orange #FB8501` · `side: "up"`
- **Detection**: the same top singles run as `excess_high`, but `hiPeriod.close >= lo` — the period closed out at the extreme
- **Repair**: some later bar's `high > priceHi`

### tail_low
- `KIND_LABEL` — `"tail lo"`
- `KIND_TITLE` — `"Tail low — trend leg"`
- `KIND_NOTE` — `"Singles left by a trend leg, closed at the low. Don't fade."`
- `KIND_MEANING` — `"Trend leg left singles behind — continuation, NOT rejection. Don't fade it."`
- `KIND_COLOR` — `HT.orange #FB8501` · `side: "down"`
- **Detection**: bottom singles run with `loPeriod.close <= hi`
- **Repair**: some later bar's `low < priceLo`

### poor_high
- `KIND_LABEL` — `"poor high"`
- `KIND_TITLE` — `"Poor high — unfinished"`
- `KIND_NOTE` — `"Flat stack, no tail. Expect it to get taken out."`
- `KIND_MEANING` — `"Unfinished auction — ran out of time, not sellers. Expect it to get taken out."`
- `KIND_COLOR` — `HT.orange #FB8501` · `side: "up"` · **zero width** (`priceLo === priceHi === bins[topIdx].price`)
- **Detection** (`lib/tpo.ts:263–266`): no qualifying top singles run AND `bins[topIdx].count >= 2`
- **Repair**: some later bar's `high > priceHi`

### poor_low
- `KIND_LABEL` — `"poor low"`
- `KIND_TITLE` — `"Poor low — unfinished"`
- `KIND_NOTE` — `"Flat stack, no tail. Expect it to get taken out."`
- `KIND_MEANING` — `"Unfinished auction — ran out of time, not buyers. Expect it to get taken out."`
- `KIND_COLOR` — `HT.orange #FB8501` · `side: "down"` · zero width
- **Detection**: no qualifying bottom singles run AND `bins[botIdx].count >= 2`
- **Repair**: some later bar's `low < priceLo`

### hole
- `KIND_LABEL` — `"hole"`
- `KIND_TITLE` — `"Hole — thin zone"`
- `KIND_NOTE` — `"Mid-profile singles. Price accelerates through."`
- `KIND_MEANING` — `"Thin zone — no acceptance. Price accelerates THROUGH. Never target inside it."`
- `KIND_COLOR` — `NEUTRAL #6B7280`
- `side` — `lo >= poc ? "up" : "down"` (`lib/tpo.ts:281`)
- **Detection**: any singles run touching neither extreme. **Note: no `length >= 2` requirement** — a single isolated single-print bin becomes a hole, unlike the tails/excess which need `>= 2`
- **Repair**: a later session traded BOTH `high > priceHi` and `low < priceLo`. The `above`/`below` flags reset per session, so it must be a full traverse **within one session**
- **UI exception** — `StructureRow` renders `"—"` for a hole's base rate regardless of what `baseRateFor` returns (`Scanner.tsx:2705`)

### naked_poc
- `KIND_LABEL` — `"naked poc"`
- `KIND_TITLE` — `"Naked POC — magnet"`
- `KIND_NOTE` — `"Untested fair value. Strong magnet."`
- `KIND_MEANING` — `"Untested fair value from a prior session. Strong magnet."`
- `KIND_COLOR` — `LIGHT_BLUE #7dd3fc` · `side: "up"` (hardcoded) · zero width at `poc`
- **Detection**: emitted unconditionally for **every** session (`lib/tpo.ts:284`)
- **Repair**: the first later bar that touches the band at all — `touchedThisSession`, so tested and repaired collapse to the same event
- **Excluded** from the on-chart spine (F62) but included in the dashed open-level lines (F69)

### Engine parameters these all depend on

| Constant | Value | Where |
|---|---|---|
| `TPO_PERIOD_MS` | `30 * 60_000` (30 min) | `lib/tpo.ts:45` |
| `binSize` default | `1` (the tab passes `1` for ESU, `5` for NQU) | `lib/tpo.ts:174`, `Scanner.tsx:2932` |
| `vaPct` | `0.70` | `lib/tpo.ts:176` |
| Bin function | `Math.floor(p / binSize) * binSize` | `lib/tpo.ts:180` |
| Value-area walk tie-break | `if (above >= below)` — **ties go UP** | `lib/tpo.ts:225` |
| POC tie-break | strict `>` in the scan, so the **lowest-priced** bin wins a tie | `lib/tpo.ts:217` |
| Min bins for a session | `bins.length < 3` → `null` | `lib/tpo.ts:214` |
| Min bars for a session | `bars.length < 6` → skipped | `lib/tpo.ts:320` |
| `TOUCH_PAD` | `0.25` (one ES tick) — widens every band for the hit test | `lib/tpo.ts:298` |
| `MIN_N` | `5` — the `baseRateFor` sample floor | `lib/tpo.ts:138` |
| Grading floor | `ageSessions >= 1` | `lib/tpo.ts:368` |
| `AgeBucket` boundaries | `ageSessions <= 5` → `"0-5d"`; `<= 20` → `"6-20d"`; else `"20d+"` | `lib/tpo.ts:114–116` |
| `structure.id` | `` `${date}:${kind}:${lo}` `` | `lib/tpo.ts:250` |
| `ageSessions` | `sessions.length - 1 - i` — age as of the LAST loaded session, not today | `lib/tpo.ts:358` |
| `medSessionsToTest` | `spans[Math.floor(spans.length / 2)]` on ascending order — upper median on even counts | `lib/tpo.ts:388` |
| `sessionsBetween` fallback | returns `sessions.length - 1 - i` when no later session's `createdTs >= ts` | `lib/tpo.ts:424` |

---

## F.12 — `StructureRow` — defined at `Scanner.tsx:2656–2717`, **never rendered**

Transcribed because it is the tab's intended structure rail and the port will
want it, but nothing in `TpoStructuresScanner` (or anywhere else in the repo)
mounts it. `GRID` (`Scanner.tsx:2654`) and the `baseRateFor` / `ageBucket` /
`KIND_MEANING` imports exist only for it.

`GRID = "210px 1fr 60px 76px 96px 62px"` — six columns, in order:
badge · price band · age · distance · base rate · touches.
Row shell: `display grid · gap 8 · alignItems center · padding 9px 12px ·
borderBottom 1px rgba(255,255,255,0.06) · fontSize 14`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F175** Col 1 — kind badge | `KIND_TITLE[s.kind]` | `14px / 700 · padding 2px 9px · radius 999 · whiteSpace nowrap · justifySelf start · cursor help` | colour `KIND_COLOR[kind]`, `border 1px ${c}55`, `background ${c}1A` | — |
| **F176** Col 1 — badge tooltip | `title={KIND_MEANING[s.kind]}` | Native `title=` — full strings in F.11 | — | Always present |
| **F177** Col 2 — price band | `priceHi > priceLo ? \`${priceLo.toFixed(2)}–${priceHi.toFixed(2)}\` : priceLo.toFixed(2)` | 2 dp, en dash, `tabular-nums` | `HT.text` | Zero-width kinds show one price |
| **F178** Col 3 — age | `` `${s.ageSessions}d` `` | e.g. `"7d"` | `HT.text` | Always a number |
| **F179** Col 4 — distance | `dist = mid - spot` where `mid = (priceLo + priceHi)/2`; rendered `` `${dist >= 0 ? "+" : ""}${dist.toFixed(2)}` `` | Signed, 2 dp, `tabular-nums` | `dist == null → HT.text`; `dist >= 0 → HT.green #8ECAE6`; `dist < 0 → HT.red #EF4444`. Zero is green | `"—"` when `spot == null` |
| **F180** Col 5 — base rate | `s.kind === "hole" ? "—" : pctOrDash(base.rate)` | Rounded integer % | Colour ternary is `base.rate == null ? HT.text : HT.text` — **a no-op**, always white | `"—"` for holes and for `rate == null` |
| **F181** Col 5 — `n=` suffix | `` `n=${base.n}` `` | `14px · HT.text` | Shown only when `kind !== "hole" && base.rate != null` | Omitted otherwise |
| **F182** Col 5 — tooltip, no sample | `base.scope === "none"` | `` `Not enough graded ${KIND_LABEL[kind]} structures yet to quote a rate (n=${base.n}).` `` | Native `title=`, `cursor help` | — |
| **F183** Col 5 — tooltip, with sample | `base.scope === "bucket" \| "kind"` | `` `${Math.round((base.rate ?? 0) * 100)}% of ${KIND_LABEL[kind]} structures ${scope === "bucket" ? `aged ${ageBucket(s.ageSessions)}` : "(all ages)"} were eventually tested — n=${base.n}. This is a base rate for the TYPE, not a probability for this level.` `` | — | — |
| **F184** Col 6 — touches | `s.testedAt ? \`${s.touches}×\` : "untested"` | `"3×"` (U+00D7) or the literal `"untested"` | `s.testedAt → HT.orange #FB8501`; else `HT.text` | — |

---

## F.13 — The `AmtSignal` catalogue (`lib/amt.ts:196–297`)

Every signal the rail can contain, in **build order** (which is also the
sort's final tie-break). `SignalLevel` is `"action" | "watch" | "info"` and
carries no threshold of its own — it is assigned literally per signal below.

| id | level | dir | title | trigger | target | Fires when |
|---|---|---|---|---|---|---|
| `vah-fade` | `watch` | `down` | `"Fade today's VAH"` | `today.vah` | `today.poc` | `state === "balance"` |
| `val-fade` | `watch` | `up` | `"Fade today's VAL"` | `today.val` | `today.poc` | `state === "balance"` |
| `trend-pullback` | `action` | `trend` | `` `Buy/sell the pullback to ${edgeName}` `` — `edgeName` is `"VAL"` when trend up, `"VAH"` when trend down | `trend === "up" ? today.val : today.vah` | `trend === "up" ? today.vah : today.val` | `state !== "balance"` and `trend !== "flat"` |
| `re-up` | `action` | `up` | `"Range extension ↑ — follow"` | `today.ibHigh` | `null` → renders `"trail"` | `rangeExt === "up"` AND `ibHigh != null` AND `ibClass !== "wide"` |
| `re-dn` | `action` | `down` | `"Range extension ↓ — follow"` | `today.ibLow` | `null` | `rangeExt === "down"` AND `ibLow != null` AND `ibClass !== "wide"` |
| `ib-fade-hi` | `watch` | `down` | `"Responsive fade at IB high"` | `today.ibHigh` | `today.poc` | `ibClass === "wide"` AND `rangeExt === "none"` AND `ibHigh != null` |
| `ib-fade-lo` | `watch` | `up` | `"Responsive fade at IB low"` | `today.ibLow` | `today.poc` | `ibClass === "wide"` AND `rangeExt === "none"` AND `ibLow != null` |
| `<structure.id>` | `watch` | `down` | `"Fade the excess high"` | `s.priceLo` | `today.poc` | a today `excess_high` |
| `<structure.id>` | `watch` | `up` | `"Fade the excess low"` | `s.priceHi` | `today.poc` | a today `excess_low` |
| `<structure.id>` | `info` | `up` | `"Tail high — trend leg, don't fade"` | `s.priceLo` | `null` | a today `tail_high` |
| `<structure.id>` | `info` | `down` | `"Tail low — trend leg, don't fade"` | `s.priceHi` | `null` | a today `tail_low` |
| `<structure.id>` | `action` | `up` | `"Poor high — unfinished, expect a take-out"` | `s.priceLo` | `s.priceLo` (same value) | a today `poor_high` |
| `<structure.id>` | `action` | `down` | `"Poor low — unfinished, expect a take-out"` | `s.priceHi` | `s.priceHi` (same value) | a today `poor_low` |
| `<structure.id>` | `info` | `STRUCT_DIR[kind] ?? "flat"` → always `"flat"` for a hole | `"Hole — thin zone, price accelerates through"` | `(priceLo + priceHi) / 2` | `null` | a today `hole` |
| `np-<structure.id>` | `watch` | `flat` | `"Naked POC — magnet"` | `np.priceLo` | `np.priceLo` | `res.open` contains at least one `naked_poc`; takes `[0]`, i.e. the **most recently created**, not the nearest to spot |

**No signal is emitted for today's `naked_poc`** — the today-structures loop has
no `naked_poc` branch; the magnet row comes only from the forward-filled open
rail.

`detail` strings, verbatim (all prices `toFixed(2)`):

- `vah-fade` — `` `Responsive sell at value-area high ${vah} → target POC ${poc}. Balance-day mean reversion; tight risk above VAH.` ``
- `val-fade` — `` `Responsive buy at value-area low ${val} → target POC ${poc}. Balance-day mean reversion; tight risk below VAL.` ``
- `trend-pullback` — `` `Initiative ${trend === "up" ? "buyers" : "sellers"} — enter pullbacks into developing value near ${edge}, trail behind structure. Do not fade the ${trend === "up" ? "highs" : "lows"}.` ``
- `re-up` — `` `Broke IB high ${ibHigh} on a ${ibClass ?? "?"} IB — initiative up. Buy the pullback to IB high, don't fade.` ``
- `re-dn` — `` `Broke IB low ${ibLow} on a ${ibClass ?? "?"} IB — initiative down. Sell the pullback to IB low, don't fade.` ``
- `ib-fade-hi` — `` `Wide IB, no extension — rotational. Fade IB high ${ibHigh} back toward POC ${poc}.` ``
- `ib-fade-lo` — `` `Wide IB, no extension — rotational. Fade IB low ${ibLow} back toward POC ${poc}.` ``
- excess high — `` `Rejection tail at ${priceLo} — auction ended properly, level holds. Fade back toward POC ${poc}.` ``
- excess low — `` `Rejection tail at ${priceHi} — level holds. Fade back toward POC ${poc}.` ``
- tail high — `"Singles left by a trend leg that closed at the high — continuation, not rejection. Buy pullbacks; do NOT short it."`
- tail low — `"Singles left by a trend leg that closed at the low — continuation, not rejection. Sell rallies; do NOT buy it."`
- poor high — `` `Flat stack at ${priceLo}, no tail — ran out of time, not sellers. Expect price to return and take it out. Trade toward it.` ``
- poor low — `` `Flat stack at ${priceHi}, no tail — ran out of time, not buyers. Expect price to return and take it out. Trade toward it.` ``
- hole — `` `Mid-profile singles ${priceLo}–${priceHi}. No acceptance — price rips through. Never target inside; put targets on the far side.` ``
- naked POC — `` `Untested fair value at ${priceLo} from ${np.date} — a strong magnet. Price is drawn to it; use it as a target, not a fade.` ``

### The AMT read's own ladders (`lib/amt.ts:103–194`)

**IB width** — `priorIbs` = the last 20 non-null, `> 0` `ibRange` values from all
sessions except the newest; `avgIbRange = median(priorIbs)` where `median` is the
**upper** median (`s[Math.floor(len/2)]`). `ibRatio = ibRange / avgIbRange`.
Ladder, in order:

1. `ibRatio == null` → `ibClass = null`
2. `ibRatio < 0.75` → `"narrow"`
3. `ibRatio > 1.25` → `"wide"`
4. otherwise → `"average"` (i.e. `[0.75, 1.25]` inclusive both ends)

**Range extension** — `pad = res.binSize` (1 for ESU, 5 for NQU).
`reUp = ibHigh != null && high > ibHigh + pad`;
`reDn = ibLow != null && low < ibLow - pad`;
`rangeExt = reUp && reDn ? "both" : reUp ? "up" : reDn ? "down" : "none"`.

**Day type** — 7 reachable outcomes, evaluated in this order:

| Condition | `label` | `note` |
|---|---|---|
| `narrow` + extension `up`/`down` | `"Trend / range-extension"` | `` `Narrow IB, one-sided extension ${rangeExt}. Do NOT fade — position with the move on pullbacks.` `` |
| `narrow` + `none`/`both` | `"Coiled — expect extension"` | `"Narrow IB, no extension yet. Odds favor a range-extension break; trade the break, not the middle."` — **note the mismatch: `rangeExt === "both"` on a narrow IB also lands here and the note says "no extension yet"** |
| `wide` + `both` | `"Neutral — two-sided"` | `"Wide IB, extension both ways. Rotational and noisy — fade extremes or stand aside."` |
| `wide` + `none` | `"Normal — rotational"` | `"Wide IB, minimal extension. Bell-shaped rotation likely — fade value-area extremes toward POC."` |
| `wide` + `up`/`down` | `"Normal — modest extension"` | `` `Wide IB with ${rangeExt} extension. Lean with the extension but respect rotation risk.` `` |
| `average`/`null` + `up`/`down` | `"Normal variation"` | `` `Average IB, ${rangeExt}-side extension — the most common day. Trade with the extension.` `` |
| `average`/`null` + `both` | `"Neutral — two-sided"` | `"Average IB, both-sided extension. Fade extremes or stand aside."` |
| `average`/`null` + `none` | `"Balancing"` | `"Average IB, no extension. Two-sided so far — let the auction tip its hand."` |

**State** — evaluated in order, first match wins (`lib/amt.ts:144–148`):

1. `today.val > prior.vah + pad` → `imbalance_up`
2. `today.vah < prior.val - pad` → `imbalance_down`
3. `today.poc > prior.vah` → `shift_up` (**no pad on this one**)
4. `today.poc < prior.val` → `shift_down` (no pad)
5. otherwise → `balance`

`stateLabel` strings, verbatim:
- `balance` — `"Balance — value overlaps prior; two-sided"`
- `imbalance_up` — `"Imbalance ↑ — value entirely above prior; repricing higher"`
- `imbalance_down` — `"Imbalance ↓ — value entirely below prior; repricing lower"`
- `shift_up` — `"Shift ↑ — POC pushed above prior value"`
- `shift_down` — `"Shift ↓ — POC pushed below prior value"`

**Opening type** — `rng = today.high - today.low`,
`fromLow = (today.open - today.low) / rng`; `openVsPriorVA` is
`"above prior value"` / `"below prior value"` / `"inside prior value"`:

1. `rng <= 0` → `"Open-Auction (approx)"`, note `` `Opened ${openVsPriorVA}.` ``
2. `fromLow <= 0.15` → `"Open-Drive ↑ (approx)"`, note `` `Opened near the low ${openVsPriorVA} and drove up — highest trend odds. Trade with the drive.` ``
3. `fromLow >= 0.85` → `"Open-Drive ↓ (approx)"`, note `` `Opened near the high ${openVsPriorVA} and drove down — highest trend odds. Trade with the drive.` ``
4. otherwise → `"Open-Auction / rotational (approx)"`, note `` `Opened mid-range ${openVsPriorVA} — two-sided, low conviction. Wait for clearer information.` ``

**`bias`** — three outcomes:
- `imbalance_up` / `shift_up` → `"Bias HIGHER — initiative buyers in control. Buy pullbacks into developing value; do not fade the highs."`
- `imbalance_down` / `shift_down` → `"Bias LOWER — initiative sellers in control. Sell rallies into developing value; do not fade the lows."`
- `balance` → `"TWO-SIDED — value overlaps prior. Fade value-area extremes toward POC; trade the range until acceptance breaks it."`

**`location`** — `` `Today value ${val}–${vah} (POC ${poc}) · prior value ${prior.val}–${prior.vah}.` `` (all 2 dp).

**`playbook`** — a 5-entry `string[]` that **nothing in this tab renders**. See
Do not port.

---

## F.14 — Session grouping, transport and the forecast engine (`lib/balanceImbalance.ts:56–119`, `lib/snapdb.ts:363–469`, `lib/tpo-forecast-compute.ts:1–205`)

Added 2026-09-02 once `snapdb.ts`, `balanceImbalance.ts`, `valueArea.ts`,
`marketSession.ts` and `tpo-forecast-compute.ts` were staged. These rows replace
what the first pass could not read.

### F.14a — How a candle becomes a session (`lib/balanceImbalance.ts:56–119`)

`lib/tpo.ts:42` imports **only** `groupRthByDate` from this module. Nothing else
in `balanceImbalance.ts` — `classifyDay`, `backtestQuadrants`, `rthBarsForDate`,
`sessionDates`, the `Quadrant` taxonomy, `CONFIRM_BARS`/`SETTLE_BARS`/
`CONTRACTION_RATIO` — is reachable from this tab.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F185** RTH window | `RTH_OPEN = 9*60+30 = 570`, `RTH_CLOSE = 16*60 = 960` (`balanceImbalance.ts:56–57`) | ET minutes-since-midnight | `isRthBar(ts)` = `minutes >= 570 && minutes < 960` — **inclusive at 09:30, exclusive at 16:00**. A 15:55 5-minute bar is the last one in | A bar whose timestamp is unparseable gets `minutes: NaN`; both comparisons are false, so it is dropped |
| **F186** Session assignment | `etSessionDate(c)` = `etParts(c.timestamp).date \|\| c.date` (`balanceImbalance.ts:85–87`) | `"YYYY-MM-DD"` | The ET **calendar date of the bar's own timestamp** wins; the record's `c.date` column is only a fallback when the timestamp fails to parse. Because the window is 09:30–16:00 ET there is no midnight-spanning case — the session date is always the bar's ET date | `""` → the bar is skipped by `groupRthByDate` |
| **F187** ET conversion | One module-level `ET_FMT = new Intl.DateTimeFormat("en-US", {timeZone:"America/New_York", year/month/day 2-digit, hour/minute 2-digit, hour12:false})`, reused for every bar (`balanceImbalance.ts:64–68`) | — | `hour === "24"` is normalised to `"00"` — the `hour12:false` midnight quirk. Constructing a formatter per call was the documented cause of the scanner freezing the dashboard | — |
| **F188** Grouping pass | `groupRthByDate(candles)` — one pass, `Map<string, EsCandle[]>`, skipping non-RTH bars and blank dates (`balanceImbalance.ts:108–119`) | Each day's array `.sort((a,b) => a.timestamp - b.timestamp)` after the fill | **This is the only RTH gate in Part F.** `lib/tpo.ts:314` calls it, then `[...grouped.keys()].sort()` gives the date-ascending session order every row above depends on | An all-ETH candle set yields an empty Map → `res.sessions = []` → "Waiting on RTH candles." |
| **F189** Session admission | `bars.length < 6` → skipped (`lib/tpo.ts:320`); then `buildTpoSession` returns `null` when `bins.length < 3` | 6 five-minute bars = 30 minutes = one full TPO period | A session that opens and halts inside 25 minutes never becomes a `TpoSession` and is invisible to every panel in this tab | — |
| **F190** No market-hours gate | `lib/marketSession.ts` (`isSessionLive`, `isSpxFeedLive`, `isTradingDay`, `isHoliday`) | — | **Nothing in Part F imports it.** The tab polls, redraws and computes identically at 03:00 on a Sunday as at 10:00 on a Tuesday; the only liveness gate is `useWsLifecycle()` on the socket (F7). Holidays are never excluded — a holiday simply produces no RTH bars and therefore no session | — |

### F.14b — Candle transport (`lib/snapdb.ts:363–469`)

**There is no IndexedDB.** The module header (`snapdb.ts:1–3`) states all data
moved to server-side SQLite behind API routes and that these functions only
"mirror the old IndexedDB API so callers need minimal changes." There are no
object stores, no `idb` handles and no client-side persistence of candles — the
only caching is the in-flight promise map below.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F191** Request dedupe | `_candleCache = Map<url, {at, p}>` with `_CANDLE_TTL = 5000` (`snapdb.ts:382–383`, `411–434`) | Keyed on the **full URL string**, so a different `date`/`daysBack`/`interval` is a different entry | A hit inside 5000 ms returns the SAME promise; on rejection the entry is deleted so the next caller retries. This sits **under** `useEsCandles`'s own `sharedLoad` (3000 ms, F8) — two independent dedupe layers on one request path | — |
| **F192** HTTP failure | `if (!res.ok) throw new Error(\`candles HTTP ${res.status} for ${url}\`)` | Thrown, not returned | Propagates to `Promise.allSettled` on the ES path (logged per leg, F8) and to `Promise.all` on the NQ path (both legs lost, F10) | Callers `.catch(() => {})`, so no error text ever reaches the screen |
| **F193** Lite payload | `_expandCandles(json)` (`snapdb.ts:394–409`) | `{lite:1, cols:[…], rows:[[…]]}` columnar tuples expanded back into records by zipping `cols` | Falls through to the legacy `rows: [{…}]` object shape when `json.lite !== 1` or `cols` is not an array, so a client ahead of the backend still works. All four candle queries send `lite=1` | `rows` absent or empty → `[]` |
| **F194** Type coercion | `normalizeCandle` (`snapdb.ts:367–377`) | `Number()` over `timestamp, open, high, low, close, volume` | Postgres BIGINT/REAL deserialize as **strings** through the route; without this `new Date("1782187200000")` is Invalid Date and every RTH filter silently drops the bar. Runs on both encodings so they cannot drift | — |
| **F195** Decode-mismatch warning | `!out.length && json.rows.length` (`snapdb.ts:424–428`) | `console.warn("[candles] decoded 0 rows from a non-empty response", {url, lite, cols, sample})` | Console only — the UI still shows "Waiting on RTH candles." | — |

### F.14c — `/api/tpo-forecast` engine (`lib/tpo-forecast-compute.ts`)

Constants: `BIN = 1`, `GRID_LO = -100`, `GRID_HI = 100`, `GRID_N = 201`,
`K = 25`, `LIVE_MIN = 40`, `IB_CLOSE_MIN = 630` (10:30 ET).

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **F196** History + query | `SELECT date, poc, vah, val, ib_high, ib_low, ib_mid, ib_range, day_open, day_close, day_high, day_low, profile_json FROM tpo_profiles WHERE symbol = ? AND date < ? ORDER BY date ASC` with `[symbol, today]`; today's side is `getEsCandles(today, undefined, 2000)` → `rthBarsForDate(rows, today)` → `buildTpoSession(bars, today, BIN)` | `symbol` is `"ESU"`/`"NQU"`; `date < today` is a strict no-lookahead cut | Needs `bars.length >= 3` to build today's session at all. **`BIN` is hardcoded `1`** — the forecast profiles NQU on 1-point bins while the tab draws it on 5 (F15), so the two disagree for NQU | A throw on the history query returns `accumulating` with `nHistory: 0` |
| **F197** Feature vector | `features(r, prev, trailIb, trailRng)` (`lines 70–82`) — five dimensions, in order: `ibRange/trailIb`, `(day_open − ibMid)/ibRange`, `gap/trailIb` where `gap = day_open − prev.day_close`, `prevPocOff/trailIb` where `prevPocOff = prev.poc − ibMid`, `prevRng/trailRng` | Unitless ratios | `trailIb` / `trailRng` are **trailing 20-session medians** (`hist.slice(i-20, i)`), upper median via `s[Math.floor(len/2)]`, each falling back to the row's own value or `1` when the window is empty. Missing `prev` fields contribute `0` | — |
| **F198** k-NN + prediction | Features standardised on the history's own mean/sd (`sd \|\| 1`), Euclidean distance, sorted ascending, `nn = dist.slice(0, 25)`; weights `w = (1/(d+1e-6)) / Σ(1/(d+1e-6))`; `pred[g] = Σ dens[g]·w` where each neighbour's `profile_json` is turned into a 201-bin density by `toDensity(bins, hist[i].ib_mid)` — normalised to sum 1, offsets outside ±100 pts dropped | 201-point density on an offset grid vs IB mid | Today's `realized` density is `toDensity(todaySess.bins, ibMid)` on the same grid. `prices[g] = GRID_LO + g·BIN + ibMid`, so both `predicted_va` and `predicted_poc` come back as **absolute prices** | — |
| **F199** Confidence formula | `confidence = Math.max(0, Math.min(100, Math.round(100 * (1 - meanK / medAll))))` where `meanK` is the mean distance of the 25 neighbours and `medAll` the median distance across ALL history rows (`\|\| 1`) | **Integer 0–100** — this is what F130 prints raw | Clamped both ends. Higher = the 25 neighbours are tight relative to the overall spread | — |
| **F200** VA band | `vaBand(dens, 0.7)` (`lines 85–95`) — POC = argmax of the density, then expand outward taking the larger neighbour (`above >= below`, **ties go up**) until `0.7 × Σdens` is captured | Returns grid indices, mapped to prices | Structurally identical to `buildTpoSession`'s walk (`lib/tpo.ts:221–227`) and to `TpoOpenLocation.mergeVA` — **three separate copies of the same 70% expansion**, all with the same tie rule | — |
| **F201** `lib/valueArea.ts` is NOT in this path | `computeValueArea` is imported only by `lib/balanceImbalance.ts:20`, used only by `backtestQuadrants` | — | **Correction to the brief's premise:** the 70% value area on this tab is *time*-based (TPO counts) and comes from `buildTpoSession`; `computeValueArea` is a *volume* profile that spreads each bar's volume evenly across the bins its range touches, and it additionally computes an `lvn` (lowest local-minimum bin, edges excluded) that Part F never shows. Nothing in Part F reaches it. The two would give different VAH/VAL on the same bars | — |

---

### Colours used

| v2 value | Where used in Part F | Exists in v3 `tokens.css`? | Proposed v3 token |
|---|---|---|---|
| `HT.red` `#EF4444` | `KIND_COLOR.excess_high/low`; IB letter-cell fill (F54); the `M:` mid tag (F58); `dirGlyph("down")`; `stateColor` down; `StructureRow` negative distance; `TpoOpenLocation` "below" tone + `↓ open level` + negative `open ±` | yes — `--color-v2-red` | **`T.red`** → `--color-down`. Do not carry `--color-v2-red` here; this page has no v2-parity requirement |
| `HT.orange` `#FB8501` | `KIND_COLOR.tail_high/low`, `KIND_COLOR.poor_high/low`; `LEVEL_COLOR.action`; `ibColor` narrow; `StructureRow` touches badge; the armed-state summary border; `TpoForecastCard` title; `TpoOpenLocation` title + pd/pw POC refs | yes — `--color-v2-orange` | **`T.orange`** → `--color-warn` `#e0a44a` |
| `#F2A93B` | POC letter-cell fill (F53) and the `P:` POC tag (F57) | no | **`T.orange`** — see the two-oranges note below |
| `#3d2405` | ink on the POC letter cell | no | `alpha(T.bg, 1)` is wrong here — it is a dark brown chosen to sit on `#F2A93B`. Propose a new `--color-tpo-poc-ink`, or derive with `color-mix(in srgb, var(--color-warn) 25%, black)` |
| `NEUTRAL` `#6B7280` | `KIND_COLOR.hole` (spine, dashed line, legend) | yes — `--color-impact-holiday` is the same value | **`T.flat`** → `--color-flat` `#7a828d` |
| `LIGHT_BLUE` `#7dd3fc` | `KIND_COLOR.naked_poc`; `LEVEL_COLOR.watch`; `stateColor` balance; card 1 title; `TpoForecastCard` POC bold; `TpoOpenLocation` VAH/VAL refs + "inside" tone; nav pill colour | no exact (`--color-v2-lightblue` is `#7ed3fc`, one digit off) | **`LIGHT_BLUE`** → `--color-series-5` `#4fb8d4` |
| `HT.cyan` `#219EBC` | AMT + Structure-stats card titles; `seg`/`btn` active border; `ibColor` wide | yes — `--color-v2-cyan` | **`T.cyan`** → `--color-accent` |
| `rgba(33,158,188,0.15)` | `seg`/`btn` active fill | no | `alpha(T.cyan, .15)` |
| `HT.green` `#8ECAE6` (**a light blue, not a green**) | spot dashed line + spot label (F67–F68); `● LIVE` badge; live signal-row border/fill; `dirGlyph("up")`; `stateColor` up; `StructureRow` positive distance; `TpoOpenLocation` "above" tone + `↑ open level` + positive `open ±`; **every Card subtitle** | yes — `--color-v2-green` | **Split it.** The directional uses → `T.green` / `MOVE_UP` (`--color-move-up`); the Card-subtitle use → `T.muted`. Painting a subtitle in the same value as "price is above" is a v2 accident, not a semantic |
| `#5B9BD5` | non-IB letter-cell fill (F55) | no | New token `--color-tpo-period` — it is a third blue, distinct from both `LIGHT_BLUE` and `HT.cyan`, and the letter grid needs it separable from the POC amber and IB red |
| `#0b1a26` | ink on the non-IB letter cell | no | `T.bg`-adjacent; propose `--color-v2-ink` (`#0b0f1a`) or a new `--color-tpo-cell-ink` |
| `#ffffff` | ink on the IB letter cell; `HT.text` everywhere | yes — `--color-fg` | `T.text` |
| `rgba(140,190,235,0.8)` | `H:` and `L:` session tags (F59–F60) | no | `alpha(LIGHT_BLUE, .8)` — the two are close enough to collapse |
| `rgba(255,255,255,0.055)` | value-area shading (F51) | no | `alpha(T.text, .055)` |
| `rgba(255,255,255,0.05)` | axis gridlines (F73) | no | `alpha(T.text, .05)` |
| `rgba(255,255,255,0.9)` | axis price labels, session date labels | no | `alpha(T.text, .9)` |
| `#0b0f14` | canvas background, price-gutter plate | no | `T.bg` → `--color-bg` `#07080b` |
| `rgba(11,15,20,0.96)` | hover-card background — **the same colour as `#0b0f14`, written in a different notation** | no | `alpha(T.bg, .96)`; collapses with the row above |
| `rgba(0,0,0,0.5)` | hover-card drop shadow | yes — `--color-shadow` | `alpha(T.shadow, .5)` |
| `rgba(0,0,0,0.22)` | card `boxShadow` (`classicCardStyle`) | yes | `alpha(T.shadow, .22)` |
| `HT.panelBg` `rgba(13,17,25,0.45)` | every Card plate | no exact | `alpha(V2.panel, .45)` or, preferred here, `T.panel` → `--color-surface` |
| `HT.border` `rgba(255,255,255,0.10)` | Card borders | no exact | `alpha(T.text, .10)` (**not** `--color-line`, which is opaque `#23272e`) |
| `rgba(255,255,255,0.15)` | inactive `seg`/`btn` border | no | `alpha(T.text, .15)` |
| `rgba(255,255,255,0.7)` | inactive `seg` label | no | `alpha(T.text, .7)` |
| `rgba(255,255,255,0.02)` | AMT tile fill, non-live signal-row fill | no | `alpha(T.text, .02)` |
| `rgba(255,255,255,0.04)` | not-live count pill fill | no | `alpha(T.text, .04)` |
| `rgba(255,255,255,0.06)` | `StructureRow` / stats-row bottom border | no | `alpha(T.text, .06)` |
| `rgba(255,255,255,0.08)` | AMT tile + non-live signal-row border | no | `alpha(T.text, .08)` |
| `rgba(255,255,255,0.09)` | Structure-stats `<summary>` border | no | `alpha(T.text, .08)` — collapse with the row above |
| `rgba(255,255,255,0.12)` | stats header bottom border | no | `alpha(T.text, .12)` |
| `rgba(255,255,255,0.25)` | not-live count-pill border | no | `alpha(T.text, .25)` |
| `${color}1A` / `18` / `1F` / `14` / `12` / `0F` hex-alpha suffixes | badge fills, band fills, banner washes, live-row fill | n/a — a v2 idiom | `alpha(<token>, .10 / .09 / .12 / .08 / .07 / .06)`. **These must become `alpha()` calls: hex-suffix alpha does not work on a `var(--color-…)` string** |
| `${color}55` / `40` / `44` | badge borders, banner borders | n/a | `alpha(<token>, .33 / .25 / .27)` |
| `${HT.text}CC` / `AA` / `99` / `88` / `12` / `14` | `TpoOpenLocation` and `TpoForwardMap` label greys and hairlines | n/a | `alpha(T.text, .80 / .67 / .60 / .53 / .07 / .08)` |

**Two-oranges.** v2 paints the POC amber `#F2A93B` (letter cell + `P:` tag) but
everything else orange `#FB8501` (tail/poor structures, `action` level, narrow
IB, the `pd POC` / `pw POC` refs in `TpoOpenLocation`). **The same semantic —
"this is the point of control" — is two different values inside one tab**: the
canvas POC is `#F2A93B` and the DOM POC ref is `#FB8501`. Collapse both onto
`T.orange` in the port.

**Two-blues, four roles.** `LIGHT_BLUE #7dd3fc`, `HT.green #8ECAE6`,
`HT.cyan #219EBC` and `#5B9BD5` are four blues carrying, respectively: naked
POC / watch-level, "up" direction / live, card titles / wide IB, and "a later
TPO period". Nothing in the code ties them together and two of them
(`#7dd3fc` vs `#8ECAE6`) sit adjacent in the same signal rail. The port should
assign each of the four a distinct semantic token and stop reusing `HT.green`
for Card subtitles.

---

### Do not port

1. **`StructureRow` is dead** (`Scanner.tsx:2656–2717`). Defined, fully styled,
   never mounted. `GRID` (2654) exists only for it, and the `baseRateFor`,
   `ageBucket` and `KIND_MEANING` imports (line 34) are used **only** inside it.
   Decide deliberately whether v3 ships this rail — do not port the component
   as-is and leave it unmounted a second time.
2. **`TpoForwardMap` is dead** (`Scanner.tsx:38` imports it; nothing renders it).
   A 142-line card with its own `ROLE` map, `toneColor` ladder and base-rate
   colour thresholds (`>= 0.6` green / `>= 0.4` orange / else red) that no user
   has ever seen. It is also the only place in the tab with a base-rate colour
   ladder, which is worth keeping if the rail comes back — but it ships nothing
   today.
3. **`kindFilter` has no control.** `setKindFilter` is never called
   (`Scanner.tsx:2898`). The `"extremes"` and `"holes"` branches are unreachable
   and the filter is permanently `"all"`. Either ship the segmented control or
   delete the state.
4. **`const today` at `Scanner.tsx:2938` is unused.** Dead.
5. **`amt.playbook`** (`lib/amt.ts:186–194`) — five composed strings, computed on
   every read, rendered nowhere in this tab.
6. **`amt.avgIbRange`** is returned and never displayed (`ibRatio` is what the
   tile shows).
7. **`fc.realized_poc` / `fc.realized_va`** — in the forecast type, never
   rendered.
8. **Untagged canvas.** `TpoLetterProfile`'s `<canvas>` (`Scanner.tsx:2586`)
   carries no `data-cb-layer`. v3 non-negotiable #6.
9. **No visibility guard.** The draw effect (`Scanner.tsx:2351–2559`) runs on
   every change to `[sessions, spot, binSize, w, split, labels, zx, zy, ox, oy,
   levels]` regardless of whether the card is on screen, and `spot` changes on
   every new bar. v3 non-negotiable #5 — the port must gate on
   `handle.visible()` / `onVisibility`.
10. **Page-level socket access.** `useNqCandles` constructs a raw
    `new WebSocket(\`${proto}//${host}/ws/gex\`)` with its own 2500 ms reconnect
    (`useNqCandles.ts:130–146`) — a second connection to the same broadcast that
    `useEsCandles` already reaches through `lib/gexSocket`. v3 non-negotiable #2:
    route both through `useFrame` / `watchFrame`.
11. **No coalescing on the NQ path.** `useNqCandles.ingest` calls `setTodayRows`
    on every frame; `useEsCandles` learned the 250 ms trailing publish and NQ
    never got it. Port the coalesced version only.
12. **`Promise.all` in `useNqCandles.loadFromDb`** (line 81) — one rejected leg
    takes both down, the exact failure `useEsCandles` fixed with `allSettled`
    and a per-leg `console.warn`. Port the ES version's shape.
13. **Colour literals everywhere.** 30+ hex/rgba values are typed directly into
    `Scanner.tsx`, `TpoOpenLocation.tsx` and `TpoForecastCard.tsx`, plus the
    `${color}1A` hex-suffix alpha idiom which cannot survive the move to
    `var(--color-…)`. v3 non-negotiable #1.
14. **`btn()`'s no-op colour ternary** (`Scanner.tsx:2565`) and **`StructureRow`'s
    no-op base-rate ternary** (`Scanner.tsx:2704`) — both branches are identical.
    Do not carry the ternary across; pick the one value.
15. **The legend's wrong count** (F93): the text says `open.length` while
    `open.slice(0, 12)` is drawn. Fix in the port rather than reproducing.
16. **`useIsOwner` does not gate this tab.** `tpo` is not in `OWNER_ONLY_TABS`
    (`scannerNav.ts:61` has no `ownerOnly`), so nothing here is owner-only. There
    is no market-hours gate and no feature flag anywhere in Part F.
17. **`PageShell`** (`Scanner.tsx:3090`) is v2 page chrome; v3's equivalent is
    `Shell.tsx` and the tab contributes nothing to it.
18. **Request waterfall risk.** `historyDays` is derived from `nSessions`, so the
    5D→30D click re-fires the SQLite load *after* the first one has already
    landed. In v3 the route must fire the widest window it may need at entry, or
    the day selector must be a pure client-side slice of one fetch.
19. **`TpoForecastCard`'s `pre_ib` wording is wrong.** It renders "Waiting on
    today's open to print." with the subtitle "lights up at open", but the server
    gate is `etNowMin() >= 630` (10:30 ET) **and** a complete IB — its own `note`
    says so. The card is telling the user to expect a 09:30 fill-in for something
    that cannot appear before 10:30. Fix the string in the port rather than
    reproducing it.
20. **Three copies of the 70% value-area expansion.** `buildTpoSession`
    (`lib/tpo.ts:221–227`), `TpoOpenLocation.mergeVA`
    (`TpoOpenLocation.tsx:35–39`) and `vaBand`
    (`tpo-forecast-compute.ts:85–95`) implement the identical POC-outward walk
    with the identical `above >= below` tie rule, on counts, merged counts and a
    normalised density respectively. v3 should ship one function and pass it the
    weights. A fourth, `computeValueArea` in `lib/valueArea.ts`, is the same walk
    on VOLUME and is unreachable from this tab — do not fold it in, it answers a
    different question (see F201).
21. **Double request dedupe.** `useEsCandles.sharedLoad` (3000 ms, keyed
    `interval|days`) wraps `snapdb._dedupeCandles` (5000 ms, keyed on the URL) —
    two TTL caches on one request path with different windows. v3's data layer
    should own this once.

---

### Open questions for Brandon

1. **Should `StructureRow` ship in v3?** It is the only surface that explains a
   structure's base rate in words ("a base rate for the TYPE, not a probability
   for this level") and it has never rendered. Same question for
   `TpoForwardMap` — two competing designs for the same rail, neither live.
2. **`kindFilter`** — was the extremes/holes segmented control cut on purpose, or
   did the control never get added? It changes whether the port needs the state.
3. **The tail/poor colour collision.** `KIND_COLOR` gives `tail_high`,
   `tail_low`, `poor_high` and `poor_low` the identical orange, so on the chart
   the "don't fade" and "trade toward it" structures are the same colour — the
   confusion `lib/tpo.ts`'s header comment exists to prevent. Should v3 split
   them (e.g. tail → `T.orange`, poor → `T.violet`)?
4. **The `naked_poc` "nearest" claim.** `amtRead` takes `nakedPocs[0]` from
   `res.open`, which is sorted by `createdTs` DESC — the **newest**, not the
   nearest to spot, even though the signal is titled "magnet" and the detail
   says "price is drawn to it". Intended, or a bug to fix in the port?
5. **`hole` needs no minimum run length** while tails and excess need `>= 2`
   contiguous singles (`lib/tpo.ts:254–255` vs `278–282`). On a 1-pt ESU bin a
   single isolated single-print becomes a "hole". Deliberate?
6. **The `shift_up` / `shift_down` state tests use no `pad`** while
   `imbalance_up` / `imbalance_down` do (`lib/amt.ts:144–148`). Asymmetric on
   purpose?
7. **VIEW_H is a hard 660 px** with no responsive behaviour and the profile pans
   inside it. Does v3 keep the fixed viewport, or should the chart fill its
   `ChartFrame`?
8. **The forecast bins NQU at 1 point** (`BIN = 1`,
   `lib/tpo-forecast-compute.ts:21`, `122`) while the tab draws and scans NQU at
   5 (`Scanner.tsx:2932`). The nightly `tpo_profiles` recorder presumably uses
   the same `BIN`, so the k-NN is internally consistent — but the `predicted_va`
   / `predicted_poc` the card prints are then on a different bin grid from every
   other NQU number on the page. Intended, or should the route take `binSize`
   from the symbol?
9. **The NQ candle queries send no `interval` param** (`snapdb.ts:461–469`) while
   the ES pair always does. If `nq_candles` ever holds both 1m and 5m rows on the
   shared slotKey space, the NQU tab silently interleaves two aggregations — the
   exact failure `queryEsCandlesToday`'s comment says the `interval` filter
   exists to prevent. Does `nq_candles` hold 5m only?

---

**Part F row count: 201**
# Part G — IB Stats (`?tab=ibstats`)

**Scope.** The v2 Scanner tab `ibstats`, which is:

| Layer | File | Lines |
|---|---|---|
| Route | `components/pages/Scanner.tsx` → `{visibleTab === "ibstats" && <IbStatsTab />}` | 3096 |
| Tab definition | `components/scanner/scannerNav.ts` → `SCANNER_TABS[5]` | 62 |
| Tab body | `components/scanner/IbStatsTab.tsx` | 1863 |
| EOD scoreboard | `components/scanner/IbDailyResults.tsx` | 270 |
| Probability gauges | `components/insights/IbProbabilityEngine.tsx` | 253 |
| Backtest engine + types | `lib/ibStats.ts` | 508 |
| EOD grader (server-side) | `lib/ibDaily.ts` | 322 |
| Candle feed | `hooks/useEsCandles.ts` / `hooks/useNqCandles.ts` | 458 / 186 |
| Card surface | `components/shared/PageCard.tsx` → `Card` | 84–145 |
| Palette | `components/shared/homeTheme.ts` → `HOME_THEME`, `LIGHT_BLUE` | 3–18, 88 |

**Four files in the brief's source list are NOT imported by this tab and paint
nothing on it.** They are covered anyway, because the brief asked for them and
because "this is dead" is the single most useful row a parity doc can carry:

| File | Status on `?tab=ibstats` |
|---|---|
| `components/scanner/IbLevelCanvas.tsx` | **Imported by nothing in the repo.** Dead file. Also — despite the name — it contains no `<canvas>`; it is inline SVG. See section G-M. |
| `hooks/useIbDirection.ts` | Imported by nothing in the staged tree. Duplicates `LiveGauges`' `pHigh` path for a home-page gauge. See section G-N. |
| `components/scanner/scannerStyles.ts` | Not imported by `IbStatsTab`. The tab declares its own `th` / `td` / `note` / `statGrid`. `fmtB`, `fmtInt`, `fmtChg`, `zColor`, `seg`, `NEUTRAL` are unused here. |
| `components/shared/useTableSort.tsx` | Not imported. **No table on this tab is sortable** — see G-J1. |
| `components/shared/ThemedSelect.tsx` | Not imported. Every control on the tab is a plain `<button>`. |
| `hooks/useRefreshButton.ts` | Not imported. There is no refresh button anywhere on this tab. |

**Nothing on this tab writes to `localStorage`, the URL, or any persisted store.**
Symbol, window, and both disclosure toggles are component state and reset on
every remount. The tab is reachable by deep link (`/scanner?tab=ibstats`) but
its own state is not addressable.

**Total: 308 checklist rows.**

| Section | Covers | Rows | Ids |
|---|---|---|---|
| G-A | Mount, owner gate, dataset fetch | 14 | G1–G14 |
| G-B | Symbol / window control strip | 11 | G15–G25 |
| G-C | Shared style objects + format helpers | 18 | G26–G43 |
| G-D | `LiveToday` — data layer and the live memo | 33 | G44–G76 |
| G-E | Live Read card (gauge, matrix, active rule, verdict) | 40 | G77–G116 |
| G-F | IB Read card — 4 families + last-5 tape | 25 | G117–G141 |
| G-G | Probability Engine | 20 | G142–G161 |
| G-H | Owner historical stat cards (16 live + 2 dead) | 42 | G162–G203 |
| G-I | `buildRules` — the 15 live rules and their strings | 15 | G204–G218 |
| G-J | `IbDailyResults` — EOD scoreboard | 17 | G219–G235 |
| G-K | Bucket ladders, enumerated | 15 | G236–G250 |
| G-L | `lib/ibStats.ts` — every statistic | 28 | G251–G278 |
| G-M | `IbLevelCanvas` — full drawing spec (dead) | 26 | G279–G304 |
| G-N | `useIbDirection` (dead) | 4 | G305–G308 |

---

## Colour constants used by this part

`HT` = `HOME_THEME` from `components/shared/homeTheme.ts`. `LB` = `LIGHT_BLUE`
= `#7dd3fc` from the same file.

```
HT.bg          #05060A     HT.panel        #0D1119
HT.cyan        #219EBC     HT.purple       #126783
HT.orange      #FB8501     HT.green        #8ECAE6   ← a LIGHT BLUE, not a green
HT.red         #EF4444     HT.text         #FFFFFF
HT.border      rgba(255,255,255,0.10)
HT.panelBg     rgba(13,17,25,0.45)
HT.panelBgStrong rgba(13,17,25,0.72)
LIGHT_BLUE     #7dd3fc
```

`IbProbabilityEngine` declares its **own** positive/negative pair at the top of
the file, with a comment saying so out loud (`IbProbabilityEngine.tsx:37–39`):

```
POS = "#1FD98A"   // "real green"
NEG = "#FF3B3B"   // "true red (not pink)"
```

So the same screen paints "this rule was right" in `#8ECAE6` (a light blue) in
the IB Read card and "bullish edge" in `#1FD98A` (an actual green) in the
Probability Engine card directly below it, and "wrong" in `#EF4444` in one and
`#FF3B3B` in the other. This is em.md's two-reds case, doubled. Full table in
**### Colours used**.

---

# G-A — Mount, owner gate, dataset fetch

Source: `Scanner.tsx:3053–3101`, `scannerNav.ts:49–63`, `IbStatsTab.tsx:29–56,
1373–1440`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **G1** Tab pill — label | `scannerNav.ts:62` → `{ id:"ibstats", label:"IB Stats", short:"IB Stats", color: HOME_THEME.green, icon:"📐" }` | Long label `"IB Stats"`, short label `"IB Stats"` — identical, so the strip never abbreviates this one | Pill accent `HT.green` `#8ECAE6`; glyph `📐` | Pill always drawn |
| **G2** Tab cluster | `scannerNav.ts:105` → `SCANNER_GROUPS` `{ key:"structure", tabs:["tpo","ibstats"] }` | Second cluster, second pill (after TPO Structures) | none | n/a |
| **G3** Owner-only? | `scannerNav.ts:62` has **no** `ownerOnly` flag; `OWNER_ONLY_TABS` (`Scanner.tsx:3049`) therefore does not contain `"ibstats"` | The TAB is public. Only two blocks INSIDE it are owner-gated (G4) | none | A non-owner sees exactly three cards: Live Read, IB Read, Probability Engine |
| **G4** Owner check | `IbStatsTab.tsx:1374–1380` → `const { userId, isOwnerClaim } = useAuth(); const isOwner = isOwnerClaim \|\| (process.env.NEXT_PUBLIC_OWNER_USER_ID ? userId === process.env.NEXT_PUBLIC_OWNER_USER_ID : false)` | Boolean | Gates: the "Show historical stats" button (G-H1), the 16 stat cards, and `<IbDailyResults>` | While auth resolves, `isOwnerClaim` is false → the owner sees the public three-card view for a beat, then the button appears. **No `loaded` guard here** — unlike `Scanner.tsx`, which uses `useIsOwner().loaded` |
| **G5** Owner check — divergence | `IbStatsTab` reads `useAuth().userId`; `components/shared/useIsOwner.ts:29` reads `useAuth().user?.id` | Two different fields for the same test | — | If `AuthProvider` does not expose a top-level `userId`, this comparison is `undefined === "<id>"` → false, and the pre-claim fallback path silently never fires. Open question **Q1** |
| **G6** Deep link | `Scanner.tsx:3071–3074` → `readTabFromUrl()` in a mount effect | `?tab=ibstats` selects the tab after first paint | Runs once, deps `[]` | Without the param the page opens on `gexchangetop`; the ibstats tab renders nothing until selected |
| **G7** Sub-strip click | `Scanner.tsx:3081–3087` → `window.addEventListener(SCANNER_TAB_EVENT, …)` | Custom event carrying the tab id in `detail` | — | Query-string-only navigation does not remount, so this event is the only way the toolbar strip can switch tabs |
| **G8** URL not written back | — | Selecting ES/NQ or a window does **not** push a query param | — | The tab's own state is unshareable. Same defect as em.md A8 |
| **G9** Dataset path | `IbStatsTab.tsx:52` → `dsPath(sym,win)` = `win === 60 ? "/data/ib-${sym}.json" : "/data/orb${win}-${sym}.json"` | Eight possible static files: `/data/ib-ES.json`, `/data/ib-NQ.json`, `/data/orb30-ES.json`, `/data/orb30-NQ.json`, `/data/orb15-ES.json`, `/data/orb15-NQ.json`, `/data/orb5-ES.json`, `/data/orb5-NQ.json` | Plain `fetch(path)` — **GET, no query params, no headers, no `AbortController`, no poll interval, no revalidation** | Cached forever in component state under `key = "${sym}-${win}"`; a second visit to the same combo never refetches |
| **G10** Fetch effect | `IbStatsTab.tsx:1390–1402` | Deps `[sym, win, key, sets, errs]`; early-returns `if (sets[key] \|\| errs[key])` | Teardown flips a local `alive` flag; the request itself is not aborted | Including `sets`/`errs` in the dep array re-runs the effect after every successful load — harmless because of the early return, but it is a re-render-per-fetch pattern |
| **G11** Response shape | `lib/ibStats.ts:443–451` → `IbDataset` | `{ symbol: string; barMinutes: number; generated: string; sessions: number; from: string; to: string; days: SlimDay[] }`. ~300 KB per file, ~2,300 sessions | — | The `sessions` and `generated` fields are **read by nothing** — the tab uses `days.length` and the hardcoded `LAST_UPDATED` instead |
| **G12** Loading card | `IbStatsTab.tsx:1430` | `<Card title={`${winLabel(win)} Stats`}>` with body `Loading {sym} {winLabel(win)} dataset…` at 14px `HT.text` | none | e.g. `"Loading ES IB 60m dataset…"`. The symbol/window strip stays above it and remains clickable |
| **G13** Error card | `IbStatsTab.tsx:1429` | `<Card title={`${winLabel(win)} Stats — dataset not found`}>`, body 14px `HT.red` | Body is the thrown message, verbatim: `` `${sym} ${winLabel(win)}: ${r.status} — is public${path} in the repo? Export it from ib-backtest-esu6.html with the ${win}m window selected.` `` | e.g. `"ES ORB 5m: 404 — is public/data/orb5-ES.json in the repo? Export it from ib-backtest-esu6.html with the 5m window selected."` A network throw lands here as its raw `e.message` |
| **G14** `LAST_UPDATED` | `IbStatsTab.tsx:29` → `const LAST_UPDATED = "7/11/2026"` | Hand-typed string, US format, no zero padding | Rendered only in the G-H2 card subtitle | Cannot go stale-detect: nothing compares it to `ds.generated` |

---

# G-B — Symbol / window control strip

Source: `IbStatsTab.tsx:30–56, 1407–1427`. Rendered ABOVE the error/loading
card and above every content card, in all three states.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **G15** Strip container | `IbStatsTab.tsx:1415` | `display:flex; gap:10; marginBottom:12; flexWrap:wrap; alignItems:center` | none | Always rendered |
| **G16** `"ES"` button | `SYMBOLS[0]`, `IbStatsTab.tsx:30` | `btn(sym==="ES")` + `padding:"8px 22px"` (overrides the base 8px/18px) | See G18 | Default selected |
| **G17** `"NQ"` button | `SYMBOLS[1]` | Same metrics | See G18 | — |
| **G18** Button style `btn(on)` | `IbStatsTab.tsx:1407–1412` | `padding:"8px 18px"; borderRadius:8; fontSize:14; fontWeight:800; cursor:pointer; transition:"all 0.15s"` | ON → `border:1px solid HT.cyan`, `background:"rgba(33,158,188,0.15)"`. OFF → `border:1px solid rgba(255,255,255,0.15)`, `background:"transparent"`. **Text is `HT.text` white in both states** — the only difference is border + fill | n/a |
| **G19** Divider | `IbStatsTab.tsx:1419` | `width:1; height:26; background:"rgba(255,255,255,0.15)"; margin:"0 6px"` | none | Sits between the symbol pair and the window quartet |
| **G20** `"IB 60m"` button | `WINDOWS[0]` = `{min:60, label:"IB 60m", range:"09:30–10:30"}` | `btn(win===60)`, `title="09:30–10:30 ET"` | Same as G18 | **Default** (`useState<Win>(60)`) |
| **G21** `"ORB 30m"` button | `WINDOWS[1]` = `{min:30, label:"ORB 30m", range:"09:30–10:00"}` | `title="09:30–10:00 ET"` | Same | — |
| **G22** `"ORB 15m"` button | `WINDOWS[2]` = `{min:15, label:"ORB 15m", range:"09:30–09:45"}` | `title="09:30–09:45 ET"` | Same | Selecting this disables rules 7 and 12 (G-I) with a window-specific message |
| **G23** `"ORB 5m"` button | `WINDOWS[3]` = `{min:5, label:"ORB 5m", range:"09:30–09:35"}` | `title="09:30–09:35 ET"` | Same | Same rule-7/12 disablement |
| **G24** Range caption | `IbStatsTab.tsx:1425` → `` `${winRange(win)} ET` `` | 14px, `HT.text`, `opacity:0.7` | none | e.g. `"09:30–10:30 ET"`. Updates with the window; always present |
| **G25** Window arithmetic | `IbStatsTab.tsx:56` → `rangeEnd = (win) => 570 + win` | `REND` in minutes-of-day: 630 / 600 / 585 / 575 | Every downstream rule keys off `REND`, not off a literal 630 | The dashes in the range labels are EN DASHES `–` (U+2013), not hyphens |

---

# G-C — Shared style objects and format helpers

Source: `IbStatsTab.tsx:61–164`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **G26** `TITLE_COLORS` | `IbStatsTab.tsx:61–68` | `{cyan: HT.cyan #219EBC, green: HT.green #8ECAE6, orange: HT.orange #FB8501, red: HT.red #EF4444, purple: HT.purple #126783, blue: LIGHT_BLUE #7dd3fc}` | The comment at :58–60 says card titles are "the only non-white font on the page". That is false — `sectionRow`, family verdicts, rate cells, gauge labels and the engine are all coloured | Unknown key falls back to `HT.cyan` |
| **G27** Local `Card` | `IbStatsTab.tsx:76–94` | Wraps `<ThemeCard variant="budget">`. Header block: `marginBottom:16; display:flex; flexDirection:column; gap:3` | Title `fontSize:17; fontWeight:800; letterSpacing:"0.06em"; color:TITLE_COLORS[accent]`. Subtitle `fontSize:14; color:HT.text` | Header block omitted entirely when both `title` and `subtitle` are null |
| **G28** `variant="budget"` surface | `PageCard.tsx:118–129` → `classicCardAccentStyle` (`homeTheme.ts:186–189`) | `background: HT.panelBg rgba(13,17,25,0.45); backdropFilter:blur(16px); WebkitBackdropFilter:blur(16px); borderRadius:18; border:1px solid HT.border; boxShadow:"0 18px 40px rgba(0,0,0,0.22)"; padding:24` | `className="card-hover"` — the app-wide hover lift | The `accent` prop passed to `ThemeCard` is **ignored** by design (`PageCard.tsx:23–34`); the local `Card` re-implements colour on the title only |
| **G29** `f2` | `IbStatsTab.tsx:98` → `(n) => n == null \|\| !Number.isFinite(n) ? "—" : n.toFixed(2)` | 2 dp, no sign, no thousands separator | none | `"—"` (em dash) for null, undefined, `NaN`, `±Infinity` |
| **G30** `pct` | `IbStatsTab.tsx:99` → `(n,d) => d ? `${((100*n)/d).toFixed(1)}%` : "—"` | 1 dp + `%` | Guard is `d` truthy, so `d === 0` → `"—"`; a negative `d` would compute | `"—"` |
| **G31** `rateNum` | `IbStatsTab.tsx:100` → `(n,d) => d ? (100*n)/d : null` | Raw number, unrounded | Same `d`-truthy guard | `null` — every call site then renders `"—"` |
| **G32** `rateColor` | `IbStatsTab.tsx:102–106` | Returns a colour string | `p == null → HT.text #FFFFFF`; `p >= 60 → HT.green #8ECAE6`; `p <= 40 → HT.red #EF4444`; otherwise `HT.orange #FB8501`. Boundaries are `>=` and `<=`, so exactly 60 is green and exactly 40 is red; 40 < p < 60 is orange | n/a |
| **G33** `th` | `IbStatsTab.tsx:108–111` | `padding:"7px 10px"; textAlign:right; fontWeight:700; fontSize:14; letterSpacing:"0.03em"; color:HT.text; whiteSpace:nowrap` | none | n/a |
| **G34** `thL` | `:112` | `{...th, textAlign:"left"}` | Applied to column index 0 only | n/a |
| **G35** `td` | `:113–116` | `padding:"7px 10px"; textAlign:right; color:HT.text; fontSize:14; borderTop:"1px solid rgba(255,255,255,0.06)"; whiteSpace:nowrap` | The `borderTop` is the only row separator — there is no zebra striping and no `borderBottom`, so the last row has no bottom edge | n/a |
| **G36** `tdL` | `:117` | `{...td, textAlign:"left"}` | — | n/a |
| **G37** `tdDim` | `:118` | `{...td, fontSize:14}` — **identical to `td`**. The name says "dim"; the code changes nothing | Dead override. Used for the Detail column of every `Row` | n/a |
| **G38** `note` | `:119` | `marginTop:10; fontSize:14; fontStyle:italic; color:HT.text` | none | Rendered by `Tbl`'s `footNote` via `dangerouslySetInnerHTML` — footnote strings may contain `<b>` / `<i>` |
| **G39** `statGrid` | `:121–123` | `display:grid; gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))"; gap:12; marginBottom:14` | none | n/a |
| **G40** `Row` | `:125–138` | 5 `<td>`: label (`tdL`, `paddingLeft: indent ? 26 : 10`), `n`, `hits`, rate, detail (`tdDim`) | Rate cell: `color: rateColor(p)`, `fontWeight:800`, text `p == null ? "—" : `${p.toFixed(1)}%`` | `detail ?? ""` — an empty cell, not a dash |
| **G41** `Tbl` | `:140–150` | `<table style={{width:"100%", borderCollapse:"collapse"}}>`; head cells use `thL` for index 0 and `th` for the rest; `key={h}` — **duplicate header strings would collide** | `footNote` rendered through `dangerouslySetInnerHTML` in a `note`-styled div | `footNote` omitted → no div |
| **G42** `Stat` | `:152–160` | Tile: `background:"rgba(255,255,255,0.03)"; border:"1px solid rgba(255,255,255,0.08)"; borderRadius:12; padding:12`. `k` 14px `letterSpacing:"0.03em"`; `v` 20px/800 `marginTop:3`; `sub` 14px `marginTop:3` | All three lines are `HT.text` white | `sub` omitted → the line is not rendered |
| **G43** `sectionRow` | `:162–164` | `<tr><td colSpan={5}>` with `{...tdL, color:LIGHT_BLUE, fontWeight:800, fontSize:14, paddingTop:14}` | Always `LIGHT_BLUE` `#7dd3fc` | Used only inside card **B** (G-H12) |

---

# G-D — `LiveToday` — data layer and the live memo

Source: `IbStatsTab.tsx:166–444`. This component owns the socket subscription
and computes today's session from the live tape. It renders no chrome of its
own beyond the two early-return cards; on the happy path it returns the three
content cards (G-E, G-F, G-G) in a fragment.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **G44** ES socket | `IbStatsTab.tsx:202` → `useEsCandles(sym === "ES", 2)` | Args: `enabled = sym==="ES"`, `historyDays = 2`, `intervalMinutes` defaults to **5**, `withAverages` defaults to **true** | The hook subscribes to `/ws/gex` topics `["esCandles","es1mCandles"]` through `lib/gexSocket`, gated by `useWsLifecycle() && enabled`. Live frames are coalesced on a **250 ms trailing timer** (4 Hz publish ceiling) | Disabled instance stays fully idle — no SQLite read, no socket |
| **G45** NQ socket | `:203` → `useNqCandles(sym === "NQ", 2)` | Same two args; `useNqCandles` has **no** `intervalMinutes` / `withAverages` parameters (`useNqCandles.ts:65`) and owns its own raw `WebSocket` + reconnect timer rather than sharing `lib/gexSocket` | Topic `nqCandles`, plus the `nqCandles` field of the initial `snapshot` frame | Same idle behaviour |
| **G46** Both hooks always mounted | `:202–203` | Both are called on every render; only the matching one is enabled | Switching symbol flips both `enabled` flags — the new one connects, the old one tears down and sets `connected=false` | There is a gap where neither has bars; `live` goes null and G53 renders |
| **G47** `withAverages` waste | `useEsCandles.ts:413–424` | With `withAverages` defaulting true, the ES hook runs **two full `buildSlotAverages` passes** over `historical` on every republish | This tab reads only `candles[].timestamp/high/low/close/open/volume` — `avg5`/`avg14` are never read | Pure cost. v3 must pass `withAverages: false` |
| **G48** Prior-session source | `:207` → `const historical = sym === "ES" ? es.historical : nq.historical` | The DB-loaded array (2 days at `historyDays=2`) | Used only as the fallback for `pdh`/`pdl` when the live `candles` array has no prior-dated bars | Empty → `pdh`/`pdl` stay null → rule 11 goes not-in-play |
| **G49** `etMin(ts)` | `:174–181` | `Intl.DateTimeFormat("en-US", {timeZone:"America/New_York", hour:"2-digit", minute:"2-digit", hour12:false})` → `(h % 24) * 60 + m` | The `% 24` handles the `"24"` hour some ICU builds emit at midnight | Missing part → `0` |
| **G50** `etDate(ts)` | `:184–188` | `Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit"})` → `"YYYY-MM-DD"` | `en-CA` is chosen specifically because it formats ISO-like | — |
| **G51** RTH filter | `:221` → `.filter(b => b.min >= 570 && b.min <= 960)` | Keeps 09:30 through 16:00 inclusive | `<= 960` includes the 16:00 bar | Everything outside RTH is discarded before any computation |
| **G52** Session split | `:222–230` | Sorted by `(day, min)`; `today = all[last].day`; `bars = all.filter(b => b.day === today)`; `priorBars = all.filter(b => b.day < today)` | Grouping is by **true ET calendar date**, not by minute-of-day — the comment at :213–214 states this is to stop yesterday's RTH blending into today's IB | — |
| **G53** No-bars state | `:388–396` | `<Card title={`Today — ${sym}`} subtitle={connected ? "Waiting for today's bars…" : "Candle feed disconnected"}>` body: `"No RTH bars yet for the current session. This card fills in from 09:30 ET."` at 14px `HT.text` | Subtitle switches on `connected` only | This is the state outside market hours and on weekends. **The IB Read and Probability Engine cards do not render at all in this state** |
| **G54** Pre-range state | `:398–407` | `<Card title={`Today — ${sym} · ${dowName}`} subtitle={`Pre-range — ${WLBL} levels set at ${clock(REND)} ET`}>` with a `statGrid` of two tiles: `"Live price"` = `f2(live.price)`, `"Clock (ET)"` = `clock(live.nowMin)` | Triggered by `live.pending`, set at `:252` when `ibBars.length === 0` | e.g. `"Pre-range — IB 60m levels set at 10:30 ET"` |
| **G55** `dowName` | `:386` → `DOW_NAMES[new Date().getDay()]` | `["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]` | **Browser-local weekday, not ET.** Every other date computation on the tab is ET-anchored; this one is not | A user west of ET after 21:00 local sees the previous weekday, which silently changes the rule-`0c` day-of-week conditional |
| **G56** `ibh` / `ibl` / `width` / `mid` | `:254–257` | `ibh = max(ibBars.h)`, `ibl = min(ibBars.l)`, `width = ibh - ibl`, `mid = (ibh + ibl)/2` | `ibBars = bars.filter(b => b.min >= 570 && b.min < REND)` — **`< REND`, exclusive**, so the 10:30 bar itself is post-IB | No guard on `width <= 0`; a zero-width IB divides by zero at `:268` and `loc` becomes `0.5` via the ternary |
| **G57** `first` | `:261–266` | First index where `b.h === ibh` vs first index where `b.l === ibl`; `hiIdx < loIdx ? "H" : "L"` | **No tie-break.** A single bar that is both the IB high and the IB low resolves to `"L"`. `lib/ibStats.ts:133–134` has a third branch for this case (`ibBars[0].c >= ibBars[0].o ? "L" : "H"`) — the live path and the dataset therefore disagree on ties | — |
| **G58** `bias` | `:267` | `ibClose > mid ? "H" : ibClose < mid ? "L" : null` where `ibClose = ibBars[last].c` | Exactly on the midpoint → `null` → rule 1 and rule 2 both go not-in-play | `null` |
| **G59** `loc` / `closeZone` | `:268–269, 323` | `loc = width > 0 ? (ibClose - ibl)/width : 0.5`. Display string: `loc >= 0.75 → "top 25%"`, `loc <= 0.25 → "bottom 25%"`, else `"middle 50%"`. Machine key `zone`: `"top25"` / `"bot25"` / `"mid50"` | Boundaries `>=` and `<=` | Two parallel variables for the same fact — `closeZone` (prose) and `zone` (key) |
| **G60** Break detection | `:271–280` | `brokeH = post.some(b => b.c > ibh)`, `brokeL = post.some(b => b.c < ibl)`, `touchH = post.some(b => b.h > ibh)`, `touchL = post.some(b => b.l < ibl)`. `breakSide`/`breakMin` = the **first** post bar whose close is outside, high checked before low | A break is a bar CLOSE outside; a wick-only excursion is a touch, not a break. `post = bars.filter(b => b.min >= REND)` | `breakSide` null until a close prints outside |
| **G61** `status` string | `:286–292` | Ordered ladder: `!ibComplete → "IB still forming"`; `brokeH && brokeL → "BOTH sides broken — rotation"`; `brokeH → "Broken HIGH"`; `brokeL → "Broken LOW"`; `touchH \|\| touchL → "Wicked out, no close outside"`; else `"Inside IB"` | `ibComplete = nowMin >= REND` where `nowMin` is the last bar's ET minute | Only rendered by the dead `RuleBoard` (G-H0); the live cards do not show it |
| **G62** `bucket` string | `:294–299` | `hist.avgAtr && hist.avgIb ? (width < 0.5*avgAtr \|\| width < 0.75*avgIb ? "NARROW" : width > 1.5*avgAtr \|\| width > 1.25*avgIb ? "WIDE" : "NORMAL") : "—"` | **Uppercase** here; `bk = bucket.toLowerCase()` at `:688` is what matches `SlimDay.widthBucket`. When either average is 0 the string is `"—"`, and `"—".toLowerCase()` is `"—"`, which matches no bucket → rule 4 not-in-play | `"—"` |
| **G63** `hist` inputs | `:1558–1564` | `avgIb = avg(days.slice(-20).map(d => d.width)) ?? 0`; `avgAtr = avg(days.slice(-20).map(d => d.atr ?? d.dayRange)) ?? 0` | **The last 20 sessions of the STATIC EXPORT**, not the last 20 real sessions. With `LAST_UPDATED` at 7/11/2026 those averages are frozen at export time | If the dataset is empty both are 0 → bucket `"—"` |
| **G64** `hist` identity | `:1558` | The `hist` prop is a **fresh object literal on every render of `IbStatsTab`** | `live` is `useMemo(..., [candles, historical, hist, sym, win, REND])` — so `hist` changing identity re-runs the whole live memo every render | Perf defect. v3 must memoise it |
| **G65** `targets` | `:302–308` | For `t` in `[0.5, 1, 1.5, 2]`: `px = breakSide==="H" ? lvl + t*width : lvl - t*width`; `hit = breakSide==="H" ? dayHigh >= lvl + t*width : dayLow <= lvl - t*width` | `lvl` = `ibh` on a high break, `ibl` on a low break. Measured against the **whole day's** high/low, including pre-break bars | `[]` when `breakSide` is null |
| **G66** `orbDir` (live) | `:312–321` | Only computed when `win > 15`. `orb = ibBars.filter(b => b.min < 585)`; then the first bar with `min >= 585` whose close is outside `[orbL, orbH]` sets the direction | So on the 15m and 5m windows `orbDir` is always null and rule 12 shows the "no inner ORB" message | `null` |
| **G67** `openType` (live) | `:327–332` | `pdh == null \|\| pdl == null ? null : dayOpen > pdh ? "OAR-H" : dayOpen < pdl ? "OAR-L" : dayOpen > (pdh+pdl)/2 ? "HIR" : "LIR"` where `dayOpen = bars[0].o` | `lib/ibDaily.ts:182–187` adds a `!(dayOpen > 0)` guard the live path lacks | `null` → rule 11 not-in-play |
| **G68** `fvg` (live) | `:335–344` | 15m candles rebuilt by minute window: `for (s = 570; s < REND; s += 15)` grouping `ibBars` with `min >= s && min < s+15`. Then `for (i = 2; i < b15.length; i++)`: `b15[i].l > b15[i-2].h → "bull"`; `b15[i].h < b15[i-2].l → "bear"` | **No `break`** — the LAST qualifying gap in the window wins, not the first | `null` when fewer than 3 fifteen-minute candles exist (i.e. `win < 45`) |
| **G69** `volSurge` (live) | `:350–351` | `ibVol = avg(ibBars.map(b => b.v)) ?? 0`; `volSurge = brk && ibVol > 0 ? brk.v > ibVol : null` | Break-bar volume strictly greater than the mean IB bar volume | `null` when there is no break bar or the IB volume is 0 — feeds the `"vol n/a"` branch of rule 5 |
| **G70** `failed` (live) | `:354–357` | `after.filter(b => b.min <= brk.min + 30).some(b => breakSide==="H" ? b.c < ibh : b.c > ibl)` | 30 **minutes** by clock, not 6 bars. `lib/ibStats.ts:282` uses `j < 6` bars — equivalent only at 5m bars | `null` when no break |
| **G71** `retest` / `retestCont` (live) | `:360–368` | `tick = 0.25` for both ES and NQ (`sym === "ES" ? 0.25 : 0.25` — a no-op ternary). `rtIdx = after.findIndex(b => breakSide==="H" ? b.l <= lvlPx + 2*tick : b.h >= lvlPx - 2*tick)`; `retestCont = after.slice(rtIdx+1).some(b => breakSide==="H" ? b.c > lvlPx : b.c < lvlPx)` | **The live retest does not require the close to hold outside**; `lib/ibStats.ts:288–290` additionally requires `b.c > lvl`. Live and historical disagree on the definition | `retest=false`, `retestCont=null` |
| **G72** `containedAt2` (live) | `:371–374` | `at2 = bars.filter(b => b.min <= 840)`; `nowMin >= 840 ? !at2.some(b => b.min >= REND && (b.c > ibh \|\| b.c < ibl)) : null` | **Close-based.** `lib/ibDaily.ts:202` is also close-based; `lib/ibStats.ts:234–237` is **wick-based** (`max(h) <= ibh && min(l) >= ibl`). Three definitions, two of them agreeing | `null` before 14:00 → rule 14 renders its PENDING branch |
| **G73** Engine snapshot ref | `:210, 420–424` | `engineSnapRef = useRef<Record<string, {rules, env}>>({})`; key `` `${sym}-${live.today}` ``; written when `live.ibComplete && !engineSnapRef.current[snapKey]` | **This is a mutation during the render phase**, not in an effect. It survives re-renders but not a remount — switching tabs and back loses the 10:30 freeze and re-captures at whatever the state is then | Before 10:30 `closeSnap` is undefined → the Probability Engine renders its live gauges instead (G-G) |
| **G74** `engineEnv` | `:412–416` | `{ ibWidth: live.bucket==="WIDE" ? "wide" : live.bucket==="NARROW" ? "narrow" : "normal", volume: live.volSurge === true ? "active" : "normal", time: live.nowMin >= 840 ? "late" : "regular" }` | `"—"` bucket falls through to `"normal"`. `volSurge === null` falls through to `"normal"`. `time` flips at 14:00 ET | n/a |
| **G75** `engineRules` | `:410–411` | `scoreWithHistory(buildRules(live, dowName, win), days).map(r => ({id, name, state, side, read, p}))` | Drops `n`, `last5`, `question`, `cond`, `outcome` before handing to the engine — the engine never sees sample size, so **a 100% rate on 3 days moves its gauges exactly as hard as a 100% rate on 900** | n/a |
| **G76** Render order | `:426–443` | `<LiveGauges/>` → `<RuleClusterBoard/>` → `<IbProbabilityEngine showLive={false} showStages={false}/>` | The comment at `:428` says "Only three cards" | Both `RuleBoard` and `PlaybookLegacy` exist in the file and are rendered by nothing |

---

# G-E — Card 1: "Live Read" (`LiveGauges`)

Source: `IbStatsTab.tsx:446–643`. `<Card accent="cyan">`, so the title paints
`HT.cyan` `#219EBC`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **G77** Card title | `:579` → `` `Live Read — direction, expansion, active rule · ${L}` `` | 17px/800, `letterSpacing:"0.06em"`, `HT.cyan`. `L = winLabel(win)` | e.g. `"Live Read — direction, expansion, active rule · IB 60m"` | Always present once `live` exists |
| **G78** Card subtitle | `:580` → `` `${g.label}${live.ibComplete ? "" : ` · ${L} STILL FORMING`}` `` | 14px `HT.text` | `g.label` is the condition stack that survived the sample test — e.g. `"close > mid + LOW first + NORMAL IB 60m"` or the fallback `"all sessions"` | Suffix `" · IB 60m STILL FORMING"` before 10:30 |
| **G79** `MIN_N` | `:452` → `const MIN_N = 40` | The one sample-size constant the live cards use | Any conditional group with fewer than 40 matching sessions is rejected | — |
| **G80** `bestSample` | `:455–461` | Walks `i` from `conds.length` down to 1; the first `days.filter(all of conds[0..i))` with `length >= 40` wins, label = `labels.slice(0,i).join(" + ")` | Ordered condition stack (`:513–519`): **1.** `bias` (label `"close > mid"` / `"close < mid"`, omitted when bias is null) · **2.** `first` (label `"HIGH first"` / `"LOW first"`, **always present**) · **3.** `widthBucket` (label `` `${live.bucket} ${L}` `` e.g. `"NARROW IB 60m"`, omitted when bucket is null) · **4.** `orbDir` (label `"inner ORB up"` / `"inner ORB down"`, omitted when null) | Nothing reaches 40 → `{ g: days, label: "all sessions" }` — the whole dataset, unconditioned |
| **G81** `pHigh` | `:522–523` | `withTouch = g.g.filter(d => d.firstTouchSide)`; `pHigh = 100 * count(firstTouchSide === "H") / withTouch.length` | `withTouch.length === 0` → **`pHigh = 50`**, i.e. a hard-coded coin flip that is visually indistinguishable from a real 50% | Renders as a centred needle and the `"NO DIRECTIONAL EDGE"` label |
| **G82** Overall verdict plate | `:583–597` | `display:flex; alignItems:center; justifyContent:space-between; gap:16; flexWrap:wrap; background:"rgba(255,255,255,0.03)"; border:1px solid {sColor}; borderRadius:12; padding:"14px 18px"; marginBottom:14` | The plate's border takes the verdict colour | Always rendered |
| **G83** `"Overall break bias"` | `:588` | Static label, 14px `HT.text` | none | — |
| **G84** Verdict headline | `:589–591` | 26px/800, colour `sColor`. Text: `strength === "NEUTRAL" ? "NEUTRAL — no edge" : `${strength} ${bull ? "BULLISH" : "BEARISH"} BREAK`` | Five possible strings: `"NEUTRAL — no edge"`, `"LEAN BULLISH BREAK"`, `"LEAN BEARISH BREAK"`, `"STRONG BULLISH BREAK"`, `"STRONG BEARISH BREAK"` | — |
| **G85** `score` formula | `:563–572` | Applied strictly in this order: `s = (pHigh - 50) * 1.6`; `if (brokeH && !brokeL) s += 22`; `if (brokeL && !brokeH) s -= 22`; `if (brokeH && brokeL) s *= 0.4`; `if (price > mid) s += 6 else if (price < mid) s -= 6`; `if (bias === "H") s += 4 else if (bias === "L") s -= 4`; `if (!ibComplete) s *= 0.5`; `clamp(-100, 100)` | The ±6 and ±4 terms are added **after** the rotation ×0.4, so they are not damped by it; the ×0.5 for an incomplete IB damps everything | Deterministic; no null path |
| **G86** `strength` | `:574` | `Math.abs(score) >= 45 → "STRONG"`; `>= 20 → "LEAN"`; else `"NEUTRAL"` | Boundaries are `>=` | — |
| **G87** `sColor` | `:575` | `strength === "NEUTRAL" ? HT.orange : bull ? HT.green : HT.red` where `bull = score >= 0` | A score of exactly 0 is `bull` but also `NEUTRAL`, so it paints orange | — |
| **G88** Score number | `:594` | `{score >= 0 ? "+" : ""}{score.toFixed(0)}` — 34px/800, `sColor`, right-aligned | Signed integer, e.g. `"+37"`, `"-8"` (the minus is the JS `toFixed` hyphen-minus, **not** the U+2212 used in the caption below it) | — |
| **G89** Score caption | `:595` | `"−100 bear … +100 bull"` — 14px `HT.text`. The minus here IS U+2212 and the ellipsis is a single `…` glyph | none | — |
| **G90** Three-column grid | `:599` | `display:grid; gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))"; gap:12` | none | Collapses to one column under ~500px |
| **G91** Gauge panel plate | `:601` | `background:"rgba(255,255,255,0.03)"; border:"1px solid rgba(255,255,255,0.08)"; borderRadius:12; padding:14` | none | — |
| **G92** `"Breakout target bias"` | `:602` | Static, 14px/800 `HT.text`, `marginBottom:6` | none | — |
| **G93** `Gauge` geometry | `:463–488` | Wrapper `position:relative; width:190; height:108; margin:"0 auto"`. `<svg viewBox="0 0 100 50" style={{width:"100%",height:"100%"}}>` | Track path `M 10 50 A 40 40 0 0 1 90 50`, `stroke:"rgba(255,255,255,0.10)"`, `strokeWidth:10`, `strokeLinecap:"round"` | Always drawn |
| **G94** `Gauge` — green arc | `:471–472` | Path `M 10 50 A 40 40 0 0 1 50 10`, `stroke: HT.green`, `strokeWidth:10`, `strokeDasharray:125`, `strokeDashoffset: 125 - 125*(pHigh/100)`, `transition:"stroke-dashoffset .6s"` | **`arc = 125` is the length of the FULL semicircle (π·40 ≈ 125.66), applied to a QUARTER path whose real length is ≈ 62.8.** So the visible length saturates at `pHigh = 50` and the green arc is fully drawn for every `pHigh ≥ 50` | Rendering defect — only the losing side's arc actually varies |
| **G95** `Gauge` — red arc | `:473–474` | Path `M 50 10 A 40 40 0 0 1 90 50`, `stroke: HT.red`, same dasharray, `strokeDashoffset: 125 - 125*((100-pHigh)/100)` | Same saturation defect, mirrored | — |
| **G96** `Gauge` — needle | `:475–476` | `<line x1="50" y1="50" x2="50" y2="15" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">` with `transformOrigin:"50px 50px"; transform: rotate(${ang}deg); transition:"transform .6s"` where `ang = -90 + (pHigh/100)*180` | `#fff` is a **raw literal**, not `HT.text` | `pHigh=0` → −90°, `pHigh=50` → 0°, `pHigh=100` → +90° |
| **G97** `Gauge` — hub | `:477` | `<circle cx="50" cy="50" r="4.5" fill="#fff"/>` | Second raw `#fff` literal | — |
| **G98** `Gauge` — readout | `:479–486` | `position:absolute; bottom:0; width:100%; textAlign:center`. Value 24px/800 `HT.text`: `(hiSide ? pHigh : 100 - pHigh).toFixed(1)` + `"%"` where `hiSide = pHigh >= 50` | **The number shown is always the WINNING side's probability**, so it can never read below 50.0% | 1 dp |
| **G99** `Gauge` — verdict label | `:483–485` | 14px/800, `letterSpacing:"0.04em"`, colour `hiSide ? HT.green : HT.red` | `Math.abs(pHigh - 50) < 2 → "NO DIRECTIONAL EDGE"`; else `hiSide ? "HIGH BREAK BIAS" : "LOW BREAK BIAS"`. The dead-band is strictly `< 2`, i.e. 48.0 < pHigh < 52.0 | Note the colour is NOT neutralised inside the dead band — a 49.5% reading still paints the label red |
| **G100** Gauge split line | `:604–607` | `display:flex; justifyContent:space-between; marginTop:10; fontSize:14; HT.text`. Left `"High first "` + `<b style={{color: HT.green}}>{pHigh.toFixed(1)}%</b>`; right `"Low first "` + `<b style={{color: HT.red}}>{(100-pHigh).toFixed(1)}%</b>` | Fixed colours, not conditional | 1 dp each; they always sum to 100.0 |
| **G101** `"Expansion matrix"` | `:612` | Static, 14px/800 `HT.text`, `marginBottom:10` | none | — |
| **G102** Expansion population | `:525–531` | `dowDays = (dowIdx >= 1 && dowIdx <= 5) ? g.g.filter(d => new Date(`${d.date}T12:00:00Z`).getUTCDay() === dowIdx) : []`; `mx = dowDays.length >= MIN_N ? dowDays : g.g` | Dates are parsed at **noon UTC** so no timezone can shift the weekday. Weekend → `dowDays` empty → falls back to `g.g` | `mx.length === 0` → all three bars are `0/1 = 0%` |
| **G103** `"Single-side trend"` bar | `:613` | `pSingle = 100 * count(d.singleBreak) / (mx.length \|\| 1)` | Colour `HT.cyan` `#219EBC` | — |
| **G104** `"Rotational chop (both)"` bar | `:614` | `pBoth = 100 * count(d.bothBroke) / (mx.length \|\| 1)` | Colour `HT.purple` `#126783` | — |
| **G105** `"Contained range (none)"` bar | `:615` | `pNone = 100 * count(d.neitherBroke) / (mx.length \|\| 1)` | Colour `HT.orange` `#FB8501` | The three are mutually exclusive by construction and sum to 100 |
| **G106** `Bar` component | `:491–502` | Label row `display:flex; justifyContent:space-between; fontSize:14; HT.text; marginBottom:4`; value `fontWeight:800` in the bar's colour, `p.toFixed(1)` + `"%"`. Track `height:8; borderRadius:6; background:"rgba(255,255,255,0.07)"; overflow:hidden`. Fill `width:${p}%; height:100%; background:{color}; transition:"width .6s"` | `marginBottom:10` per bar | No null path — `p` is always a number here |
| **G107** Matrix caption | `:616–618` | 14px `HT.text`, `marginTop:4`. `pBoth > 32 ? "Rotational risk HIGH — expect a two-sided day" : "One-sided break expected — opposite extreme protected"` | Boundary is strict `>` at **32** — the only place this number appears | Two strings, no third state |
| **G108** Active-rule plate | `:622` | `background:"rgba(255,255,255,0.03)"; border:1px solid {vColor}; borderRadius:12; padding:14` | `vColor = rule?.verdict === "tradeable" ? HT.green : rule?.verdict === "fade" ? HT.red : HT.orange` — a null `rule` paints orange | — |
| **G109** `"Active tactical rule"` | `:623` | Static, 14px/800 `HT.text`, `marginBottom:10` | none | — |
| **G110** Active rule — selection ladder | `:536–560` | Evaluated in order: **(a)** `live.breakSide && !live.ibComplete` → `null`; **(b)** `brokeH && brokeL` → `{name:"BOTH SIDES BROKEN — rotation day", n:mx.length, p:pBoth, verdict:"fade", note:"Rotation day — fade the extremes, don't chase"}`; **(c)** `breakSide` → see G111; **(d)** `bias` → `{name:`Midpoint bias → ${HIGH\|LOW} breaks first`, n:withTouch.length, p: bias==="H" ? pHigh : 100-pHigh, verdict: p>=60 ? "tradeable" : p<=45 ? "fade" : "noise", note: g.label}`; **(e)** fallback → `{name:`No bias — ${L} closed on the midpoint`, n:g.g.length, p:50, verdict:"noise", note:"wait for a break"}` | Branch (a) fires only when a break printed BEFORE the range closed — impossible under the definitions, since `post` starts at `REND`; it is effectively dead | `null` → the plate body renders `"Waiting on the 10:30 ET close."` at 14px `HT.text`. **That string is hardcoded to 10:30 and does not follow the window selector** |
| **G111** Active rule — break branch | `:543–551` | `grp = fcb.filter(d => d.fcb.side === side && d.widthBucket === bucketKey)`; `use = grp.length >= 40 ? grp : fcb.filter(d => d.fcb.side === side)`; `failP = 100 * count(d.fcb.failed) / (use.length \|\| 1)`; `p = 100 * count(d.fcb.hit["1"]) / (use.length \|\| 1)` | `failP > 50` → `{name:`${HIGH\|LOW} break — fails more often than it runs`, p: 100 - failP, verdict:"fade", note:`${failP.toFixed(1)}% of these breaks close back inside within 30m`}`. Otherwise `{name:`${HIGH\|LOW} break confirmed → ≥1× ext`, p, verdict: p >= 55 ? "tradeable" : "noise", note:`fail rate ${failP.toFixed(1)}%`}` — note there is **no "fade" outcome on this second path**, however low `p` is | — |
| **G112** Verdict headline | `:626–628` | 17px/800 in `vColor`. `rule.verdict === "tradeable" ? "TRADEABLE EDGE" : rule.verdict === "fade" ? "FADE SETUP" : "NO EDGE"` | Exactly three strings | — |
| **G113** Rule name line | `:629` | `{rule.name}` — 14px `HT.text`, `marginTop:6` | none | — |
| **G114** `"Edge rate"` + value | `:630–633` | `display:flex; justifyContent:space-between; alignItems:baseline; marginTop:10`. Label `"Edge rate"` 14px `HT.text`; value `{rule.p.toFixed(1)}%` at 24px/800 in `vColor` | The value is the branch's `p`, which on the `failP > 50` path is `100 - failP` — i.e. the SUCCESS rate of the fade, not the failure rate quoted in the note beneath it | — |
| **G115** Rule note line | `:634` | `{rule.note}` — 14px `HT.text`, `marginTop:4` | none | — |
| **G116** `rule.n` is computed but never rendered | `:539, 546, 550, 551, 556, 559` | Every branch sets `n`, and no JSX reads it | The sample size behind the headline percentage is **invisible to the user on this card** — deliberate per `RuleBoard`'s comment at `:1125` ("sample counts are owner-only") | — |

---

# G-F — Card 2: "IB Read — 4 families, one glance" (`RuleClusterBoard`)

Source: `IbStatsTab.tsx:944–1095`. `<Card accent="cyan">`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **G117** Card title | `:1029` → `` `IB Read — 4 families, one glance` `` | Template literal with no interpolation — the string is constant and does **not** follow the window selector, so it still says "IB" on the ORB 5m tab | `HT.cyan`, 17px/800 | Always |
| **G118** Card subtitle — forming | `:1031` | `` `${L} STILL FORMING — conditional. Correlated rules grouped so one bias can't read as four votes; each pill shows its hit rate + last-5 outcomes.` `` | Fires when `!live.ibComplete` | 14px `HT.text` |
| **G119** Card subtitle — formed | `:1032` | `"The 14 rules grouped so correlated priors stop overcounting. Each pill shows its hit rate and last-5 outcomes; the strip up top is the recent tape."` | — | The board actually carries **15** rules when `0c` is in play (Mon–Fri); the subtitle says 14 |
| **G120** `scoreWithHistory` | `:947–955` | Per rule: `g = days.filter(r.cond).sort(by date asc)`; `hits = g.filter(r.outcome).length`; `n = g.length`; `p = g.length ? (100*hits)/g.length : null`; `last5 = g.slice(-5).map(r.outcome)` (oldest → newest) | **No minimum-sample guard anywhere in this function.** A rule matching 2 sessions reports its rate with the same weight and the same colour as one matching 900 | `cond`/`outcome` absent (every `not-in-play` rule) → `{n:0, p:null, last5:[]}` |
| **G121** `"LAST 5 SESSIONS"` label | `:1036` | 14px, `LIGHT_BLUE`, `fontWeight:800`, `letterSpacing:"0.04em"`. Strip container `display:flex; flexWrap:wrap; gap:8; marginBottom:18; alignItems:center` | none | Always drawn, even with zero chips |
| **G122** Tape fetch | `:1002–1021` | `fetch(`/api/ib-results?symbol=${sym}&limit=5`)` → `j.rows.slice().reverse()` (API is newest-first; the tape reads oldest → newest) mapped to `{date, firstTouchSide: r.first_touch_side ?? null, neitherBroke: !!r.neither_broke, bothBroke: !!r.both_broke, singleBreak: !!r.single_break}` | **GET, deps `[sym]`, no poll, no abort (only an `alive` flag), `.catch(() => {})` swallows every error silently** | On failure or empty `rows`, `apiRecent` stays null |
| **G123** Tape fallback | `:1023–1024` | `fallbackRecent = days.sort(by date asc).slice(-5)`; `recent = apiRecent && apiRecent.length ? apiRecent : fallbackRecent` | Falls back to the **static export**, whose newest session is `LAST_UPDATED` — so a failed API call shows a months-old "LAST 5 SESSIONS" with no visual difference from live data | Both empty → the label renders alone with no chips |
| **G124** Tape chip | `:1042–1046` | `display:inline-flex; flexDirection:column; alignItems:center; gap:2; border:1px solid {col}; borderRadius:8; padding:"5px 9px"; minWidth:74` | `col` = `firstTouchSide == null ? HT.orange : firstTouchSide === "H" ? HT.green : HT.red` | — |
| **G125** Tape chip — date | `:1043` | `{d.date.slice(5)}` → `"MM-DD"`, 12px `HT.text`, `opacity:0.7` | none | Assumes an ISO `YYYY-MM-DD`; anything shorter silently truncates |
| **G126** Tape chip — direction | `:1044` | 14px/800 in `col`. `firstTouchSide == null ? "—" : up ? "HIGH ↑" : "LOW ↓"` — the arrows are U+2191 / U+2193 | Three strings | `"—"` in orange |
| **G127** Tape chip — day type | `:1040, 1045` | 10px `HT.text`, `opacity:0.6`. `d.neitherBroke ? "contained" : d.bothBroke ? "both broke" : d.singleBreak ? "single break" : "—"` | Checked in that order | `"—"` when all three flags are false |
| **G128** Family grid | `:1052` | `display:grid; gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))"; gap:12` | none | Four cards, always |
| **G129** Family 1 | `:979` | `{key:"struct", title:"Morning Structure Bias", sub:"close vs mid · formation order · FVG · close location", ids:["1","2","7","10"], correlated:true}` | Badge `"correlated · 1 idea"` | Members that resolve to nothing are dropped silently |
| **G130** Family 2 | `:980` | `{key:"confirm", title:"Break Confirmation", sub:"what price actually did after the break", ids:["3","5","6","8","9"]}` | No badge | — |
| **G131** Family 3 | `:981` | `{key:"timing", title:"Timing, Width & Day Type", sub:"whether one side runs, and how far", ids:["4","11","13","14","0c"]}` | No badge. Rules 4, 11, 14 and 0c all carry `side: null`, so only rule 13 can ever give this family a direction | On a weekend `0c` is absent → 4 members |
| **G132** Family 4 | `:982` | `{key:"conflict", title:"Conflict Watch", sub:"faster structure vs the morning lean", ids:["12"], hero:true}` | Badge `"early tell"`; plate `border:1px solid HT.orange` and `background:"rgba(251,133,1,0.08)"` (= `HT.orange` at 8%, written as a literal) | On the 15m/5m windows rule 12 is always not-in-play → this card always reads `CONTEXT` |
| **G133** Family plate | `:1058–1062` | `border:1px solid ${fam.hero ? HT.orange : HT.border}; background: ${fam.hero ? "rgba(251,133,1,0.08)" : HT.panelBg}; borderRadius:14; padding:15; position:relative` | Non-hero plates use `HT.panelBg` — a card-coloured plate on a card, so the family boxes are near-invisible against the parent surface | — |
| **G134** Family badge | `:1063–1067` | `position:absolute; top:12; right:12; fontSize:10; letterSpacing:"0.5px"; textTransform:"uppercase"; color:HT.orange; border:1px solid HT.orange; borderRadius:5; padding:"2px 6px"` | Text `fam.hero ? "early tell" : "correlated · 1 idea"`; rendered when `fam.correlated \|\| fam.hero` | Families 2 and 3 have no badge |
| **G135** Family title / sub | `:1068–1069` | Title 14px/800 `HT.text`; sub 12px `HT.text` `opacity:0.6` `marginBottom:10` | none | — |
| **G136** Family verdict | `:1071` | 22px/800 in `verdCol`. `netSide == null ? "CONTEXT" : netSide === "H" ? "HIGH ↑" : "LOW ↓"` | `verdCol = netSide == null ? HT.orange : netSide === "H" ? HT.green : HT.red` | `"CONTEXT"` orange when no member carries both a side and a rate |
| **G137** `familyStat` | `:985–994` | `members = ids.map(byId).filter(Boolean)`; `dir = members.filter(r => r.side && r.p != null)`; `sumH = Σ p over dir where side==="H"`; `sumL = Σ p over dir where side==="L"`; `netSide = dir.length ? (sumH >= sumL ? "H" : "L") : null`; `avg = mean of p over dir where side === netSide` | **Sums of percentages, not weighted by sample size.** Ties (`sumH === sumL`, including 0 === 0 when `dir` is non-empty but every `p` is 0) resolve to `"H"` | `dir` empty → `netSide` null, `avg` null |
| **G138** `"avg conviction"` | `:1072` | 12px `HT.text` `opacity:0.7`, literal text `"avg conviction "` then `<b style={{color: verdCol}}>{avg.toFixed(1)}%</b>` | Rendered only when `avg != null` | Omitted entirely when null |
| **G139** Member pill | `:1076–1082` | `display:flex; alignItems:center; justifyContent:space-between; gap:10; border:1px solid HT.border; borderRadius:9; padding:"6px 9px"; background:HT.panelBg`. Left: `{r.id} · {r.name}` at 12px `HT.text`, `whiteSpace:nowrap; overflow:hidden; textOverflow:ellipsis`, then `<Last5Dots>` at `marginTop:4`. Right: `{r.p == null ? "—" : `${r.p.toFixed(1)}%`}` at 14px/800, `color: rateColor(r.p)`, `fontVariantNumeric:"tabular-nums"`, `flex:"none"` | Rate colour ladder per G32 | `p == null` → `"—"` in `HT.text` white |
| **G140** `Last5Dots` | `:958–970` | Each dot `width:9; height:9; borderRadius:"50%"`, container `display:inline-flex; gap:3; alignItems:center` | Hit → `background: HT.green`, `opacity:1`, `title="hit"`. Miss → `background: HT.red`, `opacity:0.55`, `title="miss"` | Empty array → `<span style={{fontSize:12, color:HT.text, opacity:0.4}}>no history</span>` |
| **G141** Card footnote | `:1090–1092` | `note` style (14px italic `HT.text`, `marginTop:10`). Full text: *"Families collapse correlated rules so one bullish idea (close above mid · low-first · bullish structure) can’t read as four separate votes. **Green dots = the rule was right on that past session, red = wrong** (oldest → newest, its last 5 in-play sessions). The **Conflict Watch** card is the early tell: when the faster ORB structure disagrees with the morning lean, the lean is the stale one."* — `<b>` on the two marked spans, `&rsquo;` for the apostrophe, `→` U+2192 | Rendered as JSX, not `dangerouslySetInnerHTML` | Always |

---

# G-G — Card 3: Probability Engine (`IbProbabilityEngine`)

Source: `components/insights/IbProbabilityEngine.tsx:1–253`, mounted at
`IbStatsTab.tsx:433–441` with `showLive={false}` and `showStages={false}`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **G142** Mount props | `IbStatsTab.tsx:433–441` | `rules={engineRules} env={engineEnv} sym={sym} closeRules={closeSnap?.rules} closeEnv={closeSnap?.env} showLive={false} showStages={false}` | — | — |
| **G143** `showStages={false}` | `:234` → `{showStages && STAGE_DEFS.map(...)}` | **The four stage sections never render on this tab.** `STAGE_DEFS`' titles, icons, and every `RuleRow` (`:135–164`) are unreachable here | The rule-by-rule board with `Hist. Edge` bars exists in the file and is dead in this context | — |
| **G144** `showLive={false}` — the "Live" chip | `:217` → `{(showLive \|\| !pClose) && pClose && …}` | With `showLive` false this is `!pClose && pClose` — **always false**. The orange/green `"Live"` + `"updating now"` chip pair can never render on this tab | Dead branch | — |
| **G145** `showLive={false}` — the live gauges | `:224` → `{(showLive \|\| !pClose) && …}` | Reduces to `!pClose`. **Before 10:30 the live gauges DO render** (no snapshot yet), with `marginTop:22`; **from 10:30 onward they disappear** and only the frozen 10:30 row remains | So the card silently swaps which trio of gauges it is showing at the IB close, with no label change before the swap | — |
| **G146** Card surface | `:178–185` | `background: HT.panelBg; border:1px solid HT.border; borderRadius:16; padding:"20px 20px 22px"; backdropFilter:"blur(16px)"; WebkitBackdropFilter:"blur(16px)"` | This is a hand-rolled `<section>`, **not** `PageCard`'s `Card` — so radius 16 vs 18, padding 20/22 vs 24, and no `card-hover` class. It does not match the two cards above it | — |
| **G147** Header | `:191–198` | `📊` at 16px; `"Probability Engine"` at 13px/800, `letterSpacing:".16em"`, uppercase, `C.cyan` = `HT.cyan` | Symbol chip: `{sym}` at 10px/800, `letterSpacing:".08em"`, uppercase, `color:C.cyan`, `border:1px solid ${C.cyan}66`, `background:${C.cyan}14`, `borderRadius:5`, `padding:"2px 8px"` | Chip omitted when `sym` is falsy — never here |
| **G148** Strapline | `:199` | `` `Live mathematical projection of final intraday session behavior based on active indicators${sym ? ` — ${sym} futures` : ""}.` `` — 12.5px `C.muted` `rgba(255,255,255,0.55)`, `margin:"4px 0 0"` | e.g. `"…active indicators — ES futures."` | — |
| **G149** `"10:30 Close"` chip | `:202–206` | 10px/800, `letterSpacing:".12em"`, uppercase, `color:HT.orange`, `border:1px solid ${HT.orange}66`, `background:${HT.orange}14`, `borderRadius:5`, `padding:"2px 8px"`. Beside it: `"frozen at the IB close"` at 11px `C.muted`. Container `margin:"20px 0 8px"` | Rendered only when `pClose` exists | **Hardcoded "10:30"** — does not follow the window selector, so on ORB 15m it labels a 09:45 freeze as 10:30 |
| **G150** Gauge trio layout | `:209, 225` | `display:grid; gridTemplateColumns:"repeat(3,1fr)"; gap:14` | Three gauges in fixed order: Bullish, Bearish, Rotation | — |
| **G151** Gauge labels | `:210–212, 226–228` | `"Bullish<br/>Edge"`, `"Bearish<br/>Edge"`, `"Rotation<br/>Risk"` — injected via `dangerouslySetInnerHTML` purely to get the line break | 11px/800, `letterSpacing:".12em"`, uppercase, `C.muted`, `textAlign:center`, `lineHeight:1.5` | — |
| **G152** Gauge geometry | `:106–123` | Wrapper `position:relative; width:118; height:118`. `<svg width="118" height="118" viewBox="0 0 118 118" style={{transform:"rotate(-90deg)"}}>`. `R = 50`, `CIRC = 2π·50 = 314.159…` | Track: `<circle cx="59" cy="59" r="50" fill="none" stroke={C.track} strokeWidth="9"/>` where `C.track = "rgba(255,255,255,0.07)"` | Always drawn |
| **G153** Gauge value ring | `:113–114` | Same circle, `stroke={color}`, `strokeWidth="9"`, `strokeLinecap="round"`, `strokeDasharray={CIRC.toFixed(1)}` = `"314.2"`, `strokeDashoffset={(CIRC*(1 - pct/100)).toFixed(1)}`, `transition:"stroke-dashoffset .6s"` | Colours: bull `POS #1FD98A`, bear `NEG #FF3B3B`, rot `HT.orange #FB8501` | `pct = 0` → offset 314.2 → nothing drawn |
| **G154** Gauge centre number | `:116–117` | `position:absolute; inset:0; display:flex; centred; fontSize:22; fontWeight:800; fontVariantNumeric:"tabular-nums"` — text `{pct}%`, an **integer** (already rounded upstream) | `color: pct > 0 ? color : C.muted` — a 0% gauge greys out | `0%` in `C.muted` |
| **G155** `calculateComplexProbabilities` — step 1 | `:86–94` | For each row with `status !== "off"` and `edge != null`: `active++`, `pts = (edge/100) * 1.5`, added to the bucket named by `status` | The `1.5` is a flat per-rule weight — sample size is not an input (see G75). `status` comes from `toRow` (G157) | `active === 0` → early return `{bull:0, bear:0, rot:0}` and all three gauges read 0% |
| **G156** …step 2, env multipliers | `:96–99` | Applied in this exact order: **1.** `ibWidth === "wide"` → `rot += 2.0`; **2.** `ibWidth === "narrow"` → `bull += 0.8; bear += 0.8` (`"normal"` does nothing); **3.** `volume === "active"` → `bull *= 1.3; bear *= 1.3`, **else** `rot *= 1.2`; **4.** `time === "late"` → `rot *= 1.5` | Additive terms land before the multiplicative ones, so the wide-IB `+2.0` is itself multiplied by the 1.2/1.5 that follow | — |
| **G157** …step 3, normalise | `:100–103` | `total = bull + bear + rot \|\| 1`; `bullPct = Math.round(bull/total*100)`; `bearPct = Math.round(bear/total*100)`; `rot = 100 - bullPct - bearPct` | **Rotation is a residual of two independently-rounded numbers, so it can come out 1 point low, 1 point high, or negative** (e.g. bull 50.5→51, bear 49.5→50, rot = −1). A negative `pct` gives `strokeDashoffset > CIRC`, which renders as an empty ring plus a `"-1%"` label | — |
| **G158** `toRow` | `:75–82` | `status = r.state !== "in-play" ? "off" : r.side === "H" ? "bull" : r.side === "L" ? "bear" : "rot"`; `id = "R" + r.id`; `edge = r.p == null ? null : Math.round(r.p)`; `desc = r.read` | **A directionless in-play rule (4, 11, 14, 0c) is bucketed as ROTATION**, not excluded — so "IB Width → Day Type" at 62% adds 0.93 to rotation risk purely for having no side | PENDING and NOT-IN-PLAY rules become `"off"` and contribute nothing |
| **G159** Which rules feed the gauges | `:66–71, 168` | `allRows = STAGE_DEFS.flatMap(s => s.ids.map(id => byId.get(id)).filter(Boolean))`. Stage ids: **Stage 1** `["4","11","7","2"]` · **Stage 2** `["1","10","12"]` · **Stage 3** `["5","6","13"]` · **Stage 4** `["3","8","9","14"]` | All 14 numbered rules, in that non-numeric order. **Rule `"0c"` (day of week) is in no stage and is therefore excluded from the gauge math**, even though it appears as a family member on the card above | A rule id missing from `rules` is dropped by `filter(Boolean)` |
| **G160** Stage constants (dead here) | `:66–71` | Titles and icons, in order: `🔒 "Stage 1: Opening Baseline Setup"`, `🔓 "Stage 2: Interior Range Dynamics"`, `🔓 "Stage 3: Breakout Validation & Traps"`, `🏁 "Stage 4: Continuation Targets & End-of-Day"`. Section header 12.5px/800, `letterSpacing:".14em"`, uppercase, `C.cyan`; icon 14px | Not rendered on this tab (G143) — transcribed because the ids drive G159 | — |
| **G161** `TAG` / `EDGECOL` (dead here) | `:62–63` | `TAG = {bull:"Bullish Edge", bear:"Bearish Edge", rot:"Rotational Risk", off:"Inactive"}`; `EDGECOL = {bull:#1FD98A, bear:#FF3B3B, rot:HT.orange, off:"#6B7686"}` | `EDGECOL` is still live — it colours nothing on this tab but is the source of the gauge colours via `C.bull`/`C.bear`/`C.rot` | — |

---

# G-H — Owner-only historical stat cards

Source: `IbStatsTab.tsx:1432–1855`. Everything here is behind
`isOwner && showStats`. Sixteen `<Card>`s in fixed render order.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **G162** Disclosure button | `:1567–1577` | `alignSelf:"flex-start"; padding:"8px 18px"; borderRadius:8; fontSize:14; fontWeight:800; cursor:pointer; border:"1px solid rgba(255,255,255,0.15)"; background:"transparent"; color:HT.text` | Label: `showStats ? "Hide historical stats ▲ (owner)" : `Show historical stats (${N} sessions) ▼ (owner)`` — glyphs U+25B2 / U+25BC | `showStats` defaults **false**; `N = days.length` |
| **G163** `deriveWidthBuckets` | `:1358–1371` | Runs on `ds.days` before anything else. Early-returns the input untouched if **any** day already has a `widthBucket`. Otherwise per index `i`: `atr = d.atr ?? mean(src[i-14 … i-1].dayRange)`, `avgIB = d.avgIB ?? mean(src[i-20 … i-1].width)`; if `atr == null \|\| avgIB == null \|\| i < 14` → `{...d, atr, avgIB}` with **no bucket**; else the narrow/normal/wide ladder (G-K1) | Trailing windows only, no lookahead. The `i < 14` guard leaves the first 14 sessions bucketless regardless of what the means computed | Bucketless days are excluded from every width table (`wd = days.filter(d => d.widthBucket)`) |
| **G164** `yearsSpan` | `:1441` | `(new Date(ds.to) - new Date(ds.from)) / (365.25 * 864e5)` | `864e5` = ms per day | `NaN` if either date is unparseable → renders `"NaN years of data"` |
| **G165** `verdict(n, p)` | `:1545–1546` | Checked in order: `n < 20 → "thin sample"`; `p >= 65 → "tradeable"`; `p >= 55 → "marginal"`; `p <= 45 → "inverted — fade it"`; else `"noise"` | So 45 < p < 55 is `"noise"`, exactly 45 is `"inverted — fade it"`, exactly 55 is `"marginal"`, exactly 65 is `"tradeable"`. **Sample size wins over rate**, so a 90%-on-9-days row reads `"thin sample"` | Plain text in the Detail column, never coloured |
| **G166** **Card 1** — header card | `:1580–1594` | `<Card accent="blue">` (title `LIGHT_BLUE`). Title `` `${winLabel(win)} Stats — ${ds.symbol} ${ds.barMinutes}m RTH` `` e.g. `"IB 60m Stats — ES 5m RTH"`. Subtitle `` `${winRange(win)} ET · last updated ${LAST_UPDATED}` `` | `ds.symbol` and `ds.barMinutes` come from the JSON, not from the selector — a mislabelled export shows the wrong symbol here while the buttons say otherwise | — |
| **G167** Card 1 — five stat tiles | `:1581–1587` | In order: **1.** `"Sessions"` = `String(N)`, sub `` `${yearsSpan.toFixed(1)} years of data` `` · **2.** `"Date range"` = `` `${ds.from} → ${ds.to}` ``, sub `` `${ds.barMinutes}m bars, RTH` `` · **3.** `` `Avg ${winLabel(win)} width` `` = `` `${f2(avg(widths))} pts` `` · **4.** `` `Median ${winLabel(win)} width` `` = `` `${f2(med(widths))} pts` `` · **5.** `"Range as % of day range"` = `` `${f2((avg(days.map(d => d.width / d.dayRange)) ?? 0) * 100)}%` `` | All white `HT.text`. `med` is `s[Math.floor(s.length/2)]` — the **upper** middle element on an even count, not the mean of the two | `avg`/`med` on an empty array → `null` → `f2` → `"—"` |
| **G168** Card 1 — body copy | `:1588–1593` | 14px `HT.text`, `lineHeight:1.55`. Text: *"{winLabel} = {winRange} ET high/low. A **break** means a bar **close** outside the range — wick-only touches are tracked separately as the trap set. Extensions, MFE and MAE are quoted in multiples of range width, measured from the broken level. Every rule below is identical across windows, so the tabs above are directly comparable: the shorter the window, the earlier the entry and the higher the both-sides-broke tax."* | `<b>` on "break" and "close" | — |
| **G169** **Card 2** — Rule Ranking | `:1596–1601` | `<Card accent="green">`, title `"★ Rule Ranking — highest hit rate first"` (★ = U+2605), subtitle `"Rules with ≥8 sample days only"`. `<Tbl head={["Rule","Sample (days)","Hit","Hit rate","Verdict"]}>` | Footnote: `"Sample size is the first thing to check — a 90% hit rate on 9 days is nothing. A rule at 50±5% is a coin flip."` | Empty `ranked` → header row with no body rows |
| **G170** Card 2 — the 14 ranked rules | `:1525–1543` | Source array, in declaration order, each `[label, n, hits]`: **1.** `"Midpoint close bias"` = `wb.length` / `count(firstTouchSide === bias)` · **2.** `"Formation order + midpoint (confluent)"` = `conf.length` / `count(firstTouchSide === bias)` · **3.** `"Single break — opposite side never breaks"` = `fcb.length` / `sbWin` · **4.** `"Close top/bot 25% + formation order"` = `topStrong.length + botStrong.length` / `count(topStrong H) + count(botStrong L)` · **5.** `"ORB aligned with IB bias"` = `align.length` / `count(firstTouchSide === bias)` · **6.** `"FVG direction = break direction"` = `fv.length` / `count(firstTouchSide === (fvg==="bull"?"H":"L"))` · **7.** `"Failed break → opposite extreme"` = `failed.length` / `count(fcb.fadeOpp)` · **8.** `"Retest → continuation"` = `rt.length` / `count(fcb.retestCont)` · **9.** `"0.25 fib pullback (IB range) → continuation"` = `fA.length` / `count(fcb.fibA.cont)` · **10.** `"0.25 fib pullback (impulse) → continuation"` = `fB.length` / `count(fcb.fibB.cont)` · **11.** `"Break + volume surge → ≥1× ext"` = `volYes.length` / `count(fcb.hit["1"])` · **12.** `"Narrow IB → single break"` = `narrow.length` / `count(singleBreak)` · **13.** `"Wide IB → both sides break (rotation)"` = `wide.length` / `count(bothBroke)` · **14.** `"Contained at 2pm → stays contained"` = `cont.length` / `count(!containedBrokeLate)` | Every label says **"IB"** regardless of the selected window | — |
| **G171** Card 2 — filter and sort | `:1542–1543` | `.filter(([, n]) => n >= 8)` then `.sort((a,b) => b[2]/b[1] - a[2]/a[1])` — descending by hit rate | The `n >= 8` filter is the only thing preventing a `0/0` divide. Ties keep declaration order (V8 sort is stable) | A rule with `n < 8` **vanishes from the table entirely** — no row, no placeholder |
| **G172** **Card 3** — `"0 · Baseline — IB break behavior"` | `:1603–1612` | `<Card accent="cyan">`, subtitle `"The benchmark every rule must beat"`. `head={["Outcome","Days","Hit","Rate","Note"]}`. Six rows, all with `n = N`: `"IB high broken (any wick)"` = `count(touchedH)` · `"IB low broken (any wick)"` = `count(touchedL)` · `"SINGLE break only (one side)"` = `count(singleBreak)`, detail `"the 'single break' edge"` · `"BOTH sides broken (rotation)"` = `count(bothBroke)` · `"NEITHER side broken (contained)"` = `count(neitherBroke)` · `"Break confirmed by a bar CLOSE"` = `fcb.length` | Rate cells take `rateColor` | `N === 0` → `rateNum` returns null → `"—"` |
| **G173** **Card 4** — `"0b · Time of IB Break"` | `:1614–1629` | `<Card accent="purple">` (title `#126783`, very dark against the plate), subtitle `"When the first break actually happens"` | — | — |
| **G174** Card 4 — six stat tiles | `:1615–1622` | **1.** `"Avg · first TOUCH"` = `clock(avg(touchMins))`, sub `` `${f2((avg(touchMins) ?? 0) - 570)} min after IB open` `` · **2.** `"Avg · CLOSE break"` = `clock(avg(closeMins))`, same sub shape · **3.** `"Median · CLOSE break"` = `clock(med(closeMins))`, sub `` `n = ${closeMins.length} days` `` · **4.** `"Avg · HIGH breaks"` = `clock(avg(cbH))`, sub `` `n = ${cbH.length}` `` · **5.** `"Avg · LOW breaks"` = `clock(avg(cbL))`, sub `` `n = ${cbL.length}` `` · **6.** `"Earliest / Latest"` = `` `${clock(min)} – ${clock(max)}` `` | The "min after IB open" subs subtract **570** (09:30) unconditionally, so on the ORB windows they measure from 09:30 rather than from the range end — correct as written, but the label says "IB open" on every tab | Tile 6: `closeMins.length === 0` → `"—"`. `clock(null)` → `"—"` |
| **G175** Card 4 — cumulative table | `:1623–1628` | `head={["Break has occurred…","Break days","Count","Cumulative %","Note"]}`; every row `n = closeMins.length`, `hits = closeMins.filter(x => x <= m).length`, `detail = "cumulative"` | Footnote: `"The steepest part of this curve is your attention window — that's when to be at the screen."` | — |
| **G176** Card 4 — bucket ladder | `:1452–1455` | Built from `[[REND,`by ${clock(REND)} (first bar out)`],[REND+15,`by ${clock(REND+15)}`],[REND+30,`by ${clock(REND+30)}`],[660,"by 11:00"],[720,"by 12:00 (noon)"],[780,"by 13:00"],[840,"by 14:00"],[900,"by 15:00"]]` then `.filter(([m],i,a) => m >= REND && a.findIndex(([x]) => x === m) === i)` — drops anything before the range end and de-duplicates by minute, **keeping the first occurrence** | **IB 60m** (REND 630) → 7 rows: `"by 10:30 (first bar out)"`, `"by 10:45"`, `"by 11:00"`, `"by 12:00 (noon)"`, `"by 13:00"`, `"by 14:00"`, `"by 15:00"` — note `REND+30 = 660` wins the dedupe, so the literal `"by 11:00"` entry is the one dropped and the surviving label is also `"by 11:00"`. **ORB 30m** (600) → 8 rows starting `"by 10:00 (first bar out)"`, `"by 10:15"`, `"by 10:30"`, then 11:00/12:00/13:00/14:00/15:00. **ORB 15m** (585) → `"by 09:45 (first bar out)"`, `"by 10:00"`, `"by 10:15"`, then the five fixed. **ORB 5m** (575) → `"by 09:35 (first bar out)"`, `"by 09:50"`, `"by 10:05"`, then the five fixed | — |
| **G177** **Card 5** — `"0c · Day of the Week"` | `:1631–1677` | `<Card accent="blue">`, subtitle `"Same rules, sliced by weekday — where the trend days and the chop days actually live"`. **Hand-built `<table>`, not `Tbl`** | — | `byDow` is `.filter(x => x.g.length > 0)`, so a weekday with no sessions is dropped |
| **G178** Card 5 — 10 columns in order | `:1635–1636` | **1.** `"Day"` (`thL`) · **2.** `"Sessions"` · **3.** `"Avg IB width"` · **4.** `"Single break"` · **5.** `"Both sides (rotation)"` · **6.** `"Never broke"` · **7.** `"Break ≥1× ext"` · **8.** `"Fail rate"` · **9.** `"Avg break time"` · **10.** `"High breaks first"` | Header 3 says **"IB"** on every window tab | **No sort control — rows are always Monday→Friday** in `DOW` declaration order (`:1517`) |
| **G179** Card 5 — cell formulas | `:1640–1657` | Per weekday `g` (all its sessions) and `gb = g.filter(d => d.fcb)`: `g.length` · `f2(avg(g.width))` · `sb = rateNum(count(singleBreak), g.length)` · `bb = rateNum(count(bothBroke), g.length)` · `pct(count(neitherBroke), g.length)` · `ext = rateNum(count(gb.fcb.hit["1"]), gb.length)` · `pct(count(gb.fcb.failed), gb.length)` · `clock(avg(gb.fcb.breakMin))` · `pct(count(firstTouchSide==="H"), count(firstTouchSide != null))` | Columns 4, 5 and 7 take `rateColor` + `fontWeight:800`; columns 6, 8, 9, 10 are plain white | Any `rateNum` null → `"—"`; `pct` with 0 denominator → `"—"` |
| **G180** Card 5 — weekday key | `:1518–1523` | `dowOf(d) = new Date(`${d.date}T12:00:00Z`).getUTCDay()`; `byDow = ["Monday","Tuesday","Wednesday","Thursday","Friday"].map((name,i) => ({name, g: days.filter(d => dowOf(d) === i+1), gb}))` | Noon-UTC parse so no timezone shifts the date. Weekend sessions (`getUTCDay()` 0 or 6) are silently excluded from every weekday row **and** from the ALL DAYS totals denominators only where those totals reuse `days` — they do, so the two halves of the table use different populations | — |
| **G181** Card 5 — ALL DAYS row | `:1659–1670` | All ten cells at `fontWeight:800`, all in plain `HT.text` (**no `rateColor`**, unlike the weekday rows above): `"ALL DAYS"` · `N` · `f2(avg(widths))` · `pct(count(singleBreak), N)` · `pct(count(bothBroke), N)` · `pct(count(neitherBroke), N)` · `pct(count(fcb.hit["1"]), fcb.length)` · `pct(count(fcb.failed), fcb.length)` · `clock(avg(closeMins))` · `pct(count(firstTouchSide==="H"), count(firstTouchSide != null))` | The totals row deliberately drops the colour ladder so it reads as a baseline, not a score | — |
| **G182** Card 5 — footnote | `:1673–1676` | `note` style. *"Read each weekday against the ALL DAYS row, not against 50%. A day only matters if it deviates from the sample’s own baseline by more than a few points — with ~450 sessions per weekday, a 3–4 point gap is still inside the noise band."* | `&rsquo;` for the apostrophe; en dashes in "3–4" | The "~450" is hardcoded prose and does not track `N` |
| **G183** **Card 6** — `"1 · Midpoint Close Bias"` | `:1679–1686` | `<Card accent="cyan">`, subtitle `"IB closes above mid → high breaks first. Below mid → low breaks first."`. `head={["Signal","Days","Correct","Hit rate","Detail"]}` | Four rows: `"All midpoint-bias days"` = `wb.length` / `count(firstTouchSide === bias)` · **(indent)** `"Bias LONG (close > mid)"` = `wbL.length` / `count(firstTouchSide==="H")`, detail `"predicted high breaks first"` · **(indent)** `"Bias SHORT (close < mid)"` = `wbS.length` / `count(firstTouchSide==="L")`, detail `"predicted low breaks first"` · `"…and that side EVER breaks"` = `wb.length` / `count(bias==="H" ? touchedH : touchedL)`, detail `"looser test — breaks at any point"` | `wb = days.filter(d => d.bias)`; indented rows use `paddingLeft:26` |
| **G184** **Card 7** — `"2 · Formation Order + Midpoint"` | `:1688–1696` | `<Card accent="green">`, subtitle `"Low forms first + close above mid → long. High first + close below mid → short."`. `head={["Setup","Days","Correct","Hit rate","Detail"]}` | Four rows: `"CONFLUENT (order agrees with bias)"` = `conf.length` / `count(firstTouchSide === bias)`, detail `"the A+ filter"` · **(indent)** `"Long (low first, close > mid)"` = `confL` · **(indent)** `"Short (high first, close < mid)"` = `confS` · `"DISCORDANT (order fights bias)"` = `disc.length` / `count(firstTouchSide === bias)`, detail `"skip these"` | Footnote: `"Compare CONFLUENT against the raw midpoint bias in Rule 1 — the delta is the entire value of the formation-order filter."` |
| **G185** Card 7 — `conf` / `disc` definitions | `:1461–1464` | `conf = days.filter(d => d.bias && ((d.first === "L" && d.bias === "H") \|\| (d.first === "H" && d.bias === "L")))` — i.e. confluent means the extreme that formed FIRST is the OPPOSITE of the bias side. `disc = days.filter(d => d.bias && !conf.includes(d))` | **`conf.includes(d)` is an O(n) scan inside an O(n) filter — O(n²) over ~2,300 sessions, re-run on every render of the owner block** (no `useMemo` anywhere in the owner section) | — |
| **G186** **Card 8** — `"3 · Single Break Continuation"` | `:1698–1705` | `<Card accent="orange">`, subtitle `"The claimed 70–85% edge, tested on close-confirmed breaks"`. `head={["Test","Days","Hit","Rate","Detail"]}`; every row `n = fcb.length` | Four rows: `"Opposite IB side NEVER breaks"` = `sbWin` (`:1465` = `count(fcb.side==="H" ? !touchedL : !touchedH)`), detail `"true single-break day after entry"` · `"Break extends ≥ 0.5× IB width"` = `count(fcb.hit["0.5"])` · `"Break extends ≥ 1.0× IB width"` = `count(fcb.hit["1"])` · `"Never trades back to the IB midpoint"` = `count(d.noMidReturn)`, detail `"strictest version"` | `noMidReturn` exists **only in the offline export** (`SlimDay:438`) — nothing in `lib/ibStats.ts`'s own `enrich()` computes it. An export missing the field makes this row read 0.0% in red |
| **G187** **Card 9** — `"4 · IB Width → Day Type"` | `:1707–1735` | `<Card accent="red">`, subtitle `"Narrow → trend/break. Wide → rotation, fade the breaks."` | — | — |
| **G188** Card 9 — four threshold tiles | `:1708–1713` | **1.** `k="NARROW = width <"`, `v="0.5× ATR14  or  0.75× avgIB20"` (**two spaces** either side of "or"), `sub=`≈ under ${f2(Math.min(0.5*avgAtr, 0.75*avgAvgIb))} pts at current vol`` · **2.** `k="WIDE = width >"`, `v="1.5× ATR14  or  1.25× avgIB20"`, `sub=`≈ over ${f2(Math.min(1.5*avgAtr, 1.25*avgAvgIb))} pts at current vol`` · **3.** `k="NORMAL"`, `v="everything between"`, `sub="the default state"` · **4.** `k="Sample averages"`, `v=`ATR14 ${f2(avgAtr)} · avgIB20 ${f2(avgAvgIb)}``, `sub="RTH daily range / 20d mean IB"` | **The NARROW tile uses `Math.min` where the OR makes the true boundary `Math.max`.** A width qualifies as narrow if it is under *either* threshold, so the effective ceiling is the larger of the two; the tile quotes the smaller and therefore understates it. The WIDE tile's `Math.min` is correct for the same reason | `avgAtr`/`avgAvgIb` are `avg(wd.map(d => d.atr!)) ?? 0` and `avg(wd.map(d => d.avgIB!)) ?? 0` (`:1471–1472`) — zero when no day is bucketed, giving `"≈ under 0.00 pts"` |
| **G189** Card 9 — bucket outcome table | `:1714–1721` | `head={["Bucket","Days","Single-break","Rate","Both sides broke / ≥1× ext"]}`. **NARROW** `n=narrow.length`, `hits=count(singleBreak)`, detail `` `both: ${pct(count(bothBroke), narrow.length)} · ≥1× ext: ${extRate(narrow)}` `` · **NORMAL** same shape · **WIDE** `hits = count(bothBroke)` — a **different metric in the same column**, flagged by its detail string `` `hit col = BOTH-sides rate · ≥1× ext: ${extRate(wide)}` `` | `extRate(a)` (`:1473–1476`) = over `a.filter(d => d.fcb)`, `pct(count(fcb.hit["1"]), that length)`, or `"—"` when empty | The WIDE row's "Rate" column is not comparable to the two above it despite sharing a header |
| **G190** Card 9 — width-range table | `:1723–1734` | `head={["Bucket","Actual IB widths in sample","Mean","Days","Share of sessions"]}`. Three hand-built `<tr>` from `[["NARROW", narrow, HT.green],["NORMAL", normal, HT.orange],["WIDE", wide, HT.red]]`: label cell coloured + 800; `wRange(a)` = `` `${f2(min width)} – ${f2(max width)} pts` `` or `"—"`; `` `${f2(avg(width))} pts` `` or `"—"`; `a.length`; `pct(a.length, wd.length)` | Bucket label colours are fixed, not `rateColor` | Footnote: `"Use the ×ATR / ×avgIB rule live — the point ranges are just what those adaptive thresholds worked out to across this sample, so they overlap as vol regimes shift."` |
| **G191** **Card 10** — `"5 · Breakout Entry — close beyond IB + volume"` | `:1737–1746` | `<Card accent="green">`, subtitle `"Volume filter = break-bar volume > average IB bar volume"`. `head={["Entry filter","Days","≥1× IB ext","Rate","Avg MFE / MAE (× IB width)"]}` | Three rows: `"Close break + VOLUME surge"` = `volYes.length` / `count(hit["1"])`, detail `` `MFE ${f2(avg(rExt))}× / MAE ${f2(avg(rAdv))}×` `` · `"Close break, NO volume surge"` = `volNo` same shape · `"WICK-only touch (no close outside)"` = `wickOnly.length` / **`hits={0}`** | **The third row hardcodes `hits = 0`, so its Rate cell always reads `0.0%` painted `HT.red`** — a red 0% that looks like a measured result but is a placeholder. Detail `"the traps — no entry taken"`. Footnote: `"MAE is your stop-distance requirement — it's the heat the average winner still made you sit through."` |
| **G192** **Card 11** — `"6 · Failed Breakout Fade"` | `:1748–1755` | `<Card accent="red">`, subtitle `"Break closes outside, then closes back inside within 30 min"`. `head={["Outcome","Days","Hit","Rate","Detail"]}` | Three rows: `"Break FAILS (closes back inside ≤30m)"` `n=fcb.length` / `failed.length`, detail `"base rate of the trap"` · **(indent)** `"then reaches the IB MIDPOINT"` `n=failed.length` / `count(fadeMid)`, detail `"target 1"` · **(indent)** `"then reaches the OPPOSITE IB extreme"` `n=failed.length` / `count(fadeOpp)`, detail `"target 2 — the money target"` | Footnote (via `dangerouslySetInnerHTML`): `` `Avg excursion before the fail: <b>${f2(avg(failed.map(d => d.fcb.peakBeforeFail)))} pts</b> — that is roughly the stop a breakout entry has to survive.` `` |
| **G193** **Card 12** — `"7 · 15m FVG inside the IB"` | `:1757–1764` | `<Card accent="purple">`, subtitle `"15m fair-value gap, rebuilt from the raw bars"`. `head={["FVG","Days","Reaches IB extreme in FVG dir","Rate","Reaches midpoint"]}` | Four rows: `"BULLISH FVG in IB"` = `fvB.length` / `count(hitExt)` where `hitExt(d) = d.fvg === "bull" ? d.touchedH : d.touchedL`, detail `` `mid: ${pct(count(fvgHitMid), fvB.length)}` `` · `"BEARISH FVG in IB"` same · `"FVG direction = first-touch side"` = `fv.length` / `count(firstTouchSide === (fvg==="bull"?"H":"L"))`, detail `"directional predictive power"` · `"NO FVG in IB (control) → single break"` = `N - fv.length` / `count(!d.fvg && d.singleBreak)`, detail `"control group"` | `fvgHitMid` is another **export-only field** (`SlimDay:439`) with no local computation |
| **G194** **Card 13** — `"8 · Retest Continuation"` | `:1766–1772` | `<Card accent="cyan">`, subtitle `"Returns to within 2 ticks of the broken level, close holds outside"`. `head={["Path","Days","Continues to new extreme","Rate","Avg MFE (× IB width)"]}` | Two rows: `"Break → clean RETEST → continue"` = `rt.length` / `count(retestCont)`, detail `` `${f2(avg(rt.map(d => d.fcb.rExt)))}×` `` · `"Break → NO retest (runs away)"` = `noRt.length` / `count(hit["1"])`, detail `` `${f2(avg(rExt))}× (hit = ≥1× ext)` `` | `rt = fcb.filter(d => d.fcb.retest)`; `noRt = fcb.filter(d => !d.fcb.retest && !d.fcb.failed)` — **the two populations are not complementary** (failed-and-not-retested days are in neither). Footnote: `"If retest MFE ≥ no-retest MFE, waiting costs nothing and improves the entry. If it's materially lower, the best days never retest — take the break."` |
| **G195** **Card 14** — `"B · 0.25 Fib Pullback → Continuation"` | `:1774–1786` | `<Card accent="green">`, subtitle `"Two readings of \"the 0.25 level\" — they are very different trades"` (`&quot;` entities). `head={["Test","Days","Hit","Rate","Detail"]}`. The only card that uses `sectionRow` | Section A header (`LIGHT_BLUE`, colSpan 5): `"Variant A — 0.25 of the IB RANGE, measured back into the IB (high break → IBH − 0.25×width). A deep pullback that re-enters the IB."` Then: `"Pullback REACHES the 0.25 level"` `n=fcb.length` / `fA.length`, detail `"how often you even get filled"` · **(indent)** `"then CONTINUES to a new extreme"` `n=fA.length` / `count(fibA.cont)`, detail `"the actual edge"` · **(indent)** `"instead runs through the IB MIDPOINT"` `n=fA.length` / `count(fibA.fail)`, detail `"trade dies"` · `"NO pullback — price never comes back"` `n=fcb.length` / `fAno.length`, detail `` `these run: avg MFE ${f2(avg(fAno.rExt))}× IB` `` | Section B header: `"Variant B — 0.25 retrace of the post-break IMPULSE (break level → running extreme). A shallow pullback that stays outside the IB."` Then: `"Pullback REACHES the 0.25 impulse retrace"` `n=fcb.length` / `fB.length`, detail `"requires impulse > 0.25× IB first"` · **(indent)** `"then CONTINUES to a new extreme"` `n=fB.length` / `count(fibB.cont)`, detail `"the actual edge"`. Footnote (HTML): `` `Variant A avg MFE measured <i>from the 0.25 entry</i>: <b>${f2(avg(fA.map(d => d.fcb.fibA.mfe ?? 0)))}× IB width</b>. Watch the "no pullback" row — if the runaway days carry the fattest MFE, waiting for 0.25 filters you out of the best sessions.` `` |
| **G196** **Card 15** — `"9 · Extension Targets"` | `:1788–1796` | `<Card accent="orange">`, subtitle `"Scale-out probabilities, measured from the broken level"`. `head={["Target","Breaks","Reached","Hit rate","Sizing"]}` | Four generated rows over `[0.5, 1, 1.5, 2]`: label `` `${t}× IB width from break` ``, `n = fcb.length`, `hits = count(fcb.hit[String(t)])`, detail `` `avg IB ${f2(avg(widths))} pts → target ≈ ${f2(t * (avg(widths) ?? 0))} pts` `` | Footnote (HTML): `` `Avg MFE on all close-breaks: <b>${f2(avg(fcb.rExt))}× IB width</b> · avg MAE (heat taken): <b>${f2(avg(fcb.rAdv))}× IB width</b>.` `` |
| **G197** **Card 16** — `"10 · Close Location in IB Range"` | `:1798–1808` | `<Card accent="green">`, subtitle `"Top 25% + low first → strong long. Bottom 25% + high first → strong short."`. `head={["Zone","Days","Breaks as predicted","Rate","Detail"]}` | Five rows: `"TOP 25% close"` = `top.length` / `count(firstTouchSide==="H")`, detail `"plain zone"` · **(indent)** `"+ LOW formed first (STRONG LONG)"` = `topStrong.length` / `count(H)`, detail `` `single-break: ${pct(count(singleBreak), topStrong.length)}` `` · `"BOTTOM 25% close"` = `bot.length` / `count(L)`, detail `"plain zone"` · **(indent)** `"+ HIGH formed first (STRONG SHORT)"` = `botStrong.length` / `count(L)`, same detail shape · `"MIDDLE 50% close (no edge expected)"` = `midz.length` / `count(firstTouchSide === d.bias)`, detail `"bias hit-rate — expect a coin flip"` | The MIDDLE row's comparison counts `null === null` as a hit, so a session with neither a bias nor a first touch scores as correct |
| **G198** **Card 17** — `"11 · Open Type + IB Width"` | `:1810–1824` | `<Card accent="purple">`, subtitle `"OAR = open outside the prior RTH range · HIR/LIR = open inside it"`. `head={["Open type","Days","Hit","Rate","What 'hit' means"]}` | For each of `["OAR-H","OAR-L","HIR","LIR"]` **in that order**, over `g = wd.filter(d => d.openType === ot)` — **note the population is `wd` (bucketed days only), not `days`**: row `` `${ot} — all` `` = `g.length` / `count(singleBreak)`, detail `"single-break rate"`; then if non-empty, **(indent)** `` `${ot} + NARROW IB` `` = `gn.length` / `count(singleBreak)`, detail `"breakout thesis"`; then if non-empty **(indent)** `` `${ot} + WIDE IB` `` = `gw.length` / `count(bothBroke)`, detail `"both-sides broke = rotation thesis"` | An open type with zero matching days emits **no rows at all** (`return []`). Footnote: `"OAR-H / OAR-L = opened above / below the prior RTH range. HIR / LIR = opened inside the prior range, in the upper / lower half."` |
| **G199** **Card 18** — `"12 · ORB + IB Alignment"` | `:1826–1834` | `<Card accent="cyan">`, subtitle `"09:30–09:45 opening range breaks the same way as the IB midpoint bias"`. `head={["Setup","Days","Bias side breaks first","Rate","Single-break rate"]}` | Two rows over `ob = days.filter(d => d.orbDir && d.bias)`: `"ALIGNED (ORB dir = IB bias)"` = `align.length` / `count(firstTouchSide === bias)`, detail `pct(count(singleBreak), align.length)` · `"CONFLICTED (ORB vs IB bias)"` = `oppose.length` / same, same detail shape | Footnote: `"Aligned should beat conflicted on BOTH columns for this filter to earn its keep."` On the 15m/5m windows the exporter has no inner ORB, so both rows go to `n = 0` → `"—"` |
| **G200** **Card 19** — `"13 · Time Filter — when the break happens"` | `:1836–1846` | `<Card accent="orange">`, subtitle `"Hit = extension ≥ 1× IB width"`. `head={["Break window","Breaks","≥1× ext","Rate","Detail"]}` | Five generated rows from `tf` (`:1509–1512`): `[REND,720] → `${clock(REND)} – 12:00``, `[720,780] → "12:00 – 13:00"`, `[780,840] → "13:00 – 14:00"`, `[840,900] → "14:00 – 15:00"`, `[900,961] → "15:00 – close"`. Each: `g = fcb.filter(d => breakMin >= a && breakMin < b)`, `hits = count(hit["1"])`, detail `` `avg MFE ${f2(avg(rExt))}× · fail rate ${pct(count(failed), g.length)}` ``. Plus a sixth row `"ALL breaks before noon"` = `byNoon.length` (`breakMin < 720`) / `count(hit["1"])`, detail `"the killzone cut"` | Bounds are `>= a` and `< b`. The last window ends at **961**, one minute past the 16:00 close — deliberate so a 16:00 break is included. Footnote: `"Late breaks have less session left — expect decaying extension rates. If they don't decay, the break is time-agnostic."` |
| **G201** **Card 20** — `"14 · Contained Day (rare)"` | `:1848–1854` | `<Card accent="red">`, subtitle `"Price still entirely inside the IB at 14:00 ET"`. `head={["Outcome","Days","Hit","Rate","Detail"]}` | Three rows: `"Contained at 14:00"` `n=N` / `cont.length`, detail `"base rate of the setup"` · **(indent)** `"STAYS inside through the close (fade works)"` `n=cont.length` / `count(!containedBrokeLate)`, detail `"fade the extremes"` · **(indent)** `"BREAKS out late (fade gets run over)"` `n=cont.length` / `count(containedBrokeLate)`, detail `"the tail risk"` | The two indented rows are exact complements and always sum to 100.0% |
| **G202** **Dead card A** — `RuleBoard` | `:1097–1202` | `<Card accent="green">`, title `` `In Play Right Now — live & forming rules against today's ${L} (${winRange(win)} ET)` ``, a 7-tile `statGrid`, a 4-column table (`["Rule","Live read","Points to","Hit rate"]`) with two `secRow` section headers and a long footnote | **Rendered by nothing.** `LiveToday` returns `LiveGauges` + `RuleClusterBoard` + `IbProbabilityEngine` only (`:426–443`). It is the only consumer of `live.status`, `live.dayHigh/dayLow` in prose form, and the `sideChip` helper | Do not port |
| **G203** **Dead card B** — `PlaybookLegacy` | `:1206–1352` | Marked `@deprecated` at `:1205`, wrapped in `eslint-disable @typescript-eslint/no-unused-vars`. Builds up to 11 `Setup` cards, filters `n >= 15`, sorts by `p` desc, renders a `minmax(280px,1fr)` grid with 28px/800 rates and a `"thin sample"` flag under 40 | **Rendered by nothing.** Its border rule is a fourth, separate rate ladder: `p >= 60 → HT.green`, `p <= 40 → HT.red`, else `"rgba(255,255,255,0.08)"` | Do not port |

---

# G-I — `buildRules` — the 15 live rules and every string they emit

Source: `IbStatsTab.tsx:681–942`. This one function feeds **three** surfaces:
the IB Read families (G-F), the Probability Engine gauges (G-G), and the dead
`RuleBoard`. Shorthand used below: `L` = `winLabel(win)`, `W(s)` = `"HIGH"` /
`"LOW"`, `exp = bias ?? first` (the side the range leans toward), `noBreak` =
`"no close-confirmed break yet — odds below are for IF it fires"`.

Every rule emits `{id, name, state, read, side, question, cond?, outcome?}`.
`state` is one of `"in-play"` / `"not-in-play"` / `"pending"`. A
`not-in-play` rule has **no `cond`/`outcome`**, so `scoreWithHistory` gives it
`n = 0`, `p = null`, `last5 = []` → the pill renders `"—"` and `"no history"`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **G204** Rule 1 — `"Midpoint Close Bias"` | `:705–714` | IN-PLAY when `bias != null`. read `` `${L} closed ${bias==="H"?"ABOVE":"BELOW"} mid → lean ${bias==="H"?"LONG":"SHORT"}` ``; side `bias`; question `` `${W(bias)} breaks first` ``; `cond: d.bias === bias`; `outcome: d.firstTouchSide === bias` | — | NOT-IN-PLAY read: `` `${L} closed exactly ON the midpoint — no bias` ``, side `null`, question `"—"` |
| **G205** Rule 2 — `"Formation Order + Midpoint"` | `:716–729` | IN-PLAY when `bias && confluent`, where `confluent = !!bias && ((first==="L" && bias==="H") \|\| (first==="H" && bias==="L"))`. read `` `${W(first)} formed first + close ${bias==="H"?"above":"below"} mid — CONFLUENT (the A+ filter)` ``; question `` `${W(bias)} breaks first` ``; `cond: d.bias===bias && d.first===first`; `outcome: d.firstTouchSide===bias` | — | NOT-IN-PLAY read: with a bias → `` `${W(first)} formed first + close ${…} mid — DISCORDANT, the rule says skip` ``; without → `"no midpoint bias to align with"` |
| **G206** Rule 3 — `"Single Break Continuation"` | `:731–744` | IN-PLAY when `brk != null`. read `` `Broke the ${W(brk)} — does the other side stay untouched?` ``; question `` `${brk==="H"?"LOW":"HIGH"} never breaks (stays a single-break day)` ``; `cond: !!d.fcb && d.fcb.side===brk`; `outcome: d.fcb.side==="H" ? !d.touchedL : !d.touchedH` | — | **PENDING** (not "not-in-play"): read `` `${noBreak} — projected side: ${W(exp)}` ``, side `exp`, question `` `IF the ${W(exp)} breaks, the ${exp==="H"?"LOW":"HIGH"} never does` ``, cond/outcome keyed on `exp` |
| **G207** Rule 4 — `` `${L} Width → Day Type` `` | `:746–756` | IN-PLAY when `bk` is one of narrow/normal/wide. read `` `${bucket} ${L} (${f2(live.width)} pts) → ${bk==="narrow" ? "trend / breakout lean" : bk==="wide" ? "rotation lean — fade the breaks" : "no width edge"}` ``; **side `null`**; question `bk==="wide" ? "BOTH sides break (rotation)" : "only ONE side breaks"`; `cond: d.widthBucket===bk`; `outcome: bk==="wide" ? d.bothBroke : d.singleBreak` | Side `null` → the Probability Engine files this rule under **rotation** (G158) | NOT-IN-PLAY read: `"width bucket unavailable — ATR14 / 20d avg range not yet established"` |
| **G208** Rule 5 — `"Breakout Entry — close + volume"` | `:758–775` | IN-PLAY when `brk && live.volSurge != null`. read: surge → `` `${W(brk)} break came WITH a volume surge (break bar > avg ${L} bar)` ``; no surge → `` `${W(brk)} break came with NO volume surge — the weaker version` ``. question `` `the break runs ≥ 1× ${L} width` ``; `cond: !!d.fcb && d.fcb.volSurge === live.volSurge`; `outcome: !!d.fcb.hit["1"]` | — | PENDING read: with a break → `"break printed but bar volume is unavailable on the live feed — showing the all-breaks rate"`; without → `` `${noBreak} — projected side: ${W(exp)}` ``. Pending question: `` `IF a ${W(exp)} break prints WITH a volume surge, it runs ≥ 1× ${L} width` ``; cond adds `d.fcb.volSurge` |
| **G209** Rule 6 — `"Failed Breakout Fade"` | `:777–794` | IN-PLAY when `brk != null`. read: `live.failed` → `` `The ${W(brk)} break ALREADY FAILED — closed back inside. Fade target: mid, then the opposite extreme` ``; else `` `${W(brk)} break is holding — this is the trap risk, not yet triggered` ``. **side is INVERTED**: `brk==="H" ? "L" : "H"`. question: failed → `` `the fade reaches the OPPOSITE ${L} extreme` ``; else `"this break fails and closes back inside ≤30m"`. `cond: !!d.fcb && d.fcb.side===brk && (live.failed ? d.fcb.failed : true)`; `outcome: live.failed ? d.fcb.fadeOpp : d.fcb.failed` | The inverted side means a HIGH break makes this rule vote BEARISH in the family and engine maths | PENDING read: `` `${noBreak} — this is the trap rate to expect` ``, side inverted from `exp`, question `` `IF a ${W(exp)} break prints, it FAILS back inside within 30m` `` |
| **G210** Rule 7 — `` `15m FVG inside the ${L}` `` | `:796–810` | IN-PLAY when `fvg != null`. read `` `${fvg==="bull"?"BULLISH":"BEARISH"} 15m fair-value gap inside the ${L}` ``; side `fvg==="bull"?"H":"L"`; question `` `the ${fvg==="bull"?"HIGH":"LOW"} is the side that gets touched first` ``; `cond: d.fvg===fvg`; `outcome: d.firstTouchSide === (fvg==="bull"?"H":"L")` | — | NOT-IN-PLAY read: `win <= 15` → `` `window is only ${win}m — a 15m FVG cannot form inside it. Use the 30m or 60m tab for this rule.` ``; else `` `no 15m FVG formed inside today's ${L}` `` |
| **G211** Rule 8 — `"Retest Continuation"` | `:812–828` | IN-PLAY when `brk && live.retest`. read `` `Price came back to the broken ${W(brk)} and ${live.retestCont ? "held — continuation is live" : "is still deciding"}` ``; question `"it continues to a new extreme after the retest"`; `cond: !!d.fcb?.retest && d.fcb.retestCont != null`; `outcome: !!d.fcb.retestCont` | The in-play `cond` **does not filter by break side** — it pools HIGH and LOW retests together, unlike the pending branch which does | PENDING read: with a break → `` `no retest of the broken ${W(brk)} yet — odds below are for IF it comes back` ``; without → `` `${noBreak} — projected side: ${W(exp)}` ``. side `brk ?? exp`; question `` `IF the broken ${W(brk ?? exp)} is retested, it continues to a new extreme` `` |
| **G212** Rule 9 — `"Extension Targets"` | `:830–843` | IN-PLAY when `brk != null`. read `` `Measuring from the broken ${W(brk)} — ${live.targets.filter(t => t.hit).length}/${live.targets.length} targets reached` `` (e.g. `"— 2/4 targets reached"`); question `` `the move reaches ≥ 1× ${L} width` ``; `cond: !!d.fcb && d.fcb.side===brk`; `outcome: !!d.fcb.hit["1"]` | — | PENDING read: `` `${noBreak} — targets would measure from the ${L} ${W(exp)} (${f2(exp==="H" ? live.ibh : live.ibl)})` `` |
| **G213** Rule 10 — `` `Close Location in the ${L} Range` `` | `:845–860` | IN-PLAY when `strongZone && bias`, where `strongZone = (zone==="top25" && first==="L") \|\| (zone==="bot25" && first==="H")`. read `` `Close in the ${zoneWord} + ${W(first)} formed first — the strong ${zone==="top25"?"LONG":"SHORT"} version` `` where `zoneWord` ∈ `"TOP 25%"` / `"BOTTOM 25%"` / `"MIDDLE 50%"`; side `zone==="top25"?"H":"L"`; `cond: d.closeZone===zone && d.first===first`; `outcome: d.firstTouchSide === (zone==="top25"?"H":"L")` | The `&& bias` in the gate is redundant with `strongZone` in practice but can knock the rule out on an exactly-on-mid close | NOT-IN-PLAY read: `zone==="mid50"` → `` `${L} closed in the MIDDLE 50% — no close-location edge` ``; else `` `Close in the ${zoneWord} but ${W(first)} formed first — zone and formation order disagree` `` |
| **G214** Rule 11 — `` `Open Type + ${L} Width` `` | `:862–873` | IN-PLAY when `openType && bk`. read `` `${openType} open (${openType.startsWith("OAR") ? "outside" : "inside"} the prior RTH range) + ${bucket} ${L}` ``; **side `null`**; question `"only ONE side breaks"`; `cond: d.openType===openType && d.widthBucket===bk`; `outcome: d.singleBreak` | Side `null` → counted as rotation by the engine | NOT-IN-PLAY read: `"prior-session RTH range unavailable on the live feed — open type can't be classified"` — the only message, even when the real cause is a missing width bucket |
| **G215** Rule 12 — `` `Inner 15m ORB + ${L} Alignment` `` | `:875–890` | IN-PLAY when `orbDir && bias`. read: `orbDir===bias` → `` `Inner 15m ORB broke ${W(orbDir)} — ALIGNED with the midpoint bias` ``; else `` `Inner 15m ORB broke ${W(orbDir)} — CONFLICTS with the midpoint bias` ``. side `bias` **in both cases** — a conflicting ORB still votes the bias direction; question `` `${W(bias)} breaks first` ``; `cond: d.bias===bias && d.orbDir===orbDir`; `outcome: d.firstTouchSide===bias` | This is the sole member of the hero "Conflict Watch" family | NOT-IN-PLAY read: `win <= 15` → `` `window is only ${win}m — there is no inner ORB to nest inside it. Use the 30m or 60m tab for this rule.` ``; else `!orbDir` → `` `the 09:30–09:45 opening range never broke inside the ${L}` ``; else `"no midpoint bias to align with"` |
| **G216** Rule 13 — `"Time Filter — when the break happens"` | `:892–911` | IN-PLAY when `bm != null`. read `` `Break printed at ${clock(bm)} ET — ${bm <= REND+30 ? `early (first 30m out of the ${L})` : bm <= 780 ? "midday" : "late"}` ``; question `` `the break runs ≥ 1× ${L} width given that timing` ``; **`cond` uses different boundaries from the read**: `bm <= 660 ? breakMin <= 660 : bm <= 780 ? (breakMin > 660 && breakMin <= 780) : breakMin > 780` | **The displayed word and the scored bucket disagree.** On IB 60m a break at 10:50 reads `"early (first 30m out of the IB 60m)"` (10:50 ≤ 11:00) *and* scores in the ≤660 bucket — they agree by luck. On ORB 5m (REND 575) a break at 10:10 reads `"early (first 30m…)"` — 610 ≤ 605 is false, so actually it reads `"midday"` — while scoring in the ≤660 early bucket. The two ladders are genuinely independent | PENDING read: `` `${noBreak} — it's ${clock(live.nowMin)} ET, so a break now counts as ${live.nowMin <= 660 ? "EARLY" : live.nowMin <= 780 ? "MIDDAY" : "LATE"}` ``; question `` `IF the break prints in this window, it runs ≥ 1× ${L} width` ``; cond keyed on `live.nowMin` with the same 660/780 boundaries |
| **G217** Rule 14 — `"Contained Day (rare)"` | `:913–929` | IN-PLAY when `live.containedAt2 === true`. read `` `Price is STILL fully inside the ${L} at 14:00 ET — the rare contained day` ``; **side `null`**; question `"it stays contained into the close (never breaks late)"`; `cond: d.containedAt2`; `outcome: !d.containedBrokeLate` | Three-way gate. PENDING when `live.nowMin < 840 && !brokeH && !brokeL`: read `` `Still inside the ${L} at ${clock(live.nowMin)} ET — not confirmed until 14:00` ``, question `"IF price is still contained at 14:00, it never breaks late"`, same cond/outcome | NOT-IN-PLAY read: `` `price already broke the ${L} — not a contained day` `` |
| **G218** Rule 0c — `` `Day of week — ${dowName}` `` | `:931–939` | Pushed **only when `dowIdx >= 1 && dowIdx <= 5`**. Always `state:"in-play"`. read `` `It's ${dowName}` ``; **side `null`**; question `"only ONE side breaks"`; `cond: new Date(`${d.date}T12:00:00Z`).getUTCDay() === dowIdx`; `outcome: d.singleBreak` | Uses the **browser-local** weekday (G55). Absent from `STAGE_DEFS`, so it never reaches the Probability Engine | On a weekend the rule is simply not pushed — the "Timing, Width & Day Type" family drops to 4 members with no message |

---

# G-J — `IbDailyResults` — the EOD scoreboard

Source: `components/scanner/IbDailyResults.tsx:1–270`, mounted at
`IbStatsTab.tsx:1859` as `{isOwner && <IbDailyResults sym={sym} />}`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **G219** Disclosure button | `:102–111` | `alignSelf:"flex-start"; padding:"8px 18px"; borderRadius:8; fontSize:14; fontWeight:800; cursor:pointer; border:"1px solid rgba(255,255,255,0.15)"; background:"transparent"; color:HT.text`. Label: `open ? "Hide daily results ▲" : "Daily Results — how the IB + every rule did, day by day ▼"` | Default `open = false` | Wrapper `display:flex; flexDirection:column; gap:16` |
| **G220** Fetch | `:88–96` | `fetch(`/api/ib-results?symbol=${sym}&limit=90`)` — **lazy, on first expand only**. Guard `if (!open \|\| rows[sym]) return`; deps `[open, sym, rows]`. `!r.ok` → `throw new Error(`HTTP ${r.status}`)` | GET, no poll, no abort beyond an `alive` flag. Response `{rows: Row[]}`; `j.rows ?? []` | Cached per symbol in `rows`, so a second expand never refetches |
| **G221** Error handling | `:86, 94, 156` | Single `err` state, **not keyed by symbol and never cleared** | Rendered as `<div style={{color: HT.red, fontSize:14}}>{err}</div>` | An ES failure leaves the red banner up after switching to NQ, even when NQ loads fine |
| **G222** Card header | `:114–121` | `<ThemeCard variant="budget">`. Title `` `Daily Results — ${sym} · IB 60m (09:30–10:30 ET)` `` at 17px/800, `letterSpacing:"0.06em"`, `HT.cyan`. Sub-line 14px `HT.text` `marginTop:3`: `"Recorded automatically at 16:30 ET every trading day. ✓ rule hit · ✗ rule missed · — not in play. Hover a cell for the rule + trigger."` | **The title is hardcoded to `IB 60m (09:30–10:30 ET)`** and ignores the window selector — this card only ever reflects the 60-minute recorder | — |
| **G223** Bias summary line 1 | `:137–142` | `biased = data.filter(r => r.bias === "H" \|\| r.bias === "L")`; `bullPct = 100*count(bias==="H")/biased.length`; `bearPct = 100 - bullPct`. Renders 14px `marginTop:6`: `"Bias @ 10:30 (last {biased.length}): "` at `opacity:0.85`, then `` `${bullPct.toFixed(0)}% Bullish` `` in `HT.green` 800, `" / "` at `opacity:0.6`, then `` `${bearPct.toFixed(0)}% Bearish` `` in `HT.red` 800 | 0 dp | `biased.length === 0` → both read `"—"`; the whole block is gated on `data && data.length > 0` |
| **G224** Bias summary line 2 | `:143–150` | `resolved = biased.filter(r => r.break_side === "H" \|\| r.break_side === "L")`; `aBullPct = 100*count(break_side==="H")/resolved.length`; `hitPct = 100*count(break_side === r.bias)/resolved.length`. Text: `"Actual — broke first ({resolved.length} resolved): "` + green `X% Bullish` + `" / "` + red `Y% Bearish` + `" · bias correct "` + `Z%` in `hitCol` | `hitCol = hitPct == null ? HT.text : hitPct >= 60 ? HT.green : hitPct <= 40 ? HT.red : HT.orange` — **the `rateColor` ladder re-implemented inline** rather than imported | `resolved.length === 0` → `"—"` in all three |
| **G225** Table container | `:165` | `<div style={{overflowX:"auto"}}>` wrapping `<table style={{width:"100%", borderCollapse:"collapse"}}>` | 23 columns need the horizontal scroller | — |
| **G226** Columns 1–8 | `:169–176` | **1.** `"Date"` (`{...th, textAlign:"left"}`) → `r.date` in `{...td, textAlign:"left", fontWeight:700}` · **2.** `"Width"` → `f1(r.ib_width)` (1 dp, `"—"` on null/non-finite) · **3.** `"Bkt"` → `r.width_bucket ?? "—"` with `textTransform:"uppercase"` · **4.** `"Bias"` → `r.bias ?? "—"`, coloured `H → HT.green`, `L → HT.red`, else `HT.text`, `fontWeight:800` · **5.** `"1st"` → `r.first_formed ?? "—"` plain · **6.** `"Break"` → see G227 · **7.** `"Time"` → `clock(r.break_min)` = `` `${HH}:${MM}` `` zero-padded, `"—"` on null · **8.** `"1×"` → `r.break_side ? (r.ext_10 ? "✓" : "✗") : "—"`, coloured `r.ext_10 ? HT.green : HT.text` at `fontWeight:800` | Column 8's colour rule paints a `✗` **white, not red** — only a hit is coloured | All eight fall back to `"—"` |
| **G227** Column 6 — `"Break"` | `:187, 197–200` | `dayType = r.both_broke ? "BOTH" : r.neither_broke ? "NONE" : r.break_side ?? (r.single_break ? "1-side" : "—")`, suffixed `"†"` when `r.failed` | Colour: `"H" → HT.green`, `"L" → HT.red`, `"BOTH" → HT.purple`, everything else `HT.text`; `fontWeight:800`. `title` attribute `"break failed back inside ≤30m"` when `r.failed`, otherwise **`undefined`** (no tooltip) | Six possible strings: `"BOTH"`, `"NONE"`, `"H"`, `"L"`, `"1-side"`, `"—"`, each optionally `+ "†"` |
| **G228** Columns 9–22 — `R1`…`R14` | `:29, 177–179, 205` | `RULE_IDS = ["1","2",…,"14"]` in numeric order; header text `` `R${id}` `` with `title={RULE_NAMES[id]}` | `RULE_NAMES`: `1 "Midpoint Close Bias"`, `2 "Formation Order + Midpoint"`, `3 "Single Break Continuation"`, `4 "IB Width → Day Type"`, `5 "Breakout Entry + Volume"`, `6 "Failed Breakout Fade"`, `7 "15m FVG inside IB"`, `8 "Retest Continuation"`, `9 "Extension ≥1× Width"`, `10 "Close Location (strong)"`, `11 "Open Type + IB Width"`, `12 "Inner ORB + Alignment"`, `13 "Time Filter"`, `14 "Contained Day"` | Cells looked up from `new Map(r.rules.map(x => [x.id, x]))`; `Array.isArray(r.rules) ? r.rules : []` guards a null column |
| **G229** The hit / miss rule | `:69–81` (`RuleCell`) | **Miss-or-absent branch:** `!r \|\| r.state === "off" \|\| r.hit == null` → `<td style={{...td, opacity:0.4}} title={r ? `${RULE_NAMES[r.id]} — ${r.note}` : ""}>—</td>`. **Scored branch:** `<td style={{...td, color: r.hit ? HT.green : HT.red, fontWeight:800}} title={`${RULE_NAMES[r.id]} — ${r.note}${r.side ? ` · pointed ${r.side === "H" ? "HIGH" : "LOW"}` : ""}`}>{r.hit ? "✓" : "✗"}</td>` | So exactly three cell states: `✓` in `HT.green`, `✗` in `HT.red`, `—` at 40% opacity. `r.state` values are `"in"` / `"off"` (from `lib/ibDaily.ts:19`), **not** `buildRules`' `"in-play"`/`"pending"`/`"not-in-play"` — the two rule engines use different state vocabularies | An absent rule id gives an empty `title=""` |
| **G230** Column 23 — `"Shouldn't Be"` | `:180, 206–217` | Header `title="The side the 10:30 bias called that did NOT hold — what price shouldn't have been."`. Cell: `brokeSide = r.break_side === "H" \|\| r.break_side === "L" ? r.break_side : null`; `failed = r.bias && brokeSide && r.bias !== brokeSide ? r.bias : null`; text `failed ? `¬${failed}` : "—"` (¬ = U+00AC) | `color: failed ? HT.red : HT.text`; `fontWeight: failed ? 800 : 400`; `opacity: failed ? 1 : 0.4`. `title`: failed → `` `Bias called ${failed==="H"?"HIGH":"LOW"} first — price didn't go there; broke ${brokeSide} instead.` `` (note the tooltip prints the raw `"H"`/`"L"` for the actual side but the spelled-out word for the called side); else `"Bias call held — nothing to fade."` | `"—"` at 40% |
| **G231** Sort | — | **There is none.** Rows render in `data.map` order, i.e. exactly the order `/api/ib-results` returned them. Per `IbStatsTab.tsx:1008` the API is **newest-first**, so the table reads newest at the top | No column is clickable, no arrow glyph, no default-sort indicator, and `useTableSort` is not imported | — |
| **G232** Hit-rate footer row | `:222–239` | First cell `colSpan={8}`, `{...td, textAlign:"left", fontWeight:800, color: LIGHT_BLUE}`, text `` `HIT RATE (in-play days only, last ${data.length})` ``. Then one cell per rule id: population is `data.map(r => r.rules?.find(x => x.id === id)).filter(x => x.state === "in" && x.hit != null)`; `p = 100*count(x.hit)/g.length`; text `` `${p.toFixed(0)}%` ``; `title` `` `${RULE_NAMES[id]} — ${g.length} in-play day(s)` ``. A final empty `<td style={td}/>` under "Shouldn't Be" | Colour: `p == null → HT.text`; `p >= 60 → HT.green`; `p <= 40 → HT.red`; else `HT.orange` — **a third inline copy of the `rateColor` ladder** | `g.length === 0` → `"—"` |
| **G233** Table footnote | `:242–245` | 14px italic `HT.text`, `marginTop:10`: `"Break column: H/L = close-confirmed break side, BOTH = rotation, NONE = contained, † = break failed back inside within 30m. 1× = the break ran ≥ 1× IB width. Hit rates are conditional on the rule being in play, so columns have different sample sizes."` | none | — |
| **G234** `"THE RULES"` legend | `:39–54, 248–263` | Block: `marginTop:16; paddingTop:12; borderTop:"1px solid rgba(255,255,255,0.10)"`. Heading `"THE RULES"` 14px/800 `letterSpacing:"0.05em"` `LIGHT_BLUE` `marginBottom:8`. Grid `repeat(auto-fit, minmax(340px,1fr))` `gap:"4px 24px"`. Each entry: `R{id}` at 800 `HT.cyan` `minWidth:30`, then the name at `fontWeight:700`, then `" — "` + the claim at `opacity:0.85`, all 14px `lineHeight:1.45`. `RULE_CLAIM` in id order: **1** `"Close vs IB midpoint calls which IB extreme gets touched first."` · **2** `"Which extreme formed first + midpoint bias agreeing = stronger first-touch call."` · **3** `"A close-confirmed break of one side holds — the other side never trades."` · **4** `"Wide IB (vs 14-day norm) → rotation/both sides; narrow/normal → single-side trend day."` · **5** `"Break with a volume surge follows through ≥ 1× IB width."` · **6** `"A break that fails back inside within 30m fades to the opposite extreme."` · **7** `"An unfilled 15m FVG inside the IB points to the extreme touched first."` · **8** `"Price retests the broken level and continues in the break direction."` · **9** `"A close-confirmed break extends ≥ 1× IB width (0.5/1/1.5/2× shown on hover)."` · **10** `"Close in the top/bottom 25% of the IB, agreeing with formation order, calls first touch."` · **11** `"Open type (vs prior RTH) + width bucket predicts a single-side day."` · **12** `"The inner 30m ORB breaking in the same direction as midpoint bias confirms the bias."` · **13** `"Breaks before 11:00 ET extend ≥ 1× more often than midday/late breaks."` · **14** `"Still inside the IB at 14:00 ET → stays contained into the close."` | **Claim 12 says "inner 30m ORB". Every implementation uses the 09:30–09:45 fifteen-minute range** (`lib/ibDaily.ts:169`, `IbStatsTab.tsx:312`). The code wins; the legend string is wrong | Rendered only inside the `data.length > 0` branch |
| **G235** Empty / loading states | `:156–162` | In order: `err` → red banner (G221) · `!err && !data` → `"Loading…"` at 14px `HT.text` · `!err && data && data.length === 0` → `"No results recorded yet — the first row lands at 16:30 ET on the next trading day."` at 14px `HT.text` | The bias summary block, the table, the footnote and the legend are all inside the `data.length > 0` branch | Collapsed (`!open`) → nothing but the button, and no fetch has fired |

---

# G-K — Every bucket ladder, as an ordered list of boundaries

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **G236** Ladder 1 — **range width class** | `lib/ibStats.ts:182–187`, `lib/ibDaily.ts:55–66`, `IbStatsTab.tsx:294–299` and `:1365–1368` — **four independent copies of the same four numbers** | Evaluated top-down, first match wins: **1.** `width < 0.5 × ATR14` **OR** `width < 0.75 × avgIB20` → `"narrow"` · **2.** `width > 1.5 × ATR14` **OR** `width > 1.25 × avgIB20` → `"wide"` · **3.** otherwise → `"normal"` | Strict `<` and `>` on all four; equality lands in `normal`. Because narrow is tested first, a width satisfying both branches is **narrow**. `ATR14` = trailing mean of RTH day range; `avgIB20` = trailing mean of range width | Either mean null → the whole bucket is `null`. Live copy renders `"—"`; dataset copy excludes the day from `wd`; rule 4 goes not-in-play |
| **G237** Ladder 1 — sample guards, per copy | as above | `lib/ibStats.ts:169,172`: `avgIB` needs **≥5** prior sessions, `atr` needs **≥5** · `lib/ibDaily.ts:59`: `trailing.length < 14` → null, then `slice(-14)` for ATR and `slice(-20)` for avgIB · `IbStatsTab.tsx:1364`: additionally `i < 14` → no bucket · `IbStatsTab.tsx:296`: guard is only `hist.avgAtr && hist.avgIb` truthy, i.e. **non-zero**, with no count check at all | Four different minimum-sample rules for one classification | The live path's guard is the weakest — a single non-zero session would pass it |
| **G238** Ladder 2 — **extension multiples** | `lib/ibStats.ts:299`, `IbStatsTab.tsx:304`, `lib/ibDaily.ts:166` | Ordered: `0.5`, `1`, `1.5`, `2` — always these four, always × range width, always measured from the broken level (`ibh` on a high break, `ibl` on a low). Stored as `hit: Record<"0.5"\|"1"\|"1.5"\|"2", boolean>`. Test is `mfe >= t * width` (`>=`, inclusive) | Colour ladder (`IbLevelCanvas.tsx:207,210,220,223,295–296` only): `mult >= 1.5 → HT.red`; `mult >= 1 → HT.orange`; else `LIGHT_BLUE` | No break → `hit` is `{}` and every lookup is `undefined` → falsy |
| **G239** Ladder 3 — **close zone** | `lib/ibStats.ts:155`, `lib/ibDaily.ts:98`, `IbStatsTab.tsx:269, 323` | `loc = (ibClose − ibl) / width`. **1.** `loc >= 0.75` → `"top25"` · **2.** `loc <= 0.25` → `"bot25"` · **3.** otherwise → `"mid50"`. Both boundaries inclusive toward the extremes | Prose forms used on screen: `"top 25%"` / `"bottom 25%"` / `"middle 50%"` (`:269`), and `"TOP 25%"` / `"BOTTOM 25%"` / `"MIDDLE 50%"` (`:695`) | `width === 0`: `lib/ibDaily` and the live path set `loc = 0.5` → `"mid50"`; `lib/ibStats` drops the day before this point (`width <= 0 → continue`) |
| **G240** Ladder 4 — **midpoint bias** | `lib/ibStats.ts:156`, `lib/ibDaily.ts:96`, `IbStatsTab.tsx:267` | **1.** `ibClose > mid` → `"H"` · **2.** `ibClose < mid` → `"L"` · **3.** exactly equal → `null` | `mid = (ibh + ibl)/2`; `ibClose` is the last IB bar's close | `null` disables rules 1, 2, 10 and 12 |
| **G241** Ladder 5 — **open type** | `lib/ibStats.ts:175–179`, `lib/ibDaily.ts:182–187`, `IbStatsTab.tsx:327–332` | Against the prior session's RTH high/low: **1.** `dayOpen > pdh` → `"OAR-H"` · **2.** `dayOpen < pdl` → `"OAR-L"` · **3.** `dayOpen > (pdh + pdl)/2` → `"HIR"` · **4.** otherwise → `"LIR"`. Table order in card 17 is the same: OAR-H, OAR-L, HIR, LIR | `lib/ibDaily` adds `!(dayOpen > 0)` → `null`; the other two do not | Prior range unknown → `null` → rule 11 not-in-play, and card 17 simply omits the type |
| **G242** Ladder 6 — **break timing**, five incompatible versions | `IbStatsTab.tsx:896, 898, 902, 905–909, 1452–1455, 1509–1512`; `lib/ibDaily.ts:312` | **(a)** rule-13 scored buckets: `<= 660` / `661–780` / `> 780` · **(b)** rule-13 in-play *prose*: `<= REND+30` "early" / `<= 780` "midday" / else "late" · **(c)** rule-13 pending prose: `<= 660` EARLY / `<= 780` MIDDAY / else LATE · **(d)** `lib/ibDaily` note: `<= 660` "early break" / `<= 780` "midday break" / else "late break" · **(e)** card 19 windows: `[REND,720)`, `[720,780)`, `[780,840)`, `[840,900)`, `[900,961)`, plus `< 720` "before noon" | (b) is the only one anchored to the selected window; the other four hardcode 660/720/780/840/900 | Break absent → rule 13 renders its pending branch keyed on `live.nowMin` |
| **G243** Ladder 7 — **rate colour** | `IbStatsTab.tsx:102–106`; duplicated inline at `IbDailyResults.tsx:134` and `:231` | **1.** `p == null` → `HT.text #FFFFFF` · **2.** `p >= 60` → `HT.green #8ECAE6` · **3.** `p <= 40` → `HT.red #EF4444` · **4.** otherwise → `HT.orange #FB8501` | Three code copies, identical numbers. A fourth ladder with the same shape but different boundaries lives in the dead `PlaybookLegacy` (`:1329`): `>= 60` green / `<= 40` red / else `rgba(255,255,255,0.08)` | — |
| **G244** Ladder 8 — **rule verdict** | `IbStatsTab.tsx:1545–1546` | **1.** `n < 20` → `"thin sample"` · **2.** `p >= 65` → `"tradeable"` · **3.** `p >= 55` → `"marginal"` · **4.** `p <= 45` → `"inverted — fade it"` · **5.** otherwise → `"noise"` | Sample size is checked before rate, so a high-rate thin row never reads "tradeable" | Rendered as plain uncoloured text in card 2's Detail column |
| **G245** Ladder 9 — **tactical verdict** | `IbStatsTab.tsx:539–559, 627` | **1.** both sides broken → `"fade"` · **2.** break printed and `failP > 50` → `"fade"` · **3.** break printed and `p >= 55` → `"tradeable"`, else `"noise"` · **4.** bias only and `p >= 60` → `"tradeable"`, `p <= 45` → `"fade"`, else `"noise"` · **5.** no bias → `"noise"` | Display strings: `"TRADEABLE EDGE"` (`HT.green`), `"FADE SETUP"` (`HT.red`), `"NO EDGE"` (`HT.orange`) | `rule === null` → `"Waiting on the 10:30 ET close."` and the plate borders orange |
| **G246** Ladder 10 — **overall conviction** | `IbStatsTab.tsx:574` | **1.** `\|score\| >= 45` → `"STRONG"` · **2.** `\|score\| >= 20` → `"LEAN"` · **3.** otherwise → `"NEUTRAL"` | `score` clamped to `[−100, +100]` by G85 | `NEUTRAL` overrides the bull/bear colour with `HT.orange` |
| **G247** Ladder 11 — **day type** | `lib/ibStats.ts:215–217`, `lib/ibDaily.ts:105–107` | Wick-based, mutually exclusive and exhaustive: `bothBroke = touchedH && touchedL`; `neitherBroke = !touchedH && !touchedL`; `singleBreak = touchedH !== touchedL` | Note these use **wick touches**, while `brokeH`/`brokeL` (used for the `"Break"` column and the live `status`) use **closes**. A session can be `singleBreak` by wick and have no close break at all | — |
| **G248** Ladder 12 — **failed-break outcome** | `lib/ibStats.ts:483–493` (`failOutcome`) | Priority order, first match wins: **0.** `!fcb.failed` → `null` (not in the population) · **1.** `rExt × width > peakBeforeFail + 1e-9` → `"recovered"` · **2.** `fadeOpp` → `"full_rotation"` · **3.** `fadeMid` → `"to_mid"` · **4.** otherwise → `"chop"` | The `1e-9` epsilon exists because both sides are floating-point point values. The header comment warns that `peakBeforeFail` is in POINTS and `rExt` in IB WIDTHS, and that getting the multiply backwards makes everything read `"recovered"` | **`failOutcome` is exported and called by nothing in the staged tree.** Neither `IbStatsTab` nor `IbDailyResults` imports it. Do not port until a consumer exists |
| **G249** Ladder 13 — **engine environment multipliers** | `IbProbabilityEngine.tsx:96–99` | Applied in this order, additive before multiplicative: **1.** `ibWidth === "wide"` → `rot += 2.0` · **2.** `ibWidth === "narrow"` → `bull += 0.8; bear += 0.8` · **3.** `volume === "active"` → `bull *= 1.3; bear *= 1.3`, **else** `rot *= 1.2` · **4.** `time === "late"` → `rot *= 1.5` | `ibWidth === "normal"` contributes nothing. There is no "quiet volume" branch — anything that is not `"active"` boosts rotation | `active === 0` short-circuits before any of this and returns three zeros |
| **G250** Ladder 14 — **sample-size floors in force** | across the part | **40** `MIN_N` — `bestSample`, the day-of-week matrix swap, and the break-side grouping in the active rule (`:452, 528, 545`) · **20** — `verdict()`'s thin-sample cut (`:1546`) · **15** — the dead `PlaybookLegacy` filter (`:1314`) · **8** — the rule-ranking filter (`:1542`) · **20 / 14** — the trailing windows for `avgIB` / `ATR` · **5** — `lib/ibStats`' minimum prior sessions for either mean · **14** — `classifyWidth` and `deriveWidthBuckets` minimum history · **10** — `lib/ibStats:117` minimum IB bars *and* minimum post bars for a day to be built at all · **3** — `lib/ibDaily:81` and `useIbDirection:65` minimum IB bars · **2** — `IbLevelCanvas:78` minimum IB bars | **`scoreWithHistory` — the function behind every family pill and every engine gauge — applies NO floor at all** (G120) | Below a floor: the day is dropped (10/3/2), the bucket is null (14/20/5), the row vanishes (8/15), the label changes (20/40) |

---

# G-L — `lib/ibStats.ts` — every statistic, with formula and guard

Source: `lib/ibStats.ts:1–508`.

**Read this first.** The tab imports **only** `avg`, `med`, `clock` and the
types `IbDataset` / `SlimDay` (`IbStatsTab.tsx:25`). `parseCsv`, `buildDays`,
`enrich`, `baseBreak`, `analyzeBreak`, `failOutcome`, `rate` and `ES_TICK` are
**never called in the browser**. They document the semantics of the offline
exporter (`ib-backtest-esu6.html` → "Export JSON for dashboard"), which is what
actually writes `public/data/ib-<SYM>.json`. Every formula below therefore
defines a **dataset field**, not a rendered value — but the rendered values are
all derived from those fields, so a v3 port that changes any of them silently
changes every percentage on the tab.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **G251** `ES_TICK` | `:17` | `0.25` — used as the retest tolerance (`2 × ES_TICK` = 0.5 pts) | Exported; the tab re-declares its own `tick = 0.25` at `:360` instead of importing it | — |
| **G252** `parseCsv` | `:81–101` | Input line format `YYYYMMDD HHMMSS,open,high,low,close,volume`. Regex `/^(\d{4})(\d{2})(\d{2})[ T](\d{2}):?(\d{2})/` — accepts a space or `T` separator and an optional colon in the time. `min = H*60 + Mi`; `date = "YYYY-MM-DD"` | Skips: blank lines; rows with `< 6` fields; rows whose first field fails the regex (**this is how a header row is silently dropped**); rows where any of o/h/l/c is not finite. `v` falls back to `0` when not finite | Returns `[]` on unparseable input — no error is raised |
| **G253** `buildDays` — day gate | `:113–121` | Groups by `date`, sorts each day by `min`. `ibBars = bars.filter(b => b.min >= 570 && b.min < 630)` (12 × 5m); `post = bars.filter(b => b.min >= 630)` | **Guard: `ibBars.length < 10 \|\| post.length < 10` → the whole session is dropped.** Second guard: `width <= 0` → dropped | A dropped day is invisible everywhere downstream — it is not counted in `N` and leaves no gap marker |
| **G254** `ibh` / `ibl` / `width` / `mid` / `ibClose` / `ibVol` | `:119–126` | `ibh = max(h)`, `ibl = min(l)`, `width = ibh − ibl`, `mid = (ibh + ibl)/2`, `ibClose = last IB bar close`, `ibVol = Σv / ibBars.length` (mean, not total) | — | — |
| **G255** `first` — with tie-break | `:128–134` | First index at which `b.h === ibh` vs first at which `b.l === ibl`; `hiIdx < loIdx ? "H" : loIdx < hiIdx ? "L" : (ibBars[0].c >= ibBars[0].o ? "L" : "H")` | **The third branch exists only here.** `lib/ibDaily.ts:95` and `IbStatsTab.tsx:266` both collapse to `hiIdx < loIdx ? "H" : "L"`, so a one-bar IB is `"L"` there and direction-dependent here | — |
| **G256** `orbH` / `orbL` | `:136–138` | `orb = ibBars.slice(0,3)` — the **first three bars by position**, i.e. 09:30–09:45 at 5m but 09:30–09:33 at 1m | `lib/ibDaily.ts:169` and the live path use `min < 585`, which is minute-based and therefore bar-size independent | — |
| **G257** `closeLoc` / `closeZone` / `bias` | `:140, 154–156` | `loc = (ibClose − ibl)/width`; ladder per G239; `bias` per G240 | — | — |
| **G258** `pdh` / `pdl` / `pdc` | `:164–166` | Taken from `days[i-1]`: `dayHigh`, `dayLow`, `dayClose` — the **previous surviving session** in the array, which after the G253 drops is not necessarily the previous calendar session | First day → all three `null` | `null` → `openType` null |
| **G259** `avgIB` | `:168–169` | `prev20 = days.slice(max(0, i-20), i)`; `prev20.length >= 5 ? mean(prev20.width) : null` | Trailing 20, no lookahead, minimum 5 | `null` |
| **G260** `atr` | `:171–172` | `prev14 = days.slice(max(0, i-14), i)`; `prev14.length >= 5 ? mean(prev14.dayHigh − prev14.dayLow) : null` | **ATR here is a plain mean of RTH high−low ranges — not a true ATR** (no gap component, no Wilder smoothing). The label `"ATR14"` on card 9 overstates it | `null` |
| **G261** `openType` / `widthBucket` | `:174–187` | Ladders per G241 and G236 | `openType` computed only when both `pdh` and `pdl` are non-null; `widthBucket` only when both `avgIB` and `atr` are non-null | `null` in either case |
| **G262** `touchedH` / `touchedL` / day type | `:200–217` | `touchedH` = any post bar with `b.h > ibh`; `touchedL` = any post bar with `b.l < ibl`. Day type per G247 | Strict `>` / `<` — touching the level exactly is not a touch | — |
| **G263** `firstTouchSide` / `firstTouchBar` | `:203–209` | The first post bar that wicks outside. **The high is checked before the low inside the same bar**, so a bar that pierces both sides always records `"H"` | `lib/ibDaily.ts:114` instead breaks the tie by magnitude: `b.h − ibHigh >= ibLow − b.l ? "H" : "L"`. The dataset and the EOD recorder therefore disagree on outside-bar days | `null` when neither side is ever touched |
| **G264** `firstCloseBreak` (`fcb`) | `:200–212, 218` | The first post bar whose **close** is outside, high checked before low; passed to `analyzeBreak` | — | `null` → the session is excluded from `fcb` and from every break-conditioned table |
| **G265** `fvg` | `:220–230` | 15m candles built by **chunking `ibBars` three at a time** (`i += 3`); then for `i` while `i+2 < c15.length`: `c15[i+2].l > c15[i].h → "bull"`, `c15[i+2].h < c15[i].l → "bear"` | No `break` — the **last** qualifying gap wins. Equivalent to `lib/ibDaily`'s minute-window build at 5m bars, not at other sizes | `null` when fewer than 3 fifteen-minute candles exist |
| **G266** `containedAt2` / `containedBrokeLate` | `:232–243` | `upTo2 = post.filter(b => b.min < 840)`; contained iff `upTo2.length > 0 && max(upTo2.h) <= ibh && min(upTo2.l) >= ibl`. If contained, `containedBrokeLate` = any bar at `min >= 840` with `h > ibh` or `l < ibl` | **Wick-based.** `lib/ibDaily.ts:202` and `IbStatsTab.tsx:373` are both **close-based** — so the dataset's "contained" population is strictly stricter than the one the live rule 14 and the EOD grader use | `upTo2` empty → `containedAt2 = false`; no late bars → `containedBrokeLate = false` |
| **G267** `orbDir` | `:245–249` | Scans `ibBars.slice(3)` for the first bar whose close is outside `[orbL, orbH]`; **`break`s on the first match** (unlike `fvg`) | — | `null` when the inner range never breaks |
| **G268** `analyzeBreak` — MFE / MAE | `:270–296` | Over `rest = post.slice(fb.i + 1)` (**the break bar itself is excluded**): `fav = dir > 0 ? b.h − lvl : lvl − b.l`, `adv = dir > 0 ? lvl − b.l : b.h − lvl`; `mfe = max(fav)`, `mae = max(adv)`. Then `rExt = mfe / width`, `rAdv = mae / width` | MFE is a **wick** excursion, not a close. Both are in points before the division, in range-widths after | No bars after the break → `mfe = mae = 0`, `rExt = rAdv = 0` |
| **G269** `analyzeBreak` — `failed` / `peakBeforeFail` | `:282–284, 297` | Within the first **6 bars** of `rest` (`j < 6`): the first bar whose close is back inside sets `failIdx` and freezes `peakBeforeFail = mfe`-so-far (in **points**) | `lib/ibDaily.ts:135` uses `b.min <= brk.min + 30` — 30 clock-minutes. Identical at 5m bars only | `failed = false`, `peakBeforeFail = 0` |
| **G270** `analyzeBreak` — `retest` / `retestCont` | `:287–292, 301–310` | Retest requires `j > 0`, `failIdx == null` (**a break that already failed can never register a retest**), price within `2 × ES_TICK` of the level, **and the close still outside** (`b.c > lvl` / `b.c < lvl`). `retestCont` = after the retest bar, a new extreme beyond `preExt` (the running extreme up to and including the retest bar) | `lib/ibDaily.ts:150–155` drops the close-holds-outside requirement and defines continuation as merely *a close beyond the level*, not a new extreme. Two materially different statistics under one name | No retest → `retest = false`, `retestCont = null` |
| **G271** `analyzeBreak` — `fadeMid` / `fadeOpp` | `:312–322` | Only when `failIdx != null`, over `rest.slice(failIdx + 1)`: `fadeMid` = price reaches `d.mid` in the fade direction; `fadeOpp` = price reaches the opposite IB extreme | Wick-based (`min(l)` / `max(h)`) | No bars after the fail → both `false`. Never failed → both stay `false` from `baseBreak` |
| **G272** `analyzeBreak` — `hit` map | `:299` | `for (t of [0.5,1,1.5,2]) hit[String(t)] = mfe >= t * width` — inclusive `>=` | Keys are `"0.5"`, `"1"`, `"1.5"`, `"2"`. `String(1)` is `"1"`, not `"1.0"` — the tab's `hit["1"]` lookups depend on this | No break → the whole `Breakout` object is null |
| **G273** `fibA` — 0.25 of the IB range | `:327, 333–343, 355–374` | Level `fibALvl = dir > 0 ? ibh − 0.25×width : ibl + 0.25×width`. `hit` when any post-break bar trades to it. `aExt` = the running extreme up to and including the touch bar. Then: `cont` = a new extreme beyond `aExt` afterwards; `fail` = price reaches `d.mid` afterwards; `mfe` = `(extreme after the touch − fibALvl)/width` **in range-widths, measured from the 0.25 entry**; `barsToTouch = aIdx + 1` | `cont` and `fail` are **not mutually exclusive** — a day can do both, and cards 14's rows 2 and 3 can therefore sum past 100% | Never touched → the default `{hit:false, cont:false, fail:null, mfe:null, lvl:null, barsToTouch:null}`. Touched with no bars after → `cont:false, fail:false, mfe:0` |
| **G274** `fibB` — 0.25 of the impulse | `:329–330, 344–352, 376–387` | Requires the running impulse `\|running − lvl\|` to exceed `0.25 × width` first; then the pullback level is `running ∓ 0.25 × imp`. `hit` on the first bar that trades to it; `bExt = running` at that moment; `cont` = a new extreme beyond `bExt` afterwards | `fibB` carries **only** `hit` and `cont` — `fail`, `mfe` and `lvl` are hardcoded `null` (`:384`), which is why card 14's Variant B has two rows to Variant A's four | Default `{hit:false, cont:false, fail:null, mfe:null, lvl:null, barsToTouch:null}` |
| **G275** `avg` | `:497` | `a.length ? Σa/a.length : null` | No outlier handling, no NaN filtering — a single `NaN` in the array poisons the result | `null` → `f2` → `"—"` |
| **G276** `med` | `:498–502` | `[...a].sort((x,y) => x−y)[Math.floor(a.length/2)]` | **On an even-length array this is the UPPER of the two middle values, not their mean.** A true median it is not | `null` on empty |
| **G277** `clock` | `:503–507` | `min == null \|\| !Number.isFinite(min) → "—"`; else `` `${pad2(floor(min/60))}:${pad2(round(min % 60))}` `` | `Math.round` on the minute part means `634.6` renders as `"10:35"`, and `659.6` renders as `"10:60"` — an unreachable clock time | `"—"` |
| **G278** `rate` | `:508` | `(n, d) => d ? (100*n)/d : null` | **Exported and imported by nothing.** `IbStatsTab` declares its own identical `rateNum` at `:100` | Dead export |

---

# G-M — `IbLevelCanvas` — complete drawing spec (DEAD FILE)

Source: `components/scanner/IbLevelCanvas.tsx:1–333`.

**Three findings up front, because they change what "porting this" means.**

1. **It is not a canvas.** The file is named `IbLevelCanvas`, its header comment
   calls it "the live IB state canvas", and it contains **no `<canvas>`
   element, no `getContext`, no `2d` context, and no imperative draw call**. The
   whole picture is a single declarative `<svg viewBox="0 0 560 460">` with 20
   child elements. Everything below is SVG geometry.
2. **v3 non-negotiable 6 (`data-cb-layer` on every canvas) — N/A but unmet in
   spirit.** There is no canvas to tag, and the `<svg>` carries no `data-cb-layer`
   either. It does carry `role="img"` and an `aria-label`. If v3 rebuilds this as
   a real canvas through `ChartFrame` (non-negotiable 4), the tag must be added.
   **Stated plainly: the attribute is absent.**
3. **v3 non-negotiable 5 (a card nobody can see does not paint) — NOT MET.**
   There is no `handle.visible()`, no `onVisibility`, no `data-visible`, no
   `IntersectionObserver`, and no `enabled` gate anywhere in the file. It calls
   `useEsCandles(true, 1)` with a **hardcoded `true`**, so the moment it mounts it
   holds a socket subscription and re-renders at the feed's 4 Hz publish rate
   whether or not a pixel of it is on screen. **Stated plainly: the visibility
   guard is absent.**

It is also **imported by nothing** — `grep -rn "IbLevelCanvas"` matches only its
own file. Nothing on `?tab=ibstats` renders it.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **G279** Data — candles | `:57` | `useEsCandles(true, 1)` — **ES only**, `enabled` hardcoded `true`, `historyDays = 1`, interval defaults to 5m, `withAverages` defaults to true | No symbol prop, no NQ path | — |
| **G280** Data — base rates | `:60–69` | `fetch("/data/ib-ES.json")` in a mount effect, deps `[]`, `.then(r => r.ok ? r.json() : null)`, `.catch(() => {})` | **Hardcoded to the 60-minute ES dataset** regardless of anything | Failure or non-OK → `ds` stays `null` → `rates` null → `levels` `[]` → the ladder draws with no extension lines and the rail is empty |
| **G281** IB window | `:32–33, 72–86` | `IB_START = 570`, `IB_END = 630` — **hardcoded 09:30–10:30**, no window selector. `inIb = candles.filter(c => etMinutes(c.timestamp) >= 570 && < 630)` | `etMinutes` (`:36–46`) is the same `Intl` ET conversion as `IbStatsTab`, written a third time with a different reducer (`p.forEach(x => m[x.type] = x.value)`) | **Guard: `inIb.length < 2` → `ib` is null.** Also `width <= 0` → null |
| **G282** `ib` fields | `:79–85` | `high = max(inIb.high)`, `low = min(inIb.low)`, `width = high − low`, `mid = (high+low)/2`, `last = candles[last].close`, `complete = etMinutes(candles[last].timestamp) >= 630`, `bars = inIb.length` (**computed and never read**) | **No session-date grouping** — unlike `IbStatsTab.tsx:222–226`, this filters purely on minute-of-day, so with more than one session in `candles` it blends yesterday's 09:30–10:30 into today's IB. `historyDays = 1` keeps that mostly harmless, not structurally impossible | `ib === null` → the empty card (G283) |
| **G283** Empty card | `:115–125` | `<Card title="Live IB state" subtitle="Today's Initial Balance, priced">` with body at 14px `"rgba(255,255,255,0.6)"`: `connected ? "Waiting for the 09:30–10:30 ET bars. The canvas builds itself as the Initial Balance forms." : "Not connected to the ES candle feed."` | Body copy says "canvas" | This is the whole render when `ib` is null |
| **G284** Card title / subtitle | `:159–162` | `title="Live IB state"`; subtitle `` `ES · IB ${low.toFixed(2)}–${high.toFixed(2)} · width ${width.toFixed(2)} pts${complete ? "" : " · still forming"}` `` | Uses `PageCard`'s `Card` **with its own `title`/`subtitle` props**, so unlike `IbStatsTab` this one gets `PageCard`'s 14px/800 uppercase `letterSpacing:"0.12em"` white title and 12px `HT.green` subtitle | — |
| **G285** Keyframes | `:163` | `<style>{`@keyframes ibBrokenPulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>` — an **unscoped global `@keyframes` injected inline into the document** | Applied as `animation: "ibBrokenPulse 1.1s ease-in-out infinite"` | Ignores `prefers-reduced-motion` |
| **G286** Break detection | `:147–156` | `postIbBars = candles.filter(c => etMinutes >= 630).sort(by timestamp)`; loop sets `brokeUp` on the first `close > ib.high`, `brokeDown` on the first `close < ib.low`, and `firstBreak ??=` whichever came first. `backInside = broke != null && ib.last <= ib.high && ib.last >= ib.low` | The comment at `:143–146` records that the previous version read only the last bar and forgot completed breaks | No post-IB bars → `broke = null` |
| **G287** Status pill — broken | `:175–179` | Text `` `IB ${broke === "up" ? "HIGH" : "LOW"} BROKEN${backInside ? " · BACK INSIDE" : ""}` `` preceded by a 12px `▲` / `▼` glyph | `brokeColor = broke === "up" ? HT.green : HT.red`; pill `background: ${brokeColor}1F`, `border: 1px solid ${brokeColor}66`, `color: brokeColor`. **Pulses (`ibBrokenPulse 1.1s`) unless `backInside`** | — |
| **G288** Status pill — unbroken | `:181` | Text `"IB UNBROKEN"` | `background: ${LIGHT_BLUE}17`, `border: 1px solid ${LIGHT_BLUE}44`, `color: LIGHT_BLUE` | Default state |
| **G289** Status pill — forming / done | `:183–189` | Text `ib.complete ? "IB DONE" : "IB FORMING"` | Done → `bg ${HT.green}14`, `border ${HT.green}44`, `color HT.green`. Forming → `bg ${HT.orange}17`, `border ${HT.orange}55`, `color HT.orange` | Always rendered |
| **G290** Status pill — locked | `:190–194` | Rendered only when `ib.complete`: a 12px `🔒` glyph then `"LOCKED"` | `bg ${LIGHT_BLUE}12`, `border ${LIGHT_BLUE}3B`, `color LIGHT_BLUE` | Absent before 10:30 |
| **G291** Pill base style | `:168–172` | `display:inline-flex; alignItems:center; gap:7; padding:"5px 11px"; borderRadius:8; fontSize:12; fontWeight:800; letterSpacing:"0.06em"; textTransform:"uppercase"`. Row: `display:flex; flexWrap:wrap; gap:8; marginBottom:14` | All three alpha suffixes (`1F`, `66`, `17`, `44`, `14`, `55`, `12`, `3B`) are hex-alpha string concatenations onto theme colours | — |
| **G292** SVG geometry constants | `:128–138` | `W = 560`, `H = 460`, `PAD_T = 26`, `PAD_B = 26`; `top = ib.high + 2.35 × ib.width`, `bot = ib.low − 2.35 × ib.width`; `y(p) = PAD_T + ((top − p)/(top − bot)) × (H − PAD_T − PAD_B)` — i.e. a linear price→y map over 408 px of usable height. `BOX_L = 96`, `BOX_R = 300`, `LINE_R = 372` | **`2.35` is the vertical head-room factor** — chosen so the 2× extension (at ±2.0 widths) sits inside the frame with margin. Every level is drawn; nothing is clipped by design | — |
| **G293** SVG element | `:201` | `<svg viewBox="0 0 560 460" style={{width:"100%", maxWidth:560, flex:"1 1 380px"}} role="img" aria-label={`ES initial balance ladder. IB high ${high.toFixed(2)}, low ${low.toFixed(2)}, last ${last.toFixed(2)}.`}>` | **Resolution independence comes from the `viewBox`, not from any devicePixelRatio handling — there is no DPR code in this file because SVG does not need it.** A canvas rebuild in v3 must add `ctx.scale(dpr, dpr)` and size the backing store; SVG's scaling is not portable to canvas for free | — |
| **G294** Level set | `:103–113` | For `m` in `[0.5, 1, 1.5, 2]`: `up = ib.high + m×width`, `dn = ib.low − m×width`; each pushed as `{mult:m, side, price, dist: price − ib.last, prob: rates.h[String(m)] ?? null}` | `rates.h[k] = b.filter(d => d.fcb.hit[k]).length / b.length` over `b = ds.days.filter(d => d.fcb)` — **a fraction 0–1, not a percentage**, multiplied by 100 at every render site | `rates` null → `levels = []` |
| **G295** Extension lines | `:203–227` | `up` sorted **descending** by mult, `dn` **ascending**. Each: `<line x1={96} y1={y(price)} x2={372} y2={y(price)} strokeWidth={1} strokeDasharray="4 4" opacity={0.75}/>` plus `<text x={380} y={y(price)+4} fontSize={11} fontWeight={700}>` reading `` `${mult}× ${prob != null ? `(${(100*prob).toFixed(1)}%)` : ""}` `` for the up side and `` `−${mult}× …` `` (U+2212) for the down side | Stroke and fill both take the same ladder: `mult >= 1.5 → HT.red`; `mult >= 1 → HT.orange`; else `LIGHT_BLUE` | `prob == null` → the parenthesis group is an empty string, leaving `"1× "` with a trailing space |
| **G296** IB box | `:230–233` | `<rect x={96} y={y(ib.high)} width={204} height={Math.max(2, y(ib.low) − y(ib.high))} rx={2} fill={`${LIGHT_BLUE}0D`} stroke={HT.border} strokeWidth={1}/>` | `Math.max(2, …)` floors a degenerate box at 2 px | — |
| **G297** 0.25 fib line | `:234–241` | `<line x1={96} y1={y(ib.high − 0.25×width)} x2={300} y2={…} stroke={HT.green} strokeWidth={1} strokeDasharray="2 3" opacity={0.55}/>` and `<text x={100} y={y(...) − 4} fontSize={9} fill={HT.green} opacity={0.85}>0.25 fib — pullback entry</text>` | **Only the HIGH-side 0.25 level is drawn.** There is no `ibl + 0.25×width` counterpart, so on a low break the retest line points the wrong way | Always drawn, break or not |
| **G298** Midpoint | `:244–245` | `<line x1={96} y1={y(mid)} x2={372} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="5 5"/>`; `<text x={380} y={y(mid)+4} fontSize={11} fontWeight={700} fill="rgba(255,255,255,0.6)">MIDPOINT</text>` | Both are **raw rgba literals**, not theme values | — |
| **G299** IB high / low lines | `:248–251` | High: `<line x1={96} x2={372} stroke={LIGHT_BLUE} strokeWidth={2.5}/>` + `<text x={380} fontSize={11} fontWeight={800} fill={LIGHT_BLUE}>IB HIGH</text>`. Low: same geometry, `stroke={HT.orange}` + `IB LOW` in `HT.orange` | **The two IB edges are painted light-blue and orange — neither carries a directional meaning**, which is inconsistent with every other surface in this part where high = green and low = red | — |
| **G300** Live price marker | `:254–270` | `pxColor = ib.last >= ib.mid ? HT.green : HT.red`. Group: `<circle cx={260} cy={y(last)} r={4} fill={pxColor}/>`; `<circle cx={260} r={7} fill="none" stroke={pxColor} strokeWidth={1} opacity={0.35}/>`; `<line x1={182} x2={260} y1=y2={y(last)} stroke={pxColor} strokeWidth={1} strokeDasharray="3 3" opacity={0.5}/>`; `<rect x={176} y={y(last)−30} width={104} height={22} rx={7} fill={HT.panelBgStrong} stroke={`${pxColor}59`} strokeWidth={1}/>`; `<text x={228} y={y(last)−15} fontSize={11} fontWeight={800} textAnchor="middle" fill={pxColor} style={{fontVariantNumeric:"tabular-nums"}}>{last.toFixed(2)}</text>` | The x values are written as `BOX_R − 40`, `BOX_R − 118`, `BOX_R − 124`, `BOX_R − 72` — resolved above | The chip can overlap the IB HIGH line when price sits at the top of the box; nothing collision-avoids |
| **G301** Redraw trigger | React only | The picture repaints whenever React re-renders, driven by `useMemo` deps: `ib` on `[candles]`, `rates` on `[ds]`, `levels` on `[ib, rates]` | `candles` republishes at the hook's **250 ms trailing coalesce** (4 Hz), so the SVG's ~20 nodes are diffed and the four `useMemo`s re-evaluated up to four times a second, unconditionally, with no visibility gate | There is no manual refresh and no idle throttle |
| **G302** Level rail | `:274–303` | Column `flex:"1 1 260px"; minWidth:260; display:flex; flexDirection:column; gap:10`. Header row: `"Targets — "` + `broke === "up" ? "upside live" : broke === "down" ? "downside live" : "unbroken"` at 12px/800 `letterSpacing:"0.1em"` uppercase `HT.text`; right side `connected ? "LIVE" : "STALE"` at 10px/800 `letterSpacing:"0.08em"`, coloured `HT.green` / `HT.red`. Rows render `(broke === "down" ? dn : up)` | **So the rail shows the UP ladder whenever the market has not broken down** — including an unbroken session. And because `up` is sorted descending and `dn` ascending, the rail reads 2×→0.5× on an up/unbroken day and 0.5×→2× on a down day | `levels` empty → header only |
| **G303** Level rail row | `:285–302` | `{...classicCardAccentStyle, padding:"10px 12px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10}`. Left `` `${mult}× extension` `` at 14px/700 `HT.text`. Right group: price `{price.toFixed(2)}` at 12px `"rgba(255,255,255,0.5)"` tabular; distance `{dist >= 0 ? "+" : ""}{dist.toFixed(2)}` at 14px/800 tabular, coloured `dist >= 0 ? LIGHT_BLUE : HT.orange`; probability chip `{prob != null ? `${(100*prob).toFixed(1)}%` : "—"}` at 12px/800, `padding:"3px 8px"`, `borderRadius:6`, `background: ${ladderColour}22`, `color: ladderColour` | The distance colour is **sign-based, not direction-based** — on a down ladder every level is below price so every distance is negative and every one paints orange | `prob == null` → `"—"` |
| **G304** "If the break fails" panel | `:305–328` | Rendered when `rates` is truthy. `{...classicCardAccentStyle, padding:"12px 14px"}`. Heading `"If the break fails"` 12px/800 `letterSpacing:"0.08em"` uppercase `HT.orange` `marginBottom:6`. Body 12px `"rgba(255,255,255,0.62)"` `lineHeight:1.5`: `` `${(100*rates.failRate).toFixed(1)}% of breaks close back inside within 30 minutes. Of those:` `` — or an **empty string** when `failRate` is null. Then two stats side by side (`display:flex; gap:18`): `"Reach the mid"` → `rates.fadeMid` in `HT.green`, `"Full rotation"` → `rates.fadeOpp` in `HT.red`, labels 10px `"rgba(255,255,255,0.45)"` uppercase `letterSpacing:"0.06em"`, values 17px/800 tabular | `failRate = failed.length / b.length`; `fadeMid = count(fadeMid)/failed.length`; `fadeOpp = count(fadeOpp)/failed.length` (`:93–99`) — all fractions 0–1 | `failRate` null → the sentence is blank but the two stat tiles still render, orphaned under a heading and no lead-in |

---

# G-N — `useIbDirection` (DEAD in this part)

Source: `hooks/useIbDirection.ts:1–117`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **G305** Purpose and consumers | `:3–11` | Returns `number \| null` — `pHigh`, the 0–100 probability that today's HIGH breaks first. The header says it feeds "the home gauge rail" | **Imported by nothing in the staged tree.** It renders no pixel on `?tab=ibstats` | — |
| **G306** What it duplicates | `:52–115` | A verbatim re-implementation of `IbStatsTab`'s `live` memo (the IB high/low/first/bias/bucket/orbDir derivation) plus `bestSample` plus the `pHigh` calculation — third copy of `etMin`/`etDate`, second copy of `MIN_N = 40`, second copy of the width ladder | `useEsCandles(enabled, 2)`; `fetch("/data/ib-ES.json")` with deps `[enabled]` | — |
| **G307** Where it diverges | `:64–65, 107–111` | **1.** Guard is `ibBars.length < 3` (the tab has no bar-count guard at all). **2.** It does **not** compute a `pending` state, `status`, `targets`, or any rule. **3.** `bestSample` is inlined as a loop that assigns `group` and `break`s — same semantics, but the fallback is `group = days` **with no label**, so the caller cannot tell a conditioned reading from an unconditioned one | Width bucket ladder identical to G236; `IB_END` hardcoded `570 + 60` | `days` empty, `candles` empty, `ibBars.length < 3`, `width <= 0`, or `withTouch` empty → `null` |
| **G308** Port verdict | — | Do not port as a hook. If v3 wants `pHigh` on two surfaces, extract **one** pure function `pHighFor(days, todayIb)` and let both the Scanner card and the home rail call it | — | — |

---

### Colours used

Every colour value this part paints. "v3 token" is the proposal; where two v2
values carry one semantic the proposal collapses them, per em.md's rule that a
re-key is the moment to delete the drift rather than carry it over.

| v2 value | Where used in this part | Exists in v3 `tokens.css`? | Proposed v3 token |
|---|---|---|---|
| `HT.cyan` `#219EBC` | Card titles with `accent="cyan"` (Live Read, IB Read, cards 3, 13, 18) · active symbol/window button border · `"Single-side trend"` bar · Probability Engine header + symbol chip · `IbDailyResults` card title and `R#` legend keys | yes — `--color-v2-cyan` | `V2.cyan` |
| `rgba(33,158,188,0.15)` | Active symbol/window button fill | no | `alpha(V2.cyan, .15)` |
| `HT.green` `#8ECAE6` — **a light blue** | `rateColor` ≥60 · hit dots · gauge green arc · `"High first"` · family `HIGH ↑` verdict · tape chip H · `Bias` column H · `RuleCell` ✓ · `"TRADEABLE EDGE"` · `STRONG/LEAN BULLISH` · `IbLevelCanvas` IB-DONE pill, price marker above mid, `"Reach the mid"` | yes — `--color-v2-green` (v3 notes it is "a LIGHT BLUE") | **`MOVE_UP`** → `--color-move-up` `#35c28e` |
| `POS` `#1FD98A` | Probability Engine `"Bullish Edge"` gauge ring and centre number, `EDGECOL.bull`, `TAG` chip, the (dead) "Live" chip | yes — `--color-v2-refresh` `#1fd98a` | **`MOVE_UP`** — see the note below |
| `HT.red` `#EF4444` | `rateColor` ≤40 · miss dots (at 55% opacity) · gauge red arc · `"Low first"` · family `LOW ↓` · tape chip L · `Bias` L · `RuleCell` ✗ · `"FADE SETUP"` · `STRONG/LEAN BEARISH` · error banners in G13 and G221 · `IbLevelCanvas` down-break pill, price marker below mid, `"Full rotation"` · card-9 WIDE label | yes — `--color-v2-red` | **`MOVE_DOWN`** → `--color-move-down` `#e0645f` |
| `NEG` `#FF3B3B` | Probability Engine `"Bearish Edge"` gauge ring and centre number, `EDGECOL.bear` | no | **`MOVE_DOWN`** — see the note below |
| `HT.orange` `#FB8501` | `rateColor` 40–60 · `"NO EDGE"` / `"CONTEXT"` / `NEUTRAL` verdicts · `"Contained range (none)"` bar · hero family border and badge · rotation gauge ring · `"10:30 Close"` chip · tape chip when `firstTouchSide` is null · `IbLevelCanvas` IB-FORMING pill, IB LOW line, negative-distance figures, `"If the break fails"` heading · card-9 NORMAL label | yes — `--color-v2-orange` | `V2.orange` — or `--color-warn` `#e0a44a` if the tab drops its v2-parity requirement |
| `rgba(251,133,1,0.08)` | Hero (Conflict Watch) family plate fill — `HT.orange` at 8%, typed as a literal | no | `alpha(V2.orange, .08)` |
| `HT.purple` `#126783` | `"Rotational chop (both)"` bar · `IbDailyResults` `Break = BOTH` cell · card titles with `accent="purple"` (cards 4, 12, 17) | yes — `--color-v2-purple` | `V2.purple` |
| `LIGHT_BLUE` `#7dd3fc` | `sectionRow` · `"LAST 5 SESSIONS"` label · `"THE RULES"` heading · `"HIT RATE"` footer label · card titles with `accent="blue"` (cards 1, 5) · `IbLevelCanvas` IB-UNBROKEN / LOCKED pills, IB HIGH line, 0.5× ladder colour, positive-distance figures, IB box fill `#7dd3fc0D` | partial — `--color-v2-lightblue` is `#7ed3fc` (one digit off; v3's note explains why) | `V2.lightblue` — **confirm the `7d` vs `7e` difference is intentional for this surface** |
| `HT.text` `#FFFFFF` | Every label, every stat value, every un-coloured cell | yes — `--color-fg` | `T.text` |
| `#fff` (raw literal, twice) | `Gauge` needle stroke and hub fill (`IbStatsTab.tsx:475, 477`) | yes | `T.text` — collapse with the row above |
| `HT.border` `rgba(255,255,255,0.10)` | Card edge · family plate edge · member pill edge · Probability Engine card and row edges · `IbLevelCanvas` IB box stroke · `"THE RULES"` divider | no exact | `alpha(T.text, .10)` — **not** `--color-line`, which is opaque `#23272e` |
| `HT.panelBg` `rgba(13,17,25,0.45)` | Card surface (`classicCardAccentStyle`) · non-hero family plates · member pills · Probability Engine card | no exact | `alpha(V2.panel, .45)` |
| `HT.panelBgStrong` `rgba(13,17,25,0.72)` | `IbLevelCanvas` live-price chip fill | no exact | `alpha(V2.panel, .72)` |
| `rgba(255,255,255,0.03)` | `Stat` tile fill · Live Read verdict plate · the three Live Read sub-panels · Probability Engine `rowBg` | no | `alpha(T.text, .03)` |
| `rgba(255,255,255,0.05)` | Probability Engine `R#` id chip fill | no | `alpha(T.text, .05)` |
| `rgba(255,255,255,0.06)` | `td` `borderTop` (every table row separator) · `EdgeBar` track | no | `alpha(T.text, .06)` |
| `rgba(255,255,255,0.07)` | `Bar` track · Probability Engine `C.track` (gauge ring backing) | no | `alpha(T.text, .07)` |
| `rgba(255,255,255,0.08)` | `Stat` tile border · Live Read sub-panel borders · dead `PlaybookLegacy` neutral border | no | `alpha(T.text, .08)` |
| `rgba(255,255,255,0.10)` | `Gauge` track stroke · `"THE RULES"` `borderTop` | no exact | `alpha(T.text, .10)` — same value as `HT.border`, written two different ways |
| `rgba(255,255,255,0.15)` | Inactive symbol/window button border · the strip divider · both disclosure-button borders | no | `alpha(T.text, .15)` |
| `rgba(255,255,255,0.35)` | `IbLevelCanvas` midpoint line stroke | no | `alpha(T.text, .35)` |
| `rgba(255,255,255,0.45)` | `IbLevelCanvas` fail-panel stat labels | no | `alpha(T.text, .45)` |
| `rgba(255,255,255,0.5)` | `IbLevelCanvas` rail price figure | no | `alpha(T.text, .50)` |
| `rgba(255,255,255,0.55)` | Probability Engine `C.muted` (strapline, gauge labels, "Hist. Edge", zero-value gauge) | no | `alpha(T.text, .55)` |
| `rgba(255,255,255,0.6)` | `IbLevelCanvas` empty-card body · MIDPOINT label fill | no | `alpha(T.text, .60)` |
| `rgba(255,255,255,0.62)` | `IbLevelCanvas` fail-panel body copy | no | `alpha(T.text, .62)` — collapse with `.60` above |
| `rgba(255,255,255,0.82)` | Probability Engine `RuleRow` description text (dead on this tab) | no | `alpha(T.text, .82)` |
| `#6B7686` | Probability Engine `C.grey` — `EDGECOL.off`, the "Inactive" tag (dead on this tab) | no | `--color-flat` `#7a828d` |
| `rgba(0,0,0,0.22)` | Card `boxShadow` from `classicCardStyle` | `--color-shadow` is `#000000` | `alpha(T.shadow, .22)` |
| Opacity-only steps `0.4 / 0.55 / 0.6 / 0.62 / 0.7 / 0.85` | `"no history"` label, miss dots, tape chip sub-lines, family sub-lines, extension lines, `RuleCell` dashes, `RuleRow` dimming | n/a | Keep as opacity; do not mint tokens |

**The two-greens / two-reds collapse.** This part paints "positive" in
`#8ECAE6` (a light blue that v2's own token file admits is not a green) **and**
in `#1FD98A`, and "negative" in `#EF4444` **and** `#FF3B3B` — in two cards that
sit one above the other on the same screen, saying the same thing. Worse,
`IbProbabilityEngine.tsx:37–39` documents the split as deliberate ("real green,
true red (not pink)"), which means the engine card was written to *disagree*
with the card above it. Re-keying every one of the four onto `MOVE_UP` /
`MOVE_DOWN` makes the distinction disappear rather than carrying it over. The
rows above record what v2 did; the right-hand column is what should ship.

**The three `rateColor` copies collapse too.** `IbStatsTab.tsx:102–106`,
`IbDailyResults.tsx:134` and `IbDailyResults.tsx:231` are the same four
branches with the same boundaries, typed three times. v3 ships **one**
`rateColor(p)` and both files import it — the same move em.md made with
`hitRateColor()`.

---

### Do not port

1. **`PlaybookLegacy`** (`IbStatsTab.tsx:1206–1352`). Marked `@deprecated` in
   its own docblock, wrapped in an `eslint-disable`, rendered by nothing. It
   carries an 11-setup builder, a `n >= 15` filter, a `"thin sample"` flag at 40,
   and a **fourth** rate-colour ladder. Delete it; do not translate it.
2. **`RuleBoard`** (`IbStatsTab.tsx:1097–1202`). A complete card — 7 stat tiles,
   a 4-column table, two section headers, a 3-sentence footnote — rendered by
   nothing since `LiveToday` was cut to three cards (`:428`). It is the only
   consumer of `live.status` and of the `sideChip` helper, both of which die with
   it. If v3 wants an "In Play Right Now" table, write it fresh against the row
   list in G-I rather than reviving this.
3. **`IbLevelCanvas.tsx`** in its current form. Imported by nothing; hardcoded to
   ES and to the 60-minute window; blends sessions (G282); draws only the
   high-side 0.25 fib (G297); and violates **v3 non-negotiable 5** outright —
   `useEsCandles(true, 1)` with no visibility gate, so it holds a live
   subscription and re-renders at 4 Hz off-screen. **Non-negotiable 6 is not met
   either**: no `data-cb-layer` on the `<svg>`. If the level ladder is wanted in
   v3, rebuild it through `ChartFrame` (non-negotiable 4) with `handle.visible()`
   gating the subscription and `data-cb-layer` on the canvas.
4. **`useIbDirection.ts`**. Third copy of `etMin`/`etDate`, second copy of
   `MIN_N`, second copy of the width ladder, second copy of `bestSample`. Extract
   one pure `pHighFor()` instead (G308).
5. **`failOutcome` and `rate` in `lib/ibStats.ts`** (`:483–493`, `:508`).
   Exported, documented at length, called by nothing. `rate` is a duplicate of
   `rateNum`. Port `failOutcome` only when a surface actually renders the four
   outcomes.
6. **`parseCsv` / `buildDays` / `enrich` / `analyzeBreak`** (`lib/ibStats.ts:81–390`).
   These belong to the offline exporter, not to the browser bundle. v3 should
   keep them out of the page chunk entirely — they are ~310 lines of dead weight
   behind a barrel import today.
7. **`tdDim`** (`IbStatsTab.tsx:118`). `{...td, fontSize: 14}` where `td` is
   already 14 — a no-op override whose name promises a visual difference that
   does not exist.
8. **The `accent` prop plumbing.** `PageCard`'s `Card` documents `accent` as
   ignored (`PageCard.tsx:23–34`), and `IbStatsTab`'s local `Card` re-implements
   it as a title colour only. Six accent names drive six title hues across 16
   cards with no semantic rule — cards 3/13/18 are cyan, 7/10/14/16 green,
   8/15/19 orange, 11/20 red, 4/12/17 purple, 1/5 blue. In v3 a card title is a
   card title; pick one token and drop the prop.
9. **Colour literals.** Every value in the table above that is not already in
   `tokens.css` violates **non-negotiable 1**. The two raw `#fff` needle/hub
   fills and the `rgba(251,133,1,0.08)` hero fill are the most obvious; the
   fifteen white-alpha steps are the bulk.
10. **Type sizes off the v3 scale.** This part paints at 9, 9.5, 10, 11, 12,
    12.5, 13, 14, 17, 20, 22, 24, 26, 28 and 34 px. v3's scale is 9 / 10 / 11 /
    13 / 15 / 18 / 24 / 32 (`tokens.css`). Every one of 12, 12.5, 14, 17, 20, 22,
    26, 28 and 34 needs re-keying, and 9.5 does not exist at all.
11. **The request pattern.** Four independent `fetch` calls fire from three
    components on this tab — the dataset (G9), the last-5 tape (G122), the
    daily-results table (G220) and, in the dead canvas, a second copy of the
    dataset (G280). The tape fetch and the daily-results fetch hit the **same
    endpoint with different `limit` values** and neither shares a cache. Under
    **non-negotiable 3** a v3 route fires everything in parallel at entry: one
    `/api/ib-results?symbol=X&limit=90` call, sliced locally for the 5-day tape.
12. **`engineSnapRef` written during render** (`IbStatsTab.tsx:421–423`). A ref
    mutation in the render phase, not an effect. It also does not survive a
    remount, so the "frozen at the IB close" snapshot silently re-freezes at
    whatever the state is when you come back to the tab.
13. **The `hist` object literal** (`IbStatsTab.tsx:1558–1564`), which changes
    identity every render and therefore defeats the `live` `useMemo` it is a
    dependency of. Memoise it, or pass the two scalars.
14. **`conf.includes(d)` inside a `.filter`** (`IbStatsTab.tsx:1464`) — O(n²)
    over ~2,300 sessions, re-run on every render of the owner block, which has no
    `useMemo` anywhere. Use a `Set`.
15. **`useEsCandles(sym === "ES", 2)` with `withAverages` defaulted true**
    (`IbStatsTab.tsx:202`). Two full `buildSlotAverages` passes per republish for
    fields this tab never reads. Pass `withAverages: false`.
16. **`useNqCandles`' own WebSocket.** `useEsCandles` shares one socket through
    `lib/gexSocket`; `useNqCandles` opens its own (`useNqCandles.ts:76–77`).
    Under **non-negotiable 2** neither belongs on a page at all — v3 reads
    `useFrame` / `useField` / `watchFrame` from `src/data/hooks.ts`.
17. **The unscoped `@keyframes ibBrokenPulse`** injected as an inline `<style>`
    (`IbLevelCanvas.tsx:163`), which also ignores `prefers-reduced-motion`.
    v3's `tokens.css` already carries the global reduced-motion rule; a keyframe
    belongs there, not in a component.
18. **`dangerouslySetInnerHTML`** at three sites: `Tbl`'s `footNote`
    (`IbStatsTab.tsx:147`), the Probability Engine's gauge labels
    (`IbProbabilityEngine.tsx:120`), and by extension every footnote string that
    embeds `<b>` / `<i>`. The gauge-label case exists purely to get a `<br/>`.
    None of the content is user-supplied, so it is not a live XSS, but none of it
    needs raw HTML either.
19. **Prose that lies about the code.** Port the code, fix the strings: the
    `RULE_CLAIM["12"]` legend says "inner 30m ORB" where every implementation
    uses 09:30–09:45 (G234); `IbStatsTab.tsx:58–60` claims card titles are the
    only non-white text (they are not); the IB Read subtitle says "the 14 rules"
    where the board carries 15 on a weekday (G119); and `"Waiting on the 10:30 ET
    close."` (G110), the `"10:30 Close"` chip (G149) and the `IbDailyResults`
    title `"IB 60m (09:30–10:30 ET)"` (G222) are all hardcoded to the 60-minute
    window while the selector above them offers four.
20. **Five timing ladders for one concept** (G242). Collapse to one
    `breakTimeBucket(min, rangeEnd)` and use it in the prose, the scoring
    condition, the EOD note and the card-19 windows alike.

---

### Open questions for Brandon

- **Q1 — the owner gate's second path.** `IbStatsTab.tsx:1379` compares
  `useAuth().userId` to `NEXT_PUBLIC_OWNER_USER_ID`, while
  `components/shared/useIsOwner.ts:29` compares `useAuth().user?.id`.
  `AuthProvider` is not in the staged tree, so I cannot tell whether `userId`
  exists on the context. If it does not, the env-var fallback on this tab has
  never fired and the historical stats have only ever been reachable via
  `isOwnerClaim`. Which field is real?
- **Q2 — do the ORB windows actually have datasets?** The window selector offers
  four, but only `/data/ib-<SYM>.json` is referenced anywhere else in the tree
  (`IbLevelCanvas.tsx:62`, `useIbDirection.ts:41`). If `orb30/orb15/orb5` have
  never been exported, three of the four buttons lead straight to the "dataset
  not found" card and v3 should ship one window until they exist.
- **Q3 — `noMidReturn` and `fvgHitMid`.** Both are declared on `SlimDay`
  (`lib/ibStats.ts:438–439`) and rendered by cards 8 and 12, but nothing in the
  repo computes them — they come only from `ib-backtest-esu6.html`'s `slim()`.
  Are they present in the shipped JSON? If not, card 8's "Never trades back to
  the IB midpoint" row and card 12's `mid:` details have been rendering 0.0% in
  red as if measured.
- **Q4 — which "contained" definition is correct?** `lib/ibStats.ts:234–237` is
  wick-based; `lib/ibDaily.ts:202` and `IbStatsTab.tsx:373` are close-based. The
  live rule 14 therefore asks a question the historical rate it quotes was not
  measured on. Same question for `first`'s tie-break (G255 vs G57) and for
  `retest` (G270 vs G71). Pick one definition per concept for v3.
- **Q5 — the `Gauge` arc saturation** (G94/G95). Both semicircle arcs are given
  `strokeDasharray={125}` — the full semicircle length — on quarter-arc paths
  whose real length is ≈62.8, so the winning side's arc is fully drawn for every
  reading past 50%. Is the intended reading "two arcs that meet at the needle",
  or is the needle alone meant to carry the value? The fix changes what the
  gauge looks like, so it is a design call, not a bug fix.
- **Q6 — the wick-only row's hardcoded `hits={0}`** (`IbStatsTab.tsx:1744`,
  G191). It renders a red `0.0%` in a Rate column beside two measured rates. Was
  a real metric intended there (e.g. "of wick-only days, how many later got a
  close break"), or should the row show `"—"`?
- **Q7 — the NARROW threshold caption** (`IbStatsTab.tsx:1709`, G188). It quotes
  `Math.min(0.5×ATR, 0.75×avgIB)` where the OR in the classifier makes the
  effective boundary `Math.max`. Is the caption meant to be conservative on
  purpose, or should it be `Math.max` to match what the code classifies?
- **Q8 — should the Probability Engine weight by sample size?** `engineRules`
  strips `n` before handing rules to the engine (G75), and
  `calculateComplexProbabilities` weights every in-play rule at a flat 1.5. A
  rule matching 12 sessions moves the gauges exactly as hard as one matching 900.
  Intentional simplicity, or a gap?
- **Q9 — rotation as a rounding residual** (G157). `rot = 100 − round(bull) −
  round(bear)` can come out negative, which renders as a `-1%` label over an
  empty ring. Clamp at 0, or round all three and normalise?
- **Q10 — is `IbLevelCanvas` wanted at all?** It is dead code today, but it is
  the only surface in the tab that prices the extension levels in points rather
  than quoting a percentage. If it should come back in v3, it needs a symbol
  prop, a window prop, the missing low-side 0.25 line, and the visibility gate.

**Part G row count: 308**
# Part H — Watch This (`?tab=watch`)

**Scope.** The v2 tab `/scanner?tab=watch`, which is:

| Layer | File | Lines |
|---|---|---|
| Tab registration | `components/scanner/scannerNav.ts` → `SCANNER_TABS[6]`, `SCANNER_GROUPS` group `"more"` | 49–63, 104–108 |
| Tab mount | `components/pages/Scanner.tsx` → `{visibleTab === "watch" && <WatchThisScanner />}` | 3097 |
| Types | `Scanner.tsx` — `WatchRow`, `OutcomeRow`, `OutcomeView`, `OutcomeSortKey`, `OutcomeSort`, `DayBucket`, `OutcomeDetailDay`, `OutcomeDetail` | 910–1114 |
| Sorting | `sortOutcomes`, `STATUS_RANK`, `OUTCOME_SORT_VALUE`, `defaultOutcomeSort`, `OutcomeTh` | 968–1047 |
| Day grouping | `ymd`, `groupOutcomesByDay`, `outcomeKey` | 1057–1114 |
| Probe card helpers | `PROBE_*` constants, `probeTone`, `probePx`, `probeStats`, `probeExp` | 1123–1164 |
| PNG capture | `captureFlagCard` | 1175–1256 |
| Chart | `ProbeChart` | 1280–1442 |
| Expanded row | `OutcomeDetailPanel` | 1449–1637 |
| Tab body | `WatchThisScanner` | 1639–2046 |
| Results view | `RESULT_SECTIONS`, `ResultsByDay` | 2050–2221 |
| Shared styles | `components/scanner/scannerStyles.ts` → `th`, `td`, `seg`, `fmtB` | 18–37 |
| Card chrome | `components/shared/PageCard.tsx` → `Card variant="budget"` | 84–145 |

**Not in scope but read for this part:** `components/scanner/ProbeButton.tsx` — see
row H207 in **Do not port**. It is dead relative to this tab (nothing imports it
anywhere in the tree).

**Shared style objects referenced by name below** (`scannerStyles.ts`):

- `th` = `padding: 6px 10px · textAlign right · fontWeight 700 · letterSpacing .05em`
- `td` = `padding: 6px 10px · textAlign right · color HOME_THEME.text (#FFFFFF)`
- `seg(active)` = `padding 6px 14px · radius 8 · fontSize 14 · fontWeight 700 · cursor pointer · border 1px ${active ? #219EBC : rgba(255,255,255,0.15)} · background ${active ? rgba(33,158,188,0.15) : transparent} · color ${active ? #FFFFFF : rgba(255,255,255,0.7)}`
- `fmtB(n)` = sign is **always explicit** (`"-"` when `n < 0`, otherwise `"+"`, including for `0`); `|n| ≥ 1e9 → (a/1e9).toFixed(2)+"B"`; `≥ 1e6 → (a/1e6).toFixed(1)+"M"`; `≥ 1e3 → (a/1e3).toFixed(1)+"K"`; else `a.toFixed(0)`.

**Colour names used below.** `HT` = `HOME_THEME` (`components/shared/homeTheme.ts`).
`HT.green` is **`#8ECAE6`, a light blue, not a green** — it is used as the
positive/up colour throughout this tab and also as every table's header colour.
`LIGHT_BLUE` = `#7dd3fc` (`homeTheme.ts:88`). The probe card carries its own
eight hardcoded literals (`PROBE_*`, lines 1123–1130) that deliberately bypass
the theme — see H183 and H213.

---

## H.0 — Tab registration and mount

Source: `scannerNav.ts:49–63, 104–108`; `Scanner.tsx:50, 3049–3097`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H1** Tab pill label | `SCANNER_TABS` entry `{ id: "watch", label: "Watch This", short: "Watch", color: LIGHT_BLUE, icon: "👁️" }` | Full bar uses `"Watch This"`; the GlobalToolbar sub-strip uses `"Watch"` with the `👁️` glyph | Pill accent `LIGHT_BLUE` `#7dd3fc` | Always drawn — the entry has **no `ownerOnly`**, so `OWNER_ONLY_TABS` never contains `"watch"` and no auth gate applies |
| **H2** Tab group | `SCANNER_GROUPS` → `{ key: "more", tabs: ["watch"], routes: ["/level-log"] }` | Last cluster in the sub-strip, sharing a divider with the `/level-log ↗` route | — | — |
| **H3** Deep link | `readTabFromUrl()` in a mount effect (`Scanner.tsx:3070–3073`) — `new URLSearchParams(window.location.search).get("tab")` validated by `isScannerTabId` | `/scanner?tab=watch` | Runs in an effect, **not** `useSearchParams` — the page first paints the default tab `"gexchangetop"` and swaps on mount | An invalid/absent `?tab=` leaves the default `"gexchangetop"`; the Watch tab never mounts and none of its fetches fire |
| **H4** In-page tab switch | `SCANNER_TAB_EVENT` = `"cb:scanner-tab"` `CustomEvent` listener (`Scanner.tsx:3080–3086`) | The toolbar strip fires it because a query-only navigation does not remount the page | — | — |
| **H5** Mount gate | `{visibleTab === "watch" && <WatchThisScanner />}` | Hard unmount — leaving the tab **destroys all state**: rows, outcomes, sort, `openDay`, `openRow`, the loaded detail, and clears both poll intervals | `visibleTab` is `null` only while auth is unresolved on an owner-gated tab; `"watch"` is not owner-gated so this never blanks it | Returning to the tab re-runs every fetch from scratch |

---

## H.1 — Card frame and header

Source: `Scanner.tsx:1811–1812`; `PageCard.tsx:84–145`; `homeTheme.ts:176–189`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H6** Card surface | `<Card variant="budget">` → `classicCardAccentStyle` | `background HT.panelBg rgba(13,17,25,0.45) · backdropFilter blur(16px) (+ `-webkit-`) · borderRadius 18 · border 1px rgba(255,255,255,0.10) · boxShadow 0 18px 40px rgba(0,0,0,0.22) · padding 24` (the `padding` default) | `variant="budget"` and `"gloss"` resolve to the SAME style object — no top accent strip | Always renders; the whole tab is one card |
| **H7** Card hover | `className="card-hover"` added by `Card` for every non-`dissolve` variant | Global CSS class, not inline | — | — |
| **H8** `"Watch This — Far CB"` | Static, wrapped as `<span style={{ fontSize: 17 }}>` | Card title row is `fontSize 14 · fontWeight 800 · letterSpacing .12em · textTransform uppercase · color HT.text #FFFFFF`; the inner span overrides size to **17px**. Rendered text is therefore `WATCH THIS — FAR CB` (em dash, uppercased by CSS) | none | Always renders |
| **H9** Subtitle | `` `Highest GEX strike within 30d expirations, far OTM vs spot · scanner universe${threshold != null ? ` · >${threshold}% OTM` : ""}${loading ? " · refreshing…" : ""}` `` — `threshold` is `/proxy/far-cb-watch → j.threshold` | `fontSize 12 · color HT.green #8ECAE6`. `threshold` is printed **raw**, no rounding, no `toFixed` | The `· >N% OTM` clause is omitted entirely when the endpoint returns no `threshold` (`?? null`) | `loading` initialises to `true`, so the FIRST paint always ends `· refreshing…`; every 2-minute poll re-adds it because `load()` sets `setLoading(true)` |

---

## H.2 — Toolbar row (refresh)

Source: `Scanner.tsx:1814–1819`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H10** Toolbar row | — | `flex · alignItems center · gap 12 · marginBottom 12 · flexWrap wrap` | none | Always renders |
| **H11** `"↻ Refresh"` | `onClick={() => load()}` | `seg(false)` — always the inactive style, it never highlights | Never active; not disabled while loading, so it can be re-fired mid-flight | Always enabled |
| **H12** `"Refreshes every 2m · recorder sweeps every 30m during RTH"` | Static string | `fontSize 14 · color HT.text #FFFFFF` | none | Always renders. The "2m" matches the code (`120_000` ms); the "30m during RTH" is a claim about the server-side recorder that this file cannot verify |

---

## H.3 — Add-a-ticker row

Source: `Scanner.tsx:1729–1748, 1821–1842`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H13** Row container | — | `flex · alignItems center · gap 8 · marginBottom 16 · flexWrap wrap` | none | Always renders |
| **H14** Ticker input | `newTicker` state, raw keystrokes (no uppercasing on change) | `fontSize 14 · padding 7px 10px · radius 6 · width 160 · background rgba(0,0,0,0.30) · color HT.text · border 1px rgba(255,255,255,0.15) · colorScheme dark`; `maxLength={6}` | none | Placeholder `"Add a ticker (e.g. RDDT)"` |
| **H15** Input Enter key | `onKeyDown` → `if (e.key === "Enter") addTicker()` | Fires the POST directly; there is no `<form>` | Fires even while `adding` is true — the button's `disabled` does not guard this path, so Enter can double-post | — |
| **H16** `"+ Add"` / `"Adding…"` | `adding` state | `seg(false)` — always inactive style. Label is `"Adding…"` while the POST is in flight, `"+ Add"` otherwise | `disabled={adding \|\| !newTicker.trim()}` — no visual dimming is applied, only the native disabled attribute | Disabled on first paint (empty input) |
| **H17** Add — request | `fetch("/api/far-cb-tickers", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ symbol }) })` where `symbol = newTicker.trim().toUpperCase()` | Bails silently (`return`, without clearing `addStatus`) when the trimmed value is empty | `!res.ok` → throws `j.error \|\| "Add failed"` | — |
| **H18** Add — success message | `` `${symbol} added — appears after the next sweep.` `` | `fontSize 14 · color LIGHT_BLUE #7dd3fc` | `addStatus.kind === "ok"` | Input is cleared (`setNewTicker("")`); the message **never auto-dismisses** — it persists until the next add attempt |
| **H19** Add — error message | `String(e?.message \|\| e)` | `fontSize 14 · color HT.red #EF4444` | `addStatus.kind === "err"` | Input is NOT cleared on failure; message persists |
| **H20** Add — refresh behaviour | — | **Nothing refetches.** A successful add does not call `load()`; the added ticker only appears when the 2-minute poll happens to run after the server's next sweep | — | — |

---

## H.4 — Error and empty states of the flag grid

Source: `Scanner.tsx:1844–1856`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H21** Error banner | `err` state from `load()` | `color HT.orange #FB8501 · marginBottom 12 · fontSize 14`. No background, no border, no padding — bare text | Rendered whenever `err` is truthy, **including while `loading` is true** (no `!loading` guard) | — |
| **H22** Error text — recorder not run | `err.includes("no DB") \|\| err.includes("503")` | `"Recorder hasn't run yet — data appears after the first RTH sweep."` | Substring match on the raw message, **not** on `res.status` | — |
| **H23** Error text — non-JSON body | `` `Server returned ${res.status} (non-JSON).` `` | Thrown when `JSON.parse(text)` fails | A 503 HTML error page hits H22 via the `"503"` substring in this very string | — |
| **H24** Error text — `ok:false` | `j.error \|\| "load failed"` | Verbatim server string | — | — |
| **H25** Empty grid | `!rows.length && !loading && !err` | `"Nothing flagged right now — no watchlist ticker has an unusually far-OTM dominant CB level."` — `padding 24 · textAlign center · color HT.text` | Requires all three: no rows, not loading, no error | Suppressed on the very first paint because `loading` starts `true` |
| **H26** Loading state | — | **There is none.** No spinner, no skeleton. The only loading affordance is the `· refreshing…` suffix on the card subtitle (H9). Old `rows` stay on screen through a refresh | — | — |

---

## H.5 — Flag cards (the `WatchRow` grid)

Source: `Scanner.tsx:1858–1906`. `WatchRow` fields: `symbol, strike, expiry,
gex_value, gex_value_vol?, spot, otm_pct, dte_days, date`. **`row.date` is never
rendered.**

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H27** Grid | — | `display grid · gridTemplateColumns repeat(auto-fill, minmax(240px, 1fr)) · gap 12` | none | Renders as an empty grid (zero height) when `rows` is empty |
| **H28** Card plate | React key `` `${r.symbol}-${r.expiry}-${r.strike}` `` | `borderRadius 12 · padding 14px 16px · background rgba(13,17,25,0.20) · backdropFilter blur(20px)` — **no border** | none | — |
| **H29** `up` flag | `const up = r.gex_value >= 0` | Drives four colours on the card | `>= 0` (inclusive) → `HT.green #8ECAE6`; `< 0` → `HT.red #EF4444` | — |
| **H30** Symbol | `r.symbol` | `fontWeight 800 · fontSize 14` | Colour per H29 | — |
| **H31** Spot | `` `$${r.spot.toFixed(2)}` `` | `fontSize 14 · fontWeight 700 · opacity 0.85` | Colour per H29 | Not guarded — a null `spot` would throw |
| **H32** `"WATCH THIS"` | Static string | `fontSize 14 · fontWeight 800 · letterSpacing .05em · color LIGHT_BLUE #7dd3fc` | Always the same colour; it is a label, not a state | Always renders on every card |
| **H33** Strike | `` `$${r.strike}` `` | **Raw number, no `toFixed`** — `5900` prints `$5900`, `5902.5` prints `$5902.5` | `fontSize 14 · color LIGHT_BLUE · fontWeight 700` | — |
| **H34** Expiry + DTE | `` ` · ${r.expiry} · ${r.dte_days}d` `` | Server string passed through unformatted (whatever `expiry` is, e.g. `2026-09-18`); DTE is an integer with a `d` suffix | `color HT.text · fontWeight 400` (inside the strike line) | — |
| **H35** Body sentence | `` `Highest GEX level for ${r.symbol} is the $${r.strike} strike (${r.expiry}), ${r.otm_pct.toFixed(0)}% away from spot ($${r.spot.toFixed(2)}) — farther out than the usual near-the-money CB. ${up ? "Call-side" : "Put-side"} dominant.` `` | `fontSize 14 · color HT.text · lineHeight 1.5 · marginBottom 8`. `otm_pct` is **0 dp**; `spot` is 2 dp | `"Call-side"` when `gex_value >= 0`, `"Put-side"` when `< 0` | — |
| **H36** `"OI+VOL "` label | Static, trailing space | `color HT.text · opacity 0.6 · fontWeight 600 · fontSize 14` | none | — |
| **H37** OI+Vol GEX value | `fmtB(r.gex_value)` | e.g. `+1.24B`, `-350.0M`, `+42` — sign always shown | `fontSize 14 · fontWeight 700`, colour per H29 (`gex_value >= 0`) | Never `"—"`; the field is required on `WatchRow` |
| **H38** `"VOL "` label | Static, trailing space | Same as H36 | none | — |
| **H39** Vol-only GEX value | `r.gex_value_vol != null ? fmtB(r.gex_value_vol) : "—"` | Same `fmtB` format | Colour on `(r.gex_value_vol ?? 0) >= 0` → `HT.green` else `HT.red`. **A null value is coloured green** (`?? 0` → `0 >= 0`) even though the text is `"—"` | `"—"` when null/undefined |
| **H40** `"View chain →"` | `href = /options-chain?symbol=${encodeURIComponent(r.symbol)}&expiry=${encodeURIComponent(r.expiry)}&strike=${r.strike}` | `fontSize 14 · color LIGHT_BLUE · fontWeight 700 · textDecoration none`. **`strike` is NOT `encodeURIComponent`d** — a plain number, so it is safe in practice | `target="_top"` + `rel="noopener"` when `isEmbed`, otherwise both attributes are `undefined` | Always renders on every card |
| **H41** `isEmbed` | Mount effect: `new URLSearchParams(window.location.search).get("embed") === "1"` | Boolean | First paint is always `false` (effect runs after mount), so a hard refresh inside the GexDock iframe renders one frame with an in-iframe link | — |

---

## H.6 — Basis footer

Source: `Scanner.tsx:1908–1911`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H42** Footer row | — | `marginTop 14 · flex · gap 20 · flexWrap wrap · fontSize 14 · color HT.text` | none | Always renders, even with zero rows |
| **H43** `"Basis: OI+Vol net GEX (canonical) · single highest \|GEX\| strike per ticker across expiries ≤30 DTE"` | Static string | Literal `≤` and `\|GEX\|` glyphs | none | Always renders |
| **H44** `"Flagged when that strike is >N% away from spot"` | `` `Flagged when that strike is &gt;${threshold ?? 15}% away from spot` `` | The `>` is written as the `&gt;` entity in JSX | **The only client-side threshold literal in this tab is the fallback `15`.** The live number is `/proxy/far-cb-watch → j.threshold`; the client neither computes nor validates it | When the endpoint omits `threshold`, this prints `>15%` while the subtitle (H9) drops its threshold clause entirely — the two disagree on screen |
| **H45** THE SELECTION RULE — as the code states it | `/proxy/far-cb-watch?limit=50` (server-side; **no selection code exists in this repo**) | The client's own words for the rule are H43 + H44: *single highest `\|GEX\|` strike per ticker, over expiries `≤ 30 DTE`, on the OI+Vol canonical net-GEX basis, flagged when that strike is more than `threshold`% away from spot; universe = the scanner watchlist plus anything POSTed to `/api/far-cb-tickers`; max 50 rows* | **Code-vs-comment conflict, code wins:** the block comment at `Scanner.tsx:906–907` says *"highest GEX strike"*, the rendered footer says *"highest `\|GEX\|` strike"* (absolute value). The rendered string is what the user reads and is the one to carry over. Separately, `up = r.gex_value >= 0` proves rows can carry **negative** `gex_value`, which only an absolute-value ranking would produce — so `\|GEX\|` is the behaviour, not the comment | The comparison is strictly `>` (`"is >N% away"`), never `>=`. Neither the 30-DTE bound nor the OTM threshold is enforced client-side — the client renders whatever rows the endpoint returns |

---

## H.7 — Tracked results header + view selector

Source: `Scanner.tsx:1913–1929`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H46** Section divider | — | `marginTop 24 · paddingTop 18 · borderTop 1px solid rgba(255,255,255,0.08)` | none | Always renders |
| **H47** `"Tracked results"` | Static string | `fontSize 17 · fontWeight 800 · color HT.text` — sentence case, no uppercase transform | none | Always renders |
| **H48** View buttons — set + order | `(["all","open","touched","expired","results"] as const)` | Labels are `s[0].toUpperCase() + s.slice(1)` → **`"All" · "Open" · "Touched" · "Expired" · "Results"`**, in that order, `gap 6` | `seg(outcomeStatus === s)` — active: border `#219EBC`, bg `rgba(33,158,188,0.15)`, colour `#FFFFFF`; inactive: border `rgba(255,255,255,0.15)`, bg transparent, colour `rgba(255,255,255,0.7)` | Default `"all"` (`useState<OutcomeView>("all")`). **Not persisted** — no localStorage, no URL param; every remount resets to `"all"` |
| **H49** View change — refetch | `loadOutcomes` is a `useCallback` keyed on `outcomeStatus`, and `useEffect(() => { loadOutcomes(); }, [loadOutcomes])` | Every non-`results` view change fires `GET /proxy/far-cb-outcomes?status=<view>&limit=100` | `"results"` short-circuits `loadOutcomes` (`if (outcomeStatus === "results") return;`) and instead fires `loadResults()` | The previous view's rows stay on screen until the new response lands — there is no clear-on-change |
| **H50** View change — sort reset | `useEffect(() => { setSort(defaultOutcomeSort(outcomeStatus)); }, [outcomeStatus])` | Any manual sort is discarded on every view switch, including switching to `"results"` and back | See H65–H69 for the per-view defaults | — |
| **H51** Hint line — `"results"` view | Static | `"One row per date · how many flags opened, were touched, and expired that day · click a date to expand"` — `fontSize 14 · color HT.text` | `outcomeStatus === "results"` | Always renders |
| **H52** Hint line — all other views | Static | `"Graded daily ~16:10 ET · no win/loss — just whether spot reached the strike · Entry = the flagged contract's price the day it was flagged, High = the best it has printed since, Max % = the move between them · click any column to sort"` | `outcomeStatus !== "results"` | Always renders |

---

## H.8 — Sorting machinery (`OUTCOME_SORT_VALUE`, `sortOutcomes`, `defaultOutcomeSort`, `OutcomeTh`)

Source: `Scanner.tsx:961–1047, 1653–1663`.

`OutcomeSortKey` is a 12-member union, one per column:
`"symbol" | "strike" | "expiry" | "first_flagged" | "opt_entry" | "opt_high" |
"opt_pct_high" | "spot_at_flag" | "otm_pct_at_flag" | "closest_pct" |
"touched_date" | "status"`.

### H.8a — The comparator, key by key

`sortOutcomes` copies the array (`[...rows].sort`), picks `mul = dir === "asc" ? 1 : -1`,
and for each pair: `av`/`bv` from `OUTCOME_SORT_VALUE[key]`; a value is NULL for
sorting purposes when `v == null || v === ""` (so `null`, `undefined` **and the
empty string** all count as null, but `0` does not). Then:
`aNull && bNull → 0`; `aNull → 1`; `bNull → -1` (**both branches ignore `mul`,
so nulls sink to the bottom in ASC and DESC alike**); both numbers →
`(av - bv) * mul`; otherwise `String(av).localeCompare(String(bv)) * mul`.
**There is no tie-break** — equal keys return `0` and fall back to
`Array.prototype.sort`'s stability, i.e. the server's own `first_flagged DESC`
order for whatever page was fetched.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H53** `symbol` comparator | `(r) => r.symbol` | String → `localeCompare` | asc = A→Z | `""` would sink to the bottom; `symbol` is a required field so this cannot fire in practice |
| **H54** `strike` comparator | `(r) => Number(r.strike)` | Numeric subtraction | `Number(...)` of a non-numeric string yields `NaN`, which is **not** caught by the null test — `NaN - x` is `NaN`, an inconsistent comparator | Cannot be null (required field) |
| **H55** `expiry` comparator | `(r) => ymd(r.expiry) ?? r.expiry ?? null` | Normalised `YYYY-MM-DD` string → `localeCompare`, which for ISO dates is chronological | Falls back to the RAW expiry string when it does not match `^\d{4}-\d{2}-\d{2}$`, so a malformed expiry still sorts (lexically) rather than sinking | `null`/`""` sinks |
| **H56** `first_flagged` comparator | `(r) => ymd(r.first_flagged) ?? null` | `YYYY-MM-DD` string → `localeCompare` | **No raw fallback** (unlike `expiry`) — a non-ISO `first_flagged` becomes `null` and sinks | `null` sinks |
| **H57** `opt_entry` comparator | `(r) => r.opt_entry ?? null` | Numeric | — | Unpriced contracts (`null`) sink to the bottom in both directions |
| **H58** `opt_high` comparator | `(r) => r.opt_high ?? null` | Numeric | — | `null` sinks |
| **H59** `opt_pct_high` comparator | `(r) => r.opt_pct_high ?? null` | Numeric (percent, can be negative) | — | `null` sinks |
| **H60** `spot_at_flag` comparator | `(r) => Number(r.spot_at_flag)` | Numeric | Same `NaN` caveat as H54 | Required field |
| **H61** `otm_pct_at_flag` comparator | `(r) => Number(r.otm_pct_at_flag)` | Numeric | Same `NaN` caveat as H54 | Required field |
| **H62** `closest_pct` comparator | `(r) => r.closest_pct ?? null` | Numeric | — | `null` sinks |
| **H63** `touched_date` comparator | `(r) => ymd(r.touched_date)` | `YYYY-MM-DD` string → `localeCompare` | This is the case the null rule was written for: untouched rows have no touched date and must not float to the top of a DESC sort | `null` sinks |
| **H64** `status` comparator | `(r) => STATUS_RANK[r.status] ?? 99` | Numeric rank — `STATUS_RANK = { open: 0, touched: 1, expired: 2 }`; an unknown status maps to `99` | ASC reads as the lifecycle `open → touched → expired`, deliberately not A–Z (which would be `expired → open → touched`) | An unknown status sorts last in ASC, first in DESC — it is `99`, not null, so it does NOT sink in DESC |

### H.8b — Defaults and header interaction

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H65** Default sort — `"touched"` | `defaultOutcomeSort("touched")` | `{ key: "touched_date", dir: "desc" }` — newest touch first | — | — |
| **H66** Default sort — `"expired"` | `defaultOutcomeSort("expired")` | `{ key: "expiry", dir: "desc" }` | — | — |
| **H67** Default sort — `"all"` | `defaultOutcomeSort("all")` | `{ key: "first_flagged", dir: "desc" }` — matches the server's own ordering | This is also the initial state: `useState<OutcomeSort>(() => defaultOutcomeSort("all"))` | — |
| **H68** Default sort — `"open"` | `defaultOutcomeSort("open")` | `{ key: "first_flagged", dir: "desc" }` (the ternary's else branch) | — | — |
| **H69** Default sort — `"results"` | `defaultOutcomeSort("results")` | `{ key: "first_flagged", dir: "desc" }` (same else branch) | **Dead in effect** — the `"results"` view renders `ResultsByDay`, which never reads `sort`. The state is still set by the H50 effect | — |
| **H70** Header click — same column | `onSort` (`useCallback`, deps `[]`) | `cur.key === key → { key, dir: cur.dir === "asc" ? "desc" : "asc" }` — toggles direction | — | — |
| **H71** Header click — new column | `onSort` | `{ key, dir: key === "symbol" ? "asc" : "desc" }` — **`symbol` opens A–Z; every other column opens descending** (newest / biggest first) | The check is literally `key === "symbol"`, not a type test, so `expiry` / `first_flagged` / `touched_date` / `status` all open descending | — |
| **H72** `OutcomeTh` — inactive | `sort.key !== sortKey` | `...th` + `textAlign` (`"right"` by default, `"left"` where passed) `· cursor pointer · userSelect none · whiteSpace nowrap`; `color: undefined` so it inherits the `<tr>`'s `HT.green #8ECAE6` | — | — |
| **H73** `OutcomeTh` — active | `sort.key === sortKey` | Same metrics, `color: LIGHT_BLUE #7dd3fc` | — | — |
| **H74** `OutcomeTh` — arrow glyph | — | Inactive: `"▾"` (U+25BE) at `opacity 0.25`. Active ascending: `"▲"` (U+25B2) at `opacity 1`. Active descending: `"▼"` (U+25BC) at `opacity 1`. Always `marginLeft 4`, inside a `<span>` | The inactive glyph is the SMALL down triangle, the active-desc glyph is the LARGE one — two different characters, deliberately | Always rendered on all 12 headers |
| **H75** `OutcomeTh` — tooltip | `title={`Sort by ${label}`}` | e.g. `"Sort by Max %"`, `"Sort by OTM at flag"` | none | On all 12 headers |
| **H76** Sort is client-side only | `useMemo(() => sortOutcomes(outcomes, sort), [outcomes, sort])` | Re-orders the already-fetched page. The endpoint orders by `first_flagged DESC` and applies `limit=100` server-side | Sorting by `opt_high` DESC shows the best of the fetched 100, **not** the best overall | — |

---

## H.9 — Flat tracked-results table (views `all` / `open` / `touched` / `expired`)

Source: `Scanner.tsx:1943–2040`. Table: `width 100% · borderCollapse collapse ·
fontSize 14`, inside `overflowX: auto`. Header `<tr>`: `color HT.green #8ECAE6 ·
textAlign right · fontSize 14 · textTransform uppercase` — so every header label
below renders UPPERCASE.

**Twelve columns, in render order.** Each row below is one column.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H77** `"Symbol"` | `o.symbol`; sortKey `symbol`, `align="left"` | `td` + `textAlign left · fontWeight 700` | none | Required field |
| **H78** `"Strike"` | `` `$${o.strike}` ``; sortKey `strike`, right-aligned | **Raw number, no `toFixed`** · `fontWeight 700` | `o.side === "above"` → `HT.green #8ECAE6`; otherwise (`"below"`) → `HT.red #EF4444` | Required field |
| **H79** `"Expiry"` | `o.expiry`; sortKey `expiry`, `align="left"` | Server string verbatim — **`ymd()` is NOT applied to the cell**, only to the sort value, so an expiry carrying a time renders the time | `color HT.text · fontSize 14` | Required field |
| **H80** `"Flagged"` | `o.first_flagged`; sortKey `first_flagged`, `align="left"` | Server string verbatim, no `ymd()` | `color HT.text · fontSize 14` | Required field |
| **H81** `"Entry"` | `o.opt_entry`, with `o.opt_type` appended; sortKey `opt_entry`, right-aligned | `` `$${o.opt_entry.toFixed(2)}${o.opt_type ? ` ${o.opt_type}` : ""}` `` → `"$3.45 C"`. `fontWeight 700`. **This is the only cell that names the contract's C/P side** — `High` deliberately does not repeat it | No colour rule — inherits `td`'s `HT.text` | `"—"` when `opt_entry == null`. A null `opt_type` just drops the letter |
| **H82** `"Entry"` — tooltip | `o.opt_entry_date` | `` title={`First price recorded ${o.opt_entry_date}`} `` | Present only when `opt_entry_date` is truthy | `title` is `undefined` (no tooltip) when the date is missing |
| **H83** `"High"` | `o.opt_high`; sortKey `opt_high`, right-aligned | `` `$${o.opt_high.toFixed(2)}` `` · `fontWeight 700` | `opt_high != null` → `LIGHT_BLUE #7dd3fc`; null → `HT.text #FFFFFF` | `"—"` when null |
| **H84** `"Max %"` | `o.opt_pct_high`; sortKey `opt_pct_high`, right-aligned | `` `${o.opt_pct_high >= 0 ? "▲" : "▼"} ${Math.abs(o.opt_pct_high).toFixed(1)}%` `` — glyph, space, absolute value at 1 dp, `%`. `fontWeight 700` | `null → HT.text`; `>= 0 → HT.green #8ECAE6`; `< 0 → HT.red #EF4444`. Boundary is `>= 0`, so an exact `0` is green with a `▲` | `"—"` when null |
| **H85** `"Flagged Spot"` | `o.spot_at_flag`; sortKey `spot_at_flag`, right-aligned | `` `$${o.spot_at_flag.toFixed(2)}` `` — 2 dp | Plain `td`, no colour rule | Required field |
| **H86** `"OTM at flag"` | `o.otm_pct_at_flag`; sortKey `otm_pct_at_flag`, right-aligned | `` `${o.otm_pct_at_flag.toFixed(0)}%` `` — **0 dp** | Plain `td` | Required field |
| **H87** `"Closest"` | `o.closest_pct`; sortKey `closest_pct`, right-aligned | `` `${o.closest_pct.toFixed(1)}%` `` — 1 dp | `closest_pct != null && closest_pct < 1` → `LIGHT_BLUE #7dd3fc`; otherwise `HT.text`. Boundary is strictly **`< 1`**, so exactly `1.0%` is NOT highlighted | `"—"` when null |
| **H88** `"Touched"` | `ymd(o.touched_date)`; sortKey `touched_date`, `align="left"` | Normalised to `YYYY-MM-DD` (this cell DOES apply `ymd`) · `whiteSpace nowrap` | `o.touched_date` truthy → `LIGHT_BLUE`; falsy → `HT.text`. **The colour tests the raw field, the text tests the normalised one** — a truthy-but-malformed date paints light blue while displaying `"—"` | `"—"` when `ymd()` returns null |
| **H89** `"Status"` | `o.status.toUpperCase()`; sortKey `status`, `align="left"` | `"OPEN"` / `"TOUCHED"` / `"EXPIRED"` in a `<span>`: `fontSize 14 · fontWeight 800 · letterSpacing .05em` | `"touched"` → `LIGHT_BLUE #7dd3fc`; `"expired"` → `HT.text #FFFFFF`; anything else (i.e. `"open"`) → `HT.green #8ECAE6` | Required field |
| **H90** Row striping | `i % 2` over the SORTED array | Odd index → `rgba(255,255,255,0.02)`; even → `transparent`. `borderTop 1px solid rgba(255,255,255,0.06)` | Expanded row overrides both: `background rgba(33,158,188,0.10)` | — |
| **H91** Row cursor + tooltip | `openRow === rk` | `cursor: pointer` always. `title` = `"Click to collapse"` when open, `"Click for day-by-day detail"` when closed | — | — |
| **H92** Row identity | `` const rk = `flat|${outcomeKey(o)}` `` where `outcomeKey(o) = `${o.symbol}\|${o.expiry}\|${o.strike}`` | e.g. `flat\|SPX\|2026-09-18\|5900` | The `flat\|` prefix keeps the flat table's key distinct from the Results view's `day\|…` keys so only the clicked row expands | Also the React `key` |
| **H93** Expanded detail row | `isOpen && <tr><td colSpan={12}>` | `padding "0 0 0 10px" · background rgba(0,0,0,0.20)` — renders `detailPanel` (H105–H124) | `colSpan={12}` matches the 12 columns | — |
| **H94** Empty table | `!outcomes.length` | `<tr><td colSpan={12}>` — `"No tracked flags yet."`, `padding 20 · textAlign center · color HT.text` | Guarded on `outcomes.length`, **not** on a loading flag — there is no loading state for this table at all, so a slow fetch shows "No tracked flags yet." | This is also the first-paint state |
| **H95** No error state | `loadOutcomes` has `catch {}` | **A failed outcomes fetch is silently swallowed** — no message, no retry indicator. The table just keeps the previous rows or shows H94 | — | — |

---

## H.10 — Results view (`ResultsByDay`) and day grouping

Source: `Scanner.tsx:1049–1086, 2050–2221`.

### H.10a — `groupOutcomesByDay` / `DayBucket`

`DayBucket = { date: string; opened: OutcomeRow[]; touched: OutcomeRow[]; expired: OutcomeRow[] }`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H96** `ymd(v)` | `Scanner.tsx:1057–1061` | `if (!v) return null; const s = String(v).slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;` — a plain **first-10-characters slice**, no date parsing, no timezone conversion | A value that does not match the regex after slicing returns `null` | `null` for `null`, `undefined` and `""` |
| **H97** Grouping key | `ymd(...)` of a date field — the bucket key IS the `YYYY-MM-DD` string | One `Map<string, DayBucket>`, lazily created per key | — | A row whose relevant date fails `ymd()` is silently dropped from that bucket list |
| **H98** `opened` bucket rule | `const flagged = ymd(r.first_flagged); if (flagged) bucket(flagged).opened.push(r);` | Every row with a parseable `first_flagged` | Unconditional on status | — |
| **H99** `touched` bucket rule | `const touched = ymd(r.touched_date); if (touched) bucket(touched).touched.push(r);` | Every row with a parseable `touched_date` | Unconditional on status — it keys off the DATE field, not `status === "touched"` | — |
| **H100** `expired` bucket rule | `if (r.status === "expired") { const exp = ymd(r.expiry); if (exp) bucket(exp).expired.push(r); }` | **Gated on `status === "expired"`** — this is the only one of the three that checks status | A row that expired but was touched first has `status === "touched"`, so it never lands in an `expired` bucket | — |
| **H101** One row, up to three buckets | — | The same `OutcomeRow` can appear under `opened` on its flag date, `touched` on its touch date, and `expired` on its expiry date — three different `DayBucket`s, or the same one if the dates coincide | This is why row keys are section-scoped (H110) | — |
| **H102** Bucket ordering | `[...map.values()].sort((a,b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))` | **Descending by `YYYY-MM-DD` string, newest day first.** String comparison, which for ISO dates is chronological | No secondary sort — equal dates are impossible (the Map is keyed by date) | Empty input → empty array → H105 |
| **H103** Row order inside a bucket | — | **No sort.** Rows appear in the order the endpoint returned them (`first_flagged DESC`), filtered by section | The `sort` state does not apply here | — |

### H.10b — The day table

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H104** Error state | `err` prop (`resultsErr`) | `padding 20 · textAlign center · color HT.orange #FB8501` — the raw message string | Checked FIRST, before loading and empty | Returns early, no table |
| **H105** Loading state | `loading && !days.length` | `"Loading results…"` — `padding 20 · textAlign center · color HT.text` | Only when there are no days yet; a refresh with existing days shows the stale table silently | — |
| **H106** Empty state | `!days.length` | `"No tracked flags yet."` — `padding 20 · textAlign center · color HT.text` | Same string as H94 | — |
| **H107** `"Date"` column | `d.date`; `th` + `textAlign left` | `td` + `textAlign left · fontWeight 700` | `isOpen` → `LIGHT_BLUE #7dd3fc`; closed → `HT.text #FFFFFF` | Always present |
| **H108** `"Opened"` column | `d.opened.length`; `th` right | `<span style={{ fontWeight: 800 }}>` | `n > 0` → `HT.green #8ECAE6`; `n === 0` → `rgba(255,255,255,0.35)` | Renders the literal `0`, never `"—"` |
| **H109** `"Touched"` column | `d.touched.length` | Same `count()` helper | `n > 0` → `LIGHT_BLUE #7dd3fc`; `0` → `rgba(255,255,255,0.35)` | Renders `0` |
| **H110** `"Expired"` column | `d.expired.length` | Same `count()` helper | `n > 0` → `HT.orange #FB8501`; `0` → `rgba(255,255,255,0.35)` | Renders `0` |
| **H111** Disclosure column | 5th `<th>`, `...th` + `width: 30`, **no label** | Cell text is `"▾"` (U+25BE) when open, `"▸"` (U+25B8) when closed — `color rgba(255,255,255,0.45)` | — | Always renders |
| **H112** Day row interaction | `onToggleDay(d.date)` → `setOpenDay(cur => cur === d ? null : d)` | `title="Click to expand this date"` — the string does NOT change when the row is already open. `cursor pointer` | Open row background `rgba(33,158,188,0.10)`; otherwise `i % 2 ? rgba(255,255,255,0.02) : transparent`; `borderTop 1px solid rgba(255,255,255,0.06)` | One day open at a time |
| **H113** Expanded day panel | `isOpen && <tr style={{ background: "rgba(0,0,0,0.20)" }}><td colSpan={5} style={{ padding: "12px 10px 18px" }}>` | Inner wrapper `display grid · gap 16`, one block per `RESULT_SECTIONS` entry | `colSpan={5}` matches the 5 day columns | — |

### H.10c — The three sections inside an expanded day

`RESULT_SECTIONS` (`Scanner.tsx:2050–2057`), rendered in array order:

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H114** `"OPENED · N"` | `{ key: "opened", label: "Opened", color: HT.green }` | `` `${sec.label.toUpperCase()} · ${rows.length}` `` — `fontSize 14 · fontWeight 800 · letterSpacing .05em` | `color HT.green #8ECAE6` | Header renders even when `N` is 0 |
| **H115** `"flagged for the first time on this date"` | `RESULT_SECTIONS[0].note` | `fontSize 14 · color HT.text · opacity 0.65` | none | Always |
| **H116** `"TOUCHED · N"` | `{ key: "touched", label: "Touched", color: LIGHT_BLUE }` | Same metrics as H114 | `color LIGHT_BLUE #7dd3fc` | — |
| **H117** `"spot reached the flagged strike on this date"` | `RESULT_SECTIONS[1].note` | Same metrics as H115 | none | — |
| **H118** `"EXPIRED · N"` | `{ key: "expired", label: "Expired", color: HT.orange }` | Same metrics as H114 | `color HT.orange #FB8501` | — |
| **H119** `"expired on this date without ever being touched"` | `RESULT_SECTIONS[2].note` | Same metrics as H115 | none | — |
| **H120** Empty section | `!rows.length` | `"None"` — `padding "8px 10px" · fontSize 14 · color rgba(255,255,255,0.35)` | Replaces the whole sub-table | Each of the three sections has its own independent "None" |

### H.10d — The per-section sub-table (8 columns)

Header `<tr>`: `color HT.green · textAlign right · fontSize 14 · textTransform uppercase`.
**None of these headers is clickable** — they are plain `<th style={th}>`, not `OutcomeTh`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H121** `"Symbol"` | `o.symbol`, `th` left | `td` + `textAlign left · fontWeight 700` | none | — |
| **H122** `"Strike"` | `` `$${o.strike}` ``, `th` right | Raw number, no `toFixed` · `fontWeight 700` | `o.side === "above"` → `HT.green`; else `HT.red` | — |
| **H123** `"Expiry"` | `o.expiry`, `th` left | Verbatim server string, no `ymd()` | Plain `td` — **unlike the flat table (H79), no explicit `color`/`fontSize` override**, so it takes `td`'s defaults | — |
| **H124** `"Flagged"` | `o.first_flagged`, `th` left | Verbatim | Plain `td` | — |
| **H125** `"Flagged Spot"` | `` `$${o.spot_at_flag.toFixed(2)}` ``, `th` right | 2 dp | Plain `td` | — |
| **H126** `"OTM at flag"` | `` `${o.otm_pct_at_flag.toFixed(0)}%` ``, `th` right | 0 dp | Plain `td` | — |
| **H127** `"Closest"` | `o.closest_pct`, `th` right | `` `${o.closest_pct.toFixed(1)}%` `` | `!= null && < 1` → `LIGHT_BLUE`; else `HT.text` — identical rule to H87 | `"—"` when null |
| **H128** `"Status"` | `o.status`, `th` left | `"touched"` → `` `TOUCHED ${o.touched_date ?? ""}` `` (**the date is glued onto the label here**, unlike the flat table's separate Touched column); otherwise `o.status.toUpperCase()`. `fontSize 14 · fontWeight 800 · letterSpacing .05em` | `"touched"` → `LIGHT_BLUE`; `"expired"` → `HT.text`; else → `HT.green` — same ladder as H89 | A touched row with a null `touched_date` renders `"TOUCHED "` with a trailing space |
| **H129** Sub-row identity + striping | `` const rk = `day\|${d.date}\|${sec.key}\|${outcomeKey(o)}` `` | Section-scoped so the SAME contract listed under both Opened and Touched on one date expands only where it was clicked. Striping uses `j % 2` (the index within the section, not the day) | Open row `rgba(33,158,188,0.10)`; `borderTop 1px solid rgba(255,255,255,0.06)`; `cursor pointer`; `title` = `"Click to collapse"` / `"Click for day-by-day detail"` | — |
| **H130** Sub-row expanded panel | `isOpen && <tr><td colSpan={8}>` | `padding "0 0 0 10px" · background rgba(0,0,0,0.25)` — note **0.25**, where the flat table uses **0.20** (H93). Renders the same `detailPanel` | `colSpan={8}` matches the 8 columns | — |

---

## H.11 — `OutcomeDetailPanel` (the expanded flag card)

Source: `Scanner.tsx:1449–1637`. Rendered inline under whichever row `openRow`
names, in whichever table that row lives in — **one instance is built once in
`WatchThisScanner` (line 1710) and handed to both call sites**, so only ever one
detail is open across the whole tab.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H131** Panel plate | — | `background PROBE_BG #05060a · border 1px solid rgba(33,158,188,0.5) · borderRadius 10 · padding 14 · margin "2px 0 8px" · maxWidth 940` | The border is a **50% cyan**, the only place on the tab that uses it | Always renders once a row is open, even before the fetch resolves |
| **H132** Ticker | `detail.symbol` | `fontFamily PROBE_MONO ("Courier New", monospace) · fontSize 18 · fontWeight 800 · color PROBE_TXT #ffffff` | none | `"…"` (single U+2026) while `detail` is null |
| **H133** Strike/type badge | `` badge = `${detail.strike % 1 ? detail.strike : Math.round(detail.strike)}${detail.type}` `` | A fractional strike keeps its decimals (`5902.5C`); a whole strike is rounded to an integer (`5900C`) | `type === "C"` → `chip(PROBE_ICE #8ECAE6, rgba(142,202,230,0.12), rgba(142,202,230,0.4))`; `type === "P"` → `chip(HT.orange #FB8501, rgba(251,133,1,0.12), rgba(251,133,1,0.4))`. Chip metrics: `mono · 12px · 700 · padding 1px 6px · radius 4 · marginLeft 6 · 1px border` | Omitted entirely while `detail` is null |
| **H134** Status chip | `detail.status` | `"touched"` → `` `Touched ${detail.touchedDate ?? ""}` `` (**mixed case, not uppercased**); otherwise `detail.status.toUpperCase()` → `"OPEN"` / `"EXPIRED"` | `"touched"` → `chip(PROBE_ICE, rgba(142,202,230,0.12), rgba(142,202,230,0.45))`; `"expired"` → `chip(PROBE_RED #ff5b5b, rgba(255,91,91,0.12), rgba(255,91,91,0.45))`; else (`open`) → `chip(PROBE_GRN #30d158, rgba(48,209,88,0.12), rgba(48,209,88,0.45))` | Omitted while `detail` is null |
| **H135** Close `"×"` | `onClick` → `e.stopPropagation(); onClose()` | `background none · border none · color PROBE_TXT · cursor pointer · fontSize 17 · lineHeight 1 · padding "0 2px"` | `stopPropagation` is required — the parent `<tr>` would otherwise re-toggle | Always renders, including during load |
| **H136** Sub-line | `` `${probeExp(detail.expiry)} · flagged ${detail.firstFlagged} at spot $${detail.spotAtFlag.toFixed(2)} (${detail.otmPctAtFlag.toFixed(0)}% OTM)` `` | `mono · 12px · color PROBE_MUTED rgba(255,255,255,0.62) · marginTop 3`. Spot 2 dp, OTM 0 dp | — | `"Loading…"` while `detail` is null |
| **H137** `probeExp(v)` | `Date.parse(`${String(v).slice(0,10)}T12:00:00Z`)` then `toLocaleDateString([], { month:"short", day:"numeric", year:"2-digit" })` | `"Sep 18, 26"` — parsed at **UTC noon** so a western timezone cannot roll the label back a day. Locale is the browser's (`[]`) | Unparseable → the raw string `v` | — |
| **H138** Big % headline | `probeStats(detail.days).pct` | `` `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%` `` — `mono · 24px · 800 · lineHeight 1` | `probeTone(v)`: `null → PROBE_TXT #ffffff`; `> 0 → PROBE_GRN #30d158`; `< 0 → PROBE_RED #ff5b5b`; **exactly `0` → white**. Note the glyph boundary is `>= 0` but the colour boundary is `> 0`, so a flat `0.0%` prints a green-less `▲ 0.0%` in white | `"—"` when `pct` is null; the whole block is omitted when `probeStats` returns null (no priced days) |
| **H139** `probeStats` | `Scanner.tsx:1145–1156` | `vals = days.map(d => d.contractClose).filter(finite && != null)`; returns `null` if empty. `entry = vals[0]` (first PRICED day), `last = vals[vals.length-1]`, `mark = Math.max(...vals)`, `pct = entry > 0 ? ((mark-entry)/entry)*100 : null`, `dollars = (mark - entry) * 100` | `pct` is `null` when `entry <= 0` — division guard. `mark` is the **peak**, not the live mark: "a flag that ran +150% and gave it all back still handed you the +150%" | `null` → the headline block and the copy button's numbers all become `null`/`"—"` |
| **H140** `"in"` label + value | `probeStats().entry` | Label `lbl` = `color PROBE_MUTED · fontSize 10 · uppercase · letterSpacing .06em · marginRight 3` → renders `IN`. Value via `probePx(v)` = `v == null ? "—" : v.toFixed(2)` (bare number, **no `$`**) | Line is `mono · 14px · color PROBE_TXT · marginTop 6` | `"—"` |
| **H141** `"→"` separator | Static | `color PROBE_MUTED · margin "0 6px"` | none | — |
| **H142** `"high"` label + value | `probeStats().mark` | Label renders `HIGH`; value `probePx(mark)` | — | `"—"` |
| **H143** `$/ct` figure | `probeStats().dollars` | `` ` · ${dollars >= 0 ? "+" : "−"}$${Math.abs(dollars).toFixed(0)}/ct` `` — the minus is **U+2212**, not a hyphen. 0 dp. `fontWeight 700` | `probeTone(dollars)` — same ladder as H138 | Block omitted with `stats` |
| **H144** `"now"` label + value | `probeStats().last` | Label renders `NOW`; value `probePx(last)`. Wrapper `color PROBE_MUTED · marginLeft 10` | Deliberately muted — the live mark trails the peak | `"—"` |
| **H145** Chart well divider | — | `marginTop 14 · paddingTop 14 · borderTop 1px solid PROBE_BORDER rgba(255,255,255,0.1)` | none | Always |
| **H146** `"⧉ Copy image"` button | `captureFlagCard(chartId, {...})`; `shot` state | `mono · 12px · 700 · cursor pointer · padding 4px 10px · radius 6`. Idle: `color PROBE_TXT`, `border 1px rgba(142,202,230,0.35)`, `background rgba(142,202,230,0.08)` | Success `"✓ Copied"`: `color PROBE_GRN`, `border rgba(48,209,88,0.6)`, `bg rgba(48,209,88,0.14)`. Failure `"✗ Copy failed"`: `color PROBE_RED`, `border rgba(255,91,91,0.6)`, `bg rgba(255,91,91,0.12)`. Both revert to idle after **1600 ms** | Rendered only when `detail && detail.days.length` |
| **H147** Copy button tooltip | Static `title` | `"Copy this card to the clipboard as a PNG"` | none | — |
| **H148** `chartId` | `` `flag-chart-${(detail ? `${symbol}-${badge}-${ymd(expiry) ?? expiry}` : "x").replace(/[^A-Za-z0-9-]/g, "")}` `` | e.g. `flag-chart-SPX-5900C-2026-09-18`. Every non-alphanumeric, non-hyphen character is stripped — specifically the `.` a fractional strike carries, because `getElementById` is how `captureFlagCard` finds the SVG | Also seeds the SVG gradient id `` `${chartId}-wash` `` (H162) | `"flag-chart-x"` when `detail` is null (the chart is not rendered then anyway) |
| **H149** `hint` string | `` `Contract mark · daily bars · flagged @ ${probePx(stats?.entry ?? null)}${detail.touchedDate ? ` · touched ${detail.touchedDate}` : ""} · today sampled every 15m` `` | Used both in the footer (H153) and baked into the PNG (H160) | The `· touched <date>` clause is present only when `touchedDate` is truthy | `""` while `detail` is null |
| **H150** Detail loading | `loading` prop | `"Loading day-by-day detail…"` — `padding "40px 0" · textAlign center · color PROBE_MUTED · fontSize 12 · mono` | — | — |
| **H151** Detail error | `err` prop | The raw error string, same `empty` metrics but `color HT.orange #FB8501` | Message is `String(e?.message \|\| e)`, or `j.error \|\| "load failed"` on `ok:false` | — |
| **H152** No bars | `detail && !detail.days.length` | `"No daily bars yet."` — `empty` metrics, `color PROBE_MUTED` | — | — |
| **H153** Chart footer | `` `${hint} · no-trade days show —` `` | `marginTop 8 · mono · 12px · color PROBE_MUTED · letterSpacing .04em` | The trailing `—` is a literal em dash in the string | Rendered only alongside the chart |

### H.11a — Day-by-day table inside the panel (6 columns)

Source: `Scanner.tsx:1599–1634`. `overflowX auto · marginTop 14`; table
`width 100% · borderCollapse collapse · fontSize 14`. Header `<tr>`:
`color HT.green · textAlign right · fontSize 14 · uppercase`. Rows keyed by
`d.date`, striped `i % 2 ? rgba(255,255,255,0.02) : transparent`, `borderTop 1px
solid rgba(255,255,255,0.06)`. **Rows are rendered in the endpoint's order — no
client sort.**

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H154** `"Date"` | `d.date` | `td` + `textAlign left` — raw `YYYY-MM-DD`, no reformatting | none | — |
| **H155** `"Spot"` | `` `$${d.spot.toFixed(2)}` `` | 2 dp | Plain `td` | `spot` is non-nullable on `OutcomeDetailDay` |
| **H156** `"Spot Δ%"` | `d.spotPctChg` | `` `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` `` — 2 dp, explicit `+` for non-negative, native `-` for negative | `null → HT.text`; `>= 0 → HT.green #8ECAE6`; `< 0 → HT.red #EF4444` | `"—"` when null |
| **H157** `"Contract"` | `d.contractClose` | `` `$${v.toFixed(2)}` `` | Plain `td`, no colour rule | `"—"` when null (a no-trade day) |
| **H158** `"Contract Δ$"` | `d.contractDollarChg` | `` `${v >= 0 ? "+" : ""}$${v.toFixed(2)}` `` — sign BEFORE the `$` | `null → HT.text`; `>= 0 → HT.green`; `< 0 → HT.red` | `"—"` when null |
| **H159** `"Contract Δ%"` | `d.contractPctChg` | `` `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` `` | `null → HT.text`; `>= 0 → HT.green`; `< 0 → HT.red` | `"—"` when null |

---

## H.12 — `ProbeChart`

Source: `Scanner.tsx:1280–1442`.

**It is an inline `<svg>`, hand-rolled — NOT a canvas and not a charting
library.** The doc comment gives the reason: it renders inside a table cell that
is already inside two other tables, and every charting lib on the page wants a
measured container, whereas a `viewBox` scales without measuring anything.
**v3's `data-cb-layer` requirement therefore does not apply to `ProbeChart`** —
that rule governs canvases. The only canvas in this part is the offscreen one
`captureFlagCard` creates with `document.createElement("canvas")`, which is never
appended to the DOM (H182). What DOES bite in v3 is non-negotiable #5: this chart
has **no visibility guard** — see H175.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H160** SVG element | `<svg id={chartId} viewBox="0 0 960 340">` | `style: width 100% · height auto · display block`; `role="img"`, `aria-label="Contract price probe"`. Geometry constants: `W 960 · H 340 · PADL 12 · PADR 78 · PADT 26 · PADB 30` | Handlers: `onMouseMove={onMove}`, `onMouseLeave={() => setHover(null)}` | — |
| **H161** Insufficient-history guard | `pts.length < 2` | `"Not enough history yet — the contract needs a second session on the tape."` — `padding "34px 0" · textAlign center · mono · fontSize 13 · color HT.text · opacity 0.5 · marginBottom 14` | `pts` = days with a finite, non-null `contractClose`. A single priced day still shows this | Returned instead of the SVG |
| **H162** Wash gradient | `<linearGradient id={`${chartId}-wash`} x1=0 y1=0 x2=0 y2=1>` | Vertical: `stop 0% ICE #8ECAE6 @ opacity 0.22` → `stop 100% ICE @ opacity 0` | `chartId` is what makes the gradient id unique per open card — two panels are never open at once, but the id must still not collide with the SVG's own | — |
| **H163** X scale | `sx(i) = PADL + (n <= 1 ? 0 : i / (n - 1)) * (W - PADL - PADR)` | `n = days.length` — **ALL days, including no-trade days.** Plot width = `960 - 12 - 78 = 870`px of viewBox | A no-trade day keeps its x slot so the timeline stays even, but carries no point | `n <= 1` collapses every point onto `PADL` |
| **H164** Y scale + domain | `sy(v) = H - PADB - ((v - minY) / (maxY - minY \|\| 1)) * (H - PADT - PADB)` | Plot height = `340 - 26 - 30 = 284`px. Domain: `minY = Math.min(lo, entry)`, `maxY = Math.max(hi, entry)` where `hi`/`lo` are the max/min of the priced closes and `entry = pts[0].v`; if `minY === maxY` then `minY -= 1; maxY += 1`; then `gpad = (maxY - minY) * 0.1` is subtracted from `minY` and added to `maxY` (**10% headroom each side**) | The entry price is forced into the domain so the break-even line can never fall off-canvas | `\|\| 1` guards a zero-height domain |
| **H165** Gridlines + price rail | `[hi, (hi + lo) / 2, lo]` — **exactly three**, at the data high, midpoint and low (NOT at the padded axis bounds) | Lines `x1 PADL → x2 W-PADR`, `stroke rgba(255,255,255,0.07)`, `strokeWidth 1`. Labels at `x = W - PADR + 10 (=892)`, `y = sy(v) + 4`, `fontSize 12`, `fill PROBE_TXT #ffffff`, `mono`, `v.toFixed(2)` | When every priced close is equal, `hi === lo` and all three gridlines and all three labels stack on one y | — |
| **H166** Area fill | One `<path>` per segment, `d = areaOf(seg)`, `fill url(#${chartId}-wash)` | `areaOf` returns `""` for a segment shorter than 2 points, so a lone point gets no wash. The path closes down to `y = H - PADB (=310)` | Drawn BELOW the touched marker, the entry line and the price line | — |
| **H167** Line segments + gap handling | `segs` built by walking `days` in order and starting a new segment at every `contractClose == null \|\| !Number.isFinite(...)` | `<path d={dOf(seg)} fill="none" stroke={ICE #8ECAE6} strokeWidth 1.9 strokeLinejoin="round" strokeLinecap="round">`. `dOf` emits `M`/`L` with coordinates at 1 dp | **The line BREAKS at a no-trade day** rather than drawing a straight segment across a gap that never happened | A single-point segment draws an `M` with no `L` — invisible |
| **H168** Touched marker | `touchIdx = touchedDate ? days.findIndex(d => d.date === ymd(touchedDate)) : -1` | Vertical line at `sx(touchIdx)` from `y1 = PADT (26)` to `y2 = H - PADB (310)`: `stroke LIGHT_BLUE #7dd3fc · strokeWidth 1 · strokeDasharray "3 3" · opacity 0.65`. Label `"TOUCHED"` at `x = sx(touchIdx) + 5`, `y = PADT + 10 (=36)`, `fontSize 11`, `fill LIGHT_BLUE`, `mono`, `letterSpacing "1"` | Drawn only when `touchIdx >= 0`. The match is an EXACT string compare of `d.date` against `ymd(touchedDate)` — a touch date the `days` array does not contain draws nothing, silently | Not drawn when `touchedDate` is null or unmatched |
| **H169** Flagged / break-even line | `entry = pts[0].v` — the first PRICED close, not `o.opt_entry` | Horizontal at `sy(entry)` from `PADL` to `W - PADR`: `stroke rgba(255,255,255,0.40) · strokeWidth 1 · strokeDasharray "3 5"`. Label `` `FLAGGED ${entry.toFixed(2)}` `` at `x = PADL + 4 (=16)`, `y = sy(entry) - 7`, `fontSize 11`, `fill PROBE_TXT`, `mono`, `letterSpacing "1"` | Always drawn (`entry` always exists once `pts.length >= 2`) | — |
| **H170** High marker | `hi`, `hiP = pts[ys.indexOf(hi)]` | `<circle r 3.4 fill="none" stroke={GRN #30d158} strokeWidth 1.6>` at `(sx(hiP.i), sy(hi))`; label `` `H ${hi.toFixed(2)}` `` at `y = sy(hi) - 11`, `fontSize 12`, `fill GRN`, `mono`, `textAnchor middle` | `indexOf` takes the FIRST occurrence when the high repeats | — |
| **H171** Low marker | `lo`, `loP = pts[ys.indexOf(lo)]` | `<circle r 3.4 fill="none" stroke={RED #ff5b5b} strokeWidth 1.6>`; label `` `L ${lo.toFixed(2)}` `` at `y = sy(lo) + 18`, `fontSize 12`, `fill RED`, `mono`, `textAnchor middle` | First occurrence on a repeat | — |
| **H172** X-axis end labels | `fmtD(days[0]?.date ?? "")` and `fmtD(days[n-1]?.date ?? "")` | `fmtD(d) = Date.parse(`${d}T12:00:00Z`)` → `toLocaleDateString([], { month:"short", day:"numeric" })` → `"Sep 18"`. **Parsed at UTC noon** so a timezone west of Greenwich cannot roll the label back a day. Left at `x = PADL`, right at `x = W - PADR (=882)` with `textAnchor end`; both `y = H - 8 (=332)`, `fontSize 12`, `fill PROBE_TXT`, `mono` | Only two labels — no intermediate tick text | Unparseable date falls back to the raw string; an empty array yields `""` |
| **H173** Last-mark dot + pill | `last = pts[pts.length-1].v`, `up = last >= entry`, `pillFill = up ? GRN : RED` | Dot `<circle r 3.6 fill={pillFill}>` at the last priced point. Pill `<rect x={W-PADR+4} (=886) y={sy(last)-11} width 62 height 22 rx 5 fill={pillFill}>`. Text `last.toFixed(2)` at `x = W-PADR+35 (=917)`, `y = sy(last)+4`, `fontSize 13`, `fontWeight 700`, `fill "#06090d"` (a near-black ink literal used nowhere else), `mono`, `textAnchor middle` | Boundary is `last >= entry` → green includes exactly flat. The pill is anchored to `last`'s y and can overlap a gridline label | — |
| **H174** Hover snap | `onMove` | `vx = ((e.clientX - box.left) / box.width) * W` (client px → viewBox units); `raw = ((vx - PADL) / (W - PADL - PADR)) * (n - 1)`; then the nearest `pts[k]` by `\|p.i - raw\|` wins — it **snaps to the nearest day that actually traded**, never to an empty slot | `setHover(best)`; `onMouseLeave` clears to `null`. Hovering the right-hand rail (`x > W - PADR`) still snaps to the last point | Nothing drawn while `hover` is null |
| **H175** Hover crosshair | `hx = sx(hp.i)` | Vertical `PADT → H - PADB`: `stroke rgba(255,255,255,0.32) · strokeWidth 1 · strokeDasharray "2 3"`. Dot `<circle r 4 fill="#05060a" stroke={ICE} strokeWidth 2>` at `(hx, sy(hp.v))` | — | — |
| **H176** Hover tooltip box | — | `tipW = 168`, height `44`, `rx 7`, `fill rgba(10,13,20,0.96)`, `stroke rgba(48,209,88,0.45)` (a GREEN-tinted border regardless of P/L sign), `strokeWidth 1`. Positioned by `translate(${tipFlip ? hx - 12 - tipW : hx + 12}, ${Math.max(PADT, sy(hp.v) - 46)})` | `tipFlip = hx + 12 + tipW > W - PADR` → flips left once `hx > 702`. The `Math.max(PADT, …)` clamps the top edge at `y = 26` | — |
| **H177** Tooltip — date | `hp.date` | Raw `YYYY-MM-DD` — **not** run through `fmtD`, unlike the axis labels. At `x 12, y 18`, `fontSize 11`, `fill PROBE_TXT`, `mono`, `letterSpacing "1"` | none | — |
| **H178** Tooltip — price | `` `$${hp.v.toFixed(2)}` `` | At `x 12, y 35`, `fontSize 15`, `fontWeight 700`, `fill PROBE_TXT`, `mono` | none | — |
| **H179** Tooltip — $ P/L | `hpl = (hp.v - entry) * 100` | `` `${hpl >= 0 ? "+" : "−"}$${Math.abs(hpl).toFixed(0)}` `` — U+2212 minus, 0 dp, per single contract. At `x 92, y 35`, `fontSize 13`, `fontWeight 700`, `mono` | `hpl >= 0 → GRN #30d158`; `< 0 → RED #ff5b5b`. **This is a third green/red pair on the same panel** — different from `HT.green/red` and from the tooltip border | Suppressed when `hpl` is null (unreachable — `hp.v` and `entry` are always numbers here) |
| **H180** Spot is deliberately NOT drawn | Doc comment, `Scanner.tsx:1272–1274` | The chart is price-only, matching the owner card. Spot would need an independent second scale (the contract is worth a couple of dollars, spot hundreds), and the day-by-day table below already carries spot, spot Δ% and the contract Δ$/Δ% for every point on this chart | — | — |

---

## H.13 — `captureFlagCard` (PNG to clipboard)

Source: `Scanner.tsx:1175–1256`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H181** Entry point | `document.getElementById(chartId) as SVGSVGElement \| null` | Returns `false` immediately when the SVG is not in the DOM | This is why `chartId` strips `.` and other non-`[A-Za-z0-9-]` characters (H148) | `false` → button shows `"✗ Copy failed"` |
| **H182** Canvas geometry | `SCALE 2 · CW 1000 · HEAD 132 · CH = HEAD + 360 = 492` | Backing store `2000 × 984`, then `ctx.scale(2,2)` so all coordinates below are in CSS px | The canvas is created with `document.createElement("canvas")` and **never appended to the DOM** | — |
| **H183** SVG rasterisation | `svg.cloneNode(true)`, `setAttribute("xmlns", …)`, `width "960"`, `height "340"`, serialised via `XMLSerializer` into a `Blob` of `image/svg+xml;charset=utf-8`, loaded through `URL.createObjectURL` into an `Image` | The clone is given explicit px width/height because the live SVG only has a `viewBox` | **This is the reason every colour in `ProbeChart` and the `PROBE_*` block is a hardcoded literal** — a `var()` reference resolves to nothing once the SVG is off-DOM (comment at 1120–1122 and 1282–1284) | `img.onerror` → `throw new Error("svg rasterize failed")` → caught → `false` |
| **H184** Backdrop | — | `fillStyle "#0d1119"`, `fillRect(0,0,1000,492)`; then `strokeStyle "rgba(255,255,255,0.10)"`, `strokeRect(0.5, 0.5, 999, 491)` | `#0d1119` is `HOME_THEME.panel` written as a literal | — |
| **H185** Ticker text | `meta.ticker` | `font "800 26px Courier New, monospace"`, `fillStyle PROBE_TXT`, at `(26, 44)` | — | — |
| **H186** Badge text | `meta.badge` | `font "700 15px mono"`, `fillStyle PROBE_ICE #8ECAE6`, at `(26 + measureText(ticker).width + 12, 43)` — one px above the ticker's baseline | — | — |
| **H187** Expiry text | `meta.exp` (already `probeExp`-formatted) | `font "13px mono"`, `fillStyle PROBE_TXT`, at `(26, 68)` | — | — |
| **H188** Big % | `meta.pct` | `font "800 34px mono"`, text `` `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%` `` at `(26, 110)` | `fillStyle = probeTone(pct)` — same three-way ladder as H138 | `"—"` when `pct` is null |
| **H189** `"IN x → HIGH y"` | `` `IN ${probePx(entry)} → HIGH ${probePx(mark)}` `` | `font "15px mono"`, `fillStyle PROBE_TXT`, at `(210, 108)` — **uppercase in the PNG, lowercase labels on screen (H140/H142)** | — | `probePx` gives `"—"` for nulls |
| **H190** `$/ct` in the PNG | `meta.dollars` | `` ` ${dollars >= 0 ? "+" : "−"}$${Math.abs(dollars).toFixed(0)}/ct` `` (leading space), `font "700 15px mono"`, at `(210 + measureText(line).width + 14, 108)` | `fillStyle = probeTone(dollars)` | Omitted entirely when `dollars` is null |
| **H191** Chart image placement | `ctx.drawImage(img, 20, HEAD - 8, 960, 340)` | Drawn at `(20, 124)` at its natural `960 × 340` | — | — |
| **H192** Hint footer | `meta.hint` (H149) | `font "12px mono"`, `fillStyle "rgba(255,255,255,0.75)"`, at `(26, CH - 14 = 478)` | Note this is **0.75 white**, whereas the on-screen footer uses `PROBE_MUTED` **0.62** | — |
| **H193** Clipboard write | `cv.toBlob(res, "image/png")` then `new ClipboardItem({ "image/png": png })` → `navigator.clipboard.write([...])` | Returns `true` on success | Returns `false` when `ClipboardItem` is absent, `navigator.clipboard` is absent, or `"write"` is not in it — i.e. Firefox and any non-secure context fail silently into `"✗ Copy failed"` | **Clipboard only — nothing is written to disk, there is no download fallback** |
| **H194** Cleanup | `finally { URL.revokeObjectURL(url); }` | Always runs | Every failure path returns `false`, never throws to the caller | — |

---

## H.14 — Data layer

Source: `Scanner.tsx:1688–1808`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| **H195** Flag list fetch | `GET /proxy/far-cb-watch?limit=50`, `{ cache: "no-store" }` | Body read as `text()` first, then `JSON.parse` — so a non-JSON error page produces H23 rather than an unhandled parse throw. Response: `{ ok: boolean, rows: WatchRow[], threshold?: number, error?: string }` | `!j.ok` → `throw j.error \|\| "load failed"` | `setRows(j.rows \|\| [])`, `setThreshold(j.threshold ?? null)`. Failure leaves the PREVIOUS rows on screen and sets `err` |
| **H196** Flag list poll | `useEffect(() => { const t = setInterval(() => load(), 120_000); return () => clearInterval(t); }, [load])` | **Every 120 000 ms (2 minutes)** | **No `document.hidden` check** — a backgrounded tab keeps polling, unlike the outcomes poll (H199) | Cleared on unmount |
| **H197** Flag list — no abort | `load()` has no `AbortController` | Overlapping requests are possible (poll + manual `↻ Refresh`) and the last one to resolve wins | — | — |
| **H198** Outcomes fetch | `GET /proxy/far-cb-outcomes?status=${outcomeStatus}&limit=100`, `{ cache: "no-store" }` | `status` ∈ `all \| open \| touched \| expired`; response `{ ok, rows: OutcomeRow[] }`. Server orders by `first_flagged DESC` and applies the limit | **Only sets state when `j.ok` is truthy** — an `ok:false` response is dropped silently. `catch {}` swallows network failures entirely (H95) | Bails immediately when `outcomeStatus === "results"` |
| **H199** Outcomes poll | `setInterval(…, 60_000)` | **Every 60 000 ms**, and the callback early-returns when `document.hidden` is true, so a backgrounded window costs nothing | Reason (comment 1796–1799): the server answers from a background-filled quote cache, so the first response can carry blank premium columns for contracts it had not priced yet | Interval is not registered at all while `outcomeStatus === "results"` |
| **H200** Results fetch | `GET /proxy/far-cb-outcomes?status=all&limit=300&quotes=0`, `{ cache: "no-store" }` | `limit=300` is stated in the comment as the endpoint's ceiling. `quotes=0` because `ResultsByDay` renders only per-day counts and flag fields and never touches the contract price columns | `!j.ok` → `throw j.error \|\| "load failed"` → `resultsErr` (H104) | Fired by `useEffect(() => { if (outcomeStatus === "results") loadResults(); }, [outcomeStatus, loadResults])` — **no poll**, one shot per entry into the view |
| **H201** Detail fetch | `GET /proxy/far-cb-outcome-detail?${new URLSearchParams({ symbol, strike: String(strike), expiry })}`, `{ cache: "no-store" }` | Response is the `OutcomeDetail` shape: `{ ok, error?, symbol, strike, expiry, type, firstFlagged, spotAtFlag, otmPctAtFlag, status, touched, touchedDate, days: OutcomeDetailDay[] }`. `OutcomeDetailDay = { date, spot, spotPctChg, contractClose, contractDollarChg, contractPctChg }` | `!j.ok` → `throw j.error \|\| "load failed"` → `detailErr` (H151) | Fires only on a row click |
| **H202** Detail race guard | `detailReq = useRef(0)`; `const req = ++detailReq.current` at the start; every `then`/`catch`/`finally` branch checks `detailReq.current !== req` and returns | A slow response for a row you already closed or moved past cannot paint into whatever row is open now | `closeDetail` increments the counter, which invalidates any in-flight request | — |
| **H203** Row toggle | `openDetail(uiKey, o)` | Second click on the SAME `uiKey` calls `closeDetail()` and returns without fetching | One row open at a time across BOTH tables — `openRow` is a single string | `closeDetail` clears `openRow`, `detail`, `detailErr` and `detailLoading` |
| **H204** Detail refetch on reopen | — | Re-opening the same row **always refetches** — there is no cache of previously loaded details | — | — |
| **H205** Mount order | `useEffect(load)` and `useEffect(loadOutcomes)` are separate effects with no dependency between them | Both fire on mount, **in parallel** — no waterfall in v2 either | `loadResults` fires only on entering the `"results"` view | — |
| **H206** Nothing persisted | — | No `localStorage`, no `sessionStorage`, no URL params written by this tab. `outcomeStatus`, `sort`, `openDay`, `openRow`, `newTicker`, `isEmbed` are all component state | The only URL param this tab READS is `?embed=1` (H41); `?tab=watch` is read by the page shell (H3) | Every remount is a cold start |

---

### Colours used

`tokens.css` column reflects `cbedge-v3/src/design/tokens.css` as staged.

| v2 value | Where used in this part | Exists in v3 `tokens.css`? | Proposed v3 token |
|---|---|---|---|
| `HT.text` `#FFFFFF` | every body string, `td` colour, card title, null-state `"—"` cells | yes — `--color-fg` | `T.text` |
| `HT.green` `#8ECAE6` (**a light blue**) | every table header row, `up` symbol/spot/GEX on a flag card, `OPEN` status, positive `Max %`, positive `Spot Δ%` / `Contract Δ$` / `Contract Δ%`, `OPENED` section header + count, card subtitle | yes — `--color-v2-green` | `V2.green` for the header/label uses; **`MOVE_UP`** for the directional uses (H29, H35, H37, H39, H78, H84, H122, H156, H158, H159) |
| `HT.red` `#EF4444` | `down` symbol/spot/GEX, `below`-side strike, negative `Max %`, negative `Spot Δ%` / `Contract Δ$` / `Contract Δ%`, add-ticker error message | yes — `--color-v2-red` | **`MOVE_DOWN`** for the directional uses; `V2.red` for the error message |
| `HT.orange` `#FB8501` | flag-grid error banner, `EXPIRED` section header + count, detail-panel error text, results-view error text | yes — `--color-v2-orange` | `V2.orange` |
| `HT.cyan` `#219EBC` (via `seg()`) | active view-selector button border | yes — `--color-v2-cyan` | `V2.cyan` |
| `LIGHT_BLUE` `#7dd3fc` | `"WATCH THIS"` label, strike line, `View chain →`, active sort header, active sort arrow, `High` cell, `Closest < 1%` cell, `Touched` date cell, `TOUCHED` status, `TOUCHED` chart marker, open-day date, `TOUCHED` section header + count, add-success message | **no exact match.** `theme.ts` maps `LIGHT_BLUE → var(--color-series-5)` = `#4fb8d4`, and `--color-v2-lightblue` is `#7ed3fc` (one digit off, taken from the `.analytics-embed` CSS) | `LIGHT_BLUE` (`--color-series-5`) — **but confirm the shift from `#7dd3fc` to `#4fb8d4` is intended**; see Open questions |
| `PROBE_ICE` `#8ECAE6` | probe chart line + wash gradient, hover dot stroke, `C` badge chip, `touched` status chip, copy-button idle border/bg | same value as `HT.green` — yes, `--color-v2-green` | `V2.green` |
| `PROBE_GRN` `#30d158` | `probeTone` positive, chart high marker, last-mark pill when `last >= entry`, tooltip P/L positive, tooltip border, `OPEN` chip, copy-success button | yes — `--color-candle-up` | `ES_CANDLE_UP` |
| `PROBE_RED` `#ff5b5b` | `probeTone` negative, chart low marker, pill when `last < entry`, tooltip P/L negative, `EXPIRED` chip, copy-failed button | yes — `--color-candle-down` | `ES_CANDLE_DOWN` |
| `PROBE_TXT` `#ffffff` | probe header text, gridline price rail, `FLAGGED` label, axis labels, tooltip text | yes — `--color-fg` | `T.text` |
| `PROBE_MUTED` `rgba(255,255,255,0.62)` | detail sub-line, `in`/`high`/`now` labels, `now` value, chart hint footer, empty-state text | no | `alpha(T.text, .62)` |
| `PROBE_BG` `#05060a` | detail panel plate, hover dot fill | yes — `--color-v2-bg` | `V2.bg` |
| `PROBE_BORDER` `rgba(255,255,255,0.1)` | chart-well divider | no exact (`--color-line` is opaque `#23272e`) | `V2W.border` = `alpha(T.text, .10)` |
| `#0d1119` | PNG backdrop fill in `captureFlagCard` | yes — `--color-v2-panel` | `V2.panel` |
| `#06090d` | ink inside the last-mark price pill | no | `V2.ink` `#0b0f1a` — close enough that a second near-black is not worth a token |
| `rgba(13,17,25,0.20)` | flag-card plate background | no | `alpha(V2.panel, .20)` |
| `rgba(13,17,25,0.45)` | the `Card` surface (`HT.panelBg`) | no exact | `V2W.panelBg` = `alpha(V2.panel, .45)` |
| `rgba(33,158,188,0.15)` | active view-button background | no | `alpha(V2.cyan, .15)` |
| `rgba(33,158,188,0.10)` | expanded-row highlight (flat table, day table, day sub-table) | no | `V2W.pickRow` = `alpha(V2.cyan, .10)` |
| `rgba(33,158,188,0.5)` | detail-panel border | no | `alpha(V2.cyan, .50)` |
| `rgba(255,255,255,0.02)` | odd-row striping in all four tables | no | `V2W.wash03`-family; add `alpha(T.text, .02)` |
| `rgba(255,255,255,0.06)` | row `borderTop` in all four tables | no | `alpha(T.text, .06)` |
| `rgba(255,255,255,0.07)` | chart gridlines | no | `alpha(T.text, .07)` |
| `rgba(255,255,255,0.08)` | "Tracked results" section `borderTop` | no | `alpha(T.text, .08)` |
| `rgba(255,255,255,0.10)` | `Card` border, PNG frame stroke | no exact | `V2W.border` |
| `rgba(255,255,255,0.15)` | inactive `seg()` border, add-ticker input border | no | `alpha(T.text, .15)` |
| `rgba(255,255,255,0.32)` | hover crosshair | no | `alpha(T.text, .32)` |
| `rgba(255,255,255,0.35)` | zero-count digits, `"None"` section text | no | `alpha(T.text, .35)` |
| `rgba(255,255,255,0.40)` | flagged/break-even dashed line | no | `alpha(T.text, .40)` |
| `rgba(255,255,255,0.45)` | day-table disclosure `▾`/`▸` | no | `alpha(T.text, .45)` |
| `rgba(255,255,255,0.7)` | inactive `seg()` text | no | `alpha(T.text, .70)` |
| `rgba(255,255,255,0.75)` | PNG hint footer | no | `alpha(T.text, .75)` |
| `rgba(0,0,0,0.20)` | flat-table expanded-row cell background | yes — `--color-shadow` `#000000` | `alpha(T.shadow, .20)` |
| `rgba(0,0,0,0.25)` | day-table expanded-row cell background | same | `alpha(T.shadow, .25)` — **see the two-blacks note below** |
| `rgba(0,0,0,0.30)` | add-ticker input background | same | `alpha(T.shadow, .30)` |
| `rgba(10,13,20,0.96)` | chart tooltip fill | no | `alpha(V2.panel, .96)` — `#0a0d14` vs `#0d1119` is invisible at 96% |
| `rgba(142,202,230,0.12 / 0.4 / 0.45 / 0.35 / 0.08)` | `C` chip bg/border, `touched` chip, copy-button idle | no | `alpha(V2.green, …)` |
| `rgba(251,133,1,0.12 / 0.4)` | `P` chip bg + border | no | `alpha(V2.orange, …)` |
| `rgba(48,209,88,0.12 / 0.14 / 0.45 / 0.6)` | `OPEN` chip, copy-success button, tooltip border | no | `alpha(ES_CANDLE_UP, …)` |
| `rgba(255,91,91,0.12 / 0.45 / 0.6)` | `EXPIRED` chip, copy-failed button | no | `alpha(ES_CANDLE_DOWN, …)` |

**Two-greens, two-reds, and a third pair.** This part paints "positive" with
**three different values**: `HT.green #8ECAE6` (flag cards, `Max %`, the detail
table's Δ columns, the `OPENED` count), `PROBE_GRN #30d158` (the probe chart's
high marker, the price pill, the tooltip P/L, the `OPEN` chip) and — for the
`OPEN` status word in the flat table — `HT.green` again while the chip one panel
lower says the same thing in `#30d158`. "Negative" is `HT.red #EF4444` in the
tables and `PROBE_RED #ff5b5b` in the chart and chips. **The same semantic,
rendered two ways, on the same screen at the same time** (open a row: the table's
`OPEN` is `#8ECAE6`, the panel's `OPEN` chip is `#30d158`). Collapse it in the
port: one `MOVE_UP` / `MOVE_DOWN` pair for direction, and keep
`ES_CANDLE_UP`/`ES_CANDLE_DOWN` only if the probe chart must remain
value-for-value identical to the owner site's card. **Ask before splitting** —
see Open questions.

**Two blacks.** The expanded-row cell is `rgba(0,0,0,0.20)` in the flat table and
`rgba(0,0,0,0.25)` in the Results sub-table, for no stated reason. One value.

**"Green" that is blue.** `HT.green` is `#8ECAE6`. Every table header on this tab
is painted with it, as is every positive number. In v3 those are two different
jobs and must not share a token: headers → `V2.green` (or a proper muted-label
token), positive numbers → `MOVE_UP`.

---

### Do not port

| # | Item | Why |
|---|---|---|
| **H207** | `components/scanner/ProbeButton.tsx` in its entirety | **Dead code.** A repo-wide `grep` for `ProbeButton` finds only the file's own definition — no import site anywhere. It also exports a SECOND `useIsOwner()` that duplicates `components/shared/useIsOwner` with different logic (`isOwnerClaim \|\| userId === NEXT_PUBLIC_OWNER_USER_ID`). Do not resurrect either half; if an owner probe action is wanted on a Watch card, write it fresh against the v3 owner gate |
| **H208** | `OutcomeRow.opt_price` | Declared and commented as "the live mid, still carried for the popup", but **nothing in this part reads it** — not the table, not `OutcomeDetailPanel`, not `ProbeChart`. The "now" figure in the panel comes from `probeStats().last`, i.e. the detail endpoint's day series, not this field. Drop it from the v3 type |
| **H209** | `WatchRow.date` | Declared on the type, never rendered anywhere |
| **H210** | `defaultOutcomeSort("results")` | The `"results"` view renders `ResultsByDay`, which never reads `sort`. The state write at H50 is inert for that view |
| **H211** | `OutcomeDetail.touched` (the boolean) and `OutcomeRow.touched` | Both are declared; the UI keys everything off `status` and the DATE fields (`touched_date` / `touchedDate`). Neither boolean is read |
| **H212** | `PageShell` / the `Card` component from `components/shared/PageCard.tsx` | v2-only chrome. v3 has its own shell and card |
| **H213** | Every colour literal in this part | ~40 of them, listed above. v3 non-negotiable #1: no colour literals outside `tokens.css`. **The awkward one is `captureFlagCard`:** its whole design depends on the SVG carrying resolved literals, because a `var()` reference is empty once the SVG is serialised off-DOM. Port it by resolving the tokens to concrete values at capture time (`getComputedStyle(document.documentElement).getPropertyValue(...)`) and injecting them into the clone — do NOT re-introduce a hardcoded palette |
| **H214** | The 120 s flag-list poll's missing visibility check (H196) | v3 non-negotiable #5: a card nobody can see does not paint. The outcomes poll already checks `document.hidden`; the flag poll does not. Both must go through `handle.visible()` / `onVisibility` in v3, and `ProbeChart` (which has no guard at all) with them |
| **H215** | Direct `fetch()` from the component | Five raw `fetch` calls with hand-rolled state (`loading` / `err` / `useRef` race guard). v3 pages use `useFrame` / `useField` / `watchFrame` from `src/data/hooks.ts` |
| **H216** | `catch {}` on `loadOutcomes` (H95) | A silently swallowed error is not a state. v3 needs a real error branch for this table |
| **H217** | `isEmbed` + `target="_top"` (H41) | GexDock-iframe-specific v2 chrome. Only carry it if v3 still embeds this page in a drawer |
| **H218** | `document.getElementById(chartId)` (H181) | Imperative DOM lookup by a string id built from user data. In v3 the chart is mounted through `ChartFrame`; take the element from the handle instead of scraping the document |
| **H219** | The `NaN` holes in `OUTCOME_SORT_VALUE` (H54, H60, H61) | `Number(x)` on a non-numeric value yields `NaN`, which the null test (`== null \|\| === ""`) does not catch, producing an inconsistent comparator. Fix in the port: treat `!Number.isFinite(v)` as null so it sinks with the rest |
| **H220** | `Enter` bypassing the `adding` guard (H15) | The button is `disabled` while a POST is in flight; the `onKeyDown` handler is not. Guard both in v3 |

---

### Open questions for Brandon

1. **`LIGHT_BLUE` is three values.** v2's `homeTheme.LIGHT_BLUE` is `#7dd3fc`;
   `tokens.css` has `--color-v2-lightblue: #7ed3fc` (documented as coming from
   the `.analytics-embed` CSS); and `theme.ts` maps the `LIGHT_BLUE` export to
   `--color-series-5` = `#4fb8d4`, a visibly different, less saturated blue. This
   tab uses `LIGHT_BLUE` on 13 separate elements. Which one does the Watch tab
   ship with?
2. **Does the probe card keep its own palette?** `PROBE_GRN #30d158` /
   `PROBE_RED #ff5b5b` exist verbatim as `--color-candle-up`/`-down`. The stated
   reason for the literals was PNG serialisation, which the port solves
   differently (H213). If value-for-value parity with the owner site's
   `/owner/probe` card is no longer a requirement, the whole `PROBE_*` block
   collapses onto `MOVE_UP`/`MOVE_DOWN` and the two-greens problem disappears.
   Is that parity still required?
3. **The real far-CB selection rule.** No server code for `/proxy/far-cb-watch`
   exists in this tree, so the only transcribable rule is the one the page prints
   (H45): highest `|GEX|` strike per ticker, expiries `≤ 30 DTE`, flagged at
   `> threshold%` OTM, `threshold` supplied by the endpoint with a client-side
   fallback of `15`. Confirm (a) the server's actual default threshold — if it is
   not 15, the fallback string lies whenever the field is missing; (b) whether
   the ranking is `|GEX|` or signed GEX, since the block comment at line 906 and
   the footer string at line 1909 disagree; (c) what "scanner universe" is
   concretely, so the v3 doc can name it.
4. **`quotes=0` on the Results fetch.** `ResultsByDay` never shows a price
   column, so it asks the server not to price 300 contracts. But clicking a row
   in that view opens the SAME detail panel, which fetches its own priced day
   series. Is `quotes=0` still worth it, or should Results just reuse the
   `limit=100` cached page?
5. **300-row ceiling on Results.** The comment calls 300 "the endpoint's
   ceiling". Once the tracker has more than 300 flags, the per-day counts silently
   become partial with nothing on screen saying so. Should v3 page the endpoint,
   or show a "showing the most recent 300" note?
6. **`opt_entry` vs the chart's `entry`.** The flat table's `Entry` column comes
   from `/far-cb-outcomes → opt_entry`, while the panel's `in` figure and the
   chart's `FLAGGED` line come from `/far-cb-outcome-detail → days[first priced].contractClose`.
   These are two different numbers from two endpoints and can disagree on the
   same row. Which is authoritative?
7. **Chart tooltip border is always green** (`rgba(48,209,88,0.45)`, H176) even
   when the hovered P/L is negative. Intentional, or should it follow the P/L
   tone?

---

**Part H row count: 220**

---

**Document total: 1,525 checklist rows** (A 58 · B 335 · C 158 · D 127 · E 118 · F 201 · G 308 · H 220).

STEP 1 of 4 complete. No v3 code has been written.
