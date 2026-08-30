# Parity inventory — Traders Dashboard

**What this is.** One line per value the v2 page renders, with where it comes
from, how it is formatted, what changes its colour, and what it shows when the
value is missing. It is the SPEC for the v3 port: the v3 page is finished when
every row here is ticked, and not before.

**Why it exists.** The failure mode this document prevents is rebuilding a page
from scratch — re-deciding what it contains at the same time as building it.
Both jobs were already done in v2. This file finishes the first one so the
second is only construction.

**Scope.** v2's `components/pages/TradersDashboard.tsx` (600 lines) plus the two
components it composes: `components/dashboard/SectorSunburst.tsx` (767 lines,
rendered with all-default props) and `components/shared/CopySnapButton.tsx`.
Every panel, badge, tooltip, toggle, control and column.

**Total: 168 checklist rows.**

| Part | Covers | Rows |
|---|---|---|
| A | Page frame + header card (title, date, two nav buttons, snapshot, weather) | 22 |
| B | Countdown to Market Open/Close | 9 |
| C | Overnight Market Overview (sentiment · futures · movers · drivers) | 28 |
| D | Morning Schedule | 12 |
| E | Pre-Market Tasks | 14 |
| F | S&P Sector Wheel — header, wheel, callouts, hub, tooltip, rails, footer, pop-out | 64 |
| G | Quick Links | 11 |
| H | Prefs round-trip, layout, responsive, dead code | 8 |

**Column meanings**

- **Source** — the endpoint AND the field underneath it, or the exact
  client-side formula where the value is derived. `/api/yahoo-quotes → quotes["ES=F"].pct`
  is a source; "the ES quote" is not.
- **Format & units** — decimal places, sign prefix, `%`, `°F`, `pts`, padding.
  What the code actually does, not what looks sensible.
- **Threshold / colour rule** — every condition that changes a colour, a weight
  or the wording. This is where detail goes missing when a page is described
  rather than transcribed.
- **Empty / loading** — literally what renders when the value is not there.

**v2 colour constants** (`components/shared/homeTheme.ts`, `HOME_THEME as HT`).
Named here because every colour rule below refers to them, and because two of
them are not the colour their name suggests:

| Token | Hex | Note |
|---|---|---|
| `HT.bg` | `#05060A` | |
| `HT.panel` | `#0D1119` | |
| `HT.cyan` | `#219EBC` | |
| `HT.purple` | `#126783` | a dark teal, not a violet |
| `HT.orange` | `#FB8501` | |
| `HT.green` | `#8ECAE6` | **a light blue** — this is the "up" colour on this page |
| `HT.red` | `#EF4444` | |
| `HT.muted` | `#FFFFFF` | identical to `HT.text`; "muted" is achieved with `opacity`, not hue |
| `HT.text` | `#FFFFFF` | |
| `HT.border` | `rgba(255,255,255,0.10)` | |
| `HT.panelBg` | `rgba(13,17,25,0.45)` | |
| `HT.panelBgStrong` | `rgba(13,17,25,0.72)` | |

`rgba(hex, a)` is a local helper in both files (identical implementations).

**Shared inline styles** (declared once in `TradersDashboard.tsx`, referenced by
name throughout the tables below):

- `sectionLabel` = `12px / 700 / letterSpacing .12em / uppercase / HT.muted`
- `miniBtn` = `padding 3px 8px · radius 5 · 1px HT.border · bg rgba(HT.text,.04) · HT.cyan · 10px/700 · pointer`
- `inputStyle` = `14px · padding 5px 8px · 1px HT.border · radius 5 · bg rgba(0,0,0,.4) · HT.text · outline none`

**A note on `Card`.** Every card is `<Card accent="…" variant="classic">`. The
`accent` prop is **dead in v2** — `components/shared/PageCard.tsx` ignores it
entirely (see its header comment: "Card accents are DEAD"). The accent names in
the section headings below are recorded only because they are in the source;
they paint nothing. Do not port them as a colour.

---

# Part A — Page frame and header card

Source: `components/pages/TradersDashboard.tsx` lines 302–389.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Page shell | `<PageShell maxWidth={1200}>` | Content column capped at 1200px, `marginInline:auto`, `overflow:auto`; column gap inherited from `homeContentStyle` | none | n/a |
| Snapshot capture wrapper | `snapRef` `<div>` wrapping the whole column | `display:flex; flexDirection:column; gap:clamp(16px,2vw,32px)` — repeats PageShell's gap explicitly because this div breaks the inheritance chain | none | n/a |
| Header card | `<Card accent="cyan" variant="classic" padding={20}>` | `flex; align:center; justify:space-between; wrap; gap:12` | `accent` is ignored by `PageCard.tsx` — no colour | n/a |
| `<h1>` "Traders Dashboard" | Static string | `30px / 800`, `margin:0` | Fill is `linear-gradient(90deg, HT.cyan, HT.purple)` + `WebkitBackgroundClip:text` + `WebkitTextFillColor:transparent`. Carries `data-snap-plain={HT.cyan}` so the snapshot renderer flattens it to solid `HT.cyan` (gradient text cannot be rasterised) | Always renders |
| Date line | `now.toLocaleDateString("en-US", {weekday:"long", month:"long", day:"numeric", year:"numeric"})` | `"Sunday, August 30, 2026"` — **browser-local timezone, not ET** | `HT.muted`, `14px`, `marginTop:4` | Empty string (`""`, blank line) until the clock effect's first tick sets `now` |
| Header right cluster | — | `flex; align:center; gap:14; wrap; justify:flex-end` | none | n/a |
| "🌅 Premarket Prep →" button | `next/link` → `/premarket`, `prefetch={false}` | `inline-flex; gap 8; padding 9px 14px; radius 8; 13px/700; letterSpacing .04em; whiteSpace nowrap` | Border `rgba(HT.orange,.55)`; bg `linear-gradient(180deg, rgba(HT.orange,.20), rgba(HT.orange,.06))`; text `HT.text`; trailing `→` in `HT.orange`. **Hover**: border → `HT.orange`, bg → flat `rgba(HT.orange,.28)`. Transition `background .15s, border-color .15s` | Always renders |
| "🗓 Economic Calendar →" button | `next/link` → `/economic-calendar`, `prefetch={false}` | Same metrics as above | Identical rule set with `HT.purple` substituted for `HT.orange` throughout (border `.55`, gradient `.20→.06`, hover `.28`, arrow `HT.purple`) | Always renders |
| Snapshot button — idle label | `CopySnapButton` (`components/shared/CopySnapButton.tsx`), `targetRef={snapRef}` | `"📸 Snapshot"` — `padding 6px 12px; radius 6; 11px/700; letterSpacing .08em; nowrap` | Colour `HT.cyan`; border `rgba(33,158,188,.35)`; bg `linear-gradient(180deg, rgba(33,158,188,.12), rgba(33,158,188,.04))` | n/a |
| Snapshot button — working label | `state === "working"` | `"Capturing…"` | Colour `HT.cyan`, `opacity .65`, `cursor:default`, click is a no-op while working | n/a |
| Snapshot button — copied label | `captureAndCopy()` returned `"copied"` | `"✓ Copied"` | Colour `HT.green`, border = the same colour. Reverts to idle after **2200 ms** | n/a |
| Snapshot button — saved label | returned `"saved"` (clipboard blocked → file download fallback) | `"✓ Downloaded"` | Colour `HT.green`. 2200 ms revert | n/a |
| Snapshot button — error label | thrown / returned `"err"` | `"✕ Failed"` | Colour `HT.red`. 2200 ms revert. Also `console.error("[CopySnapButton]", e)` | n/a |
| Snapshot button — tooltip | Static `title` | `"Copy a PNG of this page to the clipboard"` | none | n/a |
| Snapshot output filename | Prop | `traders-dashboard.png` | Used only on the download fallback | n/a |
| Snapshot capture scope | `snapRef` subtree | Header card **included**, app chrome (GlobalToolbar/docks) **excluded** | Elements marked `data-capture-hide` are dropped from the PNG; elements marked `data-snap-plain="{hex}"` are flattened to that solid colour | n/a |
| Weather — temperature | `/api/weather?zip={zip}` → `tempF` (`Math.round(open-meteo current.temperature_2m)`, `temperature_unit=fahrenheit`) | `"☀ {n}°F"` — integer, `22px / 700` | Colour `HT.green` — **unconditional**, it is not a warm/cold ramp | Whole block is replaced by the ZIP form when `weather === null` |
| Weather — condition + place | Same response → `condition`, `place` | `"{condition}, {place}"`, `12px`, `HT.muted` | `condition` = WMO code map (0 Clear · 1 Mainly Clear · 2 Partly Cloudy · 3 Overcast · 45 Fog · 48 Rime Fog · 51/53/55 Drizzle · 61/63/65 Rain · 66/67 Freezing Rain · 71/73/75 Snow · 77 Snow Grains · 80/81 Rain Showers · 82 Violent Showers · 85/86 Snow Showers · 95/96/99 Thunderstorm); any other code → `"—"`. `place` = `"{city}, {ST}"`, or bare city when the geocoder returns no state | See above |
| Weather — "Change ZIP" button | Client action | `miniBtn`, `marginTop:4` | Clears `weather`, `zip`, `zipInput` **and** POSTs `{zip:null}` so the clear is persisted | Rendered only while `weather` is non-null |
| ZIP entry — input | `zipInput` client state | `inputStyle` + `width:80`, `placeholder="ZIP"`, `maxLength={5}` | none | This IS the empty state for the weather block |
| ZIP entry — "Set" button | Form submit | `miniBtn` | Submit is **silently ignored** unless `/^\d{5}$/` matches the trimmed value — no validation message. On success sets `zip` and POSTs `{zip}` | n/a |
| Weather fetch trigger | `useEffect` on `zip` | `fetch("/api/weather?zip=…", {cache:"no-store"})` | Fires only when `zip` is truthy; `loadWeather` additionally re-tests `/^\d{5}$/` and returns early. Non-OK response or a throw → `setWeather(null)` (falls back to the form) | No spinner, no error text — a failed lookup is indistinguishable from "no ZIP set" |

