# Handoff: move background jobs off the live server's core

**Repo:** `C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed` (GitHub `bjmuzila/dash`, VPS `/opt/dashboard`, deploy with `push.ps1`)
**Written:** 2026-10-09, after the slow trading morning described below.
**Goal:** the user-facing server (site, Vela, API, live stream) gets its own CPU core, and no background job can ever slow it down again.

---

## 1. Why this exists (read first)

The CB Edge server is ONE Node.js process: `node server-v2/server-with-proxy.js`, in the `dashboard` container in `docker-compose.yml`. Node runs all of a program's JavaScript on one core. That one process currently does everything:

- the TastyTrade / dxLink live feed
- the `/ws/gex` live stream to browsers
- every API request (Vela, dashboard, owner pages)
- Next.js (still the front door: login, middleware, public pages)
- **~50 background jobs** ("recorders", writers, Discord posters, emails)

On 2026-10-09 the VPS (Hetzner, 4 vCPU AMD EPYC, 15 GB) had plenty of spare CPU: steal 0, iowait 0. But the dashboard process sat at ~118% (one core maxed) and Postgres at ~149%. Health panel: event-loop stalls up to 6.6 s, 143 stalls over 250 ms. The causes:

1. `etf-candle-recorder.js` re-pulled every 1m bar since midnight for 169 tickers every minute. Each tick ran 61–74 s against a 60 s interval.
2. The GEX-history ladder query (`_lib-db.cjs getOptionStrikeGexSlots`, 5–9 s each) ran in several parallel copies.
3. The strike-growth feed refresh fired ~100 tickers' REST chain pulls at once every 5 min (`proxy-tastytrade.js startStrikeGrowthFeed`).
4. A restart at 09:18 ET ran all the boot-time work into the open.

Items 1–3 are already fixed in code (see §7). **This handoff is the structural fix:** background jobs run in their own container with a CPU cap, so even a badly behaved job only slows itself.

Vela is expected to grow from ~9 to ~300 users. Every core the site doesn't have to share matters.

---

## 2. Target architecture (step 1 only)

```
dashboard container   ROLE=web   (unchanged image)
  - TastyTrade/dxLink feed, ES/NQ candle builder, OI refresh
  - strike-growth feed + strike-growth recorder (reads feed memory, stays)
  - /ws/gex live stream, all HTTP: api-router, /proxy/*, Next.js
  - NO other background jobs

jobs container        ROLE=jobs  (SAME image, same .env.local)
  - every recorder / writer / poster / email job in §4 group 2 and 3
  - calls the web container over the compose network (http://dashboard:3001)
    instead of http://127.0.0.1:PORT
  - docker compose `cpus: "1.5"` (tune after measuring), restart: unless-stopped
  - no published ports, no WebSocket server, no Next.js, no live feed
```

Step 2, NOT part of this handoff: several web workers behind one feed process. That needs the feed separated from the API first. Do it only if the Vela load test shows step 1 isn't enough.

---

## 3. How the jobs are wired today

All of them start in one block near the end of `server-v2/server-with-proxy.js`. Search for `startEtfCandleRecorder();`; the block runs from `startMvcAutoSnapshot` through `startStrategyGenerator`, about 300 lines. Patterns:

- **`startX(PORT)`**: the job calls the server over HTTP at `http://localhost:${port}` / `http://127.0.0.1:${port}`, e.g. `daily-grades-recorder.js` (`const base = \`http://localhost:${port}\``). These are the easiest to move: point them at a configurable base URL.
- **`startX()` with no port**: self-contained. It reads/writes Postgres and pulls TastyTrade REST or opens its own dxLink connection by importing helpers from `./proxy-tastytrade` (16 files do: `fetchChainFull`, `fetchOpenInterest`, `fetchIntradayCandlesMulti`, …) or `./tt-snapshot` (9 files).
- **`startStrikeGrowthRecorder(PORT, proxy)`**: takes the live `proxy` object and reads its in-memory maps (`getStrikeGrowthSnapshot`). **Stays in web.**
- `startGexChangeTopRecorder(PORT, { … })` passes options. Check what they are before moving it.
- Some jobs may read shared in-memory singletons, e.g. `state/market-state.js` (`marketState.getState()`). **In a separate process that state is empty.** Each job must be checked for this.

---

## 4. Inventory

Cadences come from the code as of v10.9.5. "Feeds" is what reads its output.

### Group 1: live feed. STAYS in web.
| Job | Where | When |
|---|---|---|
| TastyTrade/dxLink feed (SPX chain, greeks, quotes) | `proxy-tastytrade.js` | constant |
| ES/NQ 1m + 5m candle builder | `proxy-tastytrade.js` `_flushEs1mCandles` etc. | flush 5 s / 10 s |
| OI refresh for the active chain | `proxy-tastytrade.js` `_scheduleOiRefresh` | minutes |
| Strike-growth option feed (~100 watchlist tickers) | `proxy-tastytrade.js` `startStrikeGrowthFeed` | refresh every 5 min (now sequential) |
| Strike-growth recorder | `strike-growth-recorder.js` (takes `proxy`) | rolling sweep |
| GEX history writer (called by the feed with its in-memory snapshot) | `gex-history-writer.js` `writeGexSnapshot`, invoked from `proxy-tastytrade.js` (and `etf-gex-recorder.js`) | 30 s | 
| `/ws/gex` broadcaster | `websocket-server.js` | constant |

