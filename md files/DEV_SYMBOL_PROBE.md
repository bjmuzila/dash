# Dev · Symbol Probe (`/dev`)

A diagnostic page for inspecting raw per-strike option data for **any ticker**, on demand. Resolves a typed strike to the real chain contract, pulls Tastytrade market-data, and renders every feed type plus net-greek exposures at once.

Page: `app/dev/page.tsx`
Server: `server-v2/proxy-tastytrade.js` (`probeRest`), route in `server-v2/server-with-proxy.js`

## How it works (data path)

```
Browser /dev page
   │  GET /proxy/probe-rest?ticker=&expiry=&type=&strike=
   ▼
next.config.js rewrite  /proxy/:path*  →  http://127.0.0.1:3001/proxy/:path*
   ▼
server-with-proxy.js route handler  →  probeRest({ ticker, expiry, type, strike })
   ▼
Tastytrade REST:
   1. /option-chains/<root>/nested        (cached 60s per root)
   2. resolve/snap to nearest real strike
   3. /market-data/by-type?equity-option[]=<OCC>
   4. /market-data/by-type?index=|equity=<root>   (underlying spot)
   ▼
{ found, resolvedSymbol, snapped, result: { feeds, exposures, raw } }
```

Everything goes through **one REST request** — no live-feed dependency, no polling. This is deliberate: the live dxLink feed only covers the single `SYMBOL` (SPX), so it can't serve arbitrary tickers and goes empty overnight. REST works for any ticker, any session.

## Strike resolution / snapping

The page formats a built symbol from the typed strike, but the chain only contains real strikes. `probeRest` finds the nearest available strike for the requested `expiry + side` and uses that contract's true streamer/OCC symbol. If it snaps, the response carries `snapped: true` with `requestedStrike` → `resolvedStrike`, surfaced in the status line and log.

Root mapping (`chainTicker()`): `SPXW→SPX`, `NDXP→NDX`, `RUTW→RUT`. The option-chain endpoint is keyed by the underlying root, not the weekly streamer root.

## The five panels

| Panel | Source fields |
|---|---|
| **Quote** | bid, ask, mid, mark, bidSize, askSize |
| **Trade** | last, lastSize, volume, dayOpen, dayHigh, dayLow |
| **Summary** | openInterest, prevClose, prevCloseDate, close |
| **Greeks** | iv, delta, gamma, theta, vega, rho |
| **Net Greeks** | GEX, DEX, VEX, Theta exp, GEX(vol) — exposures |

Plus a collapsible **Raw response** with the unmodified market-data item (every field, nothing dropped).

### Net-greek formulas (match `gex-calculator.js` / `vex-chex.js`)

For the single resolved contract (call `+`, put `−`):

- `GEX  = |gamma| × OI × spot²`
- `DEX  = |delta| × OI × 100 × spot`
- `VEX  = vega × OI × 100 × spot`   (vega exposure)
- `ThetaExp = theta × OI × 100 × spot`
- `GEX(vol) = |gamma| × volume × spot²`

`spot` is fetched server-side from the underlying market-data. **Vanna/Charm exposure show `n/a`** — Tastytrade's `/market-data/by-type` doesn't return vanna/charm; the dashboard derives those itself in `_recompute`. This box is a **single-contract** exposure, not the whole-chain net total.

## UI features

- **Ticker / Side / Strike / Expiry** inputs, **Render** + **Stop** buttons.
- **Stop** aborts the in-flight fetch (AbortController) — abort errors are swallowed quietly.
- **Elapsed** counts up live (amber `Ns ⏱`) while loading, then freezes to the final ms — confirms the page is alive.
- **Log panel**: scrolling, timestamped, color-coded (green ok / amber warn / red err / blue info), capped at 200 lines, with Clear. Logs request, snap, response status, OI/vol/mark/iv, and Σ exposures.
- The **Expiry** dropdown is still populated from SPX's expirations (`/proxy/expirations`). For a non-SPX ticker, pick a date in *its* chain; a miss returns `no-expiry` with the list of valid expirations, or `no-strike`.

## Endpoints

- `GET /proxy/probe-rest?ticker=&expiry=&type=C|P&strike=` → the probe (any ticker).
- `GET /proxy/probe?symbol=&feed=` → legacy live-feed probe (SPX in-memory + overnight stale recall via the `last_events` table). **No longer used by the page** but still live; harmless.

## Gotchas

- **Restart the proxy (port 3001) after any `server-v2/*.js` change.** It's plain Node — not hot-reloaded. Next.js page bundles hot-reload; the proxy route table does not. A stale process returns `404 unknown proxy route` for `/proxy/probe-rest`.
- Greeks may be empty if the REST item lacks them — check Raw response for alternate field names.
