# Parity inventory — Economic Calendar + Earnings (`/economic-calendar`)

**What this is.** One line per value the v2 page renders, with where it comes
from, how it is formatted, what changes its colour, and what it shows when the
value is missing. It is the SPEC for the v3 port: the v3 page is finished when
every row here is ticked, and not before.

**Why it exists.** The failure mode this document prevents is rebuilding a page
from scratch — re-deciding what it contains at the same time as building it.
Both jobs were already done in v2. This file finishes the first one so the
second is only construction.

**Scope.** The v2 route `/app/economic-calendar`, which is:

| Layer | File | Lines |
|---|---|---|
| Route | `app-vite/src/App.tsx` → `<Route path="/economic-calendar">` | 41, 101 |
| Next shell (hard refresh) | `app/app/economic-calendar/route.ts` | — |
| View | `components/pages/EconomicCalendar.tsx` | 1303 |
| Shared logic | `lib/econCalendar.ts` | 364 |
| Logo chip | `components/shared/ChipLogo.tsx` | 122 |
| Capture engine | `lib/snapshot.ts` → `captureAndCopy` | — |
| Theme | `components/shared/homeTheme.ts` → `HOME_THEME`, `DOCK_THEME`, `homeShellStyle`, `homeButtonStyle` | — |
| Econ endpoint | `server-v2/api-router.js` → `register('/api/calendar')` | 1474–1754 |
| Quote endpoint | `server-v2/api-router.js` → `register('/api/calendar-quote')` | 595–830 |
| Earnings endpoint | `server-v2/earnings-calendar-recorder.js` → `GET /proxy/earnings-week` | 320–339 |

**OUT of scope.** `components/dashboard/EconCalendarPanel.tsx` is the HOME PANEL,
a different surface — today-only in a narrow sidebar. It is **already ported**
as `cbedge-v3/src/board/econCalendar/EconCalendarCard.tsx`, whose own header
says "the weekly view lives on the full page". That full page is this document.
The phone view `/v3/m/econ` is that same card and is also out of scope.

**Already transcribed, do not redo.** `cbedge-v3/src/data/econCalendar.ts` (514
lines) is a verbatim port of `lib/econCalendar.ts` PLUS the `useEconCalendar`
hook from `hooks/useEconCalendar.ts`, with the five impact literals re-keyed
onto `--color-impact-*`. Every helper Part L needs already exists there:
`CalEvent`, `EarnRow`, `IMPACT_COLOR`, `impactColor`, `fmtMcap`, `etToday`,
`etWeekDays`, `etMonFri`, `etNowParts`, `isStale`, `dayLabel`, `fullDayLabel`,
`FilterKey`, `FILTER_OPTS`, `passes`, `MEGA_CAP`, `ANTICIPATED_PER_DAY`,
`ANTICIPATED_SYMBOLS`, `isAnticipated`, `pickAnticipated`, `EarnBucket`,
`groupEarningsByDate`, `bucketCount`, `useEconCalendar`.

**STATUS: BUILT 2026-09-03.** The three open decisions below were taken and the
page shipped against this checklist — `cbedge-v3/src/pages/EconomicCalendar.tsx`,
verified by `cbedge-v3/scripts/parity-check-econ.mjs`. See "What shipped" at the
end.

**Total: 176 checklist rows.**

| Part | Covers | Rows |
|---|---|---|
| A | Page frame + top bar identity | 8 |
| B | Tab switcher | 6 |
| C | Impact filter dropdown (calendar tab only) | 13 |
| D | Week + view toggles (earnings tab only) | 9 |
| E | MCAP dropdown (both tabs) | 11 |
| F | Search, Copy, Refresh | 12 |
| G | Quote strip, warning banner, error banner, owner gate | 8 |
| H | Calendar tab — render ladder + day separators | 10 |
| I | Calendar tab — the event row | 14 |
| J | Calendar tab — woven earnings blocks (`EarnRowBlock`) | 15 |
| K | Earnings tab — board frame, header, signature | 11 |
| L | Earnings tab — day column | 10 |
| M | Earnings tab — session block + ticker chip | 13 |
| N | Earnings tab — empty-state reason ladder | 5 |
| O | Data layer — endpoints, response shapes, derivations | 20 |
| P | Capture / CopyShot | 8 |
| Q | v2 drift, bugs, and do-not-port | 13 |

**Column meanings**

- **Source** — the endpoint AND the field underneath it, or the exact
  client-side formula. `/proxy/earnings-week → row.market_cap` is a source;
  "the earnings data" is not.
- **Format & units** — decimal places, sign, `$`, font, size, padding. What the
  code actually does, not what looks sensible.
- **Threshold / colour rule** — every condition that changes a colour, a weight
  or the wording. This is where detail goes missing when a page is described
  rather than transcribed.
- **Empty / loading** — literally what renders when the value is not there.

---

## Colour constants used by this page

`HT` = `HOME_THEME` from `components/shared/homeTheme.ts`. The page also
hardcodes **eleven literals that are NOT in HOME_THEME** plus a nine-entry
`BOARD` object of white/cyan washes. All of them are the page's real palette.

**Every one already has a v3 token** — this page is luckier than `/em` was,
because `--color-impact-*` and `--color-cal-*` were added to `tokens.css` for
the board card. Nothing new needs to be minted.

| v2 value | Where used | v3 token to use |
|---|---|---|
| `HT.bg` `#05060A` | page canvas, every event row plate, board wrapper | `V2.bg` |
| `HT.panelBg` `rgba(13,17,25,0.45)` | day separator, tab group, toggle groups, date chip, `BOARD.*` base | `alpha(V2.panel, .45)` |
| `HT.panelBgStrong` `rgba(13,17,25,0.72)` | top bar, quote strip | `alpha(V2.panel, .72)` |
| `HT.border` `rgba(255,255,255,0.10)` | every hairline | `alpha(T.text, .10)` — **not** `--color-line`, which is opaque |
| `HT.text` `#FFFFFF` | all body text | `T.text` |
| `HT.cyan` `#219EBC` | active tab/toggle fill, TODAY pill, weekday, PRE dot, MCAP label | `CAL.accent` (identical to `V2.cyan`) |
| `HT.red` `#EF4444` | High impact, error banner, failed Copy | `CAL.high` (identical to `V2.red`) |
| `HT.orange` `#FB8501` | AFTER-hours session colour | `V2.orange` |
| `#f59e0b` | Medium impact, `F:` forecast, warning banner | `CAL.medium` / `CAL.forecast` |
| `#3a5570` | Low impact, `EarnRowBlock` sub-label, MCAP count | `CAL.low` |
| `#6b7280` | Holiday impact | `CAL.holiday` |
| `#a855f7` | President impact, TRUMP filter swatch | `CAL.president` |
| `#1e2a38` | EVERY faded value in the stale section | `CAL.faded` |
| `#22c55e` | `A:` actual value | `CAL.actual` |
| `#05080d` | ink on the solid cyan TODAY pill, active tab, checkbox tick | `V2.badgeInk` |
| `rgba(0,0,0,0.4)` | search input background | `alpha(SHADOW, .4)` |
| `rgba(33,158,188,0.06)` | today's day-separator tint | `alpha(CAL.accent, .06)` |
| `rgba(245,158,11,0.06)` / `…,0.25` | warning banner fill / border | `alpha(CAL.medium, .06 / .25)` |
| `rgba(239,68,68,0.05)` / `…,0.3` | error banner fill / border | `alpha(CAL.high, .05 / .3)` |
| `DOCK_THEME.bg` | both dropdown panels | `Popover` from `src/board/gexCandles/controls` — it already carries this treatment |
| `DOCK_THEME.cyanTop` `alpha(cyan,.5)` | 2px top accent on a dropdown | `alpha(CAL.accent, .5)` |
| `DOCK_THEME.activeTile` | selected dropdown row | `linear-gradient(180deg, alpha(CAL.accent,.16), alpha(CAL.accent,.04))` |
| `DOCK_THEME.activeBorder` | selected dropdown row border | `alpha(CAL.accent, .30)` |
| `DOCK_THEME.hoverTile` | dropdown row hover | `alpha(CAL.accent, .10)` |
| `DOCK_THEME.shadow` | dropdown float | `0 1px 0 alpha(T.text,.06) inset, 0 20px 44px -14px alpha(SHADOW,.75), 0 6px 16px alpha(SHADOW,.45)` |