### Group 2: all day in market hours. MOVE to jobs.
| Job | File | When | Feeds |
|---|---|---|---|
| Stock/ETF 1m candles (169 tickers) | `etf-candle-recorder.js` (server-v2 root; `state/etf-candle-recorder.js` looks like an older copy, so check which is required) | 60 s | Vela + stock charts |
| Greeks time series | `greeks-ts-writer.js` | 30 s | greek charts |
| ETF GEX recorder | `etf-gex-recorder.js` | 60 s | ETF boards |
| Mult-Greek GEX recorder | `mult-greek-gex-recorder.js` (loaded as `multGreekGexRecorder` in server-with-proxy.js; check how and where it is started) | 60 s | Mult-Greek |
| Scanner sweep | `scanner-recorder.js` | 09:29, then every 15 min | scanner |
| Walls recorder | `walls-recorder.js` | 09:29, 09:45, every 15 min | `walls_log` (Voltick Walls, Path history) |
| Far-CB recorder (~150 tickers) | `far-cb-recorder.js` | rolling sweep | watchlist core levels |
| Forward scanner | `forward-scanner-recorder.js` | 18:00 | scanner |
| GEX change-top | `gex-change-top-recorder.js` | 30 min | scanner tab |
| Greek scanner | `greek-scanner-recorder.js` | ~5 min | greek scanner |
| Signals engine (whale poll) | `signals-engine.js` | 20 s | alerts |
| Econ alerts | `econ-alert-recorder.js` | 20 s | Discord |
| Discord relay | `discord-relay.js` | 15 s | Discord |
| Watch recorder | `watch-recorder.js` | 60 s | watch |
| CB trade tracker | `cb-trade-recorder.js` | 60 s | trades |
| Condor marks | `condor-mark-recorder.js` | 5 min (16:00–16:15 close marks) | condors |
| Momentum bias grader | `momentum-bias-tracker.js` | 5 min | momentum |
| Ref levels | `ref-levels-recorder.js` | 5 min | ref levels |
| Strategy generator | `strategy-generator.js` | 3 min, 14:00–17:00 | strategy |
| Overview / premarket summary generators | `overview-generator.js`, `premarket-summary-generator.js` | 10 min | summaries |
| EM tracker auto-eval | `em-tracker-auto-eval.js` | 15 min | EM tracker |
| Home / preview / Mult-Greek snapshots | `home-snapshot-recorder.js`, `preview-snapshot-recorder.js`, `mult-greek-snapshot-recorder.js` | 30 min | snapshots |
| MVC auto-snapshot | `mvc-auto-snapshot.js` | interval | MVC |
| Align archiver | `startAlignArchiver()`, defined inside `server-with-proxy.js` | check | Align tab |
| MG ladder / levels text Discord | `mg-ladder-discord.js` | scheduled | Discord |

### Group 3: once a day. MOVE to jobs.
| When (ET) | Jobs (file) |
|---|---|
| 08:00–10:00 | econ calendar Discord (`econ-calendar-discord.js` ~07:50–08:01), budget email (`budget-email.js` 08:00), earnings calendar (`earnings-calendar-recorder.js` 09:00), customer lifecycle emails (`lifecycle-email-scheduler.js` 10:00) |
| **09:26–09:45** | daily grades (`daily-grades-recorder.js` 09:26 + 16:20 seal), **OI for every ticker one by one (`oi-daily-recorder.js` 09:32)**, scanner/walls first sweeps |
| 15:55–16:40 | EOD DTE gamma (`eod-dte-gamma-recorder.js` 15:55), EOD GEX (`eod-gex-recorder.js`), EOD strike GEX every ticker (`eod-strike-gex-recorder.js` 16:05), GEX watch/gross (`gex-watch-recorder.js`, `gex-gross-recorder.js` 16:05), ATM premium (`atm-prem-recorder.js` 16:05–20:00), levels history (`gex-levels-history-recorder.js` 16:10), levels auto-publish (`levels-auto-publish.js` 16:15), premarket freeze/replay (`premarket-freeze-recorder.js`, `premarket-replay-recorder.js` 16:25), day post (`day-post-writer.js` 16:03), IB results (`ib-results-recorder.js` 16:30) |
| Evening / periodic | `state/retention-cleanup.js`, `state/perf-indexes.js`, `state/ticker-wall-recorder.js` |

The open is crowded: 4 heavy jobs between 09:26 and 09:45, exactly when users log on. While you're in there, stagger them (e.g. OI daily to 09:40, daily grades a few minutes earlier).

---

## 5. Step-by-step