**Sort order.** Header right cluster, left → right: Premarket Prep, Economic
Calendar, Snapshot, weather/ZIP block.

---

# Part B — Countdown card

`<Card accent="orange" variant="classic" padding="28px 20px" style={{textAlign:"center"}}>`,
first card in the left column. Logic at lines 228–274.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card heading | `phase` (derived) | `17px / 600`, `marginBottom:10` | `phase === "close"` → `"Countdown to Market Close"`; else `"Countdown to Market Open"` | Before the first tick `phase` is `"open"` → "Countdown to Market Open" |
| Countdown value | `deltaSec` (derived, recomputed every 1 s) | `HH:MM:SS`, each part zero-padded to 2; prefixed `"{d}d "` when `days > 0`. `fontSize: clamp(48px, 8vw, 84px)`, `800`, `letterSpacing:2`, `fontVariantNumeric:tabular-nums` | No colour rule — inherits body text | `"--:--:--"` on the server render and until the first client tick |
| Target label | `label` (derived) | `HT.muted`, `14px`, `marginTop:8` | Market open → `"Target: 4:00 PM EST"`. Pre-open on a trading day → `"Target: 9:30 AM EST"`. Otherwise → `` `Target: {weekday} 9:30 AM EST` `` where weekday is `toLocaleDateString("en-US",{weekday:"long",timeZone:"America/New_York"})` of the next trading day | Before the first tick the label is `"9:30 AM EST"` — **note the missing `"Target: "` prefix**; it is a different string from the pre-open one |
| Current-time derivation | `Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(now)` | `nowSec = hh*3600 + mm*60 + ss` | `hh === 24` is coerced to `0` (some ICU builds emit 24 for midnight) | n/a |
| Session bounds | Constants | `OPEN = 34200` (09:30 ET), `CLOSE = 57600` (16:00 ET) | `isOpen = tradingToday && nowSec >= OPEN && nowSec < CLOSE` | n/a |
| Trading-day test | `isTradingDay(d)` | — | ET weekday not `"Sat"`/`"Sun"` **and** ET `YYYY-MM-DD` not in `MARKET_HOLIDAYS` | n/a |
| Holiday set | `MARKET_HOLIDAYS` — 20 hardcoded ET dates | `2026-01-01, 01-19, 02-16, 04-03, 05-25, 06-19, 07-03, 09-07, 11-26, 12-25; 2027-01-01, 01-18, 02-15, 03-26, 05-31, 06-18, 07-05, 09-06, 11-25, 12-24` | Full-day NYSE/Cboe closures only — **no early-close (13:00) handling**; the countdown still targets 16:00 on a half day. Comment says "keep in sync with server-v2" | n/a |
| Next-open walk | `do { dayCursor.setDate(+1) } while (!isTradingDay && addedDays < 14)` | `deltaSec = secToMidnight + (addedDays-1)*86400 + OPEN` | Gives up after 14 days and uses whatever cursor it reached | n/a |
| Clock tick | `setInterval(() => setNow(new Date()), 1000)` | 1 Hz | Runs unconditionally, including while the tab is hidden | `now` starts `null` |

---

# Part C — Overnight Market Overview card

`<Card accent="green" variant="classic" padding={20}>`, second card in the left
column. Lines 403–485.

### C1 — Card head and sentiment

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "📈 Overnight Market Overview" | Static | `17px / 700` | none | Always renders |
| "Generated {time} ET" chip | `/api/traders-dashboard/overview` → `overview.generated_at` (epoch ms) | `` `Generated {h:mm AM/PM} ET` `` via `toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit"})`; `10px`, `HT.muted` | Rendered only when `overview && Number(overview.generated_at) > 0` | Chip absent entirely — no placeholder |
| Sentiment block frame | — | `borderLeft: 3px solid HT.cyan; paddingLeft:14; marginBottom:20; color: rgba(HT.text,.78); 14px; lineHeight 1.5` | Border colour is fixed cyan, not sentiment-driven | Frame always renders |
| Sentiment text | `overview.summary` (free text written by the 07:00 ET generator) | `"**Sentiment:** {summary}"` — the `Sentiment:` label is `<strong>` in `HT.text`, the body inherits `rgba(HT.text,.78)` | none | `HT.muted` italic-free sentence: `"Today's overview is generated automatically at 7:00 AM ET. Check back shortly."` |
| Two-column body | — | `grid`, `isMobile ? "1fr" : "1fr 1fr"`, `gap:24`, each column `minWidth:0` | `isMobile` from `useMobileNav()` | n/a |

### C2 — Overnight Futures (Live)

Poll: `/api/yahoo-quotes?symbols=ES%3DF,NQ%3DF,YM%3DF&_={Date.now()}`,
`cache:"no-store"`, immediately on mount then **every 60 000 ms**. The response
is a map keyed by the Yahoo symbol, value `{price, change, pct, time}`.
`pct = (regularMarketPrice − (chartPreviousClose ?? previousClose)) / prevClose × 100`;
Yahoo is queried with `interval=1d&range=5d&includePrePost=true`, and `price`
falls back to the last finite `close` in the series when `meta.regularMarketPrice`
is absent. Any non-OK response or throw → all four fields `null`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "📉 Overnight Futures (Live)" | Static | `sectionLabel`, `marginBottom:10` | none | Always renders |
| Tile row | — | `flex; gap:10; marginBottom:20`, three equal `flex:1` tiles | none | Row always renders — the tiles show `"—"` |
| Tile chrome | — | `padding 10px 6px; radius 8; 1px HT.border; bg rgba(0,0,0,0.25); textAlign center` | none | n/a |
| Tile symbol — ES | Constant `FUTURES[0].sym` | `"ES"`, `12px / 700`, `HT.muted` | none | n/a |
| Tile symbol — NQ | `FUTURES[1].sym` | `"NQ"` | none | n/a |
| Tile symbol — YM | `FUTURES[2].sym` | `"YM"` | none | n/a |
| Tile value (each of 3) | `quotes["ES=F"\|"NQ=F"\|"YM=F"].pct` | `` `{+|}{pct.toFixed(2)}%` `` — 2 dp, `+` prefix only on non-negatives, no thousands separator; `14px / 700` | `pos = (pct ?? 0) >= 0`. `pct == null` → `HT.muted`; `pos` → `HT.green`; else `HT.red`. **`pct === 0` renders `"+0.00%"` in green** | `"—"` in `HT.muted` |

**Sort order.** Fixed: ES, NQ, YM (declaration order of `FUTURES`).

### C3 — Trending Now

Source precedence: `liveMovers` (from `/api/premarket-movers`, polled on mount
then **every 300 000 ms**) when `liveMovers.length > 0`; otherwise
`overview.movers ?? []` from the 07:00 ET generator payload.

