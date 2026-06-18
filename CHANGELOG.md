# Changelog

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