### The `BOARD` washes (earnings tab only)

Declared at `EconomicCalendar.tsx:96–118`. Three luminance rungs — `card` is the
lightest thing on the page, `head` one rung up from it, `tile` one rung down —
built as white alpha over `HT.panelBg` rather than as picked hexes, so they keep
tracking the plate.

| Name | v2 value | v3 |
|---|---|---|
| `card` | `linear-gradient(180deg, rgba(255,255,255,.075), rgba(255,255,255,.045)), HT.panelBg` | `alpha(T.text,.075)` → `alpha(T.text,.045)` over `alpha(V2.panel,.45)` |
| `cardToday` | `linear-gradient(180deg, rgba(33,158,188,.16) 0%, rgba(255,255,255,.05) 55%), HT.panelBg` | `alpha(CAL.accent,.16)` → `alpha(T.text,.05)` at 55% |
| `header` | `linear-gradient(180deg, rgba(33,158,188,.18) 0%, rgba(255,255,255,.05) 75%), HT.panelBg` | `alpha(CAL.accent,.18)` → `alpha(T.text,.05)` at 75% |
| `head` | `rgba(255,255,255,0.06)` | `alpha(T.text, .06)` |
| `headToday` | `rgba(33,158,188,0.14)` | `alpha(CAL.accent, .14)` |
| `tile` | `rgba(255,255,255,0.035)` | `alpha(T.text, .035)` |
| `edge` | `rgba(255,255,255,0.16)` | `alpha(T.text, .16)` |
| `edgeToday` | `rgba(33,158,188,0.55)` | `alpha(CAL.accent, .55)` |
| `rule` | `rgba(255,255,255,0.09)` | `alpha(T.text, .09)` |

---

## DECIDED 2026-09-03 (Brandon) — the type scale collapses DOWN

v3's scale is `text-3xs` 9 · `text-2xs` 10 · `text-xs` 11 · `text-sm` 13 ·
`text-base` 15 · `text-lg` 18 (AGENTS.md non-negotiable 1). **This page uses 9,
10, 11, 12, 13 and 14 — and 12 and 14 are not on the scale.** They are not
incidental: 14 is every event title, every event time and every dropdown row;
12 is every country code, every A/F/P figure, the whole board day-header strip,
and the search box.

**DECIDED: collapse.** The mapping below is what shipped, applied uniformly.

| v2 px | Count of uses | → v3 |
|---|---|---|
| 9 | 2 (session label, session count) | `text-3xs` (9) — exact |
| 10 | 12 (impact tag, sub-labels, TODAY pills, chevrons, chip labels) | `text-2xs` (10) — exact |
| 11 | 6 (tab labels, toggle labels, board title/range, `cbedge.net`, board chip label) | `text-xs` (11) — exact |
| 12 | 11 (country, A/F/P, day-separator label, date chip, board day header ×3, search input, `EarnRowBlock` top label) | **`text-xs` (11)** |
| 13 | 1 (board header title) | `text-sm` (13) — exact |
| 14 | 8 (event time, event title, dropdown rows, quote, empty states, error banner, loading) | **`text-sm` (13)** |

Rationale for both collapses being DOWN, kept because it is the reason: v2's 12 and 14 sit beside 11 and 13
respectively in the same rows, and rounding down keeps the size ORDER intact
everywhere on the page. Rounding 14 up to 15 would make an event title larger
than the board header's own title.

---

## Shared page constants

Declared at the top of `EconomicCalendar.tsx`:

- `CHIP_W = 46` — chip column width in the calendar tab's woven earnings row.
- `CHIP_GAP = 10` — flex gap between those chips.
- `CHIP_LOGO = 42` — logo size on the earnings-tab week board.
- `CHIP_MIN = 52` — grid track minimum for the board's chip grid. **Keep in step
  with `CHIP_LOGO`:** logo + 6px padding must stay under the track width, or the
  logo drives the column width instead of the other way round.
- `MONO` — `var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Consolas,
  'Liberation Mono', monospace`. The concrete fallbacks exist ONLY because
  html2canvas clones into an `about:blank` iframe where `:root` custom
  properties are undefined. **v3 captures through `<foreignObject>`, which is a
  real browser — drop the fallback stack and use v3's `tabular` utility.**

---

# Part A — Page frame and top bar identity

Source: lines 810–840. Root carries `shotRef`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Page root | `homeShellStyle` + `height:100%` | `height/width 100%; overflow hidden; display flex; flexDirection column; minHeight 0` | `background HT.bg`, `backgroundImage HT.shellGlow` = two radials — `circle at 15% 50% rgba(33,158,188,.04) → transparent 50%` and `circle at 85% 30% rgba(18,103,131,.05) → transparent 50%`; `fontFamily var(--font-inter)`; `color HT.text` | n/a |
| Top bar | inline | `flex; alignItems center; justifyContent space-between; padding 8px 16px; flexShrink 0` | `background HT.panelBgStrong`, `backdropFilter blur(16px)`, `borderBottom 1px HT.border` | Always renders |
| CB Edge logo | `<img src="/cb-edge-logo.png" alt="CB Edge">` | `height 20; width auto; display block; flexShrink 0` | none | Broken-image alt text; no fallback. **Asset lives in v2's `public/` and is same-origin from `/v3` — reference it as-is** |
| Page title | Static string | `"Economic Calendar"` — `12px / 800`, uppercase, `letterSpacing .15em` | `HT.text` | Always renders |
| Date chip | `etToday()` — ET `YYYY-MM-DD` | `12px`, `var(--font-mono)`, `padding 2px 8px`, `radius 3` | `background HT.panelBg`, `color HT.text` | **Gated on `lastRefresh` being non-null, but displays `today`.** So it is absent on first paint and appears after the first successful load — and never shows the refresh time it is gated on. See Part Q |
| Left cluster | inline | `flex; alignItems center; gap 12` | none | n/a |
| Right cluster | inline | `flex; alignItems center; gap 8` | none | n/a |
| Page chrome above this | v2: `LayoutShell` / `GlobalToolbar` | Outside the component | — | In v3 the equivalent is `Shell.tsx`'s rail + toolbar. **The v3 page must NOT redraw a top bar that duplicates the shell's** — fold the identity row into `Page`'s `title` / `actions` slots and keep only the controls |

---

# Part B — Tab switcher

Source: lines 828–848. State: `activeTab: "calendar" | "earnings"`, default `"calendar"`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Tab group frame | inline | `flex; gap 4; padding 3; radius 6` | `background HT.panelBg`, `border 1px HT.border` | Always renders |
| Tab — "Calendar" | `activeTab` | `11px / 800`, `letterSpacing .06em`, uppercase, `padding 5px 12px`, `radius 4`, `border none`, `cursor pointer` | active: `background HT.cyan`, `color #05080d`. inactive: `background transparent`, `color HT.text`. `transition background .15s, color .15s` | Always renders |
| Tab — "Earnings" | same | same | same | Always renders |
| Tab order | `(["calendar","earnings"] as const).map` | Calendar first, always | — | — |
| Label derivation | `t === "calendar" ? "Calendar" : "Earnings"` | Title case in the source; CSS uppercases it | — | — |
| Tab is NOT in the URL | — | Switching tabs does not push a query param | — | **A shared link always opens on Calendar.** ✅ **FIXED in v3** — `/v3/economic-calendar?tab=earnings`, the shape `/v3/scanner` already uses |

---

# Part C — Impact filter dropdown (calendar tab only)

