# Changelog

## 2026-06-17 (session 26) - Global Sidebar Replaced with Home-Style Rail

### `components/shared/Sidebar.tsx`
- Replaced the old expanded sidebar with the compact home-style rail so the same left navigation now appears on every page
- Kept the home icon, page shortcuts, live quotes stack, settings cog, and logo circle in the new layout
- Wired the cog button to the existing idle proxy action so the idle control stays available from every route

### `components/shared/LayoutShell.tsx`
- Continues to mount the shared sidebar globally through the app shell, so the updated rail is now the persistent left sidebar site-wide

## 2026-06-17 (session 25) - Proxy Live Data Wiring + Initial Server Modularization

### Live Proxy Subscription Wiring
- `lib/proxy/liveSubscription.ts` - added shared helpers to normalize proxy feed payloads and guarantee live proxy subscriptions through `/api/proxy/subscription-ready` and `/api/proxy/dxlink-subscribe`
- `app/home/page.tsx` - rewired `/home` to follow the same proxy-first live data flow as `/dev`: fetch chain data, prepare option symbols, ensure proxy subscriptions, consume `/ws/dxlink`, and build the GEX chart + options heatmap from shared live Greeks, summary, quote, and trade updates
- `app/mult-greek/page.tsx` - wired multi-greek into the same proxy subscription readiness flow and re-subscribe behavior on websocket open/reconnect
- `app/options-chain/page.tsx` - wired options chain into the same proxy subscription readiness flow and re-subscribe behavior on websocket open/reconnect
- `app/insights/page.tsx` - switched insights live feed setup to the shared proxy subscription helper and shared feed normalization path

### WebSocket Stability Fix
- `app/home/page.tsx` - fixed a websocket reconnect storm that was repeatedly opening `/ws/dxlink` connections and flooding the browser with `Insufficient resources` errors
- Root cause: the socket connect callback was being recreated from live quote state changes, which caused repeated reconnects and overlapping sockets
- Fix: added stable refs for quote snapshots, reconnect timers, and unmount state so `/home` now keeps a single connection and reconnects in a controlled way

### Initial Server Refactor
- `server/websocket-server.js` - extracted the reusable `/ws/dxlink` websocket bridge used by the custom Next.js server
- `server/computation/utils.js` - extracted shared numeric and symbol/date helpers for proxy computations
- `server/computation/flow-processor.js` - extracted buy/sell snapshot helper logic used by derived metrics
- `server/computation/vex-chex.js` - extracted shared exposure accumulation logic for DEX, VEX, and CHEX-style calculations
- `server/computation/gex-calculator.js` - extracted reusable intraday snapshot and GEX level calculation helpers
- `server/server-with-proxy.js` - updated to use the extracted websocket bridge module
- `server/proxy-tastytrade.js` - began routing intraday snapshot logic through the shared computation module path as the first step of breaking up the monolithic proxy

### Verification
- `npm run build` completed successfully after the live data wiring and server extraction changes

## 2026-06-16 (session 24) — Discord Bot with Slash Commands

### New Files
- `discord-bot.js` — Discord bot using discord.js + Puppeteer; screenshots Next.js pages at `https://dash-1fa2.onrender.com` and posts them to Discord. Commands: `/screenshot <page>`, `/gex`, `/snapshot`
- `register-commands.js` — one-time script to register slash commands globally via Discord REST API

### Modified Files
- `package.json` — added `discord.js`, `puppeteer` dependencies; added `bot` and `bot:register` npm scripts
- `.env.local` — added `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_GUILD_ID`, `DASHBOARD_URL`

### Page Map (slash command choices → Next.js routes)
- GEX Chart, Heatmap, Snapshot Flow, SPX Flow, MVC → `/home`
- Exposure Stack → `/insights`
- Multi Greek → `/mult-greek`

### Notes
- Bot runs locally via `npm run bot`; for 24/7 uptime deploy as Render Background Worker
- Global command registration used (guild registration failed due to missing `applications.commands` scope on initial invite)
- Puppeteer wait times set to 3s per page; `deferReply` wrapped in try/catch to handle stale interactions

## 2026-06-16 (session 23) — Heatmap Height Fix + Overview Redirect

### `app/overview/page.tsx`
- Replaced full overview page with a simple `redirect("/home")` — `/overview` route now permanently redirects to `/home`

### `components/dashboard/GexHeatmap.tsx`
- Root `app/page.tsx` already redirects to `/home`; confirmed no change needed

### `app/overview/page.tsx` (heatmap body wrapper)
- Added `display: "flex", flexDirection: "column"` to heatmap body wrapper div so `GexHeatmap`'s `height: 100%` resolves correctly — fixes only 3 strikes showing in the live GEX heatmap panel

### Version
- Bumped to `2026.6.16-v48`

---


