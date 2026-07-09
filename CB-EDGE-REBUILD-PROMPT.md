# CB Edge — Full Rebuild Prompt (give this to a coding agent)

You are building **CB Edge**, an options/futures trading dashboard (SPX/ES/NQ focus), from scratch. Follow this spec exactly. Ask before deviating from stated conventions.

## Stack
- Next.js (App Router) + TypeScript, deployed via Docker on a VPS.
- Postgres for all persistent data (levels, snapshots, EOD records, chat, admin logs).
- Auth: Supabase Auth with JWT custom claim `is_owner` for owner-only routes (not Clerk — deprecated).
- Market data: ThetaData for options/stock/index (OI, quotes, greeks, historicals); TradeStation/TT for futures (ES/NQ); dxLink feed for live ES 5m candles.
- Realtime: single `/ws/gex` WebSocket multiplexing GEX, flow, and esCandles frames — gated by auth + active subscription (`WS_AUTH_REQUIRED`).
- Deploy split: commits/pushes happen only from the Windows dev machine; the VPS only pulls and rebuilds (`docker compose up -d --no-deps --build`, never a full rebuild unless deps changed).

## Core conventions (bake these in from day one, not as retrofits)
1. Every dashboard page uses `PageShell` + `Card` from a shared `PageCard.tsx`, sourcing colors from a single `HOME_THEME`/`homeTheme` object. No hardcoded hex/rgba anywhere.
2. Every GEX surface (levels, heatmap, dashboard) ships two bases by default: **OI+Vol combined** and **Vol-only** — never just one.
3. Owner-only routes (`/owner/*`, `/dev`, `/budget`, admin tools) are gated in middleware, fail-closed if the owner claim/env var is unset.
4. RTH-only session logic: prior-day/week high/low and settle baselines must group bars by true ET session date, and coerce timestamp columns defensively (don't trust column type).
5. New pages register in a draggable "Quick Pages" sidebar zone (max 4 pinned, localStorage-backed) and get the standard `.card-hover` lift+cyan-highlight treatment automatically for 16px-radius panels.
6. Use `Promise.allSettled`, not `Promise.all`, for any multi-source dashboard fetch — one dead source shouldn't blank the page.

## Phase 1 — Foundation
- Auth (Supabase, JWT owner claim), Postgres schema, middleware route gating, maintenance-mode toggle.
- Theme system: `PageShell`, `Card`, `HOME_THEME`, `.card-hover`.
- WS server: `/ws/gex` with lifecycle management (pause on background tab, 15-min idle disconnect) and payload diffing to avoid bandwidth leaks.
- Data adapters: ThetaData proxy (options/stock/index chains, quotes, greeks) and TT/TradeStation proxy (futures), plus dxLink ES candle ingestion.

## Phase 2 — Core dashboard pages
- **Home**: server-rendered stat bar (VIX, SPX, GEX summary) full-width, no client waterfall.
- **GEX Levels**: SqueezeMetrics-style dashboard with history + heatmap, OI+Vol and Vol-only.
- **ES Candles**: live 5m OHLCV chart, GEX heatmap overlay (Call/Put/Flip lines), TPO/volume profile toggle (VAH/VAL/POC/Mid only), momentum bias index toggle, live SPX basis badge (not frozen prior-day), NQU parallel candle pipeline.
- **Flow**: multi-ticker via a `MultiFlowManager`, net-premium sparkline spanning full session, dark-pool TRF-print tape + accumulation chart (Intraday/5D/7D).
- **EM (Expected Move) Tracker**: `ticker_levels` table driving customer-facing levels, Postgres-backed snapshots (not IndexedDB), Saturday 9am ET auto-publisher with a disk-persisted week guard, win/loss scoring against the finalized weekly candle (never intraweek).
- **Regime Engine**: HMM (Trend/Chop/Panic) with ESU/NQU toggle, Viterbi persistence gate, 30-day rolling refit+validation trainer.

## Phase 3 — Analytics & scoring
- Confidence Score (0–100 Hit/Pivot/Chop per level), auto-collected every 30 min RTH with a holiday/half-day gate.
- Strike Growth Tracker (ranks strikes by Δ$ GEX).
- Balance/Imbalance tab (AMT quadrant vs prior-day Value Area).
- ICT setup recorder (auto-graded win/loss capture).
- Signals engine: alerts-only GEX/CB (formerly "MVC," same DB, relabeled) signal generator meant to back a future trading bot, plus a standalone backtest script that replays the real engine against history.
- EOD recorder writing daily GEX snapshots per ticker (SPX/SPY/QQQ) and a CB-reach backtest (distance-at-2pm predicting touch — thin sample, informational only, not bot-ready).

## Phase 4 — Owner/admin tooling
- `/owner/*` consolidated under one gate: dev/admin tabs, controls (idle/MVC toggles, reconnect/redeploy), page-activity auto-tracking, masked API key display, customer activity (last login/time on site), "not paying" live segment + broadcast audience.
- Admin email broadcast (Resend) with a global unsubscribe-suppression table that filters every audience list, not just one.
- Budget page: owner-only check register with running balance + recurring rules.
- Traders Dashboard: morning brief with schedule, weather, futures, AI-generated overview via cron.

## Phase 5 — Chat & misc
- Subscriber chat via Supabase Realtime (native Supabase auth, not a Clerk JWT template).
- Right-side push panel for notes (not sidebar-embedded).
- Screenshot/export via html2canvas with a shared `captureElement` helper; avoid `height:auto` on cloned nodes, do DOM injection in `onclone`.

## Known pitfalls to design around up front
- Provider settle-timing mismatch: expect ~25–30% OI gaps between ThetaData and TT/CBOE around settlement — don't treat as a bug.
- SPX broker price ≠ Yahoo `^GSPC` — always center EM/level math on the live chain price, not a free quote source.
- Index options (SPX/NDX) price under the equity-option endpoint, not index-option.
- WebSocket auth/session gating is easy to get half-applied — verify every socket path checks the Clerk-successor (Supabase) session and active subscription, not just page-level middleware.

## Deliverable
Ship phases in order; each phase should be independently deployable (build passes, VPS docker rebuild succeeds) before starting the next. Do not batch all phases into one PR.
