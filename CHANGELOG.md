# Changelog

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