## 2026-06-16 (session 22) — Task #7 Steps 1-2: GEX Toolbar Live Data Wiring

### `components/dashboard/GexToolbar.tsx`
- Added toolbar state management: `selectedExpiry` (0DTE/1DTE) and `chartMode` (net-gex, call-gex, put-gex, call-put, oi-vol, bid-ask-vol)
- Refactored DTE button group + chart mode selector from static UI to interactive state
- DTE buttons now toggle `selectedExpiry` state and highlight active selection (cyan when selected, muted otherwise)
- Chart mode dropdown wired to `chartMode` state with visual feedback
- Prop interface updated: `onExpiryChange` and `onChartModeChange` callbacks passed from parent
- All button clicks now trigger state updates (ready for heatmap/chart filtering in next steps)

### `app/page.tsx`
- Added `selectedExpiry` and `chartMode` state to Overview page root
- Passed states + callbacks down to `GexToolbar` for toolbar button wiring
- Prepared data pipe for downstream components (heatmap row filtering, GEX chart bar rendering)

### Task Progress
✅ Step 1: Add toolbar state to manage DTE selection and chart mode
✅ Step 2: Make DTE and chart mode buttons clickable with state updates
⏳ Step 3-6: Filter heatmap rows, render GEX bars, update labels, wire chart updates (next session)

### Version
- Bumped to `2026.6.16-v73`

---

## 2026-06-16 (session 21) — Heatmap Vol Fallback + Proxy dxLink Throttle Fix (v47)

### `app/home/page.tsx`
- **Heatmap OI=0 fallback**: When proxy returns `netGEX=0` due to missing OI (dxLink throttling), display falls back to `netVolGEX` (volume-based GEX) for NET GEX column and `volNetDEX` for NET DEX column — options with volume but no OI now show real values instead of `$0`
- **VEX fallback**: Also falls back to `netVolVanna` when `netVanna=0`
- **Rank badges**: `effGex()` helper uses vol-fallback when ranking top pos/neg strikes, so badges appear even when OI=0
- **`nonEmpty` filter**: Extended to include rows where `volOnly !== "$0"` — previously hid valid strikes that had volume data but zero OI

### `Vanilla/proxy-tastytrade.js`
- **Cache-hit path**: SPX/SPY/QQQ flagged as pre-warmed symbols — cache hits for these skip all re-subscription (prewarm at startup already handles their dxLink subscriptions), eliminating thousands of duplicate subscription requests per chain fetch
- **Fresh-fetch path**: SPX/SPY/QQQ also skip subscribing on fresh fetches (prewarm handles it); all other on-demand symbols capped at 200 streamer symbols per request
- **Root cause fixed**: Was flooding dxLink with 6700+ subscription requests on every `/proxy/api/tt/chains/SPX?range=all` hit, causing `BAD_ACTION "Your subscription rate is too high"` errors and stalling REST monitors for SPX/VIX/ES feeds

## 2026-06-16 (session 21) — Quotes Panel WS Refactor + by-type Batch API

### `Vanilla/shared/quotes-manager.js`
- Replaced per-symbol equity REST loop with single `GET /proxy/api/tt/market-data/by-type?equity=...` batch call
- Populates `state.prevCloses` inline from `prev-close` field in batch response — eliminates separate prevclose fetch for equities
- Updated auto-init symbol list: removed `SRM`, added `SPY`, `TSLA`, `SMH`, `SPCX`

### `proxy-tastytrade.js`
- Added all 14 equity quote symbols (`SPY`, `QQQ`, `AAPL`, `AMD`, `AMZN`, `GOOGL`, `META`, `MSFT`, `NVDA`, `SPCX`, `TSLA`, `SMH`) to `CORE_LIVE_SUBSCRIPTIONS` — now subscribed at boot via DXLink regardless of page state

### `Vanilla/pages/quotes/quotes.html`
- Rewrote `QuotesPanel` to read from `QuotesManager.getQuote()` / `getChange()` (DXLink cache) instead of polling `quotes-batch` REST
- Removed separate `loadPrevCloses`, `fetchQuotes`, and `subscribeSymbols` methods
- Re-renders every 5 seconds from WS cache — no more 30s REST poll

## 2026-06-15 (session 20) — Bzila Home Page + Greeks Fix + Keepalive Infrastructure

### `app/home/page.tsx` *(new)*
- New personal trading dashboard landing page at `/home`
- Greeting header (Good Morning/Afternoon/Evening, Bzila) with live SPX sparkline
- Date/time card with ET clock, market open/closed badge, live SPX price + % change, ES futures price
- Performance ring (win rate donut, trade counts)
- Session timer with dual-arc ring counting down to 16:00 ET
- Market bias card pulling net GEX from `/api/gex` with sparkline decoration
- Today's Focus interactive checklist (click to toggle done/pending)
- Weekly P&L bar chart with day labels
- Trading Tools 2×3 grid linking to existing pages (Heatmap, Opt Flow, Ladder, Quotes, Levels, Snapshot)
- All in existing dark theme (`#05080d`, `#00e5ff`, `#0a0e14`)

