# Changelog

## 2026-08-06 (f) - ES Candles: Overlays dropdown moved next to Layout

Overlays sat between the DTE picker ("Front") and the Vol+OI/Vol switch — in the
middle of the gamma-settings half of the dock. It answers "what is drawn on this
chart", the same question as Indicators, so it now renders immediately after the
page's Charts / Replay / Indicators / Layout group and before the symbol picker.

### `components/dashboard/es-candles/EsChartCard.tsx`
- Overlays button + its portalled checklist relocated from after the DTE dropdown to
  directly after `{toolbarExtras}` (the page-owned Charts / Replay / Indicators /
  Layout cluster), so it lands beside Layout in the rendered bar.
- Dropped the now-redundant `<DockGap />` that used to introduce the Overlays group —
  the GEX-metric group below already brings its own, so the DTE picker would otherwise
  have ended up with a double separator after it.
- Left in the CARD rather than moved into the page's `toolbarExtras`: every overlay
  toggle is per-card state persisted into that card's slot blob, so a 2- or 3-chart row
  keeps one Overlays menu per chart. Hoisting it to the page would have collapsed all
  of them onto one shared set.

New dock order: Candles - Charts - Replay - Indicators - Layout - **Overlays** -
symbol - timeframe - LIVE - candle count - DTE - Vol+OI/Vol - intensity - actions.

Verified by parsing the edited file with esbuild (tsx loader) and by diffing the
normalised line multiset against the original: the only deltas are the removed
`<DockGap />` and the rewritten block comment. No proxy change.

## 2026-08-06 (e2) - ES Candles: x-axis showed dates instead of times

(Re-filed. This entry was written earlier today and was lost when CHANGELOG.md got
rewritten by the budget.cbedge.net work; the code fix itself is in place.)

The ES Candles time axis rendered a date at nearly every tick, so the clock only ever
appeared on the crosshair and an intraday chart had no visible time scale.

### Root cause
`EsChartCard.tsx` branched on `tickMarkType === 2 || tickMarkType === 3`, commented as
"day/month boundary". Wrong mapping: in lightweight-charts v5 `TickMarkType` is
`0 Year | 1 Month | 2 DayOfMonth | 3 Time | 4 TimeWithSeconds` — **3 is Time**, the type
emitted for nearly every tick on an intraday chart. Sending 3 down the date branch
printed `Aug 6` where `09:30` belonged.

### `components/dashboard/es-candles/EsChartCard.tsx`
- `tickMarkFormatter` now routes only the real calendar boundaries (`0`/`1`/`2`) to the
  ET date string; `3`/`4` format as ET `HH:MM`, 24-hour. Day boundaries still show
  `Mon D` when the visible range spans more than one session.
- Comment replaced with the actual enum values so the off-by-one can't recur.


## 2026-08-06 (e) - budget.cbedge.net step 4: tasks, Today screen, per-person sharing

Phase 1 step 4 of 7. The Today screen is real now — capture, Top 3, open tasks,
Slipping, Resurfacing — backed by `hh_tasks` / `hh_notes` with the per-person
opt-in-sharing rule enforced in SQL. Calendar and Money remain labelled placeholders
(steps 5 and 6).

**Nothing on cbedge.net changed.** No trading route, socket topic, page, proxy or
existing schema was touched.

### `server-v2/household-routes.cjs` — 4 new routes (9 total)
- `GET/POST /api/hh/tasks` — list + create/update/toggleDone/toggleStar/touch/delete.
- `GET/POST /api/hh/notes` — the Resurfacing pool.
- `GET/POST /api/hh/settings` — per-user `slippingDays` (default 7, clamped 1-365).
- `GET /api/hh/today` — the whole screen in ONE round trip (top3 + open + slipping +
  counts + resurfacing + people). Composed server-side so the phone paints once
  instead of in five stages over cellular.

### The visibility rule, defined once
`VISIBLE = (owner_id = $1 OR visibility = 'shared')` is a single constant reused by
every query. Read and write both use it; **delete is deliberately stricter** — you can
complete or edit a shared task, but only its owner can destroy it, because deletion is
the one action with no undo. A query that forgets this clause leaks the other person's
private rows, so it is never hand-rolled per route.

