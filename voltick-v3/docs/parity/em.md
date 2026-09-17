# Parity inventory — Estimated Moves (`/em`)

**What this is.** One line per value the v2 page renders, with where it comes
from, how it is formatted, what changes its colour, and what it shows when the
value is missing. It is the SPEC for the v3 port: the v3 page is finished when
every row here is ticked, and not before.

**Why it exists.** The failure mode this document prevents is rebuilding a page
from scratch — re-deciding what it contains at the same time as building it.
Both jobs were already done in v2. This file finishes the first one so the
second is only construction.

**Scope.** The v2 route `/app/em`, which is:

| Layer | File | Lines |
|---|---|---|
| Route | `app-vite/src/App.tsx` → `<Route path="/em">` | 87 |
| Page shim | `components/pages/Em.tsx` | 5 (renders `<EmCustomer />` and nothing else) |
| View | `components/dashboard/EmCustomer.tsx` | 447 |
| Data layer | `hooks/useEmLookup.ts` | 246 |
| Snapshot button | `components/shared/DataBox.tsx` → `BoxSnapBtn` | 83–126 |
| Click tracking | `lib/trackTicker.ts` → `trackTickerClick` | — |

`hooks/useEmLookup.ts` is shared with the phone view
(`components/mobile/pages/MobileEm.tsx`). **The phone view is out of scope** —
this inventory covers the desktop page only. The data layer it describes is the
one both surfaces use, so Part J is the transcription target either way.

**Total: 118 checklist rows.**

| Part | Covers | Rows |
|---|---|---|
| A | Page frame, header, deep-link | 9 |
| B | Search card — input, button, ticker chips | 11 |
| C | Error / empty / loading states | 6 |
| D | Result header — ticker, week, updated stamp, snapshot button | 13 |
| E | Estimated Move card — 4 stat tiles + EM Hit Rate meter | 15 |
| F | Buy Zone / Sell Zone | 15 |
| G | vs Historical EM Average | 9 |
| H | Recent Track Record | 10 |
| I | Disclaimer | 1 |
| J | Data layer — endpoints, aliasing, fallbacks, merge order | 21 |
| K | Dead code, auth traps, do-not-port | 8 |

**Column meanings**

- **Source** — the endpoint AND the field underneath it, or the exact
  client-side formula. `/api/levels → row.buy_near` is a source; "the zones" is
  not.
- **Format & units** — decimal places, sign, `%`, `pts`, font, size. What the
  code actually does, not what looks sensible.
- **Threshold / colour rule** — every condition that changes a colour, a weight
  or the wording. This is where detail goes missing when a page is described
  rather than transcribed.
- **Empty / loading** — literally what renders when the value is not there.

---

## Colour constants used by this page

`HT` = `HOME_THEME` from `components/shared/homeTheme.ts`. Rows below refer to
these names. Note the page also hardcodes **eight literals that are NOT in
HOME_THEME** — they are the page's real palette and they must all land in
`tokens.css` before any of this can be written in v3.

**DECIDED 2026-08-31 (Brandon): re-key onto v3's tokens.** No `--color-v2-*`
were added for this page. The right-hand column below is what the port ships.

| v2 value | Where used | Exists in v3 `tokens.css`? | v3 token used |
|---|---|---|---|
| `HT.bg` `#05060A` | page canvas | yes — `--color-v2-bg` | `V2.bg` |
| `HT.panelBg` `rgba(13,17,25,0.45)` | every card plate | no exact | `alpha(V2.panel, .45)` |
| `HT.border` `rgba(255,255,255,0.10)` | every card border, stat plate border, hit-rate track | no exact | `alpha(T.text, .10)` (**not** `--color-line`, which is opaque `#23272e`) |
| `HT.text` `#FFFFFF` | all label/body text | yes — `--color-fg` | `T.text` |
| `HT.cyan` `#219EBC` | card titles, chips | yes — `--color-v2-cyan` | `V2.cyan` |
| `HT.red` `#EF4444` | error banner, **Sell Zone card border only** | yes — `--color-v2-red` | `V2.red` |
| `HT.shellGlow` | page background radials | no | new token or literal-free gradient built from `V2.cyan` / `V2.purple` |
| `#cbd5e1` | Close stat value | no | **`CAL.previous`** → `--color-cal-previous` `#8a9ab8` |
| `#e8c060` | EM stat value | no | **`T.orange`** → `--color-warn` `#e0a44a` |
| `#00e676` | Up stat, Buy Zone, HIT, ≥65% hit rate | no | **`MOVE_UP`** → `--color-move-up` `#35c28e` |
| `#ff5a6a` | Down stat, Sell Zone text, MISS, <50% trailing | no | **`MOVE_DOWN`** → `--color-move-down` `#e0645f` |
| `#EF4444` | Sell Zone card BORDER, and <50% hit rate | yes — `--color-v2-red` | **`MOVE_DOWN`** — see the note below |
| `#ffc107` | 50–64% hit rate | no | **`CAL.medium`** → `--color-impact-medium` `#f59e0b` |
| `#0f1a28` | zone-line divider | no | `--color-line` |
| `rgba(0,0,0,0.4)` | stat plate, input background | yes — `--color-shadow` is `#000000` | `alpha(T.shadow, .4)` |
| `#a78bfa` | snapshot button idle | yes — `--color-violet` | `T.violet` |

