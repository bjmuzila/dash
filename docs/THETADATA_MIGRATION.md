# ThetaData Migration Plan (Hybrid: Options → Theta, Futures → TastyTrade/dxLink)

**Status:** Proposal / not started
**Author:** generated from a code + docs audit on 2026-06-24
**Scope decision:** ThetaData does **not** sell futures data. ES candles, ES settle, the
ES-derived overnight SPX, and the futures watchlist therefore **stay on TastyTrade +
dxLink**. Everything options-and-index (the SPX/NDX chain, greeks, IV, OI/volume, the
option trade tape, and all historical option backfill) moves to ThetaData. This is a
**hybrid** cutover, not a provider replacement.

---

## 0. TL;DR

- Keep `proxy-tastytrade.js` alive but shrink it to **futures-only** (ES quote/trade/candles,
  ES settle baseline, futures watchlist quotes). Everything else it does today is replaced.
- Add a new `proxy-thetadata.js` that owns: SPX/NDX option chains, per-strike greeks, IV,
  OI, volume, the option trade tape (flow), index spot (SPX/VIX), and historical backfill.
- ThetaData requires a **local Java "Theta Terminal" process** running next to `server-v2`.
  On the VPS this becomes a second container/service in the Docker stack. This is the single
  biggest infra change.
- **NDX is the cost trap.** Real-time NDX + NDX history require the **PRO** options *and*
  PRO index tiers. SPX/VIX work from Standard. Budget for PRO if NDX EM/zones must stay live.
- Net result: identical dashboard semantics (GEX walls, EM, MVC, confidence, flow), fewer
  moving parts on the options side (no dxLink handshake, no OCC-padding OI reconciliation, no
  CBOE cross-check), at the cost of one extra local process and a real monthly data bill.

---

## 1. Why switch

(Confirm these against your own reasons — the plan holds regardless.)

- **Data quality / OI:** today OI is stitched from dxFeed `Summary` (unreliable per-strike) +
  a TastyTrade REST `/market-data/by-type` backfill + a CBOE delayed-quotes A/B check in
  `fetchYahooContractOI`. ThetaData reports **OPRA open interest** directly (`option_snapshot_open_interest`),
  removing the three-way reconciliation and the OCC-whitespace normalization hacks
  (`normalizeOcc`) that exist only because TT and CBOE pad OCC symbols differently.
- **Historical depth:** you currently have no real historical option store — MVC/confidence
  analogs are built from live snapshots written forward. ThetaData gives tick/1-min option
  history back to **2016 (Standard)** or **2012 (Pro)**, which is exactly what the confidence
  analog engine and MVC backtests want.
- **Greeks:** today greeks are computed locally (Black-Scholes in `computation/utils.js`)
  from spot + IV + mid because dxFeed greeks are partial. ThetaData serves first/second/third
  order greeks and IV server-side, so you can either consume theirs or keep your BS path and
  use theirs as the cross-check.

---

## 2. What moves vs what stays (the hybrid boundary)

| Capability | Today (source) | After migration |
| --- | --- | --- |
| SPX option chain (strikes/expirations) | TT REST `/option-chains/{u}/nested` (`fetchChain`) | **Theta** `option_list_expirations` + `option_list_strikes` / `option_list_contracts` |
| Per-strike greeks | local BS (`bsGreeks`) from streamed IV/mid | **Theta** `option_snapshot_greeks_*` (or keep BS, Theta as truth) |
| Implied volatility | dxFeed Greeks event / BS solve (`impliedVol`) | **Theta** `option_snapshot_greeks_implied_volatility` |
| Open interest | dxFeed `Summary` + TT REST backfill + CBOE check | **Theta** `option_snapshot_open_interest` (OPRA, ~06:30 ET) |
| Per-strike volume | TT REST `/market-data/by-type` (`fetchOpenInterest`) | **Theta** snapshot/quote `volume` |
| Option trade tape → flow | dxFeed `Trade` events → `FlowProcessor` | **Theta** Options **Trade Stream** (WS) → same `FlowProcessor` |
| SPX spot | dxFeed Quote on `spotSymbol` | **Theta** `index_snapshot_price` / index Price Stream (`SPX`) |
| VIX | dxFeed Quote on `vixSymbol` | **Theta** index Price Stream (`VIX`) |
| Option/index historical backfill | none (forward-written snapshots) | **Theta** `*_history_*` endpoints |
| **ES 5-min candles** | dxLink Candle sub → `_flushEsCandles` → `es_candles` | **STAYS** on dxLink (Theta has no futures) |
| **ES settle / day-change baseline** | dxLink `Summary.prevDayClosePrice` + TT REST | **STAYS** on TT/dxLink |
| **Overnight SPX (ES-derived)** | `esFut + cashBasis` in `_publishSpotDisplay` | **STAYS** — but `cashBasis` now captured from **Theta** SPX during RTH (see §6) |
| **Futures watchlist** (`/NQ`, `/ES`, …) | TT REST `fetchUnderlyingQuotes` | **STAYS** on TT REST |