### `due_date` is cast to TEXT — do not "simplify" this back
`due_date` is a Postgres DATE (a calendar day), but `pg` hydrates it into a JS Date at
UTC midnight, which serialises as `"2026-08-10T00:00:00.000Z"`. In Eastern that renders
as **Aug 9** — every due date one day early, and "due today" showing as overdue.
`to_char(due_date,'YYYY-MM-DD')` kills the class of bug at the source, and matches what
`<input type="date">` expects. The client compares dates as STRINGS throughout
(lexicographic on that format is chronological) and never calls `new Date()` on one.

### Slipping
Open, unstarred, `touched_at` older than the user's threshold. Starred items are excluded
— they're already at the top of the screen, so flagging them again is noise, not a nudge.
`touch` ("Still on it") resets the clock without pretending the task changed.

### `budget-vite` — Today screen + optimistic updates
- `src/hooks.ts` — TanStack Query. Every task mutation is optimistic with snapshot
  rollback on failure; a checkbox that waits 400ms on cellular feels broken and gets
  tapped twice. `patchToday()` updates a task across ALL of top3/open/slipping at once,
  because the same task lives in several arrays and patching one leaves a row ticked in
  the top section and unticked twenty pixels below.
- Star is deliberately NOT re-bucketed client-side: top3 membership is a server decision
  (starred + ordered + capped at 3), so guessing locally makes rows jump and jump back.
- `src/components/TaskRow.tsx` — 24px complete button with its own hit area, star,
  expandable row for due date / share toggle / still-on-it / delete.
- `src/pages/Today.tsx` — quick-add first (thumb reach), counts, Top 3, calendar
  placeholder, open tasks, Slipping, Resurfacing, money placeholder.
- `src/pages/Settings.tsx` — slipping threshold, saved-notes manager, password change.