### `app/options-chain/page.tsx`
- Added `normalizeSide()` to map hyphenated TT REST field names (`implied-volatility`, `open-interest`) to normalized JS names (`iv`, `oi`, `delta`, `gamma`, `theta`, `vega`)
- Fixed `buildStrikes()` to store normalized `LiveEntry` as `callTT`/`putTT` — Greeks were blank before because raw TT objects had wrong field names
- Added keepalive ping on mount + every 8 min to `/api/keepalive`
- Added `silentRestRefresh` — re-baselines Greeks from REST every 5 min for symbols without live WS data (`!d._ws`)

### `app/api/keepalive/route.ts` *(new)*
- Lightweight GET that pings `${PROXY}/proxy/api/health` to prevent Render cold starts

### `vercel.json` *(new)*
- Vercel cron every 10 min hitting `/api/keepalive` for server-side keepalive

### `Vanilla/proxy-tastytrade.js`
- Added `subscriptionLastSeen` Map + `touchSubscription()` + `pruneIdleSubscriptions()` — prunes option symbols idle >30 min every 10 min
- Added `GET /proxy/api/health` endpoint returning dxLink state, authorization status, subscription count, browser client count
- `touchSubscription(sym)` called in `POST /proxy/dxlink/subscribe` handler

### TypeScript Fix (`app/home/page.tsx`)
- Added `accent?: string` to `Ring` component prop signature to resolve build error

### Version
- Bumped through `2026.6.15-v70` → `v71` → `v72`

---


## 2026-06-15 (session 19) — TypeScript Type Fix: StrikeRow LiveEntry

### `app/options-chain/page.tsx`
- **Fixed TypeScript build error**: `StrikeRow` interface was typed `callTT`/`putTT` as `Record<string, unknown> | null`, but `normalizeSide()` returns `LiveEntry`
- Changed both fields to `LiveEntry | null` to match the actual return type
- Build now succeeds without errors

### Version
- Bumped to `2026.6.15-v72`

---

## 2026-06-15 (session 18) — Migrate sql.js → PostgreSQL (Render)

### Database (`lib/db.ts`)
- Replaced sql.js (WASM/SQLite) with `pg` Pool connecting via `DATABASE_URL`
- Rewrote `getDb()` to return a pg Pool instead of a sql.js Database instance
- Rewrote all table creation as a single `ensureAllTables()` using Postgres DDL (`SERIAL PRIMARY KEY`, `BIGINT`, `TIMESTAMPTZ`, `GREATEST`/`LEAST`)
- Rewrote `queryAll()` to convert `?` placeholders to `$1,$2,...` for pg
- Rewrote all insert/upsert functions to use `pool.query()` with `RETURNING id` instead of `last_insert_rowid()`
- `persistDb()` is now a no-op (pg writes are immediate)
- SSL configured to skip cert verification for non-localhost connections

### API Routes
- `app/api/es-stats/route.ts` — replaced `db.run()`/`db.exec()` with `pool.query()`
- `app/api/snapshots/route.ts` — replaced sql.js exec pattern with pg queries
- `app/api/snapshots/[id]/route.ts` — replaced sql.js exec pattern with pg queries
- `app/api/debug/route.ts` — rewrote to use pg; lists tables via `pg_tables`
- `app/api/debug/write-test/route.ts` — rewrote to use pg
- `app/api/db/route.ts` — replaced `ORDER BY rowid DESC` with `ORDER BY id DESC` (rowid is SQLite-only)

### Config
- `next.config.ts` — removed `serverExternalPackages: ["sql.js"]`
- `package.json` — replaced `sql.js@^1.12.0` + `@types/sql.js` with `pg@^8.11.3` + `@types/pg`
- `.env.local` — replaced `DB_PATH` with `DATABASE_URL` (Render internal Postgres URL)

### Version
- Bumped through `2026.6.15-v67` → `v68` → `v69`

---

## 2026-06-15 (session 17) — Database Page Fixes + Options Chain Auto-Load

### Database Page (`app/database/page.tsx`)
- Fixed `dateFilter` state initialization: was passing function reference `todayET` instead of calling it `todayET()` — caused undefined state

### Options Chain Page (`app/options-chain/page.tsx`)
- Moved `loadChain` callback before `fetchExpirations` to resolve dependency order issue
- Updated `fetchExpirations` to auto-load chain when expirations are fetched and default expiry is selected
- Added `loadChain` to `fetchExpirations` dependency array
- Fixed useEffect hook to properly pass `fetchExpirations` dependency