`/api/premarket-movers` builds its list from `/proxy/quotes` over
`SCANNER_MOVERS` (`lib/scannerTickers`, indices and funds stripped):
`pct = (mark||last − prevClose||close) / base × 100`, dropped when either side is
0; sorted `pct` descending; response `movers` = `[...top5, ...bottom5.reverse()]`
de-duplicated by symbol — so the rendered list is **at most 10 rows, best-first
then worst-first**, and it is not re-sorted client-side.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "🔥 Trending Now" | Static | `sectionLabel`, `marginBottom:10` | none | Always renders |
| Row chrome | — | `flex; space-between; padding 5px 8px; radius 6; bg rgba(0,0,0,0.2); 1px HT.border`; `gap:4` between rows | none | Replaced wholesale by the empty box below |
| Row — symbol | `mover.symbol` | `12px / 700` | Colour `HT.cyan` — always | n/a |
| Row — name | `mover.name` | Truncated: `name.length > 18 ? name.slice(0,18) + "…" : name`; `10px`, `HT.muted`, `marginLeft:6` | none. **Note:** `/api/premarket-movers` sets `name = symbol`, so live rows print the ticker twice; only the AI `overview.movers` payload carries a real company name | n/a |
| Row — percent | `displayPct = mover.preMarketPct ?? mover.pct` | `` `{+|}{n.toFixed(2)}%` ``, `12px / 700` | `pos = (displayPct ?? 0) >= 0`. `null` → `HT.muted`; `pos` → `HT.green`; else `HT.red` | `"—"` |
| Row — "PM" tag | `mover.preMarketPct != null` | `"PM"`, `10px`, `HT.muted`, `marginLeft:4` | Shown only when `preMarketPct` is non-null. The API sets `preMarketPrice`/`preMarketPct` only when the ET clock is `< 09:30` or `>= 16:00`, so the tag is an extended-hours marker | Tag absent |
| Empty box | `(liveMovers.length ? liveMovers : overview?.movers ?? []).length === 0` | `padding 14px 12px; radius 8; 1px **dashed** HT.border; bg rgba(0,0,0,0.2); 12px; textAlign center; HT.muted` | — | Text: `"Available after 7 AM ET overview generates."` |

### C4 — Key Drivers Today

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "🗓 Key Drivers Today" | Static | `sectionLabel`, `marginBottom:10` | none | Always renders |
| Driver list | `drivers` memo | `flex column; gap:12` | Primary: `overview.drivers.slice(0,4)`. Fallback when the overview has no drivers: `/api/calendar` → `events` filtered to `e.date === {today in ET, en-CA}` **and** `e.country === "USD"` **and** `/high/i.test(e.impact)`, then `.slice(0,4)` | See empty row below |
| Driver — accent bar | `DRIVER_COLORS[i % 4]` | `borderLeft: 3px solid {c}`; item `padding: 8px 0 8px 12px` | Ramp **in order**: `[HT.cyan, HT.orange, HT.red, HT.purple]`, cycling by index | n/a |
| Driver — "when" | `d.when` | `10px / 700`, `letterSpacing .08em`, `textTransform uppercase`, colour = the same `DRIVER_COLORS[i%4]` | Fallback path uses `e.time_formatted \|\| "Today"` | n/a |
| Driver — title | `d.title` | `700`, `margin: 2px 0`, inherits `HT.text` | Fallback path uses `e.title` verbatim | n/a |
| Driver — body | `d.body` | `HT.muted`, `12px`, `lineHeight 1.4` | Fallback path synthesises `` `High-impact USD event · {e.country}` `` (so always `"… · USD"`) | n/a |
| Drivers empty | `drivers.length === 0` | `HT.muted`, `12px` | — | `"No major USD events scheduled today."` |
| Calendar fetch | `/api/calendar`, `cache:"no-store"`, **once on mount, no poll** | Accepts either `{events:[…]}` or a bare array; anything else → `[]` | Event shape used: `{date, time_formatted, title, country, impact}` | Silent — a failed calendar fetch is indistinguishable from "no high-impact events" |
| Overview fetch | `/api/traders-dashboard/overview`, `cache:"no-store"`, **once on mount, no poll** | `{overview: {date, summary, drivers[], movers[], generated_at}}`; applied only when `j.overview` is truthy | GET returns the latest row regardless of date (`getLatestTdOverview`) unless `?date=` is passed — the page never passes it | `overview` stays `null` → sentiment placeholder, movers empty box, calendar-derived drivers |

---

# Part D — Morning Schedule card

`<Card accent="red" variant="classic" padding={20}>`, first card in the right
column. Lines 492–515.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "🕐 Morning Schedule" | Static | `17px / 700` | Colour `HT.red` | Always renders |
| Edit / Done button | `editSched` client state | `miniBtn` | Label is `"Done"` while editing, `"Edit"` otherwise | n/a |
| Hint line | Static | `12px`, `HT.muted`, `marginBottom:12` | `"These are sample times — tap "` + `Edit` in `HT.cyan` `700` + `" to swap in your own routine."` | Always shown, in both modes |
| Row list | `schedule` | `flex column; gap:10` | none | An empty array renders nothing (no placeholder) |
| Row — time (view) | `item.time` | Free text, `fontFamily: var(--font-mono)`, `12px / 700`, `HT.muted`, `whiteSpace nowrap` | none — it is a stored string, never parsed or validated | n/a |
| Row — label (view) | `item.label` | Inherits `14px` body text | **`fontWeight: 700` for the LAST row only** (`i === schedule.length - 1`), `500` for every other row — the "Market Open" emphasis | n/a |
| Row — time (edit) | Same | `inputStyle` + `width:90` | Every keystroke calls `updSchedule` → `setSchedule` **and** a POST (no debounce despite the code comment) | n/a |
| Row — label (edit) | Same | `inputStyle` + `flex:1; minWidth:0` | As above | n/a |
| Row — delete (edit) | Client action | `miniBtn` with `color: HT.red`, glyph `"✕"` | Removes by `id`, no confirmation | n/a |
| "+ Add" button | Client action | `miniBtn`, `marginTop:12` | Rendered only while `editSched`. Appends `{id: uid(), time: "09:00 AM", label: "New item"}` | n/a |
| Default rows | `DEFAULT_SCHEDULE` | 4 rows: `08:00 AM Coffee & Market Review` · `08:30 AM Daily Planning` · `09:00 AM Pre-Market Analysis` · `09:30 AM Market Open` | Used when the prefs GET returns no `schedule`, an empty array, or fails | n/a |
| Row id generator | `uid()` | `Math.random().toString(36).slice(2,9)` — 7 chars | Not collision-checked | n/a |

**Sort order.** Insertion order as stored. No sorting by time — a row typed out
of sequence stays where it is.

---

# Part E — Pre-Market Tasks card

`<Card accent="green" variant="classic" padding={20}>`, second in the right
column. Lines 518–550.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "✅ Pre-Market Tasks" | Static | `17px / 700` | Colour `HT.green` | Always renders |
| Edit / Done button | `editTasks` | `miniBtn` | `"Done"` while editing, else `"Edit"` | n/a |
| Hint line | Static | `12px`, `HT.muted`, `marginBottom:12` | `"Sample tasks — tap "` + `Edit` in **`HT.green`** `700` + `" to make them your own."` — note this hint's accent differs from the Schedule card's cyan | Always shown |
| Row list | `tasks` | `flex column; gap:12` | none | Empty array renders nothing |
| Row — checkbox (view) | `task.done` | `<input type="checkbox">`, `16×16`, `marginTop:2`, `accentColor: HT.green` | Toggling writes through `updTasks` (state + POST) | n/a |
| Row — label (view) | `task.label` | `14px` | `done` → `HT.muted` + `textDecoration: line-through`; otherwise `HT.text`, no decoration | n/a |
| Row — label (edit) | Same | `inputStyle` + `flex:1; minWidth:0` | Per-keystroke POST | n/a |
| Row — delete (edit) | Client action | `miniBtn` with `color: HT.red`, `"✕"` | Removes by `id`, no confirmation | n/a |
| "+ Add" button | Client action | `miniBtn`, `marginTop:12` | Edit mode only. Appends `{id: uid(), label: "New task", done: false}` | n/a |
| Progress — heading row | Derived | `"Task Progress"` left, `"{n}%"` right; `12px`, `HT.muted`, `justify:space-between`, `marginBottom:6` | Whole progress block is rendered **only when NOT editing** (`!editTasks`), inside `marginTop:18` | Hidden in edit mode |
| Progress — percent | `Math.round(completed / tasks.length * 100)` | Integer + `%` | `tasks.length === 0` → `0` (guarded, no NaN) | `"0%"` |
| Progress — track | — | `height:4; radius:2; bg rgba(HT.text,0.08); overflow hidden` | none | Renders at 0 width fill |
| Progress — fill | Same percent | `width: "{progress}%"`, `height:100%` | Fill is `linear-gradient(90deg, HT.cyan, HT.green)`; `transition: width .3s` | n/a |
| Default rows | `DEFAULT_TASKS` | 4 rows, all `done:false`: `"Review portfolio allocations"` · `"Prepare presentation slides for the 2 PM meeting"` · `"Quick workout (15 mins)"` · `"Check pre-market volume on watch list"` | Used when prefs GET returns no `tasks` | n/a |