### Verification
- **56/56 integration tests** against a real PostgreSQL 16, driving the actual route
  handlers: schema idempotency, login + lockout, session hashing + expiry, task CRUD,
  ordering (`NULLS LAST`, so undated tasks don't bury dated ones), settings clamping,
  Slipping, Resurfacing stability, empty-state.
  Both directions of the visibility rule are asserted explicitly: neither person can
  read, edit, complete or delete the other's private rows.
- **19/19 date-label tests** including both DST boundaries, month/year rollover, leap day
  and Feb 29 → Mar 1.
- `tsc --noEmit` clean, `vite build` clean, `node --check` on all server files.

**No proxy change** — `proxy-tastytrade.js` and `proxy-thetadata.js` untouched.


## 2026-08-06 (d) - budget.cbedge.net: household life-OS subdomain (auth + shell)

New standalone SPA at **budget.cbedge.net** — a personal life OS shared with one other
person, with budget as one tab. Phase 1 steps 1-3 of 7: its own auth system and a
deployable phone-first shell. Today/Budget screens are labelled placeholders until
steps 4-6.

**Nothing on cbedge.net changed behaviour.** `/owner/budget` is untouched and still
owner-gated. No trading route, socket topic, page or schema was modified.

### New: `budget-vite/` — the SPA
- Vite + React + TS + TanStack Query, phone-first (390px), CB Edge dark palette.
- Mirrors the `owner-vite/` pattern exactly: node build stage → nginx, `docker compose
  build budget` reproduces it, no host npm.
- **Standalone on purpose** — no `@/app/...` alias into the Next app (unlike `app-vite`).
  It builds and deploys without the trading component tree, `GlobalToolbar` or
  `gexSocket`. `src/theme.ts` COPIES the `homeTheme.ts` tokens rather than importing them.
- `nginx.conf` listens on **8083** and proxies **only `/api`** — deliberately narrower
  than owner-vite, which also forwards `/ws` and `/proxy`. This app has no reason to
  reach the market-data stack, so it cannot.
- Login screen names no product and exposes no signup or password-reset route.

### New: `server-v2/_lib-household.cjs` — auth, separate from CB Edge
- Tables self-bootstrap via `CREATE TABLE IF NOT EXISTS` (same pattern as `day_posts`
  and `cb-contract-track`): `hh_users`, `hh_sessions`, `hh_login_attempts`, `hh_tasks`,
  `hh_notes`, `hh_settings`, `hh_google_tokens`. No migration runner.
- **A cbedge.net session grants nothing here, and vice versa.** Different cookie name
  (`hh_session`), and the Set-Cookie carries **no `Domain=` attribute** so the browser
  scopes it host-only to budget.cbedge.net. Never add `Domain=.cbedge.net` there.
- scrypt via `node:crypto` — no new dependency, no native build. The DB stores only the
  SHA-256 of the session token, so a dump yields no live sessions.
- 5 failures per email per 15 min locks out. Unknown-email and wrong-password return the
  same message and burn the same CPU, so neither response nor timing reveals which of the
  two addresses is real.

### New: `server-v2/household-routes.cjs` — `/api/hh/*`
- `login`, `logout`, `me`, `change-password`, `health`. **No signup route by design.**
- `me` is `auth:'public'` returning 401 rather than `auth:'household'`, so a signed-out
  visitor gets clean JSON the SPA can render a form for instead of an HTML redirect.

### New: `server-v2/scripts/hh-user.js`
- `list | add | passwd | profile | sessions-clear`. Accounts are created on the box.

### `server-v2/api-router.js` — two surgical edits
- `enforceAuth()`: new `'household'` branch, placed **before** the `verifyWsRequest` call.
  A household user carries no `cbe_session` and would otherwise be rejected as a
  signed-out visitor. Returns `userId: 'hh:<id>'` so a household id can never be confused
  with a `users.id` downstream.
- Bottom of file: loads `household-routes.cjs` inside a try/catch, exactly like the
  `_lib-*` bundles. If it or `_lib-db.cjs` is missing, `/api/hh/*` is simply never
  registered and boot is unaffected.

### `docker-compose.yml`
- New `budget` service → `budget-web:latest`, bound to `127.0.0.1:8083` (loopback only,
  Cloudflare Tunnel reaches it).

### Budget data — no migration needed
The budget tables were **already multi-profile**: `/api/budget` calls
`getOrCreateBudgetProfile('owner')` and every row is scoped by `profile_id`. So
per-person budget = per-profile. `hh_users.budget_profile_key` defaults to `'owner'`, so
both accounts read the existing register with **zero `ALTER TABLE`, zero backfill**, and
`/owner/budget` keeps working unchanged. The planned ownership-column migration was
dropped as unnecessary.

### Deploy
Needs one manual step outside the repo — add to `/etc/cloudflared/config.yml` above the
catch-all 404: `- hostname: budget.cbedge.net` / `service: http://127.0.0.1:8083`, then
`cloudflared tunnel route dns <tunnel> budget.cbedge.net` and restart cloudflared.

**No proxy change** — `proxy-tastytrade.js` and `proxy-thetadata.js` untouched.


## 2026-08-06 (c) - GEX sign parity: OI-only mode on Multi Greek, abs() on two recorder paths

Chased a report that 0DTE QQQ 720 read strongly POSITIVE on our board while two other
platforms read negative. Not a bug in the arithmetic — a difference in what "net GEX"
means here — plus one genuine latent sign bug found alongside it.

### `app/mult-greek/MultGreekClient.tsx`
- Added a third **`OI`** option to the contract-basis toggle (was `OI+VOL` / `VOL` only).
  Default is unchanged (`oivol`).
- **Why.** Every other GEX vendor publishes OI-ONLY net GEX. This page had no OI-only
  mode, so its numbers were never comparable to theirs — and on 0DTE they can carry the
  OPPOSITE SIGN. 0DTE open interest is yesterday's close (often ~0 at a strike that only
  came into play this morning) while today's volume is 10-50x larger, so `OI+VOL` is
  effectively pure VOLUME GEX at those strikes. Volume GEX is signed with the OI
  convention — ALL call volume treated as dealer-long, ALL put volume as dealer-short,
  with no buy/sell classification of the tape — which pins any heavily-traded call strike
  strongly positive even when the OI book there is net short gamma. That is exactly the
  QQQ 720 case.