### SQL.js WASM Initialization (`lib/db.ts`)
- Simplified `initSqlJs()` initialization with memoized `_SQLPromise` to prevent multiple concurrent initializations
- Added error handling wrapper around sql.js init with console logging
- Attempted fixes: wasmBinary buffer slicing, locateFile callback, direct initSqlJs() call
- Current state: still experiencing "Cannot set properties of undefined (setting 'exports')" — likely a module loading or WASM file access issue

### Version
- Bumped to `2026.6.15-v62`

---

## 2026-06-15 (session 16) — Dashboard Consolidation + Performance Optimization

### Performance & Architecture
- **Unified server deployment**: Consolidated proxy server into single Node.js instance via `server-with-proxy.js` (spawns proxy as child process on port 3001, Next.js on 3002)
- **Deferred API calls**: Removed blocking API calls from page initialization across `estimated-moves.js`, `options-chain.js`, `mult-greek.js`, `quotes.html` — all data now loads on user interaction
- **Load time impact**: Pages now render immediately without waiting for batch API calls

### API Route Fixes
- **`app/api/[...proxy]/route.ts`**: Fixed TypeScript `response` type errors by explicitly typing as `Response` and renaming to `proxyResponse` to avoid type union issues in Promise.race
- **GET/POST/DELETE handlers**: Consistent variable naming and proper error handling with fallback to remote proxy if local unavailable
- **Timeout handling**: Added 3s timeout for local proxy calls before attempting remote fallback

### Server & Configuration
- **`server-with-proxy.js`**: Custom Node.js server that spawns vanilla proxy as child process; graceful error handling and logging; skips proxy startup on Render production (API routes handle routing instead)
- **`lib/proxy/auth.ts`**: Token refresh logic with file persistence; TastyTrade API calls use in-process tokens
- **`lib/proxy/config.ts`**: Configuration management for token state and refresh token environment variables

### Package Updates
- Updated `package.json` scripts: `start` now runs `node server-with-proxy.js` for unified deployment
- Version bumped to `2026.6.15-v49`

### User-Facing Changes
- ✅ Dashboard loads instantly without initial API delays
- ✅ Faster page transitions and interaction response
- ✅ Maintained real-time WebSocket data streams (GEX, quotes, snapshots)

---

## 2026-06-15 (session 15) — GEX Chart Zero Line + Countdown Timer + Page Cleanup

### `components/dashboard/GexChart.tsx`
- **Zero line restored**: re-enabled zero-crossing line and shading that was previously removed
- **GEX flip line auto-compute**: if `flipPoint` prop or `gexProfile.flipPoint` is null, now computes from zero-crossing position to display "GEX FLIP" marker automatically

### `components/shared/QuotesPanel.tsx`
- **30-second countdown timer**: added `countdown` state tracking next Greeks/price update
- **Display**: shows time + countdown (e.g., "12:14:07 30s") in quotes header
- **Color coding**: countdown turns orange at 5s, red at 0s
- **Auto-reset**: timer resets every 30s even if no data arrives, maintains continuous countdown

### `app/insights/page.tsx`
- **Fixed page loading hang**: moved `mountedRef` declaration to component level (was being declared twice, causing initialization order issues)
- **WebSocket cleanup**: added `mountedRef` checks in WS onopen/onmessage/onerror to prevent updates after unmount
- **Greeks throttling**: ensured 30-second fetch interval (no change to existing logic, just cleanup)

### `components/shared/TopBar.tsx`
- **Navigation cleanup**: removed "Dashboard", "ES Candles", and "Bzila Flow" from NAV_ITEMS
- Removed href: `/dashboard`, `/es-candles`, `/bzila`

### Cleanup
- Pages to manually delete:
  - `app/dashboard/page.tsx`
  - `app/es-candles/page.tsx`
  - `app/bzila/page.tsx`

### Version
- Bumped to `2026.6.15-v44`

---

## 2026-06-15 (session 14) — TopBar SPX Price Fix + ES Front Month Rollover

### `components/shared/TopBar.tsx`
- **SPX showing `—`**: on-connect WS cache replay was sending compact array format `['Quote',[sym,...]]` which TopBar's object-format parser couldn't read. Fixed proxy to send proper object format.
- **Added `"$SPX"` to WS symbol check** — dxFeed sometimes returns `eventSymbol: '$SPX'` instead of `'SPX'`; both now handled.
- **After-hours SPX = ES bug**: spread formula was using `esPrev` as `esClose` fallback, making spread ≈ 0 → SPX displayed same as ES. Fixed to only apply spread when today's 4pm closes (`C.es`, `C.spx`) are available.
- **Weekend close seed**: `loadTodayCloses` now accepts Friday's closes on weekends (checks `lastTradingDayStr()` not just today). On cold weekend load, fetches `savedDailyCloses` from proxy (`/api/prev-closes`) to populate `closesRef` so ES→SPX spread works.
- **`saveTodayCloses`** accepts optional `date` param so server-sourced Friday closes are stored with the correct date.
- **`__gexAppState.spotPrice`** write/read ordering fixed — fallback now reads before writing.