---

# Part F — S&P Sector Wheel card

`<Card accent="cyan" variant="classic" padding={20}><SectorSunburst /></Card>`,
third in the right column. **All props default**: `maxWheel` undefined (so
`compact === false`), `showMovers === true`, `fill === false`.

Source: `components/dashboard/SectorSunburst.tsx`. No chart library — every arc
is a hand-built SVG path.

**Feed.** `/api/spx-sunburst`, `cache:"no-store"`, on mount then every
**300 000 ms**. Payload `{rows:[{t,s,i,w,c}], updatedAt, covered, universe,
stale?}` where `t`=ticker, `s`=GICS sector, `i`=industry, `w`=approx market cap
in $B (arc width only), `c`=% change vs the prior regular close. Server-side the
route sweeps `SPX_UNIVERSE_SYMBOLS` through `/proxy/quotes` in chunks of 50,
computes `c = (mark||last − prevClose||close)/base × 100`, **drops any name
missing either side**, and caches the result for `SPX_SUNBURST_TTL_MS` (default
15 min) with a single in-flight sweep shared across concurrent misses. On an
upstream failure within a further 60 min it re-serves the cached body with
`stale: true`; past that it returns HTTP 502. A response is only accepted
client-side when `Array.isArray(j.rows) && j.rows.length` — a 502 or an empty
body leaves the previous wheel on screen and sets `err`.

**Geometry constants.** `VB = 440` viewBox (square, `width:100%`), `R = 208`,
`R0 = 0.54R = 112.32` (zero ring), `AMP = 0.33R = 68.64` (bar length at full
scale), `CLAMP = 1.06`, `R_CALL = 0.955R` (callout ring), `TAU = 2π`.
Ring radii, un-zoomed `RING_ALL`: hole `0.30R`, sector ring out `0.44R`,
industry ring out `0.52R`. Zoomed `RING_FOCUS`: hole `0.30R`, sector out
`0.325R` (collapses to a thin accent band), industry out `0.52R`.

**Colour helpers.** `MID = mix(HT.panel, HT.text, 0.16)`.
`fillFor(v) = mix(MID, v>=0 ? HT.green : HT.red, clamp(|v|/cap, 0.24, 1))`.
`ringFill(v, strength) = mix(HT.panel, v>=0 ? HT.green : HT.red, (0.34 + 0.66·min(1, |v|/cap)) · strength)`.
`inkOn(hex)` picks `HT.bg` when relative luminance `> 0.32`, else `HT.text`.
`fmt(v) = "{+|−}{|v|.toFixed(2)}%"` — **U+2212 MINUS SIGN, not a hyphen**.

### F1 — Card header and controls

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "🌐 S&P Sector Wheel" | Static | `17px / 700` inline, `20px` when popped out | Colour `HT.cyan` | Always renders |
| Control cluster | — | `flex; gap:4; align center`; carries **`data-capture-hide`** so it is stripped from any snapshot | none | n/a |
| Cap toggle "2%" | `cap` client state, from `CAPS = [2,3,5]` | `padding 2px 7px; radius 4; 10px/700` | Active: `1px HT.cyan`, `bg rgba(HT.cyan,.14)`, colour `HT.cyan`, `opacity 1`. Inactive: `1px HT.border`, transparent, `HT.muted`, `opacity .6` | n/a |
| Cap toggle "3%" | Same | Same | **Default selected** (`useState(3)`) | n/a |
| Cap toggle "5%" | Same | Same | Same rule | n/a |
| Cap semantics | `cap` | — | It is the full-scale bound of the bar/colour ramp: a name at `|c| >= cap` paints a full-length, full-saturation bar. It rescales the wheel only — it filters nothing | n/a |
| Snap button | `CopySnapButton` | `"📸 Snap"`, same state machine as Part A (Capturing… / ✓ Copied / ✓ Downloaded / ✕ Failed, 2200 ms revert) | filename `sp-sector-wheel.png`; title `"Copy a PNG of the sector wheel to the clipboard"`; target is the sunburst's own `snapRef`, which wraps whichever shell is live (inline card **or** pop-out) | n/a |
| "⤢ Expand" button | `expanded === false` | `iconBtn`: `padding 2px 7px; radius 4; 10px/700; 1px HT.border; transparent; HT.muted; opacity .75; lineHeight 1.6` | `title="Pop out to a larger window"` | n/a |
| "⛶ Full screen" button | `expanded && !isFs` | `iconBtn` | `title="Full screen"`; calls `overlayRef.requestFullscreen()` | Rendered only while expanded |
| "⤡ Exit full screen" button | `expanded && isFs` | `iconBtn` | `title="Exit full screen"`; calls `document.exitFullscreen()` | Rendered only while expanded |
| "✕ Close" button | `expanded` | `iconBtn` | `title="Close (Esc)"`; exits fullscreen if active, clears `expanded` and `hover` | Rendered only while expanded |
| How-to-read line (un-zoomed) | `!compact \|\| focus` — on this page `compact` is false, so always | `12px`, `HT.muted`, `opacity .65`, `marginBottom:10` | `"Bar length = size of move, color = direction. Click a sector to zoom."` | n/a |
| How-to-read line (zoomed) | `focus != null` | Same metrics | `"Showing **{sector}** — click the middle to go back."` with the sector name `<strong>` in `HT.text`. This line is kept even in `compact` mode because it is the only affordance back out | n/a |

