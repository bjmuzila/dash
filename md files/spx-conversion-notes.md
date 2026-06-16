# SPX Topbar Price Conversion — How It Works

## Overview

The SPX price in the topbar behaves differently depending on time of day:

| Time (ET) | Source |
|---|---|
| 9:30am – 4:00pm | Real SPXW quote from TastyTrade API |
| 4:00pm – midnight | ES-implied conversion using today's closes |
| Midnight – 9:30am | ES-implied conversion using yesterday's closes (prev-close) |

---

## The Conversion Formula

When SPX is not trading, the displayed price is derived from the ES futures price:

```
impliedSPX = esNow - (esClose - spxClose)
```

Where:
- `esNow` = current /ESM6 mark price
- `esClose` = ES closing price at 4pm ET
- `spxClose` = SPX closing price at 4pm ET

**Example (May 26, 2026):**
- ES 4pm close: 7539.25
- SPX 4pm close: 7518.80
- Spread: 20.45 points
- ES at 9pm: 7532.25
- Implied SPX: 7532.25 - 20.45 = 7511.80 ✓

---

## Where the Code Lives

Two files are involved — both need to be correct:

### `pages/overview.js` — owns `#spx-price` and `#spx-change`
- Function: `updateSPXDisplay(quote)`
- This is the authoritative writer to the topbar SPX elements
- Uses `esCloseForConv` / `spxCloseForConv` which load from `localStorage.todayCloses`
- Falls back to `esPrevClose` / `spxPrevClose` (candle-based yesterday closes) if no stored closes

### `es-stats-spx-price.js` — secondary writer + ES Stats pill
- Also writes to `#spx-price` and `#spx-change`
- Runs on a 15s interval
- Gets overwritten by `overview.js` shortly after

---

## Today's Closes — How They're Stored

At 4pm ET (±2 min window), `es-stats-spx-price.js` captures live prices and stores them:

```javascript
localStorage.setItem('todayCloses', JSON.stringify({
  es: esNow,
  spx: spxNow,
  date: '2026-05-26'  // ET date
}));
```

At midnight ET, the stored value is cleared so the next day starts fresh using `prev-close`.

### Manual override (if dashboard was closed at 4pm):
```javascript
localStorage.setItem('todayCloses', JSON.stringify({
  es: 7539.25,
  spx: 7518.80,
  date: '2026-05-26'
}));
```

---

## TastyTrade API Quote Structure

Endpoint: `GET /proxy/api/tt/quotes-batch?index[]=SPX&index[]=SPXW&future[]=/ESM6`

Response:
```json
{
  "data": {
    "items": [
      { "symbol": "/ESM6", "mark": "7532.5", "prev-close": "7537.0", ... },
      { "symbol": "SPX",   "mark": "7517.575", "prev-close": "7473.47", ... }
    ]
  }
}
```

Key field mappings:
- Current price → `mark` (not `last`)
- Previous close → `prev-close` (hyphenated, not camelCase)

---

## Issues Encountered During Development

### 1. `console.log` globally disabled in `index.html`
Line 226 in index.html suppresses all logs: `console.log = () => {}`. This made all debugging invisible. Had to use `alert()` and DOM injection to trace values.

### 2. Wrong file was being fixed
Early attempts fixed `es-stats-spx-price.js` but `overview.js` was the actual owner of `#spx-price`. The ES stats script's writes were being overwritten every refresh cycle.

### 3. Proxy endpoint 404
The initial fetch URL used query param format that didn't match the proxy's parser, causing crashes with `parsedUrl is not defined`.

### 4. Quote response structure mismatch
The parser assumed `data.index[]` and `data.future[]` as separate arrays. Actual TT response returns a flat `data.items[]` array with all symbols mixed together.

### 5. `prev-close` key naming
TastyTrade uses hyphenated `prev-close` not camelCase `prevClose`. The `firstNumber()` key list didn't include it initially, causing `spxPrev` to resolve as NaN.

### 6. Midnight reset firing on boot
`lastResetDate` initialized as `null`, so the date check `todayDate !== lastResetDate` fired immediately on first run, wiping the hardcoded closes before they could be used. Fixed by initializing `lastResetDate` to today's ET date.

### 7. `todayCloses` scoped inside IIFE
Variables inside the IIFE aren't accessible via `window.todayCloses`, making runtime inspection impossible from the console.

### 8. localStorage cleared between reloads
The `todayCloses` entry was being wiped by the midnight reset logic on every page load (same root cause as issue 6). Required manually re-setting via console until the logic was corrected.

### 9. Change display used wrong baseline
After the price was correct, the `+/-` change still showed wrong values because it was comparing `displayPrice` against yesterday's `spxPrevClose` (~7473) instead of today's close (7518.80). Fixed by using `spxCloseForConv` as the baseline after hours.
