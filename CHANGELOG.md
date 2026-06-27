# Changelog

## 2026-06-27 — Dashboard-wide dock toolbar rollout + Inter global font

Created `components/shared/DockToolbar.tsx` (Dock, SegGroup, ToggleTile, DockButton, DockSlider, DockExpiryPicker, DockCalendar — glossy flat full-width bar w/ cyan gradient top-line, portal'd pickers) and converted every chart/filter toolbar to it: `GexToolbar.tsx`, `app/es-candles`, `app/greeks`, `app/mult-greek`, `EstimatedMoves.tsx`, `app/fails`, `app/confidence-score`, `app/social-media`, plus the global `GlobalToolbar.tsx` (top accent line + ET clock moved top-right). Also fixed Inter never actually loading (now via `next/font` in `app/layout.tsx` + `tailwind.config.ts` `font-sans` + ~30 hardcoded stacks routed through `var(--font-inter)`), removed the GEX snapshot button/header, and fixed the dropdown-under-chart z-index bug via portals.


## 2026-06-26 — toolbar-preview quotes/dropdown examples + per-user add-ticker

`app/toolbar-preview/page.tsx`: added three dock-themed standalone previews (Quotes panel w/ sparklines + sort toggle, DTE/Expiry "Day Date" dropdown, month-grid Calendar) laid out in a 3-column row. `app/api/quotes-batch/route.ts`: sparkline now falls back to the prior session's curve when the market is closed. `components/dashboard/NquQuotePill.tsx`: restyled the live toolbar Quotes dropdown to the dock theme and added per-user add/remove ticker, backed by new `app/api/quote-symbols/route.ts` + `quote_symbol_prefs` table and `getQuoteSymbols`/`upsertQuoteSymbols` in `lib/db.ts`.

## 2026-06-26 — NavMenu restyle + drag-and-drop + monochrome glyphs

`components/shared/NavMenu.tsx`: restyled the flyout to the frosted dock theme (cyan top-accent, gradient active tiles, themed cyan scrollbar) and removed the social icons + Clerk avatar (legal-only footer). Added direct row drag-and-drop to reorder within groups and drop into Quick Pages (cap 4, replace-at-slot when full; persisted to `sidebar-group-order-v1`), removed the grip handles and star pin buttons, added per-route monochrome Unicode glyphs, and made all groups collapse on every menu open.

## 2026-06-26 — Toolbar vertical-centering + middle-aligned ticker, removed search/expiry

`components/shared/GlobalToolbar.tsx`: switched the bar to `box-sizing: border-box` so `align-items:center` vertically centers content on every page (global — rendered once in LayoutShell). Made the live ticker absolutely centered over the whole toolbar (`position:absolute`, left/top 50% + translate) instead of a flex spacer, and removed the Search-tickers box, the expiration date chip, and their now-unused `query` state and `SearchIcon`/`ChevronDown` components; Notes stays pinned top-right.


## 2026-06-26 — Local WS `verify-error` triage + stray env-file cleanup

Debug session (no code changes). Local `npm run dev` was logging `[WS] upgrade rejected (verify-error)` on `/ws/gex`.

- **Root cause:** stale local dev process still holding `WS_AUTH_REQUIRED=1` from before the env edit. Root `.env.local` was already `=0`; prod container has the var unset (gate off, owner streaming confirmed). Fix = clean kill + relaunch of `npm run dev` (env is read at process start).
- **Confirmed prod is fine:** `docker compose exec dashboard printenv WS_AUTH_REQUIRED` → empty → `=== '1'` false → `verifyWsRequest` never called. Rejects were local-only.
- **Security cleanup:** found a stray full copy of `.env.local` (all live secrets in plaintext) at `md files/.env.local`. Deleted it; confirmed via `git status` it was never tracked → no history leak. Root `.env.local` remains the single source.


## 2026-06-26 — WS auth gate, perf hardening, server-render POC (v17)

Pre-launch session: closed the one real launch blocker (unauthenticated `/ws/gex`) and shipped perf fixes. Diagnosed (and prototyped) the perceived sluggishness as a client-render waterfall, not a data/architecture problem.

### WS authentication gate (launch blocker — fixed & live)
- **`/ws/gex` was unauthenticated** — anyone with the URL could stream paid GEX free (upgrade handler only checked path). **`server-v2/ws-auth.js`** (new) — `verifyWsRequest` reads the Clerk session cookie via `@clerk/backend` `authenticateRequest` (cookie-based → zero client changes across the 7+ WS call sites), resolves userId, then owner/active/trialing check against `subscriptions` (mirrors `lib/subscription.getAccessForUser`; PAID_STATUSES kept in sync).
- **`server-v2/websocket-server.js`** — upgrade handler verifies BEFORE `handleUpgrade` so no snapshot reaches an unauthorized socket; rejects 401 + `socket.destroy()`. Gated by env `WS_AUTH_REQUIRED` (default off → unchanged behavior). Needs production Clerk (cookie unreliable on dev instance). Enabled in prod with `WS_AUTH_REQUIRED=1` + `CLERK_AUTHORIZED_PARTIES=https://cbedge.net`; owner confirmed still streaming.

### Performance
- **`app/database/page.tsx`** — removed the unused client-side Excel export (271 KB `xlsx`/SheetJS off First Load; `/database` ~200→~130 kB). `xlsx` stays for the server-side `scripts/import-mvc.js`.
- **`middleware.ts`** — maintenance flag check is now stale-while-revalidate (30s TTL, background refresh) so it no longer blocks every page on a `/proxy/maintenance` round-trip; only the first request after boot waits.
- **`next.config.js`** — wired `@next/bundle-analyzer` (`npm run analyze`, env-scoped so dev/build never trigger it).

### Server-render POC (perceived speed — full work deferred to post-launch)
- **`app/home-fast/`** (new, `page.tsx` + `HomeFastLive.tsx`) — proves server-rendering the GEX snapshot from the hot in-process feed (`/proxy/gex`) into the initial HTML, so a live card paints with real data on first byte (no client fetch waterfall). The WS then handles updates. Full `/home` refactor planned after Monday launch + ThetaData swap.

## 2026-06-26 — ICT setup recorder, owner Results page, glossary card manager

Three-part session: auto-record every ICT setup to Postgres with auto-graded outcomes, surface the performance on a new owner-only Results page, and let each user show/hide glossary cards (persisted server-side). All detection reuses the existing client `analyzeICT` — no detection logic duplicated.

### ICT setup recorder
- **`lib/db.ts`** — new `ict_setups` table (UNIQUE `setup_key = <kind>:<dir>:<trigger_ts>:<round(price)>` so re-scans never double-log); cols kind/label/dir/trigger_ts/price/note/target/invalidation/outcome(pending|win|loss|chop)/mfe/mae/r_multiple/resolved_*. Fns: `insertIctSetup` (ON CONFLICT DO NOTHING), `updateIctSetupGrade`, `getIctSetups`, `getPendingIctSetups`, `getIctSetupSummary`.
- **`app/api/ict-setups/route.ts`** (new) — POST `action:"scan"` runs `analyzeICT` over `/api/snapshots/candles`, flattens every point-in-time setup (BOS/CHOCH/MSS, displacement, liquidity/EQH-EQL sweeps, FVG/IFVG, valid OBs, OTE entry, model signals), records new + grades pending by follow-through (win = reaches target before invalidation; loss = invalidation first; chop = neither within ~12 bars / session close). GET returns `{setups, summary}`; token-gated writes.
- **`server-v2/ict-setup-tracker.js`** (new) — 5-min RTH loop (holiday-aware, self-rescheduling) pokes the scan; wired into `server-with-proxy.js` after the es-gap tracker.

### Owner Results page
- **`app/dev/results/page.tsx`** (new) — owner-only (inherits `app/dev/layout.tsx` OwnerGuard). One card per setup kind: win-rate, W/L/chop split bar, wins/losses/chop/live counts, avg R, avg MFE; Today / Last 7d / All-time toggle + overall roll-up.
- **`lib/db.ts`** — `getIctSetupSummary` extended to `{date?|sinceDate?}` and now returns `pending`, `avg_r`, `avg_mfe`.
- **`app/api/ict-setups/route.ts`** — GET accepts `?since=N` (days) + `?all=1`.
- **`components/shared/NavMenu.tsx`** — "Results" link added to the owner group (after Owner).

### Glossary card manager (per-user show/hide)
- **`lib/db.ts`** — new `ict_card_prefs` table (`clerk_user_id` PK, `hidden_cards` JSONB); fns `getIctCardPrefs` / `upsertIctCardPrefs`.
- **`app/api/ict-prefs/route.ts`** (new) — Clerk `auth()`-gated GET/POST (mirrors traders-dashboard).
- **`app/ict/page.tsx`** — "⚙ Manage cards" panel toggles each of the ~30 ICT concept cards on/off (Show all / Hide all), debounced save (500ms) to `/api/ict-prefs`; glossary grid filters out hidden ids. Persists per-user across devices (no localStorage).

### Cleanup
- **`app/ict/page.tsx`** — `SetupRecap` table + helpers removed; setup results now live ONLY on `/dev/results` (per request, no results reference on the ICT page).

> Not built/typechecked this session — the Linux sandbox couldn't boot (HYPERVISOR_VIRT_DISABLED). Run the build on Windows before deploy. New tables auto-create via `ensureAllTables` on first DB touch.

## 2026-06-26 (session 77) — Public marketing funnel + landing July 4th launch theme

Built a no-flow marketing funnel so visitors can explore each feature and convert through a single pricing hub, and themed the launch messaging for the July 4th weekend launch.

### `components/explore/exploreContent.ts` (new)
- Shared config driving the 4 public feature pages (GEX, Confidence Score, Greeks & exposure, Estimated moves): title, tagline, body copy, highlight bullets, and a frozen static teaser stat block per feature. `EXPLORE_SLUGS` exported for params + cross-links.

### `app/explore/[slug]/page.tsx` (new)
- Public, statically-generated (`force-static` + `generateStaticParams`) marketing page per feature. Sell copy + highlights + clearly-labeled static teaser ("Preview · sample data") → **Join now** CTA to `/pricing?from=<slug>`. Cross-links the other 3 features. Unknown slug → `notFound()`. Matches the dark/cyan home theme.

### `app/pricing/page.tsx` (rewritten)
- Now the single conversion hub. Reads `?from=<slug>` ("Continuing from · X"). Platform recap + plan card. Branches on auth: signed-out → Clerk `SignUpButton` (+ sign-in fallback); signed-in without sub → Stripe checkout via existing `PricingActions`; subscribed → go-to-dashboard. Themed to match the rest of the app.

### `components/landing/LandingClient.tsx`
- 4 feature cards are now clickable `Link`s to `/explore/<slug>` with hover lift + "Explore →" affordance; added `slug` to the FEATURES config.
- Replaced the dead "Sign up — coming soon" disabled button with a live **Join now** link → `/pricing?from=landing`; removed now-unused `comingSoonBtn` style.
- "Launching soon" badge → "Launching **July** (red) **4th** (white) **Weekend** (blue)" with looping red/white/blue CSS fireworks.
- Enlarged the X (Twitter) follow icon: button 30→44px, glyph 18→26px, radius 10→12px.

### `components/landing/SplashScreen.tsx` (intro)
- Launch line restyled into a bordered "bubble": "LAUNCHING **JULY** (red) **4TH** (white) **WEEKEND** (blue)" with red/white/blue fireworks bursting inside the outline (reduced-motion fallback). Removed the now-unused `LAUNCH_DATE` const.

### `middleware.ts`
- Added `/explore(.*)` and `/pricing` to `isPublicRoute` so signed-out visitors can browse the funnel. Left out of the maintenance-exempt list (maintenance mode still gates them).

### Notes
- Teaser stats are placeholders by design (swap in real figures/screenshots later).
- Build not run this session (Linux sandbox failed to boot); verified by inspection. Run `npm run build` locally to confirm.

## 2026-06-26 — ES Candles SPX heatmap: persist Vol-only GEX history

Vol-only mode on the ES Candles SPX GEX heatmap showed no historical columns — only `net_gex` (OI+vol) was persisted, never the volume-only split. Added a `net_vol_gex` column end-to-end so Vol-only mode backfills on load.

### `lib/db.ts`
- `option_strike_gex_history`: added `net_vol_gex REAL` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migration.
- `insertOptionStrikeGexRows` + `OptionStrikeGexRecord`: write/carry `net_vol_gex` (NULL when absent).
- `getOptionStrikeGexSlots`: selects + returns `net_vol_gex`.

### `server-v2/state/gex-history-writer.js`
- Persists `row.netVolGEX` alongside `net_gex` (NULL when feed omits it).
- Added `ensureVolColumn()` — server-v2 connects to PG directly and never runs `lib/db.ts` `ensureAllTables`, so the writer self-adds the column on first write (fixes "write failed" errors from the unknown column).

### `app/api/snapshots/option-strike-gex-history/route.ts`
- Heatmap columns now return per-cell `netVol`; POST normalizer accepts `net_vol_gex`.

### `app/es-candles/page.tsx`
- Historical heatmap cells map real `netVol` instead of forcing `0`.

Note: legacy rows (pre-column) stay `0` in Vol-only. Restart server-v2 to run the `ALTER` + new INSERT. The 6pm→next-day expiry rollover needs no change — writer date + reader date stay aligned in the 6pm–midnight window.

## 2026-06-26 — NET GEX toolbar height fix

Fixed the NET GEX toolbar growing taller when **OI + Vol** is selected vs **Vol Only**.

### `components/dashboard/GexToolbar.tsx`
- Root cause: in OI+Vol mode the extra ghost-overlay toggles (`5m` / `15m` / `30m`, gated by `ghostEnabled = net + oi-vol`) widen the row past the container, triggering the horizontal scrollbar — the added scrollbar track is what made the bar taller, not a row wrap.
- Hid the scrollbar so the bar keeps the same single-row height as Vol Only: added `overflowY: "hidden"`, `scrollbarWidth: "none"`, `msOverflowStyle: "none"`, a `gex-toolbar-noscroll` class, and an inline `::-webkit-scrollbar{display:none}` rule. Content still scrolls horizontally.

## 2026-06-26 — Owner page: short-window card clipping fix

`/dev/owner` data-box cards (Backend tab: System KPIs, Hosting/Render metrics, DB row counts) clipped their label/value text when the window got short — fonts only reacted to card *width*, not height.

### `app/dev/owner/page.tsx`
- `StatCard` component: `containerType: "inline-size"` → `"size"` (+ `minHeight: 0`); all font/padding `clamp()` units switched from `cqw` → `cqmin` so text shrinks on whichever axis is smaller. Covers System + Hosting KPI cards.
- Inline DB table-count cards: same `size` / `cqmin` treatment.
- Frontend tab (Auth, Page Activity) needed no change — those use scrolling lists + pixel fonts, not shrink-to-fit data boxes.

## 2026-06-25 (session 76) — ICT page (live detection + glossary)

New `/ict` GEX page — an Inner Circle Trader command center that runs live ICT detection on the existing 5-min ES feed alongside a color-matched concept glossary. Added to the GEX nav group after ES Candles.

### `lib/calculations/ictConcepts.ts` (new)
- Pure, framework-agnostic ICT detectors over `IctCandle[]` (the ES session feed).
- Core primitives: Fair Value Gaps (3-candle imbalance, mitigation + **endTs** so a box ENDS on the 2nd pass-through, **IFVG inversion** when a break sweeps liquidity), Displacement, **Order Blocks** refined to the textbook rule (requires a **liquidity sweep + following imbalance** → `valid` flag), swing pivots, market structure (BOS/CHOCH/MSS), liquidity pools (BSL/SSL + EQH/EQL clustering + `liquiditySweepTimes`), premium/discount + OTE dealing range, kill zones / Silver Bullet / macros (ET windows; **NY AM corrected to 7:00–10:00**), daily bias.
- 10 model detectors added: Inducement, Turtle Soup, Judas Swing, Breaker, CISD, 2022 Model, Power of 3 (AMD), IRL/ERL, Candle Range Theory; MMXM via components. SMT intentionally left glossary-only (needs a 2nd NQ feed).
- `analyzeICT()` aggregates everything in one call.

### `app/ict/page.tsx` (new)
- lightweight-charts ES candles with a canvas overlay drawing every concept in **one color per concept** (FVG blue, IFVG pink, OB green, Liquidity orange, Structure purple); direction shown via ↑/↓ labels. Valid OBs solid, weak OBs faint/dashed.
- Toggle row doubles as a color legend; **Copyshot** button captures chart + panels to clipboard (html2canvas).
- Right-side compact 2-col signal panels: Daily Bias, Active Windows (with ET time ranges pinned at the bottom), Open FVGs, Liquidity, Dealing Range, Models & Signals, Power of 3, CRT. (Market Structure panel removed.)
- Glossary cards (4-wide) with per-concept **SVG thumbnail diagrams**, keyword highlighting colored to match the chart, and a dynamic **live/idle** badge that only reads "live" when a setup is actionable at the current time/price.

### `components/shared/NavMenu.tsx`
- Added "ICT" link to the GEX group after ES Candles.

### Notes
- Detectors are practical heuristics, not textbook-perfect; backtest before trusting. Sandbox was unavailable this session, so `tsc` was not run — typecheck locally before `/push`.

## 2026-06-25 (session 75) — Traders Dashboard page

New `/traders-dashboard` page — a morning command-center modeled on a provided mockup (countdown to open, schedule, overnight overview, pre-market tasks, weather). Wires live data, per-user persistence, and a 7am AI overview cron.

### `app/traders-dashboard/page.tsx` (new)
- Header with live countdown to 9:30 AM ET and a weather card (ZIP input → temp/conditions).
- Editable Morning Schedule and Pre-Market Tasks (add/rename/delete, checkboxes + progress bar). Persisted per Clerk user via `/api/traders-dashboard`.
- Overnight Market Overview reads the cached AI row from `/api/traders-dashboard/overview` (sentiment line + "Generated … ET" stamp).
- Overnight Futures: live ES/NQ/YM via existing `/api/yahoo-quotes` (60s poll). Pre-Market Movers is a "live Monday" placeholder.
- Key Drivers: AI job's drivers if present, else top high-impact USD events from `/api/calendar`.
- Styled with `HOME_THEME`.

### `components/shared/NavMenu.tsx`
- Added "Traders Dashboard" link to the GEX group under Home.

### `lib/db.ts`
- New tables `td_user_prefs` (per-user zip/schedule/tasks JSONB) and `td_overview` (per-ET-date summary + drivers JSONB). Helpers: `getTdPrefs`/`upsertTdPrefs`, `getTdOverview`/`getLatestTdOverview`/`upsertTdOverview`.

### `app/api/traders-dashboard/route.ts` (new)
- GET/POST per-user prefs, Clerk-gated on `userId`.

### `app/api/traders-dashboard/overview/route.ts` (new)
- GET latest/by-date overview; POST writer gated by `INTERNAL_API_TOKEN` (middleware already passes the token through), mirroring `/api/es-gap`.

### `app/api/weather/route.ts` (new)
- Keyless: ZIP → lat/lon via Zippopotam, then current temp/condition via Open-Meteo (WMO code map). No secrets. (Host must allow `api.zippopotam.us` + `*.open-meteo.com`.)

### `server-v2/overview-generator.js` (new)
- Daily ~07:00 ET (weekdays) job: calls Anthropic (`claude-sonnet-4-6`) with the `web_search_20250305` tool to research overnight action, parses a JSON `{summary, drivers}`, and POSTs to `/api/traders-dashboard/overview`. Skips if already written for the ET date; startup catch-up probe.

### `server-v2/server-with-proxy.js`
- Starts `startOverviewGenerator(PORT)` after `server.listen()`, alongside the other cron jobs.

### Deploy notes
- Reuses the existing `ANTHROPIC_API_KEY` (already on the VPS, shared with social-media) — confirmed present.
- Commit/push from Windows; VPS pulls + builds. Not yet built/verified (sandbox unavailable this session).

## 2026-06-25 (session 74) — Fails page: LAF/LBF logic rewrite, scaled targets, perf + UI

Reworked the `/fails` page fail definition, scoring, performance, and typography.

### `lib/failLevels.ts` — fail detection rewrite
- **PWH/PWL first-2-attempts cap** (`attemptCap`): prev-week levels only fade on the first 2 pierces per session; applied in `scanLevel` and `countPierces`.
- **ONH/ONL RTH-only**: overnight levels now scan/activate only during RTH (9:30–16:00 ET) in `scanLevel`, `countPierces`, and live status (distance still shown overnight, state gated).
- **Upgraded LAF/LBF "fail" criteria**: a fail now requires (1) a probe of 0.5–12 ES pts past the level (sweep, not noise/runaway), (2) no acceptance (never 2 consecutive closes beyond), (3) a reclaim bar that closes back inside with a ≥50% rejection wick on the probe side AND forms a lower-high/higher-low vs the probe extreme.
- **Reward = max favorable excursion from entry** over the rest of session until stop-out (probe extreme), replacing the old 2-bar follow-through measured from the level (which starved every winner → all-losses bug).
- **Scaled targets** added to `FailEvent`: T1 = 50% to opposite ref, T2 = full opposite ref (PDH↔PDL / ONH↔ONL / PWH↔PWL), T3 = 2× entry→opposite (measured move). `tiersHit` = furthest tier the MFE reached; `maxR` = MFE/risk. Removed `targetPts`/`rrToTarget`.

### `app/fails/page.tsx`
- **Perf**: deferred the 20-day `computeStats` build into a `requestIdleCallback` keyed on a history-only signal (`historyKey`), and added coarse `candlesKey`/`historyKey` memo keys so heavy scans don't re-run on every WS tick (fixed slow load/scroll).
- **Today's Fails summary box**: Wins (reached ≥T1) / Losses / Win Rate / Net R (summed maxR) + per-level fail counts.
- **Fail table**: columns now Entry / Risk / Targets (T1/T2/T3 badges) / Max R / Result (`WIN T{n}` or LOSS).
- **Fail Rate**: 6 cards across in one row; enlarged ~20-session total.
- **Typography**: section titles via `SectionTitle big` (18px), bumped then toned down IB/live-status/table fonts; brighter outlined+shaded cards.
- **Spacing**: `marginBottom: 16` between Day Type · AMT banner and Live IB panel.

### `components/insights/IbLogic.tsx`
- Enlarged then toned-down IB header, stat cards, rule cards, and "Rules In Play" title to match the page.

---

## 2026-06-25 (session 73) — Global toolbar responsive shrink + centered quotes

Made the global toolbar (`GlobalToolbar`) shrink as a unit on narrow widths and fixed the live-quote alignment.

### `components/shared/GlobalToolbar.tsx`
- Live ticker (VIX/ESU/SPX/NQU) kept in-flow (`flexGrow:1`) and centered; briefly tried absolute-centering but it overlapped the search box, reverted.
- Bar `gap` and horizontal `padding` now use `clamp()` so spacing compresses with viewport.
- Search box: `flexShrink:1000` + `flexBasis:230` + `minWidth:44` so it collapses to an icon-only box **before** the ticker scales — search yields space first.
- Date chip (`.toolbar-datechip`) and Notes label (`.toolbar-notes-label`) classed for responsive hiding.

### `components/shared/ToolbarTicker.tsx`
- Lowered fit-scale floor `0.85 → 0.55` so quotes shrink further instead of clipping/overlapping.

### `app/globals.css`
- `@media (max-width:1100px)` hides `.toolbar-datechip`; `@media (max-width:950px)` hides `.toolbar-notes-label`.

## 2026-06-25 (session 72) — Owner-only route gating (test account saw owner pages)

Test/customer accounts were signed in and could reach the owner pages (`/dev/*`, `/budget`, `/personal`) — middleware only checked signed-in vs signed-out, and the nav only checked `isSignedIn`. Added two independent layers gated on the owner's Clerk ID.

### `middleware.ts`
- Added `isOwnerRoute` matcher (`/dev`, `/budget`, `/personal`); signed-in non-owners are redirected to `/home`. Real server-side gate. Fails open (any signed-in user) only if `OWNER_USER_ID` is unset, to avoid owner lockout.

### `components/shared/ownerGuard.tsx` (new)
- Server component: re-checks `auth()` vs `OWNER_USER_ID` at request time, `notFound()` (404) for non-owners. Defense-in-depth — pages refuse to render even if middleware were bypassed. Trims the env value.

### `app/dev/layout.tsx`, `app/budget/layout.tsx`, `app/personal/layout.tsx` (new)
- Wrap each owner subtree in `<OwnerGuard>`; `export const dynamic = "force-dynamic"` (auth needs request context).

### `components/shared/NavMenu.tsx`
- `devOnly` groups (Owner/Backend) now filter on `isOwner` (via `NEXT_PUBLIC_OWNER_USER_ID`) instead of `isSignedIn`.

### `components/shared/TopBar.tsx`
- Personal nav item marked `ownerOnly`; filtered out of the page picker for non-owners (added `useUser`).

### `.env.local`
- Removed stray leading space in `OWNER_USER_ID=` value (line 47). Both vars use `user_3FM2m53hCocxxIJMO2lQQsVJOsE`. NOTE: fix the same space on the VPS `/opt/dashboard/.env.local` (gitignored, not pushed).

Deploy: `OWNER_USER_ID` is runtime (recreate is enough for middleware + guard); `NEXT_PUBLIC_OWNER_USER_ID` is build-time (nav needs a rebuild).

## 2026-06-25 (session 71) — MVC peak-GEX golden/white glowing box across heatmaps

Highlighted the single strike with the highest **absolute net GEX** (MVC) with a box on the NET GEX cell across all gradient/heatmap views. Final style: **3px solid white** outline (`outlineOffset -3px`) with a **slow 2.4s pulsing glow** (`mvcGlow` keyframes, `.mvc-peak-cell`). Scoped to the GEX column only; coexists with the existing gold ★ star.

### `components/dashboard/GexHeatmap.tsx`
- Added `peakNetGexStrike` (max `|netGEX|` across visible rows); NET GEX cell gets the box. (Initial gold `#ffd700` version — component is currently unused/unimported.)

### `app/home/page.tsx`
- NET GEX `<td>` for `mvcStrikeHeatmap` gets the white glowing box (heatmap view only). Added `mvcGlow` keyframes + `.mvc-peak-cell` in the page `<style>`.

### `app/mult-greek/page.tsx`
- `isGexPeak` (gex col + `mvcStrike`) gets the white glowing box. Injected `mvcGlow`/`.mvc-peak-cell` `<style>` in the heatmap component return.

### `app/options-chain/page.tsx`
- `isMvc` cell (gex mode + per-column `mvcByCol`) gets the white glowing box. Added `mvcGlow`/`.mvc-peak-cell` `<style>` at the page root.

- **Caveat:** untypechecked (Linux sandbox unavailable, `HYPERVISOR_VIRT_DISABLED`); run lint/build before `/push`.

## 2026-06-25 (session 70) — Owner page styling reset + admin Owner link

### `app/dev/owner/page.tsx`
- **Reverted a long styling exploration** (cyberpunk → glass → calm-fintech variants) back to the **shared `homeTheme`**, so the owner page now renders identically to every other page (same glassmorphic panels/blur/shell glow). Removed all scoped `data-owner-*` `<style>` overrides; restored `StatCard`, `StatChip`, `AccordionCard` header, tab buttons, and title to their original styles.
- **Removed Quick Links** section.
- **Moved System / Hosting / Database** sections to the **Back-End** tab (`SECTION_TAB`).
- **Collapsable section headers** no longer get the cyan tint background (transparent open/closed).
- **Deep-link support:** honors `?tab=overview|frontend|backend` on load (URL param wins over persisted `owner-tab`).

### `app/dev/admin/page.tsx`
- Added an **OWNER ↗** link in the header top-right (mirrors the owner page's ADMIN ↗ link), navigating to `/dev/owner?tab=overview`.

- **Caveat:** untypechecked (Linux sandbox unavailable, `HYPERVISOR_VIRT_DISABLED`); run lint/build before `/push`.

## 2026-06-25 (session 69) — GEX chart MVC label tracks data mode

### `components/dashboard/GexChart.tsx`
- **MVC peak now mode-aware.** Previously the peak-strike label always reduced over OI-based `netGEX`. Added `peakVal(r)` selector: in **Vol Only** mode it reduces over `netVolGEX` (volume-based) so the MVC reflects the volume peak; **OI+Vol** mode unchanged (`netGEX`). `pv` (label color/position) now uses the same selector.
- Label text switches with mode: `MVC·Vol <strike>` in Vol Only, `MVC <strike>` in OI+Vol.
- **Caveat:** untypechecked (Linux sandbox unavailable, `HYPERVISOR_VIRT_DISABLED`); run lint/build before `/push`.

## 2026-06-25 (session 68) — Fails page: NQU tab + quote-sampled NQ Initial Balance

### `app/fails/page.tsx`
- Added an **ESU / NQU tab switcher** to the header (segmented control). ESU tab is unchanged (all existing fail/AMT/IB/log sections); the LIVE/OFFLINE dot + price readout now show only on the ESU tab. NQU tab renders the new `NqIbLive` component only (Initial Balance, per request).

### `components/insights/NqIbLive.tsx` (new)
- **Quote-sampled NQ Initial Balance tracker.** The backend feeds true 5m OHLCV only for ES, so NQ is approximated: polls `/api/tt-quotes` for `/NQU26` every 20s and buckets samples into client-side 5m OHLC bars, then computes the 9:30–10:30 ET IB high/low/mid/range, formed-first, live break state, and NQ-specific probability rules. Flagged "≈ Quote-sampled" — bars are approximate (snapshots, no volume) and the in-memory set resets on reload (no DB lock).
- **Today-only manual IB seed:** live sampling missed today's 9:30–10:30 window, so `SEED_DATE = 2026-06-25` / `SEED_IB = { high: 30193, low: 29295.75, lowFirst: false }` (high formed first) is hardcoded. On the seed date `computeIb` uses the manual high/low and still tracks live `last` + break state against them; `done` is forced true. From the next session on, `seed` is null and the IB builds live from quote samples automatically. The seed block is inert after the date and can be deleted.
- **Caveat:** untypechecked this session — the Linux sandbox failed to start (`HYPERVISOR_VIRT_DISABLED`); run lint/build before `/push`.

## 2026-06-25 (session 67) — ES Candles: heatmap-to-right-edge, jitter fix, live SPX basis

### `app/es-candles/page.tsx`
- **Heatmap fills to the right axis:** the latest 5-min GEX column is now stretched to the plot's right edge (canvas width − price-axis gutter) so the band reaches the last print instead of stopping a bar short. The gutter width is cached in `hmScaleWRef` and only updated on ≥1px change, so the band edge doesn't shimmer with sub-pixel price-label wobble.
- **Jitter fix:** overlay repaint triggers (both time-scale range subscriptions + the overlay `ResizeObserver`) are now coalesced through a single rAF (`schedule`), stopping the synchronous ping-pong that made the chart jitter back and forth on live ticks.
- **Chart-resize guard:** the main chart `ResizeObserver` only re-applies width/height when the *rounded* container size actually changes (was re-applying on sub-pixel layout churn and nudging the time scale).
- **SPX badge basis fix:** `effectiveBasis()` now prefers the LIVE basis (`esFut − spot` from the current /ws/gex frame) and only falls back to the frozen prior-day basis when no live frame exists. The frozen prior-day basis had gone stale intraday (badge read SPX ~90pt under ES when the true basis had drifted to ~70 — e.g. ES 7393.50 showed "SPX 7300.97" when real SPX was 7323). Caveat: if broker `spot` ever mis-scales (negative/implausible basis), the badge could be wrong again — no clamp added yet.

## 2026-06-25 (session 66) — Fails page: RTH-only prev-day/week levels by true ET date

### `lib/failLevels.ts`
- Added `etSessionDate(c)` — derives a bar's ET session date from its timestamp instead of trusting the upstream `c.date`/slotKey tag, which can mis-date globex bars across the UTC-midnight boundary and leak overnight prints into the prev-day RTH set (pulling Prev Day Low below the true RTH low, e.g. ES 7404.25).
- Added `rthBarsForDate(candles, date)` helper (isRthBar + etSessionDate match).
- Prev Day H/L, Prev Week H/L, and `computeStats` per-day bars now use RTH-only bars grouped by true ET date. Overnight (ON-H/ON-L) levels left as-is (globex by design).

## 2026-06-25 (session 65) — Removed /home2 page

### Deleted (`app/home2/`)
- Removed the entire `/home2` fintech-card dashboard page (`app/home2/page.tsx`) and its folder. The page mirrored `/home`'s live GEX feeds in a draggable card layout; no longer wanted.

### Nav (`components/shared/NavMenu.tsx`)
- Removed the "Home2" entry from the menu items array and the sidebar `<Link>` block (plus its divider comment).

### Dev flow diagram (`app/dev/tree/FlowDiagram.tsx`)
- Removed the `HOME2` node, its `HOME2 --> WS` edge, the `g2["Home2"]` GEX-tree node, and dropped `HOME2` from the `pg` class list.

### Notes
- `lib/layoutStore.ts` (IndexedDB store `CBEdge_Home2`) is now orphaned but left in place; a comment in `app/es-candles/page.tsx` still references the old HOME2 embed card. Both harmless — clean up later if desired.

## 2026-06-24 (session 64) — Public legal pages + sidebar Disclaimer menu

### Legal pages (`app/terms`, `app/risk-disclosure`, `app/privacy`, `app/disclaimer`)
- Added four public legal pages tailored to a paid SPX GEX / options-flow tool: **Terms of Service**, **Risk Disclosure & Trading Disclaimer**, **Privacy Policy**, and a standalone **Disclaimer** (no-liability catch-all). Content covers "not financial advice," no-warranty, limitation of liability, 0DTE/options risk, Confidence Score / estimated-move hypothetical-results disclaimers, and a Privacy Policy matching the real stack (Clerk auth, waitlist, usage data, localStorage prefs).
- New shared `components/legal/LegalShell.tsx`: full-bleed scrollable wrapper (CB Edge logo, back-to-site link, last-updated stamp, cross-links to the other 3 pages, © footer) so the pages don't duplicate chrome. Styled on HOME_THEME (dark + cyan glass).

### Routing (`middleware.ts`, `components/shared/LayoutShell.tsx`)
- Added the 4 routes to `isPublicRoute` (reachable pre-auth) and to the maintenance-mode exemption list (readable during downtime).
- Added them to `BARE_ROUTES` so they render full-bleed without the dashboard sidebar/chrome — same treatment as `/`, `/sign-in`, `/sign-up`.

### Landing footer (`components/landing/LandingClient.tsx`)
- Added a bottom-pinned legal footer (Terms · Risk Disclosure · Privacy · Disclaimer) visible pre-auth; bumped the card scroll container's bottom padding so the footer never overlaps on short viewports.

### Sidebar Disclaimer menu (`components/shared/Sidebar.tsx`)
- Added a **Disclaimer** button directly under the Clerk `UserButton`. Click/hover opens an upward popover (sideways when collapsed) listing all 4 legal pages **plus Help & Docs** (`/docs`, from the GEX group). New `ShieldIcon`, `legalOpen` state, `LEGAL_LINKS` constant; matches the existing Tooltip/hover/glass patterns. Works in expanded + collapsed modes; closes on navigation.
- NOTE: coexists with session 61's Notes-dock removal in the same file — verified on disk that both merged cleanly (no dangling `NoteIcon`/`NotesPanel`/`PencilIcon`/`user` refs; `CloseIcon` retained for Quick Pages).

### Placeholders to fill before relying on these
- Terms §14 governing-law/venue: `[STATE]` and `[COUNTY/STATE]`.
- Contact email `support@cbedge.net` used throughout — change if not correct.
- Not legal advice — have an attorney review before launch.

## 2026-06-24 (session 63) — Social Media admin page: GEX read → shareable "SPX · Daily Levels" card

### New route + page (`app/social-media/page.tsx`)
- Built the Social Media admin page (App Router, sidebar Admin group entry already wired). v2 conventions: `'use client'`, `id="page-social-media"`, Arial, inline `<style>`. Token names from the design ref (`--bg0/--cyan/--text2…`) aliased onto the real global tokens (`--bg/--accent/--text…`) so nothing hardcodes a new color — the QuotesPanel vars the task referenced don't actually exist in globals.css and that route is a dead redirect.
- **Left "Daily Input" panel** hydrates live from `/api/social-media/daily-input`: SPX spot, prior close, gamma flip, call/put walls, expected move, net GEX, ES overnight H/L. All fields editable (dirty-flag freezes auto-fill once edited; manual Refresh re-pulls). ES overnight is sourced via the Fails-page candle logic (`useEsCandles` + `computeRefLevels`).
- **Gamma regime strip**: label is driven by the **sign of net GEX** (so it can never contradict the net-GEX value shown). Spot-vs-flip is context only, not a tiebreak — fixed the original OR bug where positive net GEX + spot-under-flip wrongly read "NEGATIVE GAMMA".
- **Expected-move levels centered on the prior-day SPX close** (not live spot): UP = close + EM, DOWN = close − EM. `EmRangeReadout` shows `lower · Close X ±EM · upper`.

### Output evolved to a shareable image card
- Right column is now a single **SPX · Daily Levels** card (replaced the earlier AI X-post/thread/Discord cards). Auto-fills from the left; no model call. Sections: Estimated Move (CLOSE/EM/UP/DOWN), regime strip + bias, Upside/Downside levels, Overnight Action, CB Edge footer + disclaimer.
- **Two actions**: "Copy card" renders the card to PNG via `html2canvas` (already a repo dep) and writes the **image** to the clipboard (`ClipboardItem`); "Copy & Open X" copies then opens the X composer to paste. Both fall back to a **PNG download** when the browser blocks clipboard image writes. Buttons flash status.

### API routes
- `app/api/social-media/daily-input/route.ts` — composes existing live sources only (no proxy-file edits): `/proxy/gex` (spot/walls/flip/net GEX/prevClose), EM from the SPX ATM straddle via `fetchChainFull` (same `0.84·IV·spot·√(dte/365)` math as EstimatedMoves), ES overnight H/L from `/api/snapshots/candles`. Exposes `spxPrevClose` + `emUpper`/`emLower` (close-anchored).
- `app/api/social-media/generate/route.ts` — Anthropic `claude-sonnet-4-6`, CB Edge voice, strict JSON `{xPost, xThread[], discordDrop}`, brace-walking fence-stripper. **Left in place but unused** now that the page renders a card client-side (keep for future AI-post mode). Requires `ANTHROPIC_API_KEY` only if re-enabled.

### Deploy notes (recurring — candidates for memory)
- Linux sandbox down all session (`HYPERVISOR_VIRT_DISABLED`); verified by hand, not `tsc`/build.
- Local build kept tripping `Cannot find module for page: /_document` (and `/disclaimer`, `/api/*`) — **stale `.next` cache**, fixed by `Remove-Item -Recurse -Force .next` + one build. Caused by running `npm run build` then `push.ps1` (a 2nd build) against the same dirty cache. Consider adding the `.next` clear to `push.ps1`.
- VPS multi-line deploy must be pasted as a **single line** or the `\` continuations break (`NEXT_PUBLIC: command not found`). This deploy did NOT need `ANTHROPIC_API_KEY` forwarded (card is client-side). Shipped: image built, container started, live.
- ⚠️ Verify on the card that **Call Wall < Gamma Flip** is real data, not swapped fields — it publishes as-is.

## 2026-06-24 (session 62) — /fails: prev-day/week levels not tracking (string-timestamp bug) + fail log reframed as fade trades

### Symptom
- `/fails` Live Status showed only Overnight High/Low (ON-H/ON-L). Prev-Day (PDH/PDL) and Prev-Week (PWH/PWL) cards were absent, even though ES had taken out both prior-day extremes intraday.

### Diagnosis (everything checked out except one thing)
- DB had yesterday's 78 RTH bars (PDH 7491.00 / PDL 7415.25). Browser received them, the `historical` hook held all 1442 bars incl. 06-23, the deployed bundle had the full PD/PW logic, and `computeRefLevels` run standalone on that data returned all 6 levels. Yet the live component returned only 2.
- **Root cause:** historical ES candles deserialize from Postgres with `timestamp` as a **STRING** (BIGINT → JSON). `isRthBar` did `new Date('1782187200000')` → **Invalid Date** → `etParts` NaN-guard → every prior-day bar's RTH check returned false → `pdBars.length === 0` → PDH/PDL/PWH/PWL silently dropped. Today's ON bars came from the live WS feed with **numeric** timestamps, so only those survived — which is why ON rendered and the rest didn't.
- Why manual console tests passed: they coerced `+x.timestamp`; the component used the raw string. Caught by adding a temp `[computeRefLevels PD]` log that showed `pdBarCount: 0, ts: '1782187200000'` (quoted string).

### Fix (two layers)
- `lib/snapdb.ts` — added `normalizeCandle()` coercing `timestamp`/`open`/`high`/`low`/`close`/`volume` to `Number()` for both `queryEsCandlesToday` and `queryEsCandlesHistorical`.
- `lib/failLevels.ts` — `etParts` now does `new Date(Number(ts))` as a backstop so no string timestamp can break RTH detection again.

### Fail log reframed as fade trades (`app/fails/page.tsx` FailTable)
- Per Brandon: "look above & fail" is the pattern, but he wants to see WINS / good R/R. Relabeled the table to a trade lens: **Trade** (Fade Short for above-fails / Fade Long for below-fails), **Entry**, **Risk** (poke past level = stop distance), **Reward** (follow-through), **R/R**, and a **Result** badge — **WIN when R/R ≥ 2**, else LOSS. Winning rows get a faint green wash. R/R shown is theoretical max (follow-through ÷ poke), not a guaranteed fill.

### Also noted
- `failLevels.ts` symbol filter on the page (`includes("ESU")`) is a no-op: stored symbol is `/ES`/`/ES:XCME`, so `esu` is always empty and it falls back to all candles. Harmless, left as-is.
- Multiple `--no-cache` rebuilds with the same chunk hash (`7e092a33`) were a red herring — the chunk was unchanged because the source genuinely hadn't changed; the bug was runtime data typing, not a stale build.

## 2026-06-24 (session 61) — Move Notes from sidebar to a right-side push dock (🖍️ NOTES)

### What changed
- Moved the per-user quick-jot Notes out of the **left sidebar** and into a new **🖍️ NOTES button in `GlobalToolbar`** that opens a **right-side companion panel**.
- Final behavior (after two iterations): the panel is a **flex sibling of `<main>`** (Sidebar | main | NotesDock) that **pushes** page content like the left sidebar — no floating overlay, nothing blurred over content. Open = 320px, closed = `width: 0` (fully gone), opened only by the NOTES button (or its own ✕). Open/closed is persisted (`notes-dock-open-v1`) so it **stays out** across navigation/reloads.

### Why the rewrite
- First pass used a `position: fixed` slide-out *inside* the toolbar. The toolbar has `backdrop-filter: blur(16px)`, and a filter/backdrop-filter ancestor becomes the **containing block for `position: fixed` descendants** — so the panel was sized/placed against the 44px toolbar, not the viewport, producing the "slides too far and comes back" glitch. Brandon also wanted a push panel (no blur), so the fixed/portal approach was dropped entirely.

### Files
- **New `components/shared/notes.tsx`** — shared `Note` type, `useNotes` hook, `formatNoteTime`, `NoteIcon`, and reusable `NotesBody` (add box + list). Single source of truth so the dock and any future caller agree. Storage key unchanged (`sidebar-notes-v1:<userId>`) → existing notes carry over. Removed `autoFocus` from the input (would steal focus on every page load now that the body is always mounted).
- **New `components/shared/NotesPanelContext.tsx`** — `open/openPanel/closePanel/togglePanel`, persisted to localStorage. Mirrors `MobileNavContext`.
- **New `components/shared/NotesDock.tsx`** — the right-side push panel; animates `width` 0↔320 (`flexShrink:0`, `overflow:hidden`, fixed-width inner so content doesn't reflow while animating). Signed-in only.
- **`components/shared/GlobalToolbar.tsx`** — right-slot 🖍️ NOTES button with live count; toggles the context. Portal/backdrop overlay removed.
- **`components/shared/LayoutShell.tsx`** — wrapped `ShellInner` in `NotesPanelProvider`; rendered `<NotesDock />` as a sibling after `<main>`.
- **`components/shared/Sidebar.tsx`** — stripped the old `NotesPanel`, local `useNotes`/`Note`/`formatNoteTime`/`NoteIcon`/`PencilIcon`, the `NOTES_STORAGE_PREFIX`, the `useNotes` call, and the sidebar mount block. Dropped now-unused `user` from `useUser()`.

### Notes / caveats
- ⚠️ Linux sandbox was down all session again (`HYPERVISOR_VIRT_DISABLED`); changes verified by hand, **not** by `tsc`/build. Run `npm run build` before pushing (push.ps1 now gates on it).
- Open question (not done): whether the dock should *overlay* instead of *push* on narrow/mobile widths. Currently it pushes everywhere (capped at `92vw`).

## 2026-06-23 (session 60) — Fix deploy pipeline: showHpay build break + push.ps1 staging bug

### Root cause
- VPS build failed repeatedly on `ReferenceError: showHpay is not defined` at `/budget` prerender. Local `app/budget/page.tsx` was already fixed (`showHpay` → `showRecurring`), but the **committed** file still had `showHpay` on line 272 — the edit was never committed.
- Why: `push.ps1` staged only `git add package.json`, so every code edit (incl. the budget page) was silently dropped from commits while the version number still bumped. Surfaced after leaving Render because Render auto-pulled+built on push; the VPS requires a manual pull+build, so the missing files finally broke the build.

### Fix (`push.ps1`)
- Changed `git add package.json` → `git add -A` (stage all changes, not just the version file).
- Added an `npm run build` gate before commit/push: aborts with a red message if the build fails, so prerender errors are caught locally (~50s) instead of on the VPS after a Docker rebuild.

### Resolution
- Committed all pending edits (`07356d8`); VPS `grep` confirmed `CLEAN`; build ran through and `dashboard-dashboard-1` started. Site live.

### Workflow confirmed (saved to memory: deploy-windows-vs-vps)
- Commit + push ONLY on Windows; VPS only pulls + builds (`git fetch && git reset --hard origin/main && docker compose up -d --build`). VPS has no git creds. A commit includes only STAGED files — `git add -A` stages everything in the folder (minus .gitignore) across all sessions.

## 2026-06-23 (session 59) — Budget page rebuilt as owner-only check register + dark dropdowns

### Budget check register (`app/budget/page.tsx`, `app/api/budget/route.ts`, `lib/db.ts`)
- Rebuilt `/budget` from the old category/transaction UI into a **day-grouped check register** matching Brandon's spreadsheet. New tables in `lib/db.ts` (`budget_register`, `budget_recurring`, `budget_amazon`; auto-create in `ensureAllTables`).
- Model: each row belongs to one bank (coastal/truist/secu) but the table shows a **single combined running BALANCE** seeded from per-bank BEGINNING balances. Columns: **DATE | LABEL | AMOUNT | BALANCE**. Day-group headers carry item count + **Daily Net** and **EOD Balance** together on the right; collapsible (▾). BEGINNING shows as a cyan **STARTING BALANCE** strip at the top (not inside a day group).
- Per-bank current balances + SAVE editor sit top-right of the title banner (title = MONTH then **BUDGET**, 🏦 white). Income = green text, payments = red, no heavy fills/underline. Inline-editable label & amount; clear red row-delete buttons.
- **Recurring** rules (weekly/biweekly/monthly) in `budget_recurring`; occurrences computed **live** per displayed month and merged into the register (not stored). Managed via 🔁 Recurring panel; AUTO badge (cyan) on those rows. Old hardcoded H PAY generator removed.
- **Amazon** tab: Date / Pay / Gas / Net (= Pay − Gas) with month totals.

### Budget access — owner-only (`app/api/budget/route.ts`, `lib/db.ts`)
- Added `ownerGate()` via Clerk `auth()`: **401** if not signed in, **403** if `OWNER_USER_ID` is set and mismatched; falls back to any-signed-in when `OWNER_USER_ID` unset (anti-lockout). Works because the middleware matcher already includes `/(api)(.*)`.
- Single stable profile key `"owner"`; `adoptDefaultBudgetProfile("owner")` renames the legacy shared `"Default"` profile on first load so existing data carries over. Client can no longer spoof which profile it writes to.

### Global dark dropdowns (`app/globals.css`)
- Added `select`/`option` styling (`color-scheme: dark` + custom cyan chevron, styled option list) to kill the gray native `<select>` popup **dashboard-wide**.

### Deferred (saved to memory)
- Full 4-role RBAC (Owner/Admin/Subscriber/Free via Clerk `publicMetadata.role`) + moving admin pages under `/admin/*` — **not built this session** (degraded tooling on a live dashboard). Only budget is gated so far.
- ⚠️ Linux sandbox was down all session (`HYPERVISOR_VIRT_DISABLED`); changes verified by hand, **not** by `tsc`/build. Run `npm run build` before pushing.

---

## 2026-06-23 (session 58) — Sidebar Notes panel (per-user) + home stat-bar full-width stretch

### Sidebar Notes panel (`components/shared/Sidebar.tsx`)
- New per-user quick-jot **Notes** panel filling the empty space between the nav and the Collapse footer (expanded + signed-in only). `useNotes(user?.id)` hook persists to `localStorage` keyed `sidebar-notes-v1:${clerkUserId}` — survives resets, isolated per login, cleared on sign-out.
- Add / edit / delete with timestamps (`formatNoteTime`: time-only if today, else "Mon D h:mm"). Header + add input share **one row** to save vertical space (single-line `<input>`, Enter saves). Each note card: **text + timestamp on the same first row** (timestamp right-aligned); edit/delete buttons collapse to 0 height at rest and slide open on hover, so a note is one line tall when idle.
- Styling matches the app glass-card system: translucent `rgba(13,17,25,0.45)` + `blur(16px)`, ~14px radius, near-invisible hairline border, faint cyan tint + glow on hover; inputs same treatment; soft white-fade gradient divider above the panel.

### Home stat bar full-width stretch (`app/home/page.tsx`)
- Top ticker row (VIX/ESU/SPX/NQU) and the metrics row (NET GEX/CALL WALL/PUT WALL/FLIP/MVC) now `width:100%` + `justify-content: space-between` so they spread edge-to-edge and grow with the window (no cap) instead of sitting compressed on the left. Flattened the metrics row (removed the left-cluster wrapper + MVC `marginLeft:auto`) so all five items are evenly justified siblings.
- `tickerBoxRef` switched from `inline-block` natural width to `width:100%`; the `tickerScale` auto-fit now only acts as a **clip guard** (shrinks via `scrollWidth/clientWidth` overflow ratio when items can't fit a narrow column), never wastes space on wide ones.

---

## 2026-06-23 (session 57) — Sidebar Quick Pages (drag-to-pin) + collapsed nested-anchor hydration fix

Sidebar UX additions. All edits in `components/shared/Sidebar.tsx`.

### Quick Pages pinned zone
- New user-pinned shortcut zone rendered **directly above Home**. Up to 4 slots (`QUICK_MAX`).
- Pin by expanding any group's dropdown and dragging an item up into the zone. Dropping onto an occupied slot **replaces** it; dropping on empty space appends. Pinned pages also remain in their original group.
- Hover a pinned item to reveal an **×** unpin button; pinned items can be dragged to reorder within the zone.
- Zone is hidden when empty unless a drag from a group is in progress (keeps the rail clean). Works collapsed (2-letter chips) and expanded (labeled rows).
- Persisted to `localStorage` key `sidebar-quick-pages-v1`; stale hrefs (no longer in nav) are filtered on load. New `useQuickPages()` hook (pin/unpin/reorderQuick) + flat `NAV_ITEM_BY_HREF` lookup. Drag state extended with `dragSource` ("group" | "quick") so group drags pin and in-zone drags reorder.

### Hydration fix (`<a>` cannot be a descendant of `<a>`)
- Collapsed multi-item groups previously wrapped the hover-flyout (which contains item `<Link>`s) in an outer `<Link>` → invalid nested anchors + hydration error. Replaced the outer wrapper with a `role="link"` `<div>` that navigates via `useRouter().push` (Enter/Space supported). Single-item groups keep their `<Link>`.
- Quick Pages expanded rows also avoid nesting: the unpin `<button>` is a sibling of the row `<Link>`, absolutely positioned, not a child.

### ⚠️ Note (unresolved this session)
- Localhost **WS data-loading issue** (`ws://localhost:3002/ws/gex` connection fails, chain stuck on "LOADING SPX CHAIN") was investigated but **not resolved**. Ruled out: server down (logs show feed + GEX broadcast healthy), data flow, `GEX_WS_PATH` override (unset), middleware (`ws` excluded from matcher), Next stealing the upgrade (no upgrade handler attached — `getRequestHandler` only). Code path (`websocket-server.js` upgrade handler, path match) looks correct → points to runtime/env. **Next step:** read the Network-tab `ws/gex` row status (101 vs failed/pending/absent) to localize. Unrelated to the Sidebar edits.

---

## 2026-06-23 (session 56) — ES Candles: dual-axis fix (ES/SPX), prior-day frozen basis, bubble rework + disappear fix, heatmap Vol/Vol+OI toggle, MVC decoupled

Reworked `/es-candles` axis, footprint bubbles, and heatmap metric. All edits in `app/es-candles/page.tsx` + `hooks/useEsBigTrades.ts`.

### Price axis (ES vs SPX)
- Replaced the invisible left-scale companion-candle approach (was unreliable) — left axis hidden, **right axis = ES only**.
- SPX shown as a cyan badge pinned at the live ES price + a white label that follows the crosshair (right gutter), via `chart.subscribeCrosshairMove` + last-close → `priceToCoordinate`.
- **Frozen prior-day basis:** new effect reads prior-day ES 16:00 close from `historical` (the `time='16:00'`/`slotKey …T16:00` RTH bar — NOT the last overnight 23:55 bar) and prior-day SPX close from `/api/eod-gex?symbol=$SPX`; `prevBasisRef = esClose − spxClose`. `effectiveBasis()` prefers this frozen basis because the live feed `spot` (broker SPX) mis-scales and can read ABOVE ES (saw live basis −46.54 vs DB +72). 6/22 is the current source row.

### Footprint bubbles ("bigger, bolder, fewer")
- Larger radius range (`rCap` → `h*0.46`/`pitch*0.46`, `rMin` 3), `sqrt(t)` area scaling, bold fills (alpha 0.45→0.90) + bright rings; gate 40th pct / span to 95th pct.
- **Disappear bug fixed at the source:** `useEsBigTrades.ingest` now MERGES — throttled/partial `esBigTrades` frames that omit `trades`/`delta` no longer reset them to `[]` (which blanked the lanes between full frames). Also fixes the Footprint page.
- Lanes + heatmap now repaint on every candle update + a rAF-coalesced safety repaint on visible-time-range change (1s interval).

### Heatmap metric toggle
- New toolbar button **GEX: Vol+OI ↔ GEX: Vol**. `GexCell` now stores `netOiVol` (gamma×(OI+vol)) and `netVol` (gamma×vol, server `netVolGEX`); metric chosen at draw time via `gexMetricRef`, per-column max/top-3 recomputed for the active metric. Switch re-renders instantly from cached columns.
- Limitation: history/non-front-expiry backfill only persists `net_gex` (OI) → **Vol-only mode is blank for historical columns**; would need `option_strike_gex_history` to also store `netVolGEX`.

### MVC
- Decoupled MVC from the Levels toggle: MVC step line + dashed marker now gated by `showMvcLine` ONLY; the `Levels` button controls just Call Wall / Put Wall / Flip.

### ⚠️ Follow-ups
- GEX level lines (Call/Put/Flip/MVC) still convert SPX→ES with the **live** basis — if the live basis is wrong they're mispositioned; consider switching them to `effectiveBasis()`.
- `eod_gex` has only ONE SPX EOD row (6/22); the frozen basis needs the EOD recorder to populate daily (server-uptime issue — recorder logic is fine).

---

## 2026-06-23 (session 55, infra) — Render → Hetzner + Cloudflare migration; owner-dash Postgres health + Hetzner hosting metrics

Migrated the whole stack off Render hosting onto a Hetzner Cloud VPS fronted by Cloudflare, with no app-logic changes. `server-v2` (Next.js + `/ws/gex` + TT/dxLink feed + in-process schedulers) runs as a single Node process in Docker on the box; Render Postgres (Virginia) kept as-is. Drivers: egress cost + overall cost.

### Containerization / deploy
- Added `Dockerfile` (node:20-bookworm-slim, multi-stage; tzdata + `TZ=America/New_York` for the ET-gated MVC/EOD/weekly schedulers; dropped chromium — puppeteer/tesseract/etc. are declared but unused at runtime), `docker-compose.yml` (`.env.local` as single source of truth for `PORT`/secrets, `APP_PORT` host mapping, `/proxy/health` healthcheck, restart policy), `.dockerignore`.
- `npm ci || npm install` fallback (repo lockfile had a `picomatch` drift). `next build` needs Clerk + owner build-args inlined: `NEXT_PUBLIC_OWNER_USER_ID`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_NAME` passed as ARG/ENV + compose `build.args`.
- 2 GB swap on the 4 GB box so `next build` can't OOM.

### Infrastructure
- **VPS:** Hetzner CPX21 (3 vCPU / 4 GB / 80 GB), **Ashburn us-east** (next to Render's Virginia Postgres → single-digit-ms DB latency), Ubuntu 26.04, server `cb-edge-prod` (IP 178.156.137.36, server id 144288812).
- **Cloudflare Tunnel** (`cloudflared`, no inbound ports): `/etc/cloudflared/config.yml` routes `cbedge.net`, `www.cbedge.net`, `dash.cbedge.net` → `127.0.0.1:3002`; systemd service. Old Render DNS (`A 216.24.57.1`, `www → dash-1fa2.onrender.com`) deleted; all three hostnames now proxied CNAMEs to the tunnel. SSL Full. Render web service suspended.
- `DEPLOY_CLOUDFLARE.md` runbook (provisioning, tunnel, cache rules, **§2b secrets rotation**, cutover, verification).

### Owner dashboard features
- **Postgres health:** new `app/api/db/health/route.ts` (`SELECT 1` + latency via `lib/db` `pgQuery`). Owner page shows a "Postgres OK/DOWN" header badge + a "Postgres · OK · Nms" System card. (Route is auth-gated like the rest of `/api/*`.)
- **Hetzner hosting metrics:** new `app/api/hetzner-metrics/route.ts` (CPU + network from the Hetzner Cloud API, normalized to the old Render shape so the UI renders unchanged). Hetzner has no RAM metric → memory box now reads the app's own RSS from a new `/proxy/self-metrics` route on `server-v2`. Owner section relabeled "Render · Hosting" → "Hetzner · Hosting"; metrics fetches repointed `render-metrics` → `hetzner-metrics`. New env: `HETZNER_API_TOKEN`, `HETZNER_SERVER_ID`.

### ⚠️ Follow-ups
- **Rotate exposed secrets** (shared in session / public in repo `.env`): Hetzner API token, TT refresh token + client secret, Postgres password, Render API key, Discord bot token, Google service-account key. See `DEPLOY_CLOUDFLARE.md` §2b.
- Render web service is **suspended** (rollback safety), not deleted. Postgres kept.

---

## 2026-06-23 (session 54) — ES Candles page: GEX heatmap, footprint lanes, volume profile, session levels

Built out `/es-candles` (Futures group) into a full futures order-flow chart on top of `useEsCandles` (SQL + `/ws/gex`). Versions bumped through `2026.6.22-v22`.

### Candlesticks + axes
- Wired the page to live 5m ES candles (`useEsCandles`); removed the disabled feed and the Last Close/Volume/Updated stat boxes.
- Dual price axis: **right = ESU**, **left = SPX** (invisible companion candle series fed OHLC − live basis, so both axes align pixel-for-pixel at any zoom).
- `fitContent()` only on first load (no auto-recenter); **double-click** recenters + resets both scales to autoscale. Crosshair lines/labels removed. Flat panel background (no red gradient).

### GEX heatmap overlay
- Canvas overlay behind the chart (candles on top) painting one column per 5-min GEX snapshot, exact `metricBg` gradient (cyan +GEX / red −GEX, top-3 rank floors, intensity slider). Offscreen-buffer blur for smooth blending; dimmed so candles read through.
- Historical backfill from `option_strike_gex_history` (new `mode=heatmap` API + `getOptionStrikeGexSlots` db helper) seeds today's columns on load; column cap raised 200→600 so a full day persists. Custom dark **DTE picker** chooses which expiry drives the heatmap (front = live; non-front = history-only).

### Footprint lanes (from `useEsBigTrades`)
- **Big-trade bubbles** lane (one per 5-min slot, single row, color = dominant aggressor): per-session scaling (RTH / overnight / 3:45–4:15 EOD groups), volume-gated, log/linear sizing capped to column pitch, hover tooltip (time, total, buy/sell, net). Size toggle Total vs **Net Δ** (default Net).
- **Delta lane**: 5-min net bars + a white **Cumulative Delta** line that resets at the 9:30 ET RTH open.

### Levels
- GEX level lines (Call Wall / Put Wall / Flip / MVC) — Flip computed via `findGEXFlip` (not in feed), MVC polled from `mvc_snapshots`. Single **Levels** toggle (off by default).
- **MVC step line**: every today MVC plotted as horizontal segments (no vertical connectors), thick white, ES-basis adjusted.
- **Session levels** (**PDH/ON** toggle, off by default): prior-day H/L + rolling overnight H/L (16:00→9:30 ET window that builds overnight, freezes at the open, resets at the next close).
- **Volume profile** (right edge, off by default): POC/VAH/VAL/LVN from candle volume-by-price.

---

## 2026-06-22 (session 53) — GEX chart prior-state ghost overlay (5/15/30m)

Added a "prior GEX" ghost layer to the NET GEX chart (`components/dashboard/GexChart.tsx`) showing the per-strike net GEX 5/15/30 min ago behind the live bars, plus supporting data plumbing and a toolbar control. Versions bumped through `2026.6.22-v21`.

### Ghost overlay (GexChart.tsx)
- New props: `baselines`, `showGhost5/15/30`. Renders a faded prior-state bar behind each live bar (Net GEX + OI+Vol mode only — baselines store OI-based net GEX).
- Per-strike logic: GEX **down** → taller faded prior bar drawn behind (halo); GEX **up** → only the rise portion (live↔prior) shaded as a cap on top.
- Outline color encodes direction using the chart's own palette: **yellow `#ffb300`** when GEX shrank, **blue `#29b6f6`** when it grew (replaced the initial white outline).
- Legend shows the active timeframe with ↓/↑ in each color; on-chart note when a toggle is on but no history exists, or when in an unsupported mode.

### Toolbar (GexToolbar.tsx) + home wiring (app/home/page.tsx)
- Three `5m / 15m / 30m` toggles, shown only in Net GEX + OI+Vol mode.
- Toggles are **mutually exclusive** — enabling one clears the others.
- `show5/15/30` state added; chart baselines polled (full chain) whenever any toggle is on, via `chartBaselines`.

### Data: nearest-snapshot fallback
- `lib/db.ts`: new `getOptionStrikeNetGexAsOfOrNearest` — prefers the latest row at-or-before the target age, else the strike's nearest available row, so ghosts populate after-hours / right after the writer starts.
- `app/api/snapshots/option-strike-gex-history/route.ts`: `tolerant=1` query param selects the nearest-fallback query (chart uses it; popup stays exact).
- `hooks/useStrikeGexHistory.ts`: added `tolerant` arg threaded into the fetch URL.

### UI cleanup
- Removed the duplicate ticker-row clock from the top toolbar (`app/home/page.tsx`); the live ET clock now lives only in the NET GEX chart header.

---

## 2026-06-22 (session 52) — Confidence Score overhaul: two-stage model, MVC study anchoring, calibration tracker, UI consolidation

Major rework of the `/confidence-score` page and its scoring engine (`lib/confidenceScore.ts` + `app/api/confidence/route.ts`), plus a new calibration system and a global date-picker fix. Versions bumped through `2026.6.22-v17`.

### Scoring engine — new factors & two-stage model
- Added **Net Wall Bias** (`pivot − break`, −100..100) as the single defend-vs-break decision read.
- Added **rejection-rate boost**: same-cluster historical rejection rate (time-decayed, sample-size weighted) lifts Pivot and lowers Break — "history of actual rejections beats raw size."
- Added **relative GEX rank** (1.0 = day's dominant MVC strike, 0.8 = 2nd…) computed from today's distinct MVC strikes; discounts strong-but-secondary walls in Pivot/Break.
- **Two-stage probability model**: Hit = "Reach" (stands alone); Pivot/Chop/Break are now CONDITIONAL on a touch and renormalized to sum to 100%. Net Wall Bias and the bias line reason within the conditional split.

### MVC study base rates (neutral wording — no source name)
- Added a `STUDY` anchor: reach **75%** / pivot **55%** / chop **26%** / break **17%**, with **85%** open-at-MVC pivot. Each structural score is blended 50% toward the base rate so structure tilts around an empirical prior instead of a flat low base.
- **Open-at-MVC 85% setup**: detected in the route (live session, first ~15 min, SPX within 8 pts of the level) → pulls Pivot toward 0.85 and surfaces a green call-out banner.
- IV 16–45% validity window noted as a caveat (tooltip + hero footnote), not enforced.

### Calibration tracker (answers "how accurate is it")
- New `confidence_log` Postgres table + `upsertConfidenceLog`/`getGradedConfidenceLog` helpers in `lib/db.ts` (one graded row per day; held = pivot|chop, broke = clean break-through).
- New `app/api/confidence/calibration/route.ts`: `?refresh=1` backfills + grades every completed day from `mvc_snapshots` (scored from the structural prior only, no self-referential history blend), buckets predictions, returns predicted-vs-actual reliability + Brier scores for Reach / Reject|touched / Break|touched, plus Net Wall Bias directional accuracy.
- New collapsible **Calibration panel** on the page: reliability bars (actual fill + predicted tick), Brier verdicts, sample sizes, low-sample warning.

### UI consolidation (data-overload cleanup)
- Added a **hero MVC card** at the top of the Outcome box: MVC level + Reach% + on-touch Reject/Chop/Break split, folded-in metrics strip + headline note + study base reference (`55 / 26 / 17`) + IV caveat.
- Removed the redundant **Analogs panel** (history now a compact badge in Live Structure) and the **"Read" notes panel** (folded into hero).
- **Live Structure** condensed to a compact auto-fit factor grid with inline regime/history badges (~half the height); shorter labels, tighter label column.
- Merged the standalone **Bias line into the Net Wall Bias meter**; trimmed the Outcome box to hero + So-far rollup + archetype narrative + timeline (dropped duplicate mechanics strip + status line). Moved the "So far" rollup to the top of the Outcome box.

### Global fix
- **Date-picker calendar icon**: replaced the `filter: invert(1)` rule in `app/globals.css` with a custom cyan calendar SVG indicator — guaranteed visible on every dark-themed date/time input across all pages (Confidence, Database, Trading, EM Tracker Admin).

> Note: `next build` / `tsc` not run (sandbox virtualization disabled all session) — run `npx tsc --noEmit` and click "Re-grade history" once before relying on the calibration numbers.

## 2026-06-22 (session 51) — New `/fails` page: ESU look-above/below fails + AMT + merged IB

Built a standalone Fails page (`app/fails/page.tsx` + `lib/failLevels.ts`) tracking failed breakouts ("look above & fail" / "look below & fail") of key auction reference levels, driven entirely off the existing 5m ES candle feed (`useEsCandles`) — no new API/table. Linked in the sidebar under the Futures group.

### Reference levels & fail detection (`lib/failLevels.ts`)
- Computes overnight H/L (prior 18:00→09:30 ET globex), previous-day RTH H/L, and previous-week H/L from the candle history.
- Fail = price pierces a level intrabar but a bar closes back through it within 2 bars; tracks poke distance, close-back, and follow-through. Live per-level status (idle/testing/broke/failed), today's fail log, and a ~20-session fail-rate stats engine (replays each prior day's levels).

### Auction Market Theory layer
- Today's Initial Balance (09:30–10:30 ET) + day-type classification (Trend ↑/↓, Balance, Reversal ↑/↓, Forming) from IB interaction.
- Per-level AMT read: overnight = thin/weak acceptance (fade target), prior-day/week = strong acceptance (retest support/resistance), with long/short/neutral bias and an overall day bias line.
- Entry-trigger detector (`detectTriggers`): rule-based scalping setups — A break-&-retest long, D breakdown-&-retest short, C/C′ IB-extension long/short (clearing ONH/ONL), E poor-high/low fades, F balance-to-imbalance breaks. Each emits entry/stop/target (ES pts), confluence note, and freshness (active ≤20m). Surfaced as an "Active Setups" grid.

### ESU-only + value-area removed
- Page is ESU-specific: candles filtered to symbols containing `ESU` (`/ESU6`, `/ESU26:XCME`, …) with a fallback to all candles during rollover. Dropped the SPX/ES toggle, the `/ws/gex` basis WebSocket, and all SPX conversion — prices display as raw ESU points.
- Removed value-area logic entirely (no VAH/VAL/POC); day-type is pure IB + price, the VAL-rejection (B) trigger and VA-confluence tags are gone.

### Merged IB from Insights
- Exported `LiveIb` from `components/insights/IbLogic.tsx` and embedded it on `/fails` (locked-DB persistence, break alerts w/ timestamps, formed-first/vs-mid stats, rules-in-play engine). Removed the IB Logic tab from `/insights` (tab type, TABS entry, render, import) so it lives only on Fails. IB stays on the default /ES feed.
- Rules-in-play now compute while the IB is still forming (pre-10:30) and render as PROVISIONAL with an amber "not locked" badge — previously hidden until lock. Rules cards laid out in a ~2-row grid.

### Polish
- Matched the shared `homeTheme` panel styling (shell/header/content/panel + hover lift). All gray fonts switched to white across `/fails` and the IB component (kept colored semantic text and the offline live-dot tint).

> Note: `next build` / `tsc` not run any session (sandbox virtualization disabled this whole session) — verify locally before pushing.

## 2026-06-22 (session 50) — New lean `/greeks` page: graphs, gamma-logic feed, velocity, vol

Built a focused standalone Greeks page (`app/greeks/page.tsx`) because the Insights Exposure Stack had unreliable sparklines and hit-or-miss greek values. `/insights` left untouched; new page linked in the sidebar (GEX group, above Insights).

### Core page
- Four cards — GEX / DEX / CHEX / VEX — each with a robust zero-cross graph (green-above / red-below shading, bold zero baseline, glow line, Line/Bars toggle). Data from `/api/insights/gex` totals, seeded from `queryGreeksToday()` so graphs aren't blank on first paint; every live reading persisted via `saveGreeksSnapshot`. Polls every 30s, ignores empty/zero responses (no card-wipe), shows "feed idle" instead of `--`.
- Removed the GEX+VEX card per request; grid is a clean 2×2.

### Sparkline reliability + axis fixes
- Old sparkline drew once into a 0-width canvas during layout → blank "half the time". New `ZeroCrossGraph` redraws on ResizeObserver + window resize + post-layout frame.
- X-axis fixed to today's RTH window 9:30 AM–6:00 PM ET with hour gridlines. First `sessionBounds()` impl mis-computed the ET offset (axis read "6 AM"); rewrote with a correct `etOffsetMs()` UTC-offset calc.
- Hover crosshair + tooltip (value + ET time). Fixed "Invalid Date": `timestamp` is a Postgres BIGINT → arrives as a string over JSON; coerce `Number(r.timestamp)` on seed, normalize seconds-vs-ms on live path.
- Bars sized off the gap between consecutive points (not axis/count) so sparse data isn't one fat block.

### Gamma-logic feed (if-this-then-that)
- Rules engine (`evaluateGamma`) over current greeks + intraday percentiles → scrolling signal feed with active-now chips, timestamped history, **Edge:** action lines, and pulsing background for critical events. Priority-ordered per the spec (DEX flip → velocity → deep-neg gamma → regimes → tiers → neutral fallback). Dedups so the same condition doesn't re-spam every poll.

### Velocity (rate of change)
- `velocityOf()` measures ~10-min Δ per greek + acceleration (2nd derivative, interval-independent). Per-card `↑/↓ Δ/10m` readout. New feed signals: Rapid DEX Surge (>$15B), GEX Velocity Surge/Weakening (>30% range), CHEX Ramp, VEX Shift, Extreme Acceleration, Accelerating Dealer Alignment (bull/bear), Velocity Cooling.

### Volatility card + vol-aware rules
- VolCard below the grid: VIX 30D / VIX1D / 10D realized / IV Rank / VRP, IV FALLING▼/RISING▲ badge, regime read. Fed by `/api/insights/vix`. Rules added: High IV Rank + Neg GEX → straddles; Low IV + High Pos GEX → premium selling; Active Vanna Upside gated on IV actually falling.

### Polish
- Page now scrolls — was clipped by `<main>`'s `overflow:hidden`; wrapped content in `flex:1; minHeight:0; overflowY:auto`.
- Per-Greek identity colors (cool neon): GEX cyan, DEX violet, CHEX teal, VEX magenta; Vol card slate/blue. All orange removed. Sign shown via a small green/red POSITIVE/NEGATIVE badge.

> Note: `next build` not run this session (sandbox virtualization disabled) — verify locally before pushing.

## 2026-06-22 (session 49) — Dev page CHEX/Vanna readout (REST probe BS-derived)

Charm exposure (CHEX) and Vanna exposure showed "n/a" on the `/dev` Symbol Probe. Root cause was data-source, not a bug: the dev page probes via `/proxy/probe-rest`, and the TastyTrade REST greeks feed (`/market-data/by-type`) returns only gamma/delta/theta/vega — no charm or vanna — so the proxy hardcoded `charmExp: null` / `vannaExp: null`.

### REST probe now derives vanna/charm from Black-Scholes
- `server-v2/proxy-tastytrade.js` (`probeRest`, exposures block ~L682): added a `bsGreeks({ S: spot, K: best.strike, T: yearsToExpiry(best.expiration), sigma: g.iv, r: RISK_FREE, type })` call, gated on `spot>0 && iv>0 && T>0`. `vannaExp` and `charmExp` are now computed with the same conventions as the live `_recompute` path: BS per-year output unit-scaled (vanna ÷100 per 1% vol, charm ÷365 per day), then `sign · scaled · OI · 100 · spot` (calls +, puts −). Falls back to `null` when IV/T unavailable.
- No client change needed — `app/dev/page.tsx` already renders `charmExp`/`vannaExp` rows; they just stop showing "n/a" once populated.
- CHEX formula (reference): `charm = −φ(d₁)·(2rT − d₂σ√T)/(2Tσ√T)` per year → `/365` per day; per-strike `CHEX = (charmCall·callOI − charmPut·putOI)·spot·100`.
- Restart server-v2 to pick up.

## 2026-06-22 (session 48) — MVC auto-snapshot fix (internal-token auth), flow-tape big-order retention (v13)

Fixed the MVC auto-collector that was never writing auto rows (all snapshots in the DB were manual), and the SPX Flow Tape showing nothing above the $100k filter.

### MVC auto-snapshot — root cause: protected route returned HTML
- `server-v2/mvc-auto-snapshot.js`: the collector's localhost `fetch('/api/gex')` carried no Clerk session, so middleware redirected it to `/` and returned landing-page HTML → `res.json()` threw `Unexpected token '<'` and every auto tick silently skipped. Added an `internalHeaders()` helper that sends `x-internal-token: INTERNAL_API_TOKEN` on both `/api/gex` (GET) and `/api/snapshots/mvc` (POST), matching the existing `levels-auto-publish.js` pattern.
- Diagnostics + hardening: auto-pause and outside-RTH skips now log a reason; `setMvcAutoEnabled` logs ENABLED/PAUSED; default is env-controlled (`MVC_AUTO=0` to disable). Replaced the drift-prone `setInterval` with a self-rescheduling boundary timer locked to :00/:05/:10 (no `.unref()`), each tick logged. Confirmed working — 5-min cadence is writing.

### SPX Flow Tape — big orders evicted before the client filter
- `server-v2/computation/flow-processor.js`: the tape kept the most recent 200 prints of ALL underlyings with no premium floor, then filtered to SPX ≥$100k only on the client. SPX 0DTE prints hundreds/sec, so the window was always full of sub-$100k noise and real $100k+ blocks were evicted within seconds. Tape is now SPX/SPXW-only and rejects new entries below a $10k premium floor before they consume a cap slot (sweeps still coalesce into existing slots); cap raised 200→500. `prints` aggregation (net premium / buyPct) unchanged — still counts every underlying.

## 2026-06-22 (session 47, ~10:10 ET) — Net-premium sparkline square-wave fix, DB connection retry, MVC writer hardening (v10)

Fixed the "NET PREMIUM" sparkline that rendered as a square wave whipsawing between fixed rails (-$7.8M / +$21.2M), plus the DB-write 500s and MVC auto-collector reliability.

### Net-premium sparkline — square-wave root cause
- `hooks/useSpxFlow.ts`: `seed()` guarded `netPremium`/`callPremium`/`putPremium` with `Math.abs(new) > Math.abs(stored)` — but premium is a SIGNED live value that swings +/-, so it latched at the largest magnitude ever seen, freezing the readout and squaring off the sparkline. Now tracks the latest signed value. (Volume counters keep their monotonic `>` guard — that's correct for them.)
- `components/dashboard/SnapshotPanel.tsx`: live in-memory net-premium series (`liveSeriesRef`/`liveSeries`) sampled from the corrected `netPremiumFlow` (~3s cadence, 600-pt cap) is now the source of truth. `premHistory` renders live; persisted `premium_flow` rows are stitched on only as a prefix for points OLDER than the first live sample, so corrupt/latched DB rows can't override live values.
- Sparkline autoscale clamped to 2nd–98th percentile + `y()` clamps out-of-range points, so a couple of outlier rows can't crush the real signal into a flat rail.
- Corrupt persisted rows purged: `DELETE FROM premium_flow WHERE date = '2026-06-22'` (1245 rows) via `scripts/purge-premium-flow.js` (one-off; remove it — has DB URL hardcoded).

### DB connection — transient-drop retry
- `lib/db.ts`: snapshot POSTs were 500ing on `Connection terminated unexpectedly` (Postgres restart/recovery / churn). The pool's `error` handler only covers IDLE clients; an in-flight drop rejected the query. Added `pgQuery()` + `isTransientConnError()` (matches `Connection terminated`/`ECONNRESET`/`57P01`/`08006`/`08003`), retries once on a fresh client after 150ms.
- Routed `queryAll`, `insertPremiumFlow`, `insertBzilaSnapshot`, and `insertMvcSnapshot` through `pgQuery`.

### MVC auto-collector
- `server-v2/mvc-auto-snapshot.js` already fires every 5 min during RTH (`INTERVAL_MIN = 5`; stale "auto-30m" comments aside). The blocker was the shared DB-write failure above — now covered by the `insertMvcSnapshot` retry.

## 2026-06-22 (session 46) — Bzila page removal, sidebar nav rebuild, To-Do reskin, top-bar/clock + socials

Removed the `/bzila` page and its exclusive data layer, rebuilt the sidebar nav structure + styling, reskinned the To-Do page to match the dashboard UI, moved the GEX-chart clock, and refreshed the social buttons.

### Bzila page + data layer removed (surgical)
- Deleted `app/bzila/page.tsx` and the two routes it exclusively used: `app/api/snapshots/bzila-gex-history/` and `app/api/snapshots/bzila-strikes/`.
- `lib/db.ts`: removed `bzila_gex_history` + `bzila_strike_gex_history` table/index DDL, interfaces (`BzilaGexPoint`, `BzilaStrikeGexRecord`), and functions (`insertBzilaGexPoint`, `getBzilaGexHistory`, `insertBzilaStrikeGexRows`, `getBzilaStrikeGexHistory`, the two `ensure*` stubs). **Kept** `bzila_snapshots` (+ all its functions) because the main dashboard's `SnapshotPanel.tsx` depends on it. Kept `OptionStrikeGexRecord` / `insertOptionStrikeGexRows`.
- Removed both tables from `app/api/db/route.ts` allowlist, `app/database/page.tsx`, `app/dev/owner/page.tsx`, and the Bzila Flow row in `md files/agents.md`.
- Dropped the two tables in Postgres via a one-time owner-gated route (`/api/debug/drop-bzila-gex`, since deleted). `migrations/drop_bzila_gex_history.sql` left for reference. `bzila_snapshots` confirmed retained.

### Sidebar nav rebuild (`components/shared/Sidebar.tsx`)
- New groups: **GEX** (Home, Multi Greek, Options Chain, Insights, Confidence, Estimated Moves Front End), **Futures** (Footprint), **Stock Market** (Premarket, Economic Calendar), **Personal** (Journal→/trading, Budget, To-Do→/personal/todo), **Admin** (Owner, Admin, Database, Dev, Estimated Moves BE, Logs, Changelog; owner-gated `devOnly`).
- Replaced the five group SVG icons with detailed approximations (funnel, hourglass+contract, bull/bear+pit, house+safe+person, gear+key+badge).
- Futures forced to accordion layout (`forceAccordion`) so its single "Footprint" item shows under the title.
- Faint cyan hover tint on expanded nav items.
- Collapsed mode: clicking a group icon now navigates to its top item.
- All muted-grey nav text (group labels, items, flyout headers, chevrons, collapse toggle) → white.
- Social row replaced with X / YouTube / TikTok (real URLs); always-on colored glow (brighter on hover), shared white border like X.
- Clerk `UserButton` avatar enlarged 32→56px.

### To-Do page reskin (`app/personal/todo/page.tsx`)
- Full restyle to match Confidence Score: `homeShellStyle` shell, glassmorphic `homePanelStyle` panels, cyan/purple/orange/green `HOME_THEME` accents, `SectionTitle` bars, `conf-hover` lift, Inter font, cyan gradient buttons, cyan-glow trend chart. All functionality preserved (checklists, kanban, all-tasks table, analytics, modals). Removed dead Budget/Trading/Personal header tabs. Added `usePageLoadStatus`.

### GEX chart clock + top bar
- `app/home/page.tsx`: replaced the "Drag to pan · Scroll to zoom" hint in the NET GEX header with the live ET clock (`etTime`).
- `components/shared/TopBar.tsx`: removed the clock + session from the VIX pill (freeing room for VIX/ESU/SPX) and deleted the now-unused `clock`/`session` state, clock tick effect, and `etClock`/`etSession` helpers.

### Investigated (no code change)
- Strike-detail popup Δ boxes (From Open / 5 / 15 / 30 min): confirmed the `option_strike_gex_history` writer is healthy (~120 points/30min) and the rolling query works. Open question left for next session: whether point-mode baselines come back populated, and the `selectedStrike`-gating on `app/home/page.tsx:729`.

> Note: build verified green earlier this session (`next build`, 76 pages). Postgres tables dropped. No server-v2 changes. Sandbox hypervisor disabled — git commit must be run manually (commands below).

## 2026-06-22 (session 45) — Multi-greek dropdown theming, SPY/QQQ volume refresh + greek basis, pre-open volume reset, version bump v7

Fixed the mult-greek expiry dropdown styling, addressed SPY/QQQ option volume showing 0 (no auto-refresh + REST staleness), restored the VOL-only tab, and added a 9:30 ET pre-open volume reset so the new session starts clean.

### Mult-greek expiry dropdown — dark theming
- `app/mult-greek/page.tsx`: native `<select>` options inherited the OS light background. Styled each `<option>` with `background: #0b0f1a` + theme text color and added `colorScheme: "dark"` on the select so the popup renders dark in Chrome/Edge.

### SPY/QQQ chain auto-refresh
- `app/mult-greek/page.tsx` and `app/options-chain/page.tsx` loaded the chain only once (mount / GO / manual refresh) with no polling. Added a 60s `setInterval` that cache-bust re-pulls `/api/chains` while the market is open so per-strike volume accumulates through the session instead of staying frozen at the one-shot load.
- `app/options-chain/page.tsx`: added `isSessionLive()` helper (trading day + 9:30–16:00 ET) gating the poll.

### Greek contract basis
- `app/mult-greek/page.tsx`: greek was computed volume-only in VOL mode, reading blank pre-open (session volume still 0). Confirmed OI+VOL is the default; restored the OI+VOL / VOL toggle so a VOL-only tab is available on demand while OI+VOL keeps the view populated pre-open.

### Pre-open volume reset (server-v2)
- `server-v2/proxy-tastytrade.js`: TastyTrade REST per-strike `volume` carries the PRIOR session's cumulative figure until their backend resets at the 9:30 ET cash open. Added `etMinutesNow()` / `isPreOpenEt()` helpers and zeroed `volume` in `fetchChainFull` before 9:30 ET. OI is untouched. Requires server-v2 restart.

### Version
- `package.json`: bumped to `2026.6.22-v7`.

## 2026-06-22 (session 44) — Net-premium sparkline whole-night history, flow sell-side classifier fix, version bump v6

Snapshot Flow panel: made the net-premium sparkline span the whole session, fixed the buy/sell flow misclassification that zeroed out sell volume, and removed the SPX price pill.

### Net Premium sparkline — whole-night history
- `components/dashboard/SnapshotPanel.tsx`: sparkline was built only from `flow.orders` (the server flow tape, hard-capped at ~200 prints in `flow-processor.js`), so it could never show more than the recent slice. Now hydrates a persisted `premium_flow` series for the active session and merges the live tail on top.
- Added `sessionStartMs()` / `sessionDateKeys()` / `etMinutes()` / `etDateKey()` helpers: session breaks only at the two SPX opens — RTH 09:30 and EXT 18:00 — so 18:00→next-09:30 is one continuous line crossing midnight (fetched across both ET date partitions). 09:30–18:00 belongs to today's RTH.
- `fetchSessionPremHistory()` bounds rows to the session-start instant and sorts ascending.
- **Writer was missing:** `lib/snapdb.ts:savePremiumFlowSnapshot` existed but was never called on server-v2, so the `premium_flow` table had only one stale row (2026-06-16). Wired it into the existing 5s autosave loop in SnapshotPanel so net-premium points now persist.
- Refresh no longer resets the sparkline: `doRefresh` only fetches when the night history never loaded, and neither refresh nor the 60s poll will replace a populated series with a smaller/empty one.

### Flow buy/sell classifier — sell volume fix
- `server-v2/computation/flow-processor.js`: `/proxy/flow` was showing `buyPct ~99.97%` (callSellVol 1, putSellVol 4) — nearly every print misclassified as a buy because `inferSide`'s `price >= ask` fired against stale, lagging cached quotes. Rewrote `inferSide` to always trust inside-spread classification, only trust at/outside-spread calls when the quote is fresh (≤2500ms), and otherwise fall back to the tick rule vs. the symbol's prior trade price.
- Added per-symbol `lastTradePx` tracking in `addPrint` (cleared in `reset()`).
- `server-v2/proxy-tastytrade.js`: Quote handler now stamps each cached quote with `t: Date.now()` for the freshness check.

### Snapshot header
- `components/dashboard/SnapshotPanel.tsx`: removed the `SPX <price>` pill next to the SNAPSHOT label.

### Version
- `package.json`: bumped `2026.6.22-v5` → `2026.6.22-v6`.

> Note: server-v2 changes (classifier + quote timestamp) require a server restart to take effect. `tsc`/tests not run this session (sandbox hypervisor disabled) — verify with a local build before deploy.

## 2026-06-22 (session 43) — Options chain strike ordering (descending), version bump v4

Reversed the options-chain strike sort so higher strikes render at the top and lower strikes at the bottom.

### Options chain — strike ordering
- `app/options-chain/page.tsx:569`: `visibleRows` sort changed from `a.strike - b.strike` (ascending) to `b.strike - a.strike` (descending). Higher strikes now appear at top of the table, matching the intended "High to low" layout that the comment already described.

### Version
- `package.json`: bumped `2026.6.22-v3` → `2026.6.22-v4`.

## 2026-06-22 (session 42) — Econ-calendar USA filters, Trump-calendar history trim, snapshot-flow hover, ticker data-box auto-scale, NET GEX units fix

UI/UX and data-filtering pass on the home dashboard and economic calendar.

### Economic calendar — USA-only Medium/Low filters
- `app/economic-calendar/page.tsx` and `components/dashboard/EconCalendarPanel.tsx`: added `medium-usd` and `low-usd` filter options mirroring the existing `high-usd` (`impact === X && country === "USD"`). Homepage panel default-on set changed to `["high-usd", "medium-usd", "trump"]`.
- `components/shared/EconCalendarDiscordBtn.tsx`: `includeTemplateEvent()` now restricts Medium to USD so the Discord-shared template image matches the default-on filters.

### Trump calendar — drop historical events
- `app/api/trump-calendar/route.ts`: added a `minDate()` cutoff (`LOOKBACK_DAYS = 0`, today-forward) so the 2,600+ historical factba.se events are filtered out before mapping.

### Snapshot Flow — Net Premium hover tooltip
- `components/dashboard/SnapshotPanel.tsx`: `buildHistory()` now returns `{ts, value}[]`; the Net Premium `Sparkline` gained mouse tracking with a crosshair, marker dot, and a tooltip showing time (ET) + net premium at the cursor.

### Header ticker — single scaling "data box"
- `app/home/page.tsx`: wrapped both ticker rows in a box that auto-scales via a JS ResizeObserver (measures natural width vs. column width, applies inline `transform: scale()`), so the clock/VIX/ESU/SPX/NQU row and the NET GEX/CALL WALL/PUT WALL/FLIP/MVC row shrink together as one unit and NQU never clips. Converted the rows' `vw`/clamp fonts to fixed px (top row larger than bottom). Bottom row indented 13px to align "NET GEX" under the clock digits.
- `app/globals.css`: removed the prior progressive-hide / container-query CSS (scaling is now JS-driven).

### NET GEX header units fix
- `app/home/page.tsx`: `netGex` is denominated in billions but was passed to `fmtMoney` (expects raw dollars), rendering `+$7` instead of `+$7.20B`. Added `fmtMoneyB()` and used it for the header value.

## 2026-06-22 (session 41) — SPX session-rollover OI/vol refresh, dev-page calls+puts+net, GEX sign/clarity fixes

Diagnosed the "GEX chart looks identical to yesterday" issue, hardened the OI/volume refresh across SPX's ~23h session boundary, rebuilt the dev probe to show calls + puts + net in one shot, added an independent OI cross-check, and clarified the strike popup's OI-vs-Vol GEX so a negative bar with a positive composite is self-explaining. Version bumped to `2026.6.22-v3`.

### SPX session rollover (`server-v2/proxy-tastytrade.js`)
- Root cause: once OI coverage warms at startup the REST OI/volume poll stops, leaving the feed dependent on dxFeed pushing a fresh Summary/`dayVolume` reset at the ~6PM ET reopen — which it does only sometimes, freezing OI + volume (and the GEX chart) at the prior session.
- Added a dxFeed-independent watcher: computes an SPX "session key" (ET date after the 6PM reopen), checks each minute, and on rollover clears `this.volumes` (so a stale `dayVolume` can't linger as a REST fallback) and re-arms the OI backfill (`oiReady=false` → fast re-poll). Pauses/resumes with idle. Env-tunable via `SESSION_ROLL_HOUR_ET` (18) and `SESSION_ROLL_CHECK_MS` (60000).

### Independent OI cross-check (`server-v2/proxy-tastytrade.js`, `app/dev/page.tsx`)
- Probe now also fetches the same contract's OI from an external source and returns an `oiCompare` block (ours vs reference, diff, %); dev page renders an "OI Check" panel + per-probe log line, color-coded by % gap.
- Yahoo v7 options endpoint now 401s (needs crumb/cookie); switched to CBOE delayed-quotes with browser-style WAF headers. **Still 401 — open item to revisit** (likely needs a session cookie or a keyed provider).

### Dev page — calls + puts + net (`app/dev/page.tsx`)
- Removed the Call/Put toggle: one strike in → fetches both sides in parallel, renders three rows (Call cards, Put cards, combined Net Greeks summing GEX/DEX/VEX/theta/vanna/charm + total OI/volume).
- Strike now auto-fills to the chain strike nearest live spot (from `/proxy/gex`), instead of a hardcoded value; manual edits suppress the auto-fill.

### Strike popup (`components/dashboard/StrikeDetailPopup.tsx`)
- Added a collapsible raw "GEX INPUTS (LIVE)" breakdown (spot, per-side gamma/OI, call/put/net GEX) for cross-checking against /dev.
- Split the headline into OI-GEX (= the bar) vs Vol-GEX component chips, so a negative bar next to a positive OI+Vol composite is no longer confusing. (Confirmed not a bug: 7500 has put-heavy OI but call-heavy volume today.)

### GEX sign fix (`lib/calculations/calculations.ts`)
- `calculateNetGEX` now takes `Math.abs` of both gammas and forces puts negative, matching the server calculator — a stray negative gamma can no longer flip a put's contribution positive.

### Landing + flow (`components/landing/LandingClient.tsx`, `components/dashboard/FlowTape.tsx`)
- Mobile landing card shrinks to fit an iPhone viewport without scrolling (responsive logo/intro/feature/gap sizing; feature grid hides on short screens).
- SPX flow tape now defaults to the 100K premium filter on load.

## 2026-06-21 (session 40) — Overview NQU watchlist quote (broker AH-aware) + sidebar collapsed by default

Added a new NQU quote to the Overview top-right toolbar with a click-to-open gainers dropdown, switched its prices to the real-time broker feed (extended-hours aware), and set the left sidebar to start collapsed.

### NQU toolbar quote + dropdown (`components/dashboard/NquQuotePill.tsx` — new)
- Inline NQU quote styled like the existing SPX/ESU/VIX tickers (label + price + `+chg (+pct%)` on the left), with a right-aligned sparkline, placed next to SPX with a divider.
- Clicking the price opens a portal dropdown of the watchlist sorted **highest→lowest gainer**. Each row: label + price on line 1, `+/-` change and `+/-%` on line 2, a right-aligned sparkline + **EXT/REG** badge, with a faint gradient divider between rows.
- Dropdown excludes **ESU, NQU, and VIX** (NQU still drives the main pill). Row fonts nudged up.
- **REG/EXT label** is computed from the live ET clock (REG = 09:30–16:00 ET, EXT everything else), re-checked every 30s, so it flips at 4pm immediately without waiting on data.

### Home toolbar (`app/home/page.tsx`)
- Removed the "SPX / GEX" text label; moved the **clock to the start** of the top-right toolbar; kept VIX/ESU/SPX; added `<NquQuotePill />` inline after SPX.

### Quotes API spark series (`app/api/quotes-batch/route.ts`)
- Added `?spark=1` → returns a downsampled (~24-pt) intraday close series per symbol for the sparklines, plus a `session` field.
- Sparkline window **resets at 09:30 ET and 20:00 ET** (DST-aware boundary math); REG/EXT classification is separate (REG = 09:30–16:00 ET).

### Broker (Tastytrade) after-hours quotes
- `server-v2/proxy-tastytrade.js`: new `fetchUnderlyingQuotes()` — batched `/market-data/by-type` per class (equity/index/future) returning `last`/`mark`/`close`/`prev-close` (update in extended hours). Futures resolve the **front active contract by product code** via new `resolveFrontFutureTtSymbol()` — fixes the `No streamer-symbol for future /NQU26` error (TT uses `/NQU6`, not the synthetic `/NQU26`).
- Futures price prefers **last trade** (matches TradingView) over mark/mid.
- TEMP manual prev-close override `FUT_PREVCLOSE_OVERRIDE = { NQ: 30719.75 }` for the holiday (no-settle) baseline — **remove after the next clean settle** (TODO in code).
- `server-v2/server-with-proxy.js`: new `GET /proxy/quotes?symbols=` route. New Next forwarder `app/api/tt-quotes/route.ts`.
- Pill fetches broker + Yahoo in parallel: broker drives price + baseline (4pm close in EXT, prior close in REG); Yahoo drives the sparkline; falls back to Yahoo if the broker is dark.

### Sidebar (`components/shared/Sidebar.tsx`)
- **Collapsed by default.** Only an explicit saved preference (`"0"`) expands it on load.

### Open follow-ups
- Remove `FUT_PREVCLOSE_OVERRIDE` once a clean CME settle prints.
- AH **sparkline** is still Yahoo (delayed ~15m); only price/change are broker real-time.
- Not type-checked this session — the Linux sandbox was unavailable (`HYPERVISOR_VIRT_DISABLED`); verified by inspection. Run a build / `/push` to confirm.

---

## 2026-06-21 (session 39) — Thor-style sidebar restyle + quotes removed

Rebuilt the dashboard sidebar (`components/shared/Sidebar.tsx`) to match the supplied "Thor" reference, themed with `HOME_THEME`. No changes needed to `LayoutShell.tsx`.

### Sidebar redesign (`components/shared/Sidebar.tsx`)
- **Expanded (240px):** logo + `SPX / GEX` wordmark, labeled nav rows. Multi-item groups (Gex, Stock Market, Personal, Dev) are now expandable accordions with a nested left-rail item list; the active group auto-opens. Single-item groups (Footprint) render as direct links. Active route shows as a solid cyan pill.
- **Collapsed (76px):** icon-only rail with dark hover-tooltip pills (caret); multi-item groups get a hover flyout of their items; social row collapses to a single `⋯` button that fans out on hover.
- **Collapse toggle** ("Collapse Sidebar" row) above the socials, persisted to `localStorage` (`sidebar-collapsed-v1`). `mounted` guard avoids hydration mismatch on the stored width.
- **Socials:** Telegram, Twitter, Discord, Reddit added with `href="#"` placeholders.
- Replaced emoji group buttons + flyout-portal nav with inline SVG icons (placeholders pending user's icon swap).
- Preserved: all routes, `NAV_GROUPS`, drag-reorder + `sidebar-nav-order-v1`, Clerk `UserButton`, dev-only gating.

### Quotes removed
- Deleted the live quotes ticker: the `Quotes` JSX section, `useSidebarQuotes` hook + call, `QUOTE_SYMBOLS`, and all quote helpers (`quoteNumber`, `normalizeSym`, `rawNum`, `pctFromQuote`, `fmtPct`). A flex spacer now pushes the footer to the bottom.

### Notes
- `tsc` not run this session (Linux sandbox unavailable: `HYPERVISOR_VIRT_DISABLED`); types reviewed manually against `strict`. Run `npx tsc --noEmit` / `npm run dev` to confirm.

## 2026-06-21 (session 38) — GEX chart line cleanup + GEX-flip profile aligned to reference formula

Removed two stray vertical lines from the Net GEX chart, then reworked the GEX-flip profile math to match the canonical SqueezeMetrics/perfiliev formula and respond to the OI+Vol / Vol Only toggle.

### Net GEX chart line removal (`components/dashboard/GexChart.tsx`)
- Removed the **zero-crossing shading** band — a faint-orange 3px `fillRect` drawn at the first net-GEX sign change (rendered as a stray full-height vertical at ~7,435). Deleted both the `fillRect` draw and the now-unused `zeroCrossX` scan loop. (Was hard to trace because it was a `fillRect`, not a stroked line; identified by hooking the live canvas context and dumping draw calls.)
- Gated the **GEX-flip vertical marker** behind the `showFlipCurve` toggle. Previously it drew on every 0DTE view regardless of the `+ GEX Flip` button state (guard was `is0DTE && flip…`, now `showFlipCurve && is0DTE && flip…`).

### GEX-flip profile math (`lib/calculations/calculations.ts` — `computeGEXProfile`)
- Aligned the spot-sweep profile to the reference script: **60 levels** over **0.8×–1.2× spot** (was 401 over 0.75×–1.25×).
- Trading-day annualization: `T = dte/262`, 0DTE floored to `1/262` (was `dte/365`, floored `1/252`).
- Flip point now the **first** (lowest-strike) interpolated zero crossing via `posStrike − (posStrike−negStrike)·posGamma/(posGamma−negGamma)` (was nearest-to-spot).
- GEX formula set to `Σ BS_gamma(P,K,IV,T) × contracts × 100 × P²` — dropped the `× 0.01` "per 1% move" factor (constant scale; does not move the flip, makes the curve 100× taller, auto-fit by the chart's independent profile scaling).
- **Mode-aware contracts:** new `dataMode` param (`"oi-vol" | "vol-only"`). OI+Vol uses `OI + volume`; Vol Only uses `volume` only. Both the profile curve and the flip point now shift with the toggle. Wired through from `app/home/page.tsx` (`computeGEXProfile(chartRows, chartSpot, dataMode)`).
- Note: ChainRow carries no expiration date, so the reference's Ex-Next / Ex-Monthly series are omitted (neither is plotted).

### Home header total net GEX (`app/home/page.tsx`)
- Rewrote `netGexLive` to match the **Insights → Exposure Stack** definition: full chain, `contracts = OI + volume`, `(callGamma·callContracts − putGamma·putContracts) · spot² · 0.01 · 100`, in $B. (Was windowed `netGEX + netVolGEX`.) **Verify the header formatter expects $B units.**

### Open follow-ups
- `findGEXFlip` (the fallback flip source) is not yet mode-aware.
- `app/mobile/page.tsx` calls `computeGEXProfile` without passing `dataMode` (defaults to `oi-vol`, won't switch with its toggle).

---

## 2026-06-21 (session 37) — Toolbar ESU price/day-change fix + DB pool reconnect hardening

Fixed the Overview top-bar **ESU** quote (wrong day-change %, flicker, off-grid price) and hardened the Postgres writers against a connection-drop log-spam loop.

### ESU live price — single source, on-grid (`server-v2/proxy-tastytrade.js`, `components/shared/TopBar.tsx`)
- TopBar now sources ESU **only** from the `/ws/gex` broker feed (`esFut` / `esFutPrevClose`); removed the Yahoo `quotes-batch` seed and the vanilla-app `prevCloses_v3` cache seed for ES (both caused a wrong-scale flash + flicker).
- `esFut` reduced to a **single server-side writer**: the live ES Quote/Trade is published as the **last trade clamped into the current bid/ask**, snapped to the **0.25 tick** (`_publishEsFut`). Removed the competing candle-close writer and the raw Quote-mid writer that fought it. Client also snaps defensively in `pushPrices`.

### ESU day-change baseline = CME official settle (`server-v2/proxy-tastytrade.js`)
- Root cause of the wrong %: the baseline used Yahoo / a stale REST value / the 15:55 candle close (~6pt off settle), and the holiday (Juneteenth 06-19) made the auto-walkback pick the wrong prior date.
- `resolveFrontEsSymbol` now also returns the **TT instrument symbol** (`/ESU6`); the `/market-data/by-type?future=` lookup previously used the dxLink streamer symbol (`/ESU26:XCME`) and returned `items:[]`. With the correct symbol it returns `prev-close=7570.75` (type **Final**, dated 06-18) — matching TradingView.
- Baseline priority: **REST Final settle** (`_esRestSettle`) → dxLink Summary settle → candle 15:55 close (fallback only). Added an hourly `_refreshEsSettle` so the baseline self-updates across the ~5–6pm ET settlement rollover without a restart.
- Candle-derived baseline retains the holiday/weekend skip (`ES_NON_SETTLE_DATES`) and 15:55-settle logic as the last-resort fallback. Empty `ES_MANUAL_BASELINE` map left in place for future holiday overrides.

### DB pool reconnect hardening (`state/es-candle-writer.js`, `state/last-event-store.js`, `state/footprint-writer.js`, `state/gex-history-writer.js`)
- Postgres restarting (recovery mode) triggered `Cannot use a pool after calling end on the pool` spam: the error-recovery regex didn't match the ended-pool / recovery messages, so the cached pool was never rebuilt and every write hammered the dead pool.
- Widened the recovery regex in all four writers to also catch `after calling end`, `recovery mode`, `not yet accepting`, `cannot use a pool` → pool is nulled and rebuilt on the next call. Added a **5s throttle** on the "DB unavailable, will reconnect" warning so a draining backlog can't flood the console.

### Tooling
- Added `scripts/esu-price.ps1` — reads `/proxy/snapshot` to print live ESU price + prior settle + day-change (matches the toolbar).
- Diagnostic logs left in `[FEED] ES REST prev-close=…` (concise) for monitoring the baseline source each session.

## 2026-06-21 (session 36) — Footprint page: filter, order feed, sessions, persistence, pan/zoom

Major buildout of the Footprint (Big Orders) page plus durable ES footprint persistence. Version bumped to `2026.6.21-v30`.

### Min-size filter (`app/footprint/page.tsx`)
- Added a **Min order size** slider (1–100, default 1) that visually filters which prints render in the bubbles, delta lane, and order feed. Raw feed data is untouched (`rawTrades`/`rawDelta` preserved); the delta lane rebuilds from filtered prints when the filter is active.
- Lowered server floor `ES_BIG_TRADE_MIN` 25 → 1 so all prints reach the page (slider does the filtering).

### Rolling order feed (`app/footprint/page.tsx`)
- New **Order Feed** below the lanes: collapsible, scrollable (max 320px, capped 500 rows), newest-first, color-coded buy/sell with time/side/price/size.
- **Raw / 1s** toggle: 1s mode combines same-side prints within each 1000ms window into one row (`×N` count badge), aggregating from raw prints then filtering combined size.
- Page root made `overflow-y-auto` so the feed is reachable.

### Two trading sessions for stat cards (`app/footprint/page.tsx`)
- Net Delta / Buy / Sell / Biggest Print now reflect **only the current session**: Day 9:30–17:30 ET or Overnight 18:00–9:30 ET (wraps midnight); 17:30–18:00 dead zone excluded. Colored session badge added.
- **Biggest Print** card follows the feed's Raw/1s toggle (shows "Biggest Order (1s)" with combined size in agg mode) via a shared `aggregatePrints` helper.

### Bubble sizing (`app/footprint/page.tsx`)
- Fixed compressed bubble scaling (minR 0.35→0.08 of max) so small minutes render small.
- Added **net / total** metric toggle on the Bubbles lane (default net, which matches the Delta Profile bar). Per-minute session maxima computed for both metrics from filtered prints.

### Delta Profile hover (`app/footprint/page.tsx`)
- Added the same hover tooltip as the Bubbles lane (buy/sell/net/total per minute), full-column hit area.

### Pan + zoom + 60-min window (`app/footprint/page.tsx`)
- Window widened 30 → 60 min default; `windowMs` is now state.
- **Mouse-wheel zoom** of the time axis (5 min–8 hr), cursor-anchored, via a **non-passive native wheel listener** (React's passive `onWheel` ignored `preventDefault`). Drag-to-pan unchanged. Live window-size label.
- All page fonts set to solid white.

### Footprint persistence (`server-v2/proxy-tastytrade.js`, `server-v2/state/footprint-writer.js`, `lib/db.ts`)
- Retention changed from fixed-count caps to **time-based (current session day)** with day-rollover reset; high safety ceilings only.
- Footprint mirrored to **Postgres** (`es_footprint` table, one JSON blob/day) AND a local disk file. On boot, restore prefers Postgres (today's row) then falls back to the file — so any machine on the same `DATABASE_URL` resumes the session. Restore runs before the live feed connects to avoid an empty-buffer race.
- New `footprint-writer.js` (lazy pool, no-op without `DATABASE_URL`, reconnect-on-error with throttled warning).

### Diagnostics (`server-v2/proxy-tastytrade.js`)
- Added `[ES-DIAG]` logging of raw ES Trade sizes (running max + every print ≥50 with raw fields) to investigate why large MotiveWave prints (e.g. 300-lot) aren't reaching the dashboard — suspected dxFeed `Trade`-event conflation (`acceptAggregationPeriod: 1`); candidate fix is subscribing to `TimeAndSale`. **Open / unresolved.**

## 2026-06-21 (session 35) — Owner dashboard control surface, maintenance mode, Render sparklines

Turned the owner dashboard from monitor-only into a control surface, added maintenance mode, and made the metrics cards responsive. Version bumped to `2026.6.21-v29`.

### Owner control surface (`app/dev/owner/page.tsx`, `server-v2/server-with-proxy.js`)
- New **Controls** section (placed under the Database · Today cards) with toggles and action buttons, each showing transient busy/result state.
- Toggles: **Idle Mode** (feed pause/resume), **MVC Auto (5m)**, **Maintenance**.
- Actions: **Reconnect Feed**, **Run EOD GEX now**, **MVC Snapshot now**, **Redeploy (Render)** — reconnect & redeploy double-confirm.
- New `/proxy/*` routes: `reconnect`, `eod-gex-run`, `mvc-snapshot`, `mvc-auto` (GET/POST), `redeploy` (needs `RENDER_DEPLOY_HOOK_URL`), `maintenance` (GET/POST).
- `proxy.reconnect()` added (stop + reset idle + start). `collectEodGex(base,{force})` bypasses the 3:55–4:05 ET window and returns `{date,saved[]}`. `collectOnce(base,{manual})` returns a result; MVC auto gains runtime on/off (`setMvcAutoEnabled`/`isMvcAutoEnabled`).

### Idle toggle moved off the sidebar (`components/shared/Sidebar.tsx`)
- Removed the cogwheel Settings menu, `SettingsIcon`, and all idle state from the sidebar (UserButton remains). Idle now lives in the dashboard Controls.

### Maintenance mode (`middleware.ts`, `app/maintenance/page.tsx`, `server-v2/server-with-proxy.js`)
- Owner-toggled gate: when ON, middleware redirects non-owner users to a branded `/maintenance` page; owner (`OWNER_USER_ID` env, trimmed) bypasses. Flag held in the proxy (`/proxy/maintenance`, default from `MAINTENANCE_MODE` env), read by middleware with a 5s cache. Falls back to "any signed-in user" if `OWNER_USER_ID` is unset, to avoid self-lockout.

### Responsive metric cards + sparklines (`app/dev/owner/page.tsx`, `app/api/render-metrics/route.ts`)
- System / Render / Database card rows forced to a single row (`repeat(N, minmax(0,1fr))`) that shrinks with the window; fonts/padding now use container-query units (`cqw` + `clamp`) so text scales down instead of wrapping.
- Render route emits a downsampled `spark[]` for bandwidth, memory, and CPU; new inline `Sparkline` SVG renders a trend area in each card (flat line for a single point; live bandwidth pulls a wider 6h series since 1h is too coarse).

### Version card now live (`next.config.js`, `app/dev/owner/page.tsx`)
- `NEXT_PUBLIC_APP_VERSION` injected from `package.json` at build time; the Version card reads it instead of a hardcoded string, so `/push` bumps now show on redeploy.

## 2026-06-21 (session 34) — Header readability, ESU baseline fix, candle flush cadence

Three targeted fixes to the home dashboard header and ES feed.

### Header strip readability (`app/home/page.tsx`)
- NET GEX / CALL WALL / PUT WALL / FLIP / MVC strip was hard to read (small font, esp. the green NET GEX value).
- Labels bumped `clamp(8px,0.78vw,11px)` → `clamp(10px,0.95vw,13px)`; values `clamp(10px,1.05vw,15px)` weight-700 → `clamp(13px,1.3vw,18px)` weight-800.

### ESU day-change baseline (`server-v2/proxy-tastytrade.js`)
- ESU change % was inaccurate on the Sunday-evening reopen: `esFutPrevClose` was set only once from TT's REST `prev-close` at connect, which lags a session.
- The live dxLink `Summary.prevDayClosePrice` for the ES symbol now updates `esFutPrevClose` — the exchange's official prior-session settle (= Friday's settle on a Sunday reopen). `setAux` already allows the live value to overwrite the stale REST one.

### ES candle flush cadence (`server-v2/proxy-tastytrade.js`)
- The 5s `_flushEsCandles` timer (hardcoded ×2) is now a `CANDLE_FLUSH_MS` constant, default 10000ms, env-tunable. Halves the live-candle delta broadcast rate while keeping the forming bar accurate (still aggregates every tick).

## 2026-06-21 (session 33) — Bandwidth leak hunt: subscriber-first REST, candle delta, reconnect leak

Version bump: `2026.6.21-v20` → `2026.6.21-v22`.

Investigated high bandwidth usage. Root cause was **duplicate upstream traffic**, not a security leak: REST-path pages each re-fetched from Tastytrade instead of reading the already-running subscriber, and the ES candle WS push re-sent the full 600-bar array every 5s to every tab.

### Subscriber-first chain/marks serve (`server-v2/proxy-tastytrade.js`, `server-with-proxy.js`)
- New `serveChainFromLive(ticker, expiration)` and `serveOptionMarksFromLive(occSymbols)` on `TastytradeProxy` — rebuild the nested chain / marks payloads from the live subscriber maps (`quotes`/`greeks`/`summaries`/`restOI`/`volumes`/`spot`), byte-compatible with `fetchChainFull` / `fetchOptionMarks`.
- All-or-nothing coverage guard: serves live ONLY for the subscribed SYMBOL, active expiry, in-window strikes, warm feed, every leg present — else returns null → REST fallback unchanged. No blank strikes, no mixed staleness.
- Wired into `/proxy/api/tt/chains/:ticker` and `/proxy/api/tt/option-marks` (try live, fall back to REST). Response carries `context`/`source: "live"|"rest"`.
- Confirmed working on dev: `/api/chains?ticker=SPX` → `live`.
- Added `CHAIN_LIVE_DEBUG=1` gated logging to report which guard sends a request to REST.

### Chain cache (`server-v2/proxy-tastytrade.js`)
- `REST_CHAIN_TTL_MS` 60s → 10 min (env-tunable). The ~30k-contract SPX chain structure rarely changes intraday; per-strike data is pulled separately and fresher.
- Added in-flight coalescing (`_restChainInFlight`) so concurrent cold-cache misses for the same ticker share one upstream fetch.

### ES candle delta broadcast (`server-v2/proxy-tastytrade.js`, `state/market-state.js`, `websocket-server.js`)
- Was re-sending all 600 bars every 5s to every tab; only the forming bar (±a just-closed one) actually changes.
- Track changed slot keys (`esCandlesDirtySlots`); flush writes the full array via new `setStateSilent` (no `change` emit, backs the connect-time snapshot) and broadcasts only moved bars as `esCandlesDelta`, re-typed as an `esCandles` message so the client's existing slotKey merge ingests it with zero client change.
- ~99% cut on this stream. New tabs still get full history via connect snapshot.

### `useTastytradeStream.ts` reconnect leak (dormant hook)
- Cleanup only closed the socket but never cancelled the pending `setTimeout(connect)`, so unmount spawned a self-perpetuating reconnect loop (each iteration a new WS + TT OAuth round-trip).
- Added `unmountedRef` guard, reconnect timer ref cleared on cleanup, handlers nulled before close, exponential backoff (3s→30s), post-await unmount check. Matches the safe `/ws/gex` hook pattern.

### Pre-existing tsc errors cleared (unrelated to this work)
- `app/trading/page.tsx`: removed duplicate `flex`/`minHeight` keys in a style literal.
- `components/dashboard/EmCustomer.tsx`: widened `data` state to `Partial<Levels> | null` to match the zones-only fallback payload. `npx tsc --noEmit` now clean.

### GEX rows delta — deferred
- Considered applying the same delta to the 2s GEX broadcast; deferred. GEX changes many strikes per recompute (smaller, riskier win) and the client read-path needs verification first. Measure bandwidth post-deploy before revisiting.

---

## 2026-06-21 (session 32) — Owner page: "EM Grabbed" timestamp on Levels Publish panel

Added an **EM Grabbed** field beside **Last Published** in the Levels Publish · /em feed panel (`app/dev/owner/page.tsx`), so the owner can see when the EM/straddle data was actually captured — distinct from when the publish job ran.

- `levels` state extended with `emGrabbed: string | null`.
- `/api/levels` fetch now derives the newest `em_updated_at` across all rows (alongside the existing `updated_at` → `lastRun`).
- New "EM Grabbed" column renders `fmtLastRun(levels.emGrabbed)` next to "Last Published".
- Verified `/api/levels` GET (`SELECT *`) returns `em_updated_at`; column exists, is back-filled, and only advances when `em` actually changes — so "EM Grabbed" reflects the true capture time, not the publish time.

---

## 2026-06-21 (session 31) — EM Freeze Guard, Snapshots → Postgres, Backend Table = Frozen Source

Version bump: `2026.6.21-v18` → `2026.6.21-v20`.

### Weekly EM freeze guard (`app/api/levels/route.ts`)
- The customer-facing weekly `em` is now write-once per week. `em`/`close`/`up`/`down` only change when the supplied `em` is non-null AND the caller is either the trusted publisher (`x-internal-token` === `INTERNAL_API_TOKEN`) OR the row has no `em` frozen since this week's Saturday-09:00-ET boundary.
- Added `lastSaturday9amET()` helper to compute the freeze boundary; passed as `$13` (trusted) / `$14` (weekStart) into the upsert.
- Fixes the 128 → 105 → 95 drift: the backend dashboard's live recompute can no longer overwrite the Saturday-9am value. Zones/pivot/labels still refresh freely.

### Snapshots moved from IndexedDB → Postgres (`app/api/snapshots/route.ts`, `[id]/route.ts`, `components/dashboard/EstimatedMoves.tsx`)
- New `em_snapshots` table (JSONB `payload` + promoted `view`/`ts`/`date`/`time`/`period` columns). Route rewritten: GET (list, `?view=` / legacy `?period=`), POST (save), DELETE (`?id=`).
- Component `dbSaveSnapshot`/`dbGetAll`/`dbDeleteSnapshot` helpers now fetch the API instead of IndexedDB; `dbRef` is a vestigial ready flag.
- One-time `migrateLegacyIndexedDb()` lifts any remaining IndexedDB snapshots into Postgres (localStorage `em_snapshots_migrated=1` guard).
- `[id]` DELETE now tries `em_snapshots` then legacy `snapshots`; legacy `estimated-moves.js` still works via the rewritten route.

### Backend Estimated Moves table = frozen source
- Estimated view now loads the frozen `/api/levels` rows (`loadFrozenLevels()`) on mount and on Refresh — no live recompute, and the backend no longer pushes `em` to `/api/levels` at all (publisher owns it exclusively).
- Added an owner-only **Compute Live** button (inspection only; never writes), and a toolbar **Source** chip: "Weekly publish — &lt;timestamp&gt; ET" (from `em_updated_at`) or amber "Live (not saved)".

### Backend table column cleanup
- Removed the **vs 4-Wk** and **vs 12-Wk** columns from the backend Estimated Moves table (headers + cells); dropped the now-dead `tickerStats` state, `TickerEmStats` type, and per-ticker stats fetch. Customer `/em` page's historical-average display is unchanged.

## 2026-06-21 (session 30) — Landing Page: X Follow Button + Feature Copy

Updated the public landing page (`components/landing/LandingClient.tsx`).

### X follow button
- Added a clickable X (Twitter) logo button linking to `https://x.com/bzilatrades` (opens new tab).
- Positioned absolute in the card's top-right, aligned to the "Launching soon" badge line and card padding (`clamp(24px, 4vw, 40px)`); 30×30, same glass style as the sign-in button.
- Glows cyan on hover (React `xHover` state — inline styles can't use `:hover`), with a smooth color/border/box-shadow transition.

### Feature grid copy
- Box 2: replaced "Options flow tape" with "Confidence Score" — each key level scored 0–100 for Hit/Pivot/Chop, live positioning blended with historical analogs.
- Box 4: "Estimated moves" reworded to weekly estimated-move levels with high-confidence zones, backed by 2+ years of historical data and results.

Version bumped to `2026.6.21-v17`.

## 2026-06-21 (session 29) — EM Weekly Publisher: Stop Re-runs + Retry Not-Found Only

Fixed the Estimated-Move weekly publisher re-running on restarts (overwriting the good Saturday-9am snapshot with worse mid-week/weekend numbers, which made the "not found" list appear to grow). Added per-ticker failure reasons and a manual "retry not-found only" path.

### Stop unwanted re-runs (`server-v2/levels-auto-publish.js`)
- Root cause: the once-per-week guard (`lastPublishedWeek`) was in-memory only, so any server-v2 restart reset it and the Sat/Sun poll re-published.
- Persist the published-week key to disk (`server-v2/.levels-last-week`), seeded on startup, so restarts remember the week was already published.
- Sunday branch documented as catch-up only (shares the week key with Saturday, so once Saturday publishes the guard blocks Sunday).

### Per-ticker failure reasons (`server-v2/levels-engine.js`)
- `computeAllLevels(base, opts)` now accepts `opts.only` (subset roster for retries) and returns `{ payloads, failReasons }`.
- `failReasons` maps each failed ticker to why it failed (no quote / no options / straddle unpriced, etc.). Zones + em_tracker seeding skipped on subset retries.

### Retry not-found only (`server-v2/levels-auto-publish.js`, `server-v2/server-with-proxy.js`)
- `publishOnce(base, reason, opts)` consumes reasons; `failedEm` is now `[{ ticker, reason }]`. Subset retries MERGE into the prior run — fixed tickers drop off, still-failing ones refresh their reason, `emOk/emTotal` stays against the full roster.
- New `POST /proxy/levels-retry-failed` route recomputes ONLY the last run's not-found tickers.

### Owner page (`app/dev/owner/page.tsx`)
- Not-found list shows each ticker with its reason; added "↻ Retry not-found only" button. Backward-compatible with the legacy `string[]` shape via `normFailedEm`.

### Misc
- **`.gitignore`** — ignore `server-v2/.levels-last-week`.

## 2026-06-20 (session 28) — CB Edge Rebrand + Landing Card Polish

Rebranded the app from **BzilaTrades** to **CB Edge** ("Real Edge — Real Orderflow") and refined the landing card to the dark glassmorphic + cyan-accent theme.

### Rebrand (sitewide)
- **`app/layout.tsx`** — metadata title → "CB Edge Dashboard", description updated with tagline.
- **`.env.local`** — `NEXT_PUBLIC_APP_NAME=CB Edge`.
- **`components/shared/Navbar.tsx`** — logo `src` → `/cb-edge-logo.png`, alt + wordmark → "CB Edge".
- **`components/shared/TopBar.tsx`** — logo `src` → `/cb-edge-logo.png`, alt → "CB Edge".
- **`components/dashboard/EmCustomer.tsx`** — kicker → "CB Edge".
- **`components/landing/LandingClient.tsx`** — fallback `APP_NAME` → "CB Edge".

### Landing card polish (`components/landing/LandingClient.tsx`)
- Stronger glass: gradient fill, 22px blur, cyan-tinted border + inset highlight, layered shadow.
- Radial cyan→purple accent glow bleeding through the top of the card.
- Accent-tinted feature cells (cyan gradient + cyan border).
- Added CB Edge logo (transparent PNG) as the sole brand element at 88px; **removed** the redundant "CB Edge" `<h1>` title and "Real Edge — Real Orderflow" tagline (logo carries both).

### Notes
- Logo file: `public/cb-edge-logo.png` (transparent). `.env.local` change requires a dev-server restart to take effect.
- Version bumped `2026.6.20-v19` → `2026.6.20-v20`.

## 2026-06-20 (session 27) — Glassmorphic UI Theme: Tab Panels, Custom Dropdowns, Card Accents

Continued the glassmorphic dark fintech theme rollout across all remaining pages and embedded tab panels.

### Tab panels themed (`components/dashboard/`)
- **`EconCalendarPanel.tsx`** — Shell bg transparent (embeds cleanly in home card), header `panelBgStrong` + blur, filter dropdown glassmorphic, event rows get horizontal gradient wash from impact color (red/amber/etc.) + inset glow on time column left bar.
- **`SnapshotPanel.tsx`** — Shell bg transparent, `MetricCard` upgraded: `borderTop: 2px solid accent`, radial glow from top, larger value text with `textShadow`. `TopFlowList` same accent treatment with `barColor`. Net Premium sparkline box now `flex: 1` to fill all remaining vertical space; canvas `height: 100%` scales with container.
- **`FlowTape.tsx`** — Root bg transparent, container gets `borderTop: 2px solid cyan` + radial cyan glow from top. Toggle bg `rgba(0,0,0,0.4)`. Live/waiting badge uses rgba colors.

### Home page tab embed fix (`app/home/page.tsx`)
- Added `.tab-panel-embed > div:first-child { background: transparent !important }` CSS — but inline styles beat it. Fix: set `background: "transparent"` directly after `...homeShellStyle` spread in each panel root, overriding the `#05060A` solid bg.

### Custom dropdown (`app/options-chain/page.tsx`)
- Replaced both native `<select>` elements with `CustomDropdown<T>` generic component. Glassmorphic panel: `rgba(13,17,25,0.97)` bg, `blur(20px)`, cyan active item, outside-click close. Accepts `T[] | readonly T[]` to handle both mutable and const arrays.

### Owner dashboard (`app/dev/owner/page.tsx`)
- **Levels Publish · /em feed** section: now auto-collapsed by default (`useState(true)`), wrapped in `homePanelStyle` panel box, clickable header row toggles expand/collapse with border-bottom separator when open.

---


## 2026-06-20 (session 26) — /em Customer Page: Confidence Score, Win Rate Bar, EM vs Historical Avg

Enhanced the customer-facing `/em` page with three new data points surfaced per-ticker lookup, plus UI polish.

### New features (`components/dashboard/EmCustomer.tsx`)
- **MVC Confidence %** — fetches `/api/confidence` after each lookup; shown as a color-coded stat cell (green ≥70%, amber ≥45%, red below) inside the Estimated Move card.
- **EM Hit Rate bar** — fetches `/api/em-tracker` + `/api/em-tracker/history` and merges live DB + historical JSON tally (same logic as the tracker page) so the combined win rate is accurate. Displayed as a pressure-bar: red→green gradient, fills left-to-right by win %, with Miss (N) / Hit (N) labels. Headline reads "X% Hit".
- **vs Historical EM Average card** — new `/api/em/ticker-em-stats` endpoint queries `em_tracker` for the last 4 and 12 weeks of recorded EM values; shows `▲/▼ X.X%` vs each average. Card moved to the bottom of the page (below Buy/Sell Zones).

### New API (`app/api/em/ticker-em-stats/route.ts`)
- `GET /api/em/ticker-em-stats?ticker=X` — returns `recentAvg` (last 4 weeks), `midAvg` (last 12 weeks), `sampleSize` from `em_tracker`.

### UI polish (`components/dashboard/EmCustomer.tsx`)
- Removed pivot row.
- All gray/muted text (`#9fb4cc`, `#7ab8ff`, `#7a92ad`) replaced with white (`#eef7ff`).

---

## 2026-06-20 (session 25) — EOD GEX Recorder + Dashboard Save Status

Added a full EOD GEX pipeline: Postgres table, recorder module wired into server-v2, REST endpoint, and save-status UI in both the owner dashboard and the database page.

### New files
- **`server-v2/eod-gex-recorder.js`** — Polls every 60s; fires during 3:55–4:05 PM ET window (Mon–Fri, market days). $SPX reads totalNetGex + spot from live market-state via `/proxy/gex` (no re-computation). SPY/QQQ fetch chain on-demand via `/api/expirations` + `/api/chains`, then run `computeGexRows()` from `gex-calculator.js`. Data quality guard: skips write if fewer than 20 strikes have non-zero gamma + OI. Upserts (never duplicates) one row per (date, symbol). Lazy PG pool with auto-rebuild on error.
- **`app/api/eod-gex/route.ts`** — `GET /api/eod-gex?date=&symbol=&limit=` returns rows from the `eod_gex` table.

### Modified files
- **`lib/db.ts`** — Added `eod_gex` table DDL to `ensureAllTables()`, `EodGexRecord` interface, `upsertEodGex()`, and `getEodGex()`.
- **`server-v2/server-with-proxy.js`** — Wired `startEodGexRecorder(PORT)` alongside `startMvcAutoSnapshot()`.
- **`app/api/db/route.ts`** — Added `eod_gex: { dateCol: "date" }` to the allowlist.
- **`app/database/page.tsx`** — Added `EOD GEX` as first tab (default); shows date-filtered rows with full table viewer.
- **`app/dev/owner/page.tsx`** — Added `EodGexRow` interface, `eodGex` state, fetch in `refresh()`, `fmtGex()` helper, and "EOD GEX · Today" section showing green/red dot + GEX value + spot + computed-at time for each of $SPX, SPY, QQQ. Updated `TABLES` array to reflect all 9 daily-recording tables (removed `trades`; added `bzila_snapshots`, `bzila_gex_history`, `flow_calls`).

---

## 2026-06-20 (session 24) — Owner Dashboard: collapseable levels section, font & card style polish

### Changed (`app/dev/owner/page.tsx`)
- **Collapseable Levels panel** — added `levelsCollapsed` state + Expand/Collapse toggle button in the "Levels Publish · /em feed" section header; panel body hidden when collapsed.
- **Font size bump** — `SectionLabel` headings `9px → 12px`; stat card labels and DB table card labels `9px → 11px`.
- **Card color accents** — `StatCard` and DB table cards now have a left border + diagonal gradient tint derived from each card's accent color; border/label at ~33% opacity, gradient fades `18→06→transparent` for a light, blended look; value text softened to `dd` alpha.

---

## 2026-06-20 (session 23) — Estimated Moves: SPX/NDX/NQU fixes, 200+ ticker roster, on-demand zones, manual publish

Fixed the Estimated Moves table where SPX/NDX/ESU/NQU showed blank/`--`/"Invalid price". Root causes were strike-centering on the wrong spot (Yahoo ^GSPC ~6000 vs the dashboard's broker SPX ~7500) and intolerant quote lookups. Then expanded the customer `/em` feed from ~20 to a 200+ ticker roster (EM pre-published weekly, zones computed on demand), added a manual publish trigger with results UI, and stale-EM flagging.

### Fixed (Estimated Moves / levels)
- **`server-v2/proxy-tastytrade.js`** — strike walk now centers on the broker chain `underlyingPrice` (added `chainUnderlyingPrice`), not the Yahoo quote. SPX/NDX strikes are denominated in the broker scale (~7500); Yahoo gave ~6000 so the ATM straddle never matched. Reverted an incorrect `index-option[]` by-type param guess — TastyTrade REST has NO `index-option[]`; SPX/NDX options price under `equity-option[]` (params: index[], equity[], equity-option[], future[], future-option[], cryptocurrency[]).
- **`components/dashboard/EstimatedMoves.tsx` + `server-v2/levels-engine.js`** — tolerate null Yahoo quotes for indices AND the NQ future (recover spot from chain underlyingPrice; futures fall back to a zero basis); guarded the proxy-index second quote call (was throwing "Invalid price for NDX, NaN" on NQU); capped the ATM strike walk at 8 nearest strikes (killed a per-strike `option-marks` request storm + multi-second refresh); only refetch option-marks when a leg has no usable price.
- **`server-v2/proxy-tastytrade.js`** — added `fetchOptionMarks` + `/proxy/api/tt/option-marks` adapter (was 404ing every per-strike fallback call).
- **`app/api/levels/route.ts`** — added `em_updated_at` column (advances only on a fresh EM) so stale EMs are detectable; fixed `$4::text` cast (Postgres "could not determine data type" on null em).

### New (200+ roster + on-demand zones + manual publish)
- **`server-v2/em-tickers.js`** — roster lives here now (`EQUITY_TICKERS`, ~370 names, deduped). `SYMBOLS` imported by the engine; `ZONE_SYMBOLS` = core set pre-published with zones.
- **`app/api/em-zones/route.ts` + `/proxy/api/tt/em-zones`** — on-demand Buy/Sell zones for any ticker (static for the week from last week's OHLC), cached to `ticker_levels` (NULL-aware, never clobbers EM). `EmCustomer.tsx` fetches zones when a looked-up ticker has EM but no zones (or no row at all).
- **`server-v2/levels-auto-publish.js`** — removed startup publish (was overwriting the weekend snapshot on every restart); levels now publish Sat ~9am ET only and hold Mon–Fri. Added manual `/proxy/levels-publish` (fire-and-forget) + `/proxy/levels-status`; `publishOnce` returns a run summary (emOk/emTotal, posted, failedEm).
- **`app/dev/owner/page.tsx`** — "Publish Now" button (double-confirm) with live "Publishing…" state, last-run result row (EM coverage, rows, duration, time), "No EM priced" failed-ticker list, and orange STALE-EM chips for tickers serving a carried-over value.
- **`server-v2/em-tickers.js`** chunked the quotes-batch call (40/req) so a 200+ roster doesn't blow the URL length.

### Notes
- Workspace Linux sandbox was DOWN all session (HYPERVISOR_VIRT_DISABLED) — no `node --check`/git run from the assistant side; user restarted + tested. SPX/NDX/NQU confirmed working by the user.
- First load / re-publish: hit **Publish Now** on `/dev/owner` (or `POST /proxy/levels-publish`); ~370 tickers take a few minutes.
- Leftover: one-time `[CHAIN-MD DEBUG]` log line still in `proxy-tastytrade.js` (logs once per by-type param) — safe to remove.
- `BRK.B` may need `BRK-B`/`BRK/B`; `SPCX` unverified (possibly meant `SPCE`) — illiquid/invalid names just won't get a row.

## 2026-06-20 (session 22) — v2 dashboard audit, two bug fixes, build verified, legacy removed

Box-by-box static audit of every page linked in the v2 sidebar. Found and fixed two real bugs, verified a clean production build (`✓ Compiled successfully`, 78/78 pages, no TS/ESLint errors), and removed the deprecated Legacy section.

### Fixed
- **`app/economic-calendar/page.tsx`** — `load()` never fetched; the event list was permanently empty ("No events match"). Wired it to `GET /api/calendar`, added a separate non-blocking warning banner (so a stale-feed fallback no longer hides loaded events).
- **`app/changelog/page.tsx`** — `readFile(CHANGELOG.md)` had no error handling and would 500 if the file were ever missing/gitignored. Wrapped in try/catch with fallback text.

### Removed
- **`app/legacy/`** (index page + `view/[page]/route.ts`) — deprecated vanilla-site archive, slated for removal. Deleted, plus its nav entries in `components/shared/Sidebar.tsx`, `components/shared/TopBar.tsx`, and `app/dev/owner/page.tsx` (NAV_GROUPS copy).

### Notes
- Build verified clean locally this session (`next build`, Next 15.5.19). Render deploy path (`npm ci && npm run build`) should pass; confirm `CHANGELOG.md`, `app/api/econ-calendar/events.json`, and `package-lock.json` are committed.
- Audit report written to `AUDIT-v2-2026-06-20.md` (root). Minor non-blocking items logged there: `/dev/admin` is mock data, hardcoded version string on `/dev/owner`, `{cat.spent}` label on `/trading`, `/premarket` WS not wired (runs on Yahoo).

## 2026-06-20 (session 21) — EM Tracker: win/loss record, Saturday auto-eval, Discord OCR backfill

Built an Estimated-Move win/loss tracker keyed to the rule **close inside the EM band = win, outside = loss** (close-only). Seeded the verified 31-week history, added a Saturday 9am auto-evaluator that scores each completed week from weekly OHLC, and a Discord OCR pipeline to backfill ~2 years of weekly EM boards (91 weeks captured) with a review/confirm UI.

### New
- **`app/api/em-tracker/route.ts`** — list/summary GET (+ `week_start&status=pending`), upsert/seed POST, set-result, and DELETE with `?all=1` / `?source=` bulk reset. `computeResult` lives in `lib/em-tracker/computeResult.ts`.
- **`app/api/em-tracker/evaluate/route.ts`** — "Evaluate Now" + manual OHLC backfill; runs the server-v2 engine via a webpack-safe runtime require (`eval("require")`, `runtime="nodejs"`).
- **`app/api/em-tracker/commit-history/route.ts`** — commits reviewed historical bands and scores them against weekly OHLC (breach + close-inside win).
- **`app/api/em-tracker/discord-preview/route.ts` + `history/route.ts`** — serve the OCR preview and the verified 31-week tally (`data/em-tracker-history.json`).
- **`components/dashboard/EmTrackerAdmin.tsx`** — EM Tracker UI: per-ticker hit-rate table, per-week detail (band/close/Δedge/breach/result), add-week form, Discord review panel (roster-driven rows, red OCR flags, orange blanks, cyan auto-repaired dropped-decimals, editable ticker for futures rolls, per-week + bulk commit, reset).
- **`scripts/import-em-from-discord.mjs`** — reads the EM channel history (no privileged intent needed), OCRs boards (tesseract.js), parses title date + ticker/up/down (last-two-numbers, EU decimal handling, ticker fuzzy-resolve), `--limit`/`--debug`, writes `data/em-discord-preview.json`.
- **`server-v2/em-tracker-auto-eval.js`** — Saturday ~9am ET in-process evaluator (mirrors levels-auto-publish); wired in `server-with-proxy.js`.

### Added
- **`server-v2/levels-engine.js`** — `evaluateCompletedWeek`, `evaluateHistoricalWeeks`, `seedUpcomingWeek`, `fetchWeeklyOhlcMap`.
- **`lib/db.ts`** — `em_tracker` table (keyed `UNIQUE(ticker, week_start)` so multi-year weeks don't collide), `breach` column + migration, and helpers (upsert/summary/pending/clear/ohlc).
- **`server-v2/levels-auto-publish.js`** — seeds the upcoming week's EM band after each publish.
- **`package.json`** — added `tesseract.js`.

### Notes
- Build not run this session (sandbox unavailable) — run `npm run build` before deploy.
- 91 Discord weeks captured and pending review/commit in the EM Tracker tab.

## 2026-06-19 (session 20) — Unify MVC across chart, top-bar, and snapshot

Fixed the long-standing mismatch where the purple top-bar MVC (e.g. 7,550) disagreed with the on-chart MVC label (e.g. 7,500). Root cause: three independent computations using different metrics/data sources. Settled on a single source of truth — **largest |netGEX| only** — so the chart label, purple top-bar value, and Save/Now snapshot all agree.

### Changed
- **`components/dashboard/GexChart.tsx`** — MVC peak now selected from the full raw `chain` by `|netGEX|` (was densified+windowed `data` respecting `dataMode`/call-put). Label is hidden when the peak strike is outside the visible window (`peakIdx < 0`).
- **`app/home/page.tsx`** — `mvcStrike` now uses `|netGEX|` only (dropped the `netGEX + netVolGEX` composite and the Vol-Only branch); removed `dataMode` from its deps. Also coerced `chartRowByStrike.get(Number(row.strike))` to fix a string/number key TS error.

### Added
- **`lib/em-tracker/computeResult.ts`** — extracted `computeResult` out of `app/api/em-tracker/route.ts` (Next.js route files may not export non-handlers; this resolved the generated `.next/types` TS2344 error). Both `app/api/em-tracker/route.ts` and `app/api/em-tracker/evaluate/route.ts` now import from here.

## 2026-06-19 (session 19) — Disable hover lift on home page data boxes

Removed the dashboard-wide card hover lift/shadow on the home page only; it felt off on that page's dense data boxes. Every other page keeps the effect. Version bumped to `2026.6.19-v3`.

### Changed
- **`app/home/page.tsx`** — added `className="home-no-hover"` to the page's root `<main>`.
- **`app/globals.css`** — added `main.home-no-hover [style*="border-radius:16px"]:hover` override that cancels `transform` / `box-shadow` / `border-color` (resets to `none`/`inherit`), scoping out the auto-applied lift for the home page.
- **`package.json`** — version `2026.6.19-v2` → `2026.6.19-v3`.

## 2026-06-19 (session 18) — Customer `/em` levels page + all-symbol zones + weekend auto-publish

Built a customer-facing Estimated-Move + Buy/Sell-Zone page fed by the existing (now backend) Estimated Moves page via a push→Postgres→pull pipeline, extended No-Short/No-Long zones to all 20 symbols, and added a weekly auto-publisher.

### New
- **`app/em/page.tsx` + `components/dashboard/EmCustomer.tsx`** — customer page: ticker input → `GET /api/levels?ticker=` → renders Estimated Move (Close/EM/Up/Down) + Buy Zone (noShort) + Sell Zone (noLong). Read-only, deep-linkable via `?ticker=`.
- **`app/api/levels/route.ts`** — per-ticker `ticker_levels` Postgres table (NULL-aware upsert like es-stats); GET resolves aliases (ES/`/ES`/ESM/ESU26 → ESU, NQ→NQU).
- **`server-v2/levels-engine.js`** — Node port of `estimateMove` + `fetchNoShortNoLongZones`; calls localhost Next API endpoints so chain/normalization edge cases can't drift. All fetches carry the internal token (`ifetch`).
- **`server-v2/levels-auto-publish.js`** — weekly publisher: **Sat ~09:00 ET** (Sun catch-up + startup run); `weekKeyET` keys to the upcoming Monday. Wired into `server-with-proxy.js` after `listen()`.

### Changed
- **`components/dashboard/EstimatedMoves.tsx`** — zones extended from ES/NQ to all 20 SYMBOLS (`zoneSymbol()` maps futures/index/equity dxLink weekly symbols); `ZoneLevels.ticker` widened to `string`; zones tab is now row-per-symbol; pushes EM + zones to `/api/levels` on Refresh; muted gray/blue text → white.
- **`server-v2/proxy-tastytrade.js`** — added `fetchDailyHistory()` backing the previously-404'ing `/proxy/api/tt/market-data/history/:symbol`; sources **weekly candles from Yahoo Finance** (`interval=1wk`; SPX→^GSPC, NDX→^NDX, ES→ES=F, NQ→NQU). Fixes zones never working on server-v2.
- **`server-v2/server-with-proxy.js`** — history route handler (passthrough of Yahoo weekly bars).
- **`middleware.ts`** — bypass Clerk auth when `x-internal-token === INTERNAL_API_TOKEN`, so in-process jobs reach `/api/*` (they were being redirected to `/` → "Unexpected token '<'" HTML).
- **`.env.local`** — added `INTERNAL_API_TOKEN`.
- **`app/database/page.tsx` + `app/api/db/route.ts`** — added **Levels (/em)** and **ES Stats** tabs (`ticker_levels`, `es_stats`).
- **`app/dev/owner/page.tsx`** — added **Levels Publish · /em feed** panel (last-run time, Current/Stale badge, ticker count, schedule).
- **`components/dashboard/EmCustomer.tsx`** — NEAR/FAR + muted labels → readable white/light-gray; popular chips ES/NQ → ESU/NQU.
- **`components/shared/Sidebar.tsx`** — Est. Move → `/em` (customer); Est. Move (BE) → `/estimated-move`.

### Fixes
- NDX/NQM "Invalid price for NDX: NaN" — `fetchAllQuotes` alias step no longer lets a null `$NDX` row clobber the priced `NDX` row.
- ESU/NQU not showing on `/em` — lookup key mismatch (chip "ES" vs stored "ESU"); fixed via chips + GET alias resolution.

### Verified
- `[levels-pub] published 20/20 tickers`; `/api/levels?ticker=ESU` and `?ticker=ES` both return the full ESU row (EM + zones).

## 2026-06-19 (session 17) — Standardize intensity sliders + heatmap coloring to Multi-Greek format

Unified every Greek heatmap's intensity slider and `metricBg()` coloring to match the **Multi-Greek panel** (the reference standard), so increments and color response are identical across the GEX Heatmap, Options Chain, and mobile views.

### Canonical spec (from `app/mult-greek/page.tsx`)
- **Slider:** `min 0.5 / max 3 / step 0.01`, `width 80 / height 3`, accent `#00e5ff`, 9px label, 10px monospace readout, default `1.75`.
- **Coloring:** rank 1/2/3 → fixed alpha `0.90 / 0.45 / 0.25`; rest → `min(0.18, 0.02 + (ratio × intensity)^1.4 × 0.16)`; blue `rgba(41,182,246,…)` positive / red `rgba(255,71,87,…)` negative.

### Changes
- **`app/home/page.tsx`** (LIVE GEX HEATMAP panel) — replaced divergent `metricBg` (0.82/0.6/0.4 floors, uncapped) with canonical formula; slider 0.1–3 → 0.5–3; default 0.4 → 1.75.
- **`app/options-chain/page.tsx`** — slider 0.2–3 → 0.5–3, restyled to canonical; default 0.4 → 1.75.
- **`components/dashboard/GexHeatmap.tsx`** — replaced `cellBg()` additive-boost math (alpha up to ~1.0) with canonical alpha math (rank fixed alphas + 0.18 cap); fixes mobile heatmap looking uniformly over-saturated.
- **`md files/INTENSITY_SLIDER_GRADIENT_LOGIC.md`** — rewritten to document the new canonical slider + formula and list all four consuming files.

## 2026-06-19 (session 16) — Footprint page: live ES big-order bubbles + delta profile

New **Footprint → Big Orders** page (`/footprint`) showing real-time large prints on the front ES future (ESU6) as a Big Trade Bubbles lane + a Delta Profile lane, fed by a new server-v2 trade-classification pipeline. Includes an offline seed-replay path for reviewing a past session's transcribed time & sales.

### Server-v2 (live ES big-order pipeline)
- **`server-v2/proxy-tastytrade.js`** — capture the front-ES bid/ask (`this.esQuote`) instead of discarding it; classify each ES `Trade` tick as aggressive **buy** (≥ ask) / **sell** (≤ bid) via `_recordEsPrint()`. Ring buffer of big prints (≥`ES_BIG_TRADE_MIN`=25 contracts, cap 80) + per-minute signed-delta buckets; flushed to state every 1s by `_flushEsFootprint()` (`seeded:false`). New env tunables `ES_BIG_TRADE_MIN`, `ES_BIG_TRADES_MAX`, `ES_DELTA_BUCKET_MS`, `ES_DELTA_BUCKETS_MAX`. Timer started/stopped alongside the candle flush (incl. idle path).
- **`server-v2/state/market-state.js`** — new `esBigTrades` state key.
- **`server-v2/websocket-server.js`** — `esBigTrades` added to the snapshot + broadcast on change (new `esBigTrades` WS message).
- **`server-v2/es-seed-loader.js`** (new) — `ES_SEED=1` loads a transcribed T&S file, rebuilds ET timestamps + big-print/delta payload with the same thresholds, and pushes to `esBigTrades`; re-applies every 10s and backs off once the live feed publishes real prints. Wired into `server-v2/server-with-proxy.js`.
- **`server-v2/data/es-seed-ts.json`** (new) — ~165 transcribed ESU6 prints (session Jun-18), side from tape color.

### Client
- **`hooks/useEsBigTrades.ts`** (new) — connects `/ws/gex`, ingests `esBigTrades` snapshot + live messages; exposes `trades`, `delta`, `seeded`, `connected`.
- **`app/footprint/page.tsx`** (new) — two canvas lanes with a shared 30-min time axis:
  - **Big Trade Bubbles** — one bubble per 1-minute bar, aggregated by total volume, colored by dominant side. Solid diagonal-gradient orbs (green buys / red sells) with a soft glow; **session-wide** size reference so a bubble means the same in any window; non-overlap radius cap; small gray dot on every empty minute; hover tooltip (buy/sell split, net, count, time).
  - **Delta Profile** — per-minute cumulative net bars, **session-wide** height reference, active (forming) minute highlighted.
  - 30-minute viewport with click-drag to pan history + Live/Jump-to-latest button; SEEDED/REPLAY badges; accent-colored stat cards (net delta, buy/sell orders, biggest print).
- **`components/shared/Sidebar.tsx`** — added **Big Orders** (`/footprint`) under the Footprint nav group.

### Notes
- `tsc`/`next build` not run (Linux sandbox unavailable, HYPERVISOR_VIRT_DISABLED) — verified by inspection; confirm with `npm run build`.
- Entry point is `node server-v2/server-with-proxy.js`; requires a restart for the proxy changes. Live bubbles need an active ES quote (RTH); use `ES_SEED=1` (PowerShell: `$env:ES_SEED=1; node server-v2/server-with-proxy.js`) to replay the seed after hours.

## 2026-06-19 (session 15) — Market Quality Terminal (new Insights tab) + live VIX data + VIX regime interpretation

Added a **Market Quality Terminal** as its own Insights tab, wired the VIX/Vol meters to live data, and replaced the VIX Interpretation block with a regime-based if-this-then-that engine.

### Market Quality Terminal
- **`app/api/insights/market-quality/route.ts`** (new) — computes a 0–100 Global Market Score from five weighted pillars: **Volatility 25% / Trend 20% / Breadth 20% / Momentum 25% / Macro 10%**. All inputs from the Yahoo Finance v8 chart endpoint (same source as `/api/quotes-batch`) — `^VIX`, `^GSPC`, `TLT`, `UUP`, and 11 sector ETFs. Computes SMAs, RSI-14, annualized realized vol, sector 5-day performance, sizing band (FULL/REDUCED/MINIMAL), banner (CLEAR/CAUTION/DANGER), and a rule-based market assessment paragraph. No Google Sheets / credentials needed.
- **`components/insights/MarketQualityTerminal.tsx`** (new) — self-fetching (60s refresh) UI: banner + global score block, 5 animated **ring gauges** (gradient stroke, glow filter, dashed track texture, sweeping white end-cap dot), 5 detail panels, sector-performance bars, scoring-weights table, and the generated assessment. `.card-hover` on all cards.
- **`app/insights/page.tsx`** — new **"Market Quality"** tab (between VIX/Vol and IB Logic & AI) with Snap/Discord share buttons via a `mqtRef` wrapper.

### Live VIX data
- **`app/api/insights/vix/route.ts`** — replaced the 501 stub with a real Yahoo-backed route returning `vix_spot` (`^VIX`), `vix_1d` (`^VIX1D`, falls back to spot), `realized_10d` (SPX 10D annualized RV), and `iv_rank` / `iv_percentile` from trailing 1Y VIX history. The existing `setVix` wiring consumes it unchanged.

### VIX tab layout + regime interpretation
- **VIX/Vol tab** — top 4 GEX MetricCards now 4-across; 3 VIX meters in an even 3-col row (fixed the scrunched layout); fixed the `VixMeter` progress bar overlapping the value text (`flexShrink:0` + `marginTop:auto`). Added Snap/Discord buttons + `.card-hover` on Interpretation/IV Rank/IV Percentile cards.
- **`classifyVixRegime()`** (new, in `app/insights/page.tsx`) — if-this-then-that engine from `vix.txt`: High Fear → Term-Structure Inversion → Elevated RV + Near-Term Calm → Low Vol Calm → Strong Calm Discount → Normal Balanced. Renders active regime badge, mode, interpretation, VIX1D/VIX ratio + VRP readouts with zone labels, and recommended trading actions.

### Styling
- Market Quality terminal: muted gray/blue text → white; enlarged fonts throughout (assessment 13→17px, panels, sector bars, weights table, section headers); ring gauge accents.

### Notes
- `tsc`/`next build` not run (Linux sandbox unavailable, HYPERVISOR_VIRT_DISABLED) — verified by inspection; confirm with `npm run build`.
- Market Quality pillars + live VIX derive from Yahoo daily closes, not the internal dxLink/server-v2 feed. The "AI assessment" is deterministic template prose (no LLM key in repo).

## 2026-06-19 (session 14) — Strike-detail popup + GEX chart default $200 window + heatmap tweaks

Added a click-to-open **strike-detail popup** on the GEX chart and heatmap, defaulted the GEX chart to a $200 (±$100 ATM) window, removed the heatmap's 30-min rolling column, and dimmed the heatmap value text.

### Strike-detail popup
- **`components/dashboard/StrikeDetailPopup.tsx`** (new) — click a bar/cell to open a popup showing: SPX strike, live composite **net GEX (OI+Vol)** headline, a **2×2 rolling-difference grid** (Δ from open / 5m / 15m / 30m; cyan = building, red = unwinding), and the **OTM contract price** (call mark if strike > spot, put mark if strike < spot). Three switchable styles — **card | drawer | modal** — toggled live from the toolbar (`PopupStyle`). Esc/outside-click closes; `window` access guarded for SSR.
- **`hooks/useStrikeGexHistory.ts`** (new) — polls point-in-time net GEX baselines (open + each age) for the active expiry; only polls while a popup is open. Baselines are OI-based (matches the history writer), so the diff compares against the live row's `netGEX`.
- **API `app/api/snapshots/option-strike-gex-history/route.ts`** — added `mode=point&ages=5,15,30` returning per-strike `baselines[strike] = { open, "5", "15", "30" }`.
- **`lib/db.ts`** — added `getOptionStrikeNetGexAsOf` (nearest reading ≤ N min ago via `DISTINCT ON`) and `getOptionStrikeNetGexAtOpen` (first reading of the session).
- **Contract price passthrough** — `server-v2/computation/gex-calculator.js` + `server-v2/proxy-tastytrade.js` now thread the live contract price (quote mid, else REST mark) onto each row as `callMark`/`putMark`; added to `ChainRow` in `lib/calculations/calculations.ts`.
- **Wiring** — `onStrikeClick` added to `GexChart` (drag-vs-click guarded), the home-page heatmap `<tr>`, and the standalone `GexHeatmap` component; popup state + style toggle wired in `app/home/page.tsx` and `components/dashboard/GexToolbar.tsx`.

### GEX chart default window
- **`components/dashboard/GexChart.tsx`** — default visible range changed from $600 to **$200** ($100 either side of ATM) in all three spots: initial draw, expiry-reset effect, and double-click recenter. Scroll-zoom still adjusts from there.

### Heatmap tweaks (home page)
- Removed the **30 Min Rolling Net GEX** column (header, data cell, colgroup, divider `colSpan` 6→5, and the coloring `cols` array). Remaining 4 data columns rebalanced to 22.5% each. (`rollingByStrike` state/poll left in place, now unused.)
- Dimmed numeric value text from `#fff` → ~62% white (ATM rows ~82%) for a softer look; cell background intensity coloring untouched.

### Notes
- `tsc`/`next build` not run (Linux sandbox unavailable, HYPERVISOR_VIRT_DISABLED) — verified by inspection; confirm with `npm run build`.
- Rolling-difference boxes require the Postgres `option_strike_gex_history` table populated (`DATABASE_URL` + gex-history writer running); they show "—" gracefully until snapshots exist. "From open" needs ≥1 snapshot from session start. Strike, headline GEX, and OTM contract price work immediately from live data.
- Mobile/bzila popup wiring intentionally skipped per request.

## 2026-06-19 (session 13) — Confidence Score page + MVC import/auto-collection + dashboard card hover

Built a new **Confidence Score** page (`/confidence-score`) that scores the current MVC level 0–100 for **Hit / Pivot / Chop**, backfilled historical MVC data, added in-process 30-min auto-collection, and applied a standard card hover effect dashboard-wide.

### Confidence Score
- **`lib/confidenceScore.ts`** — pure scoring engine. Blends a live structural prior (proximity-to-EM, GEX dominance, gamma regime, DEX bias, flip proximity, time weight) with historical analog rates. History weight saturates `0.65 · n/(n+10)`, capped at 65%, so it works day one and strengthens as data grows.
- **`app/api/confidence/route.ts`** — reads latest `mvc_snapshots` for the date; finds prior days with the same gamma regime + similar GEX dominance; replays each day's **SPX series** (no ES-candle dependency) to classify hit/pivot/chop around that day's MVC strike; returns blended scores, analogs, thresholds, and a debug block.
  - Fixed `pickLevel` to use the **strike** (price) as the level, not the $B GEX value.
  - SPX-driven throughout (ES kept only as a display reference).
  - Tunables: `HIT_PTS=8`, `PIVOT_PTS=10`, `CHOP_BAND=15`, `ANALOG_GEX_TOL=0.25`.
- **`app/confidence-score/page.tsx`** — gauges (per-metric color identity: Hit=cyan, Pivot=purple, Chop=orange), pulse/glow on Hit ≥85%, LIVE/PAUSED indicator + timestamp, Auto-refresh toggle (10 min, default off), significant-shift banner, factor bars with tooltips, actionable Bias line, analog badges with outcome icons, color-coded Read bullets, collapsible Tuning Reference.
- Registered **Confidence** in the Sidebar **Gex** group.

### MVC data import + auto-collection
- **`scripts/import-mvc.js`** — backfills daily `server-v2/MVC/*.xlsx` into `mvc_snapshots`. Maps human-readable headers → DB columns, synthesizes `timestamp` from Date+Time, falls back ES→SPX and Vol→OI totals, dedupes on `(date,timestamp)`, dry-run by default (`--commit` to write). Loads `.env.local` then `.env`. **Imported 196 rows.**
- **`server-v2/mvc-auto-snapshot.js`** — in-process collector started from `server-with-proxy.js` after `server.listen`. Every 30 min during RTH (Mon–Fri 9:30–4:00 ET), self-calls `/api/gex` → `/api/snapshots/mvc` (`triggerType: auto-30m`), aligned to :00/:30 with a ~20s startup test run. No browser / no Claude app needed. Replaces the disabled Claude scheduled task.

### Dashboard-wide card hover
- **`app/globals.css`** — added `.card-hover` (translateY -2px + soft shadow + faint cyan border, .15s ease) and an auto-rule for 16px-radius panels inside `<main>` (scoped away from the sidebar).
- Applied to Insights `.greek-card`, VIX/Vol `MetricCard`/`VixMeter`, and the live IB card (`components/insights/IbLogic.tsx`).
- Documented the pattern in `md files/HOME_PAGE_DESIGN_SYSTEM.md` (new subsection + template + checklist) so new pages inherit it.

### Notes
- `tsc`/`next build` not run (Linux sandbox unavailable, HYPERVISOR_VIRT_DISABLED) — verified by inspection against `lib/db.ts` schema; confirm with `npm run build`.
- Confidence history pool is small (≈9 days at session end) — scores lean on the live prior until the auto-collector accumulates more. Thresholds are reasonable defaults, not yet calibrated.

## 2026-06-19 (session 12) — Estimated Moves: NDX/NQU blank-row fixes (in progress)

Investigated why NDX and NQU render blank on the Estimated Moves tab (`components/dashboard/EstimatedMoves.tsx`). Server data confirmed healthy (chains + expirations return for NDX; pinned 6/26 chain returns full bid/ask/iv when fetched WITHOUT forceSub). Four fixes applied; still blank as of session end — likely holiday/closed-market data, revisit when NDXP weeklies quote cleanly.

### Fixes
- **Dropped `&forceSub=1`** from the primary chain fetch in `estimateMove`. On server-v2 the forceSub path returns an all-zero (bid/ask/mark/iv = 0) chain for index weeklies (NDXP), zeroing every straddle → row dropped. Plain `&noSubscribe=1` returns full pricing.
- **Priced-quote picker** in `fetchQuoteDetail`: `/api/quotes-batch` returns an all-null `$NDX`/`NQM` row (Yahoo `^NDX`/futures fail) alongside priced `NDX`/`/NQU26`. Now scores candidates and picks the first with a real price.
- **Futures price fallback**: when `/api/em/em-closes` 404s (not implemented on server-v2), futures fall back to `q.last`/`q.mark`/`prev-close` instead of leaving `close` NaN.
- **All-unpriced snap**: if a pinned expiration returns all-zero options, refetch unpinned and snap to the nearest PRICED expiration.
- **Title fix**: `targetDateLabel` now uses `getTargetExpiration` (prefers Friday) instead of `weeklyExps[0]` (first Thu/Fri), so the header shows 6/26 not 6/25.

### Notes
- `tsc` not run (Linux sandbox unavailable, HYPERVISOR_VIRT_DISABLED) — verify with `npm run build`.
- Open item: NDX/NQU still blank on 2026-06-19 (holiday). Re-test with live quotes; use `/dev` probe on the targeted expiration to diagnose.

## 2026-06-19 (session 11) — Sidebar nav restructured into emoji pop-out groups

Reworked the left sidebar (`components/shared/Sidebar.tsx`) from a single "Pages" pop-out into a Home button followed by five emoji-labeled group buttons, each opening a 2×2 grid pop-out. Pop-out items use white font, are drag-reorderable, and persist their order to `localStorage` (`sidebar-nav-order-v1`). Bumped version to `2026.6.19-v2`.

### Sidebar groups
- **📊 Gex** — Overview, Est. Move, Options Chain, Multi Greek, Insights
- **👣 Footprint** — empty; shows a centered "Coming soon" placeholder instead of the grid
- **📈 Stock Market** — Premarket, Database, Econ Calendar
- **🧑 Personal** — Trading, Budget
- **🛠️ Dev** — Legacy, Dev, Logs, Changelog; `devOnly` flag gates it to signed-in users via Clerk `useUser()` (not yet locked to a specific account)

### Implementation
- `NAV_GROUPS` typed config (`NavItem`/`NavGroup`); empty `items` renders the "Coming soon" state.
- `useNavOrder()` hook reads/writes per-group order to `localStorage`, appends any new items not yet in saved order.
- Drag-and-drop reorder via native `draggable` + `onDragStart/onDragOver/onDrop`.
- Removed the old single-list Grid pop-out, the standalone Dev link, and unused `GridIcon`/`CalendarIcon`/`UserIcon` components.
- Note: `tsc` not run this session (Linux sandbox unavailable, HYPERVISOR_VIRT_DISABLED) — verify with `npm run build`.

## 2026-06-19 (session 10) — Live ES 5m candle pipeline → Relative Volume + live IB Logic (locked)

Wired a real live + historical 5-minute ES futures OHLCV feed through server-v2 and built it into the Insights page: a working Relative Volume card (5/14-day baseline toggle) and a live Initial Balance tracker that locks the IB high/low into the database at 10:30 ET so it never resets. Also blocked public sign-up pre-launch.

### Sign-up lockdown
- `app/sign-up/[[...sign-up]]/page.tsx` now redirects to `/` (no public registration pre-launch).
- `app/layout.tsx` — `ClerkProvider` given `signUpUrl="/"` so the modal's sign-up link goes to the landing page. (Still need to disable public sign-ups in the Clerk Dashboard for a hard lock.)

### Live ES 5m candle pipeline (server-v2)
- `server-v2/proxy-tastytrade.js` — dxLink client now subscribes to the front ES future's 5m Candle stream (`${esSymbol}{=5m}`) with a 15-day `fromTime` for a historical snapshot on connect. Added `Candle` to FEED_SETUP/COMPACT_FIELDS, a `subscribeCandle()` method, mixed pending-queue flush, ET 5-min slot aggregation (`etFiveMinSlot`, `this.esCandles`), and `_flushEsCandles()` (5s cadence → state + DB; cleaned up on idle).
- `server-v2/state/es-candle-writer.js` (new) — lazy-pool Postgres writer upserting into `es_candles` (no-op without DATABASE_URL).
- `server-v2/state/market-state.js` — new `esCandles` field.
- `server-v2/websocket-server.js` — `esCandles` added to snapshot + new targeted `esCandles` WS message on `/ws/gex`.

### Client — Insights
- `hooks/useEsCandles.ts` (new) — connects `/ws/gex`, merges live bars with SQLite history (today + 20d), computes per-slot avg volume over previous **5 and 14** trading days (`avg5`/`avg14`).
- `app/insights/page.tsx` — Relative Volume now reads real candles + true relVol%; added **5d/14d baseline toggle**. Removed the broken client-side candle loader/saver and dead helpers.
- `components/insights/IbLogic.tsx` — new live IB panel: computes 9:30–10:30 ET high/low/mid/range from ES candles, marks IB done at 10:30, detects breaks (high/low/double/inside), formed-first, compression, timing; surfaces which reference rules apply. Static reference retained below.

### IB locking (never resets)
- `lib/db.ts` — new `ib_levels` table (one row/day, unique date) + `upsertIbLevels` (no-op once `locked=1`, via `WHERE locked = 0`) + `getIbLevels`.
- `app/api/snapshots/ib/route.ts` (new) — GET/POST; refuses to overwrite a locked row.
- `lib/snapdb.ts` — `saveIbLevels` / `queryIbLevels` client helpers.
- `IbLogic.tsx` — at 10:30 ET freezes the IB once (`locked=1`); thereafter reads the immutable locked row (survives refresh/restart/ET rollover) and runs break detection live against the frozen levels. 🔒 Locked badge in the UI.

**Notes:** requires a server-v2 restart; 5/14-day averages + IB history accumulate as `es_candles` fills. Couldn't run tsc/lint (sandbox unavailable) — recommend `npm run build` before deploy.

## 2026-06-19 (session 9) — Public landing page + Clerk auth gating + Google Sheets waitlist export

Added a public marketing landing page, Clerk-based authentication gating the paid dashboard, and real-time export of waitlist signups to both Postgres and Google Sheets.

### Landing page (`/`)
- `app/page.tsx` is now a server component: signed-in users redirect to `/home`; signed-out users see the landing page.
- `components/landing/LandingClient.tsx` — blurred, unreadable decorative dashboard mock behind a glass card; explainer copy + feature grid; "Notify me at launch" email form; **Sign in** (Clerk modal) and a disabled **"Sign up — coming soon"** button.
- `components/landing/DashboardMock.tsx` — static, data-free decorative dashboard (fake chart/heatmap/panels) rendered blurred behind the overlay.

### Auth — Clerk (`@clerk/nextjs` ^6, `@clerk/themes`)
- `middleware.ts` (new): `/`, `/sign-in`, `/sign-up`, `/api/waitlist` public; all else requires login. Signed-out users hitting a protected route are redirected to `/` (the front door).
- `app/layout.tsx` wrapped in `ClerkProvider` (dark theme, cyan accent).
- `app/sign-in/[[...sign-in]]/page.tsx` + `app/sign-up/[[...sign-up]]/page.tsx` fallback pages.
- `components/shared/LayoutShell.tsx` renders bare (no sidebar) on `/`, `/sign-in`, `/sign-up`.
- `components/shared/Sidebar.tsx` — old bottom logo replaced with Clerk `UserButton` (sign-out, `afterSignOutUrl="/"`).

### Waitlist capture
- `app/api/waitlist/route.ts` (new): POST validates + stores email; GET (admin-secret guarded) exports JSON.
- `lib/db.ts` — new `waitlist` table + `addWaitlistEmail` / `listWaitlist` helpers (dedupe on unique email).
- `lib/google-sheets.ts` (new): service-account JWT auth, appends each NEW signup to a Google Sheet (Email, Source, Referrer, User Agent, Signed Up); auto-creates header row; safe no-op when unconfigured. Wired into the route as fire-and-forget so a Sheets failure never breaks signup.

### Config / deps
- `package.json` — added `@clerk/nextjs`, `@clerk/themes`, `googleapis`.
- `.env.local` — Clerk keys, `WAITLIST_ADMIN_SECRET`, Google Sheets vars (`WAITLIST_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`).
- `LANDING-SETUP.md` (new) — full Clerk + Google service-account setup steps.

### Notes
- Verified working end-to-end: test signup appended to the Google Sheet in real time.
- Paid-tier gating NOT yet wired — any signed-in user reaches the dashboard. Next step: gate on a Clerk `publicMetadata.paid` flag set from a payment-provider webhook.
- **Security:** Clerk dev key + the Google service-account private key were pasted into chat this session and must be rotated. `.env.local` is gitignored.
- Sandbox shell unavailable this session (`HYPERVISOR_VIRT_DISABLED`); `npm install` + clean boot must be run/verified locally. Run `npm install` for the new deps.

## 2026-06-19 (session 8) — Options Chain + Multi-Greek wired to server-v2; proxy port fix; ATM row outline (v2026.6.19-v1)

Fixed the Options Chain and Multi-Greek pages (no data / empty expiry dropdown) and added an ATM-row highlight.

### Root cause — proxy port mismatch
- server-v2 runs Next **and** `/proxy/*` in one process on `PORT` (`.env.local` = **3002**), but `next.config.js` rewrite and `lib/proxyForward.ts` both defaulted `/proxy/*` to a dead **3001** → every `/api/chains` + `/api/expirations` forward failed → "No live chain payload" / empty dropdown.
- `lib/proxyForward.ts` + `next.config.js` now default to `127.0.0.1:${PORT||3002}`; added explicit `PROXY_URL=http://127.0.0.1:3002` to `.env.local`.

### Server (`server-v2/proxy-tastytrade.js`, `server-with-proxy.js`)
- server-v2 never implemented `/proxy/api/tt/chains/:ticker` or `/proxy/api/tt/expirations/:ticker` (only the single-symbol live-feed routes) → those forwards 404'd.
- Added **`fetchChainFull(ticker, expiration)`** + **`fetchExpirations(ticker)`**: rebuild the legacy nested payload (`{ items:[{ "expiration-date", strikes:[{ "strike-price", call, put }] }], underlyingPrice, rootSymbol }`) from `getChainCached` contracts + batched `/market-data/by-type` (greeks, OI, volume, mark); spot via `index=`/`equity=`. Works after-hours (REST, not live dxLink).
- Wired both `GET /proxy/api/tt/{chains,expirations}/:ticker` routes in `server-with-proxy.js`.

### Pages (`app/options-chain/page.tsx`, `app/mult-greek/page.tsx`)
- **Fixed infinite `/api/expirations` fetch loop** on options-chain: the expirations `useEffect` listed `loadChain` (recreated every render) as a dep → setState → render → re-fire. Dep array reduced to `[activeTicker]`.
- **ATM row**: single clean white outline around the whole row (`outline: 1px solid rgba(255,255,255,.55)`, `outlineOffset: -1px`, `position: relative`, `zIndex: 1`) on both pages, replacing the old amber top/bottom borders.

### Notes
- Reverted exploratory edits to the dead legacy `server/proxy-tastytrade.js`.
- Sandbox shell was unavailable this session (`HYPERVISOR_VIRT_DISABLED`); `node --check` not run — verify clean boot on restart. server-v2 + next.config + .env.local do **not** hot-reload.

## 2026-06-19 (session 7) — Dev Symbol Probe rebuilt on REST: any ticker, all feeds, net greeks (v2026.6.18-v56)

Reworked the `/dev` Symbol Probe so it actually loads. Root cause of "nothing loads" was a chain of dead paths: the live `/proxy/probe` needs the symbol subscribed in the SPX-only feed (empty overnight / for other tickers), and the old page's `/api/prev-closes`, `/api/proxy/tt/quote`, and the `/api/chains` forward target are now 501/missing stubs. Switched the page to a single REST request that has no feed dependency. Version `2026.6.18-v55` → `2026.6.18-v56`.

### Server (`server-v2/proxy-tastytrade.js`, `server-with-proxy.js`)
- New **`GET /proxy/probe-rest`** route (any ticker): fetch nested chain (cached 60s) → snap to nearest real strike → `/market-data/by-type` for the contract → underlying spot. Returns `{ found, resolvedSymbol, snapped, requestedStrike, resolvedStrike, result }`.
- `result.feeds` groups the market-data item into **Quote / Trade / Summary / Greeks**, plus `raw` (full unmodified item).
- `result.exposures` = per-contract **net greeks** using dashboard conventions: `GEX=|γ|·OI·S²`, `DEX=|δ|·OI·100·S`, `VEX=vega·OI·100·S`, `ThetaExp`, `GEX(vol)`. Vanna/charm = `n/a` (not in REST greeks).
- `chainTicker()` maps weekly roots to chain roots (`SPXW→SPX`, `NDXP→NDX`, `RUTW→RUT`). `fetchChain()` parameterized by underlying.
- `_resolveChainSymbol()` + earlier live-feed work (overnight **stale recall** via new `last_events` table, `last-event-store.js`) retained but no longer on the page's hot path.

### Page (`app/dev/page.tsx`)
- **Ticker** input (any symbol). All probes go through `/proxy/probe-rest` — one request, no polling.
- Renders **all five panels at once**: Quote, Trade, Summary, Greeks, **Net Greeks**, + collapsible Raw response.
- **Stop** button (AbortController), live **Elapsed** counter, color-coded **Log panel** (timestamped, 200-line cap, Clear).
- Clear miss reporting: `no-expiry` (lists valid expirations) / `no-strike`.

### Docs
- Added `md files/DEV_SYMBOL_PROBE.md` documenting the data path, formulas, panels, endpoints, and the restart-the-proxy gotcha.

### Verify on restart (sandbox unavailable — not syntax-checked here)
- **Restart the proxy (port 3001)** — `server-v2/*.js` is not hot-reloaded; a stale process returns `404 unknown proxy route`.
- Hit `/proxy/probe-rest?ticker=SPXW&expiry=<valid>&type=P&strike=7490` → expect `200` with feeds + exposures. Confirmed working in-session (OI/vol/mark/iv + greeks populated).


## 2026-06-19 (session 6) — GEX chart readiness gating: greeks-coverage + DTE-scaled plateau release (v2026.6.19-v1)

Investigated a reported GEX mismatch on the 7490 strike, traced it to stale prior-session data in the manual check (live `dayVolume`/gamma were correct), then hardened the chart's cold-start so it never renders a half-warmed/inflated frame. Version `2026.6.18-v56` → `2026.6.19-v1`.

### Diagnosis (no bug in the calc)
- 7490P bar (-124M vol-only) reconciled against live probe data (`dayVolume=562`, broker `gamma=0.00625`, delta≈-0.50 → strike was effectively ATM). The -27.9M hand calc used prior-session REST `volume:430` + an assumed OTM gamma. Webull's 430 was also prior-day. Conclusion: chart correct, manual check stale.

### Server feed (`server-v2/proxy-tastytrade.js`, `state/market-state.js`)
- Added a **greeks-coverage gate**: the GEX broadcast now requires both ≥85% OI backfill AND ≥85% of in-window legs carrying a real streamed broker gamma (not the BS/ATM-IV fallback that produced inflated cold-start bars). New `GREEKS_READY_RATIO` knob.
- Added **plateau release** for both OI and greeks: when coverage stops climbing (gain <1%) for N consecutive cycles (`*_PLATEAU_HITS`, ~6s) above a floor, release instead of waiting out the 90s grace valve — fixes the ~20s wait on thinner expiries (e.g. Tuesday plateaued at ~83% OI, just under the 85% bar).
- Made the plateau floor **DTE-scaled** (`PLATEAU_FLOOR_TIERS` / `plateauFloor()`): SPX OI/volume thins the further out the expiry, so the floor decreases with DTE (0–1 DTE 80% → 14+ DTE 30%). Starting curve; tune from real per-DTE coverage.
- Readiness published in market-state `status` (`chartReady`, `oiCoverage`, `greeksCoverage`); reset on start and expiry switch.

### Home page (`app/home/page.tsx`)
- GEX chart now held behind a spinner + "Loading SPX chain…" loader until a warm `chartReady` snapshot/gex arrives; re-arms the loader on expiry change. No artificial delay — shows as soon as data is genuinely ready.
- Heatmap left live (reads the same `gexChainRows`, so it matches the chart once a frame broadcasts).

### Verify on restart (sandbox was unavailable — not syntax-checked here)
- Confirm server boots clean; watch for `[READY] …` and `[OI] coverage plateaued at X% (floor Y% @ ZDTE)` logs.
- Optionally grab `/proxy/status` on a near vs far expiry to dial in `PLATEAU_FLOOR_TIERS`.


## 2026-06-18 (session 5) — GEX chart fixes, quote accuracy, OI gating, feed pinning (v2026.6.18-v50)

Bug-fix and polish pass on the SPX home dashboard. Version `2026.6.18-v42` → `2026.6.18-v50`.

### GEX chart (`components/dashboard/GexChart.tsx`)
- Fixed GEX flip line being misaligned with the orange profile curve: introduced a single shared `xForStrike()` strike→X mapping (the index/bar axis) and routed the profile curve, spot line, and flip line through it so they all line up.
- Fixed the "Profile" curve rendering as a flat-railed step: it was clamped onto the per-strike bar Y-axis and saturated. Now self-scales to its own symmetric magnitude around the zero line, showing the true profile shape crossing zero at the flip.
- Added bar/border padding: `PAD_L`/`PAD_R` 4→16px.
- Raised Y headroom 1.10→1.25 so the tallest bar (and MVC label) clears the top/bottom frame.

### Home page (`app/home/page.tsx`)
- Fixed style shorthand warning: `background`→`backgroundColor` (conflicted with `backgroundImage`).
- VIX/ESU top-bar: added quotes-batch (Yahoo) fallback for prior closes when `/ws/gex` omits them; added absolute change value alongside % for both.
- GEX heatmap now fits any window size: container `overflow: auto`→`hidden`, removed vertical cell padding (lineHeight 1.1), tighter header, font 13→12; rows compress to fill panel height.

### Sidebar (`components/shared/Sidebar.tsx`)
- Rewrote `pctFromQuote` to recompute % from last vs prev-close first, removed the over-aggressive ±20% null clamp, added fractional/whole-percent normalization.
- Quote font bumped to 13 then dialed back to 11 per request.

### Quotes API (`app/api/quotes-batch/route.ts`)
- Fixed inflated day-% (e.g. AMD +10% vs real +4.86%): `meta.chartPreviousClose` is the close before the chart range window (~a week ago), not yesterday. Now prefers `regularMarketPreviousClose` → `previousClose` → second-to-last candle → chartPreviousClose.

### Server feed (`server-v2/`)
- OI backfill gating: hold the GEX broadcast until OI coverage ≥85% (`OI_READY_RATIO`) with a 90s grace valve, so the chart no longer renders half-filled on connect. Fast OI polling until ready, then 60s cadence. Re-gates on expiry switch.
- Fixed wrong-underlying bug (home page showed NVDA): server now loads only `.env.local` with `override:true` (legacy `.env` no longer loaded), and `SYMBOL=SPX` pinned in `.env.local` so a stray shell `SYMBOL` var can't hijack the home feed.


## 2026-06-18 (session 4) — Home dashboard UI/wiring pass (v2026.6.18-v42)

Worked on server-v2 stack. Version bumped to `2026.6.18-v42`.

### Home page (`app/home/page.tsx`)
- Live GEX heatmap header: added refresh (↻), record-snapshot-to-DB (📸), screenshot snap, and Discord buttons.
- Bumped all inline fonts +2 across the page.
- Top toolbar: larger clock font + box; wired live VIX, ESU, SPX prices; SPX day-change from prevClose.
- 2nd toolbar row rebuilt: NET GEX, Call Wall, Put Wall, Flip + right-aligned MVC + Snapshot button.
- Taller GEX chart (flex 1.6); SnapshotPanel now fed by server `flow` message.
- VIX/ESU day-change % computed live from Tastytrade prev-close (no Yahoo dependency).

### GEX chart (`components/dashboard/GexChart.tsx`)
- Flip line uses gamma-zero only, 0DTE-only; removed spurious bar-zero-crossing fallback.
- Profile curve plotted on the same dollar axis as the bars (removed independent renormalization).
- OI overlay = shaded red/green gradient; removed blue total-OI line.
- Axis labels white + bigger (11px).
- DEX line convention matched to heatmap (OI+Vol → netDEX+volNetDEX).

### Econ calendar (`components/dashboard/EconCalendarPanel.tsx`)
- Bigger fonts; confirmed 7-day rolling window (≥5 days ahead) + stale events grayed/moved to bottom.

### Sidebar (`components/shared/Sidebar.tsx`)
- Deduped quotes (removed triple ESU/NQU); cogwheel settings popup with Idle Proxy toggle, turns red when idle.

### Backend (server-v2)
- `proxy-tastytrade.js`: subscribe VIX + front ES future; fetch their prev-closes; 500ms flow aggregation loop; `setIdle()` pausing compute/flow/OI loops.
- `state/market-state.js`: `prevClose`/`vix`/`esFut`/`vixPrevClose`/`esFutPrevClose` + `idle` status, `setAux()`.
- `websocket-server.js`: broadcasts aux quotes + prev-closes (`aux` message) and prevClose in `spot`.
- `server-with-proxy.js`: `/proxy/idle` GET/POST + WS `SET_IDLE` routing.

### Bug fixes
- `app/database/page.tsx`: `load()` was stubbed (always empty) — wired to `/api/db` so saved snapshots render.
- `app/api/quotes-batch/route.ts`: was a 501 stub — implemented over Yahoo for the sidebar's ~20 symbols.

⚠️ Not type-checked/built this session (sandbox unavailable). Run `npm run build` before relying on prod.

## 2026-06-18 (session 3) — Step 4 secret rotation/scrub + Step 5 merge to main (migration complete)

Branch: `server-v2-wirein` → merged to `main`, pushed. Deployed to Render (`00fe33f`).

### Step 4 — rotate & scrub exposed secrets (✓)
- Read-only audit first: found live secrets not only in git history but hardcoded as
  fallbacks in tracked current files — `server/proxy-tastytrade.js` (Schwab client id+secret,
  Discord webhook) and `_ARCHIVED_DO_NOT_EDIT/Vanilla/` (bzila.pem RSA key, cert.pfx, dup
  webhooks/secrets). Active `server-v2/` stack confirmed clean (all env-based).
- Rotated at providers: Discord webhook + bot token, Tastytrade client secret + refresh
  token (covers dxLink — token fetched at runtime via /api-quote-tokens), Postgres password.
  Dropped/deleted: Schwab app, Massive key (no longer used).
- Stripped hardcoded fallbacks in `server/proxy-tastytrade.js` (Schwab id/secret + webhook
  → empty strings).
- Deleted `_ARCHIVED_DO_NOT_EDIT/` entirely (dead vanilla stack; held keys/certs/dup secrets).
- Hardened `.gitignore`: `*.pem *.pfx *.key *credentials*.json _ARCHIVED_DO_NOT_EDIT/`.
- Deleted stale `.env` (all live config lives in `.env.local`, which is gitignored).
- Added + redacted `SECURITY-AUDIT-step4.md` and `SECURITY-rotation-plan-step4.md`.
- Git history scrub (git-filter-repo): removed bzila.pem/cert.pfx from BOTH paths
  (`_ARCHIVED_DO_NOT_EDIT/Vanilla/` and older `Vanilla/`), replace-text redacted secret
  strings. Verified zero hits across `git rev-list --all`. Mirror backup at
  `../spx-gex-backup.git`. Force-pushed `main` + `server-v2-wirein`.

### Step 5 — merge to main (✓)
- `server-v2-wirein` → `main` fast-forward to `00fe33f`; `npm run build` clean (76/76 pages);
  pushed to origin/main.
- Build gotcha: stale `.next` cache caused phantom `PageNotFoundError` for
  `/api/cache/expirations`, `/api/chains`, `/api/dxlink/candles`. Fix: `Remove-Item -Recurse
  -Force .next` then rebuild. Not a source issue.

### Deploy status
- Render service `dash` (srv-d8mk8se7r5hc739t138g) auto-deployed `00fe33f` → live at
  dash-1fa2.onrender.com.
- KNOWN: deployed feed is empty ("Fetching SPX chain…", 0 OPTION SYMBOLS) because Render's
  env vars still hold the OLD rotated secrets. `.env.local` does not propagate to Render.
  TODO before go-live (planned Saturday): update Render Environment vars — TT_CLIENT_SECRET,
  TT_REFRESH_TOKEN, DATABASE_URL, DISCORD_WEBHOOK_URL, DISCORD_BOT_TOKEN — then redeploy.
- Staying on local dev until ~Sat 2026-06-20 to finish bringing everything up to date.

### Still open (optional follow-ups)
- Premarket page dead WS state (`setQuotes`/`setTs`) — finish or remove.
- Home header chip "0 OPTION SYMBOLS / $TREAM" — unwired display binding, worth a look.

---

## 2026-06-18 (session 2) — verify raw greeks, build fix, restore SPX Flow tab

Branch: `server-v2-wirein` (still ahead of `main`; not merged or pushed)

### Step 1 — raw-greeks runtime verification (✓)
- Verified `/proxy/gex` snapshot on both SYMBOL=NVDA and SYMBOL=SPX: `all-zero-gamma: 0`
  across all strikes (26 NVDA / 228 SPX), `negative putDelta rows: 0`. Greeks physically
  sane; live heatmap steady.
- Confirmed put-delta sign is robust by design: `vex-chex.js` and `gex-calculator.js` both
  take `Math.abs(delta)` and apply call/put sign structurally, so broker-vs-BS sign can't
  break DEX. No code change needed.
- Noted (left as-is) a cosmetic deep-ITM artifact ~600pts from spot where adjacent strikes
  alternate broker-greek vs BS-underflow-to-~0; outside the visible window, no effect on totals.

### Step 2 — production build (✓)
- `npm run build` clean (76/76 pages).
- Build-blocker fix in `app/premarket/page.tsx`: referenced undefined `wsLive` (page's WS
  wiring was never finished; `setQuotes`/`setTs` are dead). Added
  `const wsLive = Object.keys(allQuotes).length > 0 || yahooTs !== "";` before the return.

### Step 3 — restore SPX Flow tab (✓)
Tab previously rendered only a "Coming Soon" placeholder. Now live; build clean; tape
verified at runtime (`prints: 1340, tape len: 200` on SPX, all `.SPXW`, correct
action/bucket/isOtm/premium).
- `server-v2/computation/flow-processor.js`: `addPrint` now retains strike/expiry/root and
  accepts `spot`, building a capped (200) per-order `tape[]` in FlowOrder shape (computes
  `action`, `bucket` bull/bear/neutral, `isOtm`). `bucket()` emits the tape filtered
  SPX-only (`underlying === 'SPX' || 'SPXW'`); `reset()` clears it.
- `server-v2/proxy-tastytrade.js`: passes `spot: this.spot` into `addPrint`.
- `app/home/page.tsx`: imports `FlowTape` + `FlowOrder` type, adds `flowOrders` state,
  handles `case "flow"` (reads `data.tape`), renders `<FlowTape orders={flowOrders}
  connected={status==="LIVE"} />`.
- Architecture note: `hooks/useSpxFlow.ts` is NOT the live path (pure state container, no
  socket despite its header comment); live tape flows server → `flow` WS msg → FlowTape.
  `FlowOrder` type still lives in useSpxFlow.ts and is imported by both consumers.
- No change to `server-v2/websocket-server.js` — the `flow` broadcast already existed.

### Docs
- Added `HANDOFF-server-v2.md` (resume guide for a new chat; pick up at Step 4).

### Still open (next session)
- Step 4: rotate exposed secrets (TT token/secret, Discord bot+webhook, Postgres pw,
  Massive key, Schwab secret) — REQUIRED before any push; repo public with secrets in git
  history. Audit read-only first.
- Step 5: merge `server-v2-wirein` → `main` (Brandon does this himself after verifying).

---

## 2026-06-18 — server-v2 wire-in, heatmap rework, raw greeks

Branch: `server-v2-wirein` (ahead of `main`; not yet merged or pushed)

### Migration: legacy `server/` → `server-v2/`
- Wrote the missing `/ws/gex` consumer in `app/home/page.tsx` (connect, reconnect,
  message routing for snapshot/gex/spot/status, SET_EXPIRY on (re)connect via ref).
- Confirmed server-v2 `gexRows` already match the dashboard `ChainRow` shape (no mapping layer needed).
- Replaced the 501 stubs `/api/gex` and `/api/gex/expirations` with thin adapters over
  server-v2 `/proxy/gex` and `/proxy/expirations` (same-origin, `PROXY_V2_URL` override).
- Added a Postgres GEX-history writer (`server-v2/state/gex-history-writer.js`) wired into
  the recompute loop; rate-limited, no-ops without `DATABASE_URL`.
- Port story: server-v2 runs Next + proxy in one process on `PORT` (kept 3002); commented
  out legacy `PROXY_URL` and `NEXT_PUBLIC_WS_URL` in `.env.local`.
- `package.json`: `dev`/`start` now run server-v2; added `dev:old`/`start:old` fallbacks.
- Fixed corrupted `DATABASE_URL` in `.env.local` (three typo chars); connection verified.
- Flow tab (SPX Flow / useSpxFlow) intentionally deferred — left inert (no old connections).

### Heatmap (`app/home/page.tsx`)
- Window is now 20 strikes above + ATM + 20 below; stretches to fill panel height (fixed
  table layout + per-row percentage height).
- Columns changed to: Strike, Net GEX, Vol Only GEX, DEX, GEX + VEX, 30 Min Rolling Net GEX.
- "GEX + VEX" = net GEX + vanna; "30 Min Rolling" polls `/api/snapshots/option-strike-gex-history`.
- Added INTENSITY slider (0.2–3.0, default 0.4) with ported `metricBg` opacity logic
  (rank-based floors + power curve; cyan positive / red negative).
- Narrowed strike column (~10%); fixed ATM-row cell shift (removed `position:relative` on
  `<tr>`, ATM emphasis now via cell borders).
- Net GEX header: "OI + Vol" mode now sums OI-based + volume-based GEX; display throttled to 1s.

### GEX chart (`components/dashboard/GexChart.tsx`)
- Bars now blend slightly toward white by relative magnitude (lighter tip on higher GEX).

### Greeks source (`server-v2/proxy-tastytrade.js`)
- Switched to RAW dxFeed Greeks (delta/gamma/vega/IV) instead of solving IV from price + BS.
- Vanna/charm still BS-derived but fed with the raw broker IV (stable); BS is fallback only
  when a strike has no Greeks tick yet. Removes the noisy price-based IV solve.

### Fixes
- `gex-history-writer.js`: snap subnormal floats (`|x| < 1e-30`) to 0 before insert
  (Postgres `real` can't store values below ~1.2e-38); pool now rebuilds only on real
  connection errors, not data errors.

### Security (still OUTSTANDING — rotate before any push; repo is public)
- Stripped hardcoded Schwab/Discord secrets from `lib/proxy/config.ts` (env-only now).
- Still in git history / env files and need rotation: TT refresh token + client secret,
  Discord bot token + webhook, Postgres password, Massive API key, Schwab secret.

### Next steps
1. Verify the raw-greeks change at runtime (steadier heatmap, no all-zero strikes after open, put-delta signs).
2. `npm run build` — confirm clean production build.
3. (Optional) Restore SPX Flow: extend server-v2 `FlowProcessor` to emit a capped per-order tape over the `flow` WS message.
4. Rotate the exposed secrets.
5. Merge `server-v2-wirein` → `main` when verified.