### `Vanilla/proxy-tastytrade.js`
- **ES front-month rollover (June → September)**: added `/ESU26` and `/NQU26` to `CORE_LIVE_SUBSCRIPTIONS` so proxy subscribes the active September contract directly.
- **`getDxCacheAliases`**: added `/ESU26` and `/NQU26` as aliases so any event arriving under either symbol populates the shared cache key.
- **`dxFallbackMap`** in quotes-batch: `/ES:XCME` now falls back to `/ESU26`, `/NQ:XCME` to `/NQU26` when continuous-contract cache is empty.
- **On-connect cache replay**: Quote/Trade now sent as object format (with `eventType`/`eventSymbol`); added `$SPX`/`/ESU26`/`/NQU26` alias lookups.

### `app/api/prev-closes/route.ts` *(new)*
- Proxies `GET /proxy/api/tt/prev-closes` — exposes proxy's disk-persisted `savedDailyCloses` (ES/SPX/VIX 4pm closes) to the Next.js client.

### `app/page.tsx`
- Polls `window.__gexAppState.spotPrice` (written by TopBar) as fallback for GexChart `spotPrice` when page WS hasn't received an SPX tick yet.

### Version
- Bumped to `2026.6.15-v24`

---

## 2026-06-15 (session 13) — Multi Greek Page: GO Button Fix + Proxy Speed

### `app/mult-greek/page.tsx`
- **GO button was a no-op**: `loadAll` had `strikes` and `spots` in its `useCallback` dep array — stale closure caused every call after initial load to silently use an outdated function. Fixed by removing state deps; functional updater pattern (`setStrikes(prev => ...)`) used instead.
- **`activeExpiryRef`**: added ref to track active expiry without closure staleness; `doRefresh` now reads from ref instead of state.
- **Error visibility**: when all 3 ticker fetches fail, status now shows `PROXY ERR 502` instead of silently reverting to CLOSED.
- **Partial success**: if only some tickers succeed, status shows `PARTIAL (N/3)` and existing data is preserved for failed tickers.
- **Cache busting on manual refresh**: Refresh Now button sends `noCache=1` to bypass proxy chain cache (prevents stale 3-4 strike results from a poisoned cache entry).

### `Vanilla/proxy-tastytrade.js`
- **`noCache` param**: chains handler now respects `?noCache=1` — bypasses both in-memory and SQLite chain cache for fresh fetch.
- **Fast path when expiration is explicit**: skip the `/option-chains/:sym/nested` round-trip (known root symbols hardcoded: `SPX→SPXW`, `SPY→SPY`, `QQQ→QQQ`). Eliminates one serial TT API call per ticker.
- **Parallel fetch**: `fetchUnderlyingLast` and chain data now run in `Promise.all` instead of sequentially. Total latency for explicit-expiry chain fetch: 1 parallel round-trip instead of 3 serial ones — prevents Render 30s timeout 502s.

---

## 2026-06-14 (session 12) — Exposure Stack 24/7 Sessions + Expiry Dropdown Fix

### `Vanilla/pages/insights/exposure/exposure.js`
- **`drawRelativeVolumeSparkline`**: replaced hardcoded `SESSION_START/END/SPAN` with `getActiveSession()` — all RVOL samples now remapped to session-relative offsets (0 = session open), correctly handling night session (17:00→09:30 ET) that wraps midnight
- **x-axis labels**: dynamically computed from active session instead of hardcoded; night session shows 17:00 / 00:45 / 09:30 ET

### `Vanilla/pages/insights/exposure/exposure.html`
- Added IDs `rvol-xlabel-left`, `rvol-xlabel-mid`, `rvol-xlabel-right` to x-axis label spans so JS can update them per session

### `Vanilla/proxy-tastytrade.js`
- **`/proxy/api/greeks-intraday`**: when today has no records (weekend/market closed), falls back to the most recent date with data in SQLite — exposure stack now shows Friday's session on weekends instead of blank
- **Intraday Greeks broadcast (30s interval)**: removed Saturday/Sunday gate and 9:00–16:00 time window; now runs 24/7 as long as a spot price is available from dxLink (ES futures `/ESU26` added as fallback); old hardcoded `/ESM6` replaced with `/ESU26`
- **`/proxy/api/tt/expirations/:symbol`**: added cache fallback — if TT nested API call fails (auth/network), derives expiration dates from `chains_cache` SQLite table so dropdown still populates from cached data

### Version
- Bumped to `2026.6.14-v31`