Source: lines 848–905. Rendered only when `activeTab === "calendar"`.
State: `activeFilters: Set<FilterKey>` default `new Set(["all"])`; `dropOpen`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Trigger button | `homeButtonStyle` + `flex; alignItems center; gap 6` | `padding 5px 10px; radius 6; fontSize 10; fontWeight 700; letterSpacing .08em; uppercase` | `border 1px rgba(33,158,188,.25)`, `background linear-gradient(180deg, rgba(33,158,188,.12), rgba(33,158,188,.04))`, `color HT.cyan` | Always renders on the calendar tab |
| Trigger label | `filterLabel` | `activeFilters.has("all") ? "ALL" : [...activeFilters].map(k => FILTER_OPTS.find(o=>o.value===k)?.label ?? k).join(" + ")` — **`" + "` with spaces**; the home panel uses `"+"` without | `HT.cyan` | `"ALL"` is the first-paint value |
| Trigger chevron | Static `"▾"` | `fontSize 10` | inherits | — |
| Menu panel | `dropOpen` | `position absolute; right 0; top calc(100% + 8px); zIndex 200; padding 6; minWidth 180; radius 14` | `background DOCK_THEME.bg`, `backdropFilter blur(18px)` (+ `-webkit-`), `border 1px HT.border`, `borderTop 2px DOCK_THEME.cyanTop`, `boxShadow DOCK_THEME.shadow` | Closed on first paint |
| Option set + order | **page-local `FILTER_OPTS`** (line 156) | `High · USD` · `High` · `Medium · USD` · `Medium` · `Low · USD` · `Low` · `TRUMP` · `All` — **8 entries, in this exact order** | Swatch colours: `HT.red`, `HT.red`, `#f59e0b`, `#f59e0b`, `#3a5570`, `#3a5570`, `#a855f7`, `HT.text` | — |
| ✅ DECIDED — ship all ten | — | The shared `FILTER_OPTS` has **10** entries — it adds `all-usd` ("All·USD") and `earnings` ("Earnings"), and spells the separators `·` with no spaces | — | **DECIDED 2026-09-03 (Brandon): keep all filters.** v3 imports the shared 10-entry list. `earnings` is the only control that can isolate the woven earnings rows, and this page had no other one. The default active set stays v2's `{all}`, so the first paint is unchanged and earnings are woven by default |
| Option row | inline | `flex; alignItems center; gap 10; padding 8px 12px; radius 8; cursor pointer` | selected: `background DOCK_THEME.activeTile`, `border 1px DOCK_THEME.activeBorder`. unselected: `transparent` + `1px solid transparent` | — |
| Option row hover | `onMouseEnter/Leave` | — | Only when NOT selected: `background DOCK_THEME.hoverTile`, restored to `transparent` on leave | — |
| Option checkbox | `activeFilters.has(o.value)` | `14×14; radius 3; flexShrink 0; flex centred` | `border 2px o.color`; fill `o.color` when on else `transparent` | — |
| Option tick glyph | same | `"✓"` when on, empty string when off — `fontSize 10; fontWeight 900; color #05080d` | — | — |
| Option label | `o.label` | `14px / 600` | `HT.cyan` when selected, `HT.text` when not | — |
| Toggle logic | `toggleFilter` | `key==="all"` → replace the whole set with `{"all"}`. Otherwise: delete `"all"`, then toggle `key`; **if the set becomes empty, add `"all"` back** | Menu stays open on every pick (multi-select) | — |
| Close behaviour | `document.addEventListener("mousedown")` | Closes when the click is outside `dropRef`. The SAME listener also closes `capRef` | Both dropdowns share one listener registered once on mount | — |

---

# Part D — Week and view toggles (earnings tab only)

Source: lines 907–958. Rendered only when `activeTab === "earnings"`.
State: `earnWeek: 0 | 1` default `0`; `earnView: "anticipated" | "all"` default `"anticipated"`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Week group frame | inline | `flex; gap 3; padding 3; radius 6` | `background HT.panelBg`, `border 1px HT.border` | Always renders on the earnings tab |
| Week button — "This wk" | `earnWeek === 0` | `11px / 800; letterSpacing .06em; uppercase; padding 5px 10px; radius 4; border none` | active `background HT.cyan` + `color #05080d`; else `transparent` + `HT.text` | — |
| Week button — "Next wk" | `earnWeek === 1` | same | same | — |
| Week button tooltip | `title` | `` `${dayDate(etMonFri(w)[0])} – ${dayDate(etMonFri(w)[4])}` `` — e.g. `SEP 1 – SEP 5`, **en dash with spaces** | Recomputed per render; `etMonFri` rolls weekends forward | Always present |
| View group frame | inline | identical to the week group | identical | — |
| View button — "Anticipated" | `VIEW_OPTS[0]` | label `"Anticipated"` | active `HT.cyan` / `#05080d` | — |
| View button — "All" | `VIEW_OPTS[1]` | label `"All"` | same | — |
| View tooltips | `o.hint` | Anticipated → `"Most-watched names, ~14 per day"`; All → `"Every name on the Nasdaq calendar"` | — | — |
| Both toggles are FILTERS, not fetches | — | The feed carries `week=both` already, so flipping either re-derives `boardByDate` from rows in hand | No refetch, no spinner, and Copy captures whatever is showing | — |

---

# Part E — MCAP dropdown (BOTH tabs)

Source: lines 960–1010. State: `mcapMin: number` default `0`; `capOpen`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Why it is on both tabs | — | The calendar tab weaves the same earnings rows between events, so the floor has to be reachable from there too | — | — |
| Trigger button | `homeButtonStyle` + `flex; gap 6` | as Part C's trigger | same | Always renders |
| Trigger tooltip | `title` | `"Minimum market cap for earnings names"` | — | — |
| Trigger — "MCAP" tag | Static | inherits `fontSize 10`, `fontWeight 800`, `letterSpacing .06em` | `color HT.cyan` | — |
| Trigger — current value | `mcapLabel` | `MCAP_OPTS.find(o => o.value === mcapMin)?.label ?? "All caps"` | inherits `HT.cyan` | `"All caps"` on first paint |
| Trigger — shown count | `earnShown` | Bare integer, `fontSize 10`, `var(--font-mono)` | `color #3a5570` | `0` while loading |
| `earnShown` derivation | `useMemo` | Sum of `bucketCount(b)` over **the bucketed Map for the tab in view** — `boardByDate` on the earnings tab, `earnByDate` on the calendar tab | So the number matches what is on screen, not the raw feed | — |
| Menu panel | `capOpen` | Same treatment as Part C but `minWidth 170` | same | Closed on first paint |
| Option set + order | `MCAP_OPTS` (line 172) | `All caps` (0) · `≥ $1B` (1e9) · `≥ $10B` (10e9) · `≥ $25B` (25e9) · `≥ $100B` (100e9) · `≥ $1T` (1e12) — **`≥` and a non-breaking-looking regular space** | — | — |
| Option radio | `o.value === mcapMin` | `14×14; borderRadius 50%` | `border 2px HT.cyan`; fill `HT.cyan` when on. Tick `"✓"` `fontSize 9 / 900 / #05080d` | — |
| Select behaviour | `setMcapMin(o.value); setCapOpen(false)` | Single-select; **closes on pick** (unlike Part C) | Label `14px / 600`, `HT.cyan` when on else `HT.text` | — |

---

# Part F — Search, Copy, Refresh

