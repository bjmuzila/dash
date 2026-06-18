# server-v2 Proxy — Handoff & Next Steps

## What this is
A from-scratch Tastytrade/dxLink market-data proxy that computes GEX (gamma
exposure) and related greeks for the dashboard. Built standalone in `server-v2/`,
**not yet wired into the app**. The old stack still lives in `server/`.

## Status: WORKING (verified by curl on SPX, NVDA, /ESU6)
- OAuth, dxLink streaming, live spot, flow tape, Black-Scholes greeks
- GEX / DEX / vanna / charm per strike + aggregate totals
- Reliable OI + volume (REST backfill)
- Deep-ITM / illiquid legs preserved
- Symbol resolution across index / equity / future
- Prev-close support
- 16 passing unit tests (`tests/server-v2.test.ts`)

## File layout (server-v2/)
```
server-v2/
├── server-with-proxy.js     # entry point: Next.js + REST /proxy/* + WS /ws/gex + feed boot
├── proxy-tastytrade.js      # OAuth, chain fetch, symbol resolution, dxLink client, recompute loop
├── websocket-server.js      # /ws/gex broadcaster (snapshot on connect, deltas on change)
├── types.ts                 # shared TS types (doc only)
├── state/
│   └── market-state.js      # central in-memory store + change emitter
└── computation/
    ├── utils.js             # numeric helpers, ET dates, symbol parsing, Black-Scholes + IV
    ├── gex-calculator.js    # per-strike GEX, flip, walls (calcs ported from old server/)
    ├── vex-chex.js          # vanna (netVanna/netVolVanna) + charm exposure + accumulator
    └── flow-processor.js    # rolling trade-tape flow buckets w/ aggressor-side inference
```

## How to run
```
$env:SYMBOL="SPX"        # or "NVDA" or "/ESU6"
node server-v2/server-with-proxy.js
```
Binds **port 3002** (from `.env.local`). REST under `/proxy/*`, WS at `/ws/gex`.

## REST endpoints (all return JSON)
- `/proxy/snapshot` — full state
- `/proxy/gex` — symbol, spot, prevClose, prevCloseDate, expiry, gexRows[], totals, callWall, putWall, gexFlip, totalNetGex
- `/proxy/flow` — current flow bucket
- `/proxy/expirations` — expiry + expirations[]
- `/proxy/status` — feed health
- `/proxy/health` — liveness

## Output row shape (matches dashboard ChainRow in lib/calculations/calculations.ts)
strike, spotPrice, callOI, putOI, callVolume, putVolume, callGamma, putGamma,
callDelta, putDelta, callGEX, putGEX, netGEX, netVolGEX, netDEX, volNetDEX,
netVanna, netVolVanna, chex, callIV, putIV, dte

## Key technical decisions / gotchas (DON'T re-learn these the hard way)
1. **OAuth**: Tastytrade `/oauth/token` needs client creds in the **HTTP Basic
   auth header** (NOT the body), plus a **User-Agent** header. API calls use a
   **Bearer** access token. Missing any of these → nginx HTML 401 (not JSON).
2. **Symbol mapping differs by class AND between Tastytrade vs dxLink**:
   - Index SPX → REST `index=SPX`, streamer `SPX`
   - Equity NVDA → REST `equity=NVDA`, streamer `NVDA`
   - Future /ESU6 → REST `future=/ESU6`, streamer **`/ESU26:XCME`** (year expands, exchange suffix added)
   - **Never construct the dxLink streamer symbol — read `streamer-symbol` from the instrument record.** `resolveUnderlying()` in proxy-tastytrade.js does this.
3. **OI is NOT reliable from the dxLink Summary stream.** Pulled via REST
   `/market-data/by-type?equity-option[]=...` and matched by **whitespace-stripped
   OCC symbol** (SPX padding matched by luck; NVDA did not → `normalizeOcc()`).
4. **Volume** comes from the live `Trade.dayVolume` event (Summary has no volume).
5. **Deep-ITM matters for GEX.** Legs with OI but no live quote are kept using
   the REST `mark` price; if IV can't be solved, they fall back to ATM IV so
   gamma is non-zero. (Optional improvement: use REST broker `gamma` directly.)
6. **Greek units**: theta/charm normalized per-year→per-day (÷365); vega/vanna
   per-1.00-vol→per-1%-vol (÷100).
7. **PowerShell is 5.1** — no `??` operator; `curl` is `Invoke-WebRequest`.
8. Workspace Linux sandbox is DOWN (HYPERVISOR_VIRT_DISABLED) — couldn't run
   node from the assistant side; all runtime testing was done by the user.

## NEXT STEP: Migration audit (do this in the new chat)
Goal: determine exactly what the dashboard needs from the OLD `server/` stack so
we know how big the wire-in is BEFORE changing package.json.

Audit checklist:
1. **WS contract** — `app/home/page.tsx` connects to `/ws/gex` and sends
   `{type:'SET_EXPIRY'}`. Find the inbound `onmessage` handler (it sets
   `gexChainRows`/`gexSpot`) and document the EXACT message type/shape it expects.
   server-v2 currently sends `{type:'gex', data:{...}}` + `{type:'snapshot'}`.
   Confirm these match or list the gap. Also check `/ws/dxlink` (old bridge) and
   whether the heatmap relies on it.
2. **Endpoints** — grep the frontend for every `/proxy/...` and `/api/...` call;
   confirm server-v2 serves each (or note missing ones).
3. **DB writes** — old `server/loops/gex-loop.js` writes GEX to Postgres
   (`lib/db.ts`, `lib/snapdb.ts`). Does the dashboard read history from the DB?
   If yes, server-v2 needs an equivalent writer.
4. **Old broadcaster** — compare `server/ws/broadcaster.js` message format to
   server-v2/websocket-server.js. Align names if the frontend is rigid.
5. Produce a punch-list, then wire in ON A BRANCH with the old stack as fallback.

## Other open / additive work (after wire-in)
- ES futures-options GEX: point fetchChain at `/futures-option-chains/{sym}/nested`
  for futures (current `/option-chains/` returns nothing for /ESU6).
- Live symbol switching: add WS `SET_SYMBOL` command (re-resolve, re-fetch chain,
  resubscribe) like `SET_EXPIRY`.
- Optional: use REST broker greeks for deep-ITM instead of ATM-IV fallback.

## SECURITY — do this regardless
The TT client secret, refresh token, Discord bot token, and Postgres password
were exposed in chat during debugging. **Rotate all of them** and confirm
`.env.local` is in `.gitignore`.

## Prev closes captured this session (2026-06-17)
SPX 7420.1 · NVDA 204.65 · /ESU6 7492.75
```