**The two-reds / two-greens inconsistency collapses by construction.** v2 painted
the Sell Zone's border `#EF4444` and its text `#ff5a6a`, and used `#EF4444` for
the sub-50% hit rate but `#ff5a6a` for the sub-50% trailing rate — the same
semantic, four values. Re-keying maps every one of them onto `MOVE_DOWN`, so the
distinction disappears rather than being carried over. Rows below still record
what v2 did, because the record is the point; the "v3 token used" column is what
shipped.

The two threshold ladders are now **one function**, `hitRateColor()` in
`src/pages/Em.tsx`, used by both Part E2 and Part H.

---

## Shared inline styles

Declared once in `EmCustomer.tsx` as the `S` object, referenced by name below.

- `mono` = `"Consolas, Monaco, 'Courier New', monospace"`
- `S.card` = `HT.panelBg · 1px HT.border · radius 12 · padding 16px 18px · marginBottom 14 · boxShadow 0 14px 40px rgba(0,0,0,.3) · backdropFilter blur(16px)`
- `S.cardTitle` = `12px / 700 · letterSpacing .14em · uppercase · HT.cyan · marginBottom 14`
- `S.stat` / `S.avgStat` (identical) = `bg rgba(0,0,0,.4) · 1px HT.border · radius 8 · padding 12px 8px · textAlign center`
- `S.statLabel` = `10px / 700 · HT.text · letterSpacing .12em · uppercase · marginBottom 6`
- `S.statValue` = `21px / 700 · mono`

---

# Part A — Page frame, header, deep-link

Source: `EmCustomer.tsx` lines 31–42, 249–276, 299–316.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Page canvas | `S.page` | `flex:1; overflow:auto; height:100%; padding:32px 20px 60px; boxSizing:border-box` | `background: HT.bg`, `backgroundImage: HT.shellGlow` = two radials — `circle at 15% 50% rgba(33,158,188,.04) → transparent 50%` and `circle at 85% 30% rgba(18,103,131,.05) → transparent 50%` | n/a |
| Content column | `S.wrap` | `width:100%; maxWidth:720; margin:0 auto` | none | n/a |
| Header block | `S.header` | `textAlign:center; marginBottom:22` | none | n/a |
| CB Edge logo | `<img src="/cb-edge-logo.png" alt="CB Edge">` | `height:144; width:auto; display:block; margin:0 auto -18px` — the **negative bottom margin** is what tucks the title under the logo | none | Broken-image alt text if the asset is missing; no fallback |
| `<h1>` title | Static string | `"Weekly Estimated Move & Zones"` — `26px / 800`, `margin:0`, `letterSpacing .01em` | `HT.text` | Always renders |
| Sub-line | Static string | `"Enter a ticker to see this week's estimated move and the buy / sell zones."` (apostrophe is `&apos;`) — `14px`, `marginTop:8` | `HT.text` | Always renders |
| Deep-link on mount | `new URLSearchParams(window.location.search).get("ticker")` | If present: `setInput(t.toUpperCase())` **and** `lookup(t)` | Effect deps `[lookup]`; `lookup` is `useCallback(…, [])` so it fires exactly once | No param → nothing happens, the empty state renders |
| URL is never written back | — | Choosing a chip or submitting the form does **not** push a `?ticker=` | — | A looked-up page cannot be shared by copying the address bar. **FIXED IN v3 (Brandon, 2026-08-31).** v3 routes every lookup through `useSearchParams`, so the query string is the source of truth and back/forward work. A re-submit of the SAME ticker re-runs the lookup directly, because the param does not change and the effect would not fire |
| Page chrome above this | `GlobalToolbar` / `LayoutShell` (v2) | Outside `EmCustomer` entirely | — | In v3 the equivalent is `Shell.tsx`'s rail + toolbar; the page contributes nothing to it |

---

# Part B — Search card