**The one seam that touches both providers:** `_publishSpotDisplay()` captures
`cashBasis = brokerSPX − esFut` during RTH and reuses it overnight as `esFut + cashBasis`.
After migration the RTH SPX comes from Theta and `esFut` from dxLink. The subtraction happens
in your process, so this keeps working — you just read `this.spot` from the Theta feed instead
of the dxLink Quote branch. Flag this as the highest-risk integration point.

---

## 3. ThetaData facts that drive the design

(Pulled from the v3 docs — see Sources. Verify on the live pricing/subscriptions pages at cutover; ThetaData changes tiers periodically.)

### 3.1 Architecture — the Terminal is mandatory (mostly)

- ThetaData ships a **local Java process, "Theta Terminal"** (`ThetaTerminalv3.jar`, **Java 21+**).
  Your code talks to a localhost HTTP server it hosts; the proprietary wire protocol to Theta's
  servers gives ~30x bandwidth reduction. **v3 REST base is `http://127.0.0.1:25503`** (the v3
  endpoints are under `/v3/...`, e.g. `/v3/option/snapshot/open_interest`), and the **single**
  streaming WS endpoint is `ws://127.0.0.1:25520/v1/events`. (Older v2 docs used port 25510 —
  confirm the live port from your Terminal's startup banner; it prints the bound port.)
- There is now a **Python library** that removes the need to run the Terminal separately for
  Python workloads — but `server-v2` is Node, so you run the Terminal.
- **Auth:** an **API key** (portal-generated) passed via `--api-key`, env `THETA_DATA_API_KEY`,
  or `.env` — *or* `creds.txt` (email/password). API-key auth needs Terminal/bootstrap build
  `20260615`+.
- **Streaming model:** one process-wide WS connection only. *"You cannot have multiple
  connections to this endpoint."* All trade/quote/price messages for every subscribed symbol
  arrive on that one socket; **you** fan them out internally. This maps cleanly onto today's
  single `DxLinkClient` → `_onEvent` dispatcher (one socket in, switch on event type).

### 3.2 Tiers, history depth, real-time, concurrency

**Options** (US index + stocks, 100% market coverage, unlimited REST requests):

| Tier | Price/mo | Granularity | History from | Concurrent REST | Real-time |
| --- | --- | --- | --- | --- | --- |
| Value | $40 | 1-minute | 2020-01-01 | 2 | yes |
| Standard | $80 | tick | 2016-01-01 | 4 | yes |
| Pro | $160 | tick | 2012-06-01 | 8 | yes |

Options real-time snapshot access: Quote/OI/OHLC from **Value**; **Trade snapshot needs Standard+**.
Options **streaming**: 0 contracts on Free/Value; **Standard streams 10k quote / 15k trade
contracts**; Pro 15k quote / unlimited trade (full trade stream). Greeks: 1st-order history
needs Standard; **2nd/3rd-order greeks history is Pro-only** (snapshots of all orders are
available; only deep historical greeks are gated).

**Index** (SPX, VIX on CGIF; NDX on Nasdaq GIDS):

| Tier | Price/mo* | Granularity | History from | Real-time |
| --- | --- | --- | --- | --- |
| Value | — | 15-min | 2023-01-01 | 15-min delayed |
| Standard | — | lowest venue (SPX ~1s) | 2022-01-01 | real-time |
| Pro | — | lowest venue | 2017-01-01 | real-time |

\*Index is sold as its own product line (separate from Options). Confirm whether your use needs
a standalone Index subscription on top of Options, or whether an Options tier includes the index
spot you need. **Critical NDX caveats:** real-time NDX requires **PRO**; NDX historical
underlying only starts **2026-05-11**; SPX/VIX are fine from Standard. RUT/DJX history ends
2024-07-01.

### 3.3 What this means for *your* tiering

- **If NDX EM/zones must stay live and historical:** you need **Options PRO + Index PRO**.
  This is the expensive path (~$160 options + index line). NDX history before 2026-05-11 simply
  does not exist on Theta — your NDX confidence analogs can only go back ~6 weeks from today.
- **If SPX is the priority and NDX can be Standard-or-dropped:** **Options Standard + Index
  Standard** covers SPX chain (tick history to 2016), SPX/VIX spot real-time, OI, 1st-order
  greeks. This is the recommended starting tier; add PRO later only if NDX or 2nd/3rd-order
  greek *history* becomes a hard requirement.
- The dashboard's heavy live consumer is the option **quote/trade stream** for the active SPX
  window. Standard's 10k streamable quote / 15k trade contracts is comfortably above an 8%
  SPX strike window across a few expiries (hundreds of contracts), so streaming headroom is not
  the binding constraint — **NDX real-time is**.

---

## 4. Target architecture

```
                ┌────────────────────────────────────────────┐
                │            server-v2 (Node)                 │
                │                                             │
  dxLink WS ───▶│  proxy-tastytrade.js  (FUTURES ONLY)        │
  (futures)     │   • ES Quote/Trade  → esQuote, footprint    │
                │   • ES Candle sub   → _flushEsCandles       │──▶ es_candles
                │   • ES settle       → esFutPrevClose        │
                │   • futures watchlist (TT REST)             │
                │                                             │
  Theta WS ────▶│  proxy-thetadata.js  (OPTIONS + INDEX)      │
  127.0.0.1     │   • option Trade stream → FlowProcessor     │──▶ premium_flow
  :25520        │   • index Price stream  → spot (SPX/VIX)    │
                │   • REST snapshots: chain, greeks, OI, vol  │──▶ market-state
  Theta REST ──▶│   • REST history: backfill jobs             │──▶ gex/mvc/confidence
  127.0.0.1     │                                             │
  :25510        │  market-state  (unchanged shared store)     │
                │  computation/* (gex-calculator, vex-chex,   │
                │     flow-processor, utils)  — REUSED         │
                └────────────────────────────────────────────┘
                          │
                Theta Terminal (Java 21)  ── separate process / container
```

Key idea: **the computation layer does not change.** `gex-calculator.js`, `vex-chex.js`,
`flow-processor.js`, and the GEX/MVC/confidence writers all consume normalized internal rows.
The migration is entirely in the **ingestion adapters** that produce those rows. You are swapping
the left edge of the diagram, not the middle.

---

## 5. Endpoint-by-endpoint mapping

### 5.1 Chain structure (strikes + expirations)

- **Today:** `fetchChain()` → TT `/option-chains/SPX/nested`, builds `contracts[]` with
  `streamerSymbol`, `occSymbol`, `strike`, `type`, `dte`.
- **Theta:** `option_list_expirations?root=SPXW` then `option_list_strikes?root=SPXW&exp=YYYYMMDD`
  (or `option_list_contracts`). **Two different strike encodings — don't mix them up:**
  - **REST query params** take `symbol`, `expiration` (`YYYY-MM-DD` or `YYYYMMDD`, or `*` for all),
    `strike` **in dollars** (`5000.00`, or `*` for all), `right` (`call`/`put`/`both`). Bulk pulls
    use `expiration=*`; the handy `strike_range=n` param returns n strikes above/below spot + ATM
    (a `2n+1` window) and `max_dte=n` caps DTE — both perfect for your 8% SPX window.
  - **Streaming `contract` object** encodes `strike` in **1/10th of a cent** (a $140 strike = `140000`),
    expiration as a `YYYYMMDD` int, `right` `C`/`P`. Your WS adapter must divide by 1000.

  Build an internal contract row with the same fields your code already expects; drop
  `streamerSymbol`/`occSymbol` (Theta keys by root+exp+strike+right, not OCC).
- **Note:** Theta uses **SPXW** for the weeklies (where 0DTE/most strikes live) and **SPX** for
  the AM-settled monthly. Today `chainTicker()` collapses `SPXW→SPX`; under Theta you must keep
  them **separate** because they are distinct roots with distinct chains. This is a real behavior
  change — audit every `chainTicker()` call site.

### 5.2 Greeks / IV

- **Today:** `bsGreeks()` local Black-Scholes, `impliedVol()` solve; dxFeed Greeks event fills
  some. `_recompute()` blends streamed gamma with a BS/ATM-IV fallback and gates the first GEX
  broadcast on `GREEKS_READY_RATIO` coverage.
- **Theta:** `option_snapshot_greeks_first_order` (delta/gamma/theta/vega) +
  `option_snapshot_greeks_implied_volatility`, or `option_snapshot_greeks_all`. Because Theta
  returns gamma for **every** strike at once (bulk snapshot), the coverage-gating machinery
  (`GREEKS_READY_RATIO`, plateau floors, `OI_READY_GRACE_MS`) becomes **largely unnecessary** —
  you get a complete frame per poll instead of waiting for per-strike stream warm-up. You can keep
  the gate as a safety net but it should fire instantly.
- **Recommendation:** keep your BS path as a fallback, consume Theta greeks as primary, and log
  divergence for a week before trusting fully. Vanna/charm are still BS-derived (Theta's standard
  greeks don't include them) — that part of `_recompute` is unchanged.

### 5.3 Open interest + volume

- **Today:** `fetchOpenInterest()` batches TT `/market-data/by-type?equity-option[]=…` 100 at a
  time; OI also arrives via dxFeed `Summary`; `fetchYahooContractOI()` cross-checks vs CBOE.
- **Theta:** `option_snapshot_open_interest` with `symbol=SPXW&expiration=*` pulls the **whole
  chain's OI in one call** (OPRA, published ~06:30 ET = prior-day close OI); `volume` comes off the
  OHLC/quote snapshot. **Delete** the CBOE cross-check and the OCC normalization entirely. OI
  semantics improve: it's the official OPRA figure, not a dxFeed approximation.
- **Two operational gotchas to code around:** (a) the OI snapshot **returns no data when the market
  was closed that day**, and (b) Theta **resets the snapshot cache at midnight ET**. So a pre-06:30
  or weekend/holiday poll legitimately returns empty — your adapter must treat empty-OI as "reuse
  yesterday's" rather than "OI is zero" (today's dxFeed `Summary` path already never overwrites a
  known OI with an empty one — preserve that guard). Update any code that expects intraday-updating
  OI: OPRA OI is a once-daily morning value (same as today's reality, just sourced cleanly).

### 5.4 Option trade tape → flow

- **Today:** dxFeed `Trade` events on option `streamerSymbol`s feed `FlowProcessor.inferSide`
  (Lee-Ready + tick-rule), aggregated every `FLOW_AGGREGATE_MS` (500ms) into `premium_flow`.
- **Theta:** subscribe the **Options Trade Stream** over the one WS. Each message has a `contract`
  (root/exp/strike/right) + trade price/size + a prevailing quote you can pair (or subscribe the
  Quote stream too for the `inferSide` quote arg). **`FlowProcessor` is reused unchanged** — you
  only rewrite the adapter that turns a Theta trade message into the `{price, size, quote, symbol}`
  shape `inferSide` expects. The `QUOTE_FRESH_MS` stale-quote guard stays relevant.
- **Streaming budget:** Standard = 15k trade contracts concurrent. An SPX 0–3 DTE window is well
  under that. NDX would add to the count but is the same order of magnitude.

### 5.5 Index spot (SPX / VIX)

- **Today:** dxFeed Quote on `spotSymbol`/`vixSymbol` → `marketState.setSpot` /
  `setAux({vix})`.
- **Theta:** `index_snapshot_price` (REST poll) or the **index Price Stream** (`SPX`, `VIX`).
  Note Theta only emits a new index tick **when the price changes** — a "missing" tick means
  "unchanged," so your last-value cache is the correct interpretation (no gap-filling needed).
  Wire the Theta SPX price into the same `this.spot` field that `_publishSpotDisplay` reads.

### 5.6 Historical backfill (new capability)

- **Today:** none — MVC/confidence build forward from live snapshots.
- **Theta:** one-off + nightly jobs hitting `option_history_eod`, `option_history_ohlc`,
  `option_history_open_interest`, `option_history_greeks_*`, `index_history_price`. Respect the
  **concurrency cap** (Standard = 4 concurrent REST; the Terminal queues beyond
  `request_queue_length`). Backfill SPX option EOD/greeks 2016→present to seed real analogs;
  backfill SPX index price for the confidence engine's prior-session context.

---

## 6. Code touchpoints (file by file)

`server-v2/proxy-tastytrade.js` (2,628 lines today → shrinks substantially)
- **Keep:** `getAccessToken`, `ttGet`, `resolveFrontEsSymbol`, `_publishEsFut`,
  `_flushEsCandles`, `_refreshEsSettle`, `fetchUnderlyingQuotes` (futures watchlist), the ES
  branches of `_onEvent` (Quote/Trade/Summary on `esSymbol`), `DxLinkClient` (futures channel only).
- **Remove / move to Theta adapter:** `fetchChain`, `getChainCached`, `fetchOpenInterest`,
  `fetchCboeChain`, `fetchYahooContractOI`, `probeRest` (options path), `fetchOptionMarketData`,
  `fetchChainFull`, `fetchOptionMarks`, `fetchExpirations`, the option-contract branches of
  `_onEvent`/`_readFeed`, the OI/greeks coverage gating in `_recompute`, the option
  `subscribe`/`subscribeCandle` plumbing for non-futures symbols.
- **Edit:** `_publishSpotDisplay` — read SPX from the Theta feed (inject `this.spot` from the
  Theta adapter or move the method to a shared owner). `_recompute` — pull rows from Theta
  snapshots instead of the streamed `quotes`/`summaries`/`greeks` maps.

`server-v2/proxy-thetadata.js` (new)
- `ThetaTerminalClient`: single WS to `ws://127.0.0.1:25520/v1/events`; status keep-alive; one
  `onEvent` dispatcher that mirrors today's `_onEvent` switch (Trade → flow, Quote → quote cache,
  index Price → spot). REST helpers against `http://127.0.0.1:25510` for snapshot chain/greeks/OI.
- Reuse `computation/*` and `state/*` writers verbatim. Produce the **same internal row shape**
  `gex-calculator`/`vex-chex` consume so nothing downstream changes.
- Symbology helpers: `toThetaStrike` (×1000, integer 1/10-cent), `toThetaExp` (YYYYMMDD int),
  root mapping that **preserves SPXW vs SPX**.

`server-v2/server-with-proxy.js` (entry / proxy routes)
- Repoint `/api/chains`, `/api/expirations`, `/api/em/option-marks`, `/proxy/probe-rest`
  (options), `/api/levels`, `/api/snapshots` consumers to the Theta adapter's `serveChainFromLive`
  equivalent. Keep ES/footprint/candle routes on the TT proxy.

`lib/db.ts` — **no schema change required.** `premium_flow`, `mvc_snapshots`,
`option_strike_gex_history`, `greeks_ts`, `confidence_log`, `es_candles`, `es_gap`, `eod_gex`,
`em_tracker`, `ticker_levels` all store **normalized** values, not provider-specific payloads.
The writers feed them the same numbers from a different source. (Optionally add a `source` column
note for provenance, but not required.)

Cron / scheduled writers — `mvc-auto-snapshot.js`, `eod-gex-recorder.js`, the EM weekly publisher,
the es_gap cron: only their **data source call** changes (chain/greeks/OI now from Theta). The
RTH/holiday gates (`isRTH`, `ES_NON_SETTLE_DATES`) are unchanged. The es_gap and ES-candle crons
stay 100% on dxLink.

Pine/levels export, budget, Clerk/auth, sidebar, notes — **untouched** (no market-data dependency).

---

## 7. Deployment changes (VPS + Docker)

This is the part that is genuinely new, not just a code swap.

1. **Add the Theta Terminal as a service.** On the Render-replacement VPS Docker stack, add a
   second service running `java -jar ThetaTerminalv3.jar` (a `eclipse-temurin:21-jre` base + the
   jar, or Theta's image if provided). It must stay running for `server-v2` to get any data.
2. **Networking:** `server-v2` reaches the Terminal at `http://theta-terminal:25510` and
   `ws://theta-terminal:25520/v1/events` over the compose network. Set
   `THETA_BASE_URL`/`THETA_WS_URL` envs accordingly (don't hardcode `127.0.0.1` once it's a
   separate container).
3. **Secrets:** `THETA_DATA_API_KEY` goes in `/opt/dashboard/.env.local` (your existing
   gitignored, never-via-git-pull secrets file) and is passed to the Terminal container. Per your
   deploy rule, edit on the box + `docker compose up -d --force-recreate`.
4. **Health/restart:** the Terminal auto-updates on startup and falls back to the prior version if
   an update fails. Add a `restart: unless-stopped` and a healthcheck (HTTP 200 on `:25510`).
   `server-v2` should treat "Terminal unreachable" like today's "DB unavailable" — degrade, don't
   crash (mirror the lazy-pool no-op pattern in `es-candle-writer.js`).
5. **Owner-exempt / idle:** the WS lifecycle throttle (`useWsLifecycle`, idle pause) is about your
   *client→server* sockets and is unaffected. Theta's outbound is one server→Terminal socket; it
   does not multiply per browser tab, so the Render bandwidth-leak class of bug does not recur on
   the Theta side.

---

## 8. Cost

| Scenario | Options | Index | ~Monthly | Covers |
| --- | --- | --- | --- | --- |
| **SPX-first (recommended start)** | Standard $80 | Standard (confirm price) | ~$80 + index line | SPX chain tick-history to 2016, SPX/VIX RT spot, OPRA OI, 1st-order greeks, flow stream |
| **Full (NDX live)** | Pro $160 | Pro (confirm price) | ~$160 + index line | adds NDX RT + tick history to 2012, 2nd/3rd-order greek history |
| Backfill-only trial | Free → Value $40 | — | $0–40 | 1yr free EOD to validate symbology before committing |

Notes: Options pricing is per the public page ($40/$80/$160). The **Index** product is a separate
line whose monthly figure isn't on the same card — get the exact number from the portal at signup.
Compare against your current **TT/dxFeed** cost (effectively bundled/free with the brokerage),
because after migration you **keep** paying nothing extra for futures but **add** the Theta bill —
this is a net new cost, justified by OI quality + real option history.

---

## 9. Risks & mitigations

- **NDX history gap (hard limit):** Theta NDX underlying history starts 2026-05-11. NDX confidence
  analogs can't predate that. *Mitigation:* keep NDX EM live-only, or accept a short history window,
  or retain a TT-sourced NDX snapshot trickle in parallel for a few months to self-build history.
- **SPXW vs SPX root split:** collapsing them (today's `chainTicker`) will silently drop or
  mismatch strikes on Theta. *Mitigation:* explicit root handling + a one-time diff of Theta chain
  vs current chain for the same session before cutover.
- **OPRA OI is once-daily (~06:30 ET):** if any view assumed intraday OI changes, it never really
  had them, but verify the confidence/MVC code doesn't poll OI expecting movement.
- **Terminal as a single point of failure:** if the Java process dies, *all* options data stops.
  *Mitigation:* healthcheck + auto-restart + the degrade-don't-crash pattern, and an alert.
- **Two clocks, one basis:** the RTH `cashBasis` capture now spans providers (Theta SPX − dxLink
  ES). A feed skew at 15:59–16:00 ET could poison the overnight basis. *Mitigation:* capture basis
  on a median of the last N RTH samples, not a single tick (small change to `_publishSpotDisplay`).
- **Concurrency limits on backfill:** Standard = 4 concurrent REST. A naive 30k-contract backfill
  loop will queue/stall. *Mitigation:* bounded worker pool sized to the tier; run backfill
  off-hours.
- **Rollback:** because the TT proxy stays in the tree (just scoped to futures), a feature-flag
  (`DATA_SOURCE=theta|tt`) lets you flip the options source back to TT/dxLink instantly if Theta
  data looks wrong on day one. **Build the flag first.**

---

## 10. Phased cutover

**Phase 0 — Validate (Free/Value, no code in prod).** Sign up, generate an API key, run the
Terminal locally, and pull SPX chain + OI + greeks snapshots. Diff Theta's SPX chain/OI/greeks
against the live dashboard for the same minute. Confirm SPXW/SPX symbology and strike scaling.
Decide Standard vs Pro based on the NDX question.

**Phase 1 — Adapter behind a flag (dev).** Add `proxy-thetadata.js` producing the same internal
rows; gate with `DATA_SOURCE`. Reuse `computation/*` untouched. Validate GEX walls, EM, and a flow
sparkline match TT within tolerance on a dev session.

**Phase 2 — Flow + spot on Theta (dev → prod canary).** Move the option Trade stream and SPX/VIX
spot to Theta; keep chain/greeks/OI snapshots dual-sourced (compute both, serve TT, log Theta) for
a few sessions to build confidence.

**Phase 3 — Chain/greeks/OI on Theta (prod).** Flip GEX/EM/MVC/confidence reads to Theta. Delete
the CBOE cross-check and OCC normalization. Keep the flag.

**Phase 4 — Shrink the TT proxy to futures-only.** Remove the now-dead option code paths from
`proxy-tastytrade.js`. ES candles/settle/watchlist remain. Update `HANDOFF.md`/CLAUDE notes.

**Phase 5 — Backfill + decommission.** Run the historical backfill jobs (SPX 2016→present).
Wire real analogs into confidence/MVC. Remove the TT options-data env/secrets you no longer use
(leave the OAuth creds — still needed for futures + watchlist).

---

## 11. Open questions to resolve before Phase 1

- Does NDX EM/zones need to stay **live**? (Decides Standard vs PRO and the whole cost tier.)
- Is a standalone **Index** subscription required on top of Options for SPX/VIX spot, and at what
  monthly price? (Get the exact number from the portal.)
- Keep local BS greeks as primary with Theta as cross-check, or consume Theta greeks directly?
- Do you want a `source` provenance column added to the market-data tables, or keep them clean?
- Backfill horizon: full 2016→present for SPX, or just enough to seed analogs (e.g. trailing 2y)?

---

## Sources

- [ThetaData — Pricing](https://www.thetadata.net/pricing)
- [ThetaData v3 — Getting Started (Terminal, Java 21, auth, config)](https://docs.thetadata.us/Articles/Getting-Started/Getting-Started.html)
- [ThetaData v3 — Subscriptions (tiers, history depth, concurrency, NDX caveats)](https://docs.thetadata.us/Articles/Getting-Started/Subscriptions.html)
- [ThetaData v3 — Streaming API (single WS, mechanics, contract/strike encoding)](https://docs.thetadata.us/Streaming/Getting-Started.html)
- [ThetaData v3 — REST API index (option/index/stock endpoints)](https://docs.thetadata.us/operations/stock_list_symbols.html)
- [ThetaData v3 — Option Open Interest snapshot](https://docs.thetadata.us/operations/option_snapshot_open_interest.html)
- Internal: `server-v2/proxy-tastytrade.js`, `server-v2/computation/flow-processor.js`, `server-v2/state/es-candle-writer.js`, `lib/db.ts` (audited 2026-06-24)