1. **Audit each job in §4 groups 2–3** and record one row per job:
   - Does it read in-memory state from the web process (`proxy`, `marketState`, module-level caches filled by the feed)? If yes: switch it to HTTP against the web container, or keep it in web.
   - Does it use `port` / localhost? Then it gets a base URL.
   - Does it open TastyTrade REST or dxLink itself? See risk #1.
   - Does it send `x-internal-token` (`INTERNAL_API_TOKEN`) on its HTTP calls? `/proxy/*` is gated by `proxy-auth.js` when `PROXY_AUTH_REQUIRED=1`.
2. **Add a role switch.** `process.env.ROLE`: `web` (default, today's behaviour minus moved jobs), `jobs`, or `all` (today's exact behaviour, kept as a rollback). In `server-with-proxy.js`:
   - `ROLE=jobs`: don't start the HTTP server, Next.js, the WS server or the TastyTrade proxy. Start only the job list. You may need a small `server-v2/jobs-main.js` entry point that requires the same modules instead of branching inside the 11k-line file. Prefer that.
   - `ROLE=web`: skip the moved jobs.
3. **Base URL.** Add `INTERNAL_BASE_URL` (default `http://127.0.0.1:${PORT}`, in jobs `http://dashboard:3001`) and make every job's localhost URL use it.
4. **Compose.** Add a `jobs` service to `docker-compose.yml`: same `image: bzila-dashboard:latest`, no `build:` (reuse the dashboard image, so pushes don't build twice), `env_file: .env.local`, `environment: ROLE=jobs, INTERNAL_BASE_URL=http://dashboard:3001`, `cpus: "1.5"`, `restart: unless-stopped`, `depends_on: [dashboard]`. Mount `./state` only if a job writes files there (check). The dashboard service gets `ROLE=web`.
5. **Health.** Have the jobs process expose its own small health (or push heartbeats into Postgres) so `healthz.cjs` recorder freshness keeps working. `healthz.cjs recorderSection` already checks freshness by DB timestamps, which still works across processes.
6. **Test after hours:** both containers up; every recorder's table still gets fresh rows (the healthz recorder section shows ages); no duplicate rows (nothing runs in both); `docker stats` shows dashboard CPU lower.
7. **Rollback:** set `ROLE=all` on dashboard and stop `jobs`. That's exactly today's behaviour.

---

## 6. Risks to verify BEFORE shipping

1. **TastyTrade sessions.** Jobs that import `./proxy-tastytrade` / `./tt-snapshot` helpers would log in to TastyTrade from a second process. Confirm a second concurrent API session and a second dxLink connection don't invalidate the web process's session or exceed account limits. Read how auth works in `proxy-tastytrade.js` (OAuth refresh vs session login). If it's a problem, those jobs fetch through the web container's HTTP (`/proxy/...`) instead of TastyTrade directly.
2. **In-memory state.** Any job reading `marketState` or `proxy` maps gets empty data in the jobs process. Either fetch over HTTP or keep it in web.
3. **Double running.** After the split, a job must run in exactly one role. Add a startup log line listing which jobs each role started, and check it.
4. **Postgres pool size.** Two processes means two sets of pools. `max_connections=150`; ~26 connections in use on 2026-10-09. `_lib-db.cjs` uses `max: 10`, and several recorders create their own `pg` pools (e.g. `etf-candle-recorder.js getPool`). Count them before doubling.
5. **Market-hours deploy guard.** `push.ps1` now refuses to push 09:00–16:15 ET weekdays unless `-Force`. Ship this after the close.

---

## 7. Already done on 2026-10-09 (context, don't redo)

- `etf-candle-recorder.js`: each tick pulls only the last 15 min, with a full-day sweep every 15th tick. Market-hours restarts skip the 5-day boot backfill.
- `api-router.js`: the GEX history heatmap route shares in-flight DB queries (`oneFlight`) and caches the per-date expiry lookup. The `/api/chains` health probe says which ticker failed and why.
- `proxy-tastytrade.js`: the strike-growth refresh is sequential and non-overlapping.
- `push.ps1`: market-hours guard (`-Force` to override).
- `server-with-proxy.js`: redirect table `RETIRED_NEXT_PAGES` for 22 deleted Next pages. Moved code lives in `components/legacy/`.
- Temporary VPS env `ETF_CANDLE_WIDE_MAX=60` and `ETF_CANDLE_BACKFILL_DAYS=0` in `/opt/dashboard/.env.local`. Remove both once the above is deployed.

## 8. Related work queued elsewhere (not this handoff)

- Vela for ~300 users: share every Vela read (one computation per symbol per refresh, same bytes to everyone), slow the 15 s flow studies to 30–60 s, make the 2026-10-09 "ES overnight / Globex" reads not pull extra history during the cash session, Sunday load test, staged rollout.
- `push.ps1` / Dockerfile: build only changed services. Next.js is rebuilt on every push (~10 min) because `COPY . .` and the per-push `package.json` version bump invalidate it.
- Remove Next.js entirely (everything Vite). Inventory: ~65 API routes still on Next (incl. auth + Stripe), `middleware.ts`, ~17 public pages. Do after the Vela launch.
- Move builds off the VPS (GitHub Actions → registry → pull).