Source: lines 44–75, 277–330. `S.searchCard` = `HT.panelBg · 1px HT.border ·
radius 16 · padding 18px · marginBottom 22 · backdropFilter blur(16px) ·
boxShadow 0 14px 40px rgba(0,0,0,.3) · flex column gap 14`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Form row | `S.form` | `flex; gap 8; marginBottom 12; flexWrap wrap` | none | n/a |
| Ticker input | `input` client state (raw keystrokes) | `flex:1; minWidth:200; fontSize 17; padding 12px 14px; radius 8; letterSpacing .04em; outline none`; `textTransform:uppercase` is **display only** — the state keeps what was typed | `bg rgba(0,0,0,.4)`, `1px HT.border`, `color HT.text` | Placeholder `"Enter ticker  (e.g. SPX, NDX, AAPL)"` — **two spaces** after "ticker" |
| Input attributes | — | `spellCheck={false}`, `autoCapitalize="characters"` | none | n/a |
| Submit button — label | `loading` | `"Get Levels"` idle / `"Loading…"` while loading (ellipsis is a single `…` glyph) | `homeButtonStyle` + `fontSize 12; padding 12px 20px` → border `1px rgba(33,158,188,.25)`, bg `linear-gradient(180deg,rgba(33,158,188,.12),rgba(33,158,188,.04))`, colour `HT.cyan`, `700`, `letterSpacing .08em`, uppercase | n/a |
| Submit button — disabled | `loading \|\| !input.trim()` | `opacity .45`, `cursor:not-allowed` | Same colours, dimmed | Disabled on first paint (empty input) |
| Form submit | `onSubmit` → `e.preventDefault(); lookup(input)` | Enter in the input submits | none | Submitting whitespace is a no-op (`lookup` bails on empty after `.trim()`) |
| Chip row | `S.chips` | `flex; wrap; justifyContent:center; gap:6` | none | Always renders |
| Chip set + order | `POPULAR` in `hooks/useEmLookup.ts` | **SPX · NDX · ESU · NQU · SPY · QQQ · AAPL · NVDA · TSLA · MSFT** — this exact order, hardcoded, not sorted | none | n/a |
| Chip — inactive | — | `12px / 800; letterSpacing .06em; padding 6px 13px; radius 20; cursor pointer` | bg `HT.cyan + "12"` (7% alpha), border `1px HT.cyan + "33"`, colour `HT.cyan`, no shadow | n/a |
| Chip — active | `ticker === s` — compares the **looked-up** ticker, not the input box | Same metrics | bg `linear-gradient(180deg, HT.cyan+"29", HT.cyan+"0d")`, border `1px HT.cyan+"73"`, `boxShadow 0 0 12px HT.cyan+"3a"` | Typing "SPX" without submitting leaves every chip inactive |
| Chip click | `setInput(s); lookup(s)` | Fires the lookup immediately — no second click needed | none | n/a |

---

# Part C — Error, empty and loading states

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Error banner | `error` state | `14px; padding 14px 16px; radius 8; textAlign center` | bg `HT.red + "14"`, border `1px HT.red + "40"`, colour `HT.red` | Rendered whenever `error` is truthy — **including while `loading` is true**, since the banner has no `!loading` guard |
| Error text — no published row and no zones | `lookup` | `` `No levels published for {SYM} yet.` `` — SYM is the uppercased input | — | — |
| Error text — HTTP failure | `throw new Error("Lookup failed")` on `!r.ok` from `/api/levels` | `"Lookup failed"` | — | A 403 from the auth gate lands here as the same generic string |
| Error text — thrown non-Error | `catch` fallback | `"Lookup failed"` | — | — |
| Empty state | `!data && !error && !loading` | `"Enter a ticker above to view its weekly levels."` — `14px; textAlign center; padding 40px 0` | `HT.text` | This IS the first-paint state |
| Loading state | `loading` | **Nothing renders.** `lookup` sets `data = null` at the start, and the result block is gated on `data && !loading`, so the whole result area goes blank | none | No spinner, no skeleton, no "previous result greyed out". The only loading affordance on the page is the button label |

---

# Part D — Result header

Source: lines 79–88. Wrapper `S.snapWrap` = `padding: 2` and carries `snapRef`
— **the snapshot captures from here down**, i.e. result header through
disclaimer, and NOT the search card or the page header.

`S.resultHead` = `flex; alignItems:baseline; gap 12; flexWrap wrap; marginBottom 14`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Result block gate | `data && !loading` | — | — | See Part C |
| Ticker heading | `data.label ?? data.ticker` (`\|\|`, so `""` falls through to `ticker`) | `30px / 800; letterSpacing .02em` | `HT.text` | On the zones-only fallback path `label`/`ticker` come from `/api/em-zones`; if both are absent this renders **empty with no placeholder** |
| Week label | `/api/levels → row.exp_label` | `` `Week of {exp_label}` `` — `12px / 700; uppercase; letterSpacing .1em` | `HT.text` | Span omitted entirely when `exp_label` is falsy |
| Updated stamp | `/api/levels → row.updated_at` | `` `Updated {fmtUpdated(updated_at)}` `` — `12px`, `marginLeft:auto` | `HT.text` | Span omitted entirely when `updated_at` is falsy |
| `fmtUpdated` format | `hooks/useEmLookup.ts` | `new Date(ts).toLocaleString("en-US", {month:"short", day:"numeric", hour:"2-digit", minute:"2-digit"})` → `"Aug 28, 04:19 PM"` — **browser-local timezone, not ET** | none | Unparseable date → `""`, so the span renders the bare word `"Updated "` |
| **SNAPSHOT — MOVED (2026-09-02)** | — | The capture EXISTS in v3 now: `src/shell/snapshot.ts`, no dependency — the subtree is cloned, its computed styles are pinned onto the clone, and Chrome renders it through an `<svg><foreignObject>`. What did not come across is the BUTTON. v3 has one camera, owner-gated, in the toolbar (`src/shell/CopyShot.tsx`); `Em.tsx` publishes its result block to that menu as soon as a ticker has been looked up, labelled with the ticker so the PNG's title band names it. `parity-check-em.mjs` keeps `D/snapshot` as a declared `soft` departure so **every run prints it** — the count is 0 by design, not by omission. The rows below describe v2's button, kept for reference | — | — |
| Snapshot slot | `<span>` wrapper | `marginLeft: data.updated_at ? 8 : "auto"` — the button takes over the right-push when there is no stamp | Carries `data-html2canvas-ignore="true"` so it is not in its own PNG | Always renders inside the result block |
| Snapshot button component | `BoxSnapBtn` (`components/shared/DataBox.tsx`) | `targetRef={snapRef}`, `title={`${data.label \|\| data.ticker} • EM & Zones`}` — the title is baked into the PNG's frame band | — | — |
| Snap button — idle | `s === "idle"` | Glyph `📸`, `padding 2px 5px; fontSize 14; radius 2; 1px border` | colour `#a78bfa`, border `#a78bfa40` | — |
| Snap button — busy | `s === "busy"` | Glyph `…`, button `disabled` | Same violet | Re-click is a no-op |
| Snap button — ok | `s === "ok"` | Glyph `✓` | colour `#00e676`, border `#00e67640` | Reverts to idle after **1800 ms** |
| Snap button — error | `s === "err"` | Glyph `✕` | colour `#ef4444`, border `#ef444440` | 1800 ms revert; also `console.error("[snap] capture failed:", e)` |
| Snap button — tooltip | Static `title` attribute | `"Copy screenshot to clipboard"` | none | n/a |
| Snapshot behaviour | `captureToBlob(el, {framed:true, title, fitContent:false, allowTaint:false, imageTimeout:4000})` then `copyOrDownload(blob, "snapshot.png")` | Framed capture: title band + watermark, clone expanded to full content height, `[data-capture-hide]` dropped. Clipboard first, silent fallback to a `snapshot.png` download | `allowTaint:false` means the CB Edge logo is **skipped** if it taints the canvas | n/a |