---

## 2026-06-14 (session 11) — Options Chain Fixes + MD File Consolidation

### `app/options-chain/page.tsx`
- **Range % filter now works**: added `hasData()` check inside the range filter — empty dense-fill rows (no callTT/putTT/live data) are excluded, so ±3%/5%/10%/etc. now properly narrows the visible strikes
- **Net greek columns show `--` instead of `+$0.00M`** for rows with no data: added `hasAnyData` guard; empty rows render `--` with transparent background instead of zeroed-out colored cells
- Both fixes apply to the `filtered` useMemo and the row render in `ChainTable`

### MD File Consolidation (`Vanilla/md files/`)
- Moved `Vanilla/QUOTES_PANEL_README.md` → `Vanilla/md files/QUOTES_PANEL_README.md`
- Moved `Vanilla/assets/ES_FUTURES_CANDLESTICK_MAP_HOWTO.md` → `Vanilla/md files/ES_FUTURES_CANDLESTICK_MAP_HOWTO.md`
- Moved `COMPLETION_REPORT.md` (repo root) → `Vanilla/md files/COMPLETION_REPORT.md`

## 2026-06-14 (session 10) — ES Stats Ladder: Remove Google Sheets, Wire SQLite

### `EsStatsLadder.tsx` (`components/dashboard/EsStatsLadder.tsx`)
- **Removed Google Sheets dependency entirely** — no more `SHEET_ID`/`SHEET_URL`
- **Removed VAH, VPOC, VAL rows** from the ladder
- **Added MID row** (sourced from No Short No Long Zones tab: `(HIGH + LOW) / 2`)
- Now fetches from `/api/es-stats` (Next.js SQLite route) instead of Google Sheets
- Rows sort dynamically by price (descending); current ES spot (`ES NOW`) inserted inline
- `valueKey` fields changed to snake_case matching SQLite column names (`no_long`, `up`, `mid`, `down`, `no_short`)

### `app/api/es-stats/route.ts` (existing — verified correct)
- GET returns latest row from `es_stats` SQLite table
- POST does partial upsert: `ON CONFLICT(expiration) DO UPDATE SET ... CASE WHEN excluded.x IS NOT NULL`
- Allows Est. Moves tab and Zones tab to write independently without clobbering each other

### `EstimatedMoves.tsx` (`components/dashboard/EstimatedMoves.tsx`) (existing — verified correct)
- After running Est. Moves: POSTs `{ expiration, up, down }` to `/api/es-stats`
- After running Zones tab: POSTs `{ expiration, no_long, no_short, mid }` to `/api/es-stats`
- Mid = `(esm.high + esm.low) / 2` from ESM6 zone levels

### Root cause identified
- `EsStatsLadder.tsx` was the blocker — it was still calling Google Sheets on every load, never touching SQLite
- Now all reads and writes go through the same `/api/es-stats` Next.js route backed by sql.js (WASM) on Render persistent disk

## 2026-06-14 (session 9) — Economic Calendar Overhaul + Nav Restore

### Economic Calendar Full Page (`app/economic-calendar/page.tsx`)
- Complete rewrite to match target layout: left column (day label + time), right column (impact·country badge, bold title, A/F/P values)
- Multi-select filter dropdown — checkboxes for High·USD, High, Medium, Low, All (can combine e.g. High·USD + Medium simultaneously)
- Google Sheets daily quote fetched from `/api/calendar-quote` and displayed italic below header
- All blue/muted text replaced with white
- Larger fonts throughout (title 15px, time 13px, date headers 14px, impact 11px)
- Date section headers with TODAY badge for current day
- Removed all Trump calendar references — FF data only

### EconCalendarPanel (`components/dashboard/EconCalendarPanel.tsx`)
- Full rewrite to match same layout as full page (left time/day column, right content column)
- Multi-select filter dropdown (same High·USD + High + Medium + Low + All)
- Google Sheets daily quote block below header
- Stale events (>30 min past) faded to 32% opacity, pushed below divider
- 60s interval tick for live stale detection
- Removed dead `/api/trump-calendar` fetch — FF-only data
- White text throughout, bigger fonts (title 12px, time 11px)

### New API Route (`app/api/calendar-quote/route.ts`)
- Proxies `/proxy/api/quote-of-day` from Vanilla through Next.js
- 1hr revalidation cache

### TopBar Nav (`components/shared/TopBar.tsx`)
- Restored "Econ Calendar" → `/economic-calendar` at top of NAV_ITEMS (had been removed in session 8)

### Version
- Bumped to `2026.6.14-v13`

## 2026-06-14 (session 8) — Bug Fixes, Calendar Enhancements, Quotes Panel