Source: lines 962–1010.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Search input | `search` state | `fontSize 12; padding 4px 10px; radius 3; width 140; outline none` | `background rgba(0,0,0,0.4)`, `border 1px HT.border`, `color HT.text` | — |
| Search placeholder | `activeTab` | `"Search ticker…"` on earnings, `"Search…"` on calendar — single `…` glyph | — | Placeholder IS the empty state |
| Search — calendar tab effect | `filtered` | Case-insensitive substring against `ev.title` **OR** `ev.country` | Applied AFTER `passes()`, so it narrows within the active impact filters | Empty query → no narrowing |
| Search — earnings tab effect | `matchesQ` | Case-insensitive substring against `r.symbol` **OR** `r.company` (`company` may be `""`) | Applied per session bucket, AFTER the cap floor and the anticipated narrowing | Empty query → no narrowing |
| ⚠ Search state is SHARED | — | One `search` string across both tabs | Typing `"fed"` on the calendar tab and switching to earnings silently filters the board by `"fed"` | See Part Q |
| Copy button | `takeShot` | `homeButtonStyle`; `disabled` while `shot === "working"`; `data-noshot="1"` | `color`/`borderColor` → `HT.red` when `failed`, `HT.cyan` when `copied`/`saved`, otherwise the button's own cyan | — |
| Copy label ladder | `shot` | `idle → "⧉ Copy"` · `working → "…"` · `copied → "✓ Copied"` · `saved → "✓ Saved"` · `failed → "✕ Failed"` | Success resets to idle after **2000ms**; failure after **2500ms** | `"⧉ Copy"` on first paint |
| Copy tooltip | `activeTab` | earnings → `"Copy the earnings week board to the clipboard"`; calendar → `"Copy the full calendar to the clipboard"` | — | — |
| Why two success words | — | `copied` = clipboard write succeeded; `saved` = the browser refused the image write and it fell back to a download | The button must say which, or a Firefox user stares at a ✓ wondering why Ctrl+V does nothing | — |
| Refresh button | `load` | `homeButtonStyle`; `disabled={loading}`; `data-noshot="1"` | — | — |
| Refresh label | `loading` | `"…"` while loading, `"↻ Now"` otherwise | — | `"↻ Now"` |
| `data-noshot="1"` | both buttons | Dropped from the html2canvas clone so the page capture does not show a button frozen mid-click | Only matters for the calendar-tab capture; the earnings capture targets the board, which excludes the toolbar outright | **v3 equivalent is `data-capture-hide`** |

---

# Part G — Quote strip, banners, owner gate

Source: lines 989–1030.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Owner derivation | `useAuth()` + `process.env.NEXT_PUBLIC_OWNER_USER_ID` | `isOwnerClaim \|\| (!!ownerId && user?.id === ownerId)` — `ownerId` is `.trim()`ed | **Fails CLOSED.** The `: !!isSignedIn` fallback used elsewhere in v2 would make every signed-in customer an owner in a build missing the env var | Not owner → no diagnostics |
| Quote strip | `quote` state | `padding 10px 20px; textAlign center; flexShrink 0` | `background HT.panelBgStrong`, `backdropFilter blur(16px)`, `borderBottom 1px HT.border` | Rendered only when `activeTab === "calendar"` **AND** `quote` is truthy |
| Quote text | `/api/calendar-quote → quote` | `14px; fontStyle italic; lineHeight 1.7`, wrapped in `&ldquo;` / `&rdquo;` | `HT.text` | Absent until the fetch resolves; never shows a placeholder |
| Warning banner | `warning` state | `padding 6px 16px; fontSize 12` | `color #f59e0b`, `background rgba(245,158,11,0.06)`, `borderBottom 1px rgba(245,158,11,0.25)` | Gated on `activeTab === "calendar" && isOwner && warning && !error` |
| Warning text | `/api/calendar → warning` | `` `⚠ ${warning}` `` — raw upstream string | The hardcoded "showing saved events" prefix was removed: it was wrong when the source was the cache, and `warning` already says which | — |
| Error banner | `error` state | `fontSize 14; padding 16; margin 16; radius 4` | `color HT.red`, `border 1px rgba(239,68,68,0.3)`, `background rgba(239,68,68,0.05)` | Gated on `activeTab === "calendar" && error && isOwner` |
| Error text | `catch (e) { setError(String(e)) }` | `` `⚠ ${error}` `` — `String(e)` on an `Error` yields the `"Error: …"` prefix, which IS what renders | — | — |
| Customer path on error | — | Falls through to the neutral `"No events match."` line — customers never see upstream status text | — | This is deliberate; keep it |

---

# Part H — Calendar tab: render ladder and day separators

