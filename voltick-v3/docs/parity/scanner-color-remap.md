# COLOR-REMAP — /v3/scanner onto v2's palette

**The decision (Brandon, 2026-09-03).** The v3 scanner renders **v2's palette**,
not the collapsed v3 semantics shipped in step 2. Scope is the **scanner only** —
nothing in Em, Flow, Options Chain, Premarket, Analysis, Replay, Traders
Dashboard or the board cards is in scope, and no token changes value to make this
work.

**Semantics stay SPLIT.** v2 paints four different "positive" values across this
page — `#8ECAE6`, `#1FD98A`, `#22c55e`, `#30d158` — and three "negative" values —
`#EF4444`, `#FF3B3B`, `#ff5b5b`. Brandon did not choose to collapse them. **Do
not unify them.** Each stays on the surface v2 painted it on.

**The one thing that does move.** `HOME_THEME.green` `#8ECAE6` is a light blue
doing three unrelated jobs at once — chrome, the tab accent, and positive/up.
That collision is the one v2 did not intend, and it is broken here into three
different v2 values. The full argument is at the end of this file under **The
three-way split**; read it before applying any row.

---

## How to read a row

| Column | Means |
|---|---|
| **Symbol / call site** | The exported constant, function or JSX line whose value changes. Grep for it. |
| **Currently** | The v3 token the shipped step-2 code uses today. |
| **Change to** | The `V2.*` / `V2W.*` token it becomes. |
| **v2 value** | The hex, so you can check it against the spec's own **Colours used** table for that Part. |
| **Why** | One clause. |

**`NO CHANGE` rows are load-bearing.** They are in the table precisely so an
applying agent does not "helpfully" convert a value that is already correct. Most
of them are `T.text` — v3's `--color-fg` is `#ffffff`, which is exactly v2's
`HOME_THEME.text` and `HOME_THEME.muted`. Converting those to a `V2.*` name would
change nothing on screen and would add a name for a value that already matches.

**Line numbers** are against the step-2 modules as staged in
`scratchpad/v3/pages/scanner/`. Treat them as a hint; grep the symbol.

**Two files are absent from this document on purpose.** `gexChangeTopData.ts`,
`gexLevelsData.ts`, `pickStudyData.ts`, `strikeQueryData.ts`, `ibStatsData.ts`,
`watchThisData.ts` and `candles.ts` paint nothing — they import no colour token
at all. And the six tombstoned TPO modules (`TpoTab.tsx`, `tpoData.ts`,
`tpoStructures.ts`, `tpoTaxonomy.ts`, `tpoProfile.ts`, `amt.ts`) are out of scope:
the tab is gone and spec Part F is marked dropped.

---

## `format.ts`