### Options Chain (`app/options-chain/page.tsx`)
- Fixed % range dropdown not filtering — `filtered` useMemo now depends on `renderTick` instead of `liveData` ref (which never changes identity)
- Added `useEffect` to bump `renderTick` on `rangePercent` change so filter applies immediately

### Multi-Greek (`app/mult-greek/page.tsx`)
- Auto-loads on mount when expirations are ready — no need to click GO manually

### Econ Calendar Page (`app/economic-calendar/page.tsx`)
- Fixed background color to `#05080d` (was using CSS vars that rendered as pure black in some contexts)
- Events now show next 7 days (rolling window from today) instead of Mon–Fri current week only

### EconCalendarPanel (`components/dashboard/EconCalendarPanel.tsx`)
- Same 7-day rolling window fix applied to Overview panel
- Added "POTUS" option to impact filter dropdown
- Added "President" purple (`#a855f7`) impact color

### Trump Calendar (`app/api/trump-calendar/route.ts`) — NEW
- New API route fetching `https://media-cdn.factba.se/rss/json/trump/calendar-full.json`
- Filters out "executive time", "pool call", "in-town pool" noise events
- 30-min in-memory cache
- Events tagged with `impact: "President"` and rendered in purple

### Calendar Merge (both Econ Calendar page + EconCalendarPanel)
- Both now fetch ForexFactory + Trump calendar in parallel and merge/sort by date+time

### Quotes Panel (`components/shared/QuotesPanel.tsx`)
- Expanded to fill full sidebar height via flex layout
- Row height slider at bottom (16–56px) for adjustable density
- Font size scales with row height

### Sidebar (`components/shared/Sidebar.tsx`)
- Wrapper div changed from `overflowY: auto` to `display: flex, flexDirection: column` so QuotesPanel can fill available space

### Nav Cleanup (`components/shared/TopBar.tsx`)
- Removed "Quotes", "GEX Ladder", "Econ Calendar" from NAV_ITEMS
- `app/quotes/page.tsx` — redirects to `/`
- `app/gex/page.tsx` — redirects to `/`
- `app/top10/page.tsx` — redirects to `/`

### push-to-github skill (`skills/push-to-github/SKILL.md`)
- Updated to auto-read package.json, compute version, bump it, and output ready-to-paste PowerShell block

### Version
- Bumped to `2026.6.14-v11`

## 2026-06-14 (session 6) — UI Polish: Chevron Buttons, Sidebar, TopBar, Heatmap

### Sidebar (`components/shared/Sidebar.tsx`)
- Replaced scrolling ticker with static sorted list (highest % → lowest, nulls last), live via WS + REST seed
- Background fixed to `#05080d` on both collapsed and expanded states to match the GEX chart
- QuotesPanel + DailyEmPanel now fill the sidebar from the top (no empty spacer gap)
- Collapse/expand buttons replaced with bare chevron SVG (no border box)

### TopBar (`components/shared/TopBar.tsx`)
- Removed empty ROW 2 strip — only renders when Peak GEX data is present
- Page selector dropdown temporarily removed then restored (with `useRouter`/`usePathname`/`NAV_ITEMS`)

### GEX Toolbar (`components/dashboard/GexToolbar.tsx`)
- Replaced +/− expand/collapse buttons with a single chevron button (rotates 180° on toggle)
- Collapse now hides only the toolbar controls — chart stays visible at full height
- New props: `chartOpen: boolean`, `onToggleChart: () => void`
- Removed unused `useCallback` import

### Overview Page (`app/page.tsx`)
- Added `gexToolbarOpen` state wired to GexToolbar chevron
- Removed thick 16px heatmap divider — heatmap has no left border
- Heatmap collapse/expand chevrons use same bare-chevron style with 180° rotation
- Collapsed heatmap shows slim 20px re-open tab

### Version
- Bumped to `2026.6.14-v15`

## 2026-06-14 (session 5) — Sidebar Collapse Rail + Toolbar Cleanup

### GEX Heatmap Column Layout
- `components/dashboard/GexHeatmap.tsx` — narrowed strike column `80px → 68px`; changed column headers and data cells from `textAlign: right` to `center`

### Sidebar Version Number
- `components/shared/Sidebar.tsx` — added version footer pulled dynamically from `package.json` via `resolveJsonModule` import; displays at bottom of sidebar

### Sidebar Nav Removal
- `components/shared/Sidebar.tsx` — removed all page nav links (superseded by TopBar dropdown); sidebar now contains only QuotesPanel, DailyEmPanel, and version footer

### Sidebar Collapse Rail
- `components/shared/Sidebar.tsx` — full rewrite: collapsed state renders a 36px rail with `▶` expand button, live vertical auto-scrolling price ticker (`CollapsedTicker`), and tiny version label; `onOpen` prop added
- `components/shared/LayoutShell.tsx` — sidebar always mounted on desktop; passes `collapsed={!sidebarOpen}` and `onOpen` instead of hiding with `display: none`; mobile behavior unchanged