---

# Part E — Estimated Move card

Source: lines 90–129. `<section style={S.card}>`, title `"Estimated Move"` in
`S.cardTitle`.

### E1 — The four stat tiles

`S.emGrid` = `grid; gridTemplateColumns: repeat(4, 1fr); gap 10`. Every value
goes through `val(v)` = `"--"` when `null`/`undefined`/`""`, otherwise **the raw
string exactly as stored** — the DB holds comma-formatted strings like
`"7,711.76"` and the page does no reformatting at all.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Grid | — | 4 equal columns, always — no responsive collapse in this file | none | n/a |
| `CLOSE` | `/api/levels → row.close` | Raw string, `21px / 700`, mono | `#cbd5e1` — unconditional | `"--"` |
| `EM` | `/api/levels → row.em` | Raw string, `21px / 700`, mono | `#e8c060` — unconditional | `"--"` |
| `UP` | `/api/levels → row.up` | Raw string, `21px / 700`, mono | `#00e676` — unconditional | `"--"` |
| `DOWN` | `/api/levels → row.down` | Raw string, `21px / 700`, mono | `#ff5a6a` — unconditional | `"--"` |
| Tile labels | Static | `S.statLabel` — 10px/700, uppercase, `.12em` | `HT.text` | Always render |
| Tile plate | `S.stat` | `bg rgba(0,0,0,.4); 1px HT.border; radius 8; padding 12px 8px; center` | none | n/a |

### E2 — EM Hit Rate meter

Rendered only when `winRate != null`. Wrapper is `grid; gridTemplateColumns:1fr;
gap:10; marginTop:10` — a one-column grid, a leftover from when a second tile
sat beside it (see Part K). Tile = `S.avgStat` + `border 1px rgba(255,255,255,.1)`
+ `padding "12px 12px 10px"`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| `EM HIT RATE` | Static | `S.statLabel` | `HT.text` | Whole tile absent when `winRate` is null |
| Headline | `winPct = Math.round(winRate.hit_rate * 100)` | `` `{winPct}% Hit` `` — `20px / 700`, `marginBottom 8` | `winPct >= 65` → `#00e676`; `>= 50` → `#ffc107`; else → `#EF4444` (**note: `HT.red`, not the `#ff5a6a` used everywhere else on this page**) | — |
| Legend left | `losses = winRate.evaluated - winRate.hits` | `` `Miss ({losses})` `` — `10px` | `HT.text` | — |
| Legend centre | `winPct` | `` `{winPct}%` `` — `10px` | `HT.text` | — |
| Legend right | `winRate.hits` | `` `Hit ({hits})` `` — `10px` | `HT.text` | — |
| Legend row | — | `flex; justifyContent:space-between; marginBottom:4` | — | — |
| Bar track | — | `height 4; borderRadius 999; overflow hidden` | `background rgba(255,255,255,.1)` | — |
| Bar fill | `winPct` | `width: {winPct}%`, `height:100%`, `transition: width .4s` | `background: linear-gradient(90deg, #EF4444, #EF4444, #00e676)` — **fixed, three stops, does NOT follow the threshold colour above.** Two identical red stops mean the gradient stays red for the first half of the bar and then ramps | — |

---

# Part F — Buy Zone / Sell Zone

Source: lines 131–146. `S.zoneRow` = `grid; gridTemplateColumns: 1fr 1fr; gap 14`.
Both cards are `S.card` + `S.zoneCard` (`marginBottom:14`) with an overridden
`borderColor`.