- `strikeGex()`'s 4th arg went from `volOnly: boolean` to `mode: ContractMode`
  (`"oivol" | "vol" | "oi"`); the same value now threads through `computeRows()`, the
  panel prop, and the delta-stamp history effect, so the 15m/30m/open change stamps are
  computed on whichever basis is displayed rather than always on the OI+Vol one.

### `server-v2/etf-gex-recorder.js` — sign bug
- `Math.abs()` on both gammas before the netGEX / netVolGEX reduction.
- Gamma is positive for calls AND puts; the put leg's short-gamma polarity is carried by
  the MINUS sign in the formula, not by the greek. A signed (negative) put gamma from
  upstream made `- pGamma * pOI` ADDITIVE, silently flipping that strike POSITIVE in the
  recorded SPY/QQQ history. `computation/gex-calculator.js` and the client both abs their
  gammas; these two paths were the only places in the repo that did not.

### `server-v2/state/ticker-wall-recorder.js` — same sign bug
- Same `Math.abs()` fix. Here the failure mode is a put wall being recorded as a call
  wall.

**No proxy/server-with-proxy change. No API, schema, socket-topic or route change.**

## 2026-08-06 (b) - Home rail: CPG Ratio → Net GEX Rate, + per-strike GEX rate

Replaced the CPG (call/put gamma) ratio tile on the /home gauge rail with a Net GEX
RATE tile, and added a matching per-strike rate mode to the heatmap. The ratio described
the SHAPE of the book; the rate describes how fast it is being built or pulled.