### TopBar Cleanup
- `components/shared/TopBar.tsx` — removed "Current MVC" and "GEX Flip" from Row 2; Row 2 now shows Peak GEX only; moved `SnapButton mode="share"` to Row 1 (before Save Snap and logo)

### GEX Chart Expand/Collapse Buttons
- `components/dashboard/GexToolbar.tsx` — added `onExpandChart` / `onCollapseChart` props; rendered as `+` / `−` icon buttons (inline SVG, cyan accent, `#0a1628` bg, hover state) right of toolbar
- `app/page.tsx` — wired `onExpandChart` (+10% splitPct, max 85%) and `onCollapseChart` (−10%, min 15%) to toolbar

## 2026-06-14 (session 4) — Mobile + UI Polish

### Mobile Responsive Layout
- `app/layout.tsx` — added viewport meta tag; swapped sidebar+main for `<LayoutShell>`
- `components/shared/LayoutShell.tsx` (new) — client wrapper: sidebar is a fixed overlay on mobile with backdrop, floating `☰` FAB when closed; sidebar collapses on all screen sizes via `◀` button inside sidebar header
- `components/shared/Sidebar.tsx` — accepts `onClose`/`isMobile` props; always shows `◀` collapse button at top; nav links close sidebar on mobile tap; removed duplicate "Econ Calendar" nav entry
- `components/shared/TopBar.tsx` — Row 1 uses `flexWrap: wrap`; Row 2 gets `topbar-row2` class (hidden on mobile via CSS)
- `app/globals.css` — `@media (max-width: 767px)` breakpoint: hides Row 2, stacks overview page vertically, makes main scrollable, hides resize handle
- `app/page.tsx` — adds `overview-root` class for CSS targeting

### Heatmap Panel Collapse Tab
- `app/page.tsx` — replaced 4px resize divider with 16px border strip containing a centered `▶/◀` tab button; heatmap panel animates open/closed (`width` transition); arrows only visible on hover via CSS

### Heatmap Toolbar Collapse
- `app/page.tsx` — intensity slider toolbar now collapsible via `▲/▼` toggle; collapsed state shows slim 22px bar with label + current intensity value; arrow only visible on hover

### Vertical Drag Resize — Chart vs Bottom Panels
- `app/page.tsx` — replaced hardcoded `flex: "0 0 50%"` with `splitPct` state (default 50%); 5px drag handle with grip dots between GEX chart and bottom panels (Calendar / ES Stats / Snapshot); draggable 15%–85% range

### TT LIVE Dropdown Button
- `components/shared/TopBar.tsx` — merged `● TT LIVE` badge and `⋮` button into single clickable button; amber when connected, muted when disconnected; opens existing status dropdown

### Page Nav Dropdown in TopBar
- `components/shared/TopBar.tsx` — added `<select>` page navigator in Row 1; auto-selects current page via `usePathname`; navigates on change via `useRouter`

## 2026-06-13 (session 3)

### ES Stats Ladder — Current Price Row in Timeline
- `components/dashboard/EsStatsLadder.tsx` — added "ES NOW" row sourced from `esSpot` prop (same `spotPrice` state already passed from `app/page.tsx`)
- All rows (5 levels + spot) are now sorted descending by value so the current price appears at its correct position in the ladder
- Spot row renders with a filled cyan dot, cyan label/value, and subtle cyan background tint — visually distinct from level rows
- Data wiring unchanged: `esSpot` prop is already fed by the same WebSocket-backed `spotPrice` used by the GEX toolbar

## 2026-06-13 (session 2)

### Built Dynamic Economic Calendar via Next.js API
- Created `app/api/econ-calendar/events.json` — persistent data file, source of truth for all pages
- Created `app/api/econ-calendar/route.ts` — GET serves events.json; POST writes new events to disk
- Updated `Vanilla/pages/overview/overview.js` — `ECON_EVENTS` now fetched from `/api/econ-calendar` on load instead of hardcoded
- Updated `Vanilla/economic-calendar-importer.js` — after parsing JSON or OCR screenshot, POSTs events to API to persist permanently; falls back gracefully if server write fails

### Updated Economic Calendar (overview.js)
- Replaced week of June 8–12 events with June 15–19 week
- **Mon Jun 15:** Empire State Mfg Survey, Industrial Production, Capacity Utilization, NAHB Housing Index
- **Tue Jun 16:** Housing Starts, Import Prices
- **Wed Jun 17:** Retail Sales, Mfg & Trade Inventories, Pending Home Sales, U.S. Interest Rate Decision
- **Thu Jun 18:** Weekly Jobless Claims, Philly Fed Business Outlook, Leading Indicators
- **Fri Jun 19:** No events scheduled