`ZoneLine` = `flex; justifyContent:space-between; alignItems:baseline; padding
9px 0; borderTop: 1px solid #0f1a28`; label `12px/700 HT.text uppercase
letterSpacing .1em`; value `22px/700 mono`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Zone row | — | Two equal columns, always | none | Both cards render whenever the result block does, even with all four values missing |
| Buy card border | — | `1px solid` | `#00e67640` | — |
| `BUY ZONE` title | Static | `S.cardTitle` metrics | colour overridden to `#00e676` (not `HT.cyan`) | — |
| Buy hint | Static | `"Support area — bias long while price holds above."` — `12px; margin 0 0 14px; lineHeight 1.45` | `HT.text` | Always renders |
| Buy `NEAR` | `/api/levels → row.buy_near` (or `/api/em-zones → buy_near`) | Raw string, `22px/700` mono | `#00e676`, `opacity 1` | `"--"` |
| Buy `FAR` | `→ row.buy_far` | Raw string, `22px/700` mono | `#00e676`, `opacity .7` (the `dim` prop) | `"--"` |
| Sell card border | — | `1px solid` | `` `${HT.red}40` `` = `#EF444440` — **a different red from the card's own text colour.** Transcribe both; this is not a typo to tidy | — |
| `SELL ZONE` title | Static | `S.cardTitle` metrics | colour overridden to `#ff5a6a` | — |
| Sell hint | Static | `"Resistance area — bias short while price stays below."` — `12px; margin 0 0 14px; lineHeight 1.45` | `HT.text` | Always renders |
| Sell `NEAR` | `→ row.sell_near` | Raw string, `22px/700` mono | `#ff5a6a`, `opacity 1` | `"--"` |
| Sell `FAR` | `→ row.sell_far` | Raw string, `22px/700` mono | `#ff5a6a`, `opacity .7` | `"--"` |
| Zone line order | — | `Near` then `Far`, top to bottom, in both cards | — | — |
| Zone line divider | — | `borderTop: 1px solid #0f1a28` on **every** line, including the first — so there is a rule between the hint and `Near` | — | — |
| `pivot` | `/api/levels → row.pivot` | In v2: **fetched and merged into `data`, used in the `hasZones` test, and rendered nowhere** — `S.pivot` / `S.pivotVal` are wired to nothing. **v3 RENDERS IT** (Brandon, 2026-08-31: "keep pivot"): a centred `PIVOT` label with the raw string beside it, under the zone row | Label `text-muted`; value `font-mono text-lg text-fg` | `"--"` |
| Zones source when the published row has none | `fetchZones(sym)` → `/api/em-zones?ticker=` | Merged as `{...prev, ...zones}` — zones **overwrite** the published row's fields | — | Merge is silent; there is no indicator that a zone was computed on demand rather than published |

---

# Part G — vs Historical EM Average

Source: lines 148–186. Rendered only when
`emStats && (emStats.recentAvg != null || emStats.midAvg != null)`.
`<section style={{...S.card, marginBottom:14}}>`, title
`"vs Historical EM Average"`. Body is `grid 1fr 1fr; gap 10`.

`emVal = data.em ? parseFloat(data.em.replace(/,/g, "")) : null` — the comma
strip is mandatory; `parseFloat("7,711.76")` is `7`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card gate | `emStats` non-null AND at least one of `recentAvg` / `midAvg` non-null | — | — | Whole card absent otherwise |
| Left tile label | `"vs 4-Wk Avg"` + `emStats.recentAvg` | `` `vs 4-Wk Avg ({avg.toLocaleString("en-US",{maximumFractionDigits:2})})` `` — e.g. `vs 4-Wk Avg (88.41)` | `S.statLabel` | Degraded form: bare `"vs 4-Wk Avg"` with no parenthetical |
| Left tile value | `pct = (emVal - avg) / avg * 100` | `` `{▲\|▼} {Math.abs(pct).toFixed(1)}%` `` — one decimal, `17px / 700` mono | `diff > 0` → `▲` `#00e676`; else → `▼` `#ff5a6a`. **The arrow means "this week's EM is bigger than average", not "good" — green on a wider expected move. Transcribe as-is** | `"--"` at `14px` in `HT.text` |
| Right tile label | `"vs 12-Wk Avg"` + `emStats.midAvg` | Same format — e.g. `vs 12-Wk Avg (100.08)` | Same | Same |
| Right tile value | Same formula against `midAvg` | Same | Same | Same |
| Degraded-tile trigger | `!avg \|\| !emVal \|\| !Number.isFinite(avg) \|\| !Number.isFinite(emVal)` | — | **`!avg` also rejects `avg === 0`** | Renders the `"--"` tile |
| Tile order | — | 4-Wk left, 12-Wk right | — | — |
| Sample-size footer | `emStats.sampleSize` | `` `Based on {n} week{n !== 1 ? "s" : ""} of recorded data` `` — `10px; marginTop 10; letterSpacing .08em; uppercase` | `HT.text` | Line omitted entirely when `sampleSize === 0` |
| `midAvg` really means "up to 12" | `/api/em/ticker-em-stats` | Server takes `LIMIT 12` rows and averages **all of them**, so with 7 recorded weeks the "12-Wk Avg" is a 7-week average while the footer says "Based on 7 weeks" | — | The label is a fixed string and does not follow `sampleSize` |

---

# Part H — Recent Track Record