### `components/dashboard/HomeGaugeRail.tsx`
- `CPG RATIO` tile → **`NET GEX RATE / MIN`**: $B of gamma-per-1%-move added (+) or
  pulled (−) per minute. Signed meter, self-scaling to today's fastest observed move
  (floored at 0.1 so a quiet tape doesn't swing the needle on noise).
- Derived inside the component from the GEX history the rail already keeps — no new
  prop, no new socket topic, no extra fetch.
- Δ is measured against the newest sample ≥30s old and ≤180s old, then normalised to
  per-minute by the ACTUAL elapsed span. Samples are 15s-bucketed and feed cadence
  drifts, so a raw last-minus-reference would silently scale with how stale the
  reference happened to be. Spans under 30s are rejected rather than divided through —
  dividing a small Δ by a few seconds manufactures a huge rate out of feed jitter.
- Removed now-unused `cpg` prop, `fmtRatio` / `fmtAbsRatio`.

### `hooks/useStrikeGexRate.ts` (new)
- Per-strike net GEX rate ($ per 1% move, per minute) sampled client-side from the live
  heatmap rows (15s cadence, ~2min ring), same span guards as the tile.
- **Deliberately not another `useStrikeGexHistory` age bucket.** The stored per-strike
  series is written by `gex-history-writer.js` on a ~60s cadence AND each row is an
  average of the ~12 recomputes in that window, so a "1 minute ago" baseline from it is
  0–120s old and pre-smoothed — neither 1-minute nor a rate. **No proxy/server change.**

### `app/home/HomeClient.tsx`
- Heatmap Δ selector gained a **`rate`** option (`Δ off | rate | 5m | 15m | 30m`);
  `deltaWindow` type widened to `0 | 1 | 5 | 15 | 30`.
- In rate mode the NET GEX column header reads `NET GEX +Δ/MIN` and the ranked-strike
  stamps show per-minute rate with a `/m` suffix; tooltip reads "Building/Decaying
  …/m · #N fastest mover (X.X%/min)".
- Noise floor is 0.25%/min in rate mode (vs 1% for the cumulative windows) — a rate is a
  smaller number than a 5/15/30m cumulative move, so the 1% cut would have blanked most
  of the board.
- Rate mode is served entirely by the new hook, so it no longer keeps `/proxy/gex-history`
  warm (`deltaWindow > 1` now gates that poll instead of `!== 0`).
- Dropped the CPG dollar-gamma sums from `gaugeMetrics`; it now computes `gammaPctVol` only.

### Notes
- Sign convention is unchanged from the existing 5/15/30m stamps (`d = live − past`), so
  on a PUT wall (negative net GEX) a shrinking wall reads positive/green. Consistent with
  what the other windows already show rather than a second convention.
- Verified: all three files compile (esbuild); rate math unit-tested for clean 60s span,
  normalisation across a 90s span, the <30s jitter guard, the >180s stale guard, decay,
  and flat. Declaration order checked — `heatmapRows` (L1187) precedes the hook call
  (L1370), so no TDZ.

## 2026-08-06 - GEX chart expiry picker: wrong DTE labels & failed switching

Home GEX chart showed Wed/Thu in the expiry picker on a Thursday (should have been
Thu/Fri = 0DTE/1DTE), the bars kept changing on their own, and switching between the
two entries didn't stick. Server restarts didn't help. Other heatmaps were unaffected.

### Root cause
Two independent defects compounding:

1. `server-v2/proxy-tastytrade.js:2284` published the **unfiltered** chain expiration
   list to `marketState`, including already-expired dates. The REST route
   `fetchExpirations()` (line ~1577) has always filtered `>= today` — which is exactly
   why every OTHER heatmap looked right and only the WS-fed home GEX chart was wrong.
2. `buildExpiryOptions()` in `app/home/HomeClient.tsx` labelled the picker by **array
   position** (`${index}DTE`), not by date. So one stale leading entry shifted every
   label by one: Wed→"0DTE", Thu→"1DTE".

`setExpirations()` was also only ever called once at feed startup, so after a date
change the picker kept serving the previous day's array while `this.expiry` had already
auto-rolled. Selecting the stale entry was reverted by the auto-roll block on the very
next `_recompute()` tick — that fight is what made the bars appear to change on their
own and made switching back and forth fail.

### `server-v2/proxy-tastytrade.js`
- Feed startup now filters expirations to today-forward before `setExpirations()`;
  falls back to the raw list if the filter empties it. Default expiry derives from the
  filtered list.
- Auto-roll block (`_recompute`) now re-publishes the today-forward list via
  `setExpirations()` **before** rolling, so the picker no longer goes stale across a
  date change. `next` is chosen from the filtered list.
- Startup log now reports today-forward count alongside the raw count.

### `app/home/HomeClient.tsx`
- `buildExpiryOptions()` rewritten to label by **real calendar DTE** instead of array
  index. Added `etYmdToday()` (ET via `Intl.DateTimeFormat`, matching the server's
  `todayYmd()`) and `daysBetweenYmd()` (parses at UTC midnight so DST can't round the
  difference wrong). Negative-DTE entries are dropped rather than shifting labels.
- Self-correcting: even if a stale date reaches the client, labels stay right.

### Notes
- Labels are now true calendar DTE, so Monday reads `3DTE`/`4DTE` from a Thu/Fri rather
  than `2DTE` — this matches the other heatmaps and the REST-fed pages.
- Verified: both files compile (`node --check`, `esbuild`); label logic unit-tested
  against the reported Wed/Thu case plus weekend-gap and DST-boundary inputs.
- No proxy request/routing behavior changed — only which expiration dates are published.

## 2026-06-18 (session 30) - Heatmap/Snapshot UI, Vol-GEX Fix & Dev Symbol Probe

### `app/home/page.tsx`
- GEX heatmap intensity slider min lowered `0.2` → `0.1` (range now .1–3.0)
- Removed the duplicate 📸 record-snapshot button from the heatmap header (kept the camera screenshot button)
- `GEX + VEX` column replaced with `Net VEX` (vanna only)
- Top toolbar: added visible `│` spacers between quotes (VIX/ESU/SPX) and between NET GEX / CALL WALL / PUT WALL / FLIP
- ATM heatmap row now framed with a light white border across all columns (heatmap only, not snapshot)
- **MVC bug fix:** header MVC now respects the active `dataMode` (Vol-Only uses `netVolGEX`, OI+Vol uses the composite) instead of always using OI-based `netGEX`

### `components/dashboard/SnapshotPanel.tsx`
- Top metrics grid and Option Flow Tops grid changed from 2-across to 4-across to fit one screen

### `components/dashboard/FlowTape.tsx`
- Added a `Side` column showing explicit `BUY` (ask/aggressive buyer, green) / `SELL` (bid/aggressive seller, red) with rule-of-thumb sentiment tooltips

### Vol-GEX volume source fix — `server-v2/proxy-tastytrade.js`
- Root cause of false MVC (7475 ranked #1 vol-GEX with ~0 live volume): per-strike volume fell back to the REST `volume` field, which carries stale prior-session cumulative volume
- Now stores live `dayVolume` even when 0 (presence = authoritative), and only falls back to REST volume when the stream has never delivered a print

### Dev symbol probe (rebuilt) — `app/dev/page.tsx`, `server-v2/proxy-tastytrade.js`, `server-v2/server-with-proxy.js`
- Rebuilt `/dev` (was `return null`): pick Side/Strike/Expiry/Feed → builds `.SPXW…` symbol → `GET /proxy/probe` returns raw feed data + timing
- Reads the same live proxy maps the GEX chart uses (greeks/quotes/volumes/summaries)
- On-demand subscribe for uncached symbols: subscribes, page polls until data arrives, reports server-measured `waitedMs`, auto-unsubscribes after 15 min (`DxLinkClient.unsubscribe`, `probeSubs` TTL map)

### Version
- `package.json` bumped `2026.6.18-v50` → `v52` across the session

## 2026-06-18 (session 29) - Proxy Removal & Vanilla Archive

### Objective
Remove all proxy-dependent code in preparation for a full proxy rebuild from scratch. Archive the Vanilla JS dashboard so it is not touched by AI tooling.

### Proxy Calls Removed / Stubbed
All proxy fetch calls removed or replaced with no-ops across:
- `Vanilla/pages/overview/overview.js` — quotes-batch, debug-summary, prev-closes, auto-connect, greeks-intraday, db/insert, db/query, backup/buy-sell-scores, es-stats, chains, discord-webhook, twitter, levels
- `Vanilla/shared/overview.js` — token exchange, logout, proxyGet, fetchGEX chain, lazy DTE chain, all quotes-batch blocks, auto-connect, compare GEX, buy-sell score backup/restore, SPY/QQQ chain, equity ticker chain, schwabAdapt chain
- `Vanilla/pages/mult-greek/mult-greek.js` — `/proxy/dxlink/subscribe`
- `Vanilla/pages/insights/options-chain/options-chain.js` — `/proxy/dxlink/subscribe`
- `Vanilla/shared/spx-flow.js` — `/proxy/dxlink/subscribe`
- `Vanilla/futures_flow.js` — quotes-batch
- `Vanilla/live-signals-vanilla.js` — `/proxy/api/levels`
- `Vanilla/flow-recorder.js` — quotes-batch
- `Vanilla/updateDailyEM_replacement.js` — early throw before all chain/quotes fetches

### Archive Created
- `archive-vanilla.ps1` script executed — moved `Vanilla/` folder and all `proxy*.js` root files into `_ARCHIVED_DO_NOT_EDIT/`
- `_ARCHIVED_DO_NOT_EDIT/README.md` written to prevent AI tools from reading or modifying archived content

### Folder Cleanup (identified, script ready)
- Identified stale root files: log files, `.bat` scripts, duplicate `.md` files, `tastytrade_token.json`, corrupted DB, empty `bzila-dashboard/` folder
- Cleanup PowerShell script provided; awaiting user confirmation on 3 files (`build_spx_ohlc_5m.mjs`, `estimated-moves.*`, `gex_levels.csv`)

### Version
- `package.json` bumped to `2026.6.18-v39` and pushed to GitHub

## 2026-06-17 (session 28) - Sidebar Page Shortcuts Moved Into Grid Menu

### `components/shared/Sidebar.tsx`
- Moved the page shortcut list into the 4-box grid button popout
- Removed the separate shortcuts block from the sidebar rail so the left column stays compact
- The grid button now highlights when the page menu is open or when one of the listed pages is active

## 2026-06-17 (session 27) - Dashboard Route Removed from Navigation

### `app/dashboard/page.tsx`
- Replaced the dashboard page with a redirect to `/home` so the old proxy-control route no longer serves a separate screen

### `components/shared/Sidebar.tsx`
- Removed the dashboard shortcut from the persistent sidebar so the page is no longer exposed in the left rail

### Intent
- The shared sidebar now points users at the home page and other working sections only, keeping the dashboard control surface out of sight

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