### F2 — The wheel

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Loading placeholder | `!data && !err` | `padding 48px 12px; textAlign center; 12px; HT.muted; opacity .6` | — | `"Loading sector data…"` |
| Error placeholder | `err && !data` | `padding 36px 12px; textAlign center; 12px; HT.muted; opacity .7; 1px **dashed** HT.border; radius 8` | Shown only when there has never been a payload; a later failure keeps the last wheel on screen | `"Sector feed unavailable. Retrying every 5 minutes."` |
| SVG frame | `data` | `viewBox "-220 -220 440 440"`, `display block; width 100%; height auto` | none | n/a |
| Scale rings ×2 | Constants `[0.5, 1]` | Circles at `R0 + 0.5·AMP` and `R0 + AMP`, `fill none` | Stroke `HT.border`, width 1 | n/a |
| Sector ring arc | `sectors[]` — grouped by `row.s`, angle span = `Σw / total × 2π` | `arcPath(a0, a1, 0.30R, secOut − 1.5)` | Fill `ringFill(sector.chg, 0.62)`; stroke `HT.bg` width 1; `fillRule evenodd`. `cursor: pointer` when not focused, `default` when focused | Ring absent when `total === 0` |
| Industry ring arc | `industries[]` — grouped by `row.i` within each sector | `arcPath(a0, a1, secOut, indOut − 1.5)` | Fill `ringFill(industry.chg, 0.90)`; stroke `HT.bg` width 0.8; `fillRule evenodd`. Not clickable | As above |
| Ticker bar | `leaves[]` — one per row | `arcPath(a0, a1, R0, R0 + barLen(c))` where `barLen(v) = max(min(|v|/cap, 1.06)·AMP, 1.5)` | Fill `fillFor(c)`; stroke `HT.bg` width 0.6. **Always grows outward** from the zero ring — nothing grows inward, so the hub stays clear | As above |
| Zero ring | Constant | Circle `r = R0`, `fill none`, width 1.4 | Stroke `rgba(HT.text, 0.28)`. Drawn above the feet of the bars | n/a |
| Hub disc | Constant | Circle `r = 0.30R − 3` | Fill `HT.panel` | n/a |
| Sector arc angle | `Σ row.w` over the sector ÷ `total` × 2π | — | `total` is the sum of `w` over the **currently displayed** rows, so zooming re-normalises the circle to 360° of one sector | n/a |
| Sector `chg` | `wavg(rows) = Σ(c·w) / Σw` | — | Cap-weighted, not equal-weighted | `0` when the group has zero weight |
| Sector label | `sectors[]` | Tangential `<text>`, `fontSize 9` inline (`7` expanded), `fontWeight 700`, `dy .34em`, `textAnchor middle` | Rendered **only if** ring thickness `≥ fs + 3` **and** a name form fits: `textW(s, fs) = s.length·fs·0.6 ≤ (a1−a0)·rr − 8` **and** `hypot(rr, w/2) + fs·0.45 ≤ ro` (chord must not bulge past the ring's outer edge). Forms tried in order: full name, then `SECTOR_SHORT[name]`. Ink = `inkOn(ringFill(chg, .62))`. Rotated to the arc mid-angle, flipped `rotate(180)` when `cos(mid) < 0`. In the zoomed layout the sector band is thinner than `fs+3`, so no sector label paints | Label simply omitted — no ellipsis, no fallback |
| Sector short-name table | `SECTOR_SHORT` | `Information Technology → Technology, Tech` · `Communication Services → Communications, Comms` · `Consumer Discretionary → Cons. Disc., Disc.` · `Consumer Staples → Staples` · `Health Care → Health` · `Financials → Fins` · `Industrials → Indus.` · `Real Estate → REITs` · `Materials → Matls` · `Utilities → Utils` · `Energy → Enrgy` | Tried longest → shortest | Sectors not in the table have only their full name to try |
| Industry label | `industries[]` | `fontSize 8` inline (`6.5` expanded), `fontWeight 600` | Same two fit tests, **full name only — no short forms**. Ink = `inkOn(ringFill(chg, .9))`. In practice these only fit in the zoomed layout, which is exactly what the fit test is for | Omitted |
| Hub — scope label | `hubLabel` | `y = -26`, `fontSize 10.5`, `800`, `letterSpacing .1em`, `HT.muted`, `opacity .55` | Un-zoomed → `"S&P 500"`. Zoomed → the **shortest** available form of the focused sector, `.toUpperCase()` (e.g. `"TECH"`, `"REITS"`) | Renders even before data (inside the `data &&` guard, so: absent until data) |
| Hub — net value | `net = wavg(displayed rows)` | `y = -3`, `fontSize 22`, `800`; `fmt()` → `"+0.42%"` / `"−0.42%"`, 2 dp, U+2212 | `net >= 0` → `HT.green`; else `HT.red` | `"+0.00%"` when there are no rows (guarded `total === 0` path returns `net: 0`) |
| Hub — breadth line | `up` / `down` counts | `y = 12`, `fontSize 9.5`, `HT.muted`, `opacity .7`; `"{up} up · {down} down"` | Counts rows with `c > 0` and `c < 0` **in the current view** — zooming re-counts within the sector. Flat names (`c === 0`) are in neither count | `"0 up · 0 down"` |
| Hub — "← all sectors" | `focus != null` | `y = 30`, `fontSize 9`, `700` | Colour `HT.cyan` | Absent when not zoomed |
| Hub — back-out hit area | `focus != null` | Transparent circle `r = 0.30R − 3`, `cursor pointer` | Click clears `focus` | Absent when not zoomed |
| Sector click behaviour | `onClick` on the sector arc | — | `if (!focus) setFocus(s.name)` — a second click on a sector while zoomed does nothing; the hub is the only way out | n/a |

### F3 — Callouts (biggest movers named on the rim)

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Callout count | `calloutCount` | `3` inline, `5` when expanded | Winners = top-N of `leaves` by `chg` desc **filtered to `chg > 0`**; losers = bottom-N by `chg` asc **filtered to `chg < 0`** | Fewer than N when the view has fewer positive/negative names |
| Callout text | `leaf.name`, `leaf.chg` | `` `{TICKER} {+|−}{|chg|.toFixed(1)}%` `` — **1 dp here**, unlike the 2 dp used everywhere else; U+2212 for negatives | `fontSize 9.5` inline (`7.5` expanded), `fontWeight 800`; colour `HT.green` when `chg >= 0`, else `HT.red` | n/a |
| Callout placement | Greedy, in `|chg|` descending order | Label sits on `R_CALL = 0.955R`, rotated to the leaf's mid-angle, flipped when `cos(mid) < 0`, `dy .34em` | Angular half-width `= (textW(text, fs)/2 + 5) / R_CALL`. A candidate whose span overlaps an already-placed one (tested at ±2π so the 12 o'clock seam counts) is **silently dropped** — the smaller mover simply goes unnamed | n/a |
| Callout tick line | Same | From `r = barTip + 2.5` to `r = R_CALL − fs·0.9`, along the mid-angle | Stroke `rgba(colour, 0.5)` width 0.9. Drawn **only when `rOut > rIn`** — a bar long enough to reach the callout ring gets no line | Line omitted, label still drawn |
| Bar-inner ticker label | `leaves[]`, skipping any index in `calledOut` | `fontSize 7.5` inline (`5.6` expanded), `700`, ink = `inkOn(fillFor(chg))`, rotated radially and flipped when the rotation exceeds ±90° | Printed **only if** `textW(name, fs) ≤ barLen − 7` **and** `fs·1.35 ≤ (a1−a0)·R0` (the bar must be both long enough and wide enough). Names already carrying a rim callout are excluded so nothing is printed twice | Omitted |

### F4 — Hover tooltip

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Tooltip container | `hover` state, set by `onMouseMove` on any arc | `position absolute; left clamp(0, mouseX+12, boxWidth−150); top mouseY+12; pointerEvents none; zIndex 5; radius 8; padding 7px 9px; minWidth 120` | Background `HT.panelBgStrong`, `backdropFilter blur(10px)`, `1px HT.border`. Cleared on `onMouseLeave` of the arc | Absent when not hovering |
| Tooltip title | `title` arg | `12px / 700`, `HT.text` | Sector arc → sector name; industry arc → industry name; bar → ticker | n/a |
| Tooltip subtitle | `sub` arg | `10px`, `HT.muted`, `opacity .6`, `marginTop:1` | Sector arc → `` `{n} names · cap-weighted` ``; industry arc → `` `{n} names · cap-weighted` ``; bar → `` `{sector} › {industry}` `` (U+203A single right angle quote) | n/a |
| Tooltip value | `val` arg | `15px / 700`, `marginTop:4`; `fmt()` 2 dp signed | `val >= 0` → `HT.green`; else `HT.red` | n/a |

### F5 — Top / Bottom movers block

Rendered when `data && (showMovers || expanded)` — on this page `showMovers` is
`true`, so always once data has landed. `grid-template-columns: 1fr 1fr; gap 10;
marginTop 12`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "Top" heading | Static | `10px / 700`, `letterSpacing .08em`, `uppercase`, `HT.muted`, `opacity .55`, `marginBottom:5` | none | Block absent until data |
| "Bottom" heading | Static | Same | none | Same |
| Top rows | `[...data.rows].sort((a,b) => b.c − a.c).slice(0, moverCount)` | `moverCount = 3` inline, `8` when expanded | Ranked over the **full universe**, not the zoomed view (`data.rows`, not `leaves`) | — |
| Bottom rows | `.slice(-moverCount).reverse()` of the same sort | Same count | Worst first | — |
| Row — ticker | `row.t` | `11px / 700`, `HT.text` | none | — |
| Row — percent | `row.c` | `fmt()` → 2 dp signed, `11px / 700`, `fontVariantNumeric: tabular-nums`, right-aligned | `c >= 0` → `HT.green`; else `HT.red` | — |
| Row spacing | — | `flex column; gap:3`; each row `justify: space-between` | none | — |

### F6 — Footer coverage line

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Coverage line container | `data` | `marginTop:10; 10px; HT.muted; opacity .5; flex; justify space-between` | none | Absent until data |
| "{covered}/{universe} names" | `data.covered`, `data.universe` | Plain integers with a slash | `covered` = rows that returned a usable quote; `universe` = `SPX_UNIVERSE.length` | — |
| " · cached" suffix | `data.stale` | Appended to the left string | Present only when the server served a stale body (upstream sweep failed within the 60-min grace) | Suffix absent |
| "as of {time} ET" | `data.updatedAt` | `toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit"})` | none | Right span omitted entirely when `updatedAt` is falsy |