Source: lines 188–213. Rendered only when `recentRec != null`.
`<section style={{...S.card, marginBottom:14}}>`, title `"Recent Track Record"`,
body `grid 1fr 1fr; gap 10`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card gate | `recentRec` non-null — set only when ≥1 tracker row has `result` of `hit` or `miss` | — | — | Whole card absent otherwise |
| Left tile label | `recentRec.lastLabel` | `` `Last Week` `` + `` ` ({lastLabel})` `` when the label exists — e.g. `LAST WEEK (8/28)` | `S.statLabel` | Bare `"Last Week"` when `week_label` is null |
| Left tile value | `isHit = recentRec.lastResult === "hit"` | `"HIT"` / `"MISS"` — `20px / 700` mono | `#00e676` / `#ff5a6a` | `lastResult === null` renders **`MISS`** — the test is `=== "hit"`, so null is not distinguished from a real miss |
| Left tile border | `isHit` | `1px solid` | `rgba(0,230,118,.3)` hit / `rgba(255,90,106,.3)` miss | — |
| Right tile label | `recentRec.last5Total` | `` `Last {n} Wk{n !== 1 ? "s" : ""} Hit %` `` — the count is the **actual** window, so with 3 evaluated weeks it reads `Last 3 Wks Hit %` | `S.statLabel` | — |
| Right tile value | `pct = last5Total > 0 ? Math.round(last5Hits/last5Total*100) : 0` | `` `{pct}%` `` — integer, `20px / 700` mono | `pct >= 65` → `#00e676`; `>= 50` → `#ffc107`; else → `#ff5a6a` (**note: `#ff5a6a` here, but `#EF4444` for the same rule in Part E2**) | `0%` when the window is empty — but the card would not render at all in that case |
| Right tile border | `pctCol` | `` `1px solid ${pctCol}4d` `` — 30% alpha of whichever threshold colour won | Follows the value colour | — |
| Right tile sub-line | `last5Hits` / `last5Total` | `` `{hits} / {total} hit` `` — `10px; marginTop 4; letterSpacing .06em` | `HT.text` | Always renders inside the tile |
| Window definition | `evaluated.slice(0, 5)` after filtering to `hit`/`miss` and sorting newest-first | Up to 5 — fewer when there is less history | — | — |
| Tile order | — | Last Week left, trailing-N right | — | — |

---

# Part I — Disclaimer

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Disclaimer | Static | `"Levels are published weekly and are informational only — not financial advice."` — `12px; textAlign center; marginTop 18; lineHeight 1.5` | `HT.text` | Inside the result block, so absent until a lookup succeeds |

---

# Part J — Data layer (`hooks/useEmLookup.ts`)

This is the part that must be transcribed 1:1 rather than re-derived. Seven
requests per lookup, in three waves.

