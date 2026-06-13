# MotiveWave Cloud Levels — GEX from SPXW 0DTE

## What Gets Plotted

All levels are calculated from **SPXW 0DTE options only**, using live Greeks and Open Interest streamed via dxLink. SPX strikes are converted to **ESM6 prices** using yesterday's 4pm settlement basis before being written to the CSV.

| Level | Color | Band | Definition |
|---|---|---|---|
| **Call Wall** | RED line | None (solid) | Strike with highest total call GEX (`callGamma × callOI × 100 × spot`) |
| **Put Wall** | GREEN line | None (solid) | Strike with highest absolute put GEX |
| **Zero Gamma** | WHITE line | GRAY cloud ±4 ticks | Interpolated flip point where net GEX crosses zero |

---

## SPX → ESM6 Conversion

```
basis = ESM6_close_yesterday − SPX_close_yesterday
ESM6_level = round(SPX_strike + basis, 0.25)   ← nearest ES tick
```

Basis is fetched **once per day at first use** from TastyTrade daily history and cached until midnight. It reflects the prior session's 4pm settlement spread, which is stable intraday.

---

## How Levels Are Refreshed

### Automatic — every 5 minutes (market hours only)
Mon–Fri, 9:30–16:15 ET. The proxy:
1. Fetches live SPX spot
2. Re-queues Greeks + Summary subscriptions for nearest ±200 SPXW strikes
3. Waits 2 seconds for dxLink to populate cache
4. Recomputes all three levels and overwrites `gex_levels.csv`

### On-demand — MotiveWave poll
Every time MotiveWave hits the URL, the proxy recomputes from whatever is currently in `dxGreeksCache` and returns fresh CSV.

### Manual — hit the endpoint directly
```
GET http://localhost:3001/proxy/api/gex-levels
```

---

## MotiveWave Setup

1. Add the **Cloud Levels** study to your ESM6 chart
2. Source Type → **URL**
3. URL → `http://localhost:3001/proxy/api/gex-levels`
4. Format → **Investor/RT (CSV)**

MotiveWave will poll on its own refresh cycle and pick up updates automatically.

---

## Adding or Changing Levels

All level logic lives in `proxy-tastytrade.js` in two functions:

**`computeAndCacheGexLevels`** — add new level calculations here alongside `callWall`, `putWall`, `zeroGamma`.

**`writeGexCsvFile`** — add a new CSV row here to plot it. Format:
```
ESM6,{price},Label,Text Color,Line Color,Band Color,Band Offset,Show Label,Show Price
```

### Column reference
| Column | Options | Notes |
|---|---|---|
| Symbol | `ESM6` | Must match your MotiveWave instrument exactly |
| Price | number | Already converted to ES ticks |
| Text Color | `WHITE`, `BLACK`, hex | Label text color |
| Line Color | `RED`, `GREEN`, `WHITE`, hex | Horizontal line color |
| Band Color | `TRANSPARENT`, `GRAY`, hex | `TRANSPARENT` = solid line only |
| Band Offset | `0`, or ticks | `0` = solid line; `>0` = shaded cloud ±N ticks |
| Show Label | `TRUE`/`FALSE` | |
| Show Price | `TRUE`/`FALSE` | |

### Example — add a second call resistance level
```js
// In computeAndCacheGexLevels, after callWall:
const sortedByCG = [...strikes].sort((a, b) => b.callGEX - a.callGEX);
const callWall2 = sortedByCG[1]?.strike || 0;

// In writeGexCsvFile:
if (callWall2 > 0) rows.push(`ESM6,${spxLevelToEs(callWall2, basis).toFixed(2)},CW2,WHITE,ORANGE,TRANSPARENT,0,TRUE,TRUE`);
```

---

## Logs to Watch

```
ES basis (settlement): SPX_close=5480.00  ESM6_close=5489.25  basis=9.25  (2025-05-23)
GEX levels → SPX: CW=5500 PW=5450 ZG=5478.25 | basis=9.25 | ESM6: CW=5509.25 PW=5459.25 ZG=5487.50
Auto GEX refresh complete. Spot: 5481.40
```