### F7 — Pop-out overlay (Expand)

Not visible on first load, but it is page behaviour and it must survive the
port — zoom level, cap and the loaded payload all live in component state so
they carry across in both directions.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Overlay root | `createPortal(…, document.body)` when `expanded` | `position fixed; inset 0; zIndex 4000; flex centre; padding clamp(10px,2.5vw,32px)` | In real fullscreen: `padding 0`, background solid `HT.bg`. Otherwise background `rgba(HT.bg, 0.82)` + `backdropFilter blur(10px)` (with `-webkit-` twin). Portalled so the page shell's `overflow` cannot clip it | n/a |
| Overlay panel | — | `width 100%; maxWidth 1320; maxHeight 100%; overflow auto; radius 18; padding clamp(16px,2vw,28px)` | Background `HT.panelBg` + `blur(16px)`, `1px HT.border`, `boxShadow 0 40px 100px -30px rgba(0,0,0,0.6)`. In fullscreen: `maxWidth none`, transparent background, no border, `radius 0`, no shadow | n/a |
| Backdrop dismiss | `onMouseDown` where `e.target === e.currentTarget` | — | Click on the backdrop only, not the panel | n/a |
| Esc dismiss | `keydown` listener while `expanded` | — | `Escape` closes **only when not in real fullscreen** — the browser eats the first Esc to exit fullscreen, which drops back to the windowed overlay | n/a |
| Body scroll lock | `document.body.style.overflow = "hidden"` while expanded | — | Previous value restored on unmount | n/a |
| Expanded layout | — | Body becomes `flexDirection row; flexWrap wrap; gap 28; alignItems flex-start` | Wheel column `flex: 1 1 460px`, `maxWidth: min(100%, calc(100vh − 200px))`. Rail column `flex: 0 1 280px; minWidth 220`. Inline (un-expanded) the same two blocks stack: `flexDirection column; flexWrap nowrap; gap 0`, rail `width 100%` | n/a |
| Sector leaderboard — heading | `data && expanded` | `"Sectors"`, `10px / 700`, `letterSpacing .08em`, uppercase, `HT.muted`, `opacity .55`, block `marginTop:18` | **Pop-out only** — never rendered in the card | Absent inline |
| Sector leaderboard — rows | `sectorRank`: group `data.rows` by `s`, `chg = Σ(c·w)/Σw`, sorted `chg` **descending** | `<button>` `grid-template-columns: 1fr 56px; gap 8; padding 3px 6px; radius 5; 11px/600; textAlign left` | Always computed over the **full universe**, so it does not collapse to one row when the wheel is zoomed | Absent inline |
| Sector leaderboard — name | `s.name` | `overflow hidden; textOverflow ellipsis; whiteSpace nowrap`, `HT.text` | Row `title` = `` `{n} names · click to zoom the wheel` `` | — |
| Sector leaderboard — value | `s.chg` | `fmt()` 2 dp signed, right-aligned, `700`, tabular | `chg >= 0` → `HT.green`; else `HT.red` | — |
| Sector leaderboard — active row | `focus === s.name` | — | Active: `1px HT.cyan` border + `bg rgba(HT.cyan, 0.12)`. Inactive: transparent border, transparent bg. Click **toggles** (`setFocus(focus === name ? null : name)`) — unlike the wheel arcs, which only ever zoom in | — |

---

# Part G — Quick Links card

`<Card accent="cyan" variant="classic" padding={20}>`, last in the right column.
Lines 557–593.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "🔗 Quick Links" | Static | `17px / 700` | Colour `HT.cyan` | Always renders |
| Edit / Done button | `editLinks` | `miniBtn` | `"Done"` while editing, else `"Edit"` | n/a |
| Link list | `links` | `flex column; gap:10` | none | Empty array renders nothing — **there is no empty-state message and no hint line** (this card is the one that has neither) |
| Link tile (view) | `link.label`, `link.href` | Plain `<a href>` — **not** `next/link`, so a click is a full document navigation, unlike the two header buttons. `flex; space-between; padding 10px 14px; radius 8; 14px/600; textDecoration none` | Resting: `1px HT.border`, `bg rgba(0,0,0,0.25)`, colour `HT.text`. **Hover**: `bg rgba(HT.cyan,0.12)`, border `HT.cyan`. Transition `background .15s, border-color .15s` | n/a |
| Link tile — arrow | Static | `"→"` | Colour `HT.cyan` | n/a |
| Link picker (edit) | `<select>` over `ALL_PAGES` | `inputStyle` + `flex:1; minWidth:0` | Changing the selection rewrites **both** `href` and `label` from the catalog entry (`page?.label ?? x.label`), so a hand-edited label cannot survive a re-pick | n/a |
| Link delete (edit) | Client action | `miniBtn` with `color: HT.red`, `"✕"` | Removes by `id` | n/a |
| "+ Add" button | Client action | `miniBtn`, `marginTop:12` | Edit mode only. Picks the first `ALL_PAGES` entry whose `href` is not already in `links`; falls back to `ALL_PAGES[0]` when every page is already linked (so it can add a duplicate "Home") | n/a |
| Destination catalog | `ALL_PAGES` — 17 entries, in this order | `Home /home` · `Multi Greek /mult-greek` · `Options Chain /options-chain` · `Estimated Moves /em` · `Flow /flow` · `Analytics /analytics` · `ES Candles /es-candles` · `Scanner /scanner` · `ICT /ict` · `Journal /trading` · `Order Flow /order-flow` · `Greeks /greeks` · `Confidence /confidence-score` · `Fails /fails` · `Premarket Prep /premarket` · `Economic Calendar /economic-calendar` · `Traders Dashboard /traders-dashboard` | Select options render in exactly this order. **`/order-flow` and `/greeks` are not routes in `app-vite/src/App.tsx`** — in v2 they fall through the SPA catch-all to `/traders-dashboard` | n/a |
| Default links | `DEFAULT_LINKS` | 4 entries: `Premarket Prep /premarket` · `Home /home` · `Multi Greek /mult-greek` · `Analytics /analytics` | Applied **only** when the prefs GET returns no saved `links` (empty array or failure). A user who has arranged their own set keeps it — which is the stated reason Premarket also gets a header button | n/a |
| Sort order | Insertion order as stored | — | No sorting, no grouping | n/a |

---

# Part H — Prefs round-trip, layout, and dead code

| Item | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Prefs load | `GET /api/traders-dashboard`, `cache:"no-store"`, once on mount | Response `{zip, schedule[], tasks[], links[]}` | Each array is applied **only when `Array.isArray(x) && x.length`** — an empty saved array falls back to the DEFAULT, so a user cannot save "no tasks". `zip` applied when truthy, and sets both `zip` and `zipInput`. Any throw or non-OK → all defaults kept. `loaded = true` is set either way, in a `finally`-shaped tail | Defaults render immediately; a slower response replaces them mid-flight (visible flash of the sample rows) |
| Prefs save | `POST /api/traders-dashboard` with a JSON patch | `{schedule?, tasks?, links?, zip?}` | Fired by `updSchedule` / `updTasks` / `updLinks` on **every** mutation including every keystroke in an edit input, and by the ZIP set/clear. **Not debounced**, despite the "(debounced)" comment above `savePrefs`. Gated on `loaded` so the initial GET cannot be overwritten by a first render. Errors are swallowed (`.catch(() => {})`) | No saving indicator, no failure toast |
| Auth requirement | `getServerUserId()` in the route | — | Both GET and POST return **401** when there is no session. The page treats a 401 exactly like an empty response: defaults render, and every save silently fails | Indistinguishable from a fresh account |
| Page grid | — | `display grid; gap 20`; columns `isMobile ? "1fr" : "minmax(0,1.7fr) minmax(0,1fr)"` | `isMobile` from `useMobileNav()` | n/a |
| Column stacks | — | Each column `flex column; gap 20; minWidth 0` | Left: Countdown → Overnight Overview. Right: Morning Schedule → Pre-Market Tasks → S&P Sector Wheel → Quick Links | n/a |
| Overview inner grid | — | `isMobile ? "1fr" : "1fr 1fr"`, `gap 24` | The only other responsive switch on the page | n/a |
| Card hover lift | `PageCard.Card` adds `className="card-hover"` for `variant="classic"` | Global `.card-hover` rule in `app/globals.css` | Applies to **every** card on this page | n/a |
| `isOwner` / `useAuth()` | Lines 102–111 | — | **DEAD.** `userId`, `isOwnerClaim` and the derived `isOwner` are computed and never referenced anywhere in the render. Do not port | n/a |