| Step | Source | Behaviour | Notes |
|---|---|---|---|
| J1 — normalise | `lookup(raw)` | `sym = raw.trim().toUpperCase()`; return immediately if empty | The chips and the deep-link both go through this |
| J2 — reset | — | `setTicker(sym)`, `loading = true`, and **clear** `error`, `data`, `emStats`, `winRate`, `recentRec` | This is why the page goes blank rather than showing a stale result |
| J3 — core fetch | `GET /api/levels?ticker={sym}`, `cache:"no-store"` | `!res.ok` → `throw new Error("Lookup failed")` | Auth `subscriber` |
| J4 — server alias | `server-v2/api-router.js` `/api/levels` | Strips `$` and a leading `/`, then `ALIAS`: `ES, ESM, ESU6, ESU26, /ES → ESU`; `NQ, NQM, NQU6, NQU26, /NQ → NQU`. Tries `[ALIAS[raw], ALIAS[cleaned], raw, cleaned]` and takes the first hit | Server-side only — the client sends the raw symbol |
| J5 — no row | body is `null` | `fetchZones(sym)`; on success `data = zones` (a `Partial<Levels>` — **EM/Close/Up/Down are all absent, so Part E renders four `"--"`**); on failure `error = "No levels published for {SYM} yet."` | The "brand-new ticker" path: zones now, EM after the next weekend publish |
| J6 — row, no zones | `!(row.buy_near \|\| row.sell_near \|\| row.pivot)` | `fetchZones(sym)` then `data = {...prev, ...zones}` | Zone fields from the on-demand call **win** over the published row |
| J7 — `fetchZones` | `GET /api/em-zones?ticker=`, `cache:"no-store"` | Returns `null` on `!res.ok`, on a falsy body, or on a body carrying `error`. Never throws | Server proxies `/proxy/api/tt/em-zones` and caches the result back into `ticker_levels` |
| J8 — zones payload | `/api/em-zones` | `{ticker, label, pivot, buy_near, buy_far, sell_near, sell_far}` | 502 `{error}` when the compute fails |
| J9 — click tracking | `trackTickerClick(sym, "em")` | Fires **only when data came back** (`fetchedData`), so 404s do not skew counts. `navigator.sendBeacon` to `/api/ticker-event` with `{ticker, event:"click", source:"em"}`, falling back to `fetch(keepalive)`. Swallows all errors | Deliberate: mirrors the flow-ticker tracker |
| J10 — enrichment wave | `Promise.allSettled([...])` of three | No single failure can blank the page — the core row still renders | 3 settled entries, 4 underlying requests |
| J11 — EM stats | `GET /api/em/ticker-em-stats?ticker={sym}` | `{ticker, recentAvg, midAvg, sampleSize}` | Auth `subscriber` |
| J12 — EM stats server math | `api-router.js` line 5137 | `SELECT em, week_start FROM em_tracker WHERE ticker=$1 AND em IS NOT NULL AND em > 0 ORDER BY week_start DESC NULLS LAST LIMIT 12`; `recentAvg` = mean of the **first 4**, `midAvg` = mean of **all returned** (≤12), `sampleSize` = count. No rows → all null / 0 | **The server does NOT apply the ESU→ESM alias here** — only the client's own fan-out (J14) does, and that fan-out is not used for this call. So `ESU` stats can come back empty while the hit rate works |
| J13 — win-rate sources | `Promise.all([GET /api/em-tracker, GET /api/em-tracker/history])` | `→ live ? {summary: live.summary, history: hist} : null` | **Both are `auth: 'owner'`** — see Part K |
| J14 — tracker rows | `fetchTrackerRows(sym)` | Client alias fan-out `ESU → [ESU, ESM]`, `NQU → [NQU, NQM]`, everything else `[sym]`. One `GET /api/em-tracker?ticker=X` per candidate, concatenated | Also `auth: 'owner'` |
| J15 — row sort | `fetchTrackerRows` | `rows.sort((a,b) => String(b.week_start ?? b.week_label ?? "").localeCompare(String(a.week_start ?? a.week_label ?? "")))` — **newest first**, lexicographic; correct only because `week_start` is ISO `YYYY-MM-DD` | Falls back to `week_label` (e.g. `"8/28"`), which sorts wrongly — a known latent bug, transcribe as-is |
| J16 — win-rate merge | — | `candidates` = same alias fan-out. `liveRow = summary.find(r => candidates.includes(r.ticker))`; `histTicker` = first candidate present in `history.tallies`; `totalHits = hist.hits + live.hits`; `totalEval = hist.total + live.evaluated` | Note the **field-name asymmetry**: history uses `total`, live uses `evaluated` |
| J17 — win-rate gate | `totalEval > 0` | Sets `{hits, evaluated, hit_rate: totalHits/totalEval}`; otherwise stays `null` | Part E2 is absent when null |
| J18 — recent record | `weeksRes` | `evaluated = rows.filter(r => r.result === "hit" \|\| r.result === "miss")`; if non-empty: `lastResult = evaluated[0].result ?? null`, `lastLabel = evaluated[0].week_label ?? null`, `last5 = evaluated.slice(0,5)`, `last5Hits = count of "hit"`, `last5Total = last5.length` | Unevaluated (`result` null) weeks are dropped before the window is taken |
| J19 — history fallback | `/api/em-tracker/history` | Reads `data/em-tracker-history.json` off disk; missing file → `{tallies:{}, total_weeks:0}` (still HTTP 200) | So a missing file degrades to "live rows only", not an error |
| J20 — error handling | `catch` | `error = e instanceof Error ? e.message : "Lookup failed"` | Only J3 can reach here; every enrichment call is inside `allSettled` or its own try/catch |
| J21 — finally | — | `loading = false` | — |

**Request count per lookup: 7** — `/api/levels`, optionally `/api/em-zones`,
`/api/em/ticker-em-stats`, `/api/em-tracker`, `/api/em-tracker/history`,
1–2 × `/api/em-tracker?ticker=`, plus the fire-and-forget `/api/ticker-event`.

**Waterfall note for v3 rule 3 — CHANGED IN v3 (approved 2026-08-31).** J3 →
J5/J6 → J10 is a genuine waterfall in v2: the enrichment wave waits on
`/api/levels` even though it needs nothing from it (every enrichment URL is
built from `sym`, known at J1). `src/pages/em/emData.ts` starts the enrichment
wave BEFORE awaiting the levels read. Same requests, same results, one round
trip less. It alters the dependency graph, not the maths and not a rendered
value.

**Second, smaller v3 diff:** v2 reads `/api/levels` with `cache: "no-store"`;
v3 goes through `query()` with a 10s stale window so the rail's
`prefetch: ['/api/levels?ticker=SPX']` on hover actually pays. The row is
published weekly — ten seconds is not an observable staleness.

---

# Part K — Dead code, auth traps, do-not-port

