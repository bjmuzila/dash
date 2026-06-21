# Changelog

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