---

# Part I — Gap analysis (state at inventory time, 2026-08-30 morning)

> Kept as written. Part J below records what the build actually did with it.


`cbedge-v3/src/pages/TradersDashboard.tsx` already exists (849 lines) and covers
most of Parts A–E and G. Measured against the checklist above, these are the
rows that are **absent or divergent** today. This is the build list for step 3.

### Missing outright

1. **The entire S&P Sector Wheel (Part F, 64 rows).** v3 renders
   `SectorRotationCard()` — a card whose body is the sentence "Sector rotation
   sunburst not yet ported — see v2 SectorSunburst.tsx." Nothing else in Part F
   exists: no feed, no wheel, no callouts, no tooltip, no Top/Bottom block, no
   coverage footer, no pop-out.
2. **Snapshot button (Part A).** Not ported. v3's header has no capture
   affordance, and no `data-capture-hide` / `data-snap-plain` convention.
3. **Server-backed prefs (Part H).** v3 persists schedule/tasks/links/zip to
   `localStorage` under `cb-v3-td-*` keys instead of `/api/traders-dashboard`.
   Deliberate and documented in the file header, but it is a parity gap: prefs
   do not follow the user between browsers, and the 401/empty-array behaviours
   in Part H do not apply.
4. **Working header nav buttons.** v3 renders `ComingSoonPill` for both
   Premarket Prep and Economic Calendar — dimmed, `cursor-not-allowed`, no
   navigation. v3 *does* have `/premarket` routed, so at minimum the Premarket
   pill can become a real link.

### Divergent

5. **Trending Now is a `Table`, not the v2 row list.** v3 uses
   `Table + MOVER_COLUMNS` with headers `Sym / Name / Chg` and a 22-char name
   truncation. v2 has no header row and truncates at 18. Pick one and record it
   — but the truncation length is a checklist value either way.
6. **Countdown type scale.** v2 is `clamp(48px, 8vw, 84px)`; v3 is a flat
   `text-6xl`. The responsive ramp is gone.
7. **Driver accent bars.** v2 draws a 3px left border per driver in
   `[cyan, orange, red, purple]`. v3 draws a 1.5px round dot in
   `[accent, warn, down, series-4]`. Shape and ramp both changed.
8. **Task progress bar fill.** v2 is `linear-gradient(90deg, cyan, green)`;
   v3 is flat `bg-accent`.
9. **Schedule time column.** v2 is `var(--font-mono)` with `whiteSpace: nowrap`
   and no fixed width; v3 is `w-20 tabular`. A long time string clips in v3.
10. **Quick Links catalog.** v3 replaced v2's 17-entry `ALL_PAGES` with its own
    15-entry list plus a `LIVE_ROUTES` set that renders unbuilt destinations as
    dimmed "coming soon" tiles. That is the right call given v3's no-catch-all
    rule, but the two lists are not the same and the checklist row should record
    v3's list as the intended one.
11. **Date line timezone.** Both use `toLocaleDateString` without a `timeZone`,
    so both are browser-local. Flagged here because it reads as an ET date on a
    trading dashboard and is not one — if it is going to be fixed, fix it in v3
    deliberately rather than by accident.
12. **Weather widget order.** v2 shows the "Change ZIP" button *below* the
    condition line and posts `{zip:null}`; v3 uses a `Chip` and clears
    localStorage. Same affordance, different control.
13. **`quotesFailed` banner.** v3 adds `"Live quotes unavailable — showing last
    known values."` — an improvement with no v2 counterpart. Keep it, but record
    it as an addition so it does not read as a parity row later.

### Colour mapping — needs a decision before Part F is built

Every v2 colour rule above is written in `HT.*`. v3 forbids literals outside
`tokens.css`, so each one needs a token. The four that matter, with what the
existing v3 page already chose:

| v2 | Hex | v3 page uses today | Token hex | Note |
|---|---|---|---|---|
| `HT.cyan` | `#219EBC` | `--color-accent` | `#5b8cff` | `--color-cal-accent` is `#219ebc` — an exact match, currently reserved for the calendar family |
| `HT.green` (up) | `#8ECAE6` | `--color-up` | `#35c28e` | v2's "up" is a light blue; v3's is green. The sector wheel's entire diverging ramp is built on this pair |
| `HT.red` (down) | `#EF4444` | `--color-down` | `#e0645f` | |
| `HT.orange` | `#FB8501` | `--color-warn` | `#e0a44a` | |
| `HT.purple` | `#126783` | `--color-series-4` | `#b07be0` | v2's value is a dark teal; `--color-series-4` is a violet. `--color-dex` (`#1f8dad`) is far closer |

The wheel's `mix()` / `inkOn()` helpers need these as JS strings, which means
`T.*` from `src/design/theme.ts` (`var(--color-…)` underneath) — not literals,
and not `getComputedStyle` at paint time.

### v3 rules the wheel will have to satisfy

- **Non-negotiable 4 & 5.** The wheel is currently declarative SVG re-rendered
  through React on every hover. Under v3 it has to mount through `ChartFrame`
  and honour one of its three visibility signals, or it repaints while scrolled
  off the bottom of the right-hand column — which is exactly the case
  `npm run perf` fails a build for.
- **Non-negotiable 6.** If it becomes a canvas, that canvas carries
  `data-cb-layer`. If it stays SVG, note in the port why `perf` still sees it.
- **Non-negotiable 3.** `/api/spx-sunburst` must be fired at route entry
  alongside the other five requests, not inside the card body.
- **Non-negotiable 7.** The wheel is ~770 lines of v2 source; check the
  `traders-dashboard` chunk against `budgets.json` after it lands, and consider
  `lazy()`-ing it the way `catalog.tsx` does for big board cards.

### The four route edits

`/v3/traders-dashboard` is already fully wired — `src/pages/TradersDashboard.tsx`,
the `lazy()` route in `src/App.tsx`, the `NAV` entry in `src/shell/Shell.tsx`,
and `app/v3/traders-dashboard/route.ts` all exist. **No route work is needed for
this port**; the four-step rule applies to new pages, not to this one.

---

---

# Part J — Build log (2026-08-30)

## Decisions taken before building

Three, all Brandon's, all on the record here because they are the rows that
would otherwise read as drift later:

1. **Up is blue, down is red.** v2's `HOME_THEME.green` (`#8ECAE6`) is a light
   blue, and the wheel's whole diverging ramp hangs off it. It came across
   verbatim as two new tokens, `--color-move-up` / `--color-move-down`, rather
   than being remapped onto v3's `--color-up` (green) — same precedent as the
   candle pair already in `tokens.css`. Reached in code as `MOVE_UP` /
   `MOVE_DOWN` from `design/theme.ts`.
2. **Early closes stay unhandled.** The countdown still targets 16:00 on a
   13:00 half day. "The ticker won't move" — kept as v2 had it, and now written
   down in the code rather than only here.
3. **Trending Now is one ranking, highest positive → lowest negative.** This is
   the single behavioural change to a rendered value in the whole port. v2
   printed `/api/premarket-movers`'s array untouched, which is top-5 best-first
   followed by bottom-5 worst-first — two descents with a cliff between them.
   Rows with no percent sort to the bottom rather than letting `NaN` scramble
   the comparator.

## What landed