The shared formatters and ladders six tabs import. Small file, high blast radius.

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `NEUTRAL` (`:49`) | `T.flat` | `V2.neutral` | `#6B7280` | v2's `NEUTRAL` in `scannerStyles.ts`, imported by six tabs. `T.flat` is `#7a828d` — the file header calls the swap "the one deliberate departure from v2"; that departure is now reversed. Delete the header note with it. |
| `zColor()` null branch (`:113`) | `alpha(T.text, 0.4)` | **NO CHANGE** | `rgba(255,255,255,0.4)` | `T.text` is `#ffffff` = v2's `HT.text`; the alpha is v2's own. Already exact. |
| `zColor()` `|z| >= 3` (`:115`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | v2's 3σ band is `HOME_THEME.red`. |
| `zColor()` `|z| >= 2` (`:116`) | `T.orange` | `V2.orange` | `#FB8501` | v2's 2σ band is `HOME_THEME.orange`; `T.orange` is `#e0a44a`. |
| `zColor()` else (`:117`) | `T.text` | **NO CHANGE** | `#FFFFFF` | Already exact. |
| Import line (`:46`) | `{ MOVE_DOWN, T, alpha }` | `{ T, V2, alpha }` | — | `MOVE_DOWN` has no remaining consumer in this file. |

---

## `scannerNav.ts`

The tab registry. **This file carries the accent leg of the three-way split.**

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `SCANNER_TABS` `gexlevels.accent` (`:113`) | `T.cyan` | `V2.cyan` | `#219EBC` | v2's GEX Levels pill. `T.cyan` is `#5b8cff`. |
| `SCANNER_TABS` `gexchangetop.accent` (`:114`) | `T.orange` | `V2.orange` | `#FB8501` | v2's GEX Change Top pill. |
| `SCANNER_TABS` `pickstudy.accent` (`:126`) | `T.purple` | `V2.purple` | `#126783` | v2's Pick Study pill. `T.purple` is `--color-dex` `#1f8dad`. |
| `SCANNER_TABS` `strike.accent` (`:130`) | `T.cyan` | `V2.cyan` | `#219EBC` | v2's Strike Query pill — deliberately shares GEX Levels' accent in v2, and still does. |
| `SCANNER_TABS` `ibstats.accent` (`:131`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | **The accent leg of the split.** v2 painted this pill `HOME_THEME.green` `#8ECAE6` — the same value as every card subtitle. It takes v2's own `LIGHT_BLUE` instead, which homeTheme calls "the one card accent" and which the IB Stats tab already uses throughout its body. |
| `SCANNER_TABS` `watch.accent` (`:132`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | v2's Watch This pill was already `LIGHT_BLUE`. Exact parity — the only thing that changes is the token's value, from `--color-series-5` `#4fb8d4` to v2's actual `#7dd3fc`. |
| Import line (`:69`) | `{ LIGHT_BLUE, T }` | `{ V2 }` | — | Nothing here reads a `T.*` or `LIGHT_BLUE` after the six rows above. |
| The doc comment above `SCANNER_TABS` (`:98–111`) | describes the step-2 collapse | rewrite | — | It currently argues the collapse Brandon reversed. Replace with the three-way split as stated at the end of this file. |

---

## `gexLevels.ts`

The biggest colour surface on the page. **This file is where `V2.pos` `#22c55e`
and `V2.accent` `#7dd3fc` are two DIFFERENT positives on adjacent cards, and that
is correct.** Spec Part B calls it "the three-positives case" and Brandon's
instruction is to keep it.

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `signColor(1)` (`:910`) | `MOVE_UP` | `V2.pos` | `#22C55E` | v2's `GEX_POS_GREEN`, declared at `GexLevelsTab.tsx:456` *precisely because* `.green` is a blue. The cumulative-gamma curve. |
| `signColor(-1)` (`:910`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | v2's `HOME_THEME.red`. |
| `signAreaFill()` (`:915`) | `alpha(signColor(…), 0.2)` | **NO CHANGE** | `${c}33` | Follows `signColor`; `0x33/255 ≈ 0.2` is already v2's alpha. |
| `gammaBarColor(v>=0)` (`:923`) | `MOVE_UP` | `V2.pos` | `#22C55E` | Gamma bars are the same `GEX_POS_GREEN` surface as the curve. |
| `gammaBarColor(v<0)` (`:923`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `deltaBarColor(v>=0)` (`:933`) | `MOVE_UP` | `V2.accent` | `#7dd3fc` | **Not `V2.pos`.** v2 paints positive DELTA bars `LIGHT_BLUE` and positive GAMMA bars `#22C55E`, on adjacent cards. Keep both. |
| `deltaBarColor(v<0)` (`:933`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `eodBarColor(v>=0)` (`:941`) | `MOVE_UP` | `V2.accent` | `#7dd3fc` | EOD bars are the `LIGHT_BLUE` family, same as delta. |
| `eodBarColor(v<0)` (`:941`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `CALL_LEG_COLOR` (`:950`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | Card 9's call leg + card 5's Call mini-chart. Value moves `#4fb8d4` → `#7dd3fc`. |
| `PUT_LEG_COLOR` (`:951`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | "every put bar". |
| `OI_BAR_COLOR` (`:957`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | OI-by-date bars. A series colour, never a sign. |
| `ERROR_INK` (`:960`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | All five error lines are `HOME_THEME.red` in v2. An error is not a direction. |
| `SPOT_LINE.color` (`:967`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | v2's majority spot treatment. The three-treatments-into-one collapse stands; only the value moves. |
| `FLIP_LINE.color` (`:976`) | `T.text` | **NO CHANGE** | `#FFFFFF` | v2's majority flip treatment is white. See open question 3 — the bars chart's flip line was `#22C55E` in v2 and this collapse predates the palette decision. |
| `gammaGaugeBands` negative (`:1014`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `gammaGaugeBands` positive (`:1015`) | `MOVE_UP` | `V2.accent` | `#7dd3fc` | Spec Part B: "`$Gamma` gauge positive band" is `LIGHT_BLUE`, not `GEX_POS_GREEN`. |
| `cpgGaugeBands` low band (`:1033`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `cpgGaugeBands` middle band (`:1034`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | "CPG gauge middle band". |
| `cpgGaugeBands` high band (`:1035`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | Both extremes are red — v2's ladder is centre-good, not signed. |
| `TILE_ACCENT.stockPrice` (`:1051`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `TILE_ACCENT.resistance` (`:1053`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | "Resistance tile accent". |
| `TILE_ACCENT.support` (`:1055`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | "Support tile accent". |
| `TILE_ACCENT.neutral` (`:1056`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `refreshInk('success')` (`:1088`) | `MOVE_UP` | `V2.up` | `#1FD98A` | v2's `REFRESH_GREEN` — the literal source of `V2.up`. Exact parity restored. |
| `refreshInk('error')` (`:1089`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `refreshInk('refreshing')` (`:1090`) | `T.flat` | **NO CHANGE** | `#888` | v2 typed a bare `#888` here — it is not a named v2 constant, so there is nothing to point at. `T.flat` `#7a828d` is closer than `V2.neutral` `#6b7280`. See open question 5. |
| `refreshInk('idle')` (`:1091`) | `T.cyan` | `V2.cyan` | `#219EBC` | |
| `LEGEND_NET_GAMMA` / `_MULTI` positive (`:1227`, `:1241`) | `MOVE_UP` | `V2.pos` | `#22C55E` | A legend swatch must be the same colour as the bar it names. |
| `LEGEND_NET_GAMMA` / `_MULTI` negative (`:1228`, `:1242`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `LEGEND_NET_DELTA` / `_MULTI` positive (`:1255`, `:1264`) | `MOVE_UP` | `V2.accent` | `#7dd3fc` | Follows `deltaBarColor`, not `gammaBarColor`. |
| `LEGEND_NET_DELTA` / `_MULTI` negative (`:1256`, `:1265`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `eodLegend()` positive (`:1273`) | `MOVE_UP` | `V2.accent` | `#7dd3fc` | Follows `eodBarColor`. |
| `eodLegend()` negative (`:1274`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `pctInk()` (`:1913`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#8ECAE6` → `#1FD98A`, `#EF4444` | Card 12's `POS` was `C.green` `#8ECAE6` — a **positive**, so it takes the split's positive leg, not `V2.green`. |
| `VOL_FLOW_TILE_PLACEHOLDER.color` (`:1925`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `volFlowDollarTiles` sign branches (`:1946`, `:1955`, `:1961`, `:1967`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#1FD98A` / `#EF4444` | Card 12's positive/negative tile ink. |
| `volFlowDollarTiles` `T.text` fallback (`:1967`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `volFlowDollarTiles` "Sign Flips" (`:1973`) | `T.orange` / `T.cyan` | `V2.orange` / `V2.cyan` | `#FB8501` / `#219EBC` | v2: orange when `flips > 0`, cyan at 0. |
| `volFlowDollarTiles` "Spot" tile (`:1980`) | `T.cyan` | `V2.cyan` | `#219EBC` | |
| `volFlowPctTiles` sign branches (`:2005`, `:2011`, `:2017`, `:2023`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#1FD98A` / `#EF4444` | |
| `volFlowScrimInk()` (`:2058`) | `MOVE_DOWN` / `T.cyan` | `V2.red` / `V2.cyan` | `#EF4444` / `#219EBC` | Scrim error text vs loading text. |
| `TOKEN.up` (`:2071`) | `'--color-move-up'` | `'--color-v2-refresh'` | `#1FD98A` | **Canvas path.** `tokenHex()` resolves this at mount for lightweight-charts, which cannot take a `var()`. It must name the same token `V2.up` points at or card 12's series and its tiles disagree. |
| `TOKEN.down` (`:2072`) | `'--color-move-down'` | `'--color-v2-red'` | `#EF4444` | Same. |
| `TOKEN.fg` (`:2073`) | `'--color-fg'` | **NO CHANGE** | `#FFFFFF` | Chart text, gridlines and axis borders are white at 5% / 10% in v2 too. |
| `TOKEN.line` (`:2074`) | `'--color-line'` | **delete the key** | — | Dead — nothing reads it. `volFlowChartOptions` uses `tokenHexAlpha(TOKEN.fg, 0.1)` for the border, which is already v2's `HT.border`. |
| `volFlowChartOptions()` / `volFlowSeriesColors()` bodies (`:2092–2131`) | — | **NO CHANGE** | — | Every alpha (`.05`, `.1`, `.32`, `.02`) is already v2's. The values move with `TOKEN` above; the code does not. |

---

## `gexChangeTop.ts`

Mostly already on `V2.*`. The changes are the sign ladders and the header chrome.

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `GRADE_COLOR['A+']`, `['A']` (`:568–569`) | `MOVE_UP` | `V2.green` | `#8ECAE6` | **A grade letter is a category, not a sign.** v2's `GRADE_COLOR` paints A+/A `HOME_THEME.green`. It keeps the chrome value; only sign-driven figures take `V2.up`. |
| `GRADE_COLOR.B` (`:570`) | `V2.cyan` | **NO CHANGE** | `#219EBC` | Already exact. |
| `GRADE_COLOR.C`, `.D` (`:571–572`) | `V2.orange` | **NO CHANGE** | `#FB8501` | Already exact. |
| `GRADE_COLOR.F` (`:573`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `peakPctTableColor()` (`:800`) | `MOVE_UP` / `MOVE_DOWN` / `T.text` | `V2.up` / `V2.red` / **NO CHANGE** | `#1FD98A` / `#EF4444` / `#FFFFFF` | Signed figure → the positive leg of the split. |
| `closePctTableColor()` (`:810`) | `MOVE_UP` / `MOVE_DOWN` / `T.text` | `V2.up` / `V2.red` / **NO CHANGE** | as above | |
| `peakPctCardColor()` (`:819`) | `MOVE_UP` / `MOVE_DOWN` / `T.text` | `V2.up` / `V2.red` / **NO CHANGE** | as above | |
| `pnlColor()` (`:829`) | `MOVE_UP` / `MOVE_DOWN` / `T.text` | `V2.up` / `V2.red` / **NO CHANGE** | as above | The zero branch stays `T.text`; that is v2's own neutral. |
| `deltaColor()` (`:845`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | as above | |
| `pctOpenColor()` (`:850`) | `MOVE_UP` / `MOVE_DOWN` / `T.text` | `V2.up` / `V2.red` / **NO CHANGE** | as above | |
| `avgPeakColor()` (`:855`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | as above | |
| `neverGreenColor()` (`:860`) | `MOVE_DOWN` / `MOVE_UP` | `V2.red` / `V2.up` | as above | |
| `sideColor('C')` (`:876`) | `V2.green` | **NO CHANGE** | `#8ECAE6` | **Side is not sign.** v2 paints the call badge `HOME_THEME.green`; the step-2 comment already argues this correctly. Leave it and leave the comment. |
| `sideColor('P')` (`:876`) | `V2.orange` | **NO CHANGE** | `#FB8501` | |
| `slotHeaderColor()` (`:881`) | `V2.cyan` / `V2.orange` | **NO CHANGE** | `#219EBC` / `#FB8501` | Live vs recorded slot header. Already exact. |
| Every `T.muted` in this file (4 sites) | `T.muted` | `V2.green` | `#8ECAE6` | **The chrome leg of the split.** v2's `th` colour and card subtitle. |
| Import line (`:120`) | `{ MOVE_DOWN, MOVE_UP, T, V2 }` | `{ T, V2 }` | — | |

---

## `pickStudy.ts`

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `liftColor()` `>= LIFT_UP_PT` (`:519`) | `MOVE_UP` | `V2.up` | `#8ECAE6` → `#1FD98A` | Signed quantity. |
| `liftColor()` `<= LIFT_DOWN_PT` (`:520`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `liftColor()` dead-band + null (`:518`, `:521`) | `T.text` | **NO CHANGE** | `#FFFFFF` | v2's dead-band and its null both paint `HT.text`. The spec flags that as a defect; it is not a palette question, so it stays. |
| `holdsColor()` (`:533`) | `MOVE_UP` / `MOVE_DOWN` / `T.text` | `V2.up` / `V2.red` / **NO CHANGE** | `#1FD98A` / `#EF4444` | The `✓` / `✗` glyphs — a hit/miss test. |
| `bucketNeverGreenColor()` (`:553`) | `MOVE_DOWN` / `T.text` | `V2.red` / **NO CHANGE** | `#EF4444` | |
| `calNeverGreenColor()` (`:563`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `termChipColor()` (`:571`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#1FD98A` / `#EF4444` | |
| `TABLE_HEADER_COLOR` (`:575`) | `T.muted` | `V2.green` | `#8ECAE6` | **Chrome leg.** Both table header rows. |
| `HEADLINE_GOOD_COLOR` (`:578`) | `MOVE_UP` | `V2.up` | `#1FD98A` | Headline A/B rate — a good/bad reading. |
| `HEADLINE_BAD_COLOR` (`:580`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | Headline never-green. |
| `COUNT_COLOR` (`:582`) | `T.cyan` | `V2.cyan` | `#219EBC` | Graded-pick count. |
| `RATE_BAR_FILL` (`:583`) | `T.cyan` | `V2.cyan` | `#219EBC` | The `RateBar` fill is a MAGNITUDE, deliberately not a threshold mark. Keep it distinct from `V2.up` and say so — the spec warns the next reader will try to unify them. |
| `ALERT_COLOR` (`:586`) | `T.red` | `V2.red` | `#EF4444` | Study / fit error lines and the Disarm button. |
| `COPIED_COLOR` (`:589`) | `V2.refresh` | `V2.up` | `#8ECAE6` → `#1FD98A` | A success confirmation. Same token as `V2.refresh` today — the rename is what makes the intent legible. See open question 2. |
| `WARN_COLOR` (`:592`) | `T.orange` | `V2.orange` | `#FB8501` | Section titles, "thin" badge, pinned-rule warning. |
| `buildVerdict()` neutral tone (`:922`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `buildVerdict()` orange tone (`:931`) | `T.orange` | `V2.orange` | `#FB8501` | |
| `buildVerdict()` green tone (`:939`) | `MOVE_UP` | `V2.up` | `#1FD98A` | |
| `buildVerdict()` red tone (`:945`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `ruleBarState().tone` (`:1068`) | `MOVE_UP` / `T.cyan` / `T.orange` | `V2.up` / `V2.cyan` / `V2.orange` | `#1FD98A` / `#219EBC` / `#FB8501` | "Armed" is a success state; "Ready to arm" is cyan; "Collecting evidence" is orange. |
| `fitPreviewTone()` (`:1232`) | `MOVE_UP` / `T.orange` | `V2.up` / `V2.orange` | as above | |
| Import line (`:135`) | `{ MOVE_DOWN, MOVE_UP, T, V2 }` | `{ T, V2 }` | — | |

---

## `strikeQuery.ts`

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `sqOtmColor()` `>= 5%` (`:759`) | `T.orange` | `V2.orange` | `#FB8501` | |
| `sqOtmColor()` below 5% (`:759`) | `alpha(T.text, 0.7)` | **NO CHANGE** | `rgba(255,255,255,0.7)` | Already exact. |
| `sqDeltaCellColor()` null (`:791`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `sqDeltaCellColor()` sign (`:792`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#8ECAE6` → `#1FD98A`, `#EF4444` | The three Δ cells. |
| `sqCardMetricColor()` unsigned (`:820`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `sqCardMetricColor()` sign (`:821`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | as above | |
| `SQ_NULL_CHG_RENDER.card.color` (`:843`) | `MOVE_UP` | `V2.up` | `#1FD98A` | `fmtB(0)` renders "+0", which v2 paints as a positive. |
| `SQ_NULL_CHG_RENDER.table.color` (`:844`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `sqHeaderColor()` active (`:855`) | `T.cyan` | `V2.cyan` | `#219EBC` | |
| `sqHeaderColor()` inactive (`:855`) | `T.muted` | `V2.green` | `#8ECAE6` | **Chrome leg** — the header `<tr>` and every inactive sort header. |
| `SQ_ERROR_COLOR` (`:865`) | `T.red` | `V2.red` | `#EF4444` | The error banner. Split from the directional red by MEANING, not by value — v2 uses `HT.red` for both, and so does this port. |
| `NEUTRAL` import | imported | **remove the import** | — | Spec E12: v2 imports it into this tab and never uses it. Nothing in the v3 file paints with it either. |
| Import line (`:91`) | `{ MOVE_DOWN, MOVE_UP, T, alpha }` | `{ T, V2, alpha }` | — | |

---

## `ibStats.ts`

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `rateColor()` null (`:336`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `rateColor()` `>= 60` (`:337`) | `MOVE_UP` | `V2.up` | `#8ECAE6` → `#1FD98A` | |
| `rateColor()` `<= 40` (`:338`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `rateColor()` else (`:339`) | `T.orange` | `V2.orange` | `#FB8501` | |
| `EXPANSION_COLORS.single` (`:1372`) | `T.cyan` | `V2.cyan` | `#219EBC` | "Single-side trend" bar. |
| `EXPANSION_COLORS.both` (`:1373`) | `T.purple` | `V2.purple` | `#126783` | "Rotational chop (both)" bar. |
| `EXPANSION_COLORS.none` (`:1374`) | `T.orange` | `V2.orange` | `#FB8501` | "Contained range (none)" bar. |
| `tacticalVerdictColor()` (`:1487`) | `MOVE_UP` / `MOVE_DOWN` / `T.orange` | `V2.up` / `V2.red` / `V2.orange` | `#1FD98A` / `#EF4444` / `#FB8501` | TRADEABLE EDGE / FADE SETUP / NO EDGE. |
| `overallVerdictColor()` NEUTRAL (`:1534`) | `T.orange` | `V2.orange` | `#FB8501` | |
| `overallVerdictColor()` signed (`:1535`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#1FD98A` / `#EF4444` | STRONG/LEAN BULLISH vs BEARISH. |
| `LIVE_GAUGE.needleColor` (`:1566`) | `T.text` | **NO CHANGE** | `#fff` | v2 typed a raw `#fff` here twice. `T.text` already resolves to it. |
| `gaugeVerdict()` (`:1597`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#1FD98A` / `#EF4444` | "High first" / "Low first". |
| `familyVerdict()` null (`:2215`) | `T.orange` | `V2.orange` | `#FB8501` | CONTEXT. |
| `familyVerdict()` H / L (`:2216`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#1FD98A` / `#EF4444` | HIGH ↑ / LOW ↓. |
| `tapeChip()` (`:2246`) | `T.orange` / `MOVE_UP` / `MOVE_DOWN` | `V2.orange` / `V2.up` / `V2.red` | as above | |
| `DOT.hit` / `.miss` (`:2262–2263`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | as above | Hit/miss is the split's positive test. |
| `IB_READ_ACCENT` (`:2290`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | The tab's own body accent — `sectionRow`, "THE RULES", "LAST 5 SESSIONS". Now agrees with the tab pill. |
| `WIDTH_BUCKET_COLORS.NARROW` (`:2934`) | `MOVE_UP` | `V2.up` | `#1FD98A` | v2 paints WIDE `HT.red` and NORMAL `HT.orange`, which makes the ladder a good→bad ramp rather than three categories. |
| `WIDTH_BUCKET_COLORS.NORMAL` (`:2935`) | `T.orange` | `V2.orange` | `#FB8501` | |
| `WIDTH_BUCKET_COLORS.WIDE` (`:2936`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `playbookBorderColor()` `>= 60` / `<= 40` (`:3952–3953`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#1FD98A` / `#EF4444` | Belongs to `PlaybookLegacy`, which the spec says not to port. Remap it anyway so the file has no straggler; delete both if the dead card goes. |
| `playbookBorderColor()` else (`:3956`) | `T.border` | **NO CHANGE / DO NOT TOUCH** | — | `--color-line` is v3 structural. See the DO NOT TOUCH list. |
| Import line (`:95`) | `{ LIGHT_BLUE, MOVE_DOWN, MOVE_UP, T }` | `{ T, V2 }` | — | |

---

## `ibProbability.ts`

The one file where v2's SECOND red is live.

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `EDGE_COLORS.bull` (`:321`) | `MOVE_UP` | `V2.up` | `#1FD98A` | v2's own `POS`, declared at `IbProbabilityEngine.tsx:37` with the comment "real green". Exact parity — this file is where `#1FD98A` came from on the scanner. |
| `EDGE_COLORS.bear` (`:322`) | `MOVE_DOWN` | `V2.neg` | `#FF3B3B` | v2's own `NEG`, "true red (not pink)". **Not `V2.red`.** v2 paints `#EF4444` in the IB Read card and `#FF3B3B` in the Probability Engine directly below it; Brandon kept the per-surface split. |
| `EDGE_COLORS.rot` (`:323`) | `T.orange` | `V2.orange` | `#FB8501` | Rotational Risk ring. |
| `EDGE_COLORS.off` (`:324`) | `T.flat` | `V2.neutral` | `#6B7686` → `#6B7280` | v2's `EDGECOL.off` is `#6B7686`, which the spec records as dead on this tab. Collapsed onto `V2.neutral` rather than minting a sixth grey. See open question 4. |
| `ringNumberColor()` zero branch (`:362`) | `T.muted` | `alpha(T.text, 0.55)` | `rgba(255,255,255,0.55)` | v2's `C.muted`. `T.muted` is opaque white, which makes a zero-value gauge read at full strength — the one place on this tab v2 does have a dimmed value. |
| `ringNumberColor()` live branch (`:362`) | `color` (passthrough) | **NO CHANGE** | — | Takes whatever `EDGE_COLORS` handed it. |
| Import line (`:74`) | `{ MOVE_DOWN, MOVE_UP, T }` | `{ T, V2, alpha }` | — | |

---

## `ibDailyResults.ts`

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `biasCell()` H / L (`:213`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#8ECAE6` → `#1FD98A`, `#EF4444` | The `Bias` column. |
| `biasCell()` neither (`:213`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `breakCell()` H / L (`:240`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | as above | |
| `breakCell()` BOTH (`:240`) | `T.purple` | `V2.purple` | `#126783` | v2's `Break = BOTH` cell. `T.purple` is `--color-dex` `#1f8dad`. |
| `breakCell()` else (`:240`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `extCell()` (`:259`) | `MOVE_UP` / `T.text` | `V2.up` / **NO CHANGE** | `#1FD98A` / `#FFFFFF` | |
| `ruleCell()` default (`:301`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `ruleCell()` hit / miss (`:310`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#1FD98A` / `#EF4444` | `RuleCell` ✓ / ✗. |
| `shouldntBeCell()` (`:352`) | `MOVE_DOWN` / `T.text` | `V2.red` / **NO CHANGE** | `#EF4444` / `#FFFFFF` | |
| `HIT_RATE_LABEL_COLOR` (`:425`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | v2's "HIT RATE" footer label. |
| `DAILY_RESULTS_TEXT.legendHeadingColor` (`:474`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | |
| `DAILY_RESULTS_TEXT.legendKeyColor` (`:476`) | `T.cyan` | `V2.cyan` | `#219EBC` | The `R#` legend keys and the card title. |
| `ERROR_COLOR` (`:504`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | An error banner is not a direction, but v2 paints both `HT.red`. |
| Import line (`:54`) | `{ LIGHT_BLUE, MOVE_DOWN, MOVE_UP, T }` | `{ T, V2 }` | — | |

---

## `ibLevels.ts`

The IB level ladder. Spec G says do not port `IbLevelCanvas` in its v2 form; step
2 rebuilt it anyway, so it is remapped here. If it is cut instead, drop the table.

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `levelColor()` `>= 1.5` (`:213`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `levelColor()` `>= 1` (`:214`) | `T.orange` | `V2.orange` | `#FB8501` | |
| `levelColor()` else (`:215`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | v2's 0.5× ladder colour. |
| `buildLadderDrawing()` IB box fill (`:430`) | `alpha(LIGHT_BLUE, 0.05)` | `alpha(V2.accent, 0.05)` | `#7dd3fc0D` | `0x0D/255 ≈ 0.05` — the alpha is already v2's. |
| `buildLadderDrawing()` IB box stroke (`:431`) | `alpha(T.text, 0.1)` | **NO CHANGE** | `rgba(255,255,255,0.10)` | v2's `HOME_THEME.border`. Already exact, and the comment beside it already says so. |
| `buildLadderDrawing()` mid line + "Reach the mid" (`:444`, `:453`) | `MOVE_UP` | `V2.up` | `#8ECAE6` → `#1FD98A` | |
| `buildLadderDrawing()` midpoint stroke (`:464`) | `alpha(T.text, 0.35)` | **NO CHANGE** | `rgba(255,255,255,0.35)` | |
| `buildLadderDrawing()` MIDPOINT label (`:472`) | `alpha(T.text, 0.6)` | **NO CHANGE** | `rgba(255,255,255,0.6)` | |
| `buildLadderDrawing()` IB HIGH line + fill (`:485`, `:492`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | |
| `buildLadderDrawing()` IB LOW line + fill (`:500`, `:507`) | `T.orange` | `V2.orange` | `#FB8501` | |
| `buildLadderDrawing()` `pxColor` (`:515`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#1FD98A` / `#EF4444` | Price marker above / below mid. |
| `buildLadderDrawing()` live-price chip (`:543`) | `alpha(T.panel, 0.72)` | `alpha(V2.panel, 0.72)` | `rgba(13,17,25,0.72)` | v2's `panelBgStrong`. `T.panel` is `#0f1117`, a different plate. |
| `statusPills()` break up / down (`:598`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#1FD98A` / `#EF4444` | |
| `statusPills()` IB-UNBROKEN (`:610–612`) | `LIGHT_BLUE` + alphas | `V2.accent` + same alphas | `#7dd3fc` @ `.09` / `.27` | Alphas are v2's `17` / `44` hex bytes; leave them. |
| `statusPills()` IB-DONE (`:619–621`) | `MOVE_UP` + alphas | `V2.up` + same alphas | `#1FD98A` @ `.08` / `.27` | |
| `statusPills()` IB-FORMING (`:625–627`) | `T.orange` + alphas | `V2.orange` + same alphas | `#FB8501` @ `.09` / `.33` | |
| `statusPills()` LOCKED (`:634–636`) | `LIGHT_BLUE` + alphas | `V2.accent` + same alphas | `#7dd3fc` @ `.07` / `.23` | |
| `railRows().distColor` (`:681`) | `LIGHT_BLUE` / `T.orange` | `V2.accent` / `V2.orange` | `#7dd3fc` / `#FB8501` | v2: positive distances light blue, negative distances orange. **Not a red** — do not "fix" it. |
| `railHeader().statusColor` (`:698`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#1FD98A` / `#EF4444` | Connected / disconnected. |
| `failPanel().midColor` (`:727`) | `MOVE_UP` | `V2.up` | `#1FD98A` | |
| `failPanel().oppColor` (`:730`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | "Full rotation". |
| Fail-panel label / body alphas (`.45`, `.62`) | `alpha(T.text, …)` | **NO CHANGE** | `rgba(255,255,255,…)` | v2's own opacities. |
| Import line (`:75`) | `{ LIGHT_BLUE, MOVE_DOWN, MOVE_UP, T, alpha }` | `{ T, V2, alpha }` | — | |

---

## `watchThis.ts`

**The one file where `V2.green` is a chart line and `ES_CANDLE_*` is a sign.** v2
declares five colour constants at the top of this surface (`PROBE_ICE`,
`PROBE_GRN`, `PROBE_RED`, `PROBE_TXT`, `PROBE_BG`) and they do not agree with the
table below them. That disagreement is kept.

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `probeTone()` positive (`:472`) | `MOVE_UP` | `ES_CANDLE_UP` | `#30d158` | v2's `PROBE_GRN`. The probe chart has its own pair; it does not share the table's. |
| `probeTone()` negative (`:472`) | `MOVE_DOWN` | `ES_CANDLE_DOWN` | `#ff5b5b` | v2's `PROBE_RED`. |
| `probeTone()` null / zero (`:472`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `directionColor()` (`:733`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#8ECAE6` → `#1FD98A`, `#EF4444` | The flag card's up/down symbol, spot and GEX. Table side, not chart side. |
| `highColor()` (`:857`) | `LIGHT_BLUE` / `T.text` | `V2.accent` / **NO CHANGE** | `#7dd3fc` / `#FFFFFF` | The `High` cell. |
| `maxPctColor()` (`:871`) | `MOVE_UP` / `MOVE_DOWN` / `T.text` | `V2.up` / `V2.red` / **NO CHANGE** | `#1FD98A` / `#EF4444` | Signed `Max %`. |
| `closestColor()` (`:891`) | `LIGHT_BLUE` / `T.text` | `V2.accent` / **NO CHANGE** | `#7dd3fc` | `Closest < 1%`. |
| `touchedColor()` (`:903`) | `LIGHT_BLUE` / `T.text` | `V2.accent` / **NO CHANGE** | `#7dd3fc` | The `Touched` date cell. |
| `statusColor('touched')` (`:920`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | |
| `statusColor('expired')` (`:920`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `statusColor('open')` (`:920`) | `MOVE_UP` | `V2.up` | `#8ECAE6` → `#1FD98A` | The `OPEN` status **word in the table**. Its chip one panel lower is `#30d158`, and stays so — spec H records the two as v2's own inconsistency and Brandon kept it. |
| `dayDateColor()` (`:959`) | `LIGHT_BLUE` / `T.text` | `V2.accent` / **NO CHANGE** | `#7dd3fc` | Open-day date. |
| `RESULT_SECTIONS` OPENED (`:986`) | `MOVE_UP` | `V2.up` | `#1FD98A` | |
| `RESULT_SECTIONS` TOUCHED (`:992`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | |
| `RESULT_SECTIONS` EXPIRED (`:998`) | `T.orange` | `V2.orange` | `#FB8501` | |
| `countColor()` zero branch (`:1008`) | `T.muted` | `alpha(T.text, 0.35)` | `rgba(255,255,255,0.35)` | v2 dims a zero count; `T.muted` is opaque white and does not. |
| `badgeColor('C')` (`:1073`) | `LIGHT_BLUE` | `V2.green` | `#8ECAE6` | v2's `C` badge chip is `PROBE_ICE` `#8ECAE6`, not `LIGHT_BLUE`. A CATEGORY (call vs put), so it takes the chrome value, exactly like `sideColor` on GEX Change Top. |
| `badgeColor('P')` (`:1073`) | `T.orange` | `V2.orange` | `#FB8501` | |
| `deltaColor()` (`:1149`) | `MOVE_UP` / `MOVE_DOWN` / `T.text` | `V2.up` / `V2.red` / **NO CHANGE** | `#1FD98A` / `#EF4444` | `Spot Δ%`, `Contract Δ$`, `Contract Δ%`. |
| `TABLE_HEADER_INK` (`:1162`) | `T.muted` | `V2.green` | `#8ECAE6` | **Chrome leg.** Every table header on this tab. |
| `sortHeaderInk()` active (`:1171`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | |
| `sortHeaderInk()` inactive (`:1171`) | `TABLE_HEADER_INK` | **NO CHANGE** | — | Follows the row above. |
| Import line (`:106`) | `{ LIGHT_BLUE, MOVE_DOWN, MOVE_UP, T }` | `{ ES_CANDLE_DOWN, ES_CANDLE_UP, T, V2, alpha }` | — | |

---

## `watchThisChart.ts`

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `PROBE_CHART_INK.line` (`:167`) | `LIGHT_BLUE` | `V2.green` | `#8ECAE6` | v2's `PROBE_ICE` — the chart line and its wash gradient. Not `LIGHT_BLUE`, not `V2.accent`. |
| `PROBE_CHART_INK.touched` (`:169`) | `LIGHT_BLUE` | `V2.green` | `#8ECAE6` | The `touched` status chip is `PROBE_ICE` too. |
| `PROBE_CHART_INK.high` (`:171`) | `MOVE_UP` | `ES_CANDLE_UP` | `#30d158` | `PROBE_GRN` — the chart's high marker. |
| `PROBE_CHART_INK.low` (`:173`) | `MOVE_DOWN` | `ES_CANDLE_DOWN` | `#ff5b5b` | `PROBE_RED`. |
| `PROBE_CHART_INK.text` (`:175`) | `T.text` | **NO CHANGE** | `#ffffff` | `PROBE_TXT`. |
| `PROBE_CHART_INK.pillInk` (`:177`) | `V2.ink` | **NO CHANGE** | `#06090d` ≈ `#0b0f1a` | Two near-blacks; the spec agrees a second token is not worth it. |
| `PROBE_CHART_INK.hoverDotFill` (`:179`) | `V2.bg` | **NO CHANGE** | `#05060a` | `PROBE_BG`. Already exact. |
| `PROBE_CHART_INK.gridline` (`:180`) | `alpha(T.text, 0.07)` | **NO CHANGE** | `rgba(255,255,255,0.07)` | |
| `PROBE_CHART_INK.entryLine` (`:182`) | `alpha(T.text, 0.4)` | **NO CHANGE** | `rgba(255,255,255,0.40)` | |
| `PROBE_CHART_INK.crosshair` (`:183`) | `alpha(T.text, 0.32)` | **NO CHANGE** | `rgba(255,255,255,0.32)` | |
| `PROBE_CHART_INK.tooltipFill` (`:184`) | `alpha(V2.panel, 0.96)` | **NO CHANGE** | `rgba(10,13,20,0.96)` | Invisible difference at 96%. |
| `PROBE_CHART_INK.tooltipBorder` (`:192`) | `alpha(MOVE_UP, 0.45)` | `alpha(ES_CANDLE_UP, 0.45)` | `rgba(48,209,88,0.45)` | The tooltip border is `PROBE_GRN`, matching the chart's own pair. |
| Import line (`:82`) | `{ LIGHT_BLUE, MOVE_DOWN, MOVE_UP, T, V2, alpha }` | `{ ES_CANDLE_DOWN, ES_CANDLE_UP, T, V2, alpha }` | — | |

---

## `GexLevelsTab.tsx`

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `ChartTooltip` background (`:497`) | `T.panel` | `V2.panel` | `#0D1119` | v2 makes this tooltip **opaque** on purpose, deliberately not the translucent plate. `T.panel` is `#0f1117`. |
| `SemiGauge` needle stroke / hub fill / value (`:620`, `:622`, `:623`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `AxisText` / `AxisTextSmall` fill (`:645`, `:664`) | `T.text` | **NO CHANGE** | `#FFFFFF` | Opacity `.55` is v2's own. |
| `ZeroLine` stroke (`:672`) | `T.border` | `V2W.border` | `rgba(255,255,255,0.10)` | v2's zero baseline is `HOME_THEME.border`, a white hairline. `--color-line` is opaque `#23272e`. |
| `CurveSpark` baseline stroke (`:909`) | `T.border` | `V2W.border` | `rgba(255,255,255,0.10)` | Same. |
| `VolGexFlowPanel` scrim (`:1926`) | `alpha(T.bg, 0.72)` | `alpha(V2.bg, 0.72)` | `rgba(5,6,10,0.72)` | v2's scrim is `HOME_THEME.bg` at 72%; `T.bg` is `#07080b`. |
| `volFlowScrimInk(error)` (`:1926`) | — | **NO CHANGE** | — | Remapped in `gexLevels.ts`. |
| The scope chip (`AmTbrStat`, spec B42) | — | `V2.accent` text, `V2W.chipBg`, `V2W.chipEdge` | `#7dd3fc` on `#8DCDFF` @ .10 / .28 | If step 2 collapsed the chip's plate onto its text colour, restore the two-blues split. Grep for the `0DTE` chip. |
| Import line (`:95`) | `{ T, alpha }` | `{ T, V2, V2W, alpha }` | — | |

---

## `GexChangeTopTab.tsx`

Largely already on `V2.*` — step 2 treated this tab as a parity surface. Four rows.

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| Card subtitle, C45 (`:449`) | `T.muted` | `V2.green` | `#8ECAE6` | **Chrome leg** — `PageCard` paints every subtitle this colour in v2. |
| `drawChart()` peak-marker dashed line (`:1550`) | `alpha(MOVE_UP, 0.35)` | `alpha(V2.green, 0.35)` | `tint(#8ECAE6, .35)` | The peak marker is drawn **unconditionally** — it is not a sign, so it keeps the chrome value. |
| `drawChart()` peak-marker dot fill (`:1555`) | `MOVE_UP` | `V2.green` | `#8ECAE6` | Same. |
| `drawChart()` peak-marker dot stroke (`:1556`) | `V2.bg` | **NO CHANGE** | `#05060A` | |
| Every other `V2.cyan` / `V2.orange` / `V2.red` / `V2.bg` / `V2W.border` / `V2W.panelBg` site | — | **NO CHANGE** | — | 30+ sites. All already exact against spec Part C's Colours-used table. Do not touch them. |
| Every `T.text` site (48) | `T.text` | **NO CHANGE** | `#FFFFFF` | v2's `HT.text` and `HT.muted` are both `#FFFFFF`. |
| Every `alpha(T.text, …)` site (`.08`, `.1`, `.2`, `.25`, `.35`) | — | **NO CHANGE** | `tint(HT.text, …)` | The alphas are v2's own. |
| Import line (`:76`) | `{ MOVE_UP, T, V2, V2W, alpha }` | `{ T, V2, V2W, alpha }` | — | |

---

## `PickStudyTab.tsx`

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `richText()` `<code>` (`:210`) | `T.cyan` | `V2.cyan` | `#219EBC` | The filename in the not-armed prose. |
| `SortHeaderRow` active header (`:252`, `:258`) | `T.cyan` | `V2.cyan` | `#219EBC` | |
| `SortHeaderRow` inactive header (`:252`) | `TABLE_HEADER_COLOR` | **NO CHANGE** | — | Remapped in `pickStudy.ts`. |
| `RateBar` em-dash (`:276`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `RateBar` track (`:279`) | `alpha(T.text, 0.1)` | **NO CHANGE** | `tint(HT.text, 0.10)` | |
| `RuleBar` Arm button ink + border (`:368`) | `MOVE_UP`, `alpha(MOVE_UP, 0.45)` | `V2.up`, `alpha(V2.up, 0.45)` | `#1FD98A`, `tint(#8ECAE6, .45)` | An arm action is a success state. |
| `RuleBar` progress track (`:393`) | `alpha(T.text, 0.1)` | **NO CHANGE** | `tint(HT.text, 0.10)` | |
| `FitPreview` background (`:441`) | `alpha(T.text, 0.04)` | **NO CHANGE** | `tint(HT.text, 0.04)` | |
| `FitPreview` border (`:441`) | `alpha(tone, 0.25)` | **NO CHANGE** | `tint(tone, 0.25)` | `tone` comes from `fitPreviewTone`, remapped in `pickStudy.ts`. |
| Zero grade count (`:981`) | `alpha(T.text, 0.3)` | **NO CHANGE** | `tint(HT.text, 0.3)` | |
| Every other `T.text` site (23) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| Import line (`:60`) | `{ MOVE_UP, T, alpha }` | `{ T, V2, alpha }` | — | |

---

## `StrikeQueryTab.tsx`

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `sqCellColor()` unsigned (`:126`) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| `sqRowBackground()` zebra (`:132`) | `alpha(T.text, 0.02)` | **NO CHANGE** | `rgba(255,255,255,0.02)` | |
| `sqCardBackground()` even card (`:137`) | `alpha(T.cyan, 0.06)` | `alpha(V2.cyan, 0.06)` | `rgba(33,158,188,0.06)` | |
| `sqCardBackground()` odd card (`:137`) | `alpha(T.text, 0.02)` | **NO CHANGE** | `rgba(255,255,255,0.02)` | |
| Toolbar labels — ticker / expiry / limit (`:257`, `:276`, `:296`) | `T.muted` | `V2.green` | `#8ECAE6` | **Chrome leg** — v2's `lbl` toolbar labels. |
| `|` divider glyph (`:316`) | `T.border` | `V2W.border` | `rgba(255,255,255,0.10)` | Spec E56. `--color-line` is opaque. |
| `min OTM` label (`:333`) | `T.orange` | `V2.orange` | `#FB8501` | |
| Sort hint (`:361`) | `alpha(T.text, 0.35)` | **NO CHANGE** | `rgba(255,255,255,0.35)` | Keep 0.35 as v2 wrote it — the step-2 note proposing a collapse onto 0.40 is superseded. |
| Top-10 header text (`:388`) | `T.muted` | `V2.green` | `#8ECAE6` | **Chrome leg.** |
| Card expiry / rank / metric label / empty row (`:412`, `:419`, `:430`, `:515`) | `alpha(T.text, 0.4)` | **NO CHANGE** | `rgba(255,255,255,0.4)` | |
| Card strike price (`:417`) | `T.cyan` | `V2.cyan` | `#219EBC` | |
| Static `th` cells (`:447`, `:452`, `:458`) | `T.muted` | `V2.green` | `#8ECAE6` | **Chrome leg** — v2's header `<tr>` colour. |
| Expiry body cell (`:484`) | `alpha(T.text, 0.7)` | **NO CHANGE** | `rgba(255,255,255,0.7)` | |
| The `Positive` / `Negative` direction buttons | `SegGroup` | **DO NOT TOUCH** | `#8ECAE6` / `#EF4444` | The active-state colour belongs to the `SegGroup` primitive. See the DO NOT TOUCH list and open question 6. |
| Import line (`:45`) | `{ T, alpha }` | `{ T, V2, V2W, alpha }` | — | |

---

## `IbStatsTab.tsx`

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `SectionTr` (`:321`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | v2's `sectionRow`. |
| `Gauge` track stroke (`:396`) | `alpha(T.text, 0.1)` | **NO CHANGE** | `rgba(255,255,255,0.10)` | |
| `Gauge` green arc (`:403`) | `MOVE_UP` | `V2.up` | `#8ECAE6` → `#1FD98A` | |
| `Gauge` red arc (`:412`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `Bar` track (`:455`) | `alpha(T.text, 0.07)` | **NO CHANGE** | `rgba(255,255,255,0.07)` | |
| `LiveRead` verdict plate + three sub-panels (`:495`, `:513`, `:532`, `:543`) | `alpha(T.text, 0.03)` | **NO CHANGE** | `rgba(255,255,255,0.03)` | |
| `LiveRead` pHigh figure (`:520`) | `MOVE_UP` | `V2.up` | `#1FD98A` | |
| `LiveRead` pLow figure (`:524`) | `MOVE_DOWN` | `V2.red` | `#EF4444` | |
| `IbRead` hero family border (`:658`) | `T.orange` | `V2.orange` | `#FB8501` | |
| `IbRead` non-hero family border (`:658`) | `T.border` | `V2W.border` | `rgba(255,255,255,0.10)` | v2's family plate edge. |
| `IbRead` hero family fill (`:659`) | `alpha(T.orange, 0.08)` | `alpha(V2.orange, 0.08)` | `rgba(251,133,1,0.08)` | v2 typed this literal; the alpha is right, the hue is not. |
| `IbRead` non-hero family fill (`:659`) | `T.panelBg` | `V2W.panelBg` | `rgba(13,17,25,0.45)` | `T.panelBg` is opaque `#14171d`; v2's plate is translucent. |
| `IbRead` member pill fill (`:690`) | `T.panelBg` | `V2W.panelBg` | `rgba(13,17,25,0.45)` | Same. |
| `IbRead` hero badge (`:665`) | `T.orange` | `V2.orange` | `#FB8501` | |
| `Ring` track (`:749`) | `alpha(T.text, 0.07)` | **NO CHANGE** | `rgba(255,255,255,0.07)` | v2's `C.track`. |
| `ProbabilityEngine` symbol chip (`:818`) | `T.cyan` | `V2.cyan` | `#219EBC` | |
| `ProbabilityEngine` "10:30 Close" chip (`:826`) | `T.orange` | `V2.orange` | `#FB8501` | |
| `ProbabilityEngine` "Live" chip (`:839`) | `MOVE_UP` | `V2.up` | `#1FD98A` | v2's `TAG` chip is `POS #1FD98A` — exact parity. |
| `ProbabilityEngine` section label (`:863`) | `T.cyan` | `V2.cyan` | `#219EBC` | |
| `DailyResultsTable` legend hit / miss (`:926`, `:930`, `:937`, `:941`) | `MOVE_UP` / `MOVE_DOWN` | `V2.up` / `V2.red` | `#1FD98A` / `#EF4444` | |
| Every `T.text` site (7) | `T.text` | **NO CHANGE** | `#FFFFFF` | |
| Import line (`:68`) | `{ LIGHT_BLUE, MOVE_DOWN, MOVE_UP, T, alpha }` | `{ T, V2, V2W, alpha }` | — | |

---

## `WatchThisTab.tsx`

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| `ROW_WASH` (`:270`) | `alpha(T.text, 0.02)` | **NO CHANGE** | `rgba(255,255,255,0.02)` | Odd-row striping, all four tables. |
| `ROW_OPEN` (`:272`) | `alpha(T.cyan, 0.1)` | `V2W.pickRow` | `rgba(33,158,188,0.10)` | The expanded-row highlight. `V2W.pickRow` is already `alpha(V2.cyan, 0.1)`. |
| `ROW_EXPANDED` (`:280`) | `alpha(SHADOW, 0.2)` | **NO CHANGE** | `rgba(0,0,0,0.20)` | v2 uses `.20` in the flat table and `.25` in the day sub-table for no stated reason; step 2 picked one and that stands. |
| `DIM_INK` (`:283`) | `alpha(T.text, 0.35)` | **NO CHANGE** | `rgba(255,255,255,0.35)` | |
| `DISCLOSURE_INK` (`:285`) | `alpha(T.text, 0.45)` | **NO CHANGE** | `rgba(255,255,255,0.45)` | |
| `PANEL_MUTED` (`:287`) | `alpha(T.text, 0.62)` | **NO CHANGE** | `rgba(255,255,255,0.62)` | v2's `PROBE_MUTED`. |
| `FlagCard` "WATCH THIS" label (`:356`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | |
| `FlagCard` strike line (`:362`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | |
| `FlagCard` "View chain →" (`:388`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | |
| `ProbeChart` empty copy (`:494`) | `T.text` | **NO CHANGE** | `#ffffff` | |
| `OutcomeDetailPanel` plate (`:834`) | `T.bg` | `V2.bg` | `#05060a` | v2's `PROBE_BG`. `T.bg` is `#07080b`. |
| `OutcomeDetailPanel` border (`:834`) | `alpha(T.cyan, 0.5)` | `alpha(V2.cyan, 0.5)` | `rgba(33,158,188,0.5)` | |
| `OutcomeDetailPanel` error copy (`:918`) | `T.orange` | `V2.orange` | `#FB8501` | |
| `ResultsByDay` error copy (`:1015`) | `T.orange` | `V2.orange` | `#FB8501` | |
| Flag-grid error banner (`:1552`) | `T.orange` | `V2.orange` | `#FB8501` | |
| Add-ticker status — success (`:1543`) | `LIGHT_BLUE` | `V2.accent` | `#7dd3fc` | v2's add-success message. |
| Add-ticker status — error (`:1543`) | `T.red` | `V2.red` | `#EF4444` | |
| Every other `T.text` site (14) | `T.text` | **NO CHANGE** | `#ffffff` | |
| `captureFlagCard` (if ported) | — | **resolve at capture time** | — | Spec H213: an off-DOM SVG cannot read a `var()`. Resolve tokens with `getComputedStyle` and inject; do **not** reintroduce a hardcoded palette, and do not add a `theme-baseline.json` entry to allow one. |
| Import line (`:88`) | `{ LIGHT_BLUE, SHADOW, T, alpha }` | `{ SHADOW, T, V2, V2W, alpha }` | — | |

---

## `Scanner.tsx`

| Symbol / call site | Currently | Change to | v2 value | Why |
|---|---|---|---|---|
| Tab pill border (`:187`, `style={on ? { borderColor: t.accent } : undefined}`) | `t.accent` | **NO CHANGE** | — | Reads the accent straight off `SCANNER_TABS`. Remapping `scannerNav.ts` is the whole change; this line is already correct and must not gain a token of its own. |
| Everything else in the file | — | **NO CHANGE** | — | The page frame imports no colour token at all — `Page`, `Suspense` and the six `lazy()` tabs. Verified: no `T.*`, no `V2.*`, no `alpha()`. |

---

# The three-way split, stated once

`HOME_THEME.green` `#8ECAE6` is a light blue doing three unrelated jobs. Each
leg takes a **different v2 value**, and every one of the three is a colour v2
already ships — nothing is invented.

### chrome → `V2.green` `#8ECAE6`

Card subtitles and table header rows keep the value v2 painted them.

**Evidence.** It is applied structurally, not per-tab: `PageCard.tsx:138` paints
*every* card subtitle on the page with `HOME_THEME.green`, and the shared `th`
style in six of the seven tabs does the same. It is the single largest use of the
value by site count, it is the one applied by shared chrome rather than by a tab,
and moving it would recolour every card on `/v3/scanner` away from v2 — which is
the opposite of the decision. The value stays where the most code already is.

Consumers: `gexChangeTop.ts` `th`/subtitle, `pickStudy.ts` `TABLE_HEADER_COLOR`,
`strikeQuery.ts` `sqHeaderColor` inactive + toolbar labels, `watchThis.ts`
`TABLE_HEADER_INK`, `GexChangeTopTab.tsx:449`, `StrikeQueryTab.tsx` labels + `th`.
Plus the two CATEGORY uses that are chrome-adjacent and also stay: the call-side
badge (`sideColor`, `badgeColor('C')`), the A+/A grade pill, and the probe
chart's `PROBE_ICE` line — all of which v2 paints `#8ECAE6` and none of which is
chosen by the sign of a number.

### accent → `V2.accent` `#7dd3fc`

The IB Stats and Watch This tab pills.

**Evidence.** `homeTheme.ts:87–88` declares `export const LIGHT_BLUE = "#7dd3fc"`
under the comment **"The one card accent — light blue. Replaces rotating per-card
colors."** v2 names this value, in its own source of truth, as the accent — so the
accent leg has a v2 answer that needs no invention. Two more supports: v2's Watch
This pill was *already* `#7dd3fc`, so this makes the two structure tabs agree
rather than splitting them; and the IB Stats tab's own body already accents in
`#7dd3fc` throughout (`sectionRow`, "THE RULES", "LAST 5 SESSIONS", "HIT RATE",
the whole IB level ladder), so v2 had the pill disagreeing with the tab it opens.

### positive → `V2.up` `#1FD98A`

Every figure whose colour is chosen by the sign of a number, or by a
good/bad, hit/miss, up/down or success/failure test — **on the surfaces where v2
painted that figure `#8ECAE6`**.

**Evidence.** `homeTheme.ts:288–293` declares `REFRESH_GREEN = "#1FD98A"` under
the comment **"The 'up / success' green. Exported because it is a role color, not
a refresh-button detail."** v2 names this value, in its own source of truth, as
the up/success role. Second support: the scanner *already paints a positive with
it* — `IbProbabilityEngine.tsx:37` declares `POS = "#1FD98A"` with the comment
"real green", one card below an IB Read card painting the same semantic
`#8ECAE6`. So `#1FD98A` is not imported from elsewhere; it is this page's own
answer to "what colour is a good number", written down twice.

### What did NOT move

The other three positives keep their surfaces, exactly as v2 paints them:

| v2 positive | Token | Surface | v2 source |
|---|---|---|---|
| `#22c55e` | `V2.pos` | GEX Levels' **gamma** surfaces only — cumulative curve, gamma bars, their legends | `GexLevelsTab.tsx:456` `GEX_POS_GREEN`, declared there *because* `.green` is a blue |
| `#7dd3fc` | `V2.accent` | GEX Levels' **delta / OI / EOD** surfaces, gauge positive bands, Resistance tile, spot line | `homeTheme.ts:88` `LIGHT_BLUE` |
| `#30d158` | `ES_CANDLE_UP` | Watch This' **probe chart** only — high marker, price pill, tooltip, `OPEN` chip | `homeTheme.ts:106` `ES_CANDLE_UP`, v2's `PROBE_GRN` |
| `#1FD98A` | `V2.up` | everything else that is a sign or a success | `homeTheme.ts:293` `REFRESH_GREEN` |

And the negatives, which split the same way and for the same reason:

| v2 negative | Token | Surface |
|---|---|---|
| `#EF4444` | `V2.red` | the page's default — tables, bars, gauges, error banners, F grades |
| `#FF3B3B` | `V2.neg` | the Probability Engine's Bearish Edge only |
| `#ff5b5b` | `ES_CANDLE_DOWN` | Watch This' probe chart only |

**Do not unify any of these.** Every one of them has a v2 comment defending it
against the others, and Brandon's decision is that they ship as v2 paints them.

---

# DO NOT TOUCH

Structural v3 colours with no v2 counterpart, and anything a v3 primitive owns.
A row here is a value an applying agent will be tempted to "finish"; none of them
is in scope.

| Thing | Why it stays |
|---|---|
| `T.border` / `--color-line` / the `border-line` utility (37 sites across five tabs) | The v3 hairline. **Exception:** the six sites named in the tables above are v2's `HOME_THEME.border` painted through an inline style, and those become `V2W.border`. The `border-line` Tailwind class stays — see open question 1. |
| `T.bg` / `--color-bg`, and the `bg-bg` utility (5 sites) | The page canvas belongs to `Page` and the shell, not to the scanner. **Exception:** `WatchThisTab.tsx:834`, which is v2's `PROBE_BG` on a detail panel, not the canvas. |
| The surface ladder — `--color-surface`, `--color-surface2`, `--color-raised`, and the `bg-surface2` / `bg-raised` utilities | v3 structural. Never invent a plate colour; a plate is a `Card`. |
| `T.text` / `T.muted` / `T.faint`, and the `text-muted` / `text-faint` utilities (37 sites) | All three resolve to `#ffffff`, which is exactly v2's `HOME_THEME.text` **and** `HOME_THEME.muted`. Already correct. Converting them to a `V2.*` name changes nothing and adds a name for a value that already matches. **Exception:** the two sites where v2 dims a value with an opacity and v3 does not — `ibProbability.ts:362` and `watchThis.ts:1008`, both in the tables above. |
| The `Card` primitive's plate, radius, shadow and edge | Owned by `src/design/primitives/Card`. v2's plate is `rgba(13,17,25,0.45)`; v3's is `--color-surface`. Changing that is a primitives change, not a scanner change — see open question 1. |
| `SegGroup`, `Chip`, `Table`, `Stat`, `ChartFrame` internals | The primitives own their active/hover/border states. The Strike Query `Positive`/`Negative` buttons and every `seg()` in v2 land here. |
| The type scale, spacing and radius tokens | Untouched by this decision. |
| `SHADOW` / `--color-shadow` and every `alpha(SHADOW, …)` | `#000000`, which is v2's `rgba(0,0,0,…)` exactly. |
| Every `alpha(T.text, n)` wash already in the modules | The alphas were transcribed from v2 (`.02 .03 .04 .05 .06 .07 .08 .1 .15 .2 .25 .3 .32 .35 .4 .45 .5 .55 .6 .62 .7 .75 .82`) and `T.text` is already `#ffffff`. Do not "modernise" them onto `V2W.*` unless a named `V2W` entry already exists for that exact value. |
| The six tombstoned TPO modules | `TpoTab.tsx`, `tpoData.ts`, `tpoStructures.ts`, `tpoTaxonomy.ts`, `tpoProfile.ts`, `amt.ts`. Tab dropped, spec Part F dropped. |
| Every page outside `/v3/scanner` | Em, Flow, Options Chain, Premarket, Analysis, Replay, Traders Dashboard, the board cards. No token changes value, so none of them moves. |

---

# Build-gate notes

**`theme-baseline.json` — no entry needed.** No scanner file is in the baseline
today, and nothing proposed here introduces a colour literal: the three new hexes
land inside `tokens.css` (which the check exempts), and every module edit swaps
one `var(--color-…)`-backed symbol for another. If a file needs a baseline entry
after this work, something went wrong — do not add one to make the build pass.

**`check-theme.mjs` — three things to watch.**

1. `TOKEN.up` / `TOKEN.down` in `gexLevels.ts` are bare custom-property **name**
   strings, not `var()` calls, fed to `tokenHex()`. The check's "no unknown var"
   rule applies: `--color-v2-refresh` and `--color-v2-red` are both declared in
   `tokens.css`, so both pass. Renaming or removing either token later breaks
   this file silently — `tokenHex()` returns `'transparent'` rather than throwing.
2. `V2.neutral` points at `--color-impact-holiday`, which is declared. Passes.
3. Nothing here adds a Tailwind palette class or a `text-[Npx]`.

**One real risk.** `tokenHex()` caches per token name for the life of the page.
Card 12's chart resolves `--color-v2-refresh` at mount; if the amendment to that
token's comment is ever "cleaned up" into a rename, the chart paints nothing and
no error is raised. Worth a line in the token's comment saying `gexLevels.ts`
reads it by name.

---

# Open questions

1. **The card edge, and it is the big one.** v2's `HOME_THEME.border` is
   `rgba(255,255,255,0.10)` — a white hairline. v3's `--color-line` is an opaque
   slate `#23272e`, and 37 sites on the scanner reach it through the `border-line`
   Tailwind utility and through the `Card` primitive. Five separate Parts of the
   spec call this out in the same words ("**not** `--color-line`, which is opaque
   `#23272e`"). The six inline sites are remapped above; the 37 utility sites and
   the `Card` plate are not, because they belong to the primitives. **This is the
   largest remaining v2-vs-v3 divergence on the page after this remap.** Options:
   (a) leave it, and accept that the scanner's cards have v3 edges and v2 ink;
   (b) a scanner-scoped wrapper class that overrides `--color-line` and the card
   plate for the subtree; (c) accept the primitives change. Needs Brandon.
2. **`COPIED_COLOR` and "Armed".** v2 paints both `#8ECAE6`. Read as "success
   states" they take `V2.up`; read strictly as "not a signed number" they keep
   `V2.green` and are then the same colour as the table headers beside them. The
   tables above take the first reading, on the strength of `REFRESH_GREEN`'s own
   docblock saying "up / **success**". If Brandon wants strict per-site v2
   parity instead, three rows flip: `pickStudy.ts` `COPIED_COLOR`,
   `ruleBarState().tone` armed, `fitPreviewTone()` armed.
3. **The flip line.** v2 draws the gamma-flip marker three ways: white on the
   cumulative chart, **`#22C55E` on the gamma bars**, white in the table
   sparkline. Step 2 collapsed all three onto white (v2's majority) and this
   document leaves that collapse standing — it is a treatment decision, not a
   palette one. But it does mean the bars chart's flip line changes hue. Same
   question for `SPOT_LINE`, where v2 had `#7dd3fc` @ .6, `#7dd3fc` @ .75 and
   white @ .6. Confirm the treatment collapses survive the palette reversal.
4. **`#6B7686` vs `#6B7280`.** Two greys eleven units apart: v2's scanner-wide
   `NEUTRAL` (`scannerStyles.ts`) and the Probability Engine's local `C.grey`.
   The second paints nothing on this tab (spec G161: dead). Collapsed onto
   `V2.neutral`. If a live surface for `EDGECOL.off` ever appears, this needs a
   real answer.
5. **`#888`.** The refresh button's "refreshing" ink is a bare `#888` typed into
   `homeTheme.ts` — not a named v2 constant, so there is nothing for it to point
   at. Left on `T.flat` `#7a828d`, which is closer to `#888888` than
   `V2.neutral` `#6b7280` is. Flagging it because it is the one colour on the
   page with no v2 name at all.
6. **`SegGroup`'s active state.** v2's `seg()` paints the active button
   `HOME_THEME.cyan` text on `rgba(33,158,188,0.15)` with a `#219EBC` border, and
   Strike Query additionally paints the `Positive` / `Negative` buttons
   `#8ECAE6` / `#EF4444` when active — a *per-option* colour the primitive has no
   API for. Either the primitive grows an `activeColor` prop or Strike Query's
   direction filter loses that signal. Needs a call before Strike Query is
   applied.
7. **`--color-v2-neutral`, or the alias?** `V2.neutral` reaches into the econ
   calendar's `--color-impact-holiday` because the value is byte-identical and
   the token file's rule is one declaration per value. It reads oddly at the call
   site. The alternative is a fourth new token that duplicates a value — which
   the parity block already does deliberately three times, with a comment
   explaining why. Cheap either way; say which you prefer.

---

# DECISIONS — Brandon / Claude, 2026-09-03

The seven open questions above are settled. Apply these; do not re-litigate them
at a call site.

## 1. The card edge — SCOPE-OVERRIDE, do not change the primitives

v2's card edge is `rgba(255,255,255,0.10)`, a white hairline. v3's
`--color-line` is opaque `#23272e`. Six sites reach it through an inline style
and are remapped in the tables above; **37 more go through the `border-line`
utility and the `Card` primitive, which the scanner does not own.**

Changing `--color-line` globally would recolour every v3 page, and the scope for
this whole exercise is **the scanner only**. Changing the primitives is the same
problem wearing a different hat.

So: the page root gets a class that **redefines the token for its own subtree**.
That is what custom properties are for — no primitive changes, no other page
touched, and it reverts by deleting one rule.

Add to `tokens.css`, beside the v2 block:

```css
/* The scanner runs on v2's palette (Brandon, 2026-09-03). v2's card edge is a
   white hairline, not v3's slate line, and 37 of the sites that draw it live
   inside the Card primitive and the border-line utility — neither of which the
   scanner owns. Redefining the token for this subtree is how the page gets v2's
   edge without recolouring every other v3 page. Delete this rule to put the
   scanner back on the v3 edge; nothing else has to change. */
.scanner-v2 {
  --color-line: rgba(255, 255, 255, 0.1);
}
```

`pages/Scanner.tsx` puts `scanner-v2` on the element it renders inside `Page`.
That is the ONE edit `Scanner.tsx` takes — its remap table above stays
otherwise NO CHANGE.

**This is the only global-token override the scanner gets.** Anything else that
diverges gets remapped per call site or stays v3.

## 2. "Armed" / "✓ copied" → `V2.up`

Both are success states — the evidence cleared the bar, the clipboard write
landed. `V2.up` is the role colour for exactly that. Confirmed.

## 3. The spot-line and flip-line treatments — RESTORE v2

Step 2 collapsed three spot-line treatments and three gamma-flip treatments into
one each. The palette reversal takes those back: v2's gamma-bars flip line is
`#22C55E`, not white. Restore v2's per-chart treatment — colour, dash pattern and
in-view guard — as the spec's Part B rows record them. The reason the collapse
existed was that v3 semantics had no room for three; v2's palette does.

## 4. `#6B7686` → use `#6B7280`

`components/scanner/scannerStyles.ts:16` is the source of truth and it says
`#6B7280`. The other spelling is a transcription slip.

## 5. `#888` — scanner-scoped token, and say it is unnamed

It has no v2 constant behind it — it is a bare literal in v2's source. Give it
`--color-v2-scanner-dim: #888888` with a comment stating plainly that v2 names
it nowhere, so a future reader knows it is a literal being preserved rather than
a role being honoured.

## 6. `SegGroup` gains an OPTIONAL `activeColor` prop

Strike Query's Positive/Negative buttons carry per-option colour in v2 and must
keep it. An optional prop is additive: every existing caller omits it and renders
byte-identically, so no other v3 page changes. This is the one primitive edit
allowed, and it is allowed *because* it is invisible to everything that does not
pass it.

Do NOT give `SegGroup` a scanner-specific default, and do not reach into it from
the scanner any other way.

## 7. `V2.neutral` — its own declaration, not an alias

`--color-v2-neutral: #6b7280`, duplicating `--color-impact-holiday`'s value.
Same reasoning the existing block already gives for `v2-cyan` == `cal-accent`:
a scanner neutral is not a calendar holiday; they agree today and must be free to
move apart tomorrow.

## Standing rule for the applying pass

Where the remap table says **NO CHANGE**, make none — most of those are `T.text`,
which is `#ffffff` in both palettes, and "converting" them is motion without
change that makes the diff unreviewable.