Source: lines 1010–1042 (ladder), 571–627 (`renderWithDaySeparators`).

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Scroll box | `scrollRef` | `flex 1; overflowY auto` | none | The capture expands and restores this — see Part P |
| Ladder step 1 | `error && isOwner` | Error banner (Part G) | — | — |
| Ladder step 2 | `loading && events.length === 0` | `"Loading…"` — `14px; textAlign center; marginTop 60` | `HT.text` | This IS the first-paint state |
| Ladder step 3 | `filtered.length === 0` | `"No events match."` — `14px; padding 20` | `HT.text` | Also what a customer sees on a hard feed failure |
| Ladder step 4 | else | `renderWithDaySeparators(activeEvents, false)` then, if `staleEvents.length > 0`: a `1px HT.border` divider with `margin "2px 0"` **only when `activeEvents.length > 0`**, then `renderWithDaySeparators(staleEvents, true)` | — | — |
| Active / stale split | `isStale(e, now)` | `activeEvents` = not stale; `staleEvents` = stale. Both derived from `filtered` | Stale = ET date is past, OR same ET day and `now − eventStart > 30 min`. An event with no `time` is never stale | `now` ticks every 60s, which is the only thing that moves a row across |
| Day grouping | `byDate` Map inside the renderer | Insertion order of `evList`, which is already date-then-time sorted from `load()` | **No `.sort()` in this renderer** — the home panel has one. Correct only because the list arrives sorted | — |
| Day separator | inline | `padding 6px 16px; flex; alignItems center; gap 8` | `background` `rgba(33,158,188,0.06)` when the date is today, else `HT.panelBg`; `borderTop 1px HT.border` | One per date present in the list |
| Day label | `fullDayLabel(date, today)` | `"TODAY"` when `date === today`, else `` new Date(date+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"}).toUpperCase() `` → `"MONDAY SEPTEMBER 1"`. `12px / 800`, `letterSpacing .1em` | `HT.text` on EVERY day, today included — the cyan pill and the tint already mark today | — |
| ✅ DECIDED — long | — | The page's `fullDayLabel` uses `month:"long"`; **`lib/econCalendar.ts`'s uses `month:"short"`** (`"MONDAY SEP 1"`) | **DECIDED 2026-09-03 (Brandon): long.** Shipped as `fullDayLabelLong()` in `src/data/econCalendar.ts`, added BESIDE the short form rather than replacing it — the board card still wants the abbreviation in its narrow strip | — |
| TODAY pill | `date === today` | `"TODAY"` — `10px / 900`, `padding 1px 5px`, `radius 2`, `letterSpacing .1em` | `background HT.cyan`, `color #05080d` | Absent on every other day |

---

# Part I — Calendar tab: the event row

Source: lines 517–570 (`renderEvent`). `faded` is `true` for the whole stale section.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Row frame | inline | `display grid; gridTemplateColumns "80px 1fr"; minHeight 52; transition opacity .4s` | `borderTop 1px HT.border`; `borderLeft 3px` in the impact colour; `opacity` `0.32` when faded else `1` | — |
| Row background | `impact` | faded: flat `HT.bg`. active: `linear-gradient(90deg, ${col}0f 0%, transparent 35%), ${HT.bg}` — **`0f` is a hex alpha suffix (6%)** | `col` = `impactColor(ev.impact)`, or `#1e2a38` when faded | — |
| Row key | — | `` `${ev.date}-${ev.time}-${i}` `` where `i` is a counter across the whole render, not per day | — | — |
| Impact colour map | page-local `IMPACT_COLOR` (line 146) | `High → HT.red` · `Medium → #f59e0b` · `Low → #3a5570` · `Holiday → #6b7280` · `President → #a855f7` | Unknown impact → `#3a5570` | Identical values to `lib`'s and to v3's `--color-impact-*` |
| Time cell | inline | `flex column; justifyContent center; padding 8px 12px; gap 2` | `borderRight 1px HT.border`; `boxShadow` `none` when faded else `inset -1px 0 8px ${col}18` (**`18` = 9% hex alpha**) | — |
| Time value | `ev.time_formatted \|\| ev.time \|\| "TBD"` | `14px`, `var(--font-mono)` | `#1e2a38` when faded, else `HT.text` | Falls back through the 24h form to the literal `"TBD"` |
| Content cell | inline | `padding 8px 14px; flex column; justifyContent center; gap 3` | none | — |
| Impact tag | `ev.impact` | `10px / 800`, uppercase, `letterSpacing .1em` — the raw string (`High`/`Medium`/`Low`/`Holiday`/`President`) | `color col` | Renders whatever the feed sent |
| Country | `ev.country` | `12px / 600` — raw 3-letter code (`USD`, `EUR`, …) | `#1e2a38` when faded, else `HT.text` | — |
| Title | `ev.title` | `14px; lineHeight 1.3`; `fontWeight` **`700` when `impact === "High"`, else `500`** | `#1e2a38` when faded, else `HT.text` | — |
| A/F/P row | `ev.actual \|\| ev.forecast \|\| ev.previous` | `flex; gap 14; marginTop 2` | The whole row is omitted when all three are empty strings | — |
| `A:` actual | `ev.actual` | `` `A: ` `` + the value in `<strong>` — `12px`, `var(--font-mono)` | `#22c55e`, or `#1e2a38` when faded | Omitted when falsy |
| `F:` forecast | `ev.forecast` | `` `F: ${value}` `` — `12px`, mono, no `<strong>` | `#f59e0b`, or `#1e2a38` when faded | Omitted when falsy |
| `P:` previous | `ev.previous` | `` `P: ${value}` `` — `12px`, mono | **`HT.text`, deliberately white not grey** — it is the one body value that read as disabled; `#1e2a38` when faded | Omitted when falsy |

---

# Part J — Calendar tab: woven earnings blocks

Source: lines 610–626 (insertion), 1256–1303 (`EarnRowBlock`), 1246–1252 (`EARN_KIND`).

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Which bucket | `faded ? null : earnByDate.get(date)` | **Earnings are NEVER woven into the stale section** | `earnByDate` is the anticipated-only, cap-floored derivation | No bucket for a date → nothing woven |
| Insertion order (1) | `bucket.pre.length` | PRE block goes immediately after the day separator, before every event | — | Omitted when empty |
| Insertion order (2) | `afterIdx = evs.findIndex(e => (e.time \|\| "00:00") > "16:00")` | AFTER block is inserted **before** the event at `afterIdx` — i.e. before the first event later than 16:00 ET | String comparison on `"HH:MM"`, which is correct for zero-padded 24h | — |
| Insertion order (3) | `afterIdx < 0` | If no event is past 16:00, the AFTER block goes at the **end** of the day's events | — | Omitted when `after` is empty |
| Insertion order (4) | `bucket.tbd.length` | TBD block always LAST — unconfirmed times have no position in the day's sequence, so anchoring them earlier would imply one | — | Omitted when empty |
| Block frame | inline | `grid "80px 1fr"; minHeight 52` | `borderTop 1px HT.border`; `borderLeft 3px k.color`; `background linear-gradient(90deg, ${k.color}12 0%, transparent 40%), ${HT.bg}` (**`12` = 7% hex alpha**) | — |
| `EARN_KIND.pre` | — | top `"PRE"`, sub `"MARKET"`, title `"Premarket earnings"`, board `"Premarket"` | `color HT.cyan` | — |
| `EARN_KIND.after` | — | top `"AFTER"`, sub `"HOURS"`, title `"After-hours earnings"`, board `"After hours"` | `color HT.orange` `#FB8501` — **not cyan; PRE and AFTER used to share one colour** | — |
| `EARN_KIND.tbd` | — | top `"TIME"`, sub `"TBD"`, title `"Time unconfirmed"`, board `"Time unconfirmed"` | `color HT.text` — deliberately desaturated so it never reads as a confirmed session | — |
| Left cell | inline | `padding 8px 12px; flex column; justifyContent center` | `borderRight 1px HT.border`; `boxShadow inset -1px 0 8px ${k.color}18` | — |
| Left cell — top line | `k.top` | `12px / 800`, mono, `lineHeight 1.25` | `color k.color` | — |
| Left cell — sub line | `k.sub` | `10px`, mono | `color #3a5570` | — |
| Right cell — title | `k.title` | `10px / 800`, uppercase, `letterSpacing .1em` | `color k.color` | — |
| Chip strip | `rows` | `flex; flexWrap wrap; gap CHIP_GAP (10)` | Row order is whatever `groupEarningsByDate` produced — i.e. the cap-descending order `pickAnticipated` left | — |
| Chip | `<a>` to `https://finance.yahoo.com/quote/{symbol}` | `target _blank; rel noreferrer`; `flex column; alignItems center; gap 4; width CHIP_W (46); flexShrink 0; textDecoration none` | — | — |
| Chip tooltip | `title` | `` `${company \|\| symbol} · ${fmtMcap(market_cap)}${eps_est ? ` · est ${eps_est}` : ""}` `` | `fmtMcap`: falsy → `"n/a"`; ≥1e12 → `$X.XXT`; ≥1e9 → `$NB` (rounded); else `$NM` (rounded) | `eps_est` null → the ` · est …` tail is omitted entirely |
| Chip logo | `<ChipLogo sym company size={34} radius={8}>` | `lazy` defaults to **true** here | Resolution ladder: `/logos/{SYM}.png?v=3` → `/proxy/ticker-logo?raw=1&sym=…&name=…` → a ticker-text chip | Text chip: `size×size`, `background ${HT.cyan}1A`, `border 1px HT.border`, `fontSize max(9, round(size/3))`, `fontWeight 800`, `color HT.cyan`, content `sym.slice(0,4)` |
| Chip label | `row.symbol` | `10px / 700`, mono, `letterSpacing .02em`, `maxWidth 46`, `overflow hidden; textOverflow ellipsis; whiteSpace nowrap` | `HT.text` | — |

---

# Part K — Earnings tab: board frame, header, signature

Source: lines 665–760 (`renderEarningsOnly`). Wrapper carries `earnRef`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Tab ladder step 1 | `loading && earnings.length === 0` | `"Loading…"` — `14px; textAlign center; marginTop 60` | `HT.text` | First-paint state |
| Tab ladder step 2 | else | `renderEarningsOnly()` | — | — |
| Board wrapper | `earnRef` | `padding 12` | `background HT.bg` | **This is the capture target** — the board alone, not the toolbar |
| Board header frame | inline | `flex; alignItems center; gap 12; flexWrap wrap; padding 10px 12px; marginBottom 10; radius 12` | `border 1px BOARD.edge`, `background BOARD.header`. **No cyan top accent** — it read as an "active panel" cue on something that is not a panel | — |
| Board title | `earnWeek` | `"EARNINGS THIS WEEK"` (0) / `"EARNINGS NEXT WEEK"` (1) — `13px / 900`, `letterSpacing .14em` | `HT.text` | — |
| Board week range | `earningsSections` | `` `${dayDate(first)} – ${dayDate(last)}` `` — e.g. `SEP 1 – SEP 5`. `11px`, `MONO`, `letterSpacing .04em`, `lineHeight 1.3` | `first`/`last` are the first and last **rendered** dates, not `boardDays[0]`/`[4]` — a week whose Monday has no qualifying names shows `SEP 2 – SEP 5` | Never rendered when there are no sections |
| `dayDate` | — | `` toLocaleDateString("en-US",{month:"short",day:"numeric"}).toUpperCase() `` → `"SEP 1"` | — | — |
| `cbedge.net` | Static | `11px / 800`, `MONO`, `lineHeight 1`, `marginLeft auto` | `HT.text` | Always present in the header |
| What is NOT in the header | — | The `N NAMES`, `ANTICIPATED / ALL NAMES` and cap-floor pills were **removed** — each day column prints its own count and the columns themselves are the view | Do not reintroduce them | — |
| Column grid | inline | `display grid; gridTemplateColumns "repeat(auto-fit, minmax(210px, 1fr))"; gap 10; alignItems start` | **`auto-fit`, not `repeat(5)`** — the feed decides how many days come back, and v2's `globals.css` GLOBAL GRID COLLAPSE flattens fixed `repeat(N)` on phones but exempts `auto-fit` | — |
| Signature | `<img src="/cbedge3.0.png" alt="CB Edge">` | `height 56; width auto; display block`, in a `flex; justifyContent flex-end; paddingTop 12` row, **inside `earnRef`** so the capture carries it | 2064×609 (3.4:1) with a **transparent** ground — the `.jpg` version's baked black plate showed as a different rectangle over the board's near-black | Broken-image alt if missing |

---

# Part L — Earnings tab: the day column

Source: lines 1140–1240 (`EarnDayColumn`).

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Column frame | inline | `flex column; minWidth 0; radius 12; overflow hidden` | `border 1px` `BOARD.edgeToday` when today else `BOARD.edge`; `background` `BOARD.cardToday` when today else `BOARD.card` | One per rendered date |
| Header strip | inline | **`display grid; gridTemplateColumns "1fr auto 1fr"; alignItems center; padding 9px 10px`** | `background` `BOARD.headToday` when today else `BOARD.head` | — |
| Why a 3-column grid | — | A flex row with the count pushed right by `margin-left:auto` centres nothing: the date lands wherever the count's width leaves it, so a column showing `11` put its date a few px left of one showing `1`. Equal `1fr` outer tracks make the middle track's centre the strip's centre regardless | **Keep the grid** | — |
| Left track | — | An empty `<span />` | — | — |
| Middle track | inline | `flex; alignItems center; gap 7; justifyContent center` | — | — |
| Weekday | `dayFull(date)` | `` toLocaleDateString("en-US",{weekday:"long"}).toUpperCase() `` → `"MONDAY"`. `12px / 900`, `MONO`, `lineHeight 1`, `letterSpacing .1em` | `color HT.cyan` | — |
| Date | `dayDate(date)` | `"SEP 1"`. `12px / 800`, `MONO`, `lineHeight 1`, `letterSpacing .04em` | `color HT.text` on every day — the cyan weekday and the pill carry the emphasis | — |
| ONE SIZE, ONE FAMILY | — | Weekday, date and count are **all 12px MONO**. They used to be 10px mono and 13px sans; on the live page `align-items:center` reconciles that, in an html2canvas PNG nothing does, so `MONDAY` rode above `AUG 31`. Contrast is carried by weight and colour instead | **v3 renders through `<foreignObject>`, so this is no longer load-bearing — but keep it, because it is also simply correct** | — |
| TODAY pill | `date === today` | `"TODAY"` — `10px / 900`, `MONO`, `padding 3px 5px`, `radius 3`, `letterSpacing .1em`, `lineHeight 1` | `background HT.cyan`, `color #05080d` | Absent on every other column |
| Count | `pre.length + after.length + tbd.length` | Bare integer. `12px / 700`, `MONO`, `lineHeight 1`, `opacity .6`, `justifySelf end` | `color HT.text` | Never zero — a column with no names is not rendered |
| Session order | — | `pre`, then `after`, then `tbd` — each rendered **only when non-empty** | — | — |

---

# Part M — Earnings tab: session block and ticker chip

Source: lines 1075–1138 (`EarnSession`), 1055–1073 (`EarnChip`).

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Session block | inline | `padding "8px 9px 10px"` | `borderTop 1px BOARD.rule` | Omitted when the bucket is empty |
| Session header row | inline | `flex; alignItems center; marginBottom 7` | — | — |
| Session label | `EARN_KIND[kind].board` | `"Premarket"` / `"After hours"` / `"Time unconfirmed"` — **shorter than the calendar tab's `k.title`, because the column is ~200px**. `9px / 900`, uppercase, `letterSpacing .12em`, `display inline-block`, `lineHeight 1` | `color k.color` — cyan / `HT.orange` / `HT.text` | — |
| Session dot | — | `6×6`, `borderRadius 50%`, `marginRight 6`, `display inline-block` — **nested INSIDE the label span, not a flex sibling** | `background k.color` | — |
| Why nested | — | As a flex sibling the dot centred on the ROW, whose height is set by the tallest line box, so it sat mid-line while the 9px caps band sits above that. Nested in a `line-height:1` inline-block it is baseline-aligned and centres to within a third of a pixel of the cap band | **Keep the nesting.** `data-cap-center` / `data-cap-swatch` are html2canvas re-pinning hooks and **do NOT port to v3** | — |
| Session count | `rows.length` | Bare integer. `9px / 700`, `MONO`, `lineHeight 1`, `opacity .6`, `marginLeft auto` | `color HT.text` | — |
| Chip grid | inline | `display grid; gridTemplateColumns "repeat(auto-fill, minmax(52px, 1fr))"; gap 8` | `CHIP_MIN = 52` — see the geometry note under Shared page constants | — |
| Chip | `<a>` to `https://finance.yahoo.com/quote/{symbol}` | `target _blank; rel noreferrer`; `flex column; alignItems center; justifyContent flex-start; gap 6; minWidth 0; padding "7px 3px"; radius 9; textDecoration none` | `background BOARD.tile`, `border 1px BOARD.rule` | — |
| Chip contents | — | **LOGO, then TICKER. Nothing else.** The market-cap line was removed: the board is already ordered by cap and the chips are already picked by it, so it was the same number three times over — and it cost a third line on every tile, which is what made a nine-name Wednesday taller than the fold | Cap and EPS estimate stay one hover away in `title` | — |
| Chip tooltip | `title` | Same string as Part J's chip | — | — |
| Chip logo | `<ChipLogo size={CHIP_LOGO (42)} radius={10} lazy={false}>` | **`lazy={false}` is load-bearing** — html2canvas clones the DOM as it stands, so a chip below the fold that the browser has not fetched captures empty | Same three-stage ladder as Part J | — |
| Chip label | `row.symbol` | `11px / 800`, `MONO`, `letterSpacing .02em`, `lineHeight 1`, `width 100%`, `textAlign center`, ellipsis, nowrap | `HT.text` | — |
| Why `width:100%` + `textAlign:center` | — | `align-items` only centres the SPAN; the text inside a span that stretches to the column needs its own centring | — | — |
| Chip react key | `r.symbol` | Not the date — a symbol appears once per bucket | A symbol reporting twice in one bucket would collide | — |

---

# Part N — Earnings tab: empty-state reason ladder

Source: lines 668–684. Style for all four: `color HT.text; fontSize 14; padding 20`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Ladder exists at all | — | `"No earnings match."` alone reads as an empty feed, but the usual cause is a cap floor set two clicks ago and forgotten | Named reasons, in this exact order | — |
| Reason 1 | `earnings.length === 0` | `"No earnings loaded."` | The fetch returned nothing at all | — |
| Reason 2 | `inWeek === 0` where `inWeek = earnings.filter(r => boardDays.includes(r.date)).length` | `` `Nothing stored for ${dayDate(boardDays[0])}–${dayDate(boardDays[4])} yet.` `` — **en dash with NO spaces**, unlike the header's `" – "` | The recorder has not swept that week | — |
| Reason 3 | `mcapMin > 0 && earnShown === 0` | `` `No earnings ${mcapLabel} this week — try a lower cap.` `` — e.g. `No earnings ≥ $100B this week — try a lower cap.` | Em dash with spaces | — |
| Reason 4 | else | `"No earnings match."` | The search query matched nothing | — |

---

# Part O — Data layer

Source: lines 749–800 (`load`), 1174–1215 (derivations), `lib/econCalendar.ts`, `server-v2/`.

| Item | Source | Format & units | Threshold / rule | Empty / failure state |
|---|---|---|---|---|
| Fetch shape | `load()` | **Three requests in one `Promise.all`, once on mount.** No waterfall | Satisfies v3 non-negotiable 3 as-is | — |
| Polling | — | **None.** Economic events are scheduled days ahead and the server caches 30 min | The only interval is the 60s `now` clock | — |
| `/api/calendar` | GET, `cache: "no-store"` | `{ events: CalEvent[], source: string, warning?: string }` | auth `subscriber`; `Cache-Control: s-maxage=1800, stale-while-revalidate=3600` | — |
| ⚠ `/api/calendar` failure semantics | — | **Answers HTTP 200 with `{ error, warning, source:"unavailable", events: [] }` on a hard failure.** `res.ok` tells you nothing | The real signal is `source` ∈ `forexfactory \| cache \| saved \| unavailable`, plus `warning` | This is how the feed broke unnoticed for six weeks |
| ⚠ The page ignores `source` | — | `load()` reads `warning` but never `source` | v3's `useEconCalendar` exposes both. **Recommend surfacing `source === "unavailable"` in the owner banner** | — |
| `CalEvent` fields | server `normalize()` | `date` (`YYYY-MM-DD` ET) · `time` (`HH:MM` 24h ET — the SORT key) · `time_formatted` (`h:MM AM/PM` ET — the DISPLAY key) · `title` · `country` · `impact` · `forecast` · `previous` · `actual` | Server sorts date then time; the page **re-sorts anyway** | `actual` defaults to `""` |
| Econ upstream | `https://nfs.faireconomy.media/ff_calendar_thisweek.json` | Sun–Sat. `thisweek` is the ONLY file that exists — `nextweek`/`lastweek`/`thismonth` all 404 | Disk cache at `state/econ-calendar-cache.json` **accumulates** (merge, not replace) with a 14-day retain, because the page renders a rolling today→+6 window | Falls back to cache, then `app/api/econ-calendar/events.json`, and only to one that **covers the current window** |
| President events | `https://media-cdn.factba.se/rss/json/trump/calendar-full.json` | `impact: "President"`, `country: "USD"`, 30-min server cache | Excludes titles containing `executive time`, `pool call`, `in-town pool`; de-duplicates to one event per `date-hour` | Failure returns `[]` — silently |
| `/api/calendar-quote` | GET, `cache: "no-store"` | `{ quote: string }` | auth `subscriber`; `Cache-Control: no-store`. Sourced from a Google Sheet via gviz CSV, falls back to a built-in quote list | Read only when `qRes.ok` **and** `qj.quote` is truthy |
| `/proxy/earnings-week?week=both` | GET, `cache: "no-store"` | `{ ok: boolean, rows: EarnRow[] }` | `week` ∈ `this \| next \| both`, default `both` | `earnRes.ok` false → `earnings` stays `[]` |
| Why `week=both` | — | The board's week toggle is a client-side filter over rows already in hand, so flipping it costs nothing | ~2,500 rows across two weeks | — |
| `EarnRow` fields | recorder SQL | `date` (`YYYY-MM-DD` ET) · `symbol` · `company` · `session` · `market_cap` (double) · `eps_est` (text \| null) | Server orders `date ASC, market_cap DESC` | `company` can be `""`; `eps_est` can be `null` |
| `session` derivation | `parseSession(nasdaq.time)` | `"pre"` if the string contains `pre-market`; `"after"` if `after-hours`; else `"unknown"` | Nasdaq marks the large majority "time-not-supplied" — on a typical day ~380 of ~490 rows | `"unknown"` → the `tbd` bucket |
| Recorder floor | `EARNINGS_MIN_MCAP` env | **Defaults to 0 — no floor.** Every name Nasdaq lists is stored | The old $25B server cut is now a *display* rule (`MEGA_CAP`) where it belongs | — |
| Returned range | `getWeekRows` | The **full Mon–Fri** of each requested week, including days already past | `weekMonFri` rolls weekends FORWARD — on a Saturday "this week" starts the coming Monday. `etMonFri` in `lib/econCalendar.ts` must agree or the board asks for a week the server did not store | — |
| `capped(rows)` | `useCallback([mcapMin])` | `mcapMin > 0 ? rows.filter(r => r.market_cap >= mcapMin) : rows` | Applied **before** bucketing, so a day left with no qualifying names drops out of the Map entirely and its separator stops rendering | — |
| `earnByDate` (CALENDAR tab) | `useMemo([earnings, capped])` | `groupEarningsByDate(capped(pickAnticipated(earnings)))` — **always `perDay = 14`** | Non-optional: the feed is the whole Nasdaq calendar and a 400-chip block wedged between two events is not a calendar | — |
| `boardDays` | `useMemo([earnWeek])` | `etMonFri(earnWeek)` — five `YYYY-MM-DD` strings | — | — |
| `boardByDate` (EARNINGS tab) | `useMemo([earnings, boardDays, earnView, capped])` | `groupEarningsByDate(capped(pickAnticipated(earnings.filter(r => boardDays.includes(r.date)), earnView === "all" ? 0 : 14)))` | `perDay <= 0` returns everything, so "All" needs no separate code path | — |
| `pickAnticipated` ordering | `lib/econCalendar.ts:309` | Per day: sort cap-DESC, keep every `isAnticipated` row, **then** top up with the largest remaining caps until `perDay`. `isAnticipated` = `market_cap >= 25e9` **OR** `ANTICIPATED_SYMBOLS.has(symbol)` (a maintained ~700-ticker list) | **The result is NOT globally cap-descending** — the anticipated block comes first, top-ups after, each internally cap-desc. So a listed $5B name (CRDO) precedes a $20B top-up. Transcribe this, do not "fix" it | `perDay <= 0` → `rows` unchanged |
| `earningsSections` | derived | `Array.from(boardByDate.keys()).sort()`, then per date filter each of `pre`/`after`/`tbd` by `matchesQ`, then **drop any section where all three are empty** | Search is applied here and only here | `[]` → the Part N ladder |
| Clock | `setInterval(… , 60_000)` | `now` state. Feeds `isStale()` only | `earnByDate` is memoised on `earnings`, **not** rebuilt on this tick — v2's original code re-bucketed the whole feed 60× an hour for a result that changes once | — |
| ⚠ v3 hook usage | `src/data/econCalendar.ts` | `useEconCalendar` narrows ONCE at `perDay` and returns `earnings` (narrowed), `earningsAll` (raw) and `earnByDate` | **This page needs TWO different narrowings from one feed.** So the v3 page must call `useEconCalendar({ week: "both" })` and derive both maps itself from **`earningsAll`** — do not use the hook's `earnByDate` for the board | — |

---

# Part P — Capture / CopyShot

Source: lines 613–740 (`takeShot`). v2 uses `lib/snapshot.ts → captureAndCopy` (html2canvas).

| Item | v2 behaviour | v3 mapping |
|---|---|---|
| Target — earnings tab | `earnRef` — the week board ALONE. Not the toolbar, not the dropdowns, not the search box. The board carries its own header, so the pasted image is a self-contained card rather than a screenshot of an app | A `CopyShotTarget` with `resolve: () => earnRef.current` |
| Target — calendar tab | `shotRef` — the whole page including the toolbar | A second `CopyShotTarget` |
| Fallback | `earnMode = activeTab === "earnings" && !!earnRef.current` — falls back to the page shell if the board is not mounted (empty week) | Publish the earnings target only when the board is rendered, or keep the same fallback |
| Scroll-box workaround | The list lives in `flex:1; overflow-y:auto` and html2canvas clips to the element's box, so `scrollRef` (`overflowY visible; height auto; flex none`) and the shell (`height auto; overflow visible`) are expanded for the capture and restored in `finally` — **including on the error path** | v3's `shell/snapshot.ts` handles its own layout; verify, then drop |
| Filename | `` `earnings-${earnWeek === 0 ? "this" : "next"}-week-${etToday()}.png` `` or `` `econ-calendar-${etToday()}.png` `` | `CopyShotTarget.file` |
| Options | `background: HT.bg` (else transparent reads black-on-black), `allowTaint: false`, `imageTimeout: 4000`, `height: earnMode ? undefined : el.scrollHeight` | Background → `V2.bg`. The image-timeout and taint flags are html2canvas concerns |
| Tainted-logo hazard | A logo that 302s to a third party taints the canvas and `toBlob` throws `SecurityError`, killing the whole PNG over a 16px image. `ChipLogo` now streams stage 2 through `/proxy/ticker-logo?raw=1` and tags it `data-snap-safe` | **v3's ChipLogo must keep `raw=1`.** Same-origin bytes are the whole reason the board's PNG has logos |
| `data-noshot="1"` | On the Copy and Refresh buttons, so the page capture does not show a button frozen on `"…"` | **`data-capture-hide`** |
| html2canvas-only hacks | `data-cap-center`, `data-cap-swatch`, the `MONO` fallback stack, the one-size-one-family day header | **`data-cap-*` do NOT port** — v3 captures through `<foreignObject>`, which centres correctly. Keep the one-size day header; it is also just correct |

---

# Part Q — v2 drift, bugs, and do-not-port

| # | Item | What it is | What shipped |
|---|---|---|---|
| 1 | Page-local duplicates | The page re-declares `CalEvent`, `EarnRow`, `fmtMcap`, `etToday`, `etNowParts`, `isStale`, `fullDayLabel`, `IMPACT_COLOR`, `impactColor`, `FilterKey`, `FILTER_OPTS` and `passes` — all of which exist in `lib/econCalendar.ts` | ✅ **Every one imported from `@/data/econCalendar`.** Nothing re-declared |
| 2 | `FILTER_OPTS` drift | Page has 8 keys, `lib` has 10 (`all-usd`, `earnings`). Page default is `{all}`; the home panel's is `{all-usd, trump, earnings}` | ✅ **all ten**, default `{all}` |
| 3 | `fullDayLabel` drift | Page uses `month:"long"`, `lib` uses `month:"short"` | ✅ **`fullDayLabelLong()`**, added alongside the short form |
| 4 | Date chip bug (Part A) | Gated on `lastRefresh` but renders `today`. So it is invisible until the first load completes, then shows a date that never changes | ✅ **FIXED.** Renders unconditionally, and carries the refresh time beside the ET date once there is one |
| 5 | `source` dropped (Part O) | The page fetches it and never reads it | ✅ **FIXED.** `source === "unavailable"` raises the owner banner even when `warning` is empty |
| 6 | Shared search state (Part F) | One `search` string across both tabs; a calendar query silently filters the earnings board | ✅ **FIXED.** One query per tab |
| 7 | Stale `MCAP_OPTS` comment | Says "the recorder stores everything at or above EARNINGS_MIN_MCAP (currently $25B)". It is **0** now | ✅ Not carried over |
| 8 | Wrong `earnByDate` comment | Says `"Time TBD" is dropped`. It is not — `groupEarningsByDate` keeps a `tbd` bucket and Part J renders it last | ✅ Not carried over |
| 9 | No tab in the URL (Part B) | `?tab=earnings` does not exist | ✅ **FIXED.** `?tab=earnings`, written with `replace` so Back does not walk the tab history |
| 10 | `components/pages/EconomicCalendar.tsx` JSX | — | **Never imported, never copied.** No `@/app/...` alias, no v2 component, no colour literal (v3 non-negotiable 1) |
| 11 | `components/dashboard/EconCalendarPanel.tsx` | The home panel — a different surface | Out of scope. Already ported as `board/econCalendar/EconCalendarCard.tsx` |
| 12 | `ChipLogo` does not exist in v3 — ✅ **BUILT** | v3 only has raw `/proxy/ticker-logo` URLs inside `board/econCalendar/econTemplate.ts` | **New file needed: `src/pages/economicCalendar/ChipLogo.tsx`**, transcribing the three-stage ladder and `LOGO_REV` (currently **3**). `LOGO_REV` must be bumped in step with v2's whenever `public/logos` gains files |
| 13 | Socket | This page opens none — it is REST-only | Nothing to declare; v3 non-negotiables 2, 4, 5 and 6 are satisfied trivially |

---

# What shipped — 2026-09-03

Four route edits, per `cbedge-v3/AGENTS.md`:

1. `cbedge-v3/src/pages/EconomicCalendar.tsx` — the page.
2. `<Route path="/economic-calendar">`, behind `lazy()`, in `cbedge-v3/src/App.tsx`.
3. A `NAV` entry in `cbedge-v3/src/shell/Shell.tsx` — 📅 "Econ Calendar", with
   `prefetch: ['/api/calendar', '/proxy/earnings-week?week=both']`.
4. `app/v3/economic-calendar/route.ts` in the v2 repo, calling
   `serveSpaShell("v3")`. Without it the page works in-app and 404s on a hard
   refresh — which matters more here than on most pages, because the tab is in
   the query string and a shared link IS a hard refresh.

Supporting files:

- `cbedge-v3/src/pages/economicCalendar/ChipLogo.tsx` — the three-stage logo
  ladder, with `raw=1` on the proxy stage (Part P: a 302 to a third-party host
  taints a capture canvas and takes the whole PNG with it). `LOGO_REV` must be
  bumped in step with v2's whenever `public/logos` gains files.
- `cbedge-v3/src/pages/economicCalendar/board.ts` — the nine `BOARD` washes as
  `alpha()` over tokens, the four chip-geometry constants, `dayFull`/`dayDate`.
- `cbedge-v3/src/data/econCalendar.ts` — `fullDayLabelLong()` added. Nothing
  else in that file was touched; it was already a verbatim transcription.

Read from `@/data/econCalendar` rather than re-declared, per Part Q1: `CalEvent`,
`EarnRow`, `EarnBucket`, `impactColor`, `fmtMcap`, `etToday`, `etMonFri`,
`isStale`, `FILTER_OPTS`, `FilterKey`, `passes`, `pickAnticipated`,
`groupEarningsByDate`, `bucketCount`, `ANTICIPATED_PER_DAY`.

**Departure from Part O worth recording:** the page reads its three feeds through
`useQuery` (`@/data/api`) rather than through the `useEconCalendar` hook. That
hook narrows ONCE, and this page needs two different narrowings out of one feed —
the calendar tab is always the ~14/day anticipated set while the board honours
the Anticipated/All toggle. Reading the raw rows also means the rail's prefetch
primes exactly what the page reads, and that the board card already holding
`/api/calendar` pays for it once. Every derivation in Part O is unchanged.

Verification:

- `cbedge-v3/scripts/parity-check-econ.mjs` — drives BOTH pages through three
  scenarios against one backend (calendar tab; earnings / this week /
  Anticipated; earnings / next week / All) and fails on anything v2 renders and
  v3 does not. 25 probes on the calendar tab, 31 on the earnings tab. The tab is
  reached by CLICKING, not deep-linking, because v2 has no `?tab=` — clicking is
  the one path both sides share.
  Two set probes carry the weight: every ticker each side LINKS to
  (`finance.yahoo.com/quote/<SYM>`), and every market-cap string each side puts
  in a chip TOOLTIP — cap and EPS are on screen nowhere else, so a dropped
  tooltip is invisible to a plain text probe.
  A vacuous run is called out rather than banked: a board with no names, or a
  calendar day with no A/F/P figures, passes its probes for the wrong reason and
  the run says so. Same for the weekend case, where `etMonFri` rolls forward to
  a week the recorder may not have swept.
- `cbedge-v3/scripts/parity-check-econ.test.mjs` — 20 assertions over fixtures,
  each an injected regression this port could plausibly have shipped: the TBD
  bucket dropped (the largest silent loss available, since Nasdaq marks most of
  its calendar time-not-supplied), the after-hours block dropped, chip tooltips
  dropped, `fmtMcap` losing its sub-billion branch so every small cap prints
  "$0B", the A/F/P row dropped, a whole day column dropped. All 20 pass, and
  every injected regression fails the harness as intended.
- Both are wired into `package.json` — `check:parity:econ`,
  `check:parity:econ:self` — and the self-test runs inside `npm run check`.

`npm run check:theme`'s four rules were run against every new and edited file:
no hex, no `rgb()`/`hsl()`, no Tailwind palette class, no off-scale type size.
Clean — nothing was added to `theme-baseline.json`.

**Not run on this machine:** `npm run typecheck`, `npm run build`, and the live
`check:parity:econ` (it needs a browser, a signed-in cookie and the backend up).
Run `npm run check` on the laptop before pushing.