| Part I item | Status |
|---|---|
| 1 — S&P Sector Wheel (64 rows) | **Ported.** `src/pages/tradersDashboard/wheelMath.ts` (maths, transcribed 1:1) + `SectorWheelCard.tsx` (render). Rings, weighting, both colour ramps, bar clamp, label fit tests, greedy callout placer, tooltip, Top/Bottom, sector leaderboard, coverage footer, pop-out and fullscreen all present. |
| 2 — Snapshot buttons | **Still open.** Both of them (page and wheel). Needs a DOM-to-canvas renderer v3 does not ship; not worth a dependency for one button. The only v2 row this port knowingly drops. |
| 3 — Server-backed prefs | **Restored.** `/api/traders-dashboard` is the store, and the only one — Postgres `td_user_prefs`, one row per `clerk_user_id`. The localStorage mirror an earlier cut added was removed; see "Prefs are per user, not per browser" below. |
| 4 — Header nav buttons | **Half.** Premarket Prep is a real `<Link>` (v3 has the route). Economic Calendar stays a dimmed pill — no `/economic-calendar` route in v3, and App.tsx's no-catch-all rule means a live link would 404. |
| 5 — Trending Now shape | **Back to v2's row list** (no table header), 18-char name truncation, PM tag — plus the new sort. |
| 6 — Countdown type scale | `clamp(48px, 8vw, 84px)` restored. |
| 7 — Driver accent bars | Back to a 3px left border, ramp `T.cyan · T.orange · T.red · T.purple`. |
| 8 — Task progress fill | Back to `linear-gradient(90deg, T.cyan, MOVE_UP)`. |
| 9 — Schedule time column | Back to mono + `nowrap`, no fixed width. |
| 10 — Quick Links catalog | v3's 15-entry list + `LIVE_ROUTES` kept as the intended one. |
| 11 — Date line timezone | Still browser-local, as v2. Deliberate: changing it is a product decision, not a port one. |
| 12 — Weather widget | v2's layout (temp, condition/place, Change ZIP beneath); clear now also posts `{zip:null}`. |
| 13 — `quotesFailed` banner | Kept. A v3 addition with no v2 counterpart. |

Also carried across that Part I did not call out: the coloured card titles
(`Morning Schedule` red, `Pre-Market Tasks` blue-up, `Quick Links` cyan), the
emoji in every heading, the `(pct ?? 0) >= 0` rule that paints a flat `+0.00%`
as up, and the non-empty-array guard that stops "delete every task" persisting.

## Two things changed that render nothing

- **Prefs saves are debounced for real** (400 ms). v2's helper was captioned
  "(debounced)" and was not, so every keystroke in an edit field was its own
  POST.
- **The wheel's SVG is memoised away from the tooltip.** v2 kept hover position
  in the same component as the arcs, so a mousemove over any of ~200 paths
  re-rendered all of them. `WheelSvg` is `memo()`'d on props that exclude the
  hover; a mousemove now repaints one absolutely-positioned div.

## v3 rules, as satisfied

- **#1 tokens** — `npm run check:theme` clean on the new files; two tokens
  added to `tokens.css`, which is the one file allowed literals. The wheel needs
  colour as NUMBERS (a magnitude ramp, and a luminance test that CSS cannot
  express), so `design/theme.ts` gained `tokenRgb` / `mixRgb` / `rgbHex` /
  `isLightRgb` — they read the live custom property rather than duplicating any
  value.
- **#3 no waterfalls** — all six requests fire from the page at entry, plus a
  module-scope `preload('/api/spx-sunburst')`. The wheel's chunk is `lazy()`;
  its data is not.
- **#5 invisible cards do not paint** — the wheel cannot mount through
  `ChartFrame` (that primitive hands you a bare element to build into
  imperatively; this is declarative SVG). It carries the contract by hand
  instead: same `IntersectionObserver`, same 200px `rootMargin`, same
  `data-visible` attribute, and the arcs are not rendered at all while it reads
  `0`. The box keeps its height so nothing jumps.
- **#6 `data-cb-layer`** — on the `<svg>`. `perf-check.mjs` counts canvas
  repaints and will not see it; the gate above is what stands in.
- **#7 budgets** — the wheel is behind `lazy()` so it is its own chunk. Check
  `npm run budgets` after the first real build.

## Verification

`cbedge-v3/scripts/parity-check.mjs` — 43 probes. Drives
`/app/traders-dashboard` and `/v3/traders-dashboard` in one browser against ONE
backend in the same minute, harvests body text + `svg text` + arc counts from
both, and fails on anything v2 renders and v3 does not. It keys on what a reader
sees — emoji card headings, the three futures tile symbols, the uppercase
section runs, the hub `<text>` nodes, the `{covered}/{universe} names` footer —
because the port replaces every class name by design and a structural diff would
be all noise.

```
PARITY_ORIGIN=https://cbedge.net PARITY_COOKIE='<session cookie>' npm run check:parity
```

Both pages need a signed-in session (`/v3` is owner-gated by `middleware.ts`;
the prefs route 401s). A run that cannot read both pages exits 2 — it is never
reported as a pass.

`npm run check:parity:self` runs `scripts/parity-check.test.mjs`, which drives
`compare()` against fixtures three ways and is wired into `npm run check`
because it needs neither a browser nor a backend:

1. a faithful v3 harvest loses nothing, and the absent snapshot button is
   reported as a declared departure rather than a failure;
2. the v3 page **as it stood before this port** — wheel still a placeholder —
   fails all eleven wheel probes, which is the exact class of loss the script
   exists to catch;
3. a v3 harvest with Trending Now left in v2's two-descent order is caught by
   the sort probe.

All three pass. The real browser run against a live backend has **not** been
executed — see the note at the end of this file.

## Prefs are per user, not per browser

The chain, end to end: `/api/traders-dashboard` → `server-v2/api-router.js`
(registered `auth: 'subscriber'`) → `lib/db.ts` `getTdPrefs` / `upsertTdPrefs` →
Postgres **`td_user_prefs`**, one row per `clerk_user_id`, upserted with
`::jsonb` and `ON CONFLICT (clerk_user_id) DO UPDATE`. ZIP, schedule, tasks and
quick links are all columns of that row. Nothing about this needed building —
v2 already had it, and the port already pointed at it.

What did need fixing is that the first cut of this page ALSO mirrored all four
into `localStorage`, to spare the user watching their own schedule get replaced
by the sample one on load. That is a per-browser store wearing a per-user
store's clothes, and it breaks the guarantee in two concrete ways:

- a second person signing in on the same browser sees the first one's ZIP and
  routine for as long as the GET takes;
- a value cleared on the server comes back. The load only applied `zip` when it
  matched `/^\d{5}$/`, so a row with `zip: null` left the mirrored ZIP on
  screen — the page showing a ZIP that is not in the database.

The mirror is gone. The row is the only truth, the defaults render for the few
hundred ms the GET takes exactly as v2 did, and `useQuery`'s cache already
spares a client-side navigation back to the page from refetching.

One thing v2 got wrong that this does not: **a debounced save is no longer lost
on exit.** `flush()` posts whatever is queued immediately, and runs from both
the unmount cleanup and a `pagehide` listener with `keepalive: true` — without
which a fetch fired as the document goes away is cancelled and the edit
vanishes. Set a ZIP and click to another page inside 400 ms: v2 saved it (it
posted on every keystroke), the debounced version would not have.

## The casing trap (found by the first real `npm run check`)

The wheel first landed as `sectorWheel.ts` + `SectorWheel.tsx`. Those two
basenames differ only in case, so on Windows the resolver turned
`import('./SectorWheel')` into `SectorWheel.ts`, the case-insensitive filesystem
served the MATHS module, and `tsc` failed with TS1149 plus "Property 'default'
is missing" on the `lazy()` import. It typechecks clean on a case-sensitive
filesystem, which is how it got committed — and, worse, the Docker deploy is
Linux, so the deploy would never have caught it either. Only the laptop would,
and only after the code was written.

Renamed to `wheelMath.ts` + `SectorWheelCard.tsx`, and
`scripts/check-casing.mjs` now fails the build on any two modules in one folder
whose names differ only in case. It runs FIRST in `npm run check`, so the next
one of these reports a named collision instead of a TS1149 stack.

The two original files are emptied to `export {}` tombstones carrying their own
`git rm` line — the shell on the machine was down and they could not be
deleted. **`check:casing` fails until they are removed.** That is deliberate:
they are dead, they are a live trap for the next `./SectorWheel` import, and the
check prints the exact command.

## Not yet run

The container this was built in could not reach a running backend, and its
device shell was unavailable for the session, so nothing below has been
executed and none of it should be assumed green:

- `npm run typecheck` — the new files typecheck clean under an identical
  `tsconfig.json` in isolation (strict, `noUnusedLocals`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), but not against the full
  `src` tree.
- `npm run check:theme` — clean against the new files with an empty baseline;
  not run over the whole repo.
- `npm run build` / `npm run budgets` / `npm run perf` / `npm run check:ws`.
- `npm run check:parity` against a live backend.
- `npm run check` end to end — `typecheck`, `check:theme` and
  `check:parity:self` were re-run in isolation after the rename and are clean;
  `build`, `budgets`, `perf`, `check:ws` and `check:casing` have not been run
  here. `check:casing` is EXPECTED to fail until the two tombstones are
  `git rm`-ed.