| Item | Where | What it is | Action for v3 |
|---|---|---|---|
| ~~`/api/em-tracker` + `/api/em-tracker/history` are `auth: 'owner'`~~ **FIXED 2026-08-31** | `server-v2/api-router.js` | A subscriber got 403 on both, and on the per-ticker rows (J14). `winRate` and `recentRec` therefore both stayed `null`, so **the EM Hit Rate meter (Part E2) and the entire Recent Track Record card (Part H) rendered for nobody but the owner** — on the v2 page, for as long as it has existed. The screenshots show them because they were captured as owner | **DONE (Brandon: "sub read path is fine").** Both routes are now `auth: 'subscriber'` for GET; POST/DELETE on `/api/em-tracker` keep an in-handler owner gate (internal-token bypass preserved for the weekly evaluator), and `/evaluate`, `/commit-history` and `/discord-preview` are untouched. This fixes the v2 page as well as enabling the v3 one |
| `/api/confidence` "CB Confidence" tile | Removed from `useEmLookup` before this port | The route returns `score: ConfidenceResult` (an object) where the reader expected a scalar, so the tile never rendered — on any surface, ever. It also cost a 120-session server-side scan per lookup | **Do not re-add.** Recorded here so nobody "restores" it from an old screenshot |
| `S.kicker` | `EmCustomer.tsx` line 261 | A styled uppercase cyan eyebrow. Referenced by nothing | Do not port |
| `S.pivot` / `S.pivotVal` | lines 430–439 | Styles for a pivot readout that no JSX renders. `row.pivot` **is** fetched and merged and does participate in the `hasZones` test | Keep the `hasZones` behaviour; do not port the styles. **Ask whether the pivot readout should come back** — the data is already on the wire |
| `lossPct` | line 108 | `const lossPct = 100 - winPct` — computed, never used (the legend renders `Miss (n)` as a count, not a percent) | Do not port |
| `input` / `setInput` inside `useEmLookup` | line 144 | A second, unused copy of the input state; the hook never returns it and the component keeps its own | Do not port |
| Double `winRate != null` | lines 104 and 106 | The same guard twice, one inside the other | Collapse to one |
| Responsive behaviour | whole file | There is none: `repeat(4,1fr)` and two `1fr 1fr` grids at any width, inside a `maxWidth:720` column. On a narrow desktop window the EM tiles crush. v2 is partly rescued by `app/globals.css`'s "GLOBAL GRID COLLAPSE" block, **which v3 does not have** | v3 must add explicit narrow-width rules or the page will be visibly worse than v2 on a small window. The phone has its own page (`/m/em`) and is out of scope |

---

# Appendix — the four v3 edits this port will need

**ALL FOUR DONE, 2026-08-31.**

1. ✅ `cbedge-v3/src/pages/Em.tsx` + `cbedge-v3/src/pages/em/emData.ts`.
2. ✅ `cbedge-v3/src/App.tsx` — `lazy()` import and `<Route path="/em">`.
3. ✅ `cbedge-v3/src/shell/Shell.tsx` — `comingSoon` removed,
   `prefetch: ['/api/levels?ticker=SPX']` added. Also `LIVE_ROUTES` in
   `src/pages/TradersDashboard.tsx`, which that file's own comment says moves
   with the other two.
4. ✅ `app/v3/em/route.ts` — `serveSpaShell("v3")`.

✅ `cbedge-v3/scripts/parity-check-em.mjs` + `parity-check-em.test.mjs`, wired
into `npm run check` as `check:parity:em:self`. 49 probes. Two things it does
that the other parity checkers do not:

- **Case-insensitive matching.** v2 uppercases its card titles in CSS and
  `innerText` returns text AS RENDERED, so v2 says `ESTIMATED MOVE` where v3
  says `Estimated Move`. A case-sensitive probe would report ten false losses.
- **A SET probe over the level figures** (`E/levelNumbers`). Every number this
  page shows is a comma-grouped string straight out of `ticker_levels`. Rather
  than pairing each number with its label across two different DOMs, the probe
  asserts that every figure v2 printed also appears in v3 — so **a tile that
  renders its label and prints `--` fails**, which is the exact failure a
  label-only probe sails past.

The enrichment probes (E2, G, H) are deliberately **not** `optional`: `compare()`
only fails when v2 HAS a value and v3 lacks it, so "this ticker has no evaluated
weeks" is already handled, and marking them optional would only buy silence on
the loss the file exists to catch. The run also prints an explicit `i` notice
when v2 rendered no hit-rate meter, so a run that did not exercise Parts E2/H
cannot be mistaken for one that did.

---

## Decisions — answered by Brandon, 2026-08-31

1. **Owner-gated blocks** → open a subscriber read path. Done in
   `server-v2/api-router.js`; writes stay owner-only. Part K row 1.
2. **The five missing colours** → re-key onto v3's tokens. No `--color-v2-*`
   added. See the colour table above.
3. **Pivot** → keep it. v3 renders it; Part F.
4. **Deep link** → write `?ticker=` into the URL. Part A.
5. **Enrichment waterfall** → fire in parallel. Part J.

### The one thing NOT ported — resolved 2026-09-02

The **snapshot (📸) button**. It was left out because v2's `BoxSnapBtn` is
html2canvas and v3 had no capture engine; pulling the library in was a
dependency and a budget decision rather than a side effect of a port.

v3 has an engine now — `src/shell/snapshot.ts`, and it is not html2canvas.
html2canvas parses CSS colours itself and knows only hex / `rgb()` / `hsl()`,
which every `alpha()` call in this app (i.e. `color-mix()`) walks straight into.
So the browser renders instead: clone the subtree, pin the computed styles onto
the clone, serialise it into an `<svg><foreignObject>` and draw that. No
dependency, no budget line.

The BUTTON still is not on this page, and that is now a choice rather than a
gap. v3 has one camera — owner-gated, in the toolbar — and surfaces publish
themselves to it (`src/shell/CopyShot.tsx`). This page publishes its result
block the moment a ticker resolves. `D/snapshot` stays a declared `soft`
departure so the difference keeps being printed.

### Not addressed by this port

`LIVE_ROUTES` in `src/pages/TradersDashboard.tsx` still lists `/scanner`,
`/trading` and `/test`, which App.tsx retired on 2026-08-30. That is a
pre-existing drift between the three lists that file's comment says move
together; `/em` was added to it, the stale three were left alone rather than
folded into an unrelated diff.
